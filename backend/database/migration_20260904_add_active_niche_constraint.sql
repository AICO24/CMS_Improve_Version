-- Migration: database-level backstop against double-assigning the same
-- niche (Cremation module audit, Batch A). Mirrors
-- migration_20260831_add_active_schedule_slot_constraint.sql's exact
-- technique for burial_schedules — same problem shape: application-level
-- checks (Cremation::isNicheAvailable()) are the only protection today, and
-- while the AutomationEngine-wrapped auto-assign paths (assignNiche(),
-- completeWithAutoNiche()) already re-check immediately before writing to
-- narrow the window, CremationController::update()'s direct
-- niche_number-change path does not — it checks, then writes ~30 lines
-- later with no re-check. Two concurrent admin edits assigning the same
-- niche can both pass the early check and both write.
--
-- Verified before writing this migration (read-only checks against the live
-- database, not assumed):
--   * MySQL 8.4.3 / InnoDB — same engine already confirmed for the schedule
--     equivalent; generated columns and indexes on them are fully supported.
--   * SELECT columbarium, niche_number, COUNT(*) FROM cremation_records
--     WHERE status <> 'Cancelled' AND niche_number IS NOT NULL GROUP BY
--     columbarium, niche_number HAVING COUNT(*) > 1 returned zero rows — no
--     existing data would violate the new constraint below.
--
-- Approach: a STORED generated column, active_niche_key, that evaluates to
-- "columbarium|niche_number" for any row with a non-null niche_number whose
-- status is not Cancelled, and to NULL otherwise (Cancelled row, or no
-- niche assigned yet — e.g. a still-Pending provisional booking). A UNIQUE
-- KEY on that column enforces "at most one active record per
-- columbarium+niche" at the database level. InnoDB unique indexes treat
-- every NULL as distinct from every other NULL, so any number of
-- Cancelled/niche-less rows (all NULL) can coexist without colliding — a
-- fresh assignment reusing a cancelled niche produces a new, non-NULL key
-- that has never existed before, so it succeeds exactly as
-- isNicheAvailable() already allows today. Only two truly simultaneous
-- non-Cancelled writes for the same columbarium+niche can ever collide,
-- which is precisely the race this migration closes.
--
-- Scoped to (columbarium, niche_number) together, not niche_number alone —
-- matching the grid/suggestion logic's own intent (CremationController::
-- suggestNiche()'s comment: two columbariums can each legitimately have an
-- "N-2"). Note: Cremation::isNicheAvailable()/findNiche() currently check
-- niche_number globally, with no columbarium scoping, which is stricter
-- than this constraint — that mismatch is a separate, pre-existing
-- application-level gap (not introduced or fixed by this migration) and is
-- left untouched here so this change stays a pure backstop with no
-- behavior change to what's bookable today.
--
-- Run this once against the application database.

ALTER TABLE `cremation_records`
  ADD COLUMN `active_niche_key` VARCHAR(160)
    GENERATED ALWAYS AS (
      CASE
        WHEN `status` <> 'Cancelled' AND `niche_number` IS NOT NULL AND `niche_number` <> ''
          THEN CONCAT(COALESCE(`columbarium`, ''), '|', `niche_number`)
        ELSE NULL
      END
    ) STORED;

ALTER TABLE `cremation_records`
  ADD UNIQUE KEY `uq_active_cremation_niche` (`active_niche_key`);

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260904_add_active_niche_constraint.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
