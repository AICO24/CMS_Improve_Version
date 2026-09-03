<?php
require_once __DIR__ . '/../config/database.php';

class DecedentRequest {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    // linked_schedule_id/linked_schedule_status: whether a citizen already
    // booked (and possibly paid for) this request before staff formalized
    // it — see ScheduleController::store()'s provisional-decedent path.
    // Lets Decedent Records' Pending Requests card prioritize requests tied
    // to an already-paid booking over a bare, unbooked request.
    //
    // requested_by_contact_number (Batch G, auto-fill from citizen account):
    // the requester is the family's own point of contact for the deceased
    // they're registering — decedent-records.js's approveRequest() pre-fills
    // the Add Decedent form's contact_name from requested_by_name (already
    // selected above) and contact_number from this, so staff doesn't retype
    // information already on file for that account. Still just a pre-fill —
    // both fields stay fully editable before save.
    public function findAll($status = null) {
        $sql = "
            SELECT r.*, u.full_name AS requested_by_name, u.contact_number AS requested_by_contact_number,
                   s.schedule_id AS linked_schedule_id, s.status AS linked_schedule_status
            FROM decedent_requests r
            LEFT JOIN users u ON r.requested_by = u.user_id
            LEFT JOIN burial_schedules s ON s.decedent_request_id = r.request_id
            WHERE 1=1
        ";
        $params = [];
        if ($status) {
            $sql .= " AND r.status = ?";
            $params[] = $status;
        }
        $sql .= " ORDER BY r.created_at DESC";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function findByUser($userId) {
        $stmt = $this->db->prepare("SELECT * FROM decedent_requests WHERE requested_by = ? ORDER BY created_at DESC");
        $stmt->execute([$userId]);
        return $stmt->fetchAll();
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT * FROM decedent_requests WHERE request_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $stmt = $this->db->prepare("
            INSERT INTO decedent_requests (requested_by, full_name, approximate_dod, relationship, notes)
            VALUES (?, ?, ?, ?, ?)
        ");
        $success = $stmt->execute([
            $data['requested_by'],
            $data['full_name'],
            $data['approximate_dod'] ?? null,
            $data['relationship'] ?? null,
            $data['notes'] ?? null,
        ]);
        return $success ? (int) $this->db->lastInsertId() : false;
    }

    // Decedent Records module audit, Batch L1: lets a citizen attach a
    // death certificate/burial permit to their OWN pending request before
    // any decedent_records row (and therefore any decedent_id a
    // decedent_documents row could reference) exists — see
    // DecedentRequestController::uploadAttachment()'s own comment for the
    // full lifecycle (moved into decedent_documents on approve(), deleted
    // on reject()).
    public function setAttachment($id, $filePath, $originalFilename) {
        $stmt = $this->db->prepare("
            UPDATE decedent_requests SET attachment_path = ?, attachment_original_filename = ?
            WHERE request_id = ?
        ");
        return $stmt->execute([$filePath, $originalFilename, $id]);
    }

    public function clearAttachment($id) {
        $stmt = $this->db->prepare("
            UPDATE decedent_requests SET attachment_path = NULL, attachment_original_filename = NULL
            WHERE request_id = ?
        ");
        return $stmt->execute([$id]);
    }

    public function approve($id, $decedentId, $reviewedBy) {
        $stmt = $this->db->prepare("
            UPDATE decedent_requests
            SET status = 'approved', decedent_id = ?, reviewed_by = ?, reviewed_at = NOW()
            WHERE request_id = ?
        ");
        return $stmt->execute([$decedentId, $reviewedBy, $id]);
    }

    public function reject($id, $reason, $reviewedBy) {
        $stmt = $this->db->prepare("
            UPDATE decedent_requests
            SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = NOW()
            WHERE request_id = ?
        ");
        return $stmt->execute([$reason, $reviewedBy, $id]);
    }

    // Records which status the citizen was actually shown, so the chat
    // assistant's status line only reappears when status changes again
    // (approve()/reject() above never touch this column themselves) instead
    // of on every single chat load forever.
    public function markNotified($id, $status) {
        $stmt = $this->db->prepare("UPDATE decedent_requests SET last_notified_status = ? WHERE request_id = ?");
        return $stmt->execute([$status, $id]);
    }
}
