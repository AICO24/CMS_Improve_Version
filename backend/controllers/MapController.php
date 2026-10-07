<?php
require_once __DIR__ . '/../models/Cemetery.php';
require_once __DIR__ . '/../models/Section.php';
require_once __DIR__ . '/../models/Block.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../models/AuditLog.php';
require_once __DIR__ . '/../config/database.php';

class MapController {
    private Cemetery $cemeteryModel;
    private Section $sectionModel;
    private Block $blockModel;
    private Lot $lotModel;
    private AuditLog $auditLogModel;
    private PDO $db;

    public function __construct(
        ?Cemetery $cemeteryModel = null,
        ?Section $sectionModel = null,
        ?Block $blockModel = null,
        ?Lot $lotModel = null,
        ?PDO $db = null,
        ?AuditLog $auditLogModel = null
    ) {
        $this->cemeteryModel = $cemeteryModel ?? new Cemetery();
        $this->sectionModel = $sectionModel ?? new Section();
        $this->blockModel = $blockModel ?? new Block();
        $this->lotModel = $lotModel ?? new Lot();
        $this->db = $db ?? Database::getInstance()->getConnection();
        $this->auditLogModel = $auditLogModel ?? new AuditLog();
    }

    /**
     * Safely decode stored JSON strings or return arrays directly; null on invalid/empty.
     */
    private static function decodeJsonField($value) {
        if ($value === null || $value === '') {
            return null;
        }
        if (is_array($value)) {
            return $value;
        }
        $decoded = json_decode((string) $value, true);
        return (json_last_error() === JSON_ERROR_NONE) ? $decoded : null;
    }

    /**
     * GET /api/cemeteries
     * Retrieve all active cemetery facilities.
     * Excludes any user PII, deceased data, or payment records.
     */
    public function getCemeteries(): array {
        try {
            $raw = $this->cemeteryModel->findAllActive();
            $cemeteries = [];
            foreach ($raw as $c) {
                $cemeteries[] = [
                    'cemetery_id'    => (int) $c['cemetery_id'],
                    'cemetery_name'  => $c['cemetery_name'],
                    'cemetery_code'  => $c['cemetery_code'],
                    'description'    => $c['description'] ?: null,
                    'address'        => $c['address'] ?: null,
                    'contact_number' => $c['contact_number'] ?: null,
                    'map_config'     => self::decodeJsonField($c['map_config'] ?? null),
                    'is_active'      => (int) $c['is_active'],
                ];
            }

            return [
                'success' => true,
                'data'    => $cemeteries,
                'code'    => 200,
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to retrieve cemetery facilities.',
                'code'    => 500,
            ];
        }
    }

    /**
     * GET /api/map/layout?cemetery_id={id}
     * Retrieve spatial layout overview for a specific cemetery (cemetery metadata, sections, and block positions).
     * Single aggregation pass to prevent N+1 query overhead.
     */
    public function getLayout($cemeteryId): array {
        if ($cemeteryId === null || trim((string) $cemeteryId) === '') {
            return [
                'success' => false,
                'error'   => 'Parameter "cemetery_id" is required.',
                'code'    => 400,
            ];
        }

        if (!is_numeric($cemeteryId) || (int) $cemeteryId <= 0) {
            return [
                'success' => false,
                'error'   => 'Invalid cemetery_id provided.',
                'code'    => 400,
            ];
        }

        $cemeteryId = (int) $cemeteryId;

        try {
            // 1. Validate active cemetery
            $cemetery = $this->cemeteryModel->findById($cemeteryId);
            if (!$cemetery || (int) ($cemetery['is_active'] ?? 0) !== 1) {
                return [
                    'success' => false,
                    'error'   => 'Cemetery facility not found or is currently inactive.',
                    'code'    => 404,
                ];
            }

            // 2. Fetch sections strictly scoped to this cemetery
            $sections = $this->sectionModel->findByCemetery($cemeteryId);

            // 3. Fetch all blocks belonging to this cemetery in one query (no N+1)
            $blocks = $this->blockModel->findByCemetery($cemeteryId);

            // Group blocks by section_id
            $blocksBySection = [];
            foreach ($blocks as $block) {
                $secId = (int) $block['section_id'];
                $blocksBySection[$secId][] = [
                    'block_id'    => (int) $block['block_id'],
                    'section_id'  => $secId,
                    'block_name'  => $block['block_name'],
                    'description' => $block['description'] ?: null,
                    'total_lots'  => (int) ($block['total_lots'] ?? 0),
                    'map_config'  => self::decodeJsonField($block['map_config'] ?? null),
                ];
            }

            // Assemble sections with nested blocks
            $formattedSections = [];
            foreach ($sections as $section) {
                $secId = (int) $section['section_id'];
                $formattedSections[] = [
                    'section_id'   => $secId,
                    'cemetery_id'  => (int) $section['cemetery_id'],
                    'section_name' => $section['section_name'],
                    'description'  => $section['description'] ?: null,
                    'total_blocks' => (int) ($section['total_blocks'] ?? 0),
                    'total_lots'   => (int) ($section['total_lots'] ?? 0),
                    'map_config'   => self::decodeJsonField($section['map_config'] ?? null),
                    'blocks'       => $blocksBySection[$secId] ?? [],
                ];
            }

            return [
                'success' => true,
                'data'    => [
                    'cemetery' => [
                        'cemetery_id'    => (int) $cemetery['cemetery_id'],
                        'cemetery_name'  => $cemetery['cemetery_name'],
                        'cemetery_code'  => $cemetery['cemetery_code'],
                        'description'    => $cemetery['description'] ?: null,
                        'address'        => $cemetery['address'] ?: null,
                        'contact_number' => $cemetery['contact_number'] ?: null,
                        'map_config'     => self::decodeJsonField($cemetery['map_config'] ?? null),
                    ],
                    'sections' => $formattedSections,
                ],
                'code'    => 200,
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to retrieve cemetery layout.',
                'code'    => 500,
            ];
        }
    }

    /**
     * GET /api/map/blocks/{id}/lots
     * Retrieve burial lots belonging to a specific block for visual lot grid rendering.
     * Enforces authoritative lot status and excludes all personal/decedent PII.
     */
    public function getBlockLots($blockId): array {
        if ($blockId === null || trim((string) $blockId) === '') {
            return [
                'success' => false,
                'error'   => 'Parameter "block_id" is required.',
                'code'    => 400,
            ];
        }

        if (!is_numeric($blockId) || (int) $blockId <= 0) {
            return [
                'success' => false,
                'error'   => 'Invalid block_id provided.',
                'code'    => 400,
            ];
        }

        $blockId = (int) $blockId;

        try {
            // 1. Fetch block with parent section and cemetery hierarchy
            $stmt = $this->db->prepare("
                SELECT b.block_id, b.section_id, b.block_name, b.description, b.map_config, b.total_lots,
                       s.section_name, s.cemetery_id, c.cemetery_name, c.cemetery_code, c.is_active AS cemetery_is_active
                FROM blocks b
                JOIN sections s ON b.section_id = s.section_id
                JOIN cemeteries c ON s.cemetery_id = c.cemetery_id
                WHERE b.block_id = ?
                LIMIT 1
            ");
            $stmt->execute([$blockId]);
            $block = $stmt->fetch(PDO::FETCH_ASSOC);

            if (!$block) {
                return [
                    'success' => false,
                    'error'   => 'Block not found.',
                    'code'    => 404,
                ];
            }

            if ((int) ($block['cemetery_is_active'] ?? 0) !== 1) {
                return [
                    'success' => false,
                    'error'   => 'Cemetery facility for this block is currently inactive.',
                    'code'    => 403,
                ];
            }

            // 2. Fetch authoritative lot data for this block
            $rawLots = $this->lotModel->findMapLotsByBlock($blockId);

            $normalizedLots = [];
            foreach ($rawLots as $lot) {
                $normalizedLots[] = [
                    'lot_id'         => (int) $lot['lot_id'],
                    'lot_number'     => $lot['lot_number'],
                    'status'         => $lot['status'],
                    'lot_type'       => $lot['lot_type_name'] ?? 'Standard Lawn',
                    'price'          => (float) $lot['price'],
                    'dimensions'     => $lot['dimensions'] ?: null,
                    'location_notes' => $lot['location_notes'] ?: null,
                    'map_config'     => self::decodeJsonField($lot['map_config'] ?? null),
                ];
            }

            return [
                'success' => true,
                'data'    => [
                    'block' => [
                        'block_id'      => (int) $block['block_id'],
                        'block_name'    => $block['block_name'],
                        'section_id'    => (int) $block['section_id'],
                        'section_name'  => $block['section_name'],
                        'cemetery_id'   => (int) $block['cemetery_id'],
                        'cemetery_name' => $block['cemetery_name'],
                        'cemetery_code' => $block['cemetery_code'],
                        'description'   => $block['description'] ?: null,
                        'total_lots'    => (int) ($block['total_lots'] ?? count($normalizedLots)),
                        'map_config'    => self::decodeJsonField($block['map_config'] ?? null),
                    ],
                    'lots'  => $normalizedLots,
                ],
                'code'    => 200,
            ];
        } catch (Throwable $t) {
            return [
                'success' => false,
                'error'   => 'Failed to retrieve block lots.',
                'code'    => 500,
            ];
        }
    }

    // =========================================================================
    // MAP GEOMETRY CALIBRATION & MANAGEMENT (Batch 5 - Admin/Staff Only)
    // =========================================================================

    private static function actorId($actor) {
        return is_array($actor) ? ($actor['user_id'] ?? null) : $actor;
    }

    private static function actorUsername($actor) {
        return is_array($actor) ? ($actor['username'] ?? null) : null;
    }

    /**
     * Strict Geometry Config Validator and Normalizer.
     * Rejects non-numeric, NaN, Infinity, negative dimensions, and dangerous structures.
     */
    public function validateGeometryConfig(string $entityType, $config, ?array $parent = null): array {
        if (!is_array($config)) {
            return [
                'valid' => false,
                'error' => 'Geometry configuration must be a valid JSON object.',
                'code'  => 400,
            ];
        }

        $warnings = [];

        if ($entityType === 'cemetery') {
            $w = $config['width'] ?? ($config['canvas']['width'] ?? 1600);
            $h = $config['height'] ?? ($config['canvas']['height'] ?? 1000);

            if (!is_numeric($w) || !is_numeric($h) || is_nan((float)$w) || is_infinite((float)$w) || is_nan((float)$h) || is_infinite((float)$h)) {
                return ['valid' => false, 'error' => 'Cemetery canvas width and height must be valid numeric values.', 'code' => 400];
            }
            $w = (float) $w;
            $h = (float) $h;
            if ($w <= 0 || $h <= 0) {
                return ['valid' => false, 'error' => 'Cemetery canvas dimensions must be strictly positive numbers.', 'code' => 400];
            }
            if ($w < 200 || $w > 10000 || $h < 200 || $h > 10000) {
                return ['valid' => false, 'error' => 'Cemetery canvas dimensions must be between 200 and 10,000 SVG units.', 'code' => 400];
            }

            return [
                'valid'    => true,
                'config'   => [
                    'width'    => round($w, 2),
                    'height'   => round($h, 2),
                    'viewBox'  => '0 0 ' . round($w, 2) . ' ' . round($h, 2),
                ],
                'warnings' => $warnings,
            ];
        }

        // Section, Block, Lot require x, y, width, height
        $hasX = array_key_exists('x', $config);
        $hasY = array_key_exists('y', $config);
        $hasW = array_key_exists('width', $config);
        $hasH = array_key_exists('height', $config);

        if (!$hasX || !$hasY || !$hasW || !$hasH) {
            return [
                'valid' => false,
                'error' => ucfirst($entityType) . ' geometry configuration requires numeric "x", "y", "width", and "height" fields.',
                'code'  => 400,
            ];
        }

        $x = $config['x'];
        $y = $config['y'];
        $w = $config['width'];
        $h = $config['height'];

        if (!is_numeric($x) || !is_numeric($y) || !is_numeric($w) || !is_numeric($h) ||
            is_nan((float)$x) || is_infinite((float)$x) || is_nan((float)$y) || is_infinite((float)$y) ||
            is_nan((float)$w) || is_infinite((float)$w) || is_nan((float)$h) || is_infinite((float)$h)) {
            return [
                'valid' => false,
                'error' => 'All geometry coordinates and dimensions must be valid finite numbers.',
                'code'  => 400,
            ];
        }

        $x = (float) $x;
        $y = (float) $y;
        $w = (float) $w;
        $h = (float) $h;

        if ($x < 0 || $y < 0) {
            return [
                'valid' => false,
                'error' => 'Visual coordinates "x" and "y" cannot be negative.',
                'code'  => 400,
            ];
        }

        if ($w <= 0 || $h <= 0) {
            return [
                'valid' => false,
                'error' => 'Visual dimensions "width" and "height" must be strictly greater than zero.',
                'code'  => 400,
            ];
        }

        $cleaned = [
            'x'      => round($x, 2),
            'y'      => round($y, 2),
            'width'  => round($w, 2),
            'height' => round($h, 2),
        ];

        // Section bounds validation against cemetery canvas
        if ($entityType === 'section' && $parent) {
            $canvasW = (float) ($parent['map_config']['width'] ?? 1600);
            $canvasH = (float) ($parent['map_config']['height'] ?? 1000);
            if ($x >= $canvasW || $y >= $canvasH) {
                return [
                    'valid' => false,
                    'error' => 'Section is positioned completely outside the cemetery canvas boundary.',
                    'code'  => 400,
                ];
            }
            if (($x + $w) > $canvasW || ($y + $h) > $canvasH) {
                $warnings[] = "Section boundary extends beyond the current cemetery canvas ({$canvasW}x{$canvasH}).";
            }
        }

        // Block bounds and grid validation
        if ($entityType === 'block') {
            if ($parent && isset($parent['width'], $parent['height'])) {
                $parentW = (float) $parent['width'];
                $parentH = (float) $parent['height'];
                if ($x >= $parentW || $y >= $parentH) {
                    return [
                        'valid' => false,
                        'error' => 'Block visual position is completely outside its parent section bounds.',
                        'code'  => 400,
                    ];
                }
                if (($x + $w) > $parentW || ($y + $h) > $parentH) {
                    $warnings[] = "Block boundary extends beyond the parent section dimensions ({$parentW}x{$parentH}).";
                }
            }

            // Grid validation
            if (!empty($config['grid']) && is_array($config['grid'])) {
                $grid = $config['grid'];
                $cols = $grid['columns'] ?? null;
                if ($cols !== null) {
                    if (!is_numeric($cols) || (int)$cols < 1 || (int)$cols > 50) {
                        return [
                            'valid' => false,
                            'error' => 'Lot grid columns must be an integer between 1 and 50.',
                            'code'  => 400,
                        ];
                    }
                    $cleaned['grid']['columns'] = (int) $cols;
                }
                if (isset($grid['rows']) && is_numeric($grid['rows'])) {
                    $rows = (int) $grid['rows'];
                    if ($rows >= 1 && $rows <= 50) {
                        $cleaned['grid']['rows'] = $rows;
                    }
                }
                if (isset($grid['gap_x']) && is_numeric($grid['gap_x']) && (float)$grid['gap_x'] >= 0) {
                    $cleaned['grid']['gap_x'] = round((float)$grid['gap_x'], 2);
                }
                if (isset($grid['gap_y']) && is_numeric($grid['gap_y']) && (float)$grid['gap_y'] >= 0) {
                    $cleaned['grid']['gap_y'] = round((float)$grid['gap_y'], 2);
                }
            }
        }

        return [
            'valid'    => true,
            'config'   => $cleaned,
            'warnings' => $warnings,
        ];
    }

    /**
     * PUT /api/map/cemeteries/{id}/config
     */
    public function updateCemeteryConfig($cemeteryId, $data, $actor = null): array {
        if (!is_numeric($cemeteryId) || (int)$cemeteryId <= 0) {
            return ['success' => false, 'error' => 'Invalid cemetery_id provided.', 'code' => 400];
        }
        $cemeteryId = (int) $cemeteryId;
        $cemetery = $this->cemeteryModel->findById($cemeteryId);
        if (!$cemetery) {
            return ['success' => false, 'error' => 'Cemetery facility not found.', 'code' => 404];
        }

        if (!empty($data['reset'])) {
            return $this->resetCemeteryConfig($cemeteryId, $actor);
        }

        $rawConfig = $data['map_config'] ?? $data;
        $val = $this->validateGeometryConfig('cemetery', $rawConfig);
        if (!$val['valid']) {
            return ['success' => false, 'error' => $val['error'], 'code' => $val['code'] ?? 400];
        }

        $success = $this->cemeteryModel->updateMapConfig($cemeteryId, $val['config']);
        if (!$success) {
            return ['success' => false, 'error' => 'Failed to persist cemetery map configuration.', 'code' => 500];
        }

        $this->auditLogModel->log(
            'Map geometry updated',
            self::actorId($actor),
            self::actorUsername($actor),
            'Cemetery',
            $cemeteryId,
            ['action' => 'update_map_config', 'facility' => $cemetery['cemetery_name'], 'map_config' => $val['config']]
        );

        return [
            'success'  => true,
            'message'  => 'Cemetery map canvas configuration updated successfully.',
            'data'     => [
                'cemetery_id' => $cemeteryId,
                'map_config'  => $val['config'],
                'warnings'    => $val['warnings'],
            ],
            'code'     => 200,
        ];
    }

    /**
     * POST /api/map/cemeteries/{id}/reset
     */
    public function resetCemeteryConfig($cemeteryId, $actor = null): array {
        if (!is_numeric($cemeteryId) || (int)$cemeteryId <= 0) {
            return ['success' => false, 'error' => 'Invalid cemetery_id provided.', 'code' => 400];
        }
        $cemeteryId = (int) $cemeteryId;
        $cemetery = $this->cemeteryModel->findById($cemeteryId);
        if (!$cemetery) {
            return ['success' => false, 'error' => 'Cemetery facility not found.', 'code' => 404];
        }

        // Reset to default baseline canvas
        $defaultConfig = ['width' => 1600, 'height' => 1000, 'viewBox' => '0 0 1600 1000'];
        $this->cemeteryModel->updateMapConfig($cemeteryId, $defaultConfig);

        $this->auditLogModel->log(
            'Map geometry reset',
            self::actorId($actor),
            self::actorUsername($actor),
            'Cemetery',
            $cemeteryId,
            ['action' => 'reset_map_config', 'facility' => $cemetery['cemetery_name']]
        );

        return [
            'success' => true,
            'message' => 'Cemetery canvas geometry restored to default (1600x1000).',
            'data'    => [
                'cemetery_id' => $cemeteryId,
                'map_config'  => $defaultConfig,
            ],
            'code'    => 200,
        ];
    }

    /**
     * PUT /api/map/sections/{id}/config
     */
    public function updateSectionConfig($sectionId, $data, $actor = null): array {
        if (!is_numeric($sectionId) || (int)$sectionId <= 0) {
            return ['success' => false, 'error' => 'Invalid section_id provided.', 'code' => 400];
        }
        $sectionId = (int) $sectionId;
        $section = $this->sectionModel->findById($sectionId);
        if (!$section) {
            return ['success' => false, 'error' => 'Section not found.', 'code' => 404];
        }

        // Strict cross-cemetery isolation validation
        if (isset($data['cemetery_id']) && (int)$data['cemetery_id'] !== (int)$section['cemetery_id']) {
            return ['success' => false, 'error' => 'Section does not belong to the specified cemetery facility.', 'code' => 400];
        }

        if (!empty($data['reset'])) {
            return $this->resetSectionConfig($sectionId, $actor);
        }

        $rawConfig = $data['map_config'] ?? $data;
        $cemetery = $this->cemeteryModel->findById((int)$section['cemetery_id']);
        if ($cemetery && !empty($cemetery['map_config'])) {
            $cemetery['map_config'] = self::decodeJsonField($cemetery['map_config']);
        }

        $val = $this->validateGeometryConfig('section', $rawConfig, $cemetery);
        if (!$val['valid']) {
            return ['success' => false, 'error' => $val['error'], 'code' => $val['code'] ?? 400];
        }

        $success = $this->sectionModel->updateMapConfig($sectionId, $val['config']);
        if (!$success) {
            return ['success' => false, 'error' => 'Failed to persist section map configuration.', 'code' => 500];
        }

        $this->auditLogModel->log(
            'Map geometry updated',
            self::actorId($actor),
            self::actorUsername($actor),
            'Section',
            $sectionId,
            ['action' => 'update_map_config', 'section_name' => $section['section_name'], 'map_config' => $val['config']]
        );

        return [
            'success'  => true,
            'message'  => 'Section visual geometry updated successfully.',
            'data'     => [
                'section_id' => $sectionId,
                'map_config' => $val['config'],
                'warnings'   => $val['warnings'],
            ],
            'code'     => 200,
        ];
    }

    /**
     * POST /api/map/sections/{id}/reset
     */
    public function resetSectionConfig($sectionId, $actor = null): array {
        if (!is_numeric($sectionId) || (int)$sectionId <= 0) {
            return ['success' => false, 'error' => 'Invalid section_id provided.', 'code' => 400];
        }
        $sectionId = (int) $sectionId;
        $section = $this->sectionModel->findById($sectionId);
        if (!$section) {
            return ['success' => false, 'error' => 'Section not found.', 'code' => 404];
        }

        $this->sectionModel->updateMapConfig($sectionId, null);

        $this->auditLogModel->log(
            'Map geometry reset',
            self::actorId($actor),
            self::actorUsername($actor),
            'Section',
            $sectionId,
            ['action' => 'reset_map_config', 'section_name' => $section['section_name']]
        );

        return [
            'success' => true,
            'message' => 'Section map geometry cleared. Reverted to default procedural layout.',
            'data'    => [
                'section_id' => $sectionId,
                'map_config' => null,
            ],
            'code'    => 200,
        ];
    }

    /**
     * PUT /api/map/blocks/{id}/config
     */
    public function updateBlockConfig($blockId, $data, $actor = null): array {
        if (!is_numeric($blockId) || (int)$blockId <= 0) {
            return ['success' => false, 'error' => 'Invalid block_id provided.', 'code' => 400];
        }
        $blockId = (int) $blockId;
        $block = $this->blockModel->findById($blockId);
        if (!$block) {
            return ['success' => false, 'error' => 'Block not found.', 'code' => 404];
        }

        $section = $this->sectionModel->findById((int)$block['section_id']);

        // Strict cross-section and cross-cemetery hierarchy validation
        if (isset($data['section_id']) && (int)$data['section_id'] !== (int)$block['section_id']) {
            return ['success' => false, 'error' => 'Block does not belong to the specified section.', 'code' => 400];
        }
        if (isset($data['cemetery_id']) && $section && (int)$data['cemetery_id'] !== (int)$section['cemetery_id']) {
            return ['success' => false, 'error' => 'Block does not belong to the specified cemetery facility.', 'code' => 400];
        }

        if (!empty($data['reset'])) {
            return $this->resetBlockConfig($blockId, $actor);
        }

        $rawConfig = $data['map_config'] ?? $data;
        $secConfig = self::decodeJsonField($section['map_config'] ?? null);

        $val = $this->validateGeometryConfig('block', $rawConfig, $secConfig);
        if (!$val['valid']) {
            return ['success' => false, 'error' => $val['error'], 'code' => $val['code'] ?? 400];
        }

        $success = $this->blockModel->updateMapConfig($blockId, $val['config']);
        if (!$success) {
            return ['success' => false, 'error' => 'Failed to persist block map configuration.', 'code' => 500];
        }

        $this->auditLogModel->log(
            'Map geometry updated',
            self::actorId($actor),
            self::actorUsername($actor),
            'Block',
            $blockId,
            ['action' => 'update_map_config', 'block_name' => $block['block_name'], 'map_config' => $val['config']]
        );

        return [
            'success'  => true,
            'message'  => 'Block visual geometry updated successfully.',
            'data'     => [
                'block_id'   => $blockId,
                'map_config' => $val['config'],
                'warnings'   => $val['warnings'],
            ],
            'code'     => 200,
        ];
    }

    /**
     * POST /api/map/blocks/{id}/reset
     */
    public function resetBlockConfig($blockId, $actor = null): array {
        if (!is_numeric($blockId) || (int)$blockId <= 0) {
            return ['success' => false, 'error' => 'Invalid block_id provided.', 'code' => 400];
        }
        $blockId = (int) $blockId;
        $block = $this->blockModel->findById($blockId);
        if (!$block) {
            return ['success' => false, 'error' => 'Block not found.', 'code' => 404];
        }

        $this->blockModel->updateMapConfig($blockId, null);

        $this->auditLogModel->log(
            'Map geometry reset',
            self::actorId($actor),
            self::actorUsername($actor),
            'Block',
            $blockId,
            ['action' => 'reset_map_config', 'block_name' => $block['block_name']]
        );

        return [
            'success' => true,
            'message' => 'Block map geometry cleared. Reverted to default procedural layout.',
            'data'    => [
                'block_id'   => $blockId,
                'map_config' => null,
            ],
            'code'    => 200,
        ];
    }

    /**
     * PUT /api/map/lots/{id}/config
     */
    public function updateLotConfig($lotId, $data, $actor = null): array {
        if (!is_numeric($lotId) || (int)$lotId <= 0) {
            return ['success' => false, 'error' => 'Invalid lot_id provided.', 'code' => 400];
        }
        $lotId = (int) $lotId;
        $lot = $this->lotModel->findById($lotId);
        if (!$lot) {
            return ['success' => false, 'error' => 'Lot not found.', 'code' => 404];
        }

        // Strict cross-block validation
        if (isset($data['block_id']) && (int)$data['block_id'] !== (int)$lot['block_id']) {
            return ['success' => false, 'error' => 'Lot does not belong to the specified block.', 'code' => 400];
        }

        if (!empty($data['reset'])) {
            return $this->resetLotConfig($lotId, $actor);
        }

        $rawConfig = $data['map_config'] ?? $data;
        $val = $this->validateGeometryConfig('lot', $rawConfig);
        if (!$val['valid']) {
            return ['success' => false, 'error' => $val['error'], 'code' => $val['code'] ?? 400];
        }

        $success = $this->lotModel->updateMapConfig($lotId, $val['config']);
        if (!$success) {
            return ['success' => false, 'error' => 'Failed to persist lot map configuration.', 'code' => 500];
        }

        $this->auditLogModel->log(
            'Map geometry updated',
            self::actorId($actor),
            self::actorUsername($actor),
            'Lot',
            $lotId,
            ['action' => 'update_map_config', 'lot_number' => $lot['lot_number'], 'map_config' => $val['config']]
        );

        return [
            'success'  => true,
            'message'  => 'Lot visual geometry updated successfully.',
            'data'     => [
                'lot_id'     => $lotId,
                'map_config' => $val['config'],
                'warnings'   => $val['warnings'],
            ],
            'code'     => 200,
        ];
    }

    /**
     * POST /api/map/lots/{id}/reset
     */
    public function resetLotConfig($lotId, $actor = null): array {
        if (!is_numeric($lotId) || (int)$lotId <= 0) {
            return ['success' => false, 'error' => 'Invalid lot_id provided.', 'code' => 400];
        }
        $lotId = (int) $lotId;
        $lot = $this->lotModel->findById($lotId);
        if (!$lot) {
            return ['success' => false, 'error' => 'Lot not found.', 'code' => 404];
        }

        $this->lotModel->updateMapConfig($lotId, null);

        $this->auditLogModel->log(
            'Map geometry reset',
            self::actorId($actor),
            self::actorUsername($actor),
            'Lot',
            $lotId,
            ['action' => 'reset_map_config', 'lot_number' => $lot['lot_number']]
        );

        return [
            'success' => true,
            'message' => 'Lot map geometry cleared. Reverted to block grid layout.',
            'data'    => [
                'lot_id'     => $lotId,
                'map_config' => null,
            ],
            'code'    => 200,
        ];
    }
}

