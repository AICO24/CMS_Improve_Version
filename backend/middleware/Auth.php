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

        // AUTH-004b: reject any token whose embedded session_version isn't
        // the user's CURRENT one — see User::invalidateSessions()'s comment
        // for why this is a counter (bumped on logout/password-change)
        // rather than a timestamp compared against the token's `iat`: that
        // was tried first and had a real same-second tie collision that let
        // a token permanently escape invalidation. A token issued before
        // this claim existed has no session_version at all, which
        // (int) null-coalesces to 0 and correctly never matches a real
        // account's version (starts at 1), so it's rejected the same way —
        // pre-existing sessions get signed out once when this ships.
        if ((int) ($payload['session_version'] ?? 0) !== $status['session_version']) {
            http_response_code(401);
            echo json_encode(['error' => 'Invalid or expired token']);
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
