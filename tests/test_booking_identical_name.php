<?php
/**
 * Test Suite: Booking Identical / Comma-Separated Deceased Name Acceptance
 * 
 * Verifies that the AI Booking Assistant accepts deceased names where
 * first name and last name are identical or near-identical, formatted with commas,
 * or provided with Taglish politeness particles:
 * - "Nicolas Nicolas"
 * - "Nicolas, Nicolas"
 * - "Nicolas Nicolos"
 * - "Nicolas Nicolas po"
 * - "para kay Nicolas, Nicolas"
 * - "si Nicolas Nicolas"
 * - Field updates with identical names
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';

echo "===============================================================\n";
echo "RUNNING BOOKING IDENTICAL & COMMA DECEASED NAME TEST SUITE\n";
echo "===============================================================\n";

$db = Database::getInstance()->getConnection();
$userRow = $db->query("SELECT user_id, username FROM users ORDER BY user_id ASC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$userRow) {
    echo "FATAL: No test user found.\n";
    exit(1);
}

$user = [
    'user_id' => (int) $userRow['user_id'],
    'username' => $userRow['username'],
    'role' => 'user'
];

$controller = new BookingAgentController();
$draftModel = new BookingDraft();

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

// Clean previous test drafts
$db->exec("DELETE FROM booking_drafts WHERE user_id = {$user['user_id']}");

// ----------------------------------------------------------------------
// TEST 1: Standalone repeated name "Nicolas Nicolas" in initial turn
// ----------------------------------------------------------------------
$db->exec("DELETE FROM booking_drafts WHERE user_id = {$user['user_id']}");
$res1 = $controller->chat(['message' => 'Nicolas Nicolas', 'service_type' => 'burial'], $user);
$name1 = $res1['extracted_data']['decedent_name'] ?? ($res1['slots']['decedent_name'] ?? null);
report(1, "Accepts standalone identical name 'Nicolas Nicolas'", $name1 === 'Nicolas Nicolas', "Extracted: " . json_encode($name1));

// ----------------------------------------------------------------------
// TEST 2: Inverted comma format "Nicolas, Nicolas"
// ----------------------------------------------------------------------
$db->exec("DELETE FROM booking_drafts WHERE user_id = {$user['user_id']}");
$res2 = $controller->chat(['message' => 'Nicolas, Nicolas', 'service_type' => 'burial'], $user);
$name2 = $res2['extracted_data']['decedent_name'] ?? ($res2['slots']['decedent_name'] ?? null);
report(2, "Accepts and normalizes inverted 'Nicolas, Nicolas'", $name2 === 'Nicolas Nicolas', "Extracted: " . json_encode($name2));

// ----------------------------------------------------------------------
// TEST 3: Near-identical name "Nicolas Nicolos"
// ----------------------------------------------------------------------
$db->exec("DELETE FROM booking_drafts WHERE user_id = {$user['user_id']}");
$res3 = $controller->chat(['message' => 'Nicolas Nicolos', 'service_type' => 'burial'], $user);
$name3 = $res3['extracted_data']['decedent_name'] ?? ($res3['slots']['decedent_name'] ?? null);
report(3, "Accepts near-identical name 'Nicolas Nicolos'", $name3 === 'Nicolas Nicolos', "Extracted: " . json_encode($name3));

// ----------------------------------------------------------------------
// TEST 4: Standalone name with Tagalog politeness "Nicolas Nicolas po"
// ----------------------------------------------------------------------
$db->exec("DELETE FROM booking_drafts WHERE user_id = {$user['user_id']}");
$res4 = $controller->chat(['message' => 'Nicolas Nicolas po', 'service_type' => 'burial'], $user);
$name4 = $res4['extracted_data']['decedent_name'] ?? ($res4['slots']['decedent_name'] ?? null);
report(4, "Accepts 'Nicolas Nicolas po' with politeness particle", $name4 === 'Nicolas Nicolas', "Extracted: " . json_encode($name4));

// ----------------------------------------------------------------------
// TEST 5: Prefixed comma format "para kay Nicolas, Nicolas"
// ----------------------------------------------------------------------
$db->exec("DELETE FROM booking_drafts WHERE user_id = {$user['user_id']}");
$res5 = $controller->chat(['message' => 'para kay Nicolas, Nicolas', 'service_type' => 'burial'], $user);
$name5 = $res5['extracted_data']['decedent_name'] ?? ($res5['slots']['decedent_name'] ?? null);
report(5, "Accepts prefixed comma format 'para kay Nicolas, Nicolas'", $name5 === 'Nicolas Nicolas', "Extracted: " . json_encode($name5));

// ----------------------------------------------------------------------
// TEST 6: Prefixed "si Nicolas Nicolas"
// ----------------------------------------------------------------------
$db->exec("DELETE FROM booking_drafts WHERE user_id = {$user['user_id']}");
$res6 = $controller->chat(['message' => 'si Nicolas Nicolas', 'service_type' => 'burial'], $user);
$name6 = $res6['extracted_data']['decedent_name'] ?? ($res6['slots']['decedent_name'] ?? null);
report(6, "Accepts prefixed 'si Nicolas Nicolas'", $name6 === 'Nicolas Nicolas', "Extracted: " . json_encode($name6));

// ----------------------------------------------------------------------
// TEST 7: Direct field update with "Nicolas, Nicolas" normalizes cleanly
// ----------------------------------------------------------------------
$db->exec("DELETE FROM booking_drafts WHERE user_id = {$user['user_id']}");
$initRes = $controller->chat(['message' => 'I want to arrange a burial', 'service_type' => 'burial'], $user);
$draftId = (int) ($initRes['draft_id'] ?? 0);

$updateRes = $controller->updateField($draftId, ['field' => 'decedent_name', 'value' => 'Nicolas, Nicolas'], $user);
$freshDraft = $draftModel->findById($draftId);
$extracted = json_decode($freshDraft['extracted_data'] ?? '{}', true);
$name7 = $extracted['decedent_name'] ?? null;
report(7, "updateField with 'Nicolas, Nicolas' normalizes to 'Nicolas Nicolas'", $name7 === 'Nicolas Nicolas', "Extracted: " . json_encode($name7));

// ----------------------------------------------------------------------
// TEST 8: Assistant reply acknowledges decedent name and does not ask again
// ----------------------------------------------------------------------
$reply = $res1['reply'] ?? '';
$notAskingAgain = (stripos($reply, 'pangalan ng yumao') === false && stripos($reply, 'full name of the deceased') === false);
$mentionsName = stripos($reply, 'Nicolas Nicolas') !== false;
report(8, "Assistant reply acknowledges 'Nicolas Nicolas' without asking again", $notAskingAgain && $mentionsName, "Reply: " . $reply);

echo "\n===============================================================\n";
echo "TEST RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "===============================================================\n";

exit($failed > 0 ? 1 : 0);
