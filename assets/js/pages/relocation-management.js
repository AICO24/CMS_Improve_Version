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

    async function populateDropdowns() {
        try {
            const decedents = await apiRequest('decedents');
            const lots = await apiRequest('lots');

            const decedentSelect = document.getElementById('decedentId');
            decedentSelect.innerHTML = '<option value="">Select decedent</option>' +
                decedents.map(d => `<option value="${d.decedent_id}">${d.first_name} ${d.last_name}</option>`).join('');

            const fromLotSelect = document.getElementById('fromLotId');
            fromLotSelect.innerHTML = '<option value="">Select current lot</option>' +
                lots.map(l => `<option value="${l.lot_id}">${l.lot_number} (${l.section_name})</option>`).join('');

            const toLotSelect = document.getElementById('toLotId');
            toLotSelect.innerHTML = '<option value="">Select destination lot</option>' +
                lots.filter(l => l.status === 'Available').map(l => `<option value="${l.lot_id}">${l.lot_number} (${l.section_name})</option>`).join('');
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
        document.getElementById('requestStatus').value = 'Pending';
        populateDropdowns();
        requestModal.style.display = 'flex';
    }

    async function openEditModal(req) {
        if (!req) return;
        document.getElementById('modalTitle').innerText = 'Edit Relocation Request';
        document.getElementById('requestId').value = req.request_id;
        document.getElementById('decedentId').value = req.deceased_id;
        document.getElementById('fromLotId').value = req.from_lot_id;
        document.getElementById('toLotId').value = req.to_lot_id;
        document.getElementById('reason').value = req.reason;
        document.getElementById('requestStatus').value = req.status;
        await populateDropdowns();
        requestModal.style.display = 'flex';
    }

    document.getElementById('requestForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('requestId').value;
        const statusValue = document.getElementById('requestStatus').value || 'Pending';
        const statusMap = {
            pending: 'Pending',
            approved: 'Approved',
            completed: 'Completed',
            denied: 'Denied'
        };
        const data = {
            deceased_id: parseInt(document.getElementById('decedentId').value, 10),
            from_lot_id: parseInt(document.getElementById('fromLotId').value, 10),
            to_lot_id: parseInt(document.getElementById('toLotId').value, 10),
            reason: document.getElementById('reason').value.trim(),
            status: statusMap[statusValue.toLowerCase()] || 'Pending'
        };

        if (!data.deceased_id || !data.from_lot_id || !data.to_lot_id || !data.reason) {
            alert('Please fill in all required fields.');
            return;
        }

        const saveBtn = e.target.querySelector('button[type="submit"]');
        await withButtonLoading(saveBtn, async () => {
            try {
                const result = id
                    ? await apiRequest(`relocations/${id}`, { method: 'PUT', body: data })
                    : await apiRequest('relocations', { method: 'POST', body: data });
                if (result.success) {
                    requestModal.style.display = 'none';
                    document.getElementById('requestForm').reset();
                    pagination.reset();
                    await refreshAll();
                    // New requests auto-approve immediately (see
                    // RelocationController::store()) — reflect the real
                    // outcome instead of a generic "saved" message.
                    alert(id ? 'Relocation request saved successfully.' : (result.message || 'Relocation request saved successfully.'));
                } else {
                    alert(result.error || 'Failed to save request');
                }
            } catch (error) {
                alert('Error: ' + error.message);
            }
        });
    });

    document.getElementById('openAddModal').addEventListener('click', openAddModal);
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
