<?php
require_once __DIR__ . '/../config/database.php';

class Payment {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    // Batch L2.10: this used to run ensureSchema(), which conditionally issued
    // "ALTER TABLE payments ADD COLUMN ..." for receipt_url/verification_status/
    // verified_by/verified_at on every construction (removed here). All four
    // columns have been part of the canonical schema.sql baseline since
    // 2026-08-07 (migration_20260729_add_payment_receipt_verification.sql,
    // folded in — see schema.sql's own header note), so the runtime check was
    // redundant on any environment provisioned from it. It was also the same
    // class of risk fixed in AuditLog (Batch L2.8): MySQL implicitly commits
    // the active transaction on any DDL statement, so constructing a fresh
    // Payment() while a Database::transaction() was open would have silently
    // ended it, exactly like the AuditLog defect did.

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
        $stmt = $this->db->prepare("SELECT p.*, u.full_name AS received_by_name, v.full_name AS verified_by_name FROM payments p LEFT JOIN users u ON p.received_by = u.user_id LEFT JOIN users v ON p.verified_by = v.user_id WHERE p.payment_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    // Returns the new payment_id on success (or false on failure) rather than a
    // plain bool, so callers can use it both as a truthy success check (existing
    // behavior, since AUTO_INCREMENT ids are always > 0) and to auto-generate a
    // receipt number that embeds the id (see below).
    public function create($data) {
        $providedReceiptNumber = isset($data['receipt_number']) ? trim($data['receipt_number']) : '';

        $stmt = $this->db->prepare("INSERT INTO payments (transaction_type, reference_id, reference_kind, amount, payment_date, payment_method, receipt_number, notes, received_by, receipt_url, verification_status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)");
        $success = $stmt->execute([
            $data['transaction_type'],
            $data['reference_id'] ?? null,
            $data['reference_kind'] ?? null,
            $data['amount'],
            $data['payment_date'],
            $data['payment_method'],
            $providedReceiptNumber,
            $data['notes'] ?? null,
            $data['received_by'] ?? null,
            $data['receipt_url'] ?? null,
            $data['verification_status'] ?? 'Pending',
        ]);

        if (!$success) {
            return false;
        }

        $paymentId = (int) $this->db->lastInsertId();

        // No receipt number was supplied — generate one deterministically from the
        // id MySQL just assigned, so it's guaranteed unique without a pre-insert
        // lookup or a schema change (RCPT-{year}-{payment_id}).
        if ($providedReceiptNumber === '') {
            $generated = 'RCPT-' . date('Y') . '-' . $paymentId;
            $update = $this->db->prepare("UPDATE payments SET receipt_number = ? WHERE payment_id = ?");
            $update->execute([$generated, $paymentId]);
        }

        return $paymentId;
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare("UPDATE payments SET transaction_type = ?, reference_id = ?, reference_kind = ?, amount = ?, payment_date = ?, payment_method = ?, receipt_number = ?, notes = ?, received_by = ?, receipt_url = ?, verification_status = ?, verified_by = ?, verified_at = ? WHERE payment_id = ?");
        return $stmt->execute([
            $data['transaction_type'],
            $data['reference_id'] ?? null,
            $data['reference_kind'] ?? null,
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

    // Atomic idempotency guard for PaymentController::verify() (Batch L2.4):
    // only writes verification_status/verified_by/verified_at, and only when
    // the row is still Pending — the WHERE clause makes "is this still
    // Pending?" and "claim it" a single database-level operation instead of
    // the old read-then-branch-then-write pattern, which two simultaneous
    // verify() calls could both pass before either wrote. Callers must check
    // the return value: true means this call is the one that actually
    // claimed the payment (rowCount() === 1); false means it was already
    // reviewed (rowCount() === 0) and no column was touched.
    public function verifyIfPending($id, $status, $verifiedBy, $verifiedAt) {
        $stmt = $this->db->prepare("
            UPDATE payments
            SET verification_status = ?, verified_by = ?, verified_at = ?
            WHERE payment_id = ? AND verification_status = 'Pending'
        ");
        $stmt->execute([$status, $verifiedBy, $verifiedAt, (int) $id]);
        return $stmt->rowCount() === 1;
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM payments WHERE payment_id = ?");
        return $stmt->execute([$id]);
    }

    public function receiptNumberExists($receiptNumber) {
        $stmt = $this->db->prepare("SELECT COUNT(*) AS total FROM payments WHERE receipt_number = ?");
        $stmt->execute([$receiptNumber]);
        return (int) ($stmt->fetch()['total'] ?? 0) > 0;
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

    public function getVerificationBreakdown($filters = []) {
        $sql = "SELECT verification_status, SUM(amount) AS total, COUNT(*) AS count FROM payments WHERE 1=1";
        $params = [];
        if (!empty($filters['date_from'])) {
            $sql .= " AND payment_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND payment_date <= ?";
            $params[] = $filters['date_to'];
        }
        $sql .= " GROUP BY verification_status ORDER BY verification_status";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function getRevenueByMethod($filters = []) {
        $sql = "SELECT payment_method, SUM(amount) AS total, COUNT(*) AS count FROM payments WHERE 1=1";
        $params = [];
        if (!empty($filters['date_from'])) {
            $sql .= " AND payment_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND payment_date <= ?";
            $params[] = $filters['date_to'];
        }
        $sql .= " GROUP BY payment_method ORDER BY total DESC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }
}
