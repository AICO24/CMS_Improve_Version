<?php
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Payment.php';
require_once __DIR__ . '/../models/ExpirationRecord.php';
require_once __DIR__ . '/../models/OccupancySnapshot.php';
require_once __DIR__ . '/../config/database.php';

class ReportController {
    private $lotModel;
    private $paymentModel;
    private $expirationModel;
    private $snapshotModel;
    private $db;

    public function __construct() {
        $this->lotModel = new Lot();
        $this->paymentModel = new Payment();
        $this->expirationModel = new ExpirationRecord();
        $this->snapshotModel = new OccupancySnapshot();
        $this->db = Database::getInstance()->getConnection();
    }

    public function occupancy() {
        $stats = $this->lotModel->getStats();
        $bySection = $this->getOccupancyBySection();

        // Side effect, not the point of this endpoint: upsert today's snapshot so
        // occupancy history accumulates on ordinary page views, since this project
        // has no cron/scheduler to run a capture job separately. Never let a
        // snapshot failure break the occupancy report itself.
        try {
            $this->snapshotModel->captureFromSections(date('Y-m-d'), $bySection);
        } catch (Exception $e) {
            // intentionally swallowed
        }

        return [
            'domain' => 'occupancy',
            'source' => 'lots',
            'summary' => $stats,
            'by_section' => $bySection,
            'by_block' => $this->getOccupancyByBlock(),
            'by_lot_type' => $this->getOccupancyByLotType(),
        ];
    }

    public function occupancyTrend($months = 12) {
        return $this->snapshotModel->getTrend($months);
    }

    public function revenue($filters = []) {
        $total = $this->paymentModel->getRevenue($filters);
        $breakdown = $this->paymentModel->getRevenueBreakdown($filters);
        return ['total' => $total, 'breakdown' => $breakdown];
    }

    public function recentPayments($pagination = []) {
        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;

        if ($page === null && $perPage === null) {
            return $this->paymentModel->findAll();
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 8));
        $total = $this->paymentModel->countAll();
        $data = $this->paymentModel->findAll([], ['page' => $page, 'per_page' => $perPage]);

        return [
            'data' => $data,
            'meta' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'pages' => (int) ceil($total / $perPage),
            ],
        ];
    }

    // $pagination optional {page, per_page}, applied independently to each of
    // the lists below. Omitted returns lists in full.
    public function expiration($pagination = [], $filters = []) {
        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;

        if ($page === null && $perPage === null) {
            return [
                'summary' => [
                    'expiring_soon' => $this->expirationModel->countExpiringSoon(30, $filters),
                    'expired' => $this->expirationModel->countExpired($filters),
                    'renewal_due' => $this->expirationModel->countRenewalDue(30, $filters),
                    'pending_review' => $this->expirationModel->countPendingReview($filters),
                ],
                'expiring_soon' => $this->expirationModel->findExpiringSoon(30, [], $filters),
                'expired' => $this->expirationModel->findExpired([], $filters),
                'renewal_due' => $this->expirationModel->findRenewalDue(30, [], $filters),
                'pending_review' => $this->expirationModel->findPendingReview([], $filters),
            ];
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $pageArgs = ['page' => $page, 'per_page' => $perPage];

        $expiringTotal = $this->expirationModel->countExpiringSoon(30, $filters);
        $expiredTotal = $this->expirationModel->countExpired($filters);
        $renewalTotal = $this->expirationModel->countRenewalDue(30, $filters);
        $pendingReviewTotal = $this->expirationModel->countPendingReview($filters);

        return [
            'summary' => [
                'expiring_soon' => $expiringTotal,
                'expired' => $expiredTotal,
                'renewal_due' => $renewalTotal,
                'pending_review' => $pendingReviewTotal,
            ],
            'expiring_soon' => [
                'data' => $this->expirationModel->findExpiringSoon(30, $pageArgs, $filters),
                'meta' => [
                    'page' => $page,
                    'per_page' => $perPage,
                    'total' => $expiringTotal,
                    'total_pages' => (int) ceil($expiringTotal / $perPage),
                ],
            ],
            'expired' => [
                'data' => $this->expirationModel->findExpired($pageArgs, $filters),
                'meta' => [
                    'page' => $page,
                    'per_page' => $perPage,
                    'total' => $expiredTotal,
                    'total_pages' => (int) ceil($expiredTotal / $perPage),
                ],
            ],
            'renewal_due' => [
                'data' => $this->expirationModel->findRenewalDue(30, $pageArgs, $filters),
                'meta' => [
                    'page' => $page,
                    'per_page' => $perPage,
                    'total' => $renewalTotal,
                    'total_pages' => (int) ceil($renewalTotal / $perPage),
                ],
            ],
            'pending_review' => [
                'data' => $this->expirationModel->findPendingReview($pageArgs, $filters),
                'meta' => [
                    'page' => $page,
                    'per_page' => $perPage,
                    'total' => $pendingReviewTotal,
                    'total_pages' => (int) ceil($pendingReviewTotal / $perPage),
                ],
            ],
        ];
    }

    private function getOccupancyBySection() {
        $sql = "SELECT s.section_id, s.section_name, COUNT(l.lot_id) AS total,
                       SUM(CASE WHEN l.status = 'Available' THEN 1 ELSE 0 END) AS available,
                       SUM(CASE WHEN l.status = 'Occupied' THEN 1 ELSE 0 END) AS occupied,
                       SUM(CASE WHEN l.status = 'Reserved' THEN 1 ELSE 0 END) AS reserved,
                       SUM(CASE WHEN l.status = 'Expired' THEN 1 ELSE 0 END) AS expired
                FROM lots l
                JOIN blocks b ON l.block_id = b.block_id
                JOIN sections s ON b.section_id = s.section_id
                GROUP BY s.section_id
                ORDER BY s.section_name";
        $stmt = $this->db->query($sql);
        return $stmt->fetchAll();
    }

    private function getOccupancyByBlock() {
        $sql = "SELECT b.block_id, b.block_name, s.section_name, COUNT(l.lot_id) AS total,
                       SUM(CASE WHEN l.status = 'Available' THEN 1 ELSE 0 END) AS available,
                       SUM(CASE WHEN l.status = 'Occupied' THEN 1 ELSE 0 END) AS occupied,
                       SUM(CASE WHEN l.status = 'Reserved' THEN 1 ELSE 0 END) AS reserved,
                       SUM(CASE WHEN l.status = 'Expired' THEN 1 ELSE 0 END) AS expired
                FROM lots l
                JOIN blocks b ON l.block_id = b.block_id
                JOIN sections s ON b.section_id = s.section_id
                GROUP BY b.block_id
                ORDER BY s.section_name, b.block_name";
        $stmt = $this->db->query($sql);
        return $stmt->fetchAll();
    }

    private function getOccupancyByLotType() {
        $sql = "SELECT t.type_id, t.type_name, COUNT(l.lot_id) AS total,
                       SUM(CASE WHEN l.status = 'Available' THEN 1 ELSE 0 END) AS available,
                       SUM(CASE WHEN l.status = 'Occupied' THEN 1 ELSE 0 END) AS occupied,
                       SUM(CASE WHEN l.status = 'Reserved' THEN 1 ELSE 0 END) AS reserved,
                       SUM(CASE WHEN l.status = 'Expired' THEN 1 ELSE 0 END) AS expired
                FROM lots l
                JOIN lot_types t ON l.lot_type_id = t.type_id
                GROUP BY t.type_id
                ORDER BY t.type_name";
        $stmt = $this->db->query($sql);
        return $stmt->fetchAll();
    }
}
