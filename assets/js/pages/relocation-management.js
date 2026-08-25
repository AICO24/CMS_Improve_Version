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
    const aiExplanationEl = document.getElementById('aiExplanation');
    const askAiExplainBtn = document.getElementById('askAiExplainBtn');

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

    async function refreshAll() {
        try {
            const stats = await loadStats();
            renderStats(stats);
        } catch (error) {
            console.error('Failed to load relocation stats', error);
        }
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
            `;
            document.getElementById('viewDetails').innerHTML = details;

            const approveBtn = document.getElementById('approveBtn');
            const completeBtn = document.getElementById('completeBtn');
            const denyBtn = document.getElementById('denyBtn');
            const editBtn = document.getElementById('editFromView');
            const deleteBtn = document.getElementById('deleteFromView');

            const isAdmin = user.role === 'admin';
            const isPending = req.status === 'Pending';
            const isApproved = req.status === 'Approved';

            approveBtn.style.display = (isAdmin && isPending) ? 'inline-block' : 'none';
            completeBtn.style.display = (isAdmin && isApproved) ? 'inline-block' : 'none';
            denyBtn.style.display = (isAdmin && isPending) ? 'inline-block' : 'none';
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

            aiExplanationEl.style.display = 'none';
            aiExplanationEl.textContent = '';
            askAiExplainBtn.onclick = async () => {
                await withButtonLoading(askAiExplainBtn, async () => {
                    try {
                        const result = await apiRequest('ai/explain-entity', {
                            method: 'POST',
                            body: { entity_type: 'Relocation', entity_id: id },
                        });
                        if (result && result.explained && result.message) {
                            aiExplanationEl.textContent = result.message;
                        } else {
                            aiExplanationEl.textContent = 'AI explanation is unavailable right now.';
                        }
                    } catch (error) {
                        aiExplanationEl.textContent = 'AI explanation is unavailable right now.';
                    }
                    aiExplanationEl.style.display = 'block';
                });
            };

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
                    alert('Relocation request saved successfully.');
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
