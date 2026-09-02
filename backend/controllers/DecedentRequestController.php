<?php
require_once __DIR__ . '/../models/DecedentRequest.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../services/AutomationEngine.php';
require_once __DIR__ . '/ScheduleController.php';

class DecedentRequestController {
    private $requestModel;
    private $decedentModel;
    private $scheduleModel;
    private $auditLogModel;

    public function __construct() {
        $this->requestModel = new DecedentRequest();
        $this->decedentModel = new Decedent();
        $this->scheduleModel = new Schedule();
        $this->auditLogModel = new AuditLog();
    }

    public function index($status = null) {
        return $this->requestModel->findAll($status);
    }

    public function mine($userId) {
        return $this->requestModel->findByUser($userId);
    }

    public function store($data, $user) {
        if (empty($data['full_name'])) {
            return ['error' => 'full_name is required', 'code' => 400];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $requestId = $this->requestModel->create([
            'requested_by' => $userId,
            'full_name' => $data['full_name'],
            'approximate_dod' => $data['approximate_dod'] ?? null,
            'relationship' => $data['relationship'] ?? null,
            'notes' => $data['notes'] ?? null,
        ]);

        if ($requestId) {
            return ['success' => true, 'message' => 'Request submitted', 'request_id' => $requestId];
        }
        return ['error' => 'Failed to submit request', 'code' => 500];
    }

    public function approve($id, $data, $user) {
        $request = $this->requestModel->findById($id);
        if (!$request) {
            return ['error' => 'Request not found', 'code' => 404];
        }
        if ($request['status'] !== 'pending') {
            return ['error' => 'This request has already been reviewed', 'code' => 409];
        }
        if (empty($data['decedent_id'])) {
            return ['error' => 'decedent_id is required', 'code' => 400];
        }
        $decedent = $this->decedentModel->findById($data['decedent_id']);
        if (!$decedent) {
            return ['error' => 'That decedent record does not exist', 'code' => 404];
        }

        $reviewerId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $reviewerUsername = is_array($user) ? ($user['username'] ?? null) : null;
        $result = $this->requestModel->approve($id, $data['decedent_id'], $reviewerId);
        if ($result) {
            $this->auditLogModel->log(
                'Decedent request approved',
                $reviewerId,
                $reviewerUsername,
                'DecedentRequest',
                $id,
                ['full_name' => $request['full_name'] ?? null, 'linked_decedent_id' => (int) $data['decedent_id']]
            );
            $this->autoLinkSchedules($id, (int) $data['decedent_id'], $user);
            $this->notifyRequestStatus($request, 'approved');
            return ['success' => true, 'message' => 'Request approved'];
        }
        return ['error' => 'Failed to approve request', 'code' => 500];
    }

    // Previously only DecedentRequest::markNotified() (chat-assistant status
    // line, pull-based — see acknowledge() below) told a citizen their
    // request was decided, and only if/when they reopened the booking chat.
    // This adds the same push notification (in-app + best-effort email)
    // every other decision point in this module already gives its owner —
    // mirrors ScheduleController::notifyScheduleStatusChange()'s pattern
    // exactly, including deferring the email via afterCommit() when this
    // runs nested inside a wider transaction so a rolled-back approve/reject
    // never sends an email describing something that didn't happen.
    private function notifyRequestStatus($request, $status, $rejectionReason = null) {
        $notificationModel = new Notification();
        $userModel = new User();
        $requester = $userModel->findById($request['requested_by']);

        if ($status === 'approved') {
            $title = 'Decedent Record Request Approved';
            $message = sprintf(
                'Your request to register "%s" has been approved and linked to your booking.',
                $request['full_name']
            );
        } else {
            $title = 'Decedent Record Request Rejected';
            $message = sprintf(
                'Your request to register "%s" was not approved.%s',
                $request['full_name'],
                $rejectionReason ? ' Reason: ' . $rejectionReason : ''
            );
        }

        $notificationModel->create([
            'title' => $title,
            'message' => $message,
            'notification_type' => 'System',
            'is_read' => 0,
        ]);

        if (!empty($requester['email'])) {
            $this->sendEmail($requester['email'], $title, $message);
        }
    }

    // Same deferred-until-commit pattern as ScheduleController::sendEmail() —
    // see that method's comment for why this can't just be a synchronous
    // mail() call here.
    private function sendEmail($email, $subject, $message) {
        if (empty($email)) {
            return false;
        }

        Database::getInstance()->afterCommit(function () use ($email, $subject, $message) {
            $headers = "From: noreply@cemeterysystem.local\r\n";
            $headers .= "Content-Type: text/plain; charset=UTF-8\r\n";
            @mail($email, $subject, $message, $headers);
        });

        return true;
    }

    // Batch B (Admin-Wide Automation Audit): a citizen's provisional booking
    // (ScheduleController::store()'s decedent_request_id path) references
    // this request but has no formal deceased_id yet. Approving the request
    // now gives the system everything it needs to finish that link itself,
    // instead of requiring staff to separately visit Manage Reservations and
    // click "link decedent". Wrapped in AutomationEngine so a schedule that
    // can't safely be linked (e.g. it got linked some other way between the
    // lookup below and now) raises a reviewable exception instead of either
    // silently doing nothing or overwriting an existing link. Schedules that
    // are already linked are skipped here (not an exception) — that's the
    // expected steady state, not a problem needing admin attention.
    private function autoLinkSchedules($requestId, $decedentId, $user) {
        $schedules = $this->scheduleModel->findByDecedentRequestId($requestId);
        $scheduleModel = $this->scheduleModel;

        foreach ($schedules as $schedule) {
            if (!empty($schedule['deceased_id'])) {
                continue;
            }

            $scheduleId = $schedule['schedule_id'];
            AutomationEngine::run(
                'decedent_request.approved',
                'Schedule',
                $scheduleId,
                $user,
                function () use ($scheduleModel, $scheduleId) {
                    $current = $scheduleModel->findById($scheduleId);
                    if (!$current) {
                        return ['Linked schedule no longer exists'];
                    }
                    if (!empty($current['deceased_id'])) {
                        return ['Schedule already has a formal decedent record linked'];
                    }
                    return true;
                },
                function () use ($scheduleId, $decedentId, $user) {
                    $scheduleController = new ScheduleController();
                    // Batch F: true marks this as the automatic link, so
                    // linkDecedent() doesn't also log its own 'Decedent
                    // manually linked' entry — AutomationEngine::run() above
                    // already records this fact as a 'decedent_request.approved'
                    // audit entry.
                    return $scheduleController->linkDecedent($scheduleId, $decedentId, $user, true);
                }
            );
        }
    }

    public function reject($id, $data, $user) {
        $request = $this->requestModel->findById($id);
        if (!$request) {
            return ['error' => 'Request not found', 'code' => 404];
        }
        if ($request['status'] !== 'pending') {
            return ['error' => 'This request has already been reviewed', 'code' => 409];
        }
        if (empty($data['rejection_reason'])) {
            return ['error' => 'rejection_reason is required', 'code' => 400];
        }

        $reviewerId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $reviewerUsername = is_array($user) ? ($user['username'] ?? null) : null;
        $result = $this->requestModel->reject($id, $data['rejection_reason'], $reviewerId);
        if ($result) {
            $this->auditLogModel->log(
                'Decedent request rejected',
                $reviewerId,
                $reviewerUsername,
                'DecedentRequest',
                $id,
                ['full_name' => $request['full_name'] ?? null, 'rejection_reason' => $data['rejection_reason']]
            );
            $this->notifyRequestStatus($request, 'rejected', $data['rejection_reason']);
            return ['success' => true, 'message' => 'Request rejected'];
        }
        return ['error' => 'Failed to reject request', 'code' => 500];
    }

    // Called by the chat assistant right after it shows a status line for
    // this request, so the same "still pending"/"has been added" message
    // doesn't repeat on every future chat load. Ownership-checked — a
    // citizen may only acknowledge their own request; admin/staff can
    // acknowledge any (mirrors how they can already see/act on any request).
    public function acknowledge($id, $user) {
        $request = $this->requestModel->findById($id);
        if (!$request) {
            return ['error' => 'Request not found', 'code' => 404];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if (!in_array($role, ['admin', 'staff'], true) && (int) $request['requested_by'] !== (int) $userId) {
            return ['error' => 'You may only acknowledge your own requests', 'code' => 403];
        }

        $result = $this->requestModel->markNotified($id, $request['status']);
        if ($result) {
            $this->auditLogModel->log(
                'Decedent request acknowledged',
                $userId,
                is_array($user) ? ($user['username'] ?? null) : null,
                'DecedentRequest',
                $id,
                ['status' => $request['status']]
            );
            return ['success' => true];
        }
        return ['error' => 'Failed to acknowledge request', 'code' => 500];
    }
}
