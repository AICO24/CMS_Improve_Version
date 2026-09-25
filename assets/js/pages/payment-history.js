document.addEventListener('DOMContentLoaded', async function() {
    const currentUser = await requireRole(['user']);
    if (!currentUser) return;

    // BATCH AI-4 (AI Architecture Audit, 2026-09-02): same citizen-scoped
    // pattern as my-reservations.js — scope='module' only, always filtered
    // server-side to this citizen's own payments (see
    // AuditIntelligenceService::buildCitizenModuleContext() and
    // AiController::askAssistant()'s citizen branch), never another
    // citizen's, never system-wide.
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Payment' },
        greeting: "Hello! I'm your AI assistant for your payments. How can I help you today?",
        suggestions: [
            { icon: 'fa-money-bill-wave', label: 'My payment status', question: 'What is the status of my payments right now?' },
            { icon: 'fa-clock-rotate-left', label: 'Recent payments', question: 'What have my most recent payments been?' },
        ],
    });

    const tbody = document.getElementById('paymentsTableBody');
    const statsEl = {
        totalRevenue: document.getElementById('totalRevenue'),
        monthRevenue: document.getElementById('monthRevenue'),
        transactionCount: document.getElementById('transactionCount'),
        lastPayment: document.getElementById('lastPayment')
    };

    const referenceFilterInput = document.getElementById('referenceFilter');
    const transactionTypeFilterSelect = document.getElementById('transactionTypeFilter');
    const statusFilterSelect = document.getElementById('statusFilter');
    const dateFromFilterInput = document.getElementById('dateFromFilter');
    const dateToFilterInput = document.getElementById('dateToFilter');
    const clearFiltersBtn = document.getElementById('clearFilters');
    const activeFilterChips = document.getElementById('activeFilterChips');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');

    const perPage = 10;
    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        infoEl: paginationInfo,
        itemLabel: 'payment',
        onChange: refreshAll,
    });

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

    const notificationBtn = document.getElementById('notificationIcon');
    if (notificationBtn) {
        const openNotifications = () => {
            const basePath = typeof getFrontendBasePath === 'function' ? getFrontendBasePath() : '../..';
            window.location.href = `${basePath}/pages/notifications.html`;
        };
        notificationBtn.addEventListener('click', openNotifications);
        notificationBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openNotifications();
            }
        });
    }

    const openProfile = () => {
        const basePath = typeof getFrontendBasePath === 'function' ? getFrontendBasePath() : '../..';
        window.location.href = `${basePath}/pages/profile.html`;
    };
    const userProfileEl = document.getElementById('userProfile');
    if (userProfileEl) {
        userProfileEl.addEventListener('click', openProfile);
        userProfileEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openProfile();
            }
        });
    }
    document.getElementById('sidebarUserChip')?.addEventListener('click', openProfile);

    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                const count = Number(result.count || 0);
                badge.textContent = String(count);
                badge.style.display = 'flex';
            }
        } catch (e) {
            console.error('Failed to load notification count:', e);
        }
    }

    function currentFilters() {
        return {
            reference_id: referenceFilterInput.value.trim(),
            transaction_type: transactionTypeFilterSelect.value,
            verification_status: statusFilterSelect.value,
            date_from: dateFromFilterInput.value,
            date_to: dateToFilterInput.value,
        };
    }

    function filterParams() {
        const params = new URLSearchParams();
        const filters = currentFilters();
        Object.keys(filters).forEach((key) => {
            if (filters[key]) params.set(key, filters[key]);
        });
        return params;
    }

    async function loadPayments() {
        const params = filterParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        const result = await api.request(`payments/mine?${params.toString()}`, { method: 'GET' });
        return result && Array.isArray(result.data) ? result : { data: [], meta: { page: 1, pages: 1, total: 0 } };
    }

    // This is a user's own read-only ledger, not the org-wide revenue report, so
    // stats are computed here from the user's own (unpaginated, filtered) payments
    // rather than the admin/staff-only payments/revenue* endpoints.
    async function loadOwnPaymentsForStats() {
        const result = await api.request(`payments/mine?${filterParams().toString()}`, { method: 'GET' }).catch(() => []);
        return Array.isArray(result) ? result : (result && Array.isArray(result.data) ? result.data : []);
    }

    function formatCurrency(amount) {
        return `₱${parseFloat(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function statusBadgeClass(status) {
        if (status === 'Verified') return 'status-success';
        if (status === 'Rejected') return 'status-danger';
        return 'status-warning';
    }

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    function renderTable(payments) {
        if (!payments || payments.length === 0) {
            tbody.innerHTML = `
                <tr>
                    <td colspan="8">
                        <div class="payhist-empty-state">
                            <i class="fas fa-receipt"></i>
                            <strong>No payments found</strong>
                            <span>Adjust the filters to see more of your payment history.</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tbody.innerHTML = payments.map(p => {
            const date = p.payment_date || p.created_at || '—';
            return `
                <tr data-id="${p.payment_id}" data-status="${p.verification_status || 'Pending'}">
                    <td><strong>${p.receipt_number || '—'}</strong></td>
                    <td>${p.transaction_type || '—'}</td>
                    <td>${formatCurrency(p.amount)}</td>
                    <td>${date}</td>
                    <td>${p.payment_method || '—'}</td>
                    <td><span class="status-badge ${statusBadgeClass(p.verification_status || 'Pending')}">${p.verification_status || 'Pending'}</span></td>
                    <td>${p.received_by_name || 'N/A'}</td>
                    <td class="action-buttons">
                        <button class="btn-view" title="View"><i class="fas fa-eye"></i></button>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const id = btn.closest('tr').dataset.id;
                showViewModal(id);
            });
        });

        tbody.querySelectorAll('tr[data-id]').forEach(row => {
            row.style.cursor = 'pointer';
            row.addEventListener('click', (e) => {
                if (e.target.closest('button, a')) return;
                const id = row.dataset.id;
                if (id) showViewModal(id);
            });
        });
    }

    function renderStats(ownPayments) {
        const currentMonth = new Date().toISOString().slice(0, 7);
        let totalPaid = 0;
        let monthTotal = 0;
        ownPayments.forEach(p => {
            const amount = parseFloat(p.amount || 0);
            totalPaid += amount;
            const date = p.payment_date || p.created_at || '';
            if (date.startsWith(currentMonth)) {
                monthTotal += amount;
            }
        });

        statsEl.totalRevenue.innerText = formatCurrency(totalPaid);
        statsEl.monthRevenue.innerText = formatCurrency(monthTotal);
        statsEl.transactionCount.innerText = ownPayments.length;
        // Already sorted newest-first by the backend.
        statsEl.lastPayment.innerText = ownPayments.length > 0
            ? (ownPayments[0].payment_date || ownPayments[0].created_at || '—')
            : '—';
    }

    function renderActiveFilterChips() {
        const chips = [
            { key: 'reference_id', label: 'Reference', value: referenceFilterInput.value.trim(), clear: () => { referenceFilterInput.value = ''; } },
            { key: 'transaction_type', label: 'Type', value: transactionTypeFilterSelect.value, clear: () => { transactionTypeFilterSelect.value = ''; } },
            { key: 'verification_status', label: 'Status', value: statusFilterSelect.value, clear: () => { statusFilterSelect.value = ''; } },
            { key: 'date_from', label: 'From', value: dateFromFilterInput.value, clear: () => { dateFromFilterInput.value = ''; } },
            { key: 'date_to', label: 'To', value: dateToFilterInput.value, clear: () => { dateToFilterInput.value = ''; } },
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
                await refreshAll();
            });
        });
    }

    async function refreshAll() {
        try {
            const [paymentsResult, ownPayments] = await Promise.all([
                loadPayments(),
                loadOwnPaymentsForStats(),
            ]);
            const payments = paymentsResult.data || [];
            const meta = paymentsResult.meta || { page: 1, pages: 1, total: payments.length };
            renderStats(ownPayments);
            renderActiveFilterChips();
            renderTable(payments);
            pagination.render(meta);
        } catch (error) {
            console.error('Refresh failed:', error);
            tbody.innerHTML = '<tr><td colspan="8">Failed to load payments. Please refresh.</td></tr>';
        }
    }

    async function loadReservationDetails(payment) {
        if (!payment || !payment.reference_id) return null;
        const refKind = String(payment.reference_kind || '').toLowerCase();
        const transType = String(payment.transaction_type || '').toLowerCase();

        try {
            if (refKind === 'cremation' || transType.includes('cremation')) {
                const cremation = await api.request(`cremations/${payment.reference_id}`, { method: 'GET' });
                if (cremation && !cremation.error) {
                    return {
                        is_cremation: true,
                        service_type: 'Cremation Service',
                        lot_number: cremation.niche_number ? `Niche #${cremation.niche_number}` : 'Columbarium Unit',
                        section_name: cremation.columbarium_name || 'Sanctuario Columbarium',
                        first_name: cremation.first_name || '',
                        last_name: cremation.last_name || '',
                        provisional_name: cremation.provisional_name || '',
                        schedule_date: cremation.cremation_date || cremation.schedule_date || '—',
                        schedule_time: cremation.cremation_time || cremation.schedule_time || '',
                        status: cremation.status || 'Active'
                    };
                }
            }

            // Default to schedule / lot purchase
            const schedule = await api.request(`schedules/${payment.reference_id}`, { method: 'GET' });
            if (schedule && !schedule.error) {
                return {
                    is_cremation: false,
                    service_type: 'Burial Service',
                    lot_number: schedule.lot_number ? `Lot #${schedule.lot_number}` : 'Designated Plot',
                    section_name: schedule.section_name || 'Garden Section',
                    first_name: schedule.first_name || '',
                    last_name: schedule.last_name || '',
                    provisional_name: schedule.provisional_name || '',
                    schedule_date: schedule.schedule_date || '—',
                    schedule_time: schedule.schedule_time || '',
                    status: schedule.status || 'Active'
                };
            }
        } catch (error) {
            console.warn('Could not load linked reservation details:', error);
        }
        return null;
    }

    async function showViewModal(id) {
        try {
            const payment = await api.request(`payments/${id}`, { method: 'GET' });
            const linkedService = await loadReservationDetails(payment);

            const status = (payment.verification_status || 'Pending').trim();
            const isVerified = status.toLowerCase() === 'verified';
            const isRejected = status.toLowerCase() === 'rejected';

            let statusBadgeHtml = '';
            if (isVerified) {
                statusBadgeHtml = `<span class="payhist-status-pill payhist-status-pill--verified"><i class="fas fa-circle-check"></i> Verified</span>`;
            } else if (isRejected) {
                statusBadgeHtml = `<span class="payhist-status-pill payhist-status-pill--rejected"><i class="fas fa-circle-xmark"></i> Rejected</span>`;
            } else {
                statusBadgeHtml = `<span class="payhist-status-pill payhist-status-pill--pending"><i class="fas fa-clock"></i> Pending Review</span>`;
            }

            const formattedAmount = formatCurrency(payment.amount);
            const paymentDate = payment.payment_date || (payment.created_at ? payment.created_at.split(' ')[0] : '—');
            const receiptNo = payment.receipt_number || `RCPT-2026-${payment.payment_id}`;

            const details = `
                <div class="payhist-voucher-document">
                    <!-- 1. Hero Financial Showcase Banner -->
                    <div class="payhist-hero-banner">
                        <div class="payhist-hero-amount-group">
                            <span class="payhist-hero-label">TOTAL AMOUNT SETTLED</span>
                            <div class="payhist-hero-amount">${formattedAmount}</div>
                            <div class="payhist-hero-meta">
                                <span><i class="fas fa-receipt"></i> ${escapeHtml(receiptNo)}</span>
                                <span class="payhist-hero-dot">•</span>
                                <span><i class="fas fa-calendar-day"></i> ${escapeHtml(paymentDate)}</span>
                            </div>
                        </div>
                        <div class="payhist-hero-status-group">
                            <span class="payhist-hero-status-label">PAYMENT STATUS</span>
                            ${statusBadgeHtml}
                        </div>
                    </div>

                    <!-- 2. Dual-Column Structured Grid -->
                    <div class="payhist-grid-layout">
                        <!-- Card A: Transaction Particulars -->
                        <div class="payhist-card">
                            <div class="payhist-card-header">
                                <span class="payhist-card-icon"><i class="fas fa-wallet"></i></span>
                                <h4 class="payhist-card-title">Transaction Particulars</h4>
                            </div>
                            <div class="payhist-card-body">
                                <div class="payhist-data-row">
                                    <span class="data-label">Payment Method</span>
                                    <strong class="data-value">${escapeHtml(payment.payment_method || 'PayMongo Checkout')}</strong>
                                </div>
                                <div class="payhist-data-row">
                                    <span class="data-label">Transaction Type</span>
                                    <strong class="data-value">${escapeHtml(payment.transaction_type || 'Lot Purchase')}</strong>
                                </div>
                                <div class="payhist-data-row">
                                    <span class="data-label">Service Reference</span>
                                    <strong class="data-value payhist-ref-badge">${escapeHtml(payment.reference_label || (payment.reference_id ? (payment.reference_kind ? payment.reference_kind.toUpperCase() + ' #' + payment.reference_id : 'Ref #' + payment.reference_id) : 'Account Payment'))}</strong>
                                </div>
                                <div class="payhist-data-row">
                                    <span class="data-label">Payer / Handled By</span>
                                    <strong class="data-value">${escapeHtml(payment.received_by_name || 'Citizen User')}</strong>
                                </div>
                                <div class="payhist-data-row">
                                    <span class="data-label">Verification Standing</span>
                                    <strong class="data-value">${payment.verified_by_name ? `Verified by ${escapeHtml(payment.verified_by_name)}` : (isVerified ? 'Official System Verification' : 'Awaiting Administrative Review')}</strong>
                                </div>
                                ${payment.verified_at ? `
                                <div class="payhist-data-row">
                                    <span class="data-label">Verified Timestamp</span>
                                    <strong class="data-value">${escapeHtml(payment.verified_at)}</strong>
                                </div>
                                ` : ''}
                            </div>
                        </div>

                        <!-- Card B: Linked Service / Reservation Allocation -->
                        <div class="payhist-card">
                            <div class="payhist-card-header">
                                <span class="payhist-card-icon"><i class="fas fa-map-location-dot"></i></span>
                                <h4 class="payhist-card-title">Linked Service Allocation</h4>
                            </div>
                            <div class="payhist-card-body">
                                ${linkedService ? `
                                    <div class="payhist-data-row">
                                        <span class="data-label">Service Type</span>
                                        <strong class="data-value">${escapeHtml(linkedService.service_type || 'Burial Service')}</strong>
                                    </div>
                                    <div class="payhist-data-row">
                                        <span class="data-label">Plot / Allocation</span>
                                        <strong class="data-value">${escapeHtml(linkedService.lot_number || 'Plot Location')}</strong>
                                    </div>
                                    <div class="payhist-data-row">
                                        <span class="data-label">Memorial Ground</span>
                                        <strong class="data-value">${escapeHtml(linkedService.section_name || 'Garden Section')}</strong>
                                    </div>
                                    <div class="payhist-data-row">
                                        <span class="data-label">Registered Decedent</span>
                                        <strong class="data-value">${escapeHtml((linkedService.first_name ? linkedService.first_name + ' ' + (linkedService.last_name || '') : linkedService.provisional_name || '—').trim())}</strong>
                                    </div>
                                    <div class="payhist-data-row">
                                        <span class="data-label">Service Schedule</span>
                                        <strong class="data-value">${escapeHtml(linkedService.schedule_date || 'TBD')}${linkedService.schedule_time ? ' · ' + escapeHtml(linkedService.schedule_time) : ''}</strong>
                                    </div>
                                    <div class="payhist-data-row">
                                        <span class="data-label">Booking Standing</span>
                                        <strong class="data-value payhist-badge-confirmed">${escapeHtml(linkedService.status || 'Confirmed')}</strong>
                                    </div>
                                ` : `
                                    <div class="payhist-unlinked-state">
                                        <i class="fas fa-circle-info"></i>
                                        <p>This transaction is credited directly to your citizen account and general services.</p>
                                    </div>
                                `}
                            </div>
                        </div>
                    </div>

                    <!-- 3. Documentation & Audit Notes -->
                    <div class="payhist-card payhist-card--full">
                        <div class="payhist-card-header">
                            <span class="payhist-card-icon"><i class="fas fa-file-check"></i></span>
                            <h4 class="payhist-card-title">Documentation &amp; Official Notes</h4>
                        </div>
                        <div class="payhist-card-body">
                            <div class="payhist-docs-grid">
                                <div class="payhist-proof-item">
                                    <span class="data-label">Proof of Payment Document</span>
                                    ${payment.receipt_url ? `
                                        <a href="${escapeHtml(payment.receipt_url)}" target="_blank" rel="noopener" class="payhist-proof-btn">
                                            <i class="fas fa-paperclip"></i>
                                            <span>View Attached Proof Document</span>
                                            <i class="fas fa-arrow-up-right-from-square"></i>
                                        </a>
                                    ` : `
                                        <div class="payhist-digital-record">
                                            <i class="fas fa-shield-halved"></i>
                                            <span>Digital Transaction Record • Verified via Payment Gateway</span>
                                        </div>
                                    `}
                                </div>
                                <div class="payhist-notes-item">
                                    <span class="data-label">Remarks &amp; Audit Notes</span>
                                    <div class="payhist-notes-box">
                                        ${payment.notes ? escapeHtml(payment.notes) : 'Standard transaction recorded and filed under citizen portal account.'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- 4. Official Voucher Seal Banner -->
                    <div class="payhist-seal-strip">
                        <div class="payhist-seal-left">
                            <i class="fas fa-tree"></i>
                            <span>OFFICIAL FINANCIAL VOUCHER • CEMETERY MANAGEMENT SYSTEM</span>
                        </div>
                        <div class="payhist-seal-right">
                            <span>Voucher ID: #VCH-${escapeHtml(payment.payment_id)}</span>
                        </div>
                    </div>
                </div>
            `;

            document.getElementById('viewDetails').innerHTML = details;
            document.getElementById('viewModal').style.display = 'flex';
        } catch (error) {
            console.error('Failed to load payment details:', error);
            alert('Failed to load payment: ' + error.message);
        }
    }

    // Modal Dismiss & Print Event Listeners
    const closeModal = () => {
        const modal = document.getElementById('viewModal');
        if (modal) modal.style.display = 'none';
    };

    document.getElementById('closeViewModalTop')?.addEventListener('click', closeModal);
    document.getElementById('closeViewModalBottom')?.addEventListener('click', closeModal);
    document.querySelector('#viewModal .close-view')?.addEventListener('click', closeModal);

    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('viewModal')) closeModal();
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && document.getElementById('viewModal')?.style.display === 'flex') {
            closeModal();
        }
    });

    document.getElementById('printPaymentReceiptBtn')?.addEventListener('click', () => {
        window.print();
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
        await refreshAll();
    }, 300);

    referenceFilterInput.addEventListener('input', refreshFiltered);
    transactionTypeFilterSelect.addEventListener('change', refreshFiltered);
    statusFilterSelect.addEventListener('change', refreshFiltered);
    dateFromFilterInput.addEventListener('change', refreshFiltered);
    dateToFilterInput.addEventListener('change', refreshFiltered);
    clearFiltersBtn.addEventListener('click', async () => {
        referenceFilterInput.value = '';
        transactionTypeFilterSelect.value = '';
        statusFilterSelect.value = '';
        dateFromFilterInput.value = '';
        dateToFilterInput.value = '';
        pagination.reset();
        await refreshAll();
    });

    // Interactive Stat Cards
    const statCards = document.querySelectorAll('#paymentStatsRow .stat-card');
    statCards.forEach(card => {
        function activate() {
            statCards.forEach(c => c.classList.remove('active-filter'));
            card.classList.add('active-filter');
            const filterType = card.getAttribute('data-filter');
            if (filterType === 'month') {
                const now = new Date();
                const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0];
                const lastDay = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().split('T')[0];
                if (dateFromFilterInput) dateFromFilterInput.value = firstDay;
                if (dateToFilterInput) dateToFilterInput.value = lastDay;
            } else {
                if (dateFromFilterInput) dateFromFilterInput.value = '';
                if (dateToFilterInput) dateToFilterInput.value = '';
                if (statusFilterSelect) statusFilterSelect.value = '';
                if (transactionTypeFilterSelect) transactionTypeFilterSelect.value = '';
            }
            pagination.reset();
            refreshAll();
        }

        card.addEventListener('click', activate);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                activate();
            }
        });
    });

    function setupFooterClock() {
        const timeEl = document.getElementById('footerLiveTime');
        const yearEl = document.getElementById('footerYear');
        if (yearEl) yearEl.textContent = new Date().getFullYear();
        if (!timeEl) return;
        function tick() {
            const now = new Date();
            const opts = { month: 'short', day: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true };
            timeEl.textContent = now.toLocaleString('en-US', opts);
        }
        tick();
        setInterval(tick, 1000);
    }

    setupFooterClock();

    await refreshAll();

    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});

