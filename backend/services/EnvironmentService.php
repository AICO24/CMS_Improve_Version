<?php
class EnvironmentService {
    private static $loaded = false;
    private static $values = [];

    public static function loadEnvironment($path = null) {
        if (self::$loaded) {
            return;
        }

        $candidatePaths = [];

        if ($path) {
            $candidatePaths[] = $path;
        }

        $candidatePaths[] = dirname(__DIR__) . '/.env';
        $candidatePaths[] = dirname(dirname(__DIR__)) . '/.env';

        if (defined('CMS_ROOT') && CMS_ROOT) {
            $candidatePaths[] = CMS_ROOT . '/.env';
        }

        if (defined('BACKEND_ROOT') && BACKEND_ROOT) {
            $candidatePaths[] = BACKEND_ROOT . '/.env';
        }

        $candidatePaths = array_values(array_unique(array_filter($candidatePaths)));

        $envPath = null;
        foreach ($candidatePaths as $candidate) {
            if (is_file($candidate)) {
                $envPath = $candidate;
                break;
            }
        }

        if ($envPath === null) {
            self::$loaded = true;
            return;
        }

        $lines = file($envPath, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
        if ($lines === false) {
            self::$loaded = true;
            return;
        }

        foreach ($lines as $line) {
            $trimmed = trim($line);
            if ($trimmed === '' || strpos($trimmed, '#') === 0) {
                continue;
            }

            $parts = explode('=', $trimmed, 2);
            if (count($parts) !== 2) {
                continue;
            }

            $key = trim($parts[0]);
            $value = trim($parts[1]);

            if ((strlen($value) >= 2) && (($value[0] === '"' && substr($value, -1) === '"') || ($value[0] === "'" && substr($value, -1) === "'"))) {
                $value = substr($value, 1, -1);
            }

            self::$values[$key] = $value;
        }

        self::$loaded = true;
    }

    public static function get($key, $default = null) {
        self::loadEnvironment();
        if (array_key_exists($key, self::$values)) {
            return self::$values[$key];
        }

        $value = getenv($key);
        return $value === false ? $default : $value;
    }
}
