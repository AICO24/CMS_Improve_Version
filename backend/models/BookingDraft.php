<?php
/**
 * BookingDraft Domain Model
 * 
 * Authoritative server-side guardian of the booking draft lifecycle.
 * Enforces legal state transitions, terminal state protection, expiration
 * boundaries, user ownership scoping, and non-destructive JSON merges.
 * 
 * Conforms strictly to BMS-2 (Cemetery Management System).
 */
require_once __DIR__ . '/../config/database.php';

class BookingDraftException extends RuntimeException {
    protected string $errorType;
    protected int $httpCode;

    public function __construct(string $message, string $errorType = 'DRAFT_ERROR', int $httpCode = 400, ?Throwable $previous = null) {
        $this->errorType = $errorType;
        $this->httpCode = $httpCode;
        parent::__construct($message, $httpCode, $previous);
    }

    public function getErrorType(): string {
        return $this->errorType;
    }

    public function getHttpCode(): int {
        return $this->httpCode;
    }
}

class BookingDraft {
    private PDO $db;

    // Approved Lifecycle States
    public const STATUS_DRAFT_STARTED   = 'DRAFT_STARTED';
    public const STATUS_COLLECTING_INFO = 'COLLECTING_INFO';
    public const STATUS_LOT_SELECTION   = 'LOT_SELECTION';
    public const STATUS_CREMATION_PREFS = 'CREMATION_PREFS';
    public const STATUS_READY_FOR_REVIEW= 'READY_FOR_REVIEW';
    public const STATUS_AWAITING_CONFIRM= 'AWAITING_CONFIRM';
    public const STATUS_COMMITTED       = 'COMMITTED';
    public const STATUS_CANCELLED       = 'CANCELLED';
    public const STATUS_EXPIRED         = 'EXPIRED';

    public const ALL_STATUSES = [
        self::STATUS_DRAFT_STARTED,
        self::STATUS_COLLECTING_INFO,
        self::STATUS_LOT_SELECTION,
        self::STATUS_CREMATION_PREFS,
        self::STATUS_READY_FOR_REVIEW,
        self::STATUS_AWAITING_CONFIRM,
        self::STATUS_COMMITTED,
        self::STATUS_CANCELLED,
        self::STATUS_EXPIRED,
    ];

    public const TERMINAL_STATUSES = [
        self::STATUS_COMMITTED,
        self::STATUS_CANCELLED,
        self::STATUS_EXPIRED,
    ];

    public const ALLOWED_SERVICES = ['burial', 'cremation'];

    /**
     * Strict Server-Side Transition Map
     */
    public const ALLOWED_TRANSITIONS = [
        self::STATUS_DRAFT_STARTED => [
            self::STATUS_COLLECTING_INFO,
            self::STATUS_CANCELLED,
            self::STATUS_EXPIRED,
        ],
        self::STATUS_COLLECTING_INFO => [
            self::STATUS_LOT_SELECTION,
            self::STATUS_CREMATION_PREFS,
            self::STATUS_READY_FOR_REVIEW,
            self::STATUS_CANCELLED,
            self::STATUS_EXPIRED,
        ],
        self::STATUS_LOT_SELECTION => [
            self::STATUS_READY_FOR_REVIEW,
            self::STATUS_COLLECTING_INFO,
            self::STATUS_CANCELLED,
            self::STATUS_EXPIRED,
        ],
        self::STATUS_CREMATION_PREFS => [
            self::STATUS_READY_FOR_REVIEW,
            self::STATUS_COLLECTING_INFO,
            self::STATUS_CANCELLED,
            self::STATUS_EXPIRED,
        ],
        self::STATUS_READY_FOR_REVIEW => [
            self::STATUS_AWAITING_CONFIRM,
            self::STATUS_COLLECTING_INFO,
            self::STATUS_CANCELLED,
            self::STATUS_EXPIRED,
        ],
        self::STATUS_AWAITING_CONFIRM => [
            self::STATUS_COMMITTED,
            self::STATUS_READY_FOR_REVIEW,
            self::STATUS_CANCELLED,
            self::STATUS_EXPIRED,
        ],
        self::STATUS_COMMITTED => [],
        self::STATUS_CANCELLED => [],
        self::STATUS_EXPIRED   => [],
    ];

    public function __construct(?PDO $pdo = null) {
        $this->db = $pdo ?? Database::getInstance()->getConnection();
    }

    /**
     * Determine if a status is terminal (no further modification allowed).
     */
    public static function isTerminalState(string $status): bool {
        return in_array($status, self::TERMINAL_STATUSES, true);
    }

    /**
     * Determine if a draft or expiry timestamp is past expiration.
     * @param array|string $draftOrExpiresAt
     */
    public static function isExpired($draftOrExpiresAt): bool {
        if (is_array($draftOrExpiresAt)) {
            if (($draftOrExpiresAt['status'] ?? '') === self::STATUS_EXPIRED) {
                return true;
            }
            $expiresAt = $draftOrExpiresAt['expires_at'] ?? null;
        } else {
            $expiresAt = $draftOrExpiresAt;
        }

        if (empty($expiresAt)) {
            return false;
        }

        return strtotime($expiresAt) < time();
    }

    /**
     * Create a new booking draft.
     * Starts strictly in DRAFT_STARTED status.
     * 
     * @param int         $userId
     * @param string      $serviceType 'burial' | 'cremation'
     * @param string      $expiresAt   Y-m-d H:i:s
     * @param string|null $conversationId Optional global conversation reference
     * @return int The created draft_id
     * @throws BookingDraftException
     */
    public function create(int $userId, string $serviceType, string $expiresAt, ?string $conversationId = null): int {
        if (!in_array($serviceType, self::ALLOWED_SERVICES, true)) {
            throw new BookingDraftException("Invalid service type '{$serviceType}'. Must be 'burial' or 'cremation'.", 'INVALID_SERVICE_TYPE', 400);
        }

        if (strtotime($expiresAt) <= time()) {
            throw new BookingDraftException("Expiration timestamp must be in the future.", 'INVALID_EXPIRATION', 400);
        }

        $stmt = $this->db->prepare("
            INSERT INTO booking_drafts (
                user_id, service_type, status, extracted_data, missing_fields, conversation_id, expires_at
            ) VALUES (
                ?, ?, ?, '{}', '[]', ?, ?
            )
        ");

        $stmt->execute([
            $userId,
            $serviceType,
            self::STATUS_DRAFT_STARTED,
            $conversationId,
            $expiresAt
        ]);

        return (int) $this->db->lastInsertId();
    }

    /**
     * Find a single draft by primary key.
     * @param int $draftId
     * @return array|null
     */
    public function findById(int $draftId): ?array {
        $stmt = $this->db->prepare("SELECT * FROM booking_drafts WHERE draft_id = ?");
        $stmt->execute([$draftId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Find the most recent active (non-terminal, non-expired) draft for a user.
     * Deterministically orders by updated_at DESC, draft_id DESC.
     * 
     * @param int         $userId
     * @param string|null $serviceType
     * @return array|null
     */
    public function findActiveByUser(int $userId, ?string $serviceType = null): ?array {
        $terminalPlaceholders = implode(',', array_fill(0, count(self::TERMINAL_STATUSES), '?'));
        
        $sql = "
            SELECT * FROM booking_drafts 
            WHERE user_id = ? 
              AND status NOT IN ({$terminalPlaceholders})
              AND expires_at > NOW()
        ";
        $params = array_merge([$userId], self::TERMINAL_STATUSES);

        if ($serviceType !== null && in_array($serviceType, self::ALLOWED_SERVICES, true)) {
            $sql .= " AND service_type = ?";
            $params[] = $serviceType;
        }

        $sql .= " ORDER BY updated_at DESC, draft_id DESC LIMIT 1";

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        return $row ?: null;
    }

    /**
     * Find the most recent active draft associated with an optional conversation_id.
     * @param string $conversationId
     * @return array|null
     */
    public function findByConversationId(string $conversationId): ?array {
        $stmt = $this->db->prepare("
            SELECT * FROM booking_drafts 
            WHERE conversation_id = ? 
            ORDER BY updated_at DESC, draft_id DESC 
            LIMIT 1
        ");
        $stmt->execute([$conversationId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * List all drafts for a user, newest first.
     * @param int $userId
     * @return array
     */
    public function listByUser(int $userId): array {
        $stmt = $this->db->prepare("SELECT * FROM booking_drafts WHERE user_id = ? ORDER BY updated_at DESC, draft_id DESC");
        $stmt->execute([$userId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Ownership Guard Helper.
     * Verifies that the draft belongs to the given authenticated user.
     * 
     * @param int $draftId
     * @param int $authenticatedUserId
     * @return array The draft record if authorized.
     * @throws BookingDraftException
     */
    public function requireOwnership(int $draftId, int $authenticatedUserId): array {
        $draft = $this->findById($draftId);
        if (!$draft) {
            throw new BookingDraftException("Booking draft not found.", 'DRAFT_NOT_FOUND', 404);
        }

        if ((int) $draft['user_id'] !== $authenticatedUserId) {
            throw new BookingDraftException("Unauthorized access to booking draft.", 'UNAUTHORIZED_ACCESS', 403);
        }

        return $draft;
    }

    /**
     * Mutating Guard Helper.
     * Asserts draft exists, is not in a terminal state, and has not expired.
     * Automatically transitions expired active drafts to EXPIRED status in the DB.
     * 
     * @param int $draftId
     * @return array Fresh draft row
     * @throws BookingDraftException
     */
    private function assertMutable(int $draftId): array {
        $draft = $this->findById($draftId);
        if (!$draft) {
            throw new BookingDraftException("Booking draft not found.", 'DRAFT_NOT_FOUND', 404);
        }

        if (self::isTerminalState($draft['status'])) {
            if ($draft['status'] === self::STATUS_COMMITTED) {
                throw new BookingDraftException("Draft is already committed and cannot be modified.", 'DRAFT_ALREADY_COMMITTED', 409);
            }
            throw new BookingDraftException("Cannot modify draft in terminal state '{$draft['status']}'.", 'TERMINAL_STATE_MODIFICATION', 400);
        }

        if (self::isExpired($draft)) {
            // Persist transition to EXPIRED in database
            $this->expireStaleDraft($draftId);
            throw new BookingDraftException("Booking draft has expired and can no longer be updated.", 'DRAFT_EXPIRED', 410);
        }

        return $draft;
    }

    /**
     * Non-Destructive JSON Merge for Extracted Data.
     * Merges incoming key-value pairs into existing extracted_data without wiping existing valid fields.
     * 
     * @param int   $draftId
     * @param array $newFields Key-value pairs to merge into existing extracted_data.
     * @return array The complete merged extracted_data array.
     * @throws BookingDraftException
     */
    public function updateExtractedData(int $draftId, array $newFields): array {
        $draft = $this->assertMutable($draftId);

        $existing = !empty($draft['extracted_data']) ? json_decode($draft['extracted_data'], true) : [];
        if (!is_array($existing)) {
            $existing = [];
        }

        // Non-destructive merge: incoming fields overwrite or augment, unmentioned keys are preserved
        $merged = array_merge($existing, $newFields);

        $stmt = $this->db->prepare("UPDATE booking_drafts SET extracted_data = ? WHERE draft_id = ?");
        $stmt->execute([json_encode($merged), $draftId]);

        return $merged;
    }

    /**
     * Update the missing_fields JSON array.
     * 
     * @param int   $draftId
     * @param array $missingFields List of required field names still missing.
     * @return array The saved missing fields array.
     * @throws BookingDraftException
     */
    public function updateMissingFields(int $draftId, array $missingFields): array {
        $this->assertMutable($draftId);

        // Normalize to a clean indexed array of unique strings
        $normalized = array_values(array_unique(array_map('strval', $missingFields)));

        $stmt = $this->db->prepare("UPDATE booking_drafts SET missing_fields = ? WHERE draft_id = ?");
        $stmt->execute([json_encode($normalized), $draftId]);

        return $normalized;
    }

    /**
     * Transition Draft Status.
     * Strictly enforces the server-side transition matrix.
     * Status cannot be changed arbitrarily.
     * 
     * @param int    $draftId
     * @param string $targetStatus Target status from ALL_STATUSES
     * @return bool
     * @throws BookingDraftException
     */
    public function transitionStatus(int $draftId, string $targetStatus): bool {
        if (!in_array($targetStatus, self::ALL_STATUSES, true)) {
            throw new BookingDraftException("Unknown draft status '{$targetStatus}'.", 'INVALID_STATUS', 400);
        }

        $draft = $this->findById($draftId);
        if (!$draft) {
            throw new BookingDraftException("Booking draft not found.", 'DRAFT_NOT_FOUND', 404);
        }

        $currentStatus = $draft['status'];

        // Idempotent transition to same status
        if ($currentStatus === $targetStatus) {
            return true;
        }

        // Terminal state protection
        if (self::isTerminalState($currentStatus)) {
            if ($currentStatus === self::STATUS_COMMITTED && $targetStatus === self::STATUS_COMMITTED) {
                throw new BookingDraftException("Draft is already committed.", 'DRAFT_ALREADY_COMMITTED', 409);
            }
            throw new BookingDraftException("Cannot transition draft from terminal state '{$currentStatus}' to '{$targetStatus}'.", 'TERMINAL_STATE_MODIFICATION', 400);
        }

        // Expiration check: if draft expired, only transition to EXPIRED is permitted
        if (self::isExpired($draft) && $targetStatus !== self::STATUS_EXPIRED) {
            $this->expireStaleDraft($draftId);
            throw new BookingDraftException("Booking draft has expired and cannot be transitioned to '{$targetStatus}'.", 'DRAFT_EXPIRED', 410);
        }

        // Check transition matrix
        $allowedTargets = self::ALLOWED_TRANSITIONS[$currentStatus] ?? [];
        if (!in_array($targetStatus, $allowedTargets, true)) {
            throw new BookingDraftException("Invalid state transition from '{$currentStatus}' to '{$targetStatus}'.", 'INVALID_STATE_TRANSITION', 400);
        }

        $stmt = $this->db->prepare("UPDATE booking_drafts SET status = ? WHERE draft_id = ?");
        return $stmt->execute([$targetStatus, $draftId]);
    }

    /**
     * Finalize & Commit Draft.
     * 
     * Enforces:
     * 1. Draft exists and is not in a terminal state.
     * 2. Draft is not expired.
     * 3. Current status must be strictly AWAITING_CONFIRM.
     * 4. Requires positive committed_record_id.
     * 5. Requires valid committed_record_type ('burial' | 'cremation').
     * 6. Atomic state transition to COMMITTED with optimistic concurrency check.
     * 
     * @param int    $draftId
     * @param int    $recordId   The schedule_id or cremation_id created in domain tables.
     * @param string $recordType 'burial' | 'cremation'
     * @return bool
     * @throws BookingDraftException
     */
    public function commit(int $draftId, int $recordId, string $recordType): bool {
        if ($recordId <= 0) {
            throw new BookingDraftException("Committed record ID must be a positive integer.", 'INVALID_RECORD_ID', 400);
        }

        if (!in_array($recordType, self::ALLOWED_SERVICES, true)) {
            throw new BookingDraftException("Committed record type must be 'burial' or 'cremation'.", 'INVALID_RECORD_TYPE', 400);
        }

        $draft = $this->findById($draftId);
        if (!$draft) {
            throw new BookingDraftException("Booking draft not found.", 'DRAFT_NOT_FOUND', 404);
        }

        if ($draft['status'] === self::STATUS_COMMITTED) {
            throw new BookingDraftException("Draft has already been committed.", 'DRAFT_ALREADY_COMMITTED', 409);
        }

        if (self::isTerminalState($draft['status'])) {
            throw new BookingDraftException("Cannot commit draft in terminal state '{$draft['status']}'.", 'TERMINAL_STATE_MODIFICATION', 400);
        }

        if (self::isExpired($draft)) {
            $this->expireStaleDraft($draftId);
            throw new BookingDraftException("Booking draft has expired and cannot be committed.", 'DRAFT_EXPIRED', 410);
        }

        if ($draft['status'] !== self::STATUS_AWAITING_CONFIRM) {
            throw new BookingDraftException("Cannot commit draft from status '{$draft['status']}'. Draft must be in 'AWAITING_CONFIRM'.", 'INVALID_COMMIT_ATTEMPT', 400);
        }

        // Atomic commit gated on current status = 'AWAITING_CONFIRM' to prevent concurrent double-commit
        $stmt = $this->db->prepare("
            UPDATE booking_drafts 
            SET status = ?, committed_record_id = ?, committed_record_type = ? 
            WHERE draft_id = ? AND status = ?
        ");

        $stmt->execute([
            self::STATUS_COMMITTED,
            $recordId,
            $recordType,
            $draftId,
            self::STATUS_AWAITING_CONFIRM
        ]);

        if ($stmt->rowCount() === 0) {
            throw new BookingDraftException("Failed to commit draft. State conflict occurred.", 'DRAFT_ALREADY_COMMITTED', 409);
        }

        return true;
    }

    /**
     * Cancel an active draft.
     * Rejects terminal drafts. Soft-state transition to CANCELLED.
     * 
     * @param int $draftId
     * @return bool
     * @throws BookingDraftException
     */
    public function cancel(int $draftId): bool {
        $draft = $this->findById($draftId);
        if (!$draft) {
            throw new BookingDraftException("Booking draft not found.", 'DRAFT_NOT_FOUND', 404);
        }

        if (self::isTerminalState($draft['status'])) {
            throw new BookingDraftException("Cannot cancel draft in terminal state '{$draft['status']}'.", 'TERMINAL_STATE_MODIFICATION', 400);
        }

        return $this->transitionStatus($draftId, self::STATUS_CANCELLED);
    }

    /**
     * Mark an active draft as EXPIRED.
     * Rejects drafts that are COMMITTED or CANCELLED.
     * 
     * @param int $draftId
     * @return bool
     * @throws BookingDraftException
     */
    public function expire(int $draftId): bool {
        $draft = $this->findById($draftId);
        if (!$draft) {
            throw new BookingDraftException("Booking draft not found.", 'DRAFT_NOT_FOUND', 404);
        }

        if ($draft['status'] === self::STATUS_EXPIRED) {
            return true;
        }

        if (self::isTerminalState($draft['status'])) {
            throw new BookingDraftException("Cannot expire draft in terminal state '{$draft['status']}'.", 'TERMINAL_STATE_MODIFICATION', 400);
        }

        return $this->transitionStatus($draftId, self::STATUS_EXPIRED);
    }

    /**
     * Sweep and expire all active drafts whose expires_at timestamp is in the past.
     * 
     * @return int Number of drafts transitioned to EXPIRED.
     */
    public function expireStaleActiveDrafts(): int {
        $terminalPlaceholders = implode(',', array_fill(0, count(self::TERMINAL_STATUSES), '?'));
        
        $sql = "
            UPDATE booking_drafts 
            SET status = ? 
            WHERE status NOT IN ({$terminalPlaceholders}) 
              AND expires_at <= NOW()
        ";
        $params = array_merge([self::STATUS_EXPIRED], self::TERMINAL_STATUSES);

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);

        return $stmt->rowCount();
    }

    /**
     * Internal helper to quietly record an active draft as EXPIRED when detected during read/update.
     */
    private function expireStaleDraft(int $draftId): void {
        try {
            $stmt = $this->db->prepare("
                UPDATE booking_drafts 
                SET status = ? 
                WHERE draft_id = ? AND status NOT IN (?, ?, ?)
            ");
            $stmt->execute([
                self::STATUS_EXPIRED,
                $draftId,
                self::STATUS_COMMITTED,
                self::STATUS_CANCELLED,
                self::STATUS_EXPIRED
            ]);
        } catch (Throwable $e) {
            // Best-effort background state sync; error will be thrown by caller
        }
    }
}
