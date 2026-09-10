<?php
/**
 * PayMongo Webhook Receiver & Auto-Verification Tests — Batch 4
 *
 * Verifies all required Batch 4 contracts:
 *  1. Valid signature acceptance.
 *  2. Invalid signature rejection (401).
 *  3. Missing signature header rejection (401).
 *  4. Missing webhook signing secret fails closed (401).
 *  5. Unknown/unsupported event type ignored safely (200).
 *  6. Valid event with no matching CMS payment (200 + SystemException).
 *  7. Amount mismatch (200 + no verification + SystemException).
 *  8. Currency mismatch (200 + no verification + SystemException).
 *  9. Environment/livemode mismatch (200 + no verification + SystemException).
 * 10. Already Verified payment handled as safe no-op (200).
 * 11. Duplicate event ID handled idempotently without re-verifying (200).
 * 12. Valid payment: Pending becomes Verified.
 * 13. PayMongo payment ID persisted to payments table.
 * 14. PayMongo gateway status persisted to payments table.
 * 15. AutomationEngine triggered only after successful commit (Lot status synced to Reserved).
 * 16. Webhook secret never appears in response/log/error output.
 * 17. HMAC known-body round-trip (both timestamped PayMongo format and raw HMAC).
 * 18. AuditLog and Notification records created correctly.
 * 19. Malformed JSON handled safely (400).
 * 20. Missing required event envelope fields handled safely (400).
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

// Helper to construct official PayMongo checkout_session.payment.paid payload
function buildPayload($eventId, $csId, $amountCents, $currency = 'PHP', $livemode = false, $eventType = 'checkout_session.payment.paid', $payId = null, $status = 'paid') {
    if ($payId === null) {
        $payId = 'pay_b4_test_' . bin2hex(random_bytes(6));
    }
    return json_encode([
        'data' => [
            'id' => $eventId,
            'type' => $eventType,
            'attributes' => [
                'type' => $eventType,
                'livemode' => $livemode,
                'data' => [
                    'id' => $csId,
                    'type' => 'checkout_session',
                    'attributes' => [
                        'status' => $status,
                        'reference_number' => 'RCPT-B4-TEST',
                        'payment_intent' => [
                            'id' => 'pi_test_' . bin2hex(random_bytes(4)),
                            'attributes' => [
                                'amount' => $amountCents,
                                'currency' => $currency,
                                'status' => 'succeeded',
                                'payments' => [
                                    [
                                        'id' => $payId,
                                        'attributes' => [
                                            'amount' => $amountCents,
                                            'currency' => $currency,
                                            'status' => $status,
                                        ]
                                    ]
                                ]
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
    // If no available lot, find or reset one
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
// TEST 1: Valid signature with timestamped PayMongo header format
// ============================================================
$csId1 = 'cs_b4_test_01_' . bin2hex(random_bytes(4));
$pId1 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId1);
$evtId1 = 'evt_b4_test_01_' . bin2hex(random_bytes(4));
$rawBody1 = buildPayload($evtId1, $csId1, $lotPriceCents);
$sig1 = makeSignature($rawBody1, $testSecret, false, true);

$res1 = $paymentController->handleWebhook($rawBody1, $sig1);
report(1, 'Valid timestamped signature accepted (HTTP 200)', ($res1['code'] ?? 0) === 200 && ($res1['status'] ?? '') === 'verified', json_encode($res1));

// ============================================================
// TEST 2: Invalid signature rejection
// ============================================================
$rawBody2 = buildPayload('evt_b4_test_02', 'cs_dummy', 10000);
$sig2 = 't=' . time() . ',te=bad_signature_hash_00000000000000000000000000000000';
$res2 = $paymentController->handleWebhook($rawBody2, $sig2);
report(2, 'Invalid signature rejected with HTTP 401', ($res2['code'] ?? 0) === 401, json_encode($res2));

// ============================================================
// TEST 3: Missing signature header rejection
// ============================================================
$rawBody3 = buildPayload('evt_b4_test_03', 'cs_dummy', 10000);
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
$evtId5 = 'evt_b4_test_05_' . bin2hex(random_bytes(4));
$rawBody5 = buildPayload($evtId5, 'cs_dummy', 10000, 'PHP', false, 'payment.failed');
$sig5 = makeSignature($rawBody5, $testSecret);
$res5 = $paymentController->handleWebhook($rawBody5, $sig5);
report(5, 'Unknown event type safely ignored with HTTP 200', ($res5['code'] ?? 0) === 200 && ($res5['status'] ?? '') === 'ignored', json_encode($res5));

// ============================================================
// TEST 6: Valid event with no matching CMS payment (200 + SystemException)
// ============================================================
$evtId6 = 'evt_b4_test_06_' . bin2hex(random_bytes(4));
$rawBody6 = buildPayload($evtId6, 'cs_nonexistent_session_999999', 50000);
$sig6 = makeSignature($rawBody6, $testSecret);
$res6 = $paymentController->handleWebhook($rawBody6, $sig6);

$exc6 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.webhook_unmatched' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
report(6, 'Valid event with unmatched payment returns 200 and logs SystemException',
    ($res6['code'] ?? 0) === 200 && ($res6['status'] ?? '') === 'unmatched' && !empty($exc6),
    json_encode($res6)
);

// ============================================================
// TEST 7: Amount mismatch (200 + no verification + SystemException)
// ============================================================
$csId7 = 'cs_b4_test_07_' . bin2hex(random_bytes(4));
$pId7 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId7);
$evtId7 = 'evt_b4_test_07_' . bin2hex(random_bytes(4));
// Tampered amount: 100 cents less
$tamperedAmountCents = $lotPriceCents - 100;
$rawBody7 = buildPayload($evtId7, $csId7, $tamperedAmountCents);
$sig7 = makeSignature($rawBody7, $testSecret);
$res7 = $paymentController->handleWebhook($rawBody7, $sig7);

$paymentRow7 = $paymentModel->findById($pId7);
$exc7 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.webhook_amount_mismatch' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
report(7, 'Amount mismatch returns 200, logs SystemException, and payment remains Pending',
    ($res7['code'] ?? 0) === 200 && ($res7['status'] ?? '') === 'mismatch'
    && ($paymentRow7['verification_status'] ?? '') === 'Pending'
    && !empty($exc7),
    json_encode($res7)
);

// ============================================================
// TEST 8: Currency mismatch (200 + no verification + SystemException)
// ============================================================
$csId8 = 'cs_b4_test_08_' . bin2hex(random_bytes(4));
$pId8 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId8);
$evtId8 = 'evt_b4_test_08_' . bin2hex(random_bytes(4));
$rawBody8 = buildPayload($evtId8, $csId8, $lotPriceCents, 'USD');
$sig8 = makeSignature($rawBody8, $testSecret);
$res8 = $paymentController->handleWebhook($rawBody8, $sig8);

$paymentRow8 = $paymentModel->findById($pId8);
$exc8 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.webhook_currency_mismatch' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
report(8, 'Currency mismatch returns 200, logs SystemException, and payment remains Pending',
    ($res8['code'] ?? 0) === 200 && ($res8['status'] ?? '') === 'mismatch'
    && ($paymentRow8['verification_status'] ?? '') === 'Pending'
    && !empty($exc8),
    json_encode($res8)
);

// ============================================================
// TEST 9: Environment/livemode mismatch (200 + no verification + SystemException)
// ============================================================
$csId9 = 'cs_b4_test_09_' . bin2hex(random_bytes(4));
$pId9 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId9);
$evtId9 = 'evt_b4_test_09_' . bin2hex(random_bytes(4));
// Webhook claims livemode = true, but CMS is configured in test mode
$rawBody9 = buildPayload($evtId9, $csId9, $lotPriceCents, 'PHP', true);
$sig9 = makeSignature($rawBody9, $testSecret, true);
$res9 = $paymentController->handleWebhook($rawBody9, $sig9);

$paymentRow9 = $paymentModel->findById($pId9);
$exc9 = $db->query("SELECT * FROM system_exceptions WHERE event = 'payment.webhook_environment_mismatch' ORDER BY exception_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
report(9, 'Livemode mismatch returns 200, logs SystemException, and payment remains Pending',
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

$evtId10 = 'evt_b4_test_10_' . bin2hex(random_bytes(4));
$rawBody10 = buildPayload($evtId10, $csId10, $lotPriceCents);
$sig10 = makeSignature($rawBody10, $testSecret);
$res10 = $paymentController->handleWebhook($rawBody10, $sig10);

report(10, 'Already Verified payment handled safely with 200 as no-op',
    ($res10['code'] ?? 0) === 200 && ($res10['status'] ?? '') === 'already_reviewed',
    json_encode($res10)
);

// ============================================================
// TEST 11: Duplicate event ID -> safe no-op (200)
// ============================================================
// Send evtId1 again (which was already processed in TEST 1)
$res11 = $paymentController->handleWebhook($rawBody1, $sig1);
report(11, 'Duplicate event ID detected in webhook_events and returned as duplicate with 200',
    ($res11['code'] ?? 0) === 200 && ($res11['status'] ?? '') === 'duplicate',
    json_encode($res11)
);

// ============================================================
// TEST 12: Valid payment -> Pending becomes Verified
// ============================================================
$csId12 = 'cs_b4_test_12_' . bin2hex(random_bytes(4));
$pId12 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId12);
$evtId12 = 'evt_b4_test_12_' . bin2hex(random_bytes(4));
$payId12 = 'pay_real_test_' . bin2hex(random_bytes(4));
$rawBody12 = buildPayload($evtId12, $csId12, $lotPriceCents, 'PHP', false, 'checkout_session.payment.paid', $payId12, 'paid');
$sig12 = makeSignature($rawBody12, $testSecret);

$res12 = $paymentController->handleWebhook($rawBody12, $sig12);
$paymentRow12 = $paymentModel->findById($pId12);
report(12, 'Valid payment transitions from Pending to Verified',
    ($res12['code'] ?? 0) === 200 && ($paymentRow12['verification_status'] ?? '') === 'Verified',
    'status=' . ($paymentRow12['verification_status'] ?? 'null')
);

// ============================================================
// TEST 13: PayMongo payment ID persisted
// ============================================================
report(13, 'gateway_payment_id persisted to payments row',
    ($paymentRow12['gateway_payment_id'] ?? '') === $payId12,
    'persisted=' . ($paymentRow12['gateway_payment_id'] ?? 'null')
);

// ============================================================
// TEST 14: PayMongo gateway status persisted
// ============================================================
report(14, 'gateway_status persisted to payments row',
    ($paymentRow12['gateway_status'] ?? '') === 'paid',
    'persisted=' . ($paymentRow12['gateway_status'] ?? 'null')
);

// ============================================================
// TEST 15: AutomationEngine triggered after commit (Lot becomes Reserved)
// ============================================================
// Ensure lot is Available first
$db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = {$lotId}");
$csId15 = 'cs_b4_test_15_' . bin2hex(random_bytes(4));
$pId15 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId15);
$evtId15 = 'evt_b4_test_15_' . bin2hex(random_bytes(4));
$rawBody15 = buildPayload($evtId15, $csId15, $lotPriceCents);
$sig15 = makeSignature($rawBody15, $testSecret);

$res15 = $paymentController->handleWebhook($rawBody15, $sig15);
$updatedLot = $lotModel->findById($lotId);
report(15, 'AutomationEngine triggered post-commit: Lot status synced to Reserved',
    ($updatedLot['status'] ?? '') === 'Reserved',
    'lot_status=' . ($updatedLot['status'] ?? 'null')
);

// ============================================================
// TEST 16: Webhook secret never appears in response/log/error output
// ============================================================
$secretExposed = false;
$allOutputs = [
    json_encode($res1), json_encode($res2), json_encode($res3),
    json_encode($res4), json_encode($res6), json_encode($res7)
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
report(16, 'Webhook signing secret NEVER appears in response body, logs, or exceptions', !$secretExposed, 'Secret was leaked!');

// ============================================================
// TEST 17: HMAC known-body round-trip (direct and timestamped)
// ============================================================
$knownBody = '{"test":"payload","id":"123"}';
$knownSecret = 'secret_key_abc_xyz';
$expectedRawHmac = hash_hmac('sha256', $knownBody, $knownSecret);

putenv("PAYMONGO_WEBHOOK_SECRET={$knownSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $knownSecret;

// Test direct HMAC acceptance
$csId17 = 'cs_b4_test_17_' . bin2hex(random_bytes(4));
$pId17 = createTestPayment($paymentModel, $lotId, $lotPrice, $csId17);
$evtId17 = 'evt_b4_test_17_' . bin2hex(random_bytes(4));
$rawBody17 = buildPayload($evtId17, $csId17, $lotPriceCents);
$directSig17 = hash_hmac('sha256', $rawBody17, $knownSecret);

$res17 = $paymentController->handleWebhook($rawBody17, $directSig17);
report(17, 'HMAC round-trip verified: direct HMAC signature verified successfully',
    ($res17['code'] ?? 0) === 200 && ($res17['status'] ?? '') === 'verified',
    json_encode($res17)
);

// Restore secret
putenv("PAYMONGO_WEBHOOK_SECRET={$testSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testSecret;

// ============================================================
// TEST 18: AuditLog and Notification records created correctly
// ============================================================
$auditEntry = $db->query("SELECT * FROM audit_logs WHERE entity_type = 'Payment' AND entity_id = {$pId17} ORDER BY log_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$notifEntry = $db->query("SELECT * FROM notifications WHERE notification_type = 'Payment' AND user_id = 1 ORDER BY notification_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);

report(18, 'AuditLog and Notification created for webhook-verified payment',
    !empty($auditEntry) && strpos($auditEntry['action'], 'Payment verified') !== false && !empty($notifEntry),
    'audit=' . json_encode($auditEntry) . ' notif=' . json_encode($notifEntry)
);

// ============================================================
// TEST 19: Malformed JSON handled safely (400)
// ============================================================
$malformedBody = '{"bad_json: missing_brace';
$malformedSig = makeSignature($malformedBody, $testSecret);
$res19 = $paymentController->handleWebhook($malformedBody, $malformedSig);
report(19, 'Malformed JSON rejected safely with HTTP 400', ($res19['code'] ?? 0) === 400, json_encode($res19));

// ============================================================
// TEST 20: Missing required event envelope fields handled safely (400)
// ============================================================
$emptyEventBody = json_encode(['data' => ['id' => '']]);
$emptyEventSig = makeSignature($emptyEventBody, $testSecret);
$res20 = $paymentController->handleWebhook($emptyEventBody, $emptyEventSig);
report(20, 'Missing required event fields rejected with HTTP 400', ($res20['code'] ?? 0) === 400, json_encode($res20));

// Cleanup test payments and test webhook events
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH4_TEST%'");
$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b4_test%'");

echo "\n======================================================\n";
echo "PayMongo Batch 4 Webhook Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
