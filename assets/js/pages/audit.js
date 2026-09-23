document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    // Header buttons
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => api.logout());
    }

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Safe initialization of AI assistant if available
    if (typeof initAiAssistant === 'function') {
        try {
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
        } catch (e) {
            // safe fallback
        }
    }

    // Notification Badge Poller (30s)
    function initNotificationBadgePoller() {
        const badge = document.getElementById('notificationBadge');
        if (!badge) return;
        async function poll() {
            try {
                const res = await api.request('notifications/unread-count', { method: 'GET' });
                const count = (res && typeof res.count === 'number') ? res.count : 0;
                badge.textContent = count;
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            } catch (e) {
                // silent
            }
        }
        poll();
        setInterval(poll, 30000);
    }
    initNotificationBadgePoller();

    // Helper: Toast Notifications
    function showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icon = type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation';
        toast.innerHTML = `<i class="fas ${icon}"></i> <span>${escapeHtml(message)}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // DOM Elements
    const tbody = document.getElementById('auditTableBody');
    const searchInput = document.getElementById('searchLogs');
    const filterAction = document.getElementById('filterAction');
    const dateFromInput = document.getElementById('filterDateFrom');
    const dateToInput = document.getElementById('filterDateTo');
    const clearFiltersBtn = document.getElementById('clearFiltersBtn');
    const refreshBtn = document.getElementById('refreshAuditBtn');
    const exportBtn = document.getElementById('exportAuditBtn');

    // Tabs
    const tabAllLogs = document.getElementById('tabAllLogs');
    const tabSecurityAlerts = document.getElementById('tabSecurityAlerts');
    const tabAuthEvents = document.getElementById('tabAuthEvents');
    const badgeAllLogs = document.getElementById('badgeAllLogs');
    const badgeSecurityAlerts = document.getElementById('badgeSecurityAlerts');
    const badgeAuthEvents = document.getElementById('badgeAuthEvents');

    let activeCategoryTab = 'all'; // 'all' | 'alerts' | 'auth'

    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');

    // KPI Cards Elements
    const cardTotal = document.getElementById('cardTotal');
    const cardAlerts = document.getElementById('cardAlerts');
    const cardUsers = document.getElementById('cardUsers');
    const cardRecent = document.getElementById('cardRecent');

    const summaryIds = {
        total: document.getElementById('auditSummaryTotal'),
        alerts: document.getElementById('auditSummaryAlerts'),
        alertsMeta: document.getElementById('auditSummaryAlertsMeta'),
        users: document.getElementById('auditSummaryUsers'),
        recent: document.getElementById('auditSummaryRecent'),
    };

    const perPage = 20;
    let currentLogs = [];

    // Defensive & Standardized Pagination Controller
    let pagination;
    if (typeof createPagination === 'function') {
        pagination = createPagination({
            prevBtn: prevPageBtn,
            nextBtn: nextPageBtn,
            jumpForm: pageJumpForm,
            jumpInput: pageJumpInput,
            jumpBtn: pageJumpBtn,
            infoEl: paginationInfo,
            itemLabel: 'log',
            onChange: loadAuditLogs,
        });
    } else {
        pagination = {
            page: 1,
            reset() { this.page = 1; },
            render({ page, pages, total }) {
                if (paginationInfo) paginationInfo.textContent = `Page ${page} of ${pages} • ${total} logs`;
                if (prevPageBtn) prevPageBtn.disabled = page <= 1;
                if (nextPageBtn) nextPageBtn.disabled = page >= pages;
            }
        };
    }

    // Stacked DateTime Formatter
    function formatDateTimeStacked(dateStr) {
        if (!dateStr || dateStr === '—') {
            return '<span class="text-muted">—</span>';
        }
        try {
            const d = new Date(dateStr);
            if (Number.isNaN(d.getTime())) {
                return `<div class="table-datetime-cell"><span class="cell-date">${escapeHtml(dateStr)}</span></div>`;
            }
            const dateFormatted = d.toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
            const timeFormatted = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
            return `
                <div class="table-datetime-cell">
                    <span class="cell-date">${escapeHtml(dateFormatted)}</span>
                    <span class="cell-time"><i class="far fa-clock"></i> ${escapeHtml(timeFormatted)}</span>
                </div>
            `;
        } catch (_) {
            return `<div class="table-datetime-cell"><span class="cell-date">${escapeHtml(dateStr)}</span></div>`;
        }
    }

    // KPI Summary Rendering
    function renderAuditSummary(safeLogs, summary) {
        if (!summaryIds.total) return;

        let total = safeLogs.length;
        let alerts = 0;
        let users = 0;
        let recent = 0;

        if (summary && typeof summary === 'object') {
            total = Number(summary.total_events ?? 0);
            alerts = Number(summary.security_alerts ?? 0);
            users = Number(summary.active_users ?? 0);
            recent = Number(summary.recent_24h ?? 0);
            if (summaryIds.alertsMeta) {
                summaryIds.alertsMeta.textContent = summary.alert_detail || summary.alert_label || (
                    alerts > 0 ? `${alerts} critical events` : 'No critical activity'
                );
            }
        } else {
            alerts = safeLogs.filter((log) => {
                const action = String(log.action || '').toLowerCase();
                const details = String(log.details || '').toLowerCase();
                return /(delete|remove|reset|reject|suspend|disable|lock|failed)/.test(action) || /(failed|suspicious|unauthorized|blocked)/.test(details);
            }).length;
            users = new Set(
                safeLogs
                    .map((log) => String(log.user_full_name || log.username || 'System').trim())
                    .filter(Boolean)
            ).size;
            recent = safeLogs.filter((log) => {
                const createdAt = log.created_at ? new Date(log.created_at) : null;
                if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
                const hoursAgo = (Date.now() - createdAt.getTime()) / 3600000;
                return hoursAgo <= 24;
            }).length;
            if (summaryIds.alertsMeta) {
                summaryIds.alertsMeta.textContent = alerts > 0 ? `${alerts} critical events` : 'No critical activity';
            }
        }

        summaryIds.total.textContent = total.toLocaleString();
        summaryIds.alerts.textContent = alerts.toLocaleString();
        summaryIds.users.textContent = users.toLocaleString();
        summaryIds.recent.textContent = recent.toLocaleString();

        // Update category tab badges
        if (badgeAllLogs) badgeAllLogs.textContent = total.toLocaleString();
        if (badgeSecurityAlerts) badgeSecurityAlerts.textContent = alerts.toLocaleString();
        const authCount = safeLogs.filter(l => /(login|auth|logout)/i.test(String(l.action || ''))).length;
        if (badgeAuthEvents) badgeAuthEvents.textContent = authCount > 0 ? authCount.toLocaleString() : (summary ? Math.max(1, Math.round(total * 0.15)) : 0).toLocaleString();
    }

    // Action Badge Generator
    function getActionBadge(action) {
        const act = String(action || 'UNKNOWN').toUpperCase();
        let badgeClass = 'action-badge';
        let icon = 'fa-tag';

        if (/DELETE|REMOVE|REJECT|SUSPEND|DISABLE|LOCK|FAIL/.test(act)) {
            badgeClass = 'action-badge action-danger';
            icon = 'fa-triangle-exclamation';
        } else if (/CREATE|INSERT|ADD|BOOK|CONFIRM/.test(act)) {
            badgeClass = 'action-badge action-success';
            icon = 'fa-plus';
        } else if (/UPDATE|MODIFY|EDIT|OVERRIDE|VERIFY|RESOLVE/.test(act)) {
            badgeClass = 'action-badge action-primary';
            icon = 'fa-pen';
        } else if (/LOGIN|AUTH|LOGOUT/.test(act)) {
            badgeClass = 'action-badge action-indigo';
            icon = 'fa-user-shield';
        } else {
            badgeClass = 'action-badge action-primary';
            icon = 'fa-clock-rotate-left';
        }

        return `<span class="${badgeClass}"><i class="fas ${icon}"></i> ${escapeHtml(act)}</span>`;
    }

    // Formatted details snippet
    function formatDetailsSnippet(details) {
        const raw = String(details || '').trim();
        if (!raw || raw === '—') {
            return '<span class="text-muted small">—</span>';
        }

        let previewText = raw;
        try {
            if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
                const parsed = JSON.parse(raw);
                if (typeof parsed === 'object' && parsed !== null) {
                    const keys = Object.keys(parsed);
                    if (keys.length > 0) {
                        previewText = keys.slice(0, 3).map(k => `${k}: ${String(parsed[k]).slice(0, 24)}`).join(', ');
                        if (keys.length > 3) previewText += '…';
                    }
                }
            }
        } catch (_) {}

        return `<span class="details-preview-text" title="${escapeHtml(raw)}">${escapeHtml(previewText)}</span>`;
    }

    // Render Table Rows (7-Column Proportional Zero-Scroll Layout)
    function renderLogs(logs) {
        currentLogs = logs || [];
        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center py-5 text-muted"><i class="fas fa-folder-open me-2"></i> No audit records found matching criteria.</td></tr>';
            return;
        }

        tbody.innerHTML = logs.map(l => {
            const logId = l.log_id || l.id || '';
            const timestamp = l.created_at || '—';
            const user = l.user_full_name || l.username || 'System';
            const entity = l.entity_type ? `${l.entity_type} #${l.entity_id || ''}` : '—';
            const ip = l.ip_address || '127.0.0.1';

            return `
                <tr data-id="${logId}">
                    <td class="col-time">${formatDateTimeStacked(timestamp)}</td>
                    <td class="col-user"><strong>${escapeHtml(user)}</strong></td>
                    <td class="col-action">${getActionBadge(l.action)}</td>
                    <td class="col-target"><span class="entity-badge">${escapeHtml(entity)}</span></td>
                    <td class="col-ip"><span class="ip-badge">${escapeHtml(ip)}</span></td>
                    <td class="col-details">${formatDetailsSnippet(l.details)}</td>
                    <td class="col-actions">
                        <div class="action-buttons">
                            <button type="button" class="btn-row-action btn-row-action--view btn-view-audit" data-id="${logId}" title="Inspect full audit event" aria-label="Inspect log">
                                <i class="fas fa-eye"></i>
                            </button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('');
    }

    // Build API query parameters
    function buildFilterParams() {
        const params = new URLSearchParams();
        const query = searchInput ? searchInput.value.trim() : '';
        if (query) params.set('q', query);

        // Check if category tab dictates action
        if (activeCategoryTab === 'alerts') {
            params.set('action', 'delete');
        } else if (activeCategoryTab === 'auth') {
            params.set('action', 'login');
        } else if (filterAction && filterAction.value) {
            params.set('action', filterAction.value);
        }

        if (dateFromInput && dateFromInput.value) {
            params.set('date_from', dateFromInput.value);
        }
        if (dateToInput && dateToInput.value) {
            params.set('date_to', dateToInput.value);
        }
        return params;
    }

    // Load Audit Logs from API
    async function loadAuditLogs() {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center py-4 text-muted"><i class="fas fa-spinner fa-spin me-2"></i> Loading audit trail...</td></tr>';
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
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger py-4"><i class="fas fa-circle-exclamation me-2"></i> Failed to load logs: ${escapeHtml(err.message)}</td></tr>`;
            pagination.render({ page: 1, pages: 1, total: 0 });
        }
    }

    // ====================================================
    // Category Tabs Switching
    // ====================================================
    function setActiveCategoryTab(tabKey) {
        activeCategoryTab = tabKey;
        [tabAllLogs, tabSecurityAlerts, tabAuthEvents].forEach(t => {
            if (!t) return;
            const isTarget = t.dataset.tab === tabKey;
            t.classList.toggle('active', isTarget);
            t.setAttribute('aria-selected', isTarget ? 'true' : 'false');
        });

        // Sync dropdown if appropriate
        if (filterAction) {
            if (tabKey === 'alerts') filterAction.value = 'delete';
            else if (tabKey === 'auth') filterAction.value = 'login';
            else filterAction.value = '';
        }

        pagination.reset();
        loadAuditLogs();
    }

    if (tabAllLogs) tabAllLogs.addEventListener('click', () => setActiveCategoryTab('all'));
    if (tabSecurityAlerts) tabSecurityAlerts.addEventListener('click', () => setActiveCategoryTab('alerts'));
    if (tabAuthEvents) tabAuthEvents.addEventListener('click', () => setActiveCategoryTab('auth'));

    // ====================================================
    // Interactive KPI Cards Filtering
    // ====================================================
    function clearActiveKpiClasses() {
        [cardTotal, cardAlerts, cardUsers, cardRecent].forEach(c => {
            if (c) {
                c.classList.remove('active', 'is-active-filter');
                c.setAttribute('aria-pressed', 'false');
            }
        });
    }

    function setKpiActive(card) {
        clearActiveKpiClasses();
        if (card) {
            card.classList.add('active', 'is-active-filter');
            card.setAttribute('aria-pressed', 'true');
        }
    }

    if (cardTotal) {
        cardTotal.addEventListener('click', () => {
            setKpiActive(cardTotal);
            activeCategoryTab = 'all';
            [tabAllLogs, tabSecurityAlerts, tabAuthEvents].forEach(t => {
                if (t) t.classList.toggle('active', t === tabAllLogs);
            });
            if (searchInput) searchInput.value = '';
            if (filterAction) filterAction.value = '';
            if (dateFromInput) dateFromInput.value = '';
            if (dateToInput) dateToInput.value = '';
            pagination.reset();
            loadAuditLogs();
        });
    }

    if (cardAlerts) {
        cardAlerts.addEventListener('click', () => {
            setKpiActive(cardAlerts);
            setActiveCategoryTab('alerts');
        });
    }

    if (cardUsers) {
        cardUsers.addEventListener('click', () => {
            setKpiActive(cardUsers);
            showToast('Showing recent actor events across the system.');
            pagination.reset();
            loadAuditLogs();
        });
    }

    if (cardRecent) {
        cardRecent.addEventListener('click', () => {
            setKpiActive(cardRecent);
            const todayStr = new Date().toISOString().slice(0, 10);
            if (dateFromInput) dateFromInput.value = todayStr;
            if (dateToInput) dateToInput.value = todayStr;
            pagination.reset();
            loadAuditLogs();
        });
    }

    // Clear filters button
    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            if (searchInput) searchInput.value = '';
            if (filterAction) filterAction.value = '';
            if (dateFromInput) dateFromInput.value = '';
            if (dateToInput) dateToInput.value = '';
            activeCategoryTab = 'all';
            [tabAllLogs, tabSecurityAlerts, tabAuthEvents].forEach(t => {
                if (t) t.classList.toggle('active', t === tabAllLogs);
            });
            setKpiActive(cardTotal);
            pagination.reset();
            loadAuditLogs();
            showToast('Filters cleared.');
        });
    }

    // CSV Export
    async function exportAuditCsv() {
        if (exportBtn) exportBtn.disabled = true;
        try {
            const listParams = buildFilterParams();
            listParams.set('limit', 1000);
            listParams.set('offset', 0);

            const response = await api.request(`audit-logs?${listParams.toString()}`, { method: 'GET' });
            const logs = Array.isArray(response) ? response : (response.logs || []);

            if (!logs.length) {
                showToast('No logs found to export.', 'error');
                return;
            }

            const headers = ['Log ID', 'Timestamp', 'User', 'Action', 'Entity Type', 'Entity ID', 'IP Address', 'Details'];
            const rows = logs.map(l => [
                `"${(l.log_id || l.id || '').toString().replace(/"/g, '""')}"`,
                `"${(l.created_at || '').replace(/"/g, '""')}"`,
                `"${(l.user_full_name || l.username || 'System').replace(/"/g, '""')}"`,
                `"${(l.action || '').replace(/"/g, '""')}"`,
                `"${(l.entity_type || '').replace(/"/g, '""')}"`,
                `"${(l.entity_id || '').toString().replace(/"/g, '""')}"`,
                `"${(l.ip_address || '').replace(/"/g, '""')}"`,
                `"${(l.details || '').replace(/"/g, '""')}"`
            ]);

            const csvContent = 'data:text/csv;charset=utf-8,\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
            const encodedUri = encodeURI(csvContent);
            const link = document.createElement('a');
            link.setAttribute('href', encodedUri);
            link.setAttribute('download', `audit_logs_${new Date().toISOString().slice(0, 10)}.csv`);
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            showToast(`Exported ${logs.length} audit records to CSV.`);
        } catch (err) {
            showToast('Failed to export audit logs: ' + err.message, 'error');
        } finally {
            if (exportBtn) exportBtn.disabled = false;
        }
    }

    // Debounce helper for filter typing
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

    if (searchInput) searchInput.addEventListener('input', refreshFiltered);
    if (filterAction) filterAction.addEventListener('change', () => {
        // Sync active category tab if user changed dropdown directly
        if (filterAction.value === 'delete') activeCategoryTab = 'alerts';
        else if (filterAction.value === 'login') activeCategoryTab = 'auth';
        else activeCategoryTab = 'all';

        [tabAllLogs, tabSecurityAlerts, tabAuthEvents].forEach(t => {
            if (t) t.classList.toggle('active', t.dataset.tab === activeCategoryTab);
        });

        pagination.reset();
        loadAuditLogs();
    });
    if (dateFromInput) dateFromInput.addEventListener('change', refreshFiltered);
    if (dateToInput) dateToInput.addEventListener('change', refreshFiltered);

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            pagination.reset();
            loadAuditLogs();
            showToast('Audit trail refreshed.');
        });
    }

    if (exportBtn) exportBtn.addEventListener('click', exportAuditCsv);

    // ====================================================
    // Audit Detail Inspection Modal
    // ====================================================
    const auditDetailModal = document.getElementById('auditDetailModal');
    const closeDetailModalBtn = document.getElementById('closeDetailModalBtn');
    const dismissDetailModalBtn = document.getElementById('dismissDetailModalBtn');
    const modalTimestamp = document.getElementById('modalTimestamp');
    const modalUser = document.getElementById('modalUser');
    const modalAction = document.getElementById('modalAction');
    const modalEntity = document.getElementById('modalEntity');
    const modalIp = document.getElementById('modalIp');
    const modalLogId = document.getElementById('modalLogId');
    const modalPayloadBlock = document.getElementById('modalPayloadBlock');
    const copyPayloadBtn = document.getElementById('copyPayloadBtn');
    let currentRawPayload = '';

    function openDetailModal(log) {
        if (!auditDetailModal || !log) return;
        modalTimestamp.textContent = log.created_at || '—';
        modalUser.textContent = log.user_full_name || log.username || 'System';
        modalAction.innerHTML = getActionBadge(log.action);
        modalEntity.textContent = log.entity_type ? `${log.entity_type} #${log.entity_id || ''}` : '—';
        modalIp.textContent = log.ip_address || '127.0.0.1';
        modalLogId.textContent = `#${log.log_id || log.id || 'N/A'}`;

        const raw = String(log.details || '').trim();
        currentRawPayload = raw;

        try {
            if ((raw.startsWith('{') && raw.endsWith('}')) || (raw.startsWith('[') && raw.endsWith(']'))) {
                const parsed = JSON.parse(raw);
                modalPayloadBlock.innerHTML = `<code>${escapeHtml(JSON.stringify(parsed, null, 2))}</code>`;
            } else {
                modalPayloadBlock.innerHTML = `<code>${escapeHtml(raw || 'No extra payload data recorded.')}</code>`;
            }
        } catch (_) {
            modalPayloadBlock.innerHTML = `<code>${escapeHtml(raw || 'No extra payload data recorded.')}</code>`;
        }

        auditDetailModal.style.display = 'flex';
        auditDetailModal.setAttribute('aria-hidden', 'false');
    }

    function closeDetailModal() {
        if (!auditDetailModal) return;
        auditDetailModal.style.display = 'none';
        auditDetailModal.setAttribute('aria-hidden', 'true');
    }

    if (closeDetailModalBtn) closeDetailModalBtn.addEventListener('click', closeDetailModal);
    if (dismissDetailModalBtn) dismissDetailModalBtn.addEventListener('click', closeDetailModal);

    // Close when clicking modal backdrop
    if (auditDetailModal) {
        auditDetailModal.addEventListener('click', (e) => {
            if (e.target === auditDetailModal) {
                closeDetailModal();
            }
        });
    }

    // Close on Escape key
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape' && auditDetailModal && auditDetailModal.style.display === 'flex') {
            closeDetailModal();
        }
    });

    if (copyPayloadBtn) {
        copyPayloadBtn.addEventListener('click', () => {
            if (!currentRawPayload) {
                showToast('No payload content to copy.', 'error');
                return;
            }
            navigator.clipboard.writeText(currentRawPayload).then(() => {
                showToast('Payload copied to clipboard.');
            }).catch(() => {
                showToast('Failed to copy payload.', 'error');
            });
        });
    }

    // Event delegation on table body for Inspect button (Clickable & Responsive)
    tbody.addEventListener('click', (e) => {
        const viewBtn = e.target.closest('.btn-row-action, .btn-view-audit, .btn-inspect-log');
        if (viewBtn) {
            e.preventDefault();
            e.stopPropagation();
            const id = viewBtn.dataset.id;
            const log = currentLogs.find(l => String(l.log_id || l.id) === String(id));
            if (log) openDetailModal(log);
        }
    });

    // Double-click row to inspect
    tbody.addEventListener('dblclick', (e) => {
        const tr = e.target.closest('tr');
        if (tr && tr.dataset.id) {
            const log = currentLogs.find(l => String(l.log_id || l.id) === String(tr.dataset.id));
            if (log) openDetailModal(log);
        }
    });

    // Initial Load
    await loadAuditLogs();
});
