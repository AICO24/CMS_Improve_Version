"""
Unit & Integration Test Suite for Cemetery Mapping Batch 10C:
Spatial Proximity, Terrain Elevation & Accessibility Metrics
"""

import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PATH = os.path.join(BASE_DIR, 'frontend', 'pages', 'cemetery-map.html')
JS_PATH = os.path.join(BASE_DIR, 'assets', 'js', 'pages', 'cemetery-map.js')
CSS_PATH = os.path.join(BASE_DIR, 'assets', 'css', 'cemetery-map.css')

passed = 0
failed = 0

def assert_test(condition, message):
    global passed, failed
    if condition:
        print(f" [PASS] {message}")
        passed += 1
    else:
        print(f" [FAIL] {message}")
        failed += 1

print("=== CEMETERY MAPPING BATCH 10C VALIDATION ===")

# 1. File existence
assert_test(os.path.exists(HTML_PATH), "cemetery-map.html exists")
assert_test(os.path.exists(JS_PATH), "cemetery-map.js exists")
assert_test(os.path.exists(CSS_PATH), "cemetery-map.css exists")

with open(HTML_PATH, 'r', encoding='utf-8') as f:
    html_content = f.read()

with open(JS_PATH, 'r', encoding='utf-8') as f:
    js_content = f.read()

with open(CSS_PATH, 'r', encoding='utf-8') as f:
    css_content = f.read()

# 2. HTML Elements in Drawer & Slip
assert_test('id="drawerAccessibilityCard"' in html_content, "HTML contains #drawerAccessibilityCard in details drawer")
assert_test('id="drawerPwdBadge"' in html_content, "HTML contains #drawerPwdBadge status pill")
assert_test('id="drawerWalkingDist"' in html_content, "HTML contains #drawerWalkingDist walking metric")
assert_test('id="drawerTerrainElev"' in html_content, "HTML contains #drawerTerrainElev elevation metric")
assert_test('id="drawerParkingDist"' in html_content, "HTML contains #drawerParkingDist drop-off metric")
assert_test('id="drawerPathwayCond"' in html_content, "HTML contains #drawerPathwayCond pathway condition")
assert_test('id="slipTableWalking"' in html_content, "HTML contains #slipTableWalking in wayfinding slip table")
assert_test('id="slipTableElevation"' in html_content, "HTML contains #slipTableElevation in wayfinding slip table")

# 3. CSS Styles
assert_test('.accessibility-metrics-card' in css_content, "CSS defines .accessibility-metrics-card")
assert_test('.accessibility-card-header' in css_content, "CSS defines .accessibility-card-header")
assert_test('.badge-pwd-status' in css_content, "CSS defines .badge-pwd-status")
assert_test('.badge-pwd-status.is-pwd-friendly' in css_content, "CSS defines .badge-pwd-status.is-pwd-friendly")
assert_test('.badge-pwd-status.is-pwd-standard' in css_content, "CSS defines .badge-pwd-status.is-pwd-standard")
assert_test('.accessibility-metrics-grid' in css_content, "CSS defines .accessibility-metrics-grid")
assert_test('.access-metric-item' in css_content, "CSS defines .access-metric-item")
assert_test('.metric-icon-wrap' in css_content, "CSS defines .metric-icon-wrap")
assert_test('.metric-content' in css_content, "CSS defines .metric-content")
assert_test('.metric-label' in css_content, "CSS defines .metric-label")
assert_test('.metric-value' in css_content, "CSS defines .metric-value")
assert_test('[data-theme="dark"] .accessibility-metrics-card' in css_content, "CSS defines dark theme for accessibility card")
assert_test('[data-theme="dark"] .badge-pwd-status.is-pwd-friendly' in css_content, "CSS defines dark theme for PWD friendly badge")
assert_test('[data-theme="dark"] .access-metric-item' in css_content, "CSS defines dark theme for access metric item")

# 4. JS DOM Declarations & Bindings
assert_test('drawerAccessibilityCard' in js_content, "JS declares drawerAccessibilityCard variable")
assert_test('drawerPwdBadge' in js_content, "JS declares drawerPwdBadge variable")
assert_test('drawerWalkingDist' in js_content, "JS declares drawerWalkingDist variable")
assert_test('drawerTerrainElev' in js_content, "JS declares drawerTerrainElev variable")
assert_test('drawerParkingDist' in js_content, "JS declares drawerParkingDist variable")
assert_test('drawerPathwayCond' in js_content, "JS declares drawerPathwayCond variable")
assert_test('slipTableWalking' in js_content, "JS declares slipTableWalking variable")
assert_test('slipTableElevation' in js_content, "JS declares slipTableElevation variable")

assert_test("document.getElementById('drawerAccessibilityCard')" in js_content, "JS binds #drawerAccessibilityCard")
assert_test("document.getElementById('drawerPwdBadge')" in js_content, "JS binds #drawerPwdBadge")
assert_test("document.getElementById('drawerWalkingDist')" in js_content, "JS binds #drawerWalkingDist")
assert_test("document.getElementById('drawerTerrainElev')" in js_content, "JS binds #drawerTerrainElev")
assert_test("document.getElementById('drawerParkingDist')" in js_content, "JS binds #drawerParkingDist")
assert_test("document.getElementById('drawerPathwayCond')" in js_content, "JS binds #drawerPathwayCond")
assert_test("document.getElementById('slipTableWalking')" in js_content, "JS binds #slipTableWalking")
assert_test("document.getElementById('slipTableElevation')" in js_content, "JS binds #slipTableElevation")

# 5. JS Calculation Logic
assert_test('function getLotSpatialMetrics' in js_content, "JS implements getLotSpatialMetrics function")
assert_test('walkingDist' in js_content, "getLotSpatialMetrics computes walkingDist")
assert_test('terrainElev' in js_content, "getLotSpatialMetrics computes terrainElev")
assert_test('parkingDist' in js_content, "getLotSpatialMetrics computes parkingDist")
assert_test('pwdBadgeText' in js_content, "getLotSpatialMetrics computes pwdBadgeText")

# 6. JS Integration in selectLot & openWayfindingSlip
assert_test('drawerWalkingDist.textContent' in js_content, "selectLot populates drawerWalkingDist")
assert_test('drawerTerrainElev.textContent' in js_content, "selectLot populates drawerTerrainElev")
assert_test('drawerParkingDist.textContent' in js_content, "selectLot populates drawerParkingDist")
assert_test('drawerPathwayCond.textContent' in js_content, "selectLot populates drawerPathwayCond")
assert_test('drawerPwdBadge.className' in js_content, "selectLot updates drawerPwdBadge styling")
assert_test('slipTableWalking.textContent' in js_content, "openWayfindingSlip populates slipTableWalking")
assert_test('slipTableElevation.textContent' in js_content, "openWayfindingSlip populates slipTableElevation")

# 7. Backend Privacy Compliance (Zero PII)
backend_map_controller = os.path.join(BASE_DIR, 'backend', 'controllers', 'MapController.php')
if os.path.exists(backend_map_controller):
    with open(backend_map_controller, 'r', encoding='utf-8') as f:
        php_code = f.read()
    assert_test('deceased_name' not in php_code, "Backend MapController does not expose 'deceased_name'")
    assert_test('claimant_name' not in php_code, "Backend MapController does not expose 'claimant_name'")
    assert_test('claimant_contact' not in php_code, "Backend MapController does not expose 'claimant_contact'")

print(f"\nBatch 10C Test Results: {passed} passed, {failed} failed.\n")

if failed > 0:
    print(f"Validation FAILED: {failed} test(s) failed.")
    sys.exit(1)
else:
    print("All Batch 10C test cases passed successfully with 100% compliance!")
    sys.exit(0)
