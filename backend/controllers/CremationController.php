<?php
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../services/AutomationEngine.php';
require_once __DIR__ . '/../models/Notification.php';
require_once __DIR__ . '/../models/CapacityAlert.php';

class CremationController {
    private $cremationModel;
    private $decedentModel;
    private $auditLogModel;

    public function __construct() {
        $this->cremationModel = new Cremation();
        $this->decedentModel = new Decedent();
        $this->auditLogModel = new AuditLog();
    }

    public function index($filters = [], $pagination = []) {
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

    public function show($id) {
        $record = $this->cremationModel->findById($id);
        if (!$record) {
            return ['error' => 'Cremation record not found', 'code' => 404];
        }
        return $record;
    }

    public function store($data, $userId) {
        $required = ['deceased_id'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        $decedent = $this->decedentModel->findById($data['deceased_id']);
        if (!$decedent) {
            return ['error' => 'Decedent not found', 'code' => 404];
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
        // that may still be days away.
        if (empty($data['niche_number']) && ($data['status'] ?? 'Scheduled') === 'Completed') {
            return $this->createWithAutoNiche($data, $userId);
        }

        $data['created_by'] = $userId;
        $result = $this->cremationModel->create($data);
        if ($result) {
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
            $this->auditLogModel->log(
                'Cremation record created',
                $userId,
                null,
                'Cremation',
                $result,
                ['deceased_id' => (int) $data['deceased_id'], 'niche_number' => $data['niche_number'] ?? null, 'status' => $data['status'] ?? 'Scheduled']
            );
            return ['success' => true, 'message' => 'Cremation record created'];
        }

        return ['error' => 'Failed to create cremation record', 'code' => 500];
    }

    // Full Automation, Admin-First (Round 2): mirrors assignNiche() below
    // almost exactly (findNextAvailableNiche() suggestion, re-checked right
    // before the write, both inside one AutomationEngine envelope so a
    // no-niches-available failure raises a reviewable system_exceptions
    // entry — tagged to Decedent, same convention as assignNiche() — instead
    // of silently creating a Completed record with no ash location). The
    // only difference is this path also creates the cremation_records row
    // itself (assignNiche() assumes the caller already has deceased_id and
    // nothing else); if creation fails outright that's a genuine 500, not an
    // automation exception.
    private function createWithAutoNiche($data, $userId) {
        $deceasedId = (int) $data['deceased_id'];
        $columbarium = $data['columbarium'] ?? null;
        $cremationModel = $this->cremationModel;
        $decedentModel = $this->decedentModel;
        $createData = $data;
        $createData['created_by'] = $userId;

        $automationResult = AutomationEngine::run(
            'cremation.niche_assigned',
            'Decedent',
            $deceasedId,
            $userId,
            function () use ($cremationModel, $columbarium, &$createData) {
                $suggestion = $cremationModel->findNextAvailableNiche($columbarium);
                if (!$suggestion) {
                    return ['No available niches in columbarium ' . ($columbarium ?: 'Columbarium A') . ' — assign one manually once space opens up, or choose another columbarium'];
                }
                $createData['niche_number'] = $suggestion['niche_number'];
                $createData['columbarium'] = $suggestion['columbarium'];
                if (empty($createData['level'])) {
                    $createData['level'] = $suggestion['level'];
                }
                return true;
            },
            function () use ($cremationModel, $decedentModel, &$createData) {
                $newId = $cremationModel->create($createData);
                if ($newId) {
                    $decedentModel->patchCremationStatus($createData['deceased_id'], [
                        'is_cremated' => 'yes',
                        'ash_storage' => $createData['niche_number'],
                    ]);
                }
                return ['cremation_id' => $newId, 'niche_number' => $createData['niche_number'] ?? null];
            }
        );

        if (empty($automationResult['success'])) {
            return ['error' => 'No niches are currently available for automatic assignment — flagged for review under Exceptions.', 'code' => 409];
        }
        if (empty($automationResult['result']['cremation_id'])) {
            return ['error' => 'Failed to create cremation record', 'code' => 500];
        }

        return [
            'success' => true,
            'message' => 'Cremation record created and niche auto-assigned',
            'niche_number' => $automationResult['result']['niche_number'],
        ];
    }

    public function update($id, $data, $userId) {
        $existing = $this->cremationModel->findById($id);
        if (!$existing) {
            return ['error' => 'Cremation record not found', 'code' => 404];
        }

        if (!empty($data['niche_number']) && $data['niche_number'] != $existing['niche_number']) {
            if (!$this->cremationModel->isNicheAvailable($data['niche_number'])) {
                return ['error' => 'This niche is already occupied', 'code' => 409];
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
            if (!empty($decedentData)) {
                $this->decedentModel->patchCremationStatus($existing['deceased_id'], $decedentData);
            }

            // Sub-batch 1 (Batch G): _auditedByAutomationEngine is set only by
            // PaymentController::autoUpdateCremationForVerifiedPayment()'s
            // apply() callback — that call is already wrapped in
            // AutomationEngine::run('payment.verified', 'Cremation', ...),
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
            return ['success' => true, 'message' => 'Cremation record updated'];
        }

        return ['error' => 'Failed to update cremation record', 'code' => 500];
    }

    public function destroy($id, $userId = null) {
        $existing = $this->cremationModel->findById($id);
        if (!$existing) {
            return ['error' => 'Cremation record not found', 'code' => 404];
        }

        $result = $this->cremationModel->delete($id);
        if ($result) {
            $this->decedentModel->patchCremationStatus($existing['deceased_id'], [
                'is_cremated' => 'no',
                'ash_storage' => null
            ]);
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
}
