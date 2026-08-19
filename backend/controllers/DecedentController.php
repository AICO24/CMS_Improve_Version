<?php
require_once __DIR__ . '/../models/Decedent.php';

class DecedentController {
    private $decedentModel;

    public function __construct() {
        $this->decedentModel = new Decedent();
    }

    // Batch M6: decedent_records has no owner/user column, so there is no
    // way to filter WHICH rows a non-staff caller may see (that would need
    // a schema change, out of scope here). Instead, redact WHICH FIELDS a
    // non-admin/staff caller receives — every citizen can still browse/pick
    // any decedent by name to book a burial (unchanged), but the sensitive
    // fields (dob, dod, cause_of_death, contact_name, contact_number, ...)
    // for every OTHER family are no longer exposed to them.
    private function isFullAccessRole($user) {
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        return in_array($role, ['admin', 'staff'], true);
    }

    private function redactDecedent($decedent) {
        if (!is_array($decedent)) {
            return $decedent;
        }
        return [
            'decedent_id' => $decedent['decedent_id'] ?? null,
            'first_name' => $decedent['first_name'] ?? null,
            'last_name' => $decedent['last_name'] ?? null,
            'middle_name' => $decedent['middle_name'] ?? null,
            'suffix' => $decedent['suffix'] ?? null,
            'lot_id' => $decedent['lot_id'] ?? null,
            'lot_number' => $decedent['lot_number'] ?? null,
            'section_name' => $decedent['section_name'] ?? null,
        ];
    }

    public function index($filters = [], $pagination = [], $user = null) {
        $page = !empty($pagination['page']) ? (int) $pagination['page'] : null;
        $perPage = !empty($pagination['per_page']) ? (int) $pagination['per_page'] : null;
        $fullAccess = $this->isFullAccessRole($user);

        if ($page === null && $perPage === null) {
            $data = $this->decedentModel->findAll($filters);
            return $fullAccess ? $data : array_map([$this, 'redactDecedent'], $data);
        }

        $page = max(1, $page ?: 1);
        $perPage = max(1, min(100, $perPage ?: 10));
        $total = $this->decedentModel->countAll($filters);
        $data = $this->decedentModel->findAll($filters, ['page' => $page, 'per_page' => $perPage]);
        if (!$fullAccess) {
            $data = array_map([$this, 'redactDecedent'], $data);
        }

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
        return $this->isFullAccessRole($user) ? $decedent : $this->redactDecedent($decedent);
    }

    public function store($data) {
        $required = ['lot_id', 'first_name', 'last_name', 'dob', 'dod'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        $data['is_cremated'] = isset($data['is_cremated']) && $data['is_cremated'] === 'yes' ? 'yes' : 'no';

        $result = $this->decedentModel->create($data);
        return $result ? ['success' => true, 'message' => 'Decedent record created', 'decedent_id' => $result] : ['error' => 'Failed to create decedent record', 'code' => 500];
    }

    public function update($id, $data) {
        $decedent = $this->decedentModel->findById($id);
        if (!$decedent) {
            return ['error' => 'Decedent record not found', 'code' => 404];
        }

        $required = ['lot_id', 'first_name', 'last_name', 'dob', 'dod'];
        foreach ($required as $field) {
            if (empty($data[$field])) {
                return ['error' => "Field '$field' is required", 'code' => 400];
            }
        }

        $data['is_cremated'] = isset($data['is_cremated']) && $data['is_cremated'] === 'yes' ? 'yes' : 'no';

        $result = $this->decedentModel->update($id, $data);
        return $result ? ['success' => true, 'message' => 'Decedent record updated'] : ['error' => 'Failed to update decedent record', 'code' => 500];
    }

    public function destroy($id) {
        $decedent = $this->decedentModel->findById($id);
        if (!$decedent) {
            return ['error' => 'Decedent record not found', 'code' => 404];
        }

        $result = $this->decedentModel->delete($id);
        return $result ? ['success' => true, 'message' => 'Decedent record deleted'] : ['error' => 'Failed to delete decedent record', 'code' => 500];
    }

    public function stats() {
        $stats = $this->decedentModel->getStats();
        if (!$stats) {
            return ['total' => 0, 'burials' => 0, 'cremations' => 0, 'avg_age' => 0];
        }

        $stats['burials'] = (int) ($stats['burials'] ?? 0);
        $stats['cremations'] = (int) ($stats['cremations'] ?? 0);
        $stats['total'] = (int) ($stats['total'] ?? 0);
        $stats['avg_age'] = isset($stats['avg_age']) ? (int) $stats['avg_age'] : 0;

        return $stats;
    }
}
