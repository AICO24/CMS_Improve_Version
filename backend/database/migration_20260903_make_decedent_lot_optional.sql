-- Migration: makes decedent_records.lot_id optional (Cremation Phase A).
--
-- Found while planning citizen-facing Cremation booking: lot_id was NOT
-- NULL, and Decedent::findAll()/findById()/countAll() all INNER JOIN lots —
-- so a decedent record was unreadable without a real lot_id, even for
-- someone who was only cremated and never buried. Today staff registering a
-- cremation-only person must pick a real, otherwise-unused burial lot and
-- the system marks it permanently Occupied just to satisfy this constraint
-- (confirmed in reset_demo_data_20260826.sql: two real Section C lots,
-- ₱4,000 each, consumed this way for people never actually buried there) —
-- wasting a limited, priced physical resource and skewing burial occupancy
-- reporting.
--
-- fk_decedent_lot (see schema.sql) is left untouched — it already only
-- constrains non-NULL values; NULL simply means "no lot referenced," which
-- is exactly the desired state for a cremation-only record. Existing
-- lot-linked rows are completely unaffected.
-- Run this once against the application database.

ALTER TABLE `decedent_records` MODIFY COLUMN `lot_id` int NULL;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260903_make_decedent_lot_optional.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
