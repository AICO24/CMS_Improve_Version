# Database

## Source of truth
`backend/database/schema.sql` is the authoritative structure baseline. It's a real `mysqldump --no-data` snapshot of the live database, not hand-maintained — if it and the running database ever disagree, re-generate it rather than editing it by hand:

```
mysqldump -h <DB_HOST> -P <DB_PORT> -u <DB_USER> --no-data --routines --triggers --skip-comments <DB_NAME> > backend/database/schema.sql
```

(then strip the per-table `AUTO_INCREMENT=N` starting values, since this file is meant to bootstrap a fresh install, not clone another environment's current counters)

Note (Cremation module audit, Batch G, 2026-09-04): `cremation_records`' definition and the `notifications.notification_type` enum had drifted out of sync with several already-applied migrations (missing `decedent_request_id`, `deceased_id` still `NOT NULL`, missing the `'Cremation'` enum value) — fixed with a targeted hand-edit rather than a full re-dump, verified by loading the corrected file into a scratch database and diffing its resulting structure against the live one. Only these two tables were checked; the rest of the file's freshness relative to `schema_migrations` is unverified by this pass — a full `mysqldump` regeneration (per the process above) is still the right move whenever someone next has reason to check the whole file, not just these two tables.
Note (Baseline consolidation, Phase 2, 2026-09-05): `backend/database/schema.sql` was re-dumped live from MySQL 8.4 via `mysqldump --no-data --routines --triggers --skip-comments` with `AUTO_INCREMENT` clauses stripped, fully incorporating all 29 applied migrations (`decedent_records.lot_id` nullable, `active_slot_key`, `active_niche_key`, `session_version`, `decedent_documents`, and notifications enum).

## Migrations
Schema changes after the baseline live in `backend/database/migration_YYYYMMDD_<short_description>.sql`, applied by hand in filename order against the target database — there is no automatic runner. Every migration should:
- Be idempotent-safe to run once per environment (the tracking table below prevents double-application, but the SQL itself should still not error if a column already exists, etc., where practical).
- End by recording itself in `schema_migrations` (created by `migration_20260807_add_schema_migrations_tracking.sql`):
  ```sql
  INSERT INTO schema_migrations (migration) VALUES ('migration_YYYYMMDD_your_file.sql')
  ON DUPLICATE KEY UPDATE migration = migration;
  ```
- Check `SELECT * FROM schema_migrations` first to confirm it hasn't already been applied to that database.

Once a migration has been running in a real environment for a while, fold it into `schema.sql` (re-dump) and note it as folded-in there, the way `migration_20260729_add_payment_receipt_verification.sql` and `migration_20260730_add_user_contact_and_role.sql` were folded in on 2026-08-07 — that keeps the migrations folder from growing without bound while still leaving a record of what changed and when.

## Live tables (as of 2026-08-08)
## Live tables (as of 2026-09-05)

| Table | Purpose |
|---|---|
| `roles`, `users` | Auth & RBAC |
| `roles`, `users` | Auth & RBAC (incl. `session_version` token invalidation) |
| `sections`, `blocks`, `lots`, `lot_types` | Cemetery layout & lot inventory |
| `decedent_records` | Burial/cremation subjects |
| `burial_schedules` | Burial reservations/scheduling |
| `cremation_records` | Cremation requests/bookings and columbarium niche assignments — provisional (pre-decedent-record) bookings via `decedent_requests`, mirrors `burial_schedules`'s identical pattern; payments reference it by `transaction_type = 'Cremation'` + `reference_id` (see `payments` below) |
| `decedent_records` | Burial/cremation subjects (`lot_id` nullable for cremation-only records) |
| `decedent_documents` | Death certificates, burial permits, and attachments linked to decedent records |
| `decedent_requests` | Citizen provisional deceased info requests prior to formal decedent record |
| `burial_schedules` | Burial reservations/scheduling (incl. `active_slot_key` double-booking constraint) |
| `cremation_records` | Cremation requests/bookings and columbarium niche assignments (`active_niche_key` constraint) |
| `expiration_records` | Lease expiration & exhumation tracking |
| `relocation_requests` | Lot-to-lot relocation workflow |
| `payments` | Revenue, incl. receipt verification workflow |
| `notifications` | In-app notifications |
| `audit_logs` | Mutating-action audit trail (part of `schema.sql` since 2026-08-07; the `AuditLog` model no longer creates it at runtime — see Batch L2.8, that DDL was causing implicit-commit of open transactions) |
| `ai_parameters` | Key/value config surfaced in the admin AI Configuration page; not currently read by the forecasting code itself |
| `schema_migrations` | Which `migration_*.sql` files have been applied to this database |
| `occupancy_snapshots` | Per-section, per-day occupancy history for trend charting. Populated automatically by `ReportController::occupancy()` on every request (upsert — no duplicate rows per day), not by a cron job. |

## Views

| View | Purpose |
|---|---|
| `v_available_lots` | Shared single source of truth for available lots across PHP backend (`Lot::findAvailableLots()`) and Python AI microservice (`_fetch_available_lots()` for cosine similarity recommendation). Joins `lots`, `blocks`, `sections`, and `lot_types` filtering by `status = 'Available'`. |

For exact columns, types, and constraints, read `backend/database/schema.sql` directly rather than duplicating it here — a second hand-maintained copy is exactly how the previous schema.sql went stale.

## Connecting
Credentials come from `backend/.env` (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`), loaded by `EnvironmentService` and consumed by `backend/config/database.php` (PDO/MySQL) — and separately by `python-ai/.env` for the Python forecasting service, which connects directly to the same database rather than going through the PHP API.

