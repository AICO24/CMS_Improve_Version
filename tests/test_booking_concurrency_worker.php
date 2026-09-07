<?php
/**
 * Concurrency Worker for BMS-10
 * Invoked concurrently by test_booking_concurrency_bms10.php
 */

require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';

$draftId = isset($argv[1]) ? (int) $argv[1] : 0;
$userId = isset($argv[2]) ? (int) $argv[2] : 0;
$username = isset($argv[3]) ? (string) $argv[3] : 'user';
$barrierFile = isset($argv[4]) ? (string) $argv[4] : '';

if ($draftId <= 0 || $userId <= 0 || empty($barrierFile)) {
    echo json_encode(['success' => false, 'error' => 'Invalid worker arguments']);
    exit(1);
}

$service = new BookingAgentService();
$userContext = ['user_id' => $userId, 'username' => $username, 'role' => 'user'];

// Wait for barrier trigger from parent orchestrator
$timeout = time() + 10;
while (!file_exists($barrierFile) && time() < $timeout) {
    usleep(500); // 0.5ms wait
}

// Barrier released! Execute finalization concurrently
try {
    $result = $service->finalizeBurialDraft($draftId, $userId, $username, $userContext);
    echo json_encode([
        'success'             => true,
        'draft_id'            => $draftId,
        'status'              => $result['status'] ?? null,
        'committed_record_id' => $result['committed_record_id'] ?? null,
        'code'                => 200
    ]);
    exit(0);
} catch (BookingDraftException $e) {
    echo json_encode([
        'success'    => false,
        'draft_id'   => $draftId,
        'error'      => $e->getMessage(),
        'error_type' => $e->getErrorType(),
        'code'       => $e->getHttpCode()
    ]);
    exit(0);
} catch (Throwable $t) {
    echo json_encode([
        'success'  => false,
        'draft_id' => $draftId,
        'error'    => $t->getMessage(),
        'code'     => 500
    ]);
    exit(0);
}
