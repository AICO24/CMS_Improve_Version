<?php
/**
 * PayMongo Payment & Refund Reconciliation / Consistency Foundation Tests — Batch 7
 *
 * Verifies all required Batch 7 contracts:
 *  B7-T01: Payment webhook with absent currency defaults safely to PHP without weakening validation
 *  B7-T02: Payment webhook amount with decimal value (e.g. 1000.10 -> 100010 cents) via exact centavos
 *  B7-T03: Concurrent refund initiation: FOR UPDATE / balance check protects against over-refunding
 *  B7-T04: Stale/ambiguous refund detection (findStalePendingGatewayRefunds) identifies unconfirmed records
 *  B7-T05: Succeeded refund cannot regress to Processing
 *  B7-T06: Failed refund cannot regress to Processing
 *  B7-T07: Partial/multiple refund allocation cannot exceed payment amount
 *  B7-T08: Explicit non-PHP payment webhook currency is rejected (200 + SystemException)
 *  B7-T09: Explicit payment currency mismatch is rejected (200 + SystemException)
 *  B7-T10: Valid PHP payment webhook remains accepted under established contract
 *  B7-T11: Stale refund detection helper is strictly read-only and joins payment details
 *  B7-T12: Ambiguous refund timeout preserves Processing state and includes enriched context
 *
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_reconciliation_b7.php
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/Refund.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/User.php';
require_once __DIR__ . '/../backend/models/AuditLog.php';
require_once __DIR__ . '/../backend/models/Notification.php';
require_once __DIR__ . '/../backend/models/SystemException.php';
require_once __DIR__ . '/../backend/services/EnvironmentService.php';
require_once __DIR__ . '/../backend/services/PayMongoService.php';
require_once __DIR__ . '/../backend/services/RefundService.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';

$passed = 0;
$failed = 0;

function report($testId, $title, $success, $details = '') {
    global $passed, $failed;
    if ($success) {
        $passed++;
        echo "[PASS] {$testId}: {$title}\n";
    } else {
        $failed++;
        echo "[FAIL] {$testId}: {$title} — {$details}\n";
    }
}

$db = Database::getInstance()->getConnection();
$paymentController = new PaymentController();
$paymentModel = new Payment();
$refundModel = new Refund();
$systemExceptionModel = new SystemException();

// Clean up prior test records (respecting FK constraints)
$db->exec("DELETE FROM refunds WHERE payment_id IN (SELECT payment_id FROM payments WHERE notes LIKE '%BATCH7_TEST%') OR notes LIKE '%BATCH7_TEST%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH7_TEST%'");
$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b7_test%'");

// Establish test webhook secret
$testSecret = 'whsec_test_batch7_secret_key_reconciliation_789';
putenv("PAYMONGO_WEBHOOK_SECRET={$testSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testSecret;

// Set PayMongo environment to test
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';
putenv("PAYMONGO_SECRET_KEY=sk_test_mock_batch7_key");
$_ENV['PAYMONGO_SECRET_KEY'] = 'sk_test_mock_batch7_key';

// Test actors
$adminUser = ['user_id' => 1, 'username' => 'admin_test', 'role' => 'admin'];
$staffUser = ['user_id' => 2, 'username' => 'staff_test', 'role' => 'staff'];

// Find or set an available lot
$testLot = $db->query("SELECT lot_id, price FROM lots LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$lotId = $testLot ? (int) $testLot['lot_id'] : 1;

function createB7Payment(Payment $paymentModel, $lotId, $amount, string $csId, string $status = 'Pending', string $currency = 'PHP', ?string $gatewayPaymentId = null): int {
    $db = Database::getInstance()->getConnection();
    $paymentId = $paymentModel->create([
        'transaction_type' => 'Lot Purchase',
        'reference_id' => $lotId,
        'reference_kind' => 'lot',
        'amount' => $amount,
        'payment_date' => date('Y-m-d'),
        'payment_method' => 'PayMongo',
        'receipt_number' => 'RCPT-B7-' . bin2hex(random_bytes(3)),
        'notes' => 'BATCH7_TEST ' . $csId,
        'received_by' => 1,
        'verification_status' => $status,
    ]);

    $gwStatus = ($status === 'Verified') ? 'paid' : 'awaiting_payment_method';
    $paymentModel->setGatewaySession($paymentId, 'paymongo', $csId, 'pi_init_' . $paymentId, $gwStatus);

    if ($currency !== 'PHP') {
        $stmt = $db->prepare("UPDATE payments SET currency = ? WHERE payment_id = ?");
        $stmt->execute([$currency, $paymentId]);
    }

    if ($gatewayPaymentId !== null) {
        $stmt = $db->prepare("UPDATE payments SET gateway_payment_id = ? WHERE payment_id = ?");
        $stmt->execute([$gatewayPaymentId, $paymentId]);
    }

    if ($status !== 'Pending') {
        $stmt = $db->prepare("UPDATE payments SET verification_status = ? WHERE payment_id = ?");
        $stmt->execute([$status, $paymentId]);
    }

    return $paymentId;
}

function makeB7Signature(string $rawBody, string $secret, bool $livemode = false): string {
    $timestamp = time();
    $signedPayload = $timestamp . '.' . $rawBody;
    $hash = hash_hmac('sha256', $signedPayload, $secret);
    $sigKey = $livemode ? 'li' : 'te';
    return "t={$timestamp},{$sigKey}={$hash}";
}

function buildB7HostedCheckoutPayload(
    string $csId,
    int $amountCents,
    ?string $currency = 'PHP',
    bool $livemode = false,
    ?string $payId = null
): string {
    if ($payId === null) {
        $payId = 'pay_b7_test_' . bin2hex(random_bytes(6));
    }

    $paymentAttrs = [
        'amount' => $amountCents,
        'status' => 'paid',
    ];
    if ($currency !== null) {
        $paymentAttrs['currency'] = $currency;
    }

    $payload = [
        'event_type' => 'send.webhook',
        'data' => [
            'type' => 'checkout_session.payment.paid',
            'resource' => 'checkout_session',
            'livemode' => $livemode,
            'data' => [
                'id' => $csId,
                'type' => 'checkout_session',
                'attributes' => [
                    'status' => 'paid',
                    'reference_number' => 'REF-' . $csId,
                    'payments' => [
                        [
                            'id' => $payId,
                            'type' => 'payment',
                            'attributes' => $paymentAttrs,
                        ]
                    ],
                ]
            ]
        ]
    ];

    return json_encode($payload);
}

// ============================================================
// B7-T01: Payment webhook with absent currency
// ============================================================
$csId01 = 'cs_b7_test_01_' . bin2hex(random_bytes(4));
$pId01 = createB7Payment($paymentModel, $lotId, '1500.00', $csId01, 'Pending', 'PHP');
// Build payload without currency attribute in payments
$rawBody01 = buildB7HostedCheckoutPayload($csId01, 150000, null);
$sig01 = makeB7Signature($rawBody01, $testSecret);
$res01 = $paymentController->handleWebhook($rawBody01, $sig01);

$pRow01 = $paymentModel->findById($pId01);
report('B7-T01', 'Payment webhook with absent currency safely defaults to PHP contract and verifies',
    ($res01['code'] ?? 0) === 200
    && ($res01['status'] ?? '') === 'verified'
    && ($pRow01['verification_status'] ?? '') === 'Verified',
    json_encode($res01)
);

// ============================================================
// B7-T02: Payment webhook amount with decimal value (e.g. 1000.10)
// ============================================================
$toCentavosInt = Refund::toCentavos(1000);
$toCentavosDecFloat = Refund::toCentavos(1000.10);
$toCentavosDecStr = Refund::toCentavos('1000.10');
$centavosCorrect = ($toCentavosInt === 100000) && ($toCentavosDecFloat === 100010) && ($toCentavosDecStr === 100010);

$csId02 = 'cs_b7_test_02_' . bin2hex(random_bytes(4));
$pId02 = createB7Payment($paymentModel, $lotId, '1000.10', $csId02, 'Pending', 'PHP');
$rawBody02 = buildB7HostedCheckoutPayload($csId02, 100010, 'PHP');
$sig02 = makeB7Signature($rawBody02, $testSecret);
$res02 = $paymentController->handleWebhook($rawBody02, $sig02);

$pRow02 = $paymentModel->findById($pId02);
report('B7-T02', 'Payment webhook amount with decimal 1000.10 matches 100010 centavos exactly without float arithmetic',
    $centavosCorrect
    && ($res02['code'] ?? 0) === 200
    && ($res02['status'] ?? '') === 'verified'
    && ($pRow02['verification_status'] ?? '') === 'Verified',
    "Centavos check: float={$toCentavosDecFloat}, str={$toCentavosDecStr}; Webhook: " . json_encode($res02)
);

// ============================================================
// B7-T03: Concurrent refund initiation protection (FOR UPDATE)
// ============================================================
$csId03 = 'cs_b7_test_03_' . bin2hex(random_bytes(4));
$pId03 = createB7Payment($paymentModel, $lotId, '5000.00', $csId03, 'Verified', 'PHP', 'pay_b7_03_' . bin2hex(random_bytes(4)));

// Create first active refund for 3500.00 PHP
$refId03A = $refundModel->create([
    'payment_id' => $pId03,
    'idempotency_key' => 'b7_ref_03a_' . bin2hex(random_bytes(4)),
    'amount' => '3500.00',
    'currency' => 'PHP',
    'status' => Refund::STATUS_PROCESSING,
    'reason' => 'requested_by_customer',
    'notes' => 'BATCH7_TEST first refund',
    'requested_by' => 1,
]);

// Second refund attempts 2000.00 PHP (3500 + 2000 = 5500 > 5000)
$remainingCents = $refundModel->calculateRemainingRefundableCents($pId03, '5000.00');
$overRefundBlocked = ($remainingCents === 150000); // Only 1500.00 remaining

// Attempt processing via RefundService with mock service
$mockPayMongoService = new class extends PayMongoService {
    public function createRefund(array $attributes, $idempotencyKey = null) {
        return ['success' => true, 'status' => 200, 'data' => ['id' => 'ref_mock_' . bin2hex(random_bytes(4)), 'type' => 'refund', 'attributes' => ['status' => 'succeeded', 'amount' => $attributes['amount'] ?? 0]]];
    }
};

$refundService03 = new RefundService(null, null, $mockPayMongoService);
$res03B = $refundService03->processRefund($pId03, 2000.00, 'requested_by_customer', 'BATCH7_TEST over-refund attempt', $adminUser);

report('B7-T03', 'Concurrent refund protection: FOR UPDATE balance check prevents over-refunding remaining balance',
    $overRefundBlocked
    && ($res03B['code'] ?? 0) === 400
    && strpos(($res03B['error'] ?? ''), 'exceeds remaining refundable balance') !== false,
    json_encode($res03B)
);

// ============================================================
// B7-T04: Stale/ambiguous refund detection (findStalePendingGatewayRefunds)
// ============================================================
$csId04 = 'cs_b7_test_04_' . bin2hex(random_bytes(4));
$pId04 = createB7Payment($paymentModel, $lotId, '2000.00', $csId04, 'Verified', 'PHP', 'pay_b7_04_' . bin2hex(random_bytes(4)));

// Create stale processing refund with NULL gateway_refund_id, created 45 minutes ago
$refId04Stale = $refundModel->create([
    'payment_id' => $pId04,
    'idempotency_key' => 'b7_ref_stale_' . bin2hex(random_bytes(4)),
    'amount' => '500.00',
    'currency' => 'PHP',
    'status' => Refund::STATUS_PROCESSING,
    'reason' => 'requested_by_customer',
    'notes' => 'BATCH7_TEST stale ambiguous refund',
    'requested_by' => 1,
]);
// Backdate created_at to 45 minutes ago
$db->prepare("UPDATE refunds SET created_at = DATE_SUB(NOW(), INTERVAL 45 MINUTE) WHERE refund_id = ?")->execute([$refId04Stale]);

// Create fresh processing refund with NULL gateway_refund_id, created now (should NOT be marked stale with 30-min threshold)
$refId04Fresh = $refundModel->create([
    'payment_id' => $pId04,
    'idempotency_key' => 'b7_ref_fresh_' . bin2hex(random_bytes(4)),
    'amount' => '300.00',
    'currency' => 'PHP',
    'status' => Refund::STATUS_PROCESSING,
    'reason' => 'requested_by_customer',
    'notes' => 'BATCH7_TEST fresh processing refund',
    'requested_by' => 1,
]);

// Create old refund that already has gateway_refund_id (should NOT be returned)
$refId04WithId = $refundModel->create([
    'payment_id' => $pId04,
    'idempotency_key' => 'b7_ref_with_id_' . bin2hex(random_bytes(4)),
    'gateway_refund_id' => 'ref_b7_existing_' . bin2hex(random_bytes(4)),
    'amount' => '200.00',
    'currency' => 'PHP',
    'status' => Refund::STATUS_PROCESSING,
    'reason' => 'requested_by_customer',
    'notes' => 'BATCH7_TEST with gateway refund id',
    'requested_by' => 1,
]);
$db->prepare("UPDATE refunds SET created_at = DATE_SUB(NOW(), INTERVAL 50 MINUTE) WHERE refund_id = ?")->execute([$refId04WithId]);

// Execute read-only detection
$staleRefunds = $refundModel->findStalePendingGatewayRefunds(30);
$foundStale = false;
$foundFresh = false;
$foundWithId = false;

foreach ($staleRefunds as $stale) {
    if ((int)$stale['refund_id'] === $refId04Stale) $foundStale = true;
    if ((int)$stale['refund_id'] === $refId04Fresh) $foundFresh = true;
    if ((int)$stale['refund_id'] === $refId04WithId) $foundWithId = true;
}

report('B7-T04', 'Stale/ambiguous refund detection identifies unconfirmed records older than threshold',
    $foundStale && !$foundFresh && !$foundWithId,
    "foundStale={$foundStale}, foundFresh={$foundFresh}, foundWithId={$foundWithId}"
);

// ============================================================
// B7-T05: Succeeded refund cannot regress to Processing
// ============================================================
$csId05 = 'cs_b7_test_05_' . bin2hex(random_bytes(4));
$gwPayId05 = 'pay_b7_05_' . bin2hex(random_bytes(4));
$pId05 = createB7Payment($paymentModel, $lotId, '3000.00', $csId05, 'Verified', 'PHP', $gwPayId05);
$gatewayRefId05 = 'ref_b7_05_' . bin2hex(random_bytes(4));

$refId05 = $refundModel->create([
    'payment_id' => $pId05,
    'gateway_refund_id' => $gatewayRefId05,
    'amount' => '1000.00',
    'currency' => 'PHP',
    'status' => Refund::STATUS_SUCCEEDED,
    'notes' => 'BATCH7_TEST succeeded refund',
    'requested_by' => 1,
]);

$refundService05 = new RefundService();
$res05 = $refundService05->synchronizeWebhookRefund([
    'event_id' => 'evt_b7_05_' . bin2hex(random_bytes(4)),
    'event_type' => 'payment.refund.updated',
    'gateway_refund_id' => $gatewayRefId05,
    'gateway_payment_id' => $gwPayId05,
    'gateway_status' => 'processing',
    'amount_cents' => 100000,
    'currency' => 'PHP',
    'livemode' => false,
]);

$refRow05 = $refundModel->findById($refId05);
report('B7-T05', 'Terminal state protection: Succeeded refund cannot regress to Processing',
    ($res05['code'] ?? 0) === 200
    && ($res05['status'] ?? '') === 'ignored'
    && strpos(($res05['message'] ?? ''), 'Invalid state regression') !== false
    && ($refRow05['status'] ?? '') === Refund::STATUS_SUCCEEDED,
    json_encode($res05)
);

// ============================================================
// B7-T06: Failed refund cannot regress to Processing
// ============================================================
$csId06 = 'cs_b7_test_06_' . bin2hex(random_bytes(4));
$gwPayId06 = 'pay_b7_06_' . bin2hex(random_bytes(4));
$pId06 = createB7Payment($paymentModel, $lotId, '3000.00', $csId06, 'Verified', 'PHP', $gwPayId06);
$gatewayRefId06 = 'ref_b7_06_' . bin2hex(random_bytes(4));

$refId06 = $refundModel->create([
    'payment_id' => $pId06,
    'gateway_refund_id' => $gatewayRefId06,
    'amount' => '1000.00',
    'currency' => 'PHP',
    'status' => Refund::STATUS_FAILED,
    'notes' => 'BATCH7_TEST failed refund',
    'requested_by' => 1,
]);

$res06 = $refundService05->synchronizeWebhookRefund([
    'event_id' => 'evt_b7_06_' . bin2hex(random_bytes(4)),
    'event_type' => 'payment.refund.updated',
    'gateway_refund_id' => $gatewayRefId06,
    'gateway_payment_id' => $gwPayId06,
    'gateway_status' => 'processing',
    'amount_cents' => 100000,
    'currency' => 'PHP',
    'livemode' => false,
]);

$refRow06 = $refundModel->findById($refId06);
report('B7-T06', 'Terminal state protection: Failed refund cannot regress to Processing',
    ($res06['code'] ?? 0) === 200
    && ($res06['status'] ?? '') === 'ignored'
    && strpos(($res06['message'] ?? ''), 'Invalid state regression') !== false
    && ($refRow06['status'] ?? '') === Refund::STATUS_FAILED,
    json_encode($res06)
);

// ============================================================
// B7-T07: Partial/multiple refund allocation cannot exceed payment amount
// ============================================================
$csId07 = 'cs_b7_test_07_' . bin2hex(random_bytes(4));
$pId07 = createB7Payment($paymentModel, $lotId, '10000.00', $csId07, 'Verified', 'PHP', 'pay_b7_07_' . bin2hex(random_bytes(4)));

// Refund 1: 6000.00 (Allocated = 6000, Remaining = 4000)
$refundModel->create([
    'payment_id' => $pId07,
    'idempotency_key' => 'b7_ref_07a_' . bin2hex(random_bytes(4)),
    'amount' => '6000.00',
    'currency' => 'PHP',
    'status' => Refund::STATUS_SUCCEEDED,
    'notes' => 'BATCH7_TEST partial 1',
    'requested_by' => 1,
]);

$remainingCents07_1 = $refundModel->calculateRemainingRefundableCents($pId07, '10000.00');

// Refund 2: Attempt 5000.00 (Exceeds remaining 4000.00)
$res07Over = $refundService03->processRefund($pId07, 5000.00, 'requested_by_customer', 'BATCH7_TEST over attempt', $adminUser);

// Refund 3: Exact 4000.00 (Exhausts payment)
$res07Exact = $refundService03->processRefund($pId07, 4000.00, 'requested_by_customer', 'BATCH7_TEST exact remaining', $adminUser);
$remainingCents07_2 = $refundModel->calculateRemainingRefundableCents($pId07, '10000.00');

// Refund 4: Attempt 1.00 when fully refunded
$res07Zero = $refundService03->processRefund($pId07, 1.00, 'requested_by_customer', 'BATCH7_TEST beyond exhausted', $adminUser);

report('B7-T07', 'Partial/multiple refund allocations strictly capped at total payment amount',
    $remainingCents07_1 === 400000
    && ($res07Over['code'] ?? 0) === 400
    && ($res07Exact['code'] ?? 0) === 200
    && $remainingCents07_2 === 0
    && ($res07Zero['code'] ?? 0) === 400,
    "Remaining1={$remainingCents07_1}, Remaining2={$remainingCents07_2}, OverCode=" . ($res07Over['code'] ?? 0) . ", ExactCode=" . ($res07Exact['code'] ?? 0)
);

// ============================================================
// B7-T08: Explicit non-PHP payment webhook currency is rejected
// ============================================================
$csId08 = 'cs_b7_test_08_' . bin2hex(random_bytes(4));
$pId08 = createB7Payment($paymentModel, $lotId, '2000.00', $csId08, 'Pending', 'PHP');
$rawBody08 = buildB7HostedCheckoutPayload($csId08, 200000, 'USD');
$sig08 = makeB7Signature($rawBody08, $testSecret);
$res08 = $paymentController->handleWebhook($rawBody08, $sig08);

$pRow08 = $paymentModel->findById($pId08);
$exc08 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.webhook_currency_mismatch' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);

report('B7-T08', 'Explicit non-PHP payment webhook currency (USD) is rejected and raises SystemException',
    ($res08['code'] ?? 0) === 200
    && ($res08['status'] ?? '') === 'mismatch'
    && ($pRow08['verification_status'] ?? '') === 'Pending'
    && !empty($exc08)
    && ((int)$exc08['entity_id'] === $pId08),
    json_encode($res08)
);

// ============================================================
// B7-T09: Explicit payment currency mismatch is rejected
// ============================================================
$csId09 = 'cs_b7_test_09_' . bin2hex(random_bytes(4));
// Payment record has currency 'EUR', webhook has 'PHP'
$pId09 = createB7Payment($paymentModel, $lotId, '2000.00', $csId09, 'Pending', 'EUR');
$rawBody09 = buildB7HostedCheckoutPayload($csId09, 200000, 'PHP');
$sig09 = makeB7Signature($rawBody09, $testSecret);
$res09 = $paymentController->handleWebhook($rawBody09, $sig09);

$pRow09 = $paymentModel->findById($pId09);
$exc09 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.webhook_currency_mismatch' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);

report('B7-T09', 'Explicit payment currency mismatch (PHP vs EUR) is rejected and raises SystemException',
    ($res09['code'] ?? 0) === 200
    && ($res09['status'] ?? '') === 'mismatch'
    && ($pRow09['verification_status'] ?? '') === 'Pending'
    && !empty($exc09)
    && ((int)$exc09['entity_id'] === $pId09),
    json_encode($res09)
);

// ============================================================
// B7-T10: Valid PHP payment webhook remains accepted
// ============================================================
$csId10 = 'cs_b7_test_10_' . bin2hex(random_bytes(4));
$pId10 = createB7Payment($paymentModel, $lotId, '2500.00', $csId10, 'Pending', 'PHP');
$rawBody10 = buildB7HostedCheckoutPayload($csId10, 250000, 'PHP');
$sig10 = makeB7Signature($rawBody10, $testSecret);
$res10 = $paymentController->handleWebhook($rawBody10, $sig10);

$pRow10 = $paymentModel->findById($pId10);
$evRow10 = $db->query("SELECT * FROM webhook_events WHERE event_id = '{$csId10}'")->fetch(PDO::FETCH_ASSOC);

report('B7-T10', 'Valid PHP payment webhook remains accepted and sets status Verified under established contract',
    ($res10['code'] ?? 0) === 200
    && ($res10['status'] ?? '') === 'verified'
    && ($pRow10['verification_status'] ?? '') === 'Verified'
    && !empty($evRow10)
    && ((int)$evRow10['processed'] === 1),
    json_encode($res10)
);

// ============================================================
// B7-T11: Stale refund detection helper is strictly read-only and joins payment details
// ============================================================
$staleRecords = $refundModel->findStalePendingGatewayRefunds(30);
$staleFound = null;
foreach ($staleRecords as $r) {
    if ((int)$r['refund_id'] === $refId04Stale) {
        $staleFound = $r;
        break;
    }
}

$readOnlyPreserved = false;
if ($staleFound !== null) {
    // Verify joined payment fields are present
    $hasJoinedFields = array_key_exists('gateway_payment_id', $staleFound)
                    && array_key_exists('receipt_number', $staleFound)
                    && array_key_exists('verification_status', $staleFound);

    // Verify refund in DB was NOT modified by the query
    $dbCheck = $refundModel->findById($refId04Stale);
    $readOnlyPreserved = $hasJoinedFields && ($dbCheck['status'] === Refund::STATUS_PROCESSING);
}

report('B7-T11', 'Stale refund detection helper is read-only and includes payment correlation details',
    $readOnlyPreserved,
    $staleFound ? json_encode($staleFound) : 'Not found'
);

// ============================================================
// B7-T12: Ambiguous refund timeout preserves Processing state and includes enriched context
// ============================================================
$csId12 = 'cs_b7_test_12_' . bin2hex(random_bytes(4));
$pId12 = createB7Payment($paymentModel, $lotId, '4000.00', $csId12, 'Verified', 'PHP', 'pay_b7_12_' . bin2hex(random_bytes(4)));

// Mock service returning ambiguous timeout (status 0 / curl error 28)
$timeoutMock = new class extends PayMongoService {
    public function createRefund(array $attributes, $idempotencyKey = null) {
        return ['success' => false, 'status' => 0, 'code' => 0, 'error' => 'PayMongo request failed: Operation timed out after 30000 milliseconds with 0 bytes received'];
    }
};

$timeoutRefundService = new RefundService(null, null, $timeoutMock);
$testIdem12 = 'idem_b7_12_' . bin2hex(random_bytes(4));
$res12 = $timeoutRefundService->processRefund($pId12, 1000.00, 'requested_by_customer', 'BATCH7_TEST timeout test', $adminUser, $testIdem12);

$refRow12 = $refundModel->findById((int)($res12['refund_id'] ?? 0));
$exc12 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.refund_gateway_timeout' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$exc12Context = $exc12 ? json_decode($exc12['context'] ?? '{}', true) : [];

report('B7-T12', 'Ambiguous refund timeout preserves Processing state and logs enriched SystemException',
    ($res12['code'] ?? 0) === 502
    && ($res12['status'] ?? '') === Refund::STATUS_PROCESSING
    && ($refRow12['status'] ?? '') === Refund::STATUS_PROCESSING
    && $refRow12['gateway_refund_id'] === null
    && !empty($exc12)
    && array_key_exists('payment_id', $exc12Context)
    && array_key_exists('gateway_payment_id', $exc12Context)
    && array_key_exists('idempotency_key', $exc12Context),
    json_encode($res12)
);

// ============================================================
// Summary
// ============================================================
echo "\n======================================================\n";
echo "Batch 7 Reconciliation & Consistency Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

// Cleanup test data
$db->exec("DELETE FROM refunds WHERE payment_id IN (SELECT payment_id FROM payments WHERE notes LIKE '%BATCH7_TEST%') OR notes LIKE '%BATCH7_TEST%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH7_TEST%'");
$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b7_test%'");

exit($failed > 0 ? 1 : 0);
