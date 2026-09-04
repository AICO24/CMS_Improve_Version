<?php
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../config/jwt.php';
require_once __DIR__ . '/../services/EnvironmentService.php';

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

        if ($inputUser === '' || $password === '') {
            return ['error' => 'Email/Username and password are required', 'code' => 400];
        }

        if (!$this->isProduction() && strtolower((string) EnvironmentService::get('SEED_DEFAULT_USERS', 'false')) === 'true') {
            $this->userModel->ensureDefaultUsers();
        }
        // allow login by email or username
        if (filter_var($inputUser, FILTER_VALIDATE_EMAIL)) {
            $user = $this->userModel->findByEmail($inputUser);
        } else {
            $user = $this->userModel->findByUsername($inputUser);
        }
        if (!$user || !$this->userModel->verifyPassword($password, $user)) {
            // AUTH-005 (Auth audit, Batch AUTH-2): only successful logins were
            // ever audited — a brute-force run left no trail at all. user_id
            // is null when $inputUser doesn't match any account, so this
            // still records the attempted identifier without implying a real
            // account exists (this log is admin-only, never returned to the
            // client, so it isn't an enumeration risk the way an API
            // response would be).
            $this->auditLogModel->log(
                'Failed login attempt',
                $user['user_id'] ?? null,
                $user['username'] ?? $inputUser,
                'Authentication',
                $user['user_id'] ?? null,
                'Invalid credentials'
            );
            return ['error' => 'Invalid credentials', 'code' => 401];
        }

        if (isset($user['is_active']) && (int) $user['is_active'] === 0) {
            $this->auditLogModel->log(
                'Failed login attempt',
                $user['user_id'],
                $user['username'],
                'Authentication',
                $user['user_id'],
                'Account is deactivated'
            );
            return ['error' => 'Account is deactivated', 'code' => 403];
        }

        $role = User::normalizeRoleKey($this->userModel->getRole($user['user_id']));

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
        try {
            $token = JWTConfig::encode($payload);
        } catch (Exception $e) {
            return ['error' => 'JWT configuration error', 'code' => 500];
        }

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

    // AUTH-001/AUTH-003 (Auth audit, Batch AUTH-1): a single switch that keeps
    // dev-only behavior (default-user seeding, returning reset codes directly
    // instead of emailing them) inert on a real deployment even if
    // SEED_DEFAULT_USERS is accidentally left true or no mail service has
    // been wired up yet — see the APP_ENV comment in .env.example.
    private function isProduction() {
        return strtolower((string) EnvironmentService::get('APP_ENV', 'local')) === 'production';
    }

    public function register($data) {
        // Support two registration flows: admin/staff via existing register UI (which provides username),
        // and public user registration (provides full_name, email, contact_number, address, password).
        // Decide public-user by explicit role='user' when provided, otherwise fall back to empty username.
        $requestedRole = isset($data['role']) ? strtolower(trim((string) $data['role'])) : null;
        if ($requestedRole === 'admin' || $requestedRole === 'staff') {
            return ['error' => 'Registration with admin or staff role is not allowed', 'code' => 403];
        }

        // Anonymous registration is limited to normal users only.
        $required = ['full_name', 'email', 'password', 'confirm_password'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        // AUTH-009 (Auth audit, Batch AUTH-2): register.js's own email check
        // is only `.includes('@')` and, being client-side, is trivially
        // bypassed entirely — this was the only real validation actually in
        // force.
        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            return ['error' => 'A valid email address is required', 'code' => 400];
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

        // AUTH-006 (Auth audit, Batch AUTH-2): only email was pre-checked —
        // an explicitly chosen duplicate username reached User::create()'s
        // INSERT unchecked, which throws PDOException on the table's UNIQUE
        // key (PDO is ERRMODE_EXCEPTION — see backend/config/database.php).
        // Nothing here caught it, so it surfaced via the global handler in
        // backend/api/index.php as a misleading 503 "Service temporarily
        // unavailable" instead of a 409.
        if (!empty($data['username']) && $this->userModel->findByUsername($data['username'])) {
            return ['error' => 'Username already taken', 'code' => 409];
        }

        // Ignore any submitted role_id and always assign normal user role for anonymous registration.
        $data['role_id'] = $this->userModel->ensureUserRoleExists();
        $createData = [
            'username' => !empty($data['username']) ? $data['username'] : null,
            'full_name' => $data['full_name'],
            'email' => $data['email'],
            'password' => $data['password'],
            'contact_number' => $data['contact_number'] ?? null,
            'address' => $data['address'] ?? null,
            'role_id' => $data['role_id'],
        ];

        try {
            $result = $this->userModel->create($createData);
        } catch (PDOException $e) {
            // Safety net for the case the explicit check above can't catch:
            // no username was submitted, so User::create() derives one from
            // the email's local part (e.g. "john" from john@gmail.com) —
            // two different emails can derive the same username, and this
            // also covers the race window between the check above and this
            // INSERT. SQLSTATE 23000 is a constraint violation; with email
            // already confirmed unique above, that leaves username as the
            // only remaining UNIQUE key that could have fired it.
            if ($e->getCode() === '23000') {
                return ['error' => 'Username already taken', 'code' => 409];
            }
            throw $e;
        }
        if ($result) {
            $created = $this->userModel->findByEmail($data['email']);
            if ($created) {
                $this->auditLogModel->log(
                    'Citizen self-registration',
                    $created['user_id'],
                    $created['username'],
                    'User',
                    $created['user_id'],
                    ['registered_email' => $created['email']]
                );
            }
            // Batch 14 (found during the Batch 13/14 audit of this file's
            // User-model consumers, same class of issue as GET /users):
            // $created is User::findByEmail()'s raw row — includes
            // password_hash — and was being returned to the client as-is.
            // The frontend (assets/js/auth/register.js) never reads this
            // `user` field at all, so this only ever mattered for API
            // consistency; kept present but reduced to the same safe
            // subset login()/me() below already use, rather than dropped,
            // to preserve the existing response shape for any other
            // consumer.
            return [
                'success' => true,
                'message' => 'Registration successful',
                'user' => $created ? [
                    'user_id' => $created['user_id'],
                    'username' => $created['username'],
                    'full_name' => $created['full_name'],
                    'email' => $created['email'],
                    'is_active' => (bool) ($created['is_active'] ?? 1),
                ] : null,
            ];
        }
        return ['error' => 'Registration failed', 'code' => 500];
    }

    public function logout($data) {
        // Stateless JWT: logout is performed client-side by clearing token.
        // This endpoint exists to provide a consistent API and allow server-side
        // hooks in future (token blacklist, audits).
        return ['success' => true, 'message' => 'Logged out'];
    }

    public function forgotPassword($data) {
        $email = trim((string) ($data['email'] ?? ''));
        if ($email === '') {
            return ['error' => 'Email is required', 'code' => 400];
        }

        $genericResponse = [
            'success' => true,
            'message' => 'If an account exists for that email, a verification code has been generated.',
        ];

        $user = $this->userModel->findByEmail($email);
        if (!$user) {
            // Same response whether or not the account exists, so this
            // endpoint can't be used to enumerate registered emails.
            return $genericResponse;
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expiresAt = date('Y-m-d H:i:s', time() + 600); // 10 minutes
        $this->userModel->setResetToken($user['user_id'], hash('sha256', $code), $expiresAt);

        $this->auditLogModel->log(
            'Password reset requested',
            $user['user_id'],
            $user['username'],
            'Authentication',
            $user['user_id'],
            'Verification code generated'
        );

        $genericResponse['expires_in_minutes'] = 10;
        if (!$this->isProduction()) {
            // Dev-mode stand-in: no SMTP/mail capability exists in this
            // codebase yet, so the code is returned directly instead of
            // emailed. isProduction() keeps this off on a real deployment
            // regardless of that — see its own comment. When real email
            // delivery is added later, remove this block and send the code
            // instead — verifyResetCode()/resetPassword() don't need to change.
            $genericResponse['dev_code'] = $code;
        }
        return $genericResponse;
    }

    public function verifyResetCode($data) {
        $email = trim((string) ($data['email'] ?? ''));
        $code = trim((string) ($data['code'] ?? ''));
        if ($email === '' || $code === '') {
            return ['error' => 'Email and code are required', 'code' => 400];
        }

        $user = $this->userModel->verifyResetCode($email, $code);
        if (!$user) {
            return ['error' => 'Invalid or expired code', 'code' => 400];
        }

        return ['success' => true];
    }

    public function resetPassword($data) {
        $email = trim((string) ($data['email'] ?? ''));
        $code = trim((string) ($data['code'] ?? ''));
        $password = (string) ($data['password'] ?? '');
        $confirmPassword = (string) ($data['confirm_password'] ?? '');

        if ($email === '' || $code === '' || $password === '' || $confirmPassword === '') {
            return ['error' => 'Email, code, and both password fields are required', 'code' => 400];
        }
        if ($password !== $confirmPassword) {
            return ['error' => 'Password confirmation does not match', 'code' => 400];
        }
        if (strlen($password) < 6) {
            return ['error' => 'Password must be at least 6 characters', 'code' => 400];
        }

        $user = $this->userModel->verifyResetCode($email, $code);
        if (!$user) {
            return ['error' => 'Invalid or expired code', 'code' => 400];
        }

        $this->userModel->updatePasswordHash($user['user_id'], password_hash($password, PASSWORD_BCRYPT));
        $this->userModel->clearResetToken($user['user_id']);

        $this->auditLogModel->log(
            'Password reset completed',
            $user['user_id'],
            $user['username'],
            'Authentication',
            $user['user_id'],
            'Password changed via forgot-password flow'
        );

        return ['success' => true, 'message' => 'Password reset successful'];
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
