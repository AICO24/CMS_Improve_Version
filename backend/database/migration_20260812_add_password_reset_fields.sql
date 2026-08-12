-- Migration: add password-reset support to users.
-- Stores only a hash of the active reset code/token (never the raw value)
-- plus its expiry. One pair of columns serves the whole forgot/verify/reset
-- flow — the same code is checked at the "verify" step (read-only) and
-- re-checked authoritatively at the final "reset" step.
-- Run this once against the application database.

ALTER TABLE `users`
  ADD COLUMN `reset_token_hash` VARCHAR(255) DEFAULT NULL AFTER `password_hash`,
  ADD COLUMN `reset_token_expires_at` DATETIME DEFAULT NULL AFTER `reset_token_hash`;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260812_add_password_reset_fields.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
