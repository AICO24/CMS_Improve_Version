document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin', 'staff']);
    if (!user) return;

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    // Sidebar collapse setup
    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // AI Assistant mount
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
    if (awaitingReviewOnly) {
        if (toggleAwaitingBtn) {
            toggleAwaitingBtn.checked = true;
            toggleAwaitingBtn.setAttribute('aria-pressed', 'true');
        }
        statusFilter.disabled = true;
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
    function setActiveTab(tab) {
        currentTab = tab;
        tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tab);
        });

        // Update URL query state without full page reload
        const newUrl = new URL(window.location);
        newUrl.searchParams.set('service', tab);
        window.history.replaceState({}, '', newUrl);

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
                    <th>Booking Ref</th>
                    <th>Decedent</th>
                    <th>Lot</th>
                    <th>Section</th>
                    <th>Burial Date &amp; Time</th>
                    <th>Requested By</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Actions</th>
                </tr>
            `;
        } else if (currentTab === 'cremation') {
            bookingsHead.innerHTML = `
                <tr>
                    <th>Request Ref</th>
                    <th>Decedent</th>
                    <th>Columbarium</th>
                    <th>Niche</th>
                    <th>Cremation Date</th>
                    <th>Requested By</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Actions</th>
                </tr>
            `;
        } else {
            bookingsHead.innerHTML = `
                <tr>
                    <th>Ref #</th>
                    <th>Service</th>
                    <th>Decedent</th>
                    <th>Location / Slot</th>
                    <th>Schedule Date &amp; Time</th>
                    <th>Requested By</th>
                    <th>Status</th>
                    <th>Payment</th>
                    <th>Actions</th>
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
        if (currentTab === 'burial') {
            return `
                <tr data-id="${item.id}" data-service="${item.service_type}">
                    <td><strong>${item.ref_label}</strong></td>
                    <td>${escapeHtml(item.decedent_name)}</td>
                    <td>${escapeHtml(item.lot_number)}</td>
                    <td>${escapeHtml(item.section_name)}</td>
                    <td>${escapeHtml(item.date_time)}</td>
                    <td>${escapeHtml(item.created_by_name)}</td>
                    <td>${buildStatusBadge(item.status)}</td>
                    <td>${buildPaymentBadge(item)}</td>
                    <td class="action-buttons">${buildActionButtons(item)}</td>
                </tr>
            `;
        }

        if (currentTab === 'cremation') {
            return `
                <tr data-id="${item.id}" data-service="${item.service_type}">
                    <td><strong>${item.ref_label}</strong></td>
                    <td>${escapeHtml(item.decedent_name)}</td>
                    <td>${escapeHtml(item.columbarium)}</td>
                    <td>${escapeHtml(item.niche_number)}</td>
                    <td>${escapeHtml(item.date_time)}</td>
                    <td>${escapeHtml(item.created_by_name)}</td>
                    <td>${buildStatusBadge(item.status)}</td>
                    <td>${buildPaymentBadge(item)}</td>
                    <td class="action-buttons">${buildActionButtons(item)}</td>
                </tr>
            `;
        }

        return `
            <tr data-id="${item.id}" data-service="${item.service_type}">
                <td><strong>${item.ref_label}</strong></td>
                <td>${buildServiceBadge(item.service_type)}</td>
                <td>${escapeHtml(item.decedent_name)}</td>
                <td>${item.location_label}</td>
                <td>${escapeHtml(item.date_time)}</td>
                <td>${escapeHtml(item.created_by_name)}</td>
                <td>${buildStatusBadge(item.status)}</td>
                <td>${buildPaymentBadge(item)}</td>
                <td class="action-buttons">${buildActionButtons(item)}</td>
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

    // ── DETAIL VIEW MODAL (Decedent Records Pattern) ───────────
    async function viewBookingDetails(serviceType, id) {
        detailModalBody.innerHTML = '<p style="text-align:center; padding:40px; color:#64748b;"><i class="fas fa-spinner fa-spin fa-2x"></i><br><span style="margin-top:10px; display:inline-block;">Loading booking details...</span></p>';
        detailModal.style.display = 'flex';

        const endpoint = serviceType === 'burial' ? `schedules/${id}` : `cremations/${id}`;
        try {
            const data = await api.request(endpoint, { method: 'GET' });
            if (data.error) {
                detailModalBody.innerHTML = `<p class="error-msg" style="color:#ef4444; padding:20px; text-align:center;">${escapeHtml(data.error)}</p>`;
                return;
            }

            const isBurial = serviceType === 'burial';
            const fullName = (data.first_name || data.last_name) ? `${data.first_name || ''} ${data.last_name || ''}`.trim() : '';
            const decedentDisplay = fullName || (data.provisional_name ? `${data.provisional_name}` : 'Unspecified Decedent');
            const isProvisional = !fullName && !!data.provisional_name;

            const scheduleDisplay = isBurial
                ? `${data.schedule_date || 'Date TBD'}${data.schedule_time ? ` at ${data.schedule_time}` : ''}`
                : (data.cremation_date ? `${data.cremation_date}` : 'Date TBD');

            const statusTrackerHtml = window.reservationUI.buildStatusTracker(data.status, data.payment_status, {
                confirmedLabel: isBurial ? 'Confirmed' : 'Scheduled'
            });

            // Location calculation
            const locationDisplay = isBurial
                ? (data.lot_number ? `Lot ${escapeHtml(data.lot_number)}, Section ${escapeHtml(data.section_name || 'Standard')}` : 'No lot assigned yet')
                : `${escapeHtml(data.columbarium || 'Columbarium')} &bull; Niche ${escapeHtml(data.niche_number || 'Auto-allocated upon completion')}`;

            // Payment calculation
            const paymentStatusStr = data.payment_status || 'Unpaid';
            const paymentAmountFormatted = parseFloat(data.payment_amount || 0).toLocaleString('en-US', { minimumFractionDigits: 2 });
            const paymentMethodStr = data.payment_method || 'Standard';
            const paymentReceiptStr = data.payment_receipt_number || 'N/A';
            const paymentDateStr = data.payment_date || 'N/A';

            detailModalBody.innerHTML = `
                <!-- View Hero Profile Card -->
                <div class="view-hero-card">
                    <div class="view-hero-avatar ${isBurial ? 'avatar--burial' : 'avatar--cremation'}">
                        <i class="fas ${isBurial ? 'fa-monument' : 'fa-fire'}"></i>
                    </div>
                    <div class="view-hero-info">
                        <div class="view-hero-title-row">
                            <h2 class="view-decedent-name">${escapeHtml(decedentDisplay)}</h2>
                            <div class="view-status-wrap">
                                ${buildServiceBadge(serviceType)}
                                ${buildStatusBadge(data.status)}
                                ${isProvisional ? '<span class="view-schedule-pill" style="background:#fef3c7; color:#92400e;"><i class="fas fa-user-clock"></i> Provisional Request</span>' : ''}
                            </div>
                        </div>
                        <div class="view-hero-schedule">
                            <i class="fas fa-calendar-day"></i>
                            <span>${escapeHtml(scheduleDisplay)}</span>
                            <span class="view-schedule-pill">${isBurial ? 'Ground Interment' : 'Cremation Ceremony'}</span>
                        </div>
                    </div>
                </div>

                <!-- 4-Stage Stepper Tracker -->
                <div class="booking-stepper-wrap">
                    ${statusTrackerHtml}
                </div>

                <!-- 2-Column Info Cards Grid -->
                <div class="view-details-grid">
                    <!-- Card 1: Ceremony & Slot Allocation -->
                    <div class="view-info-card">
                        <div class="view-card-header">
                            <i class="fas fa-calendar-check"></i>
                            <span>Ceremony &amp; Allocation Details</span>
                        </div>
                        <div class="view-card-body">
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-hashtag"></i> Booking Ref</span>
                                <strong class="prop-value">#${id} (${isBurial ? 'Burial' : 'Cremation'})</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-clock"></i> Schedule Date &amp; Time</span>
                                <strong class="prop-value">${escapeHtml(scheduleDisplay)}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas ${isBurial ? 'fa-map-pin' : 'fa-box-archive'}"></i> ${isBurial ? 'Assigned Lot & Section' : 'Columbarium & Niche'}</span>
                                <strong class="prop-value">${locationDisplay}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-circle-nodes"></i> Operational Lifecycle</span>
                                <strong class="prop-value">${data.status === 'Completed' ? '<span style="color:#059669; font-weight:700;"><i class="fas fa-circle-check"></i> Completed &amp; Synchronized</span>' : (data.status === 'Cancelled' ? '<span style="color:#dc2626;"><i class="fas fa-ban"></i> Cancelled &amp; Released</span>' : '<span style="color:#d97706;"><i class="fas fa-hourglass-half"></i> Active / In Progress</span>')}</strong>
                            </div>
                        </div>
                    </div>

                    <!-- Card 2: Family & Client Information -->
                    <div class="view-info-card">
                        <div class="view-card-header">
                            <i class="fas fa-user-group"></i>
                            <span>Applicant &amp; Family Record</span>
                        </div>
                        <div class="view-card-body">
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-user"></i> Requested By</span>
                                <strong class="prop-value">${escapeHtml(data.created_by_name || 'Citizen User')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-phone"></i> Contact Phone</span>
                                <strong class="prop-value">${escapeHtml(data.contact_number || data.phone || data.created_by_phone || 'On file')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-envelope"></i> Email Address</span>
                                <strong class="prop-value">${escapeHtml(data.created_by_email || data.email || 'Verified user')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-heart"></i> Kin Relationship</span>
                                <strong class="prop-value">${escapeHtml(data.relationship || 'Next of kin / Representative')}</strong>
                            </div>
                        </div>
                    </div>

                    <!-- Card 3: Payment & Accounting Record -->
                    <div class="view-info-card">
                        <div class="view-card-header">
                            <i class="fas fa-credit-card"></i>
                            <span>Payment &amp; Accounting Record</span>
                        </div>
                        <div class="view-card-body">
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-shield-check"></i> Payment Status</span>
                                <strong class="prop-value">${buildPaymentBadge({ payment_status: paymentStatusStr })}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-peso-sign"></i> Amount</span>
                                <strong class="prop-value">&#8369;${paymentAmountFormatted}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-receipt"></i> Official Receipt</span>
                                <strong class="prop-value">${escapeHtml(paymentReceiptStr)}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-money-bill-transfer"></i> Payment Method</span>
                                <strong class="prop-value">${escapeHtml(paymentMethodStr)}</strong>
                            </div>
                        </div>
                    </div>

                    <!-- Card 4: Audit & System Metadata -->
                    <div class="view-info-card">
                        <div class="view-card-header">
                            <i class="fas fa-shield-halved"></i>
                            <span>System &amp; Verification Trail</span>
                        </div>
                        <div class="view-card-body">
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-calendar-plus"></i> Creation Date</span>
                                <strong class="prop-value">${escapeHtml(data.created_at || 'System record')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-file-invoice"></i> Settlement Date</span>
                                <strong class="prop-value">${escapeHtml(paymentDateStr)}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-user-shield"></i> Handled By</span>
                                <strong class="prop-value">${escapeHtml(user.name || 'Staff Console')}</strong>
                            </div>
                            <div class="view-prop-row">
                                <span class="prop-label"><i class="fas fa-bell"></i> Automation Trail</span>
                                <strong class="prop-value"><span style="color:#0f766e;"><i class="fas fa-check-double"></i> Verified Sync</span></strong>
                            </div>
                        </div>
                    </div>
                </div>

                ${data.notes ? `
                <!-- Special Instructions / Notes Box -->
                <div class="booking-notes-box">
                    <div class="booking-notes-label"><i class="fas fa-note-sticky"></i> Special Instructions &amp; Requests</div>
                    <p class="booking-notes-text">${escapeHtml(data.notes)}</p>
                </div>
                ` : ''}
            `;

            // Modal Footer Actions
            const footerEl = document.getElementById('bookingDetailFooter');
            const canComplete = data.status === 'Confirmed' || data.status === 'Scheduled';
            const canCash = data.status === 'Pending';
            const canCancel = (data.status === 'Pending' || data.status === 'Confirmed' || data.status === 'Scheduled');

            footerEl.innerHTML = `
                ${canCash ? `<button type="button" class="btn-secondary" id="modalActionCash" style="color:#d97706; border-color:#fde68a; background:#fffbeb;"><i class="fas fa-money-bill-wave"></i> Record Cash</button>` : ''}
                ${canComplete ? `<button type="button" class="btn-secondary" id="modalActionComplete" style="color:#059669; border-color:#a7f3d0; background:#ecfdf5;"><i class="fas fa-check"></i> Mark Complete</button>` : ''}
                ${canCancel ? `<button type="button" class="btn-secondary" id="modalActionCancel" style="color:#dc2626; border-color:#fecaca; background:#fef2f2;"><i class="fas fa-xmark"></i> Cancel Booking</button>` : ''}
                <button type="button" class="btn-secondary" id="closeDetailModalBtn">Close</button>
            `;

            // Wire footer action buttons
            const modalActionCash = document.getElementById('modalActionCash');
            if (modalActionCash) {
                modalActionCash.addEventListener('click', () => {
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

        } catch (error) {
            console.error('Error viewing booking details:', error);
            detailModalBody.innerHTML = '<p class="error-msg" style="color:#ef4444; padding:20px; text-align:center;">Unable to load booking details right now.</p>';
        }
    }

    function closeDetailModal() {
        detailModal.style.display = 'none';
    }

    closeDetailModalBtn.addEventListener('click', closeDetailModal);
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
        await loadAndRenderBookings();
    }, 250);

    searchQuery.addEventListener('input', debouncedFilter);
    statusFilter.addEventListener('change', debouncedFilter);

    if (toggleAwaitingBtn) {
        toggleAwaitingBtn.addEventListener('change', async () => {
            awaitingReviewOnly = toggleAwaitingBtn.checked;
            toggleAwaitingBtn.setAttribute('aria-pressed', String(awaitingReviewOnly));
            statusFilter.disabled = awaitingReviewOnly;
            pagination.reset();
            await loadAndRenderBookings();
        });
    }

    clearFilters.addEventListener('click', async () => {
        searchQuery.value = '';
        statusFilter.value = '';
        statusFilter.disabled = false;
        currentQuery = '';
        currentStatus = '';
        awaitingReviewOnly = false;
        if (toggleAwaitingBtn) {
            toggleAwaitingBtn.checked = false;
            toggleAwaitingBtn.setAttribute('aria-pressed', 'false');
        }
        pagination.reset();
        await loadAndRenderBookings();
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
