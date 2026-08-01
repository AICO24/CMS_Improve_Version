<?php
require_once __DIR__ . '/../models/Decedent.php';

class DecedentController {
    private $decedentModel;

    public function __construct() {
        $this->decedentModel = new Decedent();
    }

    public function index($filters = []) {
        return $this->decedentModel->findAll($filters);
    }

    public function show($id) {
        $decedent = $this->decedentModel->findById($id);
        return $decedent ?: ['error' => 'Decedent record not found', 'code' => 404];
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
        return $result ? ['success' => true, 'message' => 'Decedent record created'] : ['error' => 'Failed to create decedent record', 'code' => 500];
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
