<?php
require_once __DIR__ . '/../models/AiParameter.php';
require_once __DIR__ . '/../services/AIService.php';

class AiController {
    private $aiParameterModel;
    private $aiService;

    public function __construct() {
        $this->aiParameterModel = new AiParameter();
        $this->aiService = new AIService();
    }

    public function health() {
        return ['status' => 'ok', 'service' => 'php-api'];
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
