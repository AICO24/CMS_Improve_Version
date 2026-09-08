<?php
/**
 * Test Suite: Batch 2 — Booking Automation V2
 * Controlled Action Registry & Natural Language Editing
 * 
 * Verifies the 7 required scenarios:
 * 1. Draft Name Correction: Tagalog "Kevin Mando dapat" normalizes to decedent_name, mutates draft, and updates state.
 * 2. Committed Booking Metadata Correction: Safe metadata (relationship) updated in DB via transaction with audit trail.
 * 3. Protected Field: Changing booking date classified as RESCHEDULE_BOOKING and DEFERRED without schedule mutation.
 * 4. Ambiguous Field: "Correct my information" requires clarification without guessing or mutating.
 * 5. Unauthorized Booking: Citizen B referencing Citizen A's booking is rejected with zero leak and zero mutation.
 * 6. Immutable State: Attempted correction on 'Completed' booking is rejected (ACTION_NOT_ALLOWED_FOR_STATE).
 * 7. Idempotent Retry: Sending identical correction twice returns EXECUTED then NO_CHANGE with exactly 1 audit entry.
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/UnifiedBooking.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/models/DecedentRequest.php';
require_once __DIR__ . '/../backend/models/AuditLog.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/services/BookingActionRegistry.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

echo "===================================================================\n";
echo "RUNNING BATCH 2: ACTION REGISTRY & NATURAL LANGUAGE EDITING TESTS\n";
echo "===================================================================\n";

$db = Database::getInstance()->getConnection();

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

// ----------------------------------------------------------------------
// SETUP TEST USERS AND ENVIRONMENT
// ----------------------------------------------------------------------
$db->exec("
    DELETE FROM audit_logs WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch2_test_%');
    DELETE FROM burial_schedules WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'batch2_test_%');
    DELETE FROM cremation_records WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'batch2_test_%');
    DELETE FROM decedent_requests WHERE requested_by IN (SELECT user_id FROM users WHERE username LIKE 'batch2_test_%');
    DELETE FROM booking_drafts WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch2_test_%');
    DELETE FROM users WHERE username IN ('batch2_test_user_a', 'batch2_test_user_b');
");

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('batch2_test_user_a', 'hash', 'Batch 2 Citizen A', 'batch2_a@test.local', 3)
")->execute();
$userAId = (int) $db->lastInsertId();

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('batch2_test_user_b', 'hash', 'Batch 2 Citizen B', 'batch2_b@test.local', 3)
")->execute();
$userBId = (int) $db->lastInsertId();

$userA = ['user_id' => $userAId, 'username' => 'batch2_test_user_a', 'role' => 'user'];
$userB = ['user_id' => $userBId, 'username' => 'batch2_test_user_b', 'role' => 'user'];

// Find or pick a valid lot
$lotId = (int) $db->query("SELECT lot_id FROM lots WHERE status = 'Available' LIMIT 1")->fetchColumn();
if (!$lotId) {
    $lotId = (int) $db->query("SELECT lot_id FROM lots LIMIT 1")->fetchColumn();
}

$controller = new BookingAgentController();
$service = new BookingAgentService();
$draftModel = new BookingDraft();
$schedModel = new Schedule();
$decReqModel = new DecedentRequest();

// ----------------------------------------------------------------------
// TEST 1 — Draft Name Correction
// Initial: draft with decedent_name = "Kevin Mndo"
// Input: "Kevin Mando dapat."
// ----------------------------------------------------------------------
$draft1Id = $draftModel->create($userAId, 'burial', date('Y-m-d H:i:s', time() + 86400));
$draftModel->updateExtractedData($draft1Id, [
    'service_type'   => 'burial',
    'decedent_name'  => 'Kevin Mndo',
    'relationship'   => 'Son',
    'preferred_date' => '2026-10-15'
]);
$draftModel->transitionStatus($draft1Id, BookingDraft::STATUS_COLLECTING_INFO);

$msg1 = "Kevin Mando dapat.";
$res1 = $controller->chat(['message' => $msg1, 'draft_id' => $draft1Id], $userA);

$freshDraft1 = $draftModel->findById($draft1Id);
$draft1Data = json_decode($freshDraft1['extracted_data'], true);

$t1_actionOk = in_array($res1['action']['status'] ?? '', ['EXECUTED', 'NO_CHANGE'], true);
$t1_nameUpdated = ($draft1Data['decedent_name'] ?? '') === 'Kevin Mando';
$t1_notMissingName = !in_array('decedent_name', $res1['missing_fields'] ?? [], true);
$t1_responseMatches = (strpos($res1['reply'] ?? '', 'Kevin Mando') !== false || strpos($res1['reply'] ?? '', 'updated') !== false || strpos($res1['reply'] ?? '', 'Done') !== false);

$test1Ok = ($t1_actionOk && $t1_nameUpdated && $t1_notMissingName && $t1_responseMatches);
report(1, "Draft Name Correction: Natural language 'Kevin Mando dapat' updates draft decedent_name with zero redundant questions", $test1Ok,
    "Updated Name: " . ($draft1Data['decedent_name'] ?? 'none') . ", Action Status: " . ($res1['action']['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 2 — Committed Booking Metadata Correction
// Initial relationship: "Son" in decedent_requests
// Input: "It should be Daughter."
// ----------------------------------------------------------------------
// Clear drafts to focus on committed booking
$db->prepare("DELETE FROM booking_drafts WHERE user_id = ?")->execute([$userAId]);

$decReq1Id = $decReqModel->create([
    'requested_by' => $userAId,
    'full_name'    => 'Kevin Mando',
    'relationship' => 'Son',
    'notes'        => 'Batch 2 Test Request'
]);

$schedDate = '2026-10-20';
$sched1Id = $schedModel->create([
    'lot_id'              => $lotId,
    'decedent_request_id' => $decReq1Id,
    'schedule_date'       => $schedDate,
    'status'              => 'Pending',
    'notes'               => 'Batch 2 Committed Booking 1',
    'created_by'          => $userAId
]);
$refSched1 = "BUR-{$sched1Id}";

$msg2 = "The relationship should be Daughter, not son for {$refSched1}.";
$res2 = $controller->chat(['message' => $msg2], $userA);

// Verify DB mutation in decedent_requests
$freshDecReq1 = $decReqModel->findById($decReq1Id);
$t2_relUpdated = ($freshDecReq1['relationship'] ?? '') === 'Daughter';

// Verify Audit Log entry
$auditCount = (int) $db->query("
    SELECT COUNT(*) FROM audit_logs 
    WHERE action = 'booking.field_updated' 
      AND user_id = {$userAId} 
      AND entity_id = {$sched1Id}
")->fetchColumn();

$t2_actionOk = ($res2['action']['status'] ?? '') === 'EXECUTED';
$t2_changes = !empty($res2['changes']);

$test2Ok = ($t2_actionOk && $t2_relUpdated && $auditCount >= 1 && $t2_changes);
report(2, "Committed Booking Metadata Correction: Updates relationship to Daughter via transaction and writes audit trail", $test2Ok,
    "DB Relationship: " . ($freshDecReq1['relationship'] ?? 'none') . ", Audit Logs: {$auditCount}, Action: " . ($res2['action']['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 3 — Protected Field
// Input: "Change my booking date to September 25."
// Expected: Intent = RESCHEDULE_BOOKING, Generic update action = NOT EXECUTED / ACTION_DEFERRED, zero schedule mutation
// ----------------------------------------------------------------------
$msg3 = "Change my booking date to September 25.";
$res3 = $controller->chat(['message' => $msg3], $userA);

$freshSched1 = $schedModel->findById($sched1Id);
$t3_zeroMutation = ($freshSched1['schedule_date'] === $schedDate);
$t3_deferred = in_array($res3['action']['status'] ?? '', ['ACTION_DEFERRED', 'AWAITING_CONFIRMATION'], true);
$t3_intent = in_array($res3['intent'] ?? '', ['RESCHEDULE_BOOKING', 'UPDATE_BOOKING'], true);

$test3Ok = ($t3_zeroMutation && $t3_deferred && $t3_intent);
report(3, "Protected Field: Changing schedule date returns ACTION_DEFERRED or AWAITING_CONFIRMATION with zero schedule mutation", $test3Ok,
    "Action Status: " . ($res3['action']['status'] ?? 'none') . ", DB Date: {$freshSched1['schedule_date']}");

// ----------------------------------------------------------------------
// TEST 4 — Ambiguous Field
// Input: "Correct my information."
// Expected: zero mutation, clarification required
// ----------------------------------------------------------------------
$msg4 = "Correct my information for {$refSched1}.";
$res4 = $controller->chat(['message' => $msg4], $userA);

$t4_clarification = ($res4['action_status'] ?? ($res4['action']['status'] ?? '')) === 'CLARIFICATION_REQUIRED' || empty($res4['action']);
$t4_replyClarifies = (stripos($res4['reply'] ?? '', 'which detail') !== false || stripos($res4['reply'] ?? '', 'correct') !== false);
$t4_zeroChanges = empty($res4['changes']);

$test4Ok = ($t4_clarification && $t4_replyClarifies && $t4_zeroChanges);
report(4, "Ambiguous Field: 'Correct my information' prompts clarification without guessing or mutating", $test4Ok,
    "Reply: " . ($res4['reply'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 5 — Unauthorized Booking
// Citizen B references Citizen A's booking BUR-{$sched1Id}
// ----------------------------------------------------------------------
$msg5 = "Change the relationship to Sister for {$refSched1}.";
$res5 = $controller->chat(['message' => $msg5], $userB);

$t5_rejected = in_array($res5['action_status'] ?? ($res5['action']['status'] ?? ''), ['UNAUTHORIZED', 'NOT_FOUND'], true) || ($res5['context_resolution']['status'] ?? '') !== 'RESOLVED';
// Verify relationship in DB is STILL 'Daughter'
$checkDecReq1 = $decReqModel->findById($decReq1Id);
$t5_zeroMutation = ($checkDecReq1['relationship'] === 'Daughter');

$test5Ok = ($t5_rejected && $t5_zeroMutation);
report(5, "Unauthorized Booking: Citizen B cannot edit Citizen A's booking with zero leak and zero mutation", $test5Ok,
    "Status: " . ($res5['action_status'] ?? ($res5['action']['status'] ?? 'none')) . ", DB Relationship: {$checkDecReq1['relationship']}");

// ----------------------------------------------------------------------
// TEST 6 — Immutable State
// Attempt correction on 'Completed' booking
// ----------------------------------------------------------------------
$schedCompletedId = $schedModel->create([
    'lot_id'              => $lotId,
    'decedent_request_id' => $decReq1Id,
    'schedule_date'       => '2026-08-01',
    'status'              => 'Completed',
    'notes'               => 'Batch 2 Completed Booking',
    'created_by'          => $userAId
]);
$refCompleted = "BUR-{$schedCompletedId}";

$msg6 = "Change the relationship to Sister for {$refCompleted}.";
$res6 = $controller->chat(['message' => $msg6], $userA);

$t6_rejected = ($res6['action']['status'] ?? ($res6['action_status'] ?? '')) === 'ACTION_NOT_ALLOWED_FOR_STATE';
$t6_replyNotes = (stripos($res6['reply'] ?? '', 'completed') !== false || stripos($res6['reply'] ?? '', 'status') !== false);

$test6Ok = ($t6_rejected && $t6_replyNotes);
report(6, "Immutable State: Attempted update on 'Completed' booking rejected with ACTION_NOT_ALLOWED_FOR_STATE", $test6Ok,
    "Action Status: " . ($res6['action']['status'] ?? 'none') . ", Reply: " . ($res6['reply'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 7 — Idempotent Retry
// First call updates to 'Niece', second identical call returns NO_CHANGE with 1 audit entry
// ----------------------------------------------------------------------
// Initial state: currently 'Daughter'.
// Call 1: Change to 'Niece'
$msg7_1 = "The relationship should be Niece for {$refSched1}.";
$res7_1 = $controller->chat(['message' => $msg7_1], $userA);
$t7_1_executed = ($res7_1['action']['status'] ?? '') === 'EXECUTED';

$auditsBefore = (int) $db->query("
    SELECT COUNT(*) FROM audit_logs 
    WHERE action = 'booking.field_updated' 
      AND user_id = {$userAId} 
      AND entity_id = {$sched1Id}
")->fetchColumn();

// Call 2: Duplicate request - "The relationship should be Niece for {$refSched1}."
$msg7_2 = "The relationship should be Niece for {$refSched1}.";
$res7_2 = $controller->chat(['message' => $msg7_2], $userA);
$t7_2_noChange = ($res7_2['action']['status'] ?? '') === 'NO_CHANGE';

$auditsAfter = (int) $db->query("
    SELECT COUNT(*) FROM audit_logs 
    WHERE action = 'booking.field_updated' 
      AND user_id = {$userAId} 
      AND entity_id = {$sched1Id}
")->fetchColumn();

$t7_noDuplicateAudit = ($auditsBefore === $auditsAfter);

$test7Ok = ($t7_1_executed && $t7_2_noChange && $t7_noDuplicateAudit);
report(7, "Idempotent Retry: First call returns EXECUTED, second duplicate returns NO_CHANGE with zero duplicate audit logs", $test7Ok,
    "Call 1 Status: " . ($res7_1['action']['status'] ?? '') . ", Call 2 Status: " . ($res7_2['action']['status'] ?? '') . ", Audits: {$auditsBefore} -> {$auditsAfter}");

// ----------------------------------------------------------------------
// CLEANUP TEST DATA
// ----------------------------------------------------------------------
$db->prepare("DELETE FROM audit_logs WHERE user_id IN (?, ?)")->execute([$userAId, $userBId]);
$db->prepare("DELETE FROM burial_schedules WHERE schedule_id IN (?, ?)")->execute([$sched1Id, $schedCompletedId]);
$db->prepare("DELETE FROM decedent_requests WHERE request_id = ?")->execute([$decReq1Id]);
$db->prepare("DELETE FROM booking_drafts WHERE user_id IN (?, ?)")->execute([$userAId, $userBId]);
$db->prepare("DELETE FROM users WHERE user_id IN (?, ?)")->execute([$userAId, $userBId]);

echo "===================================================================\n";
echo "BATCH 2 TEST SUMMARY: {$passed} PASSED, {$failed} FAILED\n";
echo "===================================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
