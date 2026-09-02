from pathlib import Path
import sys

# BATCH AI-9 (AI Architecture Audit, 2026-09-02): static, zero-dependency
# regression test for BATCH AI-1 through AI-8 — same convention as
# tests/smoke_test.py (source-text assertions only, no live server, no
# database, no LLM API key needed), kept as its own file rather than
# appended to smoke_test.py since that file currently fails for an
# unrelated, pre-existing reason (missing assets/js/pages/login.js) that
# predates and is outside the scope of this audit. Run with:
#   python tests/ai_architecture_regression_test.py
#
# This proves the CODE-LEVEL fix for each batch is still in place — it
# cannot prove the LIVE model behavior (a real Gemini call actually
# answering a cross-module question correctly). For that, see
# tests/ai_architecture_manual_test_plan.md, which walks through capturing
# a real before/after transcript against a running local stack.

ROOT = Path(__file__).resolve().parent.parent

errors = []


def read(rel_path):
    return (ROOT / rel_path).read_text(encoding='utf-8')


# ---------- BATCH AI-1: foundation cleanup ----------
manage_reservations = read('assets/js/pages/manage-reservations.js')
if 'a question about another module still gets answered' in manage_reservations:
    errors.append('AI-1 regression: manage-reservations.js still contains the stale "full system-wide reach" claim')
if 'foundation-cleanup batch (AI-1)' not in manage_reservations:
    errors.append('AI-1 regression: manage-reservations.js is missing its corrected AI-1 comment')

ai_controller = read('backend/controllers/AiController.php')
if "EnvironmentService::get('AI_CONTEXT_DEBUG'" in ai_controller:
    errors.append('AI-1 regression: AiController.php still functionally gates context-size logging behind AI_CONTEXT_DEBUG (should be always-on)')

# ---------- BATCH AI-2: tiered focus-then-escalate fetch ----------
if "in_array($scope, ['entity', 'module']" not in ai_controller:
    errors.append("AI-2 regression: AiController::askAssistant() is missing the entity/module escalation gate")
if "'escalated'" not in ai_controller and '"escalated"' not in ai_controller:
    errors.append('AI-2/AI-8 regression: AiController::askAssistant() no longer returns an `escalated` flag')
if 'set_time_limit' not in ai_controller:
    errors.append('AI-2 regression: AiController::askAssistant() is missing its set_time_limit() guard for the two-call path')

ai_service = read('backend/services/AIService.php')
if '$timeoutSeconds' not in ai_service:
    errors.append('AI-2 regression: AIService.php lost its per-call timeout override (needed for the escalated retry budget)')

# ---------- BATCH AI-3: booking intent pre-check ----------
lot_chat = read('assets/js/shared/lot-chat-assistant.js')
if 'function looksLikeQuestion' not in lot_chat:
    errors.append('AI-3 regression: lot-chat-assistant.js is missing looksLikeQuestion()')
if 'mightBeQuestion' not in lot_chat:
    errors.append('AI-3 regression: lot-chat-assistant.js is missing the mightBeQuestion trigger')

# ---------- BATCH AI-4: citizen-scoped module context ----------
audit_intel = read('backend/services/AuditIntelligenceService.php')
if 'function buildCitizenModuleContext' not in audit_intel:
    errors.append('AI-4 regression: AuditIntelligenceService.php is missing buildCitizenModuleContext()')
if 'function isCitizenModule' not in audit_intel:
    errors.append('AI-4 regression: AuditIntelligenceService.php is missing isCitizenModule()')

api_routes = read('backend/routes/api.php')
if 'askAssistant($input, $user)' not in api_routes:
    errors.append("AI-4 regression: routes/api.php's ai/assistant-ask route no longer threads $user through to askAssistant()")
if "askAssistant($payload, $user = null)" not in ai_controller:
    errors.append('AI-4 regression: AiController::askAssistant() no longer accepts $user')
if "citizens may only use context.scope" not in ai_controller:
    errors.append("AI-4 regression: AiController::askAssistant() is missing its citizen scope='module'-only restriction")

my_reservations_js = read('assets/js/pages/my-reservations.js')
if "module: 'Schedule'" not in my_reservations_js:
    errors.append('AI-4 regression: my-reservations.js is missing its citizen-scoped assistant mount')
payment_history_js = read('assets/js/pages/payment-history.js')
if "module: 'Payment'" not in payment_history_js:
    errors.append('AI-4 regression: payment-history.js is missing its citizen-scoped assistant mount')
for html_file in ['frontend/pages/my-reservations.html', 'frontend/pages/payment-history.html']:
    html_text = read(html_file)
    if 'id="aiAssistantMount"' not in html_text:
        errors.append(f'AI-4 regression: {html_file} is missing the #aiAssistantMount div')
    if 'ai-assistant-widget.js' not in html_text:
        errors.append(f'AI-4 regression: {html_file} no longer loads ai-assistant-widget.js')

# ---------- BATCH AI-5: Q&A conversation history ----------
app_py = read('python-ai/app.py')
if 'conversation_history: Optional[List[Dict[str, Any]]] = None' not in app_py:
    errors.append('AI-5 regression: python-ai/app.py _answer_question() lost its conversation_history parameter')
if 'qaHistory' not in lot_chat:
    errors.append('AI-5 regression: lot-chat-assistant.js is missing its qaHistory tracking')

# ---------- BATCH AI-6: documented DB access boundary ----------
if 'BATCH AI-6' not in app_py:
    errors.append('AI-6 regression: python-ai/app.py is missing its documented DB-access-pattern boundary comment')
if 'BATCH AI-6' not in ai_service:
    errors.append('AI-6 regression: AIService.php is missing its cross-reference to the documented DB-access boundary')

# ---------- BATCH AI-7: rate limiting on citizen-reachable AI routes ----------
for key in ['ai_forecast_', 'ai_narrate_', 'ai_extract_', 'ai_chat_']:
    if f"RateLimiter::allow('{key}" not in api_routes:
        errors.append(f'AI-7 regression: routes/api.php is missing the RateLimiter guard for {key}*')

# ---------- BATCH AI-8: escalated-answer badge ----------
widget_js = read('assets/js/shared/ai-assistant-widget.js')
if 'ai-assistant-escalated-badge' not in widget_js:
    errors.append('AI-8 regression: ai-assistant-widget.js no longer renders the escalated-answer badge')
if 'appendMessage(\'ai\', result.message, result.suggested_action, result.escalated)' not in widget_js:
    errors.append('AI-8 regression: ai-assistant-widget.js no longer passes result.escalated into appendMessage()')
widget_css = read('assets/css/shared/ai-assistant-widget.css')
if '.ai-assistant-escalated-badge' not in widget_css:
    errors.append('AI-8 regression: ai-assistant-widget.css is missing the .ai-assistant-escalated-badge style')

if errors:
    print('AI ARCHITECTURE REGRESSION TEST FAILED')
    for error in errors:
        print(f'- {error}')
    sys.exit(1)

print('AI ARCHITECTURE REGRESSION TEST PASSED (8/8 batches verified)')
