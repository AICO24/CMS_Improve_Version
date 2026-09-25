# Cemetery Management System (CMS) — Business Knowledge Base

**Document Version:** 1.0  
**Effective Date:** September 2026  
**System:** Cemetery Management System (CMS) — Himlayang Bayan Memorial Park  
**Target Audience:** Cemetery Administration, Staff, Citizens, and AI Assistant Knowledge Grounding  

---

## 1. General Information & Contacts

* **Facility Name:** Himlayang Bayan Memorial Park
* **Location & Address:** Himlayang Bayan Memorial Park, Main Gate Avenue, Metro Manila, Philippines
* **Administration Office:** Ground Floor, Administration Building, Main Gate Avenue
* **Visiting Hours (Cemetery Grounds):**
  * Open daily: **8:00 AM – 5:00 PM** (Monday through Sunday, including public holidays)
* **Administration Office Hours:**
  * Open **Monday through Saturday: 8:00 AM – 4:00 PM**
  * Closed on Sundays for administrative transactions (grounds remain open for visitation)
* **Official Contacts:**
  * Landline: (02) 8123-4567 / (02) 8123-4568
  * Mobile / Hotline: +63 917 123 4567
  * Email: support@himlayangbayan.ph / info@himlayangbayan.ph
  * Portal: Cemetery Management System (CMS) Citizen Portal

---

## 2. Cemetery Operations & Schedules

* **Burial Operations Days:**
  * **Tuesday through Sunday** (Operating hours: 8:00 AM – 4:00 PM).
  * **Mondays: CLOSED for burials and interments** (Mondays are strictly dedicated to cemetery-wide grounds maintenance, heavy equipment servicing, landscaping, and environmental sanitation).
* **Cremation Operations Days:**
  * **Monday through Saturday** (Operating hours: 8:00 AM – 5:00 PM).
  * Sunday cremation services are subject to emergency advance approval by administration.
* **Daily Time Slots:**
  * Morning Slots: 9:00 AM – 11:00 AM, 11:00 AM – 1:00 PM
  * Afternoon Slots: 1:00 PM – 3:00 PM, 3:00 PM – 5:00 PM
* **Lead-Time Rules:**
  * Standard burial reservations must be scheduled for today or a future date (past dates are strictly blocked by the system).
  * Advance booking is recommended at least 24 to 48 hours prior to the desired interment.

---

## 3. Service Catalog & Offerings

### A. Ground Interment (Traditional Burial)
1. **Lawn Lots (Standard, Deluxe, Premium):**
   * Double-depth underground plots with flat marble or granite markers at lawn level.
   * Standard: Located in regular park sectors.
   * Deluxe: Near pathways, landscaped gardens, or tree-lined avenues.
   * Premium: Prime locations near the memorial chapel and main rotunda.
2. **Family Estates / Mausoleums:**
   * Above-ground private family structures accommodating multiple interments and family vaults.

### B. Cremation Services
1. **Individual Cremation:**
   * Professional, dignity-first cremation service conducted by certified crematorium technicians.
   * Includes standard temporary urn or container, certificate of cremation, and viewing room access.
2. **Columbarium Niches:**
   * Indoor and covered outdoor granite-fronted columbarium niches for urn storage.
   * Eye-level, upper, and base tiers available.

---

## 4. Documentary & Legal Requirements

To schedule an interment or cremation, the following documentary requirements must be submitted:

1. **Mandatory Core Documents:**
   * **Death Certificate:** One (1) PSA Certified True Copy or Local Civil Registrar (LCR) registered Death Certificate.
   * **Burial Permit / Transfer Permit:** Issued by the City Health Office / Local Government Unit where the death occurred.
   * **Valid Government-Issued ID:** Primary ID (Passport, UMID, Driver's License, PhilID) of the nearest kin / claimant submitting the reservation.
   * **Proof of Relationship:** Marriage Contract (for spouse), Birth Certificate (for parent/child), or notarized Affidavit of Kinship.
2. **Provisional / Delayed Registration Policy:**
   * If the official LCR registered Death Certificate is delayed or pending processing, a **Hospital-issued Certificate of Death** signed by the attending physician is accepted provisionally for scheduling.
   * The registered Death Certificate and City Health Burial Permit must be submitted to the cemetery administration at least **24 hours before actual interment**.
3. **Existing Lot Owner Requirements:**
   * Certificate of Ownership / Deed of Sale for the lot.
   * Written authorization from the registered lot owner if the decedent is not the primary owner.

---

## 5. Payment Policies & Channels

### A. Accepted Payment Channels
1. **PayMongo Online Payment Gateway:**
   * Credit and Debit Cards (Visa, Mastercard).
   * E-Wallets (GCash, Maya).
   * Direct online payments are automatically verified via PayMongo secure webhooks.
2. **Cash Payment:**
   * Payable directly at the Cemetery Administration Office Cashier (Monday to Saturday, 8:00 AM – 4:00 PM).
3. **Direct Bank Transfer:**
   * Bank transfer to official municipal cemetery depository accounts. Proof of transfer receipt must be submitted on the Payments page for staff verification.

### B. Active Checkout Lease & Protection
* When an online payment checkout session is initiated, the system creates a **1-hour active lease window** locking the lot/service to prevent concurrent double-booking.
* If checkout is abandoned or expires after 1 hour without completed payment, the lease is released automatically.
* The system enforces strict **anti-duplicate safeguards**: once a payment is verified or a booking is confirmed, duplicate checkouts are blocked with HTTP 409 Conflict.

---

## 6. Post-Booking Lifecycle & Rules

1. **Pending Status:**
   * Upon submitting a burial or cremation reservation, the booking status is `Pending`.
2. **Automatic Confirmation:**
   * When an online checkout is successfully paid and verified via PayMongo webhook, the schedule is **automatically confirmed** (`Confirmed` status). There is no separate manual approval step required for paid bookings.
   * Cash and manual bank transfers transition to `Confirmed` immediately upon cashier/staff payment verification.
3. **Burial Day Execution:**
   * On the scheduled date, cemetery staff coordinates the procession and updates the booking to `Completed`.
4. **Rescheduling & Cancellation:**
   * Rescheduling requires at least 24 hours prior notice and is subject to slot availability (Tuesdays–Sundays only).
   * Unpaid pending reservations may be cancelled directly by contacting the administration office.

---

## 7. Columbarium & Cremation Specifics

1. **Niche Capacities:**
   * Standard Columbarium Niche: Accommodates up to **two (2) standard urns**.
   * Family Columbarium Niche: Accommodates up to **four (4) standard urns**.
2. **Urn Specifications:**
   * Standard urn dimensions should not exceed 8 inches in diameter and 10 inches in height.
3. **Ash Custody & Release:**
   * Following cremation, cremated remains (cremains) are released only to the authorized next-of-kin with valid government ID, or interred directly into the designated columbarium niche.

---

## 8. Lease Terms, Renewals & Exhumations

1. **Standard Lease Duration:**
   * Lawn lot interments operate on a standard renewable **5-year renewable lease agreement**.
   * Perpetual care and maintenance fees are included during the active lease.
2. **Renewal Window:**
   * Lease renewal notices are dispatched to registered contacts 90 days and 30 days prior to lease expiration.
   * Leaseholders have a 60-day grace period following expiration to renew their lease.
3. **Exhumation & Relocation Rules:**
   * Exhumations are governed by the Sanitation Code of the Philippines (PD 856).
   * **Minimum Interment Duration:** A minimum period of **three (3) years for non-communicable diseases** or **five (5) years for communicable diseases** must elapse before exhumation of remains is permitted, unless otherwise ordered by court or sanitary authority.
   * **Permit Requirements:** Exhumation Permit and Transfer Clearance must be secured from the City Health Office before cemetery staff can conduct disinterment.

---

## 9. Off-Topic & AI Guardrail Directive

The AI Assistant is strictly scoped to cemetery and memorial park operations. 

### A. Permitted AI Topics
* Burial and cremation scheduling, slot availability, and booking guidance.
* Lot types, columbarium niches, and pricing inquiries.
* Office hours, visiting hours, cemetery gates, and location directions.
* Documentary and permit requirements (Death Certificates, Burial Permits).
* Payment channels, checkout procedures, and status inquiries.
* General cemetery rules and policies.

### B. Prohibited Off-Topic Subjects
* Writing computer software code, scripts, or debugging technical programming issues.
* Solving non-cemetery mathematics, physics, or academic homework problems.
* Providing cooking recipes, culinary guides, or dining recommendations.
* Political opinions, electoral campaigns, or controversial socio-political debates.
* Medical diagnoses, treatment recommendations, or pharmaceutical advice.
* General trivia, gaming guides, creative fiction, or general conversation outside cemetery operations.

### C. Standard Guardrail Response Templates
* **Filipino / Taglish:**
  > *"Paumanhin po, maaari lamang po akong tumulong hinggil sa mga serbisyo ng sementeryo, booking ng libing o cremation, mga lote, oras ng pagbisita, at mga patakaran ng sementeryo. Paano ko po kayo matutulungan sa inyong mga kailangan sa sementeryo ngayon?"*
* **English:**
  > *"I can only assist with cemetery services, burial and cremation bookings, lot inquiries, visiting hours, and cemetery policies. How may I help you with our cemetery arrangements today?"*

---

## 10. User Roles & System Permissions

The Cemetery Management System (CMS) strictly defines three (3) primary user roles with clear separation of duties and access controls:

### A. System Administrator (`admin` / Role ID: 1)
* **Scope & Responsibilities:** Full system-wide governance, configuration, and security control.
* **Key Permissions:**
  * System-wide dashboard metrics, financial revenue reports, and audit trail logs.
  * User management: creating, editing, activating, and deactivating staff and user accounts.
  * Cemetery master data management: configuring Sections, Blocks, Lots, Columbarium wings, and base pricing rules.
  * System exception monitoring: reviewing and resolving payment reconciliation anomalies and lease timeouts.
  * AI Knowledge Base management: creating, updating, and synchronizing AI business knowledge entries (`ai_knowledge`) and prompt parameters.

### B. Cemetery Staff (`staff` / Role ID: 2)
* **Scope & Responsibilities:** Daily cemetery operations, schedule facilitation, document inspection, and manual payment verification.
* **Key Permissions:**
  * Schedule & Booking Management: reviewing daily burial schedules (Tuesdays–Sundays) and cremation queues (Mondays–Saturdays).
  * Document verification: inspecting citizen-uploaded death certificates, burial permits, and valid claimant IDs.
  * Payments: recording and verifying over-the-counter Cash and manual Bank Transfer payments at the Administrative Office cashier.
  * Relocation & Exhumation operations: updating disinterment clearances and recorded statuses.
  * Ground execution: marking confirmed bookings as `Completed` on the day of interment.
  * Staff members do NOT have access to administrative user management or core system configuration.

### C. Citizen / Public User (`user` / Role ID: 3)
* **Scope & Responsibilities:** General public and bereaved families managing burial and cremation arrangements for their loved ones.
* **Key Permissions:**
  * Booking Assistant: conversational reservation of burial plots and cremation schedules via the AI Booking Assistant.
  * Lot & Columbarium exploration: browsing available lots, filtering by section, and reviewing pricing catalogs.
  * Document submission: uploading death certificates, government IDs, and required clearances for draft bookings.
  * Payments: initiating secure online payments via PayMongo (Cards, GCash, Maya) or tracking payment receipts.
  * Self-service tracking: monitoring active bookings, payment histories, and deceased records under `My Bookings` and `My Records`.
  * Citizens are restricted to accessing their own profile and booking records only.

---

## 11. Cemetery Physical Structure & Geographic Hierarchy

Himlayang Bayan Memorial Park is organized in a clear, standardized hierarchical layout for precise mapping and record navigation:

### A. Ground Interment Hierarchy (Lawn Lots & Estates)
1. **Sections:**
   * Major named park divisions (e.g., *Section A - Garden of Peace*, *Section B - Serenity Garden*, *Section C - St. Peter*, *Section D - Resurrection*).
   * Sections define lot classifications (Standard, Deluxe, Premium) and base pricing.
2. **Blocks:**
   * Specific subdivisions within a section (e.g., *Block 1*, *Block 2*, *Block 3*), demarcated by paved pedestrian pathways and access lanes.
3. **Lots / Plots:**
   * Individual ground burial units identified by unique numbers within their block/section (e.g., *Lot 101*, *Lot 102*).
   * Canonical lot identifier format: `SEC-BLK-LOT` (e.g., `A-01-14` or `B-02-05`).
   * Each standard lawn lot measures approximately 1.0m × 2.44m and supports double-depth interment.

### B. Columbarium Structure (Urn Storage)
1. **Columbarium Buildings / Wings:**
   * Dedicated memorial buildings or covered garden pavilions (e.g., *Columbarium East Wing*, *St. Michael Cloister*).
2. **Levels / Tiers:**
   * Vertical rows of niches:
     * *Level 1 (Base Tier):* Ground / lowest tier.
     * *Level 2–3 (Eye Level / Heart Level):* Most sought-after viewing tiers.
     * *Level 4–5 (Upper Tier):* Topmost sheltered tiers.
3. **Niches:**
   * Granite-faced compartments with unique numbering (e.g., *Niche E-104*).
   * Standard Niches hold up to two (2) urns; Family Niches hold up to four (4) urns.

---

## 12. Cancellation, Rescheduling & Refund Policies

The cemetery enforces fair, transparent cancellation and refund rules in accordance with Philippine municipal standards and consumer protection guidelines:

### A. Rescheduling Policy
* **Burials & Cremations:** Rescheduling requests must be submitted at least **24 hours before the scheduled time slot**.
* **Eligible Days:** Rescheduled burial dates must fall on **Tuesday through Sunday** (Mondays closed for grounds maintenance).
* **Process:** Rescheduling can be requested directly through the conversational AI Booking Assistant or by calling the Administrative Office at (02) 8123-4567. There is **no rescheduling fee** for requests made with at least 24 hours advance notice.

### B. Cancellation Policy
* **Draft / Unpaid Reservations:** Drafts and unpaid pending reservations may be cancelled at any time by the citizen via chat or the booking interface without penalty or fee.
* **Confirmed Paid Bookings:** If a citizen wishes to cancel a confirmed booking prior to interment or cremation, cancellation must be processed through the Administrative Office with valid claimant ID.

### C. Refund Guidelines & PayMongo Integration
1. **Online PayMongo Payments (Cards, GCash, Maya):**
   * If a confirmed paid booking is approved for cancellation by cemetery administration before service execution, the refund is processed through the PayMongo API gateway.
   * PayMongo webhook notifications automatically synchronize the payment status to `Refunded` or `Partially Refunded` in the CMS database.
2. **Refund Eligibility Criteria:**
   * **Full Refund (100%):** Valid cancellation requests submitted at least **48 hours prior** to the scheduled service, or cancellations due to cemetery scheduling conflicts or force majeure.
   * **Partial Refund (80%):** Cancellations made between **24 and 48 hours prior** to the scheduled service (20% administrative handling fee retained).
   * **Non-Refundable:** Cancellations made **less than 24 hours** before the scheduled service, or after interment / cremation has already taken place.
3. **Processing Timelines:**
   * GCash / Maya refunds typically credit back to the citizen's mobile wallet within **1 to 3 business days**.
   * Credit and Debit card refunds typically reflect on the customer's bank statement within **5 to 10 banking days**, depending on the issuing bank.
