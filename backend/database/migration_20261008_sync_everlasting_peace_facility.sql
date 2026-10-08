-- ============================================================================
-- Migration: Update Default Facility to Client Everlasting Peace Memorial Park
-- Date: 2026-10-08
-- Client: Everlasting Peace Memorial Park & Crematorium, Malabon
-- Address: 3 P. Aquino Avenue, Tonsuya, Malabon, Metro Manila, Philippines
-- Coordinates: 14.6633° N, 120.9608° E
-- ============================================================================

UPDATE `cemeteries`
SET 
  `cemetery_name` = 'Everlasting Peace Memorial Park & Crematorium',
  `cemetery_code` = 'EPMP_MALABON',
  `description` = 'Premier memorial park, standard lawn grounds, family estate mausoleums, and cremation sanctuary in Malabon City.',
  `address` = '3 P. Aquino Avenue, Tonsuya, Malabon, Metro Manila, Philippines',
  `contact_number` = '(02) 8288-1234',
  `map_config` = JSON_SET(
    COALESCE(`map_config`, JSON_OBJECT()),
    '$.width', 1600,
    '$.height', 1000,
    '$.viewBox', '0 0 1600 1000',
    '$.geo', JSON_OBJECT(
      'latitude', 14.6633,
      'longitude', 120.9608,
      'address', '3 P. Aquino Avenue, Tonsuya, Malabon, Metro Manila, Philippines',
      'gate_name', 'Gate 1: Main P. Aquino Entrance',
      'access_cue', 'Main Visitor Entrance & Parking along P. Aquino Avenue (Letre Road)',
      'google_maps_url', 'https://maps.google.com/maps?q=14.6633,120.9608&t=m&z=17',
      'landmarks', JSON_OBJECT(
        'gate', 'Gate 1: P. Aquino Ave Entrance',
        'office', 'Admin & Information Office',
        'parking', 'Main Visitor Parking Bay (P1)',
        'chapel', 'Memorial Chapel & Crematorium Pavilion'
      )
    )
  ),
  `is_active` = 1
WHERE `cemetery_id` = 1;

-- Also update schema_migrations tracking table
INSERT INTO `schema_migrations` (`migration`, `applied_at`)
VALUES ('migration_20261008_sync_everlasting_peace_facility.sql', NOW())
ON DUPLICATE KEY UPDATE `applied_at` = NOW();
