<?php
/**
 * BookingActionRegistry
 * 
 * Controlled Action Registry for Booking Automation V2 (Batches 2 & 3).
 * 
 * Responsibilities:
 * 1. Defines allowed actions, field mutability matrix, and state guards.
 * 2. Normalizes semantic/natural language field references to canonical columns.
 * 3. Enforces execution-time ownership authorization and lifecycle status checks.
 * 4. Staging orchestrator for operational actions (Reschedule, Cancel, Allocation Change).
 * 5. Action-bound confirmation gate with cryptographic tokens and payload hashes.
 * 6. Execution-time revalidation: re-fetches rows, re-checks conflict, locks rows.
 * 7. Delegates domain mutations to dedicated domain services (BookingRescheduleService,
 *    BookingCancellationService, BookingAllocationService).
 * 8. Provides idempotency guards preventing redundant writes and duplicate audit entries.
 * 9. Emits standardized audit logs with source = 'AI_BOOKING_ASSISTANT'.
 * 10. Returns structured action results and human-friendly response messages.
 */

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/BookingDraft.php';
require_once __DIR__ . '/../models/BookingPendingAction.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/BookingRescheduleService.php';
require_once __DIR__ . '/BookingCancellationService.php';
require_once __DIR__ . '/BookingAllocationService.php';
require_once __DIR__ . '/BookingAvailabilityService.php';
require_once __DIR__ . '/BookingDateResolver.php';

class BookingActionRegistry {
    // Action Identifiers
    public const ACTION_UPDATE_DRAFT_FIELD    = 'UPDATE_DRAFT_FIELD';
    public const ACTION_CORRECT_DRAFT_FIELD   = 'CORRECT_DRAFT_FIELD';
    public const ACTION_UPDATE_BOOKING_FIELD  = 'UPDATE_BOOKING_FIELD';
    public const ACTION_CORRECT_BOOKING_FIELD = 'CORRECT_BOOKING_FIELD';
    public const ACTION_RESCHEDULE_BOOKING    = 'RESCHEDULE_BOOKING';
    public const ACTION_CANCEL_BOOKING        = 'CANCEL_BOOKING';
    public const ACTION_CHANGE_ALLOCATION     = 'CHANGE_ALLOCATION';

    // Execution Statuses
    public const STATUS_EXECUTED                   = 'EXECUTED';
    public const STATUS_NO_CHANGE                  = 'NO_CHANGE';
    public const STATUS_DEFERRED                   = 'ACTION_DEFERRED';
    public const STATUS_CLARIFICATION_REQUIRED     = 'CLARIFICATION_REQUIRED';
    public const STATUS_NOT_ALLOWED_FOR_STATE      = 'ACTION_NOT_ALLOWED_FOR_STATE';
    public const STATUS_UNAUTHORIZED               = 'UNAUTHORIZED';
    public const STATUS_NOT_FOUND                  = 'NOT_FOUND';
    public const STATUS_INVALID_FIELD              = 'INVALID_FIELD';
    public const STATUS_AWAITING_CONFIRMATION      = 'AWAITING_CONFIRMATION';
    public const STATUS_CONFIRMED                  = 'CONFIRMED';
    public const STATUS_EXECUTING                  = 'EXECUTING';
    public const STATUS_FAILED                     = 'FAILED';
    public const STATUS_REJECTED                   = 'REJECTED';
    public const STATUS_EXPIRED                    = 'EXPIRED';
    public const STATUS_SUPERSEDED                 = 'SUPERSEDED';
    public const STATUS_ALREADY_EXECUTED           = 'ACTION_ALREADY_EXECUTED';
    public const STATUS_IN_PROGRESS                = 'ACTION_IN_PROGRESS';

    // Field Mutability Categories
    public const CATEGORY_A_SAFE_FIELDS = [
        'decedent_name',
        'relationship',
        'notes',
        'contact_number'
    ];

    public const CATEGORY_B_DEFERRED_FIELDS = [
        'schedule_date',
        'schedule_time',
        'preferred_date',
        'cremation_date',
        'target_date',
        'lot_id',
        'niche_number',
        'columbarium',
        'service_type',
        'status',
        'payment_amount',
        'payment_status'
    ];

    // Allowed Lifecycle States for Committed Booking Modification
    public const ALLOWED_COMMITTED_STATES = [
        'pending',
        'confirmed',
        'scheduled'
    ];

    // Immutable Lifecycle States (historical / terminal)
    public const IMMUTABLE_COMMITTED_STATES = [
        'completed',
        'cancelled'
    ];

    private PDO $db;
    private AuditLog $auditLogModel;
    private BookingPendingAction $pendingActionModel;
    private BookingRescheduleService $rescheduleService;
    private BookingCancellationService $cancellationService;
    private BookingAllocationService $allocationService;
    private ?BookingAvailabilityService $availabilityService = null;

    public function __construct(
        ?PDO $db = null,
        ?AuditLog $auditLogModel = null,
        ?BookingPendingAction $pendingActionModel = null,
        ?BookingRescheduleService $rescheduleService = null,
        ?BookingCancellationService $cancellationService = null,
        ?BookingAllocationService $allocationService = null,
        ?BookingAvailabilityService $availabilityService = null
    ) {
        $this->db = $db ?? Database::getInstance()->getConnection();
        $this->auditLogModel = $auditLogModel ?? new AuditLog();
        $this->pendingActionModel = $pendingActionModel ?? new BookingPendingAction($this->db);
        $this->rescheduleService = $rescheduleService ?? new BookingRescheduleService($this->db, null, null, null, $this->auditLogModel);
        $this->cancellationService = $cancellationService ?? new BookingCancellationService($this->db, null, null, null, null, $this->auditLogModel);
        $this->allocationService = $allocationService ?? new BookingAllocationService($this->db, null, null, $this->auditLogModel);
        $this->availabilityService = $availabilityService;
    }

    public function getPendingActionModel(): BookingPendingAction {
        return $this->pendingActionModel;
    }

    public function getRescheduleService(): BookingRescheduleService {
        return $this->rescheduleService;
    }

    public function getCancellationService(): BookingCancellationService {
        return $this->cancellationService;
    }

    public function getAllocationService(): BookingAllocationService {
        return $this->allocationService;
    }

    public function getAvailabilityService(): BookingAvailabilityService {
        if ($this->availabilityService === null) {
            $this->availabilityService = new BookingAvailabilityService($this->db);
        }
        return $this->availabilityService;
    }

    /**
     * Normalize natural language / AI field names to canonical database column names.
     */
    public function normalizeField(?string $rawField, string $message = '', array $slots = [], ?string $targetType = null, ?string $serviceType = null): array {
        $msgLower = strtolower(trim($message));
        $fieldHint = strtolower(trim((string) ($rawField ?? ($slots['correction_field'] ?? ''))));

        $isDraft = ($targetType === 'DRAFT');

        // 1. Check Date Fields
        if (
            in_array($fieldHint, ['schedule_date', 'preferred_date', 'cremation_date', 'target_date', 'date'], true)
            || preg_match('/\b(reschedule|move|postpone|change date|schedule to|move to|change my booking date|change the date|booking date|burial date|cremation date)\b/i', $msgLower)
        ) {
            if ($isDraft) {
                $canonicalDate = (strtolower((string)$serviceType) === 'cremation') ? 'cremation_date' : 'preferred_date';
                return [
                    'canonical_field' => $canonicalDate,
                    'category'        => 'CATEGORY_A',
                    'is_ambiguous'    => false,
                    'deferred_intent' => null
                ];
            }

            return [
                'canonical_field' => 'schedule_date',
                'category'        => 'CATEGORY_B',
                'is_ambiguous'    => false,
                'deferred_intent' => 'RESCHEDULE_BOOKING'
            ];
        }

        // 2. Check Lot / Allocation Fields
        if (
            in_array($fieldHint, ['lot', 'lot_id', 'niche', 'columbarium', 'section', 'block'], true)
            || preg_match('/\b(change lot|different lot|switch lot|move lot|transfer lot|select lot|choose lot)\b/i', $msgLower)
        ) {
            if ($isDraft) {
                return [
                    'canonical_field' => 'lot_id',
                    'category'        => 'CATEGORY_A',
                    'is_ambiguous'    => false,
                    'deferred_intent' => null
                ];
            }

            return [
                'canonical_field' => 'lot_id',
                'category'        => 'CATEGORY_B',
                'is_ambiguous'    => false,
                'deferred_intent' => 'CHANGE_ALLOCATION'
            ];
        }

        // 3. Category A: Safe Immediate Fields
        // A. Relationship
        if (
            $fieldHint === 'relationship'
            || preg_match('/\b(relationship|relasyon)\b/i', $msgLower)
            || preg_match('/\b(daughter|son|father|mother|brother|sister|spouse|wife|husband|niece|nephew|aunt|uncle)\b/i', $msgLower)
        ) {
            return [
                'canonical_field' => 'relationship',
                'category'        => 'CATEGORY_A',
                'is_ambiguous'    => false
            ];
        }

        // B. Decedent Name
        if (
            $fieldHint === 'decedent_name'
            || preg_match('/\b(spelled|spelling|mispelled|misspelled|typo|surname|pangalan|dapat)\b/i', $msgLower)
            || preg_match('/\b(name is|surname is)\b/i', $msgLower)
        ) {
            return [
                'canonical_field' => 'decedent_name',
                'category'        => 'CATEGORY_A',
                'is_ambiguous'    => false
            ];
        }

        // C. Notes / Remarks
        if (
            $fieldHint === 'notes'
            || preg_match('/\b(notes|remarks|note|comment)\b/i', $msgLower)
        ) {
            return [
                'canonical_field' => 'notes',
                'category'        => 'CATEGORY_A',
                'is_ambiguous'    => false
            ];
        }

        // D. Contact Number
        if (
            $fieldHint === 'contact_number'
            || preg_match('/\b(contact|phone|mobile|telephone|cellphone)\b/i', $msgLower)
        ) {
            return [
                'canonical_field' => 'contact_number',
                'category'        => 'CATEGORY_A',
                'is_ambiguous'    => false
            ];
        }

        // Explicit slot detection fallback
        if (!empty($fieldHint) && (in_array($fieldHint, self::CATEGORY_A_SAFE_FIELDS, true) || ($isDraft && in_array($fieldHint, ['preferred_date', 'cremation_date', 'lot_id'], true)))) {
            return [
                'canonical_field' => $fieldHint,
                'category'        => 'CATEGORY_A',
                'is_ambiguous'    => false
            ];
        }

        // If generic correction without specific field
        return [
            'canonical_field' => null,
            'category'        => null,
            'is_ambiguous'    => true
        ];
    }

    /**
     * Extract replacement value for a canonical field.
     */
    public function extractReplacementValue(string $canonicalField, array $slots = [], string $message = '') {
        if (!empty($slots['corrected_value'])) {
            return trim((string) $slots['corrected_value']);
        }

        switch ($canonicalField) {
            case 'preferred_date':
            case 'cremation_date':
            case 'schedule_date':
            case 'target_date':
                if (!empty($slots['target_date'])) {
                    return trim((string)$slots['target_date']);
                }
                if (!empty($slots['preferred_date'])) {
                    return trim((string)$slots['preferred_date']);
                }
                if (!empty($slots['cremation_date'])) {
                    return trim((string)$slots['cremation_date']);
                }
                if (!empty($slots['schedule_date'])) {
                    return trim((string)$slots['schedule_date']);
                }
                $extracted = BookingDateResolver::extractDate($message);
                if ($extracted) {
                    return $extracted;
                }
                if (preg_match('/\b(20\d{2}-\d{2}-\d{2})\b/', $message, $m)) {
                    return $m[1];
                }
                break;

            case 'lot_id':
                if (!empty($slots['lot_id'])) {
                    return (int)$slots['lot_id'];
                }
                if (preg_match('/\b(?:lot\s+to|to\s+lot|lot)\s*(?:#|no\.?)?\s*([a-z0-9\-_]+)\b/i', $message, $m)) {
                    $cand = trim($m[1]);
                    if (!in_array(strtolower($cand), ['for', 'to', 'the', 'my', 'allocation', 'change', 'booking', 'reservation', 'a', 'an'], true)) {
                        if (is_numeric($cand)) {
                            return (int)$cand;
                        }
                        $stmt = $this->db->prepare("SELECT lot_id FROM lots WHERE lot_number = ? LIMIT 1");
                        $stmt->execute([$cand]);
                        $foundId = (int)$stmt->fetchColumn();
                        if ($foundId > 0) {
                            return $foundId;
                        }
                    }
                }
                if (preg_match('/^(\d+)\s+dapat(?:\.|\b)/iu', $message, $m)) {
                    return (int)$m[1];
                }
                break;

            case 'relationship':
                if (!empty($slots['relationship'])) {
                    return trim((string) $slots['relationship']);
                }
                if (preg_match('/\b(daughter|son|father|mother|brother|sister|spouse|wife|husband|niece|nephew|aunt|uncle|granddaughter|grandson)\b/i', $message, $m)) {
                    return ucfirst(strtolower($m[1]));
                }
                break;

            case 'decedent_name':
                if (!empty($slots['decedent_name'])) {
                    return trim((string) $slots['decedent_name']);
                }
                if (preg_match('/^(.+?)\s+dapat(?:\.|\b)/iu', $message, $m)) {
                    $cand = trim($m[1]);
                    if (str_word_count($cand) >= 1 && strlen($cand) >= 3) {
                        return $cand;
                    }
                }
                if (preg_match('/\b(?:name is actually|should be|name is|surname is)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)/i', $message, $m)) {
                    return trim($m[1]);
                }
                break;

            case 'contact_number':
                if (!empty($slots['contact_number'])) {
                    return trim((string) $slots['contact_number']);
                }
                if (preg_match('/(\+?63\d{10}|09\d{9})/', $message, $m)) {
                    return $m[1];
                }
                break;

            case 'notes':
                if (!empty($slots['notes'])) {
                    return trim((string) $slots['notes']);
                }
                if (preg_match('/\b(?:note|notes|remarks?):\s*(.+)$/i', $message, $m)) {
                    return trim($m[1]);
                }
                break;
        }

        return null;
    }

    /**
     * Main dispatch entry point.
     */
    public function dispatchAction(
        int $userId,
        ?string $username,
        string $intent,
        array $contextResolution,
        array $slots,
        string $message
    ): array {
        $contextStatus = $contextResolution['status'] ?? 'NO_ACTIVE_CONTEXT';
        $targetType = $contextResolution['type'] ?? null;

        if ($contextStatus === 'AMBIGUOUS') {
            return [
                'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                'reply'         => $contextResolution['message'] ?? 'You have multiple active bookings. Please specify which booking reference you would like to edit.',
                'candidates'    => $contextResolution['candidates'] ?? [],
                'action'        => null,
                'changes'       => []
            ];
        }

        if ($contextStatus === 'NOT_FOUND') {
            return [
                'action_status' => self::STATUS_NOT_FOUND,
                'reply'         => $contextResolution['reason'] ?? 'I could not find an active booking matching that reference on your account.',
                'action'        => null,
                'changes'       => []
            ];
        }

        if ($contextStatus === 'NO_ACTIVE_CONTEXT') {
            return [
                'action_status' => self::STATUS_NOT_FOUND,
                'reply'         => 'You do not currently have an active booking or draft to update.',
                'action'        => null,
                'changes'       => []
            ];
        }

        // Route Batch 3 Intent Actions
        if ($intent === self::ACTION_RESCHEDULE_BOOKING) {
            return $this->stageRescheduleAction($userId, $username, $contextResolution, $slots, $message);
        }

        if ($intent === self::ACTION_CANCEL_BOOKING) {
            return $this->stageCancelAction($userId, $username, $contextResolution, $slots, $message);
        }

        if ($intent === self::ACTION_CHANGE_ALLOCATION) {
            return $this->stageAllocationChangeAction($userId, $username, $contextResolution, $slots, $message);
        }

        // Generic Field Update & Correction (Batch 2)
        $rawField = $slots['correction_field'] ?? ($slots['field'] ?? null);
        $norm = $this->normalizeField($rawField, $message, $slots, $targetType, $contextResolution['service_type'] ?? null);

        // Check if Category B (Deferred to specialized batch actions)
        if ($norm['category'] === 'CATEGORY_B') {
            $deferredIntent = $norm['deferred_intent'] ?? 'RESCHEDULE_BOOKING';
            $field = $norm['canonical_field'];
            $reply = match ($field) {
                'schedule_date' => 'Rescheduling your booking date requires schedule confirmation. (Rescheduling execution is deferred to a specialized action).',
                'lot_id'        => 'Changing your lot allocation requires availability checks and approval. (Lot reassignment is deferred to a specialized action).',
                default         => 'Updating ' . str_replace('_', ' ', $field) . ' requires a specialized action.'
            };

            return [
                'action_status'   => self::STATUS_DEFERRED,
                'deferred_intent' => $deferredIntent,
                'deferred_field'  => $field,
                'reply'           => $reply,
                'action'          => [
                    'requested'   => ($targetType === 'DRAFT') ? self::ACTION_UPDATE_DRAFT_FIELD : self::ACTION_UPDATE_BOOKING_FIELD,
                    'status'      => self::STATUS_DEFERRED,
                    'target_type' => $targetType,
                    'target_id'   => ($targetType === 'DRAFT') ? ($contextResolution['draft_id'] ?? null) : ($contextResolution['booking_id'] ?? null)
                ],
                'changes'         => []
            ];
        }

        // Check for Ambiguous Field
        if ($norm['is_ambiguous'] || empty($norm['canonical_field'])) {
            return [
                'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                'reply'         => "I can update your booking, but which detail would you like to correct? (e.g. decedent name, relationship, contact number, or notes)",
                'action'        => null,
                'changes'       => []
            ];
        }

        $canonicalField = $norm['canonical_field'];
        $replacementValue = $this->extractReplacementValue($canonicalField, $slots, $message);

        if ($replacementValue === null || $replacementValue === '') {
            return [
                'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                'reply'         => "I understand you want to update the {$canonicalField}, but what should the new value be?",
                'action'        => null,
                'changes'       => []
            ];
        }

        // Dispatch Category A Field Updates
        if ($targetType === 'DRAFT' || $contextStatus === 'DRAFT') {
            $draftId = (int) ($contextResolution['draft_id'] ?? 0);
            if (in_array($canonicalField, ['preferred_date', 'cremation_date'], true)) {
                $serviceType = strtolower($contextResolution['service_type'] ?? 'burial');
                $isBurial = ($serviceType !== 'cremation');
                $dateVal = BookingDateResolver::validateBookingDate($replacementValue, $isBurial);
                if (!$dateVal['valid']) {
                    return [
                        'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                        'reply'         => $dateVal['error'],
                        'action'        => null,
                        'changes'       => []
                    ];
                }
            }
            return $this->executeDraftFieldUpdate(
                $userId,
                $username,
                $draftId,
                $canonicalField,
                $replacementValue,
                $contextResolution
            );
        }

        return $this->executeCommittedBookingFieldUpdate(
            $userId,
            $username,
            $contextResolution,
            $canonicalField,
            $replacementValue,
            $slots
        );
    }

    // =========================================================================
    // BATCH 3 — TRANSACTIONAL ACTION STAGING
    // =========================================================================

    /**
     * Stage RESCHEDULE_BOOKING action.
     */
    public function stageRescheduleAction(
        int $userId,
        ?string $username,
        array $contextResolution,
        array $slots,
        string $message
    ): array {
        $targetType = $contextResolution['type'] ?? 'COMMITTED_BOOKING';

        // Draft Reschedule: update draft directly
        if ($targetType === 'DRAFT') {
            $draftId = (int) ($contextResolution['draft_id'] ?? 0);
            $targetDate = $slots['target_date'] ?? $slots['preferred_date'] ?? $slots['cremation_date'] ?? null;
            if (!$targetDate) {
                $targetDate = BookingDateResolver::extractDate($message);
            }
            if (!$targetDate && preg_match('/\b(20\d{2}-\d{2}-\d{2})\b/', $message, $m)) {
                $targetDate = $m[1];
            }
            if (!$targetDate) {
                return [
                    'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                    'reply'         => 'What date would you like to set for your booking draft?',
                    'action'        => null,
                    'changes'       => []
                ];
            }

            $serviceType = strtolower($contextResolution['service_type'] ?? 'burial');
            $isBurial = ($serviceType !== 'cremation');
            $dateVal = BookingDateResolver::validateBookingDate($targetDate, $isBurial);
            if (!$dateVal['valid']) {
                return [
                    'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                    'reply'         => $dateVal['error'],
                    'action'        => null,
                    'changes'       => []
                ];
            }

            $dateField = ($serviceType === 'cremation') ? 'cremation_date' : 'preferred_date';
            return $this->executeDraftFieldUpdate($userId, $username, $draftId, $dateField, $targetDate, $contextResolution);
        }

        // Committed Booking Reschedule
        $bookingId = (int) ($contextResolution['booking_id'] ?? 0);
        $serviceType = strtolower($contextResolution['service_type'] ?? 'burial');
        $reference = $contextResolution['reference'] ?? "BUR-{$bookingId}";
        $rec = $contextResolution['record'] ?? [];
        $currentStatus = $contextResolution['current_status'] ?? ($rec['status'] ?? 'Pending');

        // Check terminal state
        if (in_array(strtolower($currentStatus), self::IMMUTABLE_COMMITTED_STATES, true)) {
            return [
                'action_status' => self::STATUS_NOT_ALLOWED_FOR_STATE,
                'reply'         => "Booking {$reference} is currently {$currentStatus} and cannot be rescheduled.",
                'action'        => [
                    'requested'   => self::ACTION_RESCHEDULE_BOOKING,
                    'status'      => self::STATUS_NOT_ALLOWED_FOR_STATE,
                    'target_type' => 'COMMITTED_BOOKING',
                    'target_id'   => $bookingId,
                    'reference'   => $reference
                ],
                'changes'       => []
            ];
        }

        // Extract target date
        $targetDate = $slots['target_date'] ?? $slots['preferred_date'] ?? $slots['cremation_date'] ?? null;
        if (!$targetDate) {
            $targetDate = BookingDateResolver::extractDate($message);
        }
        if (!$targetDate && preg_match('/\b(20\d{2}-\d{2}-\d{2})\b/', $message, $m)) {
            $targetDate = $m[1];
        }
        if (!$targetDate) {
            return [
                'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                'reply'         => "What date would you like to move booking {$reference} to?",
                'action'        => null,
                'changes'       => []
            ];
        }

        // Validate date
        $val = $this->rescheduleService->validateScheduleDate($targetDate, $serviceType);
        if (!$val['valid']) {
            return [
                'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                'reply'         => $val['error'],
                'action'        => null,
                'changes'       => []
            ];
        }
        $normalizedDate = $val['date'];
        $targetTime = $slots['schedule_time'] ?? ($rec['schedule_time'] ?? null);

        // Check idempotency
        $currentDate = $rec['schedule_date'] ?? null;
        if ($currentDate === $normalizedDate && (string)($rec['schedule_time'] ?? '') === (string)($targetTime ?? '')) {
            return [
                'action_status' => self::STATUS_NO_CHANGE,
                'reply'         => "Booking {$reference} is already scheduled for {$normalizedDate}.",
                'action'        => [
                    'requested'   => self::ACTION_RESCHEDULE_BOOKING,
                    'status'      => self::STATUS_NO_CHANGE,
                    'target_type' => 'COMMITTED_BOOKING',
                    'target_id'   => $bookingId,
                    'reference'   => $reference
                ],
                'changes'       => []
            ];
        }

        // Staging preliminary conflict check
        if ($serviceType === 'burial' && !empty($rec['lot_id'])) {
            $conflict = (new Schedule())->checkConflict((int)$rec['lot_id'], $normalizedDate, $targetTime);
            if ($conflict) {
                $altDates = $this->getAvailabilityService()->findAlternativeDates(
                    'burial',
                    $normalizedDate,
                    (int)$rec['lot_id'],
                    $targetTime
                );
                return [
                    'action_status'     => self::STATUS_NOT_ALLOWED_FOR_STATE,
                    'code'              => BookingAvailabilityService::CODE_SLOT_CONFLICT,
                    'reply'             => "The requested date {$normalizedDate} is not available for this lot. Please select another date.",
                    'action'            => null,
                    'changes'           => [],
                    'recovery'          => [
                        'alternative_dates' => $altDates
                    ],
                    'alternative_dates' => $altDates
                ];
            }
        }

        $payload = [
            'action_type'       => self::ACTION_RESCHEDULE_BOOKING,
            'booking_type'      => $serviceType,
            'booking_id'        => $bookingId,
            'booking_reference' => $reference,
            'old_date'          => $currentDate,
            'new_date'          => $normalizedDate,
            'old_time'          => $rec['schedule_time'] ?? null,
            'new_time'          => $targetTime,
        ];

        // Create pending action (supersedes any existing awaiting actions for this booking)
        $pending = $this->pendingActionModel->createPendingAction(
            $userId,
            $serviceType,
            $bookingId,
            self::ACTION_RESCHEDULE_BOOKING,
            $payload
        );

        $oldDateStr = $currentDate ? date('F j, Y', strtotime($currentDate)) : 'the current date';
        $newDateStr = date('F j, Y', strtotime($normalizedDate));
        $reply = "I found your {$serviceType} booking {$reference}. You want to move it from {$oldDateStr} to {$newDateStr}. Would you like me to proceed?";

        return [
            'action_status'     => self::STATUS_AWAITING_CONFIRMATION,
            'intent'            => self::ACTION_RESCHEDULE_BOOKING,
            'booking_reference' => $reference,
            'reply'             => $reply,
            'pending_action'    => $pending,
            'action'            => [
                'requested'   => self::ACTION_RESCHEDULE_BOOKING,
                'status'      => self::STATUS_AWAITING_CONFIRMATION,
                'target_type' => 'COMMITTED_BOOKING',
                'target_id'   => $bookingId,
                'reference'   => $reference,
                'pending_id'  => $pending['id'],
            ],
            'changes'           => []
        ];
    }

    /**
     * Stage CANCEL_BOOKING action.
     */
    public function stageCancelAction(
        int $userId,
        ?string $username,
        array $contextResolution,
        array $slots,
        string $message
    ): array {
        $targetType = $contextResolution['type'] ?? 'COMMITTED_BOOKING';

        // Draft Cancellation: cancel draft directly
        if ($targetType === 'DRAFT') {
            $draftId = (int) ($contextResolution['draft_id'] ?? 0);
            $draftModel = new BookingDraft();
            $draftModel->transitionStatus($draftId, BookingDraft::STATUS_CANCELLED);
            return [
                'action_status' => self::STATUS_EXECUTED,
                'reply'         => "Your active booking draft (#{$draftId}) has been cancelled.",
                'action'        => [
                    'requested'   => self::ACTION_CANCEL_BOOKING,
                    'status'      => self::STATUS_EXECUTED,
                    'target_type' => 'DRAFT',
                    'target_id'   => $draftId
                ],
                'changes'       => [['field' => 'status', 'old_value' => 'DRAFT', 'new_value' => 'CANCELLED']]
            ];
        }

        // Committed Booking Cancellation
        $bookingId = (int) ($contextResolution['booking_id'] ?? 0);
        $serviceType = strtolower($contextResolution['service_type'] ?? 'burial');
        $reference = $contextResolution['reference'] ?? "BUR-{$bookingId}";
        $rec = $contextResolution['record'] ?? [];
        $currentStatus = $contextResolution['current_status'] ?? ($rec['status'] ?? 'Pending');

        // Check if already cancelled (idempotency)
        if (strtolower($currentStatus) === 'cancelled') {
            return [
                'action_status' => self::STATUS_NO_CHANGE,
                'reply'         => "Booking {$reference} has already been cancelled.",
                'action'        => [
                    'requested'   => self::ACTION_CANCEL_BOOKING,
                    'status'      => self::STATUS_NO_CHANGE,
                    'target_type' => 'COMMITTED_BOOKING',
                    'target_id'   => $bookingId,
                    'reference'   => $reference
                ],
                'changes'       => []
            ];
        }

        // Check if completed (immutable)
        if (strtolower($currentStatus) === 'completed') {
            return [
                'action_status' => self::STATUS_NOT_ALLOWED_FOR_STATE,
                'reply'         => "Booking {$reference} is marked Completed and cannot be cancelled.",
                'action'        => [
                    'requested'   => self::ACTION_CANCEL_BOOKING,
                    'status'      => self::STATUS_NOT_ALLOWED_FOR_STATE,
                    'target_type' => 'COMMITTED_BOOKING',
                    'target_id'   => $bookingId,
                    'reference'   => $reference
                ],
                'changes'       => []
            ];
        }

        $hasVerifiedPayment = $this->cancellationService->hasVerifiedPayment($serviceType, $bookingId);

        $payload = [
            'action_type'            => self::ACTION_CANCEL_BOOKING,
            'booking_type'           => $serviceType,
            'booking_id'             => $bookingId,
            'booking_reference'      => $reference,
            'previous_status'        => $currentStatus,
            'refund_review_required' => $hasVerifiedPayment,
        ];

        $pending = $this->pendingActionModel->createPendingAction(
            $userId,
            $serviceType,
            $bookingId,
            self::ACTION_CANCEL_BOOKING,
            $payload
        );

        $dateStr = !empty($rec['schedule_date']) ? " scheduled for " . date('F j, Y', strtotime($rec['schedule_date'])) : "";
        $reply = "I found {$reference}{$dateStr}. Cancelling it may release the reserved schedule/resource. Do you want me to cancel this booking?";
        if ($hasVerifiedPayment) {
            $reply .= " (Note: This booking has a verified payment on file; cancellation preserves financial records and requires billing refund review).";
        }

        return [
            'action_status'     => self::STATUS_AWAITING_CONFIRMATION,
            'intent'            => self::ACTION_CANCEL_BOOKING,
            'booking_reference' => $reference,
            'reply'             => $reply,
            'pending_action'    => $pending,
            'action'            => [
                'requested'   => self::ACTION_CANCEL_BOOKING,
                'status'      => self::STATUS_AWAITING_CONFIRMATION,
                'target_type' => 'COMMITTED_BOOKING',
                'target_id'   => $bookingId,
                'reference'   => $reference,
                'pending_id'  => $pending['id'],
            ],
            'changes'           => []
        ];
    }

    /**
     * Stage CHANGE_ALLOCATION action.
     */
    public function stageAllocationChangeAction(
        int $userId,
        ?string $username,
        array $contextResolution,
        array $slots,
        string $message
    ): array {
        $targetType = $contextResolution['type'] ?? 'COMMITTED_BOOKING';

        if ($targetType === 'DRAFT') {
            $draftId = (int) ($contextResolution['draft_id'] ?? 0);
            $newLotId = !empty($slots['lot_id']) ? (int) $slots['lot_id'] : null;
            if (!$newLotId) {
                $newLotId = $this->extractReplacementValue('lot_id', $slots, $message);
            }
            if ($newLotId && $newLotId > 0) {
                $stmt = $this->db->prepare("SELECT lot_id FROM lots WHERE lot_id = ? LIMIT 1");
                $stmt->execute([(int)$newLotId]);
                if ($stmt->fetchColumn()) {
                    return $this->executeDraftFieldUpdate($userId, $username, $draftId, 'lot_id', (int)$newLotId, $contextResolution);
                }
            }
            return [
                'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                'reply'         => "Please specify which available lot number you would like to select for your booking draft.",
                'action'        => null,
                'changes'       => []
            ];
        }

        $bookingId = (int) ($contextResolution['booking_id'] ?? 0);
        $serviceType = strtolower($contextResolution['service_type'] ?? 'burial');
        $reference = $contextResolution['reference'] ?? "BUR-{$bookingId}";
        $rec = $contextResolution['record'] ?? [];
        $currentStatus = $contextResolution['current_status'] ?? ($rec['status'] ?? 'Pending');

        if ($serviceType !== 'burial') {
            return [
                'action_status' => self::STATUS_DEFERRED,
                'reply'         => "Niche reallocations for cremation bookings must be coordinated directly with administration.",
                'action'        => null,
                'changes'       => []
            ];
        }

        if (in_array(strtolower($currentStatus), self::IMMUTABLE_COMMITTED_STATES, true)) {
            return [
                'action_status' => self::STATUS_NOT_ALLOWED_FOR_STATE,
                'reply'         => "Booking {$reference} is currently {$currentStatus} and cannot have its allocation changed.",
                'action'        => null,
                'changes'       => []
            ];
        }

        // Check if user requested a specific lot
        $newLotId = !empty($slots['lot_id']) ? (int) $slots['lot_id'] : null;
        if (!$newLotId) {
            if (preg_match_all('/\b(?:lot\s+to|to\s+lot|lot)\s*(?:#|no\.?)?\s*([a-z0-9\-_]+)\b/i', $message, $matches)) {
                foreach ($matches[1] as $candidate) {
                    $cand = trim($candidate);
                    if (in_array(strtolower($cand), ['for', 'to', 'the', 'my', 'allocation', 'change', 'booking', 'reservation', 'a', 'an'], true)) {
                        continue;
                    }
                    // 1. Check against v_available_lots by lot_number
                    $stmt = $this->db->prepare("SELECT lot_id FROM v_available_lots WHERE lot_number = ? LIMIT 1");
                    $stmt->execute([$cand]);
                    $foundId = (int) $stmt->fetchColumn();
                    if ($foundId > 0) {
                        $newLotId = $foundId;
                        break;
                    }
                    // 2. Check against v_available_lots by lot_id
                    if (is_numeric($cand)) {
                        $stmt = $this->db->prepare("SELECT lot_id FROM v_available_lots WHERE lot_id = ? LIMIT 1");
                        $stmt->execute([(int) $cand]);
                        $foundId = (int) $stmt->fetchColumn();
                        if ($foundId > 0) {
                            $newLotId = $foundId;
                            break;
                        }
                    }
                    // 3. Fallback check against lots table
                    $stmt = $this->db->prepare("SELECT lot_id FROM lots WHERE lot_number = ? LIMIT 1");
                    $stmt->execute([$cand]);
                    $foundId = (int) $stmt->fetchColumn();
                    if ($foundId > 0) {
                        $newLotId = $foundId;
                        break;
                    }
                    if (is_numeric($cand)) {
                        $newLotId = (int) $cand;
                        break;
                    }
                }
            }
        }

        // Validate target lot
        $targetLot = $newLotId ? $this->allocationService->findAvailableLotById($newLotId) : null;

        // If no specific lot provided, query available lots from v_available_lots and prompt
        if (!$newLotId || !$targetLot) {
            $availableLots = $this->allocationService->getEligibleAvailableLots(null, 5);
            $optionsStr = [];
            foreach ($availableLots as $al) {
                $optionsStr[] = "Lot {$al['lot_number']} ({$al['section_name']}, Block {$al['block_name']})";
            }
            $lotsList = !empty($optionsStr) ? implode(', ', $optionsStr) : "contact administration";
            return [
                'action_status'  => self::STATUS_CLARIFICATION_REQUIRED,
                'reply'          => "Which lot would you like to reassign {$reference} to? Available options include: {$lotsList}.",
                'available_lots' => $availableLots,
                'action'         => null,
                'changes'        => []
            ];
        }

        $oldLotId = (int) ($rec['lot_id'] ?? 0);
        if ($oldLotId === $newLotId) {
            return [
                'action_status' => self::STATUS_NO_CHANGE,
                'reply'         => "Booking {$reference} is already allocated to Lot #{$newLotId}.",
                'action'        => null,
                'changes'       => []
            ];
        }

        $payload = [
            'action_type'       => self::ACTION_CHANGE_ALLOCATION,
            'booking_type'      => 'burial',
            'booking_id'        => $bookingId,
            'booking_reference' => $reference,
            'old_lot_id'        => $oldLotId,
            'new_lot_id'        => $newLotId,
            'new_lot_number'    => $targetLot['lot_number'],
        ];

        $pending = $this->pendingActionModel->createPendingAction(
            $userId,
            'burial',
            $bookingId,
            self::ACTION_CHANGE_ALLOCATION,
            $payload
        );

        $reply = "I found booking {$reference}. You want to reassign it to Lot #{$targetLot['lot_number']} ({$targetLot['section_name']}). Would you like me to proceed?";

        return [
            'action_status'     => self::STATUS_AWAITING_CONFIRMATION,
            'intent'            => self::ACTION_CHANGE_ALLOCATION,
            'booking_reference' => $reference,
            'reply'             => $reply,
            'pending_action'    => $pending,
            'action'            => [
                'requested'   => self::ACTION_CHANGE_ALLOCATION,
                'status'      => self::STATUS_AWAITING_CONFIRMATION,
                'target_type' => 'COMMITTED_BOOKING',
                'target_id'   => $bookingId,
                'reference'   => $reference,
                'pending_id'  => $pending['id'],
            ],
            'changes'           => []
        ];
    }

    // =========================================================================
    // BATCH 3 — EXECUTION-TIME REVALIDATION & CONFIRMATION GATE
    // =========================================================================

    /**
     * Action-bound Confirmation Route with Execution-Time Revalidation.
     */
    public function confirmPendingAction(
        int $pendingActionId,
        string $confirmationToken,
        $actor,
        ?int $expectedBookingId = null,
        ?string $expectedActionType = null
    ): array {
        $userId = is_array($actor) ? (int) ($actor['user_id'] ?? 0) : (int) $actor;

        try {
            return Database::getInstance()->transaction(function () use (
                $pendingActionId,
                $confirmationToken,
                $actor,
                $userId,
                $expectedBookingId,
                $expectedActionType
            ) {
                // 1. Lock pending action row
                $pending = $this->pendingActionModel->lockForUpdate($pendingActionId);
                if (!$pending) {
                    return ['success' => false, 'error' => 'Pending action not found', 'code' => 404];
                }

                // 2. Ownership check
                if ((int) $pending['user_id'] !== $userId) {
                    return ['success' => false, 'error' => 'You are not authorized to confirm this action', 'code' => 403];
                }

                // 3. Status checks
                if ($pending['status'] === self::STATUS_EXECUTED) {
                    return [
                        'success'       => true,
                        'action_status' => self::STATUS_ALREADY_EXECUTED,
                        'no_change'     => true,
                        'message'       => 'This action has already been executed.',
                        'code'          => 200
                    ];
                }

                if ($pending['status'] === self::STATUS_EXECUTING) {
                    return [
                        'success'       => false,
                        'action_status' => self::STATUS_IN_PROGRESS,
                        'error'         => 'This action is currently being executed by another process.',
                        'code'          => 409
                    ];
                }

                if ($pending['status'] === self::STATUS_SUPERSEDED) {
                    return [
                        'success'       => false,
                        'action_status' => self::STATUS_SUPERSEDED,
                        'error'         => 'This action has been superseded by a newer request and can no longer be executed.',
                        'code'          => 409
                    ];
                }

                // F-04: Explicit REJECTED state handling
                if ($pending['status'] === self::STATUS_REJECTED) {
                    return [
                        'success'       => false,
                        'action_status' => self::STATUS_REJECTED,
                        'error'         => 'This action has been rejected and cannot be executed.',
                        'code'          => 400
                    ];
                }

                if ($pending['status'] === self::STATUS_EXPIRED || !empty($pending['is_expired']) || strtotime($pending['expires_at']) <= time()) {
                    $this->pendingActionModel->markExpired($pendingActionId);
                    return [
                        'success'       => false,
                        'action_status' => self::STATUS_EXPIRED,
                        'error'         => 'This action confirmation has expired. Please make a new request.',
                        'code'          => 410
                    ];
                }

                if ($pending['status'] !== self::STATUS_AWAITING_CONFIRMATION) {
                    return [
                        'success'       => false,
                        'action_status' => $pending['status'],
                        'error'         => "Invalid action status: {$pending['status']}",
                        'code'          => 400
                    ];
                }

                // 4. Token verification
                if (!hash_equals($pending['confirmation_token'], $confirmationToken)) {
                    return ['success' => false, 'error' => 'Invalid confirmation token.', 'code' => 400];
                }

                // 5. Payload hash integrity verification
                $payload = $pending['payload'];
                $computedHash = BookingPendingAction::computePayloadHash($payload);
                if (!hash_equals($pending['payload_hash'], $computedHash)) {
                    return ['success' => false, 'error' => 'Action payload hash mismatch. Action has been tampered with.', 'code' => 400];
                }

                // F-03: Caller-asserted defense-in-depth parameter validations
                if ($expectedBookingId !== null && (int) $pending['booking_id'] !== (int) $expectedBookingId) {
                    return [
                        'success'       => false,
                        'action_status' => self::STATUS_FAILED,
                        'error'         => "Booking ID assertion mismatch: expected {$expectedBookingId}, action belongs to {$pending['booking_id']}.",
                        'code'          => 400
                    ];
                }

                if ($expectedActionType !== null && $pending['action_type'] !== $expectedActionType) {
                    return [
                        'success'       => false,
                        'action_status' => self::STATUS_FAILED,
                        'error'         => "Action type assertion mismatch: expected {$expectedActionType}, action is {$pending['action_type']}.",
                        'code'          => 400
                    ];
                }

                // 6. Transition to CONFIRMED -> EXECUTING
                $this->pendingActionModel->markConfirmed($pendingActionId);
                $this->pendingActionModel->markExecuting($pendingActionId);

                // 7. Execution-Time Revalidation & Domain Service Dispatch
                $actionType = $pending['action_type'];
                $bookingType = $pending['booking_type'];
                $bookingId = (int) $pending['booking_id'];
                $domainResult = null;

                if ($actionType === self::ACTION_RESCHEDULE_BOOKING) {
                    $newDate = $payload['new_date'] ?? null;
                    $newTime = $payload['new_time'] ?? null;
                    if ($bookingType === 'burial') {
                        $domainResult = $this->rescheduleService->rescheduleBurialSchedule($bookingId, $newDate, $newTime, $actor);
                    } else {
                        $domainResult = $this->rescheduleService->rescheduleCremationRecord($bookingId, $newDate, $actor);
                    }
                } elseif ($actionType === self::ACTION_CANCEL_BOOKING) {
                    if ($bookingType === 'burial') {
                        $domainResult = $this->cancellationService->cancelBurialSchedule($bookingId, $actor, 'Cancelled via AI Assistant');
                    } else {
                        $domainResult = $this->cancellationService->cancelCremationRecord($bookingId, $actor, 'Cancelled via AI Assistant');
                    }
                } elseif ($actionType === self::ACTION_CHANGE_ALLOCATION) {
                    $newLotId = (int) ($payload['new_lot_id'] ?? 0);
                    $domainResult = $this->allocationService->swapBurialLot($bookingId, $newLotId, $actor);
                } else {
                    $domainResult = ['success' => false, 'error' => "Unsupported action type {$actionType}", 'code' => 400];
                }

                // 8. Handle Domain Outcome
                if (empty($domainResult['success'])) {
                    $this->pendingActionModel->markFailed($pendingActionId);
                    $errorCode = $domainResult['code'] ?? 500;
                    $errorMsg = $domainResult['error'] ?? 'Domain execution failed';
                    $recovery = null;

                    // If slot or lot conflict occurred at execution time
                    if ($errorCode === 409 || str_contains(strtolower($errorMsg), 'already booked') || str_contains(strtolower($errorMsg), 'conflict')) {
                        if ($actionType === self::ACTION_RESCHEDULE_BOOKING) {
                            $altDates = $this->getAvailabilityService()->findAlternativeDates(
                                $bookingType,
                                $payload['new_date'] ?? date('Y-m-d'),
                                !empty($payload['lot_id']) ? (int) $payload['lot_id'] : null,
                                $payload['new_time'] ?? null
                            );
                            $recovery = ['alternative_dates' => $altDates];
                        } elseif ($actionType === self::ACTION_CHANGE_ALLOCATION) {
                            $altLots = $this->getAvailabilityService()->findAlternativeLots(
                                (int) ($payload['new_lot_id'] ?? 0)
                            );
                            $recovery = ['alternative_lots' => $altLots];
                        }
                    }

                    $failResp = [
                        'success'       => false,
                        'action_status' => self::STATUS_FAILED,
                        'code'          => ($errorCode === 409) ? BookingAvailabilityService::CODE_SLOT_CONFLICT : $errorCode,
                        'error'         => $errorMsg
                    ];
                    if ($recovery !== null) {
                        $failResp['recovery'] = $recovery;
                        if (!empty($recovery['alternative_dates'])) {
                            $failResp['alternative_dates'] = $recovery['alternative_dates'];
                        }
                        if (!empty($recovery['alternative_lots'])) {
                            $failResp['alternative_lots'] = $recovery['alternative_lots'];
                        }
                    }
                    return $failResp;
                }

                // 9. Mark permanently EXECUTED
                $this->pendingActionModel->markExecuted($pendingActionId);

                return array_merge([
                    'success'           => true,
                    'action_status'     => self::STATUS_EXECUTED,
                    'pending_action_id' => $pendingActionId,
                    'action_type'       => $actionType,
                    'reply'             => $domainResult['message'] ?? 'Action completed successfully.',
                    'code'              => 200
                ], $domainResult);
            });
        } catch (Throwable $t) {
            return ['success' => false, 'error' => 'Confirmation execution failed: ' . $t->getMessage(), 'code' => 500];
        }
    }

    /**
     * Explicitly reject a pending action.
     */
    public function rejectPendingAction(int $pendingActionId, $actor): array {
        $userId = is_array($actor) ? (int) ($actor['user_id'] ?? 0) : (int) $actor;

        $pending = $this->pendingActionModel->findById($pendingActionId);
        if (!$pending) {
            return ['success' => false, 'error' => 'Pending action not found', 'code' => 404];
        }

        if ((int) $pending['user_id'] !== $userId) {
            return ['success' => false, 'error' => 'Unauthorized', 'code' => 403];
        }

        if ($pending['status'] !== self::STATUS_AWAITING_CONFIRMATION) {
            return ['success' => false, 'error' => 'Action cannot be rejected in current status: ' . $pending['status'], 'code' => 400];
        }

        $this->pendingActionModel->markRejected($pendingActionId);

        return [
            'success'       => true,
            'action_status' => self::STATUS_REJECTED,
            'reply'         => 'Action cancelled. Your booking remains unchanged.',
            'code'          => 200
        ];
    }

    /**
     * Conversational Affirmative Fallback ("Yes", "Proceed", "Confirm").
     * Enforces all 5 strict safety criteria before confirming.
     */
    public function confirmConversationalPendingAction(int $userId, $actor, string $message, ?array $activeBookingContext = null): array {
        // Query all active pending actions for user
        $activeActions = $this->pendingActionModel->findAllActiveByUser($userId);

        if (empty($activeActions)) {
            return [
                'success'       => false,
                'action_status' => self::STATUS_NOT_FOUND,
                'reply'         => "You don't have any pending action awaiting confirmation.",
                'code'          => 404
            ];
        }

        // Criterion 1: Exactly ONE eligible pending action exists
        if (count($activeActions) > 1) {
            return [
                'success'       => false,
                'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                'reply'         => "You have multiple pending actions awaiting confirmation. Please use the confirm button on the specific action you wish to execute.",
                'code'          => 409
            ];
        }

        $pending = $activeActions[0];

        // Criterion 2: Belongs to active booking context (if context is present)
        if ($activeBookingContext && !empty($activeBookingContext['booking_id'])) {
            if ((int) $pending['booking_id'] !== (int) $activeBookingContext['booking_id']) {
                return [
                    'success'       => false,
                    'action_status' => self::STATUS_CLARIFICATION_REQUIRED,
                    'reply'         => "The pending action belongs to booking {$pending['booking_type']} #{$pending['booking_id']}. Please confirm if you wish to apply changes to that booking.",
                    'code'          => 409
                ];
            }
        }

        // Execute primary action-bound confirmation
        return $this->confirmPendingAction((int) $pending['id'], $pending['confirmation_token'], $actor);
    }

    // =========================================================================
    // BATCH 2 — SAFE METADATA EDITING
    // =========================================================================

    private function executeDraftFieldUpdate(
        int $userId,
        ?string $username,
        int $draftId,
        string $canonicalField,
        $replacementValue,
        array $contextResolution
    ): array {
        $draftModel = new BookingDraft();
        try {
            $draft = $draftModel->requireOwnership($draftId, $userId);
        } catch (BookingDraftException $e) {
            return [
                'action_status' => self::STATUS_NOT_FOUND,
                'reply'         => $e->getMessage(),
                'action'        => null,
                'changes'       => []
            ];
        }

        $extractedData = !empty($draft['extracted_data']) ? json_decode($draft['extracted_data'], true) : [];
        $oldValue = $extractedData[$canonicalField] ?? null;

        if ((string) $oldValue === (string) $replacementValue) {
            return [
                'action_status' => self::STATUS_NO_CHANGE,
                'draft_id'      => $draftId,
                'reply'         => "The {$canonicalField} is already set to '{$replacementValue}'.",
                'action'        => [
                    'requested'   => self::ACTION_UPDATE_DRAFT_FIELD,
                    'status'      => self::STATUS_NO_CHANGE,
                    'target_type' => 'DRAFT',
                    'target_id'   => $draftId
                ],
                'changes'       => []
            ];
        }

        $draftModel->updateExtractedData($draftId, [$canonicalField => $replacementValue]);

        return [
            'action_status' => self::STATUS_EXECUTED,
            'draft_id'      => $draftId,
            'reply'         => "Updated " . str_replace('_', ' ', $canonicalField) . " to '{$replacementValue}'.",
            'action'        => [
                'requested'   => self::ACTION_UPDATE_DRAFT_FIELD,
                'status'      => self::STATUS_EXECUTED,
                'target_type' => 'DRAFT',
                'target_id'   => $draftId
            ],
            'changes'       => [
                [
                    'field'     => $canonicalField,
                    'old_value' => $oldValue,
                    'new_value' => $replacementValue
                ]
            ]
        ];
    }

    private function executeCommittedBookingFieldUpdate(
        int $userId,
        ?string $username,
        array $contextResolution,
        string $canonicalField,
        $replacementValue,
        array $slots
    ): array {
        $bookingId = (int) ($contextResolution['booking_id'] ?? 0);
        $serviceType = $contextResolution['service_type'] ?? 'burial';
        $reference = $contextResolution['reference'] ?? "BUR-{$bookingId}";
        $rec = $contextResolution['record'] ?? [];
        $currentStatus = $contextResolution['current_status'] ?? ($rec['status'] ?? 'Pending');

        if (in_array(strtolower($currentStatus), self::IMMUTABLE_COMMITTED_STATES, true)) {
            return [
                'action_status' => self::STATUS_NOT_ALLOWED_FOR_STATE,
                'reply'         => "Booking {$reference} is {$currentStatus} and cannot be modified.",
                'action'        => [
                    'requested'   => self::ACTION_CORRECT_BOOKING_FIELD,
                    'status'      => self::STATUS_NOT_ALLOWED_FOR_STATE,
                    'target_type' => 'COMMITTED_BOOKING',
                    'target_id'   => $bookingId,
                    'reference'   => $reference
                ],
                'changes'       => []
            ];
        }

        try {
            return Database::getInstance()->transaction(function () use ($userId, $username, $bookingId, $serviceType, $reference, $canonicalField, $replacementValue) {
                if ($serviceType === 'burial') {
                    $stmt = $this->db->prepare("SELECT * FROM burial_schedules WHERE schedule_id = ? FOR UPDATE");
                    $stmt->execute([$bookingId]);
                    $lockedBooking = $stmt->fetch();
                } else {
                    $stmt = $this->db->prepare("SELECT * FROM cremation_records WHERE cremation_id = ? FOR UPDATE");
                    $stmt->execute([$bookingId]);
                    $lockedBooking = $stmt->fetch();
                }

                if (!$lockedBooking) {
                    return [
                        'action_status' => self::STATUS_NOT_FOUND,
                        'reply'         => "Booking {$reference} could not be located.",
                        'action'        => null,
                        'changes'       => []
                    ];
                }

                $oldValue = null;
                $updated = false;

                if (in_array($canonicalField, ['decedent_name', 'relationship', 'contact_number'], true)) {
                    $decReqId = (int) ($lockedBooking['decedent_request_id'] ?? 0);
                    if ($decReqId > 0) {
                        $drStmt = $this->db->prepare("SELECT * FROM decedent_requests WHERE request_id = ? FOR UPDATE");
                        $drStmt->execute([$decReqId]);
                        $lockedDecReq = $drStmt->fetch();

                        if ($lockedDecReq) {
                            $targetCol = ($canonicalField === 'decedent_name') ? 'full_name' : $canonicalField;
                            $oldValue = $lockedDecReq[$targetCol] ?? null;

                            if ((string) $oldValue === (string) $replacementValue) {
                                return [
                                    'action_status' => self::STATUS_NO_CHANGE,
                                    'reply'         => "The {$canonicalField} is already set to '{$replacementValue}'.",
                                    'action'        => [
                                        'requested'   => self::ACTION_CORRECT_BOOKING_FIELD,
                                        'status'      => self::STATUS_NO_CHANGE,
                                        'target_type' => 'COMMITTED_BOOKING',
                                        'target_id'   => $bookingId,
                                        'reference'   => $reference
                                    ],
                                    'changes'       => []
                                ];
                            }

                            $updDr = $this->db->prepare("UPDATE decedent_requests SET {$targetCol} = ? WHERE request_id = ?");
                            $updated = $updDr->execute([$replacementValue, $decReqId]);
                        }
                    }
                } elseif ($canonicalField === 'notes') {
                    $oldValue = $lockedBooking['notes'] ?? null;
                    if ((string) $oldValue === (string) $replacementValue) {
                        return [
                            'action_status' => self::STATUS_NO_CHANGE,
                            'reply'         => "The notes are already set to '{$replacementValue}'.",
                            'action'        => [
                                'requested'   => self::ACTION_CORRECT_BOOKING_FIELD,
                                'status'      => self::STATUS_NO_CHANGE,
                                'target_type' => 'COMMITTED_BOOKING',
                                'target_id'   => $bookingId,
                                'reference'   => $reference
                            ],
                            'changes'       => []
                        ];
                    }

                    $targetTable = ($serviceType === 'burial') ? 'burial_schedules' : 'cremation_records';
                    $idCol = ($serviceType === 'burial') ? 'schedule_id' : 'cremation_id';
                    $updNote = $this->db->prepare("UPDATE {$targetTable} SET notes = ? WHERE {$idCol} = ?");
                    $updated = $updNote->execute([$replacementValue, $bookingId]);
                }

                if (!$updated) {
                    return [
                        'action_status' => self::STATUS_NO_CHANGE,
                        'reply'         => "Could not update {$canonicalField} on booking {$reference}.",
                        'action'        => null,
                        'changes'       => []
                    ];
                }

                $this->auditLogModel->log(
                    'booking.field_updated',
                    $userId,
                    $username,
                    ($serviceType === 'burial') ? 'Schedule' : 'Cremation',
                    $bookingId,
                    [
                        'field'     => $canonicalField,
                        'old_value' => $oldValue,
                        'new_value' => $replacementValue,
                        'source'    => 'AI_BOOKING_ASSISTANT'
                    ]
                );

                return [
                    'action_status' => self::STATUS_EXECUTED,
                    'reply'         => "Updated {$canonicalField} to '{$replacementValue}' for booking {$reference}.",
                    'action'        => [
                        'requested'   => self::ACTION_CORRECT_BOOKING_FIELD,
                        'status'      => self::STATUS_EXECUTED,
                        'target_type' => 'COMMITTED_BOOKING',
                        'target_id'   => $bookingId,
                        'reference'   => $reference
                    ],
                    'changes'       => [
                        [
                            'field'     => $canonicalField,
                            'old_value' => $oldValue,
                            'new_value' => $replacementValue
                        ]
                    ]
                ];
            });
        } catch (Throwable $t) {
            return [
                'action_status' => self::STATUS_NO_CHANGE,
                'reply'         => "Transaction failed: " . $t->getMessage(),
                'action'        => null,
                'changes'       => []
            ];
        }
    }
}
