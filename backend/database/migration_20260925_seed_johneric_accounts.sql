-- Migration: Seed and Synchronize Accounts (REMEDIATED - DB-001)
-- 
-- SECURITY REMEDIATION (Finding DB-001):
-- Hardcoded personal developer accounts ('johneric0303' and 'staff_johneric')
-- have been removed to prevent inappropriate seeding into production environments.
-- This file is preserved in source control to maintain migration sequence integrity,
-- but personal accounts are not inserted.
-- For local testing fixtures, standard seeded accounts (admin/staff/citizen) are
-- managed via tests or SEED_DEFAULT_USERS in non-production environments.

-- Inert placeholder query to ensure syntax validity if executed in migration pipelines:
SELECT 'migration_20260925_seed_johneric_accounts neutralized (DB-001)' AS status;
