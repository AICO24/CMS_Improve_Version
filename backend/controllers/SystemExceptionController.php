<?php
require_once __DIR__ . '/../models/SystemException.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/DecedentRequest.php';
require_once __DIR__ . '/DecedentRequestController.php';

class SystemExceptionController {
    private $exceptionModel;
    private $auditLogModel;

    public function __construct() {
        $this->exceptionModel = new SystemException();
        $this->auditLogModel = new AuditLog();
    }

    public function index($filters = []) {
        return $this->exceptionModel->findAll($filters);
    }

    public function resolve($id, $data, $user) {
        $exception = $this->exceptionModel->findById($id);
        if (!$exception) {
            return ['error' => 'Exception not found', 'code' => 404];
        }
        if ($exception['status'] !== 'open') {
            return ['error' => 'This exception has already been resolved', 'code' => 409];
        }

        $resolvedBy = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $notes = trim((string) ($data['resolution_notes'] ?? ''));
        if ($notes === '') {
            return ['error' => 'resolution_notes is required', 'code' => 400];
        }

        $result = $this->exceptionModel->resolve($id, $resolvedBy, $notes);
        if ($result) {
            $this->auditLogModel->log(
                'Exception resolved',
                $resolvedBy,
                is_array($user) ? ($user['username'] ?? null) : null,
                $exception['entity_type'] ?? 'SystemException',
                $exception['entity_id'] ?? $id,
                ['exception_id' => (int) $id, 'event' => $exception['event'] ?? null, 'resolution_notes' => $notes]
            );
            return ['success' => true, 'message' => 'Exception resolved'];
        }
        return ['error' => 'Failed to resolve exception', 'code' => 500];
    }

    public function countOpen() {
        return ['open' => $this->exceptionModel->countOpen()];
    }

    // Automation opportunity G.7: re-attempts the automation that originally
    // raised this exception, instead of only ever recording a manual
    // decision. Deliberately NOT a generic "replay the original closure"
    // mechanism (that would need serializing arbitrary business logic) —
    // scoped to the one case that's safely and unambiguously re-derivable
    // from the exception row alone: a 'decedent_request.approved' exception
    // on a Schedule, where the schedule's own decedent_request_id points
    // straight back at the now-possibly-fixed source request. Any other
    // (event, entity_type) combination has no automatic retry defined —
    // returns a clear error rather than guessing, so an admin can still
    // resolve it manually (existing behavior, unchanged).
    public function retry($id, $user) {
        $exception = $this->exceptionModel->findById($id);
        if (!$exception) {
            return ['error' => 'Exception not found', 'code' => 404];
        }
        if ($exception['status'] !== 'open') {
            return ['error' => 'This exception has already been resolved', 'code' => 409];
        }

        if ($exception['event'] === 'decedent_request.approved' && $exception['entity_type'] === 'Schedule') {
            return $this->retryDecedentRequestApproved($exception, $user);
        }

        return ['error' => 'No automatic retry is available for this exception type — resolve it manually.', 'code' => 422];
    }

    private function retryDecedentRequestApproved($exception, $user) {
        $scheduleModel = new Schedule();
        $schedule = $scheduleModel->findById($exception['entity_id']);
        if (!$schedule || empty($schedule['decedent_request_id'])) {
            return ['error' => 'Cannot retry automatically: the originating decedent request can no longer be found. Resolve manually.', 'code' => 409];
        }

        $requestModel = new DecedentRequest();
        $request = $requestModel->findById($schedule['decedent_request_id']);
        if (!$request || $request['status'] !== 'approved' || empty($request['decedent_id'])) {
            return ['error' => 'Cannot retry automatically: the source decedent request is not in an approved state. Resolve manually.', 'code' => 409];
        }

        $decedentRequestController = new DecedentRequestController();
        $result = $decedentRequestController->retryLinkSchedule((int) $exception['entity_id'], (int) $request['decedent_id'], $user);
        if (empty($result['success'])) {
            return ['error' => $result['error'] ?? 'Retry failed.', 'code' => $result['code'] ?? 409];
        }

        $resolvedBy = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $this->exceptionModel->resolve($exception['exception_id'], $resolvedBy, 'Auto-resolved: retry succeeded (decedent record linked).');
        $this->auditLogModel->log(
            'Exception retried and resolved',
            $resolvedBy,
            is_array($user) ? ($user['username'] ?? null) : null,
            $exception['entity_type'] ?? 'SystemException',
            $exception['entity_id'] ?? $exception['exception_id'],
            ['exception_id' => (int) $exception['exception_id'], 'event' => $exception['event'] ?? null]
        );

        return ['success' => true, 'message' => 'Retried successfully — decedent record linked and exception resolved'];
    }
}
