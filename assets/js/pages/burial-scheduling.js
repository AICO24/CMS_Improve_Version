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
    const chatWindow = document.getElementById('chatWindow');
    const chatForm = document.getElementById('chatForm');
    const chatInput = document.getElementById('chatInput');
    const chatFindLotsBtn = document.getElementById('chatFindLotsBtn');
    const chatPrefStatus = document.getElementById('chatPrefStatus');

    let currentPreferences = {};
    let selectedLot = null;
    let decedents = [];
    let lotTypes = [];
    let sections = [];
    let chatState = { lot_type: null, budget: null, section: null };

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

    // ---------- Conversational preference collection (Phase 2) ----------
    // Deterministic slot-filling only: no LLM, no free-form NLP. Extracted
    // values are always validated against the live lotTypes/sections lists
    // fetched by loadLookupData(), never accepted as raw user text.
    const CHAT_SKIP_PHRASES = ['any', 'anything', 'no preference', 'not sure', "doesn't matter", 'does not matter', 'skip', "i don't know", 'idk', 'n/a', 'none', 'whatever'];

    function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function isChatSkipMessage(text) {
        const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, '');
        return CHAT_SKIP_PHRASES.includes(normalized);
    }

    function containsDigits(text) {
        return /\d/.test(text);
    }

    function describeOptions(list, key) {
        const names = list.map(item => item[key]).filter(Boolean);
        return names.length ? names.join(', ') : 'none configured yet';
    }

    function formatBudget(value) {
        return `₱${Number(value).toLocaleString()}`;
    }

    function extractLotTypeFromText(text) {
        const lower = text.toLowerCase();
        for (const type of lotTypes) {
            const fullName = (type.type_name || '').toLowerCase();
            if (!fullName) continue;
            if (lower.includes(fullName)) return type.type_name;
            const shortName = fullName.replace(/\blot\b/g, '').trim();
            if (shortName && new RegExp(`\\b${escapeRegExp(shortName)}\\b`, 'i').test(lower)) {
                return type.type_name;
            }
        }
        return null;
    }

    function extractSectionFromText(text) {
        const lower = text.toLowerCase();
        for (const section of sections) {
            const fullName = (section.section_name || '').toLowerCase();
            if (fullName && lower.includes(fullName)) return section.section_name;
        }
        const match = lower.match(/section\s*([a-z0-9]+)/i);
        if (match) {
            const candidate = `section ${match[1]}`.toLowerCase();
            const found = sections.find(s => (s.section_name || '').toLowerCase() === candidate);
            if (found) return found.section_name;
        }
        return null;
    }

    function extractBudgetFromText(text) {
        const cleaned = text.replace(/[₱$]/g, '').replace(/,/g, '');
        const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(k)?\b/i);
        if (!match) return null;
        let value = parseFloat(match[1]);
        if (!isFinite(value) || value <= 0) return null;
        if (match[2]) value *= 1000;
        return Math.round(value);
    }

    function getNextMissingChatSlot() {
        if (chatState.lot_type === null) return 'lot_type';
        if (chatState.budget === null) return 'budget';
        if (chatState.section === null) return 'section';
        return null;
    }

    function questionForChatSlot(slot) {
        if (slot === 'lot_type') {
            return `What lot type are you looking for? Available options: ${describeOptions(lotTypes, 'type_name')}.`;
        }
        if (slot === 'budget') {
            return 'What is your preferred budget? (e.g., 8000, 8,000, ₱8,000, or 8k)';
        }
        if (slot === 'section') {
            return `Do you have a preferred section? Available options: ${describeOptions(sections, 'section_name')}.`;
        }
        return null;
    }

    function appendChatMessage(role, text) {
        const bubble = document.createElement('div');
        bubble.className = `chat-message ${role}`;
        bubble.textContent = text;
        chatWindow.appendChild(bubble);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function updateChatPreferenceChips() {
        Object.keys(chatState).forEach(field => {
            const chip = chatPrefStatus.querySelector(`[data-field="${field}"]`);
            if (!chip) return;
            const strong = chip.querySelector('strong');
            const value = chatState[field];
            if (value === null) {
                strong.textContent = 'Not set';
                chip.classList.remove('filled');
            } else if (value === '') {
                strong.textContent = 'No preference';
                chip.classList.add('filled');
            } else {
                strong.textContent = field === 'budget' ? formatBudget(value) : value;
                chip.classList.add('filled');
            }
        });
    }

    function updateChatFindButtonState() {
        const ready = chatState.lot_type !== null && chatState.budget !== null && chatState.section !== null;
        chatFindLotsBtn.disabled = !ready;
    }

    function processChatMessage(rawText) {
        const text = rawText.trim();
        if (!text) return;

        appendChatMessage('user', text);

        const pendingSlot = getNextMissingChatSlot();
        const updates = {};

        if (chatState.lot_type === null) {
            const lotType = extractLotTypeFromText(text);
            if (lotType) updates.lot_type = lotType;
        }
        if (chatState.section === null) {
            const section = extractSectionFromText(text);
            if (section) updates.section = section;
        }
        if (chatState.budget === null) {
            const budget = extractBudgetFromText(text);
            if (budget !== null) updates.budget = budget;
        }

        // Only treat the message as an explicit "skip" for the currently
        // pending slot, and only when nothing else was recognized in it —
        // avoids misreading unrelated text as a skip.
        if (pendingSlot && updates[pendingSlot] === undefined && Object.keys(updates).length === 0 && isChatSkipMessage(text)) {
            updates[pendingSlot] = '';
        }

        Object.keys(updates).forEach(field => { chatState[field] = updates[field]; });
        updateChatPreferenceChips();

        const acknowledgements = [];
        if (updates.lot_type !== undefined) {
            acknowledgements.push(updates.lot_type ? `Got it — ${updates.lot_type}.` : "Okay, no preference on lot type.");
        }
        if (updates.budget !== undefined) {
            acknowledgements.push(updates.budget !== '' ? `Noted — budget around ${formatBudget(updates.budget)}.` : "No problem, I won't filter by budget.");
        }
        if (updates.section !== undefined) {
            acknowledgements.push(updates.section ? `Noted — ${updates.section}.` : 'Okay, any section works.');
        }

        if (acknowledgements.length) {
            appendChatMessage('assistant', acknowledgements.join(' '));
        } else if (pendingSlot === 'lot_type') {
            appendChatMessage('assistant', `I couldn't match that to an available lot type. Available options: ${describeOptions(lotTypes, 'type_name')}. You can also say "no preference".`);
        } else if (pendingSlot === 'budget') {
            appendChatMessage('assistant', containsDigits(text)
                ? "I couldn't read a budget from that. Try formats like 8000, 8,000, ₱8,000, or 8k. You can also say \"no preference\"."
                : 'Could you share a budget? For example: 8000 or ₱8,000. You can also say "no preference".');
        } else if (pendingSlot === 'section') {
            appendChatMessage('assistant', `I couldn't match that to an available section. Available options: ${describeOptions(sections, 'section_name')}. You can also say "no preference".`);
        }

        const nextSlot = getNextMissingChatSlot();
        if (nextSlot) {
            appendChatMessage('assistant', questionForChatSlot(nextSlot));
        } else {
            appendChatMessage('assistant', 'Thanks! I have enough information to search for matching lots.');
        }

        updateChatFindButtonState();
    }

    function initChat() {
        chatInput.disabled = false;
        chatForm.querySelector('.chat-send-btn').disabled = false;
        appendChatMessage('assistant', `Hi! Tell me what you're looking for and I'll help find a lot — for example, "I'd like a ${lotTypes[0] ? lotTypes[0].type_name : 'Premium Lot'} around 8000 in ${sections[0] ? sections[0].section_name : 'Section A'}".`);
        appendChatMessage('assistant', questionForChatSlot(getNextMissingChatSlot()));
        updateChatPreferenceChips();
        updateChatFindButtonState();
    }

    // Phase 3: reports what fetchAndRenderRecommendations() actually did —
    // never claims a result it didn't return, and never suggests adjusting a
    // preference the user never set. Only mentions lot_type/budget/section;
    // burial date/time/decedent/capacity are outside the recommendation
    // engine's inputs and are never referenced here.
    function appendRecommendationOutcomeMessage(outcome) {
        if (!outcome) return;
        if (outcome.status === 'success') {
            const count = outcome.count;
            appendChatMessage('assistant', `Based on your preferences, I found ${count} available lot${count === 1 ? '' : 's'} that ${count === 1 ? 'matches' : 'match'} your request. Take a look below — each card explains why it was recommended.`);
        } else if (outcome.status === 'empty') {
            const suggestions = [];
            if (chatState.lot_type) suggestions.push('choosing a different lot type');
            if (chatState.budget !== null && chatState.budget !== '') suggestions.push('increasing your budget');
            if (chatState.section) suggestions.push('selecting another section');
            let message = "I couldn't find an available lot matching your current preferences.";
            if (suggestions.length) {
                message += ` You could try ${suggestions.join(' or ')}.`;
            }
            appendChatMessage('assistant', message);
        } else {
            appendChatMessage('assistant', "I'm having trouble reaching the recommendation service right now. I've shown the available lots below so you can browse manually instead.");
        }
    }

    // Phase 3: purely presentational — renders whatever reasons[] the
    // existing recommendation engine already returned. Never invents a
    // reason and never touches score/ranking/ordering.
    function buildRecommendationExplanation(lot) {
        const reasons = Array.isArray(lot.reasons) ? lot.reasons : [];
        if (!reasons.length) {
            return '<div class="recommendation-reasons-empty">No specific preferences were matched — shown as an available lot.</div>';
        }
        return `
            <div class="recommendation-reasons-label">Why this is recommended:</div>
            <ul class="recommendation-reasons">${reasons.map(reason => `<li>${reason}</li>`).join('')}</ul>
        `;
    }

    function buildLotCard(lot) {
        const hasScore = lot.score !== undefined && lot.score !== null;
        return `
            <div class="recommendation-card" data-lot-id="${lot.lot_id}">
                <div>
                    <strong>${lot.lot_number} — ${lot.section_name || 'N/A'}</strong><br>
                    <span class="lot-type-tag">${lot.lot_type_name || 'N/A'}</span> | $${parseFloat(lot.price).toLocaleString()}<br>
                    <span class="status-badge status-success">${lot.status || 'Available'}</span>
                </div>
                <div class="recommendation-actions">
                    ${hasScore ? `<div class="score">${lot.score || 0}% suitability</div>` : ''}
                    ${buildRecommendationExplanation(lot)}
                    <button class="select-lot-btn" type="button" data-lot='${JSON.stringify(lot)}'>Reserve</button>
                </div>
            </div>
        `;
    }

    function attachSelectHandlers() {
        document.querySelectorAll('.select-lot-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                selectedLot = JSON.parse(btn.getAttribute('data-lot'));
                displayConfirmation(selectedLot);
                showStep(3);
            });
        });
    }

    async function showManualLotFallback() {
        recommendationSummary.textContent = 'AI recommendations are temporarily unavailable. Showing available lots you can choose from manually.';
        recommendationSummary.classList.add('is-fallback');
        try {
            const availableLots = await api.request('lots?status=Available', { method: 'GET' });
            const lots = Array.isArray(availableLots) ? availableLots.slice(0, 10) : [];
            if (lots.length === 0) {
                recommendationsList.innerHTML = '<p class="text-center">No available lots to display right now. Please try again later.</p>';
                return;
            }
            recommendationsList.innerHTML = lots.map(buildLotCard).join('');
            attachSelectHandlers();
        } catch (error) {
            console.error('Failed to load available lots for manual browsing', error);
            recommendationsList.innerHTML = '<p class="text-center">Could not load available lots. Please try again later.</p>';
        }
    }

    // Returns a small outcome summary ({status, count}) alongside its existing
    // DOM-rendering job, purely so callers (e.g. the chat layer) can react to
    // what actually happened without re-fetching or re-deriving it themselves.
    // Rendering, summary text, and fallback behavior below are unchanged from
    // Phase 1/2.
    async function fetchAndRenderRecommendations(preferences) {
        recommendationSummary.classList.remove('is-fallback');
        try {
            const recommendations = await api.request('schedules/recommend', {
                method: 'POST',
                body: preferences
            });

            if (!Array.isArray(recommendations)) {
                await showManualLotFallback();
                return { status: 'error' };
            }

            const lotCount = recommendations.length;
            recommendationSummary.textContent = lotCount
                ? `${lotCount} available recommendation${lotCount === 1 ? '' : 's'} found for your search criteria.`
                : 'No matching lots available. Please adjust your filters or search terms.';

            if (lotCount === 0) {
                recommendationsList.innerHTML = '<p class="text-center">No matching lots available. Please adjust your preferences.</p>';
                return { status: 'empty', count: 0 };
            }
            recommendationsList.innerHTML = recommendations.map(buildLotCard).join('');
            attachSelectHandlers();
            return { status: 'success', count: lotCount };
        } catch (error) {
            console.error('Recommendation API failed', error);
            await showManualLotFallback();
            return { status: 'error' };
        }
    }

    async function generateRecommendations() {
        const preferences = {
            lot_number: prefLotNumber.value.trim(),
            lot_type: selectLotInput.value,
            budget: parseInt(selectBudgetInput.value, 10),
            section: selectSectionInput.value
        };
        await fetchAndRenderRecommendations(preferences);
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
        const getRecsBtn = scheduleForm.querySelector('button[type="submit"]');
        await withButtonLoading(getRecsBtn, async () => {
            await generateRecommendations();
            showStep(2);
        });
    });

    chatForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const text = chatInput.value;
        if (!text.trim()) return;
        chatInput.value = '';
        processChatMessage(text);
    });

    chatFindLotsBtn.addEventListener('click', async function() {
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
        const decedent = decedents.find(d => d.decedent_id.toString() === decedentId);
        currentPreferences = {
            lot_type: chatState.lot_type || '',
            budget: chatState.budget === '' || chatState.budget === null ? '' : chatState.budget,
            section: chatState.section || '',
            date: date,
            time: selectTimeInput.value || null,
            notes: selectNotesInput.value.trim(),
            deceased_id: decedentId,
            decedentName: decedent ? `${decedent.first_name} ${decedent.last_name}` : ''
        };
        await withButtonLoading(chatFindLotsBtn, async () => {
            const outcome = await fetchAndRenderRecommendations({
                lot_type: currentPreferences.lot_type,
                budget: currentPreferences.budget,
                section: currentPreferences.section
            });
            appendRecommendationOutcomeMessage(outcome);
            showStep(2);
        });
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
        await withButtonLoading(confirmBookingButton, async () => {
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
    initChat();

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
