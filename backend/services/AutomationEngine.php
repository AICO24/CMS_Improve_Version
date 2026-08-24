<?php
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/SystemException.php';
require_once __DIR__ . '/../models/Notification.php';

// The deterministic half of "full automation" (see the burial-scheduling
// automation plan): a thin, reusable wrapper around "validate, then act,
// then audit-log" so a normal admin click (e.g. verifying a payment) can
// drive the rest of a workflow (confirming a booking, syncing a lot)
// without a second manual step, while never silently guessing when
// something looks wrong.
//
// Deliberately NOT a generic rule engine/event bus — no queue, no cron
// (this app has none by design, see Lot::syncExpiredLots()'s lazy-sweep
// precedent). Just a shared envelope other controllers call into at the
// one or two lifecycle points that need it, so each doesn't hand-roll its
// own validate/act/audit/notify plumbing.
//
// The AI layer never calls this class — it only narrates what the engine
// already decided or is blocked on (see AIService::explainException()).
// Every state change traces to a run() call, never to an LLM response.
class AutomationEngine {
    // $validate: callable(): true|string[]  — return true to proceed, or a
    //   list of human-readable failure reasons to raise an exception instead.
    // $apply: callable(): mixed — the real state change. Must re-check the
    //   current state itself right before writing (same convention already
    //   used by ScheduleController::update()'s status guards) so calling
    //   run() twice for the same event is safe.
    public static function run($event, $entityType, $entityId, $actorUser, callable $validate, callable $apply) {
        $actorId = is_array($actorUser) ? ($actorUser['user_id'] ?? null) : $actorUser;

        $validation = $validate();
        if ($validation !== true) {
            $reasons = is_array($validation) ? implode('; ', $validation) : (string) $validation;
            return self::raiseException($event, $entityType, $entityId, $reasons, $actorId);
        }

        $result = $apply();

        $auditLog = new AuditLog();
        $auditLog->log(
            $event,
            $actorId,
            null,
            $entityType,
            $entityId,
            ['actor' => 'automation-engine', 'success' => true, 'result' => $result]
        );

        return ['success' => true, 'automated' => true, 'result' => $result];
    }

    private static function raiseException($event, $entityType, $entityId, $reason, $actorId, $severity = 'warning') {
        $exceptionModel = new SystemException();
        $exceptionId = $exceptionModel->raise([
            'event' => $event,
            'entity_type' => $entityType,
            'entity_id' => $entityId,
            'reason' => $reason,
            'severity' => $severity,
        ]);

        $auditLog = new AuditLog();
        $auditLog->log(
            'Automation exception',
            $actorId,
            null,
            $entityType,
            $entityId,
            ['actor' => 'automation-engine', 'event' => $event, 'reason' => $reason, 'success' => false]
        );

        $notificationModel = new Notification();
        $notificationModel->create([
            'title' => 'System exception needs review',
            'message' => sprintf('%s (%s #%d): %s', $event, $entityType, (int) $entityId, $reason),
            'notification_type' => 'System',
            'is_read' => 0,
        ]);

        return [
            'success' => false,
            'automated' => false,
            'exception' => true,
            'exception_id' => $exceptionId,
            'reason' => $reason,
        ];
    }
}
