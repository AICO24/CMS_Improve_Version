-- Migration: Seed and Synchronize John Eric Citizen and Staff Accounts
-- Ensures johneric0303 (Citizen) and staff_johneric (Staff) exist across all environments.

INSERT INTO `users` (
    `username`, `password_hash`, `full_name`, `email`, `contact_number`, `address`, `role_id`, `is_active`, `email_verified`, `session_version`
) VALUES (
    'johneric0303',
    '$2y$10$qv7Zl9.Lk4uXsAGQCLQG1uf2fNDStliUtG6xLGR3GoQhE0TkJpg.y',
    'John Eric Gabayan',
    'gabayanjohneric@gmail.com',
    '09123456789',
    'Philippines',
    3,
    1,
    1,
    1
)
ON DUPLICATE KEY UPDATE
    `password_hash` = VALUES(`password_hash`),
    `full_name` = VALUES(`full_name`),
    `email` = VALUES(`email`),
    `contact_number` = VALUES(`contact_number`),
    `address` = VALUES(`address`),
    `role_id` = VALUES(`role_id`),
    `is_active` = 1,
    `email_verified` = 1;

INSERT INTO `users` (
    `username`, `password_hash`, `full_name`, `email`, `contact_number`, `address`, `role_id`, `is_active`, `email_verified`, `session_version`
) VALUES (
    'staff_johneric',
    '$2y$10$L7.u/eIHDWDDvW5OUyHGoOBUKgjKAcbuepbIvbnbsh3ZVQrhALRPm',
    'John Eric Staff',
    'staff_johneric@cemetery.local',
    '+639171234567',
    'Cemetery Administration Office',
    2,
    1,
    1,
    1
)
ON DUPLICATE KEY UPDATE
    `password_hash` = VALUES(`password_hash`),
    `full_name` = VALUES(`full_name`),
    `email` = VALUES(`email`),
    `contact_number` = VALUES(`contact_number`),
    `address` = VALUES(`address`),
    `role_id` = VALUES(`role_id`),
    `is_active` = 1,
    `email_verified` = 1;
