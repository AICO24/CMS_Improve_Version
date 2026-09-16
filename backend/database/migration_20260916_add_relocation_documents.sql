-- Migration: Relocation Management module audit, Batch 1 — document/permit
-- upload (exhumation permit, transfer clearance, family consent, etc.)
--
-- Modeled after decedent_documents (Batch K1): allows attaching official
-- authorizations and permits directly to a relocation request.
-- ON DELETE CASCADE ensures documents are cleaned up if a request is removed.

CREATE TABLE IF NOT EXISTS `relocation_documents` (
  `document_id` int(11) NOT NULL AUTO_INCREMENT,
  `request_id` int(11) NOT NULL,
  `document_type` enum('exhumation_permit','transfer_clearance','family_consent','other') NOT NULL DEFAULT 'other',
  `original_filename` varchar(255) NOT NULL,
  `file_path` varchar(255) NOT NULL,
  `uploaded_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`document_id`),
  KEY `idx_request_id` (`request_id`),
  KEY `uploaded_by` (`uploaded_by`),
  CONSTRAINT `fk_relocation_document_request` FOREIGN KEY (`request_id`) REFERENCES `relocation_requests` (`request_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_relocation_document_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260916_add_relocation_documents.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
