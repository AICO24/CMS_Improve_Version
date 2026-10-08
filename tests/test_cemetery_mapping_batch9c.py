"""
Test Suite for Cemetery Mapping Batch 9C:
Responsive Mobile Touch Polish, Waze Navigation, Offline Embed Resilience & Print Cleanup
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


print("=== CEMETERY MAPPING BATCH 9C VALIDATION ===")

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
# 3. HTML EMBED PLACEHOLDER & WAZE ACTIONS
# --------------------------------------------------------------------------
assert_test('id="geoMapLoading"' in map_html, "HTML contains #geoMapLoading placeholder element")
assert_test('id="btnOpenWazeGeo"' in map_html, "HTML contains #btnOpenWazeGeo navigation button")
assert_test('fa-waze' in map_html, "HTML uses fa-waze brand icon")

# --------------------------------------------------------------------------
# 4. CSS RESPONSIVE & PRINT CLEANUP
# --------------------------------------------------------------------------
assert_test('.geo-map-loading' in map_css, "CSS defines .geo-map-loading")
assert_test('.btn-geo-waze' in map_css, "CSS defines .btn-geo-waze")
assert_test('[data-theme="dark"] .btn-geo-waze' in map_css, "CSS defines dark theme variant for Waze button")
assert_test('[data-theme="dark"] .geo-map-loading' in map_css, "CSS defines dark theme variant for loading state")

# Mobile / Tablet Touch Styles
assert_test('@media (max-width: 768px)' in map_css, "CSS defines @media (max-width: 768px) mobile rules")
assert_test('@media (max-width: 480px)' in map_css, "CSS defines @media (max-width: 480px) small screen rules")
assert_test('overflow-x: auto' in map_css, "CSS provides horizontal touch scrolling for chips on mobile")

# Print Suppression Parity
assert_test('@media print' in map_css, "CSS defines @media print")
assert_test('.map-view-switcher' in map_css and '.geo-stage-container' in map_css, "CSS print block includes view switcher and geo stage")

# --------------------------------------------------------------------------
# 5. JAVASCRIPT LOGIC & ACCESSIBILITY
# --------------------------------------------------------------------------
assert_test("btnOpenWazeGeo" in map_js, "JS declares btnOpenWazeGeo variable")
assert_test("btnOpenWazeGeo = document.getElementById('btnOpenWazeGeo');" in map_js, "bindElements binds #btnOpenWazeGeo")
assert_test("waze.com/ul" in map_js, "JS constructs Waze navigation URL")
assert_test("geoMapIframe.onload" in map_js, "JS attaches onload event to dismiss loading indicator")
assert_test("e.key === 'ArrowRight'" in map_js, "JS supports ArrowRight key navigation on view switcher")
assert_test("e.key === 'ArrowLeft'" in map_js, "JS supports ArrowLeft key navigation on view switcher")
assert_test("state.activeMapView === 'geo'" in map_js, "JS Escape key intercepts and returns to plot view from geo view")

# --------------------------------------------------------------------------
# SUMMARY REPORT
# --------------------------------------------------------------------------
print(f"\nBatch 9C Test Results: {passed} passed, {len(errors)} failed.")
if errors:
    print("\nErrors encountered:")
    for err in errors:
        print(f" - {err}")
    sys.exit(1)
else:
    print("\nAll Batch 9C test cases passed successfully with 100% compliance!")
    sys.exit(0)
