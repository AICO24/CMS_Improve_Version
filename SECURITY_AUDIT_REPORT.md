# CMS Security Audit Report
**Cemetery Management System (CMS)**  
**Audit Date:** September 2026  
**Auditor:** Antigravity AI Security & Architecture Auditor  
**Status:** Audit Completed — No Production Code or Database Modified  

---

## 1. Executive Summary

A comprehensive architectural and security audit was conducted on the Cemetery Management System (CMS) codebase. The audit inspected five target domains identified from external IT professional testing and system requirements:
1. **Registration & Contact Verification**
2. **Logout & Browser Back Navigation Access**
3. **Payment Security (PayMongo Hosted Checkout & Webhooks)**
4. **Booking Finalization & State Security**
5. **AI Booking Assistant & Business Knowledge Grounding**

### Key Findings Overview:
* **Registration & Contact Verification (HIGH RISK):** The system has **no email or mobile verification mechanism** (no OTP, no email verification tokens, no verification flags or timestamps in the database). Anyone can register with fictitious email addresses and phone numbers. These unverified accounts immediately gain authorization to book burial lots, schedule cremations, submit provisional decedent records, and initiate financial checkout sessions.
* **Logout & Back Navigation (HIGH RISK):** The backend provides an idempotent session invalidation mechanism (`session_version` counter bumped on `POST auth/logout`), but **the frontend `api.logout()` function never invokes this endpoint**. It only clears `localStorage`. Consequently, the JWT remains completely valid on the server until its natural expiration (8 hours to 30 days). Furthermore, static pages and API responses completely lack `Cache-Control: no-store` headers and bfcache (`pageshow`) handling, allowing unauthenticated users to view cached sensitive decedent and citizen data by simply clicking the browser Back button.
* **Payment Security (HIGH RISK):** PayMongo webhook signature verification and server-side price resolution via `PaymentAmountResolver` are strongly implemented with HMAC-SHA256 timestamp checks and integer centavo comparisons. However:
  1. The checkout creation endpoint does not check if a booking or lot already has a `Verified` payment or is already in a `Confirmed` state, permitting **duplicate payments**.
  2. For `Lot Purchase` with `reference_kind = 'lot'`, the ownership check for the `user` role is bypassed, permitting citizens to initiate checkout for arbitrary lots without an approved reservation.
  3. Unverified citizen accounts can reach payment checkouts directly.
* **Booking Finalization (MEDIUM RISK):** Backend finalization (`BookingAgentService::finalizeBurialDraft` / `finalizeCremationDraft`) is **secure and properly enforced**. Drafts transitioning to `COMMITTED` are locked into an immutable terminal state, rejecting subsequent finalize attempts with HTTP 409 (`DRAFT_ALREADY_COMMITTED`). However, on the **frontend**, `booking-assistant.js` and `booking-assistant.html` fail to hide or replace the "Confirm Booking Reservation" HUD button and modal actions once a draft is committed, misleading citizens into believing they can re-finalize an already committed booking.
* **AI Assistant & Business Knowledge (MEDIUM RISK):** Prompts are hardcoded in `python-ai/app.py`, and business knowledge is scattered across fragmented `ai_knowledge` MySQL rows and controller heuristics. There is no centralized Markdown knowledge base. Missing rules include Columbarium niche assignment protocols, payment grace periods, lease terms, renewal intervals, and exhumation requirements. The assistant also lacks a strict guardrail to filter completely unrelated, off-topic citizen queries.

---

## 2. Registration and Contact Verification

### Current Implementation
Public citizen registration is handled via `POST /api/auth/register`. The frontend form ([register.html](file:///c:/laragon/www/CMS/frontend/auth/register.html) / [register.js](file:///c:/laragon/www/CMS/assets/js/auth/register.js)) collects `full_name`, `email`, `username` (optional), `contact_number` (optional), `address` (optional), `password`, and `confirm_password`.
The backend ([AuthController.php](file:///c:/laragon/www/CMS/backend/controllers/AuthController.php#L157-L286)) validates string lengths, regex format of username and contact number, email syntax via `filter_var(..., FILTER_VALIDATE_EMAIL)`, and password match/length. It then calls `User::create()` ([User.php](file:///c:/laragon/www/CMS/backend/models/User.php#L29-L57)), assigning the account the `user` role with `is_active = 1`.

### Relevant Files
* Backend Controller: [AuthController.php](file:///c:/laragon/www/CMS/backend/controllers/AuthController.php#L157-L286)
* User Domain Model: [User.php](file:///c:/laragon/www/CMS/backend/models/User.php)
* Routes: [api.php](file:///c:/laragon/www/CMS/backend/routes/api.php#L110-L148)
* Frontend Form: [register.html](file:///c:/laragon/www/CMS/frontend/auth/register.html)
* Frontend Script: [register.js](file:///c:/laragon/www/CMS/assets/js/auth/register.js)
* Database Schema: [schema.sql](file:///c:/laragon/www/CMS/backend/database/schema.sql#L441-L462)

### Relevant Endpoints
* `POST /api/auth/register` — Creates user account.
* `POST /api/auth/login` — Issues JWT Bearer token upon credential match.
* `GET /api/auth/me` — Fetches authenticated profile.

### Database Fields
Inspection of the `users` table reveals the following schema:
```sql
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `reset_token_hash` varchar(255) DEFAULT NULL,
  `reset_token_expires_at` datetime DEFAULT NULL,
  `full_name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `contact_number` varchar(50) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `role_id` int NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `last_login` datetime DEFAULT NULL,
  `session_version` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`)
);
```
**Zero verification fields exist.** There is no `email_verified`, `email_verified_at`, `contact_verified`, `phone_verified_at`, `verification_token`, or `otp_code` in `users` or any associated table. (Note: `verification_status` exists exclusively in the `payments` table for staff audit of payments).

### Current Protection
* Uniqueness checks on `email` and `username`.
* Regex formatting checks for valid email and contact number syntax.
* Password minimum length of 8 characters with bcrypt hashing.
* Rate limiting on login and password reset requests.

### Security Gap
* **No proof of ownership for email or mobile number:** Anyone can register using arbitrary email addresses (e.g. `mayor@gensan.gov.ph`) or fake numbers.
* **Immediate privilege grant:** As soon as registration succeeds, the user can immediately log in, reserve cemetery lots, schedule cremations, upload documents, and initiate payment transactions linked to the fraudulent identity.
* **Lack of server-side enforcement on sensitive operations:** Neither `BookingAgentController`, `BookingController`, `ScheduleController`, nor `PaymentController` check whether an account's contact details have been verified.

### Recommended Fix
1. **Database Migration:** Add verification columns to `users`:
   * `email_verified` (tinyint(1) DEFAULT 0)
   * `email_verified_at` (datetime DEFAULT NULL)
   * `phone_verified` (tinyint(1) DEFAULT 0)
   * `phone_verified_at` (datetime DEFAULT NULL)
   * `email_verification_token` (varchar(255) DEFAULT NULL)
   * `email_verification_expires_at` (datetime DEFAULT NULL)
2. **Registration Flow:** Upon registration, set `email_verified = 0`. Generate an activation token/code. In development/local mode, support dev activation or logging; in production, dispatch an activation email.
3. **Backend Middleware / Guard:** Implement `AuthMiddleware::requireVerifiedContact()` or check `$user['email_verified']` before allowing high-impact actions (`POST payments/checkout-session`, `POST booking-agent/drafts/{id}/confirm`, etc.).

---

## 3. Logout and Back Navigation

### Current Implementation
* **Backend:** `POST /api/auth/logout` exists in [api.php](file:///c:/laragon/www/CMS/backend/routes/api.php#L150-L175) and calls `AuthController::logout($input, $userId)`. When `$userId` is provided via the `Authorization: Bearer <token>` header, it executes `User::invalidateSessions($userId)`, which runs:
  `UPDATE users SET session_version = session_version + 1 WHERE user_id = ?`.
  In `AuthMiddleware::authenticate()`, any token whose embedded `session_version` claim does not equal the database's live `session_version` is rejected with HTTP 401 (`Invalid or expired token`).
* **Frontend:** In [api.js](file:///c:/laragon/www/CMS/assets/js/shared/api.js#L179-L185), the `logout()` method is implemented as:
  ```javascript
  logout() {
      this.setToken(null);
      localStorage.removeItem('user_session');
      localStorage.removeItem('cemetery_session');
      window.location.href = getLoginRedirectUrl();
  }
  ```
  **`api.logout()` NEVER calls the backend endpoint `POST /api/auth/logout`!**

### Relevant Files
* Frontend API Client: [api.js](file:///c:/laragon/www/CMS/assets/js/shared/api.js#L179-L185)
* Auth Middleware: [Auth.php](file:///c:/laragon/www/CMS/backend/middleware/Auth.php#L6-L69)
* Backend Routes: [api.php](file:///c:/laragon/www/CMS/backend/routes/api.php#L150-L175)
* User Model: [User.php](file:///c:/laragon/www/CMS/backend/models/User.php#L149-L152)
* Global Server Entry: [index.php](file:///c:/laragon/www/CMS/backend/index.php#L1-L46)
* Root Apache Config: [.htaccess](file:///c:/laragon/www/CMS/.htaccess)

### Authentication Mechanism
JWT (JSON Web Token) with HMAC SHA-256 containing `user_id`, `username`, `role`, `full_name`, and `session_version`. Token expiration is set to 8 hours (or 30 days if `remember_me` is checked). Token is stored in browser `localStorage.getItem('jwt_token')`.

### Cache Behavior
* Neither PHP backend scripts nor Apache configuration emit `Cache-Control`, `Pragma`, or `Expires` headers for HTML pages or JSON API responses.
* When a user clicks "Logout", `localStorage` is cleared in the browser and the window redirects to `login.html`.
* When the user clicks the browser **Back** button:
  1. The browser's Back-Forward Cache (bfcache) restores the previously rendered DOM directly from browser memory without issuing an HTTP network request.
  2. The page does not listen to the `pageshow` window event (`event.persisted`).
  3. Consequently, the user sees the dashboard, decedent names, payments, and private records exactly as they appeared prior to logout.

### Direct URL Access vs API Access After Logout
* If a logged-out user enters a direct URL (e.g. `frontend/pages/dashboard_admin.html`), the page executes `requireRole()`, which calls `api.getMe()`. Since `localStorage.getItem('jwt_token')` was removed, the Authorization header is omitted, causing `api.getMe()` to return 401 and redirect to `login.html`.
* **However, the token itself was NEVER invalidated on the server.** Because `POST /api/auth/logout` was never called, `session_version` was never incremented. If an attacker extracted the token from network history, browser memory, or an unclosed tab, all protected backend API calls remain fully authorized until natural JWT expiration.

### Security Gap
1. **Client-only logout:** Tokens are orphaned rather than revoked on the server.
2. **Bfcache exposure:** Browser Back button reveals sensitive personal and administrative data from browser cache without re-authenticating.
3. **No server-side cache-control:** Responses lack `Cache-Control: no-store, no-cache, must-revalidate`.

### Recommended Fix
1. **Fix `api.logout()` in `assets/js/shared/api.js`:**
   Change `logout()` to asynchronously send `POST auth/logout` to the backend before clearing `localStorage` and redirecting:
   ```javascript
   async logout() {
       try {
           if (this.token) {
               await this.request('auth/logout', { method: 'POST' });
           }
       } catch (e) {
           console.warn('Backend logout failed', e);
       } finally {
           this.setToken(null);
           localStorage.removeItem('user_session');
           localStorage.removeItem('cemetery_session');
           window.location.replace(getLoginRedirectUrl());
       }
   }
   ```
2. **Prevent bfcache restoration:** Add a global `pageshow` listener in `api.js`:
   ```javascript
   window.addEventListener('pageshow', function(event) {
       if (event.persisted && !localStorage.getItem('jwt_token')) {
           window.location.replace(getLoginRedirectUrl());
       }
   });
   ```
3. **Enforce Cache-Control Headers:**
   In `backend/index.php` and Apache configuration (`.htaccess`), emit:
   ```php
   header('Cache-Control: no-store, no-cache, must-revalidate, max-age=0');
   header('Pragma: no-cache');
   ```

---

## 4. Payment Security

### Current Implementation
Online checkout is handled via PayMongo Hosted Checkout Sessions. The complete flow proceeds as follows:
1. Citizen or staff requests checkout: `POST /api/payments/checkout-session`.
2. Backend validates reference via `validatePaymentReference()`.
3. Authoritative price is resolved server-side via `PaymentAmountResolver.php` (reading `lots.price` or default cremation fee). Client-submitted amount is ignored.
4. Concurrency check: `findActiveLotCheckoutLease()` verifies no other user currently holds an active 1-hour checkout lease on the lot.
5. CMS inserts or finds a `Pending` payment in `payments` table.
6. Server calls PayMongo API (`POST /v1/checkout_sessions`) with secret key and idempotency key (`cms_cs_payment_{id}_{cents}`).
7. PayMongo returns `checkout_url`. The user is redirected to PayMongo to pay via Card, GCash, or PayMaya.
8. Upon payment completion, PayMongo issues a webhook `checkout_session.payment.paid` to `POST /api/payments/webhook`.
9. `PaymentController::handleWebhook()` validates HMAC-SHA256 signature, environment/livemode, currency (`PHP`), and exact integer centavo match.
10. If valid, inside an atomic transaction with row locking on `webhook_events`, it verifies the payment record (`verifyIfPending()`), updates gateway status to `paid`, logs audit trails, sends notifications, and triggers `triggerPostVerificationAutomation()` to automatically confirm the reservation schedule.

### Relevant Files
* Payment Controller: [PaymentController.php](file:///c:/laragon/www/CMS/backend/controllers/PaymentController.php#L1362-L2400)
* Gateway Service: [PayMongoService.php](file:///c:/laragon/www/CMS/backend/services/PayMongoService.php)
* Price Resolver: [PaymentAmountResolver.php](file:///c:/laragon/www/CMS/backend/services/PaymentAmountResolver.php)
* Payment Model: [Payment.php](file:///c:/laragon/www/CMS/backend/models/Payment.php)
* Routes: [api.php](file:///c:/laragon/www/CMS/backend/routes/api.php#L973-L1030)

### Relevant Endpoints
* `POST /api/payments/checkout-session` — Generates PayMongo hosted checkout session.
* `POST /api/payments/webhook` — PayMongo checkout payment webhook.
* `POST /api/payments/refund-webhook` — PayMongo refund status webhook.
* `POST /api/payments/{id}/sync-checkout` — Synchronous fallback query to PayMongo API for returning citizens.

### PayMongo Integration & Webhook Verification
* **Signature Verification:** Securely implemented in `PaymentController::verifyWebhookSignature()`. It parses `Paymongo-Signature: t=<timestamp>,te=<test_sig>,li=<live_sig>`, enforces a 300-second timestamp drift tolerance, computes `hash_hmac('sha256', "$timestamp.$rawBody", $secret)`, and compares hashes via constant-time `hash_equals()`. Untimed fallback is rejected in production/live environments.
* **Idempotency:** Webhook events are tracked in the `webhook_events` table with `FOR UPDATE` pessimistic row locking. Duplicate webhooks immediately return idempotent HTTP 200 without re-executing business logic.
* **Amount Integrity:** Authoritative amount is resolved server-side. The webhook verifies that PayMongo's paid centavos match `Refund::toCentavos($payment['amount'])`. Mismatches raise a critical `SystemException` and abort.

### Booking / Payment Relationship & Security Gaps
1. **Duplicate Payment Risk on Confirmed/Paid Bookings:**
   In `PaymentController::createCheckoutSession()` and `validatePaymentReference()`:
   * The code checks if the schedule is `Cancelled`.
   * **It does NOT check whether the schedule or cremation already has a `Verified` payment or is already in `Confirmed` or `Completed` state.**
   * If a booking is already verified and confirmed, calling `createCheckoutSession()` does not find a `Pending` payment in `findPendingByReference()`. Instead, it creates a **second** pending payment row and generates a new PayMongo checkout session. The citizen can be charged twice for the same reservation.
2. **Role Ownership Bypass on Lot Reference:**
   In `PaymentController::validatePaymentReference()` ([lines 200-210](file:///c:/laragon/www/CMS/backend/controllers/PaymentController.php#L200-L210)):
   ```php
   if ($referenceKind === 'lot') {
       $lot = $lotModel->findById($referenceId);
       if (!$lot) return ['error' => 'Lot reference not found', 'code' => 404];
       return [
           'reference_id' => $referenceId,
           'reference_kind' => 'lot',
           'reference_label' => 'Lot ' . ($lot['lot_number'] ?? $referenceId),
       ];
   }
   ```
   When `reference_kind` is explicitly passed as `'lot'`, the check `if ($roleName === 'user') return ['error' => 'User payments must reference a valid reservation', 'code' => 403];` (which sits on line 257) is skipped! A citizen can supply any `lot_id` with `reference_kind = 'lot'` and create a checkout session for a lot they do not own and have no reservation for.
3. **Unverified Account Access:**
   Unverified accounts with arbitrary emails/mobiles can access `POST /api/payments/checkout-session`.

### Recommended Fix
1. In `validatePaymentReference()`, explicitly enforce that citizens (`user` role) cannot pay via `reference_kind = 'lot'`:
   ```php
   if ($referenceKind === 'lot' && $roleName === 'user') {
       return ['error' => 'User payments must reference a valid reservation', 'code' => 403];
   }
   ```
2. Before creating a checkout session, verify that the schedule/cremation does not already have a `Verified` payment:
   ```php
   if ($this->paymentModel->hasVerifiedPayment($transactionType, $referenceId, $referenceKind)) {
       return ['error' => 'This booking has already been paid and verified', 'code' => 409];
   }
   ```
3. Check booking status: If `status === 'Confirmed'` or `status === 'Completed'`, reject checkout creation with HTTP 409.

---

## 5. Booking Finalization

### Current State Flow
The booking lifecycle is governed by `BookingDraft.php` and `BookingAgentService.php`:
```
DRAFT_STARTED 
   ↓
COLLECTING_INFO 
   ↓
LOT_SELECTION (Burial) / CREMATION_PREFS (Cremation)
   ↓
READY_FOR_REVIEW
   ↓
AWAITING_CONFIRM
   ↓
COMMITTED (Terminal State)
```

Finalization occurs via:
`POST /api/booking-agent/drafts/{id}/confirm` (with `{ finalize: true }`) or `POST /api/booking-agent/drafts/{id}/finalize`.

### Relevant Files
* Controller: [BookingAgentController.php](file:///c:/laragon/www/CMS/backend/controllers/BookingAgentController.php#L1355-L1434)
* Agent Service: [BookingAgentService.php](file:///c:/laragon/www/CMS/backend/services/BookingAgentService.php#L965-L1415)
* Domain Model: [BookingDraft.php](file:///c:/laragon/www/CMS/backend/models/BookingDraft.php)
* Frontend Script: [booking-assistant.js](file:///c:/laragon/www/CMS/assets/js/pages/booking-assistant.js#L1345-L1508)
* Frontend Markup: [booking-assistant.html](file:///c:/laragon/www/CMS/frontend/pages/booking-assistant.html#L550-L595)

### Backend Protection
* **Terminal State Integrity:** `BookingDraft::isTerminalState('COMMITTED')` returns `true`. `ALLOWED_TRANSITIONS['COMMITTED'] = []`.
* **Explicit Pre-Commit Guard:** Both `finalizeBurialDraft()` ([lines 976-981](file:///c:/laragon/www/CMS/backend/services/BookingAgentService.php#L976-L981)) and `finalizeCremationDraft()` ([lines 1265-1270](file:///c:/laragon/www/CMS/backend/services/BookingAgentService.php#L1265-L1270)) contain:
  ```php
  if ($draft['status'] === BookingDraft::STATUS_COMMITTED) {
      throw new BookingDraftException(
          "Draft #{$draftId} has already been committed.",
          'DRAFT_ALREADY_COMMITTED',
          409
      );
  }
  ```
* **Pessimistic Concurrency Locking:** Burial lot is locked via `Lot::findByIdForUpdate($lotId)`. Slot range is locked via `Schedule::lockScheduleRangeForLot($lotId)`. Active PayMongo leases are verified before commitment.
* **Direct API Finalization Protection:** Direct API calls to finalize an already committed booking are rejected with HTTP 409. Duplicate finalization cannot occur on the server.

### Frontend Protection & Security Gap
* **Button Visibility & Text Discrepancy:**
  In `assets/js/pages/booking-assistant.js` ([lines 818-826](file:///c:/laragon/www/CMS/assets/js/pages/booking-assistant.js#L818-L826)):
  ```javascript
  const isEligibleToConfirm = (state.status === 'READY_FOR_REVIEW' || state.isReadyForReview) && state.missingFields.length === 0;
  btnConfirmBooking.disabled = !isEligibleToConfirm || state.isLoading || state.status === 'AWAITING_CONFIRM';
  if (state.status === 'AWAITING_CONFIRM') {
      btnConfirmBooking.innerHTML = '<i class="fas fa-check-double"></i> Reservation Confirmed';
      btnConfirmBooking.style.background = '#047857';
  } else {
      btnConfirmBooking.innerHTML = '<i class="fas fa-check-circle"></i> Confirm Booking Reservation';
      btnConfirmBooking.style.background = '';
  }
  ```
  When `state.status === 'COMMITTED'`:
  1. The code falls into the `else` block and sets `btnConfirmBooking.innerHTML = 'Confirm Booking Reservation'` instead of hiding the button or stating "Booking Finalized".
  2. In `booking-assistant.html` ([line 578](file:///c:/laragon/www/CMS/frontend/pages/booking-assistant.html#L578)), the modal confirmation button `#btnSubmitBookingConfirm` has hardcoded HTML:
     `<i class="fas fa-check"></i> Yes, Finalize Booking`.
  3. If a citizen interacts with the interface after booking finalization, the UI displays prompt actions to confirm or finalize again. Clicking it triggers the modal, which sends a request and fails with a 409 error prompt.

### Recommended Fix
1. In `updateBlueprintHUD()`, if `state.status === 'COMMITTED'`, hide `#btnConfirmBooking` or replace it with a disabled button labeled `<i class="fas fa-check-double"></i> Booking Finalized (Committed)`.
2. Disable the confirmation modal trigger completely when `state.status === 'COMMITTED'`.
3. In `renderPromptChips()`, ensure chips for committed bookings only offer "View in My Bookings", "View Booking Voucher", or "Book Another Service".

---

## 6. AI Booking Assistant & Business Knowledge

### Current Architecture
* **Python Flask Service:** Runs under `python-ai/app.py` on port 5000 with endpoints `/api/chat`, `/api/booking-agent/extract`, `/api/recommend`, `/api/forecast`, `/api/explain-exception`, and `/api/explain-entity`.
* **LLM Provider:** Uses `llm_provider.py` interfacing with Google Gemini API (`gemini-3.6-flash`).
* **PHP Bridge:** `AIService.php` communicates with `python-ai` via HTTP cURL requests.

### Current Prompts & System Instructions
* Prompts are defined directly inside Python strings in [python-ai/app.py](file:///c:/laragon/www/CMS/python-ai/app.py):
  * `BOOKING_AGENT_SYSTEM_PROMPT` ([lines 879-953](file:///c:/laragon/www/CMS/python-ai/app.py#L879-L953)): 16 intent classes, slot extraction schema, and basic conversational rules.
  * `CHAT_SYSTEM_PROMPT` ([lines 262-303](file:///c:/laragon/www/CMS/python-ai/app.py#L262-L303)): Enforces grounding on `knowledge_entries`.

### Existing Business Knowledge
The assistant queries the MySQL table `ai_knowledge` ([_fetch_knowledge_base()](file:///c:/laragon/www/CMS/python-ai/app.py#L306-L317)).
Existing database entries include:
1. `visiting_hours`: 8:00 AM - 5:00 PM daily. Admin office: Monday - Saturday 8:00 AM - 4:00 PM.
2. `cemetery_location`: Himlayang Bayan Memorial Park.
3. `services_overview`: In-ground burial and cremation. Burials scheduled Tuesday - Sunday; Mondays closed for maintenance.
4. `booking_lead_time`: No Mondays, non-past dates.
5. `required_documents`: Death certificate, valid ID, proof of relationship.
6. `payment_process`: Pending -> Submit payment -> Staff verification -> Automatic schedule confirmation.
7. `after_booking`: Status tracking in My Bookings.
8. `payment_instructions`: Payment channels.

### Missing Rules & Knowledge Gaps
* **Payment Deadlines & Leases:** No documentation in AI knowledge regarding the 1-hour active checkout lease window or reservation cancellation after unpaid periods.
* **Columbarium & Niche Rules:** Rules regarding niche capacity (single vs multiple urns per niche), niche tier pricing differences, and ash custody release.
* **Exhumation & Relocation:** Requirements for exhumation permits, transfer clearances from the City Health Office, and minimum interment duration before exhumation.
* **Delayed / Provisional Registrations:** Policies when the Death Certificate is still being processed by the Local Civil Registrar.
* **Off-Topic / Out-of-Scope Filtering:** In `BOOKING_AGENT_SYSTEM_PROMPT`, while `UNCLEAR` intent exists, there is no strict instruction to decline off-topic queries (such as political discussions, general programming, cooking recipes, or non-cemetery inquiries). The AI can hallucinate answers to unrelated questions.

### Recommended Knowledge-File Structure
Create a dedicated business knowledge document (e.g. `docs/CMS_BUSINESS_KNOWLEDGE.md` or `python-ai/knowledge/cms_knowledge_base.json`) with the following sections:
```
1. General Information & Contacts
   - Office hours, visiting hours, gates, locations, emergency contact
2. Cemetery Operations & Schedules
   - Operating days (Tuesday-Sunday), Monday maintenance closure, time slots
3. Service Catalog & Offerings
   - Lawn Lots, Mausoleums, Columbarium niches, Cremation services
4. Documentary & Legal Requirements
   - Death Certificate, Burial Permit, Transfer Clearance, Valid Government IDs
5. Payment Policies & Channels
   - PayMongo online payment, Bank Transfer, Cash; 1-hour checkout lease, expiration policies
6. Post-Booking Lifecycle & Rules
   - Auto-confirmation, rescheduling policy, cancellation policy
7. Columbarium & Cremation Specifics
   - Urn specifications, niche capacities, release of cremains
8. Lease Terms, Renewals & Exhumations
   - 5-year lease duration, renewal window, unclaimed lot procedure
9. Off-Topic & Guardrail Directive
   - Strict refusal template for non-cemetery queries
```

---

## 7. Risk Classification

| Finding | Area | Severity | Justification |
| :--- | :--- | :--- | :--- |
| **Missing Email/Phone Verification** | Registration & Auth | **HIGH** | Unverified, fictitious accounts can register without identity verification and immediately perform sensitive operations (booking burial plots, reserving cremation slots, submitting decedent requests, and creating payment sessions). |
| **Incomplete Logout Session Invalidation** | Authentication / Session | **HIGH** | `api.logout()` never triggers server-side session invalidation. Active JWTs remain valid on the backend for their full duration (up to 30 days with remember-me). |
| **Browser Bfcache Post-Logout Data Leak** | Client / Web Server | **MEDIUM** | Lacks `Cache-Control: no-store` and `pageshow` handlers. Clicking Back after logout displays cached decedent records and citizen personal details. |
| **Duplicate Payment Vulnerability** | Payment Flow | **HIGH** | `createCheckoutSession` does not check if a booking is already `Confirmed` or already has a `Verified` payment, allowing citizens to be billed multiple times for the same service. |
| **Lot Payment Authorization Bypass** | Payment Flow | **HIGH** | Explicitly passing `reference_kind = 'lot'` bypasses citizen reservation ownership validation, allowing users to initiate checkouts on lots without a reservation. |
| **Confusing Finalize UI on Committed Bookings** | Booking Finalization | **MEDIUM** | Backend correctly rejects duplicate finalization with 409, but the frontend still exposes and renders "Confirm Booking" / "Yes, Finalize Booking" buttons after commitment, causing user confusion. |
| **Fragmented Business Rules & Lack of Off-Topic Guardrails** | AI Assistant | **MEDIUM** | Incomplete policy grounding in `ai_knowledge`; potential for AI hallucinations and failure to decline off-topic citizen queries. |

---

## 8. Recommended Fix Order (Implementation Roadmap)

Without modifying production code in this audit batch, here is the recommended sequential fix order:

### Phase 1: Authentication & Session Revocation (Immediate)
1. **Wire up `api.logout()` to `POST /api/auth/logout`:** Ensure every frontend logout calls the backend to increment `session_version` and invalidate the token server-side.
2. **Add Bfcache Navigation Protection:** Attach `pageshow` listener in `assets/js/shared/api.js` and inject `Cache-Control: no-store, no-cache, must-revalidate` in `backend/index.php`.

### Phase 2: Payment Gateway Guardrails & Anti-Duplicate Enforcement (High Priority)
3. **Block Duplicate Payments in `createCheckoutSession()`:** Add checks to ensure that any booking that is already confirmed or already has a `Verified` payment returns HTTP 409.
4. **Fix `validatePaymentReference()` Ownership Check:** Ensure `reference_kind = 'lot'` cannot be called by citizens without an authorized reservation.

### Phase 3: Booking Assistant UI State Alignment (Medium Priority)
5. **Align Finalize Buttons with Booking State:** In `booking-assistant.js`, check `state.status === 'COMMITTED'` and disable/hide the confirmation modal trigger and button.

### Phase 4: Registration Contact Verification (Medium/High Priority)
6. **Create Database Migration:** Add `email_verified`, `email_verified_at`, `contact_verified` to `users`.
7. **Implement Verification Flow:** Require email/mobile verification tokens before unlocking online checkout and slot commitments.

### Phase 5: AI Business Knowledge & Guardrails (Standard Priority)
8. **Establish Centralized Business Knowledge Base:** Author `docs/CMS_BUSINESS_KNOWLEDGE.md` and sync into `ai_knowledge`.
9. **Implement Off-Topic Guardrails in AI Prompts:** Update `BOOKING_AGENT_SYSTEM_PROMPT` to reject off-topic inquiries.

---

## 9. Audit Summary Tables

### Files Inspected
* `PROJECT_RULES.md`
* `PROJECT_MEMORY.md`
* `.htaccess`
* `backend/index.php`
* `backend/api/index.php`
* `backend/middleware/Auth.php`
* `backend/routes/api.php`
* `backend/controllers/AuthController.php`
* `backend/controllers/PaymentController.php`
* `backend/controllers/BookingAgentController.php`
* `backend/controllers/AiController.php`
* `backend/controllers/UserController.php`
* `backend/models/User.php`
* `backend/models/Payment.php`
* `backend/models/BookingDraft.php`
* `backend/models/Schedule.php`
* `backend/models/Lot.php`
* `backend/models/Cremation.php`
* `backend/models/Refund.php`
* `backend/services/PayMongoService.php`
* `backend/services/PaymentAmountResolver.php`
* `backend/services/BookingAgentService.php`
* `backend/services/BookingActionRegistry.php`
* `backend/services/AIService.php`
* `backend/services/AuditIntelligenceService.php`
* `backend/database/schema.sql`
* `backend/database/migration_20260730_add_user_contact_and_role.sql`
* `backend/database/migration_20260819_add_ai_knowledge.sql`
* `backend/database/migration_20260902_fix_stale_ai_knowledge_payment_flow.sql`
* `backend/database/migration_20260909_add_cemetery_faq_knowledge.sql`
* `assets/js/shared/api.js`
* `assets/js/auth/register.js`
* `assets/js/pages/booking-assistant.js`
* `frontend/auth/register.html`
* `frontend/pages/booking-assistant.html`
* `python-ai/app.py`
* `python-ai/llm_provider.py`

### Files That Would Need Modification (During Implementation)
1. `assets/js/shared/api.js` (fix `logout()`, add `pageshow` listener)
2. `backend/index.php` (add no-cache HTTP headers)
3. `backend/controllers/PaymentController.php` (block duplicate checkouts, fix lot ownership validation)
4. `assets/js/pages/booking-assistant.js` (hide finalize button for committed bookings)
5. `frontend/pages/booking-assistant.html` (refine finalize modal states)
6. `backend/controllers/AuthController.php` (integrate verification flow)
7. `backend/models/User.php` (support verification tokens & flags)
8. `python-ai/app.py` (add off-topic refusal guardrail and knowledge grounding)
9. `backend/database/migration_YYYYMMDD_add_user_verification.sql` (new migration for email/phone verification columns)
10. `docs/CMS_BUSINESS_KNOWLEDGE.md` (new centralized business knowledge document)

### APIs / Endpoints That Would Be Affected
* `POST /api/auth/register` (sets initial unverified state, dispatches verification token)
* `POST /api/auth/logout` (invoked properly by frontend to invalidate session)
* `POST /api/auth/verify-contact` (new verification confirmation endpoint)
* `POST /api/payments/checkout-session` (adds anti-duplicate and verified-user checks)
* `POST /api/booking-agent/drafts/{id}/confirm` (enforces contact verification check)
* `POST /api/chat` and `/api/booking-agent/extract` (grounded with new knowledge base)

### Database Changes Required
* New migration: `migration_YYYYMMDD_add_user_verification.sql`:
  ```sql
  ALTER TABLE `users`
    ADD COLUMN `email_verified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `email`,
    ADD COLUMN `email_verified_at` DATETIME DEFAULT NULL AFTER `email_verified`,
    ADD COLUMN `contact_verified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `contact_number`,
    ADD COLUMN `contact_verified_at` DATETIME DEFAULT NULL AFTER `contact_verified`,
    ADD COLUMN `email_verification_token` VARCHAR(255) DEFAULT NULL AFTER `reset_token_expires_at`,
    ADD COLUMN `email_verification_expires_at` DATETIME DEFAULT NULL AFTER `email_verification_token`;
  ```

### Possible Regression Risks & Mitigations
1. **Existing Unverified Accounts:** Adding strict verification checks could lock existing citizen test accounts out of checkout.  
   *Mitigation:* Seed or migrate existing accounts with `email_verified = 1`, or provide an explicit grace period.
2. **Session Invalidation During Active Multi-tab Use:** Bumping `session_version` invalidates all tabs on all devices for that user.  
   *Mitigation:* This is standard secure behavior, but ensure clear redirect messages so citizens understand they were signed out.
3. **Checkout Re-entry Blocking:** Rejecting duplicate checkouts must distinguish between an *abandoned/failed* checkout session (which should be allowed to retry) and a *verified/completed* payment.  
   *Mitigation:* Only block if `verification_status === 'Verified'` or booking status is `Confirmed`/`Completed`. Allow retries if the previous checkout session expired or was cancelled.
4. **AI Intent Classification Drift:** Updating `BOOKING_AGENT_SYSTEM_PROMPT` to filter off-topic questions must not inadvertently reject legitimate Taglish booking inquiries.  
   *Mitigation:* Run regression test suite (`tests/ai_architecture_regression_test.py`) after modifying prompts.

---
*End of Report. Audit completed with zero production code modifications.*
