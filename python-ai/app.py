import base64
import json
import logging
import os
import math
import re
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

# Batch 10 (Batch 9 audit finding): llm_provider._log_attempt()'s
# provider-attempt metadata logging existed structurally since Batch 6 but
# had no handler attached anywhere in the real service — logging.info()
# calls were silently dropped by Python's default "handler of last
# resort" (WARNING+ only), confirmed empirically in the Batch 9 audit.
# basicConfig() is a documented no-op if the root logger already has a
# handler, so this is safe against duplicate handlers on its own; the
# `if not logging.getLogger().handlers` guard below makes that intent
# explicit rather than relying on it silently. Root stays at WARNING so
# third-party libraries (httpx, google_genai) don't flood output with
# their own INFO-level chatter — only the 'llm_provider' logger itself is
# raised to INFO, which is the only logger this project's own code writes
# through, keeping the change surgical.
if not logging.getLogger().handlers:
    logging.basicConfig(level=logging.WARNING, format='%(asctime)s %(name)s %(levelname)s: %(message)s')
logging.getLogger('llm_provider').setLevel(logging.INFO)

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

# BATCH AI-6 (AI Architecture Audit, 2026-09-02): this service uses two
# DIFFERENT, deliberate data-access patterns — documented here once, rather
# than left as a silent inconsistency between them (the audit's own
# finding). Both are equally safe for the same reason: every query below is
# fixed and parameterized, in this file's own code, never assembled from LLM
# output or raw user text — there is no SQL-injection-via-prompt surface in
# either pattern.
#
# Pattern 1 — narrate/explain family (chat_answer, explain_exception,
# explain_entity, dashboard_digest, assistant_ask): NEVER touches MySQL.
# AiController.php's own PHP models read the database and hand this service
# an already-assembled, name-stripped fact bundle; the LLM only narrates or
# answers questions from those facts. This is the pattern the original audit
# was checking for, and it's followed exactly here.
#
# Pattern 2 — recommend_lots/recommend_lot_type/forecast_burials (get_connection()
# below): queries MySQL directly, via this file's own DB_CONFIG. Kept as a
# deliberate exception rather than migrated to Pattern 1: these are
# compute-heavy, dataset-wide operations (cosine-similarity ranking over
# every available lot; ARIMA/moving-average projection over months of
# schedule history) that need the full rows to do their own math in Python
# (numpy/pandas/sklearn/statsmodels) — not a case of "narrate this one
# fact bundle." Routing that dataset through PHP first would mean
# serializing every available lot (or the full schedule history) into a
# single JSON HTTP payload on every hot-path recommendation/forecast call,
# for no correctness or security benefit — the queries are exactly as fixed
# and parameterized as anything Pattern 1's PHP models would run. The real
# cost of this pattern is operational, not architectural: it duplicates
# "what counts as an available lot" between this file and the PHP Lot model,
# and needs its own DB credentials in python-ai/.env alongside the PHP
# backend's — both acceptable for a project this size, not for a
# larger one.

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
    "generic knowledge_entries content.\n"
    "- BATCH AI-5: you may also be given conversation_history — prior "
    "question/message pairs from this same FAQ exchange only (never booking-"
    "slot data). Use it only to understand a follow-up question in context "
    "(e.g. 'what about after that?'); it does not change what counts as "
    "'covered by knowledge_entries' above.\n"
    "- BATCH AI-3 follow-up (found during manual testing): you may also be "
    "given already_resolved_something=true. This means the caller ALREADY "
    "successfully parsed a slot value (or another booking detail) out of "
    "this exact message, separately from this call — e.g. the message was "
    "'Premium Lot, and what happens after I book?' and 'Premium Lot' was "
    "already resolved before you ever saw it. In that case, do NOT apply "
    "the 'looks like a pending-slot answer, prefer answered=false' rule "
    "above — that rule exists for the OPPOSITE case (already_resolved_"
    "something=false), where nothing was resolved and an ambiguous message "
    "might just be a bad attempt at the slot. When already_resolved_"
    "something=true, judge only whether the message ALSO contains a "
    "distinct, genuine question in addition to the value already resolved, "
    "and answer it normally if knowledge_entries covers it."
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


def _answer_question(
    message: str,
    knowledge_entries: List[Dict[str, str]],
    pending_slot: Optional[str],
    conversation_history: Optional[List[Dict[str, Any]]] = None,
    already_resolved_something: bool = False,
) -> Dict[str, Any]:
    empty = {'answered': False, 'message': None}
    if not message or not knowledge_entries:
        return empty

    payload = {
        'message': message,
        'pending_slot': pending_slot,
        'knowledge_entries': knowledge_entries,
        'conversation_history': conversation_history or [],
        'already_resolved_something': bool(already_resolved_something),
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
    # Queries the centralized v_available_lots view (migration_20260905_add_available_lots_view.sql)
    # to eliminate lot-availability join logic duplication across PHP and Python.
    cursor.execute(
        """
        SELECT lot_id, lot_number, price, status,
               lot_type_name,
               section_name
        FROM v_available_lots
        ORDER BY section_name, block_name, lot_number
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


# Decedent Records module audit, Batch I: same shape as _extract_preferences
# above (fixed schema, temperature 0, JSON-mode, "never invent a fact the
# message doesn't state"), for a different domain — a citizen describing, in
# free text, a deceased person not yet in the cemetery's records, called by
# the chat assistant's decedent-request form (lot-chat-assistant.js's
# appendDecedentRequestForm()) as an alternative to typing into the three
# separate fields directly. The extracted fields only PRE-FILL those same
# fields — the citizen still sees and can edit them, and still clicks
# Continue booking themselves; this never submits anything on its own.
DECEDENT_REQUEST_EXTRACTION_MODEL = 'gemini-3.6-flash'

DECEDENT_REQUEST_EXTRACTION_SYSTEM_PROMPT = (
    "You extract information about a deceased person from one short piece "
    "of free text, for a cemetery's citizen-facing intake form. The citizen "
    "is describing someone not yet in the cemetery's records so staff can "
    "review and register them. Output ONLY a compact JSON object — no "
    "markdown, no code fences, no prose, no explanation.\n\n"
    "Schema: {\"full_name\": string|null, \"approximate_dod\": string|null, "
    "\"relationship\": string|null, \"notes\": string|null}\n\n"
    "Rules:\n"
    "- full_name is the deceased person's name as stated. Never invent a "
    "name, and never mistake the speaker's own name for the deceased's.\n"
    "- approximate_dod is a date in strict YYYY-MM-DD format, only when the "
    "message states or clearly implies one specific date (e.g. \"last "
    "March 3\", \"March 3, 2020\", \"2020-03-03\"). If only a vague "
    "timeframe is given (e.g. \"a few years ago\", \"last year\") or no "
    "date at all, leave this null — never guess a specific day.\n"
    "- relationship is how the speaker is related to the deceased (e.g. "
    "\"son\", \"daughter\", \"spouse\", \"friend\"), only when clearly "
    "stated. Otherwise null.\n"
    "- notes is any other relevant detail mentioned that doesn't fit the "
    "other fields (e.g. approximate age, cause of death, prior burial "
    "location) as a short plain-text summary, or null if nothing else was "
    "said.\n"
    "- Only extract what this message actually states. Never invent facts "
    "beyond the message text. If the message doesn't clearly name a "
    "deceased person at all, return full_name as null."
)


def _extract_decedent_request(message: str) -> Optional[Dict[str, Any]]:
    if not message:
        return None

    text = llm_provider.generate(
        system_prompt=DECEDENT_REQUEST_EXTRACTION_SYSTEM_PROMPT,
        user_content=json.dumps({'message': message}),
        model=DECEDENT_REQUEST_EXTRACTION_MODEL,
        json_mode=True,
        temperature=0,
        max_output_tokens=512,
    )
    if text is None:
        return None

    try:
        parsed = json.loads(_strip_json_fences(text))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


@app.post('/api/extract-decedent-request')
def extract_decedent_request():
    # Always returns 200; 'result' is null whenever extraction isn't
    # available/didn't parse, so the caller falls back to the plain
    # structured fields it already shows (full_name/approximate_dod/
    # relationship inputs in appendDecedentRequestForm()).
    try:
        payload = request.get_json(silent=True) or {}
        message = (payload.get('message') or '').strip()

        if not message:
            return jsonify({'result': None})

        result = _extract_decedent_request(message)
        if not result:
            return jsonify({'result': None})

        # Never trust the model's strings verbatim, same discipline as
        # extract_preferences() above.
        full_name = result.get('full_name')
        full_name = full_name.strip() if isinstance(full_name, str) else ''
        result['full_name'] = full_name or None

        dod = result.get('approximate_dod')
        parsed_dod = None
        if isinstance(dod, str):
            try:
                candidate = datetime.strptime(dod.strip(), '%Y-%m-%d').date()
                # Never a future date — mirrors appendDecedentRequestForm()'s
                # own <input type="date" max="today"> constraint on this field.
                if candidate <= datetime.now().date():
                    parsed_dod = candidate.isoformat()
            except ValueError:
                parsed_dod = None
        result['approximate_dod'] = parsed_dod

        for field in ('relationship', 'notes'):
            value = result.get(field)
            result[field] = value.strip()[:255] if isinstance(value, str) and value.strip() else None

        return jsonify({'result': result})
    except Exception:
        return jsonify({'result': None})


# Decedent Records module audit, Batch K: the one caller of llm_provider's
# new image_bytes/image_mime_type support (see that module's own comment) —
# reads a staff-uploaded death certificate/burial permit image/PDF and
# extracts the SAME fields the Add Decedent Record form's own inputs use.
# Same safety contract as every other extractor in this file: fixed schema,
# temperature 0, JSON-mode, "never invent what you can't actually read" —
# plus here specifically, never guess an illegible/missing date. The
# extracted fields only ever PRE-FILL the Add form; staff still reviews and
# clicks Save themselves, and the document itself is attached to the record
# by the PHP side only after that Save succeeds — this endpoint never writes
# anything anywhere, it only reads an image and returns text.
CERTIFICATE_EXTRACTION_MODEL = 'gemini-3.6-flash'

CERTIFICATE_EXTRACTION_SYSTEM_PROMPT = (
    "You extract information from an image or PDF of a death certificate or "
    "burial permit, for a cemetery staff intake form. Output ONLY a compact "
    "JSON object — no markdown, no code fences, no prose, no explanation.\n\n"
    "Schema: {\"first_name\": string|null, \"last_name\": string|null, "
    "\"middle_name\": string|null, \"suffix\": string|null, "
    "\"dob\": string|null, \"dod\": string|null, \"cause_of_death\": string|null}\n\n"
    "Rules:\n"
    "- first_name/last_name/middle_name/suffix are the deceased person's "
    "name as printed on the document, split into parts. suffix is only a "
    "generational suffix (Jr., Sr., III, etc.), never a title or honorific.\n"
    "- dob and dod are dates in strict YYYY-MM-DD format, only when the "
    "document clearly and legibly states them. If a date is illegible, "
    "partially printed, ambiguous, or simply not present, leave it null — "
    "never guess a date you cannot actually read.\n"
    "- cause_of_death is the cause as printed, or null if not stated or not "
    "legible.\n"
    "- Only extract what is actually printed and legible on the document "
    "itself. Never invent, infer, or complete a value you cannot read."
)


def _extract_certificate(image_bytes: bytes, mime_type: str) -> Optional[Dict[str, Any]]:
    text = llm_provider.generate(
        system_prompt=CERTIFICATE_EXTRACTION_SYSTEM_PROMPT,
        user_content='Extract the fields from this document.',
        model=CERTIFICATE_EXTRACTION_MODEL,
        json_mode=True,
        temperature=0,
        max_output_tokens=512,
        image_bytes=image_bytes,
        image_mime_type=mime_type,
    )
    if text is None:
        return None

    try:
        parsed = json.loads(_strip_json_fences(text))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


@app.post('/api/extract-certificate')
def extract_certificate():
    # Always returns 200; 'result' is null whenever extraction isn't
    # available/didn't parse, so the caller falls back to a blank/manually-
    # filled form — this never blocks record creation.
    try:
        payload = request.get_json(silent=True) or {}
        image_b64 = payload.get('image_base64')
        mime_type = payload.get('mime_type')

        allowed_mime_types = {'image/jpeg', 'image/png', 'application/pdf'}
        if not image_b64 or mime_type not in allowed_mime_types:
            return jsonify({'result': None})

        try:
            image_bytes = base64.b64decode(image_b64, validate=True)
        except Exception:
            return jsonify({'result': None})

        # Defense in depth — mirrors DecedentDocumentController's own 10MB
        # cap on the PHP side, which is the only real caller of this endpoint.
        if len(image_bytes) > 10 * 1024 * 1024:
            return jsonify({'result': None})

        result = _extract_certificate(image_bytes, mime_type)
        if not result:
            return jsonify({'result': None})

        # Never trust the model's strings verbatim, same discipline as
        # every other extractor above.
        for field in ('first_name', 'last_name', 'middle_name', 'suffix', 'cause_of_death'):
            value = result.get(field)
            result[field] = value.strip()[:255] if isinstance(value, str) and value.strip() else None

        for field in ('dob', 'dod'):
            value = result.get(field)
            parsed_value = None
            if isinstance(value, str):
                try:
                    candidate = datetime.strptime(value.strip(), '%Y-%m-%d').date()
                    if candidate <= datetime.now().date():
                        parsed_value = candidate.isoformat()
                except ValueError:
                    parsed_value = None
            result[field] = parsed_value

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
        conversation_history = payload.get('conversation_history')
        already_resolved_something = bool(payload.get('already_resolved_something'))

        if not message:
            return jsonify({'answered': False, 'message': None})

        knowledge_entries = _fetch_knowledge_base()
        result = _answer_question(message, knowledge_entries, pending_slot, conversation_history, already_resolved_something)
        return jsonify(result)
    except Exception:
        return jsonify({'answered': False, 'message': None})


# =========================================================================
# UNIFIED BOOKING AGENT AI LAYER (BMS-5)
# =========================================================================

BOOKING_AGENT_SYSTEM_PROMPT = (
    "You are an empathetic, highly capable AI Booking Agent for a Cemetery Management System.\n"
    "Your goal is to parse citizen messages across the entire booking lifecycle (burial or cremation services), "
    "extract structured slots and booking references, classify citizen intent, and provide a warm, concise response.\n\n"
    "Output strictly a JSON object conforming to this schema (no markdown, no backticks, no prose outside JSON):\n"
    "{\n"
    '  "intent": "CREATE_BOOKING" | "UPDATE_BOOKING" | "CORRECT_BOOKING_DETAILS" | "RESCHEDULE_BOOKING" | "CANCEL_BOOKING" | "CONFIRM_BOOKING" | "CANCEL_DRAFT" | "CHECK_AVAILABILITY" | "EXPLAIN_MISSING_REQUIREMENTS" | "SELECT_ALLOCATION" | "CHANGE_ALLOCATION" | "CHECK_BOOKING_STATUS" | "RESUME_BOOKING" | "PROVIDE_INFORMATION" | "UNCLEAR",\n'
    '  "confidence": 0.95,\n'
    '  "service_type": "burial" | "cremation" | null,\n'
    '  "booking_reference": string | null,\n'
    '  "slots": {\n'
    '    "service_type": "burial" | "cremation" | null,\n'
    '    "decedent_name": string | null,\n'
    '    "relationship": string | null,\n'
    '    "preferred_date": "YYYY-MM-DD" | null,\n'
    '    "cremation_date": "YYYY-MM-DD" | null,\n'
    '    "target_date": "YYYY-MM-DD" | null,\n'
    '    "booking_reference": string | null,\n'
    '    "lot_identifier": string | integer | null,\n'
    '    "lot_id": integer | null,\n'
    '    "section": string | null,\n'
    '    "block": string | null,\n'
    '    "preferred_columbarium": string | null,\n'
    '    "correction_field": string | null,\n'
    '    "corrected_value": string | null,\n'
    '    "notes": string | null\n'
    '  },\n'
    '  "extracted_fields": {\n'
    '    "decedent_name": string | null,\n'
    '    "relationship": string | null,\n'
    '    "preferred_date": "YYYY-MM-DD" | null,\n'
    '    "cremation_date": "YYYY-MM-DD" | null,\n'
    '    "lot_id": integer | null,\n'
    '    "preferred_columbarium": string | null,\n'
    '    "notes": string | null\n'
    '  },\n'
    '  "reply": string\n'
    "}\n\n"
    "Intent Definitions:\n"
    "- CREATE_BOOKING: Citizen wants to start/arrange a new booking.\n"
    "- UPDATE_BOOKING: Citizen wants to update an existing booking.\n"
    "- CORRECT_BOOKING_DETAILS: Citizen modifies or corrects details in draft or booking (e.g. name typo, new preferred date for draft like 'Actually change the preferred date to 2026-11-20').\n"
    "- RESCHEDULE_BOOKING: Citizen wants to change or postpone an existing committed booking's date or time.\n"
    "- CANCEL_BOOKING: Citizen requests to cancel, withdraw, or terminate a booking/reservation.\n"
    "- CONFIRM_BOOKING: Citizen explicitly confirms, agrees, or finalizes booking (e.g. 'Yes, please confirm this booking now', 'Confirm it', 'Looks good, proceed').\n"
    "- CANCEL_DRAFT: Citizen cancels, aborts, or discards the active booking draft.\n"
    "- CHECK_AVAILABILITY: Citizen asks if specific dates, times, or lots are free/available.\n"
    "- EXPLAIN_MISSING_REQUIREMENTS: Citizen asks what information, documents, or steps are still missing or needed to complete their booking (e.g. 'Ano pa kulang?', 'What is missing?', 'Ano pa kailangan?').\n"
    "- SELECT_ALLOCATION: Citizen chooses a burial lot or columbarium niche.\n"
    "- CHANGE_ALLOCATION: Citizen asks to switch to another lot, section, or columbarium.\n"
    "- CHECK_BOOKING_STATUS: Citizen asks for the current status, approval, or schedule of a booking.\n"
    "- RESUME_BOOKING: Citizen wants to continue an unfinished booking draft.\n"
    "- PROVIDE_INFORMATION: Citizen provides information or answering details.\n"
    "- UNCLEAR: Greeting, ambiguous query, or off-topic statement.\n\n"
    "Extraction & Normalization Rules:\n"
    "- Booking References: Recognize references like BUR-14, CREM-8, DFT-5, Booking #14, Schedule 22. Standardize to canonical format (e.g. BUR-14, CREM-8) and set booking_reference.\n"
    "- Dates: Normalize ALL dates to YYYY-MM-DD. For relative dates like 'tomorrow', 'in 2 weeks', or 'next Friday', compute against today's date provided in context.\n"
    "- Rescheduling vs Draft Editing: If citizen is in an active draft and changes date, set preferred_date/cremation_date and intent CORRECT_BOOKING_DETAILS. For committed bookings, set target_date and intent RESCHEDULE_BOOKING.\n"
    "- Corrections: If citizen corrects a field (e.g. 'spelled Kevin's surname incorrectly. It should be Mando'), set correction_field (e.g. 'decedent_name') and corrected_value (e.g. 'Mando').\n"
    "- Multi-slot Extraction: Extract ALL details mentioned in the message (service, name, relation, dates, lot, section) rather than discarding them.\n"
    "- Missing slots should be omitted or null. Never invent IDs or bookings.\n"
    "- Conversational & Guidance Rules for 'reply':\n"
    "  * Tone: Empathetic, respectful, and comforting to grieving families.\n"
    "  * Language Mirroring: If citizen writes in Filipino/Taglish, reply in polite, warm Filipino/Taglish using 'po' / 'opo'. If they write in English, reply in compassionate, clear English.\n"
    "  * Step-by-Step Dynamic Guidance:\n"
    "    1. Starting a booking / Missing Decedent: Acknowledge service, express condolences, and politely ask for the decedent's full name.\n"
    "    2. Decedent provided / Missing Date: Acknowledge the decedent, and ask for preferred date & time, noting cemetery services run Tuesday to Sunday (Mondays are closed for maintenance).\n"
    "    3. Date provided / Missing Lot: Acknowledge the schedule, and guide the citizen to select an available burial lot or offer assistance.\n"
    "    4. All Details Complete: Inform the citizen that their Live Blueprint on the right is ready, and invite them to review and say 'Confirm' to finalize.\n"
    "  * Never output empty or generic responses like 'I have noted your booking request' without providing the immediate next step.\n"
)


def _extract_booking_deterministic(
    message: str,
    draft_context: Optional[Dict[str, Any]] = None,
    user_bookings: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    """Rule-based fallback when LLM providers are unreachable or unconfigured."""
    msg_lower = (message or '').lower().strip()
    draft = draft_context or {}
    existing_service = draft.get('service_type')
    existing_data = draft.get('extracted_data') or {}
    bookings = user_bookings or []

    # 1. Booking Reference Extraction
    booking_reference = None
    ref_match = re.search(
        r'\b(BUR-\d+|CREM-\d+|DFT-\d+|Draft\s*#?\s*(\d+)|Booking\s*#?\s*(\d+)|Schedule\s*#?\s*(\d+)|Reservation\s*#?\s*(\d+))\b',
        message,
        flags=re.IGNORECASE
    )
    if ref_match:
        matched_str = ref_match.group(1).strip()
        upper_match = matched_str.upper()
        if upper_match.startswith('BUR-') or upper_match.startswith('CREM-') or upper_match.startswith('DFT-'):
            booking_reference = upper_match
        elif re.match(r'^draft\s*#?\s*(\d+)$', matched_str, flags=re.IGNORECASE):
            num = re.match(r'^draft\s*#?\s*(\d+)$', matched_str, flags=re.IGNORECASE).group(1)
            booking_reference = f"DFT-{num}"
        elif re.match(r'^schedule\s*#?\s*(\d+)$', matched_str, flags=re.IGNORECASE):
            num = re.match(r'^schedule\s*#?\s*(\d+)$', matched_str, flags=re.IGNORECASE).group(1)
            booking_reference = f"BUR-{num}"
        elif re.match(r'^(?:booking|reservation)\s*#?\s*(\d+)$', matched_str, flags=re.IGNORECASE):
            num = re.match(r'^(?:booking|reservation)\s*#?\s*(\d+)$', matched_str, flags=re.IGNORECASE).group(1)
            # Match against user bookings if reference exists
            matched_ref = None
            for b in bookings:
                ref = str(b.get('reference') or '')
                if ref.endswith(f"-{num}") or str(b.get('booking_id')) == num:
                    matched_ref = ref
                    break
            booking_reference = matched_ref or f"BUR-{num}"

    # 2. Determine service type
    service_type = existing_service
    if any(term in msg_lower for term in ['cremat', 'urn', 'columbarium', 'crematorium']):
        service_type = 'cremation'
    elif any(term in msg_lower for term in ['burial', 'interment', 'grave', 'plot', 'lot', 'casket']):
        service_type = 'burial'
    elif not service_type:
        # Check if booking_reference hints at service type
        if booking_reference and booking_reference.startswith('CREM-'):
            service_type = 'cremation'
        else:
            service_type = 'burial'

    # 3. Determine intent
    intent = 'PROVIDE_INFO'
    confidence = 0.95

    if any(phrase in msg_lower for phrase in ['ano pa kulang', 'ano pa kailangan', 'may kulang pa ba', 'ano pa ang kailangan', 'ano pa requirements', 'kulang pa ba', 'anong kulang', 'ano pang kailangan', 'what is missing', "what's missing", 'what else do i need', 'what information is missing', 'what information is needed', 'what do i still need', 'what am i missing']):
        intent = 'EXPLAIN_MISSING_REQUIREMENTS'
    elif any(phrase in msg_lower for phrase in ['cancel', 'withdraw', 'drop booking', 'cancel my booking', 'cancel reservation', 'cancel the booking']):
        intent = 'CANCEL_BOOKING'
    elif any(phrase in msg_lower for phrase in ['reschedule', 'move the burial', 'move my burial', 'move the booking', 'move my booking', 'move the cremation', 'postpone', 'shift date', 'move from', 'change date to', 'reschedule to', 'change my booking date', 'change the booking date', 'change booking date']):
        intent = 'RESCHEDULE_BOOKING'
    elif any(phrase in msg_lower for phrase in ['spelled', 'misspelled', 'spelling', 'typo', 'incorrect', 'surname is actually', 'name is actually', 'should be', 'last name is', 'dapat', 'mali ang spelling', 'mali ang pangalan', 'correct my information', 'correct the information', 'the relationship should be', 'it should be', 'palitan ang']):
        intent = 'CORRECT_BOOKING_DETAILS'
    elif any(phrase in msg_lower for phrase in ['change my booking', 'update my booking', 'modify my booking', 'edit my booking']):
        intent = 'UPDATE_BOOKING'
    elif any(phrase in msg_lower for phrase in ['availability', 'available', 'is it free', 'is there space', 'open slots', 'any available', 'may available', 'available ba', 'may slot', 'may bakante', 'pwede pa ba', 'is available', 'do you have available']):
        intent = 'CHECK_AVAILABILITY'
    elif any(phrase in msg_lower for phrase in ['status', 'check status', 'what is the status', 'is my booking confirmed', 'has it been approved', 'has my booking been']):
        intent = 'CHECK_BOOKING_STATUS'
    elif any(phrase in msg_lower for phrase in ['switch lot', 'different lot', 'change lot', 'change columbarium']):
        intent = 'CHANGE_ALLOCATION'
    elif any(phrase in msg_lower for phrase in ['select lot', 'choose lot', 'assign lot', 'pick lot', 'take lot', 'i want lot', 'lot id', 'lot #']):
        intent = 'SELECT_ALLOCATION'
    elif any(phrase in msg_lower for phrase in ['resume', 'continue my', 'pick up where']):
        intent = 'RESUME_BOOKING'
    elif any(phrase in msg_lower for phrase in ['confirm', 'proceed', 'looks good', 'ready to confirm', 'finalize', 'approve', 'yes confirm']):
        intent = 'CONFIRM_BOOKING'
    elif any(phrase in msg_lower for phrase in ['recommend', 'suggest', 'which lot', 'what lot', 'help me choose']):
        intent = 'REQUEST_RECOMMENDATION'
    elif any(phrase in msg_lower for phrase in ['book', 'schedule', 'reserve', 'i want to book', 'arrange a burial', 'arrange a cremation', 'start booking']) and not draft.get('draft_id'):
        intent = 'CREATE_BOOKING'

    slots: Dict[str, Any] = {
        'service_type': service_type,
        'decedent_name': None,
        'relationship': None,
        'preferred_date': None,
        'cremation_date': None,
        'target_date': None,
        'booking_reference': booking_reference,
        'lot_identifier': None,
        'lot_id': None,
        'section': None,
        'block': None,
        'preferred_columbarium': None,
        'correction_field': None,
        'corrected_value': None,
        'notes': None,
        'preferred_time': None
    }

    # 4. Extract Date patterns
    date_val = None
    iso_date_match = re.search(r'\b(20\d{2}-\d{2}-\d{2})\b', message)
    if iso_date_match:
        date_val = iso_date_match.group(1)
    else:
        # Natural language date: e.g. "September 20", "September 20th", "Sept 25, 2026"
        month_map = {
            'january': 1, 'jan': 1, 'february': 2, 'feb': 2, 'march': 3, 'mar': 3,
            'april': 4, 'apr': 4, 'may': 5, 'june': 6, 'jun': 6, 'july': 7, 'jul': 7,
            'august': 8, 'aug': 8, 'september': 9, 'sept': 9, 'sep': 9, 'october': 10, 'oct': 10,
            'november': 11, 'nov': 11, 'december': 12, 'dec': 12
        }
        nl_date_match = re.search(
            r'\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b',
            msg_lower
        )
        if nl_date_match:
            m_str = nl_date_match.group(1)
            day = int(nl_date_match.group(2))
            year = int(nl_date_match.group(3)) if nl_date_match.group(3) else datetime.now().year
            month = month_map.get(m_str, 1)
            try:
                date_val = f"{year:04d}-{month:02d}-{day:02d}"
            except Exception:
                pass
        elif 'tomorrow' in msg_lower:
            date_val = (datetime.now() + timedelta(days=1)).strftime('%Y-%m-%d')
        elif 'in 2 weeks' in msg_lower:
            date_val = (datetime.now() + timedelta(days=14)).strftime('%Y-%m-%d')
        elif 'in 3 weeks' in msg_lower:
            date_val = (datetime.now() + timedelta(days=21)).strftime('%Y-%m-%d')
        elif 'in 1 week' in msg_lower or 'next week' in msg_lower:
            date_val = (datetime.now() + timedelta(days=7)).strftime('%Y-%m-%d')
        elif 'in 1 month' in msg_lower:
            date_val = (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
        elif 'next month' in msg_lower:
            date_val = (datetime.now() + timedelta(days=30)).strftime('%Y-%m-%d')
        else:
            # Weekday parsing: "this Sunday", "next Sunday", "Sunday", "Friday", "this Friday"
            weekdays = {'monday': 0, 'tuesday': 1, 'wednesday': 2, 'thursday': 3, 'friday': 4, 'saturday': 5, 'sunday': 6}
            wm = re.search(r'\b(?:(this|next|coming)\s+)?(sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b', msg_lower)
            if wm:
                modifier = (wm.group(1) or '').lower().strip()
                target_dow = weekdays[wm.group(2).lower().strip()]
                current_dow = datetime.now().weekday()  # 0=Mon ... 6=Sun
                days_ahead = (target_dow - current_dow) % 7
                if days_ahead == 0:
                    days_ahead = 7
                if modifier == 'next' and days_ahead < 7:
                    days_ahead += 7
                date_val = (datetime.now() + timedelta(days=days_ahead)).strftime('%Y-%m-%d')

    if date_val:
        if service_type == 'cremation':
            slots['cremation_date'] = date_val
        else:
            slots['preferred_date'] = date_val
        if intent in ('RESCHEDULE_BOOKING', 'UPDATE_BOOKING'):
            slots['target_date'] = date_val

    # 4b. Extract Time patterns
    time_val = None
    time_match = re.search(r'\b(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b', message, re.IGNORECASE)
    if time_match:
        hours = int(time_match.group(1))
        minutes = int(time_match.group(2)) if time_match.group(2) else 0
        meridiem = time_match.group(3).lower()
        if 1 <= hours <= 12 and 0 <= minutes <= 59:
            if meridiem == 'pm' and hours < 12:
                hours += 12
            elif meridiem == 'am' and hours == 12:
                hours = 0
            time_val = f"{hours:02d}:{minutes:02d}:00"
            slots['preferred_time'] = time_val
    else:
        iso_time = re.search(r'\b([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?\b', message)
        if iso_time:
            hours = int(iso_time.group(1))
            minutes = int(iso_time.group(2))
            seconds = int(iso_time.group(3)) if iso_time.group(3) else 0
            time_val = f"{hours:02d}:{minutes:02d}:{seconds:02d}"
            slots['preferred_time'] = time_val

    # 5. Extract Lot ID / Allocation
    lot_match = re.search(r'\blot\s*(?:id|#|number)?\s*:?\s*([A-Za-z0-9\-_]+)\b', msg_lower)
    if lot_match:
        val = lot_match.group(1).strip()
        slots['lot_identifier'] = val
        if val.isdigit():
            slots['lot_id'] = int(val)
    else:
        alphanumeric_lot = re.search(r'\b([A-Za-z]\d?[-_]\d+)\b', message)
        if alphanumeric_lot:
            slots['lot_identifier'] = alphanumeric_lot.group(1).strip()

    sec_match = re.search(r'\bsection\s+([A-Za-z0-9]+)\b', msg_lower)
    if sec_match:
        slots['section'] = sec_match.group(1).upper()
    elif slots.get('lot_identifier') and re.match(r'^([A-Za-z])[-_]', str(slots['lot_identifier'])):
        slots['section'] = str(slots['lot_identifier'])[0].upper()

    col_match = re.search(r'\bcolumbarium\s*(?:vault|building|section)?\s*:?\s*([A-Za-z0-9\s]+)\b', message, flags=re.IGNORECASE)
    if col_match:
        slots['preferred_columbarium'] = col_match.group(1).strip()

    # 6. Extract Relationship
    rel_match = re.search(r'\bmy\s+(father|mother|brother|sister|son|daughter|husband|wife|friend|relative|grandfather|grandmother|parent|spouse)\b', msg_lower)
    if rel_match:
        slots['relationship'] = rel_match.group(1).capitalize()

    # 7. Extract Decedent Name & Correction Details
    if intent == 'CORRECT_BOOKING_DETAILS':
        # Check for relationship correction
        rel_cor_match = re.search(r'\b(?:relationship\s+should\s+be|it\s+should\s+be|should\s+be|relasyon\s+ay)\s+(daughter|son|father|mother|brother|sister|spouse|wife|husband|relative|friend)\b', msg_lower)
        if not rel_cor_match and any(w in msg_lower for w in ['daughter', 'son', 'father', 'mother', 'brother', 'sister']) and any(w in msg_lower for w in ['should be', 'dapat', 'instead']):
            rel_cor_match = re.search(r'\b(daughter|son|father|mother|brother|sister|spouse|wife|husband|relative|friend)\b', msg_lower)

        if rel_cor_match:
            slots['correction_field'] = 'relationship'
            slots['corrected_value'] = rel_cor_match.group(1).capitalize()
            slots['relationship'] = slots['corrected_value']
        else:
            # Check for Tagalog dapat: "Kevin Mando dapat."
            dapat_match = re.search(r'([A-Z][a-zA-Z\.\s]{1,35})\s+dapat\b', message)
            if dapat_match:
                slots['correction_field'] = 'decedent_name'
                slots['corrected_value'] = dapat_match.group(1).strip()
                slots['decedent_name'] = slots['corrected_value']
            else:
                # "I spelled Kevin's surname incorrectly. It should be Mando."
                cor_match = re.search(r'(?:should be|it is|actually|surname is|name is)\s+([A-Z][a-zA-Z\.\s]{1,30})', message)
                if cor_match:
                    slots['correction_field'] = 'decedent_name'
                    slots['corrected_value'] = cor_match.group(1).strip().rstrip('.')
                    slots['decedent_name'] = slots['corrected_value']
                elif 'contact' in msg_lower or 'phone' in msg_lower:
                    phone_match = re.search(r'(\+?[0-9\s\-]{7,15})', message)
                    if phone_match:
                        slots['correction_field'] = 'contact_number'
                        slots['corrected_value'] = phone_match.group(1).strip()
                elif 'notes' in msg_lower or 'remarks' in msg_lower:
                    notes_match = re.search(r'(?:notes|remarks)\s*(?:should be|is|to|:)?\s*(.+)$', message, re.IGNORECASE)
                    if notes_match:
                        slots['correction_field'] = 'notes'
                        slots['corrected_value'] = notes_match.group(1).strip()
                elif any(phrase in msg_lower for phrase in ['correct my information', 'correct the information', 'change something', 'wrong info']):
                    slots['correction_field'] = None
                    slots['corrected_value'] = None
    else:
        existing_name = existing_data.get('decedent_name')
        is_supplying_date_or_lot = bool(re.search(r'\b(date|schedule|time|lot|section|columbarium|niche|sunday|monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|week|month)\b', msg_lower))
        if not existing_name or not is_supplying_date_or_lot:
            name_match = re.search(r'(?:decedent(?:\s+name)?|name\s+is|named|for(?:\s+my\s+\w+)?)\s+([A-Z][a-zA-Z\.\s]{2,40})', message)
            if name_match:
                candidate_name = name_match.group(1).strip()
                # Clean off trailing clauses
                candidate_name = re.sub(r'\s+(?:my\s+)?(?:father|mother|brother|sister|son|daughter|husband|wife).*$', '', candidate_name, flags=re.IGNORECASE).strip()
                candidate_name = re.sub(r'\s+(?:on|at|in|prefer|preferably|date|burial|cremation|schedule|service).*$', '', candidate_name, flags=re.IGNORECASE).strip()
                candidate_name = candidate_name.strip(" \t\n\r:.,")
                domain_keywords = {'burial', 'cremation', 'service', 'schedule', 'date', 'reservation', 'lot', 'plot', 'grave', 'columbarium', 'niche'}
                if len(candidate_name) >= 2 and candidate_name.lower() not in domain_keywords:
                    slots['decedent_name'] = candidate_name

    # 8. Backward-compatible extracted_fields map
    extracted_fields = {
        'service_type': slots['service_type'],
        'decedent_name': slots['decedent_name'],
        'relationship': slots['relationship'],
        'preferred_date': slots['preferred_date'],
        'cremation_date': slots['cremation_date'],
        'preferred_time': slots.get('preferred_time'),
        'lot_id': slots['lot_id'],
        'preferred_columbarium': slots['preferred_columbarium'],
        'notes': slots['notes']
    }
    extracted_fields = {k: v for k, v in extracted_fields.items() if v not in (None, '')}

    # 9. Formulate conversational reply with dynamic next-step guidance
    is_tagalog = bool(re.search(r'\b(po|opo|para|kay|sa|gusto|libing|ano|kailan|tatay|nanay|kapatid|asawa|lolo|lola|sino|paano|salamat|mali|dapat|namin|natin|ako|ko|mo|siya|bawal|paki|pili|anong|araw|oras)\b', message, re.IGNORECASE))
    active_decedent = extracted_fields.get('decedent_name') or existing_data.get('decedent_name')
    active_date = extracted_fields.get('preferred_date') or extracted_fields.get('cremation_date') or existing_data.get('preferred_date') or existing_data.get('cremation_date')
    active_lot = extracted_fields.get('lot_id') or existing_data.get('lot_id')

    if intent == 'CANCEL_BOOKING':
        ref_text = f" for **{booking_reference}**" if booking_reference else ""
        reply = (f"Natanggap ko po ang inyong hiling na kanselahin ang booking{ref_text}. Bineberipika ko po ang mga detalye."
                 if is_tagalog else f"I have received your request to cancel your reservation{ref_text}. I am verifying your booking details.")
    elif intent == 'RESCHEDULE_BOOKING':
        date_text = f" to **{date_val}**" if date_val else ""
        ref_text = f" for **{booking_reference}**" if booking_reference else ""
        reply = (f"Naitala ko po ang inyong hiling na ilipat ang booking{ref_text}{date_text}. Sinusuri ko po ang availability."
                 if is_tagalog else f"I have noted your request to move your booking{ref_text}{date_text}. Verifying availability and booking context.")
    elif intent == 'CORRECT_BOOKING_DETAILS':
        reply = ("Salamat po sa pagwawasto. Na-update ko na po ang impormasyon sa inyong booking."
                 if is_tagalog else "Thank you for the correction. I have updated the booking information accordingly.")
    elif intent == 'CHECK_BOOKING_STATUS':
        ref_text = f" for **{booking_reference}**" if booking_reference else ""
        reply = (f"Sinusuri ko po ang kasalukuyang status ng inyong booking{ref_text}."
                 if is_tagalog else f"Checking the current status of your booking{ref_text}.")
    elif intent == 'CHECK_AVAILABILITY':
        reply = ("Iche-check ko po ang availability para sa inyong napiling serbisyo at petsa."
                 if is_tagalog else "Let me check availability for the requested service and date.")
    elif intent == 'EXPLAIN_MISSING_REQUIREMENTS':
        reply = ("Narito po ang checklist ng mga kailangan para sa inyong booking."
                 if is_tagalog else "Here is the checklist of requirements for your booking.")
    elif intent == 'CONFIRM_BOOKING':
        reply = ("Naitala ko na po ang inyong kumpirmasyon. Pakisuri po ang detalye bago natin ito isapinal."
                 if is_tagalog else "I have recorded your confirmation. Please review the booking details so we can proceed.")
    elif intent == 'REQUEST_RECOMMENDATION':
        reply = ("Ikinagagalak ko po kayong tulungan sa pagpili ng available na burial lot o niche."
                 if is_tagalog else "I would be happy to help recommend an available lot. You can select your preferred section or budget.")
    elif not active_decedent:
        reply = ("Nakikiramay po kami sa inyong pamilya. Ako po ang tutulong sa inyo sa pag-aayos ng serbisyo. Maaari po bang malaman ang buong pangalan ng yumao (decedent)?"
                 if is_tagalog else "We extend our deepest condolences. I am here to assist you with your booking. Could you please provide the full name of the deceased (decedent)?")
    elif service_type == 'cremation' and not active_date:
        reply = (f"Salamat po. Kailan po ninyo nais isagawa ang cremation para kay **{active_decedent}**?"
                 if is_tagalog else f"Thank you. What date would you like to schedule the cremation service for **{active_decedent}**?")
    elif service_type == 'burial' and not active_date:
        reply = (f"Salamat po. Kailan po ninyo nais isagawa ang libing para kay **{active_decedent}**? (Maaari po kayong pumili mula Martes hanggang Linggo, tuwing Lunes po ay sarado para sa maintenance)."
                 if is_tagalog else f"Thank you. What date would you prefer for the burial service for **{active_decedent}**? (Services are available Tuesday through Sunday; Mondays are closed for maintenance).")
    elif service_type == 'burial' and not active_lot:
        reply = ("Naitakda na po ang petsa. Ang susunod po nating hakbang ay ang pagpili ng available burial lot. Mayroon po ba kayong napiling lot number, o nais ninyong magrekomenda ako?"
                 if is_tagalog else "Your schedule is set. Next, please select an available burial lot to complete your booking. Let me know if you have a specific lot number in mind, or if you would like a recommendation.")
    else:
        reply = ("Kumpleto na po ang lahat ng kailangan sa inyong Live Blueprint sa kanan! Pakisuri po ang mga detalye, at sabihin lamang ang **'Confirm'** o i-click ang Confirm Booking button upang opisyal na maipasa ang inyong reservation."
                 if is_tagalog else "All required details are now complete in your Live Blueprint on the right! Please review the summary, and type **'Confirm'** or click Confirm Booking to finalize your reservation.")

    return {
        'intent': intent,
        'confidence': confidence,
        'service_type': service_type,
        'booking_reference': booking_reference,
        'slots': slots,
        'extracted_fields': extracted_fields,
        'reply': reply
    }


def _extract_booking_agent(
    message: str,
    draft_context: Dict[str, Any],
    conversation_context: List[Dict[str, Any]],
    user_bookings: Optional[List[Dict[str, Any]]] = None
) -> Dict[str, Any]:
    today_str = datetime.now().strftime('%Y-%m-%d, %A')
    user_input_payload = {
        'today': today_str,
        'message': message,
        'draft_context': draft_context,
        'recent_conversation': conversation_context[-4:] if conversation_context else [],
        'user_bookings': user_bookings or []
    }

    try:
        raw_response = llm_provider.generate(
            system_prompt=BOOKING_AGENT_SYSTEM_PROMPT,
            user_content=json.dumps(user_input_payload),
            model=EXTRACTION_MODEL,
            json_mode=True,
            temperature=0.2,
            max_output_tokens=768,
            provider_chain=['gemini', 'backup']
        )
        if raw_response:
            parsed = json.loads(raw_response)
            if isinstance(parsed, dict) and 'intent' in parsed:
                raw_intent = parsed.get('intent', 'PROVIDE_INFO')
                # Normalize legacy intent mapping
                if raw_intent == 'PROVIDE_INFO':
                    raw_intent = 'PROVIDE_INFORMATION'
                elif raw_intent == 'UPDATE_FIELD':
                    raw_intent = 'CORRECT_BOOKING_DETAILS'

                raw_slots = parsed.get('slots') if isinstance(parsed.get('slots'), dict) else {}
                raw_extracted = parsed.get('extracted_fields') if isinstance(parsed.get('extracted_fields'), dict) else {}

                # Combine slots with extracted_fields fallback
                merged_slots = {
                    'service_type': raw_slots.get('service_type') or parsed.get('service_type'),
                    'decedent_name': raw_slots.get('decedent_name') or raw_extracted.get('decedent_name'),
                    'relationship': raw_slots.get('relationship') or raw_extracted.get('relationship'),
                    'preferred_date': raw_slots.get('preferred_date') or raw_extracted.get('preferred_date'),
                    'cremation_date': raw_slots.get('cremation_date') or raw_extracted.get('cremation_date'),
                    'target_date': raw_slots.get('target_date'),
                    'booking_reference': raw_slots.get('booking_reference') or parsed.get('booking_reference'),
                    'lot_identifier': raw_slots.get('lot_identifier') or raw_slots.get('lot_id') or raw_extracted.get('lot_id'),
                    'lot_id': raw_slots.get('lot_id') or raw_extracted.get('lot_id'),
                    'section': raw_slots.get('section'),
                    'block': raw_slots.get('block'),
                    'preferred_columbarium': raw_slots.get('preferred_columbarium') or raw_extracted.get('preferred_columbarium'),
                    'correction_field': raw_slots.get('correction_field'),
                    'corrected_value': raw_slots.get('corrected_value'),
                    'notes': raw_slots.get('notes') or raw_extracted.get('notes')
                }

                # Clean extracted_fields
                cleaned_extracted = {k: v for k, v in raw_extracted.items() if v not in (None, '')}
                if not cleaned_extracted:
                    for k in ('decedent_name', 'relationship', 'preferred_date', 'cremation_date', 'lot_id', 'preferred_columbarium'):
                        if merged_slots.get(k) not in (None, ''):
                            cleaned_extracted[k] = merged_slots[k]

                return {
                    'intent': raw_intent,
                    'confidence': float(parsed.get('confidence', 0.95)),
                    'service_type': parsed.get('service_type'),
                    'booking_reference': merged_slots.get('booking_reference'),
                    'slots': merged_slots,
                    'extracted_fields': cleaned_extracted,
                    'reply': parsed.get('reply') or 'I have noted your booking request.'
                }
    except Exception:
        pass

    return _extract_booking_deterministic(message, draft_context, user_bookings)


@app.post('/api/booking-agent/extract')
def extract_booking_agent_endpoint():
    try:
        payload = request.get_json(silent=True) or {}
        message = (payload.get('message') or '').strip()
        draft_context = payload.get('draft_context') or {}
        conversation_context = payload.get('conversation_context') or []
        user_bookings = payload.get('user_bookings') or []

        if not message:
            return jsonify({
                'success': False,
                'error': 'Message cannot be empty',
                'result': None
            }), 400

        result = _extract_booking_agent(message, draft_context, conversation_context, user_bookings)
        return jsonify({
            'success': True,
            'result': result
        })
    except Exception as exc:
        fallback = _extract_booking_deterministic(
            message if 'message' in locals() else '',
            draft_context if 'draft_context' in locals() else {},
            user_bookings if 'user_bookings' in locals() else []
        )
        return jsonify({
            'success': True,
            'result': fallback,
            'fallback': True
        })



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

    # Batch 6: the one call site configured with a real two-provider chain
    # (Gemini primary, Groq backup) — see llm_provider.py's module
    # docstring and the Batch 5 audit for why assistant-ask specifically
    # (highest traffic, fully user-initiated since Batch 1, no
    # deterministic fallback narrative of its own). Every other call site
    # in this file omits provider_chain entirely and stays Gemini-only.
    text = llm_provider.generate(
        system_prompt=ASSISTANT_SYSTEM_PROMPT,
        user_content=json.dumps(payload),
        model=ASSISTANT_MODEL,
        json_mode=True,
        temperature=0.3,
        max_output_tokens=768,
        provider_chain=['gemini', 'backup'],
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
