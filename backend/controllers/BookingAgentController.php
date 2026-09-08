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

        // Authoritative backend intent normalization: do not blindly trust generic PROVIDE_INFO
        $msgLower = strtolower($message);
        if (
            in_array($intent, [BookingAgentService::INTENT_PROVIDE_INFORMATION, BookingAgentService::INTENT_PROVIDE_INFO, BookingAgentService::INTENT_UNCLEAR], true)
            || empty($intent)
        ) {
            if (preg_match('/\b(cancel|withdraw|drop booking|cancel my booking|cancel reservation)\b/i', $msgLower)) {
                $intent = BookingAgentService::INTENT_CANCEL_BOOKING;
            } elseif (preg_match('/\b(reschedule|move the burial|move my burial|move the booking|move my booking|move the cremation|postpone|shift date|move from|change date to|reschedule to|change my booking date|change the booking date)\b/i', $msgLower)) {
                $intent = BookingAgentService::INTENT_RESCHEDULE_BOOKING;
            } elseif (preg_match('/\b(spelled|misspelled|spelling|typo|incorrect|surname is actually|name is actually|should be|last name is|dapat|mali ang|correct my information|correct the information|it should be|the relationship should be)\b/i', $msgLower)) {
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
        $isCorrectionOrUpdate = in_array($intent, [
            BookingAgentService::INTENT_CORRECT_BOOKING_DETAILS,
            BookingAgentService::INTENT_UPDATE_BOOKING,
            BookingAgentService::INTENT_UPDATE_FIELD,
        ], true);

        if ($isCorrectionOrUpdate) {
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

            return [
                'success'              => !in_array($actionResult['action_status'], [BookingActionRegistry::STATUS_UNAUTHORIZED, BookingActionRegistry::STATUS_NOT_FOUND], true),
                'reply'                => $actionResult['reply'],
                'intent'               => $intent,
                'intent_confidence'    => $confidence,
                'context_resolution'   => $contextResolution,
                'action'               => $actionResult['action'] ?? null,
                'changes'              => $actionResult['changes'] ?? [],
                'deferred_intent'      => $actionResult['deferred_intent'] ?? null,
                'deferred_field'       => $actionResult['deferred_field'] ?? null,
                'slots'                => $slots,
                'booking_reference'    => $extractedReference,
                'draft_id'             => $draftId ?: ($currentDraft['draft_id'] ?? null),
                'service_type'         => $serviceTypeExtracted,
                'status'               => $currentDraft['status'] ?? 'INTAKE',
                'missing_requirements' => [],
                'code'                 => 200,
            ];
        }

        // Check if intent is a specialized action targeting a committed booking (deferred to later batches)
        $isCommittedSpecializedAction = in_array($intent, [
            BookingAgentService::INTENT_RESCHEDULE_BOOKING,
            BookingAgentService::INTENT_CANCEL_BOOKING,
            BookingAgentService::INTENT_CHECK_BOOKING_STATUS,
        ], true) && $contextResolution['type'] !== 'DRAFT';

        if ($isCommittedSpecializedAction) {
            if ($contextResolution['status'] === 'AMBIGUOUS') {
                $replyMessage = $contextResolution['message'];
            } elseif ($contextResolution['status'] === 'NOT_FOUND') {
                $replyMessage = $contextResolution['reason'] ?? "I could not find an active booking matching that reference on your account.";
            } elseif ($contextResolution['status'] === 'RESOLVED') {
                $ref = $contextResolution['reference'];
                $curStatus = $contextResolution['current_status'] ?? 'Active';
                if ($intent === BookingAgentService::INTENT_RESCHEDULE_BOOKING) {
                    $targetDate = $slots['target_date'] ?? $slots['preferred_date'] ?? $slots['cremation_date'] ?? 'the requested date';
                    $replyMessage = "I have identified your booking {$ref} ({$curStatus}). You requested to reschedule to {$targetDate}. (Action deferred to specialized scheduling batch).";
                } elseif ($intent === BookingAgentService::INTENT_CANCEL_BOOKING) {
                    $replyMessage = "I have identified your booking {$ref} ({$curStatus}). You requested to cancel this reservation. (Action deferred to specialized cancellation batch).";
                } elseif ($intent === BookingAgentService::INTENT_CHECK_BOOKING_STATUS) {
                    $rec = $contextResolution['record'] ?? [];
                    $decName = !empty($rec['decedent_name']) ? " for {$rec['decedent_name']}" : "";
                    $dateStr = !empty($rec['schedule_date']) ? " scheduled on {$rec['schedule_date']}" : "";
                    $replyMessage = "Your booking {$ref}{$decName} is currently {$curStatus}{$dateStr}.";
                }
            } elseif ($contextResolution['status'] === 'NO_ACTIVE_CONTEXT') {
                $replyMessage = "You do not have any active bookings to " . strtolower(str_replace('_', ' ', $intent)) . ".";
            }

            return [
                'success'              => true,
                'reply'                => $replyMessage,
                'intent'               => $intent,
                'intent_confidence'    => $confidence,
                'context_resolution'   => $contextResolution,
                'action'               => [
                    'requested'   => $intent,
                    'status'      => BookingActionRegistry::STATUS_DEFERRED,
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

        if (preg_match('/\b(cancel|withdraw|drop booking|cancel my booking|cancel reservation)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CANCEL_BOOKING;
        } elseif (preg_match('/\b(reschedule|move the burial|move my burial|move the booking|move my booking|move the cremation|postpone|shift date|move from|change date to|reschedule to|change my booking date|change the booking date)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_RESCHEDULE_BOOKING;
        } elseif (preg_match('/\b(spelled|misspelled|spelling|typo|incorrect|surname is actually|name is actually|should be|last name is|dapat|mali ang|correct my information|correct the information|it should be|the relationship should be)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CORRECT_BOOKING_DETAILS;
        } elseif (preg_match('/\b(change my booking|update my booking|modify my booking|edit my booking|change the relationship|change the name|change the notes|change the contact)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_UPDATE_BOOKING;
        } elseif (preg_match('/\b(availability|available|is it free|is there space|open slots|any available)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CHECK_AVAILABILITY;
        } elseif (preg_match('/\b(status|check status|what is the status|is my booking confirmed|has it been approved)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CHECK_BOOKING_STATUS;
        } elseif (preg_match('/\b(switch lot|different lot|change lot|change columbarium)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_CHANGE_ALLOCATION;
        } elseif (preg_match('/\b(select lot|choose lot|assign lot|pick lot|take lot|i want lot)\b/i', $msgLower)) {
            $intent = BookingAgentService::INTENT_SELECT_ALLOCATION;
        } elseif (preg_match('/\b(resume|continue my|pick up where)\b/i', $msgLower)) {
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
        ];

        // Date extraction (ISO or natural)
        $dateVal = null;
        if (preg_match('/\b(20\d{2}-\d{2}-\d{2})\b/', $message, $m)) {
            $dateVal = $m[1];
        } else {
            $monthMap = [
                'january' => 1, 'jan' => 1, 'february' => 2, 'feb' => 2, 'march' => 3, 'mar' => 3,
                'april' => 4, 'apr' => 4, 'may' => 5, 'june' => 6, 'jun' => 6, 'july' => 7, 'jul' => 7,
                'august' => 8, 'aug' => 8, 'september' => 9, 'sept' => 9, 'sep' => 9, 'october' => 10, 'oct' => 10,
                'november' => 11, 'nov' => 11, 'december' => 12, 'dec' => 12
            ];
            if (preg_match('/\b(january|jan|february|feb|march|mar|april|apr|may|june|jun|july|jul|august|aug|september|sept|sep|october|oct|november|nov|december|dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:\s*,?\s*(20\d{2}))?\b/i', $msgLower, $nm)) {
                $mNum = $monthMap[strtolower($nm[1])] ?? 1;
                $dNum = (int) $nm[2];
                $yNum = !empty($nm[3]) ? (int) $nm[3] : (int) date('Y');
                $dateVal = sprintf('%04d-%02d-%02d', $yNum, $mNum, $dNum);
            } elseif (str_contains($msgLower, 'tomorrow')) {
                $dateVal = date('Y-m-d', strtotime('+1 day'));
            } elseif (str_contains($msgLower, 'in 2 weeks')) {
                $dateVal = date('Y-m-d', strtotime('+14 days'));
            } elseif (str_contains($msgLower, 'in 3 weeks')) {
                $dateVal = date('Y-m-d', strtotime('+21 days'));
            }
        }

        if ($dateVal) {
            if ($serviceType === 'cremation') {
                $slots['cremation_date'] = $dateVal;
            } else {
                $slots['preferred_date'] = $dateVal;
            }
            if ($intent === BookingAgentService::INTENT_RESCHEDULE_BOOKING || $intent === BookingAgentService::INTENT_UPDATE_BOOKING) {
                $slots['target_date'] = $dateVal;
            }
        }

        if (preg_match('/\blot\s*(?:id|#|number)?\s*:?\s*(\d+)\b/i', $message, $m)) {
            $slots['lot_id'] = (int) $m[1];
            $slots['lot_identifier'] = (int) $m[1];
        }

        if (preg_match('/\bsection\s+([A-Za-z0-9]+)\b/i', $message, $m)) {
            $slots['section'] = strtoupper($m[1]);
        }

        if (preg_match('/\bmy\s+(father|mother|brother|sister|son|daughter|husband|wife|friend|relative|grandfather|grandmother|parent|spouse)\b/i', $message, $m)) {
            $slots['relationship'] = ucfirst(strtolower($m[1]));
        }

        if ($intent === BookingAgentService::INTENT_CORRECT_BOOKING_DETAILS || $intent === BookingAgentService::INTENT_UPDATE_BOOKING) {
            // A. Relationship
            if (
                preg_match('/\b(?:relationship|relasyon)\s*(?:should be|is|to|:)?\s*(daughter|son|father|mother|brother|sister|spouse|wife|husband|relative|friend)\b/i', $message, $rm)
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
            if (preg_match('/(?:decedent(?:\s+name)?|name\s+is|named|for(?:\s+my\s+\w+)?)\s+([A-Z][a-zA-Z\.\s]{2,40})/i', $message, $m)) {
                $cand = trim($m[1]);
                $cand = preg_replace('/\s+(?:my\s+)?(?:father|mother|brother|sister|son|daughter|husband|wife).*$/i', '', $cand);
                $cand = preg_replace('/\s+(?:on|at|in|prefer|preferably|date|burial|cremation).*$/i', '', $cand);
                if (strlen($cand) >= 2) {
                    $slots['decedent_name'] = $cand;
                }
            }
        }

        $extractedFields = [
            'service_type'          => $slots['service_type'],
            'decedent_name'         => $slots['decedent_name'],
            'relationship'          => $slots['relationship'],
            'preferred_date'        => $slots['preferred_date'],
            'cremation_date'        => $slots['cremation_date'],
            'lot_id'                => $slots['lot_id'],
            'preferred_columbarium' => $slots['preferred_columbarium'],
            'notes'                 => $slots['notes']
        ];
        $extractedFields = array_filter($extractedFields, fn($v) => $v !== null && $v !== '');

        return [
            'intent'            => $intent,
            'confidence'        => $confidence,
            'service_type'      => $serviceType,
            'booking_reference' => $bookingReference,
            'slots'             => $slots,
            'extracted_fields'  => $extractedFields,
            'reply'             => "I have noted your booking request. Let me know if you would like to make any adjustments."
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
