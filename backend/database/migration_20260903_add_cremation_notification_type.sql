-- Migration: adds 'Cremation' to notifications.notification_type's enum.
--
-- Found by live-testing Cremation Phase B (not a guess): CremationController's
-- new notifyCremation()/notifyCremationStatusChange() (mirroring
-- ScheduleController's identical pattern with notification_type => 'Cremation')
-- threw a PDOException on the very first citizen booking — the enum only
-- ever had ('Expiration','Schedule','Relocation','Payment','System'),
-- predating any notification actually being generated for this module.
-- Run this once against the application database.

ALTER TABLE `notifications`
  MODIFY COLUMN `notification_type` enum('Expiration','Schedule','Relocation','Payment','System','Cremation') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'System';

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260903_add_cremation_notification_type.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
