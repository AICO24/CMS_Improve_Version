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

        // SVG Viewport Matrix
        baseViewBox: { x: 0, y: 0, width: 1600, height: 1000 },
        currentViewBox: { x: 0, y: 0, width: 1600, height: 1000 },
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

                // Sync Canvas dimensions
                const cemCfg = res.data.cemetery?.map_config;
                if (cemCfg && cemCfg.width && cemCfg.height) {
                    state.baseViewBox = { x: 0, y: 0, width: parseFloat(cemCfg.width), height: parseFloat(cemCfg.height) };
                } else {
                    state.baseViewBox = { x: 0, y: 0, width: 1600, height: 1000 };
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
                    config: state.currentCemetery.map_config || { width: 1600, height: 1000 }
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

        // Match known cemetery master plan parcels if applicable
        if (name.includes('peace') || name.includes('section a') || (sec.blocks && sec.blocks.some(b => (b.block_name || '').toLowerCase().includes('a1')))) {
            return { x: 526, y: 312, width: 548, height: 222 };
        }
        if (name.includes('lourdes') || name.includes('section b') || (sec.blocks && sec.blocks.some(b => (b.block_name || '').toLowerCase().includes('b1')))) {
            return { x: 106, y: 312, width: 398, height: 222 };
        }
        if (name.includes('jose') || name.includes('section c') || (sec.blocks && sec.blocks.some(b => (b.block_name || '').toLowerCase().includes('c1')))) {
            return { x: 106, y: 94, width: 672, height: 194 };
        }
        if (name.includes('columbarium') || name.includes('ossuary') || name.includes('section d') || (sec.blocks && sec.blocks.some(b => (b.block_name || '').toLowerCase().includes('d1')))) {
            return { x: 822, y: 94, width: 672, height: 194 };
        }
        if (name.includes('reserve') || name.includes('section e') || (sec.blocks && sec.blocks.some(b => (b.block_name || '').toLowerCase().includes('e1')))) {
            return { x: 1096, y: 312, width: 398, height: 222 };
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
        const secBounds = sec.map_config || calculateDefaultSectionBounds(sec);
        const name = (sec.section_name || '').toLowerCase();
        const bName = (blk.block_name || '').toLowerCase();

        // If Section A (Everlasting Peace flanks the central spine at x=800):
        if (name.includes('peace') || name.includes('section a')) {
            if (bName.includes('a1') || bIdx === 0) {
                return {
                    x: 18,
                    y: 52,
                    width: 236,
                    height: 154,
                    grid: { columns: 5, rows: Math.ceil((blk.total_lots || 10) / 5), gap_x: 14, gap_y: 14 }
                };
            } else if (bName.includes('a2') || bIdx === 1) {
                return {
                    x: 294,
                    y: 52,
                    width: 236,
                    height: 154,
                    grid: { columns: 5, rows: Math.ceil((blk.total_lots || 10) / 5), gap_x: 14, gap_y: 14 }
                };
            }
        }

        // Standard block distribution inside section
        const blockCount = blocks.length || 1;
        let bCols = 1;
        if (blockCount >= 2 && blockCount <= 4) bCols = 2;
        else if (blockCount > 4) bCols = Math.ceil(Math.sqrt(blockCount));
        const bRows = Math.ceil(blockCount / bCols);

        const bodyMargin = 16;
        const headerH = 46;
        const bodyW = secBounds.width - (bodyMargin * 2);
        const bodyH = secBounds.height - headerH - (bodyMargin * 2);
        const bGap = 12;

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
                gap_x: 14,
                gap_y: 14
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

            inputWidth.value = entity.config?.width || 1600;
            inputHeight.value = entity.config?.height || 1000;
        } else if (entity.type === 'section') {
            editorHeaderIcon.className = 'fas fa-layer-group';
            editorEntityTypeBadge.style.background = '#e0e7ff';
            editorEntityTypeBadge.style.color = '#3730a3';
            groupX.style.display = 'block';
            groupY.style.display = 'block';
            hintX.textContent = '(Canvas X)';
            hintY.textContent = '(Canvas Y)';
            blockGridSection.style.display = 'none';

            inputX.value = entity.config?.x ?? 40;
            inputY.value = entity.config?.y ?? 40;
            inputWidth.value = entity.config?.width ?? 600;
            inputHeight.value = entity.config?.height ?? 300;
        } else if (entity.type === 'block') {
            editorHeaderIcon.className = 'fas fa-th-large';
            editorEntityTypeBadge.style.background = '#fef3c7';
            editorEntityTypeBadge.style.color = '#b45309';
            groupX.style.display = 'block';
            groupY.style.display = 'block';
            hintX.textContent = '(Section Offset X)';
            hintY.textContent = '(Section Offset Y)';
            blockGridSection.style.display = 'block';

            inputX.value = entity.config?.x ?? 20;
            inputY.value = entity.config?.y ?? 60;
            inputWidth.value = entity.config?.width ?? 250;
            inputHeight.value = entity.config?.height ?? 150;

            const grid = entity.config?.grid || {};
            inputGridColumns.value = grid.columns ?? 5;
            inputGridRows.value = grid.rows ?? Math.ceil((entity.rawData?.total_lots || 10) / (grid.columns || 5));
            inputGridGapX.value = grid.gap_x ?? 14;
            inputGridGapY.value = grid.gap_y ?? 14;
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
            inputWidth.value = entity.config?.width ?? 80;
            inputHeight.value = entity.config?.height ?? 60;
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
            entity.config.width = parseFloat(inputWidth.value) || 1600;
            entity.config.height = parseFloat(inputHeight.value) || 1000;
        } else {
            entity.config.x = parseFloat(inputX.value) || 0;
            entity.config.y = parseFloat(inputY.value) || 0;
            entity.config.width = parseFloat(inputWidth.value) || 100;
            entity.config.height = parseFloat(inputHeight.value) || 100;

            if (entity.type === 'block') {
                if (!entity.config.grid) entity.config.grid = {};
                entity.config.grid.columns = parseInt(inputGridColumns.value, 10) || 5;
                entity.config.grid.gap_x = parseFloat(inputGridGapX.value) || 14;
                entity.config.grid.gap_y = parseFloat(inputGridGapY.value) || 14;
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

            // Section canvas boundary validation
            if (entity.type === 'section') {
                const canvasW = state.baseViewBox.width;
                const canvasH = state.baseViewBox.height;
                if (x >= canvasW || y >= canvasH) {
                    isValid = false;
                    errorMessage = 'Section is positioned completely outside the cemetery canvas.';
                } else if ((x + w) > canvasW || (y + h) > canvasH) {
                    warnings.push(`Section extends beyond canvas boundaries (${canvasW} × ${canvasH}).`);
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
        if (!document.getElementById('cemeteryParcelClip')) {
            const cp = document.createElementNS('http://www.w3.org/2000/svg', 'clipPath');
            cp.setAttribute('id', 'cemeteryParcelClip');
            cp.innerHTML = '<polygon points="1168.9,900.0 956.7,863.5 952.1,610.6 1001.0,608.1 963.7,432.3 637.0,531.8 617.6,493.5 576.8,444.4 689.6,282.2 766.2,264.0 808.5,194.0 864.5,162.8 975.8,147.7 1022.1,146.6 1022.7,403.1 1033.7,400.5 1052.4,491.2 1058.9,697.8 1102.3,690.7"/>';
            defs.appendChild(cp);
        }
    }

    /**
     * Render the Continuous Geographic Cemetery Master Plan Base
     * (Roads, Landscaping, Frontage, Landmarks, and Boundaries).
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
            gate: { id: 'gate', landmark: 'gate', x: 1096, y: 881, label: 'Main Gate (Gate 1)' },
            parking: { id: 'parking', landmark: 'parking', x: 1035, y: 755, label: 'Visitor Parking Zone' },
            admin: { id: 'admin', landmark: 'admin', x: 782, y: 380, label: 'Administration Office' },
            chapel: { id: 'chapel', landmark: 'chapel', x: 858, y: 362, label: 'Memorial Chapel' },
            crematorium: { id: 'crematorium', landmark: 'crematorium', x: 978, y: 271, label: 'Crematorium Facility' },
            columbarium: { id: 'columbarium', landmark: 'columbarium', x: 886, y: 274, label: 'Columbarium & Ossuary' },
            restroom: { id: 'restroom', landmark: 'restroom', x: 932, y: 247, label: 'Comfort Room (CR)' }
        };

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

        const sitePlanGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g');
        sitePlanGroup.setAttribute('class', 'mp-master-site-plan-backdrop');
        sitePlanGroup.style.pointerEvents = 'none';

        // 1. Surround Canvas & Ground Lawn (Verified 19-Vertex Polygon)
        let groundHtml = `
            <rect x="0" y="0" width="${canvasW}" height="${canvasH}" class="mp-surround"/>
            <rect x="0" y="0" width="${canvasW}" height="${canvasH}" fill="url(#mpGrassSpeckle)" class="mp-texture"/>

            <!-- Southwest Residential Cutout (Outside Cemetery Property) -->
            <g class="mp-surrounding-context" aria-hidden="true">
                <rect x="50" y="620" width="880" height="280" rx="8" class="mp-residential-cutout"/>
                <text x="490" y="740" class="mp-context-label">BARANGAY TONSUYA RESIDENTIAL AREA</text>
                <text x="490" y="756" class="mp-context-sublabel">Residential Properties along Prudencio St. (Outside Boundary)</text>

                <!-- Eastern Adjacent Memorial Park (OSM Relation 16828677) -->
                <rect x="1185" y="140" width="375" height="760" rx="8" class="mp-residential-cutout"/>
                <text x="1370" y="520" class="mp-context-label">Adjacent: Our Lady of Lourdes Eternal Park</text>
                <text x="1370" y="536" class="mp-context-sublabel">OSM Relation 16828677 (Dagat-dagatan Memorial Park)</text>
            </g>

            <!-- Verified 19-Vertex Cemetery Property Boundary (OSM Relation 16828676) -->
            <polygon points="${CEMETERY_POLYGON_POINTS}" class="svg-cemetery-ground mp-property"/>
            <polygon points="${CEMETERY_POLYGON_POINTS}" fill="url(#mpGrassSpeckle)" class="mp-texture"/>
        `;

        // P. Aquino Avenue (Letre Road) Frontage along southern edge (Bearing ~99.5° WNW to ESE)
        // Aligned to verified frontage edge P01(956.7, 863.5) -> P00(1168.9, 900.0) [Bearing 99.8°]
        let crosswalkBars = '';
        for (let cx = 1076; cx <= 1120; cx += 8) {
            const cy = 948 + (cx - 1096) * 0.172;
            crosswalkBars += `<rect x="${cx}" y="${f1(cy)}" width="5" height="34" transform="rotate(9.8 ${cx} ${f1(cy)})" class="mp-crosswalk"/>`;
        }
        groundHtml += `
            <g class="svg-external-road-group mp-frontage">
                <!-- P. Aquino Avenue Sidewalks & Roadbed aligned to 99.5 deg bearing -->
                <polygon points="-50,892 1650,1184 1650,1196 -50,904" class="mp-sidewalk"/>
                <polygon points="-50,902 1650,1194 1650,1260 -50,968" class="mp-ext-road"/>
                <line x1="-50" y1="903.5" x2="1650" y2="1195.5" class="mp-ext-edge"/>
                <line x1="-50" y1="966.5" x2="1650" y2="1258.5" class="mp-ext-edge"/>
                <line x1="-50" y1="935.0" x2="1650" y2="1227.0" class="mp-ext-centerline"/>
                ${crosswalkBars}
                <polygon points="-50,968 1650,1260 1650,1272 -50,980" class="mp-sidewalk"/>
                <text x="520" y="942" transform="rotate(9.8 520 942)" class="mp-ext-lane-label">◂  WESTBOUND (TONSUYA / LETRE)</text>
                <text x="1380" y="1088" transform="rotate(9.8 1380 1088)" class="mp-ext-lane-label">EASTBOUND (MALABON / C-4)  ▸</text>
                ${pillSvg(1096, 978, '⟵   P. AQUINO AVENUE (LETRE ROAD)   ⟶', '', 'road')}
            </g>
            <text x="890" y="132" class="mp-north-label">NORTH BOUNDARY (MALABON/TONSUYA)</text>
        `;

        // Perimeter Wall with Main Gate Opening & Posts (19-Vertex Geometry)
        const outerWallD = "M 1078.0 877.8 L 956.7 863.5 L 952.1 610.6 L 1001.0 608.1 L 963.7 432.3 L 637.0 531.8 L 617.6 493.5 L 576.8 444.4 L 689.6 282.2 L 766.2 264.0 L 808.5 194.0 L 864.5 162.8 L 975.8 147.7 L 1022.1 146.6 L 1022.7 403.1 L 1033.7 400.5 L 1052.4 491.2 L 1058.9 697.8 L 1102.3 690.7 L 1168.9 900.0 L 1113.4 884.0";
        const innerWallD = "M 1078.0 874.3 L 960.1 860.5 L 955.7 613.9 L 1005.3 611.4 L 966.3 427.8 L 638.8 527.6 L 620.5 491.6 L 581.2 444.2 L 691.8 285.3 L 768.4 267.1 L 811.1 196.6 L 865.6 166.1 L 976.0 151.2 L 1018.6 150.2 L 1019.2 407.5 L 1031.0 404.8 L 1048.9 491.6 L 1055.5 701.9 L 1099.8 694.7 L 1163.8 895.6 L 1113.4 880.5";
        groundHtml += `
            <path d="${outerWallD}" class="mp-wall"/>
            <path d="${innerWallD}" class="mp-wall-inner"/>
            <g class="mp-wall-posts" aria-hidden="true">
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
            </g>
            <g class="svg-landscaping-group mp-trees" aria-hidden="true">${
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
                treeLine(1102.3, 690.7, 1168.9, 900.0, 22, 6.5, 9, 1.2)
            }</g>
        `;

        // 2. Connected Roads & Pathways
        const roads = [
            // 1. Entrance Service Road (OSM Way 1203404189 & 1392737965: P. Aquino Ave -> Main Gate -> Neck Corridor -> Avenue of Peace)
            { d: 'M 1101 928 L 1096 881 L 1090 820 L 1085 680 L 1085 545', w: 22, main: true },
            // 2. Central Boulevard Spine: from South Campus -> North Boundary
            { d: `M ${RD.spine} ${RD.southService} V ${RD.north}`, w: 30, main: true },
            { d: `M ${RD.west} ${RD.mainCross} H ${RD.east}`, w: 26, main: true },
            { d: `M ${RD.west} ${RD.promenade} H ${RD.east}`, w: 20 },
            { d: `M ${RD.west} ${RD.north} H ${RD.east}`, w: 18 },
            { d: `M ${RD.west} ${RD.north} V ${RD.mainCross} V ${RD.southService}`, w: 18 },
            { d: `M ${RD.east} ${RD.north} V ${RD.mainCross} V ${RD.southService}`, w: 18 },
            { d: `M ${RD.accW} ${RD.promenade} V ${RD.mainCross}`, w: 15 },
            { d: `M ${RD.accE} ${RD.promenade} V ${RD.mainCross}`, w: 15 },
            { d: `M ${RD.west} ${RD.southService} H ${RD.east}`, w: 15 },
            { d: 'M 1035 755 H 1085', w: 16 }
        ];

        // Pedestrian Walkways connecting landmarks, roads, and block parcels
        const primaryPaths = [
            `M 782 300 V 360`,
            `M 858 300 V 345`,
            `M 886 215 V 320`,
            `M 920 270 H 955`,
            `M 978 288 V 300`,
            `M 1035 755 H 1085`
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

        groundHtml += `
            <g class="svg-road-network mp-roads">
                ${pathUnder}
                ${pathFill}
                ${roadCurbs}
                ${roadAsphalt}
                ${roadStripes}
                <text x="320" y="548" class="mp-road-label">MAIN ROAD (AVENUE OF PEACE)</text>
                <text x="1280" y="548" class="mp-road-label">MAIN ROAD (AVENUE OF PEACE)</text>
                <text x="803" y="190" class="mp-road-label" transform="rotate(-90 803 190)">MAIN ROAD</text>
                <text x="803" y="710" class="mp-road-label" transform="rotate(-90 803 710)">MAIN ROAD</text>
                <text x="440" y="302.5" class="mp-road-label mp-road-label--minor">INTERNAL PROMENADE</text>
                <text x="1160" y="302.5" class="mp-road-label mp-road-label--minor">INTERNAL PROMENADE</text>
                <text x="1075" y="760" class="mp-road-label mp-road-label--minor" transform="rotate(-90 1075 760)">ENTRANCE ROAD</text>
            </g>
            <g class="mp-trees" aria-hidden="true">${
                treeLine(766, 95, 766, 285, 24, 7, 8.5, 0.4) +
                treeLine(834, 95, 834, 285, 24, 7, 8.5, 0.4) +
                treeLine(766, 315, 766, 530, 24, 7, 8.5, 0.4) +
                treeLine(834, 315, 834, 530, 24, 7, 8.5, 0.4) +
                treeLine(1096, 680, 1096, 850, 24, 6.5, 8.5, 0.4)
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
                <!-- Visitor Parking Area (Operational Landmark along Entrance Neck) -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="parking">
                    <title>Visitor Parking Area — Entrance Corridor (Operational Landmark)</title>
                    <rect x="990" y="720" width="80" height="70" rx="4" class="mp-parking-curb"/>
                    <rect x="993" y="723" width="74" height="64" rx="3" class="mp-parking"/>
                    <line x1="993" y1="738" x2="1040" y2="738" class="mp-parking-stripe"/>
                    <line x1="993" y1="753" x2="1040" y2="753" class="mp-parking-stripe"/>
                    <line x1="993" y1="768" x2="1040" y2="768" class="mp-parking-stripe"/>
                    <rect x="998" y="726" width="24" height="10" rx="2" fill="#1e3a5f" class="mp-car"/>
                    <rect x="998" y="741" width="24" height="10" rx="2" fill="#e5e7eb" class="mp-car"/>
                    <rect x="998" y="756" width="24" height="10" rx="2" fill="#9f1239" class="mp-car"/>
                    <rect x="995" y="770" width="28" height="15" rx="1.5" class="mp-parking-pwd"/>
                    <text x="1009" y="782" class="mp-parking-pwd-icon">♿</text>
                    <path d="M 1052 730 V 770 M 1047 764 L 1052 770 L 1057 764" class="mp-parking-arrow"/>
                    ${pillSvg(1030, 755, 'Visitor Parking', 'P', 'navy')}
                </g>

                <!-- Administration Office (Calibrated Facility Anchor: Way 927998601/927998602) -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="admin">
                    <title>Administration Office — Mapped Structures 927998601/927998602</title>
                    <rect x="768" y="360" width="30" height="38" rx="2" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
                    <rect x="768" y="360" width="30" height="38" rx="2" class="mp-bldg-wall"/>
                    <rect x="770" y="362" width="26" height="34" rx="1" fill="#8aa1bd"/>
                    <line x1="770" y1="379" x2="796" y2="379" class="mp-roof-ridge mp-roof-ridge--thin"/>
                    <rect x="777" y="394" width="12" height="6" rx="1" class="mp-bldg-wall"/>
                    <rect x="778" y="395" width="10" height="4" fill="#cbd5e1"/>
                    ${pillSvg(782, 380, 'Admin Office', '🏢', 'navy')}
                </g>

                <!-- Memorial Chapel (Calibrated Facility Anchor: Way 930065369) -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="chapel">
                    <title>Memorial Chapel — Mapped Structure 930065369</title>
                    <rect x="840" y="346" width="34" height="32" rx="2" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
                    <rect x="840" y="346" width="34" height="32" rx="2" class="mp-bldg-wall"/>
                    <rect x="842" y="348" width="15" height="28" fill="#6a8fbb"/>
                    <rect x="857" y="348" width="15" height="28" fill="#4b6f99"/>
                    <line x1="857" y1="348" x2="857" y2="376" class="mp-roof-ridge"/>
                    <line x1="857" y1="341" x2="857" y2="352" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
                    <line x1="853" y1="345" x2="861" y2="345" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
                    <rect x="850" y="374" width="14" height="5" rx="1" class="mp-bldg-wall"/>
                    ${pillSvg(858, 362, 'Memorial Chapel', '✝', 'navy')}
                </g>

                <!-- Crematorium Facility (Calibrated Facility Anchor: Way 930065371) -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="crematorium">
                    <title>Crematorium Facility — Mapped Structure 930065371</title>
                    <rect x="954" y="252" width="46" height="36" rx="2" class="mp-bldg-shadow" transform="translate(2 2)"/>
                    <rect x="954" y="252" width="46" height="36" rx="2" class="mp-bldg-wall"/>
                    <polygon points="955,253 999,253 986,270 967,270" fill="#c3c9d0"/>
                    <polygon points="955,287 999,287 986,270 967,270" fill="#8e97a1"/>
                    <polygon points="955,253 967,270 955,287" fill="#a9b1ba"/>
                    <polygon points="999,253 986,270 999,287" fill="#9aa2ab"/>
                    <line x1="967" y1="270" x2="986" y2="270" class="mp-roof-ridge"/>
                    <rect x="990" y="255" width="5" height="5" rx="1" fill="#475569" stroke="#1e293b" stroke-width="0.6"/>
                    <rect x="965" y="284" width="24" height="6" rx="1" class="mp-bldg-wall"/>
                    <rect x="966" y="285" width="22" height="4" fill="#b8bec6"/>
                    ${pillSvg(978, 271, 'Crematorium', '🔥', 'navy')}
                </g>

                <!-- Columbarium & Ossuary Sanctuary (Calibrated Facility Anchor: Pavilion Cluster) -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="columbarium">
                    <title>Columbarium / Ossuary Sanctuary — Pavilion Cluster</title>
                    <rect x="864" y="260" width="44" height="32" rx="4" class="mp-garden-hedge"/>
                    <rect x="867" y="263" width="38" height="26" rx="2" fill="#7c5cc4" opacity="0.15"/>
                    <circle cx="886" cy="274" r="14" class="mp-bldg-shadow" transform="translate(1.5 2)"/>
                    <circle cx="886" cy="274" r="14" class="mp-bldg-wall"/>
                    <circle cx="886" cy="274" r="10" fill="#7c5cc4" stroke="#4c2f91" stroke-width="1.2"/>
                    <circle cx="886" cy="274" r="3" fill="#fbbf24" stroke="#b45309" stroke-width="0.8"/>
                    ${pillSvg(886, 274, 'Columbarium / Ossuary', '🏛', 'purple')}
                </g>

                <!-- Public Comfort Room Facility (Calibrated Facility Anchor: Way 930065365) -->
                <g class="svg-landmark-bldg mp-landmark" data-landmark="restroom">
                    <title>Public Comfort Room (CR) — Mapped Structure 930065365</title>
                    <rect x="924" y="240" width="16" height="14" rx="1.5" class="mp-bldg-shadow" transform="translate(1 1)"/>
                    <rect x="924" y="240" width="16" height="14" rx="1.5" class="mp-bldg-wall"/>
                    <rect x="925" y="241" width="14" height="12" fill="#7fa7c9"/>
                    <line x1="925" y1="247" x2="939" y2="247" class="mp-roof-ridge mp-roof-ridge--thin"/>
                    ${pillSvg(932, 247, 'Comfort Room', '🚻', 'teal')}
                </g>

                <!-- Main Gate Entrance Portal (Verified OSM Node 8348620486 & 9928981748, P. Aquino Avenue) -->
                <g class="svg-gate-portal mp-gate" data-landmark="gate" transform="translate(1096 881) rotate(9.8)">
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

                <!-- Compass Rose -->
                <g class="svg-north-indicator mp-compass" transform="translate(68 68)" aria-hidden="true">
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
            const headerH = 46;
            const headRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
            headRect.setAttribute('x', secX);
            headRect.setAttribute('y', secY);
            headRect.setAttribute('width', secW);
            headRect.setAttribute('height', headerH);
            headRect.setAttribute('rx', '14');
            headRect.setAttribute('class', 'svg-section-header');
            secGroup.appendChild(headRect);

            // Section Title
            const titleText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            titleText.setAttribute('x', secX + 16);
            titleText.setAttribute('y', secY + 28);
            titleText.setAttribute('class', 'svg-section-title');
            titleText.textContent = sec.section_name;
            secGroup.appendChild(titleText);

            // Section Meta Pill / Count
            const blocks = sec.blocks || [];
            const secMeta = document.createElementNS('http://www.w3.org/2000/svg', 'text');
            secMeta.setAttribute('x', secX + secW - 16);
            secMeta.setAttribute('y', secY + 28);
            secMeta.setAttribute('text-anchor', 'end');
            secMeta.setAttribute('class', 'svg-section-meta');
            secMeta.textContent = `${blocks.length} ${blocks.length === 1 ? 'Block' : 'Blocks'} • ${sec.total_lots || 0} Lots`;
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
            const bodyMargin = 16;
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
                const bGap = 12;

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
                    blkRect.setAttribute('class', 'svg-block-bg');
                    blkGroup.appendChild(blkRect);

                    const blkTitle = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                    blkTitle.setAttribute('x', blkX + 12);
                    blkTitle.setAttribute('y', blkY + (blkH / 2) + 5);
                    blkTitle.setAttribute('class', 'svg-block-title');
                    blkTitle.textContent = blk.block_name;
                    blkGroup.appendChild(blkTitle);

                    // Block plot count badge
                    if (blkW > 95 && blkH > 28) {
                        const badgeW = 54;
                        const badgeH = 18;
                        const badgeX = blkX + blkW - badgeW - 10;
                        const badgeY = blkY + (blkH / 2) - 9;

                        const badgeRect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
                        badgeRect.setAttribute('x', badgeX);
                        badgeRect.setAttribute('y', badgeY);
                        badgeRect.setAttribute('width', badgeW);
                        badgeRect.setAttribute('height', badgeH);
                        badgeRect.setAttribute('rx', '4');
                        badgeRect.setAttribute('class', 'svg-block-badge-bg');
                        blkGroup.appendChild(badgeRect);

                        const badgeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
                        badgeText.setAttribute('x', badgeX + (badgeW / 2));
                        badgeText.setAttribute('y', badgeY + 13);
                        badgeText.setAttribute('text-anchor', 'middle');
                        badgeText.setAttribute('class', 'svg-block-badge-text');
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
                            config: blkCfg || { x: blkX - secX, y: blkY - secY, width: blkW, height: blkH, grid: { columns: 5 } }
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

        const cols = parseInt(gridConfig.columns, 10) || 5;
        const gapX = parseFloat(gridConfig.gap_x) || 14;
        const gapY = parseFloat(gridConfig.gap_y) || 14;
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

        if (newW < 400 || newW > 3200) return;

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
