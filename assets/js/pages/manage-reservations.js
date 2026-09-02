document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin', 'staff']);
    if (!user) return;

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    // System-Wide AI Assistant: module-scoped, since a page load here has
    // no single reservation selected yet. AI Architecture Audit (2026-09-02)
    // finding: this does NOT currently have system-wide reach — per Batch 3's
    // quota-reduction change, AiController::askAssistant() only attaches
    // AuditIntelligenceService::buildSystemWideReach() when scope==='system'
    // (see ai-assistant-widget.js's own header comment). A question about a
    // different module, asked from here, gets "I don't have visibility into
    // that" rather than a real answer until BATCH AI-2 (tiered focus-then-
    // escalate fetch) ships. This comment previously claimed the opposite —
    // corrected as part of that audit's foundation-cleanup batch (AI-1).
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Schedule' },
        greeting: "Hello! I'm your AI assistant for Burial Scheduling. How can I help you today?",
        suggestions: [
            { icon: 'fa-list-check', label: 'Pending reservations', question: 'How many reservations are pending right now, and why?' },
            { icon: 'fa-triangle-exclamation', label: 'Any exceptions?', question: 'Are there any open exceptions I need to review?' },
            // Batch H (reservation module audit): grounded in the same
            // stale_notified_at/final_warning_notified_at facts the
            // deterministic auto-cancel sweep uses (see
            // AuditIntelligenceService::buildModuleContext()'s
            // at_risk_pending_schedules addition) — a probabilistic/
            // prioritization judgment call, which is what makes this a
            // legitimate use of the assistant rather than something the
            // deterministic sweep itself should decide.
            { icon: 'fa-hourglass-half', label: 'At-risk reservations', question: 'Which pending reservations are at risk of being auto-cancelled, and what should I do about them?' },
            { icon: 'fa-circle-question', label: 'How does auto-confirm work?', question: 'How does payment-triggered auto-confirmation work for bookings?' },
            { icon: 'fa-clock-rotate-left', label: 'Recent activity', question: 'What has happened recently in Burial Scheduling?' },
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
        confirmed: document.getElementById('confirmedCount'),
        completed: document.getElementById('completedCount'),
        cancelled: document.getElementById('cancelledCount'),
    };

    const searchQuery = document.getElementById('searchQuery');
    const statusFilter = document.getElementById('statusFilter');
    const clearFilters = document.getElementById('clearFilters');
    const activeFilterChips = document.getElementById('activeFilterChips');
    const reservationsBody = document.getElementById('reservationsBody');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');
    const toggleAwaitingBtn = document.getElementById('toggleAwaitingConfirmation');
    const awaitingCountBadge = document.getElementById('awaitingConfirmationCount');

    // Batch E: modal elements (markup lives in manage-reservations.html,
    // reusing the shared assets/css/components/modals.css show/hide-via-
    // style.display pattern already used elsewhere in the app, e.g.
    // decedent-records.js).
    const detailModal = document.getElementById('reservationDetailModal');
    const detailModalBody = document.getElementById('reservationDetailBody');
    const cashModal = document.getElementById('cashPaymentModal');
    const cashPaymentForm = document.getElementById('cashPaymentForm');
    const cashPaymentScheduleId = document.getElementById('cashPaymentScheduleId');
    const cashPaymentAmount = document.getElementById('cashPaymentAmount');
    const cashPaymentMethod = document.getElementById('cashPaymentMethod');
    const cashPaymentReceipt = document.getElementById('cashPaymentReceipt');

    const perPage = 10;
    let currentQuery = '';
    let currentStatus = '';
    let awaitingConfirmationOnly = false;

    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        infoEl: paginationInfo,
        itemLabel: 'reservation',
        onChange: loadAndRenderReservations,
    });

    // Batch F (reservation module audit): escapeHtml/buildStatusBadge/
    // debounce/the filter-chip renderer used to be defined locally here,
    // byte-for-byte (or near-identical) duplicates of the same functions in
    // my-reservations.js — now shared via reservation-ui.js.
    const { escapeHtml, buildStatusBadge, debounce, renderFilterChips } = window.reservationUI;

    function renderActiveFilterChips() {
        renderFilterChips(activeFilterChips, [
            { key: 'q', label: 'Search', value: currentQuery, clear: () => { searchQuery.value = ''; currentQuery = ''; } },
            { key: 'status', label: 'Status', value: currentStatus, clear: () => { statusFilter.value = ''; currentStatus = ''; } },
            { key: 'awaiting', label: 'Filter', value: awaitingConfirmationOnly ? 'Needs Review' : '', clear: () => {
                awaitingConfirmationOnly = false;
                toggleAwaitingBtn.setAttribute('aria-pressed', 'false');
                statusFilter.disabled = false;
            } },
        ], async () => {
            pagination.reset();
            await loadAndRenderReservations();
        });
    }

    // Batch E (reservation module audit): payment_status/payment_amount/
    // payment_date/payment_receipt_number are now returned directly by
    // GET schedules (backend/models/Schedule.php's LATEST_PAYMENT_SELECT) —
    // this just renders what was already available but not shown.
    function buildPaymentBadge(schedule) {
        const status = schedule.payment_status;
        if (!status) {
            return '<span class="payment-badge none">No payment</span>';
        }
        const normalized = String(status).toLowerCase();
        const known = ['verified', 'pending', 'rejected'];
        const badgeClass = known.includes(normalized) ? normalized : 'none';
        return `<span class="payment-badge ${badgeClass}">${status}</span>`;
    }

    // Batch E: stale_notified_at/final_warning_notified_at were already
    // returned by GET schedules (they back the auto-cancel sweep's own
    // dedup checks server-side) but never surfaced here — a Pending row
    // that's already had a reminder or final warning sent looked identical
    // to a brand-new one. This gives the admin the same at-risk visibility
    // the automated sweep already has, without any new backend query.
    function buildUrgencyTag(schedule) {
        if (schedule.status !== 'Pending') return '';
        if (schedule.final_warning_notified_at) {
            return '<span class="urgency-tag urgency-tag--critical" title="Will be auto-cancelled soon if unpaid">Final warning sent</span>';
        }
        if (schedule.stale_notified_at) {
            return '<span class="urgency-tag urgency-tag--warning" title="Reminder sent for lack of payment">Reminder sent</span>';
        }
        return '';
    }

    // Full Automation, Admin-First: a normally-paid booking no longer needs
    // a manual Confirm click — PaymentController::verify() confirms it
    // automatically the moment staff verifies the payment (see
    // AutomationEngine::run() / PaymentController::autoConfirmScheduleForVerifiedPurchase()).
    // A Pending row only needs admin attention when that automatic step
    // couldn't safely proceed and raised an open system_exceptions entry —
    // this is that case, not a routine approval gate.
    function buildActionButtons(schedule, openExceptionIds) {
        const buttons = [];
        const isAdmin = user.role === 'admin';
        const isOwnPending = schedule.status === 'Pending' && String(schedule.created_by) === String(user.user_id);

        // Batch E: available regardless of status — previously the only way
        // to see anything about a reservation beyond this row's own columns
        // was to leave the page entirely (or query the DB directly).
        buttons.push(`<button class="btn-row-action" data-action="view" data-id="${schedule.schedule_id}">View</button>`);

        if (schedule.status === 'Pending' && openExceptionIds.has(schedule.schedule_id)) {
            // Batch H (reservation module audit): deep-links straight to
            // this schedule's exception in the resolve modal (see
            // exceptions.js's matching addition) instead of dumping the
            // admin into the full open-exceptions list to find it themselves.
            buttons.push(`<a class="btn-row-action btn-row-action--confirm" href="exceptions.html?entity_type=Schedule&entity_id=${schedule.schedule_id}">Review Exception</a>`);
        }
        if (schedule.status === 'Confirmed') {
            buttons.push(`<button class="btn-row-action btn-row-action--complete" data-action="complete" data-id="${schedule.schedule_id}">Complete</button>`);
        }
        // F.1: a Pending booking paid in cash/offline never goes through
        // Payment verification, so it never auto-confirms — this is the
        // only way to record it. Hidden when an exception is already
        // flagged above to avoid two competing actions on the same row;
        // resolve that first. See ScheduleController::
        // ensurePaymentForDirectCompletion() for what this actually does
        // server-side (creates a real, Verified Payment record too, so it
        // still shows up in Revenue Reports).
        if (schedule.status === 'Pending' && !openExceptionIds.has(schedule.schedule_id)) {
            buttons.push(`<button class="btn-row-action btn-row-action--complete" data-action="complete-cash" data-id="${schedule.schedule_id}">Complete (Cash)</button>`);
        }
        // Cancel mirrors ScheduleController::destroy()'s server-side rule: admin
        // may cancel any Pending/Confirmed reservation; staff only their own
        // still-Pending one. Hiding it otherwise avoids a confusing 403.
        if ((schedule.status === 'Pending' || schedule.status === 'Confirmed') && (isAdmin || isOwnPending)) {
            buttons.push(`<button class="btn-row-action btn-row-action--cancel" data-action="cancel" data-id="${schedule.schedule_id}">Cancel</button>`);
        }

        return buttons.length ? buttons.join('') : '<span class="muted">No actions</span>';
    }

    function buildReservationRow(schedule, openExceptionIds) {
        // Batch: unregistered-decedent bookings (deceased_id null, see the
        // automation plan) show the provisional name from decedent_requests
        // instead of a blank — admin can see these immediately, view-only,
        // no approval needed for the booking itself.
        const nameCell = (schedule.first_name || schedule.last_name)
            ? `${schedule.first_name || ''} ${schedule.last_name || ''}`
            : (schedule.provisional_name ? `${schedule.provisional_name} <span class="muted">(unregistered)</span>` : 'N/A');
        return `
            <tr data-id="${schedule.schedule_id}">
                <td><strong>Booking #${schedule.schedule_id}</strong></td>
                <td>${nameCell}</td>
                <td>${schedule.lot_number || 'N/A'}</td>
                <td>${schedule.section_name || 'N/A'}</td>
                <td>${schedule.schedule_date || 'N/A'} ${schedule.schedule_time ? schedule.schedule_time : ''}</td>
                <td>${schedule.created_by_name || 'N/A'}</td>
                <td>${buildStatusBadge(schedule.status)}${buildUrgencyTag(schedule)}</td>
                <td>${buildPaymentBadge(schedule)}</td>
                <td class="action-buttons">${buildActionButtons(schedule, openExceptionIds)}</td>
            </tr>
        `;
    }

    async function loadReservations() {
        const params = new URLSearchParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        if (currentQuery.trim()) params.set('q', currentQuery.trim());
        if (awaitingConfirmationOnly) {
            params.set('awaiting_confirmation', '1');
        } else if (currentStatus) {
            params.set('status', currentStatus);
        }
        return await api.request(`schedules?${params.toString()}`, { method: 'GET' });
    }

    async function loadStats() {
        return await api.request('schedules/stats', { method: 'GET' });
    }

    // Set of schedule_ids with an OPEN system_exceptions entry — the only
    // Pending rows that still need a human action (see buildActionButtons()).
    async function loadOpenScheduleExceptionIds() {
        try {
            const exceptions = await api.request('exceptions?status=open&entity_type=Schedule', { method: 'GET' });
            return new Set((Array.isArray(exceptions) ? exceptions : []).map((exception) => Number(exception.entity_id)));
        } catch (error) {
            console.error('Failed to load open exceptions', error);
            return new Set();
        }
    }

    function renderStats(stats) {
        statsEls.pending.innerText = stats.pending || 0;
        statsEls.confirmed.innerText = stats.confirmed || 0;
        statsEls.completed.innerText = stats.completed || 0;
        statsEls.cancelled.innerText = stats.cancelled || 0;
    }

    async function refreshAwaitingConfirmationCount() {
        const openExceptionIds = await loadOpenScheduleExceptionIds();
        awaitingCountBadge.textContent = openExceptionIds.size;
    }

    async function loadAndRenderReservations() {
        reservationsBody.innerHTML = '<tr><td colspan="9">Loading reservations...</td></tr>';
        try {
            const [result, openExceptionIds] = await Promise.all([loadReservations(), loadOpenScheduleExceptionIds()]);
            const data = Array.isArray(result.data) ? result.data : [];
            reservationsBody.innerHTML = data.length > 0
                ? data.map((schedule) => buildReservationRow(schedule, openExceptionIds)).join('')
                : `
                    <tr>
                        <td colspan="9">
                            <div class="mgmtres-empty-state">
                                <i class="fas fa-calendar-xmark"></i>
                                <strong>No reservations found</strong>
                                <span>Adjust the filters to see more reservations.</span>
                            </div>
                        </td>
                    </tr>
                `;
            renderActiveFilterChips();
            pagination.render(result.meta || { page: 1, pages: 1, total: data.length });
        } catch (error) {
            console.error('Failed to load reservations', error);
            reservationsBody.innerHTML = '<tr><td colspan="9">Unable to load reservations right now.</td></tr>';
            pagination.render({ page: 1, pages: 1, total: 0 });
        }
    }

    // Batch E: the three stages below are mutually independent reads (stats,
    // the open-exceptions count, and the reservation list itself each hit
    // their own endpoint) — previously sequential awaits, now run
    // concurrently so a refresh after any action isn't gated on three
    // round-trips back to back. Each already has its own internal
    // try/catch, so Promise.all here doesn't change failure behavior — one
    // stage failing still can't block the others from rendering.
    async function refreshAll() {
        await Promise.all([
            loadStats().then(renderStats).catch((error) => console.error('Failed to load reservation stats', error)),
            refreshAwaitingConfirmationCount(),
            loadAndRenderReservations(),
        ]);
    }

    async function completeReservation(id, button) {
        const confirmed = await confirmDialog({
            title: 'Complete reservation?',
            message: 'Mark this reservation as completed? The lot will be marked Occupied.',
            confirmLabel: 'Mark completed',
        });
        if (!confirmed) return;
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(`schedules/${id}`, { method: 'PUT', body: { status: 'Completed' } });
                if (result.success) {
                    showToast('Reservation marked completed.', { type: 'success' });
                    await refreshAll();
                } else {
                    showToast(result.error || 'Unable to complete reservation.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Unable to complete reservation.', { type: 'error' });
            }
        });
    }

    // F.1: creates a real, Verified Payment record server-side
    // (ensurePaymentForDirectCompletion()) so the sale still shows up in
    // Revenue Reports, then completes the booking exactly like
    // completeReservation() above.
    // Batch E (reservation module audit): replaces three chained
    // prompt()/confirm() dialogs with the shared modal markup — same
    // request body/shape as before, only the input UI changed.
    function openCashPaymentModal(id) {
        cashPaymentScheduleId.value = id;
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
        const id = cashPaymentScheduleId.value;
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
                const result = await api.request(`schedules/${id}`, {
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
                    showToast('Payment recorded and reservation completed.', { type: 'success' });
                    await refreshAll();
                } else {
                    showToast(result.error || 'Unable to complete reservation.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Unable to complete reservation.', { type: 'error' });
            }
        });
    });

    document.getElementById('closeCashModal').addEventListener('click', closeCashPaymentModal);
    document.getElementById('cancelCashModal').addEventListener('click', closeCashPaymentModal);
    cashModal.addEventListener('click', (event) => {
        if (event.target === cashModal) closeCashPaymentModal();
    });

    // Batch E: wires up GET schedules/{id} — previously never called from
    // this page (the audit found no detail-view consumer of it at all).
    // Fetches fresh rather than reusing the row's already-loaded data so
    // the modal always reflects the latest state, including notes and
    // exact timestamps not otherwise rendered in the table.
    async function viewReservation(id) {
        detailModalBody.innerHTML = '<p>Loading...</p>';
        detailModal.style.display = 'flex';
        try {
            const schedule = await api.request(`schedules/${id}`, { method: 'GET' });
            if (schedule.error) {
                detailModalBody.innerHTML = `<p>${escapeHtml(schedule.error)}</p>`;
                return;
            }
            const nameCell = (schedule.first_name || schedule.last_name)
                ? `${schedule.first_name || ''} ${schedule.last_name || ''}`
                : (schedule.provisional_name ? `${schedule.provisional_name} (unregistered)` : 'N/A');
            const paymentLine = schedule.payment_status
                ? `${escapeHtml(schedule.payment_status)} &mdash; &#8369;${escapeHtml(schedule.payment_amount || 'N/A')} on ${escapeHtml(schedule.payment_date || 'N/A')} (receipt ${escapeHtml(schedule.payment_receipt_number || 'N/A')})`
                : 'No payment on file';
            detailModalBody.innerHTML = `
                <div class="form-group"><label>Booking</label>#${escapeHtml(schedule.schedule_id)} &mdash; ${buildStatusBadge(schedule.status)}${buildUrgencyTag(schedule)}</div>
                <div class="form-group"><label>Decedent</label>${escapeHtml(nameCell)}</div>
                <div class="form-group"><label>Lot</label>${escapeHtml(schedule.lot_number || 'N/A')} &mdash; ${escapeHtml(schedule.section_name || 'N/A')}</div>
                <div class="form-group"><label>Burial date</label>${escapeHtml(schedule.schedule_date || 'N/A')} ${escapeHtml(schedule.schedule_time || '')}</div>
                <div class="form-group"><label>Requested by</label>${escapeHtml(schedule.created_by_name || 'N/A')}</div>
                <div class="form-group"><label>Payment</label>${paymentLine}</div>
                <div class="form-group"><label>Notes</label>${escapeHtml(schedule.notes || 'None')}</div>
            `;
        } catch (error) {
            detailModalBody.innerHTML = '<p>Unable to load reservation details right now.</p>';
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

    async function cancelReservation(id, button) {
        const confirmed = await confirmDialog({
            title: 'Cancel reservation?',
            message: 'This will cancel the reservation and release the lot. This cannot be undone.',
            confirmLabel: 'Cancel reservation',
            cancelLabel: 'Keep reservation',
            danger: true,
        });
        if (!confirmed) return;
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(`schedules/${id}`, { method: 'DELETE' });
                if (result.success) {
                    showToast('Reservation cancelled.', { type: 'success' });
                    await refreshAll();
                } else {
                    showToast(result.error || 'Unable to cancel reservation.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Unable to cancel reservation.', { type: 'error' });
            }
        });
    }

    reservationsBody.addEventListener('click', async function(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const id = button.getAttribute('data-id');
        const action = button.getAttribute('data-action');
        if (!id || !action) return;

        if (action === 'view') await viewReservation(id);
        else if (action === 'complete') await completeReservation(id, button);
        else if (action === 'complete-cash') openCashPaymentModal(id);
        else if (action === 'cancel') await cancelReservation(id, button);
    });

    const refreshFiltered = debounce(async () => {
        pagination.reset();
        currentQuery = searchQuery.value || '';
        currentStatus = statusFilter.value || '';
        await loadAndRenderReservations();
    }, 250);

    searchQuery.addEventListener('input', refreshFiltered);
    statusFilter.addEventListener('change', refreshFiltered);

    toggleAwaitingBtn.addEventListener('click', async () => {
        awaitingConfirmationOnly = !awaitingConfirmationOnly;
        toggleAwaitingBtn.setAttribute('aria-pressed', String(awaitingConfirmationOnly));
        // The filter is inherently Pending-only server-side; disable the status
        // dropdown while active so it can't silently conflict with the toggle.
        statusFilter.disabled = awaitingConfirmationOnly;
        pagination.reset();
        await loadAndRenderReservations();
    });

    clearFilters.addEventListener('click', async () => {
        searchQuery.value = '';
        statusFilter.value = '';
        statusFilter.disabled = false;
        currentQuery = '';
        currentStatus = '';
        awaitingConfirmationOnly = false;
        toggleAwaitingBtn.setAttribute('aria-pressed', 'false');
        pagination.reset();
        await loadAndRenderReservations();
    });

    await refreshAll();
});
