<?php
require_once __DIR__ . '/../config/database.php';

class DecedentDocument {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    public function findByDecedentId($decedentId) {
        $stmt = $this->db->prepare("
            SELECT d.*, u.full_name AS uploaded_by_name
            FROM decedent_documents d
            LEFT JOIN users u ON d.uploaded_by = u.user_id
            WHERE d.decedent_id = ?
            ORDER BY d.created_at DESC
        ");
        $stmt->execute([(int) $decedentId]);
        return $stmt->fetchAll();
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT * FROM decedent_documents WHERE document_id = ?");
        $stmt->execute([(int) $id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $stmt = $this->db->prepare("
            INSERT INTO decedent_documents (decedent_id, document_type, original_filename, file_path, uploaded_by)
            VALUES (?, ?, ?, ?, ?)
        ");
        $success = $stmt->execute([
            (int) $data['decedent_id'],
            $data['document_type'],
            $data['original_filename'],
            $data['file_path'],
            $data['uploaded_by'] ?? null,
        ]);
        return $success ? (int) $this->db->lastInsertId() : false;
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM decedent_documents WHERE document_id = ?");
        return $stmt->execute([(int) $id]);
    }
}
