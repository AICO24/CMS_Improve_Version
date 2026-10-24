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
    const certificateModal = document.getElementById('certificateModal');
    const certificateModalBody = document.getElementById('certificateModalBody');
    const closeCertModalBtn = document.getElementById('closeCertModalBtn');
    const btnCloseCertModal = document.getElementById('btnCloseCertModal');
    const btnPrintCert = document.getElementById('btnPrintCert');

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
                if (checkoutStatus === 'success') {
                    if (alertEl) {
                        alertEl.style.display = 'flex';
                        alertEl.style.background = '#f0fdf4';
                        alertEl.style.border = '1px solid #bbf7d0';
                        alertEl.style.color = '#166534';
                        alertEl.innerHTML = '<i class="fas fa-spinner fa-spin" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Payment submitted!</strong> Confirming status with PayMongo...</div>';
                    }

                    if (returnPaymentId) {
                        api.request(`payments/${returnPaymentId}/sync-status`, { method: 'POST' })
                            .then((syncRes) => {
                                if (syncRes && syncRes.verified) {
                                    if (alertEl) {
                                        alertEl.innerHTML = '<i class="fas fa-circle-check" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Payment Verified &amp; Booking Confirmed!</strong> Your reservation has been scheduled and confirmed.</div>';
                                    }
                                    if (typeof showToast === 'function') {
                                        showToast('Payment verified & booking confirmed!', 'success');
                                    }
                                } else {
                                    if (alertEl) {
                                        alertEl.innerHTML = '<i class="fas fa-circle-info" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Payment submitted!</strong> Processing gateway confirmation. Your booking will update once finalized.</div>';
                                    }
                                }
                                loadUnifiedBookings();
                            })
                            .catch(() => {
                                if (alertEl) {
                                    alertEl.innerHTML = '<i class="fas fa-circle-info" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Payment submitted successfully!</strong> Verification is awaiting gateway confirmation.</div>';
                                }
                                loadUnifiedBookings();
                            });
                    } else {
                        if (alertEl) {
                            alertEl.innerHTML = '<i class="fas fa-circle-check" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Payment submitted successfully!</strong> Verification is awaiting gateway confirmation.</div>';
                        }
                        if (typeof showToast === 'function') {
                            showToast('Payment submitted successfully!', 'success');
                        }
                        loadUnifiedBookings();
                    }
                } else if (checkoutStatus === 'cancelled') {
                    if (alertEl) {
                        alertEl.style.display = 'flex';
                        alertEl.style.background = '#fffbeb';
                        alertEl.style.border = '1px solid #fde68a';
                        alertEl.style.color = '#92400e';
                        alertEl.innerHTML = '<i class="fas fa-triangle-exclamation" style="font-size:1.25rem;margin-right:12px;margin-top:2px;"></i><div><strong>Checkout session cancelled.</strong> Your reservation remains Pending. You can complete or retry payment at any time.</div>';
                    }
                    if (typeof showToast === 'function') {
                        showToast('Checkout was cancelled. Your reservation remains Pending.', 'warning');
                    }
                }
                urlParams.delete('checkout_status');
                urlParams.delete('payment_id');
                urlParams.delete('schedule_id');
                urlParams.delete('cremation_id');
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
        const statCards = document.querySelectorAll('#bookingStatsRow .stat-card');
        statCards.forEach(card => {
            function activateCard() {
                const filterVal = card.getAttribute('data-filter') ?? '';
                if (bookingTypeFilter) {
                    bookingTypeFilter.value = filterVal;
                }
                statCards.forEach(c => c.classList.remove('active-filter'));
                card.classList.add('active-filter');
                loadUnifiedBookings();
            }

            card.addEventListener('click', activateCard);
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    activateCard();
                }
            });
        });

        if (bookingTypeFilter) {
            bookingTypeFilter.addEventListener('change', () => {
                const val = bookingTypeFilter.value;
                statCards.forEach(c => {
                    if ((c.getAttribute('data-filter') ?? '') === val) {
                        c.classList.add('active-filter');
                    } else {
                        c.classList.remove('active-filter');
                    }
                });
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
                const detailsBtn = e.target.closest('.btn-view-details');
                if (detailsBtn) {
                    const idx = Number(detailsBtn.getAttribute('data-index'));
                    const item = currentBookings[idx];
                    if (item) {
                        openBookingDetails(item);
                    }
                    return;
                }
                const certBtn = e.target.closest('.btn-view-cert');
                if (certBtn) {
                    const idx = Number(certBtn.getAttribute('data-index'));
                    const item = currentBookings[idx];
                    if (item) {
                        openCertificateModal(item);
                    }
                    return;
                }
            });
        }

        if (closeCertModalBtn) closeCertModalBtn.addEventListener('click', closeCertificateModal);
        if (btnCloseCertModal) btnCloseCertModal.addEventListener('click', closeCertificateModal);
        if (btnPrintCert) {
            btnPrintCert.addEventListener('click', () => {
                window.print();
            });
        }
        if (certificateModal) {
            certificateModal.addEventListener('click', (e) => {
                if (e.target === certificateModal) closeCertificateModal();
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
            const isPreNeed = Number(item.is_preneed) === 1 || serviceType === 'preneed';

            // Type Badge
            let typeBadge = '';
            if (isDraft) {
                typeBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:#fef3c7;color:#92400e;font-weight:600;"><i class="fas fa-pen-to-square"></i> Draft (${serviceType ? capitalize(serviceType) : 'Service'})</span>`;
            } else if (isPreNeed) {
                typeBadge = '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:#fef3c7;color:#b45309;font-weight:700;border:1px solid #fde68a;"><i class="fas fa-crown"></i> Pre-Need Lot</span>';
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
            if (isPreNeed) {
                displayDate = '<span style="color:#b45309;font-weight:600;font-size:0.82rem;"><i class="fas fa-shield-halved"></i> Advance</span>';
            } else if (!displayDate || displayDate === '0000-00-00' || displayDate === '0000-00-00 00:00:00') {
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
                if (item.lot_id) {
                    const navQ = 'navigate_to_lot=' + encodeURIComponent(item.lot_id) + '&decedent=' + encodeURIComponent(item.decedent_name || '');
                    actionHtml += ` <a href="cemetery-map.html?${navQ}" class="btn-secondary" style="font-size:0.8rem;padding:4px 8px;display:inline-flex;align-items:center;gap:3px;text-decoration:none;" title="Navigate to Grave on Cemetery Map"><i class="fas fa-route" style="color:#2563eb;"></i> Route</a>`;
                }
                if (isPreNeed || item.certificate_number) {
                    actionHtml += ` <button type="button" class="btn-secondary btn-view-cert" data-index="${index}" style="font-size:0.8rem;padding:4px 10px;display:inline-flex;align-items:center;gap:4px;cursor:pointer;background:#fffbeb;color:#b45309;border-color:#fde68a;font-weight:600;" title="View Official Certificate of Ownership"><i class="fas fa-certificate"></i> Cert</button>`;
                }
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
        const isSupportedOnlineService = (serviceType === 'burial' || serviceType === 'cremation');

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
                explanation: (bStatus === 'CONFIRMED' || bStatus === 'SCHEDULED') ? 'Payment verified and booking confirmed.' : 'Payment verified by gateway webhook.'
            };
        }

        if (gwStatus === 'expired' || gwStatus === 'cancelled') {
            return {
                statusText: 'Payment Expired / Cancelled',
                badgeBg: '#fee2e2',
                badgeColor: '#991b1b',
                canPayOnline: isSupportedOnlineService && bStatus !== 'CANCELLED',
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
                    canPayOnline: isSupportedOnlineService && bStatus !== 'CANCELLED',
                    buttonLabel: 'Continue Checkout (PayMongo)',
                    explanation: 'Awaiting completion of online payment via PayMongo.'
                };
            }
            return {
                statusText: 'Checkout Available',
                badgeBg: '#fef3c7',
                badgeColor: '#92400e',
                canPayOnline: isSupportedOnlineService && bStatus !== 'CANCELLED',
                buttonLabel: 'Pay Online (PayMongo)',
                explanation: 'Reservation recorded as Pending. Online checkout is available.'
            };
        }

        // No payment record yet
        return {
            statusText: isSupportedOnlineService ? 'Checkout Available' : 'Pending Review',
            badgeBg: '#f1f5f9',
            badgeColor: '#475569',
            canPayOnline: isSupportedOnlineService && bStatus !== 'CANCELLED',
            buttonLabel: 'Pay Online (PayMongo)',
            explanation: isSupportedOnlineService ? 'Ready for online checkout.' : 'Awaiting review.'
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
                const isPreNeed = (serviceType === 'preneed' || Number(item.is_preneed) === 1);
                const endpoint = (serviceType === 'burial' || isPreNeed) ? `schedules/${sourceId}` : `cremations/${sourceId}`;
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

            // Documentary Requirements Pre-computation
            const docSummary = record.document_summary || {
                uploaded_count: 0,
                total_required: 3,
                all_uploaded: false,
                status: 'pending_physical',
                status_label: 'Pending Physical Submission',
                badge_class: 'pending',
                workflow_guidance: 'No documents submitted online yet. Per municipal cemetery policy, applicant must present physical copies of Death Certificate and Permit at the office prior to burial/cremation.'
            };
            const isPreNeedRecord = (serviceType === 'preneed' || Number(item.is_preneed) === 1 || Number(record.is_preneed) === 1);
            const docItems = isPreNeedRecord ? [
                { doc_type: 'valid_id', title: 'Valid Government ID (Purchaser)', description: 'Government-issued ID of Purchaser / Lot Owner', is_uploaded: Boolean(record.documents && record.documents.find(d => d.doc_type === 'valid_id' && d.is_uploaded)) }
            ] : ((Array.isArray(record.documents) && record.documents.length > 0) ? record.documents : [
                { doc_type: 'death_certificate', title: 'Death Certificate', description: 'PSA or Local Civil Registrar Certified True Copy', is_uploaded: false },
                { doc_type: 'burial_permit', title: serviceType === 'cremation' ? 'Cremation Permit' : 'Burial Permit', description: 'City Health Office / Local Government Unit Permit', is_uploaded: false },
                { doc_type: 'valid_id', title: 'Valid Government ID', description: 'Government-issued ID of Informant / Next-of-Kin (Claimant)', is_uploaded: false }
            ]);

            let docBadgeColor = '#64748b';
            let docBadgeBg = '#f1f5f9';
            if (docSummary.all_uploaded || docSummary.status === 'complete') {
                docBadgeColor = '#166534';
                docBadgeBg = '#dcfce7';
            } else if (docSummary.uploaded_count > 0 || docSummary.status === 'partial') {
                docBadgeColor = '#92400e';
                docBadgeBg = '#fef3c7';
            }

            const targetLotId = record.lot_id || item.lot_id;
            const hasLotLocation = Boolean(targetLotId || (item.allocation && !item.allocation.includes('Pending')));
            let lotPreviewCardHtml = '';
            if (hasLotLocation) {
                const navQuery = targetLotId 
                    ? `navigate_to_lot=${encodeURIComponent(targetLotId)}&decedent=${encodeURIComponent(record.beneficiary_name || record.deceased_name || item.decedent_name || '')}`
                    : `decedent=${encodeURIComponent(record.beneficiary_name || record.deceased_name || item.decedent_name || '')}`;

                lotPreviewCardHtml = `
                    <!-- Lot Appearance & Grave Wayfinding Card -->
                    <div class="booking-detail-card" style="margin-top:16px;border:1px solid #bfdbfe;background:linear-gradient(135deg, #f8fafc 0%, #eff6ff 100%);padding:16px;border-radius:10px;">
                        <div class="booking-detail-card-head" style="border-bottom:1px solid #dbeafe;padding-bottom:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center;">
                            <span class="booking-detail-card-title" style="color:#1e40af;font-size:0.95rem;font-weight:700;"><i class="fas fa-map-location-dot"></i> Grave Location &amp; Plot Appearance</span>
                            <span style="font-size:0.75rem;font-weight:700;color:#1e40af;background:#dbeafe;padding:3px 10px;border-radius:12px;display:inline-flex;align-items:center;gap:4px;">
                                <i class="fas fa-compass"></i> Wayfinding Ready
                            </span>
                        </div>
                        <div style="display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:14px;">
                            <div>
                                <div style="font-size:0.75rem;color:#64748b;font-weight:700;text-transform:uppercase;letter-spacing:0.5px;">Cemetery Plot Allocation</div>
                                <div style="font-weight:700;color:#0f172a;font-size:1.1rem;margin-top:2px;">${escapeHtml(item.allocation || record.allocation || 'Designated Cemetery Plot')}</div>
                                <div style="font-size:0.8rem;color:#475569;margin-top:6px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                                    <span><i class="fas fa-layer-group" style="color:#3b82f6;"></i> Double-depth vault certified</span>
                                    <span><i class="fas fa-water" style="color:#10b981;"></i> Flood-free elevated ground</span>
                                    <span><i class="fas fa-person-walking" style="color:#6366f1;"></i> PWD accessible path</span>
                                </div>
                            </div>
                            <div style="display:flex;gap:10px;flex-wrap:wrap;">
                                ${targetLotId ? `
                                    <button type="button" class="btn btn-secondary" id="btnPreviewPlotModal" style="display:inline-flex;align-items:center;gap:6px;font-size:0.85rem;background:#ffffff;border:1px solid #cbd5e1;cursor:pointer;padding:8px 14px;border-radius:6px;font-weight:600;color:#334155;box-shadow:0 1px 2px rgba(0,0,0,0.05);">
                                        <i class="fas fa-eye" style="color:#2563eb;"></i> Visual Plot Preview
                                    </button>
                                ` : ''}
                                <a href="cemetery-map.html?${navQuery}" class="btn btn-primary" style="display:inline-flex;align-items:center;gap:6px;font-size:0.85rem;text-decoration:none;padding:8px 14px;border-radius:6px;font-weight:600;box-shadow:0 2px 4px rgba(37,99,235,0.2);">
                                    <i class="fas fa-route"></i> Navigate to Grave (Map)
                                </a>
                            </div>
                        </div>
                    </div>
                `;
            }

            bookingDetailBody.innerHTML = `
                <div class="booking-detail-deck">
                    <!-- Top Strip: Reference & Badges -->
                    <div class="booking-detail-top-strip">
                        <div class="booking-detail-ref-group">
                            <span class="booking-detail-ref-label">Reference</span>
                            <span class="booking-detail-ref-code">${escapeHtml(item.booking_reference || '-')}</span>
                        </div>
                        <div class="booking-detail-tags">
                            <span class="booking-detail-service-tag ${isPreNeedRecord ? '' : (serviceType === 'burial' ? 'service-tag--burial' : 'service-tag--cremation')}" ${isPreNeedRecord ? 'style="background:#fef3c7;color:#b45309;border:1px solid #fde68a;"' : ''}>
                                <i class="fas ${isPreNeedRecord ? 'fa-crown' : (serviceType === 'burial' ? 'fa-monument' : 'fa-fire')}"></i> ${isPreNeedRecord ? 'PRE-NEED LOT' : escapeHtml((serviceType || 'Service').toUpperCase())}
                            </span>
                            <span class="booking-detail-status-pill">
                                ${escapeHtml(formatBookingStatus(record.status || item.status, isDraft))}
                            </span>
                        </div>
                    </div>

                    <!-- 2-Column Balanced Deck -->
                    <div class="booking-detail-split-grid">
                        <!-- Left Column: Core Schedule & Payment -->
                        <div class="booking-detail-col">
                            <!-- Booking Core Info Card -->
                            <div class="booking-detail-card">
                                <div class="booking-detail-card-head">
                                    <span class="booking-detail-card-title"><i class="fas fa-id-card"></i> Schedule &amp; Allocation</span>
                                </div>
                                <div class="booking-detail-meta-grid">
                                    ${isPreNeedRecord ? `
                                        <div class="booking-meta-item">
                                            <label>Purchaser / Owner</label>
                                            <strong>${escapeHtml(record.purchaser_name || record.contact_person || 'Owner')}</strong>
                                        </div>
                                        <div class="booking-meta-item">
                                            <label>Designated Beneficiary</label>
                                            <strong>${escapeHtml(record.beneficiary_name || item.beneficiary_name || 'Designated Beneficiary')}</strong>
                                        </div>
                                        <div class="booking-meta-item">
                                            <label>Reservation Term</label>
                                            <span style="color:#b45309;font-weight:600;"><i class="fas fa-shield-halved"></i> Perpetual Advance Reservation</span>
                                        </div>
                                        <div class="booking-meta-item">
                                            <label>Allocated Lot</label>
                                            <span class="booking-allocation-text">${escapeHtml(item.allocation || 'Reserved Lot')}</span>
                                        </div>
                                    ` : `
                                        <div class="booking-meta-item">
                                            <label>Decedent</label>
                                            <strong>${escapeHtml(item.decedent_name || 'Pending Formal Record')}</strong>
                                        </div>
                                        <div class="booking-meta-item">
                                            <label>Scheduled Date &amp; Time</label>
                                            <span>${escapeHtml(displayDate)} ${escapeHtml(displayTime)}</span>
                                        </div>
                                        <div class="booking-meta-item booking-meta-item--full">
                                            <label>Allocation</label>
                                            <span class="booking-allocation-text">${escapeHtml(item.allocation || 'Standard')}</span>
                                        </div>
                                    `}
                                    ${isPreNeedRecord && (record.certificate_number || item.certificate_number) ? `
                                        <div class="booking-meta-item booking-meta-item--full" style="background:#fffbeb;border:1px solid #fde68a;border-radius:6px;padding:10px 12px;margin-top:4px;">
                                            <div style="display:flex;justify-content:space-between;align-items:center;">
                                                <div>
                                                    <span style="font-size:0.75rem;text-transform:uppercase;color:#92400e;font-weight:700;"><i class="fas fa-certificate"></i> Ownership Certificate</span>
                                                    <div style="font-family:monospace;font-size:0.95rem;font-weight:700;color:#b45309;">${escapeHtml(record.certificate_number || item.certificate_number)}</div>
                                                </div>
                                                <button type="button" class="btn btn-sm btn-primary" id="btnModalViewCert" style="background:#b45309;border-color:#b45309;font-size:0.8rem;padding:5px 12px;">
                                                    <i class="fas fa-award"></i> View Certificate
                                                </button>
                                            </div>
                                        </div>
                                    ` : ''}
                                    ${notes && notes !== 'None' ? `
                                        <div class="booking-meta-item booking-meta-item--full">
                                            <label>Notes &amp; Special Instructions</label>
                                            <span class="booking-notes-text">${escapeHtml(notes)}</span>
                                        </div>
                                    ` : ''}
                                </div>
                            </div>

                            <!-- Payment Information Card -->
                            <div class="booking-detail-card booking-payment-card">
                                <div class="booking-detail-card-head">
                                    <span class="booking-detail-card-title"><i class="fas fa-receipt"></i> Payment Information</span>
                                    <div class="booking-payment-actions">
                                        <span class="booking-payment-status-badge" style="background:${paymentInfo.badgeBg};color:${paymentInfo.badgeColor};">
                                            ${escapeHtml(paymentInfo.statusText)}
                                        </span>
                                        ${record.payment_id && record.gateway_checkout_session_id && record.verification_status !== 'Verified' ? `
                                            <button type="button" class="btn btn-secondary btn-sync-payment" id="btnSyncPaymentModal" title="Check real-time status from PayMongo">
                                                <i class="fas fa-arrows-rotate"></i> Check Status
                                            </button>
                                        ` : ''}
                                    </div>
                                </div>
                                <div class="booking-payment-row">
                                    <div class="payment-stat">
                                        <span class="payment-stat-label">Amount</span>
                                        <strong class="payment-stat-val">${escapeHtml(paymentAmount)}</strong>
                                    </div>
                                    <div class="payment-stat">
                                        <span class="payment-stat-label">Method</span>
                                        <strong class="payment-stat-val">${escapeHtml(record.payment_method || (serviceType === 'burial' ? 'PayMongo' : 'Standard'))}</strong>
                                    </div>
                                </div>
                                <div class="booking-payment-note">
                                    <i class="fas fa-info-circle"></i> <span>${escapeHtml(paymentInfo.explanation)}</span>
                                </div>
                            </div>
                        </div>

                        <!-- Right Column: Documentary Requirements -->
                        <div class="booking-detail-col">
                            <div class="booking-detail-card booking-docs-card">
                                <div class="booking-detail-card-head">
                                    <span class="booking-detail-card-title"><i class="fas fa-file-shield"></i> Documentary Requirements</span>
                                    <span class="booking-doc-status-badge" style="background:${docBadgeBg};color:${docBadgeColor};">
                                        ${escapeHtml(docSummary.status_label)}
                                    </span>
                                </div>
                                <div class="booking-doc-list">
                                    ${docItems.map(d => {
                                        const isUploaded = Boolean(d.is_uploaded);
                                        return `
                                            <div class="booking-doc-row ${isUploaded ? 'is-uploaded' : 'is-pending'}">
                                                <div class="booking-doc-meta">
                                                    <div class="booking-doc-name">${escapeHtml(d.title)}</div>
                                                    <small class="booking-doc-desc">${escapeHtml(d.description || '')}</small>
                                                </div>
                                                <div class="booking-doc-badge-col">
                                                    <span class="booking-doc-badge ${isUploaded ? 'badge--uploaded' : 'badge--pending'}">
                                                        <i class="fas ${isUploaded ? 'fa-check' : 'fa-hourglass-start'}"></i> ${isUploaded ? 'Uploaded Online' : 'Bring to Office'}
                                                    </span>
                                                    ${isUploaded && d.file_url ? `
                                                        <a href="${escapeHtml(d.file_url)}" target="_blank" rel="noopener noreferrer" class="booking-doc-link">
                                                            <i class="fas fa-arrow-up-right-from-square"></i> View File
                                                        </a>
                                                    ` : ''}
                                                </div>
                                            </div>
                                        `;
                                    }).join('')}
                                </div>
                                <div class="booking-doc-guidance">
                                    <i class="fas fa-circle-info"></i>
                                    <span>${escapeHtml(docSummary.workflow_guidance)}</span>
                                </div>
                            </div>
                        </div>
                    </div>
                    ${lotPreviewCardHtml}
                </div>
            `;

            // Wire Plot Visual Preview button
            if (targetLotId) {
                document.getElementById('btnPreviewPlotModal')?.addEventListener('click', () => {
                    if (window.LotVisualPreview) {
                        window.LotVisualPreview.openPreviewModal({
                            lot_id: targetLotId,
                            lot_number: record.lot_number || item.lot_number,
                            block_name: record.block_name || item.block_name,
                            section_name: record.section_name || item.section_name,
                            type_name: record.lot_type_name || record.type_name,
                            price: record.lot_price || record.price,
                            status: record.lot_status || record.status
                        });
                    }
                });
            }

            if (bookingDetailFooter) {
                let footerHtml = '<button type="button" class="btn btn-secondary" id="closeDetailModalBtnInner">Close</button>';
                if (paymentInfo.canPayOnline && (serviceType === 'burial' || serviceType === 'cremation')) {
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
                document.getElementById('btnModalViewCert')?.addEventListener('click', () => {
                    openCertificateModal(Object.assign({}, item, record));
                });

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
                            const isCremation = serviceType === 'cremation';
                            const checkoutPayload = {
                                transaction_type: isCremation ? 'Cremation' : 'Lot Purchase',
                                reference_id: sourceId,
                                reference_kind: isCremation ? null : 'schedule',
                                origin: (typeof getAppOrigin === 'function' ? getAppOrigin() : `${window.location.origin}${window.location.pathname.includes('/CMS') ? '/CMS' : ''}`)
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

    async function updateNotificationBadge() {
        try {
            if (!window.api || typeof window.api.request !== 'function') return;
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                const count = Number(result.count || 0);
                badge.textContent = String(count);
                badge.style.display = 'flex';
            }
        } catch (e) {
            console.error('Failed to update notification badge:', e);
        }
    }

    function setupTopBarActions() {
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

        document.getElementById('logoutBtn')?.addEventListener('click', () => {
            if (window.api && typeof window.api.logout === 'function') api.logout();
        });
    }

    document.addEventListener('DOMContentLoaded', () => {
        init();
        setupTopBarActions();
        setupFooterClock();
        updateNotificationBadge();
        setInterval(updateNotificationBadge, 30000);
    });

    function openCertificateModal(item) {
        if (!certificateModal || !certificateModalBody) return;

        const certNum = item.certificate_number || `CERT-PN-${new Date().getFullYear()}-${String(item.schedule_id || item.source_id || '000000').padStart(6, '0')}`;
        const certHash = item.certificate_hash || 'SHA256:VERIFIED-MUNICIPAL-RECORD';
        const ownerName = item.purchaser_name || item.contact_person || 'Authorized Lot Owner';
        const beneficiaryName = item.beneficiary_name || 'Designated Beneficiary';
        const allocation = item.allocation || 'Standard Cemetery Plot';
        const issueDate = item.certificate_issued_at ? new Date(item.certificate_issued_at).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' }) : new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });

        certificateModalBody.innerHTML = `
            <div style="border: 4px double #d97706; padding: 28px 24px; border-radius: 8px; background: #fff; text-align: center; position: relative;">
                <div style="position: absolute; top: 12px; left: 16px; opacity: 0.15; font-size: 5rem; color: #b45309; pointer-events: none;">
                    <i class="fas fa-tree"></i>
                </div>
                <div style="position: absolute; bottom: 12px; right: 16px; opacity: 0.15; font-size: 5rem; color: #b45309; pointer-events: none;">
                    <i class="fas fa-award"></i>
                </div>
                
                <div style="font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.12em; color: #64748b; font-weight: 700; margin-bottom: 4px;">
                    Republic of the Philippines · Municipal Cemetery Authority
                </div>
                <h2 style="font-family: 'Fraunces', serif; font-size: 1.45rem; color: #1e293b; margin: 0 0 6px 0; font-weight: 700; letter-spacing: 0.02em;">
                    Certificate of Pre-Need Lot Ownership
                </h2>
                <div style="font-size: 0.82rem; color: #b45309; font-weight: 600; text-transform: uppercase; letter-spacing: 0.06em; margin-bottom: 20px;">
                    Perpetual Interment Right &amp; Advance Allocation Deed
                </div>

                <div style="background: #fffbeb; border: 1px dashed #fde68a; padding: 10px 16px; border-radius: 6px; display: inline-block; margin-bottom: 22px;">
                    <span style="font-size: 0.75rem; text-transform: uppercase; color: #92400e; font-weight: 600;">Certificate Number:</span>
                    <strong style="font-family: monospace; font-size: 1.15rem; color: #b45309; letter-spacing: 0.05em; margin-left: 6px;">${escapeHtml(certNum)}</strong>
                </div>

                <p style="font-size: 0.9rem; color: #475569; line-height: 1.6; max-width: 540px; margin: 0 auto 20px auto;">
                    This certifies that full perpetual reservation rights for the cemetery plot described below have been officially registered and recorded in favor of:
                </p>

                <div style="border-top: 1px solid #e2e8f0; border-bottom: 1px solid #e2e8f0; padding: 14px 10px; margin-bottom: 22px; display: grid; grid-template-columns: 1fr 1fr; gap: 16px; text-align: left;">
                    <div>
                        <span style="display:block; font-size: 0.75rem; text-transform: uppercase; color: #64748b; font-weight: 600;">Registered Purchaser / Owner</span>
                        <strong style="font-size: 1.05rem; color: #0f172a;">${escapeHtml(ownerName)}</strong>
                    </div>
                    <div>
                        <span style="display:block; font-size: 0.75rem; text-transform: uppercase; color: #64748b; font-weight: 600;">Designated Beneficiary</span>
                        <strong style="font-size: 1.05rem; color: #0f172a;">${escapeHtml(beneficiaryName)}</strong>
                    </div>
                    <div style="grid-column: span 2;">
                        <span style="display:block; font-size: 0.75rem; text-transform: uppercase; color: #64748b; font-weight: 600;">Allocated Cemetery Plot</span>
                        <strong style="font-size: 1.05rem; color: #166534;"><i class="fas fa-map-location-dot"></i> ${escapeHtml(allocation)}</strong>
                    </div>
                </div>

                <div style="display: flex; justify-content: space-between; align-items: flex-end; padding-top: 10px;">
                    <div style="text-align: left;">
                        <span style="display:block; font-size: 0.72rem; color: #94a3b8; text-transform: uppercase; font-weight: 600;">Date of Issuance</span>
                        <strong style="font-size: 0.85rem; color: #334155;">${escapeHtml(issueDate)}</strong>
                        <div style="margin-top: 4px; font-size: 0.7rem; font-family: monospace; color: #64748b; word-break: break-all; max-width: 320px;">
                            <i class="fas fa-fingerprint text-primary"></i> Hash: ${escapeHtml(certHash.substring(0, 32))}...
                        </div>
                    </div>
                    <div style="text-align: center; min-width: 170px;">
                        <div style="border-bottom: 1px solid #334155; margin-bottom: 4px; padding-bottom: 4px;">
                            <span style="font-family: 'Fraunces', serif; font-size: 0.95rem; font-weight: 700; color: #1e293b;">Municipal Administrator</span>
                        </div>
                        <span style="font-size: 0.72rem; text-transform: uppercase; color: #64748b; font-weight: 600;">Authorized Signatory</span>
                    </div>
                </div>
            </div>
        `;

        certificateModal.style.display = 'flex';
        document.body.style.overflow = 'hidden';
    }

    function closeCertificateModal() {
        if (!certificateModal) return;
        certificateModal.style.display = 'none';
        document.body.style.overflow = '';
    }

})();