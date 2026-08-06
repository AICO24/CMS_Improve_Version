document.addEventListener('DOMContentLoaded', async function() {
    try {
        const user = await api.getMe();
        if (!user) {
            window.location.href = `${getFrontendBasePath()}/auth/login.html`;
            return;
        }
        document.getElementById('userName').innerText = user.full_name || user.username;
        document.getElementById('userRole').innerText = user.role === 'admin' ? 'Administrator' : 'User';
        document.getElementById('sidebarUserName').innerText = user.full_name || user.username;
        document.getElementById('sidebarUserRole').innerText = user.role === 'admin' ? 'Administrator' : 'User';
    } catch (error) {
        console.error('Auth error', error);
        window.location.href = `${getFrontendBasePath()}/auth/login.html`;
        return;
    }

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
    const reservationsBody = document.getElementById('reservationsBody');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');

    let currentPage = 1;
    let pageCount = 1;
    let totalReservations = 0;
    let perPage = 10;
    let currentQuery = '';
    let currentStatus = '';

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
        params.set('page', currentPage);
        params.set('per_page', perPage);
        if (currentQuery.trim()) params.set('q', currentQuery.trim());
        if (currentStatus) params.set('status', currentStatus);

        try {
            const result = await api.request(`schedules/mine?${params.toString()}`, { method: 'GET' });
            const data = Array.isArray(result.data) ? result.data : [];
            totalReservations = result.meta?.total || 0;
            pageCount = result.meta?.pages || 1;
            currentPage = result.meta?.page || currentPage;
            reservationsBody.innerHTML = data.length > 0
                ? data.map(buildReservationRow).join('')
                : '<tr><td colspan="7">No reservations found for the selected criteria.</td></tr>';
            paginationInfo.textContent = `Page ${currentPage} of ${pageCount} • ${totalReservations} reservation${totalReservations === 1 ? '' : 's'}`;
            prevPage.disabled = currentPage <= 1;
            nextPage.disabled = currentPage >= pageCount;
        } catch (error) {
            console.error('Failed to load reservations', error);
            reservationsBody.innerHTML = '<tr><td colspan="7">Unable to load reservations right now.</td></tr>';
            paginationInfo.textContent = '';
            prevPage.disabled = true;
            nextPage.disabled = true;
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
        await cancelReservation(scheduleId);
    });

    function debounce(fn, delay = 300) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }

    const refreshReservations = debounce(async () => {
        currentPage = 1;
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
        currentPage = 1;
        await loadReservations();
    });

    prevPage.addEventListener('click', async () => {
        if (currentPage <= 1) return;
        currentPage -= 1;
        await loadReservations();
    });

    nextPage.addEventListener('click', async () => {
        if (currentPage >= pageCount) return;
        currentPage += 1;
        await loadReservations();
    });

    await loadReservations();
});
