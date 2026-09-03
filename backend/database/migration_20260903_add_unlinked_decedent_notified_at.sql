-- Migration: Decedent Records module audit, Batch H — proactive
-- "unlinked schedule" watchdog (the reverse of Batch F's suggested-link
-- automation, which nudges staff at the moment a decedent is created;
-- this catches the case where staff never came back to link one at all).
--
-- unlinked_decedent_notified_at mirrors burial_schedules' existing
-- stale_notified_at / final_warning_notified_at idempotency columns
-- (migration_20260824_add_automation_and_provisional_booking.sql and
-- migration_20260902_add_schedule_stale_notified.sql): set once
-- ScheduleController::flagUnlinkedDecedentSchedules() raises a
-- system_exceptions entry for a Confirmed schedule that still has no
-- deceased_id (and no decedent_request_id of its own — that case already
-- resolves automatically via DecedentRequestController::autoLinkSchedules())
-- 7+ days past its schedule_date, so the same schedule is never flagged
-- twice.
-- Run this once against the application database.

ALTER TABLE `burial_schedules`
  ADD COLUMN `unlinked_decedent_notified_at` datetime DEFAULT NULL AFTER `final_warning_notified_at`;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260903_add_unlinked_decedent_notified_at.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
