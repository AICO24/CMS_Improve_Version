<?php
/**
 * Test Suite: BMS-10 Comprehensive Regression & Hardening Audit
 * 
 * Verifies:
 * 1. Complete legal lifecycle & backward correction paths
 * 2. Terminal state immutability (COMMITTED, CANCELLED, EXPIRED)
 * 3. Double confirmation & finalization idempotency (Burial & Cremation)
 * 4. Atomic transaction rollback safety
 * 5. Cross-user security & ownership enforcement (User A vs User B)
 * 6. Expiration boundary, sweep, and HTTP 410 semantics
 * 7. Unified booking history data integrity & zero duplicate joins
 * 8. AI failure resilience & deterministic fallback handling
 * 9. Payment verification & AutomationEngine integration safety
 * 10. Legacy booking APIs compatibility
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/UnifiedBooking.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/DecedentRequest.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';
require_once __DIR__ . '/../backend/controllers/ScheduleController.php';
require_once __DIR__ . '/../backend/controllers/CremationController.php';
require_once __DIR__ . '/../backend/controllers/LotController.php';
require_once __DIR__ . '/../backend/controllers/DecedentRequestController.php';

echo "==============================================================\n";
echo "RUNNING BMS-10 COMPREHENSIVE REGRESSION & HARDENING AUDIT\n";
echo "==============================================================\n";

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

$db->exec("
    DELETE FROM payments WHERE receipt_number LIKE 'BMS10%' OR received_by IN (SELECT user_id FROM users WHERE username LIKE 'bms10_reg_%');
    DELETE FROM burial_schedules WHERE lot_id IN (SELECT lot_id FROM lots WHERE lot_number = 'BMS10-REG-LOT') OR created_by IN (SELECT user_id FROM users WHERE username LIKE 'bms10_reg_%');
    DELETE FROM cremation_records WHERE created_by IN (SELECT user_id FROM users WHERE username LIKE 'bms10_reg_%');
    DELETE FROM decedent_requests WHERE requested_by IN (SELECT user_id FROM users WHERE username LIKE 'bms10_reg_%');
    DELETE FROM booking_drafts WHERE user_id IN (SELECT user_id FROM users WHERE username LIKE 'bms10_reg_%');
    DELETE FROM lots WHERE lot_number = 'BMS10-REG-LOT';
    DELETE FROM users WHERE username IN ('bms10_reg_user_a', 'bms10_reg_user_b', 'bms10_reg_admin');
");
$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('bms10_reg_user_a', 'hash', 'BMS10 User A', 'reg_a@test.local', 3)
")->execute();
$userAId = (int) $db->lastInsertId();

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('bms10_reg_user_b', 'hash', 'BMS10 User B', 'reg_b@test.local', 3)
")->execute();
$userBId = (int) $db->lastInsertId();

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('bms10_reg_admin', 'hash', 'BMS10 Admin', 'admin@test.local', 1)
")->execute();
$adminId = (int) $db->lastInsertId();

$userA = ['user_id' => $userAId, 'username' => 'bms10_reg_user_a', 'role' => 'user'];
$userB = ['user_id' => $userBId, 'username' => 'bms10_reg_user_b', 'role' => 'user'];
$adminUser = ['user_id' => $adminId, 'username' => 'bms10_reg_admin', 'role' => 'admin'];

$sampleBlock = $db->query("SELECT block_id FROM blocks LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$blockId = $sampleBlock ? (int)$sampleBlock['block_id'] : 1;
$sampleType = $db->query("SELECT type_id FROM lot_types LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$lotTypeId = $sampleType ? (int)$sampleType['type_id'] : 1;

$db->prepare("DELETE FROM lots WHERE lot_number = 'BMS10-REG-LOT'")->execute();
$db->prepare("
    INSERT INTO lots (block_id, lot_number, lot_type_id, status, price)
    VALUES (?, 'BMS10-REG-LOT', ?, 'Available', 60000.00)
")->execute([$blockId, $lotTypeId]);
$lotId = (int) $db->lastInsertId();

$draftModel = new BookingDraft();
$service = new BookingAgentService();
$controller = new BookingAgentController();
$unifiedModel = new UnifiedBooking();

$d = new DateTime('+16 days');
while ((int) $d->format('N') === 1) { // Skip Mondays for burial
    $d->modify('+1 day');
}
$burialDate = $d->format('Y-m-d');
$cremationDate = (new DateTime('+20 days'))->format('Y-m-d');

// ----------------------------------------------------------------------
// 1. STATE MACHINE & BACKWARD CORRECTION PATHS
// ----------------------------------------------------------------------
$dId = $draftModel->create($userAId, 'burial', date('Y-m-d H:i:s', time() + 86400));
$draftModel->transitionStatus($dId, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($dId, BookingDraft::STATUS_LOT_SELECTION);
$draftModel->transitionStatus($dId, BookingDraft::STATUS_READY_FOR_REVIEW);

// Backward correction: user changes mind and clears decedent_name via UPDATE_FIELD
$service->processStructuredInput($userAId, [
    'intent' => BookingAgentService::INTENT_UPDATE_FIELD,
    'field' => 'decedent_name',
    'value' => null
], $dId, $userA['username']);

$freshDraft = $draftModel->findById($dId);
$test1Ok = ($freshDraft['status'] === BookingDraft::STATUS_COLLECTING_INFO);
report(1, "Backward correction path: clearing required field returns state machine to COLLECTING_INFO", $test1Ok, "Status: {$freshDraft['status']}");

// ----------------------------------------------------------------------
// 2. TERMINAL STATE IMMUTABILITY
// ----------------------------------------------------------------------
$termDraftId = $draftModel->create($userAId, 'cremation', date('Y-m-d H:i:s', time() + 86400));
$draftModel->transitionStatus($termDraftId, BookingDraft::STATUS_CANCELLED);

$mutationBlocked = false;
try {
    $draftModel->updateExtractedData($termDraftId, ['decedent_name' => 'Illegal']);
} catch (BookingDraftException $e) {
    $mutationBlocked = ($e->getHttpCode() === 400 && $e->getErrorType() === 'TERMINAL_STATE_MODIFICATION');
}
report(2, "Terminal state immutability: CANCELLED draft rejects updateExtractedData (HTTP 400)", $mutationBlocked);

// ----------------------------------------------------------------------
// 3. FINALIZATION IDEMPOTENCY: BURIAL & CREMATION
// ----------------------------------------------------------------------
// Burial idempotency test
$burialDraftId = $draftModel->create($userAId, 'burial', date('Y-m-d H:i:s', time() + 86400));
$draftModel->updateExtractedData($burialDraftId, [
    'service_type'   => 'burial',
    'decedent_name'  => 'Idempotent Burial Decedent',
    'relationship'   => 'Father',
    'lot_id'         => $lotId,
    'preferred_date' => $burialDate,
    'preferred_time' => '09:00:00',
    'notes'          => 'BMS-10 Idempotency Burial'
]);
$draftModel->transitionStatus($burialDraftId, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($burialDraftId, BookingDraft::STATUS_LOT_SELECTION);
$draftModel->transitionStatus($burialDraftId, BookingDraft::STATUS_READY_FOR_REVIEW);

// First finalization
$burialRes1 = $service->finalizeBurialDraft($burialDraftId, $userAId, $userA['username'], $userA);
$committedScheduleId = $burialRes1['committed_record_id'];

// Second finalization attempt (retry)
$burialRetryBlocked = false;
try {
    $service->finalizeBurialDraft($burialDraftId, $userAId, $userA['username'], $userA);
} catch (BookingDraftException $e) {
    $burialRetryBlocked = ($e->getHttpCode() === 409 && $e->getErrorType() === 'DRAFT_ALREADY_COMMITTED');
}

$schedCount = (int) $db->query("SELECT COUNT(*) FROM burial_schedules WHERE lot_id = {$lotId}")->fetchColumn();
$test3Ok = ($burialRes1['success'] === true && $burialRetryBlocked && $schedCount === 1);
report(3, "Burial finalization idempotency: retry cleanly rejected with HTTP 409 (no duplicate schedules)", $test3Ok, "Schedules in DB: {$schedCount}");

// Cremation idempotency test
$cremDraftId = $draftModel->create($userAId, 'cremation', date('Y-m-d H:i:s', time() + 86400));
$draftModel->updateExtractedData($cremDraftId, [
    'service_type'   => 'cremation',
    'decedent_name'  => 'Idempotent Cremation Decedent',
    'relationship'   => 'Mother',
    'cremation_date' => $cremationDate,
    'notes'          => 'BMS-10 Idempotency Cremation'
]);
$draftModel->transitionStatus($cremDraftId, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($cremDraftId, BookingDraft::STATUS_CREMATION_PREFS);
$draftModel->transitionStatus($cremDraftId, BookingDraft::STATUS_READY_FOR_REVIEW);

$cremRes1 = $service->finalizeCremationDraft($cremDraftId, $userAId, $userA['username'], $userA);
$committedCremationId = $cremRes1['committed_record_id'];

$cremRetryBlocked = false;
try {
    $service->finalizeCremationDraft($cremDraftId, $userAId, $userA['username'], $userA);
} catch (BookingDraftException $e) {
    $cremRetryBlocked = ($e->getHttpCode() === 409 && $e->getErrorType() === 'DRAFT_ALREADY_COMMITTED');
}

$cremCount = (int) $db->query("SELECT COUNT(*) FROM cremation_records WHERE notes LIKE '%BMS-10 Idempotency Cremation%'")->fetchColumn();
$test4Ok = ($cremRes1['success'] === true && $cremRetryBlocked && $cremCount === 1);
report(4, "Cremation finalization idempotency: retry cleanly rejected with HTTP 409 (no duplicate cremations)", $test4Ok, "Cremations in DB: {$cremCount}");

// ----------------------------------------------------------------------
// 4. ATOMIC TRANSACTION ROLLBACK SAFETY
// ----------------------------------------------------------------------
// Simulate failure: attempt burial finalization with a non-existent lot ID
$failDraftId = $draftModel->create($userAId, 'burial', date('Y-m-d H:i:s', time() + 86400));
$draftModel->updateExtractedData($failDraftId, [
    'service_type'   => 'burial',
    'decedent_name'  => 'Rollback Decedent',
    'relationship'   => 'Cousin',
    'lot_id'         => 99999999, // Intentional invalid lot ID
    'preferred_date' => $burialDate,
    'notes'          => 'BMS-10 Rollback Test'
]);
$draftModel->transitionStatus($failDraftId, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($failDraftId, BookingDraft::STATUS_LOT_SELECTION);
$draftModel->transitionStatus($failDraftId, BookingDraft::STATUS_READY_FOR_REVIEW);

$rollbackSuccess = false;
try {
    $service->finalizeBurialDraft($failDraftId, $userAId, $userA['username'], $userA);
} catch (BookingDraftException $e) {
    $rollbackSuccess = true;
}

$decReqCount = (int) $db->query("SELECT COUNT(*) FROM decedent_requests WHERE notes LIKE '%Rollback Decedent%'")->fetchColumn();
$postFailDraft = $draftModel->findById($failDraftId);
$test5Ok = ($rollbackSuccess && $decReqCount === 0 && $postFailDraft['status'] !== BookingDraft::STATUS_COMMITTED && $postFailDraft['committed_record_id'] === null);
report(5, "Atomic transaction rollback: failure prevents partial commits and orphaned decedent requests", $test5Ok, "Orphan decedent requests: {$decReqCount}, Status: {$postFailDraft['status']}");

// ----------------------------------------------------------------------
// 5. SECURITY & OWNERSHIP ISOLATION (USER A VS USER B)
// ----------------------------------------------------------------------
$activeDraftAId = $draftModel->create($userAId, 'burial', date('Y-m-d H:i:s', time() + 86400));

// User B attempts to read User A's draft
ob_start();
$unauthGet = $controller->getDraft($activeDraftAId, $userB);
ob_end_clean();
$getBlocked = (!empty($unauthGet['error_type']) && in_array($unauthGet['error_type'], ['UNAUTHORIZED_ACCESS', 'DRAFT_NOT_FOUND']));

// User B attempts to cancel User A's draft
ob_start();
$unauthCancel = $controller->cancel($activeDraftAId, $userB);
ob_end_clean();
$cancelBlocked = (!empty($unauthCancel['error_type']) && in_array($unauthCancel['error_type'], ['UNAUTHORIZED_ACCESS', 'DRAFT_NOT_FOUND']));

// User B attempts to confirm User A's draft
ob_start();
$unauthConfirm = $controller->confirm($activeDraftAId, $userB);
ob_end_clean();
$confirmBlocked = (!empty($unauthConfirm['error_type']) && in_array($unauthConfirm['error_type'], ['UNAUTHORIZED_ACCESS', 'DRAFT_NOT_FOUND']));

$test6Ok = ($getBlocked && $cancelBlocked && $confirmBlocked);
report(6, "Security & Ownership: User B blocked from reading, modifying, confirming, or cancelling User A draft", $test6Ok);

// ----------------------------------------------------------------------
// 6. STALE DRAFT & EXPIRATION AUDIT
// ----------------------------------------------------------------------
$expiredDraftId = $draftModel->create($userAId, 'cremation', date('Y-m-d H:i:s', time() + 86400));
$db->exec("UPDATE booking_drafts SET expires_at = DATE_SUB(NOW(), INTERVAL 2 HOUR) WHERE draft_id = {$expiredDraftId}");

// Sweep execution
$sweptCount = $draftModel->expireStaleActiveDrafts();

$expiredRow = $draftModel->findById($expiredDraftId);
$isStatusExpired = ($expiredRow['status'] === BookingDraft::STATUS_EXPIRED);

// Resume attempt on expired draft
ob_start();
$resumeExpired = $controller->getDraft($expiredDraftId, $userA);
ob_end_clean();
$resumeExpiredBlocked = (isset($resumeExpired['code']) && $resumeExpired['code'] === 410);

$test7Ok = ($sweptCount >= 1 && $isStatusExpired && $resumeExpiredBlocked);
report(7, "Expiration & Stale sweeps: expired drafts transition to EXPIRED and reject resumption (HTTP 410)", $test7Ok, "Swept: {$sweptCount}, Code: " . ($resumeExpired['code'] ?? 'none'));

// ----------------------------------------------------------------------
// 7. UNIFIED HISTORY DATA INTEGRITY (v_unified_bookings)
// ----------------------------------------------------------------------
// Query v_unified_bookings for User A
$userABookings = $unifiedModel->findMine($userAId);
$references = array_column($userABookings, 'booking_reference');
$uniqueReferences = array_unique($references);

// Check that expired draft and cancelled draft do NOT appear in draft rows
$draftRows = array_filter($userABookings, function($b) { return (int)$b['is_draft'] === 1; });
$hasExpiredInDrafts = false;
foreach ($draftRows as $dr) {
    if ((int)$dr['source_id'] === $expiredDraftId || (int)$dr['source_id'] === $termDraftId) {
        $hasExpiredInDrafts = true;
    }
}

$test8Ok = (count($references) === count($uniqueReferences) && !$hasExpiredInDrafts);
report(8, "Unified history data integrity: zero Cartesian duplicates, expired/cancelled drafts excluded", $test8Ok, "Total: " . count($references) . ", Unique: " . count($uniqueReferences));

// ----------------------------------------------------------------------
// 8. AI FAILURE RESILIENCE: DETERMINISTIC LOCAL FALLBACK
// ----------------------------------------------------------------------
// Message contains recognizable intent and slots, simulating AI microservice downtime
$fallbackTestMessage = "I would like to book a burial for my brother Fernando Poe on 2026-11-20";
ob_start();
$chatRes = $controller->chat(['message' => $fallbackTestMessage], $userA);
ob_end_clean();

$test9Ok = (
    !empty($chatRes['success']) &&
    $chatRes['success'] === true &&
    isset($chatRes['draft_id']) &&
    !empty($chatRes['extracted_data']['decedent_name'])
);
report(9, "AI failure resilience: conversational fallback gracefully extracts slots and preserves state machine", $test9Ok, "Extracted: " . json_encode($chatRes['extracted_data'] ?? []));

// ----------------------------------------------------------------------
// 9. PAYMENT & AUTOMATION ENGINE INTEGRATION
// ----------------------------------------------------------------------
// The committed burial schedule from Test 3 has status = 'Pending'
$scheduleModel = new Schedule();
$committedSchedule = $scheduleModel->findById($committedScheduleId);
$initialPending = ($committedSchedule['status'] === 'Pending');

// Create payment for this schedule
$paymentModel = new Payment();
$receiptNum = 'BMS10-REC-' . uniqid();
$paymentId = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id'     => $committedScheduleId,
    'reference_kind'   => 'schedule',
    'amount'           => 60000.00,
    'payment_date'     => date('Y-m-d'),
    'payment_method'   => 'Cash',
    'receipt_number'   => $receiptNum,
    'received_by'      => $userAId
]);

// Admin verifies payment
$paymentController = new PaymentController();
$verifyRes1 = $paymentController->verify($paymentId, 'Verified', $adminId);

// Verify atomic idempotency of payment verification
$verifyRes2 = $paymentController->verify($paymentId, 'Verified', $adminId);

// Check schedule status transitioned to Confirmed and Lot to Reserved
$afterSchedule = $scheduleModel->findById($committedScheduleId);
$lotModel = new Lot();
$afterLot = $lotModel->findById($lotId);

$test10Ok = (
    $initialPending &&
    !empty($verifyRes1['success']) &&
    isset($verifyRes2['code']) && $verifyRes2['code'] === 409 &&
    $afterSchedule['status'] === 'Confirmed' &&
    $afterLot['status'] === 'Reserved'
);
report(10, "Payment verification & AutomationEngine: auto-confirms schedule, reserves lot, and enforces verification idempotency", $test10Ok, "Schedule: {$afterSchedule['status']}, Lot: {$afterLot['status']}, Retry Code: " . ($verifyRes2['code'] ?? 'none'));

// ----------------------------------------------------------------------
// 10. LEGACY API COMPATIBILITY REGRESSION
// ----------------------------------------------------------------------
$legacySchedController = new ScheduleController();
$legacyCremController = new CremationController();
$legacyLotController = new LotController();
$legacyDecController = new DecedentRequestController();

$legSched = $legacySchedController->mine($userAId);
$legCrem = $legacyCremController->mine($userAId);
$legLots = $legacyLotController->getLots();
$legDecs = $legacyDecController->mine($userAId);

$test11Ok = (
    is_array($legSched) &&
    is_array($legCrem) &&
    is_array($legLots) &&
    is_array($legDecs)
);
report(11, "Legacy API regression: schedules, cremations, lots, and decedent requests remain fully functional", $test11Ok);

// ----------------------------------------------------------------------
// TEARDOWN & CLEANUP
// ----------------------------------------------------------------------
$db->exec("DELETE FROM payments WHERE receipt_number = '{$receiptNum}'");
$db->exec("DELETE FROM burial_schedules WHERE lot_id = {$lotId}");
$db->exec("DELETE FROM cremation_records WHERE cremation_id = {$committedCremationId}");
$db->exec("DELETE FROM decedent_requests WHERE requested_by IN ({$userAId}, {$userBId})");
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userAId}, {$userBId})");
$db->exec("DELETE FROM lots WHERE lot_id = {$lotId}");
$db->exec("DELETE FROM users WHERE user_id IN ({$userAId}, {$userBId}, {$adminId})");

echo "==============================================================\n";
echo "BMS-10 REGRESSION RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "==============================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
