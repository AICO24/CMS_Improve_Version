<?php
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/AiController.php';

class ScheduleController {
    private $scheduleModel;
    private $lotModel;

    public function __construct() {
        $this->scheduleModel = new Schedule();
        $this->lotModel = new Lot();
    }

    public function index($filters = []) {
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

    public function show($id) {
        $schedule = $this->scheduleModel->findById($id);
        return $schedule ?: ['error' => 'Schedule not found', 'code' => 404];
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

    private function sendEmail($email, $subject, $message) {
        if (empty($email)) {
            return false;
        }

        $headers = "From: noreply@cemeterysystem.local\r\n";
        $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";

        return mail($email, $subject, $message, $headers);
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
            if (isset($data['status']) && $data['status'] === 'Confirmed') {
                $lotId = $data['lot_id'] ?? $existing['lot_id'];
                $this->lotModel->update($lotId, ['status' => 'Reserved']);
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

    public function calendar($month, $year) {
        if (empty($month) || empty($year)) {
            return ['error' => 'Month and year are required', 'code' => 400];
        }
        return $this->scheduleModel->getCalendar($month, $year);
    }

    public function recommend($preferences) {
        $aiController = new AiController();
        return $aiController->recommend($preferences);
    }
}
