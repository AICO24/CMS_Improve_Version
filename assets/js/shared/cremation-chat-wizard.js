// Cremation module audit, Batch K: lightweight conversational booking flow
// for reserve-cremation.html, mirroring booking-wizard.js's "Live Booking
// Blueprint" visual pattern (two-column chat + live HUD side panel) —
// deliberately NOT a port of booking-wizard.js/lot-chat-assistant.js's
// lot-recommendation NLU engine. Cremation has no scarce/exclusive resource
// to match/rank at booking time (no lot to pick, no conflict to check, the
// niche is auto-assigned later at completion — see reserve-cremation.js's
// own longstanding comment), so this is a scripted, form-driven 3-step
// sequence (Decedent -> Preferences -> Review & Confirm) presented as a
// chat, not a free-text NLU engine pretending to understand anything typed
// at it. A citizen never browses or matches against existing decedent
// records here either (privacy audit, Batch I) — always fresh entry.
function renderCremationChatMarkup({ mount }) {
    mount.innerHTML = `
        <div class="ai-chat-layout">
            <div class="ai-chat-main">
                <div class="cremation-wizard-header">
                    <div class="ai-assistant-brand">
                        <div class="ai-avatar-badge">
                            <div class="ai-avatar-glow"></div>
                            <i class="fas fa-fire"></i>
                        </div>
                        <div class="ai-assistant-meta">
                            <div class="ai-title-row">
                                <h4 class="ai-assistant-name">Cremation Booking Assistant</h4>
                                <span class="ai-status-pill"><span class="status-pulse-dot"></span> Online</span>
                            </div>
                            <p class="ai-assistant-desc">Guided intake — who it's for, your preferences, then review</p>
                        </div>
                    </div>
                    <div class="ai-header-actions">
                        <button type="button" id="cremationChatResetBtn" class="ai-action-btn" title="Clear and start over">
                            <i class="fas fa-rotate-right"></i> <span>Reset</span>
                        </button>
                    </div>
                </div>

                <div class="chat-window" id="cremationChatWindow" aria-live="polite"></div>
            </div>

            <aside class="ai-booking-blueprint" id="cremationBlueprint">
                <div class="blueprint-header">
                    <div class="blueprint-title">
                        <i class="fas fa-clipboard-check"></i>
                        <span>Live Booking Blueprint</span>
                    </div>
                    <span class="blueprint-badge" id="cremationBlueprintBadge">Step 1 of 3</span>
                </div>

                <div class="blueprint-body">
                    <div class="blueprint-steps">
                        <div class="blueprint-step active" id="cremationStepDecedent" data-step="1">
                            <div class="step-num"><i class="fas fa-user"></i></div>
                            <div class="step-content">
                                <span class="step-label">1. Decedent Record</span>
                                <strong class="step-value" id="cremationHudDecedentName">Pending</strong>
                            </div>
                        </div>
                        <div class="blueprint-step" id="cremationStepPreferences" data-step="2">
                            <div class="step-num"><i class="fas fa-sliders"></i></div>
                            <div class="step-content">
                                <span class="step-label">2. Preferences</span>
                                <strong class="step-value" id="cremationHudPreferences">Pending</strong>
                            </div>
                        </div>
                        <div class="blueprint-step" id="cremationStepReview" data-step="3">
                            <div class="step-num"><i class="fas fa-check-double"></i></div>
                            <div class="step-content">
                                <span class="step-label">3. Review &amp; Confirm</span>
                                <strong class="step-value" id="cremationHudStatus">In Progress</strong>
                            </div>
                        </div>
                    </div>

                    <div class="blueprint-ai-tips">
                        <div class="tip-header"><i class="fas fa-lightbulb"></i> <span>Smart Tip</span></div>
                        <p class="tip-text" id="cremationHudTip">Your request starts as Pending — submit payment afterward and it confirms automatically once verified. The specific niche is assigned once the cremation is completed.</p>
                    </div>
                </div>
            </aside>
        </div>
    `;
}

function createCremationChatWizard(options = {}) {
    const { onBookingSuccess } = options;

    const state = {
        provisional_decedent: null,
        provisional_decedent_attachment_file: null,
        preferred_columbarium: null,
        cremation_date: null,
        notes: null,
    };

    let chatWindow;
    let hudDecedentName;
    let hudPreferences;
    let hudStatus;
    let blueprintBadge;
    let stepDecedentEl;
    let stepPreferencesEl;
    let stepReviewEl;
    let columbariums = [];

    function isRateLimitError(error) {
        return Boolean(error) && error.status === 429;
    }

    let rateLimitNoticeShownAt = 0;
    function noticeRateLimited() {
        const now = Date.now();
        if (now - rateLimitNoticeShownAt < 4000) return;
        rateLimitNoticeShownAt = now;
        appendMessage('assistant', "You're sending requests a bit too fast — please wait a moment before trying again.");
    }

    function appendMessage(role, text) {
        const bubble = document.createElement('div');
        bubble.className = `chat-message ${role}`;
        bubble.textContent = text;
        chatWindow.appendChild(bubble);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return bubble;
    }

    function appendRichMessage(html) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-message assistant chat-message--rich';
        bubble.innerHTML = html;
        chatWindow.appendChild(bubble);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return bubble;
    }

    function updateHUD() {
        const decedentName = state.provisional_decedent ? `${state.provisional_decedent.full_name} (Unregistered)` : null;
        if (decedentName) {
            hudDecedentName.textContent = decedentName;
            stepDecedentEl.className = 'blueprint-step completed';
        } else {
            hudDecedentName.textContent = 'Pending';
            stepDecedentEl.className = 'blueprint-step active';
        }

        const prefsSet = state.preferred_columbarium || state.cremation_date;
        if (prefsSet) {
            const parts = [];
            if (state.preferred_columbarium) parts.push(state.preferred_columbarium);
            if (state.cremation_date) parts.push(state.cremation_date);
            hudPreferences.textContent = parts.join(' · ');
            stepPreferencesEl.className = 'blueprint-step completed';
        } else if (decedentName) {
            hudPreferences.textContent = 'No preference set';
            stepPreferencesEl.className = 'blueprint-step active';
        } else {
            hudPreferences.textContent = 'Pending';
            stepPreferencesEl.className = 'blueprint-step';
        }

        if (currentStep === 3) {
            blueprintBadge.textContent = 'Step 3 of 3';
            stepReviewEl.className = 'blueprint-step active';
            hudStatus.textContent = 'Ready to submit';
        } else if (currentStep === 2) {
            blueprintBadge.textContent = 'Step 2 of 3';
            hudStatus.textContent = 'In Progress';
        } else {
            blueprintBadge.textContent = 'Step 1 of 3';
            hudStatus.textContent = 'In Progress';
        }
    }

    let currentStep = 1;

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

    // Step 1: who this is for. Always a fresh, provisional entry — never a
    // pick-from-existing-records list (see this file's header comment).
    // Markup/AI-assist behavior mirrors lot-chat-assistant.js's
    // appendDecedentRequestForm() exactly, just wired to this wizard's own
    // state instead of booking-wizard.js's.
    function renderDecedentStep() {
        const bubble = appendRichMessage(`
            <div class="chat-decedent-request">
                <label>Who is this cremation for?</label>
                <input type="file" class="chat-request-certfile" accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf">
                <button type="button" class="chat-request-extract-btn chat-request-cert-extract-btn">Extract from Certificate</button>
                <p class="chat-request-cert-hint">Optional — speeds up processing. You'll still need to bring the original on the day of service.</p>
                <textarea class="chat-request-freetext" placeholder="Or describe them in your own words, e.g. &quot;my father Juan dela Cruz, passed away last March 3, 2020&quot;" rows="2"></textarea>
                <button type="button" class="chat-request-extract-btn">Fill in from description</button>
                <input type="text" class="chat-request-name" placeholder="Full name" required>
                <input type="date" class="chat-request-dod" max="${new Date().toISOString().split('T')[0]}">
                <input type="text" class="chat-request-relationship" placeholder="Your relationship to the deceased (optional)">
                <button type="button" class="btn-secondary chat-request-btn">Continue</button>
            </div>
        `);
        const certFileInput = bubble.querySelector('.chat-request-certfile');
        const certExtractBtn = bubble.querySelector('.chat-request-cert-extract-btn');
        const freetextInput = bubble.querySelector('.chat-request-freetext');
        const extractBtn = bubble.querySelector('.chat-request-extract-btn');
        const nameInput = bubble.querySelector('.chat-request-name');
        const dodInput = bubble.querySelector('.chat-request-dod');
        const relationshipInput = bubble.querySelector('.chat-request-relationship');
        const continueBtn = bubble.querySelector('.chat-request-btn');

        certExtractBtn.addEventListener('click', async () => {
            const file = certFileInput.files[0];
            if (!file) return;

            certExtractBtn.disabled = true;
            const originalLabel = certExtractBtn.textContent;
            certExtractBtn.textContent = 'Reading...';

            try {
                const imageBase64 = await readFileAsBase64(file);
                const response = await api.request('ai/extract-certificate', {
                    method: 'POST',
                    body: { image_base64: imageBase64, mime_type: file.type },
                });
                const result = response && response.result;

                if (result && (result.first_name || result.last_name)) {
                    const fullName = [result.first_name, result.middle_name, result.last_name, result.suffix].filter(Boolean).join(' ');
                    if (fullName) nameInput.value = fullName;
                    if (result.dod) dodInput.value = result.dod;
                } else {
                    appendMessage('assistant', "I couldn't quite read that document — please fill in the fields below directly.");
                }
            } catch (error) {
                if (isRateLimitError(error)) {
                    noticeRateLimited();
                } else {
                    console.error('Certificate extraction failed', error);
                    appendMessage('assistant', "I couldn't quite read that document — please fill in the fields below directly.");
                }
            } finally {
                certExtractBtn.disabled = false;
                certExtractBtn.textContent = originalLabel;
            }
        });

        extractBtn.addEventListener('click', async () => {
            const text = freetextInput.value.trim();
            if (!text) return;

            extractBtn.disabled = true;
            const originalLabel = extractBtn.textContent;
            extractBtn.textContent = 'Reading...';

            try {
                const response = await api.request('ai/extract-decedent-request', {
                    method: 'POST',
                    body: { message: text },
                });
                const result = response && response.result;

                if (result && typeof result === 'object' && result.full_name) {
                    nameInput.value = result.full_name;
                    if (result.approximate_dod) dodInput.value = result.approximate_dod;
                    if (result.relationship) relationshipInput.value = result.relationship;
                } else {
                    appendMessage('assistant', "I couldn't quite make out who this is about — please fill in the fields below directly.");
                }
            } catch (error) {
                if (isRateLimitError(error)) {
                    noticeRateLimited();
                } else {
                    console.error('Decedent extraction failed', error);
                    appendMessage('assistant', "I couldn't quite make out who this is about — please fill in the fields below directly.");
                }
            } finally {
                extractBtn.disabled = false;
                extractBtn.textContent = originalLabel;
            }
        });

        continueBtn.addEventListener('click', () => {
            const fullName = nameInput.value.trim();
            if (!fullName) {
                nameInput.focus();
                return;
            }
            state.provisional_decedent = {
                full_name: fullName,
                approximate_dod: dodInput.value || null,
                relationship: relationshipInput.value.trim() || null,
            };
            state.provisional_decedent_attachment_file = certFileInput.files[0] || null;
            bubble.remove();
            appendMessage('assistant', `Got it — I'll book this for ${fullName}. Our staff will register their official record before the cremation takes place.`);
            currentStep = 2;
            updateHUD();
            renderPreferencesStep();
        });
    }

    // Step 2: optional preferences. Nothing here is required — a citizen can
    // continue with everything blank.
    function renderPreferencesStep() {
        const columbariumOptions = columbariums.map((c) => `<option value="${c}">${c}</option>`).join('');
        const bubble = appendRichMessage(`
            <div class="chat-decedent-request">
                <label>Any preferences? Everything below is optional.</label>
                <select class="chat-pref-columbarium">
                    <option value="">No preference on columbarium</option>
                    ${columbariumOptions}
                </select>
                <input type="date" class="chat-pref-date" min="${new Date().toISOString().split('T')[0]}">
                <textarea class="chat-pref-notes" placeholder="Notes (optional)" rows="2"></textarea>
                <button type="button" class="btn-secondary chat-request-btn">Continue</button>
            </div>
        `);
        const columbariumSelect = bubble.querySelector('.chat-pref-columbarium');
        const dateInput = bubble.querySelector('.chat-pref-date');
        const notesInput = bubble.querySelector('.chat-pref-notes');
        const continueBtn = bubble.querySelector('.chat-request-btn');

        continueBtn.addEventListener('click', () => {
            state.preferred_columbarium = columbariumSelect.value || null;
            state.cremation_date = dateInput.value || null;
            state.notes = notesInput.value.trim() || null;
            bubble.remove();
            const prefSummary = state.preferred_columbarium || state.cremation_date
                ? `Noted — ${[state.preferred_columbarium, state.cremation_date].filter(Boolean).join(', ')}.`
                : "No preference noted — that's okay, we'll work with what's available.";
            appendMessage('assistant', prefSummary);
            currentStep = 3;
            updateHUD();
            renderReviewStep();
        });
    }

    // Step 3: review everything and submit — the exact same payload shape
    // reserve-cremation.js's plain-form version always used.
    function renderReviewStep() {
        const decedentName = state.provisional_decedent ? state.provisional_decedent.full_name : 'N/A';
        const bubble = appendRichMessage(`
            <div class="reservation-voucher">
                <div class="voucher-header">
                    <div class="voucher-title">
                        <i class="fas fa-file-invoice"></i>
                        <span>Cremation Request Summary</span>
                    </div>
                    <span class="voucher-status-pill">Pending Review</span>
                </div>

                <div class="voucher-grid">
                    <div class="voucher-item">
                        <span class="voucher-item-label"><i class="fas fa-user"></i> Decedent</span>
                        <span class="voucher-item-val">${decedentName}</span>
                    </div>
                    <div class="voucher-item">
                        <span class="voucher-item-label"><i class="fas fa-building"></i> Columbarium</span>
                        <span class="voucher-item-val">${state.preferred_columbarium || 'No preference'}</span>
                    </div>
                    <div class="voucher-item">
                        <span class="voucher-item-label"><i class="fas fa-calendar-day"></i> Preferred Date</span>
                        <span class="voucher-item-val">${state.cremation_date || 'No preference'}</span>
                    </div>
                    <div class="voucher-item">
                        <span class="voucher-item-label"><i class="fas fa-note-sticky"></i> Notes</span>
                        <span class="voucher-item-val">${state.notes || 'None'}</span>
                    </div>
                </div>

                <div class="voucher-notice">
                    <i class="fas fa-info-circle"></i> This request starts as Pending — submit payment afterward and it confirms automatically once verified.
                </div>
                <div class="voucher-notice">
                    <i class="fas fa-user-clock"></i> ${decedentName} isn't in our records yet — your request still goes through, and our staff will add their official record before the cremation takes place.
                </div>

                <button type="button" class="btn-confirm confirm-cremation-btn">
                    <i class="fas fa-check-double"></i> Confirm &amp; Submit Request
                </button>
            </div>
        `);
        const submitBtn = bubble.querySelector('.confirm-cremation-btn');

        submitBtn.addEventListener('click', async () => {
            await withButtonLoading(submitBtn, async () => {
                const payload = {
                    preferred_columbarium: state.preferred_columbarium,
                    cremation_date: state.cremation_date,
                    notes: state.notes,
                    provisional_decedent: state.provisional_decedent,
                };

                try {
                    const result = await api.request('cremations', { method: 'POST', body: payload });
                    if (result.success) {
                        hudStatus.textContent = 'Submitted';
                        // Removed rather than left clickable — prevents a second
                        // click from submitting a duplicate request once this
                        // one already succeeded.
                        bubble.remove();
                        appendMessage('assistant', 'Your cremation request has been submitted and is Pending payment/confirmation.');
                        if (typeof onBookingSuccess === 'function') {
                            onBookingSuccess({ cremationId: result.cremation_id });
                        }
                    } else {
                        appendMessage('assistant', result.error || 'Failed to submit cremation request.');
                    }
                } catch (error) {
                    if (isRateLimitError(error)) {
                        noticeRateLimited();
                    } else {
                        appendMessage('assistant', error.message || 'Failed to submit cremation request.');
                    }
                }
            });
        });
    }

    function resetWizard() {
        state.provisional_decedent = null;
        state.provisional_decedent_attachment_file = null;
        state.preferred_columbarium = null;
        state.cremation_date = null;
        state.notes = null;
        currentStep = 1;
        chatWindow.innerHTML = '';
        updateHUD();
        appendMessage('assistant', "Hi! I'm here to help you book a cremation. Let's start with who this is for.");
        renderDecedentStep();
    }

    async function loadColumbariums() {
        try {
            const result = await api.request('cremations/columbariums', { method: 'GET' });
            columbariums = Array.isArray(result) ? result : [];
        } catch (error) {
            console.error('Failed to load columbariums', error);
            columbariums = [];
        }
    }

    async function init() {
        const user = await requireRole(['user']);
        if (!user) return;

        renderCremationChatMarkup({ mount: document.getElementById('cremationWizardMount') });

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

        chatWindow = document.getElementById('cremationChatWindow');
        hudDecedentName = document.getElementById('cremationHudDecedentName');
        hudPreferences = document.getElementById('cremationHudPreferences');
        hudStatus = document.getElementById('cremationHudStatus');
        blueprintBadge = document.getElementById('cremationBlueprintBadge');
        stepDecedentEl = document.getElementById('cremationStepDecedent');
        stepPreferencesEl = document.getElementById('cremationStepPreferences');
        stepReviewEl = document.getElementById('cremationStepReview');

        document.getElementById('cremationChatResetBtn').addEventListener('click', resetWizard);

        await loadColumbariums();
        updateHUD();
        appendMessage('assistant', "Hi! I'm here to help you book a cremation. Let's start with who this is for.");
        renderDecedentStep();
    }

    return { init };
}
