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
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/DecedentRequest.php';
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/BookingActionRegistry.php';
require_once __DIR__ . '/BookingDateResolver.php';
require_once __DIR__ . '/../controllers/PaymentController.php';

class BookingAgentService {
    private BookingDraft $draftModel;
    private Decedent $decedentModel;
    private Lot $lotModel;
    private AuditLog $auditLogModel;
    private Schedule $scheduleModel;
    private DecedentRequest $decedentRequestModel;
    private Cremation $cremationModel;
    private BookingActionRegistry $actionRegistry;

    // Supported Intents for BMS-3 and BMS-5 (Unified Booking Automation)
    public const INTENT_CREATE_BOOKING          = 'CREATE_BOOKING';
    public const INTENT_PROVIDE_INFO            = 'PROVIDE_INFO';
    public const INTENT_PROVIDE_INFORMATION     = 'PROVIDE_INFORMATION';
    public const INTENT_UPDATE_FIELD            = 'UPDATE_FIELD';
    public const INTENT_UPDATE_BOOKING          = 'UPDATE_BOOKING';
    public const INTENT_CORRECT_BOOKING_DETAILS = 'CORRECT_BOOKING_DETAILS';
    public const INTENT_RESCHEDULE_BOOKING      = 'RESCHEDULE_BOOKING';
    public const INTENT_CANCEL_BOOKING          = 'CANCEL_BOOKING';
    public const INTENT_CHECK_AVAILABILITY      = 'CHECK_AVAILABILITY';
    public const INTENT_EXPLAIN_MISSING_REQUIREMENTS = 'EXPLAIN_MISSING_REQUIREMENTS';
    public const INTENT_SELECT_ALLOCATION       = 'SELECT_ALLOCATION';
    public const INTENT_CHANGE_ALLOCATION       = 'CHANGE_ALLOCATION';
    public const INTENT_CHECK_BOOKING_STATUS    = 'CHECK_BOOKING_STATUS';
    public const INTENT_RESUME_BOOKING          = 'RESUME_BOOKING';
    public const INTENT_REQUEST_RECOMMENDATION  = 'REQUEST_RECOMMENDATION';
    public const INTENT_CONFIRM_BOOKING         = 'CONFIRM_BOOKING';
    public const INTENT_GENERAL_INQUIRY         = 'GENERAL_INQUIRY';
    public const INTENT_UNCLEAR                 = 'UNCLEAR';

    public const SUPPORTED_INTENTS = [
        self::INTENT_CREATE_BOOKING,
        self::INTENT_PROVIDE_INFO,
        self::INTENT_PROVIDE_INFORMATION,
        self::INTENT_UPDATE_FIELD,
        self::INTENT_UPDATE_BOOKING,
        self::INTENT_CORRECT_BOOKING_DETAILS,
        self::INTENT_RESCHEDULE_BOOKING,
        self::INTENT_CANCEL_BOOKING,
        self::INTENT_CHECK_AVAILABILITY,
        self::INTENT_EXPLAIN_MISSING_REQUIREMENTS,
        self::INTENT_SELECT_ALLOCATION,
        self::INTENT_CHANGE_ALLOCATION,
        self::INTENT_CHECK_BOOKING_STATUS,
        self::INTENT_RESUME_BOOKING,
        self::INTENT_REQUEST_RECOMMENDATION,
        self::INTENT_CONFIRM_BOOKING,
        self::INTENT_GENERAL_INQUIRY,
        self::INTENT_UNCLEAR,
    ];

    // Centralized Required Field Contracts
    public const REQUIRED_BURIAL_FIELDS    = ['service_type', 'decedent_name', 'preferred_date', 'lot_id'];
    public const REQUIRED_CREMATION_FIELDS = ['service_type', 'decedent_name', 'cremation_date'];

    private ?BookingAvailabilityService $availabilityService = null;

    public function __construct(
        ?BookingDraft $draftModel = null,
        ?Decedent $decedentModel = null,
        ?Lot $lotModel = null,
        ?AuditLog $auditLogModel = null,
        ?Schedule $scheduleModel = null,
        ?DecedentRequest $decedentRequestModel = null,
        ?Cremation $cremationModel = null,
        ?BookingActionRegistry $actionRegistry = null,
        ?BookingAvailabilityService $availabilityService = null
    ) {
        $this->draftModel = $draftModel ?? new BookingDraft();
        $this->decedentModel = $decedentModel ?? new Decedent();
        $this->lotModel = $lotModel ?? new Lot();
        $this->auditLogModel = $auditLogModel ?? new AuditLog();
        $this->scheduleModel = $scheduleModel ?? new Schedule();
        $this->decedentRequestModel = $decedentRequestModel ?? new DecedentRequest();
        $this->cremationModel = $cremationModel ?? new Cremation();
        $this->actionRegistry = $actionRegistry ?? new BookingActionRegistry();
        $this->availabilityService = $availabilityService;
    }

    public function getActionRegistry(): BookingActionRegistry {
        return $this->actionRegistry;
    }

    public function getAvailabilityService(): BookingAvailabilityService {
        if ($this->availabilityService === null) {
            require_once __DIR__ . '/BookingAvailabilityService.php';
            $this->availabilityService = new BookingAvailabilityService(
                null,
                $this->scheduleModel,
                $this->lotModel,
                $this->cremationModel,
                $this
            );
        }
        return $this->availabilityService;
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
     * Deterministic Booking Context Resolution Layer (Batch 1).
     *
     * Resolves whether the user's intent refers to an explicit booking reference,
     * an active committed booking, an active draft, or is ambiguous/not found.
     *
     * Resolution Priorities:
     * Priority 1: Explicit Booking Reference (e.g. BUR-14, CREM-8, DFT-5) -> match & validate ownership
     * Priority 2: Explicit Service Type + Unique Candidate -> match single active booking for service
     * Priority 3: Single Active Booking -> match unique active/pending booking across services
     * Priority 4: Active Draft -> match existing draft for updates/intake
     * Priority 5: Ambiguous -> multiple possible candidates; return AMBIGUOUS with candidate references
     *
     * @param int         $userId
     * @param string      $intent
     * @param string|null $extractedReference
     * @param array|null  $activeDraft
     * @param array       $activeBookings
     * @param string|null $serviceType
     * @return array Standardized resolution payload
     */
    public function resolveBookingContext(
        int $userId,
        string $intent,
        ?string $extractedReference = null,
        ?array $activeDraft = null,
        array $activeBookings = [],
        ?string $serviceType = null
    ): array {
        // Priority 1: Explicit Booking Reference
        if ($extractedReference !== null && trim($extractedReference) !== '') {
            $cleanRef = strtoupper(trim($extractedReference));

            // Normalize formats: "SCHEDULE 14" -> "BUR-14", "DRAFT 12" -> "DFT-12", "BOOKING 14" -> match
            if (preg_match('/^SCHEDULE\s*#?\s*(\d+)$/i', $cleanRef, $m)) {
                $cleanRef = 'BUR-' . $m[1];
            } elseif (preg_match('/^DRAFT\s*#?\s*(\d+)$/i', $cleanRef, $m)) {
                $cleanRef = 'DFT-' . $m[1];
            } elseif (preg_match('/^(?:BOOKING|RESERVATION)\s*#?\s*(\d+)$/i', $cleanRef, $m)) {
                $num = $m[1];
                $matchedRef = null;
                foreach ($activeBookings as $b) {
                    $bRef = strtoupper(trim((string) ($b['reference'] ?? '')));
                    if ($bRef === "BUR-{$num}" || $bRef === "CREM-{$num}" || (int) ($b['booking_id'] ?? 0) === (int) $num) {
                        $matchedRef = $bRef;
                        break;
                    }
                }
                $cleanRef = $matchedRef ?: "BUR-{$num}";
            }

            // Check if matches committed booking owned by user
            foreach ($activeBookings as $b) {
                $bRef = strtoupper(trim((string) ($b['reference'] ?? '')));
                if ($bRef === $cleanRef) {
                    return [
                        'status'         => 'RESOLVED',
                        'type'           => 'COMMITTED_BOOKING',
                        'booking_id'     => (int) ($b['booking_id'] ?? 0),
                        'reference'      => $b['reference'] ?? $cleanRef,
                        'service_type'   => $b['service_type'] ?? null,
                        'current_status' => $b['status'] ?? null,
                        'record'         => $b,
                    ];
                }
            }

            // Check if matches active draft
            if ($activeDraft && !empty($activeDraft['draft_id'])) {
                $dId = (int) $activeDraft['draft_id'];
                if ($cleanRef === "DFT-{$dId}" || $cleanRef === "DRAFT-{$dId}" || $cleanRef === (string) $dId) {
                    return [
                        'status'         => 'RESOLVED',
                        'type'           => 'DRAFT',
                        'draft_id'       => $dId,
                        'reference'      => 'DFT-' . $dId,
                        'service_type'   => $activeDraft['service_type'] ?? 'burial',
                        'current_status' => $activeDraft['status'] ?? 'DRAFT_STARTED',
                        'record'         => $activeDraft,
                    ];
                }
            }

            // Reference was explicitly specified by user but does NOT belong to active bookings or drafts
            return [
                'status'    => 'NOT_FOUND',
                'type'      => 'NONE',
                'reference' => $cleanRef,
                'reason'    => "No active booking found matching reference '{$cleanRef}' for your account.",
            ];
        }

        // Filter eligible non-terminal committed bookings
        $eligibleStatuses = ['Pending', 'Confirmed', 'Scheduled'];
        $eligibleBookings = array_values(array_filter($activeBookings, function ($b) use ($eligibleStatuses) {
            return in_array($b['status'] ?? '', $eligibleStatuses, true);
        }));

        $hasActiveDraft = ($activeDraft && !empty($activeDraft['draft_id']) && !BookingDraft::isTerminalState($activeDraft['status'] ?? ''));
        $hasCommittedBookings = !empty($eligibleBookings);

        // F-02: Draft vs Committed Booking Ambiguity Protection
        // If user has both an active unfinalized draft AND active committed booking(s),
        // a generic edit/update request without explicit reference must NOT silently guess.
        if ($hasActiveDraft && $hasCommittedBookings && ($extractedReference === null || trim((string)$extractedReference) === '')) {
            $isAmbiguousUpdate = in_array($intent, [
                self::INTENT_UPDATE_BOOKING,
                self::INTENT_CORRECT_BOOKING_DETAILS,
                self::INTENT_UPDATE_FIELD,
                self::INTENT_RESCHEDULE_BOOKING,
                self::INTENT_CHANGE_ALLOCATION,
            ], true);

            if ($isAmbiguousUpdate) {
                $committedRefs = array_column($eligibleBookings, 'reference');
                $draftRef = 'DFT-' . $activeDraft['draft_id'];
                return [
                    'status'     => 'AMBIGUOUS',
                    'type'       => 'DRAFT_COMMITTED_AMBIGUITY',
                    'message'    => "You have an active draft ({$draftRef}) and active booking (" . implode(', ', $committedRefs) . "). Please specify whether you wish to update your draft or your existing booking.",
                    'candidates' => array_merge([
                        [
                            'reference'    => $draftRef,
                            'type'         => 'DRAFT',
                            'service_type' => $activeDraft['service_type'] ?? 'burial',
                            'status'       => $activeDraft['status'] ?? 'DRAFT_STARTED',
                        ]
                    ], array_map(function ($b) {
                        return [
                            'reference'     => $b['reference'],
                            'type'          => 'COMMITTED_BOOKING',
                            'service_type'  => $b['service_type'],
                            'schedule_date' => $b['schedule_date'] ?? null,
                            'status'        => $b['status'] ?? null,
                        ];
                    }, $eligibleBookings))
                ];
            }
        }

        $isActionOnCommitted = in_array($intent, [
            self::INTENT_RESCHEDULE_BOOKING,
            self::INTENT_CANCEL_BOOKING,
            self::INTENT_UPDATE_BOOKING,
            self::INTENT_CHECK_BOOKING_STATUS,
        ], true);

        // Priority 2: Explicit Service Type + Unique Candidate
        if ($serviceType !== null && in_array(strtolower($serviceType), ['burial', 'cremation'], true) && $isActionOnCommitted) {
            $serviceCandidates = array_values(array_filter($eligibleBookings, function ($b) use ($serviceType) {
                return strtolower($b['service_type'] ?? '') === strtolower($serviceType);
            }));

            if (count($serviceCandidates) === 1) {
                $matched = $serviceCandidates[0];
                return [
                    'status'         => 'RESOLVED',
                    'type'           => 'COMMITTED_BOOKING',
                    'booking_id'     => (int) ($matched['booking_id'] ?? 0),
                    'reference'      => $matched['reference'],
                    'service_type'   => $matched['service_type'],
                    'current_status' => $matched['status'],
                    'record'         => $matched,
                ];
            }

            if (count($serviceCandidates) > 1) {
                $candidates = array_map(function ($b) {
                    return [
                        'reference'     => $b['reference'],
                        'service_type'  => $b['service_type'],
                        'schedule_date' => $b['schedule_date'] ?? null,
                        'decedent_name' => $b['decedent_name'] ?? null,
                        'status'        => $b['status'] ?? null,
                    ];
                }, $serviceCandidates);

                return [
                    'status'     => 'AMBIGUOUS',
                    'type'       => 'MULTIPLE_CANDIDATES',
                    'candidates' => $candidates,
                    'message'    => "You have multiple active " . strtolower($serviceType) . " bookings (" . implode(', ', array_column($candidates, 'reference')) . "). Please specify which booking reference you are referring to.",
                ];
            }
        }

        // Priority 3: Single Active Booking (Across services)
        if ($isActionOnCommitted) {
            if (count($eligibleBookings) === 1) {
                $matched = $eligibleBookings[0];
                return [
                    'status'         => 'RESOLVED',
                    'type'           => 'COMMITTED_BOOKING',
                    'booking_id'     => (int) ($matched['booking_id'] ?? 0),
                    'reference'      => $matched['reference'],
                    'service_type'   => $matched['service_type'],
                    'current_status' => $matched['status'],
                    'record'         => $matched,
                ];
            }

            if (count($eligibleBookings) > 1) {
                $candidates = array_map(function ($b) {
                    return [
                        'reference'     => $b['reference'],
                        'service_type'  => $b['service_type'],
                        'schedule_date' => $b['schedule_date'] ?? null,
                        'decedent_name' => $b['decedent_name'] ?? null,
                        'status'        => $b['status'] ?? null,
                    ];
                }, $eligibleBookings);

                return [
                    'status'     => 'AMBIGUOUS',
                    'type'       => 'MULTIPLE_CANDIDATES',
                    'candidates' => $candidates,
                    'message'    => "You currently have multiple active bookings (" . implode(', ', array_column($candidates, 'reference')) . "). Which one would you like to " . ($intent === self::INTENT_CANCEL_BOOKING ? 'cancel' : ($intent === self::INTENT_RESCHEDULE_BOOKING ? 'reschedule' : 'update')) . "?",
                ];
            }
        }

        // Priority 4: Active Draft
        $isDraftIntake = in_array($intent, [
            self::INTENT_CREATE_BOOKING,
            self::INTENT_PROVIDE_INFO,
            self::INTENT_PROVIDE_INFORMATION,
            self::INTENT_UPDATE_FIELD,
            self::INTENT_CORRECT_BOOKING_DETAILS,
            self::INTENT_REQUEST_RECOMMENDATION,
            self::INTENT_CONFIRM_BOOKING,
            self::INTENT_SELECT_ALLOCATION,
            self::INTENT_CHANGE_ALLOCATION,
            self::INTENT_RESUME_BOOKING,
        ], true) || empty($eligibleBookings);

        if ($isDraftIntake) {
            if ($activeDraft && !empty($activeDraft['draft_id']) && !BookingDraft::isTerminalState($activeDraft['status'] ?? '')) {
                return [
                    'status'         => 'DRAFT',
                    'type'           => 'DRAFT',
                    'draft_id'       => (int) $activeDraft['draft_id'],
                    'reference'      => 'DFT-' . $activeDraft['draft_id'],
                    'service_type'   => $activeDraft['service_type'] ?? ($serviceType ?? 'burial'),
                    'current_status' => $activeDraft['status'] ?? 'DRAFT_STARTED',
                    'record'         => $activeDraft,
                ];
            }

            if ($intent === self::INTENT_CREATE_BOOKING || empty($eligibleBookings)) {
                return [
                    'status'       => 'NO_ACTIVE_CONTEXT',
                    'type'         => 'NEW_DRAFT',
                    'service_type' => $serviceType ?? 'burial',
                    'message'      => 'No active draft found; ready to initiate new booking.',
                ];
            }
        }

        // Priority 5: Default No Active Context
        return [
            'status'  => 'NO_ACTIVE_CONTEXT',
            'type'    => 'NONE',
            'message' => 'No active booking or draft found matching the request.',
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
        if ($intent === self::INTENT_PROVIDE_INFORMATION) {
            $intent = self::INTENT_PROVIDE_INFO;
        } elseif ($intent === self::INTENT_CORRECT_BOOKING_DETAILS) {
            $intent = self::INTENT_UPDATE_FIELD;
        }
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
            // Guard cemetery business rules on dates (e.g. past dates, Monday burials)
            if (($k === 'preferred_date' || $k === 'cremation_date') && !empty($v)) {
                $valRes = BookingDateResolver::validate((string)$v, $currentServiceType === 'burial');
                if (!$valRes['valid']) {
                    continue;
                }
            }

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
     * Safely finalize a burial draft into the authoritative burial_schedules table (BMS-7).
     * 
     * Enforces transactional boundary:
     * - Verifies draft ownership and service_type === 'burial'.
     * - Validates 0 missing required fields.
     * - Executes inside Database::transaction():
     *   - Transitions draft READY_FOR_REVIEW -> AWAITING_CONFIRM if needed.
     *   - Acquires row lock via Lot::findByIdForUpdate($lotId). Verifies existence and 'Available' status.
     *   - Validates schedule date (valid format, non-past, non-Monday).
     *   - Acquires next-key schedule range lock via Schedule::lockScheduleRangeForLot($lotId).
     *   - Checks slot conflict via Schedule::checkConflict($lotId, $date, $time). Throws 409 if conflict.
     *   - Creates or links decedent:
     *     - If deceased_id is present in extracted_data, links directly.
     *     - Else, provisions a decedent_requests row via DecedentRequest::create().
     *   - Inserts burial_schedules row via Schedule::create() with status 'Pending' (or Confirmed for admin/staff).
     *   - Atomically commits draft via BookingDraft::commit($draftId, $scheduleId, 'burial').
     *   - Records immutable audit log entries.
     * 
     * @param int         $draftId
     * @param int         $userId
     * @param string|null $username
     * @param mixed       $user User context array or null
     * @return array Standardized outcome payload.
     * @throws BookingDraftException
     */
    public function finalizeBurialDraft(int $draftId, int $userId, ?string $username = null, $user = null): array {
        $draft = $this->draftModel->requireOwnership($draftId, $userId);

        if ($draft['service_type'] !== 'burial') {
            throw new BookingDraftException(
                "Cannot finalize burial draft. Draft service type is '{$draft['service_type']}'.",
                'INVALID_SERVICE_TYPE',
                400
            );
        }

        if ($draft['status'] === BookingDraft::STATUS_COMMITTED) {
            throw new BookingDraftException(
                "Draft #{$draftId} has already been committed.",
                'DRAFT_ALREADY_COMMITTED',
                409
            );
        }

        if (BookingDraft::isTerminalState($draft['status'])) {
            throw new BookingDraftException(
                "Cannot finalize draft in terminal state '{$draft['status']}'.",
                'TERMINAL_STATE_MODIFICATION',
                400
            );
        }

        $extracted = !empty($draft['extracted_data']) ? json_decode($draft['extracted_data'], true) : [];
        $missing = $this->evaluateMissingFields('burial', $extracted);

        if (!empty($missing)) {
            throw new BookingDraftException(
                "Cannot finalize burial draft. Missing required fields: " . implode(', ', $missing),
                'INCOMPLETE_DRAFT',
                400
            );
        }

        $lotId = (int) ($extracted['lot_id'] ?? 0);
        $scheduleDateStr = (string) ($extracted['preferred_date'] ?? '');
        $scheduleTime = !empty($extracted['preferred_time']) ? (string) $extracted['preferred_time'] : null;

        if ($lotId <= 0) {
            throw new BookingDraftException("A valid lot_id is required to finalize burial booking.", 'MISSING_LOT', 400);
        }

        // Date validation check
        $dateValidation = $this->validateBookingDate($scheduleDateStr, true);
        if (!$dateValidation['valid']) {
            throw new BookingDraftException($dateValidation['error'] ?? 'Invalid booking date', 'INVALID_DATE', 400);
        }

        $userRole = strtolower(is_array($user) ? ($user['role'] ?? 'user') : 'user');

        try {
            $outcome = Database::getInstance()->transaction(function () use (
                $draftId, $draft, $userId, $username, $userRole, $extracted, $lotId, $scheduleDateStr, $scheduleTime
            ) {
                // 1. If currently in READY_FOR_REVIEW, step into AWAITING_CONFIRM
                if ($draft['status'] === BookingDraft::STATUS_READY_FOR_REVIEW) {
                    $this->draftModel->transitionStatus($draftId, BookingDraft::STATUS_AWAITING_CONFIRM);
                } elseif ($draft['status'] !== BookingDraft::STATUS_AWAITING_CONFIRM) {
                    // Try legal step-through to AWAITING_CONFIRM
                    if ($draft['status'] === BookingDraft::STATUS_LOT_SELECTION || $draft['status'] === BookingDraft::STATUS_COLLECTING_INFO) {
                        $this->draftModel->transitionStatus($draftId, BookingDraft::STATUS_READY_FOR_REVIEW);
                        $this->draftModel->transitionStatus($draftId, BookingDraft::STATUS_AWAITING_CONFIRM);
                    } else {
                        throw new BookingDraftException(
                            "Cannot commit draft from status '{$draft['status']}'. Draft must be in 'AWAITING_CONFIRM'.",
                            'INVALID_COMMIT_ATTEMPT',
                            400
                        );
                    }
                }

                // 2. Pessimistic Locking Read on Lot
                $lot = $this->lotModel->findByIdForUpdate($lotId);
                if (!$lot) {
                    throw new BookingDraftException("Lot #{$lotId} not found.", 'LOT_NOT_FOUND', 404);
                }
                if ($lot['status'] !== 'Available') {
                    throw new BookingDraftException("This lot is no longer available for booking", 'LOT_NOT_AVAILABLE', 409);
                }

                // 2.5 Active Lot Checkout Lease Check (Batch 10B)
                require_once __DIR__ . '/../models/Payment.php';
                $paymentModel = new Payment();
                $activeLease = $paymentModel->findActiveLotCheckoutLease($lotId, null, $userId);
                if ($activeLease) {
                    throw new BookingDraftException(
                        "This lot is currently held by an active checkout session in progress. Please try again later.",
                        'LOT_HELD_CHECKOUT',
                        409
                    );
                }

                // 3. Locking read for schedule slot
                $this->scheduleModel->lockScheduleRangeForLot($lotId);

                // 4. Conflict check
                $hasConflict = $this->scheduleModel->checkConflict($lotId, $scheduleDateStr, $scheduleTime);
                if ($hasConflict) {
                    throw new BookingDraftException("This lot is already booked for the selected date/time", 'LOT_ALREADY_BOOKED', 409);
                }

                // 5. Provisional or Existing Decedent Handling
                $deceasedId = !empty($extracted['deceased_id']) ? (int) $extracted['deceased_id'] : null;
                $decedentRequestId = null;

                if (!$deceasedId) {
                    $decedentRequestId = $this->decedentRequestModel->create([
                        'requested_by'    => $userId,
                        'full_name'       => $extracted['decedent_name'],
                        'relationship'    => $extracted['relationship'] ?? null,
                        'approximate_dod' => $extracted['approximate_dod'] ?? null,
                        'notes'           => 'Created via AI Booking Assistant Draft #' . $draftId,
                    ]);

                    if (!$decedentRequestId) {
                        throw new BookingDraftException("Failed to record provisional decedent information.", 'DECEDENT_CREATION_FAILED', 500);
                    }
                }

                // 6. Schedule Creation (Citizens forced to Pending)
                $scheduleStatus = 'Pending';
                $confirmedBy = null;
                if (in_array($userRole, ['admin', 'staff'], true) && !empty($extracted['status']) && $extracted['status'] === 'Confirmed') {
                    $scheduleStatus = 'Confirmed';
                    $confirmedBy = $userId;
                }

                $scheduleData = [
                    'lot_id'              => $lotId,
                    'deceased_id'         => $deceasedId,
                    'decedent_request_id' => $decedentRequestId,
                    'schedule_date'       => $scheduleDateStr,
                    'schedule_time'       => $scheduleTime,
                    'status'              => $scheduleStatus,
                    'notes'               => $extracted['notes'] ?? ('AI Booking Assistant Draft #' . $draftId),
                    'created_by'          => $userId,
                    'confirmed_by'        => $confirmedBy,
                ];

                $scheduleId = $this->scheduleModel->create($scheduleData);
                if (!$scheduleId) {
                    throw new BookingDraftException("Failed to create burial schedule record.", 'SCHEDULE_CREATION_FAILED', 500);
                }

                // 7. Atomic Draft Commitment
                $this->draftModel->commit($draftId, $scheduleId, 'burial');

                // 8. Immutable Audit Logging
                $this->auditLogModel->log(
                    'Schedule created',
                    $userId,
                    $username,
                    'Schedule',
                    $scheduleId,
                    [
                        'lot_id'         => $lotId,
                        'schedule_date'  => $scheduleDateStr,
                        'initial_status' => $scheduleStatus,
                        'draft_id'       => $draftId
                    ]
                );

                $this->auditLogModel->log(
                    'booking_draft.committed',
                    $userId,
                    $username,
                    'BookingDraft',
                    $draftId,
                    [
                        'schedule_id'  => $scheduleId,
                        'service_type' => 'burial'
                    ]
                );

                return [
                    'success'             => true,
                    'draft_id'            => $draftId,
                    'service_type'        => 'burial',
                    'status'              => BookingDraft::STATUS_COMMITTED,
                    'committed_record_id' => $scheduleId,
                    'schedule_id'         => $scheduleId,
                    'message'             => 'Burial reservation successfully finalized and scheduled.'
                ];
            });

            $paymentController = new PaymentController();
            $paymentUser = is_array($user) ? $user : ['user_id' => $userId, 'role' => $userRole];
            if (!isset($paymentUser['role'])) {
                $paymentUser['role'] = $userRole;
            }

            if (!empty($outcome['success']) && !empty($outcome['schedule_id'])) {
                $checkoutResult = $paymentController->createCheckoutSession([
                    'transaction_type' => 'Lot Purchase',
                    'reference_id' => (int) $outcome['schedule_id'],
                    'reference_kind' => 'schedule',
                ], $paymentUser);

                if (!empty($checkoutResult['payment_id'])) {
                    $outcome['payment_id'] = (int) $checkoutResult['payment_id'];
                }
                if (!empty($checkoutResult['checkout_session_id'])) {
                    $outcome['checkout_session_id'] = $checkoutResult['checkout_session_id'];
                }
                if (!empty($checkoutResult['checkout_url'])) {
                    $outcome['checkout_url'] = $checkoutResult['checkout_url'];
                }
                if (!empty($checkoutResult['gateway_status'])) {
                    $outcome['gateway_status'] = $checkoutResult['gateway_status'];
                }
                if (!empty($checkoutResult['receipt_number'])) {
                    $outcome['receipt_number'] = $checkoutResult['receipt_number'];
                }
                if (!empty($checkoutResult['amount'])) {
                    $outcome['amount'] = $checkoutResult['amount'];
                }
                if (!empty($checkoutResult['currency'])) {
                    $outcome['currency'] = $checkoutResult['currency'];
                }
                if (!empty($checkoutResult['code'])) {
                    $outcome['checkout_code'] = (int) $checkoutResult['code'];
                }
                if (!empty($checkoutResult['error'])) {
                    $outcome['checkout_error'] = $checkoutResult['error'];
                }
            }

            return $outcome;
        } catch (PDOException $e) {
            // Check for duplicate active slot key constraint
            if (($e->errorInfo[1] ?? null) === 1062 && strpos($e->getMessage(), 'uq_active_schedule_slot') !== false) {
                throw new BookingDraftException("This lot is already booked for the selected date/time", 'LOT_ALREADY_BOOKED', 409);
            }
            throw $e;
        }
    }

    /**
     * Safely finalize a cremation draft into the authoritative cremation_records table (BMS-8).
     * 
     * Enforces transactional boundary:
     * - Verifies draft ownership and service_type === 'cremation'.
     * - Validates 0 missing required fields ('service_type', 'decedent_name', 'cremation_date').
     * - Validates cremation date format and ensures it is not in the past (non-Monday rule disabled).
     * - Executes inside Database::transaction():
     *   - Transitions draft READY_FOR_REVIEW -> AWAITING_CONFIRM if needed.
     *   - Creates or links decedent:
     *     - If deceased_id is present in extracted_data, links directly.
     *     - Else, provisions a decedent_requests row via DecedentRequest::create().
     *   - Inserts cremation_records row via Cremation::create():
     *     - Citizens forced to 'Pending', niche unassigned (null).
     *     - preferred_columbarium mapped to columbarium.
     *     - Admin/staff can specify 'Scheduled' or 'Completed' status if provided.
     *   - Atomically commits draft via BookingDraft::commit($draftId, $cremationId, 'cremation').
     *   - Records immutable audit log entries for cremation and booking draft.
     * 
     * @param int         $draftId
     * @param int         $userId
     * @param string|null $username
     * @param mixed       $user User context array or null
     * @return array Standardized outcome payload.
     * @throws BookingDraftException
     */
    public function finalizeCremationDraft(int $draftId, int $userId, ?string $username = null, $user = null): array {
        $draft = $this->draftModel->requireOwnership($draftId, $userId);

        if ($draft['service_type'] !== 'cremation') {
            throw new BookingDraftException(
                "Cannot finalize cremation draft. Draft service type is '{$draft['service_type']}'.",
                'INVALID_SERVICE_TYPE',
                400
            );
        }

        if ($draft['status'] === BookingDraft::STATUS_COMMITTED) {
            throw new BookingDraftException(
                "Draft #{$draftId} has already been committed.",
                'DRAFT_ALREADY_COMMITTED',
                409
            );
        }

        if (BookingDraft::isTerminalState($draft['status'])) {
            throw new BookingDraftException(
                "Cannot finalize draft in terminal state '{$draft['status']}'.",
                'TERMINAL_STATE_MODIFICATION',
                400
            );
        }

        $extracted = !empty($draft['extracted_data']) ? json_decode($draft['extracted_data'], true) : [];
        $missing = $this->evaluateMissingFields('cremation', $extracted);

        if (!empty($missing)) {
            throw new BookingDraftException(
                "Cannot finalize cremation draft. Missing required fields: " . implode(', ', $missing),
                'INCOMPLETE_DRAFT',
                400
            );
        }

        $cremationDateStr = (string) ($extracted['cremation_date'] ?? '');

        // Date validation check (isBurial = false, Mondays are permitted for cremation)
        $dateValidation = $this->validateBookingDate($cremationDateStr, false);
        if (!$dateValidation['valid']) {
            throw new BookingDraftException($dateValidation['error'] ?? 'Invalid booking date', 'INVALID_DATE', 400);
        }

        $userRole = strtolower(is_array($user) ? ($user['role'] ?? 'user') : 'user');
        $isAdminOrStaff = in_array($userRole, ['admin', 'staff'], true);

        return Database::getInstance()->transaction(function () use (
            $draftId, $draft, $userId, $username, $isAdminOrStaff, $extracted, $cremationDateStr
        ) {
            // 1. If currently in READY_FOR_REVIEW, step into AWAITING_CONFIRM
            if ($draft['status'] === BookingDraft::STATUS_READY_FOR_REVIEW) {
                $this->draftModel->transitionStatus($draftId, BookingDraft::STATUS_AWAITING_CONFIRM);
            } elseif ($draft['status'] !== BookingDraft::STATUS_AWAITING_CONFIRM) {
                // Try legal step-through to AWAITING_CONFIRM
                if ($draft['status'] === BookingDraft::STATUS_CREMATION_PREFS || $draft['status'] === BookingDraft::STATUS_COLLECTING_INFO) {
                    $this->draftModel->transitionStatus($draftId, BookingDraft::STATUS_READY_FOR_REVIEW);
                    $this->draftModel->transitionStatus($draftId, BookingDraft::STATUS_AWAITING_CONFIRM);
                } else {
                    throw new BookingDraftException(
                        "Cannot commit draft from status '{$draft['status']}'. Draft must be in 'AWAITING_CONFIRM'.",
                        'INVALID_COMMIT_ATTEMPT',
                        400
                    );
                }
            }

            // 2. Provisional or Existing Decedent Handling
            $deceasedId = !empty($extracted['deceased_id']) ? (int) $extracted['deceased_id'] : null;
            $decedentRequestId = null;

            if (!$deceasedId) {
                $decedentRequestId = $this->decedentRequestModel->create([
                    'requested_by'    => $userId,
                    'full_name'       => $extracted['decedent_name'],
                    'relationship'    => $extracted['relationship'] ?? null,
                    'approximate_dod' => $extracted['approximate_dod'] ?? null,
                    'notes'           => 'Created via AI Booking Assistant Draft #' . $draftId,
                ]);

                if (!$decedentRequestId) {
                    throw new BookingDraftException("Failed to record provisional decedent information.", 'DECEDENT_CREATION_FAILED', 500);
                }
            }

            // 3. Status & Columbarium determination
            $status = 'Pending';
            if ($isAdminOrStaff && !empty($extracted['status']) && in_array($extracted['status'], ['Pending', 'Scheduled', 'Completed'], true)) {
                $status = $extracted['status'];
            }

            $columbarium = !empty($extracted['preferred_columbarium']) ? trim((string) $extracted['preferred_columbarium']) : null;
            if (empty($columbarium) && !empty($extracted['columbarium'])) {
                $columbarium = trim((string) $extracted['columbarium']);
            }

            $cremationData = [
                'deceased_id'          => $deceasedId,
                'decedent_request_id'  => $decedentRequestId,
                'niche_number'         => $isAdminOrStaff ? ($extracted['niche_number'] ?? null) : null,
                'columbarium'          => $columbarium,
                'level'                => $isAdminOrStaff && isset($extracted['level']) ? (int) $extracted['level'] : null,
                'cremation_date'       => $cremationDateStr,
                'status'               => $status,
                'ash_storage_location' => $extracted['ash_storage_location'] ?? null,
                'notes'                => $extracted['notes'] ?? ('AI Booking Assistant Draft #' . $draftId),
                'created_by'           => $userId,
            ];

            $cremationId = $this->cremationModel->create($cremationData);
            if (!$cremationId) {
                throw new BookingDraftException("Failed to create cremation record.", 'CREMATION_CREATION_FAILED', 500);
            }

            // 4. Atomic Draft Commitment
            $this->draftModel->commit($draftId, $cremationId, 'cremation');

            // 5. Immutable Audit Logging
            $this->auditLogModel->log(
                'Cremation record created',
                $userId,
                $username,
                'Cremation',
                $cremationId,
                [
                    'deceased_id'         => $deceasedId,
                    'decedent_request_id' => $decedentRequestId,
                    'cremation_date'      => $cremationDateStr,
                    'status'              => $status,
                    'columbarium'         => $columbarium,
                    'draft_id'            => $draftId
                ]
            );

            $this->auditLogModel->log(
                'booking_draft.committed',
                $userId,
                $username,
                'BookingDraft',
                $draftId,
                [
                    'cremation_id' => $cremationId,
                    'service_type' => 'cremation'
                ]
            );

            return [
                'success'             => true,
                'draft_id'            => $draftId,
                'service_type'        => 'cremation',
                'status'              => BookingDraft::STATUS_COMMITTED,
                'committed_record_id' => $cremationId,
                'cremation_id'        => $cremationId,
                'message'             => 'Cremation booking successfully finalized.'
            ];
        });
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
