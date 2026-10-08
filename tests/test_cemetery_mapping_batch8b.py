"""
Test Suite for Cemetery Mapping Batch 8B:
Location Value Tiering (Prime vs Standard) & Monument/Headstone Guidelines
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


print("=== CEMETERY MAPPING BATCH 8B VALIDATION ===")

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
# 3. HTML LOCATION TIER & MONUMENT GUIDELINES MARKUP
# --------------------------------------------------------------------------
assert_test('id="drawerLocationTierCard"' in map_html, "HTML contains #drawerLocationTierCard")
assert_test('id="drawerLocationTierBadge"' in map_html, "HTML contains #drawerLocationTierBadge")
assert_test('id="drawerLocationTierDesc"' in map_html, "HTML contains #drawerLocationTierDesc")

assert_test('id="drawerMonumentCard"' in map_html, "HTML contains #drawerMonumentCard")
assert_test('id="drawerMonumentRule"' in map_html, "HTML contains #drawerMonumentRule")
assert_test('id="drawerPerpetualCare"' in map_html, "HTML contains #drawerPerpetualCare")
assert_test('id="drawerIntermentPrivilege"' in map_html, "HTML contains #drawerIntermentPrivilege")

# --------------------------------------------------------------------------
# 4. CSS STYLES & DARK THEME ADAPTATION
# --------------------------------------------------------------------------
assert_test('.location-tier-card' in map_css, "CSS defines .location-tier-card")
assert_test('.badge-location-tier' in map_css, "CSS defines .badge-location-tier")
assert_test('.badge-location-tier.is-prime' in map_css, "CSS defines .badge-location-tier.is-prime")
assert_test('.badge-location-tier.is-standard' in map_css, "CSS defines .badge-location-tier.is-standard")
assert_test('.location-tier-desc' in map_css, "CSS defines .location-tier-desc")

assert_test('.monument-guidelines-card' in map_css, "CSS defines .monument-guidelines-card")
assert_test('.badge-guidelines-verified' in map_css, "CSS defines .badge-guidelines-verified")
assert_test('.guideline-spec-list' in map_css, "CSS defines .guideline-spec-list")
assert_test('.guideline-spec-item' in map_css, "CSS defines .guideline-spec-item")
assert_test('.guideline-label' in map_css, "CSS defines .guideline-label")
assert_test('.guideline-value' in map_css, "CSS defines .guideline-value")

assert_test('[data-theme="dark"] .location-tier-card' in map_css, "CSS defines dark theme variant for location tier card")
assert_test('[data-theme="dark"] .badge-location-tier.is-prime' in map_css, "CSS defines dark theme variant for prime tier badge")
assert_test('[data-theme="dark"] .guideline-spec-item' in map_css, "CSS defines dark theme variant for guideline items")

# --------------------------------------------------------------------------
# 5. JAVASCRIPT LOGIC & METADATA BINDINGS
# --------------------------------------------------------------------------
assert_test('drawerLocationTierCard' in map_js, "cemetery-map.js declares drawerLocationTierCard")
assert_test('drawerLocationTierBadge' in map_js, "cemetery-map.js declares drawerLocationTierBadge")
assert_test('drawerLocationTierDesc' in map_js, "cemetery-map.js declares drawerLocationTierDesc")
assert_test('drawerMonumentCard' in map_js, "cemetery-map.js declares drawerMonumentCard")
assert_test('drawerMonumentRule' in map_js, "cemetery-map.js declares drawerMonumentRule")
assert_test('drawerPerpetualCare' in map_js, "cemetery-map.js declares drawerPerpetualCare")
assert_test('drawerIntermentPrivilege' in map_js, "cemetery-map.js declares drawerIntermentPrivilege")

assert_test('document.getElementById(\'drawerLocationTierCard\')' in map_js, "bindElements binds #drawerLocationTierCard")
assert_test('document.getElementById(\'drawerLocationTierBadge\')' in map_js, "bindElements binds #drawerLocationTierBadge")
assert_test('document.getElementById(\'drawerLocationTierDesc\')' in map_js, "bindElements binds #drawerLocationTierDesc")
assert_test('document.getElementById(\'drawerMonumentCard\')' in map_js, "bindElements binds #drawerMonumentCard")
assert_test('document.getElementById(\'drawerMonumentRule\')' in map_js, "bindElements binds #drawerMonumentRule")
assert_test('document.getElementById(\'drawerPerpetualCare\')' in map_js, "bindElements binds #drawerPerpetualCare")
assert_test('document.getElementById(\'drawerIntermentPrivilege\')' in map_js, "bindElements binds #drawerIntermentPrivilege")

assert_test('function getLotLocationTier(' in map_js, "cemetery-map.js implements getLotLocationTier()")
assert_test('drawerMonumentRule.textContent =' in map_js, "renderLotArchetypeShowcase updates drawerMonumentRule")
assert_test('drawerPerpetualCare.textContent =' in map_js, "renderLotArchetypeShowcase updates drawerPerpetualCare")
assert_test('drawerIntermentPrivilege.textContent =' in map_js, "renderLotArchetypeShowcase updates drawerIntermentPrivilege")

# --------------------------------------------------------------------------
# 6. FUNCTIONAL SIMULATION (Location Tiering & Monument Rules)
# --------------------------------------------------------------------------
def simulate_get_lot_location_tier(notes="", num="", lot_type=""):
    notes_str = notes.lower()
    num_str = num.lower()
    type_str = lot_type.lower()

    if any(k in notes_str for k in ['road', 'avenue', 'front', 'gate', 'prime']):
        return 'Prime Roadside Lot', 'is-prime'
    if 'corner' in notes_str or num_str.endswith('-01') or num_str.endswith('-10'):
        return 'Prime Corner Lot', 'is-prime'
    if any(k in type_str for k in ['mausoleum', 'estate', 'garden']):
        return 'Estate Prestige Tier', 'is-prime'
    return 'Standard Interior Lot', 'is-standard'

tier_road, class_road = simulate_get_lot_location_tier(notes="Facing Main Avenue", num="A1-005")
assert_test(tier_road == 'Prime Roadside Lot' and class_road == 'is-prime', "Simulation: Roadside note triggers Prime Roadside Lot")

tier_corner, class_corner = simulate_get_lot_location_tier(notes="Corner plot adjacent to walkway", num="B2-003")
assert_test(tier_corner == 'Prime Corner Lot' and class_corner == 'is-prime', "Simulation: Corner note triggers Prime Corner Lot")

tier_prestige, class_prestige = simulate_get_lot_location_tier(notes="", num="M-001", lot_type="Family Estate")
assert_test(tier_prestige == 'Estate Prestige Tier' and class_prestige == 'is-prime', "Simulation: Family Estate triggers Estate Prestige Tier")

tier_standard, class_standard = simulate_get_lot_location_tier(notes="", num="A1-008", lot_type="Standard Lawn")
assert_test(tier_standard == 'Standard Interior Lot' and class_standard == 'is-standard', "Simulation: Standard plot triggers Standard Interior Lot")

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
