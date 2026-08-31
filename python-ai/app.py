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
from sklearn.metrics.pairwise import cosine_similarity
from statsmodels.tsa.arima.model import ARIMA

import llm_provider

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
# than a paid provider — the remaining LLM features below (extract/chat/
# explain-exception/explain-entity/assistant-ask) share one provider/timeout
# convention (see llm_provider.py) so they can't drift onto different
# providers independently.
# Quota-reduction batch: narrate and dashboard-digest below no longer call
# Gemini at all (deterministic generation instead) — NARRATION_MODEL is
# kept as a plain constant only because explain_exception()/explain_entity()
# further down still reference it.
# Batch 4: all Gemini-SDK specifics (client init, API key, ThinkingConfig,
# GenerateContentConfig, HttpOptions, response text extraction) now live
# behind llm_provider.generate() — this file only ever passes plain model
# name strings/prompts/timeouts into that call, never a Gemini SDK object.
NARRATION_MODEL = 'gemini-3.6-flash'

def _plural(count: int, word: str) -> str:
    return word if count == 1 else f'{word}s'


# Quota-reduction batch: deterministic replacement for the former Gemini
# rephrasing call (the removed NARRATION_SYSTEM_PROMPT). Mirrors the exact
# same per-status rules that prompt enforced — grounded only in the given
# facts, never inventing lot numbers/prices/dates/decedent data — and the
# same preferences_set-driven suggestion logic already used by the
# frontend's own deterministic fallback (buildDeterministicOutcomeMessage()
# in assets/js/shared/lot-chat-assistant.js), so both paths read alike.
# Always returns a message now (never None) since there's no external call
# left that can fail; narrate_outcome() below only ever calls this for the
# three statuses it already validates.
def _narrate_outcome(status: str, count: Optional[int], preferences: Dict[str, Any]) -> str:
    if status == 'success':
        count = count or 0
        verb = 'matches' if count == 1 else 'match'
        return f'I found {count} available {_plural(count, "lot")} that {verb} your preferences. Take a look below.'

    if status == 'empty':
        preferences_set = {
            key: value for key, value in (preferences or {}).items()
            if value not in (None, '')
        }
        suggestions: List[str] = []
        if preferences_set.get('lot_type'):
            suggestions.append('choosing a different lot type')
        if preferences_set.get('budget'):
            suggestions.append('increasing your budget')
        if preferences_set.get('section'):
            suggestions.append('selecting another section')
        message = "I couldn't find an available lot matching your current preferences."
        if suggestions:
            message += f" You could try {' or '.join(suggestions)}."
        return message

    # status == 'error' — the only value narrate_outcome() still passes through.
    return "The recommendation service is temporarily unavailable. Available lots are shown below so you can browse manually."


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
    if not message:
        return None

    payload = {
        'message': message,
        'valid_lot_types': lot_types,
        'valid_sections': sections,
        'pending_slot': pending_slot,
    }

    text = llm_provider.generate(
        system_prompt=EXTRACTION_SYSTEM_PROMPT,
        user_content=json.dumps(payload),
        model=EXTRACTION_MODEL,
        json_mode=True,
        temperature=0,
        max_output_tokens=1024,
    )
    if text is None:
        return None

    try:
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
    if not message or not knowledge_entries:
        return empty

    payload = {
        'message': message,
        'pending_slot': pending_slot,
        'knowledge_entries': knowledge_entries,
    }

    text = llm_provider.generate(
        system_prompt=CHAT_SYSTEM_PROMPT,
        user_content=json.dumps(payload),
        model=CHAT_MODEL,
        json_mode=True,
        temperature=0,
        max_output_tokens=1024,
    )
    if text is None:
        return empty

    try:
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
    # Deterministic since the quota-reduction batch (see _narrate_outcome);
    # 'message' is null only when status isn't one of the three recognized
    # values, so callers still have their own deterministic text to fall
    # back on in that case.
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
    facts = {
        'event': event,
        'entity_type': entity_type,
        'entity_id': entity_id,
        'reason': reason,
        'severity': severity or 'warning',
    }

    return llm_provider.generate(
        system_prompt=EXPLAIN_EXCEPTION_SYSTEM_PROMPT,
        user_content=json.dumps(facts),
        model=NARRATION_MODEL,
        temperature=0.3,
        max_output_tokens=512,
    )


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
    return llm_provider.generate(
        system_prompt=EXPLAIN_ENTITY_SYSTEM_PROMPT,
        user_content=json.dumps(facts),
        model=NARRATION_MODEL,
        temperature=0.3,
        max_output_tokens=512,
    )


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
# Quota-reduction batch: deterministic replacement for the former Gemini
# rephrasing call (the removed DASHBOARD_DIGEST_SYSTEM_PROMPT). Mirrors the
# exact same per-field rules that prompt enforced — lead with open
# exceptions (or state plainly that nothing needs attention when there are
# none), mention the automated/manual split only when one side is clearly
# carrying the load, and mention expiring leases only when there are any.
# Never invents a number/name/fact beyond what `facts` already contains.
# Always returns a message now (never None) since there's no external call
# left that can fail; dashboard_digest() below only ever calls this once
# the payload shape is already validated.
def _dashboard_digest(facts: Dict[str, Any]) -> str:
    open_exceptions = facts.get('open_exceptions') or {}
    total_open = int(open_exceptions.get('total') or 0)
    oldest_open = open_exceptions.get('oldest_open')

    sentences: List[str] = []

    if total_open == 0:
        sentences.append('Nothing needs your attention right now — no exceptions are currently open.')
    else:
        verb = 'needs' if total_open == 1 else 'need'
        sentence = f'{total_open} open {_plural(total_open, "exception")} {verb} your attention.'
        if isinstance(oldest_open, dict) and oldest_open.get('entity_type'):
            reason = oldest_open.get('reason')
            sentence += f' The oldest is on a {oldest_open["entity_type"]} record' + (f': {reason}.' if reason else '.')
        sentences.append(sentence)

    recent_activity = facts.get('recent_activity') or {}
    automated = int(recent_activity.get('automated_actions') or 0)
    manual = int(recent_activity.get('manual_actions') or 0)
    window_days = recent_activity.get('window_days') or 7
    total_actions = automated + manual
    if total_actions > 0:
        automated_share = automated / total_actions
        if automated_share >= 0.75:
            sentences.append(f'Automation handled most recent activity: {automated} of {total_actions} actions in the last {window_days} days.')
        elif automated_share <= 0.25:
            sentences.append(f'Most recent activity was handled manually: {manual} of {total_actions} actions in the last {window_days} days.')

    leases_expiring = int(facts.get('leases_expiring_within_30_days') or 0)
    if leases_expiring > 0:
        expire_verb = 'expires' if leases_expiring == 1 else 'expire'
        sentences.append(f'{leases_expiring} lot {_plural(leases_expiring, "lease")} {expire_verb} within 30 days.')

    return ' '.join(sentences)


@app.post('/api/dashboard-digest')
def dashboard_digest():
    # Deterministic since the quota-reduction batch (see _dashboard_digest);
    # explained:false only when the payload is missing/malformed, in which
    # case the dashboard still hides the AI Briefing panel and falls back
    # to the existing Needs Attention exceptions card alone.
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
# focus is whichever record/module the admin is currently looking at, and
# is always present. Quota-reduction batch (Batch 3): system_wide
# (AuditIntelligenceService::buildSystemWideReach(), now a compact
# counts/statuses summary per module rather than each module's full recent
# records) is only built for scope=system requests — entity/module requests
# send null here, on purpose, so a record view never drags in unrelated
# modules. See ASSISTANT_SYSTEM_PROMPT below for how the model is told
# this.
ASSISTANT_MODEL = 'gemini-3.6-flash'

ASSISTANT_SYSTEM_PROMPT = (
    "You are an AI assistant helping a cemetery-management-system "
    "administrator understand and troubleshoot the system. You are given "
    "structured facts only — never invent a name, a number, or a fact "
    "beyond what is provided. The facts are given as {focus, system_wide}: "
    "focus is whatever specific record or module the admin is currently "
    "looking at, and is always present. system_wide, when present, is a "
    "compact summary (counts and statuses per module, plus dashboard-level "
    "totals) — never full records — covering the rest of the system beyond "
    "focus; it is only included for genuinely system-wide questions, so for "
    "a question about one specific record or module, system_wide will be "
    "null and focus is the only information you have. Never claim "
    "knowledge of a module, record, or number that is not present in focus "
    "or system_wide for THIS call — if system_wide is null and the "
    "question is really about a different record or module than focus, say "
    "so plainly (e.g. 'I don't have visibility into that from here') "
    "instead of guessing or inventing an answer. Use conversation_history "
    "(if given) to understand a follow-up question in context. When it is "
    "clearly relevant, end with "
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
    payload = {
        'context': context,
        'question': question,
        'conversation_history': conversation_history or [],
    }

    text = llm_provider.generate(
        system_prompt=ASSISTANT_SYSTEM_PROMPT,
        user_content=json.dumps(payload),
        model=ASSISTANT_MODEL,
        json_mode=True,
        temperature=0.3,
        max_output_tokens=768,
    )
    if text is None:
        return None, None

    try:
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
