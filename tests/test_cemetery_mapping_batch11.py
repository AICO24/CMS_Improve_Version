"""
Unit & Integration Test Suite for Cemetery Mapping Batch 11:
Today's Services & Funeral Cortège Wayfinding
"""

import os
import sys

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PATH = os.path.join(BASE_DIR, 'frontend', 'pages', 'cemetery-map.html')
JS_PATH = os.path.join(BASE_DIR, 'assets', 'js', 'pages', 'cemetery-map.js')
CSS_PATH = os.path.join(BASE_DIR, 'assets', 'css', 'cemetery-map.css')
API_PATH = os.path.join(BASE_DIR, 'backend', 'routes', 'api.php')
MAP_CTRL_PATH = os.path.join(BASE_DIR, 'backend', 'controllers', 'MapController.php')

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

print("=== CEMETERY MAPPING BATCH 11 VALIDATION ===")

# 1. File existence
assert_test(os.path.exists(HTML_PATH), "cemetery-map.html exists")
assert_test(os.path.exists(JS_PATH), "cemetery-map.js exists")
assert_test(os.path.exists(CSS_PATH), "cemetery-map.css exists")
assert_test(os.path.exists(API_PATH), "backend/routes/api.php exists")
assert_test(os.path.exists(MAP_CTRL_PATH), "backend/controllers/MapController.php exists")

with open(HTML_PATH, 'r', encoding='utf-8') as f:
    html_content = f.read()

with open(JS_PATH, 'r', encoding='utf-8') as f:
    js_content = f.read()

with open(CSS_PATH, 'r', encoding='utf-8') as f:
    css_content = f.read()

with open(API_PATH, 'r', encoding='utf-8') as f:
    api_content = f.read()

with open(MAP_CTRL_PATH, 'r', encoding='utf-8') as f:
    map_ctrl_content = f.read()

# 2. Backend Route & Controller Implementation
assert_test("map/services/today" in api_content, "api.php registers map/services/today route")
assert_test("getTodayServices" in map_ctrl_content, "MapController defines getTodayServices method")
assert_test("burial_schedules" in map_ctrl_content, "MapController queries burial_schedules")
assert_test("cremation_records" in map_ctrl_content, "MapController queries cremation_records")
assert_test("Asia/Manila" in map_ctrl_content or "date_default_timezone" in map_ctrl_content or "date(" in map_ctrl_content, "MapController utilizes application timezone convention")

# 3. Privacy Safeguards in Backend
assert_test("contact_phone" not in map_ctrl_content or "contact_phone" in "no", "MapController does NOT expose claimant contact phone numbers")
assert_test("payment_id" not in map_ctrl_content, "MapController does NOT expose payment transactions")
assert_test("billing" not in map_ctrl_content, "MapController does NOT expose billing details")
assert_test("claimant_address" not in map_ctrl_content, "MapController does NOT expose claimant home address")

# 4. HTML Elements
assert_test('id="btnToggleTodayServices"' in html_content, "HTML contains #btnToggleTodayServices toolbar toggle button")
assert_test('id="todayServicesCountBadge"' in html_content, "HTML contains #todayServicesCountBadge counter badge")
assert_test('id="todayServicesPanel"' in html_content, "HTML contains #todayServicesPanel sliding overlay panel")
assert_test('id="btnCloseTodayServices"' in html_content, "HTML contains #btnCloseTodayServices close button")
assert_test('id="todayServicesLoading"' in html_content, "HTML contains #todayServicesLoading spinner state")
assert_test('id="todayServicesError"' in html_content, "HTML contains #todayServicesError error container")
assert_test('id="btnRetryTodayServices"' in html_content, "HTML contains #btnRetryTodayServices retry action")
assert_test('id="todayServicesEmpty"' in html_content, "HTML contains #todayServicesEmpty empty state")
assert_test('id="todayServicesList"' in html_content, "HTML contains #todayServicesList service cards list")
assert_test('id="drawerTodayServiceBanner"' in html_content, "HTML contains #drawerTodayServiceBanner inside lot details drawer")
assert_test('id="btnDrawerServiceRoute"' in html_content, "HTML contains #btnDrawerServiceRoute in drawer banner")

# 5. CSS Styles
assert_test('.btn-today-services' in css_content, "CSS defines .btn-today-services toolbar button")
assert_test('.badge-services-count' in css_content, "CSS defines .badge-services-count indicator")
assert_test('.today-services-panel' in css_content, "CSS defines .today-services-panel sliding overlay")
assert_test('.today-services-panel.is-open' in css_content, "CSS defines .today-services-panel.is-open active state")
assert_test('.today-service-card' in css_content, "CSS defines .today-service-card")
assert_test('.today-service-card.is-active' in css_content, "CSS defines .today-service-card.is-active state")
assert_test('.service-time-badge' in css_content, "CSS defines .service-time-badge")
assert_test('.service-type-badge' in css_content, "CSS defines .service-type-badge")
assert_test('.service-type-badge--burial' in css_content, "CSS defines .service-type-badge--burial")
assert_test('.service-type-badge--cremation' in css_content, "CSS defines .service-type-badge--cremation")
assert_test('.service-deceased-name' in css_content, "CSS defines .service-deceased-name")
assert_test('.btn-service-action' in css_content, "CSS defines .btn-service-action")
assert_test('.svg-lot-tile.has-scheduled-service' in css_content, "CSS defines .svg-lot-tile.has-scheduled-service ceremonial lot marker")
assert_test('.svg-landmark-bldg.has-scheduled-service' in css_content, "CSS defines .svg-landmark-bldg.has-scheduled-service ceremonial facility marker")
assert_test('.is-cortege-route' in css_content, "CSS defines .is-cortege-route funeral cortège styling")
assert_test('.drawer-today-service-banner' in css_content, "CSS defines .drawer-today-service-banner")
assert_test('[data-theme="dark"] .today-services-panel' in css_content, "CSS supports dark mode for today-services-panel")
assert_test('@media (max-width: 768px)' in css_content and 'today-services-panel' in css_content, "CSS supports mobile responsive layout for today services panel")

# 6. JavaScript State & Functions
assert_test('todayServices: []' in js_content, "JS state contains todayServices array")
assert_test('isTodayServicesOpen:' in js_content, "JS state contains isTodayServicesOpen boolean")
assert_test('activeCortegeService:' in js_content, "JS state contains activeCortegeService reference")
assert_test('function formatServiceTime' in js_content, "JS implements formatServiceTime()")
assert_test('function loadTodayServices' in js_content, "JS implements loadTodayServices()")
assert_test('function toggleTodayServices' in js_content, "JS implements toggleTodayServices()")
assert_test('function renderTodayServicesList' in js_content, "JS implements renderTodayServicesList()")
assert_test('function resolveServiceLot' in js_content, "JS implements resolveServiceLot()")
assert_test('function viewServiceOnMap' in js_content, "JS implements viewServiceOnMap()")
assert_test('function routeToTodayService' in js_content, "JS implements routeToTodayService()")
assert_test('function generateRouteToFacility' in js_content, "JS implements generateRouteToFacility()")
assert_test('function highlightServiceLotsOnMap' in js_content, "JS implements highlightServiceLotsOnMap()")

# 7. Route and Guidance Reuse (Batch 6 & 7 Preservation)
assert_test('generateRouteToLot(' in js_content, "routeToTodayService reuses existing generateRouteToLot()")
assert_test('dijkstraShortestPath(' in js_content, "Facility routing reuses existing dijkstraShortestPath() solver")
assert_test('renderRouteSvg(' in js_content, "Cortège routing reuses existing renderRouteSvg()")
assert_test('updateRouteInfoCard(' in js_content, "Cortège routing reuses existing updateRouteInfoCard()")
assert_test('setActiveRouteStep(' in js_content, "Cortège routing reuses existing setActiveRouteStep()")
assert_test('isCortege' in js_content or 'is-cortege-route' in js_content, "Route renderer supports Funeral Cortège visual mode")

# 8. Hierarchy & State Integration
assert_test('drawerTodayServiceBanner' in js_content, "selectLot populates drawerTodayServiceBanner")
assert_test('toggleTodayServices(false)' in js_content, "Escape key dismisses Today's Services overlay")
assert_test('state.todayServices = []' in js_content, "Cemetery switch clears Today's Services state")

# 9. Accessibility
assert_test('role="region"' in html_content or 'role="region"' in js_content, "Accessible landmark roles implemented")
assert_test('aria-expanded' in js_content, "Aria-expanded toggled on service panel button")
assert_test('aria-label' in js_content, "Descriptive aria-labels provided on service cards and action buttons")

print("---------------------------------------------")
print(f"Total assertions: {passed + failed}")
print(f"Passed: {passed}")
print(f"Failed: {failed}")

if failed == 0:
    print(">>> ALL BATCH 11 TESTS PASSED SUCCESSFULLY! <<<")
    sys.exit(0)
else:
    print(">>> SOME TESTS FAILED! <<<")
    sys.exit(1)
