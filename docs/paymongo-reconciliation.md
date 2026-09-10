# PayMongo Payment & Refund Reconciliation / Consistency Foundation (Batch 7)

## 1. Overview & Scope Clarification

Batch 7 establishes the foundation for monetary precision, consistency validation, and ambiguous record observability across the PayMongo payment and refund lifecycle in the CodeRebels Cemetery Management System (CMS).

### Important Architectural Distinction
It is critical to distinguish between three distinct operational concepts:
1. **Webhook Synchronization (Batches 4 & 6)**: Real-time, event-driven state updates delivered by PayMongo and validated against cryptographic signatures and integer-centavo monetary rules.
2. **Stale Record Detection / Observability (Batch 7)**: Safe, read-only inspection methods (`findStalePendingGatewayRefunds`) that surface ambiguous or unconfirmed transaction records without altering database state or issuing automated gateway requests.
3. **Full Gateway Reconciliation (Deferred)**: Automated two-way ledger comparison, periodic polling, transaction mismatch remediation, and settlement matching. **Full automated reconciliation is intentionally deferred** and is NOT implemented in Batch 7.

---

## 2. Current Payment State Authority

Payment states in CMS are server-authoritative and follow a strict, unidirectional lifecycle:
- **Pending**: Initial state upon payment creation or checkout session initiation. Browser redirection to the checkout page is NEVER authoritative proof of payment.
- **Verified**: Authoritatively confirmed solely via cryptographically verified PayMongo webhooks (`checkout_session.payment.paid`) or authorized manual administrative verification with receipt tracking.
- **Rejected**: Payment rejected by administrative review or failed during offline validation.

The CMS database is the single source of truth for payment status. Client applications and redirects cannot alter payment status.

---

## 3. Current Refund State Authority

Refund records in the `refunds` table follow a controlled state machine:
- **Pending**: The refund has been recorded by CMS and is queued for submission to PayMongo.
- **Processing**: The refund request was dispatched to PayMongo and is either awaiting an asynchronous webhook confirmation or encountered an ambiguous network/gateway response (timeout, 5xx, or network failure).
- **Succeeded (Terminal)**: PayMongo authoritatively confirmed the refund succeeded via a signed webhook (`refund.succeeded` or `payment.refunded`).
- **Failed (Terminal)**: The refund was definitively rejected by PayMongo (4xx client error) or failed gateway processing.

Terminal states (`Succeeded` and `Failed`) are immutable; once reached, CMS strictly blocks regressions back to `Pending` or `Processing`.

---

## 4. Payment-to-Refund Relationship

- **One-to-Many**: A single CMS payment may have zero, one, or multiple partial refund records.
- **Foreign Key Constraint**: Every refund record enforces `FOREIGN KEY (payment_id) REFERENCES payments(payment_id) ON DELETE RESTRICT`.
- **Authoritative Balance Allocation**: The total refundable amount of a payment is strictly bounded:
  $$\sum (\text{Pending Cents} + \text{Processing Cents} + \text{Succeeded Cents}) \le \text{Payment Original Cents}$$
  Failed refunds release their allocated amount back into the remaining refundable balance.

---

## 5. Webhook Idempotency

Both payment and refund webhooks guarantee exactly-once processing semantics through the `webhook_events` table:
- Every event is identified by an authoritative event identifier (`event_id`):
  - For generic envelopes: PayMongo Event ID (`evt_...`).
  - For Hosted Checkout payment webhooks: PayMongo Checkout Session ID (`cs_...`).
  - For refund webhooks lacking an `evt_...`: Documented deterministic fallback key `fallback:refund:{ref_id}:{event_type}:{status}`.
- Concurrency protection: `SELECT * FROM webhook_events WHERE event_id = ? FOR UPDATE`.
- Duplicate deliveries return `HTTP 200 OK` with status `duplicate` without re-executing state transitions, business automations, or duplicate audit log entries.

---

## 6. Out-of-Order Webhook Protection

Asynchronous webhooks can arrive out of order due to network retries or transient gateway delays:
- CMS rejects state regressions:
  - `Succeeded` cannot regress to `Pending`, `Processing`, or `Failed`.
  - `Failed` cannot regress to `Pending` or `Processing`.
  - `Processing` cannot regress to `Pending`.
- When an out-of-order webhook arrives attempting an illegal regression:
  - The webhook event is recorded in `webhook_events` with `processing_result = 'invalid_state_regression'`.
  - A `SystemException` is raised with severity `warning` or `critical`.
  - `HTTP 200 OK` is returned to acknowledge receipt to PayMongo without corrupting CMS data.

---

## 7. Exact-Centavo Handling (No Float Arithmetic)

Binary floating-point arithmetic introduces rounding inaccuracies (e.g. `1000.10 * 100` evaluating to `100009.99999999999` in IEEE 754). Batch 7 mandates exact integer-centavo conversions:
- Implemented via `Refund::toCentavos($amount)`:
  - Parses pesos and cents as discrete string components.
  - Computes `(pesos * 100) + cents` strictly using integer arithmetic.
  - Example: `1000.10 PHP` is parsed exactly to `100010` centavos.
- Applied in:
  - `PaymentController::handleWebhook()`: Authoritative payment amount comparison `$cmsAmountCents = Refund::toCentavos($payment['amount'])`.
  - `RefundService::processRefund()`: All balance checks and gateway payload creations.
  - `RefundService::synchronizeWebhookRefund()`: Validations against webhook centavo figures.

---

## 8. Currency Validation & Safe Fallback Contract

PayMongo Hosted Checkout for CMS operates strictly in Philippine Pesos (`PHP`).
In Batch 7, currency validation adheres to the following rules:
1. **Explicit Currency Check**: Any explicit non-PHP currency in the webhook (e.g. `USD`, `EUR`) is immediately rejected, logs a `payment.webhook_currency_mismatch` `SystemException`, and leaves the payment in `Pending`.
2. **CMS Payment Currency Match**: The webhook currency must match the CMS payment currency (`payments.currency`).
3. **Safe Envelope Default**: If currency attributes are omitted from the webhook envelope (e.g. older PayMongo payload structures), but the checkout session is valid and CMS expects `PHP`, CMS defaults the extracted webhook currency to `'PHP'` to match PayMongo's regional hosted checkout contract, avoiding false rejections without weakening validation against explicit mismatches.

---

## 9. Concurrent Refund Protection

To prevent race conditions when two administrators or processes attempt simultaneous refunds against the same payment:
- `RefundService::processRefund()` executes within an atomic database transaction.
- Locks the target payment row via `SELECT ... FROM payments WHERE payment_id = ? FOR UPDATE`.
- Re-evaluates `calculateRemainingRefundableCents($paymentId, $payment['amount'])` under the active row lock.
- If concurrent requests exceed the remaining balance, the second request fails closed with `HTTP 400 Bad Request` and no funds or gateway calls are duplicated.

---

## 10. Ambiguous Gateway Refund Scenario

When initiating a refund via PayMongo API (`POST /refunds`):
1. CMS creates a `Pending` refund record.
2. The HTTP request to PayMongo is dispatched.
3. If the gateway times out, returns HTTP 5xx, or disconnects (cURL error 28 / status 0):
   - **No Assumption of Failure**: PayMongo may have successfully debited and refunded the customer despite the broken response.
   - **No Assumption of Success**: PayMongo may have dropped the request before processing.
   - **Preserved in Processing**: CMS updates the refund to `Processing` with `gateway_refund_id = NULL` and records notes.
   - **Contextual Exception Raised**: A `SystemException` (`payment.refund_gateway_timeout`) is raised containing `payment_id`, `refund_id`, `gateway_payment_id`, and `idempotency_key`.
   - **No Arbitrary String Scraping**: CMS does NOT attempt speculative regex matching of error strings to guess gateway refund IDs.

---

## 11. Stale Refund Detection (Read-Only Observability)

To observe ambiguous refunds that were left in `Processing` or `Pending` without gateway confirmation:
- Method: `Refund::findStalePendingGatewayRefunds(int $olderThanMinutes = 30): array`.
- **Query Criteria**:
  - `status IN ('Pending', 'Processing')`
  - `gateway_refund_id IS NULL`
  - `created_at <= threshold` (default 30 minutes ago)
- **Data Returned**: Refund attributes joined with payment details (`gateway_payment_id`, `receipt_number`, `verification_status`) and requesting user name.
- **Strict Guardrails**:
  - Read-only: Makes ZERO database mutations.
  - Zero gateway calls: Does NOT contact PayMongo.
  - Zero business side-effects: Does NOT alter bookings, lots, or schedules.
  - No background runners: Operates on-demand when invoked.

---

## 12. Current Missed-Webhook Limitation

If PayMongo fails to deliver a webhook (due to external outage, network disruption, or DNS failure) or CMS is temporarily unreachable:
- CMS payment remains in `Pending`.
- CMS refund remains in `Processing`.
- Because automated background reconciliation is deferred, CMS will not automatically discover that PayMongo moved money unless a webhook is redelivered or manual investigation is conducted.

---

## 13. Gateway-vs-CMS Reconciliation Limitations

Batch 7 does NOT implement automated gateway synchronization:
- CMS does not periodically pull PayMongo transaction listings.
- CMS does not cross-reference bank settlements against CMS payments.
- Discrepancies between PayMongo's portal and CMS records require manual inspection via the provided audit logs and exception traces.

---

## 14. Manual Investigation & Recovery Considerations

When a stale ambiguous refund or unmatched webhook is identified:
1. Staff consults the `system_exceptions` table for the event (`payment.refund_gateway_timeout`, `payment.webhook_unmatched`).
2. Staff uses the logged `gateway_payment_id` (`pay_...`) and `idempotency_key` (`cms_refund_{id}`) to search the PayMongo Dashboard.
3. If the refund exists in PayMongo:
   - Identify the PayMongo refund resource ID (`ref_...`).
   - If a webhook was missed, trigger redelivery from PayMongo, or apply administrative state updates via verified procedures.
4. If no refund exists in PayMongo:
   - The transaction never executed at the gateway; staff may mark the refund as `Failed`, which automatically releases the allocated centavos back to the payment's refundable balance.

---

## 15. Why Automated Polling & Auto-Correction Are Deferred

Automated background polling, cron workers, and automated state correction were intentionally excluded from Batch 7 for critical architectural reasons:
1. **Safety Over Speculation**: Automatically flipping payment or refund statuses without human verification risks unauthorized booking confirmations or incorrect balance adjustments.
2. **Infrastructure Simplicity**: Introducing Redis, cron queues, or background daemons creates operational complexity and deployment fragility on standard hosting environments (e.g. Laragon/WAMP).
3. **Financial Audit Trail**: All financial movements must have deterministic, auditable justifications rather than heuristic automated corrections.

---

## 16. Sandbox / Test-Only Considerations

- All implementations are tested exclusively against PayMongo test credentials (`sk_test_...`, `whsec_test_...`).
- Mode validation strictly enforces that test webhooks (`livemode = false`) are rejected if CMS is ever configured for livemode, and vice-versa.
- Real PayMongo credentials and secret keys must never be committed to source control or logged in plain text.
