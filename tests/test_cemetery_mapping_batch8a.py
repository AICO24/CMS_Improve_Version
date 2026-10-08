"""
Test Suite for Cemetery Mapping Batch 8A:
Lot Visual Archetype Showcase & Philippine Memorial Park Specifications
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


print("=== CEMETERY MAPPING BATCH 8A VALIDATION ===")

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
# 2. PRIVACY & SECURITY AUDIT (Zero Deceased / Claimant PII Exposure)
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
# 3. HTML ARCHETYPE SHOWCASE STRUCTURE
# --------------------------------------------------------------------------
assert_test('id="drawerVisualShowcase"' in map_html, "HTML contains #drawerVisualShowcase showcase container")
assert_test('id="drawerImageFrame"' in map_html, "HTML contains #drawerImageFrame container")
assert_test('id="drawerArchetypeGraphic"' in map_html, "HTML contains #drawerArchetypeGraphic dynamic vector preview")
assert_test('id="drawerArchetypeBadge"' in map_html, "HTML contains #drawerArchetypeBadge badge wrapper")
assert_test('id="drawerArchetypeBadgeText"' in map_html, "HTML contains #drawerArchetypeBadgeText title label")
assert_test('id="drawerCapacityPill"' in map_html, "HTML contains #drawerCapacityPill quick spec pill")
assert_test('id="drawerCapacityText"' in map_html, "HTML contains #drawerCapacityText capacity display")
assert_test('id="drawerDimensionPill"' in map_html, "HTML contains #drawerDimensionPill quick spec pill")
assert_test('id="drawerDimensionSpec"' in map_html, "HTML contains #drawerDimensionSpec dimensions display")

# --------------------------------------------------------------------------
# 4. CSS SHOWCASE STYLING & DARK MODE PARITY
# --------------------------------------------------------------------------
assert_test('.drawer-visual-showcase' in map_css, "CSS defines .drawer-visual-showcase layout")
assert_test('.archetype-image-frame' in map_css, "CSS defines .archetype-image-frame showcase card")
assert_test('.archetype-graphic' in map_css, "CSS defines .archetype-graphic vector container")
assert_test('.archetype-badge-pill' in map_css, "CSS defines .archetype-badge-pill glassmorphic badge")
assert_test('.archetype-quick-specs' in map_css, "CSS defines .archetype-quick-specs 2-column grid")
assert_test('.spec-pill' in map_css, "CSS defines .spec-pill specification badge")
assert_test('[data-theme="dark"] .archetype-image-frame' in map_css, "CSS defines dark theme variant for archetype frame")
assert_test('[data-theme="dark"] .spec-pill' in map_css, "CSS defines dark theme variant for spec pills")

# --------------------------------------------------------------------------
# 5. JAVASCRIPT LOGIC & ARCHETYPE MATRIX BINDINGS
# --------------------------------------------------------------------------
assert_test('drawerVisualShowcase' in map_js, "cemetery-map.js declares drawerVisualShowcase")
assert_test('drawerArchetypeGraphic' in map_js, "cemetery-map.js declares drawerArchetypeGraphic")
assert_test('drawerArchetypeBadgeText' in map_js, "cemetery-map.js declares drawerArchetypeBadgeText")
assert_test('drawerCapacityText' in map_js, "cemetery-map.js declares drawerCapacityText")
assert_test('drawerDimensionSpec' in map_js, "cemetery-map.js declares drawerDimensionSpec")

assert_test('document.getElementById(\'drawerVisualShowcase\')' in map_js, "bindElements binds #drawerVisualShowcase")
assert_test('document.getElementById(\'drawerArchetypeGraphic\')' in map_js, "bindElements binds #drawerArchetypeGraphic")
assert_test('document.getElementById(\'drawerArchetypeBadgeText\')' in map_js, "bindElements binds #drawerArchetypeBadgeText")
assert_test('document.getElementById(\'drawerCapacityText\')' in map_js, "bindElements binds #drawerCapacityText")
assert_test('document.getElementById(\'drawerDimensionSpec\')' in map_js, "bindElements binds #drawerDimensionSpec")

assert_test('const LOT_ARCHETYPES =' in map_js, "cemetery-map.js defines LOT_ARCHETYPES matrix")
assert_test('lawn:' in map_js, "LOT_ARCHETYPES defines Lawn Lot archetype")
assert_test('garden:' in map_js, "LOT_ARCHETYPES defines Garden Memorial archetype")
assert_test('mausoleum:' in map_js, "LOT_ARCHETYPES defines Family Estate / Mausoleum archetype")
assert_test('columbarium:' in map_js, "LOT_ARCHETYPES defines Columbarium Wall Niche archetype")

assert_test('function getLotArchetype(' in map_js, "cemetery-map.js implements getLotArchetype() detector")
assert_test('function renderLotArchetypeShowcase(' in map_js, "cemetery-map.js implements renderLotArchetypeShowcase()")
assert_test('renderLotArchetypeShowcase(lot)' in map_js, "selectLot() invokes renderLotArchetypeShowcase(lot)")

# --------------------------------------------------------------------------
# 6. FUNCTIONAL SIMULATION (Philippine Memorial Standards Matching)
# --------------------------------------------------------------------------
def simulate_get_lot_archetype(lot_type="", lot_number="", location_notes=""):
    combined = f"{lot_type} {lot_number} {location_notes}".lower()
    if any(k in combined for k in ['columb', 'niche', 'ossuary', 'cremat']):
        return 'columbarium'
    if any(k in combined for k in ['mausoleum', 'estate', 'family', 'pavilion']):
        return 'mausoleum'
    if any(k in combined for k in ['garden', 'monument', 'curb', 'terrace']):
        return 'garden'
    return 'lawn'

assert_test(simulate_get_lot_archetype('Standard Lawn', 'A1-001') == 'lawn', "Simulation: Standard Lawn resolves to 'lawn'")
assert_test(simulate_get_lot_archetype('Garden Plot', 'G-102') == 'garden', "Simulation: Garden Plot resolves to 'garden'")
assert_test(simulate_get_lot_archetype('Family Estate', 'M-005') == 'mausoleum', "Simulation: Family Estate resolves to 'mausoleum'")
assert_test(simulate_get_lot_archetype('Columbarium Niche', 'CN-401') == 'columbarium', "Simulation: Columbarium Niche resolves to 'columbarium'")
assert_test(simulate_get_lot_archetype('', 'UNKNOWN-01') == 'lawn', "Simulation: Unspecified default resolves safely to 'lawn'")

# --------------------------------------------------------------------------
# SUMMARY REPORT
# --------------------------------------------------------------------------
print("\n==========================================")
print(f"TOTAL PASSED: {passed}")
print(f"TOTAL FAILED: {len(errors)}")
print("==========================================\n")

if errors:
    sys.exit(1)
sys.exit(0)
