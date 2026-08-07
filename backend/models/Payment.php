<?php
require_once __DIR__ . '/../config/database.php';

class Payment {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
        $this->ensureSchema();
    }

    private function ensureSchema() {
        $requiredColumns = [
            'receipt_url' => "ALTER TABLE payments ADD COLUMN receipt_url varchar(255) DEFAULT NULL",
            'verification_status' => "ALTER TABLE payments ADD COLUMN verification_status enum('Pending','Verified','Rejected') NOT NULL DEFAULT 'Pending'",
            'verified_by' => "ALTER TABLE payments ADD COLUMN verified_by int(11) DEFAULT NULL",
            'verified_at' => "ALTER TABLE payments ADD COLUMN verified_at datetime DEFAULT NULL",
        ];

        try {
            $stmt = $this->db->query("SHOW COLUMNS FROM payments");
            $columns = array_column($stmt->fetchAll(), 'Field');
            foreach ($requiredColumns as $column => $alterSql) {
                if (!in_array($column, $columns, true)) {
                    $this->db->exec($alterSql);
                }
            }
        } catch (Throwable $e) {
            // Ignore schema repair errors in environments where migrations are managed separately.
        }
    }

    private function applyFilters(&$sql, &$params, $filters) {
        if (!empty($filters['transaction_type'])) {
            $sql .= " AND p.transaction_type = ?";
            $params[] = $filters['transaction_type'];
        }
        if (!empty($filters['date_from'])) {
            $sql .= " AND p.payment_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND p.payment_date <= ?";
            $params[] = $filters['date_to'];
        }
        if (!empty($filters['reference_id'])) {
            $sql .= " AND p.reference_id = ?";
            $params[] = $filters['reference_id'];
        }
        if (!empty($filters['received_by'])) {
            $sql .= " AND p.received_by = ?";
            $params[] = $filters['received_by'];
        }
        if (!empty($filters['verification_status'])) {
            $sql .= " AND p.verification_status = ?";
            $params[] = $filters['verification_status'];
        }
    }

    public function findAll($filters = [], $pagination = []) {
        $sql = "SELECT p.*, u.full_name AS received_by_name, v.full_name AS verified_by_name FROM payments p LEFT JOIN users u ON p.received_by = u.user_id LEFT JOIN users v ON p.verified_by = v.user_id WHERE 1=1";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $sql .= " ORDER BY p.payment_date DESC, p.created_at DESC";

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
        $sql = "SELECT COUNT(*) AS total FROM payments p WHERE 1=1";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT p.*, u.full_name AS received_by_name FROM payments p LEFT JOIN users u ON p.received_by = u.user_id WHERE p.payment_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $stmt = $this->db->prepare("INSERT INTO payments (transaction_type, reference_id, amount, payment_date, payment_method, receipt_number, notes, received_by, receipt_url, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        return $stmt->execute([
            $data['transaction_type'],
            $data['reference_id'] ?? null,
            $data['amount'],
            $data['payment_date'],
            $data['payment_method'],
            $data['receipt_number'],
            $data['notes'] ?? null,
            $data['received_by'] ?? null,
            $data['receipt_url'] ?? null,
            $data['verification_status'] ?? 'Pending',
        ]);
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare("UPDATE payments SET transaction_type = ?, reference_id = ?, amount = ?, payment_date = ?, payment_method = ?, receipt_number = ?, notes = ?, received_by = ?, receipt_url = ?, verification_status = ?, verified_by = ?, verified_at = ? WHERE payment_id = ?");
        return $stmt->execute([
            $data['transaction_type'],
            $data['reference_id'] ?? null,
            $data['amount'],
            $data['payment_date'],
            $data['payment_method'],
            $data['receipt_number'],
            $data['notes'] ?? null,
            $data['received_by'] ?? null,
            $data['receipt_url'] ?? null,
            $data['verification_status'] ?? 'Pending',
            $data['verified_by'] ?? null,
            $data['verified_at'] ?? null,
            $id,
        ]);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM payments WHERE payment_id = ?");
        return $stmt->execute([$id]);
    }

    public function getRevenue($filters = []) {
        $sql = "SELECT SUM(amount) AS total, COUNT(*) AS count FROM payments WHERE 1=1";
        $params = [];
        if (!empty($filters['date_from'])) {
            $sql .= " AND payment_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND payment_date <= ?";
            $params[] = $filters['date_to'];
        }
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetch();
    }

    public function getRevenueByMonth($year = null) {
        $year = $year ?: date('Y');
        $stmt = $this->db->prepare("SELECT MONTH(payment_date) AS month, SUM(amount) AS total FROM payments WHERE YEAR(payment_date) = ? GROUP BY MONTH(payment_date) ORDER BY MONTH(payment_date)");
        $stmt->execute([$year]);
        return $stmt->fetchAll();
    }

    public function getRevenueBreakdown($filters = []) {
        $sql = "SELECT transaction_type, SUM(amount) AS total, COUNT(*) AS count FROM payments WHERE 1=1";
        $params = [];
        if (!empty($filters['date_from'])) {
            $sql .= " AND payment_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND payment_date <= ?";
            $params[] = $filters['date_to'];
        }
        $sql .= " GROUP BY transaction_type ORDER BY total DESC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }
}
