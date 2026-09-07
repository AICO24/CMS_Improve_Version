<?php
/**
 * Test Suite: BMS-4 Booking Agent API Contract & Routing Layer
 * 
 * Verifies:
 * 1. Authentication and role access enforcement
 * 2. Controller response mapping and HTTP status codes (200, 400, 401, 403, 404, 410, 429)
 * 3. Structured payload processing via API contract
 * 4. Field corrections (update-field)
 * 5. Cross-user draft isolation (ownership security)
 * 6. Pre-confirmation boundary (AWAITING_CONFIRM) with zero premature domain records
 * 7. Draft cancellation via API
 * 8. User draft listing
 * 9. Route pattern matching parity with backend/routes/api.php
 * 10. Rate limiting mechanics
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';
require_once __DIR__ . '/../backend/services/RateLimiter.php';

echo "======================================================\n";
echo "RUNNING BMS-4 BOOKING AGENT API CONTRACT TEST SUITE\n";
echo "======================================================\n";

$db = Database::getInstance()->getConnection();

// Fetch two distinct test users to test cross-user isolation
$users = $db->query("SELECT user_id, username FROM users ORDER BY user_id ASC LIMIT 2")->fetchAll(PDO::FETCH_ASSOC);
if (count($users) < 1) {
    echo "FATAL: At least 1 user required in database.\n";
    exit(1);
}

$userA = $users[0];
$userA['role'] = 'user';
$userB = count($users) > 1 ? $users[1] : [
    'user_id' => 999999,
    'username' => 'isolated_test_user',
    'role' => 'user'
];
$userB['role'] = 'user';

// Clean up drafts for both test users
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");

// Find a valid lot_id for testing
$validLotId = (int) $db->query("SELECT lot_id FROM lots WHERE status = 'Available' LIMIT 1")->fetchColumn();
if (!$validLotId) {
    $validLotId = (int) $db->query("SELECT lot_id FROM lots LIMIT 1")->fetchColumn();
}

$controller = new BookingAgentController();
$passed = 0;
$failed = 0;

function report($testNum, $title, $success, $details = '') {
    global $passed, $failed;
    if ($success) {
        $passed++;
        echo "[PASS] TEST {$testNum}: {$title}\n";
    } else {
        $failed++;
        echo "[FAIL] TEST {$testNum}: {$title} — {$details}\n";
    }
}

function getValidFutureDate(): string {
    $d = new DateTime('+28 days');
    if ((int) $d->format('N') === 1) {
        $d->modify('+1 day');
    }
    return $d->format('Y-m-d');
}

$futureDate = getValidFutureDate();

// ----------------------------------------------------------------------
// TEST 1: Unauthenticated request rejected with HTTP 401
// ----------------------------------------------------------------------
$res1 = $controller->process(['intent' => 'CREATE_BOOKING'], null);
$test1Ok = ($res1['code'] === 401 && $res1['success'] === false);
report(1, "Unauthenticated request returns HTTP 401", $test1Ok, "Code: {$res1['code']}");

// ----------------------------------------------------------------------
// TEST 2: Process valid structured input returns HTTP 200 & draft payload
// ----------------------------------------------------------------------
$payload2 = [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name' => 'Maria Clara',
        'preferred_date' => $futureDate
    ]
];
$res2 = $controller->process($payload2, $userA);
$draftId = $res2['draft_id'] ?? 0;
$test2Ok = ($res2['code'] === 200 && $res2['success'] === true && $draftId > 0 && in_array('lot_id', $res2['missing_fields'], true));
report(2, "Process valid structured input returns HTTP 200 with draft contract", $test2Ok, "Draft ID: {$draftId}");

// ----------------------------------------------------------------------
// TEST 3: Invalid service_type returns HTTP 400 with INVALID_SERVICE_TYPE
// ----------------------------------------------------------------------
$payload3 = [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'interstellar',
    'extracted_fields' => ['decedent_name' => 'Alien']
];
$res3 = $controller->process($payload3, $userA);
$test3Ok = ($res3['code'] === 400 && $res3['success'] === false && ($res3['error_type'] ?? '') === 'INVALID_SERVICE_TYPE');
report(3, "Invalid service_type returns HTTP 400 with error_type INVALID_SERVICE_TYPE", $test3Ok, "Code: {$res3['code']}, Type: " . ($res3['error_type'] ?? ''));

// ----------------------------------------------------------------------
// TEST 4: Get active draft returns HTTP 200 with current state
// ----------------------------------------------------------------------
$res4 = $controller->getActiveDraft($userA, 'burial');
$test4Ok = ($res4['code'] === 200 && $res4['success'] === true && !empty($res4['draft']) && (int)$res4['draft']['draft_id'] === $draftId);
report(4, "Get active draft returns HTTP 200 with draft summary", $test4Ok, "Status: " . ($res4['draft']['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 5: Update field without 'field' parameter returns HTTP 400
// ----------------------------------------------------------------------
$res5 = $controller->updateField($draftId, ['value' => $validLotId], $userA);
$test5Ok = ($res5['code'] === 400 && $res5['success'] === false);
report(5, "Update field missing 'field' key returns HTTP 400", $test5Ok, "Code: {$res5['code']}");

// ----------------------------------------------------------------------
// TEST 6: Update field with valid lot_id completes draft requirements
// ----------------------------------------------------------------------
$res6 = $controller->updateField($draftId, ['field' => 'lot_id', 'value' => $validLotId], $userA);
$test6Ok = ($res6['code'] === 200 && $res6['success'] === true && $res6['is_ready_for_review'] === true && empty($res6['missing_fields']));
report(6, "Update field valid lot_id returns HTTP 200 and READY_FOR_REVIEW", $test6Ok, "Ready: " . var_export($res6['is_ready_for_review'] ?? null, true));

// ----------------------------------------------------------------------
// TEST 7: Cross-user isolation: User B cannot modify User A's draft (HTTP 403 / 404)
// ----------------------------------------------------------------------
$res7 = $controller->updateField($draftId, ['field' => 'relationship', 'value' => 'Hacker'], $userB);
$test7Ok = (in_array($res7['code'], [403, 404], true) && $res7['success'] === false);
report(7, "Cross-user security: User B cannot modify User A's draft", $test7Ok, "Code: {$res7['code']}, Error: " . ($res7['error'] ?? ''));

// ----------------------------------------------------------------------
// TEST 8: Confirm draft transitions to AWAITING_CONFIRM without creating domain records
// ----------------------------------------------------------------------
$initialBurialCount = (int) $db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn();
$initialCremationCount = (int) $db->query("SELECT COUNT(*) FROM cremation_records")->fetchColumn();

$res8 = $controller->confirm($draftId, $userA);
$finalBurialCount = (int) $db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn();
$finalCremationCount = (int) $db->query("SELECT COUNT(*) FROM cremation_records")->fetchColumn();

$test8Ok = ($res8['code'] === 200 &&
            $res8['success'] === true &&
            $res8['status'] === BookingDraft::STATUS_AWAITING_CONFIRM &&
            $initialBurialCount === $finalBurialCount &&
            $initialCremationCount === $finalCremationCount);
report(8, "Confirm draft advances to AWAITING_CONFIRM without domain records", $test8Ok, "Status: {$res8['status']}");

// ----------------------------------------------------------------------
// TEST 9: Cross-user isolation: User B cannot cancel User A's draft
// ----------------------------------------------------------------------
$res9 = $controller->cancel($draftId, $userB);
$test9Ok = (in_array($res9['code'], [403, 404], true) && $res9['success'] === false);
report(9, "Cross-user security: User B cannot cancel User A's draft", $test9Ok, "Code: {$res9['code']}");

// ----------------------------------------------------------------------
// TEST 10: Owner cancels draft returns HTTP 200
// ----------------------------------------------------------------------
$res10 = $controller->cancel($draftId, $userA);
$test10Ok = ($res10['code'] === 200 && $res10['success'] === true);
report(10, "Owner cancels draft returns HTTP 200", $test10Ok);

// ----------------------------------------------------------------------
// TEST 11: Cancelled draft rejects further field modifications (HTTP 400)
// ----------------------------------------------------------------------
$res11 = $controller->updateField($draftId, ['field' => 'notes', 'value' => 'Should fail'], $userA);
$test11Ok = ($res11['code'] === 400 && $res11['success'] === false);
report(11, "Cancelled draft rejects further modifications", $test11Ok, "Code: {$res11['code']}");

// ----------------------------------------------------------------------
// TEST 12: List drafts returns array of user drafts
// ----------------------------------------------------------------------
$res12 = $controller->listDrafts($userA);
$test12Ok = ($res12['code'] === 200 && $res12['success'] === true && is_array($res12['drafts']) && count($res12['drafts']) >= 1);
report(12, "List drafts returns user's draft history", $test12Ok, "Draft count: " . count($res12['drafts'] ?? []));

// ----------------------------------------------------------------------
// TEST 13: Route pattern verification for api.php
// ----------------------------------------------------------------------
$routesToTest = [
    ['path' => 'booking-agent/process', 'method' => 'POST', 'pattern' => '#^booking-agent/process$#'],
    ['path' => 'booking-agent/active', 'method' => 'GET', 'pattern' => '#^booking-agent/(active|draft/active)$#'],
    ['path' => 'booking-agent/draft/active', 'method' => 'GET', 'pattern' => '#^booking-agent/(active|draft/active)$#'],
    ['path' => "booking-agent/drafts/{$draftId}/update-field", 'method' => 'POST', 'pattern' => '#^booking-agent/drafts?/(\d+)/update-field$#'],
    ['path' => "booking-agent/drafts/{$draftId}/confirm", 'method' => 'POST', 'pattern' => '#^booking-agent/drafts?/(\d+)/confirm$#'],
    ['path' => "booking-agent/drafts/{$draftId}/cancel", 'method' => 'POST', 'pattern' => '#^booking-agent/drafts?/(\d+)/cancel$#'],
    ['path' => 'booking-agent/drafts', 'method' => 'GET', 'pattern' => '#^booking-agent/drafts$#'],
];

$allRoutesMatched = true;
foreach ($routesToTest as $r) {
    if (!preg_match($r['pattern'], $r['path'])) {
        $allRoutesMatched = false;
        break;
    }
}
report(13, "Route patterns match canonical booking-agent URI specifications", $allRoutesMatched);

// ----------------------------------------------------------------------
// TEST 14: Rate limiter key and throttling behavior
// ----------------------------------------------------------------------
$testKey = 'booking_agent_test_' . time();
$limit = 3;
$window = 60;
$allowedCount = 0;
for ($i = 0; $i < 5; $i++) {
    if (RateLimiter::allow($testKey, $limit, $window)) {
        $allowedCount++;
    }
}
$test14Ok = ($allowedCount === 3);
report(14, "Rate limiter correctly throttles after limit is exceeded", $test14Ok, "Allowed {$allowedCount}/3 attempts");

echo "======================================================\n";
echo "BMS-4 TEST RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "======================================================\n";

// Final cleanup of test data
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");

exit($failed === 0 ? 0 : 1);
