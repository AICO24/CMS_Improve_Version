<?php
require_once __DIR__ . '/../config/database.php';

class Decedent {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

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
    }

    public function findAll($filters = [], $pagination = []) {
        $sql = "
            SELECT dr.*, l.lot_number, s.section_name
            FROM decedent_records dr
            JOIN lots l ON dr.lot_id = l.lot_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections s ON b.section_id = s.section_id
            WHERE 1=1
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
            JOIN lots l ON dr.lot_id = l.lot_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections s ON b.section_id = s.section_id
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
            SELECT dr.*, l.lot_number, s.section_name
            FROM decedent_records dr
            JOIN lots l ON dr.lot_id = l.lot_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections s ON b.section_id = s.section_id
            WHERE dr.decedent_id = ?
        ");
        $stmt->execute([(int) $id]);
        return $stmt->fetch();
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
            (int) $data['lot_id'],
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
            (int) $data['lot_id'],
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

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM decedent_records WHERE decedent_id = ?");
        return $stmt->execute([(int) $id]);
    }

    public function getStats() {
        $stmt = $this->db->query(" 
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN is_cremated = 'no' THEN 1 ELSE 0 END) AS burials,
                SUM(CASE WHEN is_cremated = 'yes' THEN 1 ELSE 0 END) AS cremations,
                ROUND(AVG(TIMESTAMPDIFF(YEAR, dob, dod))) AS avg_age
            FROM decedent_records
        ");
        return $stmt->fetch();
    }
}
