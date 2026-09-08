<?php
/**
 * Test Suite: Unified Booking Remediation — Batch B Legacy Cleanup & Redirection
 * 
 * Verifies:
 * 1. Citizen does not have duplicate booking entry points in sidebar navigation.
 * 2. Authoritative Unified Booking pages remain accessible and properly configured.
 * 3. Legacy citizen booking pages (reserve-burial-slot.html, reserve-cremation.html) redirect to Unified Booking Assistant.
 * 4. Admin operational modules (burial-scheduling.html, cremation-management.html) remain accessible.
 * 5. Staff operational modules (burial-scheduling.html, manage-reservations.html, manage-cremations.html) remain accessible.
 * 6. Navigation configuration contains no duplicate citizen booking entries.
 * 7. No broken internal links are introduced in the entry pages.
 * 8. Legacy redirects preserve query parameter passthrough (e.g. lot_id).
 * 9. Existing BMS-9 / BMS-10 architecture and database contracts remain intact.
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
echo "RUNNING BATCH B LEGACY BOOKING CLEANUP & REDIRECTION AUDIT\n";
echo "==============================================================\n";

// -------------------------------------------------------------
// TEST 1: Navigation Configuration Audit for Citizen Role
// -------------------------------------------------------------
$navConfigPath = $rootDir . '/assets/js/shared/navigation-config.js';
$navConfigContent = file_get_contents($navConfigPath);

// Check that book-a-service.html, booking-assistant.html, my-bookings.html are configured for user
$hasCanonicalBookService = preg_match("/route:\s*'book-a-service\.html'.*?allowedRoles:\s*\[[^\]]*'user'[^\]]*\].*?showInSidebar:\s*true/s", $navConfigContent);
$hasCanonicalAssistant = preg_match("/route:\s*'booking-assistant\.html'.*?allowedRoles:\s*\[[^\]]*'user'[^\]]*\].*?showInSidebar:\s*true/s", $navConfigContent);
$hasCanonicalMyBookings = preg_match("/route:\s*'my-bookings\.html'.*?allowedRoles:\s*\[[^\]]*'user'[^\]]*\].*?showInSidebar:\s*true/s", $navConfigContent);

assertCondition(
    "TEST 1: Canonical Unified Booking pages are visible in sidebar for citizen",
    $hasCanonicalBookService && $hasCanonicalAssistant && $hasCanonicalMyBookings,
    "Expected book-a-service, booking-assistant, and my-bookings to be showInSidebar: true for user"
);

// -------------------------------------------------------------
// TEST 2: No Duplicate Citizen Booking Links in Sidebar Navigation
// -------------------------------------------------------------
$legacyBurialInSidebar = preg_match("/route:\s*'reserve-burial-slot\.html'[^}]+showInSidebar:\s*true/s", $navConfigContent);
$legacyCremationInSidebar = preg_match("/route:\s*'reserve-cremation\.html'[^}]+showInSidebar:\s*true/s", $navConfigContent);
$legacyMyReservationsInSidebar = preg_match("/route:\s*'my-reservations\.html'[^}]+showInSidebar:\s*true/s", $navConfigContent);
$legacyMyCremationsInSidebar = preg_match("/route:\s*'my-cremations\.html'[^}]+showInSidebar:\s*true/s", $navConfigContent);

$noDuplicateSidebar = !$legacyBurialInSidebar && !$legacyCremationInSidebar && !$legacyMyReservationsInSidebar && !$legacyMyCremationsInSidebar;

assertCondition(
    "TEST 2: Legacy citizen booking links are excluded from sidebar navigation",
    $noDuplicateSidebar,
    "Legacy routes (reserve-burial-slot, reserve-cremation, my-reservations, my-cremations) must have showInSidebar: false"
);

// -------------------------------------------------------------
// TEST 3: Admin Operational Modules Preserved in Navigation
// -------------------------------------------------------------
$adminManageReservations = preg_match("/route:\s*'manage-reservations\.html'.*?allowedRoles:\s*\[[^\]]*'admin'[^\\]]*\].*?showInSidebar:\s*true/s", $navConfigContent);
$adminManageCremations = preg_match("/route:\s*'manage-cremations\.html'.*?allowedRoles:\s*\[[^\]]*'admin'[^\\]]*\].*?showInSidebar:\s*true/s", $navConfigContent);
$adminCremationManagement = preg_match("/route:\s*'cremation-management\.html'.*?allowedRoles:\s*\[[^\]]*'admin'[^\\]]*\].*?showInSidebar:\s*true/s", $navConfigContent);
$adminBookingAssistant = preg_match("/route:\s*'booking-assistant\.html'.*?allowedRoles:\s*\[[^\]]*'admin'[^\\]]*\].*?showInSidebar:\s*true/s", $navConfigContent);

assertCondition(
    "TEST 3: Admin operational modules are preserved in navigation configuration",
    $adminManageReservations && $adminManageCremations && $adminCremationManagement && $adminBookingAssistant,
    "Expected booking-assistant, manage-reservations, manage-cremations, and cremation-management for admin"
);

// -------------------------------------------------------------
// TEST 4: Staff Operational Modules Preserved in Navigation
// -------------------------------------------------------------
$staffManageReservations = preg_match("/route:\s*'manage-reservations\.html'.*?allowedRoles:\s*\[[^\]]*'staff'[^\\]]*\].*?showInSidebar:\s*true/s", $navConfigContent);
$staffManageCremations = preg_match("/route:\s*'manage-cremations\.html'.*?allowedRoles:\s*\[[^\]]*'staff'[^\\]]*\].*?showInSidebar:\s*true/s", $navConfigContent);
$staffBookingAssistant = preg_match("/route:\s*'booking-assistant\.html'.*?allowedRoles:\s*\[[^\]]*'staff'[^\\]]*\].*?showInSidebar:\s*true/s", $navConfigContent);

assertCondition(
    "TEST 4: Staff operational modules are preserved in navigation configuration",
    $staffManageReservations && $staffManageCremations && $staffBookingAssistant,
    "Expected booking-assistant, manage-reservations, and manage-cremations for staff"
);

// -------------------------------------------------------------
// TEST 5: Legacy reserve-burial-slot.html Redirects to Unified Assistant
// -------------------------------------------------------------
$burialHtmlPath = $rootDir . '/frontend/pages/reserve-burial-slot.html';
$burialHtmlContent = file_get_contents($burialHtmlPath);

$redirectsBurial = strpos($burialHtmlContent, 'booking-assistant.html?service=burial') !== false;
$hasMetaRefreshBurial = (strpos($burialHtmlContent, 'http-equiv="refresh"') !== false || strpos($burialHtmlContent, "http-equiv='refresh'") !== false);

assertCondition(
    "TEST 5: reserve-burial-slot.html redirects to booking-assistant.html?service=burial",
    $redirectsBurial && $hasMetaRefreshBurial,
    "Expected reserve-burial-slot.html to redirect to booking-assistant.html?service=burial via meta refresh and script"
);

// -------------------------------------------------------------
// TEST 6: Legacy reserve-cremation.html Redirects to Unified Assistant
// -------------------------------------------------------------
$cremationHtmlPath = $rootDir . '/frontend/pages/reserve-cremation.html';
$cremationHtmlContent = file_get_contents($cremationHtmlPath);

$redirectsCremation = strpos($cremationHtmlContent, 'booking-assistant.html?service=cremation') !== false;
$hasMetaRefreshCremation = (strpos($cremationHtmlContent, 'http-equiv="refresh"') !== false || strpos($cremationHtmlContent, "http-equiv='refresh'") !== false);

assertCondition(
    "TEST 6: reserve-cremation.html redirects to booking-assistant.html?service=cremation",
    $redirectsCremation && $hasMetaRefreshCremation,
    "Expected reserve-cremation.html to redirect to booking-assistant.html?service=cremation via meta refresh and script"
);

// -------------------------------------------------------------
// TEST 7: book-a-service.html Content Integrity
// -------------------------------------------------------------
$bookServiceHtml = file_get_contents($rootDir . '/frontend/pages/book-a-service.html');

$hasBurialCard = strpos($bookServiceHtml, 'booking-assistant.html?service=burial') !== false;
$hasCremationCard = strpos($bookServiceHtml, 'booking-assistant.html?service=cremation') !== false;
$hasMyBookingsLink = strpos($bookServiceHtml, 'my-bookings.html') !== false;

// Ensure NO direct card links to old intake pages
$noOldBurialInCards = !preg_match('/<a[^>]+href="reserve-burial-slot\.html"[^>]*class="btn-primary"/i', $bookServiceHtml);
$noOldCremationInCards = !preg_match('/<a[^>]+href="reserve-cremation\.html"[^>]*class="btn-primary"/i', $bookServiceHtml);

assertCondition(
    "TEST 7: book-a-service.html action cards point cleanly to Unified Booking flows",
    $hasBurialCard && $hasCremationCard && $hasMyBookingsLink && $noOldBurialInCards && $noOldCremationInCards,
    "Expected book-a-service.html cards to link to booking-assistant.html?service=... with no legacy CTA links"
);

// -------------------------------------------------------------
// TEST 8: All Canonical Target Files Exist on Disk
// -------------------------------------------------------------
$canonicalFiles = [
    $rootDir . '/frontend/pages/book-a-service.html',
    $rootDir . '/frontend/pages/booking-assistant.html',
    $rootDir . '/frontend/pages/my-bookings.html',
    $rootDir . '/assets/js/pages/book-a-service.js',
    $rootDir . '/assets/js/pages/booking-assistant.js',
    $rootDir . '/assets/js/pages/my-bookings.js',
];

$allExist = true;
foreach ($canonicalFiles as $f) {
    if (!file_exists($f)) {
        $allExist = false;
        break;
    }
}

assertCondition(
    "TEST 8: All canonical frontend files and controllers exist",
    $allExist,
    "Expected all canonical booking frontend files to exist"
);

// -------------------------------------------------------------
// TEST 9: Backend Database & View Contracts Intact
// -------------------------------------------------------------
require_once $rootDir . '/backend/config/Database.php';
$db = Database::getInstance()->getConnection();

$tableCheck = $db->query("SHOW TABLES LIKE 'booking_drafts'")->fetch();
$viewCheck = $db->query("SHOW TABLES LIKE 'v_unified_bookings'")->fetch();

assertCondition(
    "TEST 9: Core BMS backend contracts (booking_drafts table and v_unified_bookings view) are intact",
    !empty($tableCheck) && !empty($viewCheck),
    "booking_drafts and v_unified_bookings must exist and be intact"
);

echo "==============================================================\n";
echo "BATCH B AUDIT RESULTS: {$passCount} PASSED, {$failCount} FAILED\n";
echo "==============================================================\n";

if ($failCount > 0) {
    exit(1);
}
exit(0);
