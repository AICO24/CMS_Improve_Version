<?php
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/DecedentRequest.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/User.php';
require_once __DIR__ . '/../models/CapacityAlert.php';
require_once __DIR__ . '/../services/AutomationEngine.php';
require_once __DIR__ . '/../config/database.php';

class CremationController {
    private $cremationModel;
    private $decedentModel;
    private $requestModel;
    private $auditLogModel;

    public function __construct() {
        $this->cremationModel = new Cremation();
        $this->decedentModel = new Decedent();
        $this->requestModel = new DecedentRequest();
        $this->auditLogModel = new AuditLog();
    }

    // Cremation Phase B: a citizen (the only caller that ever passes $user)
    // is scoped to only their own cremation records — mirrors
    // ScheduleController::index()'s identical Batch M6/N5 pattern. Before
    // this phase, index()/show() had no scoping at all: any authenticated
    // user could enumerate every cremation record — latent since citizens
    // had no legitimate reason to call this, but a real gap once citizen
    // self-service opens.
    public function index($filters = [], $pagination = [], $user = null) {
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if ($user && !in_array($role, ['admin', 'staff'], true)) {
            $filters['created_by'] = is_array($user) ? ($user['user_id'] ?? null) : $user;
        }

        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;

        if ($page === null && $perPage === null) {
            return $this->cremationModel->findAll($filters);
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $total = $this->cremationModel->countAll($filters);
        $data = $this->cremationModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);

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

    public function mine($userId, $filters = []) {
        $filters['created_by'] = $userId;

        $page = !empty($filters['page']) ? (int) $filters['page'] : null;
        $perPage = !empty($filters['per_page']) ? (int) $filters['per_page'] : null;

        if ($page !== null || $perPage !== null) {
            $page = max(1, $page ?: 1);
            $perPage = max(1, min(100, $perPage ?: 10));
            $total = $this->cremationModel->countAll($filters);
            $data = $this->cremationModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);
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

        return $this->cremationModel->findAll($filters);
    }

    public function show($id, $user = null) {
        $record = $this->cremationModel->findById($id);
        if (!$record) {
            return ['error' => 'Cremation record not found', 'code' => 404];
        }
        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $userRole = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if ($user && !in_array($userRole, ['admin', 'staff'], true) && (int) $record['created_by'] !== (int) $userId) {
            return ['error' => 'You may only view your own cremation requests', 'code' => 403];
        }
        return $record;
    }

    // Cremation Phase B: $user is now the full actor (was a bare $userId) —
    // role is needed to branch citizen vs. admin/staff, mirroring
    // ScheduleController::store()'s identical shape.
    public function store($data, $user) {
        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $userRole = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        $isCitizen = $userRole === 'user';

        // A citizen may book without an existing decedent_records row — the
        // person isn't registered yet. Staff formalizes the real record
        // later via linkDecedent(). Admin/staff bookings still require a
        // real deceased_id — mirrors ScheduleController::store()'s identical
        // rule and reasoning (they already have direct create access to
        // Decedent Records, so there's no need for the indirect request path).
        if (empty($data['deceased_id'])) {
            if (!$isCitizen) {
                return ['error' => "Field 'deceased_id' is required", 'code' => 400];
            }

            $decedentRequestId = $data['decedent_request_id'] ?? null;
            if (!empty($decedentRequestId)) {
                $existingRequest = $this->requestModel->findById($decedentRequestId);
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
                $decedentRequestId = $this->requestModel->create([
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
            $decedent = $this->decedentModel->findById($data['deceased_id']);
            if (!$decedent) {
                return ['error' => 'Decedent not found', 'code' => 404];
            }
        }

        // A citizen never picks a niche or sets status directly — booking
        // always starts Pending; the niche is auto-assigned only later, at
        // Completion (see update()'s completeWithAutoNiche() dispatch).
        // preferred_columbarium maps onto the existing columbarium column
        // (no new column — it already doubles as "requested/assigned
        // columbarium" the same way createWithAutoNiche() below reads it).
        if ($isCitizen) {
            unset($data['niche_number']);
            $data['status'] = 'Pending';
            if (!empty($data['preferred_columbarium'])) {
                $data['columbarium'] = $data['preferred_columbarium'];
            }
            unset($data['preferred_columbarium']);
        }

        if (!empty($data['niche_number']) && !$this->cremationModel->isNicheAvailable($data['niche_number'])) {
            return ['error' => 'This niche is already occupied', 'code' => 409];
        }

        // Full Automation, Admin-First (Round 2): a Completed record (ashes
        // ready for storage) used to always need a SEPARATE trip through the
        // "Assign Niche" modal (assignNiche() below) when the general
        // creation form was submitted without picking one first — the exact
        // same gap assignNiche() already exists to close, just reached from
        // a different entry point. Scoped to status === 'Completed' only: a
        // merely Scheduled cremation (the physical cremation hasn't happened
        // yet) has no ashes to store, so nothing should reserve a niche for
        // it this early — that would just lock up capacity for cremations
        // that may still be days away. Unreachable for a citizen (status is
        // forced to Pending above).
        if (empty($data['niche_number']) && ($data['status'] ?? 'Scheduled') === 'Completed') {
            return $this->createWithAutoNiche($data, $userId);
        }

        $data['created_by'] = $userId;
        $result = $this->cremationModel->create($data);
        if ($result) {
            // Cremation Phase B: nothing to patch yet for a provisional
            // (deceased_id-less) booking — see linkDecedent()/autoLinkCremations().
            if (!empty($data['deceased_id'])) {
                $updateData = [];
                if (!empty($data['niche_number'])) {
                    $updateData['ash_storage'] = $data['niche_number'];
                } elseif (!empty($data['ash_storage_location'])) {
                    $updateData['ash_storage'] = $data['ash_storage_location'];
                }
                if (!empty($updateData)) {
                    $updateData['is_cremated'] = isset($data['status']) && $data['status'] === 'Completed' ? 'yes' : 'no';
                    $this->decedentModel->patchCremationStatus($data['deceased_id'], $updateData);
                }
            }
            $this->auditLogModel->log(
                'Cremation record created',
                $userId,
                null,
                'Cremation',
                $result,
                ['deceased_id' => !empty($data['deceased_id']) ? (int) $data['deceased_id'] : null, 'niche_number' => $data['niche_number'] ?? null, 'status' => $data['status'] ?? 'Scheduled']
            );
            $this->notifyCremation($data, $userId);
            return ['success' => true, 'message' => 'Cremation record created', 'cremation_id' => $result];
        }

        return ['error' => 'Failed to create cremation record', 'code' => 500];
    }

    // Cremation Phase B: shared by createWithAutoNiche() (admin/staff
    // direct-creation shortcut, pre-existing) and completeWithAutoNiche()
    // (new — a Pending/Scheduled cremation marked Completed with no niche
    // picked, per the confirmed product decision that the niche is only
    // ever auto-assigned AT Completion, never earlier). Both need the
    // identical AutomationEngine-wrapped "suggest a niche in $columbarium,
    // re-check it's still free right before writing" envelope — only what
    // the actual write does (create a new row vs. update an existing one)
    // differs, hence the $persist callback. $persist(array $suggestion):
    // ['cremation_id' => int|false, 'niche_number' => string] performs the
    // write and returns the outcome.
    private function autoAssignNiche($deceasedId, $columbarium, $userId, callable $persist) {
        $cremationModel = $this->cremationModel;
        $suggestion = null;

        $automationResult = AutomationEngine::run(
            'cremation.niche_assigned',
            'Decedent',
            $deceasedId,
            $userId,
            function () use ($cremationModel, $columbarium, &$suggestion) {
                $suggestion = $cremationModel->findNextAvailableNiche($columbarium);
                if (!$suggestion) {
                    return ['No available niches in columbarium ' . ($columbarium ?: 'Columbarium A') . ' — assign one manually once space opens up, or choose another columbarium'];
                }
                return true;
            },
            function () use (&$suggestion, $persist) {
                return $persist($suggestion);
            }
        );

        if (empty($automationResult['success'])) {
            return ['error' => 'No niches are currently available for automatic assignment — flagged for review under Exceptions.', 'code' => 409];
        }
        if (empty($automationResult['result']['cremation_id'])) {
            return ['error' => 'Failed to save cremation record', 'code' => 500];
        }

        return [
            'success' => true,
            'cremation_id' => $automationResult['result']['cremation_id'],
            'niche_number' => $automationResult['result']['niche_number'],
        ];
    }

    // Full Automation, Admin-First (Round 2): a Completed record (ashes
    // ready for storage) used to always need a SEPARATE trip through the
    // "Assign Niche" modal (assignNiche() below) when the general creation
    // form was submitted without picking one first. Now a thin caller of
    // autoAssignNiche() above; behavior/error messages unchanged from before
    // this refactor.
    private function createWithAutoNiche($data, $userId) {
        $deceasedId = (int) $data['deceased_id'];
        $columbarium = $data['columbarium'] ?? null;
        $cremationModel = $this->cremationModel;
        $decedentModel = $this->decedentModel;

        $result = $this->autoAssignNiche($deceasedId, $columbarium, $userId, function ($suggestion) use ($cremationModel, $decedentModel, $data, $userId) {
            $createData = $data;
            $createData['created_by'] = $userId;
            $createData['niche_number'] = $suggestion['niche_number'];
            $createData['columbarium'] = $suggestion['columbarium'];
            if (empty($createData['level'])) {
                $createData['level'] = $suggestion['level'];
            }
            $newId = $cremationModel->create($createData);
            if ($newId) {
                $decedentModel->patchCremationStatus($createData['deceased_id'], [
                    'is_cremated' => 'yes',
                    'ash_storage' => $createData['niche_number'],
                ]);
            }
            return ['cremation_id' => $newId, 'niche_number' => $createData['niche_number'] ?? null];
        });

        if (isset($result['error'])) {
            return $result;
        }

        return [
            'success' => true,
            'message' => 'Cremation record created and niche auto-assigned',
            'niche_number' => $result['niche_number'],
        ];
    }

    // Cremation Phase B: the new third call site for autoAssignNiche() —
    // staff (or the automated payment-verified path, indirectly) marks a
    // Pending/Scheduled cremation Completed with no niche_number supplied
    // (existing or incoming). Mirrors ScheduleController::update()'s
    // Completed branch calling createLeaseRecordIfMissing(): the niche is
    // assigned at exactly this transition, not before. $data may include
    // other field changes submitted alongside the status change; merged
    // over $existing before writing, same "full row required" convention
    // Cremation::update() already has.
    private function completeWithAutoNiche($id, $existing, $data, $userId) {
        $deceasedId = !empty($existing['deceased_id']) ? (int) $existing['deceased_id'] : null;
        if (!$deceasedId) {
            return ['error' => 'This cremation still needs a formal decedent record before it can be marked Completed. Finish it from Decedent Records first.', 'code' => 422];
        }
        $columbarium = $data['columbarium'] ?? $existing['columbarium'] ?? null;
        $cremationModel = $this->cremationModel;
        $decedentModel = $this->decedentModel;

        $result = $this->autoAssignNiche($deceasedId, $columbarium, $userId, function ($suggestion) use ($cremationModel, $decedentModel, $id, $existing, $data, $deceasedId) {
            $mergedData = array_merge($existing, $data);
            $mergedData['status'] = 'Completed';
            $mergedData['niche_number'] = $suggestion['niche_number'];
            $mergedData['columbarium'] = $suggestion['columbarium'];
            if (empty($mergedData['level'])) {
                $mergedData['level'] = $suggestion['level'];
            }
            $ok = $cremationModel->update($id, $mergedData);
            if ($ok) {
                $decedentModel->patchCremationStatus($deceasedId, [
                    'is_cremated' => 'yes',
                    'ash_storage' => $mergedData['niche_number'],
                ]);
            }
            return ['cremation_id' => $ok ? $id : false, 'niche_number' => $mergedData['niche_number']];
        });

        if (isset($result['error'])) {
            return $result;
        }

        $this->auditLogModel->log(
            'Cremation record completed (niche auto-assigned)',
            $userId,
            null,
            'Cremation',
            $id,
            ['previous_status' => $existing['status'], 'niche_number' => $result['niche_number']]
        );
        $this->notifyCremationStatusChange($existing, 'Completed', $existing['created_by']);

        return ['success' => true, 'message' => 'Cremation record updated', 'niche_number' => $result['niche_number']];
    }

    // Cremation Phase B: $userId is now $user (full actor) — role is needed
    // to restrict a citizen to editing their own still-Pending request only,
    // mirroring ScheduleController::update()'s identical guard.
    public function update($id, $data, $user) {
        $existing = $this->cremationModel->findById($id);
        if (!$existing) {
            return ['error' => 'Cremation record not found', 'code' => 404];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $userRole = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        $isStaffOrAdmin = in_array($userRole, ['admin', 'staff'], true);

        if (!$isStaffOrAdmin) {
            if ($existing['created_by'] != $userId) {
                return ['error' => 'You may only update your own cremation requests', 'code' => 403];
            }
            if ($existing['status'] !== 'Pending') {
                return ['error' => 'Only pending cremation requests may be updated', 'code' => 403];
            }
            // Confirming/completing a cremation stays staff/admin-only —
            // strip from a self-service edit, mirrors ScheduleController::update().
            unset($data['status'], $data['niche_number']);
        }

        if (!empty($data['niche_number']) && $data['niche_number'] != $existing['niche_number']) {
            if (!$this->cremationModel->isNicheAvailable($data['niche_number'])) {
                return ['error' => 'This niche is already occupied', 'code' => 409];
            }
        }

        // Cremation Phase B: staff marking a Pending/Scheduled cremation
        // Completed with no niche picked (existing or incoming) — the niche
        // is auto-assigned at exactly this transition, never earlier. See
        // completeWithAutoNiche()'s comment.
        if (isset($data['status']) && $data['status'] === 'Completed' && $existing['status'] !== 'Completed') {
            $resolvedNiche = array_key_exists('niche_number', $data) ? $data['niche_number'] : $existing['niche_number'];
            if (empty($resolvedNiche)) {
                return $this->completeWithAutoNiche($id, $existing, $data, $userId);
            }
        }

        $result = $this->cremationModel->update($id, $data);
        if ($result) {
            $decedentData = [];
            if (isset($data['status'])) {
                if ($data['status'] === 'Completed') {
                    $decedentData['is_cremated'] = 'yes';
                } elseif ($data['status'] === 'Cancelled') {
                    $decedentData['is_cremated'] = 'no';
                }
            }
            if (!empty($data['niche_number'])) {
                $decedentData['ash_storage'] = $data['niche_number'];
            } elseif (isset($data['ash_storage_location'])) {
                $decedentData['ash_storage'] = $data['ash_storage_location'];
            }
            // Cremation Phase B: guarded — a provisional (deceased_id-less)
            // booking has nothing to patch yet.
            if (!empty($decedentData) && !empty($existing['deceased_id'])) {
                $this->decedentModel->patchCremationStatus($existing['deceased_id'], $decedentData);
            }

            // Sub-batch 1 (Batch G): _auditedByAutomationEngine is set only by
            // PaymentController::autoUpdateCremationForVerifiedPayment()'s /
            // autoConfirmCremationForVerifiedPayment()'s apply() callbacks —
            // those calls are already wrapped in AutomationEngine::run(),
            // which logs its own audit entry. Logging again here would be
            // exactly the duplicate-noise this project's audit batches have
            // consistently avoided (see ScheduleController::update()'s
            // identical convention from Batch F).
            if (empty($data['_auditedByAutomationEngine'])) {
                $changed = [];
                foreach (['status', 'niche_number', 'columbarium', 'level', 'ash_storage_location'] as $field) {
                    if (array_key_exists($field, $data) && (string) $data[$field] !== (string) ($existing[$field] ?? '')) {
                        $changed[$field] = ['from' => $existing[$field] ?? null, 'to' => $data[$field]];
                    }
                }
                $this->auditLogModel->log(
                    'Cremation record updated',
                    $userId,
                    null,
                    'Cremation',
                    $id,
                    $changed ?: ['note' => 'Updated cremation record']
                );
            }

            // Cremation Phase B: push notifications on the transitions a
            // citizen actually cares about — mirrors
            // ScheduleController::update()'s identical pattern. Guarded to
            // the SPECIFIC transition, not fired on every update touching
            // status (e.g. admin-direct creation already defaults to
            // Scheduled — never an actual Pending -> Scheduled transition).
            if (isset($data['status']) && $data['status'] !== $existing['status']) {
                if ($data['status'] === 'Scheduled' && $existing['status'] === 'Pending') {
                    $this->notifyCremationStatusChange($existing, 'Scheduled', $existing['created_by']);
                } elseif ($data['status'] === 'Completed') {
                    $this->notifyCremationStatusChange($existing, 'Completed', $existing['created_by']);
                } elseif ($data['status'] === 'Cancelled') {
                    $this->notifyCremationStatusChange($existing, 'Cancelled', $existing['created_by']);
                }
            }

            return ['success' => true, 'message' => 'Cremation record updated'];
        }

        return ['error' => 'Failed to update cremation record', 'code' => 500];
    }

    // Cremation Phase B: $userId is now $user (full actor). Admin/staff
    // behavior (hard delete of the record — genuine removal, the
    // pre-existing admin-direct workflow) is completely unchanged. A citizen
    // cancelling their own still-Pending request instead gets a soft cancel
    // (status = 'Cancelled'), mirroring ScheduleController::destroy()'s
    // soft-cancel convention — a citizen withdrawing a request isn't the
    // same operation as an admin deleting a record outright.
    public function destroy($id, $user = null) {
        $existing = $this->cremationModel->findById($id);
        if (!$existing) {
            return ['error' => 'Cremation record not found', 'code' => 404];
        }

        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $userRole = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        $isStaffOrAdmin = in_array($userRole, ['admin', 'staff'], true);

        if (!$isStaffOrAdmin) {
            if ($existing['created_by'] != $userId) {
                return ['error' => 'You may only cancel your own cremation requests', 'code' => 403];
            }
            if ($existing['status'] !== 'Pending') {
                return ['error' => 'Only pending cremation requests may be canceled', 'code' => 403];
            }
            if ($existing['status'] === 'Cancelled') {
                return ['error' => 'This cremation request has already been cancelled', 'code' => 409];
            }

            $result = $this->cremationModel->update($id, array_merge($existing, ['status' => 'Cancelled']));
            if ($result) {
                $this->auditLogModel->log(
                    'Cremation request cancelled',
                    $userId,
                    null,
                    'Cremation',
                    $id,
                    ['previous_status' => $existing['status']]
                );
                $this->notifyCremationStatusChange($existing, 'Cancelled', $existing['created_by']);
                return ['success' => true, 'message' => 'Cremation request cancelled'];
            }
            return ['error' => 'Failed to cancel cremation request', 'code' => 500];
        }

        $result = $this->cremationModel->delete($id);
        if ($result) {
            if (!empty($existing['deceased_id'])) {
                $this->decedentModel->patchCremationStatus($existing['deceased_id'], [
                    'is_cremated' => 'no',
                    'ash_storage' => null
                ]);
            }
            $this->auditLogModel->log(
                'Cremation record deleted',
                $userId,
                null,
                'Cremation',
                $id,
                ['deceased_id' => $existing['deceased_id'] ?? null, 'niche_number' => $existing['niche_number'] ?? null]
            );
            return ['success' => true, 'message' => 'Cremation record deleted'];
        }

        return ['error' => 'Failed to delete cremation record', 'code' => 500];
    }

    public function getNiches($columbarium = null) {
        return $this->cremationModel->getNiches($columbarium);
    }

    public function getStats($columbarium = null) {
        $stats = $this->cremationModel->getStats($columbarium);
        $this->maybeAlertColumbariumCapacity();
        return $stats;
    }

    // Batch G Sub-batch 3: deterministic capacity alerting for columbarium
    // occupancy, reusing Batch D's CapacityAlert dedup pattern exactly (see
    // AiController::maybeAlertCapacity(), the burial-lot equivalent this
    // mirrors). Evaluates every columbarium actually in use — not just
    // whichever one this particular getStats() call happened to be scoped
    // to — so a capacity issue in one columbarium isn't missed just because
    // an admin is currently viewing a different one's tab.
    //
    // Thresholds (80% warning / 95% critical) intentionally match the same
    // percentage bands used for burial-lot forecasting — not blindly
    // inherited, but deliberately chosen because Cremation::getStats()'s
    // occupancy_rate is computed the exact same way (occupied/capacity*100),
    // making the same bands equally meaningful here. Reuses the existing
    // capacity calculation untouched (Cremation::getStats()) — this method
    // only reads its result, never recomputes occupancy itself.
    //
    // Never lets a failure here affect the stats response — matching the
    // exact defensive pattern already established in Batch D.
    private const CAPACITY_WARNING_THRESHOLD = 80;
    private const CAPACITY_CRITICAL_THRESHOLD = 95;

    private function maybeAlertColumbariumCapacity() {
        try {
            $columbariums = $this->cremationModel->getDistinctColumbariums();
            if (empty($columbariums)) {
                return;
            }

            $capacityAlertModel = new CapacityAlert();

            foreach ($columbariums as $columbarium) {
                $columbariumStats = $this->cremationModel->getStats($columbarium);
                $rate = (float) ($columbariumStats['occupancy_rate'] ?? 0);

                $status = null;
                if ($rate >= self::CAPACITY_CRITICAL_THRESHOLD) {
                    $status = 'critical';
                } elseif ($rate >= self::CAPACITY_WARNING_THRESHOLD) {
                    $status = 'warning';
                }

                if ($status === null) {
                    continue;
                }

                // Prefix scopes dedup to THIS columbarium's own alert stream
                // (see CapacityAlert::lastAlertKeyForPrefix()'s comment) —
                // independent columbariums never suppress/interfere with
                // each other's alerts.
                $prefix = 'cremation:' . $columbarium . ':';
                $alertKey = $prefix . $status;
                if ($capacityAlertModel->lastAlertKeyForPrefix($prefix) === $alertKey) {
                    continue;
                }

                $statusLabel = $status === 'critical' ? 'Critical' : 'Warning';
                $notificationModel = new Notification();
                $notificationModel->create([
                    'title' => "Columbarium {$statusLabel}: {$columbarium}",
                    'message' => "Columbarium {$columbarium} occupancy reaches {$rate}%. Review Cremation Management for details.",
                    'notification_type' => 'System',
                    'is_read' => 0,
                ]);

                $this->auditLogModel->log(
                    'Capacity alert generated',
                    null,
                    null,
                    'CremationCapacity',
                    null,
                    ['alert_key' => $alertKey, 'columbarium' => $columbarium, 'status' => $status, 'occupancy_rate' => $rate]
                );

                // occupancy_rate is stored as a 0-1 fraction (matching the
                // burial-lot forecast's own convention and the column's
                // DECIMAL(6,4) precision) even though Cremation computes it
                // as a 0-100 percentage — converting here, not changing the
                // column or Cremation::getStats() itself.
                $capacityAlertModel->record($alertKey, date('Y-m'), $status, $rate / 100);
            }
        } catch (Exception $e) {
            // Deliberately swallowed — cremation stats must never fail
            // because the alerting side-channel had a problem.
        }
    }

    public function columbariums() {
        $list = $this->cremationModel->getDistinctColumbariums();
        // Always offer the default even before any real record uses it —
        // otherwise a brand-new install would show an empty dropdown.
        if (!in_array('Columbarium A', $list, true)) {
            array_unshift($list, 'Columbarium A');
        }
        return $list;
    }

    public function suggestNiche($columbarium = null) {
        // getNiches()/the virtual 10-slot grid only correctly represents a
        // SINGLE columbarium at a time — passing null merges every
        // columbarium's records into one grid keyed by niche_number suffix,
        // so two columbariums that each have an "N-2" would collide and
        // overwrite each other. Always pin to a real columbarium here
        // (defaulting to the same 'Columbarium A' default used elsewhere)
        // so the suggestion is never computed against that merged view.
        $columbarium = $columbarium ?: 'Columbarium A';
        $suggestion = $this->cremationModel->findNextAvailableNiche($columbarium);
        if (!$suggestion) {
            return [
                'available' => false,
                'message' => 'No available niches in this columbarium. Try another columbarium.',
            ];
        }
        return array_merge(['available' => true], $suggestion);
    }

    // Sub-batch 2 (Batch G): the availability check and the write are now
    // protected by AutomationEngine so the authoritative re-check happens
    // immediately before the write, narrowing (schema/no-unique-constraint
    // means it can't fully close, see the Sub-batch 2 report) the race
    // window between "checked available" and "wrote the row". The early
    // isNicheAvailable() check below is kept as-is — it preserves the
    // existing fast, ordinary 409 for the common case (niche already taken
    // at request time) exactly as before; the engine-wrapped re-check is the
    // new, narrower guard right before the actual write.
    public function assignNiche($data, $userId) {
        if (empty($data['deceased_id']) || empty($data['niche_number'])) {
            return ['error' => 'Decedent ID and niche number are required', 'code' => 400];
        }

        $decedent = $this->decedentModel->findById($data['deceased_id']);
        if (!$decedent) {
            return ['error' => 'Decedent not found', 'code' => 404];
        }

        if (!$this->cremationModel->isNicheAvailable($data['niche_number'])) {
            return ['error' => 'This niche is already occupied', 'code' => 409];
        }

        $deceasedId = (int) $data['deceased_id'];
        $nicheNumber = $data['niche_number'];
        $cremationData = [
            'deceased_id' => $deceasedId,
            'niche_number' => $nicheNumber,
            'columbarium' => $data['columbarium'] ?? null,
            'level' => isset($data['level']) ? (int) $data['level'] : null,
            'status' => 'Completed',
            'ash_storage_location' => $nicheNumber,
            'created_by' => $userId,
        ];

        $cremationModel = $this->cremationModel;
        $decedentModel = $this->decedentModel;

        // entity_type/id is Decedent, not Cremation: the cremation_records
        // row doesn't exist yet at this point (nothing to reference until
        // apply() creates it), and "this decedent now has a niche" is the
        // fact that actually changes — same reasoning already used for
        // decedent_request.approved in Batch B, which tags the entity that
        // changed rather than the one that triggered the event. The
        // resulting cremation_id is still fully traceable in the audit's
        // own 'result' details.
        $automationResult = AutomationEngine::run(
            'cremation.niche_assigned',
            'Decedent',
            $deceasedId,
            $userId,
            function () use ($cremationModel, $nicheNumber) {
                if (!$cremationModel->isNicheAvailable($nicheNumber)) {
                    return ['Niche ' . $nicheNumber . ' was assigned to someone else before this could complete'];
                }
                return true;
            },
            function () use ($cremationModel, $decedentModel, $cremationData, $deceasedId, $nicheNumber) {
                $newId = $cremationModel->create($cremationData);
                if ($newId) {
                    $decedentModel->patchCremationStatus($deceasedId, [
                        'is_cremated' => 'yes',
                        'ash_storage' => $nicheNumber,
                    ]);
                }
                return ['cremation_id' => $newId, 'niche_number' => $nicheNumber];
            }
        );

        if (empty($automationResult['success'])) {
            // validate() failed -> AutomationEngine already raised a
            // system_exceptions entry. Preserve the same 409 semantics the
            // early check above already uses for "niche taken".
            return ['error' => 'This niche was just taken by another assignment. Please choose a different niche.', 'code' => 409];
        }

        // AutomationEngine::run() doesn't inspect apply()'s own return value
        // for success/failure — it only reflects whether validate() passed.
        // Checking cremation_id here preserves the original create()-failure
        // handling (a genuine DB-level failure, distinct from a niche race).
        if (empty($automationResult['result']['cremation_id'])) {
            return ['error' => 'Failed to assign decedent to niche', 'code' => 500];
        }

        return ['success' => true, 'message' => 'Decedent assigned to niche'];
    }

    // Called right after decedent-requests/{id}/approve succeeds (staff has
    // just created the real decedent_records row for a provisional
    // cremation's decedent_request_id) to link that formal record onto the
    // cremation — mirrors ScheduleController::linkDecedent() exactly,
    // including the same audit-suppression convention for the automatic
    // caller (DecedentRequestController::autoLinkCremations()).
    public function linkDecedent($id, $decedentId, $user, $isAutomaticLink = false) {
        $existing = $this->cremationModel->findById($id);
        if (!$existing) {
            return ['error' => 'Cremation record not found', 'code' => 404];
        }
        if (empty($decedentId)) {
            return ['error' => 'decedent_id is required', 'code' => 400];
        }
        if (!empty($existing['deceased_id'])) {
            return ['error' => 'This cremation record already has a formal decedent record linked', 'code' => 409];
        }

        $result = $this->cremationModel->update($id, array_merge($existing, ['deceased_id' => $decedentId]));
        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        if ($result && !$isAutomaticLink) {
            $this->auditLogModel->log(
                'Decedent manually linked to cremation',
                $userId,
                is_array($user) ? ($user['username'] ?? null) : null,
                'Cremation',
                $id,
                ['decedent_id' => (int) $decedentId]
            );
        }
        return $result
            ? ['success' => true, 'message' => 'Decedent record linked to cremation']
            : ['error' => 'Failed to link decedent record', 'code' => 500];
    }

    // Mirrors ScheduleController::notifySchedule() — fires on submit.
    private function notifyCremation($data, $userId) {
        $notificationModel = new Notification();
        $userModel = new User();
        $user = $userModel->findById($userId);

        $isPending = ($data['status'] ?? 'Scheduled') === 'Pending';
        $title = $isPending ? 'Cremation Request Submitted' : 'Cremation Record Created';
        $message = $isPending
            ? sprintf('Your cremation request%s has been submitted and is Pending payment/confirmation.', !empty($data['columbarium']) ? ' for ' . $data['columbarium'] : '')
            : 'A cremation record has been created.';

        $notificationModel->create([
            'title' => $title,
            'message' => $message,
            'notification_type' => 'Cremation',
            'user_id' => $userId,
            'is_read' => 0,
        ]);

        if (!empty($user['email'])) {
            $this->sendEmail($user['email'], $title, $message);
        }
    }

    // Mirrors ScheduleController::notifyScheduleStatusChange() — fires on
    // Pending -> Scheduled, -> Completed, -> Cancelled.
    private function notifyCremationStatusChange($cremation, $status, $recipientUserId) {
        $notificationModel = new Notification();
        $userModel = new User();
        $recipient = $userModel->findById($recipientUserId);

        $titles = [
            'Scheduled' => 'Cremation Confirmed',
            'Completed' => 'Cremation Service Completed',
            'Cancelled' => 'Cremation Request Cancelled',
        ];
        $verbs = [
            'Scheduled' => 'has been confirmed',
            'Completed' => 'has been marked completed',
            'Cancelled' => 'has been cancelled',
        ];
        $title = $titles[$status] ?? ('Cremation ' . $status);
        $message = sprintf(
            'Your cremation request%s %s.',
            !empty($cremation['columbarium']) ? ' at ' . $cremation['columbarium'] : '',
            $verbs[$status] ?? 'was updated'
        );

        $notificationModel->create([
            'title' => $title,
            'message' => $message,
            'notification_type' => 'Cremation',
            'user_id' => $recipientUserId,
            'is_read' => 0,
        ]);

        if (!empty($recipient['email'])) {
            $this->sendEmail($recipient['email'], $title, $message);
        }
    }

    // Mirrors ScheduleController::sendEmail()'s deferred-until-commit
    // pattern — see that method's comment for why.
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
}
