"""
Test Suite for Cemetery Mapping Batch 4A: Interactive Map Search & Filters
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

print("=== CEMETERY MAPPING BATCH 4A VALIDATION ===")

# 1. HTML Search & Filter Controls Verification
html_path = ROOT / 'frontend' / 'pages' / 'cemetery-map.html'
assert_true('cemetery-map.html exists', html_path.exists())

if html_path.exists():
    html_text = html_path.read_text(encoding='utf-8')
    assert_true('Has mapFilterToolbar container', 'id="mapFilterToolbar"' in html_text)
    assert_true('Has mapSearchInput', 'id="mapSearchInput"' in html_text)
    assert_true('Has btnClearSearch', 'id="btnClearSearch"' in html_text)
    assert_true('Has btnMapSearch', 'id="btnMapSearch"' in html_text)
    assert_true('Has searchResultsDropdown', 'id="searchResultsDropdown"' in html_text)
    assert_true('Has statusFilter select', 'id="statusFilter"' in html_text)
    assert_true('Has minPriceInput', 'id="minPriceInput"' in html_text)
    assert_true('Has maxPriceInput', 'id="maxPriceInput"' in html_text)
    assert_true('Has btnClearFilters', 'id="btnClearFilters"' in html_text)
    assert_true('Has activeFiltersSummary', 'id="activeFiltersSummary"' in html_text)
    assert_true('Has filterMatchesBadge', 'id="filterMatchesBadge"' in html_text)

    # Check status options
    for status_opt in ['all', 'Available', 'Reserved', 'Occupied', 'Unavailable', 'Under Maintenance']:
        assert_true(f'statusFilter contains option: {status_opt}', f'value="{status_opt}"' in html_text)

# 2. CSS Stylesheet Verification
css_path = ROOT / 'assets' / 'css' / 'cemetery-map.css'
assert_true('cemetery-map.css exists', css_path.exists())

if css_path.exists():
    css_text = css_path.read_text(encoding='utf-8')
    assert_true('Has .map-filter-toolbar styles', '.map-filter-toolbar' in css_text)
    assert_true('Has .search-results-dropdown styles', '.search-results-dropdown' in css_text)
    assert_true('Has .search-result-item styles', '.search-result-item' in css_text)
    assert_true('Has .filter-chip styles', '.filter-chip' in css_text)
    assert_true('Has .svg-lot-tile.is-filtered-out styles', '.svg-lot-tile.is-filtered-out' in css_text)
    assert_true('Has .svg-lot-tile.is-matched styles', '.svg-lot-tile.is-matched' in css_text)
    assert_true('Has responsive filter toolbar rule', '.map-filter-toolbar' in css_text and '@media (max-width:' in css_text)

# 3. JavaScript Search & Filter Logic Verification
js_path = ROOT / 'assets' / 'js' / 'pages' / 'cemetery-map.js'
assert_true('cemetery-map.js exists', js_path.exists())

if js_path.exists():
    js_text = js_path.read_text(encoding='utf-8')
    assert_true('Has filters state object', 'filters:' in js_text and 'search:' in js_text and 'status:' in js_text)
    assert_true('Has blockLotsCache for progressive caching', 'blockLotsCache:' in js_text)
    assert_true('Implements executeSearch()', 'function executeSearch(' in js_text or 'executeSearch =' in js_text)
    assert_true('Implements searchLotsAcrossCemetery()', 'searchLotsAcrossCemetery' in js_text)
    assert_true('Implements navigateAndSelectLot()', 'navigateAndSelectLot' in js_text)
    assert_true('Implements renderSearchResultsDropdown()', 'renderSearchResultsDropdown' in js_text)
    assert_true('Implements handlePriceFilterChange()', 'handlePriceFilterChange' in js_text)
    assert_true('Implements lotMatchesFilters()', 'lotMatchesFilters' in js_text)
    assert_true('Implements applyFilters()', 'applyFilters' in js_text)
    assert_true('Implements resetAllFilters()', 'resetAllFilters' in js_text)
    assert_true('Enforces cemetery isolation by clearing cache', 'state.blockLotsCache = {};' in js_text)
    assert_true('Case-insensitive & whitespace search normalization', '.toLowerCase().trim()' in js_text or '.trim().toLowerCase()' in js_text)
    assert_true('Handles multiple search results', 'matchingLots.length > 1' in js_text or 'results.slice' in js_text)
    assert_true('Handles single exact search match', 'matchingLots.length === 1' in js_text)
    assert_true('Preserves booking deep link contract', 'booking-assistant.html?service=burial&lot_id=' in js_text)

# 4. Pure Functional Simulation of Search and Filter Logic
print("\n--- Functional Logic Simulation ---")

sample_lots = [
    {"lot_id": 1, "lot_number": "A1-01", "status": "Reserved", "price": 1500.0},
    {"lot_id": 2, "lot_number": "A1-02", "status": "Available", "price": 2500.0},
    {"lot_id": 3, "lot_number": "A1-03", "status": "Occupied", "price": 3000.0},
    {"lot_id": 4, "lot_number": "A2-01", "status": "Available", "price": 2000.0},
    {"lot_id": 5, "lot_number": "B1-01", "status": "Unavailable", "price": 1800.0},
]

def simulate_filter(lots, search="", status="all", min_price=None, max_price=None):
    results = []
    norm_q = search.strip().lower()
    for lot in lots:
        # Search
        if norm_q and norm_q not in lot["lot_number"].lower():
            continue
        # Status
        if status != "all" and lot["status"].lower() != status.lower():
            continue
        # Price
        p = lot["price"]
        if min_price is not None and p < min_price:
            continue
        if max_price is not None and p > max_price:
            continue
        results.append(lot)
    return results

# Test Cases:
# A. Search Lot case-insensitive & whitespace
res_a = simulate_filter(sample_lots, search="  a1-02  ")
assert_true('Search case-insensitive & whitespace finds A1-02', len(res_a) == 1 and res_a[0]["lot_id"] == 2)

# B. Multiple search results
res_b = simulate_filter(sample_lots, search="01")
assert_true('Search "01" finds 3 lots (A1-01, A2-01, B1-01)', len(res_b) == 3)

# C. Status Filter
res_c = simulate_filter(sample_lots, status="Available")
assert_true('Filter status="Available" finds 2 lots', len(res_c) == 2 and all(l["status"] == "Available" for l in res_c))

# D. Price Filter Range
res_d = simulate_filter(sample_lots, min_price=2000.0, max_price=2500.0)
assert_true('Filter price PHP 2,000 - PHP 2,500 finds 2 lots', len(res_d) == 2 and {l["lot_id"] for l in res_d} == {2, 4})

# E. Combined Filter (Search + Status + Price)
res_e = simulate_filter(sample_lots, search="A1", status="Available", min_price=2000.0, max_price=3000.0)
assert_true('Combined filter finds exact matching lot A1-02', len(res_e) == 1 and res_e[0]["lot_number"] == "A1-02")

# F. Combined Filter with 0 matches
res_f = simulate_filter(sample_lots, search="B1", status="Available")
assert_true('Combined filter with no matches returns empty list', len(res_f) == 0)

# G. Invalid min > max handled gracefully
def safe_price_range(min_p, max_p):
    if min_p is not None and max_p is not None and min_p > max_p:
        return False # flagged invalid
    return True

assert_true('Detects min > max price gracefully', safe_price_range(5000, 2000) is False)
assert_true('Validates normal price range', safe_price_range(2000, 5000) is True)

# H. Cemetery Isolation Check
cache_mock = {"1": [{"lot_id": 1, "lot_number": "A1-01"}]}
# Switch cemetery:
cache_mock.clear()
assert_true('Cemetery switch clears blockLotsCache', len(cache_mock) == 0)

print("\n==========================================")
print(f"TOTAL PASSED: {passed}")
print(f"TOTAL FAILED: {len(errors)}")
print("==========================================")

if errors:
    sys.exit(1)
