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
            const rowDue = cremation.payment_amount || cremation.price || cremation.total_amount || '';
            buttons.push(`<button class="btn-row-action btn-row-action--cash" data-action="complete-cash" data-id="${cremation.cremation_id}" data-amount="${rowDue}" title="Complete request via cash payment"><i class="fas fa-money-bill-wave"></i> Complete (Cash)</button>`);
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

    // F.1: High-Precision Split-Deck Counter Payment Engine
    let currentAmountDue = 0;

    const cashStubTenderedDisplay = document.getElementById('cashStubTenderedDisplay');
    const cashStubChangeDisplay = document.getElementById('cashStubChangeDisplay');

    function updateCashCalculation() {
        const tendered = parseFloat(cashPaymentAmount.value) || 0;
        if (cashStubTenderedDisplay) {
            cashStubTenderedDisplay.textContent = `₱${tendered.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
        }
        if (cashStubChangeDisplay) {
            const change = Math.max(0, tendered - currentAmountDue);
            cashStubChangeDisplay.textContent = `₱${change.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            if (tendered < currentAmountDue && tendered > 0) {
                const diff = currentAmountDue - tendered;
                cashStubChangeDisplay.innerHTML = `<span style="font-size:0.85rem; color:#dc2626;">Underpaid: -₱${diff.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`;
            }
        }
    }

    cashPaymentAmount.addEventListener('input', updateCashCalculation);

    // Wire up denomination chips
    document.querySelectorAll('.btn-denom-chip[data-amount]').forEach((chip) => {
        chip.addEventListener('click', () => {
            const addVal = parseFloat(chip.getAttribute('data-amount')) || 0;
            const curVal = parseFloat(cashPaymentAmount.value) || 0;
            cashPaymentAmount.value = (curVal + addVal).toFixed(2);
            updateCashCalculation();
        });
    });

    const btnExact = document.getElementById('btnExactAmount');
    if (btnExact) {
        btnExact.addEventListener('click', () => {
            if (currentAmountDue > 0) {
                cashPaymentAmount.value = currentAmountDue.toFixed(2);
                updateCashCalculation();
            }
        });
    }

    function openCashPaymentModal(id, amountDue = 0) {
        cashPaymentCremationId.value = id;
        currentAmountDue = parseFloat(amountDue) || 0;
        cashPaymentAmount.value = currentAmountDue > 0 ? currentAmountDue.toFixed(2) : '';
        cashPaymentMethod.value = 'Cash';
        cashPaymentReceipt.value = '';
        updateCashCalculation();
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

    function computeCremationCountdown(cremationDateStr) {
        if (!cremationDateStr) return 'Date Pending';
        const parts = String(cremationDateStr).split('-');
        if (parts.length !== 3) return 'Scheduled';
        const sched = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        sched.setHours(0, 0, 0, 0);
        const diffDays = Math.round((sched.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) return `${Math.abs(diffDays)} days past`;
        if (diffDays === 0) return 'Today';
        if (diffDays === 1) return 'Tomorrow';
        return `In ${diffDays} days`;
    }

    async function viewCremation(id) {
        detailModalBody.innerHTML = `
            <div class="resmodal-loading" style="padding: 40px 20px; text-align: center; color: #0f766e;">
                <i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; margin-bottom: 12px; display: block;"></i>
                <span style="font-weight: 700;">Loading cremation dossier...</span>
            </div>
        `;
        detailModal.style.display = 'flex';
        try {
            const cremation = await api.request(`cremations/${id}`, { method: 'GET' });
            if (cremation.error) {
                detailModalBody.innerHTML = `
                    <div class="resmodal-error" style="padding: 40px 20px; text-align: center; color: #dc2626;">
                        <i class="fas fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 8px;"></i>
                        <span style="display: block; font-weight: 700;">${escapeHtml(cremation.error)}</span>
                    </div>
                `;
                return;
            }

            const decedentFullName = (cremation.first_name || cremation.last_name)
                ? `${cremation.first_name || ''} ${cremation.last_name || ''}`.trim()
                : (cremation.provisional_name || 'Unassigned Decedent');
            const isProvisional = !cremation.first_name && !cremation.last_name && Boolean(cremation.provisional_name);

            const paymentStatus = cremation.payment_status || 'Unpaid';
            const normalizedPayment = String(paymentStatus).toLowerCase();
            const isVerified = normalizedPayment === 'verified';
            const isPending = normalizedPayment === 'pending';
            const formattedAmount = cremation.payment_amount
                ? `₱${Number(cremation.payment_amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : (cremation.price ? `₱${Number(cremation.price).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '₱0.00');

            const receiptNumber = cremation.payment_receipt_number || 'Auto-generated upon cashiering';
            const paymentDate = cremation.payment_date || 'Pending';
            const paymentMethod = cremation.payment_method || 'Standard';

            // Clean, readable date formatting
            let formattedDate = cremation.cremation_date || 'Not specified';
            if (cremation.cremation_date) {
                const parts = String(cremation.cremation_date).split('-');
                if (parts.length === 3) {
                    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                    if (!isNaN(d.getTime())) {
                        formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
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

            const countdownText = computeCremationCountdown(cremation.cremation_date);
            const detailBadge = document.getElementById('detailCremationBadge');
            if (detailBadge) {
                detailBadge.textContent = `Request #${cremation.cremation_id}`;
            }

            const nicheDisplay = cremation.niche_number ? `NICHE ${escapeHtml(cremation.niche_number)}` : 'PENDING ALLOCATION';
            const columbariumName = cremation.columbarium || 'General Sanctuary Wing';

            detailModalBody.innerHTML = `
                <div class="split-deck-body">
                    <!-- LEFT DECK: Profile & Ceremonial Dossier -->
                    <div class="deck-col deck-col--dossier">
                        <div class="deck-section-title">
                            <i class="fas fa-id-card"></i>
                            <span>Cremation &amp; Decedent Dossier</span>
                        </div>

                        <div class="res-dossier-card">
                            <div class="res-profile-header">
                                <div class="res-profile-avatar" style="background: rgba(20, 184, 166, 0.15); color: #0f766e;">
                                    <i class="fas fa-fire-burner"></i>
                                </div>
                                <div class="res-profile-meta">
                                    <h4 class="res-profile-name">${escapeHtml(decedentFullName)}</h4>
                                    <span class="res-type-pill ${isProvisional ? 'res-type-pill--provisional' : 'res-type-pill--registered'}">
                                        <i class="fas ${isProvisional ? 'fa-hourglass-half' : 'fa-certificate'}"></i>
                                        ${isProvisional ? 'Provisional Request' : 'Registered Record'}
                                    </span>
                                </div>
                            </div>

                            <div class="res-data-grid">
                                <div class="res-data-item">
                                    <span class="res-data-label">Applicant / Kin</span>
                                    <strong class="res-data-value">${escapeHtml(cremation.created_by_name || 'Direct Entry')}</strong>
                                </div>
                                <div class="res-data-item">
                                    <span class="res-data-label">Ash Storage</span>
                                    <span class="res-data-value">${escapeHtml(cremation.ash_storage_location || 'Columbarium Niche')}</span>
                                </div>
                                <div class="res-data-item">
                                    <span class="res-data-label">Intake Date</span>
                                    <span class="res-data-value">${escapeHtml(bookedDate)}</span>
                                </div>
                                <div class="res-data-item">
                                    <span class="res-data-label">Cremation Status</span>
                                    <span class="res-data-value">${buildStatusBadge(cremation.status)}</span>
                                </div>
                            </div>

                            ${cremation.notes ? `
                                <div class="res-notes-box">
                                    <i class="fas fa-quote-left"></i>
                                    <span>${escapeHtml(cremation.notes)}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- RIGHT DECK: Columbarium Sanctuary Digital Twin -->
                    <div class="deck-col deck-col--twin">
                        <div class="deck-section-title">
                            <i class="fas fa-place-of-worship"></i>
                            <span>Sanctuary Twin &amp; Niche Locator</span>
                        </div>

                        <div class="crem-twin-card">
                            <div class="res-twin-top">
                                <div class="res-twin-locator" style="color: #0f766e;">
                                    <i class="fas fa-layer-group"></i>
                                    <span>${escapeHtml(columbariumName)}</span>
                                </div>
                                <span class="res-countdown-chip" style="color: #0f766e; border-color: #2dd4bf;">
                                    <i class="fas fa-clock"></i>
                                    <span>${escapeHtml(countdownText)}</span>
                                </span>
                            </div>

                            <div class="res-twin-plot-badge">
                                <span class="crem-plot-monogram">${escapeHtml(nicheDisplay)}</span>
                            </div>

                            <div class="res-twin-schedule-strip">
                                <i class="fas fa-calendar-day" style="color: #0d9488;"></i>
                                <div>
                                    <strong>Scheduled Service:</strong>
                                    <span> ${escapeHtml(formattedDate)}</span>
                                </div>
                            </div>

                            <div class="res-twin-valuation-card">
                                <div>
                                    <span class="deck-kicker" style="color: #0f766e;">Settlement Fee</span>
                                    <div class="res-val-amount">${formattedAmount}</div>
                                </div>
                                <div class="res-val-meta">
                                    <span class="deck-badge ${isVerified ? 'deck-badge--teal' : 'deck-badge--gold'}">
                                        <i class="fas ${isVerified ? 'fa-circle-check' : 'fa-receipt'}"></i>
                                        ${escapeHtml(paymentStatus)}
                                    </span>
                                    <span class="small muted" style="font-family: monospace; font-size: 0.72rem; margin-top: 4px;">OR# ${escapeHtml(receiptNumber)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;

            // Setup footer actions
            const actionsRight = document.getElementById('detailModalActionsRight');
            if (actionsRight) {
                actionsRight.innerHTML = '';
                if (cremation.status === 'Pending' && !isVerified) {
                    const payBtn = document.createElement('button');
                    payBtn.type = 'button';
                    payBtn.className = 'btn-deck-primary btn-deck-teal';
                    payBtn.innerHTML = '<i class="fas fa-hand-holding-dollar"></i> <span>Settle Payment</span>';
                    payBtn.addEventListener('click', () => {
                        closeDetailModal();
                        const rawAmt = cremation.payment_amount || cremation.price || 0;
                        openCashPaymentModal(cremation.cremation_id, rawAmt);
                    });
                    actionsRight.appendChild(payBtn);
                }

                const closeBtn = document.createElement('button');
                closeBtn.type = 'button';
                closeBtn.className = 'btn-deck-primary btn-deck-teal';
                closeBtn.innerHTML = '<i class="fas fa-check"></i> <span>Done</span>';
                closeBtn.addEventListener('click', closeDetailModal);
                actionsRight.appendChild(closeBtn);
            }
        } catch (error) {
            console.error('Failed to load cremation details', error);
            detailModalBody.innerHTML = `
                <div class="resmodal-error" style="padding: 40px 20px; text-align: center; color: #dc2626;">
                    <i class="fas fa-circle-exclamation" style="font-size: 2rem; margin-bottom: 8px;"></i>
                    <span style="display: block; font-weight: 700;">Unable to load cremation details right now.</span>
                </div>
            `;
        }
    }

    function closeDetailModal() {
        detailModal.style.display = 'none';
    }

    const closeDetailModalTop = document.getElementById('closeDetailModal');
    if (closeDetailModalTop) {
        closeDetailModalTop.addEventListener('click', closeDetailModal);
    }
    const closeDetailModalBtn = document.getElementById('closeDetailModalBtn');
    if (closeDetailModalBtn) {
        closeDetailModalBtn.addEventListener('click', closeDetailModal);
    }
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
        else if (action === 'complete-cash') {
            const rowAmt = parseFloat(button.getAttribute('data-amount')) || 0;
            openCashPaymentModal(id, rowAmt);
        }
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
