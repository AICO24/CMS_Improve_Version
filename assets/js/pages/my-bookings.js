/**
 * My Unified Bookings Controller (BMS-9)
 * Manages unified view of burial schedules, cremations, and active drafts.
 */
(function() {
    const bookingsTableBody = document.getElementById('bookingsTableBody');
    const activeDraftsBanner = document.getElementById('activeDraftsBanner');
    const activeDraftsText = document.getElementById('activeDraftsText');
    const btnResumeDraft = document.getElementById('btnResumeDraft');
    const bookingSearchInput = document.getElementById('bookingSearchInput');
    const bookingTypeFilter = document.getElementById('bookingTypeFilter');
    const statTotal = document.getElementById('statTotal');
    const statBurials = document.getElementById('statBurials');
    const statCremations = document.getElementById('statCremations');
    const statDrafts = document.getElementById('statDrafts');
    const bookingDetailModal = document.getElementById('bookingDetailModal');
    const bookingDetailBody = document.getElementById('bookingDetailBody');
    const bookingDetailFooter = document.getElementById('bookingDetailFooter');
    const closeDetailModal = document.getElementById('closeDetailModal');
    const closeDetailModalBtn = document.getElementById('closeDetailModalBtn');

    let currentBookings = [];

    async function init() {
        try {
            if (typeof requireRole === 'function') {
                const user = await requireRole(['user', 'admin', 'staff']);
                if (!user) return;
            }
        } catch (e) {
            console.warn('Role verification bypassed:', e);
        }

        // URL query parameter support for pre-filtering (e.g. ?type=burial or ?type=cremation from legacy redirects)
        try {
            const urlParams = new URLSearchParams(window.location.search);
            const typeParam = urlParams.get('type');
            if (typeParam && bookingTypeFilter) {
                const normalizedType = typeParam.toLowerCase().trim();
                const validTypes = Array.from(bookingTypeFilter.options).map(opt => opt.value);
                if (validTypes.includes(normalizedType)) {
                    bookingTypeFilter.value = normalizedType;
                }
            }

            // Handle PayMongo checkout redirect back to citizen My Bookings
            const checkoutStatus = urlParams.get('checkout_status');
            const returnPaymentId = urlParams.get('payment_id');
            if (checkoutStatus) {
                const alertEl = document.getElementById('checkoutStatusAlert');
                if (alertEl) {
                    if (checkoutStatus === 'success') {
                        alertEl.style.display = 'flex';
                        alertEl.style.background = '#f0fdf4';
                        alertEl.style.border = '1px solid #bbf7d0';
                        alertEl.style.color = '#166534';
                        alertEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Payment submitted!</strong> Confirming status with PayMongo...</div>';

                        if (returnPaymentId) {
                            api.request(`payments/${returnPaymentId}/sync-status`, { method: 'POST' })
                                .then((syncRes) => {
                                    if (syncRes && syncRes.verified) {
                                        alertEl.innerHTML = '<i class="fas fa-circle-check" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Payment Verified &amp; Booking Confirmed!</strong> Your burial reservation has been scheduled and the lot is reserved.</div>';
                                        if (typeof showToast === 'function') {
                                            showToast('Payment verified & booking confirmed!', 'success');
                                        }
                                    } else {
                                        alertEl.innerHTML = '<i class="fas fa-circle-info" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Payment submitted!</strong> Processing gateway confirmation. Your booking will update once finalized.</div>';
                                    }
                                    loadUnifiedBookings();
                                })
                                .catch(() => {
                                    alertEl.innerHTML = '<i class="fas fa-circle-info" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Payment submitted successfully!</strong> Verification is awaiting gateway confirmation.</div>';
                                    loadUnifiedBookings();
                                });
                        } else {
                            alertEl.innerHTML = '<i class="fas fa-circle-check" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Payment submitted successfully!</strong> Verification is awaiting gateway confirmation.</div>';
                            if (typeof showToast === 'function') {
                                showToast('Payment submitted successfully!', 'success');
                            }
                            loadUnifiedBookings();
                        }
                    } else if (checkoutStatus === 'cancelled') {
                        alertEl.style.display = 'flex';
                        alertEl.style.background = '#fffbeb';
                        alertEl.style.border = '1px solid #fde68a';
                        alertEl.style.color = '#92400e';
                        alertEl.innerHTML = '<i class="fas fa-triangle-exclamation" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Checkout session cancelled.</strong> Your reservation remains Pending. You can complete or retry payment at any time.</div>';
                        if (typeof showToast === 'function') {
                            showToast('Checkout was cancelled. Your reservation remains Pending.', 'warning');
                        }
                    }
                }
                urlParams.delete('checkout_status');
                urlParams.delete('payment_id');
                const newSearch = urlParams.toString();
                const cleanUrl = window.location.pathname + (newSearch ? '?' + newSearch : '');
                window.history.replaceState({}, document.title, cleanUrl);
            }
        } catch (e) {
            console.warn('Failed to parse URL query params:', e);
        }

        // BATCH AI-4 (Citizen Unified Booking Scope): AI Assistant mount for citizen bookings & schedules.
        // Scoped strictly to module: 'Schedule', which queries the authenticated citizen's bookings server-side.
        if (typeof initAiAssistant === 'function' && document.getElementById('aiAssistantMount')) {
            initAiAssistant({
                mountSelector: '#aiAssistantMount',
                context: { scope: 'module', module: 'Schedule' },
                greeting: "Hello! I'm your AI assistant for your bookings. How can I help you today?",
                suggestions: [
                    { icon: 'fa-calendar-check', label: 'My bookings', question: 'What is the status of my bookings right now?' },
                    { icon: 'fa-clock-rotate-left', label: 'Anything pending?', question: 'Do I have any pending bookings, and what do they need?' },
                ],
            });
        }

        setupEventListeners();

        await Promise.all([
            checkActiveDrafts(),
            loadUnifiedBookings()
        ]);
    }

    function setupEventListeners() {
        if (bookingTypeFilter) {
            bookingTypeFilter.addEventListener('change', () => {
                loadUnifiedBookings();
            });
        }

        const refreshBtn = document.getElementById('refreshBookingsBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', async () => {
                refreshBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
                await loadUnifiedBookings();
                refreshBtn.innerHTML = '<i class="fas fa-rotate"></i>';
            });
        }

        if (bookingSearchInput) {
            let debounceTimer;
            bookingSearchInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    loadUnifiedBookings();
                }, 300);
            });
        }

        const toggleBtn = document.getElementById('toggleSidebar');
        const sidebar = document.querySelector('.sidebar');
        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener('change', () => {
                sidebar.classList.toggle('collapsed');
            });
        }

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn && typeof api !== 'undefined' && typeof api.logout === 'function') {
            logoutBtn.addEventListener('click', () => api.logout());
        }

        if (bookingsTableBody) {
            bookingsTableBody.addEventListener('click', (e) => {
                const btn = e.target.closest('.btn-view-details');
                if (btn) {
                    const idx = Number(btn.getAttribute('data-index'));
                    const item = currentBookings[idx];
                    if (item) {
                        openBookingDetails(item);
                    }
                }
            });
        }

        if (closeDetailModal) {
            closeDetailModal.addEventListener('click', closeDetails);
        }
        if (closeDetailModalBtn) {
            closeDetailModalBtn.addEventListener('click', closeDetails);
        }
        if (bookingDetailModal) {
            bookingDetailModal.addEventListener('click', (e) => {
                if (e.target === bookingDetailModal) closeDetails();
            });
        }
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && bookingDetailModal && bookingDetailModal.style.display !== 'none') {
                closeDetails();
            }
        });
    }

    async function checkActiveDrafts() {
        try {
            const res = await api.request('booking-agent/active', { method: 'GET' });
            if (res && res.success && res.draft) {
                const draft = res.draft;
                if (activeDraftsBanner) {
                    activeDraftsBanner.style.display = 'block';
                }
                const sType = draft.service_type || 'service';
                const decName = draft.extracted_data && draft.extracted_data.decedent_name
                    ? ` for "${escapeHtml(draft.extracted_data.decedent_name)}"`
                    : '';
                if (activeDraftsText) {
                    activeDraftsText.textContent = `You have an uncompleted ${sType} booking draft${decName}. You can continue right where you left off.`;
                }
                if (btnResumeDraft) {
                    btnResumeDraft.href = `booking-assistant.html?draft_id=${draft.draft_id}`;
                }
            } else if (activeDraftsBanner) {
                activeDraftsBanner.style.display = 'none';
            }
        } catch (e) {
            console.error('Error checking active drafts:', e);
            if (activeDraftsBanner) {
                activeDraftsBanner.style.display = 'none';
            }
        }
    }

    async function loadUnifiedBookings() {
        if (!bookingsTableBody) return;

        try {
            const filterVal = bookingTypeFilter ? bookingTypeFilter.value : '';
            const queryVal = bookingSearchInput ? bookingSearchInput.value.trim() : '';

            const params = new URLSearchParams();
            if (filterVal === 'draft') {
                params.append('source_kind', 'DRAFT');
            } else if (filterVal && filterVal !== 'all') {
                params.append('service_type', filterVal);
            }

            if (queryVal) {
                params.append('q', queryVal);
            }

            const qs = params.toString() ? `?${params.toString()}` : '';
            const res = await api.request(`bookings/mine${qs}`, { method: 'GET' });

            if (res && res.success) {
                currentBookings = Array.isArray(res.data) ? res.data : [];
                updateStats(res.stats);
                renderBookingsTable(currentBookings);
            } else {
                throw new Error(res.error || 'Failed to fetch bookings');
            }
        } catch (err) {
            console.error('Error loading unified bookings:', err);
            bookingsTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:24px;color:#ef4444;"><i class="fas fa-circle-exclamation"></i> Error loading bookings: ${escapeHtml(err.message || 'Server error')}</td></tr>`;
        }
    }

    function updateStats(stats) {
        if (!stats) return;
        if (statTotal) statTotal.textContent = stats.total ?? 0;
        if (statBurials) statBurials.textContent = stats.burial ?? 0;
        if (statCremations) statCremations.textContent = stats.cremation ?? 0;
        if (statDrafts) statDrafts.textContent = stats.drafts ?? 0;
    }

    function renderBookingsTable(items) {
        if (!items || items.length === 0) {
            bookingsTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#64748b;"><i class="fas fa-inbox" style="font-size:1.5rem;margin-bottom:8px;display:block;color:#94a3b8;"></i>No bookings or reservations found matching your criteria. Use <a href="book-a-service.html" style="color:#2563eb;font-weight:600;text-decoration:none;">Book a Service</a> to arrange a burial or cremation.</td></tr>`;
            return;
        }

        bookingsTableBody.innerHTML = '';
        items.forEach((item, index) => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #f1f5f9';

            const isDraft = Number(item.is_draft) === 1 || item.source_kind === 'DRAFT';
            const serviceType = (item.service_type || '').toLowerCase();

            // Type Badge
            let typeBadge = '';
            if (isDraft) {
                typeBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:#fef3c7;color:#92400e;font-weight:600;"><i class="fas fa-pen-to-square"></i> Draft (${serviceType ? capitalize(serviceType) : 'Service'})</span>`;
            } else if (serviceType === 'burial') {
                typeBadge = '<span style="display:inline-flex;align-items:center;gap:4px;color:#166534;font-weight:600;"><i class="fas fa-monument"></i> Burial</span>';
            } else if (serviceType === 'cremation') {
                typeBadge = '<span style="display:inline-flex;align-items:center;gap:4px;color:#6b21a8;font-weight:600;"><i class="fas fa-fire"></i> Cremation</span>';
            } else {
                typeBadge = `<span style="display:inline-flex;align-items:center;gap:4px;color:#475569;font-weight:600;">${escapeHtml(item.source_kind)}</span>`;
            }

            // Status Badge
            const statusUpper = (item.status || 'PENDING').toUpperCase();
            let badgeColor = '#475569';
            let badgeBg = '#f1f5f9';
            if (['CONFIRMED', 'SCHEDULED', 'COMPLETED', 'APPROVED'].includes(statusUpper)) {
                badgeColor = '#059669';
                badgeBg = '#d1fae5';
            } else if (['PENDING', 'COLLECTING', 'READY', 'CONFIRMING'].includes(statusUpper)) {
                badgeColor = '#d97706';
                badgeBg = '#fef3c7';
            } else if (['CANCELLED', 'EXPIRED', 'REJECTED'].includes(statusUpper)) {
                badgeColor = '#dc2626';
                badgeBg = '#fee2e2';
            }
            const statusBadge = `<span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:${badgeBg};color:${badgeColor};font-weight:600;">${escapeHtml(formatBookingStatus(item.status, isDraft))}</span>`;

            // Format Date
            let displayDate = item.booking_date;
            if (!displayDate || displayDate === '0000-00-00' || displayDate === '0000-00-00 00:00:00') {
                displayDate = isDraft ? '<em style="color:#94a3b8;">In progress</em>' : '<em style="color:#94a3b8;">TBD</em>';
            } else {
                try {
                    const d = new Date(String(displayDate).replace(' ', 'T'));
                    if (!isNaN(d.getTime())) {
                        displayDate = d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
                    }
                } catch (e) {}
            }

            // Actions
            let actionHtml = '';
            if (isDraft) {
                const draftId = item.draft_id || item.source_id;
                actionHtml = `<a href="booking-assistant.html?draft_id=${draftId}" class="btn-primary" style="font-size:0.8rem;padding:4px 10px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;"><i class="fas fa-play"></i> Resume</a>`;
            } else {
                actionHtml = `<button type="button" class="btn-secondary btn-view-details" data-index="${index}" style="font-size:0.8rem;padding:4px 10px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;"><i class="fas fa-eye"></i> Details</button>`;
            }

            tr.innerHTML = `
                <td style="padding:12px 8px;">${typeBadge}</td>
                <td style="padding:12px 8px;font-family:monospace;font-size:0.85rem;font-weight:600;color:#334155;">${escapeHtml(item.booking_reference || '-')}</td>
                <td style="padding:12px 8px;font-weight:500;">${escapeHtml(item.decedent_name || (isDraft ? 'Pending Details' : 'Formal Record Pending'))}</td>
                <td style="padding:12px 8px;font-size:0.9rem;">${displayDate}</td>
                <td style="padding:12px 8px;font-size:0.85rem;color:#475569;">${escapeHtml(item.allocation || (isDraft ? 'Pending Selection' : 'Standard'))}</td>
                <td style="padding:12px 8px;">${statusBadge}</td>
                <td style="padding:12px 8px;">${actionHtml}</td>
            `;
            bookingsTableBody.appendChild(tr);
        });
    }

    function closeDetails() {
        if (bookingDetailModal) {
            bookingDetailModal.style.display = 'none';
        }
    }

    function resolvePaymentDisplay(record, isDraft, serviceType) {
        if (isDraft) {
            return {
                statusText: 'Draft In Progress',
                badgeBg: '#fef3c7',
                badgeColor: '#92400e',
                canPayOnline: false,
                buttonLabel: null,
                explanation: 'Complete booking draft to finalize schedule and online checkout.'
            };
        }

        const refundStatus = record.refund_status;
        const pStatus = record.payment_status;
        const gwStatus = record.gateway_status;
        const hasSession = !!record.gateway_checkout_session_id;
        const bStatus = String(record.status || '').toUpperCase();

        if (refundStatus === 'Succeeded') {
            return {
                statusText: 'Refunded',
                badgeBg: '#e0e7ff',
                badgeColor: '#3730a3',
                canPayOnline: false,
                buttonLabel: null,
                explanation: 'Payment was refunded via PayMongo.'
            };
        }

        if (refundStatus === 'Pending' || refundStatus === 'Processing') {
            return {
                statusText: 'Refund Pending',
                badgeBg: '#fef3c7',
                badgeColor: '#b45309',
                canPayOnline: false,
                buttonLabel: null,
                explanation: 'A refund is currently processing with the gateway.'
            };
        }

        if (pStatus === 'Verified') {
            return {
                statusText: 'Payment Verified',
                badgeBg: '#dcfce7',
                badgeColor: '#166534',
                canPayOnline: false,
                buttonLabel: null,
                explanation: bStatus === 'CONFIRMED' ? 'Payment verified and schedule confirmed.' : 'Payment verified by gateway webhook.'
            };
        }

        if (gwStatus === 'expired' || gwStatus === 'cancelled') {
            return {
                statusText: 'Payment Expired / Cancelled',
                badgeBg: '#fee2e2',
                badgeColor: '#991b1b',
                canPayOnline: serviceType === 'burial' && bStatus !== 'CANCELLED',
                buttonLabel: 'Retry Payment (PayMongo)',
                explanation: 'Previous checkout session expired or was cancelled. You can retry payment anytime.'
            };
        }

        if (pStatus === 'Pending') {
            if (hasSession && (gwStatus === 'active' || gwStatus === 'awaiting_payment_method')) {
                return {
                    statusText: 'Pending / Awaiting Payment',
                    badgeBg: '#fef3c7',
                    badgeColor: '#92400e',
                    canPayOnline: serviceType === 'burial' && bStatus !== 'CANCELLED',
                    buttonLabel: 'Continue Checkout (PayMongo)',
                    explanation: 'Awaiting completion of online payment via PayMongo.'
                };
            }
            return {
                statusText: 'Checkout Available',
                badgeBg: '#fef3c7',
                badgeColor: '#92400e',
                canPayOnline: serviceType === 'burial' && bStatus !== 'CANCELLED',
                buttonLabel: 'Pay Online (PayMongo)',
                explanation: 'Reservation recorded as Pending. Online checkout is available.'
            };
        }

        // No payment record yet
        return {
            statusText: serviceType === 'burial' ? 'Checkout Available' : 'Pending Review',
            badgeBg: '#f1f5f9',
            badgeColor: '#475569',
            canPayOnline: serviceType === 'burial' && bStatus !== 'CANCELLED',
            buttonLabel: 'Pay Online (PayMongo)',
            explanation: serviceType === 'burial' ? 'Ready for online checkout.' : 'Awaiting review.'
        };
    }

    async function openBookingDetails(item) {
        if (!bookingDetailModal || !bookingDetailBody) return;
        bookingDetailModal.style.display = 'flex';
        bookingDetailBody.innerHTML = '<p style="text-align:center;padding:24px;color:#64748b;"><i class="fas fa-spinner fa-spin"></i> Loading booking details...</p>';

        const serviceType = String(item.service_type || '').toLowerCase();
        const isDraft = Number(item.is_draft) === 1 || item.source_kind === 'DRAFT';
        const sourceId = item.source_id;

        try {
            let fullData = null;
            if (!isDraft && sourceId) {
                const endpoint = serviceType === 'burial' ? `schedules/${sourceId}` : `cremations/${sourceId}`;
                fullData = await api.request(endpoint, { method: 'GET' }).catch(() => null);
            }

            const record = (fullData && fullData.data) ? fullData.data : (fullData || item);
            const statusUpper = String(record.status || item.status || '').toUpperCase();
            const canCancel = ['PENDING', 'DRAFT'].includes(statusUpper);

            const displayDate = record.schedule_date || record.cremation_date || item.booking_date || 'TBD';
            const displayTime = record.schedule_time || '';
            const paymentStatus = record.payment_status || 'Pending Verification';
            const paymentAmount = record.payment_amount ? `₱${Number(record.payment_amount).toLocaleString('en-PH', { minimumFractionDigits: 2 })}` : 'N/A';
            const notes = record.notes || 'None';

            const paymentInfo = resolvePaymentDisplay(record, isDraft, serviceType);

            bookingDetailBody.innerHTML = `
                <div style="display:flex;flex-direction:column;gap:16px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;padding-bottom:12px;border-bottom:1px solid var(--color-border);">
                        <div>
                            <span style="font-size:0.75rem;text-transform:uppercase;color:var(--color-text-muted);font-weight:700;">Reference</span>
                            <div style="font-family:monospace;font-size:1.15rem;font-weight:700;color:var(--color-text);">${escapeHtml(item.booking_reference || '-')}</div>
                        </div>
                        <div>
                            <span style="display:inline-block;padding:4px 10px;border-radius:var(--radius-sm);font-size:0.8rem;font-weight:700;text-transform:uppercase;background:${serviceType === 'burial' ? 'var(--color-success-soft);color:var(--color-success-strong);' : 'var(--color-primary-50);color:var(--color-primary-700);'}">
                                <i class="fas ${serviceType === 'burial' ? 'fa-monument' : 'fa-fire'}"></i> ${escapeHtml(serviceType || 'Service')}
                            </span>
                        </div>
                    </div>

                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;">
                        <div>
                            <label style="font-size:0.75rem;color:var(--color-text-muted);font-weight:600;display:block;margin-bottom:2px;">Decedent</label>
                            <strong style="color:var(--color-text);font-size:0.95rem;">${escapeHtml(item.decedent_name || 'Pending Formal Record')}</strong>
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:var(--color-text-muted);font-weight:600;display:block;margin-bottom:2px;">Current Status</label>
                            <span style="display:inline-block;padding:3px 10px;border-radius:var(--radius-sm);font-size:0.8rem;font-weight:600;background:var(--color-surface-soft);color:var(--color-text);">
                                ${escapeHtml(formatBookingStatus(record.status || item.status, isDraft))}
                            </span>
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:var(--color-text-muted);font-weight:600;display:block;margin-bottom:2px;">Scheduled Date / Time</label>
                            <span style="color:var(--color-text);font-size:0.9rem;">${escapeHtml(displayDate)} ${escapeHtml(displayTime)}</span>
                        </div>
                        <div>
                            <label style="font-size:0.75rem;color:var(--color-text-muted);font-weight:600;display:block;margin-bottom:2px;">Allocation</label>
                            <span style="color:var(--color-text);font-size:0.9rem;">${escapeHtml(item.allocation || 'Standard')}</span>
                        </div>
                    </div>

                    <div style="background:var(--color-surface-soft);padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--color-border);">
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px;">
                            <div style="font-size:0.75rem;font-weight:700;text-transform:uppercase;color:var(--color-text-muted);">Payment Information</div>
                            <div style="display:flex;align-items:center;gap:8px;">
                                <span style="display:inline-block;padding:3px 10px;border-radius:var(--radius-sm);font-size:0.78rem;font-weight:700;background:${paymentInfo.badgeBg};color:${paymentInfo.badgeColor};">
                                    ${escapeHtml(paymentInfo.statusText)}
                                </span>
                                ${record.payment_id && record.gateway_checkout_session_id && record.verification_status !== 'Verified' ? `
                                    <button type="button" class="btn btn-secondary" id="btnSyncPaymentModal" style="height:28px;padding:0 8px;font-size:0.75rem;" title="Check real-time status from PayMongo">
                                        <i class="fas fa-arrows-rotate"></i> Check Status
                                    </button>
                                ` : ''}
                            </div>
                        </div>
                        <div style="display:flex;justify-content:space-between;font-size:0.9rem;margin-bottom:6px;color:var(--color-text);">
                            <span>Amount: <strong>${escapeHtml(paymentAmount)}</strong></span>
                            <span>Method: <strong>${escapeHtml(record.payment_method || (serviceType === 'burial' ? 'PayMongo' : 'Standard'))}</strong></span>
                        </div>
                        <div style="font-size:0.8rem;color:var(--color-text-muted);">
                            <i class="fas fa-info-circle"></i> ${escapeHtml(paymentInfo.explanation)}
                        </div>
                    </div>

                    <div>
                        <label style="font-size:0.75rem;color:var(--color-text-muted);font-weight:600;display:block;margin-bottom:2px;">Notes &amp; Special Instructions</label>
                        <p style="font-size:0.85rem;color:var(--color-text-muted);margin:4px 0 0 0;">${escapeHtml(notes)}</p>
                    </div>
                </div>
            `;

            if (bookingDetailFooter) {
                let footerHtml = '<button type="button" class="btn btn-secondary" id="closeDetailModalBtnInner">Close</button>';
                if (paymentInfo.canPayOnline && serviceType === 'burial') {
                    footerHtml = `
                        <button type="button" class="btn btn-primary" id="payOnlineModalBtn">
                            <i class="fas fa-credit-card"></i> ${escapeHtml(paymentInfo.buttonLabel)}
                        </button>
                        ${footerHtml}
                    `;
                }
                if (canCancel) {
                    footerHtml = `
                        <button type="button" class="btn btn-danger" id="cancelBookingBtn">
                            <i class="fas fa-ban"></i> Cancel Booking
                        </button>
                        ${footerHtml}
                    `;
                }
                bookingDetailFooter.innerHTML = footerHtml;

                document.getElementById('closeDetailModalBtnInner')?.addEventListener('click', closeDetails);

                // Real-time PayMongo sync button in modal
                const syncBtn = document.getElementById('btnSyncPaymentModal');
                if (syncBtn && record.payment_id) {
                    syncBtn.addEventListener('click', async () => {
                        syncBtn.disabled = true;
                        syncBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Checking...';
                        try {
                            const syncRes = await api.request(`payments/${record.payment_id}/sync-status`, { method: 'POST' });
                            if (syncRes && syncRes.verified) {
                                if (typeof showToast === 'function') {
                                    showToast('Payment verified & booking confirmed!', 'success');
                                }
                                await loadUnifiedBookings();
                                openBookingDetails(item);
                            } else {
                                if (typeof showToast === 'function') {
                                    showToast(syncRes?.message || 'Payment not yet verified on PayMongo.', 'info');
                                }
                                syncBtn.disabled = false;
                                syncBtn.innerHTML = '<i class="fas fa-arrows-rotate"></i> Check Status';
                            }
                        } catch (err) {
                            if (typeof showToast === 'function') {
                                showToast(err.message || 'Unable to sync status', 'error');
                            }
                            syncBtn.disabled = false;
                            syncBtn.innerHTML = '<i class="fas fa-arrows-rotate"></i> Check Status';
                        }
                    });
                }

                const payBtn = document.getElementById('payOnlineModalBtn');
                if (payBtn) {
                    payBtn.addEventListener('click', async () => {
                        try {
                            payBtn.disabled = true;
                            payBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Initializing Checkout...';
                            const checkoutPayload = {
                                transaction_type: 'Lot Purchase',
                                reference_id: sourceId,
                                reference_kind: 'schedule',
                                origin: window.location.origin
                            };
                            if (record.payment_id) {
                                checkoutPayload.payment_id = record.payment_id;
                            }
                            const res = await api.request('payments/checkout-session', {
                                method: 'POST',
                                body: checkoutPayload
                            });

                            if (res && res.checkout_url) {
                                window.location.href = res.checkout_url;
                            } else if (res && (res.code === 409 || res.reason_code === 'lot_held_checkout')) {
                                const errMsg = res.error || 'This lot is currently held by an active checkout session. Please try again in a few minutes.';
                                if (typeof showToast === 'function') {
                                    showToast(errMsg, 'warning');
                                } else {
                                    alert(errMsg);
                                }
                                payBtn.disabled = false;
                                payBtn.innerHTML = `<i class="fas fa-credit-card"></i> ${escapeHtml(paymentInfo.buttonLabel)}`;
                            } else {
                                const errMsg = res?.error || 'Failed to initialize checkout session. Please try again.';
                                if (typeof showToast === 'function') {
                                    showToast(errMsg, 'error');
                                } else {
                                    alert(errMsg);
                                }
                                payBtn.disabled = false;
                                payBtn.innerHTML = `<i class="fas fa-credit-card"></i> ${escapeHtml(paymentInfo.buttonLabel)}`;
                            }
                        } catch (err) {
                            const errMsg = err.message || 'Unknown error occurred while connecting to payment gateway.';
                            if (typeof showToast === 'function') {
                                showToast(errMsg, 'error');
                            } else {
                                alert(errMsg);
                            }
                            payBtn.disabled = false;
                            payBtn.innerHTML = `<i class="fas fa-credit-card"></i> ${escapeHtml(paymentInfo.buttonLabel)}`;
                        }
                    });
                }

                const cancelBtn = document.getElementById('cancelBookingBtn');
                if (cancelBtn) {
                    cancelBtn.addEventListener('click', async () => {
                        const confirmed = typeof confirmDialog === 'function'
                            ? await confirmDialog({
                                title: 'Cancel this booking?',
                                message: 'This will cancel your pending reservation and release any reserved lots or slots. This action cannot be undone.',
                                confirmLabel: 'Yes, cancel booking',
                                cancelLabel: 'Keep booking',
                                danger: true
                            })
                            : confirm('Cancel this booking? This cannot be undone.');

                        if (!confirmed) return;

                        try {
                            cancelBtn.disabled = true;
                            cancelBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Cancelling...';
                            const endpoint = isDraft
                                ? `booking-agent/drafts/${item.draft_id || item.source_id}/cancel`
                                : (serviceType === 'burial' ? `schedules/${sourceId}` : `cremations/${sourceId}`);
                            const method = isDraft ? 'POST' : 'DELETE';
                            const cancelRes = await api.request(endpoint, { method });

                            if (cancelRes && (cancelRes.success !== false)) {
                                if (typeof showToast === 'function') {
                                    showToast('Booking cancelled successfully', 'success');
                                }
                                closeDetails();
                                await loadUnifiedBookings();
                            } else {
                                throw new Error(cancelRes.error || 'Failed to cancel booking');
                            }
                        } catch (err) {
                            console.error('Cancellation error:', err);
                            if (typeof showToast === 'function') {
                                showToast(err.message || 'Unable to cancel booking', 'error');
                            } else {
                                alert(err.message || 'Unable to cancel booking');
                            }
                            cancelBtn.disabled = false;
                            cancelBtn.innerHTML = '<i class="fas fa-ban"></i> Cancel Booking';
                        }
                    });
                }
            }
        } catch (error) {
            console.error('Failed to open booking details:', error);
            bookingDetailBody.innerHTML = `<p style="color:#ef4444;text-align:center;padding:16px;">Unable to load booking details: ${escapeHtml(error.message || 'Error')}</p>`;
        }
    }

    function formatBookingStatus(status, isDraft) {
        if (!status) return isDraft ? 'Draft (In Progress)' : 'Pending Review';
        const s = String(status).toUpperCase();
        if (isDraft) {
            const draftMap = {
                'INTAKE': 'Draft (Started)',
                'DRAFT_STARTED': 'Draft (Started)',
                'COLLECTING_INFO': 'Draft (In Progress)',
                'LOT_SELECTION': 'Draft (Lot Selection)',
                'CREMATION_PREFS': 'Draft (Preferences)',
                'READY_FOR_REVIEW': 'Draft (Ready to Confirm)',
                'AWAITING_CONFIRM': 'Draft (Awaiting Final Submission)',
                'COMMITTED': 'Submitted (Pending Review)'
            };
            return draftMap[s] || `Draft (${capitalize(status.replace(/_/g, ' ').toLowerCase())})`;
        }
        const recordMap = {
            'PENDING': 'Pending Review',
            'CONFIRMED': 'Confirmed',
            'SCHEDULED': 'Scheduled',
            'COMPLETED': 'Completed',
            'CANCELLED': 'Cancelled',
            'EXPIRED': 'Expired',
            'APPROVED': 'Approved',
            'REJECTED': 'Rejected'
        };
        return recordMap[s] || capitalize(status.replace(/_/g, ' ').toLowerCase());
    }

    function capitalize(str) {
        if (!str) return '';
        return str.charAt(0).toUpperCase() + str.slice(1);
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    document.addEventListener('DOMContentLoaded', init);
})();
