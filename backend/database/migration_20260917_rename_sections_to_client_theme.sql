-- ========================================================
-- Migration: Rename generic cemetery sections to Everlasting Peace Memorial Park (Malabon) client theme
-- Date: 2026-09-17
-- Client: Everlasting Peace Memorial Park & Crematorium, Malabon
-- ========================================================

UPDATE `sections` 
SET `section_name` = 'Garden of Everlasting Peace', 
    `description` = 'Flagship standard lawn burial grounds (Double-tier plots)' 
WHERE `section_id` = 1 OR `section_name` = 'Section A';

UPDATE `sections` 
SET `section_name` = 'Garden of Our Lady of Lourdes', 
    `description` = 'Perimeter garden plots with raised marble markers' 
WHERE `section_id` = 2 OR `section_name` = 'Section B';

UPDATE `sections` 
SET `section_name` = 'Sanctuario de San Jose', 
    `description` = 'Exclusive family estate & private mausoleum plots' 
WHERE `section_id` = 3 OR `section_name` = 'Section C';

-- Ensure Section 4 exists for Everlasting Columbarium & Ossuary
INSERT INTO `sections` (`section_id`, `section_name`, `description`, `total_blocks`, `total_lots`)
VALUES (4, 'Everlasting Columbarium & Ossuary', 'Dedicated cremation vaults & indoor urn niches', 1, 10)
ON DUPLICATE KEY UPDATE 
    `section_name` = 'Everlasting Columbarium & Ossuary',
    `description` = 'Dedicated cremation vaults & indoor urn niches';

-- Update block descriptions for clarity
UPDATE `blocks` SET `description` = 'Garden of Everlasting Peace, Block 1' WHERE `block_id` = 1;
UPDATE `blocks` SET `description` = 'Garden of Everlasting Peace, Block 2' WHERE `block_id` = 2;
UPDATE `blocks` SET `description` = 'Garden of Our Lady of Lourdes, Block 1' WHERE `block_id` = 3;
UPDATE `blocks` SET `description` = 'Garden of Our Lady of Lourdes, Block 2' WHERE `block_id` = 4;
UPDATE `blocks` SET `description` = 'Sanctuario de San Jose, Block 1' WHERE `block_id` = 5;
UPDATE `blocks` SET `description` = 'Sanctuario de San Jose, Block 2' WHERE `block_id` = 6;
