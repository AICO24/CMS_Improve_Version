<?php
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../config/jwt.php';

class AuthController {
    private $userModel;
    private $auditLogModel;

    public function __construct() {
        $this->userModel = new User();
        $this->auditLogModel = new AuditLog();
    }

    public function login($data) {
        $inputUser = trim((string) ($data['username'] ?? $data['email'] ?? ''));
        $password = (string) ($data['password'] ?? '');
        $selectedRole = isset($data['role']) ? strtolower((string) $data['role']) : null;

        if ($inputUser === '' || $password === '') {
            return ['error' => 'Email/Username and password are required', 'code' => 400];
        }

        $this->userModel->ensureDefaultUsers();
        // allow login by email or username
        if (filter_var($inputUser, FILTER_VALIDATE_EMAIL)) {
            $user = $this->userModel->findByEmail($inputUser);
        } else {
            $user = $this->userModel->findByUsername($inputUser);
        }
        if (!$user || !$this->userModel->verifyPassword($password, $user)) {
            return ['error' => 'Invalid credentials', 'code' => 401];
        }

        if (isset($user['is_active']) && (int) $user['is_active'] === 0) {
            return ['error' => 'Account is deactivated', 'code' => 403];
        }

        $role = $this->userModel->getRole($user['user_id']);
        if ($selectedRole && $role && $selectedRole !== $role) {
            return ['error' => 'Selected role does not match the account role', 'code' => 403];
        }

        $this->userModel->updateLastLogin($user['user_id']);
        $this->auditLogModel->log(
            'User login',
            $user['user_id'],
            $user['username'],
            'Authentication',
            $user['user_id'],
            'Login successful'
        );

        $payload = [
            'user_id' => $user['user_id'],
            'username' => $user['username'],
            'role' => $role,
            'full_name' => $user['full_name'],
        ];
        $token = JWTConfig::encode($payload);

        return [
            'success' => true,
            'token' => $token,
            'user' => [
                'user_id' => $user['user_id'],
                'username' => $user['username'],
                'full_name' => $user['full_name'],
                'email' => $user['email'],
                'role' => $role,
                'is_active' => (bool) ($user['is_active'] ?? 1),
            ],
        ];
    }

    public function register($data) {
        // Support two registration flows: admin/staff via existing register UI (which provides username),
        // and public user registration (provides full_name, email, contact_number, address, password).
        // Decide public-user by explicit role='user' when provided, otherwise fall back to empty username.
        $isPublicUser = false;
        if (isset($data['role']) && strtolower($data['role']) === 'user') {
            $isPublicUser = true;
        } elseif (empty($data['username'])) {
            $isPublicUser = true;
        }

        if ($isPublicUser) {
            $required = ['full_name', 'email', 'password', 'confirm_password'];
            foreach ($required as $field) {
                if (empty($data[$field])) {
                    return ['error' => "Field '$field' is required", 'code' => 400];
                }
            }

            if ($data['password'] !== $data['confirm_password']) {
                return ['error' => 'Password confirmation does not match', 'code' => 400];
            }

            if (strlen($data['password']) < 6) {
                return ['error' => 'Password must be at least 6 characters', 'code' => 400];
            }

            if ($this->userModel->findByEmail($data['email'])) {
                return ['error' => 'Email already registered', 'code' => 409];
            }

            // Ensure user role exists and set role_id
            $data['role_id'] = $this->userModel->ensureUserRoleExists();
            // map fields
            $createData = [
                'full_name' => $data['full_name'],
                'email' => $data['email'],
                'password' => $data['password'],
                'contact_number' => $data['contact_number'] ?? null,
                'address' => $data['address'] ?? null,
                'role_id' => $data['role_id'],
            ];

            $result = $this->userModel->create($createData);
            if ($result) {
                $created = $this->userModel->findByEmail($data['email']);
                return ['success' => true, 'message' => 'Registration successful', 'user' => $created];
            }
            return ['error' => 'Registration failed', 'code' => 500];
        }

        // Existing admin/staff creation flow (username provided)
        $required = ['username', 'password', 'full_name', 'email'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        if ($this->userModel->findByUsername($data['username'])) {
            return ['error' => 'Username already taken', 'code' => 409];
        }

        if ($this->userModel->findByEmail($data['email'])) {
            return ['error' => 'Email already registered', 'code' => 409];
        }

        // Resolve role id server-side to avoid front-end id mismatches
        if (!empty($data['role'])) {
            $resolved = $this->userModel->getRoleIdByTitle($data['role']);
            $data['role_id'] = $resolved ?? ($data['role_id'] ?? 2);
        } else {
            $data['role_id'] = $data['role_id'] ?? 2;
        }
        $result = $this->userModel->create($data);
        if ($result) {
            $created = $this->userModel->findByEmail($data['email']);
            return ['success' => true, 'message' => 'User registered successfully', 'user' => $created];
        }
        return ['error' => 'Registration failed', 'code' => 500];
    }

    public function logout($data) {
        // Stateless JWT: logout is performed client-side by clearing token.
        // This endpoint exists to provide a consistent API and allow server-side
        // hooks in future (token blacklist, audits).
        return ['success' => true, 'message' => 'Logged out'];
    }

    public function me($userId) {
        $user = $this->userModel->findById($userId);
        if (!$user) {
            return ['error' => 'User not found', 'code' => 404];
        }

        return [
            'user_id' => $user['user_id'],
            'username' => $user['username'],
            'full_name' => $user['full_name'],
            'email' => $user['email'],
            'role' => $this->userModel->getRole($userId),
            'is_active' => (bool) ($user['is_active'] ?? 1),
        ];
    }
}
