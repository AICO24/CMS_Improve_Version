<?php
require_once __DIR__ . '/../config/database.php';

class AuditLog {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    // Batch L2.8: this used to run "CREATE TABLE IF NOT EXISTS audit_logs" on
    // every single construction (removed here). audit_logs has been part of
    // the canonical schema.sql baseline since 2026-08-07 (see docs/database.md)
    // and every environment provisioned from it already has the table, so the
    // runtime check was redundant. It was also actively harmful: MySQL
    // implicitly commits the active transaction on any DDL statement,
    // including a no-op CREATE TABLE IF NOT EXISTS, so constructing a fresh
    // AuditLog() while a Database::transaction() was open (as
    // AutomationEngine::run() does on every call) silently ended that
    // transaction early — see PaymentController::verify()'s Lot Purchase
    // auto-confirm path, which this defect broke.

    public function log($action, $userId = null, $username = null, $entityType = null, $entityId = null, $details = null) {
        $ip = $_SERVER['REMOTE_ADDR'] ?? '127.0.0.1';
        $stmt = $this->db->prepare("
            INSERT INTO audit_logs (user_id, username, action, entity_type, entity_id, details, ip_address)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ");
        return $stmt->execute([
            $userId !== null ? (int)$userId : null,
            $username,
            $action,
            $entityType,
            $entityId !== null ? (int)$entityId : null,
            is_array($details) ? json_encode($details) : $details,
            $ip
        ]);
    }

    // Batch F (Post-Automation Admin Gap Audit): shared WHERE-builder so
    // findAll() and countAll() below can never drift apart — a filter added
    // to one that's forgotten in the other would make the pagination total
    // silently wrong.
    private function applyFilters(&$sql, &$params, $filters) {
        if (!empty($filters['q'])) {
            $sql .= " AND (a.action LIKE ? OR a.username LIKE ? OR a.entity_type LIKE ? OR a.details LIKE ? OR u.full_name LIKE ? )";
            $query = '%' . $filters['q'] . '%';
            $params[] = $query;
            $params[] = $query;
            $params[] = $query;
            $params[] = $query;
            $params[] = $query;
        }
        if (!empty($filters['action'])) {
            $sql .= " AND LOWER(a.action) = ?";
            $params[] = strtolower($filters['action']);
        }
        if (!empty($filters['entity_type'])) {
            $sql .= " AND LOWER(a.entity_type) = ?";
            $params[] = strtolower($filters['entity_type']);
        }
        // AI-1: lets a caller scope to one specific entity (e.g. Schedule
        // #55) instead of every row of that entity_type — needed by
        // AuditIntelligenceService to pull a single record's own timeline.
        if (!empty($filters['entity_id'])) {
            $sql .= " AND a.entity_id = ?";
            $params[] = (int) $filters['entity_id'];
        }
        if (!empty($filters['user_id'])) {
            $sql .= " AND a.user_id = ?";
            $params[] = (int)$filters['user_id'];
        }
        // date_from/date_to filter on the DATE portion of created_at, so a
        // date_to of "today" includes everything logged today regardless of
        // time of day (a plain created_at <= '2026-08-25' would exclude
        // anything after midnight).
        if (!empty($filters['date_from'])) {
            $sql .= " AND a.created_at >= ?";
            $params[] = $filters['date_from'] . ' 00:00:00';
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND a.created_at <= ?";
            $params[] = $filters['date_to'] . ' 23:59:59';
        }
    }

    public function findAll($filters = [], $limit = 100, $offset = 0) {
        $sql = "SELECT a.*, u.full_name as user_full_name FROM audit_logs a LEFT JOIN users u ON a.user_id = u.user_id WHERE 1=1";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $sql .= " ORDER BY a.created_at DESC LIMIT ? OFFSET ?";
        $params[] = (int)$limit;
        $params[] = (int)$offset;

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    // Batch F: lets the Audit Logs page show a real total/page-count instead
    // of the previous limit+1 "peek ahead" workaround, and answers "how many
    // events occurred" directly.
    public function countAll($filters = []) {
        $sql = "SELECT COUNT(*) AS total FROM audit_logs a LEFT JOIN users u ON a.user_id = u.user_id WHERE 1=1";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function getSummaryStats($filters = []) {
        $params = [];
        $sql = "SELECT
            COUNT(*) AS total_events,
            SUM(CASE WHEN LOWER(a.action) REGEXP 'delete|remove|reset|reject|suspend|disable|lock|failed' OR LOWER(COALESCE(a.details, '')) REGEXP 'failed|suspicious|unauthorized|blocked' THEN 1 ELSE 0 END) AS security_alerts,
            COUNT(DISTINCT CASE WHEN a.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN COALESCE(a.user_id, a.username, 'System') END) AS active_users,
            SUM(CASE WHEN a.created_at >= DATE_SUB(NOW(), INTERVAL 24 HOUR) THEN 1 ELSE 0 END) AS recent_24h,
            SUM(CASE WHEN LOWER(a.action) REGEXP 'login' AND LOWER(COALESCE(a.details, '')) REGEXP 'failed|invalid|unauthorized|denied' THEN 1 ELSE 0 END) AS failed_logins,
            SUM(CASE WHEN LOWER(a.action) REGEXP 'login|access' AND LOWER(COALESCE(a.details, '')) REGEXP 'denied|blocked|suspicious|unauthorized' THEN 1 ELSE 0 END) AS denied_access,
            SUM(CASE WHEN LOWER(a.action) REGEXP 'reset|lock|suspend|disable' OR LOWER(COALESCE(a.details, '')) REGEXP 'reset|lock|suspend|disable' THEN 1 ELSE 0 END) AS reset_actions,
            SUM(CASE WHEN LOWER(a.action) REGEXP 'delete|remove|reject' OR LOWER(COALESCE(a.details, '')) REGEXP 'delete|remove|reject' THEN 1 ELSE 0 END) AS delete_actions
            FROM audit_logs a
            LEFT JOIN users u ON a.user_id = u.user_id
            WHERE 1=1";

        $this->applyFilters($sql, $params, $filters);

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();

        $securityAlerts = (int)($row['security_alerts'] ?? 0);
        $failedLogins = (int)($row['failed_logins'] ?? 0);
        $deniedAccess = (int)($row['denied_access'] ?? 0);
        $resetActions = (int)($row['reset_actions'] ?? 0);
        $deleteActions = (int)($row['delete_actions'] ?? 0);

        $breakdown = [];
        if ($failedLogins > 0) $breakdown[] = $failedLogins === 1 ? '1 failed login' : "$failedLogins failed logins";
        if ($deniedAccess > 0) $breakdown[] = $deniedAccess === 1 ? '1 denied access' : "$deniedAccess denied access";
        if ($resetActions > 0) $breakdown[] = $resetActions === 1 ? '1 reset action' : "$resetActions reset actions";
        if ($deleteActions > 0) $breakdown[] = $deleteActions === 1 ? '1 deletion' : "$deleteActions deletions";

        $alertLabel = $securityAlerts === 0
            ? 'No critical activity'
            : ($securityAlerts === 1 ? '1 critical event' : "$securityAlerts critical events");

        return [
            'total_events' => (int)($row['total_events'] ?? 0),
            'security_alerts' => $securityAlerts,
            'active_users' => (int)($row['active_users'] ?? 0),
            'recent_24h' => (int)($row['recent_24h'] ?? 0),
            'alert_label' => $alertLabel,
            'alert_detail' => $breakdown ? implode(' • ', $breakdown) : 'No critical activity',
            'alert_breakdown' => [
                'failed_logins' => $failedLogins,
                'denied_access' => $deniedAccess,
                'reset_actions' => $resetActions,
                'delete_actions' => $deleteActions,
            ],
        ];
    }
}
