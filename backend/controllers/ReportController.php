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

        // Enrich section data with capacity and utilization rates
        $enrichedSections = [];
        $criticalSections = [];
        $tightSections = [];
        $highestCongested = null;
        $highestRate = -1.0;
        $mostAvailable = null;
        $mostAvailableCount = -1;

        foreach ($bySection as $sec) {
            $tot = (int) ($sec['total'] ?? 0);
            $occ = (int) ($sec['occupied'] ?? 0);
            $res = (int) ($sec['reserved'] ?? 0);
            $avl = (int) ($sec['available'] ?? 0);
            $exp = (int) ($sec['expired'] ?? 0);

            $utilized = $occ + $res;
            $utilizationRate = $tot > 0 ? round(($utilized / $tot) * 100, 1) : 0.0;
            $occupiedRate = $tot > 0 ? round(($occ / $tot) * 100, 1) : 0.0;
            $availableRate = $tot > 0 ? round(($avl / $tot) * 100, 1) : 0.0;

            if ($avl <= 0) {
                $status = 'Critical / Full';
                $criticalSections[] = $sec['section_name'];
            } elseif ($utilizationRate >= 85.0) {
                $status = 'Tight Capacity';
                $tightSections[] = $sec['section_name'];
            } else {
                $status = 'Optimal Capacity';
            }

            if ($utilizationRate > $highestRate) {
                $highestRate = $utilizationRate;
                $highestCongested = $sec['section_name'];
            }

            if ($avl > $mostAvailableCount) {
                $mostAvailableCount = $avl;
                $mostAvailable = $sec['section_name'];
            }

            $sec['utilized'] = $utilized;
            $sec['capacity_rate'] = $utilizationRate;
            $sec['occupied_rate'] = $occupiedRate;
            $sec['available_rate'] = $availableRate;
            $sec['utilization_status'] = $status;
            $enrichedSections[] = $sec;
        }

        $grandTotal = (int) ($stats['total'] ?? 0);
        $grandOccupied = (int) ($stats['occupied'] ?? 0);
        $grandReserved = (int) ($stats['reserved'] ?? 0);
        $grandAvailable = (int) ($stats['available'] ?? 0);
        $grandUtilized = $grandOccupied + $grandReserved;
        $overallUtilizationRate = $grandTotal > 0 ? round(($grandUtilized / $grandTotal) * 100, 1) : 0.0;

        $occupancyNarrative = "As of " . date('F j, Y') . ", the cemetery infrastructure encompasses a total capacity of {$grandTotal} plots across " . count($enrichedSections) . " designated sections. Current space utilization stands at {$overallUtilizationRate}% ({$grandOccupied} occupied and {$grandReserved} reserved), leaving {$grandAvailable} active available lots for future assignment.";
        if (!empty($criticalSections)) {
            $occupancyNarrative .= " Critical capacity (0 available plots) has been reached in: " . implode(', ', $criticalSections) . ". Operational attention is required to direct upcoming interments toward sections with remaining capacity.";
        } else {
            $occupancyNarrative .= " Space allocation remains distributed with optimal capacity across active grounds.";
        }

        $keyRecommendations = [
            "Total cemetery capacity stands at {$grandTotal} plots with an overall utilization rate of {$overallUtilizationRate}%.",
            $highestCongested ? "Section '{$highestCongested}' exhibits highest utilization at {$highestRate}%." : "All sections exhibit balanced space distribution.",
            $mostAvailable ? "Section '{$mostAvailable}' provides the highest relief inventory with {$mostAvailableCount} open lots." : "Inventory levels are uniform across sections.",
            !empty($criticalSections) ? "Immediate re-zoning or capacity expansion recommended for critical sections: " . implode(', ', $criticalSections) . "." : "No sections currently at zero-lot critical thresholds."
        ];

        $executiveSummary = [
            'total_lots' => $grandTotal,
            'occupied_lots' => $grandOccupied,
            'reserved_lots' => $grandReserved,
            'available_lots' => $grandAvailable,
            'utilized_lots' => $grandUtilized,
            'utilization_rate' => $overallUtilizationRate,
            'critical_sections_count' => count($criticalSections),
            'critical_sections' => $criticalSections,
            'highest_congested_section' => $highestCongested,
            'highest_congestion_rate' => $highestRate,
            'most_available_section' => $mostAvailable,
            'most_available_count' => $mostAvailableCount,
            'summary_narrative' => $occupancyNarrative,
            'key_recommendations' => $keyRecommendations,
        ];

        return [
            'domain' => 'occupancy',
            'source' => 'lots',
            'summary' => $stats,
            'by_section' => $enrichedSections,
            'by_block' => $this->getOccupancyByBlock(),
            'by_lot_type' => $this->getOccupancyByLotType(),
            'executive_summary' => $executiveSummary,
        ];
    }

    public function occupancyTrend($months = 12) {
        return $this->snapshotModel->getTrend($months);
    }

    public function revenue($filters = []) {
        $total = $this->paymentModel->getRevenue($filters);
        $breakdown = $this->paymentModel->getRevenueBreakdown($filters);

        $grossTotal = (float) ($total['total'] ?? 0);
        $totalCount = (int) ($total['count'] ?? 0);

        $serviceLabels = [
            'Lot Purchase' => 'Traditional Burial & Lot Assignment',
            'Cremation' => 'Cremation & Columbarium Services',
            'Relocation' => 'Transfer & Relocation Services',
            'Renewal' => 'Lease Renewal & Maintenance Fees',
            'Other' => 'Administrative & Miscellaneous Fees',
        ];

        $serviceBreakdown = [];
        $topRevenueStream = null;
        $topRevenueAmount = -1.0;
        $topVolumeStream = null;
        $topVolumeCount = -1;

        foreach ($breakdown as $item) {
            $type = $item['transaction_type'] ?: 'Other';
            $itemTotal = (float) ($item['total'] ?? 0);
            $itemCount = (int) ($item['count'] ?? 0);
            $label = $serviceLabels[$type] ?? ($type . ' Services');
            $percentage = $grossTotal > 0 ? round(($itemTotal / $grossTotal) * 100, 1) : 0.0;
            $avgAmount = $itemCount > 0 ? round($itemTotal / $itemCount, 2) : 0.0;

            if ($itemTotal > $topRevenueAmount) {
                $topRevenueAmount = $itemTotal;
                $topRevenueStream = $label;
            }

            if ($itemCount > $topVolumeCount) {
                $topVolumeCount = $itemCount;
                $topVolumeStream = $label;
            }

            $serviceBreakdown[] = [
                'transaction_type' => $type,
                'service_label' => $label,
                'total' => $itemTotal,
                'count' => $itemCount,
                'percentage' => $percentage,
                'average_amount' => $avgAmount,
            ];
        }

        $avgTicket = $totalCount > 0 ? round($grossTotal / $totalCount, 2) : 0.0;

        $revNarrative = "Total gross revenue generated across the evaluated period amounts to ₱" . number_format($grossTotal, 2) . " across {$totalCount} verified and processed transactions, yielding an average transaction value of ₱" . number_format($avgTicket, 2) . ".";
        if ($topRevenueStream) {
            $revNarrative .= " The primary revenue driver is {$topRevenueStream}, generating ₱" . number_format($topRevenueAmount, 2) . " (" . ($grossTotal > 0 ? round(($topRevenueAmount / $grossTotal) * 100, 1) : 0) . "% of total revenue).";
        }
        if ($topVolumeStream && $topVolumeStream !== $topRevenueStream) {
            $revNarrative .= " In terms of transaction volume, {$topVolumeStream} leads with {$topVolumeCount} processed operations.";
        }

        $financialTakeaways = [
            "Gross cemetery collections stand at ₱" . number_format($grossTotal, 2) . " across {$totalCount} recorded payment transactions.",
            $topRevenueStream ? "Leading revenue contributor is {$topRevenueStream} (₱" . number_format($topRevenueAmount, 2) . ")." : "Collections are evenly distributed.",
            $topVolumeStream ? "Highest transaction volume is driven by {$topVolumeStream} ({$topVolumeCount} transactions)." : "Transaction volume is consistent across services.",
            "Average revenue per transaction is ₱" . number_format($avgTicket, 2) . "."
        ];

        $financialExecutiveSummary = [
            'total_revenue' => $grossTotal,
            'transaction_count' => $totalCount,
            'average_ticket_size' => $avgTicket,
            'top_revenue_stream' => $topRevenueStream,
            'top_revenue_amount' => $topRevenueAmount,
            'top_volume_stream' => $topVolumeStream,
            'top_volume_count' => $topVolumeCount,
            'summary_narrative' => $revNarrative,
            'financial_takeaways' => $financialTakeaways,
        ];

        return [
            'total' => $total,
            'breakdown' => $breakdown,
            'service_breakdown' => $serviceBreakdown,
            'executive_summary' => $financialExecutiveSummary,
        ];
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
