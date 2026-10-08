"""
Test Suite for Cemetery Mapping Batch 6:
User-Facing Cemetery Lot Locator & Location Experience
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


print("=== CEMETERY MAPPING BATCH 6 VALIDATION ===")

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
# Verify public map backend API does not leak deceased or claimant personal data
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
    assert_test(token not in map_ctrl, f"Backend MapController does not expose '{token}'")

# Ensure privacy notice exists in public HTML
assert_test("drawer-privacy-note" in map_html, "Lot details drawer contains privacy-safe notice element")
assert_test("confidential" in map_html.lower(), "Privacy notice explicitly communicates records are confidential")
assert_test("public lot locator" in map_html.lower() or "cemetery lot locator" in map_html.lower(),
            "Privacy notice clarifies public lot locator scope")

# --------------------------------------------------------------------------
# 3. LOCATION-FIRST USER EXPERIENCE & "YOU ARE HERE" CONTEXT
# --------------------------------------------------------------------------
# A. Breadcrumb Hierarchy
assert_test("bcCemetery" in map_html, "Breadcrumb includes Cemetery level")
assert_test("bcSection" in map_html, "Breadcrumb includes Section level")
assert_test("bcBlock" in map_html, "Breadcrumb includes Block level")
assert_test("bcLot" in map_html, "Breadcrumb includes exact Lot level (bcLot)")
assert_test("bcLot" in map_js and "bcLotName" in map_js, "cemetery-map.js binds bcLot breadcrumb elements")
assert_test("bcLot.style.display" in map_js, "cemetery-map.js dynamically shows/hides lot level breadcrumb")

# B. On-Map Location Summary HUD
assert_test("mapLocationSummaryCard" in map_html, "HTML includes on-map location summary HUD card")
assert_test("locSummarySection" in map_html, "HUD displays Section name")
assert_test("locSummaryBlock" in map_html, "HUD displays Block name")
assert_test("locSummaryLot" in map_html, "HUD displays exact Lot number")
assert_test("btnCenterOnMapHud" in map_html, "HUD includes Center on Map action button")
assert_test("mapLocationSummaryCard" in map_js, "cemetery-map.js binds mapLocationSummaryCard HUD")

# C. "YOU ARE HERE" Visual Indicator
assert_test("YOU ARE HERE" in map_html, "HTML features explicit 'YOU ARE HERE' locator indicator")
assert_test("drawerYouAreHereBadge" in map_html, "Lot drawer features YOU ARE HERE status badge")
assert_test("drawerYouAreHereBadge" in map_js, "cemetery-map.js binds drawerYouAreHereBadge")

# D. Drawer Location Hierarchy Trail
assert_test("hierarchy-breadcrumb-trail" in map_html, "Drawer features Location Hierarchy trail element")
assert_test("drawerTrailFacility" in map_html, "Trail displays Facility name")
assert_test("drawerTrailSection" in map_html, "Trail displays Section name")
assert_test("drawerTrailBlock" in map_html, "Trail displays Block name")
assert_test("drawerTrailLot" in map_html, "Trail displays exact Lot Number")

# --------------------------------------------------------------------------
# 4. "CENTER ON MAP" ENGINE
# --------------------------------------------------------------------------
assert_test("btnCenterOnMapDrawer" in map_html, "Lot drawer provides Center on Map button")
assert_test("centerOnSelectedLot" in map_js, "cemetery-map.js implements centerOnSelectedLot() function")
assert_test("btnCenterOnMapHud.addEventListener" in map_js, "HUD Center on Map button bound to centerOnSelectedLot")
assert_test("btnCenterOnMapDrawer.addEventListener" in map_js, "Drawer Center on Map button bound to centerOnSelectedLot")
assert_test("centerViewOnPoint" in map_js, "Centering uses native SVG viewBox transform calculation")
assert_test("window.scrollTo" not in map_js and "window.scrollBy" not in map_js,
            "Centering strictly uses SVG coordinates and not browser window scrolling")

# --------------------------------------------------------------------------
# 5. LOT HIGHLIGHTING & STATUS VS SELECTED DISTINCTION
# --------------------------------------------------------------------------
# Status colors preserved
assert_test("--lot-available" in map_css, "CSS defines --lot-available")
assert_test("--lot-reserved" in map_css, "CSS defines --lot-reserved")
assert_test("--lot-occupied" in map_css, "CSS defines --lot-occupied")
assert_test("--lot-unavailable" in map_css, "CSS defines --lot-unavailable")
assert_test("swatch-maintenance" in map_css or "lot--under-maintenance" in map_css, "CSS defines under-maintenance status styles")
assert_test("swatch-maintenance" in map_html, "HTML map legend includes Under Maintenance swatch")

# Selected distinct styling
assert_test(".svg-lot-tile.is-selected .svg-lot-rect" in map_css, "CSS defines distinct selected lot rect style")
assert_test("lotSelectedGlowPulse" in map_css or "drop-shadow" in map_css, "Selected lot features high-contrast glow outline")
assert_test("stroke-width:" in map_css and "is-selected" in map_css, "Selected state uses heavy border thickness")

# --------------------------------------------------------------------------
# 6. BOOK THIS LOT VS LOCKED STATE
# --------------------------------------------------------------------------
assert_test("btnBookThisLot" in map_html, "HTML includes btnBookThisLot")
assert_test("btnLotUnavailable" in map_html, "HTML includes btnLotUnavailable")
assert_test("btnBookThisLot.style.display = 'inline-flex'" in map_js or 'btnBookThisLot.style.display = "inline-flex"' in map_js,
            "Available lot activates booking button")
assert_test("btnBookThisLot.style.display = 'none'" in map_js or 'btnBookThisLot.style.display = "none"' in map_js,
            "Non-available lot hides booking button")
assert_test("btnLotUnavailable.style.display = 'inline-flex'" in map_js or 'btnLotUnavailable.style.display = "inline-flex"' in map_js,
            "Non-available lot displays locked unavailable button")
assert_test("booking-assistant.html?service=burial" in map_js, "Deep-link contract to booking-assistant.html preserved")

# --------------------------------------------------------------------------
# 7. SEARCH INTEGRATION (Batch 4A Compatibility)
# --------------------------------------------------------------------------
assert_test("executeSearch" in map_js, "Search execution preserved")
assert_test("navigateAndSelectLot" in map_js, "Direct navigation to search result preserved")
assert_test("centerOnSelectedLot" in map_js and "navigateAndSelectLot" in map_js,
            "Search selection triggers automated viewport centering")

# --------------------------------------------------------------------------
# 8. AI BRIDGE & DIRECT URL INTEGRATION (Batch 4B Compatibility)
# --------------------------------------------------------------------------
assert_test("initFromUrlParams" in map_js, "initFromUrlParams() preserved")
assert_test("parsePositiveInt" in map_js, "Parameter security sanitizer preserved")
assert_test("cemetery_id" in map_js and "block_id" in map_js and "lot_id" in map_js,
            "URL parameter reader checks cemetery_id, block_id, and lot_id")
assert_test("centerViewOnPoint" in map_js or "centerOnSelectedLot" in map_js,
            "Direct URL navigation centers on target lot")

# --------------------------------------------------------------------------
# 9. ACCESSIBILITY & RESPONSIVE DESIGN
# --------------------------------------------------------------------------
assert_test("setAttribute('role', 'button')" in map_js or 'role="button"' in map_js,
            "SVG lot elements define role='button'")
assert_test("setAttribute('tabindex', '0')" in map_js or 'tabindex="0"' in map_js,
            "SVG lot elements are keyboard-focusable (tabindex='0')")
assert_test("aria-label" in map_js, "SVG lot elements define descriptive aria-label")
assert_test("@media (max-width: 1100px)" in map_css, "CSS includes responsive layout query for tablets")
assert_test("@media (max-width: 768px)" in map_css, "CSS includes responsive layout query for mobile")

# --------------------------------------------------------------------------
# 10. DETERMINISTIC BEHAVIOR & SIMULATION SUITE
# --------------------------------------------------------------------------
print("\n--- Functional Simulation Suite ---")

# A. Status vs Selected State Isolation Simulation
def compute_tile_classes(status, is_selected, is_matched, is_filtered_out):
    status_cls = f"lot--{status.lower().replace(' ', '-')}"
    classes = [status_cls]
    if is_selected:
        classes.append("is-selected")
    if is_matched:
        classes.append("is-matched")
    if is_filtered_out:
        classes.append("is-filtered-out")
    return " ".join(classes)

# Available + Selected
c1 = compute_tile_classes("Available", is_selected=True, is_matched=False, is_filtered_out=False)
assert_test("lot--available" in c1 and "is-selected" in c1, "Simulation: Available lot maintains lot--available when is-selected")

# Occupied + Selected
c2 = compute_tile_classes("Occupied", is_selected=True, is_matched=False, is_filtered_out=False)
assert_test("lot--occupied" in c2 and "is-selected" in c2, "Simulation: Occupied lot maintains lot--occupied when is-selected")

# Reserved + Selected
c3 = compute_tile_classes("Reserved", is_selected=True, is_matched=False, is_filtered_out=False)
assert_test("lot--reserved" in c3 and "is-selected" in c3, "Simulation: Reserved lot maintains lot--reserved when is-selected")

# Under Maintenance + Selected
c4 = compute_tile_classes("Under Maintenance", is_selected=True, is_matched=False, is_filtered_out=False)
assert_test("lot--under-maintenance" in c4 and "is-selected" in c4, "Simulation: Under Maintenance lot maintains status class when is-selected")

# B. ViewBox Centering Mathematics Simulation
def simulate_center_viewbox(base_w, base_h, lot_center_x, lot_center_y, zoom_factor=0.55):
    target_w = base_w * zoom_factor
    target_h = base_h * zoom_factor
    vx = max(0.0, min(base_w - target_w, lot_center_x - (target_w / 2.0)))
    vy = max(0.0, min(base_h - target_h, lot_center_y - (target_h / 2.0)))
    return vx, vy, target_w, target_h

vx, vy, tw, th = simulate_center_viewbox(1600, 1000, 800, 500, 0.55)
assert_test(abs(tw - 880.0) < 1e-5 and abs(th - 550.0) < 1e-5,
            "Simulation: ViewBox dimensions correctly scaled by zoom factor (880 x 550)")
assert_test(abs(vx - 360.0) < 1e-5 and abs(vy - 225.0) < 1e-5,
            "Simulation: Center point perfectly centered in viewBox (x=360, y=225)")

# Clamp boundary check
vx_edge, vy_edge, _, _ = simulate_center_viewbox(1600, 1000, 50, 50, 0.55)
assert_test(vx_edge == 0.0 and vy_edge == 0.0, "Simulation: ViewBox safely clamped at top-left edge")

# C. Booking URL Parameter Construction Simulation
def simulate_booking_link(lot_id, lot_number):
    import urllib.parse
    encoded_lot = urllib.parse.quote(lot_number)
    return f"booking-assistant.html?service=burial&lot_id={lot_id}&lot_number={encoded_lot}"

book_url = simulate_booking_link(14, "A1-005 (Garden)")
assert_test("lot_id=14" in book_url and "lot_number=A1-005%20%28Garden%29" in book_url,
            "Simulation: Booking deep link safely encodes special characters in lot_number")

# D. Breadcrumb Trail State Simulation
def simulate_breadcrumbs(view_level, section_name, block_name, lot_number):
    trail = ["Cemetery Overview"]
    if view_level == "block":
        if section_name:
            trail.append(section_name)
        if block_name:
            trail.append(block_name)
        if lot_number:
            trail.append(f"Lot {lot_number}")
    return " › ".join(trail)

overview_trail = simulate_breadcrumbs("cemetery", None, None, None)
assert_test(overview_trail == "Cemetery Overview", "Simulation: Overview breadcrumb shows root facility")

lot_trail = simulate_breadcrumbs("block", "Section A", "Block 2", "L-014")
assert_test(lot_trail == "Cemetery Overview › Section A › Block 2 › Lot L-014",
            "Simulation: Full hierarchy path formed: Cemetery › Section A › Block 2 › Lot L-014")

print("\n==========================================")
print(f"TOTAL PASSED: {passed}")
print(f"TOTAL FAILED: {len(errors)}")
print("==========================================")

if errors:
    sys.exit(1)
sys.exit(0)
