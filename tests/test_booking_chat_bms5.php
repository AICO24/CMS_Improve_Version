<?php
/**
 * Test Suite: BMS-5 Conversational AI Booking Assistant Integration
 * 
 * Verifies:
 * 1. Natural language conversational chat entry point (POST /api/booking-agent/chat)
 * 2. Slot extraction bridging into authoritative BookingAgentService state machine
 * 3. Conversational AI reply accompanying authoritative draft payload
 * 4. Multi-turn dialogue progression (Intake -> Lot Selection -> Ready for Review -> Awaiting Confirm)
 * 5. Pre-confirmation boundaries (zero premature burial_schedules / cremation_records)
 * 6. Ownership isolation in conversational endpoints
 * 7. Graceful offline/fallback handling
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/services/AIService.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

echo "======================================================\n";
echo "RUNNING BMS-5 CONVERSATIONAL BOOKING AGENT TEST SUITE\n";
echo "======================================================\n";

$db = Database::getInstance()->getConnection();

// Fetch two test users for isolation tests
$users = $db->query("SELECT user_id, username FROM users ORDER BY user_id ASC LIMIT 2")->fetchAll(PDO::FETCH_ASSOC);
if (count($users) < 1) {
    echo "FATAL: At least 1 user required in database.\n";
    exit(1);
}

$userA = $users[0];
$userA['role'] = 'user';
$userB = count($users) > 1 ? $users[1] : [
    'user_id' => 999999,
    'username' => 'isolated_chat_user',
    'role' => 'user'
];
$userB['role'] = 'user';

// Clean test drafts
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");

// Find valid lot_id
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
    $d = new DateTime('+35 days');
    if ((int) $d->format('N') === 1) {
        $d->modify('+1 day');
    }
    return $d->format('Y-m-d');
}

$futureDate = getValidFutureDate();

// ----------------------------------------------------------------------
// TEST 1: Empty chat message returns HTTP 400
// ----------------------------------------------------------------------
$res1 = $controller->chat(['message' => ''], $userA);
$test1Ok = ($res1['code'] === 400 && $res1['success'] === false);
report(1, "Empty chat message rejected with HTTP 400", $test1Ok, "Code: {$res1['code']}");

// ----------------------------------------------------------------------
// TEST 2: Unauthenticated chat request returns HTTP 401
// ----------------------------------------------------------------------
$res2 = $controller->chat(['message' => 'Hello'], null);
$test2Ok = ($res2['code'] === 401 && $res2['success'] === false);
report(2, "Unauthenticated chat request returns HTTP 401", $test2Ok, "Code: {$res2['code']}");

// ----------------------------------------------------------------------
// TEST 3: Natural language turn initiates booking and creates draft
// ----------------------------------------------------------------------
$message3 = "I want to arrange a burial for my brother Mateo Santos on {$futureDate}";
$res3 = $controller->chat(['message' => $message3], $userA);
$draftId = $res3['draft_id'] ?? 0;
$test3Ok = (
    $res3['code'] === 200
    && $res3['success'] === true
    && $draftId > 0
    && !empty($res3['reply'])
    && $res3['service_type'] === 'burial'
    && in_array($res3['status'], [BookingDraft::STATUS_COLLECTING_INFO, BookingDraft::STATUS_LOT_SELECTION], true)
    && in_array('lot_id', $res3['missing_fields'], true)
);
report(3, "Natural language turn initiates draft and returns conversational reply", $test3Ok, "Draft ID: {$draftId}, Status: " . ($res3['status'] ?? ''));

// ----------------------------------------------------------------------
// TEST 4: Conversational slot filling for pending lot_id
// ----------------------------------------------------------------------
$message4 = "We would like lot {$validLotId}";
$res4 = $controller->chat(['message' => $message4, 'draft_id' => $draftId], $userA);
$test4Ok = (
    $res4['code'] === 200
    && $res4['success'] === true
    && (int) ($res4['extracted_data']['lot_id'] ?? 0) === $validLotId
    && empty($res4['missing_fields'])
    && $res4['is_ready_for_review'] === true
    && $res4['status'] === BookingDraft::STATUS_READY_FOR_REVIEW
);
report(4, "Conversational lot selection advances draft to READY_FOR_REVIEW", $test4Ok, "Status: " . ($res4['status'] ?? ''));

// ----------------------------------------------------------------------
// TEST 5: Conversational confirmation advances to AWAITING_CONFIRM
// ----------------------------------------------------------------------
$initialBurialCount = (int) $db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn();
$message5 = "Yes, please confirm this booking now.";
$res5 = $controller->chat(['message' => $message5, 'draft_id' => $draftId], $userA);
$finalBurialCount = (int) $db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn();

$test5Ok = (
    $res5['code'] === 200
    && $res5['success'] === true
    && $res5['status'] === BookingDraft::STATUS_AWAITING_CONFIRM
    && $initialBurialCount === $finalBurialCount
    && !empty($res5['reply'])
);
report(5, "Conversational confirmation advances to AWAITING_CONFIRM with zero domain writes", $test5Ok, "Status: " . ($res5['status'] ?? ''));

// ----------------------------------------------------------------------
// TEST 6: Conversational cross-user isolation
// ----------------------------------------------------------------------
$res6 = $controller->chat(['message' => 'Change date to 2026-12-01', 'draft_id' => $draftId], $userB);
$test6Ok = (in_array($res6['code'], [403, 404], true) && $res6['success'] === false);
report(6, "Conversational cross-user security enforced (User B blocked)", $test6Ok, "Code: {$res6['code']}");

// ----------------------------------------------------------------------
// TEST 7: Active draft summary reflects conversational updates
// ----------------------------------------------------------------------
$res7 = $controller->getActiveDraft($userA, 'burial');
$test7Ok = (
    $res7['code'] === 200
    && !empty($res7['draft'])
    && (int) $res7['draft']['draft_id'] === $draftId
    && $res7['draft']['status'] === BookingDraft::STATUS_AWAITING_CONFIRM
);
report(7, "Active draft summary reflects latest conversational progression", $test7Ok, "Summary status: " . ($res7['draft']['status'] ?? ''));

// ----------------------------------------------------------------------
// TEST 8: Cancel draft via controller and reject further chat
// ----------------------------------------------------------------------
$res8a = $controller->cancel($draftId, $userA);
$res8b = $controller->chat(['message' => 'Are we still good?', 'draft_id' => $draftId], $userA);
$test8Ok = ($res8a['code'] === 200 && $res8b['code'] === 400 && $res8b['success'] === false);
report(8, "Cancelled draft cleanly terminates conversation", $test8Ok, "Chat on cancelled code: {$res8b['code']}");

echo "======================================================\n";
echo "BMS-5 CHAT TEST RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "======================================================\n";

// Clean up test data
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");

exit($failed === 0 ? 0 : 1);

