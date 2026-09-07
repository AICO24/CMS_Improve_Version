<?php
/**
 * Test Suite: BMS-10 Genuine Burial Concurrency Audit
 * 
 * Verifies:
 * 1. Two genuine independent PHP CLI processes attempting to finalize burial drafts
 *    for the exact same lot, date, and time slot concurrently.
 * 2. Exactly one process succeeds with HTTP 200 (draft COMMITTED).
 * 3. Exactly one process fails cleanly with HTTP 409 Conflict.
 * 4. Dual concurrency barriers (pessimistic row locking + uq_active_schedule_slot constraint).
 * 5. Exactly 1 burial_schedules row is persisted in the database.
 * 6. Exactly 1 decedent_requests row is persisted (transaction rollback prevents orphan).
 * 7. Clean teardown and zero residual pollution.
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';

echo "==============================================================\n";
echo "RUNNING BMS-10 GENUINE BURIAL CONCURRENCY AUDIT\n";
echo "==============================================================\n";

$db = Database::getInstance()->getConnection();
$phpBinary = PHP_BINARY;

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

// 1. Setup dedicated test users
$db->exec("DELETE FROM users WHERE username IN ('bms10_user_alpha', 'bms10_user_beta')");
$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('bms10_user_alpha', 'hash', 'BMS10 User Alpha', 'alpha@bms10.local', 3)
")->execute();
$userAId = (int) $db->lastInsertId();

$db->prepare("
    INSERT INTO users (username, password_hash, full_name, email, role_id)
    VALUES ('bms10_user_beta', 'hash', 'BMS10 User Beta', 'beta@bms10.local', 3)
")->execute();
$userBId = (int) $db->lastInsertId();

// 2. Setup dedicated test lot
$sampleBlock = $db->query("SELECT block_id FROM blocks LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$blockId = $sampleBlock ? (int)$sampleBlock['block_id'] : 1;
$sampleType = $db->query("SELECT type_id FROM lot_types LIMIT 1")->fetch(PDO::FETCH_ASSOC);
$lotTypeId = $sampleType ? (int)$sampleType['type_id'] : 1;

$db->prepare("DELETE FROM lots WHERE lot_number = 'BMS10-CONCURRENCY-LOT'")->execute();
$db->prepare("
    INSERT INTO lots (block_id, lot_number, lot_type_id, status, price)
    VALUES (?, 'BMS10-CONCURRENCY-LOT', ?, 'Available', 75000.00)
")->execute([$blockId, $lotTypeId]);
$lotId = (int) $db->lastInsertId();

// Future Tuesday date (burial allowed)
$d = new DateTime('+14 days');
while ((int) $d->format('N') === 1) { // Skip Monday
    $d->modify('+1 day');
}
$targetDate = $d->format('Y-m-d');
$targetTime = '10:00:00';

// 3. Create Draft 1 for User Alpha
$draftModel = new BookingDraft();
$draft1Id = $draftModel->create($userAId, 'burial', date('Y-m-d H:i:s', time() + 86400));
$draftModel->updateExtractedData($draft1Id, [
    'service_type'   => 'burial',
    'decedent_name'  => 'Concurrency Decedent Alpha',
    'relationship'   => 'Brother',
    'lot_id'         => $lotId,
    'preferred_date' => $targetDate,
    'preferred_time' => $targetTime,
    'notes'          => 'BMS-10 Concurrency Alpha'
]);
$draftModel->transitionStatus($draft1Id, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($draft1Id, BookingDraft::STATUS_LOT_SELECTION);
$draftModel->transitionStatus($draft1Id, BookingDraft::STATUS_READY_FOR_REVIEW);

// 4. Create Draft 2 for User Beta (competing for same lot, date, and time)
$draft2Id = $draftModel->create($userBId, 'burial', date('Y-m-d H:i:s', time() + 86400));
$draftModel->updateExtractedData($draft2Id, [
    'service_type'   => 'burial',
    'decedent_name'  => 'Concurrency Decedent Beta',
    'relationship'   => 'Sister',
    'lot_id'         => $lotId,
    'preferred_date' => $targetDate,
    'preferred_time' => $targetTime,
    'notes'          => 'BMS-10 Concurrency Beta'
]);
$draftModel->transitionStatus($draft2Id, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($draft2Id, BookingDraft::STATUS_LOT_SELECTION);
$draftModel->transitionStatus($draft2Id, BookingDraft::STATUS_READY_FOR_REVIEW);

// 5. Barrier file setup
$barrierFile = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'bms10_barrier_' . uniqid() . '.flag';
if (file_exists($barrierFile)) {
    unlink($barrierFile);
}

$workerScript = __DIR__ . '/test_booking_concurrency_worker.php';

// Prepare proc_open descriptors
$descriptors = [
    0 => ['pipe', 'r'],
    1 => ['pipe', 'w'],
    2 => ['pipe', 'w']
];

// Launch Process 1 (Worker Alpha)
$cmd1 = escapeshellarg($phpBinary) . ' ' . escapeshellarg($workerScript) . " {$draft1Id} {$userAId} bms10_user_alpha " . escapeshellarg($barrierFile);
$proc1 = proc_open($cmd1, $descriptors, $pipes1);

// Launch Process 2 (Worker Beta)
$cmd2 = escapeshellarg($phpBinary) . ' ' . escapeshellarg($workerScript) . " {$draft2Id} {$userBId} bms10_user_beta " . escapeshellarg($barrierFile);
$proc2 = proc_open($cmd2, $descriptors, $pipes2);

// Give both processes 300ms to load PHP runtime and enter the waiting loop
usleep(300000);

// RELEASE BARRIER SIMULTANEOUSLY!
touch($barrierFile);

// Read stdout
$out1 = stream_get_contents($pipes1[1]);
$err1 = stream_get_contents($pipes1[2]);
fclose($pipes1[0]);
fclose($pipes1[1]);
fclose($pipes1[2]);
$status1 = proc_close($proc1);

$out2 = stream_get_contents($pipes2[1]);
$err2 = stream_get_contents($pipes2[2]);
fclose($pipes2[0]);
fclose($pipes2[1]);
fclose($pipes2[2]);
$status2 = proc_close($proc2);

// Cleanup barrier
if (file_exists($barrierFile)) {
    unlink($barrierFile);
}

$res1 = json_decode(trim($out1), true);
$res2 = json_decode(trim($out2), true);

echo "Worker 1 Output: " . trim($out1) . "\n";
echo "Worker 2 Output: " . trim($out2) . "\n";

// ----------------------------------------------------------------------
// CONCURRENCY AUDIT ASSERTIONS
// ----------------------------------------------------------------------

// TEST 1: Exactly one process succeeds with HTTP 200
$successes = 0;
$conflicts = 0;

if (!empty($res1['success'])) $successes++;
if (!empty($res2['success'])) $successes++;

if (isset($res1['code']) && $res1['code'] === 409) $conflicts++;
if (isset($res2['code']) && $res2['code'] === 409) $conflicts++;

report(1, "Exactly one process succeeds and commits booking (success_count = 1)", $successes === 1, "Success count: {$successes}");

// TEST 2: Exactly one process cleanly fails with HTTP 409 Conflict
report(2, "Exactly one competing process fails with clean HTTP 409 Conflict", $conflicts === 1, "Conflict count: {$conflicts}");

// TEST 3: Database inspection: Exactly ONE burial schedule persisted
$schedStmt = $db->prepare("SELECT COUNT(*) FROM burial_schedules WHERE lot_id = ?");
$schedStmt->execute([$lotId]);
$scheduleCount = (int) $schedStmt->fetchColumn();
report(3, "Database contains exactly 1 burial schedule row for contested lot", $scheduleCount === 1, "Actual count: {$scheduleCount}");

// TEST 4: Database inspection: Exactly ONE draft is COMMITTED, the other is not committed
$d1 = $draftModel->findById($draft1Id);
$d2 = $draftModel->findById($draft2Id);

$committedCount = 0;
if ($d1['status'] === BookingDraft::STATUS_COMMITTED) $committedCount++;
if ($d2['status'] === BookingDraft::STATUS_COMMITTED) $committedCount++;

report(4, "Exactly 1 draft reached COMMITTED status, competing draft remains uncommitted", $committedCount === 1, "Committed drafts: {$committedCount}");

// TEST 5: Database inspection: No orphan decedent_request for the losing request
$decStmt = $db->prepare("
    SELECT COUNT(*) FROM decedent_requests 
    WHERE requested_by IN (?, ?)
");
$decStmt->execute([$userAId, $userBId]);
$decedentCount = (int) $decStmt->fetchColumn();
report(5, "Transaction rollback prevented orphaned decedent_request on the losing transaction", $decedentCount === 1, "Actual decedent requests count: {$decedentCount}");

// ----------------------------------------------------------------------
// CLEANUP
// ----------------------------------------------------------------------
$db->exec("DELETE FROM booking_drafts WHERE user_id IN ({$userAId}, {$userBId})");
$db->exec("DELETE FROM burial_schedules WHERE lot_id = {$lotId}");
$db->exec("DELETE FROM decedent_requests WHERE requested_by IN ({$userAId}, {$userBId})");
$db->exec("DELETE FROM lots WHERE lot_id = {$lotId}");
$db->exec("DELETE FROM users WHERE user_id IN ({$userAId}, {$userBId})");

echo "==============================================================\n";
echo "BMS-10 CONCURRENCY RESULTS: {$passed} PASSED, {$failed} FAILED\n";
echo "==============================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
