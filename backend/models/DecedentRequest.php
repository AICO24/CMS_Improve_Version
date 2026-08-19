<?php
require_once __DIR__ . '/../config/database.php';

class DecedentRequest {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    public function findAll($status = null) {
        $sql = "
            SELECT r.*, u.full_name AS requested_by_name
            FROM decedent_requests r
            LEFT JOIN users u ON r.requested_by = u.user_id
            WHERE 1=1
        ";
        $params = [];
        if ($status) {
            $sql .= " AND r.status = ?";
            $params[] = $status;
        }
        $sql .= " ORDER BY r.created_at DESC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function findByUser($userId) {
        $stmt = $this->db->prepare("SELECT * FROM decedent_requests WHERE requested_by = ? ORDER BY created_at DESC");
        $stmt->execute([$userId]);
        return $stmt->fetchAll();
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT * FROM decedent_requests WHERE request_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $stmt = $this->db->prepare("
            INSERT INTO decedent_requests (requested_by, full_name, approximate_dod, relationship, notes)
            VALUES (?, ?, ?, ?, ?)
        ");
        $success = $stmt->execute([
            $data['requested_by'],
            $data['full_name'],
            $data['approximate_dod'] ?? null,
            $data['relationship'] ?? null,
            $data['notes'] ?? null,
        ]);
        return $success ? (int) $this->db->lastInsertId() : false;
    }

    public function approve($id, $decedentId, $reviewedBy) {
        $stmt = $this->db->prepare("
            UPDATE decedent_requests
            SET status = 'approved', decedent_id = ?, reviewed_by = ?, reviewed_at = NOW()
            WHERE request_id = ?
        ");
        return $stmt->execute([$decedentId, $reviewedBy, $id]);
    }

    public function reject($id, $reason, $reviewedBy) {
        $stmt = $this->db->prepare("
            UPDATE decedent_requests
            SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW()
            WHERE request_id = ?
        ");
        return $stmt->execute([$reason, $reviewedBy, $id]);
    }
}
