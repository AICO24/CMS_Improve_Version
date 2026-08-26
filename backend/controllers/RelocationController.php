<?php
require_once __DIR__ . '/../models/Relocation.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../services/AutomationEngine.php';

class RelocationController {
    private $relocationModel;
    private $lotModel;
    private $decedentModel;
    private $auditLogModel;

    public function __construct() {
        $this->relocationModel = new Relocation();
        $this->lotModel = new Lot();
        $this->decedentModel = new Decedent();
        $this->auditLogModel = new AuditLog();
    }

    public function index($filters = [], $pagination = []) {
        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;

        if ($page === null && $perPage === null) {
            return $this->relocationModel->findAll($filters);
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $total = $this->relocationModel->countAll($filters);
        $data = $this->relocationModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);

        return [
            'data' => $data,
            'meta' => [
                'page' => $page,
                'per_page' => $perPage,
                'total' => $total,
                'total_pages' => (int) ceil($total / $perPage),
            ],
        ];
    }

    public function show($id) {
        $request = $this->relocationModel->findById($id);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        return $request;
    }

    public function store($data, $userId) {
        $required = ['from_lot_id', 'to_lot_id', 'deceased_id', 'reason'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        $fromLot = $this->lotModel->findById($data['from_lot_id']);
        $toLot = $this->lotModel->findById($data['to_lot_id']);
        if (!$fromLot || !$toLot) {
            return ['error' => 'One or both lots not found', 'code' => 404];
        }

        $decedent = $this->decedentModel->findById($data['deceased_id']);
        if (!$decedent) {
            return ['error' => 'Decedent not found', 'code' => 404];
        }

        if ($toLot['status'] !== 'Available') {
            return ['error' => 'Destination lot is not available', 'code' => 409];
        }

        $data['requested_by'] = $userId;
        $result = $this->relocationModel->create($data);
        if ($result) {
            // Sub-batch 4 (Batch G): the creation event itself was previously
            // unaudited — closing that gap so "how did this relocation
            // originate" doesn't require inferring it from the current row.
            // Not routed through AutomationEngine: creation has no
            // cascading side effect to guard (the lot check above already
            // ran, synchronously, as part of this same request).
            $this->auditLogModel->log(
                'Relocation request created',
                $userId,
                null,
                'Relocation',
                $result,
                [
                    'deceased_id' => (int) $data['deceased_id'],
                    'from_lot_id' => (int) $data['from_lot_id'],
                    'to_lot_id' => (int) $data['to_lot_id'],
                    'reason' => $data['reason'],
                    'status' => 'Pending',
                ]
            );

            // Full Automation, Admin-First (Round 2): store() itself already
            // ran every check approve() used to re-check a second time (lots
            // exist, destination Available) — requiring the same admin to
            // then separately click Approve on their own just-created
            // request was pure process friction, not a real decision point.
            // Attempt the approval immediately as an automatic continuation;
            // on the rare validation failure (a race between the check above
            // and here) this raises a reviewable system_exceptions entry
            // instead of silently approving, and the request simply stays
            // Pending — see attemptAutoApproval().
            $autoApproved = $this->attemptAutoApproval($result, (int) $data['to_lot_id'], $userId);

            return [
                'success' => true,
                'message' => $autoApproved
                    ? 'Relocation request created and approved'
                    : 'Relocation request created; destination lot could not be auto-reserved, flagged for review',
                'status' => $autoApproved ? 'Approved' : 'Pending',
            ];
        }
        return ['error' => 'Failed to create relocation request', 'code' => 500];
    }

    // Full Automation, Admin-First (Round 2): the deterministic half of the
    // approval decision, run automatically right after store() creates the
    // request. Deliberately two independent AutomationEngine::run() calls,
    // mirroring PaymentController::autoConfirmScheduleForVerifiedPurchase()'s
    // split exactly — one tagged to the Lot being reserved (via the existing
    // transitionLotStatus() helper, unchanged), one tagged to the Relocation
    // itself, each re-checking state right before acting so this stays safe
    // to call from a single request path. Tagging the top-level decision as
    // entity_type 'Relocation' (not 'Lot') is what lets relocation-management.js
    // find "my request needs review" by request_id, the same way
    // manage-reservations.js already does for Schedule exceptions.
    //
    // approve()/deny() below are NOT touched by this — they remain the manual
    // override path for a request that ends up stuck Pending here (surfaced
    // via the Exceptions page), and stay direct/manual (own audit diff, actor
    // is the real admin) rather than automation-engine-tagged, since a manual
    // override should never look like an automated decision in the timeline.
    private function attemptAutoApproval($requestId, $toLotId, $userId) {
        $this->transitionLotStatus($toLotId, 'Reserved', ['Available'], $userId, 'relocation.approved');

        $relocationModel = $this->relocationModel;
        $lotModel = $this->lotModel;
        $automation = AutomationEngine::run(
            'relocation.approved',
            'Relocation',
            $requestId,
            $userId,
            function () use ($lotModel, $toLotId) {
                $toLot = $lotModel->findById($toLotId);
                if (!$toLot) {
                    return ['Destination lot no longer exists'];
                }
                // Tolerates 'Reserved' too, same as the Lot-tagged call above
                // and Schedule's own auto-confirm — the sibling call just
                // reserved it in this same request, so seeing that isn't a
                // failure, it's confirmation the reservation already landed.
                if (!in_array($toLot['status'], ['Available', 'Reserved'], true)) {
                    return ['Destination lot ' . ($toLot['lot_number'] ?? $toLot['lot_id']) . ' is no longer available (status: ' . $toLot['status'] . ')'];
                }
                return true;
            },
            function () use ($relocationModel, $requestId, $userId) {
                return $relocationModel->updateStatus($requestId, 'Approved', $userId);
            }
        );

        if (!empty($automation['success'])) {
            $freshRequest = $relocationModel->findById($requestId);
            if ($freshRequest) {
                $this->notifyRelocationStatusChange($freshRequest, 'Approved');
            }
            return true;
        }

        return false;
    }

    public function update($id, $data, $userId) {
        $existing = $this->relocationModel->findById($id);
        if (!$existing) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }

        if ($existing['status'] !== 'Pending') {
            return ['error' => 'Cannot update a request that is already processed', 'code' => 403];
        }

        if (isset($data['from_lot_id']) && $data['from_lot_id'] != $existing['from_lot_id']) {
            $fromLot = $this->lotModel->findById($data['from_lot_id']);
            if (!$fromLot) {
                return ['error' => 'Source lot not found', 'code' => 404];
            }
        }

        if (isset($data['to_lot_id']) && $data['to_lot_id'] != $existing['to_lot_id']) {
            $toLot = $this->lotModel->findById($data['to_lot_id']);
            if (!$toLot) {
                return ['error' => 'Destination lot not found', 'code' => 404];
            }
            if ($toLot['status'] !== 'Available') {
                return ['error' => 'Destination lot is not available', 'code' => 409];
            }
        }

        $result = $this->relocationModel->update($id, $data);
        if ($result) {
            // Sub-batch 4 (Batch G): only the fields this endpoint's own
            // model UPDATE actually writes — status/approved_by stay out of
            // scope here, that's approve()/deny()/complete()'s territory,
            // not this one's. Nothing is logged when nothing actually
            // changed (e.g. a resubmit with identical values), per the
            // explicit instruction to avoid meaningless audit noise.
            $changed = [];
            foreach (['from_lot_id', 'to_lot_id', 'deceased_id', 'reason'] as $field) {
                if (array_key_exists($field, $data) && (string) $data[$field] !== (string) ($existing[$field] ?? '')) {
                    $changed[$field] = ['from' => $existing[$field] ?? null, 'to' => $data[$field]];
                }
            }
            if (!empty($changed)) {
                $this->auditLogModel->log(
                    'Relocation request updated',
                    $userId,
                    null,
                    'Relocation',
                    $id,
                    $changed
                );
            }
            return ['success' => true, 'message' => 'Relocation request updated'];
        }
        return ['error' => 'Failed to update request', 'code' => 500];
    }

    public function approve($id, $userId) {
        $request = $this->relocationModel->findById($id);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        if ($request['status'] !== 'Pending') {
            return ['error' => 'Request is already processed', 'code' => 403];
        }

        $toLot = $this->lotModel->findById($request['to_lot_id']);
        if ($toLot['status'] !== 'Available') {
            return ['error' => 'Destination lot is no longer available', 'code' => 409];
        }

        $result = $this->relocationModel->updateStatus($id, 'Approved', $userId);
        if ($result) {
            $this->transitionLotStatus($request['to_lot_id'], 'Reserved', ['Available'], $userId, 'relocation.approved');
            $this->auditLogModel->log(
                'Relocation approved',
                $userId,
                null,
                'Relocation',
                $id,
                ['deceased_id' => $request['deceased_id'] ?? null, 'from_lot_id' => $request['from_lot_id'] ?? null, 'to_lot_id' => $request['to_lot_id'] ?? null]
            );
            $this->notifyRelocationStatusChange($request, 'Approved');
            return ['success' => true, 'message' => 'Relocation request approved'];
        }

        return ['error' => 'Failed to approve request', 'code' => 500];
    }

    public function complete($id, $userId) {
        $request = $this->relocationModel->findById($id);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        if ($request['status'] !== 'Approved') {
            return ['error' => 'Request must be approved first', 'code' => 403];
        }

        // from_lot's prior status isn't validated anywhere in this flow (not
        // by store(), not here) — it's assumed Occupied (that's where the
        // decedent currently rests) but nothing enforces it, so this release
        // deliberately carries no guard, preserving exact pre-existing
        // behavior (it always succeeded unconditionally before Batch C too).
        $this->transitionLotStatus($request['from_lot_id'], 'Available', null, $userId, 'relocation.completed');
        // to_lot, by contrast, was guarded into Reserved by approve() above,
        // and nothing else should have touched it since — a guard here is
        // safe and catches a real anomaly (e.g. it was reset via a direct
        // lot edit while the relocation sat Approved).
        $this->transitionLotStatus($request['to_lot_id'], 'Occupied', ['Reserved'], $userId, 'relocation.completed');

        $result = $this->relocationModel->updateStatus($id, 'Completed', $userId);
        if ($result) {
            $this->auditLogModel->log(
                'Relocation completed',
                $userId,
                null,
                'Relocation',
                $id,
                ['deceased_id' => $request['deceased_id'] ?? null, 'from_lot_id' => $request['from_lot_id'] ?? null, 'to_lot_id' => $request['to_lot_id'] ?? null]
            );
            $this->notifyRelocationStatusChange($request, 'Completed');
            return ['success' => true, 'message' => 'Relocation completed'];
        }
        return ['error' => 'Failed to complete relocation', 'code' => 500];
    }

    public function deny($id, $userId) {
        $request = $this->relocationModel->findById($id);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        if ($request['status'] !== 'Pending') {
            return ['error' => 'Request is already processed', 'code' => 403];
        }

        $result = $this->relocationModel->updateStatus($id, 'Denied', $userId);
        if ($result) {
            $this->auditLogModel->log(
                'Relocation denied',
                $userId,
                null,
                'Relocation',
                $id,
                ['deceased_id' => $request['deceased_id'] ?? null, 'from_lot_id' => $request['from_lot_id'] ?? null, 'to_lot_id' => $request['to_lot_id'] ?? null]
            );
            $this->notifyRelocationStatusChange($request, 'Denied');
            return ['success' => true, 'message' => 'Relocation request denied'];
        }
        return ['error' => 'Failed to deny request', 'code' => 500];
    }

    public function destroy($id, $userId) {
        $request = $this->relocationModel->findById($id);
        if (!$request) {
            return ['error' => 'Relocation request not found', 'code' => 404];
        }
        if ($request['status'] !== 'Pending') {
            return ['error' => 'Cannot delete a processed request', 'code' => 403];
        }

        // Sub-batch 5 (Batch G): soft-cancel — reuses the exact same model
        // call deny() already makes (Relocation::updateStatus(), which also
        // stamps approved_by/updated_at) instead of a hard DELETE, so
        // cancellation history survives. No Lot side-effect existed here
        // before and none is needed now: a Pending request never reserved
        // to_lot (only approve() does that), so there's nothing to release.
        $result = $this->relocationModel->updateStatus($id, 'Denied', $userId);
        if ($result) {
            $this->auditLogModel->log(
                'Relocation request cancelled',
                $userId,
                null,
                'Relocation',
                $id,
                ['deceased_id' => $request['deceased_id'] ?? null, 'from_lot_id' => $request['from_lot_id'] ?? null, 'to_lot_id' => $request['to_lot_id'] ?? null]
            );
            return ['success' => true, 'message' => 'Relocation request cancelled'];
        }
        return ['error' => 'Failed to delete request', 'code' => 500];
    }

    public function stats() {
        return $this->relocationModel->getStats();
    }

    // Batch D (Admin-Wide Automation Audit): relocation status changes
    // previously notified nobody — the requester had no way to learn their
    // request was approved/completed/denied except by checking back
    // manually. Mirrors ScheduleController::notifyScheduleStatusChange()'s
    // pattern exactly. $request is expected to already carry from_lot_number/
    // to_lot_number (findById()'s existing join), so no extra lookup here.
    private function notifyRelocationStatusChange($request, $status) {
        $notificationModel = new Notification();
        $userModel = new User();
        $recipient = $userModel->findById($request['requested_by'] ?? null);

        $titles = [
            'Approved' => 'Relocation Request Approved',
            'Completed' => 'Relocation Completed',
            'Denied' => 'Relocation Request Denied',
        ];
        $verbs = [
            'Approved' => 'has been approved',
            'Completed' => 'has been completed',
            'Denied' => 'has been denied',
        ];
        $title = $titles[$status] ?? ('Relocation ' . $status);
        $message = sprintf(
            'Your relocation request (lot %s to lot %s) %s.',
            $request['from_lot_number'] ?? $request['from_lot_id'] ?? 'Unknown',
            $request['to_lot_number'] ?? $request['to_lot_id'] ?? 'Unknown',
            $verbs[$status] ?? 'was updated'
        );

        $notificationModel->create([
            'title' => $title,
            'message' => $message,
            'notification_type' => 'Relocation',
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

    // Batch C (Admin-Wide Automation Audit): same shared wrapper as
    // ScheduleController's — routes this controller's lot status changes
    // through the one authoritative Lot::transitionStatus() write via
    // AutomationEngine, so they're audited on success and raise a reviewable
    // system_exceptions entry (instead of silently doing nothing) if the lot
    // isn't in an expected status when $allowedFromStatuses is given.
    private function transitionLotStatus($lotId, $newStatus, $allowedFromStatuses, $actorUser, $event) {
        $lotModel = $this->lotModel;
        AutomationEngine::run(
            $event,
            'Lot',
            $lotId,
            $actorUser,
            function () use ($lotModel, $lotId, $allowedFromStatuses) {
                $lot = $lotModel->findById($lotId);
                if (!$lot) {
                    return ['Lot no longer exists'];
                }
                if ($allowedFromStatuses !== null && !in_array($lot['status'], $allowedFromStatuses, true)) {
                    return ['Lot ' . ($lot['lot_number'] ?? $lot['lot_id']) . ' is not in an expected status for this transition (current: ' . $lot['status'] . ')'];
                }
                return true;
            },
            function () use ($lotModel, $lotId, $newStatus, $allowedFromStatuses) {
                return $lotModel->transitionStatus($lotId, $newStatus, $allowedFromStatuses);
            }
        );
    }
}
