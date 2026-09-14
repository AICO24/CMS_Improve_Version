<?php
/**
 * Test Suite: Lot Disambiguation, Cremation Alignment & In-File Duplicates (Batch 2)
 *
 * Verifies:
 * 1. Lot::findByNumberAndSection() supports optional $blockName for disambiguation.
 * 2. Cremation records (is_cremated = 'yes') do not require lot_number or section_name.
 * 3. In-file duplicate detection flags identical records within the same CSV file.
 * 4. End-to-end preview() integration with mixed burial and cremation records.
 */

require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/controllers/DecedentImportController.php';

$totalTests = 0;
$passedTests = 0;
$failedTests = 0;

function assertTest($description, $condition, $details = '') {
    global $totalTests, $passedTests, $failedTests;
    $totalTests++;
    if ($condition) {
        $passedTests++;
        echo "  [PASS] {$description}\n";
    } else {
        $failedTests++;
        echo "  [FAIL] {$description}" . ($details ? " -> {$details}" : "") . "\n";
    }
}

echo "=======================================================\n";
echo "BATCH 2: LOT MATCHING, CREMATION & DUPLICATES TEST\n";
echo "=======================================================\n\n";

// -----------------------------------------------------------------------------
// Group 1: Lot Disambiguation with Block Name
// -----------------------------------------------------------------------------
echo "Group 1: Lot Resolution with Optional Block Name\n";

$lotModel = new Lot();
$db = Database::getInstance()->getConnection();
$sampleLot = $db->query("SELECT l.lot_number, s.section_name, b.block_name FROM lots l JOIN blocks b ON l.block_id=b.block_id JOIN sections s ON b.section_id=s.section_id LIMIT 1")->fetch();

if ($sampleLot) {
    $lotNum = $sampleLot['lot_number'];
    $secName = $sampleLot['section_name'];
    $blkName = $sampleLot['block_name'];

    // Test basic find by number and section
    $matchesSection = $lotModel->findByNumberAndSection($lotNum, $secName);
    assertTest("findByNumberAndSection('{$lotNum}', '{$secName}') executes and returns results", count($matchesSection) >= 1);
    assertTest("Matches contain block_name field", array_key_exists('block_name', $matchesSection[0]));

    // Test with explicit blockName parameter
    $matchesWithBlock = $lotModel->findByNumberAndSection($lotNum, $secName, $blkName);
    assertTest("findByNumberAndSection with blockName '{$blkName}' returns matching lot", count($matchesWithBlock) >= 1);
    assertTest("Result block matches '{$blkName}'", strtolower($matchesWithBlock[0]['block_name']) === strtolower($blkName));

    // Test with non-existent block
    $matchesNonExistent = $lotModel->findByNumberAndSection($lotNum, $secName, 'NonExistentBlock999');
    assertTest("findByNumberAndSection with non-existent block returns 0 matches", count($matchesNonExistent) === 0);
} else {
    $matchesSection = $lotModel->findByNumberAndSection('1', 'Section A');
    assertTest("findByNumberAndSection('1', 'Section A') executes without error", is_array($matchesSection));
}

echo "\n";

// -----------------------------------------------------------------------------
// Group 2: Cremation Alignment (Optional Lot for Cremation)
// -----------------------------------------------------------------------------
echo "Group 2: Cremation Alignment (Optional Lot for Cremation)\n";

$importController = new DecedentImportController();
$sampleLotNum = $sampleLot ? $sampleLot['lot_number'] : '1';
$sampleSecName = $sampleLot ? $sampleLot['section_name'] : 'Section A';
$sampleBlkName = $sampleLot ? $sampleLot['block_name'] : '';

// Create temporary CSV containing:
// Row 2: Burial record with valid lot (Ready)
// Row 3: Cremation record WITHOUT lot (Must be Ready!)
// Row 4: Burial record WITHOUT lot (Must be Rejected!)
$tempFileCremation = tempnam(sys_get_temp_dir(), 'decedent_cremation_test_');
$cremationCsv = implode("\r\n", [
    "First Name,Last Name,Date of Birth,Date of Death,Lot Number,Section,Block,Is Cremated,Ash Storage",
    "Juan,BurialWithLot,1950-01-01,2020-01-01,{$sampleLotNum},{$sampleSecName},{$sampleBlkName},no,",
    "Maria,CrematedNoLot,1955-02-02,2021-02-02,,,,yes,Columbarium Niche 5",
    "Pedro,BurialMissingLot,1960-03-03,2022-03-03,,,,no,",
]);
file_put_contents($tempFileCremation, $cremationCsv);

$previewCremation = $importController->preview([
    'tmp_name' => $tempFileCremation,
    'error' => UPLOAD_ERR_OK,
    'size' => filesize($tempFileCremation),
]);
@unlink($tempFileCremation);

assertTest("preview() accepts CSV with cremation records without global lot error", empty($previewCremation['error']));
if (!empty($previewCremation['rows'])) {
    $rows = $previewCremation['rows'];
    assertTest("CSV has 3 rows parsed", count($rows) === 3);

    // Row 2: Burial with lot
    assertTest("Row 2 (Burial with lot): lot_id is assigned", $rows[0]['data']['lot_id'] !== null);

    // Row 3: Cremation without lot
    assertTest("Row 3 (Cremation without lot): status is 'ready'", $rows[1]['status'] === 'ready', "Got status: " . $rows[1]['status'] . ", errors: " . implode('; ', $rows[1]['errors']));
    assertTest("Row 3 (Cremation without lot): lot_id is null", $rows[1]['data']['lot_id'] === null);
    assertTest("Row 3 (Cremation without lot): is_cremated is 'yes'", $rows[1]['data']['is_cremated'] === 'yes');
    assertTest("Row 3 (Cremation without lot): ash_storage preserved", $rows[1]['data']['ash_storage'] === 'Columbarium Niche 5');

    // Row 4: Burial without lot
    assertTest("Row 4 (Burial without lot): status is 'rejected'", $rows[2]['status'] === 'rejected');
    $hasLotError = false;
    foreach ($rows[2]['errors'] as $err) {
        if (strpos($err, 'Lot Number') !== false || strpos($err, 'Section') !== false) {
            $hasLotError = true;
        }
    }
    assertTest("Row 4 (Burial without lot): reports missing lot error", $hasLotError);
}

echo "\n";

// -----------------------------------------------------------------------------
// Group 3: In-File Duplicate Detection
// -----------------------------------------------------------------------------
echo "Group 3: In-File Duplicate Detection\n";

$tempFileDup = tempnam(sys_get_temp_dir(), 'decedent_dup_test_');
$duplicateCsv = implode("\r\n", [
    "First Name,Last Name,Date of Birth,Date of Death,Is Cremated",
    "UNIQUE_FIRST,PERSON_ONE,1970-05-01,2022-05-01,yes",
    "DUPLICATE_NAME,DUPLICATE_LAST,1980-06-15,2023-06-15,yes", // First occurrence (Row 3)
    "ANOTHER_UNIQUE,PERSON_THREE,1975-07-10,2020-07-10,yes",
    "DUPLICATE_NAME,DUPLICATE_LAST,06/15/1980,2023-06-15,yes", // Duplicate of Row 3 with alternate date format! (Row 5)
]);
file_put_contents($tempFileDup, $duplicateCsv);

$previewDup = $importController->preview([
    'tmp_name' => $tempFileDup,
    'error' => UPLOAD_ERR_OK,
    'size' => filesize($tempFileDup),
]);
@unlink($tempFileDup);

assertTest("preview() parses duplicate test CSV", empty($previewDup['error']));
if (!empty($previewDup['rows']) && count($previewDup['rows']) === 4) {
    $r2 = $previewDup['rows'][0]; // Unique Person 1
    $r3 = $previewDup['rows'][1]; // Duplicate occurrence 1
    $r4 = $previewDup['rows'][2]; // Unique Person 3
    $r5 = $previewDup['rows'][3]; // Duplicate occurrence 2

    assertTest("Row 2 (Unique 1): status is 'ready'", $r2['status'] === 'ready');
    assertTest("Row 3 (Duplicate 1st occurrence): status is 'ready'", $r3['status'] === 'ready');
    assertTest("Row 4 (Unique 3): status is 'ready'", $r4['status'] === 'ready');
    assertTest("Row 5 (Duplicate 2nd occurrence): status is 'rejected'", $r5['status'] === 'rejected');

    $hasInFileError = false;
    foreach ($r5['errors'] as $err) {
        if (strpos($err, 'Duplicate entry within this file') !== false && strpos($err, 'row 3') !== false) {
            $hasInFileError = true;
        }
    }
    assertTest("Row 5 reports in-file duplicate matching row 3", $hasInFileError, "Errors: " . implode('; ', $r5['errors']));
}

echo "\n=======================================================\n";
echo "BATCH 2 RESULTS: {$passedTests}/{$totalTests} PASSED";
if ($failedTests > 0) {
    echo " ({$failedTests} FAILED)";
}
echo "\n=======================================================\n";

exit($failedTests === 0 ? 0 : 1);
