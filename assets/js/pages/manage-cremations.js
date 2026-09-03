// "Phase D": staff-facing list view for citizen cremation bookings — mirrors
// manage-reservations.js's table/filter/pagination/modal pattern (see that
// file for the burial equivalent this was built from). Deliberately a
// *subset* of that page's features: no stats row (Cremation has no
// Schedule::stats()-equivalent status-count endpoint — cremations/stats is
// the niche-grid page's occupancy-rate endpoint, a different shape), no
// payment badge / urgency tag (Cremation.php's SELECT doesn't join payment
// info or stale/final-warning timestamps — the stale-Pending sweep was
// deliberately deferred for Cremation in Phase B), and no "Needs Review"
// toggle (no awaiting_confirmation filter on GET cremations). A plain
// Exceptions link in the toolbar covers discoverability instead. This page
// does not replace cremation-management.html's niche-grid view, which stays
// for its existing admin-direct add/edit/assign/delete workflow.
document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin', 'staff']);
    if (!user) return;

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Cremation' },
        greeting: "Hello! I'm your AI assistant for Cremation management. How can I help you today?",
        suggestions: [
            { icon: 'fa-list-check', label: 'Pending requests', question: 'How many cremation requests are pending right now?' },
            { icon: 'fa-triangle-exclamation', label: 'Any exceptions?', question: 'Are there any open cremation exceptions I need to review?' },
            { icon: 'fa-circle-question', label: 'How does niche assignment work?', question: 'How and when is a niche assigned to a cremation?' },
        ],
    });

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    const searchQuery = document.getElementById('searchQuery');
    const statusFilter = document.getElementById('statusFilter');
    const clearFilters = document.getElementById('clearFilters');
    const activeFilterChips = document.getElementById('activeFilterChips');
    const cremationsBody = document.getElementById('cremationsBody');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');

    const detailModal = document.getElementById('cremationDetailModal');
    const detailModalBody = document.getElementById('cremationDetailBody');
    const cashModal = document.getElementById('cashPaymentModal');
    const cashPaymentForm = document.getElementById('cashPaymentForm');
    const cashPaymentCremationId = document.getElementById('cashPaymentCremationId');
    const cashPaymentAmount = document.getElementById('cashPaymentAmount');
    const cashPaymentMethod = document.getElementById('cashPaymentMethod');
    const cashPaymentReceipt = document.getElementById('cashPaymentReceipt');

    const perPage = 10;
    let currentQuery = '';
    let currentStatus = '';

    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        infoEl: paginationInfo,
        itemLabel: 'cremation request',
        onChange: loadAndRenderCremations,
    });

    const { escapeHtml, buildStatusBadge, debounce, renderFilterChips } = window.reservationUI;

    function renderActiveFilterChips() {
        renderFilterChips(activeFilterChips, [
            { key: 'q', label: 'Search', value: currentQuery, clear: () => { searchQuery.value = ''; currentQuery = ''; } },
            { key: 'status', label: 'Status', value: currentStatus, clear: () => { statusFilter.value = ''; currentStatus = ''; } },
        ], async () => {
            pagination.reset();
            await loadAndRenderCremations();
        });
    }

    function buildActionButtons(cremation) {
        const buttons = [];
        buttons.push(`<button class="btn-row-action" data-action="view" data-id="${cremation.cremation_id}">View</button>`);

        if (cremation.status === 'Scheduled') {
            buttons.push(`<button class="btn-row-action btn-row-action--complete" data-action="complete" data-id="${cremation.cremation_id}">Complete</button>`);
        }
        // F.1 parity: a Pending request paid in cash/offline never goes
        // through Payment verification, so it never auto-confirms — this is
        // the only way to record it. See CremationController::
        // ensurePaymentForDirectCompletionForCremation() for what this does
        // server-side (creates a real, Verified Payment record too, so it
        // still shows up in Revenue Reports; niche is auto-assigned).
        if (cremation.status === 'Pending') {
            buttons.push(`<button class="btn-row-action btn-row-action--complete" data-action="complete-cash" data-id="${cremation.cremation_id}">Complete (Cash)</button>`);
        }
        if (cremation.status === 'Pending' || cremation.status === 'Scheduled') {
            buttons.push(`<button class="btn-row-action btn-row-action--cancel" data-action="cancel" data-id="${cremation.cremation_id}">Cancel</button>`);
        }

        return buttons.length ? buttons.join('') : '<span class="muted">No actions</span>';
    }

    function buildCremationRow(cremation) {
        const nameCell = (cremation.first_name || cremation.last_name)
            ? `${cremation.first_name || ''} ${cremation.last_name || ''}`
            : (cremation.provisional_name ? `${cremation.provisional_name} <span class="muted">(unregistered)</span>` : 'N/A');
        return `
            <tr data-id="${cremation.cremation_id}">
                <td><strong>Request #${cremation.cremation_id}</strong></td>
                <td>${nameCell}</td>
                <td>${cremation.columbarium || 'N/A'}</td>
                <td>${cremation.niche_number || '&mdash;'}</td>
                <td>${cremation.cremation_date || 'N/A'}</td>
                <td>${cremation.created_by_name || 'N/A'}</td>
                <td>${buildStatusBadge(cremation.status)}</td>
                <td class="action-buttons">${buildActionButtons(cremation)}</td>
            </tr>
        `;
    }

    async function loadCremations() {
        const params = new URLSearchParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        if (currentQuery.trim()) params.set('q', currentQuery.trim());
        if (currentStatus) params.set('status', currentStatus);
        return await api.request(`cremations?${params.toString()}`, { method: 'GET' });
    }

    async function loadAndRenderCremations() {
        cremationsBody.innerHTML = '<tr><td colspan="8">Loading cremation requests...</td></tr>';
        try {
            const result = await loadCremations();
            const data = Array.isArray(result.data) ? result.data : [];
            cremationsBody.innerHTML = data.length > 0
                ? data.map((cremation) => buildCremationRow(cremation)).join('')
                : `
                    <tr>
                        <td colspan="8">
                            <div class="mgmtres-empty-state">
                                <i class="fas fa-fire"></i>
                                <strong>No cremation requests found</strong>
                                <span>Adjust the filters to see more requests.</span>
                            </div>
                        </td>
                    </tr>
                `;
            renderActiveFilterChips();
            pagination.render(result.meta || { page: 1, pages: 1, total: data.length });
        } catch (error) {
            console.error('Failed to load cremation requests', error);
            cremationsBody.innerHTML = '<tr><td colspan="8">Unable to load cremation requests right now.</td></tr>';
            pagination.render({ page: 1, pages: 1, total: 0 });
        }
    }

    async function completeCremation(id, button) {
        const confirmed = await confirmDialog({
            title: 'Complete cremation?',
            message: 'Mark this cremation as completed? A niche will be auto-assigned.',
            confirmLabel: 'Mark completed',
        });
        if (!confirmed) return;
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(`cremations/${id}`, { method: 'PUT', body: { status: 'Completed' } });
                if (result.success) {
                    showToast('Cremation marked completed.', { type: 'success' });
                    await loadAndRenderCremations();
                } else {
                    showToast(result.error || 'Unable to complete cremation.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Unable to complete cremation.', { type: 'error' });
            }
        });
    }

    function openCashPaymentModal(id) {
        cashPaymentCremationId.value = id;
        cashPaymentAmount.value = '';
        cashPaymentMethod.value = 'Cash';
        cashPaymentReceipt.value = '';
        cashModal.style.display = 'flex';
        cashPaymentAmount.focus();
    }

    function closeCashPaymentModal() {
        cashModal.style.display = 'none';
    }

    cashPaymentForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        const id = cashPaymentCremationId.value;
        const amount = parseFloat(cashPaymentAmount.value);
        if (isNaN(amount) || amount <= 0) {
            showToast('Please enter a valid payment amount.', { type: 'error' });
            return;
        }
        const method = cashPaymentMethod.value;
        const receiptNumber = cashPaymentReceipt.value.trim();

        const submitBtn = document.getElementById('submitCashPayment');
        await withButtonLoading(submitBtn, async () => {
            try {
                const result = await api.request(`cremations/${id}`, {
                    method: 'PUT',
                    body: {
                        status: 'Completed',
                        payment_amount: amount,
                        payment_method: method,
                        receipt_number: receiptNumber,
                    },
                });
                if (result.success) {
                    closeCashPaymentModal();
                    showToast('Payment recorded and cremation completed.', { type: 'success' });
                    await loadAndRenderCremations();
                } else {
                    showToast(result.error || 'Unable to complete cremation.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Unable to complete cremation.', { type: 'error' });
            }
        });
    });

    document.getElementById('closeCashModal').addEventListener('click', closeCashPaymentModal);
    document.getElementById('cancelCashModal').addEventListener('click', closeCashPaymentModal);
    cashModal.addEventListener('click', (event) => {
        if (event.target === cashModal) closeCashPaymentModal();
    });

    async function viewCremation(id) {
        detailModalBody.innerHTML = '<p>Loading...</p>';
        detailModal.style.display = 'flex';
        try {
            const cremation = await api.request(`cremations/${id}`, { method: 'GET' });
            if (cremation.error) {
                detailModalBody.innerHTML = `<p>${escapeHtml(cremation.error)}</p>`;
                return;
            }
            const nameCell = (cremation.first_name || cremation.last_name)
                ? `${cremation.first_name || ''} ${cremation.last_name || ''}`
                : (cremation.provisional_name ? `${cremation.provisional_name} (unregistered)` : 'N/A');
            detailModalBody.innerHTML = `
                <div class="form-group"><label>Request</label>#${escapeHtml(cremation.cremation_id)} &mdash; ${buildStatusBadge(cremation.status)}</div>
                <div class="form-group"><label>Decedent</label>${escapeHtml(nameCell)}</div>
                <div class="form-group"><label>Columbarium</label>${escapeHtml(cremation.columbarium || 'N/A')}</div>
                <div class="form-group"><label>Niche</label>${escapeHtml(cremation.niche_number || 'Not yet assigned')}</div>
                <div class="form-group"><label>Cremation date</label>${escapeHtml(cremation.cremation_date || 'N/A')}</div>
                <div class="form-group"><label>Requested by</label>${escapeHtml(cremation.created_by_name || 'N/A')}</div>
                <div class="form-group"><label>Notes</label>${escapeHtml(cremation.notes || 'None')}</div>
            `;
        } catch (error) {
            detailModalBody.innerHTML = '<p>Unable to load cremation details right now.</p>';
        }
    }

    function closeDetailModal() {
        detailModal.style.display = 'none';
    }

    document.getElementById('closeDetailModal').addEventListener('click', closeDetailModal);
    document.getElementById('closeDetailModalBtn').addEventListener('click', closeDetailModal);
    detailModal.addEventListener('click', (event) => {
        if (event.target === detailModal) closeDetailModal();
    });

    // Soft cancel (PUT status: 'Cancelled'), not DELETE — preserves history,
    // mirrors manage-reservations.js. The old niche-grid page's own "Delete
    // Record" button is untouched and still hard-deletes for its existing
    // admin-direct workflow.
    async function cancelCremation(id, button) {
        const confirmed = await confirmDialog({
            title: 'Cancel cremation request?',
            message: 'This will cancel the cremation request. This cannot be undone.',
            confirmLabel: 'Cancel request',
            cancelLabel: 'Keep request',
            danger: true,
        });
        if (!confirmed) return;
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(`cremations/${id}`, { method: 'PUT', body: { status: 'Cancelled' } });
                if (result.success) {
                    showToast('Cremation request cancelled.', { type: 'success' });
                    await loadAndRenderCremations();
                } else {
                    showToast(result.error || 'Unable to cancel cremation request.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Unable to cancel cremation request.', { type: 'error' });
            }
        });
    }

    cremationsBody.addEventListener('click', async function(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const id = button.getAttribute('data-id');
        const action = button.getAttribute('data-action');
        if (!id || !action) return;

        if (action === 'view') await viewCremation(id);
        else if (action === 'complete') await completeCremation(id, button);
        else if (action === 'complete-cash') openCashPaymentModal(id);
        else if (action === 'cancel') await cancelCremation(id, button);
    });

    const refreshFiltered = debounce(async () => {
        pagination.reset();
        currentQuery = searchQuery.value || '';
        currentStatus = statusFilter.value || '';
        await loadAndRenderCremations();
    }, 250);

    searchQuery.addEventListener('input', refreshFiltered);
    statusFilter.addEventListener('change', refreshFiltered);

    clearFilters.addEventListener('click', async () => {
        searchQuery.value = '';
        statusFilter.value = '';
        currentQuery = '';
        currentStatus = '';
        pagination.reset();
        await loadAndRenderCremations();
    });

    await loadAndRenderCremations();
});
