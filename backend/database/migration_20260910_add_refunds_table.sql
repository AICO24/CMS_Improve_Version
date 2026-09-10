-- Migration: Add refunds table for PayMongo refund foundation (Batch 5)
-- Establishes server-authoritative record of refund requests and gateway states.

CREATE TABLE IF NOT EXISTS `refunds` (
    `refund_id`          INT NOT NULL AUTO_INCREMENT,
    `payment_id`         INT NOT NULL,
    `idempotency_key`    VARCHAR(100) NULL DEFAULT NULL,
    `gateway_refund_id`  VARCHAR(100) NULL DEFAULT NULL,
    `gateway_provider`   VARCHAR(20) NOT NULL DEFAULT 'paymongo',
    `amount`             DECIMAL(12,2) NOT NULL,
    `currency`           CHAR(3) NOT NULL DEFAULT 'PHP',
    `status`             ENUM('Pending','Processing','Succeeded','Failed') NOT NULL DEFAULT 'Pending',
    `reason`             ENUM('duplicate','fraudulent','requested_by_customer','others') NOT NULL DEFAULT 'requested_by_customer',
    `notes`              TEXT NULL DEFAULT NULL,
    `requested_by`       INT NULL DEFAULT NULL,
    `created_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    `updated_at`         TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    `processed_at`       DATETIME NULL DEFAULT NULL,
    PRIMARY KEY (`refund_id`),
    UNIQUE KEY `uq_refund_idempotency_key` (`idempotency_key`),
    UNIQUE KEY `uq_refund_gateway_refund_id` (`gateway_refund_id`),
    KEY `idx_refund_payment_id` (`payment_id`),
    KEY `idx_refund_status` (`status`),
    KEY `idx_refund_requested_by` (`requested_by`),
    CONSTRAINT `fk_refund_payment_id` FOREIGN KEY (`payment_id`) REFERENCES `payments` (`payment_id`) ON DELETE RESTRICT,
    CONSTRAINT `fk_refund_requested_by` FOREIGN KEY (`requested_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260910_add_refunds_table.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
