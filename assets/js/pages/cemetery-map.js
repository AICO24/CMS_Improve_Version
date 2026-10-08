/**
 * Interactive Cemetery Map & Lot Locator Controller (Batch 3 & 4A)
 * 
 * Native SVG vector engine with deterministic procedural layout,
 * progressive drill-down, live status rendering, search, filters, and booking deep-linking.
 */
(function () {
    'use strict';

    // Application State
    const state = {
        cemeteries: [],
        currentCemeteryId: null,
        currentCemetery: null,
        currentLayout: null,
        currentSection: null,
        currentBlock: null,
        currentLots: [],
        selectedLot: null,
        viewLevel: 'cemetery', // 'cemetery' | 'block'
        activeMapView: 'plot', // 'plot' | 'geo' (Batch 9A)
        isLoading: false,

        // Block Lots In-Memory Cache (scoped to current cemetery, cleared on switch)
        blockLotsCache: {},

        // Filter State (Batch 4A)
        filters: {
            search: '',
            status: 'all',
            minPrice: null,
            maxPrice: null,
        },

        // SVG Viewport & Navigation Matrix
        baseViewBox: { x: 0, y: 0, width: 1600, height: 1000 },
        currentViewBox: { x: 0, y: 0, width: 1600, height: 1000 },
        zoomLevel: 1.0,
        isPanning: false,
        panStart: { x: 0, y: 0 },
    };

    // DOM Elements
    let cemeterySelector;
    let mapBreadcrumbs, bcCemetery, bcCemeteryName, bcSection, bcSectionName, bcBlock, bcBlockName, bcLot, bcLotName;
    let statSections, statBlocks, statLots, statFacilityActive;
    let viewLevelBadge, viewLevelText, btnBackToOverview, filterMatchesBadge;
    let btnZoomIn, btnZoomOut, btnResetZoom;
    let svgStageContainer, cemeteryMapSvg, mapTransformLayer;
    let mapLoadingOverlay, loadingText, mapEmptyOverlay, emptyIcon, emptyTitle, emptyDesc, btnRetryMap;
    let svgFloatingTooltip;
    let lotDetailsDrawer, btnCloseDrawer, drawerLotNumber, drawerStatusDot, drawerStatusText;
    let drawerFacilityName, drawerSectionName, drawerBlockName, drawerLotType, drawerDimensions, drawerPrice;
    let drawerElevationRow, drawerElevationPlacement;
    let drawerNotesRow, drawerLocationNotes, btnBookThisLot, btnLotUnavailable;
    let mapLocationSummaryCard, locSummarySection, locSummaryBlock, locSummaryLot, btnCenterOnMapHud;
    let drawerYouAreHereBadge, drawerTrailFacility, drawerTrailSection, drawerTrailBlock, drawerTrailLot, btnCenterOnMapDrawer;
    let btnOpenWayfindingSlip;

    // Batch 9A: Dual-View & Geographic Location Viewport DOM Elements
    let mapViewSwitcher, btnSwitchPlotView, btnSwitchGeoView;
    let geoStageContainer, geoMapFrame, geoMapIframe;
    let geoZoneSelectorBar, geoZoneChips;
    let geoFacilityHud, geoHudFacilityName, geoHudAddress, geoHudAccessCue, btnGetDirectionsGeo, btnReturnPlotsGeo;

    // Batch 9B: Facility Landmarks & Drawer Access DOM Elements
    let geoLandmarksTray, geoLandmarkGate, geoLandmarkOffice, geoLandmarkParking, geoLandmarkChapel;
    let btnOpenWazeGeo;
    let drawerFacilityAccessCard, drawerAccessGateBadge, drawerAccessGateText, drawerAccessAddressText, btnDrawerDirections, btnDrawerViewGeoMap;

    // Batch 8A: Visual Archetype Showcase DOM Elements
    let drawerVisualShowcase, drawerImageFrame, drawerArchetypeGraphic, drawerArchetypeBadgeText, drawerCapacityText, drawerDimensionSpec;

    // Batch 8B: Location Value Tier & Monument Guidelines DOM Elements
    let drawerLocationTierCard, drawerLocationTierBadge, drawerLocationTierDesc;
    let drawerMonumentCard, drawerMonumentRule, drawerPerpetualCare, drawerIntermentPrivilege;

    // Batch 8C: Fullscreen Visual Lightbox & Slip Parity DOM Elements
    let btnExpandArchetype, archetypeLightboxModal, btnCloseLightbox;
    let lightboxGraphicStage, lightboxArchetypeBadge, lightboxTierBadge, lightboxLotHeading, lightboxLotDesc;
    let lightboxCapacityVal, lightboxDimensionsVal, lightboxMonumentVal, lightboxCareVal, lightboxIntermentVal, lightboxPriceVal;
    let slipArchetypeBox, slipArchetypePreview, slipMonumentRule, slipCapacityRule, slipLocationTierRule;

    // Wayfinding & Location Slip Modal DOM Elements (Batch 7)
    let wayfindingSlipModal, btnCloseWayfindingSlip, btnPrintSlip;
    let slipFacilityName, slipFacilityAddress, slipRefCode, slipTimestamp;
    let slipLotNumber, slipLotType, slipStatusDot, slipStatusText, slipDimensions;
    let slipStepFacility, slipStepSection, slipStepBlock, slipStepLot;
    let slipMiniMapSvg, slipTableFacility, slipTableSection, slipTableBlock, slipTableLot, slipTableType, slipTableDimensions;
    let slipRowNotes, slipTableNotes;

    // Search & Filter DOM Elements (Batch 4A)
    let mapSearchInput, btnClearSearch, btnMapSearch, searchResultsDropdown;
    let statusFilter, minPriceInput, maxPriceInput, btnClearFilters;
    let activeFiltersSummary, activeFilterCount, activeFilterChips;

    /**
     * Entry Point on DOM Content Loaded
     */
    document.addEventListener('DOMContentLoaded', async function () {
        // Enforce route authentication across allowed roles
        if (typeof requireRole === 'function') {
            const user = await requireRole(['admin', 'staff', 'user']);
            if (!user) return;
        }

        // Setup Logout modal helper if present
        if (typeof api !== 'undefined' && typeof api.setupLogoutButton === 'function') {
            api.setupLogoutButton();
        }

        bindElements();
        attachEventListeners();
        await loadCemeteries();
    });

    /**
     * Cache DOM Elements
     */
    function bindElements() {
        cemeterySelector = document.getElementById('cemeterySelector');
        mapBreadcrumbs = document.getElementById('mapBreadcrumbs');
        bcCemetery = document.getElementById('bcCemetery');
        bcCemeteryName = document.getElementById('bcCemeteryName');
        bcSection = document.getElementById('bcSection');
        bcSectionName = document.getElementById('bcSectionName');
        bcBlock = document.getElementById('bcBlock');
        bcBlockName = document.getElementById('bcBlockName');
        bcLot = document.getElementById('bcLot');
        bcLotName = document.getElementById('bcLotName');

        statSections = document.getElementById('statSections');
        statBlocks = document.getElementById('statBlocks');
        statLots = document.getElementById('statLots');
        statFacilityActive = document.getElementById('statFacilityActive');

        viewLevelBadge = document.getElementById('viewLevelBadge');
        viewLevelText = document.getElementById('viewLevelText');
        btnBackToOverview = document.getElementById('btnBackToOverview');
        filterMatchesBadge = document.getElementById('filterMatchesBadge');

        btnZoomIn = document.getElementById('btnZoomIn');
        btnZoomOut = document.getElementById('btnZoomOut');
        btnResetZoom = document.getElementById('btnResetZoom');

        svgStageContainer = document.getElementById('svgStageContainer');
        cemeteryMapSvg = document.getElementById('cemeteryMapSvg');
        mapTransformLayer = document.getElementById('mapTransformLayer');

        mapLoadingOverlay = document.getElementById('mapLoadingOverlay');
        loadingText = document.getElementById('loadingText');
        mapEmptyOverlay = document.getElementById('mapEmptyOverlay');
        emptyIcon = document.getElementById('emptyIcon');
        emptyTitle = document.getElementById('emptyTitle');
        emptyDesc = document.getElementById('emptyDesc');
        btnRetryMap = document.getElementById('btnRetryMap');

        svgFloatingTooltip = document.getElementById('svgFloatingTooltip');

        lotDetailsDrawer = document.getElementById('lotDetailsDrawer');
        btnCloseDrawer = document.getElementById('btnCloseDrawer');
        drawerLotNumber = document.getElementById('drawerLotNumber');
        drawerStatusDot = document.getElementById('drawerStatusDot');
        drawerStatusText = document.getElementById('drawerStatusText');
        drawerFacilityName = document.getElementById('drawerFacilityName');
        drawerSectionName = document.getElementById('drawerSectionName');
        drawerBlockName = document.getElementById('drawerBlockName');
        drawerLotType = document.getElementById('drawerLotType');
        drawerDimensions = document.getElementById('drawerDimensions');
        drawerPrice = document.getElementById('drawerPrice');
        drawerElevationRow = document.getElementById('drawerElevationRow');
        drawerElevationPlacement = document.getElementById('drawerElevationPlacement');
        drawerNotesRow = document.getElementById('drawerNotesRow');
        drawerLocationNotes = document.getElementById('drawerLocationNotes');
        btnBookThisLot = document.getElementById('btnBookThisLot');
        btnLotUnavailable = document.getElementById('btnLotUnavailable');

        // Batch 6: On-Map Location Summary HUD Elements
        mapLocationSummaryCard = document.getElementById('mapLocationSummaryCard');
        locSummarySection = document.getElementById('locSummarySection');
        locSummaryBlock = document.getElementById('locSummaryBlock');
        locSummaryLot = document.getElementById('locSummaryLot');
        btnCenterOnMapHud = document.getElementById('btnCenterOnMapHud');

        // Batch 6: Drawer Location Hierarchy Elements
        drawerYouAreHereBadge = document.getElementById('drawerYouAreHereBadge');
        drawerTrailFacility = document.getElementById('drawerTrailFacility');
        drawerTrailSection = document.getElementById('drawerTrailSection');
        drawerTrailBlock = document.getElementById('drawerTrailBlock');
        drawerTrailLot = document.getElementById('drawerTrailLot');
        btnCenterOnMapDrawer = document.getElementById('btnCenterOnMapDrawer');
        btnOpenWayfindingSlip = document.getElementById('btnOpenWayfindingSlip');

        // Batch 8A: Visual Archetype Showcase DOM Elements
        drawerVisualShowcase = document.getElementById('drawerVisualShowcase');
        drawerImageFrame = document.getElementById('drawerImageFrame');
        drawerArchetypeGraphic = document.getElementById('drawerArchetypeGraphic');
        drawerArchetypeBadgeText = document.getElementById('drawerArchetypeBadgeText');
        drawerCapacityText = document.getElementById('drawerCapacityText');
        drawerDimensionSpec = document.getElementById('drawerDimensionSpec');

        // Batch 8B: Location Value Tier & Monument Guidelines Elements
        drawerLocationTierCard = document.getElementById('drawerLocationTierCard');
        drawerLocationTierBadge = document.getElementById('drawerLocationTierBadge');
        drawerLocationTierDesc = document.getElementById('drawerLocationTierDesc');
        drawerMonumentCard = document.getElementById('drawerMonumentCard');
        drawerMonumentRule = document.getElementById('drawerMonumentRule');
        drawerPerpetualCare = document.getElementById('drawerPerpetualCare');
        drawerIntermentPrivilege = document.getElementById('drawerIntermentPrivilege');

        // Batch 8C: Fullscreen Visual Lightbox & Slip Parity Elements
        btnExpandArchetype = document.getElementById('btnExpandArchetype');
        archetypeLightboxModal = document.getElementById('archetypeLightboxModal');
        btnCloseLightbox = document.getElementById('btnCloseLightbox');
        lightboxGraphicStage = document.getElementById('lightboxGraphicStage');
        lightboxArchetypeBadge = document.getElementById('lightboxArchetypeBadge');
        lightboxTierBadge = document.getElementById('lightboxTierBadge');
        lightboxLotHeading = document.getElementById('lightboxLotHeading');
        lightboxLotDesc = document.getElementById('lightboxLotDesc');
        lightboxCapacityVal = document.getElementById('lightboxCapacityVal');
        lightboxDimensionsVal = document.getElementById('lightboxDimensionsVal');
        lightboxMonumentVal = document.getElementById('lightboxMonumentVal');
        lightboxCareVal = document.getElementById('lightboxCareVal');
        lightboxIntermentVal = document.getElementById('lightboxIntermentVal');
        lightboxPriceVal = document.getElementById('lightboxPriceVal');
        slipArchetypeBox = document.getElementById('slipArchetypeBox');
        slipArchetypePreview = document.getElementById('slipArchetypePreview');
        slipMonumentRule = document.getElementById('slipMonumentRule');
        slipCapacityRule = document.getElementById('slipCapacityRule');
        slipLocationTierRule = document.getElementById('slipLocationTierRule');

        // Batch 7: Wayfinding Slip Modal Elements
        wayfindingSlipModal = document.getElementById('wayfindingSlipModal');
        btnCloseWayfindingSlip = document.getElementById('btnCloseWayfindingSlip');
        btnPrintSlip = document.getElementById('btnPrintSlip');
        slipFacilityName = document.getElementById('slipFacilityName');
        slipFacilityAddress = document.getElementById('slipFacilityAddress');
        slipRefCode = document.getElementById('slipRefCode');
        slipTimestamp = document.getElementById('slipTimestamp');
        slipLotNumber = document.getElementById('slipLotNumber');
        slipLotType = document.getElementById('slipLotType');
        slipStatusDot = document.getElementById('slipStatusDot');
        slipStatusText = document.getElementById('slipStatusText');
        slipDimensions = document.getElementById('slipDimensions');
        slipStepFacility = document.getElementById('slipStepFacility');
        slipStepSection = document.getElementById('slipStepSection');
        slipStepBlock = document.getElementById('slipStepBlock');
        slipStepLot = document.getElementById('slipStepLot');
        slipMiniMapSvg = document.getElementById('slipMiniMapSvg');
        slipTableFacility = document.getElementById('slipTableFacility');
        slipTableSection = document.getElementById('slipTableSection');
        slipTableBlock = document.getElementById('slipTableBlock');
        slipTableLot = document.getElementById('slipTableLot');
        slipTableType = document.getElementById('slipTableType');
        slipTableDimensions = document.getElementById('slipTableDimensions');
        slipRowNotes = document.getElementById('slipRowNotes');
        slipTableNotes = document.getElementById('slipTableNotes');

        // Batch 9A: Dual-View Switcher & Geographic Viewport
        mapViewSwitcher = document.getElementById('mapViewSwitcher');
        btnSwitchPlotView = document.getElementById('btnSwitchPlotView');
        btnSwitchGeoView = document.getElementById('btnSwitchGeoView');
        geoStageContainer = document.getElementById('geoStageContainer');
        geoMapFrame = document.getElementById('geoMapFrame');
        geoMapIframe = document.getElementById('geoMapIframe');
        geoZoneSelectorBar = document.getElementById('geoZoneSelectorBar');
        geoZoneChips = document.getElementById('geoZoneChips');
        geoFacilityHud = document.getElementById('geoFacilityHud');
        geoHudFacilityName = document.getElementById('geoHudFacilityName');
        geoHudAddress = document.getElementById('geoHudAddress');
        geoHudAccessCue = document.getElementById('geoHudAccessCue');
        btnGetDirectionsGeo = document.getElementById('btnGetDirectionsGeo');
        btnReturnPlotsGeo = document.getElementById('btnReturnPlotsGeo');

        // Batch 9B: Facility Landmarks & Drawer Access Elements
        geoLandmarksTray = document.getElementById('geoLandmarksTray');
        geoLandmarkGate = document.getElementById('geoLandmarkGate');
        geoLandmarkOffice = document.getElementById('geoLandmarkOffice');
        geoLandmarkParking = document.getElementById('geoLandmarkParking');
        geoLandmarkChapel = document.getElementById('geoLandmarkChapel');
        btnOpenWazeGeo = document.getElementById('btnOpenWazeGeo');

        drawerFacilityAccessCard = document.getElementById('drawerFacilityAccessCard');
        drawerAccessGateBadge = document.getElementById('drawerAccessGateBadge');
        drawerAccessGateText = document.getElementById('drawerAccessGateText');
        drawerAccessAddressText = document.getElementById('drawerAccessAddressText');
        btnDrawerDirections = document.getElementById('btnDrawerDirections');
        btnDrawerViewGeoMap = document.getElementById('btnDrawerViewGeoMap');

        // Search & Filter Controls
        mapSearchInput = document.getElementById('mapSearchInput');
        btnClearSearch = document.getElementById('btnClearSearch');
        btnMapSearch = document.getElementById('btnMapSearch');
        searchResultsDropdown = document.getElementById('searchResultsDropdown');
        statusFilter = document.getElementById('statusFilter');
        minPriceInput = document.getElementById('minPriceInput');
        maxPriceInput = document.getElementById('maxPriceInput');
        btnClearFilters = document.getElementById('btnClearFilters');
        activeFiltersSummary = document.getElementById('activeFiltersSummary');
        activeFilterCount = document.getElementById('activeFilterCount');
        activeFilterChips = document.getElementById('activeFilterChips');
    }

    /**
     * Attach Event Listeners
     */
    function attachEventListeners() {
        // Cemetery facility selection
        cemeterySelector.addEventListener('change', async function () {
            const selectedId = parseInt(this.value, 10);
            if (selectedId && selectedId !== state.currentCemeteryId) {
                await switchCemetery(selectedId);
            }
        });

        // Breadcrumb navigation
        bcCemetery.addEventListener('click', () => {
            if (state.viewLevel !== 'cemetery') {
                returnToCemeteryOverview();
            }
        });

        btnBackToOverview.addEventListener('click', () => {
            returnToCemeteryOverview();
        });

        // Zoom & Reset controls
        btnZoomIn.addEventListener('click', () => zoomView(0.8));
        btnZoomOut.addEventListener('click', () => zoomView(1.25));
        btnResetZoom.addEventListener('click', () => resetView());

        // Batch 6: Center on Map Button Handlers
        if (btnCenterOnMapHud) {
            btnCenterOnMapHud.addEventListener('click', centerOnSelectedLot);
        }
        if (btnCenterOnMapDrawer) {
            btnCenterOnMapDrawer.addEventListener('click', centerOnSelectedLot);
        }

        // Batch 7: Wayfinding Slip Modal Listeners
        if (btnOpenWayfindingSlip) {
            btnOpenWayfindingSlip.addEventListener('click', openWayfindingSlip);
        }
        if (btnCloseWayfindingSlip) {
            btnCloseWayfindingSlip.addEventListener('click', closeWayfindingSlip);
        }
        if (btnPrintSlip) {
            btnPrintSlip.addEventListener('click', printWayfindingSlip);
        }
        if (wayfindingSlipModal) {
            wayfindingSlipModal.addEventListener('click', (e) => {
                if (e.target === wayfindingSlipModal) {
                    closeWayfindingSlip();
                }
            });
        }

        // Batch 8C: Visual Archetype Lightbox Listeners
        if (btnExpandArchetype) {
            btnExpandArchetype.addEventListener('click', (e) => {
                e.stopPropagation();
                openArchetypeLightbox();
            });
        }
        if (drawerImageFrame) {
            drawerImageFrame.addEventListener('click', openArchetypeLightbox);
        }
        if (btnCloseLightbox) {
            btnCloseLightbox.addEventListener('click', closeArchetypeLightbox);
        }
        if (archetypeLightboxModal) {
            archetypeLightboxModal.addEventListener('click', (e) => {
                if (e.target === archetypeLightboxModal) {
                    closeArchetypeLightbox();
                }
            });
        }

        // Close slip, lightbox, or return from geo view on ESC key (Batch 9C)
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (archetypeLightboxModal && archetypeLightboxModal.style.display !== 'none') {
                    closeArchetypeLightbox();
                } else if (wayfindingSlipModal && wayfindingSlipModal.style.display !== 'none') {
                    closeWayfindingSlip();
                } else if (state.activeMapView === 'geo') {
                    switchMapView('plot');
                }
            }
        });

        // Batch 9C: Arrow-key keyboard accessibility on dual-view switcher tabs
        if (btnSwitchPlotView && btnSwitchGeoView) {
            btnSwitchPlotView.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowRight') {
                    btnSwitchGeoView.focus();
                    switchMapView('geo');
                }
            });
            btnSwitchGeoView.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowLeft') {
                    btnSwitchPlotView.focus();
                    switchMapView('plot');
                }
            });
        }

        if (bcBlock) {
            bcBlock.addEventListener('click', () => {
                if (state.selectedLot) {
                    closeLotDrawer();
                }
            });
        }

        // Mouse pan on SVG
        cemeteryMapSvg.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        // Drawer Close
        btnCloseDrawer.addEventListener('click', closeLotDrawer);

        // Retry on error
        btnRetryMap.addEventListener('click', async () => {
            if (state.currentCemeteryId) {
                await loadCemeteryLayout(state.currentCemeteryId);
            } else {
                await loadCemeteries();
            }
        });

        // Search & Filter Listeners (Batch 4A)
        btnMapSearch.addEventListener('click', () => executeSearch());

        mapSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                executeSearch();
            } else if (e.key === 'Escape') {
                hideSearchResultsDropdown();
            }
        });

        mapSearchInput.addEventListener('input', () => {
            const val = mapSearchInput.value.trim();
            btnClearSearch.style.display = val !== '' ? 'flex' : 'none';
            if (val === '') {
                state.filters.search = '';
                hideSearchResultsDropdown();
                applyFilters();
            }
        });

        btnClearSearch.addEventListener('click', () => {
            mapSearchInput.value = '';
            btnClearSearch.style.display = 'none';
            state.filters.search = '';
            hideSearchResultsDropdown();
            applyFilters();
        });

        statusFilter.addEventListener('change', () => {
            state.filters.status = statusFilter.value;
            syncLegendButtons();
            applyFilters();
        });

        minPriceInput.addEventListener('input', () => handlePriceFilterChange());
        maxPriceInput.addEventListener('input', () => handlePriceFilterChange());

        btnClearFilters.addEventListener('click', () => resetAllFilters());

        // Dismiss search dropdown on click outside
        document.addEventListener('click', (e) => {
            if (!e.target.closest('.search-group')) {
                hideSearchResultsDropdown();
            }
        });

        // Logout Button Handler (Standard CMS parity)
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof api !== 'undefined' && typeof api.logout === 'function') {
                    api.logout();
                }
            });
        }

        // Interactive Map Legend Buttons (Reports module parity)
        const legendBtns = document.querySelectorAll('#mapLegendBtns .legend-btn');
        legendBtns.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetStatus = btn.getAttribute('data-status');
                if (!targetStatus || btn.classList.contains('is-indicator')) return;
                handleLegendStatusClick(targetStatus);
            });
        });

        // Batch 9A: Dual-View Switcher Listeners
        if (btnSwitchPlotView) {
            btnSwitchPlotView.addEventListener('click', () => switchMapView('plot'));
        }
        if (btnSwitchGeoView) {
            btnSwitchGeoView.addEventListener('click', () => switchMapView('geo'));
        }
        if (btnReturnPlotsGeo) {
            btnReturnPlotsGeo.addEventListener('click', () => switchMapView('plot'));
        }

        // Batch 9A: Zone Chip Selectors
        if (geoZoneChips) {
            const zoneBtns = geoZoneChips.querySelectorAll('.zone-chip-btn');
            zoneBtns.forEach(btn => {
                btn.addEventListener('click', () => {
                    const zoneKey = btn.getAttribute('data-zone');
                    handleGeoZoneSelect(zoneKey);
                });
            });
        }

        // Batch 9B: View Facility on Google Maps from Details Drawer
        if (btnDrawerViewGeoMap) {
            btnDrawerViewGeoMap.addEventListener('click', () => {
                switchMapView('geo');
            });
        }
    }

    /**
     * Show / Hide Loading Overlay
     */
    function setLoading(isLoading, message = 'Loading cemetery layout...') {
        state.isLoading = isLoading;
        if (isLoading) {
            loadingText.textContent = message;
            mapLoadingOverlay.style.display = 'flex';
            mapEmptyOverlay.style.display = 'none';
        } else {
            mapLoadingOverlay.style.display = 'none';
        }
    }

    /**
     * Show Empty / Error Overlay
     */
    function showEmptyOverlay(title, desc, isError = false) {
        setLoading(false);
        emptyTitle.textContent = title;
        emptyDesc.textContent = desc;
        emptyIcon.innerHTML = isError
            ? '<i class="fas fa-triangle-exclamation"></i>'
            : '<i class="fas fa-map-pin"></i>';
        btnRetryMap.style.display = isError ? 'inline-flex' : 'none';
        mapEmptyOverlay.style.display = 'flex';
        mapTransformLayer.innerHTML = '';
    }

    /**
     * Format Philippine Currency
     */
    function formatCurrency(amount) {
        const num = parseFloat(amount) || 0;
        return '₱' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    /**
     * Escape HTML helper
     */
    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    /**
     * Safely parse a positive numeric integer from query parameters.
     * Returns:
     *   - null if value is not provided
     *   - positive integer if valid
     *   - -1 if provided but invalid
     */
    function parsePositiveInt(val) {
        if (val === null || val === undefined || val === '') return null;
        const num = Number(val);
        if (Number.isInteger(num) && num > 0) {
            return num;
        }
        return -1;
    }

    /**
     * Safe Toast Notification Helper
     */
    function toast(message, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(message, { type });
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    /**
     * URL Parameter Initialization & Exact Lot Navigation Bridge (Batch 4B)
     * Handles:
     *  - cemetery_id only
     *  - cemetery_id + block_id
     *  - cemetery_id + block_id + lot_id
     *  - Hierarchy validation & safe error fallbacks
     */
    async function initFromUrlParams() {
        const urlParams = new URLSearchParams(window.location.search);
        const rawCemId = urlParams.get('cemetery_id');
        const rawBlkId = urlParams.get('block_id');
        const rawLotId = urlParams.get('lot_id');

        // Case 1: No URL parameters provided -> default to normal cemetery overview
        if (rawCemId === null && rawBlkId === null && rawLotId === null) {
            if (state.cemeteries.length > 0) {
                await switchCemetery(state.cemeteries[0].cemetery_id);
            }
            return;
        }

        // Case 2: Missing cemetery_id but block_id or lot_id is present
        if (rawCemId === null && (rawBlkId !== null || rawLotId !== null)) {
            toast('Cemetery ID is required to locate the block or lot.', 'warning');
            if (state.cemeteries.length > 0) {
                await switchCemetery(state.cemeteries[0].cemetery_id);
            }
            return;
        }

        // Case 3: cemetery_id provided -> validate format
        const targetCemId = parsePositiveInt(rawCemId);
        if (targetCemId === -1) {
            toast('Cemetery not found.', 'error');
            showEmptyOverlay(
                'Cemetery Not Found',
                'The requested cemetery facility identifier is invalid.',
                true
            );
            return;
        }

        // Case 4: Verify cemetery exists in active facilities
        const targetCem = state.cemeteries.find(c => c.cemetery_id === targetCemId);
        if (!targetCem) {
            toast('Cemetery not found.', 'error');
            showEmptyOverlay(
                'Cemetery Not Found',
                'The requested cemetery facility could not be found.',
                true
            );
            return;
        }

        // Switch to the validated cemetery (loads layout & resets filters)
        await switchCemetery(targetCem.cemetery_id);

        // Case 5: If block_id is not provided, stop at cemetery overview
        if (rawBlkId === null) {
            return;
        }

        // Case 6: block_id provided -> validate format
        const targetBlkId = parsePositiveInt(rawBlkId);
        if (targetBlkId === -1) {
            toast('The requested block could not be found on this cemetery.', 'error');
            return;
        }

        // Case 7: Validate block exists and belongs to the selected cemetery
        let targetBlockObj = null;
        const sections = state.currentLayout?.sections || [];
        for (const sec of sections) {
            const foundBlk = (sec.blocks || []).find(b => b.block_id === targetBlkId);
            if (foundBlk) {
                targetBlockObj = { block: foundBlk, section: sec };
                break;
            }
        }

        if (!targetBlockObj) {
            toast('The requested block could not be found on this cemetery.', 'error');
            return;
        }

        // Clear active filters before opening block
        resetAllFilters(false);

        // Direct block loading
        await drillDownToBlock(targetBlockObj.block, targetBlockObj.section);

        // Case 8: If lot_id is not provided, stop at block view
        if (rawLotId === null) {
            return;
        }

        // Case 9: lot_id provided -> validate format
        const targetLotId = parsePositiveInt(rawLotId);
        if (targetLotId === -1) {
            toast('The requested lot could not be found in this block.', 'error');
            return;
        }

        // Case 10: Validate lot belongs to this block
        const targetLot = state.currentLots.find(l => l.lot_id === targetLotId);
        if (!targetLot) {
            toast('The requested lot could not be found in this block.', 'error');
            return;
        }

        // Exact lot found: clear filters, highlight, center, and open details drawer
        resetAllFilters(false);

        const lotElement = document.querySelector(`.svg-lot-tile[data-lot-id="${targetLot.lot_id}"]`);
        selectLot(targetLot, targetBlockObj.block, targetBlockObj.section, lotElement);

        if (lotElement) {
            lotElement.classList.add('is-selected');
            lotElement.classList.add('is-matched');

            const rectEl = lotElement.querySelector('rect');
            if (rectEl) {
                const x = parseFloat(rectEl.getAttribute('x'));
                const y = parseFloat(rectEl.getAttribute('y'));
                const w = parseFloat(rectEl.getAttribute('width')) || 100;
                const h = parseFloat(rectEl.getAttribute('height')) || 70;
                if (!isNaN(x) && !isNaN(y)) {
                    centerViewOnPoint(x + (w / 2), y + (h / 2));
                }
            }
        }
    }

    /**
     * 1. Load Active Cemetery Facilities
     * Endpoint: GET /api/cemeteries
     */
    async function loadCemeteries() {
        setLoading(true, 'Loading cemetery facilities...');
        try {
            const res = await api.request('cemeteries', { method: 'GET' });
            if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
                state.cemeteries = res.data;
                populateCemeteryDropdown(res.data);

                // Initialize map from URL parameters (Batch 4B) or default to first facility
                await initFromUrlParams();
            } else {
                showEmptyOverlay(
                    'No Cemetery Facilities',
                    'No active cemetery facilities are currently available in the system.'
                );
            }
        } catch (err) {
            console.error('Failed to load cemeteries:', err);
            showEmptyOverlay(
                'Unable to Load Facilities',
                'Failed to connect to the cemetery facility service. Please try again.',
                true
            );
        } finally {
            setLoading(false);
        }
    }

    /**
     * Populate Facility Dropdown
     */
    function populateCemeteryDropdown(cemeteries) {
        cemeterySelector.innerHTML = '';
        cemeteries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.cemetery_id;
            opt.textContent = c.cemetery_name;
            cemeterySelector.appendChild(opt);
        });
    }

    /**
     * Switch Selected Cemetery
     * Enforces complete cemetery isolation (clears state, filters, cache).
     */
    async function switchCemetery(cemeteryId) {
        state.currentCemeteryId = cemeteryId;
        state.currentCemetery = state.cemeteries.find(c => c.cemetery_id === cemeteryId);
        cemeterySelector.value = cemeteryId;

        // Reset state & isolated in-memory cache
        closeLotDrawer();
        state.blockLotsCache = {}; // Strict facility isolation
        resetAllFilters(false);    // Clear search & filters without re-filtering previous data
        hideSearchResultsDropdown();

        state.currentSection = null;
        state.currentBlock = null;
        state.currentLots = [];
        state.selectedLot = null;
        state.viewLevel = 'cemetery';

        updateBreadcrumbs();
        await loadCemeteryLayout(cemeteryId);
    }

    /**
     * 2. Load Cemetery Layout
     * Endpoint: GET /api/map/layout?cemetery_id={id}
     */
    async function loadCemeteryLayout(cemeteryId) {
        setLoading(true, 'Loading cemetery layout...');
        try {
            const res = await api.request(`map/layout?cemetery_id=${cemeteryId}`, { method: 'GET' });
            if (res && res.success && res.data) {
                state.currentLayout = res.data;
                state.currentCemetery = res.data.cemetery;

                // Batch 9A: Sync Geographic Viewport if active
                if (state.activeMapView === 'geo') {
                    loadGeoFacilityMap(state.currentCemetery);
                }

                // Update summary counts
                const sections = res.data.sections || [];
                let totalBlocks = 0;
                let totalLots = 0;
                sections.forEach(s => {
                    totalBlocks += (s.blocks ? s.blocks.length : (s.total_blocks || 0));
                    totalLots += (s.total_lots || 0);
                });

                statSections.textContent = sections.length;
                statBlocks.textContent = totalBlocks;
                statLots.textContent = totalLots;
                if (statFacilityActive) {
                    statFacilityActive.textContent = state.currentCemetery?.cemetery_name || 'Active Facility';
                }
                updateLegendCounts([]);

                if (sections.length === 0) {
                    showEmptyOverlay(
                        'No Sections Configured',
                        'This cemetery facility does not have any sections configured yet.'
                    );
                    return;
                }

                mapEmptyOverlay.style.display = 'none';
                renderCemeteryOverview(res.data);
            } else {
                showEmptyOverlay(
                    'Layout Not Found',
                    res.error || 'The requested cemetery layout is unavailable.',
                    true
                );
            }
        } catch (err) {
            console.error('Failed to load layout:', err);
            showEmptyOverlay(
                'Layout Retrieval Error',
                'Unable to retrieve the cemetery map overview. Please try again.',
                true
            );
        } finally {
            setLoading(false);
        }
    }

    /**
     * Render Cemetery Overview SVG (Sections & Blocks)
     */
    function renderCemeteryOverview(layoutData) {
        state.viewLevel = 'cemetery';
        viewLevelText.textContent = 'Cemetery Overview';
        btnBackToOverview.style.display = 'none';
        updateBreadcrumbs();
        resetView();

        const sections = layoutData.sections || [];
        const canvasW = state.baseViewBox.width;
        const canvasH = state.baseViewBox.height;
        const margin = 40;
        const gap = 30;

        mapTransformLayer.innerHTML = '';

        // Deterministic Section Grid Arrangement
        const count = sections.length;
        let cols = 1;
        let rows = 1;

        if (count === 2) {
            cols = 2; rows = 1;
        } else if (count <= 4) {
            cols = 2; rows = Math.ceil(count / 2);
        } else if (count <= 6) {
            cols = 3; rows = Math.ceil(count / 3);
        } else {
            cols = Math.ceil(Math.sqrt(count));
            rows = Math.ceil(count / cols);
        }

        const sectionW = (canvasW - (margin * 2) - ((cols - 1) * gap)) / cols;
        const sectionH = (canvasH - (margin * 2) - ((rows - 1) * gap)) / rows;

        sections.forEach((section, index) => {
            const col = index % cols;
            const row = Math.floor(index / cols);
            let secX = margin + (col * (sectionW + gap));
            let secY = margin + (row * (sectionH + gap));
            let curSecW = sectionW;
            let curSecH = sectionH;

            // Use configured geometry if available, otherwise procedural fallback
            if (section.map_config && !isNaN(Number(section.map_config.x)) && !isNaN(Number(section.map_config.y)) &&
                Number(section.map_config.width) > 0 && Number(section.map_config.height) > 0) {
                secX = Number(section.map_config.x);
                secY = Number(section.map_config.y);
                curSecW = Number(section.map_config.width);
                curSecH = Number(section.map_config.height);
            }

            const secGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            secGroup.setAttribute('class', 'svg-section-card');
            secGroup.setAttribute('data-section-id', section.section_id);

            // Section Outer Card
            const secBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            secBg.setAttribute('x', secX);
            secBg.setAttribute('y', secY);
            secBg.setAttribute('width', curSecW);
            secBg.setAttribute('height', curSecH);
            secBg.setAttribute('class', 'svg-section-bg');
            secBg.setAttribute('filter', 'url(#tileShadow)');
            secGroup.appendChild(secBg);

            // Section Header Bar
            const headerH = 46;
            const secHeader = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            secHeader.setAttribute('x', secX);
            secHeader.setAttribute('y', secY);
            secHeader.setAttribute('width', curSecW);
            secHeader.setAttribute('height', headerH);
            secHeader.setAttribute('rx', '14');
            secHeader.setAttribute('class', 'svg-section-header');
            secGroup.appendChild(secHeader);

            // Section Title
            const secTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            secTitle.setAttribute('x', secX + 16);
            secTitle.setAttribute('y', secY + 28);
            secTitle.setAttribute('class', 'svg-section-title');
            secTitle.textContent = section.section_name;
            secGroup.appendChild(secTitle);

            // Section Meta (Blocks & Lots)
            const blocks = section.blocks || [];
            const secMeta = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            secMeta.setAttribute('x', secX + curSecW - 16);
            secMeta.setAttribute('y', secY + 28);
            secMeta.setAttribute('text-anchor', 'end');
            secMeta.setAttribute('class', 'svg-section-meta');
            secMeta.textContent = `${blocks.length} Blocks • ${section.total_lots || 0} Lots`;
            secGroup.appendChild(secMeta);

            // Render Nested Blocks Inside Section Body
            const bodyMargin = 16;
            const bodyX = secX + bodyMargin;
            const bodyY = secY + headerH + bodyMargin;
            const bodyW = curSecW - (bodyMargin * 2);
            const bodyH = curSecH - headerH - (bodyMargin * 2);

            const blockCount = blocks.length;
            if (blockCount > 0) {
                let bCols = 1;
                if (blockCount >= 2 && blockCount <= 4) bCols = 2;
                else if (blockCount > 4) bCols = Math.ceil(Math.sqrt(blockCount));
                const bRows = Math.ceil(blockCount / bCols);
                const bGap = 12;

                const blockW = (bodyW - ((bCols - 1) * bGap)) / bCols;
                const blockH = (bodyH - ((bRows - 1) * bGap)) / bRows;

                blocks.forEach((block, bIdx) => {
                    const bCol = bIdx % bCols;
                    const bRow = Math.floor(bIdx / bCols);
                    let blkX = bodyX + (bCol * (blockW + bGap));
                    let blkY = bodyY + (bRow * (blockH + bGap));
                    let curBlkW = blockW;
                    let curBlkH = blockH;

                    // Use configured block geometry if present, otherwise procedural fallback
                    if (block.map_config && !isNaN(Number(block.map_config.x)) && !isNaN(Number(block.map_config.y)) &&
                        Number(block.map_config.width) > 0 && Number(block.map_config.height) > 0) {
                        const rawX = Number(block.map_config.x);
                        const rawY = Number(block.map_config.y);
                        blkX = rawX < curSecW ? (secX + rawX) : rawX;
                        blkY = rawY < curSecH ? (secY + rawY) : rawY;
                        curBlkW = Number(block.map_config.width);
                        curBlkH = Number(block.map_config.height);
                    }

                    const blkGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    blkGroup.setAttribute('class', 'svg-block-card');
                    blkGroup.setAttribute('data-block-id', block.block_id);
                    blkGroup.setAttribute('role', 'button');
                    blkGroup.setAttribute('tabindex', '0');
                    blkGroup.setAttribute('aria-label', `${block.block_name}, ${block.total_lots || 0} lots. Click to view lots.`);

                    // Block Tile Rect
                    const blkRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    blkRect.setAttribute('x', blkX);
                    blkRect.setAttribute('y', blkY);
                    blkRect.setAttribute('width', curBlkW);
                    blkRect.setAttribute('height', curBlkH);
                    blkRect.setAttribute('class', 'svg-block-bg');
                    blkGroup.appendChild(blkRect);

                    // Block Name
                    const blkText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    blkText.setAttribute('x', blkX + 14);
                    blkText.setAttribute('y', blkY + (curBlkH / 2) + 5);
                    blkText.setAttribute('class', 'svg-block-title');
                    blkText.textContent = block.block_name;
                    blkGroup.appendChild(blkText);

                    // Lot Count Badge
                    const badgeTextContent = `${block.total_lots || 0} Plots`;
                    const badgeW = 70;
                    const badgeH = 24;
                    const badgeX = blkX + curBlkW - badgeW - 12;
                    const badgeY = blkY + (curBlkH / 2) - (badgeH / 2);

                    const badgeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    badgeRect.setAttribute('x', badgeX);
                    badgeRect.setAttribute('y', badgeY);
                    badgeRect.setAttribute('width', badgeW);
                    badgeRect.setAttribute('height', badgeH);
                    badgeRect.setAttribute('class', 'svg-block-badge-bg');
                    blkGroup.appendChild(badgeRect);

                    const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    badgeText.setAttribute('x', badgeX + (badgeW / 2));
                    badgeText.setAttribute('y', badgeY + 16);
                    badgeText.setAttribute('text-anchor', 'middle');
                    badgeText.setAttribute('class', 'svg-block-badge-text');
                    badgeText.textContent = badgeTextContent;
                    blkGroup.appendChild(badgeText);

                    // Block Click Handler (Progressive Drill-Down)
                    blkGroup.addEventListener('click', () => {
                        drillDownToBlock(block, section);
                    });

                    blkGroup.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            drillDownToBlock(block, section);
                        }
                    });

                    // Hover Tooltip
                    blkGroup.addEventListener('mouseenter', (e) => {
                        showFloatingTooltip(e, `<strong>${escapeHtml(block.block_name)}</strong><br>${block.total_lots || 0} Lots • Click to inspect`);
                    });
                    blkGroup.addEventListener('mousemove', moveFloatingTooltip);
                    blkGroup.addEventListener('mouseleave', hideFloatingTooltip);

                    secGroup.appendChild(blkGroup);
                });
            }

            mapTransformLayer.appendChild(secGroup);
        });
    }

    /**
     * 3. Progressive Drill-Down to Block Lots
     * Uses in-memory cache to eliminate redundant queries.
     * Endpoint: GET /api/map/blocks/{id}/lots
     */
    async function drillDownToBlock(block, section) {
        state.currentSection = section;
        state.currentBlock = block;
        state.viewLevel = 'block';

        updateBreadcrumbs();

        // 1. Check in-memory cache first
        if (state.blockLotsCache[block.block_id]) {
            state.currentLots = state.blockLotsCache[block.block_id];
            viewLevelText.textContent = `${section.section_name} › ${block.block_name}`;
            btnBackToOverview.style.display = 'inline-flex';
            renderBlockLotsView(block, state.currentLots);
            applyFilters();
            return;
        }

        // 2. Progressive fetch from API
        setLoading(true, `Loading lots for ${block.block_name}...`);

        try {
            const res = await api.request(`map/blocks/${block.block_id}/lots`, { method: 'GET' });
            if (res && res.success && res.data) {
                state.currentBlock = res.data.block;
                state.currentLots = res.data.lots || [];

                // Store in memory cache
                state.blockLotsCache[block.block_id] = state.currentLots;

                viewLevelText.textContent = `${section.section_name} › ${block.block_name}`;
                btnBackToOverview.style.display = 'inline-flex';

                renderBlockLotsView(res.data.block, state.currentLots);
                applyFilters();
            } else {
                toast(res.error || 'Failed to load block lots.', 'error');
            }
        } catch (err) {
            console.error('Error fetching block lots:', err);
            toast('Failed to load lots for selected block.', 'error');
        } finally {
            setLoading(false);
        }
    }

    /**
     * Render Block Lots View in SVG
     */
    function renderBlockLotsView(block, lots) {
        mapTransformLayer.innerHTML = '';
        resetView();

        const canvasW = state.baseViewBox.width;
        const canvasH = state.baseViewBox.height;
        const margin = 50;
        const topHeaderH = 100;

        // Block Title & Availability Breakdown Header
        const headerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');

        // Header Background Banner
        const headBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        headBg.setAttribute('x', margin);
        headBg.setAttribute('y', margin);
        headBg.setAttribute('width', canvasW - (margin * 2));
        headBg.setAttribute('height', topHeaderH - 20);
        headBg.setAttribute('rx', '12');
        headBg.setAttribute('class', 'svg-section-header');
        headerGroup.appendChild(headBg);

        const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        titleText.setAttribute('x', margin + 24);
        titleText.setAttribute('y', margin + 38);
        titleText.setAttribute('class', 'svg-section-title');
        titleText.textContent = `${block.section_name || state.currentSection.section_name} › ${block.block_name}`;
        headerGroup.appendChild(titleText);

        // Status Counts Breakdown
        const counts = { Available: 0, Reserved: 0, Occupied: 0, Unavailable: 0 };
        lots.forEach(l => {
            if (counts[l.status] !== undefined) counts[l.status]++;
            else counts.Unavailable++;
        });
        updateLegendCounts(lots);

        // Detect if this section/block is a Columbarium or Ossuary
        const isColumbarium = (function () {
            const cName = (state.currentCemetery?.cemetery_name || '').toLowerCase();
            const sName = (block.section_name || state.currentSection?.section_name || '').toLowerCase();
            const bName = (block.block_name || '').toLowerCase();
            const lType = (lots[0]?.lot_type || '').toLowerCase();
            return cName.includes('columbarium') || cName.includes('ossuary') ||
                   sName.includes('columbarium') || sName.includes('ossuary') ||
                   bName.includes('columbarium') || bName.includes('ossuary') ||
                   lType.includes('columbarium') || lType.includes('ossuary') || lType.includes('niche');
        })();

        if (isColumbarium) {
            titleText.textContent = `${block.section_name || state.currentSection.section_name} › ${block.block_name} • Columbarium Niche Wall Elevation`;
        }

        const subtitleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        subtitleText.setAttribute('x', margin + 24);
        subtitleText.setAttribute('y', margin + 60);
        subtitleText.setAttribute('class', 'svg-section-meta');
        subtitleText.setAttribute('id', 'blockLotsSummarySubtitle');
        subtitleText.textContent = isColumbarium
            ? `Total Vaults: ${lots.length}  |  🟢 Available: ${counts.Available}  |  🟡 Reserved: ${counts.Reserved}  |  🔴 Occupied: ${counts.Occupied}`
            : `Total Plots: ${lots.length}  |  🟢 Available: ${counts.Available}  |  🟡 Reserved: ${counts.Reserved}  |  🔴 Occupied: ${counts.Occupied}`;
        headerGroup.appendChild(subtitleText);

        mapTransformLayer.appendChild(headerGroup);

        if (lots.length === 0) {
            const noLotsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            noLotsText.setAttribute('x', canvasW / 2);
            noLotsText.setAttribute('y', canvasH / 2);
            noLotsText.setAttribute('text-anchor', 'middle');
            noLotsText.setAttribute('class', 'svg-section-title');
            noLotsText.textContent = 'No burial lots configured in this block.';
            mapTransformLayer.appendChild(noLotsText);
            return;
        }

        // Deterministic Grid Layout for Lots with Left Elevation Ruler for Columbarium
        const rulerW = isColumbarium ? 165 : 0;
        const gridX = margin + rulerW;
        const gridY = margin + topHeaderH;
        const gridW = canvasW - (margin * 2) - rulerW;
        const gridH = canvasH - gridY - margin;

        const lotCount = lots.length;
        let cols = 5;
        let gapX = isColumbarium ? 12 : 14;
        let gapY = isColumbarium ? 12 : 14;

        if (block.map_config && block.map_config.grid) {
            if (block.map_config.grid.columns && !isNaN(Number(block.map_config.grid.columns))) {
                cols = parseInt(block.map_config.grid.columns, 10);
            }
            if (block.map_config.grid.gap_x !== undefined && !isNaN(Number(block.map_config.grid.gap_x))) {
                gapX = parseFloat(block.map_config.grid.gap_x);
            }
            if (block.map_config.grid.gap_y !== undefined && !isNaN(Number(block.map_config.grid.gap_y))) {
                gapY = parseFloat(block.map_config.grid.gap_y);
            }
        } else if (isColumbarium) {
            // Niche wall proportions (4-6 rows to mirror real vertical columbarium elevations)
            if (lotCount <= 12) cols = 4;
            else if (lotCount <= 25) cols = 5;
            else if (lotCount <= 40) cols = 7;
            else cols = 8;
        } else {
            if (lotCount <= 10) cols = 5;
            else if (lotCount <= 20) cols = 5;
            else if (lotCount <= 40) cols = 8;
            else cols = 10;
        }

        const rows = Math.ceil(lotCount / cols);
        const tileW = (gridW - ((cols - 1) * gapX)) / cols;
        const tileH = (gridH - ((rows - 1) * gapY)) / rows;

        // BATCH 10A: Vertical Elevation Ruler for Columbarium Wall
        if (isColumbarium && rows > 0) {
            const rulerGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            rulerGroup.setAttribute('class', 'svg-tier-ruler-group');

            // Ruler Title Header
            const rulerHeader = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            rulerHeader.setAttribute('x', margin + 6);
            rulerHeader.setAttribute('y', gridY - 14);
            rulerHeader.setAttribute('class', 'svg-tier-ruler-header');
            rulerHeader.textContent = 'VERTICAL ELEVATION';
            rulerGroup.appendChild(rulerHeader);

            for (let r = 0; r < rows; r++) {
                const tierLevel = rows - r; // Row 0 is highest level
                const rowY = gridY + (r * (tileH + gapY));
                const pillH = Math.min(tileH, 52);
                const pillY = rowY + (tileH - pillH) / 2;

                const isEyeLevel = (rows >= 4 && tierLevel === 3) || (rows === 3 && tierLevel === 2) || (rows < 3 && tierLevel === 1);
                const isTopTier = (tierLevel === rows);
                const isBaseTier = (tierLevel === 1);
                const approxH = (0.4 + (tierLevel - 1) * 0.45).toFixed(1) + 'm';

                const tierCard = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                tierCard.setAttribute('class', `svg-tier-card ${isEyeLevel ? 'is-eye-level' : ''}`);

                // Background pill
                const pillRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                pillRect.setAttribute('x', margin);
                pillRect.setAttribute('y', pillY);
                pillRect.setAttribute('width', rulerW - 22);
                pillRect.setAttribute('height', pillH);
                pillRect.setAttribute('rx', '8');
                pillRect.setAttribute('class', `svg-tier-pill ${isEyeLevel ? 'tier-pill--eye-level' : ''}`);
                tierCard.appendChild(pillRect);

                // Tier Title text
                const tierTitleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                tierTitleText.setAttribute('x', margin + 12);
                tierTitleText.setAttribute('y', pillY + (pillH / 2) - 3);
                tierTitleText.setAttribute('class', `svg-tier-name ${isEyeLevel ? 'tier-name--eye-level' : ''}`);
                tierTitleText.textContent = isEyeLevel ? `⭐ Level ${tierLevel}` : `Level ${tierLevel}`;
                tierCard.appendChild(tierTitleText);

                // Subtitle: Height & description
                const tierSubText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                tierSubText.setAttribute('x', margin + 12);
                tierSubText.setAttribute('y', pillY + (pillH / 2) + 13);
                tierSubText.setAttribute('class', 'svg-tier-subtext');
                const tierDesc = isEyeLevel ? `${approxH} • Eye-Level` : (isTopTier ? `${approxH} • Top Vault` : (isBaseTier ? `${approxH} • Base Vault` : `${approxH} • Mid Tier`));
                tierSubText.textContent = tierDesc;
                tierCard.appendChild(tierSubText);

                // Connecting guideline to niche grid
                const guideLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
                guideLine.setAttribute('x1', margin + rulerW - 18);
                guideLine.setAttribute('y1', rowY + (tileH / 2));
                guideLine.setAttribute('x2', gridX - 6);
                guideLine.setAttribute('y2', rowY + (tileH / 2));
                guideLine.setAttribute('class', `svg-tier-guideline ${isEyeLevel ? 'guideline--eye-level' : ''}`);
                tierCard.appendChild(guideLine);

                rulerGroup.appendChild(tierCard);
            }
            mapTransformLayer.appendChild(rulerGroup);
        }

        lots.forEach((lot, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            let lotX = gridX + (col * (tileW + gapX));
            let lotY = gridY + (row * (tileH + gapY));
            let curTileW = tileW;
            let curTileH = tileH;

            // Optional custom lot position override
            if (lot.map_config && !isNaN(Number(lot.map_config.x)) && !isNaN(Number(lot.map_config.y)) &&
                Number(lot.map_config.width) > 0 && Number(lot.map_config.height) > 0) {
                const rawLx = Number(lot.map_config.x);
                const rawLy = Number(lot.map_config.y);
                lotX = rawLx < gridW ? (gridX + rawLx) : rawLx;
                lotY = rawLy < gridH ? (gridY + rawLy) : rawLy;
                curTileW = Number(lot.map_config.width);
                curTileH = Number(lot.map_config.height);
            }

            const tierLevel = isColumbarium ? (rows - row) : 1;
            const isEyeLevel = isColumbarium && ((rows >= 4 && tierLevel === 3) || (rows === 3 && tierLevel === 2) || (rows < 3 && tierLevel === 1));
            const approxH = isColumbarium ? ((0.4 + (tierLevel - 1) * 0.45).toFixed(1) + 'm') : 'Ground Level';

            // Clean Human-Readable Display Label (Sanitize long system GUID hashes)
            let displayLabel = lot.lot_number;
            let isSanitizedHash = false;
            if (lot.lot_number && lot.lot_number.length > 12) {
                isSanitizedHash = true;
                displayLabel = isColumbarium ? `Vault #${i + 1}` : `Plot #${i + 1}`;
            }

            // Bind spatial elevation metadata on lot object
            lot._tierLevel = tierLevel;
            lot._isEyeLevel = isEyeLevel;
            lot._approxHeight = approxH;
            lot._displayLabel = displayLabel;
            lot._elevationDesc = isColumbarium
                ? `Level ${tierLevel} (${approxH}) — ${isEyeLevel ? 'Eye-Level (Optimal viewing height)' : (tierLevel === rows ? 'Top Tier Vault' : (tierLevel === 1 ? 'Base Tier (Wheelchair Accessible)' : 'Mid-Tier Vault'))}`
                : 'Elevated Lawn Terrace (Certified Flood-Free, +1.2m)';

            const lotStatusClass = (lot.status || 'Available').toLowerCase().replace(/\s+/g, '-');
            const isSelected = state.selectedLot && state.selectedLot.lot_id === lot.lot_id;

            const lotGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            lotGroup.setAttribute('class', `svg-lot-tile lot--${lotStatusClass}${isColumbarium ? ' is-niche-vault' : ''}${isSelected ? ' is-selected' : ''}`);
            lotGroup.setAttribute('data-lot-id', lot.lot_id);
            lotGroup.setAttribute('data-tier-level', tierLevel);
            lotGroup.setAttribute('role', 'button');
            lotGroup.setAttribute('tabindex', '0');
            lotGroup.setAttribute('aria-label', `${displayLabel}, Section ${block.section_name || state.currentSection?.section_name || ''}, Block ${block.block_name}, Level: ${tierLevel}, Status: ${lot.status}, Category: ${lot.lot_type || 'Standard Lawn'}, Price: ${formatCurrency(lot.price)}`);

            // Lot Tile Rectangle (Outer Frame)
            const lotRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            lotRect.setAttribute('x', lotX);
            lotRect.setAttribute('y', lotY);
            lotRect.setAttribute('width', curTileW);
            lotRect.setAttribute('height', curTileH);
            lotRect.setAttribute('class', `svg-lot-rect ${isColumbarium ? 'niche-vault-rect' : ''}`);
            lotRect.setAttribute('filter', 'url(#tileShadow)');
            lotGroup.appendChild(lotRect);

            // BATCH 10A: Columbarium Niche Inner Plate & Corner Screws
            if (isColumbarium) {
                const innerPlate = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                innerPlate.setAttribute('x', lotX + 4);
                innerPlate.setAttribute('y', lotY + 4);
                innerPlate.setAttribute('width', Math.max(0, curTileW - 8));
                innerPlate.setAttribute('height', Math.max(0, curTileH - 8));
                innerPlate.setAttribute('rx', '4');
                innerPlate.setAttribute('class', 'niche-inner-plate');
                lotGroup.appendChild(innerPlate);

                // 4 Brass Corner Rosettes / Screws
                const screwInset = 7;
                const screwCoords = [
                    [lotX + screwInset, lotY + screwInset],
                    [lotX + curTileW - screwInset, lotY + screwInset],
                    [lotX + screwInset, lotY + curTileH - screwInset],
                    [lotX + curTileW - screwInset, lotY + curTileH - screwInset]
                ];
                screwCoords.forEach(([sx, sy]) => {
                    const screw = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                    screw.setAttribute('cx', sx);
                    screw.setAttribute('cy', sy);
                    screw.setAttribute('r', '2.5');
                    screw.setAttribute('class', 'niche-screw');
                    lotGroup.appendChild(screw);
                });
            }

            // Lot Number Label
            const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            labelText.setAttribute('x', lotX + (curTileW / 2));
            labelText.setAttribute('y', lotY + (curTileH / 2) - 2);
            labelText.setAttribute('text-anchor', 'middle');
            labelText.setAttribute('class', 'svg-lot-label');
            labelText.textContent = displayLabel;
            lotGroup.appendChild(labelText);

            // Lot Status / Level Subtitle
            const statusText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            statusText.setAttribute('x', lotX + (curTileW / 2));
            statusText.setAttribute('y', lotY + (curTileH / 2) + 16);
            statusText.setAttribute('text-anchor', 'middle');
            statusText.setAttribute('class', 'svg-lot-status-text');
            statusText.textContent = isColumbarium ? `L${tierLevel} • ${lot.status}` : lot.status;
            lotGroup.appendChild(statusText);

            // Native Title for Tooltip Accessibility
            const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            titleEl.textContent = `${displayLabel} • Level ${tierLevel} (${approxH}) • ${lot.status} • ${formatCurrency(lot.price)}`;
            lotGroup.appendChild(titleEl);

            // Click Handler: Lot Selection & Details Drawer
            lotGroup.addEventListener('click', (e) => {
                e.stopPropagation();
                selectLot(lot, block, state.currentSection, lotGroup);
            });

            lotGroup.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    selectLot(lot, block, state.currentSection, lotGroup);
                }
            });

            // Hover Tooltip
            lotGroup.addEventListener('mouseenter', (e) => {
                const elevHtml = isColumbarium 
                    ? `<br>Vertical Placement: <strong>Level ${tierLevel} (${approxH})</strong>${isEyeLevel ? ' <span style="color:#f59e0b;">⭐ Eye-Level</span>' : ''}`
                    : `<br>Vertical Placement: <strong>Ground Level (Terraced Lawn)</strong>`;
                const idExtra = isSanitizedHash ? `<br><small style="opacity:0.75;">System Ref: ${escapeHtml(lot.lot_number)}</small>` : '';
                showFloatingTooltip(e, `<strong>${escapeHtml(displayLabel)}</strong>${elevHtml}<br>Status: ${escapeHtml(lot.status)}<br>Category: ${escapeHtml(lot.lot_type || 'Burial Plot')}<br>Price: ${formatCurrency(lot.price)}${idExtra}`);
            });
            lotGroup.addEventListener('mousemove', moveFloatingTooltip);
            lotGroup.addEventListener('mouseleave', hideFloatingTooltip);

            mapTransformLayer.appendChild(lotGroup);
        });
    }

    /**
     * 4. Select Lot & Open Details Drawer (Batch 6 Enhanced)
     */
    function selectLot(lot, block, section, lotElement) {
        state.selectedLot = lot;

        // Visual selection highlight in SVG
        document.querySelectorAll('.svg-lot-tile.is-selected').forEach(el => {
            el.classList.remove('is-selected');
        });

        if (!lotElement && lot && lot.lot_id) {
            lotElement = document.querySelector(`.svg-lot-tile[data-lot-id="${lot.lot_id}"]`);
        }
        if (lotElement) {
            lotElement.classList.add('is-selected');
        }

        // Populate Drawer
        drawerLotNumber.textContent = lot.lot_number;
        drawerStatusText.textContent = lot.status;

        // Status indicator dot styling
        const statusColors = {
            'Available': 'var(--lot-available)',
            'Reserved': 'var(--lot-reserved)',
            'Occupied': 'var(--lot-occupied)',
            'Unavailable': 'var(--lot-unavailable)',
            'Under Maintenance': 'var(--lot-unavailable)',
        };
        drawerStatusDot.style.background = statusColors[lot.status] || 'var(--lot-unavailable)';

        drawerFacilityName.textContent = state.currentCemetery?.cemetery_name || '—';
        drawerSectionName.textContent = section?.section_name || '—';
        drawerBlockName.textContent = block?.block_name || '—';
        drawerLotType.textContent = lot.lot_type || 'Standard Lawn';
        drawerDimensions.textContent = lot.dimensions || '1.0m × 2.4m';
        drawerPrice.textContent = formatCurrency(lot.price);

        // Batch 10A: Populate Vertical Elevation / Tier Level Placement
        if (drawerElevationPlacement) {
            drawerElevationPlacement.innerHTML = lot._elevationDesc 
                ? escapeHtml(lot._elevationDesc) 
                : 'Ground Level (Terraced Lawn)';
        }
        if (drawerElevationRow) {
            drawerElevationRow.style.display = 'flex';
        }

        if (lot.location_notes) {
            drawerLocationNotes.textContent = lot.location_notes;
            drawerNotesRow.style.display = 'flex';
        } else {
            drawerNotesRow.style.display = 'none';
        }

        // Configure Booking Deep-Link
        if (lot.status === 'Available') {
            btnBookThisLot.style.display = 'inline-flex';
            btnLotUnavailable.style.display = 'none';

            // Connect to authoritative booking-assistant.html deep link
            btnBookThisLot.href = `booking-assistant.html?service=burial&lot_id=${lot.lot_id}&lot_number=${encodeURIComponent(lot.lot_number)}`;
        } else {
            btnBookThisLot.style.display = 'none';
            btnLotUnavailable.style.display = 'inline-flex';
            btnLotUnavailable.innerHTML = `<i class="fas fa-lock"></i> Lot is ${escapeHtml(lot.status)}`;
        }

        // Batch 6: Populate On-Map Location Summary HUD
        if (mapLocationSummaryCard) {
            if (locSummarySection) locSummarySection.textContent = section?.section_name || '—';
            if (locSummaryBlock) locSummaryBlock.textContent = block?.block_name || '—';
            if (locSummaryLot) locSummaryLot.textContent = `Lot ${lot.lot_number}`;
            mapLocationSummaryCard.style.display = 'block';
        }

        // Batch 6: Populate Location Hierarchy Breadcrumb Trail
        if (drawerTrailFacility) drawerTrailFacility.textContent = state.currentCemetery?.cemetery_name || '—';
        if (drawerTrailSection) drawerTrailSection.textContent = section?.section_name || '—';
        if (drawerTrailBlock) drawerTrailBlock.textContent = block?.block_name || '—';
        if (drawerTrailLot) drawerTrailLot.textContent = `Lot ${lot.lot_number}`;
        if (drawerYouAreHereBadge) drawerYouAreHereBadge.style.display = 'inline-flex';

        // Batch 8A: Populate Visual Archetype Showcase & Specifications
        renderLotArchetypeShowcase(lot);

        // Batch 9B: Populate Facility Access & Navigation Card in Details Drawer
        if (drawerFacilityAccessCard) {
            const cemetery = state.currentCemetery;
            const geo = (cemetery && cemetery.map_config && cemetery.map_config.geo) ? cemetery.map_config.geo : null;
            const gateName = (geo && geo.gate_name) || 'Gate 1: Main Visitor Access';
            const accessAddress = cemetery?.address || (geo && geo.address) || 'Official Cemetery Grounds';

            if (drawerAccessGateBadge) drawerAccessGateBadge.innerHTML = `<i class="fas fa-door-open"></i> ${escapeHtml(gateName)}`;
            if (drawerAccessGateText) drawerAccessGateText.textContent = `${gateName} & Parking`;
            if (drawerAccessAddressText) drawerAccessAddressText.textContent = accessAddress;

            if (btnDrawerDirections) {
                const cemName = cemetery?.cemetery_name || 'Cemetery Facility';
                const lat = geo ? geo.latitude : null;
                const lng = geo ? geo.longitude : null;
                if (lat && lng) {
                    btnDrawerDirections.href = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
                } else {
                    const query = `${cemName} ${accessAddress}`.trim();
                    btnDrawerDirections.href = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
                }
            }
        }

        updateBreadcrumbs();

        // Open Drawer
        lotDetailsDrawer.classList.add('is-open');
        lotDetailsDrawer.setAttribute('aria-hidden', 'false');
    }

    /**
     * Center SVG viewport on the currently selected lot (Batch 6)
     */
    function centerOnSelectedLot() {
        if (!state.selectedLot) return;
        const lotId = state.selectedLot.lot_id;
        let lotElement = document.querySelector(`.svg-lot-tile[data-lot-id="${lotId}"]`);
        if (!lotElement) return;

        // Ensure selection visual highlight is active
        document.querySelectorAll('.svg-lot-tile.is-selected').forEach(el => el.classList.remove('is-selected'));
        lotElement.classList.add('is-selected');

        const rectEl = lotElement.querySelector('rect');
        if (rectEl) {
            const x = parseFloat(rectEl.getAttribute('x'));
            const y = parseFloat(rectEl.getAttribute('y'));
            const w = parseFloat(rectEl.getAttribute('width')) || 100;
            const h = parseFloat(rectEl.getAttribute('height')) || 70;
            if (!isNaN(x) && !isNaN(y)) {
                centerViewOnPoint(x + (w / 2), y + (h / 2), 0.55);
            }
        }
    }

    /**
     * Close Lot Details Drawer
     */
    function closeLotDrawer() {
        state.selectedLot = null;
        lotDetailsDrawer.classList.remove('is-open');
        lotDetailsDrawer.setAttribute('aria-hidden', 'true');
        if (mapLocationSummaryCard) {
            mapLocationSummaryCard.style.display = 'none';
        }
        if (drawerYouAreHereBadge) {
            drawerYouAreHereBadge.style.display = 'none';
        }
        updateBreadcrumbs();
        document.querySelectorAll('.svg-lot-tile.is-selected').forEach(el => {
            el.classList.remove('is-selected');
        });
    }

    /**
     * =========================================================================
     * BATCH 8A: PHILIPPINE MEMORIAL PARK LOT ARCHETYPES & VISUAL SHOWCASE
     * =========================================================================
     */
    const LOT_ARCHETYPES = {
        lawn: {
            id: 'lawn',
            name: 'Standard Lawn Lot',
            badge: 'Lawn Lot Archetype',
            capacity: '2 Caskets (Double-Depth) + 4 Urns',
            dimensions: '1.0m × 2.44m (Single Plot)',
            priceTier: '₱45,000 – ₱180,000',
            monumentRule: 'Flush ground marker only (Bronze or granite slab, level with turf)',
            perpetualCare: 'Covered (Lawn mowing, ground leveling & perimeter security)',
            intermentPrivilege: 'Double-depth vault (2 Caskets) + 4 cremains urns',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <defs>
        <linearGradient id="lawnSky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#bae6fd"/>
            <stop offset="65%" stop-color="#e0f2fe"/>
            <stop offset="100%" stop-color="#f0fdf4"/>
        </linearGradient>
        <linearGradient id="lawnGrass" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#22c55e"/>
            <stop offset="40%" stop-color="#16a34a"/>
            <stop offset="100%" stop-color="#15803d"/>
        </linearGradient>
        <linearGradient id="lawnEarth" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#78350f"/>
            <stop offset="100%" stop-color="#451a03"/>
        </linearGradient>
        <linearGradient id="graniteMarker" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#334155"/>
            <stop offset="50%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
        <linearGradient id="bronzePlate" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="50%" stop-color="#ca8a04"/>
            <stop offset="100%" stop-color="#854d0e"/>
        </linearGradient>
    </defs>
    <rect x="0" y="0" width="340" height="90" fill="url(#lawnSky)"/>
    <path d="M-10,90 Q30,70 70,90 Q120,68 170,90 Q230,72 290,90 Q320,78 350,90 L350,90 L-10,90 Z" fill="#86efac" opacity="0.6"/>
    <rect x="0" y="86" width="340" height="18" fill="url(#lawnGrass)"/>
    <rect x="0" y="104" width="340" height="56" fill="url(#lawnEarth)"/>
    <line x1="0" y1="128" x2="340" y2="128" stroke="#92400e" stroke-width="1" stroke-dasharray="6 4" opacity="0.4"/>
    <rect x="85" y="108" width="170" height="22" rx="3" fill="#cbd5e1" stroke="#475569" stroke-width="1.5"/>
    <text x="170" y="123" fill="#1e293b" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">UPPER VAULT (Depth 1.2m)</text>
    <rect x="85" y="133" width="170" height="22" rx="3" fill="#94a3b8" stroke="#475569" stroke-width="1.5"/>
    <text x="170" y="148" fill="#0f172a" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">LOWER VAULT (Depth 2.0m)</text>
    <rect x="105" y="82" width="130" height="9" rx="2" fill="url(#graniteMarker)" stroke="#0f172a" stroke-width="1"/>
    <rect x="115" y="84" width="110" height="5" rx="1" fill="url(#bronzePlate)"/>
    <circle cx="85" cy="82" r="5" fill="#f43f5e"/>
    <circle cx="80" cy="84" r="4" fill="#fbbf24"/>
    <circle cx="89" cy="85" r="4" fill="#fb7185"/>
    <path d="M85,86 L85,90" stroke="#15803d" stroke-width="2"/>
    <circle cx="310" cy="22" r="14" fill="#fef08a" opacity="0.9"/>
    <rect x="10" y="10" width="105" height="22" rx="5" fill="rgba(15, 23, 42, 0.75)"/>
    <text x="62" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">FLUSH HEADSTONE</text>
</svg>`
        },
        garden: {
            id: 'garden',
            name: 'Garden Memorial Lot',
            badge: 'Garden Lot Archetype',
            capacity: '4–8 Caskets + 8–16 Urns (Cluster)',
            dimensions: '2.0m × 2.5m (2–4 Lots Cluster)',
            priceTier: '₱200,000 – ₱650,000',
            monumentRule: 'Raised marble/granite curb (up to 24") with landscape flower bed',
            perpetualCare: 'Covered (Hedge pruning, curb washing & perpetual security)',
            intermentPrivilege: 'Family cluster (4–8 Caskets) + 8–16 cremains urns',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <defs>
        <linearGradient id="gardSky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#bae6fd"/>
            <stop offset="70%" stop-color="#f0fdf4"/>
        </linearGradient>
        <linearGradient id="gardHedge" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#15803d"/>
            <stop offset="100%" stop-color="#166534"/>
        </linearGradient>
        <linearGradient id="marbleCurb" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="50%" stop-color="#e2e8f0"/>
            <stop offset="100%" stop-color="#94a3b8"/>
        </linearGradient>
        <linearGradient id="granitePillar" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#475569"/>
            <stop offset="40%" stop-color="#334155"/>
            <stop offset="100%" stop-color="#1e293b"/>
        </linearGradient>
    </defs>
    <rect x="0" y="0" width="340" height="110" fill="url(#gardSky)"/>
    <rect x="0" y="110" width="340" height="50" fill="#15803d"/>
    <circle cx="45" cy="98" r="24" fill="url(#gardHedge)"/>
    <circle cx="70" cy="102" r="18" fill="#16a34a"/>
    <circle cx="295" cy="98" r="24" fill="url(#gardHedge)"/>
    <circle cx="270" cy="102" r="18" fill="#16a34a"/>
    <polygon points="75,135 265,135 285,152 55,152" fill="url(#marbleCurb)" stroke="#64748b" stroke-width="1"/>
    <rect x="75" y="125" width="190" height="10" fill="#f8fafc" stroke="#94a3b8" stroke-width="1"/>
    <rect x="85" y="127" width="170" height="6" fill="#f43f5e" opacity="0.85"/>
    <path d="M135,42 L205,42 L210,125 L130,125 Z" fill="url(#granitePillar)" stroke="#0f172a" stroke-width="1.5"/>
    <path d="M170,55 L170,82 M160,63 L180,63" stroke="#fef08a" stroke-width="2.5" stroke-linecap="round"/>
    <rect x="142" y="90" width="56" height="22" rx="2" fill="#ca8a04" opacity="0.9"/>
    <text x="170" y="103" fill="#ffffff" font-size="7" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">IN MEMORIAM</text>
    <path d="M30,30 Q36,26 42,30 Q48,26 54,30" stroke="#0369a1" stroke-width="1.5" fill="none"/>
    <rect x="10" y="10" width="125" height="22" rx="5" fill="rgba(15, 23, 42, 0.75)"/>
    <text x="72" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">RAISED MARBLE CURB</text>
</svg>`
        },
        mausoleum: {
            id: 'mausoleum',
            name: 'Family Estate / Mausoleum',
            badge: 'Family Estate Archetype',
            capacity: '12–24+ Vaults & Urns (Multi-Gen)',
            dimensions: '4.0m × 5.0m+ (8–16+ Lots)',
            priceTier: '₱1,000,000 – ₱10,000,000+',
            monumentRule: 'Neoclassical covered pavilion / chapel (Up to 4–5m, private gate)',
            perpetualCare: 'Covered (Avenue access, grounds upkeep & 24/7 security)',
            intermentPrivilege: 'Generational estate (12–24+ Vaults & Urns in private crypt)',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <defs>
        <linearGradient id="mauSky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0284c7"/>
            <stop offset="60%" stop-color="#bae6fd"/>
            <stop offset="100%" stop-color="#f8fafc"/>
        </linearGradient>
        <linearGradient id="mauRoof" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#e2e8f0"/>
            <stop offset="50%" stop-color="#cbd5e1"/>
            <stop offset="100%" stop-color="#94a3b8"/>
        </linearGradient>
        <linearGradient id="mauCol" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#f8fafc"/>
            <stop offset="50%" stop-color="#e2e8f0"/>
            <stop offset="100%" stop-color="#cbd5e1"/>
        </linearGradient>
    </defs>
    <rect x="0" y="0" width="340" height="120" fill="url(#mauSky)"/>
    <rect x="0" y="120" width="340" height="40" fill="#15803d"/>
    <polygon points="50,132 290,132 320,158 20,158" fill="#e2e8f0" stroke="#94a3b8" stroke-width="1"/>
    <rect x="75" y="124" width="190" height="8" rx="1" fill="#cbd5e1" stroke="#64748b" stroke-width="1"/>
    <rect x="85" y="118" width="170" height="6" rx="1" fill="#e2e8f0" stroke="#64748b" stroke-width="1"/>
    <rect x="95" y="55" width="150" height="63" fill="#1e293b"/>
    <rect x="145" y="65" width="50" height="53" rx="2" fill="#0f172a" stroke="#ca8a04" stroke-width="1.5"/>
    <line x1="157" y1="65" x2="157" y2="118" stroke="#ca8a04" stroke-width="1"/>
    <line x1="170" y1="65" x2="170" y2="118" stroke="#ca8a04" stroke-width="1"/>
    <line x1="183" y1="65" x2="183" y2="118" stroke="#ca8a04" stroke-width="1"/>
    <rect x="92" y="55" width="16" height="63" rx="1" fill="url(#mauCol)" stroke="#64748b" stroke-width="1"/>
    <rect x="124" y="55" width="16" height="63" rx="1" fill="url(#mauCol)" stroke="#64748b" stroke-width="1"/>
    <rect x="200" y="55" width="16" height="63" rx="1" fill="url(#mauCol)" stroke="#64748b" stroke-width="1"/>
    <rect x="232" y="55" width="16" height="63" rx="1" fill="url(#mauCol)" stroke="#64748b" stroke-width="1"/>
    <rect x="80" y="47" width="180" height="8" fill="url(#mauRoof)" stroke="#64748b" stroke-width="1"/>
    <polygon points="170,20 270,47 70,47" fill="url(#mauRoof)" stroke="#64748b" stroke-width="1.5"/>
    <text x="170" y="42" fill="#334155" font-size="8" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">FAMILY ESTATE</text>
    <path d="M35,130 C35,65 48,45 48,45 C48,45 61,65 61,130 Z" fill="#14532d"/>
    <path d="M279,130 C279,65 292,45 292,45 C292,45 305,65 305,130 Z" fill="#14532d"/>
    <rect x="10" y="10" width="130" height="22" rx="5" fill="rgba(15, 23, 42, 0.75)"/>
    <text x="75" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">PRIVATE PAVILION</text>
</svg>`
        },
        columbarium: {
            id: 'columbarium',
            name: 'Columbarium Wall Niche',
            badge: 'Columbarium Archetype',
            capacity: '2–4 Cremains Urns per Niche',
            dimensions: '0.4m × 0.4m × 0.6m (Single Niche)',
            priceTier: '₱25,000 – ₱150,000',
            monumentRule: 'Polished engraved brass plate with tempered glass/marble face',
            perpetualCare: 'Covered (Sanctuary hall upkeep, lighting & commemorative care)',
            intermentPrivilege: 'Niche compartment (2–4 Cremains urns or ossuary transfers)',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <defs>
        <linearGradient id="colBg" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
        <linearGradient id="nicheGold" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="50%" stop-color="#eab308"/>
            <stop offset="100%" stop-color="#a16207"/>
        </linearGradient>
    </defs>
    <rect x="0" y="0" width="340" height="160" fill="url(#colBg)"/>
    <polygon points="170,0 210,160 130,160" fill="#38bdf8" opacity="0.08"/>
    <rect x="30" y="18" width="280" height="124" rx="4" fill="#334155" stroke="#475569" stroke-width="2"/>
    <rect x="42" y="28" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="106" y="28" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="178" y="28" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="242" y="28" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="42" y="66" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="106" y="66" width="56" height="32" rx="3" fill="#047857" stroke="#34d399" stroke-width="2"/>
    <rect x="114" y="74" width="40" height="16" rx="2" fill="url(#nicheGold)"/>
    <text x="134" y="85" fill="#0f172a" font-size="7" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">NICHE #204</text>
    <rect x="178" y="66" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="242" y="66" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="42" y="104" width="56" height="30" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="106" y="104" width="56" height="30" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="178" y="104" width="56" height="30" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="242" y="104" width="56" height="30" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <circle cx="156" cy="94" r="3" fill="#f59e0b"/>
    <circle cx="156" cy="93" r="1.5" fill="#fef08a"/>
    <rect x="10" y="10" width="135" height="22" rx="5" fill="rgba(15, 23, 42, 0.75)"/>
    <text x="77" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">INDOOR NICHE VAULT</text>
</svg>`
        }
    };

    /**
     * Detect matching Philippine Memorial Park lot archetype
     */
    function getLotArchetype(lot) {
        if (!lot) return LOT_ARCHETYPES.lawn;
        const typeStr = String(lot.lot_type || '').toLowerCase();
        const numStr = String(lot.lot_number || '').toLowerCase();
        const notesStr = String(lot.location_notes || '').toLowerCase();
        const combined = `${typeStr} ${numStr} ${notesStr}`;

        if (combined.includes('columb') || combined.includes('niche') || combined.includes('ossuary') || combined.includes('cremat')) {
            return LOT_ARCHETYPES.columbarium;
        }
        if (combined.includes('mausoleum') || combined.includes('estate') || combined.includes('family') || combined.includes('pavilion')) {
            return LOT_ARCHETYPES.mausoleum;
        }
        if (combined.includes('garden') || combined.includes('monument') || combined.includes('curb') || combined.includes('terrace')) {
            return LOT_ARCHETYPES.garden;
        }
        return LOT_ARCHETYPES.lawn;
    }

    /**
     * Determine location value tier for a lot based on positioning & attributes (Batch 8B)
     */
    function getLotLocationTier(lot) {
        if (!lot) {
            return {
                tier: 'Standard Interior',
                badgeClass: 'is-standard',
                icon: 'fa-tree',
                desc: 'Serene placement along manicured interior walkways with perpetual maintenance.'
            };
        }
        const notesStr = String(lot.location_notes || '').toLowerCase();
        const numStr = String(lot.lot_number || '').toLowerCase();
        const typeStr = String(lot.lot_type || '').toLowerCase();

        const isRoadside = notesStr.includes('road') || notesStr.includes('avenue') || notesStr.includes('front') || notesStr.includes('gate') || notesStr.includes('prime');
        const isCorner = notesStr.includes('corner') || numStr.endsWith('-01') || numStr.endsWith('-1') || numStr.endsWith('-10');
        const isPrestige = typeStr.includes('mausoleum') || typeStr.includes('estate') || typeStr.includes('garden');

        if (isRoadside) {
            return {
                tier: 'Prime Roadside Lot',
                badgeClass: 'is-prime',
                icon: 'fa-road',
                desc: 'Direct avenue access with enhanced accessibility, faster wayfinding, and prominent visibility.'
            };
        }
        if (isCorner) {
            return {
                tier: 'Prime Corner Lot',
                badgeClass: 'is-prime',
                icon: 'fa-compass',
                desc: 'Advantageous corner position with two-sided open space and high footway visibility.'
            };
        }
        if (isPrestige) {
            return {
                tier: 'Estate Prestige Tier',
                badgeClass: 'is-prime',
                icon: 'fa-crown',
                desc: 'Exclusive clustered grounds with dedicated landscaping and private perimeter allowances.'
            };
        }
        return {
            tier: 'Standard Interior Lot',
            badgeClass: 'is-standard',
            icon: 'fa-location-dot',
            desc: 'Serene placement along manicured interior walkways with standard perpetual maintenance.'
        };
    }

    /**
     * Render Visual Archetype Showcase in Details Drawer (Batch 8A & 8B Enhanced)
     */
    function renderLotArchetypeShowcase(lot) {
        if (!drawerVisualShowcase) return;
        const archetype = getLotArchetype(lot);

        if (drawerArchetypeGraphic) {
            drawerArchetypeGraphic.innerHTML = archetype.svg;
        }
        if (drawerArchetypeBadgeText) {
            drawerArchetypeBadgeText.textContent = archetype.badge;
        }
        if (drawerCapacityText) {
            drawerCapacityText.textContent = archetype.capacity;
        }
        if (drawerDimensionSpec) {
            drawerDimensionSpec.textContent = lot.dimensions || archetype.dimensions;
        }

        // Batch 8B: Populate Location Value Tier
        const tierInfo = getLotLocationTier(lot);
        if (drawerLocationTierBadge) {
            drawerLocationTierBadge.innerHTML = `<i class="fas ${tierInfo.icon}"></i> ${escapeHtml(tierInfo.tier)}`;
            drawerLocationTierBadge.className = `badge-location-tier ${tierInfo.badgeClass}`;
        }
        if (drawerLocationTierDesc) {
            drawerLocationTierDesc.textContent = tierInfo.desc;
        }

        // Batch 8B: Populate Monument & Memorial Guidelines
        if (drawerMonumentRule) {
            drawerMonumentRule.textContent = archetype.monumentRule || 'Standard cemetery regulation applies';
        }
        if (drawerPerpetualCare) {
            drawerPerpetualCare.textContent = archetype.perpetualCare || 'Covered (Perpetual park grounds care)';
        }
        if (drawerIntermentPrivilege) {
            drawerIntermentPrivilege.textContent = archetype.intermentPrivilege || 'Standard interment allocation';
        }
    }

    /**
     * Open Wayfinding & Lot Location Slip Modal (Batch 7)
     */
    function openWayfindingSlip() {
        if (!state.selectedLot) {
            if (typeof showToast === 'function') {
                showToast('Please select a cemetery plot first.', 'warning');
            }
            return;
        }

        const lot = state.selectedLot;
        const block = state.currentBlock;
        const section = state.currentSection;
        const cemetery = state.currentCemetery;

        // Facility & Header Information
        if (slipFacilityName) slipFacilityName.textContent = cemetery?.cemetery_name || 'Cemetery Facility';
        if (slipFacilityAddress) slipFacilityAddress.textContent = cemetery?.address || cemetery?.location || 'Official Cemetery Grounds & Burial Registry';
        if (slipRefCode) {
            const paddedLotId = String(lot.lot_id).padStart(4, '0');
            slipRefCode.textContent = `CEM-LOT-${paddedLotId}`;
        }
        if (slipTimestamp) {
            const now = new Date();
            slipTimestamp.textContent = now.toLocaleDateString('en-US', {
                year: 'numeric',
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit'
            });
        }

        // Key Lot Callout
        if (slipLotNumber) slipLotNumber.textContent = `LOT ${lot.lot_number}`;
        if (slipLotType) slipLotType.textContent = lot.lot_type || 'Standard Lawn';
        if (slipStatusText) slipStatusText.textContent = lot.status || 'Available';
        if (slipDimensions) slipDimensions.textContent = lot.dimensions || '1.0m × 2.4m';

        // Status dot color
        const statusColors = {
            'Available': '#10b981',
            'Reserved': '#f59e0b',
            'Occupied': '#64748b',
            'Unavailable': '#ef4444',
            'Under Maintenance': '#ef4444',
        };
        if (slipStatusDot) {
            slipStatusDot.style.background = statusColors[lot.status] || '#10b981';
        }

        // 4-Step Pathway
        const geo = (cemetery && cemetery.map_config && cemetery.map_config.geo) ? cemetery.map_config.geo : null;
        const gateName = (geo && geo.gate_name) || 'Gate 1 (Visitor Entrance)';
        if (slipStepFacility) slipStepFacility.textContent = gateName;
        if (slipStepSection) slipStepSection.textContent = section?.section_name || 'Section Quadrant';
        if (slipStepBlock) slipStepBlock.textContent = block?.block_name || 'Block Perimeter';
        if (slipStepLot) slipStepLot.textContent = `Plot #${lot.lot_number}`;

        // Location Metrics Table
        if (slipTableFacility) slipTableFacility.textContent = cemetery?.cemetery_name || '—';
        if (slipTableSection) slipTableSection.textContent = section?.section_name || '—';
        if (slipTableBlock) slipTableBlock.textContent = block?.block_name || '—';
        if (slipTableLot) slipTableLot.textContent = lot.lot_number || '—';
        if (slipTableType) slipTableType.textContent = lot.lot_type || 'Standard Lawn';
        if (slipTableDimensions) slipTableDimensions.textContent = lot.dimensions || '1.0m × 2.4m';

        if (lot.location_notes) {
            if (slipTableNotes) slipTableNotes.textContent = lot.location_notes;
            if (slipRowNotes) slipRowNotes.style.display = 'flex';
        } else {
            if (slipRowNotes) slipRowNotes.style.display = 'none';
        }

        // Batch 8C: Populate Slip Archetype & Monument Regulations
        const archetype = getLotArchetype(lot);
        const tierInfo = getLotLocationTier(lot);
        if (slipArchetypePreview) {
            slipArchetypePreview.innerHTML = archetype.svg;
        }
        if (slipMonumentRule) {
            slipMonumentRule.textContent = archetype.monumentRule || 'Flush Ground Marker';
        }
        if (slipCapacityRule) {
            slipCapacityRule.textContent = archetype.capacity || '2 Caskets (Double-Depth) + 4 Urns';
        }
        if (slipLocationTierRule) {
            slipLocationTierRule.textContent = tierInfo.tier || 'Standard Interior Lot';
        }

        // Render Schematic Mini-Map SVG
        renderSlipMiniMap(lot, block);

        // Display Modal
        if (wayfindingSlipModal) {
            wayfindingSlipModal.style.display = 'flex';
            wayfindingSlipModal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        }
    }

    /**
     * Close Wayfinding & Lot Location Slip Modal (Batch 7)
     */
    function closeWayfindingSlip() {
        if (wayfindingSlipModal) {
            wayfindingSlipModal.style.display = 'none';
            wayfindingSlipModal.setAttribute('aria-hidden', 'true');
            document.body.style.overflow = '';
        }
    }

    /**
     * Open Fullscreen Visual Archetype Lightbox Modal (Batch 8C)
     */
    function openArchetypeLightbox() {
        if (!state.selectedLot) {
            if (typeof showToast === 'function') {
                showToast('Please select a cemetery plot first.', 'warning');
            }
            return;
        }

        const lot = state.selectedLot;
        const archetype = getLotArchetype(lot);
        const tierInfo = getLotLocationTier(lot);

        if (lightboxGraphicStage) {
            lightboxGraphicStage.innerHTML = archetype.svg;
        }
        if (lightboxArchetypeBadge) {
            lightboxArchetypeBadge.textContent = archetype.name;
        }
        if (lightboxTierBadge) {
            lightboxTierBadge.innerHTML = `<i class="fas ${tierInfo.icon}"></i> ${escapeHtml(tierInfo.tier)}`;
            lightboxTierBadge.className = `lightbox-tier-badge ${tierInfo.badgeClass}`;
        }
        if (lightboxLotHeading) {
            lightboxLotHeading.textContent = `Lot ${lot.lot_number} — ${archetype.name}`;
        }
        if (lightboxLotDesc) {
            lightboxLotDesc.textContent = tierInfo.desc;
        }
        if (lightboxCapacityVal) {
            lightboxCapacityVal.textContent = archetype.capacity;
        }
        if (lightboxDimensionsVal) {
            lightboxDimensionsVal.textContent = lot.dimensions || archetype.dimensions;
        }
        if (lightboxMonumentVal) {
            lightboxMonumentVal.textContent = archetype.monumentRule;
        }
        if (lightboxCareVal) {
            lightboxCareVal.textContent = archetype.perpetualCare;
        }
        if (lightboxIntermentVal) {
            lightboxIntermentVal.textContent = archetype.intermentPrivilege;
        }
        if (lightboxPriceVal) {
            lightboxPriceVal.textContent = formatCurrency(lot.price);
        }

        if (archetypeLightboxModal) {
            archetypeLightboxModal.style.display = 'flex';
            archetypeLightboxModal.setAttribute('aria-hidden', 'false');
            document.body.style.overflow = 'hidden';
        }
    }

    /**
     * Close Fullscreen Visual Archetype Lightbox Modal (Batch 8C)
     */
    function closeArchetypeLightbox() {
        if (archetypeLightboxModal) {
            archetypeLightboxModal.style.display = 'none';
            archetypeLightboxModal.setAttribute('aria-hidden', 'true');
            if (!wayfindingSlipModal || wayfindingSlipModal.style.display === 'none') {
                document.body.style.overflow = '';
            }
        }
    }

    /**
     * Trigger Clean Browser Print Workflow (Batch 7)
     */
    function printWayfindingSlip() {
        window.print();
    }

    /**
     * Render Miniature Schematic Plot Grid (SVG) for Wayfinding Slip
     */
    function renderSlipMiniMap(targetLot, block) {
        if (!slipMiniMapSvg) return;
        slipMiniMapSvg.innerHTML = '';

        const lots = state.currentLots && state.currentLots.length > 0 ? state.currentLots : [targetLot];
        const canvasW = 600;
        const canvasH = 360;
        const margin = 28;
        const headerH = 34;

        // Background boundary for the block
        const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        bgRect.setAttribute('x', '4');
        bgRect.setAttribute('y', '4');
        bgRect.setAttribute('width', String(canvasW - 8));
        bgRect.setAttribute('height', String(canvasH - 8));
        bgRect.setAttribute('rx', '8');
        bgRect.setAttribute('fill', '#f8fafc');
        bgRect.setAttribute('stroke', '#cbd5e1');
        bgRect.setAttribute('stroke-width', '1.5');
        slipMiniMapSvg.appendChild(bgRect);

        // Block Title / Perimeter Label in SVG
        const blockLabel = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        blockLabel.setAttribute('x', String(margin));
        blockLabel.setAttribute('y', '24');
        blockLabel.setAttribute('fill', '#334155');
        blockLabel.setAttribute('font-size', '13');
        blockLabel.setAttribute('font-weight', '700');
        blockLabel.textContent = `${block?.block_name || 'Block Grid'} — Layout Scheme`;
        slipMiniMapSvg.appendChild(blockLabel);

        // North Orientation Indicator
        const northText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        northText.setAttribute('x', String(canvasW - margin - 20));
        northText.setAttribute('y', '24');
        northText.setAttribute('fill', '#64748b');
        northText.setAttribute('font-size', '11');
        northText.setAttribute('font-weight', '600');
        northText.textContent = '▲ NORTH';
        slipMiniMapSvg.appendChild(northText);

        // Plot Grid Bounds
        const gridX = margin;
        const gridY = margin + headerH;
        const gridW = canvasW - (margin * 2);
        const gridH = canvasH - gridY - margin;

        const lotCount = lots.length;
        let cols = 5;
        let gapX = 10;
        let gapY = 10;

        if (block?.map_config?.grid?.columns && !isNaN(Number(block.map_config.grid.columns))) {
            cols = parseInt(block.map_config.grid.columns, 10);
        } else {
            if (lotCount <= 10) cols = 5;
            else if (lotCount <= 20) cols = 5;
            else if (lotCount <= 40) cols = 8;
            else cols = 10;
        }

        const rows = Math.ceil(lotCount / cols) || 1;
        const tileW = (gridW - ((cols - 1) * gapX)) / cols;
        const tileH = (gridH - ((rows - 1) * gapY)) / rows;

        lots.forEach((lot, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const lx = gridX + (col * (tileW + gapX));
            const ly = gridY + (row * (tileH + gapY));

            const isTarget = String(lot.lot_id) === String(targetLot.lot_id);

            const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');

            const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            r.setAttribute('x', String(lx));
            r.setAttribute('y', String(ly));
            r.setAttribute('width', String(tileW));
            r.setAttribute('height', String(tileH));
            r.setAttribute('rx', '4');

            if (isTarget) {
                r.setAttribute('fill', '#059669');
                r.setAttribute('stroke', '#064e3b');
                r.setAttribute('stroke-width', '2.5');
            } else {
                r.setAttribute('fill', '#e2e8f0');
                r.setAttribute('stroke', '#cbd5e1');
                r.setAttribute('stroke-width', '1');
            }
            g.appendChild(r);

            // Lot label inside tile
            const txt = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            txt.setAttribute('x', String(lx + (tileW / 2)));
            txt.setAttribute('y', String(ly + (tileH / 2) + 4));
            txt.setAttribute('text-anchor', 'middle');
            txt.setAttribute('font-size', isTarget ? '12' : '10');
            txt.setAttribute('font-weight', isTarget ? '800' : '600');
            txt.setAttribute('fill', isTarget ? '#ffffff' : '#475569');
            txt.textContent = lot.lot_number;
            g.appendChild(txt);

            // Target Pin Icon / Marker
            if (isTarget) {
                const pin = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
                pin.setAttribute('cx', String(lx + tileW - 8));
                pin.setAttribute('cy', String(ly + 8));
                pin.setAttribute('r', '4');
                pin.setAttribute('fill', '#fbbf24');
                pin.setAttribute('stroke', '#ffffff');
                pin.setAttribute('stroke-width', '1.5');
                g.appendChild(pin);
            }

            slipMiniMapSvg.appendChild(g);
        });
    }

    /**
     * Return to Cemetery Overview
     */
    function returnToCemeteryOverview() {
        closeLotDrawer();
        state.currentSection = null;
        state.currentBlock = null;
        state.currentLots = [];
        state.viewLevel = 'cemetery';
        if (state.currentLayout) {
            renderCemeteryOverview(state.currentLayout);
        }
        updateLegendCounts([]);
        applyFilters();
    }

    /**
     * Update Breadcrumbs Bar (Batch 6: Includes exact lot level)
     */
    function updateBreadcrumbs() {
        bcCemeteryName.textContent = state.currentCemetery?.cemetery_name || 'Cemetery Overview';

        if (state.viewLevel === 'block' && state.currentSection && state.currentBlock) {
            bcSection.style.display = 'inline-flex';
            bcSectionName.textContent = state.currentSection.section_name;

            bcBlock.style.display = 'inline-flex';
            bcBlockName.textContent = state.currentBlock.block_name;

            if (state.selectedLot && bcLot && bcLotName) {
                bcLot.style.display = 'inline-flex';
                bcLotName.textContent = `Lot ${state.selectedLot.lot_number}`;

                bcCemetery.classList.remove('active');
                bcSection.classList.remove('active');
                bcBlock.classList.remove('active');
                bcLot.classList.add('active');
            } else {
                if (bcLot) bcLot.style.display = 'none';
                bcCemetery.classList.remove('active');
                bcSection.classList.remove('active');
                bcBlock.classList.add('active');
            }
        } else {
            bcSection.style.display = 'none';
            bcBlock.style.display = 'none';
            if (bcLot) bcLot.style.display = 'none';
            bcCemetery.classList.add('active');
        }
    }

    // =========================================================================
    // SEARCH & FILTER ENGINE (Batch 4A)
    // =========================================================================

    /**
     * Execute Search across Lots, Sections, and Blocks
     */
    async function executeSearch() {
        const query = (mapSearchInput.value || '').trim();
        if (!query) {
            state.filters.search = '';
            hideSearchResultsDropdown();
            applyFilters();
            return;
        }

        state.filters.search = query;
        btnClearSearch.style.display = 'flex';

        const normQuery = query.toLowerCase();

        // 1. Check if query matches a Section directly
        const sections = state.currentLayout?.sections || [];
        const matchedSection = sections.find(s => s.section_name.toLowerCase().includes(normQuery));

        // 2. Check if query matches a Block directly
        let matchedBlockObj = null;
        sections.forEach(s => {
            (s.blocks || []).forEach(b => {
                if (b.block_name.toLowerCase().includes(normQuery)) {
                    matchedBlockObj = { block: b, section: s };
                }
            });
        });

        // If the query is an exact or strong block match (e.g. "Block A1" or "A1"), drill down into that block
        if (matchedBlockObj && !normQuery.includes('-')) {
            hideSearchResultsDropdown();
            await drillDownToBlock(matchedBlockObj.block, matchedBlockObj.section);
            applyFilters();
            return;
        }

        // 3. Search for Lots
        const matchingLots = await searchLotsAcrossCemetery(normQuery);

        if (matchingLots.length === 0) {
            hideSearchResultsDropdown();
            // If section matched, stay at overview and highlight section
            if (matchedSection && state.viewLevel === 'cemetery') {
                document.querySelectorAll('.svg-section-card').forEach(card => {
                    const secId = parseInt(card.getAttribute('data-section-id'), 10);
                    if (secId === matchedSection.section_id) {
                        card.classList.add('is-matched');
                    } else {
                        card.classList.remove('is-matched');
                    }
                });
                toast(`Found ${matchedSection.section_name}`, 'info');
            } else {
                toast(`No lots found matching "${query}".`, 'warning');
            }
            applyFilters();
            return;
        }

        if (matchingLots.length === 1) {
            // Exactly ONE match -> drill down, highlight, open drawer
            hideSearchResultsDropdown();
            const single = matchingLots[0];
            await navigateAndSelectLot(single.lot, single.block, single.section);
            applyFilters();
        } else {
            // Multiple matches -> render dropdown list
            renderSearchResultsDropdown(matchingLots);
            applyFilters();
        }
    }

    /**
     * Search Lots across current block, cached blocks, and candidate blocks
     */
    async function searchLotsAcrossCemetery(normQuery) {
        const results = [];
        const sections = state.currentLayout?.sections || [];

        // A. Search currently active block first
        if (state.viewLevel === 'block' && state.currentBlock && state.currentSection) {
            state.currentLots.forEach(lot => {
                if (lot.lot_number.toLowerCase().includes(normQuery)) {
                    results.push({
                        lot,
                        block: state.currentBlock,
                        section: state.currentSection
                    });
                }
            });
            if (results.length > 0) return results;
        }

        // B. Search already-cached blocks
        for (const [blockIdStr, lots] of Object.entries(state.blockLotsCache)) {
            const blockId = parseInt(blockIdStr, 10);
            let bObj = null;
            let sObj = null;
            sections.forEach(s => {
                (s.blocks || []).forEach(b => {
                    if (b.block_id === blockId) {
                        bObj = b; sObj = s;
                    }
                });
            });

            lots.forEach(lot => {
                if (lot.lot_number.toLowerCase().includes(normQuery)) {
                    results.push({ lot, block: bObj, section: sObj });
                }
            });
        }
        if (results.length > 0) return results;

        // C. Candidate block resolution based on lot prefix
        // e.g., query "A1-05" -> Block "Block A1" or Section "Garden of Everlasting Peace"
        const candidateBlocks = [];
        sections.forEach(s => {
            (s.blocks || []).forEach(b => {
                const bNorm = b.block_name.toLowerCase().replace(/[^a-z0-9]/g, '');
                const qClean = normQuery.replace(/[^a-z0-9]/g, '');
                if (qClean.includes(bNorm) || bNorm.includes(qClean) || normQuery.startsWith(b.block_name.toLowerCase())) {
                    if (!state.blockLotsCache[b.block_id]) {
                        candidateBlocks.push({ block: b, section: s });
                    }
                }
            });
        });

        // Fetch candidate blocks progressively on demand
        for (const cand of candidateBlocks) {
            try {
                const res = await api.request(`map/blocks/${cand.block.block_id}/lots`, { method: 'GET' });
                if (res && res.success && res.data && Array.isArray(res.data.lots)) {
                    state.blockLotsCache[cand.block.block_id] = res.data.lots;
                    res.data.lots.forEach(lot => {
                        if (lot.lot_number.toLowerCase().includes(normQuery)) {
                            results.push({ lot, block: cand.block, section: cand.section });
                        }
                    });
                }
            } catch (e) {
                console.warn(`Could not fetch candidate block #${cand.block.block_id}:`, e);
            }
        }

        return results;
    }

    /**
     * Navigate to specific Lot, drill down into its block, and open drawer
     */
    async function navigateAndSelectLot(lot, block, section) {
        // If not already in that block, drill down first
        if (!state.currentBlock || state.currentBlock.block_id !== block.block_id) {
            await drillDownToBlock(block, section);
        }

        // Highlight lot in SVG & open details drawer
        const lotElement = document.querySelector(`.svg-lot-tile[data-lot-id="${lot.lot_id}"]`);
        selectLot(lot, block, section, lotElement);

        // Center on lot (Batch 6)
        centerOnSelectedLot();
    }

    /**
     * Render Multiple Search Results Dropdown
     */
    function renderSearchResultsDropdown(results) {
        searchResultsDropdown.innerHTML = '';
        const maxShown = Math.min(results.length, 10);

        const header = document.createElement('div');
        header.style.cssText = 'padding: 8px 14px; font-size: 0.75rem; font-weight: 700; color: var(--map-text-muted); border-bottom: 1px solid var(--map-border); text-transform: uppercase;';
        header.textContent = `${results.length} matching plots found`;
        searchResultsDropdown.appendChild(header);

        results.slice(0, maxShown).forEach(item => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'search-result-item';

            const statusClass = (item.lot.status || 'available').toLowerCase().replace(/\s+/g, '-');

            btn.innerHTML = `
                <div class="result-item-main">
                    <span class="result-lot-number">Lot ${escapeHtml(item.lot.lot_number)}</span>
                    <span class="result-lot-meta">${escapeHtml(item.section?.section_name || '')} › ${escapeHtml(item.block?.block_name || '')} • ${formatCurrency(item.lot.price)}</span>
                </div>
                <span class="result-status-pill status-pill--${statusClass}">${escapeHtml(item.lot.status)}</span>
            `;

            btn.addEventListener('click', async () => {
                hideSearchResultsDropdown();
                await navigateAndSelectLot(item.lot, item.block, item.section);
                applyFilters();
            });

            searchResultsDropdown.appendChild(btn);
        });

        searchResultsDropdown.style.display = 'block';
    }

    function hideSearchResultsDropdown() {
        searchResultsDropdown.style.display = 'none';
    }

    /**
     * Handle Price Range Input Changes
     */
    function handlePriceFilterChange() {
        const minVal = minPriceInput.value.trim();
        const maxVal = maxPriceInput.value.trim();

        state.filters.minPrice = minVal !== '' ? parseFloat(minVal) : null;
        state.filters.maxPrice = maxVal !== '' ? parseFloat(maxVal) : null;

        // Graceful validation if min > max
        if (state.filters.minPrice !== null && state.filters.maxPrice !== null) {
            if (state.filters.minPrice > state.filters.maxPrice) {
                minPriceInput.style.borderColor = 'var(--color-danger, #dc2626)';
                maxPriceInput.style.borderColor = 'var(--color-danger, #dc2626)';
            } else {
                minPriceInput.style.borderColor = '';
                maxPriceInput.style.borderColor = '';
            }
        } else {
            minPriceInput.style.borderColor = '';
            maxPriceInput.style.borderColor = '';
        }

        applyFilters();
    }

    /**
     * Check if a lot matches all active filters (Search AND Status AND Price)
     */
    function lotMatchesFilters(lot) {
        // 1. Search Query
        if (state.filters.search) {
            const q = state.filters.search.toLowerCase().trim();
            if (!lot.lot_number.toLowerCase().includes(q)) {
                return false;
            }
        }

        // 2. Status Filter
        if (state.filters.status && state.filters.status !== 'all') {
            const lotStatus = String(lot.status || '').trim().toLowerCase();
            const targetStatus = String(state.filters.status).trim().toLowerCase();
            if (lotStatus !== targetStatus) {
                return false;
            }
        }

        // 3. Price Range Filter
        const price = parseFloat(lot.price) || 0;
        if (state.filters.minPrice !== null && !isNaN(state.filters.minPrice)) {
            if (price < state.filters.minPrice) {
                return false;
            }
        }
        if (state.filters.maxPrice !== null && !isNaN(state.filters.maxPrice)) {
            if (price > state.filters.maxPrice) {
                return false;
            }
        }

        return true;
    }

    /**
     * Apply active filters to current view & SVG elements
     */
    function applyFilters() {
        updateActiveFilterChips();
        syncLegendButtons();

        const hasActiveFilter = (
            state.filters.search !== '' ||
            state.filters.status !== 'all' ||
            state.filters.minPrice !== null ||
            state.filters.maxPrice !== null
        );

        // Update Block view lots if in block level
        if (state.viewLevel === 'block' && state.currentLots.length > 0) {
            let matchedCount = 0;

            state.currentLots.forEach(lot => {
                const isMatch = lotMatchesFilters(lot);
                const tileEl = document.querySelector(`.svg-lot-tile[data-lot-id="${lot.lot_id}"]`);

                if (tileEl) {
                    if (isMatch) {
                        tileEl.classList.remove('is-filtered-out');
                        if (hasActiveFilter) {
                            tileEl.classList.add('is-matched');
                        } else {
                            tileEl.classList.remove('is-matched');
                        }
                        matchedCount++;
                    } else {
                        tileEl.classList.add('is-filtered-out');
                        tileEl.classList.remove('is-matched');
                    }
                }
            });

            // Update badge & header feedback
            if (hasActiveFilter) {
                filterMatchesBadge.style.display = 'inline-flex';
                filterMatchesBadge.innerHTML = `<i class="fas fa-filter"></i> ${matchedCount} of ${state.currentLots.length} match`;

                const subtitle = document.getElementById('blockLotsSummarySubtitle');
                if (subtitle) {
                    subtitle.textContent = matchedCount === 0
                        ? `No plots in this block match the current filter criteria.`
                        : `Filtered: ${matchedCount} of ${state.currentLots.length} plots match filter criteria.`;
                }
            } else {
                filterMatchesBadge.style.display = 'none';
            }
        } else {
            filterMatchesBadge.style.display = 'none';
        }
    }

    /**
     * Render Active Filter Chips
     */
    function updateActiveFilterChips() {
        activeFilterChips.innerHTML = '';
        const chips = [];

        if (state.filters.search) {
            chips.push({
                label: `Search: "${state.filters.search}"`,
                remove: () => {
                    mapSearchInput.value = '';
                    btnClearSearch.style.display = 'none';
                    state.filters.search = '';
                    hideSearchResultsDropdown();
                    applyFilters();
                }
            });
        }

        if (state.filters.status && state.filters.status !== 'all') {
            chips.push({
                label: `Status: ${state.filters.status}`,
                remove: () => {
                    statusFilter.value = 'all';
                    state.filters.status = 'all';
                    applyFilters();
                }
            });
        }

        if (state.filters.minPrice !== null || state.filters.maxPrice !== null) {
            const minStr = state.filters.minPrice !== null ? `₱${state.filters.minPrice}` : '0';
            const maxStr = state.filters.maxPrice !== null ? `₱${state.filters.maxPrice}` : '∞';
            chips.push({
                label: `Price: ${minStr} – ${maxStr}`,
                remove: () => {
                    minPriceInput.value = '';
                    maxPriceInput.value = '';
                    state.filters.minPrice = null;
                    state.filters.maxPrice = null;
                    minPriceInput.style.borderColor = '';
                    maxPriceInput.style.borderColor = '';
                    applyFilters();
                }
            });
        }

        if (chips.length > 0) {
            activeFiltersSummary.style.display = 'flex';
            chips.forEach(c => {
                const chip = document.createElement('span');
                chip.className = 'filter-chip';
                chip.innerHTML = `${escapeHtml(c.label)} <i class="fas fa-xmark filter-chip-remove" title="Remove filter"></i>`;
                chip.querySelector('.filter-chip-remove').addEventListener('click', c.remove);
                activeFilterChips.appendChild(chip);
            });
        } else {
            activeFiltersSummary.style.display = 'none';
        }
    }

    /**
     * Reset / Clear All Filters
     */
    function resetAllFilters(reapply = true) {
        mapSearchInput.value = '';
        btnClearSearch.style.display = 'none';
        statusFilter.value = 'all';
        minPriceInput.value = '';
        maxPriceInput.value = '';
        minPriceInput.style.borderColor = '';
        maxPriceInput.style.borderColor = '';

        state.filters = {
            search: '',
            status: 'all',
            minPrice: null,
            maxPrice: null,
        };

        hideSearchResultsDropdown();

        // Remove SVG filter classes
        document.querySelectorAll('.svg-lot-tile.is-filtered-out').forEach(el => el.classList.remove('is-filtered-out'));
        document.querySelectorAll('.svg-lot-tile.is-matched').forEach(el => el.classList.remove('is-matched'));
        document.querySelectorAll('.svg-section-card.is-matched').forEach(el => el.classList.remove('is-matched'));
        document.querySelectorAll('.svg-block-card.is-matched').forEach(el => el.classList.remove('is-matched'));

        syncLegendButtons();

        if (reapply) {
            applyFilters();
        }
    }

    /**
     * Handle Legend Button Click (Toggle Status Filter)
     */
    function handleLegendStatusClick(status) {
        if (state.filters.status === status) {
            state.filters.status = 'all';
            if (statusFilter) statusFilter.value = 'all';
        } else {
            state.filters.status = status;
            if (statusFilter) statusFilter.value = status;
        }
        syncLegendButtons();
        applyFilters();
    }

    /**
     * Synchronize Legend Buttons Active / Muted states with active status filter
     */
    function syncLegendButtons() {
        const curStatus = state.filters.status;
        const legendBtns = document.querySelectorAll('#mapLegendBtns .legend-btn[data-status]:not(.is-indicator)');
        legendBtns.forEach(btn => {
            const btnStatus = btn.getAttribute('data-status');
            if (curStatus === 'all') {
                btn.classList.add('active');
                btn.classList.remove('muted');
            } else if (btnStatus === curStatus) {
                btn.classList.add('active');
                btn.classList.remove('muted');
            } else {
                btn.classList.remove('active');
                btn.classList.add('muted');
            }
        });
    }

    /**
     * Dynamically update lot counts on the interactive legend buttons
     */
    function updateLegendCounts(lots) {
        const counts = {
            Available: 0,
            Reserved: 0,
            Occupied: 0,
            Unavailable: 0,
            'Under Maintenance': 0
        };

        if (Array.isArray(lots) && lots.length > 0) {
            lots.forEach(l => {
                const st = l.status || 'Available';
                if (counts[st] !== undefined) {
                    counts[st]++;
                } else if (st.toLowerCase().includes('maint')) {
                    counts['Under Maintenance']++;
                } else {
                    counts.Unavailable++;
                }
            });
        } else if (state.currentLayout && Array.isArray(state.currentLayout.sections)) {
            state.currentLayout.sections.forEach(s => {
                if (s.available_lots !== undefined) counts.Available += Number(s.available_lots) || 0;
                if (s.reserved_lots !== undefined) counts.Reserved += Number(s.reserved_lots) || 0;
                if (s.occupied_lots !== undefined) counts.Occupied += Number(s.occupied_lots) || 0;
                if (s.unavailable_lots !== undefined) counts.Unavailable += Number(s.unavailable_lots) || 0;
            });
        }

        const elAvail = document.getElementById('legendCountAvailable');
        const elRes = document.getElementById('legendCountReserved');
        const elOcc = document.getElementById('legendCountOccupied');
        const elUnavail = document.getElementById('legendCountUnavailable');
        const elMaint = document.getElementById('legendCountMaintenance');

        if (elAvail) elAvail.textContent = counts.Available;
        if (elRes) elRes.textContent = counts.Reserved;
        if (elOcc) elOcc.textContent = counts.Occupied;
        if (elUnavail) elUnavail.textContent = counts.Unavailable;
        if (elMaint) elMaint.textContent = counts['Under Maintenance'];
    }

    // =========================================================================
    // SVG VIEWPORT TRANSFORMS & ZOOM / PAN CONTROLS
    // =========================================================================

    /**
     * SVG Zoom Controls
     */
    function zoomView(factor) {
        const vb = state.currentViewBox;
        const newW = vb.width * factor;
        const newH = vb.height * factor;

        // Bound zoom limits
        if (newW < 400 || newW > 2400) return;

        const centerX = vb.x + (vb.width / 2);
        const centerY = vb.y + (vb.height / 2);

        vb.x = centerX - (newW / 2);
        vb.y = centerY - (newH / 2);
        vb.width = newW;
        vb.height = newH;

        applyViewBox();
    }

    /**
     * Center View on (X, Y) Coordinates (with optional zoomFactor support)
     */
    function centerViewOnPoint(x, y, zoomFactor = null) {
        const vb = state.currentViewBox;
        if (zoomFactor !== null && !isNaN(zoomFactor) && zoomFactor > 0 && zoomFactor <= 1.0) {
            const targetW = state.baseViewBox.width * zoomFactor;
            const targetH = state.baseViewBox.height * zoomFactor;
            vb.width = targetW;
            vb.height = targetH;
        }
        vb.x = Math.max(0, Math.min(state.baseViewBox.width - vb.width, x - (vb.width / 2)));
        vb.y = Math.max(0, Math.min(state.baseViewBox.height - vb.height, y - (vb.height / 2)));
        applyViewBox();
    }

    /**
     * Reset ViewBox to Base Dimensions
     */
    function resetView() {
        state.currentViewBox = { ...state.baseViewBox };
        applyViewBox();
    }

    /**
     * Apply Current ViewBox to SVG Element
     */
    function applyViewBox() {
        const vb = state.currentViewBox;
        cemeteryMapSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    }

    /**
     * Pan Controls on SVG
     */
    function handleMouseDown(e) {
        if (e.target.closest('.svg-block-card') || e.target.closest('.svg-lot-tile')) {
            return;
        }
        state.isPanning = true;
        state.panStart = { x: e.clientX, y: e.clientY };
    }

    function handleMouseMove(e) {
        if (!state.isPanning) return;
        const dx = (e.clientX - state.panStart.x) * (state.currentViewBox.width / svgStageContainer.clientWidth);
        const dy = (e.clientY - state.panStart.y) * (state.currentViewBox.height / svgStageContainer.clientHeight);

        state.currentViewBox.x -= dx;
        state.currentViewBox.y -= dy;
        applyViewBox();

        state.panStart = { x: e.clientX, y: e.clientY };
    }

    function handleMouseUp() {
        state.isPanning = false;
    }

    /**
     * Floating Tooltip Handlers
     */
    function showFloatingTooltip(e, htmlContent) {
        svgFloatingTooltip.innerHTML = htmlContent;
        svgFloatingTooltip.style.display = 'block';
        moveFloatingTooltip(e);
    }

    function moveFloatingTooltip(e) {
        const rect = svgStageContainer.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;
        svgFloatingTooltip.style.left = `${x}px`;
        svgFloatingTooltip.style.top = `${y}px`;
    }

    function hideFloatingTooltip() {
        svgFloatingTooltip.style.display = 'none';
    }

    // =========================================================================
    // BATCH 9A: REAL-WORLD GOOGLE MAPS NAVIGATION & DUAL-VIEW CONTROLLERS
    // =========================================================================

    /**
     * Switch Map View Mode ('plot' | 'geo')
     * Toggles between native procedural vector plot locator and Google Maps real-world overview
     */
    function switchMapView(mode) {
        state.activeMapView = mode;

        if (mode === 'geo') {
            if (btnSwitchPlotView) {
                btnSwitchPlotView.classList.remove('active');
                btnSwitchPlotView.setAttribute('aria-selected', 'false');
            }
            if (btnSwitchGeoView) {
                btnSwitchGeoView.classList.add('active');
                btnSwitchGeoView.setAttribute('aria-selected', 'true');
            }

            if (svgStageContainer) svgStageContainer.style.display = 'none';
            if (mapLocationSummaryCard) mapLocationSummaryCard.style.display = 'none';
            if (geoStageContainer) geoStageContainer.style.display = 'block';

            if (viewLevelBadge && viewLevelText) {
                viewLevelText.textContent = 'Facility Geographic Location';
            }

            loadGeoFacilityMap(state.currentCemetery);
        } else {
            if (btnSwitchGeoView) {
                btnSwitchGeoView.classList.remove('active');
                btnSwitchGeoView.setAttribute('aria-selected', 'false');
            }
            if (btnSwitchPlotView) {
                btnSwitchPlotView.classList.add('active');
                btnSwitchPlotView.setAttribute('aria-selected', 'true');
            }

            if (geoStageContainer) geoStageContainer.style.display = 'none';
            if (svgStageContainer) svgStageContainer.style.display = 'block';

            if (viewLevelBadge && viewLevelText) {
                viewLevelText.textContent = state.viewLevel === 'block'
                    ? (state.currentBlock?.block_name || 'Block View')
                    : 'Cemetery Overview';
            }

            if (state.selectedLot && mapLocationSummaryCard) {
                mapLocationSummaryCard.style.display = 'block';
            }
        }
    }

    /**
     * Load Cemetery Real-World Facility onto Google Maps iframe & HUD
     */
    function loadGeoFacilityMap(cemetery) {
        if (!cemetery) return;

        const cemName = cemetery.cemetery_name || 'Cemetery Facility';
        const address = cemetery.address || 'Municipal Cemetery Grounds';
        const geo = (cemetery.map_config && cemetery.map_config.geo) ? cemetery.map_config.geo : null;
        const lat = geo ? geo.latitude : null;
        const lng = geo ? geo.longitude : null;
        const accessCue = (geo && geo.access_cue) || 'Main Visitor Entrance & Parking Gate';

        if (geoHudFacilityName) {
            geoHudFacilityName.textContent = cemName;
        }
        if (geoHudAddress) {
            const addrSpan = geoHudAddress.querySelector('span');
            if (addrSpan) addrSpan.textContent = address;
        }
        if (geoHudAccessCue) {
            const cueSpan = geoHudAccessCue.querySelector('span');
            if (cueSpan) cueSpan.textContent = accessCue;
        }

        let embedUrl = '';
        let directionsUrl = '';

        if (lat && lng) {
            embedUrl = `https://maps.google.com/maps?q=${lat},${lng}&t=m&z=17&output=embed`;
            directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
        } else {
            const query = `${cemName} ${address}`.trim();
            embedUrl = `https://maps.google.com/maps?q=${encodeURIComponent(query)}&t=m&z=16&output=embed`;
            directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(query)}`;
        }

        if (geoMapIframe && (!geoMapIframe.src || !geoMapIframe.src.includes(encodeURIComponent(cemName)))) {
            geoMapIframe.src = embedUrl;
        }

        if (btnGetDirectionsGeo) {
            btnGetDirectionsGeo.href = directionsUrl;
        }

        // Batch 9C: Construct Waze Navigation Link
        if (btnOpenWazeGeo) {
            let wazeUrl = '';
            if (lat && lng) {
                wazeUrl = `https://waze.com/ul?ll=${lat},${lng}&navigate=yes`;
            } else {
                const query = `${cemName} ${address}`.trim();
                wazeUrl = `https://waze.com/ul?q=${encodeURIComponent(query)}&navigate=yes`;
            }
            btnOpenWazeGeo.href = wazeUrl;
        }

        // Batch 9C: Dismiss loading indicator upon iframe load
        if (geoMapIframe) {
            geoMapIframe.onload = function () {
                const loadingEl = document.getElementById('geoMapLoading');
                if (loadingEl) loadingEl.style.display = 'none';
            };
        }
    }

    /**
     * Handle Lot Type Zone Quick Selector Click
     * Seamlessly bridges user from Real-World Google Maps view to Vector Plot Map
     */
    function handleGeoZoneSelect(zoneKey) {
        const zoneLabels = {
            lawn: 'Lawn Lots Zone',
            garden: 'Garden Memorial Zone',
            mausoleum: 'Mausoleum Avenue',
            columbarium: 'Columbarium Sanctuary'
        };
        const zoneLabel = zoneLabels[zoneKey] || 'Selected Zone';

        // 1. Switch back to Plot Vector Map view
        switchMapView('plot');

        // 2. Set search term to locate lots or blocks matching this zone
        if (mapSearchInput) {
            mapSearchInput.value = zoneKey;
            handleSearchInput();
        }

        toast(`Viewing ${zoneLabel} in plot map`, 'info');
    }

})();
