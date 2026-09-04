<?php
require_once __DIR__ . '/../config/database.php';

class User {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    public function findByUsername($username) {
        $stmt = $this->db->prepare("SELECT * FROM users WHERE username = ?");
        $stmt->execute([$username]);
        return $stmt->fetch();
    }

    public function findByEmail($email) {
        $stmt = $this->db->prepare("SELECT * FROM users WHERE email = ?");
        $stmt->execute([$email]);
        return $stmt->fetch();
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT * FROM users WHERE user_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $username = $data['username'] ?? null;
        if (empty($username) && !empty($data['email'])) {
            $parts = explode('@', $data['email']);
            $username = $parts[0];
        }

        $roleId = $data['role_id'] ?? null;
        if ($roleId === null) {
            // attempt to resolve a default 'user' role id
            $roleStmt = $this->db->query("SELECT role_id, title FROM roles");
            $roles = [];
            foreach ($roleStmt->fetchAll() as $row) {
                $roles[strtolower($row['title'])] = (int) $row['role_id'];
            }
            $roleId = $roles['user'] ?? ($roles['staff'] ?? 2);
        }

        $stmt = $this->db->prepare("INSERT INTO users (username, password_hash, full_name, email, contact_number, address, role_id, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, 1)");
        return $stmt->execute([
            $username,
            password_hash($data['password'], PASSWORD_BCRYPT),
            $data['full_name'],
            $data['email'],
            $data['contact_number'] ?? null,
            $data['address'] ?? null,
            $roleId,
        ]);
    }

    public function ensureUserRoleExists() {
        $stmt = $this->db->prepare("SELECT role_id FROM roles WHERE LOWER(title) = 'user' LIMIT 1");
        $stmt->execute();
        $row = $stmt->fetch();
        if ($row) return (int) $row['role_id'];

        $ins = $this->db->prepare("INSERT INTO roles (title, description) VALUES (?, ?)");
        $ins->execute(['User', 'General user role']);
        return (int) $this->db->lastInsertId();
    }

    public function updateLastLogin($userId) {
        $stmt = $this->db->prepare("UPDATE users SET last_login = NOW() WHERE user_id = ?");
        return $stmt->execute([$userId]);
    }

    public function getRole($userId) {
        $stmt = $this->db->prepare("SELECT r.title FROM users u JOIN roles r ON u.role_id = r.role_id WHERE u.user_id = ?");
        $stmt->execute([$userId]);
        $result = $stmt->fetch();
        return $result ? strtolower($result['title']) : null;
    }

    // Moved here from AuthController (was a private method there) so
    // AuthController::login() and getAuthStatus() below always normalize a
    // raw role title the same way — see getAuthStatus()'s comment for why
    // that consistency matters.
    public static function normalizeRoleKey($role) {
        $value = strtolower(trim((string) $role));
        if ($value === '') {
            return null;
        }

        if (strpos($value, 'admin') !== false) {
            return 'admin';
        }

        if (strpos($value, 'staff') !== false) {
            return 'staff';
        }

        if (strpos($value, 'user') !== false) {
            return 'user';
        }

        return $value;
    }

    // AUTH-004 (Auth audit, Batch AUTH-4): used by AuthMiddleware::authenticate()
    // to re-check role/is_active on every request instead of trusting the JWT
    // payload's copy of them, which is only as fresh as when the token was
    // issued (up to JWT_EXPIRY — 1h by default). Without this, a user demoted
    // or deactivated mid-session keeps acting on their old privileges until
    // their existing token naturally expires. Returns null if the account no
    // longer exists (e.g. deleted after the token was issued).
    public function getAuthStatus($userId) {
        $stmt = $this->db->prepare("SELECT u.is_active, u.session_version, r.title FROM users u JOIN roles r ON u.role_id = r.role_id WHERE u.user_id = ?");
        $stmt->execute([$userId]);
        $row = $stmt->fetch();
        if (!$row) {
            return null;
        }

        return [
            'is_active' => (bool) (int) $row['is_active'],
            'role' => self::normalizeRoleKey($row['title']),
            'session_version' => (int) $row['session_version'],
        ];
    }

    // AUTH-004b (Auth audit, Batch AUTH-4b): stateless JWTs stay valid until
    // natural expiry regardless of "logout" — this is the server-side half
    // of fixing that. AuthController::login() embeds the user's current
    // session_version in every token it issues; AuthMiddleware::authenticate()
    // rejects any token whose embedded version doesn't exactly match the
    // user's CURRENT version. Incrementing it here therefore invalidates
    // every previously issued token for this user at once — there's no
    // per-token tracking, only this one counter, so logging out (or
    // changing password) on one device signs the user out everywhere. That's
    // the simplest correct behavior without a dedicated sessions table.
    // Called from AuthController::logout() and also from any password-change
    // path (AuthController::resetPassword(), UserController::update()) so a
    // stolen token can't outlive a password change either.
    //
    // A counter, not a timestamp: see this migration's own comment
    // (backend/database/migration_20260904_add_session_invalidation.sql) for
    // why a NOW()/iat timestamp comparison was tried first and replaced —
    // 1-second resolution let a login tie with its own immediate logout, and
    // ties made the old token permanently escape invalidation instead of
    // glitching for a moment. Integer equality has no such collision.
    public function invalidateSessions($userId) {
        $stmt = $this->db->prepare("UPDATE users SET session_version = session_version + 1 WHERE user_id = ?");
        return $stmt->execute([$userId]);
    }

    private function applyFilters(&$sql, &$params, $filters) {
        if (!empty($filters['role'])) {
            $sql .= " AND LOWER(r.title) = ?";
            $params[] = strtolower($filters['role']);
        }
        if (isset($filters['is_active'])) {
            $sql .= " AND u.is_active = ?";
            $params[] = (int) $filters['is_active'];
        }
        if (!empty($filters['q'])) {
            $sql .= " AND (u.username LIKE ? OR u.full_name LIKE ? OR u.email LIKE ?)";
            $query = '%' . $filters['q'] . '%';
            $params[] = $query;
            $params[] = $query;
            $params[] = $query;
        }
    }

    public function findAll($filters = [], $pagination = []) {
        $sql = "SELECT u.*, r.title AS role_title FROM users u JOIN roles r ON u.role_id = r.role_id WHERE 1=1";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $sql .= " ORDER BY u.created_at DESC";

        $page = null;
        $perPage = null;
        if (!empty($pagination['page']) || !empty($pagination['per_page'])) {
            $page = max(1, (int) ($pagination['page'] ?? 1));
            $perPage = max(1, min(100, (int) ($pagination['per_page'] ?? 10)));
        }

        if ($page !== null && $perPage !== null) {
            $offset = ($page - 1) * $perPage;
            $sql .= " LIMIT ?, ?";
            $params[] = $offset;
            $params[] = $perPage;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function countAll($filters = []) {
        $sql = "SELECT COUNT(*) AS total FROM users u JOIN roles r ON u.role_id = r.role_id WHERE 1=1";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function getRoleIdByTitle($title) {
        $stmt = $this->db->prepare("SELECT role_id FROM roles WHERE LOWER(title) = ? LIMIT 1");
        $stmt->execute([strtolower($title)]);
        $row = $stmt->fetch();
        return $row ? (int) $row['role_id'] : null;
    }

    public function update($id, $data) {
        $fields = [];
        $params = [];

        if (!empty($data['username'])) {
            $fields[] = 'username = ?';
            $params[] = $data['username'];
        }
        if (!empty($data['password_hash'])) {
            $fields[] = 'password_hash = ?';
            $params[] = $data['password_hash'];
        }
        if (!empty($data['full_name'])) {
            $fields[] = 'full_name = ?';
            $params[] = $data['full_name'];
        }
        if (!empty($data['email'])) {
            $fields[] = 'email = ?';
            $params[] = $data['email'];
        }
        if (isset($data['role_id'])) {
            $fields[] = 'role_id = ?';
            $params[] = (int) $data['role_id'];
        }
        if (isset($data['is_active'])) {
            $fields[] = 'is_active = ?';
            $params[] = (int) $data['is_active'];
        }

        if (empty($fields)) {
            return false;
        }

        $sql = "UPDATE users SET " . implode(', ', $fields) . " WHERE user_id = ?";
        $params[] = $id;
        $stmt = $this->db->prepare($sql);
        return $stmt->execute($params);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM users WHERE user_id = ?");
        return $stmt->execute([$id]);
    }

    public function verifyPassword($password, $user) {
        if (isset($user['password_hash']) && $user['password_hash'] !== '') {
            return password_verify($password, $user['password_hash']);
        }

        if (isset($user['password'])) {
            return $password === $user['password'];
        }

        return false;
    }

    public function updatePasswordHash($userId, $newHash) {
        $stmt = $this->db->prepare("UPDATE users SET password_hash = ? WHERE user_id = ?");
        return $stmt->execute([$newHash, $userId]);
    }

    public function setResetToken($userId, $tokenHash, $expiresAt) {
        $stmt = $this->db->prepare("UPDATE users SET reset_token_hash = ?, reset_token_expires_at = ? WHERE user_id = ?");
        return $stmt->execute([$tokenHash, $expiresAt, $userId]);
    }

    public function clearResetToken($userId) {
        $stmt = $this->db->prepare("UPDATE users SET reset_token_hash = NULL, reset_token_expires_at = NULL WHERE user_id = ?");
        return $stmt->execute([$userId]);
    }

    // Verifies a plaintext reset code against the stored hash for this
    // email and confirms it hasn't expired. Returns the user row on
    // success, or null if the email is unknown, no code is pending, the
    // code doesn't match, or it has expired.
    public function verifyResetCode($email, $code) {
        $user = $this->findByEmail($email);
        if (!$user || empty($user['reset_token_hash']) || empty($user['reset_token_expires_at'])) {
            return null;
        }
        if (strtotime($user['reset_token_expires_at']) < time()) {
            return null;
        }
        if (!hash_equals($user['reset_token_hash'], hash('sha256', $code))) {
            return null;
        }
        return $user;
    }

    public function repairDefaultUserHashes() {
        $defaults = [
            'admin' => 'admin123',
            'staff' => 'staff123',
        ];

        foreach ($defaults as $username => $password) {
            $user = $this->findByUsername($username);
            if (!$user) {
                continue;
            }

            $hash = $user['password_hash'] ?? '';
            $info = password_get_info($hash);
            $needsRepair = $hash === ''
                || $info['algo'] === 0
                || !preg_match('/^\$2[ayb]\$/', $hash)
                || strlen($hash) < 60;

            if ($needsRepair) {
                $this->updatePasswordHash($user['user_id'], password_hash($password, PASSWORD_BCRYPT));
            }
        }
    }

    public function ensureDefaultUsers() {
        $this->seedDefaultUsers();
        $this->repairDefaultUserHashes();
    }

    public function seedDefaultUsers() {
        $roleStmt = $this->db->query("SELECT role_id, title FROM roles");
        $roles = [];
        foreach ($roleStmt->fetchAll() as $row) {
            $roles[strtolower($row['title'])] = (int) $row['role_id'];
        }

        $adminRoleId = $roles['admin'] ?? 1;
        $staffRoleId = $roles['staff'] ?? 2;

        $created = false;
        $defaultUsers = [
            [
                'username' => 'admin',
                'password' => 'admin123',
                'full_name' => 'Administrator',
                'email' => 'admin@cemetery.com',
                'role_id' => $adminRoleId,
            ],
            [
                'username' => 'staff',
                'password' => 'staff123',
                'full_name' => 'Staff User',
                'email' => 'staff@cemetery.com',
                'role_id' => $staffRoleId,
            ],
        ];

        foreach ($defaultUsers as $userData) {
            if ($this->findByUsername($userData['username'])) {
                continue;
            }
            $stmt = $this->db->prepare("INSERT INTO users (username, password_hash, full_name, email, role_id, is_active) VALUES (?, ?, ?, ?, ?, 1)");
            $stmt->execute([
                $userData['username'],
                password_hash($userData['password'], PASSWORD_BCRYPT),
                $userData['full_name'],
                $userData['email'],
                $userData['role_id'],
            ]);
            $created = true;
        }

        return $created;
    }
}
