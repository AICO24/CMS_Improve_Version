-- ============================================================================
-- Migration: Add Multi-Cemetery Data Foundation & Mapping Configuration
-- Date: 2026-10-07
-- Scope: Batch 1 - Multi-cemetery hierarchy (cemeteries -> sections -> blocks -> lots)
--        and minimal JSON-based map configuration foundation.
--
-- Non-destructive & Idempotent:
-- - Creates `cemeteries` table if it does not exist.
-- - Seeds a neutral, non-real baseline facility row (`cemetery_id = 1`) to preserve
--   referential integrity for existing sections without assuming or fabricating real data.
-- - Connects `sections` to `cemeteries` via foreign key `fk_sections_cemetery`.
-- - Safely backfills existing sections to point to `cemetery_id = 1`.
-- - Adds index `idx_sections_cemetery_id` on `sections(cemetery_id)`.
-- - Adds composite unique index `uq_cemetery_section_name` on `sections(cemetery_id, section_name)`.
-- - Adds minimal JSON-based `map_config` columns to `cemeteries`, `sections`, `blocks`,
--   and `lots` for future vector canvas geometry without schema bloat or hardcoded colors.
-- - Registers itself in `schema_migrations`.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Step 1: Create `cemeteries` table
-- ----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `cemeteries` (
  `cemetery_id` int NOT NULL AUTO_INCREMENT,
  `cemetery_name` varchar(150) NOT NULL,
  `cemetery_code` varchar(50) NOT NULL,
  `description` text DEFAULT NULL,
  `address` varchar(255) DEFAULT NULL,
  `contact_number` varchar(50) DEFAULT NULL,
  `map_config` json DEFAULT NULL COMMENT 'Cemetery-level map layout configuration, canvas viewBox, dimensions, and settings',
  `is_active` tinyint(1) NOT NULL DEFAULT 1,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`cemetery_id`),
  UNIQUE KEY `uq_cemetery_code` (`cemetery_code`),
  KEY `idx_cemetery_active` (`is_active`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- ----------------------------------------------------------------------------
-- Step 2: Seed neutral baseline cemetery record to preserve existing data
-- Note: Clearly designated as non-real placeholder container for existing sections.
-- ----------------------------------------------------------------------------
INSERT INTO `cemeteries` (
  `cemetery_id`,
  `cemetery_name`,
  `cemetery_code`,
  `description`,
  `address`,
  `contact_number`,
  `map_config`,
  `is_active`
) VALUES (
  1,
  'Existing Cemetery Facility',
  'DEFAULT_FACILITY',
  'Default administrative container established for existing sections and lots data preservation.',
  NULL,
  NULL,
  JSON_OBJECT('width', 1600, 'height', 1000, 'viewBox', '0 0 1600 1000'),
  1
)
ON DUPLICATE KEY UPDATE `cemetery_id` = `cemetery_id`;

-- ----------------------------------------------------------------------------
-- Step 3: Add `cemetery_id` column to `sections` (idempotent check)
-- ----------------------------------------------------------------------------
SET @col_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'sections' 
      AND COLUMN_NAME = 'cemetery_id'
);
SET @sql = IF(@col_exists = 0, 
    'ALTER TABLE `sections` ADD COLUMN `cemetery_id` int NULL AFTER `section_id`', 
    'SELECT "cemetery_id already exists" AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----------------------------------------------------------------------------
-- Step 4: Safely backfill existing sections before establishing NOT NULL / FK
-- ----------------------------------------------------------------------------
UPDATE `sections` SET `cemetery_id` = 1 WHERE `cemetery_id` IS NULL;

-- Enforce column constraint with default 1 for backward compatibility
ALTER TABLE `sections` MODIFY COLUMN `cemetery_id` int NOT NULL DEFAULT 1;

-- ----------------------------------------------------------------------------
-- Step 5: Add index and foreign key from `sections` to `cemeteries`
-- ----------------------------------------------------------------------------
SET @idx_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sections'
      AND INDEX_NAME = 'idx_sections_cemetery_id'
);
SET @sql = IF(@idx_exists = 0,
    'ALTER TABLE `sections` ADD KEY `idx_sections_cemetery_id` (`cemetery_id`)',
    'SELECT "idx_sections_cemetery_id already exists" AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

SET @fk_exists = (
    SELECT COUNT(*) FROM information_schema.TABLE_CONSTRAINTS
    WHERE CONSTRAINT_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sections'
      AND CONSTRAINT_NAME = 'fk_sections_cemetery'
);
SET @sql = IF(@fk_exists = 0,
    'ALTER TABLE `sections` ADD CONSTRAINT `fk_sections_cemetery` FOREIGN KEY (`cemetery_id`) REFERENCES `cemeteries` (`cemetery_id`) ON DELETE RESTRICT ON UPDATE CASCADE',
    'SELECT "fk_sections_cemetery already exists" AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----------------------------------------------------------------------------
-- Step 6: Update section name uniqueness to be per-cemetery (multi-cemetery support)
-- ----------------------------------------------------------------------------
SET @uq_multi_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sections'
      AND INDEX_NAME = 'uq_cemetery_section_name'
);
SET @sql = IF(@uq_multi_exists = 0,
    'ALTER TABLE `sections` ADD UNIQUE KEY `uq_cemetery_section_name` (`cemetery_id`, `section_name`)',
    'SELECT "uq_cemetery_section_name already exists" AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- Safe removal of old global single-column section_name index if composite index is active
SET @uq_old_exists = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'sections'
      AND INDEX_NAME = 'section_name'
);
SET @sql = IF(@uq_old_exists > 0,
    'ALTER TABLE `sections` DROP INDEX `section_name`',
    'SELECT "section_name unique index already dropped" AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----------------------------------------------------------------------------
-- Step 7: Add minimal `map_config` JSON columns to `sections`, `blocks`, and `lots`
-- ----------------------------------------------------------------------------
-- `sections.map_config`: section boundary geometry, SVG polygon definition, label position
SET @sec_map_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'sections' 
      AND COLUMN_NAME = 'map_config'
);
SET @sql = IF(@sec_map_exists = 0, 
    'ALTER TABLE `sections` ADD COLUMN `map_config` json DEFAULT NULL COMMENT "Section boundary geometry, SVG polygon coordinates, and label placement" AFTER `description`', 
    'SELECT "sections.map_config already exists" AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- `blocks.map_config`: block layout parameters (relative canvas bounding box, grid rows/cols)
SET @blk_map_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'blocks' 
      AND COLUMN_NAME = 'map_config'
);
SET @sql = IF(@blk_map_exists = 0, 
    'ALTER TABLE `blocks` ADD COLUMN `map_config` json DEFAULT NULL COMMENT "Block layout bounds, canvas positioning, and internal grid layout parameters" AFTER `description`', 
    'SELECT "blocks.map_config already exists" AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- `lots.map_config`: optional plot placement override (NULL defaults to procedural block grid calculation)
SET @lot_map_exists = (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'lots' 
      AND COLUMN_NAME = 'map_config'
);
SET @sql = IF(@lot_map_exists = 0, 
    'ALTER TABLE `lots` ADD COLUMN `map_config` json DEFAULT NULL COMMENT "Optional custom lot canvas placement override; NULL defaults to procedural block grid calculation" AFTER `location_notes`', 
    'SELECT "lots.map_config already exists" AS msg'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ----------------------------------------------------------------------------
-- Step 8: Register migration in schema_migrations
-- ----------------------------------------------------------------------------
INSERT INTO `schema_migrations` (`migration`) VALUES
    ('migration_20261007_cemetery_mapping_foundation.sql')
ON DUPLICATE KEY UPDATE `migration` = `migration`;

SELECT 'migration_completed' AS status;
