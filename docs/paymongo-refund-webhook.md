# PayMongo Refund Webhook & CMS Refund State Synchronization (Batch 6)

## 1. Overview
Batch 6 implements server-authoritative PayMongo refund webhook receiving and asynchronous state synchronization for the CodeRebels Cemetery Management System (CMS).

When refunds are requested (Batch 5), PayMongo processes them and sends asynchronous webhook notifications. Batch 6 captures these events, securely verifies HMAC-SHA256 signatures, validates exact integer centavos and environment livemode, prevents invalid state regressions, records idempotent delivery via `webhook_events`, and synchronizes CMS refund states.

---

## 2. Webhook Endpoints
CMS exposes two entry points:

1. **Dedicated Refund Webhook Route**:
   - `POST /api/payments/refund-webhook`
   - Purpose: Dedicated webhook endpoint for PayMongo refund notifications (`payment.refunded`, `payment.refund.updated`, `refund.succeeded`).
   - Authentication: Unauthenticated by CMS JWT (publicly reachable by PayMongo). Security is enforced strictly via server-side PayMongo HMAC-SHA256 signature verification.

2. **Unified Payments Webhook Route**:
   - `POST /api/payments/webhook`
   - Purpose: Unified PayMongo webhook endpoint. When receiving refund events, it automatically forwards processing to `handleRefundWebhook`.

---

## 3. Supported Refund Events
The webhook handler normalizes and handles current official PayMongo event types:
- `payment.refunded`
- `payment.refund.updated`
- `refund.succeeded`

Other event types (e.g. `checkout_session.payment.paid`) continue to be handled by their respective payment handlers, while unhandled event types are safely ignored with HTTP 200 and logged to `webhook_events`.

---

## 4. Signature Verification & Security
- **Header**: `Paymongo-Signature` (or `HTTP_PAYMONGO_SIGNATURE`).
- **Secret**: Loaded from server-side environment `PAYMONGO_WEBHOOK_SECRET`.
- **Fail-Closed**: If the secret is missing or empty, the webhook immediately returns `HTTP 401 Unauthorized` without reading payload details or modifying database state.
- **Verification Modes**:
  1. Timestamped signature format: `t=<timestamp>,te=<test_sig>,li=<live_sig>` where signature is computed over `<timestamp>.<raw_body>`.
  2. Direct HMAC match: fallback for testing environments and direct payload signatures.
- **Timing Safety**: All hash comparisons utilize timing-safe `hash_equals()`.
- **Payload Capture**: Raw request body (`php://input`) is captured before JSON decoding. Malformed JSON is rejected with `HTTP 400 Bad Request`.

---

## 5. Event ID vs. Refund Resource ID
PayMongo payloads contain distinct identifiers that must never be conflated:
1. **Event ID**:
   - Format: `evt_...` (e.g., `evt_1234567890`).
   - Location: `payload.data.id` or `payload.id`.
   - Purpose: Represents the unique delivery event for webhook idempotency in `webhook_events.event_id`.
   - **Fallback Key**: If PayMongo delivers a payload without an authoritative `evt_...` identifier, a documented fallback idempotency key is generated in the exact format:
     `fallback:refund:{gateway_refund_id}:{event_type}:{status}`
     CMS explicitly flags this as a fallback (`is_fallback_event_id = true`) and never mislabels it as an authentic PayMongo Event ID.
2. **Refund Resource ID**:
   - Format: `ref_...` (e.g., `ref_abcdef123456`).
   - Location: `payload.data.attributes.data.id`, `payload.data.data.id`, or nested inside payment refunds.
   - Purpose: Authoritative gateway identifier for matching CMS `refunds.gateway_refund_id`.

---

## 6. Gateway Data Validation & Refund Matching
Before modifying CMS state, the following validation checks are enforced:
1. **Gateway Refund ID**:
   - Must be present and formatted with prefix `ref_`.
   - CMS locates the internal refund record: `SELECT ... FROM refunds WHERE gateway_refund_id = ? FOR UPDATE`.
   - Unknown refund IDs return `HTTP 200 OK` (with `status: unmatched`) to acknowledge receipt and prevent indefinite retries, while recording a `payment.refund_webhook_unmatched` critical system exception.
2. **Associated Payment ID**:
   - If `payment_id` is supplied in the webhook payload, it must match the associated CMS payment's `gateway_payment_id`.
   - Mismatched payment IDs are rejected with `HTTP 200 OK` (with `status: mismatch`) and logged to `SystemException`.
3. **Exact Integer Centavos**:
   - The webhook refund amount (in integer centavos) is compared directly against `Refund::toCentavos($cmsRefund['amount'])`.
   - Any difference (even 1 centavo) causes rejection without modifying the refund record.
4. **Currency**:
   - Currency must be `PHP` and match the CMS refund currency.
5. **Livemode Consistency**:
   - The webhook `livemode` attribute must match the CMS server environment (`PAYMONGO_ENV`). Live webhooks sent to test CMS or test webhooks sent to live CMS are rejected.

---

## 7. State Machine & Transition Rules
Gateway statuses are mapped to CMS statuses:
- `pending` → `Pending`
- `processing` → `Processing`
- `succeeded` → `Succeeded`
- `failed` → `Failed`

The safe state machine strictly enforces:
- **Identical Status**: Idempotent no-op returning `HTTP 200 OK` (`status: no_change`).
- **Terminal State Protection**:
  - `Succeeded` is strictly terminal and can never regress to `Pending`, `Processing`, or `Failed`.
  - `Failed` is terminal and cannot regress to `Pending` or `Processing`.
- **Regression Prevention**:
  - `Processing` cannot regress to `Pending`.
- **Valid Transitions**:
  - `Pending` → `Processing`
  - `Pending` → `Succeeded`
  - `Pending` → `Failed`
  - `Processing` → `Succeeded`
  - `Processing` → `Failed`
- **Timestamping**: When transitioning to `Succeeded` or `Failed`, `processed_at` is stamped with the current datetime (`NOW()`).

---

## 8. Webhook Idempotency & Database Transactions
- Webhook events are tracked in the existing `webhook_events` table (`event_id` unique constraint).
- **Row-Level Concurrency**: State synchronization executes in a short database transaction with `FOR UPDATE` locks on `webhook_events` and `refunds`.
- **No External HTTP Calls**: PayMongo API requests are never performed inside the database transaction.
- **Duplicate Deliveries**: If an event with `processed = 1` arrives again, it immediately returns `HTTP 200 OK` (`status: duplicate`) without modifying refund records or creating duplicate audit logs.

---

## 9. Audit Logging & System Exceptions
- **Audit Logs**: Meaningful synchronizations record an entry in `audit_logs` with action `Payment refund status synchronized`, documenting `old_status`, `new_status`, `refund_id`, `payment_id`, `gateway_refund_id`, and `event_id`.
- **Notifications**: On successful synchronization, in-app notifications are dispatched to the staff/admin who requested the refund.
- **System Exceptions**: Unmatched refunds, environment/currency/amount mismatches, and invalid state regression attempts are recorded in `system_exceptions`.
- **Secret Protection**: Gateway API secrets and webhook secrets are never logged or returned in responses.

---

## 10. Non-Destructive Boundary
Batch 6 strictly manages refund state synchronization only:
- It does **NOT** cancel bookings.
- It does **NOT** release or update lot statuses.
- It does **NOT** reverse burial or cremation schedules.
- It does **NOT** modify lot occupancy or inventory.

---

## 11. Test Mode Behavior & Known Limitations
- All testing was performed using PayMongo sandbox configurations and deterministic test suites. No real money was moved.
- When running outside public networks without a tunneling proxy (e.g. ngrok), real external PayMongo webhooks cannot directly reach `localhost`. In production/staging, the webhook URL (`https://your-domain.com/api/payments/refund-webhook` or `/api/payments/webhook`) must be configured in the PayMongo Merchant Dashboard under Webhooks.
