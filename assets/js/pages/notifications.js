document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin', 'staff', 'user']);
    if (!user) return;

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

    // Type -> {icon, tone} for the per-notification icon swatch and pill.
    // Tone maps onto the same success/warning/info/neutral vocabulary as
    // components/badges.css. Values match the notification_type strings
    // actually written server-side (grepped across backend/controllers/).
    const TYPE_META = {
        Schedule: { icon: 'fa-calendar-check', tone: 'info' },
        Payment: { icon: 'fa-credit-card', tone: 'success' },
        Expiration: { icon: 'fa-hourglass-half', tone: 'warning' },
        Relocation: { icon: 'fa-truck-moving', tone: 'info' },
        System: { icon: 'fa-gear', tone: 'neutral' },
    };
    function typeMeta(type) {
        return TYPE_META[type] || TYPE_META.System;
    }

    async function loadNotifications() {
        try {
            const notifications = await api.request('notifications', { method: 'GET' });
            const list = document.getElementById('notificationList');
            if (!list) {
                return;
            }
            if (!Array.isArray(notifications) || notifications.length === 0) {
                const meta = typeMeta('System');
                list.innerHTML = `
                    <div class="notification-item">
                        <div class="notification-icon-badge tone-${meta.tone}"><i class="fas ${meta.icon}"></i></div>
                        <div class="notification-body">
                            <div class="notification-title">No notifications yet</div>
                            <div class="notification-meta">System updates will appear here.</div>
                        </div>
                    </div>`;
                return;
            }

            list.innerHTML = notifications.map(notification => {
                const type = notification.notification_type || 'System';
                const meta = typeMeta(type);
                return `
                <div class="notification-item ${notification.is_read ? '' : 'unread'}" data-id="${notification.notification_id}">
                    <div class="notification-icon-badge tone-${meta.tone}"><i class="fas ${meta.icon}"></i></div>
                    <div class="notification-body">
                        <div class="notification-title">${notification.title}</div>
                        <div class="notification-meta">${notification.message}</div>
                        <div class="notification-meta">${new Date(notification.created_at).toLocaleString()}</div>
                    </div>
                    <div class="notification-pill badge badge--${meta.tone}">${type}</div>
                </div>
            `;
            }).join('');
        } catch (error) {
            console.error('Failed to load notifications', error);
        }
    }

    // Click an unread notification to mark just that one read (the
    // notifications/{id}/read endpoint already existed server-side with
    // no frontend caller). Already-read items are inert on click.
    const notificationList = document.getElementById('notificationList');
    if (notificationList) {
        notificationList.addEventListener('click', async (event) => {
            const item = event.target.closest('.notification-item.unread');
            if (!item || !item.dataset.id) return;

            item.classList.remove('unread');
            try {
                await api.request(`notifications/${item.dataset.id}/read`, { method: 'PUT' });
                await updateNotificationBadge();
            } catch (error) {
                console.error('Failed to mark notification read', error);
                item.classList.add('unread');
            }
        });
    }

    // Both endpoints below are admin/staff-only (dedup'd sweeps — see their
    // own route comments in api.php) — gated here so a citizen visiting this
    // page doesn't fire two guaranteed-403 calls on every load. Previously
    // only the expiration call existed and had no such gate at all.
    async function generateStarterNotifications() {
        if (user.role !== 'admin' && user.role !== 'staff') return;
        try {
            await api.request('expiration-records/generate-notifications', { method: 'POST' });
        } catch (error) {
            console.error('Failed to generate expiration notifications:', error);
        }
        try {
            await api.request('schedules/notify-stale-pending', { method: 'POST' });
        } catch (error) {
            console.error('Failed to generate stale-reservation reminders:', error);
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
