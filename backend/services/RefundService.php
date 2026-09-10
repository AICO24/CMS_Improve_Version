<?php
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/Refund.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/SystemException.php';
require_once __DIR__ . '/../services/PayMongoService.php';

/**
 * RefundService
 *
 * Batch 5: Encapsulates server-side refund eligibility, decoupled two-phase
 * database transactions, deterministic PayMongo idempotency, and audit logging.
 */
class RefundService {
    private $paymentModel;
    private $refundModel;
    private $payMongoService;
    private $auditLogModel;
    private $notificationModel;
    private $systemExceptionModel;

    public function __construct(
        ?Payment $paymentModel = null,
        ?Refund $refundModel = null,
        ?PayMongoService $payMongoService = null,
        ?AuditLog $auditLogModel = null,
        ?Notification $notificationModel = null,
        ?SystemException $systemExceptionModel = null
    ) {
        $this->paymentModel = $paymentModel ?: new Payment();
        $this->refundModel = $refundModel ?: new Refund();
        $this->payMongoService = $payMongoService ?: new PayMongoService();
        $this->auditLogModel = $auditLogModel ?: new AuditLog();
        $this->notificationModel = $notificationModel ?: new Notification();
        $this->systemExceptionModel = $systemExceptionModel ?: new SystemException();
    }

    /**
     * Processes a full or partial refund for a verified PayMongo payment.
     *
     * @param int   $paymentId Target CMS payment ID
     * @param float $amount    Requested refund amount in PHP
     * @param string $reason   duplicate|fraudulent|requested_by_customer|others
     * @param string|null $notes Optional internal notes
     * @param array $user      Authenticated user identity (admin or staff)
     * @return array Normalized response array
     */
    public function processRefund(int $paymentId, float $amount, string $reason = 'requested_by_customer', ?string $notes = null, array $user = []): array {
        // 1. Validate environment configuration
        if (!$this->payMongoService->isConfigured()) {
            return [
                'error' => 'Payment gateway is not configured for refunds',
                'code' => 503,
            ];
        }

        // 2. Validate reason against supported PayMongo values
        $validReasons = Refund::REASONS;
        $cleanReason = strtolower(trim($reason));
        if (!in_array($cleanReason, $validReasons, true)) {
            return [
                'error' => 'Invalid refund reason. Must be one of: ' . implode(', ', $validReasons),
                'code' => 400,
            ];
        }

        // 3. Validate positive numeric amount
        $amount = round($amount, 2);
        if ($amount <= 0.0) {
            return [
                'error' => 'Refund amount must be greater than zero',
                'code' => 400,
            ];
        }

        $amountCents = (int) round($amount * 100);
        if ($amountCents < 100) {
            return [
                'error' => 'Minimum refundable amount is PHP 1.00 (100 centavos)',
                'code' => 400,
            ];
        }

        $userId = !empty($user['user_id']) ? (int) $user['user_id'] : null;
        $username = $user['username'] ?? null;

        // ------------------------------------------------------------------
        // Phase 1: Short DB transaction with row-lock to check eligibility,
        // compute remaining balance, and persist the initial Pending record.
        // The external network call is NEVER executed inside this transaction.
        // ------------------------------------------------------------------
        $phase1Result = Database::getInstance()->transaction(function () use ($paymentId, $amount, $cleanReason, $notes, $userId) {
            $db = Database::getInstance()->getConnection();

            // Row-lock target payment
            $stmt = $db->prepare("SELECT * FROM payments WHERE payment_id = ? FOR UPDATE");
            $stmt->execute([$paymentId]);
            $payment = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$payment) {
                return ['error' => 'Payment not found', 'code' => 404];
            }

            // Eligibility Check 1: Verification status
            $verStatus = $payment['verification_status'] ?? '';
            if ($verStatus !== 'Verified') {
                return [
                    'error' => "Only Verified payments can be refunded (current status: {$verStatus})",
                    'code' => 400,
                ];
            }

            // Eligibility Check 2: Gateway provider
            $provider = strtolower((string) ($payment['gateway_provider'] ?? ''));
            if ($provider !== 'paymongo') {
                return [
                    'error' => 'Only PayMongo online payments are eligible for gateway refund',
                    'code' => 400,
                ];
            }

            // Eligibility Check 3: Gateway payment ID must exist
            $gatewayPaymentId = trim((string) ($payment['gateway_payment_id'] ?? ''));
            if ($gatewayPaymentId === '') {
                return [
                    'error' => 'Payment has no PayMongo payment ID and cannot be refunded online',
                    'code' => 400,
                ];
            }

            // Eligibility Check 4: Gateway status must be paid/succeeded
            $gatewayStatus = strtolower((string) ($payment['gateway_status'] ?? ''));
            if ($gatewayStatus !== 'paid' && $gatewayStatus !== 'succeeded') {
                return [
                    'error' => "Payment gateway status must be paid or succeeded (current: {$gatewayStatus})",
                    'code' => 400,
                ];
            }

            // Concurrency Lock: Lock all active refunds for this payment
            $stmtRef = $db->prepare("
                SELECT COALESCE(SUM(amount), 0) AS total_allocated
                FROM refunds
                WHERE payment_id = ?
                  AND status IN ('Pending', 'Processing', 'Succeeded')
                FOR UPDATE
            ");
            $stmtRef->execute([$paymentId]);
            $rowRef = $stmtRef->fetch(PDO::FETCH_ASSOC);
            $totalAllocated = round((float) ($rowRef['total_allocated'] ?? 0), 2);

            $originalAmount = round((float) $payment['amount'], 2);
            $remainingRefundable = round(max(0.0, $originalAmount - $totalAllocated), 2);

            if ($remainingRefundable <= 0.0) {
                return [
                    'error' => 'Payment has already been fully refunded',
                    'code' => 400,
                ];
            }

            if ($amount > $remainingRefundable) {
                return [
                    'error' => sprintf(
                        'Refund amount (PHP %.2f) exceeds remaining refundable balance (PHP %.2f)',
                        $amount,
                        $remainingRefundable
                    ),
                    'code' => 400,
                ];
            }

            // Create initial Pending refund record
            $refundId = $this->refundModel->create([
                'payment_id' => $paymentId,
                'amount' => $amount,
                'currency' => 'PHP',
                'status' => Refund::STATUS_PENDING,
                'reason' => $cleanReason,
                'notes' => $notes,
                'requested_by' => $userId,
            ]);

            if (!$refundId) {
                return ['error' => 'Failed to initialize refund record', 'code' => 500];
            }

            return [
                'success' => true,
                'payment' => $payment,
                'refund_id' => $refundId,
                'amount' => $amount,
                'reason' => $cleanReason,
                'notes' => $notes,
                'remaining_after' => round($remainingRefundable - $amount, 2),
            ];
        });

        if (empty($phase1Result['success'])) {
            return $phase1Result;
        }

        $payment = $phase1Result['payment'];
        $refundId = (int) $phase1Result['refund_id'];

        // ------------------------------------------------------------------
        // Phase 2: Call PayMongo API outside database transaction.
        // Idempotency Key format: cms_refund_{internalRefundId}
        // Guarantees retrying the exact same internal operation sends the SAME key.
        // ------------------------------------------------------------------
        $idempotencyKey = "cms_refund_{$refundId}";

        $gatewayPayload = [
            'amount' => $amountCents,
            'payment_id' => $payment['gateway_payment_id'],
            'reason' => $cleanReason,
        ];
        if (!empty($notes)) {
            $gatewayPayload['notes'] = substr($notes, 0, 255);
        }

        $gatewayResult = $this->payMongoService->createRefund($gatewayPayload, $idempotencyKey);

        // ------------------------------------------------------------------
        // Phase 3: Short DB transaction to persist gateway response and audit trail.
        // ------------------------------------------------------------------
        $phase3Result = Database::getInstance()->transaction(function () use (
            $refundId,
            $paymentId,
            $payment,
            $amount,
            $cleanReason,
            $notes,
            $userId,
            $username,
            $gatewayResult
        ) {
            $now = date('Y-m-d H:i:s');

            if ($gatewayResult['success']) {
                $refundData = $gatewayResult['data'] ?? [];
                $gatewayRefundId = $refundData['id'] ?? null;
                $gwAttrs = $refundData['attributes'] ?? [];
                $gwStatus = strtolower((string) ($gwAttrs['status'] ?? 'succeeded'));

                // Map PayMongo status: 'succeeded' -> 'Succeeded', 'processing'/'pending' -> 'Processing'
                $cmsStatus = ($gwStatus === 'succeeded') ? Refund::STATUS_SUCCEEDED : Refund::STATUS_PROCESSING;

                $this->refundModel->updateStatus($refundId, $cmsStatus, $gatewayRefundId, $now);

                // AuditLog
                $this->auditLogModel->log(
                    'Payment refund succeeded',
                    $userId,
                    $username,
                    'Payment',
                    $paymentId,
                    [
                        'refund_id' => $refundId,
                        'gateway_refund_id' => $gatewayRefundId,
                        'amount' => $amount,
                        'currency' => 'PHP',
                        'reason' => $cleanReason,
                        'status' => $cmsStatus,
                        'gateway_payment_id' => $payment['gateway_payment_id'],
                    ]
                );

                // Notification for actor/staff
                $this->notificationModel->create([
                    'title' => 'Payment Refund Processed',
                    'message' => sprintf(
                        'Refund #%d of PHP %.2f for payment receipt %s was successfully processed (Status: %s).',
                        $refundId,
                        $amount,
                        $payment['receipt_number'] ?? '',
                        $cmsStatus
                    ),
                    'notification_type' => 'Payment',
                    'user_id' => $userId,
                    'is_read' => 0,
                ]);

                return [
                    'success' => true,
                    'refund_id' => $refundId,
                    'payment_id' => $paymentId,
                    'amount' => $amount,
                    'currency' => 'PHP',
                    'status' => $cmsStatus,
                    'gateway_refund_id' => $gatewayRefundId,
                    'reason' => $cleanReason,
                    'processed_at' => $now,
                    'code' => 200,
                ];
            } else {
                $statusCode = (int) ($gatewayResult['status'] ?? 0);
                $rawError = (string) ($gatewayResult['error'] ?? 'PayMongo refund request failed');

                // Determine whether this was a definitive gateway rejection (4xx)
                // or an ambiguous network/server failure (status 0 or 5xx)
                $isDefinitiveClientError = ($statusCode >= 400 && $statusCode < 500);

                if ($isDefinitiveClientError) {
                    $cmsStatus = Refund::STATUS_FAILED;
                    $failureNote = substr(($notes ? $notes . ' | ' : '') . 'Error: ' . $rawError, 0, 500);
                    $this->refundModel->updateStatus($refundId, $cmsStatus, null, $now, $failureNote);

                    $this->auditLogModel->log(
                        'Payment refund failed',
                        $userId,
                        $username,
                        'Payment',
                        $paymentId,
                        [
                            'refund_id' => $refundId,
                            'amount' => $amount,
                            'error' => $rawError,
                            'gateway_status_code' => $statusCode,
                        ]
                    );

                    $this->systemExceptionModel->raise([
                        'event' => 'payment.refund_gateway_rejected',
                        'entity_type' => 'Payment',
                        'entity_id' => $paymentId,
                        'reason' => 'PayMongo rejected refund: ' . $rawError,
                        'severity' => 'critical',
                        'context' => [
                            'refund_id' => $refundId,
                            'amount' => $amount,
                            'status_code' => $statusCode,
                        ],
                    ]);

                    return [
                        'success' => false,
                        'error' => $rawError,
                        'refund_id' => $refundId,
                        'status' => $cmsStatus,
                        'code' => 400,
                    ];
                } else {
                    // Ambiguous timeout or 5xx: Keep as Processing/Pending with notes
                    // so it is NOT prematurely failed and does not allow duplicate refunds.
                    $cmsStatus = Refund::STATUS_PROCESSING;
                    $ambiguousNote = substr(($notes ? $notes . ' | ' : '') . 'Ambiguous Gateway Error: ' . $rawError, 0, 500);
                    $this->refundModel->updateStatus($refundId, $cmsStatus, null, null, $ambiguousNote);

                    $this->auditLogModel->log(
                        'Payment refund pending gateway confirmation',
                        $userId,
                        $username,
                        'Payment',
                        $paymentId,
                        [
                            'refund_id' => $refundId,
                            'amount' => $amount,
                            'error' => $rawError,
                            'status' => $cmsStatus,
                        ]
                    );

                    $this->systemExceptionModel->raise([
                        'event' => 'payment.refund_gateway_timeout',
                        'entity_type' => 'Payment',
                        'entity_id' => $paymentId,
                        'reason' => 'PayMongo refund request timed out or connection failed: ' . $rawError,
                        'severity' => 'critical',
                        'context' => [
                            'refund_id' => $refundId,
                            'amount' => $amount,
                            'status_code' => $statusCode,
                        ],
                    ]);

                    return [
                        'success' => false,
                        'error' => 'Gateway request timed out or failed to respond. Refund record preserved in Processing state for reconciliation.',
                        'refund_id' => $refundId,
                        'status' => $cmsStatus,
                        'code' => 502,
                    ];
                }
            }
        });

        return $phase3Result;
    }
}
