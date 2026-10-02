-- Migration: Add booking_conversations and booking_messages tables for Booking Chat History
-- Stores multi-turn conversational intake history for AI Booking Assistant sessions.
--
-- Supports:
-- 1. Pre-booking inquiries (conversations without drafts)
-- 2. In-progress drafts (linked to booking_drafts via booking_draft_id)
-- 3. Finalized bookings (linked to burial_schedules or cremation_records via booking_id)
-- 4. Fast, ownership-scoped historical transcript retrieval with zero impact on draft lifecycle.

CREATE TABLE IF NOT EXISTS `booking_conversations` (
  `id` INT NOT NULL AUTO_INCREMENT,
  `user_id` INT NOT NULL,
  `booking_draft_id` INT DEFAULT NULL,
  `booking_id` INT DEFAULT NULL,
  `booking_type` ENUM('burial', 'cremation') COLLATE utf8mb4_general_ci DEFAULT NULL,
  `session_id` VARCHAR(64) COLLATE utf8mb4_general_ci NOT NULL,
  `title` VARCHAR(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` ENUM('ACTIVE', 'COMMITTED', 'ARCHIVED', 'ABANDONED') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'ACTIVE',
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_booking_conv_session` (`session_id`),
  KEY `idx_booking_conv_user` (`user_id`, `updated_at`),
  KEY `idx_booking_conv_draft` (`booking_draft_id`),
  KEY `idx_booking_conv_booking` (`booking_type`, `booking_id`),
  KEY `idx_booking_conv_status` (`status`),
  CONSTRAINT `fk_booking_conv_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_booking_conv_draft` FOREIGN KEY (`booking_draft_id`) REFERENCES `booking_drafts` (`draft_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

CREATE TABLE IF NOT EXISTS `booking_messages` (
  `id` BIGINT NOT NULL AUTO_INCREMENT,
  `conversation_id` INT NOT NULL,
  `sender_type` ENUM('user', 'assistant', 'system') COLLATE utf8mb4_general_ci NOT NULL,
  `message` TEXT COLLATE utf8mb4_general_ci NOT NULL,
  `message_type` VARCHAR(32) COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'text',
  `metadata` JSON DEFAULT NULL,
  `created_at` TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_booking_msg_conv` (`conversation_id`, `id`),
  CONSTRAINT `fk_booking_msg_conv` FOREIGN KEY (`conversation_id`) REFERENCES `booking_conversations` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20261002_add_booking_chat_history.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
