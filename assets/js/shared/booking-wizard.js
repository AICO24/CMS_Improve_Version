// Shared burial-lot booking wizard (Batch M5).
// Extracted from burial-scheduling.js (admin/staff) and reserve-burial-slot.js
// (citizen), which the Batch M audit found to be ~97% byte-identical: same
// 3-step wizard, same recommendation-card rendering, same chat integration,
// same booking submission — differing only in which roles may open the
// page, a recommendation card's status-badge markup, and what happens right
// after a successful booking. Both pages now call this factory with those
// three differences as options instead of maintaining two forks that can
// silently drift apart when one gets fixed and the other doesn't.
// Load this after shared/api.js, shared/button-loading.js, and
// shared/lot-chat-assistant.js, and before a page's own thin wrapper script.
//
// createBookingWizard(options) -> wizard
//   options.allowedRoles: string[] passed straight to requireRole().
//   options.renderStatusBadge(lot): string — HTML for a recommendation
//     card's status line; the two pages have always styled this
//     differently (admin/staff: `.status-badge.status-success`; citizen:
//     `.muted`), preserved here rather than unified since that's a visual
//     choice outside this refactor's scope.
//   options.onBookingSuccess({ scheduleId, bookedLot }): called once the
//     booking has been created AND the form/step have already been reset —
//     admin/staff shows a plain confirmation alert; citizen offers to jump
//     straight to payment.
//   options.showLotNumberField: bool — the one remaining real content
//     difference between the two pages' markup (see renderWizardMarkup()
//     below). Staff/admin still search by lot number; citizens don't know
//     lot numbers, so that field is omitted for them (Batch M9 / A.4).
//
// wizard.init(): runs the page's full DOMContentLoaded sequence (role
//   check, wiring, initial data load). Call this from the page's own
//   DOMContentLoaded listener.

// Batch M9 (B.7): the wizard-container + floating chat-widget markup was
// ~97% byte-identical HTML duplicated across burial-scheduling.html and
// reserve-burial-slot.html — the same class of duplication M5 already fixed
// for this file's JS. Built here once instead, and injected into two empty
// mount points each page now provides (#wizardContainerMount,
// #aiChatWidgetMount) before init() looks up any of its child elements.
// showLotNumberField is the one genuine content difference left; everything
// else in these two blocks was byte-identical between the two pages.
function renderWizardMarkup({ wizardMount, chatWidgetMount, showLotNumberField, showManualFilters }) {
    const lotNumberField = showLotNumberField ? `
                                <div class="form-group">
                                    <label>Lot Number</label>
                                    <input type="text" id="prefLotNumber" placeholder="Search by lot number">
                                </div>` : '';

    // Adviser feedback (2026-08-18): a citizen booking shouldn't have to
    // know/pick cemetery sections, lot types, or budget ranges directly —
    // that's exactly what the chat assistant (AI type + lot recommendation)
    // is for. Staff/admin keep the manual fallback since they may need to
    // place a specific family in a specific section for operational reasons.
    const manualFiltersBlock = showManualFilters ? `
                        <details class="form-card manual-filters-disclosure">
                            <summary><i class="fas fa-sliders-h"></i> Prefer to search manually?</summary>
                            <form id="preferencesForm">${lotNumberField}
                                <div class="form-group">
                                    <label>Category / Lot Type</label>
                                    <select id="prefLotType" required>
                                        <option value="">Select lot type</option>
                                    </select>
                                </div>
                                <div class="form-group">
                                    <label>Budget Range: ₱<span id="budgetValue">10,000</span></label>
                                    <input type="range" id="prefBudget" min="2000" max="30000" step="500" value="10000">
                                </div>
                                <div class="form-group">
                                    <label>Preferred Section (optional)</label>
                                    <select id="prefSection">
                                        <option value="">Any section</option>
                                        <option value="Section A">Section A</option>
                                        <option value="Section B">Section B</option>
                                        <option value="Section C">Section C</option>
                                        <option value="Section D">Section D</option>
                                    </select>
                                </div>
                                <div class="form-actions">
                                    <button type="submit" class="btn-next">Search Manually →</button>
                                </div>
                            </form>
                        </details>` : '';

    wizardMount.innerHTML = `
                <!-- Multi-step wizard -->
                <div class="wizard-container">
                    <!-- Step indicators -->
                    <div class="steps">
                        <div class="step active" data-step="1"><span class="step-num">1</span> Preferences</div>
                        <div class="step" data-step="2"><span class="step-num">2</span> AI Recommendations</div>
                        <div class="step" data-step="3"><span class="step-num">3</span> Confirmation</div>
                    </div>

                    <!-- Step 1: Preferences Form -->
                    <div id="step1" class="step-content active">
                        <div class="form-card">
                            <h3><i class="fas fa-monument"></i> Booking Details</h3>
                            <div class="form-group">
                                <label>Decedent</label>
                                <select id="prefDecedent" required>
                                    <option value="">Loading decedents...</option>
                                </select>
                            </div>
                            <div class="form-group">
                                <label>Desired Burial Date</label>
                                <input type="date" id="prefDate" required>
                            </div>
                            <div class="form-group">
                                <label>Preferred Time (optional)</label>
                                <input type="time" id="prefTime">
                            </div>
                            <div class="form-group">
                                <label>Additional Requirements (e.g., near water feature, shaded area)</label>
                                <textarea id="prefNotes" rows="3" placeholder="Optional"></textarea>
                            </div>
                        </div>
${manualFiltersBlock}
                    </div>

                    <!-- Step 2: AI Recommendations -->
                    <div id="step2" class="step-content">
                        <div class="form-card">
                            <h3>
                                <span class="heading-icon-gate" aria-hidden="true">
                                    <svg viewBox="0 0 32 28" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
                                        <path d="M3 24.5h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                                        <rect x="4.2" y="10.5" width="2.6" height="14" rx="0.6" fill="currentColor"/>
                                        <rect x="17.2" y="10.5" width="2.6" height="14" rx="0.6" fill="currentColor"/>
                                        <circle cx="5.5" cy="8.3" r="1.7" fill="currentColor"/>
                                        <circle cx="18.5" cy="8.3" r="1.7" fill="currentColor"/>
                                        <path d="M6.6 11.6C6.6 6.4 17.4 6.4 17.4 11.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
                                        <path d="M12 2.6v3.2M10.5 4.2h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                                        <circle cx="24.6" cy="16.6" r="3.6" fill="currentColor"/>
                                        <polygon points="21.9,18.6 20.1,21.6 23.7,19.7" fill="currentColor"/>
                                    </svg>
                                </span>
                                AI‑Powered Lot Recommendations
                            </h3>
                            <div class="recommendation-summary" id="recommendationSummary">Browse available lots and reserve the best fit for your needs. All reservations stay pending until admin approval.</div>
                            <div id="recommendationsList" class="recommendations-grid">
                                <!-- dynamically loaded recommendations -->
                            </div>
                            <div class="form-actions">
                                <button class="btn-back" data-back="1">← Back to Preferences</button>
                            </div>
                        </div>
                    </div>

                    <!-- Step 3: Confirmation -->
                    <div id="step3" class="step-content">
                        <div class="form-card">
                            <h3><i class="fas fa-check-circle"></i> Confirm Booking</h3>
                            <div id="confirmationDetails"></div>
                            <div class="form-actions">
                                <button class="btn-back" data-back="2">← Back</button>
                                <button id="confirmBooking" class="btn-confirm">Confirm & Save Schedule</button>
                            </div>
                        </div>
                    </div>
                </div>`;

    chatWidgetMount.innerHTML = `
        <!-- Floating Burial Assistant -->
        <div class="ai-chat-widget" id="aiChatWidget">
            <div class="ai-chat-panel" id="aiChatPanel" hidden>
                <div class="ai-chat-panel-header">
                    <span>
                        <span class="ai-chat-icon-gate" aria-hidden="true">
                            <svg viewBox="0 0 32 28" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
                                <path d="M3 24.5h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                                <rect x="4.2" y="10.5" width="2.6" height="14" rx="0.6" fill="currentColor"/>
                                <rect x="17.2" y="10.5" width="2.6" height="14" rx="0.6" fill="currentColor"/>
                                <circle cx="5.5" cy="8.3" r="1.7" fill="currentColor"/>
                                <circle cx="18.5" cy="8.3" r="1.7" fill="currentColor"/>
                                <path d="M6.6 11.6C6.6 6.4 17.4 6.4 17.4 11.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
                                <path d="M12 2.6v3.2M10.5 4.2h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                                <circle cx="24.6" cy="16.6" r="3.6" fill="currentColor"/>
                                <polygon points="21.9,18.6 20.1,21.6 23.7,19.7" fill="currentColor"/>
                            </svg>
                        </span>
                        Burial Assistant
                    </span>
                    <button type="button" class="ai-chat-close" id="aiChatClose" aria-label="Close chat">
                        <i class="fas fa-times"></i>
                    </button>
                </div>
                <div class="ai-chat-panel-body">
                    <p class="chat-subtitle">Tell me who this is for, your preferred burial date, lot type, and budget — I'll take it from there.</p>
                    <div class="chat-window" id="chatWindow" aria-live="polite"></div>
                    <div class="chat-pref-status" id="chatPrefStatus">
                        <span class="chat-pref-chip" data-field="decedent_id">Decedent: <strong>Not set</strong></span>
                        <span class="chat-pref-chip" data-field="date">Date: <strong>Not set</strong></span>
                        <span class="chat-pref-chip" data-field="lot_type">Lot type: <strong>Not set</strong></span>
                        <span class="chat-pref-chip" data-field="budget">Budget: <strong>Not set</strong></span>
                        <span class="chat-pref-chip" data-field="section">Section: <strong>Not set</strong></span>
                    </div>
                    <form id="chatForm" class="chat-input-row">
                        <input type="text" id="chatInput" placeholder="e.g., Premium lot, 8000" autocomplete="off" disabled>
                        <button type="submit" class="chat-send-btn" aria-label="Send" disabled><i class="fas fa-paper-plane"></i></button>
                    </form>
                    <div class="chat-actions">
                        <button type="button" id="chatSuggestTypeBtn" class="btn-next">Recommend a type for me</button>
                        <button type="button" id="chatFindLotsBtn" class="btn-next" disabled>Find Matching Lots →</button>
                    </div>
                </div>
            </div>
            <button type="button" class="ai-chat-toggle" id="aiChatToggle" aria-label="Open Burial Assistant" aria-expanded="false" aria-controls="aiChatPanel">
                <span class="ai-chat-icon-gate" aria-hidden="true">
                    <svg viewBox="0 0 32 28" fill="none" xmlns="http://www.w3.org/2000/svg" focusable="false">
                        <path d="M3 24.5h18" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                        <rect x="4.2" y="10.5" width="2.6" height="14" rx="0.6" fill="currentColor"/>
                        <rect x="17.2" y="10.5" width="2.6" height="14" rx="0.6" fill="currentColor"/>
                        <circle cx="5.5" cy="8.3" r="1.7" fill="currentColor"/>
                        <circle cx="18.5" cy="8.3" r="1.7" fill="currentColor"/>
                        <path d="M6.6 11.6C6.6 6.4 17.4 6.4 17.4 11.6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
                        <path d="M12 2.6v3.2M10.5 4.2h3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                        <circle cx="24.6" cy="16.6" r="3.6" fill="currentColor"/>
                        <polygon points="21.9,18.6 20.1,21.6 23.7,19.7" fill="currentColor"/>
                    </svg>
                </span>
                <i class="fas fa-chevron-down ai-chat-icon-close" aria-hidden="true"></i>
            </button>
        </div>`;
}

function createBookingWizard(options) {
    const { allowedRoles, renderStatusBadge, onBookingSuccess, showLotNumberField, showManualFilters = true } = options;

    async function init() {
        const user = await requireRole(allowedRoles);
        if (!user) return;

        // Inject the shared wizard/chat markup before any lookups below —
        // the two pages now only provide empty mount points for this.
        renderWizardMarkup({
            wizardMount: document.getElementById('wizardContainerMount'),
            chatWidgetMount: document.getElementById('aiChatWidgetMount'),
            showLotNumberField,
            showManualFilters,
        });

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
        const chatSuggestTypeBtn = document.getElementById('chatSuggestTypeBtn');
        const chatPrefStatus = document.getElementById('chatPrefStatus');

        let currentPreferences = {};
        let selectedLot = null;
        let decedents = [];
        let lotTypes = [];
        let sections = [];

        // Phase 2-5 conversational assistant (assets/js/shared/lot-chat-assistant.js),
        // shared by both wizards so they run the identical slot-filling/
        // narration/capacity-advisory/type-recommendation logic.
        // Batch N3: the same past-date/Monday-block rule the Booking Details
        // date field already enforces (see the prefDate 'change' listener
        // below), reused so a chat-parsed date can't bypass it.
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

        // Batch N3: applies a chat-resolved decedent/date/time onto the
        // always-visible Booking Details fields, which stay the single
        // source of truth the rest of the wizard (chatFindLotsBtn,
        // confirmBooking) already reads from.
        function applyExtractedDetail(field, value) {
            if (field === 'decedent_id' && prefDecedent) {
                prefDecedent.value = String(value);
            } else if (field === 'date' && prefDate) {
                prefDate.value = value;
            } else if (field === 'time' && selectTimeInput) {
                selectTimeInput.value = value;
            }
        }

        const chatAssistant = createLotChatAssistant({
            chatWindow, chatForm, chatInput, chatFindLotsBtn, chatSuggestTypeBtn, chatPrefStatus,
            getLotTypes: () => lotTypes,
            getSections: () => sections,
            getDecedents: () => decedents,
            validateDate: validateBookingDate,
            onDetailExtracted: applyExtractedDetail,
        });

        // Batch M9: deterministic trigger for M4's lot-type recommendation —
        // no longer only reachable through LLM phrasing detection.
        if (chatSuggestTypeBtn) {
            chatSuggestTypeBtn.addEventListener('click', async function() {
                await withButtonLoading(chatSuggestTypeBtn, async () => {
                    await chatAssistant.requestTypeSuggestion();
                });
            });
        }

        // Floating widget open/close only — purely presentational, the chat
        // DOM/state above is untouched by opening or closing, so the
        // conversation is preserved across toggles for free.
        const aiChatToggle = document.getElementById('aiChatToggle');
        const aiChatPanel = document.getElementById('aiChatPanel');
        const aiChatClose = document.getElementById('aiChatClose');

        function setChatPanelOpen(isOpen) {
            aiChatPanel.hidden = !isOpen;
            // Icon swap (gate <-> chevron) is pure CSS, keyed off aria-expanded.
            aiChatToggle.setAttribute('aria-expanded', String(isOpen));
            if (isOpen && !chatInput.disabled) {
                chatInput.focus();
            }
        }

        aiChatToggle.addEventListener('click', () => {
            setChatPanelOpen(aiChatPanel.hidden);
        });

        aiChatClose.addEventListener('click', () => {
            setChatPanelOpen(false);
        });

        document.addEventListener('keydown', (event) => {
            if (event.key === 'Escape' && !aiChatPanel.hidden) {
                setChatPanelOpen(false);
                aiChatToggle.focus();
            }
        });

        if (budgetSlider && budgetValue) {
            budgetValue.textContent = Number(budgetSlider.value).toLocaleString();
            budgetSlider.addEventListener('input', () => {
                budgetValue.textContent = Number(budgetSlider.value).toLocaleString();
            });
        }

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

                // These selects only exist when the manual-filters fallback
                // is enabled (showManualFilters) — the chat assistant reads
                // `sections`/`lotTypes` directly via getSections()/getLotTypes()
                // regardless of whether these DOM elements are present.
                if (selectSectionInput) {
                    selectSectionInput.innerHTML = '<option value="">Any section</option>' + sections.map(section => `
                        <option value="${section.section_name}">${section.section_name}</option>
                    `).join('');
                }

                if (selectLotInput) {
                    selectLotInput.innerHTML = '<option value="">Select lot type</option>' + lotTypes.map(type => `
                        <option value="${type.type_name}">${type.type_name}</option>
                    `).join('');
                }
            } catch (error) {
                console.error('Failed to load lookup data', error);
            }
        }

        // Phase 3: purely presentational — renders whatever reasons[] the
        // existing recommendation engine already returned. Never invents a
        // reason and never touches score/ranking/ordering.
        // Batch M9: isFallback distinguishes "the AI engine ran and had
        // nothing specific to say about this lot" from "the AI engine was
        // unreachable, this is a plain unranked list" — those previously
        // rendered identical text, which misrepresented the second case as
        // an AI outcome.
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
                // Explicit arrow, not a bare `lots.map(buildLotCard)` — Array.map
                // passes (element, index) to its callback, and index 0 would
                // otherwise be misread as isFallback=false for the first card.
                recommendationsList.innerHTML = lots.map(lot => buildLotCard(lot, true)).join('');
                attachSelectHandlers();
            } catch (error) {
                console.error('Failed to load available lots for manual browsing', error);
                recommendationsList.innerHTML = '<p class="text-center">Could not load available lots. Please try again later.</p>';
            }
        }

        // Returns a small outcome summary ({status, count}) alongside its existing
        // DOM-rendering job, purely so callers (e.g. the chat layer) can react to
        // what actually happened without re-fetching or re-deriving it themselves.
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
                // Explicit arrow — see the isFallback note on buildLotCard/
                // showManualLotFallback: a bare `.map(buildLotCard)` would
                // pass Array.map's index as isFallback, wrongly marking
                // every card past the first as a non-AI fallback card.
                recommendationsList.innerHTML = recommendations.map(lot => buildLotCard(lot)).join('');
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
                // Batch M9: prefLotNumber no longer exists on the citizen
                // page (reserve-burial-slot.html) — lot numbers are an
                // internal staff/admin concept, not something a citizen
                // would know. Still present on burial-scheduling.html.
                lot_number: prefLotNumber ? prefLotNumber.value.trim() : '',
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
                    <p><strong>Price:</strong> ₱${parseFloat(lot.price).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
                    <p><strong>Burial Date:</strong> ${currentPreferences.date}</p>
                    <p><strong>Burial Time:</strong> ${currentPreferences.time || 'Not specified'}</p>
                    <p><strong>Decedent:</strong> ${currentPreferences.decedentName || 'N/A'}</p>
                    <p><strong>Notes:</strong> ${currentPreferences.notes || 'None'}</p>
                    <p class="muted">This reservation will remain pending until an administrator or staff member reviews and approves it.</p>
                </div>
            `;
            confirmationDetails.innerHTML = details;
        }

        if (scheduleForm) {
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
        }

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
            const chatPreferences = chatAssistant.getPreferences();
            currentPreferences = {
                lot_type: chatPreferences.lot_type,
                budget: chatPreferences.budget,
                section: chatPreferences.section,
                date: date,
                time: selectTimeInput.value || null,
                notes: selectNotesInput.value.trim(),
                deceased_id: decedentId,
                decedentName: decedent ? `${decedent.first_name} ${decedent.last_name}` : ''
            };
            await withButtonLoading(chatFindLotsBtn, async () => {
                const outcome = await fetchAndRenderRecommendations(chatPreferences);
                await chatAssistant.appendOutcomeMessage(outcome);
                await chatAssistant.appendCapacityWarning(date);
                showStep(2);
                // Collapse the floating panel so it doesn't cover the
                // recommendation cards it just triggered. The toggle button
                // stays put — reopening shows the same preserved conversation.
                setChatPanelOpen(false);
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
                        const bookedLot = selectedLot;
                        const scheduleId = result.schedule_id;
                        if (scheduleForm) scheduleForm.reset();
                        if (budgetValue) budgetValue.textContent = '10,000';
                        if (prefLotNumber) prefLotNumber.value = '';
                        selectTimeInput.value = '';
                        selectedLot = null;
                        currentPreferences = {};
                        showStep(1);
                        onBookingSuccess({ scheduleId, bookedLot });
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
            const validation = validateBookingDate(prefDate.value);
            if (!validation.valid) {
                alert(validation.reason);
                prefDate.value = '';
            }
        });

        await Promise.all([loadDecedents(), loadLookupData()]);
        chatAssistant.init();

        // Batch M9: the chat assistant is the intended primary way to search
        // for a lot (natural language, AI-explained results) — the manual
        // filter <details> stays the secondary fallback it already was.
        // Open the panel by default instead of leaving it collapsed behind
        // an extra click.
        setChatPanelOpen(true);

        // Check if lot_id passed via URL query params (from Interactive Slot Grid)
        const urlParams = new URLSearchParams(window.location.search);
        const urlLotId = urlParams.get('lot_id');
        if (urlLotId) {
            try {
                const lot = await api.request(`lots/${urlLotId}`);
                if (lot && !lot.error) {
                    selectedLot = lot;
                    if (lot.section_name && selectSectionInput) selectSectionInput.value = lot.section_name;
                    if (lot.lot_type_name && selectLotInput) selectLotInput.value = lot.lot_type_name;
                    if (lot.price && budgetSlider && budgetValue) {
                        budgetSlider.value = lot.price;
                        budgetValue.textContent = Number(lot.price).toLocaleString();
                    }
                }
            } catch (err) {
                console.error('Failed to pre-fetch lot from URL', err);
            }
        }

        showStep(1);
    }

    return { init };
}
