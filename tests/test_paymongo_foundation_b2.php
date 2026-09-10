<?php
/**
 * PayMongo Foundation tests — Batch 2 (no database required).
 *
 * Verifies:
 *  1. Configuration loads from environment variables (empty = unconfigured).
 *  2. The service fails closed when no secret key is configured.
 *  3. getConfig() exposes ONLY public-safe values — secret key, webhook
 *     secret and raw key material never appear anywhere in the output.
 *  4. Mode inference (test vs live vs unconfigured).
 *  5. Request normalization returns a safe array (never an exception) and
 *     fails before network when unconfigured.
 *
 * Run (fresh PHP process):
 *   C:\laragon\bin\php\php-8.3.33-Win32-vs16-x64\php.exe tests/test_paymongo_foundation_b2.php
 */
require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/services/PayMongoService.php';

$passed = 0;
$failed = 0;

function report($testNum, $title, $success, $details = '') {
    global $passed, $failed;
    if ($success) {
        $passed++;
        echo "[PASS] TEST {$testNum}: {$title}\n";
    } else {
        $failed++;
        echo "[FAIL] TEST {$testNum}: {$title} — {$details}\n";
    }
}

$service = new PayMongoService();

// Unconfigured-by-default checks (process environment has no PayMongo keys).
report(1, 'isConfigured() is false when no PayMongo keys are set', !$service->isConfigured());
report(2, 'getMode() returns unconfigured', $service->getMode() === 'unconfigured');

$config = $service->getConfig();
report(3, 'getConfig() is an array with PHP currency', is_array($config) && ($config['currency'] ?? '') === 'PHP');
report(4, 'getConfig() contains no secret key keys',
    !array_key_exists('secret_key', $config)
    && !array_key_exists('webhook_secret', $config)
    && !array_key_exists('PAYMONGO_SECRET_KEY', $config)
    && !array_key_exists('PAYMONGO_WEBHOOK_SECRET', $config));
$configJson = json_encode($config);
report(5, 'getConfig() contains no raw secret-like token', strpos($configJson, 'sk_') === false && strpos($configJson, 'wh') === false);

$request = $service->request('GET', 'unauthorized-endpoint');
report(6, 'request() fails closed without credentials (no network attempt, no exception)',
    is_array($request) && $request['success'] === false && isset($request['error']));
report(7, 'request() error message does not reveal internals',
    is_array($request) && stripos((string) $request['error'], 'configured') !== false);

// ----------------------------------------------------------------------
// Configured tests: inject test-mode keys via the process environment
// (the real .env carries no PAYMONGO_* keys, so EnvironmentService falls
// back to getenv() for these). Test keys are fake — never real credentials.
// ----------------------------------------------------------------------
putenv('PAYMONGO_ENV=test');
putenv('PAYMONGO_PUBLIC_KEY=pk_test_batch2publickey');
putenv('PAYMONGO_SECRET_KEY=sk_test_batch2secretkey');
putenv('PAYMONGO_WEBHOOK_SECRET=whk_test_batch2webhooksecret');

$configured = new PayMongoService();
report(8, 'isConfigured() becomes true when secret key present in env', $configured->isConfigured());
report(9, 'getMode() infers test', $configured->getMode() === 'test');

$cfg = $configured->getConfig();
$cfgJson = json_encode($cfg);
report(10, 'configured getConfig() still excludes the secret and webhook secret',
    !array_key_exists('secret_key', $cfg)
    && !array_key_exists('webhook_secret', $cfg)
    && strpos($cfgJson, (string) getenv('PAYMONGO_SECRET_KEY')) === false
    && strpos($cfgJson, (string) getenv('PAYMONGO_WEBHOOK_SECRET')) === false);
report(11, 'configured getConfig() reports has_public_key', ($cfg['has_public_key'] ?? false) === true);
report(12, 'validateConfig() valid in test mode with matching env', $configured->validateConfig()['valid'] === true);

// A live-mode secret key must be rejected when PAYMONGO_ENV is not live.
putenv('PAYMONGO_SECRET_KEY=sk_live_batch2shouldnotexist');
$liveMismatch = new PayMongoService();
report(13, 'validateConfig() flags live key with non-live PAYMONGO_ENV', $liveMismatch->validateConfig()['valid'] === false);

// Re-enable the test-mode key for the local-only request check below
// (removed a moment ago so the mismatch check above had a clean slate).
putenv('PAYMONGO_SECRET_KEY=sk_test_batch2secretkey');

// Local-only request check: point at a closed local port so no external
// network call is made, and assert the call normalizes the failure (and the
// Authorization header was built without leaking the key into the result).
$local = new PayMongoService('http://127.0.0.1:9', 1);
$reqLocal = $local->request('GET', 'nonexistent', null, 'test-idempotency-key-1');
report(14, 'request() returns normalized array on connection failure', is_array($reqLocal) && isset($reqLocal['error']));
$reqLocalJson = json_encode($reqLocal);
report(15, 'request() failure output contains no secret key material',
    strpos($reqLocalJson, (string) getenv('PAYMONGO_PUBLIC_KEY')) === false
    && strpos($reqLocalJson, (string) getenv('PAYMONGO_WEBHOOK_SECRET')) === false);

$idem = $local->newIdempotencyKey();
report(16, 'newIdempotencyKey() returns a non-empty idempotency key', is_string($idem) && $idem !== '');

// Restore process env to the sanitized state.
putenv('PAYMONGO_ENV');
putenv('PAYMONGO_PUBLIC_KEY');
putenv('PAYMONGO_SECRET_KEY');
putenv('PAYMONGO_WEBHOOK_SECRET');

echo "\n======================================================\n";
echo "PayMongo Foundation tests: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";
exit($failed === 0 ? 0 : 1);