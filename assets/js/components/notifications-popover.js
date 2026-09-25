/**
 * Shared Notification Dropdown Popover Component (Batch 6)
 *
 * Attaches a floating dropdown to #notificationIcon across all authenticated topbars,
 * providing:
 * - Unread count badge synchronization
 * - Relative timestamps
 * - Unread visual indicators & click-to-read
 * - "Mark All as Read" batch action
 * - Quick link to notifications archive (notifications.html)
 */
(function() {
    'use strict';

    function formatRelativeTime(dateString) {
        if (!dateString) return '';
        const now = new Date();
        const date = new Date(dateString.replace(' ', 'T'));
        const diffMs = now.getTime() - date.getTime();
        const diffSecs = Math.max(0, Math.floor(diffMs / 1000));
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffSecs < 60) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays === 1) return 'Yesterday';
        if (diffDays < 7) return `${diffDays}d ago`;

        return date.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' });
    }

    function getIconForType(type) {
        const t = String(type || '').toLowerCase();
        if (t.includes('payment') || t.includes('receipt')) return 'fa-receipt';
        if (t.includes('booking') || t.includes('reservation')) return 'fa-calendar-check';
        if (t.includes('cremation')) return 'fa-fire';
        if (t.includes('burial')) return 'fa-monument';
        if (t.includes('security') || t.includes('auth')) return 'fa-shield-halved';
        if (t.includes('expiration') || t.includes('alert')) return 'fa-hourglass-half';
        if (t.includes('exception')) return 'fa-triangle-exclamation';
        return 'fa-bell';
    }

    function escapeHtml(str) {
        if (!str) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function initNotificationPopover() {
        const notifIcon = document.getElementById('notificationIcon');
        if (!notifIcon || notifIcon.dataset.popoverInitialized === '1') {
            return;
        }
        notifIcon.dataset.popoverInitialized = '1';
        notifIcon.setAttribute('aria-haspopup', 'true');
        notifIcon.setAttribute('aria-expanded', 'false');

        // Dynamically ensure stylesheet is loaded
        if (!document.querySelector('link[href*="notifications-popover.css"]')) {
            const link = document.createElement('link');
            link.rel = 'stylesheet';
            const basePath = typeof window.getFrontendBasePath === 'function' ? window.getFrontendBasePath() : '../..';
            link.href = `${basePath}/assets/css/components/notifications-popover.css`;
            document.head.appendChild(link);
        }

        // Build popover element
        const popover = document.createElement('div');
        popover.className = 'notification-popover';
        popover.id = 'notificationPopover';
        popover.innerHTML = `
            <div class="notif-popover-header">
                <div class="notif-popover-title-row">
                    <span class="notif-popover-title">Notifications</span>
                    <span class="notif-popover-unread-badge" id="notifPopoverUnreadBadge" style="display:none;">0</span>
                </div>
                <button type="button" class="notif-popover-mark-all" id="notifPopoverMarkAllBtn" title="Mark all notifications as read">
                    <i class="fas fa-check-double"></i>
                    <span>Mark all read</span>
                </button>
            </div>
            <div class="notif-popover-body" id="notifPopoverList">
                <div class="notif-popover-empty">
                    <i class="fas fa-spinner fa-spin"></i>
                    <div class="notif-popover-empty-desc">Loading notifications…</div>
                </div>
            </div>
            <div class="notif-popover-footer">
                <a href="${typeof window.getFrontendBasePath === 'function' ? window.getFrontendBasePath() : '../..'}/pages/notifications.html" class="notif-popover-view-all">
                    <span>View All Notifications</span>
                    <i class="fas fa-arrow-right"></i>
                </a>
            </div>
        `;

        notifIcon.appendChild(popover);

        const listEl = popover.querySelector('#notifPopoverList');
        const unreadPill = popover.querySelector('#notifPopoverUnreadBadge');
        const markAllBtn = popover.querySelector('#notifPopoverMarkAllBtn');
        const badge = document.getElementById('notificationBadge');

        let notifications = [];
        let isOpen = false;

        async function updateBadgeCount() {
            try {
                if (typeof api !== 'undefined' && typeof api.getUnreadNotificationCount === 'function') {
                    const res = await api.getUnreadNotificationCount();
                    const count = Number(res.count || res.unread_count || 0);
                    if (badge) {
                        badge.textContent = String(count);
                        badge.style.display = count > 0 ? 'flex' : 'none';
                    }
                    if (unreadPill) {
                        unreadPill.textContent = String(count);
                        unreadPill.style.display = count > 0 ? 'inline-block' : 'none';
                    }
                }
            } catch (e) {
                // Non-fatal background refresh error
            }
        }

        async function loadNotifications() {
            try {
                listEl.innerHTML = `
                    <div class="notif-popover-empty">
                        <i class="fas fa-spinner fa-spin"></i>
                        <div class="notif-popover-empty-desc">Loading notifications…</div>
                    </div>
                `;

                if (typeof api !== 'undefined' && typeof api.getNotifications === 'function') {
                    const res = await api.getNotifications();
                    notifications = Array.isArray(res) ? res : (res.data || []);
                    renderList();
                    updateBadgeCount();
                }
            } catch (err) {
                listEl.innerHTML = `
                    <div class="notif-popover-empty">
                        <i class="fas fa-triangle-exclamation" style="color:var(--color-danger, #dc2626);"></i>
                        <div class="notif-popover-empty-title">Failed to load</div>
                        <div class="notif-popover-empty-desc">${escapeHtml(err.message || 'Could not fetch notifications.')}</div>
                    </div>
                `;
            }
        }

        function renderList() {
            if (!notifications || notifications.length === 0) {
                listEl.innerHTML = `
                    <div class="notif-popover-empty">
                        <i class="fas fa-bell-slash"></i>
                        <div class="notif-popover-empty-title">No notifications</div>
                        <div class="notif-popover-empty-desc">You are completely caught up!</div>
                    </div>
                `;
                return;
            }

            const unreadCount = notifications.filter(n => !n.is_read || n.is_read === '0' || n.is_read === 0).length;
            if (unreadPill) {
                unreadPill.textContent = String(unreadCount);
                unreadPill.style.display = unreadCount > 0 ? 'inline-block' : 'none';
            }

            // Display up to 15 most recent notifications in dropdown
            const recent = notifications.slice(0, 15);
            listEl.innerHTML = recent.map(n => {
                const isUnread = !n.is_read || n.is_read === '0' || n.is_read === 0;
                const iconClass = getIconForType(n.notification_type);
                const timeText = formatRelativeTime(n.created_at);

                return `
                    <div class="notif-popover-item ${isUnread ? 'is-unread' : ''}" data-id="${n.notification_id}" role="button" tabindex="0">
                        <div class="notif-item-icon">
                            <i class="fas ${iconClass}"></i>
                        </div>
                        <div class="notif-item-content">
                            <div class="notif-item-header">
                                <span class="notif-item-title">${escapeHtml(n.title || 'Notification')}</span>
                                <span class="notif-item-time">${timeText}</span>
                            </div>
                            <div class="notif-item-msg">${escapeHtml(n.message || '')}</div>
                        </div>
                        ${isUnread ? '<span class="notif-item-unread-dot" title="Unread"></span>' : ''}
                    </div>
                `;
            }).join('');

            // Attach click-to-read handlers
            listEl.querySelectorAll('.notif-popover-item').forEach(item => {
                item.addEventListener('click', async (e) => {
                    const id = item.dataset.id;
                    if (item.classList.contains('is-unread')) {
                        item.classList.remove('is-unread');
                        const dot = item.querySelector('.notif-item-unread-dot');
                        if (dot) dot.remove();

                        try {
                            if (typeof api !== 'undefined' && typeof api.markNotificationRead === 'function') {
                                await api.markNotificationRead(id);
                            }
                            const matched = notifications.find(n => String(n.notification_id) === String(id));
                            if (matched) matched.is_read = 1;
                            updateBadgeCount();
                        } catch (err) {
                            console.error('Failed to mark read', err);
                        }
                    }
                });
            });
        }

        function togglePopover(show) {
            isOpen = typeof show === 'boolean' ? show : !isOpen;
            if (isOpen) {
                popover.classList.add('is-open');
                notifIcon.setAttribute('aria-expanded', 'true');
                loadNotifications();
            } else {
                popover.classList.remove('is-open');
                notifIcon.setAttribute('aria-expanded', 'false');
            }
        }

        // Toggle on bell click (capture phase prevents legacy redirect listeners)
        notifIcon.addEventListener('click', function(e) {
            // Prevent toggling if the click was inside the popover itself
            if (popover.contains(e.target)) {
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') {
                e.stopImmediatePropagation();
            }
            togglePopover();
        }, true);

        notifIcon.addEventListener('keydown', function(e) {
            if ((e.key === 'Enter' || e.key === ' ') && !popover.contains(e.target)) {
                e.preventDefault();
                e.stopPropagation();
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation();
                }
                togglePopover();
            } else if (e.key === 'Escape' && isOpen) {
                togglePopover(false);
            }
        }, true);

        // Mark all as read button
        markAllBtn.addEventListener('click', async function(e) {
            e.stopPropagation();
            try {
                markAllBtn.disabled = true;
                if (typeof api !== 'undefined' && typeof api.markAllNotificationsRead === 'function') {
                    await api.markAllNotificationsRead();
                }
                notifications.forEach(n => { n.is_read = 1; });
                renderList();
                updateBadgeCount();
            } catch (err) {
                console.error('Failed to mark all notifications read', err);
            } finally {
                markAllBtn.disabled = false;
            }
        });

        // Close on clicking outside
        document.addEventListener('click', function(e) {
            if (isOpen && !notifIcon.contains(e.target)) {
                togglePopover(false);
            }
        });

        // Initial badge count & periodic background polling
        updateBadgeCount();
        setInterval(updateBadgeCount, 30000);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initNotificationPopover);
    } else {
        initNotificationPopover();
    }

    window.initNotificationPopover = initNotificationPopover;
})();
