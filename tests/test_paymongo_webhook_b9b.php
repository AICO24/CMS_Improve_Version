<?php
/**
 * PayMongo Webhook Batch 9B: Burial Booking Chain Test
 *
 * Proves the complete server-authoritative chain for burial bookings:
 *   PayMongo successful payment webhook
 *   ↓ verify webhook signature
 *   ↓ validate PayMongo event/resource
 *   ↓ resolve CMS payment
 *   ↓ validate amount + currency + reference
 *   ↓ mark CMS payment Verified
 *   ↓ resolve ORIGINAL burial schedule
 *   ↓ confirm ORIGINAL burial booking
 *   ↓ finalize ORIGINAL lot
 *   ↓ audit + notification
 *   ↓ safe success response
 *
 * Expected persisted state after valid successful webhook:
 *   PAYMENT:    verification_status = Verified
 *   SCHEDULE:   status = Confirmed
 *   ORIGINAL LOT: status = Reserved
 *
 * Identity chain: payment.reference_id = schedule_id,
 *                 schedule.lot_id = original lot_id
 *
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_webhook_b9b.php
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/User.php';
require_once __DIR__ . '/../backend/models/AuditLog.php';
require_once __DIR__ . '/../backend/models/Notification.php';
require_once __DIR__ . '/../backend/services/EnvironmentService.php';
require_once __DIR__ . '/../backend/services/PayMongoService.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';

$db = Database::getInstance()->getConnection();

// Disable foreign key checks temporarily for cleanup
$db->exec("SET FOREIGN_KEY_CHECKS=0");

// cleanup any test records from prior runs
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%AI Booking Assistant Draft%'");
$db->exec("DELETE FROM decedent_requests WHERE requested_by = 1 AND request_id NOT IN (SELECT decedent_request_id FROM burial_schedules WHERE decedent_request_id IS NOT NULL)");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH9B_TEST%'");
$db->exec("ALTER TABLE burial_schedules AUTO_INCREMENT = 1");
$db->exec("ALTER TABLE payments AUTO_INCREMENT = 1");

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
// ----------------------------------------------------------------------
$db = Database::getInstance()->getConnection();

// cleanup any test records from prior runs
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%AI Booking Assistant Draft%'");
$db->exec("DELETE FROM decedent_requests WHERE requested_by = 1 AND request_id NOT IN (SELECT decedent_request_id FROM burial_schedules WHERE decedent_request_id IS NOT NULL)");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH9B_TEST%'");
$db->exec("ALTER TABLE burial_schedules AUTO_INCREMENT = 1");
$db->exec("ALTER TABLE payments AUTO_INCREMENT = 1");

// Load webhook secret from existing test convention
$testSecret = 'whsec_test_batch9b_secret_key_1234567890';
putenv("PAYMONGO_WEBHOOK_SECRET={$testSecret}");
$_ENV['PAYMONGO_WEBHOOK_SECRET'] = $testSecret;

putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';
putenv("PAYMONGO_SECRET_KEY=sk_test_mock_batch9b_key");
$_ENV['PAYMONGO_SECRET_KEY'] = 'sk_test_mock_batch9b_key';

// Helper: build real Hosted Checkout webhook payload
// (Copied from test_paymongo_webhook_b4.php to avoid redeclaration conflicts)
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
            $payId = 'pay_b9b_test_' . bin2hex(random_bytes(6));
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
                    'reference_number' => 'RCPT-B9B-TEST',
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

// Helper: generate HMAC-SHA256 signature
function makeSignature($rawBody, $secret, $isLive = false, $useTimestamp = true) {
    if (!$useTimestamp) {
        return hash_hmac('sha256', $rawBody, $secret);
    }
    $t = time();
    $hash = hash_hmac('sha256', "{$t}.{$rawBody}", $secret);
    return $isLive ? "t={$t},li={$hash}" : "t={$t},te={$hash}";
}

// ----------------------------------------------------------------------
// Helper: get a test lot that is Available
// ----------------------------------------------------------------------
function getTestLot($db) {
    $testLot = $db->query("SELECT lot_id, lot_number, price, status FROM lots WHERE status = 'Available' AND price > 100 ORDER BY lot_id ASC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
    if (!$testLot) {
        $testLot = $db->query("SELECT lot_id, lot_number, price, status FROM lots WHERE price > 100 ORDER BY lot_id ASC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
        if ($testLot) {
            $db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = " . (int)$testLot['lot_id']);
            $testLot['status'] = 'Available';
        }
    }
    return $testLot;
}

// ----------------------------------------------------------------------
// Helper: create a burial schedule linked to the lot
// ----------------------------------------------------------------------
function createTestSchedule($db, $lotId, $futureDate, $userId = 1) {
    $stmt = $db->prepare("
        INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, created_by, notes)
        VALUES (?, ?, NULL, 'Pending', ?, 'AI Booking Assistant Draft')
    ");
    $stmt->execute([$lotId, $futureDate, $userId]);
    $scheduleId = (int) $db->lastInsertId();

    // Also create a provisional decedent request
    $db->prepare("
        INSERT INTO decedent_requests (requested_by, full_name, approximate_dod, relationship, status, notes)
        VALUES (?, 'Test Decedent', '2027-12-01', 'Father', 'pending', 'Auto-created for burial booking test')
    ")->execute([$userId]);

    $db->prepare("
        UPDATE burial_schedules SET decedent_request_id = ? WHERE schedule_id = ?
    ")->execute([$scheduleId, $scheduleId]);

    return $scheduleId;
}

// ----------------------------------------------------------------------
// Helper: create a CMS payment referencing the schedule (reference_kind='schedule')
// ----------------------------------------------------------------------
function createTestPaymentForSchedule($paymentModel, $scheduleId, $amountCents, $csId) {
    $paymentId = $paymentModel->create([
        'transaction_type' => 'Lot Purchase',
        'reference_id' => $scheduleId,
        'reference_kind' => 'schedule',
        'amount' => $amountCents / 100,  // decimal(12,2)
        'payment_date' => date('Y-m-d'),
        'payment_method' => 'PayMongo',
        'receipt_number' => 'RCPT-B9B-' . bin2hex(random_bytes(3)),
        'notes' => 'BATCH9B_TEST schedule-referenced payment',
        'received_by' => 1,
        'verification_status' => 'Pending',
    ]);

    $paymentModel->setGatewaySession($paymentId, 'paymongo', $csId, 'pi_init_' . $paymentId, 'awaiting_payment_method');
    return $paymentId;
}

// ----------------------------------------------------------------------
// TEST 1: SUCCESSFUL PAYMONGO WEBHOOK
// Full chain: Payment Verified → Schedule Confirmed → Lot Reserved
// ----------------------------------------------------------------------
{
    // Get an available lot
    $testLot = getTestLot($db);
    if (!$testLot) {
        report(1, 'Batch 9B Setup: Available lot found', false, 'No available lot in database');
        exit(1);
    }
    $lotId = (int) $testLot['lot_id'];
    $lotPrice = (float) $testLot['price'];
    $lotPriceCents = (int) round($lotPrice * 100);

    // Compute a future schedule date (avoid Monday if possible)
    // Use +90 days to avoid colliding with existing test data
    $futureDate = date('Y-m-d', strtotime('+90 days'));
    // Ensure it's not a Monday
    while ((int) date('N', strtotime($futureDate)) === 1) {
        $futureDate = date('Y-m-d', strtotime($futureDate . ' +1 day'));
    }

    // Create burial schedule linked to the lot
    $scheduleId = createTestSchedule($db, $lotId, $futureDate);
    if (!$scheduleId) {
        report(1, 'Batch 9B Setup: Create schedule', false, 'Failed to create burial schedule');
        exit(1);
    }

    // Create CMS payment referencing the schedule (reference_kind='schedule')
    $csId1 = 'cs_b9b_test_01_' . bin2hex(random_bytes(4));
    $paymentModel = new Payment();
    $pId1 = createTestPaymentForSchedule($paymentModel, $scheduleId, $lotPriceCents, $csId1);

    // Build real Hosted Checkout payload (type=checkout_session.payment.paid)
    $rawBody1 = buildRealHostedCheckoutPayload($csId1, $lotPriceCents, 'PHP', false, 'checkout_session.payment.paid');
    $sig1 = makeSignature($rawBody1, $testSecret, false, true);

    $paymentController = new PaymentController();
    $res1 = $paymentController->handleWebhook($rawBody1, $sig1);

    // ---- ASSERTIONS ----

    // 1a. HTTP 200 and status = verified
    $test1a = (
        ($res1['code'] ?? 0) === 200
        && ($res1['status'] ?? '') === 'verified'
    );
    report('1a', 'HTTP 200 and webhook status = verified', $test1a, json_encode($res1));

    // 1b. Payment verified in database
    $paymentRow1 = $paymentModel->findById($pId1);
    $test1b = (
        ($paymentRow1['verification_status'] ?? '') === 'Verified'
    );
    report('1b', 'Payment verification_status = Verified in persisted state', $test1b,
        'actual_status=' . ($paymentRow1['verification_status'] ?? 'null'));

    // 1c. Original burial schedule confirmed
    $scheduleModel = new Schedule();
    $scheduleRow = $scheduleModel->findById($scheduleId);
    $test1c = (
        ($scheduleRow['status'] ?? '') === 'Confirmed'
    );
    report('1c', 'Original burial schedule status = Confirmed in persisted state', $test1c,
        'actual_status=' . ($scheduleRow['status'] ?? 'null'));

    // 1d. Original lot reserved
    $lotModel = new Lot();
    $lotRow = $lotModel->findById($lotId);
    $test1d = (
        ($lotRow['status'] ?? '') === 'Reserved'
    );
    report('1d', 'Original lot status = Reserved in persisted state', $test1d,
        'actual_status=' . ($lotRow['status'] ?? 'null'));

    // 1e. Identity: payment.reference_id = schedule_id
    $test1e = (
        ($paymentRow1['reference_id'] ?? null) === $scheduleId
        && ($paymentRow1['reference_kind'] ?? '') === 'schedule'
    );
    report('1e', 'Identity: payment.reference_id = schedule_id and reference_kind = schedule', $test1e,
        'payment.reference_id=' . ($paymentRow1['reference_id'] ?? 'null') . ' schedule_id=' . $scheduleId);

    // 1f. Identity: schedule.lot_id = original lot_id
    $test1f = (
        ($scheduleRow['lot_id'] ?? null) === $lotId
    );
    report('1f', 'Identity: schedule.lot_id = original lot_id', $test1f,
        'schedule.lot_id=' . ($scheduleRow['lot_id'] ?? 'null') . ' lot_id=' . $lotId);
}

// ----------------------------------------------------------------------
// TEST 2: INVALID SIGNATURE REJECTION
// ----------------------------------------------------------------------
{
    // Re-use the test lot and schedule from Test 1 setup
    $testLot2 = $db->query("SELECT lot_id, price FROM lots WHERE lot_id = {$lotId}")->fetch(PDO::FETCH_ASSOC);
    $lotPriceCents2 = (int) round($testLot2['price'] * 100);

    $futureDate2 = date('Y-m-d', strtotime('+90 days'));
    while ((int) date('N', strtotime($futureDate2)) === 1) {
        $futureDate2 = date('Y-m-d', strtotime($futureDate2 . ' +1 day'));
    }
    $scheduleModel2 = new Schedule();
    $scheduleRow2 = $scheduleModel2->findById($scheduleId);
    $scheduleId2 = $scheduleRow2 ? $scheduleRow2['schedule_id'] : 0;

    $csId2 = 'cs_b9b_test_02_' . bin2hex(random_bytes(4));
    $paymentModel2 = new Payment();
    $pId2 = $paymentModel2->create([
        'transaction_type' => 'Lot Purchase',
        'reference_id' => $scheduleId2,
        'reference_kind' => 'schedule',
        'amount' => $lotPriceCents2 / 100,
        'payment_date' => date('Y-m-d'),
        'payment_method' => 'PayMongo',
        'receipt_number' => 'RCPT-B9B-002',
        'notes' => 'BATCH9B_TEST invalid signature',
        'received_by' => 1,
        'verification_status' => 'Pending',
    ]);

    $rawBody2 = buildRealHostedCheckoutPayload($csId2, $lotPriceCents2, 'PHP', false, 'checkout_session.payment.paid');
    $sig2 = 't=' . time() . ',te=bad_signature_hash_' . str_repeat('0', 32) . ',li=' . str_repeat('0', 64);

    $paymentController2 = new PaymentController();
    $res2 = $paymentController2->handleWebhook($rawBody2, $sig2);

    // 2a. HTTP 401 for invalid signature
    $test2a = ($res2['code'] ?? 0) === 401;
    report('2a', 'Invalid signature rejected with HTTP 401', $test2a, json_encode($res2));

    // 2b. Payment remains Pending
    $pRow2 = $paymentModel2->findById($pId2);
    $test2b = (($pRow2['verification_status'] ?? '') === 'Pending');
    report('2b', 'Payment remains Pending after invalid signature', $test2b,
        'actual_status=' . ($pRow2['verification_status'] ?? 'null'));
}

// ----------------------------------------------------------------------
// TEST 3: AMOUNT MISMATCH
// ----------------------------------------------------------------------
{
    // Use a NEW CS ID so idempotency doesn't block the mismatch check
    $csId3 = 'cs_b9b_test_03_' . bin2hex(random_bytes(4));
    $tamperedAmountCents = $lotPriceCents - 100; // 100 cents less

    $rawBody3 = buildRealHostedCheckoutPayload($csId3, $tamperedAmountCents, 'PHP', false, 'checkout_session.payment.paid');
    $sig3 = makeSignature($rawBody3, $testSecret, false, true);

    // Also create a new payment record for this test
    $paymentModel3 = new Payment();
    // Re-create schedule and lot references for the new payment
    $scheduleModel3 = new Schedule();
    $scheduleRow3 = $scheduleModel3->findById($scheduleId);
    $scheduleId3 = $scheduleRow3 ? $scheduleRow3['schedule_id'] : 0;

    $paymentId3 = $paymentModel3->create([
        'transaction_type' => 'Lot Purchase',
        'reference_id' => $scheduleId3,
        'reference_kind' => 'schedule',
        'amount' => $lotPriceCents / 100,  // authoritative: full lot price
        'payment_date' => date('Y-m-d'),
        'payment_method' => 'PayMongo',
        'receipt_number' => 'RCPT-B9B-003',
        'notes' => 'BATCH9B_TEST amount mismatch - webhook sends different amount',
        'received_by' => 1,
        'verification_status' => 'Pending',
    ]);

    $paymentModel3->setGatewaySession($paymentId3, 'paymongo', $csId3, 'pi_init_' . $paymentId3, 'awaiting_payment_method');

    $paymentController3 = new PaymentController();
    $res3 = $paymentController3->handleWebhook($rawBody3, $sig3);

    $paymentRow3 = $paymentModel3->findById($paymentId3);
    $test3a = (
        ($res3['code'] ?? 0) === 200
        && ($res3['status'] ?? '') === 'mismatch'
    );
    report('3a', 'Amount mismatch returns 200 with mismatch status', $test3a, json_encode($res3));

    $test3b = (($paymentRow3['verification_status'] ?? '') === 'Pending');
    report('3b', 'Payment remains Pending after amount mismatch', $test3b,
        'actual_status=' . ($paymentRow3['verification_status'] ?? 'null'));
}

// ----------------------------------------------------------------------
// TEST 4: CURRENCY MISMATCH
// ----------------------------------------------------------------------
{
    // Use a NEW CS ID so idempotency doesn't block the mismatch check
    $csId4 = 'cs_b9b_test_04_' . bin2hex(random_bytes(4));

    $rawBody4 = buildRealHostedCheckoutPayload($csId4, $lotPriceCents, 'USD', false, 'checkout_session.payment.paid');
    $sig4 = makeSignature($rawBody4, $testSecret, false, true);

    // Also create a new payment record for this test
    $paymentModel4 = new Payment();
    $scheduleModel4 = new Schedule();
    $scheduleRow4 = $scheduleModel4->findById($scheduleId);
    $scheduleId4 = $scheduleRow4 ? $scheduleRow4['schedule_id'] : 0;

    $paymentId4 = $paymentModel4->create([
        'transaction_type' => 'Lot Purchase',
        'reference_id' => $scheduleId4,
        'reference_kind' => 'schedule',
        'amount' => $lotPriceCents / 100,
        'payment_date' => date('Y-m-d'),
        'payment_method' => 'PayMongo',
        'receipt_number' => 'RCPT-B9B-004',
        'notes' => 'BATCH9B_TEST currency mismatch',
        'received_by' => 1,
        'verification_status' => 'Pending',
    ]);

    $paymentModel4->setGatewaySession($paymentId4, 'paymongo', $csId4, 'pi_init_' . $paymentId4, 'awaiting_payment_method');

    $paymentController4 = new PaymentController();
    $res4 = $paymentController4->handleWebhook($rawBody4, $sig4);

    $paymentRow4 = $paymentModel4->findById($paymentId4);
    $test4a = (
        ($res4['code'] ?? 0) === 200
        && ($res4['status'] ?? '') === 'mismatch'
    );
    report('4a', 'Currency mismatch returns 200 with mismatch status', $test4a, json_encode($res4));

    $test4b = (($paymentRow4['verification_status'] ?? '') === 'Pending');
    report('4b', 'Payment remains Pending after currency mismatch', $test4b,
        'actual_status=' . ($paymentRow4['verification_status'] ?? 'null'));
}

// ----------------------------------------------------------------------
// TEST 5: DUPLICATE WEBHOOK IDEMPOTENCY
// ----------------------------------------------------------------------
{
    global $lotId, $lotPriceCents, $scheduleId, $paymentModel, $csId1, $pId1;

    // Re-deliver the same valid webhook
    $paymentController5 = new PaymentController();
    $res5 = $paymentController5->handleWebhook($rawBody1, $sig1);

    $paymentRow5 = $paymentModel->findById($pId1);
    $test5a = (
        ($res5['code'] ?? 0) === 200
        && ($res5['status'] ?? '') === 'duplicate'
    );
    report('5a', 'Duplicate webhook returns 200 with status duplicate', $test5a, json_encode($res5));

    // Payment should still be Verified (not re-processed)
    $test5b = (($paymentRow5['verification_status'] ?? '') === 'Verified');
    report('5b', 'Payment remains Verified after duplicate webhook', $test5b,
        'actual_status=' . ($paymentRow5['verification_status'] ?? 'null'));
}

// ----------------------------------------------------------------------
// TEST 6: CORRECT IDENTITY CHAIN
// payment.reference_id = schedule_id, schedule.lot_id = original lot_id
// ----------------------------------------------------------------------
{
    global $lotId, $scheduleId, $paymentModel, $pId1;

    // After the webhook in Test 1, verify the identity chain
    $paymentRow6 = $paymentModel->findById($pId1);
    $scheduleModel6 = new Schedule();
    $scheduleRow6 = $scheduleModel6->findById($scheduleId);

    $test6a = (
        ($paymentRow6['reference_id'] ?? null) === $scheduleId
        && ($paymentRow6['reference_kind'] ?? '') === 'schedule'
    );
    report('6a', 'payment.reference_id = schedule_id and reference_kind = schedule', $test6a,
        'payment.reference_id=' . ($paymentRow6['reference_id'] ?? 'null') . ' schedule_id=' . $scheduleId);

    $test6b = (
        ($scheduleRow6['lot_id'] ?? null) === $lotId
    );
    report('6b', 'schedule.lot_id = original lot_id', $test6b,
        'schedule.lot_id=' . ($scheduleRow6['lot_id'] ?? 'null') . ' lot_id=' . $lotId);
}

// ----------------------------------------------------------------------
// Final report
// ----------------------------------------------------------------------
echo "\n======================================================\n";
echo "PayMongo Batch 9B Webhook Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);