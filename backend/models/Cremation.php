<?php
require_once __DIR__ . '/../config/database.php';

class Cremation {
    private $db;

    // Default niche slots shown/assumed per columbarium when no real capacity
    // config exists yet. Shared by getNiches() (grid template) and getStats()
    // (capacity denominator) so the two stay consistent.
    const DEFAULT_CAPACITY = 10;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    private function applyFilters(&$sql, &$params, $filters) {
        if (!empty($filters['status'])) {
            $sql .= " AND c.status = ?";
            $params[] = $filters['status'];
        }
        if (!empty($filters['columbarium'])) {
            $sql .= " AND c.columbarium = ?";
            $params[] = $filters['columbarium'];
        }
        if (!empty($filters['deceased_id'])) {
            $sql .= " AND c.deceased_id = ?";
            $params[] = (int) $filters['deceased_id'];
        }
        if (!empty($filters['q'])) {
            $sql .= " AND (c.niche_number LIKE ? OR d.first_name LIKE ? OR d.last_name LIKE ? OR dr.full_name LIKE ?)";
            $search = '%' . $filters['q'] . '%';
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
        }
    }

    // Cremation Phase B: deceased_id is now nullable (see
    // migration_20260903_add_cremation_provisional_booking.sql) — a citizen
    // can book against a decedent_requests row instead of a formal
    // decedent_records one. JOIN -> LEFT JOIN so those rows aren't silently
    // excluded (the exact bug Decedent Phase A found and fixed for
    // decedent_records.lot_id). provisional_name/provisional_status mirror
    // Schedule::findAll()'s identical pattern for burial_schedules.
    public function findAll($filters = [], $pagination = []) {
        $sql = "
            SELECT c.*,
                   d.first_name, d.last_name,
                   dr.full_name AS provisional_name, dr.status AS provisional_status,
                   u.full_name as created_by_name
            FROM cremation_records c
            LEFT JOIN decedent_records d ON c.deceased_id = d.decedent_id
            LEFT JOIN decedent_requests dr ON c.decedent_request_id = dr.request_id
            LEFT JOIN users u ON c.created_by = u.user_id
            WHERE 1=1
        ";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $sql .= " ORDER BY c.created_at DESC";

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
        $sql = "
            SELECT COUNT(*) AS total
            FROM cremation_records c
            LEFT JOIN decedent_records d ON c.deceased_id = d.decedent_id
            LEFT JOIN decedent_requests dr ON c.decedent_request_id = dr.request_id
            LEFT JOIN users u ON c.created_by = u.user_id
            WHERE 1=1
        ";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function findById($id) {
        $stmt = $this->db->prepare("
            SELECT c.*,
                   d.first_name, d.last_name,
                   dr.full_name AS provisional_name, dr.status AS provisional_status,
                   u.full_name as created_by_name
            FROM cremation_records c
            LEFT JOIN decedent_records d ON c.deceased_id = d.decedent_id
            LEFT JOIN decedent_requests dr ON c.decedent_request_id = dr.request_id
            LEFT JOIN users u ON c.created_by = u.user_id
            WHERE c.cremation_id = ?
        ");
        $stmt->execute([(int) $id]);
        return $stmt->fetch();
    }

    // Batch (Cremation Phase B): lets DecedentRequestController::approve()
    // find the cremation(s) (if any) created against this request's
    // decedent_request_id, so the formal decedent record can be auto-linked
    // — mirrors Schedule::findByDecedentRequestId() exactly.
    public function findByDecedentRequestId($requestId) {
        $stmt = $this->db->prepare("SELECT * FROM cremation_records WHERE decedent_request_id = ?");
        $stmt->execute([(int) $requestId]);
        return $stmt->fetchAll();
    }

    public function findNiche($nicheNumber) {
        $stmt = $this->db->prepare(" 
            SELECT * FROM cremation_records 
            WHERE niche_number = ? AND status != 'Cancelled'
        ");
        $stmt->execute([$nicheNumber]);
        return $stmt->fetch();
    }

    public function getNiches($columbarium = null) {
        $rows = [];
        $defaultColumbarium = $columbarium ?? 'Columbarium A';

        for ($i = 1; $i <= self::DEFAULT_CAPACITY; $i++) {
            $rows[] = [
                'niche_number' => 'N-' . $i,
                'columbarium' => $defaultColumbarium,
                'level' => 1,
                'status' => 'available',
                'first_name' => null,
                'last_name' => null,
                'cremation_id' => null,
            ];
        }

        $sql = "
            SELECT c.cremation_id, c.niche_number, c.columbarium, c.level, c.status,
                   d.first_name, d.last_name
            FROM cremation_records c
            LEFT JOIN decedent_records d ON c.deceased_id = d.decedent_id
            WHERE 1=1
        ";
        $params = [];

        if ($columbarium) {
            $sql .= " AND (c.columbarium = ? OR c.columbarium IS NULL)";
            $params[] = $columbarium;
        }

        $sql .= " ORDER BY c.created_at DESC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $records = $stmt->fetchAll();

        foreach ($records as $record) {
            $nicheNumber = $record['niche_number'] ?? null;
            $suffix = preg_replace('/\D/', '', (string) $nicheNumber);
            $index = $suffix !== '' ? ((int) $suffix - 1) : null;
            $status = (string) ($record['status'] ?? 'Scheduled');
            $normalizedStatus = $status === 'Cancelled' ? 'available' : 'occupied';

            $row = [
                'niche_number' => $nicheNumber ?: 'N-' . (count($rows) + 1),
                'columbarium' => $record['columbarium'] ?? $defaultColumbarium,
                'level' => $record['level'] ?? 1,
                'status' => $normalizedStatus,
                'first_name' => $record['first_name'] ?? null,
                'last_name' => $record['last_name'] ?? null,
                'cremation_id' => $record['cremation_id'] ?? null,
            ];

            if ($index !== null && isset($rows[$index])) {
                $rows[$index] = $row;
            } else {
                $rows[] = $row;
            }
        }

        return $rows;
    }

    // deceased_id/decedent_request_id are mutually exclusive (see
    // CremationController::store()) — passed through null-aware rather than
    // cast with (int), which would turn a genuinely absent value into 0 and
    // violate the fk_cremation_lot-style FK constraint. Mirrors
    // Schedule::create()'s identical convention.
    public function create($data) {
        $stmt = $this->db->prepare("
            INSERT INTO cremation_records
            (deceased_id, decedent_request_id, niche_number, columbarium, level, cremation_date, status, ash_storage_location, notes, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $success = $stmt->execute([
            !empty($data['deceased_id']) ? (int) $data['deceased_id'] : null,
            !empty($data['decedent_request_id']) ? (int) $data['decedent_request_id'] : null,
            $data['niche_number'] ?? null,
            $data['columbarium'] ?? null,
            isset($data['level']) ? (int) $data['level'] : null,
            $data['cremation_date'] ?? null,
            $data['status'] ?? 'Scheduled',
            $data['ash_storage_location'] ?? null,
            $data['notes'] ?? null,
            (int) $data['created_by']
        ]);
        return $success ? (int) $this->db->lastInsertId() : false;
    }

    // Formalizing a provisional booking (CremationController::linkDecedent())
    // sets deceased_id while leaving decedent_request_id in place for audit
    // traceability — decedent_request_id is only ever changed by an explicit
    // key in $data, never implicitly cleared here. Mirrors Schedule::update()'s
    // identical convention.
    public function update($id, $data) {
        $existing = $this->findById($id);
        if (!$existing) {
            return false;
        }

        $stmt = $this->db->prepare("
            UPDATE cremation_records SET
                deceased_id = ?,
                decedent_request_id = ?,
                niche_number = ?,
                columbarium = ?,
                level = ?,
                cremation_date = ?,
                status = ?,
                ash_storage_location = ?,
                notes = ?
            WHERE cremation_id = ?
        ");
        return $stmt->execute([
            array_key_exists('deceased_id', $data)
                ? (!empty($data['deceased_id']) ? (int) $data['deceased_id'] : null)
                : (!empty($existing['deceased_id']) ? (int) $existing['deceased_id'] : null),
            array_key_exists('decedent_request_id', $data)
                ? (!empty($data['decedent_request_id']) ? (int) $data['decedent_request_id'] : null)
                : (!empty($existing['decedent_request_id']) ? (int) $existing['decedent_request_id'] : null),
            $data['niche_number'] ?? null,
            $data['columbarium'] ?? null,
            isset($data['level']) ? (int) $data['level'] : null,
            $data['cremation_date'] ?? null,
            $data['status'] ?? 'Scheduled',
            $data['ash_storage_location'] ?? null,
            $data['notes'] ?? null,
            (int) $id
        ]);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM cremation_records WHERE cremation_id = ?");
        return $stmt->execute([(int) $id]);
    }

    public function getStats($columbarium = null) {
        $sql = "
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN status != 'Cancelled' THEN 1 ELSE 0 END) as occupied
            FROM cremation_records
            WHERE 1=1
        ";
        $params = [];
        if ($columbarium) {
            $sql .= " AND (columbarium = ? OR columbarium IS NULL)";
            $params[] = $columbarium;
        }
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $result = $stmt->fetch();

        $occupied = isset($result['occupied']) ? (int) $result['occupied'] : 0;
        // Capacity isn't tracked by a real column/table yet, so it's assumed to be
        // the default niche grid size, growing to match occupied niches if that
        // ever exceeds the default. Cancelled records are never counted as
        // capacity used (only $occupied, which already excludes them, does).
        $capacity = max(self::DEFAULT_CAPACITY, $occupied);
        $available = $capacity - $occupied;
        $result['total'] = $capacity;
        $result['occupied'] = $occupied;
        $result['available'] = $available;
        $result['occupancy_rate'] = $capacity > 0 ? round(($occupied / $capacity) * 100) : 0;

        return $result;
    }

    // Batch N6 (adviser feedback 2026-08-18): "suggest na i-automate" the
    // cremation board — staff currently has to invent a niche_number/level
    // by hand. Reuses getNiches()'s existing virtual-grid logic (same
    // DEFAULT_CAPACITY-slot model already used for the grid display and
    // stats) so the suggestion can never drift from what the grid/stats
    // themselves consider "available".
    public function findNextAvailableNiche($columbarium = null) {
        foreach ($this->getNiches($columbarium) as $niche) {
            if ($niche['status'] === 'available') {
                return [
                    'niche_number' => $niche['niche_number'],
                    'columbarium' => $niche['columbarium'],
                    'level' => $niche['level'],
                ];
            }
        }
        return null;
    }

    // Real columbarium names actually in use, so the frontend can offer a
    // dropdown instead of a free-text field that drifts into inconsistent
    // spellings ("Columbarium A" vs "columbarium a" vs "Col. A") over time.
    public function getDistinctColumbariums() {
        $stmt = $this->db->prepare("
            SELECT DISTINCT columbarium FROM cremation_records
            WHERE columbarium IS NOT NULL AND columbarium != ''
            ORDER BY columbarium
        ");
        $stmt->execute();
        return array_column($stmt->fetchAll(), 'columbarium');
    }

    public function isNicheAvailable($nicheNumber) {
        $stmt = $this->db->prepare(" 
            SELECT COUNT(*) as count FROM cremation_records 
            WHERE niche_number = ? AND status != 'Cancelled'
        ");
        $stmt->execute([$nicheNumber]);
        $result = $stmt->fetch();
        return isset($result['count']) ? ((int) $result['count'] === 0) : true;
    }
}
