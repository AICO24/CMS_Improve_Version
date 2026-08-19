<?php
require_once __DIR__ . '/../models/DecedentRequest.php';
require_once __DIR__ . '/../models/Decedent.php';

class DecedentRequestController {
    private $requestModel;
    private $decedentModel;

    public function __construct() {
        $this->requestModel = new DecedentRequest();
        $this->decedentModel = new Decedent();
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
        $result = $this->requestModel->approve($id, $data['decedent_id'], $reviewerId);
        return $result ? ['success' => true, 'message' => 'Request approved'] : ['error' => 'Failed to approve request', 'code' => 500];
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
        $result = $this->requestModel->reject($id, $data['rejection_reason'], $reviewerId);
        return $result ? ['success' => true, 'message' => 'Request rejected'] : ['error' => 'Failed to reject request', 'code' => 500];
    }
}
