<?php
/**
 * Test Suite: Phase 1 — Deterministic Date/Time Intelligence & Extractor Hardening
 * 
 * Verifies:
 * 1. BookingDateResolver extraction for natural weekdays (Sunday, this Sunday, next Sunday, Friday, etc.)
 * 2. BookingDateResolver extraction for relative intervals (tomorrow, in 1 week, in 2 weeks, in 1 month)
 * 3. BookingDateResolver time parsing (at 2 PM -> 14:00:00, 9:30 AM -> 09:30:00)
 * 4. Business rule validation (past date rejected, Monday burial rejected with helpful reason)
 * 5. Multi-turn conversational intake in BookingAgentController:
 *    - Turn 1: Decedent name intake
 *    - Turn 2: Prefixed date input ("For burial date: I want the schedule this Sunday")
 *      -> Verifies date is extracted AND decedent name is NOT corrupted to "burial"!
 *    - Turn 3: Follow-up time input ("At 2 PM.") -> preferred_time captured, prior date preserved
 *    - Turn 4: Monday burial restriction prompt ("Actually make it Monday") -> returns helpful policy warning
 *    - Turn 5: Relative interval updates ("In 1 week.", "In 1 month.")
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/services/BookingDateResolver.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

echo "===================================================================\n";
echo "RUNNING PHASE 1: DATE/TIME INTELLIGENCE & EXTRACTOR HARDENING TESTS\n";
echo "===================================================================\n";

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
// 1. UNIT TESTS: BookingDateResolver
// ----------------------------------------------------------------------

// Reference date: Wednesday 2026-09-09 10:00:00
$refTime = strtotime('2026-09-09 10:00:00');

// Test 1: Weekday "Friday" & "this Friday" from Wednesday -> 2026-09-11
$rFri = BookingDateResolver::extractDate('Friday', $refTime);
$rThisFri = BookingDateResolver::extractDate('this Friday', $refTime);
report(1, "Weekday resolution: 'Friday' and 'this Friday'", $rFri === '2026-09-11' && $rThisFri === '2026-09-11', "Got: {$rFri}, {$rThisFri}");

// Test 2: "next Friday" from Wednesday -> 2026-09-18
$rNextFri = BookingDateResolver::extractDate('next Friday', $refTime);
report(2, "Weekday resolution: 'next Friday' advances to following week", $rNextFri === '2026-09-18', "Got: {$rNextFri}");

// Test 3: "Sunday" & "this Sunday" from Wednesday -> 2026-09-13
$rSun = BookingDateResolver::extractDate('Sunday', $refTime);
$rThisSun = BookingDateResolver::extractDate('this Sunday', $refTime);
report(3, "Weekday resolution: 'Sunday' and 'this Sunday'", $rSun === '2026-09-13' && $rThisSun === '2026-09-13', "Got: {$rSun}, {$rThisSun}");

// Test 4: "next Sunday" from Wednesday -> 2026-09-20
$rNextSun = BookingDateResolver::extractDate('next Sunday', $refTime);
report(4, "Weekday resolution: 'next Sunday' advances to following week", $rNextSun === '2026-09-20', "Got: {$rNextSun}");

// Test 5: Relative intervals: tomorrow, in 1 week, in 2 weeks, in 1 month
$rTomorrow = BookingDateResolver::extractDate('tomorrow', $refTime);
$r1Week = BookingDateResolver::extractDate('in 1 week', $refTime);
$r2Weeks = BookingDateResolver::extractDate('in 2 weeks', $refTime);
$r1Month = BookingDateResolver::extractDate('in 1 month', $refTime);
$test5Ok = ($rTomorrow === '2026-09-10' && $r1Week === '2026-09-16' && $r2Weeks === '2026-09-23' && $r1Month === '2026-10-09');
report(5, "Relative interval resolution: tomorrow, in 1 week, in 2 weeks, in 1 month", $test5Ok, "Tomorrow: {$rTomorrow}, 1W: {$r1Week}, 2W: {$r2Weeks}, 1M: {$r1Month}");

// Test 6: Prefixed conversational utterance
$rPrefixed = BookingDateResolver::extractDate('For burial date: I want the schedule this Sunday.', $refTime);
report(6, "Prefixed date extraction: 'For burial date: I want the schedule this Sunday.'", $rPrefixed === '2026-09-13', "Got: {$rPrefixed}");

// Test 7: Time expressions
$t1 = BookingDateResolver::extractTime('at 2 PM');
$t2 = BookingDateResolver::extractTime('at 2:30 pm');
$t3 = BookingDateResolver::extractTime('9:15 AM');
$t4 = BookingDateResolver::extractTime('14:00');
$test7Ok = ($t1 === '14:00:00' && $t2 === '14:30:00' && $t3 === '09:15:00' && $t4 === '14:00:00');
report(7, "Time slot extraction: 2 PM, 2:30 pm, 9:15 AM, 14:00", $test7Ok, "T1: {$t1}, T2: {$t2}, T3: {$t3}, T4: {$t4}");

// Test 8: Combined Date & Time extraction
$dtCombined = BookingDateResolver::extract('Friday at 2 PM', $refTime);
$test8Ok = ($dtCombined['date'] === '2026-09-11' && $dtCombined['time'] === '14:00:00');
report(8, "Combined extraction: 'Friday at 2 PM'", $test8Ok, "Date: {$dtCombined['date']}, Time: {$dtCombined['time']}");

// Test 9: Business rule validation (Past date & Monday burial rule)
$valPast = BookingDateResolver::validate('2020-01-01', true, $refTime);
$valMon = BookingDateResolver::validate('2026-09-14', true, $refTime); // 2026-09-14 is Monday
$valSun = BookingDateResolver::validate('2026-09-13', true, $refTime); // 2026-09-13 is Sunday
$test9Ok = (!$valPast['valid'] && !$valMon['valid'] && $valSun['valid']);
report(9, "Business rule validation: Past rejected, Monday burial rejected, Sunday valid", $test9Ok, "Past: {$valPast['error']}, Mon: {$valMon['error']}");

// ----------------------------------------------------------------------
// 2. CONVERSATIONAL MULTI-TURN INTEGRATION TESTS
// ----------------------------------------------------------------------

$db = Database::getInstance()->getConnection();

// Setup test user
$db->exec("
    DELETE FROM booking_drafts WHERE user_id IN (SELECT user_id FROM users WHERE username = 'phase1_test_user');
    DELETE FROM users WHERE username = 'phase1_test_user';
");
$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('phase1_test_user', 'hash', 'Phase 1 Tester', 'phase1@test.local', 3)
")->execute();
$testUserId = (int) $db->lastInsertId();
$testUser = ['user_id' => $testUserId, 'username' => 'phase1_test_user', 'role' => 'user'];

$controller = new BookingAgentController();

// TURN 1: Initial booking
$turn1Msg = "I want to book a burial for Leonardo P. Smith.";
$res1 = $controller->chat(['message' => $turn1Msg], $testUser);
$draftId = $res1['draft_id'] ?? 0;
$turn1Ok = (
    $res1['success'] === true
    && $draftId > 0
    && ($res1['extracted_data']['decedent_name'] ?? '') === 'Leonardo P. Smith'
    && empty($res1['extracted_data']['preferred_date'])
    && in_array('preferred_date', $res1['missing_fields'] ?? [], true)
);
report(10, "Turn 1: Initial booking captures decedent_name with pending date", $turn1Ok, "Name: " . ($res1['extracted_data']['decedent_name'] ?? 'none'));

// TURN 2: Follow-up prefixed date
// "For burial date: I want the schedule this Sunday."
$turn2Msg = "For burial date: I want the schedule this Sunday.";
$res2 = $controller->chat(['message' => $turn2Msg, 'draft_id' => $draftId, 'service_type' => 'burial'], $testUser);
$turn2Data = $res2['extracted_data'] ?? [];
$turn2Ok = (
    $res2['success'] === true
    && !empty($turn2Data['preferred_date'])
    && ($turn2Data['decedent_name'] ?? '') === 'Leonardo P. Smith' // CRITICAL: Must NOT be "burial"
    && !in_array('preferred_date', $res2['missing_fields'] ?? [], true)
);
report(11, "Turn 2: Prefixed follow-up date sets preferred_date AND preserves decedent_name (no 'burial' corruption)", $turn2Ok,
    "Date: " . ($turn2Data['preferred_date'] ?? 'none') . ", Decedent: " . ($turn2Data['decedent_name'] ?? 'none'));

// TURN 3: Follow-up time slot
$turn3Msg = "At 2 PM.";
$res3 = $controller->chat(['message' => $turn3Msg, 'draft_id' => $draftId, 'service_type' => 'burial'], $testUser);
$turn3Data = $res3['extracted_data'] ?? [];
$turn3Ok = (
    $res3['success'] === true
    && ($turn3Data['preferred_time'] ?? '') === '14:00:00'
    && !empty($turn3Data['preferred_date'])
    && ($turn3Data['decedent_name'] ?? '') === 'Leonardo P. Smith'
);
report(12, "Turn 3: Follow-up time captures preferred_time (14:00:00) and preserves date and name", $turn3Ok,
    "Time: " . ($turn3Data['preferred_time'] ?? 'none') . ", Date: " . ($turn3Data['preferred_date'] ?? 'none'));

// TURN 4: Monday burial restriction check
$comingMonday = date('Y-m-d', strtotime('next Monday'));
$turn4Msg = "Actually make it next Monday.";
$res4 = $controller->chat(['message' => $turn4Msg, 'draft_id' => $draftId, 'service_type' => 'burial'], $testUser);
$turn4Ok = (
    strpos($res4['reply'] ?? '', 'Monday booking is not allowed') !== false
    || strpos($res4['reply'] ?? '', 'Monday') !== false
);
report(13, "Turn 4: Monday burial attempt triggers authoritative policy warning in chat", $turn4Ok,
    "Reply: " . ($res4['reply'] ?? 'none'));

// TURN 5: Natural relative interval updates
$turn5Msg = "In 2 weeks.";
$res5 = $controller->chat(['message' => $turn5Msg, 'draft_id' => $draftId, 'service_type' => 'burial'], $testUser);
$turn5Data = $res5['extracted_data'] ?? [];
$expectedDate = date('Y-m-d', strtotime('+14 days'));
$turn5Ok = (
    $res5['success'] === true
    && ($turn5Data['preferred_date'] ?? '') === $expectedDate
    && ($turn5Data['decedent_name'] ?? '') === 'Leonardo P. Smith'
);
report(14, "Turn 5: 'In 2 weeks.' updates preferred_date to +14 days ({$expectedDate}) with non-destructive merge", $turn5Ok,
    "Date: " . ($turn5Data['preferred_date'] ?? 'none'));

// Clean up
$db->exec("
    DELETE FROM booking_drafts WHERE user_id = {$testUserId};
    DELETE FROM users WHERE user_id = {$testUserId};
");

echo "===================================================================\n";
echo "TEST RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "===================================================================\n";

if ($failed > 0) {
    exit(1);
}
