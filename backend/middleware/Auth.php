<?php
require_once __DIR__ . '/../config/jwt.php';
require_once __DIR__ . '/../models/User.php';

class AuthMiddleware {
    public static function authenticate() {
        $headers = getallheaders();
        $authHeader = $headers['Authorization'] ?? '';

        if (empty($authHeader) || !preg_match('/Bearer\s(\S+)/', $authHeader, $matches)) {
            http_response_code(401);
            echo json_encode(['error' => 'Authorization header required (Bearer token)']);
            exit;
        }

        try {
            $decoded = JWTConfig::decode($matches[1]);
        } catch (Exception $e) {
            http_response_code(500);
            echo json_encode(['error' => 'JWT configuration error']);
            exit;
        }

        if (!$decoded) {
            http_response_code(401);
            echo json_encode(['error' => 'Invalid or expired token']);
            exit;
        }

        $payload = (array) $decoded;

        // AUTH-004 (Auth audit, Batch AUTH-4): re-check current role/is_active
        // against the database on every authenticated request rather than
        // trusting the JWT's own copy of them — see User::getAuthStatus()'s
        // comment. This is one extra indexed lookup per request, in exchange
        // for role changes and deactivation taking effect immediately instead
        // of at the mercy of the token's remaining lifetime.
        $status = (new User())->getAuthStatus($payload['user_id'] ?? null);
        if ($status === null) {
            http_response_code(401);
            echo json_encode(['error' => 'Invalid or expired token']);
            exit;
        }
        if (!$status['is_active']) {
            http_response_code(403);
            echo json_encode(['error' => 'Account is deactivated']);
            exit;
        }
        $payload['role'] = $status['role'];

        return $payload;
    }

    public static function requireRole($allowedRoles) {
        $user = self::authenticate();
        if (!in_array($user['role'], $allowedRoles, true)) {
            http_response_code(403);
            echo json_encode(['error' => 'Insufficient permissions']);
            exit;
        }

        return $user;
    }
}
