<?php
require_once __DIR__ . '/../config/database.php';

class ExpirationRecord {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    private function applyFilters(&$sql, &$params, $filters) {
        if (!empty($filters['renewed'])) {
            $sql .= " AND e.renewed = ?";
            $params[] = $filters['renewed'];
        }
        if (!empty($filters['exhumation_status'])) {
            $sql .= " AND e.exhumation_status = ?";
            $params[] = $filters['exhumation_status'];
        }
        if (!empty($filters['lot_id'])) {
            $sql .= " AND e.lot_id = ?";
            $params[] = $filters['lot_id'];
        }

        if (!empty($filters['q'])) {
            $search = '%' . $filters['q'] . '%';
            $sql .= " AND (l.lot_number LIKE ? OR b.block_name LIKE ? OR s.section_name LIKE ? OR e.notes LIKE ?)";
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
        }

        if (!empty($filters['status'])) {
            switch ($filters['status']) {
                case 'expiring':
                    $sql .= " AND e.renewed = 'no' AND e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)";
                    break;
                case 'expired':
                    $sql .= " AND e.end_date < CURDATE()";
                    break;
                case 'renewal':
                    $sql .= " AND e.renewed = 'no' AND e.end_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)";
                    break;
                case 'exhumation':
                    $sql .= " AND e.exhumation_status = 'Scheduled'";
                    break;
                case 'renewed':
                    $sql .= " AND e.renewed = 'yes'";
                    break;
            }
        }
    }

    public function findAll($filters = [], $pagination = []) {
        $sql = "SELECT e.*, l.lot_number, b.block_name, s.section_name,
                   CASE
                     WHEN e.end_date < CURDATE() THEN 'Expired'
                     WHEN e.exhumation_status = 'Scheduled' THEN 'Exhumation'
                     WHEN e.renewed = 'no' AND e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'Expiring'
                     WHEN e.renewed = 'yes' THEN 'Renewed'
                     ELSE 'Active'
                   END AS status
                FROM expiration_records e
                JOIN lots l ON e.lot_id = l.lot_id
                JOIN blocks b ON l.block_id = b.block_id
                JOIN sections s ON b.section_id = s.section_id
                WHERE 1=1";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $sql .= " ORDER BY e.end_date ASC, e.updated_at DESC";

        $page = null;
        $perPage = null;
        if (!empty($pagination['page']) || !empty($pagination['per_page'])) {
            $page = max(1, (int) ($pagination['page'] ?? 1));
            $perPage = max(1, min(100, (int) ($pagination['per_page'] ?? 10)));
        }

        if ($page !== null && $perPage !== null) {
            $offset = ($page - 1) * $perPage;
            $sql .= " LIMIT ?, ?";
            $params[] = $offset;
            $params[] = $perPage;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);

        return $stmt->fetchAll();
    }

    public function countAll($filters = []) {
        $sql = "SELECT COUNT(*) AS total
                FROM expiration_records e
                JOIN lots l ON e.lot_id = l.lot_id
                JOIN blocks b ON l.block_id = b.block_id
                JOIN sections s ON b.section_id = s.section_id
                WHERE 1=1";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT e.*, l.lot_number, b.block_name, s.section_name,
                   CASE
                     WHEN e.end_date < CURDATE() THEN 'Expired'
                     WHEN e.exhumation_status = 'Scheduled' THEN 'Exhumation'
                     WHEN e.renewed = 'no' AND e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'Expiring'
                     WHEN e.renewed = 'yes' THEN 'Renewed'
                     ELSE 'Active'
                   END AS status
                FROM expiration_records e
                JOIN lots l ON e.lot_id = l.lot_id
                JOIN blocks b ON l.block_id = b.block_id
                JOIN sections s ON b.section_id = s.section_id
                WHERE e.expiration_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    // $pagination optional, same {page, per_page} shape as findAll(); omitted
    // (the report page's current behavior) returns every matching row.
    public function findExpiringSoon($days = 30, $pagination = []) {
        $sql = "SELECT e.*, l.lot_number, b.block_name, s.section_name FROM expiration_records e JOIN lots l ON e.lot_id = l.lot_id JOIN blocks b ON l.block_id = b.block_id JOIN sections s ON b.section_id = s.section_id WHERE e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY) ORDER BY e.end_date ASC";
        $params = [$days];

        $page = null;
        $perPage = null;
        if (!empty($pagination['page']) || !empty($pagination['per_page'])) {
            $page = max(1, (int) ($pagination['page'] ?? 1));
            $perPage = max(1, min(100, (int) ($pagination['per_page'] ?? 10)));
        }
        if ($page !== null && $perPage !== null) {
            $sql .= " LIMIT ?, ?";
            $params[] = ($page - 1) * $perPage;
            $params[] = $perPage;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    // Batch D (Admin-Wide Automation Audit): the notification-generation
    // counterpart to findExpiringSoon() above — only returns rows that
    // haven't already triggered an "expiring soon" notification, so
    // ExpirationController::generateNotifications() can be called repeatedly
    // (e.g. every time an admin opens the Notifications page) without
    // creating a duplicate notification each time.
    public function findExpiringSoonUnnotified($days = 30) {
        $sql = "SELECT e.*, l.lot_number, b.block_name, s.section_name FROM expiration_records e JOIN lots l ON e.lot_id = l.lot_id JOIN blocks b ON l.block_id = b.block_id JOIN sections s ON b.section_id = s.section_id WHERE e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY) AND e.notified_at IS NULL ORDER BY e.end_date ASC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$days]);
        return $stmt->fetchAll();
    }

    public function markNotified($id) {
        $stmt = $this->db->prepare("UPDATE expiration_records SET notified_at = NOW() WHERE expiration_id = ?");
        return $stmt->execute([(int) $id]);
    }

    public function countExpiringSoon($days = 30) {
        $stmt = $this->db->prepare("SELECT COUNT(*) AS total FROM expiration_records e WHERE e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)");
        $stmt->execute([$days]);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function findExpired($pagination = []) {
        $sql = "SELECT e.*, l.lot_number, b.block_name, s.section_name FROM expiration_records e JOIN lots l ON e.lot_id = l.lot_id JOIN blocks b ON l.block_id = b.block_id JOIN sections s ON b.section_id = s.section_id WHERE e.end_date < CURDATE() ORDER BY e.end_date DESC";
        $params = [];

        $page = null;
        $perPage = null;
        if (!empty($pagination['page']) || !empty($pagination['per_page'])) {
            $page = max(1, (int) ($pagination['page'] ?? 1));
            $perPage = max(1, min(100, (int) ($pagination['per_page'] ?? 10)));
        }
        if ($page !== null && $perPage !== null) {
            $sql .= " LIMIT ?, ?";
            $params[] = ($page - 1) * $perPage;
            $params[] = $perPage;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function countExpired() {
        $stmt = $this->db->query("SELECT COUNT(*) AS total FROM expiration_records e WHERE e.end_date < CURDATE()");
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function create($data) {
        $stmt = $this->db->prepare("INSERT INTO expiration_records (lot_id, start_date, end_date, renewed, exhumation_status, notes) VALUES (?, ?, ?, ?, ?, ?)");
        return $stmt->execute([
            $data['lot_id'],
            $data['start_date'] ?? null,
            $data['end_date'] ?? null,
            $data['renewed'] ?? 'no',
            $data['exhumation_status'] ?? 'Pending',
            $data['notes'] ?? null,
        ]);
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare("UPDATE expiration_records SET lot_id = ?, start_date = ?, end_date = ?, renewed = ?, exhumation_status = ?, notes = ? WHERE expiration_id = ?");
        return $stmt->execute([
            $data['lot_id'],
            $data['start_date'] ?? null,
            $data['end_date'] ?? null,
            $data['renewed'] ?? 'no',
            $data['exhumation_status'] ?? 'Pending',
            $data['notes'] ?? null,
            $id,
        ]);
    }

    public function getStats($days = 30) {
        $stmt1 = $this->db->prepare("SELECT COUNT(*) AS total FROM expiration_records");
        $stmt1->execute();
        $total = $stmt1->fetchColumn();

        $stmt2 = $this->db->prepare("SELECT COUNT(*) AS renewed FROM expiration_records WHERE renewed = 'yes'");
        $stmt2->execute();
        $renewed = $stmt2->fetchColumn();

        $stmt3 = $this->db->prepare("SELECT COUNT(*) AS expired FROM expiration_records WHERE end_date < CURDATE()");
        $stmt3->execute();
        $expired = $stmt3->fetchColumn();

        $stmt4 = $this->db->prepare("SELECT COUNT(*) AS expiring_soon FROM expiration_records WHERE end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)");
        $stmt4->execute([$days]);
        $expiringSoon = $stmt4->fetchColumn();

        $stmt5 = $this->db->prepare("SELECT COUNT(*) AS renewals_due FROM expiration_records WHERE renewed = 'no' AND end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)");
        $stmt5->execute([$days]);
        $renewalsDue = $stmt5->fetchColumn();

        $stmt6 = $this->db->prepare("SELECT COUNT(*) AS exhumations FROM expiration_records WHERE exhumation_status = 'Scheduled'");
        $stmt6->execute();
        $exhumations = $stmt6->fetchColumn();

        return [
            'total' => (int) $total,
            'renewed' => (int) $renewed,
            'expired' => (int) $expired,
            'expiring_soon' => (int) $expiringSoon,
            'renewals_due' => (int) $renewalsDue,
            'exhumations' => (int) $exhumations,
        ];
    }
}
