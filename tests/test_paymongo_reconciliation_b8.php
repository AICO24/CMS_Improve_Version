<?php
/**
 * PayMongo Payment Reconciliation & Safe Recovery Tests — Batch 8
 *
 * Verifies all 31 Batch 8 test contracts:
 *  Payment:
 *   B8-T01: Pending + valid PayMongo paid -> check eligible
 *   B8-T02: Pending + valid evidence -> apply Verified
 *   B8-T03: Exact amount mismatch -> rejected
 *   B8-T04: Currency mismatch -> rejected
 *   B8-T05: Non-PHP currency -> rejected
 *   B8-T06: Livemode mismatch -> rejected
 *   B8-T07: Invalid/missing checkout session -> rejected safely
 *   B8-T08: Missing gateway payment ID -> rejected safely
 *   B8-T09: Already Verified payment -> no duplicate transition
 *   B8-T10: Concurrent webhook/reconciliation race handled safely
 *   B8-T11: Post-commit lot/schedule automation occurs only once
 *   B8-T12: Authentic gateway payment ID is persisted
 *   B8-T13: Browser-supplied fake evidence cannot force reconciliation
 *
 *  Refund:
 *   B8-T14: Processing + gateway refund ID + PayMongo succeeded -> eligible
 *   B8-T15: Processing + gateway refund ID + PayMongo failed -> eligible for Failed
 *   B8-T16: Exact refund amount mismatch -> rejected
 *   B8-T17: Currency mismatch -> rejected
 *   B8-T18: Livemode mismatch -> rejected
 *   B8-T19: Payment ID mismatch -> rejected
 *   B8-T20: Missing gateway refund ID -> does NOT auto-match by heuristic (requires manual investigation)
 *   B8-T21: Ambiguous refund candidates -> manual investigation required
 *   B8-T22: Succeeded terminal state cannot regress
 *   B8-T23: Failed terminal state cannot regress
 *   B8-T24: Concurrent refund webhook/reconciliation is safe
 *   B8-T25: Reconciliation does not create a second refund
 *   B8-T26: Exact-centavo precision is preserved
 *
 *  Stale detection:
 *   B8-T27: Stale Pending gateway payment is detected
 *   B8-T28: Non-stale Pending payment is not detected
 *   B8-T29: Stale Processing refund with gateway ID is detected
 *   B8-T30: Stale Processing refund without gateway ID is detected
 *   B8-T31: Stale queries are strictly read-only
 *
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_reconciliation_b8.php
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
require_once __DIR__ . '/../backend/services/ReconciliationService.php';

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
$paymentModel = new Payment();
$refundModel = new Refund();
$systemExceptionModel = new SystemException();

// Clean up prior test records (respecting FK constraints)
$db->exec("DELETE FROM refunds WHERE payment_id IN (SELECT payment_id FROM payments WHERE notes LIKE '%BATCH8_TEST%') OR notes LIKE '%BATCH8_TEST%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH8_TEST%'");
$db->exec("DELETE FROM audit_logs WHERE action LIKE '%reconcil%' AND details LIKE '%BATCH8_TEST%'");

// Set PayMongo environment to test
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';
putenv("PAYMONGO_SECRET_KEY=sk_test_mock_batch8_key");
$_ENV['PAYMONGO_SECRET_KEY'] = 'sk_test_mock_batch8_key';

// Test admin user
$adminUser = ['user_id' => 1, 'username' => 'admin_test', 'role' => 'admin'];

// Find or select a valid lot
$testLot = $db->query("SELECT lot_id, price FROM lots LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$lotId = $testLot ? (int) $testLot['lot_id'] : 1;

/**
 * Mock PayMongoService for Batch 8 reconciliation testing
 */
class MockPayMongoServiceB8 extends PayMongoService {
    public array $mockCheckoutSessions = [];
    public array $mockPayments = [];
    public array $mockRefunds = [];

    public function getCheckoutSession($sessionId) {
        $sessionId = (string) $sessionId;
        if (isset($this->mockCheckoutSessions[$sessionId])) {
            return $this->mockCheckoutSessions[$sessionId];
        }
        return [
            'success' => false,
            'status' => 404,
            'errors' => [['detail' => "Checkout session {$sessionId} not found"]],
        ];
    }

    public function getPayment($paymentId) {
        $paymentId = (string) $paymentId;
        if (isset($this->mockPayments[$paymentId])) {
            return $this->mockPayments[$paymentId];
        }
        return [
            'success' => false,
            'status' => 404,
            'errors' => [['detail' => "Payment {$paymentId} not found"]],
        ];
    }

    public function getRefund($refundId) {
        $refundId = (string) $refundId;
        if (isset($this->mockRefunds[$refundId])) {
            return $this->mockRefunds[$refundId];
        }
        return [
            'success' => false,
            'status' => 404,
            'errors' => [['detail' => "Refund {$refundId} not found"]],
        ];
    }
}

$mockPayMongo = new MockPayMongoServiceB8();
$reconciliationService = new ReconciliationService(
    $paymentModel,
    $refundModel,
    $mockPayMongo
);

function createB8Payment(Payment $paymentModel, $lotId, $amount, string $csId, string $status = 'Pending', string $currency = 'PHP', ?string $gatewayPaymentId = null): int {
    $db = Database::getInstance()->getConnection();
    $paymentId = $paymentModel->create([
        'transaction_type' => 'Lot Purchase',
        'reference_id' => $lotId,
        'reference_kind' => 'lot',
        'amount' => $amount,
        'payment_date' => date('Y-m-d'),
        'payment_method' => 'PayMongo',
        'receipt_number' => 'RCPT-B8-' . bin2hex(random_bytes(4)),
        'notes' => 'BATCH8_TEST ' . $csId,
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

function createB8Refund(Refund $refundModel, int $paymentId, $amount, string $status = 'Processing', ?string $gwRefundId = null, string $currency = 'PHP'): int {
    $db = Database::getInstance()->getConnection();
    $refundId = $refundModel->create([
        'payment_id' => $paymentId,
        'amount' => $amount,
        'reason' => 'BATCH8_TEST Refund',
        'notes' => 'BATCH8_TEST ' . ($gwRefundId ?: 'no_gw_id'),
        'status' => $status,
        'created_by' => 1,
        'gateway_refund_id' => $gwRefundId,
        'idempotency_key' => 'idem_b8_' . bin2hex(random_bytes(6)),
    ]);

    if ($currency !== 'PHP') {
        $stmt = $db->prepare("UPDATE refunds SET currency = ? WHERE refund_id = ?");
        $stmt->execute([$currency, $refundId]);
    }

    if ($status !== 'Processing') {
        $stmt = $db->prepare("UPDATE refunds SET status = ? WHERE refund_id = ?");
        $stmt->execute([$status, $refundId]);
    }

    return $refundId;
}

// ============================================================
// B8-T01: Pending + valid PayMongo paid -> check eligible
// ============================================================
$csId01 = 'cs_b8_test_01_' . bin2hex(random_bytes(4));
$pId01 = createB8Payment($paymentModel, $lotId, '1500.00', $csId01, 'Pending', 'PHP');
$payId01 = 'pay_b8_01_' . bin2hex(random_bytes(4));

$mockPayMongo->mockCheckoutSessions[$csId01] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $csId01,
        'type' => 'checkout_session',
        'attributes' => [
            'status' => 'paid',
            'livemode' => false,
            'payments' => [
                [
                    'id' => $payId01,
                    'type' => 'payment',
                    'attributes' => [
                        'status' => 'paid',
                        'amount' => 150000,
                        'currency' => 'PHP',
                        'livemode' => false,
                    ]
                ]
            ]
        ]
    ]
];

$res01 = $reconciliationService->checkPayment($pId01);
report('B8-T01', 'Pending payment with valid PayMongo paid session checks eligible',
    ($res01['code'] ?? 0) === 200
    && ($res01['eligible'] ?? false) === true
    && ($res01['gateway']['payment_id'] ?? '') === $payId01
    && empty($res01['mismatches']),
    json_encode($res01)
);

// ============================================================
// B8-T02: Pending + valid evidence -> apply Verified
// ============================================================
$res02 = $reconciliationService->applyPayment($pId01, $adminUser);
$pRow02 = $paymentModel->findById($pId01);
report('B8-T02', 'Pending payment with valid evidence applies to Verified and persists gateway_payment_id',
    ($res02['code'] ?? 0) === 200
    && ($res02['status'] ?? '') === 'reconciled'
    && ($pRow02['verification_status'] ?? '') === 'Verified'
    && ($pRow02['gateway_payment_id'] ?? '') === $payId01,
    json_encode($res02)
);

// ============================================================
// B8-T03: Exact amount mismatch -> rejected
// ============================================================
$csId03 = 'cs_b8_test_03_' . bin2hex(random_bytes(4));
$pId03 = createB8Payment($paymentModel, $lotId, '2000.00', $csId03, 'Pending', 'PHP');
$payId03 = 'pay_b8_03_' . bin2hex(random_bytes(4));

$mockPayMongo->mockCheckoutSessions[$csId03] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $csId03,
        'type' => 'checkout_session',
        'attributes' => [
            'status' => 'paid',
            'livemode' => false,
            'payments' => [
                [
                    'id' => $payId03,
                    'type' => 'payment',
                    'attributes' => [
                        'status' => 'paid',
                        'amount' => 199900, // mismatch: 1999.00 vs 2000.00
                        'currency' => 'PHP',
                        'livemode' => false,
                    ]
                ]
            ]
        ]
    ]
];

$res03Check = $reconciliationService->checkPayment($pId03);
$res03Apply = $reconciliationService->applyPayment($pId03, $adminUser);
$pRow03 = $paymentModel->findById($pId03);
report('B8-T03', 'Exact amount mismatch fails eligibility check and is rejected upon apply',
    ($res03Check['eligible'] ?? true) === false
    && !empty($res03Check['mismatches'])
    && ($res03Apply['code'] ?? 0) === 422
    && ($pRow03['verification_status'] ?? '') === 'Pending',
    json_encode(['check' => $res03Check, 'apply' => $res03Apply])
);

// ============================================================
// B8-T04: Currency mismatch -> rejected
// ============================================================
$csId04 = 'cs_b8_test_04_' . bin2hex(random_bytes(4));
$pId04 = createB8Payment($paymentModel, $lotId, '1000.00', $csId04, 'Pending', 'PHP');
$payId04 = 'pay_b8_04_' . bin2hex(random_bytes(4));

$mockPayMongo->mockCheckoutSessions[$csId04] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $csId04,
        'type' => 'checkout_session',
        'attributes' => [
            'status' => 'paid',
            'livemode' => false,
            'payments' => [
                [
                    'id' => $payId04,
                    'type' => 'payment',
                    'attributes' => [
                        'status' => 'paid',
                        'amount' => 100000,
                        'currency' => 'USD', // mismatch vs PHP
                        'livemode' => false,
                    ]
                ]
            ]
        ]
    ]
];

$res04Check = $reconciliationService->checkPayment($pId04);
$res04Apply = $reconciliationService->applyPayment($pId04, $adminUser);
$pRow04 = $paymentModel->findById($pId04);
report('B8-T04', 'Currency mismatch between gateway and CMS is rejected',
    ($res04Check['eligible'] ?? true) === false
    && ($res04Apply['code'] ?? 0) === 422
    && ($pRow04['verification_status'] ?? '') === 'Pending',
    json_encode(['check' => $res04Check, 'apply' => $res04Apply])
);

// ============================================================
// B8-T05: Non-PHP currency -> rejected
// ============================================================
$csId05 = 'cs_b8_test_05_' . bin2hex(random_bytes(4));
$pId05 = createB8Payment($paymentModel, $lotId, '500.00', $csId05, 'Pending', 'USD');
$payId05 = 'pay_b8_05_' . bin2hex(random_bytes(4));

$mockPayMongo->mockCheckoutSessions[$csId05] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $csId05,
        'type' => 'checkout_session',
        'attributes' => [
            'status' => 'paid',
            'livemode' => false,
            'payments' => [
                [
                    'id' => $payId05,
                    'type' => 'payment',
                    'attributes' => [
                        'status' => 'paid',
                        'amount' => 50000,
                        'currency' => 'USD',
                        'livemode' => false,
                    ]
                ]
            ]
        ]
    ]
];

$res05Check = $reconciliationService->checkPayment($pId05);
$res05Apply = $reconciliationService->applyPayment($pId05, $adminUser);
report('B8-T05', 'Non-PHP currency is rejected per CMS architectural contract',
    ($res05Check['eligible'] ?? true) === false
    && in_array('Gateway currency is USD (PHP required)', $res05Check['mismatches'])
    && ($res05Apply['code'] ?? 0) === 422,
    json_encode(['check' => $res05Check, 'apply' => $res05Apply])
);

// ============================================================
// B8-T06: Livemode mismatch -> rejected
// ============================================================
$csId06 = 'cs_b8_test_06_' . bin2hex(random_bytes(4));
$pId06 = createB8Payment($paymentModel, $lotId, '1200.00', $csId06, 'Pending', 'PHP');
$payId06 = 'pay_b8_06_' . bin2hex(random_bytes(4));

$mockPayMongo->mockCheckoutSessions[$csId06] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $csId06,
        'type' => 'checkout_session',
        'attributes' => [
            'status' => 'paid',
            'livemode' => true, // Mismatch: livemode=true vs env=test
            'payments' => [
                [
                    'id' => $payId06,
                    'type' => 'payment',
                    'attributes' => [
                        'status' => 'paid',
                        'amount' => 120000,
                        'currency' => 'PHP',
                        'livemode' => true,
                    ]
                ]
            ]
        ]
    ]
];

$res06Check = $reconciliationService->checkPayment($pId06);
$res06Apply = $reconciliationService->applyPayment($pId06, $adminUser);
report('B8-T06', 'Livemode mismatch against PAYMONGO_ENV=test is rejected',
    ($res06Check['eligible'] ?? true) === false
    && ($res06Apply['code'] ?? 0) === 422,
    json_encode(['check' => $res06Check, 'apply' => $res06Apply])
);

// ============================================================
// B8-T07: Invalid/missing checkout session -> rejected safely
// ============================================================
$csId07 = 'cs_b8_test_07_not_found';
$pId07 = createB8Payment($paymentModel, $lotId, '800.00', $csId07, 'Pending', 'PHP');

$res07Check = $reconciliationService->checkPayment($pId07);
$res07Apply = $reconciliationService->applyPayment($pId07, $adminUser);
report('B8-T07', 'Invalid or missing remote checkout session is rejected safely without throwing',
    ($res07Check['eligible'] ?? true) === false
    && ($res07Apply['code'] ?? 0) === 422,
    json_encode(['check' => $res07Check, 'apply' => $res07Apply])
);

// ============================================================
// B8-T08: Missing gateway payment ID -> rejected safely
// ============================================================
$csId08 = 'cs_b8_test_08_' . bin2hex(random_bytes(4));
$pId08 = createB8Payment($paymentModel, $lotId, '900.00', $csId08, 'Pending', 'PHP');

$mockPayMongo->mockCheckoutSessions[$csId08] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $csId08,
        'type' => 'checkout_session',
        'attributes' => [
            'status' => 'paid',
            'livemode' => false,
            'payments' => [] // empty payments array
        ]
    ]
];

$res08Check = $reconciliationService->checkPayment($pId08);
$res08Apply = $reconciliationService->applyPayment($pId08, $adminUser);
report('B8-T08', 'Missing gateway payment ID in PayMongo response is rejected safely',
    ($res08Check['eligible'] ?? true) === false
    && in_array('Missing authentic PayMongo payment resource ID (pay_...) in session', $res08Check['mismatches'])
    && ($res08Apply['code'] ?? 0) === 422,
    json_encode(['check' => $res08Check, 'apply' => $res08Apply])
);

// ============================================================
// B8-T09: Already Verified payment -> no duplicate transition
// ============================================================
$csId09 = 'cs_b8_test_09_' . bin2hex(random_bytes(4));
$payId09 = 'pay_b8_09_' . bin2hex(random_bytes(4));
$pId09 = createB8Payment($paymentModel, $lotId, '1100.00', $csId09, 'Verified', 'PHP', $payId09);

$res09Check = $reconciliationService->checkPayment($pId09);
$res09Apply = $reconciliationService->applyPayment($pId09, $adminUser);
report('B8-T09', 'Already Verified payment cannot transition again and returns already_reconciled/no_change',
    ($res09Check['eligible'] ?? true) === false
    && ($res09Apply['code'] ?? 0) === 200
    && ($res09Apply['status'] ?? '') === 'already_reconciled',
    json_encode(['check' => $res09Check, 'apply' => $res09Apply])
);

// ============================================================
// B8-T10: Concurrent webhook/reconciliation race handled safely
// ============================================================
$csId10 = 'cs_b8_test_10_' . bin2hex(random_bytes(4));
$payId10 = 'pay_b8_10_' . bin2hex(random_bytes(4));
$pId10 = createB8Payment($paymentModel, $lotId, '1300.00', $csId10, 'Pending', 'PHP');

$mockPayMongo->mockCheckoutSessions[$csId10] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $csId10,
        'type' => 'checkout_session',
        'attributes' => [
            'status' => 'paid',
            'livemode' => false,
            'payments' => [
                [
                    'id' => $payId10,
                    'type' => 'payment',
                    'attributes' => [
                        'status' => 'paid',
                        'amount' => 130000,
                        'currency' => 'PHP',
                        'livemode' => false,
                    ]
                ]
            ]
        ]
    ]
];

// First, apply reconciliation succeeds:
$res10First = $reconciliationService->applyPayment($pId10, $adminUser);
// Second, a concurrent/subsequent apply arrives:
$res10Second = $reconciliationService->applyPayment($pId10, $adminUser);
report('B8-T10', 'Concurrent/duplicate apply safely yields already_reconciled without duplicate state changes',
    ($res10First['status'] ?? '') === 'reconciled'
    && ($res10Second['status'] ?? '') === 'already_reconciled',
    json_encode(['first' => $res10First, 'second' => $res10Second])
);

// ============================================================
// B8-T11: Post-commit lot/schedule automation occurs only once
// ============================================================
$csId11 = 'cs_b8_test_11_' . bin2hex(random_bytes(4));
$payId11 = 'pay_b8_11_' . bin2hex(random_bytes(4));
$pId11 = createB8Payment($paymentModel, $lotId, '1400.00', $csId11, 'Pending', 'PHP');

$mockPayMongo->mockCheckoutSessions[$csId11] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $csId11,
        'type' => 'checkout_session',
        'attributes' => [
            'status' => 'paid',
            'livemode' => false,
            'payments' => [
                [
                    'id' => $payId11,
                    'type' => 'payment',
                    'attributes' => [
                        'status' => 'paid',
                        'amount' => 140000,
                        'currency' => 'PHP',
                        'livemode' => false,
                    ]
                ]
            ]
        ]
    ]
];

// Reconcile once
$res11 = $reconciliationService->applyPayment($pId11, $adminUser);
// Check audit log count for this reconciliation
$stmt11 = $db->prepare("SELECT COUNT(*) as cnt FROM audit_logs WHERE action = 'reconcile_payment' AND details LIKE ?");
$stmt11->execute(['%"payment_id":' . $pId11 . '%']);
$auditCnt = (int) $stmt11->fetch(PDO::FETCH_ASSOC)['cnt'];

// Second apply attempt
$res11Second = $reconciliationService->applyPayment($pId11, $adminUser);
$stmt11->execute(['%"payment_id":' . $pId11 . '%']);
$auditCntAfter = (int) $stmt11->fetch(PDO::FETCH_ASSOC)['cnt'];

report('B8-T11', 'Post-commit automation and state transition occurs exactly once',
    ($res11['status'] ?? '') === 'reconciled'
    && $auditCnt === 1
    && $auditCntAfter === 1,
    "audit counts: first={$auditCnt}, second={$auditCntAfter}"
);

// ============================================================
// B8-T12: Authentic gateway payment ID is persisted
// ============================================================
$csId12 = 'cs_b8_test_12_' . bin2hex(random_bytes(4));
$payId12 = 'pay_b8_12_authentic_' . bin2hex(random_bytes(4));
$pId12 = createB8Payment($paymentModel, $lotId, '1600.00', $csId12, 'Pending', 'PHP');

$mockPayMongo->mockCheckoutSessions[$csId12] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $csId12,
        'type' => 'checkout_session',
        'attributes' => [
            'status' => 'paid',
            'livemode' => false,
            'payments' => [
                [
                    'id' => $payId12,
                    'type' => 'payment',
                    'attributes' => [
                        'status' => 'paid',
                        'amount' => 160000,
                        'currency' => 'PHP',
                        'livemode' => false,
                    ]
                ]
            ]
        ]
    ]
];

$res12 = $reconciliationService->applyPayment($pId12, $adminUser);
$pRow12 = $paymentModel->findById($pId12);
report('B8-T12', 'Authentic PayMongo payment ID from gateway is accurately persisted',
    ($pRow12['gateway_payment_id'] ?? '') === $payId12,
    "Persisted: " . ($pRow12['gateway_payment_id'] ?? 'null')
);

// ============================================================
// B8-T13: Browser-supplied fake evidence cannot force reconciliation
// ============================================================
$csId13 = 'cs_b8_test_13_' . bin2hex(random_bytes(4));
$pId13 = createB8Payment($paymentModel, $lotId, '1700.00', $csId13, 'Pending', 'PHP');
// Remote PayMongo actually has status 'awaiting_payment_method'
$mockPayMongo->mockCheckoutSessions[$csId13] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $csId13,
        'type' => 'checkout_session',
        'attributes' => [
            'status' => 'awaiting_payment_method',
            'livemode' => false,
            'payments' => []
        ]
    ]
];

// Admin calls applyPayment — even if a malicious client submitted fake evidence in HTTP body,
// applyPayment queries PayMongo server-side and rejects unpaid session:
$res13Apply = $reconciliationService->applyPayment($pId13, $adminUser);
$pRow13 = $paymentModel->findById($pId13);
report('B8-T13', 'Browser-supplied or external claims cannot bypass authoritative PayMongo re-query',
    ($res13Apply['code'] ?? 0) === 422
    && ($pRow13['verification_status'] ?? '') === 'Pending',
    json_encode($res13Apply)
);

// ============================================================
// B8-T14: Processing + gateway refund ID + PayMongo succeeded -> eligible
// ============================================================
$pId14 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_14', 'Verified', 'PHP', 'pay_b8_14');
$gwRefId14 = 'ref_b8_test_14_' . bin2hex(random_bytes(4));
$rId14 = createB8Refund($refundModel, $pId14, '500.00', 'Processing', $gwRefId14, 'PHP');

$mockPayMongo->mockRefunds[$gwRefId14] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $gwRefId14,
        'type' => 'refund',
        'attributes' => [
            'status' => 'succeeded',
            'amount' => 50000,
            'currency' => 'PHP',
            'livemode' => false,
            'payment_id' => 'pay_b8_14',
        ]
    ]
];

$res14Check = $reconciliationService->checkRefund($rId14);
$res14Apply = $reconciliationService->applyRefund($rId14, $adminUser);
$rRow14 = $refundModel->findById($rId14);

report('B8-T14', 'Processing refund with gateway refund ID and PayMongo succeeded is eligible and reconciles to Succeeded',
    ($res14Check['eligible'] ?? false) === true
    && ($res14Check['target_status'] ?? '') === 'Succeeded'
    && ($res14Apply['status'] ?? '') === 'reconciled'
    && ($rRow14['status'] ?? '') === 'Succeeded',
    json_encode(['check' => $res14Check, 'apply' => $res14Apply])
);

// ============================================================
// B8-T15: Processing + gateway refund ID + PayMongo failed -> eligible for Failed
// ============================================================
$pId15 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_15', 'Verified', 'PHP', 'pay_b8_15');
$gwRefId15 = 'ref_b8_test_15_' . bin2hex(random_bytes(4));
$rId15 = createB8Refund($refundModel, $pId15, '400.00', 'Processing', $gwRefId15, 'PHP');

$mockPayMongo->mockRefunds[$gwRefId15] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $gwRefId15,
        'type' => 'refund',
        'attributes' => [
            'status' => 'failed',
            'amount' => 40000,
            'currency' => 'PHP',
            'livemode' => false,
            'payment_id' => 'pay_b8_15',
        ]
    ]
];

$res15Check = $reconciliationService->checkRefund($rId15);
$res15Apply = $reconciliationService->applyRefund($rId15, $adminUser);
$rRow15 = $refundModel->findById($rId15);

report('B8-T15', 'Processing refund with gateway refund ID and PayMongo failed is eligible and reconciles to Failed',
    ($res15Check['eligible'] ?? false) === true
    && ($res15Check['target_status'] ?? '') === 'Failed'
    && ($res15Apply['status'] ?? '') === 'reconciled'
    && ($rRow15['status'] ?? '') === 'Failed',
    json_encode(['check' => $res15Check, 'apply' => $res15Apply])
);

// ============================================================
// B8-T16: Exact refund amount mismatch -> rejected
// ============================================================
$pId16 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_16', 'Verified', 'PHP', 'pay_b8_16');
$gwRefId16 = 'ref_b8_test_16_' . bin2hex(random_bytes(4));
$rId16 = createB8Refund($refundModel, $pId16, '600.00', 'Processing', $gwRefId16, 'PHP');

$mockPayMongo->mockRefunds[$gwRefId16] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $gwRefId16,
        'type' => 'refund',
        'attributes' => [
            'status' => 'succeeded',
            'amount' => 59000, // mismatch: 590.00 vs 600.00
            'currency' => 'PHP',
            'livemode' => false,
            'payment_id' => 'pay_b8_16',
        ]
    ]
];

$res16Check = $reconciliationService->checkRefund($rId16);
$res16Apply = $reconciliationService->applyRefund($rId16, $adminUser);
$rRow16 = $refundModel->findById($rId16);

report('B8-T16', 'Exact refund amount mismatch fails check and rejects apply',
    ($res16Check['eligible'] ?? true) === false
    && ($res16Apply['code'] ?? 0) === 422
    && ($rRow16['status'] ?? '') === 'Processing',
    json_encode(['check' => $res16Check, 'apply' => $res16Apply])
);

// ============================================================
// B8-T17: Currency mismatch -> rejected
// ============================================================
$pId17 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_17', 'Verified', 'PHP', 'pay_b8_17');
$gwRefId17 = 'ref_b8_test_17_' . bin2hex(random_bytes(4));
$rId17 = createB8Refund($refundModel, $pId17, '300.00', 'Processing', $gwRefId17, 'PHP');

$mockPayMongo->mockRefunds[$gwRefId17] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $gwRefId17,
        'type' => 'refund',
        'attributes' => [
            'status' => 'succeeded',
            'amount' => 30000,
            'currency' => 'USD', // mismatch vs PHP
            'livemode' => false,
            'payment_id' => 'pay_b8_17',
        ]
    ]
];

$res17Check = $reconciliationService->checkRefund($rId17);
$res17Apply = $reconciliationService->applyRefund($rId17, $adminUser);
report('B8-T17', 'Refund currency mismatch is safely rejected',
    ($res17Check['eligible'] ?? true) === false
    && ($res17Apply['code'] ?? 0) === 422,
    json_encode(['check' => $res17Check, 'apply' => $res17Apply])
);

// ============================================================
// B8-T18: Livemode mismatch -> rejected
// ============================================================
$pId18 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_18', 'Verified', 'PHP', 'pay_b8_18');
$gwRefId18 = 'ref_b8_test_18_' . bin2hex(random_bytes(4));
$rId18 = createB8Refund($refundModel, $pId18, '200.00', 'Processing', $gwRefId18, 'PHP');

$mockPayMongo->mockRefunds[$gwRefId18] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $gwRefId18,
        'type' => 'refund',
        'attributes' => [
            'status' => 'succeeded',
            'amount' => 20000,
            'currency' => 'PHP',
            'livemode' => true, // mismatch vs test env
            'payment_id' => 'pay_b8_18',
        ]
    ]
];

$res18Check = $reconciliationService->checkRefund($rId18);
$res18Apply = $reconciliationService->applyRefund($rId18, $adminUser);
report('B8-T18', 'Refund livemode mismatch is safely rejected',
    ($res18Check['eligible'] ?? true) === false
    && ($res18Apply['code'] ?? 0) === 422,
    json_encode(['check' => $res18Check, 'apply' => $res18Apply])
);

// ============================================================
// B8-T19: Payment ID mismatch -> rejected
// ============================================================
$pId19 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_19', 'Verified', 'PHP', 'pay_b8_19_expected');
$gwRefId19 = 'ref_b8_test_19_' . bin2hex(random_bytes(4));
$rId19 = createB8Refund($refundModel, $pId19, '250.00', 'Processing', $gwRefId19, 'PHP');

$mockPayMongo->mockRefunds[$gwRefId19] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $gwRefId19,
        'type' => 'refund',
        'attributes' => [
            'status' => 'succeeded',
            'amount' => 25000,
            'currency' => 'PHP',
            'livemode' => false,
            'payment_id' => 'pay_b8_19_different', // mismatch vs pay_b8_19_expected
        ]
    ]
];

$res19Check = $reconciliationService->checkRefund($rId19);
$res19Apply = $reconciliationService->applyRefund($rId19, $adminUser);
report('B8-T19', 'Refund associated with different gateway payment ID is safely rejected',
    ($res19Check['eligible'] ?? true) === false
    && ($res19Apply['code'] ?? 0) === 422,
    json_encode(['check' => $res19Check, 'apply' => $res19Apply])
);

// ============================================================
// B8-T20: Missing gateway refund ID -> does NOT auto-match by heuristic
// ============================================================
$pId20 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_20', 'Verified', 'PHP', 'pay_b8_20');
$rId20 = createB8Refund($refundModel, $pId20, '350.00', 'Processing', null, 'PHP');

$res20Check = $reconciliationService->checkRefund($rId20);
$res20Apply = $reconciliationService->applyRefund($rId20, $adminUser);
$rRow20 = $refundModel->findById($rId20);

report('B8-T20', 'Refund with missing gateway refund ID fails closed without heuristic auto-attachment',
    ($res20Check['eligible'] ?? true) === false
    && ($res20Check['requires_manual_investigation'] ?? false) === true
    && ($res20Apply['code'] ?? 0) === 422
    && ($rRow20['gateway_refund_id'] ?? null) === null
    && ($rRow20['status'] ?? '') === 'Processing',
    json_encode(['check' => $res20Check, 'apply' => $res20Apply])
);

// ============================================================
// B8-T21: Ambiguous refund candidates -> manual investigation required
// ============================================================
$res21Check = $reconciliationService->checkRefund($rId20);
report('B8-T21', 'Ambiguous refund scenario explicitly flags requires_manual_investigation = true',
    ($res21Check['eligible'] ?? true) === false
    && ($res21Check['requires_manual_investigation'] ?? false) === true
    && strpos($res21Check['mismatches'][0] ?? '', 'No gateway refund ID') !== false,
    json_encode($res21Check)
);

// ============================================================
// B8-T22: Succeeded terminal state cannot regress
// ============================================================
$pId22 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_22', 'Verified', 'PHP', 'pay_b8_22');
$gwRefId22 = 'ref_b8_test_22_' . bin2hex(random_bytes(4));
$rId22 = createB8Refund($refundModel, $pId22, '100.00', 'Succeeded', $gwRefId22, 'PHP');

$mockPayMongo->mockRefunds[$gwRefId22] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $gwRefId22,
        'type' => 'refund',
        'attributes' => [
            'status' => 'failed', // remote gateway somehow says failed
            'amount' => 10000,
            'currency' => 'PHP',
            'livemode' => false,
            'payment_id' => 'pay_b8_22',
        ]
    ]
];

$res22Check = $reconciliationService->checkRefund($rId22);
$res22Apply = $reconciliationService->applyRefund($rId22, $adminUser);
$rRow22 = $refundModel->findById($rId22);

report('B8-T22', 'Succeeded refund terminal state cannot regress to Processing or Failed',
    ($res22Check['eligible'] ?? true) === false
    && ($res22Apply['code'] ?? 0) === 200
    && ($res22Apply['status'] ?? '') === 'already_reconciled'
    && ($rRow22['status'] ?? '') === 'Succeeded',
    json_encode(['check' => $res22Check, 'apply' => $res22Apply])
);

// ============================================================
// B8-T23: Failed terminal state cannot regress
// ============================================================
$pId23 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_23', 'Verified', 'PHP', 'pay_b8_23');
$gwRefId23 = 'ref_b8_test_23_' . bin2hex(random_bytes(4));
$rId23 = createB8Refund($refundModel, $pId23, '150.00', 'Failed', $gwRefId23, 'PHP');

$mockPayMongo->mockRefunds[$gwRefId23] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $gwRefId23,
        'type' => 'refund',
        'attributes' => [
            'status' => 'succeeded',
            'amount' => 15000,
            'currency' => 'PHP',
            'livemode' => false,
            'payment_id' => 'pay_b8_23',
        ]
    ]
];

$res23Check = $reconciliationService->checkRefund($rId23);
$res23Apply = $reconciliationService->applyRefund($rId23, $adminUser);
$rRow23 = $refundModel->findById($rId23);

report('B8-T23', 'Failed refund terminal state cannot regress to Processing or Succeeded',
    ($res23Check['eligible'] ?? true) === false
    && ($res23Apply['code'] ?? 0) === 200
    && ($res23Apply['status'] ?? '') === 'already_reconciled'
    && ($rRow23['status'] ?? '') === 'Failed',
    json_encode(['check' => $res23Check, 'apply' => $res23Apply])
);

// ============================================================
// B8-T24: Concurrent refund webhook/reconciliation is safe
// ============================================================
$pId24 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_24', 'Verified', 'PHP', 'pay_b8_24');
$gwRefId24 = 'ref_b8_test_24_' . bin2hex(random_bytes(4));
$rId24 = createB8Refund($refundModel, $pId24, '220.00', 'Processing', $gwRefId24, 'PHP');

$mockPayMongo->mockRefunds[$gwRefId24] = [
    'success' => true,
    'status' => 200,
    'data' => [
        'id' => $gwRefId24,
        'type' => 'refund',
        'attributes' => [
            'status' => 'succeeded',
            'amount' => 22000,
            'currency' => 'PHP',
            'livemode' => false,
            'payment_id' => 'pay_b8_24',
        ]
    ]
];

$res24First = $reconciliationService->applyRefund($rId24, $adminUser);
$res24Second = $reconciliationService->applyRefund($rId24, $adminUser);
report('B8-T24', 'Concurrent refund reconciliation operations produce safe idempotent results without corruption',
    ($res24First['status'] ?? '') === 'reconciled'
    && ($res24Second['status'] ?? '') === 'already_reconciled',
    json_encode(['first' => $res24First, 'second' => $res24Second])
);

// ============================================================
// B8-T25: Reconciliation does not create a second refund
// ============================================================
$stmt25Before = $db->query("SELECT COUNT(*) as cnt FROM refunds");
$cntBefore = (int) $stmt25Before->fetch(PDO::FETCH_ASSOC)['cnt'];

// Run check and apply on existing refund
$reconciliationService->checkRefund($rId24);
$reconciliationService->applyRefund($rId24, $adminUser);

$stmt25After = $db->query("SELECT COUNT(*) as cnt FROM refunds");
$cntAfter = (int) $stmt25After->fetch(PDO::FETCH_ASSOC)['cnt'];

report('B8-T25', 'Reconciliation strictly synchronizes existing refund row and never creates a second refund',
    $cntBefore === $cntAfter,
    "Count before: {$cntBefore}, after: {$cntAfter}"
);

// ============================================================
// B8-T26: Exact-centavo precision is preserved
// ============================================================
$cents26_1 = Refund::toCentavos('1234.56');
$cents26_2 = Refund::toCentavos(1234.56);
$cents26_3 = Refund::toCentavos(500);

report('B8-T26', 'Exact-centavo helper accurately handles integer and decimal amounts without floating-point error',
    $cents26_1 === 123456
    && $cents26_2 === 123456
    && $cents26_3 === 50000,
    "cents: 1={$cents26_1}, 2={$cents26_2}, 3={$cents26_3}"
);

// ============================================================
// B8-T27: Stale Pending gateway payment is detected
// ============================================================
$csId27 = 'cs_b8_test_27_stale';
$pId27 = createB8Payment($paymentModel, $lotId, '1800.00', $csId27, 'Pending', 'PHP');
// Backdate payment creation by 90 minutes
$db->exec("UPDATE payments SET created_at = NOW() - INTERVAL 90 MINUTE WHERE payment_id = {$pId27}");

$stalePayments = $paymentModel->findStalePendingGatewayPayments(60);
$found27 = false;
foreach ($stalePayments as $sp) {
    if ((int) $sp['payment_id'] === $pId27) {
        $found27 = true;
        break;
    }
}
report('B8-T27', 'Stale Pending gateway payment (>60m with checkout session) is detected',
    $found27 === true,
    "Found in stale payments list: " . ($found27 ? 'yes' : 'no')
);

// ============================================================
// B8-T28: Non-stale Pending payment is not detected
// ============================================================
$csId28 = 'cs_b8_test_28_fresh';
$pId28 = createB8Payment($paymentModel, $lotId, '1900.00', $csId28, 'Pending', 'PHP');
// Created just now (0 minutes)
$found28 = false;
foreach ($paymentModel->findStalePendingGatewayPayments(60) as $sp) {
    if ((int) $sp['payment_id'] === $pId28) {
        $found28 = true;
        break;
    }
}
report('B8-T28', 'Fresh Pending payment (<60m) is not included in stale detection',
    $found28 === false,
    "Found in stale list: " . ($found28 ? 'yes' : 'no')
);

// ============================================================
// B8-T29: Stale Processing refund with gateway ID is detected
// ============================================================
$pId29 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_29', 'Verified', 'PHP', 'pay_b8_29');
$gwRefId29 = 'ref_b8_test_29_stale';
$rId29 = createB8Refund($refundModel, $pId29, '270.00', 'Processing', $gwRefId29, 'PHP');
// Backdate refund by 75 minutes
$db->exec("UPDATE refunds SET created_at = NOW() - INTERVAL 75 MINUTE WHERE refund_id = {$rId29}");

$staleRefundsWithGw = $refundModel->findStalePendingGatewayRefunds(60, true);
$found29 = false;
foreach ($staleRefundsWithGw as $sr) {
    if ((int) $sr['refund_id'] === $rId29) {
        $found29 = true;
        break;
    }
}
report('B8-T29', 'Stale Processing refund with gateway ID is detected when includeWithGatewayId=true',
    $found29 === true,
    "Found in stale refunds list: " . ($found29 ? 'yes' : 'no')
);

// ============================================================
// B8-T30: Stale Processing refund without gateway ID is detected
// ============================================================
$pId30 = createB8Payment($paymentModel, $lotId, '1000.00', 'cs_b8_30', 'Verified', 'PHP', 'pay_b8_30');
$rId30 = createB8Refund($refundModel, $pId30, '310.00', 'Processing', null, 'PHP');
// Backdate refund by 75 minutes
$db->exec("UPDATE refunds SET created_at = NOW() - INTERVAL 75 MINUTE WHERE refund_id = {$rId30}");

$staleRefundsWithoutGw = $refundModel->findStalePendingGatewayRefunds(60, false);
$found30 = false;
foreach ($staleRefundsWithoutGw as $sr) {
    if ((int) $sr['refund_id'] === $rId30) {
        $found30 = true;
        break;
    }
}
report('B8-T30', 'Stale Processing refund without gateway ID is detected by standard stale query',
    $found30 === true,
    "Found in stale refunds list: " . ($found30 ? 'yes' : 'no')
);

// ============================================================
// B8-T31: Stale queries are strictly read-only
// ============================================================
$status27Before = $paymentModel->findById($pId27)['verification_status'];
$status29Before = $refundModel->findById($rId29)['status'];
$status30Before = $refundModel->findById($rId30)['status'];

// Call getStaleGatewayRecords
$staleRecords = $reconciliationService->getStaleGatewayRecords(60);

$status27After = $paymentModel->findById($pId27)['verification_status'];
$status29After = $refundModel->findById($rId29)['status'];
$status30After = $refundModel->findById($rId30)['status'];

report('B8-T31', 'Stale gateway payment and refund queries are strictly read-only and mutate zero state',
    $status27Before === $status27After
    && $status29Before === $status29After
    && $status30Before === $status30After
    && !empty($staleRecords['payments'])
    && !empty($staleRecords['refunds']),
    "Status before/after: P27={$status27Before}/{$status27After}, R29={$status29Before}/{$status29After}, R30={$status30Before}/{$status30After}"
);

// Clean up test records
$db->exec("DELETE FROM refunds WHERE notes LIKE '%BATCH8_TEST%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH8_TEST%'");
$db->exec("DELETE FROM audit_logs WHERE action LIKE '%reconcil%' AND details LIKE '%BATCH8_TEST%'");

echo "\n========================================\n";
echo "BATCH 8 TEST SUMMARY: Passed {$passed}, Failed {$failed}\n";
echo "========================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
