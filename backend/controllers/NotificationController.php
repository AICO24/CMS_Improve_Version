<?php
require_once __DIR__ . '/../models/Notification.php';

class NotificationController {
    private $notificationModel;

    public function __construct() {
        $this->notificationModel = new Notification();
    }

    // Finding E.1: a citizen (role 'user') is scoped to only their own
    // notifications (filters['user_id']) — admin/staff pass no such filter
    // and keep seeing every row, the exact same global feed this page has
    // always shown them. See Notification::findAll()'s comment.
    private static function scopeUserId($user) {
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if (in_array($role, ['admin', 'staff'], true)) {
            return null;
        }
        return is_array($user) ? ($user['user_id'] ?? null) : $user;
    }

    public function index($filters = [], $user = null) {
        $scopedUserId = self::scopeUserId($user);
        if ($scopedUserId !== null) {
            $filters['user_id'] = $scopedUserId;
        }
        return $this->notificationModel->findAll($filters);
    }

    public function show($id, $user = null) {
        $notification = $this->notificationModel->findById($id);
        if (!$notification) {
            return ['error' => 'Notification not found', 'code' => 404];
        }
        $scopedUserId = self::scopeUserId($user);
        if ($scopedUserId !== null && (int) ($notification['user_id'] ?? 0) !== (int) $scopedUserId) {
            return ['error' => 'You may only view your own notifications', 'code' => 403];
        }
        return $notification;
    }

    public function store($data) {
        $required = ['title', 'message'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        $result = $this->notificationModel->create($data);
        return $result ? ['success' => true, 'message' => 'Notification created'] : ['error' => 'Failed to create notification', 'code' => 500];
    }

    public function markRead($id, $user = null) {
        $notification = $this->notificationModel->findById($id);
        if (!$notification) {
            return ['error' => 'Notification not found', 'code' => 404];
        }
        $scopedUserId = self::scopeUserId($user);
        if ($scopedUserId !== null && (int) ($notification['user_id'] ?? 0) !== (int) $scopedUserId) {
            return ['error' => 'You may only update your own notifications', 'code' => 403];
        }
        $result = $this->notificationModel->markAsRead($id);
        return $result ? ['success' => true, 'message' => 'Notification marked read'] : ['error' => 'Failed to update notification', 'code' => 500];
    }

    public function markAllRead($user = null) {
        $result = $this->notificationModel->markAllRead(self::scopeUserId($user));
        return $result ? ['success' => true, 'message' => 'All notifications marked read'] : ['error' => 'Failed to update notifications', 'code' => 500];
    }

    public function destroy($id) {
        if (!$this->notificationModel->findById($id)) {
            return ['error' => 'Notification not found', 'code' => 404];
        }
        $result = $this->notificationModel->delete($id);
        return $result ? ['success' => true, 'message' => 'Notification deleted'] : ['error' => 'Failed to delete notification', 'code' => 500];
    }

    public function unreadCount($user = null) {
        return $this->notificationModel->countUnread(self::scopeUserId($user));
    }
}
