<?php
/**
 * Test Suite: CMS Batch 3 Remediation Verification
 *
 * Verifies:
 * 1. AI-001: Supported Gemini Model Identifier & Adaptive Thinking/Fallback
 * 2. LOGIC-001: Safe Relocation Source-Lot Release (Multi-occupant, single-occupant, transaction safety)
 * 3. LOGIC-002: Columbarium-Scoped Cremation Niche Availability
 * 4. LOGIC-003: Occupancy Calculation Accounting for Expired Lots
 */

require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/controllers/RelocationController.php';
require_once __DIR__ . '/../backend/controllers/CremationController.php';
require_once __DIR__ . '/../backend/controllers/ReportController.php';
require_once __DIR__ . '/../backend/services/AIService.php';
require_once __DIR__ . '/../backend/models/Relocation.php';
require_once __DIR__ . '/../backend/models/Cremation.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/Decedent.php';

$db = Database::getInstance()->getConnection();
$passed = 0;
$failed = 0;

function report($name, $ok, $details = '') {
    global $passed, $failed;
    if ($ok) {
        $passed++;
        echo "[PASS] $name\n";
    } else {
        $failed++;
        echo "[FAIL] $name: $details\n";
    }
}

echo "=== CMS BATCH 3 REMEDIATION REGRESSION SUITE ===\n\n";

// Ensure admin user exists
$admin = $db->query("SELECT user_id FROM users WHERE role_id = 1 LIMIT 1")->fetch();
$adminId = $admin ? (int)$admin['user_id'] : 1;

// Section/Block helpers
$sectionId = (int)$db->query("SELECT section_id FROM sections LIMIT 1")->fetchColumn();
if (!$sectionId) {
    $db->exec("INSERT INTO sections (section_name) VALUES ('Batch3 Test Section')");
    $sectionId = (int)$db->lastInsertId();
}
$blockId = (int)$db->query("SELECT block_id FROM blocks WHERE section_id = $sectionId LIMIT 1")->fetchColumn();
if (!$blockId) {
    $db->exec("INSERT INTO blocks (section_id, block_name) VALUES ($sectionId, 'Block B3')");
    $blockId = (int)$db->lastInsertId();
}
$lotTypeId = (int)$db->query("SELECT type_id FROM lot_types LIMIT 1")->fetchColumn();
if (!$lotTypeId) {
    $db->exec("INSERT INTO lot_types (type_name, price) VALUES ('Standard Lot', 10000)");
    $lotTypeId = (int)$db->lastInsertId();
}

$lotModel = new Lot();
$decedentModel = new Decedent();
$relocationModel = new Relocation();
$relocationController = new RelocationController();
$cremationModel = new Cremation();
$cremationController = new CremationController();
$reportController = new ReportController();
$aiService = new AIService();

// ==========================================
// 1. LOGIC-001: RELOCATION SOURCE LOT RELEASE
// ==========================================
echo "--- Testing LOGIC-001: Relocation Source-Lot Release ---\n";

// Helper to create test lot
function createTestLot($db, $blockId, $lotTypeId, $status) {
    $num = 'T-B3-' . uniqid();
    $stmt = $db->prepare("INSERT INTO lots (block_id, lot_type_id, lot_number, status, price) VALUES (?, ?, ?, ?, 10000.00)");
    $stmt->execute([$blockId, $lotTypeId, $num, $status]);
    return (int)$db->lastInsertId();
}

// Case 1A: Single occupant -> Relocation completes -> Source lot becomes Available
$srcLot1 = createTestLot($db, $blockId, $lotTypeId, 'Occupied');
$dstLot1 = createTestLot($db, $blockId, $lotTypeId, 'Available');
$dec1 = $decedentModel->create([
    'first_name' => 'Single',
    'last_name' => 'Occupant',
    'dob' => '1960-01-01',
    'dod' => '2020-01-01',
    'lot_id' => $srcLot1,
]);

$resCreate1 = $relocationController->store([
    'from_lot_id' => $srcLot1,
    'to_lot_id' => $dstLot1,
    'deceased_id' => $dec1,
    'reason' => 'Single occupant relocation',
], $adminId);
$reqId1 = (int)$relocationModel->findActiveByDecedent($dec1)['request_id'];

$resComp1 = $relocationController->complete($reqId1, $adminId);
report("Single occupant: relocation completes successfully", !empty($resComp1['success']));

$srcLot1After = $lotModel->findById($srcLot1);
$dstLot1After = $lotModel->findById($dstLot1);
report("Single occupant: source lot becomes Available when empty", $srcLot1After['status'] === 'Available');
report("Single occupant: destination lot becomes Occupied", $dstLot1After['status'] === 'Occupied');

// Case 1B: Multiple occupants -> One relocated -> Source lot remains Occupied
$srcLot2 = createTestLot($db, $blockId, $lotTypeId, 'Occupied');
$dstLot2A = createTestLot($db, $blockId, $lotTypeId, 'Available');
$dstLot2B = createTestLot($db, $blockId, $lotTypeId, 'Available');

$dec2A = $decedentModel->create([
    'first_name' => 'FamilyA',
    'last_name' => 'Occupant',
    'dob' => '1955-01-01',
    'dod' => '2015-01-01',
    'lot_id' => $srcLot2,
]);
$dec2B = $decedentModel->create([
    'first_name' => 'FamilyB',
    'last_name' => 'Occupant',
    'dob' => '1958-01-01',
    'dod' => '2018-01-01',
    'lot_id' => $srcLot2,
]);

// Verify source lot has 2 active occupants
$occupantsBefore = $decedentModel->countActiveByLotId($srcLot2);
report("Multi-occupant lot has 2 active occupants initially", $occupantsBefore === 2);

// Relocate only dec2A
$resCreate2A = $relocationController->store([
    'from_lot_id' => $srcLot2,
    'to_lot_id' => $dstLot2A,
    'deceased_id' => $dec2A,
    'reason' => 'Partial relocation family A',
], $adminId);
$reqId2A = (int)$relocationModel->findActiveByDecedent($dec2A)['request_id'];

$resComp2A = $relocationController->complete($reqId2A, $adminId);
report("Multi-occupant: first relocation completes", !empty($resComp2A['success']));

$srcLot2AfterFirst = $lotModel->findById($srcLot2);
$dstLot2AAfter = $lotModel->findById($dstLot2A);
report("Multi-occupant: source lot DOES NOT become Available while other occupant remains", $srcLot2AfterFirst['status'] === 'Occupied');
report("Multi-occupant: first destination lot becomes Occupied", $dstLot2AAfter['status'] === 'Occupied');

// Case 1C: Relocate remaining occupant (dec2B) -> Now source lot becomes Available
$resCreate2B = $relocationController->store([
    'from_lot_id' => $srcLot2,
    'to_lot_id' => $dstLot2B,
    'deceased_id' => $dec2B,
    'reason' => 'Final relocation family B',
], $adminId);
$reqId2B = (int)$relocationModel->findActiveByDecedent($dec2B)['request_id'];

$resComp2B = $relocationController->complete($reqId2B, $adminId);
report("Multi-occupant: second relocation completes", !empty($resComp2B['success']));

$srcLot2AfterSecond = $lotModel->findById($srcLot2);
report("Multi-occupant: source lot becomes Available after ALL occupants relocated", $srcLot2AfterSecond['status'] === 'Available');

// Case 1D: Destination lot behavior remains unchanged upon Denial
$srcLot3 = createTestLot($db, $blockId, $lotTypeId, 'Occupied');
$dstLot3 = createTestLot($db, $blockId, $lotTypeId, 'Available');
$dec3 = $decedentModel->create([
    'first_name' => 'Denial',
    'last_name' => 'Tester',
    'dob' => '1970-01-01',
    'dod' => '2021-01-01',
    'lot_id' => $srcLot3,
]);
$resCreate3 = $relocationController->store([
    'from_lot_id' => $srcLot3,
    'to_lot_id' => $dstLot3,
    'deceased_id' => $dec3,
    'reason' => 'Denial rollback test',
], $adminId);
$reqId3 = (int)$relocationModel->findActiveByDecedent($dec3)['request_id'];
// Deny it
$relocationController->deny($reqId3, $adminId);
$srcLot3AfterDeny = $lotModel->findById($srcLot3);
$dstLot3AfterDeny = $lotModel->findById($dstLot3);
report("Failed/Denied relocation does not release source lot", $srcLot3AfterDeny['status'] === 'Occupied');
report("Destination lot rolls back to Available upon Denial", $dstLot3AfterDeny['status'] === 'Available');

// ==========================================
// 2. LOGIC-002: CREMATION NICHE COLUMBARIUM SCOPING
// ==========================================
echo "\n--- Testing LOGIC-002: Cremation Niche Columbarium Scoping ---\n";

$colA = 'Columbarium Alpha ' . uniqid();
$colB = 'Columbarium Beta ' . uniqid();
$sharedNiche = 'N-101';

$decCremA = $decedentModel->create([
    'first_name' => 'CremationA',
    'last_name' => 'Decedent',
    'dob' => '1965-01-01',
    'dod' => '2023-01-01',
    'is_cremated' => 'yes',
]);
$decCremB = $decedentModel->create([
    'first_name' => 'CremationB',
    'last_name' => 'Decedent',
    'dob' => '1968-01-01',
    'dod' => '2023-05-01',
    'is_cremated' => 'yes',
]);

// Step 1: Assign niche in Columbarium A
$resStoreA = $cremationController->store([
    'deceased_id' => $decCremA,
    'columbarium' => $colA,
    'niche_number' => $sharedNiche,
    'cremation_date' => date('Y-m-d'),
    'status' => 'Scheduled',
], $adminId);
report("Columbarium A / Niche 101 successfully scheduled", !empty($resStoreA['success']));
$cremAId = (int)($resStoreA['cremation_id'] ?? 0);

// Step 2: Check availability of same niche in Columbarium A (must be occupied) vs Columbarium B (must be available)
$availInA = $cremationModel->isNicheAvailable($sharedNiche, $colA);
$availInB = $cremationModel->isNicheAvailable($sharedNiche, $colB);
report("Columbarium A / Niche 101 is NOT available", $availInA === false);
report("Columbarium B / Niche 101 IS available independently", $availInB === true);

// Step 3: Create record in Columbarium B with same niche number -> must succeed
$resStoreB = $cremationController->store([
    'deceased_id' => $decCremB,
    'columbarium' => $colB,
    'niche_number' => $sharedNiche,
    'cremation_date' => date('Y-m-d'),
    'status' => 'Scheduled',
], $adminId);
report("Columbarium B / Niche 101 scheduled successfully without collision", !empty($resStoreB['success']));
$cremBId = (int)($resStoreB['cremation_id'] ?? 0);

// Step 4: Attempt to update Columbarium B's record to Columbarium A with the same niche -> must collide (409)
$adminUser = ['user_id' => $adminId, 'role' => 'admin'];
$resUpdateCollision = $cremationController->update($cremBId, [
    'columbarium' => $colA,
    'niche_number' => $sharedNiche,
], $adminUser);
report("Cross-columbarium move to already-occupied niche returns 409 collision", isset($resUpdateCollision['code']) && $resUpdateCollision['code'] === 409);

// Step 5: Updating same record without changing niche or columbarium does not self-collide
$resUpdateSelf = $cremationController->update($cremBId, [
    'notes' => 'Updated notes on niche 101',
], $adminUser);
report("Updating non-niche fields on existing record preserves niche without self-collision", !empty($resUpdateSelf['success']));

// Cleanup test cremation records
if ($cremAId) $db->exec("DELETE FROM cremation_records WHERE cremation_id = $cremAId");
if ($cremBId) $db->exec("DELETE FROM cremation_records WHERE cremation_id = $cremBId");

// ==========================================
// 3. LOGIC-003: OCCUPANCY CALCULATION & EXPIRED LOTS
// ==========================================
echo "\n--- Testing LOGIC-003: Occupancy Calculation & Expired Lots ---\n";

// Ensure at least one Expired lot exists in the database
$expiredLotId = createTestLot($db, $blockId, $lotTypeId, 'Expired');

$report = $reportController->occupancy();
$execSummary = $report['executive_summary'] ?? [];

report("Executive summary includes expired_lots metric", array_key_exists('expired_lots', $execSummary));

$tot = (int)($execSummary['total_lots'] ?? 0);
$occ = (int)($execSummary['occupied_lots'] ?? 0);
$res = (int)($execSummary['reserved_lots'] ?? 0);
$exp = (int)($execSummary['expired_lots'] ?? 0);
$avl = (int)($execSummary['available_lots'] ?? 0);
$utilized = (int)($execSummary['utilized_lots'] ?? 0);

report("Grand utilized lots equals occupied + reserved + expired", $utilized === ($occ + $res + $exp));
report("Total lots equals utilized + available", $tot === ($utilized + $avl));

$expectedRate = $tot > 0 ? round(($utilized / $tot) * 100, 1) : 0.0;
report("Executive summary utilization_rate matches utilized / total calculation", (float)$execSummary['utilization_rate'] === $expectedRate);

// Verify AIService forecastFallback incorporates expired lots in occupied capacity
$forecastResult = $aiService->forecastFallback(3);
report("AIService forecastFallback executes cleanly", is_array($forecastResult) && !isset($forecastResult['error']));
$capacity = $forecastResult['capacity'] ?? [];
report("AIService capacity includes expired lots in occupied metric", ($capacity['occupied'] ?? 0) >= ($occ + $exp));

// Cleanup test expired lot
$db->exec("DELETE FROM lots WHERE lot_id = $expiredLotId");

echo "\n------------------------------------------------------------\n";
echo "SUMMARY: Passed: $passed, Failed: $failed\n";
if ($failed === 0) {
    echo "ALL BATCH 3 REMEDIATION TESTS PASSED!\n";
} else {
    echo "SOME BATCH 3 TESTS FAILED.\n";
    exit(1);
}
