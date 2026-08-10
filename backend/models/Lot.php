<?php
require_once __DIR__ . '/../config/database.php';

class Lot {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
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

    public function create($data) {
        $lotNumber = trim((string) ($data['lot_number'] ?? ''));
        if ($lotNumber === '') {
            $lotNumber = $this->generateLotNumber((int) $data['block_id']);
        }

        $stmt = $this->db->prepare(" 
            INSERT INTO lots (block_id, lot_number, lot_type_id, status, price, dimensions, location_notes, lease_start_date, lease_end_date)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        return $stmt->execute([
            $data['block_id'],
            $lotNumber,
            $data['lot_type_id'],
            $data['status'] ?? 'Available',
            $data['price'],
            $data['dimensions'] ?? null,
            $data['location_notes'] ?? null,
            $data['lease_start_date'] ?? null,
            $data['lease_end_date'] ?? null,
        ]);
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare(" 
            UPDATE lots SET
                block_id = ?,
                lot_number = ?,
                lot_type_id = ?,
                status = ?,
                price = ?,
                dimensions = ?,
                location_notes = ?,
                lease_start_date = ?,
                lease_end_date = ?
            WHERE lot_id = ?
        ");
        return $stmt->execute([
            $data['block_id'],
            $data['lot_number'],
            $data['lot_type_id'],
            $data['status'] ?? 'Available',
            $data['price'],
            $data['dimensions'] ?? null,
            $data['location_notes'] ?? null,
            $data['lease_start_date'] ?? null,
            $data['lease_end_date'] ?? null,
            $id,
        ]);
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
