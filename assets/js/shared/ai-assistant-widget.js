// System-Wide AI Assistant — shared, reusable chat widget.
// One backend brain (ai/assistant-ask), dropped into any admin page via
// initAiAssistant({ mountSelector, context, greeting, suggestions }).
// context picks which fact bundle the backend narrates from:
//   { scope: 'entity', entity_type, entity_id } — focus: one record
//   { scope: 'module', module }                 — focus: one module's recent state
//   { scope: 'system' }                          — focus: the whole system
// AI Architecture Audit (2026-09-02) finding, corrected here: only
// scope==='system' calls also carry the full system-wide reach (see
// AuditIntelligenceService::buildSystemWideReach() and
// AiController::askAssistant()) — a quota-reduction change (Batch 3)
// restricted this from "every call" to "system scope only" without every
// mounting page's own comment being updated to match. A module/entity-scoped
// instance answers strictly from its own focus today; a cross-module
// question gets "I don't have visibility into that" until BATCH AI-2 (a
// tiered focus-then-escalate fetch) ships. See that audit's "Root Cause
// Analysis" section for the full trace.
//
// AI ARCHITECTURE NOTE — two independent systems, not one: this widget
// (ai/assistant-ask, admin/staff only, read-only explain-and-suggest over
// AuditIntelligenceService facts) is structurally separate from the Burial
// Scheduling booking agent in shared/lot-chat-assistant.js (deterministic
// slot-filling + ai/chat's admin-curated-FAQ-only Q&A, admin/staff/user).
// They share the same Flask/Gemini process underneath but no context, no
// conversation state, and no code path between them. Do not assume mounting
// this widget on a Burial Scheduling page gives it any awareness of an
// in-progress booking, or vice versa.
// Renders as a fixed slide-in drawer with a blurred backdrop, matching the
// reference chat-assistant design the user provided (header + avatar +
// greeting, quick-suggestion chips, timestamped bubbles, input bar with a
// disclaimer) — deliberately NOT the rest of that reference mockup (its
// sidebar/dashboard layout), just the assistant panel itself.
// Load this after shared/api.js and before a page's own script, same
// convention as button-loading.js/pagination.js.
//
// Module-scope (not per-instance) counter: a page can have two independent
// instances open at once — the page-level #aiAssistantMount (always a
// fixed bottom-right bubble, see ai-assistant-widget.css) and a per-record
// #aiAssistantMountRecord mounted inline inside a modal. Opening the
// record instance used to leave the page-level bubble sitting on top of
// it (both fixed to the same corner), covering the record panel's own
// send button. A plain boolean would misbehave if one instance closes
// while the other is still open, so this counts actually-open panels
// instead, and the CSS hides the page-level bubble whenever the count is
// nonzero (see body.ai-assistant-any-panel-open in ai-assistant-widget.css).
let openAiAssistantPanelCount = 0;

function initAiAssistant({ mountSelector, context, greeting, suggestions = [], onAnswer }) {
    const mount = document.querySelector(mountSelector);
    if (!mount) return null;

    let conversationHistory = [];
    let open = false;
    let busy = false;
    let hasMessages = false;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[char]));
    }

    function formatTime(date) {
        return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    }

    const defaultGreeting = "Hello! I'm your AI assistant. How can I help you today?";

    // One shared backdrop+panel per mount, injected fresh each call (a page
    // like Cremation Management re-inits this per record viewed) — any
    // previous panel for this mount is simply replaced. If that previous
    // panel was left open, its own setOpen(false) will never run (its DOM
    // is being discarded right here), which would otherwise leak
    // openAiAssistantPanelCount upward forever across repeated
    // view-a-different-record cycles — account for it before replacing.
    if (mount.querySelector('.ai-assistant-toggle.is-open')) {
        openAiAssistantPanelCount = Math.max(0, openAiAssistantPanelCount - 1);
        document.body.classList.toggle('ai-assistant-any-panel-open', openAiAssistantPanelCount > 0);
    }

    mount.classList.add('ai-assistant-mount');
    mount.innerHTML = `
        <button type="button" class="ai-assistant-toggle" aria-label="Ask AI">
            <i class="fas fa-robot"></i>
        </button>
        <div class="ai-assistant-backdrop"></div>
        <div class="ai-assistant-panel" role="dialog" aria-label="AI Assistant">
            <div class="ai-assistant-header">
                <div class="ai-assistant-header-top">
                    <span class="ai-assistant-title"><i class="fas fa-wand-magic-sparkles"></i> AI Assistant</span>
                    <button type="button" class="ai-assistant-close" aria-label="Close">&times;</button>
                </div>
                <div class="ai-assistant-greeting">
                    <div class="ai-assistant-avatar"><i class="fas fa-robot"></i></div>
                    <p>${escapeHtml(greeting || defaultGreeting)}</p>
                </div>
            </div>
            ${suggestions.length ? `
                <div class="ai-assistant-suggestions">
                    ${suggestions.map((s, i) => `
                        <button type="button" class="ai-assistant-suggestion-chip" data-suggestion-index="${i}">
                            <i class="fas ${escapeHtml(s.icon || 'fa-circle-question')}"></i> ${escapeHtml(s.label)}
                        </button>
                    `).join('')}
                </div>
            ` : ''}
            <div class="ai-assistant-messages"></div>
            <form class="ai-assistant-input-row">
                <input type="text" class="ai-assistant-input" placeholder="Type your message…" autocomplete="off" />
                <button type="submit" class="ai-assistant-send" aria-label="Send"><i class="fas fa-paper-plane"></i></button>
            </form>
            <p class="ai-assistant-disclaimer">AI responses may not be 100% accurate.</p>
        </div>
    `;

    const toggleBtn = mount.querySelector('.ai-assistant-toggle');
    const backdrop = mount.querySelector('.ai-assistant-backdrop');
    const panel = mount.querySelector('.ai-assistant-panel');
    const closeBtn = mount.querySelector('.ai-assistant-close');
    const greetingEl = mount.querySelector('.ai-assistant-greeting');
    const suggestionsEl = mount.querySelector('.ai-assistant-suggestions');
    const messagesEl = mount.querySelector('.ai-assistant-messages');
    const form = mount.querySelector('.ai-assistant-input-row');
    const input = mount.querySelector('.ai-assistant-input');

    function setOpen(next) {
        if (next === open) return;
        open = next;
        panel.classList.toggle('is-open', open);
        backdrop.classList.toggle('is-open', open);
        toggleBtn.classList.toggle('is-open', open);
        if (open) input.focus();

        openAiAssistantPanelCount += open ? 1 : -1;
        document.body.classList.toggle('ai-assistant-any-panel-open', openAiAssistantPanelCount > 0);
    }

    toggleBtn.addEventListener('click', () => setOpen(!open));
    closeBtn.addEventListener('click', () => setOpen(false));
    backdrop.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (event) => {
        if (open && event.key === 'Escape') setOpen(false);
    });

    // Once a real conversation starts, the greeting/avatar block and the
    // suggestion chips give up their space to the actual chat history —
    // matches the reference design's empty-state use of that space, without
    // permanently crowding a fixed-height drawer once it's in real use.
    function collapseIntro() {
        if (hasMessages) return;
        hasMessages = true;
        if (greetingEl) greetingEl.style.display = 'none';
        if (suggestionsEl) suggestionsEl.style.display = 'none';
    }

    function appendMessage(role, text, suggestedAction) {
        const time = formatTime(new Date());
        const row = document.createElement('div');
        row.className = `ai-assistant-msg-row ai-assistant-msg-row--${role}`;
        if (role === 'ai') {
            row.innerHTML = `
                <div class="ai-assistant-avatar-sm"><i class="fas fa-robot"></i></div>
                <div class="ai-assistant-msg-col">
                    <div class="ai-assistant-msg ai-assistant-msg--ai"></div>
                    <span class="ai-assistant-msg-time">${escapeHtml(time)}</span>
                </div>
            `;
        } else {
            row.innerHTML = `
                <div class="ai-assistant-msg-col">
                    <div class="ai-assistant-msg ai-assistant-msg--user"></div>
                    <span class="ai-assistant-msg-time">${escapeHtml(time)} <i class="fas fa-check"></i></span>
                </div>
            `;
        }
        row.querySelector('.ai-assistant-msg').textContent = text;
        messagesEl.appendChild(row);

        if (suggestedAction) {
            const sugRow = document.createElement('div');
            sugRow.className = 'ai-assistant-suggestion-callout';
            sugRow.innerHTML = `<i class="fas fa-lightbulb"></i> <span></span>`;
            sugRow.querySelector('span').textContent = suggestedAction;
            messagesEl.appendChild(sugRow);
        }

        messagesEl.scrollTop = messagesEl.scrollHeight;
        return row;
    }

    async function ask(question) {
        const trimmed = (question || '').trim();
        if (busy || !trimmed) return;
        busy = true;
        // Batch 10 (Batch 9 audit finding): busy/input-disabled used to be
        // reset only in a finally attached to the network try block below
        // — a thrown error in the synchronous setup between busy=true and
        // that try (DOM lookups/mutations) would have left the widget
        // permanently disabled with no way to send another message short
        // of a page reload. Wrapping the whole body in this outer
        // try/finally instead means busy/input state always recovers no
        // matter where a failure happens.
        try {
            collapseIntro();
            appendMessage('user', trimmed);
            input.value = '';
            input.disabled = true;

            const loadingRow = document.createElement('div');
            loadingRow.className = 'ai-assistant-msg-row ai-assistant-msg-row--ai';
            loadingRow.innerHTML = `
                <div class="ai-assistant-avatar-sm"><i class="fas fa-robot"></i></div>
                <div class="ai-assistant-msg-col">
                    <div class="ai-assistant-msg ai-assistant-msg--ai ai-assistant-msg--loading">Thinking…</div>
                </div>
            `;
            messagesEl.appendChild(loadingRow);
            messagesEl.scrollTop = messagesEl.scrollHeight;

            // Batch 10 (Batch 9 audit finding): no request timeout existed
            // on this fetch — a genuinely hung connection could leave
            // "Thinking…" showing indefinitely. The backend's own
            // worst-case sequential Gemini+Groq chain is bounded by PHP's
            // own ~30s curl timeout to the Python service; 35s here gives
            // that a small margin so this abort never races ahead of a
            // legitimately-still-processing backend response — it only
            // fires for a request the backend's own safety nets never got
            // a chance to resolve. api.js's request() already spreads
            // arbitrary fetch options through (including `signal`), so no
            // change to api.js or the request payload shape is needed.
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), 35000);

            try {
                const result = await api.request('ai/assistant-ask', {
                    method: 'POST',
                    body: {
                        context,
                        question: trimmed,
                        // Last 5 exchanges only — enough for a real follow-up
                        // without growing the payload unbounded.
                        conversation_history: conversationHistory.slice(-5),
                    },
                    signal: controller.signal,
                });
                loadingRow.remove();
                if (result && result.answered && result.message) {
                    appendMessage('ai', result.message, result.suggested_action);
                    conversationHistory.push({ question: trimmed, message: result.message });
                    if (typeof onAnswer === 'function') {
                        onAnswer(result.message, result.suggested_action);
                    }
                } else {
                    appendMessage('ai', "I couldn't find enough information to answer that.");
                }
            } catch (error) {
                loadingRow.remove();
                appendMessage('ai', 'AI is unavailable right now — please try again in a moment.');
            } finally {
                clearTimeout(timeoutId);
            }
        } finally {
            input.disabled = false;
            input.focus();
            busy = false;
        }
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        ask(input.value);
    });

    if (suggestionsEl) {
        suggestionsEl.querySelectorAll('.ai-assistant-suggestion-chip').forEach((chip) => {
            chip.addEventListener('click', () => {
                const s = suggestions[Number(chip.dataset.suggestionIndex)];
                if (s) ask(s.question || s.label);
            });
        });
    }

    return {
        // Opens the panel without asking anything.
        open: () => setOpen(true),
        // Opens the panel AND immediately asks — used to replace the old
        // single-shot "Ask AI to explain" buttons so existing muscle memory
        // (click, get an explanation) still works, it just now also
        // supports a real follow-up conversation.
        askDirectly: (question) => {
            setOpen(true);
            ask(question);
        },
    };
}
