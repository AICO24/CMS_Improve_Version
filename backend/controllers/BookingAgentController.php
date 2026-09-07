<?php
/**
 * BookingAgentController
 * 
 * Exposes REST endpoints for the Unified AI Booking Management System (BMS-4 / BMS-5):
 * - Processing natural language chat turns with AI extraction & conversational reply
 * - Processing structured / mock AI input payloads directly
 * - Fetching active draft state & field completeness
 * - Field-level corrections
 * - Transitioning draft to AWAITING_CONFIRM (pre-confirmation)
 * - Cancelling drafts
 * - Listing user drafts
 */

require_once __DIR__ . '/../services/BookingAgentService.php';
require_once __DIR__ . '/../services/AIService.php';
require_once __DIR__ . '/../models/BookingDraft.php';
require_once __DIR__ . '/../models/UnifiedBooking.php';

class BookingAgentController {
    private BookingAgentService $agentService;
    private BookingDraft $draftModel;
    private AIService $aiService;
    private UnifiedBooking $unifiedModel;

    public function __construct(
        ?BookingAgentService $agentService = null,
        ?BookingDraft $draftModel = null,
        ?AIService $aiService = null,
        ?UnifiedBooking $unifiedModel = null
    ) {
        $this->agentService = $agentService ?? new BookingAgentService();
        $this->draftModel = $draftModel ?? new BookingDraft();
        $this->aiService = $aiService ?? new AIService();
        $this->unifiedModel = $unifiedModel ?? new UnifiedBooking();
    }

    /**
     * Helper to extract userId and username from user context.
     * 
     * @param mixed $user
     * @return array [userId, username]
     */
    private function resolveUserContext($user): array {
        if (is_array($user)) {
            $userId = (int) ($user['user_id'] ?? 0);
            $username = !empty($user['username']) ? (string) $user['username'] : null;
        } else {
            $userId = (int) $user;
            $username = null;
        }
        return [$userId, $username];
    }

    /**
     * Map BookingDraftException error types to HTTP response status codes.
     */
    private function mapExceptionToHttpCode(BookingDraftException $e): int {
        $httpCode = $e->getHttpCode();
        if ($httpCode >= 400 && $httpCode < 600) {
            return $httpCode;
        }

        switch ($e->getErrorType()) {
            case 'NOT_FOUND':
            case 'DRAFT_NOT_FOUND':
                return 404;
            case 'UNAUTHORIZED':
            case 'UNAUTHORIZED_ACCESS':
            case 'FORBIDDEN':
                return 403;
            case 'DRAFT_EXPIRED':
                return 410;
            case 'ALREADY_COMMITTED':
            case 'DRAFT_ALREADY_COMMITTED':
                return 409;
            case 'INVALID_SERVICE_TYPE':
            case 'INVALID_TRANSITION':
            case 'INVALID_STATE_TRANSITION':
            case 'INVALID_ARGUMENT':
            default:
                return 400;
        }
    }

    /**
     * POST /api/booking-agent/process
     * Process a structured input payload directly against the booking draft engine.
     * 
     * @param array $data Request body
     * @param mixed $user Authenticated user
     * @return array Response payload with HTTP code
     */
    public function process(array $data, $user): array {
        [$userId, $username] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        $draftId = !empty($data['draft_id']) ? (int) $data['draft_id'] : null;

        try {
            $result = $this->agentService->processStructuredInput($userId, $data, $draftId, $username);
            return array_merge(['code' => 200], $result);
        } catch (BookingDraftException $e) {
            return [
                'success'    => false,
                'error'      => $e->getMessage(),
                'error_type' => $e->getErrorType(),
                'code'       => $this->mapExceptionToHttpCode($e)
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'An unexpected server error occurred processing the booking request',
                'code'    => 500
            ];
        }
    }

    /**
     * POST /api/booking-agent/chat
     * Natural Language conversational turn: calls Python AI service to extract structured slots
     * and replies conversationally, while updating the authoritative draft state machine.
     * 
     * @param array $data Request body {message: string, draft_id?: int, service_type?: string, conversation_context?: array}
     * @param mixed $user Authenticated user
     * @return array
     */
    public function chat(array $data, $user): array {
        [$userId, $username] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        $message = trim((string) ($data['message'] ?? ''));
        if ($message === '') {
            return ['success' => false, 'error' => 'Message cannot be empty', 'code' => 400];
        }

        $draftId = !empty($data['draft_id']) ? (int) $data['draft_id'] : null;
        $serviceTypeInput = !empty($data['service_type']) ? (string) $data['service_type'] : null;
        $conversationContext = is_array($data['conversation_context'] ?? null) ? $data['conversation_context'] : [];

        // 1. Fetch current active draft context to provide to AI
        $currentDraft = null;
        if ($draftId !== null && $draftId > 0) {
            try {
                $currentDraft = $this->draftModel->requireOwnership($draftId, $userId);
            } catch (BookingDraftException $e) {
                return [
                    'success'    => false,
                    'error'      => $e->getMessage(),
                    'error_type' => $e->getErrorType(),
                    'code'       => $this->mapExceptionToHttpCode($e)
                ];
            }
        } else {
            $currentDraft = $this->draftModel->findActiveByUser($userId, $serviceTypeInput);
        }

        $draftContext = [];
        if ($currentDraft) {
            $draftContext = [
                'draft_id'       => (int) $currentDraft['draft_id'],
                'service_type'   => $currentDraft['service_type'],
                'status'         => $currentDraft['status'],
                'extracted_data' => !empty($currentDraft['extracted_data']) ? json_decode($currentDraft['extracted_data'], true) : [],
                'missing_fields' => !empty($currentDraft['missing_fields']) ? json_decode($currentDraft['missing_fields'], true) : [],
            ];
        }

        // 2. Query Python AI Extraction Endpoint
        $aiPayload = [
            'message'              => $message,
            'draft_context'        => $draftContext,
            'conversation_context' => $conversationContext
        ];

        $aiResponse = $this->aiService->extractBookingAgent($aiPayload);

        // Deterministic fallback if AI response is missing or errored
        $extractedResult = null;
        if (is_array($aiResponse) && !empty($aiResponse['success']) && is_array($aiResponse['result'] ?? null)) {
            $extractedResult = $aiResponse['result'];
        } else {
            // Local fallback extraction
            $extractedResult = $this->fallbackExtract($message, $draftContext);
        }

        $intent = $extractedResult['intent'] ?? BookingAgentService::INTENT_PROVIDE_INFO;
        $extractedFields = is_array($extractedResult['extracted_fields'] ?? null) ? $extractedResult['extracted_fields'] : [];
        $serviceTypeExtracted = $extractedResult['service_type'] ?? ($draftContext['service_type'] ?? $serviceTypeInput);
        $replyMessage = $extractedResult['reply'] ?? "I have updated your booking details.";

        // 3. Authoritatively Update Draft via BookingAgentService
        $processPayload = [
            'intent'           => $intent,
            'service_type'     => $serviceTypeExtracted,
            'extracted_fields' => $extractedFields
        ];

        try {
            $serviceOutcome = $this->agentService->processStructuredInput(
                $userId,
                $processPayload,
                $draftId ?: ($currentDraft['draft_id'] ?? null),
                $username
            );

            return array_merge([
                'success' => true,
                'reply'   => $replyMessage,
                'code'    => 200
            ], $serviceOutcome);
        } catch (BookingDraftException $e) {
            return [
                'success'    => false,
                'error'      => $e->getMessage(),
                'error_type' => $e->getErrorType(),
                'code'       => $this->mapExceptionToHttpCode($e)
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'An unexpected server error occurred processing the chat turn',
                'code'    => 500
            ];
        }
    }

    /**
     * Local deterministic fallback extraction if Python AI service is unavailable.
     */
    private function fallbackExtract(string $message, array $draftContext): array {
        $msgLower = strtolower(trim($message));
        $serviceType = $draftContext['service_type'] ?? 'burial';

        if (str_contains($msgLower, 'cremat') || str_contains($msgLower, 'urn') || str_contains($msgLower, 'columbarium')) {
            $serviceType = 'cremation';
        } elseif (str_contains($msgLower, 'burial') || str_contains($msgLower, 'interment') || str_contains($msgLower, 'grave')) {
            $serviceType = 'burial';
        }

        $intent = BookingAgentService::INTENT_PROVIDE_INFO;
        if (preg_match('/\b(confirm|proceed|looks good|ready to confirm|finalize|yes confirm)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CONFIRM_BOOKING;
        } elseif (preg_match('/\b(change|correct|update|instead of|actually)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_UPDATE_FIELD;
        } elseif (preg_match('/\b(recommend|suggest|which lot|help me choose)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_REQUEST_RECOMMENDATION;
        }

        $extracted = [];
        if (preg_match('/\b(20\d{2}-\d{2}-\d{2})\b/', $message, $m)) {
            if ($serviceType === 'cremation') {
                $extracted['cremation_date'] = $m[1];
            } else {
                $extracted['preferred_date'] = $m[1];
            }
        }

        if (preg_match('/\blot\s*(?:id|#|number)?\s*:?\s*(\d+)\b/i', $message, $m)) {
            $extracted['lot_id'] = (int) $m[1];
        }

        if (preg_match('/(?:decedent(?:\s+name)?|name\s+is|named|for)\s+([A-Z][a-zA-Z\.\s]{2,40})/i', $message, $m)) {
            $extracted['decedent_name'] = trim($m[1]);
        }

        return [
            'intent'           => $intent,
            'service_type'     => $serviceType,
            'extracted_fields' => $extracted,
            'reply'            => "I have noted your booking request. Let me know if you would like to make any adjustments."
        ];
    }

    /**
     * GET /api/booking-agent/active
     * Retrieve the current active draft for the user.
     * 
     * @param mixed       $user        Authenticated user
     * @param string|null $serviceType Optional service type filter
     * @return array Response payload with HTTP code
     */
    public function getActiveDraft($user, ?string $serviceType = null): array {
        [$userId] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        try {
            $summary = $this->agentService->getActiveDraftSummary($userId, $serviceType);
            return [
                'success' => true,
                'draft'   => $summary,
                'code'    => 200
            ];
        } catch (BookingDraftException $e) {
            return [
                'success'    => false,
                'error'      => $e->getMessage(),
                'error_type' => $e->getErrorType(),
                'code'       => $this->mapExceptionToHttpCode($e)
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to retrieve active draft',
                'code'    => 500
            ];
        }
    }

    /**
     * POST /api/booking-agent/drafts/{id}/update-field
     * Update or correct a specific field on the active draft.
     * 
     * @param int   $draftId
     * @param array $data
     * @param mixed $user
     * @return array
     */
    public function updateField(int $draftId, array $data, $user): array {
        [$userId, $username] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        if (!isset($data['field']) || trim((string) $data['field']) === '') {
            return [
                'success' => false,
                'error'   => "The 'field' attribute is required",
                'code'    => 400
            ];
        }

        $field = trim((string) $data['field']);
        $value = $data['value'] ?? null;

        try {
            $result = $this->agentService->updateDraftField($draftId, $field, $value, $userId, $username);
            return array_merge(['code' => 200], $result);
        } catch (BookingDraftException $e) {
            return [
                'success'    => false,
                'error'      => $e->getMessage(),
                'error_type' => $e->getErrorType(),
                'code'       => $this->mapExceptionToHttpCode($e)
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to update draft field',
                'code'    => 500
            ];
        }
    }

    /**
     * POST /api/booking-agent/drafts/{id}/confirm
     * Confirm booking draft. If draft is already AWAITING_CONFIRM or finalize is requested, commits the draft.
     * 
     * @param int   $draftId
     * @param mixed $user
     * @param array $input Optional input options
     * @return array
     */
    public function confirm(int $draftId, $user, array $input = []): array {
        [$userId, $username] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        try {
            $draft = $this->draftModel->requireOwnership($draftId, $userId);

            // If caller explicitly requested finalize or draft is already in AWAITING_CONFIRM
            if (!empty($input['finalize']) || $draft['status'] === BookingDraft::STATUS_AWAITING_CONFIRM) {
                if ($draft['service_type'] === 'burial') {
                    $result = $this->agentService->finalizeBurialDraft($draftId, $userId, $username, $user);
                    return array_merge(['code' => 200], $result);
                } elseif ($draft['service_type'] === 'cremation') {
                    $result = $this->agentService->finalizeCremationDraft($draftId, $userId, $username, $user);
                    return array_merge(['code' => 200], $result);
                }
            }

            $result = $this->agentService->confirmBookingDraft($draftId, $userId, $username);
            return array_merge(['code' => 200], $result);
        } catch (BookingDraftException $e) {
            return [
                'success'    => false,
                'error'      => $e->getMessage(),
                'error_type' => $e->getErrorType(),
                'code'       => $this->mapExceptionToHttpCode($e)
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to confirm draft',
                'code'    => 500
            ];
        }
    }

    /**
     * POST /api/booking-agent/drafts/{id}/finalize
     * Safely commit confirmed booking draft into domain tables (burial_schedules / cremation_records).
     * 
     * @param int   $draftId
     * @param mixed $user
     * @return array
     */
    public function finalize(int $draftId, $user): array {
        [$userId, $username] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        try {
            $draft = $this->draftModel->requireOwnership($draftId, $userId);

            if ($draft['service_type'] === 'burial') {
                $result = $this->agentService->finalizeBurialDraft($draftId, $userId, $username, $user);
                return array_merge(['code' => 200], $result);
            } elseif ($draft['service_type'] === 'cremation') {
                $result = $this->agentService->finalizeCremationDraft($draftId, $userId, $username, $user);
                return array_merge(['code' => 200], $result);
            }

            throw new BookingDraftException("Unknown service type '{$draft['service_type']}'.", 'UNSUPPORTED_SERVICE_TYPE', 400);
        } catch (BookingDraftException $e) {
            return [
                'success'    => false,
                'error'      => $e->getMessage(),
                'error_type' => $e->getErrorType(),
                'code'       => $this->mapExceptionToHttpCode($e)
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to finalize draft',
                'code'    => 500
            ];
        }
    }

    /**
     * POST /api/booking-agent/drafts/{id}/cancel
     * Cancel an active draft.
     * 
     * @param int   $draftId
     * @param mixed $user
     * @return array
     */
    public function cancel(int $draftId, $user): array {
        [$userId, $username] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        try {
            $this->agentService->cancelDraft($draftId, $userId, $username);
            return [
                'success' => true,
                'message' => 'Draft cancelled successfully',
                'code'    => 200
            ];
        } catch (BookingDraftException $e) {
            return [
                'success'    => false,
                'error'      => $e->getMessage(),
                'error_type' => $e->getErrorType(),
                'code'       => $this->mapExceptionToHttpCode($e)
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to cancel draft',
                'code'    => 500
            ];
        }
    }

    /**
     * GET /api/booking-agent/drafts
     * List all drafts for the authenticated user.
     * 
     * @param mixed $user
     * @return array
     */
    public function listDrafts($user): array {
        [$userId] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        try {
            $drafts = $this->draftModel->listByUser($userId);
            $result = [];
            foreach ($drafts as $d) {
                $result[] = [
                    'draft_id'              => (int) $d['draft_id'],
                    'service_type'          => $d['service_type'],
                    'status'                => $d['status'],
                    'extracted_data'        => !empty($d['extracted_data']) ? json_decode($d['extracted_data'], true) : [],
                    'missing_fields'        => !empty($d['missing_fields']) ? json_decode($d['missing_fields'], true) : [],
                    'conversation_id'       => $d['conversation_id'] ?? null,
                    'committed_record_id'   => $d['committed_record_id'] ? (int) $d['committed_record_id'] : null,
                    'committed_record_type' => $d['committed_record_type'],
                    'expires_at'            => $d['expires_at'],
                    'created_at'            => $d['created_at'],
                    'updated_at'            => $d['updated_at']
                ];
            }

            return [
                'success' => true,
                'drafts'  => $result,
                'code'    => 200
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to list drafts',
                'code'    => 500
            ];
        }
    }

    /**
     * GET /api/booking-agent/drafts/{id}
     * Retrieve authoritative state for a specific draft with ownership validation.
     * Crucial for draft resumption (?draft_id={id}).
     * 
     * @param int   $draftId
     * @param mixed $user
     * @return array
     */
    public function getDraft(int $draftId, $user): array {
        [$userId] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        try {
            $draft = $this->draftModel->requireOwnership($draftId, $userId);
            $extracted = !empty($draft['extracted_data']) ? json_decode($draft['extracted_data'], true) : [];
            $missing = !empty($draft['missing_fields']) ? json_decode($draft['missing_fields'], true) : [];

            $isExpired = BookingDraft::isExpired($draft);
            $isTerminal = BookingDraft::isTerminalState($draft['status']);

            if ($isExpired) {
                return [
                    'success'    => false,
                    'error'      => 'This booking draft has expired and cannot be resumed.',
                    'error_type' => 'DRAFT_EXPIRED',
                    'code'       => 410
                ];
            }

            return [
                'success'             => true,
                'draft'               => [
                    'draft_id'              => (int) $draft['draft_id'],
                    'service_type'          => $draft['service_type'],
                    'status'                => $draft['status'],
                    'extracted_data'        => $extracted,
                    'missing_fields'        => $missing,
                    'committed_record_id'   => $draft['committed_record_id'] ? (int) $draft['committed_record_id'] : null,
                    'committed_record_type' => $draft['committed_record_type'],
                    'expires_at'            => $draft['expires_at'],
                    'is_expired'            => $isExpired,
                    'is_terminal'           => $isTerminal,
                    'is_resumable'          => !$isTerminal && !$isExpired,
                    'created_at'            => $draft['created_at'],
                    'updated_at'            => $draft['updated_at']
                ],
                'authoritative_state' => [
                    'draft_id'                  => (int) $draft['draft_id'],
                    'service_type'              => $draft['service_type'],
                    'status'                    => $draft['status'],
                    'extracted_fields'          => $extracted,
                    'missing_fields'            => $missing,
                    'is_ready_for_confirmation' => empty($missing),
                    'is_resumable'              => !$isTerminal && !$isExpired
                ],
                'code'                => 200
            ];
        } catch (BookingDraftException $e) {
            return [
                'success'    => false,
                'error'      => $e->getMessage(),
                'error_type' => $e->getErrorType(),
                'code'       => $this->mapExceptionToHttpCode($e)
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to retrieve booking draft',
                'code'    => 500
            ];
        }
    }

    /**
     * GET /api/bookings/mine
     * Retrieve unified booking history (burials, cremations, active drafts) for authenticated citizen.
     * 
     * @param mixed $user
     * @param array $filters
     * @param array $pagination
     * @return array
     */
    public function getUnifiedBookings($user, array $filters = [], array $pagination = []): array {
        [$userId] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        try {
            $page = !empty($pagination['page']) ? max(1, (int) $pagination['page']) : 1;
            $perPage = !empty($pagination['per_page']) ? max(1, min(100, (int) $pagination['per_page'])) : 20;

            $bookings = $this->unifiedModel->findMine($userId, $filters, ['page' => $page, 'per_page' => $perPage]);
            $total = $this->unifiedModel->countMine($userId, $filters);
            $stats = $this->unifiedModel->getStats($userId);

            return [
                'success'    => true,
                'data'       => $bookings,
                'bookings'   => $bookings,
                'pagination' => [
                    'page'        => $page,
                    'per_page'    => $perPage,
                    'total'       => $total,
                    'total_pages' => (int) ceil($total / $perPage),
                ],
                'stats'      => $stats,
                'code'       => 200
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to retrieve unified bookings',
                'code'    => 500
            ];
        }
    }
}
