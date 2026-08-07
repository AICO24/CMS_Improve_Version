document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    const statsEls = {
        total: document.getElementById('totalNiches'),
        occupied: document.getElementById('occupiedNiches'),
        available: document.getElementById('availableNiches'),
        rate: document.getElementById('occupancyRate')
    };
    const gridContainer = document.getElementById('columbariumGrid');
    const viewModal = document.getElementById('viewModal');
    const cremationModal = document.getElementById('cremationModal');
    const assignModal = document.getElementById('assignModal');
    const assignNicheNumber = document.getElementById('assignNicheNumber');
    const assignColumbarium = document.getElementById('assignColumbarium');
    const assignLevel = document.getElementById('assignLevel');
    const assignDecedentId = document.getElementById('assignDecedentId');
    const cremationForm = document.getElementById('cremationForm');
    const assignForm = document.getElementById('assignForm');

    async function apiRequest(endpoint, options = {}) {
        return await api.request(endpoint, options);
    }

    async function loadStats() {
        return await apiRequest('cremations/stats');
    }

    async function loadNiches() {
        return await apiRequest('cremations/niches');
    }

    function renderStats(stats) {
        statsEls.total.innerText = stats.total || 0;
        statsEls.occupied.innerText = stats.occupied || 0;
        statsEls.available.innerText = stats.available || 0;
        statsEls.rate.innerText = `${stats.occupancy_rate || 0}%`;
    }

    function renderNiches(niches) {
        if (!Array.isArray(niches) || niches.length === 0) {
            gridContainer.innerHTML = '<div class="no-lots">No niches available. Click "Add New Cremation Record" to create one.</div>';
            return;
        }

        gridContainer.innerHTML = niches.map(niche => `
            <div class="niche-card" data-id="${niche.cremation_id || niche.niche_number}">
                <div class="niche-number">${niche.niche_number}</div>
                <div class="niche-location">${niche.columbarium || 'N/A'} | Level ${niche.level || 1}</div>
                <div class="niche-status status-${niche.status}">${niche.status === 'occupied' ? 'Occupied' : 'Available'}</div>
                ${niche.first_name ? `<div class="deceased-name">${niche.first_name} ${niche.last_name}</div>` : ''}
            </div>
        `).join('');

        gridContainer.querySelectorAll('.niche-card').forEach(card => {
            card.addEventListener('click', () => {
                const id = card.dataset.id;
                const niche = niches.find(n => (n.cremation_id || n.niche_number).toString() === id.toString());
                if (niche) {
                    showViewModal(niche);
                }
            });
        });
    }

    async function refreshAll() {
        try {
            const stats = await loadStats();
            renderStats(stats);
            const niches = await loadNiches();
            renderNiches(niches);
        } catch (error) {
            console.error('Failed to refresh cremation dashboard', error);
            gridContainer.innerHTML = '<div class="error">Failed to load cremation data. Please refresh.</div>';
        }
    }

    function showViewModal(niche) {
        const details = `
            <div class="detail-row"><span>Niche Number</span><strong>${niche.niche_number}</strong></div>
            <div class="detail-row"><span>Columbarium</span><strong>${niche.columbarium || 'N/A'}</strong></div>
            <div class="detail-row"><span>Level</span><strong>${niche.level || 1}</strong></div>
            <div class="detail-row"><span>Status</span><strong>${niche.status === 'occupied' ? 'Occupied' : 'Available'}</strong></div>
            <div class="detail-row"><span>Assigned To</span><strong>${niche.first_name ? `${niche.first_name} ${niche.last_name}` : '—'}</strong></div>
        `;
        document.getElementById('viewDetails').innerHTML = details;
        document.getElementById('viewModal').style.display = 'flex';

        const editBtn = document.getElementById('editFromView');
        const assignBtn = document.getElementById('assignFromView');
        const deleteBtn = document.getElementById('deleteFromView');

        if (niche.cremation_id) {
            editBtn.style.display = 'inline-block';
            editBtn.onclick = () => {
                document.getElementById('viewModal').style.display = 'none';
                openEditModal(niche.cremation_id);
            };
            deleteBtn.style.display = 'inline-block';
            deleteBtn.onclick = async () => {
                if (!confirm('Delete this cremation record?')) {
                    return;
                }
                try {
                    await apiRequest(`cremations/${niche.cremation_id}`, { method: 'DELETE' });
                    document.getElementById('viewModal').style.display = 'none';
                    await refreshAll();
                } catch (error) {
                    alert(error.message || 'Failed to delete cremation record');
                }
            };
        } else {
            editBtn.style.display = 'none';
            deleteBtn.style.display = 'none';
        }

        if (niche.status === 'available') {
            assignBtn.style.display = 'inline-block';
            assignBtn.onclick = () => {
                document.getElementById('viewModal').style.display = 'none';
                openAssignModal(niche);
            };
        } else {
            assignBtn.style.display = 'none';
        }
    }

    async function openAddModal() {
        document.getElementById('modalTitle').innerText = 'Add New Cremation Record';
        cremationForm.reset();
        document.getElementById('cremationId').value = '';
        await populateDecedents();
        cremationModal.style.display = 'flex';
    }

    async function openEditModal(id) {
        try {
            const record = await apiRequest(`cremations/${id}`);
            if (record.error) {
                alert(record.error);
                return;
            }
            document.getElementById('modalTitle').innerText = 'Edit Cremation Record';
            document.getElementById('cremationId').value = record.cremation_id;
            document.getElementById('deceasedId').value = record.deceased_id;
            document.getElementById('nicheNumber').value = record.niche_number || '';
            document.getElementById('columbarium').value = record.columbarium || '';
            document.getElementById('level').value = record.level || 1;
            document.getElementById('cremationDate').value = record.cremation_date || '';
            document.getElementById('cremationStatus').value = record.status || 'Scheduled';
            document.getElementById('ashStorage').value = record.ash_storage_location || '';
            document.getElementById('cremationNotes').value = record.notes || '';
            await populateDecedents(record.deceased_id);
            cremationModal.style.display = 'flex';
        } catch (error) {
            alert('Failed to load record: ' + error.message);
        }
    }

    function openAssignModal(niche) {
        assignModal.style.display = 'flex';
        assignNicheNumber.value = niche.niche_number;
        assignColumbarium.value = niche.columbarium || '';
        assignLevel.value = niche.level || 1;
        populateDecedentsForAssign();
    }

    async function populateDecedents(selectedId = null) {
        try {
            const decedents = await apiRequest('decedents');
            const select = document.getElementById('deceasedId');
            select.innerHTML = '<option value="">Select decedent</option>' +
                decedents.map(d => `
                    <option value="${d.decedent_id}" ${d.decedent_id == selectedId ? 'selected' : ''}>
                        ${d.first_name} ${d.last_name}
                    </option>
                `).join('');
        } catch (error) {
            console.error('Failed to load decedents', error);
            document.getElementById('deceasedId').innerHTML = '<option value="">Failed to load decedents</option>';
        }
    }

    async function populateDecedentsForAssign() {
        try {
            const decedents = await apiRequest('decedents?is_cremated=no');
            const select = assignDecedentId;
            select.innerHTML = '<option value="">Select decedent</option>' +
                decedents.map(d => `
                    <option value="${d.decedent_id}">${d.first_name} ${d.last_name}</option>
                `).join('');
        } catch (error) {
            console.error('Failed to load available decedents', error);
            assignDecedentId.innerHTML = '<option value="">Failed to load decedents</option>';
        }
    }

    cremationForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const id = document.getElementById('cremationId').value;
        const deceasedId = parseInt(document.getElementById('deceasedId').value, 10);
        const nicheNumber = document.getElementById('nicheNumber').value.trim() || null;
        const data = {
            deceased_id: deceasedId,
            niche_number: nicheNumber,
            nicheNumber,
            columbarium: document.getElementById('columbarium').value.trim() || null,
            level: parseInt(document.getElementById('level').value, 10) || null,
            cremation_date: document.getElementById('cremationDate').value || null,
            status: document.getElementById('cremationStatus').value || 'Scheduled',
            ash_storage_location: document.getElementById('ashStorage').value.trim() || null,
            ashStorageLocation: document.getElementById('ashStorage').value.trim() || null,
            notes: document.getElementById('cremationNotes').value.trim() || null
        };

        if (!data.deceased_id) {
            alert('Please select a decedent.');
            return;
        }

        try {
            const result = id
                ? await apiRequest(`cremations/${id}`, { method: 'PUT', body: data })
                : await apiRequest('cremations', { method: 'POST', body: data });

            if (result.success) {
                cremationModal.style.display = 'none';
                cremationForm.reset();
                await refreshAll();
                alert('Cremation record saved successfully.');
            } else {
                alert(result.error || 'Failed to save cremation record');
            }
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });

    assignForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const data = {
            deceased_id: parseInt(assignDecedentId.value, 10),
            niche_number: assignNicheNumber.value.trim(),
            nicheNumber: assignNicheNumber.value.trim(),
            columbarium: assignColumbarium.value.trim() || null,
            level: parseInt(assignLevel.value, 10) || null,
            status: 'Completed'
        };

        if (!data.deceased_id) {
            alert('Please select a decedent.');
            return;
        }

        try {
            const result = await apiRequest('cremations/assign', { method: 'POST', body: data });
            if (result.success) {
                assignModal.style.display = 'none';
                assignForm.reset();
                await refreshAll();
                alert('Niche assigned successfully.');
            } else {
                alert(result.error || 'Failed to assign niche');
            }
        } catch (error) {
            alert('Error: ' + error.message);
        }
    });

    document.getElementById('openAddModal').addEventListener('click', openAddModal);
    document.querySelectorAll('.close, .close-view').forEach(el => {
        el.addEventListener('click', () => {
            document.querySelectorAll('.modal').forEach(m => m.style.display = 'none');
        });
    });
    window.addEventListener('click', (e) => {
        document.querySelectorAll('.modal').forEach(m => {
            if (e.target === m) {
                m.style.display = 'none';
            }
        });
    });

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    await refreshAll();
});
