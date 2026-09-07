/**
 * My Unified Bookings Controller
 */
(function() {
    const bookingsTableBody = document.getElementById('bookingsTableBody');
    const activeDraftsBanner = document.getElementById('activeDraftsBanner');
    const activeDraftsText = document.getElementById('activeDraftsText');
    const btnResumeDraft = document.getElementById('btnResumeDraft');

    async function init() {
        await Promise.all([
            checkActiveDrafts(),
            loadAllBookings()
        ]);
    }

    async function checkActiveDrafts() {
        try {
            const res = await ApiClient.get('/booking-agent/draft');
            if (res && res.success && res.draft) {
                const draft = res.draft;
                activeDraftsBanner.style.display = 'block';
                const decName = draft.extracted_data && draft.extracted_data.decedent_name ? ` for "${draft.extracted_data.decedent_name}"` : '';
                activeDraftsText.textContent = `You have an uncompleted ${draft.service_type} booking${decName}. You can continue right where you left off.`;
                btnResumeDraft.href = `booking-assistant.html?service=${draft.service_type}`;
            }
        } catch (e) {
            console.error('Error checking active drafts:', e);
        }
    }

    async function loadAllBookings() {
        try {
            // Load both schedules and cremations concurrently
            const [schedRes, cremRes] = await Promise.all([
                ApiClient.get('/schedules/mine').catch(() => []),
                ApiClient.get('/cremations/mine').catch(() => [])
            ]);

            const schedules = Array.isArray(schedRes) ? schedRes : (schedRes.data || []);
            const cremations = Array.isArray(cremRes) ? cremRes : (cremRes.data || []);

            const combined = [];

            schedules.forEach(s => {
                combined.push({
                    type: 'Burial',
                    id: s.schedule_id,
                    ref: `SCH-${s.schedule_id}`,
                    decedent: s.first_name ? `${s.first_name} ${s.last_name}` : (s.provisional_name || 'Pending Formal Record'),
                    date: s.schedule_date || 'TBD',
                    allocation: `Lot #${s.lot_number || s.lot_id} (${s.lot_type_name || 'Standard'})`,
                    status: s.status || 'Pending',
                    viewUrl: `my-reservations.html`
                });
            });

            cremations.forEach(c => {
                combined.push({
                    type: 'Cremation',
                    id: c.cremation_id,
                    ref: `CREM-${c.cremation_id}`,
                    decedent: c.first_name ? `${c.first_name} ${c.last_name}` : (c.provisional_name || 'Pending Formal Record'),
                    date: c.cremation_date || 'TBD',
                    allocation: c.niche_number ? `Niche #${c.niche_number} (${c.columbarium || 'Main'})` : (c.columbarium ? `${c.columbarium} (Pending Niche)` : 'Auto-assign at completion'),
                    status: c.status || 'Pending',
                    viewUrl: `my-cremations.html`
                });
            });

            // Sort newest first
            combined.sort((a, b) => b.id - a.id);

            renderBookingsTable(combined);
        } catch (err) {
            bookingsTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:20px;color:#ef4444;">Failed to load bookings: ${err.message}</td></tr>`;
        }
    }

    function renderBookingsTable(items) {
        if (!items || items.length === 0) {
            bookingsTableBody.innerHTML = `<tr><td colspan="7" style="text-align:center;padding:32px;color:#64748b;">No reservations found yet. Use <a href="book-a-service.html">Book a Service</a> to arrange a burial or cremation.</td></tr>`;
            return;
        }

        bookingsTableBody.innerHTML = '';
        items.forEach(item => {
            const tr = document.createElement('tr');
            tr.style.borderBottom = '1px solid #f1f5f9';

            let badgeColor = '#64748b';
            let badgeBg = '#f1f5f9';
            if (item.status === 'Confirmed' || item.status === 'Scheduled' || item.status === 'Completed') {
                badgeColor = '#059669';
                badgeBg = '#d1fae5';
            } else if (item.status === 'Pending') {
                badgeColor = '#d97706';
                badgeBg = '#fef3c7';
            } else if (item.status === 'Cancelled') {
                badgeColor = '#dc2626';
                badgeBg = '#fee2e2';
            }

            tr.innerHTML = `
                <td style="padding:12px 8px;font-weight:600;"><span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:#e0f2fe;color:#0369a1;">${item.type}</span></td>
                <td style="padding:12px 8px;font-family:monospace;font-size:0.85rem;">${item.ref}</td>
                <td style="padding:12px 8px;font-weight:500;">${item.decedent}</td>
                <td style="padding:12px 8px;">${item.date}</td>
                <td style="padding:12px 8px;font-size:0.85rem;color:#475569;">${item.allocation}</td>
                <td style="padding:12px 8px;"><span style="display:inline-block;padding:3px 8px;border-radius:4px;font-size:0.75rem;background:${badgeBg};color:${badgeColor};font-weight:600;">${item.status}</span></td>
                <td style="padding:12px 8px;">
                    <a href="${item.viewUrl}" class="btn-secondary" style="font-size:0.8rem;padding:4px 8px;text-decoration:none;">View Details</a>
                </td>
            `;
            bookingsTableBody.appendChild(tr);
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
