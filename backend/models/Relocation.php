<?php
require_once __DIR__ . '/../config/database.php';

class Relocation {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    private function applyFilters(&$sql, &$params, $filters) {
        if (!empty($filters['status'])) {
            $sql .= " AND r.status = ?";
            $params[] = $filters['status'];
        }
        if (!empty($filters['deceased_id'])) {
            $sql .= " AND r.deceased_id = ?";
            $params[] = (int) $filters['deceased_id'];
        }
        if (!empty($filters['from_lot_id'])) {
            $sql .= " AND r.from_lot_id = ?";
            $params[] = (int) $filters['from_lot_id'];
        }
        if (!empty($filters['to_lot_id'])) {
            $sql .= " AND r.to_lot_id = ?";
            $params[] = (int) $filters['to_lot_id'];
        }
        if (!empty($filters['q'])) {
            $sql .= " AND (d.first_name LIKE ? OR d.last_name LIKE ? OR from_lot.lot_number LIKE ? OR to_lot.lot_number LIKE ?)";
            $search = '%' . $filters['q'] . '%';
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
        }
    }

    private function baseSelect() {
        return "
            SELECT r.*,
                   d.first_name, d.last_name,
                   from_lot.lot_number as from_lot_number,
                   from_section.section_name as from_section,
                   to_lot.lot_number as to_lot_number,
                   to_section.section_name as to_section,
                   requester.full_name as requested_by_name,
                   approver.full_name as approved_by_name
            FROM relocation_requests r
            JOIN decedent_records d ON r.deceased_id = d.decedent_id
            JOIN lots from_lot ON r.from_lot_id = from_lot.lot_id
            JOIN blocks from_block ON from_lot.block_id = from_block.block_id
            JOIN sections from_section ON from_block.section_id = from_section.section_id
            JOIN lots to_lot ON r.to_lot_id = to_lot.lot_id
            JOIN blocks to_block ON to_lot.block_id = to_block.block_id
            JOIN sections to_section ON to_block.section_id = to_section.section_id
            JOIN users requester ON r.requested_by = requester.user_id
            LEFT JOIN users approver ON r.approved_by = approver.user_id
            WHERE 1=1
        ";
    }

    public function findAll($filters = [], $pagination = []) {
        $sql = $this->baseSelect();
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $sql .= " ORDER BY r.created_at DESC";

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
            FROM relocation_requests r
            JOIN decedent_records d ON r.deceased_id = d.decedent_id
            JOIN lots from_lot ON r.from_lot_id = from_lot.lot_id
            JOIN blocks from_block ON from_lot.block_id = from_block.block_id
            JOIN sections from_section ON from_block.section_id = from_section.section_id
            JOIN lots to_lot ON r.to_lot_id = to_lot.lot_id
            JOIN blocks to_block ON to_lot.block_id = to_block.block_id
            JOIN sections to_section ON to_block.section_id = to_section.section_id
            JOIN users requester ON r.requested_by = requester.user_id
            LEFT JOIN users approver ON r.approved_by = approver.user_id
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
            SELECT r.*, 
                   d.first_name, d.last_name,
                   from_lot.lot_number as from_lot_number,
                   from_section.section_name as from_section,
                   to_lot.lot_number as to_lot_number,
                   to_section.section_name as to_section,
                   requester.full_name as requested_by_name,
                   approver.full_name as approved_by_name
            FROM relocation_requests r
            JOIN decedent_records d ON r.deceased_id = d.decedent_id
            JOIN lots from_lot ON r.from_lot_id = from_lot.lot_id
            JOIN blocks from_block ON from_lot.block_id = from_block.block_id
            JOIN sections from_section ON from_block.section_id = from_section.section_id
            JOIN lots to_lot ON r.to_lot_id = to_lot.lot_id
            JOIN blocks to_block ON to_lot.block_id = to_block.block_id
            JOIN sections to_section ON to_block.section_id = to_section.section_id
            JOIN users requester ON r.requested_by = requester.user_id
            LEFT JOIN users approver ON r.approved_by = approver.user_id
            WHERE r.request_id = ?
        ");
        $stmt->execute([(int) $id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $stmt = $this->db->prepare("
            INSERT INTO relocation_requests
            (from_lot_id, to_lot_id, deceased_id, reason, requested_by)
            VALUES (?, ?, ?, ?, ?)
        ");
        $success = $stmt->execute([
            (int) $data['from_lot_id'],
            (int) $data['to_lot_id'],
            (int) $data['deceased_id'],
            $data['reason'],
            (int) $data['requested_by']
        ]);
        return $success ? (int) $this->db->lastInsertId() : false;
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare(" 
            UPDATE relocation_requests SET
                from_lot_id = ?,
                to_lot_id = ?,
                deceased_id = ?,
                reason = ?,
                status = ?,
                approved_by = ?
            WHERE request_id = ?
        ");
        return $stmt->execute([
            (int) $data['from_lot_id'],
            (int) $data['to_lot_id'],
            (int) $data['deceased_id'],
            $data['reason'],
            $data['status'] ?? 'Pending',
            isset($data['approved_by']) ? (int) $data['approved_by'] : null,
            (int) $id
        ]);
    }

    public function updateStatus($id, $status, $approvedBy = null) {
        $stmt = $this->db->prepare(" 
            UPDATE relocation_requests SET 
                status = ?,
                approved_by = ?,
                updated_at = NOW()
            WHERE request_id = ?
        ");
        return $stmt->execute([$status, $approvedBy ? (int) $approvedBy : null, (int) $id]);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM relocation_requests WHERE request_id = ?");
        return $stmt->execute([(int) $id]);
    }

    public function getStats() {
        $stmt = $this->db->query(" 
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) as pending,
                SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) as approved,
                SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) as completed,
                SUM(CASE WHEN status = 'Denied' THEN 1 ELSE 0 END) as denied
            FROM relocation_requests
        ");
        return $stmt->fetch();
    }
}
