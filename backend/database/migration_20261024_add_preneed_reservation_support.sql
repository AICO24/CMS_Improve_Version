-- ============================================================================
-- Migration: Add Pre-Need Lot Reservation & Certificate of Ownership Support
-- Date: 2026-10-24
-- Scope: Batch 1 - Schema foundation for advance lot purchases (pre-need),
--        allowing citizens to reserve plots ahead of time without requiring
--        death documentation or immediate burial dates.
--
-- Non-destructive & Idempotent
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Step 1: Add pre-need columns to `burial_schedules`
-- ----------------------------------------------------------------------------
SET @col_is_preneed = (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'burial_schedules' 
      AND COLUMN_NAME = 'is_preneed'
);
SET @sql_is_preneed = IF(@col_is_preneed = 0, 
    'ALTER TABLE `burial_schedules` ADD COLUMN `is_preneed` tinyint(1) NOT NULL DEFAULT 0 COMMENT \'0=At-Need Burial, 1=Advance Pre-Need Lot Reservation\' AFTER `decedent_request_id`', 
    'SELECT "is_preneed column already exists" AS msg'
);
PREPARE stmt_pn FROM @sql_is_preneed;
EXECUTE stmt_pn;
DEALLOCATE PREPARE stmt_pn;

SET @col_beneficiary = (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'burial_schedules' 
      AND COLUMN_NAME = 'beneficiary_name'
);
SET @sql_beneficiary = IF(@col_beneficiary = 0, 
    'ALTER TABLE `burial_schedules` ADD COLUMN `beneficiary_name` varchar(150) NULL DEFAULT NULL COMMENT \'Designated future beneficiary or family member if pre-need\' AFTER `is_preneed`', 
    'SELECT "beneficiary_name column already exists" AS msg'
);
PREPARE stmt_ben FROM @sql_beneficiary;
EXECUTE stmt_ben;
DEALLOCATE PREPARE stmt_ben;

SET @col_cert_num = (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'burial_schedules' 
      AND COLUMN_NAME = 'certificate_number'
);
SET @sql_cert_num = IF(@col_cert_num = 0, 
    'ALTER TABLE `burial_schedules` ADD COLUMN `certificate_number` varchar(64) NULL DEFAULT NULL COMMENT \'Official Certificate of Lot Ownership number for pre-need\' AFTER `beneficiary_name`', 
    'SELECT "certificate_number column already exists" AS msg'
);
PREPARE stmt_cn FROM @sql_cert_num;
EXECUTE stmt_cn;
DEALLOCATE PREPARE stmt_cn;

SET @col_cert_date = (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'burial_schedules' 
      AND COLUMN_NAME = 'certificate_issued_at'
);
SET @sql_cert_date = IF(@col_cert_date = 0, 
    'ALTER TABLE `burial_schedules` ADD COLUMN `certificate_issued_at` datetime NULL DEFAULT NULL COMMENT \'Timestamp when lot ownership certificate was generated\' AFTER `certificate_number`', 
    'SELECT "certificate_issued_at column already exists" AS msg'
);
PREPARE stmt_cd FROM @sql_cert_date;
EXECUTE stmt_cd;
DEALLOCATE PREPARE stmt_cd;

SET @col_cert_hash = (
    SELECT COUNT(*) FROM information_schema.COLUMNS 
    WHERE TABLE_SCHEMA = DATABASE() 
      AND TABLE_NAME = 'burial_schedules' 
      AND COLUMN_NAME = 'certificate_hash'
);
SET @sql_cert_hash = IF(@col_cert_hash = 0, 
    'ALTER TABLE `burial_schedules` ADD COLUMN `certificate_hash` varchar(64) NULL DEFAULT NULL COMMENT \'Cryptographic SHA-256 validation hash for certificate verification\' AFTER `certificate_issued_at`', 
    'SELECT "certificate_hash column already exists" AS msg'
);
PREPARE stmt_ch FROM @sql_cert_hash;
EXECUTE stmt_ch;
DEALLOCATE PREPARE stmt_ch;

-- Indexes on `burial_schedules`
SET @idx_preneed = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'burial_schedules'
      AND INDEX_NAME = 'idx_schedule_is_preneed'
);
SET @sql_idx_pn = IF(@idx_preneed = 0,
    'ALTER TABLE `burial_schedules` ADD KEY `idx_schedule_is_preneed` (`is_preneed`, `status`)',
    'SELECT "idx_schedule_is_preneed already exists" AS msg'
);
PREPARE stmt_ipn FROM @sql_idx_pn;
EXECUTE stmt_ipn;
DEALLOCATE PREPARE stmt_ipn;

SET @idx_cert_num = (
    SELECT COUNT(*) FROM information_schema.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'burial_schedules'
      AND INDEX_NAME = 'uq_schedule_certificate_number'
);
SET @sql_idx_cn = IF(@idx_cert_num = 0,
    'ALTER TABLE `burial_schedules` ADD UNIQUE KEY `uq_schedule_certificate_number` (`certificate_number`)',
    'SELECT "uq_schedule_certificate_number already exists" AS msg'
);
PREPARE stmt_icn FROM @sql_idx_cn;
EXECUTE stmt_icn;
DEALLOCATE PREPARE stmt_icn;

-- ----------------------------------------------------------------------------
-- Step 2: Extend `booking_drafts`.`service_type` enum to include 'preneed'
-- ----------------------------------------------------------------------------
ALTER TABLE `booking_drafts` 
MODIFY COLUMN `service_type` enum('burial','cremation','preneed') COLLATE utf8mb4_general_ci NOT NULL;

-- ----------------------------------------------------------------------------
-- Step 3: Update `v_unified_bookings` view to support pre-need records & drafts
-- ----------------------------------------------------------------------------
CREATE OR REPLACE VIEW v_unified_bookings AS
SELECT 
    CAST('schedule' AS CHAR(20)) COLLATE utf8mb4_general_ci AS source_kind,
    s.schedule_id AS source_id,
    s.created_by AS user_id,
    CAST(CASE WHEN s.is_preneed = 1 THEN 'preneed' ELSE 'burial' END AS CHAR(20)) COLLATE utf8mb4_general_ci AS service_type,
    CAST(CASE WHEN s.is_preneed = 1 THEN CONCAT('PN-', s.schedule_id) ELSE CONCAT('BUR-', s.schedule_id) END AS CHAR(50)) COLLATE utf8mb4_general_ci AS booking_reference,
    CAST(CASE 
        WHEN s.is_preneed = 1 THEN CONCAT('[Pre-Need] ', COALESCE(s.beneficiary_name, 'Reserved Owner'))
        ELSE COALESCE(
            NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), ''),
            dr.full_name,
            'Pending Formal Record'
        )
    END AS CHAR(255)) COLLATE utf8mb4_general_ci AS decedent_name,
    CAST(s.schedule_date AS CHAR(50)) COLLATE utf8mb4_general_ci AS booking_date,
    CAST(CONCAT('Lot #', COALESCE(l.lot_number, CAST(s.lot_id AS CHAR)), ' (', COALESCE(sec.section_name, 'Section'), ', ', COALESCE(b.block_name, 'Block'), ')') AS CHAR(255)) COLLATE utf8mb4_general_ci AS allocation,
    CAST(s.status AS CHAR(50)) COLLATE utf8mb4_general_ci AS status,
    0 AS is_draft,
    CAST(NULL AS UNSIGNED) AS draft_id,
    s.created_at AS created_at,
    s.updated_at AS updated_at
FROM burial_schedules s
LEFT JOIN decedent_records d ON s.deceased_id = d.decedent_id
LEFT JOIN decedent_requests dr ON s.decedent_request_id = dr.request_id
LEFT JOIN lots l ON s.lot_id = l.lot_id
LEFT JOIN blocks b ON l.block_id = b.block_id
LEFT JOIN sections sec ON b.section_id = sec.section_id

UNION ALL

SELECT 
    CAST('cremation' AS CHAR(20)) COLLATE utf8mb4_general_ci AS source_kind,
    c.cremation_id AS source_id,
    c.created_by AS user_id,
    CAST('cremation' AS CHAR(20)) COLLATE utf8mb4_general_ci AS service_type,
    CAST(CONCAT('CREM-', c.cremation_id) AS CHAR(50)) COLLATE utf8mb4_general_ci AS booking_reference,
    CAST(COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), ''),
        dr.full_name,
        'Pending Formal Record'
    ) AS CHAR(255)) COLLATE utf8mb4_general_ci AS decedent_name,
    CAST(c.cremation_date AS CHAR(50)) COLLATE utf8mb4_general_ci AS booking_date,
    CAST(CASE 
        WHEN c.niche_number IS NOT NULL THEN CONCAT('Niche #', c.niche_number, ' (', COALESCE(c.columbarium, 'Main'), ')')
        WHEN c.columbarium IS NOT NULL THEN CONCAT(c.columbarium, ' (Pending Niche)')
        ELSE 'Auto-assign at completion'
    END AS CHAR(255)) COLLATE utf8mb4_general_ci AS allocation,
    CAST(c.status AS CHAR(50)) COLLATE utf8mb4_general_ci AS status,
    0 AS is_draft,
    CAST(NULL AS UNSIGNED) AS draft_id,
    c.created_at AS created_at,
    c.updated_at AS updated_at
FROM cremation_records c
LEFT JOIN decedent_records d ON c.deceased_id = d.decedent_id
LEFT JOIN decedent_requests dr ON c.decedent_request_id = dr.request_id

UNION ALL

SELECT 
    CAST('draft' AS CHAR(20)) COLLATE utf8mb4_general_ci AS source_kind,
    bd.draft_id AS source_id,
    bd.user_id AS user_id,
    CAST(bd.service_type AS CHAR(20)) COLLATE utf8mb4_general_ci AS service_type,
    CAST(CONCAT('DFT-', bd.draft_id) AS CHAR(50)) COLLATE utf8mb4_general_ci AS booking_reference,
    CAST(CASE 
        WHEN bd.service_type = 'preneed' THEN CONCAT('[Pre-Need] ', COALESCE(
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.beneficiary_name')), 'null'),
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.purchaser_name')), 'null'),
            'Beneficiary Pending'
        ))
        ELSE COALESCE(
            NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.decedent_name')), 'null'),
            'Pending Information'
        )
    END AS CHAR(255)) COLLATE utf8mb4_general_ci AS decedent_name,
    CAST(COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.preferred_date')), 'null'),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.cremation_date')), 'null'),
        'Advance Reservation'
    ) AS CHAR(50)) COLLATE utf8mb4_general_ci AS booking_date,
    CAST(CASE 
        WHEN bd.service_type IN ('burial', 'preneed') AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.lot_id')), 'null') IS NOT NULL 
            THEN CONCAT('Selected Lot #', NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.lot_id')), 'null'))
        WHEN bd.service_type = 'cremation' AND NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.preferred_columbarium')), 'null') IS NOT NULL 
            THEN CONCAT(NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.preferred_columbarium')), 'null'), ' (Preferred)')
        ELSE 'Pending Selection'
    END AS CHAR(255)) COLLATE utf8mb4_general_ci AS allocation,
    CAST(bd.status AS CHAR(50)) COLLATE utf8mb4_general_ci AS status,
    1 AS is_draft,
    bd.draft_id AS draft_id,
    bd.created_at AS created_at,
    bd.updated_at AS updated_at
FROM booking_drafts bd
WHERE bd.status NOT IN ('COMMITTED', 'CANCELLED', 'EXPIRED')
  AND bd.expires_at > NOW();

-- ----------------------------------------------------------------------------
-- Step 4: Register migration in `schema_migrations`
-- ----------------------------------------------------------------------------
INSERT INTO `schema_migrations` (`migration`, `applied_at`)
VALUES ('migration_20261024_add_preneed_reservation_support.sql', NOW())
ON DUPLICATE KEY UPDATE `applied_at` = NOW();

