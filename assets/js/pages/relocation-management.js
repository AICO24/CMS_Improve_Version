document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    const statsEls = {
        pending: document.getElementById('pendingCount'),
        approved: document.getElementById('approvedCount'),
        completed: document.getElementById('completedCount'),
        total: document.getElementById('totalCount')
    };
    const tbody = document.getElementById('requestsTableBody');
    const requestModal = document.getElementById('requestModal');
    const viewModal = document.getElementById('viewModal');

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
        return await apiRequest(`relocations?${params.toString()}`);
    }

    async function loadStats() {
        return await apiRequest('relocations/stats');
    }

    function renderStats(stats) {
        statsEls.pending.innerText = stats.pending || 0;
        statsEls.approved.innerText = stats.approved || 0;
        statsEls.completed.innerText = stats.completed || 0;
        statsEls.total.innerText = stats.total || 0;
    }

    async function loadAndRenderRequests() {
        try {
            const result = await loadRequests();
            const requests = Array.isArray(result.data) ? result.data : [];
            renderTable(requests);
            pagination.render(result.meta || { page: 1, total_pages: 1, total: requests.length });
        } catch (error) {
            console.error('Failed to load relocation requests', error);
            tbody.innerHTML = '<tr><td colspan="7">Failed to load requests. Please refresh.</td></tr>';
            pagination.render({ page: 1, total_pages: 1, total: 0 });
        }
    }

    function renderTable(requests) {
        if (!Array.isArray(requests) || requests.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="reloc-empty-state">
                            <i class="fas fa-truck-moving"></i>
                            <strong>No relocation requests found</strong>
                            <span>New relocation requests will appear here.</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = requests.map(req => `
            <tr data-id="${req.request_id}">
                <td>REQ-${req.request_id}</td>
                <td>${req.first_name} ${req.last_name}</td>
                <td>${req.from_lot_number}</td>
                <td>${req.to_lot_number}</td>
                <td>${req.reason.substring(0, 40)}${req.reason.length > 40 ? '...' : ''}</td>
                <td><span class="status-badge status-${req.status.toLowerCase()}">${req.status}</span></td>
                <td class="action-buttons">
                    <button class="btn-view-request" title="View Details"><i class="fas fa-eye"></i></button>
                </td>
            </tr>
        `).join('');

        tbody.querySelectorAll('.btn-view-request').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.closest('tr').dataset.id;
                showViewModal(id);
            });
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

            // System-Wide AI Assistant (Phase 4): replaces the old one-shot
            // "Ask AI to explain" button — fired immediately so the
            // explanation still appears right away, now with real follow-up
            // support instead of a single static message.
            const assistant = initAiAssistant({
                mountSelector: '#aiAssistantMount',
                context: { scope: 'entity', entity_type: 'Relocation', entity_id: id },
                label: 'Ask AI',
            });
            if (assistant) {
                assistant.askDirectly('Explain the current status and history of this record, and suggest what I should do next if anything needs attention.');
            }

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
