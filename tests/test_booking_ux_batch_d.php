<?php
/**
 * Test Suite: Unified Booking Remediation — Batch D
 * 
 * Verifies:
 * 1. Pre-selected service context in intake greeting & contextual starter chips.
 * 2. Post-commitment prompt chips gating (COMMITTED and AWAITING_CONFIRM).
 * 3. Digital voucher navigation link to My Bookings and print button.
 * 4. Human-readable status mapping (no raw BMS database enum exposure).
 * 5. Modal dialog ARIA accessibility attributes and opener focus restoration.
 * 6. Responsive media queries for tablet (side-by-side) and mobile (column stack).
 * 7. My Bookings summary stat cards with dark theme token integration.
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
echo "RUNNING BATCH D UX POLISH & END-TO-END FLOW VALIDATION SUITE\n";
echo "==============================================================\n";

$htmlAssistantPath = $rootDir . '/frontend/pages/booking-assistant.html';
$jsAssistantPath = $rootDir . '/assets/js/pages/booking-assistant.js';
$cssChatPath = $rootDir . '/assets/css/booking-chat.css';
$htmlMyBookingsPath = $rootDir . '/frontend/pages/my-bookings.html';
$jsMyBookingsPath = $rootDir . '/assets/js/pages/my-bookings.js';

$htmlAssistant = file_get_contents($htmlAssistantPath);
$jsAssistant = file_get_contents($jsAssistantPath);
$cssChat = file_get_contents($cssChatPath);
$htmlMyBookings = file_get_contents($htmlMyBookingsPath);
$jsMyBookings = file_get_contents($jsMyBookingsPath);

// -------------------------------------------------------------
// TEST 1: Service-Specific Intake Greeting & Starter Chips
// -------------------------------------------------------------
$hasBurialGreeting = strpos($jsAssistant, "state.serviceType === 'burial'") !== false && strpos($jsAssistant, 'arranging a **burial service**') !== false;
$hasCremationGreeting = strpos($jsAssistant, "state.serviceType === 'cremation'") !== false && strpos($jsAssistant, 'arranging a **cremation service**') !== false;
$hasFallbackGreeting = strpos($jsAssistant, 'arranging a **burial** or **cremation** service') !== false;

assertCondition(
    "TEST 1: Intake greeting respects pre-selected service context without asking user to choose twice",
    $hasBurialGreeting && $hasCremationGreeting && $hasFallbackGreeting,
    "Expected tailored greetings for burial and cremation plus fallback choice greeting"
);

// -------------------------------------------------------------
// TEST 2: Post-Commitment Prompt Chips Gating
// -------------------------------------------------------------
$hasCommittedChipsGating = (bool) preg_match('/if\s*\((state\.status\s*===\s*\'COMMITTED\'\s*\|\|\s*state\.status\s*===\s*\'AWAITING_CONFIRM\'|state\.status\s*===\s*\'AWAITING_CONFIRM\'\s*\|\|\s*state\.status\s*===\s*\'COMMITTED\')\)/', $jsAssistant);
$hasMyBookingsActionChip = (bool) preg_match('/View in My Bookings[\s\S]*?my-bookings\.html/', $jsAssistant);
$hasRestartActionChip = (bool) preg_match('/Book Another Service[\s\S]*?onRestartDraft/', $jsAssistant);

assertCondition(
    "TEST 2: Committed and confirmed drafts display appropriate post-booking action chips",
    $hasCommittedChipsGating && $hasMyBookingsActionChip && $hasRestartActionChip,
    "Expected COMMITTED status to offer My Bookings navigation and Book Another Service instead of info prompt"
);

// -------------------------------------------------------------
// TEST 3: Digital Voucher Navigation & Actions
// -------------------------------------------------------------
$hasVoucherMyBookingsLink = (bool) preg_match('/href="my-bookings\.html"[\s\S]*?My Bookings/i', $jsAssistant);
$hasVoucherPrintBtn = (bool) preg_match('/onclick="window\.print\(\)"[\s\S]*?Print/i', $jsAssistant);

assertCondition(
    "TEST 3: Reservation voucher includes direct navigation to My Bookings and print option",
    $hasVoucherMyBookingsLink && $hasVoucherPrintBtn,
    "Expected voucher to contain My Bookings link and window.print button"
);

// -------------------------------------------------------------
// TEST 4: Human-Readable Status Mapping (No Raw BMS Enums)
// -------------------------------------------------------------
$assistantHidesRawEnums = (bool) preg_match('/\'READY_FOR_REVIEW\':\s*\'Ready to Confirm\'/', $jsAssistant)
    && (bool) preg_match('/\'COLLECTING_INFO\':\s*\'Gathering Details\'/', $jsAssistant)
    && (bool) preg_match('/\'COMMITTED\':\s*\'Submitted \(Pending Review\)\'/', $jsAssistant);

$hasMyBookingsStatusFn = (bool) preg_match('/function formatBookingStatus\(/', $jsMyBookings);
$myBookingsHidesRawEnums = (bool) preg_match('/formatBookingStatus\(item\.status,\s*isDraft\)/', $jsMyBookings);

assertCondition(
    "TEST 4: Citizen UI translates raw BMS database enums into human-readable workflow statuses",
    $assistantHidesRawEnums && $hasMyBookingsStatusFn && $myBookingsHidesRawEnums,
    "Expected formatStatusLabel and formatBookingStatus to translate READY_FOR_REVIEW, COLLECTING_INFO, and COMMITTED"
);

// -------------------------------------------------------------
// TEST 5: Modal Accessibility & Focus Restoration
// -------------------------------------------------------------
$hasLotPickerAria = (bool) preg_match('/id="lotPickerModal"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="lotPickerTitle"/', $htmlAssistant);
$hasFieldEditAria = (bool) preg_match('/id="fieldEditModal"[\s\S]*?role="dialog"[\s\S]*?aria-modal="true"[\s\S]*?aria-labelledby="fieldEditTitle"/', $htmlAssistant);
$hasOpenerFocusRestoration = (bool) preg_match('/lastFocusedElementBeforeModal\s*=\s*\(document\.activeElement/', $jsAssistant)
    && (bool) preg_match('/lastFocusedElementBeforeModal\.focus\(\)/', $jsAssistant);
$hasLotFilterAutoFocus = (bool) preg_match('/if\s*\(lotSearchFilter\)\s*lotSearchFilter\.focus\(\);/', $jsAssistant);

assertCondition(
    "TEST 5: Modal dialogs possess ARIA accessibility roles and restore focus to opener element",
    $hasLotPickerAria && $hasFieldEditAria && $hasOpenerFocusRestoration && $hasLotFilterAutoFocus,
    "Expected role=dialog, aria-modal=true, and focus restoration to opener element with search filter autofocus"
);

// -------------------------------------------------------------
// TEST 6: Responsive Breakpoints for Tablet and Mobile
// -------------------------------------------------------------
$hasTabletMedia = (bool) preg_match('/@media\s*\(min-width:\s*769px\)\s*and\s*\(max-width:\s*1024px\)[\s\S]*?\.ai-booking-blueprint\s*\{[^}]*width:\s*280px;/s', $cssChat);
$hasMobileMedia = (bool) preg_match('/@media\s*\(max-width:\s*768px\)[\s\S]*?\.content-area\s*\{[^}]*overflow-y:\s*auto[\s\S]*?\.ai-chat-layout\s*\{[^}]*flex-direction:\s*column;/s', $cssChat);

assertCondition(
    "TEST 6: CSS implements responsive layouts: proportional side-by-side on tablet, vertical stack on mobile",
    $hasTabletMedia && $hasMobileMedia,
    "Expected tablet 769-1024px side-by-side with 280px blueprint and mobile <=768px column layout with vertical scroll"
);

// -------------------------------------------------------------
// TEST 7: My Bookings Summary Stats Dark Mode Support
// -------------------------------------------------------------
$hasStatClasses = (bool) preg_match('/class="booking-stats-grid"/', $htmlMyBookings)
    && (bool) preg_match('/class="stat-card-item stat-card-total"/', $htmlMyBookings);
$hasDarkThemeTokens = (bool) preg_match('/\[data-theme="dark"\]\s*\.stat-card-total\s*\{[^}]*background:\s*#1e293b;/s', $htmlMyBookings)
    && (bool) preg_match('/\[data-theme="dark"\]\s*\.stat-card-burials\s*\{/s', $htmlMyBookings);

assertCondition(
    "TEST 7: My Bookings summary stats use semantic classes and adapt to dark theme tokens",
    $hasStatClasses && $hasDarkThemeTokens,
    "Expected .booking-stats-grid classes and [data-theme='dark'] overrides in my-bookings.html"
);

// -------------------------------------------------------------
// FINAL SUMMARY
// -------------------------------------------------------------
echo "\n==============================================================\n";
echo "BATCH D AUDIT RESULTS: {$passCount} PASSED, {$failCount} FAILED\n";
echo "==============================================================\n";

if ($failCount > 0) {
    exit(1);
}
exit(0);
