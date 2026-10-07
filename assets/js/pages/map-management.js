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
                sections.forEach(s => totalBlocks += (s.blocks ? s.blocks.length : 0));
                badgeStructureSummary.textContent = `${sections.length} Sections • ${totalBlocks} Blocks`;

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
                    <div class="tree-label-group">
                        <i class="fas fa-layer-group tree-icon"></i>
                        <span>${escapeHtml(sec.section_name)}</span>
                        ${sec.map_config ? '<span class="tree-badge-customized" title="Custom Geometry Configured"></span>' : ''}
                    </div>
                    <small class="text-muted">${(sec.blocks || []).length} Blks</small>
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
                            <div class="tree-label-group">
                                <i class="fas fa-th-large tree-icon"></i>
                                <span>${escapeHtml(blk.block_name)}</span>
                                ${blk.map_config ? '<span class="tree-badge-customized" title="Custom Geometry Configured"></span>' : ''}
                            </div>
                            <small class="text-muted">${blk.total_lots || 0} Lots</small>
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
        const count = sections.length;
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
        const blockCount = blocks.length;

        let bCols = 1;
        if (blockCount >= 2 && blockCount <= 4) bCols = 2;
        else if (blockCount > 4) bCols = Math.ceil(Math.sqrt(blockCount));
        const bRows = Math.ceil(blockCount / bCols);

        const secBounds = sec.map_config || calculateDefaultSectionBounds(sec);
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

        // Update Editor Header
        editorEntityTitle.textContent = entity.name || 'Selected Entity';
        editorEntityTypeBadge.textContent = entity.type.toUpperCase();

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
        if (!isValid) {
            validationStatus.className = 'validation-status status--error';
            validationStatus.innerHTML = `<i class="fas fa-circle-xmark"></i> <span>${escapeHtml(errorMessage)}</span>`;
            btnSaveGeometry.disabled = true;
        } else if (warnings.length > 0) {
            validationStatus.className = 'validation-status status--warning';
            validationStatus.innerHTML = `<i class="fas fa-triangle-exclamation"></i> <span>Geometry is valid with boundary warnings.</span>`;
            btnSaveGeometry.disabled = false;
        } else {
            validationStatus.className = 'validation-status status--valid';
            validationStatus.innerHTML = `<i class="fas fa-check-circle"></i> <span>Geometry is valid and ready to save.</span>`;
            btnSaveGeometry.disabled = false;
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
     * Toggle unsaved badge indicator.
     */
    function updateUnsavedIndicator() {
        if (unsavedIndicator) {
            unsavedIndicator.style.display = state.hasUnsavedEdits ? 'inline-flex' : 'none';
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
            }
        } catch (err) {
            console.error('Save error:', err);
            toast(err.message || 'Error communicating with server.', 'error');
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
     * Render Overview (Sections & Blocks) preview in SVG.
     */
    function renderOverviewPreview() {
        const sections = state.currentLayout.sections || [];
        const canvasW = state.baseViewBox.width;
        const canvasH = state.baseViewBox.height;
        const margin = 40;
        const gap = 30;

        const count = sections.length;
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

            let secX = margin + ((index % cols) * (defSectionW + gap));
            let secY = margin + (Math.floor(index / cols) * (defSectionH + gap));
            let secW = defSectionW;
            let secH = defSectionH;

            if (secCfg && !isNaN(Number(secCfg.x)) && !isNaN(Number(secCfg.y))) {
                secX = Number(secCfg.x);
                secY = Number(secCfg.y);
                secW = Number(secCfg.width) || defSectionW;
                secH = Number(secCfg.height) || defSectionH;
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

                    let blkX = bodyX + ((bIdx % bCols) * (defBlkW + bGap));
                    let blkY = bodyY + (Math.floor(bIdx / bCols) * (defBlkH + bGap));
                    let blkW = defBlkW;
                    let blkH = defBlkH;

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
        if (!state.selectedEntity || state.selectedEntity.type === 'cemetery') {
            selectedEntityHighlightRect.style.display = 'none';
            return;
        }

        const entity = state.selectedEntity;
        const config = entity.config;
        if (!config || isNaN(Number(config.width)) || isNaN(Number(config.height))) {
            selectedEntityHighlightRect.style.display = 'none';
            return;
        }

        let targetX = Number(config.x) || 0;
        let targetY = Number(config.y) || 0;
        let targetW = Number(config.width) || 100;
        let targetH = Number(config.height) || 100;

        if (state.viewMode === 'overview') {
            if (entity.type === 'block' && entity.parent) {
                const secCfg = entity.parent.map_config || calculateDefaultSectionBounds(entity.parent);
                const secX = Number(secCfg.x) || 0;
                const secY = Number(secCfg.y) || 0;
                targetX = targetX < Number(secCfg.width) ? (secX + targetX) : targetX;
                targetY = targetY < Number(secCfg.height) ? (secY + targetY) : targetY;
            }
        }

        selectedEntityHighlightRect.setAttribute('x', targetX - 4);
        selectedEntityHighlightRect.setAttribute('y', targetY - 4);
        selectedEntityHighlightRect.setAttribute('width', targetW + 8);
        selectedEntityHighlightRect.setAttribute('height', targetH + 8);
        selectedEntityHighlightRect.setAttribute('rx', '8');
        selectedEntityHighlightRect.style.display = 'block';
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
