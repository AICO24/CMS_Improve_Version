<?php
/**
 * Test Suite for Cemetery Mapping Batch 2: Read-Only Backend API
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/controllers/MapController.php';
require_once __DIR__ . '/../backend/models/Cemetery.php';
require_once __DIR__ . '/../backend/models/Section.php';
require_once __DIR__ . '/../backend/models/Block.php';
require_once __DIR__ . '/../backend/models/Lot.php';

$pdo = Database::getInstance()->getConnection();

$testsPassed = 0;
$testsFailed = 0;

function assertCondition($name, $condition, $details = '') {
    global $testsPassed, $testsFailed;
    if ($condition) {
        echo " [PASS] $name\n";
        $testsPassed++;
    } else {
        echo " [FAIL] $name: $details\n";
        $testsFailed++;
    }
}

echo "=== CEMETERY MAPPING BATCH 2 TESTS ===\n\n";

$mapController = new MapController();

// 1. GET /api/cemeteries
echo "Test 1: List active cemetery facilities\n";
$res1 = $mapController->getCemeteries();
assertCondition('getCemeteries returns 200', ($res1['code'] ?? 0) === 200);
assertCondition('getCemeteries returns success=true', ($res1['success'] ?? false) === true);
assertCondition('getCemeteries has data array', is_array($res1['data'] ?? null) && count($res1['data']) >= 1);
$cemetery1 = $res1['data'][0] ?? [];
assertCondition('Cemetery contains expected keys', isset($cemetery1['cemetery_id'], $cemetery1['cemetery_name'], $cemetery1['cemetery_code'], $cemetery1['is_active']));
assertCondition('No sensitive user PII in cemetery response', !isset($cemetery1['password'], $cemetery1['user_id'], $cemetery1['email']));

// 2. GET /api/map/layout with valid cemetery_id
echo "\nTest 2: Layout retrieval for cemetery_id = 1\n";
$res2 = $mapController->getLayout(1);
assertCondition('getLayout(1) returns 200', ($res2['code'] ?? 0) === 200);
assertCondition('getLayout(1) returns success=true', ($res2['success'] ?? false) === true);
assertCondition('getLayout(1) has cemetery object', isset($res2['data']['cemetery']));
assertCondition('getLayout(1) has sections array', is_array($res2['data']['sections'] ?? null));
if (!empty($res2['data']['sections'])) {
    $firstSec = $res2['data']['sections'][0];
    assertCondition('Section contains section_id and section_name', isset($firstSec['section_id'], $firstSec['section_name']));
    assertCondition('Section has cemetery_id = 1', ($firstSec['cemetery_id'] ?? 0) === 1);
    assertCondition('Section contains nested blocks array', is_array($firstSec['blocks'] ?? null));
    if (!empty($firstSec['blocks'])) {
        $firstBlock = $firstSec['blocks'][0];
        assertCondition('Block belongs to parent section', ($firstBlock['section_id'] ?? 0) === (int)$firstSec['section_id']);
        assertCondition('Block has map_config key', array_key_exists('map_config', $firstBlock));
    }
}

// 3. Layout validation edge cases
echo "\nTest 3: Layout validation edge cases\n";
$res3a = $mapController->getLayout(null);
assertCondition('Missing cemetery_id returns 400', ($res3a['code'] ?? 0) === 400 && ($res3a['success'] ?? true) === false);

$res3b = $mapController->getLayout('abc');
assertCondition('Non-numeric cemetery_id returns 400', ($res3b['code'] ?? 0) === 400);

$res3c = $mapController->getLayout(-5);
assertCondition('Negative cemetery_id returns 400', ($res3c['code'] ?? 0) === 400);

$res3d = $mapController->getLayout(999999);
assertCondition('Non-existent cemetery_id returns 404', ($res3d['code'] ?? 0) === 404);

// 4. GET /api/map/blocks/{id}/lots
echo "\nTest 4: Retrieve lots for block\n";
// Find an existing block
$stmt = $pdo->query("SELECT block_id FROM blocks LIMIT 1");
$existingBlockId = $stmt->fetchColumn();

if ($existingBlockId) {
    $res4 = $mapController->getBlockLots($existingBlockId);
    assertCondition("getBlockLots($existingBlockId) returns 200", ($res4['code'] ?? 0) === 200);
    assertCondition("getBlockLots($existingBlockId) returns success=true", ($res4['success'] ?? false) === true);
    assertCondition('Response has block object', isset($res4['data']['block']));
    assertCondition('Response has lots array', is_array($res4['data']['lots'] ?? null));

    if (!empty($res4['data']['lots'])) {
        $lot = $res4['data']['lots'][0];
        assertCondition('Lot contains lot_id and lot_number', isset($lot['lot_id'], $lot['lot_number']));
        assertCondition('Lot contains authoritative status', isset($lot['status']) && in_array($lot['status'], ['Available', 'Reserved', 'Occupied', 'Unavailable', 'Under Maintenance']));
        assertCondition('Lot contains lot_type and price', isset($lot['lot_type'], $lot['price']));
        assertCondition('Lot has map_config key', array_key_exists('map_config', $lot));
        assertCondition('No decedent PII in lot record', !isset($lot['first_name'], $lot['last_name'], $lot['contact_number'], $lot['claimant_name'], $lot['decedent_name']));
    }
} else {
    echo " [WARN] No blocks found in database to test getBlockLots.\n";
}

// 5. Block lots validation edge cases
echo "\nTest 5: Block lots edge cases\n";
$res5a = $mapController->getBlockLots(null);
assertCondition('Missing block_id returns 400', ($res5a['code'] ?? 0) === 400);

$res5b = $mapController->getBlockLots('xyz');
assertCondition('Non-numeric block_id returns 400', ($res5b['code'] ?? 0) === 400);

$res5c = $mapController->getBlockLots(999999);
assertCondition('Non-existent block_id returns 404', ($res5c['code'] ?? 0) === 404);

// 6. Cross-cemetery isolation test
echo "\nTest 6: Multi-cemetery isolation test\n";
$pdo->beginTransaction();
try {
    // Insert temporary second cemetery
    $stmt = $pdo->prepare("INSERT INTO cemeteries (cemetery_name, cemetery_code, description, is_active) VALUES (?, ?, ?, 1)");
    $stmt->execute(['Test North Cemetery', 'TEST_NORTH', 'Isolation check facility']);
    $cem2Id = (int) $pdo->lastInsertId();

    // Insert section in cemetery 2
    $stmt = $pdo->prepare("INSERT INTO sections (cemetery_id, section_name, description) VALUES (?, ?, ?)");
    $stmt->execute([$cem2Id, 'North Ridge A', 'Section in cem 2']);
    $sec2Id = (int) $pdo->lastInsertId();

    // Insert block in cemetery 2 section
    $stmt = $pdo->prepare("INSERT INTO blocks (section_id, block_name, total_lots) VALUES (?, ?, ?)");
    $stmt->execute([$sec2Id, 'Block N1', 10]);
    $block2Id = (int) $pdo->lastInsertId();

    // Layout of cemetery 1 must NOT contain cemetery 2's section or block
    $cem1Layout = $mapController->getLayout(1);
    $cem1SecIds = array_column($cem1Layout['data']['sections'], 'section_id');
    assertCondition('Cemetery 1 layout does NOT include Cemetery 2 section', !in_array($sec2Id, $cem1SecIds));

    // Layout of cemetery 2 must ONLY contain cemetery 2's section
    $cem2Layout = $mapController->getLayout($cem2Id);
    $cem2SecIds = array_column($cem2Layout['data']['sections'], 'section_id');
    assertCondition('Cemetery 2 layout includes only its own section', in_array($sec2Id, $cem2SecIds) && count($cem2SecIds) === 1);
    $cem2BlockIds = array_column($cem2Layout['data']['sections'][0]['blocks'], 'block_id');
    assertCondition('Cemetery 2 section includes Block N1', in_array($block2Id, $cem2BlockIds));

    // Block 2 lots check
    $block2Res = $mapController->getBlockLots($block2Id);
    assertCondition('Block 2 lots response reports correct cemetery_id', ($block2Res['data']['block']['cemetery_id'] ?? 0) === $cem2Id);

} finally {
    $pdo->rollBack();
}

// 7. Test Inactive Cemetery Handling
echo "\nTest 7: Inactive cemetery rejection\n";
$pdo->beginTransaction();
try {
    $stmt = $pdo->prepare("INSERT INTO cemeteries (cemetery_name, cemetery_code, is_active) VALUES (?, ?, 0)");
    $stmt->execute(['Inactive Memorial', 'INACTIVE_TEST']);
    $inactiveCemId = (int) $pdo->lastInsertId();

    $inactiveRes = $mapController->getLayout($inactiveCemId);
    assertCondition('Inactive cemetery layout returns 404', ($inactiveRes['code'] ?? 0) === 404);

    // Ensure it does not show up in getCemeteries()
    $activeList = $mapController->getCemeteries();
    $activeIds = array_column($activeList['data'], 'cemetery_id');
    assertCondition('Inactive cemetery excluded from getCemeteries()', !in_array($inactiveCemId, $activeIds));
} finally {
    $pdo->rollBack();
}

echo "\n========================================\n";
echo "TOTAL PASSED: $testsPassed\n";
echo "TOTAL FAILED: $testsFailed\n";
echo "========================================\n";

if ($testsFailed > 0) {
    exit(1);
}
