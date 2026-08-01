-- Migration: Add contact_number and address to users, ensure User role exists
-- Run this once against the application database.

ALTER TABLE `users`
  ADD COLUMN `contact_number` VARCHAR(50) DEFAULT NULL AFTER `email`,
  ADD COLUMN `address` VARCHAR(255) DEFAULT NULL AFTER `contact_number`;

-- Ensure 'User' role exists (insert if missing)
INSERT INTO roles (title, description)
SELECT 'User', 'General user role'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM roles WHERE LOWER(title) = 'user');

-- Optional: verify
SELECT 'migration_completed' AS status;
