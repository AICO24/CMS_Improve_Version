/**
 * Interactive Cemetery Map & Lot Locator Controller (Batch 3)
 * 
 * Native SVG vector engine with deterministic procedural layout,
 * progressive drill-down, live status rendering, and booking deep-linking.
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
    let viewLevelBadge, viewLevelText, btnBackToOverview;
    let btnZoomIn, btnZoomOut, btnResetZoom;
    let svgStageContainer, cemeteryMapSvg, mapTransformLayer;
    let mapLoadingOverlay, loadingText, mapEmptyOverlay, emptyIcon, emptyTitle, emptyDesc, btnRetryMap;
    let svgFloatingTooltip;
    let lotDetailsDrawer, btnCloseDrawer, drawerLotNumber, drawerStatusDot, drawerStatusText;
    let drawerFacilityName, drawerSectionName, drawerBlockName, drawerLotType, drawerDimensions, drawerPrice;
    let drawerNotesRow, drawerLocationNotes, btnBookThisLot, btnLotUnavailable;

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
     */
    async function switchCemetery(cemeteryId) {
        state.currentCemeteryId = cemeteryId;
        state.currentCemetery = state.cemeteries.find(c => c.cemetery_id === cemeteryId);
        cemeterySelector.value = cemeteryId;

        // Reset state
        closeLotDrawer();
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
     * Endpoint: GET /api/map/blocks/{id}/lots
     */
    async function drillDownToBlock(block, section) {
        state.currentSection = section;
        state.currentBlock = block;
        state.viewLevel = 'block';

        updateBreadcrumbs();
        setLoading(true, `Loading lots for ${block.block_name}...`);

        try {
            const res = await api.request(`map/blocks/${block.block_id}/lots`, { method: 'GET' });
            if (res && res.success && res.data) {
                state.currentBlock = res.data.block;
                state.currentLots = res.data.lots || [];

                viewLevelText.textContent = `${section.section_name} › ${block.block_name}`;
                btnBackToOverview.style.display = 'inline-flex';

                renderBlockLotsView(res.data.block, state.currentLots);
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
