<?php
require_once __DIR__ . '/../config/database.php';

class Section {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    public function findAll() {
        $stmt = $this->db->query("SELECT * FROM sections ORDER BY section_name");
        return $stmt->fetchAll();
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT * FROM sections WHERE section_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $stmt = $this->db->prepare("INSERT INTO sections (section_name, description) VALUES (?, ?)");
        return $stmt->execute([$data['section_name'], $data['description'] ?? '']);
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare("UPDATE sections SET section_name = ?, description = ? WHERE section_id = ?");
        return $stmt->execute([$data['section_name'], $data['description'] ?? '', $id]);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM sections WHERE section_id = ?");
        return $stmt->execute([$id]);
    }

    public function updateCounts($sectionId) {
        $stmt = $this->db->prepare(" 
            UPDATE sections s
            SET total_blocks = (SELECT COUNT(*) FROM blocks WHERE section_id = s.section_id),
                total_lots = (SELECT COUNT(l.lot_id) FROM blocks b JOIN lots l ON b.block_id = l.block_id WHERE b.section_id = s.section_id)
            WHERE s.section_id = ?
        ");
        return $stmt->execute([$sectionId]);
    }
}
