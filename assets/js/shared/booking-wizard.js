// Shared burial-lot booking assistant.
// Batch N (adviser feedback 2026-08-18, "make burial scheduling fully
// chat-based, like ChatGPT"): this used to be a 3-step wizard (Booking
// Details form -> AI Recommendations grid -> Confirmation page) with a
// small floating chat widget alongside it. It is now a single full-page
// chat interface — the assistant (assets/js/shared/lot-chat-assistant.js)
// drives the ENTIRE flow: it collects decedent/date/time/lot preferences
// conversationally, automatically fetches and renders recommendation cards
// as a message the moment lot_type+budget are known (no button needed),
// and renders the final booking confirmation + "Confirm & Book" action as
// a message too, once a lot is picked and decedent/date are known. Nothing
// about the underlying booking flow changed — same endpoints, same
// conflict/Monday/past-date checks, same RBAC — only the presentation
// layer moved from a stepper+form into the chat thread. Load this after
// shared/api.js, shared/button-loading.js, and shared/lot-chat-assistant.js,
// and before a page's own thin wrapper script.
//
// createBookingWizard(options) -> wizard
//   options.allowedRoles: string[] passed straight to requireRole().
//   options.renderStatusBadge(lot): string — HTML for a recommendation
//     card's status line; the two pages have always styled this
//     differently (admin/staff: `.status-badge.status-success`; citizen:
//     `.muted`), preserved here since that's a visual choice outside this
//     redesign's scope.
//   options.onBookingSuccess({ scheduleId, bookedLot }): called once the
//     booking has been created — admin/staff shows a plain confirmation
//     alert; citizen offers to jump straight to payment.
//
// wizard.init(): runs the page's full DOMContentLoaded sequence (role
//   check, wiring, initial data load). Call this from the page's own
//   DOMContentLoaded listener.
//
// Deliberately dropped in this redesign (disclosed, not silent):
//   - The "Additional Requirements" free-text notes field from the old
//     Booking Details form. It was optional and low-stakes; there's no
//     clean slot-filling equivalent for open-ended free text without
//     adding another required conversational turn. Booking payloads now
//     always send notes: null. Can be re-added later as an explicit
//     "anything else?" question if wanted.
//   - Staff's manual Section/Lot Type/Budget/Lot Number filters (already
//     retired for citizens in an earlier batch, now retired for staff too)
//     — superseded by the escape hatches in lot-chat-assistant.js
//     (decedent/date) and the existing "Recommend a type for me"/"no
//     preference" outs (lot_type/budget/section). A staff member who wants
//     a SPECIFIC known lot can still reach it via Lot Management's
//     "Book This Lot" action, which pre-selects the lot through the
//     existing ?lot_id= URL parameter (unchanged, see the end of init()).

function renderChatPageMarkup({ mount }) {
    mount.innerHTML = `
        <div class="ai-chat-page">
            <div class="chat-window" id="chatWindow" aria-live="polite"></div>
            <div class="chat-pref-status" id="chatPrefStatus">
                <span class="chat-pref-chip" data-field="decedent_id">Decedent: <strong>Not set</strong></span>
                <span class="chat-pref-chip" data-field="date">Date: <strong>Not set</strong></span>
                <span class="chat-pref-chip" data-field="lot_type">Lot type: <strong>Not set</strong></span>
                <span class="chat-pref-chip" data-field="budget">Budget: <strong>Not set</strong></span>
                <span class="chat-pref-chip" data-field="section">Section: <strong>Not set</strong></span>
            </div>
            <form id="chatForm" class="chat-input-row">
                <input type="text" id="chatInput" placeholder="Type a message..." autocomplete="off" disabled>
                <button type="submit" class="chat-send-btn" aria-label="Send" disabled><i class="fas fa-paper-plane"></i></button>
            </form>
            <div class="chat-actions">
                <button type="button" id="chatSuggestTypeBtn" class="btn-next">Recommend a type for me</button>
            </div>
        </div>`;
}

function createBookingWizard(options) {
    const { allowedRoles, renderStatusBadge, onBookingSuccess } = options;

    async function init() {
        const user = await requireRole(allowedRoles);
        if (!user) return;

        renderChatPageMarkup({ mount: document.getElementById('wizardContainerMount') });

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

        const chatWindow = document.getElementById('chatWindow');
        const chatForm = document.getElementById('chatForm');
        const chatInput = document.getElementById('chatInput');
        const chatSuggestTypeBtn = document.getElementById('chatSuggestTypeBtn');
        const chatPrefStatus = document.getElementById('chatPrefStatus');

        let selectedLot = null;
        let confirmationShown = false;
        let decedents = [];
        let lotTypes = [];
        let sections = [];

        // Same past-date/Monday-block rule everywhere a date can be set —
        // chat text extraction and the escape hatch both funnel through
        // this, so they can never disagree or be bypassed.
        function validateBookingDate(dateStr) {
            const todayIso = new Date().toISOString().split('T')[0];
            if (dateStr < todayIso) {
                return { valid: false, reason: 'That date has already passed. Could you give me a future date?' };
            }
            const selected = new Date(`${dateStr}T00:00:00`);
            if (selected.getDay() === 1) { // 1 = Monday
                return { valid: false, reason: 'Monday booking is not allowed. Please select another day of the week.' };
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

        // Phase 3: purely presentational — renders whatever reasons[] the
        // existing recommendation engine already returned. Never invents a
        // reason and never touches score/ranking/ordering.
        function buildRecommendationExplanation(lot, isFallback) {
            if (isFallback) {
                return '<div class="recommendation-reasons-empty">AI recommendations are temporarily unavailable — shown for manual browsing.</div>';
            }
            const reasons = Array.isArray(lot.reasons) ? lot.reasons : [];
            if (!reasons.length) {
                return '<div class="recommendation-reasons-empty">No specific preferences were matched — shown as an available lot.</div>';
            }
            return `
                <div class="recommendation-reasons-label">Why this is recommended:</div>
                <ul class="recommendation-reasons">${reasons.map(reason => `<li>${reason}</li>`).join('')}</ul>
            `;
        }

        function buildLotCard(lot, isFallback) {
            const hasScore = !isFallback && lot.score !== undefined && lot.score !== null;
            return `
                <div class="recommendation-card" data-lot-id="${lot.lot_id}">
                    <div>
                        <strong>${lot.lot_number} — ${lot.section_name || 'N/A'}</strong><br>
                        <span class="lot-type-tag">${lot.lot_type_name || 'N/A'}</span> | ₱${parseFloat(lot.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}<br>
                        ${renderStatusBadge(lot)}
                    </div>
                    <div class="recommendation-actions">
                        ${hasScore ? `<div class="score">${lot.score || 0}% suitability</div>` : ''}
                        ${buildRecommendationExplanation(lot, isFallback)}
                        <button class="select-lot-btn" type="button" data-lot='${JSON.stringify(lot)}'>Reserve</button>
                    </div>
                </div>
            `;
        }

        // Scoped to the specific rich-message bubble that was just rendered
        // — earlier recommendation messages stay visible in the thread as
        // history, so a global querySelectorAll here would re-wire (and
        // eventually double-fire) listeners on old cards too.
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
                    chatAssistant.appendMessage('assistant', 'No available lots to display right now. Please try again later.');
                    return;
                }
                const bubble = chatAssistant.appendRichMessage(
                    `<div class="recommendations-grid">${lots.map(lot => buildLotCard(lot, true)).join('')}</div>`
                );
                attachSelectHandlers(bubble);
            } catch (error) {
                console.error('Failed to load available lots for manual browsing', error);
                chatAssistant.appendMessage('assistant', 'Could not load available lots. Please try again later.');
            }
        }

        // Batch N: called automatically the moment lot_type+budget are
        // known (see onLotPreferencesReady below) — no button click
        // required. Renders the outcome as a message, then the cards
        // themselves as the next message, matching how a human assistant
        // would say "I found N options" before listing them.
        async function fetchAndRenderRecommendations(preferences) {
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
            chatAssistant.appendMessage('user', `Reserve Lot ${lot.lot_number}`);
            renderConfirmationIfReady();
        }

        // The single place that decides "do we have everything needed to
        // finalize a booking yet?" — called right after a lot is picked,
        // and again via onStateChanged whenever decedent/date resolve
        // afterward (chat, or the escape hatch), so the confirmation
        // appears automatically the moment the last piece falls into place
        // regardless of which order the user provided things in.
        function renderConfirmationIfReady() {
            if (!selectedLot || confirmationShown) return;
            const state = chatAssistant.state;
            const missing = [];
            if (state.decedent_id === null) missing.push('who this booking is for');
            if (state.date === null) missing.push('the burial date');
            if (missing.length) {
                chatAssistant.appendMessage('assistant', `Great choice — Lot ${selectedLot.lot_number}. Before I can finalize this booking, I still need ${missing.join(' and ')}.`);
                return;
            }

            confirmationShown = true;
            const decedent = decedents.find(d => d.decedent_id === state.decedent_id);
            const decedentName = decedent ? `${decedent.first_name} ${decedent.last_name}` : 'N/A';
            const html = `
                <div class="confirmation-box">
                    <p><strong>Lot:</strong> ${selectedLot.lot_number} (${selectedLot.section_name || 'N/A'})</p>
                    <p><strong>Type:</strong> ${selectedLot.lot_type_name || 'N/A'}</p>
                    <p><strong>Price:</strong> ₱${parseFloat(selectedLot.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p><strong>Burial Date:</strong> ${state.date}</p>
                    <p><strong>Burial Time:</strong> ${state.time || 'Not specified'}</p>
                    <p><strong>Decedent:</strong> ${decedentName}</p>
                    <p class="muted">This reservation will remain pending until an administrator or staff member reviews and approves it.</p>
                    <div class="form-actions">
                        <button type="button" class="btn-confirm confirm-booking-btn">Confirm & Book</button>
                    </div>
                </div>`;
            const bubble = chatAssistant.appendRichMessage(html);
            const confirmBtn = bubble.querySelector('.confirm-booking-btn');
            confirmBtn.addEventListener('click', () => submitBooking(bubble, confirmBtn));
        }

        async function submitBooking(bubble, confirmBtn) {
            const state = chatAssistant.state;
            await withButtonLoading(confirmBtn, async () => {
                try {
                    const conflict = await api.request(`schedules/check-conflict?lot_id=${selectedLot.lot_id}&date=${state.date}${state.time ? `&time=${encodeURIComponent(state.time)}` : ''}`);
                    if (!conflict.available) {
                        chatAssistant.appendMessage('assistant', 'This lot is already booked for the selected date/time. Please choose another lot or a different date.');
                        confirmationShown = false;
                        selectedLot = null;
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
                        chatAssistant.appendMessage('assistant', `Your reservation for Lot ${bookedLot.lot_number} is confirmed and pending approval.`);
                        onBookingSuccess({ scheduleId, bookedLot });
                    } else {
                        chatAssistant.appendMessage('assistant', result.error || 'Failed to create schedule.');
                    }
                } catch (error) {
                    chatAssistant.appendMessage('assistant', error.message || 'Error creating schedule.');
                }
            });
        }

        const chatAssistant = createLotChatAssistant({
            chatWindow, chatForm, chatInput, chatSuggestTypeBtn, chatPrefStatus,
            getLotTypes: () => lotTypes,
            getSections: () => sections,
            getDecedents: () => decedents,
            validateDate: validateBookingDate,
            onLotPreferencesReady: () => {
                fetchAndRenderRecommendations(chatAssistant.getPreferences());
            },
            onStateChanged: () => {
                if (selectedLot && !confirmationShown) renderConfirmationIfReady();
            },
        });

        if (chatSuggestTypeBtn) {
            chatSuggestTypeBtn.addEventListener('click', async function() {
                await withButtonLoading(chatSuggestTypeBtn, async () => {
                    await chatAssistant.requestTypeSuggestion();
                });
            });
        }

        await Promise.all([loadDecedents(), loadLookupData()]);
        chatAssistant.init();

        // Lot Management's "Book This Lot" action links here with ?lot_id=
        // — pre-select that lot and let the chat collect whatever's still
        // missing (decedent/date), same as picking a lot from chat results.
        const urlParams = new URLSearchParams(window.location.search);
        const urlLotId = urlParams.get('lot_id');
        if (urlLotId) {
            try {
                const lot = await api.request(`lots/${urlLotId}`);
                if (lot && !lot.error) {
                    selectedLot = lot;
                    chatAssistant.appendMessage('assistant', `I've pre-selected Lot ${lot.lot_number} for you from Lot Management. Let's get the rest sorted — who is this booking for, and what burial date would you like?`);
                    renderConfirmationIfReady();
                }
            } catch (err) {
                console.error('Failed to pre-fetch lot from URL', err);
            }
        }
    }

    return { init };
}
