<?php
/**
 * BookingDocumentService
 * 
 * Authoritative domain service for booking document requirements and verification (Batch 7).
 * Consolidates documentary requirements across:
 * - Booking Assistant (online intake)
 * - Booking Finalization Flow
 * - Staff Verification (Manage Bookings)
 * - Payment & Confirmation Automation
 * 
 * Enforces the municipal Hybrid Workflow:
 * Online document submission is encouraged and supported. If documents are not uploaded online,
 * the booking commits to Pending, and physical originals (Death Certificate & LGU Permit)
 * are presented to cemetery administration for physical inspection prior to service completion.
 */

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../controllers/DecedentDocumentController.php';
require_once __DIR__ . '/../models/AuditLog.php';

class BookingDocumentService {
    private PDO $db;
    private AuditLog $auditLogModel;

    public const CANONICAL_DOC_TYPES = ['death_certificate', 'burial_permit', 'valid_id'];

    public function __construct(?PDO $db = null, ?AuditLog $auditLogModel = null) {
        $this->db = $db ?? Database::getInstance()->getConnection();
        $this->auditLogModel = $auditLogModel ?? new AuditLog();
    }

    private static function actorId($actor): ?int {
        return is_array($actor) ? (isset($actor['user_id']) ? (int) $actor['user_id'] : null) : (is_numeric($actor) ? (int) $actor : null);
    }

    private static function actorUsername($actor): ?string {
        return is_array($actor) ? ($actor['username'] ?? null) : null;
    }

    /**
     * Resolves the canonical browser-accessible URL for an uploaded file path.
     */
    public static function normalizeFileUrl(?string $path): ?string {
        if (!$path || trim($path) === '') {
            return null;
        }

        $trimmed = trim($path);
        if (preg_match('#^https?://#i', $trimmed)) {
            return $trimmed;
        }

        $scriptName = str_replace('\\', '/', $_SERVER['SCRIPT_NAME'] ?? '/backend/api/index.php');
        $requestUri = str_replace('\\', '/', $_SERVER['REQUEST_URI'] ?? '');
        $base = (strpos($scriptName, '/CMS/') !== false || strpos($requestUri, '/CMS/') !== false) ? '/CMS' : '';

        // If file_path is stored like ./uploads/decedent-documents/...
        if (preg_match('#\./uploads/(.+)#', $trimmed, $m)) {
            return $base . '/backend/uploads/' . $m[1];
        }

        if (strpos($trimmed, '/uploads/') === 0) {
            return $base . '/backend' . $trimmed;
        }

        if (strpos($trimmed, '/backend/uploads/') === 0) {
            return $base . $trimmed;
        }

        if (strpos($trimmed, '/CMS/backend/uploads/') === 0) {
            return $trimmed;
        }

        return $base . '/backend/uploads/decedent-documents/' . basename($trimmed);
    }

    /**
     * Resolve the document requirements status for a booking.
     * Checks booking drafts, decedent requests, and decedent records.
     *
     * @param string     $serviceType 'burial' or 'cremation'
     * @param int        $bookingId   schedule_id or cremation_id
     * @param array|null $booking     optional raw booking record
     * @return array Standardized documentary requirements payload
     */
    public function resolveDocuments(string $serviceType, int $bookingId, ?array $booking = null): array {
        $serviceType = strtolower(trim($serviceType));
        if (!in_array($serviceType, ['burial', 'cremation'], true)) {
            $serviceType = 'burial';
        }

        if ($booking === null) {
            $table = $serviceType === 'burial' ? 'burial_schedules' : 'cremation_records';
            $pk = $serviceType === 'burial' ? 'schedule_id' : 'cremation_id';
            $stmt = $this->db->prepare("SELECT * FROM {$table} WHERE {$pk} = ?");
            $stmt->execute([$bookingId]);
            $booking = $stmt->fetch(PDO::FETCH_ASSOC) ?: [];
        }

        $isCremation = ($serviceType === 'cremation');

        // 1. Gather draft documents from booking_drafts if linked
        $draftDocs = [];
        $draftStmt = $this->db->prepare("
            SELECT draft_id, extracted_data 
            FROM booking_drafts 
            WHERE committed_record_id = ? AND committed_record_type = ? 
            ORDER BY draft_id DESC LIMIT 1
        ");
        $draftStmt->execute([$bookingId, $serviceType]);
        $draftRow = $draftStmt->fetch(PDO::FETCH_ASSOC);
        if ($draftRow && !empty($draftRow['extracted_data'])) {
            $extracted = is_array($draftRow['extracted_data']) 
                ? $draftRow['extracted_data'] 
                : json_decode($draftRow['extracted_data'], true);
            if (is_array($extracted) && !empty($extracted['documents']) && is_array($extracted['documents'])) {
                $draftDocs = $extracted['documents'];
            }
        }

        // 2. Gather provisional request attachment if present
        $reqDoc = null;
        if (!empty($booking['decedent_request_id'])) {
            $reqStmt = $this->db->prepare("
                SELECT attachment_path, attachment_original_filename 
                FROM decedent_requests 
                WHERE request_id = ?
            ");
            $reqStmt->execute([(int) $booking['decedent_request_id']]);
            $reqDoc = $reqStmt->fetch(PDO::FETCH_ASSOC);
        }

        // 3. Gather formal decedent records documents if present
        $decDocs = [];
        if (!empty($booking['deceased_id'])) {
            $decStmt = $this->db->prepare("
                SELECT document_id, document_type, original_filename, file_path, created_at 
                FROM decedent_documents 
                WHERE decedent_id = ?
            ");
            $decStmt->execute([(int) $booking['deceased_id']]);
            $decDocs = $decStmt->fetchAll(PDO::FETCH_ASSOC);
        }

        // Standardized Definitions for the 3 Canonical Requirements
        $definitions = [
            'death_certificate' => [
                'doc_type'          => 'death_certificate',
                'title'             => 'Death Certificate',
                'description'       => 'PSA or Local Civil Registrar Certified True Copy',
                'required'          => true,
                'is_uploaded'       => false,
                'file_path'         => null,
                'file_url'          => null,
                'original_filename' => null,
                'uploaded_at'       => null,
                'source'            => null,
                'status'            => 'pending_physical',
                'status_label'      => 'Pending Physical Presentation',
            ],
            'burial_permit' => [
                'doc_type'          => 'burial_permit',
                'title'             => $isCremation ? 'Cremation Permit' : 'Burial Permit',
                'description'       => 'City Health Office / Local Government Unit Permit',
                'required'          => true,
                'is_uploaded'       => false,
                'file_path'         => null,
                'file_url'          => null,
                'original_filename' => null,
                'uploaded_at'       => null,
                'source'            => null,
                'status'            => 'pending_physical',
                'status_label'      => 'Pending Physical Presentation',
            ],
            'valid_id' => [
                'doc_type'          => 'valid_id',
                'title'             => 'Valid Government ID',
                'description'       => 'Government-issued ID of Informant / Next-of-Kin (Claimant)',
                'required'          => true,
                'is_uploaded'       => false,
                'file_path'         => null,
                'file_url'          => null,
                'original_filename' => null,
                'uploaded_at'       => null,
                'source'            => null,
                'status'            => 'pending_physical',
                'status_label'      => 'Pending Physical Presentation',
            ],
        ];

        // Match death_certificate from draft
        if (!empty($draftDocs['death_certificate']['file_path'])) {
            $definitions['death_certificate']['is_uploaded'] = true;
            $definitions['death_certificate']['file_path'] = $draftDocs['death_certificate']['file_path'];
            $definitions['death_certificate']['file_url'] = self::normalizeFileUrl($draftDocs['death_certificate']['file_path']);
            $definitions['death_certificate']['original_filename'] = $draftDocs['death_certificate']['original_filename'] ?? 'Death_Certificate.pdf';
            $definitions['death_certificate']['uploaded_at'] = $draftDocs['death_certificate']['uploaded_at'] ?? null;
            $definitions['death_certificate']['source'] = 'booking_draft';
            $definitions['death_certificate']['status'] = 'uploaded';
            $definitions['death_certificate']['status_label'] = 'Uploaded Online';
        } elseif (!empty($reqDoc['attachment_path'])) {
            // Match from provisional decedent request attachment
            $definitions['death_certificate']['is_uploaded'] = true;
            $definitions['death_certificate']['file_path'] = $reqDoc['attachment_path'];
            $definitions['death_certificate']['file_url'] = self::normalizeFileUrl($reqDoc['attachment_path']);
            $definitions['death_certificate']['original_filename'] = $reqDoc['attachment_original_filename'] ?? 'Death_Certificate.pdf';
            $definitions['death_certificate']['source'] = 'decedent_request';
            $definitions['death_certificate']['status'] = 'uploaded';
            $definitions['death_certificate']['status_label'] = 'Uploaded Online';
        }

        // Match burial_permit from draft
        if (!empty($draftDocs['burial_permit']['file_path'])) {
            $definitions['burial_permit']['is_uploaded'] = true;
            $definitions['burial_permit']['file_path'] = $draftDocs['burial_permit']['file_path'];
            $definitions['burial_permit']['file_url'] = self::normalizeFileUrl($draftDocs['burial_permit']['file_path']);
            $definitions['burial_permit']['original_filename'] = $draftDocs['burial_permit']['original_filename'] ?? ($isCremation ? 'Cremation_Permit.pdf' : 'Burial_Permit.pdf');
            $definitions['burial_permit']['uploaded_at'] = $draftDocs['burial_permit']['uploaded_at'] ?? null;
            $definitions['burial_permit']['source'] = 'booking_draft';
            $definitions['burial_permit']['status'] = 'uploaded';
            $definitions['burial_permit']['status_label'] = 'Uploaded Online';
        }

        // Match valid_id from draft
        if (!empty($draftDocs['valid_id']['file_path'])) {
            $definitions['valid_id']['is_uploaded'] = true;
            $definitions['valid_id']['file_path'] = $draftDocs['valid_id']['file_path'];
            $definitions['valid_id']['file_url'] = self::normalizeFileUrl($draftDocs['valid_id']['file_path']);
            $definitions['valid_id']['original_filename'] = $draftDocs['valid_id']['original_filename'] ?? 'Valid_ID.pdf';
            $definitions['valid_id']['uploaded_at'] = $draftDocs['valid_id']['uploaded_at'] ?? null;
            $definitions['valid_id']['source'] = 'booking_draft';
            $definitions['valid_id']['status'] = 'uploaded';
            $definitions['valid_id']['status_label'] = 'Uploaded Online';
        }

        // Inspect formal decedent_documents if any match
        foreach ($decDocs as $doc) {
            $dtype = $doc['document_type'];
            if ($dtype === 'death_certificate' && !$definitions['death_certificate']['is_uploaded']) {
                $definitions['death_certificate']['is_uploaded'] = true;
                $definitions['death_certificate']['file_path'] = $doc['file_path'];
                $definitions['death_certificate']['file_url'] = self::normalizeFileUrl($doc['file_path']);
                $definitions['death_certificate']['original_filename'] = $doc['original_filename'];
                $definitions['death_certificate']['uploaded_at'] = $doc['created_at'];
                $definitions['death_certificate']['source'] = 'decedent_record';
                $definitions['death_certificate']['status'] = 'uploaded';
                $definitions['death_certificate']['status_label'] = 'On File (Decedent Record)';
            } elseif ($dtype === 'burial_permit' && !$definitions['burial_permit']['is_uploaded']) {
                $definitions['burial_permit']['is_uploaded'] = true;
                $definitions['burial_permit']['file_path'] = $doc['file_path'];
                $definitions['burial_permit']['file_url'] = self::normalizeFileUrl($doc['file_path']);
                $definitions['burial_permit']['original_filename'] = $doc['original_filename'];
                $definitions['burial_permit']['uploaded_at'] = $doc['created_at'];
                $definitions['burial_permit']['source'] = 'decedent_record';
                $definitions['burial_permit']['status'] = 'uploaded';
                $definitions['burial_permit']['status_label'] = 'On File (Decedent Record)';
            }
        }

        // Compute compliance summary
        $uploadedCount = 0;
        foreach ($definitions as $d) {
            if ($d['is_uploaded']) {
                $uploadedCount++;
            }
        }

        $allUploaded = ($uploadedCount === 3);
        $statusKey = $allUploaded ? 'complete' : ($uploadedCount > 0 ? 'partial' : 'pending_physical');
        $statusLabel = $allUploaded 
            ? 'Complete (3/3 Uploaded)' 
            : ($uploadedCount > 0 ? "Partial ({$uploadedCount}/3 Uploaded)" : 'Pending Physical Submission');
        $badgeClass = $allUploaded ? 'complete' : ($uploadedCount > 0 ? 'partial' : 'pending');

        $guidance = $allUploaded
            ? 'All required documents have been submitted online. Staff will verify authenticity before service execution.'
            : ($uploadedCount > 0
                ? 'Some documents were uploaded online. The applicant must present the remaining physical documents (original certificates) at the cemetery office.'
                : 'No documents submitted online yet. Per municipal cemetery policy, applicant must present physical copies of Death Certificate and Permit at the office prior to burial/cremation.');

        return [
            'booking_id'        => $bookingId,
            'service_type'      => $serviceType,
            'documents'         => array_values($definitions),
            'documents_map'     => $definitions,
            'summary'           => [
                'uploaded_count'    => $uploadedCount,
                'total_required'    => 3,
                'all_uploaded'      => $allUploaded,
                'status'            => $statusKey,
                'status_label'      => $statusLabel,
                'badge_class'       => $badgeClass,
                'workflow_guidance' => $guidance,
            ]
        ];
    }

    /**
     * Upload and attach a required document directly to a booking (Staff review / Citizen update).
     *
     * @param string $serviceType 'burial' or 'cremation'
     * @param int    $bookingId   schedule_id or cremation_id
     * @param array  $file        $_FILES entry
     * @param string $docType     in self::CANONICAL_DOC_TYPES
     * @param mixed  $actor       authenticated user context
     * @return array Standardized outcome
     */
    public function uploadBookingDocument(string $serviceType, int $bookingId, array $file, string $docType, $actor): array {
        $serviceType = strtolower(trim($serviceType));
        if (!in_array($serviceType, ['burial', 'cremation'], true)) {
            return ['error' => "Invalid service type '{$serviceType}'. Must be 'burial' or 'cremation'", 'code' => 400];
        }

        $docType = strtolower(trim($docType));
        if (!in_array($docType, self::CANONICAL_DOC_TYPES, true)) {
            return ['error' => "Invalid document type '{$docType}'. Allowed: " . implode(', ', self::CANONICAL_DOC_TYPES), 'code' => 400];
        }

        $table = $serviceType === 'burial' ? 'burial_schedules' : 'cremation_records';
        $pk = $serviceType === 'burial' ? 'schedule_id' : 'cremation_id';
        $stmt = $this->db->prepare("SELECT * FROM {$table} WHERE {$pk} = ?");
        $stmt->execute([$bookingId]);
        $booking = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$booking) {
            return ['error' => 'Booking not found', 'code' => 404];
        }

        $actorId = self::actorId($actor);
        $actorUsername = self::actorUsername($actor);
        $role = strtolower(is_array($actor) ? ($actor['role'] ?? 'user') : 'user');

        // Non-staff callers can only attach to their own booking
        if (!in_array($role, ['admin', 'staff'], true) && (int) $booking['created_by'] !== (int) $actorId) {
            return ['error' => 'You may only upload documents to your own booking', 'code' => 403];
        }

        // Save physical file via DecedentDocumentController validation
        $saved = DecedentDocumentController::saveUploadedFile($file);
        if (isset($saved['error'])) {
            return $saved;
        }

        $filePath = $saved['file_path'];
        $originalFilename = $saved['original_filename'];

        // 1. If formal decedent exists, record in decedent_documents
        if (!empty($booking['deceased_id'])) {
            require_once __DIR__ . '/../models/DecedentDocument.php';
            $docModel = new DecedentDocument();
            $mappedType = ($docType === 'valid_id') ? 'other' : $docType;
            $docModel->create([
                'decedent_id'       => (int) $booking['deceased_id'],
                'document_type'     => $mappedType,
                'original_filename' => $originalFilename,
                'file_path'         => $filePath,
                'uploaded_by'       => $actorId,
            ]);
        }

        // 2. If provisional decedent request exists and docType is death_certificate, update request attachment
        if (!empty($booking['decedent_request_id']) && $docType === 'death_certificate') {
            require_once __DIR__ . '/../models/DecedentRequest.php';
            $reqModel = new DecedentRequest();
            $reqModel->setAttachment((int) $booking['decedent_request_id'], $filePath, $originalFilename);
        }

        // 3. If a committed booking_draft exists, update extracted_data documents
        $draftStmt = $this->db->prepare("
            SELECT draft_id, extracted_data 
            FROM booking_drafts 
            WHERE committed_record_id = ? AND committed_record_type = ? 
            ORDER BY draft_id DESC LIMIT 1
        ");
        $draftStmt->execute([$bookingId, $serviceType]);
        $draft = $draftStmt->fetch(PDO::FETCH_ASSOC);

        if ($draft) {
            $extracted = is_array($draft['extracted_data']) 
                ? $draft['extracted_data'] 
                : json_decode($draft['extracted_data'], true);
            if (!is_array($extracted)) {
                $extracted = [];
            }
            if (!isset($extracted['documents']) || !is_array($extracted['documents'])) {
                $extracted['documents'] = [];
            }
            $extracted['documents'][$docType] = [
                'doc_type'          => $docType,
                'file_path'         => $filePath,
                'original_filename' => $originalFilename,
                'uploaded_at'       => date('Y-m-d H:i:s'),
                'uploaded_by'       => $actorId,
            ];
            $upStmt = $this->db->prepare("UPDATE booking_drafts SET extracted_data = ? WHERE draft_id = ?");
            $upStmt->execute([json_encode($extracted), $draft['draft_id']]);
        }

        // 4. Audit Log Entry
        $this->auditLogModel->log(
            'Booking document uploaded',
            $actorId,
            $actorUsername,
            ($serviceType === 'burial' ? 'Schedule' : 'Cremation'),
            $bookingId,
            [
                'document_type'     => $docType,
                'original_filename' => $originalFilename,
                'file_path'         => $filePath,
                'role'              => $role,
            ]
        );

        $resolved = $this->resolveDocuments($serviceType, $bookingId, $booking);

        return [
            'success'           => true,
            'message'           => 'Document uploaded and attached to booking successfully',
            'document_type'     => $docType,
            'original_filename' => $originalFilename,
            'file_url'          => self::normalizeFileUrl($filePath),
            'requirements'      => $resolved,
            'code'              => 200,
        ];
    }
}
