<?php
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/Refund.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/SystemException.php';
require_once __DIR__ . '/../controllers/PaymentController.php';
require_once __DIR__ . '/EnvironmentService.php';
require_once __DIR__ . '/PayMongoService.php';

/**
 * ReconciliationService
 *
 * Batch 8: Server-authoritative, two-step interactive reconciliation
 * and safe recovery foundation for PayMongo payments and refunds.
 *
 * Enforces:
 * - Read-only check workflows producing structured evidence snapshots
 * - Independent server-to-server gateway queries during apply (never trusts browser evidence)
 * - Exact integer-centavo comparison via Refund::toCentavos()
 * - PHP-only currency and CMS payment currency validation
 * - Environment livemode validation against server configuration
 * - DB row-locking (FOR UPDATE) and atomic status transitions
 * - Terminal state protection (no regressions from Verified or Succeeded)
 * - Zero heuristic auto-matching for refunds with NULL gateway_refund_id
 */
class ReconciliationService {
    private $paymentModel;
    private $refundModel;
    private $payMongoService;
    private $auditLogModel;
    private $notificationModel;
    private $systemExceptionModel;
    private $paymentController;

    public function __construct(
        ?Payment $paymentModel = null,
        ?Refund $refundModel = null,
        ?PayMongoService $payMongoService = null,
        ?AuditLog $auditLogModel = null,
        ?Notification $notificationModel = null,
        ?SystemException $systemExceptionModel = null,
        ?PaymentController $paymentController = null
    ) {
        $this->paymentModel = $paymentModel ?: new Payment();
        $this->refundModel = $refundModel ?: new Refund();
        $this->payMongoService = $payMongoService ?: new PayMongoService();
        $this->auditLogModel = $auditLogModel ?: new AuditLog();
        $this->notificationModel = $notificationModel ?: new Notification();
        $this->systemExceptionModel = $systemExceptionModel ?: new SystemException();
        $this->paymentController = $paymentController ?: new PaymentController();
    }

    /**
     * Step 1: Read-only payment reconciliation check.
     *
     * Queries PayMongo server-side by gateway_checkout_session_id and
     * constructs a structured evidence snapshot comparing CMS and Gateway fields.
     *
     * @param int $paymentId CMS internal payment ID
     * @return array Normalized evidence payload
     */
    public function checkPayment(int $paymentId): array {
        $payment = $this->paymentModel->findById($paymentId);
        if (!$payment) {
            return ['eligible' => false, 'error' => 'Payment not found', 'code' => 404];
        }

        $csId = trim((string) ($payment['gateway_checkout_session_id'] ?? ''));
        if ($csId === '') {
            return [
                'eligible' => false,
                'error' => 'Payment has no associated PayMongo checkout session ID',
                'cms' => [
                    'payment_id' => (int) $payment['payment_id'],
                    'verification_status' => $payment['verification_status'],
                ],
                'code' => 400,
            ];
        }

        // Query PayMongo API server-side
        $gwRes = $this->payMongoService->getCheckoutSession($csId);
        if (!($gwRes['success'] ?? false)) {
            return [
                'eligible' => false,
                'error' => 'Failed to retrieve PayMongo checkout session: ' . ($gwRes['error'] ?? 'Unknown gateway error'),
                'cms' => [
                    'payment_id' => (int) $payment['payment_id'],
                    'checkout_session_id' => $csId,
                    'verification_status' => $payment['verification_status'],
                ],
                'gateway' => null,
                'mismatches' => ['Gateway query failed: ' . ($gwRes['error'] ?? 'Connection error')],
                'code' => 502,
            ];
        }

        $csData = $gwRes['data'] ?? [];
        $csAttrs = $csData['attributes'] ?? [];
        $csStatus = strtolower((string) ($csAttrs['status'] ?? ''));
        $gwLivemode = !empty($csData['livemode'] ?? ($csAttrs['livemode'] ?? false));

        // Locate successful payment inside checkout session
        $paymentsList = $csAttrs['payments'] ?? [];
        $selectedPayment = null;
        if (!empty($paymentsList) && is_array($paymentsList)) {
            foreach ($paymentsList as $p) {
                $pStatus = strtolower((string) ($p['attributes']['status'] ?? ''));
                if ($pStatus === 'paid' || $pStatus === 'succeeded') {
                    $selectedPayment = $p;
                    break;
                }
            }
            if ($selectedPayment === null) {
                $selectedPayment = $paymentsList[0] ?? null;
            }
        }

        $gwPaymentId = $selectedPayment['id'] ?? null;
        $gwPaymentStatus = strtolower((string) ($selectedPayment['attributes']['status'] ?? $csStatus));

        // Amount extraction
        $gwAmountCents = null;
        if (isset($selectedPayment['attributes']['amount'])) {
            $gwAmountCents = (int) $selectedPayment['attributes']['amount'];
        } elseif (isset($csAttrs['amount'])) {
            $gwAmountCents = (int) $csAttrs['amount'];
        }

        // Currency extraction
        $gwCurrency = null;
        if (isset($selectedPayment['attributes']['currency'])) {
            $gwCurrency = strtoupper((string) $selectedPayment['attributes']['currency']);
        } elseif (isset($csAttrs['currency'])) {
            $gwCurrency = strtoupper((string) $csAttrs['currency']);
        }
        if ($gwCurrency === null) {
            $gwCurrency = 'PHP';
        }

        $cmsAmountCents = Refund::toCentavos($payment['amount']);
        $cmsCurrency = strtoupper((string) ($payment['currency'] ?? 'PHP'));
        $isAlreadyVerified = ($payment['verification_status'] === 'Verified');

        // Validation & Mismatch Evaluation
        $mismatches = [];

        $isPaid = ($csStatus === 'paid' || in_array($gwPaymentStatus, ['paid', 'succeeded'], true));
        if (!$isPaid) {
            $mismatches[] = sprintf('Gateway status is %s (paid or succeeded required)', $gwPaymentStatus ?: $csStatus);
        }

        if (empty($gwPaymentId) || strpos((string) $gwPaymentId, 'pay_') !== 0) {
            $mismatches[] = 'Missing authentic PayMongo payment resource ID (pay_...) in session';
        }

        if ($gwAmountCents === null || $gwAmountCents !== $cmsAmountCents) {
            $mismatches[] = sprintf('Amount mismatch: gateway has %s centavos, CMS expects %d centavos', var_export($gwAmountCents, true), $cmsAmountCents);
        }

        if ($gwCurrency !== 'PHP') {
            $mismatches[] = sprintf('Gateway currency is %s (PHP required)', $gwCurrency);
        }

        if ($gwCurrency !== $cmsCurrency) {
            $mismatches[] = sprintf('Currency mismatch: gateway is %s, CMS expects %s', $gwCurrency, $cmsCurrency);
        }

        // Livemode check
        $cmsMode = $this->payMongoService->getMode();
        if ($cmsMode === 'unconfigured') {
            $env = strtolower(trim((string) EnvironmentService::get('PAYMONGO_ENV', '')));
            $cmsMode = ($env === 'live' || $env === 'production') ? 'live' : 'test';
        }
        $expectedLivemode = ($cmsMode === 'live');
        if ($gwLivemode !== $expectedLivemode) {
            $mismatches[] = sprintf('Livemode mismatch: gateway is %s, CMS is configured for %s mode', $gwLivemode ? 'live' : 'test', $cmsMode);
        }

        $eligible = empty($mismatches) && !$isAlreadyVerified;

        return [
            'eligible' => $eligible,
            'already_verified' => $isAlreadyVerified,
            'cms' => [
                'payment_id' => (int) $payment['payment_id'],
                'receipt_number' => $payment['receipt_number'] ?? null,
                'amount' => (float) $payment['amount'],
                'amount_centavos' => $cmsAmountCents,
                'currency' => $cmsCurrency,
                'verification_status' => $payment['verification_status'],
                'gateway_checkout_session_id' => $payment['gateway_checkout_session_id'] ?? null,
                'gateway_payment_id' => $payment['gateway_payment_id'] ?? null,
                'gateway_status' => $payment['gateway_status'] ?? null,
            ],
            'gateway' => [
                'checkout_session_id' => $csId,
                'payment_id' => $gwPaymentId,
                'status' => $gwPaymentStatus ?: $csStatus,
                'amount_centavos' => $gwAmountCents,
                'currency' => $gwCurrency,
                'livemode' => $gwLivemode,
            ],
            'mismatches' => $mismatches,
            'code' => 200,
        ];
    }

    /**
     * Step 2: State-changing payment reconciliation apply.
     *
     * Independently re-queries PayMongo, re-validates all rules under a DB row lock,
     * updates the payment to Verified, persists gateway_payment_id, commits,
     * triggers post-commit automations, and records an AuditLog.
     *
     * @param int   $paymentId CMS internal payment ID
     * @param array $adminUser Authenticated administrator identity
     * @return array Operation result
     */
    public function applyPayment(int $paymentId, array $adminUser): array {
        $userRole = strtolower(trim((string) ($adminUser['role'] ?? '')));
        if ($userRole !== 'admin') {
            return ['error' => 'Unauthorized: Only Administrators can apply payment reconciliation', 'code' => 403];
        }

        $adminId = (int) ($adminUser['user_id'] ?? 1);
        $adminUsername = $adminUser['username'] ?? 'admin';
        $shouldTriggerAutomation = false;
        $paymentForAutomation = null;

        $transactionResult = Database::getInstance()->transaction(function () use (
            $paymentId,
            $adminId,
            $adminUsername,
            &$shouldTriggerAutomation,
            &$paymentForAutomation
        ) {
            $db = Database::getInstance()->getConnection();

            // Row-level lock on payment record
            $stmt = $db->prepare("SELECT * FROM payments WHERE payment_id = ? FOR UPDATE");
            $stmt->execute([$paymentId]);
            $payment = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$payment) {
                return ['error' => 'Payment not found', 'code' => 404];
            }

            // If already verified (e.g. concurrent webhook won the race), return safe no-op
            if ($payment['verification_status'] === 'Verified') {
                return [
                    'success' => true,
                    'status' => 'already_reconciled',
                    'message' => 'Payment was already verified',
                    'payment_id' => $paymentId,
                    'code' => 200,
                ];
            }

            if ($payment['verification_status'] !== 'Pending') {
                return [
                    'success' => false,
                    'error' => 'Cannot reconcile payment with verification status ' . $payment['verification_status'],
                    'code' => 400,
                ];
            }

            $csId = trim((string) ($payment['gateway_checkout_session_id'] ?? ''));
            if ($csId === '') {
                return [
                    'success' => false,
                    'error' => 'Payment has no associated PayMongo checkout session ID',
                    'code' => 400,
                ];
            }

            // Fresh server-side validation (NEVER trust client evidence)
            $checkEvidence = $this->checkPayment($paymentId);
            if (!($checkEvidence['eligible'] ?? false)) {
                $this->systemExceptionModel->raise([
                    'event' => 'payment.reconciliation_rejected',
                    'entity_type' => 'Payment',
                    'entity_id' => $paymentId,
                    'reason' => 'Payment reconciliation rejected: ' . implode('; ', $checkEvidence['mismatches'] ?? ['Ineligible evidence']),
                    'severity' => 'warning',
                    'context' => [
                        'payment_id' => $paymentId,
                        'checkout_session_id' => $csId,
                        'mismatches' => $checkEvidence['mismatches'] ?? [],
                        'admin_id' => $adminId,
                    ],
                ]);

                return [
                    'success' => false,
                    'error' => 'Reconciliation validation failed: ' . implode('; ', $checkEvidence['mismatches'] ?? ['Ineligible']),
                    'mismatches' => $checkEvidence['mismatches'] ?? [],
                    'code' => 422,
                ];
            }

            $gwPaymentId = $checkEvidence['gateway']['payment_id'] ?? null;
            $gwStatus = $checkEvidence['gateway']['status'] ?? 'paid';

            // Atomic conditional update: only transitions if still Pending
            $verifiedAt = date('Y-m-d H:i:s');
            $claimed = $this->paymentModel->verifyIfPending($paymentId, 'Verified', $adminId, $verifiedAt);

            if (!$claimed) {
                return [
                    'success' => true,
                    'status' => 'already_reconciled',
                    'message' => 'Payment was already verified by concurrent process',
                    'payment_id' => $paymentId,
                    'code' => 200,
                ];
            }

            // Persist authentic gateway payment ID and status
            if (!empty($gwPaymentId)) {
                $this->paymentModel->setGatewayPaymentId($paymentId, $gwPaymentId, $gwStatus);
            } else {
                $upd = $db->prepare("UPDATE payments SET gateway_status = ? WHERE payment_id = ?");
                $upd->execute([$gwStatus, $paymentId]);
            }

            $shouldTriggerAutomation = true;
            $paymentForAutomation = $payment;

            // AuditLog
            $this->auditLogModel->log(
                'reconcile_payment',
                $adminId,
                $adminUsername,
                'Payment',
                $paymentId,
                [
                    'reconciliation_type' => 'payment',
                    'payment_id' => $paymentId,
                    'status' => 'Verified',
                    'previous_status' => 'Pending',
                    'receipt_number' => $payment['receipt_number'] ?? null,
                    'source' => 'reconciliation_apply',
                    'checkout_session_id' => $csId,
                    'gateway_payment_id' => $gwPaymentId,
                    'gateway_status' => $gwStatus,
                    'amount_centavos' => $checkEvidence['cms']['amount_centavos'] ?? null,
                    'currency' => $checkEvidence['cms']['currency'] ?? 'PHP',
                    'livemode' => $checkEvidence['gateway']['livemode'] ?? false,
                    'operator_admin_id' => $adminId,
                    'evidence_validation_result' => 'eligible',
                    'timestamp' => date('Y-m-d H:i:s'),
                ]
            );

            // Notification for admin
            $this->notificationModel->create([
                'title' => 'Payment Reconciled',
                'message' => sprintf('Payment #%d (Receipt: %s) was successfully reconciled and verified.', $paymentId, $payment['receipt_number'] ?? ''),
                'notification_type' => 'Payment',
                'user_id' => $adminId,
                'is_read' => 0,
            ]);

            return [
                'success' => true,
                'status' => 'reconciled',
                'verification_status' => 'Verified',
                'message' => 'Payment successfully reconciled and verified',
                'payment_id' => $paymentId,
                'gateway_payment_id' => $gwPaymentId,
                'code' => 200,
            ];
        });

        // Trigger post-commit automation exactly once outside transaction
        if ($shouldTriggerAutomation && !empty($paymentForAutomation)) {
            $this->paymentController->triggerPostVerificationAutomation($paymentForAutomation, $adminId);
        }

        return $transactionResult;
    }

    /**
     * Step 1: Read-only refund reconciliation check.
     *
     * Inspects CMS refund record. If gateway_refund_id exists, queries PayMongo
     * and evaluates state transition eligibility. If gateway_refund_id is NULL,
     * strictly marks the record as requiring manual investigation.
     *
     * @param int $refundId CMS internal refund ID
     * @return array Normalized evidence payload
     */
    public function checkRefund(int $refundId): array {
        $refund = $this->refundModel->findById($refundId);
        if (!$refund) {
            return ['eligible' => false, 'error' => 'Refund not found', 'code' => 404];
        }

        $payment = $this->paymentModel->findById((int) $refund['payment_id']);
        $expectedGwPaymentId = $payment['gateway_payment_id'] ?? null;
        $cmsAmountCents = Refund::toCentavos($refund['amount']);
        $cmsCurrency = strtoupper((string) ($refund['currency'] ?? 'PHP'));

        $gwRefundId = trim((string) ($refund['gateway_refund_id'] ?? ''));

        // High-risk case: Missing gateway refund ID
        if ($gwRefundId === '') {
            return [
                'eligible' => false,
                'requires_manual_investigation' => true,
                'cms' => [
                    'refund_id' => (int) $refund['refund_id'],
                    'payment_id' => (int) $refund['payment_id'],
                    'gateway_payment_id' => $expectedGwPaymentId,
                    'gateway_refund_id' => null,
                    'amount_centavos' => $cmsAmountCents,
                    'currency' => $cmsCurrency,
                    'status' => $refund['status'],
                    'idempotency_key' => $refund['idempotency_key'] ?? null,
                ],
                'gateway' => null,
                'mismatches' => [
                    'No gateway refund ID exists on CMS refund record. Heuristic matching by amount and timestamp is strictly prohibited; manual investigation in PayMongo dashboard is required.'
                ],
                'code' => 200,
            ];
        }

        // Query PayMongo for refund resource
        $gwRes = $this->payMongoService->getRefund($gwRefundId);
        if (!($gwRes['success'] ?? false)) {
            return [
                'eligible' => false,
                'error' => 'Failed to retrieve PayMongo refund: ' . ($gwRes['error'] ?? 'Unknown gateway error'),
                'cms' => [
                    'refund_id' => (int) $refund['refund_id'],
                    'gateway_refund_id' => $gwRefundId,
                    'status' => $refund['status'],
                ],
                'gateway' => null,
                'mismatches' => ['Gateway query failed: ' . ($gwRes['error'] ?? 'Connection error')],
                'code' => 502,
            ];
        }

        $rfData = $gwRes['data'] ?? [];
        $rfAttrs = $rfData['attributes'] ?? [];
        $actualRefundId = $rfData['id'] ?? null;
        $gwPaymentId = $rfAttrs['payment_id'] ?? null;
        $gwStatus = strtolower((string) ($rfAttrs['status'] ?? ''));
        $gwAmountCents = (int) ($rfAttrs['amount'] ?? 0);
        $gwCurrency = strtoupper((string) ($rfAttrs['currency'] ?? 'PHP'));
        $gwLivemode = !empty($rfData['livemode'] ?? ($rfAttrs['livemode'] ?? false));

        $statusMap = [
            'succeeded' => Refund::STATUS_SUCCEEDED,
            'failed' => Refund::STATUS_FAILED,
            'processing' => Refund::STATUS_PROCESSING,
            'pending' => Refund::STATUS_PENDING,
        ];
        $targetStatus = $statusMap[$gwStatus] ?? null;

        $mismatches = [];

        if ($actualRefundId !== $gwRefundId) {
            $mismatches[] = sprintf('Refund ID mismatch: gateway returned %s, expected %s', $actualRefundId, $gwRefundId);
        }

        if (!empty($expectedGwPaymentId) && !empty($gwPaymentId) && $gwPaymentId !== $expectedGwPaymentId) {
            $mismatches[] = sprintf('Payment ID mismatch: gateway refund belongs to %s, CMS payment is %s', $gwPaymentId, $expectedGwPaymentId);
        }

        if ($gwAmountCents !== $cmsAmountCents) {
            $mismatches[] = sprintf('Amount mismatch: gateway refund amount is %d cents, CMS refund is %d cents', $gwAmountCents, $cmsAmountCents);
        }

        if ($gwCurrency !== 'PHP') {
            $mismatches[] = sprintf('Gateway currency is %s (PHP required)', $gwCurrency);
        }

        if ($gwCurrency !== $cmsCurrency) {
            $mismatches[] = sprintf('Currency mismatch: gateway refund is %s, CMS refund is %s', $gwCurrency, $cmsCurrency);
        }

        // Livemode check
        $cmsMode = $this->payMongoService->getMode();
        if ($cmsMode === 'unconfigured') {
            $env = strtolower(trim((string) EnvironmentService::get('PAYMONGO_ENV', '')));
            $cmsMode = ($env === 'live' || $env === 'production') ? 'live' : 'test';
        }
        $expectedLivemode = ($cmsMode === 'live');
        if ($gwLivemode !== $expectedLivemode) {
            $mismatches[] = sprintf('Livemode mismatch: gateway is %s, CMS is configured for %s mode', $gwLivemode ? 'live' : 'test', $cmsMode);
        }

        // Terminal state protection check
        $currentStatus = $refund['status'];
        if ($currentStatus === Refund::STATUS_SUCCEEDED) {
            $mismatches[] = 'Current status Succeeded is terminal and cannot be modified';
        } elseif ($currentStatus === Refund::STATUS_FAILED) {
            $mismatches[] = 'Current status Failed is terminal and cannot be modified';
        } elseif ($currentStatus === $targetStatus) {
            $mismatches[] = 'Refund is already in target status ' . $targetStatus;
        }

        $eligible = empty($mismatches) && ($targetStatus !== null);

        return [
            'eligible' => $eligible,
            'target_status' => $targetStatus,
            'cms' => [
                'refund_id' => (int) $refund['refund_id'],
                'payment_id' => (int) $refund['payment_id'],
                'gateway_refund_id' => $gwRefundId,
                'amount_centavos' => $cmsAmountCents,
                'currency' => $cmsCurrency,
                'status' => $currentStatus,
            ],
            'gateway' => [
                'refund_id' => $actualRefundId,
                'payment_id' => $gwPaymentId,
                'status' => $gwStatus,
                'target_cms_status' => $targetStatus,
                'amount_centavos' => $gwAmountCents,
                'currency' => $gwCurrency,
                'livemode' => $gwLivemode,
            ],
            'mismatches' => $mismatches,
            'code' => 200,
        ];
    }

    /**
     * Step 2: State-changing refund reconciliation apply.
     *
     * Independently re-queries PayMongo, acquires row lock, enforces terminal-state
     * protections, updates refund status, and logs audit record.
     *
     * @param int   $refundId  CMS internal refund ID
     * @param array $adminUser Authenticated administrator identity
     * @return array Operation result
     */
    public function applyRefund(int $refundId, array $adminUser): array {
        $userRole = strtolower(trim((string) ($adminUser['role'] ?? '')));
        if ($userRole !== 'admin') {
            return ['error' => 'Unauthorized: Only Administrators can apply refund reconciliation', 'code' => 403];
        }

        $adminId = (int) ($adminUser['user_id'] ?? 1);
        $adminUsername = $adminUser['username'] ?? 'admin';

        return Database::getInstance()->transaction(function () use ($refundId, $adminId, $adminUsername) {
            $db = Database::getInstance()->getConnection();

            // Lock refund row
            $stmt = $db->prepare("SELECT * FROM refunds WHERE refund_id = ? FOR UPDATE");
            $stmt->execute([$refundId]);
            $refund = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$refund) {
                return ['error' => 'Refund not found', 'code' => 404];
            }

            // Terminal state protection: if already Succeeded or Failed, cannot transition
            $currentStatus = $refund['status'];
            if ($currentStatus === Refund::STATUS_SUCCEEDED || $currentStatus === Refund::STATUS_FAILED) {
                return [
                    'success' => true,
                    'status' => 'already_reconciled',
                    'message' => 'Refund is already in terminal status ' . $currentStatus . '; no state change needed',
                    'refund_id' => $refundId,
                    'target_status' => $currentStatus,
                    'code' => 200,
                ];
            }

            // Fresh check (never trust browser evidence)
            $checkEvidence = $this->checkRefund($refundId);
            if (!($checkEvidence['eligible'] ?? false)) {
                $this->systemExceptionModel->raise([
                    'event' => 'payment.refund_reconciliation_rejected',
                    'entity_type' => 'Refund',
                    'entity_id' => $refundId,
                    'reason' => 'Refund reconciliation rejected: ' . implode('; ', $checkEvidence['mismatches'] ?? ['Ineligible evidence']),
                    'severity' => 'warning',
                    'context' => [
                        'refund_id' => $refundId,
                        'gateway_refund_id' => $refund['gateway_refund_id'] ?? null,
                        'mismatches' => $checkEvidence['mismatches'] ?? [],
                        'admin_id' => $adminId,
                    ],
                ]);

                return [
                    'success' => false,
                    'error' => 'Reconciliation validation failed: ' . implode('; ', $checkEvidence['mismatches'] ?? ['Ineligible']),
                    'mismatches' => $checkEvidence['mismatches'] ?? [],
                    'code' => 422,
                ];
            }

            $targetStatus = $checkEvidence['gateway']['target_cms_status'];
            $currentStatus = $refund['status'];

            // Terminal state protection
            if ($currentStatus === Refund::STATUS_SUCCEEDED || $currentStatus === Refund::STATUS_FAILED) {
                return [
                    'success' => false,
                    'error' => 'Invalid state transition: terminal state ' . $currentStatus . ' cannot be changed',
                    'code' => 400,
                ];
            }

            $gwRefundId = $checkEvidence['gateway']['refund_id'] ?? $refund['gateway_refund_id'];
            $processedAt = ($targetStatus === Refund::STATUS_SUCCEEDED || $targetStatus === Refund::STATUS_FAILED)
                ? date('Y-m-d H:i:s')
                : null;

            $notes = ($refund['notes'] ? $refund['notes'] . ' | ' : '') . 'Reconciled by Admin #' . $adminId;

            // Apply state change
            $this->refundModel->updateStatus($refundId, $targetStatus, $gwRefundId, $processedAt, $notes);

            // AuditLog
            $this->auditLogModel->log(
                'reconcile_refund',
                $adminId,
                $adminUsername,
                'Refund',
                $refundId,
                [
                    'reconciliation_type' => 'refund',
                    'refund_id' => $refundId,
                    'payment_id' => (int) $refund['payment_id'],
                    'previous_status' => $currentStatus,
                    'resulting_status' => $targetStatus,
                    'gateway_resource_id' => $gwRefundId,
                    'gateway_status' => $checkEvidence['gateway']['status'] ?? null,
                    'amount_centavos' => $checkEvidence['cms']['amount_centavos'] ?? null,
                    'currency' => $checkEvidence['cms']['currency'] ?? 'PHP',
                    'livemode' => $checkEvidence['gateway']['livemode'] ?? false,
                    'operator_admin_id' => $adminId,
                    'evidence_validation_result' => 'eligible',
                    'timestamp' => date('Y-m-d H:i:s'),
                ]
            );

            // Notification for admin
            $this->notificationModel->create([
                'title' => 'Refund Reconciled',
                'message' => sprintf('Refund #%d was successfully reconciled to status %s.', $refundId, $targetStatus),
                'notification_type' => 'Payment',
                'user_id' => $adminId,
                'is_read' => 0,
            ]);

            return [
                'success' => true,
                'status' => 'reconciled',
                'target_status' => $targetStatus,
                'refund_id' => $refundId,
                'gateway_refund_id' => $gwRefundId,
                'code' => 200,
            ];
        });
    }

    /**
     * Read-only query identifying stale gateway payments and refunds requiring attention.
     *
     * @param int $olderThanMinutes Threshold in minutes
     * @return array Normalized list of stale records
     */
    public function getStaleGatewayRecords(int $olderThanMinutes = 60): array {
        $stalePayments = $this->paymentModel->findStalePendingGatewayPayments($olderThanMinutes);
        $staleRefunds = $this->refundModel->findStalePendingGatewayRefunds($olderThanMinutes, true);

        return [
            'success' => true,
            'threshold_minutes' => $olderThanMinutes,
            'stale_payments' => $stalePayments,
            'stale_refunds' => $staleRefunds,
            'payments' => $stalePayments,
            'refunds' => $staleRefunds,
            'code' => 200,
        ];
    }
}
