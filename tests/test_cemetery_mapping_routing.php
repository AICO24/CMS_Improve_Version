<?php
/**
 * Test Routing in backend/routes/api.php for Cemetery Mapping Endpoints
 */

$tests = [
    [
        'name' => 'GET /api/cemeteries',
        'route' => 'cemeteries',
        'query' => [],
        'expected_code' => 200,
        'check' => function($data) {
            return ($data['success'] ?? false) === true && is_array($data['data'] ?? null) && count($data['data']) > 0;
        }
    ],
    [
        'name' => 'GET /api/map/layout?cemetery_id=1',
        'route' => 'map/layout',
        'query' => ['cemetery_id' => '1'],
        'expected_code' => 200,
        'check' => function($data) {
            return ($data['success'] ?? false) === true && isset($data['data']['cemetery']) && isset($data['data']['sections']);
        }
    ],
    [
        'name' => 'GET /api/map/layout without cemetery_id',
        'route' => 'map/layout',
        'query' => [],
        'expected_code' => 400,
        'check' => function($data) {
            return ($data['success'] ?? true) === false && isset($data['error']);
        }
    ],
    [
        'name' => 'GET /api/map/layout?cemetery_id=999999',
        'route' => 'map/layout',
        'query' => ['cemetery_id' => '999999'],
        'expected_code' => 404,
        'check' => function($data) {
            return ($data['success'] ?? true) === false;
        }
    ],
    [
        'name' => 'GET /api/map/blocks/1/lots',
        'route' => 'map/blocks/1/lots',
        'query' => [],
        'expected_code' => 200,
        'check' => function($data) {
            return ($data['success'] ?? false) === true && isset($data['data']['block']) && isset($data['data']['lots']);
        }
    ],
    [
        'name' => 'GET /api/map/blocks/999999/lots',
        'route' => 'map/blocks/999999/lots',
        'query' => [],
        'expected_code' => 404,
        'check' => function($data) {
            return ($data['success'] ?? true) === false;
        }
    ],
];

$allPassed = true;

foreach ($tests as $t) {
    $tempScript = __DIR__ . '/_temp_route_test.php';
    $getArray = array_merge(['route' => $t['route']], $t['query']);
    $code = "<?php\n"
          . "\$_SERVER['REQUEST_METHOD'] = 'GET';\n"
          . "\$_SERVER['REQUEST_URI'] = '/backend/api.php?" . http_build_query($getArray) . "';\n"
          . "\$_GET = " . var_export($getArray, true) . ";\n"
          . "chdir('c:/laragon/www/CMS');\n"
          . "require 'backend/routes/api.php';\n";
    file_put_contents($tempScript, $code);

    $cmd = 'C:\\laragon\\bin\\php\\php-8.3.33-Win32-vs16-x64\\php.exe "' . $tempScript . '"';
    $output = shell_exec($cmd);
    @unlink($tempScript);

    $json = json_decode((string)$output, true);
    $checkRes = false;
    if ($json !== null) {
        $checkRes = ($t['check'])($json);
    }

    if ($checkRes) {
        echo "[PASS] {$t['name']}\n";
    } else {
        echo "[FAIL] {$t['name']}\nOutput: $output\n";
        $allPassed = false;
    }
}

if (!$allPassed) {
    exit(1);
}
echo "All routing tests passed successfully.\n";
