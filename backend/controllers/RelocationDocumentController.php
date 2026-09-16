<?php
require_once __DIR__ . '/../models/RelocationDocument.php';
require_once __DIR__ . '/../models/Relocation.php';
require_once __DIR__ . '/../models/AuditLog.php';

class RelocationDocumentController {
    private $documentModel;
    private $relocationModel;
    private $auditLogModel;

    private const ALLOWED_TYPES = ['exhumation_permit', 'transfer_clearance', 'family_consent', 'other'];
    private const EXTENSIONS_BY_MIME = [
        'image/jpeg' => 'jpg',
        'image/png' => 'png',
        'application/pdf' => 'pdf',
    ];
    private const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10MB

    public function __construct() {
        $this->documentModel = new RelocationDocument();
        $this->relocationModel = new Relocation();
        $this->auditLogModel = new AuditLog();
    }

    private static function actorId($actor) {
        return is_array($actor) ? ($actor['user_id'] ?? null) : $actor;
    }

    private static function actorUsername($actor) {
        return is_array($actor) ? ($actor['username'] ?? null) : null;
    }

    public function index($requestId) {
        if (!$this->relocationModel->findById($requestId)) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        return $this->documentModel->findByRequestId($requestId);
    }

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

        $uploadDir = __DIR__ . '/../uploads/relocation-documents';
        if (!is_dir($uploadDir)) {
            mkdir($uploadDir, 0755, true);
        }

        $extension = self::EXTENSIONS_BY_MIME[$detectedType];
        $filename = 'reloc_doc_' . time() . '_' . bin2hex(random_bytes(5)) . '.' . $extension;
        $destination = $uploadDir . '/' . $filename;

        if (!move_uploaded_file($file['tmp_name'], $destination)) {
            return ['error' => 'Failed to save the uploaded file', 'code' => 500];
        }

        $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/backend/api/index.php');
        $backendRoot = rtrim(dirname(dirname($scriptName)), '/');
        $filePath = $backendRoot . '/uploads/relocation-documents/' . $filename;

        $originalFilename = is_string($file['name'] ?? null) ? basename($file['name']) : $filename;

        return ['file_path' => $filePath, 'original_filename' => $originalFilename];
    }

    public function store($requestId, $file, $documentType, $actor = null) {
        $request = $this->relocationModel->findById($requestId);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }

        $documentType = in_array($documentType, self::ALLOWED_TYPES, true) ? $documentType : 'other';

        $saved = self::saveUploadedFile($file);
        if (isset($saved['error'])) {
            return $saved;
        }

        return $this->attachExistingFile($requestId, $saved['file_path'], $saved['original_filename'], $documentType, $actor, 'Relocation document uploaded');
    }

    public function attachExistingFile($requestId, $filePath, $originalFilename, $documentType, $actor = null, $auditAction = 'Relocation document uploaded') {
        $documentType = in_array($documentType, self::ALLOWED_TYPES, true) ? $documentType : 'other';

        $result = $this->documentModel->create([
            'request_id' => $requestId,
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
                'Relocation',
                $requestId,
                ['document_type' => $documentType, 'original_filename' => $originalFilename]
            );
            return ['success' => true, 'message' => 'Document uploaded', 'document_id' => $result];
        }

        self::deleteUploadedFile($filePath);
        return ['error' => 'Failed to record the uploaded document', 'code' => 500];
    }

    public static function deleteUploadedFile($filePath) {
        if (empty($filePath)) {
            return;
        }
        $relativePath = parse_url($filePath, PHP_URL_PATH) ?: $filePath;
        $diskPath = __DIR__ . '/../uploads/relocation-documents/' . basename($relativePath);
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
                'Relocation document deleted',
                self::actorId($actor),
                self::actorUsername($actor),
                'Relocation',
                $document['request_id'],
                ['document_type' => $document['document_type'], 'original_filename' => $document['original_filename']]
            );
            return ['success' => true, 'message' => 'Document deleted'];
        }
        return ['error' => 'Failed to delete document', 'code' => 500];
    }
}
