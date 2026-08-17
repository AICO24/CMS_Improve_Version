document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin', 'staff']);
    if (!user) return;

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

    const statsEls = {
        pending: document.getElementById('pendingCount'),
        confirmed: document.getElementById('confirmedCount'),
        completed: document.getElementById('completedCount'),
        cancelled: document.getElementById('cancelledCount'),
    };

    const searchQuery = document.getElementById('searchQuery');
    const statusFilter = document.getElementById('statusFilter');
    const clearFilters = document.getElementById('clearFilters');
    const reservationsBody = document.getElementById('reservationsBody');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');

    const perPage = 10;
    let currentQuery = '';
    let currentStatus = '';

    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        infoEl: paginationInfo,
        itemLabel: 'reservation',
        onChange: loadAndRenderReservations,
    });

    function buildStatusBadge(status) {
        const normalized = String(status || '').toLowerCase();
        const known = ['pending', 'confirmed', 'completed', 'cancelled'];
        const badgeClass = known.includes(normalized) ? normalized : 'pending';
        return `<span class="status-badge ${badgeClass}">${status || 'Pending'}</span>`;
    }

    function buildActionButtons(schedule) {
        const buttons = [];
        const isAdmin = user.role === 'admin';
        const isOwnPending = schedule.status === 'Pending' && String(schedule.created_by) === String(user.user_id);

        if (schedule.status === 'Pending') {
            buttons.push(`<button class="btn-row-action btn-row-action--confirm" data-action="confirm" data-id="${schedule.schedule_id}">Confirm</button>`);
        }
        if (schedule.status === 'Confirmed') {
            buttons.push(`<button class="btn-row-action btn-row-action--complete" data-action="complete" data-id="${schedule.schedule_id}">Complete</button>`);
        }
        // Cancel mirrors ScheduleController::destroy()'s server-side rule: admin
        // may cancel any Pending/Confirmed reservation; staff only their own
        // still-Pending one. Hiding it otherwise avoids a confusing 403.
        if ((schedule.status === 'Pending' || schedule.status === 'Confirmed') && (isAdmin || isOwnPending)) {
            buttons.push(`<button class="btn-row-action btn-row-action--cancel" data-action="cancel" data-id="${schedule.schedule_id}">Cancel</button>`);
        }

        return buttons.length ? buttons.join('') : '<span class="muted">No actions</span>';
    }

    function buildReservationRow(schedule) {
        return `
            <tr data-id="${schedule.schedule_id}">
                <td><strong>Booking #${schedule.schedule_id}</strong></td>
                <td>${schedule.first_name || ''} ${schedule.last_name || ''}</td>
                <td>${schedule.lot_number || 'N/A'}</td>
                <td>${schedule.section_name || 'N/A'}</td>
                <td>${schedule.schedule_date || 'N/A'} ${schedule.schedule_time ? schedule.schedule_time : ''}</td>
                <td>${schedule.created_by_name || 'N/A'}</td>
                <td>${buildStatusBadge(schedule.status)}</td>
                <td class="action-buttons">${buildActionButtons(schedule)}</td>
            </tr>
        `;
    }

    async function loadReservations() {
        const params = new URLSearchParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        if (currentQuery.trim()) params.set('q', currentQuery.trim());
        if (currentStatus) params.set('status', currentStatus);
        return await api.request(`schedules?${params.toString()}`, { method: 'GET' });
    }

    async function loadStats() {
        return await api.request('schedules/stats', { method: 'GET' });
    }

    function renderStats(stats) {
        statsEls.pending.innerText = stats.pending || 0;
        statsEls.confirmed.innerText = stats.confirmed || 0;
        statsEls.completed.innerText = stats.completed || 0;
        statsEls.cancelled.innerText = stats.cancelled || 0;
    }

    async function loadAndRenderReservations() {
        reservationsBody.innerHTML = '<tr><td colspan="8">Loading reservations...</td></tr>';
        try {
            const result = await loadReservations();
            const data = Array.isArray(result.data) ? result.data : [];
            reservationsBody.innerHTML = data.length > 0
                ? data.map(buildReservationRow).join('')
                : '<tr><td colspan="8">No reservations found for the selected criteria.</td></tr>';
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
        await loadAndRenderReservations();
    }

    async function confirmReservation(id, button) {
        if (!confirm('Confirm this reservation? The lot will be marked Reserved.')) return;
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(`schedules/${id}`, { method: 'PUT', body: { status: 'Confirmed' } });
                if (result.success) {
                    await refreshAll();
                } else {
                    alert(result.error || 'Unable to confirm reservation.');
                }
            } catch (error) {
                alert(error.message || 'Unable to confirm reservation.');
            }
        });
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

        if (action === 'confirm') await confirmReservation(id, button);
        else if (action === 'complete') await completeReservation(id, button);
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
    clearFilters.addEventListener('click', async () => {
        searchQuery.value = '';
        statusFilter.value = '';
        currentQuery = '';
        currentStatus = '';
        pagination.reset();
        await loadAndRenderReservations();
    });

    await refreshAll();
});
