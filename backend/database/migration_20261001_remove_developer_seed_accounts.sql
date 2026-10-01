-- Migration: Remove Inappropriate Developer Seed Accounts (DB-001)
--
-- Ensures any personal/developer accounts created by legacy seed scripts
-- ('johneric0303' and 'staff_johneric') are removed from the database.

DELETE FROM `users` WHERE `username` IN ('johneric0303', 'staff_johneric');

-- Record migration in tracking table
INSERT INTO `schema_migrations` (`migration`) VALUES
    ('migration_20261001_remove_developer_seed_accounts.sql')
ON DUPLICATE KEY UPDATE `migration` = VALUES(`migration`);

SELECT 'migration_completed' AS status;
