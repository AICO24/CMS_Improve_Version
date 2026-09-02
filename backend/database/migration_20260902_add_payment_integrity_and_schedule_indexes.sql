-- Batch A (Reservation module audit, 2026-09-02): closes two data-integrity
-- gaps found in the Manage Reservation audit and adds the composite indexes
-- the existing stale-pending sweep queries (Schedule::findStalePendingFor*())
-- were missing.
--
-- 1) payments.receipt_number had no uniqueness enforced at the DB level —
--    only an application-side check-then-insert (PaymentController), which
--    is a TOCTOU race between two concurrent submissions. Verified before
--    writing this migration: no existing duplicate receipt_number rows.
-- 2) payments.received_by / verified_by had no FK to users at all. Verified
--    before writing this migration: no existing orphaned values in either
--    column.
-- 3) payments.reference_id is deliberately NOT given a FK here — it is
--    polymorphic (schedule vs. lot, disambiguated by reference_kind, see
--    migration_20260902_add_payment_reference_kind.sql) and a single-table
--    FK isn't possible without splitting it into two columns, which is a
--    larger schema change than this batch's scope. A composite index on
--    (reference_kind, reference_id) is added instead for lookup performance.
-- 4) burial_schedules had no index supporting the three stale-pending sweep
--    queries (all filter on status='Pending' plus stale_notified_at /
--    final_warning_notified_at), so each was effectively a full table scan.
--
-- Run this once against the application database.

ALTER TABLE `payments`
  ADD CONSTRAINT `uq_payment_receipt_number` UNIQUE (`receipt_number`),
  ADD CONSTRAINT `fk_payment_received_by` FOREIGN KEY (`received_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD CONSTRAINT `fk_payment_verified_by` FOREIGN KEY (`verified_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  ADD INDEX `idx_payment_reference` (`reference_kind`, `reference_id`);

ALTER TABLE `burial_schedules`
  ADD INDEX `idx_schedule_stale_sweep` (`status`, `stale_notified_at`),
  ADD INDEX `idx_schedule_final_warning_sweep` (`status`, `final_warning_notified_at`, `stale_notified_at`);

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260902_add_payment_integrity_and_schedule_indexes.sql')
ON DUPLICATE KEY UPDATE migration = migration;
