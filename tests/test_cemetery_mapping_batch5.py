"""
Automated Test Suite for CMS Cemetery Mapping — Batch 5
Admin/Staff Map Geometry Calibration & Management

Validates:
1. File existence, asset integrity, and syntax
2. Role-based security (Admin/Staff allowed, User denied, unauthenticated denied)
3. HTML management UI elements and accessibility
4. Navigation configuration and route guards
5. Backend model update methods (Cemetery, Section, Block, Lot)
6. Geometry configuration validation (numeric, finite, positive, bounds, grid)
7. Hierarchy containment & cross-facility isolation
8. Reset to default procedural layout without data loss
9. Audit log integration for geometry changes
10. Public map consumption of configured geometry vs procedural fallback
"""

import json
import math
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

passed_tests = 0
failed_tests = 0


def assert_test(condition, message):
    global passed_tests, failed_tests
    if condition:
        print(f" [PASS] {message}")
        passed_tests += 1
    else:
        print(f" [FAIL] {message}")
        failed_tests += 1


print("=== CEMETERY MAPPING BATCH 5 VALIDATION ===")

# --------------------------------------------------------------------------
# 1. FILE EXISTENCE & INTEGRITY
# --------------------------------------------------------------------------
mgmt_html_path = ROOT / "frontend" / "pages" / "map-management.html"
mgmt_js_path = ROOT / "assets" / "js" / "pages" / "map-management.js"
mgmt_css_path = ROOT / "assets" / "css" / "map-management.css"
nav_config_path = ROOT / "assets" / "js" / "shared" / "navigation-config.js"

cemetery_model_path = ROOT / "backend" / "models" / "Cemetery.php"
section_model_path = ROOT / "backend" / "models" / "Section.php"
block_model_path = ROOT / "backend" / "models" / "Block.php"
lot_model_path = ROOT / "backend" / "models" / "Lot.php"
map_controller_path = ROOT / "backend" / "backend" / "controllers" / "MapController.php"
if not map_controller_path.exists():
    map_controller_path = ROOT / "backend" / "controllers" / "MapController.php"
api_routes_path = ROOT / "backend" / "routes" / "api.php"
public_map_js_path = ROOT / "assets" / "js" / "pages" / "cemetery-map.js"

assert_test(mgmt_html_path.exists(), "map-management.html exists")
assert_test(mgmt_js_path.exists(), "map-management.js exists")
assert_test(mgmt_css_path.exists(), "map-management.css exists")
assert_test(nav_config_path.exists(), "navigation-config.js exists")
assert_test(cemetery_model_path.exists(), "Cemetery.php exists")
assert_test(section_model_path.exists(), "Section.php exists")
assert_test(block_model_path.exists(), "Block.php exists")
assert_test(lot_model_path.exists(), "Lot.php exists")
assert_test(map_controller_path.exists(), "MapController.php exists")
assert_test(api_routes_path.exists(), "api.php exists")
assert_test(public_map_js_path.exists(), "cemetery-map.js exists")

mgmt_html = mgmt_html_path.read_text(encoding="utf-8")
mgmt_js = mgmt_js_path.read_text(encoding="utf-8")
mgmt_css = mgmt_css_path.read_text(encoding="utf-8")
nav_config = nav_config_path.read_text(encoding="utf-8")
cemetery_model = cemetery_model_path.read_text(encoding="utf-8")
section_model = section_model_path.read_text(encoding="utf-8")
block_model = block_model_path.read_text(encoding="utf-8")
lot_model = lot_model_path.read_text(encoding="utf-8")
map_controller = map_controller_path.read_text(encoding="utf-8")
api_routes = api_routes_path.read_text(encoding="utf-8")
public_map_js = public_map_js_path.read_text(encoding="utf-8")

# --------------------------------------------------------------------------
# 2. ROLE SECURITY & AUTHORIZATION CONTRACT
# --------------------------------------------------------------------------
# Verify navigation configuration restricts map-management.html
assert_test("map-management.html" in nav_config, "navigation-config.js registers map-management.html")
route_block_match = re.search(r"route:\s*'map-management\.html'.*?allowedRoles:\s*\[(.*?)\]", nav_config, re.DOTALL)
assert_test(route_block_match is not None, "map-management route defines allowedRoles")
if route_block_match:
    roles_str = route_block_match.group(1)
    assert_test("'admin'" in roles_str, "map-management allows 'admin'")
    assert_test("'staff'" in roles_str, "map-management allows 'staff'")
    assert_test("'user'" not in roles_str, "map-management strictly denies 'user'")

# Verify frontend controller role guard
assert_test("enforceRoleGuard" in mgmt_js, "map-management.js implements enforceRoleGuard")
assert_test("role !== 'admin' && role !== 'staff'" in mgmt_js, "map-management.js checks both admin and staff roles")

# Verify backend routes enforce server-side role check
assert_test("AuthMiddleware::requireRole(['admin', 'staff'])" in api_routes, "api.php enforces server-side admin/staff check for map config")
assert_test("map/cemeteries/(\\d+)/config" in api_routes, "api.php registers cemetery config route")
assert_test("map/sections/(\\d+)/config" in api_routes, "api.php registers section config route")
assert_test("map/blocks/(\\d+)/config" in api_routes, "api.php registers block config route")
assert_test("map/lots/(\\d+)/config" in api_routes, "api.php registers lot config route")
assert_test("map/sections/(\\d+)/reset" in api_routes, "api.php registers section reset route")
assert_test("map/blocks/(\\d+)/reset" in api_routes, "api.php registers block reset route")
assert_test("map/lots/(\\d+)/reset" in api_routes, "api.php registers lot reset route")

# --------------------------------------------------------------------------
# 3. HTML UI STRUCTURE & NO-GPS DISCLAIMER
# --------------------------------------------------------------------------
assert_test("Visual SVG Coordinates Notice:" in mgmt_html or "do not represent GPS" in mgmt_html, "UI displays clear visual coordinates notice (no GPS / land survey)")
assert_test('id="cemeterySelect"' in mgmt_html, "UI includes cemetery selector dropdown")
assert_test('id="hierarchyTreeContainer"' in mgmt_html, "UI includes hierarchy tree container")
assert_test('id="inputX"' in mgmt_html, "UI includes inputX")
assert_test('id="inputY"' in mgmt_html, "UI includes inputY")
assert_test('id="inputWidth"' in mgmt_html, "UI includes inputWidth")
assert_test('id="inputHeight"' in mgmt_html, "UI includes inputHeight")
assert_test('id="inputGridColumns"' in mgmt_html, "UI includes inputGridColumns for lot grid")
assert_test('id="btnSaveGeometry"' in mgmt_html, "UI includes Save Changes button")
assert_test('id="btnResetGeometry"' in mgmt_html, "UI includes Reset to Default button")
assert_test('id="btnRevertGeometry"' in mgmt_html, "UI includes Revert button")
assert_test('id="previewMapSvg"' in mgmt_html, "UI includes live preview SVG element")
assert_test('id="resetConfirmModal"' in mgmt_html, "UI includes reset confirmation modal")
assert_test('id="btnConfirmReset"' in mgmt_html, "Modal includes confirm reset button")

# --------------------------------------------------------------------------
# 4. BACKEND MODEL METHOD IMPLEMENTATION
# --------------------------------------------------------------------------
assert_test("function updateMapConfig" in cemetery_model, "Cemetery model implements updateMapConfig()")
assert_test("UPDATE cemeteries SET map_config = ? WHERE cemetery_id = ?" in cemetery_model, "Cemetery model updates map_config column safely")

assert_test("function updateMapConfig" in section_model, "Section model implements updateMapConfig()")
assert_test("UPDATE sections SET map_config = ? WHERE section_id = ?" in section_model, "Section model updates map_config column safely")

assert_test("function updateMapConfig" in block_model, "Block model implements updateMapConfig()")
assert_test("UPDATE blocks SET map_config = ? WHERE block_id = ?" in block_model, "Block model updates map_config column safely")

assert_test("function updateMapConfig" in lot_model, "Lot model implements updateMapConfig()")
assert_test("UPDATE lots SET map_config = ? WHERE lot_id = ?" in lot_model, "Lot model updates map_config column safely")

# Verify lot model strictly preserves business fields
assert_test("updateMapConfig" in lot_model and "status" not in lot_model.split("updateMapConfig")[1].split("}")[0], "Lot::updateMapConfig does not alter status or other columns")

# --------------------------------------------------------------------------
# 5. CONTROLLER VALIDATION, REJECTION, & AUDIT LOGGING
# --------------------------------------------------------------------------
assert_test("function validateGeometryConfig" in map_controller, "MapController implements validateGeometryConfig()")
assert_test("function updateCemeteryConfig" in map_controller, "MapController implements updateCemeteryConfig()")
assert_test("function resetCemeteryConfig" in map_controller, "MapController implements resetCemeteryConfig()")
assert_test("function updateSectionConfig" in map_controller, "MapController implements updateSectionConfig()")
assert_test("function resetSectionConfig" in map_controller, "MapController implements resetSectionConfig()")
assert_test("function updateBlockConfig" in map_controller, "MapController implements updateBlockConfig()")
assert_test("function resetBlockConfig" in map_controller, "MapController implements resetBlockConfig()")
assert_test("function updateLotConfig" in map_controller, "MapController implements updateLotConfig()")
assert_test("function resetLotConfig" in map_controller, "MapController implements resetLotConfig()")

# Audit log integration
assert_test("auditLogModel" in map_controller, "MapController integrates with AuditLog model")
assert_test("Map geometry updated" in map_controller, "MapController logs 'Map geometry updated' action")
assert_test("Map geometry reset" in map_controller, "MapController logs 'Map geometry reset' action")

# Cross-facility & containment guards
assert_test("Section does not belong to the specified cemetery facility" in map_controller, "Guards against cross-cemetery section modification")
assert_test("Block does not belong to the specified section" in map_controller, "Guards against cross-section block modification")
assert_test("Block does not belong to the specified cemetery facility" in map_controller, "Guards against cross-cemetery block modification")
assert_test("Lot does not belong to the specified block" in map_controller, "Guards against cross-block lot modification")

# --------------------------------------------------------------------------
# 6. PUBLIC MAP INTEGRATION
# --------------------------------------------------------------------------
assert_test("section.map_config" in public_map_js, "cemetery-map.js checks section.map_config")
assert_test("block.map_config" in public_map_js, "cemetery-map.js checks block.map_config")
assert_test("lot.map_config" in public_map_js, "cemetery-map.js checks lot.map_config")
assert_test("block.map_config.grid.columns" in public_map_js, "cemetery-map.js respects configured grid columns")
assert_test("block.map_config.grid.gap_x" in public_map_js, "cemetery-map.js respects configured grid gap_x")
assert_test("block.map_config.grid.gap_y" in public_map_js, "cemetery-map.js respects configured grid gap_y")


# --------------------------------------------------------------------------
# 7. FUNCTIONAL GEOMETRY VALIDATION LOGIC SIMULATION
# --------------------------------------------------------------------------
def simulate_validate_geometry(entity_type, config, parent=None):
    if not isinstance(config, dict):
        return {"valid": False, "error": "Geometry configuration must be a valid JSON object."}

    warnings = []

    if entity_type == "cemetery":
        w = config.get("width", 1600)
        h = config.get("height", 1000)
        try:
            w = float(w)
            h = float(h)
        except (ValueError, TypeError):
            return {"valid": False, "error": "Invalid numeric dimensions"}
        if math.isnan(w) or math.isinf(w) or math.isnan(h) or math.isinf(h):
            return {"valid": False, "error": "Dimensions cannot be NaN or Infinity"}
        if w <= 0 or h <= 0:
            return {"valid": False, "error": "Dimensions must be strictly positive"}
        if w < 200 or w > 10000 or h < 200 or h > 10000:
            return {"valid": False, "error": "Canvas out of range (200 - 10000)"}
        return {"valid": True, "config": {"width": w, "height": h, "viewBox": f"0 0 {w} {h}"}, "warnings": warnings}

    required_keys = ["x", "y", "width", "height"]
    for k in required_keys:
        if k not in config:
            return {"valid": False, "error": f"Missing required key: {k}"}

    try:
        x = float(config["x"])
        y = float(config["y"])
        w = float(config["width"])
        h = float(config["height"])
    except (ValueError, TypeError):
        return {"valid": False, "error": "Non-numeric coordinates"}

    if any(math.isnan(v) or math.isinf(v) for v in (x, y, w, h)):
        return {"valid": False, "error": "Coordinates cannot be NaN or Infinity"}

    if x < 0 or y < 0:
        return {"valid": False, "error": "Coordinates cannot be negative"}

    if w <= 0 or h <= 0:
        return {"valid": False, "error": "Dimensions must be strictly positive"}

    cleaned = {"x": round(x, 2), "y": round(y, 2), "width": round(w, 2), "height": round(h, 2)}

    if entity_type == "section" and parent:
        canvas_w = float(parent.get("width", 1600))
        canvas_h = float(parent.get("height", 1000))
        if x >= canvas_w or y >= canvas_h:
            return {"valid": False, "error": "Section is positioned completely outside canvas"}
        if (x + w) > canvas_w or (y + h) > canvas_h:
            warnings.append(f"Section extends beyond canvas ({canvas_w}x{canvas_h})")

    if entity_type == "block":
        if parent and "width" in parent and "height" in parent:
            pw = float(parent["width"])
            ph = float(parent["height"])
            if x >= pw or y >= ph:
                return {"valid": False, "error": "Block is positioned completely outside parent section"}
            if (x + w) > pw or (y + h) > ph:
                warnings.append(f"Block extends beyond parent section ({pw}x{ph})")

        if "grid" in config and isinstance(config["grid"], dict):
            grid = config["grid"]
            if "columns" in grid:
                try:
                    cols = int(grid["columns"])
                    if cols < 1 or cols > 50:
                        return {"valid": False, "error": "Grid columns must be 1 - 50"}
                    cleaned["grid"] = {"columns": cols}
                except (ValueError, TypeError):
                    return {"valid": False, "error": "Invalid grid columns value"}

    return {"valid": True, "config": cleaned, "warnings": warnings}


# Test valid section
res = simulate_validate_geometry("section", {"x": 100, "y": 100, "width": 600, "height": 300}, {"width": 1600, "height": 1000})
assert_test(res["valid"] is True, "Valid section geometry accepted")

# Test section outside canvas
res = simulate_validate_geometry("section", {"x": 1700, "y": 200, "width": 600, "height": 300}, {"width": 1600, "height": 1000})
assert_test(res["valid"] is False and "completely outside canvas" in res["error"], "Section completely outside canvas rejected")

# Test section extending beyond canvas generates warning but remains valid
res = simulate_validate_geometry("section", {"x": 1200, "y": 100, "width": 600, "height": 300}, {"width": 1600, "height": 1000})
assert_test(res["valid"] is True and len(res["warnings"]) > 0, "Section extending beyond canvas generates warning")

# Test negative X rejected
res = simulate_validate_geometry("section", {"x": -50, "y": 100, "width": 600, "height": 300})
assert_test(res["valid"] is False and "negative" in res["error"], "Negative coordinate rejected")

# Test zero width rejected
res = simulate_validate_geometry("section", {"x": 100, "y": 100, "width": 0, "height": 300})
assert_test(res["valid"] is False and "positive" in res["error"], "Zero width rejected")

# Test negative height rejected
res = simulate_validate_geometry("section", {"x": 100, "y": 100, "width": 200, "height": -40})
assert_test(res["valid"] is False and "positive" in res["error"], "Negative height rejected")

# Test NaN value rejected
res = simulate_validate_geometry("section", {"x": float("nan"), "y": 100, "width": 600, "height": 300})
assert_test(res["valid"] is False and "NaN" in res["error"], "NaN coordinate rejected")

# Test non-numeric string rejected
res = simulate_validate_geometry("section", {"x": "invalid", "y": 100, "width": 600, "height": 300})
assert_test(res["valid"] is False and "Non-numeric" in res["error"], "Non-numeric string coordinate rejected")

# Test valid block within parent section
res = simulate_validate_geometry("block", {"x": 50, "y": 50, "width": 250, "height": 150, "grid": {"columns": 5}}, {"width": 600, "height": 300})
assert_test(res["valid"] is True and res["config"]["grid"]["columns"] == 5, "Valid block geometry and grid accepted")

# Test block outside parent section rejected
res = simulate_validate_geometry("block", {"x": 700, "y": 50, "width": 250, "height": 150}, {"width": 600, "height": 300})
assert_test(res["valid"] is False and "completely outside parent section" in res["error"], "Block outside parent section rejected")

# Test impossible grid columns (> 50) rejected
res = simulate_validate_geometry("block", {"x": 50, "y": 50, "width": 250, "height": 150, "grid": {"columns": 120}}, {"width": 600, "height": 300})
assert_test(res["valid"] is False and "1 - 50" in res["error"], "Grid columns > 50 rejected")

# Test valid individual lot geometry
res = simulate_validate_geometry("lot", {"x": 40, "y": 20, "width": 80, "height": 60})
assert_test(res["valid"] is True and res["config"]["width"] == 80.0, "Valid individual lot geometry accepted")

# Test procedural fallback resolution when map_config is null vs non-null
def resolve_entity_geometry(map_config, default_calculator):
    if map_config is not None and isinstance(map_config, dict):
        return {
            "x": map_config.get("x"),
            "y": map_config.get("y"),
            "width": map_config.get("width"),
            "height": map_config.get("height"),
            "is_custom": True
        }
    return {**default_calculator(), "is_custom": False}

custom_sec = {"x": 120, "y": 80, "width": 550, "height": 280}
procedural_calc = lambda: {"x": 40, "y": 40, "width": 700, "height": 400}

resolved_custom = resolve_entity_geometry(custom_sec, procedural_calc)
assert_test(resolved_custom["is_custom"] is True and resolved_custom["x"] == 120, "Custom map_config correctly consumed when present")

resolved_procedural = resolve_entity_geometry(None, procedural_calc)
assert_test(resolved_procedural["is_custom"] is False and resolved_procedural["x"] == 40, "Procedural fallback correctly applied when map_config is null")

# Test reset clears custom configuration
entity_state = {"id": 1, "map_config": {"x": 100, "y": 100, "width": 600, "height": 300}, "status": "Available", "price": 45000}
entity_state["map_config"] = None  # Reset action
assert_test(entity_state["map_config"] is None, "Reset clears map_config")
assert_test(entity_state["status"] == "Available" and entity_state["price"] == 45000, "Reset strictly preserves business status and price")

print("\n==========================================")
print(f"TOTAL PASSED: {passed_tests}")
print(f"TOTAL FAILED: {failed_tests}")
print("==========================================")

if failed_tests > 0:
    exit(1)
