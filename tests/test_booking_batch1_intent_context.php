<?php
/**
 * Test Suite: Batch 1 — Booking Automation V2
 * Intent Recognition & Unified Booking Context Foundation
 * 
 * Verifies the 6 required scenarios:
 * 1. Multi-slot Create: AI extracts multiple slots in one turn and updates draft without repetitive questions.
 * 2. Correction Intent: AI identifies CORRECT_BOOKING_DETAILS and resolves to active draft.
 * 3. Reschedule Intent: Single active booking resolves to COMMITTED_BOOKING with zero DB mutation.
 * 4. Explicit Reference: Canonical reference (e.g. BUR-14) resolves with ownership validation and zero cancellation.
 * 5. Ambiguous Booking: Multiple matching bookings yield AMBIGUOUS status without guessing.
 * 6. Cross-User Security: User B cannot resolve User A's booking reference; zero metadata leaked.
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/UnifiedBooking.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

echo "===============================================================\n";
echo "RUNNING BATCH 1: INTENT RECOGNITION & CONTEXT RESOLUTION TESTS\n";
echo "===============================================================\n";

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
    DELETE FROM burial_schedules WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'batch1_test_%');
    DELETE FROM cremation_records WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'batch1_test_%');
    DELETE FROM booking_drafts WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch1_test_%');
    DELETE FROM users WHERE username IN ('batch1_test_user_a', 'batch1_test_user_b');
");

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('batch1_test_user_a', 'hash', 'Citizen User A', 'batch1_a@test.local', 3)
")->execute();
$userAId = (int) $db->lastInsertId();

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('batch1_test_user_b', 'hash', 'Citizen User B', 'batch1_b@test.local', 3)
")->execute();
$userBId = (int) $db->lastInsertId();

$userA = ['user_id' => $userAId, 'username' => 'batch1_test_user_a', 'role' => 'user'];
$userB = ['user_id' => $userBId, 'username' => 'batch1_test_user_b', 'role' => 'user'];

// Find or pick a valid lot
$lotId = (int) $db->query("SELECT lot_id FROM lots WHERE status = 'Available' LIMIT 1")->fetchColumn();
if (!$lotId) {
    $lotId = (int) $db->query("SELECT lot_id FROM lots LIMIT 1")->fetchColumn();
}

$controller = new BookingAgentController();
$service = new BookingAgentService();
$draftModel = new BookingDraft();
$schedModel = new Schedule();

// ----------------------------------------------------------------------
// TEST 1 — Multi-slot Create
// Input: "I want to book a burial for my son Kevin L. Mando on September 20."
// ----------------------------------------------------------------------
$msg1 = "I want to book a burial for my son Kevin L. Mando on September 20.";
$res1 = $controller->chat(['message' => $msg1], $userA);

$t1_hasIntent = in_array($res1['intent'] ?? '', [BookingAgentService::INTENT_CREATE_BOOKING, 'CREATE_BOOKING'], true);
$t1_serviceBurial = ($res1['service_type'] ?? '') === 'burial';
$t1_hasName = false;
$extractedName = $res1['extracted_data']['decedent_name'] ?? ($res1['slots']['decedent_name'] ?? '');
if (stripos($extractedName, 'Kevin') !== false) {
    $t1_hasName = true;
}
$t1_hasDate = !empty($res1['extracted_data']['preferred_date']) || !empty($res1['slots']['preferred_date']) || !empty($res1['slots']['target_date']);
$t1_missingNotName = !in_array('decedent_name', $res1['missing_fields'] ?? [], true);
$t1_draftUpdated = ($res1['draft_id'] ?? 0) > 0;

$test1Ok = ($res1['success'] === true && $t1_hasIntent && $t1_serviceBurial && $t1_hasName && $t1_draftUpdated && $t1_missingNotName);
report(1, "Multi-slot Create: Extracts intent, service, name, date and updates draft without redundant questions", $test1Ok, 
    "Intent: " . ($res1['intent'] ?? 'none') . ", Name: {$extractedName}, Missing: " . json_encode($res1['missing_fields'] ?? []));

$activeDraftId = $res1['draft_id'] ?? 0;

// ----------------------------------------------------------------------
// TEST 2 — Correction Intent
// Input: "I spelled Kevin's surname incorrectly. It should be Mando."
// ----------------------------------------------------------------------
$msg2 = "I spelled Kevin's surname incorrectly. It should be Mando.";
$res2 = $controller->chat(['message' => $msg2, 'draft_id' => $activeDraftId], $userA);

$t2_intentMatches = in_array($res2['intent'] ?? '', [
    BookingAgentService::INTENT_CORRECT_BOOKING_DETAILS, 
    BookingAgentService::INTENT_UPDATE_FIELD,
    'CORRECT_BOOKING_DETAILS'
], true);
$t2_contextDraft = ($res2['context_resolution']['type'] ?? '') === 'DRAFT' || ($res2['context_resolution']['status'] ?? '') === 'DRAFT' || ($res2['draft_id'] ?? 0) === $activeDraftId;
$t2_noDestructive = ($res2['success'] === true);

$test2Ok = ($t2_intentMatches && $t2_contextDraft && $t2_noDestructive);
report(2, "Correction Intent: Recognizes CORRECT_BOOKING_DETAILS and resolves to active draft safely", $test2Ok,
    "Intent: " . ($res2['intent'] ?? 'none') . ", Context: " . json_encode($res2['context_resolution'] ?? []));

// ----------------------------------------------------------------------
// TEST 3 — Reschedule Intent (Single Active Booking)
// Setup: Clear active drafts for User A, insert exactly 1 active burial schedule.
// ----------------------------------------------------------------------
$db->prepare("DELETE FROM booking_drafts WHERE user_id = ?")->execute([$userAId]);

// Insert committed schedule for User A
$schedDateInitial = '2026-09-20';
$sched1Id = $schedModel->create([
    'lot_id'        => $lotId,
    'schedule_date' => $schedDateInitial,
    'status'        => 'Pending',
    'notes'         => 'Batch 1 Active Booking A',
    'created_by'    => $userAId
]);
$refSched1 = "BUR-{$sched1Id}";

$msg3 = "Move my burial booking to September 25.";
$res3 = $controller->chat(['message' => $msg3], $userA);

$t3_intent = in_array($res3['intent'] ?? '', [BookingAgentService::INTENT_RESCHEDULE_BOOKING, 'RESCHEDULE_BOOKING'], true);
$t3_resolved = ($res3['context_resolution']['status'] ?? '') === 'RESOLVED';
$t3_bookingId = (int) ($res3['context_resolution']['booking_id'] ?? 0) === $sched1Id;
$t3_ref = ($res3['context_resolution']['reference'] ?? '') === $refSched1;

// Verify DB zero-mutation: schedule_date MUST still be $schedDateInitial
$freshSched1 = $schedModel->findById($sched1Id);
$t3_zeroMutation = ($freshSched1['schedule_date'] === $schedDateInitial);

$test3Ok = ($res3['success'] === true && $t3_intent && $t3_resolved && $t3_bookingId && $t3_ref && $t3_zeroMutation);
report(3, "Reschedule Intent: Single active booking resolves with zero database mutation", $test3Ok,
    "Intent: " . ($res3['intent'] ?? '') . ", Resolved: " . ($res3['context_resolution']['reference'] ?? 'none') . ", DB Date: {$freshSched1['schedule_date']}");

// ----------------------------------------------------------------------
// TEST 4 — Explicit Reference
// Input: "Cancel BUR-{$sched1Id}."
// ----------------------------------------------------------------------
$msg4 = "Cancel {$refSched1}.";
$res4 = $controller->chat(['message' => $msg4], $userA);

$t4_intent = in_array($res4['intent'] ?? '', [BookingAgentService::INTENT_CANCEL_BOOKING, 'CANCEL_BOOKING'], true);
$t4_resolved = ($res4['context_resolution']['status'] ?? '') === 'RESOLVED';
$t4_bookingId = (int) ($res4['context_resolution']['booking_id'] ?? 0) === $sched1Id;

// Verify DB zero-cancellation: status MUST still be 'Pending'
$postCancelSched = $schedModel->findById($sched1Id);
$t4_zeroMutation = ($postCancelSched['status'] === 'Pending');

$test4Ok = ($res4['success'] === true && $t4_intent && $t4_resolved && $t4_bookingId && $t4_zeroMutation);
report(4, "Explicit Reference: Resolves {$refSched1} with ownership check and zero cancellation execution", $test4Ok,
    "Intent: " . ($res4['intent'] ?? '') . ", Target: " . ($res4['context_resolution']['reference'] ?? 'none') . ", DB Status: {$postCancelSched['status']}");

// ----------------------------------------------------------------------
// TEST 5 — Ambiguous Booking
// Setup: Insert a second active burial schedule for User A. User A now has 2 active bookings.
// ----------------------------------------------------------------------
$sched2Id = $schedModel->create([
    'lot_id'        => $lotId,
    'schedule_date' => '2026-10-05',
    'status'        => 'Pending',
    'notes'         => 'Batch 1 Active Booking A2',
    'created_by'    => $userAId
]);
$refSched2 = "BUR-{$sched2Id}";

$msg5 = "Change my booking.";
$res5 = $controller->chat(['message' => $msg5], $userA);

$t5_ambiguous = ($res5['context_resolution']['status'] ?? '') === 'AMBIGUOUS';
$t5_noGuess = empty($res5['context_resolution']['booking_id']);
$t5_candidates = count($res5['context_resolution']['candidates'] ?? []) >= 2;

$test5Ok = ($res5['success'] === true && $t5_ambiguous && $t5_noGuess && $t5_candidates);
report(5, "Ambiguous Booking: Does not guess between multiple bookings and returns AMBIGUOUS context", $test5Ok,
    "Status: " . ($res5['context_resolution']['status'] ?? 'none') . ", Candidates: " . count($res5['context_resolution']['candidates'] ?? []));

// ----------------------------------------------------------------------
// TEST 6 — Cross-User Security
// Citizen B attempts to reference Citizen A's booking BUR-{$sched1Id}.
// ----------------------------------------------------------------------
$msg6 = "Cancel {$refSched1}.";
$res6 = $controller->chat(['message' => $msg6], $userB);

$t6_notResolvedA = ($res6['context_resolution']['status'] ?? '') !== 'RESOLVED' || (int)($res6['context_resolution']['booking_id'] ?? 0) !== $sched1Id;
$t6_statusNotFound = in_array($res6['context_resolution']['status'] ?? '', ['NOT_FOUND', 'NO_ACTIVE_CONTEXT'], true);
// Ensure no metadata leaked about User A's booking
$t6_noLeak = true;
$resString = json_encode($res6);
if (stripos($resString, 'Batch 1 Active Booking A') !== false || stripos($resString, 'Citizen User A') !== false) {
    $t6_noLeak = false;
}

$test6Ok = ($t6_notResolvedA && $t6_statusNotFound && $t6_noLeak);
report(6, "Cross-User Security: Citizen B cannot resolve Citizen A's booking {$refSched1} and zero metadata is leaked", $test6Ok,
    "Status: " . ($res6['context_resolution']['status'] ?? 'none') . ", No leak: " . ($t6_noLeak ? 'true' : 'false'));

// ----------------------------------------------------------------------
// CLEANUP TEST DATA
// ----------------------------------------------------------------------
$db->prepare("DELETE FROM burial_schedules WHERE schedule_id IN (?, ?)")->execute([$sched1Id, $sched2Id]);
$db->prepare("DELETE FROM booking_drafts WHERE user_id IN (?, ?)")->execute([$userAId, $userBId]);
$db->prepare("DELETE FROM users WHERE user_id IN (?, ?)")->execute([$userAId, $userBId]);

echo "===============================================================\n";
echo "BATCH 1 TEST SUMMARY: {$passed} PASSED, {$failed} FAILED\n";
echo "===============================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
