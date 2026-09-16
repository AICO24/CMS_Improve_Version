document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    // System-Wide AI Assistant: page-level, always visible in the header —
    // the per-request one below (mounted fresh in the view modal) is a
    // separate instance for "explain this specific relocation request".
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Relocation' },
        greeting: "Hello! I'm your AI assistant for Relocation & Exhumation. How can I help you today?",
        suggestions: [
            { icon: 'fa-truck-moving', label: 'Recent requests', question: 'What relocation requests have been made recently, and what is their status?' },
            { icon: 'fa-triangle-exclamation', label: 'Any exceptions?', question: 'Are there any open exceptions related to relocation?' },
            { icon: 'fa-circle-question', label: 'How does auto-approval work?', question: 'How does relocation auto-approval work?' },
            { icon: 'fa-list-check', label: 'Pending vs completed', question: 'How many relocation requests are pending versus completed?' },
        ],
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    function debounce(fn, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    function formatDateTime(dateStr) {
        if (!dateStr) return '—';
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return escapeHtml(dateStr);
        return d.toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            year: 'numeric'
        });
    }

    const statsEls = {
        pending: document.getElementById('pendingCount'),
        approved: document.getElementById('approvedCount'),
        completed: document.getElementById('completedCount'),
        total: document.getElementById('totalCount'),
        attention: document.getElementById('attentionCount'),
    };
    const tbody = document.getElementById('requestsTableBody');
    const requestModal = document.getElementById('requestModal');
    const viewModal = document.getElementById('viewModal');

    // Sub-Tabs elements
    const tabBtnAll = document.getElementById('tabBtnAll');
    const tabBtnPending = document.getElementById('tabBtnPending');
    const tabBtnApproved = document.getElementById('tabBtnApproved');
    const tabBtnCompleted = document.getElementById('tabBtnCompleted');
    const pendingBadge = document.getElementById('pendingBadge');
    const approvedBadge = document.getElementById('approvedBadge');

    // Filter toolbar elements
    const searchInput = document.getElementById('searchInput');
    const statusFilter = document.getElementById('statusFilter');
    const attentionFilter = document.getElementById('attentionFilter');
    const activeFilterChips = document.getElementById('activeFilterChips');
    const exportCsvBtn = document.getElementById('exportCsvBtn');

    let currentTab = 'all';
    let currentQuery = '';
    let currentStatusFilter = 'all';
    let currentAttentionFilter = false;
    let cachedRequests = [];
    let cachedDecedents = [];
    let cachedLots = [];

    const perPage = 10;
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');
    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        infoEl: paginationInfo,
        itemLabel: 'request',
        onChange: loadAndRenderRequests,
    });

    async function apiRequest(endpoint, options = {}) {
        return await api.request(endpoint, options);
    }

    async function loadRequests() {
        const params = new URLSearchParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);

        if (currentTab !== 'all') {
            params.set('status', currentTab.charAt(0).toUpperCase() + currentTab.slice(1));
        } else if (currentStatusFilter !== 'all') {
            params.set('status', currentStatusFilter);
        }

        if (currentQuery) {
            params.set('q', currentQuery);
        }

        if (currentAttentionFilter) {
            params.set('attention', '1');
        }

        return await apiRequest(`relocations?${params.toString()}`);
    }

    async function loadStats() {
        return await apiRequest('relocations/stats');
    }

    function renderStats(stats) {
        if (statsEls.pending) statsEls.pending.innerText = stats.pending || 0;
        if (statsEls.approved) statsEls.approved.innerText = stats.approved || 0;
        if (statsEls.completed) statsEls.completed.innerText = stats.completed || 0;
        if (statsEls.total) statsEls.total.innerText = stats.total || 0;
        if (statsEls.attention) statsEls.attention.innerText = stats.attention || 0;

        if (pendingBadge) {
            const count = stats.pending || 0;
            pendingBadge.innerText = count;
            pendingBadge.style.display = count > 0 ? 'inline-flex' : 'none';
        }
        if (approvedBadge) {
            const count = stats.approved || 0;
            approvedBadge.innerText = count;
            approvedBadge.style.display = count > 0 ? 'inline-flex' : 'none';
        }
    }

    function renderActiveFilterChips() {
        const chips = [
            { key: 'tab', label: 'Tab', value: currentTab !== 'all' ? (currentTab.charAt(0).toUpperCase() + currentTab.slice(1)) : '', clear: () => switchTab('all') },
            { key: 'q', label: 'Search', value: currentQuery, clear: () => { searchInput.value = ''; currentQuery = ''; } },
            { key: 'status', label: 'Status', value: currentStatusFilter !== 'all' && currentTab === 'all' ? currentStatusFilter : '', clear: () => { statusFilter.value = 'all'; currentStatusFilter = 'all'; } },
            { key: 'attention', label: 'Filter', value: currentAttentionFilter ? 'Needs attention only' : '', clear: () => { attentionFilter.checked = false; currentAttentionFilter = false; } },
        ].filter(chip => chip.value);

        if (!activeFilterChips) return;
        activeFilterChips.innerHTML = chips.map(chip => `
            <span class="filter-chip" data-filter-key="${chip.key}">
                ${escapeHtml(chip.label)}: ${escapeHtml(chip.value)}
                <button type="button" aria-label="Remove ${escapeHtml(chip.label)} filter">&times;</button>
            </span>
        `).join('');

        activeFilterChips.querySelectorAll('.filter-chip').forEach(chipEl => {
            const chip = chips.find(item => item.key === chipEl.dataset.filterKey);
            const btn = chipEl.querySelector('button');
            if (!chip || !btn) return;
            btn.addEventListener('click', () => {
                chip.clear();
                renderActiveFilterChips();
                pagination.reset();
                loadAndRenderRequests();
            });
        });
    }

    function switchTab(tab) {
        currentTab = tab;
        [
            { btn: tabBtnAll, tab: 'all' },
            { btn: tabBtnPending, tab: 'pending' },
            { btn: tabBtnApproved, tab: 'approved' },
            { btn: tabBtnCompleted, tab: 'completed' },
        ].forEach(item => {
            if (!item.btn) return;
            if (item.tab === tab) {
                item.btn.classList.add('active');
            } else {
                item.btn.classList.remove('active');
            }
        });

        if (tab !== 'all') {
            statusFilter.value = tab.charAt(0).toUpperCase() + tab.slice(1);
            currentStatusFilter = statusFilter.value;
        } else {
            statusFilter.value = 'all';
            currentStatusFilter = 'all';
        }

        renderActiveFilterChips();
        pagination.reset();
        loadAndRenderRequests();
    }

    if (tabBtnAll) tabBtnAll.addEventListener('click', () => switchTab('all'));
    if (tabBtnPending) tabBtnPending.addEventListener('click', () => switchTab('pending'));
    if (tabBtnApproved) tabBtnApproved.addEventListener('click', () => switchTab('approved'));
    if (tabBtnCompleted) tabBtnCompleted.addEventListener('click', () => switchTab('completed'));

    const onSearchChange = debounce(() => {
        currentQuery = searchInput.value.trim();
        renderActiveFilterChips();
        pagination.reset();
        loadAndRenderRequests();
    }, 300);

    if (searchInput) searchInput.addEventListener('input', onSearchChange);

    if (statusFilter) {
        statusFilter.addEventListener('change', () => {
            currentStatusFilter = statusFilter.value;
            if (currentStatusFilter !== 'all') {
                const matchTab = currentStatusFilter.toLowerCase();
                if (['pending', 'approved', 'completed'].includes(matchTab)) {
                    currentTab = matchTab;
                    [tabBtnAll, tabBtnPending, tabBtnApproved, tabBtnCompleted].forEach(b => {
                        if (b) b.classList.toggle('active', b.dataset.tab === matchTab);
                    });
                }
            } else {
                currentTab = 'all';
                [tabBtnAll, tabBtnPending, tabBtnApproved, tabBtnCompleted].forEach(b => {
                    if (b) b.classList.toggle('active', b.dataset.tab === 'all');
                });
            }
            renderActiveFilterChips();
            pagination.reset();
            loadAndRenderRequests();
        });
    }

    if (attentionFilter) {
        attentionFilter.addEventListener('change', () => {
            currentAttentionFilter = attentionFilter.checked;
            renderActiveFilterChips();
            pagination.reset();
            loadAndRenderRequests();
        });
    }

    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', () => {
            if (!cachedRequests || cachedRequests.length === 0) {
                showToast('No relocation records to export.', { type: 'info' });
                return;
            }

            const headers = ['Request ID', 'Decedent', 'From Lot', 'From Section', 'To Lot', 'To Section', 'Reason', 'Status', 'Requested By', 'Approved By', 'Created At'];
            const rows = cachedRequests.map(r => [
                `"REQ-${r.request_id}"`,
                `"${(r.first_name + ' ' + r.last_name).replace(/"/g, '""')}"`,
                `"${(r.from_lot_number || '').replace(/"/g, '""')}"`,
                `"${(r.from_section || '').replace(/"/g, '""')}"`,
                `"${(r.to_lot_number || '').replace(/"/g, '""')}"`,
                `"${(r.to_section || '').replace(/"/g, '""')}"`,
                `"${(r.reason || '').replace(/"/g, '""')}"`,
                `"${r.status}"`,
                `"${(r.requested_by_name || '').replace(/"/g, '""')}"`,
                `"${(r.approved_by_name || '').replace(/"/g, '""')}"`,
                `"${r.created_at}"`,
            ]);

            const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(row => row.join(','))].join('\n');
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', `Relocation_Requests_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast('Relocation records exported to CSV.', { type: 'success' });
        });
    }

    // Full Automation, Admin-First (Round 2): relocation requests now
    // auto-approve at creation (RelocationController::store()) — a request
    // only stays Pending when that auto-approval hit a system_exceptions
    // entry (e.g. the destination lot went unavailable in the race window).
    // Mirrors manage-reservations.js's loadOpenScheduleExceptionIds() exactly,
    // scoped to entity_type=Relocation instead of Schedule.
    let openRelocationExceptions = new Map();
    async function loadOpenRelocationExceptions() {
        try {
            const exceptions = await apiRequest('exceptions?status=open&entity_type=Relocation');
            const map = new Map();
            (Array.isArray(exceptions) ? exceptions : []).forEach((exception) => {
                map.set(Number(exception.entity_id), exception.reason);
            });
            return map;
        } catch (error) {
            console.error('Failed to load open relocation exceptions', error);
            return new Map();
        }
    }

    async function loadAndRenderRequests() {
        try {
            if (!openRelocationExceptions || openRelocationExceptions.size === 0) {
                openRelocationExceptions = await loadOpenRelocationExceptions();
            }
            const result = await loadRequests();
            const requests = Array.isArray(result.data) ? result.data : [];
            cachedRequests = requests;
            renderTable(requests);
            pagination.render(result.meta || { page: 1, total_pages: 1, total: requests.length });

            const tableHeaderTitle = document.getElementById('tableHeaderTitle');
            const tableHeaderBadge = document.getElementById('tableHeaderBadge');
            if (tableHeaderTitle) {
                if (currentAttentionFilter) {
                    tableHeaderTitle.innerText = 'Relocation Requests Requiring Attention';
                } else if (currentTab === 'pending') {
                    tableHeaderTitle.innerText = 'Pending Relocation Queue';
                } else if (currentTab === 'approved') {
                    tableHeaderTitle.innerText = 'Approved & In-Progress Relocations';
                } else if (currentTab === 'completed') {
                    tableHeaderTitle.innerText = 'Completed Relocation Archive';
                } else if (currentStatusFilter !== 'all') {
                    tableHeaderTitle.innerText = `${currentStatusFilter} Relocation Requests`;
                } else if (currentQuery) {
                    tableHeaderTitle.innerText = `Search results for "${currentQuery}"`;
                } else {
                    tableHeaderTitle.innerText = 'All Relocation Requests';
                }
            }
            if (tableHeaderBadge) {
                const totalCount = result.meta?.total !== undefined ? result.meta.total : requests.length;
                tableHeaderBadge.innerText = `${totalCount} ${totalCount === 1 ? 'Record' : 'Records'}`;
            }
        } catch (error) {
            console.error('Failed to load relocation requests', error);
            tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; padding: 30px;">Failed to load requests. Please refresh.</td></tr>';
            pagination.render({ page: 1, total_pages: 1, total: 0 });
        }
    }

    function renderTable(requests) {
        if (!Array.isArray(requests) || requests.length === 0) {
            const isFiltered = Boolean(currentQuery || currentTab !== 'all' || currentStatusFilter !== 'all' || currentAttentionFilter);
            tbody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="reloc-empty-state">
                            <div class="empty-icon-wrap">
                                <i class="fas fa-truck-moving"></i>
                            </div>
                            <strong>${isFiltered ? 'No matching relocation requests' : 'No relocation requests found'}</strong>
                            <span>${isFiltered ? 'Try clearing or modifying your search and filter criteria.' : 'New relocation requests will appear here.'}</span>
                            ${isFiltered ? `
                                <button type="button" class="btn-secondary btn-clear-filters" id="emptyClearFiltersBtn">
                                    <i class="fas fa-filter-circle-xmark"></i> Clear Filters
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
            const clearBtn = document.getElementById('emptyClearFiltersBtn');
            if (clearBtn) {
                clearBtn.addEventListener('click', () => {
                    switchTab('all');
                    if (searchInput) { searchInput.value = ''; currentQuery = ''; }
                    if (statusFilter) { statusFilter.value = 'all'; currentStatusFilter = 'all'; }
                    if (attentionFilter) { attentionFilter.checked = false; currentAttentionFilter = false; }
                    renderActiveFilterChips();
                    pagination.reset();
                    loadAndRenderRequests();
                });
            }
            return;
        }

        tbody.innerHTML = requests.map(req => {
            const reqId = Number(req.request_id);
            const fullName = `${req.first_name || ''} ${req.last_name || ''}`.trim() || 'Unknown Decedent';
            const hasException = openRelocationExceptions && openRelocationExceptions.has(reqId);
            const exceptionReason = hasException ? openRelocationExceptions.get(reqId) : '';
            const truncatedReason = req.reason ? (req.reason.length > 42 ? req.reason.substring(0, 42) + '...' : req.reason) : 'No reason specified';

            return `
            <tr data-id="${req.request_id}">
                <td>
                    <span class="reloc-id-chip" title="Relocation Request #${req.request_id}">REQ-${req.request_id}</span>
                </td>
                <td>
                    <div class="decedent-cell">
                        <div class="decedent-avatar" aria-hidden="true">
                            <i class="fas fa-user"></i>
                        </div>
                        <div class="decedent-info">
                            <span class="decedent-name">${escapeHtml(fullName)}</span>
                            <span class="decedent-meta"><i class="fas fa-hashtag"></i> ID: ${escapeHtml(String(req.deceased_id || req.decedent_id || '—'))}</span>
                        </div>
                    </div>
                </td>
                <td>
                    <div class="transfer-route-badge">
                        <span class="route-point from" title="Origin Lot ${escapeHtml(req.from_lot_number || 'N/A')} (${escapeHtml(req.from_section || '—')})">
                            <i class="fas fa-map-pin"></i>
                            <span class="route-lot">${escapeHtml(req.from_lot_number || 'N/A')}</span>
                            <span class="route-section">${escapeHtml(req.from_section || 'Sec —')}</span>
                        </span>
                        <span class="route-arrow" aria-hidden="true">
                            <i class="fas fa-arrow-right"></i>
                        </span>
                        <span class="route-point to" title="Destination Lot ${escapeHtml(req.to_lot_number || 'N/A')} (${escapeHtml(req.to_section || '—')})">
                            <i class="fas fa-location-dot"></i>
                            <span class="route-lot">${escapeHtml(req.to_lot_number || 'N/A')}</span>
                            <span class="route-section">${escapeHtml(req.to_section || 'Sec —')}</span>
                        </span>
                    </div>
                </td>
                <td>
                    <div class="reason-cell" title="${escapeHtml(req.reason || '')}">
                        <span class="reason-text">${escapeHtml(truncatedReason)}</span>
                    </div>
                </td>
                <td>
                    <div class="status-cell-wrap">
                        <span class="status-badge status-${escapeHtml(req.status.toLowerCase())}">${escapeHtml(req.status)}</span>
                        ${hasException ? `
                            <span class="status-badge attention-badge" title="Needs attention: ${escapeHtml(exceptionReason)}">
                                <i class="fas fa-triangle-exclamation"></i>
                                <span>Action Req</span>
                            </span>
                        ` : ''}
                    </div>
                </td>
                <td>
                    <div class="requester-cell">
                        <span class="requester-name"><i class="fas fa-user-circle"></i> ${escapeHtml(req.requested_by_name || 'Staff / System')}</span>
                        <span class="requester-date"><i class="far fa-clock"></i> ${formatDateTime(req.created_at)}</span>
                    </div>
                </td>
                <td class="action-buttons">
                    <button class="btn-view-request" data-id="${req.request_id}" title="View Details">
                        <i class="fas fa-eye"></i>
                        <span class="btn-view-label">View</span>
                    </button>
                </td>
            </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.btn-view-request').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id || btn.closest('tr').dataset.id;
                showViewModal(id);
            });
        });
    }

    async function refreshAll() {
        try {
            const stats = await loadStats();
            renderStats(stats);
        } catch (error) {
            console.error('Failed to load relocation stats', error);
        }
        openRelocationExceptions = await loadOpenRelocationExceptions();
        await loadAndRenderRequests();
    }

    // ── Dropzone & AI Document Assistant State ──
    const relocFileInput = document.getElementById('relocFileInput');
    const relocDocType = document.getElementById('relocationDocType');
    const relocDropzonePlaceholder = document.getElementById('relocDropzonePlaceholder');
    const relocPreviewContainer = document.getElementById('relocPreviewContainer');
    const relocPreviewImg = document.getElementById('relocPreviewImg');
    const relocPreviewPdf = document.getElementById('relocPreviewPdf');
    const relocPdfName = document.getElementById('relocPdfName');
    const clearRelocFileBtn = document.getElementById('clearRelocFileBtn');
    const extractRelocDocBtn = document.getElementById('extractRelocDocBtn');
    const relocExtractionChips = document.getElementById('relocExtractionChips');
    const relocUploadHint = document.getElementById('relocUploadHint');

    function resetDocumentUpload() {
        if (relocFileInput) relocFileInput.value = '';
        if (relocDocType) relocDocType.value = 'exhumation_permit';
        if (relocUploadHint) relocUploadHint.textContent = 'Permit file will be attached automatically to this relocation record upon save.';
        if (relocPreviewContainer) relocPreviewContainer.style.display = 'none';
        if (relocDropzonePlaceholder) relocDropzonePlaceholder.style.display = 'flex';
        if (relocPreviewImg) { relocPreviewImg.src = ''; relocPreviewImg.style.display = 'none'; }
        if (relocPreviewPdf) relocPreviewPdf.style.display = 'none';
        if (relocExtractionChips) { relocExtractionChips.innerHTML = ''; relocExtractionChips.style.display = 'none'; }
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const commaIndex = reader.result.indexOf(',');
                resolve(commaIndex >= 0 ? reader.result.slice(commaIndex + 1) : reader.result);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    function resetOriginLotFields() {
        const fromLotDisplay = document.getElementById('fromLotDisplay');
        const fromLotId = document.getElementById('fromLotId');
        const fromSectionDisplay = document.getElementById('fromSectionDisplay');
        const decedentHint = document.getElementById('decedentHint');

        if (fromLotDisplay) fromLotDisplay.value = '';
        if (fromLotId) fromLotId.value = '';
        if (fromSectionDisplay) fromSectionDisplay.value = '';
        if (decedentHint) {
            decedentHint.textContent = 'Current burial lot and section will be detected and locked automatically.';
            decedentHint.style.color = '';
        }
    }

    function populateDestinationLots(excludeLotId = null, selectedLotId = null) {
        const toLotSelect = document.getElementById('toLotId');
        if (!toLotSelect) return;

        const availableLots = cachedLots.filter(l => {
            const isAvailable = (l.status || '').toLowerCase() === 'available';
            const isExcluded = excludeLotId && Number(l.lot_id) === Number(excludeLotId);
            return isAvailable && !isExcluded;
        });

        if (availableLots.length === 0) {
            toLotSelect.innerHTML = '<option value="">No available destination lots found</option>';
            return;
        }

        toLotSelect.innerHTML = '<option value="">Select an available destination lot...</option>' +
            availableLots.map(l => {
                return `<option value="${l.lot_id}">Lot ${escapeHtml(l.lot_number)} (${escapeHtml(l.section_name || 'General Section')})</option>`;
            }).join('');

        if (selectedLotId) {
            toLotSelect.value = selectedLotId;
        }
    }

    function handleDecedentSelection(decedentId, preserveToLotId = null) {
        const decedent = cachedDecedents.find(d => Number(d.decedent_id) === Number(decedentId));
        const fromLotDisplay = document.getElementById('fromLotDisplay');
        const fromLotId = document.getElementById('fromLotId');
        const fromSectionDisplay = document.getElementById('fromSectionDisplay');
        const decedentHint = document.getElementById('decedentHint');

        if (!decedent || !decedent.lot_id) {
            resetOriginLotFields();
            populateDestinationLots();
            if (decedentHint) {
                decedentHint.textContent = 'Please choose a buried decedent with an active lot assignment.';
                decedentHint.style.color = '#dc2626';
            }
            return;
        }

        // Automated prefill of origin lot and section
        if (fromLotId) fromLotId.value = decedent.lot_id;
        if (fromLotDisplay) fromLotDisplay.value = `Lot ${decedent.lot_number || decedent.lot_id}`;
        if (fromSectionDisplay) fromSectionDisplay.value = decedent.section_name || 'General Section';

        if (decedentHint) {
            decedentHint.innerHTML = `<i class="fas fa-circle-check" style="color: #10b981;"></i> Current resting place verified: <strong>Lot ${escapeHtml(decedent.lot_number || '')} (${escapeHtml(decedent.section_name || '')})</strong>.`;
            decedentHint.style.color = '#047857';
        }

        // Visual flash highlight on prefilled fields
        [fromLotDisplay, fromSectionDisplay].forEach(el => {
            if (!el) return;
            el.style.transition = 'background-color 300ms ease, border-color 300ms ease';
            el.style.backgroundColor = '#ecfdf5';
            el.style.borderColor = '#10b981';
            setTimeout(() => {
                el.style.backgroundColor = '';
                el.style.borderColor = '';
            }, 1800);
        });

        // Dynamic destination lot dropdown: exclude decedent's origin lot!
        populateDestinationLots(decedent.lot_id, preserveToLotId);
    }

    async function populateDropdowns(selectedDecedentId = null, selectedToLotId = null) {
        try {
            const [decedentsRes, lotsRes] = await Promise.all([
                apiRequest('decedents'),
                apiRequest('lots')
            ]);

            cachedDecedents = Array.isArray(decedentsRes.data) ? decedentsRes.data : (Array.isArray(decedentsRes) ? decedentsRes : []);
            cachedLots = Array.isArray(lotsRes.data) ? lotsRes.data : (Array.isArray(lotsRes) ? lotsRes : []);

            const decedentSelect = document.getElementById('decedentId');
            if (decedentSelect) {
                const sortedDecedents = [...cachedDecedents].filter(d => d.lot_id).sort((a, b) => {
                    const nameA = `${a.last_name}, ${a.first_name}`.toLowerCase();
                    const nameB = `${b.last_name}, ${b.first_name}`.toLowerCase();
                    return nameA.localeCompare(nameB);
                });

                decedentSelect.innerHTML = '<option value="">Choose a buried decedent...</option>' +
                    sortedDecedents.map(d => {
                        const name = `${d.last_name}, ${d.first_name}${d.suffix ? ' ' + d.suffix : ''}`;
                        const lotInfo = ` — Lot ${d.lot_number} (${d.section_name || 'Sec —'})`;
                        return `<option value="${d.decedent_id}">${escapeHtml(name)}${lotInfo}</option>`;
                    }).join('');

                if (selectedDecedentId) {
                    decedentSelect.value = selectedDecedentId;
                    handleDecedentSelection(selectedDecedentId, selectedToLotId);
                } else {
                    resetOriginLotFields();
                    populateDestinationLots(null, selectedToLotId);
                }
            }
        } catch (error) {
            console.error('Failed to populate dropdowns:', error);
        }
    }

    async function showViewModal(id) {
        try {
            const req = await apiRequest(`relocations/${id}`);
            if (req.error) {
                alert(req.error);
                return;
            }

            // A Pending request now only exists because the automatic
            // approval attempt raised an exception (see
            // loadOpenRelocationExceptions()) — surface why, same "Control
            // Center" framing as the burial-scheduling exceptions flow,
            // instead of leaving an unexplained stuck status.
            const openReason = openRelocationExceptions.get(Number(req.request_id));
            const details = `
                <div class="detail-row"><span>Request ID</span><strong>REQ-${req.request_id}</strong></div>
                <div class="detail-row"><span>Decedent</span><strong>${req.first_name} ${req.last_name}</strong></div>
                <div class="detail-row"><span>From Lot</span><strong>${req.from_lot_number} (${req.from_section})</strong></div>
                <div class="detail-row"><span>To Lot</span><strong>${req.to_lot_number} (${req.to_section})</strong></div>
                <div class="detail-row"><span>Reason</span><strong>${req.reason}</strong></div>
                <div class="detail-row"><span>Status</span><strong class="status-badge status-${req.status.toLowerCase()}">${req.status}</strong></div>
                <div class="detail-row"><span>Requested By</span><strong>${req.requested_by_name}</strong></div>
                <div class="detail-row"><span>Created</span><strong>${req.created_at}</strong></div>
                ${req.approved_by_name ? `<div class="detail-row"><span>Approved By</span><strong>${req.approved_by_name}</strong></div>` : ''}
                ${openReason ? `<div class="detail-row"><span>Needs review</span><strong>${openReason} — <a href="exceptions.html">Review in Exceptions</a></strong></div>` : ''}
            `;
            document.getElementById('viewDetails').innerHTML = details;

            const approveBtn = document.getElementById('approveBtn');
            const completeBtn = document.getElementById('completeBtn');
            const denyBtn = document.getElementById('denyBtn');
            const editBtn = document.getElementById('editFromView');
            const deleteBtn = document.getElementById('deleteFromView');

            const isAdmin = user.role === 'admin';
            // Approval now happens automatically at creation — a request is
            // only ever still Pending here because that attempt hit an open
            // exception, so Approve/Deny only make sense as that exception's
            // resolution action, not a routine click on every new request.
            const isPending = req.status === 'Pending';
            const needsReview = isPending && Boolean(openReason);
            const isApproved = req.status === 'Approved';

            approveBtn.style.display = (isAdmin && needsReview) ? 'inline-block' : 'none';
            completeBtn.style.display = (isAdmin && isApproved) ? 'inline-block' : 'none';
            denyBtn.style.display = (isAdmin && needsReview) ? 'inline-block' : 'none';
            editBtn.style.display = isPending ? 'inline-block' : 'none';
            deleteBtn.style.display = isPending ? 'inline-block' : 'none';

            approveBtn.onclick = async () => {
                if (!confirm('Approve this relocation request?')) return;
                await withButtonLoading(approveBtn, async () => {
                    try {
                        const result = await apiRequest(`relocations/${id}/approve`, { method: 'PUT' });
                        if (result.success) {
                            viewModal.style.display = 'none';
                            await refreshAll();
                        } else {
                            alert(result.error);
                        }
                    } catch (error) {
                        alert('Error: ' + error.message);
                    }
                });
            };

            completeBtn.onclick = async () => {
                if (!confirm('Mark this relocation as completed?')) return;
                await withButtonLoading(completeBtn, async () => {
                    try {
                        const result = await apiRequest(`relocations/${id}/complete`, { method: 'PUT' });
                        if (result.success) {
                            viewModal.style.display = 'none';
                            await refreshAll();
                        } else {
                            alert(result.error);
                        }
                    } catch (error) {
                        alert('Error: ' + error.message);
                    }
                });
            };

            denyBtn.onclick = async () => {
                if (!confirm('Deny this relocation request?')) return;
                await withButtonLoading(denyBtn, async () => {
                    try {
                        const result = await apiRequest(`relocations/${id}/deny`, { method: 'PUT' });
                        if (result.success) {
                            viewModal.style.display = 'none';
                            await refreshAll();
                        } else {
                            alert(result.error);
                        }
                    } catch (error) {
                        alert('Error: ' + error.message);
                    }
                });
            };

            editBtn.onclick = () => {
                viewModal.style.display = 'none';
                openEditModal(req);
            };

            deleteBtn.onclick = async () => {
                if (!confirm('Delete this request?')) return;
                try {
                    const result = await apiRequest(`relocations/${id}`, { method: 'DELETE' });
                    if (result.success) {
                        viewModal.style.display = 'none';
                        await refreshAll();
                    } else {
                        alert(result.error);
                    }
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            };

            // System-Wide AI Assistant (Phase 4): mounts with this record's
            // context pre-wired, but no longer auto-asks on open (quota-
            // reduction batch — viewing a relocation request must never
            // cost an LLM call by itself). The admin can still open the
            // panel and ask a question, using this same entity-scoped
            // context.
            initAiAssistant({
                mountSelector: '#aiAssistantMountRecord',
                context: { scope: 'entity', entity_type: 'Relocation', entity_id: id },
                label: 'Ask AI',
            });

            viewModal.style.display = 'flex';
        } catch (error) {
            alert('Failed to load request: ' + error.message);
        }
    }

    function openAddModal() {
        document.getElementById('modalTitle').innerText = 'New Relocation Request';
        document.getElementById('requestForm').reset();
        document.getElementById('requestId').value = '';
        const statusGroup = document.getElementById('statusGroup');
        if (statusGroup) statusGroup.style.display = 'none';
        resetDocumentUpload();
        resetOriginLotFields();
        populateDropdowns();
        requestModal.style.display = 'flex';
    }

    async function openEditModal(req) {
        if (!req) return;
        document.getElementById('modalTitle').innerText = `Edit Relocation Request #REQ-${req.request_id}`;
        document.getElementById('requestId').value = req.request_id;
        document.getElementById('reason').value = req.reason || '';
        const statusGroup = document.getElementById('statusGroup');
        if (statusGroup) {
            statusGroup.style.display = 'block';
            document.getElementById('requestStatus').value = req.status || 'Pending';
        }
        resetDocumentUpload();
        await populateDropdowns(req.deceased_id, req.to_lot_id);
        requestModal.style.display = 'flex';
    }

    // Decedent selection change listener
    const decedentSelectEl = document.getElementById('decedentId');
    if (decedentSelectEl) {
        decedentSelectEl.addEventListener('change', (e) => {
            handleDecedentSelection(e.target.value);
        });
    }

    // Document file change listener (Preview)
    if (relocFileInput) {
        relocFileInput.addEventListener('change', () => {
            const file = relocFileInput.files[0];
            if (!file) {
                resetDocumentUpload();
                return;
            }
            if (relocDropzonePlaceholder) relocDropzonePlaceholder.style.display = 'none';
            if (relocPreviewContainer) relocPreviewContainer.style.display = 'flex';

            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    if (relocPreviewImg) {
                        relocPreviewImg.src = e.target.result;
                        relocPreviewImg.style.display = 'block';
                    }
                    if (relocPreviewPdf) relocPreviewPdf.style.display = 'none';
                };
                reader.readAsDataURL(file);
            } else {
                if (relocPreviewImg) relocPreviewImg.style.display = 'none';
                if (relocPreviewPdf) {
                    relocPreviewPdf.style.display = 'flex';
                    if (relocPdfName) relocPdfName.textContent = file.name;
                }
            }
            if (relocUploadHint) {
                relocUploadHint.textContent = `"${file.name}" ready to attach upon save.`;
            }
        });
    }

    if (clearRelocFileBtn) {
        clearRelocFileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            resetDocumentUpload();
        });
    }

    // AI Extract & Auto-Fill button listener
    if (extractRelocDocBtn) {
        extractRelocDocBtn.addEventListener('click', async () => {
            const file = relocFileInput ? relocFileInput.files[0] : null;
            if (!file) {
                showToast('Please select an exhumation permit or document file first.', { type: 'error' });
                return;
            }

            await withButtonLoading(extractRelocDocBtn, async () => {
                try {
                    const imageBase64 = await readFileAsBase64(file);
                    const payload = { image_base64: imageBase64, mime_type: file.type };

                    const response = await api.request('ai/extract-certificate', {
                        method: 'POST',
                        body: payload,
                    });
                    const result = response && response.result;

                    if (!result || (!result.first_name && !result.last_name)) {
                        showToast("Couldn't read document fields clearly — please select decedent manually.", { type: 'warning' });
                        return;
                    }

                    const searchFirst = (result.first_name || '').toLowerCase().trim();
                    const searchLast = (result.last_name || '').toLowerCase().trim();

                    const matchedDecedent = cachedDecedents.find(d => {
                        const df = (d.first_name || '').toLowerCase().trim();
                        const dl = (d.last_name || '').toLowerCase().trim();
                        if (searchFirst && searchLast) {
                            return (df.includes(searchFirst) || searchFirst.includes(df)) &&
                                   (dl.includes(searchLast) || searchLast.includes(dl));
                        }
                        if (searchLast) return dl === searchLast;
                        if (searchFirst) return df === searchFirst;
                        return false;
                    });

                    const chips = [];
                    if (matchedDecedent && matchedDecedent.lot_id) {
                        const decedentSelect = document.getElementById('decedentId');
                        if (decedentSelect) {
                            decedentSelect.value = matchedDecedent.decedent_id;
                            handleDecedentSelection(matchedDecedent.decedent_id);
                            chips.push(`<span class="extraction-chip"><i class="fas fa-check"></i> Matched: ${escapeHtml(matchedDecedent.first_name)} ${escapeHtml(matchedDecedent.last_name)}</span>`);
                            chips.push(`<span class="extraction-chip"><i class="fas fa-lock"></i> Lot ${escapeHtml(matchedDecedent.lot_number)} Locked</span>`);
                        }
                    } else if (matchedDecedent && !matchedDecedent.lot_id) {
                        chips.push(`<span class="extraction-chip" style="color:#dc2626;"><i class="fas fa-triangle-exclamation"></i> Dec. ${escapeHtml(matchedDecedent.first_name)} has no burial lot</span>`);
                    } else {
                        chips.push(`<span class="extraction-chip"><i class="fas fa-info-circle"></i> Extracted: ${escapeHtml(result.first_name || '')} ${escapeHtml(result.last_name || '')}</span>`);
                    }

                    const reasonInput = document.getElementById('reason');
                    if (reasonInput && !reasonInput.value.trim()) {
                        reasonInput.value = 'Exhumation and relocation requested per attached permit / documentation.';
                        chips.push('<span class="extraction-chip"><i class="fas fa-check"></i> Reason suggested</span>');
                    }

                    if (relocExtractionChips) {
                        relocExtractionChips.innerHTML = chips.join('');
                        relocExtractionChips.style.display = 'flex';
                    }
                    showToast('Document analyzed! Decedent & origin lot updated.', { type: 'success' });
                } catch (err) {
                    console.error('AI extraction failed', err);
                    showToast('Document extraction failed: ' + (err.message || 'Unknown error'), { type: 'error' });
                }
            });
        });
    }

    // Form submission with automated validation & permit document attachment
    document.getElementById('requestForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('requestId').value;
        const decedentId = parseInt(document.getElementById('decedentId').value, 10);
        const fromLotId = parseInt(document.getElementById('fromLotId').value, 10);
        const toLotId = parseInt(document.getElementById('toLotId').value, 10);
        const reason = document.getElementById('reason').value.trim();
        const statusGroup = document.getElementById('statusGroup');
        const statusValue = (statusGroup && statusGroup.style.display !== 'none') ? (document.getElementById('requestStatus').value || 'Pending') : 'Pending';

        if (!decedentId) {
            showToast('Please select a decedent to relocate.', { type: 'error' });
            return;
        }
        if (!fromLotId) {
            showToast('Origin lot could not be determined for the selected decedent.', { type: 'error' });
            return;
        }
        if (!toLotId) {
            showToast('Please select a destination lot.', { type: 'error' });
            return;
        }
        if (fromLotId === toLotId) {
            showToast('Destination lot cannot be the same as the origin lot.', { type: 'error' });
            return;
        }
        if (!reason) {
            showToast('Please enter the reason for relocation / exhumation.', { type: 'error' });
            return;
        }

        const data = {
            deceased_id: decedentId,
            from_lot_id: fromLotId,
            to_lot_id: toLotId,
            reason: reason,
            status: statusValue
        };

        const saveBtn = document.getElementById('saveRequestBtn') || e.target.querySelector('button[type="submit"]');
        await withButtonLoading(saveBtn, async () => {
            try {
                const result = id
                    ? await apiRequest(`relocations/${id}`, { method: 'PUT', body: data })
                    : await apiRequest('relocations', { method: 'POST', body: data });

                if (result.success) {
                    const targetRequestId = id || result.data?.request_id || result.request_id || result.id;

                    // If a permit document was selected in the AI Dropzone, attach it!
                    const file = relocFileInput ? relocFileInput.files[0] : null;
                    if (file && targetRequestId) {
                        try {
                            const formData = new FormData();
                            formData.append('document_file', file);
                            formData.append('document_type', relocDocType ? relocDocType.value : 'exhumation_permit');
                            await apiRequest(`relocations/${targetRequestId}/documents`, {
                                method: 'POST',
                                body: formData
                            });
                        } catch (uploadErr) {
                            console.error('Attached document upload error:', uploadErr);
                            showToast('Relocation saved, but document upload failed: ' + uploadErr.message, { type: 'warning' });
                        }
                    }

                    requestModal.style.display = 'none';
                    document.getElementById('requestForm').reset();
                    resetDocumentUpload();
                    resetOriginLotFields();
                    pagination.reset();
                    await refreshAll();

                    showToast(id ? 'Relocation request updated successfully.' : (result.message || 'Relocation request created and processed.'), { type: 'success' });
                } else {
                    showToast(result.error || 'Failed to save relocation request.', { type: 'error' });
                }
            } catch (error) {
                showToast('Error: ' + error.message, { type: 'error' });
            }
        });
    });

    document.getElementById('openAddModal').addEventListener('click', openAddModal);

    const cancelRequestBtn = document.getElementById('cancelRequestBtn');
    if (cancelRequestBtn) {
        cancelRequestBtn.addEventListener('click', () => {
            requestModal.style.display = 'none';
        });
    }

    document.querySelectorAll('.close, .close-view').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        });
    });
    window.addEventListener('click', (e) => {
        document.querySelectorAll('.modal').forEach(m => {
            if (e.target === m) m.style.display = 'none';
        });
    });

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    await refreshAll();
});
