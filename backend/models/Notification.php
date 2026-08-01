<?php
require_once __DIR__ . '/../config/database.php';

class Notification {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    public function findAll($filters = []) {
        $sql = "SELECT * FROM notifications WHERE 1=1";
        $params = [];

        if (!empty($filters['notification_type'])) {
            $sql .= " AND notification_type = ?";
            $params[] = $filters['notification_type'];
        }

        $sql .= " ORDER BY created_at DESC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT * FROM notifications WHERE notification_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $stmt = $this->db->prepare("INSERT INTO notifications (title, message, notification_type, is_read) VALUES (?, ?, ?, ?)");
        return $stmt->execute([
            $data['title'],
            $data['message'],
            $data['notification_type'] ?? 'System',
            isset($data['is_read']) ? (int) $data['is_read'] : 0,
        ]);
    }

    public function markAsRead($id) {
        $stmt = $this->db->prepare("UPDATE notifications SET is_read = 1 WHERE notification_id = ?");
        return $stmt->execute([$id]);
    }

    public function markAllRead() {
        $stmt = $this->db->prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0");
        return $stmt->execute();
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM notifications WHERE notification_id = ?");
        return $stmt->execute([$id]);
    }

    public function countUnread() {
        $stmt = $this->db->query("SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0");
        return $stmt->fetch();
    }
}
