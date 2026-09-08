"""
Test Suite: BMS-5 Python AI Booking Agent Integration
Tests /api/booking-agent/extract endpoint, deterministic fallback,
intent classification, slot extraction, and schema compliance.
"""
import sys
import os
from pathlib import Path

# Add python-ai directory to sys.path
root_dir = Path(__file__).resolve().parent.parent
python_ai_dir = root_dir / 'python-ai'
sys.path.insert(0, str(python_ai_dir))

from app import app, _extract_booking_deterministic

print("======================================================")
print("RUNNING BMS-5 PYTHON AI BOOKING AGENT TEST SUITE")
print("======================================================")

client = app.test_client()
passed = 0
failed = 0


def report(test_num: int, title: str, success: bool, details: str = ''):
    global passed, failed
    if success:
        passed += 1
        print(f"[PASS] TEST {test_num}: {title}")
    else:
        failed += 1
        print(f"[FAIL] TEST {test_num}: {title} — {details}")


# ----------------------------------------------------------------------
# TEST 1: Empty message rejected with HTTP 400
# ----------------------------------------------------------------------
res1 = client.post('/api/booking-agent/extract', json={'message': ''})
test1_ok = (res1.status_code == 400 and not res1.get_json().get('success'))
report(1, "Empty message is rejected with HTTP 400", test1_ok, f"Status: {res1.status_code}")

# ----------------------------------------------------------------------
# TEST 2: Burial booking slot extraction
# ----------------------------------------------------------------------
msg2 = "I want to schedule a burial for my father Juan Dela Cruz on 2026-10-15"
res2 = client.post('/api/booking-agent/extract', json={'message': msg2})
data2 = res2.get_json() or {}
result2 = data2.get('result') or {}
fields2 = result2.get('extracted_fields') or {}

test2_ok = (
    res2.status_code == 200
    and data2.get('success') is True
    and result2.get('service_type') == 'burial'
    and 'Juan Dela Cruz' in (fields2.get('decedent_name') or '')
    and fields2.get('preferred_date') == '2026-10-15'
    and bool(result2.get('reply'))
)
report(2, "Burial intent and slots extracted from natural language", test2_ok, str(result2))

# ----------------------------------------------------------------------
# TEST 3: Cremation intent and slot extraction
# ----------------------------------------------------------------------
msg3 = "I need cremation for Maria Santos tomorrow"
res3 = client.post('/api/booking-agent/extract', json={'message': msg3})
data3 = res3.get_json() or {}
result3 = data3.get('result') or {}
fields3 = result3.get('extracted_fields') or {}

test3_ok = (
    res3.status_code == 200
    and data3.get('success') is True
    and result3.get('service_type') == 'cremation'
    and 'Maria Santos' in (fields3.get('decedent_name') or '')
    and bool(fields3.get('cremation_date'))
    and bool(result3.get('reply'))
)
report(3, "Cremation service type and relative date extracted", test3_ok, str(result3))

# ----------------------------------------------------------------------
# TEST 4: Confirmation intent detection
# ----------------------------------------------------------------------
msg4 = "Yes, please confirm this booking now"
res4 = client.post('/api/booking-agent/extract', json={
    'message': msg4,
    'draft_context': {'service_type': 'burial', 'draft_id': 101}
})
data4 = res4.get_json() or {}
result4 = data4.get('result') or {}

test4_ok = (
    res4.status_code == 200
    and result4.get('intent') == 'CONFIRM_BOOKING'
    and bool(result4.get('reply'))
)
report(4, "Confirmation intent identified from citizen agreement", test4_ok, str(result4))

# ----------------------------------------------------------------------
# TEST 5: Update/Correction intent detection
# ----------------------------------------------------------------------
msg5 = "Actually change the preferred date to 2026-11-20"
res5 = client.post('/api/booking-agent/extract', json={
    'message': msg5,
    'draft_context': {'service_type': 'burial', 'draft_id': 101}
})
data5 = res5.get_json() or {}
result5 = data5.get('result') or {}
fields5 = result5.get('extracted_fields') or {}

test5_ok = (
    res5.status_code == 200
    and result5.get('intent') in ('UPDATE_FIELD', 'CORRECT_BOOKING_DETAILS')
    and fields5.get('preferred_date') == '2026-11-20'
)
report(5, "Update field intent and corrected slot extracted", test5_ok, str(result5))

# ----------------------------------------------------------------------
# TEST 6: Deterministic fallback engine direct execution
# ----------------------------------------------------------------------
fallback = _extract_booking_deterministic(
    "I want to book burial for my mother Elena Lopez on 2026-12-05",
    {'service_type': 'burial'}
)
test6_ok = (
    fallback.get('service_type') == 'burial'
    and fallback.get('intent') in ('CREATE_BOOKING', 'PROVIDE_INFO')
    and 'Elena Lopez' in (fallback.get('extracted_fields', {}).get('decedent_name') or '')
    and fallback.get('extracted_fields', {}).get('preferred_date') == '2026-12-05'
    and fallback.get('extracted_fields', {}).get('relationship') == 'Mother'
    and bool(fallback.get('reply'))
)
report(6, "Deterministic fallback operates reliably without external APIs", test6_ok, str(fallback))

# ----------------------------------------------------------------------
# TEST 7: Strict schema compliance of extraction response
# ----------------------------------------------------------------------
required_keys = {'intent', 'service_type', 'extracted_fields', 'reply'}
actual_keys = set(result2.keys())
test7_ok = required_keys.issubset(actual_keys) and isinstance(result2.get('extracted_fields'), dict)
report(7, "Extraction result conforms to standardized contract schema", test7_ok, f"Keys: {actual_keys}")

print("======================================================")
print(f"BMS-5 PYTHON AI TEST RESULTS: {passed} PASSED, {failed} FAILED")
print("======================================================")

sys.exit(0 if failed == 0 else 1)

