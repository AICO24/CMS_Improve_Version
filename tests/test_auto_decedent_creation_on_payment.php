<?php
/**
 * Test: Automatic Decedent Record Creation on Payment Verification
 * Validates that paying for a provisional reservation immediately creates
 * a decedent_records row with document_status = 'pending_requirements',
 * links deceased_id on the schedule, and allows staff verification.
 */

require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/controllers/ScheduleController.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';
require_once __DIR__ . '/../backend/controllers/DecedentController.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/Decedent.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/User.php';

$db = Database::getInstance()->getConnection();

echo "Starting Auto Decedent Creation on Payment Test...\n";

// 1. Get or create a test user (citizen)
$userModel = new User();
$testUser = $userModel->findByUsername('test_citizen_auto');
if (!$testUser) {
    $userId = $userModel->create([
        'username' => 'test_citizen_auto',
        'password' => 'TestPass123!',
        'email' => 'citizen_auto@example.com',
        'full_name' => 'Auto Citizen',
        'role_id' => 3, // user
        'contact_number' => '09171234567',
    ]);
    $testUser = $userModel->findById($userId);
}
$citizen = ['user_id' => $testUser['user_id'], 'role' => 'user', 'username' => $testUser['username']];

// 2. Find an available lot
$lotModel = new Lot();
$availableLots = $lotModel->findAll(['status' => 'Available']);
if (empty($availableLots)) {
    // Reset one lot to Available for test
    $lotId = $db->query("SELECT lot_id FROM lots LIMIT 1")->fetchColumn();
    $lotModel->transitionStatus($lotId, 'Available', ['Reserved', 'Occupied', 'Expired', 'Available']);
} else {
    $lotId = $availableLots[0]['lot_id'];
}

// 3. Create a provisional booking as citizen
$scheduleController = new ScheduleController();
$futureDate = date('Y-m-d', strtotime('+10 days'));
// Avoid Monday
if (date('N', strtotime($futureDate)) === 1) {
    $futureDate = date('Y-m-d', strtotime('+11 days'));
}

$bookingData = [
    'lot_id' => $lotId,
    'schedule_date' => $futureDate,
    'schedule_time' => '10:00:00',
    'provisional_decedent' => [
        'full_name' => 'Dela Cruz, Juanito M. Jr.',
        'approximate_dod' => date('Y-m-d', strtotime('-2 days')),
        'relationship' => 'Grandson',
        'notes' => 'Death certificate to follow',
    ],
];

$bookingRes = $scheduleController->store($bookingData, $citizen);
if (empty($bookingRes['success'])) {
    echo "FAILED: Could not create provisional booking: " . json_encode($bookingRes) . "\n";
    exit(1);
}

$scheduleId = $bookingRes['schedule_id'];
$decedentRequestId = $bookingRes['decedent_request_id'];
echo "[PASS] Created provisional booking #$scheduleId (Request #$decedentRequestId)\n";

$scheduleModel = new Schedule();
$scheduleBefore = $scheduleModel->findById($scheduleId);
assert(empty($scheduleBefore['deceased_id']), 'Schedule should not have deceased_id initially');
assert($scheduleBefore['status'] === 'Pending', 'Schedule should be Pending');

// 4. Create a payment referencing this schedule
$paymentModel = new Payment();
$receiptNum = 'REC-AUTO-' . time() . '-' . rand(100, 999);
$paymentId = $paymentModel->create([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $scheduleId,
    'reference_kind' => 'schedule',
    'amount' => 15000.00,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'Cash',
    'receipt_number' => $receiptNum,
    'received_by' => $citizen['user_id'],
    'verification_status' => 'Pending',
]);
echo "[PASS] Created pending payment #$paymentId ($receiptNum)\n";

// 5. Admin verifies the payment
$paymentController = new PaymentController();
$adminUser = ['user_id' => 1, 'role' => 'admin', 'username' => 'admin'];
$verifyRes = $paymentController->verify($paymentId, 'Verified', $adminUser['user_id']);
if (empty($verifyRes['success'])) {
    echo "FAILED: Payment verification failed: " . json_encode($verifyRes) . "\n";
    exit(1);
}
echo "[PASS] Payment verified by admin\n";

// 6. Assert schedule is now confirmed and lot is reserved
$scheduleAfter = $scheduleModel->findById($scheduleId);
assert($scheduleAfter['status'] === 'Confirmed', 'Schedule should be Confirmed after payment verification');
$lotAfter = $lotModel->findById($lotId);
assert($lotAfter['status'] === 'Reserved', 'Lot should be Reserved after payment verification');
echo "[PASS] Schedule confirmed and Lot reserved\n";

// 7. CRITICAL CHECK: Assert that deceased_id is now populated and decedent record exists!
$newDeceasedId = $scheduleAfter['deceased_id'];
if (empty($newDeceasedId)) {
    echo "FAILED: deceased_id on schedule was NOT automatically linked!\n";
    exit(1);
}
echo "[PASS] Schedule is linked to auto-created deceased_id: #$newDeceasedId\n";

$decedentModel = new Decedent();
$decedent = $decedentModel->findById($newDeceasedId);
if (!$decedent) {
    echo "FAILED: Decedent record #$newDeceasedId was not found in decedent_records!\n";
    exit(1);
}

assert($decedent['document_status'] === 'pending_requirements', 'Document status should be pending_requirements');
assert($decedent['first_name'] === 'Juanito', 'First name should be parsed as Juanito, got: ' . $decedent['first_name']);
assert($decedent['last_name'] === 'Dela Cruz', 'Last name should be parsed as Dela Cruz, got: ' . $decedent['last_name']);
assert($decedent['suffix'] === 'Jr.', 'Suffix should be Jr., got: ' . $decedent['suffix']);
assert($decedent['dob'] === null, 'DOB should be null (to follow)');
echo "[PASS] Auto-created decedent record has document_status = 'pending_requirements' and parsed name\n";

// 8. Test citizen ownership and retrieval via My Records
assert($decedentModel->isOwnedBy($newDeceasedId, $citizen['user_id']), 'Citizen must own the newly created decedent record');
$citizenDecedents = $decedentModel->findAll(['owner_id' => $citizen['user_id']]);
$foundInMyRecords = false;
foreach ($citizenDecedents as $d) {
    if ((int) $d['decedent_id'] === (int) $newDeceasedId) {
        $foundInMyRecords = true;
        break;
    }
}
assert($foundInMyRecords, 'Citizen must find the decedent in their My Records query immediately');
echo "[PASS] Decedent is immediately visible to Citizen in My Records!\n";

// 9. Test Completion Guard: Marking schedule Completed without verified requirements must be blocked
$updateRes = $scheduleController->update($scheduleId, ['status' => 'Completed'], $adminUser);
assert(!empty($updateRes['requirements_pending']), 'Schedule completion should be blocked due to pending requirements');
echo "[PASS] Completion guard blocked unverified burial schedule as expected\n";

// 10. Staff verifies the requirements
$decedentController = new DecedentController();
$verifyReqRes = $decedentController->verifyRequirements($newDeceasedId, [
    'dob' => '1952-04-15',
    'cause_of_death' => 'Cardiopulmonary Arrest',
], $adminUser);

if (empty($verifyReqRes['success'])) {
    echo "FAILED: Requirements verification failed: " . json_encode($verifyReqRes) . "\n";
    exit(1);
}

$decedentVerified = $decedentModel->findById($newDeceasedId);
assert($decedentVerified['document_status'] === 'verified', 'Document status should now be verified');
assert($decedentVerified['dob'] === '1952-04-15', 'DOB should be updated');
echo "[PASS] Staff successfully verified requirements -> status is now 'verified'\n";

// 11. Now Schedule can be completed
$completeRes = $scheduleController->update($scheduleId, ['status' => 'Completed'], $adminUser);
assert(!empty($completeRes['success']), 'Schedule should now successfully complete after verification');
echo "[PASS] Schedule completed successfully after requirements verified!\n";

echo "\nALL AUTO DECEDENT CREATION TESTS PASSED SUCCESSFULLY!\n";
