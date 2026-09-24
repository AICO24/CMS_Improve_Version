-- Migration: add user contact verification fields.
-- Adds email_verified, email_verified_at, verification_token_hash, and verification_token_expires_at
-- to users table. Pre-verifies existing accounts so current admins, staff, and users remain active.

ALTER TABLE `users`
  ADD COLUMN `email_verified` TINYINT(1) NOT NULL DEFAULT 0 AFTER `is_active`,
  ADD COLUMN `email_verified_at` DATETIME DEFAULT NULL AFTER `email_verified`,
  ADD COLUMN `verification_token_hash` VARCHAR(255) DEFAULT NULL AFTER `email_verified_at`,
  ADD COLUMN `verification_token_expires_at` DATETIME DEFAULT NULL AFTER `verification_token_hash`;

-- Pre-verify all existing accounts
UPDATE `users` SET `email_verified` = 1, `email_verified_at` = NOW() WHERE `email_verified` = 0;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260924_add_user_verification_fields.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
