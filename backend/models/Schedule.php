<?php
require_once __DIR__ . '/../config/database.php';

class Schedule {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    public function findAll($filters = [], $pagination = []) {
        $sql = "
            SELECT s.*, 
                   l.lot_number, 
                   t.type_name as lot_type_name,
                   sec.section_name, 
                   d.first_name, d.last_name,
                   u.full_name as created_by_name
            FROM burial_schedules s
            JOIN lots l ON s.lot_id = l.lot_id
            JOIN lot_types t ON l.lot_type_id = t.type_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections sec ON b.section_id = sec.section_id
            JOIN decedent_records d ON s.deceased_id = d.decedent_id
            LEFT JOIN users u ON s.created_by = u.user_id
            WHERE 1=1
        ";
        $params = [];

        if (!empty($filters['lot_id'])) {
            $sql .= " AND s.lot_id = ?";
            $params[] = $filters['lot_id'];
        }
        if (!empty($filters['created_by'])) {
            $sql .= " AND s.created_by = ?";
            $params[] = $filters['created_by'];
        }
        if (!empty($filters['status'])) {
            $sql .= " AND s.status = ?";
            $params[] = $filters['status'];
        }
        if (!empty($filters['lot_number'])) {
            $sql .= " AND l.lot_number LIKE ?";
            $params[] = '%' . $filters['lot_number'] . '%';
        }
        if (!empty($filters['q'])) {
            $sql .= " AND (l.lot_number LIKE ? OR sec.section_name LIKE ? OR d.first_name LIKE ? OR d.last_name LIKE ?)";
            $search = '%' . $filters['q'] . '%';
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
        }
        if (!empty($filters['date_from'])) {
            $sql .= " AND s.schedule_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND s.schedule_date <= ?";
            $params[] = $filters['date_to'];
        }
        if (!empty($filters['month']) && !empty($filters['year'])) {
            $sql .= " AND YEAR(s.schedule_date) = ? AND MONTH(s.schedule_date) = ?";
            $params[] = $filters['year'];
            $params[] = $filters['month'];
        }

        $sql .= " ORDER BY s.schedule_date ASC, s.schedule_time ASC";

        $page = null;
        $perPage = null;
        if (!empty($pagination['page']) || !empty($pagination['per_page'])) {
            $page = max(1, (int) ($pagination['page'] ?? 1));
            $perPage = max(1, min(100, (int) ($pagination['per_page'] ?? 10)));
        }

        if ($page !== null && $perPage !== null) {
            $offset = ($page - 1) * $perPage;
            $sql .= " LIMIT ?, ?";
            $params[] = $offset;
            $params[] = $perPage;
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        return $stmt->fetchAll();
    }

    public function countAll($filters = []) {
        $sql = "
            SELECT COUNT(*) as total
            FROM burial_schedules s
            JOIN lots l ON s.lot_id = l.lot_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections sec ON b.section_id = sec.section_id
            JOIN decedent_records d ON s.deceased_id = d.decedent_id
            WHERE 1=1
        ";
        $params = [];

        if (!empty($filters['lot_id'])) {
            $sql .= " AND s.lot_id = ?";
            $params[] = $filters['lot_id'];
        }
        if (!empty($filters['created_by'])) {
            $sql .= " AND s.created_by = ?";
            $params[] = $filters['created_by'];
        }
        if (!empty($filters['status'])) {
            $sql .= " AND s.status = ?";
            $params[] = $filters['status'];
        }
        if (!empty($filters['lot_number'])) {
            $sql .= " AND l.lot_number LIKE ?";
            $params[] = '%' . $filters['lot_number'] . '%';
        }
        if (!empty($filters['q'])) {
            $sql .= " AND (l.lot_number LIKE ? OR sec.section_name LIKE ? OR d.first_name LIKE ? OR d.last_name LIKE ?)";
            $search = '%' . $filters['q'] . '%';
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
            $params[] = $search;
        }
        if (!empty($filters['date_from'])) {
            $sql .= " AND s.schedule_date >= ?";
            $params[] = $filters['date_from'];
        }
        if (!empty($filters['date_to'])) {
            $sql .= " AND s.schedule_date <= ?";
            $params[] = $filters['date_to'];
        }
        if (!empty($filters['month']) && !empty($filters['year'])) {
            $sql .= " AND YEAR(s.schedule_date) = ? AND MONTH(s.schedule_date) = ?";
            $params[] = $filters['year'];
            $params[] = $filters['month'];
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $row = $stmt->fetch();
        return (int) ($row['total'] ?? 0);
    }

    public function findById($id) {
        $stmt = $this->db->prepare(" 
            SELECT s.*, 
                   l.lot_number, 
                   sec.section_name, 
                   d.first_name, d.last_name,
                   u.full_name as created_by_name
            FROM burial_schedules s
            JOIN lots l ON s.lot_id = l.lot_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections sec ON b.section_id = sec.section_id
            JOIN decedent_records d ON s.deceased_id = d.decedent_id
            LEFT JOIN users u ON s.created_by = u.user_id
            WHERE s.schedule_id = ?
        ");
        $stmt->execute([(int) $id]);
        return $stmt->fetch();
    }

    public function checkConflict($lotId, $date, $time = null) {
        $sql = "SELECT COUNT(*) as count FROM burial_schedules 
                WHERE lot_id = ? AND schedule_date = ? AND status != 'Cancelled'";
        $params = [(int) $lotId, $date];
        if ($time) {
            $sql .= " AND schedule_time = ?";
            $params[] = $time;
        }
        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $result = $stmt->fetch();
        return (int) ($result['count'] ?? 0) > 0;
    }

    public function create($data) {
        $stmt = $this->db->prepare("
            INSERT INTO burial_schedules
            (lot_id, deceased_id, schedule_date, schedule_time, status, notes, created_by, confirmed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $success = $stmt->execute([
            (int) $data['lot_id'],
            (int) $data['deceased_id'],
            $data['schedule_date'],
            $data['schedule_time'] ?? null,
            $data['status'] ?? 'Pending',
            $data['notes'] ?? null,
            (int) $data['created_by'],
            isset($data['confirmed_by']) ? (int) $data['confirmed_by'] : null,
        ]);

        return $success ? (int) $this->db->lastInsertId() : false;
    }

    public function update($id, $data) {
        $existing = $this->findById($id);
        if (!$existing) {
            return false;
        }

        $stmt = $this->db->prepare("
            UPDATE burial_schedules SET
                lot_id = ?,
                deceased_id = ?,
                schedule_date = ?,
                schedule_time = ?,
                status = ?,
                notes = ?,
                confirmed_by = ?
            WHERE schedule_id = ?
        ");
        return $stmt->execute([
            (int) ($data['lot_id'] ?? $existing['lot_id']),
            (int) ($data['deceased_id'] ?? $existing['deceased_id']),
            $data['schedule_date'] ?? $existing['schedule_date'],
            array_key_exists('schedule_time', $data) ? $data['schedule_time'] : $existing['schedule_time'],
            $data['status'] ?? $existing['status'],
            array_key_exists('notes', $data) ? $data['notes'] : $existing['notes'],
            isset($data['confirmed_by']) ? (int) $data['confirmed_by'] : $existing['confirmed_by'],
            (int) $id,
        ]);
    }

    public function delete($id) {
        $stmt = $this->db->prepare("DELETE FROM burial_schedules WHERE schedule_id = ?");
        return $stmt->execute([(int) $id]);
    }

    public function getStats($year = null) {
        $year = $year ?: date('Y');

        $stmt = $this->db->prepare("
            SELECT COUNT(*) AS total,
                   SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END) AS pending,
                   SUM(CASE WHEN status = 'Confirmed' THEN 1 ELSE 0 END) AS confirmed,
                   SUM(CASE WHEN status = 'Completed' THEN 1 ELSE 0 END) AS completed,
                   SUM(CASE WHEN status = 'Cancelled' THEN 1 ELSE 0 END) AS cancelled
            FROM burial_schedules
        ");
        $stmt->execute();
        $counts = $stmt->fetch();

        $total = (int) ($counts['total'] ?? 0);
        $pending = (int) ($counts['pending'] ?? 0);
        $confirmed = (int) ($counts['confirmed'] ?? 0);
        $completed = (int) ($counts['completed'] ?? 0);
        $cancelled = (int) ($counts['cancelled'] ?? 0);

        // Rates are of reservations that reached an outcome (excludes still-Pending
        // ones, which haven't been decided yet and would otherwise dilute both rates).
        $decided = $confirmed + $completed + $cancelled;
        $confirmationRate = $decided > 0 ? round((($confirmed + $completed) / $decided) * 100) : 0;
        $cancellationRate = $decided > 0 ? round(($cancelled / $decided) * 100) : 0;

        $monthStmt = $this->db->prepare("
            SELECT MONTH(schedule_date) AS month, COUNT(*) AS count
            FROM burial_schedules
            WHERE YEAR(schedule_date) = ?
            GROUP BY MONTH(schedule_date)
            ORDER BY MONTH(schedule_date)
        ");
        $monthStmt->execute([$year]);

        return [
            'total' => $total,
            'pending' => $pending,
            'confirmed' => $confirmed,
            'completed' => $completed,
            'cancelled' => $cancelled,
            'confirmation_rate' => $confirmationRate,
            'cancellation_rate' => $cancellationRate,
            'by_month' => $monthStmt->fetchAll(),
        ];
    }

    public function getCalendar($month, $year) {
        $schedules = $this->findAll(['month' => $month, 'year' => $year]);
        $calendar = [];
        foreach ($schedules as $schedule) {
            $date = $schedule['schedule_date'];
            if (!isset($calendar[$date])) {
                $calendar[$date] = [];
            }
            $calendar[$date][] = $schedule;
        }
        return $calendar;
    }
}
