document.addEventListener('DOMContentLoaded', async function() {
    try {
        const user = await api.getMe();
        if (!user) {
            window.location.href = `${getFrontendBasePath()}/auth/login.html`;
            return;
        }
        document.getElementById('userName').innerText = user.full_name || user.username;
        document.getElementById('userRole').innerText = user.role === 'admin' ? 'Administrator' : 'Staff';
        document.getElementById('sidebarUserName').innerText = user.full_name || user.username;
        document.getElementById('sidebarUserRole').innerText = user.role === 'admin' ? 'Administrator' : 'Staff';
    } catch (error) {
        window.location.href = `${getFrontendBasePath()}/auth/login.html`;
        return;
    }

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => sidebar.classList.toggle('collapsed'));
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => api.logout());
    }

    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.innerText = result.count || 0;
                badge.style.display = result.count > 0 ? 'flex' : 'none';
            }
        } catch (e) {
            console.error('Failed to load notification count:', e);
        }
    }

    async function loadNotifications() {
        try {
            const notifications = await api.request('notifications', { method: 'GET' });
            const list = document.getElementById('notificationList');
            if (!list) {
                return;
            }
            if (!Array.isArray(notifications) || notifications.length === 0) {
                list.innerHTML = '<div class="notification-item"><div><div class="notification-title">No notifications yet</div><div class="notification-meta">System updates will appear here.</div></div></div>';
                return;
            }

            list.innerHTML = notifications.map(notification => `
                <div class="notification-item ${notification.is_read ? '' : 'unread'}">
                    <div>
                        <div class="notification-title">${notification.title}</div>
                        <div class="notification-meta">${notification.message}</div>
                        <div class="notification-meta">${new Date(notification.created_at).toLocaleString()}</div>
                    </div>
                    <div class="notification-pill">${notification.notification_type || 'System'}</div>
                </div>
            `).join('');
        } catch (error) {
            console.error('Failed to load notifications', error);
        }
    }

    async function generateStarterNotifications() {
        try {
            await api.request('expiration-records/generate-notifications', { method: 'POST' });
        } catch (error) {
            console.error('Failed to generate expiration notifications:', error);
        }
    }

    const markAllReadBtn = document.getElementById('markAllReadBtn');
    if (markAllReadBtn) {
        markAllReadBtn.addEventListener('click', async () => {
            try {
                await api.request('notifications/mark-all-read', { method: 'PUT' });
                await loadNotifications();
                await updateNotificationBadge();
            } catch (error) {
                console.error('Failed to mark notifications read', error);
            }
        });
    }

    await generateStarterNotifications();
    await updateNotificationBadge();
    await loadNotifications();
    setInterval(updateNotificationBadge, 30000);
});
