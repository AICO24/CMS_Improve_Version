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
    const statParts = {
        totalRevenueTitle: statsEl.totalRevenue.closest('.stat-card')?.querySelector('.stat-title'),
        totalRevenueSub: statsEl.totalRevenue.closest('.stat-card')?.querySelector('.stat-sub'),
        monthRevenueTitle: statsEl.monthRevenue.closest('.stat-card')?.querySelector('.stat-title'),
        monthRevenueSub: statsEl.monthRevenue.closest('.stat-card')?.querySelector('.stat-sub'),
        transactionCountTitle: statsEl.transactionCount.closest('.stat-card')?.querySelector('.stat-title'),
        transactionCountSub: statsEl.transactionCount.closest('.stat-card')?.querySelector('.stat-sub'),
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
            tbody.innerHTML = `
                <tr>
                    <td colspan="8">
                        <div class="payments-empty-state">
                            <i class="fas fa-receipt"></i>
                            <strong>No payments found</strong>
                            <span>Adjust the filters or record a new payment.</span>
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
                    <td><span class="receipt-chip">${p.receipt_number || '—'}</span></td>
                    <td><span class="transaction-type">${p.transaction_type || '—'}</span></td>
                    <td class="amount-cell">${formatCurrency(p.amount)}</td>
                    <td class="date-cell">${date}</td>
                    <td><span class="method-chip">${p.payment_method || '—'}</span></td>
                    <td><span class="status-badge ${statusBadgeClass(p.verification_status || 'Pending')}">${p.verification_status || 'Pending'}</span></td>
                    <td class="received-by-cell">${p.received_by_name || 'N/A'}</td>
                    <td class="action-buttons">
                        <button class="btn-view" title="View"><i class="fas fa-eye"></i></button>
                        ${currentUser.role === 'admin' && (p.verification_status || 'Pending') !== 'Verified' ? '<button class="btn-delete-row" title="Delete"><i class="fas fa-trash"></i></button>' : ''}
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

    function renderStats(revenue, monthRevenue, payments, meta) {
        if (currentUser.role === 'user') {
            const visiblePending = payments.filter((payment) => (payment.verification_status || 'Pending') === 'Pending').length;
            const visibleVerified = payments.filter((payment) => payment.verification_status === 'Verified').length;
            if (statParts.totalRevenueTitle) statParts.totalRevenueTitle.innerText = 'My Payments';
            if (statParts.monthRevenueTitle) statParts.monthRevenueTitle.innerText = 'Pending';
            if (statParts.transactionCountTitle) statParts.transactionCountTitle.innerText = 'Verified';
            if (statParts.totalRevenueSub) statParts.totalRevenueSub.innerText = 'Matching filters';
            if (statParts.monthRevenueSub) statParts.monthRevenueSub.innerText = 'Visible page';
            if (statParts.transactionCountSub) statParts.transactionCountSub.innerText = 'Visible page';
            statsEl.totalRevenue.innerText = meta.total || 0;
            statsEl.monthRevenue.innerText = visiblePending;
            statsEl.transactionCount.innerText = visibleVerified;
        } else {
            if (statParts.totalRevenueTitle) statParts.totalRevenueTitle.innerText = 'Total Revenue';
            if (statParts.monthRevenueTitle) statParts.monthRevenueTitle.innerText = 'This Month';
            if (statParts.transactionCountTitle) statParts.transactionCountTitle.innerText = 'Transactions';
            if (statParts.totalRevenueSub) statParts.totalRevenueSub.innerText = 'All time';
            if (statParts.monthRevenueSub) statParts.monthRevenueSub.innerText = 'Current month';
            if (statParts.transactionCountSub) statParts.transactionCountSub.innerText = 'Total count';
            statsEl.totalRevenue.innerText = formatCurrency(revenue.total || 0);
            statsEl.monthRevenue.innerText = formatCurrency(monthRevenue.total || 0);
            statsEl.transactionCount.innerText = meta.total || 0;
        }
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
            renderActiveFilterChips();
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
                <div class="payment-detail-summary">
                    <div>
                        <span>Amount</span>
                        <strong>${formatCurrency(payment.amount)}</strong>
                    </div>
                    <div>
                        <span>Status</span>
                        <span class="status-badge ${statusBadgeClass(payment.verification_status || 'Pending')}">${payment.verification_status || 'Pending'}</span>
                    </div>
                    <div>
                        <span>Receipt</span>
                        <strong>${payment.receipt_number || '—'}</strong>
                    </div>
                </div>
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
                ${currentUser && (currentUser.role === 'admin' || currentUser.role === 'staff') ? `
                    <div id="aiExplanation" class="muted" style="display:none; margin-top: 10px; padding: 10px; border-left: 3px solid var(--color-primary, #2563eb);"></div>
                    <button type="button" class="btn-secondary" id="askAiExplainBtn" style="margin-top: 10px;"><i class="fas fa-robot"></i> Ask AI to explain</button>
                ` : ''}
                ${currentUser && currentUser.role === 'admin' && payment.verification_status === 'Pending' ? `
                    <div class="action-buttons admin-verification-actions">
                        <button id="verifyPaymentBtn" class="btn-verify"><i class="fas fa-check"></i> Verify</button>
                        <button id="rejectPaymentBtn" class="btn-reject"><i class="fas fa-times"></i> Reject</button>
                    </div>
                ` : ''}
            `;
            document.getElementById('viewDetails').innerHTML = details;
            document.getElementById('viewModal').style.display = 'flex';

            const aiExplanationEl = document.getElementById('aiExplanation');
            const askAiExplainBtn = document.getElementById('askAiExplainBtn');
            if (askAiExplainBtn && aiExplanationEl) {
                askAiExplainBtn.addEventListener('click', async () => {
                    await withButtonLoading(askAiExplainBtn, async () => {
                        try {
                            const result = await api.request('ai/explain-entity', {
                                method: 'POST',
                                body: { entity_type: 'Payment', entity_id: id },
                            });
                            if (result && result.explained && result.message) {
                                aiExplanationEl.textContent = result.message;
                            } else {
                                aiExplanationEl.textContent = 'AI explanation is unavailable right now.';
                            }
                        } catch (error) {
                            aiExplanationEl.textContent = 'AI explanation is unavailable right now.';
                        }
                        aiExplanationEl.style.display = 'block';
                    });
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
            }),
        },
        'Cremation': {
            endpoint: 'cremations',
            placeholder: 'Search by decedent name or niche number...',
            mapResult: (c) => ({
                id: c.cremation_id,
                label: `Niche ${c.niche_number || '—'} — ${c.columbarium || 'N/A'} — ${[c.first_name, c.last_name].filter(Boolean).join(' ') || 'Unknown'}`,
            }),
        },
        'Relocation': {
            endpoint: 'relocations',
            placeholder: 'Search by decedent name or lot number...',
            mapResult: (r) => ({
                id: r.request_id,
                label: `${[r.first_name, r.last_name].filter(Boolean).join(' ') || 'Unknown'} — ${r.from_lot_number || '—'} → ${r.to_lot_number || '—'} (${r.status || 'Pending'})`,
            }),
        },
    };

    function setReferenceValue(id, label) {
        referenceIdInput.value = id;
        referenceIdInput.dispatchEvent(new Event('input', { bubbles: true }));
        if (label) {
            referenceSelectedLabel.textContent = `Selected: ${label}`;
            referenceSelectedLabel.style.display = 'block';
        } else {
            referenceSelectedLabel.style.display = 'none';
        }
    }

    function clearReferenceSelection() {
        referenceSearchInput.value = '';
        referenceSearchResults.hidden = true;
        referenceSearchResults.innerHTML = '';
        referenceSelectedLabel.style.display = 'none';
        referenceIdInput.value = '';
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
                setReferenceValue(item.id, item.label);
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
    }

    transactionTypeSelect.addEventListener('change', updateReferenceModeForType);

    function openAddModal() {
        document.getElementById('modalTitle').innerText = 'Record Payment';
        document.getElementById('paymentForm').reset();
        document.getElementById('paymentId').value = '';
        document.getElementById('paymentDate').value = new Date().toISOString().split('T')[0];
        expectedAmountForCurrentReference = null;
        expectedAmountHint.style.display = 'none';
        amountMismatchWarning.style.display = 'none';
        updateReferenceModeForType();
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
    const urlReservationId = urlParams.get('reservation_id');
    const urlLotId = urlParams.get('lot_id');
    const urlLotNum = urlParams.get('lot_number');
    const urlPrice = urlParams.get('price');
    const urlTransactionType = urlParams.get('transaction_type');
    if (urlReservationId || urlLotId || urlLotNum) {
        openAddModal();
        if (urlTransactionType) {
            document.getElementById('transactionType').value = urlTransactionType;
        }
        // Re-sync the reference picker to the actual transaction type before
        // setting its value — openAddModal() only set it up for the default
        // (first option) type.
        updateReferenceModeForType();
        const refId = urlReservationId || urlLotId;
        if (refId) {
            setReferenceValue(refId, urlLotNum ? `Lot ${urlLotNum}` : null);
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
