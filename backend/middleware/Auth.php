<?php
require_once __DIR__ . '/../config/jwt.php';

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

        return (array) $decoded;
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
