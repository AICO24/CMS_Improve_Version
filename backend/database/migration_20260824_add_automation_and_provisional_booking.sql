-- Migration: Full Automation, Admin-First (Burial Scheduling).
--
-- 1) Lets a burial_schedules row exist without an existing decedent_records
--    row — a citizen can book for someone not yet registered, staff
--    formalizes the real decedent record later (required before the
--    schedule can be marked Completed, see ScheduleController). The
--    provisional info lives in decedent_requests (already exists, Batch T),
--    linked here via decedent_request_id instead of a new table.
-- 2) Adds system_exceptions, the open-items queue backend/services/
--    AutomationEngine.php raises into when a normally-automatic transition
--    (e.g. payment verified -> auto-confirm booking) can't safely proceed.
--    Distinct from audit_logs: audit_logs is an immutable historical trail,
--    system_exceptions is mutable (status: open -> resolved) so it can back
--    an admin "needs attention" queue.
-- Run this once against the application database.

ALTER TABLE `burial_schedules`
  MODIFY COLUMN `deceased_id` int(11) DEFAULT NULL,
  ADD COLUMN `decedent_request_id` int(11) DEFAULT NULL AFTER `deceased_id`,
  ADD CONSTRAINT `fk_schedule_decedent_request` FOREIGN KEY (`decedent_request_id`) REFERENCES `decedent_requests` (`request_id`);

CREATE TABLE `system_exceptions` (
  `exception_id` int(11) NOT NULL AUTO_INCREMENT,
  `event` varchar(100) NOT NULL,
  `entity_type` varchar(50) NOT NULL,
  `entity_id` int(11) NOT NULL,
  `reason` text NOT NULL,
  `severity` enum('info','warning','critical') NOT NULL DEFAULT 'warning',
  `status` enum('open','resolved') NOT NULL DEFAULT 'open',
  `context` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `resolved_by` int(11) DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `resolution_notes` text DEFAULT NULL,
  PRIMARY KEY (`exception_id`),
  KEY `idx_status` (`status`),
  KEY `idx_entity` (`entity_type`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260824_add_automation_and_provisional_booking.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
