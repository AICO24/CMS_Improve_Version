<?php
/**
 * Test: PayMongo User Info Hooking (Adviser Recommendation Item #1)
 * 
 * Verifies that when a citizen or staff initiates a PayMongo checkout session:
 * 1. Payer's information (Name, Email, Phone, Address) is automatically hooked
 *    from their user profile or booking records.
 * 2. The official PayMongo `billing` structure is fully populated with these values.
 * 3. The `send_email_receipt` attribute is dynamically enabled when an email is present.
 * 4. The response payload returns `payer_info` confirming the automated hook.
 */

require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/User.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/services/PayMongoService.php';

$passed = 0;
$failed = 0;

function report(int $testNum, string $desc, bool $ok, string $detail = '') {
    global $passed, $failed;
    if ($ok) {
        $passed++;
        echo "[PASS] TEST {$testNum}: {$desc}\n";
    } else {
        $failed++;
        echo "[FAIL] TEST {$testNum}: {$desc}" . ($detail ? " — {$detail}" : '') . "\n";
    }
}

putenv("PAYMONGO_ENV=test");
$_ENV['PAYMONGO_ENV'] = 'test';
putenv("PAYMONGO_SECRET_KEY=sk_test_mock_hooking_key");
$_ENV['PAYMONGO_SECRET_KEY'] = 'sk_test_mock_hooking_key';

class MockPayMongoHookingService extends PayMongoService {
    public ?array $lastSessionAttributes = null;
    public ?string $lastIdempotencyKey = null;

    public function createCheckoutSession(array $attributes, $idempotencyKey = null) {
        $this->lastSessionAttributes = $attributes;
        $this->lastIdempotencyKey = $idempotencyKey;

        $csId = 'cs_hook_test_' . bin2hex(random_bytes(4));
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

$db = Database::getInstance()->getConnection();

// Create or update dedicated test user with complete profile
$testEmail = 'hooking_test_' . time() . '@cemetery.test';
$testName = 'Maria Santos Dela Cruz';
$testPhone = '09171234567';
$testAddress = '123 Sampaguita St, Brgy Lagao, General Santos City';

$userModel = new User();
$userCitizen = $db->query("SELECT user_id, username, full_name, email, contact_number, address FROM users WHERE role_id = (SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1) LIMIT 1")->fetch(PDO::FETCH_ASSOC);

if (!$userCitizen) {
    $roleId = $db->query("SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1")->fetchColumn() ?: 2;
    $db->prepare("INSERT INTO users (username, password_hash, full_name, email, contact_number, address, role_id, is_active) VALUES (?, 'x', ?, ?, ?, ?, ?, 1)")
       ->execute(['citizen_hook_test', $testName, $testEmail, $testPhone, $testAddress, $roleId]);
    $userId = (int) $db->lastInsertId();
    $userCitizen = ['user_id' => $userId, 'username' => 'citizen_hook_test', 'role' => 'user'];
} else {
    $userId = (int) $userCitizen['user_id'];
    $db->prepare("UPDATE users SET full_name = ?, email = ?, contact_number = ?, address = ? WHERE user_id = ?")
       ->execute([$testName, $testEmail, $testPhone, $testAddress, $userId]);
    $userCitizen['role'] = 'user';
}

// Find an available lot
$lot = $db->query("SELECT lot_id, price FROM lots WHERE status = 'Available' AND price > 0 LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$lot) {
    $db->exec("UPDATE lots SET status = 'Available' WHERE status = 'Reserved' LIMIT 1");
    $lot = $db->query("SELECT lot_id, price FROM lots WHERE status = 'Available' AND price > 0 LIMIT 1")->fetch(PDO::FETCH_ASSOC);
}
$lotId = (int) $lot['lot_id'];

// Clean up any existing test burial schedules and clear pending leases on this lot
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%HOOKING_TEST%'");
$db->prepare("UPDATE payments SET verification_status = 'Rejected', gateway_status = 'expired' WHERE transaction_type = 'Lot Purchase' AND verification_status = 'Pending' AND (reference_id = ? OR reference_id IN (SELECT schedule_id FROM burial_schedules WHERE lot_id = ?))")->execute([$lotId, $lotId]);

// Create test burial schedule
$db->prepare("
    INSERT INTO burial_schedules (created_by, lot_id, schedule_date, schedule_time, status, notes)
    VALUES (?, ?, '2026-12-15', '09:00:00', 'Pending', 'HOOKING_TEST Schedule')
")->execute([$userId, $lotId]);
$scheduleId = (int) $db->lastInsertId();

$mockGateway = new MockPayMongoHookingService();
$paymentController = new PaymentController();
$paymentController->setPayMongoService($mockGateway);

// Test 1: createCheckoutSession automatically hooks user profile into billing
$res = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $scheduleId,
    'reference_kind' => 'schedule',
], $userCitizen);

$isSuccess = !empty($res['success']) && !empty($res['checkout_url']);
report(1, 'Checkout session creation succeeds with mock gateway', $isSuccess, json_encode($res));

$capturedAttrs = $mockGateway->lastSessionAttributes;
$billing = $capturedAttrs['billing'] ?? [];

report(2, 'PayMongo sessionAttributes contains billing structure', !empty($billing), json_encode($capturedAttrs));

report(3, 'Billing name is automatically hooked from user full_name', ($billing['name'] ?? '') === $testName, 'Actual: ' . ($billing['name'] ?? 'none'));

report(4, 'Billing email is automatically hooked from user email', ($billing['email'] ?? '') === $testEmail, 'Actual: ' . ($billing['email'] ?? 'none'));

report(5, 'Billing phone is properly formatted with Philippine country code (+63)', ($billing['phone'] ?? '') === '+639171234567', 'Actual: ' . ($billing['phone'] ?? 'none'));

report(6, 'Billing address is properly structured with line1 and country=PH', 
    ($billing['address']['line1'] ?? '') === $testAddress && ($billing['address']['country'] ?? '') === 'PH',
    json_encode($billing['address'] ?? [])
);

report(7, 'send_email_receipt is enabled when a valid customer email is hooked', ($capturedAttrs['send_email_receipt'] ?? false) === true);

report(8, 'API response returns payer_info with hooked details', 
    isset($res['payer_info']) && ($res['payer_info']['name'] ?? '') === $testName,
    json_encode($res['payer_info'] ?? [])
);

echo "\n======================================================\n";
echo "PayMongo User Info Hooking Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

exit($failed > 0 ? 1 : 0);
