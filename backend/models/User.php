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

    public function findAll($filters = []) {
        $sql = "SELECT u.*, r.title AS role_title FROM users u JOIN roles r ON u.role_id = r.role_id WHERE 1=1";
        $params = [];

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

        $sql .= " ORDER BY u.created_at DESC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
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
