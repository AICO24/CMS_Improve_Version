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
    const expandedSanctuaries = new Set();
    const expandedLevels = new Set();
    let hasInitializedHierarchy = false;

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

    const gridContainer = document.getElementById('columbariumHierarchy') || document.getElementById('columbariumGrid');
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
    const batchNicheModal = document.getElementById('batchNicheModal');

    // Forms
    const cremationForm = document.getElementById('cremationForm');
    const assignForm = document.getElementById('assignForm');
    const batchNicheForm = document.getElementById('batchNicheForm');

    // Batch Modal Elements
    const openBatchNicheModalBtn = document.getElementById('openBatchNicheModal');
    const closeBatchNicheModalBtn = document.getElementById('closeBatchNicheModal');
    const cancelBatchNicheBtn = document.getElementById('cancelBatchNicheBtn');
    const batchColumbariumSelect = document.getElementById('batchColumbarium');
    const batchColumbariumNewInput = document.getElementById('batchColumbariumNew');
    const batchNichePrefixInput = document.getElementById('batchNichePrefix');
    const batchLevelsCountInput = document.getElementById('batchLevelsCount');
    const batchNichesPerLevelInput = document.getElementById('batchNichesPerLevel');
    const batchTotalCountBadge = document.getElementById('batchTotalCountBadge');
    const batchPreviewList = document.getElementById('batchPreviewList');

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
    const assignTierBadge = document.getElementById('assignTierBadge');
    const assignAshStorage = document.getElementById('assignAshStorage');
    const tierBtnPrime = document.getElementById('tierBtnPrime');
    const tierBtnAny = document.getElementById('tierBtnAny');
    let currentSuggestTier = 'prime';

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
            populateBatchColumbariums();
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

    function populateBatchColumbariums(selectedValue = null) {
        if (!batchColumbariumSelect) return;
        batchColumbariumSelect.innerHTML = distinctColumbariums.map(name =>
            `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`
        ).join('') + `<option value="${NEW_COLUMBARIUM_VALUE}">+ Add new sanctuary / wing...</option>`;

        if (selectedValue && distinctColumbariums.includes(selectedValue)) {
            batchColumbariumSelect.value = selectedValue;
        } else if (selectedValue) {
            batchColumbariumSelect.value = NEW_COLUMBARIUM_VALUE;
            batchColumbariumNewInput.value = selectedValue;
        } else {
            batchColumbariumSelect.value = distinctColumbariums[0] || NEW_COLUMBARIUM_VALUE;
        }
        batchColumbariumNewInput.style.display = batchColumbariumSelect.value === NEW_COLUMBARIUM_VALUE ? 'block' : 'none';

        const curName = batchColumbariumSelect.value === NEW_COLUMBARIUM_VALUE ? batchColumbariumNewInput.value.trim() : batchColumbariumSelect.value;
        batchNichePrefixInput.value = suggestPrefixForSanctuary(curName);
        updateBatchPreview();
    }

    function suggestPrefixForSanctuary(name) {
        const key = (name || '').trim().toLowerCase();
        if (key.includes('jude')) return 'SJ-L';
        if (key.includes('peace') || key.includes('lady')) return 'OLP-L';
        if (key.includes('lorenzo') || key.includes('ruiz')) return 'SLR-L';
        if (key.includes('ascension')) return 'ASC-L';
        if (key.includes('mercy')) return 'DM-L';
        if (key.includes('peter')) return 'SP-L';
        if (key.includes('columbarium a')) return 'N-';

        const words = (name || '').replace(/[^a-zA-Z0-9\s]/g, '').split(/\s+/).filter(w => !['and', 'the', 'of', 'in', '&'].includes(w.toLowerCase()));
        if (words.length >= 2) {
            return words.slice(0, 3).map(w => w[0].toUpperCase()).join('') + '-L';
        } else if (words.length === 1 && words[0].length >= 2) {
            return words[0].substring(0, 3).toUpperCase() + '-L';
        }
        return 'N-';
    }

    function updateBatchPreview() {
        if (!batchPreviewList) return;
        const isNew = batchColumbariumSelect.value === NEW_COLUMBARIUM_VALUE;
        const col = isNew ? (batchColumbariumNewInput.value.trim() || 'New Sanctuary') : batchColumbariumSelect.value;
        const rawPrefix = batchNichePrefixInput.value.trim() || 'N-';
        const levels = Math.max(1, Math.min(10, parseInt(batchLevelsCountInput.value, 10) || 5));
        const perLevel = Math.max(1, Math.min(25, parseInt(batchNichesPerLevelInput.value, 10) || 10));
        const total = levels * perLevel;

        if (batchTotalCountBadge) batchTotalCountBadge.textContent = `${total} Niches Total`;

        function formatSlot(lvl, slot) {
            if (rawPrefix.endsWith('-L') || rawPrefix.endsWith('L')) {
                const p = rawPrefix.replace(/L$/, '');
                return `${p}L${lvl}-${String(slot).padStart(2, '0')}`;
            } else if (rawPrefix === 'N-') {
                const idx = (lvl - 1) * perLevel + slot;
                return `N-${idx}`;
            }
            return `${rawPrefix}L${lvl}-${String(slot).padStart(2, '0')}`;
        }

        let previewHtml = `<div style="margin-bottom: 6px; font-weight: 600;">Sanctuary Wing: <strong style="color: #047857;">${escapeHtml(col)}</strong></div>`;
        const sampleLevels = levels <= 4 ? Array.from({ length: levels }, (_, i) => i + 1) : [1, 2, 3, levels];

        sampleLevels.forEach((lvl, idx) => {
            if (levels > 4 && idx === 3) {
                previewHtml += `<div style="color: #94a3b8; font-size: 0.72rem; padding: 2px 0;">... and ${levels - 4} intermediate level(s) ...</div>`;
            }
            const isPrime = (lvl === 3 || lvl === 4);
            const first = formatSlot(lvl, 1);
            const last = formatSlot(lvl, perLevel);
            previewHtml += `
                <div style="display: flex; align-items: center; justify-content: space-between; padding: 2px 0;">
                    <span><strong>Level ${lvl}</strong>: <code>${escapeHtml(first)}</code> &rarr; <code>${escapeHtml(last)}</code> (${perLevel} niches)</span>
                    ${isPrime ? '<span style="color: #b45309; font-weight: 700; font-size: 0.68rem; background: #fef3c7; padding: 1px 6px; border-radius: 999px;"><i class="fas fa-crown"></i> Prime Eye-Level</span>' : ''}
                </div>
            `;
        });

        batchPreviewList.innerHTML = previewHtml;
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

    function sanctuaryIcon(name) {
        const key = (name || '').toLowerCase();
        if (key.includes('jude') || key.includes('peter') || key.includes('saint') || key.includes('san ')) return 'fa-church';
        if (key.includes('peace') || key.includes('lady')) return 'fa-dove';
        if (key.includes('ascension') || key.includes('resurrection')) return 'fa-cloud-sun';
        if (key.includes('mercy') || key.includes('heart')) return 'fa-heart';
        if (key.includes('gallery') || key.includes('cloister') || key.includes('hall')) return 'fa-building-columns';
        return 'fa-monument';
    }

    function groupNichesBySanctuaryAndLevel(niches) {
        const map = new Map();

        niches.forEach(niche => {
            const sanctuaryName = niche.columbarium || (distinctColumbariums[0] || 'St. Jude Thaddeus Sanctuary');
            if (!map.has(sanctuaryName)) {
                map.set(sanctuaryName, {
                    name: sanctuaryName,
                    levels: new Map(),
                    counts: { total: 0, available: 0, occupied: 0 }
                });
            }

            const sGroup = map.get(sanctuaryName);
            sGroup.counts.total++;
            if (niche.status === 'occupied') sGroup.counts.occupied++;
            else sGroup.counts.available++;

            const lvlNum = parseInt(niche.level, 10) || 1;
            if (!sGroup.levels.has(lvlNum)) {
                sGroup.levels.set(lvlNum, {
                    level: lvlNum,
                    niches: [],
                    counts: { total: 0, available: 0, occupied: 0 },
                    isEyeLevel: lvlNum === 3 || lvlNum === 4
                });
            }

            const lGroup = sGroup.levels.get(lvlNum);
            lGroup.niches.push(niche);
            lGroup.counts.total++;
            if (niche.status === 'occupied') lGroup.counts.occupied++;
            else lGroup.counts.available++;
        });

        // Convert Map to sorted array
        const result = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name));
        result.forEach(s => {
            s.levels = Array.from(s.levels.values()).sort((a, b) => a.level - b.level);
            s.levels.forEach(l => {
                l.niches.sort((a, b) => {
                    const numA = parseInt((a.niche_number || '').replace(/\D/g, ''), 10) || 0;
                    const numB = parseInt((b.niche_number || '').replace(/\D/g, ''), 10) || 0;
                    return numA - numB;
                });
            });
        });

        return result;
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

        // If active filters or search, auto-expand matching wings and levels so results are visible
        if (searchQuery || currentStatusFilter || currentColumbarium || currentLevel) {
            filteredNiches.forEach(n => {
                const colName = n.columbarium || (distinctColumbariums[0] || 'St. Jude Thaddeus Sanctuary');
                expandedSanctuaries.add(colName);
                expandedLevels.add(`${colName}__L${n.level || 1}`);
            });
        }

        currentPage = 1;
        renderCurrentView();
    }

    function renderCurrentView() {
        if (currentViewMode === 'grid') {
            gridWrapper.style.display = 'block';
            tableWrapper.style.display = 'none';
            renderHierarchy(filteredNiches);
        } else {
            gridWrapper.style.display = 'none';
            tableWrapper.style.display = 'block';
            renderTable(filteredNiches);
        }
    }

    function renderHierarchy(niches) {
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

        const groups = groupNichesBySanctuaryAndLevel(niches);

        // Auto-expand all wings and levels on initial render so user sees all sections
        if (!hasInitializedHierarchy) {
            hasInitializedHierarchy = true;
            groups.forEach(g => {
                expandedSanctuaries.add(g.name);
                g.levels.forEach(lvl => {
                    expandedLevels.add(`${g.name}__L${lvl.level}`);
                });
            });
        }

        gridContainer.innerHTML = groups.map(sGroup => renderSanctuaryHtml(sGroup)).join('');
    }

    function renderSanctuaryHtml(sGroup) {
        const isExpanded = expandedSanctuaries.has(sGroup.name);
        const icon = sanctuaryIcon(sGroup.name);
        const total = sGroup.counts.total || 1;
        const avail = sGroup.counts.available;
        const occ = sGroup.counts.occupied;
        const availPct = Math.round((avail / total) * 100);
        const occPct = 100 - availPct;

        return `
            <div class="sanctuary-group">
                <button type="button" class="sanctuary-header" data-sanctuary="${escapeHtml(sGroup.name)}" aria-expanded="${isExpanded}">
                    <div class="sanctuary-title">
                        <div class="sanctuary-icon-box">
                            <i class="fas ${icon}"></i>
                        </div>
                        <div class="sanctuary-title-info">
                            <div class="sanctuary-name-row">
                                <h3 class="sanctuary-name">${escapeHtml(sGroup.name)}</h3>
                                ${availPct > 0 
                                    ? `<span class="avail-hero-badge high"><i class="fas fa-circle-check"></i> ${availPct}% Available</span>`
                                    : `<span class="avail-hero-badge full"><i class="fas fa-lock"></i> 100% Occupied</span>`}
                            </div>
                            <div class="sanctuary-meta-row">
                                <span class="sanctuary-meta-pill"><i class="fas fa-layer-group"></i> ${sGroup.levels.length} ${sGroup.levels.length === 1 ? 'Level' : 'Levels'}</span>
                                <span class="sanctuary-meta-pill"><i class="fas fa-monument"></i> ${sGroup.counts.total} Niches</span>
                            </div>
                        </div>
                    </div>

                    <div class="sanctuary-occupancy-wrap">
                        <div class="occupancy-dashboard-pod">
                            <div class="pod-header">
                                <span class="pod-title"><i class="fas fa-chart-pie"></i> Wing Capacity</span>
                                <span class="pod-ratio"><strong>${avail}</strong> / ${sGroup.counts.total} Ready</span>
                            </div>
                            <div class="occupancy-track" title="${avail} Available, ${occ} Occupied">
                                <div class="occupancy-bar avail" style="width: ${availPct}%"></div>
                                <div class="occupancy-bar occ" style="width: ${occPct}%"></div>
                            </div>
                            <div class="occupancy-legend">
                                <span class="legend-chip avail"><span class="chip-dot"></span><strong>${avail}</strong> Avail</span>
                                <span class="legend-chip occ"><span class="chip-dot"></span><strong>${occ}</strong> Occ</span>
                            </div>
                        </div>

                        <div class="sanctuary-chevron-btn ${isExpanded ? 'expanded' : ''}" title="${isExpanded ? 'Collapse wing' : 'Expand wing'}">
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </div>
                </button>

                <div class="sanctuary-body" style="display: ${isExpanded ? 'flex' : 'none'};">
                    ${sGroup.levels.map(lvl => renderLevelHtml(sGroup.name, lvl)).join('')}
                </div>
            </div>
        `;
    }

    function renderLevelHtml(sanctuaryName, lvl) {
        const levelKey = `${sanctuaryName}__L${lvl.level}`;
        const isExpanded = expandedLevels.has(levelKey);
        const isAllOcc = lvl.counts.available === 0;

        return `
            <div class="level-group">
                <button type="button" class="level-header" data-level-key="${escapeHtml(levelKey)}" aria-expanded="${isExpanded}">
                    <div class="level-title">
                        <div class="level-badge">L${lvl.level}</div>
                        <div class="level-name">
                            <span>Level ${lvl.level}</span>
                            ${lvl.isEyeLevel ? `<span class="prime-eye-level-tag" title="Prime Eye-Level Niche Tier"><i class="fas fa-crown"></i> Prime Eye-Level</span>` : ''}
                        </div>
                    </div>
                    <div class="level-meta-wrap">
                        <span class="level-stat-pill ${isAllOcc ? 'full' : ''}">
                            ${lvl.counts.available} Open / ${lvl.counts.total} Niches
                        </span>
                        <div class="level-chevron-btn ${isExpanded ? 'expanded' : ''}">
                            <i class="fas fa-chevron-down"></i>
                        </div>
                    </div>
                </button>

                <div class="level-body" style="display: ${isExpanded ? 'block' : 'none'};">
                    <div class="level-niches-grid">
                        ${lvl.niches.map(renderNicheCardHtml).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function renderNicheCardHtml(niche) {
        const isOccupied = niche.status === 'occupied';
        const statusClass = isOccupied ? 'status-occupied' : 'status-available';
        const statusLabel = isOccupied ? 'Occupied' : 'Available';
        const decedentName = niche.first_name ? `${escapeHtml(niche.first_name)} ${escapeHtml(niche.last_name || '')}` : '';
        const isEyeLevel = parseInt(niche.level, 10) === 3 || parseInt(niche.level, 10) === 4;

        return `
            <div class="niche-card" data-id="${escapeHtml(niche.cremation_id || niche.niche_number)}" tabindex="0" role="button" aria-label="View niche ${escapeHtml(niche.niche_number)}">
                <div class="niche-header">
                    <span class="niche-level-tag">L${escapeHtml(niche.level || 1)}</span>
                    ${isEyeLevel ? `<span class="prime-eye-level-tag" style="font-size: 0.62rem; padding: 1px 5px;"><i class="fas fa-crown"></i> Prime</span>` : ''}
                </div>
                <div class="niche-number">${escapeHtml(niche.niche_number)}</div>
                <div class="niche-location"><i class="fas fa-building-columns"></i> ${escapeHtml(niche.columbarium || 'N/A')}</div>
                ${decedentName ? `<div class="deceased-name" title="${decedentName}"><i class="fas fa-user"></i> ${decedentName}</div>` : ''}
                <span class="niche-status ${statusClass}"><i class="fas ${isOccupied ? 'fa-urn' : 'fa-check'}"></i> ${statusLabel}</span>
            </div>
        `;
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

    function updateAshStorageLocation() {
        const columbarium = currentModalColumbariumValue() || (distinctColumbariums[0] || 'St. Jude Thaddeus Sanctuary');
        const nicheNum = (nicheNumberInput.value || '').trim();
        const lvl = parseInt(levelInput.value, 10) || 1;
        if (!nicheNum) return;

        const isPrime = (lvl === 3 || lvl === 4);
        const tierTag = isPrime ? ' (Prime Eye-Level)' : '';
        ashStorageInput.value = `[${nicheNum}] ${columbarium} — Level ${lvl}${tierTag}, Niche ${nicheNum}`;
    }

    async function triggerSmartSuggestion() {
        const columbarium = currentModalColumbariumValue() || (distinctColumbariums[0] || 'St. Jude Thaddeus Sanctuary');
        await withButtonLoading(suggestNicheBtn, async () => {
            try {
                const result = await apiRequest(`cremations/suggest-niche?columbarium=${encodeURIComponent(columbarium)}&tier=${encodeURIComponent(currentSuggestTier)}`);
                if (result.available) {
                    nicheNumberInput.value = result.niche_number;
                    levelInput.value = result.level || 1;
                    const tierLabel = (result.level == 3 || result.level == 4) ? '👑 Prime Eye-Level' : `Standard Level ${result.level}`;
                    suggestNicheHint.innerHTML = `<i class="fas fa-magic"></i> Suggested <strong>${escapeHtml(result.niche_number)}</strong> (${tierLabel}) in <em>${escapeHtml(result.columbarium)}</em>`;
                    if (result.note) {
                        suggestNicheHint.innerHTML += `<br><small style="color: #d97706; font-weight: 600;"><i class="fas fa-info-circle"></i> ${escapeHtml(result.note)}</small>`;
                    }
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
    }

    suggestNicheBtn.addEventListener('click', triggerSmartSuggestion);

    // Tier selector pill toggles
    if (tierBtnPrime && tierBtnAny) {
        tierBtnPrime.addEventListener('click', () => {
            currentSuggestTier = 'prime';
            tierBtnPrime.classList.add('active');
            tierBtnAny.classList.remove('active');
            triggerSmartSuggestion();
        });

        tierBtnAny.addEventListener('click', () => {
            currentSuggestTier = 'any';
            tierBtnAny.classList.add('active');
            tierBtnPrime.classList.remove('active');
            triggerSmartSuggestion();
        });
    }

    // Auto-update ash storage when user edits inputs manually
    nicheNumberInput.addEventListener('input', updateAshStorageLocation);
    levelInput.addEventListener('change', updateAshStorageLocation);
    modalColumbariumSelect.addEventListener('change', updateAshStorageLocation);
    if (modalColumbariumNew) {
        modalColumbariumNew.addEventListener('input', updateAshStorageLocation);
    }

    async function openAddModal() {
        document.getElementById('modalTitle').innerText = 'Record Cremation & Assign Niche';
        cremationForm.reset();
        document.getElementById('cremationId').value = '';
        suggestNicheHint.style.display = 'none';

        // Reset tier selector preference to Prime
        currentSuggestTier = 'prime';
        if (tierBtnPrime && tierBtnAny) {
            tierBtnPrime.classList.add('active');
            tierBtnAny.classList.remove('active');
        }

        const preferredCol = currentColumbarium || (distinctColumbariums[0] || 'St. Jude Thaddeus Sanctuary');
        populateModalColumbariums(preferredCol);

        await populateDecedents();

        // Auto-fetch next available suggestion on open with tier preference
        await triggerSmartSuggestion();

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
        assignColumbarium.value = niche.columbarium || (distinctColumbariums[0] || 'St. Jude Thaddeus Sanctuary');
        const lvl = parseInt(niche.level, 10) || 1;
        assignLevel.value = lvl;

        // Display Prime / Standard badge
        if (assignTierBadge) {
            const isPrime = (lvl === 3 || lvl === 4);
            assignTierBadge.style.display = 'inline-flex';
            if (isPrime) {
                assignTierBadge.className = 'tier-badge-prime';
                assignTierBadge.innerHTML = '<i class="fas fa-crown"></i> Prime Eye-Level';
            } else {
                assignTierBadge.className = 'tier-badge-standard';
                assignTierBadge.innerHTML = `<i class="fas fa-layer-group"></i> Level ${lvl}`;
            }
        }

        // Preview standard storage location
        if (assignAshStorage) {
            const isPrime = (lvl === 3 || lvl === 4);
            const tierTag = isPrime ? ' (Prime Eye-Level)' : '';
            assignAshStorage.value = `[${niche.niche_number}] ${niche.columbarium || (distinctColumbariums[0] || 'St. Jude Thaddeus Sanctuary')} — Level ${lvl}${tierTag}, Niche ${niche.niche_number}`;
        }

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
            ash_storage_location: assignAshStorage ? assignAshStorage.value.trim() : null,
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

    // --- Batch Niche Generator Form Submission & Events ---
    if (openBatchNicheModalBtn) {
        openBatchNicheModalBtn.addEventListener('click', () => {
            populateBatchColumbariums(currentColumbarium || (distinctColumbariums[0] || 'St. Jude Thaddeus Sanctuary'));
            openModal(batchNicheModal);
        });
    }

    if (closeBatchNicheModalBtn) {
        closeBatchNicheModalBtn.addEventListener('click', () => closeModal(batchNicheModal));
    }
    if (cancelBatchNicheBtn) {
        cancelBatchNicheBtn.addEventListener('click', () => closeModal(batchNicheModal));
    }

    if (batchColumbariumSelect) {
        batchColumbariumSelect.addEventListener('change', () => {
            const isNew = batchColumbariumSelect.value === NEW_COLUMBARIUM_VALUE;
            batchColumbariumNewInput.style.display = isNew ? 'block' : 'none';
            if (isNew) {
                batchColumbariumNewInput.focus();
            } else {
                batchNichePrefixInput.value = suggestPrefixForSanctuary(batchColumbariumSelect.value);
            }
            updateBatchPreview();
        });
    }

    if (batchColumbariumNewInput) {
        batchColumbariumNewInput.addEventListener('input', () => {
            batchNichePrefixInput.value = suggestPrefixForSanctuary(batchColumbariumNewInput.value);
            updateBatchPreview();
        });
    }

    if (batchNichePrefixInput) batchNichePrefixInput.addEventListener('input', updateBatchPreview);
    if (batchLevelsCountInput) batchLevelsCountInput.addEventListener('input', updateBatchPreview);
    if (batchNichesPerLevelInput) batchNichesPerLevelInput.addEventListener('input', updateBatchPreview);

    if (batchNicheForm) {
        batchNicheForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            const isNew = batchColumbariumSelect.value === NEW_COLUMBARIUM_VALUE;
            const col = isNew ? batchColumbariumNewInput.value.trim() : batchColumbariumSelect.value;
            const prefix = batchNichePrefixInput.value.trim() || 'N-';
            const levels = parseInt(batchLevelsCountInput.value, 10) || 5;
            const nichesPerLevel = parseInt(batchNichesPerLevelInput.value, 10) || 10;

            if (!col) {
                if (typeof showToast === 'function') showToast('Please select or specify a target sanctuary wing name.', { type: 'error' });
                return;
            }

            const submitBtn = document.getElementById('submitBatchNicheBtn');
            await withButtonLoading(submitBtn, async () => {
                try {
                    const result = await apiRequest('cremations/batch-niches', {
                        method: 'POST',
                        body: {
                            columbarium: col,
                            levels: levels,
                            niches_per_level: nichesPerLevel,
                            prefix: prefix
                        }
                    });

                    if (result.success) {
                        closeModal(batchNicheModal);
                        expandedSanctuaries.add(col);
                        for (let l = 1; l <= levels; l++) {
                            expandedLevels.add(`${col}__L${l}`);
                        }
                        await loadColumbariums();
                        await refreshAll();
                        if (typeof showToast === 'function') {
                            showToast(result.message || `Successfully generated ${result.total_niches} niches for ${col}.`, { type: 'success' });
                        }
                    } else {
                        if (typeof showToast === 'function') {
                            showToast(result.error || 'Failed to generate niches', { type: 'error' });
                        }
                    }
                } catch (error) {
                    if (typeof showToast === 'function') {
                        showToast('Error: ' + error.message, { type: 'error' });
                    }
                }
            });
        });
    }

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

    // --- Hierarchical Grid Interactions (Sanctuary & Level Accordions, Card View) ---
    gridContainer.addEventListener('click', (e) => {
        // 1. Level Header click
        const levelBtn = e.target.closest('.level-header');
        if (levelBtn) {
            e.preventDefault();
            e.stopPropagation();
            const lvlGroupEl = levelBtn.closest('.level-group');
            if (!lvlGroupEl) return;
            const lvlBodyEl = lvlGroupEl.querySelector('.level-body');
            const lvlChevronEl = levelBtn.querySelector('.level-chevron-btn');
            const lKey = levelBtn.dataset.levelKey;

            const isCurrentlyHidden = !lvlBodyEl || lvlBodyEl.style.display === 'none';
            if (isCurrentlyHidden) {
                if (lvlBodyEl) lvlBodyEl.style.display = 'block';
                lvlChevronEl?.classList.add('expanded');
                levelBtn.setAttribute('aria-expanded', 'true');
                if (lKey) expandedLevels.add(lKey);
            } else {
                if (lvlBodyEl) lvlBodyEl.style.display = 'none';
                lvlChevronEl?.classList.remove('expanded');
                levelBtn.setAttribute('aria-expanded', 'false');
                if (lKey) expandedLevels.delete(lKey);
            }
            return;
        }

        // 2. Sanctuary Header click
        const sanctuaryBtn = e.target.closest('.sanctuary-header');
        if (sanctuaryBtn) {
            e.preventDefault();
            const groupEl = sanctuaryBtn.closest('.sanctuary-group');
            if (!groupEl) return;
            const bodyEl = groupEl.querySelector('.sanctuary-body');
            const chevronEl = sanctuaryBtn.querySelector('.sanctuary-chevron-btn');
            const sName = sanctuaryBtn.dataset.sanctuary;

            const isCurrentlyHidden = !bodyEl || bodyEl.style.display === 'none';
            if (isCurrentlyHidden) {
                // Expand wing
                if (bodyEl) bodyEl.style.display = 'flex';
                chevronEl?.classList.add('expanded');
                sanctuaryBtn.setAttribute('aria-expanded', 'true');
                if (sName) expandedSanctuaries.add(sName);

                // Ensure levels are also displayed inside this wing
                groupEl.querySelectorAll('.level-body').forEach(lb => lb.style.display = 'block');
                groupEl.querySelectorAll('.level-chevron-btn').forEach(lc => lc.classList.add('expanded'));
                groupEl.querySelectorAll('.level-header').forEach(lh => {
                    lh.setAttribute('aria-expanded', 'true');
                    if (lh.dataset.levelKey) expandedLevels.add(lh.dataset.levelKey);
                });
            } else {
                // Collapse wing
                if (bodyEl) bodyEl.style.display = 'none';
                chevronEl?.classList.remove('expanded');
                sanctuaryBtn.setAttribute('aria-expanded', 'false');
                if (sName) expandedSanctuaries.delete(sName);
            }
            return;
        }

        // 3. Niche Card click
        const card = e.target.closest('.niche-card');
        if (card) {
            const id = card.dataset.id;
            const niche = filteredNiches.find(n => (n.cremation_id || n.niche_number).toString() === id.toString());
            if (niche) {
                showViewModal(niche);
            }
        }
    });

    gridContainer.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
            const card = e.target.closest('.niche-card');
            if (card) {
                e.preventDefault();
                const id = card.dataset.id;
                const niche = filteredNiches.find(n => (n.cremation_id || n.niche_number).toString() === id.toString());
                if (niche) {
                    showViewModal(niche);
                }
            }
        }
    });

    // --- Initialization ---
    await loadColumbariums();
    await refreshAll();
});
