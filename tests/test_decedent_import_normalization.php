<?php
/**
 * Test Suite: Decedent Import Normalization & Header Mapping (Batch 1)
 *
 * Verifies:
 * 1. matchHeaderToCanonical() maps real-world spreadsheet headers to internal canonical keys.
 * 2. normalizeDate() parses and standardizes diverse date formats (YYYY-MM-DD, MM/DD/YYYY, DD/MM/YYYY, etc.).
 * 3. normalizeName() converts ALL CAPS to Title Case and collapses whitespace.
 * 4. normalizePhone() cleans stray formatting.
 * 5. Full preview() end-to-end with a sample CSV with human headers and non-standard dates.
 */

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
echo "BATCH 1: DECEDENT IMPORT NORMALIZATION TEST SUITE\n";
echo "=======================================================\n\n";

// -----------------------------------------------------------------------------
// Group 1: Header Mapping & Synonym Resolution
// -----------------------------------------------------------------------------
echo "Group 1: Header Synonym Mapping\n";

$headerCases = [
    'first_name' => ['first_name', 'First Name', 'FIRSTNAME', 'given name', 'fname', 'First'],
    'last_name' => ['last_name', 'Last Name', 'LASTNAME', 'Surname', 'family name', 'lname'],
    'middle_name' => ['middle_name', 'Middle Name', 'M.I.', 'middle initial', 'mname'],
    'suffix' => ['suffix', 'Suffix', 'Generation', 'Ext'],
    'dob' => ['dob', 'DOB', 'Date of Birth', 'date_of_birth', 'Birth Date', 'birthdate', 'Born'],
    'dod' => ['dod', 'DOD', 'Date of Death', 'date_of_death', 'Death Date', 'date deceased', 'Died'],
    'lot_number' => ['lot_number', 'Lot Number', 'Lot No', 'lot #', 'Lot'],
    'section_name' => ['section_name', 'Section Name', 'Section', 'SEC'],
    'cause_of_death' => ['cause_of_death', 'Cause of Death', 'Cause', 'death cause'],
    'contact_name' => ['contact_name', 'Contact Name', 'Informant', 'Family Contact', 'Contact Person'],
    'contact_number' => ['contact_number', 'Contact Number', 'Phone Number', 'Mobile', 'Cellphone', 'Tel'],
    'is_cremated' => ['is_cremated', 'Is Cremated', 'Cremated', 'Cremation'],
    'ash_storage' => ['ash_storage', 'Ash Storage', 'Niche', 'Columbarium'],
];

foreach ($headerCases as $expectedCanonical => $variants) {
    foreach ($variants as $variant) {
        $mapped = DecedentImportController::matchHeaderToCanonical($variant);
        assertTest("Header '{$variant}' maps to '{$expectedCanonical}'", $mapped === $expectedCanonical, "Got: " . var_export($mapped, true));
    }
}

// UTF-8 BOM test
$bomHeader = "\xEF\xBB\xBFFirst Name";
$mappedBom = DecedentImportController::matchHeaderToCanonical($bomHeader);
assertTest("UTF-8 BOM header strips cleanly and maps to 'first_name'", $mappedBom === 'first_name', "Got: " . var_export($mappedBom, true));

echo "\n";

// -----------------------------------------------------------------------------
// Group 2: Date Normalization
// -----------------------------------------------------------------------------
echo "Group 2: Date Normalization\n";

$dateCases = [
    // Standard ISO
    ['1950-01-15', '1950-01-15'],
    ['2024-12-31', '2024-12-31'],
    // MM/DD/YYYY (Philippine / US standard)
    ['01/15/1950', '1950-01-15'],
    ['12/31/2024', '2024-12-31'],
    ['5/8/1985', '1985-05-08'],
    // DD/MM/YYYY (Day > 12 disambiguation)
    ['25/01/1950', '1950-01-25'],
    ['31/12/2024', '2024-12-31'],
    // YYYY/MM/DD and YYYY.MM.DD
    ['1950/01/15', '1950-01-15'],
    ['2024.12.31', '2024-12-31'],
    // Hyphenated MM-DD-YYYY
    ['01-15-1950', '1950-01-15'],
    ['25-01-1950', '1950-01-25'],
    // Textual dates
    ['January 15, 1950', '1950-01-15'],
    ['15 Jan 1950', '1950-01-15'],
    ['Dec 31, 2024', '2024-12-31'],
    // Invalid / garbage dates
    ['invalid-date', null],
    ['00/00/0000', null],
    ['1950-02-30', null], // Feb 30 does not exist
    ['', null],
];

foreach ($dateCases as [$input, $expected]) {
    $actual = DecedentImportController::normalizeDate($input);
    assertTest("Date '{$input}' normalizes to " . var_export($expected, true), $actual === $expected, "Got: " . var_export($actual, true));
}

echo "\n";

// -----------------------------------------------------------------------------
// Group 3: Name & Phone Normalization
// -----------------------------------------------------------------------------
echo "Group 3: Name & Phone Normalization\n";

$nameCases = [
    ['JUAN DELA CRUZ', 'Juan Dela Cruz'],
    ['MARIA CLARA SANTOS', 'Maria Clara Santos'],
    ['  Pedro   Penduko  ', 'Pedro Penduko'],
    ['Juan dela Cruz', 'Juan dela Cruz'], // Already mixed case preserved
    ['', ''],
    [null, null],
];

foreach ($nameCases as [$input, $expected]) {
    $actual = DecedentImportController::normalizeName($input);
    assertTest("Name '{$input}' normalizes to " . var_export($expected, true), $actual === $expected, "Got: " . var_export($actual, true));
}

$phoneCases = [
    ['0917-123-4567', '0917-123-4567'],
    ['+63 (917) 123 4567', '+63 (917) 123 4567'],
    ['09171234567 ext 12', '09171234567 12'],
    ['', null],
    [null, null],
];

foreach ($phoneCases as [$input, $expected]) {
    $actual = DecedentImportController::normalizePhone($input);
    assertTest("Phone '{$input}' normalizes to " . var_export($expected, true), $actual === $expected, "Got: " . var_export($actual, true));
}

echo "\n";

// -----------------------------------------------------------------------------
// Group 4: End-to-End preview() with Human-Friendly Headers & Mixed Dates
// -----------------------------------------------------------------------------
echo "Group 4: End-to-End preview() Integration\n";

$tempFile = tempnam(sys_get_temp_dir(), 'decedent_test_');
$csvContent = implode("\r\n", [
    "First Name,Last Name,Middle Name,Date of Birth,Date of Death,Lot Number,Section,Cause of Death,Informant,Contact Number",
    "JUAN,DELA CRUZ,SANTOS,01/15/1950,03/20/2020,1,Section A,Natural causes,MARIA DELA CRUZ,0917-111-2222",
    "Maria,Clara,,05/10/1960,12/15/2022,2,Section A,Cardiac Arrest,Pedro Santos,0918-333-4444",
]);
file_put_contents($tempFile, $csvContent);

$filePayload = [
    'tmp_name' => $tempFile,
    'error' => UPLOAD_ERR_OK,
    'size' => filesize($tempFile),
];

$importController = new DecedentImportController();
$previewResult = $importController->preview($filePayload);
@unlink($tempFile);

assertTest("preview() accepts CSV with human-friendly headers", !empty($previewResult['rows']) && empty($previewResult['error']), "Error: " . ($previewResult['error'] ?? 'none'));
assertTest("Total preview rows count is 2", ($previewResult['summary']['total'] ?? 0) === 2);

if (!empty($previewResult['rows'][0])) {
    $row1 = $previewResult['rows'][0];
    assertTest("Row 1: Name 'JUAN' title-cased to 'Juan'", $row1['data']['first_name'] === 'Juan', "Got: " . $row1['data']['first_name']);
    assertTest("Row 1: Last name 'DELA CRUZ' title-cased to 'Dela Cruz'", $row1['data']['last_name'] === 'Dela Cruz', "Got: " . $row1['data']['last_name']);
    assertTest("Row 1: DOB '01/15/1950' normalized to '1950-01-15'", $row1['data']['dob'] === '1950-01-15', "Got: " . $row1['data']['dob']);
    assertTest("Row 1: DOD '03/20/2020' normalized to '2020-03-20'", $row1['data']['dod'] === '2020-03-20', "Got: " . $row1['data']['dod']);
    assertTest("Row 1: Informant title-cased to 'Maria Dela Cruz'", $row1['data']['contact_name'] === 'Maria Dela Cruz', "Got: " . $row1['data']['contact_name']);
}

// Missing required columns test
$tempFileMissing = tempnam(sys_get_temp_dir(), 'decedent_missing_');
file_put_contents($tempFileMissing, "First Name,Last Name\r\nJuan,Dela Cruz\r\n");
$previewMissing = $importController->preview([
    'tmp_name' => $tempFileMissing,
    'error' => UPLOAD_ERR_OK,
    'size' => filesize($tempFileMissing),
]);
@unlink($tempFileMissing);

assertTest("preview() reports missing required columns with human labels", !empty($previewMissing['error']) && strpos($previewMissing['error'], 'Date of Birth') !== false, "Error: " . ($previewMissing['error'] ?? 'none'));

echo "\n=======================================================\n";
echo "BATCH 1 RESULTS: {$passedTests}/{$totalTests} PASSED";
if ($failedTests > 0) {
    echo " ({$failedTests} FAILED)";
}
echo "\n=======================================================\n";

exit($failedTests === 0 ? 0 : 1);
