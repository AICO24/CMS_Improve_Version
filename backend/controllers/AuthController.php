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

        // AUTH-012 (Auth audit follow-up, requested by product owner): the
        // login form's "Sign in as" selector previously had no server-side
        // effect at all — actual access always came from the account's real
        // role (unchanged below), but the field itself was silently ignored,
        // so picking the wrong option gave no feedback. This validates the
        // selection against the account's real role and rejects a mismatch
        // with a clear message, without changing what determines access:
        // $role (from the database) is still the only value that ends up in
        // the JWT and everywhere authorization is checked.
        $requestedLoginRole = isset($data['role']) && trim((string) $data['role']) !== ''
            ? User::normalizeRoleKey($data['role'])
            : null;
        if ($requestedLoginRole !== null && $requestedLoginRole !== $role) {
            $this->auditLogModel->log(
                'Failed login attempt',
                $user['user_id'],
                $user['username'],
                'Authentication',
                $user['user_id'],
                "Role mismatch: selected '$requestedLoginRole', account is '$role'"
            );
            return [
                'error' => 'This account is registered as ' . self::roleLabel($role) . ', not ' . self::roleLabel($requestedLoginRole) . '. Please select the correct role.',
                'code' => 400,
            ];
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

        $rememberMe = filter_var($data['remember_me'] ?? false, FILTER_VALIDATE_BOOLEAN);

        $payload = [
            'user_id' => $user['user_id'],
            'username' => $user['username'],
            'role' => $role,
            'full_name' => $user['full_name'],
            'email_verified' => (bool) ($user['email_verified'] ?? 0),
            // AUTH-004b: checked against the live value in
            // AuthMiddleware::authenticate() on every request — see
            // User::invalidateSessions()'s comment.
            'session_version' => (int) ($user['session_version'] ?? 1),
        ];
        try {
            $expiry = $rememberMe
                ? (int) EnvironmentService::get('JWT_REMEMBER_EXPIRY', 2592000)
                : (int) EnvironmentService::get('JWT_EXPIRY', 28800);
            $token = JWTConfig::encode($payload, $expiry);
        } catch (Exception $e) {
            return ['error' => 'JWT configuration error', 'code' => 500];
        }

        return [
            'success' => true,
            'token' => $token,
            'expires_in' => $expiry,
            'remembered' => $rememberMe,
            'user' => [
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
                'role' => $role,
                'is_active' => (bool) ($user['is_active'] ?? 1),
                'email_verified' => (bool) ($user['email_verified'] ?? 0),
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

    private function isDevOrTesting() {
        $env = strtolower((string) EnvironmentService::get('APP_ENV', 'local'));
        return in_array($env, ['local', 'testing', 'dev', 'development'], true);
    }

    // AUTH-012: human-readable label for the login role-mismatch message —
    // mirrors ROLE_LABELS in assets/js/shared/api.js so the wording matches
    // what the frontend already shows elsewhere.
    private static function roleLabel($role) {
        $labels = ['admin' => 'Administrator', 'staff' => 'Staff', 'user' => 'User'];
        return $labels[$role] ?? ucfirst((string) $role);
    }

    /**
     * Enforce strict password complexity:
     * Minimum 8 characters, at least 1 uppercase, 1 lowercase, 1 number, and 1 special character.
     *
     * @param string $password
     * @return string|null Error message or null if valid
     */
    public static function validatePasswordComplexity($password) {
        $password = (string) $password;
        if (strlen($password) < 8) {
            return 'Password must be at least 8 characters long';
        }
        if (!preg_match('/[A-Z]/', $password)) {
            return 'Password must contain at least one uppercase letter (A-Z)';
        }
        if (!preg_match('/[a-z]/', $password)) {
            return 'Password must contain at least one lowercase letter (a-z)';
        }
        if (!preg_match('/[0-9]/', $password)) {
            return 'Password must contain at least one number (0-9)';
        }
        if (!preg_match('/[^a-zA-Z0-9]/', $password)) {
            return 'Password must contain at least one special character (!@#$%^&*...)';
        }
        return null;
    }

    /**
     * Validate and normalize contact numbers to Philippine standard format (+639XXXXXXXXX).
     *
     * @param string $phone
     * @param bool $isRequired
     * @return array ['valid' => bool, 'normalized' => string|null, 'error' => string|null]
     */
    public static function validateAndNormalizePhone($phone, $isRequired = false) {
        $phone = trim((string) $phone);
        if ($phone === '') {
            if ($isRequired) {
                return ['valid' => false, 'normalized' => null, 'error' => 'Contact number is required'];
            }
            return ['valid' => true, 'normalized' => null, 'error' => null];
        }

        // Must only contain digits, spaces, hyphens, parentheses, and optional leading +
        if (!preg_match('/^\+?[0-9\s\-()]+$/', $phone)) {
            return [
                'valid' => false,
                'normalized' => null,
                'error' => 'Contact number contains invalid characters. Only digits and standard phone separators are allowed.',
            ];
        }

        // Clean down to numeric digits only
        $digits = preg_replace('/[^0-9]/', '', $phone);

        // Standard Philippine mobile numbers:
        // Case 1: 639XXXXXXXXX (12 digits)
        if (str_starts_with($digits, '639') && strlen($digits) === 12) {
            return ['valid' => true, 'normalized' => '+63' . substr($digits, 2), 'error' => null];
        }
        // Case 2: 09XXXXXXXXX (11 digits)
        if (str_starts_with($digits, '09') && strlen($digits) === 11) {
            return ['valid' => true, 'normalized' => '+63' . substr($digits, 1), 'error' => null];
        }
        // Case 3: 9XXXXXXXXX (10 digits)
        if (str_starts_with($digits, '9') && strlen($digits) === 10) {
            return ['valid' => true, 'normalized' => '+63' . $digits, 'error' => null];
        }

        return [
            'valid' => false,
            'normalized' => null,
            'error' => 'Contact number must be a valid Philippine mobile number (e.g. +63 917 123 4567 or 0917 123 4567)',
        ];
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
            $data['first_name'] = $firstName;
            $data['middle_name'] = $middleName ?: null;
            $data['last_name'] = $lastName;
            $data['suffix'] = $suffix ?: null;
        } else {
            $data['full_name'] = trim((string) ($data['full_name'] ?? ''));
            if ($data['full_name'] !== '') {
                require_once __DIR__ . '/DecedentRequestController.php';
                $parsed = DecedentRequestController::parseFullName($data['full_name']);
                $data['first_name'] = $parsed['first_name'] ?: $data['full_name'];
                $data['middle_name'] = $parsed['middle_name'] ?: null;
                $data['last_name'] = $parsed['last_name'] ?: 'User';
                $data['suffix'] = $parsed['suffix'] ?: null;
            }
        }

        $data['email'] = strtolower(trim((string) ($data['email'] ?? '')));
        $data['username'] = trim((string) ($data['username'] ?? ''));
        $data['contact_number'] = trim((string) ($data['contact_number'] ?? ''));
        $data['address'] = trim((string) ($data['address'] ?? ''));

        // Cascading Location hierarchy support: Region -> Province -> City -> District -> Barangay
        $region = trim((string) ($data['region'] ?? ''));
        $province = trim((string) ($data['province'] ?? ''));
        $city = trim((string) ($data['city'] ?? ''));
        $district = trim((string) ($data['district'] ?? ''));
        $barangay = trim((string) ($data['barangay'] ?? ''));

        if ($region !== '' || $province !== '' || $city !== '' || $district !== '' || $barangay !== '') {
            if ($region === '') return ['error' => 'Region is required in location selection', 'code' => 400];
            if ($province === '') return ['error' => 'Province is required in location selection', 'code' => 400];
            if ($city === '') return ['error' => 'City / Municipality is required in location selection', 'code' => 400];
            if ($district === '') return ['error' => 'District is required in location selection', 'code' => 400];
            if ($barangay === '') return ['error' => 'Barangay is required in location selection', 'code' => 400];

            if ($data['address'] === '') {
                $addrParts = [];
                if (!empty($data['street_address'])) {
                    $addrParts[] = trim((string) $data['street_address']);
                }
                $addrParts[] = "Brgy. $barangay";
                $addrParts[] = $district;
                $addrParts[] = $city;
                if ($province !== $city && $province !== 'Metro Manila') {
                    $addrParts[] = $province;
                }
                $addrParts[] = $region;
                $data['address'] = implode(', ', $addrParts);
            }
        }

        $required = ['full_name', 'email', 'password', 'confirm_password'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        if (strlen($data['full_name']) < 2 || strlen($data['full_name']) > 120) {
            return ['error' => 'Full name must be 2 to 120 characters', 'code' => 400];
        }

        if (!filter_var($data['email'], FILTER_VALIDATE_EMAIL)) {
            return ['error' => 'A valid email address is required', 'code' => 400];
        }

        if ($data['username'] !== '' && !preg_match('/^[a-zA-Z0-9._-]{3,40}$/', $data['username'])) {
            return ['error' => 'Username must be 3 to 40 characters and use only letters, numbers, dots, underscores, or hyphens', 'code' => 400];
        }

        // Contact Number validation & normalization (+63 Philippine standard)
        $phoneResult = self::validateAndNormalizePhone($data['contact_number'], false);
        if (!$phoneResult['valid']) {
            return ['error' => $phoneResult['error'], 'code' => 400];
        }
        $data['contact_number'] = $phoneResult['normalized'];

        // Address validation: if provided, must be meaningful (at least 5 characters) and not whitespace-only
        if ($data['address'] !== '') {
            if (strlen($data['address']) < 5) {
                return ['error' => 'Address must be at least 5 characters long', 'code' => 400];
            }
            if (strlen($data['address']) > 255) {
                return ['error' => 'Address must not exceed 255 characters', 'code' => 400];
            }
            if (preg_match_all('/[a-zA-Z0-9]/', $data['address']) < 3) {
                return ['error' => 'Please provide a valid address with street or location details', 'code' => 400];
            }
        } else {
            $data['address'] = null;
        }

        if ($data['password'] !== $data['confirm_password']) {
            return ['error' => 'Password confirmation does not match', 'code' => 400];
        }

        // Password complexity enforcement (minimum 8 chars, uppercase, lowercase, number, special char)
        $pwdError = self::validatePasswordComplexity($data['password']);
        if ($pwdError !== null) {
            return ['error' => $pwdError, 'code' => 400];
        }

        if ($this->userModel->isEmailTaken($data['email'])) {
            return ['error' => 'This email address is already in use by another account. Please use a different email.', 'code' => 409];
        }

        if (!empty($data['username']) && $this->userModel->isUsernameTaken($data['username'])) {
            return ['error' => 'This username is already taken. Please choose a different username.', 'code' => 409];
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $tokenHash = hash('sha256', $code);
        $expiresAt = date('Y-m-d H:i:s', time() + 86400); // 24 hours

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
            'email_verified' => 0,
            'verification_token_hash' => $tokenHash,
            'verification_token_expires_at' => $expiresAt,
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
            $response = [
                'success' => true,
                'message' => 'Registration successful. Please verify your email with the 6-digit verification code.',
                'verification_required' => true,
                'email' => $data['email'],
                'user' => $created ? [
                    'user_id' => $created['user_id'],
                    'username' => $created['username'],
                    'full_name' => $created['full_name'],
                    'email' => $created['email'],
                    'is_active' => (bool) ($created['is_active'] ?? 1),
                    'email_verified' => false,
                ] : null,
            ];
            if (!$this->isProduction() && $this->isDevOrTesting()) {
                $response['dev_verification_code'] = $code;
            }
            return $response;
        }
        return ['error' => 'Registration failed', 'code' => 500];
    }

    // AUTH-004b (Auth audit, Batch AUTH-4b): $userId is resolved by
    // routes/api.php from the Authorization header, if present and valid —
    // decoded leniently there (not via AuthMiddleware::authenticate(), which
    // would hard-fail the request instead of just skipping invalidation) so
    // logout stays a no-fail, idempotent call even against an
    // already-expired/garbage/missing token. When present, this is the one
    // real server-side effect of "logging out" a stateless JWT: see
    // User::invalidateSessions()'s comment.
    public function logout($data, $userId = null) {
        if ($userId !== null) {
            $this->userModel->invalidateSessions($userId);
        }
        return ['success' => true, 'message' => 'Logged out'];
    }

    public function forgotPassword($data) {
        $identifier = trim((string) ($data['identifier'] ?? $data['email'] ?? $data['phone'] ?? ''));
        if ($identifier === '') {
            return ['error' => 'Email address or mobile number is required', 'code' => 400];
        }

        $genericResponse = [
            'success' => true,
            'message' => 'If an account matches our records, a verification code has been generated.',
        ];

        $user = $this->userModel->findByEmailOrPhone($identifier);
        if (!$user) {
            // Same response whether or not the account exists, so this
            // endpoint can't be used to enumerate registered emails or phones.
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
        if (!$this->isProduction() && $this->isDevOrTesting()) {
            $genericResponse['dev_code'] = $code;
        }
        return $genericResponse;
    }

    public function verifyResetCode($data) {
        $identifier = trim((string) ($data['identifier'] ?? $data['email'] ?? $data['phone'] ?? ''));
        $code = trim((string) ($data['code'] ?? ''));
        if ($identifier === '' || $code === '') {
            return ['error' => 'Account identifier and code are required', 'code' => 400];
        }

        $user = $this->userModel->verifyResetCode($identifier, $code);
        if (!$user) {
            return ['error' => 'Invalid or expired code', 'code' => 400];
        }

        return ['success' => true];
    }

    public function resetPassword($data) {
        $identifier = trim((string) ($data['identifier'] ?? $data['email'] ?? $data['phone'] ?? ''));
        $code = trim((string) ($data['code'] ?? ''));
        $password = (string) ($data['password'] ?? '');
        $confirmPassword = (string) ($data['confirm_password'] ?? '');

        if ($identifier === '' || $code === '' || $password === '' || $confirmPassword === '') {
            return ['error' => 'Account identifier, code, and both password fields are required', 'code' => 400];
        }
        if ($password !== $confirmPassword) {
            return ['error' => 'Password confirmation does not match', 'code' => 400];
        }
        // Password complexity enforcement (Batch 1 rules)
        $pwdError = self::validatePasswordComplexity($password);
        if ($pwdError !== null) {
            return ['error' => $pwdError, 'code' => 400];
        }

        $user = $this->userModel->verifyResetCode($identifier, $code);
        if (!$user) {
            return ['error' => 'Invalid or expired code', 'code' => 400];
        }

        $this->userModel->updatePasswordHash($user['user_id'], password_hash($password, PASSWORD_BCRYPT));
        $this->userModel->clearResetToken($user['user_id']);
        // AUTH-004b: a token issued before this reset (e.g. one stolen
        // alongside the password) shouldn't outlive the very password change
        // meant to lock that access out — see User::invalidateSessions()'s
        // comment.
        $this->userModel->invalidateSessions($user['user_id']);

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

    public function verifyContact($data) {
        $email = strtolower(trim((string) ($data['email'] ?? '')));
        $code = trim((string) ($data['code'] ?? ''));

        if ($email === '' || $code === '') {
            return ['error' => 'Email and 6-digit verification code are required', 'code' => 400];
        }

        $user = $this->userModel->verifyContactCode($email, $code);
        if (!$user) {
            return ['error' => 'Invalid or expired verification code', 'code' => 400];
        }

        $this->userModel->markEmailVerified($user['user_id']);

        $this->auditLogModel->log(
            'Contact verification completed',
            $user['user_id'],
            $user['username'],
            'Authentication',
            $user['user_id'],
            'Email successfully verified'
        );

        return [
            'success' => true,
            'message' => 'Email address verified successfully. You may now log in and access all services.',
        ];
    }

    public function resendVerification($data) {
        $email = strtolower(trim((string) ($data['email'] ?? '')));
        if ($email === '') {
            return ['error' => 'Email is required', 'code' => 400];
        }

        $user = $this->userModel->findByEmail($email);
        if (!$user) {
            return [
                'success' => true,
                'message' => 'If an unverified account exists for that email, a new verification code has been dispatched.',
            ];
        }

        if (!empty($user['email_verified'])) {
            return ['error' => 'This account has already been verified', 'code' => 400];
        }

        $code = str_pad((string) random_int(0, 999999), 6, '0', STR_PAD_LEFT);
        $expiresAt = date('Y-m-d H:i:s', time() + 86400); // 24 hours
        $this->userModel->setVerificationToken($user['user_id'], hash('sha256', $code), $expiresAt);

        $this->auditLogModel->log(
            'Verification code resent',
            $user['user_id'],
            $user['username'],
            'Authentication',
            $user['user_id'],
            'New verification code generated'
        );

        $response = [
            'success' => true,
            'message' => 'A new 6-digit verification code has been generated.',
        ];
        if (!$this->isProduction() && $this->isDevOrTesting()) {
            $response['dev_verification_code'] = $code;
        }

        return $response;
    }

    public function me($userId) {
        $user = $this->userModel->findById($userId);
        if (!$user) {
            return ['error' => 'User not found', 'code' => 404];
        }

        return [
            'user_id'           => $user['user_id'],
            'username'          => $user['username'],
            'full_name'         => $user['full_name'],
            'first_name'        => $user['first_name'] ?? null,
            'middle_name'       => $user['middle_name'] ?? null,
            'last_name'         => $user['last_name'] ?? null,
            'suffix'            => $user['suffix'] ?? null,
            'email'             => $user['email'],
            'contact_number'    => $user['contact_number'] ?? null,
            'address'           => $user['address'] ?? null,
            'region'            => $user['region'] ?? null,
            'province'          => $user['province'] ?? null,
            'city'              => $user['city'] ?? null,
            'district'          => $user['district'] ?? null,
            'barangay'          => $user['barangay'] ?? null,
            'role'              => $this->userModel->getRole($userId),
            'is_active'         => (bool) ($user['is_active'] ?? 1),
            'email_verified'    => (bool) ($user['email_verified'] ?? 0),
            'email_verified_at' => $user['email_verified_at'] ?? null,
        ];
    }

    // Self-service profile update (citizen/any authenticated user).
    // Only fields the user is allowed to change on their own account —
    // role_id and is_active are deliberately excluded so a user cannot
    // escalate their own privileges.
    public function updateProfile($userId, $data) {
        $existing = $this->userModel->findById($userId);
        if (!$existing) {
            return ['error' => 'User not found', 'code' => 404];
        }

        $update = [];

        // Name handling: Standardized (First Name, Middle Name, Last Name, Suffix)
        if (isset($data['first_name']) || isset($data['last_name'])) {
            $firstName = trim((string) ($data['first_name'] ?? $existing['first_name'] ?? ''));
            $lastName = trim((string) ($data['last_name'] ?? $existing['last_name'] ?? ''));
            $middleName = isset($data['middle_name']) ? trim((string) $data['middle_name']) : ($existing['middle_name'] ?? null);
            $suffix = isset($data['suffix']) ? trim((string) $data['suffix']) : ($existing['suffix'] ?? null);

            if ($firstName === '') {
                return ['error' => 'First name is required', 'code' => 400];
            }
            if ($lastName === '') {
                return ['error' => 'Last name is required', 'code' => 400];
            }

            $update['first_name'] = $firstName;
            $update['middle_name'] = $middleName ?: null;
            $update['last_name'] = $lastName;
            $update['suffix'] = $suffix ?: null;

            $assembled = trim("$firstName " . ($middleName ? "$middleName " : '') . "$lastName" . ($suffix ? " $suffix" : ''));
            $update['full_name'] = $assembled;
        } elseif (isset($data['full_name'])) {
            $full_name = trim((string) $data['full_name']);
            if ($full_name === '') {
                return ['error' => 'Full name cannot be empty', 'code' => 400];
            }
            $update['full_name'] = $full_name;

            require_once __DIR__ . '/DecedentRequestController.php';
            $parsed = DecedentRequestController::parseFullName($full_name);
            $update['first_name'] = $parsed['first_name'];
            $update['middle_name'] = $parsed['middle_name'];
            $update['last_name'] = $parsed['last_name'];
            $update['suffix'] = $parsed['suffix'];
        }

        // Location handling: Region -> Province -> City/Municipality -> District -> Barangay
        if (array_key_exists('region', $data) || array_key_exists('province', $data) || array_key_exists('city', $data) || array_key_exists('district', $data) || array_key_exists('barangay', $data)) {
            $region = array_key_exists('region', $data) ? trim((string) ($data['region'] ?? '')) : ($existing['region'] ?? null);
            $province = array_key_exists('province', $data) ? trim((string) ($data['province'] ?? '')) : ($existing['province'] ?? null);
            $city = array_key_exists('city', $data) ? trim((string) ($data['city'] ?? '')) : ($existing['city'] ?? null);
            $district = array_key_exists('district', $data) ? trim((string) ($data['district'] ?? '')) : ($existing['district'] ?? null);
            $barangay = array_key_exists('barangay', $data) ? trim((string) ($data['barangay'] ?? '')) : ($existing['barangay'] ?? null);

            // Hierarchy validation: child cannot exist without direct parent
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

            $update['region'] = $region ?: null;
            $update['province'] = $province ?: null;
            $update['city'] = $city ?: null;
            $update['district'] = $district ?: null;
            $update['barangay'] = $barangay ?: null;

            // If an explicit address wasn't passed, compose address from location parts
            if (!isset($data['address'])) {
                $parts = array_filter([$barangay, $district, $city, $province, $region]);
                if (!empty($parts)) {
                    $update['address'] = implode(', ', $parts);
                }
            }
        }

        // Address validation
        if (array_key_exists('address', $data)) {
            $address = trim((string) ($data['address'] ?? ''));
            if ($address !== '' && strlen($address) < 5) {
                return ['error' => 'Address must be at least 5 characters long', 'code' => 400];
            }
            $update['address'] = $address ?: null;
        }

        // Username
        if (isset($data['username'])) {
            $username = trim((string) $data['username']);
            if ($username === '') {
                return ['error' => 'Username cannot be empty', 'code' => 400];
            }
            if (strtolower($username) === strtolower($existing['username'])) {
                return ['error' => 'New username cannot be the same as your current username', 'code' => 400];
            }
            if (strlen($username) < 3 || strlen($username) > 30) {
                return ['error' => 'Username must be between 3 and 30 characters', 'code' => 400];
            }
            if (!preg_match('/^[a-zA-Z0-9_.-]+$/', $username)) {
                return ['error' => 'Username can only contain letters, numbers, dots, hyphens, and underscores', 'code' => 400];
            }
            if (ctype_digit($username)) {
                return ['error' => 'Username cannot be purely numeric', 'code' => 400];
            }
            $reserved = ['admin', 'administrator', 'root', 'user', 'guest', 'superuser', 'system', 'null', 'undefined', 'test', 'anonymous', 'moderator', 'support', 'owner'];
            if (in_array(strtolower($username), $reserved, true)) {
                return ['error' => 'This username is reserved or not allowed', 'code' => 400];
            }
            if (isset($data['username_confirm']) && $username !== trim((string)$data['username_confirm'])) {
                return ['error' => 'New username and confirmation do not match', 'code' => 400];
            }

            // Security: Current password is required to change username
            $currentPassword = (string) ($data['current_password'] ?? '');
            if ($currentPassword === '') {
                return ['error' => 'Current password is required to authorize changing your username', 'code' => 400];
            }
            if (!$this->userModel->verifyPassword($currentPassword, $existing)) {
                return ['error' => 'Current password is incorrect', 'code' => 401];
            }

            if ($this->userModel->isUsernameTaken($username, $userId)) {
                return ['error' => 'Username already taken', 'code' => 409];
            }
            $update['username'] = $username;
        }

        // Email
        if (isset($data['email'])) {
            $email = strtolower(trim((string) $data['email']));
            if ($email === '') {
                return ['error' => 'Email address cannot be empty', 'code' => 400];
            }
            if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                return ['error' => 'A valid email address is required', 'code' => 400];
            }
            if (strtolower(trim($existing['email'])) === $email) {
                return ['error' => 'New email cannot be the same as your current email address', 'code' => 400];
            }

            // Security: Current password is required to authorize changing your email address
            $currentPassword = (string) ($data['current_password'] ?? '');
            if ($currentPassword === '') {
                return ['error' => 'Current password is required to authorize changing your email address', 'code' => 400];
            }
            if (!$this->userModel->verifyPassword($currentPassword, $existing)) {
                return ['error' => 'Current password is incorrect', 'code' => 401];
            }

            // Strict: Disallow if email is already in use by ANY other account in the system
            if ($this->userModel->isEmailTaken($email, $userId)) {
                return ['error' => 'This email address is already in use by another account. Please use a different email.', 'code' => 409];
            }

            $update['email'] = $email;
        }

        // Contact number (nullable, normalized to Philippine standard +639XXXXXXXXX)
        if (array_key_exists('contact_number', $data)) {
            $rawPhone = trim((string) ($data['contact_number'] ?? ''));
            if ($rawPhone !== '') {
                $phoneValidation = self::validateAndNormalizePhone($rawPhone, false);
                if (!$phoneValidation['valid']) {
                    return ['error' => $phoneValidation['error'], 'code' => 400];
                }
                $update['contact_number'] = $phoneValidation['normalized'];
            } else {
                $update['contact_number'] = null;
            }
        }

        // Address (nullable)
        if (array_key_exists('address', $data)) {
            $addr = trim((string) ($data['address'] ?? ''));
            if ($addr !== '') {
                if (strlen($addr) < 5) {
                    return ['error' => 'Address must be at least 5 characters long', 'code' => 400];
                }
                if (strlen($addr) > 255) {
                    return ['error' => 'Address must not exceed 255 characters', 'code' => 400];
                }
                if (preg_match_all('/[a-zA-Z0-9]/', $addr) < 3) {
                    return ['error' => 'Please provide a valid address with street or location details', 'code' => 400];
                }
                $update['address'] = $addr;
            } else {
                $update['address'] = null;
            }
        }

        if (empty($update)) {
            return ['error' => 'No changes provided', 'code' => 400];
        }

        try {
            $result = $this->userModel->update($userId, $update);
        } catch (PDOException $e) {
            if ($e->getCode() === '23000') {
                return ['error' => 'This email address or username is already in use by another account. Please choose a different one.', 'code' => 409];
            }
            throw $e;
        }
        if ($result) {
            $this->auditLogModel->log(
                'Profile updated (self-service)',
                $userId,
                $existing['username'],
                'User',
                $userId,
                array_keys($update)
            );

            $token = null;
            if (isset($update['username'])) {
                $status = $this->userModel->getAuthStatus($userId);
                $newVersion = $status['session_version'] ?? 1;
                $role = $this->userModel->getRole($userId);
                $token = JWTConfig::encode([
                    'user_id'         => $userId,
                    'username'        => $update['username'],
                    'role'            => $role,
                    'session_version' => $newVersion,
                    'iat'             => time(),
                    'exp'             => time() + (int)(getenv('JWT_EXPIRY') ?: 3600),
                ]);
            }

            $response = ['success' => true, 'message' => 'Profile updated successfully'];
            if ($token) {
                $response['token'] = $token;
                $response['username'] = $update['username'];
            }
            return $response;
        }

        return ['error' => 'Failed to update profile', 'code' => 500];
    }

    // Self-service password change. Requires the current password to prevent
    // someone who left a tab open from silently changing the account password.
    // On success, invalidates all other sessions so any stolen token can't
    // outlive the change — the current session re-issues a fresh token in
    // the same response so the user isn't logged out on the page they're on.
    public function changePassword($userId, $data) {
        $currentPassword = (string) ($data['current_password'] ?? '');
        $newPassword     = (string) ($data['new_password'] ?? '');
        $confirmPassword = (string) ($data['confirm_password'] ?? '');

        if ($currentPassword === '' || $newPassword === '' || $confirmPassword === '') {
            return ['error' => 'All three password fields are required', 'code' => 400];
        }

        if ($newPassword !== $confirmPassword) {
            return ['error' => 'New password and confirmation do not match', 'code' => 400];
        }

        if ($currentPassword === $newPassword) {
            return ['error' => 'New password cannot be the same as your current password', 'code' => 400];
        }

        // Password complexity enforcement (minimum 8 chars, uppercase, lowercase, number, special char)
        $pwdError = self::validatePasswordComplexity($newPassword);
        if ($pwdError !== null) {
            return ['error' => $pwdError, 'code' => 400];
        }

        $user = $this->userModel->findById($userId);
        if (!$user) {
            return ['error' => 'User not found', 'code' => 404];
        }

        if (!$this->userModel->verifyPassword($currentPassword, $user)) {
            $this->auditLogModel->log(
                'Failed self-service password change (wrong current password)',
                $userId,
                $user['username'],
                'Authentication',
                $userId,
                'Incorrect current password supplied'
            );
            return ['error' => 'Current password is incorrect', 'code' => 401];
        }

        // Prevent reusing existing password hash
        if ($this->userModel->verifyPassword($newPassword, $user)) {
            return ['error' => 'New password cannot be the same as your current password', 'code' => 400];
        }

        // Security: Disallow common / easily guessed passwords and patterns
        $secError = self::validatePasswordSecurity($newPassword, $user['username'] ?? '');
        if ($secError) {
            return ['error' => $secError, 'code' => 400];
        }

        $logoutAll = !empty($data['logout_all']);

        $this->userModel->updatePasswordHash($userId, password_hash($newPassword, PASSWORD_BCRYPT));
        // Invalidate all prior sessions (session_version increment) so any
        // stolen or lingering tokens are immediately rejected.
        $this->userModel->invalidateSessions($userId);

        $this->auditLogModel->log(
            'Password changed (self-service)',
            $userId,
            $user['username'],
            'Authentication',
            $userId,
            $logoutAll ? 'Password changed successfully; user opted to logout of all sessions' : 'Password changed successfully; user retained current session'
        );

        if ($logoutAll) {
            return [
                'success'    => true,
                'message'    => 'Password changed successfully. You have been logged out of all sessions.',
                'logout_all' => true
            ];
        }

        // Re-issue a fresh JWT so the current tab stays logged in
        // (session_version just incremented, so the old token would
        // otherwise be rejected on the very next request).
        $newVersion = $this->userModel->getAuthStatus($userId)['session_version'] ?? 1;
        $role = $this->userModel->getRole($userId);
        $token = JWTConfig::encode([
            'user_id'         => $userId,
            'username'        => $user['username'],
            'role'            => $role,
            'session_version' => $newVersion,
            'iat'             => time(),
            'exp'             => time() + (int)(getenv('JWT_EXPIRY') ?: 3600),
        ]);

        return [
            'success'    => true,
            'message'    => 'Password changed successfully',
            'token'      => $token,
            'logout_all' => false
        ];
    }

    public static function validatePasswordSecurity($password, $username = '') {
        $lower = strtolower($password);

        // Disallow common / dictionary passwords
        $commonList = [
            '12345678', '123456789', '1234567890', '0987654321', '987654321',
            'password', 'password1', 'password123', 'admin123', 'admin1234', 'administrator',
            'qwerty123', 'qwertyuiop', 'asdfghjkl', 'zxcvbnm123',
            'letmein123', 'welcome123', 'iloveyou123', 'changeme123',
            'cemetery123', 'cmsadmin123', 'cmsstaff123', 'cmsuser123',
            'test1234', 'test12345', 'pass1234', 'pass12345', 'default123'
        ];

        foreach ($commonList as $common) {
            if ($lower === $common || (strpos($lower, $common) !== false && strlen($password) <= strlen($common) + 3)) {
                return 'Password is too common or easily guessed. Please choose a more secure password.';
            }
        }

        // Disallow containing the username
        if (!empty($username) && strlen($username) >= 3) {
            if (stripos($lower, strtolower($username)) !== false) {
                return 'Password cannot contain your username.';
            }
        }

        // Disallow 4+ consecutive identical characters (e.g. 'aaaa', '1111')
        if (preg_match('/(.)\1{3,}/', $password)) {
            return 'Password cannot contain 4 or more repeated characters.';
        }

        // Disallow sequential numbers of 4+ digits (e.g. '1234', '2345', '4321')
        if (preg_match('/(0123|1234|2345|3456|4567|5678|6789|7890|9876|8765|7654|6543|5432|4321|3210)/', $password)) {
            return 'Password cannot contain sequential number patterns (e.g. 1234, 4321).';
        }

        // Disallow sequential alphabetical runs of 4+ letters
        $sequences = ['abcd', 'bcde', 'cdef', 'defg', 'efgh', 'fghi', 'ghij', 'hijk', 'ijkl', 'jklm', 'klmn', 'lmno', 'mnop', 'nopq', 'opqr', 'pqrs', 'qrst', 'rstu', 'stuv', 'tuvw', 'uvwx', 'vwxy', 'wxyz', 'dcba', 'edcb', 'fedc', 'gfed', 'hgfe', 'ihgf', 'jihg', 'kjih', 'lkji', 'mlkj', 'nmlk', 'onml', 'ponm', 'qpon', 'rqpo', 'srqp', 'tsrq', 'utsr', 'vuts', 'wvut', 'xwvu', 'yxwv', 'zyxw'];
        foreach ($sequences as $seq) {
            if (stripos($lower, $seq) !== false) {
                return 'Password cannot contain sequential letter patterns (e.g. abcd).';
            }
        }

        return null;
    }
}
