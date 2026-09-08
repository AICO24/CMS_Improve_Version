<?php
/**
 * BookingPendingAction Domain Model
 * 
 * Manages short-lived, action-bound, user-scoped pending actions for destructive
 * and operational booking operations (Reschedule, Cancellation, Allocation Change).
 * 
 * Conforms to Booking Automation V2 (Batch 3).
 */

require_once __DIR__ . '/../config/database.php';

class BookingPendingAction {
    public const STATUS_AWAITING_CONFIRMATION = 'AWAITING_CONFIRMATION';
    public const STATUS_CONFIRMED             = 'CONFIRMED';
    public const STATUS_EXECUTING             = 'EXECUTING';
    public const STATUS_EXECUTED              = 'EXECUTED';
    public const STATUS_FAILED                = 'FAILED';
    public const STATUS_REJECTED              = 'REJECTED';
    public const STATUS_EXPIRED               = 'EXPIRED';
    public const STATUS_SUPERSEDED            = 'SUPERSEDED';

    public const ACTION_RESCHEDULE_BOOKING = 'RESCHEDULE_BOOKING';
    public const ACTION_CANCEL_BOOKING     = 'CANCEL_BOOKING';
    public const ACTION_CHANGE_ALLOCATION  = 'CHANGE_ALLOCATION';

    public const DEFAULT_TTL_SECONDS = 900; // 15 minutes

    private PDO $db;

    public function __construct(?PDO $db = null) {
        $this->db = $db ?? Database::getInstance()->getConnection();
    }

    /**
     * Compute deterministic SHA256 hash for immutable payload verification.
     */
    public static function computePayloadHash(array $payload): string {
        // Sort keys recursively for canonical representation
        self::sortRecursive($payload);
        return hash('sha256', json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES));
    }

    private static function sortRecursive(array &$array): void {
        foreach ($array as &$value) {
            if (is_array($value)) {
                self::sortRecursive($value);
            }
        }
        ksort($array);
    }

    /**
     * Generate cryptographically secure 64-character token.
     */
    public static function generateConfirmationToken(): string {
        return bin2hex(random_bytes(32));
    }

    /**
     * Invalidate/supersede all existing AWAITING_CONFIRMATION actions for this specific booking.
     * Must be called inside or prior to new action creation to guarantee single active action per booking.
     */
    public function supersedeExistingActions(int $userId, string $bookingType, int $bookingId): int {
        $stmt = $this->db->prepare("
            UPDATE booking_pending_actions
            SET status = :superseded
            WHERE user_id = :user_id
              AND booking_type = :booking_type
              AND booking_id = :booking_id
              AND status = :awaiting
        ");
        $stmt->execute([
            ':superseded'   => self::STATUS_SUPERSEDED,
            ':user_id'      => $userId,
            ':booking_type' => $bookingType,
            ':booking_id'   => $bookingId,
            ':awaiting'     => self::STATUS_AWAITING_CONFIRMATION
        ]);
        return $stmt->rowCount();
    }

    /**
     * Stage a new pending action. Automatically supersedes older active actions for this booking.
     */
    public function createPendingAction(
        int $userId,
        string $bookingType,
        int $bookingId,
        string $actionType,
        array $payload,
        int $ttlSeconds = self::DEFAULT_TTL_SECONDS
    ): array {
        $this->supersedeExistingActions($userId, $bookingType, $bookingId);

        $token = self::generateConfirmationToken();
        $payloadHash = self::computePayloadHash($payload);

        $stmt = $this->db->prepare("
            INSERT INTO booking_pending_actions
            (user_id, booking_type, booking_id, action_type, payload, payload_hash, confirmation_token, status, expires_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL ? SECOND))
        ");
        $stmt->execute([
            $userId,
            $bookingType,
            $bookingId,
            $actionType,
            json_encode($payload, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES),
            $payloadHash,
            $token,
            self::STATUS_AWAITING_CONFIRMATION,
            $ttlSeconds
        ]);

        $id = (int) $this->db->lastInsertId();
        return $this->findById($id);
    }

    /**
     * Find single active non-expired pending action for user.
     */
    public function findActiveByUser(int $userId, ?string $actionType = null): ?array {
        $sql = "
            SELECT * FROM booking_pending_actions
            WHERE user_id = ?
              AND status = ?
              AND expires_at > NOW()
        ";
        $params = [$userId, self::STATUS_AWAITING_CONFIRMATION];

        if ($actionType) {
            $sql .= " AND action_type = ?";
            $params[] = $actionType;
        }

        $sql .= " ORDER BY id DESC LIMIT 1";

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        if ($row && !empty($row['payload'])) {
            $row['payload'] = json_decode($row['payload'], true);
        }
        return $row ?: null;
    }

    /**
     * Find all active non-expired pending actions for user.
     */
    public function findAllActiveByUser(int $userId): array {
        $stmt = $this->db->prepare("
            SELECT * FROM booking_pending_actions
            WHERE user_id = ?
              AND status = ?
              AND expires_at > NOW()
            ORDER BY id DESC
        ");
        $stmt->execute([$userId, self::STATUS_AWAITING_CONFIRMATION]);
        $rows = $stmt->fetchAll();
        foreach ($rows as &$r) {
            if (!empty($r['payload'])) {
                $r['payload'] = json_decode($r['payload'], true);
            }
        }
        return $rows;
    }

    /**
     * Find active pending action specifically for a booking.
     */
    public function findActiveByBooking(int $userId, string $bookingType, int $bookingId): ?array {
        $stmt = $this->db->prepare("
            SELECT * FROM booking_pending_actions
            WHERE user_id = ?
              AND booking_type = ?
              AND booking_id = ?
              AND status = ?
              AND expires_at > NOW()
            ORDER BY id DESC LIMIT 1
        ");
        $stmt->execute([$userId, $bookingType, $bookingId, self::STATUS_AWAITING_CONFIRMATION]);
        $row = $stmt->fetch();
        if ($row && !empty($row['payload'])) {
            $row['payload'] = json_decode($row['payload'], true);
        }
        return $row ?: null;
    }

    public function findById(int $id): ?array {
        $stmt = $this->db->prepare("SELECT *, (expires_at <= NOW()) AS is_expired FROM booking_pending_actions WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if ($row && !empty($row['payload'])) {
            $row['payload'] = json_decode($row['payload'], true);
        }
        return $row ?: null;
    }

    public function findByToken(string $token): ?array {
        $stmt = $this->db->prepare("SELECT *, (expires_at <= NOW()) AS is_expired FROM booking_pending_actions WHERE confirmation_token = ?");
        $stmt->execute([$token]);
        $row = $stmt->fetch();
        if ($row && !empty($row['payload'])) {
            $row['payload'] = json_decode($row['payload'], true);
        }
        return $row ?: null;
    }

    /**
     * Pessimistic row locking inside transaction.
     */
    public function lockForUpdate(int $id): ?array {
        $stmt = $this->db->prepare("SELECT *, (expires_at <= NOW()) AS is_expired FROM booking_pending_actions WHERE id = ? FOR UPDATE");
        $stmt->execute([$id]);
        $row = $stmt->fetch();
        if ($row && !empty($row['payload'])) {
            $row['payload'] = json_decode($row['payload'], true);
        }
        return $row ?: null;
    }

    public function markConfirmed(int $id): bool {
        $stmt = $this->db->prepare("
            UPDATE booking_pending_actions
            SET status = :status, confirmed_at = NOW()
            WHERE id = :id AND status = :awaiting
        ");
        return $stmt->execute([
            ':status'   => self::STATUS_CONFIRMED,
            ':id'       => $id,
            ':awaiting' => self::STATUS_AWAITING_CONFIRMATION
        ]);
    }

    public function markExecuting(int $id): bool {
        $stmt = $this->db->prepare("
            UPDATE booking_pending_actions
            SET status = :status
            WHERE id = :id AND status IN ('CONFIRMED', 'AWAITING_CONFIRMATION')
        ");
        return $stmt->execute([
            ':status' => self::STATUS_EXECUTING,
            ':id'     => $id
        ]);
    }

    public function markExecuted(int $id): bool {
        $stmt = $this->db->prepare("
            UPDATE booking_pending_actions
            SET status = :status, executed_at = NOW()
            WHERE id = :id AND status = :executing
        ");
        return $stmt->execute([
            ':status'    => self::STATUS_EXECUTED,
            ':id'        => $id,
            ':executing' => self::STATUS_EXECUTING
        ]);
    }

    public function markFailed(int $id): bool {
        $stmt = $this->db->prepare("
            UPDATE booking_pending_actions
            SET status = :status
            WHERE id = :id
        ");
        return $stmt->execute([
            ':status' => self::STATUS_FAILED,
            ':id'     => $id
        ]);
    }

    public function markRejected(int $id): bool {
        $stmt = $this->db->prepare("
            UPDATE booking_pending_actions
            SET status = :status
            WHERE id = :id AND status = :awaiting
        ");
        return $stmt->execute([
            ':status'   => self::STATUS_REJECTED,
            ':id'       => $id,
            ':awaiting' => self::STATUS_AWAITING_CONFIRMATION
        ]);
    }

    public function markExpired(int $id): bool {
        $stmt = $this->db->prepare("
            UPDATE booking_pending_actions
            SET status = :status
            WHERE id = :id AND status = :awaiting
        ");
        return $stmt->execute([
            ':status'   => self::STATUS_EXPIRED,
            ':id'       => $id,
            ':awaiting' => self::STATUS_AWAITING_CONFIRMATION
        ]);
    }

    public function markSuperseded(int $id): bool {
        $stmt = $this->db->prepare("
            UPDATE booking_pending_actions
            SET status = :status
            WHERE id = :id AND status = :awaiting
        ");
        return $stmt->execute([
            ':status'   => self::STATUS_SUPERSEDED,
            ':id'       => $id,
            ':awaiting' => self::STATUS_AWAITING_CONFIRMATION
        ]);
    }

    public function expireStaleActions(): int {
        $stmt = $this->db->prepare("
            UPDATE booking_pending_actions
            SET status = :expired
            WHERE status = :awaiting AND expires_at <= NOW()
        ");
        $stmt->execute([
            ':expired'  => self::STATUS_EXPIRED,
            ':awaiting' => self::STATUS_AWAITING_CONFIRMATION
        ]);
        return $stmt->rowCount();
    }
}
