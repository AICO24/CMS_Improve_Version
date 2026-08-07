document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin', 'staff', 'user']);
    if (!user) return;

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => api.logout());
    }

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => sidebar.classList.toggle('collapsed'));
    }

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
