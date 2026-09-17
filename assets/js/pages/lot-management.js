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

    const tabBadges = {
        available: document.getElementById('availableTabBadge'),
        reserved: document.getElementById('reservedTabBadge'),
        occupied: document.getElementById('occupiedTabBadge'),
        expired: document.getElementById('expiredTabBadge'),
    };

    function renderStats(stats) {
        statsEl.available.innerText = stats.available || 0;
        statsEl.occupied.innerText = stats.occupied || 0;
        statsEl.reserved.innerText = stats.reserved || 0;
        statsEl.expired.innerText = stats.expired || 0;
        statsEl.total.innerText = stats.total || 0;

        if (tabBadges.available) {
            tabBadges.available.innerText = stats.available || 0;
            tabBadges.available.style.display = (stats.available > 0) ? 'inline-flex' : 'none';
        }
        if (tabBadges.reserved) {
            tabBadges.reserved.innerText = stats.reserved || 0;
            tabBadges.reserved.style.display = (stats.reserved > 0) ? 'inline-flex' : 'none';
        }
        if (tabBadges.occupied) {
            tabBadges.occupied.innerText = stats.occupied || 0;
            tabBadges.occupied.style.display = (stats.occupied > 0) ? 'inline-flex' : 'none';
        }
        if (tabBadges.expired) {
            tabBadges.expired.innerText = stats.expired || 0;
            tabBadges.expired.style.display = (stats.expired > 0) ? 'inline-flex' : 'none';
        }
    }

    // ---------- Filtering + grouping ----------

    function computeCounts(lots) {
        return lots.reduce((acc, lot) => {
            acc.total++;
            if (lot.status === 'Available') acc.available++;
            else if (lot.status === 'Occupied') acc.occupied++;
            else if (lot.status === 'Reserved') acc.reserved++;
            else if (lot.status === 'Expired') acc.expired++;
            return acc;
        }, { total: 0, available: 0, occupied: 0, reserved: 0, expired: 0 });
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

    // Redesigned to match the compact "tag pill" language already used by
    // the Burial Scheduling lot-recommendation card (assets/js/shared/
    // booking-wizard.js's buildLotCard() + booking-chat.css's .meta-pill) —
    // requested for visual consistency across the two lot-facing pages.
    // Block/Size stay as their own pills (booking-wizard doesn't need them,
    // Lot Management does); Size is only rendered when the lot actually has
    // a recorded dimension, since an empty "--" pill reads as broken rather
    // than "no value" the way a text row would.
    function renderLotCardHtml(lot) {
        const sizePill = lot.dimensions
            ? `<span class="lot-pill"><i class="fas fa-ruler-combined"></i> ${escapeHtml(lot.dimensions)}</span>`
            : '';
        return `
            <div class="lot-card" data-id="${lot.lot_id}">
                <div class="lot-card-header">
                    <div class="lot-number"><i class="fas fa-monument"></i> ${escapeHtml(lot.lot_number)}</div>
                    <span class="lot-status status-${lot.status}">${escapeHtml(lot.status)}</span>
                </div>
                <div class="lot-meta-pills">
                    <span class="lot-type">${escapeHtml(lot.lot_type_name || 'N/A')}</span>
                    <span class="lot-pill section"><i class="fas fa-map-pin"></i> ${escapeHtml(lot.section_name)}</span>
                    <span class="lot-pill"><i class="fas fa-th-large"></i> ${escapeHtml(lot.block_name || 'N/A')}</span>
                    ${sizePill}
                    <span class="lot-pill price">₱${formatPrice(lot.price)}</span>
                </div>
                <div class="lot-card-footer">
                    <span>View Details</span>
                    <i class="fas fa-arrow-right"></i>
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

    function computeCapacityPercentages(counts) {
        const total = counts.total || 0;
        if (total === 0) {
            return { availPct: 0, rsvdPct: 0, occPct: 0, expPct: 0, total: 0 };
        }
        const availPct = Math.round((counts.available / total) * 100);
        const rsvdPct = Math.round((counts.reserved / total) * 100);
        const occPct = Math.round((counts.occupied / total) * 100);
        const expPct = Math.max(0, 100 - availPct - rsvdPct - occPct);
        return { availPct, rsvdPct, occPct, expPct, total };
    }

    function renderSectionHtml(categoryName, sec) {
        const key = `${categoryName}::${sec.name}`;
        const isExpanded = expandedSections.has(key);
        const secId = 'sec-' + encodeURIComponent(categoryName) + '-' + encodeURIComponent(sec.name);
        const pct = computeCapacityPercentages(sec.counts);

        return `
            <div class="section-group">
                <button type="button" class="section-header" data-section-key="${escapeHtml(key)}" aria-expanded="${isExpanded}" aria-controls="${secId}">
                    <div class="section-title">
                        <div class="section-icon-badge">
                            <i class="fas fa-tree"></i>
                        </div>
                        <div class="section-title-meta">
                            <div class="section-name-line">
                                <span class="section-name">${escapeHtml(sec.name)}</span>
                                ${sec.counts.available > 0
                                    ? `<span class="sec-status-tag tag-open"><i class="fas fa-circle-check"></i> ${sec.counts.available} Open</span>`
                                    : `<span class="sec-status-tag tag-full"><i class="fas fa-lock"></i> Fully Occupied</span>`
                                }
                            </div>
                            <span class="section-subtext"><i class="fas fa-cubes"></i> ${sec.counts.total} ${sec.counts.total === 1 ? 'registered plot' : 'registered plots'} in this zone</span>
                        </div>
                    </div>

                    <div class="section-occupancy-wrap">
                        <div class="sec-meter-pod" title="${sec.counts.available} Available, ${sec.counts.reserved} Reserved, ${sec.counts.occupied} Occupied${sec.counts.expired ? ', ' + sec.counts.expired + ' Expired' : ''}">
                            <div class="sec-meter-top">
                                <span class="sec-meter-label"><i class="fas fa-gauge-high"></i> Availability</span>
                                <span class="sec-meter-count"><strong>${sec.counts.available}</strong> / ${sec.counts.total} (${pct.availPct}%)</span>
                            </div>
                            <div class="mini-occupancy-track">
                                <div class="mini-bar avail" style="width: ${pct.availPct}%"></div>
                                <div class="mini-bar rsvd" style="width: ${pct.rsvdPct}%"></div>
                                <div class="mini-bar occ" style="width: ${pct.occPct}%"></div>
                                ${pct.expPct > 0 ? `<div class="mini-bar exp" style="width: ${pct.expPct}%"></div>` : ''}
                            </div>
                        </div>

                        <div class="section-chevron-btn ${isExpanded ? 'expanded' : ''}" title="${isExpanded ? 'Hide plots' : 'Show plots'}">
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </div>
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
        const pct = computeCapacityPercentages(cat.counts);

        return `
            <div class="category-group">
                <button type="button" class="category-header" data-category="${escapeHtml(cat.name)}" aria-expanded="${isExpanded}" aria-controls="${catId}">
                    <div class="category-title">
                        <div class="category-icon-box">
                            <i class="fas ${icon}"></i>
                        </div>
                        <div class="category-title-info">
                            <div class="category-name-row">
                                <h3 class="category-name">${escapeHtml(cat.name)}</h3>
                                ${pct.availPct > 0
                                    ? `<span class="avail-hero-badge high"><i class="fas fa-check-circle"></i> ${pct.availPct}% Available</span>`
                                    : `<span class="avail-hero-badge full"><i class="fas fa-ban"></i> 100% Occupied</span>`
                                }
                            </div>
                            <div class="category-meta-row">
                                <span class="cat-meta-pill"><i class="fas fa-map-marked-alt"></i> ${cat.sections.length} ${cat.sections.length === 1 ? 'Garden Zone' : 'Garden Zones'}</span>
                                <span class="cat-meta-pill"><i class="fas fa-monument"></i> ${cat.counts.total} Total Plots</span>
                            </div>
                        </div>
                    </div>

                    <div class="category-occupancy-wrap">
                        <div class="occupancy-dashboard-pod">
                            <div class="pod-header">
                                <span class="pod-title"><i class="fas fa-chart-pie"></i> Zone Capacity</span>
                                <span class="pod-ratio"><strong>${cat.counts.available}</strong> / ${cat.counts.total} Plots Ready</span>
                            </div>
                            <div class="occupancy-track" title="${cat.counts.available} Available, ${cat.counts.reserved} Reserved, ${cat.counts.occupied} Occupied${cat.counts.expired ? ', ' + cat.counts.expired + ' Expired' : ''}">
                                <div class="occupancy-bar avail" style="width: ${pct.availPct}%"></div>
                                <div class="occupancy-bar rsvd" style="width: ${pct.rsvdPct}%"></div>
                                <div class="occupancy-bar occ" style="width: ${pct.occPct}%"></div>
                                ${pct.expPct > 0 ? `<div class="occupancy-bar exp" style="width: ${pct.expPct}%"></div>` : ''}
                            </div>
                            <div class="occupancy-legend">
                                <span class="legend-chip avail"><span class="chip-dot"></span><strong>${cat.counts.available}</strong> Avail</span>
                                <span class="legend-chip rsvd"><span class="chip-dot"></span><strong>${cat.counts.reserved}</strong> Rsvd</span>
                                <span class="legend-chip occ"><span class="chip-dot"></span><strong>${cat.counts.occupied}</strong> Occ</span>
                                ${cat.counts.expired > 0 ? `<span class="legend-chip exp"><span class="chip-dot"></span><strong>${cat.counts.expired}</strong> Exp</span>` : ''}
                            </div>
                        </div>

                        <div class="category-chevron-btn ${isExpanded ? 'expanded' : ''}" title="${isExpanded ? 'Collapse' : 'Expand'}">
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </div>
                </button>
                <div class="category-body" id="${catId}" ${isExpanded ? '' : 'hidden'}>
                    <div class="category-body-header">
                        <span class="body-header-title"><i class="fas fa-layer-group"></i> Active Memorial Gardens</span>
                        <span class="body-header-sub">Click a garden zone to view plot slot matrices</span>
                    </div>
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

    // L3.3: re-fetches from the server whenever a filter is active, instead
    // of re-filtering the already-fully-loaded allLots array in the browser.
    // With no filters active it just reuses allLots — no extra round trip
    // for the common "no filter" case or right after Reset Filters.
    async function refreshVisibleLots() {
        tableCurrentPage = 1;
        if (!hasActiveFilters()) {
            visibleLots = allLots;
            updateViewDisplay();
            return;
        }
        try {
            visibleLots = await loadLots({ ...filters });
            updateViewDisplay();
        } catch (error) {
            showErrorState(error.message);
        }
    }

    const activeChipsContainer = document.getElementById('activeFilterChips');

    function updateActiveStatCard() {
        document.querySelectorAll('.stat-card-filterable').forEach((card) => {
            card.classList.toggle('is-active-filter', card.dataset.statusFilter === filters.status);
        });
    }

    function updateActiveSubTabs() {
        document.querySelectorAll('.records-tab-btn').forEach((btn) => {
            const tabStatus = btn.dataset.tab;
            const isActive = tabStatus === filters.status;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    function renderActiveFilterChips() {
        if (!activeChipsContainer) return;
        const chips = [];
        if (filters.search) {
            chips.push({
                label: `Search: "${filters.search}"`,
                clear: () => {
                    filters.search = '';
                    searchInput.value = '';
                }
            });
        }
        if (filters.section) {
            chips.push({
                label: `Section: ${filters.section}`,
                clear: () => {
                    filters.section = '';
                    sectionFilterSelect.value = '';
                }
            });
        }
        if (filters.category) {
            chips.push({
                label: `Category: ${filters.category}`,
                clear: () => {
                    filters.category = '';
                    categoryFilterSelect.value = '';
                }
            });
        }
        if (filters.status) {
            chips.push({
                label: `Status: ${filters.status}`,
                clear: () => {
                    filters.status = '';
                }
            });
        }

        if (!chips.length) {
            activeChipsContainer.innerHTML = '';
            return;
        }

        activeChipsContainer.innerHTML = chips.map((c, idx) => `
            <span class="filter-chip">
                <span>${escapeHtml(c.label)}</span>
                <button type="button" class="filter-chip-remove" data-chip-idx="${idx}" aria-label="Remove filter">
                    <i class="fas fa-xmark"></i>
                </button>
            </span>
        `).join('');

        activeChipsContainer.querySelectorAll('.filter-chip-remove').forEach((btn) => {
            btn.addEventListener('click', () => {
                const idx = parseInt(btn.dataset.chipIdx, 10);
                if (chips[idx]) {
                    chips[idx].clear();
                    updateActiveStatCard();
                    updateActiveSubTabs();
                    renderActiveFilterChips();
                    refreshVisibleLots();
                }
            });
        });
    }

    searchInput.addEventListener('input', debounce(() => {
        filters.search = searchInput.value;
        renderActiveFilterChips();
        refreshVisibleLots();
    }, 200));

    categoryFilterSelect.addEventListener('change', () => {
        filters.category = categoryFilterSelect.value;
        renderActiveFilterChips();
        refreshVisibleLots();
    });

    sectionFilterSelect.addEventListener('change', () => {
        filters.section = sectionFilterSelect.value;
        renderActiveFilterChips();
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
        updateActiveStatCard();
        updateActiveSubTabs();
        renderActiveFilterChips();
        refreshVisibleLots();
    });

    function applyStatusQuickFilter(status) {
        filters.status = status;
        updateActiveStatCard();
        updateActiveSubTabs();
        renderActiveFilterChips();
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

    document.querySelectorAll('.records-tab-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            applyStatusQuickFilter(btn.dataset.tab || '');
        });
    });

    updateActiveStatCard();
    updateActiveSubTabs();
    renderActiveFilterChips();

    function populateFilterDropdowns() {
        categoryFilterSelect.innerHTML = '<option value="">All Categories</option>' +
            lotTypes.map(type => `<option value="${escapeHtml(type.type_name)}">${escapeHtml(type.type_name)}</option>`).join('');
        sectionFilterSelect.innerHTML = '<option value="">All Sections</option>' +
            allSections.map(section => `<option value="${escapeHtml(section.section_name)}">${escapeHtml(section.section_name)}</option>`).join('');
    }

    // ---------- Tri-View System (Card / Interactive Slot Grid / Polymorphic Data Table Registry) ----------

    const gridLegend = document.getElementById('gridLegend');
    const btnCardView = document.getElementById('btnCardView');
    const btnGridView = document.getElementById('btnGridView');
    const btnTableView = document.getElementById('btnTableView');
    const lotTableCard = document.getElementById('lotTableCard');
    const lotTableBody = document.getElementById('lotTableBody');
    const lotTableBadgeCount = document.getElementById('lotTableBadgeCount');
    const lotTableFilterSummary = document.getElementById('lotTableFilterSummary');
    const lotPaginationInfo = document.getElementById('lotPaginationInfo');
    const lotPrevPage = document.getElementById('lotPrevPage');
    const lotNextPage = document.getElementById('lotNextPage');
    const lotPaginationJumpForm = document.getElementById('lotPaginationJumpForm');
    const lotPageJumpInput = document.getElementById('lotPageJumpInput');

    let tableCurrentPage = 1;
    const tablePerPage = 10;

    function updateViewDisplay() {
        if (activeViewMode === 'table') {
            if (hierarchyEl) hierarchyEl.style.display = 'none';
            if (gridLegend) gridLegend.style.display = 'none';
            if (lotTableCard) lotTableCard.style.display = 'block';
            renderDataTable();
        } else if (activeViewMode === 'grid') {
            if (lotTableCard) lotTableCard.style.display = 'none';
            if (hierarchyEl) hierarchyEl.style.display = 'block';
            if (gridLegend) gridLegend.style.display = 'flex';
            renderHierarchyRoot();
        } else {
            if (lotTableCard) lotTableCard.style.display = 'none';
            if (hierarchyEl) hierarchyEl.style.display = 'block';
            if (gridLegend) gridLegend.style.display = 'none';
            renderHierarchyRoot();
        }
    }

    function setViewMode(mode) {
        activeViewMode = mode;
        if (btnCardView) btnCardView.classList.toggle('active', mode === 'card');
        if (btnGridView) btnGridView.classList.toggle('active', mode === 'grid');
        if (btnTableView) btnTableView.classList.toggle('active', mode === 'table');
        updateViewDisplay();
    }

    if (btnCardView) btnCardView.addEventListener('click', () => setViewMode('card'));
    if (btnGridView) btnGridView.addEventListener('click', () => setViewMode('grid'));
    if (btnTableView) btnTableView.addEventListener('click', () => setViewMode('table'));

    function renderDataTable() {
        if (!lotTableBody) return;

        const totalItems = visibleLots.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / tablePerPage));

        if (tableCurrentPage > totalPages) tableCurrentPage = totalPages;
        if (tableCurrentPage < 1) tableCurrentPage = 1;

        const startIndex = (tableCurrentPage - 1) * tablePerPage;
        const endIndex = Math.min(startIndex + tablePerPage, totalItems);
        const pageLots = visibleLots.slice(startIndex, endIndex);

        // Update badge and filter summary
        if (lotTableBadgeCount) {
            lotTableBadgeCount.innerText = `${totalItems} ${totalItems === 1 ? 'lot' : 'lots'}`;
        }
        if (lotTableFilterSummary) {
            if (hasActiveFilters()) {
                const parts = [];
                if (filters.status) parts.push(`Status: ${filters.status}`);
                if (filters.section) parts.push(`Section: ${filters.section}`);
                if (filters.category) parts.push(`Category: ${filters.category}`);
                if (filters.search) parts.push(`Search: "${filters.search}"`);
                lotTableFilterSummary.innerText = `Filtered by: ${parts.join(' | ')}`;
            } else {
                lotTableFilterSummary.innerText = `Showing all ${totalItems} registered lots`;
            }
        }

        // Render rows
        if (!pageLots.length) {
            lotTableBody.innerHTML = `
                <tr>
                    <td colspan="8">
                        <div class="lot-empty-state">
                            <i class="fas fa-filter-circle-xmark"></i>
                            <strong>No matching lots found</strong>
                            <span>Try adjusting your search query or reset the active filters.</span>
                        </div>
                    </td>
                </tr>
            `;
        } else {
            lotTableBody.innerHTML = pageLots.map(lot => {
                const occupantHtml = lot.occupant_name
                    ? `<div class="occupant-cell">
                        <span class="occupant-name"><i class="fas fa-user"></i> ${escapeHtml(lot.occupant_name)}</span>
                        <span class="location-block">${lot.burial_date ? 'Interred: ' + escapeHtml(lot.burial_date) : (lot.date_of_death ? 'DOD: ' + escapeHtml(lot.date_of_death) : 'Occupied Record')}</span>
                       </div>`
                    : (lot.reserved_for_name
                        ? `<div class="occupant-cell">
                            <span class="occupant-reserved"><i class="fas fa-user-clock"></i> ${escapeHtml(lot.reserved_for_name)}</span>
                            <span class="location-block">${lot.burial_status ? 'Status: ' + escapeHtml(lot.burial_status) : 'Reservation Active'}</span>
                           </div>`
                        : `<span class="occupant-vacant"><i class="fas fa-circle-check"></i> Vacant / Available</span>`
                    );

                const leaseHtml = lot.lease_end_date
                    ? `<div class="location-cell">
                        <span class="location-section" style="font-size:0.8rem;"><i class="fas fa-calendar-alt"></i> ${escapeHtml(lot.lease_end_date)}</span>
                        <span class="location-block ${lot.days_until_expiration !== null && lot.days_until_expiration <= 30 ? 'text-danger' : ''}">${lot.days_until_expiration !== null ? (lot.days_until_expiration <= 0 ? 'Expired' : lot.days_until_expiration + ' days left') : ''}</span>
                       </div>`
                    : `<span class="occupant-vacant" style="color:#94a3b8;">—</span>`;

                const isAvailable = lot.status === 'Available';
                const quickActions = isAvailable ? `
                    <button type="button" class="table-action-btn table-action-btn--reserve" title="Quick Reserve" data-id="${lot.lot_id}" data-number="${escapeHtml(lot.lot_number)}">
                        <i class="fas fa-calendar-check"></i>
                    </button>
                    <button type="button" class="table-action-btn table-action-btn--pay" title="Quick Payment" data-id="${lot.lot_id}" data-number="${escapeHtml(lot.lot_number)}" data-price="${lot.price}">
                        <i class="fas fa-receipt"></i>
                    </button>
                ` : '';

                return `
                    <tr data-id="${lot.lot_id}">
                        <td>
                            <div class="lot-id-cell">
                                <div class="lot-number-title">
                                    <i class="fas fa-monument"></i>
                                    <span>${escapeHtml(lot.lot_number)}</span>
                                </div>
                                <span class="location-block">Plot ID #${lot.lot_id}</span>
                            </div>
                        </td>
                        <td>
                            <div class="location-cell">
                                <span class="location-section"><i class="fas fa-map-pin"></i> ${escapeHtml(lot.section_name || 'Unassigned')}</span>
                                <span class="location-block">Block: ${escapeHtml(lot.block_name || 'N/A')}</span>
                            </div>
                        </td>
                        <td>
                            <span class="lot-pill"><i class="fas ${categoryIcon(lot.lot_type_name)}"></i> ${escapeHtml(lot.lot_type_name || 'Standard')}</span>
                        </td>
                        <td>${occupantHtml}</td>
                        <td>${leaseHtml}</td>
                        <td>
                            <div class="location-cell">
                                <span class="location-section" style="color:var(--color-primary-700, #047857);">₱${formatPrice(lot.price)}</span>
                                <span class="location-block">${escapeHtml(lot.dimensions || 'Standard')}</span>
                            </div>
                        </td>
                        <td>
                            <span class="status-pill status-${(lot.status || '').toLowerCase()}">
                                <span class="dot"></span>
                                ${escapeHtml(lot.status)}
                            </span>
                        </td>
                        <td>
                            <div class="table-action-buttons">
                                <button type="button" class="table-action-btn table-action-btn--view" title="View details" data-id="${lot.lot_id}">
                                    <i class="fas fa-eye"></i>
                                </button>
                                <button type="button" class="table-action-btn table-action-btn--edit" title="Edit lot" data-id="${lot.lot_id}">
                                    <i class="fas fa-pen"></i>
                                </button>
                                ${quickActions}
                                <button type="button" class="table-action-btn table-action-btn--delete" title="Delete lot" data-id="${lot.lot_id}" data-number="${escapeHtml(lot.lot_number)}">
                                    <i class="fas fa-trash"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        // Update pagination controls
        if (lotPaginationInfo) {
            lotPaginationInfo.innerText = totalItems > 0
                ? `Showing ${startIndex + 1} to ${endIndex} of ${totalItems} lots (Page ${tableCurrentPage} of ${totalPages})`
                : `Showing 0 of 0 lots`;
        }
        if (lotPrevPage) {
            lotPrevPage.disabled = tableCurrentPage <= 1;
        }
        if (lotNextPage) {
            lotNextPage.disabled = tableCurrentPage >= totalPages;
        }
        if (lotPageJumpInput) {
            lotPageJumpInput.max = totalPages;
            lotPageJumpInput.placeholder = `Page ${tableCurrentPage}`;
        }
    }

    // Table row action delegation and click handling
    if (lotTableBody) {
        lotTableBody.addEventListener('click', async (e) => {
            const btn = e.target.closest('.table-action-btn');
            if (btn) {
                const id = btn.dataset.id;
                if (btn.classList.contains('table-action-btn--view')) {
                    showViewModal(id);
                } else if (btn.classList.contains('table-action-btn--edit')) {
                    openEditModal(id);
                } else if (btn.classList.contains('table-action-btn--reserve')) {
                    const lotNumber = btn.dataset.number;
                    window.location.href = `booking-assistant.html?service=burial&lot_id=${id}&lot_number=${encodeURIComponent(lotNumber)}`;
                } else if (btn.classList.contains('table-action-btn--pay')) {
                    const lotNumber = btn.dataset.number;
                    const price = btn.dataset.price;
                    window.location.href = `payments.html?lot_id=${id}&lot_number=${encodeURIComponent(lotNumber)}&price=${price}&reference_kind=lot`;
                } else if (btn.classList.contains('table-action-btn--delete')) {
                    const lotNumber = btn.dataset.number;
                    if (confirm(`Delete lot ${lotNumber}? This cannot be undone.`)) {
                        try {
                            await apiRequest(`lots/${id}`, { method: 'DELETE' });
                            await refreshAll();
                        } catch (error) {
                            alert('Failed to delete lot: ' + error.message);
                        }
                    }
                }
                return;
            }

            const tr = e.target.closest('tr[data-id]');
            if (tr && !e.target.closest('a, button, input, select')) {
                showViewModal(tr.dataset.id);
            }
        });
    }

    // Pagination controls event listeners
    if (lotPrevPage) {
        lotPrevPage.addEventListener('click', () => {
            if (tableCurrentPage > 1) {
                tableCurrentPage--;
                renderDataTable();
            }
        });
    }

    if (lotNextPage) {
        lotNextPage.addEventListener('click', () => {
            const totalPages = Math.max(1, Math.ceil(visibleLots.length / tablePerPage));
            if (tableCurrentPage < totalPages) {
                tableCurrentPage++;
                renderDataTable();
            }
        });
    }

    if (lotPaginationJumpForm) {
        lotPaginationJumpForm.addEventListener('submit', (e) => {
            e.preventDefault();
            if (!lotPageJumpInput) return;
            const totalPages = Math.max(1, Math.ceil(visibleLots.length / tablePerPage));
            const targetPage = parseInt(lotPageJumpInput.value, 10);
            if (!isNaN(targetPage) && targetPage >= 1 && targetPage <= totalPages) {
                tableCurrentPage = targetPage;
                renderDataTable();
                lotPageJumpInput.value = '';
            } else {
                alert(`Please enter a valid page number between 1 and ${totalPages}`);
            }
        });
    }

    // ---------- View/Add/Edit modals & Automation Wizards ----------

    async function showViewModal(lotId) {
        try {
            const lot = await apiRequest(`lots/${lotId}`);
            if (lot.error) {
                alert(lot.error);
                return;
            }

            // Update View Modal Header
            const viewSectionChip = document.getElementById('viewSectionChip');
            if (viewSectionChip) {
                viewSectionChip.innerHTML = `<i class="fas fa-map-pin"></i> ${escapeHtml(lot.section_name || 'Cemetery Plot')} &bull; ${escapeHtml(lot.lot_type_name || 'Standard')}`;
            }
            const viewModalTitle = document.getElementById('viewModalTitle');
            if (viewModalTitle) {
                viewModalTitle.innerHTML = `<i class="fas fa-monument"></i> Lot ${escapeHtml(lot.lot_number)}`;
            }
            const viewStatusBadge = document.getElementById('viewStatusBadge');
            if (viewStatusBadge) {
                viewStatusBadge.className = `status-pill status-${(lot.status || '').toLowerCase()}`;
                viewStatusBadge.innerHTML = `<span class="dot"></span>${escapeHtml(lot.status)}`;
            }

            // Build Occupancy Card Info
            let occupancyContent = '';
            if (lot.occupant_name) {
                occupancyContent = `
                    <div class="lot-view-item">
                        <span class="lot-view-label">Current Occupant</span>
                        <strong class="lot-view-value" style="color: #0284c7;"><i class="fas fa-user"></i> ${escapeHtml(lot.occupant_name)}</strong>
                    </div>
                    <div class="lot-view-item">
                        <span class="lot-view-label">Life Dates</span>
                        <span class="lot-view-value">${lot.date_of_birth ? 'DOB: ' + escapeHtml(lot.date_of_birth) : ''} ${lot.date_of_death ? '&bull; DOD: ' + escapeHtml(lot.date_of_death) : ''}</span>
                    </div>
                    <div class="lot-view-item">
                        <span class="lot-view-label">Interment Date</span>
                        <span class="lot-view-value">${escapeHtml(lot.burial_date || 'None recorded')}</span>
                    </div>
                `;
            } else if (lot.reserved_for_name) {
                occupancyContent = `
                    <div class="lot-view-item">
                        <span class="lot-view-label">Reserved Beneficiary</span>
                        <strong class="lot-view-value" style="color: #b45309;"><i class="fas fa-user-clock"></i> ${escapeHtml(lot.reserved_for_name)}</strong>
                    </div>
                    <div class="lot-view-item">
                        <span class="lot-view-label">Burial Schedule</span>
                        <span class="lot-view-value">#${lot.schedule_id || 'N/A'} (${escapeHtml(lot.burial_status || 'Reserved')})</span>
                    </div>
                `;
            } else {
                occupancyContent = `
                    <div class="lot-view-item">
                        <span class="lot-view-label">Occupancy Status</span>
                        <span class="occupant-vacant" style="font-size: 0.88rem;"><i class="fas fa-circle-check"></i> Vacant &amp; Available for Burial</span>
                    </div>
                `;
            }

            // Build Lease Timeline
            let leaseHealthBadge = '<span class="text-muted">—</span>';
            if (lot.days_until_expiration !== null) {
                if (lot.days_until_expiration <= 0) {
                    leaseHealthBadge = '<span class="badge" style="background:#fee2e2; color:#b91c1c;">Expired</span>';
                } else if (lot.days_until_expiration <= 30) {
                    leaseHealthBadge = `<span class="badge" style="background:#fef3c7; color:#b45309;">${lot.days_until_expiration}d remaining</span>`;
                } else {
                    leaseHealthBadge = `<span class="badge" style="background:#dcfce7; color:#15803d;">${lot.days_until_expiration}d active</span>`;
                }
            }

            const leaseContent = `
                <div class="lot-view-item">
                    <span class="lot-view-label">Lease Duration</span>
                    <span class="lot-view-value">${lot.lease_start_date ? escapeHtml(lot.lease_start_date) : 'N/A'} &rarr; ${lot.lease_end_date ? escapeHtml(lot.lease_end_date) : 'N/A'}</span>
                </div>
                <div class="lot-view-item">
                    <span class="lot-view-label">Lease Status</span>
                    ${leaseHealthBadge}
                </div>
            `;

            const detailsHtml = `
                <div class="lot-view-card">
                    <div class="lot-view-card-title">
                        <i class="fas fa-monument"></i>
                        <span>Plot Specifications</span>
                    </div>
                    <div class="lot-view-item">
                        <span class="lot-view-label">Plot Number</span>
                        <strong class="lot-view-value" style="color: var(--color-primary-700, #047857);">${escapeHtml(lot.lot_number)}</strong>
                    </div>
                    <div class="lot-view-item">
                        <span class="lot-view-label">Section &amp; Block</span>
                        <span class="lot-view-value"><i class="fas fa-map-pin text-muted"></i> ${escapeHtml(lot.section_name)} &bull; Block: ${escapeHtml(lot.block_name || 'N/A')}</span>
                    </div>
                    <div class="lot-view-item">
                        <span class="lot-view-label">Lot Type / Category</span>
                        <span class="lot-pill"><i class="fas ${categoryIcon(lot.lot_type_name)}"></i> ${escapeHtml(lot.lot_type_name || 'Standard')}</span>
                    </div>
                    <div class="lot-view-item">
                        <span class="lot-view-label">Base Price</span>
                        <strong class="lot-view-value" style="color: var(--color-primary-700, #047857); font-size: 1rem;">₱${formatPrice(lot.price)}</strong>
                    </div>
                    <div class="lot-view-item">
                        <span class="lot-view-label">Dimensions</span>
                        <span class="lot-view-value">${escapeHtml(lot.dimensions || 'Standard')}</span>
                    </div>
                    <div class="lot-view-item">
                        <span class="lot-view-label">Notes &amp; Vicinity</span>
                        <span class="lot-view-value text-muted">${escapeHtml(lot.location_notes || 'None recorded')}</span>
                    </div>
                </div>

                <div class="lot-view-card">
                    <div class="lot-view-card-title">
                        <i class="fas fa-address-card"></i>
                        <span>Occupancy &amp; Lease Records</span>
                    </div>
                    ${occupancyContent}
                    <div class="panel-divider" style="margin: 4px 0;"></div>
                    ${leaseContent}
                </div>
            `;
            document.getElementById('viewDetails').innerHTML = detailsHtml;

            const slotActions = document.getElementById('availableSlotActions');
            if (slotActions) {
                if (lot.status === 'Available') {
                    slotActions.style.display = 'flex';
                    const btnReserve = document.getElementById('btnProceedReserve');
                    const btnPayment = document.getElementById('btnProceedPayment');
                    if (btnReserve) {
                        btnReserve.onclick = () => {
                            window.location.href = `booking-assistant.html?service=burial&lot_id=${lot.lot_id}&lot_number=${encodeURIComponent(lot.lot_number)}`;
                        };
                    }
                    if (btnPayment) {
                        btnPayment.onclick = () => {
                            window.location.href = `payments.html?lot_id=${lot.lot_id}&lot_number=${encodeURIComponent(lot.lot_number)}&price=${lot.price}&reference_kind=lot`;
                        };
                    }
                } else {
                    slotActions.style.display = 'none';
                }
            }

            document.getElementById('viewModal').style.display = 'flex';

            initAiAssistant({
                mountSelector: '#aiAssistantMountRecord',
                context: { scope: 'entity', entity_type: 'Lot', entity_id: lotId },
                label: 'Ask AI About This Lot',
            });

            document.getElementById('editFromView').onclick = () => {
                document.getElementById('viewModal').style.display = 'none';
                openEditModal(lotId);
            };

            const closeViewBtn = document.getElementById('closeViewModalBtn');
            if (closeViewBtn) {
                closeViewBtn.onclick = () => {
                    document.getElementById('viewModal').style.display = 'none';
                };
            }

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

    function updateLotNumberPreview() {
        const lotNumberInput = document.getElementById('lotNumber');
        const hint = document.getElementById('lotNumberHint');
        const isEditMode = !!document.getElementById('lotId').value;
        if (isEditMode) return;

        const blockId = parseInt(document.getElementById('lotBlock').value, 10);
        if (!blockId) {
            lotNumberInput.placeholder = 'Leave blank to auto-generate';
            if (hint) hint.innerText = 'Leave blank to auto-generate sequentially';
            return;
        }
        const countInBlock = allLots.filter(lot => lot.block_id === blockId).length;
        const autoNum = `L${countInBlock + 1}`;
        lotNumberInput.placeholder = `e.g. ${autoNum} (leave blank to auto-generate)`;
        if (hint) hint.innerText = `Auto-generated default will be: ${autoNum}`;
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
                blockSelect.innerHTML = '<option value="">Select a block</option>' + (blocks || []).map(block =>
                    `<option value="${block.block_id}" ${String(block.block_id) === String(selectedBlockId) ? 'selected' : ''}>${block.block_name}</option>`
                ).join('');
            }
        } else {
            blockSelect.innerHTML = '<option value="">Select a block</option>';
        }

        const typeSelect = document.getElementById('lotType');
        typeSelect.innerHTML = lotTypes.map(type => `<option value="${type.lot_type_id || type.type_id}">${type.type_name}</option>`).join('');

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

        if (!data.block_id || !data.lot_type_id || isNaN(data.price)) {
            alert('Please fill in all required fields.');
            return;
        }

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

    // ---------- Batch Lot Generator Automation Wizard ----------

    async function openBatchModal() {
        const batchModal = document.getElementById('batchLotModal');
        if (!batchModal) return;

        const batchSection = document.getElementById('batchSection');
        const batchType = document.getElementById('batchType');

        if (batchSection) {
            batchSection.innerHTML = allSections.map(s => `<option value="${s.section_id}">${escapeHtml(s.section_name)}</option>`).join('');
        }
        if (batchType) {
            batchType.innerHTML = lotTypes.map(t => `<option value="${t.lot_type_id || t.type_id}">${escapeHtml(t.type_name)}</option>`).join('');
        }

        if (allSections.length && batchSection) {
            await updateBatchBlocks(batchSection.value);
        }

        updateBatchPreview();
        batchModal.style.display = 'flex';
    }

    async function updateBatchBlocks(sectionId) {
        const batchBlock = document.getElementById('batchBlock');
        if (!batchBlock) return;
        try {
            const blocks = await apiRequest(`blocks?section_id=${sectionId}`);
            batchBlock.innerHTML = (blocks || []).map(b => `<option value="${b.block_id}">${escapeHtml(b.block_name)}</option>`).join('');
        } catch (err) {
            batchBlock.innerHTML = '<option value="">No blocks found</option>';
        }
        updateBatchPreview();
    }

    function updateBatchPreview() {
        const countInput = document.getElementById('batchCount');
        const prefixInput = document.getElementById('batchPrefix');
        const startInput = document.getElementById('batchStartNumber');
        const blockSelect = document.getElementById('batchBlock');
        const sectionSelect = document.getElementById('batchSection');
        const previewTitle = document.getElementById('batchPreviewTitle');
        const previewRange = document.getElementById('batchPreviewRange');
        const previewText = document.getElementById('batchPreviewText');

        if (!countInput || !previewTitle || !previewRange || !previewText) return;

        const count = Math.max(1, Math.min(100, parseInt(countInput.value, 10) || 10));
        const prefix = (prefixInput?.value ?? 'L').trim();
        const blockId = parseInt(blockSelect?.value, 10);
        let startNum = parseInt(startInput?.value, 10);

        if (isNaN(startNum) || startNum < 1) {
            if (blockId) {
                const countInBlock = allLots.filter(l => l.block_id === blockId).length;
                startNum = countInBlock + 1;
            } else {
                startNum = 1;
            }
        }

        const endNum = startNum + count - 1;
        previewTitle.innerText = `Generating ${count} Lots`;
        previewRange.innerText = `${prefix}${startNum} to ${prefix}${endNum}`;

        const secName = sectionSelect?.selectedOptions[0]?.text || 'Selected Section';
        const blkName = blockSelect?.selectedOptions[0]?.text || 'Selected Block';
        previewText.innerHTML = `Estimated range: <span class="badge badge-emerald">${prefix}${startNum} to ${prefix}${endNum}</span> in ${escapeHtml(secName)} - ${escapeHtml(blkName)}`;
    }

    const batchSectionSelect = document.getElementById('batchSection');
    if (batchSectionSelect) {
        batchSectionSelect.addEventListener('change', () => updateBatchBlocks(batchSectionSelect.value));
    }
    const batchBlockSelect = document.getElementById('batchBlock');
    if (batchBlockSelect) {
        batchBlockSelect.addEventListener('change', () => updateBatchPreview());
    }
    ['batchCount', 'batchPrefix', 'batchStartNumber'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', () => updateBatchPreview());
    });

    const batchLotForm = document.getElementById('batchLotForm');
    if (batchLotForm) {
        batchLotForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const submitBtn = document.getElementById('btnSubmitBatch');
            const blockId = parseInt(document.getElementById('batchBlock').value, 10);
            const lotTypeId = parseInt(document.getElementById('batchType').value, 10);
            const count = parseInt(document.getElementById('batchCount').value, 10);
            const price = parseFloat(document.getElementById('batchPrice').value);
            const prefix = (document.getElementById('batchPrefix').value || 'L').trim();
            const startNum = document.getElementById('batchStartNumber').value ? parseInt(document.getElementById('batchStartNumber').value, 10) : null;
            const dimensions = document.getElementById('batchDimensions').value.trim();
            const notes = document.getElementById('batchNotes').value.trim();

            if (!blockId || !lotTypeId || isNaN(count) || isNaN(price)) {
                alert('Please fill in all required fields.');
                return;
            }

            await withButtonLoading(submitBtn, async () => {
                try {
                    const result = await apiRequest('lots/batch-generate', {
                        method: 'POST',
                        body: {
                            block_id: blockId,
                            lot_type_id: lotTypeId,
                            count: count,
                            price: price,
                            prefix: prefix,
                            start_number: startNum,
                            dimensions: dimensions || null,
                            location_notes: notes || null
                        }
                    });

                    if (result.success) {
                        document.getElementById('batchLotModal').style.display = 'none';
                        alert(`Success! Generated ${result.data?.count || count} lots (${result.data?.lot_numbers?.[0]} to ${result.data?.lot_numbers?.[result.data.lot_numbers.length - 1]}).`);
                        await refreshAll();
                    } else {
                        alert(result.error || 'Failed to generate lots');
                    }
                } catch (err) {
                    alert('Error: ' + err.message);
                }
            });
        });
    }

    // ---------- Automation Endpoints: Auto-Sync & CSV Export ----------

    const autoSyncBtn = document.getElementById('autoSyncBtn');
    if (autoSyncBtn) {
        autoSyncBtn.addEventListener('click', async () => {
            await withButtonLoading(autoSyncBtn, async () => {
                try {
                    const res = await apiRequest('lots/sync-status', { method: 'POST' });
                    if (res.success) {
                        const s = res.stats || {};
                        alert(`Auto-Sync Complete!\n\n${res.message}\n• Marked Occupied: ${s.occupied_updated ?? 0}\n• Marked Expired: ${s.expired_updated ?? 0}\n• Sections Recounted: ${s.sections_updated ?? 0}`);
                        await refreshAll();
                    } else {
                        alert(res.error || 'Failed to sync statuses');
                    }
                } catch (err) {
                    alert('Auto-Sync failed: ' + err.message);
                }
            });
        });
    }

    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', async () => {
            await withButtonLoading(exportCsvBtn, async () => {
                try {
                    const params = new URLSearchParams();
                    if (filters.search) params.set('search', filters.search);
                    if (filters.category) params.set('lot_type', filters.category);
                    if (filters.section) params.set('section', filters.section);
                    if (filters.status) params.set('status', filters.status);

                    const token = localStorage.getItem('jwt_token');
                    const url = `${API_BASE}/lots/export?${params.toString()}`;
                    const response = await fetch(url, {
                        headers: {
                            Authorization: `Bearer ${token}`
                        }
                    });

                    if (!response.ok) {
                        throw new Error('Export request failed: ' + response.statusText);
                    }

                    const blob = await response.blob();
                    const downloadUrl = window.URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = downloadUrl;
                    const dateStr = new Date().toISOString().slice(0, 10);
                    a.download = `lots_registry_${dateStr}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    window.URL.revokeObjectURL(downloadUrl);
                } catch (err) {
                    alert('Export failed: ' + err.message);
                }
            });
        });
    }

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
                if (initialGroups.length) {
                    expandedCategories.add(initialGroups[0].name);
                    if (initialGroups[0].sections && initialGroups[0].sections.length) {
                        expandedSections.add(`${initialGroups[0].name}::${initialGroups[0].sections[0].name}`);
                    }
                }
                hierarchyInitialized = true;
            }

            await refreshVisibleLots();
        } catch (error) {
            console.error('Failed to load lot data:', error);
            showErrorState(error.message);
        }
    }

    await refreshAll();

    // ---------- Global Modal Controls Wiring ----------

    document.getElementById('openAddLotModal')?.addEventListener('click', openAddModal);
    document.getElementById('openBatchLotModal')?.addEventListener('click', openBatchModal);

    document.querySelector('.close')?.addEventListener('click', () => document.getElementById('lotModal').style.display = 'none');
    document.querySelector('.close-lot-modal-btn')?.addEventListener('click', () => document.getElementById('lotModal').style.display = 'none');

    document.querySelector('.close-view')?.addEventListener('click', () => document.getElementById('viewModal').style.display = 'none');
    document.getElementById('closeViewModalBtn')?.addEventListener('click', () => document.getElementById('viewModal').style.display = 'none');

    document.getElementById('closeBatchModalTop')?.addEventListener('click', () => document.getElementById('batchLotModal').style.display = 'none');
    document.getElementById('closeBatchModalBottom')?.addEventListener('click', () => document.getElementById('batchLotModal').style.display = 'none');

    window.addEventListener('click', (e) => {
        const lotModal = document.getElementById('lotModal');
        const viewModal = document.getElementById('viewModal');
        const batchModal = document.getElementById('batchLotModal');

        if (lotModal && e.target === lotModal) lotModal.style.display = 'none';
        if (viewModal && e.target === viewModal) viewModal.style.display = 'none';
        if (batchModal && e.target === batchModal) batchModal.style.display = 'none';
    });
});

