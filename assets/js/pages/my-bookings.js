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

        if (bookingSearchInput) {
            let debounceTimer;
            bookingSearchInput.addEventListener('input', () => {
                clearTimeout(debounceTimer);
                debounceTimer = setTimeout(() => {
                    loadUnifiedBookings();
                }, 300);
            });
        }

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn && typeof api !== 'undefined' && typeof api.logout === 'function') {
            logoutBtn.addEventListener('click', () => api.logout());
        }
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
            } else if (filterVal) {
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
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #f1f5f9';

            const isDraft = Number(item.is_draft) === 1 || item.source_kind === 'DRAFT';
            const serviceType = (item.service_type || '').toLowerCase();

            // Type Badge
            let typeBadge = '';
            if (isDraft) {
                typeBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:#fef3c7;color:#92400e;font-weight:600;"><i class="fas fa-pen-to-square"></i> Draft (${serviceType ? capitalize(serviceType) : 'Service'})</span>`;
            } else if (serviceType === 'burial') {
                typeBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:#e0f2fe;color:#0369a1;font-weight:600;"><i class="fas fa-monument"></i> Burial</span>`;
            } else if (serviceType === 'cremation') {
                typeBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:#fae8ff;color:#86198f;font-weight:600;"><i class="fas fa-fire"></i> Cremation</span>`;
            } else {
                typeBadge = `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:#f1f5f9;color:#475569;font-weight:600;">${escapeHtml(item.source_kind)}</span>`;
            }

            // Status Badge
            const statusUpper = (item.status || 'PENDING').toUpperCase();
            let badgeColor = '#64748b';
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
            const statusBadge = `<span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:${badgeBg};color:${badgeColor};font-weight:600;">${escapeHtml(item.status || 'Pending')}</span>`;

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
                const viewUrl = serviceType === 'burial' ? 'my-reservations.html' : 'my-cremations.html';
                actionHtml = `<a href="${viewUrl}" class="btn-secondary" style="font-size:0.8rem;padding:4px 10px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;"><i class="fas fa-eye"></i> Details</a>`;
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
