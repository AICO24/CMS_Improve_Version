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

const updateFooterTimestamp = () => {
    const now = new Date();
    const timeStr = now.toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true
    });
    updateText('footerLiveTime', timeStr);
    updateText('footerYear', String(now.getFullYear()));
};

const renderSchedules = (schedules) => {
    const list = document.getElementById('upcomingScheduleList');
    if (!list) return;
    list.innerHTML = '';
    if (!schedules.length) {
        list.appendChild(buildListItem('No upcoming schedules', 'You have no confirmed bookings yet.'));
        return;
    }

    schedules.slice(0, 4).forEach(s => {
        const title = `${s.lot_number || 'Plot Arrangement'} • ${s.section_name || 'Standard Section'}`;
        const subtitle = `${formatDateTime(s.schedule_date, s.schedule_time)} • Status: ${s.status || 'Scheduled'}`;
        list.appendChild(buildListItem(title, subtitle));
    });
};

const renderNotifications = (notifications) => {
    const list = document.getElementById('notificationsList');
    if (!list) return;
    list.innerHTML = '';
    if (!notifications.length) {
        list.appendChild(buildListItem('No notifications yet', 'All caught up with announcements and booking notices.'));
        return;
    }

    notifications.slice(0, 5).forEach(note => {
        const title = note.title || note.notification_type || 'System Update';
        const subtitle = `${note.message || ''} • ${formatDate(note.created_at || note.created_at)}${note.is_read ? '' : ' • Unread'}`;
        list.appendChild(buildListItem(title, subtitle));
    });
};

const populateWelcomeBanner = (currentUser) => {
    const hour = new Date().getHours();
    let greeting = 'Good day, Welcome back!';
    if (hour < 12) {
        greeting = 'Good morning, Welcome back!';
    } else if (hour < 18) {
        greeting = 'Good afternoon, Welcome back!';
    } else {
        greeting = 'Good evening, Welcome back!';
    }

    updateText('welcomeSalutation', greeting);

    const fullName = currentUser.full_name || currentUser.username || 'Citizen User';
    updateText('welcomeUserName', fullName);
    updateText('welcomeUserUsername', `@${currentUser.username || 'user'}`);

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

    // Live clock updater
    const updateLiveTime = () => {
        const timeEl = document.getElementById('welcomeCurrentTime');
        if (!timeEl) return;
        const now = new Date();
        timeEl.textContent = now.toLocaleTimeString('en-PH', {
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true
        });
    };
    updateLiveTime();
    if (!window._userClockInterval) {
        window._userClockInterval = setInterval(updateLiveTime, 1000);
    }

    // Dynamic Weather Condition Simulator based on local hour
    const tempEl = document.getElementById('fbWeatherTemp');
    const descEl = document.getElementById('fbWeatherDesc');
    const iconEl = document.getElementById('fbWeatherIcon');
    if (tempEl && descEl && iconEl) {
        let temp = '29°C';
        let desc = 'Partly Cloudy';
        let iconClass = 'fas fa-cloud-sun';

        if (hour >= 6 && hour < 11) {
            temp = '27°C';
            desc = 'Sunny Morning';
            iconClass = 'fas fa-cloud-sun';
        } else if (hour >= 11 && hour < 16) {
            temp = '32°C';
            desc = 'Warm & Sunny';
            iconClass = 'fas fa-sun';
        } else if (hour >= 16 && hour < 19) {
            temp = '29°C';
            desc = 'Clear Dusk';
            iconClass = 'fas fa-cloud-sun';
        } else {
            temp = '26°C';
            desc = 'Fair Night';
            iconClass = 'fas fa-cloud-moon';
        }

        tempEl.textContent = temp;
        descEl.textContent = desc;
        iconEl.className = `${iconClass} weather-icon`;
    }

    // Profile Avatar picture handling
    const avatarEl = document.getElementById('welcomeUserAvatar');
    if (avatarEl) {
        const profilePicUrl = currentUser.profile_picture || currentUser.avatar_url || currentUser.photo;
        if (profilePicUrl) {
            avatarEl.innerHTML = `<img src="${profilePicUrl}" alt="${fullName}" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-user\\'></i>'">`;
        } else {
            avatarEl.innerHTML = '<i class="fas fa-user"></i>';
        }
    }
};

const loadDashboard = async () => {
    const user = await requireRole(['user']);
    if (!user) return;

    // Populate user profile info across sidebar and top-bar
    const displayName = user.full_name || user.username || 'Citizen User';
    updateText('welcomeName', displayName);
    updateText('userName', displayName);
    updateText('userRole', 'Citizen User');
    updateText('sidebarUserName', displayName);
    updateText('sidebarUserRole', 'Citizen User');

    // Populate Facebook-Style Profile Hero Card (Identical to Admin Dashboard)
    populateWelcomeBanner(user);

    // Update live footer
    updateFooterTimestamp();

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

    // Update status cards
    updateText('activeReservationCount', String(activeSchedules.length));
    updateText('activeReservationText', activeSchedules.length ? `${activeSchedules.length} active service booking${activeSchedules.length > 1 ? 's' : ''}.` : 'No active reservations yet.');
    
    updateText('paymentStatusCount', String(pendingPayments));
    updateText('paymentStatusText', pendingPayments > 0 ? `${pendingPayments} payment${pendingPayments > 1 ? 's' : ''} pending verification.` : (payments.length ? `Latest standing: ${lastPaymentStatus}` : 'No payment activity recorded.'));
    
    updateText('scheduleCount', String(upcomingSchedules.length));
    updateText('scheduleText', upcomingSchedules.length ? `${upcomingSchedules.length} upcoming service event${upcomingSchedules.length > 1 ? 's' : ''}.` : 'No upcoming burial schedules.');

    const unreadCount = Number(notificationsUnread.count || 0);
    updateText('unreadNotificationsCount', String(unreadCount));
    updateText('unreadNotificationsText', unreadCount > 0 ? `${unreadCount} unread update${unreadCount > 1 ? 's' : ''} awaiting review.` : 'All caught up.');

    // Notification badge in top bar (Always visible with count, matching system behavior)
    const badge = document.getElementById('notificationBadge');
    if (badge) {
        badge.textContent = String(unreadCount);
        badge.style.display = 'flex';
    }

    renderSchedules(upcomingSchedules);
    renderNotifications(Array.isArray(notifications) ? notifications : []);
};

const attachEvents = () => {
    // Logout action
    document.getElementById('logoutBtn')?.addEventListener('click', () => api.logout());

    // Notification Bell Click & Keyboard Accessibility
    const notificationBtn = document.getElementById('notificationIcon');
    if (notificationBtn) {
        const openNotifications = () => {
            const basePath = typeof getFrontendBasePath === 'function' ? getFrontendBasePath() : '../..';
            window.location.href = `${basePath}/pages/notifications.html`;
        };
        notificationBtn.addEventListener('click', openNotifications);
        notificationBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openNotifications();
            }
        });
    }

    // Profile Click (Top-bar & Sidebar Chip)
    const openProfile = () => {
        const basePath = typeof getFrontendBasePath === 'function' ? getFrontendBasePath() : '../..';
        window.location.href = `${basePath}/pages/profile.html`;
    };
    const userProfileEl = document.getElementById('userProfile');
    if (userProfileEl) {
        userProfileEl.addEventListener('click', openProfile);
        userProfileEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openProfile();
            }
        });
    }
    document.getElementById('sidebarUserChip')?.addEventListener('click', openProfile);

    // Interactive Status Cards
    document.querySelectorAll('.dashboard-user-stats > .stat-card[data-href]').forEach(card => {
        const href = card.getAttribute('data-href');
        if (!href) return;
        card.addEventListener('click', () => {
            const basePath = typeof getFrontendBasePath === 'function' ? getFrontendBasePath() : '../..';
            window.location.href = `${basePath}/pages/${href}`;
        });
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                const basePath = typeof getFrontendBasePath === 'function' ? getFrontendBasePath() : '../..';
                window.location.href = `${basePath}/pages/${href}`;
            }
        });
    });

    // Mobile / Responsive Sidebar Toggle
    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => sidebar.classList.toggle('collapsed'));
    }
};

document.addEventListener('DOMContentLoaded', async () => {
    attachEvents();
    await loadDashboard();
    setInterval(loadDashboard, 30000);
});
