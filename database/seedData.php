<?php
/**
 * Seed Data Script
 * This script populates the database with sample data for testing
 */

require_once __DIR__ . '/api/config/database.php';

try {
    $db = Database::getInstance()->getConnection();
    
    // Check if data already exists
    $stmt = $db->prepare("SELECT COUNT(*) as count FROM sections");
    $stmt->execute();
    $result = $stmt->fetch();
    $hasExistingSections = $result['count'] > 0;

    if ($hasExistingSections) {
        echo "✅ Core cemetery data already exists. Skipping section, block, lot and lot type seed insertions.\n";
    } else {
        // Insert Sections
        echo "Creating sections...\n";
        $sections = [
            ['section_name' => 'Section A', 'description' => 'North Area'],
            ['section_name' => 'Section B', 'description' => 'South Area'],
            ['section_name' => 'Section C', 'description' => 'East Area'],
        ];

        $sectionIds = [];
        foreach ($sections as $section) {
            $stmt = $db->prepare("INSERT INTO sections (section_name, description, total_lots) VALUES (?, ?, ?)");
            $stmt->execute([$section['section_name'], $section['description'], 50]);
            $sectionIds[] = $db->lastInsertId();
        }
        echo count($sectionIds) . " sections created\n";

        // Insert Blocks
        echo "Creating blocks...\n";
        $blocks = [
            ['section_id' => $sectionIds[0], 'block_name' => 'Block A-1'],
            ['section_id' => $sectionIds[0], 'block_name' => 'Block A-2'],
            ['section_id' => $sectionIds[1], 'block_name' => 'Block B-1'],
            ['section_id' => $sectionIds[2], 'block_name' => 'Block C-1'],
        ];

        $blockIds = [];
        foreach ($blocks as $block) {
            $stmt = $db->prepare("INSERT INTO blocks (section_id, block_name, total_lots) VALUES (?, ?, ?)");
            $stmt->execute([$block['section_id'], $block['block_name'], 25]);
            $blockIds[] = $db->lastInsertId();
        }
        echo count($blockIds) . " blocks created\n";

        // Insert Lot Types
        echo "Creating lot types...\n";
        $stmt = $db->prepare("SELECT * FROM lot_types WHERE type_name = 'Single Plot'");
        $stmt->execute();
        $existingType = $stmt->fetch();

        if (!$existingType) {
            $lotTypes = [
                ['type_name' => 'Single Plot', 'description' => 'Standard single burial plot'],
                ['type_name' => 'Double Plot', 'description' => 'Double burial plot for couples'],
                ['type_name' => 'Family Plot', 'description' => 'Family burial plot for multiple members'],
            ];

            foreach ($lotTypes as $type) {
                $stmt = $db->prepare("INSERT INTO lot_types (type_name, description) VALUES (?, ?)");
                $stmt->execute([$type['type_name'], $type['description']]);
            }
            echo count($lotTypes) . " lot types created\n";
        }

        // Get lot type id
        $stmt = $db->prepare("SELECT type_id FROM lot_types LIMIT 1");
        $stmt->execute();
        $typeResult = $stmt->fetch();
        $lotTypeId = $typeResult['type_id'] ?? 1;

        // Insert Lots
        echo "Creating lots...\n";
        $lots = [];
        $statuses = ['Available', 'Available', 'Available', 'Available', 'Occupied', 'Reserved'];

        foreach ($sectionIds as $index => $sectionId) {
            if (!isset($blockIds[$index * 1])) {
                continue;
            }
            $blockId = $blockIds[$index * 1];
            for ($i = 1; $i <= 10; $i++) {
                $status = $statuses[array_rand($statuses)];
                $lots[] = [
                    'block_id' => $blockId,
                    'lot_number' => 'L-' . str_pad($i, 3, '0', STR_PAD_LEFT),
                    'lot_type_id' => $lotTypeId,
                    'status' => $status,
                    'price' => 15000 + rand(0, 10000),
                    'dimensions' => '2m x 1.5m'
                ];
            }
        }

        $lotCount = 0;
        foreach ($lots as $lot) {
            $stmt = $db->prepare("
                INSERT INTO lots (block_id, lot_number, lot_type_id, status, price, dimensions)
                VALUES (?, ?, ?, ?, ?, ?)
            ");
            $stmt->execute([
                $lot['block_id'],
                $lot['lot_number'],
                $lot['lot_type_id'],
                $lot['status'],
                $lot['price'],
                $lot['dimensions']
            ]);
            $lotCount++;
        }
        echo $lotCount . " lots created\n";
    }

    // Seed payments if needed
    $stmt = $db->prepare("SELECT COUNT(*) as count FROM payments");
    $stmt->execute();
    $paymentCount = (int) $stmt->fetch()['count'];

    if ($paymentCount === 0) {
        echo "Creating payments...\n";
        $userStmt = $db->prepare("SELECT user_id FROM users WHERE username IN ('admin', 'staff') ORDER BY username ASC");
        $userStmt->execute();
        $userIds = array_column($userStmt->fetchAll(), 'user_id');
        if (empty($userIds)) {
            $userIds = [1];
        }

        $createdPayments = 0;
        $types = ['Lot Purchase', 'Cremation', 'Relocation', 'Renewal', 'Other'];
        $methods = ['Cash', 'Check', 'Bank Transfer'];

        for ($month = 1; $month <= 12; $month++) {
            $numPayments = rand(3, 8);
            for ($i = 0; $i < $numPayments; $i++) {
                $day = rand(1, 28);
                $paymentDate = date('Y-') . str_pad($month, 2, '0', STR_PAD_LEFT) . '-' . str_pad($day, 2, '0', STR_PAD_LEFT);
                $amount = rand(50000, 250000);
                $receivedBy = $userIds[array_rand($userIds)];
                $transactionType = $types[array_rand($types)];
                $paymentMethod = $methods[array_rand($methods)];

                $stmt = $db->prepare("INSERT INTO payments (transaction_type, amount, payment_date, payment_method, receipt_number, received_by) VALUES (?, ?, ?, ?, ?, ?)");
                $stmt->execute([
                    $transactionType,
                    $amount,
                    $paymentDate,
                    $paymentMethod,
                    'RCP-' . date('Y') . '-' . str_pad($createdPayments + 1, 5, '0', STR_PAD_LEFT),
                    $receivedBy
                ]);
                $createdPayments++;
            }
        }
        echo $createdPayments . " payments created\n";
    } else {
        echo "Payments already exist ({$paymentCount}). Skipping payment seed.\n";
    }

    $repairStmt = $db->prepare("UPDATE payments SET transaction_type = 'Other' WHERE transaction_type = '' OR transaction_type IS NULL");
    $repairStmt->execute();
    $repairStmt = $db->prepare("UPDATE payments SET payment_method = 'Unknown' WHERE payment_method = '' OR payment_method IS NULL");
    $repairStmt->execute();

    echo "\n✅ Seed data insertion completed successfully!\n";
    echo "Database has been populated with sample data.\n";
    
} catch (Exception $e) {
    echo "❌ Error: " . $e->getMessage() . "\n";
    exit(1);
}
?>
