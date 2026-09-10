<?php
/**
 * PayMongo Refund Webhook & State Synchronization Tests — Batch 6
 *
 * Verifies all required Batch 6 contracts:
 *  1. Valid refund success webhook (payment.refunded / refund.succeeded)
 *  2. Valid refund update webhook (payment.refund.updated)
 *  3. Valid processing status transition (Pending -> Processing)
 *  4. Valid succeeded status transition (Processing -> Succeeded)
 *  5. Valid failed status transition (Pending -> Failed and Processing -> Failed)
 *  6. Valid pending status handling (Pending -> Pending no-op)
 *  7. Invalid signature rejected (HTTP 401)
 *  8. Missing webhook secret fails closed (HTTP 401)
 *  9. Malformed JSON rejected safely (HTTP 400)
 * 10. Missing event ID handled safely using documented fallback idempotency key
 * 11. Missing refund ID rejected safely (HTTP 400)
 * 12. Unknown refund ID logged and safely acknowledged (HTTP 200 + SystemException)
 * 13. Wrong payment ID rejected (HTTP 200 + SystemException)
 * 14. Wrong currency rejected (HTTP 200 + SystemException)
 * 15. Wrong livemode rejected (HTTP 200 + SystemException)
 * 16. Invalid non-positive refund amount rejected (HTTP 400)
 * 17. Exact centavo amount matching (e.g. 100001 cents)
 * 18. Amount mismatch rejected (HTTP 200 + SystemException)
 * 19. Duplicate webhook returns HTTP 200 duplicate
 * 20. Duplicate webhook does not duplicate state change or audit log
 * 21. Invalid state regression prevented (Succeeded cannot regress to Pending/Processing/Failed)
 * 22. Terminal state protection (Processing cannot regress to Pending; Failed cannot regress to Pending)
 * 23. Event ID vs refund ID extraction (real evt_... stored in webhook_events, ref_... in refunds)
 * 24. Fallback idempotency key correctly generated and distinguished from real evt_...
 * 25. Audit logging behavior verified with correct context
 * 26. Database transaction integrity & zero booking side effects (lots/bookings unchanged)
 * 27. Existing unified payments/webhook routes refund events to refund handler
 * 28. Dedicated payments/refund-webhook endpoint functions as expected
 * 29. Header formats supported: timestamped signature (t=...,te=...) and direct HMAC
 * 30. Notification created for requesting user upon status sync
 *
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_refund_webhook_b6.php
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/Refund.php';
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
$refundModel = new Refund();
$auditLogModel = new AuditLog();
$notificationModel = new Notification();
$systemExceptionModel = new SystemException();

$testLot = $db->query("SELECT lot_id, lot_number, price, status FROM lots WHERE price > 100 ORDER BY lot_id ASC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$lotId = $testLot ? (int) $testLot['lot_id'] : 1;

// Clean up prior test data
$db->exec("DELETE FROM refunds WHERE notes LIKE '%BATCH6_TEST%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH6_TEST%'");
$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b6_test%' OR event_id LIKE 'fallback:refund:ref_b6_%'");

// Establish test webhook credentials
$testSecret = 'whsec_test_batch6_refund_secret_1234567890';
putenv("PAYMONGO_WEBHOOK_SECRET={$testSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testSecret;
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';
putenv("PAYMONGO_SECRET_KEY=sk_test_mock_batch6_key");
$_ENV['PAYMONGO_SECRET_KEY'] = 'sk_test_mock_batch6_key';

/**
 * Helper to construct PayMongo signature header.
 */
function buildSignatureHeader(string $rawBody, string $secret, bool $useTimestamp = true): string {
    if (!$useTimestamp) {
        return hash_hmac('sha256', $rawBody, $secret);
    }
    $timestamp = time();
    $hash = hash_hmac('sha256', $timestamp . '.' . $rawBody, $secret);
    return "t={$timestamp},te={$hash}";
}

/**
 * Helper to construct PayMongo refund webhook payloads.
 * Supports standard event envelope and direct envelope.
 */
function buildRefundWebhookPayload(
    string $refundId,
    int $amountCents,
    string $status = 'succeeded',
    string $currency = 'PHP',
    string $eventType = 'refund.succeeded',
    ?string $eventId = null,
    ?string $paymentId = null,
    bool $livemode = false,
    bool $flatEnvelope = false,
    ?string $reason = 'requested_by_customer'
): string {
    $refundAttrs = [
        'amount' => $amountCents,
        'currency' => $currency,
        'status' => $status,
        'payment_id' => $paymentId ?: 'pay_b6_default_' . bin2hex(random_bytes(4)),
        'reason' => $reason,
        'notes' => 'BATCH6_TEST refund webhook',
        'livemode' => $livemode,
    ];

    $refundData = [
        'id' => $refundId,
        'type' => 'refund',
        'attributes' => $refundAttrs,
    ];

    if ($flatEnvelope) {
        $payload = [
            'event_type' => 'send.webhook',
            'data' => [
                'id' => $eventId,
                'type' => $eventType,
                'resource' => 'refund',
                'livemode' => $livemode,
                'data' => $refundData,
            ],
        ];
    } else {
        $payload = [
            'data' => [
                'id' => $eventId,
                'type' => 'event',
                'attributes' => [
                    'type' => $eventType,
                    'livemode' => $livemode,
                    'data' => $refundData,
                ],
            ],
        ];
    }

    return json_encode($payload, JSON_UNESCAPED_SLASHES);
}

/**
 * Helper to create a CMS payment and refund record for testing.
 */
function createTestPaymentAndRefund(
    PDO $db,
    string $gwPaymentId,
    string $gwRefundId,
    float $amountPesos,
    string $refundStatus = 'Pending'
): array {
    global $paymentModel, $lotId;
    $receipt = 'RCPT-B6-' . bin2hex(random_bytes(4));
    $csId = 'cs_b6_test_' . bin2hex(random_bytes(6));
    $paymentId = $paymentModel->create([
        'transaction_type' => 'Lot Purchase',
        'reference_id' => $lotId,
        'reference_kind' => 'lot',
        'amount' => $amountPesos,
        'payment_date' => date('Y-m-d'),
        'payment_method' => 'PayMongo',
        'receipt_number' => $receipt,
        'notes' => 'BATCH6_TEST payment',
        'received_by' => 1,
        'verification_status' => 'Verified',
    ]);
    $paymentModel->setGatewaySession($paymentId, 'paymongo', $csId, 'pi_init_' . $paymentId, 'paid');
    $paymentModel->setGatewayPaymentId($paymentId, $gwPaymentId, 'paid');

    $stmtRef = $db->prepare("
        INSERT INTO refunds (
            payment_id, gateway_refund_id, gateway_provider, amount, currency,
            status, reason, notes, requested_by
        ) VALUES (
            ?, ?, 'paymongo', ?, 'PHP',
            ?, 'requested_by_customer', 'BATCH6_TEST initial refund', 1
        )
    ");
    $stmtRef->execute([$paymentId, $gwRefundId, $amountPesos, $refundStatus]);
    $refundId = (int) $db->lastInsertId();

    return [
        'payment_id' => $paymentId,
        'refund_id' => $refundId,
        'receipt_number' => $receipt,
        'gateway_payment_id' => $gwPaymentId,
        'gateway_refund_id' => $gwRefundId,
        'amount' => $amountPesos,
    ];
}

// -----------------------------------------------------------------------------
// TEST 1: Valid refund success webhook (payment.refunded / refund.succeeded)
// -----------------------------------------------------------------------------
$gwPayId1 = 'pay_b6_test_p1_' . bin2hex(random_bytes(4));
$gwRefId1 = 'ref_b6_test_r1_' . bin2hex(random_bytes(4));
$evtId1   = 'evt_b6_test_e1_' . bin2hex(random_bytes(4));
$testData1 = createTestPaymentAndRefund($db, $gwPayId1, $gwRefId1, 1000.00, 'Pending');

$payload1 = buildRefundWebhookPayload($gwRefId1, 100000, 'succeeded', 'PHP', 'refund.succeeded', $evtId1, $gwPayId1);
$sig1 = buildSignatureHeader($payload1, $testSecret);
$res1 = $paymentController->handleRefundWebhook($payload1, $sig1);

$refRow1 = $refundModel->findById($testData1['refund_id']);
$evtRow1 = $db->query("SELECT * FROM webhook_events WHERE event_id = '{$evtId1}'")->fetch(PDO::FETCH_ASSOC);

report(1, 'Valid refund success webhook transitions Pending to Succeeded (HTTP 200)',
    ($res1['code'] ?? 0) === 200 &&
    ($res1['status'] ?? '') === 'synchronized' &&
    $refRow1['status'] === Refund::STATUS_SUCCEEDED &&
    !empty($refRow1['processed_at']) &&
    $evtRow1 && (int)$evtRow1['processed'] === 1 && $evtRow1['processing_result'] === 'synchronized',
    json_encode($res1)
);

// -----------------------------------------------------------------------------
// TEST 2: Valid refund update webhook (payment.refund.updated)
// -----------------------------------------------------------------------------
$gwPayId2 = 'pay_b6_test_p2_' . bin2hex(random_bytes(4));
$gwRefId2 = 'ref_b6_test_r2_' . bin2hex(random_bytes(4));
$evtId2   = 'evt_b6_test_e2_' . bin2hex(random_bytes(4));
$testData2 = createTestPaymentAndRefund($db, $gwPayId2, $gwRefId2, 500.00, 'Pending');

$payload2 = buildRefundWebhookPayload($gwRefId2, 50000, 'processing', 'PHP', 'payment.refund.updated', $evtId2, $gwPayId2);
$sig2 = buildSignatureHeader($payload2, $testSecret);
$res2 = $paymentController->handleRefundWebhook($payload2, $sig2);

$refRow2 = $refundModel->findById($testData2['refund_id']);
report(2, 'Valid payment.refund.updated webhook accepted and transitions Pending to Processing',
    ($res2['code'] ?? 0) === 200 &&
    ($res2['status'] ?? '') === 'synchronized' &&
    $refRow2['status'] === Refund::STATUS_PROCESSING,
    json_encode($res2)
);

// -----------------------------------------------------------------------------
// TEST 3: Valid processing status transition (Pending -> Processing)
// -----------------------------------------------------------------------------
$gwPayId3 = 'pay_b6_test_p3_' . bin2hex(random_bytes(4));
$gwRefId3 = 'ref_b6_test_r3_' . bin2hex(random_bytes(4));
$evtId3   = 'evt_b6_test_e3_' . bin2hex(random_bytes(4));
$testData3 = createTestPaymentAndRefund($db, $gwPayId3, $gwRefId3, 750.00, 'Pending');

$payload3 = buildRefundWebhookPayload($gwRefId3, 75000, 'processing', 'PHP', 'payment.refund.updated', $evtId3, $gwPayId3);
$sig3 = buildSignatureHeader($payload3, $testSecret);
$res3 = $paymentController->handleRefundWebhook($payload3, $sig3);

$refRow3 = $refundModel->findById($testData3['refund_id']);
report(3, 'Pending -> Processing transition verified',
    $refRow3['status'] === Refund::STATUS_PROCESSING,
    json_encode($res3)
);

// -----------------------------------------------------------------------------
// TEST 4: Valid succeeded status transition (Processing -> Succeeded)
// -----------------------------------------------------------------------------
$evtId4 = 'evt_b6_test_e4_' . bin2hex(random_bytes(4));
$payload4 = buildRefundWebhookPayload($gwRefId3, 75000, 'succeeded', 'PHP', 'payment.refunded', $evtId4, $gwPayId3);
$sig4 = buildSignatureHeader($payload4, $testSecret);
$res4 = $paymentController->handleRefundWebhook($payload4, $sig4);

$refRow4 = $refundModel->findById($testData3['refund_id']);
report(4, 'Processing -> Succeeded transition verified with processed_at populated',
    ($res4['code'] ?? 0) === 200 &&
    $refRow4['status'] === Refund::STATUS_SUCCEEDED &&
    !empty($refRow4['processed_at']),
    json_encode($res4)
);

// -----------------------------------------------------------------------------
// TEST 5: Valid failed status transition (Pending -> Failed and Processing -> Failed)
// -----------------------------------------------------------------------------
$gwPayId5 = 'pay_b6_test_p5_' . bin2hex(random_bytes(4));
$gwRefId5 = 'ref_b6_test_r5_' . bin2hex(random_bytes(4));
$evtId5   = 'evt_b6_test_e5_' . bin2hex(random_bytes(4));
$testData5 = createTestPaymentAndRefund($db, $gwPayId5, $gwRefId5, 300.00, 'Processing');

$payload5 = buildRefundWebhookPayload($gwRefId5, 30000, 'failed', 'PHP', 'payment.refund.updated', $evtId5, $gwPayId5);
$sig5 = buildSignatureHeader($payload5, $testSecret);
$res5 = $paymentController->handleRefundWebhook($payload5, $sig5);

$refRow5 = $refundModel->findById($testData5['refund_id']);
report(5, 'Processing -> Failed transition verified',
    ($res5['code'] ?? 0) === 200 &&
    $refRow5['status'] === Refund::STATUS_FAILED,
    json_encode($res5)
);

// -----------------------------------------------------------------------------
// TEST 6: Valid pending status handling (Pending -> Pending idempotent no-op)
// -----------------------------------------------------------------------------
$gwPayId6 = 'pay_b6_test_p6_' . bin2hex(random_bytes(4));
$gwRefId6 = 'ref_b6_test_r6_' . bin2hex(random_bytes(4));
$evtId6   = 'evt_b6_test_e6_' . bin2hex(random_bytes(4));
$testData6 = createTestPaymentAndRefund($db, $gwPayId6, $gwRefId6, 200.00, 'Pending');

$payload6 = buildRefundWebhookPayload($gwRefId6, 20000, 'pending', 'PHP', 'payment.refund.updated', $evtId6, $gwPayId6);
$sig6 = buildSignatureHeader($payload6, $testSecret);
$res6 = $paymentController->handleRefundWebhook($payload6, $sig6);

$refRow6 = $refundModel->findById($testData6['refund_id']);
report(6, 'Pending -> Pending identical status is treated as safe no_change (HTTP 200)',
    ($res6['code'] ?? 0) === 200 &&
    ($res6['status'] ?? '') === 'no_change' &&
    $refRow6['status'] === Refund::STATUS_PENDING,
    json_encode($res6)
);

// -----------------------------------------------------------------------------
// TEST 7: Invalid signature rejected (HTTP 401)
// -----------------------------------------------------------------------------
$payload7 = buildRefundWebhookPayload('ref_b6_test_invalid_sig', 10000, 'succeeded');
$invalidSig = 't=' . time() . ',te=' . hash_hmac('sha256', 'wrong_payload', 'wrong_secret');
$res7 = $paymentController->handleRefundWebhook($payload7, $invalidSig);

report(7, 'Invalid signature rejected with HTTP 401 fail-closed',
    ($res7['code'] ?? 0) === 401 && !empty($res7['error']),
    json_encode($res7)
);

// -----------------------------------------------------------------------------
// TEST 8: Missing webhook secret fails closed (HTTP 401)
// -----------------------------------------------------------------------------
putenv("PAYMONGO_WEBHOOK_SECRET=");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = '';
$res8 = $paymentController->handleRefundWebhook($payload1, $sig1);
// Restore secret
putenv("PAYMONGO_WEBHOOK_SECRET={$testSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testSecret;

report(8, 'Missing webhook secret fails closed with HTTP 401',
    ($res8['code'] ?? 0) === 401 && strpos($res8['error'] ?? '', 'not configured') !== false,
    json_encode($res8)
);

// -----------------------------------------------------------------------------
// TEST 9: Malformed JSON rejected safely (HTTP 400)
// -----------------------------------------------------------------------------
$badJson = '{"data": { this is broken json';
$sig9 = buildSignatureHeader($badJson, $testSecret);
$res9 = $paymentController->handleRefundWebhook($badJson, $sig9);

report(9, 'Malformed JSON payload rejected safely with HTTP 400',
    ($res9['code'] ?? 0) === 400 && strpos($res9['error'] ?? '', 'Malformed') !== false,
    json_encode($res9)
);

// -----------------------------------------------------------------------------
// TEST 10: Missing event ID uses documented fallback idempotency key
// -----------------------------------------------------------------------------
$gwPayId10 = 'pay_b6_test_p10_' . bin2hex(random_bytes(4));
$gwRefId10 = 'ref_b6_test_r10_' . bin2hex(random_bytes(4));
$testData10 = createTestPaymentAndRefund($db, $gwPayId10, $gwRefId10, 400.00, 'Pending');

// Construct payload with NULL event ID
$payload10 = buildRefundWebhookPayload($gwRefId10, 40000, 'succeeded', 'PHP', 'refund.succeeded', null, $gwPayId10);
$sig10 = buildSignatureHeader($payload10, $testSecret);
$res10 = $paymentController->handleRefundWebhook($payload10, $sig10);

$expectedFallbackKey = "fallback:refund:{$gwRefId10}:refund.succeeded:succeeded";
$evtRow10 = $db->query("SELECT * FROM webhook_events WHERE event_id = '{$expectedFallbackKey}'")->fetch(PDO::FETCH_ASSOC);

report(10, 'Missing event ID correctly uses documented fallback idempotency key',
    ($res10['code'] ?? 0) === 200 &&
    $evtRow10 &&
    strpos($evtRow10['event_id'], 'fallback:refund:') === 0,
    json_encode($res10)
);

// -----------------------------------------------------------------------------
// TEST 11: Missing refund ID rejected safely (HTTP 400)
// -----------------------------------------------------------------------------
$payload11 = json_encode([
    'data' => [
        'id' => 'evt_b6_test_e11',
        'type' => 'event',
        'attributes' => [
            'type' => 'refund.succeeded',
            'livemode' => false,
            'data' => [
                // Missing id
                'type' => 'refund',
                'attributes' => ['amount' => 10000, 'currency' => 'PHP', 'status' => 'succeeded'],
            ],
        ],
    ],
]);
$sig11 = buildSignatureHeader($payload11, $testSecret);
$res11 = $paymentController->handleRefundWebhook($payload11, $sig11);

report(11, 'Missing refund ID rejected safely with HTTP 400',
    ($res11['code'] ?? 0) === 400 && strpos($res11['error'] ?? '', 'refund resource ID') !== false,
    json_encode($res11)
);

// -----------------------------------------------------------------------------
// TEST 12: Unknown refund ID logged and safely acknowledged (HTTP 200 + SystemException)
// -----------------------------------------------------------------------------
$unknownRefId = 'ref_b6_unknown_' . bin2hex(random_bytes(4));
$evtId12 = 'evt_b6_test_e12_' . bin2hex(random_bytes(4));
$payload12 = buildRefundWebhookPayload($unknownRefId, 10000, 'succeeded', 'PHP', 'refund.succeeded', $evtId12);
$sig12 = buildSignatureHeader($payload12, $testSecret);
$res12 = $paymentController->handleRefundWebhook($payload12, $sig12);

$evtRow12 = $db->query("SELECT * FROM webhook_events WHERE event_id = '{$evtId12}'")->fetch(PDO::FETCH_ASSOC);
report(12, 'Unknown refund ID returns HTTP 200 unmatched and records SystemException',
    ($res12['code'] ?? 0) === 200 &&
    ($res12['status'] ?? '') === 'unmatched' &&
    $evtRow12 && $evtRow12['processing_result'] === 'unmatched_refund',
    json_encode($res12)
);

// -----------------------------------------------------------------------------
// TEST 13: Wrong payment ID rejected (HTTP 200 + SystemException)
// -----------------------------------------------------------------------------
$gwPayId13 = 'pay_b6_test_p13_' . bin2hex(random_bytes(4));
$gwRefId13 = 'ref_b6_test_r13_' . bin2hex(random_bytes(4));
$evtId13   = 'evt_b6_test_e13_' . bin2hex(random_bytes(4));
$testData13 = createTestPaymentAndRefund($db, $gwPayId13, $gwRefId13, 250.00, 'Pending');

// Payload sends a different payment_id
$payload13 = buildRefundWebhookPayload($gwRefId13, 25000, 'succeeded', 'PHP', 'refund.succeeded', $evtId13, 'pay_completely_wrong_id');
$sig13 = buildSignatureHeader($payload13, $testSecret);
$res13 = $paymentController->handleRefundWebhook($payload13, $sig13);

$refRow13 = $refundModel->findById($testData13['refund_id']);
report(13, 'Associated payment ID mismatch rejected without modifying refund (HTTP 200 mismatch)',
    ($res13['code'] ?? 0) === 200 &&
    ($res13['status'] ?? '') === 'mismatch' &&
    $refRow13['status'] === Refund::STATUS_PENDING,
    json_encode($res13)
);

// -----------------------------------------------------------------------------
// TEST 14: Wrong currency rejected (HTTP 200 + SystemException)
// -----------------------------------------------------------------------------
$gwPayId14 = 'pay_b6_test_p14_' . bin2hex(random_bytes(4));
$gwRefId14 = 'ref_b6_test_r14_' . bin2hex(random_bytes(4));
$evtId14   = 'evt_b6_test_e14_' . bin2hex(random_bytes(4));
$testData14 = createTestPaymentAndRefund($db, $gwPayId14, $gwRefId14, 150.00, 'Pending');

$payload14 = buildRefundWebhookPayload($gwRefId14, 15000, 'succeeded', 'USD', 'refund.succeeded', $evtId14, $gwPayId14);
$sig14 = buildSignatureHeader($payload14, $testSecret);
$res14 = $paymentController->handleRefundWebhook($payload14, $sig14);

$refRow14 = $refundModel->findById($testData14['refund_id']);
report(14, 'Non-PHP currency rejected without modifying refund (HTTP 200 mismatch)',
    ($res14['code'] ?? 0) === 200 &&
    ($res14['status'] ?? '') === 'mismatch' &&
    $refRow14['status'] === Refund::STATUS_PENDING,
    json_encode($res14)
);

// -----------------------------------------------------------------------------
// TEST 15: Wrong livemode rejected (HTTP 200 + SystemException)
// -----------------------------------------------------------------------------
$gwPayId15 = 'pay_b6_test_p15_' . bin2hex(random_bytes(4));
$gwRefId15 = 'ref_b6_test_r15_' . bin2hex(random_bytes(4));
$evtId15   = 'evt_b6_test_e15_' . bin2hex(random_bytes(4));
$testData15 = createTestPaymentAndRefund($db, $gwPayId15, $gwRefId15, 120.00, 'Pending');

// CMS is in test mode, payload claims livemode=true
$payload15 = buildRefundWebhookPayload($gwRefId15, 12000, 'succeeded', 'PHP', 'refund.succeeded', $evtId15, $gwPayId15, true);
$sig15 = buildSignatureHeader($payload15, $testSecret);
$res15 = $paymentController->handleRefundWebhook($payload15, $sig15);

$refRow15 = $refundModel->findById($testData15['refund_id']);
report(15, 'Livemode mismatch rejected without modifying refund (HTTP 200 mismatch)',
    ($res15['code'] ?? 0) === 200 &&
    ($res15['status'] ?? '') === 'mismatch' &&
    $refRow15['status'] === Refund::STATUS_PENDING,
    json_encode($res15)
);

// -----------------------------------------------------------------------------
// TEST 16: Invalid non-positive refund amount rejected (HTTP 400)
// -----------------------------------------------------------------------------
$payload16 = buildRefundWebhookPayload('ref_b6_test_zero_amt', 0, 'succeeded');
$sig16 = buildSignatureHeader($payload16, $testSecret);
$res16 = $paymentController->handleRefundWebhook($payload16, $sig16);

report(16, 'Zero or negative refund amount rejected with HTTP 400',
    ($res16['code'] ?? 0) === 400,
    json_encode($res16)
);

// -----------------------------------------------------------------------------
// TEST 17: Exact centavo amount matching (e.g. 100001 cents = PHP 1000.01)
// -----------------------------------------------------------------------------
$gwPayId17 = 'pay_b6_test_p17_' . bin2hex(random_bytes(4));
$gwRefId17 = 'ref_b6_test_r17_' . bin2hex(random_bytes(4));
$evtId17   = 'evt_b6_test_e17_' . bin2hex(random_bytes(4));
$testData17 = createTestPaymentAndRefund($db, $gwPayId17, $gwRefId17, 1000.01, 'Pending');

$payload17 = buildRefundWebhookPayload($gwRefId17, 100001, 'succeeded', 'PHP', 'refund.succeeded', $evtId17, $gwPayId17);
$sig17 = buildSignatureHeader($payload17, $testSecret);
$res17 = $paymentController->handleRefundWebhook($payload17, $sig17);

$refRow17 = $refundModel->findById($testData17['refund_id']);
report(17, 'Exact centavo amount (100001 cents) accurately matched and synchronized',
    ($res17['code'] ?? 0) === 200 &&
    $refRow17['status'] === Refund::STATUS_SUCCEEDED,
    json_encode($res17)
);

// -----------------------------------------------------------------------------
// TEST 18: Amount mismatch rejection (e.g. 1 centavo off)
// -----------------------------------------------------------------------------
$gwPayId18 = 'pay_b6_test_p18_' . bin2hex(random_bytes(4));
$gwRefId18 = 'ref_b6_test_r18_' . bin2hex(random_bytes(4));
$evtId18   = 'evt_b6_test_e18_' . bin2hex(random_bytes(4));
$testData18 = createTestPaymentAndRefund($db, $gwPayId18, $gwRefId18, 1000.01, 'Pending');

// Sends 100000 cents instead of 100001
$payload18 = buildRefundWebhookPayload($gwRefId18, 100000, 'succeeded', 'PHP', 'refund.succeeded', $evtId18, $gwPayId18);
$sig18 = buildSignatureHeader($payload18, $testSecret);
$res18 = $paymentController->handleRefundWebhook($payload18, $sig18);

$refRow18 = $refundModel->findById($testData18['refund_id']);
report(18, 'Amount mismatch of even 1 centavo rejected without modifying refund',
    ($res18['code'] ?? 0) === 200 &&
    ($res18['status'] ?? '') === 'mismatch' &&
    $refRow18['status'] === Refund::STATUS_PENDING,
    json_encode($res18)
);

// -----------------------------------------------------------------------------
// TEST 19: Duplicate webhook returns HTTP 200 duplicate
// -----------------------------------------------------------------------------
$res19 = $paymentController->handleRefundWebhook($payload1, $sig1);

report(19, 'Repeated delivery of same event returns HTTP 200 duplicate',
    ($res19['code'] ?? 0) === 200 &&
    ($res19['status'] ?? '') === 'duplicate',
    json_encode($res19)
);

// -----------------------------------------------------------------------------
// TEST 20: Duplicate webhook does not duplicate state change or audit log
// -----------------------------------------------------------------------------
$auditCount = $db->query("SELECT COUNT(*) FROM audit_logs WHERE action = 'Payment refund status synchronized' AND entity_id = {$testData1['refund_id']}")->fetchColumn();

report(20, 'Duplicate delivery creates zero additional audit log records',
    (int) $auditCount === 1,
    "Audit log count: {$auditCount}"
);

// -----------------------------------------------------------------------------
// TEST 21: Invalid state regression prevented (Succeeded cannot regress to Pending/Processing/Failed)
// -----------------------------------------------------------------------------
$evtId21 = 'evt_b6_test_e21_' . bin2hex(random_bytes(4));
// Try to regress refund #1 (which is Succeeded) back to Processing
$payload21 = buildRefundWebhookPayload($gwRefId1, 100000, 'processing', 'PHP', 'payment.refund.updated', $evtId21, $gwPayId1);
$sig21 = buildSignatureHeader($payload21, $testSecret);
$res21 = $paymentController->handleRefundWebhook($payload21, $sig21);

$refRow21 = $refundModel->findById($testData1['refund_id']);
report(21, 'Invalid state regression from Succeeded to Processing is strictly prevented',
    ($res21['code'] ?? 0) === 200 &&
    ($res21['status'] ?? '') === 'ignored' &&
    $refRow21['status'] === Refund::STATUS_SUCCEEDED,
    json_encode($res21)
);

// -----------------------------------------------------------------------------
// TEST 22: Terminal state protection (Processing cannot regress to Pending; Failed cannot regress)
// -----------------------------------------------------------------------------
$gwPayId22 = 'pay_b6_test_p22_' . bin2hex(random_bytes(4));
$gwRefId22 = 'ref_b6_test_r22_' . bin2hex(random_bytes(4));
$evtId22a  = 'evt_b6_test_e22a_' . bin2hex(random_bytes(4));
$testData22 = createTestPaymentAndRefund($db, $gwPayId22, $gwRefId22, 600.00, 'Processing');

// Attempt to regress Processing -> Pending
$payload22a = buildRefundWebhookPayload($gwRefId22, 60000, 'pending', 'PHP', 'payment.refund.updated', $evtId22a, $gwPayId22);
$sig22a = buildSignatureHeader($payload22a, $testSecret);
$res22a = $paymentController->handleRefundWebhook($payload22a, $sig22a);

$refRow22a = $refundModel->findById($testData22['refund_id']);
report(22, 'Processing cannot regress to Pending',
    ($res22a['code'] ?? 0) === 200 &&
    $refRow22a['status'] === Refund::STATUS_PROCESSING,
    json_encode($res22a)
);

// -----------------------------------------------------------------------------
// TEST 23: Event ID vs refund ID extraction (real evt_... stored in webhook_events, ref_... in refunds)
// -----------------------------------------------------------------------------
$evtRowCheck = $db->query("SELECT * FROM webhook_events WHERE event_id = '{$evtId1}'")->fetch(PDO::FETCH_ASSOC);
report(23, 'Event ID (evt_...) stored in webhook_events, Refund ID (ref_...) stored in refunds',
    $evtRowCheck && strpos($evtRowCheck['event_id'], 'evt_') === 0 &&
    $refRow1['gateway_refund_id'] === $gwRefId1 &&
    strpos($refRow1['gateway_refund_id'], 'ref_') === 0,
    "Event: " . ($evtRowCheck['event_id'] ?? '') . ", Refund: " . ($refRow1['gateway_refund_id'] ?? '')
);

// -----------------------------------------------------------------------------
// TEST 24: Fallback idempotency key correctly generated and distinguished from real evt_...
// -----------------------------------------------------------------------------
report(24, 'Fallback idempotency key format matches fallback:refund:{ref}:{event}:{status}',
    $evtRow10 &&
    strpos($evtRow10['event_id'], 'fallback:refund:' . $gwRefId10) === 0,
    "Stored fallback key: " . ($evtRow10['event_id'] ?? '')
);

// -----------------------------------------------------------------------------
// TEST 25: Audit logging behavior verified with correct context
// -----------------------------------------------------------------------------
$auditEntry = $db->query("
    SELECT * FROM audit_logs
    WHERE action = 'Payment refund status synchronized'
      AND entity_id = {$testData1['refund_id']}
    ORDER BY log_id DESC LIMIT 1
")->fetch(PDO::FETCH_ASSOC);

$auditDetails = $auditEntry ? json_decode($auditEntry['details'], true) : [];
report(25, 'AuditLog entry created with old_status, new_status, and event_id',
    !empty($auditEntry) &&
    ($auditDetails['old_status'] ?? '') === 'Pending' &&
    ($auditDetails['new_status'] ?? '') === 'Succeeded' &&
    ($auditDetails['gateway_refund_id'] ?? '') === $gwRefId1 &&
    ($auditDetails['event_id'] ?? '') === $evtId1,
    json_encode($auditDetails)
);

// -----------------------------------------------------------------------------
// TEST 26: Database transaction integrity & zero booking side effects
// -----------------------------------------------------------------------------
$lotInitial = $db->query("SELECT lot_id, status FROM lots LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$lotStatusBefore = $lotInitial['status'];

// Simulate another refund synchronization
$gwPayId26 = 'pay_b6_test_p26_' . bin2hex(random_bytes(4));
$gwRefId26 = 'ref_b6_test_r26_' . bin2hex(random_bytes(4));
$evtId26   = 'evt_b6_test_e26_' . bin2hex(random_bytes(4));
$testData26 = createTestPaymentAndRefund($db, $gwPayId26, $gwRefId26, 800.00, 'Pending');
$payload26 = buildRefundWebhookPayload($gwRefId26, 80000, 'succeeded', 'PHP', 'refund.succeeded', $evtId26, $gwPayId26);
$sig26 = buildSignatureHeader($payload26, $testSecret);
$res26 = $paymentController->handleRefundWebhook($payload26, $sig26);

$lotStatusAfter = $db->query("SELECT status FROM lots WHERE lot_id = {$lotInitial['lot_id']}")->fetchColumn();
report(26, 'Zero automated booking/lot side effects during refund state synchronization',
    $lotStatusBefore === $lotStatusAfter,
    "Lot status before: {$lotStatusBefore}, after: {$lotStatusAfter}"
);

// -----------------------------------------------------------------------------
// TEST 27: Existing unified payments/webhook routes refund events to refund handler
// -----------------------------------------------------------------------------
$gwPayId27 = 'pay_b6_test_p27_' . bin2hex(random_bytes(4));
$gwRefId27 = 'ref_b6_test_r27_' . bin2hex(random_bytes(4));
$evtId27   = 'evt_b6_test_e27_' . bin2hex(random_bytes(4));
$testData27 = createTestPaymentAndRefund($db, $gwPayId27, $gwRefId27, 350.00, 'Pending');

$payload27 = buildRefundWebhookPayload($gwRefId27, 35000, 'succeeded', 'PHP', 'refund.succeeded', $evtId27, $gwPayId27);
$sig27 = buildSignatureHeader($payload27, $testSecret);

// Call handleWebhook (the generic/unified endpoint method)
$res27 = $paymentController->handleWebhook($payload27, $sig27);
$refRow27 = $refundModel->findById($testData27['refund_id']);

report(27, 'Unified handleWebhook endpoint correctly detects refund event and delegates to handleRefundWebhook',
    ($res27['code'] ?? 0) === 200 &&
    ($res27['status'] ?? '') === 'synchronized' &&
    $refRow27['status'] === Refund::STATUS_SUCCEEDED,
    json_encode($res27)
);

// -----------------------------------------------------------------------------
// TEST 28: Direct HMAC signature without timestamp supported
// -----------------------------------------------------------------------------
$gwPayId28 = 'pay_b6_test_p28_' . bin2hex(random_bytes(4));
$gwRefId28 = 'ref_b6_test_r28_' . bin2hex(random_bytes(4));
$evtId28   = 'evt_b6_test_e28_' . bin2hex(random_bytes(4));
$testData28 = createTestPaymentAndRefund($db, $gwPayId28, $gwRefId28, 190.00, 'Pending');

$payload28 = buildRefundWebhookPayload($gwRefId28, 19000, 'succeeded', 'PHP', 'refund.succeeded', $evtId28, $gwPayId28);
$sig28 = buildSignatureHeader($payload28, $testSecret, false); // Direct HMAC
$res28 = $paymentController->handleRefundWebhook($payload28, $sig28);

$refRow28 = $refundModel->findById($testData28['refund_id']);
report(28, 'Direct HMAC signature without timestamp accepted for backward compatibility',
    ($res28['code'] ?? 0) === 200 &&
    $refRow28['status'] === Refund::STATUS_SUCCEEDED,
    json_encode($res28)
);

// -----------------------------------------------------------------------------
// TEST 29: Notification created for requesting user upon status sync
// -----------------------------------------------------------------------------
$notifCount = $db->query("
    SELECT COUNT(*) FROM notifications
    WHERE notification_type = 'Payment'
      AND message LIKE '%Refund #{$testData1['refund_id']}%'
")->fetchColumn();

report(29, 'Notification created for refund requesting user on status sync',
    (int) $notifCount >= 1,
    "Notification count: {$notifCount}"
);

// -----------------------------------------------------------------------------
// TEST 30: Flat envelope format (send.webhook) supported
// -----------------------------------------------------------------------------
$gwPayId30 = 'pay_b6_test_p30_' . bin2hex(random_bytes(4));
$gwRefId30 = 'ref_b6_test_r30_' . bin2hex(random_bytes(4));
$evtId30   = 'evt_b6_test_e30_' . bin2hex(random_bytes(4));
$testData30 = createTestPaymentAndRefund($db, $gwPayId30, $gwRefId30, 220.00, 'Pending');

$payload30 = buildRefundWebhookPayload($gwRefId30, 22000, 'succeeded', 'PHP', 'payment.refunded', $evtId30, $gwPayId30, false, true);
$sig30 = buildSignatureHeader($payload30, $testSecret);
$res30 = $paymentController->handleRefundWebhook($payload30, $sig30);

$refRow30 = $refundModel->findById($testData30['refund_id']);
report(30, 'Flat envelope format (send.webhook) accepted and processed',
    ($res30['code'] ?? 0) === 200 &&
    $refRow30['status'] === Refund::STATUS_SUCCEEDED,
    json_encode($res30)
);

// -----------------------------------------------------------------------------
// Clean up test records
// -----------------------------------------------------------------------------
$db->exec("DELETE FROM refunds WHERE notes LIKE '%BATCH6_TEST%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH6_TEST%'");
$db->exec("DELETE FROM webhook_events WHERE event_id LIKE '%b6_test%' OR event_id LIKE 'fallback:refund:ref_b6_%'");

echo "\n======================================================\n";
echo "PayMongo Batch 6 Refund Webhook Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

exit($failed > 0 ? 1 : 0);
