-- Migration: Add request-level idempotency_key to refunds table (Batch 5 Remediation)
-- Guarantees that duplicate client/API refund requests resolve to the same internal refund record.

ALTER TABLE `refunds`
  ADD COLUMN `idempotency_key` VARCHAR(100) NULL DEFAULT NULL AFTER `payment_id`,
  ADD UNIQUE KEY `uq_refund_idempotency_key` (`idempotency_key`);

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260910_add_refund_idempotency_key.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
