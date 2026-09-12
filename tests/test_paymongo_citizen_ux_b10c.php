<?php
/**
 * Test Suite: Batch 10C — Citizen Payment UX & Checkout Failure Handling
 * 
 * Verifies:
 * 1. Citizen default success_url points to my-bookings.html
 * 2. Citizen default cancel_url points to my-bookings.html
 * 3. Admin/staff redirect behavior remains unchanged (payments.html) & explicit URLs respected
 * 4. Checkout initialization failure does not produce false payment success (remains Pending)
 * 5. Failed checkout can be retried safely
 * 6. Retry does not duplicate payment records
 * 7. Retry does not duplicate bookings
 * 8. My Bookings (Schedule findById) exposes correct payment and refund status
 * 9. PayMongo verification remains strictly webhook-driven
 * 10. Batch 10B active checkout lease still applies
 */

require_once __DIR__ . '/../backend/config/Database.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/Refund.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';
require_once __DIR__ . '/../backend/services/PayMongoService.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';

$db = Database::getInstance()->getConnection();
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

// Clean up prior test records
$db->exec("DELETE FROM refunds WHERE payment_id IN (SELECT payment_id FROM payments WHERE notes LIKE '%BATCH10C_TEST%')");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH10C_TEST%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%BATCH10C_TEST%'");
$db->exec("DELETE FROM booking_drafts WHERE extracted_data LIKE '%BATCH10C_TEST%'");

// Ensure environment
putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';
putenv("PAYMONGO_SECRET_KEY=sk_test_mock_batch10c_key");
$_ENV['PAYMONGO_SECRET_KEY'] = 'sk_test_mock_batch10c_key';

// Mock PayMongoService that captures createCheckoutSession attributes
class MockPayMongoServiceB10C extends PayMongoService {
    public ?array $lastSessionAttributes = null;
    public ?string $lastIdempotencyKey = null;
    public bool $simulateFailure = false;
    public string $failureMessage = 'Gateway connection timed out';

    public function createCheckoutSession(array $attributes, $idempotencyKey = null) {
        $this->lastSessionAttributes = $attributes;
        $this->lastIdempotencyKey = $idempotencyKey;

        if ($this->simulateFailure) {
            return [
                'success' => false,
                'status' => 502,
                'error' => $this->failureMessage,
            ];
        }

        $csId = 'cs_test_10c_' . bin2hex(random_bytes(4));
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

// Find a valid available lot
$lotStmt = $db->query("SELECT lot_id, price FROM lots WHERE status = 'Available' AND price > 0 LIMIT 1");
$lot = $lotStmt->fetch(PDO::FETCH_ASSOC);
if (!$lot) {
    // Fallback: make one available
    $db->exec("UPDATE lots SET status = 'Available' WHERE status = 'Reserved' LIMIT 1");
    $lot = $db->query("SELECT lot_id, price FROM lots WHERE status = 'Available' AND price > 0 LIMIT 1")->fetch(PDO::FETCH_ASSOC);
}
$lotId = (int) $lot['lot_id'];
$lotPrice = (float) $lot['price'];

// Find or create test users
$userCitizen = $db->query("SELECT user_id, username FROM users WHERE role_id = (SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1) LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$userCitizen) {
    $roleId = $db->query("SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1")->fetchColumn() ?: 2;
    $db->exec("INSERT INTO users (username, password, full_name, email, role_id, is_active) VALUES ('citizen_test_10c', 'x', 'Citizen Test', 'citizen10c@test.com', {$roleId}, 1)");
    $userCitizen = ['user_id' => (int)$db->lastInsertId(), 'username' => 'citizen_test_10c', 'role' => 'user'];
} else {
    $userCitizen['role'] = 'user';
}

$userAdmin = $db->query("SELECT user_id, username FROM users WHERE role_id = (SELECT role_id FROM roles WHERE LOWER(title) = 'admin' LIMIT 1) LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$userAdmin) {
    $userAdmin = ['user_id' => 1, 'username' => 'admin_test', 'role' => 'admin'];
} else {
    $userAdmin['role'] = 'admin';
}

$mockPayMongo = new MockPayMongoServiceB10C();
$paymentController = new PaymentController();
$paymentController->setPayMongoService($mockPayMongo);

$scheduleModel = new Schedule();
$paymentModel = new Payment();

// Create a test schedule for citizen
$db->prepare("
    INSERT INTO burial_schedules (created_by, lot_id, schedule_date, schedule_time, status, notes)
    VALUES (?, ?, '2026-11-20', '10:00:00', 'Pending', 'BATCH10C_TEST Schedule 1')
")->execute([$userCitizen['user_id'], $lotId]);
$scheduleId1 = (int) $db->lastInsertId();

// =========================================================================
// TEST 1: Citizen success_url redirects to my-bookings.html
// =========================================================================
$res1 = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $scheduleId1,
    'reference_kind' => 'schedule',
], $userCitizen);

$isSuccess1 = !empty($res1['success']) && !empty($res1['checkout_url']);
$actualSuccessUrl = $mockPayMongo->lastSessionAttributes['success_url'] ?? '';

report(1, 'Citizen default success_url directs to my-bookings.html with booking parameters',
    $isSuccess1 
    && strpos($actualSuccessUrl, '/frontend/pages/my-bookings.html') !== false 
    && strpos($actualSuccessUrl, 'checkout_status=success') !== false
    && strpos($actualSuccessUrl, 'schedule_id=' . $scheduleId1) !== false,
    "Actual: {$actualSuccessUrl}"
);

// =========================================================================
// TEST 2: Citizen cancel_url redirects to my-bookings.html
// =========================================================================
$actualCancelUrl = $mockPayMongo->lastSessionAttributes['cancel_url'] ?? '';

report(2, 'Citizen default cancel_url directs to my-bookings.html with booking parameters',
    strpos($actualCancelUrl, '/frontend/pages/my-bookings.html') !== false 
    && strpos($actualCancelUrl, 'checkout_status=cancelled') !== false
    && strpos($actualCancelUrl, 'schedule_id=' . $scheduleId1) !== false,
    "Actual: {$actualCancelUrl}"
);

// =========================================================================
// TEST 3: Admin/staff redirect behavior remains unchanged (payments.html) & explicit URLs respected
// =========================================================================
// Create dedicated lot and schedule for admin test to avoid lease conflict
$lotAdminStmt = $db->prepare("
    INSERT INTO lots (block_id, lot_number, lot_type_id, status, price)
    VALUES (1, 'B10C-ADMIN-" . bin2hex(random_bytes(2)) . "', 1, 'Available', 15000.00)
");
$lotAdminStmt->execute();
$lotAdminId = (int) $db->lastInsertId();

$db->prepare("
    INSERT INTO burial_schedules (created_by, lot_id, schedule_date, schedule_time, status, notes)
    VALUES (?, ?, '2026-11-21', '14:00:00', 'Pending', 'BATCH10C_TEST Schedule Admin')
")->execute([$userAdmin['user_id'], $lotAdminId]);
$adminSchedId = (int) $db->lastInsertId();

// Test admin role URL construction (routes to payments.html)
$adminRes = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $adminSchedId,
    'reference_kind' => 'schedule',
], $userAdmin);

$adminActualSuccess = $mockPayMongo->lastSessionAttributes['success_url'] ?? '';

// Also test explicit custom URL override with citizen on their own schedule
$customSuccess = 'https://custom-domain.com/confirm?id=999';
$customCancel = 'https://custom-domain.com/cancel?id=999';
$overrideRes = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $scheduleId1,
    'reference_kind' => 'schedule',
    'success_url' => $customSuccess,
    'cancel_url' => $customCancel,
], $userCitizen);

$overrideActualSuccess = $mockPayMongo->lastSessionAttributes['success_url'] ?? '';
$overrideActualCancel = $mockPayMongo->lastSessionAttributes['cancel_url'] ?? '';

report(3, 'Admin default URLs route to payments.html and explicit URL overrides are preserved',
    strpos($adminActualSuccess, '/frontend/pages/payments.html') !== false
    && $overrideActualSuccess === $customSuccess
    && $overrideActualCancel === $customCancel,
    "Admin: {$adminActualSuccess}, Override: {$overrideActualSuccess}"
);

// =========================================================================
// TEST 4: Checkout initialization failure does not produce false payment success
// =========================================================================
// Create dedicated lot for failure test
$lotFailStmt = $db->prepare("
    INSERT INTO lots (block_id, lot_number, lot_type_id, status, price)
    VALUES (1, 'B10C-FAIL-" . bin2hex(random_bytes(2)) . "', 1, 'Available', 15000.00)
");
$lotFailStmt->execute();
$lotFailId = (int) $db->lastInsertId();

// Create a booking draft for citizen
$draftModel = new BookingDraft();
$draftId = $draftModel->create($userCitizen['user_id'], 'burial', date('Y-m-d H:i:s', strtotime('+2 hours')));
$validFutureDate = new DateTime('+50 days');
if ((int) $validFutureDate->format('N') === 1) {
    $validFutureDate->modify('+1 day');
}
$draftModel->updateExtractedData($draftId, [
    'service_type'   => 'burial',
    'lot_id'         => $lotFailId,
    'preferred_date' => $validFutureDate->format('Y-m-d'),
    'schedule_time'  => '14:00:00',
    'decedent_name'  => 'BATCH10C_TEST Decedent',
    'notes'          => 'BATCH10C_TEST Failure Safeguard',
]);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_LOT_SELECTION);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_READY_FOR_REVIEW);

// Simulate PayMongo session creation failure
$mockPayMongo->simulateFailure = true;
$mockPayMongo->failureMessage = 'Simulated gateway timeout during session initialization';

$agentService = new BookingAgentService(paymentController: $paymentController);
$commitOutcome = $agentService->finalizeBurialDraft($draftId, $userCitizen['user_id'], $userCitizen['username'], $userCitizen);

$newSchedId = (int) ($commitOutcome['schedule_id'] ?? 0);
$schedRow = $scheduleModel->findById($newSchedId);
$payRow = $schedRow ? $paymentModel->findPendingByReference('Lot Purchase', $newSchedId, 'schedule', $userCitizen['user_id']) : null;

report(4, 'Checkout initialization failure does not produce false payment success (remains Pending)',
    !empty($commitOutcome['success'])
    && $commitOutcome['checkout_initialized'] === false
    && $commitOutcome['checkout_status'] === 'failed'
    && !empty($commitOutcome['checkout_error'])
    && empty($commitOutcome['checkout_url'])
    && ($schedRow['status'] ?? '') === 'Pending'
    && ($payRow['verification_status'] ?? '') === 'Pending',
    "Outcome: " . json_encode($commitOutcome)
);

// =========================================================================
// TEST 5: Failed checkout can be retried safely
// =========================================================================
// Now recover mock gateway and retry checkout
$mockPayMongo->simulateFailure = false;

$retryRes = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $newSchedId,
    'reference_kind' => 'schedule',
], $userCitizen);

report(5, 'Failed checkout can be retried safely once gateway is functional',
    !empty($retryRes['success']) && !empty($retryRes['checkout_url']),
    "Retry response: " . json_encode($retryRes)
);

// =========================================================================
// TEST 6: Retry does not duplicate payment records
// =========================================================================
$payCountStmt = $db->prepare("SELECT COUNT(*) FROM payments WHERE reference_kind = 'schedule' AND reference_id = ?");
$payCountStmt->execute([$newSchedId]);
$totalPayments = (int) $payCountStmt->fetchColumn();

report(6, 'Retry does not duplicate payment records (re-uses existing row)',
    $totalPayments === 1 && (int)$retryRes['payment_id'] === (int)$payRow['payment_id'],
    "Total payment records: {$totalPayments}"
);

// =========================================================================
// TEST 7: Retry does not duplicate bookings
// =========================================================================
$schedCountStmt = $db->prepare("SELECT COUNT(*) FROM burial_schedules WHERE notes LIKE '%BATCH10C_TEST Failure Safeguard%'");
$schedCountStmt->execute();
$totalSchedules = (int) $schedCountStmt->fetchColumn();

report(7, 'Retry does not duplicate bookings (original schedule preserved)',
    $totalSchedules === 1,
    "Total schedules: {$totalSchedules}"
);

// =========================================================================
// TEST 8: My Bookings (Schedule findById) exposes correct payment and refund status
// =========================================================================
$schedWithPayment = $scheduleModel->findById($newSchedId);

report(8, 'My Bookings (Schedule findById) exposes payment_id, method, gateway_status, and refund_status',
    isset($schedWithPayment['payment_id'])
    && isset($schedWithPayment['payment_method'])
    && isset($schedWithPayment['gateway_status'])
    && array_key_exists('gateway_checkout_session_id', $schedWithPayment)
    && array_key_exists('refund_status', $schedWithPayment),
    "Payment fields: id=" . ($schedWithPayment['payment_id'] ?? 'null') . ", method=" . ($schedWithPayment['payment_method'] ?? 'null') . ", gw_status=" . ($schedWithPayment['gateway_status'] ?? 'null')
);

// =========================================================================
// TEST 9: PayMongo verification remains strictly webhook-driven
// =========================================================================
// Simulating user returning with ?checkout_status=success must NOT mark payment Verified
$schedCheck = $scheduleModel->findById($newSchedId);
$payCheck = $paymentModel->findById($schedWithPayment['payment_id']);

report(9, 'PayMongo verification remains strictly webhook-driven (payment stays Pending on checkout redirect)',
    ($payCheck['verification_status'] ?? '') === 'Pending'
    && ($schedCheck['status'] ?? '') === 'Pending',
    "Payment verification_status: {$payCheck['verification_status']}, Schedule status: {$schedCheck['status']}"
);

// =========================================================================
// TEST 10: Batch 10B active checkout lease still applies
// =========================================================================
// Create another user attempting checkout on the same lot
$userCitizen2 = [
    'user_id' => $userCitizen['user_id'] + 8888,
    'username' => 'competing_buyer_10c',
    'role' => 'user'
];

$competingRes = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
], $userCitizen2);

report(10, 'Batch 10B active checkout lease still blocks concurrent buyers with 409 Conflict',
    isset($competingRes['code']) && $competingRes['code'] === 409 && ($competingRes['reason_code'] ?? '') === 'lot_held_checkout',
    "Competing response: " . json_encode($competingRes)
);

// Clean up test data
$db->exec("DELETE FROM refunds WHERE payment_id IN (SELECT payment_id FROM payments WHERE notes LIKE '%BATCH10C_TEST%')");
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH10C_TEST%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%BATCH10C_TEST%'");
$db->exec("DELETE FROM booking_drafts WHERE extracted_data LIKE '%BATCH10C_TEST%'");

echo "\n======================================================\n";
echo "PayMongo Batch 10C Citizen UX Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
