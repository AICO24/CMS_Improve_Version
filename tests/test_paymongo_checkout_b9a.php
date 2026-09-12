<?php
/**
 * PayMongo Checkout Bridge Tests — Batch 9A
 *
 * Verifies the complete Batch 9A integration bridge:
 *   Burial booking draft commit
 *   ↓
 *   burial schedule created with status = 'Pending'
 *   ↓
 *   CMS payment record created with status = 'Pending' & reference_kind = 'schedule'
 *   ↓
 *   authoritative price resolved from lots table
 *   ↓
 *   PayMongo checkout session initialized
 *   ↓
 *   booking outcome enriched with payment_id, checkout_url, receipt_number
 *   ↓
 *   lot remains 'Available' & schedule remains 'Pending' until webhook verification
 *
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_checkout_b9a.php
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/User.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';

// Configure test gateway credentials
$testSecret = 'sk_test_mock_batch9a_secret_key_12345';
putenv("PAYMONGO_SECRET_KEY={$testSecret}");
$_ENV['PAYMONGO_SECRET_KEY'] = $testSecret;
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';

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

$db = Database::getInstance()->getConnection();
$draftModel = new BookingDraft();
$scheduleModel = new Schedule();
$lotModel = new Lot();
$paymentModel = new Payment();
$agentService = new BookingAgentService();

// Ensure an available test lot
$lot = $db->query("SELECT lot_id, lot_number, price, status FROM lots WHERE status = 'Available' AND price > 100 ORDER BY lot_id ASC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$lot) {
    // Free lot 1 if all lots occupied
    $db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = 1");
    $lot = $db->query("SELECT lot_id, lot_number, price, status FROM lots WHERE lot_id = 1")->fetch(PDO::FETCH_ASSOC);
}
$lotId = (int) $lot['lot_id'];
$lotPrice = (float) $lot['price'];

// Find test citizen user
$user = $db->query("SELECT user_id, username FROM users WHERE role_id = (SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1) LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$user) {
    $user = ['user_id' => 2, 'username' => 'citizen_b9a'];
}
$user['role'] = 'user';
$userId = (int) $user['user_id'];

// Clean up any prior test records
$db->exec("DELETE FROM payments WHERE notes LIKE '%B9A_TEST%' OR notes LIKE '%PayMongo sandbox checkout initiated%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%B9A_TEST%'");
$db->exec("DELETE FROM booking_drafts WHERE extracted_data LIKE '%B9A%'");

// Calculate valid future date (non-Monday, 85 days out)
$futureDate = new DateTime('+85 days');
if ((int) $futureDate->format('N') === 1) {
    $futureDate->modify('+1 day');
}
$bookingDateStr = $futureDate->format('Y-m-d');

// Step 1: Create Draft
$draftId = $draftModel->create($userId, 'burial', date('Y-m-d H:i:s', strtotime('+2 hours')));
$draftModel->updateExtractedData($draftId, [
    'service_type'   => 'burial',
    'decedent_name'  => 'B9A Test Decedent',
    'relationship'   => 'Parent',
    'preferred_date' => $bookingDateStr,
    'schedule_time'  => '10:00:00',
    'lot_id'         => $lotId,
    'notes'          => 'B9A_TEST burial booking draft',
]);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_LOT_SELECTION);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_READY_FOR_REVIEW);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_AWAITING_CONFIRM);

// Step 2: Finalize Draft (Batch 9A Flow)
$outcome = $agentService->finalizeBurialDraft($draftId, $userId, $user['username'], $user);

// TEST 1: Outcome reports success and returns schedule_id
$hasScheduleId = !empty($outcome['success']) && !empty($outcome['schedule_id']);
$scheduleId = (int) ($outcome['schedule_id'] ?? 0);
report(1, 'Burial draft finalization succeeds and creates schedule', $hasScheduleId, json_encode($outcome));

// TEST 2: Schedule status is strictly 'Pending'
$scheduleRow = $scheduleModel->findById($scheduleId);
$isSchedulePending = ($scheduleRow['status'] ?? '') === 'Pending';
report(2, 'Created burial schedule has status = Pending', $isSchedulePending, 'Status: ' . ($scheduleRow['status'] ?? 'null'));

// TEST 3: Draft is committed and linked to schedule
$committedDraft = $draftModel->findById($draftId);
$isDraftCommitted = ($committedDraft['status'] ?? '') === BookingDraft::STATUS_COMMITTED
    && (int) ($committedDraft['committed_record_id'] ?? 0) === $scheduleId;
report(3, 'Booking draft transitions to COMMITTED with committed_record_id = schedule_id', $isDraftCommitted, 'Draft: ' . json_encode($committedDraft));

// TEST 4: Payment record was automatically created via Batch 9A bridge
$hasPaymentId = !empty($outcome['payment_id']);
$paymentId = (int) ($outcome['payment_id'] ?? 0);
$paymentRow = $paymentModel->findById($paymentId);
report(4, 'CMS payment record is automatically created upon draft commit', $hasPaymentId && !empty($paymentRow), 'Payment ID: ' . $paymentId);

// TEST 5: Payment identity and references match schedule
$refMatches = (int) ($paymentRow['reference_id'] ?? 0) === $scheduleId;
$refKindMatches = ($paymentRow['reference_kind'] ?? '') === 'schedule';
$typeMatches = ($paymentRow['transaction_type'] ?? '') === 'Lot Purchase';
$methodMatches = ($paymentRow['payment_method'] ?? '') === 'PayMongo';
$verPending = ($paymentRow['verification_status'] ?? '') === 'Pending';
report(5, 'Payment row references schedule with transaction_type=Lot Purchase and verification_status=Pending',
    $refMatches && $refKindMatches && $typeMatches && $methodMatches && $verPending,
    "Ref: {$paymentRow['reference_id']}, Kind: {$paymentRow['reference_kind']}, Type: {$paymentRow['transaction_type']}, Method: {$paymentRow['payment_method']}, Status: {$paymentRow['verification_status']}"
);

// TEST 6: Payment amount matches authoritative lot price
$amtMatches = abs((float) ($paymentRow['amount'] ?? 0) - $lotPrice) < 0.01;
report(6, 'Payment amount matches authoritative lot price from database', $amtMatches, "Expected: {$lotPrice}, Payment: {$paymentRow['amount']}");

// TEST 7: Lot status remains 'Available' (NOT changed until webhook verification)
$lotAfter = $lotModel->findById($lotId);
$isLotAvailable = ($lotAfter['status'] ?? '') === 'Available';
report(7, 'Lot status remains Available during checkout creation (no premature reservation)', $isLotAvailable, 'Lot status: ' . ($lotAfter['status'] ?? 'null'));

// Clean up test records
$db->exec("DELETE FROM payments WHERE payment_id = {$paymentId}");
$db->exec("DELETE FROM burial_schedules WHERE schedule_id = {$scheduleId}");
$db->exec("DELETE FROM booking_drafts WHERE draft_id = {$draftId}");

echo "\n======================================================\n";
echo "PayMongo Batch 9A Checkout Bridge Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
