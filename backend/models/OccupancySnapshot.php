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

    // Cemetery-wide trend: sums every section per snapshot_date over the last
    // $months, for a historical occupancy line chart.
    public function getTrend($months = 12) {
        $stmt = $this->db->prepare("
            SELECT snapshot_date,
                   SUM(total) AS total,
                   SUM(occupied) AS occupied,
                   SUM(available) AS available,
                   SUM(reserved) AS reserved,
                   SUM(expired) AS expired
            FROM occupancy_snapshots
            WHERE snapshot_date >= DATE_SUB(CURDATE(), INTERVAL ? MONTH)
            GROUP BY snapshot_date
            ORDER BY snapshot_date ASC
        ");
        $stmt->execute([(int) $months]);
        return $stmt->fetchAll();
    }
}
