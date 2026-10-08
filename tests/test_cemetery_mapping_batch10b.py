"""
Unit & Integration Test Suite for Cemetery Mapping Batch 10B:
Actual Lot Appearance & Perspective Rendering Showcase
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

print("=== CEMETERY MAPPING BATCH 10B VALIDATION ===")

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

# 2. HTML Elements
assert_test('id="drawerArchetypeViewModes"' in html_content, "HTML contains #drawerArchetypeViewModes tablist")
assert_test('id="btnModePerspective"' in html_content, "HTML contains #btnModePerspective button")
assert_test('id="btnModeBlueprint"' in html_content, "HTML contains #btnModeBlueprint button")
assert_test('id="btnModeMaterials"' in html_content, "HTML contains #btnModeMaterials button")
assert_test('id="drawerMaterialsCard"' in html_content, "HTML contains #drawerMaterialsCard in details drawer")
assert_test('id="drawerMatSurface"' in html_content, "HTML contains #drawerMatSurface element")
assert_test('id="drawerMatStructure"' in html_content, "HTML contains #drawerMatStructure element")
assert_test('id="drawerMatDrainage"' in html_content, "HTML contains #drawerMatDrainage element")
assert_test('id="lightboxArchetypeViewModes"' in html_content, "HTML contains #lightboxArchetypeViewModes in lightbox modal")
assert_test('id="btnLightboxPerspective"' in html_content, "HTML contains #btnLightboxPerspective in lightbox")
assert_test('id="btnLightboxBlueprint"' in html_content, "HTML contains #btnLightboxBlueprint in lightbox")
assert_test('id="btnLightboxMaterials"' in html_content, "HTML contains #btnLightboxMaterials in lightbox")
assert_test('id="lightboxMaterialVal"' in html_content, "HTML contains #lightboxMaterialVal in lightbox specs")

# 3. CSS Styles
assert_test('.archetype-view-mode-bar' in css_content, "CSS defines .archetype-view-mode-bar")
assert_test('.btn-archetype-mode' in css_content, "CSS defines .btn-archetype-mode")
assert_test('.btn-archetype-mode.active' in css_content, "CSS defines .btn-archetype-mode.active styling")
assert_test('.lightbox-mode-bar' in css_content, "CSS defines .lightbox-mode-bar")
assert_test('.archetype-materials-card' in css_content, "CSS defines .archetype-materials-card")
assert_test('.materials-header' in css_content, "CSS defines .materials-header")
assert_test('.materials-grid' in css_content, "CSS defines .materials-grid")
assert_test('.mat-cell' in css_content, "CSS defines .mat-cell")
assert_test('.mat-label' in css_content, "CSS defines .mat-label")
assert_test('.mat-val' in css_content, "CSS defines .mat-val")
assert_test('[data-theme="dark"] .archetype-view-mode-bar' in css_content, "CSS defines dark theme variant for mode bar")
assert_test('[data-theme="dark"] .btn-archetype-mode.active' in css_content, "CSS defines dark theme variant for active mode button")
assert_test('[data-theme="dark"] .archetype-materials-card' in css_content, "CSS defines dark theme variant for materials card")
assert_test('[data-theme="dark"] .materials-header' in css_content, "CSS defines dark theme variant for materials header")

# 4. JS DOM Declarations & Bindings
assert_test('drawerArchetypeViewModes' in js_content, "JS declares drawerArchetypeViewModes variable")
assert_test('btnModePerspective' in js_content, "JS declares btnModePerspective variable")
assert_test('btnModeBlueprint' in js_content, "JS declares btnModeBlueprint variable")
assert_test('btnModeMaterials' in js_content, "JS declares btnModeMaterials variable")
assert_test('drawerMaterialsCard' in js_content, "JS declares drawerMaterialsCard variable")
assert_test('lightboxArchetypeViewModes' in js_content, "JS declares lightboxArchetypeViewModes variable")
assert_test('lightboxMaterialVal' in js_content, "JS declares lightboxMaterialVal variable")
assert_test('activeArchetypeViewMode' in js_content, "JS tracks activeArchetypeViewMode state")

assert_test("document.getElementById('drawerArchetypeViewModes')" in js_content, "JS binds #drawerArchetypeViewModes")
assert_test("document.getElementById('btnModePerspective')" in js_content, "JS binds #btnModePerspective")
assert_test("document.getElementById('btnModeBlueprint')" in js_content, "JS binds #btnModeBlueprint")
assert_test("document.getElementById('btnModeMaterials')" in js_content, "JS binds #btnModeMaterials")
assert_test("document.getElementById('drawerMaterialsCard')" in js_content, "JS binds #drawerMaterialsCard")
assert_test("document.getElementById('lightboxArchetypeViewModes')" in js_content, "JS binds #lightboxArchetypeViewModes")
assert_test("document.getElementById('lightboxMaterialVal')" in js_content, "JS binds #lightboxMaterialVal")

# 5. JS Matrix Definitions (LOT_ARCHETYPES)
assert_test('blueprintSvg:' in js_content, "LOT_ARCHETYPES contains blueprintSvg field")
assert_test('materialsSvg:' in js_content, "LOT_ARCHETYPES contains materialsSvg field")
assert_test('materials: {' in js_content, "LOT_ARCHETYPES contains structured materials spec")
assert_test('surface:' in js_content, "LOT_ARCHETYPES materials define surface finish")
assert_test('structure:' in js_content, "LOT_ARCHETYPES materials define structure specs")
assert_test('drainage:' in js_content, "LOT_ARCHETYPES materials define drainage specs")

# 6. JS Controller Logic
assert_test('function setArchetypeViewMode' in js_content, "JS implements setArchetypeViewMode function")
assert_test('activeArchetypeViewMode = mode' in js_content, "setArchetypeViewMode updates activeArchetypeViewMode state")
assert_test('drawerMaterialsCard.style.display' in js_content, "renderLotArchetypeShowcase toggles drawerMaterialsCard visibility")
assert_test('drawerMatSurface.textContent' in js_content, "renderLotArchetypeShowcase populates drawerMatSurface")
assert_test('drawerMatStructure.textContent' in js_content, "renderLotArchetypeShowcase populates drawerMatStructure")
assert_test('drawerMatDrainage.textContent' in js_content, "renderLotArchetypeShowcase populates drawerMatDrainage")
assert_test('lightboxMaterialVal.textContent' in js_content, "openArchetypeLightbox populates lightboxMaterialVal")

# 7. Zero PII Regression in backend MapController
backend_map_controller = os.path.join(BASE_DIR, 'backend', 'controllers', 'MapController.php')
if os.path.exists(backend_map_controller):
    with open(backend_map_controller, 'r', encoding='utf-8') as f:
        php_code = f.read()
    assert_test('deceased_name' not in php_code, "Backend MapController does not expose 'deceased_name'")
    assert_test('claimant_name' not in php_code, "Backend MapController does not expose 'claimant_name'")

print(f"\nBatch 10B Test Results: {passed} passed, {failed} failed.\n")

if failed > 0:
    print(f"Validation FAILED: {failed} test(s) failed.")
    sys.exit(1)
else:
    print("All Batch 10B test cases passed successfully with 100% compliance!")
    sys.exit(0)
