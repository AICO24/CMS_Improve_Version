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

    /**
     * Batch 6: Authoritative PayMongo refund webhook state synchronization.
     *
     * Validates incoming gateway data (exact integer centavos, currency, livemode,
     * associated payment ID), checks idempotency via webhook_events, enforces
     * terminal state protection and invalid regression guards, and executes a short
     * database transaction for internal state reconciliation.
     *
     * @param array $eventDetails Normalized event parameters:
     *                            - event_id: string (evt_... or fallback:refund:...)
     *                            - is_fallback_event_id: bool
     *                            - event_type: string (payment.refunded, payment.refund.updated, refund.succeeded)
     *                            - livemode: bool
     *                            - gateway_refund_id: string (ref_...)
     *                            - gateway_status: string (pending, processing, succeeded, failed)
     *                            - amount_cents: int (exact integer centavos)
     *                            - currency: string (PHP)
     *                            - gateway_payment_id: ?string (pay_...)
     *                            - reason: ?string
     *                            - notes: ?string
     * @return array Normalized response array with 'code' HTTP status
     */
    public function synchronizeWebhookRefund(array $eventDetails): array {
        $gatewayRefundId = trim((string) ($eventDetails['gateway_refund_id'] ?? ''));
        if ($gatewayRefundId === '') {
            return ['error' => 'Missing gateway refund ID', 'code' => 400];
        }

        $amountCents = isset($eventDetails['amount_cents']) ? (int) $eventDetails['amount_cents'] : 0;
        if ($amountCents <= 0) {
            return ['error' => 'Invalid or non-positive refund amount', 'code' => 400];
        }

        $eventId = trim((string) ($eventDetails['event_id'] ?? ''));
        if ($eventId === '') {
            return ['error' => 'Missing event ID or fallback key', 'code' => 400];
        }

        $eventType = trim((string) ($eventDetails['event_type'] ?? ''));
        $supportedEvents = ['payment.refunded', 'payment.refund.updated', 'refund.succeeded'];
        if (!in_array($eventType, $supportedEvents, true)) {
            $db = Database::getInstance()->getConnection();
            $updStmt = $db->prepare("
                INSERT INTO webhook_events (event_id, event_type, livemode, received_at, processed, processing_result)
                VALUES (?, ?, ?, NOW(), 1, 'ignored_unsupported_event_type')
                ON DUPLICATE KEY UPDATE processed = 1, processing_result = 'ignored_unsupported_event_type'
            ");
            $updStmt->execute([$eventId, $eventType, !empty($eventDetails['livemode']) ? 1 : 0]);

            return [
                'success' => true,
                'status' => 'ignored',
                'message' => 'Event type safely ignored',
                'event_type' => $eventType,
                'code' => 200,
            ];
        }

        // 1. Currency validation (PHP required)
        $currency = strtoupper(trim((string) ($eventDetails['currency'] ?? 'PHP')));
        if ($currency !== 'PHP') {
            $this->systemExceptionModel->raise([
                'event' => 'payment.refund_webhook_currency_mismatch',
                'entity_type' => 'Refund',
                'entity_id' => 0,
                'reason' => sprintf('Currency mismatch: webhook currency is %s, but CMS expects PHP', $currency),
                'severity' => 'critical',
                'context' => [
                    'event_id' => $eventId,
                    'gateway_refund_id' => $gatewayRefundId,
                    'currency' => $currency,
                ],
            ]);

            $db = Database::getInstance()->getConnection();
            $stmt = $db->prepare("
                INSERT INTO webhook_events (event_id, event_type, livemode, received_at, processed, processing_result)
                VALUES (?, ?, ?, NOW(), 1, 'currency_mismatch')
                ON DUPLICATE KEY UPDATE processed = 1, processing_result = 'currency_mismatch'
            ");
            $stmt->execute([$eventId, $eventType, !empty($eventDetails['livemode']) ? 1 : 0]);

            return [
                'success' => true,
                'status' => 'mismatch',
                'message' => 'Currency mismatch',
                'code' => 200,
            ];
        }

        // 2. Livemode validation against CMS environment
        $cmsMode = $this->payMongoService->getMode();
        if ($cmsMode === 'unconfigured') {
            $env = strtolower(trim((string) EnvironmentService::get('PAYMONGO_ENV', '')));
            $cmsMode = ($env === 'live' || $env === 'production') ? 'live' : 'test';
        }
        $expectedLivemode = ($cmsMode === 'live');
        $livemode = !empty($eventDetails['livemode']);

        if ($livemode !== $expectedLivemode) {
            $this->systemExceptionModel->raise([
                'event' => 'payment.refund_webhook_environment_mismatch',
                'entity_type' => 'Refund',
                'entity_id' => 0,
                'reason' => sprintf('Livemode mismatch: webhook livemode is %s, but CMS is in %s mode', $livemode ? 'true' : 'false', $cmsMode),
                'severity' => 'critical',
                'context' => [
                    'event_id' => $eventId,
                    'gateway_refund_id' => $gatewayRefundId,
                    'webhook_livemode' => $livemode,
                    'cms_mode' => $cmsMode,
                ],
            ]);

            $db = Database::getInstance()->getConnection();
            $stmt = $db->prepare("
                INSERT INTO webhook_events (event_id, event_type, livemode, received_at, processed, processing_result)
                VALUES (?, ?, ?, NOW(), 1, 'environment_mismatch')
                ON DUPLICATE KEY UPDATE processed = 1, processing_result = 'environment_mismatch'
            ");
            $stmt->execute([$eventId, $eventType, $livemode ? 1 : 0]);

            return [
                'success' => true,
                'status' => 'mismatch',
                'message' => 'Environment mode mismatch',
                'code' => 200,
            ];
        }

        // 3. Short Database Transaction: Idempotency check, row-lock, state validation & sync
        $statusMap = [
            'pending' => Refund::STATUS_PENDING,
            'processing' => Refund::STATUS_PROCESSING,
            'succeeded' => Refund::STATUS_SUCCEEDED,
            'failed' => Refund::STATUS_FAILED,
        ];
        $rawStatusKey = strtolower(trim((string) ($eventDetails['gateway_status'] ?? '')));
        $targetStatus = $statusMap[$rawStatusKey] ?? null;
        if ($targetStatus === null) {
            if ($eventType === 'refund.succeeded' || $eventType === 'payment.refunded') {
                $targetStatus = Refund::STATUS_SUCCEEDED;
            } else {
                $db = Database::getInstance()->getConnection();
                $upd = $db->prepare("
                    INSERT INTO webhook_events (event_id, event_type, livemode, received_at, processed, processing_result)
                    VALUES (?, ?, ?, NOW(), 1, 'invalid_gateway_status')
                    ON DUPLICATE KEY UPDATE processed = 1, processing_result = 'invalid_gateway_status'
                ");
                $upd->execute([$eventId, $eventType, $livemode ? 1 : 0]);

                return [
                    'success' => true,
                    'status' => 'ignored',
                    'message' => 'Unrecognized gateway refund status: ' . $rawStatusKey,
                    'code' => 200,
                ];
            }
        }

        $gatewayPaymentId = !empty($eventDetails['gateway_payment_id']) ? trim((string) $eventDetails['gateway_payment_id']) : null;
        $isFallbackEventId = !empty($eventDetails['is_fallback_event_id']);
        $incomingNotes = !empty($eventDetails['notes']) ? trim((string) $eventDetails['notes']) : null;

        $syncResult = Database::getInstance()->transaction(function () use (
            $eventId,
            $eventType,
            $livemode,
            $isFallbackEventId,
            $gatewayRefundId,
            $gatewayPaymentId,
            $amountCents,
            $currency,
            $targetStatus,
            $incomingNotes
        ) {
            $db = Database::getInstance()->getConnection();

            // Check & row-lock webhook_events idempotency record
            $checkStmt = $db->prepare("SELECT * FROM webhook_events WHERE event_id = ? FOR UPDATE");
            $checkStmt->execute([$eventId]);
            $existingEvent = $checkStmt->fetch(PDO::FETCH_ASSOC);

            if ($existingEvent && (int) $existingEvent['processed'] === 1) {
                return [
                    'success' => true,
                    'status' => 'duplicate',
                    'message' => 'Event already processed',
                    'event_id' => $eventId,
                    'code' => 200,
                ];
            }

            if (!$existingEvent) {
                try {
                    $insStmt = $db->prepare("
                        INSERT INTO webhook_events (event_id, event_type, livemode, received_at, processed, processing_result)
                        VALUES (?, ?, ?, NOW(), 0, 'processing')
                    ");
                    $insStmt->execute([$eventId, $eventType, $livemode ? 1 : 0]);
                } catch (PDOException $e) {
                    if ($e->getCode() == 23000 || ($e->errorInfo[1] ?? 0) === 1062 || strpos($e->getMessage(), 'Duplicate entry') !== false) {
                        return [
                            'success' => true,
                            'status' => 'duplicate',
                            'message' => 'Event already processed',
                            'event_id' => $eventId,
                            'code' => 200,
                        ];
                    }
                    throw $e;
                }
            }

            // Row-lock target CMS refund record
            $stmtRef = $db->prepare("
                SELECT r.*, p.gateway_payment_id AS payment_gateway_id, p.receipt_number
                FROM refunds r
                LEFT JOIN payments p ON r.payment_id = p.payment_id
                WHERE r.gateway_refund_id = ?
                FOR UPDATE
            ");
            $stmtRef->execute([$gatewayRefundId]);
            $cmsRefund = $stmtRef->fetch(PDO::FETCH_ASSOC);

            if (!$cmsRefund) {
                $this->systemExceptionModel->raise([
                    'event' => 'payment.refund_webhook_unmatched',
                    'entity_type' => 'Refund',
                    'entity_id' => 0,
                    'reason' => 'No CMS refund matched gateway refund ID: ' . $gatewayRefundId,
                    'severity' => 'critical',
                    'context' => [
                        'event_id' => $eventId,
                        'gateway_refund_id' => $gatewayRefundId,
                        'event_type' => $eventType,
                    ],
                ]);

                $upd = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = 'unmatched_refund' WHERE event_id = ?");
                $upd->execute([$eventId]);

                return [
                    'success' => true,
                    'status' => 'unmatched',
                    'message' => 'No matching CMS refund found',
                    'gateway_refund_id' => $gatewayRefundId,
                    'code' => 200,
                ];
            }

            $refundId = (int) $cmsRefund['refund_id'];

            // Validate associated payment ID
            $expectedPaymentGatewayId = trim((string) ($cmsRefund['payment_gateway_id'] ?? ''));
            if ($gatewayPaymentId !== null && $expectedPaymentGatewayId !== '' && $gatewayPaymentId !== $expectedPaymentGatewayId) {
                $this->systemExceptionModel->raise([
                    'event' => 'payment.refund_webhook_payment_mismatch',
                    'entity_type' => 'Refund',
                    'entity_id' => $refundId,
                    'reason' => sprintf('Associated payment ID mismatch: webhook payment_id (%s) does not match CMS payment gateway ID (%s)', $gatewayPaymentId, $expectedPaymentGatewayId),
                    'severity' => 'critical',
                    'context' => [
                        'event_id' => $eventId,
                        'refund_id' => $refundId,
                        'webhook_payment_id' => $gatewayPaymentId,
                        'cms_payment_id' => $expectedPaymentGatewayId,
                    ],
                ]);

                $upd = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = 'payment_mismatch' WHERE event_id = ?");
                $upd->execute([$eventId]);

                return [
                    'success' => true,
                    'status' => 'mismatch',
                    'message' => 'Payment ID mismatch',
                    'code' => 200,
                ];
            }

            // Validate exact integer centavos amount
            $cmsRefundCents = Refund::toCentavos($cmsRefund['amount']);
            if ($amountCents !== $cmsRefundCents) {
                $this->systemExceptionModel->raise([
                    'event' => 'payment.refund_webhook_amount_mismatch',
                    'entity_type' => 'Refund',
                    'entity_id' => $refundId,
                    'reason' => sprintf('Refund amount mismatch: webhook amount (%d cents) does not match CMS refund amount (%d cents)', $amountCents, $cmsRefundCents),
                    'severity' => 'critical',
                    'context' => [
                        'event_id' => $eventId,
                        'refund_id' => $refundId,
                        'webhook_amount_cents' => $amountCents,
                        'cms_amount_cents' => $cmsRefundCents,
                    ],
                ]);

                $upd = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = 'amount_mismatch' WHERE event_id = ?");
                $upd->execute([$eventId]);

                return [
                    'success' => true,
                    'status' => 'mismatch',
                    'message' => 'Amount mismatch',
                    'code' => 200,
                ];
            }

            // Validate currency matches CMS refund currency
            $cmsRefundCurrency = strtoupper((string) ($cmsRefund['currency'] ?? 'PHP'));
            if ($currency !== $cmsRefundCurrency) {
                $this->systemExceptionModel->raise([
                    'event' => 'payment.refund_webhook_currency_mismatch',
                    'entity_type' => 'Refund',
                    'entity_id' => $refundId,
                    'reason' => sprintf('Refund currency mismatch: webhook currency (%s) does not match CMS refund currency (%s)', $currency, $cmsRefundCurrency),
                    'severity' => 'critical',
                    'context' => [
                        'event_id' => $eventId,
                        'refund_id' => $refundId,
                        'webhook_currency' => $currency,
                        'cms_currency' => $cmsRefundCurrency,
                    ],
                ]);

                $upd = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = 'currency_mismatch' WHERE event_id = ?");
                $upd->execute([$eventId]);

                return [
                    'success' => true,
                    'status' => 'mismatch',
                    'message' => 'Currency mismatch',
                    'code' => 200,
                ];
            }

            // Safe state machine enforcement
            $currentStatus = $cmsRefund['status'];

            // Rule 1: Identical status is an idempotent no-op
            if ($currentStatus === $targetStatus) {
                $upd = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = 'already_in_state' WHERE event_id = ?");
                $upd->execute([$eventId]);

                return [
                    'success' => true,
                    'status' => 'no_change',
                    'message' => 'Refund is already in status ' . $targetStatus,
                    'refund_id' => $refundId,
                    'current_status' => $currentStatus,
                    'code' => 200,
                ];
            }

            // Rule 2: Succeeded is terminal — cannot regress to any other state
            if ($currentStatus === Refund::STATUS_SUCCEEDED) {
                $this->systemExceptionModel->raise([
                    'event' => 'payment.refund_invalid_state_regression',
                    'entity_type' => 'Refund',
                    'entity_id' => $refundId,
                    'reason' => sprintf('Invalid refund state regression rejected: Succeeded cannot regress to %s', $targetStatus),
                    'severity' => 'warning',
                    'context' => [
                        'event_id' => $eventId,
                        'refund_id' => $refundId,
                        'current_status' => $currentStatus,
                        'attempted_status' => $targetStatus,
                    ],
                ]);

                $upd = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = 'invalid_state_regression' WHERE event_id = ?");
                $upd->execute([$eventId]);

                return [
                    'success' => true,
                    'status' => 'ignored',
                    'message' => 'Invalid state regression: Succeeded is terminal',
                    'refund_id' => $refundId,
                    'current_status' => $currentStatus,
                    'code' => 200,
                ];
            }

            // Rule 3: Failed is terminal — cannot regress to Pending or Processing
            if ($currentStatus === Refund::STATUS_FAILED && ($targetStatus === Refund::STATUS_PENDING || $targetStatus === Refund::STATUS_PROCESSING)) {
                $this->systemExceptionModel->raise([
                    'event' => 'payment.refund_invalid_state_regression',
                    'entity_type' => 'Refund',
                    'entity_id' => $refundId,
                    'reason' => sprintf('Invalid refund state regression rejected: Failed cannot regress to %s', $targetStatus),
                    'severity' => 'warning',
                    'context' => [
                        'event_id' => $eventId,
                        'refund_id' => $refundId,
                        'current_status' => $currentStatus,
                        'attempted_status' => $targetStatus,
                    ],
                ]);

                $upd = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = 'invalid_state_regression' WHERE event_id = ?");
                $upd->execute([$eventId]);

                return [
                    'success' => true,
                    'status' => 'ignored',
                    'message' => 'Invalid state regression: Failed cannot regress',
                    'refund_id' => $refundId,
                    'current_status' => $currentStatus,
                    'code' => 200,
                ];
            }

            // Rule 4: Processing cannot regress to Pending
            if ($currentStatus === Refund::STATUS_PROCESSING && $targetStatus === Refund::STATUS_PENDING) {
                $this->systemExceptionModel->raise([
                    'event' => 'payment.refund_invalid_state_regression',
                    'entity_type' => 'Refund',
                    'entity_id' => $refundId,
                    'reason' => 'Invalid refund state regression rejected: Processing cannot regress to Pending',
                    'severity' => 'warning',
                    'context' => [
                        'event_id' => $eventId,
                        'refund_id' => $refundId,
                        'current_status' => $currentStatus,
                        'attempted_status' => $targetStatus,
                    ],
                ]);

                $upd = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = 'invalid_state_regression' WHERE event_id = ?");
                $upd->execute([$eventId]);

                return [
                    'success' => true,
                    'status' => 'ignored',
                    'message' => 'Invalid state regression: Processing cannot regress to Pending',
                    'refund_id' => $refundId,
                    'current_status' => $currentStatus,
                    'code' => 200,
                ];
            }

            // Rule 5: Valid transition (Pending->Processing, Pending->Succeeded, Pending->Failed, Processing->Succeeded, Processing->Failed)
            $processedAt = in_array($targetStatus, [Refund::STATUS_SUCCEEDED, Refund::STATUS_FAILED], true)
                ? date('Y-m-d H:i:s')
                : ($cmsRefund['processed_at'] ?? null);

            $notes = $cmsRefund['notes'];
            if (!empty($incomingNotes)) {
                $notes = ($notes ? $notes . ' | ' : '') . 'Webhook: ' . substr($incomingNotes, 0, 200);
            }

            $this->refundModel->updateStatus($refundId, $targetStatus, $gatewayRefundId, $processedAt, $notes);

            // Audit logging
            $this->auditLogModel->log(
                'Payment refund status synchronized',
                null,
                null,
                'Refund',
                $refundId,
                [
                    'old_status' => $currentStatus,
                    'new_status' => $targetStatus,
                    'refund_id' => $refundId,
                    'payment_id' => (int) $cmsRefund['payment_id'],
                    'gateway_refund_id' => $gatewayRefundId,
                    'event_id' => $eventId,
                    'is_fallback_event_id' => $isFallbackEventId,
                    'amount' => (float) Refund::toPesos($amountCents),
                    'currency' => $currency,
                    'source' => 'paymongo_refund_webhook',
                ]
            );

            // Notification for requesting user if set
            if (!empty($cmsRefund['requested_by'])) {
                $this->notificationModel->create([
                    'title' => 'Refund Status Updated',
                    'message' => sprintf(
                        'Refund #%d of PHP %s for receipt %s has been updated to %s via PayMongo.',
                        $refundId,
                        Refund::toPesos($amountCents),
                        $cmsRefund['receipt_number'] ?? '',
                        $targetStatus
                    ),
                    'notification_type' => 'Payment',
                    'user_id' => (int) $cmsRefund['requested_by'],
                    'is_read' => 0,
                ]);
            }

            $upd = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = 'synchronized' WHERE event_id = ?");
            $upd->execute([$eventId]);

            return [
                'success' => true,
                'status' => 'synchronized',
                'refund_id' => $refundId,
                'old_status' => $currentStatus,
                'new_status' => $targetStatus,
                'gateway_refund_id' => $gatewayRefundId,
                'event_id' => $eventId,
                'is_fallback_event_id' => $isFallbackEventId,
                'code' => 200,
            ];
        });

        if (!is_array($syncResult)) {
            return ['error' => 'Database transaction failed during refund synchronization', 'code' => 500];
        }

        return $syncResult;
    }
}

