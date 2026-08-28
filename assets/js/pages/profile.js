document.addEventListener('DOMContentLoaded', async function() {
    if (!localStorage.getItem('jwt_token')) {
        window.location.href = `${getFrontendBasePath()}/auth/login.html`;
        return;
    }

    try {
        const user = await api.getMe();
        if (!user) {
            window.location.href = `${getFrontendBasePath()}/auth/login.html`;
            return;
        }

        const fullName = user.full_name || user.username || 'Client';
        const roleLabel = user.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1)) : 'User';

        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.innerText = value;
        };

        setText('userName', fullName);
        setText('userRole', roleLabel);
        setText('sidebarUserName', fullName);
        setText('sidebarUserRole', roleLabel);
        setText('profileFullName', fullName);
        setText('profileUsername', user.username || '—');
        setText('profileEmail', user.email || '—');
        setText('profileRole', roleLabel);
        renderSidebarForRole(user.role);
        if (typeof window.initSidebarNav === 'function') {
            window.initSidebarNav();
        }
    } catch (error) {
        console.error('Failed to load profile', error);
        window.location.href = `${getFrontendBasePath()}/auth/login.html`;
        return;
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => api.logout());
    }

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => sidebar.classList.toggle('collapsed'));
    }

    document.getElementById('notificationIcon')?.addEventListener('click', () => {
        window.location.href = `${getFrontendBasePath()}/pages/notifications.html`;
    });

    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                const count = Number(result.count || 0);
                badge.innerText = String(count);
                badge.style.display = count > 0 ? 'flex' : 'none';
            }
        } catch (error) {
            console.error('Failed to load notification badge', error);
        }
    }

    await updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
