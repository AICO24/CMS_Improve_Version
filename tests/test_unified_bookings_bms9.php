<?php
/**
 * Test Suite: BMS-9 Draft Resumption + Unified Booking History
 * 
 * Verifies:
 * 1. v_unified_bookings database view exists and has all expected columns
 * 2. UnifiedBooking domain model findMine, countMine, getStats
 * 3. Active drafts appear with is_draft = 1, draft_id, and source_kind = 'DRAFT'
 * 4. Inactive/committed/cancelled/expired drafts are excluded from draft rows
 * 5. Strict ownership scoping (User A cannot see User B's records)
 * 6. Query filters work (service_type, source_kind, status, search query q)
 * 7. Resumption API (getDraft) returns draft for owner with authoritative state
 * 8. Resumption API rejects non-owner with 403/404
 * 9. Resumption API rejects expired draft with 410
 * 10. Controller getUnifiedBookings returns formatted payload with stats and pagination
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/UnifiedBooking.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';

echo "==============================================================\n";
echo "RUNNING BMS-9 DRAFT RESUMPTION & UNIFIED BOOKINGS TEST SUITE\n";
echo "==============================================================\n";

$db = Database::getInstance()->getConnection();

// Create dedicated isolated test users to ensure completely clean counts
$db->exec("DELETE FROM users WHERE username IN ('bms9_test_user_a', 'bms9_test_user_b')");
$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('bms9_test_user_a', 'hash', 'BMS9 Test User A', 'bms9_a@example.com', 3)
")->execute();
$userAId = (int) $db->lastInsertId();

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('bms9_test_user_b', 'hash', 'BMS9 Test User B', 'bms9_b@example.com', 3)
")->execute();
$userBId = (int) $db->lastInsertId();

$userA = ['user_id' => $userAId, 'username' => 'bms9_test_user_a', 'role' => 'user'];
$userB = ['user_id' => $userBId, 'username' => 'bms9_test_user_b', 'role' => 'user'];

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

// Cleanup existing test data for these users
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");
$db->exec("DELETE FROM burial_schedules WHERE created_by IN ({$userA['user_id']}, {$userB['user_id']})");
$db->exec("DELETE FROM cremation_records WHERE created_by IN ({$userA['user_id']}, {$userB['user_id']})");

$draftModel = new BookingDraft();
$unifiedModel = new UnifiedBooking();
$controller = new BookingAgentController();

// ----------------------------------------------------------------------
// TEST 1: v_unified_bookings view exists and has correct columns
// ----------------------------------------------------------------------
$colsStmt = $db->query("DESCRIBE v_unified_bookings");
$cols = $colsStmt->fetchAll(PDO::FETCH_COLUMN);

$expectedCols = [
    'source_kind', 'source_id', 'user_id', 'service_type', 'booking_reference',
    'decedent_name', 'booking_date', 'allocation', 'status', 'is_draft',
    'draft_id', 'created_at', 'updated_at'
];

$missingCols = array_diff($expectedCols, $cols);
report(1, "Database view v_unified_bookings exists with required columns", empty($missingCols), empty($missingCols) ? '' : 'Missing: ' . implode(', ', $missingCols));

// ----------------------------------------------------------------------
// Setup sample data:
// User A:
//   1 burial schedule
//   1 cremation record
//   1 active draft (COLLECTING)
//   1 committed draft
//   1 cancelled draft
//   1 expired draft
// User B:
//   1 burial schedule
//   1 active draft
// ----------------------------------------------------------------------

// 1. Burial schedule for User A
$sampleLot = $db->query("SELECT lot_id FROM lots LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$lotId = $sampleLot ? (int)$sampleLot['lot_id'] : 1;

$db->prepare("
    INSERT INTO burial_schedules (created_by, lot_id, schedule_date, status, notes)
    VALUES (?, ?, '2026-10-15 10:00:00', 'Confirmed', 'BMS-9 Test Burial for User A')
")->execute([$userA['user_id'], $lotId]);
$burialIdA = (int) $db->lastInsertId();

// 2. Cremation record for User A
$db->prepare("
    INSERT INTO cremation_records (created_by, cremation_date, columbarium, status, notes)
    VALUES (?, '2026-10-20 14:00:00', 'St. Jude Columbarium', 'Pending', 'BMS-9 Test Cremation for User A')
")->execute([$userA['user_id']]);
$cremationIdA = (int) $db->lastInsertId();

function insertTestDraft(PDO $db, array $data): int {
    $stmt = $db->prepare("
        INSERT INTO booking_drafts (
            user_id, service_type, status, extracted_data, missing_fields,
            committed_record_id, committed_record_type, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ");
    $stmt->execute([
        $data['user_id'],
        $data['service_type'],
        $data['status'] ?? 'COLLECTING_INFO',
        isset($data['extracted_data']) ? json_encode($data['extracted_data']) : '{}',
        isset($data['missing_fields']) ? json_encode($data['missing_fields']) : '[]',
        $data['committed_record_id'] ?? null,
        $data['committed_record_type'] ?? null,
        $data['expires_at'] ?? date('Y-m-d H:i:s', time() + 86400)
    ]);
    return (int) $db->lastInsertId();
}

// 3. Active draft for User A
$activeDraftAId = insertTestDraft($db, [
    'user_id' => $userA['user_id'],
    'service_type' => 'burial',
    'status' => BookingDraft::STATUS_COLLECTING_INFO,
    'extracted_data' => [
        'decedent_name' => 'Dr. Jose Rizal',
        'relationship' => 'Descendant',
        'preferred_date' => '2026-11-01'
    ],
    'expires_at' => date('Y-m-d H:i:s', time() + 86400)
]);

// 4. Committed draft for User A (should be excluded from draft rows)
$committedDraftAId = insertTestDraft($db, [
    'user_id' => $userA['user_id'],
    'service_type' => 'burial',
    'status' => BookingDraft::STATUS_COMMITTED,
    'extracted_data' => ['decedent_name' => 'Committed Person'],
    'committed_record_id' => $burialIdA,
    'committed_record_type' => 'burial',
    'expires_at' => date('Y-m-d H:i:s', time() + 86400)
]);

// 5. Cancelled draft for User A (should be excluded from draft rows)
$cancelledDraftAId = insertTestDraft($db, [
    'user_id' => $userA['user_id'],
    'service_type' => 'cremation',
    'status' => BookingDraft::STATUS_CANCELLED,
    'extracted_data' => ['decedent_name' => 'Cancelled Person'],
    'expires_at' => date('Y-m-d H:i:s', time() + 86400)
]);

// 6. Expired draft for User A (should be excluded from draft rows)
$expiredDraftAId = insertTestDraft($db, [
    'user_id' => $userA['user_id'],
    'service_type' => 'burial',
    'status' => BookingDraft::STATUS_COLLECTING_INFO,
    'extracted_data' => ['decedent_name' => 'Expired Person'],
    'expires_at' => date('Y-m-d H:i:s', time() - 3600) // 1 hr ago
]);

// 7. User B burial and active draft
$db->prepare("
    INSERT INTO burial_schedules (created_by, lot_id, schedule_date, status, notes)
    VALUES (?, ?, '2026-10-25 11:00:00', 'Confirmed', 'BMS-9 Test Burial for User B')
")->execute([$userB['user_id'], $lotId]);
$burialIdB = (int) $db->lastInsertId();

$activeDraftBId = insertTestDraft($db, [
    'user_id' => $userB['user_id'],
    'service_type' => 'cremation',
    'status' => BookingDraft::STATUS_COLLECTING_INFO,
    'extracted_data' => ['decedent_name' => 'User B Decedent'],
    'expires_at' => date('Y-m-d H:i:s', time() + 86400)
]);

// ----------------------------------------------------------------------
// TEST 2: UnifiedBooking::findMine for User A returns expected count & records
// ----------------------------------------------------------------------
$userABookings = $unifiedModel->findMine($userA['user_id']);
// Expected for User A: 1 burial, 1 cremation, 1 active draft = exactly 3
$test2Ok = (count($userABookings) === 3);
report(2, "UnifiedBooking::findMine returns exactly active draft and official bookings (count=3)", $test2Ok, "Actual count: " . count($userABookings));

// ----------------------------------------------------------------------
// TEST 3: Active draft row schema in v_unified_bookings
// ----------------------------------------------------------------------
$draftRow = null;
foreach ($userABookings as $b) {
    if (strtolower($b['source_kind']) === 'draft') {
        $draftRow = $b;
        break;
    }
}

$test3Ok = (
    $draftRow !== null &&
    (int)$draftRow['is_draft'] === 1 &&
    (int)$draftRow['draft_id'] === (int)$activeDraftAId &&
    $draftRow['service_type'] === 'burial' &&
    $draftRow['decedent_name'] === 'Dr. Jose Rizal' &&
    $draftRow['booking_reference'] === 'DFT-' . $activeDraftAId
);
report(3, "Active draft row correctly formatted (source_kind=draft, is_draft=1, reference DFT-xxxxx)", $test3Ok, json_encode($draftRow));

// ----------------------------------------------------------------------
// TEST 4: Exclusion of committed, cancelled, and expired drafts
// ----------------------------------------------------------------------
$excludedIds = [$committedDraftAId, $cancelledDraftAId, $expiredDraftAId];
$foundExcluded = false;
foreach ($userABookings as $b) {
    if (strtolower($b['source_kind']) === 'draft' && in_array((int)$b['source_id'], $excludedIds, true)) {
        $foundExcluded = true;
        break;
    }
}
report(4, "Committed, cancelled, and expired drafts are excluded from v_unified_bookings", !$foundExcluded, "Found excluded draft ID in output");

// ----------------------------------------------------------------------
// TEST 5: Strict ownership isolation
// ----------------------------------------------------------------------
$userBBookings = $unifiedModel->findMine($userB['user_id']);
$userAIds = array_map(function($x) { return $x['source_kind'] . ':' . $x['source_id']; }, $userABookings);
$userBIds = array_map(function($x) { return $x['source_kind'] . ':' . $x['source_id']; }, $userBBookings);
$overlap = array_intersect($userAIds, $userBIds);

$test5Ok = empty($overlap) && count($userBBookings) === 2; // 1 burial + 1 active draft for User B
report(5, "Strict ownership isolation: User A and User B results have zero overlap", $test5Ok, "Overlap: " . implode(', ', $overlap) . " | User B count: " . count($userBBookings));

// ----------------------------------------------------------------------
// TEST 6: UnifiedBooking::getStats returns correct counts
// ----------------------------------------------------------------------
$statsA = $unifiedModel->getStats($userA['user_id']);
$test6Ok = (
    $statsA['total'] === 3 &&
    $statsA['burials'] === 1 &&
    $statsA['cremations'] === 1 &&
    $statsA['drafts'] === 1
);
report(6, "UnifiedBooking::getStats returns accurate aggregate counts", $test6Ok, json_encode($statsA));

// ----------------------------------------------------------------------
// TEST 7: Filtering and pagination
// ----------------------------------------------------------------------
$burialOnly = $unifiedModel->findMine($userA['user_id'], ['service_type' => 'burial', 'source_kind' => 'schedule']);
$cremationOnly = $unifiedModel->findMine($userA['user_id'], ['service_type' => 'cremation']);
$draftsOnly = $unifiedModel->findMine($userA['user_id'], ['source_kind' => 'draft']);
$searchRizal = $unifiedModel->findMine($userA['user_id'], ['q' => 'Rizal']);

$test7Ok = (
    count($burialOnly) === 1 &&
    count($cremationOnly) === 1 &&
    count($draftsOnly) === 1 &&
    count($searchRizal) === 1 &&
    $searchRizal[0]['decedent_name'] === 'Dr. Jose Rizal'
);
report(7, "UnifiedBooking filters (service_type, source_kind, search query q) work accurately", $test7Ok, "Burials: " . count($burialOnly) . ", Cremations: " . count($cremationOnly) . ", Drafts: " . count($draftsOnly) . ", Search: " . count($searchRizal));

// ----------------------------------------------------------------------
// TEST 8: Resumption API getDraft returns full draft state for owner
// ----------------------------------------------------------------------
ob_start();
$resA = $controller->getDraft($activeDraftAId, $userA);
ob_end_clean();

$test8Ok = (
    isset($resA['success']) && $resA['success'] === true &&
    isset($resA['draft']['draft_id']) && (int)$resA['draft']['draft_id'] === $activeDraftAId &&
    isset($resA['authoritative_state']['extracted_fields']['decedent_name']) &&
    $resA['authoritative_state']['extracted_fields']['decedent_name'] === 'Dr. Jose Rizal'
);
report(8, "Resumption API getDraft returns draft and authoritative_state for owning user", $test8Ok, json_encode($resA));

// ----------------------------------------------------------------------
// TEST 9: Resumption API getDraft rejects non-owner with HTTP 403 / 404
// ----------------------------------------------------------------------
ob_start();
$resUnauthorized = $controller->getDraft($activeDraftAId, $userB);
ob_end_clean();

$test9Ok = (
    isset($resUnauthorized['success']) && $resUnauthorized['success'] === false &&
    (
        (isset($resUnauthorized['code']) && in_array($resUnauthorized['code'], [403, 404], true)) ||
        (isset($resUnauthorized['error_type']) && in_array($resUnauthorized['error_type'], ['UNAUTHORIZED_ACCESS', 'DRAFT_NOT_FOUND'], true))
    )
);
report(9, "Resumption API getDraft blocks cross-user access (HTTP 403/404)", $test9Ok, "Response: " . json_encode($resUnauthorized));

// ----------------------------------------------------------------------
// TEST 10: Resumption API getDraft rejects expired draft with HTTP 410
// ----------------------------------------------------------------------
ob_start();
$resExpired = $controller->getDraft($expiredDraftAId, $userA);
ob_end_clean();

$test10Ok = (
    isset($resExpired['success']) && $resExpired['success'] === false &&
    (
        (isset($resExpired['code']) && $resExpired['code'] === 410) ||
        (isset($resExpired['error_type']) && $resExpired['error_type'] === 'DRAFT_EXPIRED')
    )
);
report(10, "Resumption API getDraft rejects expired draft (HTTP 410)", $test10Ok, "Response: " . json_encode($resExpired));

// ----------------------------------------------------------------------
// TEST 11: Controller getUnifiedBookings endpoint returns full formatted response
// ----------------------------------------------------------------------
ob_start();
$unifiedRes = $controller->getUnifiedBookings($userA, ['service_type' => 'burial'], ['page' => 1, 'limit' => 10]);
ob_end_clean();

$test11Ok = (
    isset($unifiedRes['success']) && $unifiedRes['success'] === true &&
    isset($unifiedRes['data']) && is_array($unifiedRes['data']) &&
    isset($unifiedRes['stats']) &&
    isset($unifiedRes['pagination']['page'])
);
report(11, "Controller getUnifiedBookings returns formatted payload with stats and pagination", $test11Ok, json_encode($unifiedRes));

// Cleanup test data
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");
$db->exec("DELETE FROM burial_schedules WHERE created_by IN ({$userA['user_id']}, {$userB['user_id']})");
$db->exec("DELETE FROM cremation_records WHERE created_by IN ({$userA['user_id']}, {$userB['user_id']})");
$db->exec("DELETE FROM users WHERE user_id IN ({$userA['user_id']}, {$userB['user_id']})");

echo "==============================================================\n";
echo "BMS-9 RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "==============================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
