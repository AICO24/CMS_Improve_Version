document.addEventListener('DOMContentLoaded', async function () {
    try {
        const user = await api.getMe();
        document.getElementById('userName').innerText = user.full_name || user.username;
        document.getElementById('userRole').innerText = user.role === 'admin' ? 'Administrator' : 'Staff';
        document.getElementById('sidebarUserName').innerText = user.full_name || user.username;
        document.getElementById('sidebarUserRole').innerText = user.role === 'admin' ? 'Administrator' : 'Staff';
        if (user.role !== 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        } else {
            document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'flex'; el.classList.remove('admin-only'); });
        }
    } catch (error) {
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

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => api.logout());
    }

    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.innerText = result.count || 0;
                badge.style.display = result.count > 0 ? 'flex' : 'none';
            }
        } catch (e) {
            console.error('Failed to load notifications count:', e);
        }
    }

    async function loadExpirationData() {
        try {
            const query = document.getElementById('expirationSearch').value.trim();
            const status = document.getElementById('expirationStatusFilter').value;
            const params = new URLSearchParams();
            if (query) params.append('q', query);
            if (status && status !== 'all') params.append('status', status);

            const [records, stats] = await Promise.all([
                api.request(`expiration-records?${params.toString()}`, { method: 'GET' }),
                api.request('expiration-records/stats', { method: 'GET' })
            ]);

            document.getElementById('expirationStatusMessage').innerText = status === 'all' ? '' : `Showing filtered results for ${status}.`;

            const expiringSoonCount = document.getElementById('expiringSoonCount');
            const expiredCount = document.getElementById('expiredCount');
            const renewalsDueCount = document.getElementById('renewalsDueCount');
            const exhumationCount = document.getElementById('exhumationCount');
            if (expiringSoonCount) expiringSoonCount.innerText = stats.expiring_soon || 0;
            if (expiredCount) expiredCount.innerText = stats.expired || 0;
            if (renewalsDueCount) renewalsDueCount.innerText = stats.renewals_due || 0;
            if (exhumationCount) exhumationCount.innerText = stats.exhumations || 0;

            const upcomingTable = document.getElementById('upcomingTableBody');
            const expiredTable = document.getElementById('expiredTableBody');
            const recordsList = Array.isArray(records) ? records : [];

            if (upcomingTable) {
                upcomingTable.innerHTML = recordsList.length > 0 ? recordsList.slice(0, 3).map(record => `
                    <tr data-lot-id="${record.lot_id || ''}" data-start-date="${record.start_date || ''}" data-exhumation-status="${record.exhumation_status || ''}" data-notes="${(record.notes || '').replace(/"/g, '&quot;')}">
                        <td>${record.lot_number || record.lot_id || 'N/A'}</td>
                        <td>${record.section_name || 'N/A'}</td>
                        <td>${record.end_date || 'N/A'}</td>
                        <td><span class="status-badge ${record.status === 'Expired' ? 'status-danger' : record.status === 'Exhumation' ? 'status-danger' : 'status-warning'}">${record.status || 'Expiring'}</span></td>
                        <td>
                            <button class="btn-ghost" data-action="notify" data-id="${record.expiration_id}">Notify</button>
                            ${record.status === 'Expiring' ? `<button class="btn-ghost" data-action="renew" data-id="${record.expiration_id}">Renew</button>` : ''}
                        </td>
                    </tr>
                `).join('') : '<tr><td colspan="5">No expiration records found.</td></tr>';
            }

            if (expiredTable) {
                const expiredRecords = recordsList.filter(record => (record.status || '').toLowerCase() === 'expired');
                expiredTable.innerHTML = expiredRecords.length > 0 ? expiredRecords.map(record => `
                    <tr>
                        <td>${record.lot_number || record.lot_id || 'N/A'}</td>
                        <td>${record.section_name || 'N/A'}</td>
                        <td>${record.end_date || 'N/A'}</td>
                        <td><span class="status-badge status-danger">Expired</span></td>
                        <td>${record.notes ? record.notes : '—'}</td>
                    </tr>
                `).join('') : '<tr><td colspan="5">No expired lots found.</td></tr>';
            }
        } catch (error) {
            console.error('Failed to load expiration data:', error);
        }
    }

    const refreshBtn = document.getElementById('refreshExpirationData');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', loadExpirationData);
    }

    document.getElementById('expirationSearch').addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            loadExpirationData();
        }
    });
    document.getElementById('expirationStatusFilter').addEventListener('change', loadExpirationData);

    document.querySelector('.content-area').addEventListener('click', async function(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;

        const action = button.dataset.action;
        const id = button.dataset.id;
        const record = button.closest('tr');
        if (!id) return;

        try {
            if (action === 'notify') {
                const title = 'Expiration reminder: lot ' + (record.querySelector('td:first-child')?.innerText || id);
                const message = 'Please review the expiration record for lot ' + (record.querySelector('td:first-child')?.innerText || id) + ' before lease expiration.';
                await api.request('notifications', {
                    method: 'POST',
                    body: {
                        title,
                        message,
                        notification_type: 'Expiration',
                        is_read: 0
                    }
                });
                alert('Notification created for the selected expiration.');
                await updateNotificationBadge();
            }

            if (action === 'renew') {
                const recordId = id;
                const payload = {
                    lot_id: record.dataset.lotId || null,
                    start_date: record.dataset.startDate || null,
                    end_date: record.querySelector('td:nth-child(3)')?.innerText || null,
                    renewed: 'yes',
                    exhumation_status: record.dataset.exhumationStatus || 'Pending',
                    notes: record.dataset.notes || ''
                };

            if (!payload.lot_id) {
                alert('Unable to renew this record, required information missing.');
                return;
            }

            await api.request(`expiration-records/${recordId}`, {
                method: 'PUT',
                body: payload
            });
            alert('Expiration record renewed successfully.');
            await loadExpirationData();
        } catch (error) {
            console.error('Expiration action failed:', error);
            alert('Action failed: ' + (error.message || 'Unknown error'));
        }
    });

    await loadExpirationData();
    await updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
