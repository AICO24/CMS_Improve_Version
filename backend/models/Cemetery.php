<?php
require_once __DIR__ . '/../config/database.php';

class Cemetery {
    private PDO $db;

    public function __construct(?PDO $db = null) {
        $this->db = $db ?? Database::getInstance()->getConnection();
    }

    /**
     * Retrieve all active cemetery facilities.
     */
    public function findAllActive(): array {
        $stmt = $this->db->query("
            SELECT cemetery_id, cemetery_name, cemetery_code, description, address, contact_number, map_config, is_active, created_at, updated_at
            FROM cemeteries
            WHERE is_active = 1
            ORDER BY cemetery_name ASC
        ");
        return $stmt->fetchAll(PDO::FETCH_ASSOC) ?: [];
    }

    /**
     * Find a cemetery facility by primary key.
     */
    public function findById(int $id): ?array {
        $stmt = $this->db->prepare("
            SELECT cemetery_id, cemetery_name, cemetery_code, description, address, contact_number, map_config, is_active, created_at, updated_at
            FROM cemeteries
            WHERE cemetery_id = ?
            LIMIT 1
        ");
        $stmt->execute([(int) $id]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Find a cemetery facility by unique code.
     */
    public function findByCode(string $code): ?array {
        $stmt = $this->db->prepare("
            SELECT cemetery_id, cemetery_name, cemetery_code, description, address, contact_number, map_config, is_active, created_at, updated_at
            FROM cemeteries
            WHERE cemetery_code = ?
            LIMIT 1
        ");
        $stmt->execute([trim($code)]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);
        return $row ?: null;
    }

    /**
     * Update map configuration JSON for a cemetery facility.
     */
    public function updateMapConfig(int $cemeteryId, ?array $config): bool {
        $stmt = $this->db->prepare("UPDATE cemeteries SET map_config = ? WHERE cemetery_id = ?");
        return $stmt->execute([
            $config !== null ? json_encode($config) : null,
            (int) $cemeteryId
        ]);
    }
}

