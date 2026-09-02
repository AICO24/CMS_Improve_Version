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

    const statusFilter = document.getElementById('statusFilter');
    const refreshBtn = document.getElementById('refreshExceptionsBtn');
    const tableBody = document.getElementById('exceptionsTableBody');

    const resolveModal = document.getElementById('resolveModal');
    const resolveModalClose = document.getElementById('resolveModalClose');
    const resolveModalReason = document.getElementById('resolveModalReason');
    const useAsNotesBtn = document.getElementById('useAsNotesBtn');
    const resolutionNotes = document.getElementById('resolutionNotes');
    const confirmAnywayRow = document.getElementById('confirmAnywayRow');
    const confirmAnywayCheckbox = document.getElementById('confirmAnywayCheckbox');
    const confirmAnywayLabel = document.getElementById('confirmAnywayLabel');
    const resolveModalSubmit = document.getElementById('resolveModalSubmit');

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
        // .btn-row-action--confirm reuses the same green "positive/completing
        // action" semantic manage-reservations.js already uses it for — see
        // assets/css/components/buttons.css (promoted here from
        // manage-reservations.css during the Full Automation Round 2 button
        // audit; this page was referencing the class without ever linking
        // its defining stylesheet, so it rendered unstyled).
        // Retry (G.7): shown for every open row, not just ones known to
        // support it — the backend has the authoritative, exact list of
        // retryable (event, entity_type) combinations (see
        // SystemExceptionController::retry()) and returns a clear error for
        // anything else, so duplicating that list here would just be a
        // second copy that can drift out of sync.
        const action = exception.status === 'open'
            ? `<button type="button" class="btn-row-action btn-row-action--confirm" data-action="resolve" data-id="${exception.exception_id}">Resolve</button>
               <button type="button" class="btn-row-action" data-action="retry" data-id="${exception.exception_id}">Retry</button>`
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
        resolutionNotes.value = '';
        lastAiDiagnosis = null;
        useAsNotesBtn.style.display = 'none';

        // System-Wide AI Assistant (Phase 4): mounts with this exception's
        // entity context pre-wired — an exception's own entity_type/
        // entity_id already point at a supported AuditIntelligenceService
        // entity (Schedule/Lot/Cremation/etc.), which gives a richer answer
        // than the old explain-exception endpoint's bare event/reason
        // fields. No longer auto-asks on modal open (quota-reduction batch
        // — opening the resolve modal must never cost an LLM call by
        // itself). onAnswer still wires up "Use as resolution notes" once
        // the admin explicitly asks.
        initAiAssistant({
            mountSelector: '#aiAssistantMountRecord',
            context: { scope: 'entity', entity_type: exception.entity_type, entity_id: exception.entity_id },
            label: 'Ask AI',
            onAnswer: (message) => {
                lastAiDiagnosis = message;
                useAsNotesBtn.style.display = 'inline-block';
            },
        });
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

    // "Note down the cause" (System-Wide AI Assistant, Phase 4): the
    // assistant only ever proposes the note text — the admin still reviews/
    // edits it in the textarea and clicks Resolve themselves, same as
    // typing it by hand. Never written directly to resolution_notes without
    // that review step.
    useAsNotesBtn.addEventListener('click', () => {
        if (!lastAiDiagnosis) return;
        resolutionNotes.value = lastAiDiagnosis;
        resolutionNotes.focus();
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

    async function handleRetry(id, button) {
        await withButtonLoading(button, async () => {
            try {
                const result = await api.request(`exceptions/${id}/retry`, { method: 'PUT' });
                if (result.success) {
                    await loadAndRenderExceptions();
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
            const exception = currentExceptions.find((item) => item.exception_id === id);
            if (exception) openResolveModal(exception);
            return;
        }
        const retryButton = event.target.closest('button[data-action="retry"]');
        if (retryButton) {
            handleRetry(Number(retryButton.getAttribute('data-id')), retryButton);
        }
    });

    statusFilter.addEventListener('change', loadAndRenderExceptions);
    refreshBtn.addEventListener('click', loadAndRenderExceptions);

    await loadAndRenderExceptions();

    // Batch H (reservation module audit): Manage Reservations' "Review
    // Exception" link previously just navigated here with no context,
    // dumping the admin into the full open-exceptions list to find the one
    // they came for. It now links with ?entity_type=&entity_id=, so this
    // page can jump straight to the resolve modal for that specific
    // exception instead. Silently does nothing if not found (e.g. it was
    // already resolved by someone else in the meantime, or a stale
    // bookmark) — the admin still lands on a normal, working exceptions
    // list either way, just without the auto-open.
    const deepLinkParams = new URLSearchParams(window.location.search);
    const deepLinkEntityType = deepLinkParams.get('entity_type');
    const deepLinkEntityId = deepLinkParams.get('entity_id');
    if (deepLinkEntityType && deepLinkEntityId) {
        const target = currentExceptions.find((item) =>
            item.entity_type === deepLinkEntityType && String(item.entity_id) === String(deepLinkEntityId));
        if (target) openResolveModal(target);
    }
});
