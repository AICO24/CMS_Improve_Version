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
    let mapBreadcrumbs, bcCemetery, bcCemeteryName, bcSection, bcSectionName, bcBlock, bcBlockName;
    let statSections, statBlocks, statLots;
    let viewLevelBadge, viewLevelText, btnBackToOverview, filterMatchesBadge;
    let btnZoomIn, btnZoomOut, btnResetZoom;
    let svgStageContainer, cemeteryMapSvg, mapTransformLayer;
    let mapLoadingOverlay, loadingText, mapEmptyOverlay, emptyIcon, emptyTitle, emptyDesc, btnRetryMap;
    let svgFloatingTooltip;
    let lotDetailsDrawer, btnCloseDrawer, drawerLotNumber, drawerStatusDot, drawerStatusText;
    let drawerFacilityName, drawerSectionName, drawerBlockName, drawerLotType, drawerDimensions, drawerPrice;
    let drawerNotesRow, drawerLocationNotes, btnBookThisLot, btnLotUnavailable;

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

        statSections = document.getElementById('statSections');
        statBlocks = document.getElementById('statBlocks');
        statLots = document.getElementById('statLots');

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
        drawerNotesRow = document.getElementById('drawerNotesRow');
        drawerLocationNotes = document.getElementById('drawerLocationNotes');
        btnBookThisLot = document.getElementById('btnBookThisLot');
        btnLotUnavailable = document.getElementById('btnLotUnavailable');

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

                // Auto-select first active cemetery or ID from URL parameter
                const urlParams = new URLSearchParams(window.location.search);
                const queryCemId = parseInt(urlParams.get('cemetery_id'), 10);
                const initialCem = state.cemeteries.find(c => c.cemetery_id === queryCemId) || state.cemeteries[0];

                await switchCemetery(initialCem.cemetery_id);
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
            opt.textContent = `${c.cemetery_name} (${c.cemetery_code})`;
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
            const secX = margin + (col * (sectionW + gap));
            const secY = margin + (row * (sectionH + gap));

            const secGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            secGroup.setAttribute('class', 'svg-section-card');
            secGroup.setAttribute('data-section-id', section.section_id);

            // Section Outer Card
            const secBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            secBg.setAttribute('x', secX);
            secBg.setAttribute('y', secY);
            secBg.setAttribute('width', sectionW);
            secBg.setAttribute('height', sectionH);
            secBg.setAttribute('class', 'svg-section-bg');
            secBg.setAttribute('filter', 'url(#tileShadow)');
            secGroup.appendChild(secBg);

            // Section Header Bar
            const headerH = 46;
            const secHeader = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            secHeader.setAttribute('x', secX);
            secHeader.setAttribute('y', secY);
            secHeader.setAttribute('width', sectionW);
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
            secMeta.setAttribute('x', secX + sectionW - 16);
            secMeta.setAttribute('y', secY + 28);
            secMeta.setAttribute('text-anchor', 'end');
            secMeta.setAttribute('class', 'svg-section-meta');
            secMeta.textContent = `${blocks.length} Blocks • ${section.total_lots || 0} Lots`;
            secGroup.appendChild(secMeta);

            // Render Nested Blocks Inside Section Body
            const bodyMargin = 16;
            const bodyX = secX + bodyMargin;
            const bodyY = secY + headerH + bodyMargin;
            const bodyW = sectionW - (bodyMargin * 2);
            const bodyH = sectionH - headerH - (bodyMargin * 2);

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
                    const blkX = bodyX + (bCol * (blockW + bGap));
                    const blkY = bodyY + (bRow * (blockH + bGap));

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
                    blkRect.setAttribute('width', blockW);
                    blkRect.setAttribute('height', blockH);
                    blkRect.setAttribute('class', 'svg-block-bg');
                    blkGroup.appendChild(blkRect);

                    // Block Name
                    const blkText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    blkText.setAttribute('x', blkX + 14);
                    blkText.setAttribute('y', blkY + (blockH / 2) + 5);
                    blkText.setAttribute('class', 'svg-block-title');
                    blkText.textContent = block.block_name;
                    blkGroup.appendChild(blkText);

                    // Lot Count Badge
                    const badgeTextContent = `${block.total_lots || 0} Plots`;
                    const badgeW = 70;
                    const badgeH = 24;
                    const badgeX = blkX + blockW - badgeW - 12;
                    const badgeY = blkY + (blockH / 2) - (badgeH / 2);

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

        const subtitleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        subtitleText.setAttribute('x', margin + 24);
        subtitleText.setAttribute('y', margin + 60);
        subtitleText.setAttribute('class', 'svg-section-meta');
        subtitleText.setAttribute('id', 'blockLotsSummarySubtitle');
        subtitleText.textContent = `Total Plots: ${lots.length}  |  🟢 Available: ${counts.Available}  |  🟡 Reserved: ${counts.Reserved}  |  🔴 Occupied: ${counts.Occupied}`;
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

        // Deterministic Grid Layout for Lots
        const gridX = margin;
        const gridY = margin + topHeaderH;
        const gridW = canvasW - (margin * 2);
        const gridH = canvasH - gridY - margin;

        const lotCount = lots.length;
        let cols = 5;
        if (block.map_config && block.map_config.grid && block.map_config.grid.columns) {
            cols = parseInt(block.map_config.grid.columns, 10);
        } else {
            if (lotCount <= 10) cols = 5;
            else if (lotCount <= 20) cols = 5;
            else if (lotCount <= 40) cols = 8;
            else cols = 10;
        }

        const rows = Math.ceil(lotCount / cols);
        const gapX = 14;
        const gapY = 14;

        const tileW = (gridW - ((cols - 1) * gapX)) / cols;
        const tileH = (gridH - ((rows - 1) * gapY)) / rows;

        lots.forEach((lot, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            const lotX = gridX + (col * (tileW + gapX));
            const lotY = gridY + (row * (tileH + gapY));

            const lotStatusClass = (lot.status || 'Available').toLowerCase().replace(/\s+/g, '-');
            const isSelected = state.selectedLot && state.selectedLot.lot_id === lot.lot_id;

            const lotGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            lotGroup.setAttribute('class', `svg-lot-tile lot--${lotStatusClass}${isSelected ? ' is-selected' : ''}`);
            lotGroup.setAttribute('data-lot-id', lot.lot_id);
            lotGroup.setAttribute('role', 'button');
            lotGroup.setAttribute('tabindex', '0');
            lotGroup.setAttribute('aria-label', `Lot ${lot.lot_number}, Status: ${lot.status}, Price: ${formatCurrency(lot.price)}`);

            // Lot Tile Rectangle
            const lotRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            lotRect.setAttribute('x', lotX);
            lotRect.setAttribute('y', lotY);
            lotRect.setAttribute('width', tileW);
            lotRect.setAttribute('height', tileH);
            lotRect.setAttribute('class', 'svg-lot-rect');
            lotRect.setAttribute('filter', 'url(#tileShadow)');
            lotGroup.appendChild(lotRect);

            // Lot Number Label
            const labelText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            labelText.setAttribute('x', lotX + (tileW / 2));
            labelText.setAttribute('y', lotY + (tileH / 2) - 2);
            labelText.setAttribute('text-anchor', 'middle');
            labelText.setAttribute('class', 'svg-lot-label');
            labelText.textContent = lot.lot_number;
            lotGroup.appendChild(labelText);

            // Lot Status Subtitle
            const statusText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            statusText.setAttribute('x', lotX + (tileW / 2));
            statusText.setAttribute('y', lotY + (tileH / 2) + 16);
            statusText.setAttribute('text-anchor', 'middle');
            statusText.setAttribute('class', 'svg-lot-status-text');
            statusText.textContent = lot.status;
            lotGroup.appendChild(statusText);

            // Native Title for Tooltip Accessibility
            const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
            titleEl.textContent = `Lot ${lot.lot_number} • ${lot.status} • ${formatCurrency(lot.price)}`;
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
                showFloatingTooltip(e, `<strong>Lot ${escapeHtml(lot.lot_number)}</strong><br>Status: ${escapeHtml(lot.status)}<br>Type: ${escapeHtml(lot.lot_type)}<br>Price: ${formatCurrency(lot.price)}`);
            });
            lotGroup.addEventListener('mousemove', moveFloatingTooltip);
            lotGroup.addEventListener('mouseleave', hideFloatingTooltip);

            mapTransformLayer.appendChild(lotGroup);
        });
    }

    /**
     * 4. Select Lot & Open Details Drawer
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

        // Open Drawer
        lotDetailsDrawer.classList.add('is-open');
        lotDetailsDrawer.setAttribute('aria-hidden', 'false');
    }

    /**
     * Close Lot Details Drawer
     */
    function closeLotDrawer() {
        state.selectedLot = null;
        lotDetailsDrawer.classList.remove('is-open');
        lotDetailsDrawer.setAttribute('aria-hidden', 'true');
        document.querySelectorAll('.svg-lot-tile.is-selected').forEach(el => {
            el.classList.remove('is-selected');
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
        applyFilters();
    }

    /**
     * Update Breadcrumbs Bar
     */
    function updateBreadcrumbs() {
        bcCemeteryName.textContent = state.currentCemetery?.cemetery_name || 'Cemetery Overview';

        if (state.viewLevel === 'block' && state.currentSection && state.currentBlock) {
            bcSection.style.display = 'inline-flex';
            bcSectionName.textContent = state.currentSection.section_name;

            bcBlock.style.display = 'inline-flex';
            bcBlockName.textContent = state.currentBlock.block_name;

            bcCemetery.classList.remove('active');
            bcSection.classList.remove('active');
            bcBlock.classList.add('active');
        } else {
            bcSection.style.display = 'none';
            bcBlock.style.display = 'none';
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

        // Center on lot if element exists
        if (lotElement) {
            const rectEl = lotElement.querySelector('rect');
            if (rectEl) {
                const x = parseFloat(rectEl.getAttribute('x'));
                const y = parseFloat(rectEl.getAttribute('y'));
                if (!isNaN(x) && !isNaN(y)) {
                    centerViewOnPoint(x + 50, y + 40);
                }
            }
        }
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

        if (reapply) {
            applyFilters();
        }
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
     * Center View on (X, Y) Coordinates
     */
    function centerViewOnPoint(x, y) {
        const vb = state.currentViewBox;
        vb.x = Math.max(0, x - (vb.width / 2));
        vb.y = Math.max(0, y - (vb.height / 2));
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

})();
