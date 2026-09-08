-- Migration: Add booking_pending_actions table for Booking Automation V2 (Batch 3)
-- Manages short-lived, action-bound, user-scoped pending actions for destructive
-- and operational operations (Reschedule, Cancellation, Allocation Change).

CREATE TABLE IF NOT EXISTS `booking_pending_actions` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `booking_type` ENUM('burial', 'cremation') COLLATE utf8mb4_general_ci NOT NULL,
  `booking_id` INT NOT NULL,
  `action_type` VARCHAR(64) COLLATE utf8mb4_general_ci NOT NULL,
  `payload` JSON NOT NULL,
  `payload_hash` VARCHAR(64) COLLATE utf8mb4_general_ci NOT NULL,
  `confirmation_token` VARCHAR(64) COLLATE utf8mb4_general_ci NOT NULL,
  `status` ENUM('AWAITING_CONFIRMATION', 'CONFIRMED', 'EXECUTING', 'EXECUTED', 'FAILED', 'REJECTED', 'EXPIRED', 'SUPERSEDED') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'AWAITING_CONFIRMATION',
  `expires_at` DATETIME NOT NULL,
  `confirmed_at` DATETIME DEFAULT NULL,
  `executed_at` DATETIME DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_pending_action_token` (`confirmation_token`),
  KEY `idx_pending_action_user` (`user_id`),
  KEY `idx_pending_action_lookup` (`user_id`, `booking_type`, `booking_id`, `status`),
  KEY `idx_pending_action_expiry` (`status`, `expires_at`),
  CONSTRAINT `fk_pending_action_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260908_add_booking_pending_actions.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
