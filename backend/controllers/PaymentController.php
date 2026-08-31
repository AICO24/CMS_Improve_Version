<?php
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/../models/Relocation.php';
require_once __DIR__ . '/../models/ExpirationRecord.php';
require_once __DIR__ . '/../services/AutomationEngine.php';
require_once __DIR__ . '/ScheduleController.php';
require_once __DIR__ . '/CremationController.php';

class PaymentController {
    private $paymentModel;
    private $auditLogModel;

    public function __construct() {
        $this->paymentModel = new Payment();
        $this->auditLogModel = new AuditLog();
    }

    public function index($filters = [], $pagination = []) {
        return $this->paginate($filters, $pagination);
    }

    public function mine($userId, $filters = [], $pagination = []) {
        $filters['received_by'] = $userId;
        return $this->paginate($filters, $pagination);
    }

    // Mirrors ScheduleController::mine()'s pagination pattern: page/per_page are
    // optional, so callers that don't pass them keep getting a plain array back.
    private function paginate($filters, $pagination) {
        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;

        if ($page === null && $perPage === null) {
            return $this->paymentModel->findAll($filters);
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $total = $this->paymentModel->countAll($filters);
        $data = $this->paymentModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);

        return [
            'data' => $data,
            'meta' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'pages' => (int) ceil($total / $perPage),
            ],
        ];
    }

    // Resolves the trusted "expected" amount for a payment from server-side data
    // only (never from anything the frontend claims the price is), so the amount
    // field can be checked/displayed without relying on a client-supplied price.
    // Only 'Lot Purchase' has a resolvable price today — Cremation/Relocation/
    // Renewal/Other have no linked price column anywhere in the schema, so those
    // simply resolve to null (handled as "not available" by callers).
    public function resolveExpectedAmount($transactionType, $referenceId) {
        $transactionType = $this->normalizeTransactionType($transactionType);
        $referenceId = $this->normalizeReferenceId($referenceId);

        if ($transactionType !== 'Lot Purchase' || $referenceId === null) {
            return ['expected_amount' => null];
        }

        $scheduleModel = new Schedule();
        $lotModel = new Lot();

        // reference_id for 'Lot Purchase' is, in practice, either a schedule_id
        // (the normal "reserve then pay" flow) or a raw lot_id (the Lot
        // Management "Pay Now" shortcut used before any schedule exists) — try
        // schedule first since that's the more common path, then fall back.
        $schedule = $scheduleModel->findById($referenceId);
        if ($schedule && !empty($schedule['lot_id'])) {
            $lot = $lotModel->findById($schedule['lot_id']);
            if ($lot && isset($lot['price'])) {
                return [
                    'expected_amount' => (float) $lot['price'],
                    'lot_number' => $lot['lot_number'] ?? null,
                    'source' => 'schedule',
                ];
            }
        }

        $lot = $lotModel->findById($referenceId);
        if ($lot && isset($lot['price'])) {
            return [
                'expected_amount' => (float) $lot['price'],
                'lot_number' => $lot['lot_number'] ?? null,
                'source' => 'lot',
            ];
        }

        return ['expected_amount' => null];
    }

    private function normalizeTransactionType($transactionType) {
        $value = strtolower(trim((string) $transactionType));
        $map = [
            'lot purchase' => 'Lot Purchase',
            'cremation' => 'Cremation',
            'relocation' => 'Relocation',
            'renewal' => 'Renewal',
            'other' => 'Other',
        ];

        return $map[$value] ?? null;
    }

    private function normalizeReferenceId($referenceId) {
        if ($referenceId === null || $referenceId === '') {
            return null;
        }

        if (!is_numeric($referenceId)) {
            return null;
        }

        return (int) $referenceId;
    }

    // Confirms reference_id actually points at a real, payable record before a
    // payment is accepted for it — mirrors resolveExpectedAmount()'s own
    // schedule-then-lot fallback for Lot Purchase, and adds the same kind of
    // existence/state check for the transaction types that had none before.
    private function validatePaymentReference($transactionType, $referenceId, $userId, $userRole) {
        $transactionType = $this->normalizeTransactionType($transactionType);
        if ($transactionType === null) {
            return ['error' => 'Invalid transaction type', 'code' => 400];
        }

        $referenceId = $this->normalizeReferenceId($referenceId);
        $roleName = strtolower(trim((string) $userRole));

        switch ($transactionType) {
            case 'Lot Purchase':
                if ($referenceId === null) {
                    return ['error' => 'Lot Purchase payments require a valid reservation or lot reference', 'code' => 400];
                }

                $scheduleModel = new Schedule();
                $lotModel = new Lot();
                $schedule = $scheduleModel->findById($referenceId);
                if ($schedule) {
                    if ($roleName === 'user' && (int) ($schedule['created_by'] ?? 0) !== (int) $userId) {
                        return ['error' => 'You may only pay for your own reservation', 'code' => 403];
                    }
                    if (($schedule['status'] ?? '') === 'Cancelled') {
                        return ['error' => 'Cancelled reservations cannot be paid', 'code' => 409];
                    }

                    $lot = $lotModel->findById($schedule['lot_id']);
                    if (!$lot) {
                        return ['error' => 'Reservation lot not found', 'code' => 404];
                    }

                    return [
                        'reference_id' => $referenceId,
                        'reference_label' => 'Reservation #' . $schedule['schedule_id'] . ' - Lot ' . ($schedule['lot_number'] ?? 'N/A'),
                    ];
                }

                if ($roleName === 'user') {
                    return ['error' => 'User payments must reference a valid reservation', 'code' => 403];
                }

                $lot = $lotModel->findById($referenceId);
                if (!$lot) {
                    return ['error' => 'Lot reference not found', 'code' => 404];
                }

                return [
                    'reference_id' => $referenceId,
                    'reference_label' => 'Lot ' . ($lot['lot_number'] ?? $referenceId),
                ];

            case 'Cremation':
                if ($referenceId === null) {
                    return ['error' => 'Cremation payments require a valid cremation reference', 'code' => 400];
                }

                $cremationModel = new Cremation();
                $cremation = $cremationModel->findById($referenceId);
                if (!$cremation) {
                    return ['error' => 'Cremation reference not found', 'code' => 404];
                }
                if (($cremation['status'] ?? '') === 'Cancelled') {
                    return ['error' => 'Cancelled cremation records cannot be paid', 'code' => 409];
                }

                return [
                    'reference_id' => $referenceId,
                    'reference_label' => 'Cremation #' . $cremation['cremation_id'],
                ];

            case 'Relocation':
                if ($referenceId === null) {
                    return ['error' => 'Relocation payments require a valid relocation reference', 'code' => 400];
                }

                $relocationModel = new Relocation();
                $relocation = $relocationModel->findById($referenceId);
                if (!$relocation) {
                    return ['error' => 'Relocation reference not found', 'code' => 404];
                }
                if (($relocation['status'] ?? '') === 'Denied') {
                    return ['error' => 'Denied relocation requests cannot be paid', 'code' => 409];
                }

                return [
                    'reference_id' => $referenceId,
                    'reference_label' => 'Relocation #' . $relocation['request_id'],
                ];

            case 'Renewal':
                if ($referenceId === null) {
                    return ['error' => 'Renewal payments require an expiration record reference', 'code' => 400];
                }

                $expirationModel = new ExpirationRecord();
                $expiration = $expirationModel->findById($referenceId);
                if (!$expiration) {
                    return ['error' => 'Expiration reference not found', 'code' => 404];
                }
                if (($expiration['renewed'] ?? 'no') === 'yes') {
                    return ['error' => 'This expiration record has already been renewed', 'code' => 409];
                }

                return [
                    'reference_id' => $referenceId,
                    'reference_label' => 'Expiration #' . $expiration['expiration_id'] . ' - Lot ' . ($expiration['lot_number'] ?? 'N/A'),
                ];

            case 'Other':
                return [
                    'reference_id' => $referenceId,
                    'reference_label' => $referenceId === null ? null : ('Reference #' . $referenceId),
                ];
        }

        return ['error' => 'Invalid transaction type', 'code' => 400];
    }

    public function show($id, $user = null) {
        $payment = $this->paymentModel->findById($id);
        if (!$payment) {
            return ['error' => 'Payment not found', 'code' => 404];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $userRole = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if (!in_array($userRole, ['admin', 'staff'], true) && (int) $payment['received_by'] !== (int) $userId) {
            return ['error' => 'You may only view your own payments', 'code' => 403];
        }

        return $payment;
    }

    public function store($data, $userId) {
        // receipt_number is intentionally NOT required here — Payment::create()
        // auto-generates one (RCPT-{year}-{payment_id}) when it's left blank, so
        // an omitted/empty value is valid input, not a validation error.
        $required = ['transaction_type', 'amount', 'payment_date', 'payment_method'];
        foreach ($required as $field) {
            if (empty($data[$field]) && $data[$field] !== '0') {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        if (!is_numeric($data['amount']) || (float) $data['amount'] <= 0) {
            return ['error' => 'Amount must be a positive number', 'code' => 400];
        }

        $transactionType = $this->normalizeTransactionType($data['transaction_type']);
        if ($transactionType === null) {
            return ['error' => 'Invalid transaction type', 'code' => 400];
        }

        $receiptNumber = trim((string) ($data['receipt_number'] ?? ''));
        if ($receiptNumber !== '' && $this->paymentModel->receiptNumberExists($receiptNumber)) {
            return ['error' => 'Receipt number already exists', 'code' => 409];
        }

        $userModel = new User();
        $userRole = strtolower((string) $userModel->getRole($userId));
        $referenceCheck = $this->validatePaymentReference($transactionType, $data['reference_id'] ?? null, $userId, $userRole);
        if (isset($referenceCheck['error'])) {
            return $referenceCheck;
        }

        $receiptFile = $data['receipt_file'] ?? null;
        if (empty($receiptFile) && !empty($data['files']['receipt_file'])) {
            $receiptFile = $data['files']['receipt_file'];
        }
        if (!empty($receiptFile) && is_array($receiptFile)) {
            $receiptUrl = $this->saveReceiptFile($receiptFile);
            if ($receiptUrl === false) {
                return ['error' => 'Failed to save receipt file', 'code' => 500];
            }
            $data['receipt_url'] = $receiptUrl;
        }

        $data['transaction_type'] = $transactionType;
        $data['reference_id'] = $referenceCheck['reference_id'];
        $data['received_by'] = $userId;
        $data['verification_status'] = 'Pending';
        $paymentId = $this->paymentModel->create($data);
        if ($paymentId) {
            $this->notifyPayment($data, $userId);

            // Non-blocking, informational only — the amount was already accepted
            // above; this just lets the frontend/caller know if it diverged from
            // the trusted server-side price so staff can double-check it later.
            $expected = $this->resolveExpectedAmount($data['transaction_type'], $data['reference_id'] ?? null);
            $saved = $this->paymentModel->findById($paymentId);

            return [
                'success' => true,
                'message' => 'Payment recorded and pending verification',
                'payment_id' => $paymentId,
                'receipt_number' => $saved['receipt_number'] ?? null,
                'reference_label' => $referenceCheck['reference_label'] ?? null,
                'expected_amount' => $expected['expected_amount'],
                'amount_mismatch' => $expected['expected_amount'] !== null
                    && abs((float) $data['amount'] - $expected['expected_amount']) > 0.001,
            ];
        }
        return ['error' => 'Failed to record payment', 'code' => 500];
    }

    public function update($id, $data, $user) {
        $existing = $this->paymentModel->findById($id);
        if (!$existing) {
            return ['error' => 'Payment not found', 'code' => 404];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $userRole = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        $isStaffOrAdmin = in_array($userRole, ['admin', 'staff'], true);

        // Once a payment has been verified/rejected it's part of the audit trail —
        // nobody, including staff/admin, edits it after the fact anymore (mirrors
        // destroy()'s new "Verified payments cannot be deleted" guard below).
        if (($existing['verification_status'] ?? 'Pending') !== 'Pending') {
            return ['error' => 'Only pending payments may be updated', 'code' => 403];
        }

        if (!$isStaffOrAdmin) {
            if ((int) $existing['received_by'] !== (int) $userId) {
                return ['error' => 'You may only update your own payments', 'code' => 403];
            }
        }

        if (isset($data['amount']) && (!is_numeric($data['amount']) || (float) $data['amount'] <= 0)) {
            return ['error' => 'Amount must be a positive number', 'code' => 400];
        }

        $transactionType = $this->normalizeTransactionType($data['transaction_type'] ?? $existing['transaction_type']);
        if ($transactionType === null) {
            return ['error' => 'Invalid transaction type', 'code' => 400];
        }

        $referenceCheck = $this->validatePaymentReference(
            $transactionType,
            $data['reference_id'] ?? $existing['reference_id'],
            $userId,
            $userRole
        );
        if (isset($referenceCheck['error'])) {
            return $referenceCheck;
        }

        $receiptFile = $data['receipt_file'] ?? null;
        if (empty($receiptFile) && !empty($data['files']['receipt_file'])) {
            $receiptFile = $data['files']['receipt_file'];
        }
        if (!empty($receiptFile) && is_array($receiptFile)) {
            $receiptUrl = $this->saveReceiptFile($receiptFile);
            if ($receiptUrl === false) {
                return ['error' => 'Failed to save receipt file', 'code' => 500];
            }
            $data['receipt_url'] = $receiptUrl;
        }

        if (isset($data['verification_status'])) {
            return ['error' => 'Only administrators may change payment verification status via admin approval', 'code' => 403];
        }

        $receiptNumber = trim((string) ($data['receipt_number'] ?? ''));
        if ($receiptNumber === '') {
            $receiptNumber = (string) ($existing['receipt_number'] ?? '');
        } elseif ($receiptNumber !== (string) ($existing['receipt_number'] ?? '') && $this->paymentModel->receiptNumberExists($receiptNumber)) {
            return ['error' => 'Receipt number already exists', 'code' => 409];
        }

        // Preserve who the payment belongs to unless a staff/admin explicitly reassigns it;
        // previously this always overwrote received_by with the editor's own id.
        $data['received_by'] = isset($data['received_by']) ? $data['received_by'] : $existing['received_by'];
        $updatePayload = [
            'transaction_type' => $transactionType,
            'reference_id' => $referenceCheck['reference_id'],
            'amount' => $data['amount'] ?? $existing['amount'],
            'payment_date' => $data['payment_date'] ?? $existing['payment_date'],
            'payment_method' => $data['payment_method'] ?? $existing['payment_method'],
            'receipt_number' => $receiptNumber,
            'notes' => array_key_exists('notes', $data) ? $data['notes'] : $existing['notes'],
            'received_by' => $data['received_by'],
            'receipt_url' => $data['receipt_url'] ?? $existing['receipt_url'],
            'verification_status' => $existing['verification_status'],
            'verified_by' => $existing['verified_by'] ?? null,
            'verified_at' => $existing['verified_at'] ?? null,
        ];
        $result = $this->paymentModel->update($id, $updatePayload);

        if (!$result) {
            return ['error' => 'Failed to update payment', 'code' => 500];
        }

        // Same AuditLog mechanism/shape already used by verify() below — records
        // which fields actually changed, not a full before/after dump.
        $changedFields = [];
        foreach (['transaction_type', 'reference_id', 'amount', 'payment_date', 'payment_method', 'receipt_number', 'notes'] as $field) {
            if (isset($updatePayload[$field]) && (string) $updatePayload[$field] !== (string) ($existing[$field] ?? '')) {
                $changedFields[$field] = ['from' => $existing[$field] ?? null, 'to' => $updatePayload[$field]];
            }
        }
        $this->auditLogModel->log(
            'Payment updated',
            $userId,
            null,
            'Payment',
            $id,
            ['receipt_number' => $existing['receipt_number'] ?? null, 'changed' => $changedFields]
        );

        $expected = $this->resolveExpectedAmount($updatePayload['transaction_type'], $updatePayload['reference_id']);
        $submittedAmount = (float) $updatePayload['amount'];

        return [
            'success' => true,
            'message' => 'Payment updated',
            'reference_label' => $referenceCheck['reference_label'] ?? null,
            'expected_amount' => $expected['expected_amount'],
            'amount_mismatch' => $expected['expected_amount'] !== null
                && abs($submittedAmount - $expected['expected_amount']) > 0.001,
        ];
    }

    public function verify($id, $status, $adminId) {
        $payment = $this->paymentModel->findById($id);
        if (!$payment) {
            return ['error' => 'Payment not found', 'code' => 404];
        }

        if (!in_array($status, ['Verified', 'Rejected'], true)) {
            return ['error' => 'Invalid verification status', 'code' => 400];
        }

        // Batch L2.4: everything that must land atomically (the claim itself,
        // the audit log, the notification DB row, and — for a verified Lot
        // Purchase/Cremation payment — the downstream lot/schedule/cremation
        // automation) runs inside one transaction. $pendingEmail is filled in
        // here but the actual mail() call happens only after a successful
        // commit (below), so a rollback can never be followed by an email
        // describing something that didn't actually happen.
        $pendingEmail = null;

        $claimed = Database::getInstance()->transaction(function () use ($id, $status, $adminId, $payment, &$pendingEmail) {
            // Atomic idempotency guard: this conditional UPDATE (WHERE
            // verification_status = 'Pending') is what actually decides
            // "am I the request that gets to process this payment?" — a
            // plain read-then-branch here (the old approach) is not safe
            // under two truly simultaneous verify() calls, since both could
            // read 'Pending' before either writes. A rowCount() of 0 means
            // someone else (or an earlier retry of this same request)
            // already claimed it; nothing below this point may run.
            $verifiedAt = date('Y-m-d H:i:s');
            $claimed = $this->paymentModel->verifyIfPending($id, $status, $adminId, $verifiedAt);
            if (!$claimed) {
                return false;
            }

            $this->auditLogModel->log(
                'Payment ' . ($status === 'Verified' ? 'verified' : 'rejected'),
                $adminId,
                null,
                'Payment',
                $id,
                ['status' => $status, 'receipt_number' => $payment['receipt_number']]
            );

            $notificationModel = new Notification();
            $notificationModel->create([
                'title' => 'Payment ' . ($status === 'Verified' ? 'Approved' : 'Rejected'),
                'message' => sprintf('Payment %s for receipt %s has been %s.', $payment['receipt_number'], $payment['receipt_number'], strtolower($status)),
                'notification_type' => 'Payment',
                'is_read' => 0,
            ]);

            $userModel = new User();
            $user = $userModel->findById($payment['received_by']);
            if (!empty($user['email'])) {
                $pendingEmail = [
                    'to' => $user['email'],
                    'subject' => 'Payment ' . $status,
                    'message' => 'Your payment has been ' . strtolower($status) . '.',
                ];
            }

            if ($status === 'Verified' && $payment['transaction_type'] === 'Lot Purchase') {
                $this->syncLotStatusForVerifiedPurchase($payment, $adminId);
                $this->autoConfirmScheduleForVerifiedPurchase($payment, $adminId);
            } elseif ($status === 'Verified' && $payment['transaction_type'] === 'Cremation') {
                $this->autoUpdateCremationForVerifiedPayment($payment, $adminId);
            }

            return true;
        });

        if (!$claimed) {
            return ['error' => 'This payment has already been reviewed', 'code' => 409];
        }

        if ($pendingEmail !== null) {
            $this->sendEmail($pendingEmail['to'], $pendingEmail['subject'], $pendingEmail['message']);
        }

        return ['success' => true, 'message' => 'Payment ' . strtolower($status) . ' successfully'];
    }

    // A verified Lot Purchase payment means the lot has been bought, so it should
    // no longer read as Available — mirrors ScheduleController's own
    // Confirmed -> Reserved transition rather than jumping straight to Occupied,
    // since a payment alone doesn't mean the burial itself has taken place yet.
    // Resolves the lot the same way resolveExpectedAmount() does: reference_id is
    // in practice either a schedule_id (normal reserve-then-pay flow) or a raw
    // lot_id (the Lot Management "Pay Now" shortcut). Never downgrades a lot
    // that's already past Available (Reserved/Occupied/Expired left untouched).
    private function syncLotStatusForVerifiedPurchase($payment, $adminId) {
        if (empty($payment['reference_id'])) {
            return;
        }

        $scheduleModel = new Schedule();
        $lotModel = new Lot();

        $lotId = null;
        $schedule = $scheduleModel->findById($payment['reference_id']);
        if ($schedule && !empty($schedule['lot_id'])) {
            $lotId = $schedule['lot_id'];
        } else {
            $lot = $lotModel->findById($payment['reference_id']);
            if ($lot) {
                $lotId = $lot['lot_id'];
            }
        }

        if (!$lotId) {
            return;
        }

        $lot = $lotModel->findById($lotId);
        if (!$lot || $lot['status'] !== 'Available') {
            // Not an error — this is the pre-existing "never downgrade a lot
            // that's already past Available" rule, not a failure needing
            // admin review. Nothing to automate here, so AutomationEngine
            // (below) is intentionally not invoked for this common case —
            // mirrors autoConfirmScheduleForVerifiedPurchase()'s own early
            // no-op returns for its terminal-state cases.
            return;
        }

        // Batch C (Admin-Wide Automation Audit): same AutomationEngine
        // validate/apply/audit/exception envelope already used by
        // autoConfirmScheduleForVerifiedPurchase() below, now applied to this
        // method's own lot write too — previously a bare, unaudited
        // $lotModel->update() call. validate() re-checks freshness right
        // before writing (same convention as that method) so a lot that
        // changed status in the moment between the check above and here
        // raises a reviewable exception instead of silently overwriting it.
        $adminActor = ['user_id' => $adminId, 'role' => 'admin'];
        AutomationEngine::run(
            'payment.verified',
            'Lot',
            $lotId,
            $adminActor,
            function () use ($lotModel, $lotId) {
                $current = $lotModel->findById($lotId);
                if (!$current) {
                    return ['Linked lot no longer exists'];
                }
                if ($current['status'] !== 'Available') {
                    return ['Lot ' . ($current['lot_number'] ?? $current['lot_id']) . ' changed status before it could be reserved (current: ' . $current['status'] . ')'];
                }
                return true;
            },
            function () use ($lotModel, $lotId) {
                return $lotModel->transitionStatus($lotId, 'Reserved', ['Available']);
            }
        );
    }

    // Full Automation, Admin-First: folds the previously-separate manual
    // "Confirm" click (Manage Reservations) into payment verification — the
    // one remaining human control point (see the automation plan's payment
    // boundary). Routed through AutomationEngine::run() so a lot that went
    // unavailable between payment and verification (or any other reason the
    // booking can't safely auto-confirm) raises a system_exceptions entry
    // for admin review instead of silently doing nothing or guessing.
    //
    // Deliberately a no-op (not an exception) when reference_id isn't a
    // schedule at all (the Lot Management "Pay Now" shortcut) or the
    // schedule already reached a terminal-ish state (Confirmed/Completed/
    // Cancelled) — there's nothing to automate in either case.
    private function autoConfirmScheduleForVerifiedPurchase($payment, $adminId) {
        if (empty($payment['reference_id'])) {
            return;
        }

        $scheduleModel = new Schedule();
        $schedule = $scheduleModel->findById($payment['reference_id']);
        if (!$schedule || in_array($schedule['status'], ['Confirmed', 'Completed', 'Cancelled'], true)) {
            return;
        }

        $scheduleId = $schedule['schedule_id'];
        $adminActor = ['user_id' => $adminId, 'role' => 'admin'];
        $lotModel = new Lot();

        AutomationEngine::run(
            'payment.verified',
            'Schedule',
            $scheduleId,
            $adminActor,
            function () use ($schedule, $lotModel) {
                $lot = $lotModel->findById($schedule['lot_id']);
                if (!$lot) {
                    return ['Linked lot no longer exists'];
                }
                if (!in_array($lot['status'], ['Available', 'Reserved'], true)) {
                    return ['Lot ' . ($lot['lot_number'] ?? $lot['lot_id']) . ' is no longer available (status: ' . $lot['status'] . ')'];
                }
                return true;
            },
            function () use ($scheduleId, $adminActor) {
                $scheduleController = new ScheduleController();
                // Batch F: _auditedByAutomationEngine tells ScheduleController::
                // update() to skip its own 'Schedule confirmed' audit entry —
                // the AutomationEngine::run() call above already logs this
                // exact fact as a 'payment.verified' entry against this same
                // Schedule entity.
                return $scheduleController->update($scheduleId, ['status' => 'Confirmed', '_auditedByAutomationEngine' => true], $adminActor);
            }
        );
    }

    // Sub-batch 1 (Batch G): the Cremation counterpart to
    // autoConfirmScheduleForVerifiedPurchase() above, reusing the same
    // AutomationEngine envelope. Deliberately narrower than the Schedule
    // case: cremation_records.status has no "Confirmed"-equivalent middle
    // state between Scheduled and Completed, and a payment verifying is not
    // itself proof the physical cremation took place — that would be
    // asserting a real-world fact the payment can't know. The one
    // deterministic fact a verified payment CAN safely confirm is: if staff
    // already recorded a niche (i.e. already treated the placement as done —
    // see assignNiche()'s own existing precedent that niche-assigned implies
    // Completed) and the record is still sitting at a non-terminal status
    // only because nobody flipped it, verified payment is the missing piece
    // to finalize it. If no niche is recorded yet, there's nothing safe to
    // finalize — deliberately a no-op, not an exception, mirroring
    // autoConfirmScheduleForVerifiedPurchase()'s own early-return convention
    // for its terminal/no-op cases. Reuses CremationController::update() for
    // the actual write rather than a second implementation, per the
    // instruction to not duplicate business logic — Cremation::update()
    // requires the full existing row's fields, not just the changed one
    // (Batch A found this pre-existing gap; not fixed here, just worked
    // around by fetching the current row first).
    private function autoUpdateCremationForVerifiedPayment($payment, $adminId) {
        if (empty($payment['reference_id'])) {
            return;
        }

        $cremationModel = new Cremation();
        $adminActor = ['user_id' => $adminId, 'role' => 'admin'];
        $referenceId = (int) $payment['reference_id'];
        $cremation = $cremationModel->findById($referenceId);

        // Explicit requirement: an invalid/missing reference must raise a
        // reviewable exception, not fail silently. In practice this should
        // be rare — validatePaymentReference() already required a real,
        // non-Cancelled cremation record at payment-creation time — so
        // reaching this branch means the record was deleted in the interim,
        // a genuine anomaly worth a human looking at.
        if (!$cremation) {
            AutomationEngine::run(
                'payment.verified',
                'Cremation',
                $referenceId,
                $adminActor,
                function () {
                    return ['Referenced cremation record no longer exists'];
                },
                function () {
                    return null;
                }
            );
            return;
        }

        if (empty($cremation['niche_number']) || in_array($cremation['status'], ['Completed', 'Cancelled'], true)) {
            return;
        }

        $cremationId = $cremation['cremation_id'];

        AutomationEngine::run(
            'payment.verified',
            'Cremation',
            $cremationId,
            $adminActor,
            function () use ($cremationModel, $cremationId) {
                $current = $cremationModel->findById($cremationId);
                if (!$current) {
                    return ['Cremation record no longer exists'];
                }
                if ($current['status'] === 'Cancelled') {
                    return ['Cremation record was cancelled before payment could finalize it'];
                }
                if (empty($current['niche_number'])) {
                    return ['No niche has been assigned yet — nothing to finalize'];
                }
                return true;
            },
            function () use ($cremationModel, $cremationId, $adminId) {
                $current = $cremationModel->findById($cremationId);
                $cremationController = new CremationController();
                // _auditedByAutomationEngine: see the matching comment on
                // CremationController::update() — the AutomationEngine::run()
                // call wrapping this closure already logs this exact fact.
                return $cremationController->update($cremationId, [
                    'deceased_id' => $current['deceased_id'],
                    'niche_number' => $current['niche_number'],
                    'columbarium' => $current['columbarium'],
                    'level' => $current['level'],
                    'cremation_date' => $current['cremation_date'],
                    'status' => 'Completed',
                    'ash_storage_location' => $current['ash_storage_location'],
                    'notes' => $current['notes'],
                    '_auditedByAutomationEngine' => true,
                ], $adminId);
            }
        );
    }

    // Bulk counterpart to verify() for the "Verify All Pending" / "Reject All
    // Pending" toolbar actions — runs the exact same per-payment update +
    // notification + lot-sync path as verify(), just looped, so a bulk Verify
    // still flips any linked Lot Purchase lots the same way a single verify would.
    public function verifyAllPending($status, $adminId) {
        if (!in_array($status, ['Verified', 'Rejected'], true)) {
            return ['error' => 'Invalid verification status', 'code' => 400];
        }

        $pendingPayments = $this->paymentModel->findAll(['verification_status' => 'Pending']);
        if (empty($pendingPayments)) {
            return [
                'success' => true,
                'message' => 'No pending payments found',
                'updated' => 0,
            ];
        }

        $updated = 0;
        foreach ($pendingPayments as $payment) {
            $result = $this->verify($payment['payment_id'], $status, $adminId);
            if (!empty($result['success'])) {
                $updated++;
            }
        }

        return [
            'success' => true,
            'message' => sprintf('%d pending payment(s) %s', $updated, strtolower($status)),
            'updated' => $updated,
        ];
    }

    private function sendEmail($email, $subject, $message) {
        if (empty($email)) {
            return false;
        }

        $headers = "From: noreply@cemeterysystem.local\r\n";
        $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

        return @mail($email, $subject, $message, $headers);
    }

    private function saveReceiptFile($file) {
        if (empty($file['tmp_name']) || $file['error'] !== UPLOAD_ERR_OK) {
            return false;
        }

        // Detect the type from the file's actual bytes rather than trusting the
        // client-supplied Content-Type header, which is trivially spoofable.
        $extensionsByType = [
            'image/jpeg' => 'jpg',
            'image/png' => 'png',
            'application/pdf' => 'pdf',
        ];
        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $detectedType = $finfo ? finfo_file($finfo, $file['tmp_name']) : false;
        if ($finfo) {
            finfo_close($finfo);
        }
        if (!$detectedType || !isset($extensionsByType[$detectedType])) {
            return false;
        }

        $uploadDir = __DIR__ . '/../uploads/receipts';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        $extension = $extensionsByType[$detectedType];
        $filename = 'receipt_' . time() . '_' . bin2hex(random_bytes(5)) . '.' . $extension;
        $destination = $uploadDir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            return false;
        }

        // Build an absolute, origin-relative URL from the actual backend root so it
        // resolves correctly regardless of which frontend page renders it, and so it
        // points at where the file is really saved (backend/uploads/receipts/, a
        // sibling of api/ rather than beneath it — anything under backend/api/ is
        // unconditionally rewritten to api/index.php by backend/.htaccess and could
        // never be served as a static file).
        $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/backend/api/index.php');
        $backendRoot = rtrim(dirname(dirname($scriptName)), '/');
        return $backendRoot . '/uploads/receipts/' . $filename;
    }

    private function notifyPayment($data, $userId) {
        $notificationTitle = 'New Payment Recorded';
        $notificationMessage = sprintf(
            'A new payment of ₱%s has been recorded and awaits verification.',
            number_format($data['amount'], 2)
        );

        $notificationModel = new Notification();
        $notificationModel->create([
            'title' => $notificationTitle,
            'message' => $notificationMessage,
            'notification_type' => 'Payment',
            'is_read' => 0,
        ]);

        $userModel = new User();
        $user = $userModel->findById($userId);
        if (!empty($user['email'])) {
            $this->sendEmail($user['email'], $notificationTitle, $notificationMessage);
        }
    }

    // $deletedBy is optional (defaults to null) purely so any other, unaudited
    // caller of this method doesn't break — the route handler always passes the
    // authenticated admin's id.
    public function destroy($id, $deletedBy = null) {
        $existing = $this->paymentModel->findById($id);
        if (!$existing) {
            return ['error' => 'Payment not found', 'code' => 404];
        }

        if (($existing['verification_status'] ?? 'Pending') === 'Verified') {
            return ['error' => 'Verified payments cannot be deleted', 'code' => 403];
        }

        $result = $this->paymentModel->delete($id);
        if (!$result) {
            return ['error' => 'Failed to delete payment', 'code' => 500];
        }

        // Snapshot taken before delete() above, since the row no longer exists
        // afterward — same AuditLog mechanism already used by verify()/update().
        $this->auditLogModel->log(
            'Payment deleted',
            $deletedBy,
            null,
            'Payment',
            $id,
            [
                'receipt_number' => $existing['receipt_number'] ?? null,
                'amount' => $existing['amount'] ?? null,
                'transaction_type' => $existing['transaction_type'] ?? null,
                'verification_status' => $existing['verification_status'] ?? null,
            ]
        );

        return ['success' => true, 'message' => 'Payment deleted'];
    }

    public function revenue($filters = []) {
        return $this->paymentModel->getRevenue($filters);
    }

    public function revenueByMonth($year = null) {
        return $this->paymentModel->getRevenueByMonth($year);
    }

    public function revenueBreakdown($filters = []) {
        return $this->paymentModel->getRevenueBreakdown($filters);
    }

    public function verificationBreakdown($filters = []) {
        return $this->paymentModel->getVerificationBreakdown($filters);
    }

    public function revenueByMethod($filters = []) {
        return $this->paymentModel->getRevenueByMethod($filters);
    }
}
