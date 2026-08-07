document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin', 'staff']);
    if (!user) return;

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    const steps = document.querySelectorAll('.step');
    const stepContents = document.querySelectorAll('.step-content');
    const budgetSlider = document.getElementById('prefBudget');
    const budgetValue = document.getElementById('budgetValue');
    const recommendationsList = document.getElementById('recommendationsList');
    const recommendationSummary = document.getElementById('recommendationSummary');
    const confirmationDetails = document.getElementById('confirmationDetails');
    const scheduleForm = document.getElementById('preferencesForm');
    const prefDate = document.getElementById('prefDate');
    const prefDecedent = document.getElementById('prefDecedent');
    const prefLotNumber = document.getElementById('prefLotNumber');
    const selectLotInput = document.getElementById('prefLotType');
    const selectSectionInput = document.getElementById('prefSection');
    const selectNotesInput = document.getElementById('prefNotes');
    const selectBudgetInput = budgetSlider;
    const selectTimeInput = document.getElementById('prefTime');
    const confirmBookingButton = document.getElementById('confirmBooking');

    let currentPreferences = {};
    let selectedLot = null;
    let decedents = [];
    let lotTypes = [];
    let sections = [];

    budgetValue.textContent = budgetSlider.value;
    budgetSlider.addEventListener('input', () => {
        budgetValue.textContent = budgetSlider.value;
    });

    function showStep(stepNumber) {
        steps.forEach((step, idx) => {
            step.classList.toggle('active', idx + 1 === stepNumber);
        });
        stepContents.forEach((content, idx) => {
            content.classList.toggle('active', idx + 1 === stepNumber);
        });
    }

    async function loadDecedents() {
        try {
            decedents = await api.request('decedents', { method: 'GET' });
            if (!Array.isArray(decedents) || decedents.length === 0) {
                prefDecedent.innerHTML = '<option value="">No decedent records available</option>';
                return;
            }
            prefDecedent.innerHTML = '<option value="">Select decedent</option>' + decedents.map(d => `
                <option value="${d.decedent_id}">${d.first_name} ${d.last_name} (${d.lot_number})</option>
            `).join('');
        } catch (error) {
            console.error('Failed to load decedents', error);
            prefDecedent.innerHTML = '<option value="">Failed to load decedents</option>';
        }
    }

    async function loadLookupData() {
        try {
            const [sectionsResponse, lotTypesResponse] = await Promise.all([
                api.request('sections', { method: 'GET' }),
                api.request('lot-types', { method: 'GET' }),
            ]);

            sections = Array.isArray(sectionsResponse) ? sectionsResponse : [];
            lotTypes = Array.isArray(lotTypesResponse) ? lotTypesResponse : [];

            selectSectionInput.innerHTML = '<option value="">Any section</option>' + sections.map(section => `
                <option value="${section.section_name}">${section.section_name}</option>
            `).join('');

            selectLotInput.innerHTML = '<option value="">Select lot type</option>' + lotTypes.map(type => `
                <option value="${type.type_name}">${type.type_name}</option>
            `).join('');
        } catch (error) {
            console.error('Failed to load lookup data', error);
        }
    }

    async function generateRecommendations() {
        const preferences = {
            lot_number: prefLotNumber.value.trim(),
            lot_type: selectLotInput.value,
            budget: parseInt(selectBudgetInput.value, 10),
            section: selectSectionInput.value
        };
        try {
            const recommendations = await api.request('schedules/recommend', {
                method: 'POST',
                body: preferences
            });
            const lotCount = Array.isArray(recommendations) ? recommendations.length : 0;
            recommendationSummary.textContent = lotCount
                ? `${lotCount} available recommendation${lotCount === 1 ? '' : 's'} found for your search criteria.`
                : 'No matching lots available. Please adjust your filters or search terms.';

            if (!recommendations || recommendations.length === 0) {
                recommendationsList.innerHTML = '<p class="text-center">No matching lots available. Please adjust your preferences.</p>';
                return;
            }
            recommendationsList.innerHTML = recommendations.map(lot => `
                <div class="recommendation-card" data-lot-id="${lot.lot_id}">
                    <div>
                        <strong>${lot.lot_number} — ${lot.section_name || 'N/A'}</strong><br>
                        <span class="lot-type-tag">${lot.lot_type_name || 'N/A'}</span> | $${parseFloat(lot.price).toLocaleString()}<br>
                        <span class="status-badge status-success">${lot.status || 'Available'}</span>
                    </div>
                    <div class="recommendation-actions">
                        <div class="score">${lot.score || 0}% suitability</div>
                        <button class="select-lot-btn" type="button" data-lot='${JSON.stringify(lot)}'>Reserve</button>
                    </div>
                </div>
            `).join('');
            document.querySelectorAll('.select-lot-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    selectedLot = JSON.parse(btn.getAttribute('data-lot'));
                    displayConfirmation(selectedLot);
                    showStep(3);
                });
            });
        } catch (error) {
            console.error('Recommendation API failed', error);
            recommendationSummary.textContent = 'Could not load recommendations. Please try again later.';
            recommendationsList.innerHTML = '<p class="text-center">Could not load recommendations. Please try again.</p>';
        }
    }

    function displayConfirmation(lot) {
        const details = `
            <div class="confirmation-box">
                <p><strong>Lot:</strong> ${lot.lot_number} (${lot.section_name || 'N/A'})</p>
                <p><strong>Type:</strong> ${lot.lot_type_name || 'N/A'}</p>
                <p><strong>Price:</strong> $${parseFloat(lot.price).toLocaleString()}</p>
                <p><strong>Burial Date:</strong> ${currentPreferences.date}</p>
                <p><strong>Burial Time:</strong> ${currentPreferences.time || 'Not specified'}</p>
                <p><strong>Decedent:</strong> ${currentPreferences.decedentName || 'N/A'}</p>
                <p><strong>Notes:</strong> ${currentPreferences.notes || 'None'}</p>
                <p class="muted">This reservation will remain pending until an administrator or staff member reviews and approves it.</p>
            </div>
        `;
        confirmationDetails.innerHTML = details;
    }

    scheduleForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        const decedentId = prefDecedent.value;
        const date = prefDate.value;
        if (!decedentId) {
            alert('Please select a decedent.');
            return;
        }
        if (!date) {
            alert('Please select a burial date.');
            return;
        }
        currentPreferences = {
            lot_type: selectLotInput.value,
            budget: parseInt(selectBudgetInput.value, 10),
            section: selectSectionInput.value,
            date: date,
            time: selectTimeInput.value || null,
            notes: selectNotesInput.value.trim(),
            deceased_id: decedentId,
            decedentName: decedents.find(d => d.decedent_id.toString() === decedentId)?.first_name + ' ' + decedents.find(d => d.decedent_id.toString() === decedentId)?.last_name || ''
        };
        await generateRecommendations();
        showStep(2);
    });

    document.querySelectorAll('.btn-back').forEach(btn => {
        btn.addEventListener('click', () => {
            const step = parseInt(btn.getAttribute('data-back'), 10);
            showStep(step);
        });
    });

    confirmBookingButton.addEventListener('click', async function() {
        if (!selectedLot) {
            alert('Please select a lot first.');
            return;
        }
        try {
            const conflict = await api.request(`schedules/check-conflict?lot_id=${selectedLot.lot_id}&date=${currentPreferences.date}${currentPreferences.time ? `&time=${encodeURIComponent(currentPreferences.time)}` : ''}`);
            if (!conflict.available) {
                alert('This lot is already booked for the selected date/time. Please choose another lot or date.');
                return;
            }
            const payload = {
                lot_id: selectedLot.lot_id,
                deceased_id: parseInt(currentPreferences.deceased_id, 10),
                schedule_date: currentPreferences.date,
                schedule_time: currentPreferences.time,
                status: 'Pending',
                notes: currentPreferences.notes || null
            };
            const result = await api.request('schedules', {
                method: 'POST',
                body: payload
            });
            if (result.success) {
                alert('Reservation request submitted and pending approval.');
                scheduleForm.reset();
                budgetValue.textContent = '10000';
                prefLotNumber.value = '';
                selectTimeInput.value = '';
                selectedLot = null;
                currentPreferences = {};
                showStep(1);
            } else {
                alert(result.error || 'Failed to create schedule');
            }
        } catch (error) {
            alert(error.message || 'Error creating schedule');
        }
    });

    steps.forEach(step => {
        step.addEventListener('click', () => {
            const stepNum = parseInt(step.getAttribute('data-step'), 10);
            if (stepNum === 1) {
                showStep(1);
                return;
            }
            if (stepNum === 2 && !currentPreferences.date) {
                alert('Please complete preferences first.');
                return;
            }
            if (stepNum === 3 && !selectedLot) {
                alert('Please select a lot first.');
                return;
            }
            showStep(stepNum);
        });
    });

    prefDate.setAttribute('min', new Date().toISOString().split('T')[0]);
    
    // Feature 3: Disable Monday Booking
    prefDate.addEventListener('change', () => {
        if (!prefDate.value) return;
        const selected = new Date(prefDate.value + 'T00:00:00');
        if (selected.getDay() === 1) { // 1 = Monday
            alert('Monday booking is not allowed. Please select another day of the week.');
            prefDate.value = '';
        }
    });

    await Promise.all([loadDecedents(), loadLookupData()]);

    // Check if lot_id passed via URL query params (from Interactive Slot Grid)
    const urlParams = new URLSearchParams(window.location.search);
    const urlLotId = urlParams.get('lot_id');
    if (urlLotId) {
        try {
            const lot = await api.request(`lots/${urlLotId}`);
            if (lot && !lot.error) {
                selectedLot = lot;
                if (lot.section_name) selectSectionInput.value = lot.section_name;
                if (lot.lot_type_name) selectLotInput.value = lot.lot_type_name;
                if (lot.price) {
                    budgetSlider.value = lot.price;
                    budgetValue.textContent = lot.price;
                }
            }
        } catch (err) {
            console.error('Failed to pre-fetch lot from URL', err);
        }
    }

    showStep(1);
});
