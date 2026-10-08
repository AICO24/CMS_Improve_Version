"""
Test Suite for Cemetery Mapping Batch 9A:
Real-World Cemetery Geographic Location & Google Maps Dual-View Experience
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


print("=== CEMETERY MAPPING BATCH 9A VALIDATION ===")

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
# 3. HTML DUAL-VIEW & GEOGRAPHIC VIEWPORT STRUCTURE
# --------------------------------------------------------------------------
assert_test('id="mapViewSwitcher"' in map_html, "HTML contains #mapViewSwitcher toggle container")
assert_test('id="btnSwitchPlotView"' in map_html, "HTML contains #btnSwitchPlotView tab button")
assert_test('id="btnSwitchGeoView"' in map_html, "HTML contains #btnSwitchGeoView tab button")
assert_test('id="geoStageContainer"' in map_html, "HTML contains #geoStageContainer viewport")
assert_test('id="geoMapFrame"' in map_html, "HTML contains #geoMapFrame wrapper")
assert_test('id="geoMapIframe"' in map_html, "HTML contains #geoMapIframe iframe element")

# Zone Selector Chips in HTML
assert_test('id="geoZoneSelectorBar"' in map_html, "HTML contains #geoZoneSelectorBar overlay")
assert_test('id="geoZoneChips"' in map_html, "HTML contains #geoZoneChips container")
assert_test('data-zone="lawn"' in map_html, "HTML contains lawn lot zone chip")
assert_test('data-zone="garden"' in map_html, "HTML contains garden memorial zone chip")
assert_test('data-zone="mausoleum"' in map_html, "HTML contains mausoleum avenue zone chip")
assert_test('data-zone="columbarium"' in map_html, "HTML contains columbarium sanctuary zone chip")

# Facility Real-World HUD in HTML
assert_test('id="geoFacilityHud"' in map_html, "HTML contains #geoFacilityHud card")
assert_test('id="geoHudFacilityName"' in map_html, "HTML contains #geoHudFacilityName element")
assert_test('id="geoHudAddress"' in map_html, "HTML contains #geoHudAddress element")
assert_test('id="geoHudAccessCue"' in map_html, "HTML contains #geoHudAccessCue element")
assert_test('id="btnGetDirectionsGeo"' in map_html, "HTML contains #btnGetDirectionsGeo navigation link")
assert_test('id="btnReturnPlotsGeo"' in map_html, "HTML contains #btnReturnPlotsGeo back button")

# --------------------------------------------------------------------------
# 4. CSS STYLING & DESIGN SYSTEM PARITY
# --------------------------------------------------------------------------
assert_test('.map-view-switcher' in map_css, "CSS contains .map-view-switcher layout rules")
assert_test('.view-switch-btn' in map_css, "CSS contains .view-switch-btn rules")
assert_test('.view-switch-btn.active' in map_css, "CSS contains active switcher highlight")
assert_test('.geo-stage-container' in map_css, "CSS contains .geo-stage-container rules")
assert_test('.geo-map-frame' in map_css, "CSS contains .geo-map-frame rules")
assert_test('.geo-map-iframe' in map_css, "CSS contains .geo-map-iframe rules")
assert_test('.geo-zone-selector-bar' in map_css, "CSS contains .geo-zone-selector-bar rules")
assert_test('.zone-chip-btn' in map_css, "CSS contains .zone-chip-btn rules")
assert_test('.chip-lawn' in map_css, "CSS contains .chip-lawn archetype chip styling")
assert_test('.chip-garden' in map_css, "CSS contains .chip-garden archetype chip styling")
assert_test('.chip-mausoleum' in map_css, "CSS contains .chip-mausoleum archetype chip styling")
assert_test('.chip-columbarium' in map_css, "CSS contains .chip-columbarium archetype chip styling")
assert_test('.geo-facility-hud' in map_css, "CSS contains .geo-facility-hud HUD card styles")
assert_test('.btn-geo-directions' in map_css, "CSS contains .btn-geo-directions styling")
assert_test('.btn-geo-return-plots' in map_css, "CSS contains .btn-geo-return-plots styling")

# Dark Theme Parity
assert_test('[data-theme="dark"] .map-view-switcher' in map_css, "CSS has dark mode for view switcher")
assert_test('[data-theme="dark"] .geo-stage-container' in map_css, "CSS has dark mode for geo stage container")
assert_test('[data-theme="dark"] .geo-zone-selector-bar' in map_css, "CSS has dark mode for zone bar")
assert_test('[data-theme="dark"] .geo-facility-hud' in map_css, "CSS has dark mode for geo facility HUD")

# --------------------------------------------------------------------------
# 5. JAVASCRIPT CONTROLLER ARCHITECTURE
# --------------------------------------------------------------------------
assert_test("activeMapView: 'plot'" in map_js, "JS state tracks activeMapView mode")
assert_test("let mapViewSwitcher, btnSwitchPlotView, btnSwitchGeoView;" in map_js, "JS declares view switcher elements")
assert_test("let geoStageContainer, geoMapFrame, geoMapIframe;" in map_js, "JS declares geo map iframe elements")
assert_test("let geoZoneSelectorBar, geoZoneChips;" in map_js, "JS declares zone selector chips elements")
assert_test("let geoFacilityHud, geoHudFacilityName, geoHudAddress, geoHudAccessCue, btnGetDirectionsGeo, btnReturnPlotsGeo;" in map_js, "JS declares geo HUD elements")

# Function implementations
assert_test("function switchMapView(" in map_js, "JS implements switchMapView controller")
assert_test("function loadGeoFacilityMap(" in map_js, "JS implements loadGeoFacilityMap controller")
assert_test("function handleGeoZoneSelect(" in map_js, "JS implements handleGeoZoneSelect controller")

# Event listeners
assert_test("btnSwitchPlotView.addEventListener('click'" in map_js, "JS attaches btnSwitchPlotView listener")
assert_test("btnSwitchGeoView.addEventListener('click'" in map_js, "JS attaches btnSwitchGeoView listener")
assert_test("btnReturnPlotsGeo.addEventListener('click'" in map_js, "JS attaches btnReturnPlotsGeo listener")
assert_test("handleGeoZoneSelect" in map_js, "JS connects zone chip click to handleGeoZoneSelect")

# Google Maps Directions & Embed Generation
assert_test("maps.google.com/maps?q=" in map_js, "JS constructs Google Maps embed URL with query/coordinates")
assert_test("google.com/maps/dir/?api=1" in map_js, "JS constructs turn-by-turn directions link")

# --------------------------------------------------------------------------
# SUMMARY REPORT
# --------------------------------------------------------------------------
print(f"\nBatch 9A Test Results: {passed} passed, {len(errors)} failed.")
if errors:
    print("\nErrors encountered:")
    for err in errors:
        print(f" - {err}")
    sys.exit(1)
else:
    print("\nAll Batch 9A test cases passed successfully with 100% compliance!")
    sys.exit(0)
