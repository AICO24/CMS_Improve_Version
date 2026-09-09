<?php
/**
 * Test Suite: Booking Automation V2 - Phase 5 General Inquiries, Cemetery FAQs & Conversational Chit-Chat
 * 
 * Verifies:
 * 1. Visiting Hours FAQ: Answering operating hours without active draft (intent: GENERAL_INQUIRY, is_faq: true)
 * 2. Cemetery Location FAQ: Answering location/address inquiry
 * 3. Fees & Pricing FAQ: Answering pricing/payment methods inquiry
 * 4. General Requirements FAQ: Answering documentary requirements checklist
 * 5. Conversational Chit-Chat: Welcoming casual greetings warmly ('Magandang araw po!')
 * 6. Mid-Draft FAQ Retention & Smart Segue: Answering FAQ mid-draft preserves HUD slots and includes decedent segue
 * 7. Seamless Resumption after FAQ: User continues flow after FAQ without losing previous draft data
 */

require_once __DIR__ . '/../backend/config/Database.php';
require_once __DIR__ . '/../backend/controllers/BookingAgentController.php';
require_once __DIR__ . '/../backend/services/BookingAgentService.php';
require_once __DIR__ . '/../backend/models/BookingDraft.php';

echo "===================================================================\n";
echo "RUNNING PHASE 5: GENERAL INQUIRIES, CEMETERY FAQS & CHIT-CHAT TESTS\n";
echo "===================================================================\n\n";

$db = Database::getInstance()->getConnection();
$controller = new BookingAgentController();
$draftModel = new BookingDraft();

// Setup test user
$username = 'phase5_faq_user_' . uniqid();
$email = 'p5_' . uniqid() . '@test.local';
$db->prepare("INSERT INTO users (username, password_hash, full_name, email, role_id) VALUES (?, 'hash', 'Phase 5 User', ?, 3)")->execute([$username, $email]);
$userId = (int) $db->lastInsertId();
$testUser = ['user_id' => $userId, 'username' => $username, 'role' => 'user'];

$passCount = 0;
$totalTests = 7;

// -------------------------------------------------------------------------
// TEST 1: Visiting Hours FAQ (No Active Draft)
// -------------------------------------------------------------------------
$t1_res = $controller->chat([
    'message' => 'Anong oras po bukas ang sementeryo para sa mga bisita?'
], $testUser);

$t1_reply = $t1_res['reply'] ?? '';
$t1_pass = ($t1_res['success'] ?? false)
    && (($t1_res['intent'] ?? '') === BookingAgentService::INTENT_GENERAL_INQUIRY)
    && !empty($t1_res['is_faq'])
    && (stripos($t1_reply, '6:00') !== false || stripos($t1_reply, '8:00') !== false || stripos($t1_reply, 'bukas') !== false || stripos($t1_reply, 'visiting') !== false || stripos($t1_reply, 'open') !== false || stripos($t1_reply, 'hours') !== false);

echo ($t1_pass ? "✅" : "❌") . " Test 1: Visiting Hours FAQ answered with GENERAL_INQUIRY\n";
if (!$t1_pass) var_dump($t1_res);
if ($t1_pass) $passCount++;

// -------------------------------------------------------------------------
// TEST 2: Cemetery Location FAQ
// -------------------------------------------------------------------------
$t2_res = $controller->chat([
    'message' => 'Saan po matatagpuan ang opisina ng sementeryo?'
], $testUser);

$t2_reply = $t2_res['reply'] ?? '';
$t2_pass = ($t2_res['success'] ?? false)
    && (($t2_res['intent'] ?? '') === BookingAgentService::INTENT_GENERAL_INQUIRY)
    && !empty($t2_res['is_faq'])
    && (stripos($t2_reply, 'Memorial Park') !== false || stripos($t2_reply, 'Gate') !== false || stripos($t2_reply, 'opisina') !== false);

echo ($t2_pass ? "✅" : "❌") . " Test 2: Cemetery Location FAQ answered with informative grounds detail\n";
if (!$t2_pass) var_dump($t2_res);
if ($t2_pass) $passCount++;

// -------------------------------------------------------------------------
// TEST 3: Fees & Pricing FAQ
// -------------------------------------------------------------------------
$t3_res = $controller->chat([
    'message' => 'Magkano po ba ang bayad at paano ang mode of payment?'
], $testUser);

$t3_reply = $t3_res['reply'] ?? '';
$t3_pass = ($t3_res['success'] ?? false)
    && (($t3_res['intent'] ?? '') === BookingAgentService::INTENT_GENERAL_INQUIRY)
    && !empty($t3_res['is_faq'])
    && (stripos($t3_reply, 'bayad') !== false || stripos($t3_reply, 'Cash') !== false || stripos($t3_reply, 'GCash') !== false || stripos($t3_reply, 'fees') !== false);

echo ($t3_pass ? "✅" : "❌") . " Test 3: Fees & Pricing / Payment Methods FAQ answered accurately\n";
if (!$t3_pass) var_dump($t3_res);
if ($t3_pass) $passCount++;

// -------------------------------------------------------------------------
// TEST 4: General Requirements FAQ
// -------------------------------------------------------------------------
$t4_res = $controller->chat([
    'message' => 'Ano po ang mga documentary requirements para makapagpalibing?'
], $testUser);

$t4_reply = $t4_res['reply'] ?? '';
$t4_pass = ($t4_res['success'] ?? false)
    && (($t4_res['intent'] ?? '') === BookingAgentService::INTENT_GENERAL_INQUIRY)
    && !empty($t4_res['is_faq'])
    && (stripos($t4_reply, 'Death Certificate') !== false || stripos($t4_reply, 'Burial Permit') !== false);

echo ($t4_pass ? "✅" : "❌") . " Test 4: Documentary Requirements FAQ answered with required papers checklist\n";
if (!$t4_pass) var_dump($t4_res);
if ($t4_pass) $passCount++;

// -------------------------------------------------------------------------
// TEST 5: Casual Greeting & Chit-Chat
// -------------------------------------------------------------------------
$t5_res = $controller->chat([
    'message' => 'Magandang araw po!'
], $testUser);

$t5_reply = $t5_res['reply'] ?? '';
$t5_pass = ($t5_res['success'] ?? false)
    && (($t5_res['intent'] ?? '') === BookingAgentService::INTENT_GENERAL_INQUIRY)
    && (stripos($t5_reply, 'Magandang') !== false || stripos($t5_reply, 'Assistant') !== false || stripos($t5_reply, 'tulungan') !== false);

echo ($t5_pass ? "✅" : "❌") . " Test 5: Casual Greeting acknowledged with polite assistant welcome\n";
if (!$t5_pass) var_dump($t5_res);
if ($t5_pass) $passCount++;

// -------------------------------------------------------------------------
// TEST 6: Mid-Draft FAQ Retention & Conversational Segue
// -------------------------------------------------------------------------
// Step 6a: Create an active draft with a decedent name
$draftInit = $controller->chat([
    'message'      => 'Gusto ko po mag-book ng libing para kay Nanay Gloria Romero',
    'service_type' => 'burial'
], $testUser);

$draftId = $draftInit['draft_id'] ?? 0;
$decName = $draftInit['extracted_data']['decedent_name'] ?? '';

// Step 6b: Citizen asks a visiting hours FAQ mid-draft
$t6_res = $controller->chat([
    'message'  => 'Teka lang, ano po ba ang visiting hours ninyo kapag Sabado?',
    'draft_id' => $draftId
], $testUser);

$t6_reply = $t6_res['reply'] ?? '';
$t6_extracted = $t6_res['extracted_data'] ?? [];

$t6_pass = ($t6_res['success'] ?? false)
    && (($t6_res['intent'] ?? '') === BookingAgentService::INTENT_GENERAL_INQUIRY)
    && !empty($t6_res['is_faq'])
    && !empty($t6_res['advisory'])
    && (int)($t6_res['draft_id'] ?? 0) === (int)$draftId
    // Crucial check: decedent name is NOT wiped from HUD payload
    && (!empty($t6_extracted['decedent_name']) && $t6_extracted['decedent_name'] === 'Gloria Romero')
    // Crucial check: Segue gently asks if citizen wants to continue booking for Gloria Romero
    && (stripos($t6_reply, 'Gloria Romero') !== false);

echo ($t6_pass ? "✅" : "❌") . " Test 6: Mid-Draft FAQ preserved HUD extracted_data and included smart segue for Gloria Romero\n";
if (!$t6_pass) {
    echo "T6 Reply: {$t6_reply}\n";
    echo "T6 Extracted: " . json_encode($t6_extracted) . "\n";
    var_dump($t6_res);
}
if ($t6_pass) $passCount++;

// -------------------------------------------------------------------------
// TEST 7: Seamless Resumption After FAQ (Zero Disruption)
// -------------------------------------------------------------------------
// Citizen continues and provides date
$t7_res = $controller->chat([
    'message'  => 'Opo, gusto po namin sa darating na Biyernes',
    'draft_id' => $draftId
], $testUser);

$t7_extracted = $t7_res['extracted_data'] ?? [];
$t7_reply = $t7_res['reply'] ?? '';

$t7_pass = ($t7_res['success'] ?? false)
    && (int)($t7_res['draft_id'] ?? 0) === (int)$draftId
    && (!empty($t7_extracted['decedent_name']) && $t7_extracted['decedent_name'] === 'Gloria Romero')
    && !empty($t7_extracted['preferred_date']);

echo ($t7_pass ? "✅" : "❌") . " Test 7: Booking flow seamlessly resumed after FAQ with all details preserved\n";
if (!$t7_pass) {
    echo "T7 Reply: {$t7_reply}\n";
    echo "T7 Extracted: " . json_encode($t7_extracted) . "\n";
    var_dump($t7_res);
}
if ($t7_pass) $passCount++;

echo "\n===================================================================\n";
echo "TEST RESULTS: {$passCount}/{$totalTests} PASSED\n";
echo "===================================================================\n";

// Cleanup test user & draft
if ($userId > 0) {
    $db->prepare("DELETE FROM booking_drafts WHERE user_id = ?")->execute([$userId]);
    $db->prepare("DELETE FROM users WHERE user_id = ?")->execute([$userId]);
}

exit($passCount === $totalTests ? 0 : 1);
