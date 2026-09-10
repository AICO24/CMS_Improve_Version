# PayMongo Payment & Refund Reconciliation / Consistency & Safe Recovery (Batches 7 & 8)

## 1. Overview & Scope Clarification

Batch 7 established the foundation for monetary precision, consistency validation, and ambiguous record observability.
**Batch 8 implements the safe, operator-driven Payment Reconciliation & Safe Recovery engine** for the CodeRebels Cemetery Management System (CMS).

### Core Architectural Distinctions
1. **Webhook Synchronization (Batches 4 & 6)**: Real-time, asynchronous, event-driven state updates delivered by PayMongo and validated against cryptographic signatures and integer-centavo monetary rules.
2. **Stale Record Detection / Observability (Batches 7 & 8)**: Safe, read-only inspection methods (`Payment::findStalePendingGatewayPayments()` and `Refund::findStalePendingGatewayRefunds()`) that surface ambiguous or unconfirmed transaction records without altering database state or issuing automated gateway requests.
3. **Operator-Driven Safe Reconciliation (Batch 8)**: An **Admin-only, two-step workflow (Check → Authorized Apply)** that enables authorized administrators to safely synchronize CMS records with authoritative PayMongo state when webhooks were missed, delayed, or dropped.
4. **Automated Background Polling / Cron (Deferred)**: **Background cron, Redis, queues, Celery, or automated daemons are intentionally deferred**. CMS does NOT run automatic background polling or heuristic reconciliation. All reconciliation is synchronous and operator-initiated.

---

## 2. Why Reconciliation Exists & Missed Webhook Scenarios

In a real-world payment gateway integration, webhooks can fail or be missed due to:
- Transient network partition between PayMongo and the CMS server.
- Temporary CMS server downtime or deployment restart during webhook delivery.
- DNS resolution failures or edge firewall blocking.
- Exhaustion of PayMongo webhook delivery retry attempts before CMS server recovery.

Without reconciliation:
- A citizen completes payment on PayMongo Hosted Checkout, but CMS remains in `Pending`, blocking lot reservation or schedule confirmation.
- An administrator initiates a refund that times out during transit; the refund remains in `Processing` even though PayMongo succeeded in issuing the refund.

Batch 8 provides a secure, audited mechanism for administrators to resolve these discrepancies safely.

---

## 3. The Two-Step Reconciliation Model (Check → Evidence → Apply)

Reconciliation strictly follows a two-step, operator-driven lifecycle:

### Step 1: Read-Only Check (`GET /api/payments/{id}/reconcile-check` and `GET /api/refunds/{id}/reconcile-check`)
- Inspects the internal CMS payment or refund record.
- Extracts the stored gateway identifier (`gateway_checkout_session_id` or `gateway_refund_id`).
- Queries PayMongo directly server-to-server (`GET /v1/checkout_sessions/{id}` or `GET /v1/refunds/{id}`).
- Evaluates authoritative evidence (centavos, currency, livemode, gateway status).
- Returns a structured, public-safe evidence payload indicating `eligible: true/false`, CMS state, gateway state, and any mismatch reasons.
- **ZERO MUTATION**: Does not alter CMS payment or refund state, does not trigger automation, and does not notify end users.

### Step 2: Authoritative Apply (`POST /api/payments/{id}/reconcile-apply` and `POST /api/refunds/{id}/reconcile-apply`)
- **NEVER TRUSTS CLIENT EVIDENCE**: The backend ignores any browser-supplied evidence or gateway parameters.
- Acquires an exclusive database row lock (`SELECT ... FOR UPDATE`).
- Re-queries PayMongo fresh to confirm current gateway state.
- Revalidates exact integer centavos, currency, livemode, and gateway status.
- Re-reads current CMS state under row lock to confirm payment is still `Pending` or refund is still in an allowable non-terminal state.
- Performs atomic state transition (e.g., `Payment::verifyIfPending()`).
- Persists authentic gateway resource IDs (`pay_...` or `ref_...`).
- Logs a comprehensive, immutable audit log entry in `audit_logs`.
- Triggers downstream post-commit automation exactly once (for payments: lot status synchronization and burial schedule confirmation).

---

## 4. Admin-Only Authorization

Reconciliation routes are strictly restricted to administrators:
- `GET  /api/payments/stale-gateway` -> Admin only (`AuthMiddleware::requireRole(['admin'])`)
- `GET  /api/payments/{id}/reconcile-check` -> Admin only
- `POST /api/payments/{id}/reconcile-apply` -> Admin only
- `GET  /api/refunds/{id}/reconcile-check` -> Admin only
- `POST /api/refunds/{id}/reconcile-apply` -> Admin only

Staff and Citizen (User) roles attempting to access reconciliation endpoints receive `403 Forbidden`. Endpoints never expose secret API keys, webhook secrets, or raw HTTP authorization headers.

---

## 5. Server-Side Evidence Revalidation

When an administrator submits an APPLY request:
1. CMS does NOT trust payload attributes (amounts, transaction IDs, statuses) submitted by the browser.
2. The server independently issues a fresh HTTP call to PayMongo using the stored gateway session/refund ID.
3. The server compares:
   - **Exact Centavos**: CMS amount converted via `Refund::toCentavos()` must equal gateway amount in integer centavos.
   - **Currency**: Must be `PHP` and match CMS currency.
   - **Livemode**: Gateway livemode boolean must match configured `PAYMONGO_ENV` (`test` vs `live`).
   - **Gateway Status**: Gateway status must be `paid` for payments, or `succeeded`/`failed` for refunds.
   - **Identity**: Remote resource ID must match expected session or payment correlation.

If any check fails, the apply operation is rejected with `HTTP 422 Unprocessable Entity`, no state transition occurs, and a warning is logged in `system_exceptions`.

---

## 6. Payment Reconciliation Flow

```text
Admin clicks "Reconcile Payment"
               ↓
GET /api/payments/{id}/reconcile-check
               ↓
Load CMS payment record
Query PayMongo GET /v1/checkout_sessions/{session_id}
Verify status === 'paid', extract pay_..., compare centavos & currency
Return structured evidence (eligible = true/false)
               ↓
Admin reviews evidence and clicks "Apply Reconciliation"
               ↓
POST /api/payments/{id}/reconcile-apply
               ↓
Begin DB Transaction
SELECT * FROM payments WHERE payment_id = ? FOR UPDATE
Check if already Verified -> if so, return already_reconciled (idempotent no-op)
Fresh PayMongo query + full revalidation
Payment::verifyIfPending($id, 'Verified', $adminId, $timestamp)
Persist gateway_payment_id and gateway_status
Log AuditLog ('reconcile_payment')
Create Admin Notification
Commit Transaction
               ↓
Outside transaction: triggerPostVerificationAutomation()
  → Sync lot status to 'Reserved'
  → Confirm burial schedule if applicable
```

---

## 7. Refund Reconciliation Flow

```text
Admin clicks "Reconcile Refund"
               ↓
GET /api/refunds/{id}/reconcile-check
               ↓
Load CMS refund record
If gateway_refund_id is NULL:
  → eligible = false, requires_manual_investigation = true (FAIL CLOSED)
If gateway_refund_id exists:
  → Query PayMongo GET /v1/refunds/{id}
  → Verify payment_id match, exact centavos, currency, livemode
  → Read actual gateway status ('succeeded' -> 'Succeeded', 'failed' -> 'Failed')
  → Return structured evidence
               ↓
Admin reviews evidence and clicks "Apply Reconciliation"
               ↓
POST /api/refunds/{id}/reconcile-apply
               ↓
Begin DB Transaction
SELECT * FROM refunds WHERE refund_id = ? FOR UPDATE
Check terminal states:
  → If Succeeded or Failed: return already_reconciled (no regression)
Fresh PayMongo query + full revalidation
Apply allowed transition:
  → Processing → Succeeded (preserves exact centavos, sets processed_at)
  → Processing → Failed (releases balance back to refundable pool)
Log AuditLog ('reconcile_refund')
Create Admin Notification
Commit Transaction
```

---

## 8. Ambiguous Refund Handling (Zero Heuristic Guessing)

If a CMS refund has `gateway_refund_id = NULL` (e.g. following a network timeout during initial creation):
- **Heuristic matching by amount and timestamp is strictly prohibited.**
- CMS does NOT attempt to guess or attach a remote `ref_...` based on amount, date, or customer heuristics.
- The check returns:
  ```json
  {
    "eligible": false,
    "requires_manual_investigation": true,
    "mismatches": [
      "No gateway refund ID exists on CMS refund record. Heuristic matching by amount and timestamp is strictly prohibited; manual investigation in PayMongo dashboard is required."
    ]
  }
  ```
- Reconciliation apply fails closed with `HTTP 422`.
- CMS never creates a second refund or guesses identifiers.

---

## 9. Stale Record Detection (Read-Only Observability)

To allow administrators to identify stalled or forgotten gateway transactions:
- `GET /api/payments/stale-gateway?older_than_minutes=60`
- **Stale Payments**: Identifies payments in `Pending` with a valid `gateway_checkout_session_id` created more than $N$ minutes ago.
- **Stale Refunds**: Identifies refunds in `Processing` or `Pending` created more than $N$ minutes ago (both those with and without gateway refund IDs).
- **Strictly Read-Only**: Stale queries execute `SELECT` statements only, make zero gateway calls, and make zero state changes.

---

## 10. Webhook vs Reconciliation Race Handling & Terminal State Protection

Concurrent operations (e.g. an administrator reconciles a payment at the exact moment PayMongo delivers a delayed webhook):
1. **Row-Level Locking**: Both reconciliation apply and webhook handlers use `FOR UPDATE` on payments and refunds.
2. **Atomic Transitions**: `Payment::verifyIfPending()` uses `WHERE payment_id = ? AND verification_status = 'Pending'`. If the webhook already verified the row, reconciliation loses the race cleanly, recognizes the payment is already verified, and returns `already_reconciled` without duplicating state changes or automations.
3. **Immutable Terminal States**:
   - `Verified` payments can never regress to `Pending` or `Rejected`.
   - `Succeeded` refunds can never regress to `Processing` or `Failed`.
   - `Failed` refunds can never regress to `Processing` or `Succeeded`.

---

## 11. Audit Logging & System Exceptions

Every successful reconciliation creates an immutable audit record in `audit_logs`:
- Action: `reconcile_payment` or `reconcile_refund`
- Entity: `Payment` or `Refund`
- Details include:
  - `reconciliation_type`: `payment` or `refund`
  - `payment_id` / `refund_id`
  - `previous_status` and `resulting_status`
  - `gateway_resource_id` (`pay_...` or `ref_...`)
  - `gateway_status`
  - `amount_centavos` and `currency`
  - `livemode`
  - `operator_admin_id`
  - `evidence_validation_result`
  - `timestamp`

Rejected reconciliation attempts raise an event in `system_exceptions` (`payment.reconciliation_rejected` or `payment.refund_reconciliation_rejected`) for forensic review.

---

## 12. Manual Operator Recovery Procedure

When an administrator observes a stale record:
1. Review `/api/payments/stale-gateway` to identify stale records.
2. Run `GET /api/payments/{id}/reconcile-check` to fetch live PayMongo evidence.
3. If evidence is `eligible: true`:
   - Inspect the mismatch list (should be empty).
   - Click "Apply Reconciliation" (`POST /api/payments/{id}/reconcile-apply`).
   - Confirm payment transitions to `Verified` and lot reservation is updated.
4. If evidence is `eligible: false`:
   - Inspect the specific mismatch reasons (e.g. `awaiting_payment_method`, amount mismatch, currency mismatch).
   - If the payment was abandoned by the user on the Hosted Checkout page, leave it in `Pending` or mark `Rejected` through standard payment administration.
   - If a refund has `requires_manual_investigation: true`, log into the PayMongo Dashboard, locate the payment ID, determine whether a refund was created, and follow manual reconciliation protocol.

---

## 13. Infrastructure & Deployment Boundaries

- **No Background Daemons**: No Redis, no queues, no workers, no cron jobs, and no scheduled background polling.
- **No Database Migrations**: Batch 8 utilizes existing database schemas (`payments`, `refunds`, `audit_logs`, `system_exceptions`, `notifications`).
- **Synchronous & Operator-Driven**: All reconciliation logic executes strictly within incoming HTTP request lifecycles.
- **Sandbox Testing**: Tested strictly against PayMongo test credentials (`sk_test_...`) and mocked responses. Real financial transactions are never initiated during automated testing.
