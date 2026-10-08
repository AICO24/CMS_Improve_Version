"""
Test Suite for Cemetery Mapping Batch 9B:
Facility Landmarks, Gate Wayfinding Cues, and GPS Route Navigation Integration
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent

errors = []
passed = 0


def assert_test(condition, name, details=""):
    global passed, errors
    if condition:
        print(f" [PASS] {name}")
        passed += 1
    else:
        msg = f" [FAIL] {name}: {details}" if details else f" [FAIL] {name}"
        print(msg)
        errors.append(msg)


print("=== CEMETERY MAPPING BATCH 9B VALIDATION ===")

# --------------------------------------------------------------------------
# 1. FILE EXISTENCE & INTEGRITY
# --------------------------------------------------------------------------
map_html_path = ROOT / "frontend" / "pages" / "cemetery-map.html"
map_js_path = ROOT / "assets" / "js" / "pages" / "cemetery-map.js"
map_css_path = ROOT / "assets" / "css" / "cemetery-map.css"
map_ctrl_path = ROOT / "backend" / "controllers" / "MapController.php"

assert_test(map_html_path.exists(), "cemetery-map.html exists")
assert_test(map_js_path.exists(), "cemetery-map.js exists")
assert_test(map_css_path.exists(), "cemetery-map.css exists")
assert_test(map_ctrl_path.exists(), "MapController.php exists")

map_html = map_html_path.read_text(encoding="utf-8")
map_js = map_js_path.read_text(encoding="utf-8")
map_css = map_css_path.read_text(encoding="utf-8")
map_ctrl = map_ctrl_path.read_text(encoding="utf-8")

# --------------------------------------------------------------------------
# 2. PRIVACY & SECURITY AUDIT (Zero PII Exposure)
# --------------------------------------------------------------------------
forbidden_tokens = [
    "deceased_name",
    "decedent_name",
    "claimant_name",
    "claimant_contact",
    "claimant_email",
    "payment_method",
    "paymongo_payment_id",
    "internal_notes"
]

for token in forbidden_tokens:
    assert_test(
        token not in map_ctrl,
        f"Backend MapController does not expose '{token}'",
        f"Found forbidden token '{token}' in MapController.php"
    )

# --------------------------------------------------------------------------
# 3. HTML LANDMARKS TRAY & DRAWER ACCESS CARD STRUCTURE
# --------------------------------------------------------------------------
# Geo HUD Landmark Tray
assert_test('id="geoLandmarksTray"' in map_html, "HTML contains #geoLandmarksTray in Geo HUD")
assert_test('id="geoLandmarkGate"' in map_html, "HTML contains #geoLandmarkGate item")
assert_test('id="geoLandmarkOffice"' in map_html, "HTML contains #geoLandmarkOffice item")
assert_test('id="geoLandmarkParking"' in map_html, "HTML contains #geoLandmarkParking item")
assert_test('id="geoLandmarkChapel"' in map_html, "HTML contains #geoLandmarkChapel item")

# Drawer Facility Access Card
assert_test('id="drawerFacilityAccessCard"' in map_html, "HTML contains #drawerFacilityAccessCard in details drawer")
assert_test('id="drawerAccessGateBadge"' in map_html, "HTML contains #drawerAccessGateBadge")
assert_test('id="drawerAccessGateText"' in map_html, "HTML contains #drawerAccessGateText arrival point")
assert_test('id="drawerAccessAddressText"' in map_html, "HTML contains #drawerAccessAddressText address")
assert_test('id="btnDrawerDirections"' in map_html, "HTML contains #btnDrawerDirections turn-by-turn button")
assert_test('id="btnDrawerViewGeoMap"' in map_html, "HTML contains #btnDrawerViewGeoMap switch-to-geo button")

# --------------------------------------------------------------------------
# 4. CSS STYLING & DESIGN SYSTEM PARITY
# --------------------------------------------------------------------------
assert_test('.geo-landmarks-tray' in map_css, "CSS defines .geo-landmarks-tray")
assert_test('.geo-landmarks-title' in map_css, "CSS defines .geo-landmarks-title")
assert_test('.geo-landmarks-list' in map_css, "CSS defines .geo-landmarks-list")
assert_test('.geo-landmark-item' in map_css, "CSS defines .geo-landmark-item")
assert_test('.facility-access-card' in map_css, "CSS defines .facility-access-card")
assert_test('.badge-access-gate' in map_css, "CSS defines .badge-access-gate")
assert_test('.facility-access-body' in map_css, "CSS defines .facility-access-body")
assert_test('.access-route-row' in map_css, "CSS defines .access-route-row")
assert_test('.btn-drawer-directions' in map_css, "CSS defines .btn-drawer-directions")
assert_test('.btn-drawer-geo-view' in map_css, "CSS defines .btn-drawer-geo-view")

# Dark Theme Rules
assert_test('[data-theme="dark"] .geo-landmarks-tray' in map_css, "CSS defines dark theme variant for landmarks tray")
assert_test('[data-theme="dark"] .facility-access-card' in map_css, "CSS defines dark theme variant for access card")
assert_test('[data-theme="dark"] .badge-access-gate' in map_css, "CSS defines dark theme variant for gate badge")
assert_test('[data-theme="dark"] .btn-drawer-geo-view' in map_css, "CSS defines dark theme variant for drawer geo view button")

# --------------------------------------------------------------------------
# 5. JAVASCRIPT CONTROLLER ARCHITECTURE
# --------------------------------------------------------------------------
assert_test("let geoLandmarksTray, geoLandmarkGate, geoLandmarkOffice, geoLandmarkParking, geoLandmarkChapel;" in map_js, "JS declares landmark tray DOM variables")
assert_test("let drawerFacilityAccessCard, drawerAccessGateBadge, drawerAccessGateText, drawerAccessAddressText, btnDrawerDirections, btnDrawerViewGeoMap;" in map_js, "JS declares drawer access card DOM variables")

# Element Binding
assert_test("geoLandmarksTray = document.getElementById('geoLandmarksTray');" in map_js, "bindElements binds #geoLandmarksTray")
assert_test("drawerFacilityAccessCard = document.getElementById('drawerFacilityAccessCard');" in map_js, "bindElements binds #drawerFacilityAccessCard")
assert_test("btnDrawerViewGeoMap = document.getElementById('btnDrawerViewGeoMap');" in map_js, "bindElements binds #btnDrawerViewGeoMap")

# Event Listeners
assert_test("btnDrawerViewGeoMap.addEventListener('click'" in map_js, "attachEventListeners binds #btnDrawerViewGeoMap click")
assert_test("switchMapView('geo')" in map_js, "#btnDrawerViewGeoMap triggers switchMapView('geo')")

# Drawer Population & Slip Gate Cue
assert_test("if (drawerFacilityAccessCard)" in map_js, "selectLot populates #drawerFacilityAccessCard")
assert_test("drawerAccessGateBadge" in map_js, "selectLot updates drawerAccessGateBadge")
assert_test("btnDrawerDirections.href" in map_js, "selectLot sets Google Maps directions URL on btnDrawerDirections")
assert_test("slipStepFacility" in map_js, "openWayfindingSlip links facility entrance with gate cue")

# --------------------------------------------------------------------------
# SUMMARY REPORT
# --------------------------------------------------------------------------
print(f"\nBatch 9B Test Results: {passed} passed, {len(errors)} failed.")
if errors:
    print("\nErrors encountered:")
    for err in errors:
        print(f" - {err}")
    sys.exit(1)
else:
    print("\nAll Batch 9B test cases passed successfully with 100% compliance!")
    sys.exit(0)
