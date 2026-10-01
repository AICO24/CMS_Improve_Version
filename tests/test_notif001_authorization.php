<?php
/**
 * Test Suite: NOTIF-001 Notification Deletion Authorization
 * 
 * Verifies:
 * 1. User A can delete own notification (200 OK)
 * 2. User A CANNOT delete User B's notification (403 Forbidden)
 * 3. Deleting non-existent notification returns 404
 * 4. Admin can delete any notification (200 OK)
 * 5. Staff can delete any notification (200 OK)
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/Database.php';
require_once __DIR__ . '/../backend/models/Notification.php';
require_once __DIR__ . '/../backend/controllers/NotificationController.php';

echo "======================================================\n";
echo "RUNNING NOTIF-001 NOTIFICATION AUTHORIZATION TESTS\n";
echo "======================================================\n";

$db = Database::getInstance()->getConnection();
$notifModel = new Notification();
$controller = new NotificationController();

$passed = 0;
$failed = 0;

function assertTest($description, $condition, $details = '') {
    global $passed, $failed;
    if ($condition) {
        echo "  [PASS] {$description}\n";
        $passed++;
    } else {
        echo "  [FAIL] {$description} " . ($details ? "({$details})" : "") . "\n";
        $failed++;
    }
}

// Fetch two distinct test users to test cross-user isolation
$realUsers = $db->query("SELECT user_id, username, role_id FROM users WHERE role_id = 3 ORDER BY user_id ASC LIMIT 2")->fetchAll(PDO::FETCH_ASSOC);
if (count($realUsers) < 2) {
    // If not enough citizen users, fetch any two users
    $realUsers = $db->query("SELECT user_id, username, role_id FROM users ORDER BY user_id ASC LIMIT 2")->fetchAll(PDO::FETCH_ASSOC);
}
$userA = ['user_id' => (int) $realUsers[0]['user_id'], 'role' => 'user', 'username' => $realUsers[0]['username']];
$userB = ['user_id' => (int) $realUsers[1]['user_id'], 'role' => 'user', 'username' => $realUsers[1]['username']];
$adminUser = ['user_id' => 1, 'role' => 'admin', 'username' => 'admin'];
$staffUser = ['user_id' => 2, 'role' => 'staff', 'username' => 'staff'];

// Insert test notification for User A
$stmt = $db->prepare("INSERT INTO notifications (user_id, title, message, is_read, created_at) VALUES (?, ?, ?, 0, NOW())");
$stmt->execute([$userA['user_id'], 'User A Notification', 'Test message A']);
$notifAId = (int) $db->lastInsertId();

// Insert test notification for User B
$stmt->execute([$userB['user_id'], 'User B Notification', 'Test message B']);
$notifBId = (int) $db->lastInsertId();

// Insert test notification for Admin delete test
$stmt->execute([$userA['user_id'], 'User A Notification 2', 'Test message A2']);
$notifA2Id = (int) $db->lastInsertId();

// Test 1: User A attempts to delete User B's notification (should fail with 403)
$resB_by_A = $controller->destroy($notifBId, $userA);
assertTest(
    "User A cannot delete User B's notification (expected 403)",
    isset($resB_by_A['code']) && $resB_by_A['code'] === 403,
    "Got: " . json_encode($resB_by_A)
);

// Test 2: User A deletes own notification (should succeed with 200/success)
$resA_by_A = $controller->destroy($notifAId, $userA);
assertTest(
    "User A can delete own notification (expected success)",
    ($resA_by_A['success'] ?? false) === true && !isset($resA_by_A['code']),
    "Got: " . json_encode($resA_by_A)
);

// Verify notifA is actually deleted
$checkA = $notifModel->findById($notifAId);
assertTest(
    "User A notification was actually deleted from database",
    $checkA === false || $checkA === null
);

// Test 3: Deleting already deleted or non-existent notification returns 404
$resNotFound = $controller->destroy(99999999, $userA);
assertTest(
    "Deleting non-existent notification returns 404",
    isset($resNotFound['code']) && $resNotFound['code'] === 404,
    "Got: " . json_encode($resNotFound)
);

// Test 4: Admin can delete User A's notification
$resA2_by_Admin = $controller->destroy($notifA2Id, $adminUser);
assertTest(
    "Admin can delete any notification (expected success)",
    ($resA2_by_Admin['success'] ?? false) === true && !isset($resA2_by_Admin['code']),
    "Got: " . json_encode($resA2_by_Admin)
);

// Test 5: Staff can delete User B's notification
$resB_by_Staff = $controller->destroy($notifBId, $staffUser);
assertTest(
    "Staff can delete any notification (expected success)",
    ($resB_by_Staff['success'] ?? false) === true && !isset($resB_by_Staff['code']),
    "Got: " . json_encode($resB_by_Staff)
);

// Clean up any remaining test rows
$db->exec("DELETE FROM notifications WHERE notification_id IN ({$notifAId}, {$notifBId}, {$notifA2Id})");

echo "======================================================\n";
echo "NOTIF-001 RESULTS: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

exit($failed > 0 ? 1 : 0);
