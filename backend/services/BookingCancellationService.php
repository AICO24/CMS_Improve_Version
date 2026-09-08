<?php
/**
 * BookingCancellationService
 * 
 * Authoritative domain service for transactional booking cancellation.
 * Reused by both HTTP controllers (ScheduleController, CremationController)
 * and conversational AI action pipelines (BookingActionRegistry).
 * 
 * Guarantees:
 * 1. Soft cancellation only (status = 'Cancelled'). Preserves historical records.
 * 2. Terminal state immutability (rejects already completed or cancelled bookings).
 * 3. Authoritative lot release via AutomationEngine and Lot::transitionStatus().
 * 4. Verified payment protection (preserves financial records, never auto-refunds,
 *    flags refund_review_required = true for billing/cashier processing).
 * 5. Atomic transaction execution with FOR UPDATE locking.
 * 6. Audit logging with source = 'AI_BOOKING_ASSISTANT' or caller actor.
 * 7. After-commit notification dispatch via Database::afterCommit().
 */

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../services/AutomationEngine.php';

class BookingCancellationService {
    private PDO $db;
    private Schedule $scheduleModel;
    private Cremation $cremationModel;
    private Lot $lotModel;
    private Payment $paymentModel;
    private AuditLog $auditLogModel;

    public function __construct(
        ?PDO $db = null,
        ?Schedule $scheduleModel = null,
        ?Cremation $cremationModel = null,
        ?Lot $lotModel = null,
        ?Payment $paymentModel = null,
        ?AuditLog $auditLogModel = null
    ) {
        $this->db = $db ?? Database::getInstance()->getConnection();
        $this->scheduleModel = $scheduleModel ?? new Schedule();
        $this->cremationModel = $cremationModel ?? new Cremation();
        $this->lotModel = $lotModel ?? new Lot();
        $this->paymentModel = $paymentModel ?? new Payment();
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
     * Check if a booking has any verified payments on file.
     */
    public function hasVerifiedPayment(string $bookingType, int $bookingId): bool {
        if ($bookingType === 'burial') {
            $payments = $this->paymentModel->findAll([
                'reference_id'        => $bookingId,
                'verification_status' => 'Verified'
            ]);
            foreach ($payments as $p) {
                if (($p['reference_kind'] ?? '') === 'schedule' || ($p['transaction_type'] ?? '') === 'Lot Purchase') {
                    return true;
                }
            }
        } elseif ($bookingType === 'cremation') {
            $payments = $this->paymentModel->findAll([
                'reference_id'        => $bookingId,
                'transaction_type'    => 'Cremation',
                'verification_status' => 'Verified'
            ]);
            if (!empty($payments)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Authoritative Burial Schedule Cancellation.
     */
    public function cancelBurialSchedule(int $scheduleId, $actor, ?string $reason = null, string $source = 'AI_BOOKING_ASSISTANT'): array {
        $userId = self::actorId($actor);
        $userRole = self::actorRole($actor);
        $username = self::actorUsername($actor);
        $isAdminOrStaff = in_array($userRole, ['admin', 'staff'], true);

        // Pre-transaction read
        $existing = $this->scheduleModel->findById($scheduleId);
        if (!$existing) {
            return ['success' => false, 'error' => 'Burial reservation not found', 'code' => 404];
        }

        // Authorization check
        if (!$isAdminOrStaff && (int) ($existing['created_by'] ?? 0) !== $userId) {
            return ['success' => false, 'error' => 'You may only cancel your own reservations', 'code' => 403];
        }

        // Idempotency: Already cancelled
        if ($existing['status'] === 'Cancelled') {
            return [
                'success'           => true,
                'already_cancelled' => true,
                'booking_cancelled' => false,
                'booking_type'      => 'burial',
                'booking_id'        => $scheduleId,
                'booking_reference' => "BUR-{$scheduleId}",
                'status'            => 'Cancelled',
                'message'           => "Booking BUR-{$scheduleId} has already been cancelled.",
                'code'              => 200
            ];
        }

        // Terminal state: Completed bookings cannot be cancelled
        if ($existing['status'] === 'Completed') {
            return [
                'success' => false,
                'error'   => 'Completed bookings cannot be cancelled as services have already been finalized.',
                'code'    => 409
            ];
        }

        // Verified payment check (Payment safety: do NOT alter financial records)
        $hasVerifiedPayment = $this->hasVerifiedPayment('burial', $scheduleId);

        // Execute atomically
        try {
            return $this->runInTransaction(function () use ($scheduleId, $existing, $userId, $username, $actor, $reason, $source, $hasVerifiedPayment) {
                // Re-fetch and lock schedule row
                $stmt = $this->db->prepare("SELECT * FROM burial_schedules WHERE schedule_id = ? FOR UPDATE");
                $stmt->execute([$scheduleId]);
                $lockedSchedule = $stmt->fetch();

                if (!$lockedSchedule) {
                    return ['success' => false, 'error' => 'Burial schedule not found', 'code' => 404];
                }

                if ($lockedSchedule['status'] === 'Cancelled') {
                    return [
                        'success'           => true,
                        'already_cancelled' => true,
                        'booking_cancelled' => false,
                        'booking_type'      => 'burial',
                        'booking_id'        => $scheduleId,
                        'booking_reference' => "BUR-{$scheduleId}",
                        'status'            => 'Cancelled',
                        'message'           => "Booking BUR-{$scheduleId} has already been cancelled.",
                        'code'              => 200
                    ];
                }

                if ($lockedSchedule['status'] === 'Completed') {
                    return [
                        'success' => false,
                        'error'   => 'Completed bookings cannot be cancelled.',
                        'code'    => 409
                    ];
                }

                $previousStatus = $lockedSchedule['status'];

                // 1. Soft-cancel schedule
                $updStmt = $this->db->prepare("UPDATE burial_schedules SET status = 'Cancelled' WHERE schedule_id = ?");
                $updStmt->execute([$scheduleId]);

                // 2. Release lot resource through authoritative Lot lifecycle
                $lotId = (int) $lockedSchedule['lot_id'];
                if (in_array($previousStatus, ['Confirmed', 'Pending'], true)) {
                    $lotModel = $this->lotModel;
                    $allowedFromStatuses = Lot::allowedFromStatusesFor('schedule.cancelled', 'Available');
                    AutomationEngine::run(
                        'schedule.cancelled',
                        'Lot',
                        $lotId,
                        $actor,
                        function () use ($lotModel, $lotId, $allowedFromStatuses) {
                            $lot = $lotModel->findById($lotId);
                            if (!$lot) return ['Lot no longer exists'];
                            if ($allowedFromStatuses !== null && !in_array($lot['status'], $allowedFromStatuses, true)) {
                                return ['Lot is not in an expected status for cancellation'];
                            }
                            return true;
                        },
                        function () use ($lotModel, $lotId, $allowedFromStatuses) {
                            $lotModel->transitionStatus($lotId, 'Available', $allowedFromStatuses);
                        }
                    );
                }

                // 3. Structured Audit Log (written once)
                $auditMetadata = [
                    'previous_status'        => $previousStatus,
                    'lot_id'                 => $lotId,
                    'source'                 => $source,
                    'payment_affected'       => false,
                    'refund_review_required' => $hasVerifiedPayment,
                ];
                if ($reason) {
                    $auditMetadata['reason'] = $reason;
                }

                $this->auditLogModel->log(
                    'booking.cancelled',
                    $userId,
                    $username,
                    'Schedule',
                    $scheduleId,
                    $auditMetadata
                );

                // 4. Deferred side-effects: Dispatch notification ONLY after commit
                $recipientId = (int) $lockedSchedule['created_by'];
                Database::getInstance()->afterCommit(function () use ($lockedSchedule, $recipientId) {
                    $notificationModel = new Notification();
                    $notificationModel->create([
                        'title'             => 'Reservation Cancelled',
                        'message'           => sprintf('Your burial reservation for lot #%s on %s has been cancelled.', $lockedSchedule['lot_id'], $lockedSchedule['schedule_date']),
                        'notification_type' => 'Schedule',
                        'user_id'           => $recipientId,
                        'is_read'           => 0,
                    ]);
                });

                $replyText = "Your burial booking BUR-{$scheduleId} has been cancelled and the lot reservation has been released.";
                if ($hasVerifiedPayment) {
                    $replyText .= " Note: This booking has a verified payment on file. Financial records have been preserved and flagged for administrative refund review.";
                }

                return [
                    'success'                => true,
                    'booking_cancelled'      => true,
                    'booking_type'           => 'burial',
                    'booking_id'             => $scheduleId,
                    'booking_reference'      => "BUR-{$scheduleId}",
                    'previous_status'        => $previousStatus,
                    'status'                 => 'Cancelled',
                    'payment_affected'       => false,
                    'refund_review_required' => $hasVerifiedPayment,
                    'message'                => $replyText,
                    'code'                   => 200
                ];
            });
        } catch (Throwable $t) {
            return ['success' => false, 'error' => 'Failed to cancel burial booking: ' . $t->getMessage(), 'code' => 500];
        }
    }

    /**
     * Authoritative Cremation Record Cancellation.
     */
    public function cancelCremationRecord(int $cremationId, $actor, ?string $reason = null, string $source = 'AI_BOOKING_ASSISTANT'): array {
        $userId = self::actorId($actor);
        $userRole = self::actorRole($actor);
        $username = self::actorUsername($actor);
        $isAdminOrStaff = in_array($userRole, ['admin', 'staff'], true);

        $existing = $this->cremationModel->findById($cremationId);
        if (!$existing) {
            return ['success' => false, 'error' => 'Cremation record not found', 'code' => 404];
        }

        if (!$isAdminOrStaff && (int) ($existing['created_by'] ?? 0) !== $userId) {
            return ['success' => false, 'error' => 'You may only cancel your own cremation requests', 'code' => 403];
        }

        if ($existing['status'] === 'Cancelled') {
            return [
                'success'           => true,
                'already_cancelled' => true,
                'booking_cancelled' => false,
                'booking_type'      => 'cremation',
                'booking_id'        => $cremationId,
                'booking_reference' => "CREM-{$cremationId}",
                'status'            => 'Cancelled',
                'message'           => "Cremation request CREM-{$cremationId} has already been cancelled.",
                'code'              => 200
            ];
        }

        if ($existing['status'] === 'Completed') {
            return [
                'success' => false,
                'error'   => 'Completed cremation records cannot be cancelled.',
                'code'    => 409
            ];
        }

        $hasVerifiedPayment = $this->hasVerifiedPayment('cremation', $cremationId);

        try {
            return $this->runInTransaction(function () use ($cremationId, $existing, $userId, $username, $actor, $reason, $source, $hasVerifiedPayment) {
                $stmt = $this->db->prepare("SELECT * FROM cremation_records WHERE cremation_id = ? FOR UPDATE");
                $stmt->execute([$cremationId]);
                $lockedCremation = $stmt->fetch();

                if (!$lockedCremation) {
                    return ['success' => false, 'error' => 'Cremation record not found', 'code' => 404];
                }

                if ($lockedCremation['status'] === 'Cancelled') {
                    return [
                        'success'           => true,
                        'already_cancelled' => true,
                        'booking_cancelled' => false,
                        'booking_type'      => 'cremation',
                        'booking_id'        => $cremationId,
                        'booking_reference' => "CREM-{$cremationId}",
                        'status'            => 'Cancelled',
                        'message'           => "Cremation request CREM-{$cremationId} has already been cancelled.",
                        'code'              => 200
                    ];
                }

                if ($lockedCremation['status'] === 'Completed') {
                    return [
                        'success' => false,
                        'error'   => 'Completed cremation records cannot be cancelled.',
                        'code'    => 409
                    ];
                }

                $previousStatus = $lockedCremation['status'];

                // 1. Soft-cancel cremation record
                $updStmt = $this->db->prepare("UPDATE cremation_records SET status = 'Cancelled' WHERE cremation_id = ?");
                $updStmt->execute([$cremationId]);

                // 2. Structured Audit Log
                $auditMetadata = [
                    'previous_status'        => $previousStatus,
                    'niche_number'           => $lockedCremation['niche_number'] ?? null,
                    'source'                 => $source,
                    'payment_affected'       => false,
                    'refund_review_required' => $hasVerifiedPayment,
                ];
                if ($reason) {
                    $auditMetadata['reason'] = $reason;
                }

                $this->auditLogModel->log(
                    'booking.cancelled',
                    $userId,
                    $username,
                    'Cremation',
                    $cremationId,
                    $auditMetadata
                );

                // 3. Deferred notification after commit
                $recipientId = (int) $lockedCremation['created_by'];
                Database::getInstance()->afterCommit(function () use ($lockedCremation, $recipientId) {
                    $notificationModel = new Notification();
                    $notificationModel->create([
                        'title'             => 'Cremation Request Cancelled',
                        'message'           => sprintf('Your cremation request (Date: %s) has been cancelled.', $lockedCremation['cremation_date'] ?? 'N/A'),
                        'notification_type' => 'Cremation',
                        'user_id'           => $recipientId,
                        'is_read'           => 0,
                    ]);
                });

                $replyText = "Your cremation booking CREM-{$cremationId} has been cancelled.";
                if ($hasVerifiedPayment) {
                    $replyText .= " Note: This booking has a verified payment on file. Financial records have been preserved and flagged for administrative refund review.";
                }

                return [
                    'success'                => true,
                    'booking_cancelled'      => true,
                    'booking_type'           => 'cremation',
                    'booking_id'             => $cremationId,
                    'booking_reference'      => "CREM-{$cremationId}",
                    'previous_status'        => $previousStatus,
                    'status'                 => 'Cancelled',
                    'payment_affected'       => false,
                    'refund_review_required' => $hasVerifiedPayment,
                    'message'                => $replyText,
                    'code'                   => 200
                ];
            });
        } catch (Throwable $t) {
            return ['success' => false, 'error' => 'Failed to cancel cremation booking: ' . $t->getMessage(), 'code' => 500];
        }
    }
}
