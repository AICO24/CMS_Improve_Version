
/*!40101 SET @OLD_CHARACTER_SET_CLIENT=@@CHARACTER_SET_CLIENT */;
/*!40101 SET @OLD_CHARACTER_SET_RESULTS=@@CHARACTER_SET_RESULTS */;
/*!40101 SET @OLD_COLLATION_CONNECTION=@@COLLATION_CONNECTION */;
/*!50503 SET NAMES utf8mb4 */;
/*!40103 SET @OLD_TIME_ZONE=@@TIME_ZONE */;
/*!40103 SET TIME_ZONE='+00:00' */;
/*!40014 SET @OLD_UNIQUE_CHECKS=@@UNIQUE_CHECKS, UNIQUE_CHECKS=0 */;
/*!40014 SET @OLD_FOREIGN_KEY_CHECKS=@@FOREIGN_KEY_CHECKS, FOREIGN_KEY_CHECKS=0 */;
/*!40101 SET @OLD_SQL_MODE=@@SQL_MODE, SQL_MODE='NO_AUTO_VALUE_ON_ZERO' */;
/*!40111 SET @OLD_SQL_NOTES=@@SQL_NOTES, SQL_NOTES=0 */;
DROP TABLE IF EXISTS `ai_knowledge`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_knowledge` (
  `knowledge_id` int NOT NULL AUTO_INCREMENT,
  `topic` varchar(150) COLLATE utf8mb4_general_ci NOT NULL,
  `content` text COLLATE utf8mb4_general_ci NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`knowledge_id`),
  UNIQUE KEY `uq_topic` (`topic`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `ai_parameters`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `ai_parameters` (
  `parameter_id` int NOT NULL AUTO_INCREMENT,
  `module` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `param_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `param_value` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `param_type` enum('string','number','boolean','select') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'string',
  `description` text COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`parameter_id`),
  UNIQUE KEY `uq_module_name` (`module`,`param_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `audit_logs`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `audit_logs` (
  `log_id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `username` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `action` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `entity_type` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `entity_id` int DEFAULT NULL,
  `details` text COLLATE utf8mb4_general_ci,
  `ip_address` varchar(45) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `created_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`log_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `blocks`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `blocks` (
  `block_id` int NOT NULL AUTO_INCREMENT,
  `section_id` int NOT NULL,
  `block_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `total_lots` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`block_id`),
  UNIQUE KEY `section_id` (`section_id`,`block_name`),
  CONSTRAINT `blocks_ibfk_1` FOREIGN KEY (`section_id`) REFERENCES `sections` (`section_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `burial_schedules`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `burial_schedules` (
  `schedule_id` int NOT NULL AUTO_INCREMENT,
  `lot_id` int NOT NULL,
  `deceased_id` int DEFAULT NULL,
  `decedent_request_id` int DEFAULT NULL,
  `schedule_date` date NOT NULL,
  `schedule_time` time DEFAULT NULL,
  `status` enum('Pending','Confirmed','Completed','Cancelled') COLLATE utf8mb4_general_ci DEFAULT 'Pending',
  `stale_notified_at` datetime DEFAULT NULL,
  `final_warning_notified_at` datetime DEFAULT NULL,
  `unlinked_decedent_notified_at` datetime DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `confirmed_by` int DEFAULT NULL,
  `created_by` int NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `active_slot_key` varchar(64) COLLATE utf8mb4_general_ci GENERATED ALWAYS AS ((case when (`status` <> _utf8mb4'Cancelled') then concat(`lot_id`,_utf8mb4'|',`schedule_date`,_utf8mb4'|',coalesce(`schedule_time`,_utf8mb4'')) else NULL end)) STORED,
  PRIMARY KEY (`schedule_id`),
  UNIQUE KEY `uq_active_schedule_slot` (`active_slot_key`),
  KEY `deceased_id` (`deceased_id`),
  KEY `confirmed_by` (`confirmed_by`),
  KEY `created_by` (`created_by`),
  KEY `fk_schedule_decedent_request` (`decedent_request_id`),
  KEY `idx_lot_id` (`lot_id`),
  KEY `idx_schedule_stale_sweep` (`status`,`stale_notified_at`),
  KEY `idx_schedule_final_warning_sweep` (`status`,`final_warning_notified_at`,`stale_notified_at`),
  CONSTRAINT `burial_schedules_ibfk_1` FOREIGN KEY (`lot_id`) REFERENCES `lots` (`lot_id`),
  CONSTRAINT `burial_schedules_ibfk_2` FOREIGN KEY (`deceased_id`) REFERENCES `decedent_records` (`decedent_id`),
  CONSTRAINT `burial_schedules_ibfk_3` FOREIGN KEY (`confirmed_by`) REFERENCES `users` (`user_id`),
  CONSTRAINT `burial_schedules_ibfk_4` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`),
  CONSTRAINT `fk_schedule_decedent_request` FOREIGN KEY (`decedent_request_id`) REFERENCES `decedent_requests` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `capacity_alerts`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `capacity_alerts` (
  `alert_id` int NOT NULL AUTO_INCREMENT,
  `alert_key` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `alert_month` varchar(7) COLLATE utf8mb4_general_ci NOT NULL,
  `capacity_status` varchar(20) COLLATE utf8mb4_general_ci NOT NULL,
  `occupancy_rate` decimal(6,4) DEFAULT NULL,
  `notified_at` datetime DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`alert_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `cremation_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `cremation_records` (
  `cremation_id` int NOT NULL AUTO_INCREMENT,
  `deceased_id` int DEFAULT NULL,
  `decedent_request_id` int DEFAULT NULL,
  `niche_number` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `columbarium` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `level` int DEFAULT NULL,
  `cremation_date` date DEFAULT NULL,
  `status` varchar(50) COLLATE utf8mb4_general_ci DEFAULT 'Scheduled',
  `stale_notified_at` datetime DEFAULT NULL,
  `final_warning_notified_at` datetime DEFAULT NULL,
  `ash_storage_location` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `active_niche_key` varchar(160) COLLATE utf8mb4_general_ci GENERATED ALWAYS AS ((case when ((`status` <> _utf8mb4'Cancelled') and (`niche_number` is not null) and (`niche_number` <> _utf8mb4'')) then concat(coalesce(`columbarium`,_utf8mb4''),_utf8mb4'|',`niche_number`) else NULL end)) STORED,
  PRIMARY KEY (`cremation_id`),
  UNIQUE KEY `uq_active_cremation_niche` (`active_niche_key`),
  KEY `deceased_id` (`deceased_id`),
  KEY `created_by` (`created_by`),
  KEY `fk_cremation_decedent_request` (`decedent_request_id`),
  KEY `idx_cremation_stale_sweep` (`status`,`stale_notified_at`),
  KEY `idx_cremation_final_warning_sweep` (`status`,`final_warning_notified_at`,`stale_notified_at`),
  CONSTRAINT `cremation_records_ibfk_1` FOREIGN KEY (`deceased_id`) REFERENCES `decedent_records` (`decedent_id`),
  CONSTRAINT `cremation_records_ibfk_2` FOREIGN KEY (`created_by`) REFERENCES `users` (`user_id`),
  CONSTRAINT `fk_cremation_decedent_request` FOREIGN KEY (`decedent_request_id`) REFERENCES `decedent_requests` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `decedent_documents`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `decedent_documents` (
  `document_id` int NOT NULL AUTO_INCREMENT,
  `decedent_id` int NOT NULL,
  `document_type` enum('death_certificate','burial_permit','other') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'other',
  `original_filename` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `file_path` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `uploaded_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`document_id`),
  KEY `idx_decedent_id` (`decedent_id`),
  KEY `uploaded_by` (`uploaded_by`),
  CONSTRAINT `fk_decedent_document_decedent` FOREIGN KEY (`decedent_id`) REFERENCES `decedent_records` (`decedent_id`) ON DELETE CASCADE,
  CONSTRAINT `fk_decedent_document_user` FOREIGN KEY (`uploaded_by`) REFERENCES `users` (`user_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `decedent_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `decedent_records` (
  `decedent_id` int NOT NULL AUTO_INCREMENT,
  `lot_id` int DEFAULT NULL,
  `first_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `last_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `middle_name` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `suffix` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `dob` date NOT NULL,
  `dod` date NOT NULL,
  `cause_of_death` text COLLATE utf8mb4_general_ci,
  `contact_name` varchar(150) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `contact_number` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `is_cremated` enum('no','yes') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'no',
  `ash_storage` text COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `deleted_at` timestamp NULL DEFAULT NULL,
  PRIMARY KEY (`decedent_id`),
  KEY `idx_lot_id` (`lot_id`),
  KEY `idx_decedent_deleted_at` (`deleted_at`),
  KEY `idx_decedent_name` (`last_name`,`first_name`),
  KEY `idx_decedent_dod` (`dod`),
  CONSTRAINT `fk_decedent_lot` FOREIGN KEY (`lot_id`) REFERENCES `lots` (`lot_id`) ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `decedent_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `decedent_requests` (
  `request_id` int NOT NULL AUTO_INCREMENT,
  `requested_by` int NOT NULL,
  `full_name` varchar(200) COLLATE utf8mb4_general_ci NOT NULL,
  `approximate_dod` date DEFAULT NULL,
  `relationship` varchar(100) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `attachment_path` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `attachment_original_filename` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `status` enum('pending','approved','rejected') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'pending',
  `last_notified_status` enum('pending','approved','rejected') COLLATE utf8mb4_general_ci DEFAULT NULL,
  `decedent_id` int DEFAULT NULL,
  `reviewed_by` int DEFAULT NULL,
  `reviewed_at` timestamp NULL DEFAULT NULL,
  `rejection_reason` text COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`request_id`),
  KEY `idx_requested_by` (`requested_by`),
  KEY `idx_status` (`status`),
  KEY `idx_decedent_requests_decedent_id` (`decedent_id`),
  CONSTRAINT `fk_decedent_request_decedent` FOREIGN KEY (`decedent_id`) REFERENCES `decedent_records` (`decedent_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `expiration_records`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `expiration_records` (
  `expiration_id` int NOT NULL AUTO_INCREMENT,
  `lot_id` int NOT NULL,
  `start_date` date DEFAULT NULL,
  `end_date` date DEFAULT NULL,
  `renewed` enum('yes','no') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'no',
  `exhumation_status` enum('Pending','Scheduled','Completed','Not Required') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Pending',
  `notified_at` datetime DEFAULT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`expiration_id`),
  KEY `idx_end_date` (`end_date`),
  KEY `idx_lot_id` (`lot_id`),
  CONSTRAINT `expiration_records_ibfk_1` FOREIGN KEY (`lot_id`) REFERENCES `lots` (`lot_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `lot_types`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lot_types` (
  `type_id` int NOT NULL AUTO_INCREMENT,
  `type_name` varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`type_id`),
  UNIQUE KEY `type_name` (`type_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `lots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `lots` (
  `lot_id` int NOT NULL AUTO_INCREMENT,
  `block_id` int NOT NULL,
  `lot_number` varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
  `lot_type_id` int NOT NULL,
  `status` enum('Available','Reserved','Occupied','Expired') COLLATE utf8mb4_general_ci DEFAULT 'Available',
  `price` decimal(12,2) NOT NULL,
  `dimensions` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `location_notes` text COLLATE utf8mb4_general_ci,
  `lease_start_date` date DEFAULT NULL,
  `lease_end_date` date DEFAULT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`lot_id`),
  UNIQUE KEY `block_id` (`block_id`,`lot_number`),
  KEY `lot_type_id` (`lot_type_id`),
  CONSTRAINT `lots_ibfk_1` FOREIGN KEY (`block_id`) REFERENCES `blocks` (`block_id`) ON DELETE CASCADE,
  CONSTRAINT `lots_ibfk_2` FOREIGN KEY (`lot_type_id`) REFERENCES `lot_types` (`type_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `notifications`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `notifications` (
  `notification_id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `message` text COLLATE utf8mb4_general_ci NOT NULL,
  `notification_type` enum('Expiration','Schedule','Relocation','Payment','System','Cremation') CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'System',
  `user_id` int DEFAULT NULL,
  `is_read` tinyint(1) NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`notification_id`),
  KEY `idx_notification_type` (`notification_type`),
  KEY `idx_is_read` (`is_read`),
  KEY `idx_user_id` (`user_id`),
  CONSTRAINT `fk_notification_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`user_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `occupancy_snapshots`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `occupancy_snapshots` (
  `snapshot_id` int NOT NULL AUTO_INCREMENT,
  `snapshot_date` date NOT NULL,
  `section_id` int NOT NULL,
  `total` int NOT NULL DEFAULT '0',
  `occupied` int NOT NULL DEFAULT '0',
  `available` int NOT NULL DEFAULT '0',
  `reserved` int NOT NULL DEFAULT '0',
  `expired` int NOT NULL DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`snapshot_id`),
  UNIQUE KEY `uq_snapshot_date_section` (`snapshot_date`,`section_id`),
  KEY `idx_snapshot_date` (`snapshot_date`),
  KEY `occupancy_snapshots_ibfk_1` (`section_id`),
  CONSTRAINT `occupancy_snapshots_ibfk_1` FOREIGN KEY (`section_id`) REFERENCES `sections` (`section_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `payments`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `payments` (
  `payment_id` int NOT NULL AUTO_INCREMENT,
  `transaction_type` enum('Lot Purchase','Cremation','Relocation','Renewal','Other') COLLATE utf8mb4_general_ci NOT NULL,
  `reference_id` int DEFAULT NULL,
  `reference_kind` enum('schedule','lot') COLLATE utf8mb4_general_ci DEFAULT NULL,
  `amount` decimal(12,2) NOT NULL,
  `payment_date` date NOT NULL,
  `payment_method` varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
  `receipt_number` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `notes` text COLLATE utf8mb4_general_ci,
  `received_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  `receipt_url` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `verification_status` enum('Pending','Verified','Rejected') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'Pending',
  `verified_by` int DEFAULT NULL,
  `verified_at` datetime DEFAULT NULL,
  PRIMARY KEY (`payment_id`),
  UNIQUE KEY `uq_payment_receipt_number` (`receipt_number`),
  KEY `idx_payment_date` (`payment_date`),
  KEY `fk_payment_received_by` (`received_by`),
  KEY `fk_payment_verified_by` (`verified_by`),
  KEY `idx_payment_reference` (`reference_kind`,`reference_id`),
  CONSTRAINT `fk_payment_received_by` FOREIGN KEY (`received_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL,
  CONSTRAINT `fk_payment_verified_by` FOREIGN KEY (`verified_by`) REFERENCES `users` (`user_id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `relocation_requests`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `relocation_requests` (
  `request_id` int NOT NULL AUTO_INCREMENT,
  `from_lot_id` int NOT NULL,
  `to_lot_id` int NOT NULL,
  `deceased_id` int NOT NULL,
  `reason` text COLLATE utf8mb4_general_ci NOT NULL,
  `status` enum('Pending','Approved','Completed','Denied') COLLATE utf8mb4_general_ci DEFAULT 'Pending',
  `requested_by` int NOT NULL,
  `approved_by` int DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
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
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `roles`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `roles` (
  `role_id` int NOT NULL AUTO_INCREMENT,
  `title` varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`role_id`),
  UNIQUE KEY `title` (`title`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `schema_migrations`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `schema_migrations` (
  `migration` varchar(150) COLLATE utf8mb4_general_ci NOT NULL,
  `applied_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`migration`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `sections`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `sections` (
  `section_id` int NOT NULL AUTO_INCREMENT,
  `section_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `description` text COLLATE utf8mb4_general_ci,
  `total_blocks` int DEFAULT '0',
  `total_lots` int DEFAULT '0',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`section_id`),
  UNIQUE KEY `section_name` (`section_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `system_exceptions`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `system_exceptions` (
  `exception_id` int NOT NULL AUTO_INCREMENT,
  `event` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `entity_type` varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
  `entity_id` int NOT NULL,
  `reason` text COLLATE utf8mb4_general_ci NOT NULL,
  `severity` enum('info','warning','critical') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'warning',
  `status` enum('open','resolved') COLLATE utf8mb4_general_ci NOT NULL DEFAULT 'open',
  `context` text COLLATE utf8mb4_general_ci,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `resolved_by` int DEFAULT NULL,
  `resolved_at` timestamp NULL DEFAULT NULL,
  `resolution_notes` text COLLATE utf8mb4_general_ci,
  PRIMARY KEY (`exception_id`),
  KEY `idx_status` (`status`),
  KEY `idx_entity` (`entity_type`,`entity_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
DROP TABLE IF EXISTS `users`;
/*!40101 SET @saved_cs_client     = @@character_set_client */;
/*!50503 SET character_set_client = utf8mb4 */;
CREATE TABLE `users` (
  `user_id` int NOT NULL AUTO_INCREMENT,
  `username` varchar(50) COLLATE utf8mb4_general_ci NOT NULL,
  `password_hash` varchar(255) COLLATE utf8mb4_general_ci NOT NULL,
  `reset_token_hash` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `reset_token_expires_at` datetime DEFAULT NULL,
  `full_name` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `email` varchar(100) COLLATE utf8mb4_general_ci NOT NULL,
  `contact_number` varchar(50) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `address` varchar(255) COLLATE utf8mb4_general_ci DEFAULT NULL,
  `role_id` int NOT NULL,
  `is_active` tinyint(1) DEFAULT '1',
  `last_login` datetime DEFAULT NULL,
  `session_version` int NOT NULL DEFAULT '1',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`user_id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `email` (`email`),
  KEY `role_id` (`role_id`),
  CONSTRAINT `users_ibfk_1` FOREIGN KEY (`role_id`) REFERENCES `roles` (`role_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
/*!40101 SET character_set_client = @saved_cs_client */;
/*!40103 SET TIME_ZONE=@OLD_TIME_ZONE */;

/*!40101 SET SQL_MODE=@OLD_SQL_MODE */;
/*!40014 SET FOREIGN_KEY_CHECKS=@OLD_FOREIGN_KEY_CHECKS */;
/*!40014 SET UNIQUE_CHECKS=@OLD_UNIQUE_CHECKS */;
/*!40101 SET CHARACTER_SET_CLIENT=@OLD_CHARACTER_SET_CLIENT */;
/*!40101 SET CHARACTER_SET_RESULTS=@OLD_CHARACTER_SET_RESULTS */;
/*!40101 SET COLLATION_CONNECTION=@OLD_COLLATION_CONNECTION */;
/*!40111 SET SQL_NOTES=@OLD_SQL_NOTES */;

