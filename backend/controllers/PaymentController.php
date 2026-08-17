<?php
require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Lot.php';

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
        if ($transactionType !== 'Lot Purchase' || empty($referenceId)) {
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

        if (!$isStaffOrAdmin) {
            if ((int) $existing['received_by'] !== (int) $userId) {
                return ['error' => 'You may only update your own payments', 'code' => 403];
            }
            if ($existing['verification_status'] !== 'Pending') {
                return ['error' => 'Only pending payments may be updated', 'code' => 403];
            }
        }

        if (isset($data['amount']) && (!is_numeric($data['amount']) || (float) $data['amount'] <= 0)) {
            return ['error' => 'Amount must be a positive number', 'code' => 400];
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

        // Preserve who the payment belongs to unless a staff/admin explicitly reassigns it;
        // previously this always overwrote received_by with the editor's own id.
        $data['received_by'] = isset($data['received_by']) ? $data['received_by'] : $existing['received_by'];
        $result = $this->paymentModel->update($id, $data);

        if (!$result) {
            return ['error' => 'Failed to update payment', 'code' => 500];
        }

        // Same AuditLog mechanism/shape already used by verify() below — records
        // which fields actually changed, not a full before/after dump.
        $changedFields = [];
        foreach (['transaction_type', 'reference_id', 'amount', 'payment_date', 'payment_method', 'receipt_number', 'notes'] as $field) {
            if (isset($data[$field]) && (string) $data[$field] !== (string) ($existing[$field] ?? '')) {
                $changedFields[$field] = ['from' => $existing[$field] ?? null, 'to' => $data[$field]];
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

        $expected = $this->resolveExpectedAmount(
            $data['transaction_type'] ?? $existing['transaction_type'],
            $data['reference_id'] ?? $existing['reference_id']
        );
        $submittedAmount = isset($data['amount']) ? (float) $data['amount'] : (float) $existing['amount'];

        return [
            'success' => true,
            'message' => 'Payment updated',
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

        $result = $this->paymentModel->update($id, [
            'transaction_type' => $payment['transaction_type'],
            'reference_id' => $payment['reference_id'],
            'amount' => $payment['amount'],
            'payment_date' => $payment['payment_date'],
            'payment_method' => $payment['payment_method'],
            'receipt_number' => $payment['receipt_number'],
            'notes' => $payment['notes'],
            'received_by' => $payment['received_by'],
            'receipt_url' => $payment['receipt_url'],
            'verification_status' => $status,
            'verified_by' => $adminId,
            'verified_at' => date('Y-m-d H:i:s'),
        ]);

        if ($result) {
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
                $this->sendEmail($user['email'], 'Payment ' . $status, 'Your payment has been ' . strtolower($status) . '.');
            }

            return ['success' => true, 'message' => 'Payment ' . strtolower($status) . ' successfully'];
        }

        return ['error' => 'Failed to update payment verification status', 'code' => 500];
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
