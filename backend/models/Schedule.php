<?php
require_once __DIR__ . '/../config/database.php';

class Schedule {
    private $db;

    public function __construct() {
        $this->db = Database::getInstance()->getConnection();
    }

    // Batch E (reservation module audit): surfaces the most recent payment
    // tied to this schedule directly in the list/detail queries, reusing
    // Batch D's now-reliable reference_kind column instead of the
    // guess-by-existence fallback (that fallback is still fine for the rare
    // pre-Batch-D-vintage row, but this SELECT is read-only and doesn't need
    // PaymentController::resolveExpectedAmount()'s full amount-checking
    // logic — just the latest payment row, if any). A schedule with no
    // payment at all (a fresh Pending booking, or Confirmed-by-staff-
    // directly) simply gets NULLs here, which the frontend renders as "No
    // payment on file" rather than an error.
    private const LATEST_PAYMENT_SELECT = "
        (SELECT p.verification_status FROM payments p WHERE p.reference_kind = 'schedule' AND p.reference_id = s.schedule_id ORDER BY p.created_at DESC LIMIT 1) AS payment_status,
        (SELECT p.amount FROM payments p WHERE p.reference_kind = 'schedule' AND p.reference_id = s.schedule_id ORDER BY p.created_at DESC LIMIT 1) AS payment_amount,
        (SELECT p.payment_date FROM payments p WHERE p.reference_kind = 'schedule' AND p.reference_id = s.schedule_id ORDER BY p.created_at DESC LIMIT 1) AS payment_date,
        (SELECT p.receipt_number FROM payments p WHERE p.reference_kind = 'schedule' AND p.reference_id = s.schedule_id ORDER BY p.created_at DESC LIMIT 1) AS payment_receipt_number
    ";

    public function findAll($filters = [], $pagination = []) {
        $sql = "
            SELECT s.*,
                   l.lot_number,
                   t.type_name as lot_type_name,
                   sec.section_name,
                   d.first_name, d.last_name,
                   dr.full_name AS provisional_name, dr.status AS provisional_status,
                   u.full_name as created_by_name,
                   " . self::LATEST_PAYMENT_SELECT . "
            FROM burial_schedules s
            JOIN lots l ON s.lot_id = l.lot_id
            JOIN lot_types t ON l.lot_type_id = t.type_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections sec ON b.section_id = sec.section_id
            LEFT JOIN decedent_records d ON s.deceased_id = d.decedent_id
            LEFT JOIN decedent_requests dr ON s.decedent_request_id = dr.request_id
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
            $sql .= " AND (l.lot_number LIKE ? OR sec.section_name LIKE ? OR d.first_name LIKE ? OR d.last_name LIKE ? OR dr.full_name LIKE ?)";
            $search = '%' . $filters['q'] . '%';
            $params[] = $search;
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
        if (!empty($filters['awaiting_confirmation'])) {
            $sql .= " AND s.status = 'Pending' AND EXISTS (
                SELECT 1 FROM payments pay
                WHERE pay.reference_id = s.schedule_id AND pay.verification_status = 'Verified'
            )";
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
            LEFT JOIN decedent_records d ON s.deceased_id = d.decedent_id
            LEFT JOIN decedent_requests dr ON s.decedent_request_id = dr.request_id
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
            $sql .= " AND (l.lot_number LIKE ? OR sec.section_name LIKE ? OR d.first_name LIKE ? OR d.last_name LIKE ? OR dr.full_name LIKE ?)";
            $search = '%' . $filters['q'] . '%';
            $params[] = $search;
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
        if (!empty($filters['awaiting_confirmation'])) {
            $sql .= " AND s.status = 'Pending' AND EXISTS (
                SELECT 1 FROM payments pay
                WHERE pay.reference_id = s.schedule_id AND pay.verification_status = 'Verified'
            )";
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
                   dr.full_name AS provisional_name, dr.status AS provisional_status,
                   u.full_name as created_by_name,
                   " . self::LATEST_PAYMENT_SELECT . "
            FROM burial_schedules s
            JOIN lots l ON s.lot_id = l.lot_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections sec ON b.section_id = sec.section_id
            LEFT JOIN decedent_records d ON s.deceased_id = d.decedent_id
            LEFT JOIN decedent_requests dr ON s.decedent_request_id = dr.request_id
            LEFT JOIN users u ON s.created_by = u.user_id
            WHERE s.schedule_id = ?
        ");
        $stmt->execute([(int) $id]);
        return $stmt->fetch();
    }

    // Batch B: lets DecedentRequestController::approve() find the booking(s)
    // (if any) that were created against this request's provisional
    // decedent_request_id, so the formal decedent record can be auto-linked
    // without a separate manual link-decedent click.
    public function findByDecedentRequestId($requestId) {
        $stmt = $this->db->prepare("SELECT * FROM burial_schedules WHERE decedent_request_id = ?");
        $stmt->execute([(int) $requestId]);
        return $stmt->fetchAll();
    }

    // Batch F (Decedent Records audit, suggested schedule linking): a
    // decedent created outside the request-approval flow (plain "Add New
    // Record") has no automatic way to pick up an existing, unlinked
    // schedule for the same lot — findByDecedentRequestId() above only
    // covers the citizen-booked-first path. Scoped tightly: same lot, no
    // deceased_id yet, and no decedent_request_id (that case is already
    // handled by DecedentRequestController::autoLinkSchedules() when ITS
    // request is approved, so surfacing it here too would be redundant/
    // confusing). Only active statuses — a Cancelled slot is never worth
    // suggesting.
    public function findUnlinkedByLot($lotId) {
        $stmt = $this->db->prepare("
            SELECT schedule_id, schedule_date, schedule_time, status
            FROM burial_schedules
            WHERE lot_id = ?
              AND deceased_id IS NULL
              AND decedent_request_id IS NULL
              AND status IN ('Pending', 'Confirmed')
        ");
        $stmt->execute([(int) $lotId]);
        return $stmt->fetchAll();
    }

    // Automation opportunity G.1: a Pending reservation the citizen never
    // followed up on with a payment attempt — "no payment" means literally
    // zero payments rows reference this schedule, not "no VERIFIED payment
    // yet". A submitted-but-not-yet-verified payment means the ball is in
    // staff's court, not the citizen's, so that schedule is correctly
    // excluded here rather than nagged. Mirrors
    // ExpirationRecord::findExpiringSoonUnnotified()'s dedupe convention —
    // stale_notified_at IS NULL is what makes a repeat sweep safe to call
    // often (see migration_20260902_add_schedule_stale_notified.sql).
    public function findStalePendingUnnotified($days) {
        $stmt = $this->db->prepare("
            SELECT s.*, l.lot_number, sec.section_name
            FROM burial_schedules s
            JOIN lots l ON s.lot_id = l.lot_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections sec ON b.section_id = sec.section_id
            WHERE s.status = 'Pending'
              AND s.stale_notified_at IS NULL
              AND s.created_at <= (NOW() - INTERVAL ? DAY)
              AND NOT EXISTS (
                  SELECT 1 FROM payments p
                  WHERE p.transaction_type = 'Lot Purchase' AND p.reference_id = s.schedule_id
              )
            ORDER BY s.created_at ASC
        ");
        $stmt->execute([(int) $days]);
        return $stmt->fetchAll();
    }

    public function markStaleNotified($id) {
        $stmt = $this->db->prepare("UPDATE burial_schedules SET stale_notified_at = NOW() WHERE schedule_id = ?");
        return $stmt->execute([(int) $id]);
    }

    // Auto-cancel policy, stage 2 of 3 (confirmed 2026-09-02): the final
    // warning, sent $days after the FIRST reminder actually fired —
    // stale_notified_at, not created_at. This was a real bug caught during
    // testing (browser-verified via a deliberately backdated row, then
    // restored): gating on created_at alone meant a reservation nobody had
    // swept in weeks would get its reminder AND final warning AND
    // cancellation in the same request, seconds apart — the whole point of
    // a "final warning" is a real few days' grace period, not a rubber
    // stamp between three back-to-back calls in one page load (see
    // notifications.js — all three run unconditionally on every visit,
    // stage 1 then 2 then 3). Anchoring each stage to when the PREVIOUS
    // stage actually happened, rather than to the original booking date,
    // keeps the real gap intact even when the whole pipeline runs "late"
    // because nobody opened Notifications for a while.
    public function findStalePendingForFinalWarning($days) {
        $stmt = $this->db->prepare("
            SELECT s.*, l.lot_number, sec.section_name
            FROM burial_schedules s
            JOIN lots l ON s.lot_id = l.lot_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections sec ON b.section_id = sec.section_id
            WHERE s.status = 'Pending'
              AND s.stale_notified_at IS NOT NULL
              AND s.final_warning_notified_at IS NULL
              AND s.stale_notified_at <= (NOW() - INTERVAL ? DAY)
              AND NOT EXISTS (
                  SELECT 1 FROM payments p
                  WHERE p.transaction_type = 'Lot Purchase' AND p.reference_id = s.schedule_id
              )
            ORDER BY s.created_at ASC
        ");
        $stmt->execute([(int) $days]);
        return $stmt->fetchAll();
    }

    public function markFinalWarningNotified($id) {
        $stmt = $this->db->prepare("UPDATE burial_schedules SET final_warning_notified_at = NOW() WHERE schedule_id = ?");
        return $stmt->execute([(int) $id]);
    }

    // Auto-cancel policy, stage 3 of 3: candidates for actual cancellation,
    // $days after the final warning actually fired — final_warning_notified_at,
    // not created_at. Same fix as findStalePendingForFinalWarning() above,
    // for the same reason: this is what actually guarantees a real grace
    // period between the warning and the cancellation, not just "a warning
    // was sent at some point."
    public function findStalePendingForCancellation($days) {
        $stmt = $this->db->prepare("
            SELECT s.*, l.lot_number, sec.section_name
            FROM burial_schedules s
            JOIN lots l ON s.lot_id = l.lot_id
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections sec ON b.section_id = sec.section_id
            WHERE s.status = 'Pending'
              AND s.final_warning_notified_at IS NOT NULL
              AND s.final_warning_notified_at <= (NOW() - INTERVAL ? DAY)
              AND NOT EXISTS (
                  SELECT 1 FROM payments p
                  WHERE p.transaction_type = 'Lot Purchase' AND p.reference_id = s.schedule_id
              )
            ORDER BY s.created_at ASC
        ");
        $stmt->execute([(int) $days]);
        return $stmt->fetchAll();
    }

    // Fresh, single-row re-check called right before the actual cancel write
    // in ScheduleController::autoCancelStalePending() — the bulk candidate
    // list above was read moments earlier in the same request; a payment
    // could have been submitted in the interim.
    public function isStillEligibleForAutoCancel($scheduleId) {
        $stmt = $this->db->prepare("
            SELECT 1 FROM burial_schedules s
            WHERE s.schedule_id = ?
              AND s.status = 'Pending'
              AND NOT EXISTS (
                  SELECT 1 FROM payments p
                  WHERE p.transaction_type = 'Lot Purchase' AND p.reference_id = s.schedule_id
              )
        ");
        $stmt->execute([(int) $scheduleId]);
        return (bool) $stmt->fetchColumn();
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

    // Locking read for the transactional booking flow (Batch L2.3) — takes
    // an InnoDB next-key lock on the lot_id range in idx_lot_id (added by
    // migration_20260825_soft_cancel_schedules.sql), which under the
    // server's default REPEATABLE READ isolation blocks a concurrent
    // transaction from inserting another active schedule for the same lot
    // until this one commits or rolls back — even when this lot currently
    // has zero schedule rows, since a next-key lock still covers the gap a
    // new row would occupy. This narrows the race window under normal
    // operation; the isolation-level-independent guarantee is the
    // uq_active_schedule_slot unique index added by
    // migration_20260831_add_active_schedule_slot_constraint.sql, which
    // this locking read is paired with, not a replacement for. Only call
    // from inside an active Database::transaction().
    public function lockScheduleRangeForLot($lotId) {
        $stmt = $this->db->prepare("SELECT schedule_id FROM burial_schedules WHERE lot_id = ? FOR UPDATE");
        $stmt->execute([(int) $lotId]);
        return $stmt->fetchAll();
    }

    public function create($data) {
        // deceased_id/decedent_request_id are mutually exclusive (see
        // ScheduleController::store()) — exactly one is set for a new
        // schedule, so both are passed through null-aware rather than cast
        // with (int), which would turn a genuinely absent value into 0.
        $stmt = $this->db->prepare("
            INSERT INTO burial_schedules
            (lot_id, deceased_id, decedent_request_id, schedule_date, schedule_time, status, notes, created_by, confirmed_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ");
        $success = $stmt->execute([
            (int) $data['lot_id'],
            !empty($data['deceased_id']) ? (int) $data['deceased_id'] : null,
            !empty($data['decedent_request_id']) ? (int) $data['decedent_request_id'] : null,
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

        // Formalizing a provisional booking (ScheduleController::linkDecedent())
        // sets deceased_id while leaving decedent_request_id in place for audit
        // traceability (see the plan's state-transition rules) — so
        // decedent_request_id is only ever changed by an explicit key in $data,
        // never implicitly cleared here.
        $stmt = $this->db->prepare("
            UPDATE burial_schedules SET
                lot_id = ?,
                deceased_id = ?,
                decedent_request_id = ?,
                schedule_date = ?,
                schedule_time = ?,
                status = ?,
                notes = ?,
                confirmed_by = ?
            WHERE schedule_id = ?
        ");
        return $stmt->execute([
            (int) ($data['lot_id'] ?? $existing['lot_id']),
            array_key_exists('deceased_id', $data)
                ? (!empty($data['deceased_id']) ? (int) $data['deceased_id'] : null)
                : (!empty($existing['deceased_id']) ? (int) $existing['deceased_id'] : null),
            array_key_exists('decedent_request_id', $data)
                ? (!empty($data['decedent_request_id']) ? (int) $data['decedent_request_id'] : null)
                : (!empty($existing['decedent_request_id']) ? (int) $existing['decedent_request_id'] : null),
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
