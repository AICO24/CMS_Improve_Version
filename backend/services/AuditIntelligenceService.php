<?php
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/SystemException.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/../models/Relocation.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/ExpirationRecord.php';
require_once __DIR__ . '/../models/DecedentRequest.php';

// AI-1: Audit Intelligence / Context Retrieval Layer.
//
// READ ONLY. Assembles a structured, authoritative context bundle for a
// single entity (current state + related records + a correlated audit/
// exception timeline) so the existing AI service can explain it. This
// class decides what data exists and what's related — using only existing
// models' read methods (findAll/findById), never new SQL of its own, never
// a write path. The AI itself never queries the database and never decides
// what it's allowed to see; see AiController::explainEntity().
//
// Correlation here follows the AI-1 audit report's Section 4 findings exactly:
// there are no foreign keys tying audit_logs/system_exceptions to the
// entities they describe, or tying payments to the record they paid for
// (payments.reference_id is resolved by type, not a real FK) - so every
// lookup below mirrors the exact resolution order the existing controllers
// already use (see PaymentController::resolveExpectedAmount() for the
// schedule-then-lot fallback this class' resolvePaymentReference() copies).
class AuditIntelligenceService {
    // System-Wide AI Assistant (Phase 1): 'Expiration' and 'DecedentRequest'
    // added here — the original AI-1 audit flagged decedent-request audit
    // coverage as "unconfirmed" and left Expiration out entirely (no lease
    // was explainable at all). Both now have real fetchCurrentState()/
    // fetchRelatedRecords() cases below, so the gap is closed, not just
    // widened.
    private const SUPPORTED_TYPES = ['Schedule', 'Payment', 'Lot', 'Cremation', 'Relocation', 'Expiration', 'DecedentRequest'];

    private $auditLogModel;
    private $exceptionModel;
    private $scheduleModel;
    private $paymentModel;
    private $lotModel;
    private $cremationModel;
    private $relocationModel;
    private $decedentModel;
    private $expirationModel;
    private $decedentRequestModel;

    public function __construct() {
        $this->auditLogModel = new AuditLog();
        $this->exceptionModel = new SystemException();
        $this->scheduleModel = new Schedule();
        $this->paymentModel = new Payment();
        $this->lotModel = new Lot();
        $this->cremationModel = new Cremation();
        $this->relocationModel = new Relocation();
        $this->decedentModel = new Decedent();
        $this->expirationModel = new ExpirationRecord();
        $this->decedentRequestModel = new DecedentRequest();
    }

    public static function isSupportedType($entityType) {
        return in_array($entityType, self::SUPPORTED_TYPES, true);
    }

    // Returns either a full context array (see shape below) or
    // ['error' => ..., 'code' => ...] on failure - mirrors every existing
    // controller's own return convention in this codebase.
    public function buildContext($entityType, $entityId) {
        if (!self::isSupportedType($entityType)) {
            return ['error' => 'Unsupported entity type for AI context', 'code' => 400];
        }

        $entityId = (int) $entityId;
        if ($entityId <= 0) {
            return ['error' => 'A valid entity_id is required', 'code' => 400];
        }

        $currentState = $this->fetchCurrentState($entityType, $entityId);
        if (!$currentState) {
            return ['error' => ucfirst(strtolower($entityType)) . ' not found', 'code' => 404];
        }

        $related = $this->fetchRelatedRecords($entityType, $entityId, $currentState);

        // A Schedule/Payment/Cremation/Relocation action frequently cascades
        // into a Lot status change logged under a SEPARATE entity_type/
        // entity_id (see the audit report Section 4.3) - pull that Lot's own
        // timeline too, when one is known, so "why is the lot reserved"
        // shows up alongside "why is the schedule pending".
        $relatedLotId = $entityType === 'Lot' ? null : ($related['lot']['lot_id'] ?? null);

        $auditEvents = $this->auditLogModel->findAll(['entity_type' => $entityType, 'entity_id' => $entityId], 100, 0);
        $lotAuditEvents = $relatedLotId
            ? $this->auditLogModel->findAll(['entity_type' => 'Lot', 'entity_id' => (int) $relatedLotId], 100, 0)
            : [];

        $exceptions = $this->exceptionModel->findAll(['entity_type' => $entityType, 'entity_id' => $entityId]);
        $lotExceptions = $relatedLotId
            ? $this->exceptionModel->findAll(['entity_type' => 'Lot', 'entity_id' => (int) $relatedLotId])
            : [];

        $allAuditEvents = array_merge($auditEvents, $lotAuditEvents);
        $allExceptions = array_merge($exceptions, $lotExceptions);

        return [
            'subject' => ['type' => $entityType, 'id' => $entityId],
            'current_state' => $currentState,
            'related_records' => $related,
            'timeline' => $this->buildTimeline($allAuditEvents),
            'exceptions' => array_map([$this, 'summarizeException'], $allExceptions),
            'source_refs' => [
                'audit_log_ids' => array_map('intval', array_column($allAuditEvents, 'log_id')),
                'exception_ids' => array_map('intval', array_column($allExceptions, 'exception_id')),
            ],
        ];
    }

    // AI-2 Round 2: the aggregate counterpart to buildContext() above. That
    // method assembles everything about ONE entity for an admin who already
    // picked a record to inspect; this assembles a system-wide snapshot so
    // the dashboard can show a short written briefing on load, with nothing
    // to click first — the concrete difference between an on-call narrator
    // and a proactive "second admin". Same rules as buildContext(): existing
    // models' read methods only, no new SQL, no write path, and the result
    // is already fact-shaped (counts/reasons/enums only, never a name) so no
    // separate toFacts() step is needed before handing it to the LLM leg.
    public function buildDashboardFacts() {
        $openExceptions = $this->exceptionModel->findAll(['status' => 'open']);
        $exceptionsByType = [];
        foreach ($openExceptions as $exception) {
            $type = $exception['entity_type'] ?? 'Unknown';
            $exceptionsByType[$type] = ($exceptionsByType[$type] ?? 0) + 1;
        }
        // findAll() orders newest-first, so the last element is the oldest
        // still-open one - the most actionable to call out by itself, since
        // it's been waiting the longest.
        $oldestOpen = !empty($openExceptions) ? end($openExceptions) : null;

        // Automated-vs-manual split over a recent window, using the same
        // actor==='automation-engine' signal buildTimeline() already relies
        // on - a quick "is the automation actually carrying its share of the
        // load" signal, not a full per-entity timeline.
        $sinceDate = date('Y-m-d', strtotime('-7 days'));
        $recentLogs = $this->auditLogModel->findAll(['date_from' => $sinceDate], 500, 0);
        $automatedCount = 0;
        $manualCount = 0;
        foreach ($recentLogs as $log) {
            $details = !empty($log['details']) ? json_decode($log['details'], true) : null;
            $isAutomated = is_array($details) && ($details['actor'] ?? null) === 'automation-engine';
            if ($isAutomated) {
                $automatedCount++;
            } else {
                $manualCount++;
            }
        }

        return [
            'open_exceptions' => [
                'total' => count($openExceptions),
                'by_entity_type' => $exceptionsByType,
                'oldest_open' => $oldestOpen ? [
                    'event' => $oldestOpen['event'] ?? null,
                    'entity_type' => $oldestOpen['entity_type'] ?? null,
                    'reason' => $oldestOpen['reason'] ?? null,
                    'created_at' => $oldestOpen['created_at'] ?? null,
                ] : null,
            ],
            'recent_activity' => [
                'window_days' => 7,
                'automated_actions' => $automatedCount,
                'manual_actions' => $manualCount,
            ],
            'leases_expiring_within_30_days' => $this->expirationModel->countExpiringSoon(30),
            'generated_at' => date('c'),
        ];
    }

    // System-Wide AI Assistant (Phase 1): the middle ground between
    // buildContext() (one record) and buildDashboardFacts() (the whole
    // system) - recent records + open exceptions for ONE module, for when
    // the assistant is opened from a module page (e.g. Expiration
    // Monitoring) with no single record selected yet. Name-free by
    // construction (id + status only, same rule toFacts() already applies)
    // rather than needing a separate stripping step.
    private const MODULE_EXCEPTION_TYPES = [
        'Schedule' => ['Schedule'],
        'Relocation' => ['Relocation'],
        'Cremation' => ['Cremation', 'Decedent'],
        'Expiration' => ['Expiration'],
        'Decedent' => ['Decedent', 'Cremation'],
        'DecedentRequest' => ['DecedentRequest'],
        // 'Payment' and 'Lot' added so Payments/Lot Management can mount a
        // page-level assistant too, not just the per-record one in their
        // view modal — a module page with no exception-type scope of its
        // own previously couldn't be given one at all.
        'Payment' => ['Payment'],
        'Lot' => ['Lot'],
        // null = every open exception, for the Audit Logs page's
        // deliberately cross-cutting view - it has no single entity_type of
        // its own to scope to.
        'AuditLog' => null,
    ];

    public function buildModuleContext($module) {
        if (!array_key_exists($module, self::MODULE_EXCEPTION_TYPES)) {
            return ['error' => 'Unsupported module', 'code' => 400];
        }

        $modelByModule = [
            'Schedule' => $this->scheduleModel,
            'Relocation' => $this->relocationModel,
            'Cremation' => $this->cremationModel,
            'Expiration' => $this->expirationModel,
            'Decedent' => $this->decedentModel,
            'Payment' => $this->paymentModel,
            'Lot' => $this->lotModel,
        ];

        $records = [];
        if ($module === 'DecedentRequest') {
            $records = $this->decedentRequestModel->findAll();
        } elseif (isset($modelByModule[$module])) {
            $records = $modelByModule[$module]->findAll([]);
        }

        $statusCounts = [];
        foreach ($records as $record) {
            $status = $this->extractStatus($record) ?? 'unknown';
            $statusCounts[$status] = ($statusCounts[$status] ?? 0) + 1;
        }

        // A couple of module-relevant, non-PII fields beyond id/status —
        // without these, e.g. "which lease expires soonest" is unanswerable
        // from id/status alone (both just say "Expiring"), and the assistant
        // correctly refuses to guess rather than inventing a date.
        $recentSummary = array_map(function ($record) use ($module) {
            $summary = ['id' => $this->firstIdField($record), 'status' => $this->extractStatus($record)];
            if ($module === 'Expiration' && isset($record['end_date'])) {
                $summary['end_date'] = $record['end_date'];
            }
            if ($module === 'Schedule' && isset($record['schedule_date'])) {
                $summary['schedule_date'] = $record['schedule_date'];
                // Batch H (reservation module audit): without these, a
                // question like "which reservations are at risk of being
                // auto-cancelled" was unanswerable from this context alone —
                // the assistant would have to guess rather than ground its
                // answer in the same stale/final-warning facts the sweep
                // itself (ScheduleController::notifyStalePending() etc.)
                // already tracks per schedule.
                if (!empty($record['stale_notified_at'])) {
                    $summary['stale_reminder_sent_at'] = $record['stale_notified_at'];
                }
                if (!empty($record['final_warning_notified_at'])) {
                    $summary['final_warning_sent_at'] = $record['final_warning_notified_at'];
                }
            }
            if ($module === 'Lot' && isset($record['lot_number'])) {
                $summary['lot_number'] = $record['lot_number'];
            }
            if ($module === 'Payment' && isset($record['amount'])) {
                $summary['amount'] = $record['amount'];
            }
            return $summary;
        }, array_slice($records, 0, 8));

        $exceptionTypes = self::MODULE_EXCEPTION_TYPES[$module];
        $openExceptions = $exceptionTypes === null
            ? $this->exceptionModel->findAll(['status' => 'open'])
            : array_merge(...array_map(function ($type) {
                return $this->exceptionModel->findAll(['status' => 'open', 'entity_type' => $type]);
            }, $exceptionTypes));

        $context = [
            'module' => $module,
            'total_records' => count($records),
            'status_breakdown' => $statusCounts,
            'recent_records' => $recentSummary,
            'open_exceptions' => array_map([$this, 'summarizeException'], $openExceptions),
            'generated_at' => date('c'),
        ];

        // Batch H (reservation module audit): $recentSummary above is capped
        // at 8 records ordered by schedule_date (Schedule::findAll()'s own
        // default order, not recency or risk), so it can easily miss the
        // handful of Pending reservations actually at risk of auto-
        // cancellation if the module has more than a few records. This is a
        // separate, explicitly risk-scoped list so a "which reservations
        // need outreach" question is answered from real per-schedule facts
        // (the same stale_notified_at/final_warning_notified_at the
        // deterministic sweep itself uses — see
        // ScheduleController::notifyStalePending()/sendFinalWarnings()) —
        // never a guess, and never a second, competing notion of "at risk"
        // invented by the AI layer itself.
        if ($module === 'Schedule') {
            $atRisk = array_values(array_filter($records, function ($record) {
                return ($record['status'] ?? null) === 'Pending'
                    && (!empty($record['stale_notified_at']) || !empty($record['final_warning_notified_at']));
            }));
            $context['at_risk_pending_schedules'] = array_map(function ($record) {
                return [
                    'schedule_id' => $record['schedule_id'],
                    'lot_number' => $record['lot_number'] ?? null,
                    'schedule_date' => $record['schedule_date'] ?? null,
                    'stale_reminder_sent_at' => $record['stale_notified_at'] ?? null,
                    'final_warning_sent_at' => $record['final_warning_notified_at'] ?? null,
                ];
            }, $atRisk);
        }

        return $context;
    }

    // Quota-reduction batch (Batch 3): lighter-weight counterpart to
    // buildModuleContext() above, used only by buildSystemWideReach() below.
    // A genuinely system-wide question needs to know WHICH module has an
    // issue (counts/statuses), not every module's individual recent records
    // and full per-exception detail stacked on top of whichever module is
    // already the actual focus. Same data source/queries as
    // buildModuleContext() (existing models' read methods only, no new
    // SQL), just without recent_records and with open_exceptions collapsed
    // to a count instead of the full record list.
    public function buildModuleSummary($module) {
        if (!array_key_exists($module, self::MODULE_EXCEPTION_TYPES)) {
            return ['error' => 'Unsupported module', 'code' => 400];
        }

        $modelByModule = [
            'Schedule' => $this->scheduleModel,
            'Relocation' => $this->relocationModel,
            'Cremation' => $this->cremationModel,
            'Expiration' => $this->expirationModel,
            'Decedent' => $this->decedentModel,
            'Payment' => $this->paymentModel,
            'Lot' => $this->lotModel,
        ];

        $records = [];
        if ($module === 'DecedentRequest') {
            $records = $this->decedentRequestModel->findAll();
        } elseif (isset($modelByModule[$module])) {
            $records = $modelByModule[$module]->findAll([]);
        }

        $statusCounts = [];
        foreach ($records as $record) {
            $status = $this->extractStatus($record) ?? 'unknown';
            $statusCounts[$status] = ($statusCounts[$status] ?? 0) + 1;
        }

        $exceptionTypes = self::MODULE_EXCEPTION_TYPES[$module];
        $openExceptionCount = $exceptionTypes === null
            ? count($this->exceptionModel->findAll(['status' => 'open']))
            : array_sum(array_map(function ($type) {
                return count($this->exceptionModel->findAll(['status' => 'open', 'entity_type' => $type]));
            }, $exceptionTypes));

        return [
            'module' => $module,
            'total_records' => count($records),
            'status_breakdown' => $statusCounts,
            'open_exception_count' => $openExceptionCount,
        ];
    }

    private function firstIdField($record) {
        foreach (['schedule_id', 'request_id', 'cremation_id', 'expiration_id', 'decedent_id', 'lot_id'] as $key) {
            if (array_key_exists($key, $record)) {
                return (int) $record[$key];
            }
        }
        return null;
    }

    // BATCH AI-4 (AI Architecture Audit, 2026-09-02): citizen-visible
    // modules for the System-Wide AI Assistant, always filtered to the
    // requesting citizen's own records. Deliberately reuses the EXACT same
    // ownership filter keys ScheduleController::mine()/PaymentController::
    // mine()/DecedentRequestController::mine() already use in production for
    // their own "my reservations" / "my payments" / "my requests" pages,
    // rather than re-deriving ownership logic here — any future change to
    // what "mine" means for these records only has to happen in one place.
    //
    // 'Decedent' is deliberately NOT included, even though the citizen-
    // facing page that lists decedent records is literally named "My
    // Records" — DecedentController::index() does not scope that list by
    // owner at all; every citizen sees the same cemetery-wide list, just
    // with DecedentController::redactDecedent() applied. Wiring that module
    // in here without also replicating that exact redaction would leak full
    // decedent names to a citizen who has no ownership relationship to
    // them, so it's left out of this batch rather than done unsafely; see
    // the AI Architecture Audit roadmap for the follow-up.
    private const CITIZEN_MODULE_OWNER_FIELD = [
        'Schedule' => 'created_by',
        'Payment' => 'received_by',
    ];

    public static function isCitizenModule($module) {
        return $module === 'DecedentRequest' || array_key_exists($module, self::CITIZEN_MODULE_OWNER_FIELD);
    }

    public function buildCitizenModuleContext($module, $userId) {
        if (!self::isCitizenModule($module)) {
            return ['error' => 'Unsupported module for this account', 'code' => 400];
        }

        $userId = (int) $userId;
        if ($userId <= 0) {
            return ['error' => 'A valid user is required', 'code' => 401];
        }

        if ($module === 'DecedentRequest') {
            $records = $this->decedentRequestModel->findByUser($userId);
        } else {
            $ownerField = self::CITIZEN_MODULE_OWNER_FIELD[$module];
            $model = $module === 'Schedule' ? $this->scheduleModel : $this->paymentModel;
            $records = $model->findAll([$ownerField => $userId]);
        }

        $statusCounts = [];
        foreach ($records as $record) {
            $status = $this->extractStatus($record) ?? 'unknown';
            $statusCounts[$status] = ($statusCounts[$status] ?? 0) + 1;
        }

        // Same name-free-by-construction rule as buildModuleContext() below
        // — these are the citizen's own records, so a leaked name isn't a
        // cross-user privacy issue the way it would be for the admin-facing
        // builder, but the fields stay minimal regardless: id/status plus
        // one or two module-relevant fields, nothing beyond what's needed
        // to answer "what's the status of my X".
        $recentSummary = array_map(function ($record) use ($module) {
            $summary = ['id' => $this->firstIdField($record), 'status' => $this->extractStatus($record)];
            if ($module === 'Schedule' && isset($record['schedule_date'])) {
                $summary['schedule_date'] = $record['schedule_date'];
                // Batch H: lets the citizen assistant answer "is my
                // reservation at risk of being cancelled" grounded in the
                // same facts the deterministic sweep uses, rather than
                // declining or guessing — mirrors buildModuleContext()'s
                // identical addition above.
                if (!empty($record['stale_notified_at'])) {
                    $summary['stale_reminder_sent_at'] = $record['stale_notified_at'];
                }
                if (!empty($record['final_warning_notified_at'])) {
                    $summary['final_warning_sent_at'] = $record['final_warning_notified_at'];
                }
            }
            if ($module === 'Payment' && isset($record['amount'])) {
                $summary['amount'] = $record['amount'];
            }
            return $summary;
        }, array_slice($records, 0, 8));

        return [
            'module' => $module,
            'scope' => 'citizen_own_records',
            'total_records' => count($records),
            'status_breakdown' => $statusCounts,
            'recent_records' => $recentSummary,
            'generated_at' => date('c'),
        ];
    }

    // System-Wide AI Assistant (follow-up): originally built so a question
    // genuinely about a different module than the current focus (e.g.
    // "what's expiring next week" asked from the Relocation page) had
    // something to answer from, instead of "AI should cover the whole
    // system" meaning nothing outside the mounting page was ever reachable.
    //
    // Quota-reduction batch (Batch 3): this is now ONLY called for
    // scope=system requests (see AiController::askAssistant()) — entity and
    // module scope answer strictly from their own focus, no system-wide
    // bundle attached, per the audit's data-minimization finding. Uses
    // buildModuleSummary() (counts/statuses only) rather than the full
    // buildModuleContext() (recent records + full exception list) per
    // module, since a system-wide question needs to know WHICH module has
    // an issue, not every module's record-level detail at once.
    public function buildSystemWideReach() {
        $modules = array_keys(self::MODULE_EXCEPTION_TYPES);
        $byModule = [];
        foreach ($modules as $module) {
            if ($module === 'AuditLog') {
                continue; // that scope IS the system-wide view - no separate entry needed
            }
            $byModule[$module] = $this->buildModuleSummary($module);
        }

        return [
            'system' => $this->buildDashboardFacts(),
            'modules' => $byModule,
        ];
    }

    // Strips the context down to a name-free fact bundle for the LLM leg -
    // mirrors the existing AiController::explainException() precedent
    // exactly (facts only: ids/statuses/actions/timestamps/reasons, never
    // decedent/requester/approver names). The full $context above (with
    // names) is still returned to the caller in the API response, same as
    // any other admin/staff-gated endpoint already does today - only what
    // gets forwarded to Gemini is narrowed here.
    public function toFacts(array $context) {
        $facts = [
            'subject' => $context['subject'],
            'current_status' => $this->extractStatus($context['current_state']),
            'related' => [],
            'timeline' => [],
            'exceptions' => [],
        ];

        foreach ($context['related_records'] as $key => $record) {
            if (!is_array($record)) {
                continue;
            }
            $facts['related'][] = [
                'relation' => $key,
                'type' => $record['_type'] ?? $key,
                'id' => $record['_id'] ?? null,
                'status' => $this->extractStatus($record),
            ];
        }

        foreach ($context['timeline'] as $event) {
            $fact = [
                'at' => $event['at'],
                'type' => $event['type'],
                'action' => $event['action'],
                'entity_type' => $event['entity_type'],
                'entity_id' => $event['entity_id'],
                // false for every automated event, always (see buildTimeline()) -
                // the prompt is instructed to never state/imply a resulting
                // status value when this is false, only that the event occurred.
                'state_change_known' => $event['state_change_known'],
            ];
            if ($event['state_change_known']) {
                $fact['state_change'] = $event['state_change'];
            }
            $facts['timeline'][] = $fact;
        }

        foreach ($context['exceptions'] as $exception) {
            $facts['exceptions'][] = [
                'event' => $exception['event'],
                'reason' => $exception['reason'],
                'severity' => $exception['severity'],
                'status' => $exception['status'],
            ];
        }

        return $facts;
    }

    private function extractStatus($record) {
        if (!is_array($record)) {
            return null;
        }
        return $record['status'] ?? $record['verification_status'] ?? null;
    }

    private function fetchCurrentState($entityType, $entityId) {
        switch ($entityType) {
            case 'Schedule':
                return $this->scheduleModel->findById($entityId) ?: null;
            case 'Payment':
                return $this->paymentModel->findById($entityId) ?: null;
            case 'Lot':
                return $this->lotModel->findById($entityId) ?: null;
            case 'Cremation':
                return $this->cremationModel->findById($entityId) ?: null;
            case 'Relocation':
                return $this->relocationModel->findById($entityId) ?: null;
            case 'Expiration':
                return $this->expirationModel->findById($entityId) ?: null;
            case 'DecedentRequest':
                return $this->decedentRequestModel->findById($entityId) ?: null;
        }
        return null;
    }

    // Per-module correlation, following the exact resolution paths traced
    // in the AI-1 audit report Section 4 - not a generic/guessed join.
    private function fetchRelatedRecords($entityType, $entityId, $currentState) {
        $related = [];

        switch ($entityType) {
            case 'Schedule':
                if (!empty($currentState['lot_id'])) {
                    $related['lot'] = $this->tagged('Lot', $currentState['lot_id'], $this->lotModel->findById($currentState['lot_id']));
                }
                if (!empty($currentState['deceased_id'])) {
                    $related['decedent'] = $this->tagged('Decedent', $currentState['deceased_id'], $this->decedentModel->findById($currentState['deceased_id']));
                }
                $payment = $this->firstOrNull($this->paymentModel->findAll(['transaction_type' => 'Lot Purchase', 'reference_id' => $entityId]));
                if ($payment) {
                    $related['payment'] = $this->tagged('Payment', $payment['payment_id'], $payment);
                }
                break;

            case 'Payment':
                $related = array_merge($related, $this->resolvePaymentReference($currentState));
                break;

            case 'Lot':
                // A lot can be referenced by many schedules/relocations over
                // its life - surface the most recently created one of each
                // (highest auto-increment id) as "currently relevant",
                // not asserted as the sole occupant.
                $schedules = $this->scheduleModel->findAll(['lot_id' => $entityId]);
                $latestSchedule = $this->latestById($schedules, 'schedule_id');
                if ($latestSchedule) {
                    $related['most_recent_schedule'] = $this->tagged('Schedule', $latestSchedule['schedule_id'], $latestSchedule);
                }
                $relocationsFrom = $this->relocationModel->findAll(['from_lot_id' => $entityId]);
                $relocationsTo = $this->relocationModel->findAll(['to_lot_id' => $entityId]);
                $latestRelocation = $this->latestById(array_merge($relocationsFrom, $relocationsTo), 'request_id');
                if ($latestRelocation) {
                    $related['most_recent_relocation'] = $this->tagged('Relocation', $latestRelocation['request_id'], $latestRelocation);
                }
                break;

            case 'Cremation':
                if (!empty($currentState['deceased_id'])) {
                    $related['decedent'] = $this->tagged('Decedent', $currentState['deceased_id'], $this->decedentModel->findById($currentState['deceased_id']));
                }
                $payment = $this->firstOrNull($this->paymentModel->findAll(['transaction_type' => 'Cremation', 'reference_id' => $entityId]));
                if ($payment) {
                    $related['payment'] = $this->tagged('Payment', $payment['payment_id'], $payment);
                }
                break;

            case 'Relocation':
                if (!empty($currentState['from_lot_id'])) {
                    $related['from_lot'] = $this->tagged('Lot', $currentState['from_lot_id'], $this->lotModel->findById($currentState['from_lot_id']));
                }
                if (!empty($currentState['to_lot_id'])) {
                    $related['to_lot'] = $this->tagged('Lot', $currentState['to_lot_id'], $this->lotModel->findById($currentState['to_lot_id']));
                }
                $payment = $this->firstOrNull($this->paymentModel->findAll(['transaction_type' => 'Relocation', 'reference_id' => $entityId]));
                if ($payment) {
                    $related['payment'] = $this->tagged('Payment', $payment['payment_id'], $payment);
                }
                break;

            case 'Expiration':
                if (!empty($currentState['lot_id'])) {
                    $related['lot'] = $this->tagged('Lot', $currentState['lot_id'], $this->lotModel->findById($currentState['lot_id']));
                }
                break;

            case 'DecedentRequest':
                // Schedule::findByDecedentRequestId() already exists for
                // exactly this lookup (auto-link-decedent-on-approval uses
                // it) - reused as-is rather than a new query.
                $linkedSchedule = $this->latestById($this->scheduleModel->findByDecedentRequestId($entityId), 'schedule_id');
                if ($linkedSchedule) {
                    $related['linked_schedule'] = $this->tagged('Schedule', $linkedSchedule['schedule_id'], $linkedSchedule);
                }
                if (!empty($currentState['decedent_id'])) {
                    $related['decedent'] = $this->tagged('Decedent', $currentState['decedent_id'], $this->decedentModel->findById($currentState['decedent_id']));
                }
                break;
        }

        return $related;
    }

    // Mirrors PaymentController::resolveExpectedAmount()/
    // validatePaymentReference()'s exact per-transaction_type resolution -
    // reference_id has no discriminator column, so the type dictates how
    // it's interpreted (see the audit report Section 5 / Section 11 gap #2).
    private function resolvePaymentReference($payment) {
        $type = $payment['transaction_type'] ?? null;
        $referenceId = $payment['reference_id'] ?? null;
        if (!$referenceId) {
            return [];
        }

        switch ($type) {
            case 'Lot Purchase':
                $schedule = $this->scheduleModel->findById($referenceId);
                if ($schedule) {
                    return ['reference' => $this->tagged('Schedule', $referenceId, $schedule)];
                }
                $lot = $this->lotModel->findById($referenceId);
                if ($lot) {
                    return ['reference' => $this->tagged('Lot', $referenceId, $lot)];
                }
                return [];
            case 'Cremation':
                $cremation = $this->cremationModel->findById($referenceId);
                return $cremation ? ['reference' => $this->tagged('Cremation', $referenceId, $cremation)] : [];
            case 'Relocation':
                $relocation = $this->relocationModel->findById($referenceId);
                return $relocation ? ['reference' => $this->tagged('Relocation', $referenceId, $relocation)] : [];
            default:
                // Renewal/Other: ExpirationRecord and free-form references are
                // out of this first cut's supported-type set (see class
                // header) - deliberately left unresolved rather than guessed.
                return [];
        }
    }

    private function tagged($type, $id, $record) {
        if (!is_array($record)) {
            return null;
        }
        return array_merge($record, ['_type' => $type, '_id' => (int) $id]);
    }

    private function firstOrNull($rows) {
        return (is_array($rows) && count($rows) > 0) ? $rows[0] : null;
    }

    private function latestById($rows, $idField) {
        if (!is_array($rows) || count($rows) === 0) {
            return null;
        }
        usort($rows, function ($a, $b) use ($idField) {
            return (int) $b[$idField] - (int) $a[$idField];
        });
        return $rows[0];
    }

    // Manual-vs-automated tagging per the audit report Section 2: the reliable
    // signal is details.actor === 'automation-engine' (set unconditionally
    // by AutomationEngine::run()), not the action-name convention alone.
    //
    // state_change_known / state_change: closes audit report Section 11
    // Critical Gap #1. AutomationEngine::run() (backend/services/
    // AutomationEngine.php) unconditionally logs
    // {"actor":"automation-engine","success":true,"result":...} with NO
    // explicit before/after value, for every entity type it's ever called
    // against - not just Lot. An action name like 'schedule.completed'
    // describes WHICH deterministic step ran, not a status value the
    // entity took on (Lot's own status enum doesn't even contain
    // 'completed'). So every automated row is state_change_known=false,
    // unconditionally - no exceptions, no per-entity-type guessing.
    // Manual rows DO log an explicit {field: {from, to}} diff when a
    // tracked field's value actually changed - only those rows get
    // state_change_known=true, with the actual from/to pulled through so
    // the AI can quote it verbatim instead of guessing. The diff dict's
    // location is NOT consistent across controllers (pre-existing "audit
    // naming drift", not fixed here) - PaymentController::update() nests it
    // under details.changed, while LotController::updateLot(),
    // RelocationController::update(), and CremationController::update()
    // put it directly at the top level of details - looksLikeDiffDict()
    // below recognizes either shape rather than assuming one.
    private function buildTimeline($auditRows) {
        $timeline = array_map(function ($row) {
            $details = null;
            if (!empty($row['details'])) {
                $decoded = json_decode($row['details'], true);
                $details = is_array($decoded) ? $decoded : null;
            }
            $isAutomated = is_array($details) && ($details['actor'] ?? null) === 'automation-engine';

            $stateChange = null;
            if (!$isAutomated && is_array($details)) {
                $diffDict = null;
                if (!empty($details['changed']) && is_array($details['changed'])) {
                    $diffDict = $details['changed'];
                } elseif ($this->looksLikeDiffDict($details)) {
                    $diffDict = $details;
                }
                if ($diffDict !== null) {
                    $field = array_key_exists('status', $diffDict) ? 'status' : array_key_first($diffDict);
                    if ($field !== null && is_array($diffDict[$field]) && array_key_exists('from', $diffDict[$field]) && array_key_exists('to', $diffDict[$field])) {
                        $stateChange = ['field' => $field, 'from' => $diffDict[$field]['from'], 'to' => $diffDict[$field]['to']];
                    }
                }
            }

            return [
                'at' => $row['created_at'],
                'type' => $isAutomated ? 'automated' : 'manual',
                'action' => $row['action'],
                'entity_type' => $row['entity_type'],
                'entity_id' => $row['entity_id'] !== null ? (int) $row['entity_id'] : null,
                'actor_username' => $row['username'] ?? null,
                'log_id' => (int) $row['log_id'],
                'details' => $details,
                'state_change_known' => $stateChange !== null,
                'state_change' => $stateChange,
            ];
        }, $auditRows);

        usort($timeline, function ($a, $b) {
            return strcmp($a['at'], $b['at']);
        });

        return $timeline;
    }

    // True only when EVERY key in $details is itself a {from, to} pair -
    // matches LotController::updateLot()/RelocationController::update()/
    // CremationController::update()'s unwrapped diff-dict convention, while
    // correctly rejecting their own non-diff fallback shapes (e.g.
    // ['note' => 'Updated lot details']) and never matching an
    // automation-engine row (already excluded by the !$isAutomated guard
    // at the call site, checked again here defensively).
    private function looksLikeDiffDict($details) {
        if (empty($details) || array_key_exists('actor', $details)) {
            return false;
        }
        foreach ($details as $value) {
            if (!is_array($value) || !array_key_exists('from', $value) || !array_key_exists('to', $value)) {
                return false;
            }
        }
        return true;
    }

    private function summarizeException($exception) {
        return [
            'exception_id' => (int) ($exception['exception_id'] ?? 0),
            'event' => $exception['event'] ?? null,
            'entity_type' => $exception['entity_type'] ?? null,
            'entity_id' => isset($exception['entity_id']) ? (int) $exception['entity_id'] : null,
            'reason' => $exception['reason'] ?? null,
            'severity' => $exception['severity'] ?? null,
            'status' => $exception['status'] ?? null,
            'created_at' => $exception['created_at'] ?? null,
            'resolved_at' => $exception['resolved_at'] ?? null,
            'resolution_notes' => $exception['resolution_notes'] ?? null,
        ];
    }
}
