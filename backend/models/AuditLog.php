<?php
require_once __DIR__ . '/../config/database.php';

class AuditLog {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
        $this->ensureTableExists();
    }

    private function ensureTableExists() {
        $sql = "
            CREATE TABLE IF NOT EXISTS audit_logs (
                log_id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NULL,
                username VARCHAR(100) NULL,
                action VARCHAR(100) NOT NULL,
                entity_type VARCHAR(50) NULL,
                entity_id INT NULL,
                details TEXT NULL,
                ip_address VARCHAR(45) NULL,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ";
        $this->db->exec($sql);
    }

    public function log($action, $userId = null, $username = null, $entityType = null, $entityId = null, $details = null) {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        $stmt = $this->db->prepare("
            INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ");
        return $stmt->execute([
            $userId !== null ? (int)$userId : null,
            $username,
            $action,
            $entityType,
            $entityId !== null ? (int)$entityId : null,
            is_array($details) ? json_encode($details) : $details,
            $ip
        ]);
    }

    public function findAll($filters = [], $limit = 100, $offset = 0) {
        $sql = "SELECT a.*, u.full_name as user_full_name FROM audit_logs a LEFT JOIN users u ON a.user_id = u.user_id WHERE 1=1";
        $params = [];

        if (!empty($filters['q'])) {
            $sql .= " AND (a.action LIKE ? OR a.username LIKE ? OR a.entity_type LIKE ? OR a.details LIKE ? OR u.full_name LIKE ? )";
            $query = '%' . $filters['q'] . '%';
            $params[] = $query;
            $params[] = $query;
            $params[] = $query;
            $params[] = $query;
            $params[] = $query;
        }
        if (!empty($filters['action'])) {
            $sql .= " AND LOWER(a.action) = ?";
            $params[] = strtolower($filters['action']);
        }
        if (!empty($filters['entity_type'])) {
            $sql .= " AND LOWER(a.entity_type) = ?";
            $params[] = strtolower($filters['entity_type']);
        }
        if (!empty($filters['user_id'])) {
            $sql .= " AND a.user_id = ?";
            $params[] = (int)$filters['user_id'];
        }

        $sql .= " ORDER BY a.created_at DESC LIMIT ? OFFSET ?";
        $params[] = (int)$limit;
        $params[] = (int)$offset;

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }
}
