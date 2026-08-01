<?php
require_once __DIR__ . '/../services/EnvironmentService.php';

class JWTConfig {
    private static $secret;
    private static $algorithm = 'HS256';
    private static $expiry;

    private static function initialize() {
        if (self::$secret !== null && self::$expiry !== null) {
            return;
        }

        EnvironmentService::loadEnvironment(dirname(__DIR__) . '/.env');
        $secret = EnvironmentService::get('JWT_SECRET');
        if (!is_string($secret) || trim($secret) === '') {
            throw new RuntimeException('JWT_SECRET must be configured and must not be empty');
        }

        self::$secret = $secret;
        self::$expiry = (int) EnvironmentService::get('JWT_EXPIRY', 3600);
    }

    public static function encode($payload) {
        self::initialize();

        $header = [
            'typ' => 'JWT',
            'alg' => self::$algorithm,
        ];

        $payload['iat'] = time();
        $payload['exp'] = time() + self::$expiry;

        $headerSegment = self::base64urlEncode(json_encode($header));
        $payloadSegment = self::base64urlEncode(json_encode($payload));
        $signatureInput = $headerSegment . '.' . $payloadSegment;
        $signature = hash_hmac('sha256', $signatureInput, self::$secret, true);

        return $headerSegment . '.' . $payloadSegment . '.' . self::base64urlEncode($signature);
    }

    public static function decode($token) {
        self::initialize();

        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            return null;
        }

        [$headerSegment, $payloadSegment, $signature] = $parts;
        $expectedSignature = self::base64urlEncode(hash_hmac('sha256', $headerSegment . '.' . $payloadSegment, self::$secret, true));

        if (!hash_equals($expectedSignature, $signature)) {
            return null;
        }

        $payload = json_decode(self::base64urlDecode($payloadSegment), true);
        if (!$payload || !isset($payload['exp']) || $payload['exp'] < time()) {
            return null;
        }

        return $payload;
    }

    private static function base64urlEncode($data) {
        return rtrim(strtr(base64_encode($data), '+/', '-_'), '=');
    }

    private static function base64urlDecode($data) {
        $remainder = strlen($data) % 4;
        if ($remainder) {
            $data .= str_repeat('=', 4 - $remainder);
        }

        return base64_decode(strtr($data, '-_', '+/'));
    }
}
