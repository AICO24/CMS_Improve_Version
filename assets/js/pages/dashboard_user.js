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
    li.innerHTML = `<div><strong>${title}</strong><div class="muted">${subtitle}</div></div>`;
    return li;
};

const getRoleRedirect = (role) => {
    if (!role) return 'login.html';
    const normalized = String(role).toLowerCase();
    if (normalized.includes('admin')) return 'dashboard_admin.html';
    if (normalized.includes('staff')) return 'dashboard_staff.html';
    return null;
};

const setSidebarUser = (user) => {
    updateText('sidebarUserName', user.full_name || user.username || 'Client');
    updateText('sidebarUserRole', user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'User');
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
    const user = await api.getMe();
    if (!user) {
        window.location.href = 'login.html';
        return;
    }

    const redirectPage = getRoleRedirect(user.role);
    if (redirectPage) {
        window.location.href = redirectPage;
        return;
    }

    updateText('userName', user.full_name || user.username || 'Client');
    updateText('userRole', user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'User');
    setSidebarUser(user);

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
    document.getElementById('notificationIcon')?.addEventListener('click', () => window.location.href = 'notifications.html');
};

document.addEventListener('DOMContentLoaded', async () => {
    attachEvents();
    await loadDashboard();
});
