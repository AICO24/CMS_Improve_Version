document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    // System-Wide AI Assistant: page-level header mount
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Cremation' },
        greeting: "Hello! I'm your AI assistant for Columbarium Management. How can I help you today?",
        suggestions: [
            { icon: 'fa-fire', label: 'Niche availability', question: 'How many niches are available versus occupied in each columbarium?' },
            { icon: 'fa-triangle-exclamation', label: 'Any exceptions?', question: 'Are there any open exceptions related to cremation or niche assignment?' },
            { icon: 'fa-chart-pie', label: 'Capacity status', question: 'What is the current columbarium capacity status and alert level?' },
            { icon: 'fa-clock-rotate-left', label: 'Recent activity', question: 'What recent niche assignments or cremation updates were recorded?' },
        ],
    });

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    // --- State Management ---
    let allNiches = [];
    let filteredNiches = [];
    let distinctColumbariums = [];
    let currentStatusFilter = ''; // '' = all, 'available', 'occupied'
    let currentColumbarium = '';
    let currentLevel = '';
    let searchQuery = '';
    let currentViewMode = 'grid'; // 'grid' | 'table'
    let currentPage = 1;
    const perPage = 10;

    // --- DOM Elements ---
    const statsEls = {
        total: document.getElementById('totalNiches'),
        occupied: document.getElementById('occupiedNiches'),
        available: document.getElementById('availableNiches'),
        rate: document.getElementById('occupancyRate')
    };
    const tabBadges = {
        all: document.getElementById('allTabBadge'),
        available: document.getElementById('availableTabBadge'),
        occupied: document.getElementById('occupiedTabBadge'),
    };
    const capacityBanner = document.getElementById('capacityAlertBanner');

    const gridContainer = document.getElementById('columbariumGrid');
    const gridWrapper = document.getElementById('columbariumGridWrapper');
    const tableWrapper = document.getElementById('columbariumTableWrapper');
    const tableBody = document.getElementById('columbariumTableBody');
    const paginationEl = document.getElementById('columbariumPagination');

    const searchInput = document.getElementById('searchNicheInput');
    const searchClearBtn = document.getElementById('searchClearBtn');
    const columbariumSelect = document.getElementById('columbariumFilter');
    const levelSelect = document.getElementById('levelFilter');

    const viewGridBtn = document.getElementById('viewGridBtn');
    const viewTableBtn = document.getElementById('viewTableBtn');
    const autoSyncBtn = document.getElementById('autoSyncBtn');
    const exportCsvBtn = document.getElementById('exportCsvBtn');

    // Modals
    const viewModal = document.getElementById('viewModal');
    const cremationModal = document.getElementById('cremationModal');
    const assignModal = document.getElementById('assignModal');

    // Forms
    const cremationForm = document.getElementById('cremationForm');
    const assignForm = document.getElementById('assignForm');

    // Modal Inputs
    const modalColumbariumSelect = document.getElementById('columbarium');
    const modalColumbariumNew = document.getElementById('columbariumNew');
    const suggestNicheBtn = document.getElementById('suggestNicheBtn');
    const suggestNicheHint = document.getElementById('suggestNicheHint');
    const nicheNumberInput = document.getElementById('nicheNumber');
    const levelInput = document.getElementById('level');
    const ashStorageInput = document.getElementById('ashStorage');

    const assignNicheNumber = document.getElementById('assignNicheNumber');
    const assignColumbarium = document.getElementById('assignColumbarium');
    const assignLevel = document.getElementById('assignLevel');
    const assignDecedentId = document.getElementById('assignDecedentId');

    const NEW_COLUMBARIUM_VALUE = '__new__';

    // --- Helpers ---
    function escapeHtml(val) {
        return String(val ?? '').replace(/[&<>"']/g, (ch) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[ch]));
    }

    function debounce(fn, delay) {
        let timer;
        return (...args) => {
            clearTimeout(timer);
            timer = setTimeout(() => fn(...args), delay);
        };
    }

    function openModal(modalEl) {
        if (!modalEl) return;
        modalEl.style.display = 'flex';
        modalEl.classList.add('show');
    }

    function closeModal(modalEl) {
        if (!modalEl) return;
        modalEl.style.display = 'none';
        modalEl.classList.remove('show');
    }

    function closeAllModals() {
        document.querySelectorAll('.modal').forEach(m => closeModal(m));
    }

    // --- API Calls ---
    async function apiRequest(endpoint, options = {}) {
        return await api.request(endpoint, options);
    }

    async function loadColumbariums() {
        try {
            const list = await apiRequest('cremations/columbariums');
            distinctColumbariums = Array.isArray(list) ? list : [];
            if (!distinctColumbariums.includes('Columbarium A')) {
                distinctColumbariums.unshift('Columbarium A');
            }

            // Populate Filter dropdown
            const prevFilterVal = columbariumSelect.value;
            columbariumSelect.innerHTML = '<option value="">All Columbariums</option>' +
                distinctColumbariums.map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join('');
            if (prevFilterVal && distinctColumbariums.includes(prevFilterVal)) {
                columbariumSelect.value = prevFilterVal;
            }

            // Populate Modal Columbarium dropdown
            populateModalColumbariums();
        } catch (error) {
            console.error('Failed to load columbariums', error);
        }
    }

    function populateModalColumbariums(selectedValue = null) {
        modalColumbariumSelect.innerHTML = distinctColumbariums.map(name =>
            `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
        ).join('') + `<option value="${NEW_COLUMBARIUM_VALUE}">+ Add new columbarium...</option>`;

        if (selectedValue && distinctColumbariums.includes(selectedValue)) {
            modalColumbariumSelect.value = selectedValue;
        } else if (selectedValue) {
            modalColumbariumSelect.value = NEW_COLUMBARIUM_VALUE;
            modalColumbariumNew.value = selectedValue;
        } else {
            modalColumbariumSelect.value = distinctColumbariums[0] || NEW_COLUMBARIUM_VALUE;
        }
        modalColumbariumNew.style.display = modalColumbariumSelect.value === NEW_COLUMBARIUM_VALUE ? 'block' : 'none';
    }

    function currentModalColumbariumValue() {
        return modalColumbariumSelect.value === NEW_COLUMBARIUM_VALUE
            ? modalColumbariumNew.value.trim()
            : modalColumbariumSelect.value;
    }

    modalColumbariumSelect.addEventListener('change', () => {
        const isNew = modalColumbariumSelect.value === NEW_COLUMBARIUM_VALUE;
        modalColumbariumNew.style.display = isNew ? 'block' : 'none';
        if (isNew) modalColumbariumNew.focus();
        updateAshStorageLocation();
    });

    function updateAshStorageLocation() {
        const col = currentModalColumbariumValue() || 'Columbarium A';
        const lvl = levelInput.value || 1;
        const niche = nicheNumberInput.value.trim();
        if (niche) {
            ashStorageInput.value = `${col} — Level ${lvl}, Niche ${niche}`;
        }
    }

    nicheNumberInput.addEventListener('input', updateAshStorageLocation);
    levelInput.addEventListener('input', updateAshStorageLocation);

    async function loadStats() {
        const query = currentColumbarium ? `?columbarium=${encodeURIComponent(currentColumbarium)}` : '';
        return await apiRequest(`cremations/stats${query}`);
    }

    async function loadNiches() {
        const query = currentColumbarium ? `?columbarium=${encodeURIComponent(currentColumbarium)}` : '';
        return await apiRequest(`cremations/niches${query}`);
    }

    function renderStats(stats) {
        const total = stats.total || 0;
        const occupied = stats.occupied || 0;
        const available = stats.available || 0;
        const rate = stats.occupancy_rate || 0;

        statsEls.total.innerText = total;
        statsEls.occupied.innerText = occupied;
        statsEls.available.innerText = available;
        statsEls.rate.innerText = `${rate}%`;

        // Update tab badges
        if (tabBadges.all) {
            tabBadges.all.innerText = total;
            tabBadges.all.style.display = total > 0 ? 'inline-flex' : 'none';
        }
        if (tabBadges.available) {
            tabBadges.available.innerText = available;
            tabBadges.available.style.display = available > 0 ? 'inline-flex' : 'none';
        }
        if (tabBadges.occupied) {
            tabBadges.occupied.innerText = occupied;
            tabBadges.occupied.style.display = occupied > 0 ? 'inline-flex' : 'none';
        }

        // Capacity alert banner
        if (stats.capacity_status === 'critical' || rate >= 95) {
            capacityBanner.className = 'columbarium-alert-banner critical';
            capacityBanner.innerHTML = `<i class="fas fa-triangle-exclamation"></i> <span><strong>Critical Capacity Alert:</strong> ${currentColumbarium || 'Columbarium'} has reached ${rate}% occupancy. Available niches are nearly exhausted.</span>`;
            capacityBanner.style.display = 'flex';
        } else if (stats.capacity_status === 'warning' || rate >= 80) {
            capacityBanner.className = 'columbarium-alert-banner warning';
            capacityBanner.innerHTML = `<i class="fas fa-circle-exclamation"></i> <span><strong>Capacity Warning:</strong> ${currentColumbarium || 'Columbarium'} is at ${rate}% occupancy. Plan for additional niche allocation.</span>`;
            capacityBanner.style.display = 'flex';
        } else {
            capacityBanner.style.display = 'none';
        }
    }

    function applyFilters() {
        filteredNiches = allNiches.filter(niche => {
            // Status filter
            if (currentStatusFilter && niche.status !== currentStatusFilter) {
                return false;
            }
            // Columbarium filter (client-side backup)
            if (currentColumbarium && (niche.columbarium || '').toLowerCase() !== currentColumbarium.toLowerCase()) {
                return false;
            }
            // Level filter
            if (currentLevel && String(niche.level) !== String(currentLevel)) {
                return false;
            }
            // Search filter
            if (searchQuery) {
                const q = searchQuery.toLowerCase();
                const nicheNum = (niche.niche_number || '').toLowerCase();
                const col = (niche.columbarium || '').toLowerCase();
                const deceased = `${niche.first_name || ''} ${niche.last_name || ''}`.toLowerCase();
                const notes = (niche.notes || '').toLowerCase();
                if (!nicheNum.includes(q) && !col.includes(q) && !deceased.includes(q) && !notes.includes(q)) {
                    return false;
                }
            }
            return true;
        });

        currentPage = 1;
        renderCurrentView();
    }

    function renderCurrentView() {
        if (currentViewMode === 'grid') {
            gridWrapper.style.display = 'block';
            tableWrapper.style.display = 'none';
            renderGrid(filteredNiches);
        } else {
            gridWrapper.style.display = 'none';
            tableWrapper.style.display = 'block';
            renderTable(filteredNiches);
        }
    }

    function renderGrid(niches) {
        if (!Array.isArray(niches) || niches.length === 0) {
            gridContainer.innerHTML = `
                <div class="cremation-empty-state">
                    <i class="fas fa-urn"></i>
                    <strong>No matching niches found</strong>
                    <span>Try changing your filters or click "Record / Assign" to register a new niche.</span>
                </div>
            `;
            return;
        }

        gridContainer.innerHTML = niches.map(niche => {
            const isOccupied = niche.status === 'occupied';
            const statusClass = isOccupied ? 'status-occupied' : 'status-available';
            const statusLabel = isOccupied ? 'Occupied' : 'Available';
            const decedentName = niche.first_name ? `${escapeHtml(niche.first_name)} ${escapeHtml(niche.last_name || '')}` : '';

            return `
                <div class="niche-card" data-id="${escapeHtml(niche.cremation_id || niche.niche_number)}" tabindex="0" role="button" aria-label="View niche ${escapeHtml(niche.niche_number)}">
                    <div class="niche-header">
                        <span class="niche-level-tag">Level ${escapeHtml(niche.level || 1)}</span>
                        <span class="niche-status ${statusClass}"><i class="fas ${isOccupied ? 'fa-urn' : 'fa-check'}"></i> ${statusLabel}</span>
                    </div>
                    <div class="niche-number">${escapeHtml(niche.niche_number)}</div>
                    <div class="niche-location"><i class="fas fa-building-columns"></i> ${escapeHtml(niche.columbarium || 'N/A')}</div>
                    ${decedentName ? `<div class="deceased-name" title="${decedentName}"><i class="fas fa-user"></i> ${decedentName}</div>` : ''}
                </div>
            `;
        }).join('');

        gridContainer.querySelectorAll('.niche-card').forEach(card => {
            const openCard = () => {
                const id = card.dataset.id;
                const niche = niches.find(n => (n.cremation_id || n.niche_number).toString() === id.toString());
                if (niche) {
                    showViewModal(niche);
                }
            };
            card.addEventListener('click', openCard);
            card.addEventListener('keydown', (event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openCard();
                }
            });
        });
    }

    function renderTable(niches) {
        if (!Array.isArray(niches) || niches.length === 0) {
            tableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 40px;">
                        <div class="cremation-empty-state" style="min-height: auto; padding: 0;">
                            <i class="fas fa-urn"></i>
                            <strong>No matching niches found</strong>
                            <span>Try changing your filters or click "Record / Assign".</span>
                        </div>
                    </td>
                </tr>
            `;
            paginationEl.innerHTML = '';
            return;
        }

        const totalItems = niches.length;
        const totalPages = Math.ceil(totalItems / perPage);
        currentPage = Math.max(1, Math.min(currentPage, totalPages));

        const startIndex = (currentPage - 1) * perPage;
        const pageItems = niches.slice(startIndex, startIndex + perPage);

        tableBody.innerHTML = pageItems.map(niche => {
            const isOccupied = niche.status === 'occupied';
            const statusClass = isOccupied ? 'status-occupied' : 'status-available';
            const statusLabel = isOccupied ? 'Occupied' : 'Available';
            const decedentName = niche.first_name ? `${escapeHtml(niche.first_name)} ${escapeHtml(niche.last_name || '')}` : '—';
            const cremationDate = niche.cremation_date || '—';
            const ashLoc = niche.ash_storage_location || '—';

            return `
                <tr>
                    <td><strong>${escapeHtml(niche.niche_number)}</strong></td>
                    <td>${escapeHtml(niche.columbarium || 'N/A')}</td>
                    <td>Level ${escapeHtml(niche.level || 1)}</td>
                    <td><span class="niche-status ${statusClass}">${statusLabel}</span></td>
                    <td><strong>${decedentName}</strong></td>
                    <td>${escapeHtml(cremationDate)}</td>
                    <td style="max-width: 180px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${escapeHtml(ashLoc)}</td>
                    <td style="text-align: right; white-space: nowrap;">
                        <button type="button" class="btn-action-view" data-niche="${escapeHtml(niche.niche_number)}" title="View details"><i class="fas fa-eye"></i> View</button>
                        ${niche.cremation_id ? `<button type="button" class="btn-action-edit" data-id="${escapeHtml(niche.cremation_id)}" title="Edit record"><i class="fas fa-pen"></i></button>` : ''}
                        ${!isOccupied ? `<button type="button" class="btn-action-assign" data-niche="${escapeHtml(niche.niche_number)}" title="Assign decedent"><i class="fas fa-user-plus"></i></button>` : ''}
                    </td>
                </tr>
            `;
        }).join('');

        // Bind table action buttons
        tableBody.querySelectorAll('.btn-action-view').forEach(btn => {
            btn.addEventListener('click', () => {
                const nicheNum = btn.dataset.niche;
                const niche = niches.find(n => n.niche_number === nicheNum);
                if (niche) showViewModal(niche);
            });
        });

        tableBody.querySelectorAll('.btn-action-edit').forEach(btn => {
            btn.addEventListener('click', () => {
                openEditModal(btn.dataset.id);
            });
        });

        tableBody.querySelectorAll('.btn-action-assign').forEach(btn => {
            btn.addEventListener('click', () => {
                const nicheNum = btn.dataset.niche;
                const niche = niches.find(n => n.niche_number === nicheNum);
                if (niche) openAssignModal(niche);
            });
        });

        // Pagination controls
        paginationEl.innerHTML = `
            <div>Showing <strong>${startIndex + 1}</strong> to <strong>${Math.min(startIndex + perPage, totalItems)}</strong> of <strong>${totalItems}</strong> niches</div>
            <div class="pagination-controls">
                <button type="button" class="pagination-btn" id="prevPageBtn" ${currentPage === 1 ? 'disabled' : ''}><i class="fas fa-chevron-left"></i></button>
                <span style="margin: 0 8px; font-weight: 600;">Page ${currentPage} of ${totalPages}</span>
                <button type="button" class="pagination-btn" id="nextPageBtn" ${currentPage === totalPages ? 'disabled' : ''}><i class="fas fa-chevron-right"></i></button>
            </div>
        `;

        const prevBtn = document.getElementById('prevPageBtn');
        const nextBtn = document.getElementById('nextPageBtn');
        if (prevBtn) prevBtn.addEventListener('click', () => { currentPage--; renderTable(niches); });
        if (nextBtn) nextBtn.addEventListener('click', () => { currentPage++; renderTable(niches); });
    }

    function renderSkeleton() {
        gridContainer.innerHTML = Array(8).fill(0).map(() => `<div class="skeleton-card"></div>`).join('');
    }

    async function refreshAll() {
        try {
            renderSkeleton();
            const [stats, niches] = await Promise.all([loadStats(), loadNiches()]);
            renderStats(stats);
            allNiches = niches || [];
            applyFilters();
        } catch (error) {
            console.error('Failed to refresh columbarium data', error);
            gridContainer.innerHTML = '<div class="cremation-empty-state"><i class="fas fa-triangle-exclamation"></i><strong>Failed to load columbarium data</strong><span>Please try refreshing again.</span></div>';
            if (typeof showToast === 'function') {
                showToast('Failed to load columbarium data: ' + (error.message || 'Network error'), { type: 'error' });
            }
        }
    }

    // --- Modal Logic ---
    function showViewModal(niche) {
        const isOccupied = niche.status === 'occupied';
        const details = `
            <div class="detail-row"><span>Niche Number</span><strong>${escapeHtml(niche.niche_number)}</strong></div>
            <div class="detail-row"><span>Columbarium</span><strong>${escapeHtml(niche.columbarium || 'N/A')}</strong></div>
            <div class="detail-row"><span>Level</span><strong>Level ${escapeHtml(niche.level || 1)}</strong></div>
            <div class="detail-row"><span>Status</span><strong class="${isOccupied ? 'status-occupied' : 'status-available'}" style="display:inline-block; padding: 2px 8px; border-radius: 999px;">${isOccupied ? 'Occupied' : 'Available'}</strong></div>
            <div class="detail-row"><span>Assigned Decedent</span><strong>${niche.first_name ? `${escapeHtml(niche.first_name)} ${escapeHtml(niche.last_name || '')}` : '— (Vacant)'}</strong></div>
            <div class="detail-row"><span>Cremation Date</span><strong>${escapeHtml(niche.cremation_date || '—')}</strong></div>
            <div class="detail-row"><span>Ash Storage Location</span><strong>${escapeHtml(niche.ash_storage_location || '—')}</strong></div>
            ${niche.notes ? `<div class="detail-row"><span>Notes</span><strong>${escapeHtml(niche.notes)}</strong></div>` : ''}
        `;
        document.getElementById('viewDetails').innerHTML = details;
        openModal(viewModal);

        const editBtn = document.getElementById('editFromView');
        const assignBtn = document.getElementById('assignFromView');
        const deleteBtn = document.getElementById('deleteFromView');
        const aiMount = document.getElementById('aiAssistantMountRecord');
        if (aiMount) aiMount.innerHTML = '';

        if (niche.cremation_id) {
            editBtn.style.display = 'inline-flex';
            editBtn.onclick = () => {
                closeModal(viewModal);
                openEditModal(niche.cremation_id);
            };
            deleteBtn.style.display = 'inline-flex';
            deleteBtn.onclick = async () => {
                const confirmed = typeof confirmDialog === 'function'
                    ? await confirmDialog({
                        title: 'Delete Cremation Record?',
                        message: `Are you sure you want to delete the cremation record for niche ${niche.niche_number}? This will reset the decedent's cremation flags.`,
                        confirmLabel: 'Delete Record',
                        danger: true
                    })
                    : confirm('Delete this cremation record?');

                if (!confirmed) return;

                try {
                    await apiRequest(`cremations/${niche.cremation_id}`, { method: 'DELETE' });
                    closeModal(viewModal);
                    if (typeof showToast === 'function') {
                        showToast('Cremation record deleted successfully.', { type: 'success' });
                    }
                    await refreshAll();
                } catch (error) {
                    if (typeof showToast === 'function') {
                        showToast(error.message || 'Failed to delete cremation record', { type: 'error' });
                    }
                }
            };

            // AI assistant entity mount
            if (aiMount) {
                initAiAssistant({
                    mountSelector: '#aiAssistantMountRecord',
                    context: { scope: 'entity', entity_type: 'Cremation', entity_id: niche.cremation_id },
                    label: 'Ask AI About Record',
                });
            }
        } else {
            editBtn.style.display = 'none';
            deleteBtn.style.display = 'none';
        }

        if (!isOccupied) {
            assignBtn.style.display = 'inline-flex';
            assignBtn.onclick = () => {
                closeModal(viewModal);
                openAssignModal(niche);
            };
        } else {
            assignBtn.style.display = 'none';
        }
    }

    suggestNicheBtn.addEventListener('click', async () => {
        const columbarium = currentModalColumbariumValue() || 'Columbarium A';
        await withButtonLoading(suggestNicheBtn, async () => {
            try {
                const result = await apiRequest(`cremations/suggest-niche?columbarium=${encodeURIComponent(columbarium)}`);
                if (result.available) {
                    nicheNumberInput.value = result.niche_number;
                    levelInput.value = result.level || 1;
                    suggestNicheHint.textContent = `Suggested niche ${result.niche_number} in ${result.columbarium} — you can still adjust it.`;
                    suggestNicheHint.style.display = 'block';
                    updateAshStorageLocation();
                } else {
                    suggestNicheHint.textContent = result.message || 'No available niches in this columbarium.';
                    suggestNicheHint.style.display = 'block';
                }
            } catch (error) {
                suggestNicheHint.textContent = 'Could not fetch suggestion — enter niche number manually.';
                suggestNicheHint.style.display = 'block';
            }
        });
    });

    async function openAddModal() {
        document.getElementById('modalTitle').innerText = 'Record Cremation & Assign Niche';
        cremationForm.reset();
        document.getElementById('cremationId').value = '';
        suggestNicheHint.style.display = 'none';

        const preferredCol = currentColumbarium || (distinctColumbariums[0] || 'Columbarium A');
        populateModalColumbariums(preferredCol);

        await populateDecedents();

        // Auto-fetch next available suggestion on open
        try {
            const suggestion = await apiRequest(`cremations/suggest-niche?columbarium=${encodeURIComponent(preferredCol)}`);
            if (suggestion.available) {
                nicheNumberInput.value = suggestion.niche_number;
                levelInput.value = suggestion.level || 1;
                updateAshStorageLocation();
            }
        } catch (e) {
            // Non-fatal if suggestion fails
        }

        openModal(cremationModal);
    }

    async function openEditModal(id) {
        try {
            const record = await apiRequest(`cremations/${id}`);
            if (record.error) {
                if (typeof showToast === 'function') showToast(record.error, { type: 'error' });
                return;
            }
            document.getElementById('modalTitle').innerText = 'Edit Cremation & Niche Record';
            document.getElementById('cremationId').value = record.cremation_id;
            document.getElementById('nicheNumber').value = record.niche_number || '';
            document.getElementById('level').value = record.level || 1;
            document.getElementById('cremationDate').value = record.cremation_date || '';
            document.getElementById('cremationStatus').value = record.status || 'Scheduled';
            document.getElementById('ashStorage').value = record.ash_storage_location || '';
            document.getElementById('cremationNotes').value = record.notes || '';
            suggestNicheHint.style.display = 'none';

            populateModalColumbariums(record.columbarium);
            await populateDecedents(record.deceased_id);

            openModal(cremationModal);
        } catch (error) {
            if (typeof showToast === 'function') {
                showToast('Failed to load record: ' + error.message, { type: 'error' });
            }
        }
    }

    function openAssignModal(niche) {
        assignNicheNumber.value = niche.niche_number;
        assignColumbarium.value = niche.columbarium || 'Columbarium A';
        assignLevel.value = niche.level || 1;
        populateDecedentsForAssign();
        openModal(assignModal);
    }

    async function populateDecedents(selectedId = null) {
        try {
            const decedents = await apiRequest('decedents?is_cremated=no');
            const select = document.getElementById('deceasedId');
            let options = '<option value="">Select uncremated decedent</option>';

            // If editing and decedent is already linked, include it if missing
            if (selectedId && !decedents.some(d => d.decedent_id == selectedId)) {
                try {
                    const currentDec = await apiRequest(`decedents/${selectedId}`);
                    if (currentDec && currentDec.decedent_id) {
                        decedents.unshift(currentDec);
                    }
                } catch (e) {}
            }

            options += decedents.map(d => `
                <option value="${d.decedent_id}" ${d.decedent_id == selectedId ? 'selected' : ''}>
                    ${escapeHtml(d.first_name)} ${escapeHtml(d.last_name || '')} (ID #${d.decedent_id})
                </option>
            `).join('');

            select.innerHTML = options;
        } catch (error) {
            console.error('Failed to load decedents', error);
            document.getElementById('deceasedId').innerHTML = '<option value="">Failed to load decedents</option>';
        }
    }

    async function populateDecedentsForAssign() {
        try {
            const decedents = await apiRequest('decedents?is_cremated=no');
            let options = '<option value="">Select uncremated decedent</option>';
            options += decedents.map(d => `
                <option value="${d.decedent_id}">
                    ${escapeHtml(d.first_name)} ${escapeHtml(d.last_name || '')} (ID #${d.decedent_id})
                </option>
            `).join('');
            assignDecedentId.innerHTML = options;
        } catch (error) {
            console.error('Failed to load available decedents', error);
            assignDecedentId.innerHTML = '<option value="">Failed to load decedents</option>';
        }
    }

    // --- Form Submissions ---
    cremationForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('cremationId').value;
        const deceasedId = parseInt(document.getElementById('deceasedId').value, 10);
        const nicheNumber = document.getElementById('nicheNumber').value.trim() || null;
        const data = {
            deceased_id: deceasedId,
            niche_number: nicheNumber,
            columbarium: currentModalColumbariumValue() || null,
            level: parseInt(document.getElementById('level').value, 10) || 1,
            cremation_date: document.getElementById('cremationDate').value || null,
            status: document.getElementById('cremationStatus').value || 'Scheduled',
            ash_storage_location: document.getElementById('ashStorage').value.trim() || null,
            notes: document.getElementById('cremationNotes').value.trim() || null
        };

        if (!data.deceased_id) {
            if (typeof showToast === 'function') {
                showToast('Please select a decedent.', { type: 'error' });
            }
            return;
        }

        const saveBtn = cremationForm.querySelector('button[type="submit"]');
        await withButtonLoading(saveBtn, async () => {
            try {
                const result = id
                    ? await apiRequest(`cremations/${id}`, { method: 'PUT', body: data })
                    : await apiRequest('cremations', { method: 'POST', body: data });

                if (result.success) {
                    closeModal(cremationModal);
                    cremationForm.reset();
                    await refreshAll();
                    if (typeof showToast === 'function') {
                        showToast(id ? 'Cremation record updated successfully.' : (result.message || 'Cremation record created and niche assigned.'), { type: 'success' });
                    }
                } else {
                    if (typeof showToast === 'function') {
                        showToast(result.error || 'Failed to save cremation record', { type: 'error' });
                    }
                }
            } catch (error) {
                if (typeof showToast === 'function') {
                    showToast('Error: ' + error.message, { type: 'error' });
                }
            }
        });
    });

    assignForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const data = {
            deceased_id: parseInt(assignDecedentId.value, 10),
            niche_number: assignNicheNumber.value.trim(),
            columbarium: assignColumbarium.value.trim() || null,
            level: parseInt(assignLevel.value, 10) || 1,
            status: 'Completed'
        };

        if (!data.deceased_id) {
            if (typeof showToast === 'function') {
                showToast('Please select a decedent.', { type: 'error' });
            }
            return;
        }

        const assignBtn = assignForm.querySelector('button[type="submit"]');
        await withButtonLoading(assignBtn, async () => {
            try {
                const result = await apiRequest('cremations/assign', { method: 'POST', body: data });
                if (result.success) {
                    closeModal(assignModal);
                    assignForm.reset();
                    await refreshAll();
                    if (typeof showToast === 'function') {
                        showToast(`Niche ${data.niche_number} successfully assigned to decedent.`, { type: 'success' });
                    }
                } else {
                    if (typeof showToast === 'function') {
                        showToast(result.error || 'Failed to assign niche', { type: 'error' });
                    }
                }
            } catch (error) {
                if (typeof showToast === 'function') {
                    showToast('Error: ' + error.message, { type: 'error' });
                }
            }
        });
    });

    // --- Filter & Control Listeners ---
    // Status Tabs
    document.querySelectorAll('.records-tab-btn').forEach(tabBtn => {
        tabBtn.addEventListener('click', () => {
            document.querySelectorAll('.records-tab-btn').forEach(b => {
                b.classList.remove('active');
                b.setAttribute('aria-selected', 'false');
            });
            tabBtn.classList.add('active');
            tabBtn.setAttribute('aria-selected', 'true');

            currentStatusFilter = tabBtn.dataset.tab || '';

            // Update stat cards active border
            document.querySelectorAll('.stat-card-filterable').forEach(c => {
                c.classList.toggle('is-active-filter', c.dataset.statusFilter === currentStatusFilter && currentStatusFilter !== '');
            });

            applyFilters();
        });
    });

    // Stat Card Clicks
    document.querySelectorAll('.stat-card-filterable').forEach(card => {
        card.addEventListener('click', () => {
            const filterVal = card.dataset.statusFilter ?? '';
            currentStatusFilter = filterVal;

            // Reflect on tab buttons
            document.querySelectorAll('.records-tab-btn').forEach(b => {
                const isMatch = (b.dataset.tab || '') === currentStatusFilter;
                b.classList.toggle('active', isMatch);
                b.setAttribute('aria-selected', isMatch ? 'true' : 'false');
            });

            document.querySelectorAll('.stat-card-filterable').forEach(c => {
                c.classList.toggle('is-active-filter', c.dataset.statusFilter === currentStatusFilter && currentStatusFilter !== '');
            });

            applyFilters();
        });
    });

    // Columbarium Filter
    columbariumSelect.addEventListener('change', async () => {
        currentColumbarium = columbariumSelect.value;
        await refreshAll();
    });

    // Level Filter
    levelSelect.addEventListener('change', () => {
        currentLevel = levelSelect.value;
        applyFilters();
    });

    // Live Search
    searchInput.addEventListener('input', debounce(() => {
        searchQuery = searchInput.value.trim();
        searchClearBtn.style.display = searchQuery ? 'block' : 'none';
        applyFilters();
    }, 200));

    searchClearBtn.addEventListener('click', () => {
        searchInput.value = '';
        searchQuery = '';
        searchClearBtn.style.display = 'none';
        applyFilters();
        searchInput.focus();
    });

    // View Switcher
    viewGridBtn.addEventListener('click', () => {
        currentViewMode = 'grid';
        viewGridBtn.classList.add('active');
        viewTableBtn.classList.remove('active');
        renderCurrentView();
    });

    viewTableBtn.addEventListener('click', () => {
        currentViewMode = 'table';
        viewTableBtn.classList.add('active');
        viewGridBtn.classList.remove('active');
        renderCurrentView();
    });

    // Toolbar Buttons
    document.getElementById('openAddModal').addEventListener('click', openAddModal);

    autoSyncBtn.addEventListener('click', async () => {
        await withButtonLoading(autoSyncBtn, async () => {
            await refreshAll();
            if (typeof showToast === 'function') {
                showToast('Columbarium occupancy and inventory synchronized.', { type: 'success' });
            }
        });
    });

    // Export CSV
    exportCsvBtn.addEventListener('click', () => {
        if (!filteredNiches || filteredNiches.length === 0) {
            if (typeof showToast === 'function') showToast('No niches available to export.', { type: 'info' });
            return;
        }

        const headers = ['Niche Number', 'Columbarium', 'Level', 'Status', 'Decedent Name', 'Cremation Date', 'Ash Storage Location', 'Notes'];
        const csvRows = [headers.join(',')];

        filteredNiches.forEach(n => {
            const decName = n.first_name ? `${n.first_name} ${n.last_name || ''}` : '';
            const row = [
                `"${(n.niche_number || '').replace(/"/g, '""')}"`,
                `"${(n.columbarium || '').replace(/"/g, '""')}"`,
                `"${n.level || 1}"`,
                `"${(n.status || 'available').replace(/"/g, '""')}"`,
                `"${decName.replace(/"/g, '""')}"`,
                `"${(n.cremation_date || '').replace(/"/g, '""')}"`,
                `"${(n.ash_storage_location || '').replace(/"/g, '""')}"`,
                `"${(n.notes || '').replace(/"/g, '""')}"`,
            ];
            csvRows.push(row.join(','));
        });

        const csvBlob = new Blob([csvRows.join('\n')], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(csvBlob);
        const a = document.createElement('a');
        const filename = `columbarium_inventory_${(currentColumbarium || 'all').toLowerCase().replace(/\s+/g, '_')}_${new Date().toISOString().split('T')[0]}.csv`;
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        if (typeof showToast === 'function') {
            showToast('Columbarium inventory exported to CSV.', { type: 'success' });
        }
    });

    // Close Modals
    document.querySelectorAll('.close, .close-view').forEach(el => {
        el.addEventListener('click', closeAllModals);
    });

    window.addEventListener('click', (e) => {
        document.querySelectorAll('.modal').forEach(m => {
            if (e.target === m) closeModal(m);
        });
    });

    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') closeAllModals();
    });

    // Sidebar Mobile Toggle
    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // --- Initialization ---
    await loadColumbariums();
    await refreshAll();
});
