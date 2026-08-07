function getFrontendBasePath() {
    const currentPath = window.location.pathname || '';
    if (currentPath.includes('/frontend/')) {
        const prefix = currentPath.split('/frontend/')[0];
        return `${window.location.origin}${prefix}/frontend`;
    }

    if (currentPath.includes('/frontend')) {
        return `${window.location.origin}${currentPath.split('/frontend')[0]}/frontend`;
    }

    return `${window.location.origin}/CMS/frontend`;
}

const basePath = window.location.pathname.includes('/frontend/')
    ? window.location.pathname.split('/frontend/')[0]
    : window.location.pathname.split('/frontend')[0] || '';
const API_BASE = `${window.location.origin}${basePath}/backend/api`;

function getLoginRedirectUrl() {
    return `${getFrontendBasePath()}/auth/login.html`;
}

function getRoleDashboardPath(role) {
    const basePath = getFrontendBasePath();
    const roleName = String(role || '').toLowerCase();

    if (roleName === 'admin') {
        return `${basePath}/pages/dashboard_admin.html`;
    }

    if (roleName === 'staff') {
        return `${basePath}/pages/dashboard_staff.html`;
    }

    return `${basePath}/pages/dashboard_user.html`;
}

class ApiClient {
    constructor() {
        this.token = localStorage.getItem('jwt_token');
    }

    setToken(token) {
        this.token = token;
        if (token) {
            localStorage.setItem('jwt_token', token);
        } else {
            localStorage.removeItem('jwt_token');
        }
    }

    async request(endpoint, options = {}) {
        const isFormData = options.body instanceof FormData;
        const headers = {
            ...(options.headers || {}),
        };

        if (!isFormData) {
            headers['Content-Type'] = 'application/json';
        }

        if (this.token) {
            headers.Authorization = `Bearer ${this.token}`;
        }

        const response = await fetch(`${API_BASE}/${endpoint}`, {
            ...options,
            headers,
            body: isFormData ? options.body : options.body ? JSON.stringify(options.body) : undefined,
        });

        const data = await response.json().catch(() => ({}));

        if (!response.ok) {
            if (response.status === 401) {
                this.setToken(null);
                localStorage.removeItem('user_session');
                localStorage.removeItem('cemetery_session');
                window.location.href = getLoginRedirectUrl();
            }
            throw new Error(data.error || 'Request failed');
        }

        return data;
    }

    async login(username, password, role = null) {
        // allow calling code to pass either an email or a username in the first argument
        const payload = {};
        if (username && username.includes('@')) payload.email = username;
        else payload.username = username;
        payload.password = password;
        if (role) payload.role = role;

        const result = await this.request('auth/login', {
            method: 'POST',
            body: payload,
        });

        if (result.token) {
            this.setToken(result.token);
        }

        // Normalize role value to 'admin' or 'staff' when possible
        if (result && result.user && result.user.role) {
            const r = String(result.user.role).toLowerCase();
            if (r.includes('admin')) result.user.role = 'admin';
            else if (r.includes('staff')) result.user.role = 'staff';
            else result.user.role = r;
        }

        return result;
    }

    async register(userData) {
        return await this.request('auth/register', {
            method: 'POST',
            body: userData,
        });
    }

    async getMe() {
        const result = await this.request('auth/me', { method: 'GET' });
        if (result && result.role) {
            const r = String(result.role).toLowerCase();
            if (r.includes('admin')) result.role = 'admin';
            else if (r.includes('staff')) result.role = 'staff';
            else result.role = r;
        }
        return result;
    }

    logout() {
        this.setToken(null);
        localStorage.removeItem('user_session');
        localStorage.removeItem('cemetery_session');
        window.location.href = getLoginRedirectUrl();
    }
}

const api = new ApiClient();

// Shared role-based access control: maps each protected page to the roles
// allowed to view it. This is the single place that resolves the
// server-verified role (never localStorage) and enforces it.
const PAGE_ROLE_ACCESS = {
    'dashboard_admin.html': ['admin'],
    'dashboard_staff.html': ['staff'],
    'dashboard_user.html': ['user'],
    'lot-management.html': ['admin', 'staff'],
    'burial-scheduling.html': ['admin', 'staff'],
    'cremation-management.html': ['admin'],
    'relocation-management.html': ['admin'],
    'expiration-monitoring.html': ['admin'],
    'decedent-records.html': ['admin'],
    'payments.html': ['admin', 'staff', 'user'],
    'reports.html': ['admin'],
    'forecast.html': ['admin'],
    'user-management.html': ['admin'],
    'audit.html': ['admin'],
    'ai.html': ['admin'],
    'reserve-burial-slot.html': ['user'],
    'my-reservations.html': ['user'],
    'payment-history.html': ['user'],
    'my-records.html': ['user'],
    'notifications.html': ['admin', 'staff', 'user'],
    'profile.html': ['admin', 'staff', 'user'],
    'settings.html': ['admin', 'staff', 'user'],
};

const ROLE_LABELS = { admin: 'Administrator', staff: 'Staff', user: 'User' };

function getRoleLabel(role) {
    return ROLE_LABELS[String(role || '').toLowerCase()] || 'User';
}

function getPageFileName(href) {
    try {
        return new URL(href, window.location.origin).pathname.split('/').pop();
    } catch {
        return href.split('?')[0].split('#')[0].split('/').pop();
    }
}

// Removes/hides sidebar links the current role isn't allowed to open, so a
// page shared across roles (e.g. payments.html) never shows nav items (like
// User Management or Audit Logs) that role can't actually access.
function filterSidebarByRole(role) {
    const roleName = String(role || '').toLowerCase();
    document.querySelectorAll('.sidebar .nav-item[href]').forEach((link) => {
        const href = link.getAttribute('href');
        if (!href) return;
        const allowedRoles = PAGE_ROLE_ACCESS[getPageFileName(href)];
        if (allowedRoles && !allowedRoles.includes(roleName)) {
            link.remove();
        }
    });
}

function setUserDisplay(user) {
    const name = user.full_name || user.username || 'User';
    const label = getRoleLabel(user.role);
    ['userName', 'sidebarUserName'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = name;
    });
    ['userRole', 'sidebarUserRole'].forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.textContent = label;
    });
}

// Shared route guard. Call first thing in a protected page's DOMContentLoaded
// handler: `const user = await requireRole(['admin']); if (!user) return;`
// Role comes from api.getMe() (server-verified via the JWT), never from
// localStorage, which is client-editable and cannot be trusted for authorization.
async function requireRole(allowedRoles) {
    let user;
    try {
        user = await api.getMe();
    } catch (error) {
        window.location.href = getLoginRedirectUrl();
        return null;
    }

    if (!user || !user.user_id) {
        window.location.href = getLoginRedirectUrl();
        return null;
    }

    const roleName = String(user.role || '').toLowerCase();
    if (Array.isArray(allowedRoles) && allowedRoles.length && !allowedRoles.includes(roleName)) {
        window.location.href = getRoleDashboardPath(roleName);
        return null;
    }

    setUserDisplay(user);
    filterSidebarByRole(roleName);
    document.querySelectorAll('.admin-only').forEach((el) => {
        if (roleName === 'admin') {
            el.style.display = 'flex';
            el.classList.remove('admin-only');
        } else {
            el.style.display = 'none';
        }
    });

    return user;
}

// Escape closes any open modal (Batch 6 accessibility). Each page already
// closes its modals via `element.style.display = 'none'` from its own
// close-button handler; this just triggers the same thing on Escape, so
// no per-page JS needs to change.
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    document.querySelectorAll('.modal').forEach((modal) => {
        const isOpen = modal.style.display === 'flex' || modal.style.display === 'block';
        if (isOpen) {
            modal.style.display = 'none';
        }
    });
});

// Elements marked role="button" (e.g. the notification icon, which is a
// <div> for layout reasons) don't get native Enter/Space activation the
// way a real <button> does. This dispatches a click for them so any
// existing click handler on that element still fires (Batch 6).
document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const target = e.target;
    if (target && target.matches && target.matches('[role="button"]')) {
        e.preventDefault();
        target.click();
    }
});

// Highlights the sidebar link matching the current page. This runs first
// (api.js loads, and registers this listener, before each page's own
// script); role-based visibility/redirects are handled afterward by
// requireRole(), which each protected page calls explicitly.
document.addEventListener('DOMContentLoaded', () => {
    const currentPage = window.location.pathname.split('/').pop();

    document.querySelectorAll('.sidebar .nav-item').forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;
        if (getPageFileName(href) === currentPage) {
            link.classList.add('active');
        }
    });
});
