document.addEventListener('DOMContentLoaded', async function() {
    const session = await requireRole(['admin', 'staff']);
    if (!session) return;

    // System-Wide AI Assistant: page-level, always visible in the header —
    // the per-record one below (mounted fresh in the view modal) is a
    // separate instance for "explain this specific lot", not a substitute
    // for having the assistant visible on the module page itself.
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Lot' },
        greeting: "Hello! I'm your AI assistant for Lot Management. How can I help you today?",
        suggestions: [
            { icon: 'fa-map-location-dot', label: 'Available lots', question: 'How many lots are currently available?' },
            { icon: 'fa-triangle-exclamation', label: 'Any exceptions?', question: 'Are there any open exceptions related to lots?' },
            { icon: 'fa-hourglass-half', label: 'Expiring soon', question: 'Which lot leases are expiring soon?' },
            { icon: 'fa-clock-rotate-left', label: 'Recent activity', question: 'What has happened recently in Lot Management?' },
        ],
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_session');
        window.location.href = `${getFrontendBasePath()}/auth/login.html`;
    });

    let allLots = [];
    let visibleLots = [];
    let allSections = [];
    let lotTypes = [];
    let hierarchyInitialized = false;
    // L3.7: the status the Edit modal was opened with, so the submit
    // handler can tell a genuine admin-override status change (needs a
    // confirmation) apart from a metadata-only edit where Status just
    // happens to still show its current value.
    let editingOriginalStatus = null;

    const filters = { search: '', category: '', section: '', status: '' };
    const expandedCategories = new Set();
    const expandedSections = new Set();

    const statsEl = {
        available: document.getElementById('availableCount'),
        occupied: document.getElementById('occupiedCount'),
        reserved: document.getElementById('reservedCount'),
        expired: document.getElementById('expiredCount'),
        total: document.getElementById('totalCount')
    };
    const hierarchyEl = document.getElementById('lotHierarchy');

    async function apiRequest(endpoint, options = {}) {
        const token = localStorage.getItem('jwt_token');
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
        };

        const response = await fetch(`${API_BASE}/${endpoint}`, {
            ...options,
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401) {
                localStorage.removeItem('jwt_token');
                window.location.href = `${getFrontendBasePath()}/auth/login.html`;
            }
            throw new Error(data.error || 'Request failed');
        }
        return data;
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[ch]));
    }

    function formatPrice(price) {
        return parseFloat(price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    function categoryIcon(name) {
        const key = (name || '').toLowerCase();
        if (key.includes('lawn')) return 'fa-seedling';
        if (key.includes('family')) return 'fa-people-roof';
        if (key.includes('mausoleum')) return 'fa-building-columns';
        if (key.includes('niche') || key.includes('cremation')) return 'fa-fire';
        if (key.includes('memorial')) return 'fa-dove';
        return 'fa-map-location-dot';
    }

    async function loadSections() {
        return await apiRequest('sections');
    }

    async function loadLotTypes() {
        return await apiRequest('lot-types');
    }

    // L3.3: filtering/search now happens server-side — called with no active
    // filters this is identical to the old bare `apiRequest('lots')` (whole
    // table, no query string). Called with active filters it appends only
    // the ones actually set, so the browser no longer has to fetch and
    // filter the entire lot table on every keystroke.
    async function loadLots(activeFilters = {}) {
        const params = new URLSearchParams();
        if (activeFilters.search) params.set('search', activeFilters.search);
        if (activeFilters.category) params.set('lot_type', activeFilters.category);
        if (activeFilters.section) params.set('section', activeFilters.section);
        if (activeFilters.status) params.set('status', activeFilters.status);
        const query = params.toString();
        return await apiRequest(query ? `lots?${query}` : 'lots');
    }

    function hasActiveFilters() {
        return Boolean(filters.search || filters.category || filters.section || filters.status);
    }

    async function loadStats() {
        return await apiRequest('lots/stats');
    }

    function renderStats(stats) {
        statsEl.available.innerText = stats.available || 0;
        statsEl.occupied.innerText = stats.occupied || 0;
        statsEl.reserved.innerText = stats.reserved || 0;
        statsEl.expired.innerText = stats.expired || 0;
        statsEl.total.innerText = stats.total || 0;
    }

    // ---------- Filtering + grouping ----------

    function computeCounts(lots) {
        return lots.reduce((acc, lot) => {
            acc.total++;
            if (lot.status === 'Available') acc.available++;
            else if (lot.status === 'Occupied') acc.occupied++;
            else if (lot.status === 'Reserved') acc.reserved++;
            return acc;
        }, { total: 0, available: 0, occupied: 0, reserved: 0 });
    }

    function groupLotsByCategory(lots) {
        const categories = {};
        lots.forEach(lot => {
            const catName = lot.lot_type_name || 'Uncategorized';
            const secName = lot.section_name || 'Unassigned';
            if (!categories[catName]) categories[catName] = { name: catName, lots: [], sections: {} };
            const cat = categories[catName];
            cat.lots.push(lot);
            if (!cat.sections[secName]) cat.sections[secName] = { name: secName, lots: [] };
            cat.sections[secName].lots.push(lot);
        });

        return Object.values(categories)
            .sort((a, b) => a.name.localeCompare(b.name))
            .map(cat => ({
                name: cat.name,
                counts: computeCounts(cat.lots),
                sections: Object.values(cat.sections)
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(sec => ({ name: sec.name, lots: sec.lots, counts: computeCounts(sec.lots) })),
            }));
    }

    // ---------- Rendering ----------

    function emptyStateHtml(icon, title, message, inline = false) {
        return `
            <div class="no-lots${inline ? ' no-lots-inline' : ''}">
                <i class="fas ${icon}"></i>
                <h3>${escapeHtml(title)}</h3>
                <p>${escapeHtml(message)}</p>
            </div>
        `;
    }

    let activeViewMode = 'card';

    function renderLotCardHtml(lot) {
        return `
            <div class="lot-card" data-id="${lot.lot_id}">
                <div class="card-border">
                    <div class="card-content">
                        <div class="lot-header">
                            <div>
                                <div class="lot-number">${escapeHtml(lot.lot_number)}</div>
                                <div class="lot-type">${escapeHtml(lot.lot_type_name || 'N/A')}</div>
                            </div>
                            <span class="lot-status status-${lot.status}">${escapeHtml(lot.status)}</span>
                        </div>
                        <div class="lot-info">
                            <div class="info-row"><i class="fas fa-dollar-sign"></i><span>Price</span><strong>₱${formatPrice(lot.price)}</strong></div>
                            <div class="info-row"><i class="fas fa-map-marker-alt"></i><span>Section</span><strong>${escapeHtml(lot.section_name)}</strong></div>
                            <div class="info-row"><i class="fas fa-th-large"></i><span>Block</span><strong>${escapeHtml(lot.block_name || 'N/A')}</strong></div>
                            <div class="info-row"><i class="fas fa-ruler-combined"></i><span>Size</span><strong>${escapeHtml(lot.dimensions || '--')}</strong></div>
                        </div>
                        <div class="card-footer">
                            <span>View Details</span>
                            <i class="fas fa-arrow-right"></i>
                        </div>
                    </div>
                </div>
            </div>
        `;
    }

    function buildMatrixBoxHtml(lot) {
        let code = 'O';
        if (lot.status === 'Occupied') code = 'X';
        else if (lot.status === 'Reserved') code = 'R';
        else if (lot.status === 'Expired') code = 'E';

        return `
            <div class="slot-box status-${lot.status}" data-id="${lot.lot_id}" title="Lot ${escapeHtml(lot.lot_number)} (${escapeHtml(lot.status)}) - ₱${formatPrice(lot.price)}">
                <div class="slot-icon">${code}</div>
                <div class="slot-num">${escapeHtml(lot.lot_number)}</div>
            </div>
        `;
    }

    function renderSectionLotsHtml(lots) {
        if (activeViewMode === 'grid') {
            return `<div class="section-matrix"><div class="slots-matrix">${lots.map(buildMatrixBoxHtml).join('')}</div></div>`;
        }
        return `<div class="section-lot-grid lot-grid">${lots.map(renderLotCardHtml).join('')}</div>`;
    }

    function renderSectionHtml(categoryName, sec) {
        const key = `${categoryName}::${sec.name}`;
        const isExpanded = expandedSections.has(key);
        const secId = 'sec-' + encodeURIComponent(categoryName) + '-' + encodeURIComponent(sec.name);

        return `
            <div class="section-group">
                <button type="button" class="section-header" data-section-key="${escapeHtml(key)}" aria-expanded="${isExpanded}" aria-controls="${secId}">
                    <span class="section-title">
                        <i class="fas fa-map-marker-alt section-icon"></i>
                        <span class="section-name">${escapeHtml(sec.name)}</span>
                    </span>
                    <span class="section-counts">
                        <span class="count-chip total">${sec.counts.total} Lots</span>
                        <span class="count-chip available">${sec.counts.available} Available</span>
                        <span class="count-chip occupied">${sec.counts.occupied} Occupied</span>
                        <span class="count-chip reserved">${sec.counts.reserved} Reserved</span>
                    </span>
                    <i class="fas fa-chevron-down chevron ${isExpanded ? 'expanded' : ''}"></i>
                </button>
                <div class="section-body" id="${secId}" ${isExpanded ? '' : 'hidden'}>
                    ${sec.lots.length ? renderSectionLotsHtml(sec.lots) : emptyStateHtml('fa-border-all', 'No Lots', 'No lots found in this section.', true)}
                </div>
            </div>
        `;
    }

    function renderCategoryHtml(cat) {
        const isExpanded = expandedCategories.has(cat.name);
        const catId = 'cat-' + encodeURIComponent(cat.name);
        const icon = categoryIcon(cat.name);

        return `
            <div class="category-group">
                <button type="button" class="category-header" data-category="${escapeHtml(cat.name)}" aria-expanded="${isExpanded}" aria-controls="${catId}">
                    <span class="category-title">
                        <i class="fas ${icon} category-icon"></i>
                        <span class="category-name">${escapeHtml(cat.name)}</span>
                    </span>
                    <span class="category-counts">
                        <span class="count-chip total">${cat.counts.total} Total</span>
                        <span class="count-chip available">${cat.counts.available} Available</span>
                        <span class="count-chip occupied">${cat.counts.occupied} Occupied</span>
                        <span class="count-chip reserved">${cat.counts.reserved} Reserved</span>
                    </span>
                    <i class="fas fa-chevron-down chevron ${isExpanded ? 'expanded' : ''}"></i>
                </button>
                <div class="category-body" id="${catId}" ${isExpanded ? '' : 'hidden'}>
                    ${cat.sections.length
                        ? cat.sections.map(sec => renderSectionHtml(cat.name, sec)).join('')
                        : emptyStateHtml('fa-map', 'No Sections', 'No sections are currently assigned to this category.', true)}
                </div>
            </div>
        `;
    }

    function renderHierarchyRoot() {
        if (!allLots.length) {
            hierarchyEl.innerHTML = emptyStateHtml('fa-tree', 'No Lots Found', 'No lots have been added yet. Click "Add New Lot" to get started.');
            return;
        }

        const groups = groupLotsByCategory(visibleLots);

        if (!groups.length) {
            hierarchyEl.innerHTML = hasActiveFilters()
                ? emptyStateHtml('fa-filter-circle-xmark', 'No Matches', filters.search ? 'No lots match your search.' : 'No lots match the selected filters.')
                : emptyStateHtml('fa-tree', 'No Lots Found', 'No lots have been added yet.');
            return;
        }

        hierarchyEl.innerHTML = groups.map(renderCategoryHtml).join('');
    }

    function showLoadingState() {
        hierarchyEl.innerHTML = `
            <div class="hierarchy-loading">
                <i class="fas fa-circle-notch fa-spin"></i>
                <p>Loading lot data...</p>
            </div>
        `;
    }

    function showErrorState(message) {
        hierarchyEl.innerHTML = `
            <div class="hierarchy-error">
                <i class="fas fa-triangle-exclamation"></i>
                <h3>Unable to Load Lot Information</h3>
                <p>${escapeHtml(message || 'Something went wrong while loading lots.')}</p>
                <button type="button" class="btn-retry" id="btnRetryLoad"><i class="fas fa-rotate-right"></i> Retry</button>
            </div>
        `;
        const retryBtn = document.getElementById('btnRetryLoad');
        if (retryBtn) retryBtn.addEventListener('click', () => refreshAll());
    }

    // ---------- Event delegation over the hierarchy container ----------

    hierarchyEl.addEventListener('click', (e) => {
        const catHeader = e.target.closest('.category-header');
        if (catHeader) {
            const name = catHeader.dataset.category;
            if (expandedCategories.has(name)) expandedCategories.delete(name);
            else expandedCategories.add(name);
            renderHierarchyRoot();
            return;
        }

        const secHeader = e.target.closest('.section-header');
        if (secHeader) {
            const key = secHeader.dataset.sectionKey;
            if (expandedSections.has(key)) expandedSections.delete(key);
            else expandedSections.add(key);
            renderHierarchyRoot();
            return;
        }

        const lotCard = e.target.closest('.lot-card');
        if (lotCard) {
            showViewModal(lotCard.dataset.id);
            return;
        }

        const slotBox = e.target.closest('.slot-box');
        if (slotBox) {
            showViewModal(slotBox.dataset.id);
        }
    });

    // ---------- Filter toolbar wiring ----------

    const searchInput = document.getElementById('lotSearchInput');
    const categoryFilterSelect = document.getElementById('filterCategory');
    const sectionFilterSelect = document.getElementById('filterSection');
    const statusFilterSelect = document.getElementById('filterStatus');

    // L3.3: re-fetches from the server whenever a filter is active, instead
    // of re-filtering the already-fully-loaded allLots array in the browser.
    // With no filters active it just reuses allLots — no extra round trip
    // for the common "no filter" case or right after Reset Filters.
    async function refreshVisibleLots() {
        if (!hasActiveFilters()) {
            visibleLots = allLots;
            renderHierarchyRoot();
            return;
        }
        try {
            visibleLots = await loadLots({ ...filters });
            renderHierarchyRoot();
        } catch (error) {
            showErrorState(error.message);
        }
    }

    // L3.6: highlights whichever stat card matches the currently active
    // status filter (or none, if status filtering isn't in play) — kept in
    // sync whether the filter was set by clicking a card, by the Status
    // dropdown, or cleared via Reset Filters.
    function updateActiveStatCard() {
        document.querySelectorAll('.stat-card-filterable').forEach((card) => {
            card.classList.toggle('is-active-filter', card.dataset.statusFilter === filters.status);
        });
    }

    searchInput.addEventListener('input', debounce(() => {
        filters.search = searchInput.value;
        refreshVisibleLots();
    }, 200));

    categoryFilterSelect.addEventListener('change', () => {
        filters.category = categoryFilterSelect.value;
        refreshVisibleLots();
    });

    sectionFilterSelect.addEventListener('change', () => {
        filters.section = sectionFilterSelect.value;
        refreshVisibleLots();
    });

    statusFilterSelect.addEventListener('change', () => {
        filters.status = statusFilterSelect.value;
        updateActiveStatCard();
        refreshVisibleLots();
    });

    document.getElementById('btnResetFilters').addEventListener('click', () => {
        filters.search = '';
        filters.category = '';
        filters.section = '';
        filters.status = '';
        searchInput.value = '';
        categoryFilterSelect.value = '';
        sectionFilterSelect.value = '';
        statusFilterSelect.value = '';
        updateActiveStatCard();
        refreshVisibleLots();
    });

    // L3.6: clicking (or Enter/Space-activating) a stat card applies that
    // status as a quick filter, mirroring what picking it from the Status
    // dropdown would do — including keeping the dropdown itself in sync, so
    // the two entry points never disagree about what's currently applied.
    function applyStatusQuickFilter(status) {
        filters.status = status;
        statusFilterSelect.value = status;
        updateActiveStatCard();
        refreshVisibleLots();
    }

    document.querySelectorAll('.stat-card-filterable').forEach((card) => {
        card.addEventListener('click', () => applyStatusQuickFilter(card.dataset.statusFilter));
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                applyStatusQuickFilter(card.dataset.statusFilter);
            }
        });
    });
    updateActiveStatCard();

    function populateFilterDropdowns() {
        categoryFilterSelect.innerHTML = '<option value="">All Categories</option>' +
            lotTypes.map(type => `<option value="${escapeHtml(type.type_name)}">${escapeHtml(type.type_name)}</option>`).join('');
        sectionFilterSelect.innerHTML = '<option value="">All Sections</option>' +
            allSections.map(section => `<option value="${escapeHtml(section.section_name)}">${escapeHtml(section.section_name)}</option>`).join('');
    }

    // ---------- View mode toggle (Card / Interactive Slot Grid) ----------

    const gridLegend = document.getElementById('gridLegend');
    const btnCardView = document.getElementById('btnCardView');
    const btnGridView = document.getElementById('btnGridView');

    if (btnCardView && btnGridView) {
        btnCardView.addEventListener('click', () => {
            activeViewMode = 'card';
            btnCardView.classList.add('active');
            btnGridView.classList.remove('active');
            gridLegend.style.display = 'none';
            renderHierarchyRoot();
        });

        btnGridView.addEventListener('click', () => {
            activeViewMode = 'grid';
            btnGridView.classList.add('active');
            btnCardView.classList.remove('active');
            gridLegend.style.display = 'flex';
            renderHierarchyRoot();
        });
    }

    // ---------- View/Add/Edit modals (unchanged behavior) ----------

    async function showViewModal(lotId) {
        try {
            const lot = await apiRequest(`lots/${lotId}`);
            if (lot.error) {
                alert(lot.error);
                return;
            }

            const details = `
                <div class="detail-row"><span>Lot Number</span><strong>${lot.lot_number}</strong></div>
                <div class="detail-row"><span>Section</span><strong>${lot.section_name}</strong></div>
                <div class="detail-row"><span>Block</span><strong>${lot.block_name || 'N/A'}</strong></div>
                <div class="detail-row"><span>Type</span><strong>${lot.lot_type_name}</strong></div>
                <div class="detail-row"><span>Price</span><strong>₱${parseFloat(lot.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong></div>
                <div class="detail-row"><span>Status</span><strong>${lot.status}</strong></div>
                <div class="detail-row"><span>Dimensions</span><strong>${lot.dimensions || '—'}</strong></div>
                <div class="detail-row"><span>Notes</span><strong>${lot.location_notes || 'None'}</strong></div>
            `;
            document.getElementById('viewDetails').innerHTML = details;

            const slotActions = document.getElementById('availableSlotActions');
            if (slotActions) {
                if (lot.status === 'Available') {
                    slotActions.style.display = 'flex';
                    const btnReserve = document.getElementById('btnProceedReserve');
                    const btnPayment = document.getElementById('btnProceedPayment');
                    if (btnReserve) {
                        btnReserve.onclick = () => {
                            window.location.href = `burial-scheduling.html?lot_id=${lot.lot_id}&lot_number=${encodeURIComponent(lot.lot_number)}`;
                        };
                    }
                    if (btnPayment) {
                        btnPayment.onclick = () => {
                            window.location.href = `payments.html?lot_id=${lot.lot_id}&lot_number=${encodeURIComponent(lot.lot_number)}&price=${lot.price}`;
                        };
                    }
                } else {
                    slotActions.style.display = 'none';
                }
            }

            document.getElementById('viewModal').style.display = 'flex';

            // System-Wide AI Assistant: mounts with this record's context
            // pre-wired, but no longer auto-asks on open (quota-reduction
            // batch — opening a record must never cost an LLM call by
            // itself). The admin can still open the panel and ask a
            // question, and the assistant answers using this same
            // entity-scoped context. Separate mount from the page-level
            // header assistant above (#aiAssistantMountRecord vs
            // #aiAssistantMount) so opening one doesn't clobber the other's
            // conversation.
            initAiAssistant({
                mountSelector: '#aiAssistantMountRecord',
                context: { scope: 'entity', entity_type: 'Lot', entity_id: lotId },
                label: 'Ask AI',
            });

            document.getElementById('editFromView').onclick = () => {
                document.getElementById('viewModal').style.display = 'none';
                openEditModal(lotId);
            };

            const deleteBtn = document.getElementById('deleteFromView');
            if (deleteBtn) {
                deleteBtn.onclick = async () => {
                    if (confirm(`Delete lot ${lot.lot_number}? This cannot be undone.`)) {
                        try {
                            await apiRequest(`lots/${lotId}`, { method: 'DELETE' });
                            document.getElementById('viewModal').style.display = 'none';
                            await refreshAll();
                        } catch (error) {
                            alert('Failed to delete lot: ' + error.message);
                        }
                    }
                };
            }
        } catch (error) {
            alert('Failed to load lot details: ' + error.message);
        }
    }

    // L3.4: now awaits populateFormDropdowns() before showing the modal
    // (previously fired-and-forgot it). That was harmless while the Section/
    // Lot Type <select>s carried hardcoded placeholder <option>s in the HTML
    // (removed in L3.4 — they duplicated live API data and could drift), but
    // without them the modal would otherwise flash empty dropdowns for the
    // moment it takes populateFormDropdowns()'s block fetch to resolve.
    async function openAddModal() {
        document.getElementById('modalTitle').innerText = 'Add New Lot';
        document.getElementById('lotForm').reset();
        document.getElementById('lotId').value = '';
        editingOriginalStatus = null;
        await populateFormDropdowns();
        document.getElementById('lotModal').style.display = 'flex';
    }

    async function openEditModal(lotId) {
        try {
            const lot = await apiRequest(`lots/${lotId}`);
            document.getElementById('modalTitle').innerText = 'Edit Lot';
            document.getElementById('lotId').value = lot.lot_id;
            document.getElementById('lotNumber').value = lot.lot_number;
            document.getElementById('lotSection').value = lot.section_name || '';
            document.getElementById('lotType').value = lot.lot_type_id || '';
            document.getElementById('lotPrice').value = lot.price;
            document.getElementById('lotStatus').value = lot.status;
            document.getElementById('lotDimensions').value = lot.dimensions || '';
            document.getElementById('lotNotes').value = lot.location_notes || '';
            editingOriginalStatus = lot.status;
            await populateFormDropdowns(lot.section_name, lot.block_id);
            document.getElementById('lotModal').style.display = 'flex';
        } catch (error) {
            alert('Failed to load lot: ' + error.message);
        }
    }

    // Shows what the backend will auto-generate (Lot::generateLotNumber(), 'L' +
    // count-in-block + 1) as a placeholder so staff can leave Lot Number blank.
    // Never writes into the input's value — the count here is only as fresh as
    // the last full lot fetch, so the actually-submitted number must come from
    // the backend's live count at insert time, not this client-side preview.
    function updateLotNumberPreview() {
        const lotNumberInput = document.getElementById('lotNumber');
        const isEditMode = !!document.getElementById('lotId').value;
        if (isEditMode) return;

        const blockId = parseInt(document.getElementById('lotBlock').value, 10);
        if (!blockId) {
            lotNumberInput.placeholder = 'Leave blank to auto-generate';
            return;
        }
        const countInBlock = allLots.filter(lot => lot.block_id === blockId).length;
        lotNumberInput.placeholder = `e.g. L${countInBlock + 1} (leave blank to auto-generate)`;
    }

    async function populateFormDropdowns(selectedSection = '', selectedBlockId = '') {
        const sectionSelect = document.getElementById('lotSection');
        sectionSelect.innerHTML = allSections.map(section =>
            `<option value="${section.section_name}" ${section.section_name === selectedSection ? 'selected' : ''}>${section.section_name}</option>`
        ).join('');

        const sectionName = sectionSelect.value;
        const blockSelect = document.getElementById('lotBlock');
        if (sectionName) {
            const section = allSections.find(item => item.section_name === sectionName);
            if (section) {
                const blocks = await apiRequest(`blocks?section_id=${section.section_id}`);
                blockSelect.innerHTML = '<option value="">Select a block</option>' + blocks.map(block =>
                    `<option value="${block.block_id}" ${String(block.block_id) === String(selectedBlockId) ? 'selected' : ''}>${block.block_name}</option>`
                ).join('');
            }
        } else {
            blockSelect.innerHTML = '<option value="">Select a block</option>';
        }

        const typeSelect = document.getElementById('lotType');
        typeSelect.innerHTML = lotTypes.map(type => `<option value="${type.type_id}">${type.type_name}</option>`).join('');

        sectionSelect.onchange = () => populateFormDropdowns(sectionSelect.value);
        blockSelect.onchange = () => updateLotNumberPreview();
        updateLotNumberPreview();
    }

    document.getElementById('lotForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('lotId').value;
        const data = {
            block_id: parseInt(document.getElementById('lotBlock').value, 10),
            lot_number: document.getElementById('lotNumber').value.trim(),
            lot_type_id: parseInt(document.getElementById('lotType').value, 10),
            status: document.getElementById('lotStatus').value,
            price: parseFloat(document.getElementById('lotPrice').value),
            dimensions: document.getElementById('lotDimensions').value.trim() || null,
            location_notes: document.getElementById('lotNotes').value.trim() || null,
        };

        if (!data.block_id || !data.lot_type_id || !data.price) {
            alert('Please fill in all required fields.');
            return;
        }

        // L3.7: only prompts when Status is actually being changed during an
        // edit (not on a routine metadata save where Status just happens to
        // still show the lot's current value, and not on Add — a new lot's
        // initial status isn't an override of anything). Backend enforcement
        // is unchanged; this is purely a "did you mean to do that" UX gate.
        if (id && editingOriginalStatus && data.status !== editingOriginalStatus) {
            const confirmed = confirm(
                `Change this lot's status from ${editingOriginalStatus} to ${data.status}?\n\n` +
                'This directly overrides the lot\'s lifecycle status and bypasses the normal reservation/payment/expiration flow.'
            );
            if (!confirmed) {
                return;
            }
        }

        const saveBtn = e.target.querySelector('button[type="submit"]');
        await withButtonLoading(saveBtn, async () => {
            try {
                let result;
                if (id) {
                    result = await apiRequest(`lots/${id}`, { method: 'PUT', body: data });
                } else {
                    result = await apiRequest('lots', { method: 'POST', body: data });
                }
                if (result.success) {
                    document.getElementById('lotModal').style.display = 'none';
                    await refreshAll();
                } else {
                    alert(result.error || 'Failed to save lot');
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        });
    });

    // ---------- Initial load / refresh ----------

    async function refreshAll() {
        showLoadingState();
        try {
            const [stats, sections, types, lots] = await Promise.all([
                loadStats(), loadSections(), loadLotTypes(), loadLots(),
            ]);

            renderStats(stats);
            allSections = sections;
            lotTypes = types;
            allLots = lots;
            populateFilterDropdowns();

            if (!hierarchyInitialized) {
                const initialGroups = groupLotsByCategory(allLots);
                if (initialGroups.length) expandedCategories.add(initialGroups[0].name);
                hierarchyInitialized = true;
            }

            // L3.3: re-applies whatever filters are currently active (e.g.
            // right after saving a lot while a status filter is set) instead
            // of always showing the unfiltered full list.
            await refreshVisibleLots();
        } catch (error) {
            console.error('Failed to load lot data:', error);
            showErrorState(error.message);
        }
    }

    await refreshAll();

    document.getElementById('openAddLotModal').addEventListener('click', openAddModal);
    document.querySelector('.close').addEventListener('click', () => document.getElementById('lotModal').style.display = 'none');
    document.querySelector('.close-view').addEventListener('click', () => document.getElementById('viewModal').style.display = 'none');

    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('lotModal')) document.getElementById('lotModal').style.display = 'none';
        if (e.target === document.getElementById('viewModal')) document.getElementById('viewModal').style.display = 'none';
    });
});
