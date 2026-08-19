<?php
require_once __DIR__ . '/../config/database.php';

class AiKnowledge {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    public function findAll() {
        $stmt = $this->db->prepare("SELECT * FROM ai_knowledge ORDER BY topic");
        $stmt->execute();
        return $stmt->fetchAll();
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT * FROM ai_knowledge WHERE knowledge_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function create($data) {
        $stmt = $this->db->prepare("INSERT INTO ai_knowledge (topic, content) VALUES (?, ?)");
        return $stmt->execute([
            $data['topic'],
            $data['content'],
        ]);
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare("UPDATE ai_knowledge SET topic = ?, content = ? WHERE knowledge_id = ?");
        return $stmt->execute([
            $data['topic'],
            $data['content'],
            $id,
        ]);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM ai_knowledge WHERE knowledge_id = ?");
        return $stmt->execute([$id]);
    }
}
