document.addEventListener('DOMContentLoaded', async function() {
    const session = await requireRole(['user']);
    if (!session) return;

    const lotSelect = document.getElementById('lotNumber');
    const sectionInput = document.getElementById('section');
    const searchInput = document.getElementById('searchInput');
    const tableBody = document.getElementById('tableBody');
    const recordModal = document.getElementById('recordModal');
    const viewModal = document.getElementById('viewModal');
    const recordForm = document.getElementById('recordForm');
    const ashStorageGroup = document.getElementById('ashStorageGroup');
    const modalTitle = document.getElementById('modalTitle');
    const viewDetails = document.getElementById('viewDetails');

    let lots = [];
    let records = [];
    let currentEditId = null;
    let currentQuery = '';

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

    document.getElementById('openAddModal').addEventListener('click', openAddModal);
    document.querySelector('.close').addEventListener('click', () => recordModal.style.display = 'none');
    document.querySelector('.close-view').addEventListener('click', () => viewModal.style.display = 'none');
    window.addEventListener('click', (e) => {
        if (e.target === recordModal) recordModal.style.display = 'none';
        if (e.target === viewModal) viewModal.style.display = 'none';
    });
    searchInput.addEventListener('input', () => {
        currentQuery = searchInput.value.trim();
        loadRecords();
    });

    recordForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        await saveRecord();
    });

    document.getElementById('isCremated').addEventListener('change', function() {
        ashStorageGroup.style.display = this.value === 'yes' ? 'block' : 'none';
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
        } catch (error) {
            console.error('Failed to initialize page', error);
            tableBody.innerHTML = '<tr><td colspan="7">Could not load records. Please refresh.</td></tr>';
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
        const query = currentQuery ? `?q=${encodeURIComponent(currentQuery)}` : '';
        records = await api.request(`decedents${query}`, { method: 'GET' });
        renderTable(records);
    }

    async function loadStats() {
        const stats = await api.request('decedents/stats', { method: 'GET' });
        document.getElementById('totalCount').innerText = stats.total || 0;
        document.getElementById('burialCount').innerText = stats.burials || 0;
        document.getElementById('cremationCount').innerText = stats.cremations || 0;
        document.getElementById('avgAge').innerText = stats.avg_age || 0;
    }

    function renderTable(items) {
        if (!items || items.length === 0) {
            tableBody.innerHTML = '<tr><td colspan="7">No records found.</td></tr>';
            return;
        }

        tableBody.innerHTML = items.map((item) => `
            <tr data-id="${item.decedent_id}">
                <td>D-${item.decedent_id}</td>
                <td>${escapeHtml(`${item.first_name} ${item.last_name}${item.suffix ? ' ' + item.suffix : ''}`)}</td>
                <td>${escapeHtml(item.dob)}</td>
                <td>${escapeHtml(item.dod)}</td>
                <td>${escapeHtml(item.lot_number)}</td>
                <td>${escapeHtml(item.section_name)}</td>
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
        `).join('');

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
        recordModal.style.display = 'flex';
    }

    function openViewModal(id) {
        const record = records.find((item) => item.decedent_id === id);
        if (!record) {
            return;
        }

        const details = `
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
    }

    async function saveRecord() {
        const id = document.getElementById('recordId').value;
        const lotId = parseInt(lotSelect.value, 10);
        if (!lotId) {
            alert('Please select a lot.');
            return;
        }

        const payload = {
            lot_id: lotId,
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

        try {
            let result;
            if (id) {
                result = await api.request(`decedents/${id}`, { method: 'PUT', body: payload });
            } else {
                result = await api.request('decedents', { method: 'POST', body: payload });
            }

            if (result.success) {
                recordModal.style.display = 'none';
                await refreshPage();
            } else {
                alert(result.error || 'Could not save record.');
            }
        } catch (error) {
            alert(error.message || 'Could not save record.');
        }
    }

    async function deleteRecord(id) {
        if (!confirm('Delete this record? This action cannot be undone.')) {
            return;
        }
        try {
            const result = await api.request(`decedents/${id}`, { method: 'DELETE' });
            if (result.success) {
                await refreshPage();
            } else {
                alert(result.error || 'Could not delete record.');
            }
        } catch (error) {
            alert(error.message || 'Could not delete record.');
        }
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) {
            return '';
        }
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }
});