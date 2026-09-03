-- Migration: Decedent Records module audit, Batch K1 — document/certificate
-- upload (death certificate, burial permit, etc.), upload-only for now (no
-- AI extraction yet — that's a separate, later batch).
--
-- A separate table rather than a single certificate_path column on
-- decedent_records: a real record may reasonably need more than one
-- attachment (a death certificate AND a burial permit, or a later addition
-- like a court order), and this stays additive to decedent_records itself.
-- ON DELETE CASCADE is mostly a safety net — decedent_records rows are
-- soft-deleted (see Batch A's deleted_at), never physically removed by the
-- app itself, so this cascade only matters for a manual/administrative hard
-- delete at the database level.
-- Run this once against the application database.

CREATE TABLE `decedent_documents` (
  `document_id` int(11) NOT NULL AUTO_INCREMENT,
  `decedent_id` int(11) NOT NULL,
  `document_type` enum('death_certificate','burial_permit','other') NOT NULL DEFAULT 'other',
  `original_filename` varchar(255) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `uploaded_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`document_id`),
  KEY `idx_decedent_id` (`decedent_id`),
  KEY `uploaded_by` (`uploaded_by`),
  CONSTRAINT `fk_decedent_document_decedent` FOREIGN KEY (`decedent_id`) REFERENCES `decedent_records` (`decedent_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_decedent_document_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260903_add_decedent_documents.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
