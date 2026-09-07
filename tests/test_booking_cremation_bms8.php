<?php
/**
 * Test Suite: BMS-8 Cremation Domain Integration
 * 
 * Verifies:
 * 1. Finalize cremation draft creates real row in cremation_records with status = 'Pending' & niche_number = null
 * 2. Provisional decedent_requests row is created and linked when no deceased_id is supplied
 * 3. Existing deceased_id is directly linked when supplied
 * 4. Draft transitions to COMMITTED with committed_record_id = cremation_id and committed_record_type = 'cremation'
 * 5. Re-finalizing an already committed draft returns HTTP 409 (DRAFT_ALREADY_COMMITTED)
 * 6. Incomplete draft (missing cremation_date or decedent_name) rejects finalization with HTTP 400 (INCOMPLETE_DRAFT)
 * 7. Service type mismatch rejects with HTTP 400 (INVALID_SERVICE_TYPE)
 * 8. Monday booking date is ALLOWED for cremation (unlike burial)
 * 9. Past date booking is rejected with HTTP 400 (INVALID_DATE)
 * 10. Cross-user security: User B cannot finalize User A's draft
 * 11. Two-phase confirmation via controller: confirm() advances to AWAITING_CONFIRM, finalize() commits
 * 12. Single-step confirmation via controller: confirm() with finalize = true commits directly
 * 13. Immutable audit log entries recorded for Cremation and BookingDraft
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/models/Decedent.php';
require_once __DIR__ . '/../backend/models/DecedentRequest.php';
require_once __DIR__ . '/../backend/models/AuditLog.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

echo "======================================================\n";
echo "RUNNING BMS-8 CREMATION DOMAIN INTEGRATION TEST SUITE\n";
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
    'username' => 'isolated_bms8_user',
    'role' => 'user'
];
$userB['role'] = 'user';

// Clean test records
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");
$db->exec("DELETE FROM cremation_records WHERE notes LIKE '%AI Booking Assistant Draft%' OR notes LIKE '%Cremation Test%'");
$db->exec("DELETE FROM decedent_requests WHERE requested_by IN ({$userA['user_id']}, {$userB['user_id']}) AND request_id NOT IN (SELECT decedent_request_id FROM burial_schedules WHERE decedent_request_id IS NOT NULL) AND request_id NOT IN (SELECT decedent_request_id FROM cremation_records WHERE decedent_request_id IS NOT NULL)");

$controller = new BookingAgentController();
$service = new BookingAgentService();
$draftModel = new BookingDraft();
$cremationModel = new Cremation();
$decedentRequestModel = new DecedentRequest();
$decedentModel = new Decedent();

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

function getNextMondayDate(): string {
    $d = new DateTime('+1 day');
    while ((int) $d->format('N') !== 1) {
        $d->modify('+1 day');
    }
    return $d->format('Y-m-d');
}

function getFutureDate(int $daysAhead = 20): string {
    $d = new DateTime("+{$daysAhead} days");
    return $d->format('Y-m-d');
}

$futureDate1 = getFutureDate(25);
$futureDate2 = getFutureDate(30);
$nextMonday = getNextMondayDate();

// ----------------------------------------------------------------------
// TEST 1: Finalize cremation draft creates real row in cremation_records with status = 'Pending' & niche_number = null
// ----------------------------------------------------------------------
$initialCremationCount = (int) $db->query("SELECT COUNT(*) FROM cremation_records")->fetchColumn();

$initRes1 = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'cremation',
    'extracted_fields' => [
        'decedent_name'         => 'Maria Corazon Aquino',
        'relationship'          => 'Mother',
        'cremation_date'        => $futureDate1,
        'preferred_columbarium' => 'Columbarium St. Jude',
    ]
]);

$draft1Id = $initRes1['draft_id'];
$finalizeRes1 = $service->finalizeCremationDraft($draft1Id, $userA['user_id'], $userA['username'], $userA);

$finalCremationCount = (int) $db->query("SELECT COUNT(*) FROM cremation_records")->fetchColumn();
$newCremation = $cremationModel->findById($finalizeRes1['cremation_id']);

$test1Ok = (
    $finalizeRes1['success'] === true
    && $finalizeRes1['status'] === BookingDraft::STATUS_COMMITTED
    && $finalizeRes1['service_type'] === 'cremation'
    && $finalCremationCount === ($initialCremationCount + 1)
    && $newCremation !== false
    && $newCremation['status'] === 'Pending'
    && $newCremation['niche_number'] === null
    && $newCremation['columbarium'] === 'Columbarium St. Jude'
    && $newCremation['cremation_date'] === $futureDate1
);
report(1, "Finalize cremation draft creates real row in cremation_records with status = 'Pending'", $test1Ok, json_encode($finalizeRes1));

// ----------------------------------------------------------------------
// TEST 2: Provisional decedent_requests row is created and linked when no deceased_id is supplied
// ----------------------------------------------------------------------
$provisionalRequestId = $newCremation['decedent_request_id'];
$decedentRequest = $decedentRequestModel->findById($provisionalRequestId);

$test2Ok = (
    !empty($provisionalRequestId)
    && empty($newCremation['deceased_id'])
    && $decedentRequest !== false
    && $decedentRequest['full_name'] === 'Maria Corazon Aquino'
    && (int) $decedentRequest['requested_by'] === (int) $userA['user_id']
);
report(2, "Provisional decedent_requests row created and linked", $test2Ok, "RequestId: " . var_export($provisionalRequestId, true));

// ----------------------------------------------------------------------
// TEST 3: Existing deceased_id is directly linked when supplied
// ----------------------------------------------------------------------
$existingDecedentId = (int) $db->query("SELECT decedent_id FROM decedent_records ORDER BY decedent_id ASC LIMIT 1")->fetchColumn();
if (!$existingDecedentId) {
    $db->exec("INSERT INTO decedent_records (first_name, last_name, date_of_birth, date_of_death) VALUES ('Formal', 'Decedent', '1950-01-01', '2024-01-01')");
    $existingDecedentId = (int) $db->lastInsertId();
}

$initRes3 = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'cremation',
    'extracted_fields' => [
        'decedent_name'  => 'Formal Decedent',
        'deceased_id'    => $existingDecedentId,
        'cremation_date' => $futureDate2,
    ]
]);

$draft3Id = $initRes3['draft_id'];
$finalizeRes3 = $service->finalizeCremationDraft($draft3Id, $userA['user_id'], $userA['username'], $userA);
$cremation3 = $cremationModel->findById($finalizeRes3['cremation_id']);

$test3Ok = (
    $finalizeRes3['success'] === true
    && (int) $cremation3['deceased_id'] === $existingDecedentId
    && empty($cremation3['decedent_request_id'])
);
report(3, "Existing deceased_id is directly linked without creating decedent_request", $test3Ok, "DeceasedID: {$existingDecedentId}");

// ----------------------------------------------------------------------
// TEST 4: Draft transitions to COMMITTED with committed_record_id = cremation_id
// ----------------------------------------------------------------------
$draft1Fresh = $draftModel->findById($draft1Id);
$test4Ok = (
    $draft1Fresh['status'] === BookingDraft::STATUS_COMMITTED
    && (int) $draft1Fresh['committed_record_id'] === (int) $finalizeRes1['cremation_id']
    && $draft1Fresh['committed_record_type'] === 'cremation'
);
report(4, "Draft transitions to COMMITTED with committed_record_id and type = 'cremation'", $test4Ok, json_encode($draft1Fresh));

// ----------------------------------------------------------------------
// TEST 5: Re-finalizing an already committed draft returns HTTP 409
// ----------------------------------------------------------------------
$test5Thrown = false;
$test5ErrorCode = 0;
try {
    $service->finalizeCremationDraft($draft1Id, $userA['user_id'], $userA['username'], $userA);
} catch (BookingDraftException $e) {
    $test5Thrown = true;
    $test5ErrorCode = $e->getCode();
}
report(5, "Re-finalizing an already committed draft throws 409 (DRAFT_ALREADY_COMMITTED)", $test5Thrown && $test5ErrorCode === 409, "Code: {$test5ErrorCode}");

// ----------------------------------------------------------------------
// TEST 6: Incomplete draft rejects finalization with HTTP 400 (INCOMPLETE_DRAFT)
// ----------------------------------------------------------------------
$futureExp = date('Y-m-d H:i:s', time() + 86400);
$incompleteDraftId = $draftModel->create((int) $userA['user_id'], 'cremation', $futureExp);
$draftModel->updateExtractedData($incompleteDraftId, ['decedent_name' => 'Incomplete Person']);

$test6Thrown = false;
$test6ErrorType = '';
try {
    $service->finalizeCremationDraft($incompleteDraftId, $userA['user_id'], $userA['username'], $userA);
} catch (BookingDraftException $e) {
    $test6Thrown = true;
    $test6ErrorType = $e->getErrorType();
}
report(6, "Incomplete draft rejects finalization with 400 (INCOMPLETE_DRAFT)", $test6Thrown && $test6ErrorType === 'INCOMPLETE_DRAFT', "ErrorType: {$test6ErrorType}");

// ----------------------------------------------------------------------
// TEST 7: Service type mismatch rejects with HTTP 400 (INVALID_SERVICE_TYPE)
// ----------------------------------------------------------------------
$burialDraftId = $draftModel->create((int) $userA['user_id'], 'burial', $futureExp);
$draftModel->updateExtractedData($burialDraftId, [
    'decedent_name' => 'Burial Test',
    'preferred_date' => $futureDate1,
    'lot_id' => 1
]);

$test7Thrown = false;
$test7ErrorType = '';
try {
    $service->finalizeCremationDraft($burialDraftId, $userA['user_id'], $userA['username'], $userA);
} catch (BookingDraftException $e) {
    $test7Thrown = true;
    $test7ErrorType = $e->getErrorType();
}
report(7, "Service type mismatch rejects with 400 (INVALID_SERVICE_TYPE)", $test7Thrown && $test7ErrorType === 'INVALID_SERVICE_TYPE', "ErrorType: {$test7ErrorType}");

// ----------------------------------------------------------------------
// TEST 8: Monday booking date is ALLOWED for cremation
// ----------------------------------------------------------------------
$mondayRes = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'cremation',
    'extracted_fields' => [
        'decedent_name'  => 'Monday Test Decedent',
        'cremation_date' => $nextMonday,
    ]
]);

$mondayDraftId = $mondayRes['draft_id'];
$finalizeMonday = $service->finalizeCremationDraft($mondayDraftId, $userA['user_id'], $userA['username'], $userA);
$mondayCremation = $cremationModel->findById($finalizeMonday['cremation_id']);

$test8Ok = (
    $finalizeMonday['success'] === true
    && $mondayCremation['cremation_date'] === $nextMonday
);
report(8, "Monday booking date is ALLOWED for cremation", $test8Ok, "Date: {$nextMonday}");

// ----------------------------------------------------------------------
// TEST 9: Past date booking is rejected with HTTP 400 (INVALID_DATE)
// ----------------------------------------------------------------------
$pastDate = '2020-01-01';
$pastRes = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'cremation',
    'extracted_fields' => [
        'decedent_name'  => 'Past Date Decedent',
        'cremation_date' => $pastDate,
    ]
]);

$pastDraftId = $pastRes['draft_id'];
$test9Thrown = false;
$test9ErrorType = '';
try {
    $service->finalizeCremationDraft($pastDraftId, $userA['user_id'], $userA['username'], $userA);
} catch (BookingDraftException $e) {
    $test9Thrown = true;
    $test9ErrorType = $e->getErrorType();
    $test9Code = $e->getCode();
}
report(9, "Past cremation date rejects with 400", $test9Thrown && $test9Code === 400 && in_array($test9ErrorType, ['INVALID_DATE', 'INCOMPLETE_DRAFT'], true), "ErrorType: {$test9ErrorType}");

// ----------------------------------------------------------------------
// TEST 10: Cross-user security: User B cannot finalize User A's draft
// ----------------------------------------------------------------------
$crossRes = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'cremation',
    'extracted_fields' => [
        'decedent_name'  => 'Secure Person',
        'cremation_date' => $futureDate1,
    ]
]);

$crossDraftId = $crossRes['draft_id'];
$test10Thrown = false;
$test10Code = 0;
try {
    $service->finalizeCremationDraft($crossDraftId, $userB['user_id'], $userB['username'], $userB);
} catch (BookingDraftException $e) {
    $test10Thrown = true;
    $test10Code = $e->getCode();
}
report(10, "Cross-user security: User B cannot finalize User A's draft", $test10Thrown && in_array($test10Code, [403, 404], true), "Code: {$test10Code}");

// ----------------------------------------------------------------------
// TEST 11: Two-phase confirmation via controller: confirm() advances to AWAITING_CONFIRM, finalize() commits
// ----------------------------------------------------------------------
$tpRes = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'cremation',
    'extracted_fields' => [
        'decedent_name'  => 'Two Phase Decedent',
        'cremation_date' => $futureDate2,
    ]
]);

$tpDraftId = $tpRes['draft_id'];

// Step A: Call confirm() without finalize flag
$confirmOutcome = $controller->confirm($tpDraftId, $userA);
$afterConfirmDraft = $draftModel->findById($tpDraftId);

$stepAOk = (
    $confirmOutcome['code'] === 200
    && $confirmOutcome['status'] === BookingDraft::STATUS_AWAITING_CONFIRM
    && $afterConfirmDraft['status'] === BookingDraft::STATUS_AWAITING_CONFIRM
);

// Step B: Call finalize()
$finalizeOutcome = $controller->finalize($tpDraftId, $userA);
$afterFinalizeDraft = $draftModel->findById($tpDraftId);

$stepBOk = (
    $finalizeOutcome['code'] === 200
    && $finalizeOutcome['success'] === true
    && $afterFinalizeDraft['status'] === BookingDraft::STATUS_COMMITTED
    && (int) $afterFinalizeDraft['committed_record_id'] === (int) $finalizeOutcome['committed_record_id']
);
report(11, "Two-phase confirmation via controller: confirm() -> AWAITING_CONFIRM, finalize() -> COMMITTED", $stepAOk && $stepBOk, "StepA: {$afterConfirmDraft['status']}, StepB: {$afterFinalizeDraft['status']}");

// ----------------------------------------------------------------------
// TEST 12: Single-step confirmation via controller: confirm() with finalize = true commits directly
// ----------------------------------------------------------------------
$directRes = $service->processStructuredInput($userA['user_id'], [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'cremation',
    'extracted_fields' => [
        'decedent_name'  => 'Direct Confirm Decedent',
        'cremation_date' => $futureDate2,
    ]
]);

$directDraftId = $directRes['draft_id'];
$directOutcome = $controller->confirm($directDraftId, $userA, ['finalize' => true]);
$directFresh = $draftModel->findById($directDraftId);

$test12Ok = (
    $directOutcome['code'] === 200
    && $directOutcome['success'] === true
    && $directFresh['status'] === BookingDraft::STATUS_COMMITTED
    && !empty($directOutcome['cremation_id'])
);
report(12, "Single-step confirmation via controller with finalize = true commits directly", $test12Ok, json_encode($directOutcome));

// ----------------------------------------------------------------------
// TEST 13: Immutable audit log entries recorded for Cremation and BookingDraft
// ----------------------------------------------------------------------
$cremationLogStmt = $db->prepare("SELECT * FROM audit_logs WHERE entity_type = 'Cremation' AND entity_id = ?");
$cremationLogStmt->execute([$finalizeRes1['cremation_id']]);
$cremationLogs = $cremationLogStmt->fetchAll(PDO::FETCH_ASSOC);

$draftLogStmt = $db->prepare("SELECT * FROM audit_logs WHERE entity_type = 'BookingDraft' AND entity_id = ? AND action = 'booking_draft.committed'");
$draftLogStmt->execute([$draft1Id]);
$draftLogs = $draftLogStmt->fetchAll(PDO::FETCH_ASSOC);

$test13Ok = (
    count($cremationLogs) >= 1
    && count($draftLogs) >= 1
    && $cremationLogs[0]['action'] === 'Cremation record created'
);
report(13, "Immutable audit log entries recorded for Cremation and BookingDraft", $test13Ok, "CremationLogs: " . count($cremationLogs) . ", DraftLogs: " . count($draftLogs));

echo "\n======================================================\n";
echo "BMS-8 CREMATION TEST SUITE SUMMARY: {$passed} PASSED, {$failed} FAILED\n";
echo "======================================================\n";

exit($failed === 0 ? 0 : 1);
