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
    const exportBtn = document.getElementById('exportAuditBtn');
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');

    const summaryIds = {
        total: document.getElementById('auditSummaryTotal'),
        alerts: document.getElementById('auditSummaryAlerts'),
        alertsMeta: document.getElementById('auditSummaryAlertsMeta'),
        users: document.getElementById('auditSummaryUsers'),
        recent: document.getElementById('auditSummaryRecent'),
    };

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

    function renderAuditSummary(safeLogs, summary) {
        if (!summaryIds.total) return;

        if (summary && typeof summary === 'object') {
            const alertCount = Number(summary.security_alerts ?? 0);
            summaryIds.total.textContent = (summary.total_events ?? 0).toLocaleString();
            summaryIds.alerts.textContent = alertCount.toLocaleString();
            summaryIds.alertsMeta.textContent = summary.alert_detail || summary.alert_label || (
                alertCount > 0 ? `${alertCount} critical events` : 'No critical activity'
            );
            summaryIds.users.textContent = (summary.active_users ?? 0).toLocaleString();
            summaryIds.recent.textContent = (summary.recent_24h ?? 0).toLocaleString();
            return;
        }

        const total = safeLogs.length;
        const alerts = safeLogs.filter((log) => {
            const action = String(log.action || '').toLowerCase();
            const details = String(log.details || '').toLowerCase();
            return /(delete|remove|reset|reject|suspend|disable|lock|failed)/.test(action) || /(failed|suspicious|unauthorized|blocked)/.test(details);
        }).length;
        const users = new Set(
            safeLogs
                .map((log) => String(log.user_full_name || log.username || 'System').trim())
                .filter(Boolean)
        ).size;
        const recent = safeLogs.filter((log) => {
            const createdAt = log.created_at ? new Date(log.created_at) : null;
            if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
            const hoursAgo = (Date.now() - createdAt.getTime()) / 3600000;
            return hoursAgo <= 24;
        }).length;

        summaryIds.total.textContent = total.toLocaleString();
        summaryIds.alerts.textContent = alerts.toLocaleString();
        summaryIds.alertsMeta.textContent = alerts > 0 ? `${alerts} critical events` : 'No critical activity';
        summaryIds.users.textContent = users.toLocaleString();
        summaryIds.recent.textContent = recent.toLocaleString();
    }

    function formatSafeDetails(details) {
        const raw = String(details || '').trim();
        if (!raw || raw === '—') return '<small class="muted">—</small>';

        try {
            if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
                const parsed = JSON.parse(raw);
                if (typeof parsed === 'object' && parsed !== null) {
                    const keys = Object.keys(parsed);
                    if (keys.length === 0) return '<small class="muted">—</small>';
                    const summaryItems = keys.slice(0, 3).map(k => {
                        let val = parsed[k];
                        if (typeof val === 'object') val = JSON.stringify(val);
                        return `<strong>${k}:</strong> ${String(val).slice(0, 30)}`;
                    });
                    const snippet = summaryItems.join(', ');
                    const fullEscaped = raw.replace(/"/g, '&quot;');
                    return `<span class="detail-cell" title="${fullEscaped}"><small class="muted">${snippet}${keys.length > 3 ? '…' : ''}</small></span>`;
                }
            }
        } catch (_) {
            // Not valid JSON, fallback to plain text
        }

        const safeText = raw.replace(/</g, '&lt;').replace(/>/g, '&gt;');
        const short = safeText.length > 80 ? `${safeText.slice(0, 80)}…` : safeText;
        return `<small class="muted" title="${safeText.replace(/"/g, '&quot;')}">${short}</small>`;
    }

    function renderLogs(logs) {
        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No audit records found.</td></tr>';
            return;
        }

        tbody.innerHTML = logs.map(l => `
            <tr>
                <td class="timestamp-cell"><small>${l.created_at || '—'}</small></td>
                <td class="user-cell"><strong>${l.user_full_name || l.username || 'System'}</strong></td>
                <td class="action-cell"><span class="action-badge">${l.action}</span></td>
                <td class="entity-cell">${l.entity_type ? `${l.entity_type} #${l.entity_id || ''}` : '—'}</td>
                <td class="ip-cell"><code>${l.ip_address || '127.0.0.1'}</code></td>
                <td class="details-cell">${formatSafeDetails(l.details)}</td>
            </tr>
        `).join('');
    }

    function buildFilterParams() {
        const params = new URLSearchParams();
        const query = searchInput.value.trim();
        if (query) params.set('q', query);
        if (dateFromInput && dateFromInput.value) params.set('date_from', dateFromInput.value);
        if (dateToInput && dateToInput.value) params.set('date_to', dateToInput.value);
        return params;
    }

    async function loadAuditLogs() {
        tbody.innerHTML = '<tr><td colspan="6">Loading audit logs...</td></tr>';
        try {
            const listParams = buildFilterParams();
            listParams.set('limit', perPage);
            listParams.set('offset', (pagination.page - 1) * perPage);
            listParams.set('summary', 'true');

            const [response, countResult] = await Promise.all([
                api.request(`audit-logs?${listParams.toString()}`, { method: 'GET' }),
                api.request(`audit-logs/count?${buildFilterParams().toString()}`, { method: 'GET' }),
            ]);

            const logs = Array.isArray(response) ? response : (response.logs || []);
            const summary = response && !Array.isArray(response) ? (response.summary || null) : null;

            renderAuditSummary(logs, summary);
            renderLogs(logs);

            const total = countResult && Number.isFinite(countResult.total) ? countResult.total : logs.length;
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

    async function exportAuditCsv() {
        try {
            const listParams = buildFilterParams();
            listParams.set('limit', 1000);
            listParams.set('offset', 0);

            const response = await api.request(`audit-logs?${listParams.toString()}`, { method: 'GET' });
            const logs = Array.isArray(response) ? response : (response.logs || []);

            if (!logs.length) {
                alert('No logs to export.');
                return;
            }

            const headers = ['Timestamp', 'User', 'Action', 'Entity Type', 'Entity ID', 'IP Address', 'Details'];
            const rows = logs.map(l => [
                `"${(l.created_at || '').replace(/"/g, '""')}"`,
                `"${(l.user_full_name || l.username || 'System').replace(/"/g, '""')}"`,
                `"${(l.action || '').replace(/"/g, '""')}"`,
                `"${(l.entity_type || '').replace(/"/g, '""')}"`,
                `"${(l.entity_id || '').toString().replace(/"/g, '""')}"`,
                `"${(l.ip_address || '').replace(/"/g, '""')}"`,
                `"${(l.details || '').replace(/"/g, '""')}"`
            ]);

            const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
        } catch (err) {
            alert('Failed to export audit logs: ' + err.message);
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
    if (dateFromInput) dateFromInput.addEventListener('change', refreshFiltered);
    if (dateToInput) dateToInput.addEventListener('change', refreshFiltered);
    refreshBtn.addEventListener('click', () => {
        pagination.reset();
        loadAuditLogs();
    });
    if (exportBtn) exportBtn.addEventListener('click', exportAuditCsv);

    await loadAuditLogs();
});
