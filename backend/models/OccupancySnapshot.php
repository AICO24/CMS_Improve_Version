<?php
require_once __DIR__ . '/../config/database.php';

class OccupancySnapshot {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    // Upserts $date's per-section snapshot from freshly computed occupancy data.
    // Called on every reports/occupancy request: today's row keeps updating
    // through the day (idempotent), and once the date rolls over a new row is
    // created, leaving prior days frozen as real history.
    public function captureFromSections($date, $bySection) {
        $stmt = $this->db->prepare("
            INSERT INTO occupancy_snapshots (snapshot_date, section_id, total, occupied, available, reserved, expired)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON DUPLICATE KEY UPDATE
                total = VALUES(total),
                occupied = VALUES(occupied),
                available = VALUES(available),
                reserved = VALUES(reserved),
                expired = VALUES(expired)
        ");
        foreach ($bySection as $section) {
            if (empty($section['section_id'])) {
                continue;
            }
            $stmt->execute([
                $date,
                (int) $section['section_id'],
                (int) ($section['total'] ?? 0),
                (int) ($section['occupied'] ?? 0),
                (int) ($section['available'] ?? 0),
                (int) ($section['reserved'] ?? 0),
                (int) ($section['expired'] ?? 0),
            ]);
        }
    }

    // Cemetery-wide trend: aggregate the last $months by calendar month so the
    // chart always shows a stable 12-month view even when the snapshot table has
    // only sparse daily entries.
    public function getTrend($months = 12) {
        $months = max(1, (int) $months);
        $stmt = $this->db->prepare("
            SELECT DATE_FORMAT(snapshot_date, '%Y-%m-01') AS month_start,
                   SUM(total) AS total,
                   SUM(occupied) AS occupied,
                   SUM(available) AS available,
                   SUM(reserved) AS reserved,
                   SUM(expired) AS expired
            FROM occupancy_snapshots
            WHERE snapshot_date >= DATE_FORMAT(DATE_SUB(CURDATE(), INTERVAL ? MONTH), '%Y-%m-01')
            GROUP BY DATE_FORMAT(snapshot_date, '%Y-%m')
            ORDER BY month_start ASC
        ");
        $stmt->execute([$months]);
        return $stmt->fetchAll();
    }
}
