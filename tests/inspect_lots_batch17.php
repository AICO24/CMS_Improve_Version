<?php
/**
 * Read-only Lot Inventory Inspection for Batch 17
 */
chdir('c:/laragon/www/CMS');
require_once 'backend/config/database.php';

try {
    $db = Database::getInstance()->getConnection();
    
    // 1. Get total lots count
    $stmt = $db->query("SELECT COUNT(*) FROM lots");
    $totalLots = (int) $stmt->fetchColumn();
    echo "TOTAL LOTS IN DATABASE: {$totalLots}\n\n";

    // 2. Query blocks and sections hierarchy
    $stmt = $db->query("
        SELECT b.block_id, b.block_name, b.total_lots, s.section_id, s.section_name, c.cemetery_id, c.cemetery_name
        FROM blocks b
        JOIN sections s ON b.section_id = s.section_id
        JOIN cemeteries c ON s.cemetery_id = c.cemetery_id
        ORDER BY b.block_id ASC
    ");
    $blocks = $stmt->fetchAll(PDO::FETCH_ASSOC);

    echo "=== BLOCK & SECTION BREAKDOWN ===\n";
    foreach ($blocks as $blk) {
        $bid = (int) $blk['block_id'];
        $lStmt = $db->prepare("
            SELECT l.lot_id, l.lot_number, l.status, l.price, t.type_name as lot_type, l.map_config
            FROM lots l
            JOIN lot_types t ON l.lot_type_id = t.type_id
            WHERE l.block_id = ?
            ORDER BY l.lot_id ASC
        ");
        $lStmt->execute([$bid]);
        $lots = $lStmt->fetchAll(PDO::FETCH_ASSOC);

        $count = count($lots);
        $lotIds = array_column($lots, 'lot_id');
        $minId = !empty($lotIds) ? min($lotIds) : 'N/A';
        $maxId = !empty($lotIds) ? max($lotIds) : 'N/A';
        $lotNums = array_column($lots, 'lot_number');
        $sampleNums = implode(', ', array_slice($lotNums, 0, 5));
        if ($count > 5) $sampleNums .= "...";

        echo "Block ID {$bid} ({$blk['block_name']}) in Section {$blk['section_id']} ({$blk['section_name']}):\n";
        echo "  - Lot count: {$count} (Block table total_lots: {$blk['total_lots']})\n";
        echo "  - Lot IDs range: {$minId} to {$maxId} (Count: " . count($lotIds) . ")\n";
        echo "  - Sample Lot Numbers: {$sampleNums}\n";

        // Status breakdown
        $statuses = [];
        foreach ($lots as $l) {
            $st = $l['status'];
            $statuses[$st] = ($statuses[$st] ?? 0) + 1;
        }
        $stStr = [];
        foreach ($statuses as $st => $c) $stStr[] = "{$st}: {$c}";
        echo "  - Status breakdown: " . implode(', ', $stStr) . "\n\n";
    }

} catch (Exception $e) {
    echo "ERROR: " . $e->getMessage() . "\n";
}

