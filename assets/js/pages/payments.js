document.addEventListener('DOMContentLoaded', async function() {
    let currentUser = null;

    try {
        const user = await api.getMe();
        currentUser = user;
        document.getElementById('userName').innerText = user.full_name || user.username;
        document.getElementById('userRole').innerText = user.role === 'admin' ? 'Administrator' : 'Staff';
        document.getElementById('sidebarUserName').innerText = user.full_name || user.username;
        document.getElementById('sidebarUserRole').innerText = user.role === 'admin' ? 'Administrator' : 'Staff';
        if (user.role !== 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        } else {
            document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'flex'; el.classList.remove('admin-only'); });
        }
    } catch (error) {
        window.location.href = 'login.html';
        return;
    }

    const tbody = document.getElementById('paymentsTableBody');
    const statsEl = {
        totalRevenue: document.getElementById('totalRevenue'),
        monthRevenue: document.getElementById('monthRevenue'),
        transactionCount: document.getElementById('transactionCount'),
        lastPayment: document.getElementById('lastPayment')
    };

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

    async function loadPayments() {
        const endpoint = currentUser && currentUser.role === 'admin' ? 'payments' : 'payments/mine';
        return await api.request(endpoint, { method: 'GET' });
    }

    async function loadRevenue() {
        return await api.request('payments/revenue', { method: 'GET' });
    }

    async function verifyPayment(id, status) {
        return await api.request(`payments/${id}/verify`, {
            method: 'PUT',
            body: { verification_status: status }
        });
    }

    function formatCurrency(amount) {
        return `₱${parseFloat(amount || 0).toLocaleString()}`;
    }

    function renderTable(payments) {
        if (!payments || payments.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8">No payments recorded.</td></tr>';
            statsEl.monthRevenue.innerText = '₱0';
            statsEl.transactionCount.innerText = 0;
            statsEl.lastPayment.innerText = '—';
            return;
        }

        const currentMonth = new Date().toISOString().slice(0, 7);
        let monthTotal = 0;
        let lastPaymentDate = '—';

        tbody.innerHTML = payments.map(p => {
            const date = p.payment_date || p.created_at || '—';
            if (date.startsWith(currentMonth)) {
                monthTotal += parseFloat(p.amount || 0);
            }
            if (date !== '—') {
                lastPaymentDate = date;
            }
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
                        <button class="btn-delete-row" title="Delete"><i class="fas fa-trash"></i></button>
                    </td>
                </tr>
            `;
        }).join('');

        statsEl.monthRevenue.innerText = formatCurrency(monthTotal);
        statsEl.transactionCount.innerText = payments.length;
        statsEl.lastPayment.innerText = lastPaymentDate;

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

    async function refreshAll() {
        try {
            const [payments, revenue] = await Promise.all([loadPayments(), loadRevenue()]);
            renderStats(revenue, payments);
            renderTable(payments);
        } catch (error) {
            console.error('Refresh failed:', error);
            tbody.innerHTML = '<tr><td colspan="7">Failed to load payments. Please refresh.</td></tr>';
        }
    }

    function renderStats(revenue, payments) {
        statsEl.totalRevenue.innerText = formatCurrency(revenue.total || 0);
        statsEl.transactionCount.innerText = payments.length || 0;
    }

    async function showViewModal(id) {
        try {
            const payment = await api.request(`payments/${id}`, { method: 'GET' });
            const details = `
                <div class="detail-row"><span>Receipt Number</span><strong>${payment.receipt_number || '—'}</strong></div>
                <div class="detail-row"><span>Transaction Type</span><strong>${payment.transaction_type || '—'}</strong></div>
                <div class="detail-row"><span>Reference ID</span><strong>${payment.reference_id || '—'}</strong></div>
                <div class="detail-row"><span>Amount</span><strong>${formatCurrency(payment.amount)}</strong></div>
                <div class="detail-row"><span>Payment Date</span><strong>${payment.payment_date || '—'}</strong></div>
                <div class="detail-row"><span>Payment Method</span><strong>${payment.payment_method || '—'}</strong></div>
                <div class="detail-row"><span>Verification Status</span><strong>${payment.verification_status || 'Pending'}</strong></div>
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
            }
            if (rejectBtn) {
                rejectBtn.addEventListener('click', async () => {
                    if (!confirm('Reject this payment?')) return;
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
            }
        } catch (error) {
            alert('Failed to load payment: ' + error.message);
        }
    }

    function openAddModal() {
        document.getElementById('modalTitle').innerText = 'Record Payment';
        document.getElementById('paymentForm').reset();
        document.getElementById('paymentId').value = '';
        document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
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

        const requiredFields = ['transaction_type', 'amount', 'payment_date', 'payment_method', 'receipt_number'];
        for (const field of requiredFields) {
            if (!formData.get(field) || formData.get(field).trim() === '') {
                alert('Please fill in all required fields.');
                return;
            }
        }

        try {
            const options = { body: formData };
            const result = id
                ? await api.request(`payments/${id}`, { method: 'PUT', ...options })
                : await api.request('payments', { method: 'POST', ...options });

            if (result.success) {
                document.getElementById('paymentModal').style.display = 'none';
                await refreshAll();
            } else {
                alert(result.error || 'Failed to save payment');
            }
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });

    document.getElementById('openAddPayment').addEventListener('click', openAddModal);
    document.querySelector('#paymentModal .close').addEventListener('click', () => document.getElementById('paymentModal').style.display = 'none');
    document.querySelector('#viewModal .close-view').addEventListener('click', () => document.getElementById('viewModal').style.display = 'none');

    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('paymentModal')) document.getElementById('paymentModal').style.display = 'none';
        if (e.target === document.getElementById('viewModal')) document.getElementById('viewModal').style.display = 'none';
    });

    await refreshAll();

    // Auto open payment modal if lot parameters passed via URL query params
    const urlParams = new URLSearchParams(window.location.search);
    const urlLotId = urlParams.get('lot_id');
    const urlLotNum = urlParams.get('lot_number');
    const urlPrice = urlParams.get('price');
    if (urlLotId || urlLotNum) {
        openAddModal();
        if (urlLotNum) {
            document.getElementById('referenceId').value = `LOT-${urlLotNum}`;
            document.getElementById('receiptNumber').value = `REC-${urlLotNum}-${Date.now().toString().slice(-4)}`;
        }
        if (urlPrice) {
            document.getElementById('amount').value = urlPrice;
        }
    }

    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
