<?php
/**
 * BookingAvailabilityService
 * 
 * Booking Automation V2 — Batch 4: Availability Intelligence, Booking Recovery & Conversational Guidance
 * 
 * Lightweight, deterministic orchestration and query service for cemetery booking availability.
 * Reuses authoritative domain models and views:
 * - Schedule::checkConflict()
 * - v_available_lots view
 * - Cremation::findNextAvailableNiche(), Cremation::isNicheAvailable()
 * - BookingAgentService::validateBookingDate(), BookingAgentService::evaluateMissingFields()
 * 
 * CRITICAL ARCHITECTURAL CONSTRAINTS:
 * 1. Strictly READ-ONLY. Zero database mutations, zero draft mutations, zero audit logs, zero notifications.
 * 2. Purely ADVISORY. Never locks resources, never creates pending actions, never auto-substitutes dates or lots.
 * 3. Execution-time transactional revalidation remains authoritative during confirmation.
 */

require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/Cremation.php';
require_once __DIR__ . '/BookingAgentService.php';

class BookingAvailabilityService {
    private PDO $db;
    private Schedule $scheduleModel;
    private Lot $lotModel;
    private Cremation $cremationModel;
    private ?BookingAgentService $agentService;

    public const DEFAULT_SCHEDULE_TIMES = ['09:00', '11:00', '14:00'];
    public const MAX_SEARCH_DAYS = 14;
    public const MAX_ALTERNATIVES = 3;

    // Reason & Status Codes
    public const CODE_DATE_AVAILABLE         = 'DATE_AVAILABLE';
    public const CODE_DATE_RESTRICTED_MONDAY = 'DATE_RESTRICTED_MONDAY';
    public const CODE_DATE_RESTRICTED_PAST   = 'DATE_RESTRICTED_PAST';
    public const CODE_INVALID_DATE           = 'INVALID_DATE';
    public const CODE_SLOT_AVAILABLE         = 'SLOT_AVAILABLE';
    public const CODE_SLOT_CONFLICT          = 'SLOT_CONFLICT';
    public const CODE_LOT_AVAILABLE          = 'LOT_AVAILABLE';
    public const CODE_LOT_UNAVAILABLE        = 'LOT_UNAVAILABLE';
    public const CODE_LOT_NOT_FOUND          = 'LOT_NOT_FOUND';
    public const CODE_NICHE_AVAILABLE        = 'NICHE_AVAILABLE';
    public const CODE_NICHE_UNAVAILABLE      = 'NICHE_UNAVAILABLE';
    public const CODE_NO_NICHE_AVAILABLE     = 'NO_NICHE_AVAILABLE';
    public const CODE_NO_ACTIVE_DRAFT        = 'NO_ACTIVE_DRAFT';
    public const CODE_DRAFT_COMPLETE         = 'DRAFT_REQUIREMENTS_COMPLETE';
    public const CODE_DRAFT_MISSING          = 'DRAFT_REQUIREMENTS_MISSING';
    public const CODE_CLARIFICATION_REQUIRED = 'CLARIFICATION_REQUIRED';

    public function __construct(
        ?PDO $db = null,
        ?Schedule $scheduleModel = null,
        ?Lot $lotModel = null,
        ?Cremation $cremationModel = null,
        ?BookingAgentService $agentService = null
    ) {
        $this->db = $db ?? Database::getInstance()->getConnection();
        $this->scheduleModel = $scheduleModel ?? new Schedule();
        $this->lotModel = $lotModel ?? new Lot();
        $this->cremationModel = $cremationModel ?? new Cremation();
        $this->agentService = $agentService;
    }

    private function getAgentService(): BookingAgentService {
        if ($this->agentService === null) {
            $this->agentService = new BookingAgentService();
        }
        return $this->agentService;
    }

    /**
     * Method 1: checkDateAvailability()
     * Validates date format, past date restriction, and cemetery Monday closure for burial.
     * Reuses BookingAgentService::validateBookingDate().
     */
    public function checkDateAvailability(string $date, string $serviceType = 'burial'): array {
        $cleanDate = trim($date);
        $timestamp = strtotime($cleanDate);
        if ($timestamp === false) {
            return [
                'available'    => false,
                'reason_code'  => self::CODE_INVALID_DATE,
                'code'         => self::CODE_INVALID_DATE,
                'date'         => $cleanDate,
                'service_type' => $serviceType,
                'advisory'     => true,
                'message'      => 'Invalid date format. Please specify a valid date (e.g. YYYY-MM-DD).'
            ];
        }

        $formattedDate = date('Y-m-d', $timestamp);
        $today = date('Y-m-d');

        if ($formattedDate < $today) {
            return [
                'available'    => false,
                'reason_code'  => self::CODE_DATE_RESTRICTED_PAST,
                'code'         => self::CODE_DATE_RESTRICTED_PAST,
                'date'         => $formattedDate,
                'service_type' => $serviceType,
                'advisory'     => true,
                'message'      => 'Booking date cannot be in the past. Please select a future date.'
            ];
        }

        $isBurial = (strtolower($serviceType) === 'burial');
        if ($isBurial && (int) date('N', $timestamp) === 1) {
            return [
                'available'    => false,
                'reason_code'  => self::CODE_DATE_RESTRICTED_MONDAY,
                'code'         => self::CODE_DATE_RESTRICTED_MONDAY,
                'date'         => $formattedDate,
                'service_type' => $serviceType,
                'advisory'     => true,
                'message'      => 'Burial services are not available on Mondays (cemetery maintenance policy). Please select another day.'
            ];
        }

        return [
            'available'    => true,
            'reason_code'  => self::CODE_DATE_AVAILABLE,
            'code'         => self::CODE_DATE_AVAILABLE,
            'date'         => $formattedDate,
            'service_type' => $serviceType,
            'advisory'     => true,
            'message'      => "The date {$formattedDate} is open for {$serviceType} bookings."
        ];
    }

    /**
     * Method 2: checkSlotAvailability()
     * Checks authoritative schedule conflict for a specific lot, date, and optional time.
     * Reuses Schedule::checkConflict().
     */
    public function checkSlotAvailability(int $lotId, string $date, ?string $time = null, string $serviceType = 'burial'): array {
        $dateValidation = $this->checkDateAvailability($date, $serviceType);
        if (!$dateValidation['available']) {
            return array_merge($dateValidation, [
                'lot_id' => $lotId,
                'time'   => $time
            ]);
        }
        $formattedDate = $dateValidation['date'];

        // Validate lot existence
        $stmt = $this->db->prepare("
            SELECT l.lot_id, l.lot_number, l.status, s.section_name, b.block_name
            FROM lots l
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections s ON b.section_id = s.section_id
            WHERE l.lot_id = ?
            LIMIT 1
        ");
        $stmt->execute([(int) $lotId]);
        $lotRecord = $stmt->fetch(PDO::FETCH_ASSOC);

        if (!$lotRecord) {
            return [
                'available'    => false,
                'reason_code'  => self::CODE_LOT_NOT_FOUND,
                'code'         => self::CODE_LOT_NOT_FOUND,
                'lot_id'       => $lotId,
                'date'         => $formattedDate,
                'time'         => $time,
                'service_type' => $serviceType,
                'advisory'     => true,
                'message'      => "Lot #{$lotId} does not exist in the cemetery registry."
            ];
        }

        // Authoritative conflict check via Schedule::checkConflict
        $hasConflict = $this->scheduleModel->checkConflict($lotId, $formattedDate, $time);

        if ($hasConflict) {
            return [
                'available'    => false,
                'reason_code'  => self::CODE_SLOT_CONFLICT,
                'code'         => self::CODE_SLOT_CONFLICT,
                'lot_id'       => $lotId,
                'lot_number'   => $lotRecord['lot_number'],
                'section_name' => $lotRecord['section_name'],
                'date'         => $formattedDate,
                'time'         => $time,
                'service_type' => $serviceType,
                'advisory'     => true,
                'message'      => "Lot {$lotRecord['lot_number']} is already booked on {$formattedDate}" . ($time ? " at {$time}" : "") . "."
            ];
        }

        return [
            'available'    => true,
            'reason_code'  => self::CODE_SLOT_AVAILABLE,
            'code'         => self::CODE_SLOT_AVAILABLE,
            'lot_id'       => $lotId,
            'lot_number'   => $lotRecord['lot_number'],
            'section_name' => $lotRecord['section_name'],
            'date'         => $formattedDate,
            'time'         => $time,
            'service_type' => $serviceType,
            'advisory'     => true,
            'message'      => "Lot {$lotRecord['lot_number']} is available on {$formattedDate}" . ($time ? " at {$time}" : "") . "."
        ];
    }

    /**
     * Resolves human-readable lot identifier (e.g. "Lot A-14", "A2-03", "8")
     * strictly against authoritative database tables.
     */
    public function resolveLotIdentifier(string $identifier, ?string $sectionHint = null): array {
        $clean = trim($identifier);
        $clean = preg_replace('/^lot\s*(?:#|id|number)?\s*:?\s*/i', '', $clean);
        $clean = trim($clean);

        if ($clean === '') {
            return ['status' => 'NOT_FOUND', 'matches' => [], 'lot' => null];
        }

        // 1. Direct lot_id match if numeric
        if (is_numeric($clean)) {
            $numId = (int) $clean;
            $stmt = $this->db->prepare("
                SELECT l.lot_id, l.lot_number, l.status, s.section_name, b.block_name, t.type_name, l.price
                FROM lots l
                JOIN blocks b ON l.block_id = b.block_id
                JOIN sections s ON b.section_id = s.section_id
                JOIN lot_types t ON l.lot_type_id = t.type_id
                WHERE l.lot_id = ?
            ");
            $stmt->execute([$numId]);
            $match = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($match) {
                return ['status' => 'RESOLVED', 'matches' => [$match], 'lot' => $match];
            }
        }

        // 2. Match by lot_number (case-insensitive)
        $sql = "
            SELECT l.lot_id, l.lot_number, l.status, s.section_name, b.block_name, t.type_name, l.price
            FROM lots l
            JOIN blocks b ON l.block_id = b.block_id
            JOIN sections s ON b.section_id = s.section_id
            JOIN lot_types t ON l.lot_type_id = t.type_id
            WHERE LOWER(l.lot_number) = LOWER(?)
        ";
        $params = [$clean];

        if (!empty($sectionHint)) {
            $sql .= " AND LOWER(s.section_name) LIKE LOWER(?)";
            $params[] = '%' . trim($sectionHint) . '%';
        }

        $stmt = $this->db->prepare($sql);
        $stmt->execute($params);
        $matches = $stmt->fetchAll(PDO::FETCH_ASSOC);

        if (count($matches) === 1) {
            return ['status' => 'RESOLVED', 'matches' => $matches, 'lot' => $matches[0]];
        } elseif (count($matches) > 1) {
            return [
                'status'   => self::CODE_CLARIFICATION_REQUIRED,
                'code'     => self::CODE_CLARIFICATION_REQUIRED,
                'matches'  => $matches,
                'lot'      => null,
                'message'  => "Multiple lots matched the identifier '{$clean}'. Please specify the section (e.g., Section A)."
            ];
        }

        // 3. Fallback: Check if identifier formatted like "A-14" or "A2-03" where prefix is block/section
        if (preg_match('/^([A-Za-z0-9]+)[-_](.+)$/', $clean, $parts)) {
            $prefix = $parts[1];
            $suffix = $parts[2];
            $stmt = $this->db->prepare("
                SELECT l.lot_id, l.lot_number, l.status, s.section_name, b.block_name, t.type_name, l.price
                FROM lots l
                JOIN blocks b ON l.block_id = b.block_id
                JOIN sections s ON b.section_id = s.section_id
                JOIN lot_types t ON l.lot_type_id = t.type_id
                WHERE (LOWER(l.lot_number) = LOWER(?) OR LOWER(l.lot_number) = LOWER(?))
                  AND (LOWER(s.section_name) LIKE LOWER(?) OR LOWER(b.block_name) LIKE LOWER(?))
            ");
            $stmt->execute([$clean, $suffix, "%{$prefix}%", "%{$prefix}%"]);
            $pMatches = $stmt->fetchAll(PDO::FETCH_ASSOC);
            if (count($pMatches) === 1) {
                return ['status' => 'RESOLVED', 'matches' => $pMatches, 'lot' => $pMatches[0]];
            } elseif (count($pMatches) > 1) {
                return [
                    'status'  => self::CODE_CLARIFICATION_REQUIRED,
                    'code'    => self::CODE_CLARIFICATION_REQUIRED,
                    'matches' => $pMatches,
                    'lot'     => null,
                    'message' => "Multiple lots match '{$clean}'. Please provide the specific section or block name."
                ];
            }
        }

        return ['status' => 'NOT_FOUND', 'matches' => [], 'lot' => null];
    }

    /**
     * Method 3: checkGeneralDateAvailability()
     * Aggregate availability inquiry for a date without a specific lot.
     * Never exposes private details of other citizens' bookings.
     */
    public function checkGeneralDateAvailability(string $date, string $serviceType = 'burial'): array {
        $dateValidation = $this->checkDateAvailability($date, $serviceType);
        if (!$dateValidation['available']) {
            return $dateValidation;
        }
        $formattedDate = $dateValidation['date'];

        if (strtolower($serviceType) === 'cremation') {
            // Check capacity for cremation
            $stmt = $this->db->prepare("
                SELECT COUNT(*) as booked_count
                FROM cremation_records
                WHERE cremation_date = ? AND status != 'Cancelled'
            ");
            $stmt->execute([$formattedDate]);
            $bookedCount = (int) ($stmt->fetchColumn() ?: 0);

            $nicheSuggestion = $this->cremationModel->findNextAvailableNiche();

            return [
                'available'           => true,
                'reason_code'         => self::CODE_DATE_AVAILABLE,
                'code'                => self::CODE_DATE_AVAILABLE,
                'date'                => $formattedDate,
                'service_type'        => 'cremation',
                'booked_count'        => $bookedCount,
                'niche_guidance'      => $nicheSuggestion ? [
                    'available'    => true,
                    'niche_number' => $nicheSuggestion['niche_number'],
                    'columbarium'  => $nicheSuggestion['columbarium']
                ] : ['available' => false],
                'advisory'            => true,
                'message'             => "Cremation services are open on {$formattedDate}."
            ];
        }

        // For burial: Query v_available_lots and check non-conflicting lots
        $stmt = $this->db->query("
            SELECT lot_id, lot_number, section_name, block_name, lot_type_name, price
            FROM v_available_lots
            ORDER BY section_name ASC, lot_number ASC
        ");
        $allAvailableLots = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Fetch already scheduled lots for that date
        $schedStmt = $this->db->prepare("
            SELECT DISTINCT lot_id
            FROM burial_schedules
            WHERE schedule_date = ? AND status != 'Cancelled'
        ");
        $schedStmt->execute([$formattedDate]);
        $bookedLotIds = array_flip($schedStmt->fetchAll(PDO::FETCH_COLUMN) ?: []);

        $freeLots = [];
        foreach ($allAvailableLots as $lot) {
            if (!isset($bookedLotIds[(int) $lot['lot_id']])) {
                $freeLots[] = [
                    'lot_id'        => (int) $lot['lot_id'],
                    'lot_number'    => $lot['lot_number'],
                    'section_name'  => $lot['section_name'],
                    'lot_type_name' => $lot['lot_type_name'],
                    'price'         => (float) $lot['price']
                ];
            }
        }

        $freeCount = count($freeLots);
        $sampleLots = array_slice($freeLots, 0, 5);

        if ($freeCount === 0) {
            return [
                'available'           => false,
                'reason_code'         => self::CODE_SLOT_CONFLICT,
                'code'                => self::CODE_SLOT_CONFLICT,
                'date'                => $formattedDate,
                'service_type'        => 'burial',
                'available_lot_count' => 0,
                'sample_lots'         => [],
                'advisory'            => true,
                'message'             => "All burial slots are fully booked for {$formattedDate}."
            ];
        }

        return [
            'available'           => true,
            'reason_code'         => self::CODE_DATE_AVAILABLE,
            'code'                => self::CODE_DATE_AVAILABLE,
            'date'                => $formattedDate,
            'service_type'        => 'burial',
            'available_lot_count' => $freeCount,
            'sample_lots'         => $sampleLots,
            'advisory'            => true,
            'message'             => "There are {$freeCount} available burial lots for {$formattedDate}."
        ];
    }

    /**
     * Method 4: findAlternativeDates()
     * Deterministic search for up to 3 alternative dates within a 14-day search window.
     * Skips past dates and burial Mondays.
     */
    public function findAlternativeDates(
        string $serviceType,
        string $preferredDate,
        ?int $lotId = null,
        ?string $time = null,
        int $limit = self::MAX_ALTERNATIVES
    ): array {
        $limit = max(1, min($limit, self::MAX_ALTERNATIVES));
        $cleanDate = trim($preferredDate);
        $baseTs = strtotime($cleanDate);
        $todayTs = strtotime(date('Y-m-d'));

        // Start search window from the later of (preferredDate + 1 day) or (today + 1 day)
        $startTs = ($baseTs === false || $baseTs < $todayTs) ? strtotime('+1 day', $todayTs) : strtotime('+1 day', $baseTs);

        $alternatives = [];
        $isBurial = (strtolower($serviceType) === 'burial');

        for ($i = 0; $i < self::MAX_SEARCH_DAYS; $i++) {
            $candidateTs = strtotime("+{$i} days", $startTs);
            $candidateDate = date('Y-m-d', $candidateTs);

            // Skip past dates
            if ($candidateDate < date('Y-m-d')) {
                continue;
            }

            // Burial Monday restriction
            if ($isBurial && (int) date('N', $candidateTs) === 1) {
                continue;
            }

            // If specific lot is given, check conflict
            if ($lotId !== null && $lotId > 0) {
                $conflict = $this->scheduleModel->checkConflict($lotId, $candidateDate, $time);
                if ($conflict) {
                    continue;
                }
            } else {
                // General date check: ensure options exist
                $genCheck = $this->checkGeneralDateAvailability($candidateDate, $serviceType);
                if (!$genCheck['available']) {
                    continue;
                }
            }

            $alternatives[] = $candidateDate;
            if (count($alternatives) >= $limit) {
                break;
            }
        }

        return $alternatives;
    }

    /**
     * Method 5: findAlternativeLots()
     * Queries authoritative v_available_lots view only.
     * Prioritizes: same section -> same lot type -> similar price tier.
     * Returns maximum 3 alternatives.
     */
    public function findAlternativeLots(?int $currentLotId, ?string $section = null, int $limit = self::MAX_ALTERNATIVES): array {
        $limit = max(1, min($limit, self::MAX_ALTERNATIVES));

        $targetSection = $section;
        $targetTypeId = null;
        $targetPrice = null;

        if ($currentLotId !== null && $currentLotId > 0) {
            $stmt = $this->db->prepare("
                SELECT l.lot_id, l.lot_type_id, l.price, s.section_name
                FROM lots l
                JOIN blocks b ON l.block_id = b.block_id
                JOIN sections s ON b.section_id = s.section_id
                WHERE l.lot_id = ?
                LIMIT 1
            ");
            $stmt->execute([(int) $currentLotId]);
            $cur = $stmt->fetch(PDO::FETCH_ASSOC);
            if ($cur) {
                $targetSection = $targetSection ?: $cur['section_name'];
                $targetTypeId = (int) $cur['lot_type_id'];
                $targetPrice = (float) $cur['price'];
            }
        }

        // Query available lots strictly from v_available_lots
        $stmt = $this->db->query("
            SELECT lot_id, lot_number, lot_type_id, price, dimensions,
                   block_name, section_id, section_name, lot_type_name
            FROM v_available_lots
        ");
        $allLots = $stmt->fetchAll(PDO::FETCH_ASSOC);

        // Exclude current lot
        $candidates = array_filter($allLots, function ($l) use ($currentLotId) {
            return ($currentLotId === null || (int) $l['lot_id'] !== (int) $currentLotId);
        });

        // Scoring algorithm:
        // +100 for same section
        // +50 for same lot type
        // +20 - price difference penalty
        usort($candidates, function ($a, $b) use ($targetSection, $targetTypeId, $targetPrice) {
            $scoreA = 0;
            $scoreB = 0;

            if ($targetSection) {
                if (strcasecmp($a['section_name'], $targetSection) === 0) $scoreA += 100;
                if (strcasecmp($b['section_name'], $targetSection) === 0) $scoreB += 100;
            }

            if ($targetTypeId) {
                if ((int) $a['lot_type_id'] === $targetTypeId) $scoreA += 50;
                if ((int) $b['lot_type_id'] === $targetTypeId) $scoreB += 50;
            }

            if ($targetPrice !== null && $targetPrice > 0) {
                $diffA = abs((float) $a['price'] - $targetPrice);
                $diffB = abs((float) $b['price'] - $targetPrice);
                if ($diffA < $diffB) $scoreA += 10;
                elseif ($diffB < $diffA) $scoreB += 10;
            }

            if ($scoreA !== $scoreB) {
                return $scoreB <=> $scoreA; // descending
            }

            return ((int) $a['lot_id']) <=> ((int) $b['lot_id']);
        });

        $topLots = array_slice($candidates, 0, $limit);
        return array_map(function ($l) {
            return [
                'lot_id'        => (int) $l['lot_id'],
                'lot_number'    => $l['lot_number'],
                'section_name'  => $l['section_name'],
                'block_name'    => $l['block_name'],
                'lot_type_name' => $l['lot_type_name'],
                'price'         => (float) $l['price'],
                'dimensions'    => $l['dimensions'] ?? null
            ];
        }, $topLots);
    }

    /**
     * Method 6: getCremationNicheGuidance()
     * Reuses Cremation::findNextAvailableNiche().
     * Advisory only.
     */
    public function getCremationNicheGuidance(?string $columbarium = null): array {
        $suggestion = $this->cremationModel->findNextAvailableNiche($columbarium);

        if ($suggestion) {
            return [
                'available'       => true,
                'reason_code'     => self::CODE_NICHE_AVAILABLE,
                'code'            => self::CODE_NICHE_AVAILABLE,
                'suggested_niche' => $suggestion,
                'advisory'        => true,
                'message'         => "Available niche found in {$suggestion['columbarium']}: Niche #{$suggestion['niche_number']} (Level {$suggestion['level']})."
            ];
        }

        return [
            'available'       => false,
            'reason_code'     => self::CODE_NO_NICHE_AVAILABLE,
            'code'            => self::CODE_NO_NICHE_AVAILABLE,
            'suggested_niche' => null,
            'advisory'        => true,
            'message'         => "No available niche found in the requested columbarium."
        ];
    }

    /**
     * Method 7: explainMissingRequirements()
     * Calls BookingAgentService::evaluateMissingFields() without mutating the draft.
     * Generates an authoritative completion checklist and recommended next step.
     */
    public function explainMissingRequirements(?array $draft): array {
        if (!$draft || empty($draft['draft_id'])) {
            return [
                'has_active_draft'      => false,
                'code'                  => self::CODE_NO_ACTIVE_DRAFT,
                'advisory'              => true,
                'missing_fields'        => [],
                'completed_fields'      => [],
                'next_recommended_step' => 'CREATE_BOOKING',
                'reply'                 => "Wala kayong aktibong booking draft sa ngayon. Maaari tayong magsimula ng bagong booking."
            ];
        }

        $serviceType = $draft['service_type'] ?? 'burial';
        $extractedData = !empty($draft['extracted_data'])
            ? (is_array($draft['extracted_data']) ? $draft['extracted_data'] : json_decode($draft['extracted_data'], true))
            : [];

        // Evaluate missing fields strictly using BookingAgentService
        $missingFields = $this->getAgentService()->evaluateMissingFields($serviceType, $extractedData);

        // Compute completed fields
        $requiredFields = ($serviceType === 'burial')
            ? BookingAgentService::REQUIRED_BURIAL_FIELDS
            : BookingAgentService::REQUIRED_CREMATION_FIELDS;

        $completedFields = [];
        foreach ($requiredFields as $req) {
            if (!in_array($req, $missingFields, true)) {
                $completedFields[] = $req;
            }
        }
        if (!empty($extractedData['relationship']) && !in_array('relationship', $completedFields, true)) {
            $completedFields[] = 'relationship';
        }

        // Derive next recommended step
        $nextRecommendedStep = 'CONFIRM_BOOKING';
        if (in_array('decedent_name', $missingFields, true)) {
            $nextRecommendedStep = 'PROVIDE_DECEDENT_NAME';
        } elseif (in_array('preferred_date', $missingFields, true) || in_array('cremation_date', $missingFields, true)) {
            $nextRecommendedStep = 'SELECT_DATE';
        } elseif (in_array('lot_id', $missingFields, true)) {
            $nextRecommendedStep = 'SELECT_LOT';
        } elseif (!empty($missingFields)) {
            $nextRecommendedStep = 'PROVIDE_' . strtoupper($missingFields[0]);
        }

        // Build citizen-friendly bilingual reply
        $fieldLabels = [
            'decedent_name'  => 'Pangalan ng Yumao (Decedent Name)',
            'relationship'    => 'Relasyon sa Yumao (Relationship)',
            'preferred_date'  => 'Petsa ng Libing (Burial Date)',
            'cremation_date'  => 'Petsa ng Cremation (Cremation Date)',
            'lot_id'          => 'Napiling Burial Lot (Lot Selection)',
            'service_type'    => 'Uri ng Serbisyo (Service Type)'
        ];

        $replyLines = [];
        $replyLines[] = "Narito ang status ng inyong {$serviceType} booking checklist:";

        if (!empty($completedFields)) {
            $replyLines[] = "\nKumpleto na:";
            foreach ($completedFields as $cf) {
                $lbl = $fieldLabels[$cf] ?? ucfirst(str_replace('_', ' ', $cf));
                $val = $extractedData[$cf] ?? '';
                $valStr = (is_scalar($val) && (string)$val !== '') ? " (" . (string)$val . ")" : "";
                $replyLines[] = "  ✓ {$lbl}{$valStr}";
            }
        }

        if (!empty($missingFields)) {
            $replyLines[] = "\nKailangan pa nating kumpletuhin:";
            foreach ($missingFields as $mf) {
                $lbl = $fieldLabels[$mf] ?? ucfirst(str_replace('_', ' ', $mf));
                $replyLines[] = "  ○ {$lbl}";
            }
        } else {
            $replyLines[] = "\nKumpleto na ang lahat ng kinakailangang impormasyon! Maaari na nating kumpirmahin ang booking.";
        }

        if ($nextRecommendedStep === 'PROVIDE_DECEDENT_NAME') {
            $replyLines[] = "\nSusunod na hakbang: Pakibigay ang buong pangalan ng yumao.";
        } elseif ($nextRecommendedStep === 'SELECT_DATE') {
            $replyLines[] = "\nSusunod na hakbang: Pakipili ang inyong gustong petsa ng {$serviceType}.";
        } elseif ($nextRecommendedStep === 'SELECT_LOT') {
            $replyLines[] = "\nSusunod na hakbang: Maaari na tayong pumili ng available na burial lot.";
        } elseif ($nextRecommendedStep === 'CONFIRM_BOOKING') {
            $replyLines[] = "\nSusunod na hakbang: Pakireview at kumpirmahin ang detalye ng inyong booking.";
        }

        return [
            'has_active_draft'      => true,
            'code'                  => empty($missingFields) ? self::CODE_DRAFT_COMPLETE : self::CODE_DRAFT_MISSING,
            'advisory'              => true,
            'service_type'          => $serviceType,
            'draft_id'              => (int) ($draft['draft_id'] ?? 0),
            'draft_status'          => $draft['status'] ?? 'INTAKE',
            'missing_fields'        => $missingFields,
            'completed_fields'      => $completedFields,
            'next_recommended_step' => $nextRecommendedStep,
            'checklist'             => [
                'completed'             => $completedFields,
                'missing'               => $missingFields,
                'next_recommended_step' => $nextRecommendedStep
            ],
            'reply'                 => implode("\n", $replyLines)
        ];
    }

    /**
     * Method 8: getResumptionGuidance()
     * Explains current draft progress and guides next interaction.
     * Purely advisory, zero DB mutations.
     */
    public function getResumptionGuidance(array $draft): array {
        $checklist = $this->explainMissingRequirements($draft);

        return [
            'has_active_draft'      => $checklist['has_active_draft'],
            'advisory'              => true,
            'draft_status'          => $draft['status'] ?? 'INTAKE',
            'service_type'          => $draft['service_type'] ?? 'burial',
            'completed_fields'      => $checklist['completed_fields'],
            'missing_fields'        => $checklist['missing_fields'],
            'next_action'           => $checklist['next_recommended_step'],
            'next_recommended_step' => $checklist['next_recommended_step'],
            'reply'                 => $checklist['reply']
        ];
    }
}
