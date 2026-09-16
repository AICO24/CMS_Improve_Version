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
        if (!empty($filters['section'])) {
            $sql .= " AND (s.section_name = ? OR s.section_id = ?)";
            $params[] = $filters['section'];
            $params[] = $filters['section'];
        }

        if (!empty($filters['q'])) {
            $search = '%' . $filters['q'] . '%';
            $sql .= " AND (l.lot_number LIKE ? OR b.block_name LIKE ? OR s.section_name LIKE ? OR e.notes LIKE ? OR d.decedent_name LIKE ? OR d.contact_name LIKE ? OR d.contact_number LIKE ?)";
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
        }

        if (!empty($filters['urgency'])) {
            switch ($filters['urgency']) {
                case 'overdue':
                    $sql .= " AND e.end_date < CURDATE() AND e.renewed = 'no'";
                    break;
                case '7days':
                    $sql .= " AND e.renewed = 'no' AND e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)";
                    break;
                case '30days':
                    $sql .= " AND e.renewed = 'no' AND e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)";
                    break;
                case '90days':
                    $sql .= " AND e.renewed = 'no' AND e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 90 DAY)";
                    break;
                case 'renewed':
                    $sql .= " AND e.renewed = 'yes'";
                    break;
            }
        }

        if (!empty($filters['status']) && $filters['status'] !== 'all') {
            switch ($filters['status']) {
                case 'expiring':
                    $sql .= " AND e.renewed = 'no' AND e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY)";
                    break;
                case 'expired':
                    $sql .= " AND e.end_date < CURDATE() AND e.renewed = 'no'";
                    break;
                case 'renewal':
                    $sql .= " AND e.renewed = 'no' AND e.end_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)";
                    break;
                case 'exhumation':
                    $sql .= " AND (e.exhumation_status = 'Scheduled' OR e.exhumation_status = 'Pending')";
                    break;
                case 'renewed':
                    $sql .= " AND e.renewed = 'yes'";
                    break;
                case 'active':
                    $sql .= " AND e.end_date > DATE_ADD(CURDATE(), INTERVAL 30 DAY)";
                    break;
            }
        }
    }

    public function findAll($filters = [], $pagination = []) {
        $sql = "SELECT e.*, 
                       l.lot_number, l.dimensions, l.price, l.status AS lot_status, l.location_notes,
                       b.block_name, 
                       s.section_name, s.section_id,
                       lt.type_name AS lot_type_name,
                       d.decedent_id,
                       d.decedent_name,
                       d.contact_name,
                       d.contact_number,
                       d.dod,
                       DATEDIFF(e.end_date, CURDATE()) AS days_remaining,
                       CASE
                         WHEN e.renewed = 'yes' THEN 'Renewed'
                         WHEN e.exhumation_status = 'Scheduled' THEN 'Exhumation'
                         WHEN e.end_date < CURDATE() THEN 'Expired'
                         WHEN e.renewed = 'no' AND e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'Expiring'
                         ELSE 'Active'
                       END AS status
                FROM expiration_records e
                JOIN lots l ON e.lot_id = l.lot_id
                JOIN blocks b ON l.block_id = b.block_id
                JOIN sections s ON b.section_id = s.section_id
                LEFT JOIN lot_types lt ON l.lot_type_id = lt.type_id
                LEFT JOIN (
                    SELECT 
                        lot_id, 
                        MIN(decedent_id) AS decedent_id,
                        GROUP_CONCAT(TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) SEPARATOR ', ') AS decedent_name,
                        MAX(contact_name) AS contact_name,
                        MAX(contact_number) AS contact_number,
                        MAX(dod) AS dod
                    FROM decedent_records
                    WHERE deleted_at IS NULL
                    GROUP BY lot_id
                ) d ON l.lot_id = d.lot_id
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
                LEFT JOIN lot_types lt ON l.lot_type_id = lt.type_id
                LEFT JOIN (
                    SELECT 
                        lot_id, 
                        MIN(decedent_id) AS decedent_id,
                        GROUP_CONCAT(TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) SEPARATOR ', ') AS decedent_name,
                        MAX(contact_name) AS contact_name,
                        MAX(contact_number) AS contact_number
                    FROM decedent_records
                    WHERE deleted_at IS NULL
                    GROUP BY lot_id
                ) d ON l.lot_id = d.lot_id
                WHERE 1=1";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT e.*, 
                   l.lot_number, l.dimensions, l.price, l.status AS lot_status, l.location_notes,
                   b.block_name, 
                   s.section_name, s.section_id,
                   lt.type_name AS lot_type_name,
                   d.decedent_id,
                   d.decedent_name,
                   d.contact_name,
                   d.contact_number,
                   d.dod,
                   DATEDIFF(e.end_date, CURDATE()) AS days_remaining,
                   CASE
                     WHEN e.renewed = 'yes' THEN 'Renewed'
                     WHEN e.exhumation_status = 'Scheduled' THEN 'Exhumation'
                     WHEN e.end_date < CURDATE() THEN 'Expired'
                     WHEN e.renewed = 'no' AND e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'Expiring'
                     ELSE 'Active'
                   END AS status
                FROM expiration_records e
                JOIN lots l ON e.lot_id = l.lot_id
                JOIN blocks b ON l.block_id = b.block_id
                JOIN sections s ON b.section_id = s.section_id
                LEFT JOIN lot_types lt ON l.lot_type_id = lt.type_id
                LEFT JOIN (
                    SELECT 
                        lot_id, 
                        MIN(decedent_id) AS decedent_id,
                        GROUP_CONCAT(TRIM(CONCAT(COALESCE(first_name,''), ' ', COALESCE(last_name,''))) SEPARATOR ', ') AS decedent_name,
                        MAX(contact_name) AS contact_name,
                        MAX(contact_number) AS contact_number,
                        MAX(dod) AS dod
                    FROM decedent_records
                    WHERE deleted_at IS NULL
                    GROUP BY lot_id
                ) d ON l.lot_id = d.lot_id
                WHERE e.expiration_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    // $pagination optional, same {page, per_page} shape as findAll(); omitted
    // (the report page's current behavior) returns every matching row.
    public function findExpiringSoon($days = 30, $pagination = [], $filters = []) {
        $sql = "SELECT e.*, l.lot_number, b.block_name, s.section_name FROM expiration_records e JOIN lots l ON e.lot_id = l.lot_id JOIN blocks b ON l.block_id = b.block_id JOIN sections s ON b.section_id = s.section_id WHERE e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)";
        $params = [$days];

        if (!empty($filters['date_from'])) {
            $sql .= " AND e.end_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND e.end_date <= ?";
            $params[] = $filters['date_to'];
        }

        $sql .= " ORDER BY e.end_date ASC";

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

    public function countExpiringSoon($days = 30, $filters = []) {
        $sql = "SELECT COUNT(*) AS total FROM expiration_records e WHERE e.end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)";
        $params = [$days];

        if (!empty($filters['date_from'])) {
            $sql .= " AND e.end_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND e.end_date <= ?";
            $params[] = $filters['date_to'];
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function findExpired($pagination = [], $filters = []) {
        $sql = "SELECT e.*, l.lot_number, b.block_name, s.section_name FROM expiration_records e JOIN lots l ON e.lot_id = l.lot_id JOIN blocks b ON l.block_id = b.block_id JOIN sections s ON b.section_id = s.section_id WHERE e.end_date < CURDATE()";
        $params = [];

        if (!empty($filters['date_from'])) {
            $sql .= " AND e.end_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND e.end_date <= ?";
            $params[] = $filters['date_to'];
        }

        $sql .= " ORDER BY e.end_date DESC";

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

    public function countExpired($filters = []) {
        $sql = "SELECT COUNT(*) AS total FROM expiration_records e WHERE e.end_date < CURDATE()";
        $params = [];

        if (!empty($filters['date_from'])) {
            $sql .= " AND e.end_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND e.end_date <= ?";
            $params[] = $filters['date_to'];
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function findRenewalDue($days = 30, $pagination = [], $filters = []) {
        $sql = "SELECT e.*, l.lot_number, b.block_name, s.section_name FROM expiration_records e JOIN lots l ON e.lot_id = l.lot_id JOIN blocks b ON l.block_id = b.block_id JOIN sections s ON b.section_id = s.section_id WHERE e.renewed = 'no' AND e.end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)";
        $params = [$days];

        if (!empty($filters['date_from'])) {
            $sql .= " AND e.end_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND e.end_date <= ?";
            $params[] = $filters['date_to'];
        }

        $sql .= " ORDER BY e.end_date ASC";

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

    public function countRenewalDue($days = 30, $filters = []) {
        $sql = "SELECT COUNT(*) AS total FROM expiration_records e WHERE e.renewed = 'no' AND e.end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)";
        $params = [$days];

        if (!empty($filters['date_from'])) {
            $sql .= " AND e.end_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND e.end_date <= ?";
            $params[] = $filters['date_to'];
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function findPendingReview($pagination = [], $filters = []) {
        $sql = "SELECT e.*, l.lot_number, b.block_name, s.section_name FROM expiration_records e JOIN lots l ON e.lot_id = l.lot_id JOIN blocks b ON l.block_id = b.block_id JOIN sections s ON b.section_id = s.section_id WHERE e.exhumation_status = 'Pending'";
        $params = [];

        if (!empty($filters['date_from'])) {
            $sql .= " AND e.end_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND e.end_date <= ?";
            $params[] = $filters['date_to'];
        }

        $sql .= " ORDER BY e.end_date ASC";

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

    public function countPendingReview($filters = []) {
        $sql = "SELECT COUNT(*) AS total FROM expiration_records e WHERE e.exhumation_status = 'Pending'";
        $params = [];

        if (!empty($filters['date_from'])) {
            $sql .= " AND e.end_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND e.end_date <= ?";
            $params[] = $filters['date_to'];
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
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

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM expiration_records WHERE expiration_id = ?");
        return $stmt->execute([$id]);
    }

    public function getStats($days = 30) {
        $stmt1 = $this->db->prepare("SELECT COUNT(*) AS total FROM expiration_records");
        $stmt1->execute();
        $total = (int) $stmt1->fetchColumn();

        $stmt2 = $this->db->prepare("SELECT COUNT(*) AS renewed FROM expiration_records WHERE renewed = 'yes'");
        $stmt2->execute();
        $renewed = (int) $stmt2->fetchColumn();

        $stmt3 = $this->db->prepare("SELECT COUNT(*) AS expired FROM expiration_records WHERE end_date < CURDATE() AND renewed = 'no'");
        $stmt3->execute();
        $expired = (int) $stmt3->fetchColumn();

        $stmt4 = $this->db->prepare("SELECT COUNT(*) AS expiring_soon FROM expiration_records WHERE renewed = 'no' AND end_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL ? DAY)");
        $stmt4->execute([$days]);
        $expiringSoon = (int) $stmt4->fetchColumn();

        $stmt5 = $this->db->prepare("SELECT COUNT(*) AS renewals_due FROM expiration_records WHERE renewed = 'no' AND end_date <= DATE_ADD(CURDATE(), INTERVAL ? DAY)");
        $stmt5->execute([$days]);
        $renewalsDue = (int) $stmt5->fetchColumn();

        $stmt6 = $this->db->prepare("SELECT COUNT(*) AS exhumations FROM expiration_records WHERE exhumation_status IN ('Scheduled', 'Pending') AND end_date < CURDATE()");
        $stmt6->execute();
        $exhumations = (int) $stmt6->fetchColumn();

        $stmt7 = $this->db->prepare("SELECT COUNT(*) AS pending_review FROM expiration_records WHERE exhumation_status = 'Pending'");
        $stmt7->execute();
        $pendingReview = (int) $stmt7->fetchColumn();

        $stmt8 = $this->db->prepare("SELECT COUNT(*) AS active FROM expiration_records WHERE end_date > DATE_ADD(CURDATE(), INTERVAL ? DAY)");
        $stmt8->execute([$days]);
        $active = (int) $stmt8->fetchColumn();

        return [
            'total' => $total,
            'renewed' => $renewed,
            'expired' => $expired,
            'expiring_soon' => $expiringSoon,
            'renewals_due' => $renewalsDue,
            'pending_review' => $pendingReview,
            'exhumations' => $exhumations,
            'active' => $active,
        ];
    }

    public function renewLease($id, $years = 5, $notes = '', $userId = null) {
        $existing = $this->findById($id);
        if (!$existing) {
            return ['error' => 'Expiration record not found', 'code' => 404];
        }

        $years = max(1, (int) $years);
        $baseTimestamp = ($existing['end_date'] && strtotime($existing['end_date']) > time()) 
            ? strtotime($existing['end_date']) 
            : time();
        $newEndDate = date('Y-m-d', strtotime("+$years years", $baseTimestamp));
        
        $prevNotes = $existing['notes'] ? trim($existing['notes']) : '';
        $renewalTag = "Renewed for {$years} yr(s) on " . date('Y-m-d') . ($notes ? ": " . trim($notes) : "");
        $combinedNotes = $prevNotes ? "$prevNotes | $renewalTag" : $renewalTag;

        $stmt = $this->db->prepare("
            UPDATE expiration_records 
            SET end_date = ?, renewed = 'yes', exhumation_status = 'Not Required', notes = ?, updated_at = NOW()
            WHERE expiration_id = ?
        ");
        $stmt->execute([$newEndDate, $combinedNotes, $id]);

        $stmtLot = $this->db->prepare("
            UPDATE lots 
            SET lease_end_date = ?, status = 'Occupied', updated_at = NOW()
            WHERE lot_id = ?
        ");
        $stmtLot->execute([$newEndDate, $existing['lot_id']]);

        require_once __DIR__ . '/AuditLog.php';
        $audit = new AuditLog();
        $audit->log(
            'Lease renewed',
            $userId,
            null,
            'Expiration',
            $id,
            [
                'lot_id' => $existing['lot_id'],
                'previous_end_date' => $existing['end_date'],
                'new_end_date' => $newEndDate,
                'term_years' => $years
            ]
        );

        return [
            'success' => true,
            'message' => "Lease renewed successfully until $newEndDate",
            'new_end_date' => $newEndDate,
            'data' => $this->findById($id)
        ];
    }

    public function syncFromLots() {
        $sql = "
            SELECT l.lot_id, l.lease_start_date, l.lease_end_date
            FROM lots l
            LEFT JOIN expiration_records e ON l.lot_id = e.lot_id
            WHERE e.expiration_id IS NULL 
              AND (l.lease_end_date IS NOT NULL OR l.status = 'Occupied')
        ";
        $missingLots = $this->db->query($sql)->fetchAll(PDO::FETCH_ASSOC);
        $added = 0;

        $insertStmt = $this->db->prepare("
            INSERT INTO expiration_records (lot_id, start_date, end_date, renewed, exhumation_status, notes)
            VALUES (?, ?, ?, 'no', 'Pending', 'Auto-synced from lots registry')
        ");

        foreach ($missingLots as $lot) {
            $startDate = $lot['lease_start_date'] ?: date('Y-m-d', strtotime('-5 years'));
            $endDate = $lot['lease_end_date'] ?: date('Y-m-d', strtotime('+5 years', strtotime($startDate)));
            $insertStmt->execute([$lot['lot_id'], $startDate, $endDate]);
            $added++;
        }

        $updateSql = "
            UPDATE expiration_records e
            JOIN lots l ON e.lot_id = l.lot_id
            SET e.end_date = l.lease_end_date
            WHERE l.lease_end_date IS NOT NULL 
              AND e.end_date != l.lease_end_date 
              AND e.renewed = 'no'
        ";
        $updated = $this->db->exec($updateSql);

        return [
            'success' => true,
            'message' => "Synced $added new lot(s), updated $updated existing record(s)",
            'added' => $added,
            'updated' => (int) $updated
        ];
    }

    public function initiateRelocation($id, $data = [], $userId = null) {
        $existing = $this->findById($id);
        if (!$existing) {
            return ['error' => 'Expiration record not found', 'code' => 404];
        }

        $fromLotId = (int) $existing['lot_id'];
        $deceasedId = !empty($data['deceased_id']) ? (int) $data['deceased_id'] : (!empty($existing['decedent_id']) ? (int) $existing['decedent_id'] : null);
        
        if (!$deceasedId) {
            $stmtD = $this->db->prepare("SELECT decedent_id FROM decedent_records WHERE lot_id = ? AND deleted_at IS NULL LIMIT 1");
            $stmtD->execute([$fromLotId]);
            $deceasedId = (int) $stmtD->fetchColumn();
        }

        if (!$deceasedId) {
            return ['error' => 'No deceased record found for this lot to initiate relocation', 'code' => 400];
        }

        $toLotId = !empty($data['to_lot_id']) ? (int) $data['to_lot_id'] : null;
        if (!$toLotId) {
            $stmtAvail = $this->db->query("SELECT lot_id FROM lots WHERE status = 'Available' AND lot_id != $fromLotId ORDER BY lot_id ASC LIMIT 1");
            $toLotId = (int) $stmtAvail->fetchColumn();
        }

        if (!$toLotId) {
            return ['error' => 'No destination lot available for relocation transfer', 'code' => 400];
        }

        $reason = !empty($data['reason']) ? trim($data['reason']) : 'Lease Expired without Renewal - Exhumation and Relocation Required';
        $requestedBy = $userId ? (int) $userId : 1;

        $stmtReloc = $this->db->prepare("
            INSERT INTO relocation_requests (from_lot_id, to_lot_id, deceased_id, reason, status, requested_by, created_at, updated_at)
            VALUES (?, ?, ?, ?, 'Pending', ?, NOW(), NOW())
        ");
        $success = $stmtReloc->execute([$fromLotId, $toLotId, $deceasedId, $reason, $requestedBy]);
        
        if (!$success) {
            return ['error' => 'Failed to create relocation request', 'code' => 500];
        }

        $requestId = (int) $this->db->lastInsertId();

        $stmtExp = $this->db->prepare("
            UPDATE expiration_records 
            SET exhumation_status = 'Scheduled', 
                notes = CONCAT(COALESCE(notes, ''), ' | Initiated Relocation Request #REQ-', ?),
                updated_at = NOW() 
            WHERE expiration_id = ?
        ");
        $stmtExp->execute([$requestId, $id]);

        require_once __DIR__ . '/AuditLog.php';
        $audit = new AuditLog();
        $audit->log(
            'Relocation initiated from expired lease',
            $userId,
            null,
            'Expiration',
            $id,
            [
                'request_id' => $requestId,
                'from_lot_id' => $fromLotId,
                'to_lot_id' => $toLotId,
                'deceased_id' => $deceasedId
            ]
        );

        return [
            'success' => true,
            'message' => "Relocation request #REQ-$requestId initiated successfully",
            'request_id' => $requestId
        ];
    }
}
