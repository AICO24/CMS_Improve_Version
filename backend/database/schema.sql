-- Cemetery Management System — full schema (structure only, no data)
-- Regenerated 2026-08-07 from the live `cemetery_db` database via mysqldump,
-- because the previous dump (2026-06-30) predated the `cremation_records` and
-- `audit_logs` tables and the two migrations below, and was silently out of
-- sync with what the application code actually requires.
--
-- To provision a fresh database: import this file, then apply any
-- migration_*.sql files in this folder in filename (date) order. See
-- docs/database.md for the full migration convention.
--
-- Already folded into this baseline (do not reapply):
--   migration_20260729_add_payment_receipt_verification.sql
--   migration_20260730_add_user_contact_and_role.sql
-- Not yet applied to a fresh import from this file — apply after import:
--   migration_20260807_add_schema_migrations_tracking.sql

/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!40101 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;

--
-- Table structure for table `ai_parameters`
--

DROP TABLE IF EXISTS `ai_parameters`;
CREATE TABLE `ai_parameters` (
  `parameter_id` int(11) NOT NULL AUTO_INCREMENT,
  `module` varchar(100) NOT NULL,
  `param_name` varchar(100) NOT NULL,
  `param_value` varchar(255) NOT NULL,
  `param_type` enum('string','number','boolean','select') NOT NULL DEFAULT 'string',
  `description` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`parameter_id`),
  UNIQUE KEY `uq_module_name` (`module`,`param_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `audit_logs`
--

DROP TABLE IF EXISTS `audit_logs`;
CREATE TABLE `audit_logs` (
  `log_id` int(11) NOT NULL AUTO_INCREMENT,
  `user_id` int(11) DEFAULT NULL,
  `username` varchar(100) DEFAULT NULL,
  `action` varchar(100) NOT NULL,
  `entity_type` varchar(50) DEFAULT NULL,
  `entity_id` int(11) DEFAULT NULL,
  `details` text DEFAULT NULL,
  `ip_address` varchar(45) DEFAULT NULL,
  `created_at` datetime DEFAULT current_timestamp(),
  PRIMARY KEY (`log_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `blocks`
--

DROP TABLE IF EXISTS `blocks`;
CREATE TABLE `blocks` (
  `block_id` int(11) NOT NULL AUTO_INCREMENT,
  `section_id` int(11) NOT NULL,
  `block_name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `total_lots` int(11) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`block_id`),
  UNIQUE KEY `section_id` (`section_id`,`block_name`),
  CONSTRAINT `blocks_ibfk_1` FOREIGN KEY (`section_id`) REFERENCES `sections` (`section_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `burial_schedules`
--

DROP TABLE IF EXISTS `burial_schedules`;
CREATE TABLE `burial_schedules` (
  `schedule_id` int(11) NOT NULL AUTO_INCREMENT,
  `lot_id` int(11) NOT NULL,
  `deceased_id` int(11) NOT NULL,
  `schedule_date` date NOT NULL,
  `schedule_time` time DEFAULT NULL,
  `status` enum('Pending','Confirmed','Completed','Cancelled') DEFAULT 'Pending',
  `notes` text DEFAULT NULL,
  `confirmed_by` int(11) DEFAULT NULL,
  `created_by` int(11) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`schedule_id`),
  UNIQUE KEY `uq_schedule_slot` (`lot_id`,`schedule_date`,`schedule_time`),
  KEY `deceased_id` (`deceased_id`),
  KEY `confirmed_by` (`confirmed_by`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `burial_schedules_ibfk_1` FOREIGN KEY (`lot_id`) REFERENCES `lots` (`lot_id`),
  CONSTRAINT `burial_schedules_ibfk_2` FOREIGN KEY (`deceased_id`) REFERENCES `decedent_records` (`decedent_id`),
  CONSTRAINT `burial_schedules_ibfk_3` FOREIGN KEY (`confirmed_by`) REFERENCES `users` (`user_id`),
  CONSTRAINT `burial_schedules_ibfk_4` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `cremation_records`
--

DROP TABLE IF EXISTS `cremation_records`;
CREATE TABLE `cremation_records` (
  `cremation_id` int(11) NOT NULL AUTO_INCREMENT,
  `deceased_id` int(11) NOT NULL,
  `niche_number` varchar(50) DEFAULT NULL,
  `columbarium` varchar(100) DEFAULT NULL,
  `level` int(11) DEFAULT NULL,
  `cremation_date` date DEFAULT NULL,
  `status` varchar(50) DEFAULT 'Scheduled',
  `ash_storage_location` varchar(255) DEFAULT NULL,
  `notes` text DEFAULT NULL,
  `created_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`cremation_id`),
  KEY `deceased_id` (`deceased_id`),
  KEY `created_by` (`created_by`),
  CONSTRAINT `cremation_records_ibfk_1` FOREIGN KEY (`deceased_id`) REFERENCES `decedent_records` (`decedent_id`),
  CONSTRAINT `cremation_records_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `decedent_records`
--

DROP TABLE IF EXISTS `decedent_records`;
CREATE TABLE `decedent_records` (
  `decedent_id` int(11) NOT NULL AUTO_INCREMENT,
  `lot_id` int(11) NOT NULL,
  `first_name` varchar(100) NOT NULL,
  `last_name` varchar(100) NOT NULL,
  `middle_name` varchar(100) DEFAULT NULL,
  `suffix` varchar(50) DEFAULT NULL,
  `dob` date NOT NULL,
  `dod` date NOT NULL,
  `cause_of_death` text DEFAULT NULL,
  `contact_name` varchar(150) DEFAULT NULL,
  `contact_number` varchar(50) DEFAULT NULL,
  `is_cremated` enum('no','yes') NOT NULL DEFAULT 'no',
  `ash_storage` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`decedent_id`),
  KEY `idx_lot_id` (`lot_id`),
  CONSTRAINT `fk_decedent_lot` FOREIGN KEY (`lot_id`) REFERENCES `lots` (`lot_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `expiration_records`
--

DROP TABLE IF EXISTS `expiration_records`;
CREATE TABLE `expiration_records` (
  `expiration_id` int(11) NOT NULL AUTO_INCREMENT,
  `lot_id` int(11) NOT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `renewed` enum('yes','no') NOT NULL DEFAULT 'no',
  `exhumation_status` enum('Pending','Scheduled','Completed','Not Required') NOT NULL DEFAULT 'Pending',
  `notes` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`expiration_id`),
  KEY `idx_end_date` (`end_date`),
  KEY `idx_lot_id` (`lot_id`),
  CONSTRAINT `expiration_records_ibfk_1` FOREIGN KEY (`lot_id`) REFERENCES `lots` (`lot_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `lot_types`
--

DROP TABLE IF EXISTS `lot_types`;
CREATE TABLE `lot_types` (
  `type_id` int(11) NOT NULL AUTO_INCREMENT,
  `type_name` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`type_id`),
  UNIQUE KEY `type_name` (`type_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `lots`
--

DROP TABLE IF EXISTS `lots`;
CREATE TABLE `lots` (
  `lot_id` int(11) NOT NULL AUTO_INCREMENT,
  `block_id` int(11) NOT NULL,
  `lot_number` varchar(50) NOT NULL,
  `lot_type_id` int(11) NOT NULL,
  `status` enum('Available','Reserved','Occupied','Expired') DEFAULT 'Available',
  `price` decimal(12,2) NOT NULL,
  `dimensions` varchar(50) DEFAULT NULL,
  `location_notes` text DEFAULT NULL,
  `lease_start_date` date DEFAULT NULL,
  `lease_end_date` date DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`lot_id`),
  UNIQUE KEY `block_id` (`block_id`,`lot_number`),
  KEY `lot_type_id` (`lot_type_id`),
  CONSTRAINT `lots_ibfk_1` FOREIGN KEY (`block_id`) REFERENCES `blocks` (`block_id`) ON DELETE CASCADE,
  CONSTRAINT `lots_ibfk_2` FOREIGN KEY (`lot_type_id`) REFERENCES `lot_types` (`type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `notifications`
--

DROP TABLE IF EXISTS `notifications`;
CREATE TABLE `notifications` (
  `notification_id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(255) NOT NULL,
  `message` text NOT NULL,
  `notification_type` enum('Expiration','Schedule','Relocation','Payment','System') NOT NULL DEFAULT 'System',
  `is_read` tinyint(1) NOT NULL DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`notification_id`),
  KEY `idx_notification_type` (`notification_type`),
  KEY `idx_is_read` (`is_read`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `payments`
--

DROP TABLE IF EXISTS `payments`;
CREATE TABLE `payments` (
  `payment_id` int(11) NOT NULL AUTO_INCREMENT,
  `transaction_type` enum('Lot Purchase','Cremation','Relocation','Renewal','Other') NOT NULL,
  `reference_id` int(11) DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `payment_date` date NOT NULL,
  `payment_method` varchar(50) NOT NULL,
  `receipt_number` varchar(100) NOT NULL,
  `notes` text DEFAULT NULL,
  `received_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  `receipt_url` varchar(255) DEFAULT NULL,
  `verification_status` enum('Pending','Verified','Rejected') NOT NULL DEFAULT 'Pending',
  `verified_by` int(11) DEFAULT NULL,
  `verified_at` datetime DEFAULT NULL,
  PRIMARY KEY (`payment_id`),
  KEY `idx_payment_date` (`payment_date`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `relocation_requests`
--

DROP TABLE IF EXISTS `relocation_requests`;
CREATE TABLE `relocation_requests` (
  `request_id` int(11) NOT NULL AUTO_INCREMENT,
  `from_lot_id` int(11) NOT NULL,
  `to_lot_id` int(11) NOT NULL,
  `deceased_id` int(11) NOT NULL,
  `reason` text NOT NULL,
  `status` enum('Pending','Approved','Completed','Denied') DEFAULT 'Pending',
  `requested_by` int(11) NOT NULL,
  `approved_by` int(11) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`request_id`),
  KEY `from_lot_id` (`from_lot_id`),
  KEY `to_lot_id` (`to_lot_id`),
  KEY `deceased_id` (`deceased_id`),
  KEY `requested_by` (`requested_by`),
  KEY `approved_by` (`approved_by`),
  CONSTRAINT `relocation_requests_ibfk_1` FOREIGN KEY (`from_lot_id`) REFERENCES `lots` (`lot_id`),
  CONSTRAINT `relocation_requests_ibfk_2` FOREIGN KEY (`to_lot_id`) REFERENCES `lots` (`lot_id`),
  CONSTRAINT `relocation_requests_ibfk_3` FOREIGN KEY (`deceased_id`) REFERENCES `decedent_records` (`decedent_id`),
  CONSTRAINT `relocation_requests_ibfk_4` FOREIGN KEY (`requested_by`) REFERENCES `users` (`user_id`),
  CONSTRAINT `relocation_requests_ibfk_5` FOREIGN KEY (`approved_by`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `roles`
--

DROP TABLE IF EXISTS `roles`;
CREATE TABLE `roles` (
  `role_id` int(11) NOT NULL AUTO_INCREMENT,
  `title` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`role_id`),
  UNIQUE KEY `title` (`title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `sections`
--

DROP TABLE IF EXISTS `sections`;
CREATE TABLE `sections` (
  `section_id` int(11) NOT NULL AUTO_INCREMENT,
  `section_name` varchar(100) NOT NULL,
  `description` text DEFAULT NULL,
  `total_blocks` int(11) DEFAULT 0,
  `total_lots` int(11) DEFAULT 0,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`section_id`),
  UNIQUE KEY `section_name` (`section_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

--
-- Table structure for table `users`
--

DROP TABLE IF EXISTS `users`;
CREATE TABLE `users` (
  `user_id` int(11) NOT NULL AUTO_INCREMENT,
  `username` varchar(50) NOT NULL,
  `password_hash` varchar(255) NOT NULL,
  `reset_token_hash` varchar(255) DEFAULT NULL,
  `reset_token_expires_at` datetime DEFAULT NULL,
  `full_name` varchar(100) NOT NULL,
  `email` varchar(100) NOT NULL,
  `contact_number` varchar(50) DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `role_id` int(11) NOT NULL,
  `is_active` tinyint(1) DEFAULT 1,
  `last_login` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  KEY `role_id` (`role_id`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;
/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;
