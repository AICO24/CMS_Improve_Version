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
// Batch N3 (adviser feedback 2026-08-18): captures decedent/date/time from
// chat too, so the booker doesn't have to fill out the separate "Booking
// Details" form by hand. These are DETERMINISTIC ONLY (name/date/time
// pattern-matching against the real decedent list) — deliberately no LLM
// fallback here, unlike lot_type/budget/section's ai/extract path, since
// M3's stated privacy contract is to never send decedent/user/booking data
// to the LLM endpoint. An ambiguous or unparsed message just falls through
// to the always-visible Booking Details fields as a manual fallback — chat
// never silently guesses which family member or date the booker meant.
//
// createLotChatAssistant(options) -> assistant
//   options.chatWindow, chatForm, chatInput, chatFindLotsBtn, chatPrefStatus:
//     the DOM elements (same markup/IDs used by burial-scheduling.html).
//   options.getLotTypes(), options.getSections(): return the live lookup
//     arrays ({type_name}/{section_name} objects) at call time.
//   options.getDecedents(): returns the live decedent list ({decedent_id,
//     first_name, last_name}) at call time. Optional — decedent extraction
//     is skipped entirely if omitted.
//   options.validateDate(dateStr): optional, returns {valid, reason} — used
//     to apply the same past-date/Monday-block business rules the Booking
//     Details date field already enforces, so a chat-parsed date can never
//     bypass them.
//   options.onDetailExtracted(field, value): optional, called whenever chat
//     resolves 'decedent_id' | 'date' | 'time' — the caller applies it to
//     the corresponding Booking Details form field.
//   options.onReady(isReady): optional, called whenever readiness changes
//     (assistant already disables/enables chatFindLotsBtn itself; use this
//     only if the page needs to react further).
//
// assistant.init(): greets the user and asks the first question.
// assistant.state: { lot_type, budget, section, decedent_id, date, time } —
//   null until captured, '' means "explicitly no preference" (lot_type/
//   budget/section only — decedent/date/time have no "no preference").
// assistant.isReady(): true once lot_type/budget are captured/skipped (the
//   same two slots that have always gated the recommendation search;
//   decedent/date/time stay optional in chat since the Booking Details
//   fields remain the authoritative, independently-validated source for
//   them — see the module comment above).
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
        chatSuggestTypeBtn,
        chatPrefStatus,
        getLotTypes,
        getSections,
        getDecedents,
        validateDate,
        onDetailExtracted,
        onReady,
    } = options;

    const CHAT_SKIP_PHRASES = ['any', 'anything', 'no preference', 'not sure', "doesn't matter", 'does not matter', 'skip', "i don't know", 'idk', 'n/a', 'none', 'whatever'];
    const MONTH_NAMES = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'];
    const MONTH_ABBR = MONTH_NAMES.map(m => m.slice(0, 3));

    const state = { lot_type: null, budget: null, section: null, decedent_id: null, date: null, time: null };
    let decedentLabel = null;

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
        const hasCurrencySymbol = /[₱$]/.test(text);
        const cleaned = text.replace(/[₱$]/g, '').replace(/,/g, '');
        const match = cleaned.match(/(\d+(?:\.\d+)?)\s*(k)?\b/i);
        if (!match) return null;
        let value = parseFloat(match[1]);
        if (!isFinite(value) || value <= 0) return null;
        const hasKSuffix = Boolean(match[2]);
        if (hasKSuffix) value *= 1000;
        // Batch N3: since a message can now also carry a date/day-of-month
        // in the same breath ("December 25, 2026"), require an explicit
        // currency symbol, a k-suffix, or a value already in a plausible
        // lot-price range before accepting it as a budget — otherwise a
        // stray day number would get misread as a ₱25 budget.
        if (!hasCurrencySymbol && !hasKSuffix && value < 1000) return null;
        return Math.round(value);
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
    function getNextMissingSlot() {
        if (state.lot_type === null) return 'lot_type';
        if (state.budget === null) return 'budget';
        return null;
    }

    function questionForSlot(slot) {
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

    function updateFindButtonState() {
        const ready = state.lot_type !== null && state.budget !== null;
        chatFindLotsBtn.disabled = !ready;
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

    async function processMessage(rawText) {
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

        // Everything below is decedent/date/time, which must NOT influence
        // the skip-detection/LLM-fallback decisions further down — those are
        // about whether lot_type/section/budget were found in this message,
        // tracked separately here so a message like "August 25, fifty
        // thousand" still gets the LLM fallback's shot at "fifty thousand"
        // even though the date was already resolved deterministically.
        const corePrefUpdateCount = Object.keys(updates).length;

        // Batch N3: decedent/date/time are captured opportunistically on
        // every message (like section already was) rather than gating the
        // lot_type/budget question sequence — the always-visible Booking
        // Details fields remain the authoritative source for them, so chat
        // is a convenience, not a new requirement.
        let newDecedentLabel = null;
        let ambiguousDecedentCandidates = null;
        if (state.decedent_id === null) {
            const decedentResult = extractDecedentFromText(text);
            if (decedentResult.match) {
                updates.decedent_id = decedentResult.match.decedent_id;
                newDecedentLabel = `${decedentResult.match.first_name} ${decedentResult.match.last_name}`;
            } else if (decedentResult.ambiguous) {
                ambiguousDecedentCandidates = decedentResult.candidates;
            }
        }

        let dateValidationError = null;
        if (state.date === null) {
            const parsedDate = extractDateFromText(text);
            if (parsedDate) {
                const validation = typeof validateDate === 'function' ? validateDate(parsedDate) : { valid: true };
                if (validation.valid) {
                    updates.date = parsedDate;
                } else {
                    dateValidationError = validation.reason;
                }
            }
        }

        if (state.time === null) {
            const parsedTime = extractTimeFromText(text);
            if (parsedTime) updates.time = parsedTime;
        }

        // Only treat the message as an explicit "skip" for the currently
        // pending slot, and only when nothing else was recognized in it —
        // avoids misreading unrelated text as a skip.
        if (pendingSlot && updates[pendingSlot] === undefined && corePrefUpdateCount === 0 && isChatSkipMessage(text)) {
            updates[pendingSlot] = '';
        }

        // Batch M3: deterministic parsing found nothing usable at all — try
        // the optional LLM-assisted fallback before giving up and asking the
        // user to rephrase. Covers phrasing the regex extractors can't, e.g.
        // "around 50k for my dad" or "I don't know, you decide" for whichever
        // slot is currently pending. Gated on corePrefUpdateCount (not the
        // now-larger `updates`) so a resolved date/decedent/time never
        // silently suppresses this fallback for lot_type/budget.
        let recommendTypeRequested = false;
        if (pendingSlot && corePrefUpdateCount === 0 && updates[pendingSlot] === undefined) {
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
            acknowledgements.push(updates.lot_type ? `Got it — ${updates.lot_type}.` : "Okay, no preference on lot type.");
        }
        if (updates.budget !== undefined) {
            acknowledgements.push(updates.budget !== '' ? `Noted — budget around ${formatBudget(updates.budget)}.` : "No problem, I won't filter by budget.");
        }
        if (updates.section !== undefined) {
            acknowledgements.push(updates.section ? `Noted — ${updates.section}.` : 'Okay, any section works.');
        }
        // Batch N3: decedent/date/time acknowledgements — folded into the
        // same array as lot_type/budget/section so a message that only
        // conveyed one of these (e.g. just a date) shows a positive
        // acknowledgement instead of falling through to the "I couldn't
        // match that" clarification meant for lot_type/budget.
        if (updates.decedent_id !== undefined) {
            decedentLabel = newDecedentLabel;
            acknowledgements.push(`Got it — this booking is for ${newDecedentLabel}.`);
            if (typeof onDetailExtracted === 'function') onDetailExtracted('decedent_id', updates.decedent_id);
        }
        if (updates.date !== undefined) {
            acknowledgements.push(`Burial date set to ${formatDateLabel(updates.date)}.`);
            if (typeof onDetailExtracted === 'function') onDetailExtracted('date', updates.date);
        }
        if (updates.time !== undefined) {
            acknowledgements.push(`Time noted as ${formatTimeLabel(updates.time)}.`);
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
        }

        // Batch N3: these are independent asides about the decedent/date
        // parsing attempt itself — always surfaced when present, regardless
        // of what else happened in this turn (e.g. a message can both
        // resolve a budget AND hit an ambiguous decedent name).
        if (ambiguousDecedentCandidates && ambiguousDecedentCandidates.length) {
            const names = ambiguousDecedentCandidates.slice(0, 5).map(d => `${d.first_name} ${d.last_name}`).join(', ');
            appendMessage('assistant', `I found more than one matching record: ${names}. Please pick the correct one from the Decedent dropdown above.`);
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
        } else if (!nextSlot) {
            appendMessage('assistant', 'Thanks! I have enough information to search for matching lots.');
            // Batch N3: decedent/date aren't gating slots (see the module
            // comment), but "Find Matching Lots" still needs them — nudge
            // once lot preferences are otherwise complete instead of letting
            // the user hit the button and only find out from an alert().
            const stillNeeded = [];
            if (state.decedent_id === null) stillNeeded.push('who this booking is for');
            if (state.date === null) stillNeeded.push('the burial date');
            if (stillNeeded.length) {
                appendMessage('assistant', `Just one more thing — I still need ${stillNeeded.join(' and ')}. You can tell me here, or fill it in on the left.`);
            }
        }

        updateFindButtonState();
    }

    function init() {
        setInputEnabled(true);
        // Adviser feedback (2026-08-18): the old welcome message modeled an
        // example that named a specific lot type and section, implying the
        // booker needs to already know the cemetery's layout/terminology.
        // Lead with the budget instead — the one detail a booker naturally
        // knows — and let the AI recommend the type/lot from there.
        appendMessage('assistant', "Hi! You can just tell me who this is for, your preferred burial date, and your budget, all in one message if you like — I'll pick it up and recommend a lot type and specific lots for you. Not sure where to start? Just tap \"Recommend a type for me\" below.");
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
        appendOutcomeMessage,
        appendCapacityWarning,
        requestTypeSuggestion,
    };
}
