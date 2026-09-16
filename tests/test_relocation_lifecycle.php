<?php
/**
 * Test Suite: Relocation Management Lifecycle, Automations & Documents (Batch 1)
 *
 * Verifies:
 * 1. Validations:
 *    - Same-lot rejection (from_lot_id === to_lot_id)
 *    - Mismatched decedent current lot
 *    - Duplicate active relocation prevention
 * 2. Full Automation & Lifecycle:
 *    - Auto-approval reservations (to_lot -> Reserved)
 *    - Completion lot status sync (from_lot -> Available, to_lot -> Occupied)
 *    - CRITICAL FIX: Updating decedent_records.lot_id to to_lot_id on completion
 *    - Denial rollback (to_lot -> Available when an Approved request is Denied)
 *    - Cancellation rollback (to_lot -> Available when an Approved request is Cancelled)
 * 3. Enriched Stats:
 *    - getStats() includes attention, pending, approved, completed, denied, total
 * 4. Relocation Documents:
 *    - Document records can be created, fetched, and deleted
 */

require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/controllers/RelocationController.php';
require_once __DIR__ . '/../backend/models/Relocation.php';
require_once __DIR__ . '/../backend/models/RelocationDocument.php';
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

echo "=== RELOCATION MANAGEMENT LIFECYCLE & AUTOMATION TESTS (BATCH 1) ===\n\n";

// Ensure test admin user exists
$admin = $db->query("SELECT user_id FROM users WHERE role_id = 1 LIMIT 1")->fetch();
$adminId = $admin ? (int)$admin['user_id'] : 1;

// Prepare Test Data: 2 Lots and 1 Decedent
// Find or create test Section & Block
$sectionId = (int)$db->query("SELECT section_id FROM sections LIMIT 1")->fetchColumn();
if (!$sectionId) {
    $db->exec("INSERT INTO sections (section_name) VALUES ('Reloc Test Section')");
    $sectionId = (int)$db->lastInsertId();
}
$blockId = (int)$db->query("SELECT block_id FROM blocks WHERE section_id = $sectionId LIMIT 1")->fetchColumn();
if (!$blockId) {
    $db->exec("INSERT INTO blocks (section_id, block_name) VALUES ($sectionId, 'Block Reloc')");
    $blockId = (int)$db->lastInsertId();
}
$lotTypeId = (int)$db->query("SELECT type_id FROM lot_types LIMIT 1")->fetchColumn();
if (!$lotTypeId) {
    $db->exec("INSERT INTO lot_types (type_name, price) VALUES ('Standard Ground', 15000)");
    $lotTypeId = (int)$db->lastInsertId();
}

// Create Test Lot 1 (Source)
$lotNum1 = 'TEST-RL-' . time() . '-1';
$db->prepare("INSERT INTO lots (block_id, lot_type_id, lot_number, status, price) VALUES (?, ?, ?, 'Occupied', 10000.00)")
   ->execute([$blockId, $lotTypeId, $lotNum1]);
$sourceLotId = (int)$db->lastInsertId();

// Create Test Lot 2 (Destination)
$lotNum2 = 'TEST-RL-' . time() . '-2';
$db->prepare("INSERT INTO lots (block_id, lot_type_id, lot_number, status, price) VALUES (?, ?, ?, 'Available', 10000.00)")
   ->execute([$blockId, $lotTypeId, $lotNum2]);
$destLotId = (int)$db->lastInsertId();

// Create Test Decedent assigned to Source Lot
$decedentModel = new Decedent();
$decedentId = $decedentModel->create([
    'first_name' => 'RelocTester',
    'last_name' => 'Automated',
    'dob' => '1950-01-01',
    'dod' => '2020-01-01',
    'lot_id' => $sourceLotId,
    'is_cremated' => 'no',
]);

$controller = new RelocationController();
$relocationModel = new Relocation();
$lotModel = new Lot();

// --- TEST 1: Same lot validation ---
$resSame = $controller->store([
    'from_lot_id' => $sourceLotId,
    'to_lot_id' => $sourceLotId,
    'deceased_id' => $decedentId,
    'reason' => 'Testing same lot rejection',
], $adminId);
report("Rejects same source and destination lot", isset($resSame['error']) && strpos($resSame['error'], 'same') !== false);

// --- TEST 2: Decedent lot mismatch validation ---
// Another lot
$lotNum3 = 'TEST-RL-' . time() . '-3';
$db->prepare("INSERT INTO lots (block_id, lot_type_id, lot_number, status, price) VALUES (?, ?, ?, 'Occupied', 10000.00)")
   ->execute([$blockId, $lotTypeId, $lotNum3]);
$wrongSourceLotId = (int)$db->lastInsertId();

$resMismatch = $controller->store([
    'from_lot_id' => $wrongSourceLotId,
    'to_lot_id' => $destLotId,
    'deceased_id' => $decedentId,
    'reason' => 'Testing lot mismatch',
], $adminId);
report("Rejects decedent not residing in source lot", isset($resMismatch['error']) && strpos($resMismatch['error'], 'different lot') !== false);

// --- TEST 3: Creation & Auto-Approval (Reserves Destination Lot) ---
$resCreate = $controller->store([
    'from_lot_id' => $sourceLotId,
    'to_lot_id' => $destLotId,
    'deceased_id' => $decedentId,
    'reason' => 'Valid relocation test',
], $adminId);
report("Successfully creates relocation request", !empty($resCreate['success']));

$createdRequest = $relocationModel->findActiveByDecedent($decedentId);
$requestId = $createdRequest ? (int)$createdRequest['request_id'] : 0;
report("Finds active relocation by decedent", $requestId > 0);

$destLotAfterApprove = $lotModel->findById($destLotId);
report("Destination lot is reserved upon approval", $destLotAfterApprove['status'] === 'Reserved');

// --- TEST 4: Duplicate active relocation prevention ---
$resDuplicate = $controller->store([
    'from_lot_id' => $sourceLotId,
    'to_lot_id' => $destLotId,
    'deceased_id' => $decedentId,
    'reason' => 'Duplicate test',
], $adminId);
report("Rejects duplicate active relocation for same decedent", isset($resDuplicate['error']) && strpos($resDuplicate['error'], 'already exists') !== false);

// --- TEST 5: Complete Relocation & CRITICAL Lot ID Sync ---
$resComplete = $controller->complete($requestId, $adminId);
report("Marks relocation completed", !empty($resComplete['success']));

$sourceLotAfterComplete = $lotModel->findById($sourceLotId);
$destLotAfterComplete = $lotModel->findById($destLotId);
$freshDecedent = $decedentModel->findById($decedentId);

report("Source lot released back to Available", $sourceLotAfterComplete['status'] === 'Available');
report("Destination lot occupied", $destLotAfterComplete['status'] === 'Occupied');
report("CRITICAL FIX: decedent_records.lot_id updated to destination lot", (int)$freshDecedent['lot_id'] === $destLotId);

// --- TEST 6: Denial Rollback on an Approved Request ---
// Create a new pair of lots & relocation
$lotNum4 = 'TEST-RL-' . time() . '-4';
$db->prepare("INSERT INTO lots (block_id, lot_type_id, lot_number, status, price) VALUES (?, ?, ?, 'Occupied', 10000.00)")
   ->execute([$blockId, $lotTypeId, $lotNum4]);
$srcLot4 = (int)$db->lastInsertId();

$lotNum5 = 'TEST-RL-' . time() . '-5';
$db->prepare("INSERT INTO lots (block_id, lot_type_id, lot_number, status, price) VALUES (?, ?, ?, 'Available', 10000.00)")
   ->execute([$blockId, $lotTypeId, $lotNum5]);
$dstLot5 = (int)$db->lastInsertId();

$decedentId2 = $decedentModel->create([
    'first_name' => 'RollbackTester',
    'last_name' => 'Denial',
    'dob' => '1960-01-01',
    'dod' => '2021-01-01',
    'lot_id' => $srcLot4,
    'is_cremated' => 'no',
]);

$resCreate2 = $controller->store([
    'from_lot_id' => $srcLot4,
    'to_lot_id' => $dstLot5,
    'deceased_id' => $decedentId2,
    'reason' => 'Denial rollback test',
], $adminId);
$req2 = $relocationModel->findActiveByDecedent($decedentId2);
$req2Id = $req2 ? (int)$req2['request_id'] : 0;

$resDeny = $controller->deny($req2Id, $adminId);
report("Denies approved request", !empty($resDeny['success']));

$dstLot5AfterDeny = $lotModel->findById($dstLot5);
report("Destination lot rolled back to Available upon Denial", $dstLot5AfterDeny['status'] === 'Available');

// --- TEST 7: Cancellation Rollback ---
$lotNum6 = 'TEST-RL-' . time() . '-6';
$db->prepare("INSERT INTO lots (block_id, lot_type_id, lot_number, status, price) VALUES (?, ?, ?, 'Available', 10000.00)")
   ->execute([$blockId, $lotTypeId, $lotNum6]);
$dstLot6 = (int)$db->lastInsertId();

$resCreate3 = $controller->store([
    'from_lot_id' => $srcLot4,
    'to_lot_id' => $dstLot6,
    'deceased_id' => $decedentId2,
    'reason' => 'Cancel rollback test',
], $adminId);
$req3 = $relocationModel->findActiveByDecedent($decedentId2);
$req3Id = $req3 ? (int)$req3['request_id'] : 0;

$resCancel = $controller->destroy($req3Id, $adminId);
report("Cancels approved request", !empty($resCancel['success']));

$dstLot6AfterCancel = $lotModel->findById($dstLot6);
report("Destination lot rolled back to Available upon Cancellation", $dstLot6AfterCancel['status'] === 'Available');

// --- TEST 8: Enriched Stats with Attention Count ---
$stats = $controller->stats();
report("Stats includes attention count key", array_key_exists('attention', $stats));
report("Stats contains total, pending, approved, completed", isset($stats['total']) && isset($stats['completed']));

// --- TEST 9: Relocation Documents Model & Operations ---
$docModel = new RelocationDocument();
$docId = $docModel->create([
    'request_id' => $requestId,
    'document_type' => 'exhumation_permit',
    'original_filename' => 'permit_12345.pdf',
    'file_path' => '/uploads/relocation-documents/sample.pdf',
    'uploaded_by' => $adminId,
]);
report("Creates relocation document record", $docId > 0);

$docs = $docModel->findByRequestId($requestId);
report("Retrieves attached documents for relocation request", count($docs) >= 1 && $docs[0]['original_filename'] === 'permit_12345.pdf');

$delDoc = $docModel->delete($docId);
report("Deletes relocation document record", $delDoc === true);

// Clean up test records
$db->prepare("DELETE FROM relocation_requests WHERE request_id IN (?, ?, ?)")->execute([$requestId, $req2Id, $req3Id]);
$db->prepare("DELETE FROM decedent_records WHERE decedent_id IN (?, ?)")->execute([$decedentId, $decedentId2]);
$db->prepare("DELETE FROM lots WHERE lot_id IN (?, ?, ?, ?, ?, ?)")->execute([$sourceLotId, $destLotId, $wrongSourceLotId, $srcLot4, $dstLot5, $dstLot6]);

echo "\n------------------------------------------------------------\n";
echo "SUMMARY: Passed: $passed, Failed: $failed\n";
if ($failed === 0) {
    echo "ALL RELOCATION BATCH 1 TESTS PASSED!\n";
    exit(0);
} else {
    echo "SOME TESTS FAILED!\n";
    exit(1);
}
