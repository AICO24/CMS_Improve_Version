-- Migration: Synchronize AI Business Knowledge Base for CMS
-- Updates existing placeholder knowledge topics and introduces comprehensive
-- business rules covering payment leases, columbarium rules, exhumations,
-- provisional registrations, lease terms, and off-topic guardrails.

-- 1. Update existing topics with authoritative operational content
UPDATE `ai_knowledge`
SET `content` = 'To schedule an interment or cremation, the following documents are required: 1) Death Certificate (PSA Certified True Copy or Local Civil Registrar registered copy); 2) Burial/Transfer Permit issued by the City Health Office or LGU; 3) Valid Government-Issued ID of the nearest kin or claimant; and 4) Proof of relationship (Marriage Contract, Birth Certificate, or notarized Affidavit of Kinship). Bring original documents plus one photocopy when visiting the administration office.'
WHERE `topic` = 'required_documents';

UPDATE `ai_knowledge`
SET `content` = 'We accept multiple payment methods: 1) Online checkout via PayMongo supporting Credit/Debit Cards (Visa, Mastercard), GCash, and Maya; 2) Cash payments directly at the Cemetery Administration Office Cashier (Monday to Saturday, 8:00 AM – 4:00 PM); 3) Direct bank transfer to our official municipal depository accounts. Online PayMongo transactions are verified automatically within seconds via secure webhooks.'
WHERE `topic` = 'payment_instructions';

UPDATE `ai_knowledge`
SET `content` = 'After booking submission, reservations remain in Pending status. When paying online via PayMongo, the system establishes a 1-hour active lease locking the lot or slot. The instant the online payment succeeds, our webhook verifies the payment and automatically confirms the booking. For cashier cash or bank transfer, staff manually verify the payment on the Payments page, which immediately confirms the reservation.'
WHERE `topic` = 'payment_process';

UPDATE `ai_knowledge`
SET `content` = 'Once a booking is submitted, it remains Pending until payment is completed. For online PayMongo payments (Card, GCash, Maya), confirmation is automatic upon successful payment. For cash or bank transfers, staff verify payment on the Payments page to confirm your reservation. You can track status anytime under My Bookings, and cemetery staff marks it Completed on the day of service.'
WHERE `topic` = 'after_booking';

UPDATE `ai_knowledge`
SET `content` = 'Burial and cremation fees depend on the service type and selected lot or niche. Lawn lots are categorized into Standard, Deluxe, and Premium based on section location and proximity to park amenities. Transparent pricing is displayed in the live catalog during lot selection. A reservation remains Pending until payment verification.'
WHERE `topic` = 'fees_and_pricing';

UPDATE `ai_knowledge`
SET `content` = 'To modify or cancel a pending reservation, please contact the Cemetery Administration Office directly at (02) 8123-4567 or visit during office hours (Monday to Saturday, 8:00 AM – 4:00 PM). Active reservations with confirmed payments may be rescheduled at least 24 hours in advance subject to slot availability.'
WHERE `topic` = 'cancellation_policy';

UPDATE `ai_knowledge`
SET `content` = 'We offer Lawn Lots (Standard, Deluxe, and Premium underground double-depth plots with flat marble/granite markers), private Family Estate Mausoleums, and Columbarium Niches for cremains. If you need assistance selecting the right option for your family, the booking assistant can provide recommendations based on your preferences.'
WHERE `topic` = 'lot_type_differences';

UPDATE `ai_knowledge`
SET `content` = 'We offer two primary types of services: In-ground Burial (with choice of available lawn lots or mausoleum estates) and Cremation Services (individual cremation and columbarium niche storage). Burials are scheduled Tuesday through Sunday; Mondays are strictly reserved for cemetery grounds maintenance and environmental sanitation.'
WHERE `topic` = 'services_overview';

-- 2. Insert new comprehensive business knowledge topics
INSERT INTO `ai_knowledge` (`topic`, `content`) VALUES
('payment_lease_and_deadlines', 'When you initiate an online checkout session via PayMongo, the system secures an active 1-hour lease window locking your selected lot to prevent simultaneous double-booking. If payment is completed, the lot is confirmed immediately. If unpaid after 1 hour, the session expires and the lease is automatically released for other families.'),
('columbarium_and_niche_rules', 'Our Columbarium provides indoor and covered outdoor niches with granite fronts. Standard Niches accommodate up to two (2) urns; Family Niches accommodate up to four (4) urns. Standard urn dimensions should not exceed 8 inches in diameter by 10 inches in height. Release of cremains is granted exclusively to the authorized claimant with valid government ID.'),
('exhumation_and_relocation', 'In compliance with the Sanitation Code of the Philippines (PD 856), skeletal exhumation requires a minimum interment duration of three (3) years for non-communicable deaths or five (5) years for communicable deaths. An official Exhumation Permit and Transfer Clearance must be secured from the City Health Office prior to disinterment.'),
('provisional_registration_policy', 'If the PSA or Local Civil Registrar (LCR) registered Death Certificate is delayed, a hospital-issued Certificate of Death signed by the attending physician is provisionally accepted to initiate booking. The officially registered Death Certificate and LGU Burial Permit must be submitted at least 24 hours before the scheduled interment.'),
('lease_terms_and_renewals', 'Ground lawn lot interments operate on a standard renewable 5-year lease agreement which includes perpetual park care and maintenance. Renewal notices are dispatched 90 days and 30 days prior to lease expiration, with a 60-day grace period following expiration to process renewal.'),
('off_topic_guardrail_policy', 'The AI Assistant is strictly authorized to assist with cemetery operations, burial and cremation bookings, lot recommendations, visiting hours, required documents, and payment policies. For inquiries outside cemetery services (such as programming, recipes, politics, or unrelated topics), the assistant courteously declines and refocuses on cemetery arrangements.')
ON DUPLICATE KEY UPDATE `content` = VALUES(`content`);

-- 3. Record migration in schema_migrations
INSERT INTO schema_migrations (migration) VALUES
    ('migration_20260924_sync_ai_business_knowledge.sql')
ON DUPLICATE KEY UPDATE migration = migration;

SELECT 'migration_completed' AS status;
