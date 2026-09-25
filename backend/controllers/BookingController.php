<?php
/**
 * BookingController
 * 
 * Unified controller for cemetery booking management.
 * Consolidates burial reservations (burial_schedules) and cremation requests (cremation_records)
 * into a single unified operational hub for Admin and Staff.
 */

require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/../models/SystemException.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../controllers/ScheduleController.php';
require_once __DIR__ . '/../controllers/CremationController.php';
require_once __DIR__ . '/../controllers/ExpirationController.php';
require_once __DIR__ . '/../config/database.php';

class BookingController {
    private Schedule $scheduleModel;
    private Cremation $cremationModel;
    private SystemException $systemExceptionModel;
    private ScheduleController $scheduleController;
    private CremationController $cremationController;
    private PDO $db;

    public function __construct(
        ?Schedule $scheduleModel = null,
        ?Cremation $cremationModel = null,
        ?SystemException $systemExceptionModel = null,
        ?ScheduleController $scheduleController = null,
        ?CremationController $cremationController = null,
        ?PDO $db = null
    ) {
        $this->scheduleModel = $scheduleModel ?? new Schedule();
        $this->cremationModel = $cremationModel ?? new Cremation();
        $this->systemExceptionModel = $systemExceptionModel ?? new SystemException();
        $this->scheduleController = $scheduleController ?? new ScheduleController();
        $this->cremationController = $cremationController ?? new CremationController();
        $this->db = $db ?? Database::getInstance()->getConnection();
    }

    /**
     * Map open system exceptions to lookup sets for O(1) matching.
     */
    private function getOpenExceptionIds(): array {
        try {
            $openExceptions = $this->systemExceptionModel->findAll(['status' => 'open']);
            $scheduleIds = [];
            $cremationIds = [];
            foreach ($openExceptions as $ex) {
                $type = $ex['entity_type'] ?? '';
                $id = (int) ($ex['entity_id'] ?? 0);
                if ($type === 'Schedule') {
                    $scheduleIds[$id] = true;
                } elseif ($type === 'Cremation') {
                    $cremationIds[$id] = true;
                }
            }
            return [$scheduleIds, $cremationIds, count($scheduleIds) + count($cremationIds)];
        } catch (Throwable $t) {
            return [[], [], 0];
        }
    }

    /**
     * Standardize a burial schedule record into the polymorphic booking format.
     */
    public function normalizeBurial(array $s, array $exceptionIds = []): array {
        $firstName = trim((string) ($s['first_name'] ?? ''));
        $lastName = trim((string) ($s['last_name'] ?? ''));
        $fullName = trim($firstName . ' ' . $lastName);
        $provName = trim((string) ($s['provisional_name'] ?? ''));
        $decedentName = $fullName !== '' ? $fullName : ($provName !== '' ? $provName . ' (unregistered)' : 'N/A');

        $lotNum = $s['lot_number'] ?? null;
        $secName = $s['section_name'] ?? null;
        $locationStr = $lotNum ? 'Lot ' . $lotNum . ($secName ? ', ' . $secName : '') : 'No lot assigned';

        $schedId = (int) ($s['schedule_id'] ?? 0);
        $date = (string) ($s['schedule_date'] ?? '');
        $time = (string) ($s['schedule_time'] ?? '');
        $dateTime = trim($date . ' ' . $time);

        return [
            'id'                     => $schedId,
            'service_type'           => 'burial',
            'booking_reference'      => 'BUR-' . $schedId,
            'ref_label'              => 'Booking #' . $schedId,
            'decedent_name'          => $decedentName,
            'location_label'         => $locationStr,
            'lot_number'             => $lotNum ?: 'N/A',
            'section_name'           => $secName ?: 'N/A',
            'columbarium'            => null,
            'niche_number'           => null,
            'date_time'              => $dateTime !== '' ? $dateTime : 'N/A',
            'date_raw'               => $date,
            'schedule_time'          => $time,
            'created_by'             => (int) ($s['created_by'] ?? 0),
            'created_by_name'        => $s['created_by_name'] ?? 'N/A',
            'status'                 => $s['status'] ?? 'Pending',
            'payment_status'         => $s['payment_status'] ?? 'Unpaid',
            'payment_amount'         => isset($s['payment_amount']) ? (float) $s['payment_amount'] : null,
            'payment_date'           => $s['payment_date'] ?? null,
            'payment_receipt_number' => $s['payment_receipt_number'] ?? null,
            'payment_id'             => !empty($s['payment_id']) ? (int) $s['payment_id'] : null,
            'notes'                  => $s['notes'] ?? null,
            'has_exception'          => ($s['status'] ?? '') === 'Pending' && !empty($exceptionIds[$schedId]),
            'documents'              => $s['documents'] ?? [],
            'document_summary'       => $s['document_summary'] ?? null,
            'document_status'        => $s['document_summary']['status'] ?? 'pending_physical',
            'document_count'         => $s['document_summary']['uploaded_count'] ?? 0,
            'created_at'             => $s['created_at'] ?? null,
            'updated_at'             => $s['updated_at'] ?? null,
            'raw'                    => $s,
        ];
    }

    /**
     * Standardize a cremation record into the polymorphic booking format.
     */
    public function normalizeCremation(array $c, array $exceptionIds = []): array {
        $firstName = trim((string) ($c['first_name'] ?? ''));
        $lastName = trim((string) ($c['last_name'] ?? ''));
        $fullName = trim($firstName . ' ' . $lastName);
        $provName = trim((string) ($c['provisional_name'] ?? ''));
        $decedentName = $fullName !== '' ? $fullName : ($provName !== '' ? $provName . ' (unregistered)' : 'N/A');

        $columbarium = $c['columbarium'] ?? null;
        $niche = $c['niche_number'] ?? null;
        $nicheText = $niche ? 'Niche ' . $niche : 'TBD';
        $locationStr = ($columbarium ?: 'Columbarium') . ' • ' . $nicheText;

        $cremId = (int) ($c['cremation_id'] ?? 0);
        $date = (string) ($c['cremation_date'] ?? '');

        return [
            'id'                     => $cremId,
            'service_type'           => 'cremation',
            'booking_reference'      => 'CREM-' . $cremId,
            'ref_label'              => 'Request #' . $cremId,
            'decedent_name'          => $decedentName,
            'location_label'         => $locationStr,
            'lot_number'             => null,
            'section_name'           => null,
            'columbarium'            => $columbarium ?: 'N/A',
            'niche_number'           => $niche ?: 'TBD',
            'date_time'              => $date !== '' ? $date : 'N/A',
            'date_raw'               => $date,
            'schedule_time'          => null,
            'created_by'             => (int) ($c['created_by'] ?? 0),
            'created_by_name'        => $c['created_by_name'] ?? 'N/A',
            'status'                 => $c['status'] ?? 'Pending',
            'payment_status'         => $c['payment_status'] ?? 'Unpaid',
            'payment_amount'         => isset($c['payment_amount']) ? (float) $c['payment_amount'] : null,
            'payment_date'           => $c['payment_date'] ?? null,
            'payment_receipt_number' => $c['payment_receipt_number'] ?? null,
            'payment_id'             => !empty($c['payment_id']) ? (int) $c['payment_id'] : null,
            'notes'                  => $c['notes'] ?? null,
            'has_exception'          => ($c['status'] ?? '') === 'Pending' && !empty($exceptionIds[$cremId]),
            'documents'              => $c['documents'] ?? [],
            'document_summary'       => $c['document_summary'] ?? null,
            'document_status'        => $c['document_summary']['status'] ?? 'pending_physical',
            'document_count'         => $c['document_summary']['uploaded_count'] ?? 0,
            'created_at'             => $c['created_at'] ?? null,
            'updated_at'             => $c['updated_at'] ?? null,
            'raw'                    => $c,
        ];
    }

    /**
     * GET /api/bookings
     * Retrieve paginated bookings with optional service_type, status, search, and date filters.
     */
    public function index(array $filters = [], array $pagination = [], $user = null): array {
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if ($user && !in_array($role, ['admin', 'staff'], true)) {
            return ['error' => 'You are not authorized to access booking management', 'code' => 403];
        }

        [$scheduleExceptions, $cremationExceptions] = $this->getOpenExceptionIds();

        $serviceType = strtolower(trim((string) ($filters['service_type'] ?? ($filters['service'] ?? 'all'))));
        $page = !empty($pagination['page']) ? max(1, (int) $pagination['page']) : 1;
        $perPage = !empty($pagination['per_page']) ? max(1, min(100, (int) $pagination['per_page'])) : 10;

        // Clean filters
        $commonFilters = [];
        if (!empty($filters['status'])) {
            $commonFilters['status'] = trim((string) $filters['status']);
        }
        if (!empty($filters['q'])) {
            $commonFilters['q'] = trim((string) $filters['q']);
        }
        if (!empty($filters['date_from'])) {
            $commonFilters['date_from'] = trim((string) $filters['date_from']);
        }
        if (!empty($filters['date_to'])) {
            $commonFilters['date_to'] = trim((string) $filters['date_to']);
        }
        if (!empty($filters['awaiting_confirmation'])) {
            $commonFilters['awaiting_confirmation'] = 1;
        }

        if ($serviceType === 'burial') {
            $total = $this->scheduleModel->countAll($commonFilters);
            $rows = $this->scheduleModel->findAll($commonFilters, ['page' => $page, 'per_page' => $perPage]);
            $items = array_map(fn($s) => $this->normalizeBurial($s, $scheduleExceptions), $rows);
            $totalPages = max(1, (int) ceil($total / $perPage));

            return [
                'success' => true,
                'data'    => $items,
                'meta'    => [
                    'page'        => $page,
                    'per_page'    => $perPage,
                    'total'       => $total,
                    'total_pages' => $totalPages,
                ],
                'code' => 200,
            ];
        }

        if ($serviceType === 'cremation') {
            $cremFilters = $commonFilters;
            if (!empty($cremFilters['status']) && $cremFilters['status'] === 'Confirmed') {
                $cremFilters['status'] = 'Scheduled';
            }
            $total = $this->cremationModel->countAll($cremFilters);
            $rows = $this->cremationModel->findAll($cremFilters, ['page' => $page, 'per_page' => $perPage]);
            $items = array_map(fn($c) => $this->normalizeCremation($c, $cremationExceptions), $rows);
            $totalPages = max(1, (int) ceil($total / $perPage));

            return [
                'success' => true,
                'data'    => $items,
                'meta'    => [
                    'page'        => $page,
                    'per_page'    => $perPage,
                    'total'       => $total,
                    'total_pages' => $totalPages,
                ],
                'code' => 200,
            ];
        }

        // 'all' service type: query burials and cremations, merge, sort, and slice for consistent pagination
        $cremFilters = $commonFilters;
        if (!empty($cremFilters['status']) && $cremFilters['status'] === 'Confirmed') {
            $cremFilters['status'] = 'Scheduled';
        }

        $burialRows = $this->scheduleModel->findAll($commonFilters);
        $cremationRows = $this->cremationModel->findAll($cremFilters);

        $burialItems = array_map(fn($s) => $this->normalizeBurial($s, $scheduleExceptions), $burialRows);
        $cremationItems = array_map(fn($c) => $this->normalizeCremation($c, $cremationExceptions), $cremationRows);

        $merged = array_merge($burialItems, $cremationItems);

        // Sort by schedule date descending, then id descending
        usort($merged, function ($a, $b) {
            $cmp = strcmp((string) ($b['date_raw'] ?? ''), (string) ($a['date_raw'] ?? ''));
            if ($cmp !== 0) {
                return $cmp;
            }
            return ((int) ($b['id'] ?? 0)) - ((int) ($a['id'] ?? 0));
        });

        $total = count($merged);
        $totalPages = max(1, (int) ceil($total / $perPage));
        $offset = ($page - 1) * $perPage;
        $items = array_slice($merged, $offset, $perPage);

        return [
            'success' => true,
            'data'    => $items,
            'meta'    => [
                'page'        => $page,
                'per_page'    => $perPage,
                'total'       => $total,
                'total_pages' => $totalPages,
            ],
            'code' => 200,
        ];
    }

    /**
     * GET /api/bookings/stats
     * Return consolidated metrics across burials, cremations, and open system exceptions.
     */
    public function stats($user = null): array {
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if ($user && !in_array($role, ['admin', 'staff'], true)) {
            return ['error' => 'You are not authorized to view booking statistics', 'code' => 403];
        }

        $schedStats = $this->scheduleModel->getStats();
        $cremStats = $this->cremationModel->getStatusCounts();
        [$scheduleExceptions, $cremationExceptions, $totalExceptions] = $this->getOpenExceptionIds();

        $burialPending = (int) ($schedStats['pending'] ?? 0);
        $burialConfirmed = (int) ($schedStats['confirmed'] ?? 0);
        $burialCompleted = (int) ($schedStats['completed'] ?? 0);
        $burialCancelled = (int) ($schedStats['cancelled'] ?? 0);
        $burialTotal = $burialPending + $burialConfirmed;

        $cremationPending = (int) ($cremStats['pending'] ?? 0);
        $cremationScheduled = (int) ($cremStats['scheduled'] ?? 0);
        $cremationCompleted = (int) ($cremStats['completed'] ?? 0);
        $cremationCancelled = (int) ($cremStats['cancelled'] ?? 0);
        $cremationTotal = $cremationPending + $cremationScheduled;

        $totalBookings = $burialTotal + $cremationTotal;
        $totalCompleted = $burialCompleted + $cremationCompleted;

        return [
            'success' => true,
            'data' => [
                'total_bookings'    => $totalBookings,
                'burials_count'     => $burialTotal,
                'cremations_count'  => $cremationTotal,
                'pending_count'     => $burialPending + $cremationPending,
                'scheduled_count'   => $burialConfirmed + $cremationScheduled,
                'completed_count'   => $totalCompleted,
                'cancelled_count'   => $burialCancelled + $cremationCancelled,
                'exceptions_count'  => $totalExceptions,
                'burials' => [
                    'pending'   => $burialPending,
                    'confirmed' => $burialConfirmed,
                    'completed' => $burialCompleted,
                    'cancelled' => $burialCancelled,
                    'total'     => $burialTotal,
                ],
                'cremations' => [
                    'pending'   => $cremationPending,
                    'scheduled' => $cremationScheduled,
                    'completed' => $cremationCompleted,
                    'cancelled' => $cremationCancelled,
                    'total'     => $cremationTotal,
                ],
            ],
            'code' => 200,
        ];
    }

    /**
     * GET /api/bookings/{service}/{id}
     * Retrieve single booking details with polymorphic normalization.
     */
    public function show(string $service, int $id, $user = null): array {
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if ($user && !in_array($role, ['admin', 'staff'], true)) {
            return ['error' => 'You are not authorized to view booking details', 'code' => 403];
        }

        $service = strtolower(trim($service));
        [$scheduleExceptions, $cremationExceptions] = $this->getOpenExceptionIds();

        if ($service === 'burial') {
            $raw = $this->scheduleController->show($id, $user);
            if (isset($raw['error'])) {
                return $raw;
            }
            return [
                'success' => true,
                'data'    => $this->normalizeBurial($raw, $scheduleExceptions),
                'code'    => 200,
            ];
        }

        if ($service === 'cremation') {
            $raw = $this->cremationController->show($id, $user);
            if (isset($raw['error'])) {
                return $raw;
            }
            return [
                'success' => true,
                'data'    => $this->normalizeCremation($raw, $cremationExceptions),
                'code'    => 200,
            ];
        }

        return ['error' => "Invalid service type '{$service}'. Must be 'burial' or 'cremation'", 'code' => 400];
    }

    /**
     * PUT /api/bookings/{service}/{id}
     * Unified mutation gateway delegating to the appropriate sub-controller.
     * Preserves all domain rules, lot occupancy transitions, lease creations,
     * niche auto-assignments, and notifications.
     */
    public function updateStatus(string $service, int $id, array $data, $user): array {
        $service = strtolower(trim($service));

        if ($service === 'burial') {
            return $this->scheduleController->update($id, $data, $user);
        }

        if ($service === 'cremation') {
            return $this->cremationController->update($id, $data, $user);
        }

        return ['error' => "Invalid service type '{$service}'. Must be 'burial' or 'cremation'", 'code' => 400];
    }

    /**
     * POST /api/bookings/{service}/{id}/documents
     * Attach an official requirement document (Death Certificate, Permit, Valid ID) directly to a booking.
     */
    public function uploadDocument(string $service, int $id, ?array $file, string $docType, $user): array {
        if (!$file) {
            return ['error' => 'No valid document file was uploaded', 'code' => 400];
        }
        require_once __DIR__ . '/../services/BookingDocumentService.php';
        $docService = new BookingDocumentService();
        return $docService->uploadBookingDocument($service, $id, $file, $docType, $user);
    }

    /**
     * POST /api/bookings/sweep
     * Admin-authorized on-demand execution of the full automation sweep suite.
     */
    public function runSweep($user): array {
        $role = strtolower(is_array($user) ? ($user['role'] ?? '') : '');
        if ($role !== 'admin') {
            return ['error' => 'Only administrators may trigger automation sweeps', 'code' => 403];
        }

        $expirationController = new ExpirationController();
        $lotModel = new Lot();
        $results = [];

        $stages = [
            'expiration-records/generate-notifications' => fn() => $expirationController->generateNotifications(),
            'schedules/notify-stale-pending'            => fn() => $this->scheduleController->notifyStalePending(),
            'schedules/send-final-warnings'             => fn() => $this->scheduleController->sendFinalWarnings(),
            'schedules/auto-cancel-stale-pending'       => fn() => $this->scheduleController->autoCancelStalePending(),
            'schedules/flag-unlinked-decedent'          => fn() => $this->scheduleController->flagUnlinkedDecedentSchedules(),
            'cremations/notify-stale-pending'           => fn() => $this->cremationController->notifyStalePending(),
            'cremations/send-final-warnings'            => fn() => $this->cremationController->sendFinalWarnings(),
            'cremations/auto-cancel-stale-pending'      => fn() => $this->cremationController->autoCancelStalePending(),
            'lots.expired-sync'                         => function () use ($lotModel) {
                $lotModel->getStats();
                return ['message' => 'lot expiration sync triggered'];
            },
        ];

        foreach ($stages as $label => $callable) {
            try {
                $res = $callable();
                $msg = is_array($res) && isset($res['message']) ? $res['message'] : 'completed';
                $results[$label] = ['status' => 'success', 'message' => $msg];
            } catch (Throwable $e) {
                $results[$label] = ['status' => 'error', 'message' => $e->getMessage()];
            }
        }

        return [
            'success'   => true,
            'message'   => 'Automation sweep completed',
            'stages'    => $results,
            'timestamp' => date('Y-m-d H:i:s'),
            'code'      => 200,
        ];
    }
}
