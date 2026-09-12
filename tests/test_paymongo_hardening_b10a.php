<?php
/**
 * PayMongo Security Hardening Tests — Batch 10A
 *
 * Verifies all required Batch 10A security hardening contracts:
 *  1. Manual Cash verification still works.
 *  2. Manual GCash verification still works if supported.
 *  3. Manual PayMongo verification is rejected (400).
 *  4. verifyAllPending() cannot verify PayMongo (skips PayMongo, verifies manual).
 *  5. Fresh valid PayMongo webhook succeeds (200 + Verified).
 *  6. Stale webhook is rejected (401).
 *  7. Malformed timestamp is rejected (401).
 *  8. Timestamp cannot be bypassed using raw HMAC in production mode.
 *  9. Active PayMongo payment amount cannot be changed (409).
 * 10. Active PayMongo payment reference/method/type cannot be changed (409).
 * 11. Active PayMongo payment cannot be deleted (409).
 * 12. Fake/manual PayMongo payment creation is rejected (400).
 * 13. Existing PayMongo checkout creation still works.
 *
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_hardening_b10a.php
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
require_once __DIR__ . '/../backend/services/EnvironmentService.php';
require_once __DIR__ . '/../backend/services/PayMongoService.php';
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
$paymentModel = new Payment();

// Clean up previous test runs
$db->exec("DELETE FROM payments WHERE notes LIKE '%B10A_TEST%'");
$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b10a_test%'");

// Identify test admin and citizen users
$adminUser = $db->query("SELECT u.user_id, u.username, r.title as role FROM users u JOIN roles r ON u.role_id = r.role_id WHERE LOWER(r.title) = 'admin' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$adminUser) {
    $adminUser = ['user_id' => 1, 'username' => 'admin', 'role' => 'admin'];
}
$adminId = (int) $adminUser['user_id'];

$citizenUser = $db->query("SELECT u.user_id, u.username, r.title as role FROM users u JOIN roles r ON u.role_id = r.role_id WHERE LOWER(r.title) = 'user' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$citizenUser) {
    $citizenUser = ['user_id' => 2, 'username' => 'citizen', 'role' => 'user'];
}
$citizenId = (int) $citizenUser['user_id'];

// Find or create an available lot for reference
$lot = $db->query("SELECT lot_id, lot_number, price FROM lots WHERE status = 'Available' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$lot) {
    $lot = $db->query("SELECT lot_id, lot_number, price FROM lots LIMIT 1")->fetch(PDO::FETCH_ASSOC);
}
$lotId = (int) ($lot['lot_id'] ?? 1);
$lotPrice = (float) ($lot['price'] ?? 5000.00);

// Setup test webhook secret
$testSecret = 'whsec_test_batch10a_secret_key_1234567890';
putenv("PAYMONGO_WEBHOOK_SECRET={$testSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testSecret;
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';
putenv("APP_ENV=local");
$_ENV['APP_ENV'] = 'local';

function makeHeaderWithTimestamp($rawBody, $secret, $timestamp, $keyType = 'te') {
    $hash = hash_hmac('sha256', "{$timestamp}.{$rawBody}", $secret);
    return "t={$timestamp},{$keyType}={$hash}";
}

function buildHostedWebhookPayload(string $csId, int $amountCents, string $payId = 'pay_b10a_123') {
    return json_encode([
        'event_type' => 'send.webhook',
        'data' => [
            'type' => 'checkout_session.payment.paid',
            'resource' => 'checkout_session',
            'livemode' => false,
            'data' => [
                'id' => $csId,
                'type' => 'checkout_session',
                'attributes' => [
                    'status' => 'paid',
                    'reference_number' => 'RCPT-B10A',
                    'payments' => [
                        [
                            'id' => $payId,
                            'type' => 'payment',
                            'attributes' => [
                                'amount' => $amountCents,
                                'currency' => 'PHP',
                                'status' => 'paid',
                                'fee' => 0,
                                'net_amount' => $amountCents,
                            ],
                        ],
                    ],
                    'payment_intent' => [
                        'id' => 'pi_b10a_' . bin2hex(random_bytes(4)),
                        'type' => 'payment_intent',
                        'attributes' => [
                            'amount' => $amountCents,
                            'currency' => 'PHP',
                            'status' => 'succeeded',
                        ],
                    ],
                ],
            ],
        ],
    ]);
}

echo "--- Starting Batch 10A Hardening Tests ---\n\n";

// ============================================================
// TEST 1: Manual Cash verification still works
// ============================================================
$cashPaymentId = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'amount' => $lotPrice,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'Cash',
    'received_by' => $citizenId,
    'verification_status' => 'Pending',
    'notes' => 'B10A_TEST: Manual Cash Verification',
]);

$verifyCashResult = $paymentController->verify($cashPaymentId, 'Verified', $adminId);
$updatedCash = $paymentModel->findById($cashPaymentId);

report(
    1,
    'Manual Cash verification still works',
    !empty($verifyCashResult['success']) && ($updatedCash['verification_status'] ?? '') === 'Verified',
    json_encode($verifyCashResult)
);

// ============================================================
// TEST 2: Manual GCash verification still works
// ============================================================
$gcashPaymentId = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'amount' => $lotPrice,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'GCash',
    'received_by' => $citizenId,
    'verification_status' => 'Pending',
    'notes' => 'B10A_TEST: Manual GCash Verification',
]);

$verifyGcashResult = $paymentController->verify($gcashPaymentId, 'Verified', $adminId);
$updatedGcash = $paymentModel->findById($gcashPaymentId);

report(
    2,
    'Manual GCash verification still works if supported',
    !empty($verifyGcashResult['success']) && ($updatedGcash['verification_status'] ?? '') === 'Verified',
    json_encode($verifyGcashResult)
);
// ============================================================
// TEST 3: Manual PayMongo verification is rejected
// ============================================================
$pmPaymentId = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'amount' => $lotPrice,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'PayMongo',
    'received_by' => $citizenId,
    'verification_status' => 'Pending',
    'notes' => 'B10A_TEST: Reject Manual PayMongo Verify',
]);
$paymentModel->setGatewaySession($pmPaymentId, 'paymongo', 'cs_b10a_test_manual_verify', 'pi_test_3', 'awaiting_payment_method');

$verifyPmResult = $paymentController->verify($pmPaymentId, 'Verified', $adminId);
$updatedPm = $paymentModel->findById($pmPaymentId);

$pmRejectedCorrectly = isset($verifyPmResult['error'])
    && (int) ($verifyPmResult['code'] ?? 0) === 400
    && ($updatedPm['verification_status'] ?? '') === 'Pending';

report(
    3,
    'Manual PayMongo verification is rejected',
    $pmRejectedCorrectly,
    "Result: " . json_encode($verifyPmResult) . ", status: " . ($updatedPm['verification_status'] ?? '')
);

// ============================================================
// TEST 4: verifyAllPending() cannot verify PayMongo
// ============================================================
// Create a manual cash payment (pending) and keep our PayMongo payment (pending)
$bulkCashId = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'amount' => $lotPrice,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'Cash',
    'received_by' => $citizenId,
    'verification_status' => 'Pending',
    'notes' => 'B10A_TEST: Bulk Cash Payment',
]);

$bulkResult = $paymentController->verifyAllPending('Verified', $adminId);
$bulkCashCheck = $paymentModel->findById($bulkCashId);
$pmBulkCheck = $paymentModel->findById($pmPaymentId);

$bulkCorrect = !empty($bulkResult['success'])
    && ($bulkCashCheck['verification_status'] ?? '') === 'Verified'
    && ($pmBulkCheck['verification_status'] ?? '') === 'Pending';

report(
    4,
    'verifyAllPending() cannot verify PayMongo',
    $bulkCorrect,
    "Cash status: " . ($bulkCashCheck['verification_status'] ?? '') . ", PayMongo status: " . ($pmBulkCheck['verification_status'] ?? '')
);

// ============================================================
// TEST 5: Fresh valid PayMongo webhook succeeds
// ============================================================
$csIdFresh = 'cs_b10a_test_fresh_' . bin2hex(random_bytes(4));
$freshPaymentId = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'amount' => $lotPrice,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'PayMongo',
    'received_by' => $citizenId,
    'verification_status' => 'Pending',
    'notes' => 'B10A_TEST: Fresh Webhook Payment',
]);
$paymentModel->setGatewaySession($freshPaymentId, 'paymongo', $csIdFresh, 'pi_test_fresh', 'awaiting_payment_method');

$freshPayload = buildHostedWebhookPayload($csIdFresh, (int) round($lotPrice * 100));
$freshTimestamp = time();
$freshHeader = makeHeaderWithTimestamp($freshPayload, $testSecret, $freshTimestamp, 'te');

$freshResult = $paymentController->handleWebhook($freshPayload, $freshHeader);
$freshPaymentCheck = $paymentModel->findById($freshPaymentId);

$freshSucceeded = !empty($freshResult['success'])
    && (int) ($freshResult['code'] ?? 0) === 200
    && ($freshPaymentCheck['verification_status'] ?? '') === 'Verified';

report(
    5,
    'Fresh valid PayMongo webhook succeeds',
    $freshSucceeded,
    "Result: " . json_encode($freshResult) . ", status: " . ($freshPaymentCheck['verification_status'] ?? '')
);

// ============================================================
// TEST 6: Stale webhook is rejected
// ============================================================
$csIdStale = 'cs_b10a_test_stale_' . bin2hex(random_bytes(4));
$stalePaymentId = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'amount' => $lotPrice,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'PayMongo',
    'received_by' => $citizenId,
    'verification_status' => 'Pending',
    'notes' => 'B10A_TEST: Stale Webhook Payment',
]);
$paymentModel->setGatewaySession($stalePaymentId, 'paymongo', $csIdStale, 'pi_test_stale', 'awaiting_payment_method');

$stalePayload = buildHostedWebhookPayload($csIdStale, (int) round($lotPrice * 100));
$staleTimestamp = time() - 600; // 10 minutes in the past (> 300s)
$staleHeader = makeHeaderWithTimestamp($stalePayload, $testSecret, $staleTimestamp, 'te');

$staleResult = $paymentController->handleWebhook($stalePayload, $staleHeader);
$stalePaymentCheck = $paymentModel->findById($stalePaymentId);

$staleRejected = isset($staleResult['error'])
    && (int) ($staleResult['code'] ?? 0) === 401
    && ($stalePaymentCheck['verification_status'] ?? '') === 'Pending';

report(
    6,
    'Stale webhook is rejected',
    $staleRejected,
    "Result: " . json_encode($staleResult) . ", status: " . ($stalePaymentCheck['verification_status'] ?? '')
);

// ============================================================
// TEST 7: Malformed timestamp is rejected
// ============================================================
$csIdMalformed = 'cs_b10a_test_malformed_' . bin2hex(random_bytes(4));
$malformedPayload = buildHostedWebhookPayload($csIdMalformed, (int) round($lotPrice * 100));
$malformedHeader = "t=not_a_valid_timestamp,te=" . hash_hmac('sha256', "not_a_valid_timestamp.{$malformedPayload}", $testSecret);

$malformedResult = $paymentController->handleWebhook($malformedPayload, $malformedHeader);

$malformedRejected = isset($malformedResult['error'])
    && (int) ($malformedResult['code'] ?? 0) === 401;

report(
    7,
    'Malformed timestamp is rejected',
    $malformedRejected,
    "Result: " . json_encode($malformedResult)
);

// ============================================================
// TEST 8: Timestamp cannot be bypassed using raw HMAC in production mode
// ============================================================
$rawPayload = json_encode(['test' => 'raw_hmac_bypass_attempt']);
$rawHmac = hash_hmac('sha256', $rawPayload, $testSecret);

// Set production environment temporarily
putenv("APP_ENV=production");
$_ENV['APP_ENV'] = 'production';
putenv("PAYMONGO_ENV=live");
$_ENV['PAYMONGO_ENV'] = 'live';

$bypassResultInProd = $paymentController->verifyWebhookSignature($rawPayload, $rawHmac, $testSecret);
$bypassHeaderInProd = $paymentController->verifyWebhookSignature($rawPayload, "te={$rawHmac}", $testSecret);

// Restore local/test environment
putenv("APP_ENV=local");
$_ENV['APP_ENV'] = 'local';
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';

report(
    8,
    'Timestamp cannot be bypassed using raw HMAC in production mode',
    ($bypassResultInProd === false && $bypassHeaderInProd === false),
    "Bypass raw: " . var_export($bypassResultInProd, true) . ", Bypass te: " . var_export($bypassHeaderInProd, true)
);

// ============================================================
// TEST 9: Active PayMongo payment amount cannot be changed
// ============================================================
$csIdActive = 'cs_b10a_test_active_' . bin2hex(random_bytes(4));
$activePaymentId = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'amount' => $lotPrice,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'PayMongo',
    'received_by' => $citizenId,
    'verification_status' => 'Pending',
    'notes' => 'B10A_TEST: Active Session Protection',
]);
$paymentModel->setGatewaySession($activePaymentId, 'paymongo', $csIdActive, 'pi_test_active', 'active');

$updateAmountResult = $paymentController->update(
    $activePaymentId,
    ['amount' => $lotPrice + 1000.00],
    $adminUser
);
$activePaymentCheck = $paymentModel->findById($activePaymentId);

$amountBlocked = isset($updateAmountResult['error'])
    && (int) ($updateAmountResult['code'] ?? 0) === 409
    && abs((float) $activePaymentCheck['amount'] - $lotPrice) < 0.001;

report(
    9,
    'Active PayMongo payment amount cannot be changed',
    $amountBlocked,
    "Result: " . json_encode($updateAmountResult) . ", amount in DB: " . ($activePaymentCheck['amount'] ?? '')
);

// ============================================================
// TEST 10: Active PayMongo payment reference cannot be changed
// ============================================================
$diffLot = $db->query("SELECT lot_id FROM lots WHERE lot_id != {$lotId} LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$diffLotId = $diffLot ? (int) $diffLot['lot_id'] : $lotId + 999;

$updateRefResult = $paymentController->update(
    $activePaymentId,
    ['reference_id' => $diffLotId],
    $adminUser
);
$updateMethodResult = $paymentController->update(
    $activePaymentId,
    ['payment_method' => 'Cash'],
    $adminUser
);
$updateTypeResult = $paymentController->update(
    $activePaymentId,
    ['transaction_type' => 'Cremation'],
    $adminUser
);

$activeAfterMutations = $paymentModel->findById($activePaymentId);

$mutationsBlocked = isset($updateRefResult['error']) && (int) ($updateRefResult['code'] ?? 0) === 409
    && isset($updateMethodResult['error']) && (int) ($updateMethodResult['code'] ?? 0) === 409
    && isset($updateTypeResult['error']) && (int) ($updateTypeResult['code'] ?? 0) === 409
    && (int) $activeAfterMutations['reference_id'] === $lotId
    && $activeAfterMutations['payment_method'] === 'PayMongo'
    && $activeAfterMutations['transaction_type'] === 'Lot Purchase';

report(
    10,
    'Active PayMongo payment reference cannot be changed',
    $mutationsBlocked,
    "Ref err: " . ($updateRefResult['error'] ?? 'none') .
    ", Method err: " . ($updateMethodResult['error'] ?? 'none') .
    ", Type err: " . ($updateTypeResult['error'] ?? 'none')
);

// ============================================================
// TEST 11: Active PayMongo payment cannot be deleted
// ============================================================
$deleteResult = $paymentController->destroy($activePaymentId, $adminId);
$activeStillExists = $paymentModel->findById($activePaymentId);

$deleteBlocked = isset($deleteResult['error'])
    && (int) ($deleteResult['code'] ?? 0) === 409
    && !empty($activeStillExists);

report(
    11,
    'Active PayMongo payment cannot be deleted',
    $deleteBlocked,
    "Result: " . json_encode($deleteResult) . ", exists: " . (!empty($activeStillExists) ? 'yes' : 'no')
);

// ============================================================
// TEST 12: Fake/manual PayMongo payment creation is rejected
// ============================================================
$fakeManual1 = $paymentController->store([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'amount' => $lotPrice,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'PayMongo',
    'notes' => 'B10A_TEST: Fake Manual PayMongo',
], $adminId);

$fakeManual2 = $paymentController->store([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'amount' => $lotPrice,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'paymongo',
    'notes' => 'B10A_TEST: Fake Manual paymongo lowercase',
], $citizenId);

$fakeBlocked = isset($fakeManual1['error']) && (int) ($fakeManual1['code'] ?? 0) === 400
    && isset($fakeManual2['error']) && (int) ($fakeManual2['code'] ?? 0) === 400;

report(
    12,
    'Fake/manual PayMongo payment creation is rejected',
    $fakeBlocked,
    "Store 1: " . json_encode($fakeManual1) . ", Store 2: " . json_encode($fakeManual2)
);

// ============================================================
// TEST 13: Existing PayMongo checkout creation still works
// ============================================================
$checkoutResult = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'notes' => 'B10A_TEST: Legitimate Checkout Creation',
], $citizenUser);

$checkoutCreatedId = (int) ($checkoutResult['payment_id'] ?? 0);
$createdPayment = $checkoutCreatedId > 0 ? $paymentModel->findById($checkoutCreatedId) : null;

$checkoutWorks = !empty($checkoutCreatedId)
    && !empty($createdPayment)
    && $createdPayment['payment_method'] === 'PayMongo'
    && ($createdPayment['verification_status'] ?? '') === 'Pending';

report(
    13,
    'Existing PayMongo checkout creation still works',
    $checkoutWorks,
    "Checkout result: " . json_encode($checkoutResult) . ", payment_method: " . ($createdPayment['payment_method'] ?? 'none')
);

// Clean up test records
$db->exec("DELETE FROM payments WHERE notes LIKE '%B10A_TEST%'");
$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b10a_test%'");

echo "\n--- Summary ---\n";
echo "Total Passed: {$passed}\n";
echo "Total Failed: {$failed}\n";

if ($failed > 0) {
    echo "\n[ERROR] Batch 10A tests had failures!\n";
    exit(1);
} else {
    echo "\n[SUCCESS] All 13 Batch 10A hardening tests passed!\n";
    exit(0);
}
