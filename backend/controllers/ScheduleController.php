<?php
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/User.php';

class ScheduleController {
    private $scheduleModel;
    private $lotModel;

    public function __construct() {
        $this->scheduleModel = new Schedule();
        $this->lotModel = new Lot();
    }

    // Batch N5: $user is optional (existing callers pass none) but, when
    // given, a non-admin/staff caller is force-scoped to their own
    // schedules regardless of any client-supplied filter — added because
    // this endpoint is now reachable from the Payments page's reference
    // picker (any authenticated role), and without this a citizen could
    // search/browse every other citizen's reservation by name or lot
    // number. Mirrors the same server-enforced-ownership pattern already
    // used by show()/update()/destroy() in this file.
    public function index($filters = [], $user = null) {
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if ($user && !in_array($role, ['admin', 'staff'], true)) {
            $filters['created_by'] = $user['user_id'];
        }

        $page = !empty($filters['page']) ? (int) $filters['page'] : null;
        $perPage = !empty($filters['per_page']) ? (int) $filters['per_page'] : null;

        if ($page !== null || $perPage !== null) {
            $page = max(1, $page ?: 1);
            $perPage = max(1, min(100, $perPage ?: 10));
            $total = $this->scheduleModel->countAll($filters);
            $data = $this->scheduleModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);
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

        return $this->scheduleModel->findAll($filters);
    }

    public function mine($userId, $filters = []) {
        $filters['created_by'] = $userId;
        if (!empty($filters['upcoming'])) {
            $filters['date_from'] = date('Y-m-d');
        }

        $page = !empty($filters['page']) ? (int) $filters['page'] : null;
        $perPage = !empty($filters['per_page']) ? (int) $filters['per_page'] : null;

        if ($page !== null || $perPage !== null) {
            $page = max(1, $page ?: 1);
            $perPage = max(1, min(100, $perPage ?: 10));
            $total = $this->scheduleModel->countAll($filters);
            $data = $this->scheduleModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);
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

        return $this->scheduleModel->findAll($filters);
    }

    // Batch M6: previously returned any schedule by ID to any authenticated
    // user regardless of role/ownership — update()/destroy() below already
    // restrict non-staff/admin callers to their own reservations, this
    // brings read access in line with the same rule (mirrors
    // PaymentController::show()'s pattern).
    public function show($id, $user = null) {
        $schedule = $this->scheduleModel->findById($id);
        if (!$schedule) {
            return ['error' => 'Schedule not found', 'code' => 404];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $userRole = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if (!in_array($userRole, ['admin', 'staff'], true) && (int) $schedule['created_by'] !== (int) $userId) {
            return ['error' => 'You may only view your own reservations', 'code' => 403];
        }

        return $schedule;
    }

    public function store($data, $user) {
        $required = ['lot_id', 'deceased_id', 'schedule_date'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        if (empty($data['lot_id']) || empty($data['schedule_date'])) {
            return ['error' => 'Lot and schedule date are required', 'code' => 400];
        }

        // A recommended/selected lot can go stale between when it was shown to the
        // user and when they submit the booking (another reservation gets confirmed,
        // an admin edits the lot directly, etc.). The date/time conflict check below
        // only catches double-booking the same lot/date/time — it says nothing about
        // whether the lot itself is still bookable at all, so re-check status here
        // against the authoritative lots table rather than trusting the lot_id alone.
        $lot = $this->lotModel->findById($data['lot_id']);
        if (!$lot) {
            return ['error' => 'Lot not found', 'code' => 404];
        }
        if ($lot['status'] !== 'Available') {
            return ['error' => 'This lot is no longer available for booking', 'code' => 409];
        }

        $scheduleDate = strtotime($data['schedule_date']);
        if ($scheduleDate === false) {
            return ['error' => 'Invalid schedule date format', 'code' => 400];
        }

        if (date('N', $scheduleDate) === 1) {
            return ['error' => 'Monday booking is not allowed; please select another day', 'code' => 400];
        }

        if ($scheduleDate < strtotime(date('Y-m-d'))) {
            return ['error' => 'Schedule date cannot be in the past', 'code' => 400];
        }

        $hasConflict = $this->scheduleModel->checkConflict(
            $data['lot_id'],
            $data['schedule_date'],
            $data['schedule_time'] ?? null
        );

        if ($hasConflict) {
            return ['error' => 'This lot is already booked for the selected date/time', 'code' => 409];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $userRole = strtolower(is_array($user) ? ($user['role'] ?? '') : '');

        // Only staff/admin may create a reservation that's already Confirmed;
        // everyone else's booking is forced to Pending regardless of what was submitted.
        if (!in_array($userRole, ['admin', 'staff'], true)) {
            $data['status'] = 'Pending';
            unset($data['confirmed_by']);
        }

        $data['created_by'] = $userId;
        $scheduleId = $this->scheduleModel->create($data);
        if ($scheduleId) {
            if (isset($data['status']) && $data['status'] === 'Confirmed') {
                $this->lotModel->update($data['lot_id'], ['status' => 'Reserved']);
            }
            $this->notifySchedule($data, $userId);
            return ['success' => true, 'message' => 'Schedule created', 'schedule_id' => $scheduleId];
        }

        return ['error' => 'Failed to create schedule', 'code' => 500];
    }

    private function notifySchedule($data, $userId) {
        $notificationModel = new Notification();
        $userModel = new User();
        $lot = $this->lotModel->findById($data['lot_id']);
        $user = $userModel->findById($userId);

        $isPending = empty($data['status']) || $data['status'] === 'Pending';
        $title = $isPending ? 'Reservation Pending Approval' : 'Burial Schedule Confirmed';
        $message = sprintf(
            '%s for lot %s on %s%s.',
            $isPending ? 'A reservation request has been submitted' : 'A burial schedule has been confirmed',
            $lot['lot_number'] ?? 'Unknown',
            $data['schedule_date'], 
            !empty($data['schedule_time']) ? ' at ' . $data['schedule_time'] : ''
        );

        $notificationModel->create([
            'title' => $title,
            'message' => $message,
            'notification_type' => 'Schedule',
            'is_read' => 0,
        ]);

        if (!empty($user['email'])) {
            $this->sendEmail($user['email'], $title, $message);
        }
    }

    // Notifies the reservation's owner about a status change made by staff/admin
    // (or by the owner cancelling their own reservation). Mirrors notifySchedule()
    // above, which only ever fires on creation — confirmation/completion/cancellation
    // were previously silent.
    private function notifyScheduleStatusChange($schedule, $status, $recipientUserId) {
        $notificationModel = new Notification();
        $userModel = new User();
        $lot = $this->lotModel->findById($schedule['lot_id']);
        $recipient = $userModel->findById($recipientUserId);

        $titles = [
            'Confirmed' => 'Burial Schedule Confirmed',
            'Completed' => 'Burial Service Completed',
            'Cancelled' => 'Reservation Cancelled',
        ];
        $verbs = [
            'Confirmed' => 'has been confirmed',
            'Completed' => 'has been marked completed',
            'Cancelled' => 'has been cancelled',
        ];
        $title = $titles[$status] ?? ('Reservation ' . $status);
        $message = sprintf(
            'Your burial reservation for lot %s on %s%s %s.',
            $lot['lot_number'] ?? 'Unknown',
            $schedule['schedule_date'],
            !empty($schedule['schedule_time']) ? ' at ' . $schedule['schedule_time'] : '',
            $verbs[$status] ?? 'was updated'
        );

        $notificationModel->create([
            'title' => $title,
            'message' => $message,
            'notification_type' => 'Schedule',
            'is_read' => 0,
        ]);

        if (!empty($recipient['email'])) {
            $this->sendEmail($recipient['email'], $title, $message);
        }
    }

    private function sendEmail($email, $subject, $message) {
        if (empty($email)) {
            return false;
        }

        $headers = "From: noreply@cemeterysystem.local\r\n";
        $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

        return @mail($email, $subject, $message, $headers);
    }

    public function update($id, $data, $user) {
        $existing = $this->scheduleModel->findById($id);
        if (!$existing) {
            return ['error' => 'Schedule not found', 'code' => 404];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $userRole = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        $isStaffOrAdmin = in_array($userRole, ['admin', 'staff'], true);

        if (!$isStaffOrAdmin) {
            if ($existing['created_by'] != $userId) {
                return ['error' => 'You may only update your own reservations', 'code' => 403];
            }
            if ($existing['status'] !== 'Pending') {
                return ['error' => 'Only pending reservations may be updated', 'code' => 403];
            }
            // Confirming/completing a reservation and reassigning who confirmed it
            // stay staff/admin-only actions; strip them from a self-service edit.
            unset($data['status'], $data['confirmed_by']);
        }

        $lotId = isset($data['lot_id']) ? $data['lot_id'] : $existing['lot_id'];
        $date = isset($data['schedule_date']) ? $data['schedule_date'] : $existing['schedule_date'];
        $time = array_key_exists('schedule_time', $data) ? $data['schedule_time'] : $existing['schedule_time'];

        if ($lotId != $existing['lot_id'] || $date !== $existing['schedule_date'] || $time !== $existing['schedule_time']) {
            $conflictExists = $this->scheduleModel->checkConflict($lotId, $date, $time);
            if ($conflictExists) {
                $schedules = $this->scheduleModel->findAll(['lot_id' => $lotId, 'date_from' => $date, 'date_to' => $date]);
                foreach ($schedules as $schedule) {
                    if ($schedule['schedule_id'] != $id && $schedule['status'] != 'Cancelled') {
                        return ['error' => 'This lot is already booked for the selected date/time', 'code' => 409];
                    }
                }
            }
        }

        $data['confirmed_by'] = isset($data['confirmed_by']) ? $data['confirmed_by'] : $userId;
        $result = $this->scheduleModel->update($id, $data);
        if ($result) {
            $lotId = $data['lot_id'] ?? $existing['lot_id'];
            if (isset($data['status']) && $data['status'] === 'Confirmed' && $existing['status'] !== 'Confirmed') {
                $this->lotModel->update($lotId, ['status' => 'Reserved']);
                $this->notifyScheduleStatusChange($existing, 'Confirmed', $existing['created_by']);
            } elseif (isset($data['status']) && $data['status'] === 'Completed' && $existing['status'] !== 'Completed') {
                $this->lotModel->update($lotId, ['status' => 'Occupied']);
                $this->notifyScheduleStatusChange($existing, 'Completed', $existing['created_by']);
            }
            return ['success' => true, 'message' => 'Schedule updated'];
        }

        return ['error' => 'Failed to update schedule', 'code' => 500];
    }

    public function destroy($id, $user = []) {
        $existing = $this->scheduleModel->findById($id);
        if (!$existing) {
            return ['error' => 'Schedule not found', 'code' => 404];
        }

        $userId = $user['user_id'] ?? null;
        $userRole = strtolower($user['role'] ?? '');
        if ($userRole !== 'admin' && $existing['created_by'] != $userId) {
            return ['error' => 'You may only cancel your own reservations', 'code' => 403];
        }

        if ($userRole !== 'admin' && $existing['status'] !== 'Pending') {
            return ['error' => 'Only pending reservations may be canceled', 'code' => 403];
        }

        $result = $this->scheduleModel->delete($id);
        if ($result) {
            if (in_array($existing['status'], ['Confirmed', 'Pending'], true)) {
                $this->lotModel->update($existing['lot_id'], ['status' => 'Available']);
            }
            $this->notifyScheduleStatusChange($existing, 'Cancelled', $existing['created_by']);
            return ['success' => true, 'message' => 'Schedule deleted'];
        }

        return ['error' => 'Failed to delete schedule', 'code' => 500];
    }

    public function checkConflict($lotId, $date, $time = null) {
        if (empty($lotId) || empty($date)) {
            return ['error' => 'Lot ID and date are required', 'code' => 400];
        }
        $hasConflict = $this->scheduleModel->checkConflict($lotId, $date, $time);
        return ['available' => !$hasConflict];
    }

    public function stats($year = null) {
        return $this->scheduleModel->getStats($year);
    }

    public function calendar($month, $year) {
        if (empty($month) || empty($year)) {
            return ['error' => 'Month and year are required', 'code' => 400];
        }
        return $this->scheduleModel->getCalendar($month, $year);
    }
}
