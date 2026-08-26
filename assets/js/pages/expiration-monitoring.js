document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireRole(['admin']);
    if (!user) return;

    // System-Wide AI Assistant (Phase 3): closes the exact gap the adviser
    // named directly ("if something is about to expire, it should notify
    // or inform the admin") — module-scoped since no single lease is
    // selected on page load.
    initAiAssistant({ mountSelector: '#aiAssistantMount', context: { scope: 'module', module: 'Expiration' } });

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

    const expiredPerPage = 10;
    const expiredPaginationInfo = document.getElementById('expiredPaginationInfo');
    const expiredPrevPage = document.getElementById('expiredPrevPage');
    const expiredNextPage = document.getElementById('expiredNextPage');
    const expiredPageJumpForm = document.getElementById('expiredPaginationJumpForm');
    const expiredPageJumpInput = document.getElementById('expiredPageJumpInput');
    const expiredPageJumpBtn = document.getElementById('expiredPageJumpBtn');
    const activeFilterChips = document.getElementById('activeFilterChips');
    const expiredPagination = createPagination({
        prevBtn: expiredPrevPage,
        nextBtn: expiredNextPage,
        jumpForm: expiredPageJumpForm,
        jumpInput: expiredPageJumpInput,
        jumpBtn: expiredPageJumpBtn,
        infoEl: expiredPaginationInfo,
        itemLabel: 'lot',
        onChange: loadExpiredLots,
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
        const searchValue = document.getElementById('expirationSearch').value.trim();
        const statusSelect = document.getElementById('expirationStatusFilter');
        const statusValue = statusSelect.value !== 'all' ? statusSelect.options[statusSelect.selectedIndex].text : '';
        const chips = [
            { key: 'q', label: 'Search', value: searchValue, clear: () => { document.getElementById('expirationSearch').value = ''; } },
            { key: 'status', label: 'Status', value: statusValue, clear: () => { statusSelect.value = 'all'; } },
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
                await refreshExpirationView();
            });
        });
    }

    // Independent of the main status filter dropdown above — this table's whole
    // purpose is showing expired lots, so it always requests status=expired
    // (still honoring the shared search box) rather than following whatever
    // the dropdown is set to.
    async function loadExpiredLots() {
        const expiredTable = document.getElementById('expiredTableBody');
        const query = document.getElementById('expirationSearch').value.trim();
        const params = new URLSearchParams();
        params.set('status', 'expired');
        if (query) params.append('q', query);
        params.set('page', expiredPagination.page);
        params.set('per_page', expiredPerPage);

        try {
            const result = await api.request(`expiration-records?${params.toString()}`, { method: 'GET' });
            const expiredRecords = Array.isArray(result.data) ? result.data : [];
            expiredTable.innerHTML = expiredRecords.length > 0 ? expiredRecords.map(record => `
                <tr>
                    <td>${record.lot_number || record.lot_id || 'N/A'}</td>
                    <td>${record.section_name || 'N/A'}</td>
                    <td>${record.end_date || 'N/A'}</td>
                    <td><span class="status-badge status-danger">Expired</span></td>
                    <td>${record.notes ? record.notes : '—'}</td>
                </tr>
            `).join('') : `
                <tr>
                    <td colspan="5">
                        <div class="expmon-empty-state">
                            <i class="fas fa-circle-check"></i>
                            <strong>No expired lots found</strong>
                            <span>All lots are within their lease period.</span>
                        </div>
                    </td>
                </tr>
            `;
            expiredPagination.render(result.meta || { page: 1, total_pages: 1, total: expiredRecords.length });
        } catch (error) {
            console.error('Failed to load expired lots:', error);
            expiredTable.innerHTML = '<tr><td colspan="5">Failed to load expired lots.</td></tr>';
            expiredPagination.render({ page: 1, total_pages: 1, total: 0 });
        }
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
                `).join('') : `
                    <tr>
                        <td colspan="5">
                            <div class="expmon-empty-state">
                                <i class="fas fa-hourglass"></i>
                                <strong>No expiration records found</strong>
                                <span>Adjust the filters to see more records.</span>
                            </div>
                        </td>
                    </tr>
                `;
            }
            renderActiveFilterChips();
        } catch (error) {
            console.error('Failed to load expiration data:', error);
        }
    }

    async function refreshExpirationView() {
        await loadExpirationData();
        expiredPagination.reset();
        await loadExpiredLots();
    }

    const refreshBtn = document.getElementById('refreshExpirationData');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', refreshExpirationView);
    }

    document.getElementById('expirationSearch').addEventListener('keyup', function(event) {
        if (event.key === 'Enter') {
            refreshExpirationView();
        }
    });
    document.getElementById('expirationStatusFilter').addEventListener('change', refreshExpirationView);

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
                await refreshExpirationView();
            }
        } catch (error) {
            console.error('Expiration action failed:', error);
            alert('Action failed: ' + (error.message || 'Unknown error'));
        }
    });

    await refreshExpirationView();
    await updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
