-- Migration: track when a Pending burial_schedules row last triggered a
-- "still waiting on payment" reminder (automation opportunity G.1).
--
-- Mirrors expiration_records.notified_at
-- (migration_20260824_add_expiration_notified_at.sql) exactly, for the same
-- reason: without a dedupe flag, a repeat sweep would re-notify the same
-- still-unpaid citizen every time it runs. NULL means "never reminded yet";
-- once set, that reservation won't be reminded again even if it stays
-- Pending indefinitely (this migration adds the reminder step only — no
-- auto-cancel policy exists yet, by explicit decision).
-- Run this once against the application database.

ALTER TABLE `burial_schedules`
  ADD COLUMN `stale_notified_at` datetime DEFAULT NULL AFTER `status`;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260902_add_schedule_stale_notified.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
