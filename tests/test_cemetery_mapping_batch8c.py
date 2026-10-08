"""
Test Suite for Cemetery Mapping Batch 8C:
Fullscreen Visual Lightbox & Printable Slip Parity
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


print("=== CEMETERY MAPPING BATCH 8C VALIDATION ===")

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
# 3. HTML LIGHTBOX & SLIP PARITY ELEMENTS
# --------------------------------------------------------------------------
assert_test('id="btnExpandArchetype"' in map_html, "HTML contains #btnExpandArchetype inspect trigger")
assert_test('id="archetypeLightboxModal"' in map_html, "HTML contains #archetypeLightboxModal backdrop")
assert_test('id="btnCloseLightbox"' in map_html, "HTML contains #btnCloseLightbox dismiss button")
assert_test('id="lightboxTitle"' in map_html, "HTML contains #lightboxTitle modal heading")
assert_test('id="lightboxGraphicStage"' in map_html, "HTML contains #lightboxGraphicStage enlarged canvas")
assert_test('id="lightboxArchetypeBadge"' in map_html, "HTML contains #lightboxArchetypeBadge")
assert_test('id="lightboxTierBadge"' in map_html, "HTML contains #lightboxTierBadge")
assert_test('id="lightboxLotHeading"' in map_html, "HTML contains #lightboxLotHeading")
assert_test('id="lightboxLotDesc"' in map_html, "HTML contains #lightboxLotDesc")
assert_test('id="lightboxCapacityVal"' in map_html, "HTML contains #lightboxCapacityVal")
assert_test('id="lightboxDimensionsVal"' in map_html, "HTML contains #lightboxDimensionsVal")
assert_test('id="lightboxMonumentVal"' in map_html, "HTML contains #lightboxMonumentVal")
assert_test('id="lightboxCareVal"' in map_html, "HTML contains #lightboxCareVal")
assert_test('id="lightboxIntermentVal"' in map_html, "HTML contains #lightboxIntermentVal")
assert_test('id="lightboxPriceVal"' in map_html, "HTML contains #lightboxPriceVal")

assert_test('id="slipArchetypeBox"' in map_html, "HTML contains #slipArchetypeBox inside printable slip")
assert_test('id="slipArchetypePreview"' in map_html, "HTML contains #slipArchetypePreview inside printable slip")
assert_test('id="slipMonumentRule"' in map_html, "HTML contains #slipMonumentRule inside printable slip")
assert_test('id="slipCapacityRule"' in map_html, "HTML contains #slipCapacityRule inside printable slip")
assert_test('id="slipLocationTierRule"' in map_html, "HTML contains #slipLocationTierRule inside printable slip")

# --------------------------------------------------------------------------
# 4. CSS STYLES & PRINT MEDIA PARITY
# --------------------------------------------------------------------------
assert_test('.btn-expand-archetype' in map_css, "CSS defines .btn-expand-archetype")
assert_test('.archetype-lightbox-backdrop' in map_css, "CSS defines .archetype-lightbox-backdrop")
assert_test('.archetype-lightbox-dialog' in map_css, "CSS defines .archetype-lightbox-dialog")
assert_test('.archetype-lightbox-header' in map_css, "CSS defines .archetype-lightbox-header")
assert_test('.archetype-lightbox-body' in map_css, "CSS defines .archetype-lightbox-body")
assert_test('.lightbox-graphic-stage' in map_css, "CSS defines .lightbox-graphic-stage")
assert_test('.lightbox-details-panel' in map_css, "CSS defines .lightbox-details-panel")
assert_test('.lightbox-specs-grid' in map_css, "CSS defines .lightbox-specs-grid")
assert_test('.lightbox-spec-item' in map_css, "CSS defines .lightbox-spec-item")

assert_test('.slip-archetype-box' in map_css, "CSS defines .slip-archetype-box")
assert_test('.slip-archetype-preview' in map_css, "CSS defines .slip-archetype-preview")
assert_test('.slip-archetype-details' in map_css, "CSS defines .slip-archetype-details")

assert_test('[data-theme="dark"] .lightbox-graphic-stage' in map_css, "CSS defines dark theme variant for graphic stage")
assert_test('[data-theme="dark"] .lightbox-spec-item' in map_css, "CSS defines dark theme variant for lightbox spec items")

# Verify @media print rules
print_media_section = map_css.split("@media print")[-1]
assert_test('.slip-archetype-box' in print_media_section, "CSS @media print contains .slip-archetype-box rules")
assert_test('page-break-inside: avoid' in print_media_section, "CSS @media print protects slip elements from page break splitting")

# --------------------------------------------------------------------------
# 5. JAVASCRIPT LOGIC & BINDINGS
# --------------------------------------------------------------------------
assert_test('btnExpandArchetype' in map_js, "cemetery-map.js declares btnExpandArchetype")
assert_test('archetypeLightboxModal' in map_js, "cemetery-map.js declares archetypeLightboxModal")
assert_test('btnCloseLightbox' in map_js, "cemetery-map.js declares btnCloseLightbox")
assert_test('lightboxGraphicStage' in map_js, "cemetery-map.js declares lightboxGraphicStage")
assert_test('slipArchetypeBox' in map_js, "cemetery-map.js declares slipArchetypeBox")
assert_test('slipArchetypePreview' in map_js, "cemetery-map.js declares slipArchetypePreview")

assert_test('document.getElementById(\'btnExpandArchetype\')' in map_js, "bindElements binds #btnExpandArchetype")
assert_test('document.getElementById(\'archetypeLightboxModal\')' in map_js, "bindElements binds #archetypeLightboxModal")
assert_test('document.getElementById(\'btnCloseLightbox\')' in map_js, "bindElements binds #btnCloseLightbox")
assert_test('document.getElementById(\'slipArchetypeBox\')' in map_js, "bindElements binds #slipArchetypeBox")
assert_test('document.getElementById(\'slipArchetypePreview\')' in map_js, "bindElements binds #slipArchetypePreview")

assert_test('function openArchetypeLightbox(' in map_js, "cemetery-map.js implements openArchetypeLightbox()")
assert_test('function closeArchetypeLightbox(' in map_js, "cemetery-map.js implements closeArchetypeLightbox()")

# Check slip archetype population inside openWayfindingSlip
assert_test('slipArchetypePreview.innerHTML = archetype.svg' in map_js, "openWayfindingSlip renders vector preview in slip")
assert_test('slipMonumentRule.textContent =' in map_js, "openWayfindingSlip populates monument rules in slip")
assert_test('slipCapacityRule.textContent =' in map_js, "openWayfindingSlip populates capacity rules in slip")
assert_test('slipLocationTierRule.textContent =' in map_js, "openWayfindingSlip populates location tier in slip")

# --------------------------------------------------------------------------
# 6. FUNCTIONAL SIMULATION (Multi-Modal Orchestration)
# --------------------------------------------------------------------------
# Verify ESC key handling logic closes lightbox or slip
escape_handler_matches = re.search(r"window\.addEventListener\('keydown',\s*\(e\)\s*=>\s*\{([\s\S]+?)\}\);", map_js)
assert_test(escape_handler_matches is not None, "Global keyboard listener intercepts 'Escape' key")
if escape_handler_matches:
    body = escape_handler_matches.group(1)
    assert_test('closeArchetypeLightbox' in body, "Escape handler triggers closeArchetypeLightbox()")
    assert_test('closeWayfindingSlip' in body, "Escape handler triggers closeWayfindingSlip()")

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
