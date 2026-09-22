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

    // Notification badge & navigation
    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.innerText = result.count || 0;
                badge.style.display = result.count > 0 ? 'flex' : 'none';
            }
        } catch (e) { /* silent — non-critical UI */ }
    }
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);

    document.getElementById('notificationIcon')?.addEventListener('click', () => {
        window.location.href = `${getFrontendBasePath()}/pages/notifications.html`;
    });

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
        itemLabel: 'reservation',
        onChange: loadAndRenderReservations,
    });

    // Batch F (reservation module audit): escapeHtml/buildStatusBadge/
    // debounce/the filter-chip renderer used to be defined locally here,
    // byte-for-byte (or near-identical) duplicates of the same functions in
    // my-reservations.js — now shared via reservation-ui.js.
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
        await loadAndRenderReservations();
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
        buttons.push(`<button class="btn-row-action" data-action="view" data-id="${schedule.schedule_id}" title="View reservation details"><i class="fas fa-eye"></i> View</button>`);

        if (openExceptionIds.has(schedule.schedule_id)) {
            // Batch H (reservation module audit): deep-links straight to
            // this schedule's exception in the resolve modal (see
            // exceptions.js's matching addition) instead of dumping the
            // admin into the full open-exceptions list to find it themselves.
            buttons.push(`<a class="btn-row-action btn-row-action--confirm" href="exceptions.html?entity_type=Schedule&entity_id=${schedule.schedule_id}" title="Review reservation exception"><i class="fas fa-triangle-exclamation"></i> Review</a>`);
        }
        if (schedule.status === 'Confirmed') {
            buttons.push(`<button class="btn-row-action btn-row-action--complete" data-action="complete" data-id="${schedule.schedule_id}" title="Mark reservation completed"><i class="fas fa-circle-check"></i> Complete</button>`);
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
            const rawAmt = schedule.payment_amount || schedule.price || '';
            buttons.push(`<button class="btn-row-action btn-row-action--cash" data-action="complete-cash" data-id="${schedule.schedule_id}" data-amount="${rawAmt}" title="Complete reservation via cash payment"><i class="fas fa-money-bill-wave"></i> Complete (Cash)</button>`);
        }
        // Cancel mirrors ScheduleController::destroy()'s server-side rule: admin
        // may cancel any Pending/Confirmed reservation; staff only their own
        // still-Pending one. Hiding it otherwise avoids a confusing 403.
        if ((schedule.status === 'Pending' || schedule.status === 'Confirmed') && (isAdmin || isOwnPending)) {
            buttons.push(`<button class="btn-row-action btn-row-action--cancel" data-action="cancel" data-id="${schedule.schedule_id}" title="Cancel reservation"><i class="fas fa-xmark"></i> Cancel</button>`);
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
                <td>${buildStatusBadge(schedule.status)}</td>
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
        if (!statsEls.pending) return;
        statsEls.pending.textContent = Number(stats && stats.pending) || 0;
        statsEls.confirmed.textContent = Number(stats && stats.confirmed) || 0;
        statsEls.completed.textContent = Number(stats && stats.completed) || 0;
        statsEls.cancelled.textContent = Number(stats && stats.cancelled) || 0;
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
        updateActiveStatCards();
        if (typeof window.stampFooterTime === 'function') {
            window.stampFooterTime();
        }
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
        cashPaymentScheduleId.value = id;
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

    // Compute intuitive human countdown
    function computeScheduleCountdown(scheduleDateStr) {
        if (!scheduleDateStr) return 'Date Pending';
        const parts = String(scheduleDateStr).split('-');
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

    // Zero-Scroll Split-Deck Reservation Dossier
    async function viewReservation(id) {
        detailModalBody.innerHTML = `
            <div class="resmodal-loading" style="padding: 40px 20px; text-align: center; color: #047857;">
                <i class="fas fa-circle-notch fa-spin" style="font-size: 2rem; margin-bottom: 12px; display: block;"></i>
                <span style="font-weight: 700;">Loading reservation dossier...</span>
            </div>
        `;
        detailModal.style.display = 'flex';
        try {
            const schedule = await api.request(`schedules/${id}`, { method: 'GET' });
            if (schedule.error) {
                detailModalBody.innerHTML = `
                    <div class="resmodal-error" style="padding: 40px 20px; text-align: center; color: #dc2626;">
                        <i class="fas fa-triangle-exclamation" style="font-size: 2rem; margin-bottom: 8px;"></i>
                        <span style="display: block; font-weight: 700;">${escapeHtml(schedule.error)}</span>
                    </div>
                `;
                return;
            }

            const decedentFullName = (schedule.first_name || schedule.last_name)
                ? `${schedule.first_name || ''} ${schedule.last_name || ''}`.trim()
                : (schedule.provisional_name ? `${schedule.provisional_name}` : 'Unassigned Decedent');

            const isProvisional = !schedule.first_name && !schedule.last_name && Boolean(schedule.provisional_name);

            const paymentStatus = schedule.payment_status || 'Unpaid';
            const normalizedPayment = String(paymentStatus).toLowerCase();
            const isVerified = normalizedPayment === 'verified';
            const isPending = normalizedPayment === 'pending';
            const formattedAmount = schedule.payment_amount
                ? `₱${Number(schedule.payment_amount).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : (schedule.price ? `₱${Number(schedule.price).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '₱0.00');

            const receiptNumber = schedule.payment_receipt_number || 'Auto-generated upon cashiering';
            const paymentDate = schedule.payment_date || 'Pending';
            const paymentMethod = schedule.payment_method || 'Standard';

            // Clean, readable date & time formatting
            let formattedDate = schedule.schedule_date || 'Not specified';
            if (schedule.schedule_date) {
                const parts = String(schedule.schedule_date).split('-');
                if (parts.length === 3) {
                    const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                    if (!isNaN(d.getTime())) {
                        formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    }
                }
            }

            let formattedTime = '';
            if (schedule.schedule_time) {
                const tParts = String(schedule.schedule_time).split(':');
                if (tParts.length >= 2) {
                    const h = parseInt(tParts[0], 10);
                    const ampm = h >= 12 ? 'PM' : 'AM';
                    const displayH = h % 12 || 12;
                    formattedTime = `${displayH}:${tParts[1]} ${ampm}`;
                }
            }

            let bookedDate = schedule.created_at || 'Not recorded';
            if (schedule.created_at) {
                const bParts = String(schedule.created_at).split(' ');
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

            const countdownText = computeScheduleCountdown(schedule.schedule_date);
            const bookingBadge = document.getElementById('detailBookingBadge');
            if (bookingBadge) {
                bookingBadge.textContent = `Booking #${schedule.schedule_id}`;
            }

            detailModalBody.innerHTML = `
                <div class="split-deck-body">
                    <!-- LEFT DECK: Profile & Dossier Engine -->
                    <div class="deck-col deck-col--dossier">
                        <div class="deck-section-title">
                            <i class="fas fa-id-card"></i>
                            <span>Interment &amp; Applicant Dossier</span>
                        </div>

                        <div class="res-dossier-card">
                            <div class="res-profile-header">
                                <div class="res-profile-avatar">
                                    <i class="fas fa-user-tag"></i>
                                </div>
                                <div class="res-profile-meta">
                                    <h4 class="res-profile-name">${escapeHtml(decedentFullName)}</h4>
                                    <span class="res-type-pill ${isProvisional ? 'res-type-pill--provisional' : 'res-type-pill--registered'}">
                                        <i class="fas ${isProvisional ? 'fa-hourglass-half' : 'fa-certificate'}"></i>
                                        ${isProvisional ? 'Provisional Request' : 'Registered Decedent'}
                                    </span>
                                </div>
                            </div>

                            <div class="res-data-grid">
                                <div class="res-data-item">
                                    <span class="res-data-label">Applicant / Kin</span>
                                    <strong class="res-data-value">${escapeHtml(schedule.created_by_name || 'Direct Entry')}</strong>
                                </div>
                                <div class="res-data-item">
                                    <span class="res-data-label">Contact / Phone</span>
                                    <span class="res-data-value">${escapeHtml(schedule.contact_phone || schedule.phone || 'On file')}</span>
                                </div>
                                <div class="res-data-item">
                                    <span class="res-data-label">Intake Date</span>
                                    <span class="res-data-value">${escapeHtml(bookedDate)}</span>
                                </div>
                                <div class="res-data-item">
                                    <span class="res-data-label">Schedule Status</span>
                                    <span class="res-data-value">${buildStatusBadge(schedule.status)}</span>
                                </div>
                            </div>

                            ${schedule.notes ? `
                                <div class="res-notes-box">
                                    <i class="fas fa-quote-left"></i>
                                    <span>${escapeHtml(schedule.notes)}</span>
                                </div>
                            ` : ''}
                        </div>
                    </div>

                    <!-- RIGHT DECK: Live Spatial Matrix & Digital Twin -->
                    <div class="deck-col deck-col--twin">
                        <div class="deck-section-title">
                            <i class="fas fa-map-location-dot"></i>
                            <span>Spatial Digital Twin &amp; Settlement</span>
                        </div>

                        <div class="res-twin-card">
                            <div class="res-twin-top">
                                <div class="res-twin-locator">
                                    <i class="fas fa-location-crosshairs"></i>
                                    <span>Section ${escapeHtml(schedule.section_name || 'A')} · Zone ${escapeHtml(schedule.block_name || 'Standard')}</span>
                                </div>
                                <span class="res-countdown-chip">
                                    <i class="fas fa-clock"></i>
                                    <span>${escapeHtml(countdownText)}</span>
                                </span>
                            </div>

                            <div class="res-twin-plot-badge">
                                <span class="res-plot-monogram">LOT ${escapeHtml(schedule.lot_number || 'TBD')}</span>
                            </div>

                            <div class="res-twin-schedule-strip">
                                <i class="fas fa-calendar-check"></i>
                                <div>
                                    <strong>${escapeHtml(formattedDate)}</strong>
                                    <span> at ${escapeHtml(formattedTime || 'Standard Morning Slot')}</span>
                                </div>
                            </div>

                            <div class="res-twin-valuation-card">
                                <div>
                                    <span class="deck-kicker">Settlement Fee</span>
                                    <div class="res-val-amount">${formattedAmount}</div>
                                </div>
                                <div class="res-val-meta">
                                    <span class="deck-badge ${isVerified ? '' : 'deck-badge--gold'}">
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

            // Setup footer actions dynamically
            const actionsRight = document.getElementById('detailModalActionsRight');
            if (actionsRight) {
                actionsRight.innerHTML = '';
                if (schedule.status === 'Pending' && !isVerified) {
                    const payBtn = document.createElement('button');
                    payBtn.type = 'button';
                    payBtn.className = 'btn-deck-primary btn-deck-gold';
                    payBtn.innerHTML = '<i class="fas fa-hand-holding-dollar"></i> <span>Settle Payment</span>';
                    payBtn.addEventListener('click', () => {
                        closeDetailModal();
                        const rawAmount = schedule.payment_amount || schedule.price || 0;
                        openCashPaymentModal(schedule.schedule_id, rawAmount);
                    });
                    actionsRight.appendChild(payBtn);
                }

                const closeBtn = document.createElement('button');
                closeBtn.type = 'button';
                closeBtn.className = 'btn-deck-primary';
                closeBtn.innerHTML = '<i class="fas fa-check"></i> <span>Done</span>';
                closeBtn.addEventListener('click', closeDetailModal);
                actionsRight.appendChild(closeBtn);
            }
        } catch (error) {
            console.error('Failed to load reservation details', error);
            detailModalBody.innerHTML = `
                <div class="resmodal-error" style="padding: 40px 20px; text-align: center; color: #dc2626;">
                    <i class="fas fa-circle-exclamation" style="font-size: 2rem; margin-bottom: 8px;"></i>
                    <span style="display: block; font-weight: 700;">Unable to load reservation details right now. Please try again later.</span>
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
        else if (action === 'complete-cash') {
            const rowAmt = button.getAttribute('data-amount') || 0;
            openCashPaymentModal(id, rowAmt);
        }
        else if (action === 'cancel') await cancelReservation(id, button);
    });

    const refreshFiltered = debounce(async () => {
        pagination.reset();
        currentQuery = searchQuery.value || '';
        currentStatus = statusFilter.value || '';
        updateActiveStatCards();
        await loadAndRenderReservations();
    }, 250);

    searchQuery.addEventListener('input', refreshFiltered);
    statusFilter.addEventListener('change', () => {
        currentStatus = statusFilter.value || '';
        updateActiveStatCards();
        pagination.reset();
        loadAndRenderReservations();
    });

    toggleAwaitingBtn.addEventListener('click', async () => {
        awaitingConfirmationOnly = !awaitingConfirmationOnly;
        toggleAwaitingBtn.setAttribute('aria-pressed', String(awaitingConfirmationOnly));
        // The filter is inherently Pending-only server-side; disable the status
        // dropdown while active so it can't silently conflict with the toggle.
        statusFilter.disabled = awaitingConfirmationOnly;
        updateActiveStatCards();
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
        updateActiveStatCards();
        pagination.reset();
        await loadAndRenderReservations();
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

