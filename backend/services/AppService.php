<?php
require_once __DIR__ . '/EnvironmentService.php';

class AppService {
    public static function getConfig($key, $default = null) {
        return EnvironmentService::get($key, $default);
    }
}
