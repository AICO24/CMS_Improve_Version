-- Migration: track which migrations have been applied to a database, so it's
-- always possible to tell whether a given environment is up to date.
-- Run this once against the application database, then keep it up to date by
-- inserting a row here whenever you write and apply a new migration_*.sql file.

CREATE TABLE IF NOT EXISTS `schema_migrations` (
    `migration` varchar(150) NOT NULL,
    `applied_at` timestamp NOT NULL DEFAULT current_timestamp(),
    PRIMARY KEY (`migration`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Backfill: record migrations that predate this tracking table as already applied.
INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260729_add_payment_receipt_verification.sql'),
    ('migration_20260730_add_user_contact_and_role.sql'),
    ('migration_20260807_add_schema_migrations_tracking.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
