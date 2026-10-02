<?php
/**
 * Test Suite: BookingConversation Domain Model (Batch 1 Foundation)
 */
require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingConversation.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';

echo "======================================================\n";
echo "RUNNING BOOKING CONVERSATION MODEL TEST SUITE (BATCH 1)\n";
echo "======================================================\n";

$db = Database::getInstance()->getConnection();

$users = $db->query("SELECT user_id, username FROM users ORDER BY user_id ASC LIMIT 2")->fetchAll(PDO::FETCH_ASSOC);
if (count($users) < 1) {
    echo "FATAL: At least 1 user required in database.\n";
    exit(1);
}

$userA = (int) $users[0]['user_id'];
$userB = count($users) > 1 ? (int) $users[1]['user_id'] : 999999;

$model = new BookingConversation($db);
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

// Clean prior test records
$db->exec("DELETE FROM booking_conversations WHERE user_id IN ({$userA}, {$userB})");

try {
    // ----------------------------------------------------------------------
    // TEST 1: Create conversation
    // ----------------------------------------------------------------------
    $conv = $model->create($userA, null, "Burial Arrangement — Juan Santos");
    $test1Ok = (!empty($conv['id']) && $conv['user_id'] === $userA && $conv['status'] === 'ACTIVE' && str_starts_with($conv['session_id'], 'conv_'));
    report(1, "Create conversation session", $test1Ok, "ID: " . ($conv['id'] ?? 'null'));

    $convId = (int) $conv['id'];
    $sessionId = $conv['session_id'];

    // ----------------------------------------------------------------------
    // TEST 2: Find by primary key and session_id
    // ----------------------------------------------------------------------
    $foundById = $model->findById($convId);
    $foundBySession = $model->findBySessionId($sessionId);
    $test2Ok = ($foundById !== null && $foundBySession !== null && $foundById['id'] === $foundBySession['id']);
    report(2, "Lookup by ID and session_id", $test2Ok);

    // ----------------------------------------------------------------------
    // TEST 3: Append user message and assistant reply
    // ----------------------------------------------------------------------
    $msg1Id = $model->appendMessage($convId, 'user', "Hello, I want to arrange a burial for Juan Santos.", 'text');
    $msg2Id = $model->appendMessage($convId, 'assistant', "I can help with that. What date do you prefer?", 'text', ['intent' => 'PROVIDE_INFO']);
    $test3Ok = ($msg1Id > 0 && $msg2Id > $msg1Id);
    report(3, "Append user and assistant messages", $test3Ok, "Msg IDs: {$msg1Id}, {$msg2Id}");

    // ----------------------------------------------------------------------
    // TEST 4: Retrieve chronological messages with metadata
    // ----------------------------------------------------------------------
    $messages = $model->getMessages($convId);
    $test4Ok = (count($messages) === 2 && $messages[0]['sender_type'] === 'user' && $messages[1]['sender_type'] === 'assistant' && ($messages[1]['metadata']['intent'] ?? '') === 'PROVIDE_INFO');
    report(4, "Retrieve chronological messages with metadata", $test4Ok, "Count: " . count($messages));

    // ----------------------------------------------------------------------
    // TEST 5: Ownership isolation (User A vs User B)
    // ----------------------------------------------------------------------
    $userAAuthorized = false;
    try {
        $model->requireOwnership($convId, $userA);
        $userAAuthorized = true;
    } catch (Exception $e) {}

    $userBForbidden = false;
    try {
        $model->requireOwnership($convId, $userB);
    } catch (BookingConversationException $e) {
        $userBForbidden = ($e->getHttpCode() === 403);
    }
    report(5, "Ownership isolation enforced (User A allowed, User B rejected with HTTP 403)", ($userAAuthorized && $userBForbidden));

    // ----------------------------------------------------------------------
    // TEST 6: Bind draft and sync conversation_id in booking_drafts
    // ----------------------------------------------------------------------
    $draftModel = new BookingDraft($db);
    $draftId = $draftModel->create($userA, 'burial', date('Y-m-d H:i:s', strtotime('+24 hours')));
    $bindOk = $model->bindDraft($convId, $draftId);
    $freshConv = $model->findById($convId);
    $freshDraft = $draftModel->findById($draftId);
    $test6Ok = ($bindOk && (int) $freshConv['booking_draft_id'] === $draftId && $freshDraft['conversation_id'] === $sessionId);
    report(6, "Bind draft and cross-sync conversation_id in booking_drafts", $test6Ok);

    // ----------------------------------------------------------------------
    // TEST 7: Bind finalized booking and transition status to COMMITTED
    // ----------------------------------------------------------------------
    $fakeScheduleId = 98765;
    $bookingBindOk = $model->bindBooking($convId, $fakeScheduleId, 'burial');
    $committedConv = $model->findById($convId);
    $test7Ok = ($bookingBindOk && (int) $committedConv['booking_id'] === $fakeScheduleId && $committedConv['status'] === 'COMMITTED');
    report(7, "Bind finalized booking and transition status to COMMITTED", $test7Ok);

    // ----------------------------------------------------------------------
    // TEST 8: List conversations by user with message summaries
    // ----------------------------------------------------------------------
    $list = $model->listByUser($userA);
    $test8Ok = (count($list) >= 1 && (int)$list[0]['message_count'] === 2 && !empty($list[0]['last_message']));
    report(8, "List conversations by user with message summaries", $test8Ok, "Count: " . count($list));

} finally {
    // Clean test records
    $db->exec("DELETE FROM booking_conversations WHERE user_id IN ({$userA}, {$userB})");
    if (!empty($draftId)) {
        $db->exec("DELETE FROM booking_drafts WHERE draft_id = {$draftId}");
    }
}

echo "======================================================\n";
echo "TEST RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
