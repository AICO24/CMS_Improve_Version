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


@app.post('/api/recommend')
def recommend_lots():
    try:
        preferences = request.get_json(silent=True) or {}
        lot_type = (preferences.get('lot_type') or '').strip()
        budget = preferences.get('budget')
        section = (preferences.get('section') or '').strip()

        try:
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
        except Exception as exc:
            return jsonify({'error': f'Unable to retrieve available lots: {exc}', 'code': 503}), 503

        if not lots:
            return jsonify([])

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
            return jsonify([])

        similarity_scores = cosine_similarity([user_vector], matrix)[0]
        ranked_lots = []
        for index, lot in enumerate(lots):
            score = round(float(similarity_scores[index]) * 100, 2)
            reasons: List[str] = []
            if lot_type and lot.get('lot_type_name') == lot_type:
                score += 5.0
                reasons.append('Matches your selected lot type')
            if section and lot.get('section_name') == section:
                score += 3.0
                reasons.append('Matches your preferred section')
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
        return jsonify(ranked_lots[:5])
    except Exception as exc:  # pragma: no cover - defensive path
        return jsonify({'error': str(exc), 'code': 500}), 500


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
