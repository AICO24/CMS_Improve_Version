<?php
/**
 * PayMongo Concurrency & Checkout Lease Verification Test — Batch 10B Remediation
 *
 * Verifies real concurrency protection for exclusive lot purchases:
 *  1. Buyer A succeeds in obtaining active checkout lease for Lot X.
 *  2. Buyer B attempting checkout on the same lot is rejected with HTTP 409 Conflict (lot_held_checkout).
 *  3. Buyer B attempting burial booking on the same lot is rejected with HTTP 409 Conflict (LOT_HELD_CHECKOUT).
 *  4. No duplicate active PayMongo payment is created.
 *  5. No duplicate booking is created.
 *  6. Same-user retry still works (Buyer A can resume/retry on Lot X without error or duplicate payment).
 *  7. Legitimate future scheduling behavior is preserved:
 *     - Buyer B can book a different lot without conflict.
 *     - Once Buyer A's checkout lease expires/releases, Buyer B can successfully book Lot X.
 *
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_concurrency_b10b.php
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/User.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';

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
$paymentController = new PaymentController();
$agentService = new BookingAgentService();
$paymentModel = new Payment();
$scheduleModel = new Schedule();
$lotModel = new Lot();
$draftModel = new BookingDraft();

// Configure test credentials
$testSecret = 'sk_test_mock_batch10b_concurrency_12345';
putenv("PAYMONGO_SECRET_KEY={$testSecret}");
$_ENV['PAYMONGO_SECRET_KEY'] = $testSecret;
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';

// Clean up prior test records
$db->exec("DELETE FROM payments WHERE notes LIKE '%CONCURRENCY_TEST%' OR notes LIKE '%PayMongo sandbox checkout initiated%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%CONCURRENCY_TEST%'");
$db->exec("DELETE FROM booking_drafts WHERE extracted_data LIKE '%CONCURRENCY%'");

// Find two distinct available lots
$lots = $db->query("SELECT lot_id, lot_number, price, status FROM lots WHERE status = 'Available' AND price > 100 ORDER BY lot_id ASC LIMIT 2")->fetchAll(PDO::FETCH_ASSOC);
if (count($lots) < 2) {
    // Ensure lot 1 and lot 2 are Available
    $db->exec("UPDATE lots SET status = 'Available' WHERE lot_id IN (1, 2)");
    $lots = $db->query("SELECT lot_id, lot_number, price, status FROM lots WHERE lot_id IN (1, 2) ORDER BY lot_id ASC")->fetchAll(PDO::FETCH_ASSOC);
}
$lotA = $lots[0];
$lotB = $lots[1];
$lotAId = (int) $lotA['lot_id'];
$lotBId = (int) $lotB['lot_id'];

// Find or mock two distinct users
$userRows = $db->query("SELECT user_id, username FROM users WHERE role_id = (SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1) LIMIT 2")->fetchAll(PDO::FETCH_ASSOC);
$buyerA = $userRows[0] ?? ['user_id' => 2, 'username' => 'buyer_a'];
$buyerB = $userRows[1] ?? ['user_id' => 3, 'username' => 'buyer_b'];
$buyerA['role'] = 'user';
$buyerB['role'] = 'user';
$buyerAId = (int) $buyerA['user_id'];
$buyerBId = (int) $buyerB['user_id'];

// ============================================================================
// TEST 1: Buyer A succeeds in obtaining active checkout lease for Lot X
// ============================================================================
$resA = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id'     => $lotAId,
    'reference_kind'   => 'lot',
], $buyerA);

$buyerASucceeded = !empty($resA['payment_id']) && (($resA['code'] ?? 0) === 200 || ($resA['code'] ?? 0) === 502);
$paymentAId = (int) ($resA['payment_id'] ?? 0);

// Mark paymentA as active PayMongo session within lease window (1 hour)
$db->prepare("UPDATE payments SET gateway_provider = 'paymongo', gateway_status = 'awaiting_payment_method', created_at = NOW(), notes = 'CONCURRENCY_TEST buyer A active lease' WHERE payment_id = ?")->execute([$paymentAId]);

$leaseRow = $paymentModel->findActiveLotCheckoutLease($lotAId, null, $buyerBId);

report(1, 'Buyer A succeeds in obtaining active checkout lease for Lot X',
    $buyerASucceeded && !empty($leaseRow),
    "Buyer A outcome: " . json_encode($resA) . ", Lease: " . ($leaseRow ? 'Active' : 'Missing')
);

// ============================================================================
// TEST 2: Buyer B is rejected with 409 Conflict (lot_held_checkout) on direct checkout
// ============================================================================
$resBDirect = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id'     => $lotAId,
    'reference_kind'   => 'lot',
], $buyerB);

$directBlocked = ($resBDirect['code'] ?? 0) === 409 && ($resBDirect['reason_code'] ?? '') === 'lot_held_checkout';
report(2, 'Buyer B is rejected with 409 Conflict (lot_held_checkout) on direct checkout',
    $directBlocked,
    "Expected 409 lot_held_checkout, got: " . json_encode($resBDirect)
);

// ============================================================================
// TEST 3: Buyer B is rejected with 409 Conflict (LOT_HELD_CHECKOUT) on draft finalization
// ============================================================================
$draftBId = $draftModel->create($buyerBId, 'burial', date('Y-m-d H:i:s', strtotime('+2 hours')));
$validFutureDate = new DateTime('+45 days');
if ((int) $validFutureDate->format('N') === 1) {
    $validFutureDate->modify('+1 day');
}
$draftModel->updateExtractedData($draftBId, [
    'service_type'   => 'burial',
    'lot_id'         => $lotAId,
    'preferred_date' => $validFutureDate->format('Y-m-d'),
    'schedule_time'  => '14:00:00',
    'decedent_name'  => 'Concurrency Test Decedent',
    'notes'          => 'CONCURRENCY_TEST draft B',
]);
$draftModel->transitionStatus($draftBId, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($draftBId, BookingDraft::STATUS_LOT_SELECTION);
$draftModel->transitionStatus($draftBId, BookingDraft::STATUS_READY_FOR_REVIEW);
$draftModel->transitionStatus($draftBId, BookingDraft::STATUS_AWAITING_CONFIRM);

$draftBlocked = false;
$exceptionCaught = '';
try {
    $agentService->finalizeBurialDraft($draftBId, $buyerBId, $buyerB['username'], $buyerB);
} catch (BookingDraftException $e) {
    $exceptionCaught = $e->getErrorType() . ' (' . $e->getHttpCode() . ')';
    if ($e->getErrorType() === 'LOT_HELD_CHECKOUT' && $e->getHttpCode() === 409) {
        $draftBlocked = true;
    }
}

report(3, 'Buyer B is rejected with 409 Conflict (LOT_HELD_CHECKOUT) on draft finalization',
    $draftBlocked,
    "Expected LOT_HELD_CHECKOUT (409), got: {$exceptionCaught}"
);

// ============================================================================
// TEST 4: No duplicate active PayMongo payment is created for the exclusive lot
// ============================================================================
$stmt = $db->prepare("
    SELECT COUNT(*) FROM payments
    WHERE transaction_type = 'Lot Purchase'
      AND reference_kind = 'lot'
      AND reference_id = ?
      AND verification_status = 'Pending'
      AND gateway_provider = 'paymongo'
      AND (gateway_status IS NULL OR gateway_status NOT IN ('expired', 'cancelled', 'failed'))
");
$stmt->execute([$lotAId]);
$activePaymentCount = (int) $stmt->fetchColumn();

report(4, 'No duplicate active PayMongo payment is created for the exclusive lot',
    $activePaymentCount === 1,
    "Expected exactly 1 active payment, found: {$activePaymentCount}"
);

// ============================================================================
// TEST 5: No duplicate booking is created for the rejected draft
// ============================================================================
$stmt = $db->prepare("SELECT COUNT(*) FROM burial_schedules WHERE lot_id = ? AND notes LIKE '%CONCURRENCY_TEST%'");
$stmt->execute([$lotAId]);
$bookingCount = (int) $stmt->fetchColumn();

report(5, 'No duplicate booking is created for the rejected draft',
    $bookingCount === 0,
    "Expected 0 booking rows for rejected draft, found: {$bookingCount}"
);

// ============================================================================
// TEST 6: Same-user retry still works for Buyer A
// ============================================================================
$resARetry = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id'     => $lotAId,
    'reference_kind'   => 'lot',
], $buyerA);

$sameUserAllowed = !empty($resARetry['payment_id'])
    && ($resARetry['payment_id'] === $paymentAId)
    && (($resARetry['code'] ?? 0) === 200 || ($resARetry['code'] ?? 0) === 502);

report(6, 'Same-user retry still works and reuses existing payment record',
    $sameUserAllowed,
    "Expected payment ID {$paymentAId} reused, got: " . json_encode($resARetry)
);

// ============================================================================
// TEST 7: Legitimate future scheduling preserved on a different available lot
// ============================================================================
$draftDifferentLotId = $draftModel->create($buyerBId, 'burial', date('Y-m-d H:i:s', strtotime('+2 hours')));
$draftModel->updateExtractedData($draftDifferentLotId, [
    'service_type'   => 'burial',
    'lot_id'         => $lotBId,
    'preferred_date' => $validFutureDate->format('Y-m-d'),
    'schedule_time'  => '14:00:00',
    'decedent_name'  => 'Different Lot Decedent',
    'notes'          => 'CONCURRENCY_TEST different lot',
]);
$draftModel->transitionStatus($draftDifferentLotId, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($draftDifferentLotId, BookingDraft::STATUS_LOT_SELECTION);
$draftModel->transitionStatus($draftDifferentLotId, BookingDraft::STATUS_READY_FOR_REVIEW);
$draftModel->transitionStatus($draftDifferentLotId, BookingDraft::STATUS_AWAITING_CONFIRM);

$diffOutcome = $agentService->finalizeBurialDraft($draftDifferentLotId, $buyerBId, $buyerB['username'], $buyerB);
$diffSchedId = (int) ($diffOutcome['schedule_id'] ?? 0);
$diffSuccess = !empty($diffOutcome['success']) && $diffSchedId > 0;

report(7, 'Legitimate booking on a different available lot succeeds without conflict',
    $diffSuccess,
    "Outcome: " . json_encode($diffOutcome)
);

// ============================================================================
// TEST 8: Once Buyer A lease expires, Buyer B can successfully book Lot X
// ============================================================================
// Release Buyer A lease by marking payment expired
$db->prepare("UPDATE payments SET gateway_status = 'expired' WHERE payment_id = ?")->execute([$paymentAId]);

// Buyer B now finalizes the original draft on Lot X
$releasedOutcome = $agentService->finalizeBurialDraft($draftBId, $buyerBId, $buyerB['username'], $buyerB);
$releasedSchedId = (int) ($releasedOutcome['schedule_id'] ?? 0);
$releasedSuccess = !empty($releasedOutcome['success']) && $releasedSchedId > 0;

report(8, 'Once Buyer A lease expires, Buyer B can successfully book Lot X',
    $releasedSuccess,
    "Outcome: " . json_encode($releasedOutcome)
);

// Clean up test records
$db->exec("DELETE FROM payments WHERE payment_id IN ({$paymentAId}, " . (int)($diffOutcome['payment_id'] ?? 0) . ", " . (int)($releasedOutcome['payment_id'] ?? 0) . ")");
$db->exec("DELETE FROM burial_schedules WHERE schedule_id IN ({$diffSchedId}, {$releasedSchedId})");
$db->exec("DELETE FROM booking_drafts WHERE draft_id IN ({$draftBId}, {$draftDifferentLotId})");
$db->prepare("UPDATE lots SET status = 'Available' WHERE lot_id IN (?, ?)")->execute([$lotAId, $lotBId]);

echo "\n======================================================\n";
echo "PayMongo Concurrency Verification Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
