-- Migration: Add nullable, non-destructive gateway-association columns to
-- the `payments` table in preparation for the future PayMongo integration
-- (Batch 2 — payment gateway foundation).
--
-- The system's manual/offline payment flow (Cash, Bank Transfer, GCash,
-- PayMaya, Card-with-uploaded-proof) must keep working untouched. All new
-- columns are therefore nullable and default NULL, so every existing and
-- future manual payment row simply has no gateway association. MySQL unique
-- indexes allow multiple NULLs, so manual records never collide on the
-- gateway columns.
--
-- Column choices (minimum justified by the actual PayMongo architecture):
--   * gateway_provider            — which gateway handled this row ('paymongo' or NULL)
--   * currency                    — PayMongo supports PHP only; amounts are
--                                   integer centavos there. Existing rows are
--                                   all Filipino-peso transactions, so a
--                                   default of 'PHP' is safe and factual.
--   * gateway_payment_intent_id   — PaymentIntent id (pi_...) created server-side
--   * gateway_checkout_session_id — CheckoutSession id (cs_...) when hosted
--                                   checkout is used
--   * gateway_payment_id          — final Payment id (pay_...) that actually
--                                   moved money (from webhook/retrieval)
--   * gateway_status              — read-only mirror of the gateway lifecycle
--                                   state (awaiting_payment_method / processing
--                                   / succeeded / failed / etc.), never a
--                                   source of truth for CMS verification.
--
-- Deliberately NOT added in this batch (later batches): refunds table,
-- webhook_events table, and any change to the existing
-- 'Pending' / 'Verified' / 'Rejected' verification semantics.
--
-- Run this once against the application database, then confirm it is
-- recorded in schema_migrations (handled below).

ALTER TABLE `payments`
  ADD COLUMN `gateway_provider` varchar(20) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'Gateway provider identifier (e.g. paymongo); NULL for manual/offline payments' AFTER `receipt_url`,
  ADD COLUMN `currency` char(3) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'PHP' COMMENT 'ISO 4217 currency of the payment (PayMongo supports PHP)' AFTER `gateway_provider`,
  ADD COLUMN `gateway_payment_intent_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'PayMongo PaymentIntent id (pi_...) created server-side' AFTER `currency`,
  ADD COLUMN `gateway_checkout_session_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'PayMongo CheckoutSession id (cs_...) when hosted checkout is used' AFTER `gateway_payment_intent_id`,
  ADD COLUMN `gateway_payment_id` varchar(100) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'PayMongo Payment id (pay_...) issued when money actually moved' AFTER `gateway_checkout_session_id`,
  ADD COLUMN `gateway_status` varchar(50) CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci DEFAULT NULL COMMENT 'Read-only mirror of gateway lifecycle state (awaiting_payment_method/processing/succeeded/failed/...)' AFTER `gateway_payment_id`,
  ADD UNIQUE KEY `uq_payment_gateway_payment_intent_id` (`gateway_payment_intent_id`),
  ADD UNIQUE KEY `uq_payment_gateway_checkout_session_id` (`gateway_checkout_session_id`),
  ADD UNIQUE KEY `uq_payment_gateway_payment_id` (`gateway_payment_id`),
  ADD KEY `idx_payment_gateway_status` (`gateway_status`);

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260910_add_paymongo_gateway_fields.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;