<?php
/**
 * CMS DECEDENT RECORDS AUTOMATION AUDIT - BATCH 4 TEST SUITE
 *
 * Tests:
 * 1. Batch ID Generation on confirmImport()
 * 2. Aggregate AuditLog generation for successful batch import
 * 3. SystemException and AuditLog integration on partial failure
 * 4. Error isolation & per-row failure reporting
 */

require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/Decedent.php';
require_once __DIR__ . '/../backend/models/AuditLog.php';
require_once __DIR__ . '/../backend/models/SystemException.php';
require_once __DIR__ . '/../backend/controllers/DecedentImportController.php';

$totalPassed = 0;
$totalFailed = 0;

function assertTest($description, $condition, &$totalPassed, &$totalFailed) {
    if ($condition) {
        echo "  [PASS] " . $description . "\n";
        $totalPassed++;
    } else {
        echo "  [FAIL] " . $description . "\n";
        $totalFailed++;
    }
}

echo "=======================================================\n";
echo "BATCH 4: BATCH AUDIT LOGGING & EXCEPTION INTEGRATION\n";
echo "=======================================================\n\n";

$db = Database::getInstance()->getConnection();
$importController = new DecedentImportController();

$actor = [
    'user_id' => 1,
    'username' => 'test_admin',
];

$testSuffix = time() . '_' . bin2hex(random_bytes(2));

// ----------------------------------------------------------------------
// Group 1: Clean Batch Import & Aggregate Audit Log
// ----------------------------------------------------------------------
echo "Group 1: Clean Batch Import & Aggregate Audit Log\n";

$cleanRows = [
    [
        'row_number' => 1,
        'data' => [
            'first_name' => 'BatchTestOne',
            'last_name' => 'CleanRecord_' . $testSuffix,
            'middle_name' => null,
            'suffix' => null,
            'dob' => '1960-01-01',
            'dod' => '2023-01-01',
            'is_cremated' => 'yes',
            'ash_storage' => 'Columbarium A-' . $testSuffix,
            'cause_of_death' => 'Natural',
        ]
    ]
];

$resultClean = $importController->confirmImport($cleanRows, $actor);

assertTest("confirmImport returns success", !empty($resultClean['success']), $totalPassed, $totalFailed);
assertTest("Batch ID generated and formatted as BATCH-*", !empty($resultClean['import_batch_id']) && str_starts_with($resultClean['import_batch_id'], 'BATCH-'), $totalPassed, $totalFailed);
assertTest("Imported count is 1", ($resultClean['imported'] ?? 0) === 1, $totalPassed, $totalFailed);
assertTest("Failed count is 0", empty($resultClean['failed']), $totalPassed, $totalFailed);
assertTest("Created IDs array returned", !empty($resultClean['created_ids']) && count($resultClean['created_ids']) === 1, $totalPassed, $totalFailed);

$batchId1 = $resultClean['import_batch_id'];
$createdId1 = $resultClean['created_ids'][0] ?? null;

// Verify aggregate audit log in database
$stmtAudit = $db->prepare("SELECT * FROM audit_logs WHERE action = 'Decedent batch import completed' AND entity_type = 'DecedentImport' ORDER BY log_id DESC LIMIT 1");
$stmtAudit->execute();
$auditRow = $stmtAudit->fetch();

assertTest("Aggregate audit log created in database", !empty($auditRow), $totalPassed, $totalFailed);
if (!empty($auditRow)) {
    $details = json_decode($auditRow['details'] ?? '{}', true);
    assertTest("Audit log details contain matching batch ID", ($details['import_batch_id'] ?? '') === $batchId1, $totalPassed, $totalFailed);
    assertTest("Audit log details record imported_count = 1", ($details['imported_count'] ?? null) === 1, $totalPassed, $totalFailed);
    assertTest("Audit log details record failed_count = 0", ($details['failed_count'] ?? null) === 0, $totalPassed, $totalFailed);
}

// ----------------------------------------------------------------------
// Group 2: Partial Failure Handling & SystemException Raising
// ----------------------------------------------------------------------
echo "\nGroup 2: Partial Failure Handling & SystemException Raising\n";

$mixedRows = [
    // Valid cremation row
    [
        'row_number' => 2,
        'data' => [
            'first_name' => 'BatchTestTwo',
            'last_name' => 'ValidPart_' . $testSuffix,
            'dob' => '1970-05-15',
            'dod' => '2024-02-10',
            'is_cremated' => 'yes',
            'ash_storage' => 'Columbarium B-' . $testSuffix,
        ]
    ],
    // Invalid row (invalid dates: DOD before DOB)
    [
        'row_number' => 3,
        'data' => [
            'first_name' => 'BatchTestThree',
            'last_name' => 'InvalidPart_' . $testSuffix,
            'dob' => '2024-01-01',
            'dod' => '1950-01-01', // DOD before DOB
            'is_cremated' => 'yes',
        ]
    ]
];

$resultMixed = $importController->confirmImport($mixedRows, $actor);

assertTest("Mixed import succeeds partially", !empty($resultMixed['success']), $totalPassed, $totalFailed);
assertTest("Mixed import generates new unique batch ID", !empty($resultMixed['import_batch_id']) && $resultMixed['import_batch_id'] !== $batchId1, $totalPassed, $totalFailed);
assertTest("Imported count is 1 for valid row", ($resultMixed['imported'] ?? 0) === 1, $totalPassed, $totalFailed);
assertTest("Failed count is 1 for invalid row", count($resultMixed['failed'] ?? []) === 1, $totalPassed, $totalFailed);
assertTest("Failed row reports row_number 3", ($resultMixed['failed'][0]['row_number'] ?? null) === 3, $totalPassed, $totalFailed);

$batchId2 = $resultMixed['import_batch_id'];
$createdId2 = $resultMixed['created_ids'][0] ?? null;

// Verify partial failure audit log
$stmtAuditErr = $db->prepare("SELECT * FROM audit_logs WHERE action = 'Decedent batch import completed with errors' AND entity_type = 'DecedentImport' ORDER BY log_id DESC LIMIT 1");
$stmtAuditErr->execute();
$auditErrRow = $stmtAuditErr->fetch();

assertTest("Audit log recorded 'completed with errors' action", !empty($auditErrRow), $totalPassed, $totalFailed);
if (!empty($auditErrRow)) {
    $errDetails = json_decode($auditErrRow['details'] ?? '{}', true);
    assertTest("Audit log records matching batch ID 2", ($errDetails['import_batch_id'] ?? '') === $batchId2, $totalPassed, $totalFailed);
    assertTest("Audit log records failed_count = 1", ($errDetails['failed_count'] ?? null) === 1, $totalPassed, $totalFailed);
}

// Verify SystemException raised in database
$stmtExc = $db->prepare("SELECT * FROM system_exceptions WHERE event = 'decedent.import_partial_failure' AND entity_type = 'DecedentImport' ORDER BY exception_id DESC LIMIT 1");
$stmtExc->execute();
$excRow = $stmtExc->fetch();

assertTest("SystemException raised for partial failure", !empty($excRow), $totalPassed, $totalFailed);
if (!empty($excRow)) {
    assertTest("SystemException reason mentions batch ID", strpos($excRow['reason'] ?? '', $batchId2) !== false, $totalPassed, $totalFailed);
    assertTest("SystemException status is 'open'", ($excRow['status'] ?? '') === 'open', $totalPassed, $totalFailed);
}

// ----------------------------------------------------------------------
// CLEANUP TEST RECORDS
// ----------------------------------------------------------------------
if ($createdId1) {
    $db->prepare("DELETE FROM decedent_records WHERE decedent_id = ?")->execute([$createdId1]);
}
if ($createdId2) {
    $db->prepare("DELETE FROM decedent_records WHERE decedent_id = ?")->execute([$createdId2]);
}
if (!empty($excRow['exception_id'])) {
    $db->prepare("DELETE FROM system_exceptions WHERE exception_id = ?")->execute([$excRow['exception_id']]);
}

// Summary
echo "\n=======================================================\n";
echo sprintf("BATCH 4 RESULTS: %d/%d PASSED\n", $totalPassed, $totalPassed + $totalFailed);
echo "=======================================================\n";

if ($totalFailed > 0) {
    exit(1);
}
exit(0);
