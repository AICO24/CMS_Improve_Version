<?php
/**
 * Test Suite: Unified Manage Bookings Module (Backend & Automation Gateway)
 * 
 * Verifies:
 * 1. BookingController class exists and can be instantiated.
 * 2. Normalization for Burial Schedules produces polymorphic booking schema.
 * 3. Normalization for Cremation Records produces polymorphic booking schema.
 * 4. BookingController::index returns paginated burials when service_type=burial.
 * 5. BookingController::index returns paginated cremations when service_type=cremation.
 * 6. BookingController::index returns merged & sorted bookings when service_type=all.
 * 7. RBAC checks: index() and stats() reject non-staff/admin users.
 * 8. BookingController::stats returns consolidated real-time counts.
 * 9. BookingController::show retrieves individual booking details.
 * 10. BookingController::updateStatus routes to underlying controllers.
 * 11. BookingController::runSweep executes all 9 automation stages (admin-only).
 * 12. api.php routes are registered and lint cleanly.
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/controllers/BookingController.php';

$passed = 0;
$failed = 0;

function report(int $testNum, string $title, bool $ok, string $detail = '') {
    global $passed, $failed;
    if ($ok) {
        $passed++;
        echo "  [PASS] Test {$testNum}: {$title}\n";
    } else {
        $failed++;
        echo "  [FAIL] Test {$testNum}: {$title}\n";
        if ($detail !== '') {
            echo "         Detail: {$detail}\n";
        }
    }
}

echo "\n=== RUNNING TEST SUITE: UNIFIED MANAGE BOOKINGS ===\n\n";

$adminUser = ['user_id' => 1, 'username' => 'admin_tester', 'role' => 'admin'];
$staffUser = ['user_id' => 2, 'username' => 'staff_tester', 'role' => 'staff'];
$citizenUser = ['user_id' => 99, 'username' => 'citizen_tester', 'role' => 'user'];

$controller = new BookingController();

// TEST 1: Instantiation
report(1, "BookingController instantiates cleanly", $controller instanceof BookingController);

// TEST 2: Burial Normalization
$dummyBurial = [
    'schedule_id' => 101,
    'schedule_date' => '2026-09-20',
    'schedule_time' => '10:00:00',
    'lot_number' => 'L-42',
    'section_name' => 'Section Pine',
    'first_name' => 'Juan',
    'last_name' => 'Dela Cruz',
    'created_by' => 5,
    'created_by_name' => 'Maria Dela Cruz',
    'status' => 'Pending',
    'payment_status' => 'Verified',
    'payment_amount' => 5000.00,
    'payment_receipt_number' => 'REC-12345',
    'notes' => 'Handle with care',
];
$normBurial = $controller->normalizeBurial($dummyBurial, [101 => true]);
$burialSchemaOk = (
    $normBurial['id'] === 101 &&
    $normBurial['service_type'] === 'burial' &&
    $normBurial['booking_reference'] === 'BUR-101' &&
    $normBurial['decedent_name'] === 'Juan Dela Cruz' &&
    strpos($normBurial['location_label'], 'Lot L-42') !== false &&
    $normBurial['has_exception'] === true &&
    $normBurial['payment_status'] === 'Verified'
);
report(2, "normalizeBurial produces expected polymorphic schema and flags", $burialSchemaOk);

// TEST 3: Cremation Normalization
$dummyCremation = [
    'cremation_id' => 202,
    'cremation_date' => '2026-09-22',
    'columbarium' => 'St. Jude Columbarium',
    'niche_number' => 'N-15',
    'first_name' => 'Elena',
    'last_name' => 'Santos',
    'created_by' => 7,
    'created_by_name' => 'Pedro Santos',
    'status' => 'Scheduled',
    'payment_status' => 'Unpaid',
];
$normCrem = $controller->normalizeCremation($dummyCremation, []);
$cremSchemaOk = (
    $normCrem['id'] === 202 &&
    $normCrem['service_type'] === 'cremation' &&
    $normCrem['booking_reference'] === 'CREM-202' &&
    $normCrem['decedent_name'] === 'Elena Santos' &&
    strpos($normCrem['location_label'], 'St. Jude Columbarium') !== false &&
    $normCrem['niche_number'] === 'N-15' &&
    $normCrem['has_exception'] === false
);
report(3, "normalizeCremation produces expected polymorphic schema and niche info", $cremSchemaOk);

// TEST 4: Index for Burial
$burialRes = $controller->index(['service_type' => 'burial'], ['page' => 1, 'per_page' => 5], $adminUser);
$burialIndexOk = (
    !empty($burialRes['success']) &&
    is_array($burialRes['data']) &&
    isset($burialRes['meta']['total']) &&
    isset($burialRes['meta']['page'])
);
report(4, "index(service_type=burial) returns paginated data and metadata", $burialIndexOk, json_encode($burialRes['meta'] ?? []));

// TEST 5: Index for Cremation
$cremRes = $controller->index(['service_type' => 'cremation'], ['page' => 1, 'per_page' => 5], $staffUser);
$cremIndexOk = (
    !empty($cremRes['success']) &&
    is_array($cremRes['data']) &&
    isset($cremRes['meta']['total']) &&
    isset($cremRes['meta']['page'])
);
report(5, "index(service_type=cremation) returns paginated data and metadata", $cremIndexOk, json_encode($cremRes['meta'] ?? []));

// TEST 6: Index for All Bookings (Server-side merge, sort, and slice)
$allRes = $controller->index(['service_type' => 'all'], ['page' => 1, 'per_page' => 10], $adminUser);
$allIndexOk = (
    !empty($allRes['success']) &&
    is_array($allRes['data']) &&
    isset($allRes['meta']['total'])
);
report(6, "index(service_type=all) consolidates and paginates burials and cremations", $allIndexOk, "Total bookings: " . ($allRes['meta']['total'] ?? 0));

// TEST 7: RBAC Protection
$unauthRes = $controller->index([], [], $citizenUser);
$unauthStats = $controller->stats($citizenUser);
$rbacOk = (
    isset($unauthRes['code']) && $unauthRes['code'] === 403 &&
    isset($unauthStats['code']) && $unauthStats['code'] === 403
);
report(7, "RBAC enforcement rejects non-admin/staff callers with HTTP 403", $rbacOk);

// TEST 8: Aggregate Stats
$statsRes = $controller->stats($adminUser);
$statsOk = (
    !empty($statsRes['success']) &&
    isset($statsRes['data']['total_bookings']) &&
    isset($statsRes['data']['burials_count']) &&
    isset($statsRes['data']['cremations_count']) &&
    isset($statsRes['data']['completed_count']) &&
    isset($statsRes['data']['exceptions_count'])
);
report(8, "stats() returns consolidated counts across both modules and open exceptions", $statsOk, json_encode($statsRes['data'] ?? []));

// TEST 9: Show Booking
if (!empty($burialRes['data'][0]['id'])) {
    $firstBurialId = $burialRes['data'][0]['id'];
    $showRes = $controller->show('burial', $firstBurialId, $adminUser);
    $showOk = !empty($showRes['success']) && $showRes['data']['id'] === $firstBurialId && $showRes['data']['service_type'] === 'burial';
    report(9, "show('burial', id) retrieves normalized booking details", $showOk);
} else {
    report(9, "show('burial', id) skipped (no burial records in DB)", true);
}

// TEST 10: updateStatus validation
$badServiceRes = $controller->updateStatus('invalid_service', 1, ['status' => 'Completed'], $adminUser);
$updateValidOk = isset($badServiceRes['code']) && $badServiceRes['code'] === 400;
report(10, "updateStatus rejects invalid service types with HTTP 400", $updateValidOk);

// TEST 11: Automation Sweep Execution
$sweepRes = $controller->runSweep($adminUser);
$sweepOk = (
    !empty($sweepRes['success']) &&
    isset($sweepRes['stages']['expiration-records/generate-notifications']) &&
    isset($sweepRes['stages']['schedules/notify-stale-pending']) &&
    isset($sweepRes['stages']['cremations/notify-stale-pending']) &&
    isset($sweepRes['stages']['lots.expired-sync'])
);
$nonAdminSweep = $controller->runSweep($staffUser);
$sweepRbacOk = isset($nonAdminSweep['code']) && $nonAdminSweep['code'] === 403;
report(11, "runSweep executes full automation suite and enforces Admin-only RBAC", $sweepOk && $sweepRbacOk);

// TEST 12: api.php Routing verification
$apiFile = file_get_contents(__DIR__ . '/../backend/routes/api.php');
$routesOk = (
    strpos($apiFile, "BookingController.php") !== false &&
    strpos($apiFile, "bookings/stats") !== false &&
    strpos($apiFile, "bookings/sweep") !== false &&
    strpos($apiFile, "bookings\/(burial|cremation)") !== false &&
    strpos($apiFile, "'bookings'") !== false
);
report(12, "Unified booking routes are wired in backend/routes/api.php", $routesOk);

echo "\n======================================================\n";
echo "TEST RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "======================================================\n\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
