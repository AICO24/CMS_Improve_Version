<?php
chdir('c:/laragon/www/CMS');
require_once 'backend/config/database.php';

$db = Database::getInstance()->getConnection();
$stmt = $db->query("
    SELECT l.lot_id, l.block_id, b.block_name, s.section_id, s.section_name, 
           l.lot_number, l.status, l.price, t.type_name, l.map_config
    FROM lots l
    JOIN blocks b ON l.block_id = b.block_id
    JOIN sections s ON b.section_id = s.section_id
    JOIN lot_types t ON l.lot_type_id = t.type_id
    WHERE b.block_id IN (1, 2, 3, 4, 5, 6)
    ORDER BY l.block_id ASC, l.lot_id ASC
");
$lots = $stmt->fetchAll(PDO::FETCH_ASSOC);

echo "Total Ground Lots: " . count($lots) . "\n";
$byBlock = [];
foreach ($lots as $l) {
    $byBlock[$l['block_id']][] = $l;
}

foreach ($byBlock as $bid => $bLots) {
    $first = $bLots[0];
    echo "--- Block {$bid}: {$first['block_name']} (Section {$first['section_id']}: {$first['section_name']}) ---\n";
    echo "Count: " . count($bLots) . "\n";
    $ids = array_column($bLots, 'lot_id');
    echo "Lot IDs: " . implode(', ', $ids) . "\n";
    $hasMapCfg = 0;
    foreach ($bLots as $l) {
        if (!empty($l['map_config'])) $hasMapCfg++;
    }
    echo "Lots with map_config: {$hasMapCfg}\n";
    $types = array_unique(array_column($bLots, 'type_name'));
    echo "Lot Types: " . implode(', ', $types) . "\n\n";
}

