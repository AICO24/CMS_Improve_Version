<?php
/**
 * BookingRescheduleService
 * 
 * Authoritative domain service for transactional booking rescheduling.
 * Enforces all 5 concurrency layers and business validation rules.
 * 
 * Concurrency Layers:
 * Layer 1: Server-side business validation (past-date, Monday rule, terminal state checks)
 * Layer 2: SELECT ... FOR UPDATE row locking on schedule and resource
 * Layer 3: Authoritative conflict check (Schedule::checkConflict)
 * Layer 4: MySQL unique constraint (uq_active_schedule_slot)
 * Layer 5: Duplicate key exception handling (PDOException code 23000 translation)
 */

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Notification.php';

class BookingRescheduleService {
    private PDO $db;
    private Schedule $scheduleModel;
    private Cremation $cremationModel;
    private Lot $lotModel;
    private AuditLog $auditLogModel;

    public function __construct(
        ?PDO $db = null,
        ?Schedule $scheduleModel = null,
        ?Cremation $cremationModel = null,
        ?Lot $lotModel = null,
        ?AuditLog $auditLogModel = null
    ) {
        $this->db = $db ?? Database::getInstance()->getConnection();
        $this->scheduleModel = $scheduleModel ?? new Schedule();
        $this->cremationModel = $cremationModel ?? new Cremation();
        $this->lotModel = $lotModel ?? new Lot();
        $this->auditLogModel = $auditLogModel ?? new AuditLog();
    }

    private function runInTransaction(callable $callback) {
        if ($this->db->inTransaction()) {
            return $callback();
        }
        return Database::getInstance()->transaction($callback);
    }

    private static function actorId($actor): ?int {
        return is_array($actor) ? (isset($actor['user_id']) ? (int) $actor['user_id'] : null) : (is_numeric($actor) ? (int) $actor : null);
    }

    private static function actorUsername($actor): ?string {
        return is_array($actor) ? ($actor['username'] ?? null) : null;
    }

    private static function actorRole($actor): string {
        return strtolower(is_array($actor) ? ($actor['role'] ?? 'user') : 'user');
    }

    /**
     * Validate target date string against business rules.
     */
    public function validateScheduleDate(string $targetDate, string $serviceType = 'burial'): array {
        $ts = strtotime($targetDate);
        if ($ts === false) {
            return ['valid' => false, 'error' => 'Invalid schedule date format. Please specify a valid date (YYYY-MM-DD).'];
        }

        $normalizedDate = date('Y-m-d', $ts);
        $today = date('Y-m-d');

        if ($normalizedDate < $today) {
            return ['valid' => false, 'error' => 'Schedule date cannot be in the past. Please choose a future date.'];
        }

        if ($serviceType === 'burial' && date('N', $ts) === '1') {
            return ['valid' => false, 'error' => 'Monday booking is not allowed; please select another day.'];
        }

        return ['valid' => true, 'date' => $normalizedDate];
    }

    /**
     * Reschedule Burial Schedule with 5 concurrency layers.
     */
    public function rescheduleBurialSchedule(int $scheduleId, string $targetDate, ?string $targetTime, $actor, string $source = 'AI_BOOKING_ASSISTANT'): array {
        $userId = self::actorId($actor);
        $username = self::actorUsername($actor);
        $userRole = self::actorRole($actor);
        $isAdminOrStaff = in_array($userRole, ['admin', 'staff'], true);

        // Layer 1: Preliminary Business Validation
        $dateValidation = $this->validateScheduleDate($targetDate, 'burial');
        if (!$dateValidation['valid']) {
            return ['success' => false, 'error' => $dateValidation['error'], 'code' => 400];
        }
        $normalizedDate = $dateValidation['date'];

        $existing = $this->scheduleModel->findById($scheduleId);
        if (!$existing) {
            return ['success' => false, 'error' => 'Burial schedule not found', 'code' => 404];
        }

        if (!$isAdminOrStaff && (int) ($existing['created_by'] ?? 0) !== $userId) {
            return ['success' => false, 'error' => 'You may only reschedule your own reservations', 'code' => 403];
        }

        if (in_array($existing['status'], ['Completed', 'Cancelled'], true)) {
            return [
                'success' => false,
                'error'   => "Cannot reschedule a {$existing['status']} booking.",
                'code'    => 409
            ];
        }

        // Layer 3 (early): Idempotency check
        $currentTime = $existing['schedule_time'] ?? null;
        $resolvedTime = $targetTime !== null ? $targetTime : $currentTime;
        if ($existing['schedule_date'] === $normalizedDate && (string)$currentTime === (string)$resolvedTime) {
            return [
                'success'           => true,
                'no_change'         => true,
                'booking_type'      => 'burial',
                'booking_id'        => $scheduleId,
                'booking_reference' => "BUR-{$scheduleId}",
                'schedule_date'     => $normalizedDate,
                'schedule_time'     => $resolvedTime,
                'message'           => "Booking BUR-{$scheduleId} is already scheduled for {$normalizedDate}.",
                'code'              => 200
            ];
        }

        // Execute atomically inside Database::transaction()
        try {
            return $this->runInTransaction(function () use ($scheduleId, $normalizedDate, $resolvedTime, $existing, $userId, $username, $source) {
                // Layer 2: Pessimistic Row Locking
                $stmt = $this->db->prepare("SELECT * FROM burial_schedules WHERE schedule_id = ? FOR UPDATE");
                $stmt->execute([$scheduleId]);
                $lockedSchedule = $stmt->fetch();

                if (!$lockedSchedule) {
                    return ['success' => false, 'error' => 'Schedule not found', 'code' => 404];
                }

                if (in_array($lockedSchedule['status'], ['Completed', 'Cancelled'], true)) {
                    return [
                        'success' => false,
                        'error'   => "Cannot reschedule a {$lockedSchedule['status']} booking.",
                        'code'    => 409
                    ];
                }

                $lotId = (int) $lockedSchedule['lot_id'];
                // Lock lot row
                $lotStmt = $this->db->prepare("SELECT * FROM lots WHERE lot_id = ? FOR UPDATE");
                $lotStmt->execute([$lotId]);
                $lockedLot = $lotStmt->fetch();

                if (!$lockedLot) {
                    return ['success' => false, 'error' => 'Associated lot not found', 'code' => 404];
                }

                // Layer 3: Authoritative Conflict Check under lock
                $conflict = $this->scheduleModel->checkConflict($lotId, $normalizedDate, $resolvedTime);
                if ($conflict) {
                    $otherSchedules = $this->scheduleModel->findAll([
                        'lot_id'    => $lotId,
                        'date_from' => $normalizedDate,
                        'date_to'   => $normalizedDate
                    ]);
                    foreach ($otherSchedules as $os) {
                        if ((int) $os['schedule_id'] !== $scheduleId && $os['status'] !== 'Cancelled') {
                            return [
                                'success' => false,
                                'error'   => 'This lot is already booked for the selected date/time.',
                                'code'    => 409
                            ];
                        }
                    }
                }

                $oldDate = $lockedSchedule['schedule_date'];
                $oldTime = $lockedSchedule['schedule_time'];

                // Layer 4 & 5: Update Schedule and handle DB unique constraint collision
                try {
                    $upd = $this->db->prepare("
                        UPDATE burial_schedules
                        SET schedule_date = ?, schedule_time = ?
                        WHERE schedule_id = ?
                    ");
                    $upd->execute([$normalizedDate, $resolvedTime, $scheduleId]);
                } catch (PDOException $e) {
                    if ($e->getCode() === '23000' && str_contains($e->getMessage(), 'uq_active_schedule_slot')) {
                        return [
                            'success' => false,
                            'error'   => 'This lot is already booked for the selected date/time.',
                            'code'    => 409
                        ];
                    }
                    throw $e;
                }

                // Structured Audit Log (written once)
                $this->auditLogModel->log(
                    'booking.rescheduled',
                    $userId,
                    $username,
                    'Schedule',
                    $scheduleId,
                    [
                        'old_date' => $oldDate,
                        'new_date' => $normalizedDate,
                        'old_time' => $oldTime,
                        'new_time' => $resolvedTime,
                        'source'   => $source
                    ]
                );

                // Queue afterCommit notification
                $recipientId = (int) $lockedSchedule['created_by'];
                Database::getInstance()->afterCommit(function () use ($lockedSchedule, $normalizedDate, $resolvedTime, $recipientId) {
                    $notificationModel = new Notification();
                    $notificationModel->create([
                        'title'             => 'Booking Rescheduled',
                        'message'           => sprintf('Your burial reservation for lot #%s has been rescheduled to %s%s.', $lockedSchedule['lot_id'], $normalizedDate, $resolvedTime ? " at {$resolvedTime}" : ''),
                        'notification_type' => 'Schedule',
                        'user_id'           => $recipientId,
                        'is_read'           => 0,
                    ]);
                });

                return [
                    'success'           => true,
                    'booking_type'      => 'burial',
                    'booking_id'        => $scheduleId,
                    'booking_reference' => "BUR-{$scheduleId}",
                    'old_date'          => $oldDate,
                    'new_date'          => $normalizedDate,
                    'old_time'          => $oldTime,
                    'new_time'          => $resolvedTime,
                    'message'           => "Your burial booking BUR-{$scheduleId} has been successfully rescheduled to {$normalizedDate}.",
                    'code'              => 200
                ];
            });
        } catch (Throwable $t) {
            return ['success' => false, 'error' => 'Failed to reschedule burial booking: ' . $t->getMessage(), 'code' => 500];
        }
    }

    /**
     * Reschedule Cremation Record.
     */
    public function rescheduleCremationRecord(int $cremationId, string $targetDate, $actor, string $source = 'AI_BOOKING_ASSISTANT'): array {
        $userId = self::actorId($actor);
        $username = self::actorUsername($actor);
        $userRole = self::actorRole($actor);
        $isAdminOrStaff = in_array($userRole, ['admin', 'staff'], true);

        $dateValidation = $this->validateScheduleDate($targetDate, 'cremation');
        if (!$dateValidation['valid']) {
            return ['success' => false, 'error' => $dateValidation['error'], 'code' => 400];
        }
        $normalizedDate = $dateValidation['date'];

        $existing = $this->cremationModel->findById($cremationId);
        if (!$existing) {
            return ['success' => false, 'error' => 'Cremation record not found', 'code' => 404];
        }

        if (!$isAdminOrStaff && (int) ($existing['created_by'] ?? 0) !== $userId) {
            return ['success' => false, 'error' => 'You may only reschedule your own cremation requests', 'code' => 403];
        }

        if (in_array($existing['status'], ['Completed', 'Cancelled'], true)) {
            return [
                'success' => false,
                'error'   => "Cannot reschedule a {$existing['status']} cremation record.",
                'code'    => 409
            ];
        }

        // Idempotency check
        if ($existing['cremation_date'] === $normalizedDate) {
            return [
                'success'           => true,
                'no_change'         => true,
                'booking_type'      => 'cremation',
                'booking_id'        => $cremationId,
                'booking_reference' => "CREM-{$cremationId}",
                'cremation_date'    => $normalizedDate,
                'message'           => "Cremation request CREM-{$cremationId} is already scheduled for {$normalizedDate}.",
                'code'              => 200
            ];
        }

        try {
            return $this->runInTransaction(function () use ($cremationId, $normalizedDate, $existing, $userId, $username, $source) {
                $stmt = $this->db->prepare("SELECT * FROM cremation_records WHERE cremation_id = ? FOR UPDATE");
                $stmt->execute([$cremationId]);
                $lockedCremation = $stmt->fetch();

                if (!$lockedCremation) {
                    return ['success' => false, 'error' => 'Cremation record not found', 'code' => 404];
                }

                if (in_array($lockedCremation['status'], ['Completed', 'Cancelled'], true)) {
                    return [
                        'success' => false,
                        'error'   => "Cannot reschedule a {$lockedCremation['status']} cremation record.",
                        'code'    => 409
                    ];
                }

                $oldDate = $lockedCremation['cremation_date'];

                $upd = $this->db->prepare("UPDATE cremation_records SET cremation_date = ? WHERE cremation_id = ?");
                $upd->execute([$normalizedDate, $cremationId]);

                $this->auditLogModel->log(
                    'booking.rescheduled',
                    $userId,
                    $username,
                    'Cremation',
                    $cremationId,
                    [
                        'old_date' => $oldDate,
                        'new_date' => $normalizedDate,
                        'source'   => $source
                    ]
                );

                $recipientId = (int) $lockedCremation['created_by'];
                Database::getInstance()->afterCommit(function () use ($lockedCremation, $normalizedDate, $recipientId) {
                    $notificationModel = new Notification();
                    $notificationModel->create([
                        'title'             => 'Cremation Rescheduled',
                        'message'           => sprintf('Your cremation request has been rescheduled to %s.', $normalizedDate),
                        'notification_type' => 'Cremation',
                        'user_id'           => $recipientId,
                        'is_read'           => 0,
                    ]);
                });

                return [
                    'success'           => true,
                    'booking_type'      => 'cremation',
                    'booking_id'        => $cremationId,
                    'booking_reference' => "CREM-{$cremationId}",
                    'old_date'          => $oldDate,
                    'new_date'          => $normalizedDate,
                    'message'           => "Your cremation booking CREM-{$cremationId} has been successfully rescheduled to {$normalizedDate}.",
                    'code'              => 200
                ];
            });
        } catch (Throwable $t) {
            return ['success' => false, 'error' => 'Failed to reschedule cremation: ' . $t->getMessage(), 'code' => 500];
        }
    }
}
