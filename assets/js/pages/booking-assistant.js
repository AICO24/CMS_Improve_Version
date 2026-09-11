/**
 * AI Booking Assistant Controller (Unified Burial & Cremation) — BMS-6
 * 
 * Presentation layer strictly bound to the authoritative PHP/AI state machine:
 * - Conversational turns via POST /api/booking-agent/chat
 * - Authoritative state via GET /api/booking-agent/active
 * - Discrete field corrections via POST /api/booking-agent/drafts/{id}/update-field
 * - Pre-confirmation boundary via POST /api/booking-agent/drafts/{id}/confirm
 * - Cancellation via POST /api/booking-agent/drafts/{id}/cancel
 * - Lot selection via GET /api/lots?status=Available
 */
(function() {
    'use strict';

    // Authoritative State Mirror
    const state = {
        draftId: null,
        serviceType: null,
        status: 'INTAKE',
        extractedData: {},
        missingFields: [],
        isReadyForReview: false,
        decedentMatch: null,
        selectedLotDetails: null,
        isLoading: false,
        availableLots: [],
        filteredLots: [],
        pendingAction: null
    };

    // UI Elements
    let chatComposerForm, chatThread, userInputMsg, btnSendMessage, btnRestartDraft, promptSuggestions;
    let blueprintStatusBadge, hudServiceVal, hudDecedentVal, hudAllocationVal, hudReviewVal;
    let hudServiceBadge, hudServiceDesc, hudDecedentName, hudRelationship, hudDate, hudAllocationLabel, hudAllocationDetails, hudLotActionBox, btnOpenLotPicker;
    let btnEditDecedent, btnEditSchedule, hudMissingAlert, hudMissingList, hudMatchCard, hudMatchText;
    let btnConfirmBooking;
    let lotPickerModal, btnCloseLotPicker, lotSearchFilter, lotSectionFilter, lotPickerSpinner, lotGridContainer, lotPickerEmpty;
    let fieldEditModal, btnCloseFieldEdit, btnCancelFieldEdit, fieldEditForm, fieldEditTitle, fieldEditLabel, fieldEditInput, fieldEditHint;

    let activeEditField = null;
    let isInitialized = false;
    let cooldownTimer = null;
    let isCooldownActive = false;
    let lastFocusedElementBeforeModal = null;

    /**
     * Initialization entry point
     */
    async function init() {
        if (isInitialized) return;
        isInitialized = true;

        // Synchronous binding first: guarantees buttons are wired immediately upon DOM load
        cacheDOMElements();
        bindEvents();
        updateSendButtonState();

        try {
            if (typeof requireRole === 'function') {
                const user = await requireRole(['admin', 'staff', 'user']);
                if (!user) return;
            } else {
                await loadCurrentUser();
            }
        } catch (e) {
            console.error('Role validation failed:', e);
            await loadCurrentUser();
        }

        await initializeSession();
    }

    /**
     * Cache all interactive DOM elements
     */
    function cacheDOMElements() {
        chatComposerForm = document.getElementById('chatComposerForm');
        chatThread = document.getElementById('chatThread');
        userInputMsg = document.getElementById('userInputMsg');
        btnSendMessage = document.getElementById('btnSendMessage');
        btnRestartDraft = document.getElementById('btnRestartDraft');
        promptSuggestions = document.getElementById('promptSuggestions');

        blueprintStatusBadge = document.getElementById('blueprintStatusBadge');
        hudServiceVal = document.getElementById('hudServiceVal');
        hudDecedentVal = document.getElementById('hudDecedentVal');
        hudAllocationVal = document.getElementById('hudAllocationVal');
        hudReviewVal = document.getElementById('hudReviewVal');

        hudServiceBadge = document.getElementById('hudServiceBadge');
        hudServiceDesc = document.getElementById('hudServiceDesc');
        hudDecedentName = document.getElementById('hudDecedentName');
        hudRelationship = document.getElementById('hudRelationship');
        hudDate = document.getElementById('hudDate');
        hudAllocationLabel = document.getElementById('hudAllocationLabel');
        hudAllocationDetails = document.getElementById('hudAllocationDetails');
        hudLotActionBox = document.getElementById('hudLotActionBox');
        btnOpenLotPicker = document.getElementById('btnOpenLotPicker');

        btnEditDecedent = document.getElementById('btnEditDecedent');
        btnEditSchedule = document.getElementById('btnEditSchedule');
        hudMissingAlert = document.getElementById('hudMissingAlert');
        hudMissingList = document.getElementById('hudMissingList');
        hudMatchCard = document.getElementById('hudMatchCard');
        hudMatchText = document.getElementById('hudMatchText');

        btnConfirmBooking = document.getElementById('btnConfirmBooking');

        lotPickerModal = document.getElementById('lotPickerModal');
        btnCloseLotPicker = document.getElementById('btnCloseLotPicker');
        lotSearchFilter = document.getElementById('lotSearchFilter');
        lotSectionFilter = document.getElementById('lotSectionFilter');
        lotPickerSpinner = document.getElementById('lotPickerSpinner');
        lotGridContainer = document.getElementById('lotGridContainer');
        lotPickerEmpty = document.getElementById('lotPickerEmpty');

        fieldEditModal = document.getElementById('fieldEditModal');
        btnCloseFieldEdit = document.getElementById('btnCloseFieldEdit');
        btnCancelFieldEdit = document.getElementById('btnCancelFieldEdit');
        fieldEditForm = document.getElementById('fieldEditForm');
        fieldEditTitle = document.getElementById('fieldEditTitle');
        fieldEditLabel = document.getElementById('fieldEditLabel');
        fieldEditInput = document.getElementById('fieldEditInput');
        fieldEditHint = document.getElementById('fieldEditHint');
    }

    /**
     * Bind DOM event listeners
     */
    function bindEvents() {
        // Authoritative form submission: handles Send click and Enter key uniformly
        if (chatComposerForm) {
            chatComposerForm.addEventListener('submit', onComposerSubmit);
        } else if (btnSendMessage) {
            btnSendMessage.addEventListener('click', onSendMessage);
        }

        if (userInputMsg) {
            userInputMsg.addEventListener('input', updateSendButtonState);
            userInputMsg.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                    if (!chatComposerForm) {
                        e.preventDefault();
                        onSendMessage();
                    }
                }
            });
        }

        if (btnRestartDraft) btnRestartDraft.addEventListener('click', onRestartDraft);
        if (btnConfirmBooking) btnConfirmBooking.addEventListener('click', onConfirmBooking);

        if (btnOpenLotPicker) btnOpenLotPicker.addEventListener('click', openLotPicker);
        if (btnCloseLotPicker) btnCloseLotPicker.addEventListener('click', closeLotPicker);
        if (lotSearchFilter) lotSearchFilter.addEventListener('input', filterLots);
        if (lotSectionFilter) lotSectionFilter.addEventListener('change', filterLots);

        if (btnEditDecedent) btnEditDecedent.addEventListener('click', () => openFieldEditor('decedent_name'));
        if (btnEditSchedule) btnEditSchedule.addEventListener('click', () => openFieldEditor(state.serviceType === 'cremation' ? 'cremation_date' : 'preferred_date'));

        if (btnCloseFieldEdit) btnCloseFieldEdit.addEventListener('click', closeFieldEditor);
        if (btnCancelFieldEdit) btnCancelFieldEdit.addEventListener('click', closeFieldEditor);
        if (fieldEditForm) fieldEditForm.addEventListener('submit', onSubmitFieldEdit);

        // Close modals on backdrop click
        if (lotPickerModal) {
            lotPickerModal.addEventListener('click', (e) => {
                if (e.target === lotPickerModal) closeLotPicker();
            });
        }
        if (fieldEditModal) {
            fieldEditModal.addEventListener('click', (e) => {
                if (e.target === fieldEditModal) closeFieldEditor();
            });
        }

        // Accessibility: Dismiss modals with Escape key
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' || e.key === 'Esc') {
                if (lotPickerModal && lotPickerModal.style.display === 'flex') {
                    closeLotPicker();
                } else if (fieldEditModal && fieldEditModal.style.display === 'flex') {
                    closeFieldEditor();
                }
            }
        });

        // Shell & Navigation controls (Batch A)
        const toggleBtn = document.getElementById('toggleSidebar');
        const sidebar = document.querySelector('.sidebar');
        if (toggleBtn && sidebar) {
            toggleBtn.addEventListener('change', () => {
                sidebar.classList.toggle('collapsed');
            });
        }

        const logoutBtn = document.getElementById('logoutBtn');
        if (logoutBtn && typeof api !== 'undefined' && typeof api.logout === 'function') {
            logoutBtn.addEventListener('click', () => api.logout());
        }
    }

    /**
     * Synchronize Send button disabled state with input content & loading lifecycle
     */
    function updateSendButtonState() {
        if (!btnSendMessage) return;
        if (state.isLoading || isCooldownActive) {
            btnSendMessage.disabled = true;
            return;
        }
        const text = (userInputMsg && userInputMsg.value) ? userInputMsg.value.trim() : '';
        btnSendMessage.disabled = text.length === 0;
    }

    /**
     * Populate current user session information in top-bar and sidebar
     */
    async function loadCurrentUser() {
        try {
            let user = null;
            if (typeof api !== 'undefined' && api.getMe) {
                user = await api.getMe();
            }
            if (user) {
                const nameEls = [document.getElementById('userName'), document.getElementById('sidebarUserName')];
                const roleEls = [document.getElementById('userRole'), document.getElementById('sidebarUserRole')];
                const displayName = user.full_name || user.username || 'Client';
                const displayRole = user.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1)) : 'Client';

                nameEls.forEach(el => { if (el) el.textContent = displayName; });
                roleEls.forEach(el => { if (el) el.textContent = displayRole; });
            }
        } catch (e) {
            console.warn('Could not fetch user profile:', e);
        }
    }

    /**
     * Check for active draft or initialize a new conversation with draft resumption support (BMS-9)
     */
    async function initializeSession() {
        const urlParams = new URLSearchParams(window.location.search);
        const paramDraftId = urlParams.get('draft_id');
        const paramService = urlParams.get('service');
        if (paramService && ['burial', 'cremation'].includes(paramService.toLowerCase())) {
            state.serviceType = paramService.toLowerCase();
        }

        try {
            setLoading(true);

            // 1. If explicit draft_id is passed in URL, fetch that specific draft
            if (paramDraftId && /^\d+$/.test(paramDraftId)) {
                try {
                    const draftRes = await api.request(`booking-agent/drafts/${paramDraftId}`, { method: 'GET' });
                    if (draftRes && draftRes.success && draftRes.draft) {
                        applyAuthoritativeState(draftRes.draft);
                        appendAssistantMessage(`Welcome back! Resumed your **${state.serviceType || 'cemetery'} arrangement** (Draft #${state.draftId}). You can review your details on the right or make adjustments conversationally.`);
                        renderPromptChips();
                        return;
                    } else if (draftRes && draftRes.error) {
                        appendAssistantMessage(`⚠️ Could not resume Draft #${escapeHtml(paramDraftId)}: ${escapeHtml(draftRes.error)}`);
                    }
                } catch (err) {
                    console.warn(`Could not load draft #${paramDraftId}:`, err);
                    appendAssistantMessage(`⚠️ Notice: Draft #${escapeHtml(paramDraftId)} could not be resumed (it may be expired, completed, or unavailable). Starting fresh.`);
                }
            }

            // 2. Fall back to active draft lookup
            const endpoint = state.serviceType ? `booking-agent/active?service_type=${state.serviceType}` : 'booking-agent/active';
            const res = await api.request(endpoint, { method: 'GET' });

            if (res && res.success && res.draft) {
                applyAuthoritativeState(res.draft);
                appendAssistantMessage(`Welcome back! We are continuing your **${state.serviceType || 'cemetery'} arrangement** (Draft #${state.draftId}). Review your details in the blueprint on the right, or tell me what you'd like to update.`);
                renderPromptChips();
            } else {
                renderIntakeGreeting();
            }
        } catch (e) {
            renderIntakeGreeting();
        } finally {
            setLoading(false);
        }
    }

    /**
     * Render the initial assistant greeting with service quick actions
     */
    function renderIntakeGreeting() {
        chatThread.innerHTML = '';
        if (state.serviceType === 'burial') {
            appendAssistantMessage(
                `Hello! I am your AI Booking Assistant. I will guide you step-by-step through arranging a **burial service**.\n\nTo begin, who is this burial arrangement for (the decedent's full name)?`
            );
            renderPromptChips([
                { text: '👤 For my father', action: () => sendQuickInput('The burial arrangement is for my father, ') },
                { text: '👤 For my mother', action: () => sendQuickInput('The burial arrangement is for my mother, ') },
                { text: '❓ Requirements & Pricing', action: () => sendChatTurn('What are the burial requirements and lot types?') }
            ]);
        } else if (state.serviceType === 'cremation') {
            appendAssistantMessage(
                `Hello! I am your AI Booking Assistant. I will guide you step-by-step through arranging a **cremation service**.\n\nTo begin, who is this cremation arrangement for (the decedent's full name)?`
            );
            renderPromptChips([
                { text: '👤 For my father', action: () => sendQuickInput('The cremation arrangement is for my father, ') },
                { text: '👤 For my mother', action: () => sendQuickInput('The cremation arrangement is for my mother, ') },
                { text: '❓ Columbarium & Date Info', action: () => sendChatTurn('What are the cremation requirements and columbarium details?') }
            ]);
        } else {
            appendAssistantMessage(
                `Hello! I am your AI Booking Assistant. I will guide you step-by-step through arranging a **burial** or **cremation** service.\n\nTo begin, which type of service would you like to arrange?`
            );
            renderPromptChips([
                { text: '⚰️ Arrange a Burial', action: () => selectService('burial') },
                { text: '🔥 Arrange a Cremation', action: () => selectService('cremation') }
            ]);
        }
        updateBlueprintHUD();
    }

    /**
     * Quick service selector handler
     */
    async function selectService(serviceType) {
        if (state.isLoading) return;
        state.serviceType = serviceType;
        appendUserMessage(`I want to arrange a ${serviceType} service.`);
        await sendChatTurn(`I want to arrange a ${serviceType} service.`);
    }

    /**
     * Authoritative form submit handler (prevents page reload)
     */
    async function onComposerSubmit(e) {
        if (e && typeof e.preventDefault === 'function') {
            e.preventDefault();
        }
        await onSendMessage();
    }

    /**
     * Handle user sending a message with validation cues & concurrency lock
     */
    async function onSendMessage() {
        if (state.isLoading || isCooldownActive) return;

        const text = userInputMsg ? userInputMsg.value.trim() : '';
        if (!text) {
            if (userInputMsg) {
                userInputMsg.focus();
                userInputMsg.classList.add('chat-input-cue');
                setTimeout(() => {
                    if (userInputMsg) userInputMsg.classList.remove('chat-input-cue');
                }, 600);
            }
            updateSendButtonState();
            return;
        }

        // Lock loading immediately before async dispatch to prevent duplicate clicks
        setLoading(true);
        const originalText = userInputMsg.value;
        userInputMsg.value = '';
        updateSendButtonState();

        appendUserMessage(text);
        try {
            await sendChatTurn(text);
        } catch (err) {
            // Restore draft text on catastrophic failure
            if (userInputMsg && !userInputMsg.value) {
                userInputMsg.value = originalText;
                updateSendButtonState();
            }
        }
    }

    /**
     * Core conversational turn wired to POST /api/booking-agent/chat
     */
    async function sendChatTurn(text) {
        setLoading(true);
        const typingEl = appendTypingIndicator();

        try {
            const payload = {
                message: text,
                draft_id: state.draftId,
                service_type: state.serviceType
            };

            const res = await api.request('booking-agent/chat', {
                method: 'POST',
                body: payload
            });

            removeTypingIndicator(typingEl);

            if (res && res.success) {
                applyAuthoritativeState(res);

                if (res.pending_action) {
                    state.pendingAction = res.pending_action;
                }

                // Assistant reply
                if (res.reply) {
                    appendAssistantMessage(res.reply);
                }

                // Advisory decedent match alert
                if (res.decedent_match && res.decedent_match.found) {
                    appendAssistantMessage(`💡 *Cemetery Record Advisory*: We identified matching records for "${res.extracted_data.decedent_name}" in our registry. Our administration will cross-reference this during final review.`);
                }

                // If in LOT_SELECTION and burial, prompt lot selection
                if (res.status === 'LOT_SELECTION' && state.serviceType === 'burial' && !state.extractedData.lot_id) {
                    appendAssistantMessage(`Please choose an available burial lot from our cemetery map or browse our available lots list.`);
                }

                // Availability Results rendering (Batch 4)
                if (res.availability) {
                    renderAvailabilityCard(res.availability);
                }

                // Missing Requirements checklist rendering (Batch 4)
                if (res.checklist && res.has_active_draft) {
                    renderChecklistCard(res.checklist);
                }

                const altDates = res.alternative_dates || res.alternatives || res.recovery?.alternative_dates || [];
                const altLots = res.alternative_lots || res.recovery?.alternative_lots || [];

                if (res.pending_action) {
                    renderPendingActionChips(res.pending_action);
                } else if (altDates.length > 0) {
                    const dateChips = altDates.map(d => ({
                        text: `📅 ${formatDateLabel(d)}`,
                        action: () => sendChatTurn(`Available ba sa ${d}?`)
                    }));
                    renderPromptChips(dateChips);
                } else if (altLots.length > 0) {
                    const lotChips = altLots.map(l => ({
                        text: `📍 Lot #${l.lot_number} (${l.section_name})`,
                        action: () => sendChatTurn(`Available ba ang Lot #${l.lot_number}?`)
                    }));
                    renderPromptChips(lotChips);
                } else if (Array.isArray(res.available_lots) && res.available_lots.length > 0) {
                    const lotChips = res.available_lots.map(l => ({
                        text: `📍 Lot #${l.lot_number} (${l.section_name})`,
                        action: () => sendChatTurn(`Reassign to Lot #${l.lot_number}`)
                    }));
                    renderPromptChips(lotChips);
                } else {
                    renderPromptChips();
                }
            } else {
                appendAssistantMessage(res?.error || 'I encountered an issue processing your request. Please try again.');
            }
        } catch (err) {
            removeTypingIndicator(typingEl);
            const isRateLimit = err && (err.status === 429 || String(err.message).includes('429') || String(err.message).toLowerCase().includes('rate limit'));
            if (isRateLimit) {
                appendAssistantMessage('⚠️ You are sending messages too quickly. Please wait 5 seconds before trying again.');
                if (typeof showToast === 'function') showToast('Rate limit reached. Please wait a moment.', 'warning');
                startRateLimitCooldown(5);
            } else {
                appendAssistantMessage('⚠️ Connection error: ' + (err?.message || 'Please check your network and try again.'));
            }
        } finally {
            // Do NOT unlock loading if rate limit cooldown is actively holding the button
            if (!isCooldownActive) {
                setLoading(false);
                updateSendButtonState();
            }
            if (userInputMsg) userInputMsg.focus();
        }
    }

    /**
     * Temporary countdown cooldown for HTTP 429 rate limit
     */
    function startRateLimitCooldown(seconds) {
        if (cooldownTimer) {
            clearInterval(cooldownTimer);
            cooldownTimer = null;
        }
        isCooldownActive = true;
        let remaining = seconds;
        setLoading(true);
        if (btnSendMessage) {
            btnSendMessage.disabled = true;
            btnSendMessage.innerHTML = `<span style="font-size:0.75rem;">${remaining}s</span>`;
        }
        cooldownTimer = setInterval(() => {
            remaining--;
            if (remaining > 0 && btnSendMessage) {
                btnSendMessage.innerHTML = `<span style="font-size:0.75rem;">${remaining}s</span>`;
            } else {
                clearInterval(cooldownTimer);
                cooldownTimer = null;
                isCooldownActive = false;
                setLoading(false);
                updateSendButtonState();
            }
        }, 1000);
    }

    /**
     * Apply authoritative state returned by the server
     */
    function applyAuthoritativeState(data) {
        if (!data) return;

        const isNewDraft = Boolean(data.draft_id && state.draftId && data.draft_id !== state.draftId);
        state.draftId = data.draft_id || state.draftId;
        state.serviceType = data.service_type || state.serviceType;
        state.status = data.status || state.status;

        // Non-destructive merge: incoming fields augment or update existing extractedData, never wipe to empty
        if (isNewDraft) {
            state.extractedData = (data.extracted_data && typeof data.extracted_data === 'object') ? Object.assign({}, data.extracted_data) : {};
        } else if (data.extracted_data && typeof data.extracted_data === 'object' && Object.keys(data.extracted_data).length > 0) {
            state.extractedData = Object.assign({}, state.extractedData, data.extracted_data);
        }

        if (Array.isArray(data.missing_fields)) {
            state.missingFields = data.missing_fields;
        } else if (Array.isArray(data.missing_requirements)) {
            state.missingFields = data.missing_requirements;
        }

        if (data.is_ready_for_review !== undefined) {
            state.isReadyForReview = Boolean(data.is_ready_for_review);
        }
        if (data.decedent_match !== undefined) {
            state.decedentMatch = data.decedent_match || null;
        }
        state.contextResolution = data.context_resolution || state.contextResolution;
        state.lastIntent = data.intent || state.lastIntent;
        state.lastAction = data.action || state.lastAction;
        if (data.pending_action !== undefined) {
            state.pendingAction = data.pending_action;
        }

        if (data.action && data.action.target_type === 'DRAFT' && Array.isArray(data.changes)) {
            data.changes.forEach(ch => {
                if (ch && ch.field) {
                    state.extractedData[ch.field] = ch.new_value;
                }
            });
        }

        // Fetch lot details if lot_id is present
        if (state.extractedData.lot_id && (!state.selectedLotDetails || state.selectedLotDetails.lot_id !== state.extractedData.lot_id)) {
            fetchSelectedLotDetails(state.extractedData.lot_id);
        }

        updateBlueprintHUD();
    }

    /**
     * Fetch full lot details (section, block, type, price) for selected lot_id
     */
    async function fetchSelectedLotDetails(lotId) {
        try {
            const lot = await api.request(`lots/${lotId}`, { method: 'GET' });
            if (lot && (lot.lot_id || lot.data)) {
                state.selectedLotDetails = lot.data || lot;
                updateBlueprintHUD();
            }
        } catch (e) {
            console.warn('Could not fetch lot details for lot_id ' + lotId, e);
        }
    }

    /**
     * Render the Live Booking Blueprint HUD from state
     */
    function updateBlueprintHUD() {
        // Status Badge
        blueprintStatusBadge.textContent = formatStatusLabel(state.status);
        blueprintStatusBadge.className = 'blueprint-badge status-' + (state.status || 'intake').toLowerCase();

        // Stepper updates
        updateStepper();

        // Service Card
        const isCremation = state.serviceType === 'cremation';
        hudServiceBadge.textContent = state.serviceType ? (isCremation ? 'Cremation' : 'Burial') : 'Detecting...';
        hudServiceBadge.style.background = isCremation ? '#fef3c7' : '#ecfdf5';
        hudServiceBadge.style.color = isCremation ? '#b45309' : '#047857';
        hudServiceBadge.style.borderColor = isCremation ? '#fde68a' : '#a7f3d0';
        hudServiceDesc.textContent = state.serviceType ? (isCremation ? 'Cremation Service' : 'Standard Burial Service') : 'Pending selection';
        hudServiceVal.textContent = state.serviceType ? (isCremation ? 'Cremation' : 'Burial') : 'Pending';

        // Decedent Card
        const dName = state.extractedData.decedent_name;
        const dRel = state.extractedData.relationship;
        hudDecedentName.innerHTML = dName ? `<strong>${escapeHtml(dName)}</strong>` : '<span class="text-muted">Pending</span>';
        hudRelationship.innerHTML = dRel ? `<strong>${escapeHtml(dRel)}</strong>` : '<span class="text-muted">Pending</span>';
        hudDecedentVal.textContent = dName || 'Pending';

        // Schedule & Allocation Card
        const dateVal = isCremation ? state.extractedData.cremation_date : (state.extractedData.preferred_date || state.extractedData.schedule_date);
        const timeVal = state.extractedData.preferred_time || state.extractedData.schedule_time;
        let scheduleDisplay = '';
        if (dateVal && timeVal) {
            scheduleDisplay = `<strong>${formatDate(dateVal)}</strong> <span class="badge badge-light" style="font-size:0.8rem; margin-left:4px;"><i class="fas fa-clock"></i> ${formatTime(timeVal)}</span>`;
        } else if (dateVal) {
            scheduleDisplay = `<strong>${formatDate(dateVal)}</strong>`;
        } else {
            scheduleDisplay = '<span class="text-muted">Pending</span>';
        }
        hudDate.innerHTML = scheduleDisplay;

        if (isCremation) {
            hudAllocationLabel.textContent = 'Columbarium:';
            const col = state.extractedData.preferred_columbarium;
            hudAllocationDetails.innerHTML = col ? `<strong>${escapeHtml(col)}</strong>` : '<span class="text-muted">Assigned upon arrival</span>';
            hudAllocationVal.textContent = dateVal ? formatDate(dateVal) : 'Pending';
            hudLotActionBox.style.display = 'none';
        } else {
            hudAllocationLabel.textContent = 'Burial Lot:';
            if (state.selectedLotDetails) {
                const l = state.selectedLotDetails;
                hudAllocationDetails.innerHTML = `<strong>Lot ${escapeHtml(l.lot_number || l.lot_id)}</strong> <small class="text-muted">(${escapeHtml(l.section_name || 'Section')}, ${escapeHtml(l.block_name || 'Block')})</small>`;
                hudAllocationVal.textContent = `Lot ${l.lot_number || l.lot_id}`;
            } else if (state.extractedData.lot_id) {
                hudAllocationDetails.innerHTML = `<strong>Lot #${state.extractedData.lot_id}</strong>`;
                hudAllocationVal.textContent = `Lot #${state.extractedData.lot_id}`;
            } else {
                hudAllocationDetails.innerHTML = '<span class="text-muted">Not Selected</span>';
                hudAllocationVal.textContent = dateVal ? `${formatDate(dateVal)} (No lot)` : 'Pending';
            }

            // Show lot picker button if burial and lot selection needed
            hudLotActionBox.style.display = (state.serviceType === 'burial') ? 'block' : 'none';
        }

        // Missing Fields Alert
        if (state.missingFields && state.missingFields.length > 0 && state.status !== 'INTAKE') {
            hudMissingAlert.style.display = 'block';
            hudMissingList.innerHTML = '';
            state.missingFields.forEach(field => {
                const li = document.createElement('li');
                li.innerHTML = `<i class="fas fa-arrow-right"></i> ${formatFieldName(field)}`;
                hudMissingList.appendChild(li);
            });
        } else {
            hudMissingAlert.style.display = 'none';
        }

        // Advisory Record Match Alert
        if (state.decedentMatch && state.decedentMatch.found) {
            hudMatchCard.style.display = 'block';
            hudMatchText.textContent = `Matching record found in registry (${state.decedentMatch.count || 1} candidate). Administration will link existing cemetery files.`;
        } else {
            hudMatchCard.style.display = 'none';
        }

        // Review & Confirm step text
        if (state.status === 'AWAITING_CONFIRM' || state.status === 'COMMITTED') {
            hudReviewVal.textContent = 'Confirmed';
        } else if (state.isReadyForReview || (state.status === 'READY_FOR_REVIEW' && state.missingFields.length === 0)) {
            hudReviewVal.textContent = 'Ready';
        } else {
            hudReviewVal.textContent = 'Incomplete';
        }

        // Confirm Button Eligibility (Strict Server Gate)
        const isEligibleToConfirm = (state.status === 'READY_FOR_REVIEW' || state.isReadyForReview) && state.missingFields.length === 0;
        btnConfirmBooking.disabled = !isEligibleToConfirm || state.isLoading || state.status === 'AWAITING_CONFIRM';
        if (state.status === 'AWAITING_CONFIRM') {
            btnConfirmBooking.innerHTML = '<i class="fas fa-check-double"></i> Reservation Confirmed';
            btnConfirmBooking.style.background = '#047857';
        } else {
            btnConfirmBooking.innerHTML = '<i class="fas fa-check-circle"></i> Confirm Booking Reservation';
            btnConfirmBooking.style.background = '';
        }
    }

    /**
     * Stepper visual progress tracker
     */
    function updateStepper() {
        const stepService = document.getElementById('stepService');
        const stepDetails = document.getElementById('stepDetails');
        const stepAllocation = document.getElementById('stepAllocation');
        const stepConfirm = document.getElementById('stepConfirm');

        // Reset classes
        [stepService, stepDetails, stepAllocation, stepConfirm].forEach(el => {
            el.className = 'blueprint-step pending';
        });

        // Step 1: Service
        if (state.serviceType) {
            stepService.className = 'blueprint-step completed';
        } else {
            stepService.className = 'blueprint-step active';
            return;
        }

        // Step 2: Decedent Info
        const hasDetails = Boolean(state.extractedData.decedent_name);
        if (hasDetails) {
            stepDetails.className = 'blueprint-step completed';
        } else {
            stepDetails.className = 'blueprint-step active';
            return;
        }

        // Step 3: Allocation (Date + Lot/Columbarium)
        const isCremation = state.serviceType === 'cremation';
        const hasDate = Boolean(isCremation ? state.extractedData.cremation_date : state.extractedData.preferred_date);
        const hasLot = isCremation || Boolean(state.extractedData.lot_id);

        if (hasDate && hasLot) {
            stepAllocation.className = 'blueprint-step completed';
        } else {
            stepAllocation.className = 'blueprint-step active';
            return;
        }

        // Step 4: Review & Confirm
        if (state.status === 'AWAITING_CONFIRM' || state.status === 'COMMITTED') {
            stepConfirm.className = 'blueprint-step completed';
        } else {
            stepConfirm.className = 'blueprint-step active';
        }
    }

    /**
     * Dynamic Prompt Suggestion Chips based on server state
     */
    function renderPromptChips(customChips = null) {
        promptSuggestions.innerHTML = '';

        if (customChips && customChips.length > 0) {
            customChips.forEach(chip => {
                const btn = createChip(chip.text, chip.action);
                promptSuggestions.appendChild(btn);
            });
            return;
        }

        if (state.pendingAction && state.pendingAction.status === 'AWAITING_CONFIRMATION') {
            renderPendingActionChips(state.pendingAction);
            return;
        }

        const chips = [];

        if (state.status === 'COMMITTED' || state.status === 'AWAITING_CONFIRM') {
            chips.push({ text: '📋 View in My Bookings', action: () => { window.location.href = 'my-bookings.html'; } });
            chips.push({ text: '📄 View Booking Voucher', action: () => showVoucherInChat() });
            chips.push({ text: '🔄 Book Another Service', action: () => onRestartDraft() });
        } else if (state.status === 'READY_FOR_REVIEW' || (state.isReadyForReview && state.missingFields.length === 0)) {
            chips.push({ text: '✅ Confirm Reservation', action: () => onConfirmBooking() });
            chips.push({ text: '✏️ Change Date', action: () => openFieldEditor(state.serviceType === 'cremation' ? 'cremation_date' : 'preferred_date') });
            chips.push({ text: '✏️ Change Decedent Name', action: () => openFieldEditor('decedent_name') });
            if (state.serviceType === 'burial') {
                chips.push({ text: '🗺️ Change Burial Lot', action: () => openLotPicker() });
            }
        } else if (state.status === 'LOT_SELECTION' || (state.serviceType === 'burial' && !state.extractedData.lot_id)) {
            chips.push({ text: '🗺️ Browse Available Lots', action: () => openLotPicker() });
            chips.push({ text: '📅 In 3 weeks', action: () => sendQuickDate('+21 days') });
            chips.push({ text: '📅 Next month', action: () => sendQuickDate('+35 days') });
        } else if (state.missingFields.includes('decedent_name')) {
            chips.push({ text: '👤 For my father', action: () => sendQuickInput('The arrangement is for my father, ') });
            chips.push({ text: '👤 For my mother', action: () => sendQuickInput('The arrangement is for my mother, ') });
        } else if (state.missingFields.includes('preferred_date') || state.missingFields.includes('cremation_date')) {
            chips.push({ text: '📅 In 2 weeks', action: () => sendQuickDate('+14 days') });
            chips.push({ text: '📅 In 1 month', action: () => sendQuickDate('+30 days') });
        } else {
            chips.push({ text: 'ℹ️ What information is needed?', action: () => sendChatTurn('What information do you still need from me?') });
        }

        chips.forEach(chip => {
            const btn = createChip(chip.text, chip.action);
            promptSuggestions.appendChild(btn);
        });
    }

    function renderPendingActionChips(pendingAction) {
        promptSuggestions.innerHTML = '';
        const chips = [
            {
                text: '✅ Yes, Proceed',
                action: () => confirmPendingAction(pendingAction)
            },
            {
                text: '❌ No, Keep Booking',
                action: () => rejectPendingAction(pendingAction)
            }
        ];
        chips.forEach(chip => {
            const btn = createChip(chip.text, chip.action);
            btn.style.fontWeight = '600';
            promptSuggestions.appendChild(btn);
        });
    }

    function renderAvailabilityCard(avail) {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'chat-message assistant availability-card';
        let badgeClass = 'success';
        let badgeIcon = 'check-circle';
        let badgeText = 'Available';

        if (!avail.available) {
            if (avail.code === 'DATE_RESTRICTED_MONDAY' || avail.reason_code === 'DATE_RESTRICTED_MONDAY') {
                badgeClass = 'warning';
                badgeIcon = 'exclamation-triangle';
                badgeText = 'Monday Closure';
            } else if (avail.code === 'DATE_RESTRICTED_PAST' || avail.reason_code === 'DATE_RESTRICTED_PAST') {
                badgeClass = 'warning';
                badgeIcon = 'history';
                badgeText = 'Past Date';
            } else if (avail.code === 'CLARIFICATION_REQUIRED' || avail.reason_code === 'CLARIFICATION_REQUIRED') {
                badgeClass = 'warning';
                badgeIcon = 'question-circle';
                badgeText = 'Clarification Needed';
            } else {
                badgeClass = 'danger';
                badgeIcon = 'times-circle';
                badgeText = 'Slot Conflict';
            }
        }

        let detailsHtml = '';
        if (avail.date) detailsHtml += `<div><strong>Date:</strong> ${formatDateLabel(avail.date)}</div>`;
        if (avail.lot_number) detailsHtml += `<div><strong>Lot:</strong> ${avail.lot_number} (${avail.section_name || ''})</div>`;
        if (avail.service_type) detailsHtml += `<div><strong>Service:</strong> ${avail.service_type.toUpperCase()}</div>`;
        if (avail.available_lot_count !== undefined) detailsHtml += `<div><strong>Available Lots:</strong> ${avail.available_lot_count}</div>`;

        cardDiv.innerHTML = `
            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 12px; margin-top: 4px;">
                <div style="display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px;">
                    <span style="font-weight: 600; font-size: 0.95rem;"><i class="fas fa-calendar-check"></i> Availability Intelligence</span>
                    <span class="badge badge-${badgeClass}"><i class="fas fa-${badgeIcon}"></i> ${badgeText}</span>
                </div>
                <div style="font-size: 0.85rem; color: #cbd5e1; line-height: 1.5;">
                    ${detailsHtml}
                </div>
                <div style="margin-top: 6px; font-size: 0.75rem; color: #94a3b8; font-style: italic;">
                    Advisory query only — no reservation created.
                </div>
            </div>
        `;
        chatThread.appendChild(cardDiv);
        scrollChatToBottom();
    }

    function renderChecklistCard(checklist) {
        const cardDiv = document.createElement('div');
        cardDiv.className = 'chat-message assistant checklist-card';
        const fieldLabels = {
            decedent_name: 'Pangalan ng Yumao (Decedent Name)',
            relationship: 'Relasyon sa Yumao (Relationship)',
            preferred_date: 'Petsa ng Libing (Burial Date)',
            cremation_date: 'Petsa ng Cremation (Cremation Date)',
            lot_id: 'Napiling Burial Lot (Lot Selection)',
            service_type: 'Uri ng Serbisyo (Service Type)'
        };
        let compList = (checklist.completed || []).map(f => {
            const lbl = fieldLabels[f] || f.replace(/_/g, ' ');
            return `<div style="color: #4ade80; margin-bottom: 3px;"><i class="fas fa-check-circle"></i> ${lbl}</div>`;
        }).join('');
        let missList = (checklist.missing || []).map(f => {
            const lbl = fieldLabels[f] || f.replace(/_/g, ' ');
            return `<div style="color: #f87171; margin-bottom: 3px;"><i class="far fa-circle"></i> ${lbl}</div>`;
        }).join('');

        cardDiv.innerHTML = `
            <div style="background: rgba(255,255,255,0.05); border: 1px solid rgba(255,255,255,0.12); border-radius: 8px; padding: 12px; margin-top: 4px;">
                <div style="font-weight: 600; font-size: 0.95rem; margin-bottom: 8px;">
                    <i class="fas fa-tasks"></i> Booking Progress Checklist
                </div>
                <div style="font-size: 0.85rem; line-height: 1.5;">
                    ${compList}
                    ${missList}
                </div>
                ${checklist.next_recommended_step ? `<div style="margin-top: 8px; font-size: 0.85rem; color: #38bdf8;"><strong>Next Step:</strong> ${checklist.next_recommended_step.replace(/_/g, ' ')}</div>` : ''}
            </div>
        `;
        chatThread.appendChild(cardDiv);
        scrollChatToBottom();
    }

    async function confirmPendingAction(pendingAction) {
        if (!pendingAction || state.isLoading) return;
        setLoading(true);
        const typingEl = appendTypingIndicator();
        try {
            const res = await api.request(`booking-agent/pending-actions/${pendingAction.id}/confirm`, {
                method: 'POST',
                body: {
                    token: pendingAction.confirmation_token,
                    action_type: pendingAction.action_type,
                    booking_id: pendingAction.booking_id
                }
            });
            removeTypingIndicator(typingEl);
            if (res && res.success) {
                state.pendingAction = null;
                appendAssistantMessage(`✅ ${res.reply || 'Action confirmed and executed successfully.'}`);
                if (typeof showToast === 'function') showToast('Booking updated successfully!', 'success');
                updateBlueprintHUD();
                renderPromptChips();
            } else {
                appendAssistantMessage(`⚠️ ${res?.error || 'Could not execute the confirmed action.'}`);
                renderPromptChips();
            }
        } catch (err) {
            removeTypingIndicator(typingEl);
            appendAssistantMessage(`⚠️ Failed to confirm action: ${err?.message || 'Please try again.'}`);
            renderPromptChips();
        } finally {
            setLoading(false);
        }
    }

    async function rejectPendingAction(pendingAction) {
        if (!pendingAction || state.isLoading) return;
        setLoading(true);
        const typingEl = appendTypingIndicator();
        try {
            const res = await api.request(`booking-agent/pending-actions/${pendingAction.id}/reject`, {
                method: 'POST'
            });
            removeTypingIndicator(typingEl);
            state.pendingAction = null;
            appendAssistantMessage(`Action cancelled. Your booking remains unchanged.`);
            renderPromptChips();
        } catch (err) {
            removeTypingIndicator(typingEl);
            appendAssistantMessage(`⚠️ Failed to reject action: ${err?.message || 'Please try again.'}`);
            renderPromptChips();
        } finally {
            setLoading(false);
        }
    }

    function createChip(text, handler) {
        const span = document.createElement('span');
        span.className = 'prompt-chip';
        span.textContent = text;
        span.addEventListener('click', (e) => {
            if (state.isLoading) return;
            handler(e);
        });
        return span;
    }

    function sendQuickInput(prefix) {
        if (state.isLoading) return;
        userInputMsg.value = prefix;
        userInputMsg.focus();
        updateSendButtonState();
    }

    function sendQuickDate(relativeOffset) {
        if (state.isLoading) return;
        const target = computeFutureDate(relativeOffset);
        userInputMsg.value = `Preferred date: ${target}`;
        updateSendButtonState();
        onSendMessage();
    }

    function computeFutureDate(offsetStr) {
        const days = parseInt(offsetStr, 10) || 30;
        const d = new Date();
        d.setDate(d.getDate() + Math.abs(days));
        // Skip Mondays if burial
        if (state.serviceType === 'burial' && d.getDay() === 1) {
            d.setDate(d.getDate() + 1);
        }
        return d.toISOString().split('T')[0];
    }

    /**
     * Direct Field Correction via POST /api/booking-agent/drafts/{id}/update-field
     */
    async function updateDraftField(field, value) {
        if (!state.draftId) {
            appendAssistantMessage(`Please start a booking conversation first before updating fields.`);
            return;
        }

        setLoading(true);
        try {
            const res = await api.request(`booking-agent/drafts/${state.draftId}/update-field`, {
                method: 'POST',
                body: { field, value }
            });

            if (res && res.success) {
                applyAuthoritativeState(res);
                appendAssistantMessage(`Updated **${formatFieldName(field)}** to: **${escapeHtml(String(value))}**.`);
                renderPromptChips();
                if (typeof showToast === 'function') showToast('Field updated successfully', 'success');
            } else {
                appendAssistantMessage(res.error || 'Failed to update field.');
                if (typeof showToast === 'function') showToast(res.error || 'Failed to update field', 'error');
            }
        } catch (e) {
            appendAssistantMessage(`Error updating field: ${e.message}`);
        } finally {
            setLoading(false);
        }
    }

    /**
     * Lot Picker Modal Workflow
     */
    async function openLotPicker() {
        lastFocusedElementBeforeModal = (document.activeElement && typeof document.activeElement.focus === 'function') ? document.activeElement : null;
        document.body.style.overflow = 'hidden';
        lotPickerModal.style.display = 'flex';
        lotSearchFilter.value = '';
        lotPickerSpinner.style.display = 'block';
        lotGridContainer.innerHTML = '';
        lotPickerEmpty.style.display = 'none';
        if (lotSearchFilter) lotSearchFilter.focus();

        try {
            const res = await api.request('lots?status=Available', { method: 'GET' });
            lotPickerSpinner.style.display = 'none';

            state.availableLots = (res && Array.isArray(res.data)) ? res.data : (Array.isArray(res) ? res : []);
            populateSectionFilter(state.availableLots);
            filterLots();
        } catch (e) {
            lotPickerSpinner.style.display = 'none';
            lotPickerEmpty.style.display = 'block';
            lotPickerEmpty.querySelector('p').textContent = 'Could not load available lots: ' + e.message;
        }
    }

    function closeLotPicker() {
        lotPickerModal.style.display = 'none';
        document.body.style.overflow = '';
        if (lastFocusedElementBeforeModal && typeof lastFocusedElementBeforeModal.focus === 'function') {
            lastFocusedElementBeforeModal.focus();
        } else if (userInputMsg) {
            userInputMsg.focus();
        }
        lastFocusedElementBeforeModal = null;
    }

    function populateSectionFilter(lots) {
        lotSectionFilter.innerHTML = '<option value="">All Sections</option>';
        const sections = [...new Set(lots.map(l => l.section_name).filter(Boolean))];
        sections.sort().forEach(sec => {
            const opt = document.createElement('option');
            opt.value = sec;
            opt.textContent = sec;
            lotSectionFilter.appendChild(opt);
        });
    }

    function filterLots() {
        const query = (lotSearchFilter.value || '').toLowerCase().trim();
        const selectedSec = lotSectionFilter.value;

        state.filteredLots = state.availableLots.filter(lot => {
            const matchSearch = !query ||
                String(lot.lot_number || '').toLowerCase().includes(query) ||
                String(lot.block_name || '').toLowerCase().includes(query) ||
                String(lot.section_name || '').toLowerCase().includes(query) ||
                String(lot.lot_type_name || '').toLowerCase().includes(query);

            const matchSec = !selectedSec || lot.section_name === selectedSec;
            return matchSearch && matchSec;
        });

        renderLotGrid(state.filteredLots);
    }

    function renderLotGrid(lots) {
        lotGridContainer.innerHTML = '';

        if (!lots || lots.length === 0) {
            lotPickerEmpty.style.display = 'block';
            return;
        }
        lotPickerEmpty.style.display = 'none';

        lots.forEach(lot => {
            const card = document.createElement('div');
            const isSelected = state.extractedData.lot_id === lot.lot_id;
            card.className = 'lot-card-item' + (isSelected ? ' selected' : '');

            card.innerHTML = `
                <div>
                    <div style="display:flex;justify-content:space-between;align-items:flex-start;">
                        <h4 style="margin:0;font-size:1rem;color:#0f172a;font-weight:700;">Lot ${escapeHtml(lot.lot_number)}</h4>
                        <span class="meta-pill" style="background:#e0f2fe;color:#0369a1;font-size:0.72rem;">${escapeHtml(lot.lot_type_name || 'Standard')}</span>
                    </div>
                    <div style="font-size:0.82rem;color:#64748b;margin-top:4px;">
                        ${escapeHtml(lot.section_name || '')} • ${escapeHtml(lot.block_name || '')}
                    </div>
                    <div style="font-size:1.05rem;font-weight:800;color:#166534;margin-top:8px;">
                        ₱${Number(lot.price || 0).toLocaleString()}
                    </div>
                </div>
                <button type="button" class="select-lot-btn" style="margin-top:10px;">
                    ${isSelected ? '<i class="fas fa-check"></i> Selected' : '<i class="fas fa-check-circle"></i> Select This Lot'}
                </button>
            `;

            card.querySelector('button').addEventListener('click', async () => {
                closeLotPicker();
                await updateDraftField('lot_id', lot.lot_id);
            });

            lotGridContainer.appendChild(card);
        });
    }

    /**
     * Quick Field Editor Modal
     */
    function openFieldEditor(fieldName) {
        lastFocusedElementBeforeModal = (document.activeElement && typeof document.activeElement.focus === 'function') ? document.activeElement : null;
        activeEditField = fieldName;
        document.body.style.overflow = 'hidden';
        fieldEditModal.style.display = 'flex';

        const isDate = fieldName.includes('date');
        fieldEditTitle.textContent = `Update ${formatFieldName(fieldName)}`;
        fieldEditLabel.textContent = formatFieldName(fieldName);
        fieldEditInput.type = isDate ? 'date' : 'text';

        const curVal = state.extractedData[fieldName] || '';
        fieldEditInput.value = curVal;

        if (isDate) {
            fieldEditHint.textContent = 'Please choose a future date (Burials unavailable on Mondays).';
            const minDate = new Date();
            minDate.setDate(minDate.getDate() + 1);
            fieldEditInput.min = minDate.toISOString().split('T')[0];
        } else {
            fieldEditHint.textContent = 'Enter the revised information accurately.';
            fieldEditInput.removeAttribute('min');
        }

        fieldEditInput.focus();
    }

    function closeFieldEditor() {
        fieldEditModal.style.display = 'none';
        document.body.style.overflow = '';
        activeEditField = null;
        if (lastFocusedElementBeforeModal && typeof lastFocusedElementBeforeModal.focus === 'function') {
            lastFocusedElementBeforeModal.focus();
        } else if (userInputMsg) {
            userInputMsg.focus();
        }
        lastFocusedElementBeforeModal = null;
    }

    async function onSubmitFieldEdit(e) {
        e.preventDefault();
        const newVal = fieldEditInput.value.trim();
        if (!newVal || !activeEditField) return;

        const field = activeEditField;
        closeFieldEditor();
        await updateDraftField(field, newVal);
    }

    /**
     * Confirmation Workflow via POST /api/booking-agent/drafts/{id}/confirm
     */
    async function onConfirmBooking() {
        if (!state.draftId) return;

        if (!confirm('Are you ready to finalize and submit your booking reservation?')) {
            return;
        }

        setLoading(true);
        btnConfirmBooking.disabled = true;
        btnConfirmBooking.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Finalizing...';

        try {
            const res = await api.request(`booking-agent/drafts/${state.draftId}/confirm`, {
                method: 'POST',
                body: { finalize: true }
            });

            if (res && res.success) {
                state.status = res.status || 'COMMITTED';
                state.committedRecordId = res.committed_record_id || res.cremation_id || res.schedule_id || null;
                updateBlueprintHUD();
                showVoucherInChat();
                const serviceLabel = state.serviceType === 'cremation' ? 'Cremation' : 'Burial';
                const successMsg = state.committedRecordId
                    ? `${serviceLabel} scheduled successfully! Reference ID #${state.committedRecordId}`
                    : 'Reservation draft confirmed!';
                if (typeof showToast === 'function') showToast(successMsg, 'success');

                if (res.checkout_url) {
                    if (typeof showToast === 'function') {
                        showToast('Secure checkout is ready. Redirecting to PayMongo...', 'info');
                    }
                    window.location.assign(res.checkout_url);
                    return;
                }
            } else {
                appendAssistantMessage(res.error || 'Failed to confirm reservation.');
                if (typeof showToast === 'function') showToast(res.error || 'Failed to confirm', 'error');
            }
        } catch (e) {
            appendAssistantMessage(`Error confirming booking: ${e.message}`);
        } finally {
            setLoading(false);
            updateBlueprintHUD();
            renderPromptChips();
        }
    }

    /**
     * Display a Digital Reservation Voucher in the chat stream
     */
    function showVoucherInChat() {
        const isCremation = state.serviceType === 'cremation';
        const dateVal = isCremation ? state.extractedData.cremation_date : state.extractedData.preferred_date;
        const refPrefix = isCremation ? 'Cremation #' : 'Schedule #';
        const scheduleRef = state.committedRecordId ? `${refPrefix}${state.committedRecordId}` : `Draft #${state.draftId}`;
        const isCommitted = state.status === 'COMMITTED';

        const voucherHtml = `
            <div class="reservation-voucher" style="background:#ffffff;border:2px solid #2c5e47;border-radius:14px;padding:18px;margin:8px 0;">
                <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1.5px dashed #cbd5e1;padding-bottom:12px;margin-bottom:12px;">
                    <div>
                        <span style="font-size:0.75rem;font-weight:700;color:#2c5e47;text-transform:uppercase;">Official Booking Voucher</span>
                        <h3 style="margin:2px 0 0 0;font-size:1.15rem;color:#0f172a;">${scheduleRef}</h3>
                    </div>
                    <span class="score-badge" style="background:#ecfdf5;color:#047857;border:1px solid #a7f3d0;padding:4px 10px;font-size:0.8rem;">
                        <i class="fas fa-${isCommitted ? 'check-double' : 'clock'}"></i> ${isCommitted ? 'Pending Admin Review' : 'Awaiting Review'}
                    </span>
                </div>
                <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;font-size:0.85rem;">
                    <div>
                        <span style="color:#64748b;font-size:0.75rem;display:block;">Service Type</span>
                        <strong style="color:#0f172a;">${isCremation ? 'Cremation Service' : 'Burial Service'}</strong>
                    </div>
                    <div>
                        <span style="color:#64748b;font-size:0.75rem;display:block;">Scheduled Date</span>
                        <strong style="color:#0f172a;">${formatDate(dateVal)}</strong>
                    </div>
                    <div>
                        <span style="color:#64748b;font-size:0.75rem;display:block;">Decedent Name</span>
                        <strong style="color:#0f172a;">${escapeHtml(state.extractedData.decedent_name || 'N/A')}</strong>
                    </div>
                    <div>
                        <span style="color:#64748b;font-size:0.75rem;display:block;">${isCremation ? 'Columbarium' : 'Burial Lot'}</span>
                        <strong style="color:#0f172a;">${isCremation ? (escapeHtml(state.extractedData.preferred_columbarium || 'Assigned on arrival')) : (state.selectedLotDetails ? `Lot ${escapeHtml(state.selectedLotDetails.lot_number)} (${escapeHtml(state.selectedLotDetails.section_name)})` : `Lot #${state.extractedData.lot_id}`)}</strong>
                    </div>
                </div>
                <div style="margin-top:14px;padding-top:12px;border-top:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
                    <span style="font-size:0.78rem;color:#64748b;line-height:1.4;">
                        <i class="fas fa-shield-alt text-success"></i> Your booking details are recorded in our official scheduling system. Administrative staff will verify documents and review your schedule.
                    </span>
                    <div style="display:flex;gap:8px;">
                        <button type="button" onclick="window.print()" style="padding:6px 12px;font-size:0.8rem;background:#f8fafc;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;color:#334155;display:inline-flex;align-items:center;gap:4px;"><i class="fas fa-print"></i> Print</button>
                        <a href="my-bookings.html" style="padding:6px 14px;font-size:0.8rem;background:#2c5e47;color:#ffffff;border-radius:6px;text-decoration:none;font-weight:600;display:inline-flex;align-items:center;gap:4px;"><i class="fas fa-calendar-check"></i> My Bookings &rarr;</a>
                    </div>
                </div>
            </div>
        `;

        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message assistant chat-message--rich';
        msgDiv.innerHTML = voucherHtml;
        chatThread.appendChild(msgDiv);
        scrollChatToBottom();
    }

    /**
     * Restart / Cancel current draft session
     */
    async function onRestartDraft() {
        if (!confirm('Are you sure you want to discard your current booking progress and start a fresh session?')) {
            return;
        }

        if (cooldownTimer) {
            clearInterval(cooldownTimer);
            cooldownTimer = null;
        }
        isCooldownActive = false;

        if (state.draftId) {
            try {
                await api.request(`booking-agent/drafts/${state.draftId}/cancel`, { method: 'POST' });
            } catch (e) {
                console.warn('Could not cleanly cancel draft on server:', e);
            }
        }

        // Reset local state
        state.draftId = null;
        state.serviceType = null;
        state.status = 'INTAKE';
        state.extractedData = {};
        state.missingFields = [];
        state.isReadyForReview = false;
        state.decedentMatch = null;
        state.selectedLotDetails = null;

        renderIntakeGreeting();
    }

    /**
     * Chat Stream Rendering Helpers
     */
    function appendUserMessage(text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message user';
        msgDiv.textContent = text;
        chatThread.appendChild(msgDiv);
        scrollChatToBottom();
    }

    function appendAssistantMessage(text) {
        const msgDiv = document.createElement('div');
        msgDiv.className = 'chat-message assistant';
        msgDiv.innerHTML = formatMarkdown(text);
        chatThread.appendChild(msgDiv);
        scrollChatToBottom();
    }

    function appendTypingIndicator() {
        const typingDiv = document.createElement('div');
        typingDiv.className = 'chat-message assistant chat-typing-indicator';
        typingDiv.innerHTML = '<span>•</span><span>•</span><span>•</span>';
        chatThread.appendChild(typingDiv);
        scrollChatToBottom();
        return typingDiv;
    }

    function removeTypingIndicator(el) {
        if (el && el.parentNode) {
            el.parentNode.removeChild(el);
        }
    }

    function scrollChatToBottom() {
        chatThread.scrollTop = chatThread.scrollHeight;
    }

    function setLoading(loading) {
        state.isLoading = loading;
        if (btnSendMessage) {
            btnSendMessage.disabled = loading;
            if (loading) {
                btnSendMessage.innerHTML = '<i class="fas fa-spinner fa-spin"></i>';
            } else {
                btnSendMessage.innerHTML = '<i class="fas fa-paper-plane"></i>';
            }
        }
        if (!loading) {
            updateSendButtonState();
        }
    }

    /**
     * Formatters and Utilities
     */
    function formatStatusLabel(status) {
        const map = {
            'INTAKE': 'Getting Started',
            'DRAFT_STARTED': 'In Progress',
            'COLLECTING_INFO': 'Gathering Details',
            'LOT_SELECTION': 'Selecting Lot',
            'CREMATION_PREFS': 'Cremation Preferences',
            'READY_FOR_REVIEW': 'Ready to Confirm',
            'AWAITING_CONFIRM': 'Pending Final Submission',
            'COMMITTED': 'Submitted (Pending Review)',
            'CANCELLED': 'Cancelled',
            'EXPIRED': 'Expired'
        };
        return map[status] || status || 'Getting Started';
    }

    function formatFieldName(fieldName) {
        const map = {
            'decedent_name': 'Decedent Full Name',
            'relationship': 'Relationship to Decedent',
            'preferred_date': 'Preferred Burial Date',
            'cremation_date': 'Preferred Cremation Date',
            'lot_id': 'Burial Lot Selection',
            'preferred_columbarium': 'Columbarium Preference',
            'service_type': 'Service Type'
        };
        return map[fieldName] || fieldName.replace(/_/g, ' ');
    }

    function formatDate(dateStr) {
        if (!dateStr) return 'Pending';
        try {
            const parts = dateStr.split('-');
            if (parts.length === 3) {
                const date = new Date(parts[0], parts[1] - 1, parts[2]);
                return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
            }
            return dateStr;
        } catch {
            return dateStr;
        }
    }

    function formatTime(timeStr) {
        if (!timeStr) return '';
        try {
            const parts = timeStr.split(':');
            if (parts.length >= 2) {
                let hours = parseInt(parts[0], 10);
                const minutes = parts[1];
                const ampm = hours >= 12 ? 'PM' : 'AM';
                hours = hours % 12;
                hours = hours ? hours : 12;
                return `${hours}:${minutes} ${ampm}`;
            }
            return timeStr;
        } catch {
            return timeStr;
        }
    }

    function escapeHtml(str) {
        if (!str) return '';
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatMarkdown(text) {
        if (!text) return '';
        let escaped = escapeHtml(text);
        // bold
        escaped = escaped.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>');
        // italic
        escaped = escaped.replace(/\*(.*?)\*/g, '<em>$1</em>');
        // line breaks
        escaped = escaped.replace(/\n\n/g, '<br><br>').replace(/\n/g, '<br>');
        return escaped;
    }

    // Auto-init on DOMContentLoaded
    document.addEventListener('DOMContentLoaded', init);
})();
