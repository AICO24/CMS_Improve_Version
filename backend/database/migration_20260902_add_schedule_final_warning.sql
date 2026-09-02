-- Migration: adds the second dedupe flag needed for the stale-Pending
-- auto-cancel policy (extends migration_20260902_add_schedule_stale_notified.sql).
--
-- Policy (confirmed 2026-09-02): a Pending reservation with zero payment
-- attempts gets a reminder at day 7 (stale_notified_at, already shipped), a
-- final warning at day 11, and is automatically cancelled at day 14 — but
-- ONLY if a final warning was actually sent first. That guarantee is
-- enforced by ScheduleController::autoCancelStalePending()'s query
-- requiring final_warning_notified_at IS NOT NULL, not by day-count alone —
-- since this app has no scheduler and every sweep is triggered lazily by a
-- Notifications-page visit, if staff don't open that page for a while, the
-- day-11 warning simply hasn't fired yet, so the day-14 cancellation query
-- correctly finds nothing to act on yet either. A citizen already 14+ days
-- Pending is never auto-cancelled without having been warned at day 11 first,
-- even if that means the real-world cancellation lands later than 14 days.
-- Run this once against the application database.

ALTER TABLE `burial_schedules`
  ADD COLUMN `final_warning_notified_at` datetime DEFAULT NULL AFTER `stale_notified_at`;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260902_add_schedule_final_warning.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
