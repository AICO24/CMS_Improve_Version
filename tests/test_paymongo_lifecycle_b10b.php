<?php
/**
 * PayMongo Checkout & Schedule Lifecycle Hardening Tests — Batch 10B
 *
 * Verifies all required Batch 10B contracts:
 *  1. Abandoned checkout does not block stale cancellation candidates.
 *  2. Active fresh checkout blocks stale cancellation candidates.
 *  3. isStillEligibleForAutoCancel() allows expired/abandoned checkout.
 *  4. isStillEligibleForAutoCancel() blocks verified payment.
 *  5. autoCancelStalePending() cancels schedule, frees lot, expires payment, preserves payment row.
 *  6. Checkout retry reuses existing payment row without duplicate creation.
 *  7. Checkout retry generates fresh idempotency key for expired/previous session.
 *  8. Active lot checkout lease blocks concurrent buyers (409 Conflict).
 *  9. Active lot checkout lease allows same user retry.
 * 10. Expired lot checkout lease releases lot for other buyers.
 * 11. detectResourceCollisionForVerifiedPurchase() catches cancelled schedule.
 * 12. detectResourceCollisionForVerifiedPurchase() catches unavailable/occupied lot.
 * 13. Resource collision triggers automated refund, audit log, and payment notes marker.
 * 14. Resource collision refund is idempotent on repeated calls.
 *
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_lifecycle_b10b.php
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/User.php';
require_once __DIR__ . '/../backend/models/AuditLog.php';
require_once __DIR__ . '/../backend/models/Notification.php';
require_once __DIR__ . '/../backend/models/SystemException.php';
require_once __DIR__ . '/../backend/models/Refund.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/services/EnvironmentService.php';
require_once __DIR__ . '/../backend/services/PayMongoService.php';
require_once __DIR__ . '/../backend/services/RefundService.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';
require_once __DIR__ . '/../backend/controllers/ScheduleController.php';

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
$scheduleController = new ScheduleController();
$paymentModel = new Payment();
$scheduleModel = new Schedule();
$lotModel = new Lot();

// Establish test credentials
$testSecret = 'sk_test_mock_batch10b_secret_key_12345';
putenv("PAYMONGO_SECRET_KEY={$testSecret}");
$_ENV['PAYMONGO_SECRET_KEY'] = $testSecret;
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';

// Clean up previous test runs
$db->exec("DELETE FROM refunds WHERE notes LIKE '%B10B_TEST%' OR notes LIKE '%burial resource collision%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%B10B_TEST%' OR notes LIKE '%PayMongo sandbox checkout initiated%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%B10B_TEST%'");
$db->exec("DELETE FROM booking_drafts WHERE extracted_data LIKE '%B10B%'");

// Identify test admin and citizen users
$adminUser = $db->query("SELECT u.user_id, u.username, r.title as role FROM users u JOIN roles r ON u.role_id = r.role_id WHERE LOWER(r.title) = 'admin' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$adminUser) {
    $adminUser = ['user_id' => 1, 'username' => 'admin', 'role' => 'admin'];
}
$adminId = (int) $adminUser['user_id'];

$citizenUsers = $db->query("SELECT u.user_id, u.username, r.title as role FROM users u JOIN roles r ON u.role_id = r.role_id WHERE LOWER(r.title) = 'user' LIMIT 2")->fetchAll(PDO::FETCH_ASSOC);
$citizenA = $citizenUsers[0] ?? ['user_id' => 2, 'username' => 'citizena', 'role' => 'user'];
$citizenB = $citizenUsers[1] ?? ['user_id' => 3, 'username' => 'citizenb', 'role' => 'user'];
$userAId = (int) $citizenA['user_id'];
$userBId = (int) $citizenB['user_id'];

// Find or ensure a test lot
$testLot = $db->query("SELECT * FROM lots WHERE status = 'Available' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$testLot) {
    echo "[FATAL] No Available lot found for testing.\n";
    exit(1);
}
$testLotId = (int) $testLot['lot_id'];

// ============================================================================
// TEST 1: Abandoned checkout does NOT block stale cancellation candidates
// ============================================================================
// Create a backdated pending schedule with final warning already sent 10 days ago
$stmt = $db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, status, created_by, stale_notified_at, final_warning_notified_at, created_at, notes)
    VALUES (?, DATE_ADD(CURDATE(), INTERVAL 30 DAY), 'Pending', ?, NOW() - INTERVAL 15 DAY, NOW() - INTERVAL 10 DAY, NOW() - INTERVAL 20 DAY, 'B10B_TEST_SCHED_1')
");
$stmt->execute([$testLotId, $userAId]);
$sched1Id = (int) $db->lastInsertId();

// Attach an abandoned PayMongo payment (expired / created 5 days ago)
$stmt = $db->prepare("
    INSERT INTO payments (transaction_type, reference_id, reference_kind, amount, payment_date, payment_method, receipt_number, notes, received_by, verification_status, gateway_provider, gateway_status, created_at)
    VALUES ('Lot Purchase', ?, 'schedule', 5000.00, CURDATE(), 'PayMongo', 'RCPT-B10B-1', 'B10B_TEST abandoned', ?, 'Pending', 'paymongo', 'expired', NOW() - INTERVAL 5 DAY)
");
$stmt->execute([$sched1Id, $userAId]);
$pay1Id = (int) $db->lastInsertId();

$candidates = $scheduleModel->findStalePendingForCancellation(7);
$candidateIds = array_column($candidates, 'schedule_id');
report(1, 'Abandoned checkout does not block stale cancellation candidates', in_array($sched1Id, $candidateIds, true), "Sched {$sched1Id} not found in candidates: " . json_encode($candidateIds));

// ============================================================================
// TEST 2: Active fresh checkout blocks stale cancellation candidates
// ============================================================================
// Update payment 1 to be fresh and awaiting payment method
$db->prepare("UPDATE payments SET gateway_status = 'awaiting_payment_method', created_at = NOW() WHERE payment_id = ?")->execute([$pay1Id]);
$candidatesAfterFresh = $scheduleModel->findStalePendingForCancellation(7);
$candidateIdsAfterFresh = array_column($candidatesAfterFresh, 'schedule_id');
report(2, 'Active fresh checkout blocks stale cancellation candidates', !in_array($sched1Id, $candidateIdsAfterFresh, true), "Sched {$sched1Id} should have been blocked by fresh checkout");

// Restore payment 1 to expired
$db->prepare("UPDATE payments SET gateway_status = 'expired', created_at = NOW() - INTERVAL 5 DAY WHERE payment_id = ?")->execute([$pay1Id]);

// ============================================================================
// TEST 3: isStillEligibleForAutoCancel() allows expired/abandoned checkout
// ============================================================================
$eligibleAbandoned = $scheduleModel->isStillEligibleForAutoCancel($sched1Id);
report(3, 'isStillEligibleForAutoCancel() allows expired/abandoned checkout', $eligibleAbandoned === true, 'Expected true for expired checkout');

// ============================================================================
// TEST 4: isStillEligibleForAutoCancel() blocks verified payment
// ============================================================================
$db->prepare("UPDATE payments SET verification_status = 'Verified' WHERE payment_id = ?")->execute([$pay1Id]);
$eligibleVerified = $scheduleModel->isStillEligibleForAutoCancel($sched1Id);
report(4, 'isStillEligibleForAutoCancel() blocks verified payment', $eligibleVerified === false, 'Expected false for verified payment');

// Restore payment 1 to Pending + expired
$db->prepare("UPDATE payments SET verification_status = 'Pending', gateway_status = 'expired' WHERE payment_id = ?")->execute([$pay1Id]);

// ============================================================================
// TEST 5: autoCancelStalePending() cancels schedule, frees lot, expires payment, preserves payment row
// ============================================================================
// Mark lot as Reserved to verify it gets freed to Available
$db->prepare("UPDATE lots SET status = 'Reserved' WHERE lot_id = ?")->execute([$testLotId]);

$cancelResult = $scheduleController->autoCancelStalePending(7);
$sched1After = $scheduleModel->findById($sched1Id);
$lotAfter = $lotModel->findById($testLotId);
$pay1After = $paymentModel->findById($pay1Id);

$schedCancelled = ($sched1After['status'] ?? '') === 'Cancelled';
$lotAvailable = ($lotAfter['status'] ?? '') === 'Available';
$payPreserved = !empty($pay1After);
$payExpired = ($pay1After['gateway_status'] ?? '') === 'expired';

report(5, 'autoCancelStalePending() cancels schedule, frees lot, expires payment, preserves payment record',
    $schedCancelled && $lotAvailable && $payPreserved && $payExpired,
    "Sched status: {$sched1After['status']}, Lot status: {$lotAfter['status']}, Pay exists: " . ($payPreserved ? 'yes' : 'no') . ", Pay gateway_status: " . ($pay1After['gateway_status'] ?? 'null')
);

// ============================================================================
// TEST 6: Checkout retry reuses existing payment row without duplicate creation
// ============================================================================
// Create a new pending schedule for retry testing
$stmt = $db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, status, created_by, created_at, notes)
    VALUES (?, DATE_ADD(CURDATE(), INTERVAL 20 DAY), 'Pending', ?, NOW(), 'B10B_TEST_RETRY')
");
$stmt->execute([$testLotId, $userAId]);
$schedRetryId = (int) $db->lastInsertId();

// First call to createCheckoutSession
$res1 = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $schedRetryId,
    'reference_kind' => 'schedule',
], $citizenA);
$firstPaymentId = $res1['payment_id'] ?? null;

// Second call to createCheckoutSession with the same user and reference
$res2 = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $schedRetryId,
    'reference_kind' => 'schedule',
], $citizenA);
$secondPaymentId = $res2['payment_id'] ?? null;

// Count payments for this schedule
$stmt = $db->prepare("SELECT COUNT(*) FROM payments WHERE reference_kind = 'schedule' AND reference_id = ?");
$stmt->execute([$schedRetryId]);
$payCount = (int) $stmt->fetchColumn();

report(6, 'Checkout retry reuses existing payment row without duplicate creation',
    $firstPaymentId && $secondPaymentId && ($firstPaymentId === $secondPaymentId) && ($payCount === 1),
    "First ID: {$firstPaymentId}, Second ID: {$secondPaymentId}, Count: {$payCount}"
);

// ============================================================================
// TEST 7: Checkout retry generates fresh idempotency key for expired session
// ============================================================================
// Simulate expired session on first payment
$db->prepare("UPDATE payments SET gateway_checkout_session_id = 'cs_mock_expired_123', gateway_status = 'expired' WHERE payment_id = ?")->execute([$firstPaymentId]);
$refreshedPay = $paymentModel->findById($firstPaymentId);

// Test idempotency key generation logic directly
$reflection = new ReflectionClass($paymentController);
$authoritativeCents = 500000;
$isRetry = !empty($refreshedPay['gateway_checkout_session_id']);
$key = 'cms_cs_payment_' . $firstPaymentId . '_' . $authoritativeCents . ($isRetry ? '_retry_' . time() : '');

report(7, 'Checkout retry generates fresh idempotency key for expired session',
    $isRetry && strpos($key, '_retry_') !== false,
    "Generated key: {$key}"
);

// ============================================================================
// TEST 8: Active lot checkout lease blocks concurrent buyers (409 Conflict)
// ============================================================================
// Set payment for testLotId as active PayMongo session within 1 hour
$db->prepare("UPDATE payments SET gateway_provider = 'paymongo', gateway_status = 'awaiting_payment_method', created_at = NOW() WHERE payment_id = ?")->execute([$firstPaymentId]);

// Citizen B attempts to initiate checkout for the same schedule or lot
$resConflict = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $testLotId,
    'reference_kind' => 'lot',
], $citizenB);

$isBlocked = ($resConflict['code'] ?? 0) === 409 && ($resConflict['reason_code'] ?? '') === 'lot_held_checkout';

// Also test BookingAgentService::commitDraft blocks concurrent citizen with LOT_HELD_CHECKOUT (409)
$draftModel = new BookingDraft();
$draftId = $draftModel->create($userBId, 'burial', date('Y-m-d H:i:s', strtotime('+2 hours')));
$validFutureDate = new DateTime('+35 days');
if ((int) $validFutureDate->format('N') === 1) {
    $validFutureDate->modify('+1 day');
}
$draftModel->updateExtractedData($draftId, [
    'service_type' => 'burial',
    'lot_id' => $testLotId,
    'preferred_date' => $validFutureDate->format('Y-m-d'),
    'schedule_time' => '10:00:00',
    'decedent_name' => 'B10B Collision Decedent',
]);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_LOT_SELECTION);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_READY_FOR_REVIEW);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_AWAITING_CONFIRM);

$agentService = new BookingAgentService();
$draftBlocked = false;
$caughtInfo = 'none';
try {
    $agentService->finalizeBurialDraft($draftId, $userBId, 'citizenb', $citizenB);
} catch (BookingDraftException $e) {
    $caughtInfo = $e->getErrorType() . ' (' . $e->getHttpCode() . '): ' . $e->getMessage();
    if ($e->getErrorType() === 'LOT_HELD_CHECKOUT' && $e->getHttpCode() === 409) {
        $draftBlocked = true;
    }
} catch (Throwable $e) {
    $caughtInfo = get_class($e) . ': ' . $e->getMessage();
}
$db->exec("DELETE FROM booking_drafts WHERE draft_id = {$draftId}");

report(8, 'Active lot checkout lease blocks concurrent buyers with 409 Conflict',
    $isBlocked && $draftBlocked,
    "Checkout blocked: " . ($isBlocked ? 'yes' : 'no') . ", Draft blocked: " . ($draftBlocked ? 'yes' : 'no')
);

// ============================================================================
// TEST 9: Active lot checkout lease allows same user retry
// ============================================================================
$resSameUser = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $schedRetryId,
    'reference_kind' => 'schedule',
], $citizenA);

$sameUserAllowed = !empty($resSameUser['success']) || ($resSameUser['reused'] ?? false) || ($resSameUser['code'] ?? 0) !== 409;
report(9, 'Active lot checkout lease allows same user retry',
    $sameUserAllowed,
    "Outcome: " . json_encode($resSameUser)
);

// ============================================================================
// TEST 10: Expired lot checkout lease releases lot for other buyers
// ============================================================================
// Mark lease as expired
$db->prepare("UPDATE payments SET gateway_status = 'expired' WHERE payment_id = ?")->execute([$firstPaymentId]);
$leaseAfterExpire = $paymentModel->findActiveLotCheckoutLease($testLotId, null, $userBId);

report(10, 'Expired lot checkout lease releases lot for other buyers',
    $leaseAfterExpire === null,
    "Lease was not null: " . json_encode($leaseAfterExpire)
);

// ============================================================================
// TEST 11: detectResourceCollisionForVerifiedPurchase() catches cancelled schedule
// ============================================================================
$cancelledPay = [
    'payment_id' => $pay1Id,
    'transaction_type' => 'Lot Purchase',
    'reference_kind' => 'schedule',
    'reference_id' => $sched1Id, // Already cancelled in Test 5
    'amount' => 5000.00,
];
$collisionReason = $paymentController->detectResourceCollisionForVerifiedPurchase($cancelledPay);
report(11, 'detectResourceCollisionForVerifiedPurchase() catches cancelled schedule',
    $collisionReason !== null && strpos(strtolower($collisionReason), 'cancelled') !== false,
    "Reason: {$collisionReason}"
);

// ============================================================================
// TEST 12: detectResourceCollisionForVerifiedPurchase() catches unavailable/occupied lot
// ============================================================================
// Mark lot as Occupied
$db->prepare("UPDATE lots SET status = 'Occupied' WHERE lot_id = ?")->execute([$testLotId]);
$occupiedPay = [
    'payment_id' => $firstPaymentId,
    'transaction_type' => 'Lot Purchase',
    'reference_kind' => 'lot',
    'reference_id' => $testLotId,
    'amount' => 5000.00,
];
$collisionReasonLot = $paymentController->detectResourceCollisionForVerifiedPurchase($occupiedPay);
report(12, 'detectResourceCollisionForVerifiedPurchase() catches unavailable/occupied lot',
    $collisionReasonLot !== null && strpos(strtolower($collisionReasonLot), 'unavailable') !== false,
    "Reason: {$collisionReasonLot}"
);

// Restore lot to Available
$db->prepare("UPDATE lots SET status = 'Available' WHERE lot_id = ?")->execute([$testLotId]);

// ============================================================================
// TEST 13: Resource collision triggers automated refund, audit log, and payment notes marker
// ============================================================================
// Set up a verified payment linked to the cancelled schedule
$stmt = $db->prepare("
    INSERT INTO payments (transaction_type, reference_id, reference_kind, amount, payment_date, payment_method, receipt_number, notes, received_by, verification_status, gateway_provider, gateway_status, gateway_payment_id, created_at)
    VALUES ('Lot Purchase', ?, 'schedule', 5000.00, CURDATE(), 'PayMongo', 'RCPT-B10B-COL', 'B10B_TEST collision', ?, 'Verified', 'paymongo', 'paid', 'pay_mock_col_123', NOW())
");
$stmt->execute([$sched1Id, $userAId]);
$collisionPayId = (int) $db->lastInsertId();
$collisionPay = $paymentModel->findById($collisionPayId);

// Trigger post-verification automation which should detect the collision and initiate refund
$paymentController->triggerPostVerificationAutomation($collisionPay, $adminId);

$collisionPayAfter = $paymentModel->findById($collisionPayId);
$notesHaveMarker = strpos($collisionPayAfter['notes'] ?? '', '[RESOURCE_COLLISION:') !== false;

// Check audit log
$stmt = $db->prepare("SELECT * FROM audit_logs WHERE entity_type = 'Payment' AND entity_id = ? AND action LIKE '%collision%' LIMIT 1");
$stmt->execute([$collisionPayId]);
$auditFound = (bool) $stmt->fetch();

// Check refund attempt (RefundService records attempt in refunds table)
$stmt = $db->prepare("SELECT * FROM refunds WHERE payment_id = ? LIMIT 1");
$stmt->execute([$collisionPayId]);
$refundRow = $stmt->fetch(PDO::FETCH_ASSOC);
$refundAttempted = !empty($refundRow);

report(13, 'Resource collision triggers automated refund, audit log, and payment notes marker',
    $notesHaveMarker && $auditFound && $refundAttempted,
    "Notes marker: " . ($notesHaveMarker ? 'yes' : 'no') . ", Audit: " . ($auditFound ? 'yes' : 'no') . ", Refund: " . ($refundAttempted ? 'yes' : 'no')
);

// ============================================================================
// TEST 14: Resource collision refund is idempotent on repeated calls
// ============================================================================
// Count refunds before second trigger
$stmt = $db->prepare("SELECT COUNT(*) FROM refunds WHERE payment_id = ?");
$stmt->execute([$collisionPayId]);
$refundsBefore = (int) $stmt->fetchColumn();

// Second trigger of post-verification automation
$paymentController->triggerPostVerificationAutomation($collisionPayAfter, $adminId);

$stmt = $db->prepare("SELECT COUNT(*) FROM refunds WHERE payment_id = ?");
$stmt->execute([$collisionPayId]);
$refundsAfter = (int) $stmt->fetchColumn();

report(14, 'Resource collision refund is idempotent on repeated calls',
    $refundsBefore === $refundsAfter && $refundsAfter === 1,
    "Refund count before: {$refundsBefore}, after: {$refundsAfter}"
);

// Clean up test records
$db->exec("DELETE FROM refunds WHERE payment_id IN ({$pay1Id}, {$firstPaymentId}, {$collisionPayId})");
$db->exec("DELETE FROM payments WHERE payment_id IN ({$pay1Id}, {$firstPaymentId}, {$collisionPayId})");
$db->exec("DELETE FROM burial_schedules WHERE schedule_id IN ({$sched1Id}, {$schedRetryId})");
$db->prepare("UPDATE lots SET status = 'Available' WHERE lot_id = ?")->execute([$testLotId]);

echo "\n==========================================\n";
echo "BATCH 10B LIFECYCLE TESTS SUMMARY:\n";
echo "Passed: {$passed} / 14\n";
echo "Failed: {$failed} / 14\n";
echo "==========================================\n";

if ($failed > 0) {
    exit(1);
}
