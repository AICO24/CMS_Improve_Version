<?php
require_once __DIR__ . '/../models/Cemetery.php';
require_once __DIR__ . '/../models/Section.php';
require_once __DIR__ . '/../models/Block.php';
require_once __DIR__ . '/../models/Lot.php';
require_once __DIR__ . '/../config/database.php';

class MapController {
    private Cemetery $cemeteryModel;
    private Section $sectionModel;
    private Block $blockModel;
    private Lot $lotModel;
    private PDO $db;

    public function __construct(
        ?Cemetery $cemeteryModel = null,
        ?Section $sectionModel = null,
        ?Block $blockModel = null,
        ?Lot $lotModel = null,
        ?PDO $db = null
    ) {
        $this->cemeteryModel = $cemeteryModel ?? new Cemetery();
        $this->sectionModel = $sectionModel ?? new Section();
        $this->blockModel = $blockModel ?? new Block();
        $this->lotModel = $lotModel ?? new Lot();
        $this->db = $db ?? Database::getInstance()->getConnection();
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
}
