<?php
require_once __DIR__ . '/bootstrap.php';
require_once __DIR__ . '/services/EnvironmentService.php';

header('Content-Type: application/json');

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
