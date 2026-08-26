// System-Wide AI Assistant — shared, reusable chat widget (Phase 2).
// One backend brain (ai/assistant-ask), dropped into any admin page via
// initAiAssistant({ mountSelector, context }). context picks which fact
// bundle the backend narrates from:
//   { scope: 'entity', entity_type, entity_id } — one record
//   { scope: 'module', module }                 — one module's recent state
//   { scope: 'system' }                          — the whole system
// Load this after shared/api.js and before a page's own script, same
// convention as button-loading.js/pagination.js.
function initAiAssistant({ mountSelector, context, label = 'Ask AI' }) {
    const mount = document.querySelector(mountSelector);
    if (!mount) return null;

    let conversationHistory = [];
    let open = false;
    let busy = false;

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
        }[char]));
    }

    mount.classList.add('ai-assistant-mount');
    mount.innerHTML = `
        <button type="button" class="ai-assistant-toggle">
            <i class="fas fa-robot"></i> <span>${escapeHtml(label)}</span>
        </button>
        <div class="ai-assistant-panel" style="display:none;">
            <div class="ai-assistant-header">
                <span><i class="fas fa-robot"></i> AI Assistant</span>
                <button type="button" class="ai-assistant-close" aria-label="Close">&times;</button>
            </div>
            <div class="ai-assistant-messages"></div>
            <form class="ai-assistant-input-row">
                <input type="text" class="ai-assistant-input" placeholder="Ask a question…" autocomplete="off" />
                <button type="submit" class="ai-assistant-send" aria-label="Send"><i class="fas fa-paper-plane"></i></button>
            </form>
        </div>
    `;

    const toggleBtn = mount.querySelector('.ai-assistant-toggle');
    const panel = mount.querySelector('.ai-assistant-panel');
    const closeBtn = mount.querySelector('.ai-assistant-close');
    const messagesEl = mount.querySelector('.ai-assistant-messages');
    const form = mount.querySelector('.ai-assistant-input-row');
    const input = mount.querySelector('.ai-assistant-input');

    function setOpen(next) {
        open = next;
        panel.style.display = open ? 'flex' : 'none';
        toggleBtn.classList.toggle('is-open', open);
        if (open) input.focus();
    }

    toggleBtn.addEventListener('click', () => setOpen(!open));
    closeBtn.addEventListener('click', () => setOpen(false));

    function appendMessage(role, text, suggestedAction) {
        const el = document.createElement('div');
        el.className = `ai-assistant-msg ai-assistant-msg--${role}`;
        el.textContent = text;
        messagesEl.appendChild(el);
        if (suggestedAction) {
            const sugEl = document.createElement('div');
            sugEl.className = 'ai-assistant-suggestion';
            sugEl.innerHTML = `<i class="fas fa-lightbulb"></i> ${escapeHtml(suggestedAction)}`;
            messagesEl.appendChild(sugEl);
        }
        messagesEl.scrollTop = messagesEl.scrollHeight;
        return el;
    }

    async function ask(question) {
        const trimmed = (question || '').trim();
        if (busy || !trimmed) return;
        busy = true;
        appendMessage('user', trimmed);
        input.value = '';
        input.disabled = true;

        const loadingEl = document.createElement('div');
        loadingEl.className = 'ai-assistant-msg ai-assistant-msg--ai ai-assistant-msg--loading';
        loadingEl.textContent = 'Thinking…';
        messagesEl.appendChild(loadingEl);
        messagesEl.scrollTop = messagesEl.scrollHeight;

        try {
            const result = await api.request('ai/assistant-ask', {
                method: 'POST',
                body: {
                    context,
                    question: trimmed,
                    // Last 5 exchanges only — enough for a real follow-up
                    // ("what about the other one?") without growing the
                    // payload unbounded across a long session.
                    conversation_history: conversationHistory.slice(-5),
                },
            });
            loadingEl.remove();
            if (result && result.answered && result.message) {
                appendMessage('ai', result.message, result.suggested_action);
                conversationHistory.push({ question: trimmed, message: result.message });
            } else {
                appendMessage('ai', "I couldn't find enough information to answer that.");
            }
        } catch (error) {
            loadingEl.remove();
            appendMessage('ai', 'AI is unavailable right now — please try again in a moment.');
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

    return {
        // Opens the panel without asking anything — used when a page just
        // wants to reveal the assistant (e.g. a header "Ask AI" button).
        open: () => setOpen(true),
        // Opens the panel AND immediately asks — used to replace the old
        // single-shot "Ask AI to explain" buttons (Phase 4) so existing
        // muscle memory (click, get an explanation) still works, it just
        // now also supports a real follow-up conversation.
        askDirectly: (question) => {
            setOpen(true);
            ask(question);
        },
    };
}
