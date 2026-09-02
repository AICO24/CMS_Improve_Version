<?php
require_once __DIR__ . '/../config/database.php';

class Notification {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    // $filters['user_id'], when set, restricts to ONLY this user's own
    // notifications — never broadcast (user_id IS NULL) rows too. Broadcast
    // rows today are exclusively operational/staff-facing (system-exception
    // diagnostics, expiration alerts referencing internal entity ids) and
    // were never meant for a citizen's eyes, so a citizen (the only caller
    // that passes this filter — see NotificationController) doesn't see them
    // either. Admin/staff pass no user_id filter and keep seeing every row,
    // unchanged from before migration_20260902_add_notification_recipient.sql.
    public function findAll($filters = []) {
        $sql = "SELECT * FROM notifications WHERE 1=1";
        $params = [];

        if (!empty($filters['notification_type'])) {
            $sql .= " AND notification_type = ?";
            $params[] = $filters['notification_type'];
        }
        if (array_key_exists('user_id', $filters) && $filters['user_id'] !== null) {
            $sql .= " AND user_id = ?";
            $params[] = $filters['user_id'];
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

    // $data['user_id']: the notification's owner, or omitted/null for a
    // broadcast row — see the class-level notes on findAll().
    public function create($data) {
        $stmt = $this->db->prepare("INSERT INTO notifications (title, message, notification_type, user_id, is_read) VALUES (?, ?, ?, ?, ?)");
        return $stmt->execute([
            $data['title'],
            $data['message'],
            $data['notification_type'] ?? 'System',
            $data['user_id'] ?? null,
            isset($data['is_read']) ? (int) $data['is_read'] : 0,
        ]);
    }

    public function markAsRead($id) {
        $stmt = $this->db->prepare("UPDATE notifications SET is_read = 1 WHERE notification_id = ?");
        return $stmt->execute([$id]);
    }

    // $userId, when given, only marks THIS user's own rows read — a
    // citizen's "mark all read" must never touch another citizen's or a
    // broadcast row. Omitted (null) keeps the original global behavior
    // (admin/staff's existing "clear the whole shared queue" feature,
    // unchanged).
    public function markAllRead($userId = null) {
        if ($userId !== null) {
            $stmt = $this->db->prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0 AND user_id = ?");
            return $stmt->execute([$userId]);
        }
        $stmt = $this->db->prepare("UPDATE notifications SET is_read = 1 WHERE is_read = 0");
        return $stmt->execute();
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM notifications WHERE notification_id = ?");
        return $stmt->execute([$id]);
    }

    // $userId, when given, counts only this user's own unread rows (never
    // another user's or a broadcast row). Omitted (null) keeps the original
    // global count (admin/staff, unchanged).
    public function countUnread($userId = null) {
        if ($userId !== null) {
            $stmt = $this->db->prepare("SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0 AND user_id = ?");
            $stmt->execute([$userId]);
            return $stmt->fetch();
        }
        $stmt = $this->db->query("SELECT COUNT(*) AS count FROM notifications WHERE is_read = 0");
        return $stmt->fetch();
    }
}
