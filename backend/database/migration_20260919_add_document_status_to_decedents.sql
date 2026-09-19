-- Migration: Add document_status compliance tracking and make dob nullable for provisional intake
-- Enables auto-creation of decedent records upon booking payment with "To Follow" requirements.

-- 1. Make dob nullable so provisional records can be created when only dod/name is known
ALTER TABLE `decedent_records` MODIFY COLUMN `dob` DATE NULL DEFAULT NULL;

-- 2. Add document_status enum to track compliance ('pending_requirements' vs 'verified')
ALTER TABLE `decedent_records` 
  ADD COLUMN `document_status` ENUM('pending_requirements', 'verified') NOT NULL DEFAULT 'pending_requirements' 
  AFTER `is_cremated`;

-- 3. Backfill existing records that already have complete records to 'verified'
UPDATE `decedent_records` SET `document_status` = 'verified' WHERE `dob` IS NOT NULL;

-- 4. Index for high-performance filtering
ALTER TABLE `decedent_records` ADD INDEX `idx_decedent_document_status` (`document_status`);

-- 5. Record migration
INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260919_add_document_status_to_decedents.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
