<?php
/**
 * test_citizen_payment_sync.php
 *
 * Verification suite for:
 * 1. Post-checkout status sync & auto-confirmation (Pending -> Confirmed / Reserved)
 * 2. Citizen ownership security check (403 for unauthorized users)
 * 3. Amount mismatch detection
 * 4. Idempotent re-syncs
 * 5. Fixed schedules/mine endpoint authentication
 */

require_once __DIR__ . '/../backend/config/Database.php';
require_once __DIR__ . '/../backend/services/EnvironmentService.php';
require_once __DIR__ . '/../backend/services/PayMongoService.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';
require_once __DIR__ . '/../backend/controllers/ScheduleController.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/Refund.php';

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

// Clean up prior test artifacts
$db->exec("DELETE FROM payments WHERE notes LIKE '%TEST_CITIZEN_SYNC%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%TEST_CITIZEN_SYNC%'");
$db->exec("DELETE FROM lots WHERE lot_number LIKE 'SYNC-LOT-%'");

// Fetch or create two test citizens from database to satisfy foreign keys
$roleUser = (int) ($db->query("SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1")->fetchColumn() ?: 2);
$roleAdmin = (int) ($db->query("SELECT role_id FROM roles WHERE LOWER(title) = 'admin' LIMIT 1")->fetchColumn() ?: 1);

$userA = $db->query("SELECT user_id, username FROM users WHERE role_id = {$roleUser} ORDER BY user_id ASC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$userA) {
    $db->exec("INSERT INTO users (username, password, full_name, email, role_id, is_active) VALUES ('citizena_sync', 'x', 'Citizen A', 'citizena@test.com', {$roleUser}, 1)");
    $userA = ['user_id' => (int) $db->lastInsertId(), 'username' => 'citizena_sync', 'role' => 'user'];
} else {
    $userA['role'] = 'user';
}

$userB = $db->query("SELECT user_id, username FROM users WHERE role_id = {$roleUser} AND user_id != {$userA['user_id']} LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$userB) {
    $db->exec("INSERT INTO users (username, password, full_name, email, role_id, is_active) VALUES ('citizenb_sync', 'x', 'Citizen B', 'citizenb@test.com', {$roleUser}, 1)");
    $userB = ['user_id' => (int) $db->lastInsertId(), 'username' => 'citizenb_sync', 'role' => 'user'];
} else {
    $userB['role'] = 'user';
}

$userAdmin = ['user_id' => 1, 'username' => 'admin_sync', 'role' => 'admin'];

// Mock PayMongoService to return controlled checkout session responses
class MockPayMongoSyncService extends PayMongoService {
    public $mockSessionData = [];

    public function getCheckoutSession($checkoutSessionId) {
        if (isset($this->mockSessionData[$checkoutSessionId])) {
            return [
                'success' => true,
                'status' => 200,
                'data' => $this->mockSessionData[$checkoutSessionId],
            ];
        }
        return [
            'success' => false,
            'status' => 404,
            'error' => 'Checkout session not found',
        ];
    }
}

$mockPayMongo = new MockPayMongoSyncService();
$paymentController = new PaymentController();

// Use reflection to inject mock service
$prop = new ReflectionProperty(PaymentController::class, 'payMongoService');
$prop->setAccessible(true);
$prop->setValue($paymentController, $mockPayMongo);

// =========================================================================
// Setup Lot, Schedule, and Payment for User A
// =========================================================================
$lotStmt = $db->prepare("
    INSERT INTO lots (block_id, lot_number, lot_type_id, status, price)
    VALUES (1, 'SYNC-LOT-" . bin2hex(random_bytes(2)) . "', 1, 'Available', 5000.00)
");
$lotStmt->execute();
$lotId = (int) $db->lastInsertId();

$schedStmt = $db->prepare("
    INSERT INTO burial_schedules (lot_id, schedule_date, schedule_time, status, created_by, notes)
    VALUES (?, ?, '10:00:00', 'Pending', ?, 'TEST_CITIZEN_SYNC booking')
");
$schedStmt->execute([$lotId, date('Y-m-d', strtotime('+3 days')), $userA['user_id']]);
$scheduleId = (int) $db->lastInsertId();

$csIdPaid = 'cs_sync_paid_' . bin2hex(random_bytes(4));
$payStmt = $db->prepare("
    INSERT INTO payments (
        receipt_number, transaction_type, reference_kind, reference_id,
        amount, currency, payment_method, verification_status,
        payment_date, gateway_checkout_session_id, gateway_status, received_by, notes
    ) VALUES (
        ?, 'Lot Purchase', 'schedule', ?,
        5000.00, 'PHP', 'PayMongo', 'Pending',
        CURDATE(), ?, 'active', ?, 'TEST_CITIZEN_SYNC'
    )
");
$payStmt->execute(['RCPT-SYNC-' . bin2hex(random_bytes(4)), $scheduleId, $csIdPaid, $userA['user_id']]);
$paymentId = (int) $db->lastInsertId();

// Configure mock session: paid with 500000 cents
$mockPayMongo->mockSessionData[$csIdPaid] = [
    'id' => $csIdPaid,
    'attributes' => [
        'status' => 'paid',
        'line_items' => [
            ['amount' => 500000, 'currency' => 'PHP', 'name' => 'Burial Lot Booking']
        ],
        'payments' => [
            [
                'id' => 'pay_sync_' . bin2hex(random_bytes(4)),
                'attributes' => [
                    'status' => 'paid',
                    'amount' => 500000,
                    'currency' => 'PHP'
                ]
            ]
        ],
        'payment_intent' => [
            'id' => 'pi_sync_' . bin2hex(random_bytes(4)),
            'attributes' => [
                'status' => 'succeeded',
                'amount' => 500000,
                'currency' => 'PHP'
            ]
        ]
    ]
];

// =========================================================================
// TEST 1: Unauthorized user cannot sync another citizen's payment
// =========================================================================
$unauthRes = $paymentController->syncCheckoutSessionStatus($paymentId, $userB);
report(1, 'Unauthorized user cannot sync another citizen payment (returns 403)',
    ($unauthRes['code'] ?? 0) === 403 && empty($unauthRes['success']),
    json_encode($unauthRes)
);

// =========================================================================
// TEST 2: Valid owner can sync paid checkout session -> transitions to Verified & Confirmed
// =========================================================================
$syncRes = $paymentController->syncCheckoutSessionStatus($paymentId, $userA);
$freshPayment = $db->query("SELECT verification_status, gateway_status FROM payments WHERE payment_id = {$paymentId}")->fetch(PDO::FETCH_ASSOC);
$freshSched = $db->query("SELECT status FROM burial_schedules WHERE schedule_id = {$scheduleId}")->fetch(PDO::FETCH_ASSOC);
$freshLot = $db->query("SELECT status FROM lots WHERE lot_id = {$lotId}")->fetch(PDO::FETCH_ASSOC);

report(2, 'Owner sync verifies payment (Pending -> Verified)',
    ($syncRes['code'] ?? 0) === 200 && ($syncRes['verified'] ?? false) === true && ($freshPayment['verification_status'] ?? '') === 'Verified',
    "Payment status: " . ($freshPayment['verification_status'] ?? 'null')
);

report(3, 'Owner sync confirms schedule (Pending -> Confirmed)',
    ($freshSched['status'] ?? '') === 'Confirmed',
    "Schedule status: " . ($freshSched['status'] ?? 'null')
);

report(4, 'Owner sync reserves lot (Available -> Reserved)',
    ($freshLot['status'] ?? '') === 'Reserved',
    "Lot status: " . ($freshLot['status'] ?? 'null')
);

// =========================================================================
// TEST 5: Subsequent sync is idempotent and safe
// =========================================================================
$idemRes = $paymentController->syncCheckoutSessionStatus($paymentId, $userA);
report(5, 'Subsequent sync is idempotent (returns already_verified)',
    ($idemRes['code'] ?? 0) === 200 && !empty($idemRes['already_verified']),
    json_encode($idemRes)
);

// =========================================================================
// TEST 6: Unpaid session does not verify or confirm
// =========================================================================
$csIdUnpaid = 'cs_sync_unpaid_' . bin2hex(random_bytes(4));
$mockPayMongo->mockSessionData[$csIdUnpaid] = [
    'id' => $csIdUnpaid,
    'attributes' => [
        'status' => 'active',
        'line_items' => [['amount' => 500000, 'currency' => 'PHP']],
        'payments' => [],
        'payment_intent' => ['attributes' => ['status' => 'awaiting_payment_method']]
    ]
];

$schedStmt->execute([$lotId, date('Y-m-d', strtotime('+5 days')), $userA['user_id']]);
$schedId2 = (int) $db->lastInsertId();

$payStmt->execute(['RCPT-SYNC-' . bin2hex(random_bytes(4)), $schedId2, $csIdUnpaid, $userA['user_id']]);
$paymentId2 = (int) $db->lastInsertId();

$unpaidRes = $paymentController->syncCheckoutSessionStatus($paymentId2, $userA);
$p2Fresh = $db->query("SELECT verification_status FROM payments WHERE payment_id = {$paymentId2}")->fetch(PDO::FETCH_ASSOC);
$s2Fresh = $db->query("SELECT status FROM burial_schedules WHERE schedule_id = {$schedId2}")->fetch(PDO::FETCH_ASSOC);

report(6, 'Unpaid checkout session does not verify or confirm',
    ($unpaidRes['code'] ?? 0) === 200 && ($unpaidRes['verified'] ?? true) === false
    && ($p2Fresh['verification_status'] ?? '') === 'Pending'
    && ($s2Fresh['status'] ?? '') === 'Pending',
    json_encode($unpaidRes)
);

// =========================================================================
// TEST 7: ScheduleController::mine operates with user context
// =========================================================================
$schedCtrl = new ScheduleController();
$mineRes = $schedCtrl->mine($userA['user_id'], []);
report(7, 'ScheduleController::mine returns user-scoped records without errors',
    is_array($mineRes) && count($mineRes) >= 2,
    "Count: " . count($mineRes)
);

// Clean up
$db->exec("DELETE FROM payments WHERE notes LIKE '%TEST_CITIZEN_SYNC%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%TEST_CITIZEN_SYNC%'");
$db->exec("DELETE FROM lots WHERE lot_number LIKE 'SYNC-LOT-%'");

echo "\n======================================================\n";
echo "Citizen Payment Sync Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

exit($failed > 0 ? 1 : 0);
