<?php
/**
 * BookingActionRegistry
 * 
 * Controlled Action Registry for Booking Automation V2 (Batch 2).
 * 
 * Responsibilities:
 * 1. Defines allowed actions, field mutability matrix, and state guards.
 * 2. Normalizes semantic/natural language field references to canonical columns.
 * 3. Enforces execution-time ownership authorization and lifecycle status checks.
 * 4. Executes mutations inside atomic database transactions.
 * 5. Provides idempotency guards preventing redundant writes and duplicate audit entries.
 * 6. Generates standardized audit logs with source = 'AI_BOOKING_ASSISTANT'.
 * 7. Returns structured action results and human-friendly response messages.
 */

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/BookingDraft.php';

class BookingActionRegistry {
    // Action Identifiers
    public const ACTION_UPDATE_DRAFT_FIELD    = 'UPDATE_DRAFT_FIELD';
    public const ACTION_CORRECT_DRAFT_FIELD   = 'CORRECT_DRAFT_FIELD';
    public const ACTION_UPDATE_BOOKING_FIELD  = 'UPDATE_BOOKING_FIELD';
    public const ACTION_CORRECT_BOOKING_FIELD = 'CORRECT_BOOKING_FIELD';

    // Execution Statuses
    public const STATUS_EXECUTED                   = 'EXECUTED';
    public const STATUS_NO_CHANGE                  = 'NO_CHANGE';
    public const STATUS_DEFERRED                   = 'ACTION_DEFERRED';
    public const STATUS_CLARIFICATION_REQUIRED     = 'CLARIFICATION_REQUIRED';
    public const STATUS_NOT_ALLOWED_FOR_STATE      = 'ACTION_NOT_ALLOWED_FOR_STATE';
    public const STATUS_UNAUTHORIZED               = 'UNAUTHORIZED';
    public const STATUS_NOT_FOUND                  = 'NOT_FOUND';
    public const STATUS_INVALID_FIELD              = 'INVALID_FIELD';

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

    public function __construct(?PDO $db = null, ?AuditLog $auditLogModel = null) {
        $this->db = $db ?? Database::getInstance()->getConnection();
        $this->auditLogModel = $auditLogModel ?? new AuditLog();
    }

    /**
     * Normalize natural language / AI field names to canonical database column names.
     *
     * @param string|null $rawField
     * @param string      $message
     * @param array       $slots
     * @return array [canonical_field, category, is_ambiguous]
     */
    public function normalizeField(?string $rawField, string $message = '', array $slots = []): array {
        $msgLower = strtolower(trim($message));
        $fieldHint = strtolower(trim((string) ($rawField ?? ($slots['correction_field'] ?? ''))));

        // 1. Check for Category B Deferred Fields first
        if (
            in_array($fieldHint, ['schedule_date', 'preferred_date', 'cremation_date', 'target_date'], true)
            || preg_match('/\b(reschedule|move|postpone|change date|schedule to|move to|change my booking date|booking date)\b/i', $msgLower)
        ) {
            return [
                'canonical_field' => 'schedule_date',
                'category'        => 'CATEGORY_B',
                'is_ambiguous'    => false,
                'deferred_intent' => 'RESCHEDULE_BOOKING'
            ];
        }

        if (
            in_array($fieldHint, ['lot', 'lot_id', 'niche', 'columbarium', 'section', 'block'], true)
            || preg_match('/\b(change lot|different lot|switch lot|move lot|transfer lot)\b/i', $msgLower)
        ) {
            return [
                'canonical_field' => 'lot_id',
                'category'        => 'CATEGORY_B',
                'is_ambiguous'    => false,
                'deferred_intent' => 'CHANGE_ALLOCATION'
            ];
        }

        // 2. Category A: Safe Immediate Fields
        // A. Relationship
        if (
            $fieldHint === 'relationship'
            || preg_match('/\b(relationship|relasyon)\b/i', $msgLower)
            || preg_match('/\b(daughter|son|father|mother|brother|sister|spouse|wife|husband)\b/i', $msgLower)
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
        if (!empty($fieldHint) && in_array($fieldHint, self::CATEGORY_A_SAFE_FIELDS, true)) {
            return [
                'canonical_field' => $fieldHint,
                'category'        => 'CATEGORY_A',
                'is_ambiguous'    => false
            ];
        }

        // If generic correction without specific field (e.g. "Correct my information")
        return [
            'canonical_field' => null,
            'category'        => null,
            'is_ambiguous'    => true
        ];
    }

    /**
     * Extract the replacement value for a canonical field from slots or user message.
     *
     * @param string $canonicalField
     * @param array  $slots
     * @param string $message
     * @return mixed|null
     */
    public function extractReplacementValue(string $canonicalField, array $slots = [], string $message = '') {
        // Direct slot value check
        if (!empty($slots['corrected_value'])) {
            return trim((string) $slots['corrected_value']);
        }
        if (!empty($slots[$canonicalField])) {
            return is_string($slots[$canonicalField]) ? trim($slots[$canonicalField]) : $slots[$canonicalField];
        }

        // Regex heuristics based on field type
        switch ($canonicalField) {
            case 'relationship':
                if (preg_match('/\b(?:should be|it is|change to|to)\s+(son|daughter|father|mother|brother|sister|spouse|wife|husband|relative|friend)\b/i', $message, $m)) {
                    return ucfirst(strtolower($m[1]));
                }
                if (preg_match('/\b(son|daughter|father|mother|brother|sister|spouse|wife|husband)\b/i', $message, $m)) {
                    return ucfirst(strtolower($m[1]));
                }
                break;

            case 'decedent_name':
                // "Kevin Mando dapat." or "It should be Kevin Mando"
                if (preg_match('/([A-Z][a-zA-Z\.\s]{1,40})\s+dapat\b/i', $message, $m)) {
                    return trim($m[1]);
                }
                if (preg_match('/\b(?:should be|it is|actually|surname is|name is|to)\s+([A-Z][a-zA-Z\.\s]{1,40})/i', $message, $m)) {
                    $cand = trim($m[1]);
                    $cand = preg_replace('/\s+(?:not|instead|and|burial|cremation).*$/i', '', $cand);
                    return trim($cand);
                }
                break;

            case 'notes':
                if (preg_match('/\b(?:notes|remarks)\s*(?:should be|is|to|:)?\s*(.+)$/i', $message, $m)) {
                    return trim($m[1]);
                }
                break;

            case 'contact_number':
                if (preg_match('/(\+?[0-9\s\-]{7,15})/', $message, $m)) {
                    return trim($m[1]);
                }
                break;
        }

        return null;
    }

    /**
     * Dispatch and execute an action safely within the registry.
     *
     * @param int         $userId Authenticated user ID
     * @param string|null $username Authenticated username
     * @param string      $intent Extracted intent
     * @param array       $contextResolution Resolved context from Batch 1
     * @param array       $slots Extracted slots
     * @param string      $message Original user message
     * @return array Structured action result
     */
    public function dispatchAction(
        int $userId,
        ?string $username,
        string $intent,
        array $contextResolution,
        array $slots,
        string $message
    ): array {
        // 1. Verify Context Resolution
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

        // 2. Field Normalization
        $rawField = $slots['correction_field'] ?? ($slots['field'] ?? null);
        $norm = $this->normalizeField($rawField, $message, $slots);

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

        // 3. Dispatch based on Target Type
        if ($targetType === 'DRAFT' || $contextStatus === 'DRAFT') {
            $draftId = (int) ($contextResolution['draft_id'] ?? 0);
            return $this->executeDraftFieldUpdate(
                $userId,
                $username,
                $draftId,
                $canonicalField,
                $replacementValue,
                $intent
            );
        }

        if ($targetType === 'COMMITTED_BOOKING') {
            $bookingId = (int) ($contextResolution['booking_id'] ?? 0);
            $serviceType = $contextResolution['service_type'] ?? 'burial';
            $reference = $contextResolution['reference'] ?? "BUR-{$bookingId}";

            return $this->executeCommittedBookingFieldUpdate(
                $userId,
                $username,
                $bookingId,
                $serviceType,
                $reference,
                $canonicalField,
                $replacementValue,
                $intent
            );
        }

        return [
            'action_status' => self::STATUS_NOT_FOUND,
            'reply'         => 'Unable to resolve the target booking context for this update.',
            'action'        => null,
            'changes'       => []
        ];
    }

    /**
     * Execute a Safe Field Update on an Active Draft.
     *
     * @param int         $userId
     * @param string|null $username
     * @param int         $draftId
     * @param string      $field
     * @param mixed       $newValue
     * @param string      $intent
     * @return array
     */
    public function executeDraftFieldUpdate(
        int $userId,
        ?string $username,
        int $draftId,
        string $field,
        $newValue,
        string $intent
    ): array {
        $actionName = ($intent === 'CORRECT_BOOKING_DETAILS') ? self::ACTION_CORRECT_DRAFT_FIELD : self::ACTION_UPDATE_DRAFT_FIELD;

        // Authorize Draft Ownership
        $draftModel = new BookingDraft($this->db);
        $draft = $draftModel->findById($draftId);

        if (!$draft || (int)$draft['user_id'] !== $userId) {
            return [
                'action_status' => self::STATUS_UNAUTHORIZED,
                'reply'         => 'You are not authorized to modify this draft.',
                'action'        => [
                    'requested'   => $actionName,
                    'status'      => self::STATUS_UNAUTHORIZED,
                    'target_type' => 'DRAFT',
                    'target_id'   => $draftId
                ],
                'changes'       => []
            ];
        }

        // Terminal State Check for Draft
        if (BookingDraft::isTerminalState($draft['status'])) {
            return [
                'action_status' => self::STATUS_NOT_ALLOWED_FOR_STATE,
                'reply'         => "This draft is in terminal status ({$draft['status']}) and cannot be edited.",
                'action'        => [
                    'requested'   => $actionName,
                    'status'      => self::STATUS_NOT_ALLOWED_FOR_STATE,
                    'target_type' => 'DRAFT',
                    'target_id'   => $draftId
                ],
                'changes'       => []
            ];
        }

        $existingData = !empty($draft['extracted_data']) ? json_decode($draft['extracted_data'], true) : [];
        $oldValue = $existingData[$field] ?? null;

        // Idempotency Check: if identical, return NO_CHANGE
        if ((string)$oldValue === (string)$newValue) {
            return [
                'action_status' => self::STATUS_NO_CHANGE,
                'reply'         => "That {$field} is already set to '{$newValue}'.",
                'action'        => [
                    'requested'   => $actionName,
                    'status'      => self::STATUS_NO_CHANGE,
                    'target_type' => 'DRAFT',
                    'target_id'   => $draftId
                ],
                'changes'       => [],
                'draft_id'      => $draftId
            ];
        }

        // Mutate Draft Extracted Data
        $existingData[$field] = $newValue;
        $draftModel->updateExtractedData($draftId, [$field => $newValue]);

        // Audit Log
        $this->auditLogModel->log(
            'draft.field_updated',
            $userId,
            $username,
            'BookingDraft',
            $draftId,
            [
                'field'      => $field,
                'old_value'  => $oldValue,
                'new_value'  => $newValue,
                'source'     => 'AI_BOOKING_ASSISTANT',
                'action'     => $actionName
            ]
        );

        $friendlyField = str_replace('_', ' ', $field);
        return [
            'action_status' => self::STATUS_EXECUTED,
            'reply'         => "Done. I have updated the {$friendlyField} to '{$newValue}'.",
            'action'        => [
                'requested'   => $actionName,
                'status'      => self::STATUS_EXECUTED,
                'target_type' => 'DRAFT',
                'target_id'   => $draftId
            ],
            'changes'       => [
                [
                    'field'     => $field,
                    'old_value' => $oldValue,
                    'new_value' => $newValue
                ]
            ],
            'draft_id'      => $draftId,
            'updated_data'  => $existingData
        ];
    }

    /**
     * Execute a Safe Field Update on an Authorized Committed Booking.
     *
     * @param int         $userId
     * @param string|null $username
     * @param int         $bookingId
     * @param string      $serviceType
     * @param string      $reference
     * @param string      $field
     * @param mixed       $newValue
     * @param string      $intent
     * @return array
     */
    public function executeCommittedBookingFieldUpdate(
        int $userId,
        ?string $username,
        int $bookingId,
        string $serviceType,
        string $reference,
        string $field,
        $newValue,
        string $intent
    ): array {
        $actionName = ($intent === 'CORRECT_BOOKING_DETAILS') ? self::ACTION_CORRECT_BOOKING_FIELD : self::ACTION_UPDATE_BOOKING_FIELD;
        $isBurial = ($serviceType === 'burial');

        // Execute Inside Atomic Transaction
        return Database::getInstance()->transaction(function () use (
            $userId, $username, $bookingId, $serviceType, $reference, $field, $newValue, $actionName, $isBurial
        ) {
            // 1. Load and Lock Target Record with FOR UPDATE
            $table = $isBurial ? 'burial_schedules' : 'cremation_records';
            $pkCol = $isBurial ? 'schedule_id' : 'cremation_id';

            $stmt = $this->db->prepare("SELECT * FROM {$table} WHERE {$pkCol} = ? FOR UPDATE");
            $stmt->execute([$bookingId]);
            $record = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$record) {
                return [
                    'action_status' => self::STATUS_NOT_FOUND,
                    'reply'         => "Booking record {$reference} was not found.",
                    'action'        => [
                        'requested'   => $actionName,
                        'status'      => self::STATUS_NOT_FOUND,
                        'target_type' => 'COMMITTED_BOOKING',
                        'target_id'   => $bookingId,
                        'reference'   => $reference
                    ],
                    'changes'       => []
                ];
            }

            // 2. Authorize Ownership
            if ((int)$record['created_by'] !== $userId) {
                return [
                    'action_status' => self::STATUS_UNAUTHORIZED,
                    'reply'         => "You are not authorized to edit booking {$reference}.",
                    'action'        => [
                        'requested'   => $actionName,
                        'status'      => self::STATUS_UNAUTHORIZED,
                        'target_type' => 'COMMITTED_BOOKING',
                        'target_id'   => $bookingId,
                        'reference'   => $reference
                    ],
                    'changes'       => []
                ];
            }

            // 3. State Guard Validation
            $curStatus = strtolower(trim((string)$record['status']));
            if (in_array($curStatus, self::IMMUTABLE_COMMITTED_STATES, true)) {
                return [
                    'action_status' => self::STATUS_NOT_ALLOWED_FOR_STATE,
                    'reply'         => "This booking ({$reference}) can no longer be edited because it is in '{$record['status']}' status.",
                    'action'        => [
                        'requested'   => $actionName,
                        'status'      => self::STATUS_NOT_ALLOWED_FOR_STATE,
                        'target_type' => 'COMMITTED_BOOKING',
                        'target_id'   => $bookingId,
                        'reference'   => $reference
                    ],
                    'changes'       => []
                ];
            }

            if (!in_array($curStatus, self::ALLOWED_COMMITTED_STATES, true)) {
                return [
                    'action_status' => self::STATUS_NOT_ALLOWED_FOR_STATE,
                    'reply'         => "Booking {$reference} is currently '{$record['status']}' and cannot be modified.",
                    'action'        => [
                        'requested'   => $actionName,
                        'status'      => self::STATUS_NOT_ALLOWED_FOR_STATE,
                        'target_type' => 'COMMITTED_BOOKING',
                        'target_id'   => $bookingId,
                        'reference'   => $reference
                    ],
                    'changes'       => []
                ];
            }

            // 4. Determine Old Value & Apply Mutation based on Field Location
            $oldValue = null;
            $decedentRequestId = !empty($record['decedent_request_id']) ? (int)$record['decedent_request_id'] : null;
            $deceasedId = !empty($record['deceased_id']) ? (int)$record['deceased_id'] : null;

            if ($field === 'relationship') {
                if ($decedentRequestId) {
                    $dStmt = $this->db->prepare("SELECT relationship FROM decedent_requests WHERE request_id = ? FOR UPDATE");
                    $dStmt->execute([$decedentRequestId]);
                    $oldValue = $dStmt->fetchColumn() ?: null;

                    // Idempotency check
                    if ((string)$oldValue === (string)$newValue) {
                        return [
                            'action_status' => self::STATUS_NO_CHANGE,
                            'reply'         => "The relationship for booking {$reference} is already set to '{$newValue}'.",
                            'action'        => [
                                'requested'   => $actionName,
                                'status'      => self::STATUS_NO_CHANGE,
                                'target_type' => 'COMMITTED_BOOKING',
                                'target_id'   => $bookingId,
                                'reference'   => $reference
                            ],
                            'changes'       => []
                        ];
                    }

                    $upd = $this->db->prepare("UPDATE decedent_requests SET relationship = ? WHERE request_id = ?");
                    $upd->execute([$newValue, $decedentRequestId]);
                } else {
                    // Formal record doesn't have relationship column; store note in schedule
                    $oldValue = $record['notes'] ?? '';
                    $newNotes = trim(($record['notes'] ? $record['notes'] . " | " : "") . "Relationship: {$newValue}");
                    $upd = $this->db->prepare("UPDATE {$table} SET notes = ? WHERE {$pkCol} = ?");
                    $upd->execute([$newNotes, $bookingId]);
                }
            } elseif ($field === 'decedent_name') {
                if ($decedentRequestId) {
                    $dStmt = $this->db->prepare("SELECT full_name FROM decedent_requests WHERE request_id = ? FOR UPDATE");
                    $dStmt->execute([$decedentRequestId]);
                    $oldValue = $dStmt->fetchColumn() ?: null;

                    if ((string)$oldValue === (string)$newValue) {
                        return [
                            'action_status' => self::STATUS_NO_CHANGE,
                            'reply'         => "The decedent name for booking {$reference} is already set to '{$newValue}'.",
                            'action'        => [
                                'requested'   => $actionName,
                                'status'      => self::STATUS_NO_CHANGE,
                                'target_type' => 'COMMITTED_BOOKING',
                                'target_id'   => $bookingId,
                                'reference'   => $reference
                            ],
                            'changes'       => []
                        ];
                    }

                    $upd = $this->db->prepare("UPDATE decedent_requests SET full_name = ? WHERE request_id = ?");
                    $upd->execute([$newValue, $decedentRequestId]);
                } elseif ($deceasedId) {
                    $dStmt = $this->db->prepare("SELECT first_name, last_name FROM decedent_records WHERE decedent_id = ? FOR UPDATE");
                    $dStmt->execute([$deceasedId]);
                    $decRow = $dStmt->fetch(PDO::FETCH_ASSOC);
                    $oldValue = trim(($decRow['first_name'] ?? '') . ' ' . ($decRow['last_name'] ?? ''));

                    if ((string)$oldValue === (string)$newValue) {
                        return [
                            'action_status' => self::STATUS_NO_CHANGE,
                            'reply'         => "The decedent name for booking {$reference} is already set to '{$newValue}'.",
                            'action'        => [
                                'requested'   => $actionName,
                                'status'      => self::STATUS_NO_CHANGE,
                                'target_type' => 'COMMITTED_BOOKING',
                                'target_id'   => $bookingId,
                                'reference'   => $reference
                            ],
                            'changes'       => []
                        ];
                    }

                    // Split into first_name and last_name
                    $parts = preg_split('/\s+/', trim((string)$newValue), 2);
                    $firstName = $parts[0] ?? $newValue;
                    $lastName = $parts[1] ?? '';

                    $upd = $this->db->prepare("UPDATE decedent_records SET first_name = ?, last_name = ? WHERE decedent_id = ?");
                    $upd->execute([$firstName, $lastName, $deceasedId]);
                }
            } elseif ($field === 'notes') {
                $oldValue = $record['notes'] ?? null;
                if ((string)$oldValue === (string)$newValue) {
                    return [
                        'action_status' => self::STATUS_NO_CHANGE,
                        'reply'         => "The notes for booking {$reference} are already up to date.",
                        'action'        => [
                            'requested'   => $actionName,
                            'status'      => self::STATUS_NO_CHANGE,
                            'target_type' => 'COMMITTED_BOOKING',
                            'target_id'   => $bookingId,
                            'reference'   => $reference
                        ],
                        'changes'       => []
                    ];
                }

                $upd = $this->db->prepare("UPDATE {$table} SET notes = ? WHERE {$pkCol} = ?");
                $upd->execute([$newValue, $bookingId]);
            } elseif ($field === 'contact_number') {
                if ($deceasedId) {
                    $dStmt = $this->db->prepare("SELECT contact_number FROM decedent_records WHERE decedent_id = ? FOR UPDATE");
                    $dStmt->execute([$deceasedId]);
                    $oldValue = $dStmt->fetchColumn() ?: null;

                    if ((string)$oldValue === (string)$newValue) {
                        return [
                            'action_status' => self::STATUS_NO_CHANGE,
                            'reply'         => "The contact number for booking {$reference} is already set to '{$newValue}'.",
                            'action'        => [
                                'requested'   => $actionName,
                                'status'      => self::STATUS_NO_CHANGE,
                                'target_type' => 'COMMITTED_BOOKING',
                                'target_id'   => $bookingId,
                                'reference'   => $reference
                            ],
                            'changes'       => []
                        ];
                    }

                    $upd = $this->db->prepare("UPDATE decedent_records SET contact_number = ? WHERE decedent_id = ?");
                    $upd->execute([$newValue, $deceasedId]);
                } else {
                    $oldValue = $record['notes'] ?? '';
                    $newNotes = trim(($record['notes'] ? $record['notes'] . " | " : "") . "Contact: {$newValue}");
                    $upd = $this->db->prepare("UPDATE {$table} SET notes = ? WHERE {$pkCol} = ?");
                    $upd->execute([$newNotes, $bookingId]);
                }
            }

            // 5. Immutable Audit Trail
            $entityType = $isBurial ? 'burial_schedule' : 'cremation_record';
            $this->auditLogModel->log(
                'booking.field_updated',
                $userId,
                $username,
                $entityType,
                $bookingId,
                [
                    'booking_reference' => $reference,
                    'field'             => $field,
                    'old_value'         => $oldValue,
                    'new_value'         => $newValue,
                    'source'            => 'AI_BOOKING_ASSISTANT',
                    'action'            => $actionName
                ]
            );

            $friendlyField = str_replace('_', ' ', $field);
            return [
                'action_status' => self::STATUS_EXECUTED,
                'reply'         => "Done. I have updated the {$friendlyField} to '{$newValue}' for your booking {$reference}.",
                'action'        => [
                    'requested'   => $actionName,
                    'status'      => self::STATUS_EXECUTED,
                    'target_type' => 'COMMITTED_BOOKING',
                    'target_id'   => $bookingId,
                    'reference'   => $reference
                ],
                'changes'       => [
                    [
                        'field'     => $field,
                        'old_value' => $oldValue,
                        'new_value' => $newValue
                    ]
                ]
            ];
        });
    }
}
