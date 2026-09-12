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

    // is_high_confidence: NOT an auto-approval signal (see the discussion
    // that led here — an uploaded file plus a matching amount is still just
    // a self-reported claim, easily faked since lot prices are public) —
    // purely a triage aid so staff spend their one required verification
    // click on the genuinely uncertain payments first, not a substitute for
    // that click. True only when ALL of: transaction_type is 'Lot Purchase'
    // (the only type with a resolvable expected price — mirrors
    // PaymentController::resolveExpectedAmount()'s own rule), a receipt was
    // actually uploaded, and the submitted amount matches the real lot price
    // within a cent. Resolves that price via reference_kind (see
    // migration_20260902_add_payment_reference_kind.sql) exactly like
    // resolveExpectedAmount() does — a legacy row with reference_kind still
    // NULL simply can't be scored (LEFT JOINs resolve to NULL, so the
    // ABS(...) comparison is never true), same as that method's own
    // guess-fallback limitation.
    public function findAll($filters = [], $pagination = []) {
        $sql = "
            SELECT p.*, u.full_name AS received_by_name, v.full_name AS verified_by_name,
                   (
                       p.transaction_type = 'Lot Purchase'
                       AND p.receipt_url IS NOT NULL AND p.receipt_url <> ''
                       AND lot_price.price IS NOT NULL
                       AND ABS(p.amount - lot_price.price) <= 0.01
                   ) AS is_high_confidence
            FROM payments p
            LEFT JOIN users u ON p.received_by = u.user_id
            LEFT JOIN users v ON p.verified_by = v.user_id
            LEFT JOIN burial_schedules ref_schedule
                   ON p.reference_kind = 'schedule' AND p.reference_id = ref_schedule.schedule_id
            LEFT JOIN lots lot_price
                   ON (p.reference_kind = 'schedule' AND lot_price.lot_id = ref_schedule.lot_id)
                   OR (p.reference_kind = 'lot' AND lot_price.lot_id = p.reference_id)
            WHERE 1=1
        ";
        $params = [];
        $this->applyFilters($sql, $params, $filters);

        // High-confidence Pending payments float to the top of whatever view
        // is being looked at; everything else keeps the original recency
        // order. Harmless no-op reordering for a Verified/Rejected-filtered
        // view, where nobody's triaging anymore.
        $sql .= " ORDER BY (p.verification_status = 'Pending' AND is_high_confidence) DESC, p.payment_date DESC, p.created_at DESC";

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

    /**
     * Batch 3: Updates the gateway association columns on a payment record.
     * Preserves verification_status and all other legacy columns.
     */
    public function setGatewaySession($paymentId, $provider, $checkoutSessionId, $paymentIntentId = null, $gatewayStatus = 'awaiting_payment_method') {
        $stmt = $this->db->prepare("
            UPDATE payments
            SET gateway_provider = ?,
                gateway_checkout_session_id = ?,
                gateway_payment_intent_id = ?,
                gateway_status = ?
            WHERE payment_id = ?
        ");
        return $stmt->execute([$provider, $checkoutSessionId, $paymentIntentId, $gatewayStatus, (int) $paymentId]);
    }

    /**
     * Batch 4: Updates gateway_payment_id and gateway_status on a payment record.
     */
    public function setGatewayPaymentId($paymentId, $gatewayPaymentId, $gatewayStatus) {
        $stmt = $this->db->prepare("
            UPDATE payments
            SET gateway_payment_id = ?,
                gateway_status = ?
            WHERE payment_id = ?
        ");
        return $stmt->execute([$gatewayPaymentId, $gatewayStatus, (int) $paymentId]);
    }

    /**
     * Batch 3: Finds a Pending payment record by transaction type and reference.
     * Optionally filtered by user to verify ownership.
     */
    public function findPendingByReference($transactionType, $referenceId, $referenceKind = null, $userId = null) {
        $sql = "SELECT * FROM payments WHERE transaction_type = ? AND reference_id = ? AND verification_status = 'Pending'";
        $params = [$transactionType, $referenceId];
        if ($referenceKind !== null) {
            $sql .= " AND reference_kind = ?";
            $params[] = $referenceKind;
        }
        if ($userId !== null) {
            $sql .= " AND received_by = ?";
            $params[] = (int) $userId;
        }
        $sql .= " ORDER BY payment_id DESC LIMIT 1";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Batch 3: Finds a payment by its PayMongo Checkout Session ID.
     */
    public function findByCheckoutSessionId($checkoutSessionId) {
        $stmt = $this->db->prepare("SELECT * FROM payments WHERE gateway_checkout_session_id = ? LIMIT 1");
        $stmt->execute([$checkoutSessionId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Batch 10B: Checks if an active PayMongo checkout lease currently locks a lot.
     * An active lease is a pending PayMongo payment created within the lease window (1 hour)
     * whose gateway status is not expired, cancelled, or failed.
     *
     * @param int $lotId
     * @param int|null $excludePaymentId
     * @param int|null $excludeUserId
     * @return array|null
     */
    public function findActiveLotCheckoutLease($lotId, $excludePaymentId = null, $excludeUserId = null) {
        $sql = "
            SELECT p.*
            FROM payments p
            LEFT JOIN burial_schedules s ON p.reference_kind = 'schedule' AND p.reference_id = s.schedule_id
            WHERE p.transaction_type = 'Lot Purchase'
              AND p.verification_status = 'Pending'
              AND p.gateway_provider = 'paymongo'
              AND (p.gateway_status IS NULL OR p.gateway_status NOT IN ('expired', 'cancelled', 'failed'))
              AND p.created_at > (NOW() - INTERVAL 1 HOUR)
              AND (
                  (p.reference_kind = 'lot' AND p.reference_id = ?)
                  OR (p.reference_kind = 'schedule' AND s.lot_id = ? AND s.status = 'Pending')
              )
        ";
        $params = [(int) $lotId, (int) $lotId];
        if ($excludePaymentId !== null) {
            $sql .= " AND p.payment_id != ?";
            $params[] = (int) $excludePaymentId;
        }
        if ($excludeUserId !== null) {
            $sql .= " AND p.received_by != ?";
            $params[] = (int) $excludeUserId;
        }
        $sql .= " ORDER BY p.payment_id DESC LIMIT 1";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Batch 8: Identifies stale Pending gateway payment records that missed their webhook confirmation.
     *
     * Finds payments that are in Pending verification_status, have a stored Hosted Checkout
     * session ID, and were created at or before the threshold time ($olderThanMinutes ago).
     *
     * This method is strictly READ-ONLY:
     * - Does NOT modify payment state
     * - Does NOT contact PayMongo
     * - Does NOT trigger automations or alter bookings/lots
     *
     * @param int $olderThanMinutes Age threshold in minutes (default 60)
     * @return array List of stale payment records with correlation details
     */
    public function findStalePendingGatewayPayments(int $olderThanMinutes = 60): array {
        $minutes = max(0, $olderThanMinutes);
        $thresholdTime = date('Y-m-d H:i:s', time() - ($minutes * 60));

        $sql = "
            SELECT p.*, u.full_name AS received_by_name
            FROM payments p
            LEFT JOIN users u ON p.received_by = u.user_id
            WHERE p.verification_status = 'Pending'
              AND p.gateway_checkout_session_id IS NOT NULL
              AND p.gateway_checkout_session_id != ''
              AND p.created_at <= ?
            ORDER BY p.created_at ASC, p.payment_id ASC
        ";
        $stmt = $this->db->prepare($sql);
        $stmt->execute([$thresholdTime]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
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

    public function getRevenueByYear($filters = []) {
        $sql = "SELECT YEAR(payment_date) AS year, SUM(amount) AS total FROM payments WHERE 1=1";
        $params = [];
        if (!empty($filters['date_from'])) {
            $sql .= " AND payment_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND payment_date <= ?";
            $params[] = $filters['date_to'];
        }
        $sql .= " GROUP BY YEAR(payment_date) ORDER BY YEAR(payment_date) ASC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
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
