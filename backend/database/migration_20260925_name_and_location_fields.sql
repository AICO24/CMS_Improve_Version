-- Migration: Add standardized name and cascading location hierarchy fields to users table
-- Batch 5: Name & Location Validation

ALTER TABLE users 
ADD COLUMN IF NOT EXISTS first_name VARCHAR(100) NULL AFTER full_name,
ADD COLUMN IF NOT EXISTS middle_name VARCHAR(100) NULL AFTER first_name,
ADD COLUMN IF NOT EXISTS last_name VARCHAR(100) NULL AFTER middle_name,
ADD COLUMN IF NOT EXISTS suffix VARCHAR(50) NULL AFTER last_name,
ADD COLUMN IF NOT EXISTS region VARCHAR(100) NULL AFTER address,
ADD COLUMN IF NOT EXISTS province VARCHAR(100) NULL AFTER region,
ADD COLUMN IF NOT EXISTS city VARCHAR(100) NULL AFTER province,
ADD COLUMN IF NOT EXISTS district VARCHAR(100) NULL AFTER city,
ADD COLUMN IF NOT EXISTS barangay VARCHAR(100) NULL AFTER district;
