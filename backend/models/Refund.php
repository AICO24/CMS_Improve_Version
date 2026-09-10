<?php
require_once __DIR__ . '/../config/database.php';

/**
 * Refund Model
 *
 * Batch 5: Manages refund records, active allocation tracking, and status transitions.
 */
class Refund {
    private $db;

    public const STATUS_PENDING    = 'Pending';
    public const STATUS_PROCESSING = 'Processing';
    public const STATUS_SUCCEEDED  = 'Succeeded';
    public const STATUS_FAILED     = 'Failed';

    public const REASONS = [
        'duplicate',
        'fraudulent',
        'requested_by_customer',
        'others',
    ];

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    /**
     * Creates a new pending refund record.
     *
     * @param array $data
     * @return int|false The new refund_id or false on failure
     */
    public function create(array $data) {
        $reason = $data['reason'] ?? 'requested_by_customer';
        if (!in_array($reason, self::REASONS, true)) {
            $reason = 'requested_by_customer';
        }

        $stmt = $this->db->prepare("
            INSERT INTO refunds (
                payment_id, gateway_refund_id, gateway_provider, amount, currency,
                status, reason, notes, requested_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");

        $success = $stmt->execute([
            (int) $data['payment_id'],
            $data['gateway_refund_id'] ?? null,
            $data['gateway_provider'] ?? 'paymongo',
            (float) $data['amount'],
            $data['currency'] ?? 'PHP',
            $data['status'] ?? self::STATUS_PENDING,
            $reason,
            $data['notes'] ?? null,
            !empty($data['requested_by']) ? (int) $data['requested_by'] : null,
        ]);

        if (!$success) {
            return false;
        }

        return (int) $this->db->lastInsertId();
    }

    /**
     * Finds a refund by its internal primary key.
     */
    public function findById(int $refundId) {
        $stmt = $this->db->prepare("
            SELECT r.*, u.full_name AS requested_by_name, p.receipt_number, p.gateway_payment_id
            FROM refunds r
            LEFT JOIN users u ON r.requested_by = u.user_id
            LEFT JOIN payments p ON r.payment_id = p.payment_id
            WHERE r.refund_id = ?
            LIMIT 1
        ");
        $stmt->execute([$refundId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Finds a refund by its PayMongo gateway refund ID (ref_...).
     */
    public function findByGatewayRefundId(string $gatewayRefundId) {
        $stmt = $this->db->prepare("
            SELECT r.*, u.full_name AS requested_by_name, p.receipt_number
            FROM refunds r
            LEFT JOIN users u ON r.requested_by = u.user_id
            LEFT JOIN payments p ON r.payment_id = p.payment_id
            WHERE r.gateway_refund_id = ?
            LIMIT 1
        ");
        $stmt->execute([$gatewayRefundId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Returns all refunds for a specific payment, newest first.
     */
    public function findByPaymentId(int $paymentId) {
        $stmt = $this->db->prepare("
            SELECT r.*, u.full_name AS requested_by_name
            FROM refunds r
            LEFT JOIN users u ON r.requested_by = u.user_id
            WHERE r.payment_id = ?
            ORDER BY r.created_at DESC, r.refund_id DESC
        ");
        $stmt->execute([$paymentId]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }

    /**
     * Calculates the total amount already allocated/committed to active refunds.
     * Active statuses are Pending, Processing, and Succeeded.
     * Failed refunds release their allocated amount.
     */
    public function calculateAllocatedAmount(int $paymentId, ?int $excludeRefundId = null): float {
        $sql = "
            SELECT COALESCE(SUM(amount), 0) AS total_allocated
            FROM refunds
            WHERE payment_id = ?
              AND status IN ('Pending', 'Processing', 'Succeeded')
        ";
        $params = [$paymentId];

        if ($excludeRefundId !== null) {
            $sql .= " AND refund_id != ?";
            $params[] = $excludeRefundId;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return round((float) ($row['total_allocated'] ?? 0), 2);
    }

    /**
     * Calculates the remaining refundable balance for a payment based on the
     * CMS-authoritative original payment amount minus all active refunds.
     */
    public function calculateRemainingRefundable(int $paymentId, float $originalAmount, ?int $excludeRefundId = null): float {
        $allocated = $this->calculateAllocatedAmount($paymentId, $excludeRefundId);
        $remaining = $originalAmount - $allocated;
        return round(max(0.0, $remaining), 2);
    }

    /**
     * Updates refund status, optional gateway_refund_id, processed_at, and notes.
     */
    public function updateStatus(
        int $refundId,
        string $status,
        ?string $gatewayRefundId = null,
        ?string $processedAt = null,
        ?string $notes = null
    ): bool {
        $sql = "UPDATE refunds SET status = ?";
        $params = [$status];

        if ($gatewayRefundId !== null) {
            $sql .= ", gateway_refund_id = ?";
            $params[] = $gatewayRefundId;
        }
        if ($processedAt !== null) {
            $sql .= ", processed_at = ?";
            $params[] = $processedAt;
        }
        if ($notes !== null) {
            $sql .= ", notes = ?";
            $params[] = $notes;
        }

        $sql .= " WHERE refund_id = ?";
        $params[] = $refundId;

        $stmt = $this->db->prepare($sql);
        return $stmt->execute($params);
    }
}
