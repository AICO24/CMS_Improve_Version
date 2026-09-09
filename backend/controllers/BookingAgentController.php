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
require_once __DIR__ . '/../services/BookingDateResolver.php';
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

        $msgLower = strtolower($message);
        $isAffirmative = (bool) preg_match('/^(yes|proceed|confirm|opo|sure|go ahead|yes please|yes proceed|confirm change|confirm reschedule|confirm cancellation)$/i', $msgLower);
        $isNegative = (bool) preg_match('/^(no|cancel that|keep booking|huwag|stop|never mind|nevermind|keep it|don\'t proceed|do not proceed|keep my booking)$/i', $msgLower);

        if ($isAffirmative || $isNegative) {
            $pendingActionModel = new BookingPendingAction();
            $activePending = $pendingActionModel->findAllActiveByUser($userId);
            if (!empty($activePending)) {
                if ($isNegative) {
                    $actionToReject = $activePending[0];
                    $rejectRes = $this->agentService->getActionRegistry()->rejectPendingAction((int) $actionToReject['id'], $user);
                    return [
                        'success'            => true,
                        'reply'              => $rejectRes['reply'] ?? 'Action cancelled. Your booking remains unchanged.',
                        'intent'             => 'REJECT_PENDING_ACTION',
                        'intent_confidence'  => 1.0,
                        'context_resolution' => null,
                        'action'             => [
                            'requested'   => $actionToReject['action_type'],
                            'status'      => BookingActionRegistry::STATUS_REJECTED,
                            'target_type' => 'COMMITTED_BOOKING',
                            'target_id'   => $actionToReject['booking_id'],
                            'pending_id'  => $actionToReject['id']
                        ],
                        'code'               => 200
                    ];
                }

                if ($isAffirmative) {
                    $confirmRes = $this->agentService->getActionRegistry()->confirmConversationalPendingAction(
                        $userId,
                        $user,
                        $message,
                        null
                    );

                    if (!empty($confirmRes['success'])) {
                        return [
                            'success'            => true,
                            'reply'              => $confirmRes['reply'] ?? 'Action completed successfully.',
                            'intent'             => 'CONFIRM_PENDING_ACTION',
                            'intent_confidence'  => 1.0,
                            'context_resolution' => null,
                            'action'             => [
                                'status'     => BookingActionRegistry::STATUS_EXECUTED,
                                'pending_id' => $confirmRes['pending_action_id'] ?? null,
                            ],
                            'action_result'      => $confirmRes,
                            'code'               => 200
                        ];
                    } else {
                        return [
                            'success'            => false,
                            'reply'              => $confirmRes['reply'] ?? ($confirmRes['error'] ?? 'Could not confirm action.'),
                            'intent'             => 'CONFIRM_PENDING_ACTION',
                            'intent_confidence'  => 1.0,
                            'action_status'      => $confirmRes['action_status'] ?? 'FAILED',
                            'error'              => $confirmRes['error'] ?? null,
                            'code'               => $confirmRes['code'] ?? 400
                        ];
                    }
                }
            }
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

        // 2. Fetch lightweight user booking context (committed bookings)
        $userActiveBookings = [];
        try {
            $rawBookings = $this->unifiedModel->findMine($userId, ['is_draft' => 0], ['page' => 1, 'per_page' => 20]);
            foreach ($rawBookings as $b) {
                $userActiveBookings[] = [
                    'reference'     => $b['booking_reference'],
                    'booking_id'    => (int) $b['source_id'],
                    'source_kind'   => $b['source_kind'],
                    'service_type'  => $b['service_type'],
                    'decedent_name' => $b['decedent_name'],
                    'status'        => $b['status'],
                    'schedule_date' => $b['booking_date'],
                    'allocation'    => $b['allocation'],
                ];
            }
        } catch (Throwable $t) {
            $userActiveBookings = [];
        }

        // 3. Query Python AI Extraction Endpoint
        $aiPayload = [
            'message'              => $message,
            'draft_context'        => $draftContext,
            'conversation_context' => $conversationContext,
            'user_bookings'        => $userActiveBookings,
        ];

        $aiResponse = $this->aiService->extractBookingAgent($aiPayload);

        // Deterministic fallback if AI response is missing or errored
        $extractedResult = null;
        if (is_array($aiResponse) && !empty($aiResponse['success']) && is_array($aiResponse['result'] ?? null)) {
            $extractedResult = $aiResponse['result'];
        } else {
            // Local fallback extraction
            $extractedResult = $this->fallbackExtract($message, $draftContext, $userActiveBookings);
        }

        $rawIntent = $extractedResult['intent'] ?? BookingAgentService::INTENT_PROVIDE_INFO;
        // Normalize legacy aliases
        $intent = match ($rawIntent) {
            'PROVIDE_INFO' => BookingAgentService::INTENT_PROVIDE_INFORMATION,
            'UPDATE_FIELD' => BookingAgentService::INTENT_CORRECT_BOOKING_DETAILS,
            default        => $rawIntent,
        };

        // Authoritative backend intent normalization: specific destructive/operational actions take precedence
        $msgLower = strtolower($message);
        if (preg_match('/\b(ano pa kulang|ano pa kailangan|may kulang pa ba|ano pa ang kailangan|ano pa requirements|kulang pa ba|anong kulang|ano pang kailangan|what is missing|what\'s missing|what else do i need|what information is missing|what information is needed|what do i still need|what am i missing)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_EXPLAIN_MISSING_REQUIREMENTS;
        } elseif (preg_match('/\b(change lot|different lot|switch lot|move lot|transfer lot|reassign lot|change allocation)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CHANGE_ALLOCATION;
        } elseif (preg_match('/\b(cancel|withdraw|drop booking|cancel my booking|cancel reservation)\b/i', $msgLower) && !preg_match('/\b(cancel that|cancel action|no cancel)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CANCEL_BOOKING;
        } elseif (preg_match('/\b(reschedule|move the burial|move my burial|move the booking|move my booking|move the cremation|postpone|shift date|move from|change date to|reschedule to|change my booking date|change the booking date)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_RESCHEDULE_BOOKING;
        } elseif (preg_match('/\b(may available ba|available ba ang|available ba sa|may slot pa ba|may slot pa|may bakante pa ba|may bakante pa|may bakante|pwede pa ba sa|pwede pa ba)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CHECK_AVAILABILITY;
        } elseif (
            in_array($intent, [BookingAgentService::INTENT_PROVIDE_INFORMATION, BookingAgentService::INTENT_PROVIDE_INFO, BookingAgentService::INTENT_UNCLEAR], true)
            || empty($intent)
        ) {
            if (preg_match('/\b(spelled|misspelled|spelling|typo|incorrect|surname is actually|name is actually|should be|last name is|dapat|mali ang|correct my information|correct the information|it should be|the relationship should be)\b/i', $msgLower)) {
                $intent = BookingAgentService::INTENT_CORRECT_BOOKING_DETAILS;
            } elseif (preg_match('/\b(change my booking|update my booking|modify my booking|edit my booking|change the relationship|change the name|change the notes|change the contact)\b/i', $msgLower)) {
                $intent = BookingAgentService::INTENT_UPDATE_BOOKING;
            }
        }

        $confidence = (float) ($extractedResult['confidence'] ?? 0.95);
        $slots = is_array($extractedResult['slots'] ?? null) ? $extractedResult['slots'] : [];
        $extractedFields = is_array($extractedResult['extracted_fields'] ?? null) ? $extractedResult['extracted_fields'] : [];
        $extractedReference = $extractedResult['booking_reference'] ?? ($slots['booking_reference'] ?? null);
        $serviceTypeExtracted = $extractedResult['service_type'] ?? ($slots['service_type'] ?? ($draftContext['service_type'] ?? $serviceTypeInput));
        $replyMessage = $extractedResult['reply'] ?? "I have updated your booking details.";

        // 4. Deterministic Context Resolution Layer
        $contextResolution = $this->agentService->resolveBookingContext(
            $userId,
            $intent,
            $extractedReference,
            $draftContext,
            $userActiveBookings,
            $serviceTypeExtracted
        );

        // 5. Execute or Route Actions via Action Registry
        $isActionIntent = in_array($intent, [
            BookingAgentService::INTENT_CORRECT_BOOKING_DETAILS,
            BookingAgentService::INTENT_UPDATE_BOOKING,
            BookingAgentService::INTENT_UPDATE_FIELD,
            BookingAgentService::INTENT_RESCHEDULE_BOOKING,
            BookingAgentService::INTENT_CANCEL_BOOKING,
            BookingAgentService::INTENT_CHANGE_ALLOCATION,
        ], true);

        if ($isActionIntent) {
            $actionResult = $this->agentService->getActionRegistry()->dispatchAction(
                $userId,
                $username,
                $intent,
                $contextResolution,
                $slots,
                $message
            );

            // If action was executed on an active draft, synchronize draft state machine
            if (
                in_array($actionResult['action_status'], [BookingActionRegistry::STATUS_EXECUTED, BookingActionRegistry::STATUS_NO_CHANGE], true)
                && ($actionResult['action']['target_type'] ?? '') === 'DRAFT'
            ) {
                $targetDraftId = (int) ($actionResult['draft_id'] ?? ($currentDraft['draft_id'] ?? 0));
                if (!empty($actionResult['changes'])) {
                    foreach ($actionResult['changes'] as $ch) {
                        $extractedFields[$ch['field']] = $ch['new_value'];
                    }
                }
                $processPayload = [
                    'intent'           => BookingAgentService::INTENT_UPDATE_FIELD,
                    'service_type'     => $serviceTypeExtracted,
                    'extracted_fields' => $extractedFields
                ];
                try {
                    $serviceOutcome = $this->agentService->processStructuredInput(
                        $userId,
                        $processPayload,
                        $targetDraftId,
                        $username
                    );
                    return array_merge([
                        'success'              => true,
                        'reply'                => $actionResult['reply'],
                        'intent'               => $intent,
                        'intent_confidence'    => $confidence,
                        'context_resolution'   => $contextResolution,
                        'action'               => $actionResult['action'],
                        'changes'              => $actionResult['changes'] ?? [],
                        'slots'                => $slots,
                        'booking_reference'    => $extractedReference,
                        'missing_requirements' => $serviceOutcome['missing_fields'] ?? [],
                        'code'                 => 200,
                    ], $serviceOutcome);
                } catch (Throwable $t) {
                    // Fall back to direct action result
                }
            }

            $activeExtractedData = [];
            $activeMissingFields = [];
            if (!empty($currentDraft)) {
                $freshDraft = null;
                if (!empty($currentDraft['draft_id'])) {
                    $freshDraft = $this->draftModel->findById((int)$currentDraft['draft_id']);
                }
                $draftRef = $freshDraft ?: $currentDraft;
                $activeExtractedData = !empty($draftRef['extracted_data'])
                    ? (is_string($draftRef['extracted_data']) ? json_decode($draftRef['extracted_data'], true) : $draftRef['extracted_data'])
                    : [];
                $activeMissingFields = !empty($draftRef['missing_fields'])
                    ? (is_string($draftRef['missing_fields']) ? json_decode($draftRef['missing_fields'], true) : $draftRef['missing_fields'])
                    : [];
            }

            return [
                'success'              => !in_array($actionResult['action_status'], [BookingActionRegistry::STATUS_UNAUTHORIZED, BookingActionRegistry::STATUS_NOT_FOUND], true),
                'reply'                => $actionResult['reply'],
                'intent'               => $intent,
                'intent_confidence'    => $confidence,
                'context_resolution'   => $contextResolution,
                'action'               => $actionResult['action'] ?? null,
                'pending_action'       => $actionResult['pending_action'] ?? null,
                'available_lots'       => $actionResult['available_lots'] ?? [],
                'changes'              => $actionResult['changes'] ?? [],
                'deferred_intent'      => $actionResult['deferred_intent'] ?? null,
                'deferred_field'       => $actionResult['deferred_field'] ?? null,
                'slots'                => $slots,
                'booking_reference'    => $extractedReference,
                'draft_id'             => $draftId ?: ($currentDraft['draft_id'] ?? null),
                'service_type'         => $serviceTypeExtracted,
                'status'               => $currentDraft['status'] ?? 'INTAKE',
                'extracted_data'       => $activeExtractedData,
                'missing_fields'       => $activeMissingFields,
                'missing_requirements' => $activeMissingFields,
                'code'                 => 200,
            ];
        }

        // Informational intent: CHECK_BOOKING_STATUS
        if ($intent === BookingAgentService::INTENT_CHECK_BOOKING_STATUS && ($contextResolution['type'] ?? '') !== 'DRAFT') {
            if ($contextResolution['status'] === 'AMBIGUOUS') {
                $replyMessage = $contextResolution['message'];
            } elseif ($contextResolution['status'] === 'NOT_FOUND') {
                $replyMessage = $contextResolution['reason'] ?? "I could not find an active booking matching that reference on your account.";
            } elseif ($contextResolution['status'] === 'RESOLVED') {
                $ref = $contextResolution['reference'];
                $curStatus = $contextResolution['current_status'] ?? 'Active';
                $rec = $contextResolution['record'] ?? [];
                $decName = !empty($rec['decedent_name']) ? " for {$rec['decedent_name']}" : "";
                $dateStr = !empty($rec['schedule_date']) ? " scheduled on {$rec['schedule_date']}" : "";
                $replyMessage = "Your booking {$ref}{$decName} is currently {$curStatus}{$dateStr}.";
            } elseif ($contextResolution['status'] === 'NO_ACTIVE_CONTEXT') {
                $replyMessage = "You do not have any active bookings to check.";
            }

            return [
                'success'              => true,
                'reply'                => $replyMessage,
                'intent'               => $intent,
                'intent_confidence'    => $confidence,
                'context_resolution'   => $contextResolution,
                'action'               => [
                    'requested'   => $intent,
                    'status'      => 'INFORMATIONAL',
                    'target_type' => $contextResolution['type'] ?? 'COMMITTED_BOOKING',
                    'target_id'   => $contextResolution['booking_id'] ?? null,
                    'reference'   => $contextResolution['reference'] ?? null,
                ],
                'slots'                => $slots,
                'booking_reference'    => $extractedReference,
                'draft_id'             => $draftId ?: ($currentDraft['draft_id'] ?? null),
                'service_type'         => $serviceTypeExtracted,
                'status'               => $currentDraft['status'] ?? 'INTAKE',
                'missing_requirements' => [],
                'code'                 => 200,
            ];
        }

        // Purely Advisory intent: EXPLAIN_MISSING_REQUIREMENTS (Batch 4)
        if ($intent === BookingAgentService::INTENT_EXPLAIN_MISSING_REQUIREMENTS) {
            $availService = $this->agentService->getAvailabilityService();
            $explanation = $availService->explainMissingRequirements($currentDraft);

            $activeExtractedData = [];
            if (!empty($currentDraft)) {
                $activeExtractedData = !empty($currentDraft['extracted_data'])
                    ? (is_string($currentDraft['extracted_data']) ? json_decode($currentDraft['extracted_data'], true) : $currentDraft['extracted_data'])
                    : [];
            }

            return [
                'success'               => true,
                'intent'                => $intent,
                'intent_confidence'     => $confidence,
                'advisory'              => true,
                'has_active_draft'      => $explanation['has_active_draft'],
                'code'                  => $explanation['code'],
                'draft_id'              => $explanation['draft_id'] ?? null,
                'draft_status'          => $explanation['draft_status'] ?? null,
                'service_type'          => $explanation['service_type'] ?? null,
                'extracted_data'        => $activeExtractedData,
                'missing_fields'        => $explanation['missing_fields'],
                'missing_requirements'  => $explanation['missing_fields'],
                'completed_fields'      => $explanation['completed_fields'],
                'next_recommended_step' => $explanation['next_recommended_step'],
                'checklist'             => $explanation['checklist'] ?? null,
                'reply'                 => $explanation['reply'],
                'context_resolution'    => $contextResolution,
                'slots'                 => $slots,
                'booking_reference'     => $extractedReference,
            ];
        }

        // Purely Advisory intent: RESUME_BOOKING (Batch 4)
        if ($intent === BookingAgentService::INTENT_RESUME_BOOKING) {
            $availService = $this->agentService->getAvailabilityService();
            if ($currentDraft) {
                $guidance = $availService->getResumptionGuidance($currentDraft);
                $activeExtractedData = !empty($currentDraft['extracted_data'])
                    ? (is_string($currentDraft['extracted_data']) ? json_decode($currentDraft['extracted_data'], true) : $currentDraft['extracted_data'])
                    : [];
                return [
                    'success'               => true,
                    'intent'                => $intent,
                    'intent_confidence'     => $confidence,
                    'advisory'              => true,
                    'has_active_draft'      => true,
                    'code'                  => 'DRAFT_RESUMED',
                    'draft_id'              => (int) $currentDraft['draft_id'],
                    'draft_status'          => $currentDraft['status'],
                    'service_type'          => $currentDraft['service_type'],
                    'extracted_data'        => $activeExtractedData,
                    'completed_fields'      => $guidance['completed_fields'],
                    'missing_fields'        => $guidance['missing_fields'],
                    'missing_requirements'  => $guidance['missing_fields'],
                    'next_recommended_step' => $guidance['next_recommended_step'],
                    'next_action'           => $guidance['next_action'],
                    'reply'                 => $guidance['reply'],
                    'context_resolution'    => $contextResolution,
                    'slots'                 => $slots,
                    'booking_reference'     => $extractedReference,
                ];
            } else {
                return [
                    'success'               => true,
                    'intent'                => $intent,
                    'intent_confidence'     => $confidence,
                    'advisory'              => true,
                    'has_active_draft'      => false,
                    'code'                  => BookingAvailabilityService::CODE_NO_ACTIVE_DRAFT,
                    'missing_fields'        => [],
                    'missing_requirements'  => [],
                    'completed_fields'      => [],
                    'next_recommended_step' => 'CREATE_BOOKING',
                    'reply'                 => "Wala kayong aktibong booking draft sa ngayon. Maaari tayong magsimula ng bagong booking.",
                    'context_resolution'    => $contextResolution,
                    'slots'                 => $slots,
                    'booking_reference'     => $extractedReference,
                ];
            }
        }

        // Purely Advisory intent: CHECK_AVAILABILITY (Batch 4)
        if ($intent === BookingAgentService::INTENT_CHECK_AVAILABILITY) {
            $availService = $this->agentService->getAvailabilityService();
            $targetService = $serviceTypeExtracted ?: ($currentDraft['service_type'] ?? 'burial');

            // 1. Resolve date
            $targetDate = $slots['preferred_date'] ?? ($slots['cremation_date'] ?? ($slots['target_date'] ?? null));
            if (!$targetDate && preg_match('/\b(20\d{2}-\d{2}-\d{2})\b/', $message, $dm)) {
                $targetDate = $dm[1];
            }

            // 2. Resolve lot identifier
            $lotIdent = $slots['lot_identifier'] ?? ($slots['lot_id'] ?? null);
            if (!$lotIdent && preg_match('/\blot\s*(?:id|#|number)?\s*:?\s*([A-Za-z0-9\-_]+)\b/i', $message, $lm)) {
                $lotIdent = trim($lm[1]);
            }
            $sectionHint = $slots['section'] ?? null;

            // 3. Columbarium niche inquiry
            if ($targetService === 'cremation' && (str_contains($msgLower, 'niche') || str_contains($msgLower, 'columbarium') || !empty($slots['preferred_columbarium']))) {
                $nicheRes = $availService->getCremationNicheGuidance($slots['preferred_columbarium'] ?? null);
                return [
                    'success'            => true,
                    'intent'             => $intent,
                    'intent_confidence'  => $confidence,
                    'advisory'           => true,
                    'code'               => $nicheRes['code'],
                    'availability'       => $nicheRes,
                    'alternative_dates'  => [],
                    'alternatives'       => [],
                    'alternative_lots'   => [],
                    'reply'              => $nicheRes['message'],
                    'context_resolution' => $contextResolution,
                    'slots'              => $slots,
                    'booking_reference'  => $extractedReference,
                ];
            }

            // 4. Specific Lot Query
            if (!empty($lotIdent)) {
                $lotRes = $availService->resolveLotIdentifier((string) $lotIdent, $sectionHint);

                if ($lotRes['status'] === BookingAvailabilityService::CODE_CLARIFICATION_REQUIRED) {
                    return [
                        'success'            => true,
                        'intent'             => $intent,
                        'intent_confidence'  => $confidence,
                        'advisory'           => true,
                        'code'               => BookingAvailabilityService::CODE_CLARIFICATION_REQUIRED,
                        'availability'       => [
                            'available'   => false,
                            'code'        => BookingAvailabilityService::CODE_CLARIFICATION_REQUIRED,
                            'reason_code' => BookingAvailabilityService::CODE_CLARIFICATION_REQUIRED,
                            'message'     => $lotRes['message']
                        ],
                        'alternative_dates'  => [],
                        'alternatives'       => [],
                        'alternative_lots'   => [],
                        'reply'              => $lotRes['message'],
                        'context_resolution' => $contextResolution,
                        'slots'              => $slots,
                        'booking_reference'  => $extractedReference,
                    ];
                }

                if ($lotRes['status'] === 'NOT_FOUND') {
                    $notFoundMsg = "Hindi mahanap ang lot '{$lotIdent}' sa talaan ng sementeryo.";
                    return [
                        'success'            => true,
                        'intent'             => $intent,
                        'intent_confidence'  => $confidence,
                        'advisory'           => true,
                        'code'               => BookingAvailabilityService::CODE_LOT_NOT_FOUND,
                        'availability'       => [
                            'available'   => false,
                            'code'        => BookingAvailabilityService::CODE_LOT_NOT_FOUND,
                            'reason_code' => BookingAvailabilityService::CODE_LOT_NOT_FOUND,
                            'message'     => $notFoundMsg
                        ],
                        'alternative_dates'  => [],
                        'alternatives'       => [],
                        'alternative_lots'   => $availService->findAlternativeLots(null, $sectionHint),
                        'reply'              => $notFoundMsg,
                        'context_resolution' => $contextResolution,
                        'slots'              => $slots,
                        'booking_reference'  => $extractedReference,
                    ];
                }

                $resolvedLot = $lotRes['lot'];
                $checkDate = $targetDate ?: date('Y-m-d', strtotime('+1 day'));
                $slotRes = $availService->checkSlotAvailability(
                    (int) $resolvedLot['lot_id'],
                    $checkDate,
                    $slots['schedule_time'] ?? null,
                    $targetService
                );

                $altDates = [];
                $altLots = [];
                if (!$slotRes['available']) {
                    $altDates = $availService->findAlternativeDates($targetService, $checkDate, (int) $resolvedLot['lot_id']);
                    $altLots = $availService->findAlternativeLots((int) $resolvedLot['lot_id'], $resolvedLot['section_name']);
                }

                return [
                    'success'            => true,
                    'intent'             => $intent,
                    'intent_confidence'  => $confidence,
                    'advisory'           => true,
                    'code'               => $slotRes['code'],
                    'availability'       => $slotRes,
                    'alternative_dates'  => $altDates,
                    'alternatives'       => $altDates,
                    'alternative_lots'   => $altLots,
                    'reply'              => $slotRes['message'],
                    'context_resolution' => $contextResolution,
                    'slots'              => $slots,
                    'booking_reference'  => $extractedReference,
                ];
            }

            // 5. General Date Query (no specific lot provided)
            $checkDate = $targetDate ?: date('Y-m-d', strtotime('+1 day'));
            $genRes = $availService->checkGeneralDateAvailability($checkDate, $targetService);

            $altDates = [];
            if (!$genRes['available']) {
                $altDates = $availService->findAlternativeDates($targetService, $checkDate);
            }
            $altLots = !empty($genRes['sample_lots']) ? $genRes['sample_lots'] : [];

            return [
                'success'            => true,
                'intent'             => $intent,
                'intent_confidence'  => $confidence,
                'advisory'           => true,
                'code'               => $genRes['code'],
                'availability'       => $genRes,
                'alternative_dates'  => $altDates,
                'alternatives'       => $altDates,
                'alternative_lots'   => $altLots,
                'reply'              => $genRes['message'],
                'context_resolution' => $contextResolution,
                'slots'              => $slots,
                'booking_reference'  => $extractedReference,
            ];
        }

        // 6. Authoritatively Update Draft via BookingAgentService for intake/draft interactions
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

            // Dynamically enrich turn reply based on authoritative draft state
            $replyMessage = $this->enrichTurnReply(
                $replyMessage,
                $serviceOutcome,
                $message,
                $slots,
                $serviceTypeExtracted
            );

            return array_merge([
                'success'              => true,
                'reply'                => $replyMessage,
                'intent'               => $intent,
                'intent_confidence'    => $confidence,
                'context_resolution'   => $contextResolution,
                'slots'                => $slots,
                'booking_reference'    => $extractedReference,
                'missing_requirements' => $serviceOutcome['missing_fields'] ?? [],
                'code'                 => 200
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
    private function fallbackExtract(string $message, array $draftContext, array $userBookings = []): array {
        $msgLower = strtolower(trim($message));
        $serviceType = $draftContext['service_type'] ?? null;

        // Extract Booking Reference
        $bookingReference = null;
        if (preg_match('/\b(BUR-\d+|CREM-\d+|DFT-\d+|Draft\s*#?\s*(\d+)|Booking\s*#?\s*(\d+)|Schedule\s*#?\s*(\d+)|Reservation\s*#?\s*(\d+))\b/i', $message, $m)) {
            $matched = trim($m[1]);
            $upper = strtoupper($matched);
            if (str_starts_with($upper, 'BUR-') || str_starts_with($upper, 'CREM-') || str_starts_with($upper, 'DFT-')) {
                $bookingReference = $upper;
            } elseif (preg_match('/^draft\s*#?\s*(\d+)$/i', $matched, $dm)) {
                $bookingReference = 'DFT-' . $dm[1];
            } elseif (preg_match('/^schedule\s*#?\s*(\d+)$/i', $matched, $sm)) {
                $bookingReference = 'BUR-' . $sm[1];
            } elseif (preg_match('/^(?:booking|reservation)\s*#?\s*(\d+)$/i', $matched, $bm)) {
                $num = $bm[1];
                $matchedRef = null;
                foreach ($userBookings as $b) {
                    $bRef = strtoupper(trim((string) ($b['reference'] ?? '')));
                    if ($bRef === "BUR-{$num}" || $bRef === "CREM-{$num}" || (int) ($b['booking_id'] ?? 0) === (int) $num) {
                        $matchedRef = $bRef;
                        break;
                    }
                }
                $bookingReference = $matchedRef ?: "BUR-{$num}";
            }
        }

        if (str_contains($msgLower, 'cremat') || str_contains($msgLower, 'urn') || str_contains($msgLower, 'columbarium')) {
            $serviceType = 'cremation';
        } elseif (str_contains($msgLower, 'burial') || str_contains($msgLower, 'interment') || str_contains($msgLower, 'grave')) {
            $serviceType = 'burial';
        } elseif (!$serviceType) {
            if ($bookingReference && str_starts_with($bookingReference, 'CREM-')) {
                $serviceType = 'cremation';
            } else {
                $serviceType = 'burial';
            }
        }

        // Intent Classification
        $intent = BookingAgentService::INTENT_PROVIDE_INFORMATION;
        $confidence = 0.95;

        if (preg_match('/\b(ano\s+pa\s*(?:po\s*)?(?:ang\s*)?kulang|ano\s+pa\s*(?:po\s*)?kailangan|may\s+kulang\s+pa\s*(?:po\s*)?ba|ano\s+pa\s*(?:po\s*)?requirements|anong\s+kulang|ano\s+pang\s+kailangan|what\s+is\s+missing|what\'s\s+missing|what\s+else\s+do\s+i\s+need|what\s+information\s+is\s+missing|what\s+information\s+is\s+needed|what\s+do\s+i\s+still\s+need|what\s+am\s+i\s+missing)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_EXPLAIN_MISSING_REQUIREMENTS;
        } elseif (preg_match('/\b(cancel|withdraw|drop booking|cancel my booking|cancel reservation)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CANCEL_BOOKING;
        } elseif (preg_match('/\b(reschedule|move the burial|move my burial|move the booking|move my booking|move the cremation|postpone|shift date|move from|change date to|reschedule to|change my booking date|change the booking date)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_RESCHEDULE_BOOKING;
        } elseif (preg_match('/\b(spelled|misspelled|spelling|typo|incorrect|surname is actually|name is actually|should be|last name is|dapat|mali ang|correct my information|correct the information|it should be|the relationship should be)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CORRECT_BOOKING_DETAILS;
        } elseif (preg_match('/\b(change my booking|update my booking|modify my booking|edit my booking|change the relationship|change the name|change the notes|change the contact)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_UPDATE_BOOKING;
        } elseif (preg_match('/\b(may available ba|available ba ang|available ba sa|available ba|may slot pa ba|may slot pa|may bakante pa ba|may bakante pa|may bakante|pwede pa ba sa|pwede pa ba|is available|do you have available|check availability|availability|available|is it free|is there space|open slots|any available)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CHECK_AVAILABILITY;
        } elseif (preg_match('/\b(status|check status|what is the status|is my booking confirmed|has it been approved)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CHECK_BOOKING_STATUS;
        } elseif (preg_match('/\b(switch lot|different lot|change lot|change columbarium)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CHANGE_ALLOCATION;
        } elseif (preg_match('/\b(select lot|choose lot|assign lot|pick lot|take lot|i want lot)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_SELECT_ALLOCATION;
        } elseif (preg_match('/\b(resume|continue my|pick up where|saan na ako|ano na status ng draft|status ng booking ko|anong susunod)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_RESUME_BOOKING;
        } elseif (preg_match('/\b(confirm|proceed|looks good|ready to confirm|finalize|yes confirm)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CONFIRM_BOOKING;
        } elseif (preg_match('/\b(recommend|suggest|which lot|help me choose)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_REQUEST_RECOMMENDATION;
        } elseif (preg_match('/\b(book|schedule|reserve|i want to book|arrange a burial|arrange a cremation|start booking)\b/i', $msgLower) && empty($draftContext['draft_id'])) {
            $intent = BookingAgentService::INTENT_CREATE_BOOKING;
        }

        $slots = [
            'service_type'          => $serviceType,
            'decedent_name'         => null,
            'relationship'          => null,
            'preferred_date'        => null,
            'cremation_date'        => null,
            'target_date'           => null,
            'booking_reference'     => $bookingReference,
            'lot_identifier'        => null,
            'lot_id'                => null,
            'section'               => null,
            'block'                 => null,
            'preferred_columbarium' => null,
            'correction_field'      => null,
            'corrected_value'       => null,
            'notes'                 => null,
            'preferred_time'        => null,
        ];

        // Date & Time extraction via BookingDateResolver
        $extractedDateTime = BookingDateResolver::extract($message);
        $dateVal = $extractedDateTime['date'];
        $timeVal = $extractedDateTime['time'];

        if ($dateVal) {
            $valRes = BookingDateResolver::validate($dateVal, $serviceType === 'burial');
            if ($valRes['valid']) {
                if ($serviceType === 'cremation') {
                    $slots['cremation_date'] = $dateVal;
                } else {
                    $slots['preferred_date'] = $dateVal;
                }
                if ($intent === BookingAgentService::INTENT_RESCHEDULE_BOOKING || $intent === BookingAgentService::INTENT_UPDATE_BOOKING) {
                    $slots['target_date'] = $dateVal;
                }
            }
        }
        if ($timeVal) {
            $slots['preferred_time'] = $timeVal;
        }

        // Lot extraction (numeric ID or alphanumeric like A-14, A2-03)
        if (preg_match('/\blot\s*(?:id|#|number)?\s*:?\s*([A-Za-z0-9\-_]+)\b/i', $message, $m)) {
            $slots['lot_identifier'] = trim($m[1]);
            if (is_numeric($slots['lot_identifier'])) {
                $slots['lot_id'] = (int) $slots['lot_identifier'];
            }
        } elseif (preg_match('/\b([A-Z]\d?[-_]\d+)\b/i', $message, $m)) {
            $slots['lot_identifier'] = trim($m[1]);
        }

        if (preg_match('/\bsection\s+([A-Za-z0-9]+)\b/i', $message, $m)) {
            $slots['section'] = strtoupper($m[1]);
        } elseif (preg_match('/^([A-Za-z])[-_]/', (string) ($slots['lot_identifier'] ?? ''), $sm)) {
            $slots['section'] = strtoupper($sm[1]);
        }

        if (preg_match('/\bmy\s+(father|mother|brother|sister|son|daughter|husband|wife|friend|relative|grandfather|grandmother|parent|spouse)\b/i', $message, $m)) {
            $slots['relationship'] = ucfirst(strtolower($m[1]));
        } elseif (preg_match('/\b(tatay|nanay|ina|ama|kapatid|asawa|lolo|lola|anak)\b/i', $message, $m)) {
            $tagRelMap = [
                'tatay' => 'Father', 'ama' => 'Father',
                'nanay' => 'Mother', 'ina' => 'Mother',
                'kapatid' => 'Sibling',
                'asawa' => 'Spouse',
                'lolo' => 'Grandfather',
                'lola' => 'Grandmother',
                'anak' => 'Child'
            ];
            $slots['relationship'] = $tagRelMap[strtolower($m[1])] ?? 'Relative';
        }

        if ($intent === BookingAgentService::INTENT_CORRECT_BOOKING_DETAILS || $intent === BookingAgentService::INTENT_UPDATE_BOOKING) {
            // A. Relationship
            if (
                preg_match('/\b(?:relationship|relasyon)\s*(?:should be|is|to|:)?\s*(daughter|son|father|mother|brother|sister|spouse|wife|husband|relative|friend|tatay|nanay|ina|ama|kapatid|asawa)\b/i', $message, $rm)
                || preg_match('/\b(?:should be|it is|to)\s+(daughter|son|father|mother|brother|sister|spouse|wife|husband)\b/i', $message, $rm)
                || (preg_match('/\b(daughter|son|father|mother|brother|sister)\b/i', $message, $rm) && preg_match('/\b(relationship|relasyon|instead|not)\b/i', $message))
            ) {
                $slots['correction_field'] = 'relationship';
                $slots['corrected_value'] = ucfirst(strtolower($rm[1]));
                $slots['relationship'] = $slots['corrected_value'];
            }
            // B. Decedent Name (Tagalog: "Kevin Mando dapat")
            elseif (preg_match('/([A-Z][a-zA-Z\.\s]{1,35})\s+dapat\b/i', $message, $dm)) {
                $slots['correction_field'] = 'decedent_name';
                $slots['corrected_value'] = trim($dm[1]);
                $slots['decedent_name'] = $slots['corrected_value'];
            }
            // C. English name corrections
            elseif (preg_match('/(?:should be|it is|actually|surname is|name is)\s+([A-Z][a-zA-Z\.\s]{1,30})/i', $message, $nm) && !preg_match('/\b(daughter|son|father|mother|brother|sister)\b/i', $nm[1])) {
                $slots['correction_field'] = 'decedent_name';
                $slots['corrected_value'] = rtrim(trim($nm[1]), '.');
                $slots['decedent_name'] = $slots['corrected_value'];
            }
            // D. Notes
            elseif (preg_match('/(?:notes|remarks)\s*(?:should be|is|to|:)?\s*(.+)$/i', $message, $ntm)) {
                $slots['correction_field'] = 'notes';
                $slots['corrected_value'] = trim($ntm[1]);
                $slots['notes'] = $slots['corrected_value'];
            }
            // E. Contact number
            elseif (preg_match('/\b(?:contact|phone|mobile)\s*(?:number)?\s*(?:should be|is|to|:)?\s*(\+?[0-9\s\-]{7,15})/i', $message, $cm)) {
                $slots['correction_field'] = 'contact_number';
                $slots['corrected_value'] = trim($cm[1]);
            }
        } else {
            // Guard: Do not re-extract decedent name if draft already has a valid decedent name,
            // or if the message is clearly providing date, time, or lot information.
            $existingName = $draftContext['extracted_data']['decedent_name'] ?? null;
            $isSupplyingDateOrLot = (bool) preg_match('/\b(date|schedule|time|lot|section|columbarium|niche|sunday|monday|tuesday|wednesday|thursday|friday|saturday|tomorrow|week|month)\b/i', $message);

            if (!$existingName || !$isSupplyingDateOrLot) {
                if (preg_match('/(?:para\s+(?:po\s+)?kay|kay|si|pangalan\s+(?:po\s+)?(?:ay|ni)?|decedent(?:\s+name)?|name\s+is|named|for(?:\s+my\s+\w+)?)\s+([A-Z][a-zA-Z\.\s]{2,40})/i', $message, $m)) {
                    $cand = trim($m[1]);
                    $cand = preg_replace('/\s+(?:nanay|tatay|ina|ama|kapatid|asawa|lolo|lola|po|siya|ko|my\s+)?(?:father|mother|brother|sister|son|daughter|husband|wife).*$/i', '', $cand);
                    $cand = preg_replace('/\s+(?:on|at|in|prefer|preferably|date|burial|cremation|schedule|service).*$/i', '', $cand);
                    $cand = trim($cand, " \t\n\r\0\x0B:.,");

                    // Stop words check: candidate name cannot be a cemetery domain keyword
                    $domainKeywords = ['burial', 'cremation', 'service', 'schedule', 'date', 'reservation', 'lot', 'plot', 'grave', 'columbarium', 'niche'];
                    if (strlen($cand) >= 2 && !in_array(strtolower($cand), $domainKeywords, true)) {
                        $slots['decedent_name'] = $cand;
                    }
                } elseif (empty($existingName) && preg_match('/\b([A-Z][a-z]{1,20}(?:\s+[A-Z][a-z]{1,20}){1,3})\b/', $message, $dm)) {
                    $cand = trim($dm[1]);
                    $domainKeywords = ['burial', 'cremation', 'service', 'schedule', 'date', 'reservation', 'lot', 'plot', 'grave', 'columbarium', 'niche'];
                    if (!in_array(strtolower($cand), $domainKeywords, true) && !preg_match('/\b(monday|tuesday|wednesday|thursday|friday|saturday|sunday|january|february|march|april|may|june|july|august|september|october|november|december)\b/i', $cand)) {
                        $slots['decedent_name'] = $cand;
                    }
                }
            }
        }

        $extractedFields = [
            'service_type'          => $slots['service_type'],
            'decedent_name'         => $slots['decedent_name'],
            'relationship'          => $slots['relationship'],
            'preferred_date'        => $slots['preferred_date'],
            'cremation_date'        => $slots['cremation_date'],
            'preferred_time'        => $slots['preferred_time'] ?? null,
            'lot_id'                => $slots['lot_id'],
            'preferred_columbarium' => $slots['preferred_columbarium'],
            'notes'                 => $slots['notes']
        ];
        $extractedFields = array_filter($extractedFields, fn($v) => $v !== null && $v !== '');

        // Dynamic context-aware conversational reply
        $existingData = $draftContext['extracted_data'] ?? [];
        $activeDecName = $slots['decedent_name'] ?? ($existingData['decedent_name'] ?? null);
        $activeDate = $slots['preferred_date'] ?? ($slots['cremation_date'] ?? ($existingData['preferred_date'] ?? ($existingData['cremation_date'] ?? null)));
        $activeLot = $slots['lot_id'] ?? ($existingData['lot_id'] ?? null);
        $isTag = $this->isTagalog($message);

        if ($dateVal) {
            $valRes = BookingDateResolver::validate($dateVal, $serviceType === 'burial');
            if (!$valRes['valid']) {
                $reply = "⚠️ " . $valRes['error'];
            } else {
                $dateFormatted = date('l, F j, Y', strtotime($dateVal));
                $timeFormatted = $timeVal ? " at " . date('g:i A', strtotime($timeVal)) : "";
                if ($isTag) {
                    $reply = "Naitakda ko na po ang petsa ng " . ($serviceType === 'cremation' ? "cremation" : "libing") . " sa **{$dateFormatted}**{$timeFormatted}.";
                    if (empty($activeDecName)) {
                        $reply .= " Sino po ang buong pangalan ng yumao (decedent)?";
                    } elseif ($serviceType === 'burial' && empty($activeLot)) {
                        $reply .= " Maaari na po tayong pumili ng available burial lot para makumpleto ang booking.";
                    } else {
                        $reply .= " Kumpleto na po ang mga detalye sa inyong Live Blueprint! Pakisuri po at sabihin ang **'Confirm'** kung handa na.";
                    }
                } else {
                    $reply = "Understood. I have set your preferred " . ($serviceType === 'cremation' ? "cremation" : "burial") . " date to **{$dateFormatted}**{$timeFormatted}.";
                    if (empty($activeDecName)) {
                        $reply .= " Who is this arrangement for (the decedent's full name)?";
                    } elseif ($serviceType === 'burial' && empty($activeLot)) {
                        $reply .= " Please select an available burial lot next.";
                    } else {
                        $reply .= " All details are complete in your Live Blueprint! Say **'Confirm'** when you are ready to finalize.";
                    }
                }
            }
        } elseif ($timeVal && !$dateVal) {
            $timeFormatted = date('g:i A', strtotime($timeVal));
            if ($isTag) {
                $reply = "Naitala ko na po ang oras bilang **{$timeFormatted}**.";
                if (empty($activeDate)) {
                    $reply .= " Kailan po ang nais ninyong petsa ng serbisyo?";
                }
            } else {
                $reply = "Got it. I have noted your preferred time as **{$timeFormatted}**.";
                if (empty($activeDate)) {
                    $reply .= " What date would you prefer for the service?";
                }
            }
        } elseif (!empty($slots['decedent_name'])) {
            if ($isTag) {
                $reply = "Salamat po. Naitala ko na ang pangalan ng yumao bilang **{$slots['decedent_name']}**.";
                if (empty($activeDate)) {
                    $reply .= " Kailan po ninyo nais isagawa ang " . ($serviceType === 'cremation' ? "cremation" : "libing") . "? (Martes hanggang Linggo po ang available schedules, sarado tuwing Lunes para sa maintenance).";
                } elseif ($serviceType === 'burial' && empty($activeLot)) {
                    $reply .= " Maaari na po tayong pumili ng available burial lot.";
                } else {
                    $reply .= " Kumpleto na po ang mga detalye sa inyong Live Blueprint sa kanan! Sabihin lamang ang **'Confirm'** upang maipasa.";
                }
            } else {
                $reply = "Thank you. I have recorded the decedent's name as **{$slots['decedent_name']}**.";
                if (empty($activeDate)) {
                    $reply .= " What date would you prefer for the " . ($serviceType === 'cremation' ? "cremation" : "burial") . " service? (Services run Tuesday to Sunday; closed Mondays for maintenance).";
                } elseif ($serviceType === 'burial' && empty($activeLot)) {
                    $reply .= " Please select an available burial lot next.";
                } else {
                    $reply .= " All details are complete in your Live Blueprint! Type **'Confirm'** to finalize.";
                }
            }
        } elseif (!empty($slots['relationship'])) {
            $reply = $isTag
                ? "Na-update ko na po ang relasyon sa yumao bilang **{$slots['relationship']}**."
                : "I have updated the relationship to **{$slots['relationship']}**.";
        } elseif (!empty($slots['lot_id']) || !empty($slots['lot_identifier'])) {
            $lotDesc = $slots['lot_id'] ? "Lot #{$slots['lot_id']}" : "Lot {$slots['lot_identifier']}";
            if ($isTag) {
                $reply = "Napili na po ang **{$lotDesc}** para sa inyong reservation.";
                if (empty($activeDecName)) {
                    $reply .= " Sino po ang buong pangalan ng yumao?";
                } elseif (empty($activeDate)) {
                    $reply .= " Kailan po ang nais ninyong petsa ng serbisyo?";
                } else {
                    $reply .= " Kumpleto na po ang lahat ng kailangan sa inyong Live Blueprint sa kanan! Pakisuri po at sabihin lamang ang **'Confirm'** upang maipasa.";
                }
            } else {
                $reply = "I have selected **{$lotDesc}** for your reservation.";
                if (empty($activeDecName)) {
                    $reply .= " Who is this arrangement for (the decedent's full name)?";
                } elseif (empty($activeDate)) {
                    $reply .= " What date would you prefer for the service?";
                } else {
                    $reply .= " All required details are now complete in your Live Blueprint on the right! Please review and type **'Confirm'** to finalize.";
                }
            }
        } else {
            // General booking initiation or inquiry turn without specific slots
            if (empty($activeDecName)) {
                $reply = $isTag
                    ? "Nakikiramay po kami sa inyong pamilya. Ako po ang tutulong sa inyo sa pag-aayos ng booking. Maaari po bang malaman ang buong pangalan ng yumao (decedent)?"
                    : "We extend our deepest condolences. I am here to assist you with your booking. Could you please provide the full name of the deceased (decedent)?";
            } elseif (empty($activeDate)) {
                $reply = $isTag
                    ? "Naitala na po si **{$activeDecName}**. Kailan po ninyo nais isagawa ang serbisyo? (Martes hanggang Linggo po ang schedule, sarado tuwing Lunes para sa maintenance)."
                    : "I have noted **{$activeDecName}**. What date would you prefer for the service? (Services are available Tuesday through Sunday).";
            } elseif ($serviceType === 'burial' && empty($activeLot)) {
                $reply = $isTag
                    ? "Naitakda na po ang petsa. Ang susunod po nating hakbang ay ang pagpili ng available burial lot. May napili na po ba kayong lot number?"
                    : "Your schedule is noted. Next, please select an available burial lot to complete your booking.";
            } else {
                $reply = $isTag
                    ? "Kumpleto na po ang mga detalye sa inyong Live Blueprint sa kanan! Sabihin lamang ang **'Confirm'** upang maipasa ang inyong reservation."
                    : "All details are complete in your Live Blueprint on the right! Please review and type **'Confirm'** to finalize your reservation.";
            }
        }

        return [
            'intent'            => $intent,
            'confidence'        => $confidence,
            'service_type'      => $serviceType,
            'booking_reference' => $bookingReference,
            'slots'             => $slots,
            'extracted_fields'  => $extractedFields,
            'reply'             => $reply
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

    /**
     * POST /api/booking-agent/pending-actions/{id}/confirm
     * Action-bound confirmation endpoint with execution-time revalidation.
     */
    public function confirmPendingAction(int $actionId, array $input, $user): array {
        $token = (string) ($input['token'] ?? $input['confirmation_token'] ?? '');
        if ($token === '') {
            return ['success' => false, 'error' => 'Confirmation token is required.', 'code' => 400];
        }

        $expectedBookingId = isset($input['booking_id']) ? (int) $input['booking_id'] : (isset($input['expected_booking_id']) ? (int) $input['expected_booking_id'] : null);
        $expectedActionType = isset($input['action_type']) ? (string) $input['action_type'] : (isset($input['expected_action_type']) ? (string) $input['expected_action_type'] : null);

        $result = $this->agentService->getActionRegistry()->confirmPendingAction(
            $actionId,
            $token,
            $user,
            $expectedBookingId,
            $expectedActionType
        );
        return array_merge(['code' => $result['code'] ?? 200], $result);
    }

    /**
     * POST /api/booking-agent/pending-actions/{id}/reject
     * Explicitly reject a pending action.
     */
    public function rejectPendingAction(int $actionId, $user): array {
        $result = $this->agentService->getActionRegistry()->rejectPendingAction($actionId, $user);
        return array_merge(['code' => $result['code'] ?? 200], $result);
    }

    /**
     * GET /api/booking-agent/pending-actions/active
     * List active pending actions for the authenticated user.
     */
    public function getActivePendingAction($user): array {
        [$userId] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        $model = new BookingPendingAction();
        $actions = $model->findAllActiveByUser($userId);
        return [
            'success'         => true,
            'pending_actions' => $actions,
            'code'            => 200
        ];
    }

    /**
     * GET /api/booking-agent/allocations/available
     * Query available lots for allocation swap.
     */
    public function getAvailableAllocations(array $query, $user): array {
        [$userId] = $this->resolveUserContext($user);
        if ($userId <= 0) {
            return ['success' => false, 'error' => 'Authentication required', 'code' => 401];
        }

        $sectionId = !empty($query['section_id']) ? (int) $query['section_id'] : null;
        $limit = !empty($query['limit']) ? (int) $query['limit'] : 10;

        $allocationService = new BookingAllocationService();
        $lots = $allocationService->getEligibleAvailableLots($sectionId, $limit);

        return [
            'success' => true,
            'lots'    => $lots,
            'code'    => 200
        ];
    }

    /**
     * Detect if user text is in Filipino / Tagalog / Taglish.
     */
    private function isTagalog(string $text): bool {
        return (bool) preg_match('/\b(po|opo|para|kay|sa|gusto|libing|ano|kailan|tatay|nanay|kapatid|asawa|lolo|lola|sino|paano|salamat|mali|dapat|namin|natin|ako|ko|mo|siya|bawal|paki|pili|anong|araw|oras)\b/i', $text);
    }

    /**
     * Enrich turn replies with dynamic next-step conversational guidance.
     */
    private function enrichTurnReply(string $reply, array $serviceOutcome, string $userMessage, array $slots, ?string $serviceType): string {
        $isTag = $this->isTagalog($userMessage);
        $isReady = !empty($serviceOutcome['is_ready_for_review']);
        $missingFields = $serviceOutcome['missing_fields'] ?? [];

        if ($isReady) {
            if (stripos($reply, 'confirm') === false && stripos($reply, 'kumpirma') === false) {
                $suffix = $isTag
                    ? "\n\nKumpleto na po ang lahat ng kailangan sa inyong Live Blueprint sa kanan! Pakisuri po ang mga detalye, at kapag handa na, sabihin lamang ang **'Confirm'** o i-click ang Confirm Booking button upang opisyal na maipasa ang inyong reservation."
                    : "\n\nAll required booking details are now complete in your Live Blueprint on the right! Please review the summary, and type **'Confirm'** or click Confirm Booking to finalize your reservation.";
                return $reply . $suffix;
            }
            return $reply;
        }

        // If the reply is a generic template response or doesn't guide the user, add explicit next-step guidance
        $isGeneric = (
            $reply === "I have updated your booking details."
            || $reply === "I have noted your booking request. Let me know if you would like to make any adjustments."
            || $reply === "I have noted your booking request."
            || (strpos($reply, '?') === false && stripos($reply, 'select') === false && stripos($reply, 'pili') === false && stripos($reply, 'sino') === false && stripos($reply, 'kailan') === false && stripos($reply, 'who') === false && stripos($reply, 'date') === false)
        );

        if ($isGeneric && !empty($missingFields)) {
            $nextField = $missingFields[0];
            $st = $serviceType ?: ($serviceOutcome['service_type'] ?? 'burial');
            if ($nextField === 'decedent_name') {
                return $isTag
                    ? "Nakikiramay po kami sa inyong pamilya. Ako po ang tutulong sa inyo sa pag-aayos ng serbisyo. Sino po ang buong pangalan ng yumao (decedent)?"
                    : "We extend our deepest condolences. I am here to assist you with your booking. Could you please provide the full name of the deceased (decedent)?";
            } elseif ($nextField === 'preferred_date' || $nextField === 'cremation_date') {
                $serviceLabel = ($st === 'cremation') ? 'cremation' : ($isTag ? 'libing' : 'burial');
                return $isTag
                    ? "Kailan po ninyo nais isagawa ang {$serviceLabel}? (Maaari po kayong pumili mula Martes hanggang Linggo; sarado po tuwing Lunes para sa maintenance ng sementeryo)."
                    : "What date would you prefer for the {$serviceLabel} service? (Services are available Tuesday through Sunday; Mondays are closed for cemetery maintenance).";
            } elseif ($nextField === 'lot_id') {
                return $isTag
                    ? "Naitakda na po ang petsa. Maaari na po tayong pumili ng available burial lot para makumpleto ang booking. May napili na po ba kayong lot number?"
                    : "Your schedule is set. Next, please select an available burial lot to complete your booking. Do you have a specific lot number in mind?";
            } elseif ($nextField === 'preferred_columbarium') {
                return $isTag
                    ? "Pakipili po ang inyong nais na columbarium facility o niche."
                    : "Please select your preferred columbarium facility or niche.";
            }
        }

        return $reply;
    }
}
