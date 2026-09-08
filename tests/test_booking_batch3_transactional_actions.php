<?php
/**
 * Test Suite: Batch 3 — Booking Automation V2
 * Transactional Rescheduling, Cancellation & Allocation Change
 * 
 * Comprehensive verification of all 25 mandatory scenarios:
 * 1. Draft reschedule updates only draft.
 * 2. Committed reschedule creates pending action with zero mutation.
 * 3. Explicit confirmation executes atomically.
 * 4. Execution-time conflict revalidation prevents stale action execution.
 * 5. Cancellation staging causes zero status change.
 * 6. Confirmed cancellation follows authoritative lifecycle.
 * 7. Duplicate confirmation cannot execute twice.
 * 8. Concurrent confirmation attempts allow only one execution.
 * 9. Ambiguous cancellation never guesses.
 * 10. Cross-user pending action confirmation is rejected.
 * 11. Completed booking cannot be rescheduled.
 * 12. Cancelled booking cannot be modified.
 * 13. Allocation swap locks all required resources.
 * 14. Failed allocation swap fully rolls back.
 * 15. Verified payment remains completely untouched after cancellation.
 * 16. Exactly one audit entry per successful action.
 * 17. Exactly one notification after successful commit.
 * 18. Failed action produces zero notification.
 * 19. Expired action cannot execute.
 * 20. Superseded action cannot execute.
 * 21. New pending action supersedes old pending action for same booking.
 * 22. Generic "Yes" with multiple pending actions is rejected as ambiguous.
 * 23. Payload tampering/hash mismatch is rejected.
 * 24. Idempotent reschedule to same date returns NO_CHANGE.
 * 25. Terminal action retry returns ACTION_ALREADY_EXECUTED without duplicate mutation.
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/BookingPendingAction.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/AuditLog.php';
require_once __DIR__ . '/../backend/models/Notification.php';
require_once __DIR__ . '/../backend/models/DecedentRequest.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/services/BookingActionRegistry.php';
require_once __DIR__ . '/../backend/services/BookingRescheduleService.php';
require_once __DIR__ . '/../backend/services/BookingCancellationService.php';
require_once __DIR__ . '/../backend/services/BookingAllocationService.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

echo "===================================================================\n";
echo "RUNNING BATCH 3: TRANSACTIONAL ACTIONS & CONFIRMATION GATE TESTS\n";
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
// CLEANUP & ENVIRONMENT INITIALIZATION
// ----------------------------------------------------------------------
$db->exec("
    DELETE FROM booking_pending_actions WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch3_test_%');
    DELETE FROM audit_logs WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch3_test_%');
    DELETE FROM payments WHERE reference_id IN (SELECT schedule_id FROM burial_schedules WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'batch3_test_%'));
    DELETE FROM notifications WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch3_test_%');
    DELETE FROM burial_schedules WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'batch3_test_%');
    DELETE FROM cremation_records WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'batch3_test_%');
    DELETE FROM decedent_requests WHERE requested_by IN (SELECT user_id FROM users WHERE username LIKE 'batch3_test_%');
    DELETE FROM booking_drafts WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch3_test_%');
    DELETE FROM users WHERE username IN ('batch3_test_user_a', 'batch3_test_user_b');
");

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('batch3_test_user_a', 'hash', 'Batch 3 Citizen A', 'batch3_a@test.local', 3)
")->execute();
$userAId = (int) $db->lastInsertId();

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('batch3_test_user_b', 'hash', 'Batch 3 Citizen B', 'batch3_b@test.local', 3)
")->execute();
$userBId = (int) $db->lastInsertId();

$userA = ['user_id' => $userAId, 'username' => 'batch3_test_user_a', 'role' => 'user'];
$userB = ['user_id' => $userBId, 'username' => 'batch3_test_user_b', 'role' => 'user'];

// Find or create test lots
$availableLots = $db->query("SELECT lot_id, lot_number, status FROM lots WHERE status = 'Available' LIMIT 5")->fetchAll(PDO::FETCH_ASSOC);
if (count($availableLots) < 3) {
    // If not enough available lots, ensure at least 3 exist
    $sectionId = (int) $db->query("SELECT section_id FROM sections LIMIT 1")->fetchColumn() ?: 1;
    $blockId = (int) $db->query("SELECT block_id FROM blocks LIMIT 1")->fetchColumn() ?: 1;
    $lotTypeId = (int) $db->query("SELECT lot_type_id FROM lot_types LIMIT 1")->fetchColumn() ?: 1;
    for ($i = 1; $i <= 3; $i++) {
        $db->prepare("
            INSERT INTO lots (section_id, block_id, lot_type_id, lot_number, status)
            VALUES (?, ?, ?, ?, 'Available')
        ")->execute([$sectionId, $blockId, $lotTypeId, 'B3-LOT-' . uniqid()]);
    }
    $availableLots = $db->query("SELECT lot_id, lot_number, status FROM lots WHERE status = 'Available' LIMIT 5")->fetchAll(PDO::FETCH_ASSOC);
}

$lot1Id = (int) $availableLots[0]['lot_id'];
$lot2Id = (int) $availableLots[1]['lot_id'];
$lot3Id = (int) $availableLots[2]['lot_id'];

$controller = new BookingAgentController();
$service = new BookingAgentService();
$draftModel = new BookingDraft();
$schedModel = new Schedule();
$cremModel = new Cremation();
$pendingModel = new BookingPendingAction();
$lotModel = new Lot();
$decReqModel = new DecedentRequest();

// Helper to create a test burial schedule
function createBurialBooking($userId, $lotId, $date = '2026-10-15', $status = 'Pending', $time = '09:00:00') {
    global $db, $schedModel, $decReqModel;
    $decReqId = $decReqModel->create([
        'requested_by' => $userId,
        'full_name'    => 'Test Decedent',
        'relationship' => 'Son',
        'notes'        => 'Batch 3 Test Request'
    ]);

    return $schedModel->create([
        'lot_id'              => $lotId,
        'decedent_request_id' => $decReqId,
        'schedule_date'       => $date,
        'schedule_time'       => $time,
        'status'              => $status,
        'notes'               => 'Batch 3 test booking',
        'created_by'          => $userId
    ]);
}

// ----------------------------------------------------------------------
// TEST 1 — Draft reschedule updates only draft
// ----------------------------------------------------------------------
$draft1Id = $draftModel->create($userAId, 'burial', date('Y-m-d H:i:s', time() + 86400));
$draftModel->updateExtractedData($draft1Id, [
    'service_type'   => 'burial',
    'decedent_name'  => 'Draft Decedent',
    'relationship'   => 'Brother',
    'preferred_date' => '2026-10-15'
]);

$res1 = $controller->chat(['message' => 'Move my burial date to 2026-10-22.', 'draft_id' => $draft1Id], $userA);
$freshDraft1 = $draftModel->findById($draft1Id);
$draft1Data = json_decode($freshDraft1['extracted_data'], true);
$pendingCount1 = (int) $db->query("SELECT COUNT(*) FROM booking_pending_actions WHERE user_id = {$userAId}")->fetchColumn();

$test1Ok = (($draft1Data['preferred_date'] ?? '') === '2026-10-22' && $pendingCount1 === 0);
report(1, "Draft reschedule updates only draft without creating pending action", $test1Ok,
    "Draft Date: " . ($draft1Data['preferred_date'] ?? 'none') . ", Pending Actions Count: {$pendingCount1}");

// Clean draft 1
$draftModel->transitionStatus($draft1Id, BookingDraft::STATUS_CANCELLED);

// ----------------------------------------------------------------------
// TEST 2 — Committed reschedule creates pending action with zero mutation
// ----------------------------------------------------------------------
$sched2Id = createBurialBooking($userAId, $lot1Id, '2026-10-15', 'Pending');
$res2 = $controller->chat(['message' => "Reschedule booking BUR-{$sched2Id} to 2026-10-22."], $userA);
$freshSched2 = $schedModel->findById($sched2Id);
$pending2 = $res2['pending_action'] ?? null;

$test2Ok = (
    ($freshSched2['schedule_date'] === '2026-10-15') && // Zero DB mutation!
    !empty($pending2) &&
    $pending2['action_type'] === BookingActionRegistry::ACTION_RESCHEDULE_BOOKING &&
    $pending2['status'] === BookingPendingAction::STATUS_AWAITING_CONFIRMATION &&
    (($res2['action']['status'] ?? '') === 'AWAITING_CONFIRMATION')
);
report(2, "Committed reschedule creates pending action with zero schedule mutation", $test2Ok,
    "DB Date: {$freshSched2['schedule_date']}, Pending Status: " . ($pending2['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 3 — Explicit confirmation executes atomically
// ----------------------------------------------------------------------
$res3 = $controller->confirmPendingAction(
    (int) $pending2['id'],
    ['token' => $pending2['confirmation_token']],
    $userA
);
echo "DEBUG RES3:\n";
print_r($res3);
$freshSched3 = $schedModel->findById($sched2Id);
$pending3 = $pendingModel->findById((int) $pending2['id']);

$test3Ok = (
    !empty($res3['success']) &&
    $freshSched3['schedule_date'] === '2026-10-22' &&
    $pending3['status'] === BookingPendingAction::STATUS_EXECUTED &&
    !empty($pending3['executed_at'])
);
report(3, "Explicit confirmation executes atomically and updates booking", $test3Ok,
    "DB Date: {$freshSched3['schedule_date']}, Pending Status: " . ($pending3['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 4 — Execution-time conflict revalidation prevents stale action execution
// ----------------------------------------------------------------------
// Stage reschedule for User A's booking to 2026-10-25 at 09:00:00 on Lot 1
$res4_stage = $controller->chat(['message' => "Reschedule booking BUR-{$sched2Id} to 2026-10-25."], $userA);
$pending4 = $res4_stage['pending_action'] ?? null;

// Another booking takes Lot 1 on 2026-10-25 at 09:00:00 before User A confirms
$schedConflict = createBurialBooking($userBId, $lot1Id, '2026-10-25', 'Confirmed', '09:00:00');

// User A attempts to confirm their pending action
$res4_confirm = $controller->confirmPendingAction(
    (int) $pending4['id'],
    ['token' => $pending4['confirmation_token']],
    $userA
);

$freshSched4 = $schedModel->findById($sched2Id);
$freshPending4 = $pendingModel->findById((int) $pending4['id']);

$test4Ok = (
    empty($res4_confirm['success']) &&
    $freshPending4['status'] === BookingPendingAction::STATUS_FAILED &&
    $freshSched4['schedule_date'] === '2026-10-22' // Remains unchanged!
);
report(4, "Execution-time conflict revalidation prevents stale action execution", $test4Ok,
    "Confirm Result Success: " . json_encode($res4_confirm['success'] ?? false) . ", Pending Status: {$freshPending4['status']}, Date: {$freshSched4['schedule_date']}");

// Clean up conflict schedule
$conflictSched = $schedModel->findById($schedConflict);
$conflictDecReqId = (int) ($conflictSched['decedent_request_id'] ?? 0);
$db->exec("DELETE FROM burial_schedules WHERE schedule_id = {$schedConflict};");
if ($conflictDecReqId > 0) {
    $db->exec("DELETE FROM decedent_requests WHERE request_id = {$conflictDecReqId};");
}

// ----------------------------------------------------------------------
// TEST 5 — Cancellation staging causes zero status change
// ----------------------------------------------------------------------
$sched5Id = createBurialBooking($userAId, $lot2Id, '2026-11-05', 'Confirmed');
$res5 = $controller->chat(['message' => "Cancel my booking BUR-{$sched5Id}."], $userA);

$freshSched5 = $schedModel->findById($sched5Id);
$pending5 = $res5['pending_action'] ?? null;

$test5Ok = (
    $freshSched5['status'] === 'Confirmed' && // Status NOT changed yet!
    !empty($pending5) &&
    $pending5['action_type'] === BookingActionRegistry::ACTION_CANCEL_BOOKING &&
    $pending5['status'] === BookingPendingAction::STATUS_AWAITING_CONFIRMATION
);
report(5, "Cancellation staging causes zero status change", $test5Ok,
    "Booking Status: {$freshSched5['status']}, Pending Status: " . ($pending5['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 6 — Confirmed cancellation follows authoritative lifecycle
// ----------------------------------------------------------------------
// Lot 2 was Reserved for Confirmed booking
$db->prepare("UPDATE lots SET status = 'Reserved' WHERE lot_id = ?")->execute([$lot2Id]);

$res6 = $controller->confirmPendingAction(
    (int) $pending5['id'],
    ['token' => $pending5['confirmation_token']],
    $userA
);

$freshSched6 = $schedModel->findById($sched5Id);
$freshLot2 = $lotModel->findById($lot2Id);
$pending6 = $pendingModel->findById((int) $pending5['id']);

$test6Ok = (
    !empty($res6['success']) &&
    $freshSched6['status'] === 'Cancelled' &&
    $freshLot2['status'] === 'Available' && // Lot released back to Available!
    $pending6['status'] === BookingPendingAction::STATUS_EXECUTED
);
report(6, "Confirmed cancellation follows authoritative lifecycle and releases lot", $test6Ok,
    "Booking Status: {$freshSched6['status']}, Lot Status: {$freshLot2['status']}");

// ----------------------------------------------------------------------
// TEST 7 — Duplicate confirmation cannot execute twice
// ----------------------------------------------------------------------
$res7 = $controller->confirmPendingAction(
    (int) $pending5['id'],
    ['token' => $pending5['confirmation_token']],
    $userA
);

$test7Ok = (
    !empty($res7['success']) &&
    !empty($res7['no_change']) &&
    ($res7['action_status'] ?? '') === BookingActionRegistry::STATUS_ALREADY_EXECUTED
);
report(7, "Duplicate confirmation cannot execute twice (returns ACTION_ALREADY_EXECUTED)", $test7Ok,
    "Action Status: " . ($res7['action_status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 8 — Concurrent confirmation attempts allow only one execution
// ----------------------------------------------------------------------
// Simulate a worker holding status 'EXECUTING'
$sched8Id = createBurialBooking($userAId, $lot1Id, '2026-11-10', 'Pending');
$pending8 = $pendingModel->createPendingAction($userAId, 'burial', $sched8Id, BookingActionRegistry::ACTION_RESCHEDULE_BOOKING, [
    'action_type'  => BookingActionRegistry::ACTION_RESCHEDULE_BOOKING,
    'booking_type' => 'burial',
    'booking_id'   => $sched8Id,
    'new_date'     => '2026-11-12'
]);
$pendingModel->markExecuting((int) $pending8['id']);

$res8 = $controller->confirmPendingAction(
    (int) $pending8['id'],
    ['token' => $pending8['confirmation_token']],
    $userA
);

$test8Ok = (
    empty($res8['success']) &&
    ($res8['code'] ?? 0) === 409 &&
    ($res8['action_status'] ?? '') === BookingActionRegistry::STATUS_IN_PROGRESS
);
report(8, "Concurrent confirmation attempts allow only one execution (returns 409 IN_PROGRESS)", $test8Ok,
    "Code: " . ($res8['code'] ?? 0) . ", Status: " . ($res8['action_status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 9 — Ambiguous cancellation never guesses
// ----------------------------------------------------------------------
// User A now has sched2Id and sched8Id active.
$res9 = $controller->chat(['message' => "Cancel my reservation please."], $userA);
echo "RES9 REPLY: " . ($res9['reply'] ?? '') . "\n";

$test9Ok = (
    ($res9['context_resolution']['status'] ?? '') === 'AMBIGUOUS' &&
    empty($res9['pending_action']) &&
    (strpos($res9['reply'] ?? '', 'multiple') !== false)
);
report(9, "Ambiguous cancellation never guesses when multiple bookings exist", $test9Ok,
    "Context Status: " . ($res9['context_resolution']['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 10 — Cross-user pending action confirmation is rejected
// ----------------------------------------------------------------------
$sched10Id = createBurialBooking($userAId, $lot1Id, '2026-11-15', 'Pending');
$pending10 = $pendingModel->createPendingAction($userAId, 'burial', $sched10Id, BookingActionRegistry::ACTION_CANCEL_BOOKING, [
    'action_type'  => BookingActionRegistry::ACTION_CANCEL_BOOKING,
    'booking_type' => 'burial',
    'booking_id'   => $sched10Id,
]);

$res10 = $controller->confirmPendingAction(
    (int) $pending10['id'],
    ['token' => $pending10['confirmation_token']],
    $userB // User B attempts to confirm User A's action!
);

$test10Ok = (
    empty($res10['success']) &&
    ($res10['code'] ?? 0) === 403
);
report(10, "Cross-user pending action confirmation is rejected with 403 Unauthorized", $test10Ok,
    "Code: " . ($res10['code'] ?? 0) . ", Error: " . ($res10['error'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 11 — Completed booking cannot be rescheduled
// ----------------------------------------------------------------------
$sched11Id = createBurialBooking($userAId, $lot1Id, '2026-09-01', 'Completed');
$res11 = $controller->chat(['message' => "Reschedule booking BUR-{$sched11Id} to 2026-11-20."], $userA);

$test11Ok = (
    ($res11['action']['status'] ?? '') === BookingActionRegistry::STATUS_NOT_ALLOWED_FOR_STATE &&
    empty($res11['pending_action'])
);
report(11, "Completed booking cannot be rescheduled (ACTION_NOT_ALLOWED_FOR_STATE)", $test11Ok,
    "Action Status: " . ($res11['action']['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 12 — Cancelled booking cannot be modified
// ----------------------------------------------------------------------
$sched12Id = createBurialBooking($userAId, $lot1Id, '2026-09-01', 'Cancelled');
$res12 = $controller->chat(['message' => "Reschedule booking BUR-{$sched12Id} to 2026-11-20."], $userA);

$test12Ok = (
    ($res12['action']['status'] ?? '') === BookingActionRegistry::STATUS_NOT_ALLOWED_FOR_STATE &&
    empty($res12['pending_action'])
);
report(12, "Cancelled booking cannot be modified (ACTION_NOT_ALLOWED_FOR_STATE)", $test12Ok,
    "Action Status: " . ($res12['action']['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 13 — Allocation swap locks all required resources
// ----------------------------------------------------------------------
// Create confirmed booking on lot1 (Reserved). Swap to lot2 (Available).
$db->prepare("UPDATE lots SET status = 'Reserved' WHERE lot_id = ?")->execute([$lot1Id]);
$db->prepare("UPDATE lots SET status = 'Available' WHERE lot_id = ?")->execute([$lot2Id]);
$sched13Id = createBurialBooking($userAId, $lot1Id, '2026-11-20', 'Confirmed');

$res13_stage = $controller->chat(['message' => "Change lot for booking BUR-{$sched13Id} to Lot #{$availableLots[1]['lot_number']}."], $userA);
$pending13 = $res13_stage['pending_action'] ?? null;

$test13_staged = (!empty($pending13) && $pending13['action_type'] === BookingActionRegistry::ACTION_CHANGE_ALLOCATION);

$res13_confirm = $controller->confirmPendingAction(
    (int) $pending13['id'],
    ['token' => $pending13['confirmation_token']],
    $userA
);

$freshSched13 = $schedModel->findById($sched13Id);
$freshLot1 = $lotModel->findById($lot1Id);
$freshLot2_13 = $lotModel->findById($lot2Id);

$test13Ok = (
    $test13_staged &&
    !empty($res13_confirm['success']) &&
    (int) $freshSched13['lot_id'] === $lot2Id &&
    $freshLot1['status'] === 'Available' && // Old lot released!
    $freshLot2_13['status'] === 'Reserved'  // New lot claimed!
);
report(13, "Allocation swap locks all required resources and transitions lots atomically", $test13Ok,
    "Sched Lot: {$freshSched13['lot_id']}, Old Lot Status: {$freshLot1['status']}, New Lot Status: {$freshLot2_13['status']}");

// ----------------------------------------------------------------------
// TEST 14 — Failed allocation swap fully rolls back
// ----------------------------------------------------------------------
// Swap from Lot 2 back to Lot 3. But Lot 3 becomes Occupied right before confirmation.
$db->prepare("UPDATE lots SET status = 'Available' WHERE lot_id = ?")->execute([$lot3Id]);
$res14_stage = $controller->chat(['message' => "Change lot for booking BUR-{$sched13Id} to Lot #{$availableLots[2]['lot_number']}."], $userA);
$pending14 = $res14_stage['pending_action'] ?? null;

// Simulate Lot 3 becoming occupied before confirmation
$db->prepare("UPDATE lots SET status = 'Occupied' WHERE lot_id = ?")->execute([$lot3Id]);

$res14_confirm = $controller->confirmPendingAction(
    (int) $pending14['id'],
    ['token' => $pending14['confirmation_token']],
    $userA
);

$freshSched14 = $schedModel->findById($sched13Id);
$freshLot2_14 = $lotModel->findById($lot2Id);

$test14Ok = (
    empty($res14_confirm['success']) &&
    (int) $freshSched14['lot_id'] === $lot2Id && // Remains on Lot 2
    $freshLot2_14['status'] === 'Reserved'        // Lot 2 remains Reserved
);
report(14, "Failed allocation swap fully rolls back without partial mutation", $test14Ok,
    "Sched Lot: {$freshSched14['lot_id']}, Current Lot Status: {$freshLot2_14['status']}");

// ----------------------------------------------------------------------
// TEST 15 — Verified payment remains completely untouched after cancellation
// ----------------------------------------------------------------------
$sched15Id = createBurialBooking($userAId, $lot1Id, '2026-11-25', 'Confirmed');
// Insert verified payment
$db->prepare("
    INSERT INTO payments (reference_id, reference_kind, transaction_type, payment_method, receipt_number, amount, payment_date, received_by, verification_status, notes)
    VALUES (?, 'schedule', 'Lot Purchase', 'Cash', 'REC-B3-12345', 12500.00, '2026-09-08', 1, 'Verified', 'Verified downpayment')
")->execute([$sched15Id]);
$payment15Id = (int) $db->lastInsertId();

$pending15 = $pendingModel->createPendingAction($userAId, 'burial', $sched15Id, BookingActionRegistry::ACTION_CANCEL_BOOKING, [
    'action_type'            => BookingActionRegistry::ACTION_CANCEL_BOOKING,
    'booking_type'           => 'burial',
    'booking_id'             => $sched15Id,
    'has_verified_payment'   => true,
    'refund_review_required' => true
]);

$res15 = $controller->confirmPendingAction((int) $pending15['id'], ['token' => $pending15['confirmation_token']], $userA);
$freshPayment15 = $db->query("SELECT * FROM payments WHERE payment_id = {$payment15Id}")->fetch(PDO::FETCH_ASSOC);

$test15Ok = (
    !empty($res15['success']) &&
    !empty($freshPayment15) &&
    (float) $freshPayment15['amount'] === 12500.00 &&
    $freshPayment15['verification_status'] === 'Verified' &&
    !empty($res15['refund_review_required']) &&
    empty($res15['payment_affected'])
);
report(15, "Verified payment remains completely untouched after booking cancellation", $test15Ok,
    "Payment Status: " . ($freshPayment15['verification_status'] ?? 'deleted') . ", Review Required: " . json_encode($res15['refund_review_required'] ?? false));

// ----------------------------------------------------------------------
// TEST 16 — Exactly one audit entry per successful action
// ----------------------------------------------------------------------
$sched16Id = createBurialBooking($userAId, $lot1Id, '2026-11-28', 'Pending');
$pending16 = $pendingModel->createPendingAction($userAId, 'burial', $sched16Id, BookingActionRegistry::ACTION_RESCHEDULE_BOOKING, [
    'action_type'  => BookingActionRegistry::ACTION_RESCHEDULE_BOOKING,
    'booking_type' => 'burial',
    'booking_id'   => $sched16Id,
    'new_date'     => '2026-11-29',
    'new_time'     => '10:00:00'
]);

$auditBefore = (int) $db->query("SELECT COUNT(*) FROM audit_logs WHERE user_id = {$userAId}")->fetchColumn();
$res16 = $controller->confirmPendingAction((int) $pending16['id'], ['token' => $pending16['confirmation_token']], $userA);
$auditAfter = (int) $db->query("SELECT COUNT(*) FROM audit_logs WHERE user_id = {$userAId}")->fetchColumn();

$test16Ok = (!empty($res16['success']) && ($auditAfter - $auditBefore) === 1);
report(16, "Exactly one audit entry written per successful transactional action", $test16Ok,
    "Audit Entries Before: {$auditBefore}, After: {$auditAfter}, Delta: " . ($auditAfter - $auditBefore));

// ----------------------------------------------------------------------
// TEST 17 — Exactly one notification after successful commit
// ----------------------------------------------------------------------
$notifBefore = (int) $db->query("SELECT COUNT(*) FROM notifications WHERE user_id = {$userAId}")->fetchColumn();
$sched17Id = createBurialBooking($userAId, $lot1Id, '2026-12-01', 'Pending');
$pending17 = $pendingModel->createPendingAction($userAId, 'burial', $sched17Id, BookingActionRegistry::ACTION_RESCHEDULE_BOOKING, [
    'action_type'  => BookingActionRegistry::ACTION_RESCHEDULE_BOOKING,
    'booking_type' => 'burial',
    'booking_id'   => $sched17Id,
    'new_date'     => '2026-12-02',
    'new_time'     => '10:00:00'
]);
$res17 = $controller->confirmPendingAction((int) $pending17['id'], ['token' => $pending17['confirmation_token']], $userA);
$notifAfter = (int) $db->query("SELECT COUNT(*) FROM notifications WHERE user_id = {$userAId}")->fetchColumn();

$test17Ok = (!empty($res17['success']) && ($notifAfter - $notifBefore) === 1);
report(17, "Exactly one notification queued/created after successful transaction commit", $test17Ok,
    "Notif Before: {$notifBefore}, After: {$notifAfter}, Delta: " . ($notifAfter - $notifBefore));

// ----------------------------------------------------------------------
// TEST 18 — Failed action produces zero notification
// ----------------------------------------------------------------------
$notifBefore18 = (int) $db->query("SELECT COUNT(*) FROM notifications WHERE user_id = {$userAId}")->fetchColumn();
// Create invalid action with non-existent lot swap
$pending18 = $pendingModel->createPendingAction($userAId, 'burial', $sched17Id, BookingActionRegistry::ACTION_CHANGE_ALLOCATION, [
    'action_type'  => BookingActionRegistry::ACTION_CHANGE_ALLOCATION,
    'booking_type' => 'burial',
    'booking_id'   => $sched17Id,
    'new_lot_id'   => 9999999 // Invalid lot!
]);
$res18 = $controller->confirmPendingAction((int) $pending18['id'], ['token' => $pending18['confirmation_token']], $userA);
$notifAfter18 = (int) $db->query("SELECT COUNT(*) FROM notifications WHERE user_id = {$userAId}")->fetchColumn();

$test18Ok = (empty($res18['success']) && ($notifAfter18 - $notifBefore18) === 0);
report(18, "Failed action produces zero notification due to atomic transaction rollback", $test18Ok,
    "Notif Delta: " . ($notifAfter18 - $notifBefore18));

// ----------------------------------------------------------------------
// TEST 19 — Expired action cannot execute
// ----------------------------------------------------------------------
$sched19Id = createBurialBooking($userAId, $lot1Id, '2026-12-05', 'Pending');
$pending19 = $pendingModel->createPendingAction($userAId, 'burial', $sched19Id, BookingActionRegistry::ACTION_RESCHEDULE_BOOKING, [
    'action_type'  => BookingActionRegistry::ACTION_RESCHEDULE_BOOKING,
    'booking_type' => 'burial',
    'booking_id'   => $sched19Id,
    'new_date'     => '2026-12-06'
]);
// Backdate expires_at to past timestamp
$db->exec("UPDATE booking_pending_actions SET expires_at = '2020-01-01 00:00:00' WHERE id = {$pending19['id']}");

$res19 = $controller->confirmPendingAction((int) $pending19['id'], ['token' => $pending19['confirmation_token']], $userA);
$freshPending19 = $pendingModel->findById((int) $pending19['id']);

$test19Ok = (
    empty($res19['success']) &&
    ($res19['action_status'] ?? '') === BookingPendingAction::STATUS_EXPIRED &&
    $freshPending19['status'] === BookingPendingAction::STATUS_EXPIRED
);
report(19, "Expired action cannot execute and transitions to EXPIRED", $test19Ok,
    "Status: " . ($res19['action_status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 20 — Superseded action cannot execute
// ----------------------------------------------------------------------
$sched20Id = createBurialBooking($userAId, $lot1Id, '2026-12-10', 'Pending');
$pending20 = $pendingModel->createPendingAction($userAId, 'burial', $sched20Id, BookingActionRegistry::ACTION_RESCHEDULE_BOOKING, [
    'action_type'  => BookingActionRegistry::ACTION_RESCHEDULE_BOOKING,
    'booking_type' => 'burial',
    'booking_id'   => $sched20Id,
    'new_date'     => '2026-12-11'
]);
$pendingModel->markSuperseded((int) $pending20['id']);

$res20 = $controller->confirmPendingAction((int) $pending20['id'], ['token' => $pending20['confirmation_token']], $userA);
$test20Ok = (
    empty($res20['success']) &&
    ($res20['action_status'] ?? '') === BookingPendingAction::STATUS_SUPERSEDED
);
report(20, "Superseded action cannot execute", $test20Ok,
    "Status: " . ($res20['action_status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 21 — New pending action supersedes old pending action for same booking
// ----------------------------------------------------------------------
$sched21Id = createBurialBooking($userAId, $lot1Id, '2026-12-15', 'Pending');
// Stage Action A
$res21_a = $controller->chat(['message' => "Reschedule booking BUR-{$sched21Id} to 2026-12-18."], $userA);
$pending21_a = $res21_a['pending_action'];

// Immediately stage Action B on same booking
$res21_b = $controller->chat(['message' => "Actually reschedule booking BUR-{$sched21Id} to 2026-12-22."], $userA);
$pending21_b = $res21_b['pending_action'];

$freshPending21_a = $pendingModel->findById((int) $pending21_a['id']);
$freshPending21_b = $pendingModel->findById((int) $pending21_b['id']);

$test21Ok = (
    $freshPending21_a['status'] === BookingPendingAction::STATUS_SUPERSEDED &&
    $freshPending21_b['status'] === BookingPendingAction::STATUS_AWAITING_CONFIRMATION
);
report(21, "New pending action supersedes old pending action for same booking", $test21Ok,
    "Old Action Status: {$freshPending21_a['status']}, New Action Status: {$freshPending21_b['status']}");

// ----------------------------------------------------------------------
// TEST 22 — Generic 'Yes' with multiple pending actions is rejected as ambiguous
// ----------------------------------------------------------------------
// User A already has pending21_b on sched21Id. Now create a second active pending action on sched19Id:
$sched22_2 = createBurialBooking($userAId, $lot1Id, '2026-12-28', 'Pending');
$res22_second = $controller->chat(['message' => "Reschedule booking BUR-{$sched22_2} to 2026-12-30."], $userA);

// Now User A has 2 active pending actions! User A says "Yes"
$res22_yes = $controller->chat(['message' => "Yes"], $userA);

$test22Ok = (
    empty($res22_yes['success']) &&
    ($res22_yes['action_status'] ?? '') === BookingActionRegistry::STATUS_CLARIFICATION_REQUIRED &&
    strpos($res22_yes['reply'] ?? '', 'multiple pending actions') !== false
);
report(22, "Generic 'Yes' with multiple pending actions is rejected as ambiguous", $test22Ok,
    "Success: " . json_encode($res22_yes['success'] ?? false) . ", Status: " . ($res22_yes['action_status'] ?? 'none'));

// Clean up pending actions for next tests
$db->exec("UPDATE booking_pending_actions SET status = 'SUPERSEDED' WHERE user_id = {$userAId} AND status = 'AWAITING_CONFIRMATION'");

// ----------------------------------------------------------------------
// TEST 23 — Payload tampering/hash mismatch is rejected
// ----------------------------------------------------------------------
$sched23Id = createBurialBooking($userAId, $lot1Id, '2026-12-16', 'Pending');
$pending23 = $pendingModel->createPendingAction($userAId, 'burial', $sched23Id, BookingActionRegistry::ACTION_RESCHEDULE_BOOKING, [
    'action_type'  => BookingActionRegistry::ACTION_RESCHEDULE_BOOKING,
    'booking_type' => 'burial',
    'booking_id'   => $sched23Id,
    'new_date'     => '2026-12-18'
]);

// Tamper with payload directly in MySQL without updating payload_hash
$tamperedJson = json_encode([
    'action_type'  => BookingActionRegistry::ACTION_RESCHEDULE_BOOKING,
    'booking_type' => 'burial',
    'booking_id'   => $sched23Id,
    'new_date'     => '2026-12-25' // Tampered date!
]);
$db->prepare("UPDATE booking_pending_actions SET payload = ? WHERE id = ?")->execute([$tamperedJson, $pending23['id']]);

$res23 = $controller->confirmPendingAction((int) $pending23['id'], ['token' => $pending23['confirmation_token']], $userA);

$test23Ok = (
    empty($res23['success']) &&
    strpos($res23['error'] ?? '', 'mismatch') !== false
);
report(23, "Payload tampering/hash mismatch is rejected", $test23Ok,
    "Error: " . ($res23['error'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 24 — Idempotent reschedule to same date returns NO_CHANGE
// ----------------------------------------------------------------------
$sched24Id = createBurialBooking($userAId, $lot1Id, '2026-12-20', 'Pending', '09:00:00');
$res24 = $controller->chat(['message' => "Reschedule booking BUR-{$sched24Id} to 2026-12-20."], $userA);

$test24Ok = (
    ($res24['action']['status'] ?? '') === BookingActionRegistry::STATUS_NO_CHANGE &&
    empty($res24['pending_action'])
);
report(24, "Idempotent reschedule to same date returns NO_CHANGE", $test24Ok,
    "Action Status: " . ($res24['action']['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 25 — Terminal action retry returns ACTION_ALREADY_EXECUTED without duplicate mutation
// ----------------------------------------------------------------------
// Re-use executed action from Test 3 ($pending2['id'])
$res25 = $controller->confirmPendingAction(
    (int) $pending2['id'],
    ['token' => $pending2['confirmation_token']],
    $userA
);

$test25Ok = (
    !empty($res25['success']) &&
    !empty($res25['no_change']) &&
    ($res25['action_status'] ?? '') === BookingActionRegistry::STATUS_ALREADY_EXECUTED
);
report(25, "Terminal action retry returns ACTION_ALREADY_EXECUTED without duplicate mutation", $test25Ok,
    "Action Status: " . ($res25['action_status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST SUMMARY
// ----------------------------------------------------------------------
echo "===================================================================\n";
echo "BATCH 3 TEST SUMMARY: {$passed} PASSED, {$failed} FAILED\n";
echo "===================================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
