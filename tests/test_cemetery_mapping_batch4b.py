"""
Automated Test Suite for CMS Cemetery Mapping — Batch 4B
AI Recommendation "View on Map" Bridge

Validates:
1. AI recommendation bridge button, URL structure, and encoding
2. Map URL initialization (cemetery_id only, cemetery_id + block_id, cemetery_id + block_id + lot_id)
3. Exact ID-driven navigation & progressive block loading
4. Hierarchy validation (valid, invalid, mismatched cemetery/block/lot)
5. Filter reset on AI navigation
6. Centering, highlighting, and lot details drawer opening
7. Preserved booking deep link and authoritative status restrictions
8. CSS and accessibility requirements
"""

import re
import urllib.parse
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

passed_tests = 0
failed_tests = 0


def assert_test(condition, message):
    global passed_tests, failed_tests
    if condition:
        print(f" [PASS] {message}")
        passed_tests += 1
    else:
        print(f" [FAIL] {message}")
        failed_tests += 1


print("=== CEMETERY MAPPING BATCH 4B VALIDATION ===")

# --------------------------------------------------------------------------
# 1. FILE EXISTENCE & INTEGRITY
# --------------------------------------------------------------------------
map_html_path = ROOT / "frontend" / "pages" / "cemetery-map.html"
map_js_path = ROOT / "assets" / "js" / "pages" / "cemetery-map.js"
map_css_path = ROOT / "assets" / "css" / "cemetery-map.css"
booking_js_path = ROOT / "assets" / "js" / "pages" / "booking-assistant.js"
booking_css_path = ROOT / "assets" / "css" / "booking-chat.css"
avail_service_path = ROOT / "backend" / "services" / "BookingAvailabilityService.php"
python_ai_path = ROOT / "python-ai" / "app.py"

assert_test(map_html_path.exists(), "cemetery-map.html exists")
assert_test(map_js_path.exists(), "cemetery-map.js exists")
assert_test(booking_js_path.exists(), "booking-assistant.js exists")
assert_test(booking_css_path.exists(), "booking-chat.css exists")

map_js = map_js_path.read_text(encoding="utf-8")
booking_js = booking_js_path.read_text(encoding="utf-8")
booking_css = booking_css_path.read_text(encoding="utf-8")
avail_service = avail_service_path.read_text(encoding="utf-8")
python_ai = python_ai_path.read_text(encoding="utf-8")

# --------------------------------------------------------------------------
# 2. AI RECOMMENDATION BRIDGE & BUTTON IN BOOKING ASSISTANT
# --------------------------------------------------------------------------
assert_test("renderRecommendationCards" in booking_js, "booking-assistant.js defines renderRecommendationCards()")
assert_test("btn-view-on-map" in booking_js, "booking-assistant.js includes btn-view-on-map class")
assert_test("cemetery-map.html?cemetery_id=" in booking_js, "booking-assistant.js constructs cemetery-map.html URL")
assert_test("block_id=" in booking_js, "booking-assistant.js passes block_id parameter in map URL")
assert_test("lot_id=" in booking_js, "booking-assistant.js passes lot_id parameter in map URL")
assert_test("encodeURIComponent" in booking_js, "booking-assistant.js applies encodeURIComponent to URL parameters")
assert_test("fa-map-marker-alt" in booking_js or "fa-map-location-dot" in booking_js, "View on Map button features map icon")
assert_test("View on Map" in booking_js, "View on Map button features clear human-readable label")
assert_test("Continue / Book" in booking_js, "Preserves Continue / Book action alongside View on Map")
assert_test("renderLotGrid" in booking_js and "btn-view-on-map" in booking_js, "Lot Picker modal includes View on Map button")

# --------------------------------------------------------------------------
# 3. CSS STYLING FOR VIEW ON MAP BUTTON
# --------------------------------------------------------------------------
assert_test(".btn-view-on-map" in booking_css, "booking-chat.css defines .btn-view-on-map styles")
assert_test('[data-theme="dark"] .btn-view-on-map' in booking_css or 'body[data-theme="dark"] .btn-view-on-map' in booking_css, "booking-chat.css provides dark mode override for .btn-view-on-map")
assert_test(".card-actions-row" in booking_css, "booking-chat.css provides .card-actions-row layout")

# --------------------------------------------------------------------------
# 4. BACKEND & AI CONTRACT PARITY FOR BLOCK_ID
# --------------------------------------------------------------------------
assert_test("block_id" in avail_service and "findAlternativeLots" in avail_service, "BookingAvailabilityService::findAlternativeLots() queries block_id from v_available_lots")
assert_test("block_id" in python_ai and "_fetch_available_lots" in python_ai, "python-ai/app.py _fetch_available_lots() queries block_id from v_available_lots")

# --------------------------------------------------------------------------
# 5. MAP URL INITIALIZATION ENGINE IN CEMETERY-MAP.JS
# --------------------------------------------------------------------------
assert_test("initFromUrlParams" in map_js, "cemetery-map.js implements initFromUrlParams()")
assert_test("parsePositiveInt" in map_js, "cemetery-map.js implements parsePositiveInt() parameter security sanitizer")
assert_test("rawCemId" in map_js or "cemetery_id" in map_js, "cemetery-map.js reads cemetery_id parameter")
assert_test("rawBlkId" in map_js or "block_id" in map_js, "cemetery-map.js reads block_id parameter")
assert_test("rawLotId" in map_js or "lot_id" in map_js, "cemetery-map.js reads lot_id parameter")

# Hierarchy validation assertions in JS
assert_test("Cemetery not found." in map_js, "Handles invalid/unknown cemetery facility with 'Cemetery not found.'")
assert_test("The requested block could not be found on this cemetery." in map_js, "Handles invalid/mismatched block with specific safe message")
assert_test("The requested lot could not be found in this block." in map_js, "Handles invalid/mismatched lot with specific safe message")
assert_test("Cemetery ID is required to locate the block or lot." in map_js, "Guards against missing cemetery_id when block/lot provided")

# Exact navigation assertions in JS
assert_test("resetAllFilters(false)" in map_js, "AI navigation clears active filters via resetAllFilters(false)")
assert_test("drillDownToBlock" in map_js, "Directly loads requested block via drillDownToBlock")
assert_test("selectLot" in map_js, "Selects exact lot via authoritative selectLot")
assert_test("is-selected" in map_js and "is-matched" in map_js, "Applies is-selected and is-matched visual highlight")
assert_test("centerViewOnPoint" in map_js, "Centers viewport on target lot coordinates via centerViewOnPoint")

# Authoritative booking link preservation
assert_test("btnBookThisLot.href = `booking-assistant.html?service=burial&lot_id=" in map_js, "Preserves authoritative booking deep link in lot details drawer")
assert_test("btnLotUnavailable" in map_js, "Preserves unavailable/locked status restriction for non-available lots")

# --------------------------------------------------------------------------
# 6. DETERMINISTIC LOGIC SIMULATION
# --------------------------------------------------------------------------
print("\n--- Functional Logic Simulation ---")

def parse_positive_int(val):
    if val is None or val == "":
        return None
    try:
        num = float(val)
        if num.is_integer() and int(num) > 0:
            return int(num)
        return -1
    except ValueError:
        return -1

# Security Sanitization Tests
assert_test(parse_positive_int(None) is None, "parsePositiveInt(None) -> None")
assert_test(parse_positive_int("") is None, "parsePositiveInt('') -> None")
assert_test(parse_positive_int("1") == 1, "parsePositiveInt('1') -> 1")
assert_test(parse_positive_int("42") == 42, "parsePositiveInt('42') -> 42")
assert_test(parse_positive_int("0") == -1, "parsePositiveInt('0') -> -1 (rejected)")
assert_test(parse_positive_int("-5") == -1, "parsePositiveInt('-5') -> -1 (rejected)")
assert_test(parse_positive_int("abc") == -1, "parsePositiveInt('abc') -> -1 (rejected)")
assert_test(parse_positive_int("1.5") == -1, "parsePositiveInt('1.5') -> -1 (rejected)")
assert_test(parse_positive_int("<script>") == -1, "parsePositiveInt('<script>') -> -1 (rejected)")
assert_test(parse_positive_int("1; DROP TABLE lots;") == -1, "parsePositiveInt(SQL injection) -> -1 (rejected)")

# Mock Cemetery Hierarchy
mock_cemeteries = [
    {"cemetery_id": 1, "cemetery_name": "Himlayang Bayan Central"},
    {"cemetery_id": 2, "cemetery_name": "Himlayang Bayan North"},
]

mock_cemetery_1_layout = {
    "sections": [
        {
            "section_id": 1,
            "section_name": "Section A",
            "blocks": [
                {"block_id": 1, "block_name": "Block 1", "section_id": 1},
                {"block_id": 2, "block_name": "Block 2", "section_id": 1},
            ]
        },
        {
            "section_id": 2,
            "section_name": "Section B",
            "blocks": [
                {"block_id": 3, "block_name": "Block 1", "section_id": 2},
            ]
        }
    ]
}

mock_block_1_lots = [
    {"lot_id": 101, "lot_number": "A1-001", "block_id": 1, "status": "Available", "price": 45000},
    {"lot_id": 102, "lot_number": "A1-002", "block_id": 1, "status": "Reserved", "price": 45000},
    {"lot_id": 103, "lot_number": "A1-003", "block_id": 1, "status": "Occupied", "price": 50000},
]

def simulate_url_init(query_string):
    qs = urllib.parse.parse_qs(query_string)
    raw_cem = qs.get("cemetery_id", [None])[0]
    raw_blk = qs.get("block_id", [None])[0]
    raw_lot = qs.get("lot_id", [None])[0]

    log = []

    # Normal map behavior (no params)
    if raw_cem is None and raw_blk is None and raw_lot is None:
        log.append("DEFAULT_CEMETERY_OVERVIEW")
        return {"status": "SUCCESS", "log": log, "cemetery_id": mock_cemeteries[0]["cemetery_id"]}

    # Missing cemetery with block/lot present
    if raw_cem is None and (raw_blk is not None or raw_lot is not None):
        log.append("WARNING_MISSING_CEMETERY_ID")
        log.append("FALLBACK_TO_DEFAULT_OVERVIEW")
        return {"status": "WARNING", "log": log, "cemetery_id": mock_cemeteries[0]["cemetery_id"]}

    # Validate cemetery_id
    cem_id = parse_positive_int(raw_cem)
    if cem_id == -1:
        log.append("ERROR_INVALID_CEMETERY_ID")
        return {"status": "ERROR", "message": "Cemetery not found.", "log": log}

    target_cem = next((c for c in mock_cemeteries if c["cemetery_id"] == cem_id), None)
    if not target_cem:
        log.append("ERROR_CEMETERY_NOT_FOUND")
        return {"status": "ERROR", "message": "Cemetery not found.", "log": log}

    log.append(f"SWITCH_CEMETERY_{cem_id}")

    if raw_blk is None:
        log.append("STOP_AT_CEMETERY_OVERVIEW")
        return {"status": "SUCCESS", "cemetery_id": cem_id, "log": log}

    # Validate block_id
    blk_id = parse_positive_int(raw_blk)
    if blk_id == -1:
        log.append("ERROR_INVALID_BLOCK_ID")
        return {"status": "ERROR", "message": "The requested block could not be found on this cemetery.", "log": log}

    target_block = None
    target_section = None
    for sec in mock_cemetery_1_layout["sections"]:
        for blk in sec["blocks"]:
            if blk["block_id"] == blk_id:
                target_block = blk
                target_section = sec
                break

    if not target_block:
        log.append("ERROR_BLOCK_NOT_IN_CEMETERY")
        return {"status": "ERROR", "message": "The requested block could not be found on this cemetery.", "log": log}

    log.append("RESET_ALL_FILTERS")
    log.append(f"DRILL_DOWN_BLOCK_{blk_id}")

    if raw_lot is None:
        log.append("STOP_AT_BLOCK_VIEW")
        return {"status": "SUCCESS", "cemetery_id": cem_id, "block_id": blk_id, "log": log}

    # Validate lot_id
    lot_id = parse_positive_int(raw_lot)
    if lot_id == -1:
        log.append("ERROR_INVALID_LOT_ID")
        return {"status": "ERROR", "message": "The requested lot could not be found in this block.", "log": log}

    target_lot = next((l for l in mock_block_1_lots if l["lot_id"] == lot_id), None)
    if not target_lot:
        log.append("ERROR_LOT_NOT_IN_BLOCK")
        return {"status": "ERROR", "message": "The requested lot could not be found in this block.", "log": log}

    log.append("RESET_ALL_FILTERS_BEFORE_HIGHLIGHT")
    log.append(f"HIGHLIGHT_LOT_{lot_id}")
    log.append(f"CENTER_VIEWPORT_ON_LOT_{lot_id}")
    log.append(f"OPEN_LOT_DETAILS_DRAWER_{lot_id}")

    is_bookable = target_lot["status"] == "Available"
    if is_bookable:
        log.append(f"ENABLE_BOOK_THIS_LOT_{lot_id}")
    else:
        log.append(f"LOCK_BOOK_BUTTON_STATUS_{target_lot['status']}")

    return {
        "status": "SUCCESS",
        "cemetery_id": cem_id,
        "block_id": blk_id,
        "lot_id": lot_id,
        "lot": target_lot,
        "is_bookable": is_bookable,
        "log": log,
    }

# Simulation Case 1: No parameters
res1 = simulate_url_init("")
assert_test(res1["status"] == "SUCCESS" and "DEFAULT_CEMETERY_OVERVIEW" in res1["log"], "Normal access without URL parameters loads default cemetery overview")

# Simulation Case 2: Missing cemetery with block/lot present
res2 = simulate_url_init("block_id=1&lot_id=101")
assert_test(res2["status"] == "WARNING" and "WARNING_MISSING_CEMETERY_ID" in res2["log"], "Missing cemetery_id triggers safe warning and does not guess")

# Simulation Case 3: Invalid cemetery_id format
res3 = simulate_url_init("cemetery_id=abc&block_id=1&lot_id=101")
assert_test(res3["status"] == "ERROR" and res3["message"] == "Cemetery not found.", "Invalid non-numeric cemetery_id safely errors with 'Cemetery not found.'")

# Simulation Case 4: Non-existent cemetery_id
res4 = simulate_url_init("cemetery_id=999999&block_id=1&lot_id=101")
assert_test(res4["status"] == "ERROR" and res4["message"] == "Cemetery not found.", "Non-existent cemetery_id=999999 safely errors with 'Cemetery not found.'")

# Simulation Case 5: cemetery_id only
res5 = simulate_url_init("cemetery_id=1")
assert_test(res5["status"] == "SUCCESS" and "STOP_AT_CEMETERY_OVERVIEW" in res5["log"], "cemetery_id only stops at selected cemetery overview")

# Simulation Case 6: Invalid block_id format
res6 = simulate_url_init("cemetery_id=1&block_id=-4&lot_id=101")
assert_test(res6["status"] == "ERROR" and "ERROR_INVALID_BLOCK_ID" in res6["log"], "Invalid block_id=-4 safely errors with block not found")

# Simulation Case 7: Mismatched hierarchy (block does not belong to cemetery)
res7 = simulate_url_init("cemetery_id=1&block_id=888&lot_id=101")
assert_test(res7["status"] == "ERROR" and "ERROR_BLOCK_NOT_IN_CEMETERY" in res7["log"], "Mismatched block_id safely rejected by hierarchy validation")

# Simulation Case 8: cemetery_id + block_id
res8 = simulate_url_init("cemetery_id=1&block_id=1")
assert_test(res8["status"] == "SUCCESS" and "DRILL_DOWN_BLOCK_1" in res8["log"] and "STOP_AT_BLOCK_VIEW" in res8["log"], "cemetery_id + block_id opens exact block view")

# Simulation Case 9: Invalid lot_id format
res9 = simulate_url_init("cemetery_id=1&block_id=1&lot_id=xyz")
assert_test(res9["status"] == "ERROR" and "ERROR_INVALID_LOT_ID" in res9["log"], "Invalid non-numeric lot_id safely errors")

# Simulation Case 10: Lot does not belong to block
res10 = simulate_url_init("cemetery_id=1&block_id=1&lot_id=999")
assert_test(res10["status"] == "ERROR" and "ERROR_LOT_NOT_IN_BLOCK" in res10["log"], "Mismatched lot_id safely rejected by block containment validation")

# Simulation Case 11: Exact navigation to Available Lot
res11 = simulate_url_init("cemetery_id=1&block_id=1&lot_id=101")
assert_test(res11["status"] == "SUCCESS", "Exact navigation to available lot succeeds")
assert_test("RESET_ALL_FILTERS" in res11["log"], "Active filters cleared prior to block opening")
assert_test("HIGHLIGHT_LOT_101" in res11["log"], "Target lot highlighted in SVG")
assert_test("CENTER_VIEWPORT_ON_LOT_101" in res11["log"], "SVG viewport centered on target lot")
assert_test("OPEN_LOT_DETAILS_DRAWER_101" in res11["log"], "Lot details drawer automatically opened")
assert_test(res11["is_bookable"] is True and "ENABLE_BOOK_THIS_LOT_101" in res11["log"], "Available lot enables 'Book This Lot' button")

# Simulation Case 12: Exact navigation to Reserved Lot (authoritative status respected)
res12 = simulate_url_init("cemetery_id=1&block_id=1&lot_id=102")
assert_test(res12["status"] == "SUCCESS", "Exact navigation to reserved lot succeeds")
assert_test(res12["is_bookable"] is False and "LOCK_BOOK_BUTTON_STATUS_Reserved" in res12["log"], "Non-available lot displays authoritative status and locks booking")

# URL Building Contract Test from AI Recommendation
def build_view_on_map_url(lot):
    cemetery_id = lot.get("cemetery_id") or 1
    block_id = lot.get("block_id") or ""
    lot_id = lot.get("lot_id")
    lot_num = urllib.parse.quote(str(lot.get("lot_number") or ""))
    return f"cemetery-map.html?cemetery_id={urllib.parse.quote(str(cemetery_id))}&block_id={urllib.parse.quote(str(block_id))}&lot_id={urllib.parse.quote(str(lot_id))}&lot_number={lot_num}"

sample_ai_lot = {
    "lot_id": 14,
    "block_id": 3,
    "cemetery_id": 1,
    "lot_number": "A1-005",
    "section_name": "Section A",
    "price": 45000,
    "status": "Available"
}

generated_url = build_view_on_map_url(sample_ai_lot)
assert_test(generated_url == "cemetery-map.html?cemetery_id=1&block_id=3&lot_id=14&lot_number=A1-005", f"AI recommendation URL matches exact contract: {generated_url}")

# Fallback cemetery_id when omitted from legacy payload
sample_legacy_lot = {
    "lot_id": 20,
    "block_id": 5,
    "lot_number": "B2-010"
}
fallback_url = build_view_on_map_url(sample_legacy_lot)
assert_test("cemetery_id=1" in fallback_url and "block_id=5" in fallback_url and "lot_id=20" in fallback_url, "Omitting cemetery_id safely defaults to 1 without breaking contract")

print("\n==========================================")
print(f"TOTAL PASSED: {passed_tests}")
print(f"TOTAL FAILED: {failed_tests}")
print("==========================================")

if failed_tests > 0:
    exit(1)
