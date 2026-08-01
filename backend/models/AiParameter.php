<?php
require_once __DIR__ . '/../config/database.php';

class AiParameter {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    public function findAll($module = null) {
        $sql = "SELECT * FROM ai_parameters WHERE 1=1";
        $params = [];
        if ($module) {
            $sql .= " AND module = ?";
            $params[] = $module;
        }
        $sql .= " ORDER BY module, param_name";
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function findById($id) {
        $stmt = $this->db->prepare("SELECT * FROM ai_parameters WHERE parameter_id = ?");
        $stmt->execute([$id]);
        return $stmt->fetch();
    }

    public function findByModule($module) {
        $stmt = $this->db->prepare("SELECT * FROM ai_parameters WHERE module = ? ORDER BY param_name");
        $stmt->execute([$module]);
        return $stmt->fetchAll();
    }

    public function update($id, $data) {
        $stmt = $this->db->prepare("UPDATE ai_parameters SET param_value = ?, param_type = ?, description = ? WHERE parameter_id = ?");
        return $stmt->execute([
            $data['param_value'],
            $data['param_type'] ?? 'string',
            $data['description'] ?? null,
            $id,
        ]);
    }

    public function create($data) {
        $stmt = $this->db->prepare("INSERT INTO ai_parameters (module, param_name, param_value, param_type, description) VALUES (?, ?, ?, ?, ?)");
        return $stmt->execute([
            $data['module'],
            $data['param_name'],
            $data['param_value'],
            $data['param_type'] ?? 'string',
            $data['description'] ?? null,
        ]);
    }
}
