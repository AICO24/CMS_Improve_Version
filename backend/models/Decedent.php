<?php
require_once __DIR__ . '/../config/database.php';

class Decedent {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    // Batch C (completeness/attention): a record is "needs attention" when
    // it's missing information a fully-usable record should have, beyond
    // the bare fields required to create it at all (name/dob/dod/lot).
    // Shared by applyFilters()'s `incomplete` filter and getStats()'s count
    // so the two can never define "incomplete" differently. Table-qualified
    // (`dr.`) so it drops into either query unchanged.
    private const INCOMPLETE_CONDITION = "(
        dr.contact_name IS NULL OR dr.contact_name = '' OR
        dr.contact_number IS NULL OR dr.contact_number = '' OR
        dr.cause_of_death IS NULL OR dr.cause_of_death = '' OR
        (dr.is_cremated = 'yes' AND (dr.ash_storage IS NULL OR dr.ash_storage = ''))
    )";

    private function applyFilters(&$sql, &$params, $filters) {
        if (!empty($filters['q'])) {
            $term = '%' . $filters['q'] . '%';
            $sql .= " AND (
                dr.first_name LIKE ? OR
                dr.last_name LIKE ? OR
                CONCAT(dr.first_name, ' ', dr.last_name) LIKE ? OR
                l.lot_number LIKE ? OR
                dr.cause_of_death LIKE ? OR
                dr.contact_name LIKE ?
            )";
            array_push($params, $term, $term, $term, $term, $term, $term);
        }

        if (!empty($filters['lot_id'])) {
            $sql .= " AND dr.lot_id = ?";
            $params[] = (int) $filters['lot_id'];
        }

        if (isset($filters['is_cremated']) && in_array($filters['is_cremated'], ['yes', 'no'], true)) {
            $sql .= " AND dr.is_cremated = ?";
            $params[] = $filters['is_cremated'];
        }

        if (!empty($filters['section'])) {
            $sql .= " AND s.section_name = ?";
            $params[] = $filters['section'];
        }

        if (!empty($filters['incomplete'])) {
            $sql .= " AND " . self::INCOMPLETE_CONDITION;
        }
    }

    // Cremation Phase A: lot_id is now nullable (see
    // migration_20260903_make_decedent_lot_optional.sql) — a cremation-only
    // decedent has no lot at all. All three joins in this chain must be LEFT
    // JOIN together, not just the first: if l is NULL, a plain INNER JOIN on
    // l.block_id would never match anything and silently drop the row from
    // the result entirely, which is exactly the bug this migration fixes.
    public function findAll($filters = [], $pagination = []) {
        $sql = "
            SELECT dr.*, l.lot_number, s.section_name
            FROM decedent_records dr
            LEFT JOIN lots l ON dr.lot_id = l.lot_id
            LEFT JOIN blocks b ON l.block_id = b.block_id
            LEFT JOIN sections s ON b.section_id = s.section_id
            WHERE dr.deleted_at IS NULL
        ";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $sql .= " ORDER BY dr.dod DESC, dr.last_name, dr.first_name";

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
            FROM decedent_records dr
            LEFT JOIN lots l ON dr.lot_id = l.lot_id
            LEFT JOIN blocks b ON l.block_id = b.block_id
            LEFT JOIN sections s ON b.section_id = s.section_id
            WHERE dr.deleted_at IS NULL
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
            SELECT dr.*, l.lot_number, s.section_name
            FROM decedent_records dr
            LEFT JOIN lots l ON dr.lot_id = l.lot_id
            LEFT JOIN blocks b ON l.block_id = b.block_id
            LEFT JOIN sections s ON b.section_id = s.section_id
            WHERE dr.decedent_id = ? AND dr.deleted_at IS NULL
        ");
        $stmt->execute([(int) $id]);
        return $stmt->fetch();
    }

    // Batch B (duplicate detection): same names (case/whitespace-insensitive)
    // and the same dob AND dod — confident enough to hard-block automatically
    // rather than merely flag (module audit, Phase 5D: "avoid unsafe
    // automatic merging... flagged for review if confidence is uncertain" —
    // an exact match on all four fields isn't uncertain).
    public function findExactDuplicate($data, $excludeId = null) {
        $sql = "
            SELECT decedent_id, first_name, last_name, dob, dod
            FROM decedent_records
            WHERE deleted_at IS NULL
              AND LOWER(TRIM(first_name)) = LOWER(TRIM(?))
              AND LOWER(TRIM(last_name)) = LOWER(TRIM(?))
              AND dob = ? AND dod = ?
        ";
        $params = [$data['first_name'], $data['last_name'], $data['dob'], $data['dod']];
        if ($excludeId !== null) {
            $sql .= " AND decedent_id != ?";
            $params[] = (int) $excludeId;
        }
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return $row ?: null;
    }

    // Batch B: the "uncertain confidence" tier — a phonetically similar full
    // name (SOUNDEX, so "Jonh"/"John" or "Cruz"/"Crus" still match) with a
    // dob or dod within 3 days of what's being entered. Never blocks
    // anything by itself; DecedentController surfaces these as a warning the
    // caller must explicitly acknowledge (resubmitting with
    // confirm_duplicate=true) before the record is saved.
    public function findNearDuplicates($data, $excludeId = null) {
        $sql = "
            SELECT decedent_id, first_name, last_name, middle_name, suffix, dob, dod
            FROM decedent_records
            WHERE deleted_at IS NULL
              AND SOUNDEX(last_name) = SOUNDEX(?)
              AND SOUNDEX(first_name) = SOUNDEX(?)
              AND (ABS(DATEDIFF(dob, ?)) <= 3 OR ABS(DATEDIFF(dod, ?)) <= 3)
        ";
        $params = [$data['last_name'], $data['first_name'], $data['dob'], $data['dod']];
        if ($excludeId !== null) {
            $sql .= " AND decedent_id != ?";
            $params[] = (int) $excludeId;
        }
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function create($data) {
        $stmt = $this->db->prepare(" 
            INSERT INTO decedent_records (
                lot_id,
                first_name,
                last_name,
                middle_name,
                suffix,
                dob,
                dod,
                cause_of_death,
                contact_name,
                contact_number,
                is_cremated,
                ash_storage
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");

        $success = $stmt->execute([
            !empty($data['lot_id']) ? (int) $data['lot_id'] : null,
            $data['first_name'],
            $data['last_name'],
            $data['middle_name'] ?? null,
            $data['suffix'] ?? null,
            $data['dob'],
            $data['dod'],
            $data['cause_of_death'] ?? null,
            $data['contact_name'] ?? null,
            $data['contact_number'] ?? null,
            $data['is_cremated'] ?? 'no',
            $data['ash_storage'] ?? null,
        ]);

        return $success ? (int) $this->db->lastInsertId() : false;
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare(" 
            UPDATE decedent_records SET
                lot_id = ?,
                first_name = ?,
                last_name = ?,
                middle_name = ?,
                suffix = ?,
                dob = ?,
                dod = ?,
                cause_of_death = ?,
                contact_name = ?,
                contact_number = ?,
                is_cremated = ?,
                ash_storage = ?
            WHERE decedent_id = ?
        ");

        return $stmt->execute([
            !empty($data['lot_id']) ? (int) $data['lot_id'] : null,
            $data['first_name'],
            $data['last_name'],
            $data['middle_name'] ?? null,
            $data['suffix'] ?? null,
            $data['dob'],
            $data['dod'],
            $data['cause_of_death'] ?? null,
            $data['contact_name'] ?? null,
            $data['contact_number'] ?? null,
            $data['is_cremated'] ?? 'no',
            $data['ash_storage'] ?? null,
            (int) $id,
        ]);
    }

    public function patchCremationStatus($id, $data) {
        $fields = [];
        $params = [];

        if (isset($data['is_cremated'])) {
            $fields[] = 'is_cremated = ?';
            $params[] = $data['is_cremated'];
        }
        if (array_key_exists('ash_storage', $data)) {
            $fields[] = 'ash_storage = ?';
            $params[] = $data['ash_storage'];
        }

        if (empty($fields)) {
            return false;
        }

        $params[] = (int) $id;
        $stmt = $this->db->prepare("UPDATE decedent_records SET " . implode(', ', $fields) . " WHERE decedent_id = ?");
        return $stmt->execute($params);
    }

    // Batch A (data-integrity foundation): soft delete instead of a real
    // DELETE, so a mistaken removal is recoverable at the database level.
    // Callers must check hasRelatedRecords() first — an UPDATE never trips
    // MySQL's own FK check the way the previous DELETE did, so that
    // protection has to be enforced explicitly now instead of by catching
    // error 1451.
    public function delete($id) {
        $stmt = $this->db->prepare("UPDATE decedent_records SET deleted_at = NOW() WHERE decedent_id = ?");
        return $stmt->execute([(int) $id]);
    }

    // Mirrors what the old DELETE's FK constraints (burial_schedules,
    // cremation_records, relocation_requests all reference decedent_id with
    // RESTRICT) used to enforce for free. Any reference — regardless of that
    // related record's own status — blocks the soft delete, exactly like
    // before.
    public function hasRelatedRecords($id) {
        $stmt = $this->db->prepare("
            SELECT
                (SELECT COUNT(*) FROM burial_schedules WHERE deceased_id = ?) +
                (SELECT COUNT(*) FROM cremation_records WHERE deceased_id = ?) +
                (SELECT COUNT(*) FROM relocation_requests WHERE deceased_id = ?) AS total
        ");
        $stmt->execute([(int) $id, (int) $id, (int) $id]);
        return (int) ($stmt->fetch()['total'] ?? 0) > 0;
    }

    public function getStats() {
        $condition = str_replace('dr.', '', self::INCOMPLETE_CONDITION);
        $stmt = $this->db->query("
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN is_cremated = 'no' THEN 1 ELSE 0 END) AS burials,
                SUM(CASE WHEN is_cremated = 'yes' THEN 1 ELSE 0 END) AS cremations,
                ROUND(AVG(TIMESTAMPDIFF(YEAR, dob, dod))) AS avg_age,
                SUM(CASE WHEN $condition THEN 1 ELSE 0 END) AS needs_attention
            FROM decedent_records
            WHERE deleted_at IS NULL
        ");
        return $stmt->fetch();
    }
}
