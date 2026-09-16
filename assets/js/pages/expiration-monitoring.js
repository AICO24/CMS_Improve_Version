document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireRole(['admin']);
    if (!user) return;

    // System-Wide AI Assistant: closes the exact gap the adviser named
    // directly ("if something is about to expire, it should notify or
    // inform the admin") — module-scoped since no single lease is selected
    // on page load.
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Expiration' },
        greeting: "Hello! I'm your AI assistant for Expiration Monitoring. How can I help you today?",
        suggestions: [
            { icon: 'fa-calendar-week', label: "What's expiring next week?", question: 'Which lot leases are expiring next week, and on what exact dates?' },
            { icon: 'fa-hourglass-half', label: 'Expiring this month', question: 'Which leases are expiring within the next 30 days?' },
            { icon: 'fa-rotate', label: 'Renewal status', question: 'How many leases have been renewed versus not renewed?' },
            { icon: 'fa-triangle-exclamation', label: 'Any exceptions?', question: 'Are there any open exceptions related to expiration or leases?' },
        ],
    });

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

    let currentTab = 'all';

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    async function populateSectionsDropdown() {
        const sectionSelect = document.getElementById('expirationSectionFilter');
        if (!sectionSelect) return;
        try {
            const sections = await api.request('sections', { method: 'GET' });
            if (Array.isArray(sections)) {
                sections.forEach(sec => {
                    const opt = document.createElement('option');
                    const name = sec.section_name || sec.name || '';
                    if (!name) return;
                    opt.value = name;
                    opt.textContent = name;
                    sectionSelect.appendChild(opt);
                });
            }
        } catch (err) {
            console.warn('Could not load sections:', err);
        }
    }

    function renderActiveFilterChips() {
        const searchValue = document.getElementById('expirationSearch').value.trim();
        const sectionSelect = document.getElementById('expirationSectionFilter');
        const sectionValue = sectionSelect && sectionSelect.value !== 'all' ? sectionSelect.value : '';
        const urgencySelect = document.getElementById('expirationUrgencyFilter');
        const urgencyValue = urgencySelect && urgencySelect.value !== 'all' ? urgencySelect.options[urgencySelect.selectedIndex].text : '';
        const statusSelect = document.getElementById('expirationStatusFilter');
        const statusValue = statusSelect && statusSelect.value !== 'all' ? statusSelect.options[statusSelect.selectedIndex].text : '';
        const tabLabel = currentTab !== 'all' ? `Tab: ${currentTab.charAt(0).toUpperCase() + currentTab.slice(1)}` : '';

        const chips = [
            { key: 'q', label: 'Search', value: searchValue, clear: () => { document.getElementById('expirationSearch').value = ''; } },
            { key: 'section', label: 'Section', value: sectionValue, clear: () => { if (sectionSelect) sectionSelect.value = 'all'; } },
            { key: 'urgency', label: 'Timeline', value: urgencyValue, clear: () => { if (urgencySelect) urgencySelect.value = 'all'; } },
            { key: 'status', label: 'Status', value: statusValue, clear: () => { if (statusSelect) statusSelect.value = 'all'; } },
            { key: 'tab', label: 'Filter Tab', value: tabLabel, clear: () => {
                currentTab = 'all';
                document.querySelectorAll('.records-tab-btn').forEach(b => {
                    b.classList.toggle('active', b.dataset.tab === 'all');
                    b.setAttribute('aria-selected', b.dataset.tab === 'all' ? 'true' : 'false');
                });
            } }
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
            const section = document.getElementById('expirationSectionFilter') ? document.getElementById('expirationSectionFilter').value : 'all';
            const urgency = document.getElementById('expirationUrgencyFilter') ? document.getElementById('expirationUrgencyFilter').value : 'all';
            const status = document.getElementById('expirationStatusFilter') ? document.getElementById('expirationStatusFilter').value : 'all';

            const params = new URLSearchParams();
            if (query) params.append('q', query);
            if (section && section !== 'all') params.append('section', section);
            if (urgency && urgency !== 'all') params.append('urgency', urgency);

            if (currentTab !== 'all') {
                params.append('status', currentTab);
            } else if (status && status !== 'all') {
                params.append('status', status);
            }

            const [records, stats] = await Promise.all([
                api.request(`expiration-records?${params.toString()}`, { method: 'GET' }),
                api.request('expiration-records/stats', { method: 'GET' })
            ]);

            const statusMsg = document.getElementById('expirationStatusMessage');
            if (statusMsg) {
                const activeFilters = [];
                if (currentTab !== 'all') activeFilters.push(`Tab: ${currentTab}`);
                if (status !== 'all') activeFilters.push(`Status: ${status}`);
                if (section !== 'all') activeFilters.push(`Section: ${section}`);
                if (urgency !== 'all') activeFilters.push(`Timeline: ${urgency}`);
                statusMsg.innerText = activeFilters.length ? `Showing filtered results for ${activeFilters.join(', ')}.` : '';
            }

            const totalTrackedCount = document.getElementById('totalTrackedCount');
            const expiringSoonCount = document.getElementById('expiringSoonCount');
            const expiredCount = document.getElementById('expiredCount');
            const renewalsDueCount = document.getElementById('renewalsDueCount');
            const exhumationCount = document.getElementById('exhumationCount');

            if (totalTrackedCount) totalTrackedCount.innerText = stats.total ?? 0;
            if (expiringSoonCount) expiringSoonCount.innerText = stats.expiring_soon ?? 0;
            if (expiredCount) expiredCount.innerText = stats.expired ?? 0;
            if (renewalsDueCount) renewalsDueCount.innerText = stats.renewals_due ?? 0;
            if (exhumationCount) exhumationCount.innerText = stats.exhumations ?? 0;

            // Sub-tab counter badges
            const expiringSoonBadge = document.getElementById('expiringSoonBadge');
            if (expiringSoonBadge) {
                if (stats.expiring_soon > 0) {
                    expiringSoonBadge.innerText = stats.expiring_soon;
                    expiringSoonBadge.style.display = 'inline-flex';
                } else {
                    expiringSoonBadge.style.display = 'none';
                }
            }

            const expiredBadge = document.getElementById('expiredBadge');
            if (expiredBadge) {
                if (stats.expired > 0) {
                    expiredBadge.innerText = stats.expired;
                    expiredBadge.style.display = 'inline-flex';
                } else {
                    expiredBadge.style.display = 'none';
                }
            }

            const upcomingTable = document.getElementById('upcomingTableBody');
            const recordsList = Array.isArray(records) ? records : (records.data || []);

            if (upcomingTable) {
                upcomingTable.innerHTML = recordsList.length > 0 ? recordsList.slice(0, 5).map(record => `
                    <tr data-lot-id="${record.lot_id || ''}" data-start-date="${record.start_date || ''}" data-exhumation-status="${record.exhumation_status || ''}" data-notes="${(record.notes || '').replace(/"/g, '&quot;')}">
                        <td>${record.lot_number || record.lot_id || 'N/A'}</td>
                        <td>${record.section_name || 'N/A'}</td>
                        <td>${record.end_date || 'N/A'}</td>
                        <td><span class="status-badge ${record.status === 'Expired' ? 'status-danger' : record.status === 'Exhumation' ? 'status-danger' : record.status === 'Renewed' ? 'status-info' : 'status-warning'}">${record.status || 'Expiring'}</span></td>
                        <td>
                            <button class="btn-ghost" data-action="notify" data-id="${record.expiration_id}">Notify</button>
                            ${record.status === 'Expiring' || record.status === 'Expired' ? `<button class="btn-ghost" data-action="renew" data-id="${record.expiration_id}">Renew</button>` : ''}
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

    // Sub-Tabs segmented switcher
    document.querySelectorAll('.records-tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('.records-tab-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            btn.classList.add('active');
            btn.setAttribute('aria-selected', 'true');
            currentTab = btn.dataset.tab || 'all';
            refreshExpirationView();
        });
    });

    // Reset filters button
    const resetFiltersBtn = document.getElementById('resetFiltersBtn');
    if (resetFiltersBtn) {
        resetFiltersBtn.addEventListener('click', () => {
            document.getElementById('expirationSearch').value = '';
            const sec = document.getElementById('expirationSectionFilter');
            if (sec) sec.value = 'all';
            const urg = document.getElementById('expirationUrgencyFilter');
            if (urg) urg.value = 'all';
            const stat = document.getElementById('expirationStatusFilter');
            if (stat) stat.value = 'all';
            currentTab = 'all';
            document.querySelectorAll('.records-tab-btn').forEach(b => {
                b.classList.toggle('active', b.dataset.tab === 'all');
                b.setAttribute('aria-selected', b.dataset.tab === 'all' ? 'true' : 'false');
            });
            refreshExpirationView();
        });
    }

    // Auto-Sync Leases button
    const autoSyncBtn = document.getElementById('autoSyncBtn');
    if (autoSyncBtn) {
        autoSyncBtn.addEventListener('click', async () => {
            try {
                autoSyncBtn.disabled = true;
                const res = await api.request('expiration-records/sync', { method: 'POST' });
                alert(res.message || 'Leases synced successfully from lots registry!');
                await refreshExpirationView();
            } catch (err) {
                console.error('Auto-sync failed:', err);
                alert('Auto-sync failed: ' + (err.message || 'Unknown error'));
            } finally {
                autoSyncBtn.disabled = false;
            }
        });
    }

    // Send Reminders button
    const bulkNotifyBtn = document.getElementById('bulkNotifyBtn');
    if (bulkNotifyBtn) {
        bulkNotifyBtn.addEventListener('click', async () => {
            try {
                bulkNotifyBtn.disabled = true;
                const res = await api.request('expiration-records/generate-notifications', { method: 'POST' });
                alert(res.message || 'Reminders generated successfully!');
                await updateNotificationBadge();
                await refreshExpirationView();
            } catch (err) {
                console.error('Bulk notify failed:', err);
                alert('Send reminders failed: ' + (err.message || 'Unknown error'));
            } finally {
                bulkNotifyBtn.disabled = false;
            }
        });
    }

    // Export CSV button
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', async () => {
            try {
                const allData = await api.request('expiration-records', { method: 'GET' });
                const list = Array.isArray(allData) ? allData : (allData.data || []);
                if (!list.length) {
                    alert('No expiration records available to export.');
                    return;
                }
                const headers = ['Expiration ID', 'Lot Number', 'Section', 'Block', 'Status', 'Days Remaining', 'Start Date', 'End Date', 'Renewed', 'Exhumation Status', 'Deceased Occupant', 'Contact Person', 'Contact Number', 'Notes'];
                const rows = list.map(r => [
                    r.expiration_id,
                    `"${r.lot_number || ''}"`,
                    `"${r.section_name || ''}"`,
                    `"${r.block_name || ''}"`,
                    `"${r.status || ''}"`,
                    r.days_remaining ?? '',
                    r.start_date || '',
                    r.end_date || '',
                    r.renewed || 'no',
                    `"${r.exhumation_status || ''}"`,
                    `"${r.decedent_name || ''}"`,
                    `"${r.contact_name || ''}"`,
                    `"${r.contact_number || ''}"`,
                    `"${(r.notes || '').replace(/"/g, '""')}"`
                ]);
                const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
                const encodedUri = encodeURI(csvContent);
                const link = document.createElement('a');
                link.setAttribute('href', encodedUri);
                link.setAttribute('download', `expiration_records_${new Date().toISOString().slice(0, 10)}.csv`);
                document.body.appendChild(link);
                link.click();
                document.body.removeChild(link);
            } catch (err) {
                console.error('Export CSV failed:', err);
                alert('Export failed: ' + (err.message || 'Unknown error'));
            }
        });
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

    const secFilter = document.getElementById('expirationSectionFilter');
    if (secFilter) secFilter.addEventListener('change', refreshExpirationView);

    const urgFilter = document.getElementById('expirationUrgencyFilter');
    if (urgFilter) urgFilter.addEventListener('change', refreshExpirationView);

    const statFilter = document.getElementById('expirationStatusFilter');
    if (statFilter) statFilter.addEventListener('change', refreshExpirationView);

    await populateSectionsDropdown();

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
