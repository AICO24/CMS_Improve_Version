<?php
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/AuthController.php';

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
            return array_map([$this, 'normalize'], $this->userModel->findAll($filters));
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $total = $this->userModel->countAll($filters);
        $data = $this->userModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);

        return [
            'data' => array_map([$this, 'normalize'], $data),
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
        $firstName = trim((string) ($data['first_name'] ?? ''));
        $middleName = trim((string) ($data['middle_name'] ?? ''));
        $lastName = trim((string) ($data['last_name'] ?? ''));
        $suffix = trim((string) ($data['suffix'] ?? ''));

        if ($firstName !== '' || $lastName !== '') {
            if ($firstName === '') {
                return ['error' => 'First name is required', 'code' => 400];
            }
            if ($lastName === '') {
                return ['error' => 'Last name is required', 'code' => 400];
            }
            $assembledFullName = $firstName;
            if ($middleName !== '') {
                $assembledFullName .= ' ' . $middleName;
            }
            if ($lastName !== '') {
                $assembledFullName .= ' ' . $lastName;
            }
            if ($suffix !== '') {
                $assembledFullName .= ' ' . $suffix;
            }
            $data['full_name'] = $assembledFullName;
        }

        if (array_key_exists('region', $data) || array_key_exists('province', $data) || array_key_exists('city', $data) || array_key_exists('district', $data) || array_key_exists('barangay', $data)) {
            $region = trim((string) ($data['region'] ?? ''));
            $province = trim((string) ($data['province'] ?? ''));
            $city = trim((string) ($data['city'] ?? ''));
            $district = trim((string) ($data['district'] ?? ''));
            $barangay = trim((string) ($data['barangay'] ?? ''));

            if ($province && !$region) {
                return ['error' => 'Region is required when Province is selected', 'code' => 400];
            }
            if ($city && (!$province || !$region)) {
                return ['error' => 'Region and Province are required when City is selected', 'code' => 400];
            }
            if ($district && !$city) {
                return ['error' => 'City is required when District is selected', 'code' => 400];
            }
            if ($barangay && !$city) {
                return ['error' => 'City is required when Barangay is selected', 'code' => 400];
            }
        }

        if (isset($data['address'])) {
            $addr = trim((string) $data['address']);
            if ($addr !== '' && strlen($addr) < 5) {
                return ['error' => 'Address must be at least 5 characters long', 'code' => 400];
            }
        }

        $required = ['username', 'password', 'full_name', 'email', 'role_id'];
        foreach ($required as $field) {
            if (empty($data[$field]) && $data[$field] !== '0') {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            return ['error' => 'A valid email address is required', 'code' => 400];
        }

        $pwdError = AuthController::validatePasswordComplexity($data['password']);
        if ($pwdError !== null) {
            return ['error' => $pwdError, 'code' => 400];
        }

        if (!empty($data['contact_number'])) {
            $phoneResult = AuthController::validateAndNormalizePhone($data['contact_number'], false);
            if (!$phoneResult['valid']) {
                return ['error' => $phoneResult['error'], 'code' => 400];
            }
            $data['contact_number'] = $phoneResult['normalized'];
        }

        if (!$this->userModel->roleIdExists($data['role_id'])) {
            return ['error' => 'Invalid role selected', 'code' => 400];
        }

        if ($this->userModel->isUsernameTaken($data['username'])) {
            return ['error' => 'Username already taken', 'code' => 409];
        }

        if ($this->userModel->isEmailTaken($data['email'])) {
            return ['error' => 'This email address is already in use by another account. Please use a different email.', 'code' => 409];
        }

        try {
            $result = $this->userModel->create($data);
        } catch (PDOException $e) {
            // Safety net for the race between the uniqueness checks above and
            // this INSERT (two concurrent admin requests) — mirrors
            // AuthController::register()'s identical catch. Email and
            // username were both just confirmed free of a pre-existing row,
            // so a 23000 constraint violation here means one of them was
            // taken in that same window.
            if ($e->getCode() === '23000') {
                return ['error' => 'Username or email already registered', 'code' => 409];
            }
            throw $e;
        }
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

        if (!empty($data['username'])) {
            $normalizedUsername = trim((string)$data['username']);
            if ($this->userModel->isUsernameTaken($normalizedUsername, $id)) {
                return ['error' => 'Username already taken', 'code' => 409];
            }
            $data['username'] = $normalizedUsername;
        }

        if (!empty($data['email'])) {
            $normalizedEmail = strtolower(trim((string)$data['email']));
            if (!filter_var($normalizedEmail, FILTER_VALIDATE_EMAIL)) {
                return ['error' => 'A valid email address is required', 'code' => 400];
            }
            if ($this->userModel->isEmailTaken($normalizedEmail, $id)) {
                return ['error' => 'This email address is already in use by another account. Please use a different email.', 'code' => 409];
            }
            $data['email'] = $normalizedEmail;
        }

        if (!empty($data['password'])) {
            $pwdError = AuthController::validatePasswordComplexity($data['password']);
            if ($pwdError !== null) {
                return ['error' => $pwdError, 'code' => 400];
            }
        }

        if (isset($data['contact_number']) && $data['contact_number'] !== '') {
            $phoneResult = AuthController::validateAndNormalizePhone($data['contact_number'], false);
            if (!$phoneResult['valid']) {
                return ['error' => $phoneResult['error'], 'code' => 400];
            }
            $data['contact_number'] = $phoneResult['normalized'];
        }

        $data['role_id'] = isset($data['role_id']) ? (int) $data['role_id'] : $existing['role_id'];
        $data['is_active'] = isset($data['is_active']) ? (int) $data['is_active'] : $existing['is_active'];

        if ((int) $data['role_id'] !== (int) $existing['role_id'] && !$this->userModel->roleIdExists($data['role_id'])) {
            return ['error' => 'Invalid role selected', 'code' => 400];
        }

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

        if (isset($data['first_name']) || isset($data['last_name'])) {
            $firstName = trim((string) ($data['first_name'] ?? $existing['first_name'] ?? ''));
            $middleName = trim((string) ($data['middle_name'] ?? $existing['middle_name'] ?? ''));
            $lastName = trim((string) ($data['last_name'] ?? $existing['last_name'] ?? ''));
            $suffix = trim((string) ($data['suffix'] ?? $existing['suffix'] ?? ''));

            if ($firstName === '') {
                return ['error' => 'First name cannot be empty', 'code' => 400];
            }
            if ($lastName === '') {
                return ['error' => 'Last name cannot be empty', 'code' => 400];
            }
            $assembledFullName = $firstName;
            if ($middleName !== '') {
                $assembledFullName .= ' ' . $middleName;
            }
            if ($lastName !== '') {
                $assembledFullName .= ' ' . $lastName;
            }
            if ($suffix !== '') {
                $assembledFullName .= ' ' . $suffix;
            }
            $data['full_name'] = $assembledFullName;
            $data['first_name'] = $firstName;
            $data['middle_name'] = $middleName ?: null;
            $data['last_name'] = $lastName;
            $data['suffix'] = $suffix ?: null;
        }

        if (array_key_exists('region', $data) || array_key_exists('province', $data) || array_key_exists('city', $data) || array_key_exists('district', $data) || array_key_exists('barangay', $data)) {
            $region = array_key_exists('region', $data) ? trim((string) ($data['region'] ?? '')) : ($existing['region'] ?? null);
            $province = array_key_exists('province', $data) ? trim((string) ($data['province'] ?? '')) : ($existing['province'] ?? null);
            $city = array_key_exists('city', $data) ? trim((string) ($data['city'] ?? '')) : ($existing['city'] ?? null);
            $district = array_key_exists('district', $data) ? trim((string) ($data['district'] ?? '')) : ($existing['district'] ?? null);
            $barangay = array_key_exists('barangay', $data) ? trim((string) ($data['barangay'] ?? '')) : ($existing['barangay'] ?? null);

            if ($province && !$region) {
                return ['error' => 'Region is required when Province is selected', 'code' => 400];
            }
            if ($city && (!$province || !$region)) {
                return ['error' => 'Region and Province are required when City is selected', 'code' => 400];
            }
            if ($district && !$city) {
                return ['error' => 'City is required when District is selected', 'code' => 400];
            }
            if ($barangay && !$city) {
                return ['error' => 'City is required when Barangay is selected', 'code' => 400];
            }
        }

        if (isset($data['address'])) {
            $addr = trim((string) $data['address']);
            if ($addr !== '' && strlen($addr) < 5) {
                return ['error' => 'Address must be at least 5 characters long', 'code' => 400];
            }
        }

        $changes = [];
        $compareFields = ['username', 'full_name', 'first_name', 'middle_name', 'last_name', 'suffix', 'email', 'contact_number', 'address', 'region', 'province', 'city', 'district', 'barangay', 'role_id', 'is_active'];
        foreach ($compareFields as $field) {
            if (array_key_exists($field, $data) && $data[$field] != $existing[$field]) {
                $changes[$field] = ['from' => $existing[$field] ?? null, 'to' => $data[$field]];
            }
        }

        try {
            $result = $this->userModel->update($id, $data);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                return ['error' => 'Username or email already in use by another account', 'code' => 409];
            }
            throw $e;
        }
        if ($result) {
            if (!empty($data['password'])) {
                // AUTH-004b (Auth audit, Batch AUTH-4b): an admin-driven
                // password change should invalidate that user's existing
                // sessions for the same reason a self-service reset does —
                // see User::invalidateSessions()'s comment. Role/is_active
                // changes don't need this: AuthMiddleware::authenticate()
                // already re-checks those fresh on every request (AUTH-004).
                $this->userModel->invalidateSessions($id);
            }
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

    public function bulkAction($payload, $actor = null) {
        $action = strtolower((string) ($payload['action'] ?? ''));
        $userIds = $payload['user_ids'] ?? [];

        if (!in_array($action, ['activate', 'deactivate', 'delete'], true)) {
            return ['error' => 'Invalid bulk action', 'code' => 400];
        }

        $ids = array_values(array_unique(array_filter(array_map('intval', (array) $userIds))));
        if (empty($ids)) {
            return ['error' => 'No user IDs were selected', 'code' => 400];
        }

        $adminRoleId = $this->userModel->getRoleIdByTitle('admin');
        $activeAdmins = $this->userModel->findAll(['role' => 'admin', 'is_active' => 1]);
        $activeAdminIds = array_map(function ($user) { return (int) $user['user_id']; }, $activeAdmins);

        if ($action === 'deactivate') {
            foreach ($ids as $id) {
                $user = $this->userModel->findById($id);
                if (!$user) {
                    return ['error' => 'One or more users could not be found', 'code' => 404];
                }
                $willRemoveAdmin = $adminRoleId !== null
                    && (int) $user['role_id'] === $adminRoleId
                    && (int) $user['is_active'] === 1;
                if ($willRemoveAdmin && count(array_diff($activeAdminIds, [$id])) === 0) {
                    return ['error' => 'Cannot deactivate the last active administrator account', 'code' => 403];
                }
            }
        }

        if ($action === 'delete') {
            foreach ($ids as $id) {
                $user = $this->userModel->findById($id);
                if (!$user) {
                    return ['error' => 'One or more users could not be found', 'code' => 404];
                }
                $isActiveAdmin = $adminRoleId !== null
                    && (int) $user['role_id'] === $adminRoleId
                    && (int) $user['is_active'] === 1;
                if ($isActiveAdmin && count(array_diff($activeAdminIds, [$id])) === 0) {
                    return ['error' => 'Cannot delete the last active administrator account', 'code' => 403];
                }
            }
        }

        $conn = Database::getInstance()->getConnection();

        if ($action === 'activate' || $action === 'deactivate') {
            $inClause = implode(',', array_fill(0, count($ids), '?'));
            $newState = $action === 'activate' ? 1 : 0;
            $sql = "UPDATE users SET is_active = ? WHERE user_id IN ($inClause)";
            $params = [$newState, ...$ids];
            $stmt = $conn->prepare($sql);
            $updated = $stmt->execute($params);
            if ($updated) {
                foreach ($ids as $id) {
                    $user = $this->userModel->findById($id);
                    $this->auditLogModel->log(
                        $action === 'activate' ? 'Users activated' : 'Users deactivated',
                        $actor['user_id'] ?? null,
                        $actor['username'] ?? null,
                        'User',
                        $id,
                        ['target_user' => $user['username'] ?? null, 'is_active' => $newState]
                    );
                }
                return ['success' => true, 'message' => 'Bulk update completed'];
            }
            return ['error' => 'Failed to update selected users', 'code' => 500];
        }

        if ($action === 'delete') {
            $userSnapshots = [];
            foreach ($ids as $id) {
                $user = $this->userModel->findById($id);
                if ($user) {
                    $userSnapshots[$id] = $user;
                }
            }

            $inClause = implode(',', array_fill(0, count($ids), '?'));
            $sql = "DELETE FROM users WHERE user_id IN ($inClause)";
            $stmt = $conn->prepare($sql);
            $deleted = $stmt->execute($ids);
            if ($deleted) {
                foreach ($ids as $id) {
                    $user = $userSnapshots[$id] ?? null;
                    $this->auditLogModel->log(
                        'Users deleted',
                        $actor['user_id'] ?? null,
                        $actor['username'] ?? null,
                        'User',
                        $id,
                        ['deleted_username' => $user['username'] ?? null, 'deleted_email' => $user['email'] ?? null]
                    );
                }
                return ['success' => true, 'message' => 'Bulk delete completed'];
            }
            return ['error' => 'Failed to delete selected users', 'code' => 500];
        }

        return ['error' => 'Unsupported bulk action', 'code' => 400];
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

    // Batch 14 (Batch 13 audit finding): the single source of truth for
    // which User fields are safe to return to a client — strips
    // password_hash/reset_token_hash/reset_token_expires_at/etc. by only
    // ever naming the fields that belong in a response. Originally used
    // only by show(); now also used by index() (see below), which is why
    // this accepts an already-joined role_title when present (findAll()'s
    // query already JOINs roles and returns it) instead of always issuing
    // getRole()'s own extra per-row query — applying the old
    // single-user-only version as-is to a bulk list would have queried
    // the database once per returned user for no reason, since the
    // answer was already in the row. show()'s own row (from
    // User::findById(), no join) never has a role_title key, so it always
    // takes the getRole() branch exactly as before — this preserves its
    // existing behavior unchanged.
    private function normalize($user) {
        if (array_key_exists('role_title', $user)) {
            $roleTitle = $user['role_title'];
            $role = $roleTitle ? strtolower($roleTitle) : null;
        } else {
            $role = $this->userModel->getRole($user['user_id']);
            $roleTitle = $role ? ucwords($role) : null;
        }
        return [
            'user_id' => $user['user_id'],
            'username' => $user['username'],
            'full_name' => $user['full_name'],
            'first_name' => $user['first_name'] ?? null,
            'middle_name' => $user['middle_name'] ?? null,
            'last_name' => $user['last_name'] ?? null,
            'suffix' => $user['suffix'] ?? null,
            'email' => $user['email'],
            'contact_number' => $user['contact_number'] ?? null,
            'address' => $user['address'] ?? null,
            'region' => $user['region'] ?? null,
            'province' => $user['province'] ?? null,
            'city' => $user['city'] ?? null,
            'district' => $user['district'] ?? null,
            'barangay' => $user['barangay'] ?? null,
            'role_id' => (int) $user['role_id'],
            'role' => $role,
            'role_title' => $roleTitle,
            'is_active' => (bool) $user['is_active'],
            'created_at' => $user['created_at'] ?? null,
            'last_login' => $user['last_login'] ?? null,
        ];
    }
}
