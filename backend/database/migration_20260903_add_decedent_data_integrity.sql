-- Migration: Decedent Records data-integrity foundation (module audit,
-- Batch A).
--
-- 1) decedent_records.deleted_at — Decedent::delete() used to issue a real
--    DELETE, guarded only by catching the MySQL 1451 error when a
--    burial_schedules/cremation_records/relocation_requests row still
--    referenced it. That left zero recovery path for a record deleted by
--    mistake once it had no such reference. delete() now sets this column
--    instead of removing the row; findAll/findById/countAll filter it out.
--    DecedentController::destroy() checks for related records itself before
--    soft-deleting (Decedent::hasRelatedRecords()), preserving the exact
--    same "can't delete while referenced" behavior as before — a soft
--    delete never trips MySQL's own FK check the way a real DELETE did, so
--    that protection has to be re-checked explicitly now.
--
-- 2) idx_decedent_name / idx_decedent_dod — Decedent::applyFilters()'s
--    search (`q`) and the default listing order (`ORDER BY dr.dod DESC,
--    dr.last_name, dr.first_name`) had no supporting index; only
--    idx_lot_id existed. These don't make a leading-wildcard LIKE '%term%'
--    an index seek, but they do make the exact-name/date lookups this
--    module's later duplicate-detection work (Batch B) will run cheap, and
--    let the default sort avoid a filesort on this table as it grows.
--
-- 3) decedent_requests.decedent_id gets a real FK (ON DELETE SET NULL) to
--    decedent_records.decedent_id. It has held that value since Batch T
--    (migration_20260819_add_decedent_requests.sql) with no constraint at
--    all — nothing stopped it from pointing at a since-removed record.
--    Verified against the current data with no orphans before adding this.
--
-- Run this once against the application database.

ALTER TABLE `decedent_records`
  ADD COLUMN `deleted_at` timestamp NULL DEFAULT NULL AFTER `updated_at`,
  ADD KEY `idx_decedent_deleted_at` (`deleted_at`),
  ADD KEY `idx_decedent_name` (`last_name`, `first_name`),
  ADD KEY `idx_decedent_dod` (`dod`);

ALTER TABLE `decedent_requests`
  ADD KEY `idx_decedent_requests_decedent_id` (`decedent_id`),
  ADD CONSTRAINT `fk_decedent_request_decedent` FOREIGN KEY (`decedent_id`) REFERENCES `decedent_records` (`decedent_id`) ON DELETE SET NULL;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260903_add_decedent_data_integrity.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
