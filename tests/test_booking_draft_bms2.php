<?php
/**
 * Test Suite: BMS-2 BookingDraft Domain Model
 * Validates all 10 required test scenarios for state machine, lifecycle,
 * terminal state protection, expiration guards, and JSON merges.
 */
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';

echo "======================================================\n";
echo "RUNNING BMS-2 BOOKING DRAFT DOMAIN MODEL TEST SUITE\n";
echo "======================================================\n";

$db = Database::getInstance()->getConnection();
$userId = (int) $db->query("SELECT user_id FROM users LIMIT 1")->fetchColumn();
if (!$userId) {
    echo "FATAL: No user found in database to run tests with.\n";
    exit(1);
}

$model = new BookingDraft();
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
// TEST 1: Create valid draft -> Expected: DRAFT_STARTED
// ----------------------------------------------------------------------
$expiresFuture = date('Y-m-d H:i:s', strtotime('+24 hours'));
$draft1Id = $model->create($userId, 'burial', $expiresFuture, 'conv-test-1');
$draft1 = $model->findById($draft1Id);
$test1Success = ($draft1 && $draft1['status'] === BookingDraft::STATUS_DRAFT_STARTED && $draft1['service_type'] === 'burial');
report(1, "Create valid draft (status: DRAFT_STARTED)", $test1Success, "Status: " . ($draft1['status'] ?? 'null'));

// ----------------------------------------------------------------------
// TEST 2: DRAFT_STARTED -> COLLECTING_INFO -> Expected: Allowed
// ----------------------------------------------------------------------
$res2 = $model->transitionStatus($draft1Id, BookingDraft::STATUS_COLLECTING_INFO);
$draft1After2 = $model->findById($draft1Id);
$test2Success = ($res2 === true && $draft1After2['status'] === BookingDraft::STATUS_COLLECTING_INFO);
report(2, "DRAFT_STARTED -> COLLECTING_INFO transition allowed", $test2Success, "Status: " . ($draft1After2['status'] ?? 'null'));

// ----------------------------------------------------------------------
// TEST 3: DRAFT_STARTED -> COMMITTED -> Expected: Rejected
// ----------------------------------------------------------------------
$draft3Id = $model->create($userId, 'burial', $expiresFuture);
$test3Success = false;
try {
    $model->transitionStatus($draft3Id, BookingDraft::STATUS_COMMITTED);
    $test3Success = false;
} catch (BookingDraftException $e) {
    $test3Success = ($e->getErrorType() === 'INVALID_STATE_TRANSITION');
}
report(3, "DRAFT_STARTED -> COMMITTED rejected by state machine", $test3Success);

// ----------------------------------------------------------------------
// TEST 4: Merge extracted data -> Expected: Existing fields preserved
// ----------------------------------------------------------------------
$draft4Id = $model->create($userId, 'burial', $expiresFuture);
$model->updateExtractedData($draft4Id, [
    'decedent_name' => 'Juan Cruz',
    'relationship' => 'Father',
    'preferred_date' => '2026-10-12'
]);
$merged = $model->updateExtractedData($draft4Id, [
    'decedent_name' => 'Juan M. Cruz'
]);
$draft4 = $model->findById($draft4Id);
$data4 = json_decode($draft4['extracted_data'], true);
$test4Success = (
    $data4['decedent_name'] === 'Juan M. Cruz' &&
    $data4['relationship'] === 'Father' &&
    $data4['preferred_date'] === '2026-10-12'
);
report(4, "Merge extracted data (existing fields preserved)", $test4Success, json_encode($data4));

// ----------------------------------------------------------------------
// TEST 5: Terminal draft modification (COMMITTED -> updateExtractedData) -> Expected: Rejected
// ----------------------------------------------------------------------
// Transition draft4 to AWAITING_CONFIRM then commit
$model->transitionStatus($draft4Id, BookingDraft::STATUS_COLLECTING_INFO);
$model->transitionStatus($draft4Id, BookingDraft::STATUS_READY_FOR_REVIEW);
$model->transitionStatus($draft4Id, BookingDraft::STATUS_AWAITING_CONFIRM);
$model->commit($draft4Id, 9991, 'burial');

$test5Success = false;
try {
    $model->updateExtractedData($draft4Id, ['notes' => 'Attempting terminal update']);
} catch (BookingDraftException $e) {
    $test5Success = ($e->getErrorType() === 'DRAFT_ALREADY_COMMITTED' || $e->getErrorType() === 'TERMINAL_STATE_MODIFICATION');
}
report(5, "Terminal draft modification (COMMITTED -> updateExtractedData) rejected", $test5Success);

// ----------------------------------------------------------------------
// TEST 6: Double commit
// First commit: Allowed only if state requirements met
// Second commit: Rejected
// ----------------------------------------------------------------------
$draft6Id = $model->create($userId, 'burial', $expiresFuture);
// Try commit prematurely (should fail)
$prematureFailed = false;
try {
    $model->commit($draft6Id, 9992, 'burial');
} catch (BookingDraftException $e) {
    $prematureFailed = ($e->getErrorType() === 'INVALID_COMMIT_ATTEMPT');
}

// Progress legally to AWAITING_CONFIRM
$model->transitionStatus($draft6Id, BookingDraft::STATUS_COLLECTING_INFO);
$model->transitionStatus($draft6Id, BookingDraft::STATUS_READY_FOR_REVIEW);
$model->transitionStatus($draft6Id, BookingDraft::STATUS_AWAITING_CONFIRM);
$firstCommitOk = $model->commit($draft6Id, 9992, 'burial');

// Second commit attempt
$secondCommitRejected = false;
try {
    $model->commit($draft6Id, 9992, 'burial');
} catch (BookingDraftException $e) {
    $secondCommitRejected = ($e->getErrorType() === 'DRAFT_ALREADY_COMMITTED');
}
$test6Success = ($prematureFailed && $firstCommitOk && $secondCommitRejected);
report(6, "Double commit protection (premature rejected, first succeeds, second rejected)", $test6Success);

// ----------------------------------------------------------------------
// TEST 7: Expired draft update -> Expected: Rejected
// ----------------------------------------------------------------------
// Create draft that expired 1 hour ago
$expiresPast = date('Y-m-d H:i:s', strtotime('-1 hour'));
$stmt = $db->prepare("INSERT INTO booking_drafts (user_id, service_type, status, expires_at) VALUES (?, 'burial', 'COLLECTING_INFO', ?)");
$stmt->execute([$userId, $expiresPast]);
$draft7Id = (int) $db->lastInsertId();

$test7Success = false;
try {
    $model->updateExtractedData($draft7Id, ['decedent_name' => 'Expired Test']);
} catch (BookingDraftException $e) {
    $test7Success = ($e->getErrorType() === 'DRAFT_EXPIRED');
}
// Check that draft status was transitioned to EXPIRED
$draft7Row = $model->findById($draft7Id);
$test7Success = $test7Success && ($draft7Row['status'] === BookingDraft::STATUS_EXPIRED);
report(7, "Expired draft update rejected and transitioned to EXPIRED", $test7Success, "Status: " . ($draft7Row['status'] ?? 'null'));

// ----------------------------------------------------------------------
// TEST 8: Cancel active draft -> Expected: Status becomes CANCELLED
// ----------------------------------------------------------------------
$draft8Id = $model->create($userId, 'cremation', $expiresFuture);
$res8 = $model->cancel($draft8Id);
$draft8Row = $model->findById($draft8Id);
$test8Success = ($res8 === true && $draft8Row['status'] === BookingDraft::STATUS_CANCELLED);
report(8, "Cancel active draft sets status to CANCELLED", $test8Success, "Status: " . ($draft8Row['status'] ?? 'null'));

// ----------------------------------------------------------------------
// TEST 9: Cancelled draft modification -> Expected: Rejected
// ----------------------------------------------------------------------
$test9Success = false;
try {
    $model->updateExtractedData($draft8Id, ['decedent_name' => 'Cancelled Test']);
} catch (BookingDraftException $e) {
    $test9Success = ($e->getErrorType() === 'TERMINAL_STATE_MODIFICATION');
}
report(9, "Cancelled draft modification rejected", $test9Success);

// ----------------------------------------------------------------------
// TEST 10: Invalid transition (LOT_SELECTION -> CREMATION_PREFS) -> Expected: Rejected
// ----------------------------------------------------------------------
$draft10Id = $model->create($userId, 'burial', $expiresFuture);
$model->transitionStatus($draft10Id, BookingDraft::STATUS_COLLECTING_INFO);
$model->transitionStatus($draft10Id, BookingDraft::STATUS_LOT_SELECTION);

$test10Success = false;
try {
    $model->transitionStatus($draft10Id, BookingDraft::STATUS_CREMATION_PREFS);
} catch (BookingDraftException $e) {
    $test10Success = ($e->getErrorType() === 'INVALID_STATE_TRANSITION');
}
report(10, "Invalid transition (LOT_SELECTION -> CREMATION_PREFS) rejected", $test10Success);

// ----------------------------------------------------------------------
// CLEAN UP TEST ROWS
// ----------------------------------------------------------------------
$testDraftIds = [$draft1Id, $draft3Id, $draft4Id, $draft6Id, $draft7Id, $draft8Id, $draft10Id];
$placeholders = implode(',', array_fill(0, count($testDraftIds), '?'));
$stmtDel = $db->prepare("DELETE FROM booking_drafts WHERE draft_id IN ({$placeholders})");
$stmtDel->execute($testDraftIds);

echo "======================================================\n";
echo "BMS-2 TEST RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}

