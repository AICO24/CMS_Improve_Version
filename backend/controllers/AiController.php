<?php
require_once __DIR__ . '/../models/AiParameter.php';
require_once __DIR__ . '/../models/AiKnowledge.php';
require_once __DIR__ . '/../services/AIService.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/CapacityAlert.php';

class AiController {
    private $aiParameterModel;
    private $aiKnowledgeModel;
    private $aiService;
    private $auditLogModel;

    public function __construct() {
        $this->aiParameterModel = new AiParameter();
        $this->aiKnowledgeModel = new AiKnowledge();
        $this->aiService = new AIService();
        $this->auditLogModel = new AuditLog();
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
            $alertKey = $capacityAlert['month'] . ':' . $capacityAlert['status'];
            $capacityAlertModel = new CapacityAlert();
            if ($capacityAlertModel->lastAlertKey() === $alertKey) {
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
