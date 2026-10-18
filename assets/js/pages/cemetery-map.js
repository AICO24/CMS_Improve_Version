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
        viewLevel: 'cemetery', // 'cemetery' | 'block' (legacy fallback)
        mapViewLevel: 'overview', // 'overview' | 'section' | 'block' | 'lot' (Batch 8)
        focusedSectionId: null,
        focusedBlockId: null,
        focusedLotId: null,
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

        // SVG Viewport & Navigation Matrix (Refocused on Everlasting Peace parcel)
        baseViewBox: { x: 440, y: 95, width: 880, height: 890 },
        currentViewBox: { x: 440, y: 95, width: 880, height: 890 },
        zoomLevel: 1.0,
        isPanning: false,
        panStart: { x: 0, y: 0 },
        activeRoute: null,

        // Batch 11: Today's Services & Funeral Cortège Wayfinding State
        todayServices: [],
        isTodayServicesOpen: false,
        selectedTodayServiceId: null,
        isTodayServicesLoading: false,
        activeCortegeService: null,
    };

    // =========================================================================
    // BATCH 2: MASTER MAP ROAD & LANDMARK NETWORK COORDINATES (BATCH 6 ROUTING)
    // =========================================================================
    const MASTER_MAP_NETWORK = {
        nodes: {
            EXTERNAL_ENTRY: { id: 'EXTERNAL_ENTRY', x: 1101, y: 928, label: 'P. Aquino Avenue Ingress' },
            MAIN_GATE: { id: 'MAIN_GATE', x: 1096, y: 881, label: 'Main Gate Portal (P. Aquino Ave)' },
            SOUTH_JUNCTION: { id: 'SOUTH_JUNCTION', x: 1090, y: 820, label: 'Entrance Corridor Junction' },
            CENTRAL_ROUNDABOUT: { id: 'CENTRAL_ROUNDABOUT', x: 800, y: 545, label: 'Memorial Roundabout' },
            NORTH_TERMINUS: { id: 'NORTH_TERMINUS', x: 800, y: 80, label: 'St. Peter Way Junction' },
            WEST_CROSSWAY: { id: 'WEST_CROSSWAY', x: 95, y: 545, label: 'Avenue of Peace (West End)' },
            EAST_CROSSWAY: { id: 'EAST_CROSSWAY', x: 1505, y: 545, label: 'Avenue of Peace (East End)' },
            ADMIN_ACCESS: { id: 'ADMIN_ACCESS', x: 782, y: 380, label: 'Administration Office' },
            CHAPEL_ACCESS: { id: 'CHAPEL_ACCESS', x: 858, y: 362, label: 'Memorial Chapel' },
            COLUMBARIUM_ACCESS: { id: 'COLUMBARIUM_ACCESS', x: 886, y: 274, label: 'Columbarium Sanctuary' },
            CREMATORIUM_ACCESS: { id: 'CREMATORIUM_ACCESS', x: 978, y: 271, label: 'Crematorium Facility' },
            COMFORT_ROOM_ACCESS: { id: 'COMFORT_ROOM_ACCESS', x: 932, y: 247, label: 'Comfort Room (CR)' },
            PARKING_ACCESS: { id: 'PARKING_ACCESS', x: 1035, y: 755, label: 'Visitor Parking Zone' },
            SEC_GARDEN_PEACE: { id: 'SEC_GARDEN_PEACE', x: 800, y: 425, label: 'Garden of Everlasting Peace Access' },
            SEC_LOURDES: { id: 'SEC_LOURDES', x: 672, y: 427, label: 'Garden of Our Lady of Lourdes Access' },
            SEC_SAN_JOSE: { id: 'SEC_SAN_JOSE', x: 733, y: 280, label: 'Sanctuario de San Jose Access' },
            SEC_COLUMBARIUM: { id: 'SEC_COLUMBARIUM', x: 886, y: 274, label: 'Columbarium Sanctuary Access' },

            // Secondary Intersections on Master Map
            PROMENADE_JUNCTION: { id: 'PROMENADE_JUNCTION', x: 800, y: 300, label: 'Central Promenade Junction' },
            MID_WEST_CROSSWAY: { id: 'MID_WEST_CROSSWAY', x: 515, y: 545, label: 'Avenue of Peace (Mid-West Junction)' },
            MID_EAST_CROSSWAY: { id: 'MID_EAST_CROSSWAY', x: 1085, y: 545, label: 'Avenue of Peace (Mid-East Junction)' },
            WEST_PROM: { id: 'WEST_PROM', x: 95, y: 300, label: 'Internal Promenade (West End)' },
            MID_WEST_PROM: { id: 'MID_WEST_PROM', x: 515, y: 300, label: 'Internal Promenade (Mid-West)' },
            MID_EAST_PROM: { id: 'MID_EAST_PROM', x: 1085, y: 300, label: 'Internal Promenade (Mid-East)' },
            EAST_PROM: { id: 'EAST_PROM', x: 1505, y: 300, label: 'Internal Promenade (East End)' },
            NORTH_WEST: { id: 'NORTH_WEST', x: 95, y: 80, label: 'North Boundary Road (West End)' },
            NORTH_MID_WEST: { id: 'NORTH_MID_WEST', x: 515, y: 80, label: 'North Boundary Road (Mid-West)' },
            NORTH_MID_EAST: { id: 'NORTH_MID_EAST', x: 1085, y: 80, label: 'North Boundary Road (Mid-East)' },
            NORTH_EAST: { id: 'NORTH_EAST', x: 1505, y: 80, label: 'North Boundary Road (East End)' },
            WEST_SERVICE: { id: 'WEST_SERVICE', x: 95, y: 865, label: 'South Service Road (West End)' },
            EAST_SERVICE: { id: 'EAST_SERVICE', x: 1505, y: 865, label: 'South Service Road (East End)' },
            CREMATORIUM_SPINE: { id: 'CREMATORIUM_SPINE', x: 800, y: 545, label: 'Central Spine (Memorial Roundabout)' },
            COLUMBARIUM_SOUTH: { id: 'COLUMBARIUM_SOUTH', x: 886, y: 310, label: 'Columbarium South Approach' },
            PARKING_SOUTH: { id: 'PARKING_SOUTH', x: 1035, y: 785, label: 'Visitor Parking (South Bay)' },

            // Block & Terrace Level Access
            SEC_A_SPINE_LEFT: { id: 'SEC_A_SPINE_LEFT', x: 780, y: 425, label: 'Section A (Block A1 Entrance)' },
            SEC_A_SPINE_RIGHT: { id: 'SEC_A_SPINE_RIGHT', x: 820, y: 425, label: 'Section A (Block A2 Entrance)' },
            SEC_A_WEST_ACCESS: { id: 'SEC_A_WEST_ACCESS', x: 735, y: 425, label: 'Section A (West Access Road)' },
            SEC_A_EAST_ACCESS: { id: 'SEC_A_EAST_ACCESS', x: 865, y: 425, label: 'Section A (East Access Road)' },
            SEC_B_WEST_ACCESS: { id: 'SEC_B_WEST_ACCESS', x: 635, y: 427, label: 'Section B (West Ring Access)' },
            SEC_B_EAST_ACCESS: { id: 'SEC_B_EAST_ACCESS', x: 710, y: 427, label: 'Section B (Mid-West Road Access)' },
            SEC_C_SOUTH_ACCESS: { id: 'SEC_C_SOUTH_ACCESS', x: 733, y: 350, label: 'Sanctuario de San Jose (Promenade Entrance)' },
            SEC_C_NORTH_ACCESS: { id: 'SEC_C_NORTH_ACCESS', x: 733, y: 280, label: 'Sanctuario de San Jose (North Entrance)' },
            SEC_D_SOUTH_ACCESS: { id: 'SEC_D_SOUTH_ACCESS', x: 871, y: 315, label: 'Columbarium & Ossuary (Promenade Entrance)' },
            SEC_D_NORTH_ACCESS: { id: 'SEC_D_NORTH_ACCESS', x: 871, y: 190, label: 'Columbarium & Ossuary (North Entrance)' },
            SEC_E_WEST_ACCESS: { id: 'SEC_E_WEST_ACCESS', x: 875, y: 411, label: 'Section E (Mid-East Road Entrance)' },
            SEC_E_EAST_ACCESS: { id: 'SEC_E_EAST_ACCESS', x: 945, y: 411, label: 'Section E (East Ring Road Entrance)' },
            SEC_E_SOUTH_ACCESS: { id: 'SEC_E_SOUTH_ACCESS', x: 910, y: 432, label: 'Section E (Avenue Ingress)' }
        },
        edges: [
            ['EXTERNAL_ENTRY', 'MAIN_GATE'],
            ['MAIN_GATE', 'SOUTH_JUNCTION'],
            ['SOUTH_JUNCTION', 'PARKING_ACCESS'],
            ['PARKING_ACCESS', 'PARKING_SOUTH'],
            ['SOUTH_JUNCTION', 'MID_EAST_CROSSWAY'],
            ['SOUTH_JUNCTION', 'CREMATORIUM_SPINE'],
            ['SOUTH_JUNCTION', 'COLUMBARIUM_SOUTH'],
            ['MID_EAST_CROSSWAY', 'CENTRAL_ROUNDABOUT'],
            ['MID_EAST_CROSSWAY', 'MID_EAST_PROM'],
            ['MID_EAST_CROSSWAY', 'SEC_E_SOUTH_ACCESS'],
            ['CREMATORIUM_SPINE', 'CENTRAL_ROUNDABOUT'],
            ['CENTRAL_ROUNDABOUT', 'SEC_A_SPINE_LEFT'],
            ['CENTRAL_ROUNDABOUT', 'SEC_A_SPINE_RIGHT'],
            ['CENTRAL_ROUNDABOUT', 'MID_WEST_CROSSWAY'],
            ['SEC_A_SPINE_LEFT', 'ADMIN_ACCESS'],
            ['ADMIN_ACCESS', 'PROMENADE_JUNCTION'],
            ['SEC_A_SPINE_RIGHT', 'CHAPEL_ACCESS'],
            ['CHAPEL_ACCESS', 'PROMENADE_JUNCTION'],
            ['PROMENADE_JUNCTION', 'COLUMBARIUM_ACCESS'],
            ['COLUMBARIUM_ACCESS', 'CREMATORIUM_ACCESS'],
            ['CREMATORIUM_ACCESS', 'COMFORT_ROOM_ACCESS'],
            ['CREMATORIUM_ACCESS', 'MID_EAST_PROM'],
            ['PROMENADE_JUNCTION', 'NORTH_TERMINUS'],
            ['PROMENADE_JUNCTION', 'SEC_GARDEN_PEACE'],
            ['PROMENADE_JUNCTION', 'SEC_D_SOUTH_ACCESS'],
            ['PROMENADE_JUNCTION', 'MID_WEST_PROM'],
            ['MID_WEST_CROSSWAY', 'SEC_LOURDES'],
            ['SEC_LOURDES', 'WEST_CROSSWAY'],
            ['SEC_E_SOUTH_ACCESS', 'EAST_CROSSWAY'],
            ['WEST_SERVICE', 'WEST_CROSSWAY'],
            ['WEST_CROSSWAY', 'SEC_B_WEST_ACCESS'],
            ['SEC_B_WEST_ACCESS', 'WEST_PROM'],
            ['WEST_PROM', 'NORTH_WEST'],
            ['WEST_PROM', 'SEC_C_SOUTH_ACCESS'],
            ['SEC_C_SOUTH_ACCESS', 'MID_WEST_PROM'],
            ['MID_WEST_PROM', 'SEC_A_WEST_ACCESS'],
            ['SEC_A_WEST_ACCESS', 'MID_WEST_CROSSWAY'],
            ['MID_WEST_PROM', 'SEC_B_EAST_ACCESS'],
            ['SEC_B_EAST_ACCESS', 'MID_WEST_CROSSWAY'],
            ['NORTH_WEST', 'SEC_C_NORTH_ACCESS'],
            ['SEC_C_NORTH_ACCESS', 'NORTH_MID_WEST'],
            ['NORTH_MID_WEST', 'SEC_SAN_JOSE'],
            ['SEC_SAN_JOSE', 'MID_WEST_PROM'],
            ['NORTH_MID_WEST', 'NORTH_TERMINUS'],
            ['NORTH_TERMINUS', 'SEC_D_NORTH_ACCESS'],
            ['SEC_D_NORTH_ACCESS', 'NORTH_MID_EAST'],
            ['NORTH_MID_EAST', 'SEC_COLUMBARIUM'],
            ['SEC_COLUMBARIUM', 'COLUMBARIUM_ACCESS'],
            ['NORTH_MID_EAST', 'NORTH_EAST'],
            ['NORTH_EAST', 'EAST_PROM'],
            ['EAST_PROM', 'SEC_E_EAST_ACCESS'],
            ['SEC_E_EAST_ACCESS', 'EAST_CROSSWAY'],
            ['EAST_CROSSWAY', 'EAST_SERVICE'],
            ['MID_EAST_PROM', 'SEC_A_EAST_ACCESS'],
            ['SEC_A_EAST_ACCESS', 'MID_EAST_CROSSWAY'],
            ['MID_EAST_PROM', 'SEC_E_WEST_ACCESS'],
            ['SEC_E_WEST_ACCESS', 'MID_EAST_CROSSWAY'],
            ['COLUMBARIUM_ACCESS', 'COLUMBARIUM_SOUTH'],
            ['WEST_SERVICE', 'CHAPEL_ACCESS'],
            ['CHAPEL_ACCESS', 'PARKING_SOUTH'],
            ['PARKING_SOUTH', 'PARKING_ACCESS'],
            ['COLUMBARIUM_SOUTH', 'COMFORT_ROOM_ACCESS'],
            ['COMFORT_ROOM_ACCESS', 'EAST_SERVICE']
        ]
    };

    // Batch 6: Wayfinding & Route Calculation DOM Elements
    let mapRouteInfoCard, routeInfoTitle, btnCloseRoute, routeStartLabel, routeDestLabel;
    let routeMetricDistance, routeMetricVia, routeWaypointsList, btnClearRoute, btnFitRoute;
    let btnGetDirectionsLot, btnGetDirectionsHud;
    // Batch 7: Route Guidance & Waypoint Navigation DOM Elements
    let routeStepProgress, routeStepNavBar, btnPrevStep, routeStepCounter, btnNextStep;

    // DOM Elements
    let cemeterySelector;
    let mapBreadcrumbs, bcCemetery, bcCemeteryName, bcSection, bcSectionName, bcBlock, bcBlockName, bcLot, bcLotName;
    let statSections, statBlocks, statLots, statFacilityActive;
    let viewLevelBadge, viewLevelText, btnBackToOverview, btnBackText, btnBackIcon, filterMatchesBadge;
    let btnZoomIn, btnZoomOut, btnResetZoom;
    let svgStageContainer, cemeteryMapSvg, mapTransformLayer;
    let mapGroundLayer, mapBoundaryLayer, mapRoadLayer, mapLandmarkLayer;
    let mapSectionLayer, mapBlockLayer, mapLotLayer, mapRouteLayer, mapSelectionLayer;
    let mapLoadingOverlay, loadingText, mapEmptyOverlay, emptyIcon, emptyTitle, emptyDesc, btnRetryMap;
    let svgFloatingTooltip;
    let lotDetailsDrawer, btnCloseDrawer, drawerLotNumber, drawerStatusDot, drawerStatusText;
    let drawerFacilityName, drawerSectionName, drawerBlockName, drawerLotType, drawerDimensions, drawerPrice;
    let drawerElevationRow, drawerElevationPlacement;
    let drawerNotesRow, drawerLocationNotes, btnBookThisLot, btnLotUnavailable;
    let mapLocationSummaryCard, locSummarySection, locSummaryBlock, locSummaryLot, btnCenterOnMapHud, btnCloseLocationSummary;
    let drawerYouAreHereBadge, drawerTrailFacility, drawerTrailSection, drawerTrailBlock, drawerTrailLot, btnCenterOnMapDrawer;
    let btnOpenWayfindingSlip;
    // Batch 4: Selected Lot Occupancy & Decedent Information Elements
    let drawerOccupancyCard, drawerOccupancyBadge, drawerOccupancyLoading, drawerOccupancyError, btnRetryOccupancy;
    let drawerOccupancyBody, drawerOccupancyDesc, drawerDecedentDetails, drawerOccupantName;
    let drawerDobRow, drawerOccupantDob, drawerDodRow, drawerOccupantDod, drawerBurialRow, drawerOccupantBurialDate;
    let drawerDispositionRow, drawerOccupantDisposition, drawerOccupancyEmpty;

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

    // Batch 10B: Actual Lot Appearance & Perspective Rendering Showcase Elements
    let drawerArchetypeViewModes, btnModePerspective, btnModeBlueprint, btnModeMaterials;
    let drawerMaterialsCard, drawerMatSurface, drawerMatStructure, drawerMatDrainage;
    let lightboxArchetypeViewModes, lightboxMaterialVal;
    let activeArchetypeViewMode = 'perspective';

    // Batch 10C: Spatial Proximity, Terrain Elevation & Accessibility Elements
    let drawerAccessibilityCard, drawerPwdBadge, drawerWalkingDist, drawerTerrainElev, drawerParkingDist, drawerPathwayCond;
    let slipTableWalking, slipTableElevation;

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

    // Batch 11: Today's Services & Funeral Cortège DOM Elements
    let btnToggleTodayServices, todayServicesCountBadge;
    let todayServicesPanel, btnCloseTodayServices, todayServicesLoading, todayServicesError, btnRetryTodayServices;
    let todayServicesEmpty, todayServicesList;
    let drawerTodayServiceBanner, drawerServiceTime, drawerServiceDeceased, drawerServiceType, btnDrawerServiceRoute;

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
        btnBackText = document.getElementById('btnBackText');
        btnBackIcon = document.getElementById('btnBackIcon');
        filterMatchesBadge = document.getElementById('filterMatchesBadge');

        btnZoomIn = document.getElementById('btnZoomIn');
        btnZoomOut = document.getElementById('btnZoomOut');
        btnResetZoom = document.getElementById('btnResetZoom');

        svgStageContainer = document.getElementById('svgStageContainer');
        cemeteryMapSvg = document.getElementById('cemeteryMapSvg');
        mapTransformLayer = document.getElementById('mapTransformLayer');

        // Master Map Foundation SVG Layer Groups (Batch 1)
        mapGroundLayer = document.getElementById('mapGroundLayer');
        mapBoundaryLayer = document.getElementById('mapBoundaryLayer');
        mapRoadLayer = document.getElementById('mapRoadLayer');
        mapLandmarkLayer = document.getElementById('mapLandmarkLayer');
        mapSectionLayer = document.getElementById('mapSectionLayer');
        mapBlockLayer = document.getElementById('mapBlockLayer');
        mapLotLayer = document.getElementById('mapLotLayer');
        mapRouteLayer = document.getElementById('mapRouteLayer');
        mapSelectionLayer = document.getElementById('mapSelectionLayer');

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

        // Batch 4: Occupancy & Decedent Information Elements
        drawerOccupancyCard = document.getElementById('drawerOccupancyCard');
        drawerOccupancyBadge = document.getElementById('drawerOccupancyBadge');
        drawerOccupancyLoading = document.getElementById('drawerOccupancyLoading');
        drawerOccupancyError = document.getElementById('drawerOccupancyError');
        btnRetryOccupancy = document.getElementById('btnRetryOccupancy');
        drawerOccupancyBody = document.getElementById('drawerOccupancyBody');
        drawerOccupancyDesc = document.getElementById('drawerOccupancyDesc');
        drawerDecedentDetails = document.getElementById('drawerDecedentDetails');
        drawerOccupantName = document.getElementById('drawerOccupantName');
        drawerDobRow = document.getElementById('drawerDobRow');
        drawerOccupantDob = document.getElementById('drawerOccupantDob');
        drawerDodRow = document.getElementById('drawerDodRow');
        drawerOccupantDod = document.getElementById('drawerOccupantDod');
        drawerBurialRow = document.getElementById('drawerBurialRow');
        drawerOccupantBurialDate = document.getElementById('drawerOccupantBurialDate');
        drawerDispositionRow = document.getElementById('drawerDispositionRow');
        drawerOccupantDisposition = document.getElementById('drawerOccupantDisposition');
        drawerOccupancyEmpty = document.getElementById('drawerOccupancyEmpty');

        // Batch 6: On-Map Location Summary HUD Elements
        mapLocationSummaryCard = document.getElementById('mapLocationSummaryCard');
        locSummarySection = document.getElementById('locSummarySection');
        locSummaryBlock = document.getElementById('locSummaryBlock');
        locSummaryLot = document.getElementById('locSummaryLot');
        btnCenterOnMapHud = document.getElementById('btnCenterOnMapHud');
        btnCloseLocationSummary = document.getElementById('btnCloseLocationSummary');

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

        // Batch 10B: Actual Lot Appearance & Perspective View Elements
        drawerArchetypeViewModes = document.getElementById('drawerArchetypeViewModes');
        btnModePerspective = document.getElementById('btnModePerspective');
        btnModeBlueprint = document.getElementById('btnModeBlueprint');
        btnModeMaterials = document.getElementById('btnModeMaterials');
        drawerMaterialsCard = document.getElementById('drawerMaterialsCard');
        drawerMatSurface = document.getElementById('drawerMatSurface');
        drawerMatStructure = document.getElementById('drawerMatStructure');
        drawerMatDrainage = document.getElementById('drawerMatDrainage');
        lightboxArchetypeViewModes = document.getElementById('lightboxArchetypeViewModes');
        lightboxMaterialVal = document.getElementById('lightboxMaterialVal');

        // Batch 10C: Spatial Proximity, Terrain Elevation & Accessibility Elements
        drawerAccessibilityCard = document.getElementById('drawerAccessibilityCard');
        drawerPwdBadge = document.getElementById('drawerPwdBadge');
        drawerWalkingDist = document.getElementById('drawerWalkingDist');
        drawerTerrainElev = document.getElementById('drawerTerrainElev');
        drawerParkingDist = document.getElementById('drawerParkingDist');
        drawerPathwayCond = document.getElementById('drawerPathwayCond');
        slipTableWalking = document.getElementById('slipTableWalking');
        slipTableElevation = document.getElementById('slipTableElevation');

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

        // Batch 6: Wayfinding & Route Calculation DOM Elements
        mapRouteInfoCard = document.getElementById('mapRouteInfoCard');
        routeInfoTitle = document.getElementById('routeInfoTitle');
        btnCloseRoute = document.getElementById('btnCloseRoute');
        routeStartLabel = document.getElementById('routeStartLabel');
        routeDestLabel = document.getElementById('routeDestLabel');
        routeMetricDistance = document.getElementById('routeMetricDistance');
        routeMetricVia = document.getElementById('routeMetricVia');
        routeWaypointsList = document.getElementById('routeWaypointsList');
        btnClearRoute = document.getElementById('btnClearRoute');
        btnFitRoute = document.getElementById('btnFitRoute');
        btnGetDirectionsLot = document.getElementById('btnGetDirectionsLot');
        btnGetDirectionsHud = document.getElementById('btnGetDirectionsHud');

        // Batch 7: Route Guidance & Waypoint Navigation DOM Elements
        routeStepProgress = document.getElementById('routeStepProgress');
        routeStepNavBar = document.getElementById('routeStepNavBar');
        btnPrevStep = document.getElementById('btnPrevStep');
        routeStepCounter = document.getElementById('routeStepCounter');
        btnNextStep = document.getElementById('btnNextStep');

        // Batch 11: Today's Services & Funeral Cortège Elements
        btnToggleTodayServices = document.getElementById('btnToggleTodayServices');
        todayServicesCountBadge = document.getElementById('todayServicesCountBadge');
        todayServicesPanel = document.getElementById('todayServicesPanel');
        btnCloseTodayServices = document.getElementById('btnCloseTodayServices');
        todayServicesLoading = document.getElementById('todayServicesLoading');
        todayServicesError = document.getElementById('todayServicesError');
        btnRetryTodayServices = document.getElementById('btnRetryTodayServices');
        todayServicesEmpty = document.getElementById('todayServicesEmpty');
        todayServicesList = document.getElementById('todayServicesList');

        drawerTodayServiceBanner = document.getElementById('drawerTodayServiceBanner');
        drawerServiceTime = document.getElementById('drawerServiceTime');
        drawerServiceDeceased = document.getElementById('drawerServiceDeceased');
        drawerServiceType = document.getElementById('drawerServiceType');
        btnDrawerServiceRoute = document.getElementById('btnDrawerServiceRoute');
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

        // Breadcrumb navigation (Batch 8 enhanced hierarchy navigation)
        bcCemetery.addEventListener('click', () => {
            if (state.mapViewLevel !== 'overview') {
                returnToCemeteryOverview();
            }
        });
        bcCemetery.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                returnToCemeteryOverview();
            }
        });

        if (bcSection) {
            bcSection.addEventListener('click', () => {
                if (state.currentSection && state.mapViewLevel !== 'section') {
                    focusOnSection(state.currentSection);
                }
            });
            bcSection.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (state.currentSection) focusOnSection(state.currentSection);
                }
            });
        }

        if (bcBlock) {
            bcBlock.addEventListener('click', () => {
                if (state.currentBlock && state.mapViewLevel !== 'block') {
                    focusOnBlock(state.currentBlock, state.currentSection);
                }
            });
            bcBlock.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    if (state.currentBlock) focusOnBlock(state.currentBlock, state.currentSection);
                }
            });
        }

        if (btnBackToOverview) {
            btnBackToOverview.addEventListener('click', () => {
                navigateUpOneLevel();
            });
        }

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
        if (btnCloseLocationSummary) {
            btnCloseLocationSummary.addEventListener('click', () => {
                if (mapLocationSummaryCard) {
                    mapLocationSummaryCard.style.display = 'none';
                }
            });
        }

        // Batch 6: Wayfinding & Route to Lot Handlers
        if (btnGetDirectionsLot) {
            btnGetDirectionsLot.addEventListener('click', () => {
                if (state.selectedLot) {
                    generateRouteToLot(state.selectedLot, state.currentBlock, state.currentSection, true);
                }
            });
        }
        if (btnGetDirectionsHud) {
            btnGetDirectionsHud.addEventListener('click', () => {
                if (state.selectedLot) {
                    generateRouteToLot(state.selectedLot, state.currentBlock, state.currentSection, true);
                }
            });
        }
        if (btnClearRoute) {
            btnClearRoute.addEventListener('click', clearRoute);
        }
        if (btnCloseRoute) {
            btnCloseRoute.addEventListener('click', clearRoute);
        }
        if (btnFitRoute) {
            btnFitRoute.addEventListener('click', () => {
                if (state.activeRoute && state.activeRoute.points) {
                    fitRouteToViewport(state.activeRoute.points);
                }
            });
        }
        // Batch 7: Step-by-Step Navigation Controls
        if (btnPrevStep) {
            btnPrevStep.addEventListener('click', () => {
                if (state.activeRoute && typeof state.activeRoute.activeStepIndex === 'number') {
                    setActiveRouteStep(state.activeRoute.activeStepIndex - 1, true);
                }
            });
        }
        if (btnNextStep) {
            btnNextStep.addEventListener('click', () => {
                if (state.activeRoute && typeof state.activeRoute.activeStepIndex === 'number') {
                    setActiveRouteStep(state.activeRoute.activeStepIndex + 1, true);
                }
            });
        }

        // Batch 4: Retry Occupancy Details Fetching
        if (btnRetryOccupancy) {
            btnRetryOccupancy.addEventListener('click', (e) => {
                e.stopPropagation();
                if (state.selectedLot) {
                    loadOccupancyDetails(state.selectedLot, state.currentBlock);
                }
            });
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

        // Batch 10B: Archetype View Mode Switcher Listeners
        [btnModePerspective, btnModeBlueprint, btnModeMaterials].forEach(btn => {
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const mode = btn.getAttribute('data-mode') || 'perspective';
                    setArchetypeViewMode(mode);
                });
            }
        });

        const lightboxModeBtns = document.querySelectorAll('#lightboxArchetypeViewModes .btn-archetype-mode');
        lightboxModeBtns.forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const mode = btn.getAttribute('data-mode') || 'perspective';
                setArchetypeViewMode(mode);
            });
        });

        // Close slip, lightbox, route, drawer, location summary, or today's services panel on ESC key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (archetypeLightboxModal && archetypeLightboxModal.style.display !== 'none') {
                    closeArchetypeLightbox();
                } else if (wayfindingSlipModal && wayfindingSlipModal.style.display !== 'none') {
                    closeWayfindingSlip();
                } else if (state.isTodayServicesOpen) {
                    toggleTodayServices(false);
                } else if (state.activeMapView === 'geo') {
                    switchMapView('plot');
                } else if (state.activeRoute) {
                    clearRoute();
                } else if (lotDetailsDrawer && lotDetailsDrawer.classList.contains('is-open')) {
                    closeLotDrawer();
                } else if (mapLocationSummaryCard && mapLocationSummaryCard.style.display !== 'none') {
                    mapLocationSummaryCard.style.display = 'none';
                }
            }
        });

        // Batch 11: Today's Services Panel Toggle & Controls
        if (btnToggleTodayServices) {
            btnToggleTodayServices.addEventListener('click', () => {
                toggleTodayServices();
            });
        }
        if (btnCloseTodayServices) {
            btnCloseTodayServices.addEventListener('click', () => {
                toggleTodayServices(false);
            });
        }
        if (btnRetryTodayServices) {
            btnRetryTodayServices.addEventListener('click', () => {
                if (state.currentCemeteryId) {
                    loadTodayServices(state.currentCemeteryId);
                }
            });
        }

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

        // Search & Filter Listeners (Batch 5 Global Cemetery Search)
        let searchDebounceTimer = null;

        btnMapSearch.addEventListener('click', () => {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            executeSearch(true, true);
        });

        mapSearchInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
                executeSearch(true, true);
            } else if (e.key === 'Escape') {
                hideSearchResultsDropdown();
            } else if (e.key === 'ArrowDown') {
                if (searchResultsDropdown && searchResultsDropdown.style.display !== 'none') {
                    const firstResult = searchResultsDropdown.querySelector('.search-result-item');
                    if (firstResult) {
                        e.preventDefault();
                        firstResult.focus();
                    }
                }
            }
        });

        mapSearchInput.addEventListener('input', () => {
            const val = mapSearchInput.value.trim();
            btnClearSearch.style.display = val !== '' ? 'flex' : 'none';
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);

            if (val === '') {
                state.filters.search = '';
                hideSearchResultsDropdown();
                document.querySelectorAll('.svg-lot-tile.is-matched').forEach(el => el.classList.remove('is-matched'));
                document.querySelectorAll('.svg-section-card.is-matched').forEach(el => el.classList.remove('is-matched'));
                document.querySelectorAll('.svg-block-card.is-matched').forEach(el => el.classList.remove('is-matched'));
                applyFilters();
            } else {
                searchDebounceTimer = setTimeout(() => {
                    executeSearch(false, false);
                }, 220);
            }
        });

        btnClearSearch.addEventListener('click', () => {
            if (searchDebounceTimer) clearTimeout(searchDebounceTimer);
            mapSearchInput.value = '';
            btnClearSearch.style.display = 'none';
            state.filters.search = '';
            hideSearchResultsDropdown();
            document.querySelectorAll('.svg-lot-tile.is-matched').forEach(el => el.classList.remove('is-matched'));
            document.querySelectorAll('.svg-section-card.is-matched').forEach(el => el.classList.remove('is-matched'));
            document.querySelectorAll('.svg-block-card.is-matched').forEach(el => el.classList.remove('is-matched'));
            clearRoute();
            closeLotDrawer();
            if (mapLocationSummaryCard) {
                mapLocationSummaryCard.style.display = 'none';
            }
            applyFilters();
            mapSearchInput.focus();
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
        return 'â‚±' + num.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
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

        // Case 5: If block_id is not provided, stop at cemetery overview (or resolve direct lot_id if supplied)
        if (rawBlkId === null) {
            if (rawLotId !== null) {
                const directLotId = parsePositiveInt(rawLotId);
                if (directLotId !== -1) {
                    const secs = state.currentLayout?.sections || [];
                    for (const s of secs) {
                        for (const b of (s.blocks || [])) {
                            const cached = state.blockLotsCache[b.block_id];
                            if (cached) {
                                const targetLot = cached.find(l => l.lot_id === directLotId);
                                if (targetLot) {
                                    resetAllFilters(false);
                                    await navigateAndSelectLot(targetLot, b, s);
                                    return;
                                }
                            }
                        }
                    }
                }
            }
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

        // Batch 11: Clear Today's Services on cemetery switch
        state.todayServices = [];
        state.activeCortegeService = null;
        state.selectedTodayServiceId = null;
        if (todayServicesCountBadge) {
            todayServicesCountBadge.style.display = 'none';
        }

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

                // Batch 3: Preload all block lots in parallel for unified master map representation
                const allBlocks = [];
                sections.forEach(s => {
                    (s.blocks || []).forEach(b => {
                        allBlocks.push({ block: b, section: s });
                    });
                });

                if (allBlocks.length > 0) {
                    await Promise.all(allBlocks.map(async ({ block }) => {
                        if (!state.blockLotsCache[block.block_id]) {
                            try {
                                const bRes = await api.request(`map/blocks/${block.block_id}/lots`, { method: 'GET' });
                                if (bRes && bRes.success && bRes.data && bRes.data.lots) {
                                    state.blockLotsCache[block.block_id] = bRes.data.lots;
                                }
                            } catch (e) {
                                console.warn(`Could not preload lots for block ${block.block_id}:`, e);
                            }
                        }
                    }));
                }

                mapEmptyOverlay.style.display = 'none';
                renderCemeteryOverview(res.data);

                // Batch 11: Load and highlight today's scheduled services
                loadTodayServices(cemeteryId, true);
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
     * Ensure the 9 master map SVG layer groups exist inside mapTransformLayer
     */
    function ensureSvgLayers() {
        if (!mapTransformLayer) return;

        const layerIds = [
            'mapGroundLayer',
            'mapBoundaryLayer',
            'mapRoadLayer',
            'mapLandmarkLayer',
            'mapSectionLayer',
            'mapBlockLayer',
            'mapLotLayer',
            'mapRouteLayer',
            'mapSelectionLayer'
        ];

        layerIds.forEach(id => {
            let el = document.getElementById(id);
            if (!el || !mapTransformLayer.contains(el)) {
                el = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                el.setAttribute('id', id);
                el.setAttribute('class', 'map-layer');
                mapTransformLayer.appendChild(el);
            }
        });

        // Re-cache references
        mapGroundLayer = document.getElementById('mapGroundLayer');
        mapBoundaryLayer = document.getElementById('mapBoundaryLayer');
        mapRoadLayer = document.getElementById('mapRoadLayer');
        mapLandmarkLayer = document.getElementById('mapLandmarkLayer');
        mapSectionLayer = document.getElementById('mapSectionLayer');
        mapBlockLayer = document.getElementById('mapBlockLayer');
        mapLotLayer = document.getElementById('mapLotLayer');
        mapRouteLayer = document.getElementById('mapRouteLayer');
        mapSelectionLayer = document.getElementById('mapSelectionLayer');
    }

    /**
     * Clear all SVG layer contents
     */
    function clearSvgLayers() {
        ensureSvgLayers();
        if (mapGroundLayer) mapGroundLayer.innerHTML = '';
        if (mapBoundaryLayer) mapBoundaryLayer.innerHTML = '';
        if (mapRoadLayer) mapRoadLayer.innerHTML = '';
        if (mapLandmarkLayer) mapLandmarkLayer.innerHTML = '';
        if (mapSectionLayer) mapSectionLayer.innerHTML = '';
        if (mapBlockLayer) mapBlockLayer.innerHTML = '';
        if (mapLotLayer) mapLotLayer.innerHTML = '';
        if (mapRouteLayer) mapRouteLayer.innerHTML = '';
        if (mapSelectionLayer) mapSelectionLayer.innerHTML = '';
    }

    /**
     * Ensure SVG patterns, gradients and filters needed for master plan are defined
     */
    function ensureMasterPlanDefs() {
        const svg = document.getElementById('cemeteryMapSvg');
        if (!svg) return;
        let defs = svg.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            svg.insertBefore(defs, svg.firstChild);
        }
        if (!document.getElementById('mpGrassSpeckle')) {
            const g = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
            g.setAttribute('id', 'mpGrassSpeckle');
            g.setAttribute('width', '24');
            g.setAttribute('height', '24');
            g.setAttribute('patternUnits', 'userSpaceOnUse');
            g.innerHTML = '<circle cx="4" cy="4" r="0.8" fill="rgba(0,0,0,0.04)"/><circle cx="16" cy="12" r="0.8" fill="rgba(255,255,255,0.06)"/><circle cx="10" cy="20" r="0.7" fill="rgba(0,0,0,0.03)"/>';
            defs.appendChild(g);
        }
        if (!document.getElementById('mpPaverPattern')) {
            const p = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
            p.setAttribute('id', 'mpPaverPattern');
            p.setAttribute('width', '10');
            p.setAttribute('height', '10');
            p.setAttribute('patternUnits', 'userSpaceOnUse');
            p.innerHTML = '<path d="M 0 5 L 10 5 M 5 0 L 5 10" stroke="rgba(0,0,0,0.09)" stroke-width="0.75" fill="none"/>';
            defs.appendChild(p);
        }
        if (!document.getElementById('mpLawnStripes')) {
            const l = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
            l.setAttribute('id', 'mpLawnStripes');
            l.setAttribute('width', '24');
            l.setAttribute('height', '24');
            l.setAttribute('patternTransform', 'rotate(45)');
            l.setAttribute('patternUnits', 'userSpaceOnUse');
            l.innerHTML = '<rect width="12" height="24" fill="rgba(255,255,255,0.035)"/><rect x="12" width="12" height="24" fill="rgba(0,0,0,0.025)"/>';
            defs.appendChild(l);
        }
        if (!document.getElementById('mpMowStripes')) {
            const m = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
            m.setAttribute('id', 'mpMowStripes');
            m.setAttribute('width', '6');
            m.setAttribute('height', '6');
            m.setAttribute('patternUnits', 'userSpaceOnUse');
            m.innerHTML = '<rect width="3" height="6" fill="rgba(255,255,255,0.03)"/><rect x="3" width="3" height="6" fill="rgba(0,0,0,0.02)"/>';
            defs.appendChild(m);
        }
        if (!document.getElementById('routeArrowMarker')) {
            const marker = document.createElementNS('http://www.w3.org/2000/svg', 'marker');
            marker.setAttribute('id', 'routeArrowMarker');
            marker.setAttribute('viewBox', '0 0 10 10');
            marker.setAttribute('refX', '6');
            marker.setAttribute('refY', '5');
            marker.setAttribute('markerWidth', '6');
            marker.setAttribute('markerHeight', '6');
            marker.setAttribute('orient', 'auto-start-reverse');
            marker.innerHTML = '<path d="M 0 1.5 L 8 5 L 0 8.5 z" fill="#0284c7" class="route-arrow-marker" />';
            defs.appendChild(marker);
        }
        if (!document.getElementById('cemeteryParcelClip')) {
            const cp = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            cp.setAttribute('id', 'cemeteryParcelClip');
            cp.innerHTML = '<polygon points="1168.9,900.0 956.7,863.5 952.1,610.6 1001.0,608.1 963.7,432.3 637.0,531.8 617.6,493.5 576.8,444.4 689.6,282.2 766.2,264.0 808.5,194.0 864.5,162.8 975.8,147.7 1022.1,146.6 1022.7,403.1 1033.7,400.5 1052.4,491.2 1058.9,697.8 1102.3,690.7"/>';
            defs.appendChild(cp);
        }
    }

    /**
     * Render Cemetery Overview SVG (Sections & Blocks)
     */
    function renderCemeteryOverview(layoutData) {
        state.viewLevel = 'cemetery';
        updateBreadcrumbs();
        updateViewLevelIndicator();
        resetView();

        ensureSvgLayers();
        clearSvgLayers();

        const sections = layoutData.sections || [];
        const canvasW = state.baseViewBox.width;
        const canvasH = state.baseViewBox.height;
// =====================================================================
// CONTINUOUS GEOGRAPHIC CEMETERY MASTER PLAN
// Road-first geometry: Road network carves the continuous site into
// geographic land parcels. Pathways carve parcels into block terraces.
// Realistic burial plots with headstones sit naturally on lawn grass.
// No dashboard cards, no box-inside-box.
// =====================================================================

const SVG_NS = 'http://www.w3.org/2000/svg';
const mk = (tag, attrs, parent) => {
    const el = document.createElementNS(SVG_NS, tag);
    if (attrs) Object.keys(attrs).forEach(k => el.setAttribute(k, attrs[k]));
    if (parent) parent.appendChild(el);
    return el;
};
const f1 = (n) => Math.round(n * 10) / 10;

ensureMasterPlanDefs();

// Deterministic landscaping generator
let mpSeed = 4242;
const rnd = () => { mpSeed = (mpSeed * 9301 + 49297) % 233280; return mpSeed / 233280; };

const TREE_PALETTES = [
    ['#23471e', '#3b702f', '#73b054'],
    ['#2c5324', '#4b8538', '#8ec46b'],
    ['#1d3b19', '#326127', '#649e47'],
    ['#315a28', '#559441', '#9dd17b']
];

const treeSvg = (cx, cy, r, v = 0) => {
    const p = TREE_PALETTES[Math.abs(v) % TREE_PALETTES.length];
    return `<circle cx="${f1(cx + r * 0.28)}" cy="${f1(cy + r * 0.35)}" r="${f1(r)}" class="mp-tree-shadow"/>` +
        `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="${p[0]}"/>` +
        `<circle cx="${f1(cx - r * 0.14)}" cy="${f1(cy - r * 0.14)}" r="${f1(r * 0.72)}" fill="${p[1]}"/>` +
        `<circle cx="${f1(cx - r * 0.3)}" cy="${f1(cy - r * 0.3)}" r="${f1(r * 0.36)}" fill="${p[2]}"/>`;
};

const shrubSvg = (cx, cy, r) =>
    `<circle cx="${f1(cx)}" cy="${f1(cy)}" r="${f1(r)}" fill="#386b2b"/>` +
    `<circle cx="${f1(cx - r * 0.25)}" cy="${f1(cy - r * 0.25)}" r="${f1(r * 0.5)}" fill="#7bb554"/>`;

const treeLine = (x1, y1, x2, y2, step, rMin, rMax, jitter = 1.2) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.floor(len / step));
    let out = '';
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const x = x1 + (x2 - x1) * t + (rnd() - 0.5) * jitter * 2;
        const y = y1 + (y2 - y1) * t + (rnd() - 0.5) * jitter * 2;
        out += treeSvg(x, y, rMin + rnd() * (rMax - rMin), Math.floor(rnd() * 4));
    }
    return out;
};

const shrubLine = (x1, y1, x2, y2, step, r) => {
    const len = Math.hypot(x2 - x1, y2 - y1);
    const n = Math.max(1, Math.floor(len / step));
    let out = '';
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        out += shrubSvg(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, r * (0.85 + rnd() * 0.3));
    }
    return out;
};

const treeCluster = (cx, cy, count, spread, rMin, rMax) => {
    let out = '';
    for (let i = 0; i < count; i++) {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * spread;
        out += treeSvg(cx + Math.cos(a) * d, cy + Math.sin(a) * d, rMin + rnd() * (rMax - rMin), Math.floor(rnd() * 4));
    }
    return out;
};

// Floating map label pill (reference style)
const pillSvg = (cx, cy, text, icon, variant) => {
    const w = Math.round(text.length * 6.2 + (icon ? 30 : 20));
    const x = cx - w / 2;
    return `<g class="mp-pill mp-pill--${variant}">` +
        `<rect x="${f1(x)}" y="${f1(cy - 11)}" width="${w}" height="22" rx="6" class="mp-pill-bg"/>` +
        (icon ? `<text x="${f1(x + 12)}" y="${f1(cy + 3.6)}" class="mp-pill-icon">${icon}</text>` : '') +
        `<text x="${f1(cx + (icon ? 7 : 0))}" y="${f1(cy + 3.4)}" class="mp-pill-text">${text}</text>` +
        `</g>`;
};

// Verified OSM Relation 16828676 Site Perimeter Coordinates (Batch 13)
// 19 Unique Perimeter Vertices projected into 1600x1000 Canvas at 3.4937 px/m
const CEMETERY_POLYGON_POINTS = "1168.9,900.0 956.7,863.5 952.1,610.6 1001.0,608.1 963.7,432.3 637.0,531.8 617.6,493.5 576.8,444.4 689.6,282.2 766.2,264.0 808.5,194.0 864.5,162.8 975.8,147.7 1022.1,146.6 1022.7,403.1 1033.7,400.5 1052.4,491.2 1058.9,697.8 1102.3,690.7";
const CEMETERY_INNER_POLYGON_POINTS = "1163.8,895.6 960.1,860.5 955.7,613.9 1005.3,611.4 966.3,427.8 638.8,527.6 620.5,491.6 581.2,444.2 691.8,285.3 768.4,267.1 811.1,196.6 865.6,166.1 976.0,151.2 1018.6,150.2 1019.2,407.5 1031.0,404.8 1048.9,491.6 1055.5,701.9 1099.8,694.7";

// =========================================================================
// BATCH 15: VERIFIED PHYSICAL FACILITY STRUCTURES & OPERATIONAL LANDMARK ANCHORS
// 15 Mapped Roofed Structures projected into 1600x1000 Canvas at 3.4937 px/m
// Operational landmark positions are calibrated anchors subject to client confirmation.
// =========================================================================
const FACILITY_STRUCTURES = [
    // Central Spine Structures
    { id: 'bldg-927998601', wayId: 927998601, points: '776.2,365.4 790.5,364.9 791.3,385.0 776.8,385.8', cx: 783.7, cy: 375.3 },
    { id: 'bldg-927998602', wayId: 927998602, points: '774.0,373.8 788.3,373.4 789.1,393.4 774.5,394.2', cx: 781.5, cy: 383.7 },
    // North-Central Pavilion Row 1 (West Column)
    { id: 'bldg-930065359', wayId: 930065359, points: '861.0,203.5 828.5,202.9 828.1,225.3 862.0,223.7', cx: 844.9, cy: 213.8 },
    { id: 'bldg-930065360', wayId: 930065360, points: '859.5,230.5 826.9,230.0 826.6,252.3 860.4,250.7', cx: 843.4, cy: 240.9 },
    { id: 'bldg-930065361', wayId: 930065361, points: '857.4,262.3 824.8,261.8 824.5,284.1 858.3,282.6', cx: 841.2, cy: 272.7 },
    { id: 'bldg-930065362', wayId: 930065362, points: '857.4,292.5 824.8,291.9 824.5,314.2 858.3,312.6', cx: 841.2, cy: 302.8 },
    // North-Central Pavilion Row 2 (Mid Column)
    { id: 'bldg-930065364', wayId: 930065364, points: '899.4,231.0 866.8,230.4 866.5,252.7 900.3,251.2', cx: 883.2, cy: 241.3 },
    { id: 'bldg-930065363', wayId: 930065363, points: '901.9,263.6 869.3,263.0 869.0,285.4 902.9,283.8', cx: 885.8, cy: 273.9 },
    { id: 'bldg-930065367', wayId: 930065367, points: '903.2,289.5 870.6,288.9 870.3,311.2 904.1,309.7', cx: 887.0, cy: 299.8 },
    // Central Court Structures
    { id: 'bldg-930065369', wayId: 930065369, points: '866.2,349.0 843.7,349.7 851.0,374.1 869.6,373.4', cx: 857.6, cy: 361.6 },
    { id: 'bldg-930065370', wayId: 930065370, points: '896.4,346.9 873.8,347.6 881.2,372.0 899.7,371.3', cx: 887.8, cy: 359.4 },
    // Eastern Structures & Terraces
    { id: 'bldg-930065365', wayId: 930065365, points: '936.7,243.8 927.3,243.7 927.2,250.1 937.0,249.7', cx: 932.0, cy: 246.8 },
    { id: 'bldg-930065366', wayId: 930065366, points: '949.4,262.3 933.2,261.8 935.2,276.2 947.5,276.9 952.5,277.0', cx: 943.6, cy: 270.8 },
    { id: 'bldg-930065368', wayId: 930065368, points: '947.5,276.9 933.5,282.0 932.3,302.0 950.9,301.4', cx: 941.0, cy: 290.6 },
    { id: 'bldg-930065371', wayId: 930065371, points: '994.8,255.7 956.2,255.9 965.6,285.5 996.5,284.8', cx: 978.3, cy: 270.5 }
];

const FACILITY_ANCHORS = {
    gate: {
        id: 'gate',
        landmark: 'gate',
        x: 1096,
        y: 881,
        label: 'Main Gate (Gate 1)',
        accessNode: 'MAIN_GATE',
        description: 'Verified Primary Entrance along P. Aquino Avenue (OSM Node 8348620486 / 9928981748)'
    },
    parking: {
        id: 'parking',
        landmark: 'parking',
        x: 1035,
        y: 755,
        label: 'Visitor Parking Zone',
        accessNode: 'PARKING_ACCESS',
        description: 'Operational Landmark: Calibrated Visitor Parking & Circulation Zone'
    },
    admin: {
        id: 'admin',
        landmark: 'admin',
        x: 782,
        y: 380,
        label: 'Administration Office',
        accessNode: 'ADMIN_ACCESS',
        structureWayId: 927998601,
        description: 'Operational Landmark: Calibrated Administration Office Anchor (Mapped Structure Way 927998601/927998602)'
    },
    chapel: {
        id: 'chapel',
        landmark: 'chapel',
        x: 858,
        y: 362,
        label: 'Memorial Chapel',
        accessNode: 'CHAPEL_ACCESS',
        structureWayId: 930065369,
        description: 'Operational Landmark: Calibrated Memorial Chapel Anchor (Mapped Structure Way 930065369)'
    },
    crematorium: {
        id: 'crematorium',
        landmark: 'crematorium',
        x: 978,
        y: 271,
        label: 'Crematorium Facility',
        accessNode: 'CREMATORIUM_ACCESS',
        structureWayId: 930065371,
        description: 'Operational Landmark: Calibrated Crematorium Anchor (Mapped Structure Way 930065371)'
    },
    columbarium: {
        id: 'columbarium',
        landmark: 'columbarium',
        x: 886,
        y: 274,
        label: 'Columbarium & Ossuary',
        accessNode: 'COLUMBARIUM_ACCESS',
        structureWayId: 930065363,
        description: 'Operational Landmark: Calibrated Columbarium Pavilion Anchor (Mapped Structure Pavilion Cluster)'
    },
    restroom: {
        id: 'restroom',
        landmark: 'restroom',
        x: 932,
        y: 247,
        label: 'Comfort Room (CR)',
        accessNode: 'COMFORT_ROOM_ACCESS',
        structureWayId: 930065365,
        description: 'Operational Landmark: Public Restroom Facility Anchor (Mapped Structure Way 930065365)'
    }
};

// Road Network Reference Coordinates
const RD = {
    west: 95,
    east: 1505,
    spine: 800,
    north: 80,
    promenade: 300,
    mainCross: 545,
    southService: 865,
    accW: 515,
    accE: 1085
};

// ==========================================
// LAYER 0: Canvas Background, Surrounding Context & Continuous Property Lawn
// ==========================================
mk('rect', { x: 300, y: 0, width: 1100, height: 1100, class: 'mp-surround' }, mapGroundLayer);

// Surrounding Geographic Context (Matching Google Maps Neighborhood: Tonsuya, Malabon & Adjacent Park)
const surroundingContext = mk('g', { class: 'mp-surrounding-context', 'aria-hidden': 'true' }, mapGroundLayer);
surroundingContext.innerHTML = `
    <!-- West Urban Context (Barangay Tonsuya, Delos Santos, Rosal St.) -->
    <text x="510" y="470" class="mp-context-label" style="font-size: 8px;">BARANGAY TONSUYA</text>
    <text x="510" y="484" class="mp-context-sublabel" style="font-size: 6.8px;">Residential Area • Rosal St.</text>

    <!-- East Urban Context (Our Lady of Lourdes Eternal Park) -->
    <text x="1210" y="470" class="mp-context-label" style="font-size: 8px;">OUR LADY OF LOURDES</text>
    <text x="1210" y="484" class="mp-context-sublabel" style="font-size: 6.8px;">Adjacent Memorial Park</text>
`;

// P. Aquino Avenue (Letre Road) Frontage along southern edge (Bearing ~99.5° WNW to ESE)
// Aligned to verified frontage edge P01(956.7, 863.5) -> P00(1168.9, 900.0) [Bearing 99.8°]
const frontage = mk('g', { class: 'svg-external-road-group mp-frontage' }, mapGroundLayer);
let crosswalkBars = '';
// Pedestrian zebra crossing across P. Aquino Ave near the Main Gate
for (let cx = 1076; cx <= 1120; cx += 8) {
    const cy = 948 + (cx - 1096) * 0.172;
    crosswalkBars += `<rect x="${cx}" y="${f1(cy)}" width="5" height="34" transform="rotate(9.8 ${cx} ${f1(cy)})" class="mp-crosswalk"/>`;
}
frontage.innerHTML = `
    <!-- P. Aquino Avenue Sidewalks & Roadbed aligned to 99.5 deg bearing -->
    <polygon points="350,962 1450,1154 1450,1166 350,974" class="mp-sidewalk"/>
    <polygon points="350,972 1450,1164 1450,1230 350,1038" class="mp-ext-road"/>
    <line x1="350" y1="973.5" x2="1450" y2="1165.5" class="mp-ext-edge"/>
    <line x1="350" y1="1036.5" x2="1450" y2="1228.5" class="mp-ext-edge"/>
    <line x1="350" y1="1005.0" x2="1450" y2="1197.0" class="mp-ext-centerline"/>
    ${crosswalkBars}
    <polygon points="350,1038 1450,1230 1450,1242 350,1050" class="mp-sidewalk"/>
    <text x="620" y="995" transform="rotate(9.8 620 995)" class="mp-ext-lane-label">◂  WESTBOUND (TONSUYA / LETRE)</text>
    <text x="1240" y="1105" transform="rotate(9.8 1240 1105)" class="mp-ext-lane-label">EASTBOUND (MALABON / C-4)  ▸</text>
    ${pillSvg(1096, 960, '⟵   P. AQUINO AVENUE (LETRE ROAD)   ⟶', '', 'road')}
`;

// North Boundary Caption
const northLabel = mk('text', { x: 890, y: 132, class: 'mp-north-label' }, mapGroundLayer);
northLabel.textContent = 'NORTH BOUNDARY (MALABON/TONSUYA)';

// One Continuous Verified Cemetery Property Lawn (19-Vertex Polygon, OSM Relation 16828676)
mk('polygon', { points: CEMETERY_POLYGON_POINTS, class: 'svg-cemetery-ground mp-property' }, mapGroundLayer);
mk('polygon', { points: CEMETERY_POLYGON_POINTS, fill: 'url(#mpGrassSpeckle)', class: 'mp-texture' }, mapGroundLayer);

// ==========================================
// LAYER: Perimeter Wall with Main Gate Opening & Posts (19-Vertex Geometry)
// ==========================================
// Outer and inner boundary walls with verified opening at Main Gate (x=1078.0..1113.4, y=877.8..884.0)
const outerWallD = "M 1078.0 877.8 L 956.7 863.5 L 952.1 610.6 L 1001.0 608.1 L 963.7 432.3 L 637.0 531.8 L 617.6 493.5 L 576.8 444.4 L 689.6 282.2 L 766.2 264.0 L 808.5 194.0 L 864.5 162.8 L 975.8 147.7 L 1022.1 146.6 L 1022.7 403.1 L 1033.7 400.5 L 1052.4 491.2 L 1058.9 697.8 L 1102.3 690.7 L 1168.9 900.0 L 1113.4 884.0";
const innerWallD = "M 1078.0 874.3 L 960.1 860.5 L 955.7 613.9 L 1005.3 611.4 L 966.3 427.8 L 638.8 527.6 L 620.5 491.6 L 581.2 444.2 L 691.8 285.3 L 768.4 267.1 L 811.1 196.6 L 865.6 166.1 L 976.0 151.2 L 1018.6 150.2 L 1019.2 407.5 L 1031.0 404.8 L 1048.9 491.6 L 1055.5 701.9 L 1099.8 694.7 L 1163.8 895.6 L 1113.4 880.5";
mk('path', { d: outerWallD, class: 'mp-wall' }, mapBoundaryLayer);
mk('path', { d: innerWallD, class: 'mp-wall-inner' }, mapBoundaryLayer);

// Wall Posts placed along verified perimeter edges and flanking Main Gate portal
const postG = mk('g', { class: 'mp-wall-posts', 'aria-hidden': 'true' }, mapBoundaryLayer);
postG.innerHTML = `
    <!-- Gate Portal Flanking Wall Terminal Posts -->
    <rect x="1075.5" y="875.3" width="5" height="5" class="mp-wall-post"/>
    <rect x="1110.9" y="881.5" width="5" height="5" class="mp-wall-post"/>
    <rect x="1166.4" y="897.5" width="5" height="5" class="mp-wall-post"/>
    <rect x="1007.3" y="870.1" width="5" height="5" class="mp-wall-post"/>
    <rect x="954.2" y="861.0" width="5" height="5" class="mp-wall-post"/>
    <rect x="953.3" y="810.4" width="5" height="5" class="mp-wall-post"/>
    <rect x="952.4" y="759.8" width="5" height="5" class="mp-wall-post"/>
    <rect x="951.5" y="709.3" width="5" height="5" class="mp-wall-post"/>
    <rect x="950.6" y="658.7" width="5" height="5" class="mp-wall-post"/>
    <rect x="949.6" y="608.1" width="5" height="5" class="mp-wall-post"/>
    <rect x="974.0" y="606.8" width="5" height="5" class="mp-wall-post"/>
    <rect x="998.5" y="605.6" width="5" height="5" class="mp-wall-post"/>
    <rect x="989.2" y="561.7" width="5" height="5" class="mp-wall-post"/>
    <rect x="979.9" y="517.8" width="5" height="5" class="mp-wall-post"/>
    <rect x="970.5" y="473.8" width="5" height="5" class="mp-wall-post"/>
    <rect x="961.2" y="429.8" width="5" height="5" class="mp-wall-post"/>
    <rect x="880.8" y="454.4" width="5" height="5" class="mp-wall-post"/>
    <rect x="797.9" y="479.9" width="5" height="5" class="mp-wall-post"/>
    <rect x="717.6" y="504.6" width="5" height="5" class="mp-wall-post"/>
    <rect x="634.5" y="529.3" width="5" height="5" class="mp-wall-post"/>
    <rect x="615.1" y="491.0" width="5" height="5" class="mp-wall-post"/>
    <rect x="574.3" y="441.9" width="5" height="5" class="mp-wall-post"/>
    <rect x="602.5" y="401.4" width="5" height="5" class="mp-wall-post"/>
    <rect x="630.7" y="360.8" width="5" height="5" class="mp-wall-post"/>
    <rect x="658.9" y="320.3" width="5" height="5" class="mp-wall-post"/>
    <rect x="687.1" y="279.7" width="5" height="5" class="mp-wall-post"/>
    <rect x="725.4" y="270.6" width="5" height="5" class="mp-wall-post"/>
    <rect x="763.7" y="261.5" width="5" height="5" class="mp-wall-post"/>
    <rect x="784.8" y="226.5" width="5" height="5" class="mp-wall-post"/>
    <rect x="806.0" y="191.5" width="5" height="5" class="mp-wall-post"/>
    <rect x="834.0" y="175.9" width="5" height="5" class="mp-wall-post"/>
    <rect x="862.0" y="160.3" width="5" height="5" class="mp-wall-post"/>
    <rect x="917.6" y="152.7" width="5" height="5" class="mp-wall-post"/>
    <rect x="973.3" y="145.2" width="5" height="5" class="mp-wall-post"/>
    <rect x="1019.6" y="144.1" width="5" height="5" class="mp-wall-post"/>
    <rect x="1019.8" y="195.4" width="5" height="5" class="mp-wall-post"/>
    <rect x="1019.9" y="246.7" width="5" height="5" class="mp-wall-post"/>
    <rect x="1020.0" y="297.9" width="5" height="5" class="mp-wall-post"/>
    <rect x="1020.1" y="349.2" width="5" height="5" class="mp-wall-post"/>
    <rect x="1020.2" y="400.6" width="5" height="5" class="mp-wall-post"/>
    <rect x="1031.2" y="398.0" width="5" height="5" class="mp-wall-post"/>
    <rect x="1040.6" y="443.3" width="5" height="5" class="mp-wall-post"/>
    <rect x="1049.9" y="488.7" width="5" height="5" class="mp-wall-post"/>
    <rect x="1051.5" y="540.3" width="5" height="5" class="mp-wall-post"/>
    <rect x="1053.1" y="592.0" width="5" height="5" class="mp-wall-post"/>
    <rect x="1054.8" y="643.6" width="5" height="5" class="mp-wall-post"/>
    <rect x="1056.4" y="695.3" width="5" height="5" class="mp-wall-post"/>
    <rect x="1078.1" y="691.8" width="5" height="5" class="mp-wall-post"/>
    <rect x="1099.8" y="688.2" width="5" height="5" class="mp-wall-post"/>
    <rect x="1116.5" y="740.5" width="5" height="5" class="mp-wall-post"/>
    <rect x="1133.1" y="792.8" width="5" height="5" class="mp-wall-post"/>
    <rect x="1149.8" y="845.2" width="5" height="5" class="mp-wall-post"/>
`;

// Dense Perimeter Tree Buffer (lining the inside of the verified 19-vertex wall)
const perimeterTrees = mk('g', { class: 'svg-landscaping-group mp-trees', 'aria-hidden': 'true' }, mapBoundaryLayer);
perimeterTrees.innerHTML =
    treeLine(1168.9, 900.0, 1125, 894, 20, 6, 8, 1.0) +
    treeLine(1060, 882, 956.7, 863.5, 20, 6, 8, 1.0) +
    treeLine(956.7, 863.5, 952.1, 610.6, 22, 6.5, 9, 1.2) +
    treeLine(952.1, 610.6, 1001.0, 608.1, 22, 6.5, 9, 1.2) +
    treeLine(1001.0, 608.1, 963.7, 432.3, 22, 6.5, 9, 1.2) +
    treeLine(963.7, 432.3, 637.0, 531.8, 22, 6.5, 9, 1.2) +
    treeLine(637.0, 531.8, 617.6, 493.5, 20, 6.5, 8.5, 1.0) +
    treeLine(617.6, 493.5, 576.8, 444.4, 20, 6.5, 8.5, 1.0) +
    treeLine(576.8, 444.4, 689.6, 282.2, 22, 6.5, 9, 1.2) +
    treeLine(689.6, 282.2, 766.2, 264.0, 22, 6.5, 9, 1.2) +
    treeLine(766.2, 264.0, 808.5, 194.0, 22, 6.5, 9, 1.2) +
    treeLine(808.5, 194.0, 864.5, 162.8, 22, 6.5, 9, 1.2) +
    treeLine(864.5, 162.8, 975.8, 147.7, 22, 6.5, 9, 1.2) +
    treeLine(975.8, 147.7, 1022.1, 146.6, 20, 6, 8, 1.0) +
    treeLine(1022.1, 146.6, 1022.7, 403.1, 22, 6.5, 9, 1.2) +
    treeLine(1022.7, 403.1, 1033.7, 400.5, 18, 5.5, 7, 0.8) +
    treeLine(1033.7, 400.5, 1052.4, 491.2, 20, 6, 8.5, 1.0) +
    treeLine(1052.4, 491.2, 1058.9, 697.8, 22, 6.5, 9, 1.2) +
    treeLine(1058.9, 697.8, 1102.3, 690.7, 20, 6, 8, 1.0) +
    treeLine(1102.3, 690.7, 1168.9, 900.0, 22, 6.5, 9, 1.2);

// ==========================================
// LAYER 1: ROAD-FIRST GEOMETRY (The Structural Skeleton of the Map)
// ==========================================
// Continuous connected roads that define and carve out all cemetery parcels:
const roads = [
    // 1. Entrance Service Road (P. Aquino Ave -> Main Gate -> Neck Corridor -> Central Spine)
    { d: 'M 1101 928 L 1096 881 L 1090 820 L 1085 680 L 1085 545', w: 22, main: true },
    // 2. Central Boulevard Spine: from Avenue of Peace junction -> North amenities court
    { d: `M ${RD.spine} ${RD.mainCross} V 190`, w: 24, main: true },
    // 3. Main Cross Boulevard (Avenue of Peace): internal circulation inside memorial park
    { d: `M 640 ${RD.mainCross} H 1050`, w: 22, main: true },
    // 4. Internal Promenade: separates North sections from Mid sections
    { d: `M 680 ${RD.promenade} H 1020`, w: 18 },
    // 8. Mid-West Section Access Road (divides Section B from Section A)
    { d: `M ${RD.accW} ${RD.promenade} V ${RD.mainCross}`, w: 14 },
    // 9. Mid-East Section Access Road (divides Section A from Section E)
    { d: `M ${RD.accE} ${RD.promenade} V ${RD.mainCross}`, w: 14 },
    // 11. Visitor Parking Access Driveway
    { d: 'M 1035 755 H 1085', w: 16 }
];

// Pedestrian Walkways connecting landmarks, roads, and block parcels
const primaryPaths = [
    `M 782 300 V 360`,                                          // Spine Promenade to Admin Office
    `M 858 300 V 345`,                                          // Promenade to Memorial Chapel
    `M 886 215 V 320`,                                          // North walk through Columbarium pavilion cluster
    `M 920 270 H 955`,                                          // East cross walk to Crematorium
    `M 978 288 V 300`,                                          // Crematorium south approach to Promenade
    `M 1035 755 H 1085`                                         // Parking pedestrian connection to Entrance Road
];

const roadG = mk('g', { class: 'svg-road-network mp-roads' }, mapRoadLayer);
let pathUnder = '', pathFill = '', roadCurbs = '', roadAsphalt = '', roadStripes = '';

primaryPaths.forEach(d => {
    pathUnder += `<path d="${d}" class="mp-path-edge"/>`;
    pathFill += `<path d="${d}" class="mp-path"/>`;
});

roads.forEach(r => {
    roadCurbs += `<path d="${r.d}" class="mp-road-curb" stroke-width="${r.w + 6}"/>`;
    roadAsphalt += `<path d="${r.d}" class="mp-road${r.main ? ' mp-road--main' : ''}" stroke-width="${r.w}"/>`;
    if (r.main) {
        roadStripes += `<path d="${r.d}" class="mp-road-line"/>`;
    }
});

roadG.innerHTML = pathUnder + pathFill + roadCurbs + roadAsphalt + roadStripes + `
    <!-- Road Name Annotations -->
    <text x="730" y="541" class="mp-road-label">AVENUE OF PEACE</text>
    <text x="965" y="541" class="mp-road-label">AVENUE OF PEACE</text>
    <text x="803" y="370" class="mp-road-label" transform="rotate(-90 803 370)">MAIN SPINE</text>
    <text x="880" y="297" class="mp-road-label mp-road-label--minor">INTERNAL PROMENADE</text>
    <text x="1075" y="760" class="mp-road-label mp-road-label--minor" transform="rotate(-90 1075 760)">ENTRANCE ROAD</text>
`;

// Boulevard Trees Lining Main Road
const boulevardTrees = mk('g', { class: 'mp-trees', 'aria-hidden': 'true' }, mapRoadLayer);
boulevardTrees.innerHTML =
    // North spine tree avenue
    treeLine(766, 95, 766, 285, 24, 7, 8.5, 0.4) +
    treeLine(834, 95, 834, 285, 24, 7, 8.5, 0.4) +
    // Mid spine tree avenue (between Section A left/right)
    treeLine(766, 315, 766, 530, 24, 7, 8.5, 0.4) +
    treeLine(834, 315, 834, 530, 24, 7, 8.5, 0.4) +
    // South neck tree avenue flanking entrance driveway
    treeLine(1096, 680, 1096, 850, 24, 6.5, 8.5, 0.4);

// ==========================================
// LAYER 2: PHYSICAL FACILITY STRUCTURES (15 Mapped OSM Footprints)
// ==========================================
const facilityStructuresGroup = mk('g', { id: 'facilityStructures', class: 'mp-facility-structures', 'aria-hidden': 'true' }, mapLandmarkLayer);
let structHtml = '';
FACILITY_STRUCTURES.forEach(s => {
    structHtml += `
        <polygon points="${s.points}" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
        <polygon points="${s.points}" class="mp-bldg-wall mp-facility-footprint" data-way-id="${s.wayId}"/>
        <polygon points="${s.points}" class="mp-facility-roof"/>
    `;
});
facilityStructuresGroup.innerHTML = structHtml;

// Landscaping framing the real facility buildings and visitor parking
const campusTrees = mk('g', { class: 'mp-trees', 'aria-hidden': 'true' }, mapLandmarkLayer);
campusTrees.innerHTML =
    // Shrub lines along facility courtyard and promenade
    shrubLine(820, 325, 915, 325, 12, 3) +
    shrubLine(920, 215, 920, 320, 12, 3) +
    // Green planting around parking zone in entrance neck
    shrubLine(988, 715, 1072, 715, 12, 3.2) +
    shrubLine(988, 794, 1072, 794, 12, 3.2) +
    treeCluster(975, 730, 3, 10, 6.5, 8.5) +
    treeCluster(975, 780, 3, 10, 6.5, 8.5) +
    // Tree clusters framing facility terraces
    treeCluster(805, 360, 3, 8, 6, 8) +
    treeCluster(915, 355, 3, 8, 6, 8) +
    treeCluster(995, 235, 3, 10, 6.5, 8.5) +
    treeCluster(995, 305, 3, 10, 6.5, 8.5);

const landmarkGroup = mk('g', { class: 'svg-landmarks-group mp-landmarks' }, mapLandmarkLayer);

// --- Visitor Parking Area (Operational Landmark along Entrance Neck) ---
landmarkGroup.innerHTML += `
    <g class="svg-landmark-bldg mp-landmark" data-landmark="parking" tabindex="0" role="region" aria-label="Visitor Parking Area">
        <title>Visitor Parking Area — Entrance Corridor (Operational Landmark)</title>
        <rect x="990" y="720" width="80" height="70" rx="4" class="mp-parking-curb"/>
        <rect x="993" y="723" width="74" height="64" rx="3" class="mp-parking"/>
        <!-- Perpendicular Parking Bays -->
        <line x1="993" y1="738" x2="1040" y2="738" class="mp-parking-stripe"/>
        <line x1="993" y1="753" x2="1040" y2="753" class="mp-parking-stripe"/>
        <line x1="993" y1="768" x2="1040" y2="768" class="mp-parking-stripe"/>
        <!-- Parked visitor cars -->
        <rect x="998" y="726" width="24" height="10" rx="2" fill="#1e3a5f" class="mp-car"/>
        <rect x="998" y="741" width="24" height="10" rx="2" fill="#e5e7eb" class="mp-car"/>
        <rect x="998" y="756" width="24" height="10" rx="2" fill="#9f1239" class="mp-car"/>
        <!-- PWD Accessible Bay -->
        <rect x="995" y="770" width="28" height="15" rx="1.5" class="mp-parking-pwd"/>
        <text x="1009" y="782" class="mp-parking-pwd-icon">♿</text>
        <!-- Directional Ingress Arrow -->
        <path d="M 1052 730 V 770 M 1047 764 L 1052 770 L 1057 764" class="mp-parking-arrow"/>
        ${pillSvg(1030, 755, 'Visitor Parking', 'P', 'navy')}
    </g>
`;

// --- Administration Office (Calibrated Facility Anchor: Way 927998601/927998602) ---
landmarkGroup.innerHTML += `
    <g class="svg-landmark-bldg mp-landmark" data-landmark="admin" tabindex="0" role="region" aria-label="Administration Office">
        <title>Administration Office — Mapped Structures 927998601/927998602</title>
        <rect x="768" y="360" width="30" height="38" rx="2" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
        <rect x="768" y="360" width="30" height="38" rx="2" class="mp-bldg-wall"/>
        <rect x="770" y="362" width="26" height="34" rx="1" fill="#8aa1bd"/>
        <line x1="770" y1="379" x2="796" y2="379" class="mp-roof-ridge mp-roof-ridge--thin"/>
        <!-- Admin Entry Portico -->
        <rect x="777" y="394" width="12" height="6" rx="1" class="mp-bldg-wall"/>
        <rect x="778" y="395" width="10" height="4" fill="#cbd5e1"/>
        ${pillSvg(782, 380, 'Admin Office', '🏢', 'navy')}
    </g>
`;

// --- Memorial Chapel (Calibrated Facility Anchor: Way 930065369) ---
landmarkGroup.innerHTML += `
    <g class="svg-landmark-bldg mp-landmark" data-landmark="chapel" tabindex="0" role="region" aria-label="Memorial Chapel">
        <title>Memorial Chapel — Mapped Structure 930065369</title>
        <rect x="840" y="346" width="34" height="32" rx="2" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
        <rect x="840" y="346" width="34" height="32" rx="2" class="mp-bldg-wall"/>
        <!-- Chapel Pitched Roof -->
        <rect x="842" y="348" width="15" height="28" fill="#6a8fbb"/>
        <rect x="857" y="348" width="15" height="28" fill="#4b6f99"/>
        <line x1="857" y1="348" x2="857" y2="376" class="mp-roof-ridge"/>
        <!-- Ceremonial Cross on Apex -->
        <line x1="857" y1="341" x2="857" y2="352" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <line x1="853" y1="345" x2="861" y2="345" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
        <!-- Portico -->
        <rect x="850" y="374" width="14" height="5" rx="1" class="mp-bldg-wall"/>
        ${pillSvg(858, 362, 'Memorial Chapel', '✝', 'navy')}
    </g>
`;

// --- Crematorium Facility (Calibrated Facility Anchor: Way 930065371) ---
landmarkGroup.innerHTML += `
    <g class="svg-landmark-bldg mp-landmark" data-landmark="crematorium" tabindex="0" role="region" aria-label="Crematorium Facility">
        <title>Crematorium Facility — Mapped Structure 930065371</title>
        <rect x="954" y="252" width="46" height="36" rx="2" class="mp-bldg-shadow" transform="translate(2 2)"/>
        <rect x="954" y="252" width="46" height="36" rx="2" class="mp-bldg-wall"/>
        <!-- Crematorium Hipped Roof -->
        <polygon points="955,253 999,253 986,270 967,270" fill="#c3c9d0"/>
        <polygon points="955,287 999,287 986,270 967,270" fill="#8e97a1"/>
        <polygon points="955,253 967,270 955,287" fill="#a9b1ba"/>
        <polygon points="999,253 986,270 999,287" fill="#9aa2ab"/>
        <line x1="967" y1="270" x2="986" y2="270" class="mp-roof-ridge"/>
        <!-- Chimney Stack Feature -->
        <rect x="990" y="255" width="5" height="5" rx="1" fill="#475569" stroke="#1e293b" stroke-width="0.6"/>
        <!-- Porte-Cochere Hearse Drop-Off -->
        <rect x="965" y="284" width="24" height="6" rx="1" class="mp-bldg-wall"/>
        <rect x="966" y="285" width="22" height="4" fill="#b8bec6"/>
        ${pillSvg(978, 271, 'Crematorium', '🔥', 'navy')}
    </g>
`;

// --- Columbarium & Ossuary Sanctuary (Calibrated Facility Anchor: Pavilion Cluster) ---
landmarkGroup.innerHTML += `
    <g class="svg-landmark-bldg mp-landmark" data-landmark="columbarium" tabindex="0" role="region" aria-label="Columbarium and Ossuary Sanctuary">
        <title>Columbarium / Ossuary Sanctuary — Pavilion Cluster</title>
        <!-- Colonnade & Memorial Pavilion Courtyard -->
        <rect x="864" y="260" width="44" height="32" rx="4" class="mp-garden-hedge"/>
        <rect x="867" y="263" width="38" height="26" rx="2" fill="#7c5cc4" opacity="0.15"/>
        <circle cx="886" cy="274" r="14" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
        <circle cx="886" cy="274" r="14" class="mp-bldg-wall"/>
        <circle cx="886" cy="274" r="10" fill="#7c5cc4" stroke="#4c2f91" stroke-width="1.2"/>
        <circle cx="886" cy="274" r="3" fill="#fbbf24" stroke="#b45309" stroke-width="0.8"/>
        ${pillSvg(886, 274, 'Columbarium / Ossuary', '🏛', 'purple')}
    </g>
`;

// --- Public Comfort Room Facility (Calibrated Facility Anchor: Way 930065365) ---
landmarkGroup.innerHTML += `
    <g class="svg-landmark-bldg mp-landmark" data-landmark="restroom" tabindex="0" role="region" aria-label="Public Comfort Room Facility">
        <title>Public Comfort Room (CR) — Mapped Structure 930065365</title>
        <rect x="924" y="240" width="16" height="14" rx="1.5" class="mp-bldg-shadow" transform="translate(1 1)"/>
        <rect x="924" y="240" width="16" height="14" rx="1.5" class="mp-bldg-wall"/>
        <rect x="925" y="241" width="14" height="12" fill="#7fa7c9"/>
        <line x1="925" y1="247" x2="939" y2="247" class="mp-roof-ridge mp-roof-ridge--thin"/>
        ${pillSvg(932, 247, 'Comfort Room', '🚻', 'teal')}
    </g>
`;

// --- Main Gate Entrance Portal (Verified OSM Node 8348620486 & 9928981748, P. Aquino Avenue) ---
// Positioned at verified coordinates (1095.7, 880.9) oriented to P01-P00 frontage angle (~9.8 deg)
landmarkGroup.innerHTML += `
    <g class="svg-gate-portal mp-gate" data-landmark="gate" tabindex="0" role="region" aria-label="Main Gate" transform="translate(1096 881) rotate(9.8)">
        <title>Main Gate — 3 P. Aquino Avenue (Letre Road)</title>
        <!-- Paved entrance apron connecting P. Aquino Avenue to Cemetery Entrance -->
        <rect x="-24" y="-12" width="48" height="24" rx="2" class="mp-gate-apron"/>
        <rect x="-24" y="-12" width="48" height="24" rx="2" fill="url(#mpPaverPattern)" class="mp-texture"/>
        <!-- West & East Monument Gate Pillars -->
        <rect x="-21" y="-10" width="8" height="20" rx="1.5" class="mp-gate-pillar"/>
        <rect x="-22" y="-12" width="10" height="4" rx="1" class="mp-gate-cap"/>
        <rect x="13" y="-10" width="8" height="20" rx="1.5" class="mp-gate-pillar"/>
        <rect x="12" y="-12" width="10" height="4" rx="1" class="mp-gate-cap"/>
        <!-- Ceremonial Wrought-Iron Arch & Gate Leaves -->
        <path d="M -13 -6 Q 0 -17 13 -6" class="mp-gate-arch"/>
        <path d="M -13 6 L -3 0 M 13 6 L 3 0" class="mp-gate-leaf"/>
        <!-- Barrier Lift-Gate (OSM Node 9928981748 barrier=lift_gate) -->
        <line x1="-8" y1="4" x2="10" y2="4" class="mp-gate-boom"/>
        <!-- Security Sentry Post Kiosk (East of Gate) -->
        <rect x="23" y="-8" width="16" height="16" transform="translate(1.5 2)" class="mp-bldg-shadow"/>
        <rect x="23" y="-8" width="16" height="16" rx="1.5" class="mp-bldg-wall"/>
        <rect x="24" y="-7" width="14" height="14" fill="#8b6f5a"/>
        <line x1="24" y1="0" x2="38" y2="0" class="mp-roof-ridge mp-roof-ridge--thin"/>
        <!-- Entrance Badge & Pill -->
        <circle cx="0" cy="-32" r="10" class="mp-gate-badge"/>
        <path d="M -5 -30 L 0 -35 L 5 -30 V -26 H -5 Z" fill="#ffffff"/>
        ${pillSvg(0, -50, 'MAIN GATE (GATE 1)', '', 'navy')}
    </g>
`;

// --- Compass Rose Indicator (Top-Left, matching reference) ---
landmarkGroup.innerHTML += `
    <g class="svg-north-indicator mp-compass" transform="translate(485 145)" aria-hidden="true">
        <circle r="19" class="mp-compass-bg"/>
        <polygon points="0,-13 4.5,2 0,0 -4.5,2" fill="#ef4444"/>
        <polygon points="0,13 4.5,0 0,0 -4.5,0" fill="#cbd5e1"/>
        <text x="0" y="-4" class="mp-compass-n">N</text>
    </g>
`;

// ==========================================
// LAYER 3 & 4: GEOGRAPHIC SECTION ZONES & NATURAL BLOCK PARCELS
// ==========================================
// Sections are geographic land zones sculpted by the road network.
// Blocks are physical plot terraces separated by pedestrian pathways.
// Lots sit naturally on the grass with memorial headstones.
// ==========================================

const count = sections.length;

// Spatial parcel boundaries for the 5 zones in the master plan:
const ZONES = {
    c: { id: 'c', x: 700, y: 288, w: 66, h: 62, theme: 'c', defaultName: 'Sanctuario de San Jose', defaultCode: 'SECTION C' },
    d: { id: 'd', x: 825, y: 190, w: 92, h: 125, theme: 'd', defaultName: 'Everlasting Columbarium & Ossuary', defaultCode: 'SECTION D' },
    b: { id: 'b', x: 635, y: 375, w: 75, h: 105, theme: 'b', defaultName: 'Garden of Our Lady of Lourdes', defaultCode: 'SECTION B', stackVertical: true },
    a: { id: 'a', x: 735, y: 400, w: 130, h: 50, theme: 'a', defaultName: 'Garden of Everlasting Peace', defaultCode: 'SECTION A', spine: RD.spine },
    e: { id: 'e', x: 875, y: 390, w: 70, h: 42, theme: 'e', defaultName: 'Garden Reserve', defaultCode: 'SECTION E' }
};

const zoneOrder = ['a', 'b', 'c', 'd', 'e'];
const usedZones = new Set();

function resolveSectionZone(sec) {
    if (count > 5) return null;
    const name = (sec.section_name || '').toLowerCase();
    const bNames = (sec.blocks || []).map(b => (b.block_name || '').toLowerCase()).join(' ');
    let key = null;
    if (name.includes('jose') || name.includes('section c') || bNames.includes('c1') || bNames.includes('c2')) key = 'c';
    else if (name.includes('columbarium') || name.includes('ossuary') || name.includes('section d') || bNames.includes('d1') || bNames.includes('reloc')) key = 'd';
    else if (name.includes('lourdes') || name.includes('section b') || bNames.includes('b1') || bNames.includes('b2')) key = 'b';
    else if (name.includes('peace') || name.includes('section a') || bNames.includes('a1') || bNames.includes('a2')) key = 'a';
    else if (name.includes('section e') || bNames.includes('e1')) key = 'e';
    if (!key || usedZones.has(key)) key = zoneOrder.find(k => !usedZones.has(k));
    usedZones.add(key);
    return ZONES[key];
}

// Compute block parcel areas inside a section zone.
// Pathways divide the blocks naturally without card borders!
function layoutBlockTerraces(blocks, area, spineX, stackVertical) {
    const n = blocks.length;
    if (n <= 0) return { parcels: [], walkways: [] };

    const walkWidth = 6; // Width of pedestrian walkway between blocks
    const parcels = [];
    const walkways = [];

    if (spineX) {
        // Section A: Symmetrically flanks the central boulevard spine at x=800!
        // Left side of spine: Block A1; Right side of spine: Block A2
        const margin = 7;
        const topMargin = 10;
        const spineClearance = 16;
        const leftBox = {
            x: area.x + margin,
            y: area.y + topMargin,
            w: (spineX - spineClearance) - (area.x + margin),
            h: area.h - topMargin - 8
        };
        const rightBox = {
            x: spineX + spineClearance,
            y: area.y + topMargin,
            w: (area.x + area.w - margin) - (spineX + spineClearance),
            h: area.h - topMargin - 8
        };

        if (n === 2) {
            parcels.push({ ...leftBox, block: blocks[0] });
            parcels.push({ ...rightBox, block: blocks[1] });
        } else if (n === 4) {
            // 2 on left (stacked), 2 on right (stacked)
            const lh = (leftBox.h - walkWidth) / 2;
            parcels.push({ x: leftBox.x, y: leftBox.y, w: leftBox.w, h: lh, block: blocks[0] });
            parcels.push({ x: leftBox.x, y: leftBox.y + lh + walkWidth, w: leftBox.w, h: lh, block: blocks[2] });
            walkways.push(`M ${leftBox.x} ${leftBox.y + lh + walkWidth / 2} H ${leftBox.x + leftBox.w}`);

            const rh = (rightBox.h - walkWidth) / 2;
            parcels.push({ x: rightBox.x, y: rightBox.y, w: rightBox.w, h: rh, block: blocks[1] });
            parcels.push({ x: rightBox.x, y: rightBox.y + rh + walkWidth, w: rightBox.w, h: rh, block: blocks[3] });
            walkways.push(`M ${rightBox.x} ${rightBox.y + rh + walkWidth / 2} H ${rightBox.x + rightBox.w}`);
        } else {
            // General N blocks across spine
            const cols = 2;
            const rows = Math.ceil(n / cols);
            const bh = (leftBox.h - (rows - 1) * walkWidth) / rows;
            for (let i = 0; i < n; i++) {
                const isRight = (i % 2 === 1);
                const r = Math.floor(i / 2);
                const s = isRight ? rightBox : leftBox;
                parcels.push({ x: s.x, y: s.y + r * (bh + walkWidth), w: s.w, h: bh, block: blocks[i] });
                if (r > 0) {
                    walkways.push(`M ${s.x} ${s.y + r * (bh + walkWidth) - walkWidth / 2} H ${s.x + s.w}`);
                }
            }
        }
    } else {
        // Sections B, C, D, E (Continuous Land Parcel)
        const margin = 5;
        const topMargin = 10;
        const innerX = area.x + margin;
        const innerY = area.y + topMargin;
        const innerW = area.w - margin * 2;
        const innerH = area.h - topMargin - 6;

        if (n === 1) {
            // Single block inside section (Section D Columbarium)
            parcels.push({ x: innerX, y: innerY, w: innerW, h: innerH, block: blocks[0] });
        } else if (n === 2) {
            if (stackVertical || (area.h > area.w * 1.2)) {
                // Section B: 2 blocks stacked vertically (B1 North, B2 South) with horizontal walkway
                const bh = (innerH - walkWidth) / 2;
                parcels.push({ x: innerX, y: innerY, w: innerW, h: bh, block: blocks[0] });
                parcels.push({ x: innerX, y: innerY + bh + walkWidth, w: innerW, h: bh, block: blocks[1] });
                walkways.push(`M ${innerX} ${innerY + bh + walkWidth / 2} H ${innerX + innerW}`);
            } else {
                // Section C: 2 blocks side-by-side (C1 West, C2 East) with central walkway
                const bw = (innerW - walkWidth) / 2;
                parcels.push({ x: innerX, y: innerY, w: bw, h: innerH, block: blocks[0] });
                parcels.push({ x: innerX + bw + walkWidth, y: innerY, w: bw, h: innerH, block: blocks[1] });
                walkways.push(`M ${innerX + bw + walkWidth / 2} ${innerY} V ${innerY + innerH}`);
            }
        } else if (n === 4) {
            // 2x2 grid with cross walkways
            const bw = (innerW - walkWidth) / 2;
            const bh = (innerH - walkWidth) / 2;
            parcels.push({ x: innerX, y: innerY, w: bw, h: bh, block: blocks[0] });
            parcels.push({ x: innerX + bw + walkWidth, y: innerY, w: bw, h: bh, block: blocks[1] });
            parcels.push({ x: innerX, y: innerY + bh + walkWidth, w: bw, h: bh, block: blocks[2] });
            parcels.push({ x: innerX + bw + walkWidth, y: innerY + bh + walkWidth, w: bw, h: bh, block: blocks[3] });
            walkways.push(`M ${innerX} ${innerY + bh + walkWidth / 2} H ${innerX + innerW}`);
            walkways.push(`M ${innerX + bw + walkWidth / 2} ${innerY} V ${innerY + innerH}`);
        } else {
            const cols = n <= 3 ? n : Math.ceil(Math.sqrt(n));
            const rows = Math.ceil(n / cols);
            const bw = (innerW - (cols - 1) * walkWidth) / cols;
            const bh = (innerH - (rows - 1) * walkWidth) / rows;
            for (let i = 0; i < n; i++) {
                const c = i % cols, r = Math.floor(i / cols);
                parcels.push({ x: innerX + c * (bw + walkWidth), y: innerY + r * (bh + walkWidth), w: bw, h: bh, block: blocks[i] });
                if (c > 0) walkways.push(`M ${innerX + c * (bw + walkWidth) - walkWidth / 2} ${innerY} V ${innerY + innerH}`);
                if (r > 0) walkways.push(`M ${innerX} ${innerY + r * (bh + walkWidth) - walkWidth / 2} H ${innerX + innerW}`);
            }
        }
    }

    return { parcels, walkways };
}

sections.forEach((section, index) => {
    const assignedZone = resolveSectionZone(section);
    const themeCode = assignedZone ? assignedZone.theme : ['a', 'b', 'c', 'd', 'e'][index % 5];
    const badgeLabel = (section.section_name || assignedZone?.defaultName || assignedZone?.defaultCode || `SECTION ${String.fromCharCode(65 + index)}`).toUpperCase();

    let secX = assignedZone.x;
    let secY = assignedZone.y;
    let curSecW = assignedZone.w;
    let curSecH = assignedZone.h;
    const spineX = assignedZone.spine || null;

    // Custom map_config geometry priority override
    if (section.map_config && !isNaN(Number(section.map_config.x)) && !isNaN(Number(section.map_config.y)) &&
        Number(section.map_config.width) > 0 && Number(section.map_config.height) > 0) {
        secX = Number(section.map_config.x);
        secY = Number(section.map_config.y);
        curSecW = Number(section.map_config.width);
        curSecH = Number(section.map_config.height);
    }

    const blocks = section.blocks || [];

    const secGroup = mk('g', {
        class: `svg-section-card mp-section section--theme-${themeCode}`,
        'data-section-id': section.section_id,
        role: 'button',
        tabindex: '0',
        'aria-label': `${section.section_name}. Click to view section.`
    });
    const secTitleEl = mk('title', null, secGroup);
    secTitleEl.textContent = `${section.section_name} — ${blocks.length} Blocks • ${section.total_lots || 0} Lots`;

    // Section Click Handler: Focus Section on Master Map (Batch 8)
    secGroup.addEventListener('click', (e) => {
        if (e.target.closest('.svg-block-card') || e.target.closest('.svg-lot-tile')) {
            return;
        }
        e.stopPropagation();
        focusOnSection(section);
    });

    secGroup.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            if (e.target === secGroup) {
                e.preventDefault();
                focusOnSection(section);
            }
        }
    });

    // 1. Natural Geographic Lawn Terrace (Defined by Road Boundaries)
    // If Main Road spine crosses the zone (Section A), split the land neatly on both sides of the boulevard!
    if (spineX) {
        const spineClearance = 16;
        const leftW = (spineX - spineClearance) - secX;
        const rightX = spineX + spineClearance;
        const rightW = (secX + curSecW) - rightX;

        mk('rect', { x: secX, y: secY, width: f1(leftW), height: curSecH, rx: 12, class: 'svg-section-bg mp-section-lawn' }, secGroup);
        mk('rect', { x: secX, y: secY, width: f1(leftW), height: curSecH, rx: 12, fill: 'url(#mpLawnStripes)', class: 'mp-texture' }, secGroup);
        mk('rect', { x: secX, y: secY, width: f1(leftW), height: curSecH, rx: 12, class: 'mp-section-hedge' }, secGroup);

        mk('rect', { x: rightX, y: secY, width: f1(rightW), height: curSecH, rx: 12, class: 'svg-section-bg mp-section-lawn' }, secGroup);
        mk('rect', { x: rightX, y: secY, width: f1(rightW), height: curSecH, rx: 12, fill: 'url(#mpLawnStripes)', class: 'mp-texture' }, secGroup);
        mk('rect', { x: rightX, y: secY, width: f1(rightW), height: curSecH, rx: 12, class: 'mp-section-hedge' }, secGroup);
    } else {
        mk('rect', { x: secX, y: secY, width: curSecW, height: curSecH, rx: 12, class: 'svg-section-bg mp-section-lawn' }, secGroup);
        mk('rect', { x: secX, y: secY, width: curSecW, height: curSecH, rx: 12, fill: 'url(#mpLawnStripes)', class: 'mp-texture' }, secGroup);
        mk('rect', { x: secX, y: secY, width: curSecW, height: curSecH, rx: 12, class: 'mp-section-hedge' }, secGroup);
    }

    // 2. Pedestrian Pathways between Block Terraces (Subtle Stone Pavers, Not Card Boxes!)
    const isStackVertical = assignedZone?.stackVertical || false;
    const { parcels, walkways } = layoutBlockTerraces(blocks, { x: secX, y: secY, w: curSecW, h: curSecH }, spineX, isStackVertical);
    if (walkways.length > 0) {
        const pathG = mk('g', { class: 'mp-section-internal-paths', 'aria-hidden': 'true' }, secGroup);
        let pathHtml = '';
        walkways.forEach(d => {
            pathHtml += `<path d="${d}" class="mp-block-walkway-edge"/>`;
            pathHtml += `<path d="${d}" class="mp-block-walkway"/>`;
        });
        pathG.innerHTML = pathHtml;
    }

    // 3. Floating Section Header Badge (Clean pill matching reference)
    const pillW = Math.max(50, Math.min(curSecW - 6, Math.ceil(badgeLabel.length * 4.6 + 14)));
    const pillH = 15;
    const pillX = secX + (curSecW - pillW) / 2;
    const pillY = secY - 8;
    mk('rect', { x: f1(pillX), y: pillY, width: f1(pillW), height: pillH, rx: 4, class: 'svg-section-header' }, secGroup);
    const secTitle = mk('text', { x: f1(pillX + pillW / 2), y: pillY + 11, 'text-anchor': 'middle', class: 'svg-section-title', style: 'font-size: 7.5px;' }, secGroup);
    secTitle.textContent = badgeLabel;

    // 4. Physical Block Parcels and Individual Lots
    parcels.forEach((parcel) => {
        const block = parcel.block;
        const blkX = parcel.x;
        const blkY = parcel.y;
        const curBlkW = parcel.w;
        const curBlkH = parcel.h;

        const lots = state.blockLotsCache[block.block_id] || [];
        const isColumbarium = (function () {
            const cName = (state.currentCemetery?.cemetery_name || '').toLowerCase();
            const sName = (section.section_name || '').toLowerCase();
            const bName = (block.block_name || '').toLowerCase();
            const lType = (lots[0]?.lot_type || '').toLowerCase();
            return cName.includes('columbarium') || cName.includes('ossuary') ||
                   sName.includes('columbarium') || sName.includes('ossuary') ||
                   bName.includes('columbarium') || bName.includes('ossuary') ||
                   lType.includes('columbarium') || lType.includes('ossuary') || lType.includes('niche');
        })();

        const blkGroup = mk('g', {
            class: `svg-block-card mp-block-parcel mp-theme-${themeCode}`,
            'data-block-id': block.block_id,
            role: 'button',
            tabindex: '0',
            'aria-label': `${block.block_name}, ${block.total_lots || 0} lots. Click to focus block.`
        });

        // Block Plot Terrace Ground (Natural lawn parcel with subtle boundary, NOT a card box!)
        mk('rect', {
            x: f1(blkX), y: f1(blkY), width: f1(curBlkW), height: f1(curBlkH), rx: 3,
            class: `svg-block-bg mp-block-terrace${isColumbarium ? ' mp-block-terrace--niche' : ''}`
        }, blkGroup);

        // Compact Floating Block Identifier Tag (Reference style, e.g. A1, A2, B1, C1)
        const blockLabel = block.block_name.replace(/Block\s+/i, '');
        const tagW = Math.max(14, Math.min(curBlkW - 4, blockLabel.length * 5 + 6));
        const tagH = 10;
        mk('rect', { x: f1(blkX + 2), y: f1(blkY + 1.5), width: tagW, height: tagH, rx: 2, class: 'svg-block-header-bar mp-block-tag' }, blkGroup);
        const blkText = mk('text', { x: f1(blkX + 2 + tagW / 2), y: f1(blkY + 8.5), 'text-anchor': 'middle', class: 'svg-block-title mp-block-tag-text', style: 'font-size: 6.5px;' }, blkGroup);
        blkText.textContent = blockLabel;

        // Block Click Handler: Focus/Zoom to Block on Master Map
        blkGroup.addEventListener('click', (e) => {
            e.stopPropagation();
            focusOnBlock(block, section);
        });

        blkGroup.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                focusOnBlock(block, section);
            }
        });

        // Hover Tooltip
        blkGroup.addEventListener('mouseenter', (e) => {
            showFloatingTooltip(e, `<strong>${escapeHtml(block.block_name)}</strong><br>${block.total_lots || 0} Lots • Click to focus`);
        });
        blkGroup.addEventListener('mousemove', moveFloatingTooltip);
        blkGroup.addEventListener('mouseleave', hideFloatingTooltip);

        mapBlockLayer.appendChild(blkGroup);

        // ==========================================
        // INDIVIDUAL LOTS ON MASTER MAP (LAYER: mapLotLayer)
        // Realistic, compact burial plots with memorial headstone markers.
        // Plots sit naturally on the lawn — never stretched into giant boxes.
        // ==========================================
        const padX = 2.5;
        const padTop = 13.5; // space below block tag (tag y=1.5 + h=10 = 11.5 + 2px margin)
        const padBottom = 2.5;
        const lotAreaX = blkX + padX;
        const lotAreaY = blkY + padTop;
        const lotAreaW = Math.max(8, curBlkW - (padX * 2));
        const lotAreaH = Math.max(8, curBlkH - padTop - padBottom);

        if (lots.length > 0) {
            const n = lots.length;
            let gapX = isColumbarium ? 1.0 : (n > 25 ? 0.4 : 1.5);
            let gapY = isColumbarium ? 1.5 : (n > 25 ? 0.4 : 1.5);
            let doubleRowAisle = 0;
            let cols = 0;

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
            }

            if (!cols || cols < 1) {
                if (isColumbarium) {
                    // Match vertical tier columbarium elevation (5 tiers for ~34 vaults)
                    if (n <= 12) cols = 4;
                    else if (n <= 25) cols = 5;
                    else if (n <= 40) cols = 7;
                    else cols = 8;
                } else if (n > 25) {
                    // Dense ground block (e.g. Block A1: 50 lots -> 10 cols x 5 rows)
                    cols = 10;
                } else if (n <= 5) {
                    // Small ground blocks (e.g. 5 lots):
                    // If lot area is wider than tall, single row (5 cols x 1 row) e.g. A2, B1, B2
                    // If taller than wide, 2 cols x 3 rows e.g. C1, C2
                    cols = (lotAreaW >= lotAreaH * 1.1) ? n : 2;
                } else {
                    cols = Math.max(2, Math.min(8, Math.round(Math.sqrt(1.2 * n * (lotAreaW / lotAreaH)))));
                }
            }
            cols = Math.max(1, Math.min(cols, n));
            const rows = Math.ceil(n / cols);

            // Compute maximum tile size fitting strictly inside lotArea
            const availW = Math.max(4, lotAreaW - (cols - 1) * gapX);
            const availH = Math.max(4, lotAreaH - (rows - 1) * gapY);

            const maxW = availW / cols;
            const maxH = availH / rows;

            let tileW = maxW;
            let tileH = maxH;

            if (isColumbarium) {
                // Columbarium vertical vault plates:
                // Cap dimensions so vaults have architectural proportion
                tileW = Math.min(maxW, 9.8);
                tileH = Math.min(maxH, 13.5);
            } else if (n <= 5) {
                // Ground burial plots in small blocks (A2, B1, B2, C1, C2)
                // Cap tile size so they look like elegant plots with breathing room, not massive cards
                if (cols === n) {
                    // 1-row layout: cap tile width and height
                    tileW = Math.min(maxW, 10.0);
                    tileH = Math.min(maxH, 16.0);
                } else {
                    // Multi-row layout (e.g. C1, C2: 2 cols x 3 rows)
                    tileW = Math.min(maxW, 9.5);
                    tileH = Math.min(maxH, 8.5);
                }
            } else if (n > 25) {
                // Block A1: tightly packed grid (3.34 x 2.78 approx)
                tileW = maxW;
                tileH = maxH;
            }

            // Downscale smoothly if strict bounds are exceeded
            const calcGridW = cols * tileW + (cols - 1) * gapX;
            const calcGridH = rows * tileH + (rows - 1) * gapY;
            const fit = Math.min(1, lotAreaW / calcGridW, lotAreaH / calcGridH);
            if (fit < 1) {
                tileW *= fit;
                tileH *= fit;
                gapX *= fit;
                gapY *= fit;
            }

            // Center grid on lawn terrace
            const finalGridW = cols * tileW + (cols - 1) * gapX;
            const finalGridH = rows * tileH + (rows - 1) * gapY;
            const gridOffsetX = Math.max(0, (lotAreaW - finalGridW) / 2);
            const gridOffsetY = Math.max(0, (lotAreaH - finalGridH) / 2);

            lots.forEach((lot, i) => {
                const col = i % cols;
                const row = Math.floor(i / cols);
                let lotX = lotAreaX + gridOffsetX + (col * (tileW + gapX));
                let lotY = lotAreaY + gridOffsetY + (row * (tileH + gapY)) + Math.floor(row / 2) * doubleRowAisle;
                let curTileW = tileW;
                let curTileH = tileH;

                // Optional custom lot position override
                if (lot.map_config && !isNaN(Number(lot.map_config.x)) && !isNaN(Number(lot.map_config.y)) &&
                    Number(lot.map_config.width) > 0 && Number(lot.map_config.height) > 0) {
                    const rawLx = Number(lot.map_config.x);
                    const rawLy = Number(lot.map_config.y);
                    lotX = rawLx < curBlkW ? (blkX + rawLx) : rawLx;
                    lotY = rawLy < curBlkH ? (blkY + rawLy) : rawLy;
                    curTileW = Number(lot.map_config.width);
                    curTileH = Number(lot.map_config.height);
                }

                const tierLevel = isColumbarium ? (rows - row) : 1;
                const isEyeLevel = isColumbarium && ((rows >= 4 && tierLevel === 3) || (rows === 3 && tierLevel === 2) || (rows < 3 && tierLevel === 1));
                const approxH = isColumbarium ? ((0.4 + (tierLevel - 1) * 0.45).toFixed(1) + 'm') : 'Ground Level';

                let displayLabel = lot.lot_number;
                let isSanitizedHash = false;
                if (lot.lot_number && lot.lot_number.length > 12) {
                    isSanitizedHash = true;
                    displayLabel = isColumbarium ? `V-${i + 1}` : `L-${i + 1}`;
                }

                lot._tierLevel = tierLevel;
                lot._isEyeLevel = isEyeLevel;
                lot._approxHeight = approxH;
                lot._displayLabel = displayLabel;
                lot._elevationDesc = isColumbarium
                    ? `Level ${tierLevel} (${approxH}) — ${isEyeLevel ? 'Eye-Level (Optimal viewing height)' : (tierLevel === rows ? 'Top Tier Vault' : (tierLevel === 1 ? 'Base Tier (Wheelchair Accessible)' : 'Mid-Tier Vault'))}`
                    : 'Elevated Lawn Terrace (Certified Flood-Free, +1.2m)';

                const lotStatusClass = (lot.status || 'Available').toLowerCase().replace(/\s+/g, '-');
                const isSelected = state.selectedLot && state.selectedLot.lot_id === lot.lot_id;

                const lotGroup = document.createElementNS(SVG_NS, 'g');
                lotGroup.setAttribute('class', `svg-lot-tile mp-lot-parcel lot--${lotStatusClass}${isColumbarium ? ' is-niche-vault' : ''}${isSelected ? ' is-selected' : ''}`);
                lotGroup.setAttribute('data-lot-id', lot.lot_id);
                lotGroup.setAttribute('data-block-id', block.block_id);
                lotGroup.setAttribute('data-tier-level', tierLevel);
                lotGroup.setAttribute('role', 'button');
                lotGroup.setAttribute('tabindex', '0');
                lotGroup.setAttribute('aria-label', `${displayLabel}, Section ${section.section_name}, Block ${block.block_name}, Status: ${lot.status}, Price: ${formatCurrency(lot.price)}`);

                // Main plot boundary rectangle (CRITICAL: must be first child for selection reticle)
                const lotRect = document.createElementNS(SVG_NS, 'rect');
                lotRect.setAttribute('x', f1(lotX));
                lotRect.setAttribute('y', f1(lotY));
                lotRect.setAttribute('width', f1(curTileW));
                lotRect.setAttribute('height', f1(curTileH));
                lotRect.setAttribute('rx', isColumbarium ? '1.5' : '2');
                lotRect.setAttribute('class', `svg-lot-rect mp-lot-plot${isColumbarium ? ' niche-vault-rect' : ''}`);
                lotGroup.appendChild(lotRect);

                // Miniature Headstone / Memorial Plaque Marker (Authentic cemetery look)
                if (!isColumbarium && curTileW >= 5 && curTileH >= 6) {
                    const markerW = curTileW * 0.65;
                    const markerH = Math.max(1.8, curTileH * 0.18);
                    const marker = document.createElementNS(SVG_NS, 'rect');
                    marker.setAttribute('x', f1(lotX + (curTileW - markerW) / 2));
                    marker.setAttribute('y', f1(lotY + 1.2));
                    marker.setAttribute('width', f1(markerW));
                    marker.setAttribute('height', f1(markerH));
                    marker.setAttribute('rx', '0.8');
                    marker.setAttribute('class', 'svg-lot-headstone mp-lot-headstone');
                    lotGroup.appendChild(marker);
                }

                // Columbarium Niche Inner Plate
                if (isColumbarium && curTileW >= 6 && curTileH >= 6) {
                    const innerPlate = document.createElementNS(SVG_NS, 'rect');
                    const inset = 1.2;
                    innerPlate.setAttribute('x', f1(lotX + inset));
                    innerPlate.setAttribute('y', f1(lotY + inset));
                    innerPlate.setAttribute('width', f1(Math.max(0, curTileW - (inset * 2))));
                    innerPlate.setAttribute('height', f1(Math.max(0, curTileH - (inset * 2))));
                    innerPlate.setAttribute('rx', '1');
                    innerPlate.setAttribute('class', 'niche-inner-plate');
                    lotGroup.appendChild(innerPlate);
                }

                // Lot Number Text (Hidden at overview level, appears on hover, zoom, or selection)
                const labelText = document.createElementNS(SVG_NS, 'text');
                labelText.setAttribute('x', f1(lotX + (curTileW / 2)));
                labelText.setAttribute('y', f1(isColumbarium ? (lotY + curTileH / 2) : (lotY + curTileH * 0.74)));
                labelText.setAttribute('text-anchor', 'middle');
                if (isColumbarium) {
                    labelText.setAttribute('dominant-baseline', 'central');
                }
                labelText.setAttribute('class', 'svg-lot-label mp-lot-number');
                labelText.textContent = displayLabel;
                lotGroup.appendChild(labelText);

                // Accessibility Title
                const titleEl = document.createElementNS(SVG_NS, 'title');
                titleEl.textContent = `${displayLabel} • ${lot.status} • ${formatCurrency(lot.price)}`;
                lotGroup.appendChild(titleEl);

                // Click Handler
                lotGroup.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectLot(lot, block, section, lotGroup);
                });

                lotGroup.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        selectLot(lot, block, section, lotGroup);
                    }
                });

                // Hover Tooltip
                lotGroup.addEventListener('mouseenter', (e) => {
                    e.stopPropagation();
                    const elevHtml = isColumbarium
                        ? `<br>Vertical Placement: <strong>Level ${tierLevel} (${approxH})</strong>${isEyeLevel ? ' <span style="color:#f59e0b;">⭐ Eye-Level</span>' : ''}`
                        : `<br>Vertical Placement: <strong>Ground Level (Terraced Lawn)</strong>`;
                    const idExtra = isSanitizedHash ? `<br><small style="opacity:0.75;">System Ref: ${escapeHtml(lot.lot_number)}</small>` : '';
                    showFloatingTooltip(e, `<strong>${escapeHtml(displayLabel)}</strong>${elevHtml}<br>Section: ${escapeHtml(section.section_name)}<br>Block: ${escapeHtml(block.block_name)}<br>Status: <strong>${escapeHtml(lot.status)}</strong><br>Price: ${formatCurrency(lot.price)}${idExtra}`);
                });
                lotGroup.addEventListener('mousemove', (e) => {
                    e.stopPropagation();
                    moveFloatingTooltip(e);
                });
                lotGroup.addEventListener('mouseleave', (e) => {
                    e.stopPropagation();
                    hideFloatingTooltip();
                });

                mapLotLayer.appendChild(lotGroup);
            });
        }
    });

    mapSectionLayer.appendChild(secGroup);
});

// If the database has 4 sections, the East parcel (where Section E would be)
// is rendered as a seamless, quiet green lawn terrace matching the cemetery
// landscape—WITHOUT any fake "Garden / Green Area" card box!
if (count <= 4 && !usedZones.has('e')) {
    const z = ZONES.e;
    const g = mk('g', { class: 'mp-natural-lawn-terrace', 'aria-hidden': 'true' }, mapSectionLayer);
    const cx = z.x + z.w / 2;
    const cy = z.y + z.h / 2;
    g.innerHTML = `
        <rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="6" class="svg-section-bg mp-section-lawn"/>
        <rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="6" fill="url(#mpLawnStripes)" class="mp-texture"/>
        <rect x="${z.x}" y="${z.y}" width="${z.w}" height="${z.h}" rx="6" class="mp-section-hedge"/>
        <!-- Central circular ornamental garden walkway ring in reserve park -->
        <circle cx="${f1(cx)}" cy="${f1(cy)}" r="14" class="mp-block-walkway-edge"/>
        <circle cx="${f1(cx)}" cy="${f1(cy)}" r="14" class="mp-block-walkway"/>
        <circle cx="${f1(cx)}" cy="${f1(cy)}" r="7" fill="#15803d" opacity="0.35" stroke="#166534" stroke-width="1"/>
        ${treeCluster(cx, cy, 2, 8, 3, 5)}
        ${treeCluster(z.x + 15, z.y + 12, 2, 8, 3, 5)}
        ${treeCluster(z.x + z.w - 15, z.y + 12, 2, 8, 3, 5)}
        ${treeCluster(z.x + 15, z.y + z.h - 12, 2, 8, 3, 5)}
        ${treeCluster(z.x + z.w - 15, z.y + z.h - 12, 2, 8, 3, 5)}
    `;
}

        // Batch 11: Apply scheduled service markers to rendered lots
        highlightServiceLotsOnMap();
    }

    /**
     * Focus and Center Camera on Selected Block on Master Map (Batch 3 & 8)
     */
    function focusBlockOnMasterMap(block, section, blkX, blkY, curBlkW, curBlkH) {
        focusOnBlock(block, section);
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
        ensureSvgLayers();
        clearSvgLayers();
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
        titleText.textContent = `${block.section_name || state.currentSection.section_name} â€º ${block.block_name}`;
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
            titleText.textContent = `${block.section_name || state.currentSection.section_name} â€º ${block.block_name} â€¢ Columbarium Niche Wall Elevation`;
        }

        const subtitleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        subtitleText.setAttribute('x', margin + 24);
        subtitleText.setAttribute('y', margin + 60);
        subtitleText.setAttribute('class', 'svg-section-meta');
        subtitleText.setAttribute('id', 'blockLotsSummarySubtitle');
        subtitleText.textContent = isColumbarium
            ? `Total Vaults: ${lots.length}  |  ðŸŸ¢ Available: ${counts.Available}  |  ðŸŸ¡ Reserved: ${counts.Reserved}  |  ðŸ”´ Occupied: ${counts.Occupied}`
            : `Total Plots: ${lots.length}  |  ðŸŸ¢ Available: ${counts.Available}  |  ðŸŸ¡ Reserved: ${counts.Reserved}  |  ðŸ”´ Occupied: ${counts.Occupied}`;
        headerGroup.appendChild(subtitleText);

        mapSectionLayer.appendChild(headerGroup);

        if (lots.length === 0) {
            const noLotsText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            noLotsText.setAttribute('x', canvasW / 2);
            noLotsText.setAttribute('y', canvasH / 2);
            noLotsText.setAttribute('text-anchor', 'middle');
            noLotsText.setAttribute('class', 'svg-section-title');
            noLotsText.textContent = 'No burial lots configured in this block.';
            mapLotLayer.appendChild(noLotsText);
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
                tierTitleText.textContent = isEyeLevel ? `â­ Level ${tierLevel}` : `Level ${tierLevel}`;
                tierCard.appendChild(tierTitleText);

                // Subtitle: Height & description
                const tierSubText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                tierSubText.setAttribute('x', margin + 12);
                tierSubText.setAttribute('y', pillY + (pillH / 2) + 13);
                tierSubText.setAttribute('class', 'svg-tier-subtext');
                const tierDesc = isEyeLevel ? `${approxH} â€¢ Eye-Level` : (isTopTier ? `${approxH} â€¢ Top Vault` : (isBaseTier ? `${approxH} â€¢ Base Vault` : `${approxH} â€¢ Mid Tier`));
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
            mapLotLayer.appendChild(rulerGroup);
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
                ? `Level ${tierLevel} (${approxH}) â€” ${isEyeLevel ? 'Eye-Level (Optimal viewing height)' : (tierLevel === rows ? 'Top Tier Vault' : (tierLevel === 1 ? 'Base Tier (Wheelchair Accessible)' : 'Mid-Tier Vault'))}`
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
            statusText.textContent = isColumbarium ? `L${tierLevel} â€¢ ${lot.status}` : lot.status;
            lotGroup.appendChild(statusText);

            // Native Title for Tooltip Accessibility
            const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            titleEl.textContent = `${displayLabel} â€¢ Level ${tierLevel} (${approxH}) â€¢ ${lot.status} â€¢ ${formatCurrency(lot.price)}`;
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
                    ? `<br>Vertical Placement: <strong>Level ${tierLevel} (${approxH})</strong>${isEyeLevel ? ' <span style="color:#f59e0b;">â­ Eye-Level</span>' : ''}`
                    : `<br>Vertical Placement: <strong>Ground Level (Terraced Lawn)</strong>`;
                const idExtra = isSanitizedHash ? `<br><small style="opacity:0.75;">System Ref: ${escapeHtml(lot.lot_number)}</small>` : '';
                showFloatingTooltip(e, `<strong>${escapeHtml(displayLabel)}</strong>${elevHtml}<br>Status: ${escapeHtml(lot.status)}<br>Category: ${escapeHtml(lot.lot_type || 'Burial Plot')}<br>Price: ${formatCurrency(lot.price)}${idExtra}`);
            });
            lotGroup.addEventListener('mousemove', moveFloatingTooltip);
            lotGroup.addEventListener('mouseleave', hideFloatingTooltip);

            mapLotLayer.appendChild(lotGroup);
        });

        // Batch 11: Apply scheduled service markers to rendered lots
        highlightServiceLotsOnMap();
    }

    /**
     * 4. Select Lot & Open Details Drawer (Batch 6 Enhanced)
     */
    function selectLot(lot, block, section, lotElement) {
        state.selectedLot = lot;

        // Batch 8: Update Map View State to Lot Level
        state.mapViewLevel = 'lot';
        state.focusedSectionId = section ? section.section_id : null;
        state.focusedBlockId = block ? block.block_id : null;
        state.focusedLotId = lot.lot_id;
        state.currentSection = section;
        state.currentBlock = block;

        // Highlight parent section (Batch 8 spatial indicator)
        document.querySelectorAll('.svg-section-card.is-focused-section').forEach(el => el.classList.remove('is-focused-section'));
        if (section) {
            const secEl = document.querySelector(`.svg-section-card[data-section-id="${section.section_id}"]`);
            if (secEl) secEl.classList.add('is-focused-section');
        }

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

        // Batch 4: Vector Selection Reticle in #mapSelectionLayer
        if (mapSelectionLayer && lotElement) {
            mapSelectionLayer.innerHTML = '';
            const rectEl = lotElement.querySelector('rect');
            if (rectEl) {
                const lx = parseFloat(rectEl.getAttribute('x'));
                const ly = parseFloat(rectEl.getAttribute('y'));
                const lw = parseFloat(rectEl.getAttribute('width')) || 40;
                const lh = parseFloat(rectEl.getAttribute('height')) || 25;
                if (!isNaN(lx) && !isNaN(ly)) {
                    const pad = 4;
                    const selG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    selG.setAttribute('class', 'svg-selected-lot-indicator');
                    selG.innerHTML = `
                        <rect x="${lx - pad}" y="${ly - pad}" width="${lw + pad * 2}" height="${lh + pad * 2}" rx="5" class="svg-selection-glow" />
                        <rect x="${lx - 1}" y="${ly - 1}" width="${lw + 2}" height="${lh + 2}" rx="3" class="svg-selection-border" />
                        <path d="M ${lx - 4} ${ly + 3} L ${lx - 4} ${ly - 4} L ${lx + 3} ${ly - 4}" class="svg-selection-reticle" />
                        <path d="M ${lx + lw + 4} ${ly + 3} L ${lx + lw + 4} ${ly - 4} L ${lx + lw - 3} ${ly - 4}" class="svg-selection-reticle" />
                        <path d="M ${lx - 4} ${ly + lh - 3} L ${lx - 4} ${ly + lh + 4} L ${lx + 3} ${ly + lh + 4}" class="svg-selection-reticle" />
                        <path d="M ${lx + lw + 4} ${ly + lh - 3} L ${lx + lw + 4} ${ly + lh + 4} L ${lx + lw - 3} ${ly + lh + 4}" class="svg-selection-reticle" />
                    `;
                    mapSelectionLayer.appendChild(selG);

                    // Batch 4 Focus Behavior: If off-screen or low-zoom, smoothly bring into viewport
                    const margin = 40;
                    const inViewport = (
                        lx >= state.currentViewBox.x + margin &&
                        (lx + lw) <= (state.currentViewBox.x + state.currentViewBox.width - margin) &&
                        ly >= state.currentViewBox.y + margin &&
                        (ly + lh) <= (state.currentViewBox.y + state.currentViewBox.height - margin)
                    );
                    const zoomFactor = state.baseViewBox.width / (state.currentViewBox.width || 1);
                    if (!inViewport || zoomFactor < 1.35) {
                        const targetZoom = Math.min(state.currentViewBox.width / state.baseViewBox.width, 0.55);
                        centerViewOnPoint(lx + (lw / 2), ly + (lh / 2), targetZoom);
                    }
                }
            }
        }

        // Highlight parent block subtly
        document.querySelectorAll('.svg-block-card.is-focused').forEach(el => el.classList.remove('is-focused'));
        if (block && block.block_id) {
            const targetBlk = document.querySelector(`.svg-block-card[data-block-id="${block.block_id}"]`);
            if (targetBlk) targetBlk.classList.add('is-focused');
        }

        // Populate Drawer Header & Status
        drawerLotNumber.textContent = lot.lot_number;
        drawerStatusText.textContent = lot.status;

        // Status indicator dot styling
        const statusColors = {
            'Available': 'var(--lot-available)',
            'Reserved': 'var(--lot-reserved)',
            'Occupied': 'var(--lot-occupied)',
            'Unavailable': 'var(--lot-unavailable)',
            'Under Maintenance': 'var(--lot-unavailable)',
            'Expired': 'var(--lot-expired, #a855f7)',
        };
        drawerStatusDot.style.background = statusColors[lot.status] || 'var(--lot-unavailable)';

        drawerFacilityName.textContent = state.currentCemetery?.cemetery_name || 'â€”';
        drawerSectionName.textContent = section?.section_name || 'â€”';
        drawerBlockName.textContent = block?.block_name || 'â€”';
        drawerLotType.textContent = lot.lot_type || 'Standard Lawn';
        drawerDimensions.textContent = lot.dimensions || '1.0m Ã— 2.4m';
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
            const isColumbariumNiche = (function () {
                const sName = (section?.section_name || '').toLowerCase();
                const bName = (block?.block_name || '').toLowerCase();
                const lType = (lot?.lot_type || '').toLowerCase();
                return sName.includes('columbarium') || sName.includes('ossuary') ||
                       bName.includes('columbarium') || bName.includes('ossuary') ||
                       lType.includes('columbarium') || lType.includes('ossuary') || lType.includes('niche');
            })();

            if (isColumbariumNiche) {
                btnBookThisLot.href = `booking-assistant.html?service=cremation&lot_id=${lot.lot_id}&lot_number=${encodeURIComponent(lot.lot_number)}`;
            } else {
                btnBookThisLot.href = `booking-assistant.html?service=burial&lot_id=${lot.lot_id}&lot_number=${encodeURIComponent(lot.lot_number)}`;
            }
        } else {
            btnBookThisLot.style.display = 'none';
            btnLotUnavailable.style.display = 'inline-flex';
            btnLotUnavailable.innerHTML = `<i class="fas fa-lock"></i> Lot is ${escapeHtml(lot.status)}`;
        }

        // Batch 4: Load and Display Occupancy / Decedent Information
        loadOccupancyDetails(lot, block);

        // Batch 6: Populate On-Map Location Summary HUD
        if (mapLocationSummaryCard) {
            if (locSummarySection) locSummarySection.textContent = section?.section_name || 'â€”';
            if (locSummaryBlock) locSummaryBlock.textContent = block?.block_name || 'â€”';
            if (locSummaryLot) locSummaryLot.textContent = `Lot ${lot.lot_number}`;
            mapLocationSummaryCard.style.display = 'block';
        }

        // Batch 6: Populate Location Hierarchy Breadcrumb Trail
        if (drawerTrailFacility) drawerTrailFacility.textContent = state.currentCemetery?.cemetery_name || 'â€”';
        if (drawerTrailSection) drawerTrailSection.textContent = section?.section_name || 'â€”';
        if (drawerTrailBlock) drawerTrailBlock.textContent = block?.block_name || 'â€”';
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

        // Batch 10C: Populate Spatial Proximity, Terrain Elevation & Accessibility Card
        if (drawerAccessibilityCard) {
            const spatial = getLotSpatialMetrics(lot, block, section, state.currentCemetery);
            if (drawerWalkingDist) drawerWalkingDist.textContent = spatial.walkingDist;
            if (drawerTerrainElev) drawerTerrainElev.textContent = spatial.terrainElev;
            if (drawerParkingDist) drawerParkingDist.textContent = spatial.parkingDist;
            if (drawerPathwayCond) drawerPathwayCond.textContent = spatial.pathwayCond;
            if (drawerPwdBadge) {
                drawerPwdBadge.innerHTML = `<i class="fas ${spatial.pwdIcon}"></i> ${escapeHtml(spatial.pwdBadgeText)}`;
                drawerPwdBadge.className = `badge-pwd-status ${spatial.pwdBadgeClass}`;
            }
            drawerAccessibilityCard.style.display = 'block';
        }

        // Batch 11: Scheduled Today Service Banner in Lot Details Drawer
        if (drawerTodayServiceBanner) {
            const todaySvc = (state.todayServices || []).find(s => parseInt(s.lot_id, 10) === parseInt(lot.lot_id, 10));
            if (todaySvc) {
                drawerTodayServiceBanner.style.display = 'block';
                if (drawerServiceTime) drawerServiceTime.textContent = todaySvc.schedule_time ? formatServiceTime(todaySvc.schedule_time) : 'Today';
                if (drawerServiceDeceased) drawerServiceDeceased.textContent = todaySvc.deceased_name || 'Scheduled Service';
                if (drawerServiceType) drawerServiceType.textContent = `${todaySvc.service_type || 'Burial'} Service`;
                if (btnDrawerServiceRoute) {
                    btnDrawerServiceRoute.onclick = (e) => {
                        e.preventDefault();
                        routeToTodayService(todaySvc);
                    };
                }
            } else {
                drawerTodayServiceBanner.style.display = 'none';
            }
        }

        updateBreadcrumbs();
        updateViewLevelIndicator();

        // Open Drawer
        lotDetailsDrawer.classList.add('is-open');
        lotDetailsDrawer.setAttribute('aria-hidden', 'false');

        // Batch 6: If wayfinding route is currently active, recalibrate to the new destination lot
        if (state.activeRoute) {
            generateRouteToLot(lot, block, section, false);
        }
    }

    /**
     * Batch 4: Load and Render Lot Occupancy & Decedent Information
     * Handles Available, Reserved, Occupied, Expired, and Unavailable states
     * Strict privacy rules: no contact info or unredacted personal credentials displayed.
     */
    async function loadOccupancyDetails(lot, block) {
        if (!drawerOccupancyCard) return;

        state.selectionCounter = (state.selectionCounter || 0) + 1;
        const thisSelectionId = state.selectionCounter;

        const status = lot.status || 'Available';
        const statusClass = status.toLowerCase().replace(/\s+/g, '-');

        // Reset badge & card class
        drawerOccupancyCard.className = `drawer-section-card occupancy-card is-${statusClass}`;
        if (drawerOccupancyBadge) {
            drawerOccupancyBadge.className = `badge-occupancy-status status--${statusClass}`;
            drawerOccupancyBadge.textContent = status;
        }

        // Hide loading, error, empty, decedent details initially
        if (drawerOccupancyLoading) drawerOccupancyLoading.style.display = 'none';
        if (drawerOccupancyError) drawerOccupancyError.style.display = 'none';
        if (drawerDecedentDetails) drawerDecedentDetails.style.display = 'none';
        if (drawerOccupancyEmpty) drawerOccupancyEmpty.style.display = 'none';
        if (drawerOccupancyDesc) drawerOccupancyDesc.style.display = 'block';

        if (status === 'Available') {
            if (drawerOccupancyDesc) {
                drawerOccupancyDesc.textContent = 'This lot is currently available for immediate reservation and interment booking.';
            }
            return;
        }

        if (status === 'Expired') {
            if (drawerOccupancyDesc) {
                drawerOccupancyDesc.textContent = 'The lease agreement for this plot has expired. Subject to renewal or reclamation per municipal memorial guidelines.';
            }
            return;
        }

        if (status === 'Unavailable' || status === 'Under Maintenance') {
            if (drawerOccupancyDesc) {
                drawerOccupancyDesc.textContent = 'This lot is currently designated offline or undergoing maintenance work.';
            }
            return;
        }

        // Status is Occupied or Reserved -> Fetch detailed decedent/occupancy records
        if (lot._detailedInfo) {
            renderOccupancyData(lot._detailedInfo, status);
            return;
        }

        // Show loading state while fetching from API
        if (drawerOccupancyLoading) drawerOccupancyLoading.style.display = 'flex';
        if (drawerOccupancyDesc) drawerOccupancyDesc.style.display = 'none';

        try {
            const res = await api.request(`lots/${lot.lot_id}`, { method: 'GET' });
            
            // Check race condition (user may have clicked another lot before response returned)
            if (thisSelectionId !== state.selectionCounter) {
                return;
            }

            if (drawerOccupancyLoading) drawerOccupancyLoading.style.display = 'none';

            if (res && !res.error) {
                lot._detailedInfo = res;
                renderOccupancyData(res, status);
            } else {
                showOccupancyError();
            }
        } catch (err) {
            if (thisSelectionId === state.selectionCounter) {
                if (drawerOccupancyLoading) drawerOccupancyLoading.style.display = 'none';
                showOccupancyError();
            }
        }
    }

    function showOccupancyError() {
        if (drawerOccupancyError) drawerOccupancyError.style.display = 'flex';
        if (drawerOccupancyDesc) drawerOccupancyDesc.style.display = 'none';
        if (drawerDecedentDetails) drawerDecedentDetails.style.display = 'none';
        if (drawerOccupancyEmpty) drawerOccupancyEmpty.style.display = 'none';
    }

    function renderOccupancyData(data, status) {
        if (drawerOccupancyDesc) drawerOccupancyDesc.style.display = 'block';

        if (status === 'Reserved') {
            const schedDate = data.schedule_date ? formatDate(data.schedule_date) : null;
            if (drawerOccupancyDesc) {
                drawerOccupancyDesc.textContent = schedDate 
                    ? `This lot is currently reserved with a scheduled ceremony on ${schedDate}.`
                    : 'This lot currently has an active reservation in place.';
            }
            return;
        }

        if (status === 'Occupied') {
            const hasDecedent = data.occupant_name || data.decedent_id;
            if (hasDecedent) {
                if (drawerOccupancyDesc) {
                    drawerOccupancyDesc.textContent = 'This lot is interred and maintained under active cemetery perpetual care records.';
                }
                if (drawerDecedentDetails) {
                    drawerDecedentDetails.style.display = 'flex';
                    if (drawerOccupantName) drawerOccupantName.textContent = data.occupant_name || 'Registered Decedent';
                    
                    if (drawerDobRow && drawerOccupantDob) {
                        const dobFormatted = formatDate(data.dob);
                        if (dobFormatted) {
                            drawerOccupantDob.textContent = dobFormatted;
                            drawerDobRow.style.display = 'flex';
                        } else {
                            drawerDobRow.style.display = 'none';
                        }
                    }

                    if (drawerDodRow && drawerOccupantDod) {
                        const dodFormatted = formatDate(data.dod);
                        if (dodFormatted) {
                            drawerOccupantDod.textContent = dodFormatted;
                            drawerDodRow.style.display = 'flex';
                        } else {
                            drawerDodRow.style.display = 'none';
                        }
                    }

                    if (drawerBurialRow && drawerOccupantBurialDate) {
                        const burialDate = formatDate(data.lease_start_date || data.schedule_date);
                        if (burialDate) {
                            drawerOccupantBurialDate.textContent = burialDate;
                            drawerBurialRow.style.display = 'flex';
                        } else {
                            drawerBurialRow.style.display = 'none';
                        }
                    }

                    if (drawerDispositionRow && drawerOccupantDisposition) {
                        drawerOccupantDisposition.textContent = (data.is_cremated == 1) 
                            ? 'Cremated Remains (Niche / Urn Vault)'
                            : 'Casket Ground Interment';
                        drawerDispositionRow.style.display = 'flex';
                    }
                }
            } else {
                if (drawerOccupancyDesc) {
                    drawerOccupancyDesc.textContent = 'This lot is designated as Occupied in cemetery records.';
                }
                if (drawerOccupancyEmpty) {
                    drawerOccupancyEmpty.style.display = 'flex';
                }
            }
        }
    }

    /**
     * Date Formatting Helper (YYYY-MM-DD to readable format without timezone shifts)
     */
    function formatDate(dateStr) {
        if (!dateStr || dateStr === '0000-00-00' || dateStr === 'null') return null;
        try {
            const parts = String(dateStr).split(' ')[0].split('-');
            if (parts.length === 3) {
                const year = parseInt(parts[0], 10);
                const month = parseInt(parts[1], 10) - 1;
                const day = parseInt(parts[2], 10);
                const d = new Date(year, month, day);
                if (!isNaN(d.getTime())) {
                    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                }
            }
            return dateStr;
        } catch (e) {
            return dateStr;
        }
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
        if (mapSelectionLayer) {
            mapSelectionLayer.innerHTML = '';
        }
        document.querySelectorAll('.svg-block-card.is-focused').forEach(el => {
            el.classList.remove('is-focused');
        });
        if (mapLocationSummaryCard) {
            mapLocationSummaryCard.style.display = 'none';
        }
        if (drawerYouAreHereBadge) {
            drawerYouAreHereBadge.style.display = 'none';
        }
        clearRoute();
        updateBreadcrumbs();
        document.querySelectorAll('.svg-lot-tile.is-selected').forEach(el => {
            el.classList.remove('is-selected');
        });
    }

    /**
     * =========================================================================
     * BATCH 6: INTERNAL CEMETERY ROUTE / WAYFINDING (MAIN GATE TO SELECTED LOT)
     * =========================================================================
     */

    /**
     * Dijkstra Shortest Path Solver
     * Computes the deterministic shortest path along MASTER_MAP_NETWORK
     * @param {string} startNodeId - Origin node ID (typically 'MAIN_GATE')
     * @param {string} targetNodeId - Destination access node ID
     * @returns {{ path: string[], totalDist: number } | null}
     */
    function dijkstraShortestPath(startNodeId, targetNodeId) {
        const nodes = MASTER_MAP_NETWORK.nodes;
        const edges = MASTER_MAP_NETWORK.edges;
        if (!nodes[startNodeId] || !nodes[targetNodeId]) return null;
        if (startNodeId === targetNodeId) return { path: [startNodeId], totalDist: 0 };

        // Adjacency graph
        const adj = {};
        Object.keys(nodes).forEach(id => { adj[id] = []; });
        edges.forEach(([u, v]) => {
            if (nodes[u] && nodes[v]) {
                const dist = Math.hypot(nodes[u].x - nodes[v].x, nodes[u].y - nodes[v].y);
                adj[u].push({ id: v, dist });
                adj[v].push({ id: u, dist });
            }
        });

        const dist = {};
        const prev = {};
        const unvisited = new Set(Object.keys(nodes));

        Object.keys(nodes).forEach(id => {
            dist[id] = Infinity;
            prev[id] = null;
        });
        dist[startNodeId] = 0;

        while (unvisited.size > 0) {
            let curr = null;
            let smallest = Infinity;
            for (const id of unvisited) {
                if (dist[id] < smallest) {
                    smallest = dist[id];
                    curr = id;
                }
            }

            if (curr === null || smallest === Infinity || curr === targetNodeId) break;
            unvisited.delete(curr);

            const neighbors = adj[curr] || [];
            for (const neighbor of neighbors) {
                if (!unvisited.has(neighbor.id)) continue;
                const alt = dist[curr] + neighbor.dist;
                if (alt < dist[neighbor.id]) {
                    dist[neighbor.id] = alt;
                    prev[neighbor.id] = curr;
                }
            }
        }

        if (dist[targetNodeId] === Infinity) return null;

        const path = [];
        let c = targetNodeId;
        while (c) {
            path.unshift(c);
            c = prev[c];
        }
        return { path, totalDist: dist[targetNodeId] };
    }

    /**
     * Resolve Destination Coordinates and Nearest Access Node for a Lot
     */
    function resolveLotWayfindingTarget(lot, block, section) {
        if (!lot) return null;

        let lotCenter = null;
        const lotTile = document.querySelector(`.svg-lot-tile[data-lot-id="${lot.lot_id}"]`);
        if (lotTile) {
            const rect = lotTile.querySelector('rect') || lotTile;
            const lx = parseFloat(rect.getAttribute('x'));
            const ly = parseFloat(rect.getAttribute('y'));
            const lw = parseFloat(rect.getAttribute('width')) || 30;
            const lh = parseFloat(rect.getAttribute('height')) || 24;
            if (!isNaN(lx) && !isNaN(ly)) {
                lotCenter = { x: lx + (lw / 2), y: ly + (lh / 2) };
            }
        }

        // Fallback to block card center if lot tile is not yet rendered
        if (!lotCenter && block) {
            const blkCard = document.querySelector(`.svg-block-card[data-block-id="${block.block_id}"]`);
            if (blkCard) {
                const rect = blkCard.querySelector('rect') || blkCard;
                const bx = parseFloat(rect.getAttribute('x'));
                const by = parseFloat(rect.getAttribute('y'));
                const bw = parseFloat(rect.getAttribute('width')) || 160;
                const bh = parseFloat(rect.getAttribute('height')) || 110;
                if (!isNaN(bx) && !isNaN(by)) {
                    lotCenter = { x: bx + (bw / 2), y: by + (bh / 2) };
                }
            }
        }

        if (!lotCenter) {
            lotCenter = { x: 800, y: 420 };
        }

        // Determine candidate access nodes based on Section hierarchy
        const sName = (section?.section_name || '').toLowerCase();
        let candidateNodeIds = null;

        if (sName.includes('a') || sName.includes('everlasting')) {
            candidateNodeIds = ['SEC_A_SPINE_LEFT', 'SEC_A_SPINE_RIGHT', 'SEC_A_WEST_ACCESS', 'SEC_A_EAST_ACCESS', 'CENTRAL_ROUNDABOUT', 'PROMENADE_JUNCTION'];
        } else if (sName.includes('b') || sName.includes('lourdes')) {
            candidateNodeIds = ['SEC_B_WEST_ACCESS', 'SEC_B_EAST_ACCESS', 'MID_WEST_CROSSWAY', 'WEST_CROSSWAY', 'WEST_PROM'];
        } else if (sName.includes('c') || sName.includes('san jose')) {
            candidateNodeIds = ['SEC_C_SOUTH_ACCESS', 'SEC_C_NORTH_ACCESS', 'SEC_SAN_JOSE', 'MID_WEST_PROM', 'NORTH_MID_WEST'];
        } else if (sName.includes('d') || sName.includes('columbarium') || sName.includes('ossuary')) {
            candidateNodeIds = ['SEC_D_SOUTH_ACCESS', 'SEC_D_NORTH_ACCESS', 'SEC_COLUMBARIUM', 'MID_EAST_PROM', 'NORTH_MID_EAST'];
        } else if (sName.includes('e') || sName.includes('transfiguration')) {
            candidateNodeIds = ['SEC_E_WEST_ACCESS', 'SEC_E_EAST_ACCESS', 'SEC_E_SOUTH_ACCESS', 'MID_EAST_CROSSWAY', 'EAST_CROSSWAY'];
        }

        // If no candidate list matched, evaluate all network nodes
        if (!candidateNodeIds || candidateNodeIds.length === 0) {
            candidateNodeIds = Object.keys(MASTER_MAP_NETWORK.nodes);
        }

        // Find nearest candidate node to lot center
        let bestNodeId = null;
        let minDistance = Infinity;
        candidateNodeIds.forEach(id => {
            const node = MASTER_MAP_NETWORK.nodes[id];
            if (node) {
                const dist = Math.hypot(node.x - lotCenter.x, node.y - lotCenter.y);
                if (dist < minDistance) {
                    minDistance = dist;
                    bestNodeId = id;
                }
            }
        });

        return {
            lotCenter,
            accessNodeId: bestNodeId || 'CENTRAL_ROUNDABOUT'
        };
    }

    /**
     * BATCH 7: Build Human-Readable Route Guidance Steps
     * Converts Dijkstra route nodes & access walkway points into structured, landmark-aware steps.
     * @param {Array} routePoints - Sequence of route coordinate objects
     * @param {Object} lot - Target lot
     * @param {Object} block - Parent block
     * @param {Object} section - Parent section
     * @param {Object} accessNode - Section access node
     * @returns {Array} List of step objects
     */
    function buildRouteGuidance(routePoints, lot, block, section, accessNode) {
        if (!routePoints || routePoints.length === 0) return [];

        const steps = [];

        routePoints.forEach((pt, idx) => {
            const step = {
                index: idx + 1,
                point: { x: pt.x, y: pt.y },
                type: pt.type,
                nodeId: pt.nodeId || null,
                title: '',
                instruction: '',
                category: 'road',
                icon: 'fa-road',
                landmark: null
            };

            if (pt.type === 'start') {
                step.title = pt.label || 'Main Gate Portal';
                step.instruction = 'Enter cemetery grounds via main portal from P. Aquino Avenue';
                step.category = 'start';
                step.icon = 'fa-door-open';
                step.landmark = 'Main Gate';
            } else if (pt.type === 'destination') {
                step.title = `Lot ${lot.lot_number}`;
                step.instruction = `Arrive at destination plot (${section?.section_name || 'Section'} · ${block?.block_name || 'Block'})`;
                step.category = 'destination';
                step.icon = 'fa-location-dot';
                step.landmark = 'Destination';
            } else if (pt.type === 'walkway') {
                step.title = `${block?.block_name || 'Block'} Walkway`;
                step.instruction = `Follow paved pedestrian walkway toward ${block?.block_name || 'Block'}`;
                step.category = 'block';
                step.icon = 'fa-person-walking';
                step.landmark = block?.block_name || null;
            } else {
                // Internal network node
                const isAccessNode = (pt.nodeId && accessNode && pt.nodeId === accessNode.id);
                const isRoundabout = (pt.nodeId === 'CENTRAL_ROUNDABOUT' || (pt.label && pt.label.toLowerCase().includes('roundabout')));

                if (isAccessNode) {
                    step.title = pt.label || `${section?.section_name || 'Section'} Access Road`;
                    step.instruction = `Turn into ${section?.section_name || 'Section'} access road`;
                    step.category = 'section';
                    step.icon = 'fa-signs-post';
                    step.landmark = section?.section_name || 'Section Access';
                } else if (isRoundabout) {
                    step.title = pt.label || 'Memorial Roundabout';
                    step.instruction = 'Navigate through central memorial roundabout';
                    step.category = 'roundabout';
                    step.icon = 'fa-arrows-spin';
                    step.landmark = 'Roundabout';
                } else if (pt.nodeId === 'SOUTH_JUNCTION') {
                    step.title = pt.label || 'St. Joseph Drive Junction';
                    step.instruction = 'Follow St. Joseph Drive toward central cemetery corridor';
                    step.category = 'junction';
                    step.icon = 'fa-road';
                    step.landmark = 'St. Joseph Drive';
                } else if (pt.nodeId === 'CREMATORIUM_SPINE') {
                    step.title = pt.label || 'Central Spine (Mid South)';
                    step.instruction = 'Proceed north past crematorium and chapel access';
                    step.category = 'road';
                    step.icon = 'fa-road';
                    step.landmark = 'Central Spine';
                } else if (pt.label && pt.label.toLowerCase().includes('crossway')) {
                    step.title = pt.label;
                    step.instruction = 'Continue through crossway intersection';
                    step.category = 'junction';
                    step.icon = 'fa-road';
                    step.landmark = 'Crossway';
                } else if (pt.label && pt.label.toLowerCase().includes('promenade')) {
                    step.title = pt.label;
                    step.instruction = 'Follow internal promenade walkway';
                    step.category = 'road';
                    step.icon = 'fa-road';
                    step.landmark = 'Promenade';
                } else {
                    step.title = pt.label || `Waypoint ${idx + 1}`;
                    step.instruction = `Follow cemetery road toward ${section?.section_name || 'Section'}`;
                    step.category = 'road';
                    step.icon = 'fa-road';
                    step.landmark = null;
                }
            }

            steps.push(step);
        });

        return steps;
    }

    /**
     * Generate Route from Main Gate to Selected Lot (Batch 6 & Batch 7)
     * @param {Object} lot - Target Lot
     * @param {Object} block - Parent Block
     * @param {Object} section - Parent Section
     * @param {boolean} autoFit - Whether to smoothly fit viewport around route
     */
    function generateRouteToLot(lot, block, section, autoFit = true) {
        if (!lot) return;

        // If drilled into a single block view, return to master overview to see full route
        if (state.viewLevel === 'block') {
            returnToCemeteryOverview();
        }

        const target = resolveLotWayfindingTarget(lot, block, section);
        if (!target) {
            showRouteError('Route unavailable for this location. Invalid destination coordinates.');
            return;
        }

        const startNodeId = 'MAIN_GATE';
        const solverResult = dijkstraShortestPath(startNodeId, target.accessNodeId);
        if (!solverResult || !solverResult.path || solverResult.path.length === 0) {
            showRouteError('Route unavailable for this location. This lot does not currently have a connected access path in the cemetery map.');
            return;
        }

        const nodes = MASTER_MAP_NETWORK.nodes;
        const routePoints = [];

        // 1. Road network nodes from Main Gate to Section Access Node
        solverResult.path.forEach((nodeId, idx) => {
            const node = nodes[nodeId];
            routePoints.push({
                x: node.x,
                y: node.y,
                label: node.label || nodeId,
                type: idx === 0 ? 'start' : 'network',
                nodeId: nodeId
            });
        });

        // 2. Section access to Block / Lot walkway connector
        const accessNode = nodes[target.accessNodeId];
        const lotPt = target.lotCenter;

        // Add orthogonal pathway corner inside section/block
        const dx = Math.abs(lotPt.x - accessNode.x);
        const dy = Math.abs(lotPt.y - accessNode.y);
        if (dx > 8 && dy > 8) {
            if (dy < dx) {
                routePoints.push({
                    x: lotPt.x,
                    y: accessNode.y,
                    label: `${block?.block_name || 'Block'} Access Walkway`,
                    type: 'walkway',
                    nodeId: 'BLOCK_WALKWAY'
                });
            } else {
                routePoints.push({
                    x: accessNode.x,
                    y: lotPt.y,
                    label: `${block?.block_name || 'Block'} Access Walkway`,
                    type: 'walkway',
                    nodeId: 'BLOCK_WALKWAY'
                });
            }
        }

        // 3. Exact Lot Destination endpoint
        routePoints.push({
            x: lotPt.x,
            y: lotPt.y,
            label: `Lot ${lot.lot_number}`,
            type: 'destination',
            nodeId: `LOT_${lot.lot_id || lot.lot_number}`
        });

        // Calculate total map distance
        let totalMapDist = 0;
        for (let i = 0; i < routePoints.length - 1; i++) {
            totalMapDist += Math.hypot(routePoints[i + 1].x - routePoints[i].x, routePoints[i + 1].y - routePoints[i].y);
        }

        // Generate Batch 7 Human-Readable Guidance Steps
        const guidanceSteps = buildRouteGuidance(routePoints, lot, block, section, accessNode);

        // Cache active route state
        state.activeRoute = {
            lot,
            block,
            section,
            points: routePoints,
            steps: guidanceSteps,
            totalDist: totalMapDist,
            activeStepIndex: 0
        };

        // Render SVG elements in #mapRouteLayer with interactive waypoint markers
        renderRouteSvg(routePoints, lot, block, section, guidanceSteps);

        // Update Route Information HUD Card with structured step list
        updateRouteInfoCard(routePoints, totalMapDist, lot, block, section, accessNode, guidanceSteps);

        // Activate step 1 initially without overriding the full route framing
        setActiveRouteStep(0, false);

        // Hide location summary HUD while wayfinding route card is active so they don't overlap
        if (mapLocationSummaryCard) {
            mapLocationSummaryCard.style.display = 'none';
        }

        if (autoFit) {
            fitRouteToViewport(routePoints);
        }
    }

    /**
     * Render Route SVG in #mapRouteLayer (Batch 6 & Batch 7)
     * Renders path line, glow underlay, start/destination markers, and interactive intermediate waypoints.
     */
    function renderRouteSvg(points, lot, block, section, guidanceSteps) {
        if (!mapRouteLayer) {
            ensureSvgLayers();
        }
        if (!mapRouteLayer) return;
        mapRouteLayer.innerHTML = '';

        if (points.length < 2) return;

        // Build SVG path data
        let d = `M ${points[0].x} ${points[0].y}`;
        for (let i = 1; i < points.length; i++) {
            d += ` L ${points[i].x} ${points[i].y}`;
        }

        const routeGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        routeGroup.setAttribute('class', 'svg-cemetery-route-group');
        const isCortege = !!state.activeCortegeService;
        if (isCortege) {
            routeGroup.classList.add('is-cortege-route');
        }

        // 1. Route Glow Underlay
        const underlay = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        underlay.setAttribute('d', d);
        underlay.setAttribute('class', `svg-route-underlay ${isCortege ? 'is-cortege-route' : ''}`);
        underlay.setAttribute('fill', 'none');
        routeGroup.appendChild(underlay);

        // 2. Main Animated Route Line
        const mainLine = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        mainLine.setAttribute('d', d);
        mainLine.setAttribute('class', `svg-route-line ${isCortege ? 'is-cortege-route' : ''}`);
        mainLine.setAttribute('fill', 'none');
        mainLine.setAttribute('marker-mid', 'url(#routeArrowMarker)');
        mainLine.setAttribute('marker-end', 'url(#routeArrowMarker)');
        routeGroup.appendChild(mainLine);

        // 3. Batch 7: Intermediate Waypoint Markers
        if (guidanceSteps && guidanceSteps.length > 2) {
            for (let idx = 1; idx < guidanceSteps.length - 1; idx++) {
                const step = guidanceSteps[idx];
                const wpG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                wpG.setAttribute('class', 'svg-route-waypoint');
                wpG.setAttribute('data-step-index', String(idx));
                wpG.setAttribute('transform', `translate(${step.point.x}, ${step.point.y})`);
                wpG.setAttribute('tabindex', '0');
                wpG.setAttribute('role', 'button');
                wpG.setAttribute('aria-label', `Route Step ${idx + 1}: ${step.title}`);
                wpG.innerHTML = `
                    <circle class="svg-waypoint-hitbox" cx="0" cy="0" r="14" />
                    <circle class="svg-waypoint-circle" cx="0" cy="0" r="5.5" />
                    <circle class="svg-waypoint-core" cx="0" cy="0" r="2.5" />
                `;
                wpG.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setActiveRouteStep(idx, true);
                });
                wpG.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        setActiveRouteStep(idx, true);
                    }
                });
                routeGroup.appendChild(wpG);
            }
        }

        // 4. Start Marker (Main Gate)
        const startPt = points[0];
        const startG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        startG.setAttribute('class', 'route-marker-start');
        startG.setAttribute('transform', `translate(${startPt.x}, ${startPt.y})`);
        startG.setAttribute('tabindex', '0');
        startG.setAttribute('role', 'button');
        startG.setAttribute('aria-label', 'Route Step 1: Main Gate Portal');
        startG.style.cursor = 'pointer';
        startG.innerHTML = `
            <circle class="route-marker-pulse start-pulse" cx="0" cy="0" r="16" />
            <circle class="route-marker-dot start-dot" cx="0" cy="0" r="7" />
            <rect class="route-badge-bg start-badge-bg" x="-52" y="12" width="104" height="20" rx="10" />
            <text class="route-badge-text" x="0" y="25.5" text-anchor="middle">● START Main Gate</text>
        `;
        startG.addEventListener('click', (e) => {
            e.stopPropagation();
            setActiveRouteStep(0, true);
        });
        startG.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setActiveRouteStep(0, true);
            }
        });
        routeGroup.appendChild(startG);

        // 5. Destination Marker (Exact Selected Lot)
        const destPt = points[points.length - 1];
        const destIdx = (guidanceSteps ? guidanceSteps.length - 1 : points.length - 1);
        const destG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        destG.setAttribute('class', 'route-marker-dest');
        destG.setAttribute('transform', `translate(${destPt.x}, ${destPt.y})`);
        destG.setAttribute('tabindex', '0');
        destG.setAttribute('role', 'button');
        destG.setAttribute('aria-label', `Route Step ${destIdx + 1}: ${lot.lot_number ? 'Destination Lot ' + lot.lot_number : 'Destination Facility'}`);
        destG.style.cursor = 'pointer';
        const badgeLabel = isCortege
            ? `● FUNERAL CORTÈGE ${lot.lot_number ? 'Lot ' + escapeHtml(lot.lot_number) : 'Facility'}`
            : `● DESTINATION ${lot.lot_number ? 'Lot ' + escapeHtml(lot.lot_number) : 'Facility'}`;
        const badgeW = Math.max(120, badgeLabel.length * 6.5 + 24);
        destG.innerHTML = `
            <circle class="route-marker-pulse dest-pulse ${isCortege ? 'cortege-pulse' : ''}" cx="0" cy="0" r="18" />
            <circle class="route-marker-dot dest-dot ${isCortege ? 'cortege-dot' : ''}" cx="0" cy="0" r="7" />
            <rect class="route-badge-bg dest-badge-bg ${isCortege ? 'cortege-badge-bg' : ''}" x="${-badgeW / 2}" y="-32" width="${badgeW}" height="22" rx="11" />
            <text class="route-badge-text" x="0" y="-17.5" text-anchor="middle">${badgeLabel}</text>
        `;
        destG.addEventListener('click', (e) => {
            e.stopPropagation();
            setActiveRouteStep(destIdx, true);
        });
        destG.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                e.stopPropagation();
                setActiveRouteStep(destIdx, true);
            }
        });
        routeGroup.appendChild(destG);

        mapRouteLayer.appendChild(routeGroup);
    }

    /**
     * BATCH 7: Set Active Route Step
     * Emphasizes waypoint in list and on SVG map, updates progress indicator, and optionally focuses camera.
     * @param {number} stepIndex - Zero-based index of the step to activate
     * @param {boolean} shouldFocusCamera - Whether to animate camera to waypoint
     */
    function setActiveRouteStep(stepIndex, shouldFocusCamera = true) {
        if (!state.activeRoute || !state.activeRoute.steps || state.activeRoute.steps.length === 0) return;

        const steps = state.activeRoute.steps;
        const clampedIndex = Math.max(0, Math.min(steps.length - 1, stepIndex));
        state.activeRoute.activeStepIndex = clampedIndex;
        const activeStep = steps[clampedIndex];

        // 1. Update Progress Header and Counter
        if (routeStepProgress) {
            routeStepProgress.textContent = `Step ${clampedIndex + 1} of ${steps.length}`;
        }
        if (routeStepCounter) {
            routeStepCounter.textContent = `${clampedIndex + 1} / ${steps.length}`;
        }

        // 2. Update Prev / Next Button States
        if (btnPrevStep) {
            btnPrevStep.disabled = (clampedIndex <= 0);
        }
        if (btnNextStep) {
            btnNextStep.disabled = (clampedIndex >= steps.length - 1);
        }

        // 3. Update Step List Selection
        if (routeWaypointsList) {
            const items = routeWaypointsList.querySelectorAll('.route-waypoint-item');
            items.forEach((item, idx) => {
                const isActive = (idx === clampedIndex);
                item.classList.toggle('is-active', isActive);
                item.setAttribute('aria-current', isActive ? 'step' : 'false');
                if (isActive) {
                    item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
                }
            });
        }

        // 4. Update SVG Active Reticle and Node Highlighting
        if (mapRouteLayer) {
            const existingReticle = mapRouteLayer.querySelector('.svg-active-waypoint-reticle');
            if (existingReticle) {
                existingReticle.remove();
            }

            const wpNodes = mapRouteLayer.querySelectorAll('.svg-route-waypoint');
            wpNodes.forEach(wp => {
                const idx = parseInt(wp.getAttribute('data-step-index'), 10);
                wp.classList.toggle('is-active', idx === clampedIndex);
            });

            if (activeStep && activeStep.point) {
                const reticleG = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                reticleG.setAttribute('class', 'svg-active-waypoint-reticle');
                reticleG.setAttribute('transform', `translate(${activeStep.point.x}, ${activeStep.point.y})`);
                reticleG.innerHTML = `
                    <circle class="reticle-ring-pulse" cx="0" cy="0" r="14" />
                    <circle class="reticle-ring-inner" cx="0" cy="0" r="8" />
                    <circle class="reticle-center-dot" cx="0" cy="0" r="3.5" />
                `;
                mapRouteLayer.appendChild(reticleG);
            }
        }

        // 5. Smooth Camera Centering on Waypoint
        if (shouldFocusCamera && activeStep && activeStep.point) {
            focusRouteWaypoint(activeStep.point);
        }
    }

    /**
     * BATCH 7: Focus Camera Viewport on Route Waypoint
     * Zooms and centers around a waypoint while preserving road and surrounding context.
     * @param {Object} point - { x, y } coordinates
     */
    function focusRouteWaypoint(point) {
        if (!point) return;
        const viewW = 600;
        const viewH = 375;
        const targetX = Math.max(0, Math.min(state.baseViewBox.width - viewW, point.x - (viewW / 2)));
        const targetY = Math.max(0, Math.min(state.baseViewBox.height - viewH, point.y - (viewH / 2)));
        animateViewBox(targetX, targetY, viewW, viewH, 320);
    }

    /**
     * Update Route Information Card UI (Batch 6 & Batch 7)
     */
    function updateRouteInfoCard(points, totalDist, lot, block, section, accessNode, guidanceSteps) {
        if (!mapRouteInfoCard) return;

        if (state.activeCortegeService) {
            if (routeInfoTitle) routeInfoTitle.textContent = `Today's Service Cortège • ${state.activeCortegeService.deceased_name}`;
            mapRouteInfoCard.classList.add('is-cortege-route');
        } else {
            if (routeInfoTitle) routeInfoTitle.textContent = 'Route Navigation';
            mapRouteInfoCard.classList.remove('is-cortege-route');
        }

        if (routeStartLabel) routeStartLabel.textContent = 'Main Gate (Portal)';
        if (routeDestLabel) {
            if (lot && lot.lot_number) {
                routeDestLabel.textContent = `Lot ${lot.lot_number} · ${section?.section_name || 'Section'} · ${block?.block_name || 'Block'}`;
            } else {
                routeDestLabel.textContent = state.activeCortegeService?.facility_name || 'Municipal Crematorium';
            }
        }
        if (routeMetricDistance) {
            routeMetricDistance.textContent = `${Math.round(totalDist)} map units`;
        }
        if (routeMetricVia) {
            routeMetricVia.textContent = `Central Spine › ${accessNode?.label || 'Access Way'}`;
        }

        const steps = guidanceSteps || buildRouteGuidance(points, lot, block, section, accessNode);

        if (routeStepProgress) {
            routeStepProgress.textContent = `Step 1 of ${steps.length}`;
        }
        if (routeStepCounter) {
            routeStepCounter.textContent = `1 / ${steps.length}`;
        }
        if (btnPrevStep) {
            btnPrevStep.disabled = true;
        }
        if (btnNextStep) {
            btnNextStep.disabled = (steps.length <= 1);
        }

        if (routeWaypointsList) {
            routeWaypointsList.innerHTML = '';
            steps.forEach((step, idx) => {
                const li = document.createElement('li');
                li.className = `route-waypoint-item ${idx === 0 ? 'is-active' : ''}`;
                li.setAttribute('data-step-index', String(idx));
                li.setAttribute('tabindex', '0');
                li.setAttribute('role', 'button');
                li.setAttribute('aria-label', `Route step ${idx + 1}: ${step.title}. ${step.instruction}`);
                li.setAttribute('aria-current', idx === 0 ? 'step' : 'false');

                const landmarkBadge = step.landmark 
                    ? `<span class="waypoint-landmark-badge"><i class="fas fa-landmark"></i> ${escapeHtml(step.landmark)}</span>`
                    : '';

                li.innerHTML = `
                    <div class="waypoint-step-num">${idx + 1}</div>
                    <i class="fas ${step.icon} waypoint-icon"></i>
                    <div class="waypoint-details">
                        <div class="waypoint-title-row">
                            <strong class="waypoint-title">${escapeHtml(step.title)}</strong>
                            ${landmarkBadge}
                        </div>
                        <span class="waypoint-instruction">${escapeHtml(step.instruction)}</span>
                    </div>
                `;

                li.addEventListener('click', (e) => {
                    e.stopPropagation();
                    setActiveRouteStep(idx, true);
                });

                li.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        e.stopPropagation();
                        setActiveRouteStep(idx, true);
                    }
                });

                routeWaypointsList.appendChild(li);
            });
        }

        mapRouteInfoCard.style.display = 'block';
    }

    /**
     * Display Route Error Gracefully
     */
    function showRouteError(message) {
        clearRoute();
        if (mapRouteInfoCard && routeWaypointsList) {
            if (routeInfoTitle) routeInfoTitle.textContent = 'Route Notice';
            if (routeStartLabel) routeStartLabel.textContent = 'Main Gate';
            if (routeDestLabel) routeDestLabel.textContent = state.selectedLot ? `Lot ${state.selectedLot.lot_number}` : 'Selected Destination';
            if (routeMetricDistance) routeMetricDistance.textContent = 'Unavailable';
            if (routeMetricVia) routeMetricVia.textContent = 'None';
            routeWaypointsList.innerHTML = `
                <li class="route-waypoint-item route-error-item" style="color:#ef4444; padding:8px 12px; font-size:0.85rem;">
                    <i class="fas fa-circle-exclamation" style="margin-right:8px;"></i>
                    ${escapeHtml(message)}
                </li>
            `;
            mapRouteInfoCard.style.display = 'block';
        }
    }

    /**
     * Fit Camera Viewport to Route Points
     */
    function fitRouteToViewport(points) {
        if (!points || points.length === 0) return;

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        points.forEach(pt => {
            if (pt.x < minX) minX = pt.x;
            if (pt.y < minY) minY = pt.y;
            if (pt.x > maxX) maxX = pt.x;
            if (pt.y > maxY) maxY = pt.y;
        });

        const padX = 120;
        const padY = 90;
        minX = Math.max(0, minX - padX);
        minY = Math.max(0, minY - padY);
        maxX = Math.min(state.baseViewBox.width, maxX + padX);
        maxY = Math.min(state.baseViewBox.height, maxY + padY);

        const routeW = Math.max(maxX - minX, 500);
        const routeH = Math.max(maxY - minY, 350);

        // Maintain canvas aspect ratio
        const aspect = state.baseViewBox.width / state.baseViewBox.height;
        let targetW = routeW;
        let targetH = targetW / aspect;

        if (targetH < routeH) {
            targetH = routeH;
            targetW = targetH * aspect;
        }

        // Center on route bounding box
        const centerX = minX + (routeW / 2);
        const centerY = minY + (routeH / 2);
        const targetX = Math.max(0, Math.min(state.baseViewBox.width - targetW, centerX - (targetW / 2)));
        const targetY = Math.max(0, Math.min(state.baseViewBox.height - targetH, centerY - (targetH / 2)));

        animateViewBox(targetX, targetY, targetW, targetH, 380);
    }

    /**
     * Clear / Reset Route (Batch 6 & Batch 7)
     */
    function clearRoute() {
        if (mapRouteLayer) {
            mapRouteLayer.innerHTML = '';
        }
        if (mapRouteInfoCard) {
            mapRouteInfoCard.style.display = 'none';
        }
        if (mapLocationSummaryCard) {
            mapLocationSummaryCard.style.display = 'none';
        }
        if (btnPrevStep) {
            btnPrevStep.disabled = true;
        }
        if (btnNextStep) {
            btnNextStep.disabled = true;
        }
        state.activeRoute = null;
        state.activeCortegeService = null;
        if (mapRouteInfoCard) {
            mapRouteInfoCard.classList.remove('is-cortege-route');
        }
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
            badge: '3D Lawn Lot Perspective',
            capacity: '2 Caskets (Double-Depth) + 4 Urns',
            dimensions: '1.0m Ã— 2.44m (Single Plot)',
            priceTier: 'â‚±45,000 â€“ â‚±180,000',
            materials: {
                surface: 'Flush Imperial Black Granite & Cast Bronze Inlay',
                structure: 'Class-A Reinforced Double-Depth Concrete Vault',
                drainage: 'Subterranean Dry-Well Gravel Drainage (Flood-Proof)'
            },
            monumentRule: 'Flush ground marker only (Bronze or granite slab, level with turf)',
            perpetualCare: 'Covered (Lawn mowing, ground leveling & perimeter security)',
            intermentPrivilege: 'Double-depth vault (2 Caskets) + 4 cremains urns',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <defs>
        <linearGradient id="lawn3dSky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#7dd3fc"/>
            <stop offset="60%" stop-color="#bae6fd"/>
            <stop offset="100%" stop-color="#ecfdf5"/>
        </linearGradient>
        <linearGradient id="lawn3dTurf" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#4ade80"/>
            <stop offset="25%" stop-color="#22c55e"/>
            <stop offset="70%" stop-color="#16a34a"/>
            <stop offset="100%" stop-color="#14532d"/>
        </linearGradient>
        <linearGradient id="graniteBevel" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#475569"/>
            <stop offset="50%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#090d16"/>
        </linearGradient>
        <linearGradient id="bronzeShine" x1="0%" y1="0%" x2="100%" y2="40%">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="35%" stop-color="#eab308"/>
            <stop offset="75%" stop-color="#a16207"/>
            <stop offset="100%" stop-color="#713f12"/>
        </linearGradient>
        <filter id="markerShad" x="-10%" y="-10%" width="125%" height="135%">
            <feDropShadow dx="3" dy="6" stdDeviation="4" flood-opacity="0.35"/>
        </filter>
    </defs>
    <!-- Sky & Background Trees -->
    <rect x="0" y="0" width="340" height="75" fill="url(#lawn3dSky)"/>
    <circle cx="305" cy="24" r="16" fill="#fef08a" opacity="0.85"/>
    <path d="M0,75 Q40,62 90,75 Q150,60 210,75 Q280,64 340,75 L340,75 L0,75 Z" fill="#86efac" opacity="0.45"/>
    <circle cx="35" cy="65" r="14" fill="#166534" opacity="0.7"/>
    <circle cx="55" cy="67" r="12" fill="#15803d" opacity="0.8"/>
    <circle cx="310" cy="66" r="15" fill="#166534" opacity="0.7"/>
    <!-- 3D Angled Lawn Plane -->
    <polygon points="0,75 340,75 340,160 0,160" fill="url(#lawn3dTurf)"/>
    <!-- Stone Path Borders (Subtle 3D Perspective Lines) -->
    <line x1="20" y1="75" x2="0" y2="160" stroke="#86efac" stroke-width="0.75" opacity="0.4"/>
    <line x1="320" y1="75" x2="340" y2="160" stroke="#86efac" stroke-width="0.75" opacity="0.4"/>
    <!-- 3D Sunken Granite Marker Foundation Frame -->
    <polygon points="65,92 275,92 295,142 45,142" fill="rgba(15, 23, 42, 0.45)" filter="url(#markerShad)"/>
    <!-- Beveled Granite Base -->
    <polygon points="68,90 272,90 290,138 50,138" fill="url(#graniteBevel)" stroke="#0f172a" stroke-width="1.5"/>
    <!-- Top Polished Face Inlay -->
    <polygon points="76,94 264,94 280,133 60,133" fill="#1e293b" stroke="#334155" stroke-width="1"/>
    <!-- Cast Bronze Commemorative Plate -->
    <polygon points="88,99 252,99 265,128 75,128" fill="url(#bronzeShine)" stroke="#854d0e" stroke-width="1.2"/>
    <!-- Bronze Marker Etched Inscription -->
    <text x="170" y="112" fill="#451a03" font-size="7.5" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif" letter-spacing="1.5">IN LOVING MEMORY</text>
    <line x1="110" y1="116" x2="230" y2="116" stroke="#713f12" stroke-width="0.75"/>
    <text x="170" y="124" fill="#713f12" font-size="6.5" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">1.0m Ã— 2.44m DOUBLE-DEPTH VAULT</text>
    <!-- Ceremonial Flower Tribute (Left Side) -->
    <circle cx="68" cy="116" r="6" fill="#e11d48"/>
    <circle cx="62" cy="119" r="5" fill="#fbbf24"/>
    <circle cx="72" cy="122" r="5" fill="#f43f5e"/>
    <circle cx="67" cy="125" r="4.5" fill="#ffffff"/>
    <path d="M68,126 L65,134" stroke="#15803d" stroke-width="2"/>
    <!-- Perspective Badge -->
    <rect x="12" y="12" width="150" height="22" rx="5" fill="rgba(15, 23, 42, 0.8)"/>
    <text x="87" y="26" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">3D LAWN TURF VIEW</text>
</svg>`,
            blueprintSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="75" fill="#e0f2fe"/>
    <rect x="0" y="75" width="340" height="20" fill="#16a34a"/>
    <rect x="0" y="95" width="340" height="65" fill="#451a03"/>
    <rect x="75" y="100" width="190" height="24" rx="3" fill="#cbd5e1" stroke="#334155" stroke-width="1.5"/>
    <text x="170" y="116" fill="#0f172a" font-size="9" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">UPPER VAULT (Depth: 1.2m)</text>
    <rect x="75" y="129" width="190" height="24" rx="3" fill="#94a3b8" stroke="#334155" stroke-width="1.5"/>
    <text x="170" y="145" fill="#0f172a" font-size="9" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">LOWER VAULT (Depth: 2.0m)</text>
    <rect x="95" y="70" width="150" height="9" rx="2" fill="#1e293b"/>
    <rect x="105" y="72" width="130" height="5" fill="#ca8a04"/>
    <rect x="10" y="10" width="125" height="22" rx="5" fill="rgba(15, 23, 42, 0.8)"/>
    <text x="72" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">VAULT CROSS-SECTION</text>
</svg>`,
            materialsSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="160" fill="#0f172a"/>
    <rect x="18" y="16" width="304" height="128" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
    <rect x="32" y="28" width="80" height="50" rx="4" fill="#15803d" stroke="#22c55e" stroke-width="1"/>
    <text x="72" y="58" fill="#ffffff" font-size="8.5" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">TIFWAY TURF</text>
    <rect x="122" y="28" width="96" height="50" rx="4" fill="#090d16" stroke="#475569" stroke-width="1"/>
    <text x="170" y="54" fill="#ffffff" font-size="8" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">BLACK GRANITE</text>
    <text x="170" y="66" fill="#94a3b8" font-size="7" text-anchor="middle" font-family="Inter, sans-serif">Diamond Polished</text>
    <rect x="228" y="28" width="80" height="50" rx="4" fill="#ca8a04" stroke="#fef08a" stroke-width="1"/>
    <text x="268" y="58" fill="#451a03" font-size="8.5" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">CAST BRONZE</text>
    <line x1="32" y1="90" x2="308" y2="90" stroke="#334155" stroke-width="1"/>
    <text x="40" y="110" fill="#e2e8f0" font-size="9" font-weight="700" font-family="Inter, sans-serif">âœ“ Sub-Vault: High-Density Reinforced Concrete (Class-A)</text>
    <text x="40" y="126" fill="#e2e8f0" font-size="9" font-weight="700" font-family="Inter, sans-serif">âœ“ Drainage: Sub-base Coarse Gravel Bed (Zero Water Retention)</text>
</svg>`
        },
        garden: {
            id: 'garden',
            name: 'Garden Memorial Lot',
            badge: '3D Garden Terrace Perspective',
            capacity: '4â€“8 Caskets + 8â€“16 Urns (Cluster)',
            dimensions: '2.0m Ã— 2.5m (2â€“4 Lots Cluster)',
            priceTier: 'â‚±200,000 â€“ â‚±650,000',
            materials: {
                surface: 'Raised White Marble Curb (24") with Granite Meditation Bench',
                structure: 'Multi-Vault Reinforced Concrete Cluster',
                drainage: 'Integrated Garden French Drain with Natural Runoff'
            },
            monumentRule: 'Raised marble/granite curb (up to 24") with landscape flower bed',
            perpetualCare: 'Covered (Hedge pruning, curb washing & perpetual security)',
            intermentPrivilege: 'Family cluster (4â€“8 Caskets) + 8â€“16 cremains urns',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <defs>
        <linearGradient id="gard3dSky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#38bdf8"/>
            <stop offset="60%" stop-color="#bae6fd"/>
            <stop offset="100%" stop-color="#f0fdf4"/>
        </linearGradient>
        <linearGradient id="marbleBench" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="50%" stop-color="#f1f5f9"/>
            <stop offset="100%" stop-color="#cbd5e1"/>
        </linearGradient>
        <linearGradient id="graniteMon" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#334155"/>
            <stop offset="50%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#0f172a"/>
        </linearGradient>
    </defs>
    <rect x="0" y="0" width="340" height="85" fill="url(#gard3dSky)"/>
    <circle cx="45" cy="28" r="16" fill="#fef08a" opacity="0.9"/>
    <!-- Landscaped Background Lawn & Hedges -->
    <rect x="0" y="85" width="340" height="75" fill="#15803d"/>
    <circle cx="50" cy="80" r="22" fill="#166534"/>
    <circle cx="85" cy="82" r="18" fill="#15803d"/>
    <circle cx="285" cy="80" r="22" fill="#166534"/>
    <circle cx="255" cy="82" r="18" fill="#15803d"/>
    <!-- Raised 3D Marble Terrace Curb -->
    <polygon points="60,98 280,98 310,148 30,148" fill="#f8fafc" stroke="#94a3b8" stroke-width="1.5"/>
    <polygon points="70,102 270,102 295,142 45,142" fill="#16a34a"/>
    <!-- Upright Granite Monument -->
    <path d="M140,48 L200,48 L204,115 L136,115 Z" fill="url(#graniteMon)" stroke="#0f172a" stroke-width="1.5"/>
    <path d="M170,58 L170,80 M162,65 L178,65" stroke="#fef08a" stroke-width="2" stroke-linecap="round"/>
    <rect x="146" y="86" width="48" height="18" rx="2" fill="#ca8a04"/>
    <text x="170" y="98" fill="#ffffff" font-size="7" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">MEMORIA</text>
    <!-- Curved Marble Meditation Bench (Foreground Left) -->
    <ellipse cx="95" cy="125" rx="30" ry="10" fill="url(#marbleBench)" stroke="#64748b" stroke-width="1.2"/>
    <rect x="75" y="128" width="6" height="12" fill="#64748b"/>
    <rect x="109" y="128" width="6" height="12" fill="#64748b"/>
    <text x="95" y="127" fill="#475569" font-size="6" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">BENCH</text>
    <!-- Flowering Garden Bed (Foreground Right) -->
    <circle cx="235" cy="122" r="6" fill="#f43f5e"/>
    <circle cx="245" cy="120" r="5" fill="#ec4899"/>
    <circle cx="255" cy="124" r="6" fill="#fbbf24"/>
    <circle cx="245" cy="128" r="5" fill="#a855f7"/>
    <!-- Perspective Badge -->
    <rect x="12" y="10" width="165" height="22" rx="5" fill="rgba(15, 23, 42, 0.8)"/>
    <text x="94" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">3D GARDEN LOT VIEW</text>
</svg>`,
            blueprintSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="110" fill="#bae6fd"/>
    <rect x="0" y="110" width="340" height="50" fill="#15803d"/>
    <polygon points="75,135 265,135 285,152 55,152" fill="#e2e8f0" stroke="#64748b" stroke-width="1"/>
    <rect x="75" y="125" width="190" height="10" fill="#f8fafc" stroke="#94a3b8" stroke-width="1"/>
    <path d="M135,42 L205,42 L210,125 L130,125 Z" fill="#334155" stroke="#0f172a" stroke-width="1.5"/>
    <rect x="10" y="10" width="125" height="22" rx="5" fill="rgba(15, 23, 42, 0.75)"/>
    <text x="72" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">RAISED MARBLE CURB</text>
</svg>`,
            materialsSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="160" fill="#0f172a"/>
    <rect x="18" y="16" width="304" height="128" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
    <rect x="32" y="28" width="86" height="50" rx="4" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
    <text x="75" y="52" fill="#0f172a" font-size="8" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">WHITE MARBLE</text>
    <text x="75" y="64" fill="#64748b" font-size="7" text-anchor="middle" font-family="Inter, sans-serif">24" Raised Curb</text>
    <rect x="128" y="28" width="90" height="50" rx="4" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <text x="173" y="52" fill="#ffffff" font-size="8" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">GREY GRANITE</text>
    <text x="173" y="64" fill="#94a3b8" font-size="7" text-anchor="middle" font-family="Inter, sans-serif">Meditation Bench</text>
    <rect x="228" y="28" width="80" height="50" rx="4" fill="#15803d" stroke="#22c55e" stroke-width="1"/>
    <text x="268" y="52" fill="#ffffff" font-size="8" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">FLORAL HEDGE</text>
    <text x="268" y="64" fill="#a7f3d0" font-size="7" text-anchor="middle" font-family="Inter, sans-serif">Perpetual Care</text>
    <line x1="32" y1="90" x2="308" y2="90" stroke="#334155" stroke-width="1"/>
    <text x="40" y="110" fill="#e2e8f0" font-size="9" font-weight="700" font-family="Inter, sans-serif">âœ“ Cluster Structure: 4â€“8 Caskets Double-Depth Concrete Pods</text>
    <text x="40" y="126" fill="#e2e8f0" font-size="9" font-weight="700" font-family="Inter, sans-serif">âœ“ Drainage: Integrated French Drain with Crushed Rock Filtration</text>
</svg>`
        },
        mausoleum: {
            id: 'mausoleum',
            name: 'Family Estate / Mausoleum',
            badge: '3D Family Estate Perspective',
            capacity: '12â€“24+ Vaults & Urns (Multi-Gen)',
            dimensions: '4.0m Ã— 5.0m+ (8â€“16+ Lots)',
            priceTier: 'â‚±1,000,000 â€“ â‚±10,000,000+',
            materials: {
                surface: 'Neoclassical Polished Granite & Marble Pavilion',
                structure: 'Engineered Reinforced Concrete Superstructure (4.5m Ceiling)',
                drainage: 'Internal Gravity Roof Runoff & Sealed Crypt Chambers'
            },
            monumentRule: 'Neoclassical covered pavilion / chapel (Up to 4â€“5m, private gate)',
            perpetualCare: 'Covered (Avenue access, grounds upkeep & 24/7 security)',
            intermentPrivilege: 'Generational estate (12â€“24+ Vaults & Urns in private crypt)',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <defs>
        <linearGradient id="mau3dSky" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0284c7"/>
            <stop offset="50%" stop-color="#7dd3fc"/>
            <stop offset="100%" stop-color="#f8fafc"/>
        </linearGradient>
        <linearGradient id="mauMarbleCol" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="45%" stop-color="#f1f5f9"/>
            <stop offset="100%" stop-color="#cbd5e1"/>
        </linearGradient>
        <linearGradient id="mauRoofSlate" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#475569"/>
            <stop offset="50%" stop-color="#334155"/>
            <stop offset="100%" stop-color="#1e293b"/>
        </linearGradient>
        <linearGradient id="bronzeGateGleam" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="50%" stop-color="#d97706"/>
            <stop offset="100%" stop-color="#78350f"/>
        </linearGradient>
    </defs>
    <rect x="0" y="0" width="340" height="95" fill="url(#mau3dSky)"/>
    <!-- Italian Cypress Trees in Background -->
    <path d="M30,105 C30,45 42,28 42,28 C42,28 54,45 54,105 Z" fill="#14532d"/>
    <path d="M286,105 C286,45 298,28 298,28 C298,28 310,45 310,105 Z" fill="#14532d"/>
    <!-- Ground / Paved Courtyard -->
    <polygon points="0,95 340,95 340,160 0,160" fill="#15803d"/>
    <polygon points="40,110 300,110 330,158 10,158" fill="#e2e8f0" stroke="#cbd5e1" stroke-width="1"/>
    <!-- 3D Foundation Podium -->
    <rect x="65" y="105" width="210" height="10" rx="1" fill="#cbd5e1" stroke="#64748b" stroke-width="1.2"/>
    <!-- Pavilion Interior Crypt Room -->
    <rect x="80" y="48" width="180" height="58" fill="#0f172a"/>
    <!-- Wrought-Iron Bronze Double Gates -->
    <rect x="135" y="55" width="70" height="51" rx="2" fill="#090d16" stroke="url(#bronzeGateGleam)" stroke-width="1.5"/>
    <line x1="170" y1="55" x2="170" y2="106" stroke="#ca8a04" stroke-width="1.5"/>
    <line x1="147" y1="55" x2="147" y2="106" stroke="#ca8a04" stroke-width="0.75"/>
    <line x1="158" y1="55" x2="158" y2="106" stroke="#ca8a04" stroke-width="0.75"/>
    <line x1="182" y1="55" x2="182" y2="106" stroke="#ca8a04" stroke-width="0.75"/>
    <line x1="193" y1="55" x2="193" y2="106" stroke="#ca8a04" stroke-width="0.75"/>
    <path d="M170,68 L170,82 M163,73 L177,73" stroke="#fef08a" stroke-width="2"/>
    <!-- Fluted Neoclassical Marble Columns -->
    <rect x="76" y="48" width="16" height="58" rx="1" fill="url(#mauMarbleCol)" stroke="#64748b" stroke-width="1"/>
    <rect x="108" y="48" width="16" height="58" rx="1" fill="url(#mauMarbleCol)" stroke="#64748b" stroke-width="1"/>
    <rect x="216" y="48" width="16" height="58" rx="1" fill="url(#mauMarbleCol)" stroke="#64748b" stroke-width="1"/>
    <rect x="248" y="48" width="16" height="58" rx="1" fill="url(#mauMarbleCol)" stroke="#64748b" stroke-width="1"/>
    <!-- Entablature & Pediment Gable Roof -->
    <rect x="68" y="40" width="204" height="9" fill="#f8fafc" stroke="#64748b" stroke-width="1.2"/>
    <polygon points="170,12 276,40 64,40" fill="url(#mauRoofSlate)" stroke="#475569" stroke-width="1.5"/>
    <text x="170" y="34" fill="#ffffff" font-size="8" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif" letter-spacing="1">FAMILY ESTATE</text>
    <!-- Perspective Badge -->
    <rect x="12" y="10" width="165" height="22" rx="5" fill="rgba(15, 23, 42, 0.85)"/>
    <text x="94" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">3D MAUSOLEUM VIEW</text>
</svg>`,
            blueprintSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="120" fill="#bae6fd"/>
    <rect x="0" y="120" width="340" height="40" fill="#15803d"/>
    <rect x="95" y="55" width="150" height="63" fill="#1e293b"/>
    <rect x="145" y="65" width="50" height="53" rx="2" fill="#0f172a" stroke="#ca8a04" stroke-width="1.5"/>
    <rect x="80" y="47" width="180" height="8" fill="#e2e8f0" stroke="#64748b" stroke-width="1"/>
    <polygon points="170,20 270,47 70,47" fill="#cbd5e1" stroke="#64748b" stroke-width="1.5"/>
    <rect x="10" y="10" width="130" height="22" rx="5" fill="rgba(15, 23, 42, 0.75)"/>
    <text x="75" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">PRIVATE PAVILION</text>
</svg>`,
            materialsSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="160" fill="#0f172a"/>
    <rect x="18" y="16" width="304" height="128" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
    <rect x="32" y="28" width="86" height="50" rx="4" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
    <text x="75" y="52" fill="#0f172a" font-size="8" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">MARBLE COLUMNS</text>
    <text x="75" y="64" fill="#64748b" font-size="7" text-anchor="middle" font-family="Inter, sans-serif">Greek Fluted</text>
    <rect x="128" y="28" width="90" height="50" rx="4" fill="#334155" stroke="#64748b" stroke-width="1"/>
    <text x="173" y="52" fill="#ffffff" font-size="8" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">SLATE ROOFING</text>
    <text x="173" y="64" fill="#94a3b8" font-size="7" text-anchor="middle" font-family="Inter, sans-serif">Pitched Gable</text>
    <rect x="228" y="28" width="80" height="50" rx="4" fill="#ca8a04" stroke="#fef08a" stroke-width="1"/>
    <text x="268" y="52" fill="#451a03" font-size="8" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">BRONZE GATES</text>
    <text x="268" y="64" fill="#713f12" font-size="7" text-anchor="middle" font-family="Inter, sans-serif">Double Security</text>
    <line x1="32" y1="90" x2="308" y2="90" stroke="#334155" stroke-width="1"/>
    <text x="40" y="110" fill="#e2e8f0" font-size="9" font-weight="700" font-family="Inter, sans-serif">âœ“ Structure: Engineered Reinforced Concrete Superstructure (4.5m Ceiling)</text>
    <text x="40" y="126" fill="#e2e8f0" font-size="9" font-weight="700" font-family="Inter, sans-serif">âœ“ Crypts: Sealed Multi-Crypt Chambers with Internal Gravity Runoff</text>
</svg>`
        },
        columbarium: {
            id: 'columbarium',
            name: 'Columbarium Wall Niche',
            badge: '3D Columbarium Niche View',
            capacity: '2â€“4 Cremains Urns per Niche',
            dimensions: '0.4m Ã— 0.4m Ã— 0.6m (Single Niche)',
            priceTier: 'â‚±25,000 â€“ â‚±150,000',
            materials: {
                surface: 'Italian Carrara White Marble with Engraved Bronze Plaque',
                structure: 'Modular High-Strength Reinforced Vault Wall',
                drainage: 'Indoor Climate-Controlled Sanctuary (Dust & Moisture Sealed)'
            },
            monumentRule: 'Polished engraved brass plate with tempered glass/marble face',
            perpetualCare: 'Covered (Sanctuary hall upkeep, lighting & commemorative care)',
            intermentPrivilege: 'Niche compartment (2â€“4 Cremains urns or ossuary transfers)',
            svg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <defs>
        <linearGradient id="sanctuaryHall" x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stop-color="#0f172a"/>
            <stop offset="40%" stop-color="#1e293b"/>
            <stop offset="100%" stop-color="#020617"/>
        </linearGradient>
        <linearGradient id="carraraMarble" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stop-color="#ffffff"/>
            <stop offset="35%" stop-color="#f8fafc"/>
            <stop offset="65%" stop-color="#e2e8f0"/>
            <stop offset="100%" stop-color="#cbd5e1"/>
        </linearGradient>
        <linearGradient id="goldenUrn" x1="0%" y1="0%" x2="100%" y2="50%">
            <stop offset="0%" stop-color="#fef08a"/>
            <stop offset="30%" stop-color="#f59e0b"/>
            <stop offset="70%" stop-color="#d97706"/>
            <stop offset="100%" stop-color="#78350f"/>
        </linearGradient>
        <linearGradient id="spotLight" x1="50%" y1="0%" x2="50%" y2="100%">
            <stop offset="0%" stop-color="#fef08a" stop-opacity="0.3"/>
            <stop offset="100%" stop-color="#fef08a" stop-opacity="0.0"/>
        </linearGradient>
    </defs>
    <!-- Hall Interior & Ambient Light -->
    <rect x="0" y="0" width="340" height="160" fill="url(#sanctuaryHall)"/>
    <polygon points="170,0 230,160 110,160" fill="url(#spotLight)"/>
    <!-- Outer Marble Wall Grid Structure -->
    <rect x="25" y="16" width="290" height="128" rx="6" fill="#1e293b" stroke="#334155" stroke-width="2"/>
    <!-- Surrounding Niches -->
    <rect x="35" y="24" width="56" height="34" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="99" y="24" width="56" height="34" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="185" y="24" width="56" height="34" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="249" y="24" width="56" height="34" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="35" y="64" width="56" height="34" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="249" y="64" width="56" height="34" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="35" y="104" width="56" height="32" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="99" y="104" width="56" height="32" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="185" y="104" width="56" height="32" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <rect x="249" y="104" width="56" height="32" rx="3" fill="#0f172a" stroke="#475569" stroke-width="1"/>
    <!-- FEATURED SELECTED NICHE: OPEN 3D CUTAWAY VIEW -->
    <rect x="97" y="62" width="146" height="38" rx="4" fill="#047857" stroke="#10b981" stroke-width="2"/>
    <!-- Left Half: Polished Carrara Marble Door -->
    <rect x="100" y="65" width="70" height="32" rx="3" fill="url(#carraraMarble)" stroke="#94a3b8" stroke-width="1"/>
    <!-- Marble veining detail -->
    <path d="M110,67 Q125,75 120,85 Q115,92 130,95" stroke="#94a3b8" stroke-width="0.75" fill="none" opacity="0.6"/>
    <!-- Bronze Nameplate on Door -->
    <rect x="106" y="72" width="58" height="18" rx="2" fill="#ca8a04" stroke="#fef08a" stroke-width="0.75"/>
    <text x="135" y="84" fill="#0f172a" font-size="7" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">NICHE VAULT</text>
    <!-- Brass Rosettes on Door -->
    <circle cx="104" cy="68" r="1.5" fill="#f59e0b"/>
    <circle cx="166" cy="68" r="1.5" fill="#f59e0b"/>
    <circle cx="104" cy="94" r="1.5" fill="#f59e0b"/>
    <circle cx="166" cy="94" r="1.5" fill="#f59e0b"/>
    <!-- Right Half: Open Interior Chamber (Velvet Pedestal & Ceremonial Urns) -->
    <rect x="173" y="65" width="67" height="32" rx="2" fill="#064e3b" stroke="#059669" stroke-width="1"/>
    <rect x="177" y="88" width="59" height="7" rx="1" fill="#047857"/>
    <!-- Ceremonial Cremation Urn 1 -->
    <path d="M188,75 Q193,73 198,75 L196,87 L190,87 Z" fill="url(#goldenUrn)" stroke="#78350f" stroke-width="0.5"/>
    <circle cx="193" cy="73" r="2.5" fill="#fef08a"/>
    <!-- Ceremonial Cremation Urn 2 -->
    <path d="M210,75 Q215,73 220,75 L218,87 L212,87 Z" fill="url(#goldenUrn)" stroke="#78350f" stroke-width="0.5"/>
    <circle cx="215" cy="73" r="2.5" fill="#fef08a"/>
    <text x="207" y="94" fill="#a7f3d0" font-size="5" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">DUAL URN CAPACITY</text>
    <!-- Perspective Badge -->
    <rect x="12" y="10" width="165" height="22" rx="5" fill="rgba(15, 23, 42, 0.85)"/>
    <text x="94" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">3D NICHE VAULT VIEW</text>
</svg>`,
            blueprintSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="160" fill="#0f172a"/>
    <rect x="30" y="18" width="280" height="124" rx="4" fill="#334155" stroke="#475569" stroke-width="2"/>
    <rect x="42" y="28" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="106" y="28" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="178" y="28" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="242" y="28" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="42" y="66" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="106" y="66" width="56" height="32" rx="3" fill="#047857" stroke="#34d399" stroke-width="2"/>
    <rect x="114" y="74" width="40" height="16" rx="2" fill="#ca8a04"/>
    <text x="134" y="85" fill="#0f172a" font-size="7" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">NICHE #204</text>
    <rect x="178" y="66" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="242" y="66" width="56" height="32" rx="3" fill="#1e293b" stroke="#64748b" stroke-width="1"/>
    <rect x="10" y="10" width="135" height="22" rx="5" fill="rgba(15, 23, 42, 0.75)"/>
    <text x="77" y="24" fill="#ffffff" font-size="9" font-weight="700" text-anchor="middle" font-family="Inter, sans-serif">NICHE WALL ELEVATION</text>
</svg>`,
            materialsSvg: `<svg viewBox="0 0 340 160" xmlns="http://www.w3.org/2000/svg" width="100%" height="100%">
    <rect x="0" y="0" width="340" height="160" fill="#0f172a"/>
    <rect x="18" y="16" width="304" height="128" rx="8" fill="#1e293b" stroke="#334155" stroke-width="1.5"/>
    <rect x="32" y="28" width="90" height="50" rx="4" fill="#f8fafc" stroke="#cbd5e1" stroke-width="1.5"/>
    <text x="77" y="52" fill="#0f172a" font-size="8" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">CARRARA MARBLE</text>
    <text x="77" y="64" fill="#64748b" font-size="7" text-anchor="middle" font-family="Inter, sans-serif">Honed 20mm Face</text>
    <rect x="132" y="28" width="86" height="50" rx="4" fill="#ca8a04" stroke="#fef08a" stroke-width="1"/>
    <text x="175" y="52" fill="#451a03" font-size="8" font-weight="900" text-anchor="middle" font-family="Inter, sans-serif">BRONZE PLAQUE</text>
    <text x="175" y="64" fill="#713f12" font-size="7" text-anchor="middle" font-family="Inter, sans-serif">Anti-Tarnish Seal</text>
    <rect x="228" y="28" width="80" height="50" rx="4" fill="#047857" stroke="#34d399" stroke-width="1"/>
    <text x="268" y="52" fill="#ffffff" font-size="8" font-weight="800" text-anchor="middle" font-family="Inter, sans-serif">VELVET LINER</text>
    <text x="268" y="64" fill="#a7f3d0" font-size="7" text-anchor="middle" font-family="Inter, sans-serif">Cushioned Base</text>
    <line x1="32" y1="90" x2="308" y2="90" stroke="#334155" stroke-width="1"/>
    <text x="40" y="110" fill="#e2e8f0" font-size="9" font-weight="700" font-family="Inter, sans-serif">âœ“ Modular Vault Cell: Fire-Rated Engineered Polymer / Concrete</text>
    <text x="40" y="126" fill="#e2e8f0" font-size="9" font-weight="700" font-family="Inter, sans-serif">âœ“ Environment: Climate-Controlled Indoor Sanctuary (24/7 Security)</text>
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
     * Calculate Spatial Proximity, Walking Distance & Terrain Elevation (Batch 10C)
     */
    function getLotSpatialMetrics(lot, block, section, cemetery) {
        if (!lot) {
            return {
                walkingDist: '~85m (1.5 min walk)',
                walkingDistOnly: '85 meters',
                walkingTime: '~1.5 min walk',
                terrainElev: '+1.2m (Flood-Free Ground)',
                parkingDist: 'Main Avenue Curb (~25m away)',
                pathwayCond: 'Paved Continuous Footway',
                pwdBadgeText: 'PWD Friendly',
                pwdBadgeClass: 'is-pwd-friendly',
                pwdIcon: 'fa-wheelchair',
                summaryElevation: '+1.2m Ground / Step-Free'
            };
        }

        const typeStr = String(lot.lot_type || '').toLowerCase();
        const numStr = String(lot.lot_number || '').toLowerCase();
        const notesStr = String(lot.location_notes || '').toLowerCase();
        const blockName = String(block?.block_name || '').toLowerCase();
        const isColumbarium = typeStr.includes('columb') || typeStr.includes('niche') || numStr.startsWith('col-');

        const blockNum = parseInt(blockName.replace(/\D/g, '') || '1', 10);
        const rowNum = parseInt(lot.row_number || '1', 10);

        let distanceMeters;
        let walkTime;
        let terrainElev;
        let parkingDist;
        let pathwayCond;
        let pwdBadgeText;
        let pwdBadgeClass;
        let pwdIcon;

        if (isColumbarium) {
            distanceMeters = 65;
            walkTime = '~1 min walk';
            terrainElev = '+2.1m (Sanctuary Hall Ground Floor)';
            parkingDist = 'Sanctuary Porte-CochÃ¨re (~20m)';
            pathwayCond = 'Climate-Controlled Step-Free Interior';
            pwdBadgeText = 'PWD Elevator & Ramp';
            pwdBadgeClass = 'is-pwd-friendly';
            pwdIcon = 'fa-elevator';
        } else if (typeStr.includes('mausoleum') || typeStr.includes('estate')) {
            distanceMeters = Math.min(220, 80 + (blockNum * 25));
            walkTime = `~${Math.round(distanceMeters / 70)} mins walk`;
            terrainElev = '+2.5m (Elevated Estate Terrace)';
            parkingDist = 'Estate Avenue Driveway (~15m)';
            pathwayCond = 'Wide Paved Avenue & Paved Apron';
            pwdBadgeText = 'PWD Accessible';
            pwdBadgeClass = 'is-pwd-friendly';
            pwdIcon = 'fa-wheelchair';
        } else if (typeStr.includes('garden')) {
            distanceMeters = Math.min(280, 70 + (blockNum * 35));
            walkTime = `~${Math.round(distanceMeters / 70)} mins walk`;
            terrainElev = '+1.8m (Terraced Garden Pavement)';
            parkingDist = 'Garden Cluster Walkway (~25m)';
            pathwayCond = 'Stone Paved Pathway with 15cm Curb';
            pwdBadgeText = 'Level Access Curb';
            pwdBadgeClass = 'is-pwd-friendly';
            pwdIcon = 'fa-shoe-prints';
        } else {
            // Standard Lawn Lot
            const isRoadside = notesStr.includes('road') || notesStr.includes('ave') || notesStr.includes('prime') || notesStr.includes('front');
            distanceMeters = Math.min(360, Math.max(45, (blockNum * 38) + (rowNum * 6)));
            const mins = (distanceMeters / 75).toFixed(0);
            walkTime = mins <= 1 ? '~1 min walk' : `~${mins} mins walk`;

            if (isRoadside) {
                terrainElev = '+1.4m (Road-Adjacent Elevated Grade)';
                parkingDist = 'Main Boulevard Curb (~10â€“15m)';
                pathwayCond = 'Direct Smooth Sidewalk Connection';
                pwdBadgeText = 'PWD Accessible';
                pwdBadgeClass = 'is-pwd-friendly';
                pwdIcon = 'fa-wheelchair';
            } else {
                terrainElev = '+1.0m (Perpetual Dry-Well Turf)';
                parkingDist = 'Interior Pathway Drop-Off (~40m)';
                pathwayCond = 'Paved Walkway & Manicured Lawn';
                pwdBadgeText = 'Standard Footway';
                pwdBadgeClass = 'is-pwd-standard';
                pwdIcon = 'fa-person-walking';
            }
        }

        return {
            walkingDist: `~${distanceMeters}m (${walkTime})`,
            walkingDistOnly: `${distanceMeters} meters`,
            walkingTime: walkTime,
            terrainElev: terrainElev,
            parkingDist: parkingDist,
            pathwayCond: pathwayCond,
            pwdBadgeText: pwdBadgeText,
            pwdBadgeClass: pwdBadgeClass,
            pwdIcon: pwdIcon,
            summaryElevation: `${terrainElev.split(' ')[0]} / ${pwdBadgeText}`
        };
    }

    /**
     * Switch Archetype Visual Mode (Batch 10B: 3D Perspective | Blueprint | Materials)
     */
    function setArchetypeViewMode(mode) {
        if (!['perspective', 'blueprint', 'materials'].includes(mode)) {
            mode = 'perspective';
        }
        activeArchetypeViewMode = mode;

        // Update Drawer Mode Buttons
        const drawerModeBtns = document.querySelectorAll('#drawerArchetypeViewModes .btn-archetype-mode');
        drawerModeBtns.forEach(b => {
            const btnMode = b.getAttribute('data-mode');
            b.classList.toggle('active', btnMode === mode);
            b.setAttribute('aria-selected', btnMode === mode ? 'true' : 'false');
        });

        // Update Lightbox Mode Buttons
        const lightboxModeBtns = document.querySelectorAll('#lightboxArchetypeViewModes .btn-archetype-mode');
        lightboxModeBtns.forEach(b => {
            const btnMode = b.getAttribute('data-mode');
            b.classList.toggle('active', btnMode === mode);
            b.setAttribute('aria-selected', btnMode === mode ? 'true' : 'false');
        });

        // Re-render showcase for selected lot
        if (state.selectedLot) {
            const lot = state.selectedLot;
            const archetype = getLotArchetype(lot);
            let activeSvg = archetype.svg;
            if (mode === 'blueprint' && archetype.blueprintSvg) {
                activeSvg = archetype.blueprintSvg;
            } else if (mode === 'materials' && archetype.materialsSvg) {
                activeSvg = archetype.materialsSvg;
            }

            if (drawerArchetypeGraphic) {
                drawerArchetypeGraphic.innerHTML = activeSvg;
            }

            if (drawerMaterialsCard) {
                drawerMaterialsCard.style.display = (mode === 'materials') ? 'block' : 'none';
            }

            // Sync lightbox if open
            if (archetypeLightboxModal && archetypeLightboxModal.style.display !== 'none') {
                if (lightboxGraphicStage) {
                    lightboxGraphicStage.innerHTML = activeSvg;
                }
            }
        }
    }

    /**
     * Render Visual Archetype Showcase in Details Drawer (Batch 8A & 10B Enhanced)
     */
    function renderLotArchetypeShowcase(lot) {
        if (!drawerVisualShowcase) return;
        const archetype = getLotArchetype(lot);

        let activeSvg = archetype.svg;
        if (activeArchetypeViewMode === 'blueprint' && archetype.blueprintSvg) {
            activeSvg = archetype.blueprintSvg;
        } else if (activeArchetypeViewMode === 'materials' && archetype.materialsSvg) {
            activeSvg = archetype.materialsSvg;
        }

        if (drawerArchetypeGraphic) {
            drawerArchetypeGraphic.innerHTML = activeSvg;
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

        // Batch 10B: Populate and toggle Materials Specs Card
        if (drawerMaterialsCard && archetype.materials) {
            if (drawerMatSurface) drawerMatSurface.textContent = archetype.materials.surface || 'Standard Memorial Finish';
            if (drawerMatStructure) drawerMatStructure.textContent = archetype.materials.structure || 'Reinforced Concrete Sub-Vault';
            if (drawerMatDrainage) drawerMatDrainage.textContent = archetype.materials.drainage || 'Perpetual Gravity Runoff';
            drawerMaterialsCard.style.display = (activeArchetypeViewMode === 'materials') ? 'block' : 'none';
        }

        // Batch 10B: Sync drawer view mode buttons active state
        const drawerModeBtns = document.querySelectorAll('#drawerArchetypeViewModes .btn-archetype-mode');
        drawerModeBtns.forEach(b => {
            const btnMode = b.getAttribute('data-mode');
            b.classList.toggle('active', btnMode === activeArchetypeViewMode);
        });

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
        if (slipDimensions) slipDimensions.textContent = lot.dimensions || '1.0m Ã— 2.4m';

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
        if (slipTableFacility) slipTableFacility.textContent = cemetery?.cemetery_name || 'â€”';
        if (slipTableSection) slipTableSection.textContent = section?.section_name || 'â€”';
        if (slipTableBlock) slipTableBlock.textContent = block?.block_name || 'â€”';
        if (slipTableLot) slipTableLot.textContent = lot.lot_number || 'â€”';
        if (slipTableType) slipTableType.textContent = lot.lot_type || 'Standard Lawn';
        if (slipTableDimensions) slipTableDimensions.textContent = lot.dimensions || '1.0m Ã— 2.4m';

        // Batch 10C: Populate Wayfinding Slip Spatial & Accessibility Metrics
        const spatial = getLotSpatialMetrics(lot, block, section, cemetery);
        if (slipTableWalking) {
            slipTableWalking.textContent = spatial.walkingDist;
        }
        if (slipTableElevation) {
            slipTableElevation.textContent = spatial.summaryElevation;
        }

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
     * Open Fullscreen Visual Archetype Lightbox Modal (Batch 8C & 10B Enhanced)
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

        let activeSvg = archetype.svg;
        if (activeArchetypeViewMode === 'blueprint' && archetype.blueprintSvg) {
            activeSvg = archetype.blueprintSvg;
        } else if (activeArchetypeViewMode === 'materials' && archetype.materialsSvg) {
            activeSvg = archetype.materialsSvg;
        }

        if (lightboxGraphicStage) {
            lightboxGraphicStage.innerHTML = activeSvg;
        }
        if (lightboxArchetypeBadge) {
            lightboxArchetypeBadge.textContent = archetype.name;
        }
        if (lightboxTierBadge) {
            lightboxTierBadge.innerHTML = `<i class="fas ${tierInfo.icon}"></i> ${escapeHtml(tierInfo.tier)}`;
            lightboxTierBadge.className = `lightbox-tier-badge ${tierInfo.badgeClass}`;
        }
        if (lightboxLotHeading) {
            lightboxLotHeading.textContent = `Lot ${lot.lot_number} â€” ${archetype.name}`;
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
        if (lightboxMaterialVal && archetype.materials) {
            lightboxMaterialVal.textContent = `${archetype.materials.surface} â€¢ ${archetype.materials.structure}`;
        }
        if (lightboxPriceVal) {
            lightboxPriceVal.textContent = formatCurrency(lot.price);
        }

        // Batch 10B: Sync lightbox view mode buttons active state
        const lightboxModeBtns = document.querySelectorAll('#lightboxArchetypeViewModes .btn-archetype-mode');
        lightboxModeBtns.forEach(b => {
            const btnMode = b.getAttribute('data-mode');
            b.classList.toggle('active', btnMode === activeArchetypeViewMode);
        });

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
        blockLabel.textContent = `${block?.block_name || 'Block Grid'} â€” Layout Scheme`;
        slipMiniMapSvg.appendChild(blockLabel);

        // North Orientation Indicator
        const northText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        northText.setAttribute('x', String(canvasW - margin - 20));
        northText.setAttribute('y', '24');
        northText.setAttribute('fill', '#64748b');
        northText.setAttribute('font-size', '11');
        northText.setAttribute('font-weight', '600');
        northText.textContent = 'â–² NORTH';
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
     * Return to Cemetery Overview (Batch 8)
     */
    function returnToCemeteryOverview() {
        state.mapViewLevel = 'overview';
        state.viewLevel = 'cemetery';
        state.focusedSectionId = null;
        state.focusedBlockId = null;
        state.focusedLotId = null;
        state.currentSection = null;
        state.currentBlock = null;
        state.currentLots = [];

        // Clear section and block spatial highlights
        document.querySelectorAll('.svg-section-card.is-focused-section, .svg-section-card.is-matched').forEach(el => {
            el.classList.remove('is-focused-section');
            el.classList.remove('is-matched');
        });
        document.querySelectorAll('.svg-block-card.is-focused, .svg-block-card.is-focused-block, .svg-block-card.is-matched').forEach(el => {
            el.classList.remove('is-focused');
            el.classList.remove('is-focused-block');
            el.classList.remove('is-matched');
        });

        // If no route is active, dismiss lot details drawer and selection reticle
        if (!state.activeRoute) {
            closeLotDrawer();
            if (mapSelectionLayer) mapSelectionLayer.innerHTML = '';
            document.querySelectorAll('.svg-lot-tile.is-selected').forEach(el => el.classList.remove('is-selected'));
            state.selectedLot = null;
        }

        // Animate camera smoothly back to full cemetery overview without destroying SVG DOM or route
        animateViewBox(state.baseViewBox.x, state.baseViewBox.y, state.baseViewBox.width, state.baseViewBox.height, 380);

        updateBreadcrumbs();
        updateViewLevelIndicator();
        updateLegendCounts([]);
        applyFilters();
    }

    /**
     * Update Breadcrumbs Bar across View Hierarchy Levels (Batch 8)
     * Levels: overview -> section -> block -> lot
     */
    function updateBreadcrumbs() {
        if (!bcCemeteryName) return;
        const cemName = state.currentCemetery?.cemetery_name || 'Cemetery Overview';
        bcCemeteryName.textContent = cemName;

        const level = state.mapViewLevel || 'overview';

        // Clear active classes
        [bcCemetery, bcSection, bcBlock, bcLot].forEach(el => {
            if (el) el.classList.remove('active');
        });

        if (level === 'overview') {
            bcCemetery.classList.add('active');
            if (bcSection) bcSection.style.display = 'none';
            if (bcBlock) bcBlock.style.display = 'none';
            if (bcLot) bcLot.style.display = 'none';
        } else if (level === 'section') {
            if (bcSection && state.currentSection) {
                bcSection.style.display = 'inline-flex';
                bcSectionName.textContent = state.currentSection.section_name;
                bcSection.classList.add('active');
            }
            if (bcBlock) bcBlock.style.display = 'none';
            if (bcLot) bcLot.style.display = 'none';
        } else if (level === 'block') {
            if (bcSection && state.currentSection) {
                bcSection.style.display = 'inline-flex';
                bcSectionName.textContent = state.currentSection.section_name;
            }
            if (bcBlock && state.currentBlock) {
                bcBlock.style.display = 'inline-flex';
                bcBlockName.textContent = state.currentBlock.block_name;
                bcBlock.classList.add('active');
            }
            if (bcLot) bcLot.style.display = 'none';
        } else if (level === 'lot') {
            if (bcSection && state.currentSection) {
                bcSection.style.display = 'inline-flex';
                bcSectionName.textContent = state.currentSection.section_name;
            }
            if (bcBlock && state.currentBlock) {
                bcBlock.style.display = 'inline-flex';
                bcBlockName.textContent = state.currentBlock.block_name;
            }
            if (bcLot && state.selectedLot) {
                bcLot.style.display = 'inline-flex';
                const disp = state.selectedLot._displayLabel || state.selectedLot.lot_number;
                bcLotName.textContent = `Lot ${disp}`;
                bcLot.classList.add('active');
            }
        }
    }

    /**
     * Update Dynamic View Level Indicator HUD (Batch 8)
     * Renders clickable parent breadcrumb steps & dynamic Up-navigation button
     */
    function updateViewLevelIndicator() {
        if (!viewLevelText) return;

        const level = state.mapViewLevel || 'overview';
        const sName = state.currentSection?.section_name;
        const bName = state.currentBlock?.block_name;
        const lNum = state.selectedLot ? (state.selectedLot._displayLabel || state.selectedLot.lot_number) : null;

        if (level === 'overview') {
            viewLevelText.innerHTML = '<span class="level-step current">Cemetery Overview</span>';
            if (btnBackToOverview) btnBackToOverview.style.display = 'none';
        } else if (level === 'section') {
            viewLevelText.innerHTML = `
                <span class="level-step clickable" data-level="overview" title="Return to Overview">Overview</span>
                <span class="level-sep">›</span>
                <span class="level-step current">${escapeHtml(sName || 'Section')}</span>
            `;
            if (btnBackToOverview) {
                btnBackToOverview.style.display = 'inline-flex';
                if (btnBackText) btnBackText.textContent = 'Up to Overview';
            }
        } else if (level === 'block') {
            viewLevelText.innerHTML = `
                <span class="level-step clickable" data-level="overview" title="Return to Overview">Overview</span>
                <span class="level-sep">›</span>
                <span class="level-step clickable" data-level="section" title="Navigate to Section">${escapeHtml(sName || 'Section')}</span>
                <span class="level-sep">›</span>
                <span class="level-step current">${escapeHtml(bName || 'Block')}</span>
            `;
            if (btnBackToOverview) {
                btnBackToOverview.style.display = 'inline-flex';
                if (btnBackText) btnBackText.textContent = `Up to ${sName || 'Section'}`;
            }
        } else if (level === 'lot') {
            viewLevelText.innerHTML = `
                <span class="level-step clickable" data-level="overview" title="Return to Overview">Overview</span>
                <span class="level-sep">›</span>
                <span class="level-step clickable" data-level="section" title="Navigate to Section">${escapeHtml(sName || 'Section')}</span>
                <span class="level-sep">›</span>
                <span class="level-step clickable" data-level="block" title="Navigate to Block">${escapeHtml(bName || 'Block')}</span>
                <span class="level-sep">›</span>
                <span class="level-step current">${escapeHtml(lNum ? `Lot ${lNum}` : 'Lot')}</span>
            `;
            if (btnBackToOverview) {
                btnBackToOverview.style.display = 'inline-flex';
                if (btnBackText) btnBackText.textContent = `Up to ${bName || 'Block'}`;
            }
        }

        // Attach event listeners to clickable level steps in HUD
        viewLevelText.querySelectorAll('.level-step.clickable').forEach(el => {
            el.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = el.getAttribute('data-level');
                if (target === 'overview') returnToCemeteryOverview();
                else if (target === 'section' && state.currentSection) focusOnSection(state.currentSection);
                else if (target === 'block' && state.currentBlock && state.currentSection) focusOnBlock(state.currentBlock, state.currentSection);
            });
        });
    }

    /**
     * Navigate Up One Level in the View Hierarchy (Batch 8)
     * Lot -> Block -> Section -> Overview
     */
    function navigateUpOneLevel() {
        if (state.mapViewLevel === 'lot') {
            if (state.currentBlock && state.currentSection) {
                focusOnBlock(state.currentBlock, state.currentSection);
            } else if (state.currentSection) {
                focusOnSection(state.currentSection);
            } else {
                returnToCemeteryOverview();
            }
        } else if (state.mapViewLevel === 'block') {
            if (state.currentSection) {
                focusOnSection(state.currentSection);
            } else {
                returnToCemeteryOverview();
            }
        } else if (state.mapViewLevel === 'section') {
            returnToCemeteryOverview();
        } else {
            returnToCemeteryOverview();
        }
    }

    // =========================================================================
    // BATCH 5: GLOBAL CEMETERY SEARCH & MAP CAMERA FOCUS ENGINE
    // =========================================================================

    let viewBoxAnimationId = null;

    /**
     * Smoothly animate SVG ViewBox camera transitions (Batch 5)
     */
    function animateViewBox(targetX, targetY, targetW, targetH, duration = 380) {
        if (viewBoxAnimationId) {
            cancelAnimationFrame(viewBoxAnimationId);
            viewBoxAnimationId = null;
        }

        const prefersReducedMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        if (prefersReducedMotion || duration <= 0) {
            state.currentViewBox.x = targetX;
            state.currentViewBox.y = targetY;
            state.currentViewBox.width = targetW;
            state.currentViewBox.height = targetH;
            applyViewBox();
            return;
        }

        const startX = state.currentViewBox.x;
        const startY = state.currentViewBox.y;
        const startW = state.currentViewBox.width;
        const startH = state.currentViewBox.height;
        const startTime = performance.now();

        function easeOutCubic(t) {
            return 1 - Math.pow(1 - t, 3);
        }

        function step(now) {
            const elapsed = now - startTime;
            const progress = Math.min(1, elapsed / duration);
            const ease = easeOutCubic(progress);

            state.currentViewBox.x = startX + (targetX - startX) * ease;
            state.currentViewBox.y = startY + (targetY - startY) * ease;
            state.currentViewBox.width = startW + (targetW - startW) * ease;
            state.currentViewBox.height = startH + (targetH - startH) * ease;

            applyViewBox();

            if (progress < 1) {
                viewBoxAnimationId = requestAnimationFrame(step);
            } else {
                viewBoxAnimationId = null;
            }
        }

        viewBoxAnimationId = requestAnimationFrame(step);
    }

    /**
     * Camera Focus on specific Lot (Batch 5)
     * Shows selected lot + parent block + nearby internal streets with contextual zoom
     */
    function focusOnLot(lot, block, section) {
        let lotElement = document.querySelector(`.svg-lot-tile[data-lot-id="${lot.lot_id}"]`);

        // If currently drilled down into another block, return to master overview where all lots reside
        if (!lotElement && state.viewLevel === 'block') {
            returnToCemeteryOverview();
            lotElement = document.querySelector(`.svg-lot-tile[data-lot-id="${lot.lot_id}"]`);
        }

        if (lotElement) {
            const rectEl = lotElement.querySelector('rect') || lotElement;
            const lx = parseFloat(rectEl.getAttribute('x'));
            const ly = parseFloat(rectEl.getAttribute('y'));
            const lw = parseFloat(rectEl.getAttribute('width')) || 30;
            const lh = parseFloat(rectEl.getAttribute('height')) || 24;

            if (!isNaN(lx) && !isNaN(ly)) {
                const targetW = 380;
                const targetH = targetW * (state.baseViewBox.height / state.baseViewBox.width);
                const centerX = lx + (lw / 2);
                const centerY = ly + (lh / 2);
                const minTargetX = state.baseViewBox.x;
                const maxTargetX = state.baseViewBox.x + state.baseViewBox.width - targetW;
                const minTargetY = state.baseViewBox.y;
                const maxTargetY = state.baseViewBox.y + state.baseViewBox.height - targetH;
                const targetX = Math.max(minTargetX - 60, Math.min(maxTargetX + 60, centerX - (targetW / 2)));
                const targetY = Math.max(minTargetY - 40, Math.min(maxTargetY + 40, centerY - (targetH / 2)));

                animateViewBox(targetX, targetY, targetW, targetH, 380);
            }
        }

        // Authoritatively select lot, highlight with reticle, and open details drawer with occupancy info
        selectLot(lot, block, section, lotElement);
    }

    /**
     * Camera Focus on specific Block (Batch 5 & 8)
     * Shows entire block + surrounding block pathway context with clear readability
     */
    function focusOnBlock(block, section) {
        if (!block) return;
        if (!section && state.currentLayout) {
            section = state.currentLayout.sections.find(s => s.blocks && s.blocks.some(b => b.block_id === block.block_id));
        }

        state.mapViewLevel = 'block';
        state.viewLevel = 'block';
        state.focusedSectionId = section ? section.section_id : null;
        state.focusedBlockId = block.block_id;
        state.focusedLotId = null;
        state.currentSection = section;
        state.currentBlock = block;
        state.currentLots = state.blockLotsCache[block.block_id] || [];

        // Highlights: Highlight parent section and focused block
        document.querySelectorAll('.svg-section-card.is-focused-section').forEach(el => el.classList.remove('is-focused-section'));
        if (section) {
            const secEl = document.querySelector(`.svg-section-card[data-section-id="${section.section_id}"]`);
            if (secEl) secEl.classList.add('is-focused-section');
        }

        document.querySelectorAll('.svg-block-card.is-focused, .svg-block-card.is-focused-block, .svg-block-card.is-matched').forEach(el => {
            el.classList.remove('is-focused');
            el.classList.remove('is-focused-block');
            el.classList.remove('is-matched');
        });

        const blkEl = document.querySelector(`.svg-block-card[data-block-id="${block.block_id}"]`);
        if (blkEl) {
            blkEl.classList.add('is-focused');
            blkEl.classList.add('is-focused-block');
            const rectEl = blkEl.querySelector('rect') || blkEl;
            const bx = parseFloat(rectEl.getAttribute('x'));
            const by = parseFloat(rectEl.getAttribute('y'));
            const bw = parseFloat(rectEl.getAttribute('width')) || 160;
            const bh = parseFloat(rectEl.getAttribute('height')) || 110;

            if (!isNaN(bx) && !isNaN(by)) {
                // Focus camera with comfortable margin to display block clearly
                const targetW = Math.max(bw + 140, 420);
                const targetH = targetW * (state.baseViewBox.height / state.baseViewBox.width);
                const centerX = bx + (bw / 2);
                const centerY = by + (bh / 2);
                const minTargetX = state.baseViewBox.x;
                const maxTargetX = state.baseViewBox.x + state.baseViewBox.width - targetW;
                const minTargetY = state.baseViewBox.y;
                const maxTargetY = state.baseViewBox.y + state.baseViewBox.height - targetH;
                const targetX = Math.max(minTargetX - 60, Math.min(maxTargetX + 60, centerX - (targetW / 2)));
                const targetY = Math.max(minTargetY - 40, Math.min(maxTargetY + 40, centerY - (targetH / 2)));

                animateViewBox(targetX, targetY, targetW, targetH, 380);
            }
        }

        // If no route active, close lot drawer; if route active, preserve route presentation
        if (!state.activeRoute) {
            closeLotDrawer();
            if (mapSelectionLayer) mapSelectionLayer.innerHTML = '';
            document.querySelectorAll('.svg-lot-tile.is-selected').forEach(el => el.classList.remove('is-selected'));
            state.selectedLot = null;
        }

        updateBreadcrumbs();
        updateViewLevelIndicator();
        updateLegendCounts(state.currentLots);
        applyFilters();
    }

    /**
     * Camera Focus on specific Section (Batch 5 & 8)
     * Shows section + blocks inside section + nearby roads maintaining spatial geographic context
     */
    function focusOnSection(section) {
        if (!section) return;

        state.mapViewLevel = 'section';
        state.viewLevel = 'cemetery';
        state.focusedSectionId = section.section_id;
        state.focusedBlockId = null;
        state.focusedLotId = null;
        state.currentSection = section;
        state.currentBlock = null;

        // Visual highlight: Focused section
        document.querySelectorAll('.svg-section-card.is-focused-section, .svg-section-card.is-matched').forEach(el => {
            el.classList.remove('is-focused-section');
            el.classList.remove('is-matched');
        });
        document.querySelectorAll('.svg-block-card.is-focused, .svg-block-card.is-focused-block, .svg-block-card.is-matched').forEach(el => {
            el.classList.remove('is-focused');
            el.classList.remove('is-focused-block');
            el.classList.remove('is-matched');
        });

        const secEl = document.querySelector(`.svg-section-card[data-section-id="${section.section_id}"]`);
        if (secEl) {
            secEl.classList.add('is-focused-section');
            const rectEl = secEl.querySelector('rect') || secEl;
            const sx = parseFloat(rectEl.getAttribute('x'));
            const sy = parseFloat(rectEl.getAttribute('y'));
            const sw = parseFloat(rectEl.getAttribute('width')) || 450;
            const sh = parseFloat(rectEl.getAttribute('height')) || 240;

            if (!isNaN(sx) && !isNaN(sy)) {
                // Focus camera to show section + surrounding access roads
                const targetW = Math.max(sw + 180, 560);
                const targetH = targetW * (state.baseViewBox.height / state.baseViewBox.width);
                const centerX = sx + (sw / 2);
                const centerY = sy + (sh / 2);
                const minTargetX = state.baseViewBox.x;
                const maxTargetX = state.baseViewBox.x + state.baseViewBox.width - targetW;
                const minTargetY = state.baseViewBox.y;
                const maxTargetY = state.baseViewBox.y + state.baseViewBox.height - targetH;
                const targetX = Math.max(minTargetX - 60, Math.min(maxTargetX + 60, centerX - (targetW / 2)));
                const targetY = Math.max(minTargetY - 40, Math.min(maxTargetY + 40, centerY - (targetH / 2)));

                animateViewBox(targetX, targetY, targetW, targetH, 380);
            }
        }

        // If no route active, close lot drawer; if route active, preserve route presentation
        if (!state.activeRoute) {
            closeLotDrawer();
            if (mapSelectionLayer) mapSelectionLayer.innerHTML = '';
            document.querySelectorAll('.svg-lot-tile.is-selected').forEach(el => el.classList.remove('is-selected'));
            state.selectedLot = null;
        }

        updateBreadcrumbs();
        updateViewLevelIndicator();
        applyFilters();
    }

    /**
     * Execute Global Search across Deceased, Lots, Blocks, and Sections (Batch 5)
     */
    async function executeSearch(autoSelectIfSingle = true, forceSelectTop = false) {
        const query = (mapSearchInput.value || '').trim();
        if (!query) {
            state.filters.search = '';
            hideSearchResultsDropdown();
            // Clear matches without resetting user's current zoom/pan position
            document.querySelectorAll('.svg-lot-tile.is-matched').forEach(el => el.classList.remove('is-matched'));
            document.querySelectorAll('.svg-section-card.is-matched').forEach(el => el.classList.remove('is-matched'));
            document.querySelectorAll('.svg-block-card.is-matched').forEach(el => el.classList.remove('is-matched'));
            applyFilters();
            return;
        }

        state.filters.search = query;
        btnClearSearch.style.display = 'flex';

        const normQuery = query.toLowerCase().trim();
        const results = await searchLotsAcrossCemetery(normQuery);

        if (results.length === 0) {
            renderSearchEmptyState(query);
            applyFilters();
            return;
        }

        const matchingLots = results.filter(r => r.type === 'lot');
        const shouldSelectTop = forceSelectTop || (results.length === 1 && autoSelectIfSingle) || (matchingLots.length === 1 && results.length === 1 && autoSelectIfSingle);

        if (shouldSelectTop) {
            hideSearchResultsDropdown();
            const top = results[0];
            if (top.type === 'lot' || top.type === 'deceased') {
                await navigateAndSelectLot(top.lot, top.block, top.section);
            } else if (top.type === 'block') {
                focusOnBlock(top.block, top.section);
            } else if (top.type === 'section') {
                focusOnSection(top.section);
            }
            applyFilters();
        } else {
            renderSearchResultsDropdown(results);
            applyFilters();
        }
    }

    /**
     * Global Search Resolver across Deceased Records, Lot Numbers, Blocks, and Sections
     * Prioritizes exact matches: Lot > Deceased > Block > Section > Partial matches
     */
    async function searchLotsAcrossCemetery(normQuery) {
        const results = [];
        const seenKeys = new Set();
        const sections = state.currentLayout?.sections || [];

        // 1. Match Sections
        sections.forEach(sec => {
            const secName = (sec.section_name || '').toLowerCase();
            const secCode = (sec.section_code || '').toLowerCase();
            const cleanSec = secName.replace(/[^a-z0-9]/g, '');
            const cleanQ = normQuery.replace(/[^a-z0-9]/g, '');

            if (secName.includes(normQuery) || cleanSec.includes(cleanQ) || (secCode && secCode.includes(normQuery))) {
                const isExact = (secName === normQuery || cleanSec === cleanQ || secCode === normQuery);
                const score = isExact ? 200 : 70;
                results.push({
                    type: 'section',
                    title: sec.section_name,
                    meta: 'Cemetery Section',
                    section: sec,
                    score
                });
            }
        });

        // 2. Match Blocks
        sections.forEach(sec => {
            (sec.blocks || []).forEach(blk => {
                const bName = (blk.block_name || '').toLowerCase();
                const cleanB = bName.replace(/[^a-z0-9]/g, '');
                const cleanQ = normQuery.replace(/[^a-z0-9]/g, '');

                if (bName.includes(normQuery) || cleanB.includes(cleanQ) || (cleanQ && cleanB === cleanQ)) {
                    const isExact = (bName === normQuery || cleanB === cleanQ);
                    const score = isExact ? 220 : 85;
                    results.push({
                        type: 'block',
                        title: blk.block_name,
                        meta: sec.section_name,
                        block: blk,
                        section: sec,
                        score
                    });
                }
            });
        });

        // Helper to resolve parent block and section for any lot
        function resolveLotHierarchy(lot) {
            let foundBlock = null;
            let foundSection = null;
            sections.forEach(s => {
                (s.blocks || []).forEach(b => {
                    if (b.block_id === lot.block_id || (lot.block_name && b.block_name.toLowerCase() === lot.block_name.toLowerCase())) {
                        foundBlock = b;
                        foundSection = s;
                    }
                });
            });
            return { block: foundBlock, section: foundSection };
        }

        // 3. Search In-Memory Cached Lots & Deceased
        const inspectLot = (lot, blockObj, sectionObj) => {
            const lotNum = (lot.lot_number || '').toLowerCase().trim();
            const displayLabel = (lot._displayLabel || '').toLowerCase().trim();
            const occupant = (lot.occupant_name || lot._detailedInfo?.occupant_name || '').toLowerCase().trim();
            const lotIdStr = String(lot.lot_id || '');
            const cleanQ = normQuery.replace(/[^a-z0-9]/g, '');

            // Match Lot Number, Display Label (e.g. V-1, L-5), or Lot ID
            const cleanLotNum = lotNum.replace(/[^a-z0-9]/g, '');
            const cleanDisplay = displayLabel.replace(/[^a-z0-9]/g, '');

            const matchNum = lotNum && (lotNum.includes(normQuery) || (cleanQ && cleanLotNum.includes(cleanQ)));
            const matchDisplay = displayLabel && (displayLabel.includes(normQuery) || (cleanQ && (cleanDisplay === cleanQ || cleanDisplay.includes(cleanQ))));
            const matchId = (lotIdStr === normQuery);

            if (matchNum || matchDisplay || matchId) {
                const key = `lot_${lot.lot_id}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    const isExact = (lotNum === normQuery || displayLabel === normQuery || (cleanQ && cleanDisplay === cleanQ) || matchId);
                    const startsWith = lotNum.startsWith(normQuery) || (displayLabel && displayLabel.startsWith(normQuery));
                    const score = isExact ? 300 : (startsWith ? 260 : 130);
                    results.push({
                        type: 'lot',
                        title: lot._displayLabel || lot.lot_number,
                        meta: `${sectionObj?.section_name || ''} • ${blockObj?.block_name || ''}`,
                        status: lot.status,
                        price: lot.price,
                        lot,
                        block: blockObj,
                        section: sectionObj,
                        score
                    });
                }
            }

            // Match Deceased Name
            if (occupant && occupant.includes(normQuery)) {
                const key = `dec_${lot.lot_id}_${occupant}`;
                if (!seenKeys.has(key)) {
                    seenKeys.add(key);
                    const isExact = (occupant === normQuery);
                    const startsWith = occupant.startsWith(normQuery);
                    const score = isExact ? 280 : (startsWith ? 210 : 160);
                    const displayName = lot.occupant_name || lot._detailedInfo?.occupant_name || 'Registered Decedent';
                    results.push({
                        type: 'deceased',
                        title: displayName,
                        meta: `${sectionObj?.section_name || ''} • ${blockObj?.block_name || ''} • Lot ${lot.lot_number}`,
                        lot,
                        block: blockObj,
                        section: sectionObj,
                        score
                    });
                }
            }
        };

        // Inspect currently active lots
        if (state.currentLots && state.currentLots.length > 0) {
            state.currentLots.forEach(lot => inspectLot(lot, state.currentBlock, state.currentSection));
        }

        // Inspect all cached blocks in memory
        for (const [blkIdStr, lots] of Object.entries(state.blockLotsCache)) {
            const blkId = parseInt(blkIdStr, 10);
            let bObj = null, sObj = null;
            sections.forEach(s => {
                (s.blocks || []).forEach(b => {
                    if (b.block_id === blkId) { bObj = b; sObj = s; }
                });
            });
            (lots || []).forEach(lot => inspectLot(lot, bObj, sObj));
        }

        // 4. Server-Side Global Search (Deceased names and plots across entire cemetery database)
        try {
            const res = await api.request(`lots?search=${encodeURIComponent(normQuery)}`, { method: 'GET' });
            const serverLots = Array.isArray(res) ? res : (res?.data || []);
            if (Array.isArray(serverLots) && serverLots.length > 0) {
                serverLots.forEach(item => {
                    const hier = resolveLotHierarchy(item);
                    inspectLot(item, hier.block, hier.section);
                });
            }
        } catch (e) {
            // Graceful fallback to cached/candidate block fetching on API limitation or test mock
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

            for (const cand of candidateBlocks) {
                try {
                    const res = await api.request(`map/blocks/${cand.block.block_id}/lots`, { method: 'GET' });
                    if (res && res.success && res.data && Array.isArray(res.data.lots)) {
                        state.blockLotsCache[cand.block.block_id] = res.data.lots;
                        res.data.lots.forEach(lot => inspectLot(lot, cand.block, cand.section));
                    }
                } catch (err) {
                    // Ignore non-fatal fetch error
                }
            }
        }

        // Sort results by ranking score descending
        results.sort((a, b) => b.score - a.score);
        return results;
    }

    /**
     * Navigate to specific Lot, focus camera, highlight, and open details drawer
     */
    async function navigateAndSelectLot(lot, block, section) {
        if (!state.currentBlock || state.currentBlock.block_id !== block.block_id) {
            state.currentSection = section;
            state.currentBlock = block;
        }

        // Batch 5 Camera Focus on Lot + Authoritative Lot Selection
        focusOnLot(lot, block, section);
    }

    /**
     * Render Multiple Search Results Dropdown (Batch 5: Categorized, Compact, and Ranked)
     */
    function renderSearchResultsDropdown(results) {
        searchResultsDropdown.innerHTML = '';
        const maxShown = Math.min(results.length, 10);

        // Header with count indicator
        const header = document.createElement('div');
        header.className = 'search-results-header';
        header.textContent = results.length > 10 
            ? `10 of ${results.length} results` 
            : `${results.length} matching locations found`;
        searchResultsDropdown.appendChild(header);

        results.slice(0, maxShown).forEach((item, idx) => {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'search-result-item';
            btn.setAttribute('data-result-type', item.type);
            btn.setAttribute('tabindex', '0');

            let iconHtml = '';
            let badgeLabel = 'Lot';
            if (item.type === 'deceased') {
                iconHtml = '<i class="fas fa-cross" style="color:#9333ea;font-size:0.8rem;margin-right:5px;"></i>';
                badgeLabel = 'Deceased';
            } else if (item.type === 'lot') {
                iconHtml = '<i class="fas fa-monument" style="color:#0284c7;font-size:0.8rem;margin-right:5px;"></i>';
                badgeLabel = 'Lot';
            } else if (item.type === 'block') {
                iconHtml = '<i class="fas fa-cubes" style="color:#d97706;font-size:0.8rem;margin-right:5px;"></i>';
                badgeLabel = 'Block';
            } else if (item.type === 'section') {
                iconHtml = '<i class="fas fa-layer-group" style="color:#059669;font-size:0.8rem;margin-right:5px;"></i>';
                badgeLabel = 'Section';
            }

            const statusClass = (item.status || item.lot?.status || '').toLowerCase().replace(/\s+/g, '-');
            const statusHtml = (item.type === 'lot' && item.status) 
                ? `<span class="result-status-pill status-pill--${statusClass}">${escapeHtml(item.status)}</span>` 
                : '';

            btn.innerHTML = `
                <div class="result-item-main">
                    <span class="result-lot-number">${iconHtml}${escapeHtml(item.title)}</span>
                    <span class="result-lot-meta">${escapeHtml(item.meta || '')}</span>
                </div>
                <div class="result-badges-row">
                    <span class="result-category-badge result-category--${item.type}">${badgeLabel}</span>
                    ${statusHtml}
                </div>
            `;

            const activateResult = async () => {
                hideSearchResultsDropdown();
                if (item.type === 'deceased' || item.type === 'lot') {
                    await navigateAndSelectLot(item.lot, item.block, item.section);
                } else if (item.type === 'block') {
                    focusOnBlock(item.block, item.section);
                } else if (item.type === 'section') {
                    focusOnSection(item.section);
                }
                applyFilters();
            };

            btn.addEventListener('click', activateResult);

            // Arrow key navigation between items
            btn.addEventListener('keydown', (e) => {
                if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    const next = btn.nextElementSibling;
                    if (next && next.classList.contains('search-result-item')) next.focus();
                } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    const prev = btn.previousElementSibling;
                    if (prev && prev.classList.contains('search-result-item')) {
                        prev.focus();
                    } else {
                        mapSearchInput.focus();
                    }
                } else if (e.key === 'Escape') {
                    hideSearchResultsDropdown();
                    mapSearchInput.focus();
                }
            });

            searchResultsDropdown.appendChild(btn);
        });

        searchResultsDropdown.style.display = 'block';
    }

    /**
     * Render Empty Search State (Batch 5)
     */
    function renderSearchEmptyState(query) {
        searchResultsDropdown.innerHTML = `
            <div class="search-empty-state">
                <i class="fas fa-magnifying-glass search-empty-icon"></i>
                <div class="search-empty-title">No matching cemetery location found.</div>
                <div class="search-empty-sub">No results for "${escapeHtml(query)}". Try searching for a deceased name, lot number, section, or block.</div>
            </div>
        `;
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
        } else if (state.viewLevel === 'cemetery') {
            let matchedCount = 0;
            let totalLots = 0;

            Object.values(state.blockLotsCache).forEach(lots => {
                lots.forEach(lot => {
                    totalLots++;
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
            });

            if (hasActiveFilter && filterMatchesBadge && totalLots > 0) {
                filterMatchesBadge.style.display = 'inline-flex';
                filterMatchesBadge.innerHTML = `<i class="fas fa-filter"></i> ${matchedCount} of ${totalLots} match`;
            } else if (filterMatchesBadge) {
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
            const minStr = state.filters.minPrice !== null ? `â‚±${state.filters.minPrice}` : '0';
            const maxStr = state.filters.maxPrice !== null ? `â‚±${state.filters.maxPrice}` : 'âˆž';
            chips.push({
                label: `Price: ${minStr} â€“ ${maxStr}`,
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

        // Bound zoom limits for refocused parcel
        if (newW < 220 || newW > 1400) return;

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
        const minX = state.baseViewBox.x - 120;
        const maxX = state.baseViewBox.x + state.baseViewBox.width + 120 - vb.width;
        const minY = state.baseViewBox.y - 80;
        const maxY = state.baseViewBox.y + state.baseViewBox.height + 80 - vb.height;
        vb.x = Math.max(minX, Math.min(maxX, x - (vb.width / 2)));
        vb.y = Math.max(minY, Math.min(maxY, y - (vb.height / 2)));
        applyViewBox();
    }

    /**
     * Reset ViewBox to Base Dimensions
     */
    function resetView() {
        returnToCemeteryOverview();
    }

    /**
     * Apply Current ViewBox to SVG Element
     */
    function applyViewBox() {
        const vb = state.currentViewBox;
        cemeteryMapSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);

        // Batch 3: Level of Detail (LOD) responsive scaling
        const zoomFactor = state.baseViewBox.width / (vb.width || 1);
        cemeteryMapSvg.classList.remove('lod-low', 'lod-mid', 'lod-high', 'is-zoomed-in');
        if (zoomFactor < 1.35) {
            cemeteryMapSvg.classList.add('lod-low');
        } else if (zoomFactor < 2.4) {
            cemeteryMapSvg.classList.add('lod-mid', 'is-zoomed-in');
        } else {
            cemeteryMapSvg.classList.add('lod-high', 'is-zoomed-in');
        }
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
        // Batch 13: Verified OSM Relation 16828676 Centroid (14.6609601, 120.9580702) replaces outdated 14.6633, 120.9608
        let lat = geo ? Number(geo.latitude) : null;
        let lng = geo ? Number(geo.longitude) : null;
        if (!lat || !lng || (Math.abs(lat - 14.6633) < 0.001 && Math.abs(lng - 120.9608) < 0.001)) {
            lat = 14.6609601;
            lng = 120.9580702;
        }
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

    // =========================================================================
    // BATCH 11: TODAY'S SERVICES & FUNERAL CORTÈGE WAYFINDING
    // =========================================================================

    /**
     * Format schedule time string (HH:MM:SS) into user-friendly 12-hour format (e.g. 9:00 AM)
     */
    function formatServiceTime(timeStr) {
        if (!timeStr) return 'Today';
        const parts = String(timeStr).split(':');
        if (parts.length < 2) return timeStr;
        let hours = parseInt(parts[0], 10);
        const minutes = parts[1];
        if (isNaN(hours)) return timeStr;
        const ampm = hours >= 12 ? 'PM' : 'AM';
        hours = hours % 12;
        hours = hours ? hours : 12;
        return `${hours}:${minutes} ${ampm}`;
    }

    /**
     * Load Today's Scheduled Services for current cemetery
     * Uses cemetery-scoped, date-filtered read-only map endpoint: GET /api/map/services/today
     * Privacy-safe: zero claimant contacts, billing, or financial data.
     * @param {number} cemeteryId
     * @param {boolean} silent - Whether to suppress loading indicators (used on layout init)
     */
    async function loadTodayServices(cemeteryId, silent = false) {
        if (!cemeteryId) return;
        if (state.isTodayServicesLoading) return;

        state.isTodayServicesLoading = true;
        if (!silent) {
            if (todayServicesLoading) todayServicesLoading.style.display = 'block';
            if (todayServicesError) todayServicesError.style.display = 'none';
            if (todayServicesEmpty) todayServicesEmpty.style.display = 'none';
        }

        try {
            const res = await api.request(`map/services/today?cemetery_id=${cemeteryId}`, { method: 'GET' });
            if (res && res.success && res.data) {
                state.todayServices = Array.isArray(res.data.services) ? res.data.services : [];
                const count = state.todayServices.length;

                // Update count badge in viewport toolbar
                if (todayServicesCountBadge) {
                    if (count > 0) {
                        todayServicesCountBadge.textContent = count;
                        todayServicesCountBadge.style.display = 'inline-flex';
                    } else {
                        todayServicesCountBadge.textContent = '0';
                        todayServicesCountBadge.style.display = 'none';
                    }
                }

                // Render list in sliding panel
                renderTodayServicesList(state.todayServices);

                // Highlight scheduled lots on SVG map canvas
                highlightServiceLotsOnMap();

                // If a lot is currently selected, refresh its drawer service banner
                if (state.selectedLot && drawerTodayServiceBanner) {
                    const todaySvc = state.todayServices.find(s => parseInt(s.lot_id, 10) === parseInt(state.selectedLot.lot_id, 10));
                    if (todaySvc) {
                        drawerTodayServiceBanner.style.display = 'block';
                        if (drawerServiceTime) drawerServiceTime.textContent = todaySvc.schedule_time ? formatServiceTime(todaySvc.schedule_time) : 'Today';
                        if (drawerServiceDeceased) drawerServiceDeceased.textContent = todaySvc.deceased_name || 'Scheduled Service';
                        if (drawerServiceType) drawerServiceType.textContent = `${todaySvc.service_type || 'Burial'} Service`;
                    } else {
                        drawerTodayServiceBanner.style.display = 'none';
                    }
                }
            } else {
                if (!silent && todayServicesError) {
                    todayServicesError.style.display = 'block';
                }
            }
        } catch (err) {
            console.warn('Could not load today services:', err);
            if (!silent && todayServicesError) {
                todayServicesError.style.display = 'block';
            }
        } finally {
            state.isTodayServicesLoading = false;
            if (todayServicesLoading) todayServicesLoading.style.display = 'none';
        }
    }

    /**
     * Toggle Today's Services Sliding Overlay Panel
     * @param {boolean} [forceOpen]
     */
    function toggleTodayServices(forceOpen) {
        const nextState = (typeof forceOpen === 'boolean') ? forceOpen : !state.isTodayServicesOpen;
        state.isTodayServicesOpen = nextState;

        if (todayServicesPanel) {
            todayServicesPanel.classList.toggle('is-open', nextState);
            todayServicesPanel.setAttribute('aria-hidden', nextState ? 'false' : 'true');
        }
        if (btnToggleTodayServices) {
            btnToggleTodayServices.classList.toggle('is-active', nextState);
            btnToggleTodayServices.setAttribute('aria-expanded', nextState ? 'true' : 'false');
        }

        if (nextState) {
            // If empty or never loaded, trigger fetch
            if (state.todayServices.length === 0 && state.currentCemeteryId) {
                loadTodayServices(state.currentCemeteryId, false);
            } else {
                renderTodayServicesList(state.todayServices);
            }
        }
    }

    /**
     * Render the Today's Services Cards inside #todayServicesList
     * @param {Array} services
     */
    function renderTodayServicesList(services) {
        if (!todayServicesList) return;
        todayServicesList.innerHTML = '';

        if (!services || services.length === 0) {
            if (todayServicesEmpty) todayServicesEmpty.style.display = 'block';
            todayServicesList.style.display = 'none';
            return;
        }

        if (todayServicesEmpty) todayServicesEmpty.style.display = 'none';
        todayServicesList.style.display = 'flex';

        services.forEach((service) => {
            const card = document.createElement('div');
            card.className = `today-service-card ${state.selectedTodayServiceId === service.schedule_id ? 'is-active' : ''}`;
            card.setAttribute('data-service-id', String(service.schedule_id));
            card.setAttribute('tabindex', '0');
            card.setAttribute('role', 'region');

            const timeFormatted = formatServiceTime(service.schedule_time);
            const typeClass = (service.service_type || 'burial').toLowerCase();
            const typeLabel = service.service_type || 'Burial';

            let locLabel = 'Scheduled Location';
            if (service.lot_number) {
                locLabel = `Lot ${service.lot_number}${service.block_name ? ' • ' + service.block_name : ''}${service.section_name ? ' (' + service.section_name + ')' : ''}`;
            } else if (service.facility_name) {
                locLabel = service.facility_name;
            } else if (service.service_type === 'Cremation') {
                locLabel = 'Municipal Crematorium Facility';
            }

            card.setAttribute('aria-label', `${typeLabel} service for ${service.deceased_name || 'Scheduled Service'} at ${timeFormatted}`);

            card.innerHTML = `
                <div class="today-service-card-header">
                    <span class="service-time-badge"><i class="far fa-clock"></i> ${escapeHtml(timeFormatted)}</span>
                    <span class="service-type-badge service-type-badge--${escapeHtml(typeClass)}">${escapeHtml(typeLabel)}</span>
                </div>
                <div class="today-service-card-body">
                    <h4 class="service-deceased-name">${escapeHtml(service.deceased_name || 'Scheduled Service')}</h4>
                    <div class="service-location-meta">
                        <i class="fas fa-map-marker-alt"></i>
                        <span>${escapeHtml(locLabel)}</span>
                    </div>
                </div>
                <div class="today-service-card-actions">
                    <button type="button" class="btn-service-action btn-service-view" data-action="view" aria-label="View ${escapeHtml(service.deceased_name || '')} on Map">
                        <i class="fas fa-crosshairs"></i> View on Map
                    </button>
                    <button type="button" class="btn-service-action btn-service-route" data-action="route" aria-label="Get Directions to ${escapeHtml(service.deceased_name || '')}">
                        <i class="fas fa-directions"></i> Get Directions
                    </button>
                </div>
            `;

            // Interactive handlers
            const btnView = card.querySelector('.btn-service-view');
            const btnRoute = card.querySelector('.btn-service-route');

            if (btnView) {
                btnView.addEventListener('click', (e) => {
                    e.stopPropagation();
                    viewServiceOnMap(service);
                });
            }
            if (btnRoute) {
                btnRoute.addEventListener('click', (e) => {
                    e.stopPropagation();
                    routeToTodayService(service);
                });
            }

            card.addEventListener('click', () => {
                viewServiceOnMap(service);
            });

            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    viewServiceOnMap(service);
                }
            });

            todayServicesList.appendChild(card);
        });
    }

    /**
     * Resolve a Scheduled Service Lot in Current Layout
     * Looks through memory cache or layout block structures.
     * @param {Object} service
     * @returns {Promise<Object|null>} { lot, block, section }
     */
    async function resolveServiceLot(service) {
        if (!service || !service.lot_id || !state.currentLayout) return null;
        const targetLotId = parseInt(service.lot_id, 10);
        const sections = state.currentLayout.sections || [];

        // 1. Check in-memory block lots cache
        for (const s of sections) {
            for (const b of (s.blocks || [])) {
                const cachedLots = state.blockLotsCache[b.block_id];
                if (cachedLots) {
                    const found = cachedLots.find(l => parseInt(l.lot_id, 10) === targetLotId);
                    if (found) {
                        return { lot: found, block: b, section: s };
                    }
                }
            }
        }

        // 2. Look up matching block by block_id or block_name
        let candidateBlock = null;
        let candidateSection = null;
        if (service.block_id || service.block_name) {
            for (const s of sections) {
                for (const b of (s.blocks || [])) {
                    if ((service.block_id && b.block_id === service.block_id) ||
                        (service.block_name && b.block_name.toLowerCase() === service.block_name.toLowerCase())) {
                        candidateBlock = b;
                        candidateSection = s;
                        break;
                    }
                }
                if (candidateBlock) break;
            }
        }

        if (candidateBlock) {
            try {
                const res = await api.request(`map/blocks/${candidateBlock.block_id}/lots`, { method: 'GET' });
                if (res && res.success && res.data && Array.isArray(res.data.lots)) {
                    state.blockLotsCache[candidateBlock.block_id] = res.data.lots;
                    const found = res.data.lots.find(l => parseInt(l.lot_id, 10) === targetLotId);
                    if (found) {
                        return { lot: found, block: candidateBlock, section: candidateSection };
                    }
                }
            } catch (e) {
                console.warn('Could not retrieve candidate block lots:', e);
            }
        }

        // 3. Fallback: Search across remaining layout blocks
        for (const s of sections) {
            for (const b of (s.blocks || [])) {
                if (!state.blockLotsCache[b.block_id]) {
                    try {
                        const res = await api.request(`map/blocks/${b.block_id}/lots`, { method: 'GET' });
                        if (res && res.success && res.data && Array.isArray(res.data.lots)) {
                            state.blockLotsCache[b.block_id] = res.data.lots;
                            const found = res.data.lots.find(l => parseInt(l.lot_id, 10) === targetLotId);
                            if (found) {
                                return { lot: found, block: b, section: s };
                            }
                        }
                    } catch (e) {
                        // ignore and continue searching
                    }
                }
            }
        }

        return null;
    }

    /**
     * View Scheduled Service Destination on Interactive Map
     * Centers camera, selects lot/facility, and updates hierarchy breadcrumbs.
     * @param {Object} service
     */
    async function viewServiceOnMap(service) {
        if (!service) return;
        state.selectedTodayServiceId = service.schedule_id;

        // Highlight active service item in list
        document.querySelectorAll('.today-service-card').forEach(el => {
            el.classList.toggle('is-active', el.getAttribute('data-service-id') === String(service.schedule_id));
        });

        if (service.lot_id) {
            const resolved = await resolveServiceLot(service);
            if (resolved) {
                await navigateAndSelectLot(resolved.lot, resolved.block, resolved.section);
            } else {
                toast('Service location is not currently mapped.', 'warning');
            }
        } else if (service.service_type === 'Cremation' || (service.facility_name && service.facility_name.toLowerCase().includes('cremat'))) {
            // Crematorium facility destination
            if (state.viewLevel === 'block') {
                returnToCemeteryOverview();
            }
            centerViewOnPoint(FACILITY_ANCHORS.crematorium.x, FACILITY_ANCHORS.crematorium.y, 0.75);
            const cremEl = document.querySelector('.svg-landmark-bldg[data-landmark="crematorium"]');
            if (cremEl) {
                cremEl.classList.add('has-scheduled-service');
            }
            toast(`Viewing Municipal Crematorium for ${service.deceased_name || 'Scheduled Service'}`, 'info');
        } else {
            toast('Service location is not currently mapped.', 'warning');
        }
    }

    /**
     * Route directly to a Today's Scheduled Service Destination
     * Reuses Batch 6 Dijkstra routing engine and Batch 7 route guidance.
     * Marks route visually as Funeral Cortège Route.
     * @param {Object} service
     */
    async function routeToTodayService(service) {
        if (!service) return;
        state.selectedTodayServiceId = service.schedule_id;
        state.activeCortegeService = service;

        // Highlight active card in panel
        document.querySelectorAll('.today-service-card').forEach(el => {
            el.classList.toggle('is-active', el.getAttribute('data-service-id') === String(service.schedule_id));
        });

        if (service.lot_id) {
            const resolved = await resolveServiceLot(service);
            if (resolved) {
                focusOnLot(resolved.lot, resolved.block, resolved.section);
                generateRouteToLot(resolved.lot, resolved.block, resolved.section, true);
            } else {
                showRouteError('Service location is not currently mapped.');
            }
        } else if (service.service_type === 'Cremation' || (service.facility_name && service.facility_name.toLowerCase().includes('cremat'))) {
            centerViewOnPoint(FACILITY_ANCHORS.crematorium.x, FACILITY_ANCHORS.crematorium.y, 0.75);
            generateRouteToFacility('CREMATORIUM_ACCESS', 'Municipal Crematorium', true);
        } else {
            showRouteError('Route unavailable for this location.');
        }
    }

    /**
     * Route directly to a Mapped Facility (e.g. Crematorium) using existing Dijkstra Engine
     * @param {string} facilityNodeId
     * @param {string} facilityLabel
     * @param {boolean} autoFit
     */
    function generateRouteToFacility(facilityNodeId, facilityLabel, autoFit = true) {
        if (state.viewLevel === 'block') {
            returnToCemeteryOverview();
        }

        const nodes = MASTER_MAP_NETWORK.nodes;
        const destNode = nodes[facilityNodeId];
        if (!destNode) {
            showRouteError('Route unavailable for this location.');
            return;
        }

        const startNodeId = 'MAIN_GATE';
        const solverResult = dijkstraShortestPath(startNodeId, facilityNodeId);
        if (!solverResult || !solverResult.path || solverResult.path.length === 0) {
            showRouteError('Route unavailable for this location.');
            return;
        }

        const routePoints = [];
        solverResult.path.forEach((nodeId, idx) => {
            const node = nodes[nodeId];
            routePoints.push({
                x: node.x,
                y: node.y,
                label: node.label || nodeId,
                type: idx === 0 ? 'start' : (idx === solverResult.path.length - 1 ? 'destination' : 'network'),
                nodeId: nodeId
            });
        });

        let totalMapDist = 0;
        for (let i = 0; i < routePoints.length - 1; i++) {
            totalMapDist += Math.hypot(routePoints[i + 1].x - routePoints[i].x, routePoints[i + 1].y - routePoints[i].y);
        }

        // Build guidance steps for facility route
        const guidanceSteps = [];
        routePoints.forEach((pt, idx) => {
            const step = {
                index: idx,
                point: pt,
                title: pt.label,
                instruction: '',
                category: 'road',
                icon: 'fa-arrow-up',
                landmark: null
            };
            if (idx === 0) {
                step.title = 'Main Gate Portal';
                step.instruction = 'Depart Main Gate Portal along St. Joseph Drive';
                step.category = 'start';
                step.icon = 'fa-door-open';
                step.landmark = 'Main Gate';
            } else if (idx === routePoints.length - 1) {
                step.title = facilityLabel;
                step.instruction = `Arrive at destination: ${facilityLabel}`;
                step.category = 'destination';
                step.icon = 'fa-location-dot';
                step.landmark = facilityLabel;
            } else if (pt.nodeId === 'SOUTH_JUNCTION') {
                step.title = 'St. Joseph Drive Junction';
                step.instruction = 'Follow St. Joseph Drive toward central cemetery corridor';
                step.category = 'junction';
                step.icon = 'fa-road';
                step.landmark = 'St. Joseph Drive';
            } else if (pt.nodeId === 'CREMATORIUM_SPINE') {
                step.title = 'Central Spine (Mid South)';
                step.instruction = 'Proceed north toward crematorium driveway';
                step.category = 'road';
                step.icon = 'fa-road';
                step.landmark = 'Central Spine';
            } else {
                step.instruction = `Continue toward ${facilityLabel}`;
            }
            guidanceSteps.push(step);
        });

        state.activeRoute = {
            lot: { lot_number: facilityLabel, lot_type: 'Facility' },
            block: null,
            section: null,
            points: routePoints,
            steps: guidanceSteps,
            totalDist: totalMapDist,
            activeStepIndex: 0,
            isCortege: true
        };

        renderRouteSvg(routePoints, { lot_number: facilityLabel }, null, null, guidanceSteps);
        updateRouteInfoCard(routePoints, totalMapDist, { lot_number: facilityLabel }, null, null, destNode, guidanceSteps);
        setActiveRouteStep(0, false);

        if (mapLocationSummaryCard) {
            mapLocationSummaryCard.style.display = 'none';
        }
        if (autoFit) {
            fitRouteToViewport(routePoints);
        }
    }

    /**
     * Subtle Scheduled Service Map Markers
     * Applies .has-scheduled-service to SVG lot tiles and facilities
     */
    function highlightServiceLotsOnMap() {
        // Clear existing service markers
        document.querySelectorAll('.svg-lot-tile.has-scheduled-service').forEach(el => {
            el.classList.remove('has-scheduled-service');
        });
        document.querySelectorAll('.svg-landmark-bldg.has-scheduled-service').forEach(el => {
            el.classList.remove('has-scheduled-service');
        });

        if (!state.todayServices || state.todayServices.length === 0) return;

        state.todayServices.forEach((svc) => {
            if (svc.lot_id) {
                const tile = document.querySelector(`.svg-lot-tile[data-lot-id="${svc.lot_id}"]`);
                if (tile) {
                    tile.classList.add('has-scheduled-service');
                }
            } else if (svc.service_type === 'Cremation') {
                const cremBldg = document.querySelector('.svg-landmark-bldg[data-landmark="crematorium"]');
                if (cremBldg) {
                    cremBldg.classList.add('has-scheduled-service');
                }
            }
        });
    }

})();
