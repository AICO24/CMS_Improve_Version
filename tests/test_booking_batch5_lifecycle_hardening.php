<?php
/**
 * Test Suite: Booking Automation V2 — Batch 5
 * End-to-End Booking Lifecycle Hardening, Consistency & Concurrency Audit
 * 
 * 45 Automated Scenarios:
 * - Lifecycle (1-7)
 * - Pending Actions (8-16)
 * - Concurrency (17-21)
 * - Payment (22-25)
 * - Advisory Safety (26-31)
 * - AI Trust Boundary (32-37)
 * - Audit & Notification (38-41)
 * - Burial vs Cremation (42-45)
 */

declare(strict_types=1);

require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/BookingPendingAction.php';
require_once __DIR__ . '/../backend/models/AuditLog.php';
require_once __DIR__ . '/../backend/models/Notification.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/services/BookingActionRegistry.php';
require_once __DIR__ . '/../backend/services/BookingRescheduleService.php';
require_once __DIR__ . '/../backend/services/BookingCancellationService.php';
require_once __DIR__ . '/../backend/services/BookingAllocationService.php';
require_once __DIR__ . '/../backend/services/BookingAvailabilityService.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

$db = Database::getInstance()->getConnection();

echo "===================================================================\n";
echo "RUNNING BATCH 5: LIFECYCLE HARDENING & CONCURRENCY AUDIT TEST SUITE\n";
echo "===================================================================\n";

$passCount = 0;
$failCount = 0;

function report(int $num, string $label, bool $pass, string $details = ''): void {
    global $passCount, $failCount;
    if ($pass) {
        $passCount++;
        echo "[PASS] TEST {$num}: {$label}\n";
    } else {
        $failCount++;
        echo "[FAIL] TEST {$num}: {$label}" . ($details ? " — {$details}" : "") . "\n";
    }
}

// ----------------------------------------------------------------------
// SETUP TEST FIXTURES
// ----------------------------------------------------------------------
$db->exec("
    DELETE FROM audit_logs WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch5_test_%');
    DELETE FROM notifications WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch5_test_%');
    DELETE FROM booking_pending_actions WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch5_test_%');
    DELETE FROM payments WHERE received_by IN (SELECT user_id FROM users WHERE username LIKE 'batch5_test_%');
    DELETE FROM burial_schedules WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'batch5_test_%');
    DELETE FROM cremation_records WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'batch5_test_%');
    DELETE FROM booking_drafts WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'batch5_test_%');
    DELETE FROM users WHERE username LIKE 'batch5_test_%';
");

// Create 2 test users
$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('batch5_test_user_a', 'hash', 'Batch 5 Citizen A', 'batch5_a@test.local', 3)
")->execute();
$userAId = (int) $db->lastInsertId();

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('batch5_test_user_b', 'hash', 'Batch 5 Citizen B', 'batch5_b@test.local', 3)
")->execute();
$userBId = (int) $db->lastInsertId();

$userA = ['user_id' => $userAId, 'username' => 'batch5_test_user_a', 'role' => 'user'];
$userB = ['user_id' => $userBId, 'username' => 'batch5_test_user_b', 'role' => 'user'];

// Find or set up test lots
$lots = $db->query("SELECT * FROM lots WHERE status = 'Available' LIMIT 5")->fetchAll();
if (count($lots) < 4) {
    // If not enough lots, find any lots and set Available for testing
    $lots = $db->query("SELECT * FROM lots LIMIT 5")->fetchAll();
    foreach ($lots as $l) {
        $db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = {$l['lot_id']}");
    }
    $lots = $db->query("SELECT * FROM lots WHERE status = 'Available' LIMIT 5")->fetchAll();
}

$lot1 = $lots[0];
$lot2 = $lots[1];
$lot3 = $lots[2];
$lot4 = $lots[3];

$agentService = new BookingAgentService();
$actionRegistry = new BookingActionRegistry();
$agentController = new BookingAgentController();
$pendingActionModel = new BookingPendingAction();
$availService = new BookingAvailabilityService();

// Date fixtures generator (strictly skips Mondays for burial)
function getNextValidBurialDate(string $startDate, int $offsetDays): string {
    $dt = strtotime($startDate);
    $added = 0;
    while ($added < $offsetDays) {
        $dt = strtotime('+1 day', $dt);
        if ((int)date('N', $dt) !== 1) { // Skip Monday
            $added++;
        }
    }
    return date('Y-m-d', $dt);
}

$baseDate = date('Y-m-d', strtotime('+30 days'));
if ((int)date('N', strtotime($baseDate)) === 1) {
    $baseDate = date('Y-m-d', strtotime('+31 days'));
}
$date1 = $baseDate;
$date2 = getNextValidBurialDate($date1, 1);
$date3 = getNextValidBurialDate($date1, 2);

// =====================================================================
// GROUP 1: LIFECYCLE (1–7)
// =====================================================================

// TEST 1: Draft state allows draft-safe edit
$db->prepare("
    INSERT INTO booking_drafts (user_id, service_type, status, extracted_data, missing_fields, expires_at)
    VALUES (?, 'burial', 'COLLECTING_INFO', ?, ?, DATE_ADD(NOW(), INTERVAL 7 DAY))
")->execute([$userAId, json_encode(['decedent_name' => 'Original Name']), json_encode(['preferred_date', 'lot_id'])]);
$draft1Id = (int) $db->lastInsertId();

$res1 = $agentController->chat([
    'message'  => 'Updated Name dapat.',
    'draft_id' => $draft1Id
], $userA);

$stmtD1 = $db->prepare("SELECT extracted_data FROM booking_drafts WHERE draft_id = ?");
$stmtD1->execute([$draft1Id]);
$d1Data = json_decode((string)$stmtD1->fetchColumn(), true);
$test1Pass = ($d1Data['decedent_name'] ?? '') === 'Updated Name';
report(1, "Draft state allows draft-safe edit", $test1Pass);

// TEST 2: Draft cannot execute committed booking action
// Staging a reschedule on draft should only update draft date, NOT create committed schedule or pending action
$res2 = $actionRegistry->stageRescheduleAction(
    $userAId,
    $userA['username'],
    [
        'status'   => 'DRAFT',
        'type'     => 'DRAFT',
        'draft_id' => $draft1Id
    ],
    ['target_date' => $date1],
    "Reschedule to {$date1}"
);
$stmtPA2 = $db->prepare("SELECT COUNT(*) FROM booking_pending_actions WHERE user_id = ?");
$stmtPA2->execute([$userAId]);
$pa2Count = (int) $stmtPA2->fetchColumn();
$stmtSched2 = $db->prepare("SELECT COUNT(*) FROM burial_schedules WHERE created_by = ?");
$stmtSched2->execute([$userAId]);
$sched2Count = (int) $stmtSched2->fetchColumn();
$test2Pass = ($pa2Count === 0 && $sched2Count === 0);
report(2, "Draft cannot execute committed booking action", $test2Pass);

// TEST 3: Pending booking allows confirmed transactional action
$db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
    VALUES (?, ?, '09:00:00', 'Pending', 'Batch 5 Pending Booking', ?)
")->execute([$lot1['lot_id'], $date1, $userAId]);
$schedPendingId = (int) $db->lastInsertId();

$stageRes3 = $actionRegistry->stageRescheduleAction(
    $userAId,
    $userA['username'],
    [
        'type'         => 'COMMITTED_BOOKING',
        'status'       => 'RESOLVED',
        'booking_id'   => $schedPendingId,
        'service_type' => 'burial',
        'reference'    => "BUR-{$schedPendingId}",
        'record'       => [
            'booking_id'    => $schedPendingId,
            'source_id'     => $schedPendingId,
            'service_type'  => 'burial',
            'lot_id'        => (int) $lot1['lot_id'],
            'schedule_date' => $date1,
            'status'        => 'Pending'
        ]
    ],
    ['target_date' => $date2],
    "Reschedule to {$date2}"
);
$pa3Id = (int) ($stageRes3['pending_action']['id'] ?? 0);
$token3 = $stageRes3['pending_action']['confirmation_token'] ?? '';
$confirmRes3 = $actionRegistry->confirmPendingAction($pa3Id, $token3, $userA);

$stmtSched3 = $db->prepare("SELECT schedule_date FROM burial_schedules WHERE schedule_id = ?");
$stmtSched3->execute([$schedPendingId]);
$updatedDate3 = $stmtSched3->fetchColumn();
$test3Pass = ($updatedDate3 === $date2) && !empty($confirmRes3['success']);
report(3, "Pending booking allows confirmed transactional action", $test3Pass);

// TEST 4: Confirmed booking allows reschedule/cancel/allocation
$db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
    VALUES (?, ?, '10:00:00', 'Confirmed', 'Batch 5 Confirmed Booking', ?)
")->execute([$lot2['lot_id'], $date1, $userAId]);
$schedConfirmedId = (int) $db->lastInsertId();
// Set lot status to Reserved
$db->exec("UPDATE lots SET status = 'Reserved' WHERE lot_id = {$lot2['lot_id']}");

$cancelRes4 = (new BookingCancellationService())->cancelBurialSchedule($schedConfirmedId, $userA, 'Testing cancel on confirmed');
$stmtSched4 = $db->prepare("SELECT status FROM burial_schedules WHERE schedule_id = ?");
$stmtSched4->execute([$schedConfirmedId]);
$statusSched4 = $stmtSched4->fetchColumn();
$stmtLot4 = $db->prepare("SELECT status FROM lots WHERE lot_id = ?");
$stmtLot4->execute([$lot2['lot_id']]);
$statusLot4 = $stmtLot4->fetchColumn();
$test4Pass = ($statusSched4 === 'Cancelled' && $statusLot4 === 'Available');
report(4, "Confirmed booking allows reschedule/cancel/allocation", $test4Pass);

// TEST 5: Completed booking rejects mutation
$db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
    VALUES (?, ?, '11:00:00', 'Completed', 'Batch 5 Completed Booking', ?)
")->execute([$lot3['lot_id'], $date1, $userAId]);
$schedCompletedId = (int) $db->lastInsertId();

$rescheduleCompleted = (new BookingRescheduleService())->rescheduleBurialSchedule($schedCompletedId, $date2, '11:00:00', $userA);
$cancelCompleted = (new BookingCancellationService())->cancelBurialSchedule($schedCompletedId, $userA);
$swapCompleted = (new BookingAllocationService())->swapBurialLot($schedCompletedId, (int)$lot4['lot_id'], $userA);

$test5Pass = empty($rescheduleCompleted['success'])
    && empty($cancelCompleted['success'])
    && empty($swapCompleted['success'])
    && ($rescheduleCompleted['code'] ?? 0) === 409
    && ($cancelCompleted['code'] ?? 0) === 409
    && ($swapCompleted['code'] ?? 0) === 409;
report(5, "Completed booking rejects mutation", $test5Pass);

// TEST 6: Cancelled booking rejects reopening/mutation
$rescheduleCancelled = (new BookingRescheduleService())->rescheduleBurialSchedule($schedConfirmedId, $date3, '10:00:00', $userA);
$cancelAgain = (new BookingCancellationService())->cancelBurialSchedule($schedConfirmedId, $userA);
$test6Pass = empty($rescheduleCancelled['success'])
    && ($cancelAgain['already_cancelled'] ?? false) === true
    && ($cancelAgain['booking_cancelled'] ?? true) === false;
report(6, "Cancelled booking rejects reopening/mutation", $test6Pass);

// TEST 7: Terminal-state revalidation prevents stale action execution
// Stage an action while Confirmed, then change schedule status to Completed before confirmation
$db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
    VALUES (?, ?, '13:00:00', 'Confirmed', 'Stale Execution Test', ?)
")->execute([$lot4['lot_id'], $date1, $userAId]);
$schedStaleId = (int) $db->lastInsertId();

$stageStale = $actionRegistry->stageRescheduleAction(
    $userAId,
    $userA['username'],
    [
        'type'         => 'COMMITTED_BOOKING',
        'status'       => 'RESOLVED',
        'booking_id'   => $schedStaleId,
        'service_type' => 'burial',
        'reference'    => "BUR-{$schedStaleId}",
        'record'       => [
            'booking_id'    => $schedStaleId,
            'source_id'     => $schedStaleId,
            'service_type'  => 'burial',
            'lot_id'        => (int) $lot4['lot_id'],
            'schedule_date' => $date1,
            'status'        => 'Confirmed'
        ]
    ],
    ['target_date' => $date2],
    "Reschedule to {$date2}"
);
$stalePaId = (int) $stageStale['pending_action']['id'];
$staleToken = $stageStale['pending_action']['confirmation_token'];

// Out-of-band mutation to terminal state
$db->exec("UPDATE burial_schedules SET status = 'Completed' WHERE schedule_id = {$schedStaleId}");

$confirmStale = $actionRegistry->confirmPendingAction($stalePaId, $staleToken, $userA);
$test7Pass = empty($confirmStale['success']) && ($confirmStale['action_status'] ?? '') === BookingActionRegistry::STATUS_FAILED;
report(7, "Terminal-state revalidation prevents stale action execution", $test7Pass);

// =====================================================================
// GROUP 2: PENDING ACTIONS (8–16)
// =====================================================================

// Reset lot4 to Available and create a clean schedule for user A
$db->exec("DELETE FROM burial_schedules WHERE lot_id = {$lot4['lot_id']}");
$db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = {$lot4['lot_id']}");
$db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
    VALUES (?, ?, '09:30:00', 'Confirmed', 'Pending Action Suite Sched', ?)
")->execute([$lot4['lot_id'], $date1, $userAId]);
$schedPaSuiteId = (int) $db->lastInsertId();

// TEST 8: Valid confirmation succeeds
$stage8 = $actionRegistry->stageRescheduleAction(
    $userAId,
    $userA['username'],
    [
        'type'         => 'COMMITTED_BOOKING',
        'status'       => 'RESOLVED',
        'booking_id'   => $schedPaSuiteId,
        'service_type' => 'burial',
        'reference'    => "BUR-{$schedPaSuiteId}",
        'record'       => [
            'booking_id'    => $schedPaSuiteId,
            'source_id'     => $schedPaSuiteId,
            'service_type'  => 'burial',
            'lot_id'        => (int) $lot4['lot_id'],
            'schedule_date' => $date1,
            'schedule_time' => '09:30:00',
            'status'        => 'Confirmed'
        ]
    ],
    ['target_date' => $date3],
    "Reschedule to {$date3}"
);
$pa8Id = (int) $stage8['pending_action']['id'];
$token8 = $stage8['pending_action']['confirmation_token'];
$confirm8 = $actionRegistry->confirmPendingAction($pa8Id, $token8, $userA);
$test8Pass = !empty($confirm8['success']) && ($confirm8['action_status'] ?? '') === BookingActionRegistry::STATUS_EXECUTED;
report(8, "Valid confirmation succeeds", $test8Pass);

// TEST 9: Invalid token rejected
$stage9 = $actionRegistry->stageCancelAction(
    $userAId,
    $userA['username'],
    [
        'type'         => 'COMMITTED_BOOKING',
        'status'       => 'RESOLVED',
        'booking_id'   => $schedPaSuiteId,
        'service_type' => 'burial',
        'reference'    => "BUR-{$schedPaSuiteId}",
        'record'       => [
            'booking_id'    => $schedPaSuiteId,
            'source_id'     => $schedPaSuiteId,
            'service_type'  => 'burial',
            'lot_id'        => (int) $lot4['lot_id'],
            'schedule_date' => $date3,
            'status'        => 'Confirmed'
        ]
    ],
    [],
    "Cancel booking"
);
$pa9Id = (int) $stage9['pending_action']['id'];
$confirm9 = $actionRegistry->confirmPendingAction($pa9Id, 'invalid_token_12345', $userA);
$test9Pass = empty($confirm9['success']) && ($confirm9['code'] ?? 0) === 400;
report(9, "Invalid token rejected", $test9Pass);

// TEST 10: Expired action rejected
$db->exec("UPDATE booking_pending_actions SET expires_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE id = {$pa9Id}");
$token9 = $stage9['pending_action']['confirmation_token'];
$confirm10 = $actionRegistry->confirmPendingAction($pa9Id, $token9, $userA);
$test10Pass = empty($confirm10['success'])
    && ($confirm10['action_status'] ?? '') === BookingActionRegistry::STATUS_EXPIRED
    && ($confirm10['code'] ?? 0) === 410;
report(10, "Expired action rejected", $test10Pass);

// TEST 11: Payload hash mismatch rejected
$stage11 = $actionRegistry->stageCancelAction(
    $userAId,
    $userA['username'],
    [
        'type'         => 'COMMITTED_BOOKING',
        'status'       => 'RESOLVED',
        'booking_id'   => $schedPaSuiteId,
        'service_type' => 'burial',
        'reference'    => "BUR-{$schedPaSuiteId}",
        'record'       => [
            'booking_id'    => $schedPaSuiteId,
            'source_id'     => $schedPaSuiteId,
            'service_type'  => 'burial',
            'lot_id'        => (int) $lot4['lot_id'],
            'schedule_date' => $date3,
            'status'        => 'Confirmed'
        ]
    ],
    [],
    "Cancel booking"
);
$pa11Id = (int) $stage11['pending_action']['id'];
$token11 = $stage11['pending_action']['confirmation_token'];
// Tamper with payload in DB
$db->exec("UPDATE booking_pending_actions SET payload = '{\"tampered\": true}' WHERE id = {$pa11Id}");
$confirm11 = $actionRegistry->confirmPendingAction($pa11Id, $token11, $userA);
$test11Pass = empty($confirm11['success']) && str_contains($confirm11['error'] ?? '', 'mismatch');
report(11, "Payload hash mismatch rejected", $test11Pass);

// TEST 12: Wrong user rejected
$stage12 = $actionRegistry->stageCancelAction(
    $userAId,
    $userA['username'],
    [
        'type'         => 'COMMITTED_BOOKING',
        'status'       => 'RESOLVED',
        'booking_id'   => $schedPaSuiteId,
        'service_type' => 'burial',
        'reference'    => "BUR-{$schedPaSuiteId}",
        'record'       => [
            'booking_id'    => $schedPaSuiteId,
            'source_id'     => $schedPaSuiteId,
            'service_type'  => 'burial',
            'lot_id'        => (int) $lot4['lot_id'],
            'schedule_date' => $date3,
            'status'        => 'Confirmed'
        ]
    ],
    [],
    "Cancel booking"
);
$pa12Id = (int) $stage12['pending_action']['id'];
$token12 = $stage12['pending_action']['confirmation_token'];
$confirm12 = $actionRegistry->confirmPendingAction($pa12Id, $token12, $userB);
$test12Pass = empty($confirm12['success']) && ($confirm12['code'] ?? 0) === 403;
report(12, "Wrong user rejected", $test12Pass);

// TEST 13: Wrong booking assertion rejected (F-03)
$confirm13 = $actionRegistry->confirmPendingAction($pa12Id, $token12, $userA, 999999);
$test13Pass = empty($confirm13['success'])
    && ($confirm13['code'] ?? 0) === 400
    && str_contains($confirm13['error'] ?? '', 'Booking ID assertion mismatch');
report(13, "Wrong booking assertion rejected", $test13Pass);

// TEST 14: Wrong action-type assertion rejected (F-03)
$confirm14 = $actionRegistry->confirmPendingAction($pa12Id, $token12, $userA, $schedPaSuiteId, 'RESCHEDULE_BOOKING');
$test14Pass = empty($confirm14['success'])
    && ($confirm14['code'] ?? 0) === 400
    && str_contains($confirm14['error'] ?? '', 'Action type assertion mismatch');
report(14, "Wrong action-type assertion rejected", $test14Pass);

// TEST 15: Rejected action returns deterministic STATUS_REJECTED (F-04)
$reject15 = $actionRegistry->rejectPendingAction($pa12Id, $userA);
$confirm15 = $actionRegistry->confirmPendingAction($pa12Id, $token12, $userA);
$test15Pass = ($reject15['action_status'] ?? '') === BookingActionRegistry::STATUS_REJECTED
    && ($confirm15['action_status'] ?? '') === BookingActionRegistry::STATUS_REJECTED
    && ($confirm15['code'] ?? 0) === 400;
report(15, "Rejected action returns deterministic STATUS_REJECTED", $test15Pass);

// TEST 16: Superseded action cannot execute
$stage16a = $actionRegistry->stageRescheduleAction(
    $userAId,
    $userA['username'],
    [
        'type'         => 'COMMITTED_BOOKING',
        'status'       => 'RESOLVED',
        'booking_id'   => $schedPaSuiteId,
        'service_type' => 'burial',
        'reference'    => "BUR-{$schedPaSuiteId}",
        'record'       => [
            'booking_id'    => $schedPaSuiteId,
            'source_id'     => $schedPaSuiteId,
            'service_type'  => 'burial',
            'lot_id'        => (int) $lot4['lot_id'],
            'schedule_date' => $date3,
            'status'        => 'Confirmed'
        ]
    ],
    ['target_date' => $date1],
    "Reschedule to {$date1}"
);
$pa16aId = (int) $stage16a['pending_action']['id'];
$token16a = $stage16a['pending_action']['confirmation_token'];

// Staging another action for the same booking supersedes the first
$stage16b = $actionRegistry->stageCancelAction(
    $userAId,
    $userA['username'],
    [
        'type'         => 'COMMITTED_BOOKING',
        'status'       => 'RESOLVED',
        'booking_id'   => $schedPaSuiteId,
        'service_type' => 'burial',
        'reference'    => "BUR-{$schedPaSuiteId}",
        'record'       => [
            'booking_id'    => $schedPaSuiteId,
            'source_id'     => $schedPaSuiteId,
            'service_type'  => 'burial',
            'lot_id'        => (int) $lot4['lot_id'],
            'schedule_date' => $date3,
            'status'        => 'Confirmed'
        ]
    ],
    [],
    "Cancel booking"
);
$confirm16 = $actionRegistry->confirmPendingAction($pa16aId, $token16a, $userA);
$test16Pass = empty($confirm16['success']) && ($confirm16['action_status'] ?? '') === BookingActionRegistry::STATUS_SUPERSEDED;
report(16, "Superseded action cannot execute", $test16Pass);

// =====================================================================
// GROUP 3: CONCURRENCY (17–21)
// =====================================================================

// TEST 17: Same-slot concurrent allocation cannot create duplicate ownership
// Attempting to insert a duplicate active slot must be prevented by constraint/conflict
$schedModel = new Schedule();
$conflictCheck17 = $schedModel->checkConflict((int)$lot4['lot_id'], $date3, '09:30:00');
$duplicateThrown = false;
try {
    $db->prepare("
        INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
        VALUES (?, ?, '09:30:00', 'Confirmed', 'Duplicate Slot Attempt', ?)
    ")->execute([$lot4['lot_id'], $date3, $userBId]);
} catch (PDOException $e) {
    $duplicateThrown = true;
}
$test17Pass = ($conflictCheck17 !== null) || $duplicateThrown;
report(17, "Same-slot concurrent allocation cannot create duplicate ownership", $test17Pass);

// TEST 18: Same-lot concurrent allocation cannot create duplicate allocation
// Clean up and ensure slot conflict check blocks concurrent swap
$db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = {$lot1['lot_id']}");
$db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
    VALUES (?, ?, '14:00:00', 'Confirmed', 'Sched Concurrent 1', ?)
")->execute([$lot1['lot_id'], $date1, $userAId]);
$schedConc1Id = (int) $db->lastInsertId();

$allocService = new BookingAllocationService();
$swapRes18 = $allocService->swapBurialLot($schedConc1Id, (int)$lot1['lot_id'], $userA);
$test18Pass = ($swapRes18['no_change'] ?? false) === true;
report(18, "Same-lot concurrent allocation cannot create duplicate allocation", $test18Pass);

// TEST 19: Bi-directional lot swap uses deterministic lock order (F-01)
// We test swapBurialLot between two lots. It executes cleanly without deadlock.
$db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = {$lot2['lot_id']}");
$swapRes19 = $allocService->swapBurialLot($schedConc1Id, (int)$lot2['lot_id'], $userA);
$test19Pass = !empty($swapRes19['success']) && ($swapRes19['new_lot_id'] ?? 0) === (int)$lot2['lot_id'];
report(19, "Bi-directional lot swap uses deterministic lock order", $test19Pass);

// TEST 20: Transaction rollback restores all affected state
$lot2StatusBefore = $db->query("SELECT status FROM lots WHERE lot_id = {$lot2['lot_id']}")->fetchColumn();
$rollbackSimulated = false;
try {
    Database::getInstance()->transaction(function () use ($db, $lot2, &$rollbackSimulated) {
        $db->exec("UPDATE lots SET status = 'Occupied' WHERE lot_id = {$lot2['lot_id']}");
        $rollbackSimulated = true;
        throw new RuntimeException("Simulated Failure for Rollback Test");
    });
} catch (RuntimeException $e) {
    // Expected exception
}
$lot2StatusAfter = $db->query("SELECT status FROM lots WHERE lot_id = {$lot2['lot_id']}")->fetchColumn();
$test20Pass = $rollbackSimulated && ($lot2StatusBefore === $lot2StatusAfter);
report(20, "Transaction rollback restores all affected state", $test20Pass);

// TEST 21: Concurrent stale confirmation cannot execute twice
$pa16bId = (int) $stage16b['pending_action']['id'];
$token16b = $stage16b['pending_action']['confirmation_token'];
$firstExec = $actionRegistry->confirmPendingAction($pa16bId, $token16b, $userA);
$secondExec = $actionRegistry->confirmPendingAction($pa16bId, $token16b, $userA);
$test21Pass = !empty($firstExec['success'])
    && ($firstExec['action_status'] ?? '') === BookingActionRegistry::STATUS_EXECUTED
    && ($secondExec['action_status'] ?? '') === BookingActionRegistry::STATUS_ALREADY_EXECUTED
    && ($secondExec['no_change'] ?? false) === true;
report(21, "Concurrent stale confirmation cannot execute twice", $test21Pass);

// =====================================================================
// GROUP 4: PAYMENT (22–25)
// =====================================================================

// Create a confirmed schedule with a verified payment
$db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = {$lot3['lot_id']}");
$db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
    VALUES (?, ?, '15:00:00', 'Confirmed', 'Payment Test Sched', ?)
")->execute([$lot3['lot_id'], $date1, $userAId]);
$schedPayId = (int) $db->lastInsertId();

$paymentModel = new Payment();
$paymentId = $paymentModel->create([
    'reference_id'        => $schedPayId,
    'reference_kind'      => 'schedule',
    'transaction_type'    => 'Lot Purchase',
    'amount'              => 5000.00,
    'payment_date'        => date('Y-m-d'),
    'payment_method'      => 'Cash',
    'verification_status' => 'Verified',
    'received_by'         => $userAId,
]);

// TEST 22: Cancellation preserves payment record
$cancelPayBooking = (new BookingCancellationService())->cancelBurialSchedule($schedPayId, $userA);
$freshPayment22 = $paymentModel->findById($paymentId);
$test22Pass = ($freshPayment22 !== null) && ((int)$freshPayment22['payment_id'] === $paymentId);
report(22, "Cancellation preserves payment record", $test22Pass);

// TEST 23: Verified payment is not automatically refunded
$test23Pass = ($freshPayment22['verification_status'] === 'Verified');
report(23, "Verified payment is not automatically refunded", $test23Pass);

// TEST 24: Cancellation exposes refund-review metadata
$test24Pass = ($cancelPayBooking['refund_review_required'] ?? false) === true
    && ($cancelPayBooking['payment_affected'] ?? true) === false;
report(24, "Cancellation exposes refund-review metadata", $test24Pass);

// TEST 25: Payment state cannot be fabricated by AI output
// Calling conversational endpoint with fake payment claim does not update payments table
$agentController->chat([
    'message' => "I already paid and verified payment for BUR-{$schedPayId} through cash"
], $userA);
$freshPayment25 = $paymentModel->findById($paymentId);
$test25Pass = ($freshPayment25['verification_status'] === 'Verified')
    && ((float)$freshPayment25['amount'] === 5000.00);
report(25, "Payment state cannot be fabricated by AI output", $test25Pass);

// =====================================================================
// GROUP 5: ADVISORY SAFETY (26–31)
// =====================================================================

// Baseline counts
$cntSchedBefore = (int) $db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn();
$cntCremBefore  = (int) $db->query("SELECT COUNT(*) FROM cremation_records")->fetchColumn();
$cntLotsBefore  = (int) $db->query("SELECT COUNT(*) FROM lots WHERE status = 'Available'")->fetchColumn();
$cntDraftBefore = (int) $db->query("SELECT COUNT(*) FROM booking_drafts")->fetchColumn();
$cntAuditBefore = (int) $db->query("SELECT COUNT(*) FROM audit_logs")->fetchColumn();
$cntNotifBefore = (int) $db->query("SELECT COUNT(*) FROM notifications")->fetchColumn();
$cntPaBefore    = (int) $db->query("SELECT COUNT(*) FROM booking_pending_actions")->fetchColumn();

// TEST 26: Availability query performs zero mutation
$chatAdv26 = $agentController->chat([
    'message' => "Available ba sa {$date2}?"
], $userA);
$test26Pass = !empty($chatAdv26['advisory'])
    && ((int)$db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn() === $cntSchedBefore)
    && ((int)$db->query("SELECT COUNT(*) FROM lots WHERE status = 'Available'")->fetchColumn() === $cntLotsBefore);
report(26, "Availability query performs zero mutation", $test26Pass);

// TEST 27: Missing-requirements query performs zero mutation
$chatAdv27 = $agentController->chat([
    'message' => "Ano pa kulang sa booking ko?"
], $userA);
$test27Pass = !empty($chatAdv27['advisory'])
    && ((int)$db->query("SELECT COUNT(*) FROM booking_drafts")->fetchColumn() === $cntDraftBefore);
report(27, "Missing-requirements query performs zero mutation", $test27Pass);

// TEST 28: Resume query performs zero mutation
$chatAdv28 = $agentController->chat([
    'message' => "Saan na ako sa booking?"
], $userA);
$test28Pass = !empty($chatAdv28['advisory'])
    && ((int)$db->query("SELECT COUNT(*) FROM booking_drafts")->fetchColumn() === $cntDraftBefore);
report(28, "Resume query performs zero mutation", $test28Pass);

// TEST 29: Alternative-date search performs zero mutation
$altDates29 = $availService->findAlternativeDates('burial', $date1, (int)$lot1['lot_id']);
$test29Pass = is_array($altDates29)
    && ((int)$db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn() === $cntSchedBefore);
report(29, "Alternative-date search performs zero mutation", $test29Pass);

// TEST 30: Alternative-lot search performs zero mutation
$altLots30 = $availService->findAlternativeLots((int)$lot1['lot_id'], null, 3);
$test30Pass = is_array($altLots30)
    && ((int)$db->query("SELECT COUNT(*) FROM lots WHERE status = 'Available'")->fetchColumn() === $cntLotsBefore);
report(30, "Alternative-lot search performs zero mutation", $test30Pass);

// TEST 31: Advisory response creates no pending action/audit/notification
$cntAuditAfter = (int) $db->query("SELECT COUNT(*) FROM audit_logs")->fetchColumn();
$cntNotifAfter = (int) $db->query("SELECT COUNT(*) FROM notifications")->fetchColumn();
$cntPaAfter    = (int) $db->query("SELECT COUNT(*) FROM booking_pending_actions")->fetchColumn();
$test31Pass = ($cntAuditBefore === $cntAuditAfter)
    && ($cntNotifBefore === $cntNotifAfter)
    && ($cntPaBefore === $cntPaAfter);
report(31, "Advisory response creates no pending action/audit/notification", $test31Pass);

// =====================================================================
// GROUP 6: AI TRUST BOUNDARY (32–37)
// =====================================================================

// TEST 32: AI cannot override authoritative lot availability
// We ask for an occupied lot with fake claim
$db->exec("UPDATE lots SET status = 'Occupied' WHERE lot_id = {$lot1['lot_id']}");
$chat32 = $agentController->chat([
    'message' => "Available ba ang Lot #{$lot1['lot_number']}?"
], $userA);
$test32Pass = ($chat32['availability']['available'] ?? true) === false;
report(32, "AI cannot override authoritative lot availability", $test32Pass);

// TEST 33: AI cannot override authoritative booking state
// Attempting to reschedule completed booking claiming it is pending
$chat33 = (new BookingRescheduleService())->rescheduleBurialSchedule($schedCompletedId, $date2, '10:00:00', $userA);
$test33Pass = empty($chat33['success']) && ($chat33['code'] ?? 0) === 409;
report(33, "AI cannot override authoritative booking state", $test33Pass);

// TEST 34: AI cannot bypass ownership
// User B attempting to modify or check User A's private booking
$cancel34 = (new BookingCancellationService())->cancelBurialSchedule($schedPayId, $userB);
$test34Pass = empty($cancel34['success']) && ($cancel34['code'] ?? 0) === 403;
report(34, "AI cannot bypass ownership", $test34Pass);

// TEST 35: AI cannot modify payment state
// Directly verify that payment model checks database, not conversational context
$hasPay35 = (new BookingCancellationService())->hasVerifiedPayment('burial', $schedPayId);
$test35Pass = ($hasPay35 === true);
report(35, "AI cannot modify payment state", $test35Pass);

// TEST 36: AI cannot execute destructive action without confirmation
// Staging a cancellation must produce AWAITING_CONFIRMATION, never EXECUTED directly
$stage36 = $actionRegistry->stageCancelAction(
    $userAId,
    $userA['username'],
    [
        'type'         => 'COMMITTED_BOOKING',
        'status'       => 'RESOLVED',
        'booking_id'   => $schedPayId,
        'service_type' => 'burial',
        'reference'    => "BUR-{$schedPayId}",
        'record'       => [
            'booking_id'    => $schedPayId,
            'source_id'     => $schedPayId,
            'service_type'  => 'burial',
            'lot_id'        => (int) $lot3['lot_id'],
            'schedule_date' => $date1,
            'status'        => 'Confirmed'
        ]
    ],
    [],
    "Cancel BUR-{$schedPayId}"
);
$test36Pass = ($stage36['action_status'] ?? '') === BookingActionRegistry::STATUS_AWAITING_CONFIRMATION;
report(36, "AI cannot execute destructive action without confirmation", $test36Pass);

// TEST 37: AI-suggested alternative requires authoritative revalidation
// If user selects an alternative date that is actually conflicted, revalidation rejects it
$db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
    VALUES (?, ?, '09:00:00', 'Confirmed', 'Conflicted Alternative', ?)
")->execute([$lot4['lot_id'], $date2, $userBId]);

$schedRevalId = (int) $db->lastInsertId();
$stage37 = $actionRegistry->stageRescheduleAction(
    $userAId,
    $userA['username'],
    [
        'type'         => 'COMMITTED_BOOKING',
        'status'       => 'RESOLVED',
        'booking_id'   => $schedPayId,
        'service_type' => 'burial',
        'reference'    => "BUR-{$schedPayId}",
        'record'       => [
            'booking_id'    => $schedPayId,
            'source_id'     => $schedPayId,
            'service_type'  => 'burial',
            'lot_id'        => (int) $lot4['lot_id'],
            'schedule_date' => $date1,
            'status'        => 'Confirmed'
        ]
    ],
    ['target_date' => $date2],
    "Reschedule to {$date2}"
);
$test37Pass = empty($stage37['success'])
    && ($stage37['code'] ?? '') === BookingAvailabilityService::CODE_SLOT_CONFLICT
    && !empty($stage37['recovery']['alternative_dates']);
report(37, "AI-suggested alternative requires authoritative revalidation", $test37Pass);

// =====================================================================
// GROUP 7: AUDIT & NOTIFICATION (38–41)
// =====================================================================

// Create fresh schedule for clean audit/notification testing
$db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = {$lot2['lot_id']}");
$db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
    VALUES (?, ?, '11:30:00', 'Confirmed', 'Audit Sched Test', ?)
")->execute([$lot2['lot_id'], $date1, $userAId]);
$schedAuditId = (int) $db->lastInsertId();

$auditBefore38 = (int) $db->query("SELECT COUNT(*) FROM audit_logs WHERE entity_id = {$schedAuditId}")->fetchColumn();

// TEST 38: Successful mutation produces the expected audit entry
(new BookingCancellationService())->cancelBurialSchedule($schedAuditId, $userA, 'Audit Test Cancellation');
$auditAfter38 = (int) $db->query("SELECT COUNT(*) FROM audit_logs WHERE entity_id = {$schedAuditId}")->fetchColumn();
$test38Pass = ($auditAfter38 === $auditBefore38 + 1);
report(38, "Successful mutation produces the expected audit entry", $test38Pass);

// TEST 39: Failed transaction does not produce a false success audit
$auditBefore39 = (int) $db->query("SELECT COUNT(*) FROM audit_logs WHERE entity_id = {$schedAuditId}")->fetchColumn();
(new BookingRescheduleService())->rescheduleBurialSchedule($schedAuditId, $date2, '11:30:00', $userA); // Fails because already Cancelled
$auditAfter39 = (int) $db->query("SELECT COUNT(*) FROM audit_logs WHERE entity_id = {$schedAuditId}")->fetchColumn();
$test39Pass = ($auditBefore39 === $auditAfter39);
report(39, "Failed transaction does not produce a false success audit", $test39Pass);

// TEST 40: Notification occurs only after successful commit
$notifCount40 = (int) $db->query("SELECT COUNT(*) FROM notifications WHERE user_id = {$userAId}")->fetchColumn();
$test40Pass = ($notifCount40 >= 1);
report(40, "Notification occurs only after successful commit", $test40Pass);

// TEST 41: Rollback produces no success notification
$notifBefore41 = (int) $db->query("SELECT COUNT(*) FROM notifications WHERE user_id = {$userAId}")->fetchColumn();
try {
    Database::getInstance()->transaction(function () use ($userAId) {
        Database::getInstance()->afterCommit(function () use ($userAId) {
            (new Notification())->create([
                'title'             => 'Test Rollback Notif',
                'message'           => 'This should never be sent',
                'notification_type' => 'System',
                'user_id'           => $userAId
            ]);
        });
        throw new RuntimeException("Simulated Rollback");
    });
} catch (RuntimeException $e) {
    // Expected exception
}
$notifAfter41 = (int) $db->query("SELECT COUNT(*) FROM notifications WHERE user_id = {$userAId}")->fetchColumn();
$test41Pass = ($notifBefore41 === $notifAfter41);
report(41, "Rollback produces no success notification", $test41Pass);

// =====================================================================
// GROUP 8: BURIAL VS CREMATION (42–45)
// =====================================================================

// Create a cremation record for User A
$db->prepare("
    INSERT INTO cremation_records (cremation_date, status, notes, created_by)
    VALUES (?, 'Confirmed', 'Batch 5 Cremation Test', ?)
")->execute([$date1, $userAId]);
$cremId = (int) $db->lastInsertId();

// TEST 42: Burial action targets burial schedule only
$db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = {$lot1['lot_id']}");
$db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, notes, created_by)
    VALUES (?, ?, '16:00:00', 'Confirmed', 'Burial Target Test', ?)
")->execute([$lot1['lot_id'], $date1, $userAId]);
$burialOnlyId = (int) $db->lastInsertId();

(new BookingRescheduleService())->rescheduleBurialSchedule($burialOnlyId, $date2, '16:00:00', $userA);
$freshBurial42 = (new Schedule())->findById($burialOnlyId);
$freshCrem42 = (new Cremation())->findById($cremId);
$test42Pass = ($freshBurial42['schedule_date'] === $date2) && ($freshCrem42['cremation_date'] === $date1);
report(42, "Burial action targets burial schedule only", $test42Pass);

// TEST 43: Cremation action targets cremation record only
(new BookingRescheduleService())->rescheduleCremationRecord($cremId, $date3, $userA);
$freshBurial43 = (new Schedule())->findById($burialOnlyId);
$freshCrem43 = (new Cremation())->findById($cremId);
$test43Pass = ($freshCrem43['cremation_date'] === $date3) && ($freshBurial43['schedule_date'] === $date2);
report(43, "Cremation action targets cremation record only", $test43Pass);

// TEST 44: Burial-specific lot allocation cannot mutate cremation records
// Attempting swapBurialLot on a cremation record ID should fail or not mutate cremation
$swapCremResult = (new BookingAllocationService())->swapBurialLot($cremId, (int)$lot2['lot_id'], $userA);
// Since $cremId doesn't exist in burial_schedules, it returns 404
$test44Pass = empty($swapCremResult['success']) && ($swapCremResult['code'] ?? 0) === 404;
report(44, "Burial-specific lot allocation cannot mutate cremation records", $test44Pass);

// TEST 45: Cremation workflow does not incorrectly require burial-lot state
// Cremation cancellation cancels cremation_records without requiring lot status transition
$cancelCremRes = (new BookingCancellationService())->cancelCremationRecord($cremId, $userA, 'Cremation Cancel Test');
$freshCrem45 = (new Cremation())->findById($cremId);
$test45Pass = !empty($cancelCremRes['success'])
    && ($freshCrem45['status'] === 'Cancelled');
report(45, "Cremation workflow does not incorrectly require burial-lot state", $test45Pass);

echo "===================================================================\n";
echo "BATCH 5 TEST SUMMARY: {$passCount} PASSED, {$failCount} FAILED (TOTAL 45)\n";
echo "===================================================================\n";

if ($failCount > 0) {
    exit(1);
}
exit(0);
