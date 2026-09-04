<?php
require_once __DIR__ . '/../models/Decedent.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../models/Schedule.php';

class DecedentController {
    private $decedentModel;
    private $auditLogModel;
    private $scheduleModel;

    // Fields never written to audit_logs.details verbatim — the audit only
    // needs to show a sensitive field changed, not its value.
    private const SENSITIVE_FIELDS = ['dob', 'dod', 'cause_of_death', 'contact_name', 'contact_number', 'is_cremated', 'ash_storage'];

    public function __construct() {
        $this->decedentModel = new Decedent();
        $this->auditLogModel = new AuditLog();
        $this->scheduleModel = new Schedule();
    }

    private static function actorId($actor) {
        return is_array($actor) ? ($actor['user_id'] ?? null) : $actor;
    }

    private static function actorUsername($actor) {
        return is_array($actor) ? ($actor['username'] ?? null) : null;
    }

    private function isFullAccessRole($user) {
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        return in_array($role, ['admin', 'staff'], true);
    }

    // Privacy audit (2026-09-04): decedent_records has no owner/user column
    // of its own, so a citizen's access is scoped indirectly — see
    // Decedent::OWNED_DECEDENT_IDS_SUBQUERY's comment for exactly how
    // "connected to this citizen" is defined (their own bookings/requests
    // that have since been linked to a formal record). This replaces the
    // previous approach (Batch M6) of letting every citizen browse/pick any
    // decedent cemetery-wide with only sensitive FIELDS redacted — that
    // still exposed every other family's name, which is the actual PII a
    // citizen has no legitimate reason to see. Scoping rows instead of
    // redacting fields also means a citizen now sees FULL detail (cause of
    // death, contact info on file, etc.) for their own connected records,
    // which redaction previously hid even from the family it belonged to.
    private function scopeToOwner(&$filters, $user) {
        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $filters['owner_id'] = $userId;
    }

    public function index($filters = [], $pagination = [], $user = null) {
        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;

        if (!$this->isFullAccessRole($user)) {
            $this->scopeToOwner($filters, $user);
        }

        if ($page === null && $perPage === null) {
            return $this->decedentModel->findAll($filters);
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $total = $this->decedentModel->countAll($filters);
        $data = $this->decedentModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);

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

    public function show($id, $user = null) {
        $decedent = $this->decedentModel->findById($id);
        if (!$decedent) {
            return ['error' => 'Decedent record not found', 'code' => 404];
        }
        if ($this->isFullAccessRole($user)) {
            return $decedent;
        }
        $userId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        if (!$this->decedentModel->isOwnedBy($id, $userId)) {
            return ['error' => 'You may only view decedent records connected to your own bookings or requests', 'code' => 403];
        }
        return $decedent;
    }

    // Batch A (data-integrity foundation): both callers below require the
    // same 5 fields and the same dob/dod ordering — shared so the two
    // checks can never drift apart.
    private function validateDates($data) {
        if (strtotime($data['dod']) < strtotime($data['dob'])) {
            return "Field 'dod' cannot be before 'dob'";
        }
        return null;
    }

    // Batch B (duplicate detection): shared by store()/update() so the exact-
    // block / near-duplicate-warning logic can't drift apart between the two.
    // Returns null when it's safe to proceed, or a response array to return
    // to the caller as-is otherwise. $excludeId lets update() ignore the
    // record being edited when comparing against itself.
    private function checkForDuplicates($data, $excludeId = null) {
        $exact = $this->decedentModel->findExactDuplicate($data, $excludeId);
        if ($exact) {
            return [
                'error' => sprintf(
                    "An identical record already exists (D-%d: %s %s, %s to %s).",
                    $exact['decedent_id'], $exact['first_name'], $exact['last_name'], $exact['dob'], $exact['dod']
                ),
                'code' => 409,
            ];
        }

        if (!empty($data['confirm_duplicate'])) {
            return null;
        }

        $near = $this->decedentModel->findNearDuplicates($data, $excludeId);
        if ($near) {
            return [
                'duplicate_warning' => true,
                'message' => 'A similar record already exists. Review before saving.',
                'candidates' => array_map(function ($candidate) {
                    $name = trim(sprintf(
                        '%s %s%s%s',
                        $candidate['first_name'],
                        $candidate['middle_name'] ? $candidate['middle_name'] . ' ' : '',
                        $candidate['last_name'],
                        $candidate['suffix'] ? ' ' . $candidate['suffix'] : ''
                    ));
                    return [
                        'decedent_id' => $candidate['decedent_id'],
                        'name' => $name,
                        'dob' => $candidate['dob'],
                        'dod' => $candidate['dod'],
                    ];
                }, $near),
            ];
        }

        return null;
    }

    // Cremation Phase A: shared by store()/update() so the required-field
    // list (and the cremation-only lot_id exception) can't drift apart
    // between the two. lot_id is only required for a decedent who actually
    // has a burial lot — a cremation-only record (is_cremated === 'yes')
    // legitimately has none; forcing one meant staff had to consume a real,
    // otherwise-unused burial lot just to register a purely-cremated person.
    // See migration_20260903_make_decedent_lot_optional.sql.
    private function requiredFieldsError($data) {
        foreach (['first_name', 'last_name', 'dob', 'dod'] as $field) {
            if (empty($data[$field])) {
                return "Field '$field' is required";
            }
        }
        $isCremationOnly = isset($data['is_cremated']) && $data['is_cremated'] === 'yes';
        if (!$isCremationOnly && empty($data['lot_id'])) {
            return "Field 'lot_id' is required";
        }
        return null;
    }

    public function store($data, $actor = null) {
        if ($fieldError = $this->requiredFieldsError($data)) {
            return ['error' => $fieldError, 'code' => 400];
        }
        if ($dateError = $this->validateDates($data)) {
            return ['error' => $dateError, 'code' => 400];
        }
        if ($duplicateResponse = $this->checkForDuplicates($data)) {
            return $duplicateResponse;
        }

        $data['is_cremated'] = isset($data['is_cremated']) && $data['is_cremated'] === 'yes' ? 'yes' : 'no';

        $result = $this->decedentModel->create($data);
        if ($result) {
            $auditDetails = ['lot_id' => !empty($data['lot_id']) ? (int) $data['lot_id'] : null, 'first_name' => $data['first_name'], 'last_name' => $data['last_name']];
            if (!empty($data['confirm_duplicate'])) {
                $auditDetails['duplicate_warning_overridden'] = true;
            }
            $this->auditLogModel->log(
                'Decedent record created',
                self::actorId($actor),
                self::actorUsername($actor),
                'Decedent',
                $result,
                $auditDetails
            );

            $response = ['success' => true, 'message' => 'Decedent record created', 'decedent_id' => $result];

            // Batch F (suggested schedule linking): Tier 2 automation — the
            // system notices, staff decides. Only surfaces schedules the
            // request-approval flow wouldn't already auto-link on its own
            // (see Schedule::findUnlinkedByLot()'s own comment). Never links
            // automatically; the frontend must send an explicit follow-up
            // PUT schedules/{id}/link-decedent to act on this.
            // Cremation Phase A: nothing to suggest for a lot-less
            // (cremation-only) record — findUnlinkedByLot() expects a real
            // lot_id.
            if (!empty($data['lot_id'])) {
                $unlinkedSchedules = $this->scheduleModel->findUnlinkedByLot($data['lot_id']);
                if ($unlinkedSchedules) {
                    $response['suggested_schedules'] = $unlinkedSchedules;
                }
            }

            return $response;
        }
        return ['error' => 'Failed to create decedent record', 'code' => 500];
    }

    public function update($id, $data, $actor = null) {
        $decedent = $this->decedentModel->findById($id);
        if (!$decedent) {
            return ['error' => 'Decedent record not found', 'code' => 404];
        }

        if ($fieldError = $this->requiredFieldsError($data)) {
            return ['error' => $fieldError, 'code' => 400];
        }
        if ($dateError = $this->validateDates($data)) {
            return ['error' => $dateError, 'code' => 400];
        }
        if ($duplicateResponse = $this->checkForDuplicates($data, $id)) {
            return $duplicateResponse;
        }

        $data['is_cremated'] = isset($data['is_cremated']) && $data['is_cremated'] === 'yes' ? 'yes' : 'no';

        $result = $this->decedentModel->update($id, $data);
        if ($result) {
            $changed = [];
            foreach (['lot_id', 'first_name', 'last_name', 'middle_name', 'suffix', 'dob', 'dod', 'cause_of_death', 'contact_name', 'contact_number', 'is_cremated', 'ash_storage'] as $field) {
                if (!array_key_exists($field, $data)) {
                    continue;
                }
                if ((string) $data[$field] !== (string) ($decedent[$field] ?? '')) {
                    $changed[$field] = in_array($field, self::SENSITIVE_FIELDS, true) ? 'changed' : ['from' => $decedent[$field] ?? null, 'to' => $data[$field]];
                }
            }
            if (!empty($data['confirm_duplicate'])) {
                $changed['duplicate_warning_overridden'] = true;
            }
            $this->auditLogModel->log(
                'Decedent record updated',
                self::actorId($actor),
                self::actorUsername($actor),
                'Decedent',
                $id,
                $changed ?: ['note' => 'Updated decedent record']
            );
            return ['success' => true, 'message' => 'Decedent record updated'];
        }
        return ['error' => 'Failed to update decedent record', 'code' => 500];
    }

    public function destroy($id, $actor = null) {
        $decedent = $this->decedentModel->findById($id);
        if (!$decedent) {
            return ['error' => 'Decedent record not found', 'code' => 404];
        }

        // Batch A: delete() is now a soft delete (sets deleted_at), which
        // never trips MySQL's own FK check the way the previous real DELETE
        // did — this has to be checked explicitly now instead of catching
        // error 1451.
        if ($this->decedentModel->hasRelatedRecords($id)) {
            return ['error' => 'Cannot delete this decedent record: it still has related burial, cremation, or relocation records', 'code' => 409];
        }

        $result = $this->decedentModel->delete($id);
        if ($result) {
            $this->auditLogModel->log(
                'Decedent record deleted',
                self::actorId($actor),
                self::actorUsername($actor),
                'Decedent',
                $id,
                ['lot_id' => $decedent['lot_id'] ?? null, 'first_name' => $decedent['first_name'] ?? null, 'last_name' => $decedent['last_name'] ?? null]
            );
            return ['success' => true, 'message' => 'Decedent record deleted'];
        }
        return ['error' => 'Failed to delete decedent record', 'code' => 500];
    }

    // Privacy audit (2026-09-04): $user added so My Records' stat row shows
    // counts scoped to that citizen's own connected decedents, not a
    // cemetery-wide total — mirrors index()'s identical scoping. Omitted
    // (null) or an admin/staff caller keeps the original unscoped behavior.
    public function stats($user = null) {
        $ownerId = null;
        if (!$this->isFullAccessRole($user)) {
            $ownerId = is_array($user) ? ($user['user_id'] ?? null) : $user;
        }
        $stats = $this->decedentModel->getStats($ownerId);
        if (!$stats) {
            return ['total' => 0, 'burials' => 0, 'cremations' => 0, 'avg_age' => 0, 'needs_attention' => 0];
        }

        $stats['burials'] = (int) ($stats['burials'] ?? 0);
        $stats['cremations'] = (int) ($stats['cremations'] ?? 0);
        $stats['total'] = (int) ($stats['total'] ?? 0);
        $stats['avg_age'] = isset($stats['avg_age']) ? (int) $stats['avg_age'] : 0;
        $stats['needs_attention'] = (int) ($stats['needs_attention'] ?? 0);

        return $stats;
    }
}
