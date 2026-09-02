<?php
/**
 * Batch C (reservation module audit, 2026-09-02): the one time-driven
 * trigger for every "lazy sweep" in this app.
 *
 * Before this script existed, ExpirationController::generateNotifications()
 * and ScheduleController's three-stage stale-pending pipeline
 * (notifyStalePending -> sendFinalWarnings -> autoCancelStalePending) only
 * ran as a side effect of an admin/staff opening the Notifications page
 * (see assets/js/pages/notifications.js's generateStarterNotifications()).
 * The business logic there is already correct and idempotent — each stage
 * re-checks its own dedup timestamp before acting — so if nobody happens to
 * open that page, reservations never get reminded, warned, or cancelled, no
 * matter how many days pass. Lot::syncExpiredLots() has the same shape but
 * is comparatively hard to starve since it runs on almost any Lot read; it's
 * included here anyway so a full policy pass doesn't depend on that
 * incidental traffic either.
 *
 * This script is deliberately just a thin, ordered caller of the exact same
 * controller methods the Notifications page already calls — no new business
 * logic, no parallel code path. It exists to be invoked on a real schedule
 * (Windows Task Scheduler, cron, Laragon's bundled Cronical, a Linux
 * systemd timer in production, etc.) — wiring one of those up is an
 * environment-specific choice left to deployment, not to this file.
 *
 * Usage: php backend/scripts/run-automation-sweeps.php
 * CLI only — refuses to run under a web server (see guard below), since it
 * performs privileged mutations with no HTTP auth boundary of its own; it's
 * meant to be invoked by a trusted local/server process, not exposed as a
 * route.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo "This script is CLI-only.\n";
    exit(1);
}

require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../controllers/ExpirationController.php';
require_once __DIR__ . '/../controllers/ScheduleController.php';
require_once __DIR__ . '/../models/Lot.php';

function sweep_log_line($message) {
    $line = '[' . date('Y-m-d H:i:s') . '] ' . $message;
    echo $line . "\n";

    if (!is_dir(LOGS_ROOT)) {
        @mkdir(LOGS_ROOT, 0777, true);
    }
    $logFile = LOGS_ROOT . '/automation-sweeps.log';
    @file_put_contents($logFile, $line . "\n", FILE_APPEND);
}

function run_sweep_stage($label, callable $stage) {
    try {
        $result = $stage();
        $summary = is_array($result) && isset($result['message']) ? $result['message'] : 'completed';
        sweep_log_line("{$label}: {$summary}");
    } catch (Throwable $e) {
        // One stage failing (e.g. a transient DB hiccup) should not stop the
        // others from running — matches generateStarterNotifications()'s own
        // per-stage try/catch on the Notifications page.
        sweep_log_line("{$label}: FAILED — " . $e->getMessage());
    }
}

sweep_log_line('=== automation sweep run started ===');

$expirationController = new ExpirationController();
$scheduleController = new ScheduleController();
$lotModel = new Lot();

run_sweep_stage('expiration-records/generate-notifications', function () use ($expirationController) {
    return $expirationController->generateNotifications();
});

run_sweep_stage('schedules/notify-stale-pending', function () use ($scheduleController) {
    return $scheduleController->notifyStalePending();
});

run_sweep_stage('schedules/send-final-warnings', function () use ($scheduleController) {
    return $scheduleController->sendFinalWarnings();
});

run_sweep_stage('schedules/auto-cancel-stale-pending', function () use ($scheduleController) {
    return $scheduleController->autoCancelStalePending();
});

// Lot::syncExpiredLots() is private and only runs as a side effect of a
// public read — getStats() is the cheapest one available (a single
// aggregate query, no row list to build).
run_sweep_stage('lots.expired-sync', function () use ($lotModel) {
    $lotModel->getStats();
    return ['message' => 'lot expiration sync triggered'];
});

sweep_log_line('=== automation sweep run finished ===');
