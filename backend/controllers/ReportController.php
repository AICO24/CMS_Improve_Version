<?php
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/ExpirationRecord.php';
require_once __DIR__ . '/../config/database.php';

class ReportController {
    private $lotModel;
    private $paymentModel;
    private $expirationModel;
    private $db;

    public function __construct() {
        $this->lotModel = new Lot();
        $this->paymentModel = new Payment();
        $this->expirationModel = new ExpirationRecord();
        $this->db = Database::getInstance()->getConnection();
    }

    public function occupancy() {
        $stats = $this->lotModel->getStats();
        return [
            'summary' => $stats,
            'by_section' => $this->getOccupancyBySection(),
            'by_block' => $this->getOccupancyByBlock(),
            'by_lot_type' => $this->getOccupancyByLotType(),
        ];
    }

    public function revenue($filters = []) {
        $total = $this->paymentModel->getRevenue($filters);
        $breakdown = $this->paymentModel->getRevenueBreakdown($filters);
        return ['total' => $total, 'breakdown' => $breakdown];
    }

    public function expiration() {
        $expiring = $this->expirationModel->findExpiringSoon();
        $expired = $this->expirationModel->findExpired();
        return [
            'expiring_soon' => $expiring,
            'expired' => $expired,
        ];
    }

    private function getOccupancyBySection() {
        $sql = "SELECT s.section_name, COUNT(l.lot_id) AS total, SUM(CASE WHEN l.status = 'Occupied' THEN 1 ELSE 0 END) AS occupied FROM lots l JOIN blocks b ON l.block_id = b.block_id JOIN sections s ON b.section_id = s.section_id GROUP BY s.section_name ORDER BY s.section_name";
        $stmt = $this->db->query($sql);
        return $stmt->fetchAll();
    }

    private function getOccupancyByBlock() {
        $sql = "SELECT b.block_name, s.section_name, COUNT(l.lot_id) AS total, SUM(CASE WHEN l.status = 'Occupied' THEN 1 ELSE 0 END) AS occupied FROM lots l JOIN blocks b ON l.block_id = b.block_id JOIN sections s ON b.section_id = s.section_id GROUP BY b.block_id ORDER BY s.section_name, b.block_name";
        $stmt = $this->db->query($sql);
        return $stmt->fetchAll();
    }

    private function getOccupancyByLotType() {
        $sql = "SELECT t.type_name, COUNT(l.lot_id) AS total, SUM(CASE WHEN l.status = 'Occupied' THEN 1 ELSE 0 END) AS occupied FROM lots l JOIN lot_types t ON l.lot_type_id = t.type_id GROUP BY t.type_id ORDER BY t.type_name";
        $stmt = $this->db->query($sql);
        return $stmt->fetchAll();
    }
}
