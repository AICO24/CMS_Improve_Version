<?php
require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../models/AuditLog.php';

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
        $required = ['transaction_type', 'amount', 'payment_date', 'payment_method', 'receipt_number'];
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
        $result = $this->paymentModel->create($data);
        if ($result) {
            $this->notifyPayment($data, $userId);
            return ['success' => true, 'message' => 'Payment recorded and pending verification'];
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
        return $result ? ['success' => true, 'message' => 'Payment updated'] : ['error' => 'Failed to update payment', 'code' => 500];
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

    public function destroy($id) {
        if (!$this->paymentModel->findById($id)) {
            return ['error' => 'Payment not found', 'code' => 404];
        }
        $result = $this->paymentModel->delete($id);
        return $result ? ['success' => true, 'message' => 'Payment deleted'] : ['error' => 'Failed to delete payment', 'code' => 500];
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
