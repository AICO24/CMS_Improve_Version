<?php
require_once __DIR__ . '/../models/AiParameter.php';
require_once __DIR__ . '/../models/AiKnowledge.php';
require_once __DIR__ . '/../services/AIService.php';
require_once __DIR__ . '/../services/AuditIntelligenceService.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/CapacityAlert.php';

class AiController {
    private $aiParameterModel;
    private $aiKnowledgeModel;
    private $aiService;
    private $auditLogModel;
    private $auditIntelligenceService;

    public function __construct() {
        $this->aiParameterModel = new AiParameter();
        $this->aiKnowledgeModel = new AiKnowledge();
        $this->aiService = new AIService();
        $this->auditLogModel = new AuditLog();
        $this->auditIntelligenceService = new AuditIntelligenceService();
    }

    private static function actorId($actor) {
        return is_array($actor) ? ($actor['user_id'] ?? null) : $actor;
    }

    private static function actorUsername($actor) {
        return is_array($actor) ? ($actor['username'] ?? null) : null;
    }

    public function health() {
        $result = $this->aiService->healthCheck();
        if (!empty($result['error'])) {
            return [
                'status' => 'offline',
                'service' => 'php-api',
                'python_ai' => ['status' => 'offline', 'error' => $result['error']],
            ];
        }

        return [
            'status' => 'ok',
            'service' => 'php-api',
            'python_ai' => $result,
        ];
    }

    public function recommend($preferences) {
        $payload = is_array($preferences) ? $preferences : [];
        $result = $this->aiService->getRecommendations($payload);

        if (!empty($result['error'])) {
            return [
                'success' => false,
                'message' => $result['error'],
                'recommendations' => [],
                'fallback' => true,
            ];
        }

        return $result;
    }

    // Batch M4: lot-TYPE ranking, distinct from recommend()'s specific-lot
    // ranking above. lot_type is deliberately not part of $preferences here —
    // it's the thing being recommended, not an input.
    public function recommendTypes($preferences) {
        $payload = is_array($preferences) ? $preferences : [];
        $result = $this->aiService->getTypeRecommendations($payload);

        if (!empty($result['error']) || !is_array($result)) {
            return [
                'success' => false,
                'message' => $result['error'] ?? 'Unable to rank lot types',
                'types' => [],
                'fallback' => true,
            ];
        }

        return $result;
    }

    public function forecast($months = 6) {
        $result = $this->aiService->getForecast((int) $months);

        if (!empty($result['error'])) {
            return [
                'success' => false,
                'message' => $result['error'],
                'forecast' => [],
                'fallback' => true,
            ];
        }

        $this->maybeAlertCapacity($result['capacity_alert'] ?? null);

        return $result;
    }

    // Batch D (Admin-Wide Automation Audit): capacity_alert (from the
    // forecast's own warning/critical threshold check) previously only ever
    // reached whoever happened to have the Forecast page open. Pushes a
    // dashboard notification the first time a given month/severity is seen,
    // deduped via CapacityAlert so repeated forecast calls (this runs on
    // every page load, not just the "Generate" button) don't spam. Never
    // lets a failure here affect the forecast response itself.
    private function maybeAlertCapacity($capacityAlert) {
        if (empty($capacityAlert) || empty($capacityAlert['month']) || empty($capacityAlert['status'])) {
            return;
        }

        try {
            // Batch G Sub-batch 3: prefixed ('forecast:') so this stream's
            // dedup stays scoped to itself now that a second, independent
            // stream (per-columbarium cremation capacity — see
            // CremationController::maybeAlertColumbariumCapacity()) shares
            // this same capacity_alerts table. Without this, a cremation
            // alert becoming the table's most recent row would make an
            // unrelated, already-notified forecast month look "new" again.
            // capacity_alerts was empty at the time of this change, so there
            // was no cached state to migrate.
            $prefix = 'forecast:';
            $alertKey = $prefix . $capacityAlert['month'] . ':' . $capacityAlert['status'];
            $capacityAlertModel = new CapacityAlert();
            if ($capacityAlertModel->lastAlertKeyForPrefix($prefix) === $alertKey) {
                return;
            }

            $statusLabel = $capacityAlert['status'] === 'critical' ? 'Critical' : 'Warning';
            $ratePercent = round(((float) ($capacityAlert['occupancy_rate'] ?? 0)) * 100);

            $notificationModel = new Notification();
            $notificationModel->create([
                'title' => "Capacity {$statusLabel}: {$capacityAlert['month']}",
                'message' => "Projected occupancy for {$capacityAlert['month']} reaches {$ratePercent}%. Review Capacity Forecasting for details.",
                'notification_type' => 'System',
                'is_read' => 0,
            ]);

            $this->auditLogModel->log(
                'Capacity alert generated',
                null,
                null,
                'CapacityForecast',
                null,
                ['alert_key' => $alertKey, 'month' => $capacityAlert['month'], 'status' => $capacityAlert['status'], 'occupancy_rate' => $capacityAlert['occupancy_rate'] ?? null]
            );

            $capacityAlertModel->record($alertKey, $capacityAlert['month'], $capacityAlert['status'], $capacityAlert['occupancy_rate'] ?? null);
        } catch (Exception $e) {
            // Deliberately swallowed — a forecast call must never fail because
            // the alerting side-channel had a problem.
        }
    }

    public function narrate($payload) {
        $payload = is_array($payload) ? $payload : [];
        $result = $this->aiService->getNarration($payload);
        $message = (!empty($result['error']) || !is_array($result)) ? null : ($result['message'] ?? null);
        return ['message' => is_string($message) ? $message : null];
    }

    public function extract($payload) {
        $payload = is_array($payload) ? $payload : [];
        $result = $this->aiService->getExtraction($payload);
        $data = (!empty($result['error']) || !is_array($result)) ? null : ($result['result'] ?? null);
        return ['result' => is_array($data) ? $data : null];
    }

    // General Q&A layer (see docs/plans burial-scheduling AI Q&A): answers
    // real questions ("what documents do I need?") grounded only in the
    // ai_knowledge content an admin/staff member has reviewed — never
    // touches booking state, never blocks/replaces the deterministic
    // slot-filling flow. Always resolves to a usable shape (answered:false
    // on any failure) so the caller's existing behavior is unaffected when
    // this is unavailable.
    public function chat($payload) {
        $payload = is_array($payload) ? $payload : [];
        $result = $this->aiService->getChatAnswer($payload);
        if (!empty($result['error']) || !is_array($result)) {
            return ['answered' => false, 'message' => null];
        }
        return [
            'answered' => (bool) ($result['answered'] ?? false),
            'message' => is_string($result['message'] ?? null) ? $result['message'] : null,
        ];
    }

    // AI Intelligence Layer: explains a system_exceptions row for the admin
    // resolving it (Exceptions page's "Ask AI to explain"). Never decides or
    // acts — see AIService::explainException()'s header comment for the
    // engine-vs-AI boundary this preserves.
    public function explainException($payload) {
        $payload = is_array($payload) ? $payload : [];
        $result = $this->aiService->explainException($payload);
        if (!empty($result['error']) || !is_array($result)) {
            return ['explained' => false, 'message' => null];
        }
        return [
            'explained' => (bool) ($result['explained'] ?? false),
            'message' => is_string($result['message'] ?? null) ? $result['message'] : null,
        ];
    }

    // AI-1 (Audit Intelligence Layer): READ + EXPLAIN only. Retrieves and
    // correlates a single entity's authoritative current state, related
    // records, and audit/exception timeline via AuditIntelligenceService
    // (existing models, read-only), then asks the existing AI service to
    // narrate it in plain language for the admin/staff caller. AI never
    // queries the database itself and never decides the record's state -
    // it only summarizes the structured facts this method already
    // assembled. Route-level RBAC (admin/staff only) happens before this
    // method is ever called; see routes/api.php.
    public function explainEntity($payload) {
        $payload = is_array($payload) ? $payload : [];
        $entityType = trim((string) ($payload['entity_type'] ?? ''));
        $entityId = $payload['entity_id'] ?? null;

        if ($entityType === '' || empty($entityId)) {
            return ['error' => 'entity_type and entity_id are required', 'code' => 400];
        }

        // Batch 10 (Batch 9 audit finding): AuditIntelligenceService's
        // DB-touching methods can throw (PDO is configured with
        // ERRMODE_EXCEPTION — see config/database.php) and nothing above
        // this call chain ever caught that, so a database outage here
        // used to propagate as an uncaught exception instead of this
        // endpoint's own existing safe-failure shape.
        try {
            $context = $this->auditIntelligenceService->buildContext($entityType, $entityId);
        } catch (Exception $e) {
            return ['error' => 'AI context is temporarily unavailable', 'code' => 503];
        }
        if (!empty($context['error'])) {
            return $context;
        }

        $facts = $this->auditIntelligenceService->toFacts($context);
        $result = $this->aiService->explainEntity($facts);

        return [
            'explained' => empty($result['error']) && !empty($result['message']),
            'message' => (empty($result['error']) && is_string($result['message'] ?? null)) ? $result['message'] : null,
            'context' => $context,
        ];
    }

    // AI-2 Round 2: the proactive "second admin" dashboard digest. Same
    // READ + EXPLAIN boundary as explainEntity() above — AuditIntelligence-
    // Service assembles the system-wide facts (existing models, read-only),
    // the AI only narrates them, route-level RBAC (admin/staff) happens
    // before this is ever called. No payload from the caller: unlike
    // explainEntity(), there's no entity to select, this is always "the
    // whole system, right now."
    public function dashboardDigest() {
        // Batch 10 (Batch 9 audit finding): same uncaught-DB-exception gap
        // as explainEntity()/askAssistant() below — a database outage here
        // now degrades to this endpoint's own existing "explained:false"
        // shape (the exact shape every other failure path here already
        // uses) instead of an uncaught exception.
        try {
            $facts = $this->auditIntelligenceService->buildDashboardFacts();
        } catch (Exception $e) {
            return ['explained' => false, 'message' => null];
        }
        $result = $this->aiService->dashboardDigest($facts);

        return [
            'explained' => empty($result['error']) && !empty($result['message']),
            'message' => (empty($result['error']) && is_string($result['message'] ?? null)) ? $result['message'] : null,
            'facts' => $facts,
        ];
    }

    // System-Wide AI Assistant (Phase 1): the free-form counterpart to
    // explainEntity()/explainException()/dashboardDigest() above — same
    // READ + EXPLAIN boundary (this method decides what data exists via
    // AuditIntelligenceService, the AI only narrates/suggests, route-level
    // RBAC happens before this is ever called), but answers an arbitrary
    // admin question instead of one fixed narration shape. context.scope
    // picks which of the three existing fact-builders becomes the
    // conversational "focus" — the caller (the shared frontend widget)
    // always sends exactly one.
    //
    // Follow-up fix: focus alone made the assistant unable to answer a
    // question genuinely about a different module than the one it was
    // mounted on (e.g. "what's expiring next week" asked from Relocation)
    // — it correctly said it didn't know, but that's not "AI covers the
    // whole system". system_wide (buildSystemWideReach()) was briefly
    // attached to EVERY call regardless of scope to fix that, then Batch 3
    // (quota reduction) restricted it back to scope='system' only, for
    // cost — this comment previously still described the pre-Batch-3
    // behavior. BATCH AI-2 (AI Architecture Audit, 2026-09-02) is the
    // current fix: system_wide is built for scope='system' as before, and
    // for scope='entity'/'module' it's fetched on a bounded one-shot
    // escalated retry only when the first, cheaper call comes back unable
    // to answer — see the escalation block further down in this method.
    //
    // BATCH AI-2 timeout note: a single call here can now become two
    // sequential Python requests. set_time_limit() below guards PHP's own
    // script timeout for that case; AIService::askAssistant()'s escalated
    // call passes a tighter per-call budget than the primary call so a slow
    // best-effort second attempt can't double the worst-case wait.
    public function askAssistant($payload) {
        // BATCH AI-2: PHP's default max_execution_time (commonly 30s) was
        // sized for this method's original single Python call. Two
        // sequential calls (primary, up to its 30s curl timeout, plus an
        // escalated retry with its own 20s budget — see below) can together
        // reach ~50s worst case — extend generously (75s) rather than risk
        // this specific request being killed mid-escalation. Scoped to this
        // one request only; function_exists guarded since some hosts
        // disable set_time_limit() and silently ignore a call to it — this
        // must never be the reason the endpoint 500s.
        if (function_exists('set_time_limit')) {
            @set_time_limit(75);
        }

        $payload = is_array($payload) ? $payload : [];
        $context = is_array($payload['context'] ?? null) ? $payload['context'] : [];
        $question = trim((string) ($payload['question'] ?? ''));
        $conversationHistory = is_array($payload['conversation_history'] ?? null) ? $payload['conversation_history'] : [];

        if ($question === '') {
            return ['error' => 'question is required', 'code' => 400];
        }

        $scope = $context['scope'] ?? null;
        $focus = null;
        // Quota-reduction batch (Batch 3): buildSystemWideReach() (dashboard
        // facts + every module's summary) used to be attached to every
        // call regardless of scope — the audit's largest single source of
        // oversized assistant-ask prompts. Deterministic scope selection
        // below (unchanged — entity/module/system was already resolved
        // from caller-supplied context.scope, never from the LLM) now also
        // decides whether system_wide is built at all: only genuinely
        // system-wide questions get it. Entity/module questions answer
        // strictly from their own focus, matching the audit's "send only
        // the minimum relevant, authorized, read-only facts" requirement.
        $systemWide = null;

        // Batch 10 (Batch 9 audit finding): every branch below touches the
        // database through AuditIntelligenceService, which can throw
        // (PDO is configured with ERRMODE_EXCEPTION — see
        // config/database.php) — nothing in this call chain previously
        // caught that, so a database outage propagated as an uncaught
        // exception instead of this endpoint's own existing
        // {error, code} failure shape (the same shape the validation
        // returns just above already use).
        try {
            if ($scope === 'entity') {
                $entityType = trim((string) ($context['entity_type'] ?? ''));
                $entityId = $context['entity_id'] ?? null;
                if ($entityType === '' || empty($entityId)) {
                    return ['error' => 'entity_type and entity_id are required for scope=entity', 'code' => 400];
                }
                $built = $this->auditIntelligenceService->buildContext($entityType, $entityId);
                if (!empty($built['error'])) {
                    return $built;
                }
                $focus = $this->auditIntelligenceService->toFacts($built);
            } elseif ($scope === 'module') {
                $module = trim((string) ($context['module'] ?? ''));
                if ($module === '') {
                    return ['error' => 'module is required for scope=module', 'code' => 400];
                }
                $focus = $this->auditIntelligenceService->buildModuleContext($module);
                if (!empty($focus['error'])) {
                    return $focus;
                }
            } elseif ($scope === 'system') {
                $focus = $this->auditIntelligenceService->buildDashboardFacts();
                $systemWide = $this->auditIntelligenceService->buildSystemWideReach();
            } else {
                return ['error' => "context.scope must be 'entity', 'module', or 'system'", 'code' => 400];
            }
        } catch (Exception $e) {
            return ['error' => 'AI context is temporarily unavailable', 'code' => 503];
        }

        $assistantContext = [
            'focus' => $focus,
            'system_wide' => $systemWide,
        ];
        $this->logAiContextSize($scope, $assistantContext);

        $result = $this->aiService->askAssistant([
            'context' => $assistantContext,
            'question' => $question,
            'conversation_history' => $conversationHistory,
        ]);

        // BATCH AI-2 (AI Architecture Audit, 2026-09-02): the fix for the
        // audit's central finding — a module/entity-scoped question the
        // model itself says it can't answer from focus alone (answered:false
        // on a call that otherwise completed successfully — NOT a
        // network/provider error, retrying that would just waste quota) gets
        // exactly ONE escalated retry with system_wide attached, instead of
        // "I don't have visibility into that" being the final answer.
        // scope='system' is excluded — it already sends system_wide on the
        // first call, so there's nothing broader left to escalate to. This
        // keeps the common case (a question genuinely local to the current
        // module) exactly as cheap as before Batch 3's quota-reduction
        // change; only the minority that need it pay for a second call.
        $escalated = false;
        $firstAnswered = empty($result['error']) && !empty($result['message']);
        if (!$firstAnswered && empty($result['error']) && in_array($scope, ['entity', 'module'], true)) {
            $escalatedContext = [
                'focus' => $focus,
                'system_wide' => $this->auditIntelligenceService->buildSystemWideReach(),
            ];
            $this->logAiContextSize($scope . ':escalated', $escalatedContext);

            // 20s, not the primary call's default 30s: /api/assistant-ask
            // internally tries Gemini then falls back to Groq (see
            // llm_provider.py's generate(), timeout_ms=12000 per provider
            // attempt — up to ~24s worst case if Gemini fails and Groq is
            // also slow). 20s covers the common single-provider case with
            // room to spare while still bounding this retry's worst-case
            // contribution below the primary call's own budget; the rare
            // full-fallback-chain case may occasionally get cut off here,
            // which is an acceptable tradeoff for a best-effort second
            // attempt — the primary call's original (unhelpful) answer is
            // still returned below rather than surfacing a fresh error.
            $escalatedResult = $this->aiService->askAssistant([
                'context' => $escalatedContext,
                'question' => $question,
                'conversation_history' => $conversationHistory,
            ], 20);

            if (empty($escalatedResult['error']) && !empty($escalatedResult['message'])) {
                $result = $escalatedResult;
                $escalated = true;
            }
        }

        return [
            'answered' => empty($result['error']) && !empty($result['message']),
            'message' => (empty($result['error']) && is_string($result['message'] ?? null)) ? $result['message'] : null,
            'suggested_action' => (empty($result['error']) && is_string($result['suggested_action'] ?? null)) ? $result['suggested_action'] : null,
            // BATCH AI-8 (not yet implemented) will surface this in the
            // widget UI so a user can tell an answer reached beyond the
            // current page's focus; exposed now so that batch is additive.
            'escalated' => $escalated,
        ];
    }
    // Batch 3 observability, promoted to always-on by BATCH AI-1 (AI
    // Architecture Audit, 2026-09-02): confirms the scope-based minimization
    // in askAssistant() above is actually shrinking what gets sent to
    // Gemini. Logs only the resolved scope, a rough count of module-level
    // units included, and an approximate serialized character count — never
    // the facts themselves (no PII, no record contents, no prompt text) —
    // to PHP's own error log, never to the HTTP response. Previously gated
    // behind AI_CONTEXT_DEBUG=true (opt-in, dev-only); that gate made it
    // impossible to see real context-size/cost data in normal operation,
    // which BATCH AI-2's planned tiered-fetch change needs visibility into
    // to avoid re-introducing the cost problem Batch 3 was built to solve.
    // No new logging table or infrastructure introduced — same error_log()
    // sink as before, just unconditional now.
    private function logAiContextSize($scope, $assistantContext) {
        $moduleCount = 0;
        if ($scope === 'entity' || $scope === 'module') {
            $moduleCount = 1;
        } elseif ($scope === 'system') {
            $modules = $assistantContext['system_wide']['modules'] ?? null;
            $moduleCount = is_array($modules) ? count($modules) : 0;
        }

        $contextChars = strlen((string) json_encode($assistantContext));
        error_log("AI context: scope={$scope} modules={$moduleCount} context_chars={$contextChars}");
    }

    public function getKnowledge() {
        return $this->aiKnowledgeModel->findAll();
    }

    public function createKnowledge($data, $actor = null) {
        $data = is_array($data) ? $data : [];
        if (empty($data['topic']) || empty($data['content'])) {
            return ['error' => 'topic and content are required', 'code' => 400];
        }

        $result = $this->aiKnowledgeModel->create($data);
        if ($result) {
            $this->auditLogModel->log(
                'AI knowledge entry created',
                self::actorId($actor),
                self::actorUsername($actor),
                'AiKnowledge',
                $result,
                ['topic' => $data['topic']]
            );
            return ['success' => true, 'message' => 'Knowledge entry created'];
        }
        return ['error' => 'Failed to create knowledge entry', 'code' => 500];
    }

    public function updateKnowledge($id, $data, $actor = null) {
        if (empty($id)) {
            return ['error' => 'Knowledge ID is required', 'code' => 400];
        }
        $data = is_array($data) ? $data : [];
        if (empty($data['topic']) || empty($data['content'])) {
            return ['error' => 'topic and content are required', 'code' => 400];
        }

        $result = $this->aiKnowledgeModel->update($id, $data);
        if ($result) {
            $this->auditLogModel->log(
                'AI knowledge entry updated',
                self::actorId($actor),
                self::actorUsername($actor),
                'AiKnowledge',
                $id,
                ['topic' => $data['topic']]
            );
            return ['success' => true, 'message' => 'Knowledge entry updated'];
        }
        return ['error' => 'Failed to update knowledge entry', 'code' => 500];
    }

    public function deleteKnowledge($id, $actor = null) {
        if (empty($id)) {
            return ['error' => 'Knowledge ID is required', 'code' => 400];
        }

        $existing = $this->aiKnowledgeModel->findById($id);
        $result = $this->aiKnowledgeModel->delete($id);
        if ($result) {
            $this->auditLogModel->log(
                'AI knowledge entry deleted',
                self::actorId($actor),
                self::actorUsername($actor),
                'AiKnowledge',
                $id,
                ['topic' => $existing['topic'] ?? null]
            );
            return ['success' => true, 'message' => 'Knowledge entry deleted'];
        }
        return ['error' => 'Failed to delete knowledge entry', 'code' => 500];
    }

    public function getParameters($module = null) {
        return $this->aiParameterModel->findAll($module);
    }

    public function updateParameter($id, $data, $actor = null) {
        if (empty($id)) {
            return ['error' => 'Parameter ID is required', 'code' => 400];
        }

        $existing = $this->aiParameterModel->findById($id);
        $result = $this->aiParameterModel->update($id, $data);
        if ($result) {
            $this->auditLogModel->log(
                'AI parameter updated',
                self::actorId($actor),
                self::actorUsername($actor),
                'AiParameter',
                $id,
                [
                    'param_name' => $existing['param_name'] ?? null,
                    'from' => $existing['param_value'] ?? null,
                    'to' => $data['param_value'] ?? null,
                ]
            );
            return ['success' => true, 'message' => 'Parameter updated'];
        }

        return ['error' => 'Failed to update parameter', 'code' => 500];
    }
}
