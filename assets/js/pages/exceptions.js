// Admin/staff "Exceptions" page — the open-items queue the Automation
// Engine (backend/services/AutomationEngine.php) raises into when a
// normally-automatic transition (e.g. payment verified -> auto-confirm
// booking) can't safely proceed. This is the admin Control Center's
// "needs attention" surface, not a routine approval queue — most bookings
// never appear here at all.
document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin', 'staff']);
    if (!user) return;

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

    const statusFilter = document.getElementById('statusFilter');
    const refreshBtn = document.getElementById('refreshExceptionsBtn');
    const tableBody = document.getElementById('exceptionsTableBody');

    const resolveModal = document.getElementById('resolveModal');
    const resolveModalClose = document.getElementById('resolveModalClose');
    const resolveModalReason = document.getElementById('resolveModalReason');
    const resolveModalAiExplanation = document.getElementById('resolveModalAiExplanation');
    const askAiExplainBtn = document.getElementById('askAiExplainBtn');
    const resolutionNotes = document.getElementById('resolutionNotes');
    const confirmAnywayRow = document.getElementById('confirmAnywayRow');
    const confirmAnywayCheckbox = document.getElementById('confirmAnywayCheckbox');
    const confirmAnywayLabel = document.getElementById('confirmAnywayLabel');
    const resolveModalSubmit = document.getElementById('resolveModalSubmit');

    let activeException = null;

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
            ? `<button type="button" class="btn-row-action" data-action="resolve" data-id="${exception.exception_id}">Resolve</button>`
            : `<span class="muted">${escapeHtml(exception.resolved_by_name || 'Resolved')}</span>`;
        return `
            <tr data-id="${exception.exception_id}">
                <td>${escapeHtml(exception.created_at)}</td>
                <td>${escapeHtml(exception.event)}</td>
                <td>${escapeHtml(exception.entity_type)} #${escapeHtml(exception.entity_id)}</td>
                <td>${escapeHtml(exception.reason)}</td>
                <td>${buildSeverityBadge(exception.severity)}</td>
                <td>${buildStatusBadge(exception.status)}</td>
                <td>${action}</td>
            </tr>
        `;
    }

    let currentExceptions = [];

    async function loadAndRenderExceptions() {
        tableBody.innerHTML = '<tr><td colspan="7">Loading exceptions...</td></tr>';
        try {
            const params = new URLSearchParams();
            if (statusFilter.value) params.set('status', statusFilter.value);
            const exceptions = await api.request(`exceptions?${params.toString()}`, { method: 'GET' });
            currentExceptions = Array.isArray(exceptions) ? exceptions : [];
            tableBody.innerHTML = currentExceptions.length > 0
                ? currentExceptions.map(buildRow).join('')
                : '<tr><td colspan="7" style="text-align:center; padding: 32px;"><i class="fas fa-circle-check"></i> <strong>Nothing needs attention</strong> — normal transactions are confirming automatically.</td></tr>';
        } catch (error) {
            console.error('Failed to load exceptions', error);
            tableBody.innerHTML = '<tr><td colspan="7">Unable to load exceptions right now.</td></tr>';
        }
    }

    function openResolveModal(exception) {
        activeException = exception;
        resolveModalReason.textContent = `${exception.event} — ${exception.entity_type} #${exception.entity_id}: ${exception.reason}`;
        resolveModalAiExplanation.style.display = 'none';
        resolveModalAiExplanation.textContent = '';
        resolutionNotes.value = '';
        // The "confirm anyway" override only makes sense for an entity type
        // that has its own resolvable pending decision — a booking (Schedule)
        // waiting on confirmation, or (Round 2) a relocation request whose
        // auto-approval hit a lot-availability exception. Resolving a Payment
        // or Lot-tagged exception has no such decision to force through here.
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
    resolveModal.addEventListener('click', (event) => {
        if (event.target === resolveModal) closeResolveModal();
    });

    askAiExplainBtn.addEventListener('click', async () => {
        if (!activeException) return;
        await withButtonLoading(askAiExplainBtn, async () => {
            try {
                const result = await api.request('ai/explain-exception', {
                    method: 'POST',
                    body: {
                        event: activeException.event,
                        entity_type: activeException.entity_type,
                        entity_id: activeException.entity_id,
                        reason: activeException.reason,
                        severity: activeException.severity,
                    },
                });
                if (result && result.explained && result.message) {
                    resolveModalAiExplanation.textContent = result.message;
                    resolveModalAiExplanation.style.display = 'block';
                } else {
                    resolveModalAiExplanation.textContent = 'AI explanation is unavailable right now.';
                    resolveModalAiExplanation.style.display = 'block';
                }
            } catch (error) {
                resolveModalAiExplanation.textContent = 'AI explanation is unavailable right now.';
                resolveModalAiExplanation.style.display = 'block';
            }
        });
    });

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
                    // override_exception_id lets the backend record this PUT as
                    // an explicit admin override of a flagged exception, not an
                    // ordinary confirmation — see ScheduleController::update().
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
                    // Same manual-override path RelocationController::approve()
                    // has always exposed — re-checks the destination lot itself,
                    // so this still fails cleanly if it's genuinely unavailable
                    // rather than forcing a bad state.
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
                    await loadAndRenderExceptions();
                } else {
                    alert(result.error || 'Unable to resolve this exception.');
                }
            } catch (error) {
                alert(error.message || 'Unable to resolve this exception.');
            }
        });
    });

    tableBody.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-action="resolve"]');
        if (!button) return;
        const id = Number(button.getAttribute('data-id'));
        const exception = currentExceptions.find((item) => item.exception_id === id);
        if (exception) openResolveModal(exception);
    });

    statusFilter.addEventListener('change', loadAndRenderExceptions);
    refreshBtn.addEventListener('click', loadAndRenderExceptions);

    await loadAndRenderExceptions();
});
