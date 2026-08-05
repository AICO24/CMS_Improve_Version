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

document.addEventListener('DOMContentLoaded', async () => {
    const currentPath = window.location.pathname;
    const currentPage = currentPath.split('/').pop();

    document.querySelectorAll('.sidebar .nav-item').forEach(link => {
        const href = link.getAttribute('href');
        if (!href) return;

        let linkPath;
        try {
            linkPath = new URL(href, window.location.origin).pathname;
        } catch {
            linkPath = href.split('?')[0].split('#')[0];
        }

        const linkPage = linkPath.split('/').pop();
        if (linkPage === currentPage) {
            link.classList.add('active');
        }
    });

    const adminElements = document.querySelectorAll('.admin-only');
    if (!adminElements.length) {
        return;
    }

    const publicPages = ['login.html', 'register.html'];
    if (publicPages.includes(currentPage)) {
        return;
    }

    const sessionUser = JSON.parse(localStorage.getItem('user_session') || '{}');
    const sessionRole = sessionUser && sessionUser.role ? String(sessionUser.role).toLowerCase() : '';
    const sessionIsAdmin = sessionRole.includes('admin');

    try {
        const user = await api.getMe();
        // Debug: show resolved user role and session role in console
        console.debug('client.js: fetched user for admin check', { user, sessionUser, sessionIsAdmin });
        const isAdmin = user.role === 'admin';
        adminElements.forEach(el => {
            if (isAdmin) {
                el.style.display = 'flex';
                el.classList.remove('admin-only');
            } else {
                el.style.display = 'none';
            }
        });
        return;
    } catch (error) {
        console.debug('client.js: auth/me failed, falling back to sessionUser', { sessionUser, sessionIsAdmin, error });
        adminElements.forEach(el => {
            if (sessionIsAdmin) {
                el.style.display = 'flex';
                el.classList.remove('admin-only');
            } else {
                el.style.display = 'none';
            }
        });
    }
});
