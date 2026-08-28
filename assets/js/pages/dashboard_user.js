const updateText = (selector, value) => {
    const el = document.getElementById(selector);
    if (el) el.textContent = value;
};

const formatDate = (value) => {
    if (!value) return 'TBD';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return 'TBD';
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
};

const formatDateTime = (dateValue, timeValue) => {
    if (!dateValue) return 'TBD';
    const formattedDate = formatDate(dateValue);
    return `${formattedDate}${timeValue ? ' • ' + timeValue : ''}`;
};

const buildListItem = (title, subtitle) => {
    const li = document.createElement('li');
    li.className = 'recent-item';
    li.innerHTML = `<div class="recent-item-title">${title}</div><div class="recent-item-meta">${subtitle}</div>`;
    return li;
};

const renderSchedules = (schedules) => {
    const list = document.getElementById('upcomingScheduleList');
    list.innerHTML = '';
    if (!schedules.length) {
        list.appendChild(buildListItem('No upcoming schedules', 'You have no confirmed bookings yet.'));
        return;
    }

    schedules.slice(0, 4).forEach(s => {
        const title = `${s.lot_number || 'Lot'} • ${s.section_name || 'Unknown section'}`;
        const subtitle = `${formatDateTime(s.schedule_date, s.schedule_time)} • ${s.status || 'Pending'}`;
        list.appendChild(buildListItem(title, subtitle));
    });
};

const renderNotifications = (notifications) => {
    const list = document.getElementById('notificationsList');
    list.innerHTML = '';
    if (!notifications.length) {
        list.appendChild(buildListItem('No notifications yet', 'All caught up.'));
        return;
    }

    notifications.slice(0, 5).forEach(note => {
        const title = note.title || note.notification_type || 'Notification';
        const subtitle = `${note.message || ''} • ${formatDate(note.created_at || note.created_at)}${note.is_read ? '' : ' • Unread'}`;
        list.appendChild(buildListItem(title, subtitle));
    });
};

const loadDashboard = async () => {
    const user = await requireRole(['user']);
    if (!user) return;

    const [notificationsUnread, notifications, allSchedules, payments] = await Promise.all([
        api.request('notifications/unread-count', { method: 'GET' }).catch(() => ({ count: 0 })),
        api.request('notifications', { method: 'GET' }).catch(() => []),
        api.request('schedules/mine', { method: 'GET' }).catch(() => []),
        api.request('payments/mine', { method: 'GET' }).catch(() => []),
    ]);

    const activeSchedules = Array.isArray(allSchedules)
        ? allSchedules.filter(s => ['pending', 'confirmed'].includes(String(s.status).toLowerCase()))
        : [];
    const upcomingSchedules = Array.isArray(allSchedules)
        ? allSchedules.filter(s => {
            const scheduleDate = new Date(s.schedule_date);
            return !Number.isNaN(scheduleDate.getTime()) && scheduleDate >= new Date(new Date().toISOString().split('T')[0]);
        })
        : [];
    const pendingPayments = Array.isArray(payments)
        ? payments.filter(p => String(p.verification_status).toLowerCase() === 'pending').length
        : 0;
    const lastPaymentStatus = Array.isArray(payments) && payments.length ? payments[0].verification_status : 'No payments';

    updateText('activeReservationCount', String(activeSchedules.length));
    updateText('activeReservationText', activeSchedules.length ? 'Reservations requiring your attention.' : 'No active reservations yet.');
    updateText('paymentStatusCount', String(pendingPayments));
    updateText('paymentStatusText', lastPaymentStatus ? `Latest: ${lastPaymentStatus}` : 'No payment activity yet.');
    updateText('scheduleCount', String(upcomingSchedules.length));
    updateText('scheduleText', upcomingSchedules.length ? 'Upcoming booking details are listed below.' : 'No upcoming burial schedules.');

    const badge = document.getElementById('notificationBadge');
    if (badge) {
        const count = Number(notificationsUnread.count || 0);
        badge.textContent = String(count);
        badge.classList.toggle('hidden', count === 0);
    }

    updateText('welcomeName', user.full_name || user.username || 'Client');
    renderSchedules(upcomingSchedules);
    renderNotifications(Array.isArray(notifications) ? notifications : []);
};

const attachEvents = () => {
    document.getElementById('logoutBtn')?.addEventListener('click', () => api.logout());
    document.getElementById('notificationIcon')?.addEventListener('click', () => window.location.href = `${getFrontendBasePath()}/pages/notifications.html`);

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => sidebar.classList.toggle('collapsed'));
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    attachEvents();
    await loadDashboard();
});
