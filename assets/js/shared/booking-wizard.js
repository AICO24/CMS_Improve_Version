// Shared burial-lot booking assistant.
// Modern Intelligence Workspace edition (AI-Driven Scheduling Suite).
// Transforms the interface into a two-column intelligence workspace
// featuring conversational assistant, live booking blueprint HUD,
// rich recommendation cards with match suitability, and digital voucher confirmation.

function renderChatPageMarkup({ mount }) {
    mount.innerHTML = `
        <div class="ai-chat-layout">
            <!-- LEFT COLUMN: Main Conversational Assistant -->
            <div class="ai-chat-main">
                <!-- Assistant Top Header Bar -->
                <div class="ai-assistant-header">
                    <div class="ai-assistant-brand">
                        <div class="ai-avatar-badge">
                            <div class="ai-avatar-glow"></div>
                            <i class="fas fa-monument"></i>
                        </div>
                        <div class="ai-assistant-meta">
                            <div class="ai-title-row">
                                <h4 class="ai-assistant-name">AI Burial Booking Assistant</h4>
                                <span class="ai-status-pill"><span class="status-pulse-dot"></span> Online</span>
                            </div>
                            <p class="ai-assistant-desc">Conversational lot matching, conflict prevention & instant scheduling</p>
                        </div>
                    </div>
                    <div class="ai-header-actions">
                        <button type="button" id="chatStartOverBtn" class="ai-action-btn" title="Clear conversation and start over">
                            <i class="fas fa-rotate-right"></i> <span>Reset</span>
                        </button>
                    </div>
                </div>

                <!-- Chat Stream Window -->
                <div class="chat-window" id="chatWindow" aria-live="polite"></div>

                <!-- Contextual Quick Action Suggestions -->
                <div class="chat-prompt-suggestions" id="chatPromptSuggestions"></div>

                <!-- Interactive Preference Ribbon -->
                <div class="chat-pref-status" id="chatPrefStatus">
                    <div class="pref-chips-container">
                        <span class="chat-pref-chip" data-field="decedent_id"><i class="fas fa-user"></i> Decedent: <strong>Not set</strong></span>
                        <span class="chat-pref-chip" data-field="date"><i class="fas fa-calendar-day"></i> Date: <strong>Not set</strong></span>
                        <span class="chat-pref-chip" data-field="lot_type"><i class="fas fa-monument"></i> Type: <strong>Not set</strong></span>
                        <span class="chat-pref-chip" data-field="budget"><i class="fas fa-peso-sign"></i> Budget: <strong>Not set</strong></span>
                        <span class="chat-pref-chip" data-field="section"><i class="fas fa-map-pin"></i> Section: <strong>Not set</strong></span>
                    </div>
                </div>

                <!-- Message Input Bar -->
                <form id="chatForm" class="chat-input-row">
                    <div class="chat-input-wrapper">
                        <i class="fas fa-comment-dots chat-input-icon"></i>
                        <input type="text" id="chatInput" placeholder="Type a message, decedent name, budget, or preferred date..." autocomplete="off" disabled>
                    </div>
                    <button type="submit" class="chat-send-btn" aria-label="Send message" disabled>
                        <i class="fas fa-paper-plane"></i>
                    </button>
                </form>

                <!-- Auxiliary Action Strip -->
                <div class="chat-actions">
                    <button type="button" id="chatSuggestTypeBtn" class="btn-suggest-type">
                        <i class="fas fa-wand-magic-sparkles"></i> <span>Recommend a type for me</span>
                    </button>
                </div>
            </div>

            <!-- RIGHT COLUMN: Live Booking Blueprint HUD -->
            <aside class="ai-booking-blueprint" id="bookingBlueprint">
                <div class="blueprint-header">
                    <div class="blueprint-title">
                        <i class="fas fa-clipboard-check"></i>
                        <span>Live Booking Blueprint</span>
                    </div>
                    <span class="blueprint-badge" id="blueprintProgressBadge">Step 1 of 4</span>
                </div>

                <div class="blueprint-body">
                    <!-- Progress Stepper Track -->
                    <div class="blueprint-steps">
                        <div class="blueprint-step active" id="stepIndicatorDecedent" data-step="1">
                            <div class="step-num"><i class="fas fa-user"></i></div>
                            <div class="step-content">
                                <span class="step-label">1. Decedent Record</span>
                                <strong class="step-value" id="hudDecedentName">Pending</strong>
                            </div>
                        </div>
                        <div class="blueprint-step" id="stepIndicatorSchedule" data-step="2">
                            <div class="step-num"><i class="fas fa-calendar-alt"></i></div>
                            <div class="step-content">
                                <span class="step-label">2. Burial Schedule</span>
                                <strong class="step-value" id="hudScheduleDate">Pending</strong>
                            </div>
                        </div>
                        <div class="blueprint-step" id="stepIndicatorLot" data-step="3">
                            <div class="step-num"><i class="fas fa-monument"></i></div>
                            <div class="step-content">
                                <span class="step-label">3. Lot Allocation</span>
                                <strong class="step-value" id="hudLotSelected">None selected</strong>
                            </div>
                        </div>
                        <div class="blueprint-step" id="stepIndicatorReview" data-step="4">
                            <div class="step-num"><i class="fas fa-check-double"></i></div>
                            <div class="step-content">
                                <span class="step-label">4. Review & Confirm</span>
                                <strong class="step-value" id="hudStatus">In Progress</strong>
                            </div>
                        </div>
                    </div>

                    <!-- Active Selected Lot Card -->
                    <div class="blueprint-lot-card" id="hudSelectedLotCard" style="display: none;">
                        <div class="hud-card-header">
                            <span class="hud-lot-num" id="hudLotNum">Lot A-101</span>
                            <span class="hud-lot-type" id="hudLotType">Lawn Lot</span>
                        </div>
                        <div class="hud-card-body">
                            <div class="hud-detail-row">
                                <span><i class="fas fa-layer-group"></i> Section:</span>
                                <strong id="hudLotSection">North Lawn</strong>
                            </div>
                            <div class="hud-detail-row">
                                <span><i class="fas fa-tag"></i> Lot Price:</span>
                                <strong class="hud-price" id="hudLotPrice">₱0.00</strong>
                            </div>
                        </div>
                    </div>

                    <!-- Intelligent Assistance Tips -->
                    <div class="blueprint-ai-tips">
                        <div class="tip-header"><i class="fas fa-lightbulb"></i> <span>Smart Tip</span></div>
                        <p class="tip-text" id="hudSmartTip">You can specify decedent name, date, and budget in one sentence (e.g. <em>"Booking for Juan Cruz, August 28, budget 25k"</em>).</p>
                    </div>
                </div>

                <div class="blueprint-footer">
                    <div class="blueprint-total-row">
                        <span class="total-label">Estimated Total</span>
                        <span class="total-amount" id="hudTotalAmount">₱0.00</span>
                    </div>
                </div>
            </aside>
        </div>`;
}

// Batch O: resolves chat text like "the first one"/"the cheapest one"/
// "Lot A-102" against whichever recommendation set was most recently
// rendered.
const LOT_ORDINAL_WORDS = {
    first: 0, second: 1, third: 2, fourth: 3, fifth: 4, sixth: 5,
    '1st': 0, '2nd': 1, '3rd': 2, '4th': 3, '5th': 4, '6th': 5,
};

function parseLotSelectionIntent(text) {
    const lower = text.toLowerCase();
    const lotNumberMatch = lower.match(/\blot\s*([a-z]-\d+|\d{2,})\b/i);
    if (lotNumberMatch) return { type: 'lot_number', value: lotNumberMatch[1].toUpperCase() };
    if (/\b(cheapest|most affordable|least expensive|lowest price)\b/.test(lower)) return { type: 'cheapest' };
    const ordinalMatch = lower.match(/\b(first|second|third|fourth|fifth|sixth|1st|2nd|3rd|4th|5th|6th)\b/);
    if (ordinalMatch && /\b(one|option|lot|choice|pick|take|choose|reserve|select)\b/.test(lower)) {
        return { type: 'ordinal', index: LOT_ORDINAL_WORDS[ordinalMatch[1]] };
    }
    return null;
}

function resolveLotFromIntent(intent, recommendations) {
    if (!recommendations.length) return null;
    if (intent.type === 'lot_number') {
        return recommendations.find(lot => (lot.lot_number || '').toUpperCase() === intent.value) || null;
    }
    if (intent.type === 'ordinal') {
        return recommendations[intent.index] || null;
    }
    if (intent.type === 'cheapest') {
        return recommendations.reduce((cheapest, lot) => (
            cheapest === null || parseFloat(lot.price) < parseFloat(cheapest.price) ? lot : cheapest
        ), null);
    }
    return null;
}

function createBookingWizard(options) {
    const { allowedRoles, renderStatusBadge, onBookingSuccess } = options;

    async function init() {
        const user = await requireRole(allowedRoles);
        if (!user) return;

        renderChatPageMarkup({ mount: document.getElementById('wizardContainerMount') });

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn) {
            logoutBtn.addEventListener('click', () => {
                api.logout();
            });
        }

        const toggleBtn = document.getElementById('toggleSidebar');
        const sidebar = document.querySelector('.sidebar');
        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener('change', () => {
                sidebar.classList.toggle('collapsed');
            });
        }

        const chatWindow = document.getElementById('chatWindow');
        const chatForm = document.getElementById('chatForm');
        const chatInput = document.getElementById('chatInput');
        const chatSuggestTypeBtn = document.getElementById('chatSuggestTypeBtn');
        const chatStartOverBtn = document.getElementById('chatStartOverBtn');
        const chatPrefStatus = document.getElementById('chatPrefStatus');
        const chatPromptSuggestions = document.getElementById('chatPromptSuggestions');

        // Blueprint HUD elements
        const hudDecedentName = document.getElementById('hudDecedentName');
        const hudScheduleDate = document.getElementById('hudScheduleDate');
        const hudLotSelected = document.getElementById('hudLotSelected');
        const hudStatus = document.getElementById('hudStatus');
        const hudSelectedLotCard = document.getElementById('hudSelectedLotCard');
        const hudLotNum = document.getElementById('hudLotNum');
        const hudLotType = document.getElementById('hudLotType');
        const hudLotSection = document.getElementById('hudLotSection');
        const hudLotPrice = document.getElementById('hudLotPrice');
        const hudTotalAmount = document.getElementById('hudTotalAmount');
        const hudSmartTip = document.getElementById('hudSmartTip');
        const blueprintProgressBadge = document.getElementById('blueprintProgressBadge');

        const stepIndicatorDecedent = document.getElementById('stepIndicatorDecedent');
        const stepIndicatorSchedule = document.getElementById('stepIndicatorSchedule');
        const stepIndicatorLot = document.getElementById('stepIndicatorLot');
        const stepIndicatorReview = document.getElementById('stepIndicatorReview');

        let selectedLot = null;
        let confirmationShown = false;
        let confirmationBubble = null;
        let decedents = [];
        let lotTypes = [];
        let sections = [];
        let latestRecommendations = [];
        let latestRecommendationBubble = null;

        function updateBlueprintHUD() {
            const state = chatAssistant ? chatAssistant.state : {};
            const decedent = decedents.find(d => d.decedent_id === state.decedent_id);
            const decedentName = decedent ? `${decedent.first_name} ${decedent.last_name}` : null;

            // 1. Decedent Step
            if (decedentName) {
                hudDecedentName.textContent = decedentName;
                stepIndicatorDecedent.className = 'blueprint-step completed';
            } else {
                hudDecedentName.textContent = 'Pending';
                stepIndicatorDecedent.className = 'blueprint-step active';
            }

            // 2. Schedule Step
            if (state.date) {
                const dateStr = new Date(`${state.date}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
                const timeStr = state.time ? ` (${state.time})` : '';
                hudScheduleDate.textContent = `${dateStr}${timeStr}`;
                stepIndicatorSchedule.className = 'blueprint-step completed';
            } else {
                hudScheduleDate.textContent = 'Pending';
                stepIndicatorSchedule.className = decedentName ? 'blueprint-step active' : 'blueprint-step';
            }

            // 3. Lot Step
            if (selectedLot) {
                hudLotSelected.textContent = `${selectedLot.lot_number} (${selectedLot.lot_type_name || 'Lawn'})`;
                stepIndicatorLot.className = 'blueprint-step completed';

                hudSelectedLotCard.style.display = 'flex';
                hudLotNum.textContent = selectedLot.lot_number;
                hudLotType.textContent = selectedLot.lot_type_name || 'Available Lot';
                hudLotSection.textContent = selectedLot.section_name || 'Standard Section';
                const formattedPrice = `₱${parseFloat(selectedLot.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
                hudLotPrice.textContent = formattedPrice;
                hudTotalAmount.textContent = formattedPrice;
            } else {
                hudLotSelected.textContent = state.lot_type ? `Type: ${state.lot_type}` : 'None selected';
                hudSelectedLotCard.style.display = 'none';
                hudTotalAmount.textContent = '₱0.00';
                stepIndicatorLot.className = (decedentName && state.date) ? 'blueprint-step active' : 'blueprint-step';
            }

            // 4. Review Step
            if (confirmationShown && selectedLot && decedentName && state.date) {
                hudStatus.textContent = 'Ready to Confirm';
                stepIndicatorReview.className = 'blueprint-step active';
                blueprintProgressBadge.textContent = 'Step 4 of 4';
                hudSmartTip.innerHTML = 'Review the booking voucher summary on the left and tap <strong>Confirm & Book</strong> to submit.';
            } else if (selectedLot) {
                blueprintProgressBadge.textContent = 'Step 3 of 4';
                hudStatus.textContent = 'Finalizing Details';
                hudSmartTip.innerHTML = 'Lot selected! Provide any remaining booking date or time details to proceed.';
            } else if (state.lot_type || state.budget) {
                blueprintProgressBadge.textContent = 'Step 2 of 4';
                hudStatus.textContent = 'Lot Matching';
                hudSmartTip.innerHTML = 'Review recommended lots below or tell me if you have a budget adjustment.';
            } else {
                blueprintProgressBadge.textContent = 'Step 1 of 4';
                hudStatus.textContent = 'In Progress';
                hudSmartTip.innerHTML = 'Tell me who this booking is for, preferred date, and budget (e.g. <em>"Juan Cruz, August 28, budget 25k"</em>).';
            }
        }

        function updatePromptSuggestions() {
            if (!chatPromptSuggestions) return;
            const state = chatAssistant ? chatAssistant.state : {};
            chatPromptSuggestions.innerHTML = '';

            const suggestions = [];

            if (state.decedent_id === null && decedents.length > 0) {
                const sampleDecedents = decedents.slice(0, 3);
                sampleDecedents.forEach(d => {
                    suggestions.push({
                        label: `👤 ${d.first_name} ${d.last_name}`,
                        text: `${d.first_name} ${d.last_name}`,
                    });
                });
            } else if (state.lot_type === null) {
                suggestions.push({ label: '✨ Recommend a type for me', text: 'Recommend a type for me' });
                if (lotTypes.length > 0) {
                    lotTypes.slice(0, 3).forEach(t => {
                        suggestions.push({ label: `🏛️ ${t.type_name}`, text: t.type_name });
                    });
                }
                suggestions.push({ label: '⏭️ No preference on type', text: 'no preference' });
            } else if (state.budget === null) {
                suggestions.push({ label: '💰 Budget under ₱20,000', text: '20000' });
                suggestions.push({ label: '💰 Budget under ₱40,000', text: '40000' });
                suggestions.push({ label: '💰 Budget under ₱60,000', text: '60000' });
                suggestions.push({ label: '⏭️ Any budget / No limit', text: 'no preference' });
            } else if (state.date === null) {
                const now = new Date();
                const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
                // Avoid Monday for default prompt
                if (tomorrow.getDay() === 1) tomorrow.setDate(tomorrow.getDate() + 1);
                const dateIso = tomorrow.toISOString().split('T')[0];
                const dateLabel = tomorrow.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                suggestions.push({ label: `📅 ${dateLabel}`, text: dateIso });
                suggestions.push({ label: '🌅 Morning 9:00 AM', text: 'Morning 9:00 AM' });
                suggestions.push({ label: '☀️ Afternoon 2:00 PM', text: 'Afternoon 2:00 PM' });
            }

            if (suggestions.length === 0) {
                suggestions.push({ label: '❓ What documents are required?', text: 'What documents are required for burial?' });
                suggestions.push({ label: '❓ Can we book on weekends?', text: 'Can we schedule burials on weekends?' });
            }

            suggestions.forEach(item => {
                const chip = document.createElement('span');
                chip.className = 'prompt-chip';
                chip.innerHTML = item.label;
                chip.addEventListener('click', () => {
                    if (chatAssistant && !chatInput.disabled) {
                        chatAssistant.processMessage(item.text);
                    }
                });
                chatPromptSuggestions.appendChild(chip);
            });
        }

        function validateBookingDate(dateStr) {
            const todayIso = new Date().toISOString().split('T')[0];
            if (dateStr < todayIso) {
                return { valid: false, reason: 'That date has already passed. Please provide a future burial date.' };
            }
            const selected = new Date(`${dateStr}T00:00:00`);
            if (selected.getDay() === 1) { // 1 = Monday
                return { valid: false, reason: 'Monday burial booking is not permitted due to weekly cemetery maintenance. Please select another day.' };
            }
            return { valid: true };
        }

        async function loadDecedents() {
            try {
                const result = await api.request('decedents', { method: 'GET' });
                decedents = Array.isArray(result) ? result : [];
            } catch (error) {
                console.error('Failed to load decedents', error);
                decedents = [];
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
            } catch (error) {
                console.error('Failed to load lookup data', error);
            }
        }

        function buildRecommendationExplanation(lot, isFallback) {
            if (isFallback) {
                return '<div class="recommendation-reasons-empty">AI recommendations are temporarily unavailable — showing available lots for direct selection.</div>';
            }
            const reasons = Array.isArray(lot.reasons) ? lot.reasons : [];
            if (!reasons.length) {
                return '<div class="recommendation-reasons-empty">Available lot matching general cemetery capacity.</div>';
            }
            return `
                <div class="recommendation-reasons-label"><i class="fas fa-wand-magic-sparkles"></i> Why this is recommended:</div>
                <ul class="recommendation-reasons">${reasons.map(reason => `<li>${reason}</li>`).join('')}</ul>
            `;
        }

        function buildLotCard(lot, isFallback) {
            const hasScore = !isFallback && lot.score !== undefined && lot.score !== null;
            const priceFormatted = `₱${parseFloat(lot.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const scoreHtml = hasScore ? `<span class="score-badge"><i class="fas fa-wand-magic-sparkles"></i> ${lot.score}% Match</span>` : '';
            return `
                <div class="recommendation-card" data-lot-id="${lot.lot_id}">
                    <div>
                        <div class="card-header-badge-row">
                            <div class="lot-num-title"><i class="fas fa-monument"></i> ${lot.lot_number}</div>
                            ${scoreHtml}
                        </div>
                        <div class="card-meta-pills">
                            <span class="meta-pill section"><i class="fas fa-map-pin"></i> ${lot.section_name || 'Standard Section'}</span>
                            <span class="meta-pill"><i class="fas fa-layer-group"></i> ${lot.lot_type_name || 'Lawn Lot'}</span>
                            <span class="meta-pill price">${priceFormatted}</span>
                        </div>
                        <div style="margin-top: 8px;">
                            ${renderStatusBadge(lot)}
                        </div>
                    </div>
                    <div class="recommendation-reasons-box">
                        ${buildRecommendationExplanation(lot, isFallback)}
                    </div>
                    <button class="select-lot-btn" type="button" data-lot='${JSON.stringify(lot)}'>
                        <i class="fas fa-check-circle"></i> Reserve This Lot
                    </button>
                </div>
            `;
        }

        function attachSelectHandlers(bubble) {
            bubble.querySelectorAll('.select-lot-btn').forEach(btn => {
                btn.addEventListener('click', () => {
                    const lot = JSON.parse(btn.getAttribute('data-lot'));
                    selectLot(lot);
                });
            });
        }

        async function showManualLotFallback() {
            try {
                const availableLots = await api.request('lots?status=Available', { method: 'GET' });
                const lots = Array.isArray(availableLots) ? availableLots.slice(0, 10) : [];
                if (lots.length === 0) {
                    chatAssistant.appendMessage('assistant', 'No available lots to display right now. Please check back later.');
                    return;
                }
                const bubble = chatAssistant.appendRichMessage(
                    `<div class="recommendations-grid">${lots.map(lot => buildLotCard(lot, true)).join('')}</div>`
                );
                attachSelectHandlers(bubble);
                latestRecommendations = lots;
                latestRecommendationBubble = bubble;
            } catch (error) {
                console.error('Failed to load available lots for manual browsing', error);
                chatAssistant.appendMessage('assistant', 'Could not load available lots. Please try again later.');
            }
        }

        function invalidateActiveRecommendations() {
            if (latestRecommendationBubble) {
                latestRecommendationBubble.classList.add('recommendations-stale');
                latestRecommendationBubble.querySelectorAll('.select-lot-btn').forEach(btn => { btn.disabled = true; });
            }
            latestRecommendationBubble = null;
            latestRecommendations = [];
        }

        async function fetchAndRenderRecommendations(preferences) {
            invalidateActiveRecommendations();
            try {
                const recommendations = await api.request('schedules/recommend', {
                    method: 'POST',
                    body: preferences
                });

                if (!Array.isArray(recommendations)) {
                    await chatAssistant.appendOutcomeMessage({ status: 'error' });
                    await showManualLotFallback();
                    return;
                }

                const lotCount = recommendations.length;
                await chatAssistant.appendOutcomeMessage(lotCount ? { status: 'success', count: lotCount } : { status: 'empty' });
                if (lotCount === 0) return;

                const bubble = chatAssistant.appendRichMessage(
                    `<div class="recommendations-grid">${recommendations.map(lot => buildLotCard(lot)).join('')}</div>`
                );
                attachSelectHandlers(bubble);
                latestRecommendations = recommendations;
                latestRecommendationBubble = bubble;

                if (chatAssistant.state.date) {
                    await chatAssistant.appendCapacityWarning(chatAssistant.state.date);
                }
            } catch (error) {
                console.error('Recommendation API failed', error);
                await chatAssistant.appendOutcomeMessage({ status: 'error' });
                await showManualLotFallback();
            }
        }

        function selectLot(lot) {
            selectedLot = lot;
            confirmationShown = false;
            if (confirmationBubble) {
                confirmationBubble.remove();
                confirmationBubble = null;
            }
            chatAssistant.appendMessage('user', `Reserve Lot ${lot.lot_number}`);
            updateBlueprintHUD();
            renderConfirmationIfReady();
        }

        function renderConfirmationIfReady() {
            if (!selectedLot || confirmationShown) return;
            const state = chatAssistant.state;
            const decedentMissing = state.decedent_id === null;
            const dateMissing = state.date === null;

            if (decedentMissing && dateMissing) {
                chatAssistant.appendMessage('assistant', `Great choice — Lot ${selectedLot.lot_number}. Before I finalize this reservation, who is this booking for and what is the burial date?`);
                updateBlueprintHUD();
                return;
            }
            if (decedentMissing) {
                chatAssistant.appendMessage('assistant', `Great choice — Lot ${selectedLot.lot_number}. Who is this burial for?`);
                updateBlueprintHUD();
                return;
            }
            if (dateMissing) {
                chatAssistant.appendMessage('assistant', `Great choice — Lot ${selectedLot.lot_number}. What date would you prefer for the burial?`);
                updateBlueprintHUD();
                return;
            }

            confirmationShown = true;
            const decedent = decedents.find(d => d.decedent_id === state.decedent_id);
            const decedentName = decedent ? `${decedent.first_name} ${decedent.last_name}` : 'N/A';
            const priceFormatted = `₱${parseFloat(selectedLot.price || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            const dateFormatted = new Date(`${state.date}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

            const html = `
                <div class="reservation-voucher">
                    <div class="voucher-header">
                        <div class="voucher-title">
                            <i class="fas fa-file-invoice"></i>
                            <span>Official Reservation Summary</span>
                        </div>
                        <span class="voucher-status-pill">Pending Review</span>
                    </div>

                    <div class="voucher-grid">
                        <div class="voucher-item">
                            <span class="voucher-item-label"><i class="fas fa-user"></i> Decedent Name</span>
                            <span class="voucher-item-val">${decedentName}</span>
                        </div>
                        <div class="voucher-item">
                            <span class="voucher-item-label"><i class="fas fa-monument"></i> Allocated Lot</span>
                            <span class="voucher-item-val">${selectedLot.lot_number} (${selectedLot.section_name || 'N/A'})</span>
                        </div>
                        <div class="voucher-item">
                            <span class="voucher-item-label"><i class="fas fa-calendar-alt"></i> Scheduled Date</span>
                            <span class="voucher-item-val">${dateFormatted}</span>
                        </div>
                        <div class="voucher-item">
                            <span class="voucher-item-label"><i class="fas fa-clock"></i> Scheduled Time</span>
                            <span class="voucher-item-val">${state.time ? state.time : 'Standard Schedule'}</span>
                        </div>
                        <div class="voucher-item">
                            <span class="voucher-item-label"><i class="fas fa-layer-group"></i> Lot Type</span>
                            <span class="voucher-item-val">${selectedLot.lot_type_name || 'Standard'}</span>
                        </div>
                        <div class="voucher-item">
                            <span class="voucher-item-label"><i class="fas fa-tag"></i> Estimated Amount</span>
                            <span class="voucher-item-val highlight">${priceFormatted}</span>
                        </div>
                    </div>

                    <div class="voucher-notice">
                        <i class="fas fa-info-circle"></i> This reservation request will be recorded and queued for administration review and lot allotment verification.
                    </div>

                    <button type="button" class="btn-confirm confirm-booking-btn">
                        <i class="fas fa-check-double"></i> Confirm & Submit Reservation
                    </button>
                </div>`;

            const bubble = chatAssistant.appendRichMessage(html);
            confirmationBubble = bubble;
            const confirmBtn = bubble.querySelector('.confirm-booking-btn');
            confirmBtn.addEventListener('click', () => submitBooking(bubble, confirmBtn));
            updateBlueprintHUD();
        }

        async function submitBooking(bubble, confirmBtn) {
            const state = chatAssistant.state;
            await withButtonLoading(confirmBtn, async () => {
                try {
                    const conflict = await api.request(`schedules/check-conflict?lot_id=${selectedLot.lot_id}&date=${state.date}${state.time ? `&time=${encodeURIComponent(state.time)}` : ''}`);
                    if (!conflict.available) {
                        bubble.remove();
                        confirmationBubble = null;
                        chatAssistant.appendMessage('assistant', 'This lot is already booked for the selected date/time. Please choose another lot or a different date.');
                        confirmationShown = false;
                        selectedLot = null;
                        updateBlueprintHUD();
                        return;
                    }
                    const payload = {
                        lot_id: selectedLot.lot_id,
                        deceased_id: state.decedent_id,
                        schedule_date: state.date,
                        schedule_time: state.time || null,
                        status: 'Pending',
                        notes: null
                    };
                    const result = await api.request('schedules', { method: 'POST', body: payload });
                    if (result.success) {
                        const bookedLot = selectedLot;
                        const scheduleId = result.schedule_id;
                        bubble.remove();
                        confirmationBubble = null;
                        chatAssistant.appendMessage('assistant', `🎉 Success! Your reservation for Lot ${bookedLot.lot_number} is confirmed and queued for approval.`);
                        updateBlueprintHUD();
                        onBookingSuccess({ scheduleId, bookedLot });
                    } else {
                        chatAssistant.appendMessage('assistant', result.error || 'Failed to create schedule.');
                    }
                } catch (error) {
                    chatAssistant.appendMessage('assistant', error.message || 'Error creating schedule.');
                }
            });
        }

        async function tryHandleLotSelectionText(text) {
            const intent = parseLotSelectionIntent(text);
            if (!intent) return false;

            chatAssistant.appendMessage('user', text);

            if (!latestRecommendations.length) {
                chatAssistant.appendMessage('assistant', "I don't have any recommendations to choose from right now. Let's find some lots first — what's your budget or preferred lot type?");
                return true;
            }

            const lot = resolveLotFromIntent(intent, latestRecommendations);
            if (!lot) {
                chatAssistant.appendMessage('assistant', 'I couldn\'t match that to one of the options currently shown. Try "the first one", "the cheapest one", or a lot number like "A-102".');
                return true;
            }

            selectLot(lot);
            return true;
        }

        const chatAssistant = createLotChatAssistant({
            chatWindow, chatForm, chatInput, chatSuggestTypeBtn, chatPrefStatus,
            getLotTypes: () => lotTypes,
            getSections: () => sections,
            getDecedents: () => decedents,
            validateDate: validateBookingDate,
            interceptMessage: tryHandleLotSelectionText,
            onLotPreferencesReady: () => {
                fetchAndRenderRecommendations(chatAssistant.getPreferences());
                updateBlueprintHUD();
                updatePromptSuggestions();
            },
            onPreferencesCorrected: async () => {
                await fetchAndRenderRecommendations(chatAssistant.getPreferences());
                updateBlueprintHUD();
                updatePromptSuggestions();
            },
            onBookingDetailsCorrected: () => {
                if (confirmationBubble) {
                    confirmationBubble.remove();
                    confirmationBubble = null;
                    confirmationShown = false;
                    chatAssistant.appendMessage('assistant', "Since your details changed, here's the updated summary once everything is set.");
                }
                updateBlueprintHUD();
                if (selectedLot) renderConfirmationIfReady();
                updatePromptSuggestions();
            },
            onStateChanged: () => {
                updateBlueprintHUD();
                updatePromptSuggestions();
                if (selectedLot && !confirmationShown) renderConfirmationIfReady();
            },
            onReset: () => {
                selectedLot = null;
                confirmationShown = false;
                confirmationBubble = null;
                latestRecommendations = [];
                latestRecommendationBubble = null;
                updateBlueprintHUD();
                updatePromptSuggestions();
            },
        });

        if (chatSuggestTypeBtn) {
            chatSuggestTypeBtn.addEventListener('click', async function() {
                await withButtonLoading(chatSuggestTypeBtn, async () => {
                    await chatAssistant.requestTypeSuggestion();
                });
            });
        }

        if (chatStartOverBtn) {
            chatStartOverBtn.addEventListener('click', function() {
                if (confirm('Start over? This will clear the current conversation and any selections.')) {
                    chatAssistant.reset();
                }
            });
        }

        await Promise.all([loadDecedents(), loadLookupData()]);
        chatAssistant.init();
        updateBlueprintHUD();
        updatePromptSuggestions();

        const urlParams = new URLSearchParams(window.location.search);
        const urlLotId = urlParams.get('lot_id');
        if (urlLotId) {
            try {
                const lot = await api.request(`lots/${urlLotId}`);
                if (lot && !lot.error) {
                    selectedLot = lot;
                    chatAssistant.appendMessage('assistant', `I've pre-selected Lot ${lot.lot_number} for you from Lot Management. Let's get the rest sorted — who is this booking for, and what burial date would you like?`);
                    updateBlueprintHUD();
                    renderConfirmationIfReady();
                }
            } catch (err) {
                console.error('Failed to pre-fetch lot from URL', err);
            }
        }
    }

    return { init };
}
