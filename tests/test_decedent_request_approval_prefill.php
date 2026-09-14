<?php
/**
 * CMS DECEDENT RECORDS AUTOMATION AUDIT - BATCH 3 TEST SUITE
 *
 * Tests:
 * 1. Intelligent Name Splitting (DecedentRequestController::parseFullName)
 *    - Suffix extraction (Jr, Sr, Roman numerals)
 *    - Inverted format with comma ("Last, First Middle Suffix")
 *    - Compound Filipino/Spanish surnames (De La Cruz, Del Rosario, San Jose)
 *    - Middle initial & compound first name handling
 *    - ALL CAPS to Title Case normalization
 * 2. DecedentRequestController::index() & mine() parsed_name enrichment
 * 3. AiController::extractCertificate disk resolution for request attachments
 */

require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/DecedentRequest.php';
require_once __DIR__ . '/../backend/controllers/DecedentRequestController.php';
require_once __DIR__ . '/../backend/controllers/AiController.php';
require_once __DIR__ . '/../backend/services/AIService.php';

$totalPassed = 0;
$totalFailed = 0;

function assertTest($description, $condition, &$totalPassed, &$totalFailed) {
    if ($condition) {
        echo "  [PASS] " . $description . "\n";
        $totalPassed++;
    } else {
        echo "  [FAIL] " . $description . "\n";
        $totalFailed++;
    }
}

echo "=======================================================\n";
echo "BATCH 3: AUTOMATED DATA PREFILL & CITIZEN REQUEST TEST\n";
echo "=======================================================\n\n";

// ======================================================================
// GROUP 1: Intelligent Name Splitting (parseFullName)
// ======================================================================
echo "Group 1: Intelligent Name Splitting (parseFullName)\n";

$testCases = [
    // [Input, Expected First, Expected Middle, Expected Last, Expected Suffix, Description]
    [
        'Juan Dela Cruz',
        'Juan', '', 'Dela Cruz', '',
        'Simple two-word + compound surname'
    ],
    [
        'Juan Santos Jr.',
        'Juan', '', 'Santos', 'Jr.',
        'Name with standard suffix "Jr."'
    ],
    [
        'Juan Santos Jr',
        'Juan', '', 'Santos', 'Jr.',
        'Name with suffix without period "Jr"'
    ],
    [
        'PEDRO PENDUKO SR.',
        'Pedro', '', 'Penduko', 'Sr.',
        'ALL CAPS with suffix'
    ],
    [
        'John Paul III',
        'John', '', 'Paul', 'III',
        'Name with Roman numeral suffix "III"'
    ],
    [
        'Maria Clara De La Cruz',
        'Maria Clara', '', 'De La Cruz', '',
        'Compound first name with multi-word compound surname'
    ],
    [
        'Juan M. Santos',
        'Juan', 'M.', 'Santos', '',
        'Standard name with middle initial'
    ],
    [
        'Juan M Santos Jr.',
        'Juan', 'M.', 'Santos', 'Jr.',
        'Name with middle initial and suffix'
    ],
    [
        'John Paul B. San Jose',
        'John Paul', 'B.', 'San Jose', '',
        'Compound first name, middle initial, and compound surname'
    ],
    [
        'Jose Protacio Rizal',
        'Jose Protacio', '', 'Rizal', '',
        'Historic compound first name'
    ],
    [
        'Santos, Juan M.',
        'Juan', 'M.', 'Santos', '',
        'Inverted comma format with middle initial'
    ],
    [
        'Dela Cruz, Juan, Jr.',
        'Juan', '', 'Dela Cruz', 'Jr.',
        'Inverted comma format with suffix in third chunk'
    ],
    [
        'Del Rosario, Maria Clara Jr.',
        'Maria Clara', '', 'Del Rosario', 'Jr.',
        'Inverted comma format with compound surname and compound first'
    ],
    [
        'Plato',
        'Plato', '', '', '',
        'Single word name'
    ],
    [
        '',
        '', '', '', '',
        'Empty string returns empty parts'
    ],
];

foreach ($testCases as $tc) {
    [$input, $expFirst, $expMiddle, $expLast, $expSuffix, $desc] = $tc;
    $parsed = DecedentRequestController::parseFullName($input);

    $match = (
        $parsed['first_name'] === $expFirst &&
        $parsed['middle_name'] === $expMiddle &&
        $parsed['last_name'] === $expLast &&
        $parsed['suffix'] === $expSuffix
    );

    if (!$match) {
        $actualStr = sprintf("first='%s', mid='%s', last='%s', sfx='%s'",
            $parsed['first_name'], $parsed['middle_name'], $parsed['last_name'], $parsed['suffix']);
        $expStr = sprintf("first='%s', mid='%s', last='%s', sfx='%s'",
            $expFirst, $expMiddle, $expLast, $expSuffix);
        assertTest("$desc (got $actualStr, expected $expStr)", false, $totalPassed, $totalFailed);
    } else {
        assertTest("$desc: '$input'", true, $totalPassed, $totalFailed);
    }
}

// ======================================================================
// GROUP 2: DecedentRequestController index() & mine() enrichment
// ======================================================================
echo "\nGroup 2: DecedentRequestController API Enrichment\n";

$reqController = new DecedentRequestController();
$requests = $reqController->index();

assertTest("index() returns array of requests", is_array($requests), $totalPassed, $totalFailed);

if (!empty($requests)) {
    $firstReq = $requests[0];
    assertTest("Request row contains 'parsed_name' field", isset($firstReq['parsed_name']), $totalPassed, $totalFailed);
    assertTest("parsed_name has 'first_name' key", array_key_exists('first_name', $firstReq['parsed_name'] ?? []), $totalPassed, $totalFailed);
    assertTest("parsed_name has 'last_name' key", array_key_exists('last_name', $firstReq['parsed_name'] ?? []), $totalPassed, $totalFailed);
    assertTest("parsed_name has 'middle_name' key", array_key_exists('middle_name', $firstReq['parsed_name'] ?? []), $totalPassed, $totalFailed);
    assertTest("parsed_name has 'suffix' key", array_key_exists('suffix', $firstReq['parsed_name'] ?? []), $totalPassed, $totalFailed);
} else {
    // If table is empty, test with dummy invocation
    $dummy = [
        'full_name' => 'Juan Dela Cruz Jr.',
        'status' => 'pending',
    ];
    $parsed = DecedentRequestController::parseFullName($dummy['full_name']);
    assertTest("Fallback: parseFullName generates valid structure", is_array($parsed) && $parsed['first_name'] === 'Juan', $totalPassed, $totalFailed);
}

// ======================================================================
// GROUP 3: AiController::extractCertificate local attachment resolution
// ======================================================================
echo "\nGroup 3: AiController Disk Attachment Resolution\n";

// Create a temporary dummy document file in uploads/decedent-documents
$uploadDir = __DIR__ . '/../backend/uploads/decedent-documents';
if (!is_dir($uploadDir)) {
    mkdir($uploadDir, 0755, true);
}
$dummyFilename = 'test_cert_' . time() . '.png';
$dummyPath = $uploadDir . '/' . $dummyFilename;

// 1x1 transparent PNG bytes
$pngBytes = base64_decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==');
file_put_contents($dummyPath, $pngBytes);

$mockAIService = new class extends AIService {
    public $receivedPayload = null;
    public function __construct() {}
    public function getCertificateExtraction($payload) {
        $this->receivedPayload = $payload;
        return [
            'result' => [
                'first_name' => 'Juan',
                'last_name' => 'Dela Cruz',
                'dob' => '1950-01-15',
                'dod' => '2024-05-20',
                'cause_of_death' => 'Cardiopulmonary Arrest',
            ]
        ];
    }
};

// Use reflection or subclass to inject mockAIService
$aiController = new AiController();
$refProp = new ReflectionProperty(AiController::class, 'aiService');
$refProp->setAccessible(true);
$refProp->setValue($aiController, $mockAIService);

// Call extractCertificate with attachment_path instead of image_base64
$res = $aiController->extractCertificate([
    'attachment_path' => '/backend/uploads/decedent-documents/' . $dummyFilename,
]);

assertTest("extractCertificate() successfully returns result array", isset($res['result']), $totalPassed, $totalFailed);
assertTest("AI service received base64-encoded image from disk", !empty($mockAIService->receivedPayload['image_base64']), $totalPassed, $totalFailed);
assertTest("Detected MIME type is image/png", ($mockAIService->receivedPayload['mime_type'] ?? '') === 'image/png', $totalPassed, $totalFailed);
assertTest("Extracted first_name is populated", ($res['result']['first_name'] ?? '') === 'Juan', $totalPassed, $totalFailed);
assertTest("Extracted cause_of_death is populated", ($res['result']['cause_of_death'] ?? '') === 'Cardiopulmonary Arrest', $totalPassed, $totalFailed);

// Clean up dummy test file
@unlink($dummyPath);

// Summary
echo "\n=======================================================\n";
echo sprintf("BATCH 3 RESULTS: %d/%d PASSED\n", $totalPassed, $totalPassed + $totalFailed);
echo "=======================================================\n";

if ($totalFailed > 0) {
    exit(1);
}
exit(0);
