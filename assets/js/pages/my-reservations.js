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
                await loadReservations();
            });
        });
    }

    function buildStatusBadge(status) {
        const normalized = String(status || '').toLowerCase();
        let badgeClass = 'pending';
        if (normalized === 'confirmed') badgeClass = 'confirmed';
        else if (normalized === 'cancelled') badgeClass = 'cancelled';
        else if (normalized === 'completed') badgeClass = 'completed';
        return `<span class="status-badge ${badgeClass}">${status || 'Pending'}</span>`;
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
        if (!confirm('Cancel this pending reservation?')) {
            return;
        }
        try {
            const result = await api.request(`schedules/${id}`, { method: 'DELETE' });
            if (result.success) {
                alert('Reservation canceled successfully.');
                await loadReservations();
            } else {
                alert(result.error || 'Unable to cancel reservation.');
            }
        } catch (error) {
            alert(error.message || 'Unable to cancel reservation.');
        }
    }

    reservationsBody.addEventListener('click', async function(event) {
        const button = event.target.closest('button[data-action="cancel"]');
        if (!button) return;
        const scheduleId = button.getAttribute('data-id');
        if (!scheduleId) return;
        await withButtonLoading(button, () => cancelReservation(scheduleId));
    });

    function debounce(fn, delay = 300) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }

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
