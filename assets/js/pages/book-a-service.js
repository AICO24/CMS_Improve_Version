// Book a Service — Operations Command Center
document.addEventListener('DOMContentLoaded', async function() {
    let currentUser = null;
    try {
        currentUser = await requireRole(['admin', 'staff', 'user']);
        if (!currentUser) return;
    } catch (error) {
        console.error('Auth error', error);
        return;
    }

    // Role-based sidebar rendering & user pill sync
    if (typeof renderSidebarForRole === 'function') {
        renderSidebarForRole(currentUser.role);
    }

    const userNameEl = document.getElementById('userName');
    const userRoleEl = document.getElementById('userRole');
    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserRole = document.getElementById('sidebarUserRole');

    const displayName = currentUser.name || currentUser.username || 'User';
    const displayRole = currentUser.role ? (currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)) : 'Client';

    if (userNameEl) userNameEl.textContent = displayName;
    if (userRoleEl) userRoleEl.textContent = displayRole;
    if (sidebarUserName) sidebarUserName.textContent = displayName;
    if (sidebarUserRole) sidebarUserRole.textContent = displayRole;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn && typeof api !== 'undefined' && typeof api.logout === 'function') {
        logoutBtn.addEventListener('click', () => {
            api.logout();
        });
    }

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Dynamic Live Capacity Ticker
    async function loadCapacityMetrics() {
        try {
            if (typeof api !== 'undefined') {
                const lotsRes = await api.request('lots?per_page=1&status=Available', { method: 'GET' });
                if (lotsRes && typeof lotsRes.total !== 'undefined') {
                    const lotEl = document.getElementById('tickerLotsCount');
                    if (lotEl) lotEl.textContent = `${lotsRes.total} Available`;
                }

                const cremRes = await api.request('cremations?per_page=1', { method: 'GET' });
                if (cremRes && typeof cremRes.total !== 'undefined') {
                    const nicheEl = document.getElementById('tickerNichesCount');
                    if (nicheEl) nicheEl.textContent = `${cremRes.total} Active`;
                }
            }
        } catch (e) {
            // Silently fallback to static labels
            console.log('Capacity metric fallback active', e);
        }
    }

    loadCapacityMetrics();
});
