-- Migration: add occupancy_snapshots, a point-in-time record of lot occupancy
-- per section so historical trend charts are possible (previously occupancy
-- was only ever computed live from current lots.status, with no way to see
-- what it was N months ago). Populated automatically — see
-- ReportController::occupancy(), which upserts today's row on every call —
-- rather than by a cron job, since this project has no scheduler.
-- Run this once against the application database.

CREATE TABLE IF NOT EXISTS `occupancy_snapshots` (
    `snapshot_id` int(11) NOT NULL AUTO_INCREMENT,
    `snapshot_date` date NOT NULL,
    `section_id` int(11) NOT NULL,
    `total` int(11) NOT NULL DEFAULT 0,
    `occupied` int(11) NOT NULL DEFAULT 0,
    `available` int(11) NOT NULL DEFAULT 0,
    `reserved` int(11) NOT NULL DEFAULT 0,
    `expired` int(11) NOT NULL DEFAULT 0,
    `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
    `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
    PRIMARY KEY (`snapshot_id`),
    UNIQUE KEY `uq_snapshot_date_section` (`snapshot_date`, `section_id`),
    KEY `idx_snapshot_date` (`snapshot_date`),
    CONSTRAINT `occupancy_snapshots_ibfk_1` FOREIGN KEY (`section_id`) REFERENCES `sections` (`section_id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO schema_migrations (migration) VALUES ('migration_20260808_add_occupancy_snapshots.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
