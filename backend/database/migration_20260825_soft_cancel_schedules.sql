-- Migration: support soft-cancelling burial_schedules (Admin-Wide Automation
-- Audit, Batch E). ScheduleController::destroy() now persists
-- status='Cancelled' instead of hard-deleting the row (so cancellation
-- history survives for reporting/audit — previously Schedule::getStats()'s
-- cancellation_rate was structurally unable to reflect reality, since
-- cancelled bookings never left a row behind to count).
--
-- uq_schedule_slot (lot_id, schedule_date, schedule_time) must be dropped:
-- a cancelled row now keeps its original lot_id/schedule_date/schedule_time,
-- so re-booking that exact same slot later (already correctly permitted at
-- the application level — Schedule::checkConflict() already excludes
-- status != 'Cancelled') would otherwise fail on this DB-level constraint
-- when a fresh row tries to reuse the same slot. Application-level
-- checkConflict() becomes the sole enforcement of "no double-booking an
-- active slot" going forward.
-- Run this once against the application database.

-- uq_schedule_slot is also the only index covering lot_id, which
-- burial_schedules_ibfk_1's FK constraint needs — add a plain index first
-- so InnoDB has something to back that FK with once the unique index is gone.
ALTER TABLE `burial_schedules` ADD INDEX `idx_lot_id` (`lot_id`);
ALTER TABLE `burial_schedules` DROP INDEX `uq_schedule_slot`;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260825_soft_cancel_schedules.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
