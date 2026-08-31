<?php
header('Content-Type: application/json');

// Batch 12 (Batch 11 audit finding): every controller in this app eagerly
// connects to the database via its model constructors, and AuthController
// itself is instantiated unconditionally as the very first thing
// routes/api.php does — before any route is even matched. With no
// exception boundary anywhere, a database outage (or any other uncaught
// exception surfacing from bootstrap/routing/controller construction/
// route execution) previously produced PHP's raw fatal-error output
// (stack trace, file paths, SQLSTATE/PDO text) instead of a JSON
// response. This wraps the entire request-handling path in one
// centralized try/catch — the smallest change that protects all of it at
// once, without touching any controller or model. Normal control flow is
// completely unaffected: every route handler in routes/api.php already
// ends with `exit`, and exit()/die() is not an exception — it terminates
// immediately without ever reaching these catch blocks, so successful
// responses and existing controller-level {error, code} responses are
// untouched.
try {
    require_once __DIR__ . '/bootstrap.php';
    require_once __DIR__ . '/services/EnvironmentService.php';

    $allowedOrigins = array_filter(array_map('trim', explode(',', (string) EnvironmentService::get('CORS_ALLOWED_ORIGINS', 'http://localhost'))));
    $requestOrigin = $_SERVER['HTTP_ORIGIN'] ?? '';
    if ($requestOrigin !== '' && in_array($requestOrigin, $allowedOrigins, true)) {
        header('Access-Control-Allow-Origin: ' . $requestOrigin);
    }
    header('Access-Control-Allow-Methods: GET, POST, PUT, DELETE, OPTIONS');
    header('Access-Control-Allow-Headers: Authorization, Content-Type');

    if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
        exit(0);
    }

    require_once __DIR__ . '/routes/api.php';
} catch (Throwable $e) {
    // Classification: a "known database/service availability failure"
    // gets 503; everything else uncaught gets a generic 500. This can't
    // be a clean type-only check — Database::__construct() (backend/
    // config/database.php) catches PDOException and rethrows it as a
    // plain `new RuntimeException(...)`, not a PDOException instance (and
    // not a dedicated subclass — changing that would mean touching
    // Database.php, out of this batch's scope), so an escaped raw
    // PDOException (an unwrapped query-level failure from inside a model
    // method, never caught anywhere) is structurally distinguishable via
    // `instanceof`, but Database's own wrapped connection failure is not.
    // For that one case, matching its own fixed, single-purpose message
    // prefix is the smallest reliable option actually available without
    // changing Database.php — not a fragile/broad pattern, just this
    // exact string that exactly one line of code in the codebase ever
    // produces. Anything else — including config/jwt.php's unrelated
    // "JWT_SECRET must be configured" RuntimeException, and any other
    // uncaught Throwable — correctly falls through to the generic 500.
    $isKnownServiceFailure = $e instanceof PDOException
        || strpos($e->getMessage(), 'Database connection failed:') === 0;

    if ($isKnownServiceFailure) {
        error_log(sprintf('[%s] Uncaught %s (service unavailable): %s in %s:%d', date('Y-m-d H:i:s'), get_class($e), $e->getMessage(), $e->getFile(), $e->getLine()));
        if (!headers_sent()) {
            header('Content-Type: application/json');
            http_response_code(503);
        }
        echo json_encode(['error' => 'Service temporarily unavailable']);
    } else {
        error_log(sprintf('[%s] Uncaught %s: %s in %s:%d', date('Y-m-d H:i:s'), get_class($e), $e->getMessage(), $e->getFile(), $e->getLine()));
        if (!headers_sent()) {
            header('Content-Type: application/json');
            http_response_code(500);
        }
        echo json_encode(['error' => 'Internal server error']);
    }
    exit;
}
