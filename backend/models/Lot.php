<?php
require_once __DIR__ . '/../config/database.php';

class Lot {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    // Follows the same "sync lazily on read" convention already used by
    // ReportController::occupancy() for occupancy_snapshots (see docs/database.md)
    // rather than a cron job, since this app has no scheduler set up. Only flips
    // Occupied lots whose latest expiration_records lease has lapsed and was
    // never marked renewed. Deliberately excludes Reserved: a lot can be
    // rebooked after being freed (manually reset from Expired to Available,
    // then re-confirmed), and during the window between that re-confirmation
    // and the new burial's completion the "latest" expiration record on file is
    // still the *previous* tenant's — touching Reserved here would wrongly
    // re-expire a lot that's actively being booked again. ScheduleController's
    // createLeaseRecordIfMissing() keys its own dedupe on (lot_id, start_date)
    // for the same reason, so a genuinely new occupancy always gets its own
    // fresh record once it completes.
    private function syncExpiredLots() {
        $this->db->exec("
            UPDATE lots l
            JOIN (
                SELECT er.lot_id, er.end_date, er.renewed
                FROM expiration_records er
                INNER JOIN (
                    SELECT lot_id, MAX(expiration_id) AS max_id
                    FROM expiration_records
                    GROUP BY lot_id
                ) latest ON latest.lot_id = er.lot_id AND latest.max_id = er.expiration_id
            ) e ON e.lot_id = l.lot_id
            SET l.status = 'Expired'
            WHERE e.renewed = 'no'
              AND e.end_date < CURDATE()
              AND l.status = 'Occupied'
        ");
    }

    private function applyFilters(&$sql, &$params, $filters) {
        if (!empty($filters['section'])) {
            $sql .= " AND s.section_name = ?";
            $params[] = $filters['section'];
        }
        if (!empty($filters['lot_number'])) {
            $sql .= " AND l.lot_number LIKE ?";
            $params[] = '%' . $filters['lot_number'] . '%';
        }
        if (!empty($filters['lot_type'])) {
            $sql .= " AND t.type_name = ?";
            $params[] = $filters['lot_type'];
        }
        if (!empty($filters['min_price'])) {
            $sql .= " AND l.price >= ?";
            $params[] = (float) $filters['min_price'];
        }
        if (!empty($filters['max_price'])) {
            $sql .= " AND l.price <= ?";
            $params[] = (float) $filters['max_price'];
        }
        if (!empty($filters['status'])) {
            $sql .= " AND l.status = ?";
            $params[] = $filters['status'];
        }
        if (!empty($filters['block_id'])) {
            $sql .= " AND l.block_id = ?";
            $params[] = $filters['block_id'];
        }
    }

    public function findAll($filters = [], $pagination = []) {
        $this->syncExpiredLots();
        $sql = "
            SELECT l.*, b.block_name, s.section_name, t.type_name as lot_type_name
            FROM lots l
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections s ON b.section_id = s.section_id
            JOIN lot_types t ON l.lot_type_id = t.type_id
            WHERE 1=1
        ";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $sql .= " ORDER BY s.section_name, b.block_name, l.lot_number";

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
        $this->syncExpiredLots();
        $sql = "
            SELECT COUNT(*) AS total
            FROM lots l
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections s ON b.section_id = s.section_id
            JOIN lot_types t ON l.lot_type_id = t.type_id
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
        $this->syncExpiredLots();
        $stmt = $this->db->prepare("
            SELECT l.*, b.block_name, s.section_name, t.type_name as lot_type_name
            FROM lots l
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections s ON b.section_id = s.section_id
            JOIN lot_types t ON l.lot_type_id = t.type_id
            WHERE l.lot_id = ?
        ");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    // Locking read for the transactional booking flow (Batch L2.3) — takes
    // an InnoDB record lock on this exact lot row for the life of the
    // caller's transaction, so a second concurrent booking attempt against
    // the same lot blocks here until the first transaction commits or
    // rolls back, instead of both readers independently seeing the same
    // pre-transition status. Only ever call this from inside an active
    // Database::transaction() — outside of one, PDO auto-commits right
    // after the SELECT and the lock is released immediately, providing no
    // protection. Deliberately does not run syncExpiredLots() (that stays
    // findById()'s lazy-sweep behavior, out of this batch's scope) and is
    // not a replacement for findById() elsewhere.
    public function findByIdForUpdate($id) {
        $stmt = $this->db->prepare("
            SELECT l.*, b.block_name, s.section_name, t.type_name as lot_type_name
            FROM lots l
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections s ON b.section_id = s.section_id
            JOIN lot_types t ON l.lot_type_id = t.type_id
            WHERE l.lot_id = ?
            FOR UPDATE
        ");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $lotNumber = trim((string) ($data['lot_number'] ?? ''));
        if ($lotNumber === '') {
            $lotNumber = $this->generateLotNumber((int) $data['block_id']);
        }

        // lease_start_date/lease_end_date are intentionally not written here —
        // expiration_records is the sole source of truth for lease dates (see
        // ScheduleController, which creates one automatically on schedule
        // completion); these lots columns were never populated by any code
        // path and existed only as a dead, disconnected duplicate.
        $stmt = $this->db->prepare("
            INSERT INTO lots (block_id, lot_number, lot_type_id, status, price, dimensions, location_notes)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        ");
        $success = $stmt->execute([
            $data['block_id'],
            $lotNumber,
            $data['lot_type_id'],
            $data['status'] ?? 'Available',
            $data['price'],
            $data['dimensions'] ?? null,
            $data['location_notes'] ?? null,
        ]);
        return $success ? (int) $this->db->lastInsertId() : false;
    }

    // Batch L2.2: status removed from this method's write capability
    // entirely (not just conditionally skipped) — this is metadata-only
    // now. lots.status has exactly one application-level write path left:
    // transitionStatus() below, always reached through
    // AutomationEngine::run() (see LotController::updateLot() for the
    // admin-override case, and ScheduleController/PaymentController/
    // RelocationController for automated transitions). A caller that still
    // passes a 'status' key in $data is silently ignored here by design —
    // Lot::update($id, ['status' => 'Occupied']) cannot write lots.status,
    // structurally, because the column is no longer in this SQL statement.
    public function update($id, $data) {
        $existing = $this->findById($id);
        if (!$existing) {
            return false;
        }

        $stmt = $this->db->prepare("
            UPDATE lots SET
                block_id = ?,
                lot_number = ?,
                lot_type_id = ?,
                price = ?,
                dimensions = ?,
                location_notes = ?
            WHERE lot_id = ?
        ");
        return $stmt->execute([
            $data['block_id'] ?? $existing['block_id'],
            $data['lot_number'] ?? $existing['lot_number'],
            $data['lot_type_id'] ?? $existing['lot_type_id'],
            $data['price'] ?? $existing['price'],
            array_key_exists('dimensions', $data) ? $data['dimensions'] : $existing['dimensions'],
            array_key_exists('location_notes', $data) ? $data['location_notes'] : $existing['location_notes'],
            $id,
        ]);
    }

    // The sole application-level write path for lots.status (Batch L2.2 —
    // update() above no longer touches this column at all, structurally,
    // not just by convention). Used both for automated transitions (a
    // booking getting confirmed/completed/cancelled, a payment verifying, a
    // relocation being approved/completed) and for an admin's direct status
    // override via LotController::updateLot() — the latter calls this with
    // $allowedFromStatuses = null (Classification E from the L1/L2 audits:
    // that's an intentionally unrestricted admin override, not a lifecycle
    // rule), routed through AutomationEngine::run() the same as every other
    // caller so it gets the same lifecycle audit trail instead of a bespoke
    // one. $allowedFromStatuses, when given, rejects (returns false, writes
    // nothing) if the lot isn't currently in one of those statuses — callers
    // wrap this in AutomationEngine::run() so a rejection raises a reviewable
    // system_exceptions entry instead of silently doing nothing or
    // overwriting a status some other process already moved past.
    public function transitionStatus($lotId, $newStatus, $allowedFromStatuses = null) {
        $existing = $this->findById($lotId);
        if (!$existing) {
            return false;
        }
        if ($allowedFromStatuses !== null && !in_array($existing['status'], $allowedFromStatuses, true)) {
            return false;
        }

        $stmt = $this->db->prepare("UPDATE lots SET status = ? WHERE lot_id = ?");
        return $stmt->execute([$newStatus, (int) $lotId]);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM lots WHERE lot_id = ?");
        return $stmt->execute([$id]);
    }

    public function generateLotNumber($blockId) {
        $stmt = $this->db->prepare("SELECT COUNT(*) AS count FROM lots WHERE block_id = ?");
        $stmt->execute([$blockId]);
        $count = (int) $stmt->fetchColumn();
        return 'L' . ($count + 1);
    }

    public function createCategory($data) {
        $stmt = $this->db->prepare("INSERT INTO lot_types (type_name, description) VALUES (?, ?)");
        return $stmt->execute([$data['type_name'], $data['description'] ?? null]);
    }

    public function updateCategory($id, $data) {
        $stmt = $this->db->prepare("UPDATE lot_types SET type_name = ?, description = ? WHERE type_id = ?");
        return $stmt->execute([$data['type_name'], $data['description'] ?? null, $id]);
    }

    public function deleteCategory($id) {
        $stmt = $this->db->prepare("DELETE FROM lot_types WHERE type_id = ?");
        return $stmt->execute([$id]);
    }

    public function findCategories() {
        return $this->getLotTypes();
    }

    public function getStats() {
        $this->syncExpiredLots();
        $stmt = $this->db->query("
            SELECT
                COUNT(*) as total,
                SUM(CASE WHEN status = 'Available' THEN 1 ELSE 0 END) as available,
                SUM(CASE WHEN status = 'Occupied' THEN 1 ELSE 0 END) as occupied,
                SUM(CASE WHEN status = 'Reserved' THEN 1 ELSE 0 END) as reserved,
                SUM(CASE WHEN status = 'Expired' THEN 1 ELSE 0 END) as expired
            FROM lots
        ");
        return $stmt->fetch();
    }

    public function getLotTypes() {
        $stmt = $this->db->query("SELECT * FROM lot_types ORDER BY type_name");
        return $stmt->fetchAll();
    }
}
