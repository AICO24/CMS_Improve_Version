document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    // System-Wide AI Assistant: the Audit Logs page has no single
    // entity_type of its own — 'AuditLog' scope pulls every open exception
    // and recent activity across the whole system instead of one module's.
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'AuditLog' },
        greeting: "Hello! I'm your AI assistant for the audit trail. How can I help you today?",
        suggestions: [
            { icon: 'fa-triangle-exclamation', label: 'What needs attention?', question: 'What currently needs my attention across the whole system?' },
            { icon: 'fa-robot', label: 'Automated vs manual', question: 'How much of the recent activity was automated versus manual?' },
            { icon: 'fa-magnifying-glass', label: 'Any anomalies?', question: 'Is there anything unusual in recent system activity?' },
            { icon: 'fa-list', label: "Summarize today's activity", question: 'Summarize what has happened in the system recently.' },
        ],
    });

    const tbody = document.getElementById('auditTableBody');
    const searchInput = document.getElementById('searchLogs');
    const dateFromInput = document.getElementById('filterDateFrom');
    const dateToInput = document.getElementById('filterDateTo');
    const refreshBtn = document.getElementById('refreshAuditBtn');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');

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
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
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

    // Batch F: shared by loadAuditLogs()/loadAuditCount() so the two calls
    // (list + count) are always built from the exact same filter state.
    function buildFilterParams() {
        const params = new URLSearchParams();
        const query = searchInput.value.trim();
        if (query) params.set('q', query);
        if (dateFromInput.value) params.set('date_from', dateFromInput.value);
        if (dateToInput.value) params.set('date_to', dateToInput.value);
        return params;
    }

    async function loadAuditLogs() {
        tbody.innerHTML = '<tr><td colspan="6">Loading audit logs...</td></tr>';
        try {
            const listParams = buildFilterParams();
            listParams.set('limit', perPage);
            listParams.set('offset', (pagination.page - 1) * perPage);

            const [logs, countResult] = await Promise.all([
                api.request(`audit-logs?${listParams.toString()}`, { method: 'GET' }),
                api.request(`audit-logs/count?${buildFilterParams().toString()}`, { method: 'GET' }),
            ]);

            renderLogs(logs);
            const total = countResult && Number.isFinite(countResult.total) ? countResult.total : 0;
            pagination.render({
                page: pagination.page,
                pages: Math.max(1, Math.ceil(total / perPage)),
                total,
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
    dateFromInput.addEventListener('change', refreshFiltered);
    dateToInput.addEventListener('change', refreshFiltered);
    refreshBtn.addEventListener('click', () => {
        pagination.reset();
        loadAuditLogs();
    });

    await loadAuditLogs();
});
