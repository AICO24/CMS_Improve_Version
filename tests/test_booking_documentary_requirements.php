<?php
/**
 * Test Suite: Booking Documentary Requirements Submission (Technical Adviser Item #3)
 * 
 * Verifies:
 * 1. uploadDocument rejects invalid document types
 * 2. uploadDocument saves uploaded files (death_certificate, burial_permit, valid_id)
 * 3. getDocuments returns complete checklist and status
 * 4. deleteDocument cleanly removes document and updates draft
 * 5. Finalize draft automatically hooks Death Certificate attachment into provisional decedent_requests
 * 
 * Run:
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_booking_documentary_requirements.php
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/models/DecedentRequest.php';

$passed = 0;
$failed = 0;

function report($testNum, $title, $success, $details = '') {
    global $passed, $failed;
    if ($success) {
        $passed++;
        echo "[PASS] TEST {$testNum}: {$title}\n";
    } else {
        $failed++;
        echo "[FAIL] TEST {$testNum}: {$title}" . ($details ? " — {$details}" : '') . "\n";
    }
}

$db = Database::getInstance()->getConnection();
$agentController = new BookingAgentController();
$agentService = new BookingAgentService();
$draftModel = new BookingDraft();
$decedentRequestModel = new DecedentRequest();

// Get a test user
$userCitizen = $db->query("SELECT user_id, username FROM users WHERE role_id = (SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1) LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if (!$userCitizen) {
    $db->prepare("INSERT INTO users (username, password_hash, full_name, email, role_id, is_active) VALUES ('doc_test_user', 'x', 'Doc Tester', 'doc@test.com', 2, 1)")->execute();
    $userId = (int) $db->lastInsertId();
    $userCitizen = ['user_id' => $userId, 'username' => 'doc_test_user', 'role' => 'user'];
} else {
    $userId = (int) $userCitizen['user_id'];
    $userCitizen['role'] = 'user';
}

// Clean up previous test drafts
$db->prepare("DELETE FROM booking_drafts WHERE user_id = ? AND status = 'DRAFT_STARTED'")->execute([$userId]);

// Create fresh test draft
$expiresAt = date('Y-m-d H:i:s', time() + 86400);
$draftId = $draftModel->create($userId, 'burial', $expiresAt);
$draftModel->updateExtractedData($draftId, [
    'decedent_name' => 'Amador Test Decedent',
    'relationship' => 'Brother',
    'preferred_date' => '2026-11-20',
    'lot_id' => 101
]);

// Helper to create a dummy test file
function createDummyFile($filename, $content = 'Dummy PDF document content for testing') {
    $tempDir = sys_get_temp_dir();
    $tempPath = $tempDir . DIRECTORY_SEPARATOR . $filename;
    file_put_contents($tempPath, $content);
    return [
        'name'     => $filename,
        'type'     => 'application/pdf',
        'tmp_name' => $tempPath,
        'error'    => UPLOAD_ERR_OK,
        'size'     => strlen($content)
    ];
}

// Minimal valid PDF binary header
$dummyPdfBytes = "%PDF-1.4\n%âãÏÓ\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj 2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj 3 0 obj<</Type/Page/MediaBox[0 0 612 792]>>endobj\nxref\n0 4\n0000000000 65535 f \n0000000015 00000 n \n0000000060 00000 n \n0000000111 00000 n \ntrailer<</Size 4/Root 1 0 R>>\nstartxref\n178\n%%EOF";

// TEST 1: Rejects invalid document type
$dummyFile = createDummyFile('test_doc.pdf', $dummyPdfBytes);
$res1 = $agentController->uploadDocument($draftId, 'invalid_type', $dummyFile, $userCitizen);
report(1, 'Rejects invalid document type with HTTP 400', !empty($res1['error']) && ($res1['code'] ?? 0) === 400, json_encode($res1));

// TEST 2: Rejects upload without authentication
$res2 = $agentController->uploadDocument($draftId, 'death_certificate', $dummyFile, null);
report(2, 'Rejects unauthenticated upload request with HTTP 401', !empty($res2['error']) && ($res2['code'] ?? 0) === 401, json_encode($res2));

// TEST 3: Uploads Death Certificate successfully
$dummyDeathCert = createDummyFile('death_certificate_amador.pdf', $dummyPdfBytes);
$res3 = $agentController->uploadDocument($draftId, 'death_certificate', $dummyDeathCert, $userCitizen);
$t3Success = !empty($res3['success']) && !empty($res3['file_path']) && !empty($res3['documents']['death_certificate']);
report(3, 'Uploads Death Certificate and records in draft documents', $t3Success, json_encode($res3));

// TEST 4: Uploads Burial Permit successfully
$dummyPermit = createDummyFile('burial_permit_amador.pdf', $dummyPdfBytes);
$res4 = $agentController->uploadDocument($draftId, 'burial_permit', $dummyPermit, $userCitizen);
$t4Success = !empty($res4['success']) && !empty($res4['documents']['burial_permit']);
report(4, 'Uploads Burial Permit and records in draft documents', $t4Success, json_encode($res4));

// TEST 5: Uploads Valid ID successfully
$dummyId = createDummyFile('valid_id_claimant.pdf', $dummyPdfBytes);
$res5 = $agentController->uploadDocument($draftId, 'valid_id', $dummyId, $userCitizen);
$t5Success = !empty($res5['success']) && !empty($res5['documents']['valid_id']);
report(5, 'Uploads Valid ID and records in draft documents', $t5Success, json_encode($res5));

// TEST 6: getDocuments returns all 3 documents as uploaded with all_uploaded = true
$res6 = $agentController->getDocuments($draftId, $userCitizen);
$t6Success = !empty($res6['success']) && ($res6['uploaded_count'] ?? 0) === 3 && !empty($res6['all_uploaded']);
report(6, 'getDocuments returns 3/3 requirements fulfilled with all_uploaded=true', $t6Success, json_encode($res6));

// TEST 7: deleteDocument removes the specified document
$res7 = $agentController->deleteDocument($draftId, 'valid_id', $userCitizen);
$res7Get = $agentController->getDocuments($draftId, $userCitizen);
$t7Success = !empty($res7['success']) && ($res7Get['uploaded_count'] ?? 0) === 2 && empty($res7Get['documents'][2]['uploaded']);
report(7, 'deleteDocument removes document and updates requirements status to 2/3', $t7Success, json_encode($res7Get));

// TEST 8: Re-uploading Death Certificate overwrites existing and updates draft
$dummyDeathCertV2 = createDummyFile('death_certificate_amador_v2.pdf', $dummyPdfBytes);
$res8 = $agentController->uploadDocument($draftId, 'death_certificate', $dummyDeathCertV2, $userCitizen);
$t8Success = !empty($res8['success']) && strpos($res8['original_filename'], 'v2') !== false;
report(8, 'Re-uploading replaces existing Death Certificate cleanly', $t8Success, json_encode($res8));

// TEST 9: Finalize burial draft attaches uploaded Death Certificate to provisional decedent request
// Pick an available lot without active leases
$availableLot = (int) ($db->query("SELECT lot_id FROM lots WHERE status = 'Available' ORDER BY lot_id DESC LIMIT 1")->fetchColumn() ?: 101);
$db->prepare("DELETE FROM payments WHERE reference_kind = 'lot' AND reference_id = ?")->execute([$availableLot]);
$db->prepare("DELETE FROM burial_schedules WHERE lot_id = ? AND schedule_date = '2026-11-20'")->execute([$availableLot]);
$draftModel->updateExtractedData($draftId, [
    'service_type' => 'burial',
    'lot_id' => $availableLot,
    'preferred_date' => '2026-11-20',
    'status' => 'Pending'
]);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_COLLECTING_INFO);
$draftModel->transitionStatus($draftId, BookingDraft::STATUS_READY_FOR_REVIEW);

$finalizeRes = $agentService->finalizeBurialDraft($draftId, $userId, 'doc_test_user', $userCitizen);
$t9Success = false;
$attachedReq = null;
if (!empty($finalizeRes['success'])) {
    $attachedReq = $db->query("SELECT request_id, full_name, attachment_path, attachment_original_filename FROM decedent_requests WHERE notes LIKE '%Draft #{$draftId}%' ORDER BY request_id DESC LIMIT 1")->fetch(PDO::FETCH_ASSOC);
    $t9Success = !empty($attachedReq['attachment_path']) && strpos($attachedReq['attachment_original_filename'], 'v2') !== false;
}
report(9, 'Finalized booking automatically attaches Death Certificate to provisional decedent request', $t9Success, json_encode(['finalize' => $finalizeRes, 'attachedReq' => $attachedReq]));

// TEST 10: Reject uploading to a committed draft
$dummyAfterCommit = createDummyFile('after_commit.pdf', $dummyPdfBytes);
$res10 = $agentController->uploadDocument($draftId, 'valid_id', $dummyAfterCommit, $userCitizen);
$t10Success = !empty($res10['error']) && empty($res10['success']);
report(10, 'Rejects document upload to committed draft', $t10Success, json_encode($res10));

// Summary
echo "\n======================================================\n";
echo "Booking Documentary Requirements Tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";

if ($failed > 0) {
    exit(1);
}
exit(0);
