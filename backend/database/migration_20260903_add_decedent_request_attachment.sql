-- Migration: Decedent Records module audit, Batch L1 — lets a citizen
-- attach a death certificate/burial permit to their OWN decedent_requests
-- row at booking time, before any decedent_records row (and therefore any
-- decedent_id a decedent_documents row could reference) exists yet.
--
-- A single nullable path/filename pair rather than a decedent_documents-
-- style table: a decedent_requests row is a short-lived intake artifact
-- (pending -> approved/rejected), realistically carrying at most one
-- supporting file, unlike a permanent decedent_records row which may
-- reasonably accumulate several over time (Batch K1's own reasoning).
--
-- Lifecycle: DecedentRequestController::reject() deletes the file (the
-- request is never approved, so it's never needed again); approve() moves
-- it into decedent_documents against the newly-formalized decedent_id and
-- clears these two columns (the file now lives in its permanent home).
-- Run this once against the application database.

ALTER TABLE `decedent_requests`
  ADD COLUMN `attachment_path` varchar(255) DEFAULT NULL AFTER `notes`,
  ADD COLUMN `attachment_original_filename` varchar(255) DEFAULT NULL AFTER `attachment_path`;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260903_add_decedent_request_attachment.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
