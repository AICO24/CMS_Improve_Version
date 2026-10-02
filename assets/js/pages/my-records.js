// Privacy audit (2026-09-04): this page used to fetch the full cemetery-wide
// decedent list (redacted for non-staff fields) and offer Add/Edit/Delete
// actions that only ever 403'd for a citizen anyway (DecedentController's
// store()/update()/destroy() have always been admin/staff-only). Now a
// genuine read-only "my records" view: GET /decedents and /decedents/stats
// are scoped server-side to decedents connected to this citizen's own
// bookings/requests (see DecedentController::index()/stats()), with FULL
// field detail for those (no more redaction — it's their own family).
document.addEventListener('DOMContentLoaded', async function() {
    const session = await requireRole(['user']);
    if (!session) return;

    const searchInput = document.getElementById('searchInput');
    const tableBody = document.getElementById('tableBody');
    const viewModal = document.getElementById('viewModal');
    const viewDetails = document.getElementById('viewDetails');

    let records = [];
    let currentQuery = '';

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

    document.querySelector('.close-view').addEventListener('click', () => viewModal.style.display = 'none');
    window.addEventListener('click', (e) => {
        if (e.target === viewModal) viewModal.style.display = 'none';
    });
    searchInput.addEventListener('input', () => {
        currentQuery = searchInput.value.trim();
        loadRecords();
    });

    await refreshPage();

    async function refreshPage() {
        try {
            await loadRecords();
            await loadStats();
        } catch (error) {
            console.error('Failed to initialize page', error);
            tableBody.innerHTML = '<tr><td colspan="7">Could not load records. Please refresh.</td></tr>';
        }
    }

    async function loadRecords() {
        const query = currentQuery ? `?q=${encodeURIComponent(currentQuery)}` : '';
        records = await api.request(`decedents${query}`, { method: 'GET' });
        renderTable(records);
    }

    async function loadStats() {
        const stats = await api.request('decedents/stats', { method: 'GET' });
        document.getElementById('totalCount').innerText = stats.total || 0;
        document.getElementById('burialCount').innerText = stats.burials || 0;
        document.getElementById('cremationCount').innerText = stats.cremations || 0;
        document.getElementById('avgAge').innerText = stats.avg_age || 0;
    }

    function renderTable(items) {
        if (!items || items.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding: 24px; color:#64748b;">No records found.</td></tr>';
            return;
        }

        tableBody.innerHTML = items.map((item) => {
            const isPending = (item.document_status === 'pending_requirements');
            const statusBadge = isPending
                ? `<span class="status-badge" style="background:#fef3c7; color:#b45309; border: 1px solid #fde68a; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;"><i class="fas fa-clock"></i> To Follow</span>`
                : `<span class="status-badge" style="background:#d1fae5; color:#065f46; border: 1px solid #a7f3d0; padding: 3px 8px; border-radius: 12px; font-size: 11px; font-weight: 600;"><i class="fas fa-check-circle"></i> Verified</span>`;

            // Determine Allocation / Niche and Section / Facility
            let allocHtml = '—';
            let sectionHtml = '—';

            const hasNiche = !!item.niche_number;
            const isCremated = (item.is_cremated === 'yes' || hasNiche || !!item.ash_storage_location);

            if (hasNiche) {
                const lvlText = item.level ? `<span class="niche-lvl" title="Level ${escapeHtml(item.level)}">L${escapeHtml(item.level)}</span>` : '';
                allocHtml = `<span class="niche-pill" title="Columbarium Niche: ${escapeHtml(item.niche_number)}${item.level ? ' (Level ' + escapeHtml(item.level) + ')' : ''}"><i class="fas fa-monument"></i> <span>Niche ${escapeHtml(item.niche_number)}</span> ${lvlText}</span>`;
                sectionHtml = escapeHtml(item.columbarium || item.section_name || 'Everlasting Columbarium & Ossuary');
            } else if (isCremated) {
                const ashLoc = (item.ash_storage_location || item.ash_storage || '').toLowerCase();
                if (ashLoc.includes('take home') || ashLoc.includes('custody') || !item.lot_number) {
                    allocHtml = `<span class="takehome-pill" title="Take Home / Family Custody"><i class="fas fa-house-user"></i> <span>Take Home</span></span>`;
                    sectionHtml = `Family Custody`;
                } else {
                    allocHtml = `<span class="takehome-pill" title="${escapeHtml(item.ash_storage_location || item.ash_storage)}"><i class="fas fa-fire"></i> <span>${escapeHtml(item.ash_storage_location || item.ash_storage)}</span></span>`;
                    sectionHtml = escapeHtml(item.columbarium || item.section_name || 'Columbarium');
                }
            } else if (item.lot_number) {
                allocHtml = `<span class="lot-pill" title="Lot ${escapeHtml(item.lot_number)}"><i class="fas fa-layer-group"></i> <span>${escapeHtml(item.lot_number)}</span></span>`;
                sectionHtml = escapeHtml(item.section_name || '—');
            }

            return `
            <tr data-id="${item.decedent_id}">
                <td style="font-weight: 600; color: #1e293b;">D-${item.decedent_id}</td>
                <td style="font-weight: 600;">${escapeHtml(`${item.first_name} ${item.last_name}${item.suffix ? ' ' + item.suffix : ''}`)}</td>
                <td>${item.dob ? escapeHtml(item.dob) : '<span style="color:#888; font-style: italic;">To follow</span>'}</td>
                <td>${escapeHtml(item.dod)}</td>
                <td>${allocHtml}</td>
                <td>${sectionHtml}</td>
                <td style="text-align: center;">${statusBadge}</td>
                <td class="action-buttons">
                    <button class="btn-view" title="View details"><i class="fas fa-eye"></i></button>
                </td>
            </tr>
        `;
        }).join('');

        attachTableButtons();
    }

    function attachTableButtons() {
        document.querySelectorAll('.btn-view').forEach((btn) => {
            btn.addEventListener('click', () => {
                const row = btn.closest('tr');
                const id = parseInt(row.dataset.id, 10);
                openViewModal(id);
            });
        });
    }

    function openViewModal(id) {
        const record = records.find((item) => item.decedent_id === id);
        if (!record) {
            return;
        }

        const isPending = (record.document_status === 'pending_requirements');
        const complianceAlert = isPending ? `
            <div style="background: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 12px; margin-bottom: 16px; display: flex; gap: 10px; align-items: flex-start;">
                <i class="fas fa-circle-info" style="color: #d97706; font-size: 16px; margin-top: 2px;"></i>
                <div style="font-size: 12.5px; color: #92400e; line-height: 1.4;">
                    <strong>Requirements to follow:</strong> The official Death Certificate or Burial Permit for this record is currently pending staff verification. Please present or upload your documents before the scheduled service.
                </div>
            </div>
        ` : '';

        const hasNiche = !!record.niche_number;
        const isCremated = (record.is_cremated === 'yes' || hasNiche || !!record.ash_storage_location);

        let serviceRow = '';
        let allocationRows = '';

        if (hasNiche) {
            serviceRow = `<div class="detail-row"><span>Service Type</span><strong><span style="color:#059669; font-weight:700;"><i class="fas fa-fire"></i> Cremation & Inurnment</span></strong></div>`;
            allocationRows = `
                <div class="detail-row"><span>Columbarium</span><strong>${escapeHtml(record.columbarium || record.section_name || 'Everlasting Columbarium & Ossuary')}</strong></div>
                <div class="detail-row"><span>Niche Number</span><strong><span class="niche-pill"><i class="fas fa-monument"></i> Niche ${escapeHtml(record.niche_number)}</span></strong></div>
                <div class="detail-row"><span>Niche Level</span><strong>Level ${escapeHtml(record.level || '1')}</strong></div>
                <div class="detail-row"><span>Storage Details</span><strong>${escapeHtml(record.ash_storage_location || 'Columbarium Niche')}</strong></div>
            `;
        } else if (isCremated) {
            const ashDisp = record.ash_storage_location || record.ash_storage || 'Take Home / Family Custody';
            serviceRow = `<div class="detail-row"><span>Service Type</span><strong><span style="color:#2563eb; font-weight:700;"><i class="fas fa-fire"></i> Cremation (Take Home)</span></strong></div>`;
            allocationRows = `
                <div class="detail-row"><span>Ash Disposition</span><strong>${escapeHtml(ashDisp)}</strong></div>
                <div class="detail-row"><span>Placement</span><strong>Family Custody</strong></div>
            `;
        } else {
            serviceRow = `<div class="detail-row"><span>Service Type</span><strong><i class="fas fa-monument"></i> Traditional Ground Burial</strong></div>`;
            allocationRows = `
                <div class="detail-row"><span>Lot Number</span><strong>${escapeHtml(record.lot_number || '—')}</strong></div>
                <div class="detail-row"><span>Section</span><strong>${escapeHtml(record.section_name || '—')}</strong></div>
            `;
        }

        const details = `
            ${complianceAlert}
            <div class="detail-row"><span>Status</span><strong>${isPending ? '<span style="color: #b45309;">🟡 Pending Requirements (To Follow)</span>' : '<span style="color: #065f46;">🟢 Verified</span>'}</strong></div>
            <div class="detail-row"><span>Full Name</span><strong>${escapeHtml(record.first_name)} ${escapeHtml(record.last_name)}${record.suffix ? ' ' + escapeHtml(record.suffix) : ''}</strong></div>
            <div class="detail-row"><span>Date of Birth</span><strong>${record.dob ? escapeHtml(record.dob) : '<span style="color:#888; font-style: italic;">To follow</span>'}</strong></div>
            <div class="detail-row"><span>Date of Death</span><strong>${escapeHtml(record.dod)}</strong></div>
            <div class="detail-row"><span>Cause of Death</span><strong>${escapeHtml(record.cause_of_death || 'To follow')}</strong></div>
            ${serviceRow}
            ${allocationRows}
            <div class="detail-row"><span>Contact Name</span><strong>${escapeHtml(record.contact_name || '—')}</strong></div>
            <div class="detail-row"><span>Contact Number</span><strong>${escapeHtml(record.contact_number || '—')}</strong></div>
        `;
        viewDetails.innerHTML = details;
        document.getElementById('viewModal').style.display = 'flex';
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
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

    setupTopBarActions();
    setupFooterClock();
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
