<?php
/**
 * Test Suite: Unified Booking Remediation — Batch C: Send Button & Chat Interaction Fixes
 * 
 * Verifies:
 * 1. Send button handler is wired and form wrapper is authoritative.
 * 2. Valid message triggers booking chat request structure.
 * 3. Empty message is rejected safely without firing network calls.
 * 4. Send button recovers after API error (finally block guarantees reset).
 * 5. Send button recovers after exception / rate limit cooldown.
 * 6. Duplicate rapid submissions are guarded.
 * 7. Suggestion chips trigger expected messages and guard during loading.
 * 8. Restart session works and properly cancels draft.
 * 9. Edit field interaction works (modal open, submit, cancel, Escape dismiss).
 * 10. Lot picker interaction works (modal open, filter, select, Escape dismiss).
 * 11. Confirm button only activates at backend-authoritative readiness.
 * 12. Modal close actions restore clickability and manage body scroll lock.
 * 13. No invisible overlay blocks the chat composer (CSS z-index & display: none).
 * 14. Book-a-service actions route correctly with query parameters.
 * 15. My-bookings Resume Booking action preserves draft ID.
 * 16. Voucher HTML duplication is eliminated.
 */

$rootDir = dirname(__DIR__);
$passCount = 0;
$failCount = 0;

function assertCondition($name, $condition, $details = '') {
    global $passCount, $failCount;
    if ($condition) {
        echo "[PASS] {$name}\n";
        $passCount++;
    } else {
        echo "[FAIL] {$name}: {$details}\n";
        $failCount++;
    }
}

echo "==============================================================\n";
echo "RUNNING BATCH C INTERACTION & SEND BUTTON AUDIT\n";
echo "==============================================================\n";

$htmlPath = $rootDir . '/frontend/pages/booking-assistant.html';
$jsPath = $rootDir . '/assets/js/pages/booking-assistant.js';
$cssPath = $rootDir . '/assets/css/booking-chat.css';
$bookServiceHtmlPath = $rootDir . '/frontend/pages/book-a-service.html';
$myBookingsJsPath = $rootDir . '/assets/js/pages/my-bookings.js';

$htmlContent = file_get_contents($htmlPath);
$jsContent = file_get_contents($jsPath);
$cssContent = file_get_contents($cssPath);
$bookServiceHtmlContent = file_get_contents($bookServiceHtmlPath);
$myBookingsJsContent = file_get_contents($myBookingsJsPath);

// -------------------------------------------------------------
// TEST 1: DOM Structure — Authoritative Form Wrapper & Submit Button
// -------------------------------------------------------------
$hasFormWrapper = (bool) preg_match('/<form\s+id="chatComposerForm"\s+class="chat-input-row"[^>]*>/', $htmlContent);
$hasSubmitBtn = (bool) preg_match('/<button\s+type="submit"\s+class="chat-send-btn"\s+id="btnSendMessage"[^>]*disabled/', $htmlContent);
$hasInputMsg = (bool) preg_match('/<input\s+type="text"\s+id="userInputMsg"/', $htmlContent);

assertCondition(
    "TEST 1: Chat composer DOM uses authoritative form with type=submit disabled button",
    $hasFormWrapper && $hasSubmitBtn && $hasInputMsg,
    "Expected form#chatComposerForm wrapping input#userInputMsg and button#btnSendMessage with type=submit"
);

// -------------------------------------------------------------
// TEST 2: Synchronous Event Binding on Initialization
// -------------------------------------------------------------
// Verifies that cacheDOMElements(), bindEvents(), and updateSendButtonState() are called synchronously before await requireRole
$syncBindingBeforeAwait = (bool) preg_match('/cacheDOMElements\(\);\s*bindEvents\(\);\s*updateSendButtonState\(\);.*?try\s*\{\s*if\s*\(typeof requireRole/s', $jsContent);
$hasInitGuard = (bool) preg_match('/let isInitialized = false;.*?if\s*\(isInitialized\)\s*return;\s*isInitialized = true;/s', $jsContent);

assertCondition(
    "TEST 2: Event bindings are attached synchronously on DOM load with idempotency guard",
    $syncBindingBeforeAwait && $hasInitGuard,
    "Expected synchronous cacheDOMElements & bindEvents before await requireRole, protected by isInitialized"
);

// -------------------------------------------------------------
// TEST 3: Authoritative Form Submit Handler with preventDefault
// -------------------------------------------------------------
$hasFormSubmitBinding = (bool) preg_match('/chatComposerForm\.addEventListener\(\'submit\',\s*onComposerSubmit\)/', $jsContent);
$hasComposerSubmitFn = (bool) preg_match('/async function onComposerSubmit\(e\)\s*\{[^}]*e\.preventDefault\(\)/', $jsContent);

assertCondition(
    "TEST 3: Form submission is handled authoritatively with preventDefault",
    $hasFormSubmitBinding && $hasComposerSubmitFn,
    "Expected chatComposerForm.addEventListener('submit', onComposerSubmit) with e.preventDefault()"
);

// -------------------------------------------------------------
// TEST 4: Dynamic Send Button State Synchronization (Empty vs Populated)
// -------------------------------------------------------------
$hasInputListener = (bool) preg_match('/userInputMsg\.addEventListener\(\'input\',\s*updateSendButtonState\)/', $jsContent);
$hasUpdateStateFn = (bool) preg_match('/function updateSendButtonState\(\)\s*\{.*?btnSendMessage\.disabled\s*=\s*text\.length\s*===\s*0/s', $jsContent);

assertCondition(
    "TEST 4: Send button synchronizes disabled state dynamically with input length",
    $hasInputListener && $hasUpdateStateFn,
    "Expected input listener on userInputMsg calling updateSendButtonState and disabling button when text.length === 0"
);

// -------------------------------------------------------------
// TEST 5: Empty and Whitespace Message Safety
// -------------------------------------------------------------
$hasEmptyValidation = (bool) preg_match('/const text = userInputMsg \? userInputMsg\.value\.trim\(\) : \'\';\s*if\s*\(!text\)\s*\{.*?userInputMsg\.focus\(\)/s', $jsContent);
$hasInputCue = (bool) preg_match('/chat-input-cue/', $jsContent) && (bool) preg_match('/\.chat-input-cue/', $cssContent);

assertCondition(
    "TEST 5: Empty and whitespace messages are rejected safely with visual focus cue",
    $hasEmptyValidation && $hasInputCue,
    "Expected early return on !text with userInputMsg.focus() and chat-input-cue animation"
);

// -------------------------------------------------------------
// TEST 6: Duplicate Rapid Submissions Concurrency Lock
// -------------------------------------------------------------
$hasLoadingGuard = (bool) preg_match('/if\s*\(state\.isLoading\)\s*return;.*?setLoading\(true\);.*?userInputMsg\.value\s*=\s*\'\';/s', $jsContent);

assertCondition(
    "TEST 6: Rapid concurrent submissions are blocked by immediate loading lock",
    $hasLoadingGuard,
    "Expected if (state.isLoading) return followed immediately by setLoading(true)"
);

// -------------------------------------------------------------
// TEST 7: Guaranteed Send Button Recovery on Error (finally Block)
// -------------------------------------------------------------
$hasFinallyRecovery = (bool) preg_match('/finally\s*\{[^}]*setLoading\(false\);[^}]*updateSendButtonState\(\);/s', $jsContent);
$hasRateLimitCooldown = (bool) preg_match('/function startRateLimitCooldown\(seconds\)/', $jsContent);

assertCondition(
    "TEST 7: Async lifecycle guarantees button recovery in finally block with 429 cooldown",
    $hasFinallyRecovery && $hasRateLimitCooldown,
    "Expected setLoading(false) and updateSendButtonState() inside finally block, plus startRateLimitCooldown"
);

// -------------------------------------------------------------
// TEST 8: Suggestion Chips Interaction & Loading Guard
// -------------------------------------------------------------
$hasChipLoadingGuard = (bool) preg_match('/function createChip\(text,\s*handler\)\s*\{.*?if\s*\(state\.isLoading\)\s*return;/s', $jsContent);
$hasQuickInputSync = (bool) preg_match('/function sendQuickInput\(prefix\)\s*\{.*?updateSendButtonState\(\);/s', $jsContent);
$hasQuickDateSync = (bool) preg_match('/function sendQuickDate\(relativeOffset\)\s*\{.*?updateSendButtonState\(\);.*?onSendMessage\(\);/s', $jsContent);

assertCondition(
    "TEST 8: Suggestion chips guard against clicks during loading and synchronize send button",
    $hasChipLoadingGuard && $hasQuickInputSync && $hasQuickDateSync,
    "Expected createChip to ignore clicks when state.isLoading, and quick inputs to sync send button"
);

// -------------------------------------------------------------
// TEST 9: Restart Session Server Cancellation and Reset
// -------------------------------------------------------------
$hasRestartHandler = (bool) preg_match('/async function onRestartDraft\(\)\s*\{.*?booking-agent\/drafts\/\$\{state\.draftId\}\/cancel.*?renderIntakeGreeting\(\);/s', $jsContent);

assertCondition(
    "TEST 9: Restart session confirms, cancels server draft, and resets conversation",
    $hasRestartHandler,
    "Expected onRestartDraft to post to cancel endpoint and call renderIntakeGreeting"
);

// -------------------------------------------------------------
// TEST 10: Quick Field Editor Interaction & Scroll Lock
// -------------------------------------------------------------
$hasFieldEditorOpen = (bool) preg_match('/function openFieldEditor\(fieldName\)\s*\{.*?document\.body\.style\.overflow\s*=\s*\'hidden\';.*?fieldEditModal\.style\.display\s*=\s*\'flex\';/s', $jsContent);
$hasFieldEditorClose = (bool) preg_match('/function closeFieldEditor\(\)\s*\{.*?document\.body\.style\.overflow\s*=\s*\'\';/s', $jsContent);
$hasFieldEditorSubmit = (bool) preg_match('/async function onSubmitFieldEdit\(e\)\s*\{.*?await updateDraftField\(field,\s*newVal\);/s', $jsContent);

assertCondition(
    "TEST 10: Field editor modal manages scroll locking, updates draft, and restores focus",
    $hasFieldEditorOpen && $hasFieldEditorClose && $hasFieldEditorSubmit,
    "Expected openFieldEditor and closeFieldEditor to manage body overflow and invoke updateDraftField"
);

// -------------------------------------------------------------
// TEST 11: Lot Picker Modal & Selection Interaction
// -------------------------------------------------------------
$hasLotPickerOpen = (bool) preg_match('/async function openLotPicker\(\)\s*\{.*?document\.body\.style\.overflow\s*=\s*\'hidden\';/s', $jsContent);
$hasLotPickerClose = (bool) preg_match('/function closeLotPicker\(\)\s*\{.*?document\.body\.style\.overflow\s*=\s*\'\';/s', $jsContent);
$hasLotSelectHandler = (bool) preg_match('/await updateDraftField\(\'lot_id\',\s*lot\.lot_id\);/s', $jsContent);
$hasEscapeDismiss = (bool) preg_match('/if\s*\(e\.key\s*===\s*\'Escape\'\s*\|\|\s*e\.key\s*===\s*\'Esc\'\)\s*\{.*?closeLotPicker\(\);.*?closeFieldEditor\(\);/s', $jsContent);

assertCondition(
    "TEST 11: Lot picker manages scroll locking, updates lot_id on select, and dismisses on Escape",
    $hasLotPickerOpen && $hasLotPickerClose && $hasLotSelectHandler && $hasEscapeDismiss,
    "Expected lot picker open/close overflow management, card select handler, and Escape listener"
);

// -------------------------------------------------------------
// TEST 12: Confirmation Button Backend Readiness Gating
// -------------------------------------------------------------
$hasConfirmGating = (bool) preg_match('/const isEligibleToConfirm\s*=\s*\(state\.status\s*===\s*\'READY_FOR_REVIEW\'\s*\|\|\s*state\.isReadyForReview\)\s*&&\s*state\.missingFields\.length\s*===\s*0;/s', $jsContent);
$hasConfirmSubmit = (bool) preg_match('/async function onConfirmBooking\(\)\s*\{.*?booking-agent\/drafts\/\$\{state\.draftId\}\/confirm/s', $jsContent);

assertCondition(
    "TEST 12: Confirm button is strictly gated by backend authoritative readiness",
    $hasConfirmGating && $hasConfirmSubmit,
    "Expected isEligibleToConfirm condition checking READY_FOR_REVIEW, isReadyForReview, and 0 missing fields"
);

// -------------------------------------------------------------
// TEST 13: Stacking Context & Click Blocking Layer Audit
// -------------------------------------------------------------
$hasComposerZIndex = (bool) preg_match('/\.chat-input-row\s*\{[^}]*position:\s*relative;\s*z-index:\s*5;/s', $cssContent);
$hasModalOverlaysHidden = (bool) preg_match('/id="lotPickerModal"\s+style="display:\s*none;"/', $htmlContent) && (bool) preg_match('/id="fieldEditModal"\s+style="display:\s*none;"/', $htmlContent);
$hasPromptChipsEmptyHidden = (bool) preg_match('/\.chat-prompt-suggestions:empty\s*\{[^}]*display:\s*none;/s', $cssContent);

assertCondition(
    "TEST 13: Chat composer has explicit stacking context and modals start display: none",
    $hasComposerZIndex && $hasModalOverlaysHidden && $hasPromptChipsEmptyHidden,
    "Expected .chat-input-row position: relative; z-index: 5, modals hidden, and prompt suggestions empty: hidden"
);

// -------------------------------------------------------------
// TEST 14: Book-a-Service Routing Actions
// -------------------------------------------------------------
$hasBurialRoute = (bool) preg_match('/href="booking-assistant\.html\?service=burial"/', $bookServiceHtmlContent);
$hasCremationRoute = (bool) preg_match('/href="booking-assistant\.html\?service=cremation"/', $bookServiceHtmlContent);

assertCondition(
    "TEST 14: Book-a-service action buttons route with canonical query parameters",
    $hasBurialRoute && $hasCremationRoute,
    "Expected href='booking-assistant.html?service=burial' and href='booking-assistant.html?service=cremation'"
);

// -------------------------------------------------------------
// TEST 15: My Bookings Resume Draft Preservation
// -------------------------------------------------------------
$hasMyBookingsResumeHref = (bool) preg_match('/booking-assistant\.html\?draft_id=\$\{draft\.draft_id\}/', $myBookingsJsContent)
    && (bool) preg_match('/booking-assistant\.html\?draft_id=\$\{draftId\}/', $myBookingsJsContent);

assertCondition(
    "TEST 15: My Bookings resume actions preserve draft ID query parameter",
    $hasMyBookingsResumeHref,
    "Expected my-bookings.js to construct resume URLs with ?draft_id=\${id}"
);

// -------------------------------------------------------------
// TEST 16: Reservation Voucher Markup Deduplication
// -------------------------------------------------------------
// Check that showVoucherInChat has only one h3 and one status badge inside the header
$voucherExcerpt = '';
if (preg_match('/const voucherHtml\s*=\s*`([\s\S]*?)`;/', $jsContent, $matches)) {
    $voucherExcerpt = $matches[1];
}
$h3Count = substr_count($voucherExcerpt, '<h3');
$shieldCount = substr_count($voucherExcerpt, 'fa-shield-alt');

assertCondition(
    "TEST 16: Reservation voucher has clean, non-duplicated markup",
    $h3Count === 1 && $shieldCount === 1,
    "Expected exactly 1 h3 tag and 1 fa-shield-alt notice in showVoucherInChat, found {$h3Count} h3s and {$shieldCount} notices"
);

// -------------------------------------------------------------
// FINAL SUMMARY
// -------------------------------------------------------------
echo "\n==============================================================\n";
echo "BATCH C AUDIT RESULTS: {$passCount} PASSED, {$failCount} FAILED\n";
echo "==============================================================\n";

if ($failCount > 0) {
    exit(1);
}
exit(0);
