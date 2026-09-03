-- Migration: Cremation Phase B, step B1 — lets a cremation_records row exist
-- without an existing decedent_records row, mirroring
-- migration_20260824_add_automation_and_provisional_booking.sql's exact
-- pattern for burial_schedules. A citizen can now book a cremation for
-- someone not yet registered; the provisional info lives in
-- decedent_requests (already exists), linked here via decedent_request_id
-- instead of a new table — same reuse as burial_schedules.
-- Run this once against the application database.

ALTER TABLE `cremation_records`
  MODIFY COLUMN `deceased_id` int DEFAULT NULL,
  ADD COLUMN `decedent_request_id` int DEFAULT NULL AFTER `deceased_id`,
  ADD CONSTRAINT `fk_cremation_decedent_request` FOREIGN KEY (`decedent_request_id`) REFERENCES `decedent_requests` (`request_id`);

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260903_add_cremation_provisional_booking.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
