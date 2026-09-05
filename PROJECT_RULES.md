# PERMANENT DEVELOPMENT RULES: CEMETERY MANAGEMENT SYSTEM (CMS)

Any AI development assistant working on this project MUST strictly follow these permanent rules.

---

### 1. System Design & Architectural Discipline
1. **Never Redesign or Replace the Architecture:**
   - This project is a native PHP 8.x backend with Vanilla JS frontend and a Python Flask AI microservice.
   - Do NOT attempt to rewrite the backend in Laravel, Symfony, or Node.js.
   - Do NOT rewrite or wrap the frontend in React, Vue, Angular, or other SPA frameworks.
2. **Preserve Existing Functionality:**
   - Never delete, refactor, or rename existing features, routes, or models without explicit user instructions.
   - Backward compatibility with existing database rows and client scripts must be maintained.
3. **Fix Root Causes, Never Apply Patches:**
   - Investigate the full trace before changing code. Do not suppress errors with `@` or add hacks that mask underlying issues.

---

### 2. Database & Data Integrity
1. **Never Modify Database Structures Without a Migration:**
   - Every schema change must be introduced via a timestamped idempotent SQL script under `backend/database/migration_YYYYMMDD_<description>.sql`.
   - The migration script must record itself in `schema_migrations` upon completion.
   - Never alter tables directly in scratch SQL without saving the formal migration script.
2. **Always Use Prepared Statements:**
   - Direct string interpolation in SQL is strictly prohibited. All queries must use PDO prepared statements with bound parameters (`?` or named placeholders).
3. **Atomic State Transitions & Safe Updates:**
   - Never run raw `UPDATE lots SET status = ...` from arbitrary controllers.
   - Always route lot status updates through `Lot::transitionStatus()` using valid `Lot::allowedFromStatusesFor()` event definitions.
   - Ensure multi-step state mutations (such as verifying a payment, reserving a lot, confirming a schedule, and recording audit logs) run inside a `Database::getInstance()->transaction(callable)` block.
4. **Non-DB Side Effects Must Defer to Commit:**
   - Never send emails, dispatch SMS, or trigger irreversible third-party webhooks inside an uncommitted database transaction.
   - Defer side effects using `Database::getInstance()->afterCommit(callable)`.

---

### 3. Authentication & RBAC Security
1. **Backend Authorization is Mandatory:**
   - Never rely on frontend CSS classes (`.admin-only`) or JavaScript checks alone.
   - Every secure endpoint in `backend/routes/api.php` must call `AuthMiddleware::requireRole(['role1', ...])`.
2. **Respect Data Ownership Scoping:**
   - Citizen accounts (`user` role) must NEVER access cemetery-wide records.
   - All queries serving citizens for schedules, cremations, decedents, or payments must be scoped to their authenticated `user_id`.
3. **Preserve Session Invalidation:**
   - Any modification to user credentials, password reset, or logout must bump `session_version` in the database to invalidate stale JWT tokens.
4. **Enforce Rate Limiting on Sensitive Endpoints:**
   - Auth endpoints and AI LLM endpoints must remain protected with `RateLimiter::allow()` keys scoped by IP and user identifier.

---

### 4. Automation & Exception Handling
1. **No Non-Deterministic Automation:**
   - Automated workflows (auto-confirmations, status updates, lease expirations) must execute through `AutomationEngine::run()`.
   - The LLM must NEVER decide or trigger a state change. State changes are 100% deterministic code.
2. **Handle Failures via System Exceptions:**
   - When automated validation fails, create a `system_exceptions` entry and notify administrators. Never fail silently or force invalid states.
3. **Prevent Duplicate Execution & Audit Flooding:**
   - Automation steps must re-verify state freshness immediately prior to applying mutations.
   - Pass internal flags (`_auditedByAutomationEngine: true`) on internal controller calls to prevent redundant audit log records while ensuring full event traceability.

---

### 5. AI Integration & Cost Governance
1. **Strict Duty Separation:**
   - **Deterministic first:** Slot filling, date validation, and business logic must always run via regex and local validation first.
   - **AI strictly for unstructured tasks:** LLM calls are reserved for natural language Q&A (`ai/chat`), free-form preference extraction fallback (`ai/extract`), document OCR (`ai/extract-certificate`), and plain-language summary narrations.
2. **Context Minimization & Privacy:**
   - Never send unhashed citizen PII, passwords, or unrelated records to the AI service.
   - Only supply structured, pre-assembled, name-stripped JSON fact bundles via `AuditIntelligenceService.php`.
   - Respect assistant scopes (`entity`, `module`, `system`). Do not attach cemetery-wide data unless explicitly needed or during an escalated retry.

---

### 6. Code Style & Execution Rules
1. **Inspect Before Changing:**
   - Always read relevant controllers, models, and frontend scripts before making modifications.
   - Never guess variable names, routes, or column types.
2. **Work Incrementally in Batches:**
   - Group related modifications into logical, focused batches.
   - Run tests (`tests/ai_architecture_regression_test.py`) after making changes to verify no regression.
3. **Preserve Code Comments & Documentation:**
   - Retain existing design decision docstrings and architecture notes across files unless explicitly instructed to revise them.

