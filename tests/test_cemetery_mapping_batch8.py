"""
Cemetery Mapping Batch 8 Validation Test Suite
Tests View Hierarchy & Drill-Down Navigation:
Overview -> Section -> Block -> Lot
"""

import os
import re
import unittest

WORKSPACE_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HTML_PATH = os.path.join(WORKSPACE_ROOT, 'frontend', 'pages', 'cemetery-map.html')
JS_PATH = os.path.join(WORKSPACE_ROOT, 'assets', 'js', 'pages', 'cemetery-map.js')
CSS_PATH = os.path.join(WORKSPACE_ROOT, 'assets', 'css', 'cemetery-map.css')

class TestCemeteryMappingBatch8(unittest.TestCase):

    @classmethod
    def setUpClass(cls):
        with open(HTML_PATH, 'r', encoding='utf-8') as f:
            cls.html = f.read()
        with open(JS_PATH, 'r', encoding='utf-8') as f:
            cls.js = f.read()
        with open(CSS_PATH, 'r', encoding='utf-8') as f:
            cls.css = f.read()

    # --- 1. State Requirements ---
    def test_state_declares_map_view_level(self):
        self.assertIn("mapViewLevel: 'overview'", self.js, "state must initialize mapViewLevel to 'overview'")

    def test_state_declares_focused_hierarchy_ids(self):
        self.assertIn("focusedSectionId: null", self.js, "state must declare focusedSectionId")
        self.assertIn("focusedBlockId: null", self.js, "state must declare focusedBlockId")
        self.assertIn("focusedLotId: null", self.js, "state must declare focusedLotId")

    # --- 2. HTML Breadcrumbs & View Level Indicator ---
    def test_html_has_breadcrumbs_with_accessible_roles(self):
        self.assertIn('id="mapBreadcrumbs"', self.html)
        self.assertIn('id="bcCemetery"', self.html)
        self.assertIn('id="bcSection"', self.html)
        self.assertIn('id="bcBlock"', self.html)
        self.assertIn('id="bcLot"', self.html)
        self.assertIn('role="button"', self.html)
        self.assertIn('tabindex="0"', self.html)

    def test_html_has_view_level_indicator_and_back_button(self):
        self.assertIn('id="viewLevelBadge"', self.html)
        self.assertIn('id="viewLevelText"', self.html)
        self.assertIn('id="btnBackToOverview"', self.html)
        self.assertIn('id="btnBackText"', self.html)

    # --- 3. JavaScript Functions ---
    def test_js_implements_update_view_level_indicator(self):
        self.assertIn('function updateViewLevelIndicator()', self.js)

    def test_js_implements_navigate_up_one_level(self):
        self.assertIn('function navigateUpOneLevel()', self.js)

    def test_js_implements_focus_on_section(self):
        self.assertIn('function focusOnSection(section)', self.js)
        self.assertIn("state.mapViewLevel = 'section'", self.js)

    def test_js_implements_focus_on_block(self):
        self.assertIn('function focusOnBlock(block, section)', self.js)
        self.assertIn("state.mapViewLevel = 'block'", self.js)

    def test_js_select_lot_sets_lot_level(self):
        self.assertIn("state.mapViewLevel = 'lot'", self.js)
        self.assertIn("state.focusedLotId = lot.lot_id", self.js)

    def test_js_return_to_overview_resets_hierarchy(self):
        self.assertIn("state.mapViewLevel = 'overview'", self.js)
        self.assertIn("state.focusedSectionId = null", self.js)
        self.assertIn("state.focusedBlockId = null", self.js)
        self.assertIn("state.focusedLotId = null", self.js)

    def test_js_section_click_drills_down(self):
        self.assertIn("secGroup.addEventListener('click'", self.js)
        self.assertIn("focusOnSection(section)", self.js)

    def test_js_block_click_drills_down(self):
        self.assertIn("blkGroup.addEventListener('click'", self.js)
        self.assertIn("focusOnBlock(block, section)", self.js)

    def test_js_reset_view_returns_to_overview(self):
        self.assertIn('returnToCemeteryOverview();', self.js)

    # --- 4. CSS Styling ---
    def test_css_defines_section_and_block_focus_styles(self):
        self.assertIn('.svg-section-card.is-focused-section', self.css)
        self.assertIn('.svg-block-card.is-focused-block', self.css)

    def test_css_defines_view_level_badge_clickable_steps(self):
        self.assertIn('.view-level-badge .level-step.clickable', self.css)
        self.assertIn('.view-level-badge .level-sep', self.css)

    def test_css_supports_dark_mode_for_batch8(self):
        self.assertIn('[data-theme="dark"] .svg-section-card.is-focused-section', self.css)
        self.assertIn('[data-theme="dark"] .svg-block-card.is-focused-block', self.css)
        self.assertIn('[data-theme="dark"] .view-level-badge .level-step.clickable', self.css)

    # --- 5. Route Safety ---
    def test_route_safety_in_return_to_overview(self):
        # Must check state.activeRoute before closing drawer or clearing route
        self.assertIn('if (!state.activeRoute)', self.js)

if __name__ == '__main__':
    unittest.main()
