<?php
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../models/ExpirationRecord.php';
require_once __DIR__ . '/../models/DecedentRequest.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../services/AutomationEngine.php';

class ScheduleController {
    private $scheduleModel;
    private $lotModel;
    private $expirationModel;
    private $decedentRequestModel;
    private $auditLogModel;

    // Default lease term applied to the expiration_records row auto-created
    // when a burial schedule is marked Completed (Batch LM-AUTOMATION, Phase C).
    private const DEFAULT_LEASE_YEARS = 5;

    public function __construct() {
        $this->scheduleModel = new Schedule();
        $this->lotModel = new Lot();
        $this->expirationModel = new ExpirationRecord();
        $this->decedentRequestModel = new DecedentRequest();
        $this->auditLogModel = new AuditLog();
    }

    private static function actorId($actor) {
        return is_array($actor) ? ($actor['user_id'] ?? null) : $actor;
    }

    private static function actorUsername($actor) {
        return is_array($actor) ? ($actor['username'] ?? null) : null;
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
        if (empty($data['lot_id']) || empty($data['schedule_date'])) {
            return ['error' => 'Lot and schedule date are required', 'code' => 400];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $userRole = strtolower(is_array($user) ? ($user['role'] ?? '') : '');

        // Full Automation, Admin-First (Batch 2): a citizen may book without
        // an existing decedent_records row — the person isn't registered yet.
        // Staff formalizes the real record later via linkDecedent(); until
        // then the booking carries a decedent_requests row instead (reused
        // as-is from the earlier decedent-request-intake feature). Admin/
        // staff bookings still require a real deceased_id — they have the
        // authority to just add the record first rather than use this path.
        if (empty($data['deceased_id'])) {
            if ($userRole !== 'user') {
                return ['error' => "Field 'deceased_id' is required", 'code' => 400];
            }

            $decedentRequestId = $data['decedent_request_id'] ?? null;
            if (!empty($decedentRequestId)) {
                $existingRequest = $this->decedentRequestModel->findById($decedentRequestId);
                if (!$existingRequest) {
                    return ['error' => 'Decedent request not found', 'code' => 404];
                }
                if ((int) $existingRequest['requested_by'] !== (int) $userId) {
                    return ['error' => 'You may only book against your own decedent request', 'code' => 403];
                }
            } else {
                $provisional = is_array($data['provisional_decedent'] ?? null) ? $data['provisional_decedent'] : [];
                if (empty($provisional['full_name'])) {
                    return ['error' => 'A decedent record, or a provisional decedent name, is required', 'code' => 400];
                }
                $decedentRequestId = $this->decedentRequestModel->create([
                    'requested_by' => $userId,
                    'full_name' => $provisional['full_name'],
                    'approximate_dod' => $provisional['approximate_dod'] ?? null,
                    'relationship' => $provisional['relationship'] ?? null,
                    'notes' => $provisional['notes'] ?? null,
                ]);
                if (!$decedentRequestId) {
                    return ['error' => 'Failed to record provisional decedent info', 'code' => 500];
                }
            }

            $data['decedent_request_id'] = $decedentRequestId;
            unset($data['deceased_id']);
        } else {
            unset($data['decedent_request_id'], $data['provisional_decedent']);
        }

        // Batch L2.3: the lot lookup, conflict check, and schedule creation
        // all move inside one transaction so a concurrent request against
        // the same lot can't interleave with this one — findByIdForUpdate()
        // and lockScheduleRangeForLot() both take real InnoDB locks that a
        // second simultaneous store() call for the same lot_id will block
        // behind until this transaction commits or rolls back. The
        // uq_active_schedule_slot unique index (see
        // migration_20260831_add_active_schedule_slot_constraint.sql) is
        // the isolation-level-independent backstop if a race still reaches
        // the INSERT — caught below as a PDOException and translated back
        // into the same 409 checkConflict() already returns for the normal
        // case. Validation order (lot exists/Available -> date format ->
        // Monday -> past-date -> conflict) is unchanged from before this
        // batch; only the locking and transaction boundary are new.
        try {
            $outcome = Database::getInstance()->transaction(function () use (&$data, $user, $userId, $userRole) {
                // A recommended/selected lot can go stale between when it was shown to the
                // user and when they submit the booking (another reservation gets confirmed,
                // an admin edits the lot directly, etc.). The date/time conflict check below
                // only catches double-booking the same lot/date/time — it says nothing about
                // whether the lot itself is still bookable at all, so re-check status here
                // against the authoritative lots table rather than trusting the lot_id alone.
                $lot = $this->lotModel->findByIdForUpdate($data['lot_id']);
                if (!$lot) {
                    return ['ok' => false, 'error' => 'Lot not found', 'code' => 404];
                }
                if ($lot['status'] !== 'Available') {
                    return ['ok' => false, 'error' => 'This lot is no longer available for booking', 'code' => 409];
                }

                $scheduleDate = strtotime($data['schedule_date']);
                if ($scheduleDate === false) {
                    return ['ok' => false, 'error' => 'Invalid schedule date format', 'code' => 400];
                }

                if (date('N', $scheduleDate) === 1) {
                    return ['ok' => false, 'error' => 'Monday booking is not allowed; please select another day', 'code' => 400];
                }

                if ($scheduleDate < strtotime(date('Y-m-d'))) {
                    return ['ok' => false, 'error' => 'Schedule date cannot be in the past', 'code' => 400];
                }

                $this->scheduleModel->lockScheduleRangeForLot($data['lot_id']);

                $hasConflict = $this->scheduleModel->checkConflict(
                    $data['lot_id'],
                    $data['schedule_date'],
                    $data['schedule_time'] ?? null
                );

                if ($hasConflict) {
                    return ['ok' => false, 'error' => 'This lot is already booked for the selected date/time', 'code' => 409];
                }

                // Only staff/admin may create a reservation that's already Confirmed;
                // everyone else's booking is forced to Pending regardless of what was submitted.
                if (!in_array($userRole, ['admin', 'staff'], true)) {
                    $data['status'] = 'Pending';
                    unset($data['confirmed_by']);
                }

                $data['created_by'] = $userId;
                $scheduleId = $this->scheduleModel->create($data);
                if (!$scheduleId) {
                    return ['ok' => false, 'error' => 'Failed to create schedule', 'code' => 500];
                }

                // Batch F (Post-Automation Admin Gap Audit): creation is its own
                // distinct, always-original fact ("a booking exists and here's
                // its starting state") — never produced by AutomationEngine, so
                // no duplication risk here. This is what lets a future "what
                // happened to booking #123" question find a starting point at all.
                $this->auditLogModel->log(
                    'Schedule created',
                    self::actorId($user),
                    self::actorUsername($user),
                    'Schedule',
                    $scheduleId,
                    ['lot_id' => (int) $data['lot_id'], 'schedule_date' => $data['schedule_date'], 'initial_status' => $data['status'] ?? 'Pending']
                );
                if (isset($data['status']) && $data['status'] === 'Confirmed') {
                    $this->transitionLotStatus($data['lot_id'], 'Reserved', ['Available', 'Reserved'], $user, 'schedule.confirmed');
                }

                return ['ok' => true, 'schedule_id' => $scheduleId];
            });
        } catch (PDOException $e) {
            if (self::isDuplicateActiveSlotViolation($e)) {
                return ['error' => 'This lot is already booked for the selected date/time', 'code' => 409];
            }
            throw $e;
        }

        if (!$outcome['ok']) {
            return ['error' => $outcome['error'], 'code' => $outcome['code']];
        }

        $this->notifySchedule($data, $userId);
        return ['success' => true, 'message' => 'Schedule created', 'schedule_id' => $outcome['schedule_id']];
    }

    // Batch L2.3: the uq_active_schedule_slot unique index
    // (migration_20260831_add_active_schedule_slot_constraint.sql) is the
    // backstop if two simultaneous store() calls both pass checkConflict()
    // before either INSERTs — the loser's INSERT throws this exact
    // constraint violation. Checked by SQLSTATE (23000 = integrity
    // constraint violation) AND the specific index name, so an unrelated
    // duplicate-key error is never misclassified as a booking conflict.
    private static function isDuplicateActiveSlotViolation(PDOException $e) {
        return $e->getCode() === '23000' && strpos($e->getMessage(), 'uq_active_schedule_slot') !== false;
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

    // Completing a burial schedule is the moment a lot's lease actually starts,
    // but nothing previously created the expiration_records row that Expiration
    // Monitoring (and Lot::syncExpiredLots()) rely on to ever flag/expire it later
    // — staff had to remember to add it by hand.
    //
    // Dedupes on (lot_id, start_date) rather than lot_id alone: a lot can be
    // freed (relocation, or a manual reset after expiring) and rebooked later,
    // and that new occupancy needs its own lease record with its own start/end
    // dates. Keying on lot_id alone would see the old, already-lapsed record
    // and silently skip creating one for the new tenant — leaving nothing for
    // syncExpiredLots() to key off going forward. Only guards against the same
    // schedule being marked Completed twice (identical start_date).
    private function createLeaseRecordIfMissing($lotId, $startDate) {
        $start = $startDate ?: date('Y-m-d');

        $existingRecords = $this->expirationModel->findAll(['lot_id' => $lotId]);
        foreach ($existingRecords as $record) {
            if ($record['start_date'] === $start) {
                return;
            }
        }

        $endDate = date('Y-m-d', strtotime($start . ' +' . self::DEFAULT_LEASE_YEARS . ' years'));

        $this->expirationModel->create([
            'lot_id' => $lotId,
            'start_date' => $start,
            'end_date' => $endDate,
            'renewed' => 'no',
            'exhumation_status' => 'Pending',
            'notes' => 'Auto-created on burial schedule completion (' . self::DEFAULT_LEASE_YEARS . '-year lease term).',
        ]);
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

        // A provisional booking (no formal decedent_records row yet — see
        // store()) can be Pending/Confirmed, but the burial can't be marked
        // Completed until staff has finished registering the real decedent
        // record via linkDecedent(). Non-blocking up to this point, required
        // from here on, per the automation plan's state-transition rules.
        if (isset($data['status']) && $data['status'] === 'Completed') {
            $resolvedDeceasedId = array_key_exists('deceased_id', $data) ? $data['deceased_id'] : $existing['deceased_id'];
            if (empty($resolvedDeceasedId)) {
                return ['error' => 'This booking still needs a formal decedent record before it can be marked Completed. Finish it from Decedent Records first.', 'code' => 422];
            }
        }

        $data['confirmed_by'] = isset($data['confirmed_by']) ? $data['confirmed_by'] : $userId;
        $result = $this->scheduleModel->update($id, $data);
        if ($result) {
            $lotId = $data['lot_id'] ?? $existing['lot_id'];
            if (isset($data['status']) && $data['status'] === 'Confirmed' && $existing['status'] !== 'Confirmed') {
                // H2: payment.verified/Lot (from syncLotStatusForVerifiedPurchase())
                // already reserved this lot moments earlier in the same request, so
                // running transitionLotStatus() here too would just rewrite
                // Reserved -> Reserved and log a redundant schedule.confirmed/Lot
                // audit for the same logical reservation. Only skip it when both the
                // automation flag is set AND the lot is confirmed already Reserved —
                // if the lot isn't Reserved yet (e.g. syncLotStatusForVerifiedPurchase
                // no-op'd for some reason) this still needs to run so the transition
                // isn't lost. Manual confirmation (no flag) is completely unaffected.
                $lotAlreadyReservedByPayment = !empty($data['_auditedByAutomationEngine'])
                    && ($this->lotModel->findById($lotId)['status'] ?? null) === 'Reserved';

                if (!$lotAlreadyReservedByPayment) {
                    $this->transitionLotStatus($lotId, 'Reserved', ['Available', 'Reserved'], $user, 'schedule.confirmed');
                }
                // Batch F: _auditedByAutomationEngine is set only by
                // PaymentController::autoConfirmScheduleForVerifiedPurchase()'s
                // apply() callback — that call is already wrapped in
                // AutomationEngine::run('payment.verified', 'Schedule', ...),
                // which logs its own audit entry. Logging again here would be
                // exactly the duplicate-noise this batch was told to avoid.
                // override_exception_id, by contrast, means this same PUT
                // came from the Exceptions page's "confirm anyway" checkbox —
                // that's a distinct, meaningful fact (an admin overrode a
                // flagged exception) that deserves its own clearly-labeled
                // entry, not to be logged as an ordinary confirmation.
                if (empty($data['_auditedByAutomationEngine'])) {
                    if (!empty($data['override_exception_id'])) {
                        $this->auditLogModel->log(
                            'Schedule confirmed (admin override of exception)',
                            self::actorId($user),
                            self::actorUsername($user),
                            'Schedule',
                            $id,
                            ['exception_id' => (int) $data['override_exception_id'], 'previous_status' => $existing['status']]
                        );
                    } else {
                        $this->auditLogModel->log(
                            'Schedule confirmed',
                            self::actorId($user),
                            self::actorUsername($user),
                            'Schedule',
                            $id,
                            ['previous_status' => $existing['status']]
                        );
                    }
                }
                $this->notifyScheduleStatusChange($existing, 'Confirmed', $existing['created_by']);
            } elseif (isset($data['status']) && $data['status'] === 'Completed' && $existing['status'] !== 'Completed') {
                // Available is included alongside Reserved: an admin/staff PUT
                // may mark a Pending schedule Completed directly (skipping the
                // Confirmed step) — see the guard note on transitionLotStatus()
                // below. That's pre-existing, allowed behavior; this transition
                // must keep accepting it, not just the normal Reserved->Occupied path.
                $this->transitionLotStatus($lotId, 'Occupied', ['Available', 'Reserved'], $user, 'schedule.completed');
                $this->createLeaseRecordIfMissing($lotId, $existing['schedule_date']);
                // No AutomationEngine path currently marks a schedule Completed
                // (only a direct admin/staff action does), so no suppression
                // check is needed here — unlike the Confirmed branch above.
                $this->auditLogModel->log(
                    'Schedule completed',
                    self::actorId($user),
                    self::actorUsername($user),
                    'Schedule',
                    $id,
                    ['previous_status' => $existing['status']]
                );
                $this->notifyScheduleStatusChange($existing, 'Completed', $existing['created_by']);
            }
            return ['success' => true, 'message' => 'Schedule updated'];
        }

        return ['error' => 'Failed to update schedule', 'code' => 500];
    }

    // Called right after decedent-requests/{id}/approve succeeds (staff has
    // just created the real decedent_records row for a provisional booking's
    // decedent_request_id) to link that formal record onto the schedule —
    // this is what satisfies update()'s Completed guard above.
    // decedent_request_id is deliberately left untouched, not cleared: it
    // stays as the audit trail of which request the formal record came from.
    // Batch F: $isAutomaticLink defaults to false because the one external,
    // human-facing caller of this method is the manual PUT
    // schedules/{id}/link-decedent fallback route — that call should always
    // get its own distinct audit entry. The single automatic caller
    // (DecedentRequestController::autoLinkSchedules()'s AutomationEngine
    // apply() callback) explicitly passes true, since AutomationEngine
    // already logs a 'decedent_request.approved' entry for that same fact —
    // logging here too would duplicate it.
    public function linkDecedent($id, $decedentId, $user, $isAutomaticLink = false) {
        $existing = $this->scheduleModel->findById($id);
        if (!$existing) {
            return ['error' => 'Schedule not found', 'code' => 404];
        }
        if (empty($decedentId)) {
            return ['error' => 'decedent_id is required', 'code' => 400];
        }
        if (!empty($existing['deceased_id'])) {
            return ['error' => 'This schedule already has a formal decedent record linked', 'code' => 409];
        }

        $result = $this->scheduleModel->update($id, ['deceased_id' => $decedentId]);
        if ($result && !$isAutomaticLink) {
            $this->auditLogModel->log(
                'Decedent manually linked to schedule',
                self::actorId($user),
                self::actorUsername($user),
                'Schedule',
                $id,
                ['decedent_id' => (int) $decedentId]
            );
        }
        return $result
            ? ['success' => true, 'message' => 'Decedent record linked to schedule']
            : ['error' => 'Failed to link decedent record', 'code' => 500];
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

        // Batch E (Admin-Wide Automation Audit): idempotency guard for the
        // one case the old hard-delete path got for free (a second delete on
        // an already-gone row was just a 404 on re-fetch above). A soft
        // cancel leaves the row in place, so without this an admin
        // re-clicking Cancel on an already-cancelled reservation would
        // re-notify the owner and re-attempt (harmlessly, but noisily) the
        // lot release every time.
        if ($existing['status'] === 'Cancelled') {
            return ['error' => 'This reservation has already been cancelled', 'code' => 409];
        }

        // Soft-cancel (Batch E): previously a hard DELETE, which meant
        // Schedule::getStats()'s cancellation_rate could never reflect
        // reality (no Cancelled rows ever existed to count) and cancelling
        // permanently erased the booking's history. Persisting the status
        // instead keeps that history and lets it show up correctly in
        // reports. Schedule::checkConflict() already excludes
        // status != 'Cancelled', so the lot+date+time slot is immediately
        // re-bookable — see migration_20260825_soft_cancel_schedules.sql for
        // the DB-level constraint that had to change to allow that.
        $result = $this->scheduleModel->update($id, ['status' => 'Cancelled']);
        if ($result) {
            if (in_array($existing['status'], ['Confirmed', 'Pending'], true)) {
                $this->transitionLotStatus($existing['lot_id'], 'Available', ['Available', 'Reserved'], $user, 'schedule.cancelled');
            }
            // Batch F: no AutomationEngine path ever cancels a schedule — this
            // is always a direct citizen/admin/staff action, so no
            // suppression check is needed (unlike the Confirmed branch above).
            $this->auditLogModel->log(
                'Schedule cancelled',
                self::actorId($user),
                self::actorUsername($user),
                'Schedule',
                $id,
                ['previous_status' => $existing['status']]
            );
            $this->notifyScheduleStatusChange($existing, 'Cancelled', $existing['created_by']);
            return ['success' => true, 'message' => 'Schedule cancelled'];
        }

        return ['error' => 'Failed to cancel schedule', 'code' => 500];
    }

    // Batch C (Admin-Wide Automation Audit): the shared wrapper every
    // schedule-triggered lot status change in this controller goes through —
    // reuses Lot::transitionStatus() as the one authoritative write, and
    // AutomationEngine for the same validate/apply/audit/exception envelope
    // already proven by the payment-verified auto-confirm and decedent-request
    // auto-link paths. A rejected transition (lot not in an expected status)
    // raises a system_exceptions entry instead of silently doing nothing or
    // overwriting a status some other process already moved past.
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
