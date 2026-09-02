-- Migration: adds a 'payment_instructions' ai_knowledge entry so the chat
-- assistant can answer "where do I send my GCash/bank payment?" — a real
-- gap found while discussing why online booking still requires a citizen
-- to pay first: this system has no payment gateway integration (see
-- migration_20260819_add_ai_knowledge.sql's own header for the same
-- placeholder-content convention), so "GCash"/"Bank Transfer"/"PayMaya" as
-- selectable payment methods (payments.html) were previously meaningless —
-- nothing anywhere told a citizen what account/number to actually send
-- money to before uploading their receipt as proof.
-- Seeded with PLACEHOLDER content — same convention as every other row in
-- ai_knowledge (see migration_20260819_add_ai_knowledge.sql) — admin MUST
-- review and correct via the AI Knowledge admin page before this reflects
-- the cemetery's real GCash/PayMaya number and bank account details.
-- Run this once against the application database.

INSERT INTO `ai_knowledge` (`topic`, `content`) VALUES
('payment_instructions', 'PLACEHOLDER — please review and correct with the cemetery''s real account details. This system has no payment gateway, so online payment methods are sent manually: GCash — send to 0917-000-0000 (PLACEHOLDER NAME); PayMaya — send to 0917-000-0000 (PLACEHOLDER NAME); Bank Transfer — BDO 0000-0000-0000 (PLACEHOLDER ACCOUNT NAME); Cash — pay directly at the cemetery office. After sending payment online, upload a screenshot or photo of the receipt on the Payments page — staff will review and verify it before the reservation is confirmed.')
ON DUPLICATE KEY UPDATE topic = topic;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260902_add_payment_instructions_knowledge.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
