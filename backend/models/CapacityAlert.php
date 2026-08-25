<?php
require_once __DIR__ . '/../config/database.php';

// Batch D (Admin-Wide Automation Audit): tracks the last capacity-forecast
// threshold (month + status) that was already pushed as a dashboard
// notification, so AiController::forecast() — called on every Forecast page
// visit and every "Generate Forecast" click — doesn't create a fresh
// notification each time for a warning/critical month that's already been
// surfaced. Self-creates its table the same way AuditLog does, since this
// app has no separate migration-runner step for a table this small.
class CapacityAlert {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
        $this->ensureTableExists();
    }

    private function ensureTableExists() {
        $sql = "
            CREATE TABLE IF NOT EXISTS capacity_alerts (
                alert_id INT AUTO_INCREMENT PRIMARY KEY,
                alert_key VARCHAR(255) NOT NULL,
                alert_month VARCHAR(7) NOT NULL,
                capacity_status VARCHAR(20) NOT NULL,
                occupancy_rate DECIMAL(6,4) NULL,
                notified_at DATETIME DEFAULT CURRENT_TIMESTAMP
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
        ";
        $this->db->exec($sql);
    }

    // Append-only: the most recent row is the current "already notified"
    // state. A changed alert_key (different month, or the same month's
    // severity moved between warning/critical) means it's worth notifying
    // again; an unchanged one means skip.
    public function lastAlertKey() {
        $stmt = $this->db->query("SELECT alert_key FROM capacity_alerts ORDER BY alert_id DESC LIMIT 1");
        $row = $stmt->fetch();
        return $row['alert_key'] ?? null;
    }

    public function record($alertKey, $month, $status, $occupancyRate) {
        $stmt = $this->db->prepare("INSERT INTO capacity_alerts (alert_key, alert_month, capacity_status, occupancy_rate) VALUES (?, ?, ?, ?)");
        return $stmt->execute([$alertKey, $month, $status, $occupancyRate]);
    }
}
