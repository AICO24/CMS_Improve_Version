// Admin/staff "Exceptions" page — the open-items queue the Automation
// Engine (backend/services/AutomationEngine.php) raises into when a
// normally-automatic transition (e.g. payment verified -> auto-confirm
// booking) can't safely proceed. This is the admin Control Center's
// "needs attention" surface, not a routine approval queue — most bookings
// never appear here at all.
document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin', 'staff']);
    if (!user) return;

    // System-Wide AI Assistant: page-level, always visible in the header —
    // the per-exception one in the resolve modal below is a separate
    // instance for "explain this specific exception". 'AuditLog' scope
    // reuses the same cross-cutting "every open exception" reach the Audit
    // Logs page uses, since this page is exactly that same concern.
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'AuditLog' },
        greeting: "Hello! I'm your AI assistant for exceptions. How can I help you today?",
        suggestions: [
            { icon: 'fa-triangle-exclamation', label: 'Open exceptions', question: 'How many exceptions are currently open, and what are they?' },
            { icon: 'fa-clock', label: 'Oldest unresolved', question: 'Which open exception has been waiting the longest?' },
            { icon: 'fa-robot', label: 'Automation activity', question: 'How much of the recent activity was handled automatically versus manually?' },
            { icon: 'fa-list', label: 'Summary', question: 'Summarize what needs my attention right now.' },
        ],
    });

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

    // Notification badge sync
    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.innerText = result.count || 0;
                badge.style.display = result.count > 0 ? 'flex' : 'none';
            }
        } catch (e) { /* silent — non-critical UI */ }
    }
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);

    const searchQuery = document.getElementById('searchQuery');
    const statusFilter = document.getElementById('statusFilter');
    const filterSeverity = document.getElementById('filterSeverity');
    const clearFiltersBtn = document.getElementById('clearFilters');
    const refreshBtn = document.getElementById('refreshExceptionsBtn');
    const tableBody = document.getElementById('exceptionsTableBody');

    // KPI Counter Nodes
    const openCountEl = document.getElementById('openCount');
    const criticalCountEl = document.getElementById('criticalCount');
    const warningCountEl = document.getElementById('warningCount');
    const resolvedCountEl = document.getElementById('resolvedCount');
    const filterableCards = document.querySelectorAll('.stat-card-filterable');

    // Pagination elements
    const perPage = 10;
    const pagination = createPagination({
        prevBtn: document.getElementById('prevPage'),
        nextBtn: document.getElementById('nextPage'),
        infoEl: document.getElementById('paginationInfo'),
        jumpForm: document.getElementById('paginationJumpForm'),
        jumpInput: document.getElementById('pageJumpInput'),
        jumpBtn: document.getElementById('pageJumpBtn'),
        itemLabel: 'exception',
        onChange: () => renderFilteredExceptions(),
    });

    const resolveModal = document.getElementById('resolveModal');
    const resolveModalClose = document.getElementById('resolveModalClose');
    const cancelResolveBtn = document.getElementById('cancelResolveBtn');
    const resolveModalReason = document.getElementById('resolveModalReason');
    const useAsNotesBtn = document.getElementById('useAsNotesBtn');
    const resolutionNotes = document.getElementById('resolutionNotes');
    const confirmAnywayRow = document.getElementById('confirmAnywayRow');
    const confirmAnywayCheckbox = document.getElementById('confirmAnywayCheckbox');
    const confirmAnywayLabel = document.getElementById('confirmAnywayLabel');
    const resolveModalSubmit = document.getElementById('resolveModalSubmit');

    let allExceptions = [];
    let activeException = null;
    let lastAiDiagnosis = null;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    function buildSeverityBadge(severity) {
        const classBySeverity = { info: 'status-info', warning: 'status-warning', critical: 'status-danger' };
        return `<span class="status-badge ${classBySeverity[severity] || 'status-warning'}">${escapeHtml(severity || 'warning')}</span>`;
    }

    function buildStatusBadge(status) {
        return `<span class="status-badge ${status === 'resolved' ? 'status-success' : 'status-warning'}">${escapeHtml(status || 'open')}</span>`;
    }

    function buildRow(exception) {
        const action = exception.status === 'open'
            ? `<div class="action-buttons">
                <button type="button" class="btn-row-action btn-row-action--confirm" data-action="resolve" data-id="${exception.exception_id}"><i class="fas fa-check"></i> Resolve</button>
                <button type="button" class="btn-row-action" data-action="retry" data-id="${exception.exception_id}"><i class="fas fa-rotate"></i> Retry</button>
               </div>`
            : `<span class="muted"><i class="fas fa-circle-check" style="color:#10b981; margin-right:4px;"></i>${escapeHtml(exception.resolved_by_name || 'Resolved')}</span>`;
        return `
            <tr data-id="${exception.exception_id}">
                <td><small class="muted">${escapeHtml(exception.created_at)}</small></td>
                <td><strong>${escapeHtml(exception.event)}</strong></td>
                <td><span class="detail-pill">${escapeHtml(exception.entity_type)} #${escapeHtml(exception.entity_id)}</span></td>
                <td><span title="${escapeHtml(exception.reason)}">${escapeHtml(exception.reason)}</span></td>
                <td>${buildSeverityBadge(exception.severity)}</td>
                <td>${buildStatusBadge(exception.status)}</td>
                <td>${action}</td>
            </tr>
        `;
    }

    function updateKpiCounters(list) {
        const open = list.filter(e => e.status === 'open').length;
        const critical = list.filter(e => e.status === 'open' && e.severity === 'critical').length;
        const warning = list.filter(e => e.status === 'open' && e.severity !== 'critical').length;
        const resolved = list.filter(e => e.status === 'resolved').length;

        if (openCountEl) openCountEl.textContent = open;
        if (criticalCountEl) criticalCountEl.textContent = critical;
        if (warningCountEl) warningCountEl.textContent = warning;
        if (resolvedCountEl) resolvedCountEl.textContent = resolved;
    }

    function setActiveFilterCard(filterType) {
        filterableCards.forEach(card => {
            const isMatch = card.dataset.filter === filterType;
            card.classList.toggle('is-active-filter', isMatch);
            card.classList.toggle('active', isMatch);
            card.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
        });
    }

    function getFilteredList() {
        const query = searchQuery ? searchQuery.value.trim().toLowerCase() : '';
        const status = statusFilter ? statusFilter.value : '';
        const severity = filterSeverity ? filterSeverity.value : '';

        return allExceptions.filter(item => {
            if (status && item.status !== status) return false;
            if (severity && item.severity !== severity) return false;
            if (query) {
                const combined = `${item.reason || ''} ${item.event || ''} ${item.entity_type || ''} ${item.entity_id || ''}`.toLowerCase();
                if (!combined.includes(query)) return false;
            }
            return true;
        });
    }

    function renderFilteredExceptions() {
        const filtered = getFilteredList();
        const total = filtered.length;
        const totalPages = Math.max(1, Math.ceil(total / perPage));
        if (pagination.page > totalPages) pagination.page = totalPages;

        const start = (pagination.page - 1) * perPage;
        const paged = filtered.slice(start, start + perPage);

        if (paged.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding: 32px;"><i class="fas fa-circle-check" style="color: #10b981; font-size: 1.4rem; margin-bottom: 6px; display:block;"></i> <strong>Nothing needs attention</strong> — normal transactions are confirming automatically.</td></tr>';
        } else {
            tableBody.innerHTML = paged.map(buildRow).join('');
        }

        pagination.render({
            page: pagination.page,
            total_pages: totalPages,
            total: total,
        });
    }

    async function loadAllExceptions() {
        tableBody.innerHTML = '<tr><td colspan="7">Loading exceptions...</td></tr>';
        try {
            // Load all items once, then slice/filter locally for instant snappy response
            const exceptions = await api.request('exceptions', { method: 'GET' });
            allExceptions = Array.isArray(exceptions) ? exceptions : [];
            updateKpiCounters(allExceptions);
            renderFilteredExceptions();
        } catch (error) {
            console.error('Failed to load exceptions', error);
            tableBody.innerHTML = '<tr><td colspan="7">Unable to load exceptions right now.</td></tr>';
        }
    }

    // Filterable KPI card click interactions
    filterableCards.forEach(card => {
        card.addEventListener('click', () => {
            const filterType = card.dataset.filter;
            setActiveFilterCard(filterType);

            if (filterType === 'open') {
                statusFilter.value = 'open';
                filterSeverity.value = '';
            } else if (filterType === 'critical') {
                statusFilter.value = 'open';
                filterSeverity.value = 'critical';
            } else if (filterType === 'warning') {
                statusFilter.value = 'open';
                filterSeverity.value = 'warning';
            } else if (filterType === 'resolved') {
                statusFilter.value = 'resolved';
                filterSeverity.value = '';
            }

            pagination.reset();
            renderFilteredExceptions();
        });

        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                card.click();
            }
        });
    });

    function syncCardFromDropdowns() {
        const status = statusFilter.value;
        const severity = filterSeverity.value;

        if (status === 'resolved') {
            setActiveFilterCard('resolved');
        } else if (severity === 'critical') {
            setActiveFilterCard('critical');
        } else if (severity === 'warning') {
            setActiveFilterCard('warning');
        } else if (status === 'open') {
            setActiveFilterCard('open');
        } else {
            setActiveFilterCard('');
        }
    }

    function debounce(fn, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    if (searchQuery) {
        searchQuery.addEventListener('input', debounce(() => {
            pagination.reset();
            renderFilteredExceptions();
        }, 250));
    }

    statusFilter.addEventListener('change', () => {
        syncCardFromDropdowns();
        pagination.reset();
        renderFilteredExceptions();
    });

    if (filterSeverity) {
        filterSeverity.addEventListener('change', () => {
            syncCardFromDropdowns();
            pagination.reset();
            renderFilteredExceptions();
        });
    }

    if (clearFiltersBtn) {
        clearFiltersBtn.addEventListener('click', () => {
            if (searchQuery) searchQuery.value = '';
            statusFilter.value = 'open';
            if (filterSeverity) filterSeverity.value = '';
            setActiveFilterCard('open');
            pagination.reset();
            renderFilteredExceptions();
        });
    }

    refreshBtn.addEventListener('click', async () => {
        await loadAllExceptions();
    });

    function openResolveModal(exception) {
        activeException = exception;
        resolveModalReason.textContent = `${exception.event} — ${exception.entity_type} #${exception.entity_id}: ${exception.reason}`;
        resolutionNotes.value = '';
        lastAiDiagnosis = null;
        if (useAsNotesBtn) useAsNotesBtn.style.display = 'none';

        initAiAssistant({
            mountSelector: '#aiAssistantMountRecord',
            context: { scope: 'entity', entity_type: exception.entity_type, entity_id: exception.entity_id },
            label: 'Ask AI',
            onAnswer: (message) => {
                lastAiDiagnosis = message;
                if (useAsNotesBtn) useAsNotesBtn.style.display = 'inline-block';
            },
        });

        confirmAnywayRow.style.display = (exception.entity_type === 'Schedule' || exception.entity_type === 'Relocation') ? '' : 'none';
        confirmAnywayCheckbox.checked = false;
        confirmAnywayLabel.textContent = exception.entity_type === 'Relocation'
            ? 'Also approve this relocation now (admin override)'
            : 'Also confirm this booking now (admin override)';
        resolveModal.style.display = 'flex';
    }

    function closeResolveModal() {
        resolveModal.style.display = 'none';
        activeException = null;
    }

    resolveModalClose.addEventListener('click', closeResolveModal);
    if (cancelResolveBtn) cancelResolveBtn.addEventListener('click', closeResolveModal);
    resolveModal.addEventListener('click', (event) => {
        if (event.target === resolveModal) closeResolveModal();
    });

    if (useAsNotesBtn) {
        useAsNotesBtn.addEventListener('click', () => {
            if (!lastAiDiagnosis) return;
            resolutionNotes.value = lastAiDiagnosis;
            resolutionNotes.focus();
        });
    }

    resolveModalSubmit.addEventListener('click', async () => {
        if (!activeException) return;
        const notes = resolutionNotes.value.trim();
        if (!notes) {
            alert('Resolution notes are required.');
            return;
        }
        await withButtonLoading(resolveModalSubmit, async () => {
            try {
                if (confirmAnywayCheckbox.checked && activeException.entity_type === 'Schedule') {
                    const confirmResult = await api.request(`schedules/${activeException.entity_id}`, {
                        method: 'PUT',
                        body: { status: 'Confirmed', override_exception_id: activeException.exception_id },
                    });
                    if (!confirmResult.success) {
                        alert(confirmResult.error || 'Unable to confirm this booking — resolve without the override, or fix the underlying issue first.');
                        return;
                    }
                }
                if (confirmAnywayCheckbox.checked && activeException.entity_type === 'Relocation') {
                    const approveResult = await api.request(`relocations/${activeException.entity_id}/approve`, {
                        method: 'PUT',
                    });
                    if (!approveResult.success) {
                        alert(approveResult.error || 'Unable to approve this relocation — resolve without the override, or fix the underlying issue first.');
                        return;
                    }
                }
                const result = await api.request(`exceptions/${activeException.exception_id}/resolve`, {
                    method: 'PUT',
                    body: { resolution_notes: notes },
                });
                if (result.success) {
                    closeResolveModal();
                    await loadAllExceptions();
                } else {
                    alert(result.error || 'Unable to resolve this exception.');
                }
            } catch (error) {
                alert(error.message || 'Unable to resolve this exception.');
            }
        });
    });

    async function handleRetry(id, button) {
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(`exceptions/${id}/retry`, { method: 'PUT' });
                if (result.success) {
                    await loadAllExceptions();
                } else {
                    alert(result.error || 'Retry failed.');
                }
            } catch (error) {
                alert(error.message || 'Retry failed.');
            }
        });
    }

    tableBody.addEventListener('click', (event) => {
        const resolveButton = event.target.closest('button[data-action="resolve"]');
        if (resolveButton) {
            const id = Number(resolveButton.getAttribute('data-id'));
            const exception = allExceptions.find((item) => item.exception_id === id);
            if (exception) openResolveModal(exception);
            return;
        }
        const retryButton = event.target.closest('button[data-action="retry"]');
        if (retryButton) {
            handleRetry(Number(retryButton.getAttribute('data-id')), retryButton);
        }
    });

    await loadAllExceptions();

    const deepLinkParams = new URLSearchParams(window.location.search);
    const deepLinkEntityType = deepLinkParams.get('entity_type');
    const deepLinkEntityId = deepLinkParams.get('entity_id');
    if (deepLinkEntityType && deepLinkEntityId) {
        const target = allExceptions.find((item) =>
            item.entity_type === deepLinkEntityType && String(item.entity_id) === String(deepLinkEntityId));
        if (target) openResolveModal(target);
    }
});
