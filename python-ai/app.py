import json
import os
import math
import warnings
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import mysql.connector
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
from google import genai
from google.genai import types as genai_types
from sklearn.metrics.pairwise import cosine_similarity
from statsmodels.tsa.arima.model import ARIMA

load_dotenv(os.path.join(os.path.dirname(__file__), '.env'))

app = Flask(__name__)
CORS(app)

DB_CONFIG = {
    'host': os.getenv('DB_HOST', '127.0.0.1'),
    'port': int(os.getenv('DB_PORT', '3306')),
    'database': os.getenv('DB_NAME', 'cemetery_db'),
    'user': os.getenv('DB_USER', 'root'),
    'password': os.getenv('DB_PASSWORD', ''),
    'charset': 'utf8mb4',
    'autocommit': True,
}

warnings.filterwarnings('ignore')

CAPACITY_WARNING_THRESHOLD = 0.80
CAPACITY_CRITICAL_THRESHOLD = 0.95

# Phase 4: LLM narrator layer — purely cosmetic phrasing of the chat outcome
# message. Never used for scoring, ranking, or data access; the recommendation
# engine above is untouched. Falls back to null (caller uses its own
# deterministic text) whenever no key is configured or the call fails for any
# reason, so this feature is fully optional and never blocks a search.
# Uses the Gemini API (free tier available at aistudio.google.com) rather
# than a paid provider — all three LLM features below (narrate/extract/chat)
# share one client/timeout convention so they can't drift onto different
# providers independently.
NARRATION_MODEL = 'gemini-3.6-flash'
# The Gemini API rejects any HttpOptions.timeout below 10s outright (400
# INVALID_ARGUMENT) — unlike the old Anthropic client's 8.0s, which was just
# a client-side cutoff. 12s leaves a small margin above that hard floor.
_LLM_TIMEOUT_MS = 12000
# gemini-3.6-flash spends part of max_output_tokens on internal "thinking"
# before the visible answer — thinking_budget=0 is rejected outright for
# this model (400 INVALID_ARGUMENT), so 'low' plus a generous token budget
# per call site is the fix; without it, short structured-JSON responses were
# silently getting cut off mid-object (verified while debugging the extract
# endpoint returning null for every request).
_THINKING_CONFIG = genai_types.ThinkingConfig(thinking_level='low')
_gemini_api_key = (os.getenv('GEMINI_API_KEY') or '').strip()
_gemini_client = genai.Client(api_key=_gemini_api_key) if _gemini_api_key else None

NARRATION_SYSTEM_PROMPT = (
    "You write a single short, warm status line for a cemetery burial-lot "
    "search assistant chat. You are given structured facts only — never "
    "invent details beyond them. Never mention lot numbers, prices, scores, "
    "burial dates, burial times, decedents, or capacity/forecasting; none of "
    "that data is available to you.\n\n"
    "Rules by status:\n"
    "- success: report that the given count of lots was found, briefly and "
    "warmly, in one sentence.\n"
    "- empty: report that no lots matched. Only suggest adjusting whichever "
    "of lot_type, budget, or section appear in preferences_set — never "
    "suggest adjusting one that isn't listed there.\n"
    "- error: report that the recommendation service is temporarily "
    "unavailable and that available lots are shown below to browse "
    "manually. Do not say no lots were found.\n\n"
    "Output only the message text: no preamble, no markdown, no quotes."
)


def _narrate_outcome(status: str, count: Optional[int], preferences: Dict[str, Any]) -> Optional[str]:
    if _gemini_client is None:
        return None

    facts: Dict[str, Any] = {'status': status}
    if status == 'success':
        facts['count'] = count
    if status in ('success', 'empty'):
        facts['preferences_set'] = {
            key: value for key, value in (preferences or {}).items()
            if value not in (None, '')
        }

    try:
        response = _gemini_client.models.generate_content(
            model=NARRATION_MODEL,
            contents=json.dumps(facts),
            config=genai_types.GenerateContentConfig(
                system_instruction=NARRATION_SYSTEM_PROMPT,
                max_output_tokens=512,
                temperature=0.3,
                thinking_config=_THINKING_CONFIG,
                http_options=genai_types.HttpOptions(timeout=_LLM_TIMEOUT_MS),
            ),
        )
        text = (response.text or '').strip()
        return text or None
    except Exception:
        return None


# Batch M3: LLM-assisted preference extraction — an optional fallback the chat
# assistant calls only when its own deterministic regex/keyword extraction
# found nothing at all in a message. Same safety contract as the narrator
# above: structured facts only (the raw message text plus the caller's own
# live lot-type/section lists — never decedent/user/booking data), the model
# may only choose lot_type/section values verbatim from the lists it was
# given (re-validated server-side below, never trusted as free text), budget
# must be a number the message actually states or clearly implies (never
# invented from a vague word like "affordable" alone), and any failure/missing
# key/timeout returns null so the caller falls back to its own "I couldn't
# understand that" clarification — this endpoint never blocks the chat.
EXTRACTION_MODEL = 'gemini-3.6-flash'

EXTRACTION_SYSTEM_PROMPT = (
    "You extract burial-lot search preferences from one short user chat "
    "message for a cemetery booking assistant. Output ONLY a compact JSON "
    "object — no markdown, no code fences, no prose, no explanation.\n\n"
    "Schema: {\"lot_type\": string|null, \"budget\": number|null, "
    "\"section\": string|null, \"lot_type_no_preference\": boolean, "
    "\"budget_no_preference\": boolean, \"section_no_preference\": boolean, "
    "\"lot_type_recommend_requested\": boolean}\n\n"
    "You are given valid_lot_types and valid_sections (the only real options "
    "in this cemetery) and pending_slot (which single slot the assistant had "
    "just asked about, or null).\n\n"
    "Rules:\n"
    "- lot_type MUST be exactly one string from valid_lot_types, or null. "
    "Never invent or paraphrase a lot type name.\n"
    "- section MUST be exactly one string from valid_sections, or null. "
    "Never invent or paraphrase a section name.\n"
    "- budget is a plain number (no currency symbol, no commas) only when "
    "the message states or clearly implies a specific figure (e.g. "
    "\"50000\", \"around 50k\", \"under 30,000\", \"P50,000\"). Never invent "
    "a number for a vague word alone like \"affordable\" or \"cheap\" — "
    "leave budget null in that case.\n"
    "- lot_type_recommend_requested is true ONLY when pending_slot is "
    "\"lot_type\" and the message asks the assistant to pick/suggest/"
    "recommend a lot type for them (e.g. \"recommend one for me\", \"which "
    "type do you suggest\", \"you decide\", \"I don't know, what do you "
    "think is best\"). This is different from simply not caring — use it "
    "when the user wants an actual suggestion. When this is true, leave "
    "lot_type_no_preference false.\n"
    "- Otherwise, set a *_no_preference flag to true only when the message "
    "explicitly says it doesn't matter / any is fine for that specific slot "
    "(e.g. \"any section is fine\", \"whatever budget\"). A vague reply with "
    "no field named and no request for a recommendation (e.g. \"whatever\", "
    "\"doesn't matter\") addresses ONLY pending_slot — set that one slot's "
    "*_no_preference to true and leave the other two slots null/false. "
    "Never set a *_no_preference flag for a slot the message doesn't "
    "actually address.\n"
    "- Only extract what this message actually states. Never invent facts "
    "beyond the message text."
)


def _strip_json_fences(text: str) -> str:
    stripped = text.strip()
    if stripped.startswith('```'):
        stripped = stripped.split('\n', 1)[-1]
        if stripped.endswith('```'):
            stripped = stripped.rsplit('```', 1)[0]
    return stripped.strip()


def _extract_preferences(message: str, lot_types: List[str], sections: List[str], pending_slot: Optional[str]) -> Optional[Dict[str, Any]]:
    if _gemini_client is None or not message:
        return None

    payload = {
        'message': message,
        'valid_lot_types': lot_types,
        'valid_sections': sections,
        'pending_slot': pending_slot,
    }

    try:
        response = _gemini_client.models.generate_content(
            model=EXTRACTION_MODEL,
            contents=json.dumps(payload),
            config=genai_types.GenerateContentConfig(
                system_instruction=EXTRACTION_SYSTEM_PROMPT,
                max_output_tokens=1024,
                temperature=0,
                response_mime_type='application/json',
                thinking_config=_THINKING_CONFIG,
                http_options=genai_types.HttpOptions(timeout=_LLM_TIMEOUT_MS),
            ),
        )
        text = (response.text or '').strip()
        parsed = json.loads(_strip_json_fences(text))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


# General Q&A layer: answers real questions about the burial-scheduling
# process/policies ("what documents do I need?"), called by the chat
# assistant only when its deterministic extractor AND the /api/extract
# fallback both found nothing usable in a message. Strictly grounded in the
# admin/staff-reviewed ai_knowledge table content passed in as
# knowledge_entries — never invents policy beyond it, and explicitly refuses
# (answered: false) whenever the message looks like a struggling attempt to
# fill pending_slot rather than a genuine question, so the caller's existing
# "I couldn't match that" clarification still plays instead of a wrong or
# misleading answer. Same never-fail contract as narrate/extract above: any
# missing key/timeout/parse failure resolves to answered: false so this
# endpoint can never block the chat.
CHAT_MODEL = 'gemini-3.6-flash'

CHAT_SYSTEM_PROMPT = (
    "You answer questions for a cemetery burial-scheduling assistant chat. "
    "You are given a list of knowledge_entries (topic + content, reviewed by "
    "cemetery staff) and the user's message. Output ONLY a compact JSON "
    "object — no markdown, no code fences, no prose.\n\n"
    "Schema: {\"answered\": boolean, \"message\": string|null}\n\n"
    "Rules:\n"
    "- Answer ONLY using facts present in knowledge_entries. Never invent "
    "policy, prices, documents, or rules not stated there.\n"
    "- Set answered=true and write a short, warm, direct message ONLY when "
    "the user's message is a genuine question and knowledge_entries actually "
    "covers it.\n"
    "- Set answered=false (message=null) when: the knowledge_entries don't "
    "cover the topic; the message isn't really a question at all; or — this "
    "is important — the message looks like an attempt to answer whichever "
    "slot the assistant had just asked about (given as pending_slot, e.g. a "
    "name, a number, a lot type, 'no preference', a date) rather than a real "
    "question. When in doubt between 'this is a bad attempt at the pending "
    "slot' and 'this is a genuine question', prefer answered=false — the "
    "caller has its own clarification message for that slot.\n"
    "- Never mention decedent names, specific lot numbers, prices, or any "
    "booking-specific data; none of that is available to you, only the "
    "generic knowledge_entries content."
)


def _fetch_knowledge_base() -> List[Dict[str, str]]:
    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute("SELECT topic, content FROM ai_knowledge ORDER BY topic")
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
        return rows
    except Exception:
        return []


def _answer_question(message: str, knowledge_entries: List[Dict[str, str]], pending_slot: Optional[str]) -> Dict[str, Any]:
    empty = {'answered': False, 'message': None}
    if _gemini_client is None or not message or not knowledge_entries:
        return empty

    payload = {
        'message': message,
        'pending_slot': pending_slot,
        'knowledge_entries': knowledge_entries,
    }

    try:
        response = _gemini_client.models.generate_content(
            model=CHAT_MODEL,
            contents=json.dumps(payload),
            config=genai_types.GenerateContentConfig(
                system_instruction=CHAT_SYSTEM_PROMPT,
                max_output_tokens=1024,
                temperature=0,
                response_mime_type='application/json',
                thinking_config=_THINKING_CONFIG,
                http_options=genai_types.HttpOptions(timeout=_LLM_TIMEOUT_MS),
            ),
        )
        text = (response.text or '').strip()
        parsed = json.loads(_strip_json_fences(text))
        if not isinstance(parsed, dict):
            return empty
        if not parsed.get('answered') or not isinstance(parsed.get('message'), str) or not parsed['message'].strip():
            return empty
        return {'answered': True, 'message': parsed['message'].strip()}
    except Exception:
        return empty


def get_connection():
    try:
        return mysql.connector.connect(**DB_CONFIG)
    except Exception as exc:
        raise RuntimeError(f'Database connection failed: {exc}') from exc


def _normalize_price(value: Optional[float], scale: Optional[float] = None) -> float:
    if value is None:
        return 0.0
    try:
        price = float(value)
    except (TypeError, ValueError):
        return 0.0
    if scale is None or scale <= 0:
        return 1.0 if price > 0 else 0.0
    return max(0.0, min(1.0, price / scale))


def _build_feature_names(lots: List[Dict[str, Any]]) -> List[str]:
    lot_types = sorted({lot.get('lot_type_name') for lot in lots if lot.get('lot_type_name')})
    sections = sorted({lot.get('section_name') for lot in lots if lot.get('section_name')})
    return ['price'] + [f'type:{lot_type}' for lot_type in lot_types] + [f'section:{section}' for section in sections]


def _create_feature_vector(lot: Dict[str, Any], max_price: float, lot_types: List[str], sections: List[str]) -> np.ndarray:
    price_value = _normalize_price(lot.get('price'), max_price)
    features = [price_value]
    for lot_type in lot_types:
        features.append(1.0 if lot.get('lot_type_name') == lot_type else 0.0)
    for section in sections:
        features.append(1.0 if lot.get('section_name') == section else 0.0)
    return np.array(features, dtype=float)


def _create_user_vector(preferences: Dict[str, Any], max_price: float, lot_types: List[str], sections: List[str]) -> np.ndarray:
    budget = preferences.get('budget')
    price_value = _normalize_price(budget, max_price)
    features = [price_value]
    for lot_type in lot_types:
        features.append(1.0 if preferences.get('lot_type') == lot_type else 0.0)
    for section in sections:
        features.append(1.0 if preferences.get('section') == section else 0.0)
    return np.array(features, dtype=float)


@app.get('/api/health')
def health_check():
    return jsonify({'status': 'ok', 'service': 'python-ai'})


def _fetch_available_lots() -> List[Dict[str, Any]]:
    conn = get_connection()
    cursor = conn.cursor(dictionary=True)
    cursor.execute(
        """
        SELECT l.lot_id, l.lot_number, l.price, l.status,
               t.type_name AS lot_type_name,
               s.section_name
        FROM lots l
        JOIN blocks b ON l.block_id = b.block_id
        JOIN sections s ON b.section_id = s.section_id
        JOIN lot_types t ON l.lot_type_id = t.type_id
        WHERE l.status = 'Available'
        ORDER BY s.section_name, b.block_name, l.lot_number
        """
    )
    lots = cursor.fetchall()
    cursor.close()
    conn.close()
    return lots


def _rank_lots(lots: List[Dict[str, Any]], lot_type: str, budget: Optional[float], section: str) -> List[Dict[str, Any]]:
    # Shared by /api/recommend (specific-lot ranking) and /api/recommend-type
    # (Batch M4 lot-type ranking) so both reuse the exact same per-lot
    # scoring — the type ranker is an aggregation over this score, never a
    # second, separately-maintained scoring model. Behavior here is
    # byte-for-byte what /api/recommend always did before this refactor.
    max_price = max((float(lot.get('price') or 0) for lot in lots), default=0.0)
    lot_types = sorted({lot.get('lot_type_name') for lot in lots if lot.get('lot_type_name')})
    sections = sorted({lot.get('section_name') for lot in lots if lot.get('section_name')})
    lot_vectors = [
        _create_feature_vector(lot, max_price, lot_types, sections)
        for lot in lots
    ]
    user_vector = _create_user_vector(
        {'lot_type': lot_type, 'budget': budget, 'section': section},
        max_price,
        lot_types,
        sections,
    )

    if np.allclose(user_vector, 0):
        user_vector = np.ones_like(user_vector) * 0.0

    matrix = np.vstack(lot_vectors) if lot_vectors else np.array([])
    if matrix.size == 0:
        return []

    similarity_scores = cosine_similarity([user_vector], matrix)[0]
    ranked_lots = []
    for index, lot in enumerate(lots):
        score = round(float(similarity_scores[index]) * 100, 2)
        reasons: List[str] = []
        if lot_type and lot.get('lot_type_name') == lot_type:
            score += 5.0
            reasons.append('Matches your preferred lot type')
        if section and lot.get('section_name') == section:
            score += 3.0
            reasons.append('Located in your preferred section')
        if budget is not None and budget != '':
            try:
                budget_value = float(budget)
                lot_price = float(lot.get('price') or 0)
                if lot_price <= budget_value:
                    score += 5.0
                    reasons.append('Within your budget')
            except (TypeError, ValueError):
                pass
        ranked_lots.append({
            **lot,
            'score': round(max(0.0, min(100.0, score)), 2),
            'reasons': reasons,
        })

    ranked_lots.sort(key=lambda item: item['score'], reverse=True)
    return ranked_lots


@app.post('/api/recommend')
def recommend_lots():
    try:
        preferences = request.get_json(silent=True) or {}
        lot_type = (preferences.get('lot_type') or '').strip()
        budget = preferences.get('budget')
        section = (preferences.get('section') or '').strip()

        try:
            lots = _fetch_available_lots()
        except Exception as exc:
            return jsonify({'error': f'Unable to retrieve available lots: {exc}', 'code': 503}), 503

        if not lots:
            return jsonify([])

        ranked_lots = _rank_lots(lots, lot_type, budget, section)
        return jsonify(ranked_lots[:5])
    except Exception as exc:  # pragma: no cover - defensive path
        return jsonify({'error': str(exc), 'code': 500}), 500


@app.post('/api/recommend-type')
def recommend_lot_type():
    # Batch M4: ranks lot TYPES rather than specific lots — a distinct AI
    # output from /api/recommend, directly answering the adviser's "AI
    # should recommend the appropriate TYPE of lot" requirement instead of
    # only ever ranking within an already-chosen type. Reuses _rank_lots
    # (same scoring as /api/recommend) and aggregates by lot_type_name.
    # lot_type is intentionally never read from the request body here —
    # that's the very thing being recommended — only budget/section, if
    # already known, bias the ranking exactly like they do for /api/recommend.
    try:
        preferences = request.get_json(silent=True) or {}
        budget = preferences.get('budget')
        section = (preferences.get('section') or '').strip()

        try:
            lots = _fetch_available_lots()
        except Exception as exc:
            return jsonify({'error': f'Unable to retrieve available lots: {exc}', 'code': 503}), 503

        if not lots:
            return jsonify({'types': []})

        ranked_lots = _rank_lots(lots, '', budget, section)

        by_type: Dict[str, List[Dict[str, Any]]] = {}
        for lot in ranked_lots:
            type_name = lot.get('lot_type_name')
            if not type_name:
                continue
            by_type.setdefault(type_name, []).append(lot)

        types_out = []
        for type_name, type_lots in by_type.items():
            prices = [float(lot.get('price') or 0) for lot in type_lots]
            avg_score = sum(lot['score'] for lot in type_lots) / len(type_lots)
            min_price = min(prices) if prices else 0.0

            reasons: List[str] = []
            if budget not in (None, ''):
                try:
                    budget_value = float(budget)
                    if min_price <= budget_value:
                        reasons.append('Has options within your budget')
                except (TypeError, ValueError):
                    pass
            if len(type_lots) >= 3:
                reasons.append('Good current availability')

            types_out.append({
                'type_name': type_name,
                'available_count': len(type_lots),
                'min_price': round(min_price, 2),
                'score': round(avg_score, 2),
                'reasons': reasons,
            })

        types_out.sort(key=lambda item: item['score'], reverse=True)
        return jsonify({'types': types_out})
    except Exception as exc:  # pragma: no cover - defensive path
        return jsonify({'error': str(exc), 'code': 500}), 500


@app.post('/api/narrate')
def narrate_outcome():
    # Cosmetic phrasing only — never ranks, scores, or touches the database.
    # Always returns 200; 'message' is null when narration isn't available,
    # so callers fall back to their own deterministic text.
    try:
        payload = request.get_json(silent=True) or {}
        status = (payload.get('status') or '').strip()
        if status not in ('success', 'empty', 'error'):
            return jsonify({'message': None})
        message = _narrate_outcome(status, payload.get('count'), payload.get('preferences') or {})
        return jsonify({'message': message})
    except Exception:
        return jsonify({'message': None})


@app.post('/api/extract')
def extract_preferences():
    # Always returns 200; 'result' is null whenever extraction isn't
    # available/didn't parse, so the caller falls back to its own
    # deterministic clarification message.
    try:
        payload = request.get_json(silent=True) or {}
        message = (payload.get('message') or '').strip()
        lot_types = payload.get('lot_types')
        sections = payload.get('sections')
        pending_slot = payload.get('pending_slot')

        if not message or not isinstance(lot_types, list) or not isinstance(sections, list):
            return jsonify({'result': None})

        result = _extract_preferences(message, lot_types, sections, pending_slot)
        if not result:
            return jsonify({'result': None})

        # Never trust the model's strings verbatim even though the prompt
        # constrains it to the provided lists — re-validate membership here.
        if result.get('lot_type') not in lot_types:
            result['lot_type'] = None
        if result.get('section') not in sections:
            result['section'] = None

        budget = result.get('budget')
        if budget is not None:
            try:
                budget = float(budget)
                budget = budget if budget > 0 else None
            except (TypeError, ValueError):
                budget = None
        result['budget'] = budget

        for flag in ('lot_type_no_preference', 'budget_no_preference', 'section_no_preference', 'lot_type_recommend_requested'):
            result[flag] = bool(result.get(flag))

        # A recommend-request supersedes a simultaneous no-preference claim
        # for the same slot — asking to be told the best option is a
        # different intent than not caring at all.
        if result['lot_type_recommend_requested']:
            result['lot_type_no_preference'] = False

        return jsonify({'result': result})
    except Exception:
        return jsonify({'result': None})


@app.post('/api/chat')
def chat_answer():
    # Always returns 200; answered:false whenever an answer isn't available,
    # so the caller falls back to its own existing deterministic behavior.
    try:
        payload = request.get_json(silent=True) or {}
        message = (payload.get('message') or '').strip()
        pending_slot = payload.get('pending_slot')

        if not message:
            return jsonify({'answered': False, 'message': None})

        knowledge_entries = _fetch_knowledge_base()
        result = _answer_question(message, knowledge_entries, pending_slot)
        return jsonify(result)
    except Exception:
        return jsonify({'answered': False, 'message': None})


# Full Automation, Admin-First: the AI Intelligence Layer's one addition for
# this phase — explains a system_exceptions row in plain language for the
# admin resolving it. Same safety contract as narrate/chat above: the AI
# never decides or acts (that's backend/services/AutomationEngine.php's
# job, entirely deterministic) — it only narrates a decision the engine
# already made or is blocked on. Input here is exception metadata only
# (event/entity_type/entity_id/reason/severity) — no decedent/user/payment
# PII is ever included in a system_exceptions row (see
# AutomationEngine::raiseException()), so this doesn't need the same
# pending-slot/correction-signal guards the chat assistant's privacy
# contract requires.
EXPLAIN_EXCEPTION_SYSTEM_PROMPT = (
    "You explain a single system exception to a cemetery-management-system "
    "administrator, in plain language. You are given structured facts only "
    "— event, entity type/id, the reason automation stopped, and severity. "
    "Never invent details beyond them. Write 1-2 short sentences: first, "
    "explain in plain language why the automatic step couldn't proceed; "
    "second, suggest a concrete, general next step (e.g. 'pick a different "
    "lot for this booking' or 'confirm it manually once you've verified "
    "the situation') — never claim to have taken any action yourself. "
    "Output only the message text: no preamble, no markdown, no quotes."
)


def _explain_exception(event: str, entity_type: str, entity_id: Any, reason: str, severity: Optional[str]) -> Optional[str]:
    if _gemini_client is None:
        return None

    facts = {
        'event': event,
        'entity_type': entity_type,
        'entity_id': entity_id,
        'reason': reason,
        'severity': severity or 'warning',
    }

    try:
        response = _gemini_client.models.generate_content(
            model=NARRATION_MODEL,
            contents=json.dumps(facts),
            config=genai_types.GenerateContentConfig(
                system_instruction=EXPLAIN_EXCEPTION_SYSTEM_PROMPT,
                max_output_tokens=512,
                temperature=0.3,
                thinking_config=_THINKING_CONFIG,
                http_options=genai_types.HttpOptions(timeout=_LLM_TIMEOUT_MS),
            ),
        )
        text = (response.text or '').strip()
        return text or None
    except Exception:
        return None


@app.post('/api/explain-exception')
def explain_exception():
    # Always returns 200; explained:false whenever unavailable, so the
    # caller (Exceptions page) just hides the AI explanation and the admin
    # still has the raw reason text to work from.
    try:
        payload = request.get_json(silent=True) or {}
        event = (payload.get('event') or '').strip()
        entity_type = (payload.get('entity_type') or '').strip()
        entity_id = payload.get('entity_id')
        reason = (payload.get('reason') or '').strip()
        severity = payload.get('severity')

        if not event or not entity_type or not reason:
            return jsonify({'explained': False, 'message': None})

        message = _explain_exception(event, entity_type, entity_id, reason, severity)
        return jsonify({'explained': message is not None, 'message': message})
    except Exception:
        return jsonify({'explained': False, 'message': None})


# AI-1 (Audit Intelligence Layer): the lifecycle-explanation counterpart to
# explain_exception() above, same safety contract exactly — the AI never
# queries the database and never decides state, it only narrates facts the
# PHP-side AuditIntelligenceService already assembled (subject/current
# status/related records/timeline/exceptions — see backend/services/
# AuditIntelligenceService.php::toFacts()). That method deliberately strips
# decedent/requester/approver names before this payload is ever built, so
# — like explain-exception — no PII-guarding is needed here beyond that.
EXPLAIN_ENTITY_SYSTEM_PROMPT = (
    "You explain the current status and history of a single cemetery-"
    "management-system record to an administrator, in plain language. You "
    "are given structured facts only: the record's type/id, its current "
    "status, directly related records (type/id/status, never personal "
    "names), a chronological timeline of audit events each tagged 'manual' "
    "or 'automated', and any system exceptions raised against it. Never "
    "invent details beyond them, and never invent or use any person's name "
    "— none are given to you. "
    "Each timeline entry has a state_change_known flag. When it is true, the "
    "entry also carries an explicit state_change {field, from, to} — you may "
    "state that exact transition. When state_change_known is false (this is "
    "true for EVERY automated entry, always), the record's underlying audit "
    "log does not capture what value, if any, changed at that moment — "
    "describe that entry ONLY as an event that occurred (e.g. 'an automated "
    "step ran for Lot 2 following payment verification'), and NEVER state or "
    "imply what status the record was, or became, as a result of it. The "
    "action name of such an entry (e.g. 'schedule.completed') identifies "
    "which automated step ran, not a status value — never quote it as if it "
    "were one. The only status values you may ever state for any record are: "
    "its current_status, a related record's status field, or a timeline "
    "entry's explicit state_change — never a value inferred from an action "
    "name or from what 'probably' happened. "
    "Write 2-4 short sentences: summarize what has happened and why the "
    "record is in its current state, explicitly distinguishing manual "
    "actions from automated ones when relevant, and mention any open "
    "exception blocking further progress. Never claim to have taken any "
    "action yourself, and never assert anything about the record beyond "
    "what the given facts state. Output only the message text: no preamble, "
    "no markdown, no quotes."
)


def _explain_entity(facts: Dict[str, Any]) -> Optional[str]:
    if _gemini_client is None:
        return None

    try:
        response = _gemini_client.models.generate_content(
            model=NARRATION_MODEL,
            contents=json.dumps(facts),
            config=genai_types.GenerateContentConfig(
                system_instruction=EXPLAIN_ENTITY_SYSTEM_PROMPT,
                max_output_tokens=512,
                temperature=0.3,
                thinking_config=_THINKING_CONFIG,
                http_options=genai_types.HttpOptions(timeout=_LLM_TIMEOUT_MS),
            ),
        )
        text = (response.text or '').strip()
        return text or None
    except Exception:
        return None


@app.post('/api/explain-entity')
def explain_entity():
    # Always returns 200; explained:false whenever unavailable, so the
    # caller just falls back to showing the raw structured context instead
    # of an AI narration.
    try:
        payload = request.get_json(silent=True) or {}
        subject = payload.get('subject')

        if not isinstance(subject, dict) or not subject.get('type') or not subject.get('id'):
            return jsonify({'explained': False, 'message': None})

        message = _explain_entity(payload)
        return jsonify({'explained': message is not None, 'message': message})
    except Exception:
        return jsonify({'explained': False, 'message': None})


# AI-2 Round 2: the proactive "second admin" dashboard digest. Same safety
# contract as explain_exception()/explain_entity() above — narrates a
# system-wide fact bundle (backend/services/AuditIntelligenceService.php::
# buildDashboardFacts(): open-exception counts by entity type, the oldest
# still-open one, a recent automated-vs-manual activity split, and a lease-
# expiration count), never queries anything itself, never invents a fact
# beyond what it's given. The difference from explain-entity is WHEN it
# runs: on dashboard load, before the admin has picked anything to inspect,
# which is what makes this a proactive briefing rather than an on-demand
# explanation.
DASHBOARD_DIGEST_SYSTEM_PROMPT = (
    "You are writing a short daily briefing for a cemetery-management-"
    "system administrator, based only on structured facts: how many system "
    "exceptions are currently open (broken down by the type of record "
    "they're on), the single oldest one still waiting, how many actions "
    "were completed automatically vs. manually in the last 7 days, and how "
    "many lot leases expire within 30 days. Never invent a number, a name, "
    "or a fact beyond what is given — you have no other information about "
    "this system. Write 2-4 short sentences: lead with what needs the "
    "admin's attention right now (if open_exceptions.total is 0, say "
    "plainly that nothing needs attention instead of inventing a concern); "
    "mention the automated-vs-manual split only if it's informative (e.g. "
    "automation is clearly carrying most of the load, or manual actions "
    "dominate); mention expiring leases only if the count is greater than "
    "zero. Never claim to have taken any action yourself. Output only the "
    "message text: no preamble, no markdown, no quotes."
)


def _dashboard_digest(facts: Dict[str, Any]) -> Optional[str]:
    if _gemini_client is None:
        return None

    try:
        response = _gemini_client.models.generate_content(
            model=NARRATION_MODEL,
            contents=json.dumps(facts),
            config=genai_types.GenerateContentConfig(
                system_instruction=DASHBOARD_DIGEST_SYSTEM_PROMPT,
                max_output_tokens=512,
                temperature=0.3,
                thinking_config=_THINKING_CONFIG,
                http_options=genai_types.HttpOptions(timeout=_LLM_TIMEOUT_MS),
            ),
        )
        text = (response.text or '').strip()
        return text or None
    except Exception:
        return None


@app.post('/api/dashboard-digest')
def dashboard_digest():
    # Always returns 200; explained:false whenever unavailable, so the
    # dashboard just hides the AI Briefing panel and falls back to the
    # existing Needs Attention exceptions card alone.
    try:
        payload = request.get_json(silent=True) or {}
        if not isinstance(payload, dict) or 'open_exceptions' not in payload:
            return jsonify({'explained': False, 'message': None})

        message = _dashboard_digest(payload)
        return jsonify({'explained': message is not None, 'message': message})
    except Exception:
        return jsonify({'explained': False, 'message': None})


# System-Wide AI Assistant: free-form follow-up questions, the broader
# counterpart to explain-entity/explain-exception/dashboard-digest above.
# Same safety contract (never queries anything itself, never invents a fact
# beyond what's given, never claims to act) but two differences: (1) it
# answers an arbitrary admin question instead of narrating one fixed shape,
# and (2) it may propose ONE concrete suggested_action — still only ever a
# suggestion, the admin or AutomationEngine is the one who acts.
# `context` is always {focus, system_wide} (AiController::askAssistant()):
# focus is whichever record/module the admin is currently looking at,
# system_wide (AuditIntelligenceService::buildSystemWideReach()) is every
# module's recent state + open exceptions, attached to EVERY call regardless
# of where the admin asked from — so "what's expiring next week" is
# answerable even from the Relocation page, not just Expiration Monitoring.
ASSISTANT_MODEL = 'gemini-3.6-flash'

ASSISTANT_SYSTEM_PROMPT = (
    "You are an AI assistant helping a cemetery-management-system "
    "administrator understand and troubleshoot the system. You are given "
    "structured facts only — never invent a name, a number, or a fact "
    "beyond what is provided. The facts are given as {focus, system_wide}: "
    "focus is whatever specific record or module the admin is currently "
    "looking at; system_wide covers every module's recent records and open "
    "exceptions across the ENTIRE system, always included. The admin's "
    "question is not limited to focus — answer using whichever of the two "
    "actually contains the answer (e.g. a question about expiring leases "
    "asked while looking at a Relocation record should be answered from "
    "system_wide.modules.Expiration, not refused just because it's not the "
    "current focus). Use conversation_history (if given) to understand a "
    "follow-up question in context. When it is clearly relevant, end with "
    "ONE concrete suggested next step (e.g. 'resolve the open exception on "
    "Schedule #12' or 'check whether Lot A2-02 was reserved by another "
    "transaction'). Never claim to have taken any action yourself — you can "
    "only explain and suggest; the admin, or the system's own automation, "
    "is what actually acts. If neither focus nor system_wide genuinely "
    "covers the question, say so plainly instead of guessing.\n\n"
    "Output ONLY a compact JSON object — no markdown, no code fences, no "
    "prose outside the JSON.\n"
    "Schema: {\"answered\": boolean, \"message\": string|null, "
    "\"suggested_action\": string|null}\n"
    "- answered=false (message=null, suggested_action=null) only when "
    "neither focus nor system_wide covers the question.\n"
    "- suggested_action: a short, specific, actionable next step, or null "
    "if there is not a clear one (e.g. the admin asked a purely "
    "informational question with nothing to act on)."
)


def _ask_assistant(context: Dict[str, Any], question: str, conversation_history: Optional[List[Dict[str, Any]]]):
    if _gemini_client is None:
        return None, None

    payload = {
        'context': context,
        'question': question,
        'conversation_history': conversation_history or [],
    }

    try:
        response = _gemini_client.models.generate_content(
            model=ASSISTANT_MODEL,
            contents=json.dumps(payload),
            config=genai_types.GenerateContentConfig(
                system_instruction=ASSISTANT_SYSTEM_PROMPT,
                max_output_tokens=768,
                temperature=0.3,
                response_mime_type='application/json',
                thinking_config=_THINKING_CONFIG,
                http_options=genai_types.HttpOptions(timeout=_LLM_TIMEOUT_MS),
            ),
        )
        text = (response.text or '').strip()
        parsed = json.loads(_strip_json_fences(text))
        if not isinstance(parsed, dict):
            return None, None
        if not parsed.get('answered') or not isinstance(parsed.get('message'), str) or not parsed['message'].strip():
            return None, None
        suggested = parsed.get('suggested_action')
        suggested = suggested.strip() if isinstance(suggested, str) and suggested.strip() else None
        return parsed['message'].strip(), suggested
    except Exception:
        return None, None


@app.post('/api/assistant-ask')
def assistant_ask():
    # Always returns 200; answered:false whenever unavailable, so the
    # widget just shows "AI is unavailable right now" and the admin can
    # still work from the raw facts already shown in the page.
    try:
        payload = request.get_json(silent=True) or {}
        context = payload.get('context')
        question = (payload.get('question') or '').strip()
        conversation_history = payload.get('conversation_history')

        if not isinstance(context, dict) or not context or not question:
            return jsonify({'answered': False, 'message': None, 'suggested_action': None})

        message, suggested_action = _ask_assistant(context, question, conversation_history)
        return jsonify({
            'answered': message is not None,
            'message': message,
            'suggested_action': suggested_action,
        })
    except Exception:
        return jsonify({'answered': False, 'message': None, 'suggested_action': None})


def _get_capacity_snapshot() -> Dict[str, int]:
    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Occupied' THEN 1 ELSE 0 END) AS occupied
            FROM lots
            """
        )
        row = cursor.fetchone() or {}
        cursor.close()
        conn.close()
    except Exception:
        row = {}
    total = int(row.get('total') or 0)
    occupied = int(row.get('occupied') or 0)
    return {'total': total, 'occupied': occupied, 'available': max(0, total - occupied)}


def _get_reclaimable_by_month(months: int) -> Dict[str, int]:
    try:
        conn = get_connection()
        cursor = conn.cursor(dictionary=True)
        cursor.execute(
            """
            SELECT DATE_FORMAT(end_date, '%%Y-%%m') AS month, COUNT(*) AS reclaimable
            FROM expiration_records
            WHERE renewed = 'no'
              AND end_date >= CURDATE()
              AND end_date <= DATE_ADD(CURDATE(), INTERVAL %s MONTH)
            GROUP BY month
            """,
            (months,),
        )
        rows = cursor.fetchall()
        cursor.close()
        conn.close()
    except Exception:
        rows = []
    return {row['month']: int(row['reclaimable']) for row in rows if row.get('month')}


@app.get('/api/forecast')
def forecast_burials():
    try:
        months = max(1, min(24, int(request.args.get('months', 6) or 6)))
        try:
            conn = get_connection()
            cursor = conn.cursor(dictionary=True)
            cursor.execute(
                """
                SELECT DATE_FORMAT(schedule_date, '%Y-%m') AS month, COUNT(*) AS burials
                FROM burial_schedules
                WHERE status IN ('Confirmed', 'Completed')
                  AND schedule_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
                GROUP BY DATE_FORMAT(schedule_date, '%Y-%m')
                ORDER BY month ASC
                """
            )
            raw_rows = cursor.fetchall()
            cursor.close()
            conn.close()
        except Exception:
            raw_rows = []

        if raw_rows:
            monthly_series = []
            end_date = datetime.now().replace(day=1)
            for offset in range(23, -1, -1):
                month_date = (end_date - timedelta(days=30 * offset)).replace(day=1)
                label = month_date.strftime('%Y-%m')
                monthly_series.append((label, 0))
            monthly_map = {row['month']: int(row['burials']) for row in raw_rows if row.get('month')}
            monthly_series = [(label, monthly_map.get(label, 0)) for label, _ in monthly_series]
        else:
            monthly_series = []

        if len(monthly_series) >= 5:
            series = pd.Series([value for _, value in monthly_series], dtype=float)
            history = [
                {'month': label, 'burials': int(value)}
                for label, value in monthly_series
            ]
            forecast_values = _fit_arima_forecast(series, months)
            if forecast_values is None:
                forecast_values = _moving_average_forecast([item['burials'] for item in history], months)
            forecast_payload = []
            cumulative = 0
            for index, value in enumerate(forecast_values):
                cumulative += int(value)
                forecast_payload.append({
                    'month': (datetime.now().replace(day=1) + timedelta(days=30 * (index + 1))).strftime('%Y-%m'),
                    'predicted_burials': int(value),
                    'cumulative': cumulative,
                })
        else:
            history = [
                {'month': label, 'burials': int(value)}
                for label, value in monthly_series
            ]
            forecast_values = _moving_average_forecast([item['burials'] for item in history], months)
            forecast_payload = []
            cumulative = 0
            for index, value in enumerate(forecast_values):
                cumulative += int(value)
                forecast_payload.append({
                    'month': (datetime.now().replace(day=1) + timedelta(days=30 * (index + 1))).strftime('%Y-%m'),
                    'predicted_burials': int(value),
                    'cumulative': cumulative,
                })

        if not history:
            history = []

        trend = 'stable'
        if len(history) >= 2:
            first_value = history[0]['burials']
            last_value = history[-1]['burials']
            if last_value > first_value:
                trend = 'increasing'
            elif last_value < first_value:
                trend = 'decreasing'

        capacity = _get_capacity_snapshot()
        reclaimable_by_month = _get_reclaimable_by_month(months)
        total_capacity = capacity['total']
        cumulative_reclaimed = 0
        capacity_alert = None
        for entry in forecast_payload:
            reclaimable = reclaimable_by_month.get(entry['month'], 0)
            cumulative_reclaimed += reclaimable
            projected_occupied = capacity['occupied'] + entry['cumulative'] - cumulative_reclaimed
            if total_capacity:
                projected_occupied = max(0, min(total_capacity, projected_occupied))
                occupancy_rate = projected_occupied / total_capacity
            else:
                projected_occupied = max(0, projected_occupied)
                occupancy_rate = 0.0
            projected_available = max(0, total_capacity - projected_occupied)

            if occupancy_rate >= CAPACITY_CRITICAL_THRESHOLD:
                capacity_status = 'critical'
            elif occupancy_rate >= CAPACITY_WARNING_THRESHOLD:
                capacity_status = 'warning'
            else:
                capacity_status = 'ok'
            if capacity_status != 'ok' and capacity_alert is None:
                capacity_alert = {
                    'month': entry['month'],
                    'status': capacity_status,
                    'occupancy_rate': round(occupancy_rate, 4),
                }

            entry['reclaimable'] = reclaimable
            entry['projected_occupied'] = projected_occupied
            entry['projected_available'] = projected_available
            entry['occupancy_rate'] = round(occupancy_rate, 4)
            entry['capacity_status'] = capacity_status

        return jsonify({
            'historical': history,
            'forecast': forecast_payload,
            'trend': trend,
            'model': 'arima' if len(monthly_series) >= 5 else 'moving_average',
            'capacity': capacity,
            'capacity_alert': capacity_alert,
        })
    except Exception as exc:  # pragma: no cover - defensive path
        return jsonify({'error': str(exc), 'code': 500}), 500


def _fit_arima_forecast(series: pd.Series, months: int) -> Optional[List[float]]:
    if len(series) < 6:
        return None

    best_result = None
    best_aic = None
    for p in range(3):
        for d in range(3):
            for q in range(3):
                try:
                    model = ARIMA(series, order=(p, d, q), enforce_stationarity=False, enforce_invertibility=False)
                    fitted = model.fit()
                    aic = float(fitted.aic)
                    if best_aic is None or aic < best_aic:
                        best_aic = aic
                        best_result = fitted
                except Exception:
                    continue

    if best_result is None:
        return None

    forecast = best_result.forecast(steps=months)
    return [max(0.0, float(value)) for value in forecast]


def _moving_average_forecast(values: List[int], months: int) -> List[float]:
    if not values:
        return [0.0] * months
    window = min(6, len(values))
    recent_average = sum(values[-window:]) / window
    return [max(0.0, round(recent_average, 2)) for _ in range(months)]


if __name__ == '__main__':
    port = int(os.getenv('PORT', '5000'))
    app.run(host='0.0.0.0', port=port, debug=False)
