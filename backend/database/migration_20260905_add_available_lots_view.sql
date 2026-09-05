-- Migration: creates v_available_lots view (Phase 3: Python Microservice Query Contract).
--
-- Provides a centralized database-level single source of truth for available lots,
-- joining lots with their respective block, section, and lot type names.
-- Consumed directly by python-ai/app.py (_fetch_available_lots()) to eliminate
-- duplication of lot-availability logic and table join criteria across PHP and Python.
--
-- Idempotent: uses CREATE OR REPLACE VIEW and registers in schema_migrations.

CREATE OR REPLACE VIEW v_available_lots AS
SELECT l.lot_id,
       l.block_id,
       l.lot_number,
       l.lot_type_id,
       l.status,
       l.price,
       l.dimensions,
       l.location_notes,
       l.lease_start_date,
       l.lease_end_date,
       l.is_active,
       b.block_name,
       b.section_id,
       s.section_name,
       t.type_name AS lot_type_name
FROM lots l
JOIN blocks b ON l.block_id = b.block_id
JOIN sections s ON b.section_id = s.section_id
JOIN lot_types t ON l.lot_type_id = t.type_id
WHERE l.status = 'Available';

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260905_add_available_lots_view.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;

