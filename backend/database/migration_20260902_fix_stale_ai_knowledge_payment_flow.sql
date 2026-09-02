-- Migration: corrects two ai_knowledge entries seeded by
-- migration_20260819_add_ai_knowledge.sql ('payment_process', 'after_booking')
-- that described the PRE-automation flow ("an administrator or staff member
-- reviews and approves" the booking itself). That's no longer how the system
-- works — PaymentController::autoConfirmScheduleForVerifiedPurchase()
-- confirms the booking automatically the instant its payment is verified;
-- there is no separate booking-approval step. Left uncorrected, the chat
-- assistant would keep telling citizens something untrue about their own
-- booking status.
--
-- Unlike the original PLACEHOLDER seed content, this is written directly
-- from the rules the code actually enforces (same convention already used
-- for 'booking_lead_time' in the original migration) — not a guess for the
-- admin to fill in, though still worth a read-through.
-- Run this once against the application database.

UPDATE `ai_knowledge`
SET `content` = 'After a reservation is submitted it stays Pending. Submit payment (Cash, GCash, Bank Transfer, PayMaya, or Other) with proof on the Payments page — see the payment_instructions topic for where to send an online payment. Staff review and verify each submitted payment; this is the only manual step in the process. The moment a payment is verified, the reservation is automatically confirmed — there is no separate booking-approval step.'
WHERE `topic` = 'payment_process';

UPDATE `ai_knowledge`
SET `content` = 'Once you submit a booking, it stays Pending until you submit payment and staff verify it — the reservation is then automatically confirmed, with no separate approval step required. You can check your reservation''s status anytime from My Reservations. On the day of the burial, staff marks the reservation Completed.'
WHERE `topic` = 'after_booking';

INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260902_fix_stale_ai_knowledge_payment_flow.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
