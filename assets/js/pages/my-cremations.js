// Cremation Phase B (B4): citizen's own cremation requests — mirrors
// my-reservations.js closely (same shared reservation-ui.js helpers,
// pagination, filter-chip pattern), adapted for cremation's fields
// (columbarium/niche instead of lot/section, cremation_date instead of
// schedule_date). No AI assistant mount here — that's scoped to Schedule
// module context today (see my-reservations.js's own comment); adding a
// Cremation-scoped one is a separate decision, not part of this phase.
document.addEventListener('DOMContentLoaded', async function() {
    try {
        const user = await requireRole(['user']);
        if (!user) return;
    } catch (error) {
        console.error('Auth error', error);
        return;
    }

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

    const searchQuery = document.getElementById('searchQuery');
    const statusFilter = document.getElementById('statusFilter');
    const clearFilters = document.getElementById('clearFilters');
    const activeFilterChips = document.getElementById('activeFilterChips');
    const cremationsBody = document.getElementById('cremationsBody');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPage = document.getElementById('prevPage');
    const nextPage = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');

    let perPage = 10;
    let currentQuery = '';
    let currentStatus = '';

    const pagination = createPagination({
        prevBtn: prevPage,
        nextBtn: nextPage,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        infoEl: paginationInfo,
        itemLabel: 'cremation request',
        onChange: loadCremations,
    });

    const { buildStatusBadge, debounce, renderFilterChips } = window.reservationUI;

    function renderActiveFilterChips() {
        renderFilterChips(activeFilterChips, [
            { key: 'q', label: 'Search', value: currentQuery, clear: () => { searchQuery.value = ''; currentQuery = ''; } },
            { key: 'status', label: 'Status', value: currentStatus, clear: () => { statusFilter.value = ''; currentStatus = ''; } },
        ], async () => {
            pagination.reset();
            await loadCremations();
        });
    }

    function buildCremationRow(cremation) {
        const canCancel = cremation.status === 'Pending';
        const decedentCell = (cremation.first_name || cremation.last_name)
            ? `${cremation.first_name || ''} ${cremation.last_name || ''}`.trim()
            : (cremation.provisional_name ? `${cremation.provisional_name} <span class="muted">(unregistered)</span>` : 'N/A');
        return `
            <tr>
                <td>
                    <div><strong>Request #${cremation.cremation_id}</strong></div>
                    <div class="muted">Created by ${cremation.created_by_name || 'You'}</div>
                </td>
                <td>${cremation.columbarium || 'N/A'}</td>
                <td>${cremation.niche_number || '—'}</td>
                <td>${cremation.cremation_date || 'N/A'}</td>
                <td>${buildStatusBadge(cremation.status)}</td>
                <td>${decedentCell}</td>
                <td>
                    ${canCancel ? `<button class="btn-secondary" data-action="cancel" data-id="${cremation.cremation_id}">Cancel</button>` : '<span class="muted">No actions</span>'}
                </td>
            </tr>
        `;
    }

    async function loadCremations() {
        cremationsBody.innerHTML = '<tr><td colspan="7">Loading cremation requests...</td></tr>';
        const params = new URLSearchParams();
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        if (currentQuery.trim()) params.set('q', currentQuery.trim());
        if (currentStatus) params.set('status', currentStatus);

        try {
            const result = await api.request(`cremations/mine?${params.toString()}`, { method: 'GET' });
            const data = Array.isArray(result.data) ? result.data : [];
            cremationsBody.innerHTML = data.length > 0
                ? data.map(buildCremationRow).join('')
                : `
                    <tr>
                        <td colspan="7">
                            <div class="usermgmt-empty-state">
                                <i class="fas fa-fire"></i>
                                <strong>No cremation requests found</strong>
                                <span>Adjust the filters to see more of your requests.</span>
                            </div>
                        </td>
                    </tr>
                `;
            renderActiveFilterChips();
            pagination.render(result.meta || { page: 1, pages: 1, total: data.length });
        } catch (error) {
            console.error('Failed to load cremation requests', error);
            cremationsBody.innerHTML = '<tr><td colspan="7">Unable to load cremation requests right now.</td></tr>';
            pagination.render({ page: 1, pages: 1, total: 0 });
        }
    }

    async function cancelCremation(id) {
        const confirmed = await confirmDialog({
            title: 'Cancel cremation request?',
            message: 'This will cancel your pending cremation request. This cannot be undone.',
            confirmLabel: 'Cancel request',
            cancelLabel: 'Keep request',
            danger: true,
        });
        if (!confirmed) return;

        try {
            const result = await api.request(`cremations/${id}`, { method: 'DELETE' });
            if (result.success) {
                showToast('Cremation request cancelled successfully.', { type: 'success' });
                await loadCremations();
            } else {
                showToast(result.error || 'Unable to cancel cremation request.', { type: 'error' });
            }
        } catch (error) {
            showToast(error.message || 'Unable to cancel cremation request.', { type: 'error' });
        }
    }

    cremationsBody.addEventListener('click', async function(event) {
        const button = event.target.closest('button[data-action="cancel"]');
        if (!button) return;
        const cremationId = button.getAttribute('data-id');
        if (!cremationId) return;
        await withButtonLoading(button, () => cancelCremation(cremationId));
    });

    const refreshCremations = debounce(async () => {
        pagination.reset();
        currentQuery = searchQuery.value || '';
        currentStatus = statusFilter.value || '';
        await loadCremations();
    }, 250);

    searchQuery.addEventListener('input', refreshCremations);
    statusFilter.addEventListener('change', refreshCremations);
    clearFilters.addEventListener('click', async () => {
        searchQuery.value = '';
        statusFilter.value = '';
        currentQuery = '';
        currentStatus = '';
        pagination.reset();
        await loadCremations();
    });

    await loadCremations();
});
