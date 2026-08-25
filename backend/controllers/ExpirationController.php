<?php
require_once __DIR__ . '/../models/ExpirationRecord.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/AuditLog.php';

class ExpirationController {
    private $expirationModel;
    private $notificationModel;
    private $auditLogModel;

    public function __construct() {
        $this->expirationModel = new ExpirationRecord();
        $this->notificationModel = new Notification();
        $this->auditLogModel = new AuditLog();
    }

    public function index($filters = [], $pagination = []) {
        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;

        if ($page === null && $perPage === null) {
            return $this->expirationModel->findAll($filters);
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $total = $this->expirationModel->countAll($filters);
        $data = $this->expirationModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);

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
        $record = $this->expirationModel->findById($id);
        return $record ?: ['error' => 'Expiration record not found', 'code' => 404];
    }

    public function store($data) {
        $required = ['lot_id', 'end_date'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }
        $result = $this->expirationModel->create($data);
        return $result ? ['success' => true, 'message' => 'Expiration record created'] : ['error' => 'Failed to create expiration record', 'code' => 500];
    }

    public function update($id, $data) {
        if (!$this->expirationModel->findById($id)) {
            return ['error' => 'Expiration record not found', 'code' => 404];
        }
        $required = ['lot_id', 'end_date'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }
        $result = $this->expirationModel->update($id, $data);
        return $result ? ['success' => true, 'message' => 'Expiration record updated'] : ['error' => 'Failed to update expiration record', 'code' => 500];
    }

    public function destroy($id) {
        $existing = $this->expirationModel->findById($id);
        if (!$existing) {
            return ['error' => 'Expiration record not found', 'code' => 404];
        }
        $result = $this->expirationModel->delete($id);
        if ($result) {
            $this->auditLogModel->log(
                'Expiration record deleted',
                null,
                null,
                'Expiration',
                $id,
                [
                    'lot_id' => $existing['lot_id'] ?? null,
                    'start_date' => $existing['start_date'] ?? null,
                    'end_date' => $existing['end_date'] ?? null,
                    'renewed' => $existing['renewed'] ?? null,
                    'exhumation_status' => $existing['exhumation_status'] ?? null,
                ]
            );
            return ['success' => true, 'message' => 'Expiration record deleted'];
        }
        return ['error' => 'Failed to delete expiration record', 'code' => 500];
    }

    public function stats() {
        return $this->expirationModel->getStats();
    }

    // Batch D (Admin-Wide Automation Audit): previously used findExpiringSoon()
    // (every matching row, every call) with no record of what had already
    // been notified — every visit to the Notifications page created a fresh
    // duplicate notification for the same still-expiring lot. Now only
    // considers rows that haven't triggered a notification yet, and marks
    // each one immediately after so a repeat call is a safe no-op.
    public function generateNotifications($days = 30) {
        $rows = $this->expirationModel->findExpiringSoonUnnotified($days);
        $count = 0;
        foreach ($rows as $row) {
            $title = "Lot {$row['lot_number']} expiring in {$days} days";
            $message = "Expiration alert for Lot {$row['lot_number']} in Section {$row['section_name']} (Block {$row['block_name']}). Lease ends on {$row['end_date']}";
            $this->notificationModel->create([
                'title' => $title,
                'message' => $message,
                'notification_type' => 'Expiration',
                'is_read' => 0
            ]);
            $this->expirationModel->markNotified($row['expiration_id']);
            $this->auditLogModel->log(
                'Expiration notification generated',
                null,
                null,
                'Expiration',
                $row['expiration_id'] ?? null,
                ['lot_number' => $row['lot_number'], 'end_date' => $row['end_date'], 'alert_days' => $days]
            );
            $count++;
        }
        return ['success' => true, 'created' => $count, 'message' => "$count expiration notifications generated"];
    }
}
