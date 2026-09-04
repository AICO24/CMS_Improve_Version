<?php
require_once __DIR__ . '/../controllers/AuthController.php';
require_once __DIR__ . '/../controllers/LotController.php';
require_once __DIR__ . '/../controllers/DecedentController.php';
require_once __DIR__ . '/../controllers/DecedentRequestController.php';
require_once __DIR__ . '/../controllers/DecedentImportController.php';
require_once __DIR__ . '/../controllers/DecedentDocumentController.php';
require_once __DIR__ . '/../controllers/ScheduleController.php';
require_once __DIR__ . '/../controllers/CremationController.php';
require_once __DIR__ . '/../controllers/RelocationController.php';
require_once __DIR__ . '/../controllers/PaymentController.php';
require_once __DIR__ . '/../controllers/NotificationController.php';
require_once __DIR__ . '/../controllers/AiController.php';
require_once __DIR__ . '/../controllers/ReportController.php';
require_once __DIR__ . '/../controllers/ExpirationController.php';
require_once __DIR__ . '/../controllers/UserController.php';
require_once __DIR__ . '/../controllers/SystemExceptionController.php';
require_once __DIR__ . '/../middleware/Auth.php';
require_once __DIR__ . '/../services/RateLimiter.php';

$requestMethod = $_SERVER['REQUEST_METHOD'] ?? 'GET';
$requestUri = $_SERVER['REQUEST_URI'] ?? '';
$parsedUri = parse_url($requestUri, PHP_URL_PATH);
$query = [];
parse_str(parse_url($requestUri, PHP_URL_QUERY) ?? '', $query);
$scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '');
$basePath = rtrim(str_replace('\\', '/', dirname($scriptName)), '/');
$path = trim(str_replace($basePath, '', str_replace('\\', '/', $parsedUri)), '/');

if (!empty($query['route'])) {
    $path = trim((string) $query['route'], '/');
} elseif (preg_match('#^index\.php/(.+)$#', $path, $matches)) {
    $path = $matches[1];
}

if ($path === '') {
    $path = 'index';
}

$controller = new AuthController();

function readRequestBody() {
    $contentType = $_SERVER['CONTENT_TYPE'] ?? '';
    $result = [];

    if (strpos($contentType, 'multipart/form-data') !== false) {
        $result = $_POST;
    } else {
        $raw = file_get_contents('php://input');
        if ($raw === false || trim($raw) === '') {
            $result = $_POST;
        } else {
            if (strpos($contentType, 'application/json') !== false) {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    $result = $decoded;
                }
            } elseif (strpos($contentType, 'application/x-www-form-urlencoded') !== false) {
                parse_str($raw, $parsed);
                $result = is_array($parsed) ? $parsed : [];
            } else {
                $decoded = json_decode($raw, true);
                if (is_array($decoded)) {
                    $result = $decoded;
                } else {
                    parse_str($raw, $parsed);
                    $result = is_array($parsed) ? $parsed : [];
                }
            }
        }
    }

    if (!empty($_FILES)) {
        $result['files'] = $_FILES;
    }

    // Batch A (reservation module audit): keys prefixed with '_' are an
    // internal-only convention (e.g. _auditedByAutomationEngine, set only by
    // PaymentController's own internal calls into ScheduleController::update()/
    // CremationController::update() to avoid duplicate audit-log entries — see
    // the Batch F comments in those files). Nothing legitimate ever sends one
    // over HTTP, so strip them here at the single shared request-parsing
    // boundary rather than trusting the controller to reject a client-forged
    // one — a request body claiming '_auditedByAutomationEngine' could
    // otherwise suppress its own audit trail.
    foreach (array_keys($result) as $key) {
        if (is_string($key) && $key !== '' && $key[0] === '_') {
            unset($result[$key]);
        }
    }

    return $result;
}

if ($path === 'auth/login' && $requestMethod === 'POST') {
    $input = readRequestBody();
    $result = $controller->login($input);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'auth/register' && $requestMethod === 'POST') {
    $input = readRequestBody();
    $result = $controller->register($input);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'auth/logout' && $requestMethod === 'POST') {
    $input = readRequestBody();
    $result = $controller->logout($input);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'auth/forgot-password' && $requestMethod === 'POST') {
    $input = readRequestBody();
    $result = $controller->forgotPassword($input);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'auth/verify-reset-code' && $requestMethod === 'POST') {
    $input = readRequestBody();
    $result = $controller->verifyResetCode($input);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'auth/reset-password' && $requestMethod === 'POST') {
    $input = readRequestBody();
    $result = $controller->resetPassword($input);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

try {
    $user = AuthMiddleware::authenticate();
} catch (Exception $e) {
    http_response_code(401);
    echo json_encode(['error' => 'Unauthorized']);
    exit;
}

if ($path === 'auth/me' && $requestMethod === 'GET') {
    echo json_encode($controller->me($user['user_id']));
    exit;
}

$lotController = new LotController();
$decedentController = new DecedentController();
$decedentRequestController = new DecedentRequestController();
$decedentImportController = new DecedentImportController();
$decedentDocumentController = new DecedentDocumentController();
$scheduleController = new ScheduleController();
$aiController = new AiController();

if ($path === 'sections' && $requestMethod === 'GET') {
    echo json_encode($lotController->getSections());
    exit;
}
if (preg_match('/^sections\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    echo json_encode($lotController->getSection($matches[1]));
    exit;
}
if ($path === 'sections' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $lotController->createSection($input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}
if (preg_match('/^sections\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $lotController->updateSection($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}
if (preg_match('/^sections\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $result = $lotController->deleteSection($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'blocks' && $requestMethod === 'GET') {
    $sectionId = $_GET['section_id'] ?? null;
    echo json_encode($lotController->getBlocks($sectionId));
    exit;
}
if (preg_match('/^blocks\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    echo json_encode($lotController->getBlock($matches[1]));
    exit;
}
if ($path === 'blocks' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $lotController->createBlock($input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}
if (preg_match('/^blocks\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $lotController->updateBlock($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}
if (preg_match('/^blocks\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $result = $lotController->deleteBlock($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'lot-types' && $requestMethod === 'GET') {
    echo json_encode($lotController->getLotTypes());
    exit;
}

if ($path === 'lots' && $requestMethod === 'GET') {
    $filters = [];
    if (isset($_GET['section'])) $filters['section'] = $_GET['section'];
    if (isset($_GET['lot_number'])) $filters['lot_number'] = $_GET['lot_number'];
    if (isset($_GET['lot_type'])) $filters['lot_type'] = $_GET['lot_type'];
    if (isset($_GET['category'])) $filters['lot_type'] = $_GET['category'];
    if (isset($_GET['min_price'])) $filters['min_price'] = $_GET['min_price'];
    if (isset($_GET['max_price'])) $filters['max_price'] = $_GET['max_price'];
    if (isset($_GET['status'])) $filters['status'] = $_GET['status'];
    if (isset($_GET['block_id'])) $filters['block_id'] = $_GET['block_id'];
    if (isset($_GET['search'])) $filters['search'] = $_GET['search'];
    $pagination = [];
    if (isset($_GET['page'])) $pagination['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $pagination['per_page'] = $_GET['per_page'];
    echo json_encode($lotController->getLots($filters, $pagination));
    exit;
}
if ($path === 'lots/stats' && $requestMethod === 'GET') {
    echo json_encode($lotController->getStats());
    exit;
}
if (preg_match('/^lots\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    echo json_encode($lotController->getLot($matches[1]));
    exit;
}
if ($path === 'lots' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $lotController->createLot($input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}
if (preg_match('/^lots\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $lotController->updateLot($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}
if (preg_match('/^lots\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $result = $lotController->deleteLot($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'schedules/check-conflict' && $requestMethod === 'GET') {
    $lotId = $_GET['lot_id'] ?? null;
    $date = $_GET['date'] ?? null;
    $time = $_GET['time'] ?? null;
    $result = $scheduleController->checkConflict($lotId, $date, $time);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'schedules/calendar' && $requestMethod === 'GET') {
    $month = $_GET['month'] ?? date('m');
    $year = $_GET['year'] ?? date('Y');
    echo json_encode($scheduleController->calendar($month, $year));
    exit;
}

if ($path === 'schedules/mine' && $requestMethod === 'GET') {
    $filters = [];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    if (isset($_GET['status'])) $filters['status'] = $_GET['status'];
    if (isset($_GET['lot_number'])) $filters['lot_number'] = $_GET['lot_number'];
    if (isset($_GET['q'])) $filters['q'] = $_GET['q'];
    if (isset($_GET['page'])) $filters['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $filters['per_page'] = $_GET['per_page'];
    if (isset($_GET['upcoming'])) $filters['upcoming'] = true;
    echo json_encode($scheduleController->mine($user['user_id'], $filters));
    exit;
}

if ($path === 'schedules/recommend' && $requestMethod === 'POST') {
    // Used by both the admin/staff wizard and the citizen "Reserve Burial
    // Slot" wizard (Phase 6) — any authenticated role may request lot
    // recommendations for their own booking.
    AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $input = readRequestBody();
    echo json_encode($aiController->recommend($input));
    exit;
}

if ($path === 'schedules/recommend-type' && $requestMethod === 'POST') {
    // Batch M4: lot-type ranking, called by the chat assistant when the user
    // explicitly asks it to recommend a type instead of naming one. Same
    // caller pattern/role gate as schedules/recommend above — deliberately
    // NOT added under ai/* to avoid recreating the ai/recommend-vs-
    // schedules/recommend duplicate-route situation the Batch M audit found.
    AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $input = readRequestBody();
    echo json_encode($aiController->recommendTypes($input));
    exit;
}

if ($path === 'schedules/stats' && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $year = $_GET['year'] ?? null;
    echo json_encode($scheduleController->stats($year));
    exit;
}

// Automation opportunity G.1: mirrors expiration-records/generate-notifications
// above — a dedup'd sweep triggered on demand (see notifications.js), not on a
// scheduler (this app has none by design). Stage 1 of 3 (reminder) — see
// sendFinalWarnings/autoCancelStalePending below for stages 2 and 3.
if ($path === 'schedules/notify-stale-pending' && $requestMethod === 'POST') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $days = $_GET['days'] ?? null;
    echo json_encode($scheduleController->notifyStalePending($days));
    exit;
}

// Auto-cancel policy stage 2 of 3: final warning before cancellation.
if ($path === 'schedules/send-final-warnings' && $requestMethod === 'POST') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $days = $_GET['days'] ?? null;
    echo json_encode($scheduleController->sendFinalWarnings($days));
    exit;
}

// Auto-cancel policy stage 3 of 3: the actual cancellation. Only ever acts
// on a reservation that already received the stage-2 final warning — see
// Schedule::findStalePendingForCancellation()'s comment.
if ($path === 'schedules/auto-cancel-stale-pending' && $requestMethod === 'POST') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $days = $_GET['days'] ?? null;
    echo json_encode($scheduleController->autoCancelStalePending($days));
    exit;
}

// Decedent Records audit, Batch H: proactive watchdog, same lazy-sweep
// shape as the three stale-pending stages above — see
// ScheduleController::flagUnlinkedDecedentSchedules()'s own comment.
if ($path === 'schedules/flag-unlinked-decedent' && $requestMethod === 'POST') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $days = $_GET['days'] ?? null;
    echo json_encode($scheduleController->flagUnlinkedDecedentSchedules($days));
    exit;
}

if ($path === 'schedules' && $requestMethod === 'GET') {
    $filters = [];
    if (isset($_GET['lot_id'])) $filters['lot_id'] = $_GET['lot_id'];
    if (isset($_GET['status'])) $filters['status'] = $_GET['status'];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    if (isset($_GET['month'])) $filters['month'] = $_GET['month'];
    if (isset($_GET['year'])) $filters['year'] = $_GET['year'];
    if (isset($_GET['q'])) $filters['q'] = $_GET['q'];
    if (isset($_GET['page'])) $filters['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $filters['per_page'] = $_GET['per_page'];
    if (isset($_GET['awaiting_confirmation'])) $filters['awaiting_confirmation'] = true;
    echo json_encode($scheduleController->index($filters, $user));
    exit;
}

if (preg_match('/^schedules\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    $result = $scheduleController->show($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'schedules' && $requestMethod === 'POST') {
    $input = readRequestBody();
    $result = $scheduleController->store($input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^schedules\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $input = readRequestBody();
    $result = $scheduleController->update($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^schedules\/(\d+)\/link-decedent$/', $path, $matches) && $requestMethod === 'PUT') {
    // Chains from decedent-requests/{id}/approve — see ScheduleController::linkDecedent().
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $scheduleController->linkDecedent($matches[1], $input['decedent_id'] ?? null, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^schedules\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $result = $scheduleController->destroy($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

// ============================================
// CREMATION MANAGEMENT ROUTES
// ============================================

$cremationController = new CremationController();

if ($path === 'cremations/stats' && $requestMethod === 'GET') {
    $columbarium = $_GET['columbarium'] ?? null;
    echo json_encode($cremationController->getStats($columbarium));
    exit;
}

// Cremation module audit, Batch D: the request-queue status-count stats for
// manage-cremations.html's stat row — distinct from cremations/stats above
// (niche/columbarium occupancy, a different shape), mirroring
// schedules/stats.
if ($path === 'cremations/queue-stats' && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    echo json_encode($cremationController->queueStats());
    exit;
}

if ($path === 'cremations/niches' && $requestMethod === 'GET') {
    $columbarium = $_GET['columbarium'] ?? null;
    echo json_encode($cremationController->getNiches($columbarium));
    exit;
}

if ($path === 'cremations/columbariums' && $requestMethod === 'GET') {
    echo json_encode($cremationController->columbariums());
    exit;
}

if ($path === 'cremations/suggest-niche' && $requestMethod === 'GET') {
    $columbarium = $_GET['columbarium'] ?? null;
    echo json_encode($cremationController->suggestNiche($columbarium));
    exit;
}

if ($path === 'cremations/assign' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    $result = $cremationController->assignNiche($input, $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

// Cremation Phase B: citizen's own cremation requests — mirrors
// schedules/mine exactly. Placed before 'cremations' (GET) so its own
// filters (page/per_page only) aren't shadowed by that route's broader
// filter set.
if ($path === 'cremations/mine' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $filters = [];
    if (isset($_GET['status'])) $filters['status'] = $_GET['status'];
    if (isset($_GET['q'])) $filters['q'] = $_GET['q'];
    if (isset($_GET['page'])) $filters['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $filters['per_page'] = $_GET['per_page'];
    echo json_encode($cremationController->mine($user['user_id'], $filters));
    exit;
}

// Cremation Phase B: previously no role gate at all beyond top-level
// authenticate() — any authenticated user could enumerate every cremation
// record. Now gated + $user threaded through for per-citizen scoping (see
// CremationController::index()).
if ($path === 'cremations' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $filters = [];
    if (isset($_GET['status'])) $filters['status'] = $_GET['status'];
    if (isset($_GET['columbarium'])) $filters['columbarium'] = $_GET['columbarium'];
    if (isset($_GET['deceased_id'])) $filters['deceased_id'] = $_GET['deceased_id'];
    if (isset($_GET['q'])) $filters['q'] = $_GET['q'];
    // Cremation module audit, Batch D: mirrors schedules' identical
    // awaiting_confirmation filter — see Cremation::applyFilters()'s comment.
    if (isset($_GET['awaiting_confirmation'])) $filters['awaiting_confirmation'] = $_GET['awaiting_confirmation'];
    $pagination = [];
    if (isset($_GET['page'])) $pagination['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $pagination['per_page'] = $_GET['per_page'];
    echo json_encode($cremationController->index($filters, $pagination, $user));
    exit;
}

if (preg_match('/^cremations\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $result = $cremationController->show($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

// Cremation Phase B: widened from admin-only so a citizen can book — role
// branching (provisional decedent, forced Pending, stripped niche input)
// happens inside CremationController::store() itself, mirroring how
// 'schedules' (POST) is wide open with the same internal branching.
if ($path === 'cremations' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $input = readRequestBody();
    $result = $cremationController->store($input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^cremations\/(\d+)\/link-decedent$/', $path, $matches) && $requestMethod === 'PUT') {
    // Chains from decedent-requests/{id}/approve — see
    // CremationController::linkDecedent(). Mirrors schedules/{id}/link-decedent.
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $cremationController->linkDecedent($matches[1], $input['decedent_id'] ?? null, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^cremations\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $input = readRequestBody();
    $result = $cremationController->update($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^cremations\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $result = $cremationController->destroy($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

// Cremation module audit, Batch C: stale-Pending policy, mirroring
// schedules/notify-stale-pending / send-final-warnings / auto-cancel-stale-
// pending exactly — same lazy-sweep shape (this app has no scheduler, see
// CremationController::notifyStalePending()'s own comment).
if ($path === 'cremations/notify-stale-pending' && $requestMethod === 'POST') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $days = $_GET['days'] ?? null;
    echo json_encode($cremationController->notifyStalePending($days));
    exit;
}

if ($path === 'cremations/send-final-warnings' && $requestMethod === 'POST') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $days = $_GET['days'] ?? null;
    echo json_encode($cremationController->sendFinalWarnings($days));
    exit;
}

if ($path === 'cremations/auto-cancel-stale-pending' && $requestMethod === 'POST') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $days = $_GET['days'] ?? null;
    echo json_encode($cremationController->autoCancelStalePending($days));
    exit;
}

$relocationController = new RelocationController();

if ($path === 'relocations/stats' && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    echo json_encode($relocationController->stats());
    exit;
}

if ($path === 'relocations' && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $filters = [];
    if (isset($_GET['status'])) $filters['status'] = $_GET['status'];
    if (isset($_GET['deceased_id'])) $filters['deceased_id'] = $_GET['deceased_id'];
    if (isset($_GET['from_lot_id'])) $filters['from_lot_id'] = $_GET['from_lot_id'];
    if (isset($_GET['to_lot_id'])) $filters['to_lot_id'] = $_GET['to_lot_id'];
    if (isset($_GET['q'])) $filters['q'] = $_GET['q'];
    $pagination = [];
    if (isset($_GET['page'])) $pagination['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $pagination['per_page'] = $_GET['per_page'];
    echo json_encode($relocationController->index($filters, $pagination));
    exit;
}

if (preg_match('/^relocations\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $result = $relocationController->show($matches[1]);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'relocations' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    $result = $relocationController->store($input, $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^relocations\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    // If approving, completing, or denying, these are handled below.
    if (isset($matches[1]) && preg_match('/^relocations\/\d+\/(approve|complete|deny)$/', $path) === 0) {
        $result = $relocationController->update($matches[1], $input, $user['user_id']);
        http_response_code($result['code'] ?? 200);
        unset($result['code']);
        echo json_encode($result);
        exit;
    }
}

if (preg_match('/^relocations\/(\d+)\/approve$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin']);
    $result = $relocationController->approve($matches[1], $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^relocations\/(\d+)\/complete$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $result = $relocationController->complete($matches[1], $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^relocations\/(\d+)\/deny$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin']);
    $result = $relocationController->deny($matches[1], $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^relocations\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin']);
    $result = $relocationController->destroy($matches[1], $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

$paymentController = new PaymentController();

if ($path === 'payments/mine' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $filters = [];
    if (isset($_GET['verification_status'])) $filters['verification_status'] = $_GET['verification_status'];
    if (isset($_GET['transaction_type'])) $filters['transaction_type'] = $_GET['transaction_type'];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    if (isset($_GET['reference_id'])) $filters['reference_id'] = $_GET['reference_id'];
    $pagination = [];
    if (isset($_GET['page'])) $pagination['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $pagination['per_page'] = $_GET['per_page'];
    echo json_encode($paymentController->mine($user['user_id'], $filters, $pagination));
    exit;
}

if ($path === 'payments' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $filters = [];
    if (isset($_GET['transaction_type'])) $filters['transaction_type'] = $_GET['transaction_type'];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    if (isset($_GET['reference_id'])) $filters['reference_id'] = $_GET['reference_id'];
    if (isset($_GET['verification_status'])) $filters['verification_status'] = $_GET['verification_status'];
    $pagination = [];
    if (isset($_GET['page'])) $pagination['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $pagination['per_page'] = $_GET['per_page'];
    echo json_encode($paymentController->index($filters, $pagination));
    exit;
}

if ($path === 'payments/expected-amount' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $transactionType = $_GET['transaction_type'] ?? null;
    $referenceId = $_GET['reference_id'] ?? null;
    $referenceKind = $_GET['reference_kind'] ?? null;
    echo json_encode($paymentController->resolveExpectedAmount($transactionType, $referenceId, $referenceKind));
    exit;
}

if ($path === 'payments' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $input = readRequestBody();
    $result = $paymentController->store($input, $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^payments\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    $result = $paymentController->show($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^payments\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $input = readRequestBody();
    $result = $paymentController->update($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^payments\/(\d+)\/verify$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    $status = $input['verification_status'] ?? null;
    $result = $paymentController->verify($matches[1], $status, $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'payments/pending/verify-all' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin']);
    $result = $paymentController->verifyAllPending('Verified', $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'payments/pending/reject-all' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin']);
    $result = $paymentController->verifyAllPending('Rejected', $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^payments\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin']);
    $result = $paymentController->destroy($matches[1], $user['user_id']);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'payments/revenue' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $filters = [];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    echo json_encode($paymentController->revenue($filters));
    exit;
}

if ($path === 'payments/revenue-by-month' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $year = $_GET['year'] ?? date('Y');
    echo json_encode($paymentController->revenueByMonth($year));
    exit;
}

if ($path === 'payments/revenue-breakdown' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $filters = [];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    echo json_encode($paymentController->revenueBreakdown($filters));
    exit;
}

if ($path === 'payments/verification-breakdown' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $filters = [];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    echo json_encode($paymentController->verificationBreakdown($filters));
    exit;
}

if ($path === 'payments/revenue-by-method' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $filters = [];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    echo json_encode($paymentController->revenueByMethod($filters));
    exit;
}

$notificationController = new NotificationController();

if ($path === 'notifications' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $filters = [];
    if (isset($_GET['type'])) $filters['notification_type'] = $_GET['type'];
    echo json_encode($notificationController->index($filters, $user));
    exit;
}

if ($path === 'notifications' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $notificationController->store($input);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'notifications/unread-count' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    echo json_encode($notificationController->unreadCount($user));
    exit;
}

if (preg_match('/^notifications\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    // Batch (notification scoping, finding E.1): this route previously had no
    // role gate of its own at all — relied only on the top-level authenticate()
    // above, with no ownership check in the controller either, so any
    // authenticated user could view any notification by guessing its id.
    // Explicit gate added here to match every sibling notifications/* route's
    // pattern; ownership is now enforced in NotificationController::show().
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $result = $notificationController->show($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^notifications\/(\d+)\/read$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $result = $notificationController->markRead($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'notifications/mark-all-read' && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $result = $notificationController->markAllRead($user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^notifications\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $result = $notificationController->destroy($matches[1]);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

require_once __DIR__ . '/../models/AuditLog.php';
$auditLogModel = new AuditLog();

if ($path === 'audit-logs' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin']);
    $filters = [];
    if (isset($_GET['q'])) $filters['q'] = $_GET['q'];
    if (isset($_GET['action'])) $filters['action'] = $_GET['action'];
    if (isset($_GET['entity_type'])) $filters['entity_type'] = $_GET['entity_type'];
    // Batch D (Decedent Records audit): lets a caller scope to one specific
    // record's own history (e.g. Decedent #12) instead of every row of that
    // entity_type — AuditLog::applyFilters() already supported this filter
    // for AuditIntelligenceService, it just wasn't reachable over HTTP yet.
    if (isset($_GET['entity_id'])) $filters['entity_id'] = $_GET['entity_id'];
    if (isset($_GET['user_id'])) $filters['user_id'] = $_GET['user_id'];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    $limit = $_GET['limit'] ?? 100;
    $offset = $_GET['offset'] ?? 0;
    echo json_encode($auditLogModel->findAll($filters, $limit, $offset));
    exit;
}

// Batch F: a sibling endpoint rather than changing audit-logs' own response
// shape (still a bare array) — the Audit Logs page previously had no way to
// know the real total, only a limit+1 "peek ahead" trick.
if ($path === 'audit-logs/count' && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin']);
    $filters = [];
    if (isset($_GET['q'])) $filters['q'] = $_GET['q'];
    if (isset($_GET['action'])) $filters['action'] = $_GET['action'];
    if (isset($_GET['entity_type'])) $filters['entity_type'] = $_GET['entity_type'];
    if (isset($_GET['user_id'])) $filters['user_id'] = $_GET['user_id'];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    echo json_encode(['total' => $auditLogModel->countAll($filters)]);
    exit;
}

// System exceptions: the open-items queue the Automation Engine
// (backend/services/AutomationEngine.php) raises into when a normally-
// automatic transition can't safely proceed — the admin Control Center's
// "needs attention" list, distinct from audit-logs' immutable history.
$systemExceptionController = new SystemExceptionController();

if ($path === 'exceptions' && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $filters = [];
    if (isset($_GET['status'])) $filters['status'] = $_GET['status'];
    if (isset($_GET['entity_type'])) $filters['entity_type'] = $_GET['entity_type'];
    echo json_encode($systemExceptionController->index($filters));
    exit;
}

if ($path === 'exceptions/open-count' && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    echo json_encode($systemExceptionController->countOpen());
    exit;
}

if (preg_match('/^exceptions\/(\d+)\/resolve$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $systemExceptionController->resolve($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

// Automation opportunity G.7: see SystemExceptionController::retry()'s
// comment for exactly which exception types this can and can't handle.
if (preg_match('/^exceptions\/(\d+)\/retry$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $result = $systemExceptionController->retry($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

$userController = new UserController();
$reportController = new ReportController();

if ($path === 'users' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin']);
    $filters = [];
    if (isset($_GET['role'])) $filters['role'] = $_GET['role'];
    if (isset($_GET['is_active'])) $filters['is_active'] = $_GET['is_active'];
    if (isset($_GET['q'])) $filters['q'] = $_GET['q'];
    $pagination = [];
    if (isset($_GET['page'])) $pagination['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $pagination['per_page'] = $_GET['per_page'];
    echo json_encode($userController->index($filters, $pagination));
    exit;
}

if (preg_match('/^users\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin']);
    $result = $userController->show($matches[1]);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'users' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    $result = $userController->store($input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^users\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    $result = $userController->update($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^users\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin']);
    $result = $userController->destroy($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'reports/occupancy' && $requestMethod === 'GET') {
    echo json_encode($reportController->occupancy());
    exit;
}

if ($path === 'reports/occupancy-trend' && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $months = isset($_GET['months']) ? (int) $_GET['months'] : 12;
    echo json_encode($reportController->occupancyTrend($months));
    exit;
}

if ($path === 'reports/revenue' && $requestMethod === 'GET') {
    $filters = [];
    if (isset($_GET['date_from'])) $filters['date_from'] = $_GET['date_from'];
    if (isset($_GET['date_to'])) $filters['date_to'] = $_GET['date_to'];
    echo json_encode($reportController->revenue($filters));
    exit;
}

if ($path === 'reports/expiration' && $requestMethod === 'GET') {
    $pagination = [];
    if (isset($_GET['page'])) $pagination['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $pagination['per_page'] = $_GET['per_page'];
    echo json_encode($reportController->expiration($pagination));
    exit;
}

if ($path === 'ai/health' && $requestMethod === 'GET') {
    echo json_encode($aiController->health());
    exit;
}

// Batch M7: the 'ai/recommend' route (admin/staff only) was removed here —
// it called the exact same AiController::recommend() as 'schedules/recommend'
// below (open to admin/staff/user), had zero frontend callers (confirmed via
// repo-wide search), and its presence risked a future developer "fixing" a
// route nothing actually used. AiController::recommend() itself is untouched
// and still live via schedules/recommend.

if ($path === 'ai/forecast' && $requestMethod === 'GET') {
    // Phase 6: the citizen wizard's capacity advisory (Phase 5) also calls
    // this, in addition to the admin/staff Capacity Forecast page.
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    // BATCH AI-7 (AI Architecture Audit, 2026-09-02): this one isn't an LLM
    // call (Python does ARIMA/moving-average projection over lots/
    // schedules, no Gemini/Groq involved) so it carries no quota-burn risk
    // — but it's still an unbounded, citizen-reachable DB/compute query
    // that had zero throttling, unlike every other route in this block.
    // 20/minute/user is generous for the date-picker-driven advisory calls
    // this is actually used for.
    if (!RateLimiter::allow('ai_forecast_' . $user['user_id'], 20, 60)) {
        http_response_code(429);
        echo json_encode(['error' => 'Too many requests — please wait a moment before trying again.']);
        exit;
    }
    $months = isset($_GET['months']) ? $_GET['months'] : 6;
    echo json_encode($aiController->forecast($months));
    exit;
}

if ($path === 'ai/narrate' && $requestMethod === 'POST') {
    // Phase 6: the citizen wizard's outcome narration (Phase 4) also calls this.
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    // BATCH AI-7: a real Gemini call, same as ai/assistant-ask below, but
    // previously had no rate limit at all despite being reachable by every
    // citizen. 10/minute/user matches ai/assistant-ask's own limit — this
    // fires at most once per recommendation search, not per keystroke, so
    // genuine use never approaches it.
    if (!RateLimiter::allow('ai_narrate_' . $user['user_id'], 10, 60)) {
        http_response_code(429);
        echo json_encode(['error' => 'Too many requests — please wait a moment before trying again.']);
        exit;
    }
    $input = readRequestBody();
    echo json_encode($aiController->narrate($input));
    exit;
}

if ($path === 'ai/extract' && $requestMethod === 'POST') {
    // Batch M3: LLM-assisted preference extraction, called by the shared chat
    // assistant (both wizards) only when its deterministic extractor found
    // nothing in a message. Same role gate as ai/narrate/ai/forecast above.
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    // BATCH AI-7: a real Gemini call with no prior rate limit, reachable by
    // every citizen mid-booking. 15/minute/user — higher than
    // ai/assistant-ask's 10 since this can legitimately fire once per chat
    // message during a fast-moving conversation, not just once per
    // exchange.
    if (!RateLimiter::allow('ai_extract_' . $user['user_id'], 15, 60)) {
        http_response_code(429);
        echo json_encode(['error' => 'Too many requests — please wait a moment before trying again.']);
        exit;
    }
    $input = readRequestBody();
    echo json_encode($aiController->extract($input));
    exit;
}

if ($path === 'ai/extract-decedent-request' && $requestMethod === 'POST') {
    // Decedent Records audit, Batch I: same role gate and per-user rate
    // limit as ai/extract above — a real Gemini call reachable by every
    // citizen mid-chat, called by appendDecedentRequestForm()'s free-text
    // option.
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    if (!RateLimiter::allow('ai_extract_decedent_' . $user['user_id'], 15, 60)) {
        http_response_code(429);
        echo json_encode(['error' => 'Too many requests — please wait a moment before trying again.']);
        exit;
    }
    $input = readRequestBody();
    echo json_encode($aiController->extractDecedentRequest($input));
    exit;
}

if ($path === 'ai/extract-certificate' && $requestMethod === 'POST') {
    // Decedent Records audit, Batch K: originally staff-only (the Add
    // Decedent Record form's "Extract & Fill Fields" action). Batch L2
    // opens this to citizens too — the same vision extraction, called from
    // the booking chat's decedent-request step, so online booking can
    // benefit from the same pre-fill face-to-face processing already gets.
    // A citizen gets a tighter limit than staff: they fire this at most
    // once or twice per booking (one certificate), never repeatedly across
    // many records the way staff processing a backlog might.
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $isCitizen = strtolower($user['role'] ?? '') === 'user';
    $rateLimit = $isCitizen ? 5 : 10;
    if (!RateLimiter::allow('ai_extract_certificate_' . $user['user_id'], $rateLimit, 60)) {
        http_response_code(429);
        echo json_encode(['error' => 'Too many requests — please wait a moment before trying again.']);
        exit;
    }
    $input = readRequestBody();
    echo json_encode($aiController->extractCertificate($input));
    exit;
}

if ($path === 'ai/chat' && $requestMethod === 'POST') {
    // General Q&A layer: answers real questions ("what documents do I
    // need?") grounded in the admin-editable ai_knowledge content, called by
    // the shared chat assistant only when the deterministic extractor AND
    // ai/extract both found nothing usable in a message. Same role gate as
    // ai/narrate/ai/extract/ai/forecast above — reachable by both wizards.
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    // BATCH AI-7 (AI Architecture Audit): a real Gemini call with no prior
    // rate limit, reachable by every citizen — and BATCH AI-3 just widened
    // when this fires (a question riding alongside a resolved slot value
    // now also triggers it, not only a message that matched nothing else),
    // so this gap mattered slightly more than when the audit first found
    // it. Same 15/minute/user budget as ai/extract, for the same reason.
    if (!RateLimiter::allow('ai_chat_' . $user['user_id'], 15, 60)) {
        http_response_code(429);
        echo json_encode(['error' => 'Too many requests — please wait a moment before trying again.']);
        exit;
    }
    $input = readRequestBody();
    echo json_encode($aiController->chat($input));
    exit;
}

if ($path === 'ai/explain-exception' && $requestMethod === 'POST') {
    // Exceptions page only — admin/staff resolve exceptions, citizens never
    // see them (same role gate as the 'exceptions' routes above).
    AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    echo json_encode($aiController->explainException($input));
    exit;
}

if ($path === 'ai/explain-entity' && $requestMethod === 'POST') {
    // AI-1 (Audit Intelligence Layer): READ + EXPLAIN only, admin/staff
    // only — same role gate as ai/explain-exception above and every other
    // audit/exception-adjacent route in this file. Citizens never reach this.
    AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    echo json_encode($aiController->explainEntity($input));
    exit;
}

if ($path === 'ai/dashboard-digest' && $requestMethod === 'GET') {
    // AI-2 Round 2 (proactive "second admin"): same admin/staff gate as
    // every other audit/exception-adjacent AI route above. GET, not POST —
    // unlike explain-entity/explain-exception there's no caller-supplied
    // payload, it's always "the whole system, right now."
    AuthMiddleware::requireRole(['admin', 'staff']);
    echo json_encode($aiController->dashboardDigest());
    exit;
}

if ($path === 'ai/assistant-ask' && $requestMethod === 'POST') {
    // System-Wide AI Assistant (Phase 1): admin/staff get the full
    // module/entity/system scope range (see AiController::askAssistant()).
    // BATCH AI-4 (AI Architecture Audit, 2026-09-02): 'user' (citizen) added
    // — this was deliberately held back in BATCH AI-7 until
    // AuditIntelligenceService::buildCitizenModuleContext() existed to
    // scope it to just the caller's own records. AiController::askAssistant()
    // enforces the citizen restriction itself (module-scope only, fixed
    // allowlist, own user_id) based on $user['role'] below — this route
    // only needs to widen the role gate and pass $user through.
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);

    // Batch 10 (Batch 9 audit finding): no server-side protection existed
    // against rapid repeated calls to this specific endpoint, each one a
    // real Gemini/Groq request. 10/minute per authenticated user is
    // generous for genuine interactive use — a real exchange takes
    // several seconds of visible "Thinking…" time, so a human can't
    // realistically send more than a handful of messages per minute —
    // while bounding worst-case quota burn from a runaway script or
    // accidental rapid-fire clicking. Scoped to this one route only; no
    // other endpoint is affected. Applies equally to the newly-added
    // citizen role — same budget, no separate carve-out needed.
    if (!RateLimiter::allow('assistant_ask_' . $user['user_id'], 10, 60)) {
        http_response_code(429);
        echo json_encode(['error' => 'Too many requests — please wait a moment before asking again.']);
        exit;
    }

    $input = readRequestBody();
    $result = $aiController->askAssistant($input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'ai/knowledge' && $requestMethod === 'GET') {
    // admin+staff: staff should be able to review/correct FAQ content too,
    // not just admins (unlike ai/parameters' tunable numeric weights below).
    AuthMiddleware::requireRole(['admin', 'staff']);
    echo json_encode($aiController->getKnowledge());
    exit;
}

if ($path === 'ai/knowledge' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    $result = $aiController->createKnowledge($input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^ai\/knowledge\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    $result = $aiController->updateKnowledge($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^ai\/knowledge\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin']);
    $result = $aiController->deleteKnowledge($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'ai/parameters' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin']);
    $module = $_GET['module'] ?? null;
    echo json_encode($aiController->getParameters($module));
    exit;
}

if (preg_match('/^ai\/parameters\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    $result = $aiController->updateParameter($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

$expirationController = new ExpirationController();

if ($path === 'expiration-records' && $requestMethod === 'GET') {
    $filters = [];
    if (isset($_GET['renewed'])) $filters['renewed'] = $_GET['renewed'];
    if (isset($_GET['exhumation_status'])) $filters['exhumation_status'] = $_GET['exhumation_status'];
    if (isset($_GET['lot_id'])) $filters['lot_id'] = $_GET['lot_id'];
    if (isset($_GET['status'])) $filters['status'] = $_GET['status'];
    if (isset($_GET['q'])) $filters['q'] = $_GET['q'];
    $pagination = [];
    if (isset($_GET['page'])) $pagination['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $pagination['per_page'] = $_GET['per_page'];
    echo json_encode($expirationController->index($filters, $pagination));
    exit;
}

if (preg_match('/^expiration-records\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    $result = $expirationController->show($matches[1]);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'expiration-records' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    $result = $expirationController->store($input);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^expiration-records\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin']);
    $input = readRequestBody();
    $result = $expirationController->update($matches[1], $input);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^expiration-records\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin']);
    $result = $expirationController->destroy($matches[1]);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'expiration-records/stats' && $requestMethod === 'GET') {
    echo json_encode($expirationController->stats());
    exit;
}

if ($path === 'expiration-records/generate-notifications' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $days = $_GET['days'] ?? 30;
    echo json_encode($expirationController->generateNotifications($days));
    exit;
}

if ($path === 'decedents' && $requestMethod === 'GET') {
    $filters = [];
    if (isset($_GET['q'])) $filters['q'] = $_GET['q'];
    if (isset($_GET['lot_id'])) $filters['lot_id'] = $_GET['lot_id'];
    if (isset($_GET['section'])) $filters['section'] = $_GET['section'];
    if (isset($_GET['is_cremated'])) $filters['is_cremated'] = $_GET['is_cremated'];
    if (isset($_GET['incomplete'])) $filters['incomplete'] = $_GET['incomplete'];
    $pagination = [];
    if (isset($_GET['page'])) $pagination['page'] = $_GET['page'];
    if (isset($_GET['per_page'])) $pagination['per_page'] = $_GET['per_page'];
    echo json_encode($decedentController->index($filters, $pagination, $user));
    exit;
}
if ($path === 'decedents/stats' && $requestMethod === 'GET') {
    echo json_encode($decedentController->stats());
    exit;
}
if (preg_match('/^decedents\/(\d+)$/', $path, $matches) && $requestMethod === 'GET') {
    echo json_encode($decedentController->show($matches[1], $user));
    exit;
}
if ($path === 'decedents' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $decedentController->store($input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}
if (preg_match('/^decedents\/(\d+)$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $decedentController->update($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}
if (preg_match('/^decedents\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $result = $decedentController->destroy($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

// Decedent Records module audit, Batch K1: document/certificate upload
// (death certificate, burial permit, etc.) — upload only, no AI extraction.
// admin/staff only, same as every other write in this module — these can
// carry sensitive personal detail (cause of death, ID numbers) so citizens
// never get read or write access here, unlike the redacted decedents list.
if (preg_match('/^decedents\/(\d+)\/documents$/', $path, $matches) && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $result = $decedentDocumentController->index($matches[1]);
    if (isset($result['code'])) {
        http_response_code($result['code']);
        unset($result['code']);
    }
    echo json_encode($result);
    exit;
}

if (preg_match('/^decedents\/(\d+)\/documents$/', $path, $matches) && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $file = $input['files']['document_file'] ?? null;
    $documentType = $input['document_type'] ?? 'other';
    $result = $decedentDocumentController->store($matches[1], $file, $documentType, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^decedents\/(\d+)\/documents\/(\d+)$/', $path, $matches) && $requestMethod === 'DELETE') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $result = $decedentDocumentController->destroy($matches[2], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

// Citizen-initiated decedent registration requests: bridges "citizen names
// someone not yet in decedent_records" to staff's existing review/creation
// flow, without ever letting a citizen create or read the sensitive
// decedent_records fields directly. See the chat assistant's inline request
// form (lot-chat-assistant.js) and the Decedent Records page's "Pending
// Requests" tab for the two surfaces that call these.
if ($path === 'decedent-requests' && $requestMethod === 'GET') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $status = $_GET['status'] ?? null;
    echo json_encode($decedentRequestController->index($status));
    exit;
}

if ($path === 'decedent-requests/mine' && $requestMethod === 'GET') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    echo json_encode($decedentRequestController->mine($user['user_id']));
    exit;
}

if ($path === 'decedent-requests' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $input = readRequestBody();
    $result = $decedentRequestController->store($input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

// Decedent Records module audit, Batch L1: lets a citizen attach a death
// certificate/burial permit to their OWN pending request (or admin/staff to
// any) before staff formalizes a real decedent record — see
// DecedentRequestController::uploadAttachment()'s own comment.
if (preg_match('/^decedent-requests\/(\d+)\/attachment$/', $path, $matches) && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $input = readRequestBody();
    $file = $input['files']['attachment_file'] ?? null;
    $result = $decedentRequestController->uploadAttachment($matches[1], $file, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^decedent-requests\/(\d+)\/approve$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $decedentRequestController->approve($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^decedent-requests\/(\d+)\/reject$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $result = $decedentRequestController->reject($matches[1], $input, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if (preg_match('/^decedent-requests\/(\d+)\/acknowledge$/', $path, $matches) && $requestMethod === 'PUT') {
    $user = AuthMiddleware::requireRole(['admin', 'staff', 'user']);
    $result = $decedentRequestController->acknowledge($matches[1], $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

// Decedent Records module audit, Batch J: bulk CSV import for digitizing
// historical/paper records. Two steps — preview never writes anything
// (see DecedentImportController::preview()'s own comment), confirm commits
// only the rows staff kept checked, each through the same
// DecedentController::store() every other create path uses.
if ($path === 'decedents/import/preview' && $requestMethod === 'POST') {
    AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $file = $input['files']['csv_file'] ?? null;
    $result = $decedentImportController->preview($file);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

if ($path === 'decedents/import/confirm' && $requestMethod === 'POST') {
    $user = AuthMiddleware::requireRole(['admin', 'staff']);
    $input = readRequestBody();
    $rows = is_array($input['rows'] ?? null) ? $input['rows'] : [];
    $result = $decedentImportController->confirmImport($rows, $user);
    http_response_code($result['code'] ?? 200);
    unset($result['code']);
    echo json_encode($result);
    exit;
}

http_response_code(404);
echo json_encode(['error' => 'Endpoint not found']);
