-- Migration: adds the booking_drafts table for conversational booking assistance.
-- Migration: adds the booking_drafts table for conversational booking assistance (BMS-1: Database Foundation).
-- Manages conversational booking draft states for burial and cremation flows,
-- storing intermediate extracted field values, missing required fields, conversation
-- message history, expiration timestamps, and references to committed records.
-- storing intermediate extracted field values, missing required fields, optional global
-- conversation correlation ID, expiration timestamps, and references to committed records.
--
-- Excludes booking-specific conversation_history (deferred to global AI history architecture).
-- Excludes v_unified_bookings view (deferred to BMS-9).
--
-- Run this once against the application database.

CREATE TABLE IF NOT EXISTS `booking_drafts` (
DROP TABLE IF EXISTS `booking_drafts`;

CREATE TABLE `booking_drafts` (
  `draft_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `service_type` enum('burial','cremation') COLLATE utf8mb4_general_ci NOT NULL,
  `status` enum('DRAFT_STARTED','COLLECTING_INFO','LOT_SELECTION','CREMATION_PREFS','READY_FOR_REVIEW','AWAITING_CONFIRM','COMMITTED','CANCELLED','EXPIRED') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'DRAFT_STARTED',
  `extracted_data` json NOT NULL DEFAULT (JSON_OBJECT()),
  `missing_fields` json NOT NULL DEFAULT (JSON_ARRAY()),
  `conversation_history` json DEFAULT NULL,
  `conversation_id` varchar(64) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `committed_record_id` int DEFAULT NULL,
  `committed_record_type` enum('burial','cremation') COLLATE utf8mb4_general_ci DEFAULT NULL,
  `expires_at` datetime NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`draft_id`),
  KEY `idx_booking_draft_user` (`user_id`),
  KEY `idx_booking_draft_status` (`status`),
  KEY `idx_booking_draft_expires` (`expires_at`),
  KEY `idx_booking_draft_conversation` (`conversation_id`),
  CONSTRAINT `fk_booking_draft_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260907_add_booking_drafts.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
