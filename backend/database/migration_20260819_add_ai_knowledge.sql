-- Migration: add ai_knowledge, an admin/staff-editable FAQ/policy knowledge
-- base for the burial-scheduling AI's general Q&A endpoint (ai/chat). This
-- lets the assistant answer real questions ("what documents do I need?")
-- grounded in reviewable text instead of inventing an answer.
-- Seeded with placeholder content the user must review and correct before
-- treating it as real policy — booking_lead_time is the one exception,
-- worded directly from the rules ScheduleController::store() actually
-- enforces (Monday block, past-date block), so it can't drift from what the
-- system really does.
-- Run this once against the application database.

CREATE TABLE `ai_knowledge` (
  `knowledge_id` int(11) NOT NULL AUTO_INCREMENT,
  `topic` varchar(150) NOT NULL,
  `content` text NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT current_timestamp(),
  `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`knowledge_id`),
  UNIQUE KEY `uq_topic` (`topic`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

INSERT INTO `ai_knowledge` (`topic`, `content`) VALUES
('required_documents', 'PLACEHOLDER — please review and correct. To book a burial, you will typically need: the deceased''s death certificate, a valid government-issued ID of the person making the booking, and proof of relationship to the deceased if booking on behalf of family. Bring original documents plus one photocopy when you visit the cemetery office.'),
('fees_and_pricing', 'PLACEHOLDER — please review and correct. Lot prices vary by lot type and section; exact pricing is shown when you search for available lots. A reservation is marked Pending until payment and staff review are completed — see the payment_process topic for details.'),
('cancellation_policy', 'PLACEHOLDER — please review and correct. To cancel or change a pending reservation, contact the cemetery office directly; cancellations are not currently self-service through this system.'),
('booking_lead_time', 'Burials cannot be scheduled on a Monday, and the burial date must be today or a future date — the system enforces both rules automatically and will reject any other date.'),
('lot_type_differences', 'PLACEHOLDER — please review and correct. Available lot types and their current prices are shown when you search; if you are not sure which type fits your needs, ask the assistant to recommend one for you based on your budget.'),
('payment_process', 'PLACEHOLDER — please review and correct. After a reservation is submitted it is marked Pending until an administrator or staff member reviews and approves it. Payment can then be recorded against the approved reservation; see the Payments section for accepted payment methods.'),
('after_booking', 'PLACEHOLDER — please review and correct. Once you submit a booking, it stays in Pending status until an administrator or staff member reviews and approves it. You will be able to see the status of your reservation from your account.')
ON DUPLICATE KEY UPDATE topic = topic;

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260819_add_ai_knowledge.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
