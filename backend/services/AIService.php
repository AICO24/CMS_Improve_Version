<?php
class AIService {
    private $baseUrl;
    private $timeout;

    public function __construct($baseUrl = 'http://127.0.0.1:5000') {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->timeout = 30;
    }

    public function healthCheck() {
        return $this->request('/api/health');
    }

    public function getRecommendations($preferences) {
        return $this->request('/api/recommend', 'POST', $preferences);
    }

    public function getTypeRecommendations($preferences) {
        return $this->request('/api/recommend-type', 'POST', $preferences);
    }

    public function getForecast($months = 6) {
        return $this->request('/api/forecast?months=' . (int) $months);
    }

    public function getNarration($payload) {
        return $this->request('/api/narrate', 'POST', $payload);
    }

    public function getExtraction($payload) {
        return $this->request('/api/extract', 'POST', $payload);
    }

    public function getChatAnswer($payload) {
        return $this->request('/api/chat', 'POST', $payload);
    }

    public function explainException($payload) {
        return $this->request('/api/explain-exception', 'POST', $payload);
    }

    // AI-1: Audit Intelligence Layer. $payload is the name-free "facts"
    // bundle AuditIntelligenceService::toFacts() builds, never raw records.
    public function explainEntity($payload) {
        return $this->request('/api/explain-entity', 'POST', $payload);
    }

    // AI-2 Round 2: the proactive "second admin" dashboard digest. $payload
    // is AuditIntelligenceService::buildDashboardFacts()'s system-wide
    // aggregate bundle (counts/reasons only, never a raw record or a name).
    public function dashboardDigest($payload) {
        return $this->request('/api/dashboard-digest', 'POST', $payload);
    }

    // System-Wide AI Assistant (Phase 1): free-form follow-up questions,
    // grounded in whichever fact bundle AiController::askAssistant() built
    // (single-entity, module-level, or system-wide - the assistant itself
    // doesn't know or care which, it only ever sees facts already assembled
    // by AuditIntelligenceService).
    // BATCH AI-2 (AI Architecture Audit): optional $timeoutSeconds override,
    // used only by AiController's escalated-retry call — a tighter budget
    // than the default $this->timeout so a slow best-effort second attempt
    // can't double the worst-case wait a module/entity-scoped question was
    // already taking. Every other call site (and the first, primary
    // askAssistant() call) omits it and keeps the existing default.
    public function askAssistant($payload, $timeoutSeconds = null) {
        return $this->request('/api/assistant-ask', 'POST', $payload, $timeoutSeconds);
    }

    private function request($path, $method = 'GET', $data = null, $timeoutSeconds = null) {
        if (!function_exists('curl_init')) {
            return ['error' => 'cURL extension is not available', 'code' => 500];
        }

        $url = $this->baseUrl . $path;
        $ch = curl_init($url);

        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_TIMEOUT, $timeoutSeconds !== null ? (int) $timeoutSeconds : $this->timeout);
        curl_setopt($ch, CURLOPT_CONNECTTIMEOUT, 10);
        curl_setopt($ch, CURLOPT_FAILONERROR, false);
        curl_setopt($ch, CURLOPT_HTTPHEADER, ['Accept: application/json']);

        if ($method === 'POST') {
            curl_setopt($ch, CURLOPT_POST, true);
            if ($data !== null) {
                $payload = is_array($data) ? json_encode($data) : $data;
                curl_setopt($ch, CURLOPT_POSTFIELDS, $payload);
                curl_setopt($ch, CURLOPT_HTTPHEADER, [
                    'Accept: application/json',
                    'Content-Type: application/json',
                ]);
            }
        }

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        $curlError = curl_error($ch);
        curl_close($ch);

        if ($curlError !== '') {
            return ['error' => $curlError, 'code' => 503];
        }

        if ($httpCode >= 400) {
            return ['error' => 'Python service request failed', 'code' => $httpCode];
        }

        $decoded = json_decode($response, true);
        return is_array($decoded) ? $decoded : ['error' => 'Invalid response', 'code' => 502];
    }
}
