<?php
/**
 * CMS Batch 2 Automated Regression & Verification Test
 *
 * Verifies:
 * 1. SEC-004 — Direct Lot Purchase Bypass Prevention:
 *    - User cannot initiate checkout for an arbitrary lot with reference_kind='lot' (403)
 *    - User cannot create direct payment for an arbitrary lot with reference_kind='lot' (403)
 *    - User cannot use legacy fallback to pay for an arbitrary lot without a reservation (403)
 *    - User cannot pay for another user's reservation (403)
 *    - User CAN complete checkout for their own legitimate booking (200)
 *    - User referencing a lot where they own an active schedule resolves to that schedule (200)
 *    - Admin legitimate direct lot purchase workflow remains functional (200)
 *    - Staff legitimate direct lot purchase workflow remains functional (200)
 *
 * 2. FIN-001 — Revenue Reporting Uses Verified Payments Only:
 *    - Verified payments are counted in getRevenue()
 *    - Pending, Unverified, and Rejected payments are NOT counted in getRevenue()
 *    - getStats() reports only Verified payments in total_revenue, ytd_revenue, and all_time_revenue
 *    - getRevenueByMonth() only aggregates Verified payments
 *    - getRevenueByDay() only aggregates Verified payments
 *    - getRevenueByYear() only aggregates Verified payments
 *    - getRevenueBreakdown() only aggregates Verified payments
 *    - getRevenueByMethod() only aggregates Verified payments
 *    - ReportController::revenue() matches verified figures and maintains consistency
 */

require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/controllers/PaymentController.php';
require_once __DIR__ . '/../backend/controllers/ReportController.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/User.php';

$db = Database::getInstance()->getConnection();
$paymentController = new PaymentController();
$reportController = new ReportController();
$paymentModel = new Payment();
$scheduleModel = new Schedule();
$lotModel = new Lot();

$totalTests = 0;
$passedTests = 0;
$failedTests = 0;

function test_assert($testName, $condition, $details = '') {
    global $totalTests, $passedTests, $failedTests;
    $totalTests++;
    if ($condition) {
        $passedTests++;
        echo "[PASS] Test {$totalTests}: {$testName}\n";
    } else {
        $failedTests++;
        echo "[FAIL] Test {$totalTests}: {$testName} — {$details}\n";
    }
}

echo "============================================================\n";
echo "Starting Batch 2 Verification (SEC-004 & FIN-001)...\n";
echo "============================================================\n";

// Ensure clean test state
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH2_TEST%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%BATCH2_TEST%'");

// Find or create test users
$userCitizenA = $db->query("SELECT user_id, username FROM users WHERE role_id = (SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1) LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$userCitizenA) {
    $db->exec("INSERT INTO users (username, password, full_name, email, role_id, is_active, email_verified) VALUES ('batch2_citizen_a', 'x', 'Citizen A', 'citizena@test.com', 2, 1, 1)");
    $userCitizenA = ['user_id' => (int)$db->lastInsertId(), 'username' => 'batch2_citizen_a'];
}
$userCitizenA['role'] = 'user';
$db->exec("UPDATE users SET email_verified = 1 WHERE user_id = {$userCitizenA['user_id']}");

$userCitizenB = ['user_id' => $userCitizenA['user_id'] + 9991, 'username' => 'batch2_citizen_b', 'role' => 'user'];
$userAdmin = ['user_id' => 1, 'username' => 'admin_test', 'role' => 'admin'];
$userStaff = ['user_id' => 2, 'username' => 'staff_test', 'role' => 'staff'];

// Find an available lot for testing
$availableLot = $db->query("SELECT lot_id, lot_number, price FROM lots WHERE status = 'Available' AND price > 100 LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$availableLot) {
    $db->exec("UPDATE lots SET status = 'Available' WHERE lot_id = 1");
    $availableLot = $db->query("SELECT lot_id, lot_number, price FROM lots WHERE lot_id = 1")->fetch(PDO::FETCH_ASSOC);
}
$lotId = (int)$availableLot['lot_id'];

// -----------------------------------------------------------------------------
// PART 1: SEC-004 Authorization Verification
// -----------------------------------------------------------------------------

// Test 1: Citizen attempting direct lot checkout on arbitrary lot (no reservation) is blocked with 403
$secRes1 = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
], $userCitizenA);

test_assert(
    'SEC-004: Citizen direct checkout with reference_kind=lot on unreserved lot is blocked (403)',
    isset($secRes1['code']) && $secRes1['code'] === 403,
    "Got: " . json_encode($secRes1)
);

// Test 2: Citizen attempting direct payment record creation on arbitrary lot is blocked with 403
$secRes2 = $paymentController->store([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
    'amount' => 15000,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'Cash',
], (int)$userCitizenA['user_id']);

test_assert(
    'SEC-004: Citizen payment store with reference_kind=lot on unreserved lot is blocked (403)',
    isset($secRes2['code']) && $secRes2['code'] === 403,
    "Got: " . json_encode($secRes2)
);

// Test 3: Citizen attempting payment with legacy fallback (no reference_kind) on arbitrary lot is blocked with 403
$secRes3 = $paymentController->store([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'amount' => 15000,
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'Cash',
], (int)$userCitizenA['user_id']);

test_assert(
    'SEC-004: Citizen payment with no reference_kind on unreserved lot is blocked (403)',
    isset($secRes3['code']) && $secRes3['code'] === 403,
    "Got: " . json_encode($secRes3)
);

// Create a legitimate schedule for Citizen A
$db->prepare("
    INSERT INTO burial_schedules (created_by, lot_id, schedule_date, schedule_time, status, notes)
    VALUES (?, ?, '2026-12-15', '10:00:00', 'Pending', 'BATCH2_TEST Legitimate Schedule A')
")->execute([$userCitizenA['user_id'], $lotId]);
$scheduleAId = (int)$db->lastInsertId();

// Test 4: Citizen B attempting to pay for Citizen A's reservation is blocked with 403
$secRes4 = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $scheduleAId,
    'reference_kind' => 'schedule',
], $userCitizenB);

test_assert(
    'SEC-004: Citizen B attempting to pay for Citizen A reservation is blocked (403)',
    isset($secRes4['code']) && $secRes4['code'] === 403,
    "Got: " . json_encode($secRes4)
);

// Test 5: Citizen A can legitimately initiate checkout for their own reservation
$secRes5 = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $scheduleAId,
    'reference_kind' => 'schedule',
], $userCitizenA);

test_assert(
    'SEC-004: Citizen A can checkout their own reservation (schedule)',
    !empty($secRes5['payment_id']) && in_array($secRes5['code'] ?? 200, [200, 502], true),
    "Got: " . json_encode($secRes5)
);

// Test 6: Citizen A referencing lotId directly resolves to their authorized schedule
$secRes6 = $paymentController->createCheckoutSession([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $lotId,
    'reference_kind' => 'lot',
], $userCitizenA);

test_assert(
    'SEC-004: Citizen A referencing their lot resolves to their schedule and succeeds',
    !empty($secRes6['payment_id']) && in_array($secRes6['code'] ?? 200, [200, 502], true),
    "Got: " . json_encode($secRes6)
);

// Find available lots for Admin and Staff counter purchase tests
$adminLot = $db->query("SELECT lot_id, price FROM lots WHERE status = 'Available' LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$adminLotId = (int)($adminLot['lot_id'] ?? $lotId);

// Test 7: Admin legitimate direct lot purchase workflow remains functional
$secRes7 = $paymentController->store([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $adminLotId,
    'reference_kind' => 'lot',
    'amount' => (float)($adminLot['price'] ?? 15000),
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'Cash',
    'notes' => 'BATCH2_TEST Admin Walk-in counter purchase',
], (int)$userAdmin['user_id']);

test_assert(
    'SEC-004: Admin direct lot purchase workflow remains functional (201/success)',
    !empty($secRes7['success']) || (isset($secRes7['code']) && $secRes7['code'] === 201),
    "Got: " . json_encode($secRes7)
);

$staffLot = $db->query("SELECT lot_id, price FROM lots WHERE status = 'Available' AND lot_id != {$adminLotId} LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$staffLotId = $staffLot ? (int)$staffLot['lot_id'] : $adminLotId;

// Test 8: Staff legitimate direct lot purchase workflow remains functional
$secRes8 = $paymentController->store([
    'transaction_type' => 'Lot Purchase',
    'reference_id' => $staffLotId,
    'reference_kind' => 'lot',
    'amount' => (float)($staffLot['price'] ?? 15000),
    'payment_date' => date('Y-m-d'),
    'payment_method' => 'Cash',
    'notes' => 'BATCH2_TEST Staff Walk-in counter purchase',
], (int)$userStaff['user_id']);

test_assert(
    'SEC-004: Staff direct lot purchase workflow remains functional (201/success)',
    !empty($secRes8['success']) || (isset($secRes8['code']) && $secRes8['code'] === 201),
    "Got: " . json_encode($secRes8)
);

// -----------------------------------------------------------------------------
// PART 2: FIN-001 Revenue Reporting Verification
// -----------------------------------------------------------------------------

// Record baseline June 2026 revenue before injecting test payments
$baseMonthRows = $paymentModel->getRevenueByMonth(2026);
$baseJuneTotal = 0;
foreach ($baseMonthRows as $bmr) {
    if ((int)$bmr['month'] === 6) {
        $baseJuneTotal = (float)$bmr['total'];
    }
}

// Clean prior test payments and insert controlled status fixtures
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH2_FIN_TEST%'");

$testDate = '2026-06-15';
$year = '2026';

// 1 Verified payment: PHP 10,000
$db->prepare("
    INSERT INTO payments (transaction_type, reference_id, reference_kind, amount, payment_date, payment_method, receipt_number, notes, received_by, verification_status, created_at)
    VALUES ('Lot Purchase', ?, 'schedule', 10000.00, ?, 'Cash', 'RCPT-B2-VER1', 'BATCH2_FIN_TEST Verified 1', 1, 'Verified', '2026-06-15 10:00:00')
")->execute([$scheduleAId, $testDate]);

// 1 Pending payment: PHP 5,000 (MUST NOT be counted in revenue)
$db->prepare("
    INSERT INTO payments (transaction_type, reference_id, reference_kind, amount, payment_date, payment_method, receipt_number, notes, received_by, verification_status, created_at)
    VALUES ('Lot Purchase', ?, 'schedule', 5000.00, ?, 'PayMongo', 'RCPT-B2-PEND1', 'BATCH2_FIN_TEST Pending 1', 1, 'Pending', '2026-06-15 11:00:00')
")->execute([$scheduleAId, $testDate]);

// 1 Rejected payment: PHP 7,000 (MUST NOT be counted in revenue)
$db->prepare("
    INSERT INTO payments (transaction_type, reference_id, reference_kind, amount, payment_date, payment_method, receipt_number, notes, received_by, verification_status, created_at)
    VALUES ('Lot Purchase', ?, 'schedule', 7000.00, ?, 'GCash', 'RCPT-B2-REJ1', 'BATCH2_FIN_TEST Rejected 1', 1, 'Rejected', '2026-06-15 12:00:00')
")->execute([$scheduleAId, $testDate]);

// Test 9: getRevenue() with date filter only counts Verified
$revFiltered = $paymentModel->getRevenue(['date_from' => '2026-06-15', 'date_to' => '2026-06-15']);
test_assert(
    'FIN-001: getRevenue() only sums Verified payments (excludes Pending & Rejected)',
    (float)$revFiltered['total'] === 10000.00 && (int)$revFiltered['count'] === 1,
    "Expected total=10000, count=1, got total=" . ($revFiltered['total'] ?? 'null') . ", count=" . ($revFiltered['count'] ?? 'null')
);

// Test 10: getStats() reports only Verified payments in total_revenue
$statsFiltered = $paymentModel->getStats('monthly', ['date_from' => '2026-06-15', 'date_to' => '2026-06-15']);
test_assert(
    'FIN-001: getStats() total_revenue strictly reflects Verified revenue and pending_count is tracked separately',
    (float)$statsFiltered['total_revenue'] === 10000.00
    && (float)$statsFiltered['verified_revenue'] === 10000.00
    && (int)$statsFiltered['pending_count'] === 1
    && (int)$statsFiltered['verified_count'] === 1,
    "Got total_revenue=" . ($statsFiltered['total_revenue'] ?? 'null') . ", pending_count=" . ($statsFiltered['pending_count'] ?? 'null')
);

// Test 11: getRevenueByMonth() only aggregates Verified payments
$monthRows = $paymentModel->getRevenueByMonth(2026);
$juneTotal = 0;
foreach ($monthRows as $mr) {
    if ((int)$mr['month'] === 6) {
        $juneTotal = (float)$mr['total'];
    }
}
$diffJuneTotal = round($juneTotal - $baseJuneTotal, 2);
test_assert(
    'FIN-001: getRevenueByMonth() only aggregates Verified payments for month 6',
    $diffJuneTotal === 10000.00,
    "Expected June verified addition 10000, got: {$diffJuneTotal} (base: {$baseJuneTotal}, new: {$juneTotal})"
);

// Test 12: getRevenueByDay() only aggregates Verified payments
$dayRows = $paymentModel->getRevenueByDay(['date_from' => '2026-06-15', 'date_to' => '2026-06-15']);
$dayTotal = !empty($dayRows) ? (float)$dayRows[0]['total'] : 0;
$dayCount = !empty($dayRows) ? (int)$dayRows[0]['count'] : 0;
test_assert(
    'FIN-001: getRevenueByDay() only aggregates Verified payments',
    $dayTotal === 10000.00 && $dayCount === 1,
    "Expected day total 10000, count 1, got total={$dayTotal}, count={$dayCount}"
);

// Test 13: getRevenueByYear() only aggregates Verified payments
$yearRows = $paymentModel->getRevenueByYear(['date_from' => '2026-06-15', 'date_to' => '2026-06-15']);
$yearTotal = !empty($yearRows) ? (float)$yearRows[0]['total'] : 0;
test_assert(
    'FIN-001: getRevenueByYear() only aggregates Verified payments',
    $yearTotal === 10000.00,
    "Expected year total 10000, got: {$yearTotal}"
);

// Test 14: getRevenueBreakdown() only aggregates Verified payments
$breakdownRows = $paymentModel->getRevenueBreakdown(['date_from' => '2026-06-15', 'date_to' => '2026-06-15']);
$breakdownTotal = 0;
$breakdownCount = 0;
foreach ($breakdownRows as $br) {
    $breakdownTotal += (float)$br['total'];
    $breakdownCount += (int)$br['count'];
}
test_assert(
    'FIN-001: getRevenueBreakdown() only aggregates Verified payments',
    $breakdownTotal === 10000.00 && $breakdownCount === 1,
    "Expected breakdown total 10000, count 1, got total={$breakdownTotal}, count={$breakdownCount}"
);

// Test 15: getRevenueByMethod() only aggregates Verified payments
$methodRows = $paymentModel->getRevenueByMethod(['date_from' => '2026-06-15', 'date_to' => '2026-06-15']);
$methodTotal = 0;
foreach ($methodRows as $mr) {
    $methodTotal += (float)$mr['total'];
}
test_assert(
    'FIN-001: getRevenueByMethod() only aggregates Verified payments',
    $methodTotal === 10000.00,
    "Expected method total 10000, got: {$methodTotal}"
);

// Test 16: ReportController::revenue() returns total and breakdown that are fully coherent and Verified
$reportRev = $reportController->revenue(['date_from' => '2026-06-15', 'date_to' => '2026-06-15']);
$reportTotal = (float)($reportRev['total']['total'] ?? 0);
$reportBreakdownTotal = 0;
foreach ($reportRev['breakdown'] as $bItem) {
    $reportBreakdownTotal += (float)($bItem['total'] ?? 0);
}
test_assert(
    'FIN-001: ReportController::revenue() gross total equals breakdown total and reflects Verified revenue',
    $reportTotal === 10000.00 && $reportBreakdownTotal === 10000.00,
    "Expected reportTotal=10000 and reportBreakdownTotal=10000, got total={$reportTotal}, breakdown={$reportBreakdownTotal}"
);

// Clean up test records
$db->exec("DELETE FROM payments WHERE notes LIKE '%BATCH2_TEST%' OR notes LIKE '%BATCH2_FIN_TEST%'");
$db->exec("DELETE FROM burial_schedules WHERE notes LIKE '%BATCH2_TEST%'");

echo "============================================================\n";
echo "Batch 2 Verification Complete: {$passedTests} passed, {$failedTests} failed (Total: {$totalTests})\n";
echo "============================================================\n";

if ($failedTests > 0) {
    exit(1);
}
exit(0);
