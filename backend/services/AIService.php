<?php
require_once __DIR__ . '/../config/database.php';

class AIService {
    private $baseUrl;
    private $timeout;
    private $cacheDir;

    public function __construct($baseUrl = 'http://127.0.0.1:5000') {
        $this->baseUrl = rtrim($baseUrl, '/');
        $this->timeout = 30;
        $this->cacheDir = sys_get_temp_dir() . DIRECTORY_SEPARATOR . 'cms_cache';
        if (!is_dir($this->cacheDir)) {
            @mkdir($this->cacheDir, 0777, true);
        }
    }

    public function healthCheck() {
        return $this->request('/api/health');
    }

    // BATCH AI-6 (AI Architecture Audit, 2026-09-02): unlike every other
    // method in this class, the Flask side of these three calls queries
    // MySQL directly (its own DB_CONFIG/get_connection() in python-ai/
    // app.py) instead of narrating a fact bundle PHP already assembled —
    // documented as a deliberate exception, not an oversight, in that
    // file's own DB_CONFIG comment (search "BATCH AI-6" there for the full
    // reasoning: compute-heavy dataset-wide ranking/forecasting, fixed
    // parameterized queries only, no LLM-generated SQL either way).
    public function getRecommendations($preferences) {
        return $this->request('/api/recommend', 'POST', $preferences);
    }

    public function getTypeRecommendations($preferences) {
        return $this->request('/api/recommend-type', 'POST', $preferences);
    }

    public function getForecast($months = 6) {
        $months = max(1, (int) $months);
        $cached = $this->readCachedForecast($months);
        if ($cached) {
            return $cached;
        }

        $res = $this->request('/api/forecast?months=' . $months);
        if (is_array($res) && empty($res['error']) && (!isset($res['code']) || $res['code'] === 200)) {
            $this->writeCachedForecast($months, $res);
            return $res;
        }

        $fallback = $this->forecastFallback($months);
        if (!empty($fallback['success'])) {
            $this->writeCachedForecast($months, $fallback);
            return $fallback;
        }

        return $res;
    }

    public function getNarration($payload) {
        return $this->request('/api/narrate', 'POST', $payload);
    }

    public function getExtraction($payload) {
        return $this->request('/api/extract', 'POST', $payload);
    }

    // Decedent Records module audit, Batch I: separate endpoint/method from
    // getExtraction() above rather than a shared one with a "mode" flag —
    // same reasoning as getRecommendations() vs getTypeRecommendations()
    // being distinct methods despite a similar shape. $payload is just
    // {message: string}, the citizen's free-text description of a deceased
    // person not yet in decedent_records.
    public function getDecedentRequestExtraction($payload) {
        return $this->request('/api/extract-decedent-request', 'POST', $payload);
    }

    // Decedent Records module audit, Batch K: $payload is
    // {image_base64: string, mime_type: string} — a staff-uploaded death
    // certificate/burial permit. A larger default timeout than most other
    // calls here: vision calls take noticeably longer than a plain-text
    // extraction, and staff is actively waiting on this one in the Add
    // form, not a background/best-effort call.
    public function getCertificateExtraction($payload) {
        return $this->request('/api/extract-certificate', 'POST', $payload, 45);
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

    /**
     * Unified Booking Agent (BMS-5): Natural language intent & slot extraction
     * Calls Python Flask /api/booking-agent/extract.
     * 
     * @param array    $payload {message: string, draft_context?: array, conversation_context?: array}
     * @param int|null $timeoutSeconds
     * @return array
     */
    public function extractBookingAgent($payload, $timeoutSeconds = null) {
        return $this->request('/api/booking-agent/extract', 'POST', $payload, $timeoutSeconds);
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

    public function forecastFallback(int $months): array {
        try {
            $db = Database::getInstance()->getConnection();
            $historicalRows = $db->query(
                "SELECT DATE_FORMAT(schedule_date, '%Y-%m') AS month, COUNT(*) AS burials
                 FROM burial_schedules
                 WHERE status IN ('Confirmed', 'Completed')
                   AND schedule_date >= DATE_SUB(CURDATE(), INTERVAL 24 MONTH)
                 GROUP BY DATE_FORMAT(schedule_date, '%Y-%m')
                 ORDER BY month ASC"
            )->fetchAll(PDO::FETCH_ASSOC);

            $historicalMap = [];
            foreach ($historicalRows as $row) {
                $historicalMap[$row['month']] = (int) $row['burials'];
            }

            $currentMonth = new DateTimeImmutable('first day of this month');
            $historical = [];
            for ($offset = -23; $offset <= 0; $offset++) {
                $date = $this->addMonths($currentMonth, $offset);
                $label = $date->format('Y-m');
                $value = $historicalMap[$label] ?? 0;
                $historical[] = ['month' => $label, 'burials' => (int) $value];
            }

            $values = array_map(static fn($entry) => (int) $entry['burials'], $historical);
            $trend = 'stable';
            if (count($values) >= 2) {
                $first = $values[0];
                $last = $values[count($values) - 1];
                if ($last > $first) {
                    $trend = 'increasing';
                } elseif ($last < $first) {
                    $trend = 'decreasing';
                }
            }

            $capacitySql = "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'Occupied' THEN 1 ELSE 0 END) AS occupied
                            FROM lots";
            $capacityRow = $db->query($capacitySql)->fetch(PDO::FETCH_ASSOC) ?: [];
            $capacity = [
                'total' => (int) ($capacityRow['total'] ?? 0),
                'occupied' => (int) ($capacityRow['occupied'] ?? 0),
                'available' => max(0, (int) ($capacityRow['total'] ?? 0) - (int) ($capacityRow['occupied'] ?? 0)),
            ];

            $reclaimableSql = "SELECT DATE_FORMAT(end_date, '%Y-%m') AS month, COUNT(*) AS reclaimable
                              FROM expiration_records
                              WHERE renewed = 'no'
                                AND end_date >= CURDATE()
                                AND end_date <= DATE_ADD(CURDATE(), INTERVAL :months MONTH)
                              GROUP BY month";
            $reclaimableStmt = $db->prepare($reclaimableSql);
            $reclaimableStmt->bindValue(':months', $months, PDO::PARAM_INT);
            $reclaimableStmt->execute();
            $reclaimableRows = $reclaimableStmt->fetchAll(PDO::FETCH_ASSOC);
            $reclaimableByMonth = [];
            foreach ($reclaimableRows as $row) {
                $reclaimableByMonth[$row['month']] = (int) $row['reclaimable'];
            }

            $forecast = [];
            $cumulative = 0;
            $lookbackWindow = min(3, count($values));
            $baseAverage = $lookbackWindow > 0 ? array_sum(array_slice($values, -$lookbackWindow)) / $lookbackWindow : 0;

            for ($index = 1; $index <= $months; $index++) {
                $monthDate = $this->addMonths($currentMonth, $index);
                $label = $monthDate->format('Y-m');
                $predicted = max(0, (int) round($baseAverage));
                if (count($values) >= 2) {
                    $delta = end($values) - $values[0];
                    $growthBias = $delta / max(1, count($values) - 1);
                    $predicted = max(0, (int) round($baseAverage + ($growthBias * 0.5)));
                }

                $cumulative += $predicted;
                $reclaimable = $reclaimableByMonth[$label] ?? 0;
                $projectedOccupied = $capacity['occupied'] + $cumulative - $reclaimable;
                $projectedAvailable = $capacity['total'] > 0 ? max(0, $capacity['total'] - $projectedOccupied) : max(0, $projectedOccupied);
                $occupancyRate = $capacity['total'] > 0 ? max(0, min(1, $projectedOccupied / $capacity['total'])) : 0;

                if ($occupancyRate >= 0.95) {
                    $capacityStatus = 'critical';
                } elseif ($occupancyRate >= 0.80) {
                    $capacityStatus = 'warning';
                } else {
                    $capacityStatus = 'ok';
                }

                $forecast[] = [
                    'month' => $label,
                    'predicted_burials' => $predicted,
                    'cumulative' => $cumulative,
                    'reclaimable' => $reclaimable,
                    'projected_available' => $projectedAvailable,
                    'projected_occupied' => $projectedOccupied,
                    'occupancy_rate' => round($occupancyRate, 4),
                    'capacity_status' => $capacityStatus,
                ];
            }

            $capacityAlert = null;
            foreach ($forecast as $entry) {
                if ($entry['capacity_status'] !== 'ok') {
                    $capacityAlert = [
                        'month' => $entry['month'],
                        'status' => $entry['capacity_status'],
                        'occupancy_rate' => $entry['occupancy_rate'],
                    ];
                    break;
                }
            }

            return [
                'success' => true,
                'source' => 'local_fallback',
                'historical' => $historical,
                'forecast' => $forecast,
                'trend' => $trend,
                'capacity' => $capacity,
                'capacity_alert' => $capacityAlert,
            ];
        } catch (Throwable $e) {
            return [
                'success' => false,
                'message' => $e->getMessage(),
                'forecast' => [],
                'fallback' => true,
            ];
        }
    }

    private function readCachedForecast(int $months) {
        $path = $this->getForecastCachePath($months);
        if (!is_file($path)) {
            return null;
        }

        $content = @file_get_contents($path);
        if ($content === false) {
            return null;
        }

        $payload = json_decode($content, true);
        if (!is_array($payload) || !isset($payload['expires_at'], $payload['data'])) {
            return null;
        }

        if ((int) $payload['expires_at'] < time()) {
            @unlink($path);
            return null;
        }

        return $payload['data'];
    }

    private function writeCachedForecast(int $months, array $data): void {
        $path = $this->getForecastCachePath($months);
        $payload = [
            'expires_at' => time() + 300,
            'data' => $data,
        ];

        @file_put_contents($path, json_encode($payload), LOCK_EX);
    }

    private function getForecastCachePath(int $months): string {
        return $this->cacheDir . DIRECTORY_SEPARATOR . 'forecast_' . $months . '.json';
    }

    private function addMonths(DateTimeImmutable $date, int $months): DateTimeImmutable {
        $monthIndex = ($date->format('Y') * 12) + ((int) $date->format('n') - 1) + $months;
        $year = intdiv($monthIndex, 12);
        $month = ($monthIndex % 12) + 1;
        return DateTimeImmutable::createFromFormat('Y-n-j H:i:s', sprintf('%d-%d-1 00:00:00', $year, $month));
    }
}
