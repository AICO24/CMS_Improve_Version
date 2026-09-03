document.addEventListener('DOMContentLoaded', async function() {
    const session = await requireRole(['admin', 'staff']);
    if (!session) return;

    // System-Wide AI Assistant: module-scoped to Decedent (covers both
    // plain records and Decedent/Cremation-tagged exceptions, e.g. a failed
    // niche auto-assignment) — no single record selected on load.
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Decedent' },
        greeting: "Hello! I'm your AI assistant for Decedent Records. How can I help you today?",
        suggestions: [
            { icon: 'fa-address-book', label: 'Records on file', question: 'How many decedent records are on file right now?' },
            { icon: 'fa-inbox', label: 'Pending requests', question: 'How many pending decedent registration requests are there?' },
            { icon: 'fa-fire', label: 'Cremation issues', question: 'Are there any issues with cremation or niche assignment for any decedent?' },
            { icon: 'fa-triangle-exclamation', label: 'Any exceptions?', question: 'Are there any open exceptions related to decedent records?' },
        ],
    });

    const lotSelect = document.getElementById('lotNumber');
    const sectionInput = document.getElementById('section');
    const searchInput = document.getElementById('searchInput');
    const typeFilter = document.getElementById('typeFilter');
    const attentionFilter = document.getElementById('attentionFilter');
    const tableBody = document.getElementById('tableBody');
    const recordModal = document.getElementById('recordModal');
    const viewModal = document.getElementById('viewModal');
    const importModal = document.getElementById('importModal');
    const recordForm = document.getElementById('recordForm');
    const ashStorageGroup = document.getElementById('ashStorageGroup');
    const modalTitle = document.getElementById('modalTitle');
    const viewDetails = document.getElementById('viewDetails');

    let lots = [];
    let records = [];
    let currentEditId = null;
    let currentQuery = '';
    let currentTypeFilter = 'all';
    let currentAttentionFilter = false;
    let pendingRequests = [];
    // Set only when "Approve" was clicked on a pending request — saveRecord()
    // checks this after a successful CREATE (never on edit) and links the new
    // decedent_id back to the request. Cleared on any modal close/cancel so a
    // plain "Add New Record" afterward doesn't accidentally approve anything.
    let approvingRequestId = null;

    const perPage = 10;
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');
    const activeFilterChips = document.getElementById('activeFilterChips');
    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        infoEl: paginationInfo,
        itemLabel: 'record',
        onChange: loadRecords,
    });

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    const TYPE_FILTER_LABELS = { no: 'Burial', yes: 'Cremation' };

    // Batch C (completeness/attention): mirrors DecedentController's
    // INCOMPLETE_CONDITION exactly, so a record's badge here always agrees
    // with whether "Needs attention only" would include it.
    function getMissingFields(record) {
        const missing = [];
        if (!record.contact_name) missing.push('Family contact name');
        if (!record.contact_number) missing.push('Family contact number');
        if (!record.cause_of_death) missing.push('Cause of death');
        if (record.is_cremated === 'yes' && !record.ash_storage) missing.push('Ash storage location');
        return missing;
    }

    function renderActiveFilterChips() {
        const chips = [
            { key: 'q', label: 'Search', value: currentQuery, clear: () => { searchInput.value = ''; currentQuery = ''; } },
            { key: 'type', label: 'Type', value: currentTypeFilter !== 'all' ? (TYPE_FILTER_LABELS[currentTypeFilter] || currentTypeFilter) : '', clear: () => { typeFilter.value = 'all'; currentTypeFilter = 'all'; } },
            { key: 'attention', label: 'Attention', value: currentAttentionFilter ? 'Needs attention only' : '', clear: () => { attentionFilter.checked = false; currentAttentionFilter = false; } },
        ].filter((chip) => chip.value);

        if (!activeFilterChips) return;
        activeFilterChips.innerHTML = chips.map((chip) => `
            <span class="filter-chip" data-filter-key="${chip.key}">
                ${escapeHtml(chip.label)}: ${escapeHtml(chip.value)}
                <button type="button" aria-label="Remove ${escapeHtml(chip.label)} filter">&times;</button>
            </span>
        `).join('');

        activeFilterChips.querySelectorAll('.filter-chip').forEach((chipEl) => {
            const chip = chips.find((item) => item.key === chipEl.dataset.filterKey);
            const button = chipEl.querySelector('button');
            if (!chip || !button) return;
            button.addEventListener('click', () => {
                chip.clear();
                pagination.reset();
                loadRecords();
            });
        });
    }

    function debounce(fn, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('cemetery_session');
        localStorage.removeItem('user_session');
        window.location.href = `${getFrontendBasePath()}/auth/login.html`;
    });

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    document.getElementById('openAddModal').addEventListener('click', () => {
        approvingRequestId = null;
        openAddModal();
    });
    document.querySelector('.close').addEventListener('click', () => {
        approvingRequestId = null;
        recordModal.style.display = 'none';
    });
    document.querySelector('.close-view').addEventListener('click', () => viewModal.style.display = 'none');
    document.getElementById('openImportModal').addEventListener('click', () => openImportModal());
    document.querySelector('.close-import').addEventListener('click', () => { importModal.style.display = 'none'; });
    window.addEventListener('click', (e) => {
        if (e.target === recordModal) {
            approvingRequestId = null;
            recordModal.style.display = 'none';
        }
        if (e.target === viewModal) viewModal.style.display = 'none';
        if (e.target === importModal) importModal.style.display = 'none';
    });
    const refreshFiltered = debounce(() => {
        currentQuery = searchInput.value.trim();
        pagination.reset();
        loadRecords();
    }, 300);
    searchInput.addEventListener('input', refreshFiltered);
    typeFilter.addEventListener('change', () => {
        currentTypeFilter = typeFilter.value;
        pagination.reset();
        loadRecords();
    });
    attentionFilter.addEventListener('change', () => {
        currentAttentionFilter = attentionFilter.checked;
        pagination.reset();
        loadRecords();
    });

    recordForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        const saveBtn = recordForm.querySelector('button[type="submit"]');
        await withButtonLoading(saveBtn, saveRecord);
    });

    // Cremation Phase A: lot_id is only required for a decedent who
    // actually has a burial lot — a cremation-only record legitimately has
    // none (see migration_20260903_make_decedent_lot_optional.sql and
    // DecedentController::requiredFieldsError()). Toggled alongside the
    // existing ashStorageGroup show/hide, on the same isCremated change.
    function updateLotRequirement(isCremated) {
        lotSelect.required = isCremated !== 'yes';
        lotSelect.previousElementSibling.textContent = isCremated === 'yes' ? 'Lot Number (optional)' : 'Lot Number';
    }

    document.getElementById('isCremated').addEventListener('change', function() {
        ashStorageGroup.style.display = this.value === 'yes' ? 'block' : 'none';
        updateLotRequirement(this.value);
    });

    lotSelect.addEventListener('change', function() {
        const selectedId = parseInt(this.value, 10);
        const selectedLot = lots.find((lot) => lot.lot_id === selectedId);
        sectionInput.value = selectedLot ? selectedLot.section_name : '';
    });

    await refreshPage();

    async function refreshPage() {
        try {
            await loadLots();
            await loadRecords();
            await loadStats();
            await loadPendingRequests();
        } catch (error) {
            console.error('Failed to initialize page', error);
            tableBody.innerHTML = '<tr><td colspan="8">Could not load records. Please refresh.</td></tr>';
        }
    }

    async function loadPendingRequests() {
        const pendingRequestsBody = document.getElementById('pendingRequestsBody');
        try {
            pendingRequests = await api.request('decedent-requests?status=pending', { method: 'GET' });
            renderPendingRequests();
        } catch (error) {
            console.error('Failed to load pending decedent requests', error);
            pendingRequestsBody.innerHTML = '<tr><td colspan="6">Could not load pending requests.</td></tr>';
        }
    }

    function renderPendingRequests() {
        const pendingRequestsBody = document.getElementById('pendingRequestsBody');
        if (!Array.isArray(pendingRequests) || pendingRequests.length === 0) {
            pendingRequestsBody.innerHTML = `
                <tr>
                    <td colspan="6">
                        <div class="pending-requests-empty-state">
                            <i class="fas fa-inbox"></i>
                            <strong>No pending requests</strong>
                            <span>Citizen-submitted decedent requests will appear here.</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        pendingRequestsBody.innerHTML = pendingRequests.map((request) => `
            <tr data-request-id="${request.request_id}">
                <td>${escapeHtml(request.full_name)} ${request.linked_schedule_id ? '<span class="status-badge status-warning" title="A citizen already booked and may have paid for this — finish the record so their burial can be marked Completed.">Linked to booking #' + escapeHtml(request.linked_schedule_id) + '</span>' : ''} ${request.possible_duplicate_of ? '<span class="status-badge status-danger" title="Another pending request (#' + escapeHtml(request.possible_duplicate_of) + ': ' + escapeHtml(request.possible_duplicate_name) + ') looks similar — check before approving both.">Possible duplicate of #' + escapeHtml(request.possible_duplicate_of) + '</span>' : ''}</td>
                <td>${escapeHtml(request.approximate_dod || '—')}</td>
                <td>${escapeHtml(request.relationship || '—')}</td>
                <td>${escapeHtml(request.requested_by_name || 'Unknown')}</td>
                <td>${escapeHtml(request.created_at)}</td>
                <td class="action-buttons">
                    <button class="btn-approve-request" data-id="${request.request_id}">Approve</button>
                    <button class="btn-reject-request" data-id="${request.request_id}">Reject</button>
                </td>
            </tr>
        `).join('');

        pendingRequestsBody.querySelectorAll('.btn-approve-request').forEach((btn) => {
            btn.addEventListener('click', () => approveRequest(parseInt(btn.dataset.id, 10)));
        });
        pendingRequestsBody.querySelectorAll('.btn-reject-request').forEach((btn) => {
            btn.addEventListener('click', () => rejectRequest(parseInt(btn.dataset.id, 10)));
        });
    }

    // Approve doesn't create the decedent_records row itself — it opens the
    // SAME Add Decedent form staff already uses (pre-filled with the name/
    // dod the citizen supplied, plus — Batch G — the requester's own name/
    // phone number as a starting point for the family contact fields, since
    // the person submitting this request usually IS that contact), so staff
    // still fills in and verifies every sensitive/required field (lot, dob,
    // cause of death, contact info) by hand before saving. saveRecord()
    // links the request to whatever decedent_id that form creates.
    function approveRequest(requestId) {
        const request = pendingRequests.find((item) => item.request_id === requestId);
        if (!request) return;

        approvingRequestId = requestId;
        openAddModal();

        const nameParts = request.full_name.trim().split(/\s+/);
        document.getElementById('firstName').value = nameParts[0] || '';
        document.getElementById('lastName').value = nameParts.slice(1).join(' ') || '';
        if (request.approximate_dod) {
            document.getElementById('dod').value = request.approximate_dod;
        }
        if (request.requested_by_name) {
            document.getElementById('contactName').value = request.requested_by_name;
        }
        if (request.requested_by_contact_number) {
            document.getElementById('contactNumber').value = request.requested_by_contact_number;
        }
    }

    async function rejectRequest(requestId) {
        const reason = prompt('Reason for rejecting this request (shown to no one automatically — staff\'s own record):');
        if (!reason || !reason.trim()) return;
        try {
            const result = await api.request(`decedent-requests/${requestId}/reject`, {
                method: 'PUT',
                body: { rejection_reason: reason.trim() },
            });
            if (result.success) {
                showToast('Request rejected.', { type: 'success' });
                await loadPendingRequests();
            } else {
                showToast(result.error || 'Could not reject request.', { type: 'error' });
            }
        } catch (error) {
            showToast(error.message || 'Could not reject request.', { type: 'error' });
        }
    }

    async function loadLots() {
        lots = await api.request('lots', { method: 'GET' });
        populateLotDropdown();
    }

    function populateLotDropdown() {
        if (!lots || lots.length === 0) {
            lotSelect.innerHTML = '<option value="">No lots available</option>';
            sectionInput.value = '';
            return;
        }

        lotSelect.innerHTML = '<option value="">Select a lot</option>' + lots.map((lot) => {
            return `<option value="${lot.lot_id}" data-section="${lot.section_name}">${lot.lot_number} \u2014 ${lot.section_name}</option>`;
        }).join('');
    }

    async function loadRecords() {
        const params = new URLSearchParams();
        if (currentQuery) params.set('q', currentQuery);
        if (currentTypeFilter !== 'all') params.set('is_cremated', currentTypeFilter);
        if (currentAttentionFilter) params.set('incomplete', '1');
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        try {
            const result = await api.request(`decedents?${params.toString()}`, { method: 'GET' });
            records = Array.isArray(result.data) ? result.data : [];
            renderTable(records);
            renderActiveFilterChips();
            pagination.render(result.meta || { page: 1, total_pages: 1, total: records.length });
        } catch (error) {
            console.error('Failed to load records', error);
            tableBody.innerHTML = '<tr><td colspan="8">Could not load records. Please refresh.</td></tr>';
            pagination.render({ page: 1, total_pages: 1, total: 0 });
        }
    }

    async function loadStats() {
        const stats = await api.request('decedents/stats', { method: 'GET' });
        document.getElementById('totalCount').innerText = stats.total || 0;
        document.getElementById('burialCount').innerText = stats.burials || 0;
        document.getElementById('cremationCount').innerText = stats.cremations || 0;
        document.getElementById('avgAge').innerText = stats.avg_age || 0;
        document.getElementById('attentionCount').innerText = stats.needs_attention || 0;
    }

    function renderTable(items) {
        if (!items || items.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8">
                        <div class="decrec-empty-state">
                            <i class="fas fa-folder-open"></i>
                            <strong>No records found</strong>
                            <span>Adjust the filters or add a new decedent record.</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        tableBody.innerHTML = items.map((item) => {
            const missing = getMissingFields(item);
            const attentionBadge = missing.length
                ? `<i class="fas fa-triangle-exclamation attention-icon" title="Needs attention — missing: ${escapeHtml(missing.join(', '))}"></i>`
                : '';
            return `
            <tr data-id="${item.decedent_id}">
                <td>D-${item.decedent_id}</td>
                <td>${escapeHtml(`${item.first_name} ${item.last_name}${item.suffix ? ' ' + item.suffix : ''}`)}${attentionBadge}</td>
                <td>${escapeHtml(item.dob)}</td>
                <td>${escapeHtml(item.dod)}</td>
                <td>${escapeHtml(item.lot_number)}</td>
                <td>${escapeHtml(item.section_name)}</td>
                <td><span class="status-badge ${item.is_cremated === 'yes' ? 'status-warning' : 'status-success'}">${item.is_cremated === 'yes' ? 'Cremation' : 'Burial'}</span></td>
                <td class="action-buttons">
                    <button class="btn-view" title="View"><i class="fas fa-eye"></i></button>
                    <button class="btn-edit-row" title="Edit"><i class="fas fa-pen"></i></button>
                    <button class="btn-delete-row delete-btn" title="Delete Record">
                        <span class="trash-icon">
                            <i class="fas fa-trash trash-body"></i>
                        </span>
                    </button>
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

        document.querySelectorAll('.btn-edit-row').forEach((btn) => {
            btn.addEventListener('click', () => {
                const row = btn.closest('tr');
                const id = parseInt(row.dataset.id, 10);
                openEditModal(id);
            });
        });

        document.querySelectorAll('.btn-delete-row').forEach((btn) => {
            btn.addEventListener('click', () => {
                const row = btn.closest('tr');
                const id = parseInt(row.dataset.id, 10);
                deleteRecord(id);
            });
        });
    }

    function openAddModal() {
        currentEditId = null;
        modalTitle.innerText = 'Add Decedent Record';
        recordForm.reset();
        document.getElementById('recordId').value = '';
        ashStorageGroup.style.display = 'none';
        if (lotSelect.options.length > 1) {
            lotSelect.selectedIndex = 0;
            sectionInput.value = '';
        }
        updateLotRequirement('no');
        resetCertificateUpload();
        recordModal.style.display = 'flex';
    }

    async function openEditModal(id) {
        const record = records.find((item) => item.decedent_id === id);
        if (!record) {
            return;
        }

        currentEditId = id;
        modalTitle.innerText = 'Edit Decedent Record';
        document.getElementById('recordId').value = id;
        document.getElementById('firstName').value = record.first_name;
        document.getElementById('lastName').value = record.last_name;
        document.getElementById('middleName').value = record.middle_name || '';
        document.getElementById('suffix').value = record.suffix || '';
        document.getElementById('dob').value = record.dob;
        document.getElementById('dod').value = record.dod;
        document.getElementById('cause').value = record.cause_of_death || '';
        document.getElementById('contactName').value = record.contact_name || '';
        document.getElementById('contactNumber').value = record.contact_number || '';
        document.getElementById('isCremated').value = record.is_cremated;
        document.getElementById('ashStorage').value = record.ash_storage || '';

        const selectedLotOption = Array.from(lotSelect.options).find((option) => parseInt(option.value, 10) === record.lot_id);
        if (selectedLotOption) {
            selectedLotOption.selected = true;
            sectionInput.value = selectedLotOption.dataset.section || record.section_name || '';
        }

        ashStorageGroup.style.display = record.is_cremated === 'yes' ? 'block' : 'none';
        updateLotRequirement(record.is_cremated);
        resetCertificateUpload();
        recordModal.style.display = 'flex';
    }

    // ---------- Batch K: document-assisted entry (upload + AI extraction) ----------
    const certificateFileInput = document.getElementById('certificateFileInput');
    const certificateDocType = document.getElementById('certificateDocType');
    const extractCertificateBtn = document.getElementById('extractCertificateBtn');
    const certificateUploadHint = document.getElementById('certificateUploadHint');

    function resetCertificateUpload() {
        certificateFileInput.value = '';
        certificateDocType.value = 'death_certificate';
        certificateUploadHint.textContent = 'This file will be attached to the record automatically once you save.';
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                // reader.result is "data:<mime>;base64,<data>" — the server
                // only wants the raw base64 payload, it already knows the
                // mime type from the same request.
                const commaIndex = reader.result.indexOf(',');
                resolve(commaIndex >= 0 ? reader.result.slice(commaIndex + 1) : reader.result);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    extractCertificateBtn.addEventListener('click', async () => {
        const file = certificateFileInput.files[0];
        if (!file) {
            showToast('Please choose a file first.', { type: 'error' });
            return;
        }

        await withButtonLoading(extractCertificateBtn, async () => {
            try {
                const imageBase64 = await readFileAsBase64(file);
                const response = await api.request('ai/extract-certificate', {
                    method: 'POST',
                    body: { image_base64: imageBase64, mime_type: file.type },
                });
                const result = response && response.result;

                if (!result || (!result.first_name && !result.last_name)) {
                    showToast("Couldn't read this document clearly — please fill in the fields manually.", { type: 'error' });
                    return;
                }

                // Pre-fill only — every field stays a normal, editable input.
                // Staff still reviews everything before Save.
                if (result.first_name) document.getElementById('firstName').value = result.first_name;
                if (result.last_name) document.getElementById('lastName').value = result.last_name;
                if (result.middle_name) document.getElementById('middleName').value = result.middle_name;
                if (result.suffix) document.getElementById('suffix').value = result.suffix;
                if (result.dob) document.getElementById('dob').value = result.dob;
                if (result.dod) document.getElementById('dod').value = result.dod;
                if (result.cause_of_death) document.getElementById('cause').value = result.cause_of_death;

                showToast('Fields filled in from the document — please review before saving.', { type: 'success' });
            } catch (error) {
                showToast(error.message || "Couldn't read this document.", { type: 'error' });
            }
        });
    });

    // Batch K: the same file selected for extraction is attached to the
    // record automatically once it has a real decedent_id — reuses the
    // Batch K1 upload endpoint as-is, no separate "attach" click needed.
    // Upload failures are reported but never undo the record save that
    // already succeeded, same non-blocking convention as the pending-
    // request linking logic just above saveRecord()'s success branch.
    async function attachCertificateIfSelected(decedentId) {
        const file = certificateFileInput.files[0];
        if (!file || !decedentId) return;

        const formData = new FormData();
        formData.append('document_file', file);
        formData.append('document_type', certificateDocType.value);

        try {
            await api.request(`decedents/${decedentId}/documents`, { method: 'POST', body: formData });
        } catch (error) {
            console.error('Record was saved but attaching the document failed', error);
            showToast('Record saved, but attaching the document failed — you can upload it from the record\'s Documents section.', { type: 'error' });
        }
    }

    // Batch D (activity history): audit_logs.details is either a plain note
    // string, `{field: {from, to}}` (DecedentController::update()'s normal
    // diff), or `{field: 'changed'}` for a sensitive field whose value is
    // deliberately redacted before it ever reaches audit_logs — rendered as
    // "updated" rather than the literal word "changed" so it still reads as
    // a sentence.
    function formatAuditDetails(rawDetails) {
        let details = rawDetails;
        if (typeof details === 'string') {
            try {
                details = JSON.parse(details);
            } catch (error) {
                return escapeHtml(rawDetails);
            }
        }
        if (!details || typeof details !== 'object') {
            return '';
        }

        return Object.entries(details).map(([field, value]) => {
            if (field === 'note') return escapeHtml(String(value));
            if (field === 'duplicate_warning_overridden' && value) return 'saved despite a possible-duplicate warning';
            if (value === 'changed') return `${escapeHtml(field)} updated`;
            if (value && typeof value === 'object' && ('from' in value || 'to' in value)) {
                return `${escapeHtml(field)}: ${escapeHtml(value.from ?? '—')} → ${escapeHtml(value.to ?? '—')}`;
            }
            return `${escapeHtml(field)}: ${escapeHtml(String(value))}`;
        }).join('; ');
    }

    function renderActivityTimeline(entries) {
        const timelineEl = document.getElementById('viewActivityTimeline');
        if (!timelineEl) return;

        if (!Array.isArray(entries) || entries.length === 0) {
            timelineEl.innerHTML = '<p class="activity-empty">No activity recorded yet.</p>';
            return;
        }

        timelineEl.innerHTML = entries.map((entry) => {
            const summary = formatAuditDetails(entry.details);
            return `
                <div class="activity-entry">
                    <div class="activity-entry-header">
                        <strong>${escapeHtml(entry.action)}</strong>
                        <span class="activity-entry-time">${escapeHtml(entry.created_at)}</span>
                    </div>
                    <div class="activity-entry-meta">${escapeHtml(entry.user_full_name || entry.username || 'System')}</div>
                    ${summary ? `<div class="activity-entry-details">${summary}</div>` : ''}
                </div>
            `;
        }).join('');
    }

    // Batch K1 (document upload): which decedent the View modal is
    // currently open for — the upload/delete handlers below are wired once
    // (outside openViewModal) and read this to know their target, since the
    // modal's own markup is fixed and only its content changes per record.
    let currentViewDecedentId = null;

    async function openViewModal(id) {
        const record = records.find((item) => item.decedent_id === id);
        if (!record) {
            return;
        }
        currentViewDecedentId = id;

        const missing = getMissingFields(record);
        const attentionNotice = missing.length
            ? `<div class="detail-row"><span>Status</span><strong><span class="status-badge status-warning">Needs Attention</span> — missing: ${escapeHtml(missing.join(', '))}</strong></div>`
            : '';

        const details = `
            ${attentionNotice}
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
        document.getElementById('editFromView').onclick = () => {
            document.getElementById('viewModal').style.display = 'none';
            openEditModal(id);
        };

        const timelineEl = document.getElementById('viewActivityTimeline');
        if (timelineEl) {
            timelineEl.innerHTML = '<p class="activity-loading">Loading activity...</p>';
            try {
                const entries = await api.request(`audit-logs?entity_type=Decedent&entity_id=${id}`, { method: 'GET' });
                renderActivityTimeline(entries);
            } catch (error) {
                console.error('Failed to load activity history', error);
                timelineEl.innerHTML = '<p class="activity-empty">Could not load activity history.</p>';
            }
        }

        await loadDocumentsList(id);
    }

    // ---------- Batch K1: document/certificate upload ----------
    const DOCUMENT_TYPE_LABELS = {
        death_certificate: 'Death Certificate',
        burial_permit: 'Burial Permit',
        other: 'Other',
    };

    async function loadDocumentsList(decedentId) {
        const listEl = document.getElementById('viewDocumentsList');
        if (!listEl) return;
        listEl.innerHTML = '<p class="activity-loading">Loading documents...</p>';
        try {
            const documents = await api.request(`decedents/${decedentId}/documents`, { method: 'GET' });
            renderDocumentsList(Array.isArray(documents) ? documents : []);
        } catch (error) {
            console.error('Failed to load documents', error);
            listEl.innerHTML = '<p class="activity-empty">Could not load documents.</p>';
        }
    }

    function renderDocumentsList(documents) {
        const listEl = document.getElementById('viewDocumentsList');
        if (!listEl) return;

        if (documents.length === 0) {
            listEl.innerHTML = '<p class="activity-empty">No documents uploaded yet.</p>';
            return;
        }

        listEl.innerHTML = documents.map((doc) => `
            <div class="document-entry" data-document-id="${doc.document_id}">
                <span class="status-badge status-info">${escapeHtml(DOCUMENT_TYPE_LABELS[doc.document_type] || 'Other')}</span>
                <a href="${escapeHtml(doc.file_path)}" target="_blank" rel="noopener" class="document-filename">${escapeHtml(doc.original_filename)}</a>
                <span class="document-meta">${escapeHtml(doc.uploaded_by_name || 'Unknown')} · ${escapeHtml(doc.created_at)}</span>
                <button type="button" class="document-delete-btn" title="Delete document" data-document-id="${doc.document_id}"><i class="fas fa-trash"></i></button>
            </div>
        `).join('');

        listEl.querySelectorAll('.document-delete-btn').forEach((btn) => {
            btn.addEventListener('click', () => deleteDocument(btn.dataset.documentId));
        });
    }

    async function deleteDocument(documentId) {
        const proceed = await confirmDialog({
            title: 'Delete this document?',
            message: 'This action cannot be undone.',
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!proceed || !currentViewDecedentId) return;

        try {
            const result = await api.request(`decedents/${currentViewDecedentId}/documents/${documentId}`, { method: 'DELETE' });
            if (result.success) {
                showToast('Document deleted.', { type: 'success' });
                await loadDocumentsList(currentViewDecedentId);
            } else {
                showToast(result.error || 'Could not delete document.', { type: 'error' });
            }
        } catch (error) {
            showToast(error.message || 'Could not delete document.', { type: 'error' });
        }
    }

    document.getElementById('uploadDocumentBtn').addEventListener('click', async () => {
        const fileInput = document.getElementById('documentFileInput');
        const typeSelect = document.getElementById('documentTypeSelect');
        const file = fileInput.files[0];
        if (!file) {
            showToast('Please choose a file first.', { type: 'error' });
            return;
        }
        if (!currentViewDecedentId) return;

        const formData = new FormData();
        formData.append('document_file', file);
        formData.append('document_type', typeSelect.value);

        const uploadBtn = document.getElementById('uploadDocumentBtn');
        await withButtonLoading(uploadBtn, async () => {
            try {
                const result = await api.request(`decedents/${currentViewDecedentId}/documents`, { method: 'POST', body: formData });
                if (result.success) {
                    showToast('Document uploaded.', { type: 'success' });
                    fileInput.value = '';
                    await loadDocumentsList(currentViewDecedentId);
                } else {
                    showToast(result.error || 'Could not upload document.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Could not upload document.', { type: 'error' });
            }
        });
    });

    async function saveRecord() {
        const id = document.getElementById('recordId').value;
        const isCremated = document.getElementById('isCremated').value;
        const lotId = parseInt(lotSelect.value, 10);
        // Cremation Phase A: lot is only required when NOT cremation-only —
        // see updateLotRequirement() and DecedentController::requiredFieldsError().
        if (!lotId && isCremated !== 'yes') {
            showToast('Please select a lot.', { type: 'error' });
            return;
        }

        const payload = {
            lot_id: lotId || null,
            first_name: document.getElementById('firstName').value.trim(),
            last_name: document.getElementById('lastName').value.trim(),
            middle_name: document.getElementById('middleName').value.trim() || null,
            suffix: document.getElementById('suffix').value.trim() || null,
            dob: document.getElementById('dob').value,
            dod: document.getElementById('dod').value,
            cause_of_death: document.getElementById('cause').value.trim() || null,
            contact_name: document.getElementById('contactName').value.trim() || null,
            contact_number: document.getElementById('contactNumber').value.trim() || null,
            is_cremated: document.getElementById('isCremated').value,
            ash_storage: document.getElementById('ashStorage').value.trim() || null,
        };

        const save = () => id
            ? api.request(`decedents/${id}`, { method: 'PUT', body: payload })
            : api.request('decedents', { method: 'POST', body: payload });

        try {
            let result = await save();

            // Batch B (duplicate detection): a near-duplicate doesn't block
            // the save (only an exact match does — that comes back as a
            // thrown error via the catch block below, same as any other
            // validation failure). Staff sees who it might match and
            // explicitly decides whether to proceed.
            if (result.duplicate_warning) {
                const list = result.candidates.map((c) => `D-${c.decedent_id}: ${c.name} (${c.dob} to ${c.dod})`).join('; ');
                const proceed = await confirmDialog({
                    title: 'Possible duplicate record',
                    message: `${result.message} Matches: ${list}`,
                    confirmLabel: 'Save anyway',
                });
                if (!proceed) {
                    return;
                }
                payload.confirm_duplicate = true;
                result = await save();
            }

            if (result.success) {
                // Only on CREATE (id was empty) and only when this save
                // started from "Approve" on a pending request — links the
                // brand-new decedent_id back so the request stops showing
                // as pending. A failure here is logged but doesn't block
                // the record itself, which is already saved.
                if (!id && approvingRequestId && result.decedent_id) {
                    const approvedRequest = pendingRequests.find((item) => item.request_id === approvingRequestId);
                    try {
                        await api.request(`decedent-requests/${approvingRequestId}/approve`, {
                            method: 'PUT',
                            body: { decedent_id: result.decedent_id },
                        });
                    } catch (linkError) {
                        console.error('Record was created but linking the pending request failed', linkError);
                    }
                    // Full Automation, Admin-First: if a citizen already booked
                    // against this request (see ScheduleController::store()'s
                    // provisional-decedent path), link the new formal record onto
                    // that schedule too — this is what unblocks marking it
                    // Completed (see ScheduleController::update()'s guard).
                    if (approvedRequest && approvedRequest.linked_schedule_id) {
                        try {
                            await api.request(`schedules/${approvedRequest.linked_schedule_id}/link-decedent`, {
                                method: 'PUT',
                                body: { decedent_id: result.decedent_id },
                            });
                        } catch (linkError) {
                            console.error('Record was created but linking it to the existing booking failed', linkError);
                        }
                    }
                }

                // Batch F (suggested schedule linking): only reachable when
                // this create wasn't via "Approve" (that path's own schedule,
                // if any, was just handled above) — the backend only returns
                // this for a lot that has an existing schedule with no
                // decedent_request_id of its own. Tier 2: offered, never
                // applied automatically.
                if (!id && result.suggested_schedules && result.suggested_schedules.length === 1) {
                    const schedule = result.suggested_schedules[0];
                    const when = schedule.schedule_time ? `${schedule.schedule_date} ${schedule.schedule_time}` : schedule.schedule_date;
                    const link = await confirmDialog({
                        title: 'Link to an existing schedule?',
                        message: `This lot already has an unlinked burial schedule (${when}, ${schedule.status}). Link this new record to it?`,
                        confirmLabel: 'Link schedule',
                    });
                    if (link) {
                        try {
                            await api.request(`schedules/${schedule.schedule_id}/link-decedent`, {
                                method: 'PUT',
                                body: { decedent_id: result.decedent_id },
                            });
                            showToast('Linked to the existing schedule.', { type: 'success' });
                        } catch (linkError) {
                            showToast(linkError.message || 'Could not link the schedule.', { type: 'error' });
                        }
                    }
                } else if (!id && result.suggested_schedules && result.suggested_schedules.length > 1) {
                    // More than one candidate — guessing which one would risk
                    // linking the wrong booking, so this only points staff at
                    // where to resolve it by hand instead of picking for them.
                    showToast(`This lot has ${result.suggested_schedules.length} unlinked schedules. Link the correct one from Manage Reservations.`, { type: 'info' });
                }

                await attachCertificateIfSelected(id || result.decedent_id);

                approvingRequestId = null;
                recordModal.style.display = 'none';
                showToast(id ? 'Decedent record updated.' : 'Decedent record created.', { type: 'success' });
                pagination.reset();
                await refreshPage();
            } else {
                showToast(result.error || 'Could not save record.', { type: 'error' });
            }
        } catch (error) {
            showToast(error.message || 'Could not save record.', { type: 'error' });
        }
    }

    async function deleteRecord(id) {
        const proceed = await confirmDialog({
            title: 'Delete this record?',
            message: 'This action cannot be undone.',
            confirmLabel: 'Delete',
            danger: true,
        });
        if (!proceed) {
            return;
        }
        try {
            const result = await api.request(`decedents/${id}`, { method: 'DELETE' });
            if (result.success) {
                showToast('Decedent record deleted.', { type: 'success' });
                await refreshPage();
            } else {
                showToast(result.error || 'Could not delete record.', { type: 'error' });
            }
        } catch (error) {
            showToast(error.message || 'Could not delete record.', { type: 'error' });
        }
    }

    // ---------- Batch J: bulk CSV import ----------
    // importPreviewRows holds the server's per-row evaluation (status/
    // errors/warnings/parsed data) between Preview and Confirm — the file
    // itself is never re-uploaded or stored server-side; only this parsed,
    // annotated JSON travels to the confirm step.
    let importPreviewRows = [];

    const importFileInput = document.getElementById('importFileInput');
    const previewImportBtn = document.getElementById('previewImportBtn');
    const importPreviewSection = document.getElementById('importPreviewSection');
    const importSummaryEl = document.getElementById('importSummary');
    const importPreviewBody = document.getElementById('importPreviewBody');
    const confirmImportBtn = document.getElementById('confirmImportBtn');

    function openImportModal() {
        importFileInput.value = '';
        importPreviewRows = [];
        importPreviewSection.hidden = true;
        importPreviewBody.innerHTML = '';
        importModal.style.display = 'flex';
    }

    document.getElementById('downloadImportTemplate').addEventListener('click', () => {
        // A few varied example rows (not just one) so the template reads as
        // an organized little table when opened, not a single crammed line.
        const columns = ['first_name', 'last_name', 'middle_name', 'suffix', 'dob', 'dod', 'lot_number', 'section_name', 'cause_of_death', 'contact_name', 'contact_number', 'is_cremated', 'ash_storage'];
        const sampleRows = [
            ['Juan', 'Dela Cruz', 'Santos', '', '1950-01-01', '2020-03-15', 'A1-01', 'Section A', 'Natural causes', 'Maria Dela Cruz', '09171234567', 'no', ''],
            ['Rosario', 'Villanueva', '', 'Jr.', '1945-06-20', '2019-11-02', 'A1-02', 'Section A', 'Cardiac arrest', 'Pedro Villanueva', '09182223344', 'no', ''],
            ['Elena', 'Bautista', 'Reyes', '', '1938-09-08', '2021-04-10', 'B1-05', 'Section B', 'Old age', 'Ana Bautista', '09193334455', 'yes', 'Columbarium Niche 12'],
        ];
        const csvRows = [columns, ...sampleRows].map((row) => row.join(','));
        const blob = new Blob([csvRows.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = 'decedent_import_template.csv';
        document.body.appendChild(link);
        link.click();
        link.remove();
        URL.revokeObjectURL(url);
    });

    const STATUS_LABELS = {
        ready: 'Ready',
        needs_review: 'Needs Review',
        rejected: 'Rejected',
    };
    const STATUS_BADGE_CLASS = {
        ready: 'status-success',
        needs_review: 'status-warning',
        rejected: 'status-danger',
    };

    function renderImportPreview(preview) {
        importPreviewRows = Array.isArray(preview.rows) ? preview.rows : [];
        const summary = preview.summary || {};
        importSummaryEl.innerHTML = `
            <strong>${summary.total || 0}</strong> row(s) —
            <span class="status-badge status-success">${summary.ready || 0} ready</span>
            <span class="status-badge status-warning">${summary.needs_review || 0} need review</span>
            <span class="status-badge status-danger">${summary.rejected || 0} rejected</span>
        `;

        importPreviewBody.innerHTML = importPreviewRows.map((row, index) => {
            const checked = row.status === 'ready' ? 'checked' : '';
            const disabled = row.status === 'rejected' ? 'disabled' : '';
            const notes = [...(row.errors || []), ...(row.warnings || [])].join('; ') || '—';
            return `
                <tr data-index="${index}">
                    <td><input type="checkbox" class="import-row-check" ${checked} ${disabled}></td>
                    <td>${row.row_number}</td>
                    <td>${escapeHtml(`${row.data.first_name} ${row.data.last_name}`)}</td>
                    <td>${escapeHtml(row.data.dob)} — ${escapeHtml(row.data.dod)}</td>
                    <td>${escapeHtml(row.lot_number)} (${escapeHtml(row.section_name)})</td>
                    <td><span class="status-badge ${STATUS_BADGE_CLASS[row.status]}">${STATUS_LABELS[row.status]}</span> <span class="import-row-notes">${escapeHtml(notes)}</span></td>
                </tr>
            `;
        }).join('');

        importPreviewSection.hidden = false;
    }

    previewImportBtn.addEventListener('click', async () => {
        const file = importFileInput.files[0];
        if (!file) {
            showToast('Please choose a CSV file first.', { type: 'error' });
            return;
        }

        const formData = new FormData();
        formData.append('csv_file', file);

        await withButtonLoading(previewImportBtn, async () => {
            try {
                const preview = await api.request('decedents/import/preview', { method: 'POST', body: formData });
                renderImportPreview(preview);
            } catch (error) {
                showToast(error.message || 'Could not preview this file.', { type: 'error' });
            }
        });
    });

    confirmImportBtn.addEventListener('click', async () => {
        const checkedRows = [];
        importPreviewBody.querySelectorAll('tr').forEach((tr) => {
            const checkbox = tr.querySelector('.import-row-check');
            if (!checkbox || !checkbox.checked) return;
            const index = parseInt(tr.dataset.index, 10);
            const row = importPreviewRows[index];
            if (!row) return;
            // A row still checked despite a near-duplicate warning is staff
            // explicitly choosing to keep it — same confirm_duplicate
            // contract the single-record Add form already uses (Batch B).
            checkedRows.push({
                row_number: row.row_number,
                data: row.data,
                confirm_duplicate: row.status === 'needs_review',
            });
        });

        if (checkedRows.length === 0) {
            showToast('No rows selected to import.', { type: 'error' });
            return;
        }

        await withButtonLoading(confirmImportBtn, async () => {
            try {
                const result = await api.request('decedents/import/confirm', {
                    method: 'POST',
                    body: { rows: checkedRows },
                });
                const failedCount = (result.failed || []).length;
                if (failedCount > 0) {
                    const detail = result.failed.map((f) => `Row ${f.row_number}: ${f.error}`).join('; ');
                    showToast(`Imported ${result.imported}, ${failedCount} failed — ${detail}`, { type: failedCount === checkedRows.length ? 'error' : 'info', duration: 8000 });
                } else {
                    showToast(result.message || 'Import complete.', { type: 'success' });
                }
                importModal.style.display = 'none';
                pagination.reset();
                await refreshPage();
            } catch (error) {
                showToast(error.message || 'Could not complete the import.', { type: 'error' });
            }
        });
    });
    // (escapeHtml is defined once, near the top of this file — this file
    // used to have a second, functionally-identical copy down here.)
});