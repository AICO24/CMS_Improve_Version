<?php
require_once __DIR__ . '/../config/database.php';

class Cremation {
    private $db;

    // Default niche slots shown/assumed per columbarium when no real capacity
    // config exists yet. Shared by getNiches() (grid template) and getStats()
    // (capacity denominator) so the two stay consistent.
    const DEFAULT_CAPACITY = 10;

    // Cremation module audit, Batch D: mirrors Schedule::LATEST_PAYMENT_SELECT
    // exactly, for the queue page's payment badge — matched on
    // transaction_type = 'Cremation' + reference_id rather than
    // reference_kind ('reference_kind' is a schedule/lot-only enum, see
    // migration_20260902_add_payment_reference_kind.sql; cremation payments
    // were never given a reference_kind value, PaymentController resolves
    // them by transaction_type alone — see its validatePaymentReference()).
    // A cremation with no payment attempt at all (a fresh Pending request,
    // or Scheduled-by-staff-directly) gets NULLs here, same as burial.
    private const LATEST_PAYMENT_SELECT = "
        (SELECT p.verification_status FROM payments p WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
        (SELECT p.amount FROM payments p WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id ORDER BY p.created_at DESC LIMIT 1) AS payment_amount,
        (SELECT p.payment_date FROM payments p WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id ORDER BY p.created_at DESC LIMIT 1) AS payment_date,
        (SELECT p.receipt_number FROM payments p WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id ORDER BY p.created_at DESC LIMIT 1) AS payment_receipt_number,
        (SELECT p.payment_id FROM payments p WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id ORDER BY p.created_at DESC LIMIT 1) AS payment_id,
        (SELECT p.payment_method FROM payments p WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id ORDER BY p.created_at DESC LIMIT 1) AS payment_method,
        (SELECT p.gateway_status FROM payments p WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id ORDER BY p.created_at DESC LIMIT 1) AS gateway_status,
        (SELECT p.gateway_checkout_session_id FROM payments p WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id ORDER BY p.created_at DESC LIMIT 1) AS gateway_checkout_session_id,
        (SELECT r.status FROM refunds r WHERE r.payment_id = (SELECT p2.payment_id FROM payments p2 WHERE p2.transaction_type = 'Cremation' AND p2.reference_id = c.cremation_id ORDER BY p2.created_at DESC LIMIT 1) ORDER BY r.created_at DESC LIMIT 1) AS refund_status
    ";

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
        if (!empty($filters['created_by'])) {
            $sql .= " AND c.created_by = ?";
            $params[] = (int) $filters['created_by'];
        }
        if (!empty($filters['q'])) {
            $sql .= " AND (c.niche_number LIKE ? OR d.first_name LIKE ? OR d.last_name LIKE ? OR dr.full_name LIKE ?)";
            $search = '%' . $filters['q'] . '%';
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
        }
        // Cremation module audit, Batch D: mirrors Schedule::applyFilters()'s
        // identical awaiting_confirmation clause — a Pending row that already
        // has a Verified payment on file is exactly the case
        // autoConfirmCremationForVerifiedPayment() should have already moved
        // to Scheduled; still finding one here means that automation
        // couldn't safely proceed (see the resulting open system_exceptions
        // entry) and a human needs to look at it. Not a routine approval
        // queue — see CremationController::queueStats()'s comment.
        if (!empty($filters['awaiting_confirmation'])) {
            $sql .= " AND c.status = 'Pending' AND EXISTS (
                SELECT 1 FROM payments p
                WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id AND p.verification_status = 'Verified'
            )";
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
                   u.full_name as created_by_name,
                   " . self::LATEST_PAYMENT_SELECT . "
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
                   u.full_name as created_by_name,
                   " . self::LATEST_PAYMENT_SELECT . "
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

    public function findNiche($nicheNumber, $columbarium = null) {
        $sql = "SELECT * FROM cremation_records WHERE niche_number = ? AND status != 'Cancelled'";
        $params = [$nicheNumber];
        if (!empty($columbarium)) {
            $sql .= " AND columbarium = ?";
            $params[] = $columbarium;
        }
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetch();
    }

    public function getNiches($columbarium = null) {
        if ($columbarium) {
            return $this->getNichesForColumbarium($columbarium);
        }

        $columbariums = $this->getDistinctColumbariums();
        $all = [];
        foreach ($columbariums as $col) {
            $all = array_merge($all, $this->getNichesForColumbarium($col));
        }
        return $all;
    }

    public function getColumbariumStructures() {
        $configFile = __DIR__ . '/../config/columbarium_structures.json';
        if (file_exists($configFile)) {
            $content = file_get_contents($configFile);
            $decoded = json_decode($content, true);
            if (is_array($decoded)) {
                return $decoded;
            }
        }
        return [
            'St. Jude Thaddeus Sanctuary' => ['levels' => 5, 'niches_per_level' => 10, 'prefix' => 'SJ-L'],
            'Our Lady of Peace Gallery' => ['levels' => 5, 'niches_per_level' => 10, 'prefix' => 'OLP-L'],
            'San Lorenzo Ruiz Wing' => ['levels' => 4, 'niches_per_level' => 8, 'prefix' => 'SLR-L'],
            'Ascension Gallery' => ['levels' => 4, 'niches_per_level' => 8, 'prefix' => 'ASC-L'],
            'Columbarium A' => ['levels' => 3, 'niches_per_level' => 10, 'prefix' => 'N-'],
        ];
    }

    public function saveColumbariumStructure($columbarium, $levels, $nichesPerLevel, $prefix) {
        $structures = $this->getColumbariumStructures();
        $structures[$columbarium] = [
            'levels' => max(1, min(10, (int) $levels)),
            'niches_per_level' => max(1, min(25, (int) $nichesPerLevel)),
            'prefix' => trim($prefix) ?: 'N-',
            'updated_at' => date('Y-m-d H:i:s')
        ];
        $configFile = __DIR__ . '/../config/columbarium_structures.json';
        file_put_contents($configFile, json_encode($structures, JSON_PRETTY_PRINT));
        return $structures[$columbarium];
    }

    public function getNichesForColumbarium($columbarium) {
        $targetColumbarium = $columbarium ?: 'Columbarium A';
        $structures = $this->getColumbariumStructures();
        $config = $structures[$targetColumbarium] ?? null;

        $sql = "
            SELECT c.cremation_id, c.niche_number, c.columbarium, c.level, c.status, c.cremation_date, c.ash_storage_location, c.notes,
                   d.first_name, d.last_name
            FROM cremation_records c
            LEFT JOIN decedent_records d ON c.deceased_id = d.decedent_id
            WHERE (c.columbarium = ? " . ($targetColumbarium === 'Columbarium A' ? "OR c.columbarium IS NULL OR c.columbarium = ''" : "") . ")
            ORDER BY c.created_at DESC
        ";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$targetColumbarium]);
        $records = $stmt->fetchAll();

        $rows = [];
        $occupiedMap = [];
        foreach ($records as $record) {
            $nNum = (string) ($record['niche_number'] ?? '');
            if ($nNum !== '') {
                $occupiedMap[$nNum] = $record;
            }
        }

        if ($config) {
            $levels = (int) $config['levels'];
            $perLevel = (int) $config['niches_per_level'];
            $prefix = $config['prefix'];

            for ($lvl = 1; $lvl <= $levels; $lvl++) {
                for ($slot = 1; $slot <= $perLevel; $slot++) {
                    if (str_ends_with($prefix, '-L') || str_ends_with($prefix, 'L')) {
                        $nicheNum = rtrim($prefix, 'L') . "L{$lvl}-" . str_pad($slot, 2, '0', STR_PAD_LEFT);
                    } elseif ($prefix === 'N-') {
                        $index = ($lvl - 1) * $perLevel + $slot;
                        $nicheNum = "N-{$index}";
                    } else {
                        $nicheNum = "{$prefix}L{$lvl}-" . str_pad($slot, 2, '0', STR_PAD_LEFT);
                    }

                    if (isset($occupiedMap[$nicheNum])) {
                        $rec = $occupiedMap[$nicheNum];
                        $status = (string) ($rec['status'] ?? 'Scheduled');
                        $normalizedStatus = $status === 'Cancelled' ? 'available' : 'occupied';
                        $rows[] = [
                            'niche_number' => $nicheNum,
                            'columbarium' => $targetColumbarium,
                            'level' => $lvl,
                            'status' => $normalizedStatus,
                            'first_name' => $rec['first_name'] ?? null,
                            'last_name' => $rec['last_name'] ?? null,
                            'cremation_id' => $rec['cremation_id'] ?? null,
                            'cremation_date' => $rec['cremation_date'] ?? null,
                            'ash_storage_location' => $rec['ash_storage_location'] ?? null,
                            'notes' => $rec['notes'] ?? null,
                        ];
                        unset($occupiedMap[$nicheNum]);
                    } else {
                        $rows[] = [
                            'niche_number' => $nicheNum,
                            'columbarium' => $targetColumbarium,
                            'level' => $lvl,
                            'status' => 'available',
                            'first_name' => null,
                            'last_name' => null,
                            'cremation_id' => null,
                            'cremation_date' => null,
                            'ash_storage_location' => null,
                            'notes' => null,
                        ];
                    }
                }
            }

            // Any remaining occupied records not mapped to structured slots get appended
            foreach ($occupiedMap as $nNum => $rec) {
                $status = (string) ($rec['status'] ?? 'Scheduled');
                $rows[] = [
                    'niche_number' => $nNum,
                    'columbarium' => $targetColumbarium,
                    'level' => !empty($rec['level']) ? (int) $rec['level'] : 1,
                    'status' => $status === 'Cancelled' ? 'available' : 'occupied',
                    'first_name' => $rec['first_name'] ?? null,
                    'last_name' => $rec['last_name'] ?? null,
                    'cremation_id' => $rec['cremation_id'] ?? null,
                    'cremation_date' => $rec['cremation_date'] ?? null,
                    'ash_storage_location' => $rec['ash_storage_location'] ?? null,
                    'notes' => $rec['notes'] ?? null,
                ];
            }
        } else {
            // Default virtual 10-slot logic
            $maxIndex = self::DEFAULT_CAPACITY;
            foreach ($records as $record) {
                $suffix = preg_replace('/\D/', '', (string) ($record['niche_number'] ?? ''));
                if ($suffix !== '') {
                    $maxIndex = max($maxIndex, (int) $suffix);
                }
            }

            for ($i = 1; $i <= $maxIndex; $i++) {
                $calcLevel = (int) ceil($i / 10);
                $rows[] = [
                    'niche_number' => 'N-' . $i,
                    'columbarium' => $targetColumbarium,
                    'level' => max(1, min(10, $calcLevel)),
                    'status' => 'available',
                    'first_name' => null,
                    'last_name' => null,
                    'cremation_id' => null,
                    'cremation_date' => null,
                    'ash_storage_location' => null,
                    'notes' => null,
                ];
            }

            foreach ($records as $record) {
                $nicheNumber = $record['niche_number'] ?? null;
                $suffix = preg_replace('/\D/', '', (string) $nicheNumber);
                $index = $suffix !== '' ? ((int) $suffix - 1) : null;
                $status = (string) ($record['status'] ?? 'Scheduled');
                $normalizedStatus = $status === 'Cancelled' ? 'available' : 'occupied';

                $row = [
                    'niche_number' => $nicheNumber ?: 'N-' . (count($rows) + 1),
                    'columbarium' => $record['columbarium'] ?? $targetColumbarium,
                    'level' => !empty($record['level']) ? (int) $record['level'] : 1,
                    'status' => $normalizedStatus,
                    'first_name' => $record['first_name'] ?? null,
                    'last_name' => $record['last_name'] ?? null,
                    'cremation_id' => $record['cremation_id'] ?? null,
                    'cremation_date' => $record['cremation_date'] ?? null,
                    'ash_storage_location' => $record['ash_storage_location'] ?? null,
                    'notes' => $record['notes'] ?? null,
                ];

                if ($index !== null && isset($rows[$index])) {
                    $rows[$index] = $row;
                } else {
                    $rows[] = $row;
                }
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
    //
    // Cremation module audit, Batch C: every field below now falls back to
    // $existing's current value when absent from $data, matching
    // Schedule::update()'s identical fallback for every one of its own
    // fields. Previously only deceased_id/decedent_request_id had this
    // fallback — niche_number/columbarium/level/cremation_date/
    // ash_storage_location/notes silently reset to NULL (and status to
    // 'Scheduled') on any partial update, since CremationController::
    // update()'s own plain-write path (the one call site that sends a
    // genuinely partial $data, e.g. the queue UI's Cancel button sending
    // only {status: 'Cancelled'}) never merges before calling this. Every
    // OTHER caller in this file already worked around the gap by merging
    // with $existing itself first (destroy()'s citizen soft-cancel,
    // linkDecedent(), completeWithAutoNiche()) — strong evidence the
    // intended contract was always "partial update, like Schedule", just
    // incompletely implemented here. Fixing it at the source removes the
    // need for those callers to keep working around it, though their
    // existing merge calls remain correct (a full row merged onto itself is
    // a no-op either way).
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
            array_key_exists('niche_number', $data) ? $data['niche_number'] : $existing['niche_number'],
            array_key_exists('columbarium', $data) ? $data['columbarium'] : $existing['columbarium'],
            array_key_exists('level', $data)
                ? (isset($data['level']) ? (int) $data['level'] : null)
                : $existing['level'],
            array_key_exists('cremation_date', $data) ? $data['cremation_date'] : $existing['cremation_date'],
            $data['status'] ?? $existing['status'],
            array_key_exists('ash_storage_location', $data) ? $data['ash_storage_location'] : $existing['ash_storage_location'],
            array_key_exists('notes', $data) ? $data['notes'] : $existing['notes'],
            (int) $id
        ]);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM cremation_records WHERE cremation_id = ?");
        return $stmt->execute([(int) $id]);
    }

    // Cremation module audit, Batch D: request-queue status counts for
    // manage-cremations.html's stat row — deliberately a separate method
    // from getStats() below, which answers a different question (niche/
    // columbarium occupancy for the niche-grid board) despite the similar
    // name; keeping them distinct avoids overloading one method with two
    // unrelated shapes. Mirrors Schedule::getStats()'s status-count half
    // only (pending/confirmed/completed/cancelled) — cremation has no
    // month-by-month booking breakdown to return alongside it, since
    // nothing on this page renders one, so it isn't built.
    public function getStatusCounts() {
        $stmt = $this->db->query("
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
                   SUM(CASE WHEN status = 'Scheduled' THEN 1 ELSE 0 END) AS scheduled,
                   SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
                   SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled
            FROM cremation_records
        ");
        $counts = $stmt->fetch();

        return [
            'total' => (int) ($counts['total'] ?? 0),
            'pending' => (int) ($counts['pending'] ?? 0),
            'scheduled' => (int) ($counts['scheduled'] ?? 0),
            'completed' => (int) ($counts['completed'] ?? 0),
            'cancelled' => (int) ($counts['cancelled'] ?? 0),
            // Cremation module audit, Batch E: for the admin dashboard's
            // Cremation Requests card — a plain status count alone can't
            // answer "what's happening today," and this app has no other
            // today's-schedule view for cremation (a full timeline view was
            // scoped out of this audit as a larger future feature; this is
            // just the one number). Kept inside getStatusCounts() rather
            // than a new endpoint since manage-cremations.js's stat row
            // already calls this one and simply ignores the extra key.
            'today_scheduled' => $this->countTodayScheduled(),
        ];
    }

    private function countTodayScheduled() {
        $stmt = $this->db->query("
            SELECT COUNT(*) AS count FROM cremation_records
            WHERE status = 'Scheduled' AND cremation_date = CURDATE()
        ");
        $row = $stmt->fetch();
        return (int) ($row['count'] ?? 0);
    }

    public function getStats($columbarium = null) {
        $structures = $this->getColumbariumStructures();

        if ($columbarium) {
            $sql = "
                SELECT COUNT(*) as total,
                       SUM(CASE WHEN status != 'Cancelled' THEN 1 ELSE 0 END) as occupied
                FROM cremation_records
                WHERE (columbarium = ? " . ($columbarium === 'Columbarium A' ? "OR columbarium IS NULL OR columbarium = ''" : "") . ")
            ";
            $stmt = $this->db->prepare($sql);
            $stmt->execute([$columbarium]);
            $result = $stmt->fetch();

            $occupied = isset($result['occupied']) ? (int) $result['occupied'] : 0;
            $struct = $structures[$columbarium] ?? null;
            $baseCapacity = $struct ? ((int) $struct['levels'] * (int) $struct['niches_per_level']) : self::DEFAULT_CAPACITY;
            $capacity = max($baseCapacity, $occupied);
            $available = max(0, $capacity - $occupied);
            $result['total'] = $capacity;
            $result['occupied'] = $occupied;
            $result['available'] = $available;
            $result['occupancy_rate'] = $capacity > 0 ? round(($occupied / $capacity) * 100) : 0;
            return $result;
        }

        // Aggregate across all columbariums
        $columbariums = $this->getDistinctColumbariums();
        $sql = "
            SELECT SUM(CASE WHEN status != 'Cancelled' THEN 1 ELSE 0 END) as occupied
            FROM cremation_records
            WHERE 1=1
        ";
        $stmt = $this->db->query($sql);
        $result = $stmt->fetch();

        $occupied = isset($result['occupied']) ? (int) $result['occupied'] : 0;
        $totalCapacity = 0;
        foreach ($columbariums as $col) {
            $struct = $structures[$col] ?? null;
            $totalCapacity += $struct ? ((int) $struct['levels'] * (int) $struct['niches_per_level']) : self::DEFAULT_CAPACITY;
        }
        $capacity = max($totalCapacity, $occupied);
        $available = max(0, $capacity - $occupied);

        return [
            'total' => $capacity,
            'occupied' => $occupied,
            'available' => $available,
            'occupancy_rate' => $capacity > 0 ? round(($occupied / $capacity) * 100) : 0,
        ];
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

    // Real columbarium names actually in use + prestigious sanctuary presets
    // so the frontend can offer an organized dropdown and structured walls.
    public function getDistinctColumbariums() {
        $stmt = $this->db->prepare("
            SELECT DISTINCT columbarium FROM cremation_records
            WHERE columbarium IS NOT NULL AND columbarium != ''
            ORDER BY columbarium
        ");
        $stmt->execute();
        $dbList = array_column($stmt->fetchAll(), 'columbarium');

        $configuredList = array_keys($this->getColumbariumStructures());

        $combined = array_values(array_unique(array_merge($dbList, $configuredList)));
        sort($combined);
        return $combined;
    }

    public function isNicheAvailable($nicheNumber, $columbarium = null) {
        $sql = "SELECT COUNT(*) as count FROM cremation_records WHERE niche_number = ? AND status != 'Cancelled'";
        $params = [$nicheNumber];
        if (!empty($columbarium)) {
            $sql .= " AND columbarium = ?";
            $params[] = $columbarium;
        }
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $result = $stmt->fetch();
        return isset($result['count']) ? ((int) $result['count'] === 0) : true;
    }

    // Cremation module audit, Batch C: stale-Pending sweep, mirroring
    // Schedule::findStalePendingUnnotified()/markStaleNotified()/
    // findStalePendingForFinalWarning()/markFinalWarningNotified()/
    // findStalePendingForCancellation() exactly — same three-stage policy,
    // same "gated on the previous stage's own timestamp, not created_at
    // alone" reasoning (see the migration's header comment), same
    // payment-existence gate via NOT EXISTS, just against cremation_records/
    // transaction_type='Cremation' instead of burial_schedules/'Lot Purchase'.
    // LEFT JOINs (not INNER) — a provisional (deceased_id-less) or
    // not-yet-linked cremation must still surface here, matching
    // findAll()/findById()'s own LEFT JOIN convention in this file.
    public function findStalePendingUnnotified($days) {
        $stmt = $this->db->prepare("
            SELECT c.*, d.first_name, d.last_name, dr.full_name AS provisional_name
            FROM cremation_records c
            LEFT JOIN decedent_records d ON c.deceased_id = d.decedent_id
            LEFT JOIN decedent_requests dr ON c.decedent_request_id = dr.request_id
            WHERE c.status = 'Pending'
              AND c.stale_notified_at IS NULL
              AND c.created_at <= (NOW() - INTERVAL ? DAY)
              AND NOT EXISTS (
                  SELECT 1 FROM payments p
                  WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id
              )
            ORDER BY c.created_at ASC
        ");
        $stmt->execute([(int) $days]);
        return $stmt->fetchAll();
    }

    public function markStaleNotified($id) {
        $stmt = $this->db->prepare("UPDATE cremation_records SET stale_notified_at = NOW() WHERE cremation_id = ?");
        return $stmt->execute([(int) $id]);
    }

    public function findStalePendingForFinalWarning($days) {
        $stmt = $this->db->prepare("
            SELECT c.*, d.first_name, d.last_name, dr.full_name AS provisional_name
            FROM cremation_records c
            LEFT JOIN decedent_records d ON c.deceased_id = d.decedent_id
            LEFT JOIN decedent_requests dr ON c.decedent_request_id = dr.request_id
            WHERE c.status = 'Pending'
              AND c.stale_notified_at IS NOT NULL
              AND c.final_warning_notified_at IS NULL
              AND c.stale_notified_at <= (NOW() - INTERVAL ? DAY)
              AND NOT EXISTS (
                  SELECT 1 FROM payments p
                  WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id
              )
            ORDER BY c.created_at ASC
        ");
        $stmt->execute([(int) $days]);
        return $stmt->fetchAll();
    }

    public function markFinalWarningNotified($id) {
        $stmt = $this->db->prepare("UPDATE cremation_records SET final_warning_notified_at = NOW() WHERE cremation_id = ?");
        return $stmt->execute([(int) $id]);
    }

    public function findStalePendingForCancellation($days) {
        $stmt = $this->db->prepare("
            SELECT c.*, d.first_name, d.last_name, dr.full_name AS provisional_name
            FROM cremation_records c
            LEFT JOIN decedent_records d ON c.deceased_id = d.decedent_id
            LEFT JOIN decedent_requests dr ON c.decedent_request_id = dr.request_id
            WHERE c.status = 'Pending'
              AND c.final_warning_notified_at IS NOT NULL
              AND c.final_warning_notified_at <= (NOW() - INTERVAL ? DAY)
              AND NOT EXISTS (
                  SELECT 1 FROM payments p
                  WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id
              )
            ORDER BY c.created_at ASC
        ");
        $stmt->execute([(int) $days]);
        return $stmt->fetchAll();
    }

    // Fresh, single-row re-check called right before the actual cancel write
    // in CremationController::autoCancelStalePending() — mirrors
    // Schedule::isStillEligibleForAutoCancel() exactly; the bulk candidate
    // list above was read moments earlier in the same request, and a
    // payment could have been submitted in the interim.
    public function isStillEligibleForAutoCancel($cremationId) {
        $stmt = $this->db->prepare("
            SELECT 1 FROM cremation_records c
            WHERE c.cremation_id = ?
              AND c.status = 'Pending'
              AND NOT EXISTS (
                  SELECT 1 FROM payments p
                  WHERE p.transaction_type = 'Cremation' AND p.reference_id = c.cremation_id
              )
        ");
        $stmt->execute([(int) $cremationId]);
        return (bool) $stmt->fetchColumn();
    }
}
