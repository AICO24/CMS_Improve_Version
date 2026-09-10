-- Migration: Add webhook_events table for PayMongo webhook receiver (Batch 4)
-- Records received webhook events to guarantee idempotency and avoid duplicate processing.

CREATE TABLE IF NOT EXISTS `webhook_events` (
    `id`                BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
    `event_id`          VARCHAR(100) NOT NULL,
    `event_type`        VARCHAR(100) NOT NULL,
    `livemode`          TINYINT(1) NOT NULL DEFAULT 0,
    `received_at`       DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `processed`         TINYINT(1) NOT NULL DEFAULT 0,
    `processing_result` VARCHAR(500) NULL DEFAULT NULL,
    PRIMARY KEY (`id`),
    UNIQUE KEY `uq_webhook_event_id` (`event_id`),
    KEY `idx_webhook_event_type` (`event_type`),
    KEY `idx_webhook_received_at` (`received_at`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260910_add_webhook_events.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
