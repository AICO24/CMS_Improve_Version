# SIDEBAR NAVIGATION ARCHITECTURE AUDIT & REDESIGN PLAN

**Document:** `docs/SIDEBAR_NAVIGATION_AUDIT.md`  
**Date:** 2026-09-05  
**Scope:** Cemetery Management System (CMS) Frontend Sidebar Navigation Architecture  
**Status:** Audit Complete — Pending Implementation Approval

---

## 1. Current Sidebar Architecture

The Cemetery Management System frontend is a multi-page web application (MPA) built with modern Vanilla JavaScript and semantic HTML5. Currently, sidebar navigation operates under a **hybrid static/dynamic architecture**:

1. **Static HTML Base:**
   - Every protected HTML page in `frontend/pages/` ships its own hardcoded `<aside class="sidebar">` element containing `.sidebar-header`, `.sidebar-nav`, and `.sidebar-footer`.
   - Across 28 HTML pages, three distinct static HTML templates are copy-pasted:
     - **Template 1 (Admin):** 6 accordion groups (`Operations`, `Records`, `Finance`, `AI & Automation`, `Reports`, `System`), 18 navigation links.
     - **Template 2 (User/Citizen):** 4 accordion groups (`Operations`, `Records`, `Finance`, `System`), 11 navigation links.
     - **Template 3 (Staff):** 4 accordion groups (`Operations`, `Finance`, `AI & Automation`, `System`), 8 navigation links (*omits Records*).

2. **JavaScript Role Guard & Dynamic Manipulation (`assets/js/shared/api.js`):**
   - On page load, `requireRole(allowedRoles)` verifies the user session with the backend (`api.getMe()`).
   - It calls `filterSidebarByRole(roleName)` to strip DOM nodes for links not permitted by the static `PAGE_ROLE_ACCESS` dictionary.
   - For a hardcoded list of four shared pages (`PAGES_NEEDING_SIDEBAR_REBUILD = ['payments.html', 'notifications.html', 'profile.html', 'settings.html']`), it overrides the static HTML by injecting generated markup from `ROLE_SIDEBAR_LINKS[role]` via `renderSidebarForRole(roleName)`.

3. **Behavioral Controller (`assets/js/shared/sidebar-nav.js`):**
   - Enforces a **single-open accordion**: expanding one `.nav-group` collapses all others.
   - Inspects `window.location.pathname` to automatically open the `.nav-group` that contains the current active page.
   - Manages desktop manual icon-rail state (`#railToggleBtn` toggling `.rail-manual` on `.sidebar`, persisted in `localStorage['cms-sidebar-rail']`).

4. **Responsive Styling Shell (`assets/css/dashboard.css` & `assets/css/components/sidebar-nav-groups.css`):**
   - **Desktop (>=1025px):** Fixed 260px sidebar with single-open accordion groups. Can be manually collapsed into a 70px icon-only rail via `#railToggleBtn`.
   - **Tablet (769-1024px):** Automatically switches to a 70px icon-only rail with category headers hidden.
   - **Mobile (<=768px):** Off-canvas drawer (`transform: translateX(-100%)`) toggled via the hamburger checkbox (`#toggleSidebar` & `.sidebar.collapsed`) with a dimmed backdrop scrim.

---

## 2. Files Containing Duplicated Sidebar Code

Every single page in `frontend/pages/` (28 pages total) contains a duplicate static `<aside class="sidebar">` structure totaling over 1,500 lines of duplicated markup:

| # | Page File | Shipped Static Template | Total Links | Notes |
|---|---|---|---|---|
| 1 | `frontend/pages/dashboard_admin.html` | Template 1 (Admin) | 18 | Admin Dashboard |
| 2 | `frontend/pages/burial-scheduling.html` | Template 1 (Admin) | 18 | Shared Admin/Staff |
| 3 | `frontend/pages/manage-reservations.html` | Template 1 (Admin) | 18 | Shared Admin/Staff |
| 4 | `frontend/pages/cremation-management.html` | Template 1 (Admin) | 18 | Admin Columbarium Grid |
| 5 | `frontend/pages/manage-cremations.html` | Template 1 (Admin) | 18 | Shared Admin/Staff List |
| 6 | `frontend/pages/relocation-management.html` | Template 1 (Admin) | 18 | Admin Only |
| 7 | `frontend/pages/expiration-monitoring.html` | Template 1 (Admin) | 18 | Admin Only |
| 8 | `frontend/pages/lot-management.html` | Template 1 (Admin) | 18 | Shared Admin/Staff |
| 9 | `frontend/pages/decedent-records.html` | Template 1 (Admin) | 18 | Shared Admin/Staff |
| 10 | `frontend/pages/reports.html` | Template 1 (Admin) | 18 | Admin Only |
| 11 | `frontend/pages/forecast.html` | Template 1 (Admin) | 18 | Admin Only |
| 12 | `frontend/pages/ai.html` | Template 1 (Admin) | 18 | Admin Only |
| 13 | `frontend/pages/exceptions.html` | Template 1 (Admin) | 18 | Shared Admin/Staff |
| 14 | `frontend/pages/user-management.html` | Template 1 (Admin) | 18 | Admin Only |
| 15 | `frontend/pages/audit.html` | Template 1 (Admin) | 18 | Admin Only |
| 16 | `frontend/pages/payments.html` | Template 1 (Admin) | 18 | Shared Admin/Staff/User (Rebuilt via JS) |
| 17 | `frontend/pages/dashboard_staff.html` | Template 3 (Staff) | 8 | Staff Dashboard (*Missing Records*) |
| 18 | `frontend/pages/dashboard_user.html` | Template 2 (User) | 11 | Citizen Dashboard |
| 19 | `frontend/pages/book-a-service.html` | Template 2 (User) | 11 | Citizen Booking Hub |
| 20 | `frontend/pages/reserve-burial-slot.html` | Template 2 (User) | 11 | Citizen Burial Wizard |
| 21 | `frontend/pages/my-reservations.html` | Template 2 (User) | 11 | Citizen Burial List |
| 22 | `frontend/pages/reserve-cremation.html` | Template 2 (User) | 11 | Citizen Cremation Wizard |
| 23 | `frontend/pages/my-cremations.html` | Template 2 (User) | 11 | Citizen Cremation List |
| 24 | `frontend/pages/my-records.html` | Template 2 (User) | 11 | Citizen Decedent Records |
| 25 | `frontend/pages/payment-history.html` | Template 2 (User) | 11 | Citizen Payment History |
| 26 | `frontend/pages/notifications.html` | Template 2 (User) | 11 | Shared Admin/Staff/User (Rebuilt via JS) |
| 27 | `frontend/pages/profile.html` | Template 2 (User) | 11 | Shared Admin/Staff/User (Rebuilt via JS) |
| 28 | `frontend/pages/settings.html` | Template 2 (User) | 11 | Shared Admin/Staff/User (Rebuilt via JS) |

---

## 3. Current Navigation Structure Per Role

### 3.1 Current Admin Structure (18 Links)
- **Top Level:** Dashboard (`dashboard_admin.html`)
- **Operations:**
  - Lot Management (`lot-management.html`)
  - Burial Scheduling (`burial-scheduling.html`)
  - Manage Reservations (`manage-reservations.html`)
- **Records:**
  - Decedent Records (`decedent-records.html`)
  - Cremation Management (`cremation-management.html`)
  - Manage Cremations (`manage-cremations.html`)
  - Relocation Management (`relocation-management.html`)
  - Expiration Monitoring (`expiration-monitoring.html`)
- **Finance:**
  - Payments (`payments.html`)
- **AI & Automation:**
  - AI Configuration (`ai.html`)
  - Capacity Forecast (`forecast.html`)
  - Exceptions (`exceptions.html`)
- **Reports:**
  - Reports (`reports.html`)
- **System:**
  - User Management (`user-management.html`)
  - Settings (`settings.html`)
  - Audit Logs (`audit.html`)
  - Profile (`profile.html`)

### 3.2 Current Staff Structure (Inconsistent: 8 vs 11 Links)
- **As Shipped on `dashboard_staff.html` (8 Links):**
  - Dashboard (`dashboard_staff.html`)
  - Operations: Burial Scheduling, Manage Reservations, Lot Management
  - Finance: Payments
  - AI & Automation: Exceptions
  - System: Settings, Profile
  *(Records group is completely absent)*
- **As Rebuilt by `ROLE_SIDEBAR_LINKS.staff` / Filtered Admin Template (11 Links):**
  - Dashboard (`dashboard_staff.html`)
  - Operations: Burial Scheduling, Manage Reservations, Lot Management
  - Records: Decedent Records, Manage Cremations
  - Finance: Payments
  - AI & Automation: Exceptions
  - System: Settings, Profile

### 3.3 Current User/Citizen Structure (Inconsistent: 10 vs 11 Links)
- **As Shipped on `dashboard_user.html` (11 Links):**
  - Dashboard (`dashboard_user.html`)
  - Operations: Book a Service (`book-a-service.html`), Reserve Burial Slot, My Reservations, Reserve Cremation, My Cremations
  - Records: My Records (`my-records.html`)
  - Finance: Payments, Payment History
  - System: Settings, Profile
- **As Rebuilt by `ROLE_SIDEBAR_LINKS.user` (10 Links):**
  - Dashboard (`dashboard_user.html`)
  - Operations: Reserve Burial Slot, My Reservations, Reserve Cremation, My Cremations *(Missing Book a Service)*
  - Records: My Records
  - Finance: Payments, Payment History
  - System: Settings, Profile

---

## 4. Navigation Problems

1. **Severe Code Duplication:** Over 1,500 lines of identical HTML markup repeated across 28 separate files. Any change to a group name, icon, or menu link currently requires updating dozens of HTML files.
2. **Dynamic / Static Collision:** Four pages (`payments.html`, `notifications.html`, `profile.html`, `settings.html`) rebuild their sidebar at runtime via JavaScript (`renderSidebarForRole`), while the other 24 pages rely on DOM removal (`filterSidebarByRole`). This causes items to appear, disappear, or reorder depending on which page the user navigated from.
3. **Ghost Items on Initial Page Load:** When an Admin opens a page that ships the User template (e.g. `notifications.html`), the user template is visible in static HTML for a split-second until `requireRole()` finishes authenticating and rebuilds the sidebar.
4. **Ordering Inconsistencies:** In Admin static HTML, `Lot Management` is item #1 in Operations. In `ROLE_SIDEBAR_LINKS.staff`, `Lot Management` is item #3 in Operations. The visual order jumps as staff navigates between pages.
5. **Excessive / Single-Item Groups:** The `Reports` category in the Admin sidebar contains only a single item (`reports.html`). Having an accordion dropdown for a single item adds unnecessary clicks and vertical clutter.

---

## 5. Incorrect Module Grouping

The current information architecture suffers from semantic confusion:

1. **Ground Lots vs. Columbarium Niches Split Arbitrarily:**
   - `Lot Management` is placed under **Operations**.
   - `Cremation Management` (the columbarium niche grid) is placed under **Records**.
   - *Problem:* Both are physical cemetery space/inventory modules. There is no logical reason for ground lots to be in Operations while niches are in Records.
2. **Operational Workflows Misclassified as Records:**
   - `Relocation Management` (interment transfers) and `Expiration Monitoring` (lease renewals/exhumations) are active, multi-step operational lifecycle workflows, but are currently buried inside **Records**.
3. **Administrative Exceptions Grouped with AI:**
   - `Exceptions` (`exceptions.html`) is a system-wide incident resolution queue for failed business automations (such as failed payment verifications or schedule auto-cancellations). It is grouped under **AI & Automation**, confusing staff who need to resolve business exceptions without using AI.
4. **Configuration Grouped with Predictive Analytics:**
   - `AI Configuration` (`ai.html`), which is an administrative settings console for API keys, prompt templates, and knowledge bases, is grouped alongside `Capacity Forecast` (`forecast.html`), which is an executive predictive capacity report.

---

## 6. RBAC Navigation Inconsistencies

1. **Staff Dashboard Records Blindspot:**
   - Staff is authorized to manage `decedent-records.html` and `manage-cremations.html` (`PAGE_ROLE_ACCESS` permits `['admin', 'staff']`).
   - However, `dashboard_staff.html` completely lacks the `Records` group in its static markup.
   - Because `dashboard_staff.html` is not in `PAGES_NEEDING_SIDEBAR_REBUILD`, `filterSidebarByRole` only operates by subtracting links. Consequently, when staff is on their dashboard, they cannot navigate to Decedent Records or Manage Cremations.
2. **Missing RBAC Mapping for `book-a-service.html`:**
   - `book-a-service.html` is omitted from `PAGE_ROLE_ACCESS` in `assets/js/shared/api.js`.
   - While permitted by default because it lacks an entry, this omission bypasses the centralized role authorization lookup.

---

## 7. Duplicate Menu Items

1. **Dual Cremation Links with Confusing Labels:**
   - In Admin: `Cremation Management` (`cremation-management.html`) vs `Manage Cremations` (`manage-cremations.html`).
   - Both reside under the `Records` group with identical or near-identical naming.
   - *Distinction:* `cremation-management.html` is the physical columbarium niche grid and direct slot booking console, whereas `manage-cremations.html` is the list queue of citizen-submitted cremation requests.
   - *Resolution:* Group `Cremation Management` alongside other spatial/inventory records, or clearly differentiate operational request processing from inventory management.

---

## 8. Missing Navigation Items

1. **`book-a-service.html` Missing in Dynamic Rebuilds:**
   - `book-a-service.html` is the citizen service portal hub where citizens choose between burial and cremation.
   - It is defined in `dashboard_user.html` static HTML, but **completely missing** from `ROLE_SIDEBAR_LINKS.user`.
   - *Symptom:* When a citizen visits `payments.html`, `profile.html`, or `settings.html`, `renderSidebarForRole('user')` triggers and removes "Book a Service" from their sidebar. When they return to `dashboard_user.html`, it reappears.
2. **`notifications.html` Sidebar Access:**
   - `notifications.html` is accessible via the top-bar bell icon, but has no presence in the sidebar. This is acceptable, but its sidebar markup must be kept in sync when visited.

---

## 9. Proposed Admin Sidebar Structure

A streamlined 6-category structure based strictly on actual system modules:

```text
======================================================================
[OVERVIEW]
  * Dashboard                        (dashboard_admin.html   | fa-gauge-high)

[OPERATIONS]
  * Burial Scheduling                (burial-scheduling.html | fa-monument)
  * Manage Reservations              (manage-reservations.html | fa-calendar-check)
  * Cremation Management             (cremation-management.html | fa-fire)
  * Manage Cremations                (manage-cremations.html | fa-calendar-check)
  * Relocation Management            (relocation-management.html | fa-truck-moving)
  * Expiration Monitoring            (expiration-monitoring.html | fa-hourglass-half)

[RECORDS]
  * Lot Management                   (lot-management.html    | fa-map-location-dot)
  * Decedent Records                 (decedent-records.html  | fa-folder-open)

[FINANCE]
  * Payments                         (payments.html          | fa-credit-card)

[INTELLIGENCE & ANALYTICS]
  * Reports                          (reports.html           | fa-chart-column)
  * Capacity Forecast                (forecast.html          | fa-chart-line)

[SYSTEM ADMINISTRATION]
  * User Management                  (user-management.html   | fa-users)
  * System Exceptions                (exceptions.html        | fa-triangle-exclamation)
  * AI Configuration                 (ai.html                | fa-robot)
  * Audit Logs                       (audit.html             | fa-clipboard-list)
  * Settings                         (settings.html          | fa-gear)
  * Profile                          (profile.html           | fa-id-card)
======================================================================
```

### Improvements:
- **Operations:** Groups all time-sensitive scheduling, booking queues, remains relocations, and lease expirations together.
- **Records:** Consolidates physical lot/cemetery inventory with decedent records.
- **Intelligence & Analytics:** Combines statistical reporting with ARIMA forecasting, eliminating the awkward single-item `Reports` dropdown.
- **System Administration:** Consolidates user management, automated exception queues, audit logs, AI configuration, settings, and profile in one coherent administration section.

---

## 10. Proposed Staff Sidebar Structure

Staff navigation contains only operational workflows and records permitted by staff RBAC:

```text
======================================================================
[OVERVIEW]
  * Dashboard                        (dashboard_staff.html   | fa-gauge-high)

[OPERATIONS]
  * Burial Scheduling                (burial-scheduling.html | fa-monument)
  * Manage Reservations              (manage-reservations.html | fa-calendar-check)
  * Manage Cremations                (manage-cremations.html | fa-calendar-check)

[RECORDS]
  * Lot Management                   (lot-management.html    | fa-map-location-dot)
  * Decedent Records                 (decedent-records.html  | fa-folder-open)

[FINANCE]
  * Payments                         (payments.html          | fa-credit-card)

[SYSTEM]
  * System Exceptions                (exceptions.html        | fa-triangle-exclamation)
  * Settings                         (settings.html          | fa-gear)
  * Profile                          (profile.html           | fa-id-card)
======================================================================
```

### Improvements:
- Fully resolves the bug where `dashboard_staff.html` lacked the `Records` group.
- Matches staff operational privileges exactly: staff can manage lots, schedules, reservations, cremation bookings, decedent records, payments, and resolve exceptions.
- Completely hides admin-only modules (`cremation-management.html`, `relocation-management.html`, `expiration-monitoring.html`, `reports.html`, `forecast.html`, `ai.html`, `user-management.html`, `audit.html`).

---

## 11. Proposed User / Citizen Sidebar Structure

Citizen navigation is clean, simple, and self-service oriented:

```text
======================================================================
[OVERVIEW]
  * Dashboard                        (dashboard_user.html    | fa-gauge-high)

[OPERATIONS]
  * Book a Service                   (book-a-service.html    | fa-handshake)
  * Reserve Burial Slot              (reserve-burial-slot.html | fa-monument)
  * My Reservations                  (my-reservations.html   | fa-bookmark)
  * Reserve Cremation                (reserve-cremation.html | fa-fire)
  * My Cremations                    (my-cremations.html     | fa-box-archive)

[RECORDS]
  * My Records                       (my-records.html        | fa-folder-open)

[FINANCE]
  * Payments                         (payments.html          | fa-credit-card)
  * Payment History                  (payment-history.html   | fa-receipt)

[SYSTEM]
  * Settings                         (settings.html          | fa-gear)
  * Profile                          (profile.html           | fa-id-card)
======================================================================
```

### Improvements:
- Permanently stabilizes `Book a Service` across every citizen page.
- Provides immediate access to burial booking, cremation booking, reservation tracking, payment history, and linked decedent records.

---

## 12. Recommended UX Navigation Pattern

**Recommendation: Pattern D — Enhanced Hybrid Navigation**

The system's current hybrid model is robust, responsive, and should be preserved and polished rather than replaced:

1. **Single-Open Accordion on Desktop (>=1025px):**
   - Opening one category automatically collapses the previously open category.
   - Smooth CSS height transition (`max-height: 480px`).
   - The category containing the current active page automatically opens on initial load.
2. **Desktop Manual Icon-Rail (`.rail-manual`):**
   - Click `#railToggleBtn` to collapse the 260px sidebar into a 70px icon-only rail.
   - Preserves state across page loads via `localStorage['cms-sidebar-rail']`.
   - Tooltips / icons remain accessible while freeing up horizontal space for large tables and map views.
3. **Automatic Tablet Icon-Rail (769px - 1024px):**
   - Viewport automatically adapts to a 70px icon-only rail without requiring manual toggle.
4. **Mobile Off-Canvas Drawer (<=768px):**
   - Sidebar is off-canvas by default.
   - Clicking hamburger `#toggleSidebar` smoothly slides the 260px drawer into view over a dimmed overlay scrim (`--overlay-scrim`).
   - Categories remain expanded in mobile drawer mode (`max-height: none`) for immediate touch access.

---

## 13. Centralization Strategy

To eliminate code duplication, cross-page link discrepancies, and maintenance headaches, we propose a **Client-Side Configuration-Driven Sidebar Architecture**:

### 13.1 Architecture Overview
Create a centralized module: [`assets/js/shared/navigation-config.js`](file:///c:/laragon/www/CMS/assets/js/shared/navigation-config.js).

This module will define:
1. `NAVIGATION_CONFIG`:
   ```javascript
   const NAVIGATION_CONFIG = {
       admin: [
           { item: { href: 'dashboard_admin.html', icon: 'fa-gauge-high', label: 'Dashboard' } },
           { group: 'Operations', items: [
               { href: 'burial-scheduling.html', icon: 'fa-monument', label: 'Burial Scheduling' },
               { href: 'manage-reservations.html', icon: 'fa-calendar-check', label: 'Manage Reservations' },
               { href: 'cremation-management.html', icon: 'fa-fire', label: 'Cremation Management' },
               { href: 'manage-cremations.html', icon: 'fa-calendar-check', label: 'Manage Cremations' },
               { href: 'relocation-management.html', icon: 'fa-truck-moving', label: 'Relocation Management' },
               { href: 'expiration-monitoring.html', icon: 'fa-hourglass-half', label: 'Expiration Monitoring' },
           ]},
           { group: 'Records', items: [
               { href: 'lot-management.html', icon: 'fa-map-location-dot', label: 'Lot Management' },
               { href: 'decedent-records.html', icon: 'fa-folder-open', label: 'Decedent Records' },
           ]},
           { group: 'Finance', items: [
               { href: 'payments.html', icon: 'fa-credit-card', label: 'Payments' },
           ]},
           { group: 'Intelligence & Analytics', items: [
               { href: 'reports.html', icon: 'fa-chart-column', label: 'Reports' },
               { href: 'forecast.html', icon: 'fa-chart-line', label: 'Capacity Forecast' },
           ]},
           { group: 'System Administration', items: [
               { href: 'user-management.html', icon: 'fa-users', label: 'User Management' },
               { href: 'exceptions.html', icon: 'fa-triangle-exclamation', label: 'System Exceptions' },
               { href: 'ai.html', icon: 'fa-robot', label: 'AI Configuration' },
               { href: 'audit.html', icon: 'fa-clipboard-list', label: 'Audit Logs' },
               { href: 'settings.html', icon: 'fa-gear', label: 'Settings' },
               { href: 'profile.html', icon: 'fa-id-card', label: 'Profile' },
           ]},
       ],
       staff: [ ... ],
       user: [ ... ]
   };
   ```
2. **Derived RBAC Validation:**
   Instead of maintaining a separate hand-typed `PAGE_ROLE_ACCESS` dictionary, automatically compute `PAGE_ROLE_ACCESS` from `NAVIGATION_CONFIG`. If a page is in `NAVIGATION_CONFIG.staff`, staff is permitted. This guarantees that route authorization and menu visibility can never disagree.

3. **Unified Auto-Mounting:**
   Inside `requireRole()` (which every page already calls):
   - Replace the legacy dual `filterSidebarByRole` / `renderSidebarForRole` logic with a single unified call: `mountSidebarForRole(user.role)`.
   - Automatically detects current page from `window.location.pathname`.
   - Injects the active class `class="nav-item active"` on the exact active item.
   - Automatically calls `window.initSidebarNav()` to bind accordion and rail controls.

---

## 14. Affected Files

### Core Shared Infrastructure Files:
1. `assets/js/shared/navigation-config.js` *(NEW - Centralized source of truth)*
2. `assets/js/shared/api.js` *(Update requireRole, derive PAGE_ROLE_ACCESS from config)*
3. `assets/js/shared/sidebar-nav.js` *(Ensure robust rebinding and active group detection)*
4. `assets/css/components/sidebar-nav-groups.css` *(Add support for new group titles like Intelligence & Analytics)*

### Page HTML Files (28 Pages):
- Retain identical HTML shell structure, but replace inner hardcoded `.sidebar-nav` link lists with the clean standardized dynamic mount container:
  ```html
  <div class="sidebar-nav" id="sidebarNav"></div>
  ```
- Or maintain static HTML as a graceful fallback while `mountSidebarForRole` renders the canonical version instantaneously upon session resolution.

### Automated Test Files:
- `tests/smoke_test.py` *(Update smoke test assertions to check navigation config & centralized sidebar)*

---

## 15. Migration / Implementation Plan

We recommend executing the sidebar overhaul in three safe, phased steps with verification checkpoints:

### Phase 1: Centralized Configuration Engine
- Create `assets/js/shared/navigation-config.js` with `NAVIGATION_CONFIG` for `admin`, `staff`, and `user`.
- Add unit/regression tests in `tests/smoke_test.py` ensuring every valid route exists in the configuration with correct icons and labels.
- Update `assets/js/shared/api.js` to derive `PAGE_ROLE_ACCESS` and implement `mountSidebarForRole(role)`.

### Phase 2: Core Template Synchronization
- Update `dashboard_admin.html`, `dashboard_staff.html`, and `dashboard_user.html` to adopt the new semantic groupings.
- Verify role transitions: Admin sees full system; Staff sees operational queues and records; Citizen sees self-service booking.
- Verify that `book-a-service.html` and `dashboard_staff.html` records visibility are completely fixed.

### Phase 3: Project-Wide Rollout & Static Cleanup
- Roll out `mountSidebarForRole()` across all 28 pages.
- Standardize HTML templates so all pages load without visual flicker or ghost items.
- Run `python tests/run_all_tests.py` and perform responsive checks (Desktop 1920px, Desktop Rail 1200px, Tablet 768px, Mobile 375px).

---

## 16. Risks and Backward Compatibility Considerations

1. **JavaScript-Disabled Environments:**
   - The application already requires JavaScript for JWT authentication (`api.getMe()`), API calls, and all forms. A client-side rendered sidebar introduces zero new runtime dependencies.
2. **Initial Render Flicker:**
   - If `.sidebar-nav` is empty before JS executes, users on slow connections might see a momentarily blank sidebar.
   - *Mitigation:* Retain a clean static HTML baseline for the primary role of each page, or use CSS skeleton styling until `mountSidebarForRole` executes.
3. **CSS Class Specificity:**
   - Ensure new group names (e.g. `Intelligence & Analytics`, `System Administration`) fit comfortably in the 260px sidebar without awkward text wrapping. Font size is currently `0.68rem` with `letter-spacing: 0.06em`, which fits easily.
4. **Desktop Rail and Mobile Drawer State:**
   - Dynamic re-rendering must preserve `localStorage['cms-sidebar-rail']` and not detach or break `#railToggleBtn` or `#toggleSidebar`. This is already guaranteed by placing `#railToggleBtn` in `.sidebar-header` and `#toggleSidebar` in `.top-bar`, both of which reside outside `.sidebar-nav`.

