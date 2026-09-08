<?php
/**
 * Test Suite: Legacy Booking Route Minimization & Duplicate Code Consolidation
 * 
 * Verifies that:
 * TEST 1: my-bookings.html remains the canonical Citizen booking history page.
 * TEST 2: Legacy history pages do not contain duplicate full booking table implementations.
 * TEST 3: Legacy history pages do not independently fetch/render duplicate booking history.
 * TEST 4: Legacy history pages redirect or provide minimal compatibility behavior.
 * TEST 5: No primary navigation points to legacy history pages.
 * TEST 6: No canonical workflow unnecessarily depends on legacy history pages.
 * TEST 7: Booking details exist only in the canonical unified booking implementation.
 * TEST 8: Cancellation logic is not duplicated across legacy history pages.
 * TEST 9: Removed JavaScript files have zero orphaned references.
 * TEST 10: Removed CSS files have zero orphaned references.
 * TEST 11: AI architecture regression coverage remains meaningful and aligned with current canonical architecture.
 * TEST 12: Burial and Cremation booking records remain accessible through my-bookings.html.
 * TEST 13: Legacy URLs remain backward compatible where required.
 * TEST 14: RBAC remains unchanged.
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
echo "RUNNING LEGACY BOOKING ROUTE MINIMIZATION & CONSOLIDATION AUDIT SUITE\n";
echo "======================================================================\n";

// -------------------------------------------------------------
// TEST 1: Canonical Citizen booking history page ownership
// -------------------------------------------------------------
$myBookingsHtmlPath = $rootDir . '/frontend/pages/my-bookings.html';
$myBookingsJsPath = $rootDir . '/assets/js/pages/my-bookings.js';

$canonicalFilesExist = file_exists($myBookingsHtmlPath) && file_exists($myBookingsJsPath);
$myBookingsHtml = $canonicalFilesExist ? file_get_contents($myBookingsHtmlPath) : '';
$myBookingsJs = $canonicalFilesExist ? file_get_contents($myBookingsJsPath) : '';

$hasTableMount = strpos($myBookingsHtml, 'id="bookingsTableBody"') !== false;
$hasFilterDropdown = strpos($myBookingsHtml, 'id="bookingTypeFilter"') !== false;
$hasSearchBox = strpos($myBookingsHtml, 'id="bookingSearchInput"') !== false;
$hasDetailModal = strpos($myBookingsHtml, 'id="bookingDetailModal"') !== false;
$loadsCanonicalJs = strpos($myBookingsHtml, 'assets/js/pages/my-bookings.js') !== false;

assertCondition(
    "TEST 1: my-bookings.html remains the canonical Citizen booking history page",
    $canonicalFilesExist && $hasTableMount && $hasFilterDropdown && $hasSearchBox && $hasDetailModal && $loadsCanonicalJs,
    "my-bookings.html must exist and contain complete canonical dashboard elements and script"
);

// -------------------------------------------------------------
// TEST 2: Legacy history pages do not contain duplicate full booking table implementations
// -------------------------------------------------------------
$myReservationsHtml = file_get_contents($rootDir . '/frontend/pages/my-reservations.html');
$myCremationsHtml = file_get_contents($rootDir . '/frontend/pages/my-cremations.html');
$burialSchedHtml = file_get_contents($rootDir . '/frontend/pages/burial-scheduling.html');

$noTablesInMyRes = strpos($myReservationsHtml, '<table') === false && strpos($myReservationsHtml, 'reservationsTable') === false;
$noTablesInMyCrem = strpos($myCremationsHtml, '<table') === false && strpos($myCremationsHtml, 'cremationsTable') === false;
$noWizardInBurialSched = strpos($burialSchedHtml, 'booking-wizard.js') === false && strpos($burialSchedHtml, 'id="wizardContainerMount"') === false;

assertCondition(
    "TEST 2: Legacy history pages do not contain duplicate full booking table implementations",
    $noTablesInMyRes && $noTablesInMyCrem && $noWizardInBurialSched,
    "Legacy history pages (my-reservations, my-cremations, burial-scheduling) must not contain duplicate tables or wizard markup"
);

// -------------------------------------------------------------
// TEST 3: Legacy history pages do not independently fetch/render duplicate booking history
// -------------------------------------------------------------
$noLegacyJsInRes = strpos($myReservationsHtml, 'my-reservations.js') === false;
$noLegacyJsInCrem = strpos($myCremationsHtml, 'my-cremations.js') === false;
$noApiFetchInRes = strpos($myReservationsHtml, 'api.request') === false && strpos($myReservationsHtml, 'getSchedules') === false;
$noApiFetchInCrem = strpos($myCremationsHtml, 'api.request') === false && strpos($myCremationsHtml, 'getCremations') === false;

assertCondition(
    "TEST 3: Legacy history pages do not independently fetch/render duplicate booking history unless explicitly required",
    $noLegacyJsInRes && $noLegacyJsInCrem && $noApiFetchInRes && $noApiFetchInCrem,
    "Legacy history pages must not load legacy controller scripts or execute independent API fetch routines"
);

// -------------------------------------------------------------
// TEST 4: Legacy history pages redirect or provide minimal compatibility behavior
// -------------------------------------------------------------
$resRedirects = (strpos($myReservationsHtml, 'my-bookings.html?type=burial') !== false) &&
                (strpos($myReservationsHtml, 'http-equiv="refresh"') !== false) &&
                (strpos($myReservationsHtml, 'window.location.replace') !== false);

$cremRedirects = (strpos($myCremationsHtml, 'my-bookings.html?type=cremation') !== false) &&
                 (strpos($myCremationsHtml, 'http-equiv="refresh"') !== false) &&
                 (strpos($myCremationsHtml, 'window.location.replace') !== false);

$burialSchedRedirects = (strpos($burialSchedHtml, 'booking-assistant.html?service=burial') !== false) &&
                        (strpos($burialSchedHtml, 'http-equiv="refresh"') !== false) &&
                        (strpos($burialSchedHtml, 'window.location.replace') !== false);

assertCondition(
    "TEST 4: Legacy history pages redirect or provide minimal compatibility behavior",
    $resRedirects && $cremRedirects && $burialSchedRedirects,
    "my-reservations.html, my-cremations.html, and burial-scheduling.html must provide meta refresh and window.location.replace redirects"
);

// -------------------------------------------------------------
// TEST 5: No primary navigation points to legacy history pages
// -------------------------------------------------------------
$navConfig = file_get_contents($rootDir . '/assets/js/shared/navigation-config.js');
$htmlPages = glob($rootDir . '/frontend/pages/*.html');

$legacyResHidden = preg_match("/route:\s*'my-reservations\.html'[^}]+showInSidebar:\s*false/s", $navConfig);
$legacyCremHidden = preg_match("/route:\s*'my-cremations\.html'[^}]+showInSidebar:\s*false/s", $navConfig);
$legacyBurialSchedHidden = preg_match("/route:\s*'burial-scheduling\.html'[^}]+showInSidebar:\s*false/s", $navConfig);

$legacyResNavLinksFound = [];
$legacyCremNavLinksFound = [];
$legacyBurialSchedNavLinksFound = [];

foreach ($htmlPages as $file) {
    $content = file_get_contents($file);
    // Check if sidebar nav items link to legacy pages
    if (preg_match('/<aside\b[^>]*class="[^"]*sidebar[^"]*"[^>]*>.*?<\/aside>/is', $content, $sidebarMatch)) {
        if (strpos($sidebarMatch[0], 'href="my-reservations.html"') !== false) {
            $legacyResNavLinksFound[] = basename($file);
        }
        if (strpos($sidebarMatch[0], 'href="my-cremations.html"') !== false) {
            $legacyCremNavLinksFound[] = basename($file);
        }
        if (strpos($sidebarMatch[0], 'href="burial-scheduling.html"') !== false) {
            $legacyBurialSchedNavLinksFound[] = basename($file);
        }
    }
}

assertCondition(
    "TEST 5: No primary navigation points to legacy history pages",
    $legacyResHidden && $legacyCremHidden && $legacyBurialSchedHidden && empty($legacyResNavLinksFound) && empty($legacyCremNavLinksFound) && empty($legacyBurialSchedNavLinksFound),
    "Primary navigation must not expose legacy history pages in navigation-config.js or static sidebar markup"
);

// -------------------------------------------------------------
// TEST 6: No canonical workflow unnecessarily depends on legacy history pages
// -------------------------------------------------------------
$bookServiceHtml = file_get_contents($rootDir . '/frontend/pages/book-a-service.html');
$bookingAssistantHtml = file_get_contents($rootDir . '/frontend/pages/booking-assistant.html');
$bookingAssistantJs = file_get_contents($rootDir . '/assets/js/pages/booking-assistant.js');

$noLegacyInBookService = strpos($bookServiceHtml, 'my-reservations.html') === false && strpos($bookServiceHtml, 'my-cremations.html') === false;
$noLegacyInBookingAssistantHtml = strpos($bookingAssistantHtml, 'my-reservations.html') === false && strpos($bookingAssistantHtml, 'my-cremations.html') === false;
$noLegacyInBookingAssistantJs = strpos($bookingAssistantJs, 'my-reservations.html') === false && strpos($bookingAssistantJs, 'my-cremations.html') === false;

assertCondition(
    "TEST 6: No canonical workflow unnecessarily depends on legacy history pages",
    $noLegacyInBookService && $noLegacyInBookingAssistantHtml && $noLegacyInBookingAssistantJs,
    "Canonical booking workflow (book-a-service, booking-assistant, my-bookings) must not link to legacy history pages"
);

// -------------------------------------------------------------
// TEST 7: Booking details exist only in canonical unified booking implementation
// -------------------------------------------------------------
$hasCanonicalDetails = strpos($myBookingsJs, 'openBookingDetails') !== false && strpos($myBookingsHtml, 'id="bookingDetailModal"') !== false;
$noLegacyModalsInRes = strpos($myReservationsHtml, 'reservationDetailModal') === false;
$noLegacyModalsInCrem = strpos($myCremationsHtml, 'cremationDetailModal') === false;

assertCondition(
    "TEST 7: Booking details exist only in the canonical unified booking implementation",
    $hasCanonicalDetails && $noLegacyModalsInRes && $noLegacyModalsInCrem,
    "Booking details modal must be owned by my-bookings and removed from legacy pages"
);

// -------------------------------------------------------------
// TEST 8: Cancellation logic is not duplicated across legacy history pages
// -------------------------------------------------------------
$hasCanonicalCancel = strpos($myBookingsJs, 'cancelBookingBtn') !== false || strpos($myBookingsJs, 'handleCancelBooking') !== false;
$noCancelInRes = strpos($myReservationsHtml, 'cancel') === false;
$noCancelInCrem = strpos($myCremationsHtml, 'cancel') === false;

assertCondition(
    "TEST 8: Cancellation logic is not duplicated across legacy history pages",
    $hasCanonicalCancel && $noCancelInRes && $noCancelInCrem,
    "Cancellation logic must exist in canonical my-bookings.js without duplicate cancellation handlers on legacy pages"
);

// -------------------------------------------------------------
// TEST 9: Removed JavaScript files have zero orphaned references
// -------------------------------------------------------------
$myResJsExists = file_exists($rootDir . '/assets/js/pages/my-reservations.js');
$myCremJsExists = file_exists($rootDir . '/assets/js/pages/my-cremations.js');
$bookingWizardJsExists = file_exists($rootDir . '/assets/js/shared/booking-wizard.js');

$orphanedJsRefs = [];
foreach ($htmlPages as $file) {
    $content = file_get_contents($file);
    if (strpos($content, 'my-reservations.js') !== false) {
        $orphanedJsRefs[] = basename($file) . " references my-reservations.js";
    }
    if (strpos($content, 'my-cremations.js') !== false) {
        $orphanedJsRefs[] = basename($file) . " references my-cremations.js";
    }
    if (strpos($content, 'booking-wizard.js') !== false) {
        $orphanedJsRefs[] = basename($file) . " references booking-wizard.js";
    }
}

assertCondition(
    "TEST 9: Removed JavaScript files have zero orphaned references",
    !$myResJsExists && !$myCremJsExists && !$bookingWizardJsExists && empty($orphanedJsRefs),
    "my-reservations.js, my-cremations.js, and booking-wizard.js must be deleted with 0 script tags remaining in HTML files"
);

// -------------------------------------------------------------
// TEST 10: Removed CSS files have zero orphaned references
// -------------------------------------------------------------
$myResCssExists = file_exists($rootDir . '/assets/css/my-reservations.css');

$orphanedCssRefs = [];
foreach ($htmlPages as $file) {
    $content = file_get_contents($file);
    if (strpos($content, 'my-reservations.css') !== false) {
        $orphanedCssRefs[] = basename($file) . " links my-reservations.css";
    }
}

assertCondition(
    "TEST 10: Removed CSS files have zero orphaned references",
    !$myResCssExists && empty($orphanedCssRefs),
    "my-reservations.css must be deleted with 0 link tags remaining in HTML files"
);

// -------------------------------------------------------------
// TEST 11: AI architecture regression coverage remains meaningful and aligned with canonical architecture
// -------------------------------------------------------------
$aiRegressionScript = file_get_contents($rootDir . '/tests/ai_architecture_regression_test.py');
$hasCanonicalAiCheck = strpos($aiRegressionScript, "my_bookings_js = read('assets/js/pages/my-bookings.js')") !== false &&
                       strpos($aiRegressionScript, "'frontend/pages/my-bookings.html'") !== false;
$hasAiMountInHtml = strpos($myBookingsHtml, 'id="aiAssistantMount"') !== false && strpos($myBookingsHtml, 'ai-assistant-widget.js') !== false;
$hasAiWidgetInJs = strpos($myBookingsJs, "module: 'Schedule'") !== false && strpos($myBookingsJs, 'initAiAssistant') !== false;

assertCondition(
    "TEST 11: AI architecture regression coverage remains meaningful and aligned with the current canonical architecture",
    $hasCanonicalAiCheck && $hasAiMountInHtml && $hasAiWidgetInJs,
    "AI regression test and canonical my-bookings files must verify the Schedule-scoped citizen AI assistant"
);

// -------------------------------------------------------------
// TEST 12: Burial and Cremation booking records remain accessible through my-bookings.html
// -------------------------------------------------------------
$hasBurialsFilter = strpos($myBookingsHtml, '<option value="burial">') !== false;
$hasCremationsFilter = strpos($myBookingsHtml, '<option value="cremation">') !== false;
$hasDraftsFilter = strpos($myBookingsHtml, '<option value="draft">') !== false;
$supportsQueryParamType = strpos($myBookingsJs, "urlParams.get('type')") !== false;
$queriesMineApi = strpos($myBookingsJs, "bookings/mine") !== false;

assertCondition(
    "TEST 12: Burial and Cremation booking records remain accessible through my-bookings.html",
    $hasBurialsFilter && $hasCremationsFilter && $hasDraftsFilter && $supportsQueryParamType && $queriesMineApi,
    "my-bookings.html must support both burial and cremation filtering via dropdown and URL query parameter"
);

// -------------------------------------------------------------
// TEST 13: Legacy URLs remain backward compatible where required
// -------------------------------------------------------------
$resHtmlExists = file_exists($rootDir . '/frontend/pages/my-reservations.html');
$cremHtmlExists = file_exists($rootDir . '/frontend/pages/my-cremations.html');
$resHasRedirectNotice = strpos($myReservationsHtml, 'Redirecting to Unified Bookings') !== false;
$cremHasRedirectNotice = strpos($myCremationsHtml, 'Redirecting to Unified Bookings') !== false;

assertCondition(
    "TEST 13: Legacy URLs remain backward compatible where required",
    $resHtmlExists && $cremHtmlExists && $resHasRedirectNotice && $cremHasRedirectNotice,
    "Legacy URLs must remain accessible on disk with clear redirect notices and fallback links"
);

// -------------------------------------------------------------
// TEST 14: RBAC remains unchanged
// -------------------------------------------------------------
$apiJs = file_get_contents($rootDir . '/assets/js/shared/api.js');

$rbacMyResInApi = strpos($apiJs, "'my-reservations.html': ['user']") !== false;
$rbacMyCremInApi = strpos($apiJs, "'my-cremations.html': ['user']") !== false;
$rbacMyBookingsInApi = strpos($apiJs, "'my-bookings.html': ['admin', 'staff', 'user']") !== false;
$rbacMyResInNav = preg_match("/route:\s*'my-reservations\.html'[^}]+allowedRoles:\s*\[[^\]]*'user'[^\]]*\]/s", $navConfig);
$rbacMyCremInNav = preg_match("/route:\s*'my-cremations\.html'[^}]+allowedRoles:\s*\[[^\]]*'user'[^\]]*\]/s", $navConfig);
$rbacMyBookingsInNav = preg_match("/route:\s*'my-bookings\.html'[^}]+allowedRoles:\s*\[[^\]]*'user'[^\]]*\]/s", $navConfig);

assertCondition(
    "TEST 14: RBAC remains unchanged",
    $rbacMyResInApi && $rbacMyCremInApi && $rbacMyBookingsInApi && $rbacMyResInNav && $rbacMyCremInNav && $rbacMyBookingsInNav,
    "RBAC permissions for legacy routes and my-bookings must remain strictly enforced with user access preserved"
);

echo "======================================================================\n";
echo "AUDIT RESULTS: {$passCount} PASSED, {$failCount} FAILED\n";
echo "======================================================================\n";

if ($failCount > 0) {
    exit(1);
}
exit(0);
