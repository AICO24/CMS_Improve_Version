-- Migration: Add receipt upload and payment verification support to payments
-- Run this against the CMS database before deploying the updated backend code.

ALTER TABLE payments
    ADD COLUMN receipt_url varchar(255) DEFAULT NULL;

ALTER TABLE payments
    ADD COLUMN verification_status enum('Pending','Verified','Rejected') NOT NULL DEFAULT 'Pending';

ALTER TABLE payments
    ADD COLUMN verified_by int(11) DEFAULT NULL;

ALTER TABLE payments
    ADD COLUMN verified_at datetime DEFAULT NULL;

CREATE INDEX idx_payment_verification_status ON payments (verification_status);
CREATE INDEX idx_payment_verified_by ON payments (verified_by);
