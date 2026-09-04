-- Migration: adds the stale-Pending reminder/final-warning/auto-cancel
-- pipeline to cremation_records (Cremation module audit, Batch C).
--
-- Mirrors burial's identical three-migration history
-- (migration_20260902_add_schedule_stale_notified.sql,
-- migration_20260902_add_schedule_final_warning.sql, and the composite
-- indexes from migration_20260902_add_payment_integrity_and_schedule_
-- indexes.sql) in one consolidated migration, since cremation is adopting
-- the already-proven policy fresh rather than growing it incrementally.
--
-- Policy (matches burial's confirmed 2026-09-02 policy exactly — no reason
-- for cremation to run a different schedule): a Pending cremation request
-- with zero payment attempts gets a reminder at day 7 (stale_notified_at),
-- a final warning 4 days after that reminder actually fired
-- (final_warning_notified_at), and is automatically cancelled 3 days after
-- the final warning actually fired — never by day-count alone, always
-- gated on the PREVIOUS stage's own timestamp, so a sweep that runs late
-- (this app has no scheduler; every sweep is triggered lazily, see
-- backend/scripts/run-automation-sweeps.php) still enforces the real gap
-- between stages instead of firing all three back-to-back in one pass.
--
-- Verified before writing this migration (read-only checks against the
-- live database, not assumed):
--   * cremation_records currently has zero Pending rows old enough to
--     immediately trigger any of the three stages — this migration adds
--     no columns that back-fill non-NULL, so no existing row is affected
--     until the sweep actually runs.
--
-- Run this once against the application database.

ALTER TABLE `cremation_records`
  ADD COLUMN `stale_notified_at` datetime DEFAULT NULL AFTER `status`,
  ADD COLUMN `final_warning_notified_at` datetime DEFAULT NULL AFTER `stale_notified_at`;

ALTER TABLE `cremation_records`
  ADD INDEX `idx_cremation_stale_sweep` (`status`, `stale_notified_at`),
  ADD INDEX `idx_cremation_final_warning_sweep` (`status`, `final_warning_notified_at`, `stale_notified_at`);

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260904_add_cremation_stale_pending_sweep.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
