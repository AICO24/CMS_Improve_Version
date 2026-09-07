<?php
/**
 * BookingAgentService
 * 
 * Core backend application-layer orchestrator for the AI Booking Assistant.
 * Authoritative source of business rules, centralized missing field evaluation,
 * non-destructive field merging, advisory decedent discovery, and state progression.
 * 
 * Conforms strictly to BMS-3 (Cemetery Management System).
 * Operates on deterministic structured/mock AI input without direct AI provider coupling.
 */
require_once __DIR__ . '/../models/BookingDraft.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/AuditLog.php';

class BookingAgentService {
    private BookingDraft $draftModel;
    private Decedent $decedentModel;
    private Lot $lotModel;
    private AuditLog $auditLogModel;

    // Supported Intents for BMS-3
    public const INTENT_CREATE_BOOKING          = 'CREATE_BOOKING';
    public const INTENT_PROVIDE_INFO            = 'PROVIDE_INFO';
    public const INTENT_UPDATE_FIELD            = 'UPDATE_FIELD';
    public const INTENT_REQUEST_RECOMMENDATION  = 'REQUEST_RECOMMENDATION';
    public const INTENT_CONFIRM_BOOKING         = 'CONFIRM_BOOKING';
    public const INTENT_UNCLEAR                 = 'UNCLEAR';

    public const SUPPORTED_INTENTS = [
        self::INTENT_CREATE_BOOKING,
        self::INTENT_PROVIDE_INFO,
        self::INTENT_UPDATE_FIELD,
        self::INTENT_REQUEST_RECOMMENDATION,
        self::INTENT_CONFIRM_BOOKING,
        self::INTENT_UNCLEAR,
    ];

    // Centralized Required Field Contracts
    public const REQUIRED_BURIAL_FIELDS    = ['service_type', 'decedent_name', 'preferred_date', 'lot_id'];
    public const REQUIRED_CREMATION_FIELDS = ['service_type', 'decedent_name', 'cremation_date'];

    public function __construct(
        ?BookingDraft $draftModel = null,
        ?Decedent $decedentModel = null,
        ?Lot $lotModel = null,
        ?AuditLog $auditLogModel = null
    ) {
        $this->draftModel = $draftModel ?? new BookingDraft();
        $this->decedentModel = $decedentModel ?? new Decedent();
        $this->lotModel = $lotModel ?? new Lot();
        $this->auditLogModel = $auditLogModel ?? new AuditLog();
    }

    /**
     * Get Centralized Required Field Contract for a Service Type.
     * 
     * @param string $serviceType 'burial' | 'cremation'
     * @return array List of required field keys.
     */
    public function getRequiredFields(string $serviceType): array {
        return match (strtolower(trim($serviceType))) {
            'cremation' => self::REQUIRED_CREMATION_FIELDS,
            'burial'    => self::REQUIRED_BURIAL_FIELDS,
            default     => [],
        };
    }

    /**
     * Deterministic Missing Field Evaluator.
     * 
     * Authoritative backend validation of field presence and data integrity.
     * Empty strings, nulls, invalid dates, past dates, or non-existent lots count as missing.
     * 
     * @param string $serviceType
     * @param array  $extractedData
     * @return array List of field names that are still missing or invalid.
     */
    public function evaluateMissingFields(string $serviceType, array $extractedData): array {
        $required = $this->getRequiredFields($serviceType);
        $missing = [];

        foreach ($required as $field) {
            if ($field === 'service_type') {
                $st = strtolower(trim((string) ($extractedData['service_type'] ?? '')));
                if (!in_array($st, BookingDraft::ALLOWED_SERVICES, true)) {
                    $missing[] = 'service_type';
                }
                continue;
            }

            if (!array_key_exists($field, $extractedData) || $extractedData[$field] === null || trim((string) $extractedData[$field]) === '') {
                $missing[] = $field;
                continue;
            }

            $value = $extractedData[$field];

            // Validate date fields (preferred_date for burial, cremation_date for cremation)
            if (in_array($field, ['preferred_date', 'cremation_date'], true)) {
                $dateValidation = $this->validateBookingDate($value, $field === 'preferred_date');
                if (!$dateValidation['valid']) {
                    $missing[] = $field;
                    continue;
                }
            }

            // Validate lot_id for burial bookings
            if ($field === 'lot_id') {
                $lotId = (int) $value;
                if ($lotId <= 0 || !$this->lotModel->findById($lotId)) {
                    $missing[] = 'lot_id';
                    continue;
                }
            }
        }

        return array_values(array_unique($missing));
    }

    /**
     * Validate Date Constraints against Cemetery Business Rules.
     * 
     * Rules:
     * - Must be a parsable date string.
     * - Cannot be in the past (< today).
     * - Burial bookings cannot be on Mondays (cemetery rule).
     * 
     * @param string $dateStr
     * @param bool   $isBurial True if burial date (enforces Monday rule)
     * @return array ['valid' => bool, 'error' => string|null]
     */
    public function validateBookingDate(string $dateStr, bool $isBurial = true): array {
        $timestamp = strtotime($dateStr);
        if ($timestamp === false) {
            return ['valid' => false, 'error' => 'Invalid date format'];
        }

        $dateFormatted = date('Y-m-d', $timestamp);
        $today = date('Y-m-d');

        if ($dateFormatted < $today) {
            return ['valid' => false, 'error' => 'Booking date cannot be in the past'];
        }

        if ($isBurial && (int) date('N', $timestamp) === 1) {
            return ['valid' => false, 'error' => 'Monday booking is not allowed; please select another day'];
        }

        return ['valid' => true, 'error' => null];
    }

    /**
     * Centralized State Derivation.
     * Determines the desired next workflow state based on data completeness and intent.
     * 
     * @param string $serviceType
     * @param array  $extractedData
     * @param array  $missingFields
     * @param string $currentStatus
     * @param string $intent
     * @return string Target status
     */
    public function determineNextState(
        string $serviceType,
        array $extractedData,
        array $missingFields,
        string $currentStatus,
        string $intent = ''
    ): string {
        // Terminal states never progress
        if (BookingDraft::isTerminalState($currentStatus)) {
            return $currentStatus;
        }

        // CONFIRM_BOOKING intent moves to AWAITING_CONFIRM if and only if no fields are missing
        if ($intent === self::INTENT_CONFIRM_BOOKING && empty($missingFields)) {
            return BookingDraft::STATUS_AWAITING_CONFIRM;
        }

        // If no required fields are missing, draft is ready for citizen/staff review
        if (empty($missingFields)) {
            return BookingDraft::STATUS_READY_FOR_REVIEW;
        }

        // Correction rule: If draft was in review or confirm but fields became missing/invalidated,
        // it must return to COLLECTING_INFO per the approved state machine.
        if (in_array($currentStatus, [BookingDraft::STATUS_READY_FOR_REVIEW, BookingDraft::STATUS_AWAITING_CONFIRM], true)) {
            return BookingDraft::STATUS_COLLECTING_INFO;
        }

        // Burial specific progression:
        if ($serviceType === 'burial') {
            // If decedent and date are provided, but lot_id is pending -> LOT_SELECTION
            if (!empty($extractedData['decedent_name']) && !empty($extractedData['preferred_date']) && in_array('lot_id', $missingFields, true)) {
                return BookingDraft::STATUS_LOT_SELECTION;
            }
        }

        // Cremation specific progression:
        if ($serviceType === 'cremation') {
            // If decedent is provided but date/preferences are pending -> CREMATION_PREFS
            if (!empty($extractedData['decedent_name']) && in_array('cremation_date', $missingFields, true)) {
                return BookingDraft::STATUS_CREMATION_PREFS;
            }
        }

        // Generic collection state if any booking data has been supplied
        if (!empty($extractedData['decedent_name']) || !empty($extractedData['preferred_date']) || !empty($extractedData['cremation_date'])) {
            return BookingDraft::STATUS_COLLECTING_INFO;
        }

        return BookingDraft::STATUS_DRAFT_STARTED;
    }

    /**
     * Non-Blocking Advisory Decedent Discovery.
     * Searches existing decedent records without blocking the booking or modifying domain records.
     * 
     * @param string $decedentName
     * @return array Advisory match result ['found' => bool, 'candidates' => array]
     */
    public function discoverDecedentMatch(string $decedentName): array {
        $trimmed = trim($decedentName);
        if (strlen($trimmed) < 2) {
            return ['found' => false, 'candidates' => []];
        }

        $matches = $this->decedentModel->findAll(['q' => $trimmed], ['page' => 1, 'per_page' => 5]);
        if (empty($matches) || !is_array($matches)) {
            return ['found' => false, 'candidates' => []];
        }

        $candidates = [];
        foreach ($matches as $match) {
            $candidates[] = [
                'decedent_id' => (int) $match['decedent_id'],
                'full_name'   => trim(($match['first_name'] ?? '') . ' ' . ($match['last_name'] ?? '')),
                'dod'         => $match['dod'] ?? null,
                'section'     => $match['section_name'] ?? null,
                'lot_number'  => $match['lot_number'] ?? null,
            ];
        }

        return [
            'found'      => true,
            'candidates' => $candidates,
        ];
    }

    /**
     * Process a Deterministic Structured Input Payload.
     * Main application orchestrator for BMS-3.
     * 
     * @param int         $userId
     * @param array       $payload  Structured input conforming to BMS-3 contract.
     * @param int|null    $draftId  Optional draft ID to target existing draft.
     * @param string|null $username Optional username for audit logging.
     * @return array Standardized service outcome.
     * @throws BookingDraftException
     */
    public function processStructuredInput(
        int $userId,
        array $payload,
        ?int $draftId = null,
        ?string $username = null
    ): array {
        $intent = $payload['intent'] ?? self::INTENT_PROVIDE_INFO;
        if (!in_array($intent, self::SUPPORTED_INTENTS, true)) {
            $intent = self::INTENT_UNCLEAR;
        }

        $incomingFields = is_array($payload['extracted_fields'] ?? null) ? $payload['extracted_fields'] : [];
        $serviceTypeInput = $payload['service_type'] ?? ($incomingFields['service_type'] ?? null);

        if ($serviceTypeInput !== null && !in_array($serviceTypeInput, BookingDraft::ALLOWED_SERVICES, true)) {
            throw new BookingDraftException(
                "Invalid service type: '{$serviceTypeInput}'. Allowed types: " . implode(', ', BookingDraft::ALLOWED_SERVICES),
                'INVALID_SERVICE_TYPE',
                400
            );
        }

        // 1. Resolve or Initialize Draft
        $draft = null;
        if ($draftId !== null && $draftId > 0) {
            $draft = $this->draftModel->requireOwnership($draftId, $userId);
        } else {
            $draft = $this->draftModel->findActiveByUser($userId, $serviceTypeInput);
        }

        if (!$draft) {
            $initialService = $serviceTypeInput ?? 'burial';
            $expiresAt = date('Y-m-d H:i:s', strtotime('+24 hours'));
            $newDraftId = $this->draftModel->create($userId, $initialService, $expiresAt);
            $draft = $this->draftModel->findById($newDraftId);

            $this->auditLogModel->log(
                'booking_draft.created',
                $userId,
                $username,
                'BookingDraft',
                $newDraftId,
                ['service_type' => $initialService]
            );
        }

        $activeDraftId = (int) $draft['draft_id'];
        $currentServiceType = $draft['service_type'];

        // If payload explicitly requests a service type change and draft is still in intake
        if (!empty($serviceTypeInput) && in_array($serviceTypeInput, BookingDraft::ALLOWED_SERVICES, true) && $serviceTypeInput !== $currentServiceType) {
            if (in_array($draft['status'], [BookingDraft::STATUS_DRAFT_STARTED, BookingDraft::STATUS_COLLECTING_INFO], true)) {
                $currentServiceType = $serviceTypeInput;
                $incomingFields['service_type'] = $currentServiceType;
            }
        } else {
            $incomingFields['service_type'] = $currentServiceType;
        }

        // 2. Non-Destructive Field Merge
        // Sanitize incoming fields: preserve valid data, omit nulls unless explicitly correcting
        $sanitizedIncoming = [];
        foreach ($incomingFields as $k => $v) {
            if ($intent === self::INTENT_UPDATE_FIELD) {
                // Corrections may explicitly set or clear fields
                $sanitizedIncoming[$k] = is_string($v) ? trim($v) : $v;
            } else {
                // Standard extractions ignore null or blank values to prevent accidental field clearing
                if ($v !== null && $v !== '') {
                    $sanitizedIncoming[$k] = is_string($v) ? trim($v) : $v;
                }
            }
        }

        $mergedExtractedData = $this->draftModel->updateExtractedData($activeDraftId, $sanitizedIncoming);

        // 3. Centralized Missing Fields Evaluation
        $missingFields = $this->evaluateMissingFields($currentServiceType, $mergedExtractedData);
        $this->draftModel->updateMissingFields($activeDraftId, $missingFields);

        // 4. Advisory Decedent Discovery
        $decedentMatch = ['found' => false, 'candidates' => []];
        if (!empty($mergedExtractedData['decedent_name'])) {
            $decedentMatch = $this->discoverDecedentMatch($mergedExtractedData['decedent_name']);
            if ($decedentMatch['found']) {
                $this->auditLogModel->log(
                    'booking_draft.decedent_match_found',
                    $userId,
                    $username,
                    'BookingDraft',
                    $activeDraftId,
                    ['decedent_name' => $mergedExtractedData['decedent_name'], 'candidate_count' => count($decedentMatch['candidates'])]
                );
            }
        }

        // 5. State Progression
        $currentStatus = $draft['status'];
        $targetStatus = $this->determineNextState(
            $currentServiceType,
            $mergedExtractedData,
            $missingFields,
            $currentStatus,
            $intent
        );

        if ($targetStatus !== $currentStatus) {
            // Legal pathing: DRAFT_STARTED must transition through COLLECTING_INFO
            if ($currentStatus === BookingDraft::STATUS_DRAFT_STARTED && in_array($targetStatus, [
                BookingDraft::STATUS_LOT_SELECTION,
                BookingDraft::STATUS_CREMATION_PREFS,
                BookingDraft::STATUS_READY_FOR_REVIEW,
                BookingDraft::STATUS_AWAITING_CONFIRM
            ], true)) {
                $this->draftModel->transitionStatus($activeDraftId, BookingDraft::STATUS_COLLECTING_INFO);
                $this->auditLogModel->log(
                    'booking_draft.state_changed',
                    $userId,
                    $username,
                    'BookingDraft',
                    $activeDraftId,
                    ['from_status' => $currentStatus, 'to_status' => BookingDraft::STATUS_COLLECTING_INFO, 'intent' => $intent]
                );
                $currentStatus = BookingDraft::STATUS_COLLECTING_INFO;
            }

            // Legal pathing: READY_FOR_REVIEW returning to sub-intake must transition through COLLECTING_INFO
            if ($currentStatus === BookingDraft::STATUS_READY_FOR_REVIEW && in_array($targetStatus, [
                BookingDraft::STATUS_LOT_SELECTION,
                BookingDraft::STATUS_CREMATION_PREFS
            ], true)) {
                $this->draftModel->transitionStatus($activeDraftId, BookingDraft::STATUS_COLLECTING_INFO);
                $this->auditLogModel->log(
                    'booking_draft.state_changed',
                    $userId,
                    $username,
                    'BookingDraft',
                    $activeDraftId,
                    ['from_status' => $currentStatus, 'to_status' => BookingDraft::STATUS_COLLECTING_INFO, 'intent' => $intent]
                );
                $currentStatus = BookingDraft::STATUS_COLLECTING_INFO;
            }

            if ($targetStatus !== $currentStatus) {
                $this->draftModel->transitionStatus($activeDraftId, $targetStatus);
                $this->auditLogModel->log(
                    'booking_draft.state_changed',
                    $userId,
                    $username,
                    'BookingDraft',
                    $activeDraftId,
                    ['from_status' => $currentStatus, 'to_status' => $targetStatus, 'intent' => $intent]
                );
                $currentStatus = $targetStatus;
            }
        }

        // Audit log field updates if fields were supplied
        if (!empty($sanitizedIncoming)) {
            $action = ($intent === self::INTENT_UPDATE_FIELD) ? 'booking_draft.field_corrected' : 'booking_draft.fields_extracted';
            $this->auditLogModel->log(
                $action,
                $userId,
                $username,
                'BookingDraft',
                $activeDraftId,
                ['updated_fields' => array_keys($sanitizedIncoming), 'status' => $currentStatus]
            );
        }

        return [
            'success'            => true,
            'draft_id'           => $activeDraftId,
            'service_type'       => $currentServiceType,
            'status'             => $currentStatus,
            'intent'             => $intent,
            'extracted_data'     => $mergedExtractedData,
            'missing_fields'     => $missingFields,
            'decedent_match'     => $decedentMatch,
            'is_ready_for_review'=> empty($missingFields),
            'is_awaiting_confirm'=> ($currentStatus === BookingDraft::STATUS_AWAITING_CONFIRM),
        ];
    }

    /**
     * Dedicated Field Correction Method.
     * Overrides a single field, re-evaluates missing fields, and derives the next legal state.
     * 
     * @param int    $draftId
     * @param string $field
     * @param mixed  $value
     * @param int    $userId
     * @param string|null $username
     * @return array
     */
    public function updateDraftField(int $draftId, string $field, $value, int $userId, ?string $username = null): array {
        $payload = [
            'intent' => self::INTENT_UPDATE_FIELD,
            'extracted_fields' => [
                $field => $value
            ]
        ];

        return $this->processStructuredInput($userId, $payload, $draftId, $username);
    }

    /**
     * Retrieve the Active Draft for a User.
     * 
     * @param int         $userId
     * @param string|null $serviceType
     * @return array|null
     */
    public function getActiveDraft(int $userId, ?string $serviceType = null): ?array {
        $draft = $this->draftModel->findActiveByUser($userId, $serviceType);
        if (!$draft) {
            return null;
        }

        return [
            'draft_id'       => (int) $draft['draft_id'],
            'user_id'        => (int) $draft['user_id'],
            'service_type'   => $draft['service_type'],
            'status'         => $draft['status'],
            'extracted_data' => !empty($draft['extracted_data']) ? json_decode($draft['extracted_data'], true) : [],
            'missing_fields' => !empty($draft['missing_fields']) ? json_decode($draft['missing_fields'], true) : [],
            'conversation_id'=> $draft['conversation_id'],
            'expires_at'     => $draft['expires_at'],
            'updated_at'     => $draft['updated_at'],
        ];
    }

    /**
     * Retrieve Active Draft Summary for User.
     * 
     * @param int         $userId
     * @param string|null $serviceType
     * @return array|null
     */
    public function getActiveDraftSummary(int $userId, ?string $serviceType = null): ?array {
        $draft = $this->draftModel->findActiveByUser($userId, $serviceType);
        if (!$draft) {
            return null;
        }

        $extractedData = !empty($draft['extracted_data']) ? json_decode($draft['extracted_data'], true) : [];
        $missingFields = $this->evaluateMissingFields($draft['service_type'], $extractedData);

        return [
            'draft_id'            => (int) $draft['draft_id'],
            'service_type'        => $draft['service_type'],
            'status'              => $draft['status'],
            'extracted_data'      => $extractedData,
            'missing_fields'      => $missingFields,
            'is_ready_for_review' => empty($missingFields),
            'expires_at'          => $draft['expires_at'],
            'updated_at'          => $draft['updated_at'],
        ];
    }

    /**
     * Advance Draft to AWAITING_CONFIRM (Pre-Confirmation Boundary).
     * 
     * NOTE: Per BMS-3 scope, this advances the draft status to AWAITING_CONFIRM only.
     * It does NOT create burial_schedules, cremation_records, or payments.
     * Domain record finalization is strictly deferred to BMS-7 / BMS-8.
     * 
     * @param int         $draftId
     * @param int         $userId
     * @param string|null $username
     * @return array
     * @throws BookingDraftException
     */
    public function confirmBookingDraft(int $draftId, int $userId, ?string $username = null): array {
        $draft = $this->draftModel->requireOwnership($draftId, $userId);

        $extracted = !empty($draft['extracted_data']) ? json_decode($draft['extracted_data'], true) : [];
        $missing = $this->evaluateMissingFields($draft['service_type'], $extracted);

        if (!empty($missing)) {
            throw new BookingDraftException(
                "Cannot confirm booking draft. Missing required fields: " . implode(', ', $missing),
                'INCOMPLETE_DRAFT',
                400
            );
        }

        // Transition: READY_FOR_REVIEW -> AWAITING_CONFIRM
        if ($draft['status'] !== BookingDraft::STATUS_READY_FOR_REVIEW) {
            $this->draftModel->transitionStatus($draftId, BookingDraft::STATUS_READY_FOR_REVIEW);
        }

        $this->draftModel->transitionStatus($draftId, BookingDraft::STATUS_AWAITING_CONFIRM);

        $this->auditLogModel->log(
            'booking_draft.awaiting_confirm',
            $userId,
            $username,
            'BookingDraft',
            $draftId,
            ['service_type' => $draft['service_type']]
        );

        $fresh = $this->draftModel->findById($draftId);

        return [
            'success'      => true,
            'draft_id'     => $draftId,
            'service_type' => $fresh['service_type'],
            'status'       => $fresh['status'],
            'message'      => 'Booking draft confirmed and awaiting final submission.',
        ];
    }

    /**
     * Cancel an Active Draft.
     * 
     * @param int         $draftId
     * @param int         $userId
     * @param string|null $username
     * @return bool
     * @throws BookingDraftException
     */
    public function cancelDraft(int $draftId, int $userId, ?string $username = null): bool {
        $this->draftModel->requireOwnership($draftId, $userId);
        $result = $this->draftModel->cancel($draftId);

        if ($result) {
            $this->auditLogModel->log(
                'booking_draft.cancelled',
                $userId,
                $username,
                'BookingDraft',
                $draftId,
                []
            );
        }

        return $result;
    }
}
