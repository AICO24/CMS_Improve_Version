<?php
/**
 * Test Suite: Phase 2 — Draft vs Committed Routing Delineation & Action Hardening
 * 
 * Verifies:
 * 1. Draft Date Correction via Conversational Editing (Weekday / Relative) updates draft with zero Category B deferral.
 * 2. Draft Date Cemetery Rule Enforcement (Monday burial / Past date) stops invalid draft updates with clear guidance.
 * 3. Draft Lot Selection / Correction ("Change lot to 12") directly updates draft lot_id with zero Category B deferral.
 * 4. Committed Booking Reschedule Protection: Staged as pending action / deferred, zero immediate DB mutation.
 * 5. Draft vs Committed Ambiguity Protection: When citizen has both draft & committed booking, generic date change returns AMBIGUOUS.
 * 6. Explicit Reference Delineation: Citizen with both can explicitly target draft (DFT-X) or committed booking (BUR-Y).
 * 7. Draft State Preservation in Responses: Action responses always preserve extracted_data and missing_fields for Live Blueprint HUD.
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
echo "RUNNING PHASE 2: DRAFT VS COMMITTED ROUTING & ACTION HARDENING\n";
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
// SETUP TEST ENVIRONMENT
// ----------------------------------------------------------------------
$db->exec("
    DELETE FROM audit_logs WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'phase2_test_%');
    DELETE FROM booking_pending_actions WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'phase2_test_%');
    DELETE FROM burial_schedules WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'phase2_test_%');
    DELETE FROM cremation_records WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'phase2_test_%');
    DELETE FROM decedent_requests WHERE requested_by IN (SELECT user_id FROM users WHERE username LIKE 'phase2_test_%');
    DELETE FROM booking_drafts WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'phase2_test_%');
    DELETE FROM users WHERE username IN ('phase2_test_user_a', 'phase2_test_user_b');
");

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('phase2_test_user_a', 'hash', 'Phase 2 Citizen A', 'phase2_a@test.local', 3)
")->execute();
$userAId = (int) $db->lastInsertId();

$userA = ['user_id' => $userAId, 'username' => 'phase2_test_user_a', 'role' => 'user'];

// Find or pick 2 valid lots
$lots = $db->query("SELECT lot_id FROM lots WHERE status = 'Available' LIMIT 2")->fetchAll(PDO::FETCH_COLUMN);
if (count($lots) < 2) {
    $lots = $db->query("SELECT lot_id FROM lots LIMIT 2")->fetchAll(PDO::FETCH_COLUMN);
}
$lot1Id = (int) $lots[0];
$lot2Id = (int) ($lots[1] ?? $lots[0]);

$controller = new BookingAgentController();
$service = new BookingAgentService();
$draftModel = new BookingDraft();
$schedModel = new Schedule();
$decReqModel = new DecedentRequest();

// ----------------------------------------------------------------------
// TEST 1 — Draft Date Correction via Conversational Editing (Weekday)
// Setup: Active draft with missing date.
// Input: "Actually make the date Friday"
// Expected: Draft preferred_date updated directly, ZERO Category B deferral
// ----------------------------------------------------------------------
$draft1Id = $draftModel->create($userAId, 'burial', date('Y-m-d H:i:s', time() + 86400));
$draftModel->updateExtractedData($draft1Id, [
    'service_type'  => 'burial',
    'decedent_name' => 'Ramon Fernandez',
    'relationship'  => 'Brother'
]);
$draftModel->transitionStatus($draft1Id, BookingDraft::STATUS_COLLECTING_INFO);

$msg1 = "Actually make the date Friday.";
$res1 = $controller->chat(['message' => $msg1, 'draft_id' => $draft1Id], $userA);

$freshDraft1 = $draftModel->findById($draft1Id);
$extracted1 = json_decode($freshDraft1['extracted_data'] ?? '{}', true);
$expectedFriday = BookingDateResolver::extractDate("Friday");

$t1_dateUpdated = (!empty($extracted1['preferred_date']) && $extracted1['preferred_date'] === $expectedFriday);
$t1_notDeferred = ($res1['deferred_intent'] ?? null) === null && ($res1['action_status'] ?? '') !== 'DEFERRED';
$t1_blueprintPreserved = !empty($res1['extracted_data']['decedent_name']) && $res1['extracted_data']['decedent_name'] === 'Ramon Fernandez';

$test1Ok = ($t1_dateUpdated && $t1_notDeferred && $t1_blueprintPreserved);
report(1, "Draft Date Correction: 'Actually make the date Friday' updates draft with zero Category B deferral", $test1Ok,
    "Draft Date: " . ($extracted1['preferred_date'] ?? 'none') . ", Expected: {$expectedFriday}, Blueprint Name: " . ($res1['extracted_data']['decedent_name'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 2 — Draft Date Rejection for Cemetery Monday Rule
// Input: "Change date to this Monday"
// Expected: Returns clarification required with Monday rule explanation; draft date is not corrupted
// ----------------------------------------------------------------------
$msg2 = "Change date to this Monday.";
$res2 = $controller->chat(['message' => $msg2, 'draft_id' => $draft1Id], $userA);

$freshDraft2 = $draftModel->findById($draft1Id);
$extracted2 = json_decode($freshDraft2['extracted_data'] ?? '{}', true);

$t2_dateRetained = ($extracted2['preferred_date'] === $expectedFriday); // still Friday
$t2_replyWarning = (stripos($res2['reply'] ?? '', 'Monday') !== false || stripos($res2['reply'] ?? '', 'not allowed') !== false);
$t2_blueprintPreserved = !empty($res2['extracted_data']['preferred_date']);

$test2Ok = ($t2_dateRetained && $t2_replyWarning && $t2_blueprintPreserved);
report(2, "Draft Cemetery Rule Protection: Rejects Monday burial with helpful message and preserves valid draft date", $test2Ok,
    "Reply: " . ($res2['reply'] ?? 'none') . ", Draft Date: " . ($extracted2['preferred_date'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 3 — Draft Lot Selection / Correction via Natural Chat
// Input: "Change lot to {$lot1Id}"
// Expected: lot_id in draft updated directly, zero Category B deferral
// ----------------------------------------------------------------------
$msg3 = "Change lot to {$lot1Id}.";
$res3 = $controller->chat(['message' => $msg3, 'draft_id' => $draft1Id], $userA);

$freshDraft3 = $draftModel->findById($draft1Id);
$extracted3 = json_decode($freshDraft3['extracted_data'] ?? '{}', true);

$t3_lotUpdated = ((int)($extracted3['lot_id'] ?? 0) === $lot1Id);
$t3_notDeferred = ($res3['deferred_intent'] ?? null) === null;
$t3_hudHasLot = ((int)($res3['extracted_data']['lot_id'] ?? 0) === $lot1Id);

$test3Ok = ($t3_lotUpdated && $t3_notDeferred && $t3_hudHasLot);
report(3, "Draft Lot Update: 'Change lot to {$lot1Id}' updates draft lot_id directly with zero Category B deferral", $test3Ok,
    "Draft Lot: " . ($extracted3['lot_id'] ?? 'none') . ", HUD Lot: " . ($res3['extracted_data']['lot_id'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 4 — Committed Booking Reschedule Protection
// Setup: Clear draft, create 1 active committed burial booking.
// Input: "Change my booking date to September 25."
// Expected: Committed booking date protected: requires staging/confirmation, ZERO immediate DB mutation.
// ----------------------------------------------------------------------
$db->prepare("DELETE FROM booking_drafts WHERE user_id = ?")->execute([$userAId]);

$decReq1Id = $decReqModel->create([
    'requested_by' => $userAId,
    'full_name'    => 'Maria Santos',
    'relationship' => 'Daughter',
    'notes'        => 'Phase 2 Committed Booking'
]);

$initialSchedDate = '2026-09-20';
$sched1Id = $schedModel->create([
    'lot_id'              => $lot2Id,
    'decedent_request_id' => $decReq1Id,
    'schedule_date'       => $initialSchedDate,
    'status'              => 'Pending',
    'notes'               => 'Phase 2 Active Schedule',
    'created_by'          => $userAId
]);
$refSched1 = "BUR-{$sched1Id}";

$msg4 = "Change my booking date to September 25.";
$res4 = $controller->chat(['message' => $msg4], $userA);

$freshSched4 = $schedModel->findById($sched1Id);
$t4_zeroMutation = ($freshSched4['schedule_date'] === $initialSchedDate);
$t4_deferredOrAwaiting = in_array($res4['action']['status'] ?? ($res4['action_status'] ?? ''), ['AWAITING_CONFIRMATION', 'ACTION_DEFERRED'], true)
    || !empty($res4['pending_action']);

$test4Ok = ($t4_zeroMutation && $t4_deferredOrAwaiting);
report(4, "Committed Reschedule Protection: Staged for confirmation with zero immediate database mutation", $test4Ok,
    "DB Date: {$freshSched4['schedule_date']}, Action Status: " . ($res4['action']['status'] ?? 'none'));

// ----------------------------------------------------------------------
// TEST 5 — Draft vs Committed Ambiguity Protection
// Setup: Citizen A now has BOTH an active draft AND an active committed booking ($sched1Id).
// Input: "Change date to Friday" (without specifying draft or BUR-{$sched1Id})
// Expected: Returns AMBIGUOUS context without guessing, zero mutations
// ----------------------------------------------------------------------
$draft2Id = $draftModel->create($userAId, 'burial', date('Y-m-d H:i:s', time() + 86400));
$draftModel->updateExtractedData($draft2Id, [
    'service_type'  => 'burial',
    'decedent_name' => 'Clara Santos'
]);
$draftModel->transitionStatus($draft2Id, BookingDraft::STATUS_COLLECTING_INFO);

$msg5 = "Change date to Friday.";
$res5 = $controller->chat(['message' => $msg5], $userA);

$t5_ambiguous = ($res5['context_resolution']['status'] ?? '') === 'AMBIGUOUS';
$t5_hasCandidates = !empty($res5['context_resolution']['candidates']);

// Verify zero mutations on both
$postSched5 = $schedModel->findById($sched1Id);
$postDraft5 = $draftModel->findById($draft2Id);
$postDraft5Extracted = json_decode($postDraft5['extracted_data'] ?? '{}', true);

$t5_zeroSchedMutation = ($postSched5['schedule_date'] === $initialSchedDate);
$t5_zeroDraftMutation = empty($postDraft5Extracted['preferred_date']);

$test5Ok = ($t5_ambiguous && $t5_hasCandidates && $t5_zeroSchedMutation && $t5_zeroDraftMutation);
report(5, "Draft vs Committed Ambiguity: Generic date change with both active returns AMBIGUOUS with zero guessing", $test5Ok,
    "Status: " . ($res5['context_resolution']['status'] ?? 'none') . ", Candidates: " . count($res5['context_resolution']['candidates'] ?? []));

// ----------------------------------------------------------------------
// TEST 6 — Explicit Draft Targeting When Both Coexist
// Input: "Change date to Friday for DFT-{$draft2Id}"
// Expected: Resolves to DRAFT, updates draft preferred_date, leaves committed booking untouched
// ----------------------------------------------------------------------
$msg6 = "Change date to Friday for DFT-{$draft2Id}.";
$res6 = $controller->chat(['message' => $msg6], $userA);

$freshDraft6 = $draftModel->findById($draft2Id);
$extracted6 = json_decode($freshDraft6['extracted_data'] ?? '{}', true);
$freshSched6 = $schedModel->findById($sched1Id);

$t6_draftUpdated = (!empty($extracted6['preferred_date']) && $extracted6['preferred_date'] === $expectedFriday);
$t6_schedUntouched = ($freshSched6['schedule_date'] === $initialSchedDate);

$test6Ok = ($t6_draftUpdated && $t6_schedUntouched);
report(6, "Explicit Draft Targeting: Explicit 'DFT-{$draft2Id}' updates draft preferred_date without affecting committed booking", $test6Ok,
    "Draft Date: " . ($extracted6['preferred_date'] ?? 'none') . ", Sched Date: {$freshSched6['schedule_date']}");

// ----------------------------------------------------------------------
// TEST 7 — Draft State Preservation in Responses (Finding-05)
// Setup: Ask a clarifying question or trigger an action on a user with a draft.
// Expected: extracted_data and missing_fields are present and populated in the chat response.
// ----------------------------------------------------------------------
$msg7 = "Ano pa kulang?";
$res7 = $controller->chat(['message' => $msg7, 'draft_id' => $draft2Id], $userA);

$t7_hasExtracted = isset($res7['extracted_data']) && is_array($res7['extracted_data']) && !empty($res7['extracted_data']['decedent_name']);
$t7_hasMissing = isset($res7['missing_fields']) && is_array($res7['missing_fields']);

$test7Ok = ($t7_hasExtracted && $t7_hasMissing);
report(7, "Draft State Preservation: Response always includes populated extracted_data and missing_fields", $test7Ok,
    "Extracted Name: " . ($res7['extracted_data']['decedent_name'] ?? 'none') . ", Missing: " . json_encode($res7['missing_fields'] ?? []));

// ----------------------------------------------------------------------
// CLEANUP TEST DATA
// ----------------------------------------------------------------------
$db->prepare("DELETE FROM booking_pending_actions WHERE user_id = ?")->execute([$userAId]);
$db->prepare("DELETE FROM burial_schedules WHERE schedule_id = ?")->execute([$sched1Id]);
$db->prepare("DELETE FROM decedent_requests WHERE request_id = ?")->execute([$decReq1Id]);
$db->prepare("DELETE FROM booking_drafts WHERE user_id = ?")->execute([$userAId]);
$db->prepare("DELETE FROM users WHERE user_id = ?")->execute([$userAId]);

echo "===============================================================\n";
echo "PHASE 2 TEST SUMMARY: {$passed} PASSED, {$failed} FAILED\n";
echo "===============================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
