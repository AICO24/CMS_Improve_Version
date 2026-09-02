<?php
/**
 * Batch D (reservation module audit, 2026-09-02): one-time backfill for
 * payments.reference_kind, run once against production-shaped data before
 * relying on it being fully populated going forward.
 *
 * migration_20260902_add_payment_reference_kind.sql added the column but
 * deliberately left existing rows NULL rather than guessing at migration
 * time. This script resolves those rows using PaymentController::
 * resolveExpectedAmount() — the exact same schedule-first-then-lot
 * disambiguation the live app already applies on every unread of a legacy
 * row — so this is a one-time persistence of a decision the app was already
 * making, not a new or different rule. It only ever touches a row where
 * reference_kind IS NULL AND reference_id IS NOT NULL: a NULL reference_id
 * (no reference at all — the overwhelming majority of legacy rows, see the
 * audit run against this database) is left alone, since there's nothing to
 * disambiguate. A row resolveExpectedAmount() can't confidently resolve
 * either way (neither a matching schedule nor a matching lot) is also left
 * alone and reported, rather than guessed.
 *
 * This touches financial records, so it prints its reasoning per row (not
 * just a count) for review, and only writes reference_kind — no other
 * column on any payment row is touched.
 *
 * Usage: php backend/scripts/backfill-payment-reference-kind.php
 * Safe to re-run: rows it already resolved no longer match the WHERE clause
 * below, so a second run is a no-op.
 */

if (PHP_SAPI !== 'cli') {
    http_response_code(403);
    echo "This script is CLI-only.\n";
    exit(1);
}

require_once __DIR__ . '/../bootstrap.php';
require_once __DIR__ . '/../config/database.php';
require_once __DIR__ . '/../controllers/PaymentController.php';

$db = Database::getInstance()->getConnection();
$paymentController = new PaymentController();

$stmt = $db->query("
    SELECT payment_id, transaction_type, reference_id, amount, receipt_number
    FROM payments
    WHERE reference_kind IS NULL AND reference_id IS NOT NULL
    ORDER BY payment_id
");
$candidates = $stmt->fetchAll();

echo count($candidates) . " payment row(s) have a reference_id but no reference_kind.\n\n";

$resolved = 0;
$unresolved = 0;

foreach ($candidates as $row) {
    $result = $paymentController->resolveExpectedAmount($row['transaction_type'], $row['reference_id']);
    $source = $result['source'] ?? null;

    if ($source !== 'schedule' && $source !== 'lot') {
        $unresolved++;
        printf(
            "  payment #%d (%s, reference_id=%s, amount=%s, receipt=%s): could NOT resolve — no matching schedule or lot found. Left as NULL for manual review.\n",
            $row['payment_id'],
            $row['transaction_type'],
            $row['reference_id'],
            $row['amount'],
            $row['receipt_number']
        );
        continue;
    }

    $update = $db->prepare("UPDATE payments SET reference_kind = ? WHERE payment_id = ? AND reference_kind IS NULL");
    $update->execute([$source, $row['payment_id']]);

    $resolved++;
    printf(
        "  payment #%d (%s, reference_id=%s, amount=%s, receipt=%s): resolved as reference_kind='%s' (matched %s price %s).\n",
        $row['payment_id'],
        $row['transaction_type'],
        $row['reference_id'],
        $row['amount'],
        $row['receipt_number'],
        $source,
        $result['lot_number'] ?? 'N/A',
        isset($result['expected_amount']) ? $result['expected_amount'] : 'N/A'
    );
}

echo "\nDone: {$resolved} resolved, {$unresolved} left unresolved for manual review.\n";
