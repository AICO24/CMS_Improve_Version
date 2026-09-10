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
require_once __DIR__ . '/../models/SystemException.php';
require_once __DIR__ . '/../services/AutomationEngine.php';
require_once __DIR__ . '/../services/EnvironmentService.php';
require_once __DIR__ . '/../services/PayMongoService.php';
require_once __DIR__ . '/ScheduleController.php';
require_once __DIR__ . '/CremationController.php';

class PaymentController {
    private $paymentModel;
    private $auditLogModel;
    private $systemExceptionModel;

    public function __construct() {
        $this->paymentModel = new Payment();
        $this->auditLogModel = new AuditLog();
        $this->systemExceptionModel = new SystemException();
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
    // $referenceKind: same explicit-intent signal validatePaymentReference()
    // takes (see that method's comment) — when supplied, resolves the exact
    // same way instead of re-guessing by existence-check order.
    public function resolveExpectedAmount($transactionType, $referenceId, $referenceKind = null) {
        $transactionType = $this->normalizeTransactionType($transactionType);
        $referenceId = $this->normalizeReferenceId($referenceId);
        $referenceKind = in_array($referenceKind, ['schedule', 'lot'], true) ? $referenceKind : null;

        if ($transactionType !== 'Lot Purchase' || $referenceId === null) {
            return ['expected_amount' => null];
        }

        $scheduleModel = new Schedule();
        $lotModel = new Lot();

        if ($referenceKind === 'lot') {
            $lot = $lotModel->findById($referenceId);
            return ($lot && isset($lot['price']))
                ? ['expected_amount' => (float) $lot['price'], 'lot_number' => $lot['lot_number'] ?? null, 'source' => 'lot']
                : ['expected_amount' => null];
        }

        if ($referenceKind === 'schedule') {
            $schedule = $scheduleModel->findById($referenceId);
            if (!$schedule || empty($schedule['lot_id'])) {
                return ['expected_amount' => null];
            }
            $lot = $lotModel->findById($schedule['lot_id']);
            return ($lot && isset($lot['price']))
                ? ['expected_amount' => (float) $lot['price'], 'lot_number' => $lot['lot_number'] ?? null, 'source' => 'schedule']
                : ['expected_amount' => null];
        }

        // No explicit kind — original guess-by-existence fallback, unchanged
        // from before this batch. reference_id for 'Lot Purchase' is, in
        // practice, either a schedule_id (the normal "reserve then pay" flow)
        // or a raw lot_id (the Lot Management "Pay Now" shortcut used before
        // any schedule exists) — try schedule first since that's the more
        // common path, then fall back.
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
    //
    // $referenceKind ('schedule'|'lot'|null, Lot Purchase only): burial audit
    // finding E.2 — schedule_id and lot_id are independent AUTO_INCREMENT
    // counters, so guessing which one reference_id means by existence-check
    // order (the old behavior, still the fallback below) misattributes a
    // payment whenever a "Pay Now" lot_id happens to numerically collide with
    // an unrelated schedule_id. When the caller states its intent explicitly
    // (frontend now does, see payments.js/lot-management.js/booking-wizard.js)
    // it's trusted outright instead of re-guessed. Left null by legacy
    // callers and the payments modal's manual reference-entry fallback, which
    // still need the original guess — see migration_20260902_add_payment_reference_kind.sql.
    private function validatePaymentReference($transactionType, $referenceId, $userId, $userRole, $referenceKind = null) {
        $transactionType = $this->normalizeTransactionType($transactionType);
        if ($transactionType === null) {
            return ['error' => 'Invalid transaction type', 'code' => 400];
        }

        $referenceId = $this->normalizeReferenceId($referenceId);
        $roleName = strtolower(trim((string) $userRole));
        $referenceKind = in_array($referenceKind, ['schedule', 'lot'], true) ? $referenceKind : null;

        switch ($transactionType) {
            case 'Lot Purchase':
                if ($referenceId === null) {
                    return ['error' => 'Lot Purchase payments require a valid reservation or lot reference', 'code' => 400];
                }

                $scheduleModel = new Schedule();
                $lotModel = new Lot();

                if ($referenceKind === 'lot') {
                    $lot = $lotModel->findById($referenceId);
                    if (!$lot) {
                        return ['error' => 'Lot reference not found', 'code' => 404];
                    }
                    return [
                        'reference_id' => $referenceId,
                        'reference_kind' => 'lot',
                        'reference_label' => 'Lot ' . ($lot['lot_number'] ?? $referenceId),
                    ];
                }

                if ($referenceKind === 'schedule') {
                    $schedule = $scheduleModel->findById($referenceId);
                    if (!$schedule) {
                        return ['error' => 'Reservation reference not found', 'code' => 404];
                    }
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
                        'reference_kind' => 'schedule',
                        'reference_label' => 'Reservation #' . $schedule['schedule_id'] . ' - Lot ' . ($schedule['lot_number'] ?? 'N/A'),
                    ];
                }

                // No explicit kind — original guess-by-existence fallback,
                // unchanged from before this batch.
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
                        'reference_kind' => 'schedule',
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
                    'reference_kind' => 'lot',
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
                    'reference_kind' => null,
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
                    'reference_kind' => null,
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
                    'reference_kind' => null,
                    'reference_label' => 'Expiration #' . $expiration['expiration_id'] . ' - Lot ' . ($expiration['lot_number'] ?? 'N/A'),
                ];

            case 'Other':
                return [
                    'reference_id' => $referenceId,
                    'reference_kind' => null,
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
        $referenceCheck = $this->validatePaymentReference($transactionType, $data['reference_id'] ?? null, $userId, $userRole, $data['reference_kind'] ?? null);
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
        // Persists whatever validatePaymentReference() actually resolved
        // (explicit caller intent when given, otherwise its own
        // guess-by-existence fallback) so verify()'s downstream automation
        // never has to re-guess either — see syncLotStatusForVerifiedPurchase()/
        // autoConfirmScheduleForVerifiedPurchase() below.
        $data['reference_kind'] = $referenceCheck['reference_kind'] ?? null;
        $data['received_by'] = $userId;
        $data['verification_status'] = 'Pending';
        $paymentId = $this->paymentModel->create($data);
        if ($paymentId) {
            $this->notifyPayment($data, $userId);

            // Non-blocking, informational only — the amount was already accepted
            // above; this just lets the frontend/caller know if it diverged from
            // the trusted server-side price so staff can double-check it later.
            $expected = $this->resolveExpectedAmount($data['transaction_type'], $data['reference_id'] ?? null, $data['reference_kind']);
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

        // Only trust an explicit reference_kind (or reuse the already-resolved
        // one) when reference_id itself isn't changing — a caller that
        // resubmits a different reference_id without stating its kind falls
        // through to validatePaymentReference()'s own guess fallback rather
        // than incorrectly inheriting the OLD reference's kind.
        $referenceKindInput = array_key_exists('reference_id', $data)
            ? ($data['reference_kind'] ?? null)
            : ($existing['reference_kind'] ?? null);

        $referenceCheck = $this->validatePaymentReference(
            $transactionType,
            $data['reference_id'] ?? $existing['reference_id'],
            $userId,
            $userRole,
            $referenceKindInput
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
            'reference_kind' => $referenceCheck['reference_kind'] ?? null,
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

        $expected = $this->resolveExpectedAmount($updatePayload['transaction_type'], $updatePayload['reference_id'], $updatePayload['reference_kind']);
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
                'user_id' => $payment['received_by'] ?? null,
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
                // Cremation Phase B: the citizen-intake counterpart to
                // autoUpdateCremationForVerifiedPayment() below — that method
                // only ever acts on an ALREADY-niche-assigned record (the
                // admin-direct workflow: niche assigned first, payment
                // verified after). This one only ever acts on a Pending,
                // niche-less record (the citizen-booking workflow) — the two
                // preconditions are mutually exclusive by construction, so
                // calling both unconditionally is always safe, mirroring
                // burial's own dual syncLotStatusForVerifiedPurchase()/
                // autoConfirmScheduleForVerifiedPurchase() calls above.
                $this->autoConfirmCremationForVerifiedPayment($payment, $adminId);
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
    // Never downgrades a lot that's already past Available (Reserved/Occupied/
    // Expired left untouched).
    //
    // Resolves the lot via payment['reference_kind'] when it's set (see
    // migration_20260902_add_payment_reference_kind.sql / finding E.2) —
    // trusts it outright instead of re-deriving. Only a legacy row with
    // reference_kind still NULL (created before this migration) falls back
    // to the original schedule-then-lot existence-check guess.
    private function syncLotStatusForVerifiedPurchase($payment, $adminId) {
        if (empty($payment['reference_id'])) {
            return;
        }

        $scheduleModel = new Schedule();
        $lotModel = new Lot();
        $referenceKind = $payment['reference_kind'] ?? null;

        $lotId = null;
        if ($referenceKind === 'lot') {
            $lot = $lotModel->findById($payment['reference_id']);
            if ($lot) {
                $lotId = $lot['lot_id'];
            }
        } elseif ($referenceKind === 'schedule') {
            $schedule = $scheduleModel->findById($payment['reference_id']);
            if ($schedule && !empty($schedule['lot_id'])) {
                $lotId = $schedule['lot_id'];
            }
        } else {
            $schedule = $scheduleModel->findById($payment['reference_id']);
            if ($schedule && !empty($schedule['lot_id'])) {
                $lotId = $schedule['lot_id'];
            } else {
                $lot = $lotModel->findById($payment['reference_id']);
                if ($lot) {
                    $lotId = $lot['lot_id'];
                }
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
                return $lotModel->transitionStatus($lotId, 'Reserved', Lot::allowedFromStatusesFor('payment.verified', 'Reserved'));
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
    //
    // Finding E.2: previously called findById($payment['reference_id'])
    // unconditionally, with no way to tell "this is genuinely not a
    // schedule" apart from "this schedule_id doesn't exist" — a Pay Now
    // lot_id that happened to numerically collide with an unrelated real
    // schedule_id would silently auto-confirm THAT schedule. Now an
    // explicit reference_kind === 'lot' short-circuits to the no-op before
    // any schedule lookup runs at all. A legacy row with reference_kind
    // still NULL keeps the original lookup (unavoidable — there's nothing
    // to trust for rows created before this migration).
    private function autoConfirmScheduleForVerifiedPurchase($payment, $adminId) {
        if (empty($payment['reference_id']) || ($payment['reference_kind'] ?? null) === 'lot') {
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

    // Cremation Phase B: the citizen-intake counterpart to
    // autoUpdateCremationForVerifiedPayment() below — that method predates
    // Pending existing as a real status (see its own comment) and only ever
    // acts on an already-niche-assigned record. This one is the Cremation
    // equivalent of autoConfirmScheduleForVerifiedPurchase() above: a
    // Pending, niche-less cremation booked by a citizen moves to Scheduled
    // the moment its payment is verified — no niche touched, mirrors
    // burial's Confirmed step exactly (a reservation confirmed; the physical
    // event and resource placement are still ahead). Deliberately a no-op
    // (not an exception) when reference_id isn't a Pending, niche-less
    // cremation at all — nothing to automate, mirrors
    // autoConfirmScheduleForVerifiedPurchase()'s own early-return convention.
    private function autoConfirmCremationForVerifiedPayment($payment, $adminId) {
        if (empty($payment['reference_id'])) {
            return;
        }

        $cremationModel = new Cremation();
        $cremation = $cremationModel->findById((int) $payment['reference_id']);
        if (!$cremation || $cremation['status'] !== 'Pending' || !empty($cremation['niche_number'])) {
            return;
        }

        $cremationId = $cremation['cremation_id'];
        $adminActor = ['user_id' => $adminId, 'role' => 'admin'];

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
                if ($current['status'] !== 'Pending') {
                    return ['Cremation record is no longer Pending (current: ' . $current['status'] . ')'];
                }
                return true;
            },
            function () use ($cremationId, $adminActor) {
                $cremationController = new CremationController();
                // Batch F convention: _auditedByAutomationEngine tells
                // CremationController::update() to skip its own 'Cremation
                // record updated' audit entry — the AutomationEngine::run()
                // call above already logs this exact fact as a
                // 'payment.verified' entry against this same Cremation entity.
                return $cremationController->update($cremationId, ['status' => 'Scheduled', '_auditedByAutomationEngine' => true], $adminActor);
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
            function () use ($cremationModel, $cremationId, $adminActor) {
                $current = $cremationModel->findById($cremationId);
                $cremationController = new CremationController();
                // _auditedByAutomationEngine: see the matching comment on
                // CremationController::update() — the AutomationEngine::run()
                // call wrapping this closure already logs this exact fact.
                //
                // Cremation Phase B: CremationController::update()'s
                // signature changed from a bare $userId to the full actor
                // array (role is now needed to distinguish a citizen's
                // self-service edit from staff/admin) — this call site was
                // still passing $adminId alone, which update() would then
                // read as an unrecognized role and incorrectly apply the
                // citizen-only "must still be Pending" restriction, silently
                // failing to finalize an already-Scheduled record. Caught by
                // live-testing the Phase B regression case, not by
                // inspection — fixed by passing the $adminActor array this
                // method already builds above, same as every other caller.
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
                ], $adminActor);
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
            'user_id' => $userId,
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

    public function revenueByYear($filters = []) {
        return $this->paymentModel->getRevenueByYear($filters);
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

    /**
     * Batch 3: Creates or retrieves a PayMongo Sandbox Hosted Checkout Session.
     * Scope: Lot Purchase only. Does NOT verify payment or confirm bookings.
     *
     * @param array $data Request payload (reference_id, reference_kind, payment_id, success_url, cancel_url)
     * @param array $user Authenticated user payload from AuthMiddleware
     * @return array Response array with HTTP status code in 'code'
     */
    public function createCheckoutSession($data, $user) {
        $userId = (int) ($user['user_id'] ?? 0);
        $userRole = strtolower(trim((string) ($user['role'] ?? '')));

        if ($userId <= 0) {
            return ['error' => 'Unauthorized', 'code' => 401];
        }

        // 1. Transaction type enforcement (Batch 3 strict boundary)
        $rawType = $data['transaction_type'] ?? 'Lot Purchase';
        $transactionType = $this->normalizeTransactionType($rawType);
        if ($transactionType !== 'Lot Purchase') {
            return [
                'error' => 'Only Lot Purchase transactions are supported for online checkout. Other transaction types do not have authoritative pricing yet.',
                'code' => 400,
            ];
        }

        // 2. Resolve target payment or reference
        $paymentId = !empty($data['payment_id']) ? (int) $data['payment_id'] : null;
        $payment = null;

        if ($paymentId !== null) {
            $payment = $this->paymentModel->findById($paymentId);
            if (!$payment) {
                return ['error' => 'Payment not found', 'code' => 404];
            }
            if ($payment['transaction_type'] !== 'Lot Purchase') {
                return ['error' => 'Only Lot Purchase payments are supported for online checkout', 'code' => 400];
            }
            if (($payment['verification_status'] ?? 'Pending') !== 'Pending') {
                return ['error' => 'Only Pending payments can be processed for checkout', 'code' => 400];
            }
            // Ownership check for user role
            if ($userRole === 'user' && (int) ($payment['received_by'] ?? 0) !== $userId) {
                return ['error' => 'You may only initiate checkout for your own payment', 'code' => 403];
            }
            $referenceId = $payment['reference_id'];
            $referenceKind = $payment['reference_kind'];
        } else {
            $referenceId = $this->normalizeReferenceId($data['reference_id'] ?? null);
            if ($referenceId === null) {
                return ['error' => 'reference_id is required', 'code' => 400];
            }
            $referenceKind = in_array($data['reference_kind'] ?? null, ['schedule', 'lot'], true) ? $data['reference_kind'] : null;

            // Server-side ownership and reference validation
            $referenceCheck = $this->validatePaymentReference('Lot Purchase', $referenceId, $userId, $userRole, $referenceKind);
            if (isset($referenceCheck['error'])) {
                return $referenceCheck;
            }
            $referenceId = $referenceCheck['reference_id'];
            $referenceKind = $referenceCheck['reference_kind'] ?? null;
        }

        // 3. Authoritative server-side price resolution
        require_once __DIR__ . '/../services/PaymentAmountResolver.php';
        $resolver = new PaymentAmountResolver();
        $priceResult = $resolver->resolve('Lot Purchase', $referenceId, $referenceKind);
        if (!($priceResult['resolved'] ?? false)) {
            return [
                'error' => $priceResult['reason'] ?? 'Authoritative price resolution failed',
                'reason_code' => $priceResult['reason_code'] ?? 'resolution_failed',
                'code' => 400,
            ];
        }

        $authoritativeAmount = (float) $priceResult['amount'];
        $authoritativeCents = (int) $priceResult['amount_cents'];
        $referenceLabel = $priceResult['reference_label'] ?? ('Lot ' . $referenceId);

        // 4. Locate or create the Pending CMS Payment row
        if (!$payment) {
            $payment = $this->paymentModel->findPendingByReference('Lot Purchase', $referenceId, $referenceKind, $userId);
            if ($payment) {
                $paymentId = (int) $payment['payment_id'];
            } else {
                $paymentId = $this->paymentModel->create([
                    'transaction_type' => 'Lot Purchase',
                    'reference_id' => $referenceId,
                    'reference_kind' => $referenceKind,
                    'amount' => $authoritativeAmount,
                    'payment_date' => date('Y-m-d'),
                    'payment_method' => 'PayMongo',
                    'receipt_number' => '', // Auto-generates RCPT-{year}-{id}
                    'notes' => 'PayMongo sandbox checkout initiated',
                    'received_by' => $userId,
                    'verification_status' => 'Pending',
                ]);
                if (!$paymentId) {
                    return ['error' => 'Failed to record pending payment record', 'code' => 500];
                }
                $payment = $this->paymentModel->findById($paymentId);
            }
        }

        // 5. Check for existing active checkout session (Idempotency / Re-entry)
        require_once __DIR__ . '/../services/PayMongoService.php';
        $payMongoService = new PayMongoService();

        if (!empty($payment['gateway_checkout_session_id'])) {
            $existingSessionId = $payment['gateway_checkout_session_id'];
            if ($payMongoService->isConfigured()) {
                $sessionCheck = $payMongoService->getCheckoutSession($existingSessionId);
                if (!empty($sessionCheck['success']) && !empty($sessionCheck['data']['attributes']['checkout_url'])) {
                    $existingAttrs = $sessionCheck['data']['attributes'];
                    $sessionStatus = $existingAttrs['status'] ?? 'awaiting_payment_method';
                    if ($sessionStatus === 'active' || $sessionStatus === 'awaiting_payment_method') {
                        return [
                            'success' => true,
                            'reused' => true,
                            'payment_id' => $paymentId,
                            'receipt_number' => $payment['receipt_number'] ?? null,
                            'checkout_session_id' => $existingSessionId,
                            'checkout_url' => $existingAttrs['checkout_url'],
                            'gateway_status' => $sessionStatus,
                            'amount' => $authoritativeAmount,
                            'currency' => 'PHP',
                            'code' => 200,
                        ];
                    }
                }
            }
        }

        // 6. Check gateway configuration
        if (!$payMongoService->isConfigured()) {
            return [
                'error' => 'Payment gateway is not configured (missing PAYMONGO_SECRET_KEY)',
                'configured' => false,
                'payment_id' => $paymentId,
                'code' => 503,
            ];
        }

        $configValidation = $payMongoService->validateConfig();
        if (!$configValidation['valid']) {
            return [
                'error' => 'Payment gateway misconfigured: ' . implode('; ', $configValidation['errors']),
                'configured' => false,
                'payment_id' => $paymentId,
                'code' => 503,
            ];
        }

        // 7. Deterministic idempotency key derived from stable CMS payment identity
        $idempotencyKey = 'cms_cs_payment_' . $paymentId . '_' . $authoritativeCents;

        // 8. Construct official PayMongo Checkout Session payload
        $origin = $this->resolveAppOrigin($data);
        $successUrl = !empty($data['success_url'])
            ? $data['success_url']
            : ($origin . '/frontend/pages/payments.html?checkout_status=success&payment_id=' . $paymentId);
        $cancelUrl = !empty($data['cancel_url'])
            ? $data['cancel_url']
            : ($origin . '/frontend/pages/payments.html?checkout_status=cancelled&payment_id=' . $paymentId);

        $receiptNumber = $payment['receipt_number'] ?? ('RCPT-' . date('Y') . '-' . $paymentId);
        $sessionAttributes = [
            'line_items' => [
                [
                    'name' => 'Lot Purchase - ' . $referenceLabel,
                    'amount' => $authoritativeCents,
                    'currency' => 'PHP',
                    'quantity' => 1,
                    'description' => 'Payment for ' . $referenceLabel,
                ],
            ],
            'payment_method_types' => ['card', 'gcash', 'paymaya'],
            'description' => 'Payment for ' . $referenceLabel . ' (' . $receiptNumber . ')',
            'reference_number' => $receiptNumber,
            'send_email_receipt' => false,
            'show_description' => true,
            'show_line_items' => true,
            'success_url' => $successUrl,
            'cancel_url' => $cancelUrl,
        ];

        // 9. Call PayMongo API
        $gatewayResult = $payMongoService->createCheckoutSession($sessionAttributes, $idempotencyKey);
        if (!$gatewayResult['success']) {
            return [
                'error' => $gatewayResult['error'] ?? 'Failed to create PayMongo checkout session',
                'gateway_status_code' => $gatewayResult['status'] ?? 0,
                'payment_id' => $paymentId,
                'code' => 502,
            ];
        }

        // 10. Persist gateway identifiers and status into payments row
        $sessionData = $gatewayResult['data'] ?? [];
        $sessionId = $sessionData['id'] ?? null;
        $sessionAttrs = $sessionData['attributes'] ?? [];
        $checkoutUrl = $sessionAttrs['checkout_url'] ?? null;
        $gatewayStatus = $sessionAttrs['status'] ?? 'awaiting_payment_method';
        $intentId = $sessionAttrs['payment_intent']['id'] ?? ($sessionAttrs['payment_intent_id'] ?? null);

        $this->paymentModel->setGatewaySession($paymentId, 'paymongo', $sessionId, $intentId, $gatewayStatus);

        // 11. Return safe response (NEVER return secrets)
        return [
            'success' => true,
            'reused' => false,
            'payment_id' => $paymentId,
            'receipt_number' => $receiptNumber,
            'checkout_session_id' => $sessionId,
            'checkout_url' => $checkoutUrl,
            'gateway_status' => $gatewayStatus,
            'amount' => $authoritativeAmount,
            'currency' => 'PHP',
            'code' => 200,
        ];
    }

    private function resolveAppOrigin($data = []) {
        if (!empty($data['origin']) && filter_var($data['origin'], FILTER_VALIDATE_URL)) {
            $parsed = parse_url($data['origin']);
            if (!empty($parsed['scheme']) && !empty($parsed['host'])) {
                return rtrim($data['origin'], '/');
            }
        }
        $scheme = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] === 'on') ? 'https' : 'http';
        $host = $_SERVER['HTTP_HOST'] ?? 'localhost';
        $uri = $_SERVER['REQUEST_URI'] ?? '';
        $script = $_SERVER['SCRIPT_NAME'] ?? '';
        $prefix = (strpos($uri, '/CMS') === 0 || strpos($script, '/CMS') === 0) ? '/CMS' : '';
        return $scheme . '://' . $host . $prefix;
    }

    /**
     * Batch 4: Handles incoming PayMongo webhook notifications.
     * Trusted backend trigger for Hosted Checkout payment confirmation.
     *
     * @param string|null $rawBody The raw HTTP request body string
     * @param string|null $signatureHeader The Paymongo-Signature header value
     * @return array Response payload with HTTP status code in 'code'
     */
    public function handleWebhook(?string $rawBody = null, ?string $signatureHeader = null): array {
        // 1. Capture raw request body
        if ($rawBody === null) {
            $rawBody = file_get_contents('php://input');
        }
        if ($rawBody === false || $rawBody === '') {
            return ['error' => 'Empty request body', 'code' => 400];
        }

        // 2. Capture signature header
        if ($signatureHeader === null) {
            $signatureHeader = $_SERVER['HTTP_PAYMONGO_SIGNATURE'] ?? '';
            if ($signatureHeader === '' && function_exists('getallheaders')) {
                $headers = getallheaders();
                foreach ($headers as $k => $v) {
                    if (strcasecmp($k, 'Paymongo-Signature') === 0) {
                        $signatureHeader = $v;
                        break;
                    }
                }
            }
        }

        if (trim((string) $signatureHeader) === '') {
            return ['error' => 'Missing Paymongo-Signature header', 'code' => 401];
        }

        // 3. Load webhook secret
        EnvironmentService::loadEnvironment();
        $webhookSecret = trim((string) EnvironmentService::get('PAYMONGO_WEBHOOK_SECRET', ''));
        if ($webhookSecret === '') {
            // Fail closed: Never proceed if secret is missing or empty
            return ['error' => 'Webhook signing secret not configured', 'code' => 401];
        }

        // 4. Verify HMAC-SHA256 signature
        if (!$this->verifyWebhookSignature($rawBody, $signatureHeader, $webhookSecret)) {
            return ['error' => 'Invalid webhook signature', 'code' => 401];
        }

        // 5. Decode JSON payload
        $payload = json_decode($rawBody, true);
        if (!is_array($payload) || empty($payload['data'])) {
            return ['error' => 'Malformed or invalid JSON payload', 'code' => 400];
        }

        $eventData = $payload['data'];
        $eventId = $eventData['id'] ?? null;
        $eventType = $eventData['attributes']['type'] ?? ($eventData['type'] ?? null);
        $livemode = !empty($eventData['attributes']['livemode'] ?? ($eventData['livemode'] ?? false));

        if (empty($eventId) || empty($eventType)) {
            return ['error' => 'Missing required event fields', 'code' => 400];
        }

        $db = Database::getInstance()->getConnection();

        // 6. Idempotency check via webhook_events table
        $stmt = $db->prepare("SELECT * FROM webhook_events WHERE event_id = ? LIMIT 1");
        $stmt->execute([$eventId]);
        $existingEvent = $stmt->fetch(PDO::FETCH_ASSOC);

        if ($existingEvent) {
            // Duplicate event: Idempotent no-op
            return [
                'success' => true,
                'status' => 'duplicate',
                'message' => 'Event already processed',
                'event_id' => $eventId,
                'code' => 200,
            ];
        }

        // Record incoming event to establish idempotency barrier
        try {
            $insertStmt = $db->prepare("
                INSERT INTO webhook_events (event_id, event_type, livemode, received_at, processed, processing_result)
                VALUES (?, ?, ?, NOW(), 0, 'received')
            ");
            $insertStmt->execute([$eventId, $eventType, $livemode ? 1 : 0]);
        } catch (PDOException $e) {
            // Handle duplicate key collision if concurrent requests insert same event_id
            if ($e->getCode() == 23000 || strpos($e->getMessage(), 'Duplicate entry') !== false) {
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

        // 7. Event type filtering: primary supported event is checkout_session.payment.paid
        if ($eventType !== 'checkout_session.payment.paid') {
            $updStmt = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = ? WHERE event_id = ?");
            $updStmt->execute(['ignored_unsupported_event_type', $eventId]);

            return [
                'success' => true,
                'status' => 'ignored',
                'message' => 'Event type safely ignored',
                'event_type' => $eventType,
                'code' => 200,
            ];
        }

        // 8. Extract checkout session and payment data defensively
        $csObj = $eventData['attributes']['data'] ?? ($eventData['data'] ?? []);
        $csId = $csObj['id'] ?? null;
        $csAttrs = $csObj['attributes'] ?? [];
        $csStatus = $csAttrs['status'] ?? null;
        $referenceNumber = $csAttrs['reference_number'] ?? null;

        $paymentIntent = $csAttrs['payment_intent'] ?? [];
        $piAttrs = $paymentIntent['attributes'] ?? [];

        $paymentsList = $csAttrs['payments'] ?? ($piAttrs['payments'] ?? []);
        $firstPayment = !empty($paymentsList[0]) ? $paymentsList[0] : null;

        $gatewayPaymentId = $firstPayment['id'] ?? null;
        $gatewayPaymentStatus = $firstPayment['attributes']['status'] ?? ($piAttrs['status'] ?? ($csStatus ?? 'paid'));

        // Amount in integer centavos
        $webhookAmountCents = null;
        if (isset($firstPayment['attributes']['amount'])) {
            $webhookAmountCents = (int) $firstPayment['attributes']['amount'];
        } elseif (isset($piAttrs['amount'])) {
            $webhookAmountCents = (int) $piAttrs['amount'];
        } elseif (isset($csAttrs['amount'])) {
            $webhookAmountCents = (int) $csAttrs['amount'];
        }

        // Currency
        $webhookCurrency = null;
        if (isset($firstPayment['attributes']['currency'])) {
            $webhookCurrency = strtoupper((string) $firstPayment['attributes']['currency']);
        } elseif (isset($piAttrs['currency'])) {
            $webhookCurrency = strtoupper((string) $piAttrs['currency']);
        } elseif (isset($csAttrs['currency'])) {
            $webhookCurrency = strtoupper((string) $csAttrs['currency']);
        }

        // 9. Payment matching: primary match via gateway_checkout_session_id
        $payment = null;
        if (!empty($csId)) {
            $payment = $this->paymentModel->findByCheckoutSessionId($csId);
        }

        if (!$payment) {
            $this->systemExceptionModel->raise([
                'event' => 'payment.webhook_unmatched',
                'entity_type' => 'Payment',
                'entity_id' => 0,
                'reason' => 'No CMS payment matched Checkout Session ID: ' . ($csId ?? 'none'),
                'severity' => 'critical',
                'context' => [
                    'event_id' => $eventId,
                    'checkout_session_id' => $csId,
                    'reference_number' => $referenceNumber,
                ],
            ]);

            $updStmt = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = ? WHERE event_id = ?");
            $updStmt->execute(['unmatched_payment', $eventId]);

            return [
                'success' => true,
                'status' => 'unmatched',
                'message' => 'No matching CMS payment found',
                'code' => 200,
            ];
        }

        $paymentId = (int) $payment['payment_id'];

        // 10. Environment / Livemode consistency validation
        $payMongoService = new PayMongoService();
        $cmsMode = $payMongoService->getMode();
        if ($cmsMode === 'unconfigured') {
            $env = strtolower(trim((string) EnvironmentService::get('PAYMONGO_ENV', '')));
            $cmsMode = ($env === 'live' || $env === 'production') ? 'live' : 'test';
        }
        $expectedLivemode = ($cmsMode === 'live');

        if ($livemode !== $expectedLivemode) {
            $this->systemExceptionModel->raise([
                'event' => 'payment.webhook_environment_mismatch',
                'entity_type' => 'Payment',
                'entity_id' => $paymentId,
                'reason' => sprintf('Livemode mismatch: webhook livemode is %s, but CMS is in %s mode', $livemode ? 'true' : 'false', $cmsMode),
                'severity' => 'critical',
                'context' => [
                    'event_id' => $eventId,
                    'webhook_livemode' => $livemode,
                    'cms_mode' => $cmsMode,
                    'payment_id' => $paymentId,
                ],
            ]);

            $updStmt = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = ? WHERE event_id = ?");
            $updStmt->execute(['environment_mismatch', $eventId]);

            return [
                'success' => true,
                'status' => 'mismatch',
                'message' => 'Environment mode mismatch',
                'code' => 200,
            ];
        }

        // 11. Currency validation
        $paymentCurrency = strtoupper((string) ($payment['currency'] ?? 'PHP'));
        if ($webhookCurrency !== 'PHP' || $webhookCurrency !== $paymentCurrency) {
            $this->systemExceptionModel->raise([
                'event' => 'payment.webhook_currency_mismatch',
                'entity_type' => 'Payment',
                'entity_id' => $paymentId,
                'reason' => sprintf('Currency mismatch: webhook currency is %s, but CMS expects %s (PHP required)', $webhookCurrency ?? 'null', $paymentCurrency),
                'severity' => 'critical',
                'context' => [
                    'event_id' => $eventId,
                    'webhook_currency' => $webhookCurrency,
                    'payment_currency' => $paymentCurrency,
                    'payment_id' => $paymentId,
                ],
            ]);

            $updStmt = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = ? WHERE event_id = ?");
            $updStmt->execute(['currency_mismatch', $eventId]);

            return [
                'success' => true,
                'status' => 'mismatch',
                'message' => 'Currency mismatch',
                'code' => 200,
            ];
        }

        // 12. Authoritative amount validation
        $cmsAmountCents = (int) round(((float) $payment['amount']) * 100);
        if ($webhookAmountCents === null || $webhookAmountCents !== $cmsAmountCents) {
            $this->systemExceptionModel->raise([
                'event' => 'payment.webhook_amount_mismatch',
                'entity_type' => 'Payment',
                'entity_id' => $paymentId,
                'reason' => sprintf('Amount mismatch: webhook amount (%s cents) does not match CMS authoritative amount (%d cents)', var_export($webhookAmountCents, true), $cmsAmountCents),
                'severity' => 'critical',
                'context' => [
                    'event_id' => $eventId,
                    'webhook_amount_cents' => $webhookAmountCents,
                    'cms_amount_cents' => $cmsAmountCents,
                    'payment_id' => $paymentId,
                ],
            ]);

            $updStmt = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = ? WHERE event_id = ?");
            $updStmt->execute(['amount_mismatch', $eventId]);

            return [
                'success' => true,
                'status' => 'mismatch',
                'message' => 'Amount mismatch',
                'code' => 200,
            ];
        }

        // 13. Payment status validation
        $validStatuses = ['paid', 'succeeded'];
        $statusMatches = in_array(strtolower((string) $gatewayPaymentStatus), $validStatuses, true)
                      || in_array(strtolower((string) $csStatus), $validStatuses, true);

        if (!$statusMatches) {
            $this->systemExceptionModel->raise([
                'event' => 'payment.webhook_invalid_status',
                'entity_type' => 'Payment',
                'entity_id' => $paymentId,
                'reason' => 'PayMongo payment status is not paid/succeeded: ' . ($gatewayPaymentStatus ?? 'unknown'),
                'severity' => 'warning',
                'context' => [
                    'event_id' => $eventId,
                    'gateway_status' => $gatewayPaymentStatus,
                    'checkout_status' => $csStatus,
                    'payment_id' => $paymentId,
                ],
            ]);

            $updStmt = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = ? WHERE event_id = ?");
            $updStmt->execute(['invalid_gateway_status', $eventId]);

            return [
                'success' => true,
                'status' => 'ignored',
                'message' => 'Payment status is not successful',
                'code' => 200,
            ];
        }

        // 14. Atomic database processing
        $shouldTriggerAutomation = false;
        $claimed = false;

        $transactionSuccess = Database::getInstance()->transaction(function () use (
            $paymentId,
            $gatewayPaymentId,
            $gatewayPaymentStatus,
            $eventId,
            $payment,
            &$shouldTriggerAutomation,
            &$claimed
        ) {
            $db = Database::getInstance()->getConnection();
            $verifiedAt = date('Y-m-d H:i:s');

            // Atomic Pending-state guard
            $claimed = $this->paymentModel->verifyIfPending($paymentId, 'Verified', null, $verifiedAt);

            if ($claimed) {
                // Persist gateway payment id and gateway status only when claimed
                if (!empty($gatewayPaymentId)) {
                    $this->paymentModel->setGatewayPaymentId($paymentId, $gatewayPaymentId, $gatewayPaymentStatus);
                } else {
                    $stmt = $db->prepare("UPDATE payments SET gateway_status = ? WHERE payment_id = ?");
                    $stmt->execute([$gatewayPaymentStatus, $paymentId]);
                }

                $shouldTriggerAutomation = true;

                $this->auditLogModel->log(
                    'Payment verified',
                    null,
                    null,
                    'Payment',
                    $paymentId,
                    [
                        'status' => 'Verified',
                        'receipt_number' => $payment['receipt_number'] ?? null,
                        'source' => 'paymongo_webhook',
                        'event_id' => $eventId,
                        'gateway_payment_id' => $gatewayPaymentId,
                    ]
                );

                $notificationModel = new Notification();
                $notificationModel->create([
                    'title' => 'Payment Approved',
                    'message' => sprintf('Payment %s for receipt %s has been verified via PayMongo.', $payment['receipt_number'], $payment['receipt_number']),
                    'notification_type' => 'Payment',
                    'user_id' => $payment['received_by'] ?? null,
                    'is_read' => 0,
                ]);

                $stmt = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = ? WHERE event_id = ?");
                $stmt->execute(['verified', $eventId]);
            } else {
                // Payment was already verified/reviewed
                $stmt = $db->prepare("UPDATE webhook_events SET processed = 1, processing_result = ? WHERE event_id = ?");
                $stmt->execute(['already_reviewed', $eventId]);
            }

            return true;
        });

        if (!$transactionSuccess) {
            return ['error' => 'Database transaction failed', 'code' => 500];
        }

        // 15. Automation Engine & Email triggered strictly AFTER successful commit
        if ($shouldTriggerAutomation) {
            if ($payment['transaction_type'] === 'Lot Purchase') {
                $this->syncLotStatusForVerifiedPurchase($payment, null);
                $this->autoConfirmScheduleForVerifiedPurchase($payment, null);
            } elseif ($payment['transaction_type'] === 'Cremation') {
                $this->autoConfirmCremationForVerifiedPayment($payment, null);
                $this->autoUpdateCremationForVerifiedPayment($payment, null);
            }

            if (!empty($payment['received_by'])) {
                $userModel = new User();
                $user = $userModel->findById($payment['received_by']);
                if (!empty($user['email'])) {
                    $this->sendEmail(
                        $user['email'],
                        'Payment Verified',
                        'Your payment of PHP ' . number_format((float) $payment['amount'], 2) . ' for receipt ' . ($payment['receipt_number'] ?? '') . ' has been verified.'
                    );
                }
            }
        }

        return [
            'success' => true,
            'status' => $claimed ? 'verified' : 'already_reviewed',
            'payment_id' => $paymentId,
            'event_id' => $eventId,
            'code' => 200,
        ];
    }

    /**
     * Batch 4: Verifies PayMongo webhook signatures.
     * Supports standard PayMongo header (t=...,te=...,li=...) as well as direct HMAC.
     */
    private function verifyWebhookSignature(string $rawBody, string $signatureHeader, string $secret): bool {
        if ($secret === '' || trim($signatureHeader) === '') {
            return false;
        }

        $trimmedHeader = trim($signatureHeader);

        // 1. Direct HMAC match
        $directHash = hash_hmac('sha256', $rawBody, $secret);
        if (hash_equals($directHash, $trimmedHeader)) {
            return true;
        }

        // 2. Parse PayMongo comma-separated format: t=<timestamp>,te=<test_sig>,li=<live_sig>
        $parts = explode(',', $trimmedHeader);
        $parsed = [];
        foreach ($parts as $part) {
            $kv = explode('=', trim($part), 2);
            if (count($kv) === 2) {
                $parsed[trim($kv[0])] = trim($kv[1]);
            }
        }

        $timestamp = $parsed['t'] ?? null;
        $testSig = $parsed['te'] ?? null;
        $liveSig = $parsed['li'] ?? null;

        if ($timestamp !== null) {
            $timePayload = $timestamp . '.' . $rawBody;
            $computedTimeHash = hash_hmac('sha256', $timePayload, $secret);

            if ($testSig !== null && hash_equals($computedTimeHash, $testSig)) {
                return true;
            }
            if ($liveSig !== null && hash_equals($computedTimeHash, $liveSig)) {
                return true;
            }
        }

        // Direct check against parsed te or li
        if ($testSig !== null && hash_equals($directHash, $testSig)) {
            return true;
        }
        if ($liveSig !== null && hash_equals($directHash, $liveSig)) {
            return true;
        }

        return false;
    }
}
