"""
Test Suite for Cemetery Mapping Batch 3: Core Interactive Map UI & Procedural SVG Renderer
"""

from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parent.parent

errors = []
passed = 0

def assert_true(name, condition, details=""):
    global passed, errors
    if condition:
        print(f" [PASS] {name}")
        passed += 1
    else:
        print(f" [FAIL] {name}: {details}")
        errors.append(f"{name}: {details}")

print("=== CEMETERY MAPPING BATCH 3 VALIDATION ===")

# 1. HTML File Existence & Assets
html_path = ROOT / 'frontend' / 'pages' / 'cemetery-map.html'
assert_true('cemetery-map.html exists', html_path.exists())

if html_path.exists():
    html_text = html_path.read_text(encoding='utf-8')
    assert_true('Has DOCTYPE and valid structure', '<!DOCTYPE html>' in html_text and '<html lang="en">' in html_text)
    assert_true('Has page title', 'Cemetery Map' in html_text)
    assert_true('Has disclaimer pill', 'Map layout is a configurable visual representation' in html_text)
    assert_true('Has cemeterySelector', 'id="cemeterySelector"' in html_text)
    assert_true('Has native SVG element', '<svg id="cemeteryMapSvg"' in html_text)
    assert_true('SVG has viewBox 0 0 1600 1000', 'viewBox="0 0 1600 1000"' in html_text)
    assert_true('Has lotDetailsDrawer', 'id="lotDetailsDrawer"' in html_text)
    assert_true('Has btnBookThisLot', 'id="btnBookThisLot"' in html_text)
    assert_true('Has zoom controls', 'id="btnZoomIn"' in html_text and 'id="btnZoomOut"' in html_text and 'id="btnResetZoom"' in html_text)
    assert_true('Has breadcrumb element', 'id="mapBreadcrumbs"' in html_text)
    assert_true('Has legend items', 'swatch-available' in html_text and 'swatch-occupied' in html_text)

    # Check asset resolution
    for match in re.finditer(r'''(?:href|src)=["']([^"']+)["']''', html_text):
        ref = match.group(1)
        if not ref.startswith(('http://', 'https://', 'mailto:', 'tel:', 'javascript:', '#')) and ('assets/' in ref or 'assets' in ref):
            clean_ref = ref.split('?')[0].split('#')[0]
            resolved = (html_path.parent / clean_ref).resolve()
            assert_true(f'Resolves asset: {clean_ref}', resolved.exists(), f"File does not exist: {resolved}")

# 2. CSS File Existence & Design Tokens
css_path = ROOT / 'assets' / 'css' / 'cemetery-map.css'
assert_true('cemetery-map.css exists', css_path.exists())

if css_path.exists():
    css_text = css_path.read_text(encoding='utf-8')
    assert_true('Has status colors', '--lot-available' in css_text and '--lot-reserved' in css_text and '--lot-occupied' in css_text)
    assert_true('Has dark mode overrides', '[data-theme="dark"]' in css_text)
    assert_true('Has SVG tile styling', '.svg-lot-tile' in css_text and '.svg-section-card' in css_text and '.svg-block-card' in css_text)
    assert_true('Has lot details drawer styling', '.lot-details-drawer' in css_text)
    assert_true('Has responsive media queries', '@media (max-width:' in css_text)

# 3. JS File Existence & Integration Contracts
js_path = ROOT / 'assets' / 'js' / 'pages' / 'cemetery-map.js'
assert_true('cemetery-map.js exists', js_path.exists())

if js_path.exists():
    js_text = js_path.read_text(encoding='utf-8')
    assert_true('Enforces route authentication', 'requireRole' in js_text)
    assert_true('Calls GET /api/cemeteries', "api.request('cemeteries'" in js_text)
    assert_true('Calls GET /api/map/layout', "map/layout?cemetery_id=" in js_text)
    assert_true('Calls GET /api/map/blocks/{id}/lots', "map/blocks/" in js_text)
    assert_true('Binds booking deep-link contract', 'booking-assistant.html?service=burial&lot_id=' in js_text)
    assert_true('Encodes lot_number in deep-link', 'encodeURIComponent(lot.lot_number)' in js_text)
    assert_true('Enforces lot status colors without hardcoding', 'Available' in js_text and 'Reserved' in js_text and 'Occupied' in js_text)
    assert_true('Implements zoom/pan transforms', 'zoomView' in js_text and 'applyViewBox' in js_text)
    assert_true('Handles empty & loading states', 'showEmptyOverlay' in js_text and 'setLoading' in js_text)
    assert_true('Disables non-available lots for booking', 'btnLotUnavailable' in js_text)

# 4. Centralized Navigation Integration
nav_config_path = ROOT / 'assets' / 'js' / 'shared' / 'navigation-config.js'
nav_text = nav_config_path.read_text(encoding='utf-8')
assert_true('navigation-config.js registers cemetery-map.html', 'cemetery-map.html' in nav_text)

api_js_path = ROOT / 'assets' / 'js' / 'shared' / 'api.js'
api_text = api_js_path.read_text(encoding='utf-8')
assert_true('api.js registers cemetery-map.html role access', "'cemetery-map.html':" in api_text)

print("\n==========================================")
print(f"TOTAL PASSED: {passed}")
print(f"TOTAL FAILED: {len(errors)}")
print("==========================================")

if errors:
    sys.exit(1)
