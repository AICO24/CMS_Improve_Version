import json
import os
import math
import warnings
from datetime import datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

import anthropic
import mysql.connector
import numpy as np
import pandas as pd
from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_cors import CORS
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
NARRATION_MODEL = 'claude-haiku-4-5'
_anthropic_api_key = (os.getenv('ANTHROPIC_API_KEY') or '').strip()
_anthropic_client = anthropic.Anthropic(api_key=_anthropic_api_key) if _anthropic_api_key else None

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
    if _anthropic_client is None:
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
        response = _anthropic_client.with_options(timeout=8.0).messages.create(
            model=NARRATION_MODEL,
            max_tokens=150,
            system=NARRATION_SYSTEM_PROMPT,
            messages=[{'role': 'user', 'content': json.dumps(facts)}],
        )
        text = ''.join(block.text for block in response.content if block.type == 'text').strip()
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
EXTRACTION_MODEL = 'claude-haiku-4-5'

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
    if _anthropic_client is None or not message:
        return None

    payload = {
        'message': message,
        'valid_lot_types': lot_types,
        'valid_sections': sections,
        'pending_slot': pending_slot,
    }

    try:
        response = _anthropic_client.with_options(timeout=8.0).messages.create(
            model=EXTRACTION_MODEL,
            max_tokens=200,
            system=EXTRACTION_SYSTEM_PROMPT,
            messages=[{'role': 'user', 'content': json.dumps(payload)}],
        )
        text = ''.join(block.text for block in response.content if block.type == 'text').strip()
        parsed = json.loads(_strip_json_fences(text))
        return parsed if isinstance(parsed, dict) else None
    except Exception:
        return None


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
