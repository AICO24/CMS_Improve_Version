/**
 * Centralized Route & Sidebar Navigation Registry
 *
 * Single source of truth for:
 * 1. Route-level authorization (allowedRoles)
 * 2. Sidebar navigation structure and grouping (showInSidebar, sidebarGroup, label, icon)
 * 3. Consistent active page highlighting and rendering
 *
 * NOTE: Authorization is intentionally decoupled from navigation visibility:
 * Pages with showInSidebar: false (e.g. notifications.html) remain fully authorized
 * for permitted roles without appearing in the sidebar navigation.
 */
(function(window) {
    'use strict';

    const ROUTE_CONFIG = [
        // ==================== OVERVIEW DASHBOARDS ====================
        {
            route: 'dashboard_admin.html',
            allowedRoles: ['admin'],
            showInSidebar: true,
            sidebarGroup: 'Overview',
            label: 'Dashboard',
            icon: 'fa-gauge-high',
            navigationOrder: 1,
        },
        {
            route: 'dashboard_staff.html',
            allowedRoles: ['staff'],
            showInSidebar: true,
            sidebarGroup: 'Overview',
            label: 'Dashboard',
            icon: 'fa-gauge-high',
            navigationOrder: 1,
        },
        {
            route: 'dashboard_user.html',
            allowedRoles: ['user'],
            showInSidebar: true,
            sidebarGroup: 'Overview',
            label: 'Dashboard',
            icon: 'fa-gauge-high',
            navigationOrder: 1,
        },

        // ==================== OPERATIONS (Admin & Staff) ====================
        {
            route: 'burial-scheduling.html',
            allowedRoles: ['admin', 'staff'],
            showInSidebar: true,
            sidebarGroup: 'Operations',
            label: 'Burial Scheduling',
            icon: 'fa-monument',
            navigationOrder: 10,
        },
        {
            route: 'manage-reservations.html',
            allowedRoles: ['admin', 'staff'],
            showInSidebar: true,
            sidebarGroup: 'Operations',
            label: 'Manage Reservations',
            icon: 'fa-calendar-check',
            navigationOrder: 11,
        },
        {
            route: 'manage-cremations.html',
            allowedRoles: ['admin', 'staff'],
            showInSidebar: true,
            sidebarGroup: 'Operations',
            label: 'Manage Cremations',
            icon: 'fa-calendar-check',
            navigationOrder: 12,
        },
        {
            route: 'relocation-management.html',
            allowedRoles: ['admin'],
            showInSidebar: true,
            sidebarGroup: 'Operations',
            label: 'Relocation Management',
            icon: 'fa-truck-moving',
            navigationOrder: 13,
        },
        {
            route: 'expiration-monitoring.html',
            allowedRoles: ['admin'],
            showInSidebar: true,
            sidebarGroup: 'Operations',
            label: 'Expiration Monitoring',
            icon: 'fa-hourglass-half',
            navigationOrder: 14,
        },

        // ==================== SERVICES (Citizen / User) ====================
        {
            route: 'book-a-service.html',
            allowedRoles: ['user'],
            showInSidebar: true,
            sidebarGroup: 'Services',
            label: 'Book a Service',
            icon: 'fa-handshake',
            navigationOrder: 10,
        },
        {
            route: 'reserve-burial-slot.html',
            allowedRoles: ['user'],
            showInSidebar: true,
            sidebarGroup: 'Services',
            label: 'Reserve Burial Slot',
            icon: 'fa-monument',
            navigationOrder: 11,
        },
        {
            route: 'reserve-cremation.html',
            allowedRoles: ['user'],
            showInSidebar: true,
            sidebarGroup: 'Services',
            label: 'Reserve Cremation',
            icon: 'fa-fire',
            navigationOrder: 12,
        },
        {
            route: 'my-reservations.html',
            allowedRoles: ['user'],
            showInSidebar: true,
            sidebarGroup: 'Services',
            label: 'My Reservations',
            icon: 'fa-bookmark',
            navigationOrder: 13,
        },
        {
            route: 'my-cremations.html',
            allowedRoles: ['user'],
            showInSidebar: true,
            sidebarGroup: 'Services',
            label: 'My Cremations',
            icon: 'fa-box-archive',
            navigationOrder: 14,
        },

        // ==================== CEMETERY INVENTORY / MANAGEMENT ====================
        {
            route: 'lot-management.html',
            allowedRoles: ['admin', 'staff'],
            showInSidebar: true,
            sidebarGroup: { admin: 'Cemetery Management', staff: 'Cemetery Records' },
            label: 'Lot Management',
            icon: 'fa-map-location-dot',
            navigationOrder: 20,
        },
        {
            route: 'cremation-management.html',
            allowedRoles: ['admin'],
            showInSidebar: true,
            sidebarGroup: 'Cemetery Management',
            label: 'Columbarium Management',
            icon: 'fa-fire',
            navigationOrder: 21,
        },

        // ==================== RECORDS ====================
        {
            route: 'decedent-records.html',
            allowedRoles: ['admin', 'staff'],
            showInSidebar: true,
            sidebarGroup: { admin: 'Records', staff: 'Cemetery Records' },
            label: 'Decedent Records',
            icon: 'fa-folder-open',
            navigationOrder: 30,
        },
        {
            route: 'my-records.html',
            allowedRoles: ['user'],
            showInSidebar: true,
            sidebarGroup: 'Records',
            label: 'My Records',
            icon: 'fa-folder-open',
            navigationOrder: 30,
        },

        // ==================== FINANCE ====================
        {
            route: 'payments.html',
            allowedRoles: ['admin', 'staff', 'user'],
            showInSidebar: true,
            sidebarGroup: 'Finance',
            label: 'Payments',
            icon: 'fa-credit-card',
            navigationOrder: 40,
        },
        {
            route: 'payment-history.html',
            allowedRoles: ['user'],
            showInSidebar: true,
            sidebarGroup: 'Finance',
            label: 'Payment History',
            icon: 'fa-receipt',
            navigationOrder: 41,
        },

        // ==================== INTELLIGENCE & ANALYTICS (Admin) ====================
        {
            route: 'reports.html',
            allowedRoles: ['admin'],
            showInSidebar: true,
            sidebarGroup: 'Intelligence & Analytics',
            label: 'Reports',
            icon: 'fa-chart-column',
            navigationOrder: 50,
        },
        {
            route: 'forecast.html',
            allowedRoles: ['admin'],
            showInSidebar: true,
            sidebarGroup: 'Intelligence & Analytics',
            label: 'Capacity Forecast',
            icon: 'fa-chart-line',
            navigationOrder: 51,
        },

        // ==================== SYSTEM & SYSTEM ADMINISTRATION ====================
        {
            route: 'user-management.html',
            allowedRoles: ['admin'],
            showInSidebar: true,
            sidebarGroup: 'System Administration',
            label: 'User Management',
            icon: 'fa-users',
            navigationOrder: 60,
        },
        {
            route: 'exceptions.html',
            allowedRoles: ['admin', 'staff'],
            showInSidebar: true,
            sidebarGroup: { admin: 'System Administration', staff: 'System' },
            label: 'System Exceptions',
            icon: 'fa-triangle-exclamation',
            navigationOrder: 61,
        },
        {
            route: 'ai.html',
            allowedRoles: ['admin'],
            showInSidebar: true,
            sidebarGroup: 'System Administration',
            label: 'AI Configuration',
            icon: 'fa-robot',
            navigationOrder: 62,
        },
        {
            route: 'audit.html',
            allowedRoles: ['admin'],
            showInSidebar: true,
            sidebarGroup: 'System Administration',
            label: 'Audit Logs',
            icon: 'fa-clipboard-list',
            navigationOrder: 63,
        },

        // ==================== ACCOUNT ====================
        {
            route: 'profile.html',
            allowedRoles: ['admin', 'staff', 'user'],
            showInSidebar: true,
            sidebarGroup: 'Account',
            label: 'Profile',
            icon: 'fa-id-card',
            navigationOrder: 70,
        },
        {
            route: 'settings.html',
            allowedRoles: ['admin', 'staff', 'user'],
            showInSidebar: true,
            sidebarGroup: 'Account',
            label: 'Settings',
            icon: 'fa-gear',
            navigationOrder: 71,
        },

        // ==================== HIDDEN / UTILITY ROUTES ====================
        // Accessible and authorized for all roles, but intentionally hidden from the sidebar navigation
        {
            route: 'notifications.html',
            allowedRoles: ['admin', 'staff', 'user'],
            showInSidebar: false,
            sidebarGroup: null,
            label: 'Notifications',
            icon: 'fa-bell',
            navigationOrder: 99,
        },
    ];

    const ROLE_GROUP_ORDER = {
        admin: [
            'Overview',
            'Operations',
            'Cemetery Management',
            'Records',
            'Finance',
            'Intelligence & Analytics',
            'System Administration',
            'Account',
        ],
        staff: [
            'Overview',
            'Operations',
            'Cemetery Records',
            'Finance',
            'System',
            'Account',
        ],
        user: [
            'Overview',
            'Services',
            'Records',
            'Finance',
            'Account',
        ],
    };

    /**
     * Resolve the sidebar group name for a specific route and role.
     */
    function resolveGroup(item, roleName) {
        if (!item.sidebarGroup) return null;
        if (typeof item.sidebarGroup === 'object') {
            return item.sidebarGroup[roleName] || null;
        }
        return item.sidebarGroup;
    }

    /**
     * Build the full dictionary of page -> allowedRoles for route guards.
     */
    function buildPageRoleAccess() {
        const access = {};
        ROUTE_CONFIG.forEach(function(item) {
            access[item.route] = item.allowedRoles;
        });
        return access;
    }

    /**
     * Get route metadata by filename.
     */
    function getRouteMetadata(routeFileName) {
        return ROUTE_CONFIG.find(function(item) {
            return item.route === routeFileName;
        }) || null;
    }

    /**
     * Check if a given route is authorized for a specific role.
     */
    function isRouteAllowed(routeFileName, role) {
        const roleName = String(role || '').toLowerCase();
        const meta = getRouteMetadata(routeFileName);
        if (!meta) return true; // Unregistered route defaults to open or page-specific check
        return meta.allowedRoles.includes(roleName);
    }

    /**
     * Get organized sidebar groups and items for a role.
     */
    function getSidebarNavForRole(role) {
        const roleName = String(role || '').toLowerCase();
        const groupOrder = ROLE_GROUP_ORDER[roleName] || [];

        // Filter items that are visible in sidebar and permitted for this role
        const visibleItems = ROUTE_CONFIG.filter(function(item) {
            return item.showInSidebar && item.allowedRoles.includes(roleName);
        });

        // Group items
        const grouped = {};
        visibleItems.forEach(function(item) {
            const groupName = resolveGroup(item, roleName);
            if (!groupName) return;
            if (!grouped[groupName]) {
                grouped[groupName] = [];
            }
            grouped[groupName].push(item);
        });

        // Sort items inside each group by navigationOrder
        Object.keys(grouped).forEach(function(grp) {
            grouped[grp].sort(function(a, b) {
                return (a.navigationOrder || 0) - (b.navigationOrder || 0);
            });
        });

        // Return ordered list of groups
        const result = [];
        groupOrder.forEach(function(grpName) {
            if (grouped[grpName] && grouped[grpName].length > 0) {
                result.push({
                    group: grpName,
                    items: grouped[grpName],
                });
            }
        });

        return result;
    }

    /**
     * Render the sidebar navigation markup into the target container.
     *
     * Rules:
     * - Overview (Dashboard): Rendered as a bare standalone .nav-item (no dropdown wrapper)
     * - Multi-item groups: Rendered as a collapsible single-open accordion (.nav-group with .nav-group-header)
     * - Single-item groups: Rendered with a clean static section header (.nav-group.is-static)
     *   to avoid unnecessary double-click dropdown interaction while maintaining section context
     */
    function renderSidebar(container, role, currentRoute) {
        if (!container) return;
        const roleName = String(role || '').toLowerCase();
        const navStructure = getSidebarNavForRole(roleName);
        const activeRoute = (currentRoute || window.location.pathname.split('/').pop() || '').split('?')[0].split('#')[0];

        function renderLink(item) {
            const isActive = item.route === activeRoute;
            return '<a href="' + item.route + '" class="nav-item' + (isActive ? ' active' : '') + '">' +
                   '<i class="fas ' + item.icon + ' icon"></i> ' +
                   '<span>' + item.label + '</span></a>';
        }

        const htmlChunks = [];

        navStructure.forEach(function(section) {
            // Standalone Overview item (Dashboard)
            if (section.group === 'Overview') {
                section.items.forEach(function(item) {
                    htmlChunks.push(renderLink(item));
                });
                return;
            }

            // Single-item group: render directly open without accordion chevron to avoid unnecessary dropdown clicks
            if (section.items.length === 1) {
                htmlChunks.push(
                    '<div class="nav-group is-static open">' +
                        '<div class="nav-group-header static"><span>' + section.group + '</span></div>' +
                        '<div class="nav-group-body">' +
                            renderLink(section.items[0]) +
                        '</div>' +
                    '</div>'
                );
                return;
            }

            // Multi-item category: collapsible single-open accordion
            const bodyLinks = section.items.map(renderLink).join('');
            htmlChunks.push(
                '<div class="nav-group">' +
                    '<button type="button" class="nav-group-header">' +
                        '<span>' + section.group + '</span>' +
                        '<i class="fas fa-chevron-down chev"></i>' +
                    '</button>' +
                    '<div class="nav-group-body">' +
                        bodyLinks +
                    '</div>' +
                '</div>'
            );
        });

        container.innerHTML = htmlChunks.join('');

        // Rebind accordion & rail listeners to newly mounted DOM elements
        if (typeof window.initSidebarNav === 'function') {
            window.initSidebarNav();
        }
    }

    // Export to global scope
    window.CMS_NAVIGATION = {
        ROUTE_CONFIG: ROUTE_CONFIG,
        ROLE_GROUP_ORDER: ROLE_GROUP_ORDER,
        buildPageRoleAccess: buildPageRoleAccess,
        getRouteMetadata: getRouteMetadata,
        isRouteAllowed: isRouteAllowed,
        getSidebarNavForRole: getSidebarNavForRole,
        renderSidebar: renderSidebar,
    };

    // Backward compatibility aliases
    window.ROUTE_CONFIG = ROUTE_CONFIG;

})(typeof window !== 'undefined' ? window : this);

