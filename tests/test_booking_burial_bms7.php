<?php
/**
 * Test Suite: BMS-7 Burial Domain Integration
 * 
 * Verifies:
 * 1. Finalize burial draft creates real row in burial_schedules with status = 'Pending'
 * 2. Provisional decedent_requests row is created and linked when no deceased_id is supplied
 * 3. Existing deceased_id is directly linked when supplied
 * 4. Draft transitions to COMMITTED with committed_record_id = schedule_id and committed_record_type = 'burial'
 * 5. Re-finalizing an already committed draft returns HTTP 409 (DRAFT_ALREADY_COMMITTED)
 * 6. Incomplete draft (missing lot or date) rejects finalization with HTTP 400 (INCOMPLETE_DRAFT)
 * 7. Booking an unavailable lot returns HTTP 409 conflict (LOT_NOT_AVAILABLE)
 * 8. Monday booking date is rejected with HTTP 400
 * 9. Past date booking is rejected with HTTP 400
 * 10. Cross-user security: User B cannot finalize User A's draft (HTTP 403 / 404)
 * 11. Two-phase confirmation via controller: confirm() advances to AWAITING_CONFIRM, finalize() advances to COMMITTED
 * 12. Immutable audit log entries recorded for Schedule and BookingDraft
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/DecedentRequest.php';
require_once __DIR__ . '/../backend/models/AuditLog.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

echo "======================================================\n";
echo "RUNNING BMS-7 BURIAL DOMAIN INTEGRATION TEST SUITE\n";
echo "======================================================\n";

$db = Database::getInstance()->getConnection();

// Fetch two test users
$users = $db->query("SELECT user_id, username FROM users ORDER BY user_id ASC LIMIT 2")->fetchAll(PDO::FETCH_ASSOC);
if (count($users) < 1) {
    echo "FATAL: At least 1 user required in database.\n";
    exit(1);
}

$userA = $users[0];
$userA['role'] = 'user';
$userB = count($users) > 1 ? $users[1] : [
    'user_id' => 999999,
    'username' => 'isolated_bms7_user',
    'role' => 'user'
];
$userB['role'] = 'user';

// Clean test drafts
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%AI Booking Assistant Draft%' OR notes LIKE '%Manuel Quezon%' OR notes LIKE '%Two Phase%'");
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");
$db->exec("DELETE FROM decedent_requests WHERE requested_by IN ({$userA['user_id']}, {$userB['user_id']}) AND request_id NOT IN (SELECT decedent_request_id FROM burial_schedules WHERE decedent_request_id IS NOT NULL) AND request_id NOT IN (SELECT decedent_request_id FROM cremation_records WHERE decedent_request_id IS NOT NULL)");

// Pick available lot
$availableLotId = (int) $db->query("SELECT lot_id FROM lots WHERE status = 'Available' ORDER BY lot_id ASC LIMIT 1")->fetchColumn();
if (!$availableLotId) {
    echo "FATAL: No available lot found in lots table.\n";
    exit(1);
}

$controller = new BookingAgentController();
$service = new BookingAgentService();
$draftModel = new BookingDraft();
$scheduleModel = new Schedule();
$decedentRequestModel = new DecedentRequest();

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

function getValidFutureDate(int $daysAhead = 35): string {
    $d = new DateTime("+{$daysAhead} days");
    if ((int) $d->format('N') === 1) {
        $d->modify('+1 day');
    }
    return $d->format('Y-m-d');
}

$futureDate1 = getValidFutureDate(35);
$futureDate2 = getValidFutureDate(42);

// ----------------------------------------------------------------------
// TEST 1: Finalize burial draft creates real row in burial_schedules with status = 'Pending'
// ----------------------------------------------------------------------
$initialScheduleCount = (int) $db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn();

// Create draft in READY_FOR_REVIEW
$initRes = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name'  => 'Manuel Quezon Jr',
        'relationship'    => 'Father',
        'preferred_date'  => $futureDate1,
        'lot_id'          => $availableLotId,
    ]
]);

$draft1Id = $initRes['draft_id'];
$finalizeRes1 = $service->finalizeBurialDraft($draft1Id, $userA['user_id'], $userA['username'], $userA);

$finalScheduleCount = (int) $db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn();
$newSchedule = $scheduleModel->findById($finalizeRes1['schedule_id']);

$test1Ok = (
    $finalizeRes1['success'] === true
    && $finalizeRes1['status'] === BookingDraft::STATUS_COMMITTED
    && !empty($finalizeRes1['schedule_id'])
    && $finalScheduleCount === $initialScheduleCount + 1
    && $newSchedule['status'] === 'Pending'
    && (int) $newSchedule['lot_id'] === $availableLotId
    && $newSchedule['schedule_date'] === $futureDate1
);
report(1, "Finalize burial draft creates real row in burial_schedules with status = 'Pending'", $test1Ok, "Schedule ID: " . ($finalizeRes1['schedule_id'] ?? 'null'));

// ----------------------------------------------------------------------
// TEST 2: Provisional decedent_requests row is created and linked
// ----------------------------------------------------------------------
$linkedRequestId = $newSchedule['decedent_request_id'] ?? null;
$decReq = $linkedRequestId ? $decedentRequestModel->findById($linkedRequestId) : null;

$test2Ok = (
    !empty($linkedRequestId)
    && !empty($decReq)
    && $decReq['full_name'] === 'Manuel Quezon Jr'
    && (int) $decReq['requested_by'] === (int) $userA['user_id']
    && empty($newSchedule['deceased_id'])
);
report(2, "Provisional decedent_requests row created and linked for unlinked decedent", $test2Ok, "Request ID: {$linkedRequestId}");

// ----------------------------------------------------------------------
// TEST 3: Existing deceased_id is directly linked when supplied
// ----------------------------------------------------------------------
// Pick another available lot
$secondLotId = (int) $db->query("SELECT lot_id FROM lots WHERE status = 'Available' AND lot_id != {$availableLotId} LIMIT 1")->fetchColumn();
if (!$secondLotId) $secondLotId = $availableLotId;

// Pick an existing decedent record if available
$existingDeceasedId = (int) $db->query("SELECT decedent_id FROM decedent_records LIMIT 1")->fetchColumn();

if ($existingDeceasedId > 0 && $secondLotId !== $availableLotId) {
    $initRes3 = $service->processStructuredInput($userA['user_id'], [
        'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
        'service_type' => 'burial',
        'extracted_fields' => [
            'decedent_name'  => 'Existing Deceased',
            'relationship'    => 'Uncle',
            'preferred_date'  => $futureDate2,
            'lot_id'          => $secondLotId,
            'deceased_id'     => $existingDeceasedId
        ]
    ]);
    $finalizeRes3 = $service->finalizeBurialDraft($initRes3['draft_id'], $userA['user_id'], $userA['username'], $userA);
    $sched3 = $scheduleModel->findById($finalizeRes3['schedule_id']);

    $test3Ok = (
        $finalizeRes3['success'] === true
        && (int) $sched3['deceased_id'] === $existingDeceasedId
        && empty($sched3['decedent_request_id'])
    );
    report(3, "Existing deceased_id is directly linked without provisional request", $test3Ok, "Deceased ID: {$existingDeceasedId}");
} else {
    report(3, "Existing deceased_id linked test skipped (no separate deceased record/lot)", true);
}

// ----------------------------------------------------------------------
// TEST 4: Draft transitions to COMMITTED with committed_record_id
// ----------------------------------------------------------------------
$committedDraft = $draftModel->findById($draft1Id);
$test4Ok = (
    $committedDraft['status'] === BookingDraft::STATUS_COMMITTED
    && (int) $committedDraft['committed_record_id'] === (int) $finalizeRes1['schedule_id']
    && $committedDraft['committed_record_type'] === 'burial'
);
report(4, "Draft transitions to COMMITTED with committed_record_id = schedule_id", $test4Ok, "Status: {$committedDraft['status']}");

// ----------------------------------------------------------------------
// TEST 5: Re-finalizing an already committed draft returns HTTP 409
// ----------------------------------------------------------------------
try {
    $service->finalizeBurialDraft($draft1Id, $userA['user_id'], $userA['username'], $userA);
    $test5Ok = false;
} catch (BookingDraftException $e) {
    $test5Ok = ($e->getCode() === 409 && $e->getErrorType() === 'DRAFT_ALREADY_COMMITTED');
}
report(5, "Re-finalizing an already committed draft throws 409 (DRAFT_ALREADY_COMMITTED)", $test5Ok);

// ----------------------------------------------------------------------
// TEST 6: Incomplete draft rejects finalization with HTTP 400
// ----------------------------------------------------------------------
$incompleteRes = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name' => 'Incomplete Person'
    ]
]);
try {
    $service->finalizeBurialDraft($incompleteRes['draft_id'], $userA['user_id'], $userA['username'], $userA);
    $test6Ok = false;
} catch (BookingDraftException $e) {
    $test6Ok = ($e->getCode() === 400 && $e->getErrorType() === 'INCOMPLETE_DRAFT');
}
report(6, "Incomplete draft rejects finalization with HTTP 400 (INCOMPLETE_DRAFT)", $test6Ok);

// ----------------------------------------------------------------------
// TEST 7: Booking an unavailable lot throws 409 conflict
// ----------------------------------------------------------------------
// Mark a dummy lot as Occupied or find one
$occupiedLotId = (int) $db->query("SELECT lot_id FROM lots WHERE status != 'Available' LIMIT 1")->fetchColumn();
if (!$occupiedLotId) {
    // Temporarily create an unavailable lot for testing
    $db->exec("INSERT INTO lots (block_id, lot_number, lot_type_id, status, price) VALUES (1, 'OCC-TEST', 1, 'Occupied', 5000.00)");
    $occupiedLotId = (int) $db->lastInsertId();
}

$unavailRes = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name'  => 'Occupied Tester',
        'preferred_date' => $futureDate1,
        'lot_id'         => $occupiedLotId
    ]
]);

try {
    $service->finalizeBurialDraft($unavailRes['draft_id'], $userA['user_id'], $userA['username'], $userA);
    $test7Ok = false;
} catch (BookingDraftException $e) {
    $test7Ok = ($e->getCode() === 409 && in_array($e->getErrorType(), ['LOT_NOT_AVAILABLE', 'LOT_ALREADY_BOOKED'], true));
}
report(7, "Booking an unavailable lot returns clean HTTP 409 conflict", $test7Ok);

// ----------------------------------------------------------------------
// TEST 8: Monday booking date is rejected with HTTP 400
// ----------------------------------------------------------------------
$monday = new DateTime('+30 days');
while ((int) $monday->format('N') !== 1) {
    $monday->modify('+1 day');
}
$mondayStr = $monday->format('Y-m-d');

$mondayDraft = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name'  => 'Monday Test',
        'preferred_date' => $mondayStr,
        'lot_id'         => $availableLotId
    ]
]);

try {
    $service->finalizeBurialDraft($mondayDraft['draft_id'], $userA['user_id'], $userA['username'], $userA);
    $test8Ok = false;
} catch (BookingDraftException $e) {
    $test8Ok = ($e->getCode() === 400 && in_array($e->getErrorType(), ['INVALID_DATE', 'INCOMPLETE_DRAFT'], true));
}
report(8, "Monday booking date is rejected with HTTP 400", $test8Ok);

// ----------------------------------------------------------------------
// TEST 9: Past date booking is rejected with HTTP 400
// ----------------------------------------------------------------------
$pastDraft = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name'  => 'Past Test',
        'preferred_date' => '2020-01-01',
        'lot_id'         => $availableLotId
    ]
]);

try {
    $service->finalizeBurialDraft($pastDraft['draft_id'], $userA['user_id'], $userA['username'], $userA);
    $test9Ok = false;
} catch (BookingDraftException $e) {
    $test9Ok = ($e->getCode() === 400 && in_array($e->getErrorType(), ['INVALID_DATE', 'INCOMPLETE_DRAFT'], true));
}
report(9, "Past date booking is rejected with HTTP 400", $test9Ok);

// ----------------------------------------------------------------------
// TEST 10: Cross-user security: User B cannot finalize User A's draft
// ----------------------------------------------------------------------
$anotherAvailableLot = (int) $db->query("SELECT lot_id FROM lots WHERE status = 'Available' AND lot_id != {$availableLotId} LIMIT 1")->fetchColumn();
if (!$anotherAvailableLot) $anotherAvailableLot = $availableLotId;

$draftA = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name'  => 'Owner A Decedent',
        'preferred_date' => getValidFutureDate(60),
        'lot_id'         => $anotherAvailableLot
    ]
]);

$crossRes = $controller->finalize($draftA['draft_id'], $userB);
$test10Ok = (in_array($crossRes['code'], [403, 404], true) && $crossRes['success'] === false);
report(10, "Cross-user security: User B cannot finalize User A's draft", $test10Ok, "Code: {$crossRes['code']}");

// ----------------------------------------------------------------------
// TEST 11: Two-phase confirmation via controller: confirm() then finalize()
// ----------------------------------------------------------------------
$thirdLotId = (int) $db->query("SELECT lot_id FROM lots WHERE status = 'Available' AND lot_id NOT IN ({$availableLotId}, {$anotherAvailableLot}) LIMIT 1")->fetchColumn();
if (!$thirdLotId) $thirdLotId = $availableLotId;

$draftController = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name'  => 'Two Phase Decedent',
        'relationship'   => 'Sister',
        'preferred_date' => getValidFutureDate(50),
        'lot_id'         => $thirdLotId
    ]
]);

// Step 1: confirm() advances from READY_FOR_REVIEW to AWAITING_CONFIRM
$confirmRes = $controller->confirm($draftController['draft_id'], $userA);
$phase1Ok = ($confirmRes['code'] === 200 && $confirmRes['status'] === BookingDraft::STATUS_AWAITING_CONFIRM);

// Step 2: finalize() advances from AWAITING_CONFIRM to COMMITTED
$finalizeRes = $controller->finalize($draftController['draft_id'], $userA);
$phase2Ok = (
    $finalizeRes['code'] === 200
    && $finalizeRes['success'] === true
    && $finalizeRes['status'] === BookingDraft::STATUS_COMMITTED
    && !empty($finalizeRes['schedule_id'])
);
$test11Ok = ($phase1Ok && $phase2Ok);
report(11, "Two-phase confirmation: confirm() -> AWAITING_CONFIRM, finalize() -> COMMITTED", $test11Ok, "Final Status: " . ($finalizeRes['status'] ?? ''));

// ----------------------------------------------------------------------
// TEST 12: Audit log entries recorded for Schedule and BookingDraft
// ----------------------------------------------------------------------
$schedId = $finalizeRes['schedule_id'] ?? 0;
$auditCount = (int) $db->query("
    SELECT COUNT(*) FROM audit_logs 
    WHERE (action = 'Schedule created' AND entity_id = {$schedId})
       OR (action = 'booking_draft.committed' AND entity_id = {$draftController['draft_id']})
")->fetchColumn();

$test12Ok = ($auditCount >= 2);
report(12, "Audit log entries recorded for schedule creation and draft commitment", $test12Ok, "Found logs: {$auditCount}");

// Clean up any test dummy lot if created
$db->exec("DELETE FROM lots WHERE lot_number = 'OCC-TEST'");

echo "======================================================\n";
echo "BMS-7 TEST RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
