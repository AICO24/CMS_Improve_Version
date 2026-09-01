<?php
require_once __DIR__ . '/../config/database.php';

class Block {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    public function findBySection($sectionId) {
        $stmt = $this->db->prepare("SELECT * FROM blocks WHERE section_id = ? ORDER BY block_name");
        $stmt->execute([$sectionId]);
        return $stmt->fetchAll();
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT * FROM blocks WHERE block_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $stmt = $this->db->prepare("INSERT INTO blocks (section_id, block_name, description) VALUES (?, ?, ?)");
        $success = $stmt->execute([$data['section_id'], $data['block_name'], $data['description'] ?? '']);
        return $success ? (int) $this->db->lastInsertId() : false;
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare("UPDATE blocks SET block_name = ?, description = ? WHERE block_id = ?");
        return $stmt->execute([$data['block_name'], $data['description'] ?? '', $id]);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM blocks WHERE block_id = ?");
        return $stmt->execute([$id]);
    }

    // L3.3: total_lots existed in schema.sql but no code path ever wrote it
    // (a dead column). Mirrors Section::updateCounts()'s pattern, scoped to
    // one block — called by LotController wherever a lot is created, moved
    // between blocks, or deleted.
    public function updateLotCount($blockId) {
        $stmt = $this->db->prepare("
            UPDATE blocks SET total_lots = (SELECT COUNT(*) FROM lots WHERE block_id = ?)
            WHERE block_id = ?
        ");
        return $stmt->execute([$blockId, $blockId]);
    }
}
