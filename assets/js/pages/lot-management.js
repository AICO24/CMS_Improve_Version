document.addEventListener('DOMContentLoaded', async function() {
    const session = await requireRole(['admin', 'staff']);
    if (!session) return;

    document.getElementById('logoutBtn').addEventListener('click', () => {
        localStorage.removeItem('jwt_token');
        localStorage.removeItem('user_session');
        window.location.href = `${getFrontendBasePath()}/auth/login.html`;
    });

    let currentSection = '';
    let allSections = [];
    let lotTypes = [];

    const statsEl = {
        available: document.getElementById('availableCount'),
        occupied: document.getElementById('occupiedCount'),
        reserved: document.getElementById('reservedCount'),
        total: document.getElementById('totalCount')
    };
    const tabsContainer = document.getElementById('sectionTabs');
    const gridContainer = document.getElementById('lotGrid');

    async function apiRequest(endpoint, options = {}) {
        const token = localStorage.getItem('jwt_token');
        const headers = {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
            ...(options.headers || {}),
        };

        const response = await fetch(`http://localhost/CMS/backend/api/${endpoint}`, {
            ...options,
            headers,
            body: options.body ? JSON.stringify(options.body) : undefined,
        });

        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            if (response.status === 401) {
                localStorage.removeItem('jwt_token');
                window.location.href = `${getFrontendBasePath()}/auth/login.html`;
            }
            throw new Error(data.error || 'Request failed');
        }
        return data;
    }

    async function loadSections() {
        allSections = await apiRequest('sections');
        return allSections;
    }

    async function loadLotTypes() {
        lotTypes = await apiRequest('lot-types');
        return lotTypes;
    }

    async function loadLots(sectionName = '') {
        const endpoint = sectionName ? `lots?section=${encodeURIComponent(sectionName)}` : 'lots';
        return await apiRequest(endpoint);
    }

    async function loadStats() {
        return await apiRequest('lots/stats');
    }

    function renderStats(stats) {
        statsEl.available.innerText = stats.available || 0;
        statsEl.occupied.innerText = stats.occupied || 0;
        statsEl.reserved.innerText = stats.reserved || 0;
        statsEl.total.innerText = stats.total || 0;
    }

    function renderTabs(sections, activeSection) {
        tabsContainer.innerHTML = sections.map(section => `
            <button class="tab-btn ${section.section_name === activeSection ? 'active' : ''}" data-section="${section.section_name}">
                ${section.section_name}
            </button>
        `).join('');

        tabsContainer.querySelectorAll('.tab-btn').forEach(button => {
            button.addEventListener('click', () => {
                currentSection = button.dataset.section;
                renderTabs(allSections, currentSection);
                loadAndRenderLots(currentSection);
            });
        });
    }

    let activeViewMode = 'card';
    const matrixGridContainer = document.getElementById('lotMatrixGrid');
    const gridLegend = document.getElementById('gridLegend');
    const btnCardView = document.getElementById('btnCardView');
    const btnGridView = document.getElementById('btnGridView');

    if (btnCardView && btnGridView) {
        btnCardView.addEventListener('click', () => {
            activeViewMode = 'card';
            btnCardView.classList.add('active');
            btnGridView.classList.remove('active');
            gridContainer.style.display = 'grid';
            matrixGridContainer.style.display = 'none';
            gridLegend.style.display = 'none';
        });

        btnGridView.addEventListener('click', () => {
            activeViewMode = 'grid';
            btnGridView.classList.add('active');
            btnCardView.classList.remove('active');
            gridContainer.style.display = 'none';
            matrixGridContainer.style.display = 'block';
            gridLegend.style.display = 'flex';
            loadAndRenderLots(currentSection);
        });
    }

function renderMatrixGrid(lots, sectionName) {
    if (!lots || lots.length === 0) {
        matrixGridContainer.innerHTML = `
            <div class="no-lots">
                <i class="fas fa-border-all"></i>
                <h3>No Slots Found</h3>
                <p>There are no slots available in ${sectionName || 'this section'}.</p>
            </div>
        `;
        return;
    }

    const slotBoxesHtml = lots.map(lot => {
        let code = 'O';
        if (lot.status === 'Occupied') code = 'X';
        else if (lot.status === 'Reserved') code = 'R';
        else if (lot.status === 'Expired') code = 'E';

        return `
            <div class="slot-box status-${lot.status}" data-id="${lot.lot_id}" title="Lot ${lot.lot_number} (${lot.status}) - $${parseFloat(lot.price).toLocaleString()}">
                <div class="slot-icon">${code}</div>
                <div class="slot-num">${lot.lot_number}</div>
            </div>
        `;
    }).join('');

    matrixGridContainer.innerHTML = `
        <div class="matrix-header">
            <i class="fas fa-map-marked-alt"></i> ${sectionName || 'Section Grid'} Matrix Layout
        </div>
        <div class="slots-matrix">
            ${slotBoxesHtml}
        </div>
    `;

    matrixGridContainer.querySelectorAll('.slot-box').forEach(box => {
        box.addEventListener('click', () => {
            showViewModal(box.dataset.id);
        });
    });
}

function renderLots(lots) {
    if (activeViewMode === 'grid') {
        renderMatrixGrid(lots, currentSection);
        return;
    }

    if (!lots || lots.length === 0) {
        gridContainer.innerHTML = `
            <div class="no-lots">
                <i class="fas fa-tree"></i>
                <h3>No Lots Found</h3>
                <p>There are no lots in this section yet.</p>
            </div>
        `;
        return;
    }

    gridContainer.innerHTML = lots.map(lot => `
        <div class="lot-card" data-id="${lot.lot_id}">
            <div class="card-border">
                <div class="card-content">
                    <div class="lot-header">
                        <div>
                            <div class="lot-number">${lot.lot_number}</div>
                            <div class="lot-type">${lot.lot_type_name || "N/A"}</div>
                        </div>
                        <span class="lot-status status-${lot.status}">${lot.status}</span>
                    </div>
                    <div class="lot-info">
                        <div class="info-row"><i class="fas fa-dollar-sign"></i><span>Price</span><strong>$${parseFloat(lot.price).toLocaleString()}</strong></div>
                        <div class="info-row"><i class="fas fa-map-marker-alt"></i><span>Section</span><strong>${lot.section_name}</strong></div>
                        <div class="info-row"><i class="fas fa-th-large"></i><span>Block</span><strong>${lot.block_name || "N/A"}</strong></div>
                        <div class="info-row"><i class="fas fa-ruler-combined"></i><span>Size</span><strong>${lot.dimensions || "--"}</strong></div>
                    </div>
                    <div class="card-footer">
                        <span>View Details</span>
                        <i class="fas fa-arrow-right"></i>
                    </div>
                </div>
            </div>
        </div>
    `).join("");

    document.querySelectorAll(".lot-card").forEach(card => {
        card.addEventListener("click", () => {
            showViewModal(card.dataset.id);
        });
    });
}

    async function loadAndRenderLots(sectionName) {
        try {
            const lots = await loadLots(sectionName);
            renderLots(lots);
        } catch (error) {
            console.error('Failed to load lots:', error);
            gridContainer.innerHTML = '<div class="error">Failed to load lots. Please refresh.</div>';
        }
    }

    async function showViewModal(lotId) {
        try {
            const lot = await apiRequest(`lots/${lotId}`);
            if (lot.error) {
                alert(lot.error);
                return;
            }

            const details = `
                <div class="detail-row"><span>Lot Number</span><strong>${lot.lot_number}</strong></div>
                <div class="detail-row"><span>Section</span><strong>${lot.section_name}</strong></div>
                <div class="detail-row"><span>Block</span><strong>${lot.block_name || 'N/A'}</strong></div>
                <div class="detail-row"><span>Type</span><strong>${lot.lot_type_name}</strong></div>
                <div class="detail-row"><span>Price</span><strong>$${parseFloat(lot.price).toLocaleString()}</strong></div>
                <div class="detail-row"><span>Status</span><strong>${lot.status}</strong></div>
                <div class="detail-row"><span>Dimensions</span><strong>${lot.dimensions || '—'}</strong></div>
                <div class="detail-row"><span>Notes</span><strong>${lot.location_notes || 'None'}</strong></div>
            `;
            document.getElementById('viewDetails').innerHTML = details;

            const slotActions = document.getElementById('availableSlotActions');
            if (slotActions) {
                if (lot.status === 'Available') {
                    slotActions.style.display = 'flex';
                    const btnReserve = document.getElementById('btnProceedReserve');
                    const btnPayment = document.getElementById('btnProceedPayment');
                    if (btnReserve) {
                        btnReserve.onclick = () => {
                            window.location.href = `burial-scheduling.html?lot_id=${lot.lot_id}&lot_number=${encodeURIComponent(lot.lot_number)}`;
                        };
                    }
                    if (btnPayment) {
                        btnPayment.onclick = () => {
                            window.location.href = `payments.html?lot_id=${lot.lot_id}&lot_number=${encodeURIComponent(lot.lot_number)}&price=${lot.price}`;
                        };
                    }
                } else {
                    slotActions.style.display = 'none';
                }
            }

            document.getElementById('viewModal').style.display = 'flex';

            document.getElementById('editFromView').onclick = () => {
                document.getElementById('viewModal').style.display = 'none';
                openEditModal(lotId);
            };

            const deleteBtn = document.getElementById('deleteFromView');
            if (deleteBtn) {
                deleteBtn.onclick = async () => {
                    if (confirm(`Delete lot ${lot.lot_number}? This cannot be undone.`)) {
                        try {
                            await apiRequest(`lots/${lotId}`, { method: 'DELETE' });
                            document.getElementById('viewModal').style.display = 'none';
                            await refreshAll();
                        } catch (error) {
                            alert('Failed to delete lot: ' + error.message);
                        }
                    }
                };
            }
        } catch (error) {
            alert('Failed to load lot details: ' + error.message);
        }
    }

    function openAddModal() {
        document.getElementById('modalTitle').innerText = 'Add New Lot';
        document.getElementById('lotForm').reset();
        document.getElementById('lotId').value = '';
        populateFormDropdowns();
        document.getElementById('lotModal').style.display = 'flex';
    }

    async function openEditModal(lotId) {
        try {
            const lot = await apiRequest(`lots/${lotId}`);
            document.getElementById('modalTitle').innerText = 'Edit Lot';
            document.getElementById('lotId').value = lot.lot_id;
            document.getElementById('lotNumber').value = lot.lot_number;
            document.getElementById('lotSection').value = lot.section_name || '';
            document.getElementById('lotBlock').value = lot.block_id || '';
            document.getElementById('lotType').value = lot.lot_type_id || '';
            document.getElementById('lotPrice').value = lot.price;
            document.getElementById('lotStatus').value = lot.status;
            document.getElementById('lotDimensions').value = lot.dimensions || '';
            document.getElementById('lotNotes').value = lot.location_notes || '';
            await populateFormDropdowns(lot.section_name);
            document.getElementById('lotModal').style.display = 'flex';
        } catch (error) {
            alert('Failed to load lot: ' + error.message);
        }
    }

    async function populateFormDropdowns(selectedSection = '') {
        const sectionSelect = document.getElementById('lotSection');
        sectionSelect.innerHTML = allSections.map(section =>
            `<option value="${section.section_name}" ${section.section_name === selectedSection ? 'selected' : ''}>${section.section_name}</option>`
        ).join('');

        const sectionName = sectionSelect.value;
        if (sectionName) {
            const section = allSections.find(item => item.section_name === sectionName);
            if (section) {
                const blocks = await apiRequest(`blocks?section_id=${section.section_id}`);
                const blockSelect = document.getElementById('lotBlock');
                blockSelect.innerHTML = '<option value="">Select a block</option>' + blocks.map(block => `<option value="${block.block_id}">${block.block_name}</option>`).join('');
            }
        }

        const typeSelect = document.getElementById('lotType');
        typeSelect.innerHTML = lotTypes.map(type => `<option value="${type.type_id}">${type.type_name}</option>`).join('');

        sectionSelect.onchange = () => populateFormDropdowns(sectionSelect.value);
    }

    document.getElementById('lotForm').addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('lotId').value;
        const data = {
            block_id: parseInt(document.getElementById('lotBlock').value, 10),
            lot_number: document.getElementById('lotNumber').value.trim(),
            lot_type_id: parseInt(document.getElementById('lotType').value, 10),
            status: document.getElementById('lotStatus').value,
            price: parseFloat(document.getElementById('lotPrice').value),
            dimensions: document.getElementById('lotDimensions').value.trim() || null,
            location_notes: document.getElementById('lotNotes').value.trim() || null,
        };

        if (!data.block_id || !data.lot_number || !data.lot_type_id || !data.price) {
            alert('Please fill in all required fields.');
            return;
        }

        try {
            let result;
            if (id) {
                result = await apiRequest(`lots/${id}`, { method: 'PUT', body: data });
            } else {
                result = await apiRequest('lots', { method: 'POST', body: data });
            }
            if (result.success) {
                document.getElementById('lotModal').style.display = 'none';
                await refreshAll();
            } else {
                alert(result.error || 'Failed to save lot');
            }
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });

    async function refreshAll() {
        try {
            const stats = await loadStats();
            renderStats(stats);

            const sections = await loadSections();
            allSections = sections;
            if (!currentSection && sections.length > 0) {
                currentSection = sections[0].section_name;
            }
            renderTabs(sections, currentSection);
            await loadAndRenderLots(currentSection);
        } catch (error) {
            console.error('Refresh failed:', error);
        }
    }

    try {
        await loadLotTypes();
        const stats = await loadStats();
        renderStats(stats);

        const sections = await loadSections();
        allSections = sections;
        if (sections.length > 0) {
            currentSection = sections[0].section_name;
            renderTabs(sections, currentSection);
            await loadAndRenderLots(currentSection);
        } else {
            gridContainer.innerHTML = '<div class="no-lots">No sections found. Please create a section first.</div>';
        }
    } catch (error) {
        console.error('Initialization failed:', error);
        alert('Failed to load lot data. Please check your connection and try again.');
    }

    document.getElementById('openAddLotModal').addEventListener('click', openAddModal);
    document.querySelector('.close').addEventListener('click', () => document.getElementById('lotModal').style.display = 'none');
    document.querySelector('.close-view').addEventListener('click', () => document.getElementById('viewModal').style.display = 'none');

    window.addEventListener('click', (e) => {
        if (e.target === document.getElementById('lotModal')) document.getElementById('lotModal').style.display = 'none';
        if (e.target === document.getElementById('viewModal')) document.getElementById('viewModal').style.display = 'none';
    });
});
