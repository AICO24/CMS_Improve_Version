<?php
/**
 * PayMongo Webhook Receiver & Auto-Verification Tests — Batch 4 (Remediated)
 *
 * Verifies all required Batch 4 contracts against REAL PayMongo Hosted Checkout payloads:
 *  A. Current checkout_session.payment.paid payload accepted
 *  B. Correct Checkout Session ID extracted
 *  C. Correct payment ID extracted (including when payments[0] is failed and payments[1] is paid)
 *  D. Correct amount/currency validated
 *  E. Duplicate delivery safely ignored (idempotent 200)
 *  F. Invalid signature rejected (401)
 *  G. Amount mismatch remains Pending (200 + SystemException)
 *  H. Currency mismatch remains Pending (200 + SystemException)
 *  I. Livemode mismatch remains Pending (200 + SystemException)
 *  J. Successful payment becomes Verified
 *  K. Automation occurs only after commit (Lot status synced to Reserved)
 *  L. No duplicate automation on repeated delivery
 *  M. Malformed JSON & missing fields rejected with 400
 *  Additional: Generic envelope (evt_...) compatibility, missing secret fail-closed (401),
 *              unsupported event type ignored (200), unmatched payment logged (200),
 *              secret never leaked, HMAC round-trip, audit log and notification creation.
 *
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_webhook_b4.php
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
$lotModel = new Lot();
$systemExceptionModel = new SystemException();
$auditLogModel = new AuditLog();
$notificationModel = new Notification();

// Clean up any test records from prior runs
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH4_TEST%'");
$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b4_test%'");

// Establish test webhook secret
$testSecret = 'whsec_test_batch4_secret_key_1234567890';
putenv("PAYMONGO_WEBHOOK_SECRET={$testSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testSecret;

// Set PayMongo environment to test
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';
putenv("PAYMONGO_SECRET_KEY=sk_test_mock_batch4_key");
$_ENV['PAYMONGO_SECRET_KEY'] = 'sk_test_mock_batch4_key';

/**
 * Helper to construct REAL PayMongo Hosted Checkout webhook payload.
 *
 * Real Hosted Checkout webhook structure:
 * {
 *   "event_type": "send.webhook",
 *   "data": {
 *     "type": "checkout_session.payment.paid",
 *     "resource": "checkout_session",
 *     "livemode": false,
 *     "data": {
 *       "id": "cs_xxx",
 *       "type": "checkout_session",
 *       "attributes": {
 *         "status": "paid",
 *         "reference_number": "...",
 *         "payments": [ { "id": "pay_...", "attributes": { "amount": 10000, "currency": "PHP", "status": "paid" } } ],
 *         "payment_intent": { "id": "pi_...", "attributes": { "amount": 10000, "currency": "PHP", "status": "succeeded" } }
 *       }
 *     }
 *   }
 * }
 */
function buildRealHostedCheckoutPayload(
    string $csId,
    int $amountCents,
    string $currency = 'PHP',
    bool $livemode = false,
    string $eventType = 'checkout_session.payment.paid',
    ?string $payId = null,
    string $status = 'paid',
    ?array $customPayments = null
): string {
    if ($customPayments === null) {
        if ($payId === null) {
            $payId = 'pay_b4_test_' . bin2hex(random_bytes(6));
        }
        $payments = [
            [
                'id' => $payId,
                'type' => 'payment',
                'attributes' => [
                    'amount' => $amountCents,
                    'currency' => $currency,
                    'status' => $status,
                    'fee' => 0,
                    'net_amount' => $amountCents,
                ]
            ]
        ];
    } else {
        $payments = $customPayments;
    }

    return json_encode([
        'event_type' => 'send.webhook',
        'data' => [
            'type' => $eventType,
            'resource' => 'checkout_session',
            'livemode' => $livemode,
            'data' => [
                'id' => $csId,
                'type' => 'checkout_session',
                'attributes' => [
                    'status' => $status,
                    'reference_number' => 'RCPT-B4-TEST',
                    'payments' => $payments,
                    'payment_intent' => [
                        'id' => 'pi_test_' . bin2hex(random_bytes(4)),
                        'type' => 'payment_intent',
                        'attributes' => [
                            'amount' => $amountCents,
                            'currency' => $currency,
                            'status' => ($status === 'paid' ? 'succeeded' : $status),
                        ]
                    ]
                ]
            ]
        ]
    ]);
}

/**
 * Helper to construct generic event envelope (with evt_... event ID).
 */
function buildGenericEnvelopePayload(
    string $eventId,
    string $csId,
    int $amountCents,
    string $currency = 'PHP',
    bool $livemode = false,
    string $eventType = 'checkout_session.payment.paid',
    ?string $payId = null,
    string $status = 'paid'
): string {
    if ($payId === null) {
        $payId = 'pay_b4_test_' . bin2hex(random_bytes(6));
    }
    return json_encode([
        'data' => [
            'id' => $eventId,
            'type' => 'event',
            'attributes' => [
                'type' => $eventType,
                'livemode' => $livemode,
                'data' => [
                    'id' => $csId,
                    'type' => 'checkout_session',
                    'attributes' => [
                        'status' => $status,
                        'reference_number' => 'RCPT-B4-TEST',
                        'payments' => [
                            [
                                'id' => $payId,
                                'attributes' => [
                                    'amount' => $amountCents,
                                    'currency' => $currency,
                                    'status' => $status,
                                ]
                            ]
                        ],
                        'payment_intent' => [
                            'id' => 'pi_test_' . bin2hex(random_bytes(4)),
                            'attributes' => [
                                'amount' => $amountCents,
                                'currency' => $currency,
                                'status' => 'succeeded',
                            ]
                        ]
                    ]
                ]
            ]
        ]
    ]);
}

// Helper to generate signature
function makeSignature($rawBody, $secret, $isLive = false, $useTimestamp = true) {
    if (!$useTimestamp) {
        return hash_hmac('sha256', $rawBody, $secret);
    }
    $t = time();
    $hash = hash_hmac('sha256', "{$t}.{$rawBody}", $secret);
    return $isLive ? "t={$t},li={$hash}" : "t={$t},te={$hash}";
}

// Find a lot for testing
$testLot = $db->query("SELECT lot_id, lot_number, price, status FROM lots WHERE status = 'Available' AND price > 100 ORDER BY lot_id ASC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$testLot) {
    $testLot = $db->query("SELECT lot_id, lot_number, price, status FROM lots WHERE price > 100 ORDER BY lot_id ASC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
    if ($testLot) {
        $db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = " . (int)$testLot['lot_id']);
        $testLot['status'] = 'Available';
    }
}

$lotId = (int)$testLot['lot_id'];
$lotPrice = (float)$testLot['price'];
$lotPriceCents = (int) round($lotPrice * 100);

// Helper to create a test payment
function createTestPayment($paymentModel, $lotId, $amount, $csId) {
    $paymentId = $paymentModel->create([
        'transaction_type' => 'Lot Purchase',
        'reference_id' => $lotId,
        'reference_kind' => 'lot',
        'amount' => $amount,
        'payment_date' => date('Y-m-d'),
        'payment_method' => 'PayMongo',
        'receipt_number' => 'RCPT-B4-' . bin2hex(random_bytes(3)),
        'notes' => 'BATCH4_TEST payment',
        'received_by' => 1,
        'verification_status' => 'Pending',
    ]);
    $paymentModel->setGatewaySession($paymentId, 'paymongo', $csId, 'pi_init_' . $paymentId, 'awaiting_payment_method');
    return $paymentId;
}

// ============================================================
// TEST 1 (Contract A & B): Real Hosted Checkout payload accepted & CS ID extracted
// ============================================================
$csId1 = 'cs_b4_test_01_' . bin2hex(random_bytes(4));
$pId1 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId1);
$rawBody1 = buildRealHostedCheckoutPayload($csId1, $lotPriceCents);
$sig1 = makeSignature($rawBody1, $testSecret, false, true);

$res1 = $paymentController->handleWebhook($rawBody1, $sig1);
report(1, 'Contract A & B: Real Hosted Checkout payload accepted & CS ID extracted (HTTP 200, verified)',
    ($res1['code'] ?? 0) === 200 && ($res1['status'] ?? '') === 'verified' && ($res1['payment_id'] ?? 0) === $pId1,
    json_encode($res1)
);

// Verify idempotency record in webhook_events uses $csId1 (no fabricated evt_...)
$evRow1 = $db->query("SELECT * FROM webhook_events WHERE event_id = '{$csId1}'")->fetch(PDO::FETCH_ASSOC);
report('1b', 'webhook_events.event_id stores authoritative cs_... (no fabricated evt_...)',
    !empty($evRow1) && $evRow1['event_id'] === $csId1 && (int)$evRow1['processed'] === 1,
    'event_id=' . ($evRow1['event_id'] ?? 'null')
);

// ============================================================
// TEST 2 (Contract F): Invalid signature rejection
// ============================================================
$rawBody2 = buildRealHostedCheckoutPayload('cs_dummy', 10000);
$sig2 = 't=' . time() . ',te=bad_signature_hash_00000000000000000000000000000000';
$res2 = $paymentController->handleWebhook($rawBody2, $sig2);
report(2, 'Contract F: Invalid signature rejected with HTTP 401', ($res2['code'] ?? 0) === 401, json_encode($res2));

// ============================================================
// TEST 3: Missing signature header rejection
// ============================================================
$rawBody3 = buildRealHostedCheckoutPayload('cs_dummy', 10000);
$res3 = $paymentController->handleWebhook($rawBody3, '');
report(3, 'Missing signature header rejected with HTTP 401', ($res3['code'] ?? 0) === 401, json_encode($res3));

// ============================================================
// TEST 4: Missing webhook signing secret fails closed
// ============================================================
putenv("PAYMONGO_WEBHOOK_SECRET=");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = '';
$res4 = $paymentController->handleWebhook($rawBody1, $sig1);
report(4, 'Missing webhook secret fails closed with HTTP 401', ($res4['code'] ?? 0) === 401, json_encode($res4));
// Restore secret
putenv("PAYMONGO_WEBHOOK_SECRET={$testSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testSecret;

// ============================================================
// TEST 5: Unknown event safely ignored (HTTP 200)
// ============================================================
$csId5 = 'cs_b4_test_05_' . bin2hex(random_bytes(4));
$rawBody5 = buildRealHostedCheckoutPayload($csId5, 10000, 'PHP', false, 'payment.failed');
$sig5 = makeSignature($rawBody5, $testSecret);
$res5 = $paymentController->handleWebhook($rawBody5, $sig5);
report(5, 'Unknown event type safely ignored with HTTP 200', ($res5['code'] ?? 0) === 200 && ($res5['status'] ?? '') === 'ignored', json_encode($res5));

// ============================================================
// TEST 6: Valid event with no matching CMS payment (200 + SystemException)
// ============================================================
$csId6 = 'cs_b4_test_nonexistent_' . bin2hex(random_bytes(4));
$rawBody6 = buildRealHostedCheckoutPayload($csId6, 50000);
$sig6 = makeSignature($rawBody6, $testSecret);
$res6 = $paymentController->handleWebhook($rawBody6, $sig6);

$exc6 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.webhook_unmatched' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
report(6, 'Valid event with unmatched payment returns 200 and logs SystemException',
    ($res6['code'] ?? 0) === 200 && ($res6['status'] ?? '') === 'unmatched' && !empty($exc6),
    json_encode($res6)
);

// ============================================================
// TEST 7 (Contract G): Amount mismatch (200 + no verification + SystemException)
// ============================================================
$csId7 = 'cs_b4_test_07_' . bin2hex(random_bytes(4));
$pId7 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId7);
// Tampered amount: 100 cents less
$tamperedAmountCents = $lotPriceCents - 100;
$rawBody7 = buildRealHostedCheckoutPayload($csId7, $tamperedAmountCents);
$sig7 = makeSignature($rawBody7, $testSecret);
$res7 = $paymentController->handleWebhook($rawBody7, $sig7);

$paymentRow7 = $paymentModel->findById($pId7);
$exc7 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.webhook_amount_mismatch' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
report(7, 'Contract G: Amount mismatch returns 200, logs SystemException, and payment remains Pending',
    ($res7['code'] ?? 0) === 200 && ($res7['status'] ?? '') === 'mismatch'
    && ($paymentRow7['verification_status'] ?? '') === 'Pending'
    && !empty($exc7),
    json_encode($res7)
);

// ============================================================
// TEST 8 (Contract H): Currency mismatch (200 + no verification + SystemException)
// ============================================================
$csId8 = 'cs_b4_test_08_' . bin2hex(random_bytes(4));
$pId8 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId8);
$rawBody8 = buildRealHostedCheckoutPayload($csId8, $lotPriceCents, 'USD');
$sig8 = makeSignature($rawBody8, $testSecret);
$res8 = $paymentController->handleWebhook($rawBody8, $sig8);

$paymentRow8 = $paymentModel->findById($pId8);
$exc8 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.webhook_currency_mismatch' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
report(8, 'Contract H: Currency mismatch returns 200, logs SystemException, and payment remains Pending',
    ($res8['code'] ?? 0) === 200 && ($res8['status'] ?? '') === 'mismatch'
    && ($paymentRow8['verification_status'] ?? '') === 'Pending'
    && !empty($exc8),
    json_encode($res8)
);

// ============================================================
// TEST 9 (Contract I): Environment/livemode mismatch (200 + no verification + SystemException)
// ============================================================
$csId9 = 'cs_b4_test_09_' . bin2hex(random_bytes(4));
$pId9 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId9);
// Webhook claims livemode = true, but CMS is configured in test mode
$rawBody9 = buildRealHostedCheckoutPayload($csId9, $lotPriceCents, 'PHP', true);
$sig9 = makeSignature($rawBody9, $testSecret, true);
$res9 = $paymentController->handleWebhook($rawBody9, $sig9);

$paymentRow9 = $paymentModel->findById($pId9);
$exc9 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.webhook_environment_mismatch' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
report(9, 'Contract I: Livemode mismatch returns 200, logs SystemException, and payment remains Pending',
    ($res9['code'] ?? 0) === 200 && ($res9['status'] ?? '') === 'mismatch'
    && ($paymentRow9['verification_status'] ?? '') === 'Pending'
    && !empty($exc9),
    json_encode($res9)
);

// ============================================================
// TEST 10: Already Verified payment -> safe no-op (200)
// ============================================================
$csId10 = 'cs_b4_test_10_' . bin2hex(random_bytes(4));
$pId10 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId10);
// Manually mark payment as Verified first
$paymentModel->verifyIfPending($pId10, 'Verified', 1, date('Y-m-d H:i:s'));

$rawBody10 = buildRealHostedCheckoutPayload($csId10, $lotPriceCents);
$sig10 = makeSignature($rawBody10, $testSecret);
$res10 = $paymentController->handleWebhook($rawBody10, $sig10);

report(10, 'Already Verified payment handled safely with 200 as no-op',
    ($res10['code'] ?? 0) === 200 && ($res10['status'] ?? '') === 'already_reviewed',
    json_encode($res10)
);

// ============================================================
// TEST 11 (Contract E): Duplicate delivery -> safe no-op (200)
// ============================================================
// Send rawBody1 again (which was already processed in TEST 1)
$res11 = $paymentController->handleWebhook($rawBody1, $sig1);
report(11, 'Contract E: Duplicate delivery detected and returned with HTTP 200 without duplicate action',
    ($res11['code'] ?? 0) === 200 && ($res11['status'] ?? '') === 'duplicate',
    json_encode($res11)
);

// ============================================================
// TEST 12 (Contract J & D): Valid payment -> Pending becomes Verified with correct amount/currency
// ============================================================
$csId12 = 'cs_b4_test_12_' . bin2hex(random_bytes(4));
$pId12 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId12);
$payId12 = 'pay_real_test_' . bin2hex(random_bytes(4));
$rawBody12 = buildRealHostedCheckoutPayload($csId12, $lotPriceCents, 'PHP', false, 'checkout_session.payment.paid', $payId12, 'paid');
$sig12 = makeSignature($rawBody12, $testSecret);

$res12 = $paymentController->handleWebhook($rawBody12, $sig12);
$paymentRow12 = $paymentModel->findById($pId12);
report(12, 'Contract J & D: Valid payment transitions from Pending to Verified (amount & currency match)',
    ($res12['code'] ?? 0) === 200 && ($paymentRow12['verification_status'] ?? '') === 'Verified',
    'status=' . ($paymentRow12['verification_status'] ?? 'null')
);

// ============================================================
// TEST 13 (Contract C): Correct payment ID extracted from payments[] array
// (Specifically: payments[0] failed attempt, payments[1] successful paid attempt)
// ============================================================
$csId13 = 'cs_b4_test_13_' . bin2hex(random_bytes(4));
$pId13 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId13);
$failedPayId = 'pay_failed_attempt_001';
$successPayId = 'pay_success_attempt_002';
$multiplePayments = [
    [
        'id' => $failedPayId,
        'type' => 'payment',
        'attributes' => [
            'amount' => $lotPriceCents,
            'currency' => 'PHP',
            'status' => 'failed',
            'fee' => 0,
            'net_amount' => $lotPriceCents,
        ]
    ],
    [
        'id' => $successPayId,
        'type' => 'payment',
        'attributes' => [
            'amount' => $lotPriceCents,
            'currency' => 'PHP',
            'status' => 'paid',
            'fee' => 250,
            'net_amount' => $lotPriceCents - 250,
        ]
    ]
];
$rawBody13 = buildRealHostedCheckoutPayload($csId13, $lotPriceCents, 'PHP', false, 'checkout_session.payment.paid', null, 'paid', $multiplePayments);
$sig13 = makeSignature($rawBody13, $testSecret);

$res13 = $paymentController->handleWebhook($rawBody13, $sig13);
$paymentRow13 = $paymentModel->findById($pId13);
report(13, 'Contract C: Correct successful payment ID extracted when payments[0] is failed and payments[1] is paid',
    ($paymentRow13['gateway_payment_id'] ?? '') === $successPayId && ($paymentRow13['gateway_status'] ?? '') === 'paid',
    'expected=' . $successPayId . ' actual=' . ($paymentRow13['gateway_payment_id'] ?? 'null')
);

// ============================================================
// TEST 14: PayMongo gateway status persisted
// ============================================================
report(14, 'gateway_status persisted to payments row',
    ($paymentRow12['gateway_status'] ?? '') === 'paid',
    'persisted=' . ($paymentRow12['gateway_status'] ?? 'null')
);

// ============================================================
// TEST 15 (Contract K): AutomationEngine triggered post-commit: Lot status synced to Reserved
// ============================================================
// Ensure lot is Available first
$db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = {$lotId}");
$csId15 = 'cs_b4_test_15_' . bin2hex(random_bytes(4));
$pId15 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId15);
$rawBody15 = buildRealHostedCheckoutPayload($csId15, $lotPriceCents);
$sig15 = makeSignature($rawBody15, $testSecret);

$res15 = $paymentController->handleWebhook($rawBody15, $sig15);
$updatedLot = $lotModel->findById($lotId);
report(15, 'Contract K: AutomationEngine triggered post-commit: Lot status synced to Reserved',
    ($updatedLot['status'] ?? '') === 'Reserved',
    'lot_status=' . ($updatedLot['status'] ?? 'null')
);

// ============================================================
// TEST 16 (Contract L): No duplicate automation on repeated delivery
// ============================================================
// Re-deliver $rawBody15
$auditCountBefore = (int) $db->query("SELECT COUNT(*) FROM audit_logs WHERE entity_type = 'Payment' AND entity_id = {$pId15}")->fetchColumn();
$res16 = $paymentController->handleWebhook($rawBody15, $sig15);
$auditCountAfter = (int) $db->query("SELECT COUNT(*) FROM audit_logs WHERE entity_type = 'Payment' AND entity_id = {$pId15}")->fetchColumn();
report(16, 'Contract L: No duplicate automation or audit logs on repeated delivery',
    ($res16['code'] ?? 0) === 200 && ($res16['status'] ?? '') === 'duplicate' && $auditCountBefore === $auditCountAfter,
    "res={$res16['status']} before={$auditCountBefore} after={$auditCountAfter}"
);

// ============================================================
// TEST 17: Webhook secret never appears in response/log/error output
// ============================================================
$secretExposed = false;
$allOutputs = [
    json_encode($res1), json_encode($res2), json_encode($res3),
    json_encode($res4), json_encode($res6), json_encode($res7), json_encode($res13)
];
foreach ($allOutputs as $out) {
    if (strpos($out, $testSecret) !== false) {
        $secretExposed = true;
    }
}
$recentExceptions = $db->query("SELECT reason, context FROM system_exceptions ORDER BY exception_id DESC LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);
foreach ($recentExceptions as $exc) {
    if (strpos($exc['reason'], $testSecret) !== false || strpos((string)$exc['context'], $testSecret) !== false) {
        $secretExposed = true;
    }
}
report(17, 'Webhook signing secret NEVER appears in response body, logs, or exceptions', !$secretExposed, 'Secret was leaked!');

// ============================================================
// TEST 18: HMAC known-body round-trip (both timestamped format and raw HMAC)
// ============================================================
$knownBody = '{"test":"payload","id":"123"}';
$knownSecret = 'secret_key_abc_xyz';
$expectedRawHmac = hash_hmac('sha256', $knownBody, $knownSecret);

putenv("PAYMONGO_WEBHOOK_SECRET={$knownSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $knownSecret;

// Test direct HMAC acceptance
$csId18 = 'cs_b4_test_18_' . bin2hex(random_bytes(4));
$pId18 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId18);
$rawBody18 = buildRealHostedCheckoutPayload($csId18, $lotPriceCents);
$directSig18 = hash_hmac('sha256', $rawBody18, $knownSecret);

$res18 = $paymentController->handleWebhook($rawBody18, $directSig18);
report(18, 'HMAC round-trip verified: direct HMAC signature verified successfully',
    ($res18['code'] ?? 0) === 200 && ($res18['status'] ?? '') === 'verified',
    json_encode($res18)
);

// Restore secret
putenv("PAYMONGO_WEBHOOK_SECRET={$testSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testSecret;

// ============================================================
// TEST 19: AuditLog and Notification records created correctly
// ============================================================
$auditEntry = $db->query("SELECT * FROM audit_logs WHERE entity_type = 'Payment' AND entity_id = {$pId18} ORDER BY log_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$notifEntry = $db->query("SELECT * FROM notifications WHERE notification_type = 'Payment' AND user_id = 1 ORDER BY notification_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);

report(19, 'AuditLog and Notification created for webhook-verified payment',
    !empty($auditEntry) && strpos($auditEntry['action'], 'Payment verified') !== false && !empty($notifEntry),
    'audit=' . json_encode($auditEntry) . ' notif=' . json_encode($notifEntry)
);

// ============================================================
// TEST 20 (Contract M): Malformed JSON handled safely (400)
// ============================================================
$malformedBody = '{"bad_json: missing_brace';
$malformedSig = makeSignature($malformedBody, $testSecret);
$res20 = $paymentController->handleWebhook($malformedBody, $malformedSig);
report(20, 'Contract M: Malformed JSON rejected safely with HTTP 400', ($res20['code'] ?? 0) === 400, json_encode($res20));

// ============================================================
// TEST 21 (Contract M): Missing required event envelope fields handled safely (400)
// ============================================================
$emptyEventBody = json_encode(['data' => ['id' => '']]);
$emptyEventSig = makeSignature($emptyEventBody, $testSecret);
$res21 = $paymentController->handleWebhook($emptyEventBody, $emptyEventSig);
report(21, 'Contract M: Missing required event fields rejected with HTTP 400', ($res21['code'] ?? 0) === 400, json_encode($res21));

// ============================================================
// TEST 22: Generic event envelope (with evt_... ID) backward-compatibility
// ============================================================
$csId22 = 'cs_b4_test_22_' . bin2hex(random_bytes(4));
$pId22 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId22);
$evtId22 = 'evt_b4_test_22_' . bin2hex(random_bytes(4));
$rawBody22 = buildGenericEnvelopePayload($evtId22, $csId22, $lotPriceCents);
$sig22 = makeSignature($rawBody22, $testSecret);

$res22 = $paymentController->handleWebhook($rawBody22, $sig22);
$paymentRow22 = $paymentModel->findById($pId22);
$evRow22 = $db->query("SELECT * FROM webhook_events WHERE event_id = '{$evtId22}'")->fetch(PDO::FETCH_ASSOC);

report(22, 'Generic event envelope with evt_... ID accepted & stores evt_... in webhook_events',
    ($res22['code'] ?? 0) === 200 && ($paymentRow22['verification_status'] ?? '') === 'Verified' && !empty($evRow22),
    'status=' . ($paymentRow22['verification_status'] ?? 'null') . ' evt_saved=' . ($evRow22['event_id'] ?? 'null')
);

// Cleanup test payments and test webhook events
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH4_TEST%'");
$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b4_test%'");

echo "\n======================================================\n";
echo "PayMongo Batch 4 Webhook Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
