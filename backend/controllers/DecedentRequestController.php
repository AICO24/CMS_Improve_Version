<?php
require_once __DIR__ . '/../models/DecedentRequest.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/AuditLog.php';

class DecedentRequestController {
    private $requestModel;
    private $decedentModel;
    private $auditLogModel;

    public function __construct() {
        $this->requestModel = new DecedentRequest();
        $this->decedentModel = new Decedent();
        $this->auditLogModel = new AuditLog();
    }

    public function index($status = null) {
        return $this->requestModel->findAll($status);
    }

    public function mine($userId) {
        return $this->requestModel->findByUser($userId);
    }

    public function store($data, $user) {
        if (empty($data['full_name'])) {
            return ['error' => 'full_name is required', 'code' => 400];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $requestId = $this->requestModel->create([
            'requested_by' => $userId,
            'full_name' => $data['full_name'],
            'approximate_dod' => $data['approximate_dod'] ?? null,
            'relationship' => $data['relationship'] ?? null,
            'notes' => $data['notes'] ?? null,
        ]);

        if ($requestId) {
            return ['success' => true, 'message' => 'Request submitted', 'request_id' => $requestId];
        }
        return ['error' => 'Failed to submit request', 'code' => 500];
    }

    public function approve($id, $data, $user) {
        $request = $this->requestModel->findById($id);
        if (!$request) {
            return ['error' => 'Request not found', 'code' => 404];
        }
        if ($request['status'] !== 'pending') {
            return ['error' => 'This request has already been reviewed', 'code' => 409];
        }
        if (empty($data['decedent_id'])) {
            return ['error' => 'decedent_id is required', 'code' => 400];
        }
        $decedent = $this->decedentModel->findById($data['decedent_id']);
        if (!$decedent) {
            return ['error' => 'That decedent record does not exist', 'code' => 404];
        }

        $reviewerId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $reviewerUsername = is_array($user) ? ($user['username'] ?? null) : null;
        $result = $this->requestModel->approve($id, $data['decedent_id'], $reviewerId);
        if ($result) {
            $this->auditLogModel->log(
                'Decedent request approved',
                $reviewerId,
                $reviewerUsername,
                'DecedentRequest',
                $id,
                ['full_name' => $request['full_name'] ?? null, 'linked_decedent_id' => (int) $data['decedent_id']]
            );
            return ['success' => true, 'message' => 'Request approved'];
        }
        return ['error' => 'Failed to approve request', 'code' => 500];
    }

    public function reject($id, $data, $user) {
        $request = $this->requestModel->findById($id);
        if (!$request) {
            return ['error' => 'Request not found', 'code' => 404];
        }
        if ($request['status'] !== 'pending') {
            return ['error' => 'This request has already been reviewed', 'code' => 409];
        }
        if (empty($data['rejection_reason'])) {
            return ['error' => 'rejection_reason is required', 'code' => 400];
        }

        $reviewerId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $reviewerUsername = is_array($user) ? ($user['username'] ?? null) : null;
        $result = $this->requestModel->reject($id, $data['rejection_reason'], $reviewerId);
        if ($result) {
            $this->auditLogModel->log(
                'Decedent request rejected',
                $reviewerId,
                $reviewerUsername,
                'DecedentRequest',
                $id,
                ['full_name' => $request['full_name'] ?? null, 'rejection_reason' => $data['rejection_reason']]
            );
            return ['success' => true, 'message' => 'Request rejected'];
        }
        return ['error' => 'Failed to reject request', 'code' => 500];
    }

    // Called by the chat assistant right after it shows a status line for
    // this request, so the same "still pending"/"has been added" message
    // doesn't repeat on every future chat load. Ownership-checked — a
    // citizen may only acknowledge their own request; admin/staff can
    // acknowledge any (mirrors how they can already see/act on any request).
    public function acknowledge($id, $user) {
        $request = $this->requestModel->findById($id);
        if (!$request) {
            return ['error' => 'Request not found', 'code' => 404];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if (!in_array($role, ['admin', 'staff'], true) && (int) $request['requested_by'] !== (int) $userId) {
            return ['error' => 'You may only acknowledge your own requests', 'code' => 403];
        }

        $result = $this->requestModel->markNotified($id, $request['status']);
        if ($result) {
            $this->auditLogModel->log(
                'Decedent request acknowledged',
                $userId,
                is_array($user) ? ($user['username'] ?? null) : null,
                'DecedentRequest',
                $id,
                ['status' => $request['status']]
            );
            return ['success' => true];
        }
        return ['error' => 'Failed to acknowledge request', 'code' => 500];
    }
}
