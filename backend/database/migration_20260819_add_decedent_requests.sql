-- Migration: add decedent_requests, a citizen-facing intake queue for
-- registering a decedent who isn't in decedent_records yet. Citizens never
-- create/see the sensitive decedent_records fields (dob, cause_of_death,
-- contact info, lot assignment) directly — they submit a lightweight
-- request here, staff reviews it and creates the real decedent_records row
-- through the existing Decedent Records form exactly as before, then links
-- it back via decedent_id.
-- Run this once against the application database.

CREATE TABLE `decedent_requests` (
  `request_id` int(11) NOT NULL AUTO_INCREMENT,
  `requested_by` int(11) NOT NULL,
  `full_name` varchar(200) NOT NULL,
  `approximate_dod` date DEFAULT NULL,
  `relationship` varchar(100) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `status` enum('pending','approved','rejected') NOT NULL DEFAULT 'pending',
  `decedent_id` int(11) DEFAULT NULL,
  `reviewed_by` int(11) DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `rejection_reason` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`request_id`),
  KEY `idx_requested_by` (`requested_by`),
  KEY `idx_status` (`status`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260819_add_decedent_requests.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
