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
// Batch M3: optional LLM-assisted extraction (POST ai/extract), used ONLY
// when Phase 2's deterministic extractor finds nothing at all in a message.
// Same never-trust-raw-text contract as Phase 2: lot_type/section values
// are re-validated against the live lists before being applied. Sends only
// the message text + live lookup lists (never decedent/user/booking data).
// Falls back to Phase 2's existing clarification message on any failure.
// Batch M4: when M3's extraction detects the user asked the assistant to
// recommend a lot TYPE (rather than just skip it), fetches ranked type
// suggestions (POST schedules/recommend-type) and shows them as a message.
// Purely informational — never auto-fills state.lot_type; the user still
// has to name a type or say "no preference" for the slot to fill.
// Batch N3: captures decedent/date/time from chat too, so the booker
// doesn't have to fill out a separate form by hand. These are
// DETERMINISTIC ONLY (name/date/time pattern-matching against the real
// decedent list) — deliberately no LLM fallback here, unlike lot_type/
// budget/section's ai/extract path, since M3's stated privacy contract is
// to never send decedent/user/booking data to the LLM endpoint.
// Batch O (adviser follow-up 2026-08-18: "complete the remaining
// conversational gaps" — correction, re-selection, reset): previously every
// extractor above was gated `if (state.field === null)`, permanently
// locking a field the instant it was first set. Added:
//   - Correction support: once a field is set, a message containing an
//     explicit correction signal ("actually", "change", "instead", "make
//     it", "different", ...) is allowed to re-run that field's existing
//     extractor. A concrete new value that differs from the current one
//     replaces it; if the message names the field but the extractor still
//     finds nothing (e.g. "I want a different lot type" with no type
//     named), the field is cleared back to null so the normal
//     re-ask/question flow naturally kicks in. No correction signal ->
//     already-set fields are left untouched, exactly as before, so a
//     message mentioning an unrelated number/date can't silently overwrite
//     a resolved field.
//   - onPreferencesCorrected()/onBookingDetailsCorrected(): fired
//     (separately from the one-time onLotPreferencesReady/onDetailExtracted
//     hooks) whenever a correction actually changes a resolved
//     lot_type/budget/section or decedent/date/time value respectively, so
//     the caller can re-run recommendations or refresh a stale confirmation
//     box without the user restarting.
//   - interceptMessage(text) -> Promise<boolean>: optional hook called
//     before any built-in parsing. If it returns true, this module assumes
//     the caller fully handled the message (including echoing it) and does
//     nothing further. Used by booking-wizard.js to resolve "pick the
//     second one"/"the cheapest one"/"Lot A-102" against whichever
//     recommendation set it most recently rendered — this module has no
//     knowledge of lot data, so that resolution has to live in the caller.
//   - Reset: "start over"/"restart"/"start again"/"clear everything" (as
//     the entire message, mirroring the existing skip-phrase convention)
//     clears all state, notifies the caller via onReset() so it can drop
//     its own selected-lot/recommendation-set state, and re-greets. Also
//     exposed as assistant.reset() for a visible "Start Over" button.
// Batch N (adviser feedback 2026-08-18, "make burial scheduling fully
// chat-based, like ChatGPT"): this module is now the ENTIRE booking
// interface, not a widget alongside a form/wizard. Added:
//   - appendRichMessage(): lets the caller (booking-wizard.js) render
//     arbitrary HTML — recommendation cards, the booking confirmation box —
//     as a message in the same conversation thread, instead of a separate
//     step/page.
//   - onLotPreferencesReady / onStateChanged hooks: the assistant now
//     proactively drives the flow forward (auto-searches once lot
//     preferences are known, lets the caller re-check "ready to book?"
//     after every relevant update) instead of waiting on a manual button.
//   - A small escape hatch for decedent/date specifically: if either is
//     still unresolved after a few messages, a tiny inline picker (real
//     <select>/<input type=date>, not free text) appears so the user is
//     never stuck rephrasing forever — this was an explicit user decision
//     (AskUserQuestion) weighing "pure chat, zero fallback" against this,
//     since there's no LLM configured in this dev environment and a wrong
//     guess on decedent/date is worse than asking again. Deliberately NOT
//     applied to lot_type (already has the "Recommend a type for me"
//     button as its out) or budget (robust regex + "no preference" already
//     works) or time (optional, never blocks booking).
//
// createLotChatAssistant(options) -> assistant
//   options.chatWindow, chatForm, chatInput, chatPrefStatus: the DOM
//     elements (same markup/IDs used by burial-scheduling.html).
//   options.chatSuggestTypeBtn: optional quick-action button.
//   options.getLotTypes(), options.getSections(): return the live lookup
//     arrays ({type_name}/{section_name} objects) at call time.
//   options.getDecedents(): returns the live decedent list ({decedent_id,
//     first_name, last_name}) at call time. Optional — decedent extraction
//     and its escape hatch are skipped entirely if omitted.
//   options.validateDate(dateStr): optional, returns {valid, reason} — used
//     to apply the same past-date/Monday-block business rules everywhere a
//     date can be set (chat text, escape hatch), so neither can bypass them.
//   options.onDetailExtracted(field, value): optional, called whenever chat
//     resolves 'decedent_id' | 'date' | 'time'.
//   options.onLotPreferencesReady(): optional, called exactly once, the
//     moment lot_type+budget are both resolved — the caller should fetch
//     and render recommendations at this point (via appendRichMessage).
//   options.onStateChanged(): optional, called after every resolved update
//     (including escape-hatch resolutions) — the caller can re-check
//     "do I now have everything needed to finalize a booking?".
//   options.onReady(isReady): optional, called whenever lot_type/budget
//     readiness changes.
//
// assistant.init(): greets the user and asks the first question.
// assistant.state: { lot_type, budget, section, decedent_id, date, time } —
//   null until captured, '' means "explicitly no preference" (lot_type/
//   budget/section only — decedent/date/time have no "no preference").
// assistant.isReady(): true once lot_type/budget are captured/skipped.
// assistant.getPreferences(): { lot_type, budget, section } shaped for
//   schedules/recommend (null/'' become '').
// assistant.appendMessage(role, text): manual chat bubble (role: 'assistant'|'user').
// assistant.appendRichMessage(html): manual rich HTML bubble, returns the
//   bubble element so the caller can query/wire elements inside it.
// assistant.appendOutcomeMessage(outcome): Phase 3/4 — outcome is
//   { status: 'success'|'empty'|'error', count? }.
// assistant.appendCapacityWarning(dateStr): Phase 5.
function createLotChatAssistant(options) {
    const {
        chatWindow,
        chatForm,
        chatInput,
        chatSuggestTypeBtn,
        chatPrefStatus,
        getLotTypes,
        getSections,
        getDecedents,
        validateDate,
        onDetailExtracted,
        onLotPreferencesReady,
        onStateChanged,
        onReady,
        interceptMessage,
        onPreferencesCorrected,
        onBookingDetailsCorrected,
        onReset,
    } = options;

    const CHAT_SKIP_PHRASES = ['any', 'anything', 'no preference', 'not sure', "doesn't matter", 'does not matter', 'skip', "i don't know", 'idk', 'n/a', 'none', 'whatever'];
    const RESET_PHRASES = ['start over', 'start again', 'restart', 'reset', 'reset conversation', 'reset the conversation', 'clear everything', 'clear all', 'begin again'];
    const CORRECTION_SIGNAL_RE = /\b(actually|instead|change|update|switch|correct|different|rather|make it)\b/i;
    const FIELD_KEYWORD_RE = {
        lot_type: /\b(lot\s*type|type of lot)\b/i,
        section: /\bsection\b/i,
        budget: /\bbudget\b/i,
    };
    const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const MONTH_ABBR = MONTH_NAMES.map(m => m.slice(0, 3));
    const ESCAPE_HATCH_THRESHOLD = 3;

    const state = { lot_type: null, budget: null, section: null, decedent_id: null, date: null, time: null };
    let decedentLabel = null;
    let lotPreferencesReadyFired = false;
    let decedentAttempts = 0;
    let dateAttempts = 0;
    let decedentEscapeShown = false;
    let dateEscapeShown = false;

    function escapeRegExp(text) {
        return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    }

    function isChatSkipMessage(text) {
        const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, '');
        return CHAT_SKIP_PHRASES.includes(normalized);
    }

    function isResetPhrase(text) {
        const normalized = text.trim().toLowerCase().replace(/[.!?]+$/, '');
        return RESET_PHRASES.includes(normalized);
    }

    function isUnset(value) {
        return value === null || value === '';
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

    // Batch N: now that a single message can carry decedent/date/lot/budget
    // all at once ("Juan Dela Cruz, August 25, Premium Lot, 8000"), this
    // must scan every digit run in the message, not just the first — the
    // first one is often a day-of-month, not the budget. Each match checks
    // its OWN immediately-preceding currency symbol (not "does the message
    // contain a ₱ anywhere"), so "August 25, ₱8000" can't let the 25 slip
    // through just because a symbol exists elsewhere in the same message.
    function extractBudgetFromText(text) {
        const cleaned = text.replace(/,/g, '');
        const matches = cleaned.matchAll(/([₱$])?\s*(\d+(?:\.\d+)?)\s*(k)?\b/gi);
        for (const match of matches) {
            const hasCurrencySymbol = Boolean(match[1]);
            let value = parseFloat(match[2]);
            if (!isFinite(value) || value <= 0) continue;
            const hasKSuffix = Boolean(match[3]);
            if (hasKSuffix) value *= 1000;
            // Require an explicit currency symbol, a k-suffix, or a value
            // already in a plausible lot-price range before accepting it as
            // a budget — otherwise a stray day number would get misread as
            // a ₱25 budget.
            if (!hasCurrencySymbol && !hasKSuffix && value < 1000) continue;
            return Math.round(value);
        }
        return null;
    }

    function pad2(n) {
        return String(n).padStart(2, '0');
    }

    // Rejects dates that Date's own constructor would silently roll over
    // (e.g. Feb 30 -> Mar 2) instead of accepting a wrong date.
    function toIsoDate(year, monthIndex, day) {
        const d = new Date(year, monthIndex, day);
        if (d.getFullYear() !== year || d.getMonth() !== monthIndex || d.getDate() !== day) return null;
        return `${year}-${pad2(monthIndex + 1)}-${pad2(day)}`;
    }

    function resolveMonthIndex(token) {
        const t = token.toLowerCase();
        let idx = MONTH_NAMES.indexOf(t);
        if (idx === -1) idx = MONTH_ABBR.indexOf(t.slice(0, 3));
        return idx;
    }

    // If no year was stated and the resolved date already passed this year,
    // assume next year — a booker saying "August 25" in November obviously
    // doesn't mean the August that already happened.
    function rollToFutureIfPast(year, monthIndex, day, yearWasStated) {
        let iso = toIsoDate(year, monthIndex, day);
        if (iso && !yearWasStated) {
            const now = new Date();
            const today0 = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            if (new Date(year, monthIndex, day) < today0) {
                iso = toIsoDate(year + 1, monthIndex, day);
            }
        }
        return iso;
    }

    // Deterministic only (see module comment) — covers today/tomorrow, ISO
    // (2026-08-25), slash (8/25/2026, 8/25), and "Month Day[, Year]" /
    // "Day Month[, Year]" forms. Deliberately does NOT attempt relative
    // weekdays ("next Tuesday") — too ambiguous to parse reliably without a
    // date library, and a wrong guess here is worse than just asking.
    function extractDateFromText(text) {
        const lower = text.toLowerCase();
        const now = new Date();

        if (/\btoday\b/.test(lower)) {
            return toIsoDate(now.getFullYear(), now.getMonth(), now.getDate());
        }
        if (/\btomorrow\b/.test(lower)) {
            const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
            return toIsoDate(t.getFullYear(), t.getMonth(), t.getDate());
        }

        let m = lower.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
        if (m) {
            const iso = toIsoDate(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
            if (iso) return iso;
        }

        m = lower.match(/\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/);
        if (m) {
            let year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
            if (year < 100) year += 2000;
            const iso = rollToFutureIfPast(year, parseInt(m[1], 10) - 1, parseInt(m[2], 10), Boolean(m[3]));
            if (iso) return iso;
        }

        const monthPattern = MONTH_NAMES.map((n, i) => `${n}|${MONTH_ABBR[i]}`).join('|');
        let re = new RegExp(`\\b(${monthPattern})\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?\\b`, 'i');
        m = lower.match(re);
        if (m) {
            const monthIndex = resolveMonthIndex(m[1]);
            const year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
            const iso = rollToFutureIfPast(year, monthIndex, parseInt(m[2], 10), Boolean(m[3]));
            if (iso) return iso;
        }

        re = new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthPattern})\\.?(?:,?\\s+(\\d{4}))?\\b`, 'i');
        m = lower.match(re);
        if (m) {
            const monthIndex = resolveMonthIndex(m[2]);
            const year = m[3] ? parseInt(m[3], 10) : now.getFullYear();
            const iso = rollToFutureIfPast(year, monthIndex, parseInt(m[1], 10), Boolean(m[3]));
            if (iso) return iso;
        }

        return null;
    }

    function formatDateLabel(iso) {
        return new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }

    function extractTimeFromText(text) {
        const lower = text.toLowerCase();
        if (/\bmorning\b/.test(lower)) return '09:00';
        if (/\bafternoon\b/.test(lower)) return '14:00';
        if (/\bevening\b/.test(lower)) return '17:00';

        let m = lower.match(/\b(\d{1,2}):(\d{2})\s*(am|pm)?\b/);
        if (m) {
            let hour = parseInt(m[1], 10);
            const minute = parseInt(m[2], 10);
            if (m[3] === 'pm' && hour < 12) hour += 12;
            if (m[3] === 'am' && hour === 12) hour = 0;
            if (hour > 23 || minute > 59) return null;
            return `${pad2(hour)}:${pad2(minute)}`;
        }

        m = lower.match(/\b(\d{1,2})\s*(am|pm)\b/);
        if (m) {
            let hour = parseInt(m[1], 10);
            if (m[2] === 'pm' && hour < 12) hour += 12;
            if (m[2] === 'am' && hour === 12) hour = 0;
            if (hour > 23) return null;
            return `${pad2(hour)}:00`;
        }

        return null;
    }

    function formatTimeLabel(hhmm) {
        const [h, m] = hhmm.split(':').map(Number);
        const period = h >= 12 ? 'PM' : 'AM';
        const hour12 = h % 12 === 0 ? 12 : h % 12;
        return `${hour12}:${pad2(m)} ${period}`;
    }

    // Only resolves on an unambiguous match — a name shared by two decedent
    // records (or too common to isolate) is deliberately left unset rather
    // than guessing which family member the booker meant.
    function extractDecedentFromText(text) {
        const decedents = typeof getDecedents === 'function' ? (getDecedents() || []) : [];
        if (!decedents.length) return { match: null, ambiguous: false };
        const lower = text.toLowerCase();

        const matches = decedents.filter(d => {
            const first = (d.first_name || '').toLowerCase().trim();
            const last = (d.last_name || '').toLowerCase().trim();
            const full = `${first} ${last}`.trim();
            if (full && lower.includes(full)) return true;
            if (last && new RegExp(`\\b${escapeRegExp(last)}\\b`, 'i').test(lower)) return true;
            if (first && first.length > 2 && new RegExp(`\\b${escapeRegExp(first)}\\b`, 'i').test(lower)) return true;
            return false;
        });

        // A full "first last" match is unambiguous even if other decedents
        // separately share just the first or last name — prefer it.
        const fullNameMatches = matches.filter(d => lower.includes(`${(d.first_name || '').toLowerCase().trim()} ${(d.last_name || '').toLowerCase().trim()}`.trim()));
        if (fullNameMatches.length === 1) return { match: fullNameMatches[0], ambiguous: false };

        if (matches.length === 1) return { match: matches[0], ambiguous: false };
        if (matches.length > 1) return { match: null, ambiguous: true, candidates: matches };
        return { match: null, ambiguous: false };
    }

    // Batch M9: section is intentionally NOT one of the assistant's asked
    // slots — it's an internal cemetery classification, not something a
    // citizen should be required to pick. It can still be captured (see
    // extractSectionFromText()/tryLlmExtraction() below) if a user
    // volunteers one unprompted, and is still sent to the recommendation
    // engine as an internal ranking input either way.
    //
    // Batch Q (adviser follow-up: the assistant's own greeting promises to
    // ask "who this is for, your preferred burial date, and your budget",
    // but only lot_type/budget were ever actually asked as a question —
    // decedent/date were silently extraction-only, so a user who didn't
    // volunteer them unprompted got no natural follow-up question at all
    // until either they mentioned it or the 3-message escape hatch kicked
    // in. decedent_id now leads the sequence (matches the mockup's
    // name-first flow) so it's asked like every other required slot. date
    // deliberately stays OUT of this pipeline — the mockup asks for it only
    // after a lot is picked ("What date would you prefer?" comes right
    // after choosing A-102), and renderConfirmationIfReady() in
    // booking-wizard.js already asks for it explicitly at that point; date's
    // own extractDateFromText() call further down still runs unconditionally
    // whenever state.date is null, so an early "August 25" is still captured
    // if volunteered.
    function getNextMissingSlot() {
        if (state.decedent_id === null && typeof getDecedents === 'function') return 'decedent_id';
        if (state.lot_type === null) return 'lot_type';
        if (state.budget === null) return 'budget';
        return null;
    }

    function questionForSlot(slot) {
        if (slot === 'decedent_id') {
            return "Who is this burial for? Please give me the decedent's full name.";
        }
        if (slot === 'lot_type') {
            return `What lot type are you looking for? Available options: ${describeOptions(getLotTypes(), 'type_name')}. Not sure? Tap "Recommend a type for me" below and I'll pick one for you.`;
        }
        if (slot === 'budget') {
            return 'What is your preferred budget? (e.g., 8000, 8,000, ₱8,000, or 8k)';
        }
        return null;
    }

    function appendMessage(role, text) {
        const bubble = document.createElement('div');
        bubble.className = `chat-message ${role}`;
        bubble.textContent = text;
        chatWindow.appendChild(bubble);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return bubble;
    }

    // Batch N: the assistant is now the entire booking surface — recommendation
    // cards and the booking confirmation render as messages in this same
    // thread via this, instead of a separate step/page. Returns the bubble
    // so the caller can query/wire elements inside the HTML it supplied.
    function appendRichMessage(html) {
        const bubble = document.createElement('div');
        bubble.className = 'chat-message assistant chat-message--rich';
        bubble.innerHTML = html;
        chatWindow.appendChild(bubble);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return bubble;
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
            } else if (field === 'budget') {
                strong.textContent = formatBudget(value);
                chip.classList.add('filled');
            } else if (field === 'decedent_id') {
                strong.textContent = decedentLabel || 'Set';
                chip.classList.add('filled');
            } else if (field === 'date') {
                strong.textContent = formatDateLabel(value);
                chip.classList.add('filled');
            } else if (field === 'time') {
                strong.textContent = formatTimeLabel(value);
                chip.classList.add('filled');
            } else {
                strong.textContent = value;
                chip.classList.add('filled');
            }
        });
    }

    function updateReadiness() {
        const ready = state.lot_type !== null && state.budget !== null;
        // Batch M9: a type recommendation only makes sense while lot_type
        // is still undecided — once the user has named/skipped one, offering
        // to "recommend a type" again would be confusing.
        if (chatSuggestTypeBtn) chatSuggestTypeBtn.disabled = state.lot_type !== null;
        if (typeof onReady === 'function') onReady(ready);
    }

    function setInputEnabled(enabled) {
        chatInput.disabled = !enabled;
        chatForm.querySelector('.chat-send-btn').disabled = !enabled;
        if (chatSuggestTypeBtn && state.lot_type === null) chatSuggestTypeBtn.disabled = !enabled;
    }

    function appendTypingIndicator() {
        const bubble = document.createElement('div');
        bubble.className = 'chat-message assistant chat-typing-indicator';
        bubble.textContent = '…';
        chatWindow.appendChild(bubble);
        chatWindow.scrollTop = chatWindow.scrollHeight;
        return bubble;
    }

    // Batch N: small inline escape hatches for decedent/date specifically —
    // see the module comment for why these two (and not lot_type/budget/
    // time) get one. A real <select>/<input type=date> rather than free
    // text, so picking from it can never be ambiguous the way a typed
    // message can be.
    function appendDecedentEscapeHatch() {
        const decedents = typeof getDecedents === 'function' ? (getDecedents() || []) : [];
        const optionsHtml = decedents.map(d => `<option value="${d.decedent_id}">${d.first_name} ${d.last_name}</option>`).join('');
        const bubble = appendRichMessage(`
            <div class="chat-escape-hatch">
                <label>Or pick directly:</label>
                <select class="chat-escape-select">
                    <option value="">Select decedent</option>
                    ${optionsHtml}
                </select>
                <button type="button" class="btn-secondary chat-escape-btn">Set</button>
            </div>
        `);
        const select = bubble.querySelector('.chat-escape-select');
        const btn = bubble.querySelector('.chat-escape-btn');
        btn.addEventListener('click', () => {
            const id = select.value;
            if (!id) return;
            const decedent = decedents.find(d => d.decedent_id.toString() === id);
            if (!decedent) return;
            state.decedent_id = Number(id);
            decedentLabel = `${decedent.first_name} ${decedent.last_name}`;
            updateChips();
            bubble.remove();
            appendMessage('assistant', `Got it — this booking is for ${decedentLabel}.`);
            if (typeof onDetailExtracted === 'function') onDetailExtracted('decedent_id', state.decedent_id);
            if (typeof onStateChanged === 'function') onStateChanged();
        });
    }

    // Citizen-initiated decedent registration requests: when a name truly
    // isn't in decedent_records yet (not just a spelling mismatch), there's
    // no picker to fall back on — the person doesn't exist in the system at
    // all. Shown on the FIRST no-match (unlike the escape hatches above,
    // which wait for repeated struggling), since there's nothing to wait
    // for: this never resolves decedent_id itself, only queues a request
    // for staff to review via the Decedent Records page's "Pending
    // Requests" tab. Deliberately asks for only non-sensitive fields (name,
    // approximate date of death, relationship) — staff still creates the
    // real decedent_records row (lot assignment, cause of death, contact
    // info) through the existing form, this is only an intake queue.
    function escapeHtmlAttr(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }

    function appendDecedentRequestForm(prefillName) {
        const bubble = appendRichMessage(`
            <div class="chat-decedent-request">
                <label>Request to add this person:</label>
                <input type="text" class="chat-request-name" placeholder="Full name" value="${escapeHtmlAttr(prefillName)}">
                <input type="date" class="chat-request-dod" max="${new Date().toISOString().split('T')[0]}">
                <input type="text" class="chat-request-relationship" placeholder="Relationship (optional)">
                <button type="button" class="btn-secondary chat-request-btn">Send request</button>
            </div>
        `);
        const nameInput = bubble.querySelector('.chat-request-name');
        const dodInput = bubble.querySelector('.chat-request-dod');
        const relationshipInput = bubble.querySelector('.chat-request-relationship');
        const btn = bubble.querySelector('.chat-request-btn');
        btn.addEventListener('click', async () => {
            const fullName = nameInput.value.trim();
            if (!fullName) return;
            btn.disabled = true;
            try {
                await api.request('decedent-requests', {
                    method: 'POST',
                    body: {
                        full_name: fullName,
                        approximate_dod: dodInput.value || null,
                        relationship: relationshipInput.value.trim() || null,
                    },
                });
                bubble.remove();
                appendMessage('assistant', "Thanks — I've sent this to our staff for review. I'll let you know here once it's added, or you can check back later.");
            } catch (error) {
                console.error('Decedent request submission failed', error);
                btn.disabled = false;
                appendMessage('assistant', "Sorry, I couldn't send that request right now. Please try again in a moment.");
            }
        });
    }

    function appendDateEscapeHatch() {
        const bubble = appendRichMessage(`
            <div class="chat-escape-hatch">
                <label>Or pick directly:</label>
                <input type="date" class="chat-escape-date">
                <button type="button" class="btn-secondary chat-escape-btn">Set</button>
            </div>
        `);
        const input = bubble.querySelector('.chat-escape-date');
        const btn = bubble.querySelector('.chat-escape-btn');
        input.min = new Date().toISOString().split('T')[0];
        btn.addEventListener('click', () => {
            const value = input.value;
            if (!value) return;
            const validation = typeof validateDate === 'function' ? validateDate(value) : { valid: true };
            if (!validation.valid) {
                appendMessage('assistant', validation.reason);
                return;
            }
            state.date = value;
            updateChips();
            bubble.remove();
            appendMessage('assistant', `Burial date set to ${formatDateLabel(value)}.`);
            if (typeof onDetailExtracted === 'function') onDetailExtracted('date', value);
            if (typeof onStateChanged === 'function') onStateChanged();
        });
    }

    // Batch M3: optional LLM-assisted extraction (POST ai/extract) — used
    // ONLY as a fallback when the deterministic extractors above (and the
    // skip-phrase check) found nothing at all for this message. Sends only
    // the raw message text plus the live lot-type/section lists (never
    // decedent/user/booking data — mirrors the exact data-minimal contract
    // already proven by the narration feature). lot_type/section values are
    // re-validated here against the same live lists before being applied,
    // never trusted as free text; budget must be a finite positive number.
    // Any failure/timeout/missing-API-key resolves to {} so the caller falls
    // straight through to its existing "I couldn't understand that" message.
    async function tryLlmExtraction(text, pendingSlot) {
        const validLotTypes = (getLotTypes() || []).map(t => t.type_name).filter(Boolean);
        const validSections = (getSections() || []).map(s => s.section_name).filter(Boolean);
        const empty = { updates: {}, recommendTypeRequested: false };

        try {
            const response = await api.request('ai/extract', {
                method: 'POST',
                body: { message: text, pending_slot: pendingSlot, lot_types: validLotTypes, sections: validSections },
            });
            const result = response && response.result;
            if (!result || typeof result !== 'object') return empty;

            const updates = {};
            if (state.lot_type === null) {
                if (result.lot_type_no_preference) {
                    updates.lot_type = '';
                } else if (typeof result.lot_type === 'string' && validLotTypes.includes(result.lot_type)) {
                    updates.lot_type = result.lot_type;
                }
            }
            if (state.section === null) {
                if (result.section_no_preference) {
                    updates.section = '';
                } else if (typeof result.section === 'string' && validSections.includes(result.section)) {
                    updates.section = result.section;
                }
            }
            if (state.budget === null) {
                if (result.budget_no_preference) {
                    updates.budget = '';
                } else if (typeof result.budget === 'number' && isFinite(result.budget) && result.budget > 0) {
                    updates.budget = Math.round(result.budget);
                }
            }

            // Batch M4: distinct signal from lot_type_no_preference — only
            // meaningful while lot_type is still pending and nothing else
            // was resolved for it above (a named/skip answer always wins).
            const recommendTypeRequested = pendingSlot === 'lot_type'
                && state.lot_type === null
                && updates.lot_type === undefined
                && Boolean(result.lot_type_recommend_requested);

            return { updates, recommendTypeRequested };
        } catch (error) {
            console.error('LLM-assisted extraction failed', error);
            return empty;
        }
    }

    // General Q&A layer (POST ai/chat): answers real questions about the
    // burial-scheduling process/policies ("what documents do I need?"),
    // grounded server-side in admin/staff-reviewed content — this module
    // never sees or sends that content itself. Called by processMessage()
    // only when nothing else was recognized in the message at all (see
    // nothingRecognizedThisMessage there), so it never overrides a real
    // slot-filling match. Sends only the message text, whichever slot is
    // currently pending (so the model can tell "bad attempt at that slot"
    // apart from "real question"), and non-PII booleans for what's already
    // resolved — never decedent_id/date/lot_type/budget values themselves.
    // Returns null on any failure/no-answer, same never-block contract as
    // tryLlmExtraction above.
    async function tryAnswerGeneralQuestion(text, pendingSlot) {
        try {
            const response = await api.request('ai/chat', {
                method: 'POST',
                body: {
                    message: text,
                    pending_slot: pendingSlot,
                    state_flags: {
                        lot_type_set: state.lot_type !== null,
                        budget_set: state.budget !== null,
                        decedent_set: state.decedent_id !== null,
                        date_set: state.date !== null,
                    },
                },
            });
            return response && response.answered && typeof response.message === 'string' ? response.message : null;
        } catch (error) {
            console.error('General Q&A request failed', error);
            return null;
        }
    }

    // Batch M4: fetches ranked lot-TYPE suggestions (POST
    // schedules/recommend-type) and shows them as a chat message — the AI
    // recommending a TYPE, distinct from its existing specific-lot ranking.
    // Purely informational: it never sets state.lot_type itself, so the
    // user still has to name one of the suggestions (or say "no
    // preference") for the slot to actually fill, keeping "user accepts the
    // recommendation" an explicit step, same as how specific-lot cards
    // already require a "Reserve" click rather than auto-selecting.
    async function suggestLotTypes() {
        try {
            const response = await api.request('schedules/recommend-type', {
                method: 'POST',
                body: {
                    budget: state.budget === '' || state.budget === null ? '' : state.budget,
                    section: state.section || '',
                },
            });
            const types = response && Array.isArray(response.types) ? response.types : null;
            if (!types || types.length === 0) return false;

            const top = types.slice(0, 3);
            const lines = top.map((type, index) => {
                const detail = `${type.available_count} available, from ${formatBudget(type.min_price || 0)}`;
                return index === 0
                    ? `${type.type_name} (${detail}) looks like the best fit right now.`
                    : `${type.type_name} (${detail}) is also open.`;
            });
            appendMessage('assistant', `Based on what's currently available: ${lines.join(' ')} Just tell me which one you'd like, or say "no preference" and I'll consider all of them.`);
            return true;
        } catch (error) {
            console.error('Lot-type suggestion request failed', error);
            return false;
        }
    }

    // Batch M9: deterministic entry point for the same type-suggestion
    // feature M4 built — previously only reachable if the optional LLM
    // extraction (ai/extract) happened to detect a "recommend one for me"
    // phrasing. This lets a user request it directly (e.g. via a button),
    // with no LLM/API-key dependency, reusing suggestLotTypes() as-is (same
    // ranking call, same "present, don't auto-fill" behavior).
    async function requestTypeSuggestion() {
        if (state.lot_type !== null) return false;
        appendMessage('user', 'Recommend a type for me');
        setInputEnabled(false);
        const typingBubble = appendTypingIndicator();
        const suggested = await suggestLotTypes();
        typingBubble.remove();
        setInputEnabled(true);
        chatInput.focus();
        if (!suggested) {
            appendMessage('assistant', questionForSlot('lot_type'));
        }
        return suggested;
    }

    // Batch O: full reset — clears every slot, the caller's own selected-lot/
    // recommendation-set state (via onReset), and re-greets. Triggered by a
    // reset phrase typed in chat or by the caller's visible "Start Over"
    // button (both funnel through assistant.reset()).
    function performReset() {
        state.lot_type = null;
        state.budget = null;
        state.section = null;
        state.decedent_id = null;
        state.date = null;
        state.time = null;
        decedentLabel = null;
        lotPreferencesReadyFired = false;
        decedentAttempts = 0;
        dateAttempts = 0;
        decedentEscapeShown = false;
        dateEscapeShown = false;
        if (typeof onReset === 'function') onReset();
        chatWindow.innerHTML = '';
        init();
    }

    async function processMessage(rawText) {
        const text = rawText.trim();
        if (!text) return;

        if (isResetPhrase(text)) {
            performReset();
            return;
        }

        if (typeof interceptMessage === 'function') {
            const handled = await interceptMessage(text);
            if (handled) return;
        }

        appendMessage('user', text);

        const pendingSlot = getNextMissingSlot();
        const updates = {};
        const hasCorrectionSignal = CORRECTION_SIGNAL_RE.test(text);

        if (isUnset(state.lot_type)) {
            const lotType = extractLotTypeFromText(text);
            if (lotType) updates.lot_type = lotType;
        } else if (hasCorrectionSignal) {
            const lotType = extractLotTypeFromText(text);
            if (lotType && lotType !== state.lot_type) {
                updates.lot_type = lotType;
            } else if (!lotType && FIELD_KEYWORD_RE.lot_type.test(text)) {
                updates.lot_type = null;
            }
        }
        if (isUnset(state.section)) {
            const section = extractSectionFromText(text);
            if (section) updates.section = section;
        } else if (hasCorrectionSignal) {
            const section = extractSectionFromText(text);
            if (section && section !== state.section) {
                updates.section = section;
            } else if (!section && FIELD_KEYWORD_RE.section.test(text)) {
                updates.section = null;
            }
        }
        if (isUnset(state.budget)) {
            const budget = extractBudgetFromText(text);
            if (budget !== null) updates.budget = budget;
        } else if (hasCorrectionSignal) {
            const budget = extractBudgetFromText(text);
            if (budget !== null && budget !== state.budget) {
                updates.budget = budget;
            } else if (budget === null && FIELD_KEYWORD_RE.budget.test(text)) {
                updates.budget = null;
            }
        }

        // Everything below is decedent/date/time, which must NOT influence
        // the skip-detection/LLM-fallback decisions further down — those are
        // about whether lot_type/section/budget were found in this message,
        // tracked separately here so a message like "August 25, fifty
        // thousand" still gets the LLM fallback's shot at "fifty thousand"
        // even though the date was already resolved deterministically.
        const corePrefUpdateCount = Object.keys(updates).length;

        let newDecedentLabel = null;
        let ambiguousDecedentCandidates = null;
        let decedentCorrected = false;
        if (state.decedent_id === null) {
            const decedentResult = extractDecedentFromText(text);
            if (decedentResult.match) {
                updates.decedent_id = decedentResult.match.decedent_id;
                newDecedentLabel = `${decedentResult.match.first_name} ${decedentResult.match.last_name}`;
            } else if (decedentResult.ambiguous) {
                ambiguousDecedentCandidates = decedentResult.candidates;
            }
        } else if (hasCorrectionSignal) {
            const decedentResult = extractDecedentFromText(text);
            if (decedentResult.match && decedentResult.match.decedent_id !== state.decedent_id) {
                updates.decedent_id = decedentResult.match.decedent_id;
                newDecedentLabel = `${decedentResult.match.first_name} ${decedentResult.match.last_name}`;
                decedentCorrected = true;
            } else if (decedentResult.ambiguous) {
                ambiguousDecedentCandidates = decedentResult.candidates;
            }
        }

        let dateValidationError = null;
        let dateCorrected = false;
        // Batch P bugfix: true only when THIS message contained a date
        // pattern that was actually rejected by validateDate() (Monday/past,
        // etc) — not just "no date mentioned." Gates the time block below so
        // a rejected date can't let that same message's time slip through;
        // see the time block's comment for why.
        let dateRejectedThisMessage = false;
        if (state.date === null) {
            const parsedDate = extractDateFromText(text);
            if (parsedDate) {
                const validation = typeof validateDate === 'function' ? validateDate(parsedDate) : { valid: true };
                if (validation.valid) {
                    updates.date = parsedDate;
                } else {
                    dateValidationError = validation.reason;
                    dateRejectedThisMessage = true;
                }
            }
        } else if (hasCorrectionSignal) {
            const parsedDate = extractDateFromText(text);
            if (parsedDate && parsedDate !== state.date) {
                const validation = typeof validateDate === 'function' ? validateDate(parsedDate) : { valid: true };
                if (validation.valid) {
                    updates.date = parsedDate;
                    dateCorrected = true;
                } else {
                    dateValidationError = validation.reason;
                    dateRejectedThisMessage = true;
                }
            }
        }

        // Bugfix (found during browser verification): date and time are
        // parsed independently, so a message like "August 31 at 10 AM" used
        // to let the time commit even though the date got rejected as a
        // Monday — state.time silently became "10:00" with nothing to show
        // for it. Because time was then "already set," a later plain
        // "September 1 at 3 PM" (no correction wording) couldn't update it
        // either, since a plain restatement only overwrites an unset field.
        // The booking could go through with a time the user never actually
        // confirmed. Fix: a message whose own date failed validation can't
        // commit ITS time either — the whole date/time pair from that
        // message is provisional and is discarded together. This only
        // gates messages that contained a rejected date; a message with no
        // date at all, or a valid one, still updates time exactly as
        // before (including the existing correction-signal requirement for
        // an already-set time).
        let timeCorrected = false;
        if (!dateRejectedThisMessage) {
            if (state.time === null) {
                const parsedTime = extractTimeFromText(text);
                if (parsedTime) updates.time = parsedTime;
            } else if (hasCorrectionSignal) {
                const parsedTime = extractTimeFromText(text);
                if (parsedTime && parsedTime !== state.time) {
                    updates.time = parsedTime;
                    timeCorrected = true;
                }
            }
        }

        // Only treat the message as an explicit "skip" for the currently
        // pending slot, and only when nothing else was recognized in it —
        // avoids misreading unrelated text as a skip. decedent_id is
        // excluded (Batch Q): there's no "no preference" for who a burial
        // is for, unlike lot_type/budget.
        if (pendingSlot && pendingSlot !== 'decedent_id' && updates[pendingSlot] === undefined && corePrefUpdateCount === 0 && isChatSkipMessage(text)) {
            updates[pendingSlot] = '';
        }

        // General Q&A: true only when this message didn't match ANY of the
        // extraction above — lot_type/section/budget, decedent, date, time,
        // or the skip-phrase check just above. Excludes hasCorrectionSignal
        // messages entirely (not just decedent ones) as a blanket safety
        // margin: a correction attempt that fails to resolve (e.g. "actually
        // a different lot type" with no type named, or an ambiguous
        // decedent-name correction) can still contain a person's name, and
        // this module's privacy contract is to never forward that text to
        // any LLM endpoint — simpler and safer than re-deriving exactly
        // which correction touched decedent data. decedent_id itself is
        // excluded as pendingSlot for the same reason tryLlmExtraction
        // excludes it below (a first-attempt name that failed to match is
        // still a name).
        const nothingRecognizedThisMessage = corePrefUpdateCount === 0
            && updates.decedent_id === undefined
            && updates.date === undefined
            && updates.time === undefined
            && !dateRejectedThisMessage
            && !ambiguousDecedentCandidates
            && (pendingSlot === null || updates[pendingSlot] === undefined);

        if (pendingSlot !== 'decedent_id' && !hasCorrectionSignal && nothingRecognizedThisMessage) {
            setInputEnabled(false);
            const typingBubble = appendTypingIndicator();
            const answer = await tryAnswerGeneralQuestion(text, pendingSlot);
            typingBubble.remove();
            if (answer) {
                appendMessage('assistant', answer);
                if (pendingSlot) appendMessage('assistant', questionForSlot(pendingSlot));
                setInputEnabled(true);
                chatInput.focus();
                return;
            }
            setInputEnabled(true);
            chatInput.focus();
        }

        // Batch M3: deterministic parsing found nothing usable at all — try
        // the optional LLM-assisted fallback before giving up and asking the
        // user to rephrase. Gated on corePrefUpdateCount (not the
        // now-larger `updates`) so a resolved date/decedent/time never
        // silently suppresses this fallback for lot_type/budget. Batch Q:
        // also excludes decedent_id — tryLlmExtraction only ever resolves
        // lot_type/section/budget, and this module's own privacy contract
        // (see the module header) is to never send decedent/user/booking
        // data to the LLM endpoint, so a message naming a person can't be
        // forwarded here just because decedent_id happens to be pending.
        let recommendTypeRequested = false;
        if (pendingSlot && pendingSlot !== 'decedent_id' && corePrefUpdateCount === 0 && updates[pendingSlot] === undefined) {
            setInputEnabled(false);
            const typingBubble = appendTypingIndicator();
            const llmResult = await tryLlmExtraction(text, pendingSlot);
            typingBubble.remove();
            Object.keys(llmResult.updates).forEach(field => { updates[field] = llmResult.updates[field]; });
            recommendTypeRequested = llmResult.recommendTypeRequested;
            setInputEnabled(true);
            chatInput.focus();
        }

        Object.keys(updates).forEach(field => { state[field] = updates[field]; });
        updateChips();

        const acknowledgements = [];
        if (updates.lot_type !== undefined) {
            if (updates.lot_type === null) {
                acknowledgements.push('No problem — what lot type would you like instead?');
            } else {
                acknowledgements.push(updates.lot_type ? `Got it — ${updates.lot_type}.` : "Okay, no preference on lot type.");
            }
        }
        if (updates.budget !== undefined) {
            if (updates.budget === null) {
                acknowledgements.push('No problem — what would you like your budget to be instead?');
            } else {
                acknowledgements.push(updates.budget !== '' ? `Noted — budget around ${formatBudget(updates.budget)}.` : "No problem, I won't filter by budget.");
            }
        }
        if (updates.section !== undefined) {
            if (updates.section === null) {
                acknowledgements.push('Got it — which section would you prefer instead?');
            } else {
                acknowledgements.push(updates.section ? `Noted — ${updates.section}.` : 'Okay, any section works.');
            }
        }
        if (updates.decedent_id !== undefined) {
            decedentLabel = newDecedentLabel;
            acknowledgements.push(decedentCorrected ? `Got it — updating to ${newDecedentLabel}.` : `Got it — this booking is for ${newDecedentLabel}.`);
            if (typeof onDetailExtracted === 'function') onDetailExtracted('decedent_id', updates.decedent_id);
        }
        if (updates.date !== undefined) {
            acknowledgements.push(dateCorrected ? `Updated the burial date to ${formatDateLabel(updates.date)}.` : `Burial date set to ${formatDateLabel(updates.date)}.`);
            if (typeof onDetailExtracted === 'function') onDetailExtracted('date', updates.date);
        }
        if (updates.time !== undefined) {
            acknowledgements.push(timeCorrected ? `Updated the time to ${formatTimeLabel(updates.time)}.` : `Time noted as ${formatTimeLabel(updates.time)}.`);
            if (typeof onDetailExtracted === 'function') onDetailExtracted('time', updates.time);
        }

        if (acknowledgements.length) {
            appendMessage('assistant', acknowledgements.join(' '));
        } else if (recommendTypeRequested) {
            // Batch M4: handled below via suggestLotTypes() — skip the
            // generic "I couldn't match that" text since we DID understand
            // the request, we just have a suggestion to show first.
        } else if (pendingSlot === 'lot_type') {
            appendMessage('assistant', `I couldn't match that to an available lot type. Available options: ${describeOptions(getLotTypes(), 'type_name')}. You can also say "no preference".`);
        } else if (pendingSlot === 'budget') {
            appendMessage('assistant', containsDigits(text)
                ? "I couldn't read a budget from that. Try formats like 8000, 8,000, ₱8,000, or 8k. You can also say \"no preference\"."
                : 'Could you share a budget? For example: 8000 or ₱8,000. You can also say "no preference".');
        } else if (pendingSlot === 'decedent_id' && !(ambiguousDecedentCandidates && ambiguousDecedentCandidates.length)) {
            appendMessage('assistant', "I couldn't find a decedent record matching that name. Could you check the spelling? If they're genuinely not in our system yet, you can request to add them below.");
            appendDecedentRequestForm(text);
        }

        if (ambiguousDecedentCandidates && ambiguousDecedentCandidates.length) {
            const names = ambiguousDecedentCandidates.slice(0, 5).map(d => `${d.first_name} ${d.last_name}`).join(', ');
            appendMessage('assistant', `I found more than one matching record: ${names}. Could you be more specific, or use the picker below?`);
        }
        if (dateValidationError) {
            appendMessage('assistant', dateValidationError);
        }

        // Batch M4: the user asked the assistant to recommend a lot type —
        // show ranked suggestions (AI output), then skip the generic
        // "What lot type are you looking for?" re-ask below only if a
        // suggestion actually rendered, so a failed/empty lookup still
        // falls through to the normal question rather than going silent.
        let suggestedTypes = false;
        if (recommendTypeRequested) {
            setInputEnabled(false);
            const typingBubble = appendTypingIndicator();
            suggestedTypes = await suggestLotTypes();
            typingBubble.remove();
            setInputEnabled(true);
            chatInput.focus();
        }

        const nextSlot = getNextMissingSlot();
        if (nextSlot && !(suggestedTypes && nextSlot === 'lot_type')) {
            appendMessage('assistant', questionForSlot(nextSlot));
        } else if (!nextSlot && !lotPreferencesReadyFired) {
            // Batch N: the moment lot_type+budget are both known, proactively
            // move the conversation forward instead of waiting on a button —
            // the caller fetches/renders recommendations as the next message.
            lotPreferencesReadyFired = true;
            if (typeof onLotPreferencesReady === 'function') onLotPreferencesReady();
        }

        // Escape hatches: tracked independently of the lot_type/budget
        // sequence above (a user might struggle with the decedent name
        // before ever discussing lot preferences), so these tick on every
        // message regardless of what else happened in this turn.
        if (state.decedent_id === null) {
            decedentAttempts++;
            if (decedentAttempts >= ESCAPE_HATCH_THRESHOLD && !decedentEscapeShown && typeof getDecedents === 'function') {
                decedentEscapeShown = true;
                appendMessage('assistant', "Still having trouble figuring out who this is for —");
                appendDecedentEscapeHatch();
            }
        }
        if (state.date === null) {
            dateAttempts++;
            if (dateAttempts >= ESCAPE_HATCH_THRESHOLD && !dateEscapeShown) {
                dateEscapeShown = true;
                appendMessage('assistant', "Still having trouble with the date —");
                appendDateEscapeHatch();
            }
        }

        // Batch O: recommendation-relevant fields changed AFTER recommendations
        // were already shown at least once (lotPreferencesReadyFired) — the
        // previously shown set is now outdated. Only fires once the corrected
        // state is actually complete again (lot_type+budget both resolved) —
        // a correction that clears a field back to null (e.g. "a different
        // lot type" with no type named) waits for the follow-up answer
        // instead of re-fetching with an incomplete preference set.
        const recommendationFieldsTouched = ['lot_type', 'budget', 'section'].some(field => updates[field] !== undefined);
        const isReadyNow = state.lot_type !== null && state.budget !== null;
        if (recommendationFieldsTouched && lotPreferencesReadyFired && isReadyNow && typeof onPreferencesCorrected === 'function') {
            setInputEnabled(false);
            const typingBubble = appendTypingIndicator();
            await onPreferencesCorrected();
            typingBubble.remove();
            setInputEnabled(true);
            chatInput.focus();
        }

        // Batch O: decedent/date/time changed after being previously
        // resolved — the caller (booking-wizard.js) may already have a
        // confirmation box on screen quoting the old value(s) and needs to
        // invalidate/refresh it.
        if ((decedentCorrected || dateCorrected || timeCorrected) && typeof onBookingDetailsCorrected === 'function') {
            onBookingDetailsCorrected();
        }

        updateReadiness();
        if (typeof onStateChanged === 'function') onStateChanged();
    }

    // Citizen-initiated decedent registration requests, continued: this is
    // the entire "notify the citizen" mechanism (deliberately not the
    // shared/global notifications table — it has no per-user targeting, so
    // a private "your request was approved" message doesn't fit it without
    // separate work). Checked once per chat load; ignores rejected requests
    // (out of scope for this batch — see the request-flow plan).
    async function checkMyDecedentRequests() {
        try {
            const requests = await api.request('decedent-requests/mine', { method: 'GET' });
            if (!Array.isArray(requests)) return;
            requests.forEach(request => {
                if (request.status === 'approved') {
                    appendMessage('assistant', `Update: ${request.full_name} has been added to our records — you can book for them now.`);
                } else if (request.status === 'pending') {
                    appendMessage('assistant', `Your request to add ${request.full_name} is still awaiting staff review.`);
                }
            });
        } catch (error) {
            console.error('Failed to check decedent requests', error);
        }
    }

    async function init() {
        setInputEnabled(true);
        if (typeof getDecedents === 'function') await checkMyDecedentRequests();
        // Adviser feedback: leads with budget instead of a hardcoded example
        // naming a specific lot type/section (the booker shouldn't need to
        // already know cemetery terminology), and now also invites decedent/
        // date up front since this is the whole booking interface.
        appendMessage('assistant', "Hi! I'm your Burial Assistant — I can handle the whole reservation right here. Tell me who this is for, your preferred burial date, and your budget (all in one message if you like), and I'll take it from there. Not sure where to start on lot type? Just tap \"Recommend a type for me\" below.");
        appendMessage('assistant', questionForSlot(getNextMissingSlot()));
        updateChips();
        updateReadiness();
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

    chatForm.addEventListener('submit', async function(event) {
        event.preventDefault();
        const text = chatInput.value;
        if (!text.trim()) return;
        chatInput.value = '';
        await processMessage(text);
    });

    return {
        state,
        init,
        isReady: () => state.lot_type !== null && state.budget !== null,
        getPreferences: () => ({
            lot_type: state.lot_type || '',
            budget: state.budget === '' || state.budget === null ? '' : state.budget,
            section: state.section || '',
        }),
        appendMessage,
        appendRichMessage,
        appendOutcomeMessage,
        appendCapacityWarning,
        requestTypeSuggestion,
        reset: performReset,
    };
}
