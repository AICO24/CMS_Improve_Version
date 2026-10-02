<?php
/**
 * BookingConversation Domain Model
 * 
 * Manages conversational sessions and chronological message persistence for the
 * AI Booking Assistant. Provides strict ownership isolation, session resolution,
 * message appending, and synchronization with booking drafts and finalized bookings.
 */
require_once __DIR__ . '/../config/database.php';

class BookingConversationException extends RuntimeException {
    protected string $errorType;
    protected int $httpCode;

    public function __construct(string $message, string $errorType = 'CONVERSATION_ERROR', int $httpCode = 400, ?Throwable $previous = null) {
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

class BookingConversation {
    private PDO $db;

    public const STATUS_ACTIVE    = 'ACTIVE';
    public const STATUS_COMMITTED = 'COMMITTED';
    public const STATUS_ARCHIVED  = 'ARCHIVED';
    public const STATUS_ABANDONED = 'ABANDONED';

    public const ALL_STATUSES = [
        self::STATUS_ACTIVE,
        self::STATUS_COMMITTED,
        self::STATUS_ARCHIVED,
        self::STATUS_ABANDONED,
    ];

    public const SENDER_USER      = 'user';
    public const SENDER_ASSISTANT = 'assistant';
    public const SENDER_SYSTEM    = 'system';

    public const ALL_SENDERS = [
        self::SENDER_USER,
        self::SENDER_ASSISTANT,
        self::SENDER_SYSTEM,
    ];

    public function __construct(?PDO $pdo = null) {
        $this->db = $pdo ?? Database::getInstance()->getConnection();
    }

    /**
     * Create a new booking conversation session.
     * 
     * @param int         $userId
     * @param int|null    $draftId
     * @param string|null $title
     * @param string|null $sessionId
     * @return array The created conversation record.
     * @throws BookingConversationException
     */
    public function create(int $userId, ?int $draftId = null, ?string $title = null, ?string $sessionId = null): array {
        if ($userId <= 0) {
            throw new BookingConversationException("A valid positive user_id is required.", 'INVALID_USER_ID', 400);
        }

        $sessionToken = $sessionId ?: ('conv_' . bin2hex(random_bytes(16)));
        $convTitle = $title ? trim($title) : 'New Booking Arrangement';

        $stmt = $this->db->prepare("
            INSERT INTO booking_conversations (
                user_id, booking_draft_id, session_id, title, status
            ) VALUES (
                ?, ?, ?, ?, ?
            )
        ");

        $stmt->execute([
            $userId,
            $draftId,
            $sessionToken,
            $convTitle,
            self::STATUS_ACTIVE
        ]);

        $convId = (int) $this->db->lastInsertId();

        // If draftId was provided, also sync conversation_id on the draft
        if ($draftId !== null && $draftId > 0) {
            $this->syncDraftConversationId($draftId, $sessionToken);
        }

        return $this->findById($convId);
    }

    /**
     * Find a conversation by primary key.
     * 
     * @param int $id
     * @return array|null
     */
    public function findById(int $id): ?array {
        $stmt = $this->db->prepare("SELECT * FROM booking_conversations WHERE id = ?");
        $stmt->execute([$id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Find a conversation by unique session_id.
     * 
     * @param string $sessionId
     * @return array|null
     */
    public function findBySessionId(string $sessionId): ?array {
        $stmt = $this->db->prepare("SELECT * FROM booking_conversations WHERE session_id = ?");
        $stmt->execute([trim($sessionId)]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Find the most recent active conversation for a user.
     * 
     * @param int $userId
     * @return array|null
     */
    public function findActiveByUser(int $userId): ?array {
        $stmt = $this->db->prepare("
            SELECT * FROM booking_conversations 
            WHERE user_id = ? AND status = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        ");
        $stmt->execute([$userId, self::STATUS_ACTIVE]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Find the conversation associated with a specific booking draft.
     * 
     * @param int $draftId
     * @return array|null
     */
    public function findByDraftId(int $draftId): ?array {
        $stmt = $this->db->prepare("
            SELECT * FROM booking_conversations 
            WHERE booking_draft_id = ?
            ORDER BY updated_at DESC, id DESC
            LIMIT 1
        ");
        $stmt->execute([$draftId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * List conversations for an authenticated user, newest first.
     * 
     * @param int $userId
     * @param int $limit
     * @param int $offset
     * @return array
     */
    public function listByUser(int $userId, int $limit = 20, int $offset = 0): array {
        $limit = max(1, min(100, $limit));
        $offset = max(0, $offset);

        $stmt = $this->db->prepare("
            SELECT 
                c.*,
                (SELECT COUNT(*) FROM booking_messages m WHERE m.conversation_id = c.id) AS message_count,
                (SELECT m.message FROM booking_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message,
                (SELECT m.created_at FROM booking_messages m WHERE m.conversation_id = c.id ORDER BY m.id DESC LIMIT 1) AS last_message_at
            FROM booking_conversations c
            WHERE c.user_id = ?
            ORDER BY c.updated_at DESC, c.id DESC
            LIMIT ? OFFSET ?
        ");
        $stmt->bindValue(1, $userId, PDO::PARAM_INT);
        $stmt->bindValue(2, $limit, PDO::PARAM_INT);
        $stmt->bindValue(3, $offset, PDO::PARAM_INT);
        $stmt->execute();

        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Count total conversations for an authenticated user.
     * 
     * @param int $userId
     * @return int
     */
    public function countByUser(int $userId): int {
        $stmt = $this->db->prepare("SELECT COUNT(*) FROM booking_conversations WHERE user_id = ?");
        $stmt->execute([$userId]);
        return (int) $stmt->fetchColumn();
    }

    /**
     * Strict Ownership Guard Helper.
     * Ensures horizontal tenant isolation (prevents User A from viewing User B's conversation).
     * 
     * @param int $conversationId
     * @param int $authenticatedUserId
     * @return array The conversation record if authorized.
     * @throws BookingConversationException
     */
    public function requireOwnership(int $conversationId, int $authenticatedUserId): array {
        $conversation = $this->findById($conversationId);
        if (!$conversation) {
            throw new BookingConversationException("Conversation session not found.", 'CONVERSATION_NOT_FOUND', 404);
        }

        if ((int) $conversation['user_id'] !== $authenticatedUserId) {
            throw new BookingConversationException("Unauthorized access to conversation session.", 'UNAUTHORIZED_ACCESS', 403);
        }

        return $conversation;
    }

    /**
     * Append a message to an existing conversation.
     * 
     * @param int         $conversationId
     * @param string      $senderType 'user' | 'assistant' | 'system'
     * @param string      $message
     * @param string      $messageType 'text' | 'advisory' | 'action_notice'
     * @param array|null  $metadata Optional slot/intent snapshot
     * @return int The created message ID.
     * @throws BookingConversationException
     */
    public function appendMessage(
        int $conversationId,
        string $senderType,
        string $message,
        string $messageType = 'text',
        ?array $metadata = null
    ): int {
        if (!in_array($senderType, self::ALL_SENDERS, true)) {
            throw new BookingConversationException("Invalid sender type '{$senderType}'.", 'INVALID_SENDER', 400);
        }

        $trimmed = trim($message);
        if ($trimmed === '') {
            throw new BookingConversationException("Message text cannot be empty.", 'EMPTY_MESSAGE', 400);
        }

        $metaJson = ($metadata !== null) ? json_encode($metadata) : null;

        $stmt = $this->db->prepare("
            INSERT INTO booking_messages (
                conversation_id, sender_type, message, message_type, metadata
            ) VALUES (
                ?, ?, ?, ?, ?
            )
        ");

        $stmt->execute([
            $conversationId,
            $senderType,
            $trimmed,
            $messageType,
            $metaJson
        ]);

        $messageId = (int) $this->db->lastInsertId();

        // Touch conversation updated_at
        $touchStmt = $this->db->prepare("UPDATE booking_conversations SET updated_at = NOW() WHERE id = ?");
        $touchStmt->execute([$conversationId]);

        return $messageId;
    }

    /**
     * Retrieve chronological messages for a conversation.
     * 
     * @param int $conversationId
     * @param int $limit
     * @param int $offset
     * @return array
     */
    public function getMessages(int $conversationId, int $limit = 100, int $offset = 0): array {
        $limit = max(1, min(200, $limit));
        $offset = max(0, $offset);

        $stmt = $this->db->prepare("
            SELECT id, conversation_id, sender_type, message, message_type, metadata, created_at
            FROM booking_messages
            WHERE conversation_id = ?
            ORDER BY id ASC
            LIMIT ? OFFSET ?
        ");
        $stmt->bindValue(1, $conversationId, PDO::PARAM_INT);
        $stmt->bindValue(2, $limit, PDO::PARAM_INT);
        $stmt->bindValue(3, $offset, PDO::PARAM_INT);
        $stmt->execute();

        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);
        $messages = [];
        foreach ($rows as $row) {
            $messages[] = [
                'id'              => (int) $row['id'],
                'conversation_id' => (int) $row['conversation_id'],
                'sender_type'     => $row['sender_type'],
                'message'         => $row['message'],
                'message_type'    => $row['message_type'],
                'metadata'        => !empty($row['metadata']) ? json_decode($row['metadata'], true) : null,
                'created_at'      => $row['created_at'],
            ];
        }

        return $messages;
    }

    /**
     * Bind a draft ID to the conversation and cross-link session_id in booking_drafts.
     * 
     * @param int $conversationId
     * @param int $draftId
     * @return bool
     */
    public function bindDraft(int $conversationId, int $draftId): bool {
        $conv = $this->findById($conversationId);
        if (!$conv) {
            return false;
        }

        $stmt = $this->db->prepare("UPDATE booking_conversations SET booking_draft_id = ? WHERE id = ?");
        $success = $stmt->execute([$draftId, $conversationId]);

        if ($success && !empty($conv['session_id'])) {
            $this->syncDraftConversationId($draftId, $conv['session_id']);
        }

        return $success;
    }

    /**
     * Bind finalized domain booking to the conversation and transition to COMMITTED.
     * 
     * @param int    $conversationId
     * @param int    $bookingId
     * @param string $bookingType 'burial' | 'cremation'
     * @return bool
     */
    public function bindBooking(int $conversationId, int $bookingId, string $bookingType): bool {
        $stmt = $this->db->prepare("
            UPDATE booking_conversations 
            SET booking_id = ?, booking_type = ?, status = ? 
            WHERE id = ?
        ");
        return $stmt->execute([$bookingId, strtolower($bookingType), self::STATUS_COMMITTED, $conversationId]);
    }

    /**
     * Update conversation title (e.g. "Burial — Juan Santos").
     * 
     * @param int    $conversationId
     * @param string $title
     * @return bool
     */
    public function updateTitle(int $conversationId, string $title): bool {
        $stmt = $this->db->prepare("UPDATE booking_conversations SET title = ? WHERE id = ?");
        return $stmt->execute([trim($title), $conversationId]);
    }

    /**
     * Update conversation status.
     * 
     * @param int    $conversationId
     * @param string $status
     * @return bool
     */
    public function updateStatus(int $conversationId, string $status): bool {
        if (!in_array($status, self::ALL_STATUSES, true)) {
            throw new BookingConversationException("Invalid conversation status '{$status}'.", 'INVALID_STATUS', 400);
        }

        $stmt = $this->db->prepare("UPDATE booking_conversations SET status = ? WHERE id = ?");
        return $stmt->execute([$status, $conversationId]);
    }

    /**
     * Internal helper to synchronize session_id into booking_drafts.conversation_id.
     */
    private function syncDraftConversationId(int $draftId, string $sessionId): void {
        try {
            $stmt = $this->db->prepare("UPDATE booking_drafts SET conversation_id = ? WHERE draft_id = ?");
            $stmt->execute([$sessionId, $draftId]);
        } catch (Throwable $t) {
            // Non-fatal synchronization
        }
    }
}
