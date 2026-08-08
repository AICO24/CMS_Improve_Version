# Database

## Source of truth
`backend/database/schema.sql` is the authoritative structure baseline. It's a real `mysqldump --no-data` snapshot of the live database, not hand-maintained — if it and the running database ever disagree, re-generate it rather than editing it by hand:

```
mysqldump -h <DB_HOST> -P <DB_PORT> -u <DB_USER> --no-data --routines --triggers --skip-comments <DB_NAME> > backend/database/schema.sql
```

(then strip the per-table `AUTO_INCREMENT=N` starting values, since this file is meant to bootstrap a fresh install, not clone another environment's current counters)

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

| Table | Purpose |
|---|---|
| `roles`, `users` | Auth & RBAC |
| `sections`, `blocks`, `lots`, `lot_types` | Cemetery layout & lot inventory |
| `decedent_records` | Burial/cremation subjects |
| `burial_schedules` | Burial reservations/scheduling |
| `cremation_records` | Columbarium niche assignments |
| `expiration_records` | Lease expiration & exhumation tracking |
| `relocation_requests` | Lot-to-lot relocation workflow |
| `payments` | Revenue, incl. receipt verification workflow |
| `notifications` | In-app notifications |
| `audit_logs` | Mutating-action audit trail (self-created at runtime by the `AuditLog` model if missing) |
| `ai_parameters` | Key/value config surfaced in the admin AI Configuration page; not currently read by the forecasting code itself |
| `schema_migrations` | Which `migration_*.sql` files have been applied to this database |
| `occupancy_snapshots` | Per-section, per-day occupancy history for trend charting. Populated automatically by `ReportController::occupancy()` on every request (upsert — no duplicate rows per day), not by a cron job. |

For exact columns, types, and constraints, read `backend/database/schema.sql` directly rather than duplicating it here — a second hand-maintained copy is exactly how the previous schema.sql went stale.

## Connecting
Credentials come from `backend/.env` (`DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASS`), loaded by `EnvironmentService` and consumed by `backend/config/database.php` (PDO/MySQL) — and separately by `python-ai/.env` for the Python forecasting service, which connects directly to the same database rather than going through the PHP API.
