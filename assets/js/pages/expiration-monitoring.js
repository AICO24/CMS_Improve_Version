document.addEventListener('DOMContentLoaded', async function () {
    const user = await requireRole(['admin']);
    if (!user) return;

    // AI Assistant widget
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

    let currentTab = 'all';
    const perPage = 10;
    let cachedRecords = [];

    const paginationInfo = document.getElementById('expirationPaginationInfo');
    const prevPageBtn = document.getElementById('expirationPrevPage');
    const nextPageBtn = document.getElementById('expirationNextPage');
    const pageJumpForm = document.getElementById('expirationPaginationJumpForm');
    const pageJumpInput = document.getElementById('expirationPageJumpInput');
    const pageJumpBtn = document.getElementById('expirationPageJumpBtn');
    const activeFilterChips = document.getElementById('activeFilterChips');

    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        infoEl: paginationInfo,
        itemLabel: 'lease record',
        onChange: loadExpirationData,
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

    function formatDate(dateString) {
        if (!dateString) return '—';
        const date = new Date(dateString);
        if (isNaN(date.getTime())) return dateString;
        return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
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
                pagination.reset();
                await refreshExpirationView();
            });
        });
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
        const tableBody = document.getElementById('expirationTableBody');
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

        params.append('page', pagination.page);
        params.append('per_page', perPage);

        try {
            const [recordsResult, stats] = await Promise.all([
                api.request(`expiration-records?${params.toString()}`, { method: 'GET' }),
                api.request('expiration-records/stats', { method: 'GET' })
            ]);

            // Update 5 Stat Cards
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

            const recordsList = Array.isArray(recordsResult) ? recordsResult : (recordsResult.data || []);
            const meta = recordsResult.meta || { page: 1, total_pages: 1, total: recordsList.length };
            cachedRecords = recordsList;

            // Table header badge & summary
            const badgeCount = document.getElementById('expirationBadgeCount');
            if (badgeCount) badgeCount.innerText = `${meta.total ?? recordsList.length} lots`;

            const filterSummary = document.getElementById('tableFilterSummary');
            if (filterSummary) {
                const parts = [];
                if (currentTab !== 'all') parts.push(`Tab: ${currentTab}`);
                if (status !== 'all') parts.push(`Status: ${status}`);
                if (section !== 'all') parts.push(`Section: ${section}`);
                if (urgency !== 'all') parts.push(`Timeline: ${urgency}`);
                filterSummary.innerText = parts.length ? `Filtered by ${parts.join(', ')}` : 'Showing all tracked leases';
            }

            if (!tableBody) return;

            if (recordsList.length === 0) {
                tableBody.innerHTML = `
                    <tr>
                        <td colspan="6">
                            <div class="expmon-empty-state">
                                <i class="fas fa-hourglass"></i>
                                <strong>No expiration records found</strong>
                                <span>Adjust your search keywords or filter criteria.</span>
                            </div>
                        </td>
                    </tr>
                `;
            } else {
                tableBody.innerHTML = recordsList.map(record => {
                    const daysRemaining = Number(record.days_remaining);
                    let countdownBadgeHtml = '';

                    if (record.renewed === 'yes') {
                        countdownBadgeHtml = `<span class="timeline-badge timeline-renewed"><i class="fas fa-rotate"></i> Renewed</span>`;
                    } else if (daysRemaining < 0) {
                        countdownBadgeHtml = `<span class="timeline-badge timeline-overdue"><i class="fas fa-triangle-exclamation"></i> Overdue by ${Math.abs(daysRemaining)}d</span>`;
                    } else if (daysRemaining <= 30) {
                        countdownBadgeHtml = `<span class="timeline-badge timeline-expiring"><i class="fas fa-clock"></i> Expiring in ${daysRemaining}d</span>`;
                    } else {
                        countdownBadgeHtml = `<span class="timeline-badge timeline-active"><i class="fas fa-check-circle"></i> Active (${daysRemaining}d left)</span>`;
                    }

                    const statusBadgeClass = record.status === 'Expired' 
                        ? 'status-danger' 
                        : record.status === 'Exhumation' 
                        ? 'status-danger' 
                        : record.status === 'Renewed' 
                        ? 'status-success' 
                        : record.status === 'Expiring' 
                        ? 'status-warning' 
                        : 'status-active';

                    const noticeBadgeHtml = record.notified_at 
                        ? `<span class="notice-badge notice-sent" title="Notified on ${formatDate(record.notified_at)}"><i class="fas fa-check-double"></i> Notified</span>` 
                        : `<span class="notice-badge notice-pending"><i class="fas fa-envelope"></i> Unnotified</span>`;

                    return `
                    <tr data-id="${record.expiration_id}" data-lot-id="${record.lot_id || ''}">
                        <td>
                            <div class="lot-cell">
                                <span class="lot-number-chip">${escapeHtml(record.lot_number || 'LOT-' + record.lot_id)}</span>
                                <span class="lot-location-meta">${escapeHtml(record.section_name || 'N/A')} • ${escapeHtml(record.block_name || 'Block')}</span>
                            </div>
                        </td>
                        <td>
                            <div class="decedent-cell">
                                <span class="decedent-name">
                                    <i class="fas fa-cross"></i> ${escapeHtml(record.decedent_name || 'Unassigned Occupant')}
                                </span>
                                <span class="contact-meta">
                                    <i class="fas fa-user-tag"></i> ${escapeHtml(record.contact_name || 'No Contact Person')}
                                    ${record.contact_number ? '• ' + escapeHtml(record.contact_number) : ''}
                                </span>
                            </div>
                        </td>
                        <td>
                            <div class="timeline-cell">
                                <span class="timeline-dates">
                                    ${formatDate(record.start_date)} <i class="fas fa-arrow-right"></i> ${formatDate(record.end_date)}
                                </span>
                                ${countdownBadgeHtml}
                            </div>
                        </td>
                        <td>
                            <span class="status-badge ${statusBadgeClass}">
                                ${record.status === 'Exhumation' ? '<i class="fas fa-truck-moving"></i> ' : ''}${escapeHtml(record.status || 'Active')}
                            </span>
                        </td>
                        <td>
                            ${noticeBadgeHtml}
                        </td>
                        <td class="action-buttons">
                            <button class="btn-action-icon btn-view" data-id="${record.expiration_id}" title="View Lease Details" aria-label="View Lease Details">
                                <i class="fas fa-eye"></i>
                            </button>
                            <button class="btn-action-icon btn-renew" data-id="${record.expiration_id}" title="Renew Lease" aria-label="Renew Lease">
                                <i class="fas fa-rotate"></i>
                            </button>
                            <button class="btn-action-icon btn-notify" data-id="${record.expiration_id}" data-lot="${escapeHtml(record.lot_number || '')}" title="Send Reminder Notice" aria-label="Send Reminder Notice">
                                <i class="fas fa-paper-plane"></i>
                            </button>
                            <button class="btn-action-icon btn-relocate" data-id="${record.expiration_id}" title="Initiate Relocation / Exhumation" aria-label="Initiate Relocation / Exhumation">
                                <i class="fas fa-truck-moving"></i>
                            </button>
                            <button class="btn-action-icon btn-delete-row" data-id="${record.expiration_id}" title="Delete Record" aria-label="Delete Record">
                                <i class="fas fa-trash"></i>
                            </button>
                        </td>
                    </tr>
                    `;
                }).join('');
            }

            pagination.render(meta);
            renderActiveFilterChips();
            wireTableActionButtons();
        } catch (error) {
            console.error('Failed to load expiration data:', error);
            if (tableBody) tableBody.innerHTML = '<tr><td colspan="6">Failed to load expiration records.</td></tr>';
            pagination.render({ page: 1, total_pages: 1, total: 0 });
        }
    }

    function wireTableActionButtons() {
        const tbody = document.getElementById('expirationTableBody');
        if (!tbody) return;

        // 1. View Button
        tbody.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const rec = cachedRecords.find(r => String(r.expiration_id) === String(id));
                if (rec && typeof window.showExpirationViewModal === 'function') {
                    window.showExpirationViewModal(rec);
                } else {
                    alert(`Viewing lease details for Lot ${rec?.lot_number || id} (Full details modal will load in Batch 4).`);
                }
            });
        });

        // 2. Renew Button
        tbody.querySelectorAll('.btn-renew').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const rec = cachedRecords.find(r => String(r.expiration_id) === String(id));
                const termStr = prompt(`Renew lease for Lot ${rec?.lot_number || id}?\nEnter renewal term in years:`, "5");
                if (!termStr) return;
                const years = parseInt(termStr, 10);
                if (isNaN(years) || years <= 0) {
                    alert('Please enter a valid positive number of years.');
                    return;
                }
                try {
                    const res = await api.request(`expiration-records/${id}/renew`, {
                        method: 'POST',
                        body: { years, notes: `Renewed for ${years} years via quick action.` }
                    });
                    alert(res.message || 'Lease renewed successfully!');
                    await refreshExpirationView();
                } catch (err) {
                    alert('Renewal failed: ' + (err.message || 'Unknown error'));
                }
            });
        });

        // 3. Send Notice Button
        tbody.querySelectorAll('.btn-notify').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const lot = btn.dataset.lot || id;
                if (!confirm(`Send expiration notice notification for Lot ${lot}?`)) return;

                try {
                    await api.request('notifications', {
                        method: 'POST',
                        body: {
                            title: `Expiration reminder: Lot ${lot}`,
                            message: `Official expiration notice dispatched for Lot ${lot}. Next-of-kin has been flagged for contact.`,
                            notification_type: 'Expiration',
                            is_read: 0
                        }
                    });
                    alert(`Reminder notification sent for Lot ${lot}!`);
                    await updateNotificationBadge();
                    await refreshExpirationView();
                } catch (err) {
                    alert('Notice dispatch failed: ' + (err.message || 'Unknown error'));
                }
            });
        });

        // 4. Relocate / Exhumation Button
        tbody.querySelectorAll('.btn-relocate').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const rec = cachedRecords.find(r => String(r.expiration_id) === String(id));
                if (!confirm(`Initiate relocation / exhumation request for expired Lot ${rec?.lot_number || id}?\nThis will create a formal request in the Relocation Management module.`)) return;

                try {
                    const res = await api.request(`expiration-records/${id}/initiate-relocation`, {
                        method: 'POST',
                        body: { reason: `Lease expired on ${rec?.end_date || 'N/A'}. Initiated from Expiration Monitoring.` }
                    });
                    alert(res.message || 'Relocation request initiated successfully!');
                    await refreshExpirationView();
                } catch (err) {
                    alert('Relocation initiation failed: ' + (err.message || 'Unknown error'));
                }
            });
        });

        // 5. Delete Button
        tbody.querySelectorAll('.btn-delete-row').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.dataset.id;
                const rec = cachedRecords.find(r => String(r.expiration_id) === String(id));
                if (!confirm(`Are you sure you want to delete the expiration record for Lot ${rec?.lot_number || id}?`)) return;

                try {
                    const res = await api.request(`expiration-records/${id}`, { method: 'DELETE' });
                    alert(res.message || 'Expiration record deleted.');
                    await refreshExpirationView();
                } catch (err) {
                    alert('Delete failed: ' + (err.message || 'Unknown error'));
                }
            });
        });
    }

    async function refreshExpirationView() {
        await loadExpirationData();
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
            pagination.reset();
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
            pagination.reset();
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
                pagination.reset();
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

    // Live search input
    document.getElementById('expirationSearch').addEventListener('keyup', function (event) {
        if (event.key === 'Enter') {
            pagination.reset();
            refreshExpirationView();
        }
    });

    const secFilter = document.getElementById('expirationSectionFilter');
    if (secFilter) secFilter.addEventListener('change', () => {
        pagination.reset();
        refreshExpirationView();
    });

    const urgFilter = document.getElementById('expirationUrgencyFilter');
    if (urgFilter) urgFilter.addEventListener('change', () => {
        pagination.reset();
        refreshExpirationView();
    });

    const statFilter = document.getElementById('expirationStatusFilter');
    if (statFilter) statFilter.addEventListener('change', () => {
        pagination.reset();
        refreshExpirationView();
    });

    await populateSectionsDropdown();
    await refreshExpirationView();
    await updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
