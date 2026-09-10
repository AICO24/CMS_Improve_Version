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
 * Batch 5 (Remediated): Encapsulates server-side refund eligibility, decoupled two-phase
 * database transactions, exact integer centavo calculations, and two-tier idempotency:
 *   Tier 1: Request-level idempotency (via refunds.idempotency_key) to deduplicate CMS requests.
 *   Tier 2: PayMongo-level idempotency (cms_refund_{refundId}) for gateway call retries.
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
     * @param int             $paymentId      Target CMS payment ID
     * @param int|float|string $amount        Requested refund amount
     * @param string          $reason         duplicate|fraudulent|requested_by_customer|others
     * @param string|null     $notes          Optional internal notes
     * @param array           $user           Authenticated user identity (admin or staff)
     * @param string|null     $idempotencyKey Optional request-level idempotency key
     * @return array Normalized response array
     */
    public function processRefund(
        int $paymentId,
        $amount,
        string $reason = 'requested_by_customer',
        ?string $notes = null,
        array $user = [],
        ?string $idempotencyKey = null
    ): array {
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

        // 3. Exact centavo conversion and validation (NO float arithmetic)
        if (!is_numeric($amount)) {
            return [
                'error' => 'Refund amount must be a valid positive number',
                'code' => 400,
            ];
        }

        $amountCents = Refund::toCentavos($amount);
        if ($amountCents <= 0) {
            return [
                'error' => 'Refund amount must be greater than zero',
                'code' => 400,
            ];
        }

        if ($amountCents < 100) {
            return [
                'error' => 'Minimum refundable amount is PHP 1.00 (100 centavos)',
                'code' => 400,
            ];
        }

        $cleanIdempotencyKey = !empty($idempotencyKey) ? trim((string) $idempotencyKey) : null;

        // 4. Request-level Idempotency Check (Tier 1): Return existing operation if key was already processed
        if ($cleanIdempotencyKey !== null) {
            $existingRefund = $this->refundModel->findByIdempotencyKey($cleanIdempotencyKey);
            if ($existingRefund) {
                return [
                    'success' => ($existingRefund['status'] !== Refund::STATUS_FAILED),
                    'reused' => true,
                    'refund_id' => (int) $existingRefund['refund_id'],
                    'payment_id' => (int) $existingRefund['payment_id'],
                    'amount' => (float) $existingRefund['amount'],
                    'currency' => $existingRefund['currency'],
                    'status' => $existingRefund['status'],
                    'gateway_refund_id' => $existingRefund['gateway_refund_id'],
                    'reason' => $existingRefund['reason'],
                    'processed_at' => $existingRefund['processed_at'],
                    'idempotency_key' => $existingRefund['idempotency_key'],
                    'code' => 200,
                ];
            }
        }

        $userId = !empty($user['user_id']) ? (int) $user['user_id'] : null;
        $username = $user['username'] ?? null;

        // ------------------------------------------------------------------
        // Phase 1: Short DB transaction with row-lock to check eligibility,
        // compute remaining balance in exact centavos, and persist the initial
        // Pending record with its request idempotency key.
        // The external network call is NEVER executed inside this transaction.
        // ------------------------------------------------------------------
        $phase1Result = Database::getInstance()->transaction(function () use (
            $paymentId,
            $amountCents,
            $cleanReason,
            $notes,
            $userId,
            $cleanIdempotencyKey
        ) {
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
                SELECT amount
                FROM refunds
                WHERE payment_id = ?
                  AND status IN ('Pending', 'Processing', 'Succeeded')
                FOR UPDATE
            ");
            $stmtRef->execute([$paymentId]);
            $activeRows = $stmtRef->fetchAll(PDO::FETCH_ASSOC);

            // Exact integer centavo arithmetic
            $allocatedCents = 0;
            foreach ($activeRows as $r) {
                $allocatedCents += Refund::toCentavos($r['amount']);
            }

            $originalCents = Refund::toCentavos($payment['amount']);
            $remainingCents = max(0, $originalCents - $allocatedCents);

            if ($remainingCents <= 0) {
                return [
                    'error' => 'Payment has already been fully refunded',
                    'code' => 400,
                ];
            }

            if ($amountCents > $remainingCents) {
                return [
                    'error' => sprintf(
                        'Refund amount (PHP %s) exceeds remaining refundable balance (PHP %s)',
                        Refund::toPesos($amountCents),
                        Refund::toPesos($remainingCents)
                    ),
                    'code' => 400,
                ];
            }

            // Create initial Pending refund record with request idempotency key
            try {
                $refundId = $this->refundModel->create([
                    'payment_id' => $paymentId,
                    'idempotency_key' => $cleanIdempotencyKey,
                    'amount' => Refund::toPesos($amountCents),
                    'currency' => 'PHP',
                    'status' => Refund::STATUS_PENDING,
                    'reason' => $cleanReason,
                    'notes' => $notes,
                    'requested_by' => $userId,
                ]);
            } catch (PDOException $e) {
                // Catch concurrent duplicate insertion on unique idempotency_key
                if ($cleanIdempotencyKey !== null && ($e->getCode() == 23000 || ($e->errorInfo[1] ?? 0) === 1062 || strpos($e->getMessage(), 'Duplicate entry') !== false)) {
                    $existing = $this->refundModel->findByIdempotencyKey($cleanIdempotencyKey);
                    if ($existing) {
                        return [
                            'success' => ($existing['status'] !== Refund::STATUS_FAILED),
                            'reused' => true,
                            'refund_id' => (int) $existing['refund_id'],
                            'payment_id' => (int) $existing['payment_id'],
                            'amount' => (float) $existing['amount'],
                            'currency' => $existing['currency'],
                            'status' => $existing['status'],
                            'gateway_refund_id' => $existing['gateway_refund_id'],
                            'reason' => $existing['reason'],
                            'processed_at' => $existing['processed_at'],
                            'idempotency_key' => $existing['idempotency_key'],
                            'code' => 200,
                        ];
                    }
                }
                throw $e;
            }

            if (!$refundId) {
                return ['error' => 'Failed to initialize refund record', 'code' => 500];
            }

            return [
                'success' => true,
                'payment' => $payment,
                'refund_id' => $refundId,
                'amount_cents' => $amountCents,
                'reason' => $cleanReason,
                'notes' => $notes,
                'remaining_after_cents' => $remainingCents - $amountCents,
            ];
        });

        // Return immediately if Phase 1 returned error or an existing idempotent refund
        if (empty($phase1Result['success']) || !empty($phase1Result['reused'])) {
            return $phase1Result;
        }

        $payment = $phase1Result['payment'];
        $refundId = (int) $phase1Result['refund_id'];

        // ------------------------------------------------------------------
        // Phase 2: Call PayMongo API outside database transaction.
        // PayMongo Idempotency Key (Tier 2): cms_refund_{internalRefundId}
        // Guarantees retrying the exact same internal operation sends the SAME key.
        // ------------------------------------------------------------------
        $paymongoIdempotencyKey = "cms_refund_{$refundId}";

        $gatewayPayload = [
            'amount' => $amountCents, // Integer centavos
            'payment_id' => $payment['gateway_payment_id'],
            'reason' => $cleanReason,
        ];
        if (!empty($notes)) {
            $gatewayPayload['notes'] = substr($notes, 0, 255);
        }

        $gatewayResult = $this->payMongoService->createRefund($gatewayPayload, $paymongoIdempotencyKey);

        // ------------------------------------------------------------------
        // Phase 3: Short DB transaction to persist gateway response and audit trail.
        // ------------------------------------------------------------------
        $phase3Result = Database::getInstance()->transaction(function () use (
            $refundId,
            $paymentId,
            $payment,
            $amountCents,
            $cleanReason,
            $notes,
            $userId,
            $username,
            $gatewayResult,
            $cleanIdempotencyKey
        ) {
            $now = date('Y-m-d H:i:s');
            $amountFormatted = (float) Refund::toPesos($amountCents);

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
                        'idempotency_key' => $cleanIdempotencyKey,
                        'gateway_refund_id' => $gatewayRefundId,
                        'amount' => $amountFormatted,
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
                        'Refund #%d of PHP %s for payment receipt %s was successfully processed (Status: %s).',
                        $refundId,
                        Refund::toPesos($amountCents),
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
                    'idempotency_key' => $cleanIdempotencyKey,
                    'amount' => $amountFormatted,
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
                            'idempotency_key' => $cleanIdempotencyKey,
                            'amount' => $amountFormatted,
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
                            'amount' => $amountFormatted,
                            'status_code' => $statusCode,
                        ],
                    ]);

                    return [
                        'success' => false,
                        'error' => $rawError,
                        'refund_id' => $refundId,
                        'idempotency_key' => $cleanIdempotencyKey,
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
                            'idempotency_key' => $cleanIdempotencyKey,
                            'amount' => $amountFormatted,
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
                            'amount' => $amountFormatted,
                            'status_code' => $statusCode,
                        ],
                    ]);

                    return [
                        'success' => false,
                        'error' => 'Gateway request timed out or failed to respond. Refund record preserved in Processing state for reconciliation.',
                        'refund_id' => $refundId,
                        'idempotency_key' => $cleanIdempotencyKey,
                        'status' => $cmsStatus,
                        'code' => 502,
                    ];
                }
            }
        });

        return $phase3Result;
    }
}
