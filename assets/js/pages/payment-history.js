document.addEventListener('DOMContentLoaded', async function() {
    const currentUser = await requireRole(['user']);
    if (!currentUser) return;

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
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');

    const perPage = 10;
    let currentPage = 1;
    let pageCount = 1;

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
        params.set('page', currentPage);
        params.set('per_page', perPage);
        const result = await api.request(`payments/mine?${params.toString()}`, { method: 'GET' });
        return result && Array.isArray(result.data) ? result : { data: [], meta: { page: 1, pages: 1, total: 0 } };
    }

    // This is a user's own read-only ledger, not the org-wide revenue report, so
    // stats are computed here from the user's own (unpaginated, filtered) payments
    // rather than the admin/staff-only payments/revenue* endpoints.
    async function loadOwnPaymentsForStats() {
        const result = await api.request(`payments/mine?${filterParams().toString()}`, { method: 'GET' }).catch(() => []);
        return Array.isArray(result) ? result : [];
    }

    function formatCurrency(amount) {
        return `₱${parseFloat(amount || 0).toLocaleString()}`;
    }

    function renderTable(payments) {
        if (!payments || payments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8">No payments recorded.</td></tr>';
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
                    <td>${p.verification_status || 'Pending'}</td>
                    <td>${p.received_by_name || 'N/A'}</td>
                    <td class="action-buttons">
                        <button class="btn-view" title="View"><i class="fas fa-eye"></i></button>
                    </td>
                </tr>
            `;
        }).join('');

        tbody.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.closest('tr').dataset.id;
                showViewModal(id);
            });
        });
    }

    function renderPagination(meta) {
        currentPage = meta.page || 1;
        pageCount = meta.pages || 1;
        const total = meta.total || 0;
        paginationInfo.textContent = `Page ${currentPage} of ${pageCount} • ${total} payment${total === 1 ? '' : 's'}`;
        prevPageBtn.disabled = currentPage <= 1;
        nextPageBtn.disabled = currentPage >= pageCount;
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

    async function refreshAll() {
        try {
            const [paymentsResult, ownPayments] = await Promise.all([
                loadPayments(),
                loadOwnPaymentsForStats(),
            ]);
            const payments = paymentsResult.data || [];
            const meta = paymentsResult.meta || { page: 1, pages: 1, total: payments.length };
            renderStats(ownPayments);
            renderTable(payments);
            renderPagination(meta);
        } catch (error) {
            console.error('Refresh failed:', error);
            tbody.innerHTML = '<tr><td colspan="8">Failed to load payments. Please refresh.</td></tr>';
        }
    }

    async function loadReservationDetails(payment) {
        if (payment.transaction_type !== 'Lot Purchase' || !payment.reference_id) {
            return null;
        }
        try {
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
            const details = `
                ${renderReservationSection(schedule)}
                <div class="detail-row"><span>Receipt Number</span><strong>${payment.receipt_number || '—'}</strong></div>
                <div class="detail-row"><span>Transaction Type</span><strong>${payment.transaction_type || '—'}</strong></div>
                <div class="detail-row"><span>Reference ID</span><strong>${payment.reference_id || '—'}</strong></div>
                <div class="detail-row"><span>Amount</span><strong>${formatCurrency(payment.amount)}</strong></div>
                <div class="detail-row"><span>Payment Date</span><strong>${payment.payment_date || '—'}</strong></div>
                <div class="detail-row"><span>Payment Method</span><strong>${payment.payment_method || '—'}</strong></div>
                <div class="detail-row"><span>Verification Status</span><strong>${payment.verification_status || 'Pending'}</strong></div>
                <div class="detail-row"><span>Verified At</span><strong>${payment.verified_at || '—'}</strong></div>
                <div class="detail-row"><span>Receipt</span><strong>${payment.receipt_url ? `<a href="${payment.receipt_url}" target="_blank">Download</a>` : 'Not attached'}</strong></div>
                <div class="detail-row"><span>Notes</span><strong>${payment.notes || '—'}</strong></div>
            `;
            document.getElementById('viewDetails').innerHTML = details;
            document.getElementById('viewModal').style.display = 'flex';
        } catch (error) {
            alert('Failed to load payment: ' + error.message);
        }
    }

    document.querySelector('#viewModal .close-view').addEventListener('click', () => document.getElementById('viewModal').style.display = 'none');
    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('viewModal')) document.getElementById('viewModal').style.display = 'none';
    });

    function debounce(fn, delay = 300) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }

    const refreshFiltered = debounce(async () => {
        currentPage = 1;
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
        currentPage = 1;
        await refreshAll();
    });

    prevPageBtn.addEventListener('click', async () => {
        if (currentPage <= 1) return;
        currentPage -= 1;
        await refreshAll();
    });
    nextPageBtn.addEventListener('click', async () => {
        if (currentPage >= pageCount) return;
        currentPage += 1;
        await refreshAll();
    });

    await refreshAll();

    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
