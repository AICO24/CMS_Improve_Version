<?php
/**
 * Test Suite: Booking Chat History API & Controller (Batch 2 Verification)
 */
require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingConversation.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

echo "======================================================\n";
echo "RUNNING BOOKING CHAT HISTORY API TEST SUITE (BATCH 2)\n";
echo "======================================================\n";

$db = Database::getInstance()->getConnection();

$users = $db->query("SELECT user_id, username FROM users ORDER BY user_id ASC LIMIT 2")->fetchAll(PDO::FETCH_ASSOC);
if (count($users) < 1) {
    echo "FATAL: At least 1 user required in database.\n";
    exit(1);
}

$userA = $users[0];
$userA['role'] = 'user';
$userB = count($users) > 1 ? $users[1] : [
    'user_id' => 999999,
    'username' => 'isolated_user_b',
    'role' => 'user'
];
$userB['role'] = 'user';

// Clean test records
$db->exec("DELETE FROM booking_conversations WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");

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
    $d = new DateTime('+40 days');
    if ((int) $d->format('N') === 1) {
        $d->modify('+1 day');
    }
    return $d->format('Y-m-d');
}

$futureDate = getValidFutureDate();

try {
    // ----------------------------------------------------------------------
    // TEST 1: Chat turn records conversation & user message & assistant reply
    // ----------------------------------------------------------------------
    $turn1 = $controller->chat([
        'message' => "I want to arrange a burial for my father Fernando Poe on {$futureDate}",
    ], $userA);

    $convId1 = $turn1['conversation_id'] ?? null;
    $sessId1 = $turn1['session_id'] ?? null;
    $draftId1 = $turn1['draft_id'] ?? null;

    $test1Ok = (!empty($convId1) && !empty($sessId1) && !empty($draftId1) && !empty($turn1['reply']));
    report(1, "Chat turn auto-creates conversation and returns conversation_id & session_id", $test1Ok, "ConvId: {$convId1}");

    // ----------------------------------------------------------------------
    // TEST 2: Verify messages were persisted in database
    // ----------------------------------------------------------------------
    $msgStmt = $db->prepare("SELECT * FROM booking_messages WHERE conversation_id = ? ORDER BY id ASC");
    $msgStmt->execute([$convId1]);
    $messages = $msgStmt->fetchAll(PDO::FETCH_ASSOC);

    $test2Ok = (count($messages) === 2 && $messages[0]['sender_type'] === 'user' && $messages[1]['sender_type'] === 'assistant');
    report(2, "User message and AI reply persisted to booking_messages", $test2Ok, "Count: " . count($messages));

    // ----------------------------------------------------------------------
    // TEST 3: Multi-turn continuation appends to same conversation
    // ----------------------------------------------------------------------
    $turn2 = $controller->chat([
        'message'         => "What requirements do I need to bring?",
        'conversation_id' => $convId1,
        'draft_id'        => $draftId1,
    ], $userA);

    $msgStmt->execute([$convId1]);
    $messagesAfterTurn2 = $msgStmt->fetchAll(PDO::FETCH_ASSOC);

    $test3Ok = ($turn2['conversation_id'] === $convId1 && count($messagesAfterTurn2) === 4);
    report(3, "Second chat turn appends to existing conversation (now 4 messages)", $test3Ok, "Count: " . count($messagesAfterTurn2));

    // ----------------------------------------------------------------------
    // TEST 4: Auto-updated conversation title
    // ----------------------------------------------------------------------
    $convStmt = $db->prepare("SELECT * FROM booking_conversations WHERE id = ?");
    $convStmt->execute([$convId1]);
    $convRow = $convStmt->fetch(PDO::FETCH_ASSOC);

    $test4Ok = (!empty($convRow['title']) && str_contains($convRow['title'], 'Fernando Poe'));
    report(4, "Conversation title auto-updated with decedent name ('{$convRow['title']}')", $test4Ok);

    // ----------------------------------------------------------------------
    // TEST 5: GET /api/booking-agent/conversations (listConversations)
    // ----------------------------------------------------------------------
    $listRes = $controller->listConversations($userA);
    $test5Ok = ($listRes['success'] === true && count($listRes['conversations']) === 1 && (int)$listRes['conversations'][0]['message_count'] === 4);
    report(5, "listConversations() returns user sessions with message count and preview", $test5Ok);

    // ----------------------------------------------------------------------
    // TEST 6: GET /api/booking-agent/conversations/{id}/messages
    // ----------------------------------------------------------------------
    $msgRes = $controller->getConversationMessages($convId1, $userA);
    $test6Ok = ($msgRes['success'] === true && count($msgRes['messages']) === 4 && !empty($msgRes['draft']));
    report(6, "getConversationMessages() returns chronological transcript and attached draft", $test6Ok);

    // ----------------------------------------------------------------------
    // TEST 7: Cross-user IDOR protection on message retrieval
    // ----------------------------------------------------------------------
    $idorRes = $controller->getConversationMessages($convId1, $userB);
    $test7Ok = ($idorRes['success'] === false && $idorRes['code'] === 403);
    report(7, "Cross-user IDOR blocked (User B receives HTTP 403 on User A's session)", $test7Ok);

    // ----------------------------------------------------------------------
    // TEST 8: Explicit New Conversation creation (createConversation)
    // ----------------------------------------------------------------------
    $newConvRes = $controller->createConversation(['title' => 'Fresh Inquiry Session'], $userA);
    $convId2 = $newConvRes['conversation']['id'] ?? null;
    $test8Ok = ($newConvRes['success'] === true && $newConvRes['code'] === 201 && $convId2 > $convId1);
    report(8, "createConversation() initializes fresh session", $test8Ok, "New ID: {$convId2}");

    // ----------------------------------------------------------------------
    // TEST 9: Archive conversation (archiveConversation)
    // ----------------------------------------------------------------------
    $archRes = $controller->archiveConversation($convId2, $userA);
    $conv2Row = $db->query("SELECT status FROM booking_conversations WHERE id = {$convId2}")->fetch(PDO::FETCH_ASSOC);
    $test9Ok = ($archRes['success'] === true && ($conv2Row['status'] ?? '') === 'ARCHIVED');
    report(9, "archiveConversation() transitions session to ARCHIVED status", $test9Ok);

} finally {
    // Clean test records
    $db->exec("DELETE FROM booking_conversations WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");
    $db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");
}

echo "======================================================\n";
echo "BATCH 2 API TEST RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
