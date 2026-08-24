<?php
require_once __DIR__ . '/../models/SystemException.php';

class SystemExceptionController {
    private $exceptionModel;

    public function __construct() {
        $this->exceptionModel = new SystemException();
    }

    public function index($filters = []) {
        return $this->exceptionModel->findAll($filters);
    }

    public function resolve($id, $data, $user) {
        $exception = $this->exceptionModel->findById($id);
        if (!$exception) {
            return ['error' => 'Exception not found', 'code' => 404];
        }
        if ($exception['status'] !== 'open') {
            return ['error' => 'This exception has already been resolved', 'code' => 409];
        }

        $resolvedBy = is_array($user) ? ($user['user_id'] ?? null) : $user;
        $notes = trim((string) ($data['resolution_notes'] ?? ''));
        if ($notes === '') {
            return ['error' => 'resolution_notes is required', 'code' => 400];
        }

        $result = $this->exceptionModel->resolve($id, $resolvedBy, $notes);
        return $result ? ['success' => true, 'message' => 'Exception resolved'] : ['error' => 'Failed to resolve exception', 'code' => 500];
    }

    public function countOpen() {
        return ['open' => $this->exceptionModel->countOpen()];
    }
}
