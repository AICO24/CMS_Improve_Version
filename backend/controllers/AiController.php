<?php
require_once __DIR__ . '/../models/AiParameter.php';
require_once __DIR__ . '/../models/AiKnowledge.php';
require_once __DIR__ . '/../services/AIService.php';

class AiController {
    private $aiParameterModel;
    private $aiKnowledgeModel;
    private $aiService;

    public function __construct() {
        $this->aiParameterModel = new AiParameter();
        $this->aiKnowledgeModel = new AiKnowledge();
        $this->aiService = new AIService();
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

        return $result;
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

    public function createKnowledge($data) {
        $data = is_array($data) ? $data : [];
        if (empty($data['topic']) || empty($data['content'])) {
            return ['error' => 'topic and content are required', 'code' => 400];
        }

        $result = $this->aiKnowledgeModel->create($data);
        if ($result) {
            return ['success' => true, 'message' => 'Knowledge entry created'];
        }
        return ['error' => 'Failed to create knowledge entry', 'code' => 500];
    }

    public function updateKnowledge($id, $data) {
        if (empty($id)) {
            return ['error' => 'Knowledge ID is required', 'code' => 400];
        }
        $data = is_array($data) ? $data : [];
        if (empty($data['topic']) || empty($data['content'])) {
            return ['error' => 'topic and content are required', 'code' => 400];
        }

        $result = $this->aiKnowledgeModel->update($id, $data);
        if ($result) {
            return ['success' => true, 'message' => 'Knowledge entry updated'];
        }
        return ['error' => 'Failed to update knowledge entry', 'code' => 500];
    }

    public function deleteKnowledge($id) {
        if (empty($id)) {
            return ['error' => 'Knowledge ID is required', 'code' => 400];
        }

        $result = $this->aiKnowledgeModel->delete($id);
        if ($result) {
            return ['success' => true, 'message' => 'Knowledge entry deleted'];
        }
        return ['error' => 'Failed to delete knowledge entry', 'code' => 500];
    }

    public function getParameters($module = null) {
        return $this->aiParameterModel->findAll($module);
    }

    public function updateParameter($id, $data) {
        if (empty($id)) {
            return ['error' => 'Parameter ID is required', 'code' => 400];
        }

        $result = $this->aiParameterModel->update($id, $data);
        if ($result) {
            return ['success' => true, 'message' => 'Parameter updated'];
        }

        return ['error' => 'Failed to update parameter', 'code' => 500];
    }
}
