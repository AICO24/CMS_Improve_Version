<?php
require_once __DIR__ . '/../config/database.php';

class SystemException {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    public function findAll($filters = []) {
        $sql = "
            SELECT e.*, u.full_name AS resolved_by_name
            FROM system_exceptions e
            LEFT JOIN users u ON e.resolved_by = u.user_id
            WHERE 1=1
        ";
        $params = [];

        if (!empty($filters['status'])) {
            $sql .= " AND e.status = ?";
            $params[] = $filters['status'];
        }
        if (!empty($filters['entity_type'])) {
            $sql .= " AND e.entity_type = ?";
            $params[] = $filters['entity_type'];
        }
        // AI-1: lets a caller scope to one specific entity's exceptions
        // instead of every exception of that entity_type.
        if (!empty($filters['entity_id'])) {
            $sql .= " AND e.entity_id = ?";
            $params[] = (int) $filters['entity_id'];
        }

        $sql .= " ORDER BY e.created_at DESC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT * FROM system_exceptions WHERE exception_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function raise($data) {
        $stmt = $this->db->prepare("
            INSERT INTO system_exceptions (event, entity_type, entity_id, reason, severity, context)
            VALUES (?, ?, ?, ?, ?, ?)
        ");
        $context = $data['context'] ?? null;
        $success = $stmt->execute([
            $data['event'],
            $data['entity_type'],
            $data['entity_id'],
            $data['reason'],
            $data['severity'] ?? 'warning',
            is_array($context) ? json_encode($context) : $context,
        ]);
        return $success ? (int) $this->db->lastInsertId() : false;
    }

    public function resolve($id, $resolvedBy, $notes = null) {
        $stmt = $this->db->prepare("
            UPDATE system_exceptions
            SET status = 'resolved', resolved_by = ?, resolved_at = NOW(), resolution_notes = ?
            WHERE exception_id = ?
        ");
        return $stmt->execute([$resolvedBy, $notes, $id]);
    }

    public function countOpen() {
        $stmt = $this->db->query("SELECT COUNT(*) AS count FROM system_exceptions WHERE status = 'open'");
        return (int) ($stmt->fetch()['count'] ?? 0);
    }
}
