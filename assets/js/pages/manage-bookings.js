document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin', 'staff']);
    if (!user) return;

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    // Notification bell — navigate to notifications page on click
    document.getElementById('notificationIcon')?.addEventListener('click', () => {
        window.location.href = `${getFrontendBasePath()}/pages/notifications.html`;
    });

    // Notification unread badge
    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.innerText = result.count || 0;
                badge.style.display = result.count > 0 ? 'flex' : 'none';
            }
        } catch (e) { /* silent — badge is non-critical */ }
    }
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);

    // Sidebar collapse setup
    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }


    // AI Assistant mount
    if (typeof initAiAssistant === 'function' && document.querySelector('#aiAssistantMount')) {
        initAiAssistant({
            mountSelector: '#aiAssistantMount',
            context: { scope: 'module', module: 'Schedule' },
            greeting: "Hello! I'm your AI assistant for Cemetery Bookings & Operations. How can I help you manage burials or cremations today?",
            suggestions: [
                { icon: 'fa-list-check', label: 'Pending bookings', question: 'How many bookings are currently pending across burials and cremations?' },
                { icon: 'fa-triangle-exclamation', label: 'Any exceptions?', question: 'Are there any open exceptions or capacity issues I need to review?' },
                { icon: 'fa-hourglass-half', label: 'At-risk bookings', question: 'Which pending bookings are at risk of being auto-cancelled?' },
                { icon: 'fa-circle-question', label: 'How does auto-confirm work?', question: 'How does payment-triggered auto-confirmation work for both burials and cremations?' },
            ],
        });
    }

    // Shared UI helpers
    const { escapeHtml, buildStatusBadge, debounce, renderFilterChips } = window.reservationUI;

    // Elements
    const statTotalBookings = document.getElementById('statTotalBookings');
    const statBurialCount = document.getElementById('statBurialCount');
    const statCremationCount = document.getElementById('statCremationCount');
    const statReviewCount = document.getElementById('statReviewCount');
    const statCompletedCount = document.getElementById('statCompletedCount');

    const badgeAllCount = document.getElementById('badgeAllCount');
    const badgeBurialCount = document.getElementById('badgeBurialCount');
    const badgeCremationCount = document.getElementById('badgeCremationCount');

    const tabBtns = document.querySelectorAll('.booking-tab-btn');
    const searchQuery = document.getElementById('searchQuery');
    const statusFilter = document.getElementById('statusFilter');
    const toggleAwaitingBtn = document.getElementById('toggleAwaitingConfirmation');
    const awaitingCountBadge = document.getElementById('awaitingConfirmationCount');
    const clearFilters = document.getElementById('clearFilters');
    const activeFilterChips = document.getElementById('activeFilterChips');

    const bookingsHead = document.getElementById('bookingsHead');
    const bookingsBody = document.getElementById('bookingsBody');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');

    // Modals
    const detailModal = document.getElementById('bookingDetailModal');
    const detailModalBody = document.getElementById('bookingDetailBody');
    const detailModalFooter = document.getElementById('bookingDetailFooter');
    const closeDetailModalBtn = document.getElementById('closeDetailModal');
    const closeDetailModalFooterBtn = document.getElementById('closeDetailModalBtn');

    const cashModal = document.getElementById('cashPaymentModal');
    const cashPaymentForm = document.getElementById('cashPaymentForm');
    const cashPaymentTargetId = document.getElementById('cashPaymentTargetId');
    const cashPaymentServiceType = document.getElementById('cashPaymentServiceType');
    const cashPaymentAmount = document.getElementById('cashPaymentAmount');
    const cashPaymentMethod = document.getElementById('cashPaymentMethod');
    const cashPaymentReceipt = document.getElementById('cashPaymentReceipt');
    const cashPaymentHelpText = document.getElementById('cashPaymentHelpText');

    // Export buttons
    const exportPdfBtn = document.getElementById('exportPdfBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');

    // Parse URL params for initial state
    const urlParams = new URLSearchParams(window.location.search);
    let currentTab = urlParams.get('service') || 'all';
    if (!['all', 'burial', 'cremation'].includes(currentTab)) {
        currentTab = 'all';
    }

    let currentQuery = urlParams.get('q') || '';
    let currentStatus = urlParams.get('status') || '';
    let awaitingReviewOnly = urlParams.get('awaiting_confirmation') === '1';

    if (currentQuery) searchQuery.value = currentQuery;
    if (currentStatus) statusFilter.value = currentStatus;
    function syncAwaitingReviewUI(val) {
        awaitingReviewOnly = Boolean(val);
        if (toggleAwaitingBtn) {
            if ('checked' in toggleAwaitingBtn) toggleAwaitingBtn.checked = awaitingReviewOnly;
            toggleAwaitingBtn.setAttribute('aria-pressed', String(awaitingReviewOnly));
        }
        statusFilter.disabled = awaitingReviewOnly;
    }

    if (awaitingReviewOnly) {
        syncAwaitingReviewUI(true);
    }

    const perPage = 10;
    let cachedCurrentPageData = [];

    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        infoEl: paginationInfo,
        itemLabel: 'booking',
        onChange: loadAndRenderBookings,
    });

    // ── TAB SWITCHING ──────────────────────────────────────────
    function updateActiveStatCards() {
        document.querySelectorAll('.bookings-stats .stat-card').forEach((card) => {
            const action = card.getAttribute('data-action') || '';
            const href = card.getAttribute('data-href') || '';
            let isActive = false;
            if (action === 'all' || href === 'manage-bookings.html') {
                isActive = currentTab === 'all' && !currentStatus && !awaitingReviewOnly;
            } else if (action === 'burial' || href.includes('service=burial')) {
                isActive = currentTab === 'burial' && !currentStatus && !awaitingReviewOnly;
            } else if (action === 'cremation' || href.includes('service=cremation')) {
                isActive = currentTab === 'cremation' && !currentStatus && !awaitingReviewOnly;
            } else if (action === 'completed' || href.includes('status=Completed')) {
                isActive = currentStatus === 'Completed';
            } else if (action === 'review' || href.includes('awaiting_confirmation') || href.includes('exceptions.html')) {
                isActive = Boolean(awaitingReviewOnly);
            }
            card.classList.toggle('is-active-filter', isActive);
            card.setAttribute('aria-pressed', String(isActive));
        });
    }

    function setActiveTab(tab) {
        currentTab = tab;
        tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Update URL query state without full page reload
        const newUrl = new URL(window.location);
        if (tab === 'all') {
            newUrl.searchParams.delete('service');
        } else {
            newUrl.searchParams.set('service', tab);
        }
        window.history.replaceState({}, '', newUrl);

        updateActiveStatCards();
        pagination.reset();
        loadAndRenderBookings();
    }

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            setActiveTab(btn.dataset.tab);
        });
    });

    // Initialize initial active tab UI
    setActiveTab(currentTab);

    // ── STATS & EXCEPTION METRICS ──────────────────────────────
    async function loadOpenExceptionIds() {
        try {
            const [schedEx, cremEx] = await Promise.all([
                api.request('exceptions?status=open&entity_type=Schedule', { method: 'GET' }).catch(() => []),
                api.request('exceptions?status=open&entity_type=Cremation', { method: 'GET' }).catch(() => [])
            ]);
            const scheduleIds = new Set((Array.isArray(schedEx) ? schedEx : []).map(e => Number(e.entity_id)));
            const cremationIds = new Set((Array.isArray(cremEx) ? cremEx : []).map(e => Number(e.entity_id)));
            return { scheduleIds, cremationIds, totalCount: scheduleIds.size + cremationIds.size };
        } catch (e) {
            console.error('Failed to load exceptions', e);
            return { scheduleIds: new Set(), cremationIds: new Set(), totalCount: 0 };
        }
    }

    async function refreshStats() {
        try {
            const res = await api.request('bookings/stats', { method: 'GET' }).catch(() => null);
            if (res && res.success && res.data) {
                const d = res.data;
                statTotalBookings.textContent = d.total_bookings ?? 0;
                statBurialCount.textContent = d.burials_count ?? 0;
                statCremationCount.textContent = d.cremations_count ?? 0;
                statReviewCount.textContent = d.exceptions_count ?? 0;
                statCompletedCount.textContent = d.completed_count ?? 0;

                badgeAllCount.textContent = d.total_bookings ?? 0;
                badgeBurialCount.textContent = d.burials_count ?? 0;
                badgeCremationCount.textContent = d.cremations_count ?? 0;
                awaitingCountBadge.textContent = d.exceptions_count ?? 0;
                return;
            }

            // Fallback to separate endpoints if needed
            const [schedStats, cremStats, exceptions] = await Promise.all([
                api.request('schedules/stats', { method: 'GET' }).catch(() => ({})),
                api.request('cremations/queue-stats', { method: 'GET' }).catch(() => ({})),
                loadOpenExceptionIds(),
            ]);

            const burialPending = schedStats.pending || 0;
            const burialConfirmed = schedStats.confirmed || 0;
            const burialCompleted = schedStats.completed || 0;
            const burialTotal = burialPending + burialConfirmed;

            const cremationPending = cremStats.pending || 0;
            const cremationScheduled = cremStats.scheduled || 0;
            const cremationCompleted = cremStats.completed || 0;
            const cremationTotal = cremationPending + cremationScheduled;

            const totalBookings = burialTotal + cremationTotal;
            const totalCompleted = burialCompleted + cremationCompleted;

            statTotalBookings.textContent = totalBookings;
            statBurialCount.textContent = burialTotal;
            statCremationCount.textContent = cremationTotal;
            statReviewCount.textContent = exceptions.totalCount;
            statCompletedCount.textContent = totalCompleted;

            badgeAllCount.textContent = totalBookings;
            badgeBurialCount.textContent = burialTotal;
            badgeCremationCount.textContent = cremationTotal;
            awaitingCountBadge.textContent = exceptions.totalCount;
        } catch (error) {
            console.error('Failed to refresh stats', error);
        }
    }

    // ── DATA FETCHING ──────────────────────────────────────────
    async function fetchBurials() {
        const params = new URLSearchParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        if (currentQuery.trim()) params.set('q', currentQuery.trim());
        if (awaitingReviewOnly) {
            params.set('awaiting_confirmation', '1');
        } else if (currentStatus) {
            params.set('status', currentStatus);
        }
        return await api.request(`schedules?${params.toString()}`, { method: 'GET' });
    }

    async function fetchCremations() {
        const params = new URLSearchParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        if (currentQuery.trim()) params.set('q', currentQuery.trim());
        if (awaitingReviewOnly) {
            params.set('awaiting_confirmation', '1');
        } else if (currentStatus) {
            const mappedStatus = currentStatus === 'Confirmed' ? 'Scheduled' : currentStatus;
            params.set('status', mappedStatus);
        }
        return await api.request(`cremations?${params.toString()}`, { method: 'GET' });
    }

    function normalizeBurial(s, exceptionIds) {
        const fullName = (s.first_name || s.last_name) ? `${s.first_name || ''} ${s.last_name || ''}`.trim() : '';
        const decedentName = fullName || (s.provisional_name ? `${s.provisional_name} (unregistered)` : 'N/A');
        const locationStr = s.lot_number ? `Lot ${s.lot_number}${s.section_name ? `, ${s.section_name}` : ''}` : 'No lot assigned';

        return {
            id: s.schedule_id,
            service_type: 'burial',
            ref_label: `Booking #${s.schedule_id}`,
            decedent_name: decedentName,
            location_label: locationStr,
            lot_number: s.lot_number || 'N/A',
            section_name: s.section_name || 'N/A',
            date_time: `${s.schedule_date || 'N/A'} ${s.schedule_time || ''}`.trim(),
            date_raw: s.schedule_date || '',
            time_raw: s.schedule_time || '',
            created_by_name: s.created_by_name || 'N/A',
            created_by_id: s.created_by,
            status: s.status,
            payment_status: s.payment_status || 'Unpaid',
            payment_amount: s.payment_amount,
            payment_date: s.payment_date,
            payment_receipt: s.payment_receipt_number,
            notes: s.notes,
            has_exception: s.status === 'Pending' && exceptionIds.has(Number(s.schedule_id)),
            raw: s,
        };
    }

    function normalizeCremation(c, exceptionIds) {
        const fullName = (c.first_name || c.last_name) ? `${c.first_name || ''} ${c.last_name || ''}`.trim() : '';
        const decedentName = fullName || (c.provisional_name ? `${c.provisional_name} (unregistered)` : 'N/A');
        const nicheText = c.niche_number ? `Niche ${c.niche_number}` : 'TBD';
        const locationStr = `${c.columbarium || 'Columbarium'} &bull; ${nicheText}`;

        return {
            id: c.cremation_id,
            service_type: 'cremation',
            ref_label: `Request #${c.cremation_id}`,
            decedent_name: decedentName,
            location_label: locationStr,
            columbarium: c.columbarium || 'N/A',
            niche_number: c.niche_number || 'TBD',
            date_time: c.cremation_date || 'N/A',
            date_raw: c.cremation_date || '',
            time_raw: c.cremation_time || '',
            created_by_name: c.created_by_name || 'N/A',
            created_by_id: c.created_by,
            status: c.status,
            payment_status: c.payment_status || 'Unpaid',
            payment_amount: c.payment_amount,
            payment_date: c.payment_date,
            payment_receipt: c.payment_receipt_number,
            notes: c.notes,
            has_exception: c.status === 'Pending' && exceptionIds.has(Number(c.cremation_id)),
            raw: c,
        };
    }

    // ── TABLE RENDERING ────────────────────────────────────────
    function renderTableHeader() {
        if (currentTab === 'burial') {
            bookingsHead.innerHTML = `
                <tr>
                    <th class="col-ref">Ref #</th>
                    <th class="col-decedent">Decedent</th>
                    <th class="col-lot">Lot</th>
                    <th class="col-section">Section</th>
                    <th class="col-schedule">Burial Date</th>
                    <th class="col-requester">Requested By</th>
                    <th class="col-status">Status</th>
                    <th class="col-payment">Payment</th>
                    <th class="col-actions">Actions</th>
                </tr>
            `;
        } else if (currentTab === 'cremation') {
            bookingsHead.innerHTML = `
                <tr>
                    <th class="col-ref">Ref #</th>
                    <th class="col-decedent">Decedent</th>
                    <th class="col-columbarium">Columbarium</th>
                    <th class="col-niche">Niche</th>
                    <th class="col-schedule">Cremation Date</th>
                    <th class="col-requester">Requested By</th>
                    <th class="col-status">Status</th>
                    <th class="col-payment">Payment</th>
                    <th class="col-actions">Actions</th>
                </tr>
            `;
        } else {
            bookingsHead.innerHTML = `
                <tr>
                    <th class="col-ref">Ref #</th>
                    <th class="col-service">Service</th>
                    <th class="col-decedent">Decedent</th>
                    <th class="col-location">Location</th>
                    <th class="col-schedule">Schedule</th>
                    <th class="col-requester">Requested By</th>
                    <th class="col-status">Status</th>
                    <th class="col-payment">Payment</th>
                    <th class="col-actions">Actions</th>
                </tr>
            `;
        }
    }

    function buildPaymentBadge(item) {
        const ps = String(item.payment_status || '').toLowerCase();
        if (ps === 'verified' || ps === 'paid') {
            return `<span class="payment-badge payment-badge--verified"><i class="fas fa-circle-check"></i> Verified</span>`;
        }
        if (ps === 'pending') {
            return `<span class="payment-badge payment-badge--pending"><i class="fas fa-clock"></i> Pending</span>`;
        }
        return `<span class="payment-badge payment-badge--unpaid"><i class="fas fa-circle-xmark"></i> Unpaid</span>`;
    }

    function buildServiceBadge(serviceType) {
        if (serviceType === 'burial') {
            return `<span class="service-pill service-pill--burial"><i class="fas fa-monument"></i> Burial</span>`;
        }
        return `<span class="service-pill service-pill--cremation"><i class="fas fa-fire"></i> Cremation</span>`;
    }

    function formatScheduleCell(dateVal, timeVal) {
        if (!dateVal || dateVal === 'N/A') {
            return '<span class="text-muted" style="color:#94a3b8;">—</span>';
        }
        let formattedDate = dateVal;
        let formattedTime = '';

        let datePart = dateVal;
        let timePart = timeVal || '';
        if (typeof dateVal === 'string' && dateVal.includes(' ') && !timePart) {
            const split = dateVal.split(' ');
            datePart = split[0];
            timePart = split.slice(1).join(' ');
        }

        try {
            const parts = String(datePart).split('-');
            if (parts.length === 3) {
                const year = Number(parts[0]);
                const month = Number(parts[1]) - 1;
                const day = Number(parts[2]);
                const d = new Date(year, month, day);
                if (!isNaN(d.getTime())) {
                    formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                }
            }
        } catch (_) {
            formattedDate = datePart;
        }

        if (timePart) {
            try {
                const timeComponents = timePart.split(':');
                if (timeComponents.length >= 2) {
                    let hour = parseInt(timeComponents[0], 10);
                    const minute = timeComponents[1];
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    hour = hour % 12 || 12;
                    formattedTime = `${hour}:${minute} ${ampm}`;
                } else {
                    formattedTime = timePart;
                }
            } catch (_) {
                formattedTime = timePart;
            }
        }

        return `
            <div class="table-datetime-cell">
                <span class="cell-date">${escapeHtml(formattedDate)}</span>
                ${formattedTime ? `<span class="cell-time"><i class="far fa-clock"></i> ${escapeHtml(formattedTime)}</span>` : ''}
            </div>
        `;
    }

    function formatLocationCell(item) {
        if (item.service_type === 'burial') {
            const lot = item.lot_number && item.lot_number !== 'N/A' ? `Lot ${item.lot_number}` : 'No lot';
            const section = item.section_name && item.section_name !== 'N/A' ? item.section_name : '';
            return `
                <div class="table-location-cell">
                    <span class="loc-main">${escapeHtml(lot)}</span>
                    ${section ? `<span class="loc-sub">${escapeHtml(section)}</span>` : ''}
                </div>
            `;
        } else {
            const niche = item.niche_number && item.niche_number !== 'TBD' ? `Niche ${item.niche_number}` : 'Niche TBD';
            const columbarium = item.columbarium && item.columbarium !== 'N/A' ? item.columbarium : 'Columbarium';
            return `
                <div class="table-location-cell">
                    <span class="loc-main">${escapeHtml(niche)}</span>
                    <span class="loc-sub">${escapeHtml(columbarium)}</span>
                </div>
            `;
        }
    }

    function buildActionButtons(item) {
        const buttons = [];
        const isAdmin = user.role === 'admin';
        const isOwnPending = item.status === 'Pending' && String(item.created_by_id) === String(user.user_id);

        buttons.push(`<button class="btn-row-action btn-row-action--view" data-action="view" data-service="${item.service_type}" data-id="${item.id}" title="View Details" aria-label="View Details"><i class="fas fa-eye"></i></button>`);

        if (item.has_exception) {
            const entityType = item.service_type === 'burial' ? 'Schedule' : 'Cremation';
            buttons.push(`<a class="btn-row-action btn-row-action--exception" href="exceptions.html?entity_type=${entityType}&entity_id=${item.id}" title="Review Exception" aria-label="Review Exception"><i class="fas fa-triangle-exclamation"></i></a>`);
        }

        if (item.status === 'Confirmed' || item.status === 'Scheduled') {
            buttons.push(`<button class="btn-row-action btn-row-action--complete" data-action="complete" data-service="${item.service_type}" data-id="${item.id}" title="Mark Ceremony Completed" aria-label="Complete"><i class="fas fa-check"></i></button>`);
        }

        if (item.status === 'Pending' && !item.has_exception) {
            buttons.push(`<button class="btn-row-action btn-row-action--cash" data-action="complete-cash" data-service="${item.service_type}" data-id="${item.id}" title="Record Cash / Offline Payment & Complete" aria-label="Record Cash Payment"><i class="fas fa-money-bill-wave"></i></button>`);
        }

        if ((item.status === 'Pending' || item.status === 'Confirmed' || item.status === 'Scheduled') && (isAdmin || isOwnPending)) {
            buttons.push(`<button class="btn-row-action btn-row-action--cancel" data-action="cancel" data-service="${item.service_type}" data-id="${item.id}" title="Cancel Booking" aria-label="Cancel"><i class="fas fa-xmark"></i></button>`);
        }

        return buttons.length ? buttons.join('') : '<span class="muted" style="font-size:0.8rem; color:#94a3b8;">No actions</span>';
    }

    function buildTableRow(item) {
        const refPill = `<span class="ref-pill" title="${escapeHtml(item.ref_label)}">#${escapeHtml(String(item.id))}</span>`;
        const decedentCell = `
            <div class="table-decedent-cell" title="${escapeHtml(item.decedent_name)}">
                <span class="decedent-name">${escapeHtml(item.decedent_name)}</span>
            </div>
        `;
        const requesterCell = `
            <div class="table-requester-cell" title="${escapeHtml(item.created_by_name)}">
                <span class="requester-name">${escapeHtml(item.created_by_name)}</span>
            </div>
        `;
        const scheduleCell = formatScheduleCell(item.date_raw || item.date_time, item.time_raw);

        if (currentTab === 'burial') {
            return `
                <tr data-id="${item.id}" data-service="${item.service_type}">
                    <td class="col-ref">${refPill}</td>
                    <td class="col-decedent">${decedentCell}</td>
                    <td class="col-lot"><span class="lot-pill">${escapeHtml(item.lot_number || 'N/A')}</span></td>
                    <td class="col-section"><span class="section-text" title="${escapeHtml(item.section_name || '')}">${escapeHtml(item.section_name || 'N/A')}</span></td>
                    <td class="col-schedule">${scheduleCell}</td>
                    <td class="col-requester">${requesterCell}</td>
                    <td class="col-status">${buildStatusBadge(item.status)}</td>
                    <td class="col-payment">${buildPaymentBadge(item)}</td>
                    <td class="col-actions"><div class="action-buttons">${buildActionButtons(item)}</div></td>
                </tr>
            `;
        }

        if (currentTab === 'cremation') {
            return `
                <tr data-id="${item.id}" data-service="${item.service_type}">
                    <td class="col-ref">${refPill}</td>
                    <td class="col-decedent">${decedentCell}</td>
                    <td class="col-columbarium"><span class="columbarium-text" title="${escapeHtml(item.columbarium || '')}">${escapeHtml(item.columbarium || 'N/A')}</span></td>
                    <td class="col-niche"><span class="niche-pill">${escapeHtml(item.niche_number || 'TBD')}</span></td>
                    <td class="col-schedule">${scheduleCell}</td>
                    <td class="col-requester">${requesterCell}</td>
                    <td class="col-status">${buildStatusBadge(item.status)}</td>
                    <td class="col-payment">${buildPaymentBadge(item)}</td>
                    <td class="col-actions"><div class="action-buttons">${buildActionButtons(item)}</div></td>
                </tr>
            `;
        }

        return `
            <tr data-id="${item.id}" data-service="${item.service_type}">
                <td class="col-ref">${refPill}</td>
                <td class="col-service">${buildServiceBadge(item.service_type)}</td>
                <td class="col-decedent">${decedentCell}</td>
                <td class="col-location">${formatLocationCell(item)}</td>
                <td class="col-schedule">${scheduleCell}</td>
                <td class="col-requester">${requesterCell}</td>
                <td class="col-status">${buildStatusBadge(item.status)}</td>
                <td class="col-payment">${buildPaymentBadge(item)}</td>
                <td class="col-actions"><div class="action-buttons">${buildActionButtons(item)}</div></td>
            </tr>
        `;
    }

    function renderActiveFilterChips() {
        renderFilterChips(activeFilterChips, [
            { key: 'q', label: 'Search', value: currentQuery, clear: () => { searchQuery.value = ''; currentQuery = ''; } },
            { key: 'status', label: 'Status', value: currentStatus, clear: () => { statusFilter.value = ''; currentStatus = ''; } },
            { key: 'awaiting', label: 'Filter', value: awaitingReviewOnly ? 'Needs Review' : '', clear: () => {
                awaitingReviewOnly = false;
                if (toggleAwaitingBtn) {
                    toggleAwaitingBtn.checked = false;
                    toggleAwaitingBtn.setAttribute('aria-pressed', 'false');
                }
                statusFilter.disabled = false;
            } },
        ], async () => {
            pagination.reset();
            await loadAndRenderBookings();
        });
    }

    async function loadAndRenderBookings() {
        renderTableHeader();
        bookingsBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 30px; color:#64748b;"><i class="fas fa-spinner fa-spin"></i> Loading bookings...</td></tr>`;

        try {
            const exceptions = await loadOpenExceptionIds();
            let items = [];
            let totalRecords = 0;
            let totalPages = 1;

            // Check if unified /api/bookings endpoint is reachable
            let unifiedRes = null;
            try {
                const params = new URLSearchParams();
                params.set('page', pagination.page);
                params.set('per_page', perPage);
                if (currentTab !== 'all') params.set('service', currentTab);
                if (currentQuery.trim()) params.set('q', currentQuery.trim());
                if (awaitingReviewOnly) {
                    params.set('awaiting_confirmation', '1');
                } else if (currentStatus) {
                    params.set('status', currentStatus);
                }
                unifiedRes = await api.request(`bookings?${params.toString()}`, { method: 'GET' });
            } catch (unifiedErr) {
                unifiedRes = null;
            }

            if (unifiedRes && unifiedRes.success && Array.isArray(unifiedRes.data)) {
                items = unifiedRes.data.map(item => {
                    const isBurial = item.service_type === 'burial';
                    const excSet = isBurial ? exceptions.scheduleIds : exceptions.cremationIds;
                    return isBurial ? normalizeBurial(item, excSet) : normalizeCremation(item, excSet);
                });
                totalRecords = unifiedRes.meta?.total || items.length;
                totalPages = Math.max(1, unifiedRes.meta?.total_pages || Math.ceil(totalRecords / perPage));
            } else {
                // Fallback: parallel fetch from schedules and cremations
                if (currentTab === 'burial') {
                    const res = await fetchBurials();
                    const list = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
                    items = list.map(s => normalizeBurial(s, exceptions.scheduleIds));
                    totalRecords = res.meta?.total || items.length;
                    totalPages = Math.max(1, res.meta?.total_pages || Math.ceil(totalRecords / perPage));
                } else if (currentTab === 'cremation') {
                    const res = await fetchCremations();
                    const list = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);
                    items = list.map(c => normalizeCremation(c, exceptions.cremationIds));
                    totalRecords = res.meta?.total || items.length;
                    totalPages = Math.max(1, res.meta?.total_pages || Math.ceil(totalRecords / perPage));
                } else {
                    const [burialsRes, cremationsRes] = await Promise.all([
                        fetchBurials().catch(() => ({ data: [] })),
                        fetchCremations().catch(() => ({ data: [] }))
                    ]);

                    const burialList = (Array.isArray(burialsRes.data) ? burialsRes.data : (Array.isArray(burialsRes) ? burialsRes : []))
                        .map(s => normalizeBurial(s, exceptions.scheduleIds));
                    const cremationList = (Array.isArray(cremationsRes.data) ? cremationsRes.data : (Array.isArray(cremationsRes) ? cremationsRes : []))
                        .map(c => normalizeCremation(c, exceptions.cremationIds));

                    const merged = [...burialList, ...cremationList];
                    merged.sort((a, b) => (b.date_raw || '').localeCompare(a.date_raw || '') || b.id - a.id);

                    items = merged;
                    totalRecords = (burialsRes.meta?.total || burialList.length) + (cremationsRes.meta?.total || cremationList.length);
                    totalPages = Math.max(1, Math.ceil(totalRecords / perPage));
                }
            }

            cachedCurrentPageData = items;

            if (items.length === 0) {
                bookingsBody.innerHTML = `
                    <tr>
                        <td colspan="9">
                            <div class="decrec-empty-state">
                                <i class="fas fa-calendar-xmark"></i>
                                <strong>No bookings found</strong>
                                <span>Adjust your search keywords or active filters to see more bookings.</span>
                            </div>
                        </td>
                    </tr>
                `;
            } else {
                bookingsBody.innerHTML = items.map(buildTableRow).join('');
            }

            renderActiveFilterChips();
            pagination.render({
                page: pagination.page,
                pages: totalPages,
                total: totalRecords
            });
        } catch (error) {
            console.error('Failed to load bookings', error);
            bookingsBody.innerHTML = `<tr><td colspan="9" style="text-align:center; padding: 30px; color:#ef4444;">Unable to load bookings right now. Please try again.</td></tr>`;
            pagination.render({ page: 1, pages: 1, total: 0 });
        }
    }

    async function refreshAll() {
        await Promise.all([
            refreshStats(),
            loadAndRenderBookings()
        ]);
    }

    // ── DETAIL VIEW MODAL (Simplified & Compact Executive Design) ──
    let currentViewBookingId = null;
    let currentViewServiceType = null;

    function renderBookingContent(data, serviceType, id) {
        const isBurial = serviceType === 'burial';
        const fullName = (data.first_name || data.last_name) ? `${data.first_name || ''} ${data.last_name || ''}`.trim() : '';
        const decedentDisplay = data.decedent_name || fullName || (data.provisional_name ? `${data.provisional_name} (unregistered)` : 'Unspecified Decedent');
        const isProvisional = !fullName && !!data.provisional_name;

        // Payment calculation
        const paymentStatusStr = data.payment_status || 'Unpaid';
        const paymentAmountVal = parseFloat(data.payment_amount || 0);
        const paymentAmountFormatted = isNaN(paymentAmountVal) || paymentAmountVal === 0 ? '0.00' : paymentAmountVal.toLocaleString('en-US', { minimumFractionDigits: 2 });
        const paymentMethodStr = data.payment_method || (data.raw && data.raw.payment_method) || 'Standard';
        const paymentReceiptStr = data.payment_receipt_number || data.payment_receipt || (data.raw && data.raw.payment_receipt_number) || '—';
        const paymentDateStr = data.payment_date || (data.raw && data.raw.payment_date) || '—';

        // Applicant calculation
        const applicantName = data.created_by_name || (data.raw && data.raw.created_by_name) || 'Citizen User';
        const contactPhone = data.contact_number || (data.raw && (data.raw.contact_number || data.raw.phone || data.raw.created_by_phone)) || '';
        const relationship = data.relationship || (data.raw && data.raw.relationship) || 'Family / Next of Kin';

        // Documentary Requirements calculation (Batch 7)
        const docSummary = data.document_summary || {
            uploaded_count: 0,
            total_required: 3,
            all_uploaded: false,
            status: 'pending_physical',
            status_label: 'Pending Physical Presentation',
            badge_class: 'pending',
            workflow_guidance: 'Original physical certificates must be presented at the cemetery office prior to burial or cremation service authorization.'
        };
        const docItems = (Array.isArray(data.documents) && data.documents.length > 0) ? data.documents : [
            { doc_type: 'death_certificate', title: 'Death Certificate', description: 'PSA or Local Civil Registrar Certified True Copy', is_uploaded: false },
            { doc_type: 'burial_permit', title: isBurial ? 'Burial Permit' : 'Cremation Permit', description: 'City Health Office / LGU Permit', is_uploaded: false },
            { doc_type: 'valid_id', title: 'Valid Government ID', description: 'ID of Informant / Claimant', is_uploaded: false }
        ];

        // Location breakdown
        let primaryLocation = '';
        let secondaryLocation = '';
        if (isBurial) {
            primaryLocation = data.lot_number && data.lot_number !== 'N/A' ? `Lot ${data.lot_number}` : 'Unassigned Lot';
            secondaryLocation = data.section_name && data.section_name !== 'N/A' ? data.section_name : 'General Grounds';
        } else {
            primaryLocation = data.niche_number && data.niche_number !== 'N/A' ? `Niche ${data.niche_number}` : 'Unassigned Niche';
            secondaryLocation = data.columbarium && data.columbarium !== 'N/A' ? data.columbarium : 'Columbarium Vault';
        }
        const summaryLocation = `${primaryLocation} · ${secondaryLocation}`;

        // Schedule formatting
        const rawDate = data.schedule_date || data.date_raw || data.date_time || '';
        const rawTime = data.schedule_time || data.time_raw || '';
        let formattedDateStr = rawDate || 'Date to be determined';
        let formattedTimeStr = '';

        let datePart = rawDate;
        let timePart = rawTime;
        if (typeof rawDate === 'string' && rawDate.includes(' ') && !timePart) {
            const split = rawDate.split(' ');
            datePart = split[0];
            timePart = split.slice(1).join(' ');
        }
        if (datePart && datePart !== 'N/A') {
            try {
                const parts = String(datePart).split('-');
                if (parts.length === 3) {
                    const year = Number(parts[0]);
                    const month = Number(parts[1]) - 1;
                    const day = Number(parts[2]);
                    const d = new Date(year, month, day);
                    if (!isNaN(d.getTime())) {
                        formattedDateStr = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                    }
                }
            } catch (_) {
                formattedDateStr = datePart;
            }
        }
        if (timePart) {
            try {
                const timeComponents = timePart.split(':');
                if (timeComponents.length >= 2) {
                    let hour = parseInt(timeComponents[0], 10);
                    const minute = timeComponents[1];
                    const ampm = hour >= 12 ? 'PM' : 'AM';
                    hour = hour % 12 || 12;
                    formattedTimeStr = `${hour}:${minute} ${ampm}`;
                } else {
                    formattedTimeStr = timePart;
                }
            } catch (_) {
                formattedTimeStr = timePart;
            }
        }

        // Status pill helper
        const statusClean = String(data.status || 'Pending').trim();
        const sLower = statusClean.toLowerCase();
        let statusPillClass = 'status-pill--pending';

        if (sLower === 'confirmed') {
            statusPillClass = 'status-pill--confirmed';
        } else if (sLower === 'scheduled') {
            statusPillClass = 'status-pill--scheduled';
        } else if (sLower === 'completed') {
            statusPillClass = 'status-pill--completed';
        } else if (sLower === 'cancelled') {
            statusPillClass = 'status-pill--cancelled';
        }

        const isPaid = paymentStatusStr.toLowerCase() === 'paid';
        const canComplete = data.status === 'Confirmed' || data.status === 'Scheduled';
        const canCash = data.status === 'Pending';
        const canCancel = (data.status === 'Pending' || data.status === 'Confirmed' || data.status === 'Scheduled');

        detailModalBody.innerHTML = `
            <div class="booking-view-clean">
                <!-- Hero Header: Dark Green Accented Identity -->
                <div class="bview-hero">
                    <div class="bview-hero-top">
                        <div class="bview-decedent-block">
                            <span class="bview-service-badge">${isBurial ? 'Ground Burial' : 'Cremation Service'}</span>
                            <h3 class="bview-decedent-name">${escapeHtml(decedentDisplay)}</h3>
                            <div class="bview-meta-line">
                                <span class="bview-meta-ref">Booking #${id}</span>
                                <span class="bview-meta-sep">&bull;</span>
                                <span class="bview-meta-loc">${escapeHtml(primaryLocation)}, ${escapeHtml(secondaryLocation)}</span>
                                ${isProvisional ? '<span class="bview-meta-sep">&bull;</span><span class="bview-provisional-tag">Provisional Record</span>' : ''}
                            </div>
                        </div>
                        <div class="bview-status-block">
                            <span class="bview-status-pill ${statusPillClass}">
                                ${escapeHtml(statusClean)}
                            </span>
                        </div>
                    </div>
                </div>

                <!-- 2-Column Uncongested Information Grid -->
                <div class="bview-grid">
                    <!-- Column 1: Schedule & Location -->
                    <div class="bview-card">
                        <h4 class="bview-card-title">Schedule &amp; Interment</h4>
                        <div class="bview-fields">
                            <div class="bview-field">
                                <span class="bview-field-label">Ceremony Schedule</span>
                                <div class="bview-field-value bview-highlight-text">
                                    ${escapeHtml(formattedDateStr)}${formattedTimeStr ? ` &mdash; ${escapeHtml(formattedTimeStr)}` : ''}
                                </div>
                            </div>
                            <div class="bview-field">
                                <span class="bview-field-label">${isBurial ? 'Plot / Section Assignment' : 'Niche / Columbarium'}</span>
                                <div class="bview-field-value">
                                    <strong>${escapeHtml(primaryLocation)}</strong>
                                    <span class="bview-sub-text">${escapeHtml(secondaryLocation)}</span>
                                </div>
                            </div>
                            <div class="bview-field">
                                <span class="bview-field-label">Interment Mode</span>
                                <div class="bview-field-value">${isBurial ? 'Ground Burial Ceremony' : 'Columbarium Inurnment'}</div>
                            </div>
                        </div>
                    </div>

                    <!-- Column 2: Applicant & Contact -->
                    <div class="bview-card">
                        <h4 class="bview-card-title">Applicant &amp; Contact</h4>
                        <div class="bview-fields">
                            <div class="bview-field">
                                <span class="bview-field-label">Requested By</span>
                                <div class="bview-field-value bview-highlight-text">
                                    ${escapeHtml(applicantName)}
                                </div>
                            </div>
                            <div class="bview-field">
                                <span class="bview-field-label">Relationship to Deceased</span>
                                <div class="bview-field-value">${escapeHtml(relationship)}</div>
                            </div>
                            <div class="bview-field">
                                <span class="bview-field-label">Contact Phone</span>
                                <div class="bview-field-value">
                                    ${contactPhone ? `
                                    <a href="tel:${escapeHtml(contactPhone)}" class="bview-contact-link">
                                        ${escapeHtml(contactPhone)}
                                    </a>
                                    ` : '<span class="text-muted">No contact number</span>'}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Section 3: Financial & Accounting Summary Bar -->
                <div class="bview-payment-bar">
                    <div class="bview-pay-item bview-pay-item--main">
                        <span class="bview-pay-label">Settlement Fee</span>
                        <span class="bview-pay-amount">&#8369;${paymentAmountFormatted}</span>
                    </div>

                    <div class="bview-pay-divider"></div>

                    <div class="bview-pay-item">
                        <span class="bview-pay-label">Payment Status</span>
                        <span class="bview-pay-status-pill ${isPaid ? 'is-paid' : 'is-unpaid'}">
                            ${escapeHtml(paymentStatusStr)}
                        </span>
                    </div>

                    <div class="bview-pay-divider"></div>

                    <div class="bview-pay-item">
                        <span class="bview-pay-label">Payment Method</span>
                        <span class="bview-pay-text">${escapeHtml(paymentMethodStr)}</span>
                    </div>

                    ${paymentReceiptStr && paymentReceiptStr !== '—' ? `
                    <div class="bview-pay-divider"></div>
                    <div class="bview-pay-item">
                        <span class="bview-pay-label">Receipt / Reference</span>
                        <span class="bview-pay-code"><code>${escapeHtml(paymentReceiptStr)}</code></span>
                    </div>
                    ` : ''}

                    ${paymentDateStr && paymentDateStr !== '—' ? `
                    <div class="bview-pay-divider"></div>
                    <div class="bview-pay-item">
                        <span class="bview-pay-label">Settled On</span>
                        <span class="bview-pay-text">${escapeHtml(paymentDateStr)}</span>
                    </div>
                    ` : ''}

                    ${!isPaid && canCash ? `
                    <div class="bview-pay-item bview-pay-item--action">
                        <button type="button" class="btn-action-cash btn-action-cash--bar" id="barActionCash"><i class="fas fa-money-bill-wave"></i> Record Cash</button>
                    </div>
                    ` : ''}
                </div>

                <!-- Documentary Requirements & Verification Panel (Batch 7) -->
                <div class="view-documents-panel" style="margin-top: 14px;">
                    <div class="view-documents-header">
                        <span class="compact-group-title"><i class="fas fa-file-shield"></i> Documentary Requirements &amp; Verification</span>
                        <span class="doc-summary-pill ${escapeHtml(docSummary.badge_class || 'pending')}">
                            <i class="fas ${docSummary.all_uploaded ? 'fa-circle-check' : 'fa-clock'}"></i>
                            ${escapeHtml(docSummary.status_label || 'Pending Physical Presentation')}
                        </span>
                    </div>
                    <div class="doc-workflow-note">
                        <i class="fas fa-circle-info"></i> ${escapeHtml(docSummary.workflow_guidance || '')}
                    </div>
                    <div class="doc-checklist-grid">
                        ${docItems.map(doc => {
                            const isUploaded = Boolean(doc.is_uploaded);
                            const fileUrl = doc.file_url || (doc.file_path ? (doc.file_path.startsWith('/') ? doc.file_path : `/backend/${doc.file_path.replace(/^\.?\//, '')}`) : '');
                            return `
                                <div class="doc-item-card ${isUploaded ? 'is-uploaded' : 'is-pending'}">
                                    <div class="doc-item-head">
                                        <div class="doc-item-title">
                                            <i class="fas ${isUploaded ? 'fa-file-check text-success' : 'fa-file-lines text-muted'}"></i>
                                            <span>${escapeHtml(doc.title)}</span>
                                        </div>
                                        <span class="doc-item-badge ${isUploaded ? 'doc-uploaded' : 'doc-pending'}">
                                            <i class="fas ${isUploaded ? 'fa-check' : 'fa-hourglass-start'}"></i>
                                            ${isUploaded ? 'Uploaded' : 'At Office'}
                                        </span>
                                    </div>
                                    <div class="doc-item-desc">${escapeHtml(doc.description || '')}</div>
                                    <div class="doc-item-footer">
                                        ${isUploaded && fileUrl ? `
                                            <a href="${escapeHtml(fileUrl)}" target="_blank" rel="noopener noreferrer" class="btn-doc-view" title="${escapeHtml(doc.original_filename || 'View Document')}">
                                                <i class="fas fa-arrow-up-right-from-square"></i> View File
                                            </a>
                                            <small style="color:#64748b; font-size:0.68rem; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; max-width:110px;" title="${escapeHtml(doc.original_filename || '')}">
                                                ${escapeHtml(doc.original_filename || 'Attached')}
                                            </small>
                                        ` : `
                                            <span style="font-size:0.68rem; color:#854d0e;"><i class="fas fa-building"></i> Physical Original</span>
                                            <button type="button" class="btn-doc-upload staff-upload-trigger" data-doctype="${escapeHtml(doc.doc_type)}" data-booking-id="${id}" data-service="${serviceType}">
                                                <i class="fas fa-upload"></i> Attach
                                            </button>
                                        `}
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>

                ${data.notes ? `
                <div class="bview-note">
                    <span class="bview-note-label">Special Remarks</span>
                    <p class="bview-note-text">${escapeHtml(data.notes)}</p>
                </div>
                ` : ''}
            </div>
        `;

        // Wire staff document upload buttons (Batch 7)
        detailModalBody.querySelectorAll('.staff-upload-trigger').forEach(btn => {
            btn.addEventListener('click', () => {
                const docType = btn.getAttribute('data-doctype');
                const bookingId = btn.getAttribute('data-booking-id');
                const sType = btn.getAttribute('data-service');

                let fileInput = document.getElementById('staffDocUploadInput');
                if (!fileInput) {
                    fileInput = document.createElement('input');
                    fileInput.type = 'file';
                    fileInput.id = 'staffDocUploadInput';
                    fileInput.accept = '.pdf,.jpg,.jpeg,.png';
                    fileInput.style.display = 'none';
                    document.body.appendChild(fileInput);
                }

                fileInput.onchange = async () => {
                    const file = fileInput.files && fileInput.files[0];
                    if (!file) return;

                    btn.disabled = true;
                    btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Uploading...';

                    try {
                        const formData = new FormData();
                        formData.append('document_file', file);
                        formData.append('document_type', docType);

                        const token = api.getToken ? api.getToken() : localStorage.getItem('token');
                        const appBase = window.getAppOrigin ? window.getAppOrigin() : (window.location.pathname.includes('/CMS') ? `${window.location.origin}/CMS` : window.location.origin);
                        const resRaw = await fetch(`${appBase}/backend/routes/api.php?path=bookings/${sType}/${bookingId}/documents`, {
                            method: 'POST',
                            headers: token ? { 'Authorization': `Bearer ${token}` } : {},
                            body: formData
                        });
                        const res = await resRaw.json();

                        if (res && res.success) {
                            if (typeof showToast === 'function') {
                                showToast(`${docType.replace(/_/g, ' ')} attached successfully!`, 'success');
                            }
                            // Refresh detail modal
                            await viewBookingDetails(sType, bookingId);
                            // Refresh background bookings list
                            loadAndRenderBookings();
                        } else {
                            const errMsg = res?.error || 'Failed to upload document.';
                            if (typeof showToast === 'function') showToast(errMsg, 'error');
                            btn.disabled = false;
                            btn.innerHTML = '<i class="fas fa-upload"></i> Attach';
                        }
                    } catch (err) {
                        console.error('Staff upload failed:', err);
                        if (typeof showToast === 'function') showToast('Error uploading document file.', 'error');
                        btn.disabled = false;
                        btn.innerHTML = '<i class="fas fa-upload"></i> Attach';
                    } finally {
                        fileInput.value = '';
                    }
                };

                fileInput.click();
            });
        });

        // Modal Footer Actions — variables already declared above template
        detailModalFooter.innerHTML = `
            ${canCancel ? `<button type="button" class="btn-cancel-clean" id="modalActionCancel"><i class="fas fa-xmark"></i> Cancel Booking</button>` : ''}
            <div style="flex: 1;"></div>
            ${canCash ? `<button type="button" class="btn-action-cash" id="modalActionCash"><i class="fas fa-money-bill-wave"></i> Record Cash</button>` : ''}
            ${canComplete ? `<button type="button" class="btn btn-primary btn--sm" id="modalActionComplete"><i class="fas fa-check"></i> Mark Complete</button>` : ''}
            <button type="button" class="btn btn-secondary btn--sm" id="closeDetailModalBtn">Close</button>
        `;

        // Wire footer action buttons
        const modalActionCash = document.getElementById('modalActionCash');
        if (modalActionCash) {
            modalActionCash.addEventListener('click', () => {
                closeDetailModal();
                openCashModal(serviceType, id);
            });
        }

        const barActionCash = document.getElementById('barActionCash');
        if (barActionCash) {
            barActionCash.addEventListener('click', () => {
                closeDetailModal();
                openCashModal(serviceType, id);
            });
        }

        const modalActionComplete = document.getElementById('modalActionComplete');
        if (modalActionComplete) {
            modalActionComplete.addEventListener('click', async () => {
                await completeBooking(serviceType, id, modalActionComplete);
                closeDetailModal();
            });
        }

        const modalActionCancel = document.getElementById('modalActionCancel');
        if (modalActionCancel) {
            modalActionCancel.addEventListener('click', async () => {
                await cancelBooking(serviceType, id, modalActionCancel);
                closeDetailModal();
            });
        }

        const closeBtn = document.getElementById('closeDetailModalBtn');
        if (closeBtn) closeBtn.addEventListener('click', closeDetailModal);
    }

    function formatAuditDetails(details) {
        if (!details) return '';
        if (typeof details === 'string') {
            try {
                details = JSON.parse(details);
            } catch (_) {
                return `<span class="audit-note">${escapeHtml(details)}</span>`;
            }
        }
        if (typeof details !== 'object' || details === null) {
            return `<span class="audit-note">${escapeHtml(String(details))}</span>`;
        }

        const AUDIT_FIELD_LABELS = {
            status: 'Status',
            payment_status: 'Payment Status',
            schedule_date: 'Schedule Date',
            schedule_time: 'Schedule Time',
            cremation_date: 'Cremation Date',
            lot_id: 'Lot ID',
            deceased_id: 'Deceased Record',
            decedent_request_id: 'Decedent Request',
            columbarium: 'Columbarium',
            niche_number: 'Niche',
            notes: 'Notes',
        };

        return Object.entries(details).map(([field, value]) => {
            if (field === 'note') return `<span class="audit-note">${escapeHtml(String(value))}</span>`;
            const label = AUDIT_FIELD_LABELS[field] || field.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            if (value === 'changed') return `<span class="audit-chip"><strong>${escapeHtml(label)}</strong> updated</span>`;
            if (value && typeof value === 'object' && ('from' in value || 'to' in value)) {
                return `<span class="audit-chip"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value.from ?? '—')} &rarr; ${escapeHtml(value.to ?? '—')}</span>`;
            }
            return `<span class="audit-chip"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value))}</span>`;
        }).join(' ');
    }

    function renderBookingActivityTimeline(entries) {
        const timelineEl = document.getElementById('bookingActivityTimeline');
        if (!timelineEl) return;

        if (!Array.isArray(entries) || entries.length === 0) {
            timelineEl.innerHTML = '<p class="activity-empty"><i class="fas fa-clock-rotate-left"></i> No audit events recorded yet for this booking.</p>';
            return;
        }

        timelineEl.innerHTML = entries.map(entry => {
            const actionLower = (entry.action || '').toLowerCase();
            let iconClass = 'fa-circle-dot';
            let badgeClass = 'timeline-badge--default';
            if (actionLower.includes('creat') || actionLower.includes('add') || actionLower.includes('book')) {
                iconClass = 'fa-circle-plus';
                badgeClass = 'timeline-badge--created';
            } else if (actionLower.includes('update') || actionLower.includes('edit') || actionLower.includes('confirm') || actionLower.includes('verif')) {
                iconClass = 'fa-pen-to-square';
                badgeClass = 'timeline-badge--updated';
            } else if (actionLower.includes('cancel') || actionLower.includes('delete') || actionLower.includes('remov')) {
                iconClass = 'fa-trash-can';
                badgeClass = 'timeline-badge--deleted';
            } else if (actionLower.includes('document') || actionLower.includes('upload')) {
                iconClass = 'fa-file-arrow-up';
                badgeClass = 'timeline-badge--document';
            }

            const summary = formatAuditDetails(entry.details);
            return `
                <div class="activity-entry">
                    <div class="timeline-indicator ${badgeClass}">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    <div class="activity-entry-content">
                        <div class="activity-entry-header">
                            <strong class="activity-action-title">${escapeHtml(entry.action)}</strong>
                            <span class="activity-entry-time"><i class="far fa-clock"></i> ${escapeHtml(entry.created_at || '')}</span>
                        </div>
                        <div class="activity-entry-meta"><i class="far fa-user"></i> ${escapeHtml(entry.user_full_name || entry.username || 'System Automation')}</div>
                        ${summary ? `<div class="activity-entry-details">${summary}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    async function viewBookingDetails(serviceType, id) {
        currentViewBookingId = id;
        currentViewServiceType = serviceType;

        const drawer = document.getElementById('bookingActivityDrawer');
        if (drawer) drawer.open = false;

        // 1. Instant Render from Cache if available (Zero Delay)
        const cached = cachedCurrentPageData.find(item => String(item.id) === String(id) && item.service_type === serviceType);
        if (cached) {
            renderBookingContent(cached, serviceType, id);
        } else {
            detailModalBody.innerHTML = '<p style="text-align:center; padding:40px; color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><br><span style="margin-top:10px; display:inline-block;">Loading booking details...</span></p>';
        }

        // Open modal immediately
        detailModal.classList.add('active');
        detailModal.style.display = 'flex';

        // 2. Fetch fresh details in background and update smoothly
        try {
            let freshData = null;
            // First attempt unified endpoint
            try {
                const unifiedRes = await api.request(`bookings/${serviceType}/${id}`, { method: 'GET' });
                if (unifiedRes && unifiedRes.success && unifiedRes.data) {
                    freshData = unifiedRes.data;
                }
            } catch (_) {
                freshData = null;
            }

            // Fallback to schedules or cremations if unified endpoint was unavailable
            if (!freshData) {
                const endpoint = serviceType === 'burial' ? `schedules/${id}` : `cremations/${id}`;
                const rawRes = await api.request(endpoint, { method: 'GET' });
                if (rawRes && !rawRes.error) {
                    freshData = rawRes;
                }
            }

            if (freshData && currentViewBookingId === id && currentViewServiceType === serviceType) {
                renderBookingContent(freshData, serviceType, id);
            }
        } catch (error) {
            console.warn('Background booking fetch warning:', error);
            if (!cached) {
                detailModalBody.innerHTML = '<p class="error-msg" style="color:#ef4444; padding:20px; text-align:center;">Unable to load booking details right now.</p>';
            }
        }

        // 3. Load Activity & Audit Trail timeline
        const timelineEl = document.getElementById('bookingActivityTimeline');
        if (timelineEl) {
            timelineEl.innerHTML = '<p class="activity-loading"><i class="fas fa-spinner fa-spin"></i> Loading activity history...</p>';
            try {
                const entityType = serviceType === 'burial' ? 'Schedule' : 'Cremation';
                const entries = await api.request(`audit-logs?entity_type=${entityType}&entity_id=${id}`, { method: 'GET' });
                if (currentViewBookingId === id) {
                    renderBookingActivityTimeline(entries);
                }
            } catch (err) {
                if (currentViewBookingId === id) {
                    timelineEl.innerHTML = '<p class="activity-empty"><i class="fas fa-clock-rotate-left"></i> No activity recorded yet for this booking.</p>';
                }
            }
        }
    }

    function closeDetailModal() {
        detailModal.style.display = 'none';
        detailModal.classList.remove('active');
        currentViewBookingId = null;
        currentViewServiceType = null;
    }

    if (closeDetailModalBtn) {
        closeDetailModalBtn.addEventListener('click', closeDetailModal);
    }
    detailModal.addEventListener('click', (e) => {
        if (e.target === detailModal) closeDetailModal();
    });

    // ── CASH PAYMENT & COMPLETION MODAL ─────────────────────────
    function openCashModal(serviceType, id) {
        cashPaymentTargetId.value = id;
        cashPaymentServiceType.value = serviceType;
        cashPaymentAmount.value = '';
        cashPaymentReceipt.value = '';
        cashPaymentMethod.value = 'Cash';

        if (serviceType === 'burial') {
            cashPaymentHelpText.textContent = 'Marks the burial reservation Completed, marks the lot Occupied in Lot Management, creates a 5-year lease in Expiration Monitoring, and records a Verified payment in Revenue Reports.';
        } else {
            cashPaymentHelpText.textContent = 'Marks the cremation Completed, auto-assigns an available columbarium niche, updates columbarium capacity, and records a Verified payment in Revenue Reports.';
        }

        cashModal.style.display = 'flex';
        cashPaymentAmount.focus();
    }

    function closeCashModal() {
        cashModal.style.display = 'none';
    }

    document.getElementById('closeCashModal').addEventListener('click', closeCashModal);
    document.getElementById('cancelCashModal').addEventListener('click', closeCashModal);
    cashModal.addEventListener('click', (e) => {
        if (e.target === cashModal) closeCashModal();
    });

    cashPaymentForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        const id = cashPaymentTargetId.value;
        const serviceType = cashPaymentServiceType.value;
        const amount = parseFloat(cashPaymentAmount.value);
        if (isNaN(amount) || amount <= 0) {
            showToast('Please enter a valid payment amount.', { type: 'error' });
            return;
        }
        const method = cashPaymentMethod.value;
        const receiptNumber = cashPaymentReceipt.value.trim();

        const endpoint = serviceType === 'burial' ? `schedules/${id}` : `cremations/${id}`;
        const submitBtn = document.getElementById('submitCashPayment');

        await withButtonLoading(submitBtn, async () => {
            try {
                const result = await api.request(endpoint, {
                    method: 'PUT',
                    body: {
                        status: 'Completed',
                        payment_amount: amount,
                        payment_method: method,
                        receipt_number: receiptNumber,
                    },
                });

                if (result.success) {
                    closeCashModal();
                    showToast('Cash payment verified and booking completed successfully!', { type: 'success' });
                    await refreshAll();
                } else {
                    showToast(result.error || 'Unable to complete booking.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Unable to complete booking.', { type: 'error' });
            }
        });
    });

    // ── ACTION HANDLERS (COMPLETE & CANCEL) ─────────────────────
    async function completeBooking(serviceType, id, button) {
        const title = serviceType === 'burial' ? 'Complete burial reservation?' : 'Complete cremation request?';
        const message = serviceType === 'burial'
            ? 'This marks the burial completed, marks the plot occupied, and activates lease monitoring.'
            : 'This marks the cremation completed and finalizes the columbarium niche assignment.';

        const confirmed = await confirmDialog({
            title: title,
            message: message,
            confirmLabel: 'Yes, mark completed',
            cancelLabel: 'Cancel',
        });
        if (!confirmed) return;

        const endpoint = serviceType === 'burial' ? `schedules/${id}` : `cremations/${id}`;
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(endpoint, {
                    method: 'PUT',
                    body: { status: 'Completed' },
                });
                if (result.success) {
                    showToast('Booking marked as Completed.', { type: 'success' });
                    await refreshAll();
                } else {
                    showToast(result.error || 'Unable to complete booking.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Unable to complete booking.', { type: 'error' });
            }
        });
    }

    async function cancelBooking(serviceType, id, button) {
        const title = serviceType === 'burial' ? 'Cancel burial reservation?' : 'Cancel cremation request?';
        const message = serviceType === 'burial'
            ? 'This will cancel the reservation and release the held lot. This cannot be undone.'
            : 'This will cancel the cremation request. This cannot be undone.';

        const confirmed = await confirmDialog({
            title: title,
            message: message,
            confirmLabel: 'Cancel booking',
            cancelLabel: 'Keep booking',
            danger: true,
        });
        if (!confirmed) return;

        const endpoint = serviceType === 'burial' ? `schedules/${id}` : `cremations/${id}`;
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(endpoint, { method: 'DELETE' });
                if (result.success) {
                    showToast('Booking cancelled.', { type: 'success' });
                    await refreshAll();
                } else {
                    showToast(result.error || 'Unable to cancel booking.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Unable to cancel booking.', { type: 'error' });
            }
        });
    }

    bookingsBody.addEventListener('click', async function(event) {
        const button = event.target.closest('button[data-action]');
        if (!button) return;
        const id = button.getAttribute('data-id');
        const serviceType = button.getAttribute('data-service');
        const action = button.getAttribute('data-action');
        if (!id || !action || !serviceType) return;

        if (action === 'view') {
            await viewBookingDetails(serviceType, id);
        } else if (action === 'complete') {
            await completeBooking(serviceType, id, button);
        } else if (action === 'complete-cash') {
            openCashModal(serviceType, id);
        } else if (action === 'cancel') {
            await cancelBooking(serviceType, id, button);
        }
    });

    // ── SEARCH & FILTER LISTENERS ──────────────────────────────
    const debouncedFilter = debounce(async () => {
        pagination.reset();
        currentQuery = searchQuery.value || '';
        currentStatus = statusFilter.value || '';
        updateActiveStatCards();
        await loadAndRenderBookings();
    }, 250);

    searchQuery.addEventListener('input', debouncedFilter);
    statusFilter.addEventListener('change', debouncedFilter);

    if (toggleAwaitingBtn) {
        const handleAwaitingToggle = async () => {
            const nextState = toggleAwaitingBtn.tagName === 'BUTTON' ? !awaitingReviewOnly : toggleAwaitingBtn.checked;
            syncAwaitingReviewUI(nextState);
            if (awaitingReviewOnly) {
                currentStatus = '';
                statusFilter.value = '';
            }
            updateActiveStatCards();
            pagination.reset();
            await loadAndRenderBookings();
        };

        toggleAwaitingBtn.addEventListener('click', () => {
            if (toggleAwaitingBtn.tagName === 'BUTTON') handleAwaitingToggle();
        });
        toggleAwaitingBtn.addEventListener('change', () => {
            if (toggleAwaitingBtn.tagName !== 'BUTTON') handleAwaitingToggle();
        });
    }

    clearFilters.addEventListener('click', async () => {
        searchQuery.value = '';
        statusFilter.value = '';
        currentQuery = '';
        currentStatus = '';
        syncAwaitingReviewUI(false);
        updateActiveStatCards();
        pagination.reset();
        await loadAndRenderBookings();
    });

    // ── STAT CARD INTERACTION & FILTERING (MIRRORS ADMIN DASHBOARD & QUICK FILTER) ────
    document.querySelectorAll('.bookings-stats .stat-card').forEach((card) => {
        const action = card.getAttribute('data-action') || '';
        if (card.dataset.navBound) return;
        card.dataset.navBound = 'true';

        async function handleCardAction(e) {
            if (e) e.preventDefault();

            if (action === 'all') {
                currentTab = 'all';
                currentStatus = '';
                statusFilter.value = '';
                searchQuery.value = '';
                currentQuery = '';
                syncAwaitingReviewUI(false);
                tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === 'all'));
                const newUrl = new URL(window.location.href.split('?')[0]);
                window.history.pushState({}, '', newUrl);
                updateActiveStatCards();
                pagination.reset();
                await loadAndRenderBookings();
            } else if (action === 'burial') {
                const nextTab = (currentTab === 'burial' && !currentStatus && !awaitingReviewOnly) ? 'all' : 'burial';
                currentTab = nextTab;
                currentStatus = '';
                statusFilter.value = '';
                syncAwaitingReviewUI(false);
                tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === nextTab));
                const newUrl = new URL(window.location.href.split('?')[0]);
                if (nextTab !== 'all') newUrl.searchParams.set('service', nextTab);
                window.history.pushState({}, '', newUrl);
                updateActiveStatCards();
                pagination.reset();
                await loadAndRenderBookings();
            } else if (action === 'cremation') {
                const nextTab = (currentTab === 'cremation' && !currentStatus && !awaitingReviewOnly) ? 'all' : 'cremation';
                currentTab = nextTab;
                currentStatus = '';
                statusFilter.value = '';
                syncAwaitingReviewUI(false);
                tabBtns.forEach(btn => btn.classList.toggle('active', btn.dataset.tab === nextTab));
                const newUrl = new URL(window.location.href.split('?')[0]);
                if (nextTab !== 'all') newUrl.searchParams.set('service', nextTab);
                window.history.pushState({}, '', newUrl);
                updateActiveStatCards();
                pagination.reset();
                await loadAndRenderBookings();
            } else if (action === 'completed') {
                if (currentStatus === 'Completed') {
                    currentStatus = '';
                    statusFilter.value = '';
                } else {
                    currentStatus = 'Completed';
                    statusFilter.value = 'Completed';
                    if (awaitingReviewOnly) {
                        syncAwaitingReviewUI(false);
                    }
                }
                const newUrl = new URL(window.location.href.split('?')[0]);
                if (currentTab !== 'all') newUrl.searchParams.set('service', currentTab);
                if (currentStatus) newUrl.searchParams.set('status', currentStatus);
                window.history.pushState({}, '', newUrl);
                updateActiveStatCards();
                pagination.reset();
                await loadAndRenderBookings();
            } else if (action === 'review') {
                const nextState = !awaitingReviewOnly;
                syncAwaitingReviewUI(nextState);
                if (awaitingReviewOnly) {
                    currentStatus = '';
                    statusFilter.value = '';
                }
                const newUrl = new URL(window.location.href.split('?')[0]);
                if (currentTab !== 'all') newUrl.searchParams.set('service', currentTab);
                if (awaitingReviewOnly) newUrl.searchParams.set('awaiting_confirmation', '1');
                window.history.pushState({}, '', newUrl);
                updateActiveStatCards();
                pagination.reset();
                await loadAndRenderBookings();
            }
        }

        card.addEventListener('click', handleCardAction);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleCardAction(e);
            }
        });
    });

    // ── EXPORT TOOLS (REPORTS INSPIRATION) ──────────────────────
    exportPdfBtn.addEventListener('click', () => {
        window.print();
    });

    exportCsvBtn.addEventListener('click', () => {
        if (!cachedCurrentPageData || cachedCurrentPageData.length === 0) {
            showToast('No booking records to export.', { type: 'info' });
            return;
        }

        const headers = ['Booking Ref', 'Service', 'Decedent', 'Location / Niche', 'Date & Time', 'Requested By', 'Status', 'Payment'];
        const rows = cachedCurrentPageData.map(item => [
            `"${item.ref_label}"`,
            `"${item.service_type.toUpperCase()}"`,
            `"${item.decedent_name.replace(/"/g, '""')}"`,
            `"${item.location_label.replace(/"/g, '""')}"`,
            `"${item.date_time}"`,
            `"${item.created_by_name.replace(/"/g, '""')}"`,
            `"${item.status}"`,
            `"${item.payment_status}"`,
        ]);

        const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
        const encodedUri = encodeURI(csvContent);
        const link = document.createElement('a');
        link.setAttribute('href', encodedUri);
        link.setAttribute('download', `Cemetery_Bookings_${new Date().toISOString().slice(0, 10)}.csv`);
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        showToast('Bookings exported to CSV.', { type: 'success' });
    });

    // Initial load
    await refreshAll();
});
