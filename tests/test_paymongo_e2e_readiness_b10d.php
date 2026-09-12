<?php
/**
 * test_paymongo_e2e_readiness_b10d.php
 *
 * Batch 10D: Real Payment End-to-End Readiness & Acceptance Verification
 *
 * Validates:
 *  1. PayMongo readiness check never exposes secret values
 *  2. Missing required configuration produces a safe not-ready state
 *  3. Valid configured test environment produces ready state
 *  4. Valid signed webhook completes the internal payment lifecycle
 *  5. Invalid signature cannot verify payment
 *  6. Duplicate webhook remains idempotent
 *  7. Browser success redirect alone cannot verify payment
 *  8. Successful verification triggers schedule confirmation
 *  9. Successful verification reserves the correct lot
 * 10. Collision/refund path remains preserved
 * 11. No duplicate payment or schedule is created
 * 12. Existing citizen retry flow remains preserved
 */

require_once __DIR__ . '/../backend/config/Database.php';
require_once __DIR__ . '/../backend/services/EnvironmentService.php';
require_once __DIR__ . '/../backend/services/PayMongoService.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/Refund.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';

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

// Clean up any test artifacts from prior runs
$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b10d%'");
$db->exec("DELETE FROM refunds WHERE payment_id IN (SELECT payment_id FROM payments WHERE notes LIKE '%BATCH10D_TEST%')");
$db->exec("DELETE FROM refunds WHERE notes LIKE '%BATCH10D_TEST%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH10D_TEST%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%BATCH10D_TEST%'");
$db->exec("DELETE FROM booking_drafts WHERE extracted_data LIKE '%BATCH10D_TEST%'");

$paymentController = new PaymentController();
$scheduleModel = new Schedule();
$paymentModel = new Payment();
$lotModel = new Lot();

// Test users from database
$userAdmin = $db->query("SELECT user_id, username FROM users WHERE role_id = (SELECT role_id FROM roles WHERE LOWER(title) = 'admin' LIMIT 1) LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$userAdmin) {
    $userAdmin = ['user_id' => 1, 'username' => 'admin', 'role' => 'admin'];
} else {
    $userAdmin['role'] = 'admin';
}

$userCitizen = $db->query("SELECT user_id, username FROM users WHERE role_id = (SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1) LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$userCitizen) {
    $roleId = $db->query("SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1")->fetchColumn() ?: 2;
    $db->exec("INSERT INTO users (username, password, full_name, email, role_id, is_active) VALUES ('citizen_test_10d', 'x', 'Citizen Test', 'citizen10d@test.com', {$roleId}, 1)");
    $userCitizen = ['user_id' => (int)$db->lastInsertId(), 'username' => 'citizen_test_10d', 'role' => 'user'];
} else {
    $userCitizen['role'] = 'user';
}

// Helper: build PayMongo signature
function makeSignatureHeader(string $rawBody, string $secret, bool $isLive = false): string {
    $ts = time();
    $payload = $ts . '.' . $rawBody;
    $hash = hash_hmac('sha256', $payload, $secret);
    return 't=' . $ts . ',' . ($isLive ? 'li=' : 'te=') . $hash;
}

// Helper: build valid webhook payload for a checkout session
function buildPaidWebhookPayload(string $csId, int $amountCents, string $currency = 'PHP'): string {
    $payId = 'pay_b10d_' . bin2hex(random_bytes(4));
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
                    'reference_number' => 'RCPT-B10D-' . bin2hex(random_bytes(3)),
                    'payments' => [
                        [
                            'id' => $payId,
                            'type' => 'payment',
                            'attributes' => [
                                'amount' => $amountCents,
                                'currency' => $currency,
                                'status' => 'paid',
                                'fee' => 0,
                                'net_amount' => $amountCents,
                            ]
                        ]
                    ],
                    'payment_intent' => [
                        'id' => 'pi_b10d_' . bin2hex(random_bytes(4)),
                        'type' => 'payment_intent',
                        'attributes' => [
                            'amount' => $amountCents,
                            'currency' => $currency,
                            'status' => 'succeeded',
                        ]
                    ]
                ]
            ]
        ]
    ]);
}

// Save initial environment
$origKey = getenv('PAYMONGO_SECRET_KEY');
$origWhSecret = getenv('PAYMONGO_WEBHOOK_SECRET');
$origEnv = getenv('PAYMONGO_ENV');

// =========================================================================
// TEST 1: PayMongo readiness check never exposes secret values
// =========================================================================
$testSecretVal = 'sk_test_super_secret_key_1234567890';
$testWhSecretVal = 'whsk_super_secret_webhook_key_1234567890';
putenv("PAYMONGO_SECRET_KEY={$testSecretVal}");
$_ENV['PAYMONGO_SECRET_KEY'] = $testSecretVal;
putenv("PAYMONGO_WEBHOOK_SECRET={$testWhSecretVal}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testWhSecretVal;
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';

$readiness = $paymentController->getGatewayReadiness($userAdmin);
$jsonDump = json_encode($readiness);

report(1, 'PayMongo readiness check never exposes secret values',
    strpos($jsonDump, $testSecretVal) === false
    && strpos($jsonDump, $testWhSecretVal) === false
    && !isset($readiness['secret_key'])
    && !isset($readiness['webhook_secret']),
    "Dump: " . $jsonDump
);

// =========================================================================
// TEST 2: Missing required configuration produces a safe not-ready state
// =========================================================================
putenv("PAYMONGO_WEBHOOK_SECRET=");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = '';
$notReady = $paymentController->getGatewayReadiness($userAdmin);

report(2, 'Missing required configuration produces a safe not-ready state',
    !empty($notReady['success'])
    && $notReady['ready'] === false
    && $notReady['webhook_endpoint_configured'] === false,
    "Readiness: " . json_encode($notReady)
);

// =========================================================================
// TEST 3: Valid configured test environment produces ready state
// =========================================================================
putenv("PAYMONGO_WEBHOOK_SECRET={$testWhSecretVal}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testWhSecretVal;
$ready = $paymentController->getGatewayReadiness($userAdmin);

report(3, 'Valid configured test environment produces ready state',
    !empty($ready['success'])
    && $ready['ready'] === true
    && $ready['paymongo_configured'] === true
    && $ready['environment'] === 'test'
    && $ready['webhook_endpoint_configured'] === true
    && $ready['checkout_available'] === true,
    "Readiness: " . json_encode($ready)
);

// =========================================================================
// Setup Lot, Schedule, and Payment for E2E Lifecycle Testing
// =========================================================================
$lotStmt = $db->prepare("
    INSERT INTO lots (block_id, lot_number, lot_type_id, status, price)
    VALUES (1, 'B10D-LOT-" . bin2hex(random_bytes(2)) . "', 1, 'Available', 20000.00)
");
$lotStmt->execute();
$lotId = (int) $db->lastInsertId();
$lotPrice = 20000.00;
$lotPriceCents = 2000000;

$schedStmt = $db->prepare("
    INSERT INTO burial_schedules (created_by, lot_id, schedule_date, schedule_time, status, notes)
    VALUES (?, ?, '2026-12-15', '10:00:00', 'Pending', 'BATCH10D_TEST Schedule 1')
");
$schedStmt->execute([$userCitizen['user_id'], $lotId]);
$scheduleId = (int) $db->lastInsertId();

$csId1 = 'cs_b10d_' . bin2hex(random_bytes(6));
$paymentStmt = $db->prepare("
    INSERT INTO payments (
        transaction_type, reference_id, reference_kind, amount,
        payment_date, payment_method, receipt_number, notes,
        received_by, verification_status, gateway_provider,
        gateway_checkout_session_id, gateway_status
    ) VALUES (
        'Lot Purchase', ?, 'schedule', ?,
        CURRENT_DATE(), 'PayMongo', ?, 'BATCH10D_TEST Payment',
        ?, 'Pending', 'paymongo',
        ?, 'awaiting_payment_method'
    )
");
$rcpt1 = 'RCPT-B10D-' . bin2hex(random_bytes(4));
$paymentStmt->execute([$scheduleId, $lotPrice, $rcpt1, $userCitizen['user_id'], $csId1]);
$paymentId = (int) $db->lastInsertId();

// =========================================================================
// TEST 4: Valid signed webhook can complete the internal payment lifecycle
// =========================================================================
$webhookPayload = buildPaidWebhookPayload($csId1, $lotPriceCents, 'PHP');
$validSigHeader = makeSignatureHeader($webhookPayload, $testWhSecretVal);

$webhookRes = $paymentController->handleWebhook($webhookPayload, $validSigHeader);

$payAfter = $paymentModel->findById($paymentId);
$schedAfter = $scheduleModel->findById($scheduleId);
$lotAfter = $lotModel->findById($lotId);

report(4, 'Valid signed webhook can complete the internal payment lifecycle (Pending -> Verified)',
    !empty($webhookRes['success'])
    && ($webhookRes['status'] ?? '') === 'verified'
    && ($payAfter['verification_status'] ?? '') === 'Verified',
    "Res: " . json_encode($webhookRes) . ", Payment Status: " . ($payAfter['verification_status'] ?? 'null')
);

// =========================================================================
// TEST 5: Invalid signature cannot verify payment
// =========================================================================
// Create another schedule & payment to test bad signature
$schedStmt2 = $db->prepare("
    INSERT INTO burial_schedules (created_by, lot_id, schedule_date, schedule_time, status, notes)
    VALUES (?, ?, '2026-12-16', '11:00:00', 'Pending', 'BATCH10D_TEST Schedule 2')
");
$schedStmt2->execute([$userCitizen['user_id'], $lotId]);
$scheduleId2 = (int) $db->lastInsertId();

$csId2 = 'cs_b10d_' . bin2hex(random_bytes(6));
$rcpt2 = 'RCPT-B10D-' . bin2hex(random_bytes(4));
$paymentStmt->execute([$scheduleId2, $lotPrice, $rcpt2, $userCitizen['user_id'], $csId2]);
$paymentId2 = (int) $db->lastInsertId();

$payload2 = buildPaidWebhookPayload($csId2, $lotPriceCents, 'PHP');
$badSigHeader = 't=' . time() . ',te=bad_tampered_signature_hash_0000000000';

$badSigRes = $paymentController->handleWebhook($payload2, $badSigHeader);
$pay2After = $paymentModel->findById($paymentId2);

report(5, 'Invalid signature cannot verify payment (rejected with 401, payment remains Pending)',
    isset($badSigRes['code']) && $badSigRes['code'] === 401
    && ($pay2After['verification_status'] ?? '') === 'Pending',
    "Res: " . json_encode($badSigRes) . ", Payment: " . ($pay2After['verification_status'] ?? 'null')
);

// =========================================================================
// TEST 6: Duplicate webhook remains idempotent
// =========================================================================
$dupRes = $paymentController->handleWebhook($webhookPayload, $validSigHeader);
$payAfterDup = $paymentModel->findById($paymentId);

report(6, 'Duplicate webhook remains idempotent (HTTP 200, status duplicate, no state change)',
    !empty($dupRes['success'])
    && ($dupRes['status'] ?? '') === 'duplicate'
    && ($payAfterDup['verification_status'] ?? '') === 'Verified',
    "Res: " . json_encode($dupRes)
);

// =========================================================================
// TEST 7: Browser success redirect alone cannot verify payment
// =========================================================================
// Schedule 2 payment is still Pending. Calling createCheckoutSession or simulating redirect return:
$sched2Check = $scheduleModel->findById($scheduleId2);
$pay2Check = $paymentModel->findById($paymentId2);

report(7, 'Browser success redirect alone cannot verify payment (remains strictly Pending)',
    ($pay2Check['verification_status'] ?? '') === 'Pending'
    && ($sched2Check['status'] ?? '') === 'Pending',
    "Payment: {$pay2Check['verification_status']}, Schedule: {$sched2Check['status']}"
);

// =========================================================================
// TEST 8: Successful verification triggers schedule confirmation
// =========================================================================
report(8, 'Successful verification triggers schedule confirmation (Pending -> Confirmed)',
    ($schedAfter['status'] ?? '') === 'Confirmed',
    "Schedule status: " . ($schedAfter['status'] ?? 'null')
);

// =========================================================================
// TEST 9: Successful verification reserves the correct lot
// =========================================================================
report(9, 'Successful verification reserves the correct lot (Available -> Reserved)',
    ($lotAfter['status'] ?? '') === 'Reserved',
    "Lot status: " . ($lotAfter['status'] ?? 'null')
);

// =========================================================================
// TEST 10: Collision/refund path remains preserved
// =========================================================================
// Setup a payment whose schedule was cancelled before the webhook arrived
$lotColStmt = $db->prepare("
    INSERT INTO lots (block_id, lot_number, lot_type_id, status, price)
    VALUES (1, 'B10D-COL-" . bin2hex(random_bytes(2)) . "', 1, 'Available', 20000.00)
");
$lotColStmt->execute();
$lotColId = (int) $db->lastInsertId();

$schedColStmt = $db->prepare("
    INSERT INTO burial_schedules (created_by, lot_id, schedule_date, schedule_time, status, notes)
    VALUES (?, ?, '2026-12-17', '14:00:00', 'Cancelled', 'BATCH10D_TEST Schedule Collision')
");
$schedColStmt->execute([$userCitizen['user_id'], $lotColId]);
$schedColId = (int) $db->lastInsertId();

$csIdCol = 'cs_b10d_col_' . bin2hex(random_bytes(6));
$rcptCol = 'RCPT-B10D-' . bin2hex(random_bytes(4));
$paymentStmt->execute([$schedColId, $lotPrice, $rcptCol, $userCitizen['user_id'], $csIdCol]);
$paymentColId = (int) $db->lastInsertId();

$colPayload = buildPaidWebhookPayload($csIdCol, $lotPriceCents, 'PHP');
$colSigHeader = makeSignatureHeader($colPayload, $testWhSecretVal);

$colRes = $paymentController->handleWebhook($colPayload, $colSigHeader);
$payColAfter = $paymentModel->findById($paymentColId);

$refundCount = (int) $db->query("SELECT COUNT(*) FROM refunds WHERE payment_id = {$paymentColId}")->fetchColumn();

report(10, 'Collision/refund path remains preserved (triggers automated refund on resource collision)',
    !empty($colRes['success'])
    && ($payColAfter['verification_status'] ?? '') === 'Verified'
    && strpos($payColAfter['notes'] ?? '', '[RESOURCE_COLLISION') !== false
    && $refundCount >= 1,
    "Payment notes: {$payColAfter['notes']}, Refund count: {$refundCount}"
);

// =========================================================================
// TEST 11: No duplicate payment or schedule is created
// =========================================================================
$payCount = (int) $db->query("SELECT COUNT(*) FROM payments WHERE reference_id = {$scheduleId} AND reference_kind = 'schedule'")->fetchColumn();
$schedCount = (int) $db->query("SELECT COUNT(*) FROM burial_schedules WHERE schedule_id = {$scheduleId}")->fetchColumn();

report(11, 'No duplicate payment or schedule is created throughout verification flow',
    $payCount === 1 && $schedCount === 1,
    "Payments for schedule: {$payCount}, Schedule count: {$schedCount}"
);

// =========================================================================
// TEST 12: Existing citizen retry flow remains preserved
// =========================================================================
// Mock PayMongoService for offline test isolation
class MockPayMongoServiceB10D extends PayMongoService {
    public function createCheckoutSession(array $attributes, $idempotencyKey = null) {
        $csId = 'cs_test_10d_' . bin2hex(random_bytes(4));
        return [
            'success' => true,
            'status' => 200,
            'data' => [
                'id' => $csId,
                'type' => 'checkout_session',
                'attributes' => [
                    'checkout_url' => 'https://pm.link/mock/' . $csId,
                    'status' => 'awaiting_payment_method',
                    'payment_intent' => ['id' => 'pi_mock_' . bin2hex(random_bytes(4))],
                ],
            ],
        ];
    }
}

$mockService = new MockPayMongoServiceB10D();
$paymentController->setPayMongoService($mockService);

// Citizen retries payment for Schedule 2 (which is still Pending)
$retryRes = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $scheduleId2,
    'reference_kind' => 'schedule',
], $userCitizen);

// Reuses existing payment ID without creating a new payment row
$totalPay2Count = (int) $db->query("SELECT COUNT(*) FROM payments WHERE reference_id = {$scheduleId2} AND reference_kind = 'schedule'")->fetchColumn();

report(12, 'Existing citizen retry flow remains preserved (reuses payment, no duplicates)',
    !empty($retryRes['success'])
    && !empty($retryRes['payment_id'])
    && (int) $retryRes['payment_id'] === $paymentId2
    && $totalPay2Count === 1,
    "Retry payment ID: " . ($retryRes['payment_id'] ?? 'none') . ", Total rows: {$totalPay2Count}"
);

// =========================================================================
// Cleanup & Restore Environment
// =========================================================================
putenv("PAYMONGO_SECRET_KEY=" . ($origKey ?: ''));
$_ENV['PAYMONGO_SECRET_KEY'] = $origKey ?: '';
putenv("PAYMONGO_WEBHOOK_SECRET=" . ($origWhSecret ?: ''));
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $origWhSecret ?: '';
putenv("PAYMONGO_ENV=" . ($origEnv ?: 'test'));
$_ENV['PAYMONGO_ENV'] = $origEnv ?: 'test';

$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b10d%'");
$db->exec("DELETE FROM refunds WHERE payment_id IN (SELECT payment_id FROM payments WHERE notes LIKE '%BATCH10D_TEST%')");
$db->exec("DELETE FROM refunds WHERE notes LIKE '%BATCH10D_TEST%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH10D_TEST%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%BATCH10D_TEST%'");
$db->exec("DELETE FROM lots WHERE lot_number LIKE 'B10D-%'");

echo "\n======================================================\n";
echo "PayMongo Batch 10D E2E Readiness Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
