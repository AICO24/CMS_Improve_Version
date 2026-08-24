<?php
require_once __DIR__ . '/../models/Relocation.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/AuditLog.php';

class RelocationController {
    private $relocationModel;
    private $lotModel;
    private $decedentModel;
    private $auditLogModel;

    public function __construct() {
        $this->relocationModel = new Relocation();
        $this->lotModel = new Lot();
        $this->decedentModel = new Decedent();
        $this->auditLogModel = new AuditLog();
    }

    public function index($filters = [], $pagination = []) {
        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;

        if ($page === null && $perPage === null) {
            return $this->relocationModel->findAll($filters);
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $total = $this->relocationModel->countAll($filters);
        $data = $this->relocationModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);

        return [
            'data' => $data,
            'meta' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'total_pages' => (int) ceil($total / $perPage),
            ],
        ];
    }

    public function show($id) {
        $request = $this->relocationModel->findById($id);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        return $request;
    }

    public function store($data, $userId) {
        $required = ['from_lot_id', 'to_lot_id', 'deceased_id', 'reason'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        $fromLot = $this->lotModel->findById($data['from_lot_id']);
        $toLot = $this->lotModel->findById($data['to_lot_id']);
        if (!$fromLot || !$toLot) {
            return ['error' => 'One or both lots not found', 'code' => 404];
        }

        $decedent = $this->decedentModel->findById($data['deceased_id']);
        if (!$decedent) {
            return ['error' => 'Decedent not found', 'code' => 404];
        }

        if ($toLot['status'] !== 'Available') {
            return ['error' => 'Destination lot is not available', 'code' => 409];
        }

        $data['requested_by'] = $userId;
        $result = $this->relocationModel->create($data);
        return $result ? ['success' => true, 'message' => 'Relocation request created'] : ['error' => 'Failed to create relocation request', 'code' => 500];
    }

    public function update($id, $data, $userId) {
        $existing = $this->relocationModel->findById($id);
        if (!$existing) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }

        if ($existing['status'] !== 'Pending') {
            return ['error' => 'Cannot update a request that is already processed', 'code' => 403];
        }

        if (isset($data['from_lot_id']) && $data['from_lot_id'] != $existing['from_lot_id']) {
            $fromLot = $this->lotModel->findById($data['from_lot_id']);
            if (!$fromLot) {
                return ['error' => 'Source lot not found', 'code' => 404];
            }
        }

        if (isset($data['to_lot_id']) && $data['to_lot_id'] != $existing['to_lot_id']) {
            $toLot = $this->lotModel->findById($data['to_lot_id']);
            if (!$toLot) {
                return ['error' => 'Destination lot not found', 'code' => 404];
            }
            if ($toLot['status'] !== 'Available') {
                return ['error' => 'Destination lot is not available', 'code' => 409];
            }
        }

        $result = $this->relocationModel->update($id, $data);
        return $result ? ['success' => true, 'message' => 'Relocation request updated'] : ['error' => 'Failed to update request', 'code' => 500];
    }

    public function approve($id, $userId) {
        $request = $this->relocationModel->findById($id);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        if ($request['status'] !== 'Pending') {
            return ['error' => 'Request is already processed', 'code' => 403];
        }

        $toLot = $this->lotModel->findById($request['to_lot_id']);
        if ($toLot['status'] !== 'Available') {
            return ['error' => 'Destination lot is no longer available', 'code' => 409];
        }

        $result = $this->relocationModel->updateStatus($id, 'Approved', $userId);
        if ($result) {
            $this->lotModel->update($request['to_lot_id'], ['status' => 'Reserved']);
            $this->auditLogModel->log(
                'Relocation approved',
                $userId,
                null,
                'Relocation',
                $id,
                ['deceased_id' => $request['deceased_id'] ?? null, 'from_lot_id' => $request['from_lot_id'] ?? null, 'to_lot_id' => $request['to_lot_id'] ?? null]
            );
            return ['success' => true, 'message' => 'Relocation request approved'];
        }

        return ['error' => 'Failed to approve request', 'code' => 500];
    }

    public function complete($id, $userId) {
        $request = $this->relocationModel->findById($id);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        if ($request['status'] !== 'Approved') {
            return ['error' => 'Request must be approved first', 'code' => 403];
        }

        $this->lotModel->update($request['from_lot_id'], ['status' => 'Available']);
        $this->lotModel->update($request['to_lot_id'], ['status' => 'Occupied']);

        $result = $this->relocationModel->updateStatus($id, 'Completed', $userId);
        if ($result) {
            $this->auditLogModel->log(
                'Relocation completed',
                $userId,
                null,
                'Relocation',
                $id,
                ['deceased_id' => $request['deceased_id'] ?? null, 'from_lot_id' => $request['from_lot_id'] ?? null, 'to_lot_id' => $request['to_lot_id'] ?? null]
            );
            return ['success' => true, 'message' => 'Relocation completed'];
        }
        return ['error' => 'Failed to complete relocation', 'code' => 500];
    }

    public function deny($id, $userId) {
        $request = $this->relocationModel->findById($id);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        if ($request['status'] !== 'Pending') {
            return ['error' => 'Request is already processed', 'code' => 403];
        }

        $result = $this->relocationModel->updateStatus($id, 'Denied', $userId);
        if ($result) {
            $this->auditLogModel->log(
                'Relocation denied',
                $userId,
                null,
                'Relocation',
                $id,
                ['deceased_id' => $request['deceased_id'] ?? null, 'from_lot_id' => $request['from_lot_id'] ?? null, 'to_lot_id' => $request['to_lot_id'] ?? null]
            );
            return ['success' => true, 'message' => 'Relocation request denied'];
        }
        return ['error' => 'Failed to deny request', 'code' => 500];
    }

    public function destroy($id, $userId) {
        $request = $this->relocationModel->findById($id);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        if ($request['status'] !== 'Pending') {
            return ['error' => 'Cannot delete a processed request', 'code' => 403];
        }

        $result = $this->relocationModel->delete($id);
        if ($result) {
            $this->auditLogModel->log(
                'Relocation deleted',
                $userId,
                null,
                'Relocation',
                $id,
                ['deceased_id' => $request['deceased_id'] ?? null, 'from_lot_id' => $request['from_lot_id'] ?? null, 'to_lot_id' => $request['to_lot_id'] ?? null]
            );
            return ['success' => true, 'message' => 'Relocation request deleted'];
        }
        return ['error' => 'Failed to delete request', 'code' => 500];
    }

    public function stats() {
        return $this->relocationModel->getStats();
    }
}
