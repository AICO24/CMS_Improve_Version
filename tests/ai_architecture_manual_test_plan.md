# AI Architecture — Manual Test Plan (BATCH AI-9)

Verifies BATCH AI-1 through AI-8 (AI Architecture Audit, 2026-09-02) against a
live stack. Needs: Laragon running MySQL + the PHP backend, `python-ai/app.py`
running with a real `GEMINI_API_KEY` in `python-ai/.env`, and two logged-in
sessions (one admin, one citizen/`user`). `tests/ai_architecture_regression_test.py`
already proves the code-level fix is in place with no server running; this
proves the live *behavior* matches it — the thing a static test can't check.

For each scenario: the **Setup** puts you in the right state, **Ask** is the
exact message to send, **Expect now** is what AI-2 through AI-8 should
produce. Screenshot or copy the chat transcript for each — that's your
defense evidence.

---

## 1. Cross-module escalation (AI-2) — the original reported symptom

**Setup:** Log in as admin/staff, open **Lot Management**, open the AI
assistant (bottom-right bubble — mounts with `scope: 'module', module: 'Lot'`).

**Ask:** *"How many burial reservations are currently pending?"*
(genuinely a Burial Scheduling question, asked from a page scoped to Lot)

**Expect now:** A real answer with actual pending-reservation information —
**and** the *"Checked beyond this page"* badge (AI-8) under that reply,
confirming the escalated retry (AI-2) fired. Compare against **Dashboard**'s
assistant (`scope: 'system'`) asked the same question — it should answer
without the badge, since it already had system-wide reach on the first call.

**If you want the actual "before" transcript for your defense slide:** the
regressed behavior was "I don't have visibility into that from here" with no
badge option at all (the badge didn't exist before AI-8, and the escalation
retry didn't exist before AI-2). You can reproduce it by checking out the
commit before this audit's changes (`git log` for the commit just before the
first `refactor(ai):` entries from this session), asking the same question,
then returning to your current branch — not required, just the cleanest way
to get a literal side-by-side if your defense wants one.

---

## 2. Booking chat: question mid-slot-fill (AI-3)

**Setup:** Log in as a citizen, open **Reserve Burial Slot**, start a booking.
Let it ask for lot type.

**Ask:** *"Premium Lot, and what happens after I book?"* (one message, both a
slot value and a real question)

**Expect now:** Both handled in the same turn — an acknowledgement of the
Premium Lot selection, the FAQ answer to "what happens after I book?", then
the next question (budget) — not just the slot silently consumed with the
question dropped.

**Follow-up (AI-5 conversation history):** Immediately ask *"and what about
after that?"* — expect a coherent follow-up answer, not a generic
non-sequitur, proving `conversation_history` is actually being used.

---

## 3. Citizen-scoped assistant, own data only (AI-4)

**Setup:** Log in as Citizen A, open **My Reservations**, open the assistant
(`scope: 'module', module: 'Schedule'`).

**Ask:** *"What is the status of my reservations right now?"*

**Expect now:** An answer describing only Citizen A's own reservations.

**Negative check (important — this is the security-relevant one):** Log in as
a *different* citizen (Citizen B) with at least one reservation of their own,
ask the identical question from their own My Reservations page, and confirm
the answer only ever describes Citizen B's records — never Citizen A's.
Repeat both directions on **Payment History** (`module: 'Payment'`).

---

## 4. Citizen assistant stays boundary-limited (AI-4 restriction)

**Setup:** Same citizen session as above, browser dev tools open to the
Network tab (or a REST client) so you can send a raw request.

**Ask (via API, not the UI — the UI never constructs this itself):** POST
`ai/assistant-ask` with `context: { scope: 'system' }` or
`context: { scope: 'entity', entity_type: 'Schedule', entity_id: <someone
else's schedule id> }`, using the citizen's own auth token.

**Expect now:** `403`/error response (`"citizens may only use context.scope =
'module'"`) — not a real answer. This is the check that matters most for your
defense's security section: it proves the citizen restriction is enforced
server-side, not just hidden by the UI.

---

## 5. Rate limiting (AI-7)

**Setup:** Any citizen session, Reserve Burial Slot chat open.

**Ask:** Send 16+ distinct chat messages within one minute (fastest way:
repeatedly ask short FAQ-shaped questions so each one reaches `ai/chat`).

**Expect now:** Somewhere around the 16th request in that minute, a `429`
with *"Too many requests — please wait a moment before trying again."*
instead of a silent hang or an unbounded string of real Gemini calls.

---

## 6. DB access boundary (AI-6) — code review only, not a live test

No live scenario needed — open `python-ai/app.py` at `DB_CONFIG` and
`backend/services/AIService.php` above `getRecommendations()` and confirm
both explain the same two-pattern boundary and point at each other. This is
what "one documented, consistent answer" means for this batch; there's no
runtime behavior to click through.

---

## Recording results

For each numbered scenario, note: date run, pass/fail, and a screenshot or
pasted transcript of the chat exchange. `tests/ai_architecture_regression_test.py`
covers the "is the fix still in the code" half automatically on every future
change — keep both around.
