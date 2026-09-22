document.addEventListener('DOMContentLoaded', async function () {
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
    const searchClearBtn = document.getElementById('searchClearBtn');
    const typeFilter = document.getElementById('typeFilter');
    const sectionFilter = document.getElementById('sectionFilter');
    const attentionFilter = document.getElementById('attentionFilter');
    const exportCsvBtn = document.getElementById('exportCsvBtn');
    const tableBody = document.getElementById('tableBody');
    const recordModal = document.getElementById('recordModal');
    const viewModal = document.getElementById('viewModal');
    const importModal = document.getElementById('importModal');
    const verifyModal = document.getElementById('verifyRequirementsModal');
    const verifyForm = document.getElementById('verifyRequirementsForm');
    const closeVerifyModalBtn = document.getElementById('closeVerifyModalBtn');
    const cancelVerifyBtn = document.getElementById('cancelVerifyBtn');
    const submitVerifyBtn = document.getElementById('submitVerifyBtn');
    const verifyDecedentId = document.getElementById('verifyDecedentId');
    const verifyDecedentName = document.getElementById('verifyDecedentName');
    const verifyDob = document.getElementById('verifyDob');
    const verifyCause = document.getElementById('verifyCause');
    const verifyContactName = document.getElementById('verifyContactName');
    const verifyContactNumber = document.getElementById('verifyContactNumber');
    const verifyDocFile = document.getElementById('verifyDocFile');
    const verifyConfirmCheckbox = document.getElementById('verifyConfirmCheckbox');
    const recordForm = document.getElementById('recordForm');
    const ashStorageGroup = document.getElementById('ashStorageGroup');
    const viewDetails = document.getElementById('viewDetails');
    const dobInput = document.getElementById('dob');
    const dodInput = document.getElementById('dod');
    const ageCalculationBanner = document.getElementById('ageCalculationBanner');
    const ageCalcText = document.getElementById('ageCalcText');
    const ageCalcMilestone = document.getElementById('ageCalcMilestone');

    let lots = [];
    let records = [];
    let currentEditId = null;
    let currentQuery = '';
    let currentTypeFilter = 'all';
    let currentSectionFilter = '';
    let currentAttentionFilter = false;
    let currentDocumentStatusFilter = '';
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

    // Batch 2: Real-time Age at Death & Milestone Calculator
    function computeAgeInfo(dobStr, dodStr) {
        if (!dobStr || !dodStr) return null;
        const dob = new Date(dobStr);
        const dod = new Date(dodStr);
        if (isNaN(dob.getTime()) || isNaN(dod.getTime())) return null;
        if (dod < dob) {
            return { isValid: false, message: 'Date of Death cannot be earlier than Date of Birth' };
        }

        let years = dod.getFullYear() - dob.getFullYear();
        let months = dod.getMonth() - dob.getMonth();
        let days = dod.getDate() - dob.getDate();

        if (days < 0) {
            months--;
            const prevMonth = new Date(dod.getFullYear(), dod.getMonth(), 0);
            days += prevMonth.getDate();
        }
        if (months < 0) {
            years--;
            months += 12;
        }

        let milestone = '';
        let milestoneClass = '';
        let milestoneIcon = '';

        if (years >= 100) {
            milestone = 'Centenarian';
            milestoneClass = 'milestone-centenarian';
            milestoneIcon = 'fa-crown';
        } else if (years >= 60) {
            milestone = 'Senior Citizen';
            milestoneClass = 'milestone-senior';
            milestoneIcon = 'fa-user-clock';
        } else if (years >= 18) {
            milestone = 'Adult';
            milestoneClass = 'milestone-adult';
            milestoneIcon = 'fa-user';
        } else if (years >= 1) {
            milestone = 'Minor';
            milestoneClass = 'milestone-child';
            milestoneIcon = 'fa-child';
        } else {
            milestone = 'Infant';
            milestoneClass = 'milestone-infant';
            milestoneIcon = 'fa-baby';
        }

        let formatted = '';
        if (years > 0) {
            formatted = `${years} ${years === 1 ? 'yr' : 'yrs'} old`;
            if (months > 0 && years < 5) {
                formatted += `, ${months} ${months === 1 ? 'mo' : 'mos'}`;
            }
        } else if (months > 0) {
            formatted = `${months} ${months === 1 ? 'mo' : 'mos'} old`;
            if (days > 0) {
                formatted += `, ${days} ${days === 1 ? 'day' : 'days'}`;
            }
        } else {
            formatted = `${days} ${days === 1 ? 'day' : 'days'} old`;
        }

        return {
            isValid: true,
            years,
            months,
            days,
            formatted,
            shortAge: years > 0 ? `${years}y` : (months > 0 ? `${months}m` : `${days}d`),
            milestone,
            milestoneClass,
            milestoneIcon
        };
    }

    // Batch 2: Exhumation / Bone Transfer Eligibility (PD 856 5-Year Standard)
    function computeExhumationEligibility(dodStr, isCremated) {
        if (isCremated === 'yes') {
            return {
                status: 'cremated',
                cardClass: 'is-cremated',
                tag: 'Cremated Remains',
                icon: 'fa-fire-burner',
                title: 'Exempt from Waiting Period',
                desc: 'Cremated remains are exempt from the standard 5-year burial sanitation waiting period. Niche placement or ossuary relocation can proceed anytime upon request.'
            };
        }

        if (!dodStr) {
            return {
                status: 'unknown',
                cardClass: 'is-locked',
                tag: 'Date Pending',
                icon: 'fa-calendar-xmark',
                title: 'Eligibility Unknown',
                desc: 'Date of death is required to compute exhumation and bone transfer clearance.'
            };
        }

        const dod = new Date(dodStr);
        if (isNaN(dod.getTime())) {
            return {
                status: 'unknown',
                cardClass: 'is-locked',
                tag: 'Invalid Date',
                icon: 'fa-triangle-exclamation',
                title: 'Unparseable Date of Death',
                desc: 'Date of death is not formatted correctly.'
            };
        }

        const now = new Date();
        const diffTime = now.getTime() - dod.getTime();
        const diffYears = diffTime / (1000 * 60 * 60 * 24 * 365.25);

        const eligibleDate = new Date(dod);
        eligibleDate.setFullYear(eligibleDate.getFullYear() + 5);
        const eligibleDateStr = eligibleDate.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });

        if (diffYears >= 5) {
            const elapsedYears = diffYears.toFixed(1);
            return {
                status: 'eligible',
                cardClass: 'is-eligible',
                tag: 'Eligible for Transfer',
                icon: 'fa-check-double',
                title: 'Bone Transfer / Exhumation Clearance Ready',
                desc: `Standard sanitary burial requirement met under PD 856 (${elapsedYears} years elapsed since burial). Remains are legally eligible for exhumation, bone crypt placement, or ossuary transfer.`
            };
        } else {
            const remainingYears = (5 - diffYears).toFixed(1);
            return {
                status: 'locked',
                cardClass: 'is-locked',
                tag: 'Burial Period Active',
                icon: 'fa-hourglass-half',
                title: 'Standard Burial Period In Progress',
                desc: `Standard 5-year sanitation waiting period is ongoing (${remainingYears} years remaining until ~${eligibleDateStr}). Early exhumation requires special permit from the City Health Office.`
            };
        }
    }

    function updateAgeCalculationBanner() {
        if (!ageCalculationBanner || !ageCalcText || !ageCalcMilestone) return;

        const dobVal = dobInput ? dobInput.value : '';
        const dodVal = dodInput ? dodInput.value : '';

        if (!dobVal || !dodVal) {
            ageCalculationBanner.style.display = 'none';
            if (dodInput) dodInput.style.borderColor = '';
            return;
        }

        const info = computeAgeInfo(dobVal, dodVal);
        if (!info) {
            ageCalculationBanner.style.display = 'none';
            return;
        }

        ageCalculationBanner.style.display = 'block';
        const box = ageCalculationBanner.querySelector('.age-calc-box');

        if (!info.isValid) {
            if (box) box.classList.add('is-invalid');
            if (dodInput) dodInput.style.borderColor = '#ef4444';
            ageCalcText.innerText = 'Invalid Dates: DOD cannot be earlier than DOB';
            ageCalcMilestone.innerHTML = `<span class="age-milestone" style="background: rgba(239, 68, 68, 0.15); color: #dc2626;"><i class="fas fa-circle-exclamation"></i> Error</span>`;
        } else {
            if (box) box.classList.remove('is-invalid');
            if (dodInput) dodInput.style.borderColor = '';
            ageCalcText.innerText = info.formatted;
            ageCalcMilestone.innerHTML = `<span class="age-milestone ${info.milestoneClass}"><i class="fas ${info.milestoneIcon}"></i> ${escapeHtml(info.milestone)}</span>`;
        }
    }

    if (dobInput) {
        dobInput.addEventListener('input', updateAgeCalculationBanner);
        dobInput.addEventListener('change', updateAgeCalculationBanner);
    }
    if (dodInput) {
        dodInput.addEventListener('input', updateAgeCalculationBanner);
        dodInput.addEventListener('change', updateAgeCalculationBanner);
    }

    function renderActiveFilterChips() {
        const chips = [
            { key: 'q', label: 'Search', value: currentQuery, clear: () => { searchInput.value = ''; currentQuery = ''; if (searchClearBtn) searchClearBtn.style.display = 'none'; } },
            { key: 'section', label: 'Section', value: currentSectionFilter, clear: () => { if (sectionFilter) sectionFilter.value = ''; currentSectionFilter = ''; } },
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
        return function (...args) {
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

    // ── Reports-style Sub-Tabs switching ──
    const tabBtnAll = document.getElementById('tabBtnAllRecords');
    const tabBtnPending = document.getElementById('tabBtnPendingRequests');
    const paneAll = document.getElementById('allRecordsTabPane');
    const panePending = document.getElementById('pendingRequestsTabPane');
    const pendingBadge = document.getElementById('pendingRequestsBadge');

    function switchRecordsTab(tab) {
        const bottomFilters = document.getElementById('decrecPanelBottomRow');
        const divider = document.getElementById('decrecPanelDivider');
        if (tab === 'pending') {
            if (tabBtnPending) tabBtnPending.classList.add('active');
            if (tabBtnAll) tabBtnAll.classList.remove('active');
            if (panePending) panePending.style.display = 'block';
            if (paneAll) paneAll.style.display = 'none';
            if (bottomFilters) bottomFilters.style.display = 'none';
            if (divider) divider.style.display = 'none';
        } else {
            if (tabBtnAll) tabBtnAll.classList.add('active');
            if (tabBtnPending) tabBtnPending.classList.remove('active');
            if (paneAll) paneAll.style.display = 'block';
            if (panePending) panePending.style.display = 'none';
            if (bottomFilters) bottomFilters.style.display = 'flex';
            if (divider) divider.style.display = 'block';
        }
    }

    if (tabBtnAll && tabBtnPending) {
        tabBtnAll.addEventListener('click', () => switchRecordsTab('all'));
        tabBtnPending.addEventListener('click', () => switchRecordsTab('pending'));
    }

    document.getElementById('openAddModal').addEventListener('click', () => {
        approvingRequestId = null;
        openAddModal();
    });
    document.querySelectorAll('.close, .close-record-modal-btn').forEach((btn) => {
        btn.addEventListener('click', () => {
            approvingRequestId = null;
            recordModal.style.display = 'none';
        });
    });

    const toggleAiDocBtn = document.getElementById('toggleAiDocBtn');
    const aiDocDrawer = document.getElementById('aiDocDrawer');
    const aiToggleCaret = document.getElementById('aiToggleCaret');
    if (toggleAiDocBtn && aiDocDrawer) {
        toggleAiDocBtn.addEventListener('click', () => {
            const isOpen = aiDocDrawer.style.display !== 'none';
            aiDocDrawer.style.display = isOpen ? 'none' : 'block';
            if (aiToggleCaret) aiToggleCaret.classList.toggle('is-open', !isOpen);
        });
    }
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
        if (e.target === verifyModal) verifyModal.style.display = 'none';
    });
    const refreshFiltered = debounce(() => {
        currentQuery = searchInput.value.trim();
        if (searchClearBtn) searchClearBtn.style.display = currentQuery ? 'block' : 'none';
        updateActiveStatCards();
        pagination.reset();
        loadRecords();
    }, 300);
    searchInput.addEventListener('input', refreshFiltered);

    if (searchClearBtn) {
        searchClearBtn.addEventListener('click', () => {
            searchInput.value = '';
            currentQuery = '';
            searchClearBtn.style.display = 'none';
            updateActiveStatCards();
            pagination.reset();
            loadRecords();
            searchInput.focus();
        });
    }

    if (sectionFilter) {
        sectionFilter.addEventListener('change', () => {
            currentSectionFilter = sectionFilter.value;
            updateActiveStatCards();
            pagination.reset();
            loadRecords();
        });
    }

    typeFilter.addEventListener('change', () => {
        currentTypeFilter = typeFilter.value;
        updateActiveStatCards();
        pagination.reset();
        loadRecords();
    });

    attentionFilter.addEventListener('change', () => {
        currentAttentionFilter = attentionFilter.checked;
        updateActiveStatCards();
        pagination.reset();
        loadRecords();
    });

    // ── Interactive Stat Cards ──
    function updateActiveStatCards() {
        document.querySelectorAll('.stat-card-filterable').forEach(card => {
            const filter = card.dataset.statusFilter;
            let isActive = false;
            if (filter === 'all') {
                isActive = (currentTypeFilter === 'all' && !currentAttentionFilter && !currentSectionFilter && !currentQuery && !currentDocumentStatusFilter);
            } else if (filter === 'no') {
                isActive = (currentTypeFilter === 'no');
            } else if (filter === 'yes') {
                isActive = (currentTypeFilter === 'yes');
            } else if (filter === 'pending_requirements') {
                isActive = (currentDocumentStatusFilter === 'pending_requirements');
            } else if (filter === 'attention') {
                isActive = Boolean(currentAttentionFilter);
            }
            card.classList.toggle('is-active-filter', isActive);
        });
    }

    document.querySelectorAll('.stat-card-filterable').forEach(card => {
        card.addEventListener('click', () => {
            const filter = card.dataset.statusFilter;
            if (filter === 'all') {
                currentTypeFilter = 'all';
                currentAttentionFilter = false;
                currentDocumentStatusFilter = '';
                currentSectionFilter = '';
                currentQuery = '';
                typeFilter.value = 'all';
                attentionFilter.checked = false;
                if (sectionFilter) sectionFilter.value = '';
                searchInput.value = '';
                if (searchClearBtn) searchClearBtn.style.display = 'none';
            } else if (filter === 'no') {
                currentTypeFilter = (currentTypeFilter === 'no') ? 'all' : 'no';
                typeFilter.value = currentTypeFilter;
            } else if (filter === 'yes') {
                currentTypeFilter = (currentTypeFilter === 'yes') ? 'all' : 'yes';
                typeFilter.value = currentTypeFilter;
            } else if (filter === 'pending_requirements') {
                currentDocumentStatusFilter = (currentDocumentStatusFilter === 'pending_requirements') ? '' : 'pending_requirements';
            } else if (filter === 'attention') {
                currentAttentionFilter = !currentAttentionFilter;
                attentionFilter.checked = currentAttentionFilter;
            }
            updateActiveStatCards();
            pagination.reset();
            loadRecords();
        });
    });

    // ── 1-Click CSV Export for Filtered Records ──
    if (exportCsvBtn) {
        exportCsvBtn.addEventListener('click', async () => {
            await withButtonLoading(exportCsvBtn, async () => {
                try {
                    const exportParams = new URLSearchParams();
                    if (currentQuery) exportParams.set('q', currentQuery);
                    if (currentTypeFilter !== 'all') exportParams.set('is_cremated', currentTypeFilter);
                    if (currentSectionFilter) exportParams.set('section', currentSectionFilter);
                    if (currentAttentionFilter) exportParams.set('incomplete', '1');
                    exportParams.set('per_page', '5000');

                    const res = await api.request(`decedents?${exportParams.toString()}`, { method: 'GET' });
                    const list = Array.isArray(res.data) ? res.data : (Array.isArray(res) ? res : []);

                    if (!list || list.length === 0) {
                        if (typeof showToast === 'function') showToast('No records available to export.', { type: 'info' });
                        return;
                    }

                    const headers = ['Record ID', 'First Name', 'Middle Name', 'Last Name', 'Suffix', 'Date of Birth', 'Date of Death', 'Type', 'Lot Number', 'Section', 'Cause of Death', 'Family Contact Name', 'Family Contact Phone', 'Ash Storage Location'];
                    const csvRows = [headers.join(',')];

                    list.forEach(r => {
                        const typeLabel = r.is_cremated === 'yes' ? 'Cremation' : 'Burial';
                        const row = [
                            `"D-${r.decedent_id || ''}"`,
                            `"${(r.first_name || '').replace(/"/g, '""')}"`,
                            `"${(r.middle_name || '').replace(/"/g, '""')}"`,
                            `"${(r.last_name || '').replace(/"/g, '""')}"`,
                            `"${(r.suffix || '').replace(/"/g, '""')}"`,
                            `"${r.dob || ''}"`,
                            `"${r.dod || ''}"`,
                            `"${typeLabel}"`,
                            `"${(r.lot_number || '').replace(/"/g, '""')}"`,
                            `"${(r.section_name || '').replace(/"/g, '""')}"`,
                            `"${(r.cause_of_death || '').replace(/"/g, '""')}"`,
                            `"${(r.contact_name || '').replace(/"/g, '""')}"`,
                            `"${(r.contact_number || '').replace(/"/g, '""')}"`,
                            `"${(r.ash_storage || '').replace(/"/g, '""')}"`,
                        ];
                        csvRows.push(row.join(','));
                    });

                    const csvBlob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
                    const url = URL.createObjectURL(csvBlob);
                    const a = document.createElement('a');
                    const filename = `decedent_records_${new Date().toISOString().split('T')[0]}.csv`;
                    a.href = url;
                    a.download = filename;
                    document.body.appendChild(a);
                    a.click();
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);

                    if (typeof showToast === 'function') {
                        showToast(`Successfully exported ${list.length} decedent records to CSV.`, { type: 'success' });
                    }
                } catch (err) {
                    if (typeof showToast === 'function') {
                        showToast('Export failed: ' + (err.message || 'Error exporting'), { type: 'error' });
                    }
                }
            });
        });
    }

    recordForm.addEventListener('submit', async function (event) {
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

    document.getElementById('isCremated').addEventListener('change', function () {
        ashStorageGroup.style.display = this.value === 'yes' ? 'block' : 'none';
        updateLotRequirement(this.value);
    });

    lotSelect.addEventListener('change', function () {
        const selectedId = parseInt(this.value, 10);
        const selectedLot = lots.find((lot) => lot.lot_id === selectedId);
        sectionInput.value = selectedLot ? selectedLot.section_name : '';
    });

    // Check for query parameters (e.g. redirected from Lot Management "View Decedent Profile")
    const urlParams = new URLSearchParams(window.location.search);
    const initialSearch = urlParams.get('search');
    if (initialSearch) {
        currentQuery = initialSearch.trim();
        if (searchInput) searchInput.value = currentQuery;
        if (searchClearBtn) searchClearBtn.style.display = 'block';
    }

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
            if (pendingBadge) {
                const count = Array.isArray(pendingRequests) ? pendingRequests.length : 0;
                pendingBadge.textContent = count;
                pendingBadge.style.display = count > 0 ? 'inline-flex' : 'none';
            }
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

        pendingRequestsBody.innerHTML = pendingRequests.map((request) => {
            const hasDoc = Boolean(request.attachment_path);
            const docBadge = hasDoc
                ? `<span class="status-badge status-info" title="Citizen uploaded document: ${escapeHtml(request.attachment_original_filename || 'Attachment')}"><i class="fas fa-paperclip"></i> Attachment</span>`
                : '';
            const scheduleBadge = request.linked_schedule_id
                ? `<span class="status-badge status-warning" title="A citizen already booked and may have paid for this — finish the record so their burial can be marked Completed.">Burial #${escapeHtml(request.linked_schedule_id)}</span>`
                : '';
            const cremationBadge = request.linked_cremation_id
                ? `<span class="status-badge status-warning" title="Citizen booked cremation — finish the record so their cremation can proceed.">Cremation #${escapeHtml(request.linked_cremation_id)}</span>`
                : '';
            const dupBadge = request.possible_duplicate_of
                ? `<span class="status-badge status-danger" title="Another pending request (#${escapeHtml(request.possible_duplicate_of)}: ${escapeHtml(request.possible_duplicate_name)}) looks similar — check before approving both.">Possible duplicate of #${escapeHtml(request.possible_duplicate_of)}</span>`
                : '';

            return `
            <tr data-request-id="${request.request_id}">
                <td>${escapeHtml(request.full_name)} ${scheduleBadge} ${cremationBadge} ${docBadge} ${dupBadge}</td>
                <td>${escapeHtml(request.approximate_dod || '—')}</td>
                <td>${escapeHtml(request.relationship || '—')}</td>
                <td>${escapeHtml(request.requested_by_name || 'Unknown')}</td>
                <td>${escapeHtml(request.created_at)}</td>
                <td class="action-buttons">
                    <button class="btn-approve-request" data-id="${request.request_id}" title="Review & Approve Registration Request">
                        <i class="fas fa-check"></i>
                        <span>Approve</span>
                    </button>
                    <button class="btn-reject-request" data-id="${request.request_id}" title="Reject Request">
                        <i class="fas fa-xmark"></i>
                        <span>Reject</span>
                    </button>
                </td>
            </tr>
        `;
        }).join('');

        pendingRequestsBody.querySelectorAll('.btn-approve-request').forEach((btn) => {
            btn.addEventListener('click', () => approveRequest(parseInt(btn.dataset.id, 10)));
        });
        pendingRequestsBody.querySelectorAll('.btn-reject-request').forEach((btn) => {
            btn.addEventListener('click', () => rejectRequest(parseInt(btn.dataset.id, 10)));
        });
    }

    // Batch 3 (Automated Data Prefill): Intelligently splits a full name string
    // into canonical components: first_name, middle_name, last_name, suffix.
    // Handles suffixes (Jr, Sr, III, etc.), inverted comma format ("Santos, Juan M."),
    // compound Filipino/Spanish surnames (De La Cruz, Del Rosario, San Jose),
    // and middle initials with clean Title Casing.
    function parseFullName(fullName) {
        if (!fullName || typeof fullName !== 'string') {
            return { first_name: '', middle_name: '', last_name: '', suffix: '' };
        }

        const raw = fullName.trim().replace(/\s+/g, ' ');
        if (!raw) {
            return { first_name: '', middle_name: '', last_name: '', suffix: '' };
        }

        const knownSuffixes = {
            'jr': 'Jr.', 'jr.': 'Jr.',
            'sr': 'Sr.', 'sr.': 'Sr.',
            'ii': 'II', 'iii': 'III', 'iv': 'IV', 'v': 'V', 'vi': 'VI', 'vii': 'VII', 'viii': 'VIII', 'ix': 'IX', 'x': 'X',
            '1st': '1st', '2nd': '2nd', '3rd': '3rd',
        };

        const compoundSurnameMulti = ['de la', 'de los', 'de las', 'delos', 'delas', 'van der', 'van den', 'van de', 'von der'];
        const compoundSurnameSingle = ['san', 'santa', 'santo', 'del', 'de', 'dela', 'delos', 'delas', 'van', 'von', 'da', 'das', 'dos', 'al'];

        let suffix = '';

        function toTitleCase(str) {
            if (!str) return '';
            const lowerParticles = ['de', 'del', 'da', 'la', 'le', 'y', 'van', 'von'];
            const words = str.toLowerCase().split(' ');
            return words.map((w, idx) => {
                if (idx > 0 && lowerParticles.includes(w)) {
                    return w;
                }
                return w.charAt(0).toUpperCase() + w.slice(1);
            }).join(' ');
        }

        // Check for "Last, First Middle [Suffix]" format
        if (raw.includes(',')) {
            const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
            if (parts.length >= 2) {
                const lastNamePart = parts[0];
                const firstMiddlePart = parts[1];

                if (parts[2]) {
                    const clean3 = parts[2].toLowerCase().replace(/\.$/, '');
                    if (knownSuffixes[clean3]) {
                        suffix = knownSuffixes[clean3];
                    }
                }

                let tokens = firstMiddlePart.split(' ');
                if (!suffix && tokens.length > 1) {
                    const lastTok = tokens[tokens.length - 1].toLowerCase().replace(/\.$/, '');
                    if (knownSuffixes[lastTok]) {
                        suffix = knownSuffixes[lastTok];
                        tokens.pop();
                    }
                }

                let firstName = '';
                let middleName = '';
                if (tokens.length === 1) {
                    firstName = tokens[0];
                } else if (tokens.length === 2) {
                    if (/^[A-Za-z]\.?$/.test(tokens[1])) {
                        firstName = tokens[0];
                        middleName = tokens[1];
                    } else {
                        const compoundFirstLeads = ['maria', 'mary', 'john', 'juan', 'mark', 'anne', 'ana', 'jose'];
                        if (compoundFirstLeads.includes(tokens[0].toLowerCase())) {
                            firstName = tokens.join(' ');
                        } else {
                            firstName = tokens[0];
                            middleName = tokens[1];
                        }
                    }
                } else {
                    middleName = tokens.pop();
                    firstName = tokens.join(' ');
                }

                if (middleName && /^[A-Za-z]$/.test(middleName)) {
                    middleName += '.';
                }

                return {
                    first_name: toTitleCase(firstName),
                    middle_name: toTitleCase(middleName),
                    last_name: toTitleCase(lastNamePart),
                    suffix: suffix,
                };
            }
        }

        // Standard "First [Middle] Last [Suffix]"
        let tokens = raw.split(' ');

        if (tokens.length > 1) {
            const lastTok = tokens[tokens.length - 1].toLowerCase().replace(/\.$/, '');
            if (knownSuffixes[lastTok]) {
                suffix = knownSuffixes[lastTok];
                tokens.pop();
            }
        }

        if (tokens.length === 1) {
            return {
                first_name: toTitleCase(tokens[0]),
                middle_name: '',
                last_name: '',
                suffix: suffix,
            };
        }

        let lastName = '';
        const len = tokens.length;
        if (len >= 4 && compoundSurnameMulti.includes((tokens[len - 3] + ' ' + tokens[len - 2]).toLowerCase())) {
            lastName = tokens.splice(len - 3, 3).join(' ');
        } else if (len >= 3 && compoundSurnameSingle.includes(tokens[len - 2].toLowerCase())) {
            lastName = tokens.splice(len - 2, 2).join(' ');
        } else {
            lastName = tokens.pop();
        }

        let firstName = '';
        let middleName = '';
        if (tokens.length === 1) {
            firstName = tokens[0];
        } else if (tokens.length === 2) {
            if (/^[A-Za-z]\.?$/.test(tokens[1])) {
                firstName = tokens[0];
                middleName = tokens[1];
            } else {
                const compoundFirstLeads = ['maria', 'mary', 'john', 'juan', 'mark', 'anne', 'ana', 'jose'];
                if (compoundFirstLeads.includes(tokens[0].toLowerCase())) {
                    firstName = tokens.join(' ');
                } else {
                    firstName = tokens[0];
                    middleName = tokens[1];
                }
            }
        } else {
            const lastTok = tokens[tokens.length - 1];
            if (/^[A-Za-z]\.?$/.test(lastTok)) {
                middleName = tokens.pop();
                firstName = tokens.join(' ');
            } else {
                middleName = tokens.pop();
                firstName = tokens.join(' ');
            }
        }

        if (middleName && /^[A-Za-z]$/.test(middleName)) {
            middleName += '.';
        }

        return {
            first_name: toTitleCase(firstName),
            middle_name: toTitleCase(middleName),
            last_name: toTitleCase(lastName),
            suffix: suffix,
        };
    }

    function showRequestApprovalBanner(request) {
        const banner = document.getElementById('requestApprovalBanner');
        if (!banner) return;

        const rel = request.relationship ? `Relationship: <strong>${escapeHtml(request.relationship)}</strong>` : '';
        const notes = request.notes ? `<div class="banner-notes"><i class="fas fa-comment-dots"></i> "${escapeHtml(request.notes)}"</div>` : '';
        const docInfo = request.attachment_path
            ? `<span class="banner-link-pill"><i class="fas fa-paperclip"></i> Attached: ${escapeHtml(request.attachment_original_filename || 'Document')}</span>`
            : '';
        const linkInfo = request.linked_cremation_id
            ? `<span class="banner-link-pill"><i class="fas fa-fire"></i> Cremation #${escapeHtml(request.linked_cremation_id)}</span>`
            : (request.linked_schedule_id
                ? `<span class="banner-link-pill"><i class="fas fa-calendar-check"></i> Booking #${escapeHtml(request.linked_schedule_id)}</span>`
                : '');

        banner.innerHTML = `
            <div class="banner-header">
                <div class="banner-title"><i class="fas fa-clipboard-user"></i> Citizen Registration Request #${escapeHtml(request.request_id)}</div>
                <div style="display: flex; gap: 6px; flex-wrap: wrap;">
                    ${linkInfo}
                    ${docInfo}
                </div>
            </div>
            <div class="banner-body">
                <span>Requested by <strong>${escapeHtml(request.requested_by_name || 'Citizen')}</strong> ${rel ? '· ' + rel : ''}</span>
                ${notes}
            </div>
        `;
        banner.style.display = 'block';
    }

    function setupCitizenAttachmentPreview(request) {
        if (!request || !request.attachment_path) return;

        if (certDropzonePlaceholder) certDropzonePlaceholder.style.display = 'none';
        if (certPreviewContainer) certPreviewContainer.style.display = 'flex';

        const isImage = /\.(jpg|jpeg|png|webp)$/i.test(request.attachment_path);
        if (isImage) {
            if (certPreviewImg) {
                certPreviewImg.src = request.attachment_path;
                certPreviewImg.style.display = 'block';
            }
            if (certPreviewPdf) certPreviewPdf.style.display = 'none';
        } else {
            if (certPreviewImg) certPreviewImg.style.display = 'none';
            if (certPreviewPdf) {
                certPreviewPdf.style.display = 'flex';
                if (certPdfName) certPdfName.textContent = request.attachment_original_filename || 'Citizen Document (PDF)';
            }
        }

        if (certificateUploadHint) {
            certificateUploadHint.textContent = `Citizen document on file: ${request.attachment_original_filename || 'Attachment'}. Will be finalized into documents upon approval.`;
        }
    }

    // Approve opens the Add Decedent form pre-filled with the citizen-supplied
    // information using intelligent name splitting, contact auto-fill, and
    // existing attachment preview with 1-click AI extraction.
    function approveRequest(requestId) {
        const request = pendingRequests.find((item) => item.request_id === requestId);
        if (!request) return;

        approvingRequestId = requestId;
        openAddModal();

        modalTitle.innerText = `Approve Request #${requestId} — Add Decedent Record`;

        // Intelligent Name Splitting: use backend-parsed or JS parser fallback
        const parsed = request.parsed_name || parseFullName(request.full_name);
        document.getElementById('firstName').value = parsed.first_name || '';
        document.getElementById('middleName').value = parsed.middle_name || '';
        document.getElementById('lastName').value = parsed.last_name || '';
        document.getElementById('suffix').value = parsed.suffix || '';

        // Visual highlight on prefilled name fields
        ['firstName', 'middleName', 'lastName', 'suffix'].forEach((fId) => {
            const el = document.getElementById(fId);
            if (el && el.value) {
                el.style.transition = 'box-shadow 300ms ease, border-color 300ms ease';
                el.style.borderColor = '#10b981';
                el.style.boxShadow = '0 0 0 2px rgba(16, 185, 129, 0.2)';
                setTimeout(() => {
                    el.style.borderColor = '';
                    el.style.boxShadow = '';
                }, 2000);
            }
        });

        if (request.approximate_dod) {
            document.getElementById('dod').value = request.approximate_dod;
        }
        if (request.requested_by_name) {
            document.getElementById('contactName').value = request.requested_by_name;
        }
        if (request.requested_by_contact_number) {
            document.getElementById('contactNumber').value = request.requested_by_contact_number;
        }

        // Cremation alignment
        if (request.linked_cremation_id) {
            document.getElementById('isCremated').value = 'yes';
            ashStorageGroup.style.display = 'block';
            updateLotRequirement('yes');
        }

        // Render context banner inside modal
        showRequestApprovalBanner(request);

        // Document handling: preview citizen attachment
        if (request.attachment_path) {
            setupCitizenAttachmentPreview(request);
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
        populateSectionFilter();
    }

    function populateSectionFilter() {
        if (!sectionFilter || !Array.isArray(lots)) return;
        const currentVal = sectionFilter.value;
        const sections = [...new Set(lots.map((l) => l.section_name).filter(Boolean))].sort();
        sectionFilter.innerHTML = '<option value="">All Sections</option>' +
            sections.map((s) => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
        if (currentVal && sections.includes(currentVal)) {
            sectionFilter.value = currentVal;
        }
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
        if (currentSectionFilter) params.set('section', currentSectionFilter);
        if (currentAttentionFilter) params.set('incomplete', '1');
        if (currentDocumentStatusFilter) params.set('document_status', currentDocumentStatusFilter);
        params.set('page', pagination.page);
        params.set('per_page', perPage);
        try {
            const result = await api.request(`decedents?${params.toString()}`, { method: 'GET' });
            records = Array.isArray(result.data) ? result.data : [];
            renderTable(records);
            renderActiveFilterChips();
            updateActiveStatCards();
            pagination.render(result.meta || { page: 1, total_pages: 1, total: records.length });
        } catch (error) {
            console.error('Failed to load records', error);
            tableBody.innerHTML = '<tr><td colspan="9">Could not load records. Please refresh.</td></tr>';
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
        const pendingReqEl = document.getElementById('pendingReqCount');
        if (pendingReqEl) pendingReqEl.innerText = stats.pending_requirements || 0;
    }

    function renderTable(items) {
        if (!items || items.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="9">
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
            const ageInfo = computeAgeInfo(item.dob, item.dod);
            const tableAgePill = (ageInfo && ageInfo.isValid)
                ? `<span class="table-age-pill ${ageInfo.milestoneClass}" title="${escapeHtml(ageInfo.formatted)} (${escapeHtml(ageInfo.milestone)})">${escapeHtml(ageInfo.shortAge)}</span>`
                : '';

            const isPendingReq = (item.document_status === 'pending_requirements');
            const complianceBadge = isPendingReq
                ? `<button type="button" class="btn-verify-req compliance-action-badge pending" title="Pending requirements from booking — Click to review and verify documents"><i class="fas fa-clock"></i> To Follow <i class="fas fa-arrow-up-right-from-square pill-icon"></i></button>`
                : `<span class="compliance-action-badge verified" title="Documentary requirements verified and complete"><i class="fas fa-circle-check"></i> Complete</span>`;

            return `
            <tr data-id="${item.decedent_id}">
                <td>D-${item.decedent_id}</td>
                <td>${escapeHtml(`${item.first_name} ${item.last_name}${item.suffix ? ' ' + item.suffix : ''}`)}${attentionBadge}</td>
                <td>${item.dob ? escapeHtml(item.dob) : '<span style="color:#888; font-style: italic;">To follow</span>'}</td>
                <td>
                    <div class="dod-cell-wrap">
                        <span>${escapeHtml(item.dod)}</span>
                        ${tableAgePill}
                    </div>
                </td>
                <td>${item.lot_number ? escapeHtml(item.lot_number) : '—'}</td>
                <td>${item.section_name ? escapeHtml(item.section_name) : '—'}</td>
                <td><span class="status-badge ${item.is_cremated === 'yes' ? 'status-warning' : 'status-success'}">${item.is_cremated === 'yes' ? 'Cremation' : 'Burial'}</span></td>
                <td>${complianceBadge}</td>
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
        document.querySelectorAll('.btn-verify-req').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                const row = btn.closest('tr');
                const id = parseInt(row.dataset.id, 10);
                openVerifyModal(id);
            });
        });

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
        updateAgeCalculationBanner();
        const banner = document.getElementById('requestApprovalBanner');
        if (banner) {
            banner.innerHTML = '';
            banner.style.display = 'none';
        }
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
        updateAgeCalculationBanner();
        recordModal.style.display = 'flex';
    }

    // ---------- Batch K: document-assisted entry (upload + AI extraction) ----------
    const certificateFileInput = document.getElementById('certificateFileInput');
    const certificateDocType = document.getElementById('certificateDocType');
    const extractCertificateBtn = document.getElementById('extractCertificateBtn');
    const certificateUploadHint = document.getElementById('certificateUploadHint');
    const certPreviewContainer = document.getElementById('certPreviewContainer');
    const certDropzonePlaceholder = document.getElementById('certDropzonePlaceholder');
    const certPreviewImg = document.getElementById('certPreviewImg');
    const certPreviewPdf = document.getElementById('certPreviewPdf');
    const certPdfName = document.getElementById('certPdfName');
    const clearCertFileBtn = document.getElementById('clearCertFileBtn');
    const extractionStatusChips = document.getElementById('extractionStatusChips');

    function resetCertificateUpload() {
        if (certificateFileInput) certificateFileInput.value = '';
        if (certificateDocType) certificateDocType.value = 'death_certificate';
        if (certificateUploadHint) certificateUploadHint.textContent = 'This file will be attached to the record automatically once you save.';
        if (certPreviewContainer) certPreviewContainer.style.display = 'none';
        if (certDropzonePlaceholder) certDropzonePlaceholder.style.display = 'flex';
        if (certPreviewImg) { certPreviewImg.src = ''; certPreviewImg.style.display = 'none'; }
        if (certPreviewPdf) certPreviewPdf.style.display = 'none';
        if (extractionStatusChips) { extractionStatusChips.innerHTML = ''; extractionStatusChips.style.display = 'none'; }
        const drawer = document.getElementById('aiDocDrawer');
        const caret = document.getElementById('aiToggleCaret');
        if (drawer) {
            drawer.style.display = 'none';
            if (caret) caret.classList.remove('is-open');
        }
    }

    if (certificateFileInput) {
        certificateFileInput.addEventListener('change', () => {
            const file = certificateFileInput.files[0];
            if (!file) {
                resetCertificateUpload();
                return;
            }
            if (certDropzonePlaceholder) certDropzonePlaceholder.style.display = 'none';
            if (certPreviewContainer) certPreviewContainer.style.display = 'flex';

            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (e) => {
                    if (certPreviewImg) {
                        certPreviewImg.src = e.target.result;
                        certPreviewImg.style.display = 'block';
                    }
                    if (certPreviewPdf) certPreviewPdf.style.display = 'none';
                };
                reader.readAsDataURL(file);
            } else {
                if (certPreviewImg) certPreviewImg.style.display = 'none';
                if (certPreviewPdf) {
                    certPreviewPdf.style.display = 'flex';
                    if (certPdfName) certPdfName.textContent = file.name;
                }
            }
        });
    }

    if (clearCertFileBtn) {
        clearCertFileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            resetCertificateUpload();
        });
    }

    function readFileAsBase64(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const commaIndex = reader.result.indexOf(',');
                resolve(commaIndex >= 0 ? reader.result.slice(commaIndex + 1) : reader.result);
            };
            reader.onerror = () => reject(reader.error);
            reader.readAsDataURL(file);
        });
    }

    extractCertificateBtn.addEventListener('click', async () => {
        const file = certificateFileInput.files[0];
        const activeRequest = approvingRequestId ? pendingRequests.find((r) => r.request_id === approvingRequestId) : null;
        const requestAttachmentPath = activeRequest && activeRequest.attachment_path;

        if (!file && !requestAttachmentPath) {
            showToast('Please choose a file first.', { type: 'error' });
            return;
        }

        await withButtonLoading(extractCertificateBtn, async () => {
            try {
                let payload = {};
                if (file) {
                    const imageBase64 = await readFileAsBase64(file);
                    payload = { image_base64: imageBase64, mime_type: file.type };
                } else {
                    payload = { attachment_path: requestAttachmentPath };
                }

                const response = await api.request('ai/extract-certificate', {
                    method: 'POST',
                    body: payload,
                });
                const result = response && response.result;

                if (!result || (!result.first_name && !result.last_name)) {
                    showToast("Couldn't read this document clearly — please fill in the fields manually.", { type: 'error' });
                    return;
                }

                // Pre-fill only — every field stays a normal, editable input.
                const extractedFields = [];
                function fillAndHighlight(id, val, label) {
                    if (val) {
                        const el = document.getElementById(id);
                        if (el) {
                            el.value = val;
                            el.style.transition = 'box-shadow 300ms ease, border-color 300ms ease';
                            el.style.borderColor = '#10b981';
                            el.style.boxShadow = '0 0 0 3px rgba(16, 185, 129, 0.25)';
                            setTimeout(() => {
                                el.style.borderColor = '';
                                el.style.boxShadow = '';
                            }, 2500);
                        }
                        extractedFields.push(label);
                    }
                }

                fillAndHighlight('firstName', result.first_name, 'First Name');
                fillAndHighlight('lastName', result.last_name, 'Last Name');
                fillAndHighlight('middleName', result.middle_name, 'Middle Name');
                fillAndHighlight('suffix', result.suffix, 'Suffix');
                fillAndHighlight('dob', result.dob, 'DOB');
                fillAndHighlight('dod', result.dod, 'DOD');
                fillAndHighlight('cause', result.cause_of_death, 'Cause of Death');
                updateAgeCalculationBanner();

                if (extractionStatusChips && extractedFields.length) {
                    extractionStatusChips.style.display = 'flex';
                    extractionStatusChips.innerHTML = extractedFields.map((f) => `<span class="extraction-chip"><i class="fas fa-check"></i> ${escapeHtml(f)}</span>`).join('');
                }

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

        const AUDIT_FIELD_LABELS = {
            first_name: 'First Name',
            last_name: 'Last Name',
            middle_name: 'Middle Name',
            suffix: 'Suffix',
            dob: 'Date of Birth',
            dod: 'Date of Death',
            cause_of_death: 'Cause of Death',
            lot_id: 'Plot ID',
            lot_number: 'Lot Number',
            section_name: 'Section',
            contact_name: 'Family Contact',
            contact_number: 'Contact Number',
            is_cremated: 'Cremated',
            ash_storage: 'Ash Storage Location',
            status: 'Status',
        };

        return Object.entries(details).map(([field, value]) => {
            if (field === 'note') return `<span class="audit-note">${escapeHtml(String(value))}</span>`;
            if (field === 'duplicate_warning_overridden' && value) return '<span class="audit-warn-badge">Saved despite duplicate warning</span>';
            const label = AUDIT_FIELD_LABELS[field] || field.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
            if (value === 'changed') return `<span class="audit-chip"><strong>${escapeHtml(label)}</strong> updated</span>`;
            if (value && typeof value === 'object' && ('from' in value || 'to' in value)) {
                return `<span class="audit-chip"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(value.from ?? '—')} → ${escapeHtml(value.to ?? '—')}</span>`;
            }
            return `<span class="audit-chip"><strong>${escapeHtml(label)}:</strong> ${escapeHtml(String(value))}</span>`;
        }).join(' ');
    }

    function renderActivityTimeline(entries) {
        const timelineEl = document.getElementById('viewActivityTimeline');
        if (!timelineEl) return;

        if (!Array.isArray(entries) || entries.length === 0) {
            timelineEl.innerHTML = '<p class="activity-empty"><i class="fas fa-clock-rotate-left"></i> No activity recorded yet for this record.</p>';
            return;
        }

        timelineEl.innerHTML = entries.map((entry) => {
            const actionLower = (entry.action || '').toLowerCase();
            let iconClass = 'fa-circle-dot';
            let badgeClass = 'timeline-badge--default';
            if (actionLower.includes('creat') || actionLower.includes('add')) {
                iconClass = 'fa-circle-plus';
                badgeClass = 'timeline-badge--created';
            } else if (actionLower.includes('update') || actionLower.includes('edit')) {
                iconClass = 'fa-pen-to-square';
                badgeClass = 'timeline-badge--updated';
            } else if (actionLower.includes('delete') || actionLower.includes('remov')) {
                iconClass = 'fa-trash-can';
                badgeClass = 'timeline-badge--deleted';
            } else if (actionLower.includes('document') || actionLower.includes('upload')) {
                iconClass = 'fa-file-arrow-up';
                badgeClass = 'timeline-badge--document';
            }

            const summary = formatAuditDetails(entry.details);
            return `
                <div class="activity-entry">
                    <div class="timeline-indicator ${badgeClass}">
                        <i class="fas ${iconClass}"></i>
                    </div>
                    <div class="activity-entry-content">
                        <div class="activity-entry-header">
                            <strong class="activity-action-title">${escapeHtml(entry.action)}</strong>
                            <span class="activity-entry-time"><i class="far fa-clock"></i> ${escapeHtml(entry.created_at)}</span>
                        </div>
                        <div class="activity-entry-meta"><i class="far fa-user"></i> ${escapeHtml(entry.user_full_name || entry.username || 'System Administrator')}</div>
                        ${summary ? `<div class="activity-entry-details">${summary}</div>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Batch K1 (document upload): which decedent the View modal is
    // currently open for — the upload/delete handlers below are wired once
    // (outside openViewModal) and read this to know their target, since the
    // modal's own markup is fixed and only its content changes per record.
    let currentViewDecedentId = null;

    function calculateAge(dobStr, dodStr) {
        if (!dobStr || !dodStr) return '';
        const dob = new Date(dobStr);
        const dod = new Date(dodStr);
        if (isNaN(dob.getTime()) || isNaN(dod.getTime())) return '';
        let age = dod.getFullYear() - dob.getFullYear();
        const m = dod.getMonth() - dob.getMonth();
        if (m < 0 || (m === 0 && dod.getDate() < dob.getDate())) {
            age--;
        }
        return age >= 0 ? `${age} yrs old` : '';
    }

    async function openViewModal(id) {
        const record = records.find((item) => item.decedent_id === id);
        if (!record) {
            return;
        }
        currentViewDecedentId = id;

        // Reset document picker label
        const documentFileInput = document.getElementById('documentFileInput');
        const documentFileText = document.getElementById('documentFileText');
        if (documentFileInput) documentFileInput.value = '';
        if (documentFileText) {
            documentFileText.textContent = 'Select file (.pdf, .jpg, .png)';
            documentFileText.parentElement.classList.remove('has-file');
        }

        const missing = getMissingFields(record);
        const isPendingReq = (record.document_status === 'pending_requirements');
        const statusBadgeHtml = isPendingReq
            ? `<div class="view-status-wrap">
                 <button type="button" class="compliance-action-badge pending" id="viewModalVerifyBtn" style="font-size: 0.78rem; padding: 6px 14px;"><i class="fas fa-clock"></i> To Follow — Review &amp; Verify <i class="fas fa-arrow-up-right-from-square pill-icon"></i></button>
               </div>`
            : (missing.length
                ? `<div class="view-status-wrap">
                     <span class="view-status-badge badge--warning"><i class="fas fa-triangle-exclamation"></i> Needs Attention</span>
                     <span class="view-missing-note">Missing: ${escapeHtml(missing.join(', '))}</span>
                   </div>`
                : `<div class="view-status-wrap">
                     <span class="view-status-badge badge--complete"><i class="fas fa-circle-check"></i> Complete &amp; Verified</span>
                   </div>`);

        const fullName = `${escapeHtml(record.first_name)} ${record.middle_name ? escapeHtml(record.middle_name) + ' ' : ''}${escapeHtml(record.last_name)}${record.suffix ? ' ' + escapeHtml(record.suffix) : ''}`;
        const ageInfo = computeAgeInfo(record.dob, record.dod);
        const ageBadgeHtml = (ageInfo && ageInfo.isValid)
            ? `<span class="view-lifespan-pill ${ageInfo.milestoneClass}"><i class="fas ${ageInfo.milestoneIcon}"></i> ${escapeHtml(ageInfo.formatted)} (${escapeHtml(ageInfo.milestone)})</span>`
            : '';

        const eligibility = computeExhumationEligibility(record.dod, record.is_cremated);
        const eligibilityHtml = `
            <div class="view-exhumation-card ${eligibility.cardClass}">
                <div class="view-exhumation-icon">
                    <i class="fas ${eligibility.icon}"></i>
                </div>
                <div class="view-exhumation-content">
                    <div class="view-exhumation-header">
                        <span class="view-exhumation-title">${escapeHtml(eligibility.title)}</span>
                        <span class="view-exhumation-tag">${escapeHtml(eligibility.tag)}</span>
                    </div>
                    <p class="view-exhumation-desc">${escapeHtml(eligibility.desc)}</p>
                </div>
            </div>
        `;

        const details = `
            <div class="view-hero-card">
                <div class="view-hero-avatar">
                    <i class="fas fa-monument"></i>
                </div>
                <div class="view-hero-info">
                    <div class="view-hero-title-row">
                        <h2 class="view-decedent-name">${fullName}</h2>
                        ${statusBadgeHtml}
                    </div>
                    <div class="view-hero-lifespan">
                        <i class="fas fa-calendar-day"></i>
                        <span>${escapeHtml(record.dob || '—')} — ${escapeHtml(record.dod || '—')}</span>
                        ${ageBadgeHtml}
                    </div>
                </div>
            </div>

            ${eligibilityHtml}

            <div class="view-details-grid">
                <!-- Card 1: Vital & Burial Information -->
                <div class="view-info-card">
                    <div class="view-card-header">
                        <i class="fas fa-user-circle"></i>
                        <span>Vital & Burial Details</span>
                    </div>
                    <div class="view-card-body">
                        <div class="view-prop-row">
                            <span class="prop-label"><i class="fas fa-cake-candles"></i> Date of Birth</span>
                            <strong class="prop-value">${escapeHtml(record.dob || '—')}</strong>
                        </div>
                        <div class="view-prop-row">
                            <span class="prop-label"><i class="fas fa-dove"></i> Date of Death</span>
                            <strong class="prop-value">${escapeHtml(record.dod || '—')}</strong>
                        </div>
                        <div class="view-prop-row">
                            <span class="prop-label"><i class="fas fa-heart-pulse"></i> Cause of Death</span>
                            <strong class="prop-value">${escapeHtml(record.cause_of_death || 'Not Specified')}</strong>
                        </div>
                        <div class="view-prop-row">
                            <span class="prop-label"><i class="fas fa-fire-burner"></i> Cremated?</span>
                            <strong class="prop-value">${record.is_cremated === 'yes' ? '<span class="view-tag-cremated"><i class="fas fa-fire"></i> Cremated</span>' : 'No'}</strong>
                        </div>
                        ${record.is_cremated === 'yes' ? `
                        <div class="view-prop-row">
                            <span class="prop-label"><i class="fas fa-box-archive"></i> Ash Storage</span>
                            <strong class="prop-value">${escapeHtml(record.ash_storage || '—')}</strong>
                        </div>` : ''}
                    </div>
                </div>

                <!-- Card 2: Plot Assignment & Family Contacts -->
                <div class="view-info-card">
                    <div class="view-card-header">
                        <i class="fas fa-map-location-dot"></i>
                        <span>Plot & Family Contact</span>
                    </div>
                    <div class="view-card-body">
                        <div class="view-prop-row">
                            <span class="prop-label"><i class="fas fa-layer-group"></i> Section</span>
                            <strong class="prop-value"><span class="view-section-tag">${escapeHtml(record.section_name || '—')}</span></strong>
                        </div>
                        <div class="view-prop-row">
                            <span class="prop-label"><i class="fas fa-thumbtack"></i> Lot Number</span>
                            <strong class="prop-value"><span class="view-lot-tag">${escapeHtml(record.lot_number || '—')}</span></strong>
                        </div>
                        <div class="view-prop-row">
                            <span class="prop-label"><i class="fas fa-user-group"></i> Family Contact</span>
                            <strong class="prop-value">${escapeHtml(record.contact_name || '—')}</strong>
                        </div>
                        <div class="view-prop-row">
                            <span class="prop-label"><i class="fas fa-phone"></i> Contact Number</span>
                            <strong class="prop-value">${record.contact_number ? `<a href="tel:${escapeHtml(record.contact_number)}" class="prop-phone-link"><i class="fas fa-phone-volume"></i> ${escapeHtml(record.contact_number)}</a>` : '—'}</strong>
                        </div>
                    </div>
                </div>
            </div>
        `;
        viewDetails.innerHTML = details;
        document.getElementById('viewModal').style.display = 'flex';
        document.getElementById('editFromView').onclick = () => {
            document.getElementById('viewModal').style.display = 'none';
            openEditModal(id);
        };
        const viewVerifyBtn = document.getElementById('viewModalVerifyBtn');
        if (viewVerifyBtn) {
            viewVerifyBtn.onclick = () => {
                document.getElementById('viewModal').style.display = 'none';
                openVerifyModal(id);
            };
        }
        const printBtn = document.getElementById('printCertificateBtn');
        if (printBtn) {
            printBtn.onclick = () => {
                printMemorialCertificate(record);
            };
        }

        const timelineEl = document.getElementById('viewActivityTimeline');
        if (timelineEl) {
            timelineEl.innerHTML = '<p class="activity-loading">Loading activity history...</p>';
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

    // ── Batch 3: 1-Click Memorial & Burial Certificate Print Generator ──
    function printMemorialCertificate(record) {
        if (!record) return;
        const fullName = `${record.first_name || ''} ${record.middle_name ? record.middle_name + ' ' : ''}${record.last_name || ''}${record.suffix ? ' ' + record.suffix : ''}`.trim().toUpperCase();
        const ageInfo = computeAgeInfo(record.dob, record.dod);
        const ageStr = (ageInfo && ageInfo.isValid) ? `${ageInfo.formatted} (${ageInfo.milestone})` : (calculateAge(record.dob, record.dod) || '—');
        const eligibility = computeExhumationEligibility(record.dod, record.is_cremated);
        const currentDateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
        const isCremated = record.is_cremated === 'yes';
        const intermentType = isCremated ? 'Cremation & Columbarium Inurnment' : 'Traditional In-Ground Burial';
        const locationInfo = isCremated
            ? (record.ash_storage ? escapeHtml(record.ash_storage) : 'Columbarium Sanctuary')
            : `${escapeHtml(record.section_name || 'General Section')} — Lot ${escapeHtml(record.lot_number || 'Unassigned')}`;

        const certHtml = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <title>Memorial Certificate - ${escapeHtml(fullName)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Cinzel:wght@600;700;800;900&family=Playfair+Display:ital,wght@0,600;0,700;1,400&family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
    <style>
        @page {
            size: A4 portrait;
            margin: 10mm 12mm;
        }
        * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
        }
        body {
            font-family: 'Inter', sans-serif;
            background: #f1f5f9;
            color: #0f172a;
            display: flex;
            justify-content: center;
            align-items: center;
            min-height: 100vh;
            padding: 24px;
        }
        .cert-container {
            width: 100%;
            max-width: 800px;
            background: #ffffff;
            padding: 36px 42px;
            border: 12px double #1e3a2f;
            box-shadow: 0 10px 30px rgba(0,0,0,0.12);
            position: relative;
        }
        .cert-inner-border {
            border: 1.5px solid #d97706;
            padding: 28px 32px;
            position: relative;
        }
        .cert-header {
            text-align: center;
            margin-bottom: 20px;
        }
        .republic-text {
            font-size: 11px;
            font-weight: 700;
            letter-spacing: 0.15em;
            text-transform: uppercase;
            color: #475569;
            margin-bottom: 4px;
        }
        .agency-text {
            font-family: 'Cinzel', serif;
            font-size: 15px;
            font-weight: 700;
            letter-spacing: 0.08em;
            color: #1e3a2f;
            text-transform: uppercase;
            margin-bottom: 2px;
        }
        .sub-agency-text {
            font-size: 11px;
            color: #64748b;
            letter-spacing: 0.04em;
            margin-bottom: 14px;
        }
        .cert-divider {
            width: 150px;
            height: 2px;
            background: linear-gradient(90deg, transparent, #d97706, transparent);
            margin: 0 auto 14px;
        }
        .cert-title {
            font-family: 'Cinzel', serif;
            font-size: 22px;
            font-weight: 900;
            letter-spacing: 0.06em;
            color: #1e3a2f;
            text-transform: uppercase;
            margin-bottom: 4px;
        }
        .cert-record-id {
            font-size: 11.5px;
            font-weight: 700;
            color: #b45309;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            margin-bottom: 16px;
        }
        .cert-preamble {
            font-family: 'Playfair Display', serif;
            font-size: 13.5px;
            font-style: italic;
            text-align: center;
            color: #475569;
            line-height: 1.55;
            margin-bottom: 18px;
        }
        .decedent-name-box {
            text-align: center;
            margin: 12px 0 20px;
            padding: 10px 8px;
            border-bottom: 2px solid #1e3a2f;
            border-top: 1px dashed rgba(30, 58, 47, 0.25);
        }
        .decedent-name {
            font-family: 'Playfair Display', serif;
            font-size: 28px;
            font-weight: 700;
            letter-spacing: 0.03em;
            color: #0f172a;
        }
        .decedent-lifespan {
            font-size: 12.5px;
            font-weight: 600;
            color: #047857;
            margin-top: 4px;
            letter-spacing: 0.04em;
        }
        .cert-grid {
            display: grid;
            grid-template-columns: 1fr 1fr;
            gap: 14px 22px;
            margin: 20px 0 24px;
            font-size: 12.5px;
        }
        .cert-item {
            display: flex;
            flex-direction: column;
            border-bottom: 1px dotted #cbd5e1;
            padding-bottom: 5px;
        }
        .cert-item-label {
            font-size: 10px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.05em;
            color: #64748b;
            margin-bottom: 2px;
        }
        .cert-item-val {
            font-weight: 600;
            color: #0f172a;
        }
        .cert-sanitation-note {
            background: #f8fafc;
            border-left: 3px solid #059669;
            padding: 9px 12px;
            font-size: 11px;
            color: #334155;
            line-height: 1.45;
            margin-bottom: 24px;
        }
        .cert-issuance {
            font-size: 11.5px;
            color: #475569;
            text-align: center;
            font-style: italic;
            margin-bottom: 30px;
        }
        .cert-signatures {
            display: flex;
            justify-content: space-between;
            margin-top: 14px;
            padding: 0 16px;
        }
        .sig-block {
            text-align: center;
            width: 210px;
        }
        .sig-line {
            width: 100%;
            border-top: 1.5px solid #1e293b;
            margin-bottom: 5px;
        }
        .sig-name {
            font-size: 11.5px;
            font-weight: 700;
            color: #0f172a;
            text-transform: uppercase;
        }
        .sig-title {
            font-size: 10px;
            color: #64748b;
        }
        .cert-footer-seal {
            margin-top: 24px;
            text-align: center;
            font-size: 9.5px;
            color: #94a3b8;
            letter-spacing: 0.05em;
            text-transform: uppercase;
        }
        .no-print-toolbar {
            position: fixed;
            top: 15px;
            right: 15px;
            display: flex;
            gap: 10px;
            z-index: 999;
        }
        .btn-print-action {
            background: #1e3a2f;
            color: #ffffff;
            border: none;
            padding: 9px 18px;
            border-radius: 6px;
            font-size: 13px;
            font-weight: 700;
            cursor: pointer;
            box-shadow: 0 4px 12px rgba(0,0,0,0.15);
        }
        @media print {
            body {
                background: none;
                padding: 0;
            }
            .cert-container {
                box-shadow: none;
                max-width: 100%;
                padding: 16px 20px;
                border-width: 8px;
            }
            .no-print-toolbar {
                display: none !important;
            }
        }
    </style>
</head>
<body>
    <div class="no-print-toolbar">
        <button type="button" class="btn-print-action" onclick="window.print()">Print Official Certificate</button>
    </div>

    <div class="cert-container">
        <div class="cert-inner-border">
            <div class="cert-header">
                <div class="republic-text">Republic of the Philippines</div>
                <div class="agency-text">Office of the Cemetery &amp; Memorial Park Administration</div>
                <div class="sub-agency-text">Registry of Decedents &bull; Vital Statistics &amp; Interment Archives</div>
                <div class="cert-divider"></div>
                <div class="cert-title">Certificate of Memorial Record</div>
                <div class="cert-record-id">Official Record No: D-${escapeHtml(String(record.decedent_id))}</div>
            </div>

            <p class="cert-preamble">
                This is to officially certify that according to the authenticated registries, plot allocation records, and archives of this Memorial Cemetery, the following decedent information is duly documented on permanent file:
            </p>

            <div class="decedent-name-box">
                <div class="decedent-name">${escapeHtml(fullName)}</div>
                <div class="decedent-lifespan">${escapeHtml(record.dob || '—')} &bull; ${escapeHtml(record.dod || '—')} &bull; ${escapeHtml(ageStr)}</div>
            </div>

            <div class="cert-grid">
                <div class="cert-item">
                    <span class="cert-item-label">Interment / Memorial Type</span>
                    <span class="cert-item-val">${intermentType}</span>
                </div>
                <div class="cert-item">
                    <span class="cert-item-label">Resting Location / Plot</span>
                    <span class="cert-item-val">${locationInfo}</span>
                </div>
                <div class="cert-item">
                    <span class="cert-item-label">Cause of Passing</span>
                    <span class="cert-item-val">${escapeHtml(record.cause_of_death || 'Not Specified')}</span>
                </div>
                <div class="cert-item">
                    <span class="cert-item-label">Registered Next of Kin</span>
                    <span class="cert-item-val">${escapeHtml(record.contact_name || 'Family on Record')} ${record.contact_number ? '(' + escapeHtml(record.contact_number) + ')' : ''}</span>
                </div>
            </div>

            <div class="cert-sanitation-note">
                <strong>Regulatory Compliance (PD 856 Sanitation Code):</strong> ${escapeHtml(eligibility.desc)}
            </div>

            <div class="cert-issuance">
                Issued this ${currentDateStr} upon request of the registered kin for legal, familial, and archival documentation purposes.
            </div>

            <div class="cert-signatures">
                <div class="sig-block">
                    <div class="sig-line"></div>
                    <div class="sig-name">Cemetery Registrar</div>
                    <div class="sig-title">Records &amp; Archives Officer</div>
                </div>
                <div class="sig-block">
                    <div class="sig-line"></div>
                    <div class="sig-name">Superintendent</div>
                    <div class="sig-title">Memorial Park Administration</div>
                </div>
            </div>

            <div class="cert-footer-seal">
                Official Cemetery Documentation &bull; Valid Without Erasures &bull; Archive Copy
            </div>
        </div>
    </div>
</body>
</html>`;

        const printWindow = window.open('', '_blank', 'width=950,height=1000,menubar=no,toolbar=no,location=no');
        if (printWindow) {
            printWindow.document.open();
            printWindow.document.write(certHtml);
            printWindow.document.close();
            printWindow.focus();
        } else {
            showToast('Popup was blocked by the browser. Please allow popups to preview and print the certificate.', { type: 'error' });
        }
    }

    // ---------- Batch K1: document/certificate upload ----------
    const DOCUMENT_TYPE_LABELS = {
        death_certificate: 'Death Certificate',
        burial_permit: 'Burial Permit',
        other: 'Other Document',
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
            listEl.innerHTML = '<p class="activity-empty"><i class="fas fa-folder-open"></i> No documents attached to this record yet.</p>';
            return;
        }

        listEl.innerHTML = documents.map((doc) => {
            const fileName = (doc.original_filename || '').toLowerCase();
            let fileIcon = 'fa-file-lines';
            let iconTypeClass = 'doc-icon--default';
            if (fileName.endsWith('.pdf')) {
                fileIcon = 'fa-file-pdf';
                iconTypeClass = 'doc-icon--pdf';
            } else if (fileName.match(/\.(jpg|jpeg|png|webp|gif)$/)) {
                fileIcon = 'fa-file-image';
                iconTypeClass = 'doc-icon--image';
            }

            return `
                <div class="document-entry" data-document-id="${doc.document_id}">
                    <div class="doc-file-indicator ${iconTypeClass}">
                        <i class="fas ${fileIcon}"></i>
                    </div>
                    <div class="document-entry-info">
                        <div class="doc-entry-top">
                            <span class="status-badge status-info doc-type-pill">${escapeHtml(DOCUMENT_TYPE_LABELS[doc.document_type] || 'Document')}</span>
                            <a href="${escapeHtml(doc.file_path)}" target="_blank" rel="noopener" class="document-filename" title="Open / Preview Attachment">
                                <span>${escapeHtml(doc.original_filename)}</span>
                                <i class="fas fa-arrow-up-right-from-square"></i>
                            </a>
                        </div>
                        <span class="document-meta"><i class="far fa-clock"></i> Uploaded by ${escapeHtml(doc.uploaded_by_name || 'Staff')} · ${escapeHtml(doc.created_at)}</span>
                    </div>
                    <button type="button" class="document-delete-btn" title="Delete document" data-document-id="${doc.document_id}"><i class="fas fa-trash"></i></button>
                </div>
            `;
        }).join('');

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

    const documentFileInputEl = document.getElementById('documentFileInput');
    const documentFileTextEl = document.getElementById('documentFileText');
    if (documentFileInputEl && documentFileTextEl) {
        documentFileInputEl.addEventListener('change', () => {
            if (documentFileInputEl.files && documentFileInputEl.files.length > 0) {
                documentFileTextEl.textContent = documentFileInputEl.files[0].name;
                documentFileTextEl.parentElement.classList.add('has-file');
            } else {
                documentFileTextEl.textContent = 'Select file (.pdf, .jpg, .png)';
                documentFileTextEl.parentElement.classList.remove('has-file');
            }
        });
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
                    showToast('Document uploaded successfully.', { type: 'success' });
                    fileInput.value = '';
                    if (documentFileTextEl) {
                        documentFileTextEl.textContent = 'Select file (.pdf, .jpg, .png)';
                        documentFileTextEl.parentElement.classList.remove('has-file');
                    }
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

        if (payload.dob && payload.dod && new Date(payload.dod) < new Date(payload.dob)) {
            showToast('Date of Death cannot be earlier than Date of Birth.', { type: 'error' });
            return;
        }

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

    // ── Batch Compliance: Requirements Verification Modal Handlers ──
    async function openVerifyModal(id) {
        let record = records.find((item) => item.decedent_id === id);
        if (!record) {
            try {
                record = await api.request(`decedents/${id}`, { method: 'GET' });
            } catch (e) {
                showToast('Could not load decedent details.', { type: 'error' });
                return;
            }
        }
        if (!record) return;

        if (verifyDecedentId) verifyDecedentId.value = record.decedent_id;
        if (verifyDecedentName) verifyDecedentName.value = `${record.first_name} ${record.last_name}${record.suffix ? ' ' + record.suffix : ''}`;
        if (verifyDob) verifyDob.value = record.dob || '';
        if (verifyCause) verifyCause.value = record.cause_of_death || '';
        if (verifyContactName) verifyContactName.value = record.contact_name || '';
        if (verifyContactNumber) verifyContactNumber.value = record.contact_number || '';
        if (verifyDocFile) verifyDocFile.value = '';
        if (verifyConfirmCheckbox) verifyConfirmCheckbox.checked = false;

        if (verifyModal) verifyModal.style.display = 'flex';
    }

    if (closeVerifyModalBtn) {
        closeVerifyModalBtn.addEventListener('click', () => {
            if (verifyModal) verifyModal.style.display = 'none';
        });
    }

    if (cancelVerifyBtn) {
        cancelVerifyBtn.addEventListener('click', () => {
            if (verifyModal) verifyModal.style.display = 'none';
        });
    }

    if (verifyForm) {
        verifyForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = verifyDecedentId.value;
            if (!id) return;
            if (!verifyDob.value) {
                showToast('Date of Birth is required for verification.', { type: 'error' });
                return;
            }
            if (verifyConfirmCheckbox && !verifyConfirmCheckbox.checked) {
                showToast('Please confirm review of the Death Certificate / Burial Permit.', { type: 'error' });
                return;
            }

            const payload = {
                dob: verifyDob.value,
                cause_of_death: verifyCause.value.trim() || null,
                contact_name: verifyContactName.value.trim() || null,
                contact_number: verifyContactNumber.value.trim() || null
            };

            await withButtonLoading(submitVerifyBtn, async () => {
                try {
                    const result = await api.request(`decedents/${id}/verify-requirements`, {
                        method: 'POST',
                        body: payload
                    });

                    if (result.success) {
                        // Optional document attachment if chosen
                        if (verifyDocFile && verifyDocFile.files && verifyDocFile.files[0]) {
                            try {
                                const formData = new FormData();
                                formData.append('document_file', verifyDocFile.files[0]);
                                formData.append('document_type', 'death_certificate');
                                await api.request(`decedents/${id}/documents`, { method: 'POST', body: formData });
                            } catch (docErr) {
                                console.error('Verification succeeded but document upload failed', docErr);
                            }
                        }

                        showToast(result.message || 'Requirements verified successfully! Record is now complete.', { type: 'success' });
                        if (verifyModal) verifyModal.style.display = 'none';
                        await refreshPage();
                    } else {
                        showToast(result.error || 'Failed to verify requirements.', { type: 'error' });
                    }
                } catch (err) {
                    showToast(err.message || 'Failed to verify requirements.', { type: 'error' });
                }
            });
        });
    }

    // ---------- Batch J: bulk CSV import ----------
    // importPreviewRows holds the server's per-row evaluation (status/
    // errors/warnings/parsed data) between Preview and Confirm — the file
    // itself is never re-uploaded or stored server-side; only this parsed,
    // annotated JSON travels to the confirm step.
    let importPreviewRows = [];

    const importFileInput = document.getElementById('importFileInput');
    const importDropzone = document.getElementById('importDropzone');
    const dropzoneEmpty = document.getElementById('dropzoneEmpty');
    const importFileCard = document.getElementById('importFileCard');
    const importFileName = document.getElementById('importFileName');
    const importFileSize = document.getElementById('importFileSize');
    const removeImportFileBtn = document.getElementById('removeImportFileBtn');
    const previewImportBtn = document.getElementById('previewImportBtn');
    const importSetupGrid = document.getElementById('importSetupGrid');
    const importActiveFileBar = document.getElementById('importActiveFileBar');
    const activeBarFileName = document.getElementById('activeBarFileName');
    const activeBarFileSize = document.getElementById('activeBarFileSize');
    const toggleSetupBtn = document.getElementById('toggleSetupBtn');
    const changeActiveFileBtn = document.getElementById('changeActiveFileBtn');
    const cancelImportBtn = document.getElementById('cancelImportBtn');
    const importFooterHintText = document.getElementById('importFooterHintText');
    const confirmImportBtn = document.getElementById('confirmImportBtn');
    const confirmImportBtnText = document.getElementById('confirmImportBtnText');
    const importPreviewSection = document.getElementById('importPreviewSection');
    const importSummaryEl = document.getElementById('importSummary');
    const importPreviewBody = document.getElementById('importPreviewBody');
    const selectAllImportRows = document.getElementById('selectAllImportRows');

    function formatFileSize(bytes) {
        if (!bytes || bytes === 0) return '0 B';
        const k = 1024;
        const sizes = ['B', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    }

    function handleCsvFileSelect(file) {
        if (!file) return;
        if (!file.name.toLowerCase().endsWith('.csv') && file.type !== 'text/csv') {
            showToast('Please choose a valid CSV (.csv) file.', { type: 'error' });
            return;
        }
        if (importFileName) importFileName.textContent = file.name;
        if (importFileSize) importFileSize.textContent = formatFileSize(file.size);
        if (activeBarFileName) activeBarFileName.textContent = file.name;
        if (activeBarFileSize) activeBarFileSize.textContent = formatFileSize(file.size);
        if (dropzoneEmpty) dropzoneEmpty.hidden = true;
        if (importFileCard) importFileCard.hidden = false;
        if (previewImportBtn) previewImportBtn.disabled = false;
        if (confirmImportBtn) confirmImportBtn.disabled = false;
        if (importFooterHintText) importFooterHintText.textContent = `Validating "${file.name}"...`;

        // Automatically trigger preview validation for instant response
        triggerPreviewValidation(file);
    }

    function clearImportFile() {
        if (importFileInput) importFileInput.value = '';
        if (dropzoneEmpty) dropzoneEmpty.hidden = false;
        if (importFileCard) importFileCard.hidden = true;
        if (importSetupGrid) importSetupGrid.hidden = false;
        if (importActiveFileBar) importActiveFileBar.hidden = true;
        if (importPreviewSection) importPreviewSection.hidden = true;
        if (importPreviewBody) importPreviewBody.innerHTML = '';
        if (selectAllImportRows) selectAllImportRows.checked = false;
        if (toggleSetupBtn) toggleSetupBtn.innerHTML = '<i class="fas fa-circle-info"></i> View Format Guide';
        if (previewImportBtn) previewImportBtn.disabled = true;
        if (confirmImportBtn) confirmImportBtn.disabled = true;
        if (confirmImportBtnText) confirmImportBtnText.textContent = 'Save & Import Records';
        if (importFooterHintText) importFooterHintText.textContent = 'Please choose a CSV file to validate and save records.';
        importPreviewRows = [];
    }

    if (importDropzone) {
        importDropzone.addEventListener('click', (e) => {
            if (e.target.closest('#removeImportFileBtn')) return;
            if (importFileInput) importFileInput.click();
        });

        importDropzone.addEventListener('keydown', (e) => {
            if ((e.key === 'Enter' || e.key === ' ') && !e.target.closest('#removeImportFileBtn')) {
                e.preventDefault();
                if (importFileInput) importFileInput.click();
            }
        });

        importDropzone.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.stopPropagation();
            importDropzone.classList.add('dragover');
        });

        importDropzone.addEventListener('dragleave', (e) => {
            e.preventDefault();
            e.stopPropagation();
            importDropzone.classList.remove('dragover');
        });

        importDropzone.addEventListener('drop', (e) => {
            e.preventDefault();
            e.stopPropagation();
            importDropzone.classList.remove('dragover');
            if (e.dataTransfer && e.dataTransfer.files.length > 0) {
                const file = e.dataTransfer.files[0];
                try {
                    const dt = new DataTransfer();
                    dt.items.add(file);
                    importFileInput.files = dt.files;
                } catch (err) {
                    // Fallback if DataTransfer constructor is unsupported
                }
                handleCsvFileSelect(file);
            }
        });
    }

    if (importFileInput) {
        importFileInput.addEventListener('change', () => {
            if (importFileInput.files && importFileInput.files.length > 0) {
                handleCsvFileSelect(importFileInput.files[0]);
            }
        });
    }

    if (removeImportFileBtn) {
        removeImportFileBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            clearImportFile();
        });
    }

    function openImportModal() {
        clearImportFile();
        importModal.style.display = 'flex';
    }

    document.getElementById('downloadImportTemplate').addEventListener('click', () => {
        const columns = ['first_name', 'last_name', 'middle_name', 'suffix', 'dob', 'dod', 'lot_number', 'section_name', 'block_name', 'cause_of_death', 'contact_name', 'contact_number', 'is_cremated', 'ash_storage'];
        const sampleRows = [
            ['Juan', 'Dela Cruz', 'Santos', '', '1950-01-01', '2020-03-15', '1', 'Section A', 'Block 1', 'Natural causes', 'Maria Dela Cruz', '09171234567', 'no', ''],
            ['Rosario', 'Villanueva', '', 'Jr.', '1945-06-20', '2019-11-02', '2', 'Section A', 'Block 1', 'Cardiac arrest', 'Pedro Villanueva', '09182223344', 'no', ''],
            ['Elena', 'Bautista', 'Reyes', '', '1938-09-08', '2021-04-10', '', '', '', 'Old age', 'Ana Bautista', '09193334455', 'yes', 'Columbarium Niche 12'],
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
            <span class="summary-pill summary-total"><i class="fas fa-database"></i> Total: ${summary.total || 0}</span>
            <span class="summary-pill summary-ready"><i class="fas fa-circle-check"></i> Ready: ${summary.ready || 0}</span>
            <span class="summary-pill summary-warn"><i class="fas fa-triangle-exclamation"></i> Review: ${summary.needs_review || 0}</span>
            <span class="summary-pill summary-err"><i class="fas fa-circle-xmark"></i> Rejected: ${summary.rejected || 0}</span>
        `;

        let hasCheckableRows = false;
        importPreviewBody.innerHTML = importPreviewRows.map((row, index) => {
            const checked = row.status === 'ready' ? 'checked' : '';
            const disabled = row.status === 'rejected' ? 'disabled' : '';
            if (row.status !== 'rejected') hasCheckableRows = true;
            const notes = [...(row.errors || []), ...(row.warnings || [])].join('; ') || '—';
            const lotDisplay = row.lot_number
                ? `${escapeHtml(row.lot_number)} (${escapeHtml(row.section_name)}${row.block_name ? ' - ' + escapeHtml(row.block_name) : ''})`
                : (row.data.is_cremated === 'yes' ? '<span class="status-badge status-info">Cremation Only</span>' : '—');
            return `
                <tr data-index="${index}">
                    <td style="text-align: center;"><input type="checkbox" class="import-row-check" ${checked} ${disabled}></td>
                    <td>${row.row_number}</td>
                    <td>${escapeHtml(`${row.data.first_name} ${row.data.last_name}`)}</td>
                    <td>${escapeHtml(row.data.dob)} — ${escapeHtml(row.data.dod)}</td>
                    <td>${lotDisplay}</td>
                    <td><span class="status-badge ${STATUS_BADGE_CLASS[row.status]}">${STATUS_LABELS[row.status]}</span> <span class="import-row-notes">${escapeHtml(notes)}</span></td>
                </tr>
            `;
        }).join('');

        if (selectAllImportRows) {
            selectAllImportRows.checked = hasCheckableRows && ((summary.ready || 0) > 0);
        }

        if (importSetupGrid) importSetupGrid.hidden = true;
        if (importActiveFileBar) importActiveFileBar.hidden = false;
        if (importPreviewSection) importPreviewSection.hidden = false;
        if (toggleSetupBtn) toggleSetupBtn.innerHTML = '<i class="fas fa-circle-info"></i> View Format Guide';

        const readyCount = summary.ready || 0;
        const reviewCount = summary.needs_review || 0;

        if (readyCount > 0) {
            if (confirmImportBtn) confirmImportBtn.disabled = false;
            if (confirmImportBtnText) confirmImportBtnText.textContent = `Save ${readyCount} Valid Records`;
            if (importFooterHintText) importFooterHintText.textContent = `${readyCount} valid record(s) ready to save! Click "Save ${readyCount} Valid Records" to import.`;
        } else if (reviewCount > 0) {
            if (confirmImportBtn) confirmImportBtn.disabled = false;
            if (confirmImportBtnText) confirmImportBtnText.textContent = `Save Records (Review ${reviewCount})`;
            if (importFooterHintText) importFooterHintText.textContent = `Review warning notes above. Checked rows will be saved.`;
        } else {
            if (confirmImportBtn) confirmImportBtn.disabled = true;
            if (confirmImportBtnText) confirmImportBtnText.textContent = `No Valid Records to Save (0 Ready)`;
            if (importFooterHintText) importFooterHintText.textContent = `All rows have errors (e.g. missing lot or duplicates). Fix the spreadsheet and re-upload.`;
        }
    }

    if (toggleSetupBtn) {
        toggleSetupBtn.addEventListener('click', () => {
            if (!importSetupGrid) return;
            const willShow = importSetupGrid.hidden;
            importSetupGrid.hidden = !willShow;
            toggleSetupBtn.innerHTML = willShow
                ? '<i class="fas fa-chevron-up"></i> Hide Format Guide'
                : '<i class="fas fa-circle-info"></i> View Format Guide';
        });
    }

    if (changeActiveFileBtn) {
        changeActiveFileBtn.addEventListener('click', () => {
            if (importFileInput) importFileInput.click();
        });
    }

    if (cancelImportBtn) {
        cancelImportBtn.addEventListener('click', () => {
            importModal.style.display = 'none';
        });
    }

    if (selectAllImportRows) {
        selectAllImportRows.addEventListener('change', () => {
            const isChecked = selectAllImportRows.checked;
            importPreviewBody.querySelectorAll('.import-row-check:not(:disabled)').forEach((cb) => {
                cb.checked = isChecked;
            });
            updateSaveButtonCount();
        });

        importPreviewBody.addEventListener('change', (e) => {
            if (e.target.classList.contains('import-row-check')) {
                const allCheckable = Array.from(importPreviewBody.querySelectorAll('.import-row-check:not(:disabled)'));
                if (allCheckable.length > 0) {
                    selectAllImportRows.checked = allCheckable.every((cb) => cb.checked);
                }
                updateSaveButtonCount();
            }
        });
    }

    function updateSaveButtonCount() {
        const checkedCount = importPreviewBody.querySelectorAll('.import-row-check:checked').length;
        if (checkedCount > 0) {
            if (confirmImportBtn) confirmImportBtn.disabled = false;
            if (confirmImportBtnText) confirmImportBtnText.textContent = `Save ${checkedCount} Selected Record${checkedCount > 1 ? 's' : ''}`;
        } else {
            if (confirmImportBtn) confirmImportBtn.disabled = true;
            if (confirmImportBtnText) confirmImportBtnText.textContent = 'Save & Import Records';
        }
    }

    async function triggerPreviewValidation(file, autoConfirm = false) {
        if (!file) file = importFileInput.files ? importFileInput.files[0] : null;
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
                if (autoConfirm && (preview.summary?.ready || 0) > 0) {
                    confirmImportBtn.click();
                }
            } catch (error) {
                showToast(error.message || 'Could not preview this file.', { type: 'error' });
                if (importFooterHintText) importFooterHintText.textContent = error.message || 'Validation error.';
            }
        });
    }

    previewImportBtn.addEventListener('click', async () => {
        await triggerPreviewValidation();
    });

    confirmImportBtn.addEventListener('click', async () => {
        if (importPreviewRows.length === 0) {
            await triggerPreviewValidation(null, true);
            return;
        }

        const checkedRows = [];
        importPreviewBody.querySelectorAll('tr').forEach((tr) => {
            const checkbox = tr.querySelector('.import-row-check');
            if (!checkbox || !checkbox.checked) return;
            const index = parseInt(tr.dataset.index, 10);
            const row = importPreviewRows[index];
            if (!row) return;
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