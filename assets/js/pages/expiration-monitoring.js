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
                                    <i class="fas fa-cross"></i> ${escapeHtml((record.decedent_name && record.decedent_name.trim()) ? record.decedent_name.trim() : 'Unassigned Occupant')}
                                </span>
                                <span class="contact-meta">
                                    <i class="fas fa-user-tag"></i> ${escapeHtml((record.contact_name && record.contact_name.trim()) ? record.contact_name.trim() : 'No Contact Person')}
                                    ${(record.contact_number && record.contact_number.trim()) ? '• ' + escapeHtml(record.contact_number.trim()) : ''}
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

    let currentActiveRecord = null;

    function getStatusAndCountdownPills(record) {
        const daysRemaining = record.days_remaining != null ? parseInt(record.days_remaining, 10) : null;
        let statusBadge = '';
        let countdownBadge = '';

        if (record.renewed === 'yes') {
            statusBadge = `<span class="timeline-badge renewed"><i class="fas fa-rotate"></i> Renewed</span>`;
            countdownBadge = `<span class="view-lifespan-pill" style="background:rgba(16,185,129,0.15);color:#059669;"><i class="fas fa-circle-check"></i> Active &amp; Renewed</span>`;
        } else if (daysRemaining != null && daysRemaining < 0) {
            statusBadge = `<span class="timeline-badge overdue"><i class="fas fa-skull"></i> Overdue (${Math.abs(daysRemaining)}d)</span>`;
            countdownBadge = `<span class="view-lifespan-pill" style="background:rgba(239,68,68,0.15);color:#dc2626;"><i class="fas fa-clock"></i> Expired ${Math.abs(daysRemaining)} days ago</span>`;
        } else if (daysRemaining != null && daysRemaining <= 30) {
            statusBadge = `<span class="timeline-badge expiring"><i class="fas fa-triangle-exclamation"></i> Expiring Soon (${daysRemaining}d)</span>`;
            countdownBadge = `<span class="view-lifespan-pill" style="background:rgba(245,158,11,0.15);color:#d97706;"><i class="fas fa-hourglass-half"></i> ${daysRemaining} days left</span>`;
        } else {
            statusBadge = `<span class="timeline-badge active"><i class="fas fa-circle-check"></i> Active</span>`;
            countdownBadge = `<span class="view-lifespan-pill"><i class="fas fa-hourglass-half"></i> ${daysRemaining != null ? daysRemaining + ' days left' : 'Active Lease'}</span>`;
        }
        return { statusBadge, countdownBadge, daysRemaining };
    }

    async function openViewModal(id) {
        let record = cachedRecords.find(r => String(r.expiration_id) === String(id));
        try {
            const fetched = await api.request(`expiration-records/${id}`, { method: 'GET' });
            if (fetched && !fetched.error) {
                record = fetched;
            }
        } catch (e) {
            console.warn('Could not fetch fresh record details, using cached copy:', e);
        }

        if (!record) {
            alert('Lease record details could not be found.');
            return;
        }

        currentActiveRecord = record;
        const { statusBadge, countdownBadge, daysRemaining } = getStatusAndCountdownPills(record);

        const viewDetails = document.getElementById('viewDetails');
        if (viewDetails) {
            viewDetails.innerHTML = `
                <!-- Hero Profile Card -->
                <div class="view-hero-card">
                    <div class="view-hero-avatar">
                        <i class="fas fa-monument"></i>
                    </div>
                    <div class="view-hero-info">
                        <div class="view-hero-title-row">
                            <h2 class="view-decedent-name">Lot ${escapeHtml(record.lot_number || 'N/A')}</h2>
                            <div class="view-status-wrap">
                                ${statusBadge}
                                ${countdownBadge}
                            </div>
                        </div>
                        <div class="view-hero-route">
                            <span class="view-section-tag"><i class="fas fa-layer-group"></i> ${escapeHtml(record.section_name || 'General Section')}</span>
                            <span class="view-lot-tag"><i class="fas fa-thumbtack"></i> Block ${escapeHtml(record.block_name || '1')}</span>
                            <span><i class="fas fa-calendar-alt"></i> Term: ${escapeHtml(record.start_date || '—')} to ${escapeHtml(record.end_date || '—')}</span>
                        </div>
                    </div>
                </div>

                <!-- 2-Column Info Grid -->
                <div class="view-details-grid">
                    <!-- Card 1: Lease & Lot Specs -->
                    <div class="view-info-card">
                        <div class="view-card-header">
                            <i class="fas fa-hourglass-half"></i>
                            <span>Lease Tenure &amp; Lot Specs</span>
                        </div>
                        <div class="view-card-body">
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-shapes"></i> Lot Type</span>
                                <strong class="prop-value">${escapeHtml(record.lot_type_name || 'Standard Grave')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-ruler-combined"></i> Dimensions</span>
                                <strong class="prop-value">${escapeHtml(record.dimensions || 'Standard')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-calendar-check"></i> Lease Start</span>
                                <strong class="prop-value">${escapeHtml(record.start_date || '—')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-calendar-xmark"></i> Lease End</span>
                                <strong class="prop-value" style="color:${daysRemaining < 0 ? '#dc2626' : (daysRemaining <= 30 ? '#d97706' : '#1e293b')}">${escapeHtml(record.end_date || '—')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-rotate"></i> Renewal Status</span>
                                <strong class="prop-value">${record.renewed === 'yes' ? '<span class="view-section-tag" style="background:#ecfdf5;color:#059669;"><i class="fas fa-check"></i> Renewed</span>' : '<span class="view-section-tag" style="background:#fff1f2;color:#e11d48;">Not Renewed</span>'}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-truck-moving"></i> Exhumation / Reloc.</span>
                                <strong class="prop-value">${escapeHtml(record.exhumation_status || 'Pending')}</strong>
                            </div>
                            ${record.location_notes ? `
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-map-pin"></i> Location Notes</span>
                                <strong class="prop-value">${escapeHtml(record.location_notes)}</strong>
                            </div>` : ''}
                        </div>
                    </div>

                    <!-- Card 2: Deceased & Next of Kin -->
                    <div class="view-info-card">
                        <div class="view-card-header">
                            <i class="fas fa-user-group"></i>
                            <span>Deceased &amp; Family Contact</span>
                        </div>
                        <div class="view-card-body">
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-monument"></i> Deceased Occupant</span>
                                <strong class="prop-value">${escapeHtml(record.decedent_name || 'No recorded occupant')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-dove"></i> Date of Interment</span>
                                <strong class="prop-value">${escapeHtml(record.dod || record.start_date || '—')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-user-shield"></i> Family Contact</span>
                                <strong class="prop-value">${escapeHtml(record.contact_name || 'Unassigned')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-phone"></i> Contact Phone</span>
                                <strong class="prop-value">
                                    ${record.contact_number ? `<a href="tel:${escapeHtml(record.contact_number)}" class="prop-phone-link"><i class="fas fa-phone-volume"></i> ${escapeHtml(record.contact_number)}</a>` : '—'}
                                </strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-bell"></i> Last Notified</span>
                                <strong class="prop-value">${escapeHtml(record.notified_at || 'No notice dispatched yet')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-clipboard"></i> Notes / Remarks</span>
                                <strong class="prop-value" style="font-size:0.76rem;">${escapeHtml(record.notes || 'None')}</strong>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        }

        // Populate Notices List
        const noticesListEl = document.getElementById('viewNoticesList');
        if (noticesListEl) {
            let noticesHtml = '';
            if (record.notified_at) {
                noticesHtml += `
                    <div class="notice-item">
                        <div class="notice-item-left">
                            <div class="notice-item-icon"><i class="fas fa-paper-plane"></i></div>
                            <div>
                                <div class="notice-item-title">Official Expiration Notice Dispatched</div>
                                <div class="notice-item-meta">Recorded on ${escapeHtml(record.notified_at)}</div>
                            </div>
                        </div>
                        <span class="notice-badge sent"><i class="fas fa-check-double"></i> Delivered</span>
                    </div>
                `;
            }
            if (record.notes && record.notes.includes('[')) {
                // Parse tags like [1st Notice via SMS on 2026-09-16]
                const matches = record.notes.match(/\[(.*?)\]/g);
                if (matches) {
                    matches.forEach(m => {
                        const clean = m.replace(/[\[\]]/g, '');
                        noticesHtml += `
                            <div class="notice-item">
                                <div class="notice-item-left">
                                    <div class="notice-item-icon"><i class="fas fa-envelope-circle-check"></i></div>
                                    <div>
                                        <div class="notice-item-title">${escapeHtml(clean)}</div>
                                        <div class="notice-item-meta">Communication Archive</div>
                                    </div>
                                </div>
                                <span class="notice-badge sent"><i class="fas fa-check"></i> Logged</span>
                            </div>
                        `;
                    });
                }
            }
            if (!noticesHtml) {
                noticesHtml = `
                    <div class="notice-item" style="justify-content:center;color:var(--color-text-muted,#64748b);">
                        <span><i class="fas fa-info-circle"></i> No prior notices logged for this lot lease. Use the "Send Notice" action to dispatch a reminder.</span>
                    </div>
                `;
            }
            noticesListEl.innerHTML = noticesHtml;
        }

        // Populate Audit & Relocation Timeline
        const timelineEl = document.getElementById('viewActivityTimeline');
        if (timelineEl) {
            let timelineHtml = `
                <div class="timeline-item">
                    <div class="timeline-marker"><i class="fas fa-seedling"></i></div>
                    <div class="timeline-content">
                        <div class="timeline-action">Lease Agreement Established</div>
                        <div class="timeline-meta">Initial tenure registered on ${escapeHtml(record.start_date || 'Start of Record')}</div>
                    </div>
                </div>
            `;
            if (record.renewed === 'yes') {
                timelineHtml += `
                    <div class="timeline-item">
                        <div class="timeline-marker" style="background:#059669;"><i class="fas fa-rotate"></i></div>
                        <div class="timeline-content">
                            <div class="timeline-action" style="color:#059669;">Lease Tenure Extended</div>
                            <div class="timeline-meta">Tenure actively renewed until ${escapeHtml(record.end_date)}</div>
                        </div>
                    </div>
                `;
            } else if (daysRemaining != null && daysRemaining < 0) {
                timelineHtml += `
                    <div class="timeline-item">
                        <div class="timeline-marker" style="background:#dc2626;"><i class="fas fa-triangle-exclamation"></i></div>
                        <div class="timeline-content">
                            <div class="timeline-action" style="color:#dc2626;">Lease Term Expired</div>
                            <div class="timeline-meta">Expired on ${escapeHtml(record.end_date)} (${Math.abs(daysRemaining)} days overdue)</div>
                        </div>
                    </div>
                `;
            } else {
                timelineHtml += `
                    <div class="timeline-item">
                        <div class="timeline-marker" style="background:#d97706;"><i class="fas fa-clock"></i></div>
                        <div class="timeline-content">
                            <div class="timeline-action">Expiration Scheduled</div>
                            <div class="timeline-meta">Scheduled expiration on ${escapeHtml(record.end_date)} (${daysRemaining} days remaining)</div>
                        </div>
                    </div>
                `;
            }

            if (record.exhumation_status && record.exhumation_status !== 'Not Required' && record.exhumation_status !== 'Pending') {
                timelineHtml += `
                    <div class="timeline-item">
                        <div class="timeline-marker" style="background:#d97706;"><i class="fas fa-truck-moving"></i></div>
                        <div class="timeline-content">
                            <div class="timeline-action">Exhumation &amp; Relocation: ${escapeHtml(record.exhumation_status)}</div>
                            <div class="timeline-meta">Managed via Relocation Management</div>
                        </div>
                    </div>
                `;
            }
            timelineEl.innerHTML = timelineHtml;
        }

        const modal = document.getElementById('viewModal');
        if (modal) modal.style.display = 'flex';
    }

    function openRenewModal(id) {
        const record = cachedRecords.find(r => String(r.expiration_id) === String(id)) || currentActiveRecord;
        if (!record) return;

        currentActiveRecord = record;
        document.getElementById('renewExpirationId').value = id;

        const summaryEl = document.getElementById('renewLotSummary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <strong>Lot ${escapeHtml(record.lot_number)}</strong> (${escapeHtml(record.section_name)} - ${escapeHtml(record.block_name)})
                <br>Occupant: <strong>${escapeHtml(record.decedent_name || 'No occupant recorded')}</strong> • Current Expiration: <strong>${escapeHtml(record.end_date || 'N/A')}</strong>
            `;
        }

        // Set default +5 years from current end_date or today
        function calculateNewDate(years) {
            let baseDate = new Date();
            if (record.end_date) {
                const parts = record.end_date.split('-');
                if (parts.length === 3) {
                    const candidate = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
                    if (candidate > baseDate) baseDate = candidate;
                }
            }
            baseDate.setFullYear(baseDate.getFullYear() + years);
            return baseDate.toISOString().slice(0, 10);
        }

        const endDateInput = document.getElementById('renewEndDate');
        if (endDateInput) {
            endDateInput.value = calculateNewDate(5);
        }

        // Wire term buttons
        document.querySelectorAll('.quick-terms-row .btn-term').forEach(btn => {
            btn.classList.remove('active');
            if (btn.dataset.years === '5') btn.classList.add('active');
            btn.onclick = () => {
                document.querySelectorAll('.quick-terms-row .btn-term').forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                const y = parseInt(btn.dataset.years, 10) || 5;
                if (endDateInput) endDateInput.value = calculateNewDate(y);
            };
        });

        document.getElementById('renewFee').value = '';
        document.getElementById('renewNotes').value = '';

        const viewModal = document.getElementById('viewModal');
        if (viewModal) viewModal.style.display = 'none';

        const modal = document.getElementById('renewModal');
        if (modal) modal.style.display = 'flex';
    }

    function openRelocateModal(id) {
        const record = cachedRecords.find(r => String(r.expiration_id) === String(id)) || currentActiveRecord;
        if (!record) return;

        currentActiveRecord = record;
        document.getElementById('relocateExpirationId').value = id;

        const summaryEl = document.getElementById('relocateLotSummary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <strong>Lot ${escapeHtml(record.lot_number)}</strong> (${escapeHtml(record.section_name)} - ${escapeHtml(record.block_name)})
                <br>Occupant: <strong>${escapeHtml(record.decedent_name || 'Deceased Occupant')}</strong> • Kin: <strong>${escapeHtml(record.contact_name || 'Family Contact')}</strong>
            `;
        }

        // Default exhumation date to 14 days from today
        const d = new Date();
        d.setDate(d.getDate() + 14);
        const exhDateInput = document.getElementById('relocateExhumationDate');
        if (exhDateInput) {
            exhDateInput.value = d.toISOString().slice(0, 10);
            exhDateInput.min = new Date().toISOString().slice(0, 10);
        }

        document.getElementById('relocateDestination').value = 'Ossuary Crypt';
        document.getElementById('relocateNotes').value = '';

        const viewModal = document.getElementById('viewModal');
        if (viewModal) viewModal.style.display = 'none';

        const modal = document.getElementById('relocateModal');
        if (modal) modal.style.display = 'flex';
    }

    function openNotifyModal(id) {
        const record = cachedRecords.find(r => String(r.expiration_id) === String(id)) || currentActiveRecord;
        if (!record) return;

        currentActiveRecord = record;
        document.getElementById('notifyExpirationId').value = id;

        const summaryEl = document.getElementById('notifyLotSummary');
        if (summaryEl) {
            summaryEl.innerHTML = `
                <strong>Lot ${escapeHtml(record.lot_number)}</strong> (${escapeHtml(record.section_name)} - ${escapeHtml(record.block_name)})
                <br>Family Kin: <strong>${escapeHtml(record.contact_name || 'Next of Kin')}</strong> • Phone: <strong>${escapeHtml(record.contact_number || 'No phone recorded')}</strong>
            `;
        }

        document.getElementById('noticeNotes').value = '';

        const viewModal = document.getElementById('viewModal');
        if (viewModal) viewModal.style.display = 'none';

        const modal = document.getElementById('notifyModal');
        if (modal) modal.style.display = 'flex';
    }

    function wireTableActionButtons() {
        const tbody = document.getElementById('expirationTableBody');
        if (!tbody) return;

        // 1. View Button
        tbody.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openViewModal(btn.dataset.id);
            });
        });

        // 2. Renew Button
        tbody.querySelectorAll('.btn-renew').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openRenewModal(btn.dataset.id);
            });
        });

        // 3. Send Notice Button
        tbody.querySelectorAll('.btn-notify').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openNotifyModal(btn.dataset.id);
            });
        });

        // 4. Relocate / Exhumation Button
        tbody.querySelectorAll('.btn-relocate').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                openRelocateModal(btn.dataset.id);
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

    function wireModalsSystem() {
        const viewModal = document.getElementById('viewModal');
        const renewModal = document.getElementById('renewModal');
        const relocateModal = document.getElementById('relocateModal');
        const notifyModal = document.getElementById('notifyModal');

        const allModals = [viewModal, renewModal, relocateModal, notifyModal].filter(Boolean);

        function closeAllModals() {
            allModals.forEach(m => m.style.display = 'none');
        }

        // Close buttons
        document.getElementById('closeViewModal')?.addEventListener('click', closeAllModals);
        document.getElementById('closeRenewModal')?.addEventListener('click', closeAllModals);
        document.getElementById('closeRelocateModal')?.addEventListener('click', closeAllModals);
        document.getElementById('closeNotifyModal')?.addEventListener('click', closeAllModals);

        document.getElementById('cancelRenewBtn')?.addEventListener('click', closeAllModals);
        document.getElementById('cancelRelocateBtn')?.addEventListener('click', closeAllModals);
        document.getElementById('cancelNotifyBtn')?.addEventListener('click', closeAllModals);

        // Click outside modal
        window.addEventListener('click', (e) => {
            allModals.forEach(m => {
                if (e.target === m) m.style.display = 'none';
            });
        });

        // Escape key
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') closeAllModals();
        });

        // View Modal Footer Actions
        document.getElementById('renewFromViewBtn')?.addEventListener('click', () => {
            if (currentActiveRecord) openRenewModal(currentActiveRecord.expiration_id);
        });
        document.getElementById('notifyFromViewBtn')?.addEventListener('click', () => {
            if (currentActiveRecord) openNotifyModal(currentActiveRecord.expiration_id);
        });
        document.getElementById('relocateFromViewBtn')?.addEventListener('click', () => {
            if (currentActiveRecord) openRelocateModal(currentActiveRecord.expiration_id);
        });
        document.getElementById('deleteFromViewBtn')?.addEventListener('click', async () => {
            if (!currentActiveRecord) return;
            if (!confirm(`Are you sure you want to delete the expiration record for Lot ${currentActiveRecord.lot_number}?`)) return;
            try {
                const res = await api.request(`expiration-records/${currentActiveRecord.expiration_id}`, { method: 'DELETE' });
                alert(res.message || 'Expiration record deleted.');
                closeAllModals();
                await refreshExpirationView();
            } catch (err) {
                alert('Delete failed: ' + (err.message || 'Unknown error'));
            }
        });

        // Print Lease Slip
        document.getElementById('printLeaseSlipBtn')?.addEventListener('click', () => {
            if (!currentActiveRecord) return;
            const printWin = window.open('', '_blank', 'width=800,height=600');
            if (!printWin) {
                alert('Please allow popups to print the lease summary slip.');
                return;
            }
            printWin.document.write(`
                <!DOCTYPE html>
                <html>
                <head>
                    <title>Lease Summary Slip - Lot ${escapeHtml(currentActiveRecord.lot_number)}</title>
                    <style>
                        body { font-family: 'Inter', Arial, sans-serif; padding: 30px; color: #1e293b; }
                        .slip-header { border-bottom: 2px solid #0d9488; padding-bottom: 12px; margin-bottom: 20px; }
                        h1 { font-size: 20px; margin: 0; color: #0f766e; }
                        h2 { font-size: 14px; margin: 4px 0 0 0; color: #64748b; font-weight: normal; }
                        .prop-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 20px; }
                        .prop-box { background: #f8fafc; border: 1px solid #e2e8f0; padding: 10px 14px; border-radius: 8px; }
                        .label { font-size: 11px; text-transform: uppercase; color: #64748b; font-weight: bold; }
                        .val { font-size: 14px; font-weight: 600; color: #1e293b; margin-top: 4px; }
                        .footer { margin-top: 30px; border-top: 1px dashed #cbd5e1; padding-top: 12px; font-size: 12px; color: #64748b; }
                    </style>
                </head>
                <body>
                    <div class="slip-header">
                        <h1>CEMETERY MANAGEMENT SYSTEM</h1>
                        <h2>Official Lot Lease &amp; Expiration Summary</h2>
                    </div>
                    <div class="prop-grid">
                        <div class="prop-box"><div class="label">Lot Number</div><div class="val">Lot ${escapeHtml(currentActiveRecord.lot_number)}</div></div>
                        <div class="prop-box"><div class="label">Section &amp; Block</div><div class="val">${escapeHtml(currentActiveRecord.section_name)} (Block ${escapeHtml(currentActiveRecord.block_name)})</div></div>
                        <div class="prop-box"><div class="label">Deceased Occupant</div><div class="val">${escapeHtml(currentActiveRecord.decedent_name || 'N/A')}</div></div>
                        <div class="prop-box"><div class="label">Family Contact</div><div class="val">${escapeHtml(currentActiveRecord.contact_name || 'N/A')} (${escapeHtml(currentActiveRecord.contact_number || 'N/A')})</div></div>
                        <div class="prop-box"><div class="label">Lease Start Date</div><div class="val">${escapeHtml(currentActiveRecord.start_date || '—')}</div></div>
                        <div class="prop-box"><div class="label">Lease End Date</div><div class="val">${escapeHtml(currentActiveRecord.end_date || '—')}</div></div>
                        <div class="prop-box"><div class="label">Renewal Status</div><div class="val">${escapeHtml(currentActiveRecord.renewed === 'yes' ? 'Renewed' : 'Not Renewed')}</div></div>
                        <div class="prop-box"><div class="label">Current Status</div><div class="val">${escapeHtml(currentActiveRecord.status || 'Active')}</div></div>
                    </div>
                    <div class="footer">
                        Generated on ${new Date().toLocaleString()} by Cemetery Administration System.
                    </div>
                </body>
                </html>
            `);
            printWin.document.close();
            printWin.focus();
            printWin.print();
        });

        // 1. Submit Renew Form
        document.getElementById('renewForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('renewExpirationId').value;
            const newEndDate = document.getElementById('renewEndDate').value;
            const fee = document.getElementById('renewFee').value;
            const notes = document.getElementById('renewNotes').value;
            const submitBtn = document.getElementById('confirmRenewSubmitBtn');

            if (!id || !newEndDate) return;

            try {
                if (submitBtn) submitBtn.disabled = true;
                const fullNotes = [notes, fee ? `Renewal Fee: ₱${parseFloat(fee).toFixed(2)}` : ''].filter(Boolean).join(' | ');
                const res = await api.request(`expiration-records/${id}/renew`, {
                    method: 'POST',
                    body: { new_end_date: newEndDate, notes: fullNotes }
                });
                alert(res.message || 'Lease renewed successfully!');
                closeAllModals();
                await refreshExpirationView();
            } catch (err) {
                alert('Renewal submission failed: ' + (err.message || 'Unknown error'));
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });

        // 2. Submit Relocate Form
        document.getElementById('relocateForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('relocateExpirationId').value;
            const reason = document.getElementById('relocateReason').value;
            const exhDate = document.getElementById('relocateExhumationDate').value;
            const destination = document.getElementById('relocateDestination').value;
            const notes = document.getElementById('relocateNotes').value;
            const submitBtn = document.getElementById('confirmRelocateSubmitBtn');

            if (!id || !reason || !destination) return;

            try {
                if (submitBtn) submitBtn.disabled = true;
                const res = await api.request(`expiration-records/${id}/initiate-relocation`, {
                    method: 'POST',
                    body: {
                        reason: `${reason} - Transfer to ${destination}`,
                        proposed_exhumation_date: exhDate,
                        destination: destination,
                        notes: notes
                    }
                });
                alert(res.message || 'Relocation request initiated successfully!');
                closeAllModals();
                await refreshExpirationView();
            } catch (err) {
                alert('Relocation handoff failed: ' + (err.message || 'Unknown error'));
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
        });

        // 3. Submit Dispatch Notice Form
        document.getElementById('notifyForm')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('notifyExpirationId').value;
            const stage = document.getElementById('noticeStageSelect').value;
            const method = document.getElementById('noticeDeliveryMethod').value;
            const notes = document.getElementById('noticeNotes').value;
            const submitBtn = document.getElementById('confirmNotifySubmitBtn');

            if (!id) return;

            try {
                if (submitBtn) submitBtn.disabled = true;
                const res = await api.request(`expiration-records/${id}/notify`, {
                    method: 'POST',
                    body: { stage, method, notes }
                });
                alert(res.message || 'Notice dispatched and logged successfully!');
                closeAllModals();
                await updateNotificationBadge();
                await refreshExpirationView();
            } catch (err) {
                alert('Notice dispatch failed: ' + (err.message || 'Unknown error'));
            } finally {
                if (submitBtn) submitBtn.disabled = false;
            }
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

    wireModalsSystem();
    await populateSectionsDropdown();
    await refreshExpirationView();
    await updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
