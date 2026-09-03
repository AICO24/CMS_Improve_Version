<?php
require_once __DIR__ . '/../models/DecedentRequest.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../services/AutomationEngine.php';
require_once __DIR__ . '/ScheduleController.php';
require_once __DIR__ . '/DecedentDocumentController.php';

class DecedentRequestController {
    private $requestModel;
    private $decedentModel;
    private $scheduleModel;
    private $auditLogModel;
    private $documentController;

    public function __construct() {
        $this->requestModel = new DecedentRequest();
        $this->decedentModel = new Decedent();
        $this->scheduleModel = new Schedule();
        $this->auditLogModel = new AuditLog();
        $this->documentController = new DecedentDocumentController();
    }

    public function index($status = null) {
        $requests = $this->requestModel->findAll($status);
        $this->flagPossibleDuplicates($requests);
        return $requests;
    }

    // Decedent Records module audit, Batch L3: the reverse of Batch B's
    // decedent_records duplicate check, one level earlier — two DIFFERENT
    // families can independently submit a request for the same person
    // (e.g. two grandchildren, unaware of each other) before either becomes
    // a real decedent_records row, so Batch B's own check (which only looks
    // at decedent_records) would never catch this. Computed here, in PHP,
    // over whatever pending() already returned — the realistic list size
    // for a cemetery's pending queue makes an O(n^2) comparison a non-issue,
    // and it keeps this out of DecedentRequest::findAll()'s SQL, which
    // several other callers (approve()/reject()/autoLinkSchedules()) use
    // for single-row lookups where this flag is irrelevant. Flags only,
    // never blocks — a shared common surname is expected in this dataset,
    // not proof of an actual duplicate.
    private function flagPossibleDuplicates(&$requests) {
        foreach ($requests as &$request) {
            $request['possible_duplicate_of'] = null;
            $request['possible_duplicate_name'] = null;
        }
        unset($request);

        foreach ($requests as $i => &$request) {
            if (($request['status'] ?? null) !== 'pending') {
                continue;
            }
            foreach ($requests as $j => $other) {
                if ($i === $j || ($other['status'] ?? null) !== 'pending') {
                    continue;
                }
                if ($this->requestsLookSimilar($request, $other)) {
                    $request['possible_duplicate_of'] = $other['request_id'];
                    $request['possible_duplicate_name'] = $other['full_name'];
                    break;
                }
            }
        }
        unset($request);
    }

    private function requestsLookSimilar($a, $b) {
        $nameA = strtolower(trim((string) ($a['full_name'] ?? '')));
        $nameB = strtolower(trim((string) ($b['full_name'] ?? '')));
        if ($nameA === '' || $nameB === '') {
            return false;
        }
        if ($nameA === $nameB) {
            return true;
        }

        // A phonetic match alone is too weak for a common surname with no
        // other supporting signal — only counted when both sides also gave
        // a date that's close (within a few days), same tolerance as
        // Decedent::findNearDuplicates()'s own dob/dod check.
        if (soundex($nameA) === soundex($nameB) && !empty($a['approximate_dod']) && !empty($b['approximate_dod'])) {
            $diffDays = abs(strtotime($a['approximate_dod']) - strtotime($b['approximate_dod'])) / 86400;
            return $diffDays <= 3;
        }

        return false;
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

    // Decedent Records module audit, Batch L1: lets the citizen who filed
    // this request (or admin/staff) attach a death certificate/burial
    // permit to it BEFORE staff formalizes a real decedent_records row —
    // this is what makes online booking match the face-to-face process,
    // where the family hands staff the physical document up front. The file
    // itself is validated/saved exactly like a staff-side decedent-document
    // upload (DecedentDocumentController::saveUploadedFile() — same MIME/
    // size checks, same on-disk location), it just can't become a real
    // decedent_documents row yet since there's no decedent_id. Only ever
    // allowed on a still-'pending' request — once reviewed, the request's
    // outcome is fixed, so a new attachment attempt after that point would
    // just be silently ignored by approve()/reject() rather than surfacing
    // a real error, which is more confusing than blocking it outright here.
    public function uploadAttachment($id, $file, $user) {
        $request = $this->requestModel->findById($id);
        if (!$request) {
            return ['error' => 'Request not found', 'code' => 404];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if (!in_array($role, ['admin', 'staff'], true) && (int) $request['requested_by'] !== (int) $userId) {
            return ['error' => 'You may only attach files to your own requests', 'code' => 403];
        }
        if ($request['status'] !== 'pending') {
            return ['error' => 'This request has already been reviewed', 'code' => 409];
        }

        $saved = DecedentDocumentController::saveUploadedFile($file);
        if (isset($saved['error'])) {
            return $saved;
        }

        // A re-upload replacing an earlier attachment on the same still-
        // pending request — remove the old file so it doesn't linger as an
        // orphan once this one takes its place.
        if (!empty($request['attachment_path'])) {
            DecedentDocumentController::deleteUploadedFile($request['attachment_path']);
        }

        $result = $this->requestModel->setAttachment($id, $saved['file_path'], $saved['original_filename']);
        if (!$result) {
            DecedentDocumentController::deleteUploadedFile($saved['file_path']);
            return ['error' => 'Failed to record the attachment', 'code' => 500];
        }

        $this->auditLogModel->log(
            'Decedent request attachment uploaded',
            $userId,
            is_array($user) ? ($user['username'] ?? null) : null,
            'DecedentRequest',
            $id,
            ['original_filename' => $saved['original_filename']]
        );

        return ['success' => true, 'message' => 'Attachment uploaded'];
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

            // Decedent Records module audit, Batch L3: finalize a citizen's
            // booking-time attachment (Batch L1/L2) onto the real decedent
            // now that it exists — moves it into decedent_documents exactly
            // like a staff-uploaded one (DecedentDocumentController::
            // attachExistingFile(), the same method Batch K's own store()
            // uses), then clears it off the request so it isn't shown as
            // still "attached to the request" once it has a permanent home.
            // 'death_certificate' rather than 'other': the citizen flow this
            // came from (registering someone not yet on file) is
            // specifically about proving death, so that's the more accurate
            // default than a generic bucket — staff can review the document
            // itself either way. Best-effort: a failure here doesn't undo
            // the approval that already succeeded, it just leaves the file
            // sitting unclaimed on the request (visible to staff, who can
            // still open it from there).
            if (!empty($request['attachment_path'])) {
                $attachResult = $this->documentController->attachExistingFile(
                    (int) $data['decedent_id'],
                    $request['attachment_path'],
                    $request['attachment_original_filename'],
                    'death_certificate',
                    $user,
                    'Decedent document finalized from citizen request'
                );
                if (!empty($attachResult['success'])) {
                    $this->requestModel->clearAttachment($id);
                }
            }

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
            'user_id' => $request['requested_by'] ?? null,
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
    // Shared by autoLinkSchedules() below (the unattended path, wrapped in
    // AutomationEngine::run() — a validation failure there raises a
    // reviewable system_exceptions entry) and retryLinkSchedule() further
    // down (the interactive retry path from the Exceptions page — the admin
    // is watching it happen, so a failure is reported straight back to them
    // instead of queuing a second exception for the same thing).
    private function validateScheduleLink($scheduleId) {
        $current = $this->scheduleModel->findById($scheduleId);
        if (!$current) {
            return ['Linked schedule no longer exists'];
        }
        if (!empty($current['deceased_id'])) {
            return ['Schedule already has a formal decedent record linked'];
        }
        return true;
    }

    private function autoLinkSchedules($requestId, $decedentId, $user) {
        $schedules = $this->scheduleModel->findByDecedentRequestId($requestId);

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
                function () use ($scheduleId) {
                    return $this->validateScheduleLink($scheduleId);
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

    // Automation opportunity G.7: called only by
    // SystemExceptionController::retry() for a 'decedent_request.approved' /
    // Schedule exception. Re-runs the exact same validation and link logic
    // as autoLinkSchedules() above (via validateScheduleLink()), deliberately
    // WITHOUT AutomationEngine's wrapper — a failed retry reports its reason
    // straight back to the admin who clicked Retry, rather than raising a
    // second queued exception for the same underlying problem.
    public function retryLinkSchedule($scheduleId, $decedentId, $user) {
        $validation = $this->validateScheduleLink($scheduleId);
        if ($validation !== true) {
            return ['error' => implode('; ', $validation), 'code' => 409];
        }

        $scheduleController = new ScheduleController();
        $result = $scheduleController->linkDecedent($scheduleId, $decedentId, $user, true);
        if (empty($result['success'])) {
            return $result;
        }

        $this->auditLogModel->log(
            'Decedent link retried from exception',
            is_array($user) ? ($user['user_id'] ?? null) : $user,
            is_array($user) ? ($user['username'] ?? null) : null,
            'Schedule',
            $scheduleId,
            ['decedent_id' => (int) $decedentId]
        );

        return $result;
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
            // Decedent Records module audit, Batch L3: a rejected request
            // never becomes a decedent — its Batch L1/L2 attachment (if any)
            // has nowhere to go and is never needed again, so it's deleted
            // now rather than left as a permanent orphan on disk.
            if (!empty($request['attachment_path'])) {
                DecedentDocumentController::deleteUploadedFile($request['attachment_path']);
                $this->requestModel->clearAttachment($id);
            }

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
