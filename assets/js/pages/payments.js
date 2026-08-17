document.addEventListener('DOMContentLoaded', async function() {
    const currentUser = await requireRole(['admin', 'staff', 'user']);
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
    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
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

    function formatCurrency(amount) {
        return `₱${parseFloat(amount || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function statusBadgeClass(status) {
        if (status === 'Verified') return 'status-success';
        if (status === 'Rejected') return 'status-danger';
        return 'status-warning';
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
                    <td><span class="status-badge ${statusBadgeClass(p.verification_status || 'Pending')}">${p.verification_status || 'Pending'}</span></td>
                    <td>${p.received_by_name || 'N/A'}</td>
                    <td class="action-buttons">
                        <button class="btn-view" title="View"><i class="fas fa-eye"></i></button>
                        ${currentUser.role === 'admin' ? '<button class="btn-delete-row" title="Delete"><i class="fas fa-trash"></i></button>' : ''}
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

        tbody.querySelectorAll('.btn-delete-row').forEach(btn => {
            btn.addEventListener('click', async () => {
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

    function renderStats(revenue, monthRevenue, payments, meta) {
        statsEl.totalRevenue.innerText = formatCurrency(revenue.total || 0);
        statsEl.monthRevenue.innerText = formatCurrency(monthRevenue.total || 0);
        statsEl.transactionCount.innerText = meta.total || 0;
        // Payments are already sorted newest-first by the backend, so the first
        // row on page 1 is the most recent payment.
        statsEl.lastPayment.innerText = pagination.page === 1 && payments.length > 0
            ? (payments[0].payment_date || payments[0].created_at || '—')
            : statsEl.lastPayment.innerText || '—';
    }

    async function refreshAll() {
        try {
            const [paymentsResult, revenue, monthRevenue] = await Promise.all([
                loadPayments(),
                loadRevenue(),
                loadMonthRevenue(),
            ]);
            const payments = paymentsResult.data || [];
            const meta = paymentsResult.meta || { page: 1, pages: 1, total: payments.length };
            renderStats(revenue, monthRevenue, payments, meta);
            renderTable(payments);
            pagination.render(meta);
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
                <div class="detail-row"><span>Verification Status</span><span class="status-badge ${statusBadgeClass(payment.verification_status || 'Pending')}">${payment.verification_status || 'Pending'}</span></div>
                <div class="detail-row"><span>Verified By</span><strong>${payment.verified_by_name || payment.verified_by || '—'}</strong></div>
                <div class="detail-row"><span>Verified At</span><strong>${payment.verified_at || '—'}</strong></div>
                <div class="detail-row"><span>Receipt</span><strong>${payment.receipt_url ? `<a href="${payment.receipt_url}" target="_blank">Download</a>` : 'Not attached'}</strong></div>
                <div class="detail-row"><span>Received By</span><strong>${payment.received_by_name || 'N/A'}</strong></div>
                <div class="detail-row"><span>Notes</span><strong>${payment.notes || '—'}</strong></div>
                ${currentUser && currentUser.role === 'admin' && payment.verification_status === 'Pending' ? `
                    <div class="action-buttons admin-verification-actions">
                        <button id="verifyPaymentBtn" class="btn-verify"><i class="fas fa-check"></i> Verify</button>
                        <button id="rejectPaymentBtn" class="btn-reject"><i class="fas fa-times"></i> Reject</button>
                    </div>
                ` : ''}
            `;
            document.getElementById('viewDetails').innerHTML = details;
            document.getElementById('viewModal').style.display = 'flex';

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
            const result = await api.request(`payments/expected-amount?${params.toString()}`, { method: 'GET' });
            if (result && result.expected_amount !== null && result.expected_amount !== undefined) {
                expectedAmountForCurrentReference = parseFloat(result.expected_amount);
                expectedAmountHint.textContent = `Expected Amount: ${formatCurrency(expectedAmountForCurrentReference)}`;
                expectedAmountHint.style.display = 'block';
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

    function openAddModal() {
        document.getElementById('modalTitle').innerText = 'Record Payment';
        document.getElementById('paymentForm').reset();
        document.getElementById('paymentId').value = '';
        document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
        expectedAmountForCurrentReference = null;
        expectedAmountHint.style.display = 'none';
        amountMismatchWarning.style.display = 'none';
        document.getElementById('paymentModal').style.display = 'flex';
    }

    document.getElementById('paymentForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('paymentId').value;
        const formData = new FormData();
        formData.append('transaction_type', document.getElementById('transactionType').value);
        formData.append('reference_id', document.getElementById('referenceId').value || '');
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
    });

    document.getElementById('openAddPayment').addEventListener('click', openAddModal);
    document.querySelector('#paymentModal .close').addEventListener('click', () => document.getElementById('paymentModal').style.display = 'none');
    document.querySelector('#viewModal .close-view').addEventListener('click', () => document.getElementById('viewModal').style.display = 'none');

    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('paymentModal')) document.getElementById('paymentModal').style.display = 'none';
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

    await refreshAll();

    // Auto open payment modal if reservation/lot parameters passed via URL query params
    const urlParams = new URLSearchParams(window.location.search);
    const urlReservationId = urlParams.get('reservation_id');
    const urlLotId = urlParams.get('lot_id');
    const urlLotNum = urlParams.get('lot_number');
    const urlPrice = urlParams.get('price');
    const urlTransactionType = urlParams.get('transaction_type');
    if (urlReservationId || urlLotId || urlLotNum) {
        openAddModal();
        const refId = urlReservationId || urlLotId;
        if (refId) {
            document.getElementById('referenceId').value = refId;
        }
        if (urlLotNum) {
            document.getElementById('receiptNumber').value = `REC-${urlLotNum}-${Date.now().toString().slice(-4)}`;
        }
        if (urlPrice) {
            document.getElementById('amount').value = urlPrice;
        }
        if (urlTransactionType) {
            document.getElementById('transactionType').value = urlTransactionType;
        }
        refreshExpectedAmount();
    }

    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
