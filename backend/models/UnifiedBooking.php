<?php
/**
 * UnifiedBooking Model
 * 
 * Authoritative reader for v_unified_bookings view.
 * Provides ownership-scoped queries combining burial schedules, cremation records,
 * and active booking drafts with resume capabilities (BMS-9).
 */
require_once __DIR__ . '/../config/database.php';

class UnifiedBooking {
    private PDO $db;

    public function __construct(?PDO $db = null) {
        $this->db = $db ?? Database::getInstance()->getConnection();
    }

    /**
     * Build parameterized WHERE clause for ownership-scoped filters.
     * 
     * @param int   $userId
     * @param array $filters
     * @param array &$params
     * @return string
     */
    private function buildWhereClause(int $userId, array $filters, array &$params): string {
        $where = " WHERE user_id = ?";
        $params[] = $userId;

        if (!empty($filters['service_type'])) {
            $st = strtolower(trim((string) $filters['service_type']));
            if (in_array($st, ['burial', 'cremation'], true)) {
                $where .= " AND service_type = ?";
                $params[] = $st;
            }
        }

        if (!empty($filters['source_kind'])) {
            $sk = strtolower(trim((string) $filters['source_kind']));
            if ($sk === 'burial') {
                $sk = 'schedule';
            }
            if (in_array($sk, ['schedule', 'cremation', 'draft'], true)) {
                $where .= " AND source_kind = ?";
                $params[] = $sk;
            }
        }

        if (!empty($filters['status'])) {
            $where .= " AND status = ?";
            $params[] = trim((string) $filters['status']);
        }

        if (isset($filters['is_draft']) && $filters['is_draft'] !== '') {
            if ($filters['is_draft'] === '1' || $filters['is_draft'] === 1 || $filters['is_draft'] === true) {
                $where .= " AND is_draft = 1";
            } elseif ($filters['is_draft'] === '0' || $filters['is_draft'] === 0 || $filters['is_draft'] === false) {
                $where .= " AND is_draft = 0";
            }
        }

        if (!empty($filters['q'])) {
            $search = '%' . trim((string) $filters['q']) . '%';
            $where .= " AND (booking_reference LIKE ? OR decedent_name LIKE ? OR allocation LIKE ?)";
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
        }

        return $where;
    }

    /**
     * Find user's unified bookings with pagination and resume metadata.
     * 
     * @param int   $userId
     * @param array $filters
     * @param array $pagination
     * @return array List of normalized booking records
     */
    public function findMine(int $userId, array $filters = [], array $pagination = []): array {
        $params = [];
        $where = $this->buildWhereClause($userId, $filters, $params);

        $sql = "SELECT * FROM v_unified_bookings" . $where;
        $sql .= " ORDER BY is_draft DESC, created_at DESC, source_id DESC";

        $page = !empty($pagination['page']) ? max(1, (int) $pagination['page']) : null;
        $perPage = !empty($pagination['per_page']) ? max(1, min(100, (int) $pagination['per_page'])) : null;

        if ($page !== null && $perPage !== null) {
            $offset = ($page - 1) * $perPage;
            $sql .= " LIMIT ?, ?";
            $params[] = $offset;
            $params[] = $perPage;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $rows = $stmt->fetchAll(PDO::FETCH_ASSOC);

        $result = [];
        foreach ($rows as $row) {
            $isDraft = (int) ($row['is_draft'] ?? 0) === 1;
            $item = [
                'source_kind'       => $row['source_kind'],
                'source_id'         => (int) $row['source_id'],
                'user_id'           => (int) $row['user_id'],
                'service_type'      => $row['service_type'],
                'booking_reference' => $row['booking_reference'],
                'decedent_name'     => $row['decedent_name'],
                'booking_date'      => $row['booking_date'],
                'allocation'        => $row['allocation'],
                'status'            => $row['status'],
                'is_draft'          => $isDraft,
                'draft_id'          => $isDraft ? (int) $row['source_id'] : null,
                'created_at'        => $row['created_at'],
                'updated_at'        => $row['updated_at'],
                'resume_url'        => $isDraft ? "booking-assistant.html?draft_id={$row['source_id']}" : null,
            ];
            $result[] = $item;
        }

        return $result;
    }

    /**
     * Count total unified bookings for user matching filters.
     * 
     * @param int   $userId
     * @param array $filters
     * @return int
     */
    public function countMine(int $userId, array $filters = []): int {
        $params = [];
        $where = $this->buildWhereClause($userId, $filters, $params);

        $sql = "SELECT COUNT(*) AS total FROM v_unified_bookings" . $where;
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return (int) $stmt->fetchColumn();
    }

    /**
     * Compute summary statistics for authenticated user's bookings.
     * 
     * @param int $userId
     * @return array
     */
    public function getStats(int $userId): array {
        $stmt = $this->db->prepare("
            SELECT 
                COUNT(*) AS total,
                SUM(CASE WHEN is_draft = 1 THEN 1 ELSE 0 END) AS active_drafts,
                SUM(CASE WHEN is_draft = 0 AND status = 'Pending' THEN 1 ELSE 0 END) AS pending,
                SUM(CASE WHEN is_draft = 0 AND status IN ('Scheduled', 'Confirmed') THEN 1 ELSE 0 END) AS scheduled,
                SUM(CASE WHEN is_draft = 0 AND status = 'Completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN is_draft = 0 AND status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled,
                SUM(CASE WHEN is_draft = 0 AND service_type = 'burial' THEN 1 ELSE 0 END) AS burials,
                SUM(CASE WHEN is_draft = 0 AND service_type = 'cremation' THEN 1 ELSE 0 END) AS cremations
            FROM v_unified_bookings
            WHERE user_id = ?
        ");
        $stmt->execute([$userId]);
        $row = $stmt->fetch(PDO::FETCH_ASSOC);

        $drafts = (int) ($row['active_drafts'] ?? 0);
        $burials = (int) ($row['burials'] ?? 0);
        $cremations = (int) ($row['cremations'] ?? 0);

        return [
            'total'         => (int) ($row['total'] ?? 0),
            'active_drafts' => $drafts,
            'drafts'        => $drafts,
            'pending'       => (int) ($row['pending'] ?? 0),
            'scheduled'     => (int) ($row['scheduled'] ?? 0),
            'completed'     => (int) ($row['completed'] ?? 0),
            'cancelled'     => (int) ($row['cancelled'] ?? 0),
            'burials'       => $burials,
            'burial'        => $burials,
            'cremations'    => $cremations,
            'cremation'     => $cremations,
        ];
    }
}
