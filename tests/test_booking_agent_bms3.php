<?php
/**
 * Test Suite: BMS-3 BookingAgentService Backend Logic
 * Validates all 16 required test scenarios for structured input orchestration,
 * centralized required fields, deterministic missing field evaluation,
 * non-destructive merging, field corrections, state progression,
 * advisory decedent discovery, and domain record creation boundaries.
 */
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/Decedent.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';

echo "======================================================\n";
echo "RUNNING BMS-3 BOOKING AGENT SERVICE TEST SUITE\n";
echo "======================================================\n";

$db = Database::getInstance()->getConnection();
$userId = (int) $db->query("SELECT user_id FROM users LIMIT 1")->fetchColumn();
if (!$userId) {
    echo "FATAL: No user found in database.\n";
    exit(1);
}

// Ensure clean test baseline by purging any existing drafts for test user
$db->exec("DELETE FROM booking_drafts WHERE user_id = {$userId}");

// Find a valid lot_id for testing
$validLotId = (int) $db->query("SELECT lot_id FROM lots WHERE status = 'Available' LIMIT 1")->fetchColumn();
if (!$validLotId) {
    $validLotId = (int) $db->query("SELECT lot_id FROM lots LIMIT 1")->fetchColumn();
}

$service = new BookingAgentService();
$draftModel = new BookingDraft();
$createdDraftIds = [];

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

// Helper to find a non-Monday date in the future (e.g. Wednesday 3 weeks from now)
function getValidFutureDate(): string {
    $d = new DateTime('+21 days');
    if ((int) $d->format('N') === 1) { // If Monday, add 1 day to make Tuesday
        $d->modify('+1 day');
    }
    return $d->format('Y-m-d');
}

$futureDate = getValidFutureDate();

// ----------------------------------------------------------------------
// TEST 1: Create burial draft from CREATE_BOOKING structured input.
// ----------------------------------------------------------------------
$payload1 = [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name' => 'Juan Dela Cruz',
        'relationship'  => 'Father',
    ]
];
$res1 = $service->processStructuredInput($userId, $payload1);
$draft1Id = $res1['draft_id'];
$createdDraftIds[] = $draft1Id;

$test1Ok = ($res1['success'] === true && $res1['service_type'] === 'burial' && $res1['status'] === BookingDraft::STATUS_COLLECTING_INFO);
report(1, "Create burial draft from CREATE_BOOKING structured input", $test1Ok, "Status: {$res1['status']}");

// ----------------------------------------------------------------------
// TEST 2: Partial extraction correctly identifies missing fields.
// ----------------------------------------------------------------------
// Burial requires: service_type, decedent_name, preferred_date, lot_id
// We only supplied decedent_name & relationship. Missing should be preferred_date and lot_id.
$missing1 = $res1['missing_fields'];
$test2Ok = (in_array('preferred_date', $missing1, true) && in_array('lot_id', $missing1, true) && !in_array('decedent_name', $missing1, true));
report(2, "Partial extraction correctly identifies missing fields", $test2Ok, "Missing: " . json_encode($missing1));

// ----------------------------------------------------------------------
// TEST 3: Existing extracted fields are preserved after new information arrives.
// ----------------------------------------------------------------------
$payload3 = [
    'intent' => BookingAgentService::INTENT_PROVIDE_INFO,
    'extracted_fields' => [
        'preferred_date' => $futureDate,
    ]
];
$res3 = $service->processStructuredInput($userId, $payload3, $draft1Id);
$data3 = $res3['extracted_data'];
$test3Ok = (
    isset($data3['decedent_name']) && $data3['decedent_name'] === 'Juan Dela Cruz' &&
    isset($data3['relationship']) && $data3['relationship'] === 'Father' &&
    isset($data3['preferred_date']) && $data3['preferred_date'] === $futureDate
);
report(3, "Existing extracted fields are preserved after new info arrives", $test3Ok, json_encode($data3));

// ----------------------------------------------------------------------
// TEST 4: UPDATE_FIELD overrides only the specified field.
// ----------------------------------------------------------------------
$res4 = $service->updateDraftField($draft1Id, 'decedent_name', 'Juan M. Dela Cruz', $userId);
$data4 = $res4['extracted_data'];
$test4Ok = (
    $data4['decedent_name'] === 'Juan M. Dela Cruz' &&
    $data4['relationship'] === 'Father' &&
    $data4['preferred_date'] === $futureDate
);
report(4, "UPDATE_FIELD overrides only the specified field", $test4Ok, json_encode($data4));

// ----------------------------------------------------------------------
// TEST 5: Missing required field returns workflow to COLLECTING_INFO when applicable.
// ----------------------------------------------------------------------
// First set lot_id so all burial fields are complete (status should become READY_FOR_REVIEW)
$res5a = $service->updateDraftField($draft1Id, 'lot_id', $validLotId, $userId);
$readyStatus = $res5a['status'];

// Now clear preferred_date via UPDATE_FIELD with empty string -> should revert to COLLECTING_INFO
$res5b = $service->updateDraftField($draft1Id, 'preferred_date', '', $userId);
$revertedStatus = $res5b['status'];
$test5Ok = ($readyStatus === BookingDraft::STATUS_READY_FOR_REVIEW && $revertedStatus === BookingDraft::STATUS_COLLECTING_INFO);
report(5, "Missing required field returns workflow to COLLECTING_INFO", $test5Ok, "Ready: {$readyStatus}, Reverted: {$revertedStatus}");

// Cleanly cancel draft 1 before next test
$service->cancelDraft($draft1Id, $userId);

// ----------------------------------------------------------------------
// TEST 6: Burial with missing lot transitions to LOT_SELECTION.
// ----------------------------------------------------------------------
// Create fresh burial draft with decedent name and preferred date (lot_id missing)
$payload6 = [
    'intent' => BookingAgentService::INTENT_PROVIDE_INFO,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name'  => 'Pedro Penduko',
        'preferred_date' => $futureDate,
    ]
];
$res6 = $service->processStructuredInput($userId, $payload6);
$draft6Id = $res6['draft_id'];
$createdDraftIds[] = $draft6Id;

$test6Ok = ($res6['status'] === BookingDraft::STATUS_LOT_SELECTION && in_array('lot_id', $res6['missing_fields'], true));
report(6, "Burial with missing lot transitions to LOT_SELECTION", $test6Ok, "Status: {$res6['status']}, Missing: " . json_encode($res6['missing_fields']));

// ----------------------------------------------------------------------
// TEST 7: Complete burial data transitions to READY_FOR_REVIEW.
// ----------------------------------------------------------------------
// From LOT_SELECTION, supplying lot_id transitions to READY_FOR_REVIEW
$res7 = $service->updateDraftField($draft6Id, 'lot_id', $validLotId, $userId);
$test7Ok = ($res7['status'] === BookingDraft::STATUS_READY_FOR_REVIEW && empty($res7['missing_fields']) && $res7['is_ready_for_review'] === true);
report(7, "Complete burial data transitions to READY_FOR_REVIEW", $test7Ok, "Status: {$res7['status']}, Missing: " . json_encode($res7['missing_fields']));

// Cleanly cancel draft 6 before cremation tests
$service->cancelDraft($draft6Id, $userId);

// ----------------------------------------------------------------------
// TEST 8: Cremation flow follows CREMATION_PREFS when applicable.
// ----------------------------------------------------------------------
$payload8 = [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'cremation',
    'extracted_fields' => [
        'decedent_name' => 'Maria Santos',
    ]
];
$res8 = $service->processStructuredInput($userId, $payload8);
$draft8Id = $res8['draft_id'];
$createdDraftIds[] = $draft8Id;

$test8Ok = ($res8['service_type'] === 'cremation' && $res8['status'] === BookingDraft::STATUS_CREMATION_PREFS);
report(8, "Cremation flow follows CREMATION_PREFS when applicable", $test8Ok, "Status: {$res8['status']}");

// ----------------------------------------------------------------------
// TEST 9: Complete cremation data transitions to READY_FOR_REVIEW.
// ----------------------------------------------------------------------
$payload9 = [
    'intent' => BookingAgentService::INTENT_PROVIDE_INFO,
    'extracted_fields' => [
        'cremation_date' => $futureDate,
        'preferred_columbarium' => 'St. Peter Columbarium',
    ]
];
$res9 = $service->processStructuredInput($userId, $payload9, $draft8Id);
$test9Ok = ($res9['status'] === BookingDraft::STATUS_READY_FOR_REVIEW && empty($res9['missing_fields']) && $res9['is_ready_for_review'] === true);
report(9, "Complete cremation data transitions to READY_FOR_REVIEW", $test9Ok, "Status: {$res9['status']}");

// Cleanly cancel draft 8
$service->cancelDraft($draft8Id, $userId);

// ----------------------------------------------------------------------
// TEST 10: Invalid service_type is rejected.
// ----------------------------------------------------------------------
$test10Ok = false;
try {
    $service->processStructuredInput($userId, [
        'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
        'service_type' => 'space_travel',
        'extracted_fields' => ['decedent_name' => 'Test']
    ]);
} catch (BookingDraftException $e) {
    $test10Ok = ($e->getErrorType() === 'INVALID_SERVICE_TYPE');
}
report(10, "Invalid service_type is rejected", $test10Ok);

// ----------------------------------------------------------------------
// TEST 11: Invalid date is rejected as incomplete/invalid.
// ----------------------------------------------------------------------
$res11 = $service->processStructuredInput($userId, [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'burial',
    'extracted_fields' => [
        'decedent_name'  => 'Test Person',
        'preferred_date' => 'not-a-valid-date'
    ]
]);
$draft11Id = $res11['draft_id'];
$createdDraftIds[] = $draft11Id;
$test11Ok = (in_array('preferred_date', $res11['missing_fields'], true));
report(11, "Invalid date format treated as missing field", $test11Ok, "Missing: " . json_encode($res11['missing_fields']));

// ----------------------------------------------------------------------
// TEST 12: Past date is rejected.
// ----------------------------------------------------------------------
$pastDate = '2020-01-01';
$res12 = $service->updateDraftField($draft11Id, 'preferred_date', $pastDate, $userId);
$test12Ok = (in_array('preferred_date', $res12['missing_fields'], true));
report(12, "Past date is rejected as missing/invalid", $test12Ok, "Missing: " . json_encode($res12['missing_fields']));

// ----------------------------------------------------------------------
// TEST 13: Decedent match does not block booking when no match exists.
// ----------------------------------------------------------------------
$uniqueName = 'Zzzz Nonexistent Name ' . time();
$res13 = $service->updateDraftField($draft11Id, 'decedent_name', $uniqueName, $userId);
$match13 = $res13['decedent_match'];
$test13Ok = ($res13['success'] === true && $match13['found'] === false && empty($match13['candidates']));
report(13, "Decedent match is non-blocking when no match exists", $test13Ok);

// ----------------------------------------------------------------------
// TEST 14: CONFIRM_BOOKING does NOT create burial_schedules.
// ----------------------------------------------------------------------
// Count burial schedules before
$countSchedulesBefore = (int) $db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn();

// Prepare draft11 with all valid burial fields
$service->updateDraftField($draft11Id, 'preferred_date', $futureDate, $userId);
$service->updateDraftField($draft11Id, 'lot_id', $validLotId, $userId);

// Call with CONFIRM_BOOKING intent
$res14 = $service->processStructuredInput($userId, ['intent' => BookingAgentService::INTENT_CONFIRM_BOOKING], $draft11Id);
$countSchedulesAfter = (int) $db->query("SELECT COUNT(*) FROM burial_schedules")->fetchColumn();

$test14Ok = ($res14['status'] === BookingDraft::STATUS_AWAITING_CONFIRM && $countSchedulesBefore === $countSchedulesAfter);
report(14, "CONFIRM_BOOKING does NOT create burial_schedules (transitions to AWAITING_CONFIRM only)", $test14Ok, "Before: {$countSchedulesBefore}, After: {$countSchedulesAfter}, Status: {$res14['status']}");

// Cleanly cancel draft 11
$service->cancelDraft($draft11Id, $userId);

// ----------------------------------------------------------------------
// TEST 15: CONFIRM_BOOKING does NOT create cremation_records.
// ----------------------------------------------------------------------
$countCremationsBefore = (int) $db->query("SELECT COUNT(*) FROM cremation_records")->fetchColumn();

$res15a = $service->processStructuredInput($userId, [
    'intent' => BookingAgentService::INTENT_CREATE_BOOKING,
    'service_type' => 'cremation',
    'extracted_fields' => [
        'decedent_name'  => 'Cremation Test Decedent',
        'cremation_date' => $futureDate,
    ]
]);
$draft15Id = $res15a['draft_id'];
$createdDraftIds[] = $draft15Id;

$res15b = $service->processStructuredInput($userId, ['intent' => BookingAgentService::INTENT_CONFIRM_BOOKING], $draft15Id);
$countCremationsAfter = (int) $db->query("SELECT COUNT(*) FROM cremation_records")->fetchColumn();

$test15Ok = ($res15b['status'] === BookingDraft::STATUS_AWAITING_CONFIRM && $countCremationsBefore === $countCremationsAfter);
report(15, "CONFIRM_BOOKING does NOT create cremation_records", $test15Ok, "Before: {$countCremationsBefore}, After: {$countCremationsAfter}, Status: {$res15b['status']}");

// ----------------------------------------------------------------------
// TEST 16: Terminal drafts reject further processing.
// ----------------------------------------------------------------------
$service->cancelDraft($draft15Id, $userId);
$test16Ok = false;
try {
    $service->processStructuredInput($userId, [
        'intent' => BookingAgentService::INTENT_PROVIDE_INFO,
        'extracted_fields' => ['notes' => 'Attempting update on cancelled draft']
    ], $draft15Id);
} catch (BookingDraftException $e) {
    $test16Ok = ($e->getErrorType() === 'TERMINAL_STATE_MODIFICATION');
}
report(16, "Terminal drafts reject further processing", $test16Ok);

// ----------------------------------------------------------------------
// CLEAN UP TEST DRAFTS
// ----------------------------------------------------------------------
if (!empty($createdDraftIds)) {
    $placeholders = implode(',', array_fill(0, count($createdDraftIds), '?'));
    $stmtDel = $db->prepare("DELETE FROM booking_drafts WHERE draft_id IN ({$placeholders})");
    $stmtDel->execute($createdDraftIds);
}

echo "======================================================\n";
echo "BMS-3 TEST RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}

