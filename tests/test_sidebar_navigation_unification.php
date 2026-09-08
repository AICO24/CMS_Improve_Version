<?php
/**
 * Test Suite: Sidebar Navigation UX Unification & Role-Based UI Consistency
 * 
 * Verifies all 16 core invariants:
 * TEST 1: All collapsible sidebar groups default to collapsed on fresh dashboard page load.
 * TEST 2: Opening one group closes all other groups (single-open accordion).
 * TEST 3: Clicking an already-open group closes it.
 * TEST 4: Active route handling opens only the required parent group on module pages.
 * TEST 5: Admin sidebar contains only Admin-authorized navigation modules.
 * TEST 6: Staff sidebar respects Staff RBAC (no admin leaks, correct records group).
 * TEST 7: User sidebar correctly contains Services, Records (with My Bookings), Finance, Account.
 * TEST 8: No duplicate primary booking navigation entries exist.
 * TEST 9: Legacy booking routes remain compatible without unnecessary primary navigation exposure.
 * TEST 10: Sidebar CSS prevents horizontal overflow (overflow-x: hidden).
 * TEST 11: Sidebar remains scrollable while browser scrollbar visuals are hidden.
 * TEST 12: Mobile sidebar drawer loads with groups collapsed and accordion behavior enabled.
 * TEST 13: Route access and sidebar visibility are treated as separate concerns.
 * TEST 14: No hardcoded .nav-group.open state remains in static page markup across all pages.
 * TEST 15: Responsive breakpoints do not automatically force all accordion groups open on mobile.
 * TEST 16: Navigation configuration remains the canonical source of truth and obsolete admin dashboard booking clutter is removed.
 */

$rootDir = dirname(__DIR__);
$passCount = 0;
$failCount = 0;

function assertCondition($name, $condition, $details = '') {
    global $passCount, $failCount;
    if ($condition) {
        echo "[PASS] {$name}\n";
        $passCount++;
    } else {
        echo "[FAIL] {$name}: {$details}\n";
        $failCount++;
    }
}

echo "======================================================================\n";
echo "RUNNING SIDEBAR NAVIGATION UX UNIFICATION & RBAC AUDIT SUITE\n";
echo "======================================================================\n";

$navConfigPath = $rootDir . '/assets/js/shared/navigation-config.js';
$sidebarNavPath = $rootDir . '/assets/js/shared/sidebar-nav.js';
$sidebarCssPath = $rootDir . '/assets/css/components/sidebar-nav-groups.css';
$reskinCssPath = $rootDir . '/assets/css/reskin.css';
$apiJsPath = $rootDir . '/assets/js/shared/api.js';
$adminDashPath = $rootDir . '/frontend/pages/dashboard_admin.html';

$navConfig = file_get_contents($navConfigPath);
$sidebarNav = file_get_contents($sidebarNavPath);
$sidebarCss = file_get_contents($sidebarCssPath);
$reskinCss = file_get_contents($reskinCssPath);
$apiJs = file_get_contents($apiJsPath);
$adminDash = file_get_contents($adminDashPath);

// -------------------------------------------------------------
// TEST 1: All collapsible sidebar groups default to collapsed on dashboard
// -------------------------------------------------------------
$dashboardsAllClosedInRender = strpos($navConfig, 'const isDashboard = !activeRoute || activeRoute === \'index.html\' || activeRoute.indexOf(\'dashboard_\') === 0;') !== false
    && strpos($navConfig, 'const containsActive = !isDashboard') !== false;
$dashboardsClosedInInit = strpos($sidebarNav, 'if (isDashboard) {') !== false
    && strpos($sidebarNav, 'closeOthers(null);') !== false;

assertCondition(
    "TEST 1: All collapsible sidebar groups default to collapsed on fresh dashboard page load",
    $dashboardsAllClosedInRender && $dashboardsClosedInInit,
    "Expected isDashboard check in renderSidebar and initSidebarNav to close all groups by default"
);

// -------------------------------------------------------------
// TEST 2: Opening one group closes all other groups
// -------------------------------------------------------------
$closeOthersInClick = preg_match('/closeOthers\(group\);\s*group\.classList\.toggle\(\'open\',\s*willOpen\);/', $sidebarNav);
$closeOthersIteratesAll = strpos($sidebarNav, 'groups.forEach(function (group) {') !== false
    && strpos($sidebarNav, 'if (group !== exceptGroup) {') !== false
    && strpos($sidebarNav, 'group.classList.remove(\'open\');') !== false;
$noIsStaticExceptionInClose = strpos($sidebarNav, '!group.classList.contains(\'is-static\')') === false;

assertCondition(
    "TEST 2: Opening one group closes all other groups (single-open accordion)",
    $closeOthersInClick && $closeOthersIteratesAll && $noIsStaticExceptionInClose,
    "Expected closeOthers to close all non-selected groups without is-static exemptions"
);

// -------------------------------------------------------------
// TEST 3: Clicking an already-open group closes it
// -------------------------------------------------------------
$togglesOpenState = strpos($sidebarNav, 'var willOpen = !group.classList.contains(\'open\');') !== false
    && strpos($sidebarNav, 'group.classList.toggle(\'open\', willOpen);') !== false;

assertCondition(
    "TEST 3: Clicking an already-open group closes it",
    $togglesOpenState,
    "Expected willOpen calculation to invert the open state and allow group collapse on re-click"
);

// -------------------------------------------------------------
// TEST 4: Active route handling opens only the required parent group
// -------------------------------------------------------------
$opensOnlyActiveParent = strpos($navConfig, 'const containsActive = !isDashboard && section.items.some(function(it) {') !== false
    && strpos($navConfig, 'return it.route === activeRoute;') !== false
    && strpos($navConfig, '\'<div class="nav-group\' + (containsActive ? \' open\' : \'\') + \'">\'') !== false;

assertCondition(
    "TEST 4: Active route handling opens only the required parent group",
    $opensOnlyActiveParent,
    "Expected renderSidebar to only append 'open' class to the parent group containing activeRoute"
);

// -------------------------------------------------------------
// TEST 5: Admin sidebar contains only Admin-authorized navigation modules
// -------------------------------------------------------------
$adminGroupOrder = strpos($navConfig, "'Intelligence & Analytics'") !== false
    && strpos($navConfig, "'System Administration'") !== false;
$adminHasRelocation = preg_match("/route:\s*'relocation-management\.html'[^}]+allowedRoles:\s*\[[^\]]*'admin'[^\]]*\]/s", $navConfig);
$adminHasColumbarium = preg_match("/route:\s*'cremation-management\.html'[^}]+allowedRoles:\s*\[[^\]]*'admin'[^\]]*\]/s", $navConfig);
$adminHasReports = preg_match("/route:\s*'reports\.html'[^}]+allowedRoles:\s*\[[^\]]*'admin'[^\]]*\]/s", $navConfig);
$adminHasAudit = preg_match("/route:\s*'audit\.html'[^}]+allowedRoles:\s*\[[^\]]*'admin'[^\]]*\]/s", $navConfig);

assertCondition(
    "TEST 5: Admin sidebar contains only Admin-authorized navigation modules",
    $adminGroupOrder && $adminHasRelocation && $adminHasColumbarium && $adminHasReports && $adminHasAudit,
    "Expected Admin sidebar to include authorized admin operations, records, intelligence, and system modules"
);

// -------------------------------------------------------------
// TEST 6: Staff sidebar respects Staff RBAC
// -------------------------------------------------------------
// Staff must NOT have admin-only routes
$staffNoRelocation = !preg_match("/route:\s*'relocation-management\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\]/s", $navConfig);
$staffNoColumbarium = !preg_match("/route:\s*'cremation-management\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\]/s", $navConfig);
$staffNoReports = !preg_match("/route:\s*'reports\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\]/s", $navConfig);
$staffNoAudit = !preg_match("/route:\s*'audit\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\]/s", $navConfig);
$staffNoAi = !preg_match("/route:\s*'ai\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\]/s", $navConfig);
$staffNoUserMgmt = !preg_match("/route:\s*'user-management\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\]/s", $navConfig);

// Staff must have authorized routes
$staffHasBurial = preg_match("/route:\s*'burial-scheduling\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\]/s", $navConfig);
$staffHasReservations = preg_match("/route:\s*'manage-reservations\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\]/s", $navConfig);
$staffHasCremations = preg_match("/route:\s*'manage-cremations\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\]/s", $navConfig);
$staffHasDecedents = preg_match("/route:\s*'decedent-records\.html'[^}]+allowedRoles:\s*\[[^\]]*'staff'[^\]]*\]/s", $navConfig);

$staffRbacClean = $staffNoRelocation && $staffNoColumbarium && $staffNoReports && $staffNoAudit
    && $staffNoAi && $staffNoUserMgmt && $staffHasBurial && $staffHasReservations && $staffHasCremations && $staffHasDecedents;

assertCondition(
    "TEST 6: Staff sidebar respects Staff RBAC (no admin module leakage)",
    $staffRbacClean,
    "Expected staff sidebar to strictly exclude admin-only modules while retaining permitted operational workflows"
);

// -------------------------------------------------------------
// TEST 7: User sidebar correctly contains Services, Records, Finance, Account
// -------------------------------------------------------------
$userServicesHasBook = preg_match("/route:\s*'book-a-service\.html'[^}]+user:\s*'Services'/s", $navConfig);
$userServicesHasAssistant = preg_match("/route:\s*'booking-assistant\.html'[^}]+user:\s*'Services'/s", $navConfig);
$userRecordsHasMyBookings = preg_match("/route:\s*'my-bookings\.html'[^}]+user:\s*'Records'/s", $navConfig);
$userRecordsHasMyRecords = preg_match("/route:\s*'my-records\.html'[^}]+sidebarGroup:\s*'Records'/s", $navConfig);
$userFinanceHasPayments = preg_match("/route:\s*'payments\.html'[^}]+sidebarGroup:\s*'Finance'/s", $navConfig);
$userFinanceHasHistory = preg_match("/route:\s*'payment-history\.html'[^}]+sidebarGroup:\s*'Finance'/s", $navConfig);
$userAccountHasProfile = preg_match("/route:\s*'profile\.html'[^}]+sidebarGroup:\s*'Account'/s", $navConfig);
$userAccountHasSettings = preg_match("/route:\s*'settings\.html'[^}]+sidebarGroup:\s*'Account'/s", $navConfig);

$userStructureValid = $userServicesHasBook && $userServicesHasAssistant && $userRecordsHasMyBookings
    && $userRecordsHasMyRecords && $userFinanceHasPayments && $userFinanceHasHistory && $userAccountHasProfile && $userAccountHasSettings;

assertCondition(
    "TEST 7: User sidebar correctly contains Services, Records (with My Bookings), Finance, and Account",
    $userStructureValid,
    "Expected citizen sidebar to group Book a Service & Assistant in Services, My Bookings & Records in Records, Payments & History in Finance, Profile & Settings in Account"
);

// -------------------------------------------------------------
// TEST 8: No duplicate primary booking navigation entries exist
// -------------------------------------------------------------
$legacyBurialInSidebar = preg_match("/route:\s*'reserve-burial-slot\.html'[^}]+showInSidebar:\s*true/s", $navConfig);
$legacyCremationInSidebar = preg_match("/route:\s*'reserve-cremation\.html'[^}]+showInSidebar:\s*true/s", $navConfig);
$legacyMyReservationsInSidebar = preg_match("/route:\s*'my-reservations\.html'[^}]+showInSidebar:\s*true/s", $navConfig);
$legacyMyCremationsInSidebar = preg_match("/route:\s*'my-cremations\.html'[^}]+showInSidebar:\s*true/s", $navConfig);

$noDuplicates = !$legacyBurialInSidebar && !$legacyCremationInSidebar && !$legacyMyReservationsInSidebar && !$legacyMyCremationsInSidebar;

assertCondition(
    "TEST 8: No duplicate primary booking navigation entries exist",
    $noDuplicates,
    "Legacy routes (reserve-burial-slot, reserve-cremation, my-reservations, my-cremations) must have showInSidebar: false"
);

// -------------------------------------------------------------
// TEST 9: Legacy booking routes remain compatible without unnecessary primary navigation exposure
// -------------------------------------------------------------
$legacyBurialAllowed = preg_match("/route:\s*'reserve-burial-slot\.html'[^}]+allowedRoles:\s*\[[^\]]*'user'[^\]]*\]/s", $navConfig);
$legacyCremationAllowed = preg_match("/route:\s*'reserve-cremation\.html'[^}]+allowedRoles:\s*\[[^\]]*'user'[^\]]*\]/s", $navConfig);
$legacyMyResAllowed = preg_match("/route:\s*'my-reservations\.html'[^}]+allowedRoles:\s*\[[^\]]*'user'[^\]]*\]/s", $navConfig);
$legacyMyCremAllowed = preg_match("/route:\s*'my-cremations\.html'[^}]+allowedRoles:\s*\[[^\]]*'user'[^\]]*\]/s", $navConfig);

$legacyCompatible = $legacyBurialAllowed && $legacyCremationAllowed && $legacyMyResAllowed && $legacyMyCremAllowed;

assertCondition(
    "TEST 9: Legacy booking routes remain compatible without unnecessary primary navigation exposure",
    $legacyCompatible,
    "Expected legacy routes to remain authorized for user while hidden from sidebar"
);

// -------------------------------------------------------------
// TEST 10: Sidebar CSS prevents horizontal overflow
// -------------------------------------------------------------
$sidebarOverflowX = strpos($sidebarCss, '.sidebar {') !== false && strpos($sidebarCss, 'overflow-x: hidden;') !== false;
$sidebarNavOverflowX = strpos($sidebarCss, '.sidebar-nav {') !== false && strpos($sidebarCss, 'overflow-x: hidden;') !== false;

assertCondition(
    "TEST 10: Sidebar CSS prevents horizontal overflow (overflow-x: hidden)",
    $sidebarOverflowX && $sidebarNavOverflowX,
    "Expected both .sidebar and .sidebar-nav to enforce overflow-x: hidden"
);

// -------------------------------------------------------------
// TEST 11: Sidebar remains scrollable while browser scrollbar visuals are hidden
// -------------------------------------------------------------
$sidebarNavScrollY = strpos($sidebarCss, 'overflow-y: auto;') !== false;
$sidebarNavScrollbarNone = strpos($sidebarCss, 'scrollbar-width: none;') !== false;
$sidebarNavWebkitHidden = preg_match('/\.sidebar-nav::-webkit-scrollbar\s*\{[^}]*display:\s*none;/s', $sidebarCss);

assertCondition(
    "TEST 11: Sidebar remains scrollable while browser scrollbar visuals are hidden",
    $sidebarNavScrollY && $sidebarNavScrollbarNone && $sidebarNavWebkitHidden,
    "Expected .sidebar-nav to declare overflow-y: auto, scrollbar-width: none, and display: none on ::-webkit-scrollbar"
);

// -------------------------------------------------------------
// TEST 12: Mobile sidebar drawer loads with groups collapsed and accordion behavior enabled
// -------------------------------------------------------------
$navGroupBodyBaseCollapsed = preg_match('/\.nav-group-body\s*\{[^}]*max-height:\s*0;\s*overflow:\s*hidden;/s', $sidebarCss);
$navGroupBodyOpenExpands = preg_match('/\.nav-group\.open\s+\.nav-group-body\s*\{[^}]*max-height:\s*(?:480|1000)px;/s', $sidebarCss);
$chevronRotatesOnOpen = preg_match('/\.nav-group\.open\s+\.nav-group-header\s+\.chev\s*\{[^}]*transform:\s*rotate\(180deg\);/s', $sidebarCss);

assertCondition(
    "TEST 12: Mobile sidebar drawer loads with groups collapsed and accordion behavior enabled",
    $navGroupBodyBaseCollapsed && $navGroupBodyOpenExpands && $chevronRotatesOnOpen,
    "Expected base accordion CSS to default .nav-group-body to max-height: 0 and expand to max-height on .open with chevron rotation"
);

// -------------------------------------------------------------
// TEST 13: Route access and sidebar visibility are treated as separate concerns
// -------------------------------------------------------------
$notificationsHidden = preg_match("/route:\s*'notifications\.html'.*?allowedRoles:\s*\[[^\]]*'admin'[^\]]*\].*?showInSidebar:\s*false/s", $navConfig);
$myBookingsAdminHidden = preg_match("/route:\s*'my-bookings\.html'.*?allowedRoles:\s*\[[^\]]*'admin'[^\]]*\].*?sidebarGroup:\s*\{[^}]*admin:\s*null/s", $navConfig);

assertCondition(
    "TEST 13: Route access and sidebar visibility are treated as separate concerns",
    $notificationsHidden && $myBookingsAdminHidden,
    "Expected notifications.html and my-bookings.html to be fully authorized while hidden from respective sidebars"
);

// -------------------------------------------------------------
// TEST 14: No hardcoded .nav-group.open state remains in static page markup
// -------------------------------------------------------------
$pagesDir = $rootDir . '/frontend/pages';
$htmlFiles = glob($pagesDir . '/*.html');
$openInStaticFiles = [];

foreach ($htmlFiles as $file) {
    $content = file_get_contents($file);
    if (preg_match('/class=["\'][^"\']*nav-group\s+open[^"\']*["\']/', $content) || preg_match('/class=["\'][^"\']*nav-group\s+is-static[^"\']*["\']/', $content)) {
        $openInStaticFiles[] = basename($file);
    }
}

assertCondition(
    "TEST 14: No hardcoded .nav-group.open or is-static state remains in static page markup across all pages",
    empty($openInStaticFiles),
    "Found static open/is-static nav-group in: " . implode(', ', $openInStaticFiles)
);

// -------------------------------------------------------------
// TEST 15: Responsive breakpoints do not automatically force all accordion groups open on mobile
// -------------------------------------------------------------
$hasGlobalMaxHeightNone = preg_match('/@media\s*\(\s*max-width:\s*1024px\s*\)\s*\{[^}]*\.nav-group-body\s*\{[^}]*max-height:\s*none;/s', $sidebarCss);

assertCondition(
    "TEST 15: Responsive breakpoints do not automatically force all accordion groups open on mobile",
    !$hasGlobalMaxHeightNone,
    "Found conflicting '@media (max-width: 1024px) { .nav-group-body { max-height: none; } }' rule in sidebar-nav-groups.css"
);

// -------------------------------------------------------------
// TEST 16: Navigation configuration canonical source of truth & Admin dashboard booking clutter removed
// -------------------------------------------------------------
$hasCmsNavigationGlobal = strpos($navConfig, 'window.CMS_NAVIGATION = {') !== false;
$noObsoleteBookingCardOnAdminDash = strpos($adminDash, 'Need a Lot Recommendation?') === false
    && strpos($adminDash, 'Open Burial Assistant') === false;
$hasOperationalQueuesCard = strpos($adminDash, 'Operational Queues') !== false
    && strpos($adminDash, 'manage-reservations.html') !== false;

assertCondition(
    "TEST 16: Navigation configuration canonical source of truth & Admin dashboard booking clutter removed",
    $hasCmsNavigationGlobal && $noObsoleteBookingCardOnAdminDash && $hasOperationalQueuesCard,
    "Expected window.CMS_NAVIGATION export and replacement of obsolete citizen lot card with Operational Queues on Admin dashboard"
);

echo "======================================================================\n";
echo "AUDIT RESULTS: {$passCount} PASSED, {$failCount} FAILED\n";
echo "======================================================================\n";

if ($failCount > 0) {
    exit(1);
}
exit(0);
