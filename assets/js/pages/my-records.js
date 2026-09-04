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
            tableBody.innerHTML = '<tr><td colspan="7">No records found.</td></tr>';
            return;
        }

        tableBody.innerHTML = items.map((item) => `
            <tr data-id="${item.decedent_id}">
                <td>D-${item.decedent_id}</td>
                <td>${escapeHtml(`${item.first_name} ${item.last_name}${item.suffix ? ' ' + item.suffix : ''}`)}</td>
                <td>${escapeHtml(item.dob)}</td>
                <td>${escapeHtml(item.dod)}</td>
                <td>${escapeHtml(item.lot_number)}</td>
                <td>${escapeHtml(item.section_name)}</td>
                <td class="action-buttons">
                    <button class="btn-view" title="View"><i class="fas fa-eye"></i></button>
                </td>
            </tr>
        `).join('');

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

        const details = `
            <div class="detail-row"><span>Full Name</span><strong>${escapeHtml(record.first_name)} ${escapeHtml(record.last_name)}${record.suffix ? ' ' + escapeHtml(record.suffix) : ''}</strong></div>
            <div class="detail-row"><span>Date of Birth</span><strong>${escapeHtml(record.dob)}</strong></div>
            <div class="detail-row"><span>Date of Death</span><strong>${escapeHtml(record.dod)}</strong></div>
            <div class="detail-row"><span>Cause of Death</span><strong>${escapeHtml(record.cause_of_death || '—')}</strong></div>
            <div class="detail-row"><span>Lot Number</span><strong>${escapeHtml(record.lot_number)}</strong></div>
            <div class="detail-row"><span>Section</span><strong>${escapeHtml(record.section_name)}</strong></div>
            <div class="detail-row"><span>Contact Name</span><strong>${escapeHtml(record.contact_name || '—')}</strong></div>
            <div class="detail-row"><span>Contact Number</span><strong>${escapeHtml(record.contact_number || '—')}</strong></div>
            <div class="detail-row"><span>Cremated?</span><strong>${record.is_cremated === 'yes' ? 'Yes' : 'No'}</strong></div>
            ${record.is_cremated === 'yes' ? `<div class="detail-row"><span>Ash Storage</span><strong>${escapeHtml(record.ash_storage || '—')}</strong></div>` : ''}
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
});
