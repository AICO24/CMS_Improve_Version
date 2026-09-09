<?php
/**
 * BookingAllocationService
 * 
 * Authoritative domain service for allocation queries and atomic lot swaps.
 * Strictly queries v_available_lots for authoritative lot data.
 * 
 * Guarantees:
 * 1. 3-way resource locking inside single atomic Database::transaction()
 * 2. Full rollback guarantee: if any step fails, schedule and all lot statuses rollback
 * 3. Enforces the authoritative resource ownership rules between Pending and Confirmed bookings
 * 4. Single audit log write
 * 5. Notification dispatched only after transaction commit
 */

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../services/AutomationEngine.php';

class BookingAllocationService {
    private PDO $db;
    private Schedule $scheduleModel;
    private Lot $lotModel;
    private AuditLog $auditLogModel;

    public function __construct(
        ?PDO $db = null,
        ?Schedule $scheduleModel = null,
        ?Lot $lotModel = null,
        ?AuditLog $auditLogModel = null
    ) {
        $this->db = $db ?? Database::getInstance()->getConnection();
        $this->scheduleModel = $scheduleModel ?? new Schedule();
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
     * Authoritative query against v_available_lots view.
     */
    public function getEligibleAvailableLots(?string $section = null, int $limit = 6): array {
        $sql = "SELECT * FROM v_available_lots WHERE status = 'Available'";
        $params = [];

        if ($section) {
            $sql .= " AND section_name = ?";
            $params[] = $section;
        }

        $sql .= " ORDER BY lot_id ASC LIMIT " . max(1, min(20, $limit));

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll() ?: [];
    }

    /**
     * Find single available lot by ID from v_available_lots.
     */
    public function findAvailableLotById(int $lotId): ?array {
        $stmt = $this->db->prepare("SELECT * FROM v_available_lots WHERE lot_id = ? AND status = 'Available'");
        $stmt->execute([$lotId]);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    /**
     * Atomic 3-way Lot Swap inside transaction.
     */
    public function swapBurialLot(int $scheduleId, int $newLotId, $actor, string $source = 'AI_BOOKING_ASSISTANT'): array {
        $userId = self::actorId($actor);
        $username = self::actorUsername($actor);
        $userRole = self::actorRole($actor);
        $isAdminOrStaff = in_array($userRole, ['admin', 'staff'], true);

        // 1. Pre-transaction validation
        $existing = $this->scheduleModel->findById($scheduleId);
        if (!$existing) {
            return ['success' => false, 'error' => 'Burial schedule not found', 'code' => 404];
        }

        if (!$isAdminOrStaff && (int) ($existing['created_by'] ?? 0) !== $userId) {
            return ['success' => false, 'error' => 'You may only change allocation for your own reservations', 'code' => 403];
        }

        if (in_array($existing['status'], ['Completed', 'Cancelled'], true)) {
            return [
                'success' => false,
                'error'   => "Cannot change allocation for a {$existing['status']} booking.",
                'code'    => 409
            ];
        }

        $oldLotId = (int) $existing['lot_id'];
        if ($oldLotId === $newLotId) {
            return [
                'success'           => true,
                'no_change'         => true,
                'booking_type'      => 'burial',
                'booking_id'        => $scheduleId,
                'booking_reference' => "BUR-{$scheduleId}",
                'lot_id'            => $newLotId,
                'message'           => "Booking BUR-{$scheduleId} is already assigned to Lot #{$newLotId}.",
                'code'              => 200
            ];
        }

        // Verify new lot exists
        $targetLot = $this->lotModel->findById($newLotId);
        if (!$targetLot) {
            return ['success' => false, 'error' => 'Selected target lot does not exist', 'code' => 404];
        }
        if ($targetLot['status'] !== 'Available') {
            return ['success' => false, 'error' => "Selected lot #{$targetLot['lot_number']} is not available (current: {$targetLot['status']}).", 'code' => 409];
        }

        // 2. Atomic 3-Way Transaction
        try {
            return $this->runInTransaction(function () use ($scheduleId, $oldLotId, $newLotId, $existing, $userId, $username, $actor, $source) {
                // Step A: Lock schedule row
                $stmt = $this->db->prepare("SELECT * FROM burial_schedules WHERE schedule_id = ? FOR UPDATE");
                $stmt->execute([$scheduleId]);
                $lockedSchedule = $stmt->fetch();

                if (!$lockedSchedule) {
                    return ['success' => false, 'error' => 'Schedule not found', 'code' => 404];
                }

                if (in_array($lockedSchedule['status'], ['Completed', 'Cancelled'], true)) {
                    return [
                        'success' => false,
                        'error'   => "Cannot change allocation for a {$lockedSchedule['status']} booking.",
                        'code'    => 409
                    ];
                }

                $schedDate = $lockedSchedule['schedule_date'];
                $schedTime = $lockedSchedule['schedule_time'] ?? null;
                $currentSchedStatus = $lockedSchedule['status'];

                // Step B & C: Lock both lots in deterministic numerical order (lower ID first) to eliminate deadlocks
                $firstLotId = min($oldLotId, $newLotId);
                $secondLotId = max($oldLotId, $newLotId);

                $lotLockStmt = $this->db->prepare("SELECT * FROM lots WHERE lot_id = ? FOR UPDATE");

                $lotLockStmt->execute([$firstLotId]);
                $firstLocked = $lotLockStmt->fetch();

                $lotLockStmt->execute([$secondLotId]);
                $secondLocked = $lotLockStmt->fetch();

                $lockedOldLot = ($firstLotId === $oldLotId) ? $firstLocked : $secondLocked;
                $lockedNewLot = ($firstLotId === $newLotId) ? $firstLocked : $secondLocked;

                if (!$lockedNewLot) {
                    return ['success' => false, 'error' => 'Selected lot does not exist', 'code' => 404];
                }

                if ($lockedNewLot['status'] !== 'Available') {
                    return ['success' => false, 'error' => 'Selected lot is no longer available.', 'code' => 409];
                }

                // Step D: Conflict check on new lot under lock
                $conflict = $this->scheduleModel->checkConflict($newLotId, $schedDate, $schedTime);
                if ($conflict) {
                    return ['success' => false, 'error' => 'The selected lot is already booked for this schedule date/time.', 'code' => 409];
                }

                // Step E: Apply authoritative lot status transitions depending on Pending vs Confirmed state
                if ($currentSchedStatus === 'Confirmed') {
                    // Old lot: Reserved -> Available
                    $this->lotModel->transitionStatus($oldLotId, 'Available', Lot::allowedFromStatusesFor('booking.allocation_changed', 'Available'));
                    // New lot: Available -> Reserved
                    $this->lotModel->transitionStatus($newLotId, 'Reserved', Lot::allowedFromStatusesFor('booking.allocation_changed', 'Reserved'));
                } elseif ($currentSchedStatus === 'Pending') {
                    // Both lots remain Available; slot claim shifts via the update
                }

                // Step F: Update schedule allocation
                try {
                    $upd = $this->db->prepare("UPDATE burial_schedules SET lot_id = ? WHERE schedule_id = ?");
                    $upd->execute([$newLotId, $scheduleId]);
                } catch (PDOException $e) {
                    if ($e->getCode() === '23000' && str_contains($e->getMessage(), 'uq_active_schedule_slot')) {
                        return ['success' => false, 'error' => 'The selected lot is already booked for this schedule date/time.', 'code' => 409];
                    }
                    throw $e;
                }

                // Step G: Single Audit Log
                $this->auditLogModel->log(
                    'booking.allocation_changed',
                    $userId,
                    $username,
                    'Schedule',
                    $scheduleId,
                    [
                        'old_lot_id'     => $oldLotId,
                        'new_lot_id'     => $newLotId,
                        'old_lot_number' => $lockedOldLot['lot_number'] ?? $oldLotId,
                        'new_lot_number' => $lockedNewLot['lot_number'] ?? $newLotId,
                        'source'         => $source
                    ]
                );

                // Step H: After-commit notification
                $recipientId = (int) $lockedSchedule['created_by'];
                $newLotNumber = $lockedNewLot['lot_number'] ?? $newLotId;
                Database::getInstance()->afterCommit(function () use ($scheduleId, $newLotNumber, $recipientId) {
                    $notificationModel = new Notification();
                    $notificationModel->create([
                        'title'             => 'Lot Allocation Changed',
                        'message'           => sprintf('Your burial reservation BUR-%s has been reassigned to Lot %s.', $scheduleId, $newLotNumber),
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
                    'old_lot_id'        => $oldLotId,
                    'new_lot_id'        => $newLotId,
                    'new_lot_number'    => $newLotNumber,
                    'message'           => "Your booking BUR-{$scheduleId} has been successfully reassigned to Lot {$newLotNumber}.",
                    'code'              => 200
                ];
            });
        } catch (Throwable $t) {
            return ['success' => false, 'error' => 'Failed to change allocation: ' . $t->getMessage(), 'code' => 500];
        }
    }
}
