-- Migration: track which status the citizen was last shown for a
-- decedent_requests row, so the chat assistant's "Update: X has been
-- added..." / "still awaiting review" message is shown once per actual
-- status change instead of on every single chat load forever.
-- Run this once against the application database.

ALTER TABLE `decedent_requests`
  ADD COLUMN `last_notified_status` enum('pending','approved','rejected') DEFAULT NULL AFTER `status`;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260819_add_decedent_request_notification_tracking.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
