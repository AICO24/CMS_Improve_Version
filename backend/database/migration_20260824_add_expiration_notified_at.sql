-- Migration: track when an expiration_records row last triggered an
-- "expiring soon" notification, so ExpirationController::generateNotifications()
-- can stop creating a duplicate notification every time an admin/staff
-- member visits the Notifications page (Admin-Wide Automation Audit, Batch D).
-- NULL means "never notified yet" (or a fresh lease cycle after renewal
-- created a new row); once set, the record won't be re-notified.
-- Run this once against the application database.

ALTER TABLE `expiration_records`
  ADD COLUMN `notified_at` datetime DEFAULT NULL AFTER `exhumation_status`;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260824_add_expiration_notified_at.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
