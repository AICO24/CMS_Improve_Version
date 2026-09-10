<?php
/**
 * PayMongo Refund Foundation & Service Tests — Batch 5
 *
 * Verifies all required Batch 5 contracts:
 *  1. Migration file exists and recorded in schema_migrations
 *  2. refunds table exists in database
 *  3. Required columns exist in refunds table
 *  4. Gateway refund ID uniqueness constraint exists
 *  5. Payment foreign key constraint exists
 *  6. Successful Verified payment is refundable
 *  7. Pending payment rejected (400)
 *  8. Rejected payment rejected (400)
 *  9. Missing gateway payment ID rejected (400)
 * 10. Zero refund rejected (400)
 * 11. Negative refund rejected (400)
 * 12. Refund exceeding remaining balance rejected (400)
 * 13. Exact full refund accepted (200, Succeeded)
 * 14. Partial refund accepted (200)
 * 15. Multiple partial refunds calculate remaining balance correctly
 * 16. Over-refund across multiple refund records rejected (400)
 * 17. Admin authorization accepted
 * 18. Staff authorization accepted
 * 19. User/Citizen authorization rejected (403)
 * 20. Client cannot override payment amount
 * 21. Client cannot override currency
 * 22. Client cannot override gateway payment ID
 * 23. Gateway refund request uses stored gateway payment ID
 * 24. Gateway refund response persisted safely with ref_... ID
 * 25. PayMongo failure handled safely without false success (400/502)
 * 26. Duplicate request / idempotency: retry uses same cms_refund_{id} key
 * 27. Gateway secret never appears in response/log/exception
 * 28. Booking/lot state is NOT automatically changed
 * 29. AuditLog and Notification records created
 * 30. PayMongoService createRefund & getRefund method signatures and error handling
 * 31. Ambiguous timeout preserved in recoverable Processing state
 * 32. Refund reasons strictly validated against supported PayMongo values
 *
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_refunds_b5.php
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
$lotModel = new Lot();
$auditLogModel = new AuditLog();
$notificationModel = new Notification();

// Clean up any test records from prior runs (respecting FK)
$db->exec("DELETE FROM refunds WHERE payment_id IN (SELECT payment_id FROM payments WHERE notes LIKE '%BATCH5_TEST%') OR notes LIKE '%BATCH5_TEST%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH5_TEST%'");

// Establish test credentials
$testSecret = 'sk_test_mock_batch5_secret_key_12345';
putenv("PAYMONGO_SECRET_KEY={$testSecret}");
$_ENV['PAYMONGO_SECRET_KEY'] = $testSecret;
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';

// Test actors
$adminUser = ['user_id' => 1, 'username' => 'admin_test', 'role' => 'admin'];
$staffUser = ['user_id' => 2, 'username' => 'staff_test', 'role' => 'staff'];
$citizenUser = ['user_id' => 3, 'username' => 'citizen_test', 'role' => 'user'];

// Find or set an available lot
$testLot = $db->query("SELECT lot_id, lot_number, price, status FROM lots WHERE price > 100 ORDER BY lot_id ASC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$lotId = (int) $testLot['lot_id'];
$lotPrice = (float) $testLot['price'];
$initialLotStatus = $testLot['status'] ?? 'Available';

// Helper to create test payments
function createVerifiedPayMongoPayment($paymentModel, $lotId, $amount, $payId = null) {
    if ($payId === null) {
        $payId = 'pay_b5_test_' . bin2hex(random_bytes(6));
    }
    $csId = 'cs_b5_test_' . bin2hex(random_bytes(6));
    $paymentId = $paymentModel->create([
        'transaction_type' => 'Lot Purchase',
        'reference_id' => $lotId,
        'reference_kind' => 'lot',
        'amount' => $amount,
        'payment_date' => date('Y-m-d'),
        'payment_method' => 'PayMongo',
        'receipt_number' => 'RCPT-B5-' . bin2hex(random_bytes(3)),
        'notes' => 'BATCH5_TEST verified payment',
        'received_by' => 1,
        'verification_status' => 'Verified',
    ]);
    $paymentModel->setGatewaySession($paymentId, 'paymongo', $csId, 'pi_init_' . $paymentId, 'paid');
    $paymentModel->setGatewayPaymentId($paymentId, $payId, 'paid');
    return ['payment_id' => $paymentId, 'gateway_payment_id' => $payId, 'checkout_session_id' => $csId];
}

/**
 * Mock PayMongoService for testing various remote response conditions.
 */
class MockPayMongoService extends PayMongoService {
    public $lastAttributes = null;
    public $lastIdempotencyKey = null;
    public $responseToReturn = null;

    public function createRefund(array $attributes, $idempotencyKey = null) {
        $this->lastAttributes = $attributes;
        $this->lastIdempotencyKey = $idempotencyKey;

        if ($this->responseToReturn !== null) {
            return $this->responseToReturn;
        }

        // Default mock success
        $refId = 'ref_test_' . bin2hex(random_bytes(8));
        return [
            'success' => true,
            'status' => 200,
            'data' => [
                'id' => $refId,
                'type' => 'refund',
                'attributes' => [
                    'amount' => $attributes['amount'],
                    'currency' => 'PHP',
                    'payment_id' => $attributes['payment_id'],
                    'reason' => $attributes['reason'],
                    'status' => 'succeeded',
                ]
            ]
        ];
    }
}

// Instantiate shared mock service and controller
$mockService = new MockPayMongoService();
$refundServiceWithMock = new RefundService(null, null, $mockService);
$paymentController->setRefundService($refundServiceWithMock);

// ============================================================
// TEST 1: Migration file exists and recorded in schema_migrations
// ============================================================
$migFile = __DIR__ . '/../backend/database/migration_20260910_add_refunds_table.sql';
$migRecorded = $db->query("SELECT COUNT(*) FROM schema_migrations WHERE migration = 'migration_20260910_add_refunds_table.sql'")->fetchColumn();
report(1, 'Migration file exists and recorded in schema_migrations', file_exists($migFile) && $migRecorded > 0);

// ============================================================
// TEST 2: refunds table exists in database
// ============================================================
$tables = $db->query("SHOW TABLES LIKE 'refunds'")->fetchAll();
report(2, 'refunds table exists in database', count($tables) === 1);

// ============================================================
// ============================================================
// TEST 3: Required columns exist in refunds table
// ============================================================
$cols = $db->query("DESCRIBE refunds")->fetchAll(PDO::FETCH_COLUMN);
$expectedCols = ['refund_id', 'payment_id', 'gateway_refund_id', 'gateway_provider', 'amount', 'currency', 'status', 'reason', 'notes', 'requested_by', 'created_at', 'updated_at', 'processed_at', 'idempotency_key'];
$diff = array_diff($expectedCols, $cols);
report(3, 'Required columns exist in refunds table', empty($diff), 'Missing: ' . implode(',', $diff));

// ============================================================
// TEST 4: Gateway refund ID uniqueness constraint exists
// ============================================================
$indexes = $db->query("SHOW INDEX FROM refunds WHERE Key_name = 'uq_refund_gateway_refund_id'")->fetchAll();
report(4, 'Gateway refund ID unique constraint exists', count($indexes) > 0 && (int)$indexes[0]['Non_unique'] === 0);

// ============================================================
// TEST 4b: Request idempotency key unique constraint exists
// ============================================================
$idemIndexes = $db->query("SHOW INDEX FROM refunds WHERE Key_name = 'uq_refund_idempotency_key'")->fetchAll();
report('4b', 'Request idempotency key unique constraint exists', count($idemIndexes) > 0 && (int)$idemIndexes[0]['Non_unique'] === 0);

// ============================================================
// TEST 5: Payment foreign key constraint exists
// ============================================================
$fks = $db->query("
    SELECT CONSTRAINT_NAME
    FROM information_schema.KEY_COLUMN_USAGE
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'refunds'
      AND COLUMN_NAME = 'payment_id'
      AND REFERENCED_TABLE_NAME = 'payments'
")->fetchAll();
report(5, 'Foreign key constraint on payment_id exists', count($fks) > 0);

// ============================================================
// TEST 6: Successful Verified payment is refundable
// ============================================================
$p6 = createVerifiedPayMongoPayment($paymentModel, $lotId, 1000.00);
$res6 = $refundServiceWithMock->processRefund($p6['payment_id'], 1000.00, 'requested_by_customer', 'BATCH5_TEST full refund', $adminUser);
report(6, 'Successful Verified payment is refundable (HTTP 200, Succeeded)',
    ($res6['code'] ?? 0) === 200 && ($res6['status'] ?? '') === 'Succeeded' && !empty($res6['gateway_refund_id']),
    json_encode($res6)
);

// ============================================================
// TEST 7: Pending payment rejected (400)
// ============================================================
$p7Id = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'amount' => 500.00,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'PayMongo',
    'receipt_number' => 'RCPT-B5-7',
    'notes' => 'BATCH5_TEST pending payment',
    'received_by' => 1,
    'verification_status' => 'Pending',
]);
$paymentModel->setGatewaySession($p7Id, 'paymongo', 'cs_test_7', 'pi_test_7', 'awaiting_payment_method');
$paymentModel->setGatewayPaymentId($p7Id, 'pay_test_7', 'paid');

$res7 = $refundServiceWithMock->processRefund($p7Id, 500.00, 'requested_by_customer', 'BATCH5_TEST', $adminUser);
report(7, 'Pending payment rejected for refund with HTTP 400', ($res7['code'] ?? 0) === 400, json_encode($res7));

// ============================================================
// TEST 8: Rejected payment rejected (400)
// ============================================================
$p8Id = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'amount' => 500.00,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'PayMongo',
    'receipt_number' => 'RCPT-B5-8',
    'notes' => 'BATCH5_TEST rejected payment',
    'received_by' => 1,
    'verification_status' => 'Rejected',
]);
$paymentModel->setGatewaySession($p8Id, 'paymongo', 'cs_test_8', 'pi_test_8', 'failed');
$paymentModel->setGatewayPaymentId($p8Id, 'pay_test_8', 'failed');

$res8 = $refundServiceWithMock->processRefund($p8Id, 500.00, 'requested_by_customer', 'BATCH5_TEST', $adminUser);
report(8, 'Rejected payment rejected for refund with HTTP 400', ($res8['code'] ?? 0) === 400, json_encode($res8));

// ============================================================
// TEST 9: Missing gateway payment ID rejected (400)
// ============================================================
$p9Id = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'amount' => 500.00,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'PayMongo',
    'receipt_number' => 'RCPT-B5-9',
    'notes' => 'BATCH5_TEST no gateway payment id',
    'received_by' => 1,
    'verification_status' => 'Verified',
]);
$res9 = $refundServiceWithMock->processRefund($p9Id, 500.00, 'requested_by_customer', 'BATCH5_TEST', $adminUser);
report(9, 'Payment without gateway payment ID rejected with HTTP 400', ($res9['code'] ?? 0) === 400, json_encode($res9));

// ============================================================
// TEST 10: Zero refund rejected (400)
// ============================================================
$p10 = createVerifiedPayMongoPayment($paymentModel, $lotId, 500.00);
$res10 = $refundServiceWithMock->processRefund($p10['payment_id'], 0.00, 'requested_by_customer', 'BATCH5_TEST', $adminUser);
report(10, 'Zero refund amount rejected with HTTP 400', ($res10['code'] ?? 0) === 400, json_encode($res10));

// ============================================================
// TEST 11: Negative refund rejected (400)
// ============================================================
$res11 = $refundServiceWithMock->processRefund($p10['payment_id'], -50.00, 'requested_by_customer', 'BATCH5_TEST', $adminUser);
report(11, 'Negative refund amount rejected with HTTP 400', ($res11['code'] ?? 0) === 400, json_encode($res11));

// ============================================================
// TEST 12: Refund exceeding remaining balance rejected (400)
// ============================================================
$res12 = $refundServiceWithMock->processRefund($p10['payment_id'], 500.01, 'requested_by_customer', 'BATCH5_TEST', $adminUser);
report(12, 'Refund exceeding original amount rejected with HTTP 400', ($res12['code'] ?? 0) === 400, json_encode($res12));

// ============================================================
// TEST 13: Exact full refund accepted (200, Succeeded)
// ============================================================
$p13 = createVerifiedPayMongoPayment($paymentModel, $lotId, 750.00);
$res13 = $refundServiceWithMock->processRefund($p13['payment_id'], 750.00, 'requested_by_customer', 'BATCH5_TEST full refund', $adminUser);
report(13, 'Exact full refund accepted with HTTP 200 and Succeeded status',
    ($res13['code'] ?? 0) === 200 && ($res13['amount'] ?? 0) == 750.00 && ($res13['status'] ?? '') === 'Succeeded',
    json_encode($res13)
);

// Verify remaining refundable is now 0
$rem13 = $refundModel->calculateRemainingRefundable($p13['payment_id'], 750.00);
report('13b', 'Remaining refundable balance correctly calculated as 0.00 after full refund', $rem13 == 0.0, "rem={$rem13}");

// Subsequent refund on fully refunded payment rejected
$res13c = $refundServiceWithMock->processRefund($p13['payment_id'], 10.00, 'requested_by_customer', 'BATCH5_TEST', $adminUser);
report('13c', 'Subsequent refund rejected on fully refunded payment', ($res13c['code'] ?? 0) === 400, json_encode($res13c));

// ============================================================
// TEST 14: Partial refund accepted (200)
// ============================================================
$p14 = createVerifiedPayMongoPayment($paymentModel, $lotId, 1000.00);
$res14 = $refundServiceWithMock->processRefund($p14['payment_id'], 300.00, 'requested_by_customer', 'BATCH5_TEST partial #1', $adminUser);
report(14, 'Partial refund #1 accepted with HTTP 200',
    ($res14['code'] ?? 0) === 200 && ($res14['amount'] ?? 0) == 300.00,
    json_encode($res14)
);

// ============================================================
// TEST 15: Multiple partial refunds calculate remaining balance correctly
// ============================================================
$rem15a = $refundModel->calculateRemainingRefundable($p14['payment_id'], 1000.00);
report('15a', 'Remaining refundable balance correctly calculated as 700.00 after partial #1', $rem15a == 700.00, "rem={$rem15a}");

// Issue partial refund #2 of 400.00
$res15b = $refundServiceWithMock->processRefund($p14['payment_id'], 400.00, 'requested_by_customer', 'BATCH5_TEST partial #2', $adminUser);
$rem15b = $refundModel->calculateRemainingRefundable($p14['payment_id'], 1000.00);
report(15, 'Multiple partial refunds update remaining balance correctly (remaining: 300.00)',
    ($res15b['code'] ?? 0) === 200 && $rem15b == 300.00,
    "rem={$rem15b}"
);

// ============================================================
// TEST 16: Over-refund across multiple refund records rejected (400)
// ============================================================
// Requesting 300.01 when 300.00 is left must fail
$res16 = $refundServiceWithMock->processRefund($p14['payment_id'], 300.01, 'requested_by_customer', 'BATCH5_TEST over-refund', $adminUser);
report(16, 'Over-refund across multiple partial requests rejected with HTTP 400',
    ($res16['code'] ?? 0) === 400 && strpos($res16['error'], 'exceeds remaining') !== false,
    json_encode($res16)
);

// Exactly 300.00 succeeds
$res16b = $refundServiceWithMock->processRefund($p14['payment_id'], 300.00, 'requested_by_customer', 'BATCH5_TEST final partial', $adminUser);
$rem16b = $refundModel->calculateRemainingRefundable($p14['payment_id'], 1000.00);
report('16b', 'Final partial refund taking balance to zero succeeds',
    ($res16b['code'] ?? 0) === 200 && $rem16b == 0.00,
    "rem={$rem16b}"
);

// ============================================================
// TEST 17: Admin authorization accepted
// ============================================================
$p17 = createVerifiedPayMongoPayment($paymentModel, $lotId, 200.00);
$res17 = $paymentController->refund($p17['payment_id'], ['amount' => 50.00], $adminUser);
report(17, 'Admin authorization accepted for refund initiation', ($res17['code'] ?? 0) === 200, json_encode($res17));

// ============================================================
// TEST 18: Staff authorization accepted
// ============================================================
$res18 = $paymentController->refund($p17['payment_id'], ['amount' => 50.00], $staffUser);
report(18, 'Staff authorization accepted for refund initiation', ($res18['code'] ?? 0) === 200, json_encode($res18));

// ============================================================
// TEST 19: User/Citizen authorization rejected (403)
// ============================================================
$res19 = $paymentController->refund($p17['payment_id'], ['amount' => 50.00], $citizenUser);
report(19, 'User/Citizen authorization rejected with HTTP 403', ($res19['code'] ?? 0) === 403, json_encode($res19));

// ============================================================
// TEST 20: Client cannot override payment amount
// ============================================================
$p20 = createVerifiedPayMongoPayment($paymentModel, $lotId, 100.00);
// Client attempts to pass a fabricated original payment amount or excessive refund
$res20 = $paymentController->refund($p20['payment_id'], ['amount' => 9999.00, 'original_amount' => 99999.00], $adminUser);
report(20, 'Client cannot override payment amount or bypass server limit', ($res20['code'] ?? 0) === 400, json_encode($res20));

// ============================================================
// TEST 21: Client cannot override currency
// ============================================================
$res21 = $refundServiceWithMock->processRefund($p20['payment_id'], 50.00, 'requested_by_customer', 'BATCH5_TEST', $adminUser);
$savedRefund21 = $refundModel->findById((int) $res21['refund_id']);
report(21, 'Currency is authoritative PHP and cannot be overridden by client',
    $savedRefund21['currency'] === 'PHP',
    'currency=' . ($savedRefund21['currency'] ?? 'null')
);

// ============================================================
// TEST 22: Client cannot override gateway payment ID
// ============================================================
// Client passes a fake gateway_payment_id in the input
$res22 = $paymentController->refund($p20['payment_id'], ['amount' => 10.00, 'gateway_payment_id' => 'pay_fabricated_fake'], $adminUser);
// In backend, RefundService uses the DB record's gateway_payment_id (not the client input)
report(22, 'Client cannot override gateway payment ID (sent to gateway is stored ID)',
    ($res22['code'] ?? 0) === 200 && ($mockService->lastAttributes['payment_id'] ?? '') !== 'pay_fabricated_fake'
    && ($mockService->lastAttributes['payment_id'] ?? '') === $p20['gateway_payment_id'],
    'last_sent=' . ($mockService->lastAttributes['payment_id'] ?? 'null')
);

// ============================================================
// TEST 23: Gateway refund request uses stored gateway payment ID
// ============================================================
$p23 = createVerifiedPayMongoPayment($paymentModel, $lotId, 500.00, 'pay_stored_auth_id_777');
$res23 = $refundServiceWithMock->processRefund($p23['payment_id'], 100.00, 'requested_by_customer', 'BATCH5_TEST', $adminUser);
report(23, 'Gateway refund request accurately uses stored gateway payment ID',
    ($mockService->lastAttributes['payment_id'] ?? '') === 'pay_stored_auth_id_777',
    'sent=' . ($mockService->lastAttributes['payment_id'] ?? 'null')
);

// ============================================================
// TEST 24: Gateway refund response persisted safely with ref_... ID
// ============================================================
$savedRefund23 = $refundModel->findById((int) $res23['refund_id']);
report(24, 'Gateway refund response persisted safely with ref_... ID',
    !empty($savedRefund23['gateway_refund_id']) && strpos($savedRefund23['gateway_refund_id'], 'ref_') === 0,
    'persisted=' . ($savedRefund23['gateway_refund_id'] ?? 'null')
);

// ============================================================
// TEST 25: PayMongo failure handled safely without false success (400)
// ============================================================
$p25 = createVerifiedPayMongoPayment($paymentModel, $lotId, 500.00);
$mockServiceFail = new MockPayMongoService();
$mockServiceFail->responseToReturn = [
    'success' => false,
    'status' => 400,
    'error' => 'amount: The refund amount must be at least 100',
];
$refundServiceFail = new RefundService(null, null, $mockServiceFail);
$res25 = $refundServiceFail->processRefund($p25['payment_id'], 100.00, 'requested_by_customer', 'BATCH5_TEST failure', $adminUser);
$savedRefund25 = $refundModel->findById((int) ($res25['refund_id'] ?? 0));

report(25, 'PayMongo failure handled safely: marked Failed without false success',
    ($res25['code'] ?? 0) === 400 && ($savedRefund25['status'] ?? '') === 'Failed',
    json_encode($res25)
);

// Ensure failed refund releases allocated amount
$rem25 = $refundModel->calculateRemainingRefundable($p25['payment_id'], 500.00);
report('25b', 'Failed refund releases allocated balance back to remaining', $rem25 == 500.00, "rem={$rem25}");

// ============================================================
// TEST 26: Duplicate request / Idempotency: uses stable cms_refund_{id} key
// ============================================================
report(26, 'Deterministic PayMongo Idempotency-Key uses format cms_refund_{id}',
    ($mockService->lastIdempotencyKey ?? '') === "cms_refund_{$res23['refund_id']}",
    'key=' . ($mockService->lastIdempotencyKey ?? 'null')
);

// ============================================================
// TEST 27: Gateway secret never appears in response/log/exception
// ============================================================
$secretExposed = false;
$allOutputs = [
    json_encode($res6), json_encode($res13), json_encode($res14),
    json_encode($res19), json_encode($res25)
];
foreach ($allOutputs as $out) {
    if (strpos($out, $testSecret) !== false) {
        $secretExposed = true;
    }
}
$recentLogs = $db->query("SELECT details FROM audit_logs WHERE entity_type = 'Payment' ORDER BY log_id DESC LIMIT 10")->fetchAll(PDO::FETCH_ASSOC);
foreach ($recentLogs as $l) {
    if (strpos((string)$l['details'], $testSecret) !== false) {
        $secretExposed = true;
    }
}
report(27, 'Gateway secret key NEVER appears in responses or audit logs', !$secretExposed, 'Secret was leaked!');

// ============================================================
// TEST 28: Booking/lot state is NOT automatically changed
// ============================================================
// Set lot status to Reserved
$db->exec("UPDATE lots SET status = 'Reserved' WHERE lot_id = {$lotId}");
$p28 = createVerifiedPayMongoPayment($paymentModel, $lotId, 500.00);
$res28 = $refundServiceWithMock->processRefund($p28['payment_id'], 500.00, 'requested_by_customer', 'BATCH5_TEST no lot change', $adminUser);

$lotAfter = $lotModel->findById($lotId);
report(28, 'Booking/lot state is strictly NOT changed automatically by refund',
    ($lotAfter['status'] ?? '') === 'Reserved',
    'lot_status=' . ($lotAfter['status'] ?? 'null')
);

// ============================================================
// TEST 29: AuditLog and Notification records created
// ============================================================
$auditEntry28 = $db->query("SELECT * FROM audit_logs WHERE entity_type = 'Payment' AND entity_id = {$p28['payment_id']} ORDER BY log_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$notifEntry28 = $db->query("SELECT * FROM notifications WHERE notification_type = 'Payment' AND user_id = {$adminUser['user_id']} ORDER BY notification_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);

report(29, 'AuditLog and Notification created for refund execution',
    !empty($auditEntry28) && strpos($auditEntry28['action'], 'refund') !== false && !empty($notifEntry28),
    'audit=' . json_encode($auditEntry28)
);

// ============================================================
// TEST 30: PayMongoService createRefund & getRefund methods exist and format requests safely
// ============================================================
$offlineService = new PayMongoService('http://127.0.0.1:9', 1); // closed port
$reqOffline = $offlineService->createRefund([
    'amount' => 10000,
    'payment_id' => 'pay_test_offline',
    'reason' => 'requested_by_customer'
], 'cms_refund_offline_test');

$getOffline = $offlineService->getRefund('ref_test_offline');

report(30, 'PayMongoService::createRefund & getRefund handle offline failures safely without throwing',
    is_array($reqOffline) && ($reqOffline['success'] ?? true) === false
    && is_array($getOffline) && ($getOffline['success'] ?? true) === false
);

// ============================================================
// TEST 31: Ambiguous timeout preserved in recoverable Processing state
// ============================================================
$p31 = createVerifiedPayMongoPayment($paymentModel, $lotId, 600.00);
$mockService31 = new MockPayMongoService();
$mockService31->responseToReturn = [
    'success' => false,
    'status' => 0, // connection timeout / curl failure
    'error' => 'cURL error 28: Connection timed out',
];
$refundService31 = new RefundService(null, null, $mockService31);
$res31 = $refundService31->processRefund($p31['payment_id'], 600.00, 'requested_by_customer', 'BATCH5_TEST timeout', $adminUser);
$savedRefund31 = $refundModel->findById((int) ($res31['refund_id'] ?? 0));

report(31, 'Ambiguous network timeout keeps refund in Processing state for safe recovery',
    ($res31['code'] ?? 0) === 502 && ($savedRefund31['status'] ?? '') === 'Processing',
    'status=' . ($savedRefund31['status'] ?? 'null')
);

// ============================================================
// TEST 32: Refund reasons strictly validated against supported PayMongo values
// ============================================================
$p32 = createVerifiedPayMongoPayment($paymentModel, $lotId, 300.00);
$res32Invalid = $refundServiceWithMock->processRefund($p32['payment_id'], 100.00, 'arbitrary_invalid_reason', 'BATCH5_TEST', $adminUser);
$res32Valid = $refundServiceWithMock->processRefund($p32['payment_id'], 100.00, 'duplicate', 'BATCH5_TEST', $adminUser);

report(32, 'Refund reasons strictly validated against PayMongo values (rejects invalid, accepts duplicate)',
    ($res32Invalid['code'] ?? 0) === 400 && ($res32Valid['code'] ?? 0) === 200,
    "invalid={$res32Invalid['code']} valid={$res32Valid['code']}"
);

// ============================================================
// TEST 33: Exact centavo conversion for ₱1.00, ₱100.01, ₱1000.10, ₱1000.50
// ============================================================
$m33_1 = Refund::toCentavos(1.00) === 100 && Refund::toCentavos('1.00') === 100 && Refund::toCentavos('1') === 100;
$m33_100 = Refund::toCentavos(100.01) === 10001 && Refund::toCentavos('100.01') === 10001;
$m33_1000_10 = Refund::toCentavos(1000.10) === 100010 && Refund::toCentavos('1000.10') === 100010 && Refund::toCentavos('1000.1') === 100010;
$m33_1000_50 = Refund::toCentavos(1000.50) === 100050 && Refund::toCentavos('1000.50') === 100050 && Refund::toCentavos('1000.5') === 100050;
$m33_pesos = Refund::toPesos(100) === '1.00'
    && Refund::toPesos(10001) === '100.01'
    && Refund::toPesos(100010) === '1000.10'
    && Refund::toPesos(100050) === '1000.50';

report(33, 'Exact centavo conversion without float drift for ₱1.00, ₱100.01, ₱1000.10, ₱1000.50',
    $m33_1 && $m33_100 && $m33_1000_10 && $m33_1000_50 && $m33_pesos,
    "1={$m33_1} 100.01={$m33_100} 1000.10={$m33_1000_10} 1000.50={$m33_1000_50} pesos={$m33_pesos}"
);

// ============================================================
// TEST 34: Exact centavo PayMongo payload verification (integer centavos transmitted)
// ============================================================
$p34 = createVerifiedPayMongoPayment($paymentModel, $lotId, 2000.00);
$res34 = $refundServiceWithMock->processRefund($p34['payment_id'], '1000.01', 'requested_by_customer', 'BATCH5_TEST exact cents', $adminUser);
$remCents34 = $refundModel->calculateRemainingRefundableCents($p34['payment_id'], 2000.00);

report(34, 'PayMongo receives exact integer centavos (100001 for ₱1000.01) and remaining cents is exact (99999)',
    ($res34['code'] ?? 0) === 200
    && ($mockService->lastAttributes['amount'] ?? 0) === 100001
    && is_int($mockService->lastAttributes['amount'] ?? null)
    && $remCents34 === 99999
    && $refundModel->calculateRemainingRefundable($p34['payment_id'], 2000.00) == 999.99,
    'sent=' . var_export($mockService->lastAttributes['amount'] ?? null, true) . ' rem=' . $remCents34
);

// ============================================================
// TEST 35: Exact cumulative refunds and centavo precision boundary checks
// ============================================================
// On $p34 (balance remaining: 99999 cents / ₱999.99), refund ₱500.10
$res35a = $refundServiceWithMock->processRefund($p34['payment_id'], '500.10', 'requested_by_customer', 'BATCH5_TEST partial 500.10', $adminUser);
$lastAmount35a = $mockService->lastAttributes['amount'] ?? 0;
$remCents35a = $refundModel->calculateRemainingRefundableCents($p34['payment_id'], 2000.00); // 99999 - 50010 = 49989 cents

// Attempt refund exceeding by 1 centavo: 499.90 (49990 cents > 49989 cents)
$res35b = $refundServiceWithMock->processRefund($p34['payment_id'], '499.90', 'requested_by_customer', 'BATCH5_TEST exceed 1 cent', $adminUser);

// Exact remaining balance refund: 499.89 (49989 cents)
$res35c = $refundServiceWithMock->processRefund($p34['payment_id'], '499.89', 'requested_by_customer', 'BATCH5_TEST exact zero balance', $adminUser);
$lastAmount35c = $mockService->lastAttributes['amount'] ?? 0;
$remCents35c = $refundModel->calculateRemainingRefundableCents($p34['payment_id'], 2000.00); // 0 cents

// Minimum refund 100 centavos attempt when balance is 0
$res35d = $refundServiceWithMock->processRefund($p34['payment_id'], '1.00', 'requested_by_customer', 'BATCH5_TEST after full', $adminUser);

report(35, 'Cumulative centavo refund precision: 1-centavo overflow rejected, exact zero balance reached',
    ($res35a['code'] ?? 0) === 200 && $lastAmount35a === 50010
    && $remCents35a === 49989
    && ($res35b['code'] ?? 0) === 400
    && ($res35c['code'] ?? 0) === 200 && $lastAmount35c === 49989
    && $remCents35c === 0
    && ($res35d['code'] ?? 0) === 400,
    "35a={$res35a['code']} remA={$remCents35a} 35b={$res35b['code']} 35c={$res35c['code']} remC={$remCents35c} 35d={$res35d['code']}"
);

// ============================================================
// TEST 36: Request Idempotency — Same key reuses existing refund record
// ============================================================
$p36 = createVerifiedPayMongoPayment($paymentModel, $lotId, 1000.00);
$key36 = 'idemp_key_test_' . bin2hex(random_bytes(6));
$res36First = $refundServiceWithMock->processRefund($p36['payment_id'], 250.00, 'requested_by_customer', 'BATCH5_TEST idemp 1', $adminUser, $key36);

// Second identical request with same idempotency key
$res36Second = $refundServiceWithMock->processRefund($p36['payment_id'], 250.00, 'requested_by_customer', 'BATCH5_TEST idemp 2', $adminUser, $key36);

// Verify exactly one record exists with this idempotency key
$recordCount36 = $db->query("SELECT COUNT(*) FROM refunds WHERE idempotency_key = " . $db->quote($key36))->fetchColumn();

report(36, 'Request idempotency: same key returns existing refund record without creating duplicate',
    ($res36First['code'] ?? 0) === 200
    && ($res36Second['code'] ?? 0) === 200
    && ($res36Second['reused'] ?? false) === true
    && ($res36Second['refund_id'] ?? 0) === ($res36First['refund_id'] ?? -1)
    && (int) $recordCount36 === 1,
    "first_id=" . ($res36First['refund_id'] ?? 'null') . " second_id=" . ($res36Second['refund_id'] ?? 'null') . " count={$recordCount36}"
);

// ============================================================
// TEST 37: Request Idempotency — Controller and HTTP route support
// ============================================================
$key37 = 'idemp_ctrl_test_' . bin2hex(random_bytes(6));
$res37First = $paymentController->refund($p36['payment_id'], ['amount' => 100.00, 'idempotency_key' => $key37], $adminUser);
$res37Second = $paymentController->refund($p36['payment_id'], ['amount' => 100.00, 'idempotency_key' => $key37], $adminUser);

report(37, 'PaymentController forwards idempotency_key and returns existing refund on repeat',
    ($res37First['code'] ?? 0) === 200
    && ($res37Second['code'] ?? 0) === 200
    && ($res37Second['reused'] ?? false) === true
    && ($res37Second['refund_id'] ?? 0) === ($res37First['refund_id'] ?? -1),
    "first=" . json_encode($res37First) . " second=" . json_encode($res37Second)
);

// ============================================================
// TEST 38: Request Idempotency — Different keys create separate legitimate refunds
// ============================================================
$key38 = 'idemp_diff_test_' . bin2hex(random_bytes(6));
$res38 = $refundServiceWithMock->processRefund($p36['payment_id'], 150.00, 'requested_by_customer', 'BATCH5_TEST diff key', $adminUser, $key38);

report(38, 'Different idempotency key creates separate legitimate refund operation',
    ($res38['code'] ?? 0) === 200
    && ($res38['reused'] ?? false) === false
    && ($res38['refund_id'] ?? 0) !== ($res36First['refund_id'] ?? 0),
    "diff_id=" . ($res38['refund_id'] ?? 'null')
);

// ============================================================
// TEST 39: Two-Layer Idempotency separation (Request Key vs PayMongo Gateway Key)
// ============================================================
$key39 = 'idemp_layer_test_' . bin2hex(random_bytes(6));
$res39 = $refundServiceWithMock->processRefund($p36['payment_id'], 50.00, 'requested_by_customer', 'BATCH5_TEST two layers', $adminUser, $key39);
$savedRefund39 = $refundModel->findById((int) ($res39['refund_id'] ?? 0));

report(39, 'Two-layer idempotency preserved: Layer 1 stored in refunds.idempotency_key, Layer 2 is cms_refund_{id}',
    ($savedRefund39['idempotency_key'] ?? '') === $key39
    && ($mockService->lastIdempotencyKey ?? '') === "cms_refund_{$savedRefund39['refund_id']}",
    "layer1={$savedRefund39['idempotency_key']} layer2={$mockService->lastIdempotencyKey}"
);

// ============================================================
// TEST 40: Concurrent Duplicate Protection via DB unique constraint
// ============================================================
$p40 = createVerifiedPayMongoPayment($paymentModel, $lotId, 500.00);
$raceKey = 'idemp_race_' . bin2hex(random_bytes(6));
// Pre-create the record that won the race
$winningRefundId = $refundModel->create([
    'payment_id' => $p40['payment_id'],
    'gateway_provider' => 'PayMongo',
    'amount' => 100.00,
    'currency' => 'PHP',
    'status' => 'Succeeded',
    'reason' => 'requested_by_customer',
    'notes' => 'BATCH5_TEST race winner',
    'requested_by' => $adminUser['user_id'],
    'idempotency_key' => $raceKey,
]);

// Mock Refund model that simulates another thread already committed this key
$mockRefundModel = new class extends Refund {
    public $simulatedRaceKey = null;
    public function create(array $data) {
        if (!empty($data['idempotency_key']) && $data['idempotency_key'] === $this->simulatedRaceKey) {
            throw new PDOException("Duplicate entry '{$this->simulatedRaceKey}' for key 'uq_refund_idempotency_key'", 1062);
        }
        return parent::create($data);
    }
};
$mockRefundModel->simulatedRaceKey = $raceKey;
$refundServiceRace = new RefundService(null, $mockRefundModel, $mockService);
$res40 = $refundServiceRace->processRefund($p40['payment_id'], 100.00, 'requested_by_customer', 'BATCH5_TEST race loser', $adminUser, $raceKey);

report(40, 'Concurrent duplicate insert race condition caught safely and resolves to existing refund',
    ($res40['code'] ?? 0) === 200
    && ($res40['reused'] ?? false) === true
    && ($res40['refund_id'] ?? 0) === (int) $winningRefundId,
    "res=" . json_encode($res40)
);

// Cleanup test payments and test refunds (respecting FK)
$db->exec("DELETE FROM refunds WHERE payment_id IN (SELECT payment_id FROM payments WHERE notes LIKE '%BATCH5_TEST%') OR notes LIKE '%BATCH5_TEST%'");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH5_TEST%'");
$db->exec("UPDATE lots SET status = '{$initialLotStatus}' WHERE lot_id = {$lotId}");

echo "\n======================================================\n";
echo "PayMongo Batch 5 Refund Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
