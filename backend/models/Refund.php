<?php
require_once __DIR__ . '/../config/database.php';

/**
 * Refund Model
 *
 * Batch 5 (Remediated): Manages refund records, exact integer centavo balance tracking,
 * request-level idempotency, and status transitions.
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
     * Converts a monetary amount (int, float, or string) to exact integer centavos.
     * Does NOT use unsafe binary floating-point multiplication.
     *
     * @param int|float|string $amount
     * @return int Exact integer centavos (e.g. 1000.01 -> 100001)
     */
    public static function toCentavos($amount): int {
        if (is_int($amount)) {
            return $amount * 100;
        }
        if (is_float($amount)) {
            $str = number_format($amount, 2, '.', '');
        } else {
            $str = trim((string) $amount);
        }

        $isNegative = (strpos($str, '-') === 0);
        $str = ltrim($str, '+-');

        $parts = explode('.', $str, 2);
        $pesos = (int) ($parts[0] !== '' ? $parts[0] : 0);
        $centsStr = isset($parts[1]) ? substr($parts[1], 0, 2) : '00';
        $cents = (int) str_pad($centsStr, 2, '0', STR_PAD_RIGHT);

        $totalCents = ($pesos * 100) + $cents;
        return $isNegative ? -$totalCents : $totalCents;
    }

    /**
     * Converts integer centavos to formatted 2-decimal PHP string.
     *
     * @param int $cents
     * @return string Formatted monetary value, e.g. "1000.01"
     */
    public static function toPesos(int $cents): string {
        $isNegative = $cents < 0;
        $absCents = abs($cents);
        $pesos = intdiv($absCents, 100);
        $remainder = $absCents % 100;
        $formatted = sprintf('%d.%02d', $pesos, $remainder);
        return $isNegative ? '-' . $formatted : $formatted;
    }

    /**
     * Creates a new pending refund record with request-level idempotency key.
     *
     * @param array $data
     * @return int|false The new refund_id or false on failure
     */
    public function create(array $data) {
        $reason = $data['reason'] ?? 'requested_by_customer';
        if (!in_array($reason, self::REASONS, true)) {
            $reason = 'requested_by_customer';
        }

        $amountStr = is_string($data['amount'])
            ? $data['amount']
            : self::toPesos(self::toCentavos($data['amount']));

        $stmt = $this->db->prepare("
            INSERT INTO refunds (
                payment_id, idempotency_key, gateway_refund_id, gateway_provider, amount, currency,
                status, reason, notes, requested_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");

        $success = $stmt->execute([
            (int) $data['payment_id'],
            !empty($data['idempotency_key']) ? trim((string) $data['idempotency_key']) : null,
            $data['gateway_refund_id'] ?? null,
            $data['gateway_provider'] ?? 'paymongo',
            $amountStr,
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
     * Finds a refund by its request-level idempotency key.
     */
    public function findByIdempotencyKey(string $idempotencyKey) {
        $cleanKey = trim($idempotencyKey);
        if ($cleanKey === '') {
            return null;
        }
        $stmt = $this->db->prepare("
            SELECT r.*, u.full_name AS requested_by_name, p.receipt_number, p.gateway_payment_id
            FROM refunds r
            LEFT JOIN users u ON r.requested_by = u.user_id
            LEFT JOIN payments p ON r.payment_id = p.payment_id
            WHERE r.idempotency_key = ?
            LIMIT 1
        ");
        $stmt->execute([$cleanKey]);
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
     * Calculates the total centavos already allocated to active refunds.
     * Active statuses are Pending, Processing, and Succeeded.
     * Uses exact integer arithmetic.
     */
    public function calculateAllocatedCents(int $paymentId, ?int $excludeRefundId = null): int {
        $sql = "
            SELECT amount
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
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $totalCents = 0;
        foreach ($rows as $row) {
            $totalCents += self::toCentavos($row['amount']);
        }
        return $totalCents;
    }

    /**
     * Calculates the remaining refundable balance in exact integer centavos:
     * original_cents - (pending_cents + processing_cents + succeeded_cents) = remaining_refundable_cents.
     */
    public function calculateRemainingRefundableCents(int $paymentId, $originalAmount, ?int $excludeRefundId = null): int {
        $originalCents = self::toCentavos($originalAmount);
        $allocatedCents = $this->calculateAllocatedCents($paymentId, $excludeRefundId);
        $remainingCents = $originalCents - $allocatedCents;
        return max(0, $remainingCents);
    }

    /**
     * Decimal balance helper (wraps exact centavo calculation).
     */
    public function calculateAllocatedAmount(int $paymentId, ?int $excludeRefundId = null): float {
        return (float) self::toPesos($this->calculateAllocatedCents($paymentId, $excludeRefundId));
    }

    /**
     * Decimal balance helper (wraps exact centavo calculation).
     */
    public function calculateRemainingRefundable(int $paymentId, float $originalAmount, ?int $excludeRefundId = null): float {
        return (float) self::toPesos($this->calculateRemainingRefundableCents($paymentId, $originalAmount, $excludeRefundId));
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

    /**
     * Batch 7: Identifies stale/ambiguous refund records that require manual investigation.
     *
     * Finds refunds that are in Pending or Processing state, have no gateway_refund_id,
     * and were created at or before the threshold time ($olderThanMinutes ago).
     *
     * This helper is strictly READ-ONLY:
     * - Does NOT modify refund status
     * - Does NOT call PayMongo
     * - Does NOT cancel bookings or alter lots/schedules
     * - Does NOT automatically retry refunds
     *
     * @param int $olderThanMinutes Age threshold in minutes (default 30)
     * @return array List of stale refund records with associated payment details
     */
    public function findStalePendingGatewayRefunds(int $olderThanMinutes = 30): array {
        $minutes = max(0, $olderThanMinutes);
        $thresholdTime = date('Y-m-d H:i:s', time() - ($minutes * 60));

        $stmt = $this->db->prepare("
            SELECT r.*, p.gateway_payment_id, p.receipt_number, p.verification_status,
                   u.full_name AS requested_by_name
            FROM refunds r
            LEFT JOIN payments p ON r.payment_id = p.payment_id
            LEFT JOIN users u ON r.requested_by = u.user_id
            WHERE r.status IN ('Pending', 'Processing')
              AND r.gateway_refund_id IS NULL
              AND r.created_at <= ?
            ORDER BY r.created_at ASC, r.refund_id ASC
        ");
        $stmt->execute([$thresholdTime]);
        return $stmt->fetchAll(PDO::FETCH_ASSOC);
    }
}
