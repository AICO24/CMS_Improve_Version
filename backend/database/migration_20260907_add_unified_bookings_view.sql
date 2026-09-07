-- Migration: creates v_unified_bookings view (BMS-9: Draft Resumption + Unified Booking History).
--
-- Provides a centralized database-level single source of truth for unified bookings,
-- aggregating official burial schedules, official cremation records, and active booking drafts.
--
-- Idempotent: uses CREATE OR REPLACE VIEW and registers in schema_migrations.
-- Explicit COLLATE utf8mb4_general_ci prevents MySQL 1271 "Illegal mix of collations" during UNION.

CREATE OR REPLACE VIEW v_unified_bookings AS
SELECT 
    CAST('schedule' AS CHAR(20)) COLLATE utf8mb4_general_ci AS source_kind,
    s.schedule_id AS source_id,
    s.created_by AS user_id,
    CAST('burial' AS CHAR(20)) COLLATE utf8mb4_general_ci AS service_type,
    CAST(CONCAT('BUR-', s.schedule_id) AS CHAR(50)) COLLATE utf8mb4_general_ci AS booking_reference,
    CAST(COALESCE(
        NULLIF(TRIM(CONCAT(COALESCE(d.first_name, ''), ' ', COALESCE(d.last_name, ''))), ''),
        dr.full_name,
        'Pending Formal Record'
    ) AS CHAR(255)) COLLATE utf8mb4_general_ci AS decedent_name,
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
    CAST(COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.decedent_name')), 'null'),
        'Pending Information'
    ) AS CHAR(255)) COLLATE utf8mb4_general_ci AS decedent_name,
    CAST(COALESCE(
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.preferred_date')), 'null'),
        NULLIF(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.cremation_date')), 'null')
    ) AS CHAR(50)) COLLATE utf8mb4_general_ci AS booking_date,
    CAST(CASE 
        WHEN bd.service_type = 'burial' AND JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.lot_id')) IS NOT NULL 
            THEN CONCAT('Selected Lot #', JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.lot_id')))
        WHEN bd.service_type = 'cremation' AND JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.preferred_columbarium')) IS NOT NULL 
            THEN CONCAT(JSON_UNQUOTE(JSON_EXTRACT(bd.extracted_data, '$.preferred_columbarium')), ' (Preferred)')
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

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260907_add_unified_bookings_view.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
