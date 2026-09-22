// "Phase D": staff-facing list view for citizen cremation bookings — mirrors
// manage-reservations.js's table/filter/pagination/modal pattern (see that
// file for the burial equivalent this was built from). This page does not
// replace cremation-management.html's niche-grid view, which stays for its
// existing admin-direct add/edit/assign/delete workflow.
//
// Cremation module audit, Batch D: the stats row, payment badge, urgency
// tag, and "Needs Review" toggle originally deferred here (Cremation had no
// status-count endpoint, no payment/stale-timestamp data on the list
// response, and no awaiting_confirmation filter) are now at parity with
// manage-reservations.js — see cremations/queue-stats,
// Cremation::LATEST_PAYMENT_SELECT, and the Batch C stale-pending sweep
// that added stale_notified_at/final_warning_notified_at.
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

    const statsEls = {
        pending: document.getElementById('pendingCount'),
        scheduled: document.getElementById('scheduledCount'),
        completed: document.getElementById('completedCount'),
        cancelled: document.getElementById('cancelledCount'),
    };

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
    const toggleAwaitingBtn = document.getElementById('toggleAwaitingConfirmation');
    const awaitingCountBadge = document.getElementById('awaitingConfirmationCount');

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
    let awaitingConfirmationOnly = false;

    // Deep link query parameters support (e.g. from admin dashboard cards)
    const urlParams = new URLSearchParams(window.location.search);
    const initialStatus = urlParams.get('status');
    const initialAwaiting = urlParams.get('awaiting_confirmation');
    const initialQuery = urlParams.get('q');

    if (initialQuery) {
        currentQuery = initialQuery;
        searchQuery.value = initialQuery;
    }
    if (initialAwaiting === '1' || initialAwaiting === 'true') {
        awaitingConfirmationOnly = true;
        toggleAwaitingBtn.setAttribute('aria-pressed', 'true');
        statusFilter.disabled = true;
    } else if (initialStatus) {
        currentStatus = initialStatus;
        statusFilter.value = initialStatus;
    }

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

    // Single source of truth: sync active stat card highlight with current status filter
    function updateActiveStatCards() {
        const activeStatus = awaitingConfirmationOnly ? '' : currentStatus;
        document.querySelectorAll('.mgmtres-stats .stat-card').forEach((card) => {
            const cardStatus = card.getAttribute('data-status');
            const isActive = Boolean(activeStatus) && cardStatus === activeStatus;
            card.classList.toggle('is-active-filter', isActive);
            card.setAttribute('aria-pressed', String(isActive));
        });
    }

    async function setStatusFilter(newStatus) {
        if (awaitingConfirmationOnly) {
            awaitingConfirmationOnly = false;
            toggleAwaitingBtn.setAttribute('aria-pressed', 'false');
            statusFilter.disabled = false;
        }
        currentStatus = newStatus || '';
        statusFilter.value = currentStatus;
        updateActiveStatCards();
        pagination.reset();
        await loadAndRenderCremations();
    }

    function renderActiveFilterChips() {
        renderFilterChips(activeFilterChips, [
            { key: 'q', label: 'Search', value: currentQuery, clear: () => { searchQuery.value = ''; currentQuery = ''; } },
            { key: 'status', label: 'Status', value: currentStatus, clear: () => {
                currentStatus = '';
                statusFilter.value = '';
                updateActiveStatCards();
            } },
            { key: 'awaiting', label: 'Filter', value: awaitingConfirmationOnly ? 'Needs Review' : '', clear: () => {
                awaitingConfirmationOnly = false;
                toggleAwaitingBtn.setAttribute('aria-pressed', 'false');
                statusFilter.disabled = false;
                updateActiveStatCards();
            } },
        ], async () => {
            pagination.reset();
            await loadAndRenderCremations();
        });
    }

    // Cremation module audit, Batch D: mirrors manage-reservations.js's
    // identical buildPaymentBadge() — payment_status/payment_amount/
    // payment_date/payment_receipt_number are now returned directly by GET
    // cremations (Cremation::LATEST_PAYMENT_SELECT).
    function buildPaymentBadge(cremation) {
        const status = cremation.payment_status;
        if (!status) {
            return '<span class="payment-badge none">No payment</span>';
        }
        const normalized = String(status).toLowerCase();
        const known = ['verified', 'pending', 'rejected'];
        const badgeClass = known.includes(normalized) ? normalized : 'none';
        return `<span class="payment-badge ${badgeClass}">${status}</span>`;
    }

    // Cremation module audit, Batch D: mirrors manage-reservations.js's
    // identical buildUrgencyTag() — stale_notified_at/final_warning_notified_at
    // are now populated by the Batch C stale-pending sweep and returned
    // directly by GET cremations (SELECT c.* already includes them).
    function buildUrgencyTag(cremation) {
        if (cremation.status !== 'Pending') return '';
        if (cremation.final_warning_notified_at) {
            return '<span class="urgency-tag urgency-tag--critical" title="Will be auto-cancelled soon if unpaid">Final warning sent</span>';
        }
        if (cremation.stale_notified_at) {
            return '<span class="urgency-tag urgency-tag--warning" title="Reminder sent for lack of payment">Reminder sent</span>';
        }
        return '';
    }

    // Full Automation, Admin-First: a normally-paid cremation no longer
    // needs a manual Complete click — PaymentController::verify() confirms
    // it automatically the moment staff verifies the payment (see
    // AutomationEngine::run() / autoConfirmCremationForVerifiedPayment()).
    // A Pending row only needs admin attention when that automatic step
    // couldn't safely proceed and raised an open system_exceptions entry —
    // mirrors manage-reservations.js's identical buildActionButtons() logic.
    function buildActionButtons(cremation, openExceptionIds) {
        const buttons = [];
        buttons.push(`<button class="btn-row-action" data-action="view" data-id="${cremation.cremation_id}" title="View cremation details"><i class="fas fa-eye"></i> View</button>`);

        if (openExceptionIds.has(cremation.cremation_id)) {
            buttons.push(`<a class="btn-row-action btn-row-action--confirm" href="exceptions.html?entity_type=Cremation&entity_id=${cremation.cremation_id}" title="Review cremation exception"><i class="fas fa-triangle-exclamation"></i> Review</a>`);
        }
        if (cremation.status === 'Scheduled') {
            buttons.push(`<button class="btn-row-action btn-row-action--complete" data-action="complete" data-id="${cremation.cremation_id}" title="Mark cremation completed"><i class="fas fa-circle-check"></i> Complete</button>`);
        }
        // F.1 parity: a Pending request paid in cash/offline never goes
        // through Payment verification, so it never auto-confirms — this is
        // the only way to record it. See CremationController::
        // ensurePaymentForDirectCompletionForCremation() for what this does
        // server-side (creates a real, Verified Payment record too, so it
        // still shows up in Revenue Reports; niche is auto-assigned). Hidden
        // when an exception is already flagged above, matching
        // manage-reservations.js's identical convention — resolve that
        // first rather than offering two competing actions on the same row.
        if (cremation.status === 'Pending' && !openExceptionIds.has(cremation.cremation_id)) {
            buttons.push(`<button class="btn-row-action btn-row-action--cash" data-action="complete-cash" data-id="${cremation.cremation_id}" title="Complete request via cash payment"><i class="fas fa-money-bill-wave"></i> Complete (Cash)</button>`);
        }
        if (cremation.status === 'Pending' || cremation.status === 'Scheduled') {
            buttons.push(`<button class="btn-row-action btn-row-action--cancel" data-action="cancel" data-id="${cremation.cremation_id}" title="Cancel request"><i class="fas fa-xmark"></i> Cancel</button>`);
        }

        return buttons.length ? buttons.join('') : '<span class="muted">No actions</span>';
    }

    function buildCremationRow(cremation, openExceptionIds) {
        const nameCell = (cremation.first_name || cremation.last_name)
            ? `${cremation.first_name || ''} ${cremation.last_name || ''}`
            : (cremation.provisional_name ? `${cremation.provisional_name} <span class="muted">(unregistered)</span>` : 'N/A');
        return `
            <tr data-id="${cremation.cremation_id}">
                <td><strong>Request #${cremation.cremation_id}</strong></td>
                <td>${nameCell}</td>
                <td>${cremation.columbarium || 'N/A'}</td>
                <td>${cremation.niche_number ? `<strong>${escapeHtml(cremation.niche_number)}</strong>` : '<span style="color:#64748b;font-size:0.82rem;font-style:italic;">Not assigned</span>'}</td>
                <td>${cremation.cremation_date || 'N/A'}</td>
                <td>${cremation.created_by_name || 'N/A'}</td>
                <td>${buildStatusBadge(cremation.status)}</td>
                <td>${buildPaymentBadge(cremation)}</td>
                <td class="action-buttons">${buildActionButtons(cremation, openExceptionIds)}</td>
            </tr>
        `;
    }

    async function loadCremations() {
        const params = new URLSearchParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        if (currentQuery.trim()) params.set('q', currentQuery.trim());
        if (awaitingConfirmationOnly) {
            params.set('awaiting_confirmation', '1');
        } else if (currentStatus) {
            params.set('status', currentStatus);
        }
        return await api.request(`cremations?${params.toString()}`, { method: 'GET' });
    }

    async function loadStats() {
        return await api.request('cremations/queue-stats', { method: 'GET' });
    }

    function renderStats(stats) {
        if (!statsEls.pending) return;
        statsEls.pending.textContent = Number(stats && stats.pending) || 0;
        statsEls.scheduled.textContent = Number(stats && stats.scheduled) || 0;
        statsEls.completed.textContent = Number(stats && stats.completed) || 0;
        statsEls.cancelled.textContent = Number(stats && stats.cancelled) || 0;
    }

    // Set of cremation_ids with an OPEN system_exceptions entry — the only
    // Pending rows that still need a human action (see buildActionButtons()).
    async function loadOpenCremationExceptionIds() {
        try {
            const exceptions = await api.request('exceptions?status=open&entity_type=Cremation', { method: 'GET' });
            return new Set((Array.isArray(exceptions) ? exceptions : []).map((exception) => Number(exception.entity_id)));
        } catch (error) {
            console.error('Failed to load open exceptions', error);
            return new Set();
        }
    }

    async function refreshAwaitingConfirmationCount() {
        try {
            const res = await api.request('cremations?awaiting_confirmation=1&per_page=1', { method: 'GET' });
            const count = (res && res.meta && typeof res.meta.total === 'number') ? res.meta.total : 0;
            awaitingCountBadge.textContent = count;
        } catch (e) {
            const openExceptionIds = await loadOpenCremationExceptionIds();
            awaitingCountBadge.textContent = openExceptionIds.size;
        }
    }

    async function loadAndRenderCremations() {
        cremationsBody.innerHTML = '<tr><td colspan="9">Loading cremation requests...</td></tr>';
        try {
            const [result, openExceptionIds] = await Promise.all([loadCremations(), loadOpenCremationExceptionIds()]);
            const data = Array.isArray(result.data) ? result.data : [];
            cremationsBody.innerHTML = data.length > 0
                ? data.map((cremation) => buildCremationRow(cremation, openExceptionIds)).join('')
                : `
                    <tr>
                        <td colspan="9">
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
            cremationsBody.innerHTML = '<tr><td colspan="9">Unable to load cremation requests right now.</td></tr>';
            pagination.render({ page: 1, pages: 1, total: 0 });
        }
    }

    // Batch D: the three stages below are mutually independent reads (stats,
    // the open-exceptions count, and the cremation list itself each hit
    // their own endpoint) — run concurrently so a refresh after any action
    // isn't gated on three round-trips back to back, mirroring
    // manage-reservations.js's identical refreshAll().
    async function refreshAll() {
        updateActiveStatCards();
        await Promise.all([
            loadStats().then(renderStats).catch((error) => console.error('Failed to load cremation stats', error)),
            refreshAwaitingConfirmationCount(),
            loadAndRenderCremations(),
        ]);
        updateActiveStatCards();
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
                    await refreshAll();
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
                    await refreshAll();
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
                detailModalBody.innerHTML = `<p class="text-danger">${escapeHtml(cremation.error)}</p>`;
                return;
            }

            const decedentFullName = (cremation.first_name || cremation.last_name)
                ? `${cremation.first_name || ''} ${cremation.last_name || ''}`.trim()
                : (cremation.provisional_name || 'Unspecified Decedent');
            const isProvisional = !cremation.first_name && !cremation.last_name && Boolean(cremation.provisional_name);

            const paymentStatus = cremation.payment_status || 'Unpaid';
            const normalizedPayment = String(paymentStatus).toLowerCase();
            const isVerified = normalizedPayment === 'verified';
            const isPending = normalizedPayment === 'pending';
            const formattedAmount = cremation.payment_amount
                ? `₱${Number(cremation.payment_amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : '₱0.00';

            const receiptNumber = cremation.payment_receipt_number || 'None on file';
            const paymentDate = cremation.payment_date || 'None';
            const paymentMethod = cremation.payment_method || 'Standard';

            // Clean, readable date formatting
            let formattedDate = cremation.cremation_date || 'Not specified';
            if (cremation.cremation_date) {
                const parts = String(cremation.cremation_date).split('-');
                if (parts.length === 3) {
                    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                    if (!isNaN(d.getTime())) {
                        formattedDate = d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
                    }
                }
            }

            let bookedDate = cremation.created_at || 'Not recorded';
            if (cremation.created_at) {
                const bParts = String(cremation.created_at).split(' ');
                if (bParts.length > 0) {
                    const dParts = bParts[0].split('-');
                    if (dParts.length === 3) {
                        const d = new Date(parseInt(dParts[0], 10), parseInt(dParts[1], 10) - 1, parseInt(dParts[2], 10));
                        if (!isNaN(d.getTime())) {
                            bookedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        }
                    }
                }
            }

            detailModalBody.innerHTML = `
                <div class="res-modal-content">
                    <!-- Top Summary Card: Decedent & Status -->
                    <div class="res-hero-card">
                        <div class="res-hero-main">
                            <span class="res-hero-booking">Request #${escapeHtml(cremation.cremation_id)}</span>
                            <h3 class="res-hero-name">${escapeHtml(decedentFullName)}</h3>
                            <span class="res-hero-type ${isProvisional ? 'is-provisional' : 'is-registered'}">
                                ${isProvisional ? 'Provisional Intake Request' : 'Registered Cemetery Record'}
                            </span>
                        </div>
                        <div class="res-hero-badges">
                            ${buildStatusBadge(cremation.status)}
                        </div>
                    </div>

                    <!-- 1. Cremation & Columbarium Information -->
                    <div class="res-section-card">
                        <h4 class="res-section-title">Cremation &amp; Niche Allocation</h4>
                        <div class="res-grid-fields">
                            <div class="res-field">
                                <span class="res-field-label">Scheduled Cremation Date</span>
                                <strong class="res-field-value res-field-value--highlight">${escapeHtml(formattedDate)}</strong>
                            </div>
                            <div class="res-field">
                                <span class="res-field-label">Columbarium &amp; Niche</span>
                                <strong class="res-field-value">${escapeHtml(cremation.columbarium || 'Unspecified')} &mdash; ${escapeHtml(cremation.niche_number ? 'Niche ' + cremation.niche_number : 'Not yet assigned')}</strong>
                            </div>
                            <div class="res-field">
                                <span class="res-field-label">Ash Storage Location</span>
                                <span class="res-field-value">${escapeHtml(cremation.ash_storage_location || 'Not specified')}</span>
                            </div>
                            <div class="res-field">
                                <span class="res-field-label">Applicant Name</span>
                                <span class="res-field-value">${escapeHtml(cremation.created_by_name || 'Direct Entry')}</span>
                            </div>
                            <div class="res-field">
                                <span class="res-field-label">Date Booked</span>
                                <span class="res-field-value">${escapeHtml(bookedDate)}</span>
                            </div>
                        </div>
                    </div>

                    <!-- 2. Payment Summary -->
                    <div class="res-section-card">
                        <div class="res-section-header">
                            <h4 class="res-section-title">Payment Information</h4>
                            <span class="res-payment-badge ${isVerified ? 'verified' : (isPending ? 'pending' : 'unpaid')}">
                                ${escapeHtml(paymentStatus)}
                            </span>
                        </div>
                        <div class="res-grid-fields">
                            <div class="res-field">
                                <span class="res-field-label">Settlement Amount</span>
                                <strong class="res-field-value res-field-value--amount ${isVerified ? 'text-verified' : ''}">${formattedAmount}</strong>
                            </div>
                            <div class="res-field">
                                <span class="res-field-label">Payment Method</span>
                                <span class="res-field-value">${escapeHtml(paymentMethod)}</span>
                            </div>
                            <div class="res-field">
                                <span class="res-field-label">Official Receipt (OR#)</span>
                                <span class="res-field-value font-mono">${escapeHtml(receiptNumber)}</span>
                            </div>
                            <div class="res-field">
                                <span class="res-field-label">Transaction Date</span>
                                <span class="res-field-value">${escapeHtml(paymentDate)}</span>
                            </div>
                        </div>
                        ${(cremation.status === 'Pending' && !isVerified) ? `
                            <div class="res-inline-action">
                                <span>No verified payment on record yet.</span>
                                <button type="button" class="btn btn-sm btn-primary" id="detailQuickPayBtn">
                                    Record Payment
                                </button>
                            </div>
                        ` : ''}
                    </div>

                    <!-- 3. Notes / Remarks (Only if provided) -->
                    ${cremation.notes ? `
                        <div class="res-section-card res-section-card--notes">
                            <h4 class="res-section-title">Notes &amp; Special Instructions</h4>
                            <p class="res-notes-content">${escapeHtml(cremation.notes)}</p>
                        </div>
                    ` : ''}
                </div>
            `;

            const quickPayBtn = document.getElementById('detailQuickPayBtn');
            if (quickPayBtn) {
                quickPayBtn.addEventListener('click', () => {
                    closeDetailModal();
                    openCashPaymentModal(cremation.cremation_id);
                });
            }
        } catch (error) {
            detailModalBody.innerHTML = '<p class="text-danger">Unable to load cremation details right now.</p>';
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
                    await refreshAll();
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
        updateActiveStatCards();
        await loadAndRenderCremations();
    }, 250);

    searchQuery.addEventListener('input', refreshFiltered);
    statusFilter.addEventListener('change', () => {
        currentStatus = statusFilter.value || '';
        updateActiveStatCards();
        pagination.reset();
        loadAndRenderCremations();
    });

    toggleAwaitingBtn.addEventListener('click', async () => {
        awaitingConfirmationOnly = !awaitingConfirmationOnly;
        toggleAwaitingBtn.setAttribute('aria-pressed', String(awaitingConfirmationOnly));
        // The filter is inherently Pending-only server-side; disable the status
        // dropdown while active so it can't silently conflict with the toggle.
        statusFilter.disabled = awaitingConfirmationOnly;
        updateActiveStatCards();
        pagination.reset();
        await loadAndRenderCremations();
    });

    clearFilters.addEventListener('click', async () => {
        searchQuery.value = '';
        statusFilter.value = '';
        statusFilter.disabled = false;
        currentQuery = '';
        currentStatus = '';
        awaitingConfirmationOnly = false;
        toggleAwaitingBtn.setAttribute('aria-pressed', 'false');
        updateActiveStatCards();
        pagination.reset();
        await loadAndRenderCremations();
    });

    // Quick-filter via stat cards (One Source of Truth — synchronized with statusFilter dropdown & chips)
    document.querySelectorAll('.mgmtres-stats .stat-card').forEach((card) => {
        const cardStatus = card.getAttribute('data-status');
        if (!cardStatus) return;

        function triggerQuickFilter() {
            const targetStatus = (!awaitingConfirmationOnly && currentStatus === cardStatus) ? '' : cardStatus;
            setStatusFilter(targetStatus);
        }

        card.addEventListener('click', triggerQuickFilter);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                triggerQuickFilter();
            }
        });
    });

    await refreshAll();
});

(function initFooter() {
    const yearEl = document.getElementById('footerYear');
    if (yearEl) yearEl.textContent = new Date().getFullYear();
    const timeEl = document.getElementById('footerLiveTime');
    const pulseEl = document.querySelector('.footer-pulse-ring');
    function stampFooterTime() {
        const now = new Date();
        const formatted = now.toLocaleString('en-PH', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
        if (timeEl) timeEl.textContent = formatted;
        if (pulseEl) pulseEl.style.display = 'block';
    }
    stampFooterTime();
    window.stampFooterTime = stampFooterTime;
})();
