-- Migration: per-user notification targeting (Burial Scheduling automation
-- audit, finding E.1 — the single biggest gap found).
--
-- notifications has never had any recipient column: every notification ever
-- created (schedule submitted/confirmed/completed/cancelled, payment
-- verified/rejected, decedent request approved/rejected, system exceptions)
-- is one global row, and `is_read` is a single flag shared by every viewer.
-- The 'notifications' GET route allows admin/staff/user uniformly with no
-- filtering, so any citizen sees every other citizen's private booking/
-- payment notices (names, lot numbers, dates), and one user reading/marking
-- a notification read silently suppresses it for everyone else too.
--
-- user_id is nullable and NOT backfilled for existing rows on purpose:
-- NULL keeps meaning exactly what every row meant before this migration —
-- a broadcast, staff-facing notice (system exceptions, expiration alerts,
-- admin-authored general notices via POST notifications) — while going
-- forward, application code sets it explicitly for any notification tied to
-- one citizen's own booking/payment/request. See NotificationController for
-- the read-side scoping: admin/staff keep seeing every row (unchanged
-- behavior — the existing "monitor all activity" feature is not touched or
-- redesigned); a citizen (role 'user') now only ever sees rows where
-- user_id = their own id.
-- Run this once against the application database.

ALTER TABLE `notifications`
  ADD COLUMN `user_id` int(11) DEFAULT NULL AFTER `notification_type`,
  ADD KEY `idx_user_id` (`user_id`),
  ADD CONSTRAINT `fk_notification_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260902_add_notification_recipient.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
