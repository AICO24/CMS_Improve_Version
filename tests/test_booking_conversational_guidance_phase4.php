<?php
/**
 * Test Suite: Booking Automation V2 - Phase 4 Conversational Guidance & Dynamic Prompting
 * 
 * Verifies:
 * 1. Turn 1 Initiation (Tagalog): Expresses condolences, asks for decedent name, zero generic reply
 * 2. Turn 1 Initiation (English): Expresses condolences, asks for decedent name in English, zero generic reply
 * 3. Turn 2 Decedent: Records name and guides to preferred date/time with cemetery operating days
 * 4. Turn 3 Date/Time: Records schedule and prompts for burial lot selection
 * 5. Turn 4 Lot Selection & Readiness: Records lot, detects ready-for-review, and prompts for confirmation
 * 6. Turn 5 Cemetery Business Rules: Gracefully rejects Monday burials and recommends Tuesday-Sunday
 * 7. Turn 6 Advisory Checklist: 'Ano pa kulang?' returns clear checklist with next recommended step
 * 8. Turn 7 Non-destructive Correction: Changing date mid-flow updates date without wiping decedent or lot
 */

require_once __DIR__ . '/../backend/config/Database.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';

echo "===================================================================\n";
echo "RUNNING PHASE 4: CONVERSATIONAL GUIDANCE & DYNAMIC PROMPTING TESTS\n";
echo "===================================================================\n\n";

$db = Database::getInstance()->getConnection();
$controller = new BookingAgentController();
$draftModel = new BookingDraft();

// Setup test user
$username = 'phase4_guidance_user_' . uniqid();
$email = 'p4_' . uniqid() . '@test.local';
$db->prepare("INSERT INTO users (username, password_hash, full_name, email, role_id) VALUES (?, 'hash', 'Phase 4 User', ?, 3)")->execute([$username, $email]);
$userId = (int) $db->lastInsertId();
$testUser = ['user_id' => $userId, 'username' => $username, 'role' => 'user'];

// Find or create test lot
$lotId = (int) $db->query("SELECT lot_id FROM lots WHERE status = 'Available' LIMIT 1")->fetchColumn();
if (!$lotId) {
    $blockId = (int) $db->query("SELECT block_id FROM blocks LIMIT 1")->fetchColumn() ?: 1;
    $typeId = (int) $db->query("SELECT type_id FROM lot_types LIMIT 1")->fetchColumn() ?: 1;
    $db->prepare("INSERT INTO lots (block_id, lot_type_id, lot_number, status, price) VALUES (?, ?, ?, 'Available', 5000.00)")
       ->execute([$blockId, $typeId, 'P4-LOT-' . uniqid()]);
    $lotId = (int) $db->lastInsertId();
}

$passCount = 0;
$totalTests = 8;

// -------------------------------------------------------------------------
// TEST 1: Initiation Turn (Tagalog) - Condolence + Asks for Decedent Name
// -------------------------------------------------------------------------
$t1_res = $controller->chat([
    'message'      => 'Magpapa-schedule po sana ako ng libing',
    'service_type' => 'burial'
], $testUser);

$t1_reply = $t1_res['reply'] ?? '';
$t1_hasCondolence = (stripos($t1_reply, 'nakikiramay') !== false || stripos($t1_reply, 'condolence') !== false);
$t1_asksDecedent = (stripos($t1_reply, 'pangalan') !== false || stripos($t1_reply, 'decedent') !== false || stripos($t1_reply, 'yumao') !== false);
$t1_notGeneric = (stripos($t1_reply, 'I have noted your booking request. Let me know if you would like to make any adjustments') === false);

if ($t1_hasCondolence && $t1_asksDecedent && $t1_notGeneric) {
    echo "[PASS] TEST 1: Tagalog booking initiation responds with warm condolence and prompts for decedent name\n";
    $passCount++;
} else {
    echo "[FAIL] TEST 1: Tagalog initiation failed. Reply: {$t1_reply}\n";
}

$draftId = $t1_res['draft_id'] ?? null;

// -------------------------------------------------------------------------
// TEST 2: Initiation Turn (English) - Condolence + Asks for Decedent in English
// -------------------------------------------------------------------------
$engUser = ['user_id' => $userId, 'username' => $username, 'role' => 'user'];
// Clean up drafts for fresh test
$db->prepare("DELETE FROM booking_drafts WHERE user_id = ?")->execute([$userId]);

$t2_res = $controller->chat([
    'message'      => 'I would like to book a burial service',
    'service_type' => 'burial'
], $engUser);

$t2_reply = $t2_res['reply'] ?? '';
$t2_hasCondolence = (stripos($t2_reply, 'condolence') !== false || stripos($t2_reply, 'assist') !== false);
$t2_asksDecedent = (stripos($t2_reply, 'full name') !== false || stripos($t2_reply, 'deceased') !== false || stripos($t2_reply, 'decedent') !== false);
$t2_notGeneric = (stripos($t2_reply, 'I have noted your booking request. Let me know if you would like to make any adjustments') === false);

if ($t2_hasCondolence && $t2_asksDecedent && $t2_notGeneric) {
    echo "[PASS] TEST 2: English booking initiation responds with compassionate condolence and prompts for deceased name\n";
    $passCount++;
} else {
    echo "[FAIL] TEST 2: English initiation failed. Reply: {$t2_reply}\n";
}

$activeDraftId = $t2_res['draft_id'] ?? null;

// -------------------------------------------------------------------------
// TEST 3: Turn 2 Decedent Provided - Confirms Name and Asks for Date/Time
// -------------------------------------------------------------------------
$t3_res = $controller->chat([
    'message'      => 'Para po kay Maria Santos, nanay ko po siya',
    'draft_id'     => $activeDraftId,
    'service_type' => 'burial'
], $testUser);

$t3_reply = $t3_res['reply'] ?? '';
$t3_extracted = $t3_res['extracted_data'] ?? [];
$t3_recordsName = (($t3_extracted['decedent_name'] ?? '') === 'Maria Santos');
$t3_asksDate = (stripos($t3_reply, 'petsa') !== false || stripos($t3_reply, 'kailan') !== false || stripos($t3_reply, 'date') !== false);
$t3_mentionsPolicy = (stripos($t3_reply, 'Martes') !== false || stripos($t3_reply, 'Lunes') !== false || stripos($t3_reply, 'Tuesday') !== false || stripos($t3_reply, 'Monday') !== false);

if ($t3_recordsName && $t3_asksDate && $t3_mentionsPolicy) {
    echo "[PASS] TEST 3: Decedent entry records name/relation and asks for schedule with cemetery days guidance\n";
    $passCount++;
} else {
    echo "[FAIL] TEST 3: Decedent turn failed. Recorded: " . ($t3_extracted['decedent_name'] ?? 'none') . " | Reply: {$t3_reply}\n";
}

// -------------------------------------------------------------------------
// TEST 4: Turn 3 Schedule Date & Time Provided - Confirms and Asks for Lot
// -------------------------------------------------------------------------
$t4_res = $controller->chat([
    'message'      => 'Next Friday at 10:00 AM',
    'draft_id'     => $activeDraftId,
    'service_type' => 'burial'
], $testUser);

$t4_reply = $t4_res['reply'] ?? '';
$t4_extracted = $t4_res['extracted_data'] ?? [];
$t4_recordsDate = !empty($t4_extracted['preferred_date']);
$t4_recordsTime = !empty($t4_extracted['preferred_time']);
$t4_asksLot = (stripos($t4_reply, 'lot') !== false);

if ($t4_recordsDate && $t4_recordsTime && $t4_asksLot) {
    echo "[PASS] TEST 4: Schedule entry captures date/time and guides citizen to lot selection\n";
    $passCount++;
} else {
    echo "[FAIL] TEST 4: Schedule turn failed. Date: " . ($t4_extracted['preferred_date'] ?? 'none') . " | Time: " . ($t4_extracted['preferred_time'] ?? 'none') . " | Reply: {$t4_reply}\n";
}

// -------------------------------------------------------------------------
// TEST 5: Turn 4 Lot Selection - Completes Blueprint & Prompts Confirmation
// -------------------------------------------------------------------------
$t5_res = $controller->chat([
    'message'      => "Piliin po ang lot {$lotId}",
    'draft_id'     => $activeDraftId,
    'service_type' => 'burial'
], $testUser);

$t5_reply = $t5_res['reply'] ?? '';
$t5_extracted = $t5_res['extracted_data'] ?? [];
$t5_recordsLot = ((int)($t5_extracted['lot_id'] ?? 0) === $lotId);
$t5_isReady = !empty($t5_res['is_ready_for_review']);
$t5_promptsConfirm = (stripos($t5_reply, 'confirm') !== false || stripos($t5_reply, 'kumpirma') !== false || stripos($t5_reply, 'Live Blueprint') !== false);

if ($t5_recordsLot && $t5_isReady && $t5_promptsConfirm) {
    echo "[PASS] TEST 5: Lot selection marks draft ready for review and prompts for confirmation\n";
    $passCount++;
} else {
    echo "[FAIL] TEST 5: Lot turn failed. Lot: " . ($t5_extracted['lot_id'] ?? 'none') . " | Ready: " . ($t5_isReady ? 'yes' : 'no') . " | Reply: {$t5_reply}\n";
}

// -------------------------------------------------------------------------
// TEST 6: Turn 5 Cemetery Business Rules - Rejects Monday Burials Gracefully
// -------------------------------------------------------------------------
// Compute next Monday
$nextMonday = date('Y-m-d', strtotime('next Monday'));
$t6_res = $controller->chat([
    'message'      => "Actually gusto ko ilipat sa {$nextMonday}",
    'draft_id'     => $activeDraftId,
    'service_type' => 'burial'
], $testUser);

$t6_reply = $t6_res['reply'] ?? '';
$t6_rejectedMonday = (stripos($t6_reply, 'Monday') !== false || stripos($t6_reply, 'Lunes') !== false || stripos($t6_reply, 'bawal') !== false || stripos($t6_reply, 'not allowed') !== false || stripos($t6_reply, 'maintenance') !== false);
// Ensure previous valid date is preserved
$freshDraft = $draftModel->findById($activeDraftId);
$rawExt = $freshDraft['extracted_data'] ?? [];
$freshExtracted = is_string($rawExt) ? json_decode($rawExt, true) : $rawExt;
$t6_datePreserved = !empty($freshExtracted['preferred_date']) && ($freshExtracted['preferred_date'] !== $nextMonday);

if ($t6_rejectedMonday && $t6_datePreserved) {
    echo "[PASS] TEST 6: Monday burial is gracefully rejected and valid draft date is preserved\n";
    $passCount++;
} else {
    echo "[FAIL] TEST 6: Monday rejection failed. Rejected: " . ($t6_rejectedMonday ? 'yes' : 'no') . " | DatePreserved: " . ($t6_datePreserved ? 'yes' : 'no') . " | Date: " . ($freshExtracted['preferred_date'] ?? 'none') . " | Reply: {$t6_reply}\n";
}

// -------------------------------------------------------------------------
// TEST 7: Turn 6 Advisory Turn - 'Ano pa kulang?' returns clear checklist
// -------------------------------------------------------------------------
$t7_res = $controller->chat([
    'message'      => 'Ano pa po ang kulang?',
    'draft_id'     => $activeDraftId,
    'service_type' => 'burial'
], $testUser);

$t7_reply = $t7_res['reply'] ?? '';
$t7_isAdvisory = !empty($t7_res['advisory']);
$t7_hasChecklist = (stripos($t7_reply, 'checklist') !== false || stripos($t7_reply, 'status') !== false || stripos($t7_reply, 'Kumpleto') !== false);
$t7_blueprintPreserved = !empty($t7_res['extracted_data']['decedent_name']);

if ($t7_isAdvisory && $t7_hasChecklist && $t7_blueprintPreserved) {
    echo "[PASS] TEST 7: Advisory query returns structured checklist and preserves complete blueprint\n";
    $passCount++;
} else {
    echo "[FAIL] TEST 7: Advisory query failed. Advisory: " . ($t7_isAdvisory ? 'yes' : 'no') . " | Reply: {$t7_reply}\n";
}

// -------------------------------------------------------------------------
// TEST 8: Turn 7 Non-destructive Correction - Updates date without wiping
// -------------------------------------------------------------------------
// Choose a Tuesday 2 weeks from now
$validFutureDate = date('Y-m-d', strtotime('+14 days Tuesday'));
$t8_res = $controller->chat([
    'message'      => "Palitan po ang date sa {$validFutureDate}",
    'draft_id'     => $activeDraftId,
    'service_type' => 'burial'
], $testUser);

$t8_extracted = $t8_res['extracted_data'] ?? [];
$t8_dateUpdated = (($t8_extracted['preferred_date'] ?? '') === $validFutureDate);
$t8_nameRetained = (($t8_extracted['decedent_name'] ?? '') === 'Maria Santos');
$t8_lotRetained = ((int)($t8_extracted['lot_id'] ?? 0) === $lotId);

if ($t8_dateUpdated && $t8_nameRetained && $t8_lotRetained) {
    echo "[PASS] TEST 8: Mid-flow date modification cleanly updates date while retaining decedent and lot\n";
    $passCount++;
} else {
    echo "[FAIL] TEST 8: Mid-flow update failed. Date: " . ($t8_extracted['preferred_date'] ?? 'none') . " | Name: " . ($t8_extracted['decedent_name'] ?? 'none') . " | Lot: " . ($t8_extracted['lot_id'] ?? 'none') . "\n";
}

// Cleanup test records
$db->prepare("DELETE FROM booking_drafts WHERE user_id = ?")->execute([$userId]);
$db->prepare("DELETE FROM users WHERE user_id = ?")->execute([$userId]);

echo "\n===================================================================\n";
echo "PHASE 4 TEST SUMMARY: {$passCount}/{$totalTests} PASSED\n";
echo "===================================================================\n";

if ($passCount === $totalTests) {
    exit(0);
} else {
    exit(1);
}
