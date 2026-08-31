-- Migration: restore a database-level backstop against double-booking the
-- same lot/date/time (Batch L2.3), without reintroducing the problem the
-- soft-cancel migration (migration_20260825_soft_cancel_schedules.sql) had
-- to solve. That migration dropped uq_schedule_slot (lot_id, schedule_date,
-- schedule_time) because a soft-cancelled row keeps its original slot
-- values, so a fresh booking re-using that exact slot would otherwise
-- collide with the DB-level constraint even though the old row is no
-- longer active. Since then, Schedule::checkConflict() (application-level
-- SELECT ... WHERE status != 'Cancelled') has been the *only* protection —
-- and it is not race-safe: two simultaneous requests can both pass it
-- before either INSERTs.
--
-- Verified before writing this migration (read-only checks against the
-- live database, not assumed):
--   * MySQL 8.4.3 / InnoDB — generated columns and indexes on them are
--     fully supported.
--   * SELECT lot_id, schedule_date, schedule_time, COUNT(*) FROM
--     burial_schedules WHERE status <> 'Cancelled' GROUP BY ... HAVING
--     COUNT(*) > 1 returned zero rows — no existing data would violate the
--     new constraint below.
--   * uq_schedule_slot is confirmed absent (dropped by the 20260825
--     migration) and idx_lot_id (plain, non-unique) is confirmed present.
--
-- Approach: a STORED generated column, active_slot_key, that evaluates to
-- "lot_id|schedule_date|schedule_time" for any row whose status is not
-- Cancelled, and to NULL for a Cancelled row. A UNIQUE KEY on that column
-- then enforces "at most one active schedule per lot/date/time" at the
-- database level. InnoDB unique indexes treat every NULL as distinct from
-- every other NULL, so any number of Cancelled rows (all NULL) can coexist
-- for the same lot/date/time without colliding — a fresh booking reusing a
-- cancelled slot produces a new, non-NULL active_slot_key that has never
-- existed before (no other active row shares it), so it succeeds exactly
-- as checkConflict() already allows today. Only two truly simultaneous
-- non-Cancelled rows for the same lot/date/time can ever collide, which is
-- precisely the race this migration closes.
--
-- Run this once against the application database.

ALTER TABLE `burial_schedules`
  ADD COLUMN `active_slot_key` VARCHAR(64)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` <> 'Cancelled'
          THEN CONCAT(`lot_id`, '|', `schedule_date`, '|', COALESCE(`schedule_time`, ''))
        ELSE NULL
      END
    ) STORED;

ALTER TABLE `burial_schedules`
  ADD UNIQUE KEY `uq_active_schedule_slot` (`active_slot_key`);

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260831_add_active_schedule_slot_constraint.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
