<?php
require_once __DIR__ . '/../models/Notification.php';

class NotificationController {
    private $notificationModel;

    public function __construct() {
        $this->notificationModel = new Notification();
    }

    public function index($filters = []) {
        return $this->notificationModel->findAll($filters);
    }

    public function show($id) {
        $notification = $this->notificationModel->findById($id);
        return $notification ?: ['error' => 'Notification not found', 'code' => 404];
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

    public function markRead($id) {
        if (!$this->notificationModel->findById($id)) {
            return ['error' => 'Notification not found', 'code' => 404];
        }
        $result = $this->notificationModel->markAsRead($id);
        return $result ? ['success' => true, 'message' => 'Notification marked read'] : ['error' => 'Failed to update notification', 'code' => 500];
    }

    public function markAllRead() {
        $result = $this->notificationModel->markAllRead();
        return $result ? ['success' => true, 'message' => 'All notifications marked read'] : ['error' => 'Failed to update notifications', 'code' => 500];
    }

    public function destroy($id) {
        if (!$this->notificationModel->findById($id)) {
            return ['error' => 'Notification not found', 'code' => 404];
        }
        $result = $this->notificationModel->delete($id);
        return $result ? ['success' => true, 'message' => 'Notification deleted'] : ['error' => 'Failed to delete notification', 'code' => 500];
    }

    public function unreadCount() {
        return $this->notificationModel->countUnread();
    }
}
