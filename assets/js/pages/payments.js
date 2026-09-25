document.addEventListener('DOMContentLoaded', async function() {
    const currentUser = await requireRole(['admin', 'staff', 'user']);
    if (!currentUser) return;

    // System-Wide AI Assistant: page-level, always visible in the header —
    // admin/staff only (this page is also reachable by citizens viewing
    // their own payments, same guard the per-record assistant below uses).
    // The per-payment one below (mounted fresh in the view modal) is a
    // separate instance for "explain this specific payment".
    if (currentUser.role === 'admin' || currentUser.role === 'staff') {
        initAiAssistant({
            mountSelector: '#aiAssistantMount',
            context: { scope: 'module', module: 'Payment' },
            greeting: "Hello! I'm your AI assistant for Payments. How can I help you today?",
            suggestions: [
                { icon: 'fa-money-bill-wave', label: 'Pending verification', question: 'How many payments are pending verification right now?' },
                { icon: 'fa-triangle-exclamation', label: 'Any exceptions?', question: 'Are there any open exceptions related to payments?' },
                { icon: 'fa-chart-line', label: 'Recent revenue', question: 'What has recent payment activity looked like?' },
                { icon: 'fa-circle-question', label: 'How does auto-confirm work?', question: 'How does payment-triggered auto-confirmation work?' },
            ],
        });
    }

    const tbody = document.getElementById('paymentsTableBody');
    const statsEl = {
        totalRevenue: document.getElementById('totalRevenue'),
        monthRevenue: document.getElementById('monthRevenue'),
        transactionCount: document.getElementById('transactionCount'),
        lastPayment: document.getElementById('lastPayment')
    };
    const statParts = {
        totalRevenueTitle: statsEl.totalRevenue?.closest('.stat-card')?.querySelector('.stat-title-label') || statsEl.totalRevenue?.closest('.stat-card')?.querySelector('.stat-title span:first-child'),
        totalRevenueSub: statsEl.totalRevenue?.closest('.stat-card')?.querySelector('.stat-sub'),
        monthRevenueTitle: statsEl.monthRevenue?.closest('.stat-card')?.querySelector('.stat-title-label') || statsEl.monthRevenue?.closest('.stat-card')?.querySelector('.stat-title span:first-child'),
        monthRevenueSub: statsEl.monthRevenue?.closest('.stat-card')?.querySelector('.stat-sub'),
        transactionCountTitle: statsEl.transactionCount?.closest('.stat-card')?.querySelector('.stat-title-label') || statsEl.transactionCount?.closest('.stat-card')?.querySelector('.stat-title span:first-child'),
        transactionCountSub: statsEl.transactionCount?.closest('.stat-card')?.querySelector('.stat-sub'),
        verifiedPaymentTitle: statsEl.lastPayment?.closest('.stat-card')?.querySelector('.stat-title-label') || statsEl.lastPayment?.closest('.stat-card')?.querySelector('.stat-title span:first-child'),
        verifiedPaymentSub: statsEl.lastPayment?.closest('.stat-card')?.querySelector('.stat-sub'),
    };

    const referenceFilterInput = document.getElementById('referenceFilter');
    const transactionTypeFilterSelect = document.getElementById('transactionTypeFilter');
    const statusFilterSelect = document.getElementById('statusFilter');
    const dateFromFilterInput = document.getElementById('dateFromFilter');
    const dateToFilterInput = document.getElementById('dateToFilter');
    const clearFiltersBtn = document.getElementById('clearFilters');
    const activeFilterChips = document.getElementById('activeFilterChips');
    const verifyAllPaymentsBtn = document.getElementById('verifyAllPaymentsBtn');
    const rejectAllPaymentsBtn = document.getElementById('rejectAllPaymentsBtn');
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

    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.innerText = result.count || 0;
                badge.style.display = result.count > 0 ? 'flex' : 'none';
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

    async function loadPayments() {
        // Backend permits admin+staff on the full list; only 'user' is limited to their own.
        const endpoint = currentUser.role === 'user' ? 'payments/mine' : 'payments';
        const params = new URLSearchParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        const filters = currentFilters();
        Object.keys(filters).forEach((key) => {
            if (filters[key]) params.set(key, filters[key]);
        });
        const result = await api.request(`${endpoint}?${params.toString()}`, { method: 'GET' });
        return result && Array.isArray(result.data) ? result : { data: [], meta: { page: 1, pages: 1, total: 0 } };
    }

    async function loadRevenue() {
        // Org-wide revenue is admin/staff-only server-side; a 'user' role viewing
        // this page (payments.html is shared across roles) gets a 403 here, which
        // would otherwise fail the whole Promise.all in refreshAll().
        return await api.request('payments/revenue', { method: 'GET' }).catch(() => ({ total: 0 }));
    }

    async function loadMonthRevenue() {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
        return await api.request(`payments/revenue?date_from=${monthStart}&date_to=${monthEnd}`, { method: 'GET' }).catch(() => ({ total: 0 }));
    }

    async function verifyPayment(id, status) {
        return await api.request(`payments/${id}/verify`, {
            method: 'PUT',
            body: { verification_status: status }
        });
    }

    async function verifyAllPending(status) {
        const endpoint = status === 'Verified'
            ? 'payments/pending/verify-all'
            : 'payments/pending/reject-all';
        return await api.request(endpoint, { method: 'POST' });
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
            const isFiltered = Boolean(
                (referenceFilterInput && referenceFilterInput.value.trim()) ||
                (transactionTypeFilterSelect && transactionTypeFilterSelect.value) ||
                (statusFilterSelect && statusFilterSelect.value) ||
                (dateFromFilterInput && dateFromFilterInput.value) ||
                (dateToFilterInput && dateToFilterInput.value)
            );
            tbody.innerHTML = `
                <tr>
                    <td colspan="8">
                        <div class="payments-empty-state reloc-empty-state">
                            <div class="empty-icon-wrap">
                                <i class="fas fa-receipt"></i>
                            </div>
                            <strong>${isFiltered ? 'No matching payment records found' : 'No payment records found'}</strong>
                            <span>${isFiltered ? 'Try clearing or modifying your filter criteria.' : 'Recorded financial transactions will appear here.'}</span>
                            ${isFiltered ? `
                                <button type="button" class="btn-secondary btn-clear-filters" id="emptyClearFiltersBtn">
                                    <i class="fas fa-filter-circle-xmark"></i> Clear Filters
                                </button>
                            ` : ''}
                        </div>
                    </td>
                </tr>
            `;
            const clearBtn = document.getElementById('emptyClearFiltersBtn');
            if (clearBtn) {
                clearBtn.addEventListener('click', async () => {
                    if (referenceFilterInput) referenceFilterInput.value = '';
                    if (transactionTypeFilterSelect) transactionTypeFilterSelect.value = '';
                    if (statusFilterSelect) statusFilterSelect.value = '';
                    if (dateFromFilterInput) dateFromFilterInput.value = '';
                    if (dateToFilterInput) dateToFilterInput.value = '';
                    syncSubTabsActiveState();
                    renderActiveFilterChips();
                    pagination.reset();
                    await refreshAll();
                });
            }
            return;
        }

        tbody.innerHTML = payments.map(p => {
            const rawDateStr = p.payment_date || p.created_at || '';
            let formattedDate = '—';
            let formattedTime = '';
            if (rawDateStr) {
                try {
                    const d = new Date(rawDateStr.replace(' ', 'T'));
                    if (!isNaN(d.getTime())) {
                        formattedDate = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                        formattedTime = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
                    } else {
                        formattedDate = rawDateStr;
                    }
                } catch (_) {
                    formattedDate = rawDateStr;
                }
            }

            const receiptNum = p.receipt_number || `REC-${p.payment_id}`;

            // Transaction Type icon and context
            const tType = (p.transaction_type || '').toLowerCase();
            let typeIcon = 'fa-file-invoice-dollar';
            if (tType.includes('burial')) typeIcon = 'fa-monument';
            else if (tType.includes('cremation')) typeIcon = 'fa-fire';
            else if (tType.includes('maintenance') || tType.includes('renewal')) typeIcon = 'fa-rotate';
            else if (tType.includes('lot')) typeIcon = 'fa-vector-square';
            else if (tType.includes('relocation') || tType.includes('exhumation')) typeIcon = 'fa-truck-moving';

            const refSubtext = p.reference_id 
                ? `${escapeHtml(p.reference_kind ? p.reference_kind.charAt(0).toUpperCase() + p.reference_kind.slice(1) : 'Ref')} #${escapeHtml(String(p.reference_id))}` 
                : 'Direct Payment';

            // Payment Method icon and class
            const method = (p.payment_method || '').toLowerCase();
            let methodIcon = 'fa-wallet';
            let methodClass = 'method-default';
            if (method.includes('cash')) {
                methodIcon = 'fa-money-bill-wave';
                methodClass = 'method-cash';
            } else if (method.includes('gcash')) {
                methodIcon = 'fa-mobile-screen-button';
                methodClass = 'method-gcash';
            } else if (method.includes('paymongo')) {
                methodIcon = 'fa-credit-card';
                methodClass = 'method-paymongo';
            } else if (method.includes('bank') || method.includes('check')) {
                methodIcon = 'fa-building-columns';
                methodClass = 'method-bank';
            }

            // Triage aid badges
            const isPending = (p.verification_status || 'Pending') === 'Pending';
            const isHighConfidence = Number(p.is_high_confidence) === 1 && isPending;
            const highConfidenceBadge = isHighConfidence
                ? ' <span class="status-badge status-info" title="Amount matches the lot price and a receipt was uploaded — not verified, just worth checking first"><i class="fas fa-circle-check"></i> Likely valid</span>'
                : '';

            let isAgingOverdue = false;
            if (isPending && rawDateStr) {
                const timestamp = new Date(rawDateStr.replace(' ', 'T')).getTime();
                if (timestamp && (Date.now() - timestamp) > 48 * 60 * 60 * 1000) {
                    isAgingOverdue = true;
                }
            }
            const agingBadge = isAgingOverdue
                ? ' <span class="aging-badge aging-warning" title="Pending review for over 48 hours — requires staff attention"><i class="fas fa-hourglass-half"></i> &gt;48h</span>'
                : '';

            const status = p.verification_status || 'Pending';
            const statusLower = status.toLowerCase();

            let paymentBadgeHtml = '';
            if (statusLower === 'verified') {
                paymentBadgeHtml = `<span class="payment-badge payment-badge--verified"><i class="fas fa-circle-check"></i> Verified</span>`;
            } else if (statusLower === 'pending') {
                paymentBadgeHtml = `<span class="payment-badge payment-badge--pending"><i class="fas fa-clock"></i> Pending</span>`;
            } else {
                paymentBadgeHtml = `<span class="payment-badge payment-badge--unpaid"><i class="fas fa-circle-xmark"></i> ${escapeHtml(status)}</span>`;
            }

            return `
                <tr data-id="${p.payment_id}" data-status="${escapeHtml(status)}">
                    <td class="col-ref col-receipt">
                        <span class="ref-pill" title="Receipt #${escapeHtml(receiptNum)}">
                            #${escapeHtml(receiptNum)}
                        </span>
                    </td>
                    <td class="col-type">
                        <div class="transaction-cell">
                            <span class="transaction-name" title="${escapeHtml(p.transaction_type || 'Payment')}">
                                <i class="fas ${typeIcon}"></i> ${escapeHtml(p.transaction_type || 'Payment')}
                            </span>
                            <span class="transaction-meta" title="${refSubtext}">
                                <i class="fas fa-link"></i> ${refSubtext}
                            </span>
                        </div>
                    </td>
                    <td class="col-amount">
                        <div class="amount-cell">
                            <span class="amount-val">${formatCurrency(p.amount)}</span>
                        </div>
                    </td>
                    <td class="col-date">
                        <div class="table-datetime-cell">
                            <span class="cell-date">${escapeHtml(formattedDate)}</span>
                            ${formattedTime ? `<span class="cell-time"><i class="far fa-clock"></i> ${escapeHtml(formattedTime)}</span>` : ''}
                        </div>
                    </td>
                    <td class="col-method">
                        <span class="payment-method-chip ${methodClass}">
                            <i class="fas ${methodIcon}"></i>
                            <span>${escapeHtml(p.payment_method || '—')}</span>
                        </span>
                    </td>
                    <td class="col-status col-payment">
                        <div class="status-cell-wrap">
                            ${paymentBadgeHtml}
                            ${agingBadge}
                            ${highConfidenceBadge}
                        </div>
                    </td>
                    <td class="col-receiver col-requester">
                        <div class="requester-cell table-requester-cell">
                            <span class="requester-name" title="${escapeHtml(p.received_by_name || 'Staff / System')}">
                                <i class="fas fa-user-circle"></i> ${escapeHtml(p.received_by_name || 'Staff / System')}
                            </span>
                            <span class="requester-date">
                                ${p.verified_by_name ? `<i class="fas fa-shield-halved" title="Verified by ${escapeHtml(p.verified_by_name)}"></i> Verified` : `<i class="fas fa-user-tag"></i> Recorded`}
                            </span>
                        </div>
                    </td>
                    <td class="col-actions">
                        <div class="action-buttons">
                            <button type="button" class="btn-row-action btn-action-icon btn-row-action--view btn-view" data-id="${p.payment_id}" title="View Details" aria-label="View Details">
                                <i class="fas fa-eye"></i>
                            </button>
                            ${currentUser && currentUser.role === 'admin' && status !== 'Verified' ? `
                                <button type="button" class="btn-row-action btn-action-icon btn-row-action--cancel btn-delete-row" data-id="${p.payment_id}" title="Delete Record" aria-label="Delete Record">
                                    <i class="fas fa-trash"></i>
                                </button>
                            ` : ''}
                        </div>
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

        tbody.querySelectorAll('.btn-delete-row').forEach(btn => {
            btn.addEventListener('click', async (e) => {
                e.stopPropagation();
                const id = btn.closest('tr').dataset.id;
                if (!confirm('Delete this payment record?')) {
                    return;
                }
                try {
                    await api.request(`payments/${id}`, { method: 'DELETE' });
                    await refreshAll();
                } catch (error) {
                    alert('Failed to delete: ' + error.message);
                }
            });
        });
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

    async function loadStatsCounts() {
        if (currentUser.role === 'user') return { pending: 0, verified: 0 };
        try {
            const [pendingRes, verifiedRes] = await Promise.all([
                api.request('payments?verification_status=Pending&per_page=1', { method: 'GET' }).catch(() => null),
                api.request('payments?verification_status=Verified&per_page=1', { method: 'GET' }).catch(() => null)
            ]);
            return {
                pending: pendingRes?.meta?.total ?? 0,
                verified: verifiedRes?.meta?.total ?? 0
            };
        } catch (e) {
            return { pending: 0, verified: 0 };
        }
    }

    function syncSubTabsActiveState() {
        const status = statusFilterSelect.value;
        document.querySelectorAll('.records-tab-btn').forEach(btn => {
            const tabStatus = btn.dataset.tab;
            const isActive = tabStatus === status;
            btn.classList.toggle('active', isActive);
            btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        });
    }

    function syncStatCardActiveState() {
        syncSubTabsActiveState();
        const status = statusFilterSelect.value;
        const dateFrom = dateFromFilterInput.value;
        const dateTo = dateToFilterInput.value;
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const monthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);

        const allCards = document.querySelectorAll('.stat-card-filterable');
        allCards.forEach(card => {
            card.classList.remove('active', 'is-active-filter');
            card.setAttribute('aria-pressed', 'false');
        });

        let activeCard = null;
        if (status === 'Pending') {
            activeCard = document.getElementById('cardPendingPayments');
        } else if (status === 'Verified') {
            activeCard = document.getElementById('cardVerifiedPayments');
        } else if (dateFrom === monthStart && dateTo === monthEnd && !status) {
            activeCard = document.getElementById('cardMonthRevenue');
        } else if (!status && !dateFrom && !dateTo && !referenceFilterInput.value && !transactionTypeFilterSelect.value) {
            activeCard = document.getElementById('cardTotalRevenue');
        }

        if (activeCard) {
            activeCard.classList.add('active', 'is-active-filter');
            activeCard.setAttribute('aria-pressed', 'true');
        }
    }

    function renderStats(revenue, monthRevenue, payments, meta, counts = { pending: 0, verified: 0 }) {
        const visiblePending = payments.filter((payment) => (payment.verification_status || 'Pending') === 'Pending').length;
        const visibleVerified = payments.filter((payment) => payment.verification_status === 'Verified').length;

        // Sync Sub-Tabs Badge Counts
        const pendingBadge = document.getElementById('pendingTabBadge');
        const verifiedBadge = document.getElementById('verifiedTabBadge');
        const pVal = currentUser.role === 'user' ? visiblePending : (counts.pending || 0);
        const vVal = currentUser.role === 'user' ? visibleVerified : (counts.verified || 0);
        if (pendingBadge) {
            pendingBadge.textContent = pVal;
            pendingBadge.style.display = pVal > 0 ? 'inline-flex' : 'none';
        }
        if (verifiedBadge) {
            verifiedBadge.textContent = vVal;
            verifiedBadge.style.display = vVal > 0 ? 'inline-flex' : 'none';
        }

        if (currentUser.role === 'user') {
            if (statParts.totalRevenueTitle) statParts.totalRevenueTitle.textContent = 'My Payments';
            if (statParts.monthRevenueTitle) statParts.monthRevenueTitle.textContent = 'Pending';
            if (statParts.transactionCountTitle) statParts.transactionCountTitle.textContent = 'Verified';
            if (statParts.verifiedPaymentTitle) statParts.verifiedPaymentTitle.textContent = 'Last Payment';
            if (statParts.totalRevenueSub) statParts.totalRevenueSub.textContent = 'Matching filters';
            if (statParts.monthRevenueSub) statParts.monthRevenueSub.textContent = 'Visible page';
            if (statParts.transactionCountSub) statParts.transactionCountSub.textContent = 'Visible page';
            if (statParts.verifiedPaymentSub) statParts.verifiedPaymentSub.textContent = 'Latest record';
            statsEl.totalRevenue.innerText = meta.total || 0;
            statsEl.monthRevenue.innerText = visiblePending;
            statsEl.transactionCount.innerText = visibleVerified;
        } else {
            if (statParts.totalRevenueTitle) statParts.totalRevenueTitle.textContent = 'Total Revenue';
            if (statParts.monthRevenueTitle) statParts.monthRevenueTitle.textContent = 'This Month';
            if (statParts.transactionCountTitle) statParts.transactionCountTitle.textContent = 'Pending Review';
            if (statParts.verifiedPaymentTitle) statParts.verifiedPaymentTitle.textContent = 'Verified Total';
            if (statParts.totalRevenueSub) statParts.totalRevenueSub.textContent = 'All time collected';
            if (statParts.monthRevenueSub) statParts.monthRevenueSub.textContent = 'Current month revenue';
            if (statParts.transactionCountSub) statParts.transactionCountSub.textContent = 'Awaiting verification';
            if (statParts.verifiedPaymentSub) statParts.verifiedPaymentSub.textContent = 'Approved transactions';
            statsEl.totalRevenue.innerText = formatCurrency(revenue.total || 0);
            statsEl.monthRevenue.innerText = formatCurrency(monthRevenue.total || 0);
            statsEl.transactionCount.innerText = counts.pending;
            statsEl.lastPayment.innerText = counts.verified;
        }
    }

    async function refreshAll() {
        try {
            const [paymentsResult, revenue, monthRevenue, counts] = await Promise.all([
                loadPayments(),
                loadRevenue(),
                loadMonthRevenue(),
                loadStatsCounts(),
            ]);
            const payments = paymentsResult.data || [];
            const meta = paymentsResult.meta || { page: 1, pages: 1, total: payments.length };
            renderStats(revenue, monthRevenue, payments, meta, counts);
            renderActiveFilterChips();
            syncStatCardActiveState();
            renderTable(payments);
            pagination.render(meta);
        } catch (error) {
            console.error('Refresh failed:', error);
            tbody.innerHTML = '<tr><td colspan="8">Failed to load payments. Please refresh.</td></tr>';
        }
    }

    async function loadReservationDetails(payment) {
        if (!payment || !payment.reference_id) return null;
        const tType = (payment.transaction_type || '').toLowerCase();
        try {
            if (tType.includes('cremat')) {
                const cremation = await api.request(`cremations/${payment.reference_id}`, { method: 'GET' });
                return cremation && !cremation.error ? cremation : null;
            }
            const schedule = await api.request(`schedules/${payment.reference_id}`, { method: 'GET' });
            return schedule && !schedule.error ? schedule : null;
        } catch (error) {
            return null;
        }
    }

    function renderReservationSection(schedule) {
        if (!schedule) return '';
        return `
            <div class="detail-section-title">Reservation Details</div>
            <div class="detail-row"><span>Lot Number</span><strong>${schedule.lot_number || '—'}</strong></div>
            <div class="detail-row"><span>Section</span><strong>${schedule.section_name || '—'}</strong></div>
            <div class="detail-row"><span>Decedent</span><strong>${schedule.first_name ? `${schedule.first_name} ${schedule.last_name || ''}`.trim() : '—'}</strong></div>
            <div class="detail-row"><span>Burial Date</span><strong>${schedule.schedule_date || '—'}${schedule.schedule_time ? ' · ' + schedule.schedule_time : ''}</strong></div>
            <div class="detail-row"><span>Reservation Status</span><strong>${schedule.status || '—'}</strong></div>
            <div class="detail-section-title">Payment Details</div>
        `;
    }

    async function showViewModal(id) {
        try {
            const payment = await api.request(`payments/${id}`, { method: 'GET' });
            const schedule = await loadReservationDetails(payment);
            const isPayMongo = (payment.payment_method && payment.payment_method.toLowerCase() === 'paymongo') ||
                               (payment.gateway_provider && payment.gateway_provider.toLowerCase() === 'paymongo');
            const isVerified = (payment.verification_status || 'Pending') === 'Verified';
            const isRejected = (payment.verification_status || 'Pending') === 'Rejected';
            const statusLabel = payment.verification_status || 'Pending';

            const headerBadge = document.getElementById('viewHeaderStatusBadge');
            if (headerBadge) {
                headerBadge.className = `status-pill ${statusBadgeClass(statusLabel)}`;
                headerBadge.innerHTML = `<span class="dot"></span>${escapeHtml(statusLabel)}`;
            }

            const details = `
                <!-- LEFT PANE: Official Printable Voucher Sheet -->
                <div class="deck-pane deck-pane--left">
                    <div class="official-receipt-sheet" id="printableReceipt">
                        <!-- Receipt Header -->
                        <div class="receipt-header">
                            <div class="receipt-brand">
                                <div class="receipt-logo"><i class="fas fa-tree"></i></div>
                                <div>
                                    <h4>Cemetery Management System</h4>
                                    <p>Finance Department · Official Payment Voucher</p>
                                </div>
                            </div>
                            <div class="receipt-meta-box">
                                <span class="receipt-no-label">RECEIPT #</span>
                                <span class="receipt-no-value">${escapeHtml(payment.receipt_number || 'RCPT-PENDING')}</span>
                                <span class="receipt-date-label">Date: ${escapeHtml(payment.payment_date || payment.created_at || '—')}</span>
                            </div>
                        </div>

                        <!-- Status Stamp -->
                        <div class="receipt-status-banner ${statusBadgeClass(statusLabel)}">
                            <div class="receipt-status-left">
                                <i class="fas ${isVerified ? 'fa-circle-check' : (isRejected ? 'fa-ban' : 'fa-clock')}"></i>
                                <span>STATUS: <strong>${escapeHtml(statusLabel.toUpperCase())}</strong></span>
                            </div>
                            <div class="receipt-status-right">
                                <span>Transaction ID: #${escapeHtml(payment.payment_id)}</span>
                            </div>
                        </div>

                        <!-- Key Details Grid -->
                        <div class="receipt-grid">
                            <div class="receipt-grid-col">
                                <div class="receipt-field">
                                    <span class="field-title">Transaction Type</span>
                                    <span class="field-data transaction-type-pill">${escapeHtml(payment.transaction_type || '—')}</span>
                                </div>
                                <div class="receipt-field">
                                    <span class="field-title">Payment Method</span>
                                    <span class="field-data">${escapeHtml(payment.payment_method || '—')}</span>
                                </div>
                                <div class="receipt-field">
                                    <span class="field-title">Received / Handled By</span>
                                    <span class="field-data">${escapeHtml(payment.received_by_name || 'Staff / System')}</span>
                                </div>
                            </div>
                            <div class="receipt-grid-col">
                                <div class="receipt-field">
                                    <span class="field-title">Service Reference</span>
                                    <span class="field-data highlight-ref">${escapeHtml(payment.reference_label || (payment.reference_id ? 'Ref #' + payment.reference_id : 'Direct Payment'))}</span>
                                </div>
                                <div class="receipt-field">
                                    <span class="field-title">Verification Info</span>
                                    <span class="field-data">${payment.verified_by_name ? escapeHtml(payment.verified_by_name) + ' (' + escapeHtml(payment.verified_at || '') + ')' : 'Awaiting admin review'}</span>
                                </div>
                                <div class="receipt-field">
                                    <span class="field-title">Proof of Payment</span>
                                    <span class="field-data">${payment.receipt_url ? `<a href="${escapeHtml(payment.receipt_url)}" target="_blank" class="receipt-download-link"><i class="fas fa-arrow-up-right-from-square"></i> View Uploaded Proof</a>` : '<span class="text-muted">None attached</span>'}</span>
                                </div>
                            </div>
                        </div>

                        ${schedule ? `
                        <!-- Linked Reservation Details -->
                        <div class="receipt-linked-section">
                            <div class="linked-section-title"><i class="fas fa-calendar-check"></i> Linked Service Particulars</div>
                            <div class="linked-details-grid">
                                <div><span>${schedule.niche_number ? 'Niche #:' : 'Lot #:'}</span> <strong>${escapeHtml(schedule.niche_number || schedule.lot_number || 'N/A')}</strong></div>
                                <div><span>Section:</span> <strong>${escapeHtml(schedule.section_name || 'N/A')}</strong></div>
                                <div><span>Decedent:</span> <strong>${escapeHtml((schedule.first_name ? schedule.first_name + ' ' + (schedule.last_name || '') : (schedule.deceased_name || 'N/A')).trim())}</strong></div>
                                <div><span>Date:</span> <strong>${escapeHtml(schedule.schedule_date || schedule.cremation_date || 'N/A')}</strong></div>
                            </div>
                        </div>
                        ` : ''}

                        <!-- Financial Summary Box -->
                        <div class="receipt-amount-card">
                            <div class="amount-card-left">
                                <span>TOTAL AMOUNT RECEIVED</span>
                                <small>Philippine Peso (PHP · ₱)</small>
                            </div>
                            <div class="amount-card-right">
                                ${formatCurrency(payment.amount)}
                            </div>
                        </div>

                        ${payment.notes ? `
                        <div class="receipt-notes-box">
                            <strong>Notes & Remarks:</strong>
                            <span>${escapeHtml(payment.notes)}</span>
                        </div>
                        ` : ''}

                        <!-- Receipt Footer & Stamp Placeholder -->
                        <div class="receipt-footer">
                            <div class="receipt-signature-area">
                                <div class="signature-line"></div>
                                <span class="signature-label">Authorized Signature / Cashier</span>
                            </div>
                            <div class="receipt-stamp-area">
                                <div class="security-seal">
                                    <i class="fas fa-shield-halved"></i>
                                    <span>SYSTEM VERIFIED</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- RIGHT PANE: Parameters, Linked Reservation, Proof & AI Assistant -->
                <div class="deck-pane deck-pane--right no-print">
                    <!-- Settlement Breakdown Card -->
                    <details class="view-collapsible-section" open>
                        <summary class="view-section-summary">
                            <span class="view-section-title"><i class="fas fa-receipt"></i> Settlement Breakdown</span>
                        </summary>
                        <div class="view-section-content">
                            <div class="receipt-grid" style="display: flex; flex-direction: column; gap: 8px;">
                                <div class="receipt-field">
                                    <span class="field-title">Transaction Type</span>
                                    <span class="field-data transaction-type-pill">${escapeHtml(payment.transaction_type || '—')}</span>
                                </div>
                                <div class="receipt-field">
                                    <span class="field-title">Payment Method</span>
                                    <span class="field-data">${escapeHtml(payment.payment_method || '—')}</span>
                                </div>
                                <div class="receipt-field">
                                    <span class="field-title">Received / Handled By</span>
                                    <span class="field-data">${escapeHtml(payment.received_by_name || 'Staff / System')}</span>
                                </div>
                                <div class="receipt-field">
                                    <span class="field-title">Service Reference</span>
                                    <span class="field-data highlight-ref">${escapeHtml(payment.reference_label || (payment.reference_id ? 'Ref #' + payment.reference_id : 'Direct Payment'))}</span>
                                </div>
                                <div class="receipt-field">
                                    <span class="field-title">Verification Info</span>
                                    <span class="field-data">${payment.verified_by_name ? escapeHtml(payment.verified_by_name) + ' (' + escapeHtml(payment.verified_at || '') + ')' : 'Awaiting admin review'}</span>
                                </div>
                            </div>
                        </div>
                    </details>

                    ${schedule ? `
                    <!-- Linked Service Particulars -->
                    <details class="view-collapsible-section" open style="margin-top: 10px;">
                        <summary class="view-section-summary">
                            <span class="view-section-title"><i class="fas fa-calendar-check"></i> Linked Service</span>
                        </summary>
                        <div class="view-section-content">
                            <div class="linked-details-grid">
                                <div><span>${schedule.niche_number ? 'Niche #:' : 'Lot #:'}</span> <strong>${escapeHtml(schedule.niche_number || schedule.lot_number || 'N/A')}</strong></div>
                                <div><span>Section:</span> <strong>${escapeHtml(schedule.section_name || 'N/A')}</strong></div>
                                <div><span>Decedent:</span> <strong>${escapeHtml((schedule.first_name ? schedule.first_name + ' ' + (schedule.last_name || '') : (schedule.deceased_name || 'N/A')).trim())}</strong></div>
                                <div><span>Date:</span> <strong>${escapeHtml(schedule.schedule_date || schedule.cremation_date || 'N/A')}</strong></div>
                            </div>
                        </div>
                    </details>
                    ` : ''}

                    <!-- Proof of Payment Attachment -->
                    <details class="view-collapsible-section" open style="margin-top: 10px;">
                        <summary class="view-section-summary">
                            <span class="view-section-title"><i class="fas fa-paperclip"></i> Proof of Payment</span>
                        </summary>
                        <div class="view-section-content">
                            ${payment.receipt_url ? `
                                <div class="document-entry" style="margin: 0;">
                                    <div class="doc-file-indicator doc-icon--image"><i class="fas fa-file-image"></i></div>
                                    <div class="document-entry-info">
                                        <span class="status-badge status-info doc-type-pill">Uploaded Proof</span>
                                        <a href="${escapeHtml(payment.receipt_url)}" target="_blank" rel="noopener" class="receipt-download-link" style="display: inline-flex; align-items: center; gap: 6px; font-weight: 700; color: #166534; text-decoration: none; margin-top: 4px;">
                                            <span>View Uploaded Proof</span>
                                            <i class="fas fa-arrow-up-right-from-square"></i>
                                        </a>
                                    </div>
                                </div>
                            ` : '<p class="activity-empty" style="padding: 10px 0; margin: 0; color: #64748b; font-size: 0.82rem;"><i class="fas fa-circle-info"></i> No proof attached for this transaction.</p>'}
                        </div>
                    </details>

                    ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff') ? `
                        <div class="no-print" style="margin-top: 12px;"><div id="aiAssistantMountRecord"></div></div>
                    ` : ''}
                </div>
            `;
            document.getElementById('viewDetails').innerHTML = details;

            const footerActions = document.getElementById('viewModalFooterActions');
            if (footerActions) {
                const isPending = payment.verification_status === 'Pending';
                const isAdmin = currentUser && currentUser.role === 'admin';
                let verificationHtml = '';
                if (isAdmin && isPending) {
                    verificationHtml = !isPayMongo
                        ? `<button type="button" id="verifyPaymentBtn" class="btn-approve"><i class="fas fa-check"></i> Verify Payment</button>`
                        : `<button type="button" class="btn-approve btn-approve--disabled" disabled title="PayMongo payments cannot be manually verified (automated via webhook)"><i class="fas fa-lock"></i> Gateway Managed</button>`;
                    verificationHtml += `<button type="button" id="rejectPaymentBtn" class="btn-deny"><i class="fas fa-xmark"></i> Reject</button>`;
                }

                footerActions.innerHTML = verificationHtml;
            }

            document.getElementById('printReceiptBtn')?.addEventListener('click', () => {
                window.print();
            });

            document.getElementById('viewModal').style.display = 'flex';

            // System-Wide AI Assistant (Phase 4): mounts with this record's
            // context pre-wired, but no longer auto-asks on open (quota-
            // reduction batch — viewing a payment must never cost an LLM
            // call by itself). The admin can still open the panel and ask a
            // question, and the assistant answers using this same
            // entity-scoped context.
            const aiMount = document.getElementById('aiAssistantMountRecord');
            if (aiMount) {
                initAiAssistant({
                    mountSelector: '#aiAssistantMountRecord',
                    context: { scope: 'entity', entity_type: 'Payment', entity_id: id },
                    label: 'Ask AI',
                });
            }

            const verifyBtn = document.getElementById('verifyPaymentBtn');
            const rejectBtn = document.getElementById('rejectPaymentBtn');
            if (verifyBtn) {
                verifyBtn.addEventListener('click', async () => {
                    if (!confirm('Verify this payment?')) return;
                    await withButtonLoading(verifyBtn, async () => {
                        try {
                            const result = await verifyPayment(id, 'Verified');
                            if (result.success) {
                                alert('Payment verified successfully.');
                                document.getElementById('viewModal').style.display = 'none';
                                await refreshAll();
                            } else {
                                alert(result.error || 'Failed to verify payment.');
                            }
                        } catch (error) {
                            alert('Error: ' + error.message);
                        }
                    });
                });
            }
            if (rejectBtn) {
                rejectBtn.addEventListener('click', async () => {
                    if (!confirm('Reject this payment?')) return;
                    await withButtonLoading(rejectBtn, async () => {
                        try {
                            const result = await verifyPayment(id, 'Rejected');
                            if (result.success) {
                                alert('Payment rejected successfully.');
                                document.getElementById('viewModal').style.display = 'none';
                                await refreshAll();
                            } else {
                                alert(result.error || 'Failed to reject payment.');
                            }
                        } catch (error) {
                            alert('Error: ' + error.message);
                        }
                    });
                });
            }
        } catch (error) {
            alert('Failed to load payment: ' + error.message);
        }
    }

    const expectedAmountHint = document.getElementById('expectedAmountHint');
    const amountMismatchWarning = document.getElementById('amountMismatchWarning');
    const transactionTypeSelect = document.getElementById('transactionType');
    const referenceIdInput = document.getElementById('referenceId');
    const amountInput = document.getElementById('amount');
    let expectedAmountForCurrentReference = null;

    function updateMismatchWarning() {
        const entered = parseFloat(amountInput.value);
        if (expectedAmountForCurrentReference === null || isNaN(entered)) {
            amountMismatchWarning.style.display = 'none';
            return;
        }
        const differs = Math.abs(entered - expectedAmountForCurrentReference) > 0.001;
        amountMismatchWarning.textContent = differs
            ? 'Payment amount differs from the expected lot amount. Please verify the amount before submitting.'
            : '';
        amountMismatchWarning.style.display = differs ? 'block' : 'none';
    }

    // Non-blocking: only ever informs the user, never prevents submission — the
    // system may legitimately support partial payments or other scenarios where
    // the amount won't match the lot price exactly.
    const refreshExpectedAmount = debounce(async () => {
        const transactionType = transactionTypeSelect.value;
        const referenceId = referenceIdInput.value.trim();
        expectedAmountForCurrentReference = null;
        expectedAmountHint.style.display = 'none';
        amountMismatchWarning.style.display = 'none';

        if (!transactionType || !referenceId) {
            return;
        }

        try {
            const params = new URLSearchParams({ transaction_type: transactionType, reference_id: referenceId });
            if (currentReferenceKind) params.set('reference_kind', currentReferenceKind);
            const result = await api.request(`payments/expected-amount?${params.toString()}`, { method: 'GET' });
            if (result && result.expected_amount !== null && result.expected_amount !== undefined) {
                expectedAmountForCurrentReference = parseFloat(result.expected_amount);
                expectedAmountHint.textContent = `Expected Amount: ${formatCurrency(expectedAmountForCurrentReference)}`;
                expectedAmountHint.style.display = 'block';
                // Batch M9: pre-fill rather than leave the user to retype a
                // number the system already knows — only when the field is
                // still empty, so this never clobbers an amount the user
                // already typed (e.g. a deliberate partial payment).
                if (!amountInput.value.trim()) {
                    amountInput.value = expectedAmountForCurrentReference.toFixed(2);
                }
                updateMismatchWarning();
            }
        } catch (error) {
            // Silently ignore — this is an informational lookup only, and a
            // failure here must never block the payment form itself.
        }
    }, 300);

    transactionTypeSelect.addEventListener('change', refreshExpectedAmount);
    referenceIdInput.addEventListener('input', refreshExpectedAmount);
    amountInput.addEventListener('input', updateMismatchWarning);

    // Batch N5 (adviser feedback 2026-08-18): "lot id/sched id diff — it
    // should be set automatically" — replaces the bare numeric Reference ID
    // field with a search-as-you-type picker over the real records, so
    // staff no longer have to already know/guess the internal ID. The
    // manual number input (referenceId) stays as the actual value the rest
    // of this form/submission already reads — this only adds a friendlier
    // way to fill it, with a collapsed manual fallback for Renewal/Other
    // (which have no single searchable entity) or edge cases.
    const referenceSearchWrap = document.getElementById('referenceSearchWrap');
    const referenceSearchInput = document.getElementById('referenceSearchInput');
    const referenceSearchResults = document.getElementById('referenceSearchResults');
    const referenceSelectedLabel = document.getElementById('referenceSelectedLabel');
    const referenceManualToggle = document.getElementById('referenceManualToggle');

    const REFERENCE_SEARCH_CONFIG = {
        'Lot Purchase': {
            endpoint: 'schedules',
            placeholder: 'Search by decedent name or lot number...',
            mapResult: (s) => ({
                id: s.schedule_id,
                label: `Lot ${s.lot_number || '—'} — ${s.section_name || 'N/A'} — ${[s.first_name, s.last_name].filter(Boolean).join(' ') || 'Unknown'} — ${s.schedule_date || 'No date'}`,
                customerName: s.contact_name || s.requested_by_name || s.created_by_name || [s.first_name, s.last_name].filter(Boolean).join(' ') || 'Client',
                contactNumber: s.contact_number || s.requested_by_contact_number || '',
            }),
        },
        'Cremation': {
            endpoint: 'cremations',
            placeholder: 'Search by decedent name or niche number...',
            mapResult: (c) => ({
                id: c.cremation_id,
                label: `Niche ${c.niche_number || '—'} — ${c.columbarium || 'N/A'} — ${[c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown'}`,
                customerName: c.contact_name || c.requested_by_name || [c.first_name, c.last_name].filter(Boolean).join(' ') || 'Client',
                contactNumber: c.contact_number || c.requested_by_contact_number || '',
            }),
        },
        'Relocation': {
            endpoint: 'relocations',
            placeholder: 'Search by decedent name or lot number...',
            mapResult: (r) => ({
                id: r.request_id,
                label: `${[r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown'} — ${r.from_lot_number || '—'} → ${r.to_lot_number || '—'} (${r.status || 'Pending'})`,
                customerName: r.contact_name || [r.first_name, r.last_name].filter(Boolean).join(' ') || 'Client',
                contactNumber: r.contact_number || '',
            }),
        },
    };

    // currentReferenceKind ('schedule'|'lot'|null): burial audit finding E.2 —
    // for 'Lot Purchase', reference_id alone is ambiguous between a
    // schedule_id and a raw lot_id (see PaymentController::
    // validatePaymentReference()'s comment). Tracked here so the actual
    // submission states its intent explicitly instead of letting the backend
    // guess by existence-check order. Stays null for Cremation/Relocation/
    // Renewal/Other, which have no such ambiguity, and for the manual
    // reference-entry fallback (staff typing a raw id themselves) — both
    // fall back to the backend's original guess, unchanged.
    let currentReferenceKind = null;

    function setReferenceValue(id, label, kind = null, extra = null) {
        referenceIdInput.value = id;
        referenceIdInput.dispatchEvent(new Event('input', { bubbles: true }));
        currentReferenceKind = kind;
        if (label) {
            const selectedTextEl = document.getElementById('referenceSelectedText');
            if (selectedTextEl) {
                selectedTextEl.textContent = `Selected: ${label}`;
            } else {
                referenceSelectedLabel.textContent = `Selected: ${label}`;
            }
            referenceSelectedLabel.style.display = 'flex';

            // Automated Customer Info Hooking (Adviser Item #1)
            const customerHookCard = document.getElementById('customerHookCard');
            const customerHookDetails = document.getElementById('customerHookDetails');
            if (customerHookCard && customerHookDetails) {
                if (extra && (extra.customerName || extra.contactNumber)) {
                    customerHookDetails.innerHTML = `
                        <strong>Payer / Account:</strong> ${escapeHtml(extra.customerName || 'Client')}<br>
                        <strong>Contact Number:</strong> ${escapeHtml(extra.contactNumber || 'Available on account')}<br>
                        <span style="font-size: 0.78rem; color: #16a34a;"><i class="fas fa-link"></i> Customer details automatically hooked</span>
                    `;
                    customerHookCard.style.display = 'block';
                } else {
                    customerHookCard.style.display = 'none';
                }
            }
        } else {
            referenceSelectedLabel.style.display = 'none';
            const customerHookCard = document.getElementById('customerHookCard');
            if (customerHookCard) customerHookCard.style.display = 'none';
        }
    }

    function clearReferenceSelection() {
        referenceSearchInput.value = '';
        referenceSearchResults.hidden = true;
        referenceSearchResults.innerHTML = '';
        referenceSelectedLabel.style.display = 'none';
        const customerHookCard = document.getElementById('customerHookCard');
        if (customerHookCard) customerHookCard.style.display = 'none';
        referenceIdInput.value = '';
        currentReferenceKind = null;
        const selectedTextEl = document.getElementById('referenceSelectedText');
        if (selectedTextEl) selectedTextEl.textContent = 'Selected:';
    }

    const clearRefBtn = document.getElementById('clearReferenceSelectionBtn');
    if (clearRefBtn) {
        clearRefBtn.addEventListener('click', () => {
            clearReferenceSelection();
            expectedAmountForCurrentReference = null;
            if (expectedAmountHint) expectedAmountHint.style.display = 'none';
            if (amountMismatchWarning) amountMismatchWarning.style.display = 'none';
        });
    }

    function renderReferenceResults(items) {
        if (!items.length) {
            referenceSearchResults.innerHTML = '<div class="reference-search-result is-empty">No matches found.</div>';
            referenceSearchResults.hidden = false;
            return;
        }
        referenceSearchResults.innerHTML = items.map((item, idx) => `
            <div class="reference-search-result" data-idx="${idx}" tabindex="0" role="button">${item.label}</div>
        `).join('');
        referenceSearchResults.hidden = false;
        referenceSearchResults.querySelectorAll('.reference-search-result[data-idx]').forEach((el) => {
            const item = items[Number(el.dataset.idx)];
            const select = () => {
                // REFERENCE_SEARCH_CONFIG['Lot Purchase'].endpoint is always
                // 'schedules' — a result picked here is always a schedule_id,
                // never a raw lot_id, so this can state that with certainty.
                const kind = transactionTypeSelect.value === 'Lot Purchase' ? 'schedule' : null;
                setReferenceValue(item.id, item.label, kind, item);
                referenceSearchInput.value = item.label;
                referenceSearchResults.hidden = true;
                referenceSearchResults.innerHTML = '';
            };
            el.addEventListener('click', select);
            el.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(); }
            });
        });
    }

    const runReferenceSearch = debounce(async () => {
        const config = REFERENCE_SEARCH_CONFIG[transactionTypeSelect.value];
        const query = referenceSearchInput.value.trim();
        if (!config || query.length < 2) {
            referenceSearchResults.hidden = true;
            referenceSearchResults.innerHTML = '';
            return;
        }
        try {
            const params = new URLSearchParams({ q: query, per_page: 8, page: 1 });
            const result = await api.request(`${config.endpoint}?${params.toString()}`, { method: 'GET' });
            const rows = result && Array.isArray(result.data) ? result.data : [];
            renderReferenceResults(rows.map(config.mapResult));
        } catch (error) {
            // Search is a convenience layer only — the manual fallback below
            // always still works, so a failed lookup must never block the form.
            referenceSearchResults.hidden = true;
            referenceSearchResults.innerHTML = '';
        }
    }, 300);

    referenceSearchInput.addEventListener('input', () => {
        // Typing again after picking a result means the user is searching
        // anew — the previous selection is no longer necessarily correct.
        referenceIdInput.value = '';
        currentReferenceKind = null;
        referenceSelectedLabel.style.display = 'none';
        runReferenceSearch();
    });

    document.addEventListener('click', (e) => {
        if (!referenceSearchWrap.contains(e.target)) {
            referenceSearchResults.hidden = true;
        }
    });

    function updateReferenceModeForType() {
        const config = REFERENCE_SEARCH_CONFIG[transactionTypeSelect.value];
        clearReferenceSelection();
        if (config) {
            referenceSearchWrap.style.display = '';
            referenceSearchInput.disabled = false;
            referenceSearchInput.placeholder = config.placeholder;
            referenceManualToggle.open = false;
        } else {
            // Renewal / Other: no single searchable entity exists for these
            // yet, so go straight to the manual fallback instead of showing
            // a search box that can never return results.
            referenceSearchWrap.style.display = 'none';
            referenceManualToggle.open = true;
        }
        const payOnlineBtn = document.getElementById('payOnlineBtn');
        if (payOnlineBtn) {
            payOnlineBtn.style.display = transactionTypeSelect.value === 'Lot Purchase' ? 'inline-flex' : 'none';
        }
    }

    transactionTypeSelect.addEventListener('change', updateReferenceModeForType);

    const payOnlineBtn = document.getElementById('payOnlineBtn');
    if (payOnlineBtn) {
        payOnlineBtn.addEventListener('click', async () => {
            const referenceId = referenceIdInput.value.trim();
            if (!referenceId) {
                alert('Please select a reservation or lot reference before proceeding to online checkout.');
                return;
            }
            if (transactionTypeSelect.value !== 'Lot Purchase') {
                alert('PayMongo checkout is currently supported for Lot Purchase only.');
                return;
            }

            const paymentId = document.getElementById('paymentId').value.trim();
            const payload = {
                transaction_type: 'Lot Purchase',
                reference_id: referenceId,
            };
            if (currentReferenceKind) {
                payload.reference_kind = currentReferenceKind;
            }
            if (paymentId) {
                payload.payment_id = paymentId;
            }
            payload.origin = (typeof getAppOrigin === 'function' ? getAppOrigin() : `${window.location.origin}${window.location.pathname.includes('/CMS') ? '/CMS' : ''}`);

            await withButtonLoading(payOnlineBtn, async () => {
                try {
                    const result = await api.request('payments/checkout-session', {
                        method: 'POST',
                        body: payload,
                    });

                    if (result && result.checkout_url) {
                        window.location.href = result.checkout_url;
                    } else if (result && result.error) {
                        alert('Checkout notice: ' + result.error);
                    } else {
                        alert('Failed to initiate checkout session. Please try again.');
                    }
                } catch (err) {
                    alert('Checkout request failed: ' + (err.message || 'Unknown error'));
                }
            });
        });
    }

    const paymentModalContent = document.querySelector('#paymentModal .payment-form-modal');
    const modalScrollButtons = document.querySelectorAll('#paymentModal .modal-scroll-btn');

    function updateModalScrollButtons() {
        if (!paymentModalContent) return;
        const maxScroll = paymentModalContent.scrollHeight - paymentModalContent.clientHeight;
        const atTop = paymentModalContent.scrollTop <= 6;
        const atBottom = paymentModalContent.scrollTop >= maxScroll - 6;

        modalScrollButtons.forEach((button) => {
            const direction = button.dataset.scrollDir;
            const shouldDisable = direction === 'up' ? atTop : atBottom;
            button.disabled = shouldDisable;
        });
    }

    modalScrollButtons.forEach((button) => {
        button.addEventListener('click', () => {
            if (!paymentModalContent) return;
            const direction = button.dataset.scrollDir === 'up' ? -1 : 1;
            paymentModalContent.scrollBy({ top: direction * 180, behavior: 'smooth' });
        });
    });

    paymentModalContent?.addEventListener('scroll', updateModalScrollButtons);

    function openAddModal() {
        document.getElementById('modalTitle').innerText = 'Record Payment';
        document.getElementById('paymentForm').reset();
        document.getElementById('paymentId').value = '';
        document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
        expectedAmountForCurrentReference = null;
        expectedAmountHint.style.display = 'none';
        amountMismatchWarning.style.display = 'none';
        const receiptFilePrompt = document.getElementById('receiptFilePrompt');
        if (receiptFilePrompt) receiptFilePrompt.textContent = 'Click or drag receipt file here';
        updateReferenceModeForType();
        document.getElementById('paymentModal').style.display = 'flex';
        requestAnimationFrame(updateModalScrollButtons);
    }

    const receiptFileInput = document.getElementById('receiptFile');
    const receiptFilePrompt = document.getElementById('receiptFilePrompt');
    if (receiptFileInput && receiptFilePrompt) {
        receiptFileInput.addEventListener('change', () => {
            if (receiptFileInput.files && receiptFileInput.files[0]) {
                receiptFilePrompt.innerHTML = `<i class="fas fa-file-circle-check" style="color: #2c5e47; margin-right: 6px;"></i> <strong>${escapeHtml(receiptFileInput.files[0].name)}</strong>`;
            } else {
                receiptFilePrompt.textContent = 'Click or drag receipt file here';
            }
        });
    }

    document.getElementById('paymentForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('paymentId').value;
        const formData = new FormData();
        formData.append('transaction_type', document.getElementById('transactionType').value);
        formData.append('reference_id', document.getElementById('referenceId').value || '');
        if (currentReferenceKind) formData.append('reference_kind', currentReferenceKind);
        formData.append('amount', document.getElementById('amount').value);
        formData.append('payment_date', document.getElementById('paymentDate').value);
        formData.append('payment_method', document.getElementById('paymentMethod').value);
        formData.append('receipt_number', document.getElementById('receiptNumber').value.trim());
        formData.append('notes', document.getElementById('paymentNotes').value.trim());

        const receiptFile = document.getElementById('receiptFile').files[0];
        if (receiptFile) {
            formData.append('receipt_file', receiptFile);
        }

        // receipt_number is intentionally excluded — leaving it blank is valid;
        // the backend auto-generates one (RCPT-{year}-{payment_id}) when omitted.
        const requiredFields = ['transaction_type', 'amount', 'payment_date', 'payment_method'];
        for (const field of requiredFields) {
            if (!formData.get(field) || formData.get(field).trim() === '') {
                alert('Please fill in all required fields.');
                return;
            }
        }

        const saveBtn = e.target.querySelector('button[type="submit"]');
        document.body.classList.add('btn-submitting');
        try {
            await withButtonLoading(saveBtn, async () => {
                try {
                    const options = { body: formData };
                    const result = id
                        ? await api.request(`payments/${id}`, { method: 'PUT', ...options })
                        : await api.request('payments', { method: 'POST', ...options });

                    if (result.success) {
                        document.getElementById('paymentModal').style.display = 'none';
                        pagination.reset();
                        await refreshAll();
                    } else {
                        alert(result.error || 'Failed to save payment');
                    }
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            });
        } finally {
            document.body.classList.remove('btn-submitting');
        }
    });

    function closePaymentModal() {
        const form = document.getElementById('paymentForm');
        if (form) form.reset();
        clearReferenceSelection();
        expectedAmountForCurrentReference = null;
        if (expectedAmountHint) expectedAmountHint.style.display = 'none';
        if (amountMismatchWarning) amountMismatchWarning.style.display = 'none';
        const receiptFilePrompt = document.getElementById('receiptFilePrompt');
        if (receiptFilePrompt) receiptFilePrompt.textContent = 'Click or drag receipt file here';
        document.getElementById('paymentModal').style.display = 'none';
    }

    document.getElementById('openAddPayment')?.addEventListener('click', openAddModal);
    document.getElementById('closePaymentModalBtn')?.addEventListener('click', closePaymentModal);
    document.querySelector('#paymentModal .close')?.addEventListener('click', closePaymentModal);
    document.querySelectorAll('#closeViewModalBtn, #viewModal .deck-close-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.getElementById('viewModal').style.display = 'none';
        });
    });

    const cancelPaymentBtn = document.getElementById('cancelPaymentBtn');
    if (cancelPaymentBtn) {
        cancelPaymentBtn.addEventListener('click', closePaymentModal);
    }

    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('paymentModal')) closePaymentModal();
        if (e.target === document.getElementById('viewModal')) document.getElementById('viewModal').style.display = 'none';
    });

    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            if (document.getElementById('paymentModal')?.style.display === 'flex') {
                closePaymentModal();
            }
            if (document.getElementById('viewModal')?.style.display === 'flex') {
                document.getElementById('viewModal').style.display = 'none';
            }
        }
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
        syncStatCardActiveState();
        pagination.reset();
        await refreshAll();
    });

    document.querySelectorAll('.records-tab-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            statusFilterSelect.value = btn.dataset.tab || '';
            syncStatCardActiveState();
            pagination.reset();
            await refreshAll();
        });
    });

    const searchClearBtn = document.getElementById('searchClearBtn');
    if (searchClearBtn) {
        referenceFilterInput.addEventListener('input', () => {
            searchClearBtn.style.display = referenceFilterInput.value ? 'block' : 'none';
        });
        searchClearBtn.addEventListener('click', async () => {
            referenceFilterInput.value = '';
            searchClearBtn.style.display = 'none';
            pagination.reset();
            await refreshAll();
        });
    }

    const exportCsvBtn = document.getElementById('exportCsvBtn');
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', async () => {
            await withButtonLoading(exportCsvBtn, async () => {
                try {
                    const params = new URLSearchParams();
                    if (referenceFilterInput.value) params.set('reference_id', referenceFilterInput.value);
                    if (transactionTypeFilterSelect.value) params.set('transaction_type', transactionTypeFilterSelect.value);
                    if (statusFilterSelect.value) params.set('verification_status', statusFilterSelect.value);
                    if (dateFromFilterInput.value) params.set('date_from', dateFromFilterInput.value);
                    if (dateToFilterInput.value) params.set('date_to', dateToFilterInput.value);
                    params.set('per_page', '1000');

                    const response = await api.request(`payments?${params.toString()}`, { method: 'GET' });
                    const exportData = response.data || [];
                    if (exportData.length === 0) {
                        alert('No payment records found to export.');
                        return;
                    }

                    const headers = ['Receipt Number', 'Transaction Type', 'Reference ID', 'Amount (PHP)', 'Payment Date', 'Payment Method', 'Verification Status', 'Verified By', 'Verified At', 'Recorded By', 'Notes'];
                    const csvRows = [headers.join(',')];

                    exportData.forEach(p => {
                        const row = [
                            `"${(p.receipt_number || '').replace(/"/g, '""')}"`,
                            `"${(p.transaction_type || '').replace(/"/g, '""')}"`,
                            `"${(p.reference_id || '').replace(/"/g, '""')}"`,
                            `"${(p.amount || 0)}"`,
                            `"${(p.payment_date || '').replace(/"/g, '""')}"`,
                            `"${(p.payment_method || '').replace(/"/g, '""')}"`,
                            `"${(p.verification_status || 'Pending').replace(/"/g, '""')}"`,
                            `"${(p.verified_by_name || p.verified_by || '').replace(/"/g, '""')}"`,
                            `"${(p.verified_at || '').replace(/"/g, '""')}"`,
                            `"${(p.received_by_name || '').replace(/"/g, '""')}"`,
                            `"${(p.notes || '').replace(/"/g, '""')}"`
                        ];
                        csvRows.push(row.join(','));
                    });

                    const csvBlob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(csvBlob);
                    const a = document.createElement('a');
                    const dateStr = new Date().toISOString().split('T')[0];
                    a.href = url;
                    a.download = `payments_ledger_${dateStr}.csv`;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                } catch (err) {
                    alert('Export failed: ' + (err.message || err));
                }
            });
        });
    }

    document.querySelectorAll('.stat-card-filterable').forEach(card => {
        async function triggerFilter() {
            const filterType = card.dataset.filter;
            const isAlreadyActive = card.classList.contains('active') || card.classList.contains('is-active-filter');

            if (filterType === 'all' || (isAlreadyActive && filterType !== 'all')) {
                referenceFilterInput.value = '';
                transactionTypeFilterSelect.value = '';
                statusFilterSelect.value = '';
                dateFromFilterInput.value = '';
                dateToFilterInput.value = '';
            } else if (filterType === 'month') {
                const now = new Date();
                dateFromFilterInput.value = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
                dateToFilterInput.value = new Date(now.getFullYear(), now.getMonth() + 1, 0).toISOString().slice(0, 10);
                statusFilterSelect.value = '';
            } else if (filterType === 'pending') {
                statusFilterSelect.value = 'Pending';
            } else if (filterType === 'verified') {
                statusFilterSelect.value = 'Verified';
            }
            syncStatCardActiveState();
            pagination.reset();
            await refreshAll();
        }

        card.addEventListener('click', triggerFilter);
        card.addEventListener('keydown', async (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                await triggerFilter();
            }
        });
    });

    if (verifyAllPaymentsBtn) {
        verifyAllPaymentsBtn.addEventListener('click', async () => {
            if (!confirm('Verify all pending payments?')) return;
            await withButtonLoading(verifyAllPaymentsBtn, async () => {
                try {
                    const result = await verifyAllPending('Verified');
                    if (result.success) {
                        alert(result.message || 'All pending payments verified.');
                        pagination.reset();
                        await refreshAll();
                    } else {
                        alert(result.error || 'Failed to verify pending payments.');
                    }
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            });
        });
    }

    if (rejectAllPaymentsBtn) {
        rejectAllPaymentsBtn.addEventListener('click', async () => {
            if (!confirm('Reject all pending payments?')) return;
            await withButtonLoading(rejectAllPaymentsBtn, async () => {
                try {
                    const result = await verifyAllPending('Rejected');
                    if (result.success) {
                        alert(result.message || 'All pending payments rejected.');
                        pagination.reset();
                        await refreshAll();
                    } else {
                        alert(result.error || 'Failed to reject pending payments.');
                    }
                } catch (error) {
                    alert('Error: ' + error.message);
                }
            });
        });
    }

    await refreshAll();

    // Auto open payment modal if reservation/lot parameters passed via URL query params
    const urlParams = new URLSearchParams(window.location.search);

    // Batch 3: Handle PayMongo checkout return
    const checkoutStatus = urlParams.get('checkout_status');
    if (checkoutStatus) {
        const alertEl = document.getElementById('checkoutStatusAlert');
        const paramPaymentId = urlParams.get('payment_id');
        if (alertEl) {
            if (checkoutStatus === 'success') {
                alertEl.className = 'alert-banner alert-success';
                alertEl.style.display = 'flex';
                alertEl.innerHTML = `<i class="fas fa-circle-check" style="margin-right: 8px;"></i> <div><strong>Payment submitted to gateway.</strong> Verification is still pending staff review or webhook confirmation. ${paramPaymentId ? '(Payment #' + escapeHtml(paramPaymentId) + ')' : ''}</div>`;
            } else if (checkoutStatus === 'cancelled') {
                alertEl.className = 'alert-banner alert-warning';
                alertEl.style.display = 'flex';
                alertEl.innerHTML = `<i class="fas fa-triangle-exclamation" style="margin-right: 8px;"></i> <div><strong>Checkout session cancelled.</strong> Your reservation remains pending. You may retry payment at any time.</div>`;
            }
        }
        urlParams.delete('checkout_status');
        urlParams.delete('payment_id');
        const newSearch = urlParams.toString();
        const cleanUrl = window.location.pathname + (newSearch ? '?' + newSearch : '');
        window.history.replaceState({}, document.title, cleanUrl);
    }

    const urlReservationId = urlParams.get('reservation_id');
    const urlLotId = urlParams.get('lot_id');
    const urlLotNum = urlParams.get('lot_number');
    // Cremation Phase B: mirrors the lot_id/reservation_id pattern above —
    // cremation_id has no reference_kind ambiguity (unlike Lot Purchase's
    // schedule_id/lot_id collision risk), so urlReferenceKind is
    // deliberately left untouched by this addition; PaymentController::
    // validatePaymentReference()'s Cremation case never uses it.
    const urlCremationId = urlParams.get('cremation_id');
    const urlPrice = urlParams.get('price');
    const urlTransactionType = urlParams.get('transaction_type');
    // Explicit query param wins; otherwise infer from which id param is
    // present as a safe default (reservation_id -> schedule, lot_id -> lot) —
    // see PaymentController::validatePaymentReference()'s comment for why
    // this can't be left to guess server-side.
    const urlReferenceKind = urlParams.get('reference_kind')
        || (urlReservationId ? 'schedule' : (urlLotId ? 'lot' : null));
    if (urlReservationId || urlLotId || urlLotNum || urlCremationId) {
        openAddModal();
        if (urlTransactionType) {
            document.getElementById('transactionType').value = urlTransactionType;
        }
        // Re-sync the reference picker to the actual transaction type before
        // setting its value — openAddModal() only set it up for the default
        // (first option) type.
        updateReferenceModeForType();
        const refId = urlReservationId || urlLotId || urlCremationId;
        if (refId) {
            setReferenceValue(refId, urlLotNum ? `Lot ${urlLotNum}` : null, urlReferenceKind);
            if (urlLotNum) referenceSearchInput.value = `Lot ${urlLotNum}`;
        }
        if (urlLotNum) {
            document.getElementById('receiptNumber').value = `REC-${urlLotNum}-${Date.now().toString().slice(-4)}`;
        }
        if (urlPrice) {
            document.getElementById('amount').value = urlPrice;
        }
        refreshExpectedAmount();
    }

    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
