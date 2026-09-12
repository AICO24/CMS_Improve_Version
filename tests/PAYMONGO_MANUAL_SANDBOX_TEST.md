# PayMongo Real Sandbox Manual Acceptance Testing Guide

This guide provides step-by-step instructions for executing real end-to-end sandbox testing of the PayMongo payment gateway integration in the Cemetery Management System (CMS).

> [!IMPORTANT]
> **Authoritative Verification Boundary:**
> Browser redirect success is not proof of payment verification. Final verification is strictly webhook-authoritative. Only a signed, verified PayMongo webhook transitions a payment to `Verified`, confirms the burial schedule, and reserves the cemetery lot.

---

## A. Required Configuration

The system requires test credentials set in your local `.env` file (`C:\laragon\www\CMS\.env`):

| Variable | Description | Example / Format |
| :--- | :--- | :--- |
| `PAYMONGO_SECRET_KEY` | PayMongo Test Secret Key | `sk_test_...` |
| `PAYMONGO_PUBLIC_KEY` | PayMongo Test Public Key | `pk_test_...` |
| `PAYMONGO_WEBHOOK_SECRET` | Webhook Signing Secret | `whsk_...` |
| `PAYMONGO_ENV` | Gateway Environment | `test` |
| `APP_ENV` | Application Environment | `local` / `development` |

### Webhook Endpoint Details
- **Production/Tunnel Webhook URL**: `https://<YOUR-PUBLIC-DOMAIN>/api/payments/webhook`
- **Refund Webhook URL**: `https://<YOUR-PUBLIC-DOMAIN>/api/payments/refund-webhook`

### Local Development Webhook Exposure Requirement
Because local development servers (`http://localhost` or `http://127.0.0.1`) run in private network spaces that cannot receive incoming POST requests directly from PayMongo's remote cloud servers (`api.paymongo.com`), a public secure tunnel is required for live webhook testing:
1. Start an HTTPS tunnel pointing to your local web server (e.g. `ngrok http 80` or `cloudflared tunnel --url http://localhost:80`).
2. Copy your public forwarding HTTPS URL (e.g. `https://cemetery-test.ngrok-free.app`).
3. In your **PayMongo Dashboard (Test Mode)** > **Developers** > **Webhooks**:
   - Register endpoint: `https://cemetery-test.ngrok-free.app/backend/routes/api.php/payments/webhook`
   - Select events: `checkout_session.payment.paid`
   - Copy the generated Webhook Signing Secret (`whsk_...`) and place it in your `.env` as `PAYMONGO_WEBHOOK_SECRET`.

---

## B. Starting the CMS Locally

1. Launch **Laragon** (or your local Apache/Nginx + MySQL stack).
2. Ensure MySQL is running on port 3306 and Apache is active.
3. Open your browser to `http://localhost/CMS/` (or your configured virtual host).
4. Verify gateway readiness by logging in as Admin and accessing:
   `GET /api/payments/readiness`
   Confirm `paymongo_configured: true`, `environment: "test"`, and `webhook_endpoint_configured: true`.

---

## C. Creating a Test Burial Booking

1. Log in as a citizen user (or sign up at `http://localhost/CMS/frontend/pages/login.html`).
2. Navigate to **Book a Service** (`book-a-service.html`).
3. Select **Burial Service** and interact with the booking assistant:
   - Provide decedent details.
   - Pick an **Available** lot from the cemetery map.
   - Choose a future schedule date (Tuesday – Sunday; Mondays are excluded).
4. Review the details in the review step.
5. Click **Confirm Reservation**.

---

## D. Initiating PayMongo Checkout

1. Upon confirming the draft:
   - If online checkout is active, the assistant automatically initiates a checkout session and redirects to PayMongo's hosted payment page (`https://checkout.paymongo.com/...`).
   - If you return to **My Bookings** (`my-bookings.html`), open the booking modal and click **Pay Online (PayMongo)**.
2. The browser navigates to the PayMongo test checkout session.

---

## E. Verification BEFORE Payment

Before submitting payment details in the PayMongo sandbox checkout screen, verify the database/admin state:

1. **Schedule State**:
   - `burial_schedules.status` is `Pending`.
2. **Payment State**:
   - `payments.verification_status` is `Pending`.
   - `payments.payment_method` is `PayMongo`.
   - `payments.amount` matches the authoritative lot price.
   - `payments.gateway_checkout_session_id` is populated with `cs_...`.
3. **Lot State**:
   - `lots.status` remains `Available` (never prematurely Reserved or Occupied).
4. **Concurrency Guard**:
   - Competing buyers attempting to check out the same lot receive HTTP 409 (`lot_held_checkout`).

---

## F. Verification AFTER Successful Payment

On the PayMongo hosted checkout page, use official test payment methods (e.g. Test GCash or Test Cards: `4242 4242 4242 4242`, any future expiry date, CVV `123`, OTP `123456`).

1. **Browser Return**:
   - PayMongo redirects back to:
     `http://localhost/CMS/frontend/pages/my-bookings.html?checkout_status=success&payment_id=...&schedule_id=...`
   - A success banner appears informing the citizen that payment was received and awaiting final confirmation.
   - Address bar is sanitized cleanly via `history.replaceState()`.
2. **Webhook Reception & Signature**:
   - Webhook POST arrives at `/api/payments/webhook`.
   - HMAC-SHA256 signature in `Paymongo-Signature` header is validated against `PAYMONGO_WEBHOOK_SECRET`.
   - `webhook_events` records `event_id = cs_...`, `processing_result = 'verified'`, `processed = 1`.
3. **State Updates**:
   - `payments.verification_status` transitions from `Pending` to `Verified`.
   - `payments.gateway_status` updates to `paid`.
   - `burial_schedules.status` transitions from `Pending` to `Confirmed`.
   - `lots.status` transitions from `Available` to `Reserved`.
4. **Audit & Notifications**:
   - `audit_logs` records `Payment verified` and post-commit automation events.
   - In-app notification created for the citizen.
   - In **My Bookings**, the booking badge displays **Confirmed** and payment status displays **Payment Verified**.

---

## G. Verification After Checkout Cancellation

1. On the PayMongo hosted checkout page, click **Cancel and return to CodeRebels Cemetery**.
2. **Browser Return**:
   - Browser redirects to:
     `http://localhost/CMS/frontend/pages/my-bookings.html?checkout_status=cancelled&payment_id=...&schedule_id=...`
   - A cancellation banner is displayed: "Checkout was cancelled. Your booking remains pending."
3. **Integrity Checks**:
   - `payments.verification_status` remains strictly `Pending` (no false verification).
   - `burial_schedules.status` remains `Pending`.
   - `lots.status` remains `Available`.
4. **Retry Checkout**:
   - Open the booking details modal in My Bookings.
   - Click **Retry Payment (PayMongo)**.
   - Verify that the system reuses the existing payment record and creates a fresh checkout session without duplicate records.

---

## H. Verification for Duplicate Webhook Delivery

1. Simulate or resend the same webhook event payload with the authentic signature.
2. Verify response is `HTTP 200` with `status = "duplicate"`.
3. Verify `payments`, `burial_schedules`, and `lots` undergo zero duplicate transitions or duplicate notifications.

---

## I. Summary of Verification Contracts

| Step | Trigger | Expected Outcome |
| :--- | :--- | :--- |
| **Booking Creation** | Citizen finalizes draft | Schedule `Pending`, Payment `Pending`, Lot `Available` |
| **Checkout Creation** | Assistant or My Bookings modal | Hosted session created, lease active for 1 hour |
| **Redirect Return** | User finishes checkout in browser | UX notification only; state strictly unchanged |
| **Webhook Delivery** | PayMongo dispatch | Payment `Verified`, Schedule `Confirmed`, Lot `Reserved` |
| **Duplicate Delivery** | PayMongo retry or replay | HTTP 200 duplicate; idempotent no-op |
| **Cancellation** | User cancels on PayMongo | Booking remains `Pending`; retry available |
| **Collision Handling** | Slot occupied prior to webhook | Automatic refund triggered; notes tagged `[RESOURCE_COLLISION]` |
