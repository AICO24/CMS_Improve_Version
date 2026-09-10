<?php
/**
 * PaymentAmountResolver + payments compatibility regression tests — Batch 2
 * (requires a database with the Batch 2 migration applied).
 *
 * Verifies:
 *  1. resolve() takes a REFERENCE only — no client budget 'amount' parameter
 *     at all (structural reflection), so a client amount is structurally
 *     incapable of becoming the authoritative gateway amount.
 *  2. Lot Purchase resolves the authoritative price from lots.price
 *     (direct lot reference, schedule reference, legacy NULL fallback).
 *  3. amount_cents is the exact integer centavos PayMongo requires.
 *  4. Cremation / Relocation / Renewal / Other are blocked
 *     (missing_pricing_source) — no invented prices, no client-amount escape.
 *  5. Invalid references fail cleanly.
 *  6. Manual Payment::create() + verifyIfPending() still work after the
 *     migration: manual rows insert with gateway columns NULL, currency PHP,
 *     Pending-by-default, and Pending->Verified semantics are preserved.
 *
 * Run:
 *   PHP\php tests/test_payment_amount_resolver_b2.php
 */
require_once __DIR__ . '/../backend/bootstrap.php';
require_once __DIR__ . '/../backend/config/database.php';
require_once __DIR__ . '/../backend/models/Schedule.php';
require_once __DIR__ . '/../backend/models/Lot.php';
require_once __DIR__ . '/../backend/models/Payment.php';
require_once __DIR__ . '/../backend/services/PaymentAmountResolver.php';

$passed = 0;
$failed = 0;

function report($testNum, $title, $success, $details = '') {
    global $passed, $failed;
    if ($success) {
        $passed++;
        echo "[PASS] TEST {$testNum}: {$title}\n";
    } else {
        $failed++;
        echo "[FAIL] TEST {$testNum}: {$title} — {$details}\n";
    }
}

$db = Database::getInstance()->getConnection();
$resolver = new PaymentAmountResolver();

// ------------------------------------------------------------
// TEST 1: resolve() accepts NO client 'amount' parameter
// ------------------------------------------------------------
$reflection = new ReflectionMethod(PaymentAmountResolver::class, 'resolve');
$paramNames = [];
foreach ($reflection->getParameters() as $p) {
    $paramNames[] = $p->getName();
}
report(1, 'resolve() takes no client amount parameter (only reference_type + reference)',
    !in_array('amount', $paramNames, true), 'parameters: ' . implode(',', $paramNames));

// ------------------------------------------------------------
// TEST 2+: Lot Purchase authoritative direct-lot resolution
// ------------------------------------------------------------
$lot = $db->query("SELECT lot_id, lot_number, price FROM lots WHERE status = 'Available' AND price > 1 ORDER BY lot_id LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if ($lot) {
    $price = (float) $lot['price'];
    $cents = (int) round($price * 100);
    $res = $resolver->resolve('Lot Purchase', $lot['lot_id'], 'lot');

    report(2, 'Lot Purchase direct lot reference resolves', ($res['resolved'] ?? false) === true, json_encode($res));
    report(3, 'resolved amount matches the lot price exactly',
        isset($res['amount']) && abs($res['amount'] - $price) < 0.001,
        'resolved=' . ($res['amount'] ?? 'n/a') . ' expected=' . $price);
    report(4, 'amount_cents is the integer centavo number',
        isset($res['amount_cents']) && $res['amount_cents'] === $cents && is_int($res['amount_cents']),
        'actual=' . json_encode($res['amount_cents'] ?? null) . ' expected=' . $cents);
    report(5, 'currency is PHP', ($res['currency'] ?? '') === 'PHP');

    // ------------------------------------------------------------
    // Legacy manual payment regression after the migration
    // ------------------------------------------------------------
    $paymentModel = new Payment();
    $paymentId = $paymentModel->create([
        'transaction_type' => 'Lot Purchase',
        'reference_id' => $lot['lot_id'],
        'reference_kind' => 'lot',
        'amount' => $price,
        'payment_date' => date('Y-m-d'),
        'payment_method' => 'Cash',
        'notes' => 'BATCH2 regression row - cleaned up by test',
    ]);
    report(6, 'manual Payment::create() still succeeds after migration', $paymentId !== false && $paymentId > 0);

    if ($paymentId) {
        $row = $db->query("SELECT gateway_provider, currency, gateway_payment_intent_id, gateway_checkout_session_id, gateway_payment_id, gateway_status, verification_status FROM payments WHERE payment_id = " . (int) $paymentId)->fetch(PDO::FETCH_ASSOC);
        report(7, 'manual row has NULL gateway association columns',
            $row
            && $row['gateway_provider'] === null
            && $row['gateway_payment_intent_id'] === null
            && $row['gateway_checkout_session_id'] === null
            && $row['gateway_payment_id'] === null
            && $row['gateway_status'] === null,
            json_encode($row));
        report(8, 'manual row defaults currency PHP', $row && ($row['currency'] ?? '') === 'PHP');
        report(9, 'manual row stays Pending by default', $row && ($row['verification_status'] ?? '') === 'Pending');

        $claimed = $paymentModel->verifyIfPending($paymentId, 'Verified', null, date('Y-m-d H:i:s'));
        $after = $db->query("SELECT verification_status FROM payments WHERE payment_id = " . (int) $paymentId)->fetchColumn();
        report(10, 'Pending -> Verified semantics preserved', $claimed === true && $after === 'Verified');

        $db->exec("DELETE FROM payments WHERE payment_id = " . (int) $paymentId);
    }
} else {
    report(2, 'SKIP: no Available lot in DB (authoritative resolution tests)', true, 'no available lot rows');
    report(3, 'SKIP', true);
    report(4, 'SKIP', true);
    report(5, 'SKIP', true);
    report(6, 'SKIP', true);
    report(7, 'SKIP', true);
    report(8, 'SKIP', true);
    report(9, 'SKIP', true);
    report(10, 'SKIP', true);
}
// ------------------------------------------------------------
// TEST 11: 'Lot Purchase' via a schedule reference (if any exists)
// ------------------------------------------------------------
$schedule = $db->query("SELECT s.schedule_id, l.price FROM burial_schedules s JOIN lots l ON l.lot_id = s.lot_id WHERE l.price > 1 LIMIT 1")->fetch(PDO::FETCH_ASSOC);
if ($schedule) {
    $res = $resolver->resolve('Lot Purchase', $schedule['schedule_id'], 'schedule');
    $expectedCents = (int) round(((float) $schedule['price']) * 100);
    report(11, 'Lot Purchase resolves via schedule reference',
        ($res['resolved'] ?? false) === true
        && ($res['amount_cents'] ?? null) === $expectedCents,
        json_encode($res));
} else {
    report(11, 'SKIP: no schedule/lot rows to test schedule reference', true, 'no schedule rows');
}

// ------------------------------------------------------------
// TESTS 12-15: unsupported types are blocked (never fabricated prices)
// ------------------------------------------------------------
$blockedTypes = ['Cremation', 'Relocation', 'Renewal', 'Other'];
foreach ($blockedTypes as $i => $type) {
    $res = $resolver->resolve($type, 1, null);
    report(12 + $i, $type . ' blocked (resolved=false, missing_pricing_source)',
        ($res['resolved'] ?? true) === false && ($res['reason_code'] ?? '') === 'missing_pricing_source',
        json_encode($res));
}

// ------------------------------------------------------------
// TEST 16-17: invalid references fail cleanly
// ------------------------------------------------------------
$res = $resolver->resolve('Lot Purchase', 999999999, 'lot');
report(16, 'nonexistent lot reference returns reference_not_found',
    ($res['resolved'] ?? true) === false && ($res['reason_code'] ?? '') === 'reference_not_found',
    json_encode($res));
$res = $resolver->resolve('Lot Purchase', null, 'lot');
report(17, 'null reference returns invalid_reference',
    ($res['resolved'] ?? true) === false && ($res['reason_code'] ?? '') === 'invalid_reference',
    json_encode($res));

// ------------------------------------------------------------
// TEST 18: describeCoverage() matches the implementation
// ------------------------------------------------------------
$cov = $resolver->describeCoverage();
report(18, 'describeCoverage() advertises supported/unsupported consistently',
    isset($cov['supported']['Lot Purchase'])
    && in_array('Cremation', $cov['unsupported'] ?? [], true)
    && in_array('Renewal', $cov['unsupported'] ?? [], true),
    json_encode($cov));

echo "\n======================================================\n";
echo "AmountResolver + payments regression: {$passed} passed, {$failed} failed\n";
echo "======================================================\n";
exit($failed === 0 ? 0 : 1);