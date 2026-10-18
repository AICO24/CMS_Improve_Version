/**
 * Cemetery Map Geometry Calibration & Management Controller (Batch 5)
 * Admin and Staff interface for visual cemetery layout configuration,
 * section/block canvas geometry, lot grid parameters, live SVG preview,
 * bounds validation, and procedural reset.
 */
(function () {
    'use strict';

    // Application State
    const state = {
        currentUser: null,
        cemeteries: [],
        currentCemeteryId: null,
        currentCemetery: null,
        currentLayout: null,
        selectedEntity: null, // { type: 'cemetery'|'section'|'block'|'lot', id: number, rawData: object, config: object }
        viewMode: 'overview',  // 'overview' | 'block'
        selectedBlockForLots: null,
        currentBlockLots: [],
        blockLotsCache: {},
        hasUnsavedEdits: false,

        // SVG Viewport Matrix (Batch 26: Calibrated to Google Maps Layout)
        baseViewBox: { x: 440, y: 95, width: 880, height: 890 },
        currentViewBox: { x: 440, y: 95, width: 880, height: 890 },
        isPanning: false,
        panStart: { x: 0, y: 0 },
    };

    // DOM Elements
    let cemeterySelect, badgeFacilityCode, badgeCanvasSize, badgeStructureSummary;
    let btnModeOverview, btnModeBlockLots;
    let hierarchyTreeContainer, hierarchySearchInput;
    let editorEntityTitle, editorEntityTypeBadge, editorHeaderIcon;
    let groupX, groupY, hintX, hintY, inputX, inputY, inputWidth, inputHeight;
    let blockGridSection, inputGridColumns, inputGridRows, inputGridGapX, inputGridGapY;
    let validationPanel, validationStatus, validationWarningsList;
    let btnSaveGeometry, btnRevertGeometry, btnResetGeometry;
    let previewMapSvg, previewTransformLayer, selectedEntityHighlightRect, previewStageContainer;
    let previewLoadingOverlay, previewLoadingText, previewEmptyOverlay, previewEmptyTitle, previewEmptyDesc;
    let btnZoomIn, btnZoomOut, btnResetZoom, unsavedIndicator;
    let resetConfirmModal, btnCloseResetModal, btnCancelReset, btnConfirmReset, resetTargetName;

    // =========================================================================
    // INITIALIZATION & ROLE GUARD
    // =========================================================================

    document.addEventListener('DOMContentLoaded', async () => {
        initDomElements();
        initEventListeners();

        const isAuthorized = await enforceRoleGuard();
        if (!isAuthorized) return;

        await loadCemeteries();
    });

    /**
     * Enforce Admin/Staff role access on page load and populate CMS sidebar navigation.
     */
    async function enforceRoleGuard() {
        try {
            // First attempt using standard requireRole from api.js
            if (typeof requireRole === 'function') {
                const user = await requireRole(['admin', 'staff']);
                if (!user) return false;
                state.currentUser = user;
                if (typeof renderSidebarForRole === 'function') {
                    renderSidebarForRole(user.role);
                }
                return true;
            }

            const token = localStorage.getItem('jwt_token') || sessionStorage.getItem('jwt_token');
            if (!token) {
                window.location.replace(getLoginRedirectUrl());
                return false;
            }

            let session = null;
            const sessionRaw = localStorage.getItem('user_session') || sessionStorage.getItem('user_session');
            if (sessionRaw) {
                session = JSON.parse(sessionRaw);
            }

            if (!session || !session.role) {
                if (typeof api !== 'undefined') {
                    const me = await api.getMe();
                    if (me && me.role) {
                        session = me;
                        localStorage.setItem('user_session', JSON.stringify(me));
                    }
                }
            }

            if (!session || !session.role) {
                window.location.replace(getLoginRedirectUrl());
                return false;
            }

            const role = String(session.role).toLowerCase();
            if (role !== 'admin' && role !== 'staff') {
                toast('Access denied. Map calibration requires Admin or Staff privileges.', 'error');
                setTimeout(() => {
                    window.location.replace(getRoleDashboardPath(role));
                }, 1000);
                return false;
            }

            state.currentUser = session;
            if (typeof setUserDisplay === 'function') {
                setUserDisplay(session);
            } else {
                const roleEl = document.getElementById('sidebarUserRole');
                const nameEl = document.getElementById('sidebarUserName');
                if (roleEl) roleEl.textContent = role === 'admin' ? 'Administrator' : 'Staff Member';
                if (nameEl && session.full_name) nameEl.textContent = session.full_name;
            }

            if (typeof renderSidebarForRole === 'function') {
                renderSidebarForRole(role);
            }

            return true;
        } catch (e) {
            console.error('Auth verification error:', e);
            window.location.replace(getLoginRedirectUrl());
            return false;
        }
    }

    /**
     * Cache DOM element references.
     */
    function initDomElements() {
        cemeterySelect = document.getElementById('cemeterySelect');
        badgeFacilityCode = document.getElementById('badgeFacilityCode');
        badgeCanvasSize = document.getElementById('badgeCanvasSize');
        badgeStructureSummary = document.getElementById('badgeStructureSummary');

        btnModeOverview = document.getElementById('btnModeOverview');
        btnModeBlockLots = document.getElementById('btnModeBlockLots');

        hierarchyTreeContainer = document.getElementById('hierarchyTreeContainer');
        hierarchySearchInput = document.getElementById('hierarchySearchInput');

        editorEntityTitle = document.getElementById('editorEntityTitle');
        editorEntityTypeBadge = document.getElementById('editorEntityTypeBadge');
        editorHeaderIcon = document.getElementById('editorHeaderIcon');

        groupX = document.getElementById('groupX');
        groupY = document.getElementById('groupY');
        hintX = document.getElementById('hintX');
        hintY = document.getElementById('hintY');
        inputX = document.getElementById('inputX');
        inputY = document.getElementById('inputY');
        inputWidth = document.getElementById('inputWidth');
        inputHeight = document.getElementById('inputHeight');

        blockGridSection = document.getElementById('blockGridSection');
        inputGridColumns = document.getElementById('inputGridColumns');
        inputGridRows = document.getElementById('inputGridRows');
        inputGridGapX = document.getElementById('inputGridGapX');
        inputGridGapY = document.getElementById('inputGridGapY');

        validationPanel = document.getElementById('validationPanel');
        validationStatus = document.getElementById('validationStatus');
        validationWarningsList = document.getElementById('validationWarningsList');

        btnSaveGeometry = document.getElementById('btnSaveGeometry');
        btnRevertGeometry = document.getElementById('btnRevertGeometry');
        btnResetGeometry = document.getElementById('btnResetGeometry');

        previewMapSvg = document.getElementById('previewMapSvg');
        previewTransformLayer = document.getElementById('previewTransformLayer');
        selectedEntityHighlightRect = document.getElementById('selectedEntityHighlightRect');
        previewStageContainer = document.getElementById('previewStageContainer');

        previewLoadingOverlay = document.getElementById('previewLoadingOverlay');
        previewLoadingText = document.getElementById('previewLoadingText');
        previewEmptyOverlay = document.getElementById('previewEmptyOverlay');
        previewEmptyTitle = document.getElementById('previewEmptyTitle');
        previewEmptyDesc = document.getElementById('previewEmptyDesc');

        btnZoomIn = document.getElementById('btnZoomIn');
        btnZoomOut = document.getElementById('btnZoomOut');
        btnResetZoom = document.getElementById('btnResetZoom');
        unsavedIndicator = document.getElementById('unsavedIndicator');

        resetConfirmModal = document.getElementById('resetConfirmModal');
        btnCloseResetModal = document.getElementById('btnCloseResetModal');
        btnCancelReset = document.getElementById('btnCancelReset');
        btnConfirmReset = document.getElementById('btnConfirmReset');
        resetTargetName = document.getElementById('resetTargetName');
    }

    /**
     * Bind DOM Event Listeners.
     */
    function initEventListeners() {
        cemeterySelect.addEventListener('change', async (e) => {
            const newCemId = parseInt(e.target.value, 10);
            if (newCemId) {
                await switchCemetery(newCemId);
            }
        });

        btnModeOverview.addEventListener('click', () => {
            switchViewMode('overview');
        });

        btnModeBlockLots.addEventListener('click', () => {
            if (!state.selectedBlockForLots && state.currentLayout && state.currentLayout.sections && state.currentLayout.sections.length > 0) {
                const firstSec = state.currentLayout.sections[0];
                if (firstSec.blocks && firstSec.blocks.length > 0) {
                    state.selectedBlockForLots = firstSec.blocks[0];
                }
            }
            if (!state.selectedBlockForLots) {
                toast('Please select a block from the hierarchy tree first.', 'info');
                return;
            }
            switchViewMode('block');
        });

        // Form Inputs Live Updates
        const liveInputs = [inputX, inputY, inputWidth, inputHeight, inputGridColumns, inputGridGapX, inputGridGapY];
        liveInputs.forEach(input => {
            if (input) {
                input.addEventListener('input', handleFormInputChanged);
            }
        });

        // Form Action Buttons
        btnSaveGeometry.addEventListener('click', saveGeometryChanges);
        btnRevertGeometry.addEventListener('click', revertFormChanges);
        btnResetGeometry.addEventListener('click', promptResetConfirmation);

        // Reset Modal Handlers
        btnCloseResetModal.addEventListener('click', closeResetModal);
        btnCancelReset.addEventListener('click', closeResetModal);
        btnConfirmReset.addEventListener('click', executeResetAction);

        // Preview Zoom & Pan Handlers
        btnZoomIn.addEventListener('click', () => zoomPreview(0.8));
        btnZoomOut.addEventListener('click', () => zoomPreview(1.25));
        btnResetZoom.addEventListener('click', resetPreviewZoom);

        if (hierarchySearchInput) {
            hierarchySearchInput.addEventListener('input', handleHierarchySearch);
        }

        previewStageContainer.addEventListener('mousedown', handleMouseDown);
        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);

        // Logout Button Handler
        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', (e) => {
                e.preventDefault();
                if (typeof api !== 'undefined' && typeof api.logout === 'function') {
                    api.logout();
                }
            });
        }
    }

    /**
     * Safe Toast Wrapper.
     */
    function toast(message, type = 'info') {
        if (typeof showToast === 'function') {
            showToast(message, { type });
        } else {
            console.log(`[${type.toUpperCase()}] ${message}`);
        }
    }

    // =========================================================================
    // CEMETERY LOADING & CONTEXT MANAGEMENT
    // =========================================================================

    /**
     * Fetch active cemeteries list.
     */
    async function loadCemeteries() {
        try {
            const res = await api.request('cemeteries', { method: 'GET' });
            if (res && res.success && Array.isArray(res.data) && res.data.length > 0) {
                state.cemeteries = res.data;
                populateCemeterySelector(res.data);
                await switchCemetery(res.data[0].cemetery_id);
            } else {
                showPreviewEmpty('No Cemeteries Found', 'No active cemetery facilities are configured.', true);
            }
        } catch (err) {
            console.error('Failed to load cemeteries:', err);
            toast('Failed to load cemetery facilities.', 'error');
            showPreviewEmpty('Failed to Load Cemeteries', 'Unable to retrieve facilities.', true);
        }
    }

    /**
     * Populate cemetery selector dropdown.
     */
    function populateCemeterySelector(cemeteries) {
        cemeterySelect.innerHTML = '';
        cemeteries.forEach(c => {
            const opt = document.createElement('option');
            opt.value = c.cemetery_id;
            opt.textContent = `${c.cemetery_name} (${c.cemetery_code})`;
            cemeterySelect.appendChild(opt);
        });
    }

    /**
     * Switch cemetery context with complete isolation.
     */
    async function switchCemetery(cemeteryId) {
        state.currentCemeteryId = cemeteryId;
        state.currentCemetery = state.cemeteries.find(c => c.cemetery_id === cemeteryId);
        cemeterySelect.value = cemeteryId;

        // Reset context
        state.selectedEntity = null;
        state.hasUnsavedEdits = false;
        state.selectedBlockForLots = null;
        state.currentBlockLots = [];
        state.blockLotsCache = {};
        updateUnsavedIndicator();

        // Update Facility Badges
        badgeFacilityCode.textContent = `Code: ${state.currentCemetery?.cemetery_code || '—'}`;

        await loadCemeteryLayout(cemeteryId);
    }

    /**
     * Load layout overview for cemetery.
     */
    async function loadCemeteryLayout(cemeteryId) {
        setPreviewLoading(true, 'Loading cemetery layout...');
        try {
            const res = await api.request(`map/layout?cemetery_id=${cemeteryId}`, { method: 'GET' });
            if (res && res.success && res.data) {
                state.currentLayout = res.data;
                state.currentCemetery = res.data.cemetery;

                // Sync Canvas dimensions (Batch 26: Calibrated to Google Maps Layout)
                const cemCfg = res.data.cemetery?.map_config;
                if (cemCfg && cemCfg.width && cemCfg.height && (cemCfg.width !== 1600 || cemCfg.x !== undefined)) {
                    state.baseViewBox = {
                        x: cemCfg.x !== undefined ? parseFloat(cemCfg.x) : 440,
                        y: cemCfg.y !== undefined ? parseFloat(cemCfg.y) : 95,
                        width: parseFloat(cemCfg.width),
                        height: parseFloat(cemCfg.height)
                    };
                } else {
                    state.baseViewBox = { x: 440, y: 95, width: 880, height: 890 };
                }
                state.currentViewBox = { ...state.baseViewBox };
                badgeCanvasSize.textContent = `Canvas: ${state.baseViewBox.width} × ${state.baseViewBox.height}`;

                const sections = res.data.sections || [];
                let totalBlocks = 0;
                let totalLots = 0;
                sections.forEach(s => {
                    totalBlocks += (s.blocks ? s.blocks.length : 0);
                    (s.blocks || []).forEach(b => {
                        totalLots += (b.total_lots || 0);
                    });
                });
                badgeStructureSummary.textContent = `${sections.length} Sections · ${totalBlocks} Blocks · ${totalLots} Lots`;

                renderHierarchyTree();
                // Select cemetery facility by default
                selectEntity({
                    type: 'cemetery',
                    id: state.currentCemetery.cemetery_id,
                    name: state.currentCemetery.cemetery_name,
                    rawData: state.currentCemetery,
                    config: state.currentCemetery.map_config || { width: 880, height: 890 }
                });

                renderPreview();
            } else {
                showPreviewEmpty('Layout Not Found', res.error || 'The cemetery layout could not be loaded.', true);
            }
        } catch (err) {
            console.error('Error loading cemetery layout:', err);
            toast('Failed to load cemetery layout.', 'error');
            showPreviewEmpty('Layout Retrieval Error', 'Unable to retrieve cemetery layout.', true);
        } finally {
            setPreviewLoading(false);
        }
    }

    // =========================================================================
    // HIERARCHY TREE RENDERER & INTERACTION
    // =========================================================================

    /**
     * Render the cemetery hierarchy tree.
     */
    function renderHierarchyTree() {
        if (!state.currentLayout) return;

        const sections = state.currentLayout.sections || [];
        const container = hierarchyTreeContainer;
        container.innerHTML = '';

        const rootUl = document.createElement('ul');
        rootUl.className = 'hierarchy-tree';

        // Cemetery Facility Root Node
        const cemLi = document.createElement('li');
        const cemRow = document.createElement('div');
        cemRow.className = 'tree-item-row';
        cemRow.dataset.entityType = 'cemetery';
        cemRow.dataset.entityId = state.currentCemetery.cemetery_id;
        cemRow.innerHTML = `
            <div class="tree-label-group">
                <i class="fas fa-monument tree-icon"></i>
                <span>${escapeHtml(state.currentCemetery.cemetery_name)} (Canvas)</span>
                ${state.currentCemetery.map_config ? '<span class="tree-badge-customized" title="Custom Geometry Configured"></span>' : ''}
            </div>
            <i class="fas fa-chevron-right text-muted" style="font-size: 0.65rem;"></i>
        `;
        cemRow.addEventListener('click', () => {
            selectEntity({
                type: 'cemetery',
                id: state.currentCemetery.cemetery_id,
                name: state.currentCemetery.cemetery_name,
                rawData: state.currentCemetery,
                config: state.currentCemetery.map_config || { width: 1600, height: 1000 }
            });
        });
        cemLi.appendChild(cemRow);

        // Sections Sub-tree
        if (sections.length > 0) {
            const secUl = document.createElement('ul');
            secUl.className = 'tree-sub-list';

            sections.forEach(sec => {
                const secLi = document.createElement('li');
                const secRow = document.createElement('div');
                secRow.className = 'tree-item-row';
                secRow.dataset.entityType = 'section';
                secRow.dataset.entityId = sec.section_id;
                secRow.innerHTML = `
                    <div class="tree-label-group" title="${escapeHtml(sec.section_name)}">
                        <i class="fas fa-layer-group tree-icon"></i>
                        <span class="tree-name-label">${escapeHtml(sec.section_name)}</span>
                        ${sec.map_config ? '<span class="tree-badge-customized" title="Custom Geometry Configured"></span>' : ''}
                    </div>
                    <span class="tree-count-pill">${(sec.blocks || []).length} Blocks</span>
                `;
                secRow.addEventListener('click', (e) => {
                    e.stopPropagation();
                    selectEntity({
                        type: 'section',
                        id: sec.section_id,
                        name: sec.section_name,
                        rawData: sec,
                        config: sec.map_config || calculateDefaultSectionBounds(sec)
                    });
                });
                secLi.appendChild(secRow);

                // Blocks Sub-tree
                const blocks = sec.blocks || [];
                if (blocks.length > 0) {
                    const blkUl = document.createElement('ul');
                    blkUl.className = 'tree-sub-list';

                    blocks.forEach(blk => {
                        const blkLi = document.createElement('li');
                        const blkRow = document.createElement('div');
                        blkRow.className = 'tree-item-row';
                        blkRow.dataset.entityType = 'block';
                        blkRow.dataset.entityId = blk.block_id;
                        blkRow.innerHTML = `
                            <div class="tree-label-group" title="${escapeHtml(blk.block_name)}">
                                <i class="fas fa-th-large tree-icon"></i>
                                <span class="tree-name-label">${escapeHtml(blk.block_name)}</span>
                                ${blk.map_config ? '<span class="tree-badge-customized" title="Custom Geometry Configured"></span>' : ''}
                            </div>
                            <span class="tree-count-pill">${blk.total_lots || 0} Lots</span>
                        `;
                        blkRow.addEventListener('click', async (e) => {
                            e.stopPropagation();
                            state.selectedBlockForLots = blk;
                            selectEntity({
                                type: 'block',
                                id: blk.block_id,
                                name: blk.block_name,
                                rawData: blk,
                                parent: sec,
                                config: blk.map_config || calculateDefaultBlockBounds(blk, sec)
                            });
                        });
                        blkLi.appendChild(blkRow);
                        blkUl.appendChild(blkLi);
                    });

                    secLi.appendChild(blkUl);
                }

                secUl.appendChild(secLi);
            });

            cemLi.appendChild(secUl);
        }

        rootUl.appendChild(cemLi);
        container.appendChild(rootUl);

        if (hierarchySearchInput && hierarchySearchInput.value.trim()) {
            applyHierarchyFilter(hierarchySearchInput.value.trim());
        }
    }

    /**
     * Filter hierarchy tree items in real time.
     */
    function handleHierarchySearch(e) {
        applyHierarchyFilter(e.target.value);
    }

    function applyHierarchyFilter(keyword) {
        const term = (keyword || '').trim().toLowerCase();
        const rows = document.querySelectorAll('.tree-item-row');
        rows.forEach(row => {
            const text = (row.textContent || '').toLowerCase();
            const matches = !term || text.includes(term);
            const li = row.closest('li');
            if (li) {
                li.style.display = matches ? '' : 'none';
            }
        });

        if (term) {
            document.querySelectorAll('.tree-sub-list li').forEach(subLi => {
                if (subLi.style.display !== 'none') {
                    let parentLi = subLi.parentElement ? subLi.parentElement.closest('li') : null;
                    while (parentLi) {
                        parentLi.style.display = '';
                        parentLi = parentLi.parentElement ? parentLi.parentElement.closest('li') : null;
                    }
                }
            });
        }
    }

    /**
     * Compute procedural fallback bounds for section if map_config is null.
     */
    function calculateDefaultSectionBounds(sec) {
        const sections = state.currentLayout?.sections || [];
        const index = sections.findIndex(s => s.section_id === sec.section_id);
        const name = (sec.section_name || '').toLowerCase();

        // Match known cemetery master plan parcels (Full-Canvas Google Maps Acreage)
        if (name.includes('peace') || name.includes('section a') || (sec.blocks && sec.blocks.some(b => (b.block_name || '').toLowerCase().includes('a1')))) {
            return { x: 740, y: 460, width: 245, height: 370 };
        }
        if (name.includes('lourdes') || name.includes('section b') || (sec.blocks && sec.blocks.some(b => (b.block_name || '').toLowerCase().includes('b1')))) {
            return { x: 575, y: 460, width: 115, height: 370 };
        }
        if (name.includes('jose') || name.includes('section c') || (sec.blocks && sec.blocks.some(b => (b.block_name || '').toLowerCase().includes('c1')))) {
            return { x: 615, y: 175, width: 165, height: 165 };
        }
        if (name.includes('columbarium') || name.includes('ossuary') || name.includes('section d') || (sec.blocks && sec.blocks.some(b => (b.block_name || '').toLowerCase().includes('d1') || (b.block_name || '').toLowerCase().includes('reloc')))) {
            return { x: 815, y: 165, width: 125, height: 155 };
        }
        if (name.includes('reserve') || name.includes('section e') || (sec.blocks && sec.blocks.some(b => (b.block_name || '').toLowerCase().includes('e1')))) {
            return { x: 1040, y: 460, width: 110, height: 370 };
        }

        // Generic fallback grid
        const count = sections.length || 1;
        const canvasW = state.baseViewBox.width;
        const canvasH = state.baseViewBox.height;
        const margin = 40;
        const gap = 30;

        let cols = 1;
        if (count === 2) cols = 2;
        else if (count <= 4) cols = 2;
        else if (count <= 6) cols = 3;
        else cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);

        const sectionW = (canvasW - (margin * 2) - ((cols - 1) * gap)) / cols;
        const sectionH = (canvasH - (margin * 2) - ((rows - 1) * gap)) / rows;
        const col = (index >= 0 ? index : 0) % cols;
        const row = Math.floor((index >= 0 ? index : 0) / cols);

        return {
            x: Math.round(margin + (col * (sectionW + gap))),
            y: Math.round(margin + (row * (sectionH + gap))),
            width: Math.round(sectionW),
            height: Math.round(sectionH)
        };
    }

    /**
     * Compute procedural fallback bounds for block inside section if map_config is null.
     */
    function calculateDefaultBlockBounds(blk, sec) {
        const blocks = sec.blocks || [];
        const bIdx = blocks.findIndex(b => b.block_id === blk.block_id);
        const name = (sec.section_name || '').toLowerCase();
        const bName = (blk.block_name || '').toLowerCase();

        // Section A (Everlasting Peace, width: 245, height: 370):
        if (name.includes('peace') || name.includes('section a') || bName.includes('a1') || bName.includes('a2')) {
            if (bName.includes('a1') || bIdx === 0) {
                return {
                    x: 6,
                    y: 10,
                    width: 112,
                    height: 352,
                    grid: { columns: 5, rows: 10, gap_x: 2.2, gap_y: 4.5 }
                };
            } else {
                return {
                    x: 126,
                    y: 10,
                    width: 112,
                    height: 352,
                    grid: { columns: 2, rows: 3, gap_x: 12.0, gap_y: 16.0 }
                };
            }
        }

        // Section B (Our Lady of Lourdes: width: 115, height: 370):
        if (name.includes('lourdes') || name.includes('section b') || bName.includes('b1') || bName.includes('b2')) {
            if (bName.includes('b1') || bIdx === 0) {
                return {
                    x: 5,
                    y: 10,
                    width: 105,
                    height: 170,
                    grid: { columns: 2, rows: 3, gap_x: 6.0, gap_y: 8.0 }
                };
            } else {
                return {
                    x: 5,
                    y: 192,
                    width: 105,
                    height: 170,
                    grid: { columns: 2, rows: 3, gap_x: 6.0, gap_y: 8.0 }
                };
            }
        }

        // Section C (Sanctuario de San Jose: width: 165, height: 165):
        if (name.includes('jose') || name.includes('section c') || bName.includes('c1') || bName.includes('c2')) {
            if (bName.includes('c1') || bIdx === 0) {
                return {
                    x: 6,
                    y: 10,
                    width: 73,
                    height: 146,
                    grid: { columns: 2, rows: 3, gap_x: 4.0, gap_y: 6.0 }
                };
            } else {
                return {
                    x: 86,
                    y: 10,
                    width: 73,
                    height: 146,
                    grid: { columns: 2, rows: 3, gap_x: 4.0, gap_y: 6.0 }
                };
            }
        }

        // Section D (Columbarium & Ossuary Sanctuary: width: 125, height: 155):
        if (name.includes('columbarium') || name.includes('ossuary') || name.includes('section d') || bName.includes('d1') || bName.includes('reloc')) {
            return {
                x: 8,
                y: 15,
                width: 109,
                height: 130,
                grid: { columns: 7, rows: 5, gap_x: 1.0, gap_y: 1.2 }
            };
        }

        // Section E (Garden Reserve: width: 110, height: 370):
        if (name.includes('reserve') || name.includes('section e') || bName.includes('e1')) {
            return {
                x: 8,
                y: 15,
                width: 94,
                height: 345,
                grid: { columns: 5, rows: 4, gap_x: 1.5, gap_y: 1.5 }
            };
        }

        // Standard block distribution inside section (generic fallback)
        const blockCount = blocks.length || 1;
        let bCols = 1;
        if (blockCount >= 2 && blockCount <= 4) bCols = 2;
        else if (blockCount > 4) bCols = Math.ceil(Math.sqrt(blockCount));
        const bRows = Math.ceil(blockCount / bCols);

        const bodyMargin = 5;
        const headerH = 14;
        const secBounds = sec.map_config || calculateDefaultSectionBounds(sec);
        const bodyW = secBounds.width - (bodyMargin * 2);
        const bodyH = secBounds.height - headerH - (bodyMargin * 2);
        const bGap = 6;

        const blockW = (bodyW - ((bCols - 1) * bGap)) / bCols;
        const blockH = (bodyH - ((bRows - 1) * bGap)) / bRows;
        const col = (bIdx >= 0 ? bIdx : 0) % bCols;
        const row = Math.floor((bIdx >= 0 ? bIdx : 0) / bCols);

        return {
            x: Math.round(bodyMargin + (col * (blockW + bGap))),
            y: Math.round(headerH + bodyMargin + (row * (blockH + bGap))),
            width: Math.round(blockW),
            height: Math.round(blockH),
            grid: {
                columns: 5,
                rows: Math.ceil((blk.total_lots || 10) / 5),
                gap_x: 6,
                gap_y: 6
            }
        };
    }

    // =========================================================================
    // ENTITY SELECTION & FORM DATA BINDING
    // =========================================================================

    /**
     * Select an entity in the hierarchy tree & populate the editor form.
     */
    function selectEntity(entity) {
        state.selectedEntity = entity;
        state.hasUnsavedEdits = false;
        updateUnsavedIndicator();

        // Highlight in Tree
        document.querySelectorAll('.tree-item-row').forEach(row => {
            const matches = row.dataset.entityType === entity.type && parseInt(row.dataset.entityId, 10) === entity.id;
            row.classList.toggle('is-selected', matches);
        });

        // Update Editor Header & Subtitle
        editorEntityTitle.textContent = entity.name || 'Selected Entity';
        editorEntityTypeBadge.textContent = entity.type.toUpperCase();

        const subtitleEl = document.getElementById('editorEntitySubtitle');
        if (subtitleEl) {
            if (entity.type === 'cemetery') {
                subtitleEl.textContent = 'Municipal Cemetery Facility Canvas';
            } else if (entity.type === 'section') {
                subtitleEl.textContent = `${(entity.rawData?.blocks || []).length} Blocks · ${entity.rawData?.total_lots || 0} Lots`;
            } else if (entity.type === 'block') {
                const parentName = entity.parent?.section_name ? `Section: ${entity.parent.section_name}` : 'Section Block';
                subtitleEl.textContent = `${parentName} · ${entity.rawData?.total_lots || 0} Lots`;
            } else if (entity.type === 'lot') {
                subtitleEl.textContent = `Status: ${entity.rawData?.status || 'Available'} · Lot #${entity.rawData?.lot_number || entity.id}`;
            }
        }

        if (entity.type === 'cemetery') {
            editorHeaderIcon.className = 'fas fa-monument';
            editorEntityTypeBadge.style.background = '#dcfce7';
            editorEntityTypeBadge.style.color = '#15803d';
            groupX.style.display = 'none';
            groupY.style.display = 'none';
            blockGridSection.style.display = 'none';

            inputWidth.value = entity.config?.width || 880;
            inputHeight.value = entity.config?.height || 890;
        } else if (entity.type === 'section') {
            editorHeaderIcon.className = 'fas fa-layer-group';
            editorEntityTypeBadge.style.background = '#e0e7ff';
            editorEntityTypeBadge.style.color = '#3730a3';
            groupX.style.display = 'block';
            groupY.style.display = 'block';
            hintX.textContent = '(Canvas X)';
            hintY.textContent = '(Canvas Y)';
            blockGridSection.style.display = 'none';

            inputX.value = entity.config?.x ?? 740;
            inputY.value = entity.config?.y ?? 460;
            inputWidth.value = entity.config?.width ?? 245;
            inputHeight.value = entity.config?.height ?? 370;
        } else if (entity.type === 'block') {
            editorHeaderIcon.className = 'fas fa-th-large';
            editorEntityTypeBadge.style.background = '#fef3c7';
            editorEntityTypeBadge.style.color = '#b45309';
            groupX.style.display = 'block';
            groupY.style.display = 'block';
            hintX.textContent = '(Section Offset X)';
            hintY.textContent = '(Section Offset Y)';
            blockGridSection.style.display = 'block';

            inputX.value = entity.config?.x ?? 8;
            inputY.value = entity.config?.y ?? 15;
            inputWidth.value = entity.config?.width ?? 112;
            inputHeight.value = entity.config?.height ?? 345;

            const grid = entity.config?.grid || {};
            inputGridColumns.value = grid.columns ?? 5;
            inputGridRows.value = grid.rows ?? Math.ceil((entity.rawData?.total_lots || 10) / (grid.columns || 5));
            inputGridGapX.value = grid.gap_x ?? 1.5;
            inputGridGapY.value = grid.gap_y ?? 1.5;
        } else if (entity.type === 'lot') {
            editorHeaderIcon.className = 'fas fa-square';
            editorEntityTypeBadge.style.background = '#ede9fe';
            editorEntityTypeBadge.style.color = '#6d28d9';
            groupX.style.display = 'block';
            groupY.style.display = 'block';
            hintX.textContent = '(Grid Offset X)';
            hintY.textContent = '(Grid Offset Y)';
            blockGridSection.style.display = 'none';

            inputX.value = entity.config?.x ?? 0;
            inputY.value = entity.config?.y ?? 0;
            inputWidth.value = entity.config?.width ?? 10;
            inputHeight.value = entity.config?.height ?? 10;
        }

        validateCurrentForm();
        updateSelectedHighlightInPreview();
    }

    /**
     * Handle input change on geometry form: real-time live preview & validation.
     */
    function handleFormInputChanged() {
        if (!state.selectedEntity) return;

        state.hasUnsavedEdits = true;
        updateUnsavedIndicator();

        // Update working config
        const entity = state.selectedEntity;
        if (entity.type === 'cemetery') {
            entity.config.width = parseFloat(inputWidth.value) || 880;
            entity.config.height = parseFloat(inputHeight.value) || 890;
        } else {
            entity.config.x = parseFloat(inputX.value) || 0;
            entity.config.y = parseFloat(inputY.value) || 0;
            entity.config.width = parseFloat(inputWidth.value) || 100;
            entity.config.height = parseFloat(inputHeight.value) || 100;

            if (entity.type === 'block') {
                if (!entity.config.grid) entity.config.grid = {};
                entity.config.grid.columns = parseInt(inputGridColumns.value, 10) || 5;
                entity.config.grid.gap_x = parseFloat(inputGridGapX.value) || 1.5;
                entity.config.grid.gap_y = parseFloat(inputGridGapY.value) || 1.5;
                const totLots = entity.rawData?.total_lots || 10;
                inputGridRows.value = Math.ceil(totLots / (entity.config.grid.columns || 5));
            }
        }

        validateCurrentForm();
        renderPreview();
    }

    /**
     * Client-side geometry validation with real-time feedback & warnings.
     */
    function validateCurrentForm() {
        if (!state.selectedEntity) return true;

        const entity = state.selectedEntity;
        const warnings = [];
        let isValid = true;
        let errorMessage = '';

        const w = parseFloat(inputWidth.value);
        const h = parseFloat(inputHeight.value);

        if (isNaN(w) || isNaN(h) || w <= 0 || h <= 0) {
            isValid = false;
            errorMessage = 'Dimensions (Width and Height) must be strictly positive numbers.';
        }

        if (entity.type !== 'cemetery') {
            const x = parseFloat(inputX.value);
            const y = parseFloat(inputY.value);
            if (isNaN(x) || isNaN(y) || x < 0 || y < 0) {
                isValid = false;
                errorMessage = 'Coordinates (SVG X and Y) cannot be negative.';
            }

            // Section canvas boundary validation (Batch 26: Respects baseViewBox offset & dimensions)
            if (entity.type === 'section') {
                const canvasMinX = state.baseViewBox.x;
                const canvasMaxX = state.baseViewBox.x + state.baseViewBox.width;
                const canvasMinY = state.baseViewBox.y;
                const canvasMaxY = state.baseViewBox.y + state.baseViewBox.height;

                if ((x + w) < canvasMinX || x > canvasMaxX || (y + h) < canvasMinY || y > canvasMaxY) {
                    isValid = false;
                    errorMessage = 'Section is positioned completely outside the cemetery canvas.';
                } else if (x < canvasMinX || (x + w) > canvasMaxX || y < canvasMinY || (y + h) > canvasMaxY) {
                    warnings.push(`Section extends beyond canvas boundaries (${canvasMinX}..${canvasMaxX} × ${canvasMinY}..${canvasMaxY}).`);
                }
            }

            // Block section containment validation
            if (entity.type === 'block' && entity.parent) {
                const parentW = entity.parent.map_config?.width || 600;
                const parentH = entity.parent.map_config?.height || 300;
                if (x >= parentW || y >= parentH) {
                    isValid = false;
                    errorMessage = 'Block is positioned completely outside its parent section.';
                } else if ((x + w) > parentW || (y + h) > parentH) {
                    warnings.push(`Block extends beyond parent section boundaries (${parentW} × ${parentH}).`);
                }

                const cols = parseInt(inputGridColumns.value, 10);
                if (isNaN(cols) || cols < 1 || cols > 50) {
                    isValid = false;
                    errorMessage = 'Lot grid columns must be an integer between 1 and 50.';
                }
            }
        }

        // Render validation UI
        const headerVal = document.getElementById('headerValidationBadge');
        if (!isValid) {
            validationStatus.className = 'validation-status status--error';
            validationStatus.innerHTML = `<i class="fas fa-circle-xmark"></i> <span>${escapeHtml(errorMessage)}</span>`;
            btnSaveGeometry.disabled = true;
            if (headerVal) {
                headerVal.className = 'badge badge-geometry-status status--error';
                headerVal.innerHTML = '<i class="fas fa-circle-xmark"></i> Geometry Error';
            }
        } else if (warnings.length > 0) {
            validationStatus.className = 'validation-status status--warning';
            validationStatus.innerHTML = `<i class="fas fa-triangle-exclamation"></i> <span>Geometry is valid with boundary warnings.</span>`;
            btnSaveGeometry.disabled = false;
            if (headerVal) {
                headerVal.className = 'badge badge-geometry-status status--warning';
                headerVal.innerHTML = '<i class="fas fa-triangle-exclamation"></i> Review Geometry';
            }
        } else {
            validationStatus.className = 'validation-status status--valid';
            validationStatus.innerHTML = `<i class="fas fa-check-circle"></i> <span>Geometry is valid and ready to save.</span>`;
            btnSaveGeometry.disabled = false;
            if (headerVal) {
                headerVal.className = 'badge badge-geometry-status status--valid';
                headerVal.innerHTML = '<i class="fas fa-circle-check"></i> Geometry Valid';
            }
        }

        if (warnings.length > 0) {
            validationWarningsList.innerHTML = warnings.map(w => `<li>${escapeHtml(w)}</li>`).join('');
            validationWarningsList.style.display = 'block';
        } else {
            validationWarningsList.style.display = 'none';
        }

        return isValid;
    }

    /**
     * Toggle unsaved badge indicator and save state display.
     */
    function updateUnsavedIndicator() {
        if (unsavedIndicator) {
            unsavedIndicator.style.display = state.hasUnsavedEdits ? 'inline-flex' : 'none';
        }
        const saveState = document.getElementById('saveStateIndicator');
        if (saveState) {
            if (state.hasUnsavedEdits) {
                saveState.innerHTML = '<i class="fas fa-circle-exclamation text-warning"></i> <span>Unsaved changes</span>';
                saveState.className = 'save-state-row state--unsaved';
            } else {
                saveState.innerHTML = '<i class="fas fa-circle-check text-success"></i> <span>All changes saved</span>';
                saveState.className = 'save-state-row state--saved';
            }
        }
    }

    // =========================================================================
    // SAVE, REVERT, & RESET API ACTIONS
    // =========================================================================

    /**
     * Save calibrated geometry to backend API.
     */
    async function saveGeometryChanges() {
        if (!state.selectedEntity) return;
        if (!validateCurrentForm()) {
            toast('Please correct geometry validation errors before saving.', 'error');
            return;
        }

        const entity = state.selectedEntity;
        let endpoint = '';
        let payload = {};

        if (entity.type === 'cemetery') {
            endpoint = `map/cemeteries/${entity.id}/config`;
            payload = {
                width: parseFloat(inputWidth.value),
                height: parseFloat(inputHeight.value)
            };
        } else if (entity.type === 'section') {
            endpoint = `map/sections/${entity.id}/config`;
            payload = {
                cemetery_id: state.currentCemeteryId,
                map_config: {
                    x: parseFloat(inputX.value),
                    y: parseFloat(inputY.value),
                    width: parseFloat(inputWidth.value),
                    height: parseFloat(inputHeight.value)
                }
            };
        } else if (entity.type === 'block') {
            endpoint = `map/blocks/${entity.id}/config`;
            payload = {
                section_id: entity.rawData?.section_id,
                cemetery_id: state.currentCemeteryId,
                map_config: {
                    x: parseFloat(inputX.value),
                    y: parseFloat(inputY.value),
                    width: parseFloat(inputWidth.value),
                    height: parseFloat(inputHeight.value),
                    grid: {
                        columns: parseInt(inputGridColumns.value, 10),
                        gap_x: parseFloat(inputGridGapX.value),
                        gap_y: parseFloat(inputGridGapY.value)
                    }
                }
            };
        } else if (entity.type === 'lot') {
            endpoint = `map/lots/${entity.id}/config`;
            payload = {
                block_id: entity.rawData?.block_id,
                map_config: {
                    x: parseFloat(inputX.value),
                    y: parseFloat(inputY.value),
                    width: parseFloat(inputWidth.value),
                    height: parseFloat(inputHeight.value)
                }
            };
        }

        btnSaveGeometry.disabled = true;
        btnSaveGeometry.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Saving...';
        const saveState = document.getElementById('saveStateIndicator');
        if (saveState) {
            saveState.innerHTML = '<i class="fas fa-spinner fa-spin text-primary"></i> <span>Saving changes...</span>';
            saveState.className = 'save-state-row state--saving';
        }

        try {
            const res = await api.request(endpoint, {
                method: 'PUT',
                body: payload
            });

            if (res && res.success) {
                toast(res.message || 'Geometry saved successfully!', 'success');
                state.hasUnsavedEdits = false;
                updateUnsavedIndicator();

                // Refresh layout context while preserving current selection
                await reloadLayoutAndMaintainSelection();
            } else {
                toast(res.error || 'Failed to save geometry configuration.', 'error');
                if (saveState) {
                    saveState.innerHTML = '<i class="fas fa-circle-xmark text-danger"></i> <span>Save failed</span>';
                    saveState.className = 'save-state-row state--error';
                }
            }
        } catch (err) {
            console.error('Save error:', err);
            toast(err.message || 'Error communicating with server.', 'error');
            if (saveState) {
                saveState.innerHTML = '<i class="fas fa-circle-xmark text-danger"></i> <span>Save failed</span>';
                saveState.className = 'save-state-row state--error';
            }
        } finally {
            btnSaveGeometry.disabled = false;
            btnSaveGeometry.innerHTML = '<i class="fas fa-floppy-disk"></i> Save Changes';
        }
    }

    /**
     * Revert form to last committed values.
     */
    function revertFormChanges() {
        if (!state.selectedEntity) return;
        selectEntity(state.selectedEntity);
        toast('Changes reverted to last saved state.', 'info');
    }

    /**
     * Open confirmation modal for procedural layout reset.
     */
    function promptResetConfirmation() {
        if (!state.selectedEntity) return;
        resetTargetName.textContent = `"${state.selectedEntity.name || 'this item'}" (${state.selectedEntity.type.toUpperCase()})`;
        resetConfirmModal.style.display = 'flex';
    }

    function closeResetModal() {
        resetConfirmModal.style.display = 'none';
    }

    /**
     * Execute reset action via backend reset endpoint.
     */
    async function executeResetAction() {
        if (!state.selectedEntity) return;

        const entity = state.selectedEntity;
        let endpoint = '';

        if (entity.type === 'cemetery') {
            endpoint = `map/cemeteries/${entity.id}/reset`;
        } else if (entity.type === 'section') {
            endpoint = `map/sections/${entity.id}/reset`;
        } else if (entity.type === 'block') {
            endpoint = `map/blocks/${entity.id}/reset`;
        } else if (entity.type === 'lot') {
            endpoint = `map/lots/${entity.id}/reset`;
        }

        btnConfirmReset.disabled = true;
        btnConfirmReset.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Resetting...';

        try {
            const res = await api.request(endpoint, { method: 'POST' });
            if (res && res.success) {
                toast(res.message || 'Geometry reset to default layout.', 'success');
                closeResetModal();
                state.hasUnsavedEdits = false;
                updateUnsavedIndicator();
                await reloadLayoutAndMaintainSelection();
            } else {
                toast(res.error || 'Failed to reset layout.', 'error');
            }
        } catch (err) {
            console.error('Reset error:', err);
            toast(err.message || 'Failed to reset geometry.', 'error');
        } finally {
            btnConfirmReset.disabled = false;
            btnConfirmReset.innerHTML = '<i class="fas fa-rotate-left"></i> Confirm Reset';
        }
    }

    /**
     * Refresh layout from API and restore selection state cleanly.
     */
    async function reloadLayoutAndMaintainSelection() {
        const prevSelected = state.selectedEntity ? { ...state.selectedEntity } : null;
        await loadCemeteryLayout(state.currentCemeteryId);

        if (prevSelected && state.currentLayout) {
            if (prevSelected.type === 'cemetery') {
                selectEntity({
                    type: 'cemetery',
                    id: state.currentCemetery.cemetery_id,
                    name: state.currentCemetery.cemetery_name,
                    rawData: state.currentCemetery,
                    config: state.currentCemetery.map_config || { width: 1600, height: 1000 }
                });
            } else if (prevSelected.type === 'section') {
                const sec = (state.currentLayout.sections || []).find(s => s.section_id === prevSelected.id);
                if (sec) {
                    selectEntity({
                        type: 'section',
                        id: sec.section_id,
                        name: sec.section_name,
                        rawData: sec,
                        config: sec.map_config || calculateDefaultSectionBounds(sec)
                    });
                }
            } else if (prevSelected.type === 'block') {
                for (const sec of (state.currentLayout.sections || [])) {
                    const blk = (sec.blocks || []).find(b => b.block_id === prevSelected.id);
                    if (blk) {
                        state.selectedBlockForLots = blk;
                        selectEntity({
                            type: 'block',
                            id: blk.block_id,
                            name: blk.block_name,
                            rawData: blk,
                            parent: sec,
                            config: blk.map_config || calculateDefaultBlockBounds(blk, sec)
                        });
                        break;
                    }
                }
            }
        }
    }

    // =========================================================================
    // LIVE SVG PREVIEW RENDERER
    // =========================================================================

    /**
     * Switch view mode between 'overview' and 'block'.
     */
    function switchViewMode(mode) {
        state.viewMode = mode;
        btnModeOverview.classList.toggle('is-active', mode === 'overview');
        btnModeBlockLots.classList.toggle('is-active', mode === 'block');
        renderPreview();
    }

    /**
     * Render the preview SVG according to current view mode.
     */
    function renderPreview() {
        if (!state.currentLayout) return;

        previewTransformLayer.innerHTML = '';
        applyViewBox();

        if (state.viewMode === 'overview') {
            renderOverviewPreview();
        } else {
            renderBlockLotsPreview();
        }

        updateSelectedHighlightInPreview();
    }

    /**
     * Ensure SVG patterns, gradients and filters needed for master cemetery plan.
     */
    function ensureMasterPlanDefs() {
        if (!previewMapSvg) return;
        let defs = previewMapSvg.querySelector('defs');
        if (!defs) {
            defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs');
            previewMapSvg.insertBefore(defs, previewMapSvg.firstChild);
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
            const ls = document.createElementNS('http://www.w3.org/2000/svg', 'pattern');
            ls.setAttribute('id', 'mpLawnStripes');
            ls.setAttribute('width', '16');
            ls.setAttribute('height', '16');
            ls.setAttribute('patternUnits', 'userSpaceOnUse');
            ls.setAttribute('patternTransform', 'rotate(45)');
            ls.innerHTML = '<rect width="8" height="16" fill="rgba(255,255,255,0.03)"/><rect x="8" width="8" height="16" fill="rgba(0,0,0,0.03)"/>';
            defs.appendChild(ls);
        }
        if (!document.getElementById('cemeteryParcelClip')) {
            const cp = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            cp.setAttribute('id', 'cemeteryParcelClip');
            cp.innerHTML = '<polygon points="560.0,835.0 715.0,862.0 745.0,867.0 990.0,873.0 1020.0,877.0 1168.9,900.0 1102.3,690.7 1058.9,697.8 1052.4,491.2 1033.7,400.5 1022.7,403.1 1022.1,146.6 975.8,145.0 864.5,145.0 808.5,145.0 720.0,150.0 660.0,165.0 600.0,200.0 575.0,300.0 565.0,440.0 560.0,600.0"/>';
            defs.appendChild(cp);
        }
    }

    /**
     * Render the Continuous Geographic Cemetery Master Plan Base
     * (Roads, Landscaping, Frontage, Landmarks, and Boundaries).
     * Synchronized with Google Maps layout in Batch 26-28.
     */
    function renderMasterPlanBackdrop(container, canvasW, canvasH) {
        ensureMasterPlanDefs();

        const f1 = (n) => Math.round(n * 10) / 10;
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

        const treeCluster = (cx, cy, count, radius, rMin, rMax) => {
            let out = '';
            for (let i = 0; i < count; i++) {
                const ang = (i / count) * Math.PI * 2 + rnd() * 0.5;
                const dist = rnd() * radius;
                const x = cx + Math.cos(ang) * dist;
                const y = cy + Math.sin(ang) * dist;
                out += treeSvg(x, y, rMin + rnd() * (rMax - rMin), Math.floor(rnd() * 4));
            }
            return out;
        };

        const pillSvg = (cx, cy, text, icon, variant) => {
            const w = Math.round(text.length * 4.6 + (icon ? 18 : 10));
            const h = 13;
            const x = cx - w / 2;
            return `<g class="mp-pill mp-pill--${variant}" opacity="0.92">` +
                `<rect x="${f1(x)}" y="${f1(cy - 7)}" width="${w}" height="${h}" rx="3" class="mp-pill-bg"/>` +
                (icon ? `<text x="${f1(x + 7)}" y="${f1(cy + 2.2)}" class="mp-pill-icon" font-size="7">${icon}</text>` : '') +
                `<text x="${f1(cx + (icon ? 3.5 : 0))}" y="${f1(cy + 2.0)}" class="mp-pill-text" font-size="6.4">${text}</text>` +
                `</g>`;
        };

        // Continuous Verified Cemetery Grounds: Full Canvas Perimeter (Google Maps Geometry)
        const CEMETERY_POLYGON_POINTS = "560.0,835.0 715.0,862.0 745.0,867.0 990.0,873.0 1020.0,877.0 1168.9,900.0 1102.3,690.7 1058.9,697.8 1052.4,491.2 1033.7,400.5 1022.7,403.1 1022.1,146.6 975.8,145.0 864.5,145.0 808.5,145.0 720.0,150.0 660.0,165.0 600.0,200.0 575.0,300.0 565.0,440.0 560.0,600.0";

        // Verified physical facility footprints
        const FACILITY_STRUCTURES = [
            { id: 'bldg-927998601', wayId: 927998601, points: '776.2,365.4 790.5,364.9 791.3,385.0 776.8,385.8', cx: 783.7, cy: 375.3 },
            { id: 'bldg-927998602', wayId: 927998602, points: '774.0,373.8 788.3,373.4 789.1,393.4 774.5,394.2', cx: 781.5, cy: 383.7 },
            { id: 'bldg-930065359', wayId: 930065359, points: '861.0,203.5 828.5,202.9 828.1,225.3 862.0,223.7', cx: 844.9, cy: 213.8 },
            { id: 'bldg-930065360', wayId: 930065360, points: '859.5,230.5 826.9,230.0 826.6,252.3 860.4,250.7', cx: 843.4, cy: 240.9 },
            { id: 'bldg-930065361', wayId: 930065361, points: '857.4,262.3 824.8,261.8 824.5,284.1 858.3,282.6', cx: 841.2, cy: 272.7 },
            { id: 'bldg-930065362', wayId: 930065362, points: '857.4,292.5 824.8,291.9 824.5,314.2 858.3,312.6', cx: 841.2, cy: 302.8 },
            { id: 'bldg-930065364', wayId: 930065364, points: '899.4,231.0 866.8,230.4 866.5,252.7 900.3,251.2', cx: 883.2, cy: 241.3 },
            { id: 'bldg-930065363', wayId: 930065363, points: '901.9,263.6 869.3,263.0 869.0,285.4 902.9,283.8', cx: 885.8, cy: 273.9 },
            { id: 'bldg-930065367', wayId: 930065367, points: '903.2,289.5 870.6,288.9 870.3,311.2 904.1,309.7', cx: 887.0, cy: 299.8 },
            { id: 'bldg-930065369', wayId: 930065369, points: '866.2,349.0 843.7,349.7 851.0,374.1 869.6,373.4', cx: 857.6, cy: 361.6 },
            { id: 'bldg-930065370', wayId: 930065370, points: '896.4,346.9 873.8,347.6 881.2,372.0 899.7,371.3', cx: 887.8, cy: 359.4 },
            { id: 'bldg-930065365', wayId: 930065365, points: '936.7,243.8 927.3,243.7 927.2,250.1 937.0,249.7', cx: 932.0, cy: 246.8 },
            { id: 'bldg-930065366', wayId: 930065366, points: '949.4,262.3 933.2,261.8 935.2,276.2 947.5,276.9 952.5,277.0', cx: 943.6, cy: 270.8 },
            { id: 'bldg-930065368', wayId: 930065368, points: '947.5,276.9 933.5,282.0 932.3,302.0 950.9,301.4', cx: 941.0, cy: 290.6 },
            { id: 'bldg-930065371', wayId: 930065371, points: '994.8,255.7 956.2,255.9 965.6,285.5 996.5,284.8', cx: 978.3, cy: 270.5 }
        ];

        const sitePlanGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        sitePlanGroup.setAttribute('class', 'mp-master-site-plan-backdrop');
        sitePlanGroup.style.pointerEvents = 'none';

        // 1. Surround Canvas & Ground Lawn
        let groundHtml = `
            <rect x="300" y="0" width="1100" height="1100" class="mp-surround"/>
            <rect x="300" y="0" width="1100" height="1100" fill="url(#mpGrassSpeckle)" class="mp-texture"/>

            <!-- Surrounding Geographic Context (Matching Google Maps Neighborhood) -->
            <g class="mp-surrounding-context" aria-hidden="true">
                <text x="510" y="470" class="mp-context-label" style="font-size: 8px;">BARANGAY TONSUYA</text>
                <text x="510" y="484" class="mp-context-sublabel" style="font-size: 6.8px;">Residential Area • Rosal St.</text>

                <text x="1210" y="470" class="mp-context-label" style="font-size: 8px;">OUR LADY OF LOURDES</text>
                <text x="1210" y="484" class="mp-context-sublabel" style="font-size: 6.8px;">Adjacent Memorial Park</text>
            </g>

            <!-- Verified 19-Vertex Cemetery Property Boundary (OSM Relation 16828676) -->
            <polygon points="${CEMETERY_POLYGON_POINTS}" class="svg-cemetery-ground mp-property"/>
            <polygon points="${CEMETERY_POLYGON_POINTS}" fill="url(#mpGrassSpeckle)" class="mp-texture"/>
        `;

        // P. Aquino Avenue (Letre Road) Frontage along southern edge
        let crosswalkBars = '';
        for (let cx = 710; cx <= 750; cx += 8) {
            const cy = 948 + (cx - 730) * 0.172;
            crosswalkBars += `<rect x="${cx}" y="${f1(cy)}" width="5" height="34" transform="rotate(9.8 ${cx} ${f1(cy)})" class="mp-crosswalk"/>`;
        }
        for (let cx = 985; cx <= 1025; cx += 8) {
            const cy = 948 + (cx - 1005) * 0.172;
            crosswalkBars += `<rect x="${cx}" y="${f1(cy)}" width="5" height="34" transform="rotate(9.8 ${cx} ${f1(cy)})" class="mp-crosswalk"/>`;
        }
        groundHtml += `
            <g class="svg-external-road-group mp-frontage">
                <polygon points="350,962 1450,1154 1450,1166 350,974" class="mp-sidewalk"/>
                <polygon points="350,972 1450,1164 1450,1230 350,1038" class="mp-ext-road"/>
                <line x1="350" y1="973.5" x2="1450" y2="1165.5" class="mp-ext-edge"/>
                <line x1="350" y1="1036.5" x2="1450" y2="1228.5" class="mp-ext-edge"/>
                <line x1="350" y1="1005.0" x2="1450" y2="1197.0" class="mp-ext-centerline"/>
                ${crosswalkBars}
                <polygon points="350,1038 1450,1230 1450,1242 350,1050" class="mp-sidewalk"/>
                <text x="560" y="990" transform="rotate(9.8 560 990)" class="mp-ext-lane-label">◂  WESTBOUND (TONSUYA / LETRE)</text>
                <text x="1140" y="1090" transform="rotate(9.8 1140 1090)" class="mp-ext-lane-label">EASTBOUND (MALABON / C-4)  ▸</text>
                ${pillSvg(870, 995, '⟵   P. AQUINO AVENUE (LETRE ROAD)   ⟶', '', 'road')}
            </g>
            <text x="890" y="132" class="mp-north-label">NORTH BOUNDARY (MALABON/TONSUYA)</text>
        `;

        // Perimeter Wall with Main Gate Opening & Posts
        const outerWallD = "M 1020.0 877.0 L 1168.9 900.0 L 1102.3 690.7 L 1058.9 697.8 L 1052.4 491.2 L 1033.7 400.5 L 1022.7 403.1 L 1022.1 146.6 L 975.8 145.0 L 864.5 145.0 L 808.5 145.0 L 720.0 150.0 L 660.0 165.0 L 600.0 200.0 L 575.0 300.0 L 565.0 440.0 L 560.0 600.0 L 560.0 835.0 L 715.0 862.0 M 745.0 867.0 L 990.0 873.0";
        const innerWallD = "M 1020.0 873.0 L 1163.8 895.6 L 1098.0 693.0 L 1055.5 701.9 L 1048.9 491.6 L 1031.0 404.8 L 1019.2 407.5 L 1018.6 150.2 L 976.0 149.0 L 865.6 149.0 L 811.1 149.0 L 722.0 154.0 L 663.0 169.0 L 604.0 203.0 L 579.0 302.0 L 569.0 441.0 L 564.0 600.0 L 564.0 831.0 L 715.0 858.0 M 745.0 863.0 L 990.0 869.0";
        groundHtml += `
            <path d="${outerWallD}" class="mp-wall"/>
            <path d="${innerWallD}" class="mp-wall-inner"/>
            <g class="mp-wall-posts" aria-hidden="true">
                <rect x="712.5" y="859.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="744.5" y="864.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="987.5" y="870.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="1019.5" y="874.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="1166.4" y="897.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="1099.8" y="688.2" width="5" height="5" class="mp-wall-post"/>
                <rect x="1056.4" y="695.3" width="5" height="5" class="mp-wall-post"/>
                <rect x="1049.9" y="488.7" width="5" height="5" class="mp-wall-post"/>
                <rect x="1031.2" y="398.0" width="5" height="5" class="mp-wall-post"/>
                <rect x="1019.6" y="144.1" width="5" height="5" class="mp-wall-post"/>
                <rect x="973.3" y="142.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="862.0" y="142.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="806.0" y="142.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="717.5" y="147.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="657.5" y="162.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="597.5" y="197.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="572.5" y="297.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="562.5" y="437.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="557.5" y="597.5" width="5" height="5" class="mp-wall-post"/>
                <rect x="557.5" y="832.5" width="5" height="5" class="mp-wall-post"/>
            </g>
            <g class="svg-landscaping-group mp-trees" aria-hidden="true">${
                treeLine(560, 835, 715, 862, 22, 6, 8, 1.0) +
                treeLine(745, 867, 990, 873, 24, 6, 8, 1.0) +
                treeLine(1020, 877, 1168.9, 900.0, 22, 6, 8, 1.0) +
                treeLine(1168.9, 900.0, 1102.3, 690.7, 22, 6.5, 9, 1.2) +
                treeLine(1102.3, 690.7, 1058.9, 697.8, 20, 6, 8, 1.0) +
                treeLine(1058.9, 697.8, 1052.4, 491.2, 22, 6.5, 9, 1.2) +
                treeLine(1052.4, 491.2, 1033.7, 400.5, 20, 6, 8.5, 1.0) +
                treeLine(1033.7, 400.5, 1022.7, 403.1, 18, 5.5, 7, 0.8) +
                treeLine(1022.7, 403.1, 1022.1, 146.6, 22, 6.5, 9, 1.2) +
                treeLine(1022.1, 146.6, 975.8, 145.0, 20, 6, 8, 1.0) +
                treeLine(975.8, 145.0, 864.5, 145.0, 22, 6.5, 9, 1.2) +
                treeLine(864.5, 145.0, 808.5, 145.0, 22, 6.5, 9, 1.2) +
                treeLine(808.5, 145.0, 720.0, 150.0, 22, 6.5, 9, 1.2) +
                treeLine(720.0, 150.0, 660.0, 165.0, 22, 6.5, 9, 1.2) +
                treeLine(660.0, 165.0, 600.0, 200.0, 22, 6.5, 8.5, 1.0) +
                treeLine(600.0, 200.0, 575.0, 300.0, 22, 6.5, 8.5, 1.0) +
                treeLine(575.0, 300.0, 565.0, 440.0, 22, 6.5, 9, 1.2) +
                treeLine(565.0, 440.0, 560.0, 600.0, 22, 6.5, 9, 1.2) +
                treeLine(560.0, 600.0, 560.0, 835.0, 22, 6.5, 9, 1.2)
            }</g>
        `;

        // 2. Connected Roads & Pathways
        const roads = [
            { d: 'M 730 920 L 730 870 C 725 800 705 720 705 600 L 705 440', w: 22, main: true },
            { d: 'M 705 440 C 720 410 780 395 860 380 C 910 370 955 365 980 365', w: 20, main: true },
            { d: 'M 705 440 C 680 410 620 395 595 350 C 575 300 580 230 620 185 C 660 155 720 150 800 150 H 940', w: 18, main: true },
            { d: 'M 940 150 C 990 150 1015 185 1015 250 L 1015 340', w: 18, main: true },
            { d: 'M 800 385 V 150', w: 16 },
            { d: 'M 1010 400 C 1015 500 1015 630 1010 750 L 1005 870 L 1005 920', w: 20, main: true }
        ];

        // Pedestrian Walkways connecting landmarks, roads, and block parcels
        const primaryPaths = [
            `M 705 600 H 740`,
            `M 800 380 V 430`,
            `M 860 380 V 330`,
            `M 800 270 H 750`,
            `M 932 245 H 960`,
            `M 1010 340 V 270`,
            `M 1005 750 H 970`
        ];

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

        // Northeast Roundabout / Rotunda
        const rotundaHtml = `
            <circle cx="1010" cy="370" r="30" class="mp-road-curb" stroke-width="26"/>
            <circle cx="1010" cy="370" r="30" class="mp-road mp-road--main" stroke-width="22"/>
            <circle cx="1010" cy="370" r="30" class="mp-road-line" stroke-dasharray="6 5"/>
            <path d="M 1018 340 L 1002 340 M 1007 336 L 1002 340 L 1007 344" fill="none" stroke="#ffffff" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" opacity="0.85"/>
            <circle cx="1010" cy="370" r="18" class="mp-road-curb" stroke-width="2"/>
            <circle cx="1010" cy="370" r="17" fill="#4e8346" stroke="#2e5926" stroke-width="1.5"/>
            <circle cx="1010" cy="370" r="17" fill="url(#mpLawnStripes)" class="mp-texture"/>
            <circle cx="1010" cy="370" r="5" fill="#e2e8f0" stroke="#475569" stroke-width="1"/>
            <circle cx="1010" cy="370" r="2.2" fill="#f59e0b"/>
            ${treeCluster(1010, 370, 3, 7, 2.5, 4.2)}
            ${pillSvg(1010, 322, 'Memorial Rotunda', '⭕', 'navy')}
        `;

        groundHtml += `
            <g class="svg-road-network mp-roads">
                ${pathUnder}
                ${pathFill}
                ${roadCurbs}
                ${roadAsphalt}
                ${roadStripes}
                ${rotundaHtml}
                <!-- Road Name Annotations -->
                <text x="715" y="720" class="mp-road-label mp-road-label--minor" transform="rotate(-90 715 720)">MAIN INGRESS (WEST)</text>
                <text x="995" y="720" class="mp-road-label mp-road-label--minor" transform="rotate(90 995 720)">EGRESS ROAD (EAST)</text>
                <text x="860" y="372" class="mp-road-label">CENTRAL CONNECTOR</text>
                <text x="610" y="270" class="mp-road-label mp-road-label--minor" transform="rotate(-65 610 270)">NORTHWEST DRIVE</text>
                <text x="860" y="145" class="mp-road-label mp-road-label--minor">NORTH PERIMETER ROAD</text>
                <text x="795" y="270" class="mp-road-label mp-road-label--minor" transform="rotate(-90 795 270)">AVENUE OF PEACE</text>
            </g>
            <g class="mp-trees" aria-hidden="true">${
                treeLine(685, 870, 680, 500, 26, 6.5, 8.5, 0.4) +
                treeLine(1030, 430, 1030, 870, 26, 6.5, 8.5, 0.4) +
                treeLine(565, 330, 600, 200, 24, 6.5, 8.5, 0.4) +
                treeLine(620, 165, 780, 135, 26, 6.5, 8.5, 0.4)
            }</g>
        `;

        // 3. Physical Facility Structures (15 Mapped OSM Footprints)
        let structHtml = '';
        FACILITY_STRUCTURES.forEach(s => {
            structHtml += `
                <polygon points="${s.points}" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
                <polygon points="${s.points}" class="mp-bldg-wall mp-facility-footprint" data-way-id="${s.wayId}"/>
                <polygon points="${s.points}" class="mp-facility-roof"/>
            `;
        });

        groundHtml += `
            <g id="facilityStructures" class="mp-facility-structures" aria-hidden="true">
                ${structHtml}
            </g>
            <g class="mp-trees" aria-hidden="true">${
                shrubLine(820, 325, 915, 325, 12, 3) +
                shrubLine(920, 215, 920, 320, 12, 3) +
                shrubLine(988, 715, 1072, 715, 12, 3.2) +
                shrubLine(988, 794, 1072, 794, 12, 3.2) +
                treeCluster(975, 730, 3, 10, 6.5, 8.5) +
                treeCluster(975, 780, 3, 10, 6.5, 8.5) +
                treeCluster(805, 360, 3, 8, 6, 8) +
                treeCluster(915, 355, 3, 8, 6, 8) +
                treeCluster(995, 235, 3, 10, 6.5, 8.5) +
                treeCluster(995, 305, 3, 10, 6.5, 8.5)
            }</g>
        `;

        groundHtml += `
            <g class="svg-landmarks-group mp-landmarks">
                <!-- Visitor Parking Area -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="parking">
                    <title>Visitor Parking Area — Entrance Corridor (Operational Landmark)</title>
                    <rect x="990" y="706" width="86" height="86" rx="4" class="mp-parking-curb"/>
                    <rect x="993" y="709" width="80" height="80" rx="3" class="mp-parking"/>
                    <line x1="993" y1="724" x2="1044" y2="724" class="mp-parking-stripe"/>
                    <line x1="993" y1="739" x2="1044" y2="739" class="mp-parking-stripe"/>
                    <line x1="993" y1="754" x2="1044" y2="754" class="mp-parking-stripe"/>
                    <line x1="993" y1="769" x2="1044" y2="769" class="mp-parking-stripe"/>
                    <rect x="998" y="712" width="24" height="10" rx="2" fill="#1e3a5f" class="mp-car"/>
                    <rect x="998" y="727" width="24" height="10" rx="2" fill="#e5e7eb" class="mp-car"/>
                    <rect x="998" y="742" width="24" height="10" rx="2" fill="#9f1239" class="mp-car"/>
                    <rect x="998" y="757" width="24" height="10" rx="2" fill="#475569" class="mp-car"/>
                    <rect x="995" y="772" width="30" height="15" rx="1.5" class="mp-parking-pwd"/>
                    <text x="1010" y="784" class="mp-parking-pwd-icon">♿</text>
                    <path d="M 1056 720 V 764 M 1051 758 L 1056 764 L 1061 758" class="mp-parking-arrow"/>
                    ${pillSvg(1034, 749, 'Visitor Parking', 'P', 'navy')}
                </g>

                <!-- Administration Office -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="admin">
                    <title>Administration Office — Mapped Structures 927998601/927998602</title>
                    <rect x="764" y="332" width="30" height="40" rx="2" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
                    <rect x="764" y="332" width="30" height="40" rx="2" class="mp-bldg-wall"/>
                    <rect x="766" y="334" width="26" height="36" rx="1" fill="#8aa1bd"/>
                    <line x1="766" y1="352" x2="792" y2="352" class="mp-roof-ridge mp-roof-ridge--thin"/>
                    <rect x="788" y="347" width="8" height="10" rx="1" class="mp-bldg-wall"/>
                    <rect x="789" y="348" width="6" height="8" fill="#cbd5e1"/>
                    ${pillSvg(778, 320, 'Admin Office', '🏢', 'navy')}
                </g>

                <!-- Memorial Chapel -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="chapel">
                    <title>Memorial Chapel — Mapped Structure 930065369</title>
                    <rect x="834" y="330" width="36" height="42" rx="2" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
                    <rect x="834" y="330" width="36" height="42" rx="2" class="mp-bldg-wall"/>
                    <rect x="836" y="332" width="16" height="38" fill="#5b80ab"/>
                    <rect x="852" y="332" width="16" height="38" fill="#3d628d"/>
                    <line x1="852" y1="332" x2="852" y2="370" class="mp-roof-ridge"/>
                    <line x1="852" y1="324" x2="852" y2="336" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
                    <line x1="848" y1="328" x2="856" y2="328" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
                    <rect x="845" y="370" width="14" height="6" rx="1" class="mp-bldg-wall"/>
                    ${pillSvg(852, 318, 'Memorial Chapel', '✝', 'navy')}
                </g>

                <!-- Crematorium Facility -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="crematorium">
                    <title>Everlasting Peace Crematorium — Calibrated Structure (Google Maps Verified)</title>
                    <rect x="952" y="240" width="54" height="44" rx="2" class="mp-bldg-shadow" transform="translate(2 2)"/>
                    <rect x="952" y="240" width="54" height="44" rx="2" fill="#f8f6f0" stroke="#334155" stroke-width="1.4"/>
                    <rect x="956" y="262" width="46" height="16" rx="1" fill="#1e293b" stroke="#0f172a" stroke-width="0.8"/>
                    <line x1="979" y1="262" x2="979" y2="278" stroke="#475569" stroke-width="0.8"/>
                    <rect x="954" y="242" width="50" height="18" fill="#ece8dd" stroke="#94a3b8" stroke-width="0.8"/>
                    <line x1="954" y1="245" x2="1004" y2="245" stroke="#64748b" stroke-width="1.2"/>
                    <line x1="954" y1="242" x2="954" y2="248" stroke="#64748b" stroke-width="0.8"/>
                    <line x1="966" y1="242" x2="966" y2="248" stroke="#64748b" stroke-width="0.8"/>
                    <line x1="979" y1="242" x2="979" y2="248" stroke="#64748b" stroke-width="0.8"/>
                    <line x1="992" y1="242" x2="992" y2="248" stroke="#64748b" stroke-width="0.8"/>
                    <line x1="1004" y1="242" x2="1004" y2="248" stroke="#64748b" stroke-width="0.8"/>
                    <rect x="961" y="250" width="36" height="8" rx="1" fill="#e2ded4" stroke="#94a3b8" stroke-width="0.6"/>
                    <text x="979" y="255.8" font-family="'Inter', sans-serif" font-size="3.4" font-weight="900" letter-spacing="0.1em" fill="#0f172a" text-anchor="middle">CREMATORIUM</text>
                    <rect x="993" y="242" width="6" height="6" rx="1" fill="#475569" stroke="#1e293b" stroke-width="0.6"/>
                    <circle cx="996" cy="245" r="1.5" fill="#1e293b"/>
                    <rect x="962" y="280" width="34" height="6" rx="1" class="mp-bldg-wall"/>
                    <rect x="963" y="281" width="32" height="4" fill="#cbd5e1"/>
                    ${pillSvg(979, 226, 'Crematorium Facility', '🔥', 'navy')}
                </g>

                <!-- Columbarium & Ossuary Sanctuary -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="columbarium">
                    <title>Columbarium / Ossuary Sanctuary — Pavilion Cluster</title>
                    <rect x="860" y="194" width="54" height="42" rx="4" class="mp-garden-hedge"/>
                    <rect x="863" y="197" width="48" height="36" rx="2" fill="#7c5cc4" opacity="0.12"/>
                    <circle cx="887" cy="215" r="14" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
                    <circle cx="887" cy="215" r="14" class="mp-bldg-wall"/>
                    <circle cx="887" cy="215" r="10" fill="#7c5cc4" stroke="#4c2f91" stroke-width="1.2"/>
                    <circle cx="887" cy="215" r="3.2" fill="#fbbf24" stroke="#b45309" stroke-width="0.8"/>
                    <circle cx="887" cy="215" r="18" fill="none" stroke="#cbd5e1" stroke-width="1.8" stroke-dasharray="3 3"/>
                    ${pillSvg(887, 180, 'Columbarium Sanctuary', '🏛', 'purple')}
                </g>

                <!-- Public Comfort Room Facility -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="restroom">
                    <title>Public Comfort Room (CR) — Mapped Structure 930065365</title>
                    <rect x="924" y="234" width="18" height="16" rx="1.5" class="mp-bldg-shadow" transform="translate(1 1)"/>
                    <rect x="924" y="234" width="18" height="16" rx="1.5" class="mp-bldg-wall"/>
                    <rect x="925" y="235" width="16" height="14" fill="#7fa7c9"/>
                    <line x1="925" y1="242" x2="941" y2="242" class="mp-roof-ridge mp-roof-ridge--thin"/>
                    ${pillSvg(933, 224, 'Comfort Room', '🚻', 'teal')}
                </g>

                <!-- West Ingress Gate Entrance Portal (P. Aquino Avenue) -->
                <g class="svg-gate-portal mp-gate" data-landmark="gate" transform="translate(730 870) rotate(9.8)">
                    <title>Main Ingress Gate (West Portal) — P. Aquino Avenue</title>
                    <rect x="-20" y="-10" width="40" height="20" rx="2" class="mp-gate-apron"/>
                    <rect x="-20" y="-10" width="40" height="20" rx="2" fill="url(#mpPaverPattern)" class="mp-texture"/>
                    <rect x="-18" y="-9" width="7" height="18" rx="1.5" class="mp-gate-pillar"/>
                    <rect x="-19" y="-11" width="9" height="3.5" rx="1" class="mp-gate-cap"/>
                    <rect x="11" y="-9" width="7" height="18" rx="1.5" class="mp-gate-pillar"/>
                    <rect x="10" y="-11" width="9" height="3.5" rx="1" class="mp-gate-cap"/>
                    <path d="M -11 -5 Q 0 -14 11 -5" class="mp-gate-arch"/>
                    <path d="M -11 5 L -2 0 M 11 5 L 2 0" class="mp-gate-leaf"/>
                    <line x1="-7" y1="3" x2="8" y2="3" class="mp-gate-boom"/>
                    <rect x="20" y="-7" width="14" height="14" rx="1.5" class="mp-bldg-wall"/>
                    <rect x="21" y="-6" width="12" height="12" fill="#8b6f5a"/>
                    <circle cx="0" cy="-26" r="8" class="mp-gate-badge"/>
                    <path d="M -4 -24 L 0 -29 L 4 -24 V -20 H -4 Z" fill="#ffffff"/>
                    ${pillSvg(0, -40, 'WEST INGRESS GATE', '', 'navy')}
                </g>

                <!-- East Egress Gate Portal (P. Aquino Avenue) -->
                <g class="svg-gate-portal mp-gate" data-landmark="gateEast" transform="translate(1005 870) rotate(9.8)">
                    <title>East Egress Gate Portal — P. Aquino Avenue</title>
                    <rect x="-18" y="-9" width="36" height="18" rx="2" class="mp-gate-apron"/>
                    <rect x="-16" y="-8" width="6" height="16" rx="1.5" class="mp-gate-pillar"/>
                    <rect x="10" y="-8" width="6" height="16" rx="1.5" class="mp-gate-pillar"/>
                    <line x1="-6" y1="3" x2="7" y2="3" class="mp-gate-boom"/>
                    <circle cx="0" cy="-24" r="7" class="mp-gate-badge"/>
                    <path d="M -3 -22 L 0 -26 L 3 -22 V -19 H -3 Z" fill="#ffffff"/>
                    ${pillSvg(0, -36, 'EAST EGRESS GATE', '', 'navy')}
                </g>

                <!-- Signature Google Maps Red Location Pin ("Everlasting Peace Memorial Park & Crematorium") -->
                <g class="mp-google-pin-group" data-landmark="crematorium" tabindex="0" role="button" aria-label="Everlasting Peace Memorial Park & Crematorium (Google Maps Pin)">
                    <title>Everlasting Peace Memorial Park &amp; Crematorium — Verified Client Location (Google Maps)</title>
                    <circle cx="979" cy="200" r="14" class="mp-google-pin-pulse"/>
                    <ellipse cx="981" cy="202" rx="7" ry="2.6" class="mp-google-pin-shadow"/>
                    <path d="M 979 200 C 973 192 966 182 966 172 A 13 13 0 1 1 992 172 C 992 182 985 192 979 200 Z" class="mp-google-pin"/>
                    <circle cx="979" cy="172" r="5" fill="#ffffff"/>
                    <circle cx="979" cy="172" r="2.2" fill="#ea4335"/>
                    <g class="mp-google-pin-callout" transform="translate(979 146)">
                        <rect x="-120" y="-14" width="240" height="22" rx="5" class="mp-google-pin-badge"/>
                        <text x="0" y="-3.5" class="mp-google-pin-title">Everlasting Peace Memorial Park &amp; Crematorium</text>
                        <text x="0" y="5.5" class="mp-google-pin-sub">4.9 ★★★★★ • Peaceful &amp; Safe • Malabon City</text>
                    </g>
                </g>

                <!-- Compass Rose (Matching cemetery-map.js Top-Left Placement) -->
                <g class="svg-north-indicator mp-compass" transform="translate(485 145)" aria-hidden="true">
                    <circle r="19" class="mp-compass-bg"/>
                    <polygon points="0,-13 4.5,2 0,0 -4.5,2" fill="#ef4444"/>
                    <polygon points="0,13 4.5,0 0,0 -4.5,0" fill="#cbd5e1"/>
                    <text x="0" y="-4" class="mp-compass-n">N</text>
                </g>
            </g>
        `;

        sitePlanGroup.innerHTML = groundHtml;
        container.appendChild(sitePlanGroup);
    }

    /**
     * Render Overview (Sections & Blocks) preview in SVG.
     */
    function renderOverviewPreview() {
        const sections = state.currentLayout.sections || [];
        const canvasW = state.baseViewBox.width;
        const canvasH = state.baseViewBox.height;

        // 1. Render actual continuous master cemetery site plan backdrop
        renderMasterPlanBackdrop(previewTransformLayer, canvasW, canvasH);

        // 2. Render Calibration Overlay (Sections & Blocks)
        const margin = 40;
        const gap = 30;
        const count = sections.length || 1;
        let cols = 1;
        if (count === 2) cols = 2;
        else if (count <= 4) cols = 2;
        else if (count <= 6) cols = 3;
        else cols = Math.ceil(Math.sqrt(count));
        const rows = Math.ceil(count / cols);

        const defSectionW = (canvasW - (margin * 2) - ((cols - 1) * gap)) / cols;
        const defSectionH = (canvasH - (margin * 2) - ((rows - 1) * gap)) / rows;

        sections.forEach((sec, index) => {
            const isEditingThisSec = state.selectedEntity?.type === 'section' && state.selectedEntity.id === sec.section_id;
            const secCfg = isEditingThisSec ? state.selectedEntity.config : (sec.map_config || null);

            const defBounds = calculateDefaultSectionBounds(sec);
            let secX = defBounds ? defBounds.x : (margin + ((index % cols) * (defSectionW + gap)));
            let secY = defBounds ? defBounds.y : (margin + (Math.floor(index / cols) * (defSectionH + gap)));
            let secW = defBounds ? defBounds.width : defSectionW;
            let secH = defBounds ? defBounds.height : defSectionH;

            if (secCfg && !isNaN(Number(secCfg.x)) && !isNaN(Number(secCfg.y))) {
                secX = Number(secCfg.x);
                secY = Number(secCfg.y);
                secW = Number(secCfg.width) || secW;
                secH = Number(secCfg.height) || secH;
            }

            const secGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            secGroup.setAttribute('class', 'svg-section-card');
            secGroup.setAttribute('data-section-id', sec.section_id);

            // Background Rect
            const bgRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            bgRect.setAttribute('x', secX);
            bgRect.setAttribute('y', secY);
            bgRect.setAttribute('width', secW);
            bgRect.setAttribute('height', secH);
            bgRect.setAttribute('class', 'svg-section-bg');
            bgRect.setAttribute('filter', 'url(#previewShadow)');
            secGroup.appendChild(bgRect);

            // Header Rect
            const headerH = 14;
            const headRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            headRect.setAttribute('x', secX);
            headRect.setAttribute('y', secY);
            headRect.setAttribute('width', secW);
            headRect.setAttribute('height', headerH);
            headRect.setAttribute('rx', '4');
            headRect.setAttribute('class', 'svg-section-header');
            secGroup.appendChild(headRect);

            // Section Title
            const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            titleText.setAttribute('x', secX + 6);
            titleText.setAttribute('y', secY + 10);
            titleText.setAttribute('class', 'svg-section-title');
            titleText.style.fontSize = '8px';
            titleText.textContent = sec.section_name;
            secGroup.appendChild(titleText);

            // Section Meta Pill / Count
            const blocks = sec.blocks || [];
            const secMeta = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            secMeta.setAttribute('x', secX + secW - 6);
            secMeta.setAttribute('y', secY + 10);
            secMeta.setAttribute('text-anchor', 'end');
            secMeta.setAttribute('class', 'svg-section-meta');
            secMeta.style.fontSize = '7px';
            secMeta.textContent = `${blocks.length} ${blocks.length === 1 ? 'Blk' : 'Blks'} • ${sec.total_lots || 0} Lots`;
            secGroup.appendChild(secMeta);

            // Section Click to Select
            secGroup.addEventListener('click', (e) => {
                e.stopPropagation();
                selectEntity({
                    type: 'section',
                    id: sec.section_id,
                    name: sec.section_name,
                    rawData: sec,
                    config: secCfg || { x: secX, y: secY, width: secW, height: secH }
                });
            });

            // Blocks in Section
            const bodyMargin = 4;
            const bodyX = secX + bodyMargin;
            const bodyY = secY + headerH + bodyMargin;
            const bodyW = secW - (bodyMargin * 2);
            const bodyH = secH - headerH - (bodyMargin * 2);

            const bCount = blocks.length;
            if (bCount > 0) {
                let bCols = 1;
                if (bCount >= 2 && bCount <= 4) bCols = 2;
                else if (bCount > 4) bCols = Math.ceil(Math.sqrt(bCount));
                const bRows = Math.ceil(bCount / bCols);
                const bGap = 4;

                const defBlkW = (bodyW - ((bCols - 1) * bGap)) / bCols;
                const defBlkH = (bodyH - ((bRows - 1) * bGap)) / bRows;

                blocks.forEach((blk, bIdx) => {
                    const isEditingThisBlk = state.selectedEntity?.type === 'block' && state.selectedEntity.id === blk.block_id;
                    const blkCfg = isEditingThisBlk ? state.selectedEntity.config : (blk.map_config || null);

                    const defBlkBounds = calculateDefaultBlockBounds(blk, sec);
                    let blkX = defBlkBounds ? (secX + defBlkBounds.x) : (bodyX + ((bIdx % bCols) * (defBlkW + bGap)));
                    let blkY = defBlkBounds ? (secY + defBlkBounds.y) : (bodyY + (Math.floor(bIdx / bCols) * (defBlkH + bGap)));
                    let blkW = defBlkBounds ? defBlkBounds.width : defBlkW;
                    let blkH = defBlkBounds ? defBlkBounds.height : defBlkH;

                    if (blkCfg && !isNaN(Number(blkCfg.x)) && !isNaN(Number(blkCfg.y))) {
                        const rawX = Number(blkCfg.x);
                        const rawY = Number(blkCfg.y);
                        blkX = rawX < secW ? (secX + rawX) : rawX;
                        blkY = rawY < secH ? (secY + rawY) : rawY;
                        blkW = Number(blkCfg.width) || defBlkW;
                        blkH = Number(blkCfg.height) || defBlkH;
                    }

                    const blkGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
                    blkGroup.setAttribute('class', 'svg-block-card');
                    blkGroup.setAttribute('data-block-id', blk.block_id);
                    blkGroup.style.cursor = 'pointer';

                    const blkRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                    blkRect.setAttribute('x', blkX);
                    blkRect.setAttribute('y', blkY);
                    blkRect.setAttribute('width', blkW);
                    blkRect.setAttribute('height', blkH);
                    blkRect.setAttribute('rx', '3');
                    blkRect.setAttribute('class', 'svg-block-bg');
                    blkGroup.appendChild(blkRect);

                    const blkTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    blkTitle.setAttribute('x', blkX + 4);
                    blkTitle.setAttribute('y', blkY + (blkH / 2) + 3);
                    blkTitle.setAttribute('class', 'svg-block-title');
                    blkTitle.style.fontSize = '7px';
                    blkTitle.textContent = blk.block_name;
                    blkGroup.appendChild(blkTitle);

                    // Block plot count badge
                    if (blkW > 45 && blkH > 18) {
                        const badgeW = 38;
                        const badgeH = 12;
                        const badgeX = blkX + blkW - badgeW - 4;
                        const badgeY = blkY + (blkH / 2) - 6;

                        const badgeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                        badgeRect.setAttribute('x', badgeX);
                        badgeRect.setAttribute('y', badgeY);
                        badgeRect.setAttribute('width', badgeW);
                        badgeRect.setAttribute('height', badgeH);
                        badgeRect.setAttribute('rx', '2');
                        badgeRect.setAttribute('class', 'svg-block-badge-bg');
                        blkGroup.appendChild(badgeRect);

                        const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                        badgeText.setAttribute('x', badgeX + (badgeW / 2));
                        badgeText.setAttribute('y', badgeY + 9);
                        badgeText.setAttribute('text-anchor', 'middle');
                        badgeText.setAttribute('class', 'svg-block-badge-text');
                        badgeText.style.fontSize = '6.5px';
                        badgeText.textContent = `${blk.total_lots || 0} Plots`;
                        blkGroup.appendChild(badgeText);
                    }

                    blkGroup.addEventListener('click', (e) => {
                        e.stopPropagation();
                        state.selectedBlockForLots = blk;
                        selectEntity({
                            type: 'block',
                            id: blk.block_id,
                            name: blk.block_name,
                            rawData: blk,
                            parent: sec,
                            config: blkCfg || { x: blkX - secX, y: blkY - secY, width: blkW, height: blkH, grid: defBlkBounds?.grid || { columns: 7, rows: 5, gap_x: 1.0, gap_y: 1.5 } }
                        });
                    });

                    secGroup.appendChild(blkGroup);
                });
            }

            previewTransformLayer.appendChild(secGroup);
        });
    }

    /**
     * Render Block Lots Grid preview in SVG.
     */
    async function renderBlockLotsPreview() {
        const blk = state.selectedBlockForLots;
        if (!blk) {
            showPreviewEmpty('No Block Selected', 'Select a block to inspect its plot grid configuration.');
            return;
        }

        const canvasW = state.baseViewBox.width;
        const canvasH = state.baseViewBox.height;
        const margin = 50;
        const topHeaderH = 90;

        // Block Title Header
        const headGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        const headBg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
        headBg.setAttribute('x', margin);
        headBg.setAttribute('y', margin);
        headBg.setAttribute('width', canvasW - (margin * 2));
        headBg.setAttribute('height', topHeaderH - 20);
        headBg.setAttribute('rx', '12');
        headBg.setAttribute('class', 'svg-section-header');
        headGroup.appendChild(headBg);

        const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
        titleText.setAttribute('x', margin + 24);
        titleText.setAttribute('y', margin + 38);
        titleText.setAttribute('class', 'svg-section-title');
        titleText.textContent = `Block Lot Grid: ${blk.block_name}`;
        headGroup.appendChild(titleText);

        previewTransformLayer.appendChild(headGroup);

        // Fetch or simulate lots for block
        let lots = state.blockLotsCache[blk.block_id];
        if (!lots) {
            try {
                const res = await api.request(`map/blocks/${blk.block_id}/lots`, { method: 'GET' });
                if (res && res.success && res.data) {
                    lots = res.data.lots || [];
                    state.blockLotsCache[blk.block_id] = lots;
                }
            } catch (e) {
                console.warn('Failed to fetch real lots for block preview:', e);
            }
        }

        if (!lots || lots.length === 0) {
            // Generate synthetic plots for preview calibration
            const count = blk.total_lots || 15;
            lots = [];
            for (let i = 1; i <= count; i++) {
                lots.push({
                    lot_id: i,
                    lot_number: `${blk.block_name}-L${i}`,
                    status: i % 4 === 0 ? 'Occupied' : (i % 5 === 0 ? 'Reserved' : 'Available'),
                    price: 45000
                });
            }
        }

        // Grid calculation
        const gridX = margin;
        const gridY = margin + topHeaderH;
        const gridW = canvasW - (margin * 2);
        const gridH = canvasH - gridY - margin;

        const isEditingBlock = state.selectedEntity?.type === 'block' && state.selectedEntity.id === blk.block_id;
        const gridConfig = isEditingBlock ? (state.selectedEntity.config?.grid || {}) : (blk.map_config?.grid || {});

        const defBounds = calculateDefaultBlockBounds(blk, state.currentLayout?.sections?.find(s => s.section_id === blk.section_id));
        const defGrid = defBounds?.grid || {};

        const cols = parseInt(gridConfig.columns, 10) || defGrid.columns || 5;
        const gapX = parseFloat(gridConfig.gap_x) || defGrid.gap_x || 14;
        const gapY = parseFloat(gridConfig.gap_y) || defGrid.gap_y || 14;
        const rows = Math.ceil(lots.length / cols);

        const tileW = (gridW - ((cols - 1) * gapX)) / cols;
        const tileH = (gridH - ((rows - 1) * gapY)) / rows;

        lots.forEach((lot, i) => {
            const col = i % cols;
            const row = Math.floor(i / cols);
            let lotX = gridX + (col * (tileW + gapX));
            let lotY = gridY + (row * (tileH + gapY));
            let curTileW = tileW;
            let curTileH = tileH;

            const isEditingThisLot = state.selectedEntity?.type === 'lot' && state.selectedEntity.id === lot.lot_id;
            const lotCfg = isEditingThisLot ? state.selectedEntity.config : (lot.map_config || null);

            if (lotCfg && !isNaN(Number(lotCfg.x)) && !isNaN(Number(lotCfg.y))) {
                const rawLx = Number(lotCfg.x);
                const rawLy = Number(lotCfg.y);
                lotX = rawLx < gridW ? (gridX + rawLx) : rawLx;
                lotY = rawLy < gridH ? (gridY + rawLy) : rawLy;
                curTileW = Number(lotCfg.width) || tileW;
                curTileH = Number(lotCfg.height) || tileH;
            }

            const statusClass = (lot.status || 'Available').toLowerCase();
            const lotGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
            lotGroup.setAttribute('class', `svg-lot-tile lot--${statusClass}`);
            lotGroup.setAttribute('data-lot-id', lot.lot_id);
            lotGroup.style.cursor = 'pointer';

            const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            rect.setAttribute('x', lotX);
            rect.setAttribute('y', lotY);
            rect.setAttribute('width', curTileW);
            rect.setAttribute('height', curTileH);
            rect.setAttribute('class', 'svg-lot-rect');
            lotGroup.appendChild(rect);

            const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            label.setAttribute('x', lotX + (curTileW / 2));
            label.setAttribute('y', lotY + (curTileH / 2) - 2);
            label.setAttribute('text-anchor', 'middle');
            label.setAttribute('class', 'svg-lot-label');
            label.textContent = lot.lot_number;
            lotGroup.appendChild(label);

            const stText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            stText.setAttribute('x', lotX + (curTileW / 2));
            stText.setAttribute('y', lotY + (curTileH / 2) + 16);
            stText.setAttribute('text-anchor', 'middle');
            stText.setAttribute('class', 'svg-lot-status-text');
            stText.textContent = lot.status;
            lotGroup.appendChild(stText);

            lotGroup.addEventListener('click', (e) => {
                e.stopPropagation();
                selectEntity({
                    type: 'lot',
                    id: lot.lot_id,
                    name: lot.lot_number,
                    rawData: lot,
                    config: lotCfg || { x: lotX - gridX, y: lotY - gridY, width: curTileW, height: curTileH }
                });
            });

            previewTransformLayer.appendChild(lotGroup);
        });
    }

    /**
     * Update highlight ring on the currently selected entity in the SVG preview.
     */
    function updateSelectedHighlightInPreview() {
        if (!selectedEntityHighlightRect) return;

        if (!state.selectedEntity || state.selectedEntity.type === 'cemetery') {
            selectedEntityHighlightRect.style.display = 'none';
            return;
        }

        const entity = state.selectedEntity;

        // In block_lots mode, we ONLY highlight if a specific individual LOT is selected
        if (state.viewMode === 'block_lots') {
            if (entity.type !== 'lot') {
                selectedEntityHighlightRect.style.display = 'none';
                return;
            }
            const lotEl = previewTransformLayer.querySelector(`[data-lot-id="${entity.id}"] rect.svg-lot-rect`);
            if (lotEl) {
                const lx = parseFloat(lotEl.getAttribute('x'));
                const ly = parseFloat(lotEl.getAttribute('y'));
                const lw = parseFloat(lotEl.getAttribute('width'));
                const lh = parseFloat(lotEl.getAttribute('height'));
                selectedEntityHighlightRect.setAttribute('x', lx - 3);
                selectedEntityHighlightRect.setAttribute('y', ly - 3);
                selectedEntityHighlightRect.setAttribute('width', lw + 6);
                selectedEntityHighlightRect.setAttribute('height', lh + 6);
                selectedEntityHighlightRect.setAttribute('rx', '8');
                selectedEntityHighlightRect.style.display = 'block';
                return;
            }
            selectedEntityHighlightRect.style.display = 'none';
            return;
        }

        // In overview mode:
        if (state.viewMode === 'overview') {
            let targetRectEl = null;
            if (entity.type === 'block') {
                targetRectEl = previewTransformLayer.querySelector(`[data-block-id="${entity.id}"] rect.svg-block-bg`);
            } else if (entity.type === 'section') {
                targetRectEl = previewTransformLayer.querySelector(`[data-section-id="${entity.id}"] rect.svg-section-bg`);
            }

            if (targetRectEl) {
                const rx = parseFloat(targetRectEl.getAttribute('x'));
                const ry = parseFloat(targetRectEl.getAttribute('y'));
                const rw = parseFloat(targetRectEl.getAttribute('width'));
                const rh = parseFloat(targetRectEl.getAttribute('height'));
                selectedEntityHighlightRect.setAttribute('x', rx - 4);
                selectedEntityHighlightRect.setAttribute('y', ry - 4);
                selectedEntityHighlightRect.setAttribute('width', rw + 8);
                selectedEntityHighlightRect.setAttribute('height', rh + 8);
                selectedEntityHighlightRect.setAttribute('rx', '10');
                selectedEntityHighlightRect.style.display = 'block';
                return;
            }

            // Fallback calculation if not in DOM
            const config = entity.config;
            if (!config || isNaN(Number(config.width)) || isNaN(Number(config.height))) {
                selectedEntityHighlightRect.style.display = 'none';
                return;
            }

            let targetX = Number(config.x) || 0;
            let targetY = Number(config.y) || 0;
            let targetW = Number(config.width) || 100;
            let targetH = Number(config.height) || 100;

            if (entity.type === 'block' && entity.parent) {
                const secCfg = entity.parent.map_config || calculateDefaultSectionBounds(entity.parent);
                const secX = Number(secCfg.x) || 0;
                const secY = Number(secCfg.y) || 0;
                targetX = targetX < Number(secCfg.width) ? (secX + targetX) : targetX;
                targetY = targetY < Number(secCfg.height) ? (secY + targetY) : targetY;
            }

            selectedEntityHighlightRect.setAttribute('x', targetX - 4);
            selectedEntityHighlightRect.setAttribute('y', targetY - 4);
            selectedEntityHighlightRect.setAttribute('width', targetW + 8);
            selectedEntityHighlightRect.setAttribute('height', targetH + 8);
            selectedEntityHighlightRect.setAttribute('rx', '8');
            selectedEntityHighlightRect.style.display = 'block';
            return;
        }

        selectedEntityHighlightRect.style.display = 'none';
    }

    // =========================================================================
    // SVG PREVIEW ZOOM & PAN TRANSFORMS
    // =========================================================================

    function applyViewBox() {
        const vb = state.currentViewBox;
        previewMapSvg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.width} ${vb.height}`);
    }

    function zoomPreview(factor) {
        const vb = state.currentViewBox;
        const newW = vb.width * factor;
        const newH = vb.height * factor;

        if (newW < 200 || newW > 2500) return;

        const centerX = vb.x + (vb.width / 2);
        const centerY = vb.y + (vb.height / 2);

        vb.x = centerX - (newW / 2);
        vb.y = centerY - (newH / 2);
        vb.width = newW;
        vb.height = newH;

        applyViewBox();
    }

    function resetPreviewZoom() {
        state.currentViewBox = { ...state.baseViewBox };
        applyViewBox();
    }

    function handleMouseDown(e) {
        if (e.target.closest('.svg-block-card') || e.target.closest('.svg-lot-tile')) return;
        state.isPanning = true;
        state.panStart = { x: e.clientX, y: e.clientY };
    }

    function handleMouseMove(e) {
        if (!state.isPanning) return;
        const dx = (e.clientX - state.panStart.x) * (state.currentViewBox.width / previewStageContainer.clientWidth);
        const dy = (e.clientY - state.panStart.y) * (state.currentViewBox.height / previewStageContainer.clientHeight);

        state.currentViewBox.x -= dx;
        state.currentViewBox.y -= dy;
        applyViewBox();

        state.panStart = { x: e.clientX, y: e.clientY };
    }

    function handleMouseUp() {
        state.isPanning = false;
    }

    function setPreviewLoading(show, message = 'Loading...') {
        if (previewLoadingOverlay) {
            previewLoadingText.textContent = message;
            previewLoadingOverlay.style.display = show ? 'flex' : 'none';
        }
    }

    function showPreviewEmpty(title, desc) {
        setPreviewLoading(false);
        if (previewEmptyOverlay) {
            previewEmptyTitle.textContent = title;
            previewEmptyDesc.textContent = desc;
            previewEmptyOverlay.style.display = 'flex';
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

})();
