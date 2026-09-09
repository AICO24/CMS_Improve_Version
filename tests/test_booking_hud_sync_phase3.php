<?php
/**
 * Test Suite: Phase 3 — Frontend Live Blueprint HUD & Synchronization Hardening
 * 
 * Verifies that the API payloads strictly satisfy the frontend Live Blueprint HUD requirements:
 * 1. Initial turn creates draft and populates extracted_data without losing slots.
 * 2. Conversational date follow-up merges non-destructively, updating preferred_date while preserving decedent_name.
 * 3. Conversational lot follow-up merges non-destructively, updating lot_id.
 * 4. Conversational time follow-up captures preferred_time (14:00:00) alongside date and name.
 * 5. Advisory requests ("Ano pa kulang?") return populated extracted_data so HUD is never wiped.
 * 6. GET /api/booking-agent/active returns authoritative draft summary matching HUD contract.
 * 7. Correcting a date via "Actually make it Friday" updates preferred_date with zero HUD data loss.
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/UnifiedBooking.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/models/DecedentRequest.php';
require_once __DIR__ . '/../backend/models/AuditLog.php';
require_once __DIR__ . '/../backend/services/BookingDateResolver.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/services/BookingActionRegistry.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

echo "===================================================================\n";
echo "RUNNING PHASE 3: FRONTEND LIVE BLUEPRINT HUD & SYNC TESTS\n";
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
// SETUP TEST USER
// ----------------------------------------------------------------------
$db->exec("
    DELETE FROM audit_logs WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'phase3_test_%');
    DELETE FROM booking_pending_actions WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'phase3_test_%');
    DELETE FROM burial_schedules WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'phase3_test_%');
    DELETE FROM cremation_records WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'phase3_test_%');
    DELETE FROM decedent_requests WHERE requested_by IN (SELECT user_id FROM users WHERE username LIKE 'phase3_test_%');
    DELETE FROM booking_drafts WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'phase3_test_%');
    DELETE FROM users WHERE username = 'phase3_test_user';
");

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('phase3_test_user', 'hash', 'Phase 3 Citizen', 'phase3@test.local', 3)
")->execute();
$userId = (int) $db->lastInsertId();

$user = ['user_id' => $userId, 'username' => 'phase3_test_user', 'role' => 'user'];

$lotId = (int) $db->query("SELECT lot_id FROM lots WHERE status = 'Available' LIMIT 1")->fetchColumn();
if (!$lotId) {
    $lotId = (int) $db->query("SELECT lot_id FROM lots LIMIT 1")->fetchColumn();
}

$controller = new BookingAgentController();
$service = new BookingAgentService();
$draftModel = new BookingDraft();

// ----------------------------------------------------------------------
// TEST 1 — Turn 1: Initial Booking Creation
// Input: "I want to arrange a burial service for my father Juan Dela Cruz"
// Expected: Draft created, extracted_data contains decedent_name & relationship, missing_fields contains preferred_date & lot_id
// ----------------------------------------------------------------------
$res1 = $controller->chat([
    'message' => 'I want to arrange a burial service for my father Juan Dela Cruz'
], $user);

$t1_draftId = (int) ($res1['draft_id'] ?? 0);
$t1_hasName = ($res1['extracted_data']['decedent_name'] ?? '') === 'Juan Dela Cruz';
$t1_hasRel = strtolower($res1['extracted_data']['relationship'] ?? '') === 'father';
$t1_missingDate = in_array('preferred_date', $res1['missing_fields'] ?? [], true);
$t1_missingLot = in_array('lot_id', $res1['missing_fields'] ?? [], true);

$test1Ok = ($t1_draftId > 0 && $t1_hasName && $t1_hasRel && $t1_missingDate && $t1_missingLot);
report(1, "Turn 1 Initial Booking: Draft created with decedent_name and relationship on HUD payload", $test1Ok,
    "Draft ID: {$t1_draftId}, Name: " . ($res1['extracted_data']['decedent_name'] ?? 'none') . ", Rel: " . ($res1['extracted_data']['relationship'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 2 — Turn 2: Conversational Date Follow-up
// Input: "For burial date: I want the schedule this Sunday"
// Expected: preferred_date populated, decedent_name & relationship PRESERVED, missing_fields updated
// ----------------------------------------------------------------------
$expectedSunday = BookingDateResolver::extractDate("this Sunday");

$res2 = $controller->chat([
    'message'  => 'For burial date: I want the schedule this Sunday',
    'draft_id' => $t1_draftId
], $user);

$t2_hasDate = ($res2['extracted_data']['preferred_date'] ?? '') === $expectedSunday;
$t2_namePreserved = ($res2['extracted_data']['decedent_name'] ?? '') === 'Juan Dela Cruz';
$t2_relPreserved = strtolower($res2['extracted_data']['relationship'] ?? '') === 'father';
$t2_dateNotMissing = !in_array('preferred_date', $res2['missing_fields'] ?? [], true);

$test2Ok = ($t2_hasDate && $t2_namePreserved && $t2_relPreserved && $t2_dateNotMissing);
report(2, "Turn 2 Date Follow-up: Sets preferred_date ({$expectedSunday}) and preserves decedent_name on HUD payload", $test2Ok,
    "Date: " . ($res2['extracted_data']['preferred_date'] ?? 'none') . ", Name: " . ($res2['extracted_data']['decedent_name'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 3 — Turn 3: Conversational Lot Selection
// Input: "Change lot to {$lotId}"
// Expected: lot_id updated to {$lotId}, preferred_date & decedent_name PRESERVED
// ----------------------------------------------------------------------
$res3 = $controller->chat([
    'message'  => "Change lot to {$lotId}",
    'draft_id' => $t1_draftId
], $user);

$t3_hasLot = (int) ($res3['extracted_data']['lot_id'] ?? 0) === $lotId;
$t3_datePreserved = ($res3['extracted_data']['preferred_date'] ?? '') === $expectedSunday;
$t3_namePreserved = ($res3['extracted_data']['decedent_name'] ?? '') === 'Juan Dela Cruz';
$t3_lotNotMissing = !in_array('lot_id', $res3['missing_fields'] ?? [], true);

$test3Ok = ($t3_hasLot && $t3_datePreserved && $t3_namePreserved && $t3_lotNotMissing);
report(3, "Turn 3 Lot Selection: Sets lot_id ({$lotId}) and preserves all previous HUD fields", $test3Ok,
    "Lot ID: " . ($res3['extracted_data']['lot_id'] ?? 'none') . ", Date: " . ($res3['extracted_data']['preferred_date'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 4 — Turn 4: Time Slot Capture
// Input: "At 2 PM"
// Expected: preferred_time set to '14:00:00', all other fields preserved
// ----------------------------------------------------------------------
$res4 = $controller->chat([
    'message'  => 'At 2 PM',
    'draft_id' => $t1_draftId
], $user);

$t4_hasTime = ($res4['extracted_data']['preferred_time'] ?? '') === '14:00:00';
$t4_hasDate = ($res4['extracted_data']['preferred_date'] ?? '') === $expectedSunday;
$t4_hasName = ($res4['extracted_data']['decedent_name'] ?? '') === 'Juan Dela Cruz';
$t4_hasLot = (int) ($res4['extracted_data']['lot_id'] ?? 0) === $lotId;

$test4Ok = ($t4_hasTime && $t4_hasDate && $t4_hasName && $t4_hasLot);
report(4, "Turn 4 Time Capture: Sets preferred_time (14:00:00) alongside date, lot, and decedent on HUD payload", $test4Ok,
    "Time: " . ($res4['extracted_data']['preferred_time'] ?? 'none') . ", Date: " . ($res4['extracted_data']['preferred_date'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 5 — Turn 5: Advisory Turn ("Ano pa kulang?")
// Input: "Ano pa kulang?"
// Expected: Response contains populated extracted_data so HUD is NEVER wiped!
// ----------------------------------------------------------------------
$res5 = $controller->chat([
    'message'  => 'Ano pa kulang?',
    'draft_id' => $t1_draftId
], $user);

$t5_hasExtracted = isset($res5['extracted_data']) && is_array($res5['extracted_data']);
$t5_nameIntact = ($res5['extracted_data']['decedent_name'] ?? '') === 'Juan Dela Cruz';
$t5_dateIntact = ($res5['extracted_data']['preferred_date'] ?? '') === $expectedSunday;
$t5_lotIntact = (int) ($res5['extracted_data']['lot_id'] ?? 0) === $lotId;
$t5_missingPresent = isset($res5['missing_fields']) && is_array($res5['missing_fields']);

$test5Ok = ($t5_hasExtracted && $t5_nameIntact && $t5_dateIntact && $t5_lotIntact && $t5_missingPresent);
report(5, "Turn 5 Advisory Preservation: 'Ano pa kulang?' returns populated extracted_data, preventing HUD wipe", $test5Ok,
    "Extracted Name: " . ($res5['extracted_data']['decedent_name'] ?? 'none') . ", Date: " . ($res5['extracted_data']['preferred_date'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 6 — Turn 6: Conversational Date Correction
// Input: "Actually make it Friday"
// Expected: preferred_date updated to Friday, zero Category B deferral, name and lot intact
// ----------------------------------------------------------------------
$expectedFriday = BookingDateResolver::extractDate("Friday");

$res6 = $controller->chat([
    'message'  => 'Actually make it Friday',
    'draft_id' => $t1_draftId
], $user);

$t6_dateUpdated = ($res6['extracted_data']['preferred_date'] ?? '') === $expectedFriday;
$t6_nameIntact = ($res6['extracted_data']['decedent_name'] ?? '') === 'Juan Dela Cruz';
$t6_lotIntact = (int) ($res6['extracted_data']['lot_id'] ?? 0) === $lotId;
$t6_noDeferral = ($res6['deferred_intent'] ?? null) === null;

$test6Ok = ($t6_dateUpdated && $t6_nameIntact && $t6_lotIntact && $t6_noDeferral);
report(6, "Turn 6 Conversational Correction: 'Actually make it Friday' updates preferred_date to Friday with zero data loss", $test6Ok,
    "New Date: " . ($res6['extracted_data']['preferred_date'] ?? 'none') . ", Name: " . ($res6['extracted_data']['decedent_name'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 7 — Session Resumption Endpoint: GET /api/booking-agent/active
// Expected: Returns full draft summary with extracted_data matching HUD requirements
// ----------------------------------------------------------------------
$activeRes = $controller->getActiveDraft($user, 'burial');

$t7_success = ($activeRes['success'] ?? false) === true;
$activeDraft = $activeRes['draft'] ?? [];
$t7_draftId = (int) ($activeDraft['draft_id'] ?? 0) === $t1_draftId;
$t7_extracted = $activeDraft['extracted_data'] ?? [];
$t7_name = ($t7_extracted['decedent_name'] ?? '') === 'Juan Dela Cruz';
$t7_date = ($t7_extracted['preferred_date'] ?? '') === $expectedFriday;
$t7_lot = (int) ($t7_extracted['lot_id'] ?? 0) === $lotId;

$test7Ok = ($t7_success && $t7_draftId && $t7_name && $t7_date && $t7_lot);
report(7, "Session Resumption: getActiveDraft() returns authoritative draft with complete extracted_data", $test7Ok,
    "Active Draft ID: " . ($activeDraft['draft_id'] ?? 'none') . ", Extracted Name: " . ($t7_name ? 'Juan Dela Cruz' : 'missing'));

// ----------------------------------------------------------------------
// CLEANUP TEST DATA
// ----------------------------------------------------------------------
$db->prepare("DELETE FROM booking_drafts WHERE user_id = ?")->execute([$userId]);
$db->prepare("DELETE FROM users WHERE user_id = ?")->execute([$userId]);

echo "===============================================================\n";
echo "PHASE 3 TEST SUMMARY: {$passed} PASSED, {$failed} FAILED\n";
echo "===============================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
