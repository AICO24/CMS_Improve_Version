document.addEventListener('DOMContentLoaded', async function() {
    try {
        const user = await requireRole(['user']);
        if (!user) return;
    } catch (error) {
        console.error('Auth error', error);
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    // BATCH AI-4 (AI Architecture Audit, 2026-09-02): the System-Wide AI
    // Assistant's first citizen-facing mount. Deliberately narrower than
    // every admin/staff mount of this same widget — scope='module' only,
    // always filtered server-side to this citizen's own reservations (see
    // AuditIntelligenceService::buildCitizenModuleContext() and
    // AiController::askAssistant()'s citizen branch) — never another
    // citizen's, and never a system-wide or escalated fetch.
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Schedule' },
        greeting: "Hello! I'm your AI assistant for your reservations. How can I help you today?",
        suggestions: [
            { icon: 'fa-list-check', label: 'My reservations', question: 'What is the status of my reservations right now?' },
            { icon: 'fa-clock-rotate-left', label: 'Anything pending?', question: 'Do I have any pending reservations, and what do they need?' },
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
    const reservationsBody = document.getElementById('reservationsBody');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');

    let perPage = 10;
    let currentQuery = '';
    let currentStatus = '';

    const pagination = createPagination({
        prevBtn: prevPage,
        nextBtn: nextPage,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        infoEl: paginationInfo,
        itemLabel: 'reservation',
        onChange: loadReservations,
    });

    // Batch F (reservation module audit): escapeHtml/buildStatusBadge/
    // debounce/the filter-chip renderer used to be defined locally here,
    // byte-for-byte (or near-identical) duplicates of the same functions in
    // manage-reservations.js — now shared via reservation-ui.js.
    const { buildStatusBadge, debounce, renderFilterChips } = window.reservationUI;

    function renderActiveFilterChips() {
        renderFilterChips(activeFilterChips, [
            { key: 'q', label: 'Search', value: currentQuery, clear: () => { searchQuery.value = ''; currentQuery = ''; } },
            { key: 'status', label: 'Status', value: currentStatus, clear: () => { statusFilter.value = ''; currentStatus = ''; } },
        ], async () => {
            pagination.reset();
            await loadReservations();
        });
    }

    function buildReservationRow(schedule) {
        const canCancel = schedule.status === 'Pending';
        return `
            <tr>
                <td>
                    <div><strong>Booking #${schedule.schedule_id}</strong></div>
                    <div class="muted">Created by ${schedule.created_by_name || 'You'}</div>
                </td>
                <td>${schedule.lot_number || 'N/A'}</td>
                <td>${schedule.section_name || 'N/A'}</td>
                <td>${schedule.schedule_date || 'N/A'} ${schedule.schedule_time ? schedule.schedule_time : ''}</td>
                <td>${buildStatusBadge(schedule.status)}</td>
                <td>${schedule.first_name || 'N/A'} ${schedule.last_name || ''}</td>
                <td>
                    ${canCancel ? `<button class="btn-secondary" data-action="cancel" data-id="${schedule.schedule_id}">Cancel</button>` : '<span class="muted">No actions</span>'}
                </td>
            </tr>
        `;
    }

    async function loadReservations() {
        reservationsBody.innerHTML = '<tr><td colspan="7">Loading reservations...</td></tr>';
        const params = new URLSearchParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        if (currentQuery.trim()) params.set('q', currentQuery.trim());
        if (currentStatus) params.set('status', currentStatus);

        try {
            const result = await api.request(`schedules/mine?${params.toString()}`, { method: 'GET' });
            const data = Array.isArray(result.data) ? result.data : [];
            reservationsBody.innerHTML = data.length > 0
                ? data.map(buildReservationRow).join('')
                : `
                    <tr>
                        <td colspan="7">
                            <div class="usermgmt-empty-state">
                                <i class="fas fa-calendar-xmark"></i>
                                <strong>No reservations found</strong>
                                <span>Adjust the filters to see more of your reservations.</span>
                            </div>
                        </td>
                    </tr>
                `;
            renderActiveFilterChips();
            pagination.render(result.meta || { page: 1, pages: 1, total: data.length });
        } catch (error) {
            console.error('Failed to load reservations', error);
            reservationsBody.innerHTML = '<tr><td colspan="7">Unable to load reservations right now.</td></tr>';
            pagination.render({ page: 1, pages: 1, total: 0 });
        }
    }

    async function cancelReservation(id) {
        const confirmed = await confirmDialog({
            title: 'Cancel reservation?',
            message: 'This will cancel your pending reservation and release the lot. This cannot be undone.',
            confirmLabel: 'Cancel reservation',
            cancelLabel: 'Keep reservation',
            danger: true,
        });
        if (!confirmed) return;

        try {
            const result = await api.request(`schedules/${id}`, { method: 'DELETE' });
            if (result.success) {
                showToast('Reservation cancelled successfully.', { type: 'success' });
                await loadReservations();
            } else {
                showToast(result.error || 'Unable to cancel reservation.', { type: 'error' });
            }
        } catch (error) {
            showToast(error.message || 'Unable to cancel reservation.', { type: 'error' });
        }
    }

    reservationsBody.addEventListener('click', async function(event) {
        const button = event.target.closest('button[data-action="cancel"]');
        if (!button) return;
        const scheduleId = button.getAttribute('data-id');
        if (!scheduleId) return;
        await withButtonLoading(button, () => cancelReservation(scheduleId));
    });

    const refreshReservations = debounce(async () => {
        pagination.reset();
        currentQuery = searchQuery.value || '';
        currentStatus = statusFilter.value || '';
        await loadReservations();
    }, 250);

    searchQuery.addEventListener('input', refreshReservations);
    statusFilter.addEventListener('change', refreshReservations);
    clearFilters.addEventListener('click', async () => {
        searchQuery.value = '';
        statusFilter.value = '';
        currentQuery = '';
        currentStatus = '';
        pagination.reset();
        await loadReservations();
    });

    await loadReservations();
});
