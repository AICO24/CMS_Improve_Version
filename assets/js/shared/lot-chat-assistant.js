// Shared burial-lot chat assistant (Phase 6).
// Extracted from burial-scheduling.js's Phase 2-5 work so both the
// admin/staff wizard (burial-scheduling.js) and the citizen wizard
// (reserve-burial-slot.js) drive the exact same conversation logic
// instead of maintaining two forks. Load this after shared/api.js and
// before a page's own script.
//
// Phase 2: deterministic slot-filling only (no LLM, no free-form NLP).
// Extracted values are always validated against the live lotTypes/sections
// lists the caller supplies, never accepted as raw user text.
// Phase 3: deterministic outcome text, purely reporting what the caller's
// recommendation fetch actually did.
// Phase 4: optional LLM narrator (POST ai/narrate) that rephrases the same
// Phase 3 facts. Never ranks/scores/supplies new facts. Falls back to the
// Phase 3 text on any failure.
// Phase 5: capacity-aware date advisory (GET ai/forecast), advisory only —
// never blocks a search, silently shows nothing on failure or when the
// date has no matching forecast entry.
//
// createLotChatAssistant(options) -> assistant
//   options.chatWindow, chatForm, chatInput, chatFindLotsBtn, chatPrefStatus:
//     the DOM elements (same markup/IDs used by burial-scheduling.html).
//   options.getLotTypes(), options.getSections(): return the live lookup
//     arrays ({type_name}/{section_name} objects) at call time.
//   options.onReady(isReady): optional, called whenever readiness changes
//     (assistant already disables/enables chatFindLotsBtn itself; use this
//     only if the page needs to react further).
//
// assistant.init(): greets the user and asks the first question.
// assistant.state: { lot_type, budget, section } — null until captured,
//   '' means "explicitly no preference".
// assistant.isReady(): true once all three slots are captured/skipped.
// assistant.getPreferences(): { lot_type, budget, section } shaped for
//   schedules/recommend (null/'' become '').
// assistant.appendMessage(role, text): manual chat bubble (role: 'assistant'|'user').
// assistant.appendOutcomeMessage(outcome): Phase 3/4 — outcome is
//   { status: 'success'|'empty'|'error', count? }.
// assistant.appendCapacityWarning(dateStr): Phase 5.
function createLotChatAssistant(options) {
    const {
        chatWindow,
        chatForm,
        chatInput,
        chatFindLotsBtn,
        chatPrefStatus,
        getLotTypes,
        getSections,
        onReady,
    } = options;

    const CHAT_SKIP_PHRASES = ['any', 'anything', 'no preference', 'not sure', "doesn't matter", 'does not matter', 'skip', "i don't know", 'idk', 'n/a', 'none', 'whatever'];

    const state = { lot_type: null, budget: null, section: null };

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
        const names = (list || []).map(item => item[key]).filter(Boolean);
        return names.length ? names.join(', ') : 'none configured yet';
    }

    function formatBudget(value) {
        return `₱${Number(value).toLocaleString()}`;
    }

    function extractLotTypeFromText(text) {
        const lower = text.toLowerCase();
        for (const type of getLotTypes()) {
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
        const sections = getSections();
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

    function getNextMissingSlot() {
        if (state.lot_type === null) return 'lot_type';
        if (state.budget === null) return 'budget';
        if (state.section === null) return 'section';
        return null;
    }

    function questionForSlot(slot) {
        if (slot === 'lot_type') {
            return `What lot type are you looking for? Available options: ${describeOptions(getLotTypes(), 'type_name')}.`;
        }
        if (slot === 'budget') {
            return 'What is your preferred budget? (e.g., 8000, 8,000, ₱8,000, or 8k)';
        }
        if (slot === 'section') {
            return `Do you have a preferred section? Available options: ${describeOptions(getSections(), 'section_name')}.`;
        }
        return null;
    }

    function appendMessage(role, text) {
        const bubble = document.createElement('div');
        bubble.className = `chat-message ${role}`;
        bubble.textContent = text;
        chatWindow.appendChild(bubble);
        chatWindow.scrollTop = chatWindow.scrollHeight;
    }

    function updateChips() {
        Object.keys(state).forEach(field => {
            const chip = chatPrefStatus.querySelector(`[data-field="${field}"]`);
            if (!chip) return;
            const strong = chip.querySelector('strong');
            const value = state[field];
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

    function updateFindButtonState() {
        const ready = state.lot_type !== null && state.budget !== null && state.section !== null;
        chatFindLotsBtn.disabled = !ready;
        if (typeof onReady === 'function') onReady(ready);
    }

    function processMessage(rawText) {
        const text = rawText.trim();
        if (!text) return;

        appendMessage('user', text);

        const pendingSlot = getNextMissingSlot();
        const updates = {};

        if (state.lot_type === null) {
            const lotType = extractLotTypeFromText(text);
            if (lotType) updates.lot_type = lotType;
        }
        if (state.section === null) {
            const section = extractSectionFromText(text);
            if (section) updates.section = section;
        }
        if (state.budget === null) {
            const budget = extractBudgetFromText(text);
            if (budget !== null) updates.budget = budget;
        }

        // Only treat the message as an explicit "skip" for the currently
        // pending slot, and only when nothing else was recognized in it —
        // avoids misreading unrelated text as a skip.
        if (pendingSlot && updates[pendingSlot] === undefined && Object.keys(updates).length === 0 && isChatSkipMessage(text)) {
            updates[pendingSlot] = '';
        }

        Object.keys(updates).forEach(field => { state[field] = updates[field]; });
        updateChips();

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
            appendMessage('assistant', acknowledgements.join(' '));
        } else if (pendingSlot === 'lot_type') {
            appendMessage('assistant', `I couldn't match that to an available lot type. Available options: ${describeOptions(getLotTypes(), 'type_name')}. You can also say "no preference".`);
        } else if (pendingSlot === 'budget') {
            appendMessage('assistant', containsDigits(text)
                ? "I couldn't read a budget from that. Try formats like 8000, 8,000, ₱8,000, or 8k. You can also say \"no preference\"."
                : 'Could you share a budget? For example: 8000 or ₱8,000. You can also say "no preference".');
        } else if (pendingSlot === 'section') {
            appendMessage('assistant', `I couldn't match that to an available section. Available options: ${describeOptions(getSections(), 'section_name')}. You can also say "no preference".`);
        }

        const nextSlot = getNextMissingSlot();
        if (nextSlot) {
            appendMessage('assistant', questionForSlot(nextSlot));
        } else {
            appendMessage('assistant', 'Thanks! I have enough information to search for matching lots.');
        }

        updateFindButtonState();
    }

    function init() {
        chatInput.disabled = false;
        chatForm.querySelector('.chat-send-btn').disabled = false;
        const lotTypes = getLotTypes();
        const sections = getSections();
        appendMessage('assistant', `Hi! Tell me what you're looking for and I'll help find a lot — for example, "I'd like a ${lotTypes[0] ? lotTypes[0].type_name : 'Premium Lot'} around 8000 in ${sections[0] ? sections[0].section_name : 'Section A'}".`);
        appendMessage('assistant', questionForSlot(getNextMissingSlot()));
        updateChips();
        updateFindButtonState();
    }

    // Phase 3: the deterministic fallback text. Reports only what the
    // caller's recommendation fetch actually did — never claims a result
    // it didn't return, and never suggests adjusting a preference the user
    // never set. Only mentions lot_type/budget/section; burial
    // date/time/decedent/capacity are outside the recommendation engine's
    // inputs and are never referenced here.
    function buildDeterministicOutcomeMessage(outcome) {
        if (outcome.status === 'success') {
            const count = outcome.count;
            return `Based on your preferences, I found ${count} available lot${count === 1 ? '' : 's'} that ${count === 1 ? 'matches' : 'match'} your request. Take a look below — each card explains why it was recommended.`;
        }
        if (outcome.status === 'empty') {
            const suggestions = [];
            if (state.lot_type) suggestions.push('choosing a different lot type');
            if (state.budget !== null && state.budget !== '') suggestions.push('increasing your budget');
            if (state.section) suggestions.push('selecting another section');
            let message = "I couldn't find an available lot matching your current preferences.";
            if (suggestions.length) {
                message += ` You could try ${suggestions.join(' or ')}.`;
            }
            return message;
        }
        return "I'm having trouble reaching the recommendation service right now. I've shown the available lots below so you can browse manually instead.";
    }

    // Phase 4: optional LLM narrator — purely rephrases the same outcome
    // facts the Phase 3 text is built from (status/count/which preferences
    // were set). Never ranks, scores, or supplies new facts. Returns null on
    // any failure (no API key configured, network error, timeout, role not
    // permitted) so the caller always has the deterministic Phase 3 text to
    // fall back to.
    async function fetchNarratedOutcomeMessage(outcome) {
        try {
            const payload = {
                status: outcome.status,
                count: outcome.status === 'success' ? outcome.count : undefined,
                preferences: {
                    lot_type: state.lot_type || null,
                    budget: (state.budget === '' || state.budget === null) ? null : state.budget,
                    section: state.section || null,
                },
            };
            const result = await api.request('ai/narrate', { method: 'POST', body: payload });
            const message = result && typeof result.message === 'string' ? result.message.trim() : '';
            return message || null;
        } catch (error) {
            console.error('Narration request failed', error);
            return null;
        }
    }

    async function appendOutcomeMessage(outcome) {
        if (!outcome) return;
        const narrated = await fetchNarratedOutcomeMessage(outcome);
        appendMessage('assistant', narrated || buildDeterministicOutcomeMessage(outcome));
    }

    // Phase 5: capacity-aware date warning. Reuses the existing, unchanged
    // ai/forecast endpoint as-is — no new backend code, no change to
    // recommend_lots() or the scoring engine. The requested burial date is
    // used ONLY to look up an existing forecast month's capacity_status; it
    // is never fed into lot ranking/scoring. Silently shows nothing if the
    // date has no matching forecast entry (current month, or beyond the
    // 24-month forecast horizon), the caller's role can't reach the
    // endpoint, or the forecast call fails — this is advisory only and must
    // never block a search.
    function monthsAheadFor(dateStr) {
        const target = new Date(`${dateStr}T00:00:00`);
        const now = new Date();
        const months = (target.getFullYear() - now.getFullYear()) * 12 + (target.getMonth() - now.getMonth()) + 1;
        return Math.max(1, Math.min(24, months));
    }

    function formatMonthLabel(yyyyMm) {
        const [year, month] = yyyyMm.split('-').map(Number);
        return new Date(year, month - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }

    async function fetchCapacityWarningMessage(dateStr) {
        if (!dateStr) return null;
        try {
            const forecast = await api.request(`ai/forecast?months=${monthsAheadFor(dateStr)}`, { method: 'GET' });
            if (!forecast || !Array.isArray(forecast.forecast)) return null;
            const targetMonth = dateStr.slice(0, 7);
            const entry = forecast.forecast.find(item => item.month === targetMonth);
            if (!entry || entry.capacity_status === 'ok') return null;
            const monthLabel = formatMonthLabel(entry.month);
            const severity = entry.capacity_status === 'critical' ? 'at critical capacity' : 'projected to be near capacity';
            const occupancyPct = Math.round((entry.occupancy_rate || 0) * 100);
            return `Heads up — ${monthLabel} is ${severity} based on current burial trends (about ${occupancyPct}% occupied).`;
        } catch (error) {
            console.error('Capacity forecast check failed', error);
            return null;
        }
    }

    async function appendCapacityWarning(dateStr) {
        const message = await fetchCapacityWarningMessage(dateStr);
        if (message) appendMessage('assistant', message);
    }

    chatForm.addEventListener('submit', function(event) {
        event.preventDefault();
        const text = chatInput.value;
        if (!text.trim()) return;
        chatInput.value = '';
        processMessage(text);
    });

    return {
        state,
        init,
        isReady: () => state.lot_type !== null && state.budget !== null && state.section !== null,
        getPreferences: () => ({
            lot_type: state.lot_type || '',
            budget: state.budget === '' || state.budget === null ? '' : state.budget,
            section: state.section || '',
        }),
        appendMessage,
        appendOutcomeMessage,
        appendCapacityWarning,
    };
}
