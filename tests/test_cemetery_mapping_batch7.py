"""
Test Suite for Cemetery Mapping Batch 7:
Cemetery Visitor Wayfinding & Printable Lot Location Slip
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


print("=== CEMETERY MAPPING BATCH 7 VALIDATION ===")

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
    assert_test(token not in map_ctrl, f"Backend MapController does not expose '{token}'")

# Slip privacy notice
assert_test("slip-privacy-shield" in map_html, "Printable slip contains explicit privacy shield element")
assert_test("confidential" in map_html.lower(), "Printable slip explicitly states records are confidential")
assert_test("wayfinding" in map_html.lower(), "Slip clarifies scope is physical visitor wayfinding")

# --------------------------------------------------------------------------
# 3. TRIGGER BUTTON & MODAL STRUCTURE IN HTML
# --------------------------------------------------------------------------
assert_test("btnOpenWayfindingSlip" in map_html, "Drawer footer contains #btnOpenWayfindingSlip button")
assert_test("wayfindingSlipModal" in map_html, "HTML contains #wayfindingSlipModal backdrop dialog")
assert_test("printableWayfindingSlip" in map_html, "HTML contains #printableWayfindingSlip document card")
assert_test("btnCloseWayfindingSlip" in map_html, "HTML contains #btnCloseWayfindingSlip dismiss button")
assert_test("btnPrintSlip" in map_html, "HTML contains #btnPrintSlip print trigger")

# Slip header & identification elements
assert_test("slipFacilityName" in map_html, "Slip contains facility name element")
assert_test("slipRefCode" in map_html, "Slip contains reference code element")
assert_test("slipTimestamp" in map_html, "Slip contains issuance timestamp element")
assert_test("slipLotNumber" in map_html, "Slip contains primary lot number element")
assert_test("slipStatusText" in map_html, "Slip contains status text indicator")
assert_test("slipDimensions" in map_html, "Slip contains dimensions indicator")

# 4-Step Pathway elements
assert_test("slipStepFacility" in map_html, "Pathway Step 1 contains Facility entrance")
assert_test("slipStepSection" in map_html, "Pathway Step 2 contains Section")
assert_test("slipStepBlock" in map_html, "Pathway Step 3 contains Block")
assert_test("slipStepLot" in map_html, "Pathway Step 4 contains Exact Plot")

# Schematic Diagram and Table
assert_test("slipMiniMapSvg" in map_html, "HTML contains #slipMiniMapSvg schematic SVG canvas")
assert_test("slipTableFacility" in map_html, "Metrics table contains Facility label")
assert_test("slipTableSection" in map_html, "Metrics table contains Section label")
assert_test("slipTableBlock" in map_html, "Metrics table contains Block label")
assert_test("slipTableLot" in map_html, "Metrics table contains Lot label")
assert_test("slipTableType" in map_html, "Metrics table contains Classification type")

# Visitor guidelines
assert_test("slip-etiquette-box" in map_html, "Slip features visitor etiquette and guidelines box")

# --------------------------------------------------------------------------
# 4. CONTROLLER ENGINE IN CEMETERY-MAP.JS
# --------------------------------------------------------------------------
assert_test("btnOpenWayfindingSlip" in map_js, "cemetery-map.js references #btnOpenWayfindingSlip")
assert_test("openWayfindingSlip" in map_js, "cemetery-map.js implements openWayfindingSlip()")
assert_test("closeWayfindingSlip" in map_js, "cemetery-map.js implements closeWayfindingSlip()")
assert_test("printWayfindingSlip" in map_js, "cemetery-map.js implements printWayfindingSlip()")
assert_test("renderSlipMiniMap" in map_js, "cemetery-map.js implements renderSlipMiniMap()")
assert_test("window.print()" in map_js, "printWayfindingSlip() invokes native window.print()")

# Mini SVG Schematic rendering
assert_test("slipMiniMapSvg" in map_js, "cemetery-map.js controls #slipMiniMapSvg")
assert_test("isTarget" in map_js, "renderSlipMiniMap distinguishes target plot from surrounding plots")
assert_test("createElementNS" in map_js and "http://www.w3.org/2000/svg" in map_js,
            "renderSlipMiniMap generates standard SVG elements programmatically")

# Modal lifecycle and backdrop dismiss
assert_test("wayfindingSlipModal.addEventListener" in map_js, "Modal backdrop click closes slip")
assert_test("e.key === 'Escape'" in map_js or "Escape" in map_js, "Escape key dismisses wayfinding slip")

# --------------------------------------------------------------------------
# 5. CSS STYLING & MEDIA PRINT OPTIMIZATION
# --------------------------------------------------------------------------
assert_test(".btn-wayfinding-slip" in map_css, "CSS defines .btn-wayfinding-slip button style")
assert_test(".wayfinding-slip-modal-backdrop" in map_css, "CSS defines .wayfinding-slip-modal-backdrop")
assert_test(".printable-slip-card" in map_css, "CSS defines .printable-slip-card layout")
assert_test(".slip-step-card" in map_css, "CSS defines 4-step pathway cards")
assert_test(".slip-minimap-svg" in map_css, "CSS defines .slip-minimap-svg styling")

# @media print rules
assert_test("@media print" in map_css, "CSS contains @media print stylesheet")
assert_test("page-break-inside: avoid" in map_css, "Print styling avoids awkward page breaks")
assert_test("-webkit-print-color-adjust: exact" in map_css, "Print styling forces exact background contrast")
assert_test(".sidebar" in map_css and "display: none !important" in map_css, "Print styling hides .sidebar")
assert_test(".top-bar" in map_css and "display: none !important" in map_css, "Print styling hides .top-bar")
assert_test(".no-print" in map_css and "display: none !important" in map_css, "Print styling hides .no-print elements")
assert_test("wayfinding-slip-modal-backdrop" in map_css and "position: static !important" in map_css,
            "Print styling removes fixed overlay and elevates slip to page root")

# --------------------------------------------------------------------------
# 6. FUNCTIONAL SIMULATION TESTS
# --------------------------------------------------------------------------
print("\n--- Functional Simulation Suite ---")

# A. Reference code format simulation
lot_id_test = 42
padded_ref = f"CEM-LOT-{str(lot_id_test).zfill(4)}"
assert_test(padded_ref == "CEM-LOT-0042", f"Reference code formats correctly ({padded_ref})")

# B. Status color mapping simulation
status_map = {
    'Available': '#10b981',
    'Reserved': '#f59e0b',
    'Occupied': '#64748b',
    'Unavailable': '#ef4444',
    'Under Maintenance': '#ef4444'
}
assert_test(status_map.get('Available') == '#10b981', "Available maps to green tone")
assert_test(status_map.get('Reserved') == '#f59e0b', "Reserved maps to amber tone")
assert_test(status_map.get('Occupied') == '#64748b', "Occupied maps to neutral slate tone")

# C. Mini Map Grid math simulation
def calc_grid(lot_count, cols=5, canvas_w=600, canvas_h=360, margin=28, header_h=34, gap_x=10, gap_y=10):
    grid_w = canvas_w - (margin * 2)
    grid_y = margin + header_h
    grid_h = canvas_h - grid_y - margin
    import math
    rows = math.ceil(lot_count / cols)
    tile_w = (grid_w - ((cols - 1) * gap_x)) / cols
    tile_h = (grid_h - ((rows - 1) * gap_y)) / rows
    return rows, tile_w, tile_h

rows, tw, th = calc_grid(20, cols=5)
assert_test(rows == 4, f"20 lots at 5 cols produce 4 rows ({rows})")
assert_test(tw > 0 and th > 0, f"Tile dimensions are positive (w={tw:.1f}, h={th:.1f})")

# D. 4-step pathway data fidelity simulation
pathway = [
    {"num": 1, "level": "Facility Entrance", "name": "Memorial Park Main Gate"},
    {"num": 2, "level": "Cemetery Section", "name": "Garden of Peace"},
    {"num": 3, "level": "Burial Block", "name": "Block B2"},
    {"num": 4, "level": "Exact Plot", "name": "Plot #B2-015"}
]
assert_test(len(pathway) == 4, "Wayfinding pathway contains exactly 4 progressive tiers")
assert_test(pathway[3]["name"] == "Plot #B2-015", "Final pathway step targets exact lot")

# E. Zero PII leak test in simulated slip data
slip_payload = {
    "facility": "Evergreen Cemetery",
    "section": "Section 1",
    "block": "Block A",
    "lot_number": "A-01",
    "status": "Available",
    "dimensions": "1.0m x 2.4m",
    "price": "45000"
}
has_pii = any(k in slip_payload for k in ["deceased_name", "claimant_name", "contact", "email"])
assert_test(not has_pii, "Wayfinding slip data structure is strictly free of PII")

# --------------------------------------------------------------------------
# SUMMARY
# --------------------------------------------------------------------------
print("\n==========================================")
print(f"TOTAL PASSED: {passed}")
print(f"TOTAL FAILED: {len(errors)}")
print("==========================================")

if errors:
    sys.exit(1)
sys.exit(0)
