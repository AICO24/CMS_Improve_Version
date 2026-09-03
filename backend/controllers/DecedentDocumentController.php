<?php
require_once __DIR__ . '/../models/DecedentDocument.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/AuditLog.php';

// Decedent Records module audit, Batch K1 — document/certificate upload
// (death certificate, burial permit, etc.), UPLOAD ONLY for now. A later
// batch (K2) may add AI-assisted field extraction from an uploaded image —
// that would only ever pre-fill the Add/Edit form as a draft for staff to
// review, never write here or to decedent_records directly. This controller
// has no AI dependency at all.
class DecedentDocumentController {
    private $documentModel;
    private $decedentModel;
    private $auditLogModel;

    private const ALLOWED_TYPES = ['death_certificate', 'burial_permit', 'other'];
    // Mirrors PaymentController::saveReceiptFile()'s exact allowlist —
    // detected from the file's real bytes, never the client-supplied
    // Content-Type/extension.
    private const EXTENSIONS_BY_MIME = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'application/pdf' => 'pdf',
    ];
    // A scanned certificate is a small document; this is generous enough
    // for a high-resolution scan while still ruling out something absurd.
    private const MAX_FILE_BYTES = 10 * 1024 * 1024;

    public function __construct() {
        $this->documentModel = new DecedentDocument();
        $this->decedentModel = new Decedent();
        $this->auditLogModel = new AuditLog();
    }

    private static function actorId($actor) {
        return is_array($actor) ? ($actor['user_id'] ?? null) : $actor;
    }

    private static function actorUsername($actor) {
        return is_array($actor) ? ($actor['username'] ?? null) : null;
    }

    public function index($decedentId) {
        if (!$this->decedentModel->findById($decedentId)) {
            return ['error' => 'Decedent record not found', 'code' => 404];
        }
        return $this->documentModel->findByDecedentId($decedentId);
    }

    // Decedent Records module audit, Batch L1: split out of store() below so
    // DecedentRequestController's citizen-facing attachment upload (a file
    // has to land somewhere before any decedent_id exists to hang a
    // decedent_documents row off of — see that controller's own comment)
    // can reuse the exact same validation and on-disk save logic, instead
    // of a second, drifting copy of it. Returns
    // ['file_path' => ..., 'original_filename' => ...] on success, or
    // ['error' => ..., 'code' => ...] on failure — never throws.
    public static function saveUploadedFile($file) {
        if (empty($file['tmp_name']) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            return ['error' => 'No valid file was uploaded', 'code' => 400];
        }
        if (($file['size'] ?? 0) > self::MAX_FILE_BYTES) {
            return ['error' => 'File is too large (10MB limit)', 'code' => 400];
        }

        $finfo = finfo_open(FILEINFO_MIME_TYPE);
        $detectedType = $finfo ? finfo_file($finfo, $file['tmp_name']) : false;
        if ($finfo) {
            finfo_close($finfo);
        }
        if (!$detectedType || !isset(self::EXTENSIONS_BY_MIME[$detectedType])) {
            return ['error' => 'Only JPG, PNG, or PDF files are allowed', 'code' => 400];
        }

        $uploadDir = __DIR__ . '/../uploads/decedent-documents';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        $extension = self::EXTENSIONS_BY_MIME[$detectedType];
        $filename = 'decedent_doc_' . time() . '_' . bin2hex(random_bytes(5)) . '.' . $extension;
        $destination = $uploadDir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            return ['error' => 'Failed to save the uploaded file', 'code' => 500];
        }

        // Same absolute, origin-relative URL convention as
        // PaymentController::saveReceiptFile() — resolves correctly
        // regardless of which frontend page renders it, and points at
        // uploads/ as a sibling of api/ (anything under backend/api/ is
        // unconditionally rewritten to api/index.php by backend/.htaccess
        // and could never be served as a static file).
        $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/backend/api/index.php');
        $backendRoot = rtrim(dirname(dirname($scriptName)), '/');
        $filePath = $backendRoot . '/uploads/decedent-documents/' . $filename;

        $originalFilename = is_string($file['name'] ?? null) ? basename($file['name']) : $filename;

        return ['file_path' => $filePath, 'original_filename' => $originalFilename];
    }

    public function store($decedentId, $file, $documentType, $actor = null) {
        $decedent = $this->decedentModel->findById($decedentId);
        if (!$decedent) {
            return ['error' => 'Decedent record not found', 'code' => 404];
        }

        $documentType = in_array($documentType, self::ALLOWED_TYPES, true) ? $documentType : 'other';

        $saved = self::saveUploadedFile($file);
        if (isset($saved['error'])) {
            return $saved;
        }

        return $this->attachExistingFile($decedentId, $saved['file_path'], $saved['original_filename'], $documentType, $actor, 'Decedent document uploaded');
    }

    // Decedent Records module audit, Batch L1: records a decedent_documents
    // row for a file that's ALREADY been validated and saved to disk —
    // shared by store() above (which just did that itself) and, later,
    // DecedentRequestController::approve() (finalizing a citizen's
    // decedent_requests-stage attachment onto the real decedent_id that
    // only exists once staff formalizes the record — that file was
    // originally saved via this same saveUploadedFile(), at request time).
    // Never touches the filesystem itself, only the database.
    public function attachExistingFile($decedentId, $filePath, $originalFilename, $documentType, $actor = null, $auditAction = 'Decedent document uploaded') {
        $documentType = in_array($documentType, self::ALLOWED_TYPES, true) ? $documentType : 'other';

        $result = $this->documentModel->create([
            'decedent_id' => $decedentId,
            'document_type' => $documentType,
            'original_filename' => $originalFilename,
            'file_path' => $filePath,
            'uploaded_by' => self::actorId($actor),
        ]);

        if ($result) {
            $this->auditLogModel->log(
                $auditAction,
                self::actorId($actor),
                self::actorUsername($actor),
                'Decedent',
                $decedentId,
                ['document_type' => $documentType, 'original_filename' => $originalFilename]
            );
            return ['success' => true, 'message' => 'Document uploaded', 'document_id' => $result];
        }

        self::deleteUploadedFile($filePath);
        return ['error' => 'Failed to record the uploaded document', 'code' => 500];
    }

    // Decedent Records module audit, Batch L1: shared with
    // DecedentRequestController's citizen-attachment cleanup (a rejected
    // request's file is never needed again either) — best-effort, since
    // whatever DB row was the source of truth is already gone/updated
    // either way by the time a caller reaches this; a leftover orphan file
    // on disk is a cleanup nuisance, not a correctness problem.
    public static function deleteUploadedFile($filePath) {
        if (empty($filePath)) {
            return;
        }
        $relativePath = parse_url($filePath, PHP_URL_PATH) ?: $filePath;
        $diskPath = __DIR__ . '/../uploads/decedent-documents/' . basename($relativePath);
        @unlink($diskPath);
    }

    public function destroy($documentId, $actor = null) {
        $document = $this->documentModel->findById($documentId);
        if (!$document) {
            return ['error' => 'Document not found', 'code' => 404];
        }

        $result = $this->documentModel->delete($documentId);
        if ($result) {
            self::deleteUploadedFile($document['file_path']);

            $this->auditLogModel->log(
                'Decedent document deleted',
                self::actorId($actor),
                self::actorUsername($actor),
                'Decedent',
                $document['decedent_id'],
                ['document_type' => $document['document_type'], 'original_filename' => $document['original_filename']]
            );
            return ['success' => true, 'message' => 'Document deleted'];
        }
        return ['error' => 'Failed to delete document', 'code' => 500];
    }
}
