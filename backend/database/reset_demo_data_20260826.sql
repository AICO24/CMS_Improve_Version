-- Clean-slate demo data reset (2026-08-26).
-- Wipes every module's transactional/catalog data EXCEPT users, roles,
-- lot_types, ai_knowledge, ai_parameters, so the automation built across
-- the "Full Automation" sessions is demonstrable against a clean, realistic
-- dataset instead of buried under accumulated QA test artifacts.
--
-- Run once against the application database. A full mysqldump backup was
-- taken first (backend/database/backup_pre_reset_20260826.sql).
--
-- Deletion order respects FK constraints (see schema.sql): tables with no
-- FK reference to entities (system_exceptions/audit_logs/notifications/
-- capacity_alerts/payments/decedent_requests) go first, then the tables
-- that reference lots/decedents (in dependency order), then lots/blocks/
-- sections themselves.

-- ============================================================
-- STEP 1: DELETE existing module data
-- ============================================================
DELETE FROM system_exceptions;
ALTER TABLE system_exceptions AUTO_INCREMENT = 1;

DELETE FROM audit_logs;
ALTER TABLE audit_logs AUTO_INCREMENT = 1;

DELETE FROM notifications;
ALTER TABLE notifications AUTO_INCREMENT = 1;

DELETE FROM capacity_alerts;
ALTER TABLE capacity_alerts AUTO_INCREMENT = 1;

DELETE FROM payments;
ALTER TABLE payments AUTO_INCREMENT = 1;

-- burial_schedules.decedent_request_id has an FK to decedent_requests
-- (migration_20260824_add_automation_and_provisional_booking.sql, not in
-- the base schema.sql) — must delete burial_schedules BEFORE
-- decedent_requests, the reverse of this file's original ordering.
DELETE FROM burial_schedules;
ALTER TABLE burial_schedules AUTO_INCREMENT = 1;

DELETE FROM decedent_requests;
ALTER TABLE decedent_requests AUTO_INCREMENT = 1;

DELETE FROM cremation_records;
ALTER TABLE cremation_records AUTO_INCREMENT = 1;

DELETE FROM relocation_requests;
ALTER TABLE relocation_requests AUTO_INCREMENT = 1;

DELETE FROM expiration_records;
ALTER TABLE expiration_records AUTO_INCREMENT = 1;

DELETE FROM decedent_records;
ALTER TABLE decedent_records AUTO_INCREMENT = 1;

-- occupancy_snapshots.section_id FKs to sections ON DELETE CASCADE
-- (migration_20260808_add_occupancy_snapshots.sql) — would cascade
-- automatically when sections is cleared below, but deleted explicitly
-- here too so its AUTO_INCREMENT also resets cleanly.
DELETE FROM occupancy_snapshots;
ALTER TABLE occupancy_snapshots AUTO_INCREMENT = 1;

DELETE FROM lots;
ALTER TABLE lots AUTO_INCREMENT = 1;

DELETE FROM blocks;
ALTER TABLE blocks AUTO_INCREMENT = 1;

DELETE FROM sections;
ALTER TABLE sections AUTO_INCREMENT = 1;

-- ============================================================
-- STEP 2: Rebuild a clean lot catalog
-- 3 sections x 2 blocks x 5 lots = 30 lots, one lot_type per section
-- (matches the 3 existing lot_types rows so the pairing makes sense).
-- ============================================================
INSERT INTO sections (section_name, description, total_blocks, total_lots) VALUES
    ('Section A', 'Lawn burial section', 2, 10),
    ('Section B', 'Garden burial section', 2, 10),
    ('Section C', 'Premium burial section', 2, 10);

INSERT INTO blocks (section_id, block_name, description, total_lots) VALUES
    (1, 'Block A1', 'Section A, Block 1', 5),
    (1, 'Block A2', 'Section A, Block 2', 5),
    (2, 'Block B1', 'Section B, Block 1', 5),
    (2, 'Block B2', 'Section B, Block 2', 5),
    (3, 'Block C1', 'Section C, Block 1', 5),
    (3, 'Block C2', 'Section C, Block 2', 5);

-- Block A1 (lot_id 1-5, Lawn Lot, block_id 1)
INSERT INTO lots (block_id, lot_number, lot_type_id, status, price) VALUES
    (1, 'A1-01', 1, 'Available', 1500.00),
    (1, 'A1-02', 1, 'Available', 1500.00),
    (1, 'A1-03', 1, 'Available', 1500.00),
    (1, 'A1-04', 1, 'Available', 1500.00),
    (1, 'A1-05', 1, 'Available', 1500.00);
-- Block A2 (lot_id 6-10, Lawn Lot, block_id 2)
INSERT INTO lots (block_id, lot_number, lot_type_id, status, price) VALUES
    (2, 'A2-01', 1, 'Available', 1500.00),
    (2, 'A2-02', 1, 'Available', 1500.00),
    (2, 'A2-03', 1, 'Available', 1500.00),
    (2, 'A2-04', 1, 'Available', 1500.00),
    (2, 'A2-05', 1, 'Available', 1500.00);
-- Block B1 (lot_id 11-15, Garden Lot, block_id 3)
INSERT INTO lots (block_id, lot_number, lot_type_id, status, price) VALUES
    (3, 'B1-01', 2, 'Available', 2500.00),
    (3, 'B1-02', 2, 'Available', 2500.00),
    (3, 'B1-03', 2, 'Available', 2500.00),
    (3, 'B1-04', 2, 'Available', 2500.00),
    (3, 'B1-05', 2, 'Available', 2500.00);
-- Block B2 (lot_id 16-20, Garden Lot, block_id 4)
INSERT INTO lots (block_id, lot_number, lot_type_id, status, price) VALUES
    (4, 'B2-01', 2, 'Available', 2500.00),
    (4, 'B2-02', 2, 'Available', 2500.00),
    (4, 'B2-03', 2, 'Available', 2500.00),
    (4, 'B2-04', 2, 'Available', 2500.00),
    (4, 'B2-05', 2, 'Available', 2500.00);
-- Block C1 (lot_id 21-25, Premium Lot, block_id 5)
INSERT INTO lots (block_id, lot_number, lot_type_id, status, price) VALUES
    (5, 'C1-01', 3, 'Available', 4000.00),
    (5, 'C1-02', 3, 'Available', 4000.00),
    (5, 'C1-03', 3, 'Available', 4000.00),
    (5, 'C1-04', 3, 'Available', 4000.00),
    (5, 'C1-05', 3, 'Available', 4000.00);
-- Block C2 (lot_id 26-30, Premium Lot, block_id 6)
INSERT INTO lots (block_id, lot_number, lot_type_id, status, price) VALUES
    (6, 'C2-01', 3, 'Available', 4000.00),
    (6, 'C2-02', 3, 'Available', 4000.00),
    (6, 'C2-03', 3, 'Available', 4000.00),
    (6, 'C2-04', 3, 'Available', 4000.00),
    (6, 'C2-05', 3, 'Available', 4000.00);

-- Flip the 8 lots that will hold pre-existing (already-buried, predate the
-- automated system) decedents to Occupied. Lots 1,2,3,4 (Section A) and
-- 11,12 (Section B) are plain burials; 21,22 (Section C, Premium) are the
-- two pre-existing cremation cases below.
UPDATE lots SET status = 'Occupied' WHERE lot_id IN (1, 2, 3, 4, 11, 12, 21, 22);

-- ============================================================
-- STEP 3: Seed decedent records (plain CRUD, nothing to automate here)
-- decedents 1-6: already-buried, predate the automated system
-- decedents 7-8: already cremated (paired cremation_records below)
-- decedent 9: NOT cremated yet, no burial lot in use — this is the one
--   Step 4 sends through the real /cremations/assign flow to demonstrate
--   live auto-niche-assignment, so it deliberately has no cremation_records
--   row here.
-- ============================================================
INSERT INTO decedent_records
    (lot_id, first_name, last_name, middle_name, dob, dod, cause_of_death, contact_name, contact_number, is_cremated, ash_storage)
VALUES
    (1,  'Ricardo',  'Santos',    'Bautista', '1948-03-12', '2021-08-20', 'Natural causes',      'Maria Santos',    '09171234501', 'no', NULL),
    (2,  'Corazon',  'Reyes',     'Villamor', '1952-07-05', '2022-01-15', 'Cardiac arrest',       'Jose Reyes Jr.',  '09171234502', 'no', NULL),
    (3,  'Eduardo',  'Cruz',      'Manalo',   '1945-11-30', '2020-05-02', 'Pneumonia',            'Ana Cruz',        '09171234503', 'no', NULL),
    (4,  'Lourdes',  'Garcia',    'Ocampo',   '1958-02-18', '2023-03-11', 'Natural causes',       'Ramon Garcia',    '09171234504', 'no', NULL),
    (11, 'Fernando', 'Torres',    'Aquino',   '1950-09-09', '2022-11-04', 'Stroke',               'Elena Torres',    '09171234505', 'no', NULL),
    (12, 'Remedios', 'Flores',    'Salazar',  '1949-04-22', '2021-12-19', 'Diabetes complications','Pablo Flores',   '09171234506', 'no', NULL),
    (21, 'Antonio',  'Mendoza',   'Ramirez',  '1955-06-14', '2023-07-08', 'Cancer',               'Sofia Mendoza',   '09171234507', 'yes', 'N-1'),
    (22, 'Teresita', 'Del Rosario','Aguilar', '1960-01-27', '2023-09-23', 'Natural causes',       'Carlos Del Rosario','09171234508', 'yes', 'N-2'),
    (23, 'Manuel',   'Villanueva','Pascual',  '1962-05-19', '2026-08-24', 'Respiratory failure',  'Grace Villanueva','09171234509', 'no', NULL);

-- The 2 pre-existing cremation cases (decedents 7 and 8 = decedent_id 7, 8)
INSERT INTO cremation_records
    (deceased_id, niche_number, columbarium, level, cremation_date, status, ash_storage_location, created_by)
VALUES
    (7, 'N-1', 'Columbarium A', 1, '2023-07-12', 'Completed', 'N-1', 1),
    (8, 'N-2', 'Columbarium A', 1, '2023-09-27', 'Completed', 'N-2', 1);

-- ============================================================
-- STEP 4 (NOT in this file — run live against the API instead):
-- 6 automation-demo scenarios, driven through the real endpoints so their
-- audit trail/exception rows are genuine, not faked:
--   1. Provisional booking (lot 5) -> paid -> admin-verified -> auto-Confirmed
--   2. Provisional booking (lot 6) left unpaid/Pending
--   3. Provisional booking (lot 7) -> paid -> lot forced Occupied mid-flight
--      -> verify raises a real open system_exceptions row
--   4. POST /relocations (deceased_id 2, lot 2 -> lot 13) -> auto-Approved
--   5. POST /cremations (deceased_id 9, status Completed, no niche_number)
--      -> auto-assigned niche N-3
--   6. POST /decedent-requests, standalone, left pending
-- ============================================================

-- ============================================================
-- STEP 5: near-term expiring leases (5 and 20 days from 2026-08-26), so
-- Expiration Monitoring and the AI dashboard digest have real "Expiring"
-- content instead of the 5-years-out dates a normal burial completion
-- would generate.
-- ============================================================
INSERT INTO expiration_records (lot_id, start_date, end_date, renewed, exhumation_status, notes) VALUES
    (1,  '2021-08-31', '2026-08-31', 'no', 'Not Required', 'Lawn Lot lease nearing 5-year term.'),
    (11, '2021-09-15', '2026-09-15', 'no', 'Not Required', 'Garden Lot lease nearing 5-year term.');
