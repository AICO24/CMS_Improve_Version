# PROJECT MEMORY: CEMETERY MANAGEMENT SYSTEM (CMS)

## Project Overview
The Cemetery Management System (CMS) is a full-stack, enterprise web application tailored for municipal and private cemetery operations. It manages physical ground burial lots, columbarium niches for cremation, interment/burial reservations, decedent records, payment verification, relocations, lease expirations, and executive reporting.
The system features dual-layered automation (deterministic workflows executed via `AutomationEngine` with reviewable exceptions via `SystemException`) alongside an AI layer (Python microservice providing ARIMA/cosine lot recommendations/forecasting, Gemini/Groq LLM Q&A grounded in admin-curated knowledge, certificate OCR extraction, and an Audit Intelligence layer).

---

## Technology Stack

### Backend
- **Language / Runtime:** PHP 8.x (Native / Vanilla PHP; no Laravel or third-party framework).
- **Architecture:** Front-controller pattern (`backend/index.php` -> `routes/api.php`) with MVC/Service separation (`controllers/`, `models/`, `services/`, `middleware/`).
- **Database Driver:** PHP PDO with MySQL/MariaDB (`PDO::ATTR_EMULATE_PREPARES => false`, `ERRMODE_EXCEPTION`).
- **Authentication:** Custom HS256 JWT implementation (`backend/config/jwt.php`) with database-backed session versioning (`session_version`) and role re-validation on every request.
- **Rate Limiting:** File-based fixed-window limiter (`backend/services/RateLimiter.php`) using atomic `flock()` under `backend/storage/rate_limits/`.

### AI Microservice (`python-ai/`)
- **Runtime:** Python 3.10+ (Flask microservice running on `127.0.0.1:5000`).
- **Data Science & ML:** `numpy`, `pandas`, `scikit-learn` (cosine similarity for lot recommendations), `statsmodels` (ARIMA forecasting for burial capacity).
- **LLM Providers:**
  - Primary: Google Gemini (`google-genai` SDK, e.g., `gemini-2.5-flash` / `gemini-1.5-flash`).
  - Backup: Groq API (`urllib` HTTPS standard library; e.g. `openai/gpt-oss-20b`), active for system assistant sequential fallback on infrastructure errors.
- **Database Access:** Direct read-only connection (`mysql-connector-python`) for compute-heavy dataset analytics (lot ranking and ARIMA); all other AI operations consume pre-assembled, name-stripped JSON fact bundles from PHP.

### Frontend
- **Runtime / Architecture:** Multi-page HTML5/CSS3 application with modern Vanilla JavaScript (ES6+ modular classes and closures).
- **Styling:** Custom CSS with CSS variables, responsive design, dark/light theme switching (`assets/js/shared/theme-toggle.js`), and FontAwesome 6 icon set.
- **Client Networking:** Centralized `ApiClient` (`assets/js/shared/api.js`) managing JWT injection, standard base path detection, unified 401 redirect handling, and error wrapping.
- **Interactive UI Components:**
  - Conversational Booking Blueprint HUD (`booking-wizard.js`, `cremation-chat-wizard.js`).
  - Modular AI Assistant Slide-in Drawer (`ai-assistant-widget.js`).
  - Dynamic pagination, modals, and toasts.

---

## Architecture

### High-Level Layout
```
+--------------------------------------------------------------------+
|                         Browser / Frontend                         |
|  - Auth (login, register, reset)                                   |
|  - Role Dashboards (Admin, Staff, User/Citizen)                    |
|  - Operations (Lots, Burial Scheduling, Cremation, Relocations)    |
|  - Wizards (Burial Chat Assistant, Cremation Chat Wizard)          |
|  - AI Assistant Drawer Widget (Entity, Module, System scope)       |
+---------------------------------+----------------------------------+
                                  | HTTP / JSON (Bearer JWT)
                                  v
+--------------------------------------------------------------------+
|                         PHP Backend API                            |
|  index.php -> EnvironmentService -> CORS -> Router (routes/api.php)|
|  ----------------------------------------------------------------  |
|  Middleware: AuthMiddleware (JWT verification, DB session_version) |
|  Controllers: Auth, Lot, Schedule, Cremation, Payment, Relocation, |
|               Decedent, Expiration, Report, User, SystemException, |
|               AiController                                         |
|  Models: PDO Prepared Statements, Active Record/Table Gateways     |
|  Services: AutomationEngine, AuditIntelligenceService, RateLimiter |
+------------------+------------------------------+------------------+
                   | PDO (Port 3306/3307)         | HTTP / JSON (Port 5000)
                   v                              v
+-------------------------------+  +---------------------------------+
|     MySQL / MariaDB Database  |  |    Python Flask AI Microservice |
|  cemetery_db                  |  |  - Cosine lot recommendation     |
|  - 21 relational tables       |  |  - ARIMA capacity forecasting   |
|  - Schema migrations tracking |  |  - LLM extraction & vision OCR  |
|  - Generated unique keys      |  |  - Gemini & Groq fallback chain |
+-------------------------------+  +---------------------------------+
```

### Directory Structure
- `assets/`: Global static assets (`css/`, `images/`, `js/`).
  - `assets/js/auth/`: Login, registration, password reset flows.
  - `assets/js/pages/`: Page-specific frontend controllers (29 scripts).
  - `assets/js/shared/`: Reusable runtime components (`api.js`, `sidebar-nav.js`, `booking-wizard.js`, `lot-chat-assistant.js`, `cremation-chat-wizard.js`, `ai-assistant-widget.js`, `confirm-modal.js`, `toast.js`).
- `backend/`: PHP API application.
  - `bootstrap.php`: Root directory path constants (`CMS_ROOT`, `BACKEND_ROOT`, `STORAGE_ROOT`, `UPLOADS_ROOT`, `LOGS_ROOT`).
  - `index.php`: Top-level request wrapper, CORS enforcement, and global exception boundary.
  - `config/`: `database.php` (PDO connection & transactions), `jwt.php` (HS256 encode/decode).
  - `controllers/`: 16 controllers implementing business routes.
  - `models/`: 20 database models handling queries and domain constraints.
  - `services/`: `AutomationEngine.php`, `AuditIntelligenceService.php`, `AIService.php`, `RateLimiter.php`, `EnvironmentService.php`.
  - `middleware/`: `Auth.php` (authentication and RBAC validation).
  - `routes/`: `api.php` (API routing, request body parsing, route-level rate limits).
  - `database/`: `schema.sql`, incremental migrations (`migration_*.sql`), and `schema_migrations` tracking.
  - `storage/`: Uploaded decedent documents/receipts, runtime logs, and rate limit counters.
- `frontend/`: Presentation HTML pages.
  - `auth/`: `login.html`, `register.html`, `forgot-password.html`, `verify-reset-code.html`, `reset-password.html`.
  - `pages/`: 28 distinct views for Admin, Staff, and Citizen roles.
- `python-ai/`: Python Flask service.
  - `app.py`: Flask endpoints, ARIMA modeling, lot similarity matching, and LLM prompt orchestrations.
  - `llm_provider.py`: Gemini client, Groq fallback, error classification, and JSON output parsing.
- `docs/`: Technical notes (`database.md`, `ARCHITECTURE.md`).
- `tests/`: Static test scripts (`smoke_test.py`, `ai_architecture_regression_test.py`, `ai_architecture_manual_test_plan.md`).

---

## Core Modules

1. **Authentication & Session Management:**
   - Multi-role login (`admin`, `staff`, `user`).
   - Token-based stateless authentication with stateful revocation: `session_version` counter in `users` table checked on every call.
   - Self-service password recovery via emailed 6-digit verification code with rate-limited attempts.
2. **Role-Based Access Control (RBAC):**
   - Three tiers: Administrator, Staff, and Citizen (`user`).
   - Dual-enforced: UI-level navigation rendering and hard backend HTTP-level route restrictions (`AuthMiddleware::requireRole()`).
3. **Lot & Niche Management:**
   - Hierarchical structure: Sections -> Blocks -> Lots.
   - Physical status lifecycle: `Available`, `Reserved`, `Occupied`, `Expired`.
   - Lazy lease expiration synchronization (`Lot::syncExpiredLots()`) executed safely on read queries.
4. **Burial Scheduling & Reservations:**
   - Calendar slots, double-booking prevention (`active_slot_key` generated column + unique constraint).
   - Supports formal bookings (`deceased_id`) and provisional citizen requests (`decedent_request_id`).
   - Auto-cancellation and warning cascades for stale unpaid reservations.
5. **Cremation & Columbarium Management:**
   - Columbarium niche tracking with virtual uniqueness constraints (`active_niche_key`).
   - Dedicated citizen intake wizard (`reserve-cremation.html`) and staff management queue (`manage-cremations.html`).
   - Automated status transition upon payment verification.
6. **Decedent Records & Document Management:**
   - Comprehensive records with soft-delete support (`deleted_at`).
   - Document upload attachments (death certificates, burial permits) stored in `storage/uploads/decedents/`.
   - Strict citizen privacy scoping: citizens only see decedents linked to their own bookings or requests.
7. **Payment & Receipt Verification:**
   - Multi-channel revenue processing: `Lot Purchase`, `Cremation`, `Relocation`, `Renewal`, `Other`.
   - Explicit `reference_kind` (`schedule` vs `lot`) to prevent ID collision.
   - Receipt upload and admin verification workflow with database transactions and email triggers.
8. **Relocation Management:**
   - Workflow to transfer interred remains from one lot to another.
   - Statuses: `Pending`, `Approved`, `Completed`, `Denied`.
   - Automates destination lot reservation upon approval, and releases source lot upon completion.
9. **Lease Expiration & Exhumation:**
   - Tracks 5-year burial leases and renewals (`renewed = 'yes'|'no'`).
   - Automated notification generation for upcoming expirations (30-day window) with duplicate suppression.
10. **System Exceptions & Audit Trails:**
    - `audit_logs`: Detailed immutable log of all mutating actions with IP address and JSON diff details.
    - `system_exceptions`: Reviewable queue of broken or halted automation attempts with admin resolution and automated retry paths.
11. **Reports & Analytics:**
    - Real-time occupancy metrics (by section, block, and lot type).
    - Daily historical snapshots stored automatically in `occupancy_snapshots` table on page reads.
    - Revenue trends and payment breakdown analysis.
12. **AI & Automation Integration:**
    - Recommendation engine for lot allocation.
    - ARIMA 6-month capacity forecast with automated warning notifications.
    - System-wide contextual conversational assistant grounded in Audit Intelligence.

---

## Database Overview

The system runs on MySQL / MariaDB (`cemetery_db`). Primary configuration is managed in `backend/.env`.

### Core Tables & Foreign Key Relationships
- `roles` (`role_id` [PK], `title` [UQ: 'Admin', 'Staff', 'User']).
- `users` (`user_id` [PK], `role_id` [FK -> roles], `session_version`, `is_active`, `username` [UQ], `email` [UQ]).
- `sections` (`section_id` [PK], `section_name` [UQ]).
- `blocks` (`block_id` [PK], `section_id` [FK -> sections ON DELETE CASCADE], `block_name`, UQ[`section_id`, `block_name`]).
- `lot_types` (`type_id` [PK], `type_name` [UQ]).
- `lots` (`lot_id` [PK], `block_id` [FK -> blocks ON DELETE CASCADE], `lot_type_id` [FK -> lot_types], UQ[`block_id`, `lot_number`], `status` ENUM).
- `decedent_records` (`decedent_id` [PK], `lot_id` [FK -> lots, nullable], `is_cremated` ENUM, `deleted_at`).
- `decedent_requests` (`request_id` [PK], `requested_by` [FK -> users], `decedent_id` [FK -> decedent_records SET NULL], `status` ENUM).
- `decedent_documents` (`document_id` [PK], `decedent_id` [FK -> decedent_records ON DELETE CASCADE], `uploaded_by` [FK -> users]).
- `burial_schedules` (`schedule_id` [PK], `lot_id` [FK -> lots], `deceased_id` [FK -> decedent_records], `decedent_request_id` [FK -> decedent_requests], `active_slot_key` [GENERATED UQ]).
- `cremation_records` (`cremation_id` [PK], `deceased_id` [FK -> decedent_records], `decedent_request_id` [FK -> decedent_requests], `active_niche_key` [GENERATED UQ]).
- `payments` (`payment_id` [PK], `received_by` [FK -> users SET NULL], `verified_by` [FK -> users SET NULL], `reference_kind` ENUM, `receipt_number` [UQ]).
- `relocation_requests` (`request_id` [PK], `from_lot_id` [FK -> lots], `to_lot_id` [FK -> lots], `deceased_id` [FK -> decedent_records], `requested_by` [FK -> users], `approved_by` [FK -> users]).
- `expiration_records` (`expiration_id` [PK], `lot_id` [FK -> lots ON DELETE CASCADE], `renewed` ENUM, `exhumation_status` ENUM).
- `notifications` (`notification_id` [PK], `user_id` [FK -> users ON DELETE CASCADE, nullable]).
- `audit_logs` (`log_id` [PK], `user_id`, `action`, `entity_type`, `entity_id`, `details`, `created_at`).
- `system_exceptions` (`exception_id` [PK], `event`, `entity_type`, `entity_id`, `severity` ENUM, `status` ENUM).
- `occupancy_snapshots` (`snapshot_id` [PK], `section_id` [FK -> sections ON DELETE CASCADE], UQ[`snapshot_date`, `section_id`]).
- `capacity_alerts` (`alert_id` [PK], `alert_key`, `alert_month`, `capacity_status`).
- `ai_knowledge` (`knowledge_id` [PK], `topic` [UQ], `content`).
- `ai_parameters` (`parameter_id` [PK], UQ[`module`, `param_name`]).
- `schema_migrations` (`migration` [PK], `applied_at`).

### Critical ENUMs & Generated Columns
- `lots.status`: `'Available'`, `'Reserved'`, `'Occupied'`, `'Expired'`.
- `burial_schedules.status`: `'Pending'`, `'Confirmed'`, `'Completed'`, `'Cancelled'`.
- `burial_schedules.active_slot_key`: `STORED GENERATED ALWAYS AS (case when status != 'Cancelled' then concat(lot_id, '|', schedule_date, '|', coalesce(schedule_time, '')) else NULL end)`.
- `cremation_records.status`: `'Pending'`, `'Scheduled'`, `'In Progress'`, `'Completed'`, `'Cancelled'`.
- `cremation_records.active_niche_key`: `STORED GENERATED ALWAYS AS (case when status != 'Cancelled' and niche_number is not null and niche_number != '' then concat(coalesce(columbarium, ''), '|', niche_number) else NULL end)`.
- `payments.verification_status`: `'Pending'`, `'Verified'`, `'Rejected'`.
- `payments.transaction_type`: `'Lot Purchase'`, `'Cremation'`, `'Relocation'`, `'Renewal'`, `'Other'`.
- `payments.reference_kind`: `'schedule'`, `'lot'` (explicit disambiguation).
- `relocation_requests.status`: `'Pending'`, `'Approved'`, `'Completed'`, `'Denied'`.

---

## Authentication & RBAC

### Role Matrix
| Role | Landing Dashboard | Permissions & Scope |
|---|---|---|
| **Admin** | `dashboard_admin.html` | Full access: All operations, records, finance, AI config, capacity forecast, exception resolution, user management, audit logs, and settings. |
| **Staff** | `dashboard_staff.html` | Operational access: Lot management, burial scheduling, reservation confirmations, decedent records, manage cremations, payment intake/verification, exceptions. Restricted from user management, AI configuration, and audit logs. |
| **User (Citizen)** | `dashboard_user.html` | Self-service only: Reserve burial slot, view personal reservations, reserve cremation, view personal cremations, view linked decedent records, submit payments, view payment history. Scope strictly limited to `user_id`. |

### Security Implementations
- **Session Revocation:** Every token carries `session_version`. `AuthMiddleware` verifies this on each request against the user's current database row. Logout or password reset increments `session_version`, instantly invalidating existing tokens across all devices.
- **Route Authorization:** Backend routes in `backend/routes/api.php` use `AuthMiddleware::requireRole(['admin', 'staff', ...])`. Never trust client-side role filtering alone.
- **Rate Limiting:** Auth endpoints (`login`, `register`, `forgot-password`, `verify-reset-code`, `reset-password`) are strictly rate-limited by client IP and account identifier using `RateLimiter::allow()`.

---

## Important Business Workflows

### 1. Lot Lifecycle
```
                 [Lot Created]
                       |
                       v
                 +-----------+
                 | Available | <-----------------------------------+
                 +-----------+                                     |
                   |       |                                       |
  Schedule Booked/ |       | Payment Verified (Lot Purchase)       |
  Relocation Appr. |       |                                       |
                   v       v                                       |
                 +-----------+     Schedule Cancelled /            |
                 | Reserved  | ---> Auto-cancelled Unpaid /        |
                 +-----------+     Relocation Source Released      |
                       |                                           |
                       | Schedule Completed (Burial occurs) /      |
                       | Relocation Completed                      |
                       v                                           |
                 +-----------+                                     |
                 | Occupied  |                                     |
                 +-----------+                                     |
                       |                                           |
                       | Lease Lapsed (end_date < CURDATE() &      |
                       | renewed = 'no' via syncExpiredLots())     |
                       v                                           |
                 +-----------+                                     |
                 |  Expired  | ------------------------------------+
                 +-----------+   Reset by Admin / Exhumed
```

- **Atomic Transition Guard:** All lot status modifications must route through `Lot::transitionStatus($lotId, $newStatus, $allowedFromStatuses)`. Legal transitions are strictly registered in `Lot::LOT_TRANSITION_RULES`.

### 2. Booking & Scheduling Flow
1. **Intake:**
   - Citizen or staff selects a lot (via map, list, or conversational booking assistant).
   - If citizen has no formal decedent record, they submit a provisional request (`decedent_requests`), creating a `burial_schedules` row with `decedent_request_id` and status `'Pending'`.
   - Database checks `active_slot_key` to guarantee slot exclusivity.
2. **Payment Submission:**
   - Citizen pays via online transfer/bank deposit and submits receipt details (`payments` record with `transaction_type = 'Lot Purchase'`, `reference_kind = 'schedule'`, `reference_id = schedule_id`, `verification_status = 'Pending'`).
3. **Automated Verification & Confirmation:**
   - Admin reviews and marks payment as `'Verified'` in `PaymentController::verify()`.
   - Inside a database transaction:
     - Payment status updates to `Verified`.
     - `AutomationEngine::run('payment.verified')` checks lot availability and moves lot to `'Reserved'`.
     - `AutomationEngine::run('payment.verified')` moves `burial_schedules` to `'Confirmed'`.
     - Audit logs and notifications are recorded.
   - Deferral pattern: Confirmation emails are dispatched via `Database::afterCommit()` only after transaction commits.
4. **Stale Schedule Sweeps:**
   - Schedules remaining `Pending` without payment receive automated warnings:
     - 48 hours: Stale notification sent.
     - 5 days: Final warning sent.
     - 7 days: Auto-cancelled, lot freed back to `Available`, audit logged.

### 3. Cremation Workflow
1. Citizen/Staff submits cremation booking (`cremation_records` with status `'Pending'`).
2. Payment submitted under `transaction_type = 'Cremation'`.
3. Admin verifies payment -> `AutomationEngine` transitions cremation record from `'Pending'` to `'Scheduled'`.
4. Service performed -> Status moved to `'In Progress'` -> `'Completed'`.
5. Upon completion, columbarium niche is assigned, generating and locking `active_niche_key`.

### 4. Relocation Flow
1. Staff/Citizen submits request (`relocation_requests` with `from_lot_id`, `to_lot_id`, `deceased_id`, `reason`).
2. On request creation, destination lot is checked for `Available`.
3. Admin approves -> `AutomationEngine` reserves destination lot (`to_lot_id -> 'Reserved'`), sets request status to `'Approved'`.
4. Physical transfer completed -> `AutomationEngine` releases source lot (`from_lot_id -> 'Available'`), occupies destination lot (`to_lot_id -> 'Occupied'`), updates `decedent_records.lot_id`, sets request status to `'Completed'`.

---

## Automation Architecture

- **Deterministic Automation Engine (`backend/services/AutomationEngine.php`):**
  - Standard execution wrapper: `AutomationEngine::run($event, $entityType, $entityId, $actor, $validateCallable, $applyCallable)`.
  - Never guesses or uses fuzzy logic. If `$validate()` fails, it creates a `system_exceptions` record, writes an audit log, and notifies administrators.
  - Zero cron dependency: System maintenance runs on lazy-read sweeps (e.g., `Lot::syncExpiredLots()`, `OccupancySnapshot::captureFromSections()`) guarded by internal reentrancy flags.
- **Exception Resolution & Auto-Retry:**
  - Open exceptions display on `exceptions.html`.
  - Deterministic retry handler (`SystemExceptionController::retry()`) can safely replay failed automations (such as linking newly approved decedent requests to schedules/cremations) once prerequisites are satisfied.
- **Audit Logging:**
  - Centralized in `audit_logs` table.
  - Automation actions are explicitly tagged with `['actor' => 'automation-engine']`.
  - Internal calls pass `_auditedByAutomationEngine: true` to suppress duplicate log entries while preserving complete traceability.

---

## AI Architecture

- **Microservice Design (`python-ai/`):**
  - Decoupled Flask microservice on port 5000.
  - Dual access patterns:
    1. *Data Science Direct Queries (`recommend`, `forecast`):* Runs fixed SQL queries directly against MySQL to run matrix operations, cosine similarity rankings, and statsmodels ARIMA projections.
    2. *LLM Fact Narration (`narrate`, `extract`, `chat`, `explain-exception`, `explain-entity`, `dashboard-digest`, `assistant-ask`):* Never queries MySQL. Consumes clean, pre-filtered, name-stripped JSON fact bundles prepared by `AuditIntelligenceService.php`.
- **System-Wide AI Assistant (Multi-Scope):**
  - Three distinct scopes: `entity` (one specific record timeline), `module` (current module's status & open exceptions), and `system` (cemetery-wide statistics and activity).
  - Tiered focus-then-escalate fetch: If an entity or module question cannot be answered from local context, it triggers a single, bounded fallback query with cemetery-wide reach.
  - Citizen isolation: When accessed by a `user` role, scope is locked to `module`, strictly filtering data to the citizen's own user ID.
- **Booking Conversational NLU:**
  - Pure deterministic state machine runs first (`lot-chat-assistant.js`).
  - LLM extraction (`POST ai/extract`) only fires as a fallback when deterministic regex fails to match user parameters.
  - General policy questions route to `ai/chat`, grounded strictly in the admin-curated `ai_knowledge` table.
- **Document Vision Extraction:**
  - `POST ai/extract-certificate` accepts base64 image data of death certificates/permits and runs Gemini Vision OCR to pre-populate form fields. Never writes directly to the database.

---

## Frontend Architecture

- **Layout Structure:**
  - Sidebar navigation divided into logical groups: `Operations`, `Records`, `Finance`, `AI & Automation`, `Reports`, `System`.
  - Accordion sidebar with single-open behavior (`assets/js/shared/sidebar-nav.js`) and persistent desktop icon rail mode (`#railToggleBtn`).
- **State & Communication:**
  - Stateless frontend components communicating with backend via `ApiClient` (`assets/js/shared/api.js`).
  - Standardized error handling: automatic redirection on 401, inline warning banners on 429 rate limits, and custom confirmation modals (`confirm-modal.js`).
- **Dynamic Mounting:**
  - Reusable AI Assistant Widget (`ai-assistant-widget.js`) mounted in bottom-right corner across pages with context-aware quick suggestions.

---

## Known Technical Risks & Quirks

1. **Dual MySQL Ports in Environment Defaults:**
   - `backend/.env.example` defaults `DB_PORT=3307` (Laragon MariaDB default), whereas `python-ai/.env.example` defaults `DB_PORT=3306` (standard MySQL). Environments must ensure both configs point to the same active port.
2. **No Persistent Background Cron Worker:**
   - Background tasks (expiration synchronization, snapshot generation) rely on lazy execution triggered by user HTTP traffic. If the system experiences prolonged inactivity, expired lot statuses and occupancy snapshots will not advance until the next request.
3. **Database Migration Sync:**
   - Schema migrations under `backend/database/` are applied manually. `schema.sql` is a snapshot; any new columns or table modifications must be accompanied by explicit idempotent migration scripts and recorded in `schema_migrations`.
4. **Smoke Test Fixture Discrepancy:**
   - `tests/smoke_test.py` checks for `assets/js/pages/login.js`, but login logic was refactored to `assets/js/auth/login.js`. Use `tests/ai_architecture_regression_test.py` for automated AI batch regression tests.
5. **Direct Python DB Coupling:**
   - `python-ai/app.py` directly defines its own `DB_CONFIG` and connects to MySQL for recommendation and forecast routines. Any change to database credentials or table column names requires synchronized updates in both `backend/.env` and `python-ai/.env`.

---

## Important Development Rules

- **Do Not Redesign:** Respect the existing vanilla PHP / Vanilla JS architecture. Do not introduce large frameworks (Laravel, React, Vue) into this codebase.
- **Deterministic Priority:** Always use deterministic logic and database constraints for business rules, status transitions, and booking slots. Restrict AI strictly to extraction, prediction, and narration.
- **Safe State Transitions:** Never execute ad-hoc SQL `UPDATE lots SET status = ...`. Always use `Lot::transitionStatus()` via `AutomationEngine::run()`.
- **Database Schema Protection:** Never modify database structures without creating a corresponding timestamped migration script (`migration_YYYYMMDD_<name>.sql`) recorded in `schema_migrations`.

