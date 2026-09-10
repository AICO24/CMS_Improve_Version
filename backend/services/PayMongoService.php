<?php
require_once __DIR__ . '/../services/EnvironmentService.php';

/**
 * PayMongoService
 *
 * Batch 2 (Payment Gateway Foundation): the single communication boundary
 * between the CMS backend and PayMongo's API. This is a FOUNDATION ONLY —
 * it does NOT create checkout sessions, does NOT receive webhooks, and does
 * NOT process refunds yet (those arrive in Batch 3+).
 *
 * Responsibilities today:
 *  - load PayMongo configuration entirely from server-side environment
 *    variables via the existing EnvironmentService (never from frontend
 *    input, never committed, never in .env.example as real values)
 *  - validate that configuration without throwing
 *  - centralize HTTP request handling (cURL, same pattern the existing
 *    AIService uses) with Basic-Auth from the secret key
 *  - safe response/error normalization (arrays, never exceptions to callers)
 *  - expose only a public-safe configuration summary; the secret key and
 *    webhook secret are read server-side and are NEVER part of any returned
 *    value from getConfig()/request() and never emitted by any endpoint.
 *
 * Security contract:
 *  - The secret API key stays server-side. This service is never required
 *    by any frontend-facing file other than the PHP API/CLI layers that
 *    deliberately need it (later batches).
 *  - No real credentials are shipped with this batch; with everything unset
 *    the service reports "unconfigured" and every operation fails closed.
 */

class PayMongoService {
    private const DEFAULT_API_BASE = 'https://api.paymongo.com/v1';
    private const DEFAULT_PAYMENT_LIMIT_MIN_CENTS = 100; // PayMongo minimum: 100 centavo units

    private $timeout;
    private $baseUrl;

    /**
     * @param string|null    $baseUrl       Optional override; defaults to PAYMONGO_API_BASE env or the
     *                                      official API base. Server-side only.
     * @param int            $timeoutSeconds cURL timeout in seconds.
     */
    public function __construct($baseUrl = null, $timeoutSeconds = 10) {
        EnvironmentService::loadEnvironment();
        $configuredBase = EnvironmentService::get('PAYMONGO_API_BASE', self::DEFAULT_API_BASE);
        $this->baseUrl = rtrim((string) ($baseUrl ?: $configuredBase), '/');
        $this->timeout = max(1, (int) $timeoutSeconds);
    }

    // ------------------------------------------------------------------
    // Configuration surface (public-safe)
    // ------------------------------------------------------------------

    /**
     * True only when a server-side secret key is present. Test/live mode is
     * derived separately — absence of a key always means "not configured".
     */
    public function isConfigured() {
        $key = $this->secretKey();
        return $key !== null && $key !== '';
    }

    /**
     * One of: 'test', 'live', 'unconfigured'.
     * - 'test' when the key prefix is sk_test_ (or no recognized prefix and
     *   PAYMONGO_ENV is not live/production)
     * - 'live' when the key prefix is sk_live_
     * - 'unconfigured' when no secret key is set.
     *
     * The KEY PREFIX is authoritative (it is what the API actually honors);
     * PAYMONGO_ENV is only a secondary fallback and a validation guard used
     * by validateConfig() to prevent a live key from being used while the
     * environment still says test.
     */
    public function getMode() {
        $key = $this->secretKey();
        if ($key === null || $key === '') {
            return 'unconfigured';
        }

        if (strpos($key, 'sk_live_') === 0) {
            return 'live';
        }
        if (strpos($key, 'sk_test_') === 0) {
            return 'test';
        }

        $env = strtolower(trim((string) EnvironmentService::get('PAYMONGO_ENV', '')));
        if ($env === 'live' || $env === 'production') {
            return 'live';
        }

        return 'test';
    }

    /**
     * Public-safe configuration summary. Deliberately contains NO secret
     * material (no PAYMONGO_SECRET_KEY, no PAYMONGO_WEBHOOK_SECRET, no raw
     * credentials of any kind) so it is safe to return from an endpoint.
     */
    public function getConfig() {
        return [
            'configured' => $this->isConfigured(),
            'mode' => $this->getMode(),
            'currency' => 'PHP',
            'amount_unit' => 'centavos', // PayMongo amounts are integer centavos
            'api_base_url' => $this->baseUrl,
            'has_public_key' => trim((string) EnvironmentService::get('PAYMONGO_PUBLIC_KEY', '')) !== '',
            'checkout_enabled' => $this->isConfigured(),
        ];
    }

    /**
     * Returns ['valid' => bool, 'errors' => string[]].
     * Never throws; the CMS treats a misconfigured gateway as an explicit,
     * reviewable problem rather than masking it or leaking credentials.
     */
    public function validateConfig() {
        $errors = [];

        if ($this->secretKey() === null || $this->secretKey() === '') {
            $errors[] = 'PAYMONGO_SECRET_KEY is not configured.';
        } elseif ($this->getMode() === 'live') {
            // Live keys must match PAYMONGO_ENV so a developer cannot
            // accidentally charge real money from a test checkout.
            $env = trim((string) EnvironmentService::get('PAYMONGO_ENV', ''));
            if ($env !== 'live' && $env !== 'production') {
                $errors[] = 'PAYMONGO_ENV must be "live" when a live secret key is configured.';
            }
        }

        return [
            'valid' => empty($errors),
            'errors' => $errors,
        ];
    }

    /**
     * Create a PayMongo Hosted Checkout Session (Batch 3).
     *
     * @param array       $attributes      Official PayMongo Checkout Session attributes
     *                                     (line_items, payment_method_types, success_url, cancel_url, etc.)
     * @param string|null $idempotencyKey  Deterministic idempotency key for safe retries
     * @return array Normalized response array
     */
    public function createCheckoutSession(array $attributes, $idempotencyKey = null) {
        return $this->request('POST', 'checkout_sessions', [
            'data' => [
                'attributes' => $attributes,
            ],
        ], $idempotencyKey);
    }

    /**
     * Retrieve an existing PayMongo Checkout Session by ID (Batch 3).
     *
     * @param string $sessionId PayMongo checkout session ID (cs_...)
     * @return array Normalized response array
     */
    public function getCheckoutSession($sessionId) {
        $cleanId = trim((string) $sessionId);
        if ($cleanId === '') {
            return ['success' => false, 'status' => 0, 'code' => 0, 'error' => 'Checkout session ID is required'];
        }
        return $this->request('GET', 'checkout_sessions/' . urlencode($cleanId));
    }

    /**
     * Create a PayMongo Refund (Batch 5).
     *
     * @param array       $attributes      Official PayMongo Refund attributes:
     *                                     amount (cents), payment_id (pay_...), reason, notes
     * @param string|null $idempotencyKey  Deterministic idempotency key for safe retries
     * @return array Normalized response array
     */
    public function createRefund(array $attributes, $idempotencyKey = null) {
        return $this->request('POST', 'refunds', [
            'data' => [
                'attributes' => $attributes,
            ],
        ], $idempotencyKey);
    }

    /**
     * Retrieve an existing PayMongo Refund by ID (Batch 5).
     *
     * @param string $refundId PayMongo refund ID (ref_...)
     * @return array Normalized response array
     */
    public function getRefund($refundId) {
        $cleanId = trim((string) $refundId);
        if ($cleanId === '') {
            return ['success' => false, 'status' => 0, 'code' => 0, 'error' => 'Refund ID is required'];
        }
        return $this->request('GET', 'refunds/' . urlencode($cleanId));
    }

    /**
     * Retrieve an existing PayMongo Payment by ID (Batch 8).
     *
     * @param string $paymentId PayMongo payment ID (pay_...)
     * @return array Normalized response array
     */
    public function getPayment($paymentId) {
        $cleanId = trim((string) $paymentId);
        if ($cleanId === '') {
            return ['success' => false, 'status' => 0, 'code' => 0, 'error' => 'Payment ID is required'];
        }
        return $this->request('GET', 'payments/' . urlencode($cleanId));
    }

    /**
     * Generates an idempotency key the PayMongo API requires for safe retries.
     * Foundation for Batch 3+; each retry of the same logical operation should
     * reuse the SAME key (callers decide reuse via a stored value, e.g.
     * "cms-payment-{payment_id}").
     */
    public function newIdempotencyKey($prefix = 'cms-pg') {
        return trim((string) $prefix) . '_' . bin2hex(random_bytes(16));
    }
// ------------------------------------------------------------------
    // HTTP boundary (foundation only)
    // ------------------------------------------------------------------

    /**
     * Generic request to the PayMongo API. Server-side only.
     *
     * @param string            $method         GET|POST|PUT|PATCH|DELETE
     * @param string            $path           API path, e.g. "checkout_sessions"
     * @param array|null        $payload        JSON body (arrays only)
     * @param string|null       $idempotencyKey PayMongo requires an
     *                                          Idempotency-Key on POSTs
     * @return array normalized ['success'=>bool, 'status'=>int, 'data'=>?,
     *                          'error'=>?string]
     */
    public function request($method, $path, $payload = null, $idempotencyKey = null) {
        if (!function_exists('curl_init')) {
            return ['success' => false, 'status' => 0, 'code' => 0,
                    'error' => 'cURL extension is not available'];
        }

        $secret = $this->secretKey();
        if ($secret === null || $secret === '') {
            return ['success' => false, 'status' => 0, 'code' => 0,
                    'error' => 'PayMongo is not configured (missing PAYMONGO_SECRET_KEY)'];
        }

        $url = $this->baseUrl . '/' . ltrim((string) $path, '/');
        $method = strtoupper((string) $method);

        $headers = [
            'Accept: application/json',
            'Content-Type: application/json',
            'Authorization: Basic ' . base64_encode($secret . ':'),
        ];
        if ($idempotencyKey !== null && $idempotencyKey !== '') {
            $headers[] = 'Idempotency-Key: ' . $idempotencyKey;
        }

        $ch = curl_init($url);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, $this->timeout);
        curl_setopt($ch, CURLOPT_TIMEOUT, $this->timeout);
        curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);
        curl_setopt($ch, CURLOPT_SSL_VERIFYHOST, 2);
        curl_setopt($ch, CURLOPT_USERAGENT, 'CMS-PayMongoService/2.0 (+https://github.com/AICO24/CMS_Improve_Version)');

        if ($method === 'GET') {
            curl_setopt($ch, CURLOPT_HTTPGET, true);
        } elseif ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $this->encodePayload($payload));
        } else {
            curl_setopt($ch, CURLOPT_CUSTOMREQUEST, $method);
            if ($payload !== null) {
                curl_setopt($ch, CURLOPT_POSTFIELDS, $this->encodePayload($payload));
            }
        }

        $raw = curl_exec($ch);
        $errno = curl_errno($ch);
        $error = curl_error($ch);
        $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
        curl_close($ch);

        if ($raw === false) {
            return [
                'success' => false,
                'status' => 0,
                'code' => 0,
                'error' => 'PayMongo request failed: ' . ($error !== '' ? $error : ('curl error ' . $errno)),
            ];
        }

        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return [
                'success' => false,
                'status' => $status,
                'code' => $status,
                'error' => 'PayMongo returned a non-JSON response',
            ];
        }

        if ($status >= 200 && $status < 300) {
            return [
                'success' => true,
                'status' => $status,
                'data' => isset($decoded['data']) ? $decoded['data'] : $decoded,
            ];
        }

        return [
            'success' => false,
            'status' => $status,
            'code' => $status,
            'error' => $this->normalizeError($decoded),
        ];
    }

    private function encodePayload($payload) {
        if ($payload === null) {
            return '';
        }
        return json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
    }

    /**
     * Turns a PayMongo error payload into a short, safe message without any
     * secret material.
     */
    private function normalizeError(array $decoded) {
        if (isset($decoded['errors']) && is_array($decoded['errors'])) {
            $messages = [];
            foreach ($decoded['errors'] as $err) {
                if (is_array($err)) {
                    $code = $err['code'] ?? 'error';
                    $detail = $err['detail'] ?? ($err['message'] ?? $code);
                    if (is_array($detail)) {
                        // e.g. PayMongo field-level errors: detail => ["amount": ["is required"]]
                        $flattened = [];
                        array_walk_recursive($detail, function ($item) use (&$flattened) {
                            $flattened[] = (string) $item;
                        });
                        $detail = implode('; ', $flattened);
                    }
                    $messages[] = $code . ': ' . $detail;
                }
            }
            if (!empty($messages)) {
                return implode(' | ', $messages);
            }
        }

        if (isset($decoded['message']) && is_string($decoded['message'])) {
            return $decoded['message'];
        }

        return 'Unknown PayMongo error';
    }

    private function secretKey() {
        $key = trim((string) EnvironmentService::get('PAYMONGO_SECRET_KEY', ''));
        return $key === '' ? null : $key;
    }
}