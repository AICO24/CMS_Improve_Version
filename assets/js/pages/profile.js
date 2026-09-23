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
        setText('welcomeUserName', fullName);
        setText('welcomeUserUsername', `@${user.username || 'user'}`);
        setText('profileFullName', fullName);
        setText('profileUsername', user.username || '—');
        setText('profileEmail', user.email || '—');
        setText('profileRole', roleLabel);

        const dateEl = document.getElementById('welcomeCurrentDate');
        if (dateEl) {
            const today = new Date();
            dateEl.textContent = today.toLocaleDateString('en-PH', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        }

        const clockEl = document.getElementById('welcomeCurrentTime');
        if (clockEl) {
            const updateClock = () => {
                const now = new Date();
                clockEl.textContent = now.toLocaleTimeString('en-PH', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            };
            updateClock();
            setInterval(updateClock, 1000);
        }

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

    const openNotifications = () => {
        window.location.href = `${getFrontendBasePath()}/pages/notifications.html`;
    };
    const notifBtn = document.getElementById('notificationIcon');
    if (notifBtn) {
        notifBtn.addEventListener('click', openNotifications);
        notifBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openNotifications();
            }
        });
    }

    function initLiveClock() {
        const timeEl = document.getElementById('footerLiveTime');
        const yearEl = document.getElementById('footerYear');
        if (yearEl) yearEl.textContent = String(new Date().getFullYear());
        if (!timeEl) return;
        const tick = () => {
            const now = new Date();
            timeEl.textContent = now.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        };
        tick();
        setInterval(tick, 1000);
    }

    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                const count = Number(result.count || 0);
                badge.textContent = String(count);
                badge.style.display = 'flex';
            }
        } catch (error) {
            console.error('Failed to load notification badge', error);
        }
    }

    initLiveClock();
    await updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
