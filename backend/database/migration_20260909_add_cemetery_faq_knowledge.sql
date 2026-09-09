-- Migration: Add general cemetery FAQ knowledge entries for Booking Automation Phase 5
INSERT INTO ai_knowledge (topic, content) VALUES
('visiting_hours', 'The cemetery grounds are open for visiting daily from 8:00 AM to 5:00 PM (Monday to Sunday). The cemetery administration office is open Monday through Saturday from 8:00 AM to 4:00 PM.')
ON DUPLICATE KEY UPDATE content = VALUES(content);

INSERT INTO ai_knowledge (topic, content) VALUES
('cemetery_location', 'The cemetery is located at Himlayang Bayan Memorial Park, Main Gate Avenue. For inquiries, you may contact the administration office or reach out via our online booking assistant.')
ON DUPLICATE KEY UPDATE content = VALUES(content);

INSERT INTO ai_knowledge (topic, content) VALUES
('services_overview', 'We offer two primary types of services: In-ground Burial (with choice of available lawn lots) and Cremation (crematorium services and columbarium niche storage). Burials are scheduled Tuesday through Sunday; Mondays are reserved for cemetery grounds maintenance.')
ON DUPLICATE KEY UPDATE content = VALUES(content);
