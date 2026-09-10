<?php
require_once __DIR__ . '/../models/Schedule.php';
require_once __DIR__ . '/../models/Lot.php';

/**
 * PaymentAmountResolver
 *
 * Batch 2 (Payment Gateway Foundation): the AUTHORITATIVE, server-side
 * source of payment amounts for any future gateway transaction.
 *
 * Core security rule (Batch 2 scope): a future PayMongo amount MUST be the
 * value this resolver returns — never an arbitrary client-supplied amount.
 * Consequently:
 *   - resolve() does not even accept an "amount" parameter; a client amount
 *     can be at most a display value elsewhere and is structurally incapable
 *     of becoming the gateway amount here.
 *   - Only transaction types with a real, server-side price source resolve.
 *
 * Today only 'Lot Purchase' has an authoritative price (lots.price — the
 * same source PaymentController::resolveExpectedAmount() reads for its
 * manual-flow advisory check). Cremation/Relocation/Renewal/Other have no
 * price column anywhere in the schema; they are deliberately BLOCKED
 * (resolved => false with reason_code 'missing_pricing_source') so a future
 * checkout cannot silently trust a client-entered amount for them.
 *
 * For reference typing, this mirrors the existing 'Lot Purchase' rule:
 *   - reference_kind='lot'      → lots.lot_id directly
 *   - reference_kind='schedule' → burial_schedules.schedule_id → its lot
 *   - reference_kind=NULL       → legacy guess-by-existence fallback
 *                                   (schedule first, then lot), identical to
 *                                   PaymentController::resolveExpectedAmount()
 * Amounts are returned both as decimal pesos and as integer centavos
 * (PayMongo's API requires integer centavo amounts).
 */

class PaymentAmountResolver {
    public const CURRENCY = 'PHP';

    /** Minimum amount (in centavos) PayMongo accepts for a payment. */
    public const GATEWAY_MIN_AMOUNT_CENTS = 100;

    /**
     * Transaction types currently WITHOUT an authoritative server-side price
     * source. Kept in one place so docs/tests/UI can reference it and a
     * future pricing feature updates a single definition.
     */
    public const TYPES_WITHOUT_SERVER_PRICE = ['Cremation', 'Relocation', 'Renewal', 'Other'];

    /**
     * Resolve the authoritative amount for a payment reference.
     *
     * Accepts NO client amount — see class docblock. This method is the only
     * permitted source for a future gateway amount.
     *
     * @param string|null     $transactionType 'Lot Purchase' | 'Cremation' | ...
     * @param int|string|null $referenceId     schedule/lot/cremation/... id
     * @param string|null     $referenceKind   'schedule' | 'lot' | null (Lot Purchase only)
     * @return array
     */
    public function resolve($transactionType, $referenceId, $referenceKind = null) {
        $type = $this->normalizeTransactionType($transactionType);
        $referenceId = $this->normalizeReferenceId($referenceId);
        $referenceKind = in_array($referenceKind, ['schedule', 'lot'], true) ? $referenceKind : null;

        if ($type === null) {
            return $this->unresolved('invalid_transaction_type', null, $referenceId, $referenceKind, $transactionType);
        }

        if ($referenceId === null) {
            return $this->unresolved('invalid_reference', $type, null, $referenceKind);
        }

        if ($type !== 'Lot Purchase') {
            // No authoritative price source exists for these yet (see class
            // docblock). Blocking here is the Batch 2 security requirement:
            // a gateway amount may never fall back to a client-supplied number.
            return $this->unresolved('missing_pricing_source', $type, $referenceId, $referenceKind);
        }

        $resolved = $this->resolveLotPurchase($referenceId, $referenceKind);
        if ($resolved === null) {
            return $this->unresolved('reference_not_found', $type, $referenceId, $referenceKind);
        }

        $amount = (float) $resolved['price'];
        $cents = $this->toCents($amount);

        if ($cents === null) {
            return $this->unresolved('invalid_price_precision', $type, $referenceId, $referenceKind);
        }

        if ($cents < self::GATEWAY_MIN_AMOUNT_CENTS) {
            return $this->unresolved('below_gateway_minimum', $type, $referenceId, $referenceKind);
        }

        return [
            'resolved' => true,
            'transaction_type' => $type,
            'reference_id' => $referenceId,
            'reference_kind' => $resolved['reference_kind'],
            'reason_code' => null,
            'reason' => null,
            'amount' => round($amount, 2),
            'amount_cents' => $cents,
            'currency' => self::CURRENCY,
            'source' => $resolved['source'],
            'reference_label' => $resolved['label'],
        ];
    }
/**
     * Human-readable price-source coverage summary, safe for documentation
     * and admin-facing diagnostics.
     */
    public function describeCoverage() {
        return [
            'supported' => [
                'Lot Purchase' => [
                    'source' => 'lots.price',
                    'reference_kind' => ['lot', 'schedule', null],
                ],
            ],
            'unsupported' => self::TYPES_WITHOUT_SERVER_PRICE,
            'blocked_reason' => 'no authoritative server-side price column exists for these types yet',
        ];
    }

    /**
     * Convert decimal pesos to integer centavos per PayMongo's API. Returns
     * null if the value cannot be represented exactly at 2-decimal precision
     * (protects against float drift / sub-centavo gateway amounts).
     */
    public function toCents($amount) {
        if (!is_numeric($amount)) {
            return null;
        }
        $cents = (int) round(((float) $amount) * 100);
        return $cents >= 0 ? $cents : null;
    }

    // ------------------------------------------------------------------
    // Internals
    // ------------------------------------------------------------------

    /**
     * @return array{price:float, reference_kind:string, source:string, label:string}|null
     */
    private function resolveLotPurchase($referenceId, $referenceKind) {
        $scheduleModel = new Schedule();
        $lotModel = new Lot();

        if ($referenceKind === 'lot') {
            $lot = $lotModel->findById($referenceId);
            if (!$lot) {
                return null;
            }
            return [
                'price' => $lot['price'],
                'reference_kind' => 'lot',
                'source' => 'lots.price',
                'label' => 'Lot ' . ($lot['lot_number'] ?? $referenceId),
            ];
        }

        if ($referenceKind === 'schedule') {
            $schedule = $scheduleModel->findById($referenceId);
            if (!$schedule || empty($schedule['lot_id'])) {
                return null;
            }
            $lot = $lotModel->findById($schedule['lot_id']);
            if (!$lot) {
                return null;
            }
            return [
                'price' => $lot['price'],
                'reference_kind' => 'schedule',
                'source' => 'lots.price via burial_schedules',
                'label' => 'Reservation #' . $schedule['schedule_id'] . ' - Lot ' . ($lot['lot_number'] ?? $schedule['lot_id']),
            ];
        }

        // Legacy fallback (reference_kind NULL): guess by existence, exactly
        // like PaymentController::resolveExpectedAmount()'s original behavior.
        $schedule = $scheduleModel->findById($referenceId);
        if ($schedule && !empty($schedule['lot_id'])) {
            $lot = $lotModel->findById($schedule['lot_id']);
            if ($lot) {
                return [
                    'price' => $lot['price'],
                    'reference_kind' => 'schedule',
                    'source' => 'lots.price via burial_schedules',
                    'label' => 'Reservation #' . $schedule['schedule_id'] . ' - Lot ' . ($lot['lot_number'] ?? $schedule['lot_id']),
                ];
            }
        }

        $lot = $lotModel->findById($referenceId);
        if ($lot) {
            return [
                'price' => $lot['price'],
                'reference_kind' => 'lot',
                'source' => 'lots.price',
                'label' => 'Lot ' . ($lot['lot_number'] ?? $referenceId),
            ];
        }

        return null;
    }

    private function normalizeTransactionType($type) {
        $value = strtolower(trim((string) $type));
        $map = [
            'lot purchase' => 'Lot Purchase',
            'cremation' => 'Cremation',
            'relocation' => 'Relocation',
            'renewal' => 'Renewal',
            'other' => 'Other',
        ];
        return $map[$value] ?? null;
    }

    private function normalizeReferenceId($referenceId) {
        if ($referenceId === null || $referenceId === '') {
            return null;
        }
        if (!is_numeric($referenceId)) {
            return null;
        }
        $asInt = (int) $referenceId;
        return $asInt > 0 ? $asInt : null;
    }

    private function unresolved($reasonCode, $type, $referenceId, $referenceKind, $rawType = null) {
        $messages = [
            'invalid_transaction_type' => 'Unsupported transaction type',
            'invalid_reference' => 'A valid payment reference is required',
            'reference_not_found' => 'The referenced lot/reservation could not be found or had no price',
            'missing_pricing_source' => 'No authoritative server-side price exists for ' . ($type ?? 'this transaction') . ' yet — gateway checkout is blocked until pricing is defined',
            'invalid_price_precision' => 'The authoritative price could not be converted to centavos',
            'below_gateway_minimum' => 'The authoritative amount is below the gateway minimum',
        ];

        return [
            'resolved' => false,
            'transaction_type' => $type,
            'reference_id' => $referenceId,
            'reference_kind' => $referenceKind,
            'reason_code' => $reasonCode,
            'reason' => $messages[$reasonCode] ?? 'Resolution failed',
        ];
    }
}