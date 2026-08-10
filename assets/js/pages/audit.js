document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    const tbody = document.getElementById('auditTableBody');
    const searchInput = document.getElementById('searchLogs');
    const refreshBtn = document.getElementById('refreshAuditBtn');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');

    const perPage = 20;

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

    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        infoEl: paginationInfo,
        itemLabel: 'log',
        onChange: loadAuditLogs,
    });

    function renderLogs(logs) {
        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No audit records found.</td></tr>';
            return;
        }

        tbody.innerHTML = logs.map(l => `
            <tr>
                <td><small>${l.created_at || '—'}</small></td>
                <td><strong>${l.user_full_name || l.username || 'System'}</strong></td>
                <td><span class="action-badge">${l.action}</span></td>
                <td>${l.entity_type ? `${l.entity_type} #${l.entity_id || ''}` : '—'}</td>
                <td><code>${l.ip_address || '127.0.0.1'}</code></td>
                <td><small class="muted">${l.details || '—'}</small></td>
            </tr>
        `).join('');
    }

    async function loadAuditLogs() {
        tbody.innerHTML = '<tr><td colspan="6">Loading audit logs...</td></tr>';
        try {
            const params = new URLSearchParams();
            // The audit-logs endpoint has no total-count support, so one
            // extra row is requested to detect whether a further page
            // exists — it's trimmed off before rendering.
            params.set('limit', perPage + 1);
            params.set('offset', (pagination.page - 1) * perPage);
            const query = searchInput.value.trim();
            if (query) params.set('q', query);

            const logs = await api.request(`audit-logs?${params.toString()}`, { method: 'GET' });
            const hasMore = Array.isArray(logs) && logs.length > perPage;
            const pageLogs = hasMore ? logs.slice(0, perPage) : logs;

            renderLogs(pageLogs);
            pagination.render({
                page: pagination.page,
                pages: hasMore ? pagination.page + 1 : pagination.page,
            });
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" class="audit-error">Failed to load logs: ${err.message}</td></tr>`;
            pagination.render({ page: 1, pages: 1 });
        }
    }

    function debounce(fn, delay = 300) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }

    const refreshFiltered = debounce(() => {
        pagination.reset();
        loadAuditLogs();
    }, 300);

    searchInput.addEventListener('input', refreshFiltered);
    refreshBtn.addEventListener('click', () => {
        pagination.reset();
        loadAuditLogs();
    });

    await loadAuditLogs();
});
