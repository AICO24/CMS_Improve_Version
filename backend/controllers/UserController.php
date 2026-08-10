<?php
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../models/AuditLog.php';

class UserController {
    private $userModel;
    private $auditLogModel;

    public function __construct() {
        $this->userModel = new User();
        $this->auditLogModel = new AuditLog();
    }

    public function index($filters = [], $pagination = []) {
        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;

        if ($page === null && $perPage === null) {
            return $this->userModel->findAll($filters);
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $total = $this->userModel->countAll($filters);
        $data = $this->userModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);

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
        $user = $this->userModel->findById($id);
        return $user ? $this->normalize($user) : ['error' => 'User not found', 'code' => 404];
    }

    public function store($data, $actor = null) {
        $required = ['username', 'password', 'full_name', 'email', 'role_id'];
        foreach ($required as $field) {
            if (empty($data[$field]) && $data[$field] !== '0') {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        if ($this->userModel->findByUsername($data['username'])) {
            return ['error' => 'Username already taken', 'code' => 409];
        }

        if ($this->userModel->findByEmail($data['email'])) {
            return ['error' => 'Email already registered', 'code' => 409];
        }

        $result = $this->userModel->create($data);
        if ($result) {
            $created = $this->userModel->findByEmail($data['email']);
            if ($created) {
                $this->auditLogModel->log(
                    'User created',
                    $actor['user_id'] ?? null,
                    $actor['username'] ?? null,
                    'User',
                    $created['user_id'],
                    ['created_username' => $created['username'], 'created_email' => $created['email']]
                );
            }
            return ['success' => true, 'message' => 'User created'];
        }

        return ['error' => 'Failed to create user', 'code' => 500];
    }

    public function update($id, $data, $actor = null) {
        $existing = $this->userModel->findById($id);
        if (!$existing) {
            return ['error' => 'User not found', 'code' => 404];
        }

        if (!empty($data['username']) && $data['username'] !== $existing['username']) {
            if ($this->userModel->findByUsername($data['username'])) {
                return ['error' => 'Username already taken', 'code' => 409];
            }
        }

        if (!empty($data['email']) && $data['email'] !== $existing['email']) {
            if ($this->userModel->findByEmail($data['email'])) {
                return ['error' => 'Email already registered', 'code' => 409];
            }
        }

        $data['role_id'] = isset($data['role_id']) ? (int) $data['role_id'] : $existing['role_id'];
        $data['is_active'] = isset($data['is_active']) ? (int) $data['is_active'] : $existing['is_active'];

        $adminRoleId = $this->userModel->getRoleIdByTitle('admin');
        $wasActiveAdmin = $adminRoleId !== null
            && (int) $existing['role_id'] === $adminRoleId
            && (int) $existing['is_active'] === 1;
        $staysActiveAdmin = $adminRoleId !== null
            && $data['role_id'] === $adminRoleId
            && $data['is_active'] === 1;

        if ($wasActiveAdmin && !$staysActiveAdmin && $this->activeAdminCount($id) === 0) {
            return ['error' => 'Cannot remove admin access from the last active administrator account', 'code' => 403];
        }

        if (!empty($data['password'])) {
            $data['password_hash'] = password_hash($data['password'], PASSWORD_BCRYPT);
        }

        $changes = [];
        $compareFields = ['username', 'full_name', 'email', 'role_id', 'is_active'];
        foreach ($compareFields as $field) {
            if (isset($data[$field]) && $data[$field] != $existing[$field]) {
                $changes[$field] = ['from' => $existing[$field], 'to' => $data[$field]];
            }
        }

        $result = $this->userModel->update($id, $data);
        if ($result) {
            $this->auditLogModel->log(
                'User updated',
                $actor['user_id'] ?? null,
                $actor['username'] ?? null,
                'User',
                $id,
                $changes ?: ['note' => 'Updated user profile']
            );
            return ['success' => true, 'message' => 'User updated'];
        }

        return ['error' => 'Failed to update user', 'code' => 500];
    }

    public function destroy($id, $actor = null) {
        $user = $this->userModel->findById($id);
        if (!$user) {
            return ['error' => 'User not found', 'code' => 404];
        }

        $adminRoleId = $this->userModel->getRoleIdByTitle('admin');
        $isActiveAdmin = $adminRoleId !== null
            && (int) $user['role_id'] === $adminRoleId
            && (int) $user['is_active'] === 1;

        if ($isActiveAdmin && $this->activeAdminCount($id) === 0) {
            return ['error' => 'Cannot delete the last active administrator account', 'code' => 403];
        }

        $result = $this->userModel->delete($id);
        if ($result) {
            $this->auditLogModel->log(
                'User deleted',
                $actor['user_id'] ?? null,
                $actor['username'] ?? null,
                'User',
                $id,
                ['deleted_username' => $user['username'], 'deleted_email' => $user['email']]
            );
            return ['success' => true, 'message' => 'User deleted'];
        }

        return ['error' => 'Failed to delete user', 'code' => 500];
    }

    // Counts active admins other than $excludeUserId, so callers can check
    // whether removing/demoting/deactivating that one user would leave zero.
    private function activeAdminCount($excludeUserId) {
        $admins = $this->userModel->findAll(['role' => 'admin', 'is_active' => 1]);
        $remaining = array_filter($admins, function ($admin) use ($excludeUserId) {
            return (int) $admin['user_id'] !== (int) $excludeUserId;
        });
        return count($remaining);
    }

    private function normalize($user) {
        $role = $this->userModel->getRole($user['user_id']);
        return [
            'user_id' => $user['user_id'],
            'username' => $user['username'],
            'full_name' => $user['full_name'],
            'email' => $user['email'],
            'role_id' => (int) $user['role_id'],
            'role' => $role,
            'role_title' => $role ? ucwords($role) : null,
            'is_active' => (bool) $user['is_active'],
            'created_at' => $user['created_at'] ?? null,
            'last_login' => $user['last_login'] ?? null,
        ];
    }
}
