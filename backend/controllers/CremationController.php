<?php
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../services/AutomationEngine.php';

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
        return $this->cremationModel->getStats($columbarium);
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
