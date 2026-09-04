// Cremation module audit, Batch K: thin wrapper around the shared
// assets/js/shared/cremation-chat-wizard.js, mirroring reserve-burial-slot.js's
// identical relationship to booking-wizard.js. See that file for the full
// conversational-booking logic and why it's deliberately a scripted 3-step
// flow rather than a port of burial's lot-recommendation NLU engine.
//
// Privacy audit (2026-09-04): a citizen never browses or picks an existing
// decedent here — that would expose other families' names/records. Always
// fresh entry (provisional_decedent); staff match/link it to an existing
// formal decedent_records row on their own side, where full access is
// appropriate. See booking-wizard.js's identical fix for the burial flow.
document.addEventListener('DOMContentLoaded', async function() {
    // Checked here (mirroring my-reservations.js's identical ordering)
    // rather than relying solely on the wizard's own internal check below,
    // so the AI assistant widget never mounts for an unauthenticated visitor
    // even briefly. createCremationChatWizard().init() still does its own
    // requireRole() too — harmless to check twice, and keeps the wizard
    // usable on its own without depending on this ordering.
    const user = await requireRole(['user']);
    if (!user) return;

    // Cremation module audit, Batch F: citizen-scoped AI mount for open-ended
    // questions about the citizen's OWN records — separate from the guided
    // wizard below, which only handles the structured booking fields. See
    // AuditIntelligenceService::buildCitizenModuleContext('Cremation', ...).
    //
    // Bug fix (2026-09-04): the two suggestion chips this originally shipped
    // with ("What do I need?" / "How does payment work?") always answered
    // "I couldn't find enough information" — not a bug in the AI call
    // itself, but a mismatch between what these chips promised and what the
    // grounded context actually contains. AiController::askAssistant()'s
    // citizen path is deliberately fact-only (never invents an answer
    // beyond buildCitizenModuleContext()'s own record/status data — see
    // python-ai/app.py's ASSISTANT_SYSTEM_PROMPT), and that context has no
    // policy/FAQ knowledge (document requirements, how payment works) —
    // only this citizen's own booking records. Replaced with the same two
    // record-status questions my-cremations.js already uses successfully
    // (mirrors that file's identical, already-correct suggestions).
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Cremation' },
        greeting: "Hello! I'm your AI assistant for cremation booking. How can I help you today?",
        suggestions: [
            { icon: 'fa-list-check', label: 'My requests', question: 'What is the status of my cremation requests right now?' },
            { icon: 'fa-clock-rotate-left', label: 'Anything pending?', question: 'Do I have any pending cremation requests, and what do they need?' },
        ],
    });

    createCremationChatWizard({
        onBookingSuccess: ({ cremationId }) => {
            const goToPayment = confirm('Cremation request submitted. Proceed to payment now?');
            if (goToPayment && cremationId) {
                window.location.href = `payments.html?transaction_type=Cremation&cremation_id=${cremationId}`;
            }
        },
    }).init();
});
