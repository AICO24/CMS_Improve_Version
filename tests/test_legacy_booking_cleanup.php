<?php
/**
 * Legacy Booking Content & Codebase Cleanup Audit Suite
 *
 * Validates the complete legacy booking cleanup and canonical Unified Booking architecture:
 * TEST 1: Only canonical booking entry points are exposed in primary navigation
 * TEST 2: No duplicate citizen booking workflow or promotional clutter exists on dashboards
 * TEST 3: Obsolete legacy booking assets (cremation-chat-wizard) have been completely removed
 * TEST 4: No dead navigation links point to removed or invalid files
 * TEST 5: Unified Booking workflow (book-a-service -> booking-assistant) is intact
 * TEST 6: Burial booking entry point and redirect contracts remain functional
 * TEST 7: Cremation booking entry point and redirect contracts remain functional
 * TEST 8: Admin operational reservation management modules remain functional and accessible
 * TEST 9: Staff operational reservation management modules remain functional and accessible
 * TEST 10: User booking history (my-bookings.html) is self-contained with native details modal & cancellation
 * TEST 11: No removed asset has orphaned JavaScript references across frontend code
 * TEST 12: No removed asset has orphaned CSS dependencies across frontend templates
 */

$rootDir = dirname(__DIR__);
$passCount = 0;
$failCount = 0;

function assertCondition($testName, $condition, $failureMsg = '') {
    global $passCount, $failCount;
    if ($condition) {
        echo "[PASS] {$testName}\n";
        $passCount++;
    } else {
        echo "[FAIL] {$testName} - {$failureMsg}\n";
        $failCount++;
    }
}

echo "======================================================================\n";
echo "RUNNING LEGACY BOOKING CONTENT & CODEBASE CLEANUP AUDIT SUITE\n";
echo "======================================================================\n";

$navConfig = file_get_contents($rootDir . '/assets/js/shared/navigation-config.js');
$apiJs = file_get_contents($rootDir . '/assets/js/shared/api.js');

// -------------------------------------------------------------
// TEST 1: Only canonical booking entry points in primary navigation
// -------------------------------------------------------------
$bookAServiceInSidebar = preg_match("/route:\s*'book-a-service\.html'[^}]+showInSidebar:\s*true/s", $navConfig);
$bookingAssistantInSidebar = preg_match("/route:\s*'booking-assistant\.html'[^}]+showInSidebar:\s*true/s", $navConfig);
$myBookingsInSidebar = preg_match("/route:\s*'my-bookings\.html'[^}]+showInSidebar:\s*true/s", $navConfig);

$legacyBurialInSidebar = preg_match("/route:\s*'reserve-burial-slot\.html'[^}]+showInSidebar:\s*true/s", $navConfig);
$legacyCremationInSidebar = preg_match("/route:\s*'reserve-cremation\.html'[^}]+showInSidebar:\s*true/s", $navConfig);
$legacyMyReservationsInSidebar = preg_match("/route:\s*'my-reservations\.html'[^}]+showInSidebar:\s*true/s", $navConfig);
$legacyMyCremationsInSidebar = preg_match("/route:\s*'my-cremations\.html'[^}]+showInSidebar:\s*true/s", $navConfig);

$canonicalOnly = $bookAServiceInSidebar && $bookingAssistantInSidebar && $myBookingsInSidebar
    && !$legacyBurialInSidebar && !$legacyCremationInSidebar && !$legacyMyReservationsInSidebar && !$legacyMyCremationsInSidebar;

assertCondition(
    "TEST 1: Only canonical booking entry points are exposed in primary navigation",
    $canonicalOnly,
    "book-a-service, booking-assistant, and my-bookings must be in sidebar; legacy pages must have showInSidebar: false"
);

// -------------------------------------------------------------
// TEST 2: No duplicate citizen booking workflow exists
// -------------------------------------------------------------
$adminDash = file_get_contents($rootDir . '/frontend/pages/dashboard_admin.html');
$staffDash = file_get_contents($rootDir . '/frontend/pages/dashboard_staff.html');

$noAiSuggestAdmin = strpos($adminDash, 'class="card ai-suggest"') === false && strpos($adminDash, 'Need a Lot Recommendation?') === false;
$noAiSuggestStaff = strpos($staffDash, 'class="card ai-suggest"') === false && strpos($staffDash, 'Need a Lot Recommendation?') === false;
$hasOperationalQueuesAdmin = strpos($adminDash, 'class="card operational-queues"') !== false;
$hasOperationalQueuesStaff = strpos($staffDash, 'class="card operational-queues"') !== false;

assertCondition(
    "TEST 2: No duplicate citizen booking workflow exists (promotional clutter removed from dashboards)",
    $noAiSuggestAdmin && $noAiSuggestStaff && $hasOperationalQueuesAdmin && $hasOperationalQueuesStaff,
    "Admin and Staff dashboards must not have obsolete .card.ai-suggest; must have Operational Queues card"
);

// -------------------------------------------------------------
// TEST 3: Obsolete legacy booking assets have been removed
// -------------------------------------------------------------
$cremationChatWizardJsExists = file_exists($rootDir . '/assets/js/shared/cremation-chat-wizard.js');
$cremationChatWizardCssExists = file_exists($rootDir . '/assets/css/cremation-chat-wizard.css');

assertCondition(
    "TEST 3: Legacy booking pages and orphaned assets that were intentionally removed do not exist",
    !$cremationChatWizardJsExists && !$cremationChatWizardCssExists,
    "cremation-chat-wizard.js and cremation-chat-wizard.css must be deleted"
);

// -------------------------------------------------------------
// TEST 4: No dead navigation links point to removed files
// -------------------------------------------------------------
$htmlFiles = glob($rootDir . '/frontend/pages/*.html');
$deadLinksFound = [];

foreach ($htmlFiles as $file) {
    $content = file_get_contents($file);
    if (preg_match_all('/href="([^"#?]+\.html)"/i', $content, $matches)) {
        foreach ($matches[1] as $target) {
            $targetPath = dirname($file) . '/' . $target;
            if (!file_exists($targetPath)) {
                $deadLinksFound[] = basename($file) . " -> " . $target;
            }
        }
    }
}

assertCondition(
    "TEST 4: No dead navigation links point to removed files",
    empty($deadLinksFound),
    "Dead href links found: " . implode(', ', $deadLinksFound)
);

// -------------------------------------------------------------
// TEST 5: Unified Booking workflow remains functional
// -------------------------------------------------------------
$bookServiceHtml = file_get_contents($rootDir . '/frontend/pages/book-a-service.html');
$bookingAssistantHtml = file_get_contents($rootDir . '/frontend/pages/booking-assistant.html');

$hasBurialCta = strpos($bookServiceHtml, 'booking-assistant.html?service=burial') !== false;
$hasCremationCta = strpos($bookServiceHtml, 'booking-assistant.html?service=cremation') !== false;
$hasBmsMount = strpos($bookingAssistantHtml, 'id="bookingAppMount"') !== false || strpos($bookingAssistantHtml, 'id="chatThread"') !== false;

assertCondition(
    "TEST 5: Unified Booking workflow remains functional",
    $hasBurialCta && $hasCremationCta && $hasBmsMount,
    "book-a-service.html must direct to Unified Booking Assistant for both burial and cremation"
);

// -------------------------------------------------------------
// TEST 6: Burial booking remains functional
// -------------------------------------------------------------
$burialRedirectHtml = file_get_contents($rootDir . '/frontend/pages/reserve-burial-slot.html');
$burialRedirects = strpos($burialRedirectHtml, 'booking-assistant.html?service=burial') !== false;

assertCondition(
    "TEST 6: Burial booking remains functional and compatibility redirect is active",
    $burialRedirects,
    "reserve-burial-slot.html must redirect to booking-assistant.html?service=burial"
);

// -------------------------------------------------------------
// TEST 7: Cremation booking remains functional
// -------------------------------------------------------------
$cremRedirectHtml = file_get_contents($rootDir . '/frontend/pages/reserve-cremation.html');
$cremRedirects = strpos($cremRedirectHtml, 'booking-assistant.html?service=cremation') !== false;

assertCondition(
    "TEST 7: Cremation booking remains functional and compatibility redirect is active",
    $cremRedirects,
    "reserve-cremation.html must redirect to booking-assistant.html?service=cremation"
);

// -------------------------------------------------------------
// TEST 8: Admin operational reservation management remains functional
// -------------------------------------------------------------
$adminBurialSched = preg_match("/route:\s*'burial-scheduling\.html'[^}]+allowedRoles:\s*\[[^\]]*'admin'[^\]]*\][^}]+showInSidebar:\s*true/s", $navConfig);
$adminManageRes = preg_match("/route:\s*'manage-reservations\.html'[^}]+allowedRoles:\s*\[[^\]]*'admin'[^\]]*\][^}]+showInSidebar:\s*true/s", $navConfig);
$adminManageCrem = preg_match("/route:\s*'manage-cremations\.html'[^}]+allowedRoles:\s*\[[^\]]*'admin'[^\]]*\][^}]+showInSidebar:\s*true/s", $navConfig);

assertCondition(
    "TEST 8: Admin operational reservation management remains functional",
    $adminBurialSched && $adminManageRes && $adminManageCrem,
    "burial-scheduling, manage-reservations, and manage-cremations must be showInSidebar: true for admin"
);

// -------------------------------------------------------------
// TEST 9: Staff operational workflows remain functional
// -------------------------------------------------------------
$staffBurialSched = preg_match("/route:\s*'burial-scheduling\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\][^}]+showInSidebar:\s*true/s", $navConfig);
$staffManageRes = preg_match("/route:\s*'manage-reservations\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\][^}]+showInSidebar:\s*true/s", $navConfig);
$staffManageCrem = preg_match("/route:\s*'manage-cremations\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\][^}]+showInSidebar:\s*true/s", $navConfig);

assertCondition(
    "TEST 9: Staff operational workflows remain functional",
    $staffBurialSched && $staffManageRes && $staffManageCrem,
    "burial-scheduling, manage-reservations, and manage-cremations must be showInSidebar: true for staff"
);

// -------------------------------------------------------------
// TEST 10: User booking history remains functional & self-contained
// -------------------------------------------------------------
$myBookingsHtml = file_get_contents($rootDir . '/frontend/pages/my-bookings.html');
$myBookingsJs = file_get_contents($rootDir . '/assets/js/pages/my-bookings.js');

$hasDetailModal = strpos($myBookingsHtml, 'id="bookingDetailModal"') !== false;
$hasOpenBookingDetails = strpos($myBookingsJs, 'openBookingDetails') !== false;
$hasCancelHandler = strpos($myBookingsJs, 'cancelBookingBtn') !== false || strpos($myBookingsJs, 'cancel') !== false;

assertCondition(
    "TEST 10: User booking history remains functional with self-contained details & cancellation",
    $hasDetailModal && $hasOpenBookingDetails && $hasCancelHandler,
    "my-bookings.html must contain #bookingDetailModal and my-bookings.js must implement openBookingDetails and cancel handlers"
);

// -------------------------------------------------------------
// TEST 11: No removed page or asset has orphaned JavaScript references
// -------------------------------------------------------------
$jsFiles = glob($rootDir . '/assets/js/**/*.js');
$orphanedJsRefs = [];

foreach ($jsFiles as $file) {
    $content = file_get_contents($file);
    if (strpos($content, 'cremation-chat-wizard') !== false) {
        $orphanedJsRefs[] = basename($file) . " references cremation-chat-wizard";
    }
}

assertCondition(
    "TEST 11: No removed asset has orphaned JavaScript references",
    empty($orphanedJsRefs),
    "Orphaned JS references found: " . implode(', ', $orphanedJsRefs)
);

// -------------------------------------------------------------
// TEST 12: No removed page or asset has orphaned CSS dependencies
// -------------------------------------------------------------
$orphanedCssRefs = [];

foreach ($htmlFiles as $file) {
    $content = file_get_contents($file);
    if (strpos($content, 'cremation-chat-wizard.css') !== false) {
        $orphanedCssRefs[] = basename($file) . " loads cremation-chat-wizard.css";
    }
}

assertCondition(
    "TEST 12: No removed asset has orphaned CSS dependencies",
    empty($orphanedCssRefs),
    "Orphaned CSS link references found: " . implode(', ', $orphanedCssRefs)
);

echo "======================================================================\n";
echo "AUDIT RESULTS: {$passCount} PASSED, {$failCount} FAILED\n";
echo "======================================================================\n";

if ($failCount > 0) {
    exit(1);
}
exit(0);
