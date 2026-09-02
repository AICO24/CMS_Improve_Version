-- Migration: disambiguate what payments.reference_id actually points at for
-- 'Lot Purchase' payments (Burial Scheduling automation audit, finding E.2).
--
-- reference_id has always been an untyped integer that could mean either a
-- burial_schedules.schedule_id (the normal "reserve then pay" flow) or a raw
-- lots.lot_id (the Lot Management "Pay Now" shortcut, which has no schedule
-- to reference). PaymentController resolved the ambiguity by GUESSING —
-- try schedule_id first, fall back to lot_id — which is only correct by
-- coincidence: schedule_id and lot_id are independent AUTO_INCREMENT
-- counters, so a "Pay Now" lot_id that happens to numerically collide with
-- an unrelated schedule_id was silently misattributed to that schedule, both
-- at payment-creation time (wrong reference label/ownership check) and at
-- verification time (PaymentController::autoConfirmScheduleForVerifiedPurchase()
-- / syncLotStatusForVerifiedPurchase() would confirm/reserve the wrong
-- booking and lot entirely).
--
-- reference_kind lets the frontend state its intent explicitly instead of
-- the backend inferring it after the fact. NULL is kept as a valid value
-- (not backfilled) for existing rows and for the payments modal's manual
-- reference-entry fallback, which still needs the pre-existing
-- try-schedule-then-lot resolution — this migration only adds the column;
-- application code decides when to trust it vs. fall back.
-- Run this once against the application database.

ALTER TABLE `payments`
  ADD COLUMN `reference_kind` enum('schedule','lot') DEFAULT NULL AFTER `reference_id`;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260902_add_payment_reference_kind.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
