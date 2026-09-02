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

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    function renderActiveFilterChips() {
        const chips = [
            { key: 'q', label: 'Search', value: currentQuery, clear: () => { searchQuery.value = ''; currentQuery = ''; } },
            { key: 'status', label: 'Status', value: currentStatus, clear: () => { statusFilter.value = ''; currentStatus = ''; } },
            { key: 'awaiting', label: 'Filter', value: awaitingConfirmationOnly ? 'Needs Review' : '', clear: () => {
                awaitingConfirmationOnly = false;
                toggleAwaitingBtn.setAttribute('aria-pressed', 'false');
                statusFilter.disabled = false;
            } },
        ].filter((chip) => chip.value);

        if (!activeFilterChips) return;
        activeFilterChips.innerHTML = chips.map((chip) => `
            <span class="filter-chip" data-filter-key="${chip.key}">
                ${escapeHtml(chip.label)}: ${escapeHtml(chip.value)}
                <button type="button" aria-label="Remove ${escapeHtml(chip.label)} filter">&times;</button>
            </span>
        `).join('');

        activeFilterChips.querySelectorAll('.filter-chip').forEach((chipEl) => {
            const chip = chips.find((item) => item.key === chipEl.dataset.filterKey);
            const button = chipEl.querySelector('button');
            if (!chip || !button) return;
            button.addEventListener('click', async () => {
                chip.clear();
                pagination.reset();
                await loadAndRenderReservations();
            });
        });
    }

    function buildStatusBadge(status) {
        const normalized = String(status || '').toLowerCase();
        const known = ['pending', 'confirmed', 'completed', 'cancelled'];
        const badgeClass = known.includes(normalized) ? normalized : 'pending';
        return `<span class="status-badge ${badgeClass}">${status || 'Pending'}</span>`;
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

        if (schedule.status === 'Pending' && openExceptionIds.has(schedule.schedule_id)) {
            buttons.push(`<a class="btn-row-action btn-row-action--confirm" href="exceptions.html">Review Exception</a>`);
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
                <td>${buildStatusBadge(schedule.status)}</td>
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
        reservationsBody.innerHTML = '<tr><td colspan="8">Loading reservations...</td></tr>';
        try {
            const [result, openExceptionIds] = await Promise.all([loadReservations(), loadOpenScheduleExceptionIds()]);
            const data = Array.isArray(result.data) ? result.data : [];
            reservationsBody.innerHTML = data.length > 0
                ? data.map((schedule) => buildReservationRow(schedule, openExceptionIds)).join('')
                : `
                    <tr>
                        <td colspan="8">
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
            reservationsBody.innerHTML = '<tr><td colspan="8">Unable to load reservations right now.</td></tr>';
            pagination.render({ page: 1, pages: 1, total: 0 });
        }
    }

    async function refreshAll() {
        try {
            const stats = await loadStats();
            renderStats(stats);
        } catch (error) {
            console.error('Failed to load reservation stats', error);
        }
        await refreshAwaitingConfirmationCount();
        await loadAndRenderReservations();
    }

    async function completeReservation(id, button) {
        if (!confirm('Mark this reservation as completed? The lot will be marked Occupied.')) return;
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(`schedules/${id}`, { method: 'PUT', body: { status: 'Completed' } });
                if (result.success) {
                    await refreshAll();
                } else {
                    alert(result.error || 'Unable to complete reservation.');
                }
            } catch (error) {
                alert(error.message || 'Unable to complete reservation.');
            }
        });
    }

    // F.1: prompts for the same payment details an online payment would
    // have captured — server-side (ensurePaymentForDirectCompletion())
    // creates a real, Verified Payment record from these so the sale still
    // shows up in Revenue Reports, then completes the booking exactly like
    // completeReservation() above. Uses plain prompt()/confirm() rather than
    // a new modal component, matching this page's existing simple dialog
    // style (see cancelReservation()/completeReservation() above) instead of
    // introducing a new UI pattern for a staff-only, occasional action.
    async function completeCashReservation(id, button) {
        const amountInput = prompt('Enter the cash/offline payment amount received (₱):');
        if (amountInput === null) return;
        const amount = parseFloat(amountInput);
        if (isNaN(amount) || amount <= 0) {
            alert('Please enter a valid payment amount.');
            return;
        }

        const method = prompt('Payment method used:', 'Cash');
        if (method === null) return;
        if (!method.trim()) {
            alert('Payment method is required.');
            return;
        }

        const receiptNumber = prompt('Receipt number (optional — leave blank to auto-generate):', '');
        if (receiptNumber === null) return;

        if (!confirm(`Mark this reservation as completed with a ${method.trim()} payment of ₱${amount.toFixed(2)}? The lot will be marked Occupied and a Verified payment record will be created.`)) return;

        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(`schedules/${id}`, {
                    method: 'PUT',
                    body: {
                        status: 'Completed',
                        payment_amount: amount,
                        payment_method: method.trim(),
                        receipt_number: receiptNumber.trim(),
                    },
                });
                if (result.success) {
                    await refreshAll();
                } else {
                    alert(result.error || 'Unable to complete reservation.');
                }
            } catch (error) {
                alert(error.message || 'Unable to complete reservation.');
            }
        });
    }

    async function cancelReservation(id, button) {
        if (!confirm('Cancel this reservation?')) return;
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(`schedules/${id}`, { method: 'DELETE' });
                if (result.success) {
                    await refreshAll();
                } else {
                    alert(result.error || 'Unable to cancel reservation.');
                }
            } catch (error) {
                alert(error.message || 'Unable to cancel reservation.');
            }
        });
    }

    reservationsBody.addEventListener('click', async function(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const id = button.getAttribute('data-id');
        const action = button.getAttribute('data-action');
        if (!id || !action) return;

        if (action === 'complete') await completeReservation(id, button);
        else if (action === 'complete-cash') await completeCashReservation(id, button);
        else if (action === 'cancel') await cancelReservation(id, button);
    });

    function debounce(fn, delay = 300) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }

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
