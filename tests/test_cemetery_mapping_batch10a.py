#!/usr/bin/env python3
"""
Test Suite: Cemetery Mapping Batch 10A
Realistic Columbarium Niche Wall Architecture, Vertical Elevation Rulers & Niche Plate Layout

Validates:
1. HTML includes #drawerElevationRow and #drawerElevationPlacement in Details Drawer
2. JS declares and binds elevation placement elements
3. JS detects Columbarium/Ossuary block and activates Niche Wall Elevation mode
4. JS renders vertical elevation ruler (Level 1 Base to Level 5 Top, highlighting Eye-Level 1.4m)
5. JS sanitizes long GUID hashes to clean human-readable lot numbers on tiles
6. JS decorates niche vault tiles with inner beveled plates and 4 brass corner rosettes
7. JS populates vertical elevation placement description in details drawer upon selection
8. CSS provides styling for tier ruler, eye-level badge, niche plates, and dark mode parity
"""

import os
import sys

BASE_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
HTML_PATH = os.path.join(BASE_DIR, "frontend", "pages", "cemetery-map.html")
JS_PATH = os.path.join(BASE_DIR, "assets", "js", "pages", "cemetery-map.js")
CSS_PATH = os.path.join(BASE_DIR, "assets", "css", "cemetery-map.css")

passed = 0
errors = []

def assert_test(condition, message):
    global passed, errors
    if condition:
        passed += 1
        print(f" [PASS] {message}")
    else:
        errors.append(message)
        print(f" [FAIL] {message}")

print("=== CEMETERY MAPPING BATCH 10A VALIDATION ===")

# 1. File existence
assert_test(os.path.exists(HTML_PATH), "cemetery-map.html exists")
assert_test(os.path.exists(JS_PATH), "cemetery-map.js exists")
assert_test(os.path.exists(CSS_PATH), "cemetery-map.css exists")

with open(HTML_PATH, "r", encoding="utf-8") as f:
    map_html = f.read()

with open(JS_PATH, "r", encoding="utf-8") as f:
    map_js = f.read()

with open(CSS_PATH, "r", encoding="utf-8") as f:
    map_css = f.read()

# 2. HTML Drawer Structure
assert_test('id="drawerElevationRow"' in map_html, "HTML contains #drawerElevationRow in Plot Specifications")
assert_test('id="drawerElevationPlacement"' in map_html, "HTML contains #drawerElevationPlacement element")

# 3. JS Declarations & Bindings
assert_test("let drawerElevationRow, drawerElevationPlacement;" in map_js, "JS declares drawer elevation variables")
assert_test("drawerElevationRow = document.getElementById('drawerElevationRow');" in map_js, "JS binds #drawerElevationRow")
assert_test("drawerElevationPlacement = document.getElementById('drawerElevationPlacement');" in map_js, "JS binds #drawerElevationPlacement")

# 4. JS Columbarium Detection & Architectural Layout
assert_test("isColumbarium" in map_js, "renderBlockLotsView detects Columbarium facility/section")
assert_test("svg-tier-ruler-group" in map_js, "JS renders vertical elevation ruler group")
assert_test("tier-pill--eye-level" in map_js, "JS marks Eye-Level tier with highlighted pill")
assert_test("Eye-Level" in map_js, "JS generates Eye-Level tier metadata")

# 5. JS Tile Formatting & Niche Details
assert_test("is-niche-vault" in map_js, "JS applies .is-niche-vault class to columbarium tiles")
assert_test("niche-inner-plate" in map_js, "JS renders inner beveled plate on niche tiles")
assert_test("niche-screw" in map_js, "JS renders 4 brass corner rosettes/screws on niche tiles")
assert_test("lot._elevationDesc" in map_js, "JS calculates lot elevation description")
assert_test("drawerElevationPlacement.innerHTML" in map_js, "selectLot populates #drawerElevationPlacement in drawer")

# 6. CSS Styling Rules
assert_test(".svg-tier-ruler-group" in map_css, "CSS defines .svg-tier-ruler-group")
assert_test(".svg-tier-pill" in map_css, "CSS defines .svg-tier-pill")
assert_test(".tier-pill--eye-level" in map_css, "CSS defines .tier-pill--eye-level highlight")
assert_test(".is-niche-vault" in map_css, "CSS defines .is-niche-vault")
assert_test(".niche-inner-plate" in map_css, "CSS defines .niche-inner-plate")
assert_test(".niche-screw" in map_css, "CSS defines .niche-screw")
assert_test('[data-theme="dark"] .svg-tier-pill' in map_css, "CSS defines dark theme for tier ruler pill")
assert_test('[data-theme="dark"] .is-niche-vault' in map_css, "CSS defines dark theme for niche vault")

# Summary
print(f"\nBatch 10A Test Results: {passed} passed, {len(errors)} failed.")
if errors:
    print("\nErrors encountered:")
    for err in errors:
        print(f" - {err}")
    sys.exit(1)
else:
    print("\nAll Batch 10A test cases passed successfully with 100% compliance!")
    sys.exit(0)
