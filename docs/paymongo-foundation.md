# PayMongo Gateway Foundation — Batch 2

Scope: backend readiness only. **No customer checkout, no webhook processing,
no refunds.** Those ship in Batches 3+ after manual review.

## Environment variables (server-side only)

All PayMongo configuration is read from the environment via
`backend/services/EnvironmentService.php`. Key names (placeholders in
`.env.example`; real values go in the gitignored `.env`):

| Variable                 | Purpose                                                            |
| ------------------------ | ------------------------------------------------------------------ |
| `PAYMONGO_ENV`           | `test` or `live`. Controls mode inference and validates that a live secret key is never used while env says test. |
| `PAYMONGO_PUBLIC_KEY`    | `pk_test_...` / `pk_live_...`. Not secret; still served to the browser **only** in a later batch via a dedicated endpoint. |
| `PAYMONGO_SECRET_KEY`    | `sk_test_...` / `sk_live_...`. **SERVER-ONLY.** Used for Basic-Auth to the PayMongo API. Never returned by any endpoint, never in HTML/JS. |
| `PAYMONGO_WEBHOOK_SECRET`| Webhook signature secret. **SERVER-ONLY.** Batch 4+. |
| `PAYMONGO_API_BASE`      | Optional override; defaults to `https://api.paymongo.com/v1`. |

With everything unset the service reports `unconfigured` and all gateway
operations fail closed; manual/offline payments are unaffected.

## Configuration loading

`backend/services/EnvironmentService.php` — flow:

- `Database` constructor loads `.env` from the project root (already works).
- The `.env` file does **not** include PayMongo keys in this batch, so
  `EnvironmentService::get('PAYMONGO_*')` returns the process environment
  value or the fallback default. PayMongo configuration is therefore
  evaluated **lazily at construction time** of `PayMongoService` (or on each
  `getConfig()` / internal `secretKey()` call) and requires **zero** code
  changes to core startup.

## How Checkout Sessions are Created (Batch 3)

The official PayMongo Checkout Session API requires a `line_items` array (with integer centavos and `currency: PHP`), `payment_method_types`, `success_url`, and `cancel_url`:

```php
require_once __DIR__ . '/../services/PayMongoService.php';
$pay = new PayMongoService();

// Server-side only. Never surfaced to the browser.
$config = $pay->getConfig(); // public-safe summary (no secrets)

// Batch 3 creates a Checkout Session via official schema:
$sessionAttributes = [
    'line_items' => [
        [
            'name' => 'Lot Purchase - ' . $referenceLabel,
            'amount' => $amountCents, // integer centavos from PaymentAmountResolver
            'currency' => 'PHP',
            'quantity' => 1,
            'description' => 'Payment for ' . $referenceLabel,
        ]
    ],
    'payment_method_types' => ['card', 'gcash', 'paymaya'],
    'description' => 'Payment for ' . $referenceLabel . ' (' . $receiptNumber . ')',
    'reference_number' => $receiptNumber,
    'send_email_receipt' => false,
    'show_description' => true,
    'show_line_items' => true,
    'success_url' => $successUrl,
    'cancel_url' => $cancelUrl,
];

// Deterministic idempotency key:
$idempotencyKey = 'cms_cs_payment_' . $paymentId . '_' . $amountCents;

$res = $pay->createCheckoutSession($sessionAttributes, $idempotencyKey);
```

### Batch 3 API Endpoint: `POST /api/payments/checkout-session`
- Authenticated via JWT (`AuthMiddleware::requireRole(['admin', 'staff', 'user'])`).
- Accepts `reference_id` + optional `reference_kind` (or `payment_id`).
- Strictly limited to `Lot Purchase`.
- Server-side ownership validation prevents user A from paying for user B's booking.
- Reuses existing active checkout sessions on retries/double-clicks.
- Gateway identifiers (`gateway_provider = 'paymongo'`, `gateway_checkout_session_id`, `gateway_payment_intent_id`, `gateway_status`) are persisted.
- Payment `verification_status` remains `Pending`. Zero premature confirmations or lot status transitions.
- Returning from hosted checkout does NOT verify payment. Webhook verification is deferred to Batch 4+.

## Authoritative payment amounts

`backend/services/PaymentAmountResolver.php` is the only permitted source
of a future gateway amount. It takes a **reference** (`reference_kind` +
`reference_id`), never a client amount — a client amount is structurally
incapable of becoming the gateway amount.

| Transaction type | Has authoritative price? | Source                       | Gateway checkout |
| ---------------- | ------------------------ | ---------------------------- | ---------------- |
| Lot Purchase     | YES                      | `lots.price` (direct or via burial_schedules) | Allow once Batch 3 lands |
| Cremation        | NO                       | —                            | Blocked until pricing defined |
| Relocation       | NO                       | —                            | Blocked until pricing defined |
| Renewal          | NO                       | —                            | Blocked until pricing defined |
| Other            | NO                       | —                            | Blocked until pricing defined |

`resolve()` returns `amount` (PHP decimal) and `amount_cents` (integer
centavos, the exact value PayMongo requires) plus `reason_code`/`reason` on
failure. Unsupported types fail with `missing_pricing_source` — prices must
never be invented or taken from client input.

## Database

`backend/database/migration_20260910_add_paymongo_gateway_fields.sql`
adds nullable, non-destructive association columns to `payments`:

`gateway_provider`, `currency` (default `PHP`), `gateway_payment_intent_id`
(unique), `gateway_checkout_session_id` (unique), `gateway_payment_id`
(unique), `gateway_status`.

All gateway id columns are `NULL` for manual/offline rows; unique indexes
allow multiple NULLs, so legacy rows remain valid and untouched. The existing
`Pending / Verified / Rejected` verification semantics are unchanged. The
webhook-events and refunds tables belong to later batches and are **not**
created here.

## Tests

- `tests/test_paymongo_foundation_b2.php` (no DB): config loading, unconfigured
  behavior, public-safe config (secrets never exposed), mode inference,
  request fails closed without credentials.
- `tests/test_payment_amount_resolver_b2.php` (DB): Lot Purchase authoritative
  pricing + cents conversion, unsupported types blocked, resolver accepts no
  client amount, legacy manual rows remain insertable/valid with NULL gateway
  columns after migration.

Run with the project's PHP binary, e.g.
`C:\laragon\bin\php\php-8.3.33-*\php.exe tests/test_paymongo_foundation_b2.php`.