document.addEventListener('DOMContentLoaded', async function () {
    const logoutBtn = document.getElementById('logoutBtn');
    const pageTitle = document.getElementById('pageTitle');

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function formatCurrency(value) {
        const amount = Number(value) || 0;
        return new Intl.NumberFormat('en-PH', { style: 'currency', currency: 'PHP' }).format(amount);
    }

    function getMonthName(monthNumber) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return monthNames[monthNumber - 1] || 'Unknown';
    }

    const toggleBtn = document.getElementById("toggleSidebar");
    const sidebar = document.querySelector(".sidebar");

    toggleBtn?.addEventListener("change", () => {
        sidebar?.classList.toggle("collapsed");
    });

    logoutBtn?.addEventListener('click', () => api.logout());
    document.getElementById('notificationIcon')?.addEventListener('click', () => {
        window.location.href = `${getFrontendBasePath()}/pages/notifications.html`;
    });

    const user = await requireRole(['staff']);
    if (!user) return;

    if (pageTitle) pageTitle.textContent = 'Staff Dashboard';

    // =========================================================================
    // 1. POPULATE WELCOME BANNER (FACEBOOK-STYLE HERO CARD)
    // =========================================================================
    function populateWelcomeBanner(currentUser) {
        const hour = new Date().getHours();
        let greeting = 'Good day, Welcome back!';
        if (hour < 12) {
            greeting = 'Good morning, Welcome back!';
        } else if (hour < 18) {
            greeting = 'Good afternoon, Welcome back!';
        } else {
            greeting = 'Good evening, Welcome back!';
        }

        const salutationEl = document.getElementById('welcomeSalutation');
        if (salutationEl) salutationEl.textContent = greeting;

        const fullName = currentUser.full_name || currentUser.username || 'Staff Member';
        setText('welcomeUserName', fullName);
        setText('welcomeUserUsername', `@${currentUser.username || 'staff'}`);

        const dateEl = document.getElementById('welcomeCurrentDate');
        if (dateEl) {
            const today = new Date();
            const dateStr = today.toLocaleDateString('en-PH', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
            dateEl.textContent = dateStr;
        }

        // Live clock updater
        function updateLiveTime() {
            const timeEl = document.getElementById('welcomeCurrentTime');
            if (!timeEl) return;
            const now = new Date();
            timeEl.textContent = now.toLocaleTimeString('en-PH', {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        }
        updateLiveTime();
        setInterval(updateLiveTime, 1000);

        // Dynamic Weather Condition Simulator based on local time
        function updateWeatherInfo() {
            const tempEl = document.getElementById('fbWeatherTemp');
            const descEl = document.getElementById('fbWeatherDesc');
            const iconEl = document.getElementById('fbWeatherIcon');
            if (!tempEl || !descEl || !iconEl) return;

            const currentHour = new Date().getHours();
            let temp = '29°C';
            let desc = 'Partly Cloudy';
            let iconClass = 'fas fa-cloud-sun';

            if (currentHour >= 6 && currentHour < 11) {
                temp = '27°C';
                desc = 'Sunny Morning';
                iconClass = 'fas fa-cloud-sun';
            } else if (currentHour >= 11 && currentHour < 16) {
                temp = '32°C';
                desc = 'Warm & Sunny';
                iconClass = 'fas fa-sun';
            } else if (currentHour >= 16 && currentHour < 19) {
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
        updateWeatherInfo();

        // Profile picture handling
        const avatarEl = document.getElementById('welcomeUserAvatar');
        if (avatarEl) {
            const profilePicUrl = currentUser.profile_picture || currentUser.avatar_url || currentUser.photo;
            if (profilePicUrl) {
                avatarEl.innerHTML = `<img src="${profilePicUrl}" alt="${fullName}" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-user\\'></i>'">`;
            } else {
                avatarEl.innerHTML = '<i class="fas fa-user"></i>';
            }
        }
    }
    populateWelcomeBanner(user);

    // =========================================================================
    // 2. UNREAD NOTIFICATIONS BADGE
    // =========================================================================
    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.innerText = result.count || 0;
                badge.style.display = result.count > 0 ? 'flex' : 'none';
            }
        } catch (e) { }
    }
    updateNotificationBadge();

    // =========================================================================
    // 3. ATTENTION CARD & SYSTEM EXCEPTIONS
    // =========================================================================
    async function updateAttentionCard() {
        const attentionRow = document.getElementById('attentionRow');
        const attentionSummary = document.getElementById('attentionSummary');
        const attentionBadge = document.getElementById('attentionCountBadge');
        if (!attentionRow || !attentionSummary) return;

        try {
            const exceptions = await api.request('exceptions?status=open', { method: 'GET' });
            const count = Array.isArray(exceptions) ? exceptions.length : 0;
            if (count > 0) {
                if (attentionBadge) {
                    attentionBadge.textContent = `${count} ${count === 1 ? 'Issue' : 'Issues'}`;
                }
                attentionSummary.textContent = `${count} system item${count === 1 ? '' : 's'} couldn't be resolved automatically and require${count === 1 ? 's' : ''} your review.`;
                attentionRow.style.display = '';
            } else {
                attentionRow.style.display = 'none';
            }
        } catch (e) {
            attentionRow.style.display = 'none';
        }
    }
    updateAttentionCard();

    // =========================================================================
    // 4. OPERATIONS & SERVICE QUEUES
    // =========================================================================

    // A. Cremation Requests Summary
    async function updateCremationSummary() {
        const pendingEl = document.getElementById('cremationPendingCount');
        const todayEl = document.getElementById('cremationTodayScheduledCount');
        const pendingBar = document.getElementById('cremationPendingBar');
        const scheduledBar = document.getElementById('cremationScheduledBar');
        const queueInsight = document.getElementById('cremationQueueInsight');
        if (!pendingEl || !todayEl) return;

        function applyQueueVisuals(pending, scheduled) {
            const total = pending + scheduled;
            const fallback = total === 0 ? 50 : 0;
            const pendingWidth = total > 0 ? (pending / total) * 100 : fallback;
            const scheduledWidth = total > 0 ? (scheduled / total) * 100 : fallback;

            if (pendingBar) pendingBar.style.width = `${pendingWidth}%`;
            if (scheduledBar) scheduledBar.style.width = `${scheduledWidth}%`;

            if (queueInsight) {
                if (pending > scheduled) {
                    queueInsight.textContent = 'More follow-up needed';
                } else if (scheduled > pending) {
                    queueInsight.textContent = 'Higher today volume';
                } else if (total === 0) {
                    queueInsight.textContent = 'Balanced flow';
                } else {
                    queueInsight.textContent = 'Balanced flow';
                }
            }
        }

        try {
            const stats = await api.request('cremations/queue-stats', { method: 'GET' });
            const pending = Number(stats && stats.pending) || 0;
            const scheduled = Number(stats && stats.today_scheduled) || 0;

            pendingEl.textContent = pending;
            todayEl.textContent = scheduled;
            applyQueueVisuals(pending, scheduled);
        } catch (e) {
            pendingEl.textContent = '—';
            todayEl.textContent = '—';
            if (pendingBar) pendingBar.style.width = '50%';
            if (scheduledBar) scheduledBar.style.width = '50%';
            if (queueInsight) queueInsight.textContent = 'Queue unavailable';
        }
    }
    updateCremationSummary();

    // B. Burial Scheduling Queue Summary
    async function updateBurialScheduleSummary() {
        const pendingEl = document.getElementById('burialPendingCount');
        const confirmedEl = document.getElementById('burialConfirmedCount');
        const pendingBar = document.getElementById('burialPendingBar');
        const confirmedBar = document.getElementById('burialConfirmedBar');
        const queueInsight = document.getElementById('burialQueueInsight');
        if (!pendingEl || !confirmedEl) return;

        function applyBurialVisuals(pending, confirmed) {
            const total = pending + confirmed;
            const fallback = total === 0 ? 50 : 0;
            const pendingWidth = total > 0 ? (pending / total) * 100 : fallback;
            const confirmedWidth = total > 0 ? (confirmed / total) * 100 : fallback;

            if (pendingBar) pendingBar.style.width = `${pendingWidth}%`;
            if (confirmedBar) confirmedBar.style.width = `${confirmedWidth}%`;

            if (queueInsight) {
                if (pending > 0) {
                    queueInsight.textContent = `${pending} pending reservation${pending === 1 ? '' : 's'}`;
                } else if (confirmed > 0) {
                    queueInsight.textContent = `${confirmed} confirmed schedule${confirmed === 1 ? '' : 's'}`;
                } else {
                    queueInsight.textContent = 'All schedules up to date';
                }
            }
        }

        try {
            const stats = await api.request('schedules/stats', { method: 'GET' });
            const pending = Number(stats && stats.pending) || 0;
            const confirmed = Number(stats && stats.confirmed) || 0;

            pendingEl.textContent = pending;
            confirmedEl.textContent = confirmed;
            applyBurialVisuals(pending, confirmed);
        } catch (e) {
            pendingEl.textContent = '—';
            confirmedEl.textContent = '—';
            if (pendingBar) pendingBar.style.width = '50%';
            if (confirmedBar) confirmedBar.style.width = '50%';
            if (queueInsight) queueInsight.textContent = 'Queue unavailable';
        }
    }
    updateBurialScheduleSummary();

    // C. Citizen Bookings Queue Summary
    let totalBookingsPendingCount = 0;
    async function updateBookingsSummary() {
        const pendingEl = document.getElementById('bookingPendingCount');
        const scheduledEl = document.getElementById('bookingScheduledCount');
        const pendingBar = document.getElementById('bookingPendingBar');
        const scheduledBar = document.getElementById('bookingScheduledBar');
        const queueInsight = document.getElementById('bookingQueueInsight');
        if (!pendingEl && !scheduledEl) return;

        function applyBookingVisuals(pending, scheduled) {
            const total = pending + scheduled;
            const fallback = total === 0 ? 50 : 0;
            const pendingWidth = total > 0 ? (pending / total) * 100 : fallback;
            const scheduledWidth = total > 0 ? (scheduled / total) * 100 : fallback;

            if (pendingBar) pendingBar.style.width = `${pendingWidth}%`;
            if (scheduledBar) scheduledBar.style.width = `${scheduledWidth}%`;

            if (queueInsight) {
                if (pending > 0) {
                    queueInsight.textContent = `${pending} pending service booking${pending === 1 ? '' : 's'}`;
                } else if (scheduled > 0) {
                    queueInsight.textContent = `${scheduled} confirmed booking${scheduled === 1 ? '' : 's'}`;
                } else {
                    queueInsight.textContent = 'All bookings handled';
                }
            }
        }

        try {
            const res = await api.request('bookings/stats', { method: 'GET' });
            if (res && res.success && res.data) {
                const pending = Number(res.data.pending_count) || 0;
                const scheduled = Number(res.data.scheduled_count) || 0;
                totalBookingsPendingCount = pending + scheduled;

                if (pendingEl) pendingEl.textContent = pending;
                if (scheduledEl) scheduledEl.textContent = scheduled;
                applyBookingVisuals(pending, scheduled);
                setText('statPendingBookings', totalBookingsPendingCount.toString());
            }
        } catch (e) {
            if (pendingEl) pendingEl.textContent = '—';
            if (scheduledEl) scheduledEl.textContent = '—';
            if (pendingBar) pendingBar.style.width = '50%';
            if (scheduledBar) scheduledBar.style.width = '50%';
            if (queueInsight) queueInsight.textContent = 'Bookings queue unavailable';
        }
    }
    await updateBookingsSummary();

    // =========================================================================
    // 5. COMPLIANCE & SERVICE WATCH
    // =========================================================================
    async function updateComplianceWatch() {
        // 1. Document Compliance Card
        try {
            const decRequests = await api.request('decedent-requests?status=pending', { method: 'GET' });
            const pendingCount = Array.isArray(decRequests) ? decRequests.length : 0;

            let verifiedCount = 0;
            try {
                const allRequests = await api.request('decedent-requests', { method: 'GET' });
                if (Array.isArray(allRequests)) {
                    verifiedCount = allRequests.filter(r => (r.status || '').toLowerCase() === 'approved').length;
                }
            } catch (_) {
                verifiedCount = pendingCount > 0 ? Math.max(1, pendingCount * 2) : 0;
            }

            setText('docPendingCount', pendingCount);
            setText('docVerifiedCount', verifiedCount);

            const docTotal = pendingCount + verifiedCount;
            const docPendingPct = docTotal > 0 ? Math.round((pendingCount / docTotal) * 100) : 0;
            const docVerifiedPct = Math.max(0, 100 - docPendingPct);

            const docPendingBar = document.getElementById('docPendingBar');
            const docVerifiedBar = document.getElementById('docVerifiedBar');
            if (docPendingBar) docPendingBar.style.width = `${docPendingPct}%`;
            if (docVerifiedBar) docVerifiedBar.style.width = `${docVerifiedPct}%`;

            const docInsight = document.getElementById('docStatusInsight');
            if (docInsight) {
                docInsight.textContent = pendingCount > 0
                    ? `${pendingCount} document review${pendingCount === 1 ? '' : 's'} queued`
                    : 'All submitted documents verified';
            }
        } catch (e) {
            setText('docPendingCount', '0');
            setText('docVerifiedCount', '—');
            setText('docStatusInsight', 'Citizen document review');
        }

        // 2. Cash Reconciliation Card
        try {
            const verBreakdown = await api.request('payments/verification-breakdown', { method: 'GET' });
            let pendingCount = 0;
            let verifiedAmt = 0;
            let pendingAmt = 0;

            if (Array.isArray(verBreakdown)) {
                const pendingRow = verBreakdown.find(r => (r.verification_status || '').toLowerCase() === 'pending');
                const verifiedRow = verBreakdown.find(r => (r.verification_status || '').toLowerCase() === 'verified');
                if (pendingRow) {
                    pendingCount = Number(pendingRow.count) || 0;
                    pendingAmt = Number(pendingRow.total) || 0;
                }
                if (verifiedRow) {
                    verifiedAmt = Number(verifiedRow.total) || 0;
                }
            }

            setText('pendingCashCount', pendingCount);
            setText('verifiedCashSum', formatCurrency(verifiedAmt));

            const cashTotal = pendingAmt + verifiedAmt;
            const cashPendingPct = cashTotal > 0 ? Math.min(100, Math.round((pendingAmt / cashTotal) * 100)) : 0;
            const cashVerifiedPct = Math.max(0, 100 - cashPendingPct);

            const cashPendingBar = document.getElementById('cashPendingBar');
            const cashVerifiedBar = document.getElementById('cashVerifiedBar');
            if (cashPendingBar) cashPendingBar.style.width = `${cashPendingPct}%`;
            if (cashVerifiedBar) cashVerifiedBar.style.width = `${cashVerifiedPct}%`;

            const cashInsight = document.getElementById('cashStatusInsight');
            if (cashInsight) {
                if (pendingCount > 0) {
                    cashInsight.textContent = `${formatCurrency(pendingAmt)} unverified in counter`;
                } else {
                    cashInsight.textContent = 'Counter collections reconciled';
                }
            }
        } catch (e) {
            setText('pendingCashCount', '0');
            setText('verifiedCashSum', '₱0');
            setText('cashStatusInsight', 'Offline counter payments');
        }

        // 3. Lease Expirations Card
        try {
            const expStats = await api.request('expiration-records/stats', { method: 'GET' });
            const expiringSoon = Number(expStats && expStats.expiring_soon) || 0;
            const expired = Number(expStats && expStats.expired) || 0;
            const renewed = Number(expStats && expStats.renewed) || 0;
            const totalActive = (Number(expStats && expStats.total) || (expiringSoon + expired + renewed)) || 0;

            setText('expiringSoonCount', expiringSoon);
            setText('expiringTotalCount', totalActive > 0 ? totalActive : (expired + renewed));

            const totalSum = expiringSoon + expired + Math.max(renewed, 1);
            const soonPct = Math.min(100, Math.round((expiringSoon / totalSum) * 100));
            const okPct = Math.max(0, 100 - soonPct);

            const soonBar = document.getElementById('expiringSoonBar');
            const okBar = document.getElementById('expiringOkBar');
            if (soonBar) soonBar.style.width = `${soonPct}%`;
            if (okBar) okBar.style.width = `${okPct}%`;

            const expInsight = document.getElementById('expiringStatusInsight');
            if (expInsight) {
                if (expiringSoon > 0) {
                    expInsight.textContent = `${expiringSoon} lease${expiringSoon === 1 ? '' : 's'} expiring within 30 days`;
                } else if (expired > 0) {
                    expInsight.textContent = `${expired} expired lease${expired === 1 ? '' : 's'} pending renewal`;
                } else {
                    expInsight.textContent = 'All 5-year leases up to date';
                }
            }
        } catch (e) {
            setText('expiringSoonCount', '0');
            setText('expiringTotalCount', '—');
            setText('expiringStatusInsight', 'Lease monitoring active');
        }

        // 4. System Exceptions Card
        try {
            const exceptions = await api.request('exceptions?status=open', { method: 'GET' });
            const openCount = Array.isArray(exceptions) ? exceptions.length : 0;
            setText('exceptionOpenCount', openCount);
            setText('exceptionStatusVal', openCount > 0 ? 'Review Needed' : 'Protected');

            const excInsight = document.getElementById('exceptionStatusInsight');
            if (excInsight) {
                excInsight.textContent = openCount > 0
                    ? `${openCount} issue${openCount === 1 ? '' : 's'} awaiting staff action`
                    : 'All automation checks passed';
            }
        } catch (e) {
            setText('exceptionOpenCount', '0');
            setText('exceptionStatusVal', 'Active');
            setText('exceptionStatusInsight', 'System exceptions monitor');
        }
    }
    updateComplianceWatch();

    // =========================================================================
    // 6. MAIN DATA RETRIEVAL (OCCUPANCY, REVENUE & TRANSACTIONS)
    // =========================================================================
    // ── Local Timezone Date Formatting & Period Bounds ──────────────────────
    function formatLocalDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return `${y}-${m}-${d}`;
    }

    function getPeriodBounds(period = 'monthly') {
        const now = new Date();
        const todayStr = formatLocalDate(now);
        let startDate;

        if (period === 'weekly') {
            const d = new Date(now);
            const day = d.getDay();
            const diff = (day === 0 ? 6 : day - 1);
            d.setDate(d.getDate() - diff);
            startDate = formatLocalDate(d);
        } else if (period === 'yearly') {
            startDate = `${now.getFullYear()}-01-01`;
        } else {
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            startDate = `${y}-${m}-01`;
        }

        return { startDate, endDate: todayStr, period };
    }

    let currentStaffPeriod = 'monthly';
    let revenueChartInstance = null;
    let capacityChartInstance = null;

    async function loadMainStaffDashboardData(period = 'monthly') {
        try {
            const bounds = getPeriodBounds(period);
            const now = new Date();
            const threeMonthsAgo = new Date(now);
            threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
            const threeMonthsAgoStr = formatLocalDate(threeMonthsAgo);

            const [occRes, revStatsRes, revSumRes, revMonthRes, paymentsRes] = await Promise.allSettled([
                api.request('reports/occupancy', { method: 'GET' }),
                api.request(`payments/stats?period=${period}`, { method: 'GET' }),
                api.request(`payments/revenue?date_from=${bounds.startDate}&date_to=${bounds.endDate}`, { method: 'GET' }),
                api.request(`payments/revenue-by-month?year=${now.getFullYear()}`, { method: 'GET' }),
                api.request(`payments?date_from=${threeMonthsAgoStr}&date_to=${bounds.endDate}`, { method: 'GET' })
            ]);

            const occupancy = occRes.status === 'fulfilled' ? occRes.value : {};
            const paymentStats = revStatsRes.status === 'fulfilled' ? revStatsRes.value : {};
            const revenueSummary = revSumRes.status === 'fulfilled' ? revSumRes.value : {};
            const revenueByMonth = revMonthRes.status === 'fulfilled' ? revMonthRes.value : [];
            let payments = paymentsRes.status === 'fulfilled' ? paymentsRes.value : [];

            if ((!Array.isArray(payments) && !(payments && Array.isArray(payments.data))) || (Array.isArray(payments) && payments.length === 0)) {
                try {
                    payments = await api.request('payments', { method: 'GET' });
                } catch (e) {
                    payments = [];
                }
            }

            const summary = (occupancy && occupancy.summary) ? occupancy.summary : {};
            const totalLots = Number(summary.total) || 0;
            const availableLots = Number(summary.available) || 0;
            const occupiedLots = Number(summary.occupied) || 0;
            const reservedLots = Number(summary.reserved) || 0;
            const otherLots = Math.max(0, totalLots - (availableLots + occupiedLots + reservedLots));

            // Populate Top Operational Stat Cards
            setText('statAvailableLots', availableLots.toLocaleString());
            setText('statOccupiedLots', occupiedLots.toLocaleString());
            if (totalBookingsPendingCount === 0) {
                setText('statPendingBookings', '0');
            }

            const periodRev = (paymentStats && typeof paymentStats.total_revenue === 'number')
                ? paymentStats.total_revenue
                : (Number(revenueSummary.total) || 0);

            setText('statMonthlyRevenue', formatCurrency(periodRev));

            // Update title and subtitle to match current period
            const periodTitle = period.charAt(0).toUpperCase() + period.slice(1);
            setText('staffRevenueTitle', `${periodTitle} Collections`);
            const revSubEl = document.getElementById('staffRevenueSub');
            if (revSubEl) {
                revSubEl.textContent = `Counter collections (${period})`;
            }

        // Interactive Quick Navigation & Accessible Stat Cards
        document.querySelectorAll('.stats-row > .stat-card').forEach((card) => {
            const targetHref = card.getAttribute('data-href');
            if (!targetHref || card.dataset.navBound) return;
            card.dataset.navBound = 'true';

            function triggerCardAction() {
                card.classList.add('is-active-filter');
                card.setAttribute('aria-pressed', 'true');
                window.location.href = targetHref;
            }

            card.addEventListener('click', triggerCardAction);
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    triggerCardAction();
                }
            });
        });

        // Interactive Operations Metrics & Queue Status Cards
        document.querySelectorAll('.ops-metric[data-filter-href]').forEach((metric) => {
            const targetHref = metric.getAttribute('data-filter-href');
            if (!targetHref || metric.dataset.navBound) return;
            metric.dataset.navBound = 'true';

            function triggerMetricAction(e) {
                e.stopPropagation();
                metric.classList.add('is-active-filter');
                window.location.href = targetHref;
            }

            metric.addEventListener('click', triggerMetricAction);
            metric.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    triggerMetricAction(e);
                }
            });
        });

        document.querySelectorAll('.ops-card[data-href]').forEach((card) => {
            const targetHref = card.getAttribute('data-href');
            if (!targetHref || card.dataset.navBound) return;
            card.dataset.navBound = 'true';

            card.addEventListener('click', (e) => {
                if (e.target.closest('a, button, [data-filter-href]')) return;
                window.location.href = targetHref;
            });
        });

        // Availability card metric blocks
        setText('availMapAvailable', availableLots.toString());
        setText('availMapTotal', totalLots.toString());
        const fillPct = totalLots > 0 ? Math.round(((totalLots - availableLots) / totalLots) * 100) : 0;
        setText('availMapPct', totalLots > 0 ? `${fillPct}%` : '—');
        const fillEl = document.getElementById('availOccupancyFill');
        if (fillEl) fillEl.style.width = `${fillPct}%`;

        // =====================================================================
        // 7. RECENT TRANSACTIONS TABLE
        // =====================================================================
        const recentList = document.getElementById('recentList');
        const formatTransactionLabel = payment => {
            if (!payment) return 'Payment';
            if (payment.transaction_type && payment.transaction_type.trim() !== '') {
                return payment.transaction_type;
            }
            if (payment.payment_method && payment.payment_method.trim() !== '') {
                return `${payment.payment_method} Payment`;
            }
            return 'Payment';
        };

        const paymentRecords = Array.isArray(payments) ? payments : (payments && Array.isArray(payments.data) ? payments.data : []);

        if (recentList) {
            recentList.innerHTML = '';
            if (paymentRecords.length > 0) {
                paymentRecords.slice(0, 5).forEach(payment => {
                    const item = document.createElement('li');
                    item.className = 'recent-item';
                    item.innerHTML = `
                        <div class="recent-item-title">${formatTransactionLabel(payment)}</div>
                        <div class="recent-item-meta">${payment.receipt_number || 'No receipt'} · ${payment.payment_date || 'Unknown date'}</div>
                        <div class="recent-item-amount">${formatCurrency(payment.amount)}</div>
                    `;
                    recentList.appendChild(item);
                });
            } else {
                const emptyItem = document.createElement('li');
                emptyItem.className = 'recent-item empty';
                emptyItem.textContent = 'No recent transactions available.';
                recentList.appendChild(emptyItem);
            }
        }

        // =====================================================================
        // 8. REVENUE BY MONTH BAR CHART (WITH THEME OBSERVER)
        // =====================================================================
        const chartCanvas = document.getElementById('occChart');
        if (chartCanvas && typeof Chart !== 'undefined') {
            const ctx = chartCanvas.getContext('2d');

            const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthlyDataMap = new Map();
            if (Array.isArray(revenueByMonth)) {
                revenueByMonth.forEach(item => {
                    const m = Number(item.month);
                    if (m >= 1 && m <= 12) {
                        monthlyDataMap.set(m, Number(item.total) || 0);
                    }
                });
            }

            const currentYear = now.getFullYear();
            const labels = monthNames.map(name => `${name} ${currentYear}`);
            const dataPoints = monthNames.map((_, idx) => monthlyDataMap.get(idx + 1) || 0);

            const grandTotal = dataPoints.reduce((sum, val) => sum + val, 0);
            const currentMonthIdx = now.getMonth();
            const currentMonthRevenue = dataPoints[currentMonthIdx] || 0;
            const validPaymentAmounts = paymentRecords.map(p => Number(p.amount) || 0).filter(a => a > 0);
            const totalTxCount = paymentRecords.length;
            const avgPayment = validPaymentAmounts.length > 0
                ? (validPaymentAmounts.reduce((a, b) => a + b, 0) / validPaymentAmounts.length)
                : (totalTxCount > 0 && grandTotal > 0 ? (grandTotal / totalTxCount) : 0);

            setText('finYtdTotal', formatCurrency(grandTotal));
            setText('finMonthTotal', formatCurrency(currentMonthRevenue));
            setText('finAvgTotal', formatCurrency(avgPayment));
            setText('finTxTotal', totalTxCount.toString());

            const chartSubEl = document.getElementById('chartRevenueSub');
            if (chartSubEl) {
                chartSubEl.textContent = `Year-to-date total: ${formatCurrency(grandTotal)} (${currentYear})`;
            }
            const legendTextEl = document.getElementById('chartLegendText');
            if (legendTextEl) {
                legendTextEl.textContent = `Monthly Revenue (${currentYear})`;
            }

            const isDark = () => document.body.getAttribute('data-theme') === 'dark';

            function getChartColors() {
                const dark = isDark();
                return {
                    labelColor: dark ? '#e2e8f0' : '#092118',
                    tickColor: dark ? '#cbd5e1' : '#1e293b',
                    gridColor: dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(15, 23, 42, 0.10)',
                    barBorder: dark ? '#34d399' : '#0f766e',
                    barHover: dark ? '#10b981' : '#0f766e',
                };
            }

            function createBarGradient(canvasCtx, height = 240) {
                const dark = isDark();
                const grad = canvasCtx.createLinearGradient(0, 0, 0, height);
                if (dark) {
                    grad.addColorStop(0, 'rgba(52, 211, 153, 0.95)');
                    grad.addColorStop(0.65, 'rgba(16, 185, 129, 0.70)');
                    grad.addColorStop(1, 'rgba(5, 150, 105, 0.35)');
                } else {
                    grad.addColorStop(0, 'rgba(15, 118, 110, 0.90)');
                    grad.addColorStop(0.65, 'rgba(15, 118, 110, 0.60)');
                    grad.addColorStop(1, 'rgba(15, 118, 110, 0.18)');
                }
                return grad;
            }

            const currentThemeColors = getChartColors();
            if (revenueChartInstance) {
                revenueChartInstance.destroy();
                revenueChartInstance = null;
            }
            revenueChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: `Monthly Revenue (${currentYear})`,
                        data: dataPoints,
                        backgroundColor: createBarGradient(ctx),
                        borderColor: currentThemeColors.barBorder,
                        borderWidth: 1.5,
                        borderRadius: 6,
                        borderSkipped: false,
                        maxBarThickness: 44,
                        hoverBackgroundColor: currentThemeColors.barHover,
                        hoverBorderColor: currentThemeColors.barBorder,
                        hoverBorderWidth: 2,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    layout: {
                        padding: { top: 8, right: 12, bottom: 4, left: 8 }
                    },
                    animation: {
                        duration: 900,
                        easing: 'easeOutCubic',
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                            titleColor: '#ffffff',
                            bodyColor: '#34d399',
                            titleFont: { size: 13, weight: '800', family: "'Inter', sans-serif" },
                            bodyFont: { size: 13, weight: '700', family: "'Inter', sans-serif" },
                            padding: 12,
                            cornerRadius: 8,
                            borderColor: 'rgba(255, 255, 255, 0.20)',
                            borderWidth: 1,
                            callbacks: {
                                label: itemCtx => ` Revenue: ${formatCurrency(itemCtx.parsed.y)}`
                            }
                        }
                    },
                    scales: {
                        x: {
                            title: {
                                display: true,
                                text: 'Month',
                                color: currentThemeColors.labelColor,
                                font: { size: 13, weight: '800', family: "'Inter', sans-serif" },
                                padding: { top: 8 }
                            },
                            ticks: {
                                maxRotation: 0,
                                autoSkip: false,
                                font: { size: 12, weight: '700', family: "'Inter', sans-serif" },
                                color: currentThemeColors.tickColor,
                                callback: function (val, index) {
                                    return monthNames[index] || '';
                                }
                            },
                            grid: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            title: {
                                display: true,
                                text: 'Amount (PHP)',
                                color: currentThemeColors.labelColor,
                                font: { size: 13, weight: '800', family: "'Inter', sans-serif" },
                                padding: { bottom: 8 }
                            },
                            ticks: {
                                precision: 0,
                                font: { size: 12, weight: '700', family: "'Inter', sans-serif" },
                                color: currentThemeColors.tickColor,
                                maxTicksLimit: 6,
                                callback: value => {
                                    if (Math.abs(value) >= 1000000) return `₱${(value / 1000000).toFixed(value % 1000000 ? 1 : 0)}M`;
                                    if (Math.abs(value) >= 1000) return `₱${(value / 1000).toFixed(value % 1000 ? 1 : 0)}k`;
                                    return `₱${value}`;
                                },
                            },
                            grid: {
                                color: currentThemeColors.gridColor,
                                drawBorder: false,
                            }
                        },
                    },
                },
            });

            // Dark/Light theme observer for chart colors
            const themeObserver = new MutationObserver(() => {
                if (!revenueChartInstance) return;
                const updated = getChartColors();
                revenueChartInstance.options.scales.x.title.color = updated.labelColor;
                revenueChartInstance.options.scales.x.ticks.color = updated.tickColor;
                revenueChartInstance.options.scales.y.title.color = updated.labelColor;
                revenueChartInstance.options.scales.y.ticks.color = updated.tickColor;
                revenueChartInstance.options.scales.y.grid.color = updated.gridColor;

                if (revenueChartInstance.data.datasets[0]) {
                    revenueChartInstance.data.datasets[0].backgroundColor = createBarGradient(ctx);
                    revenueChartInstance.data.datasets[0].borderColor = updated.barBorder;
                    revenueChartInstance.data.datasets[0].hoverBackgroundColor = updated.barHover;
                    revenueChartInstance.data.datasets[0].hoverBorderColor = updated.barBorder;
                }
                revenueChartInstance.update('none');
            });
            themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });
        }

        // =====================================================================
        // 9. CAPACITY FORECASTING DOUGHNUT CHART & DYNAMIC INSIGHT
        // =====================================================================
        const availPct = totalLots > 0 ? Math.round((availableLots / totalLots) * 100) : 0;
        const occPct = totalLots > 0 ? Math.round((occupiedLots / totalLots) * 100) : 0;
        const resPct = totalLots > 0 ? Math.round((reservedLots / totalLots) * 100) : 0;

        setText('capStatAvailable', availableLots.toLocaleString());
        setText('capStatAvailPct', `(${availPct}%)`);
        setText('capStatOccupied', occupiedLots.toLocaleString());
        setText('capStatOccupiedPct', `(${occPct}%)`);
        setText('capStatReserved', reservedLots.toLocaleString());
        setText('capStatReservedPct', `(${resPct}%)`);
        setText('capStatTotal', totalLots.toLocaleString());
        setText('capacityCenterPct', `${availPct}%`);

        const insightEl = document.getElementById('capacityInsightText');
        if (insightEl) {
            if (totalLots <= 0) {
                insightEl.innerHTML = `No cemetery lot data is currently recorded. Once lots are mapped, capacity utilization and space forecasting will update automatically here.`;
            } else {
                let statusLabel = 'Optimal';
                let recommendation = 'Available inventory is sufficient for regular burial assignments and upcoming reservations.';

                if (availableLots === 0) {
                    statusLabel = 'Full Capacity';
                    recommendation = 'All lots are occupied or reserved. Section re-allocations or plot conversion should be prioritized.';
                } else if (availPct <= 10) {
                    statusLabel = 'Critical Capacity';
                    recommendation = 'Remaining space is critically low. Section re-allocations or expansion should be monitored.';
                } else if (availPct <= 25) {
                    statusLabel = 'Limited Capacity';
                    recommendation = 'Lot availability is becoming tight. Consider monitoring upcoming reservations.';
                } else if (availPct <= 50) {
                    statusLabel = 'Moderate';
                    recommendation = 'Over half of the cemetery is occupied. Current capacity remains stable for routine bookings.';
                }

                insightEl.innerHTML = `
                    The cemetery currently has <strong>${availableLots.toLocaleString()} available lots (${availPct}%)</strong> remaining out of a total capacity of <strong>${totalLots.toLocaleString()} lots</strong>. 
                    <strong>${occupiedLots.toLocaleString()} lots (${occPct}%)</strong> are occupied and <strong>${reservedLots.toLocaleString()} lots (${resPct}%)</strong> are on hold. 
                    Overall capacity status is <strong class="insight-highlight">${statusLabel}</strong> — ${recommendation}
                `;
            }
        }

        const capacityCanvas = document.getElementById('capacityForecastChart');
        if (capacityCanvas && typeof Chart !== 'undefined') {
            const capCtx = capacityCanvas.getContext('2d');

            const chartData = totalLots > 0
                ? [availableLots, occupiedLots, reservedLots, otherLots].filter((_, i) => i < 3 || otherLots > 0)
                : [1];
            const chartLabels = totalLots > 0
                ? (otherLots > 0 ? ['Available Space', 'Occupied Lots', 'Reserved Lots', 'Expired/Other'] : ['Available Space', 'Occupied Lots', 'Reserved Lots'])
                : ['No Data'];
            const chartColors = totalLots > 0
                ? (otherLots > 0 ? ['#16a34a', '#16382b', '#64748b', '#94a3b8'] : ['#16a34a', '#16382b', '#64748b'])
                : ['#cbd5e1'];

            const legendsContainer = document.getElementById('capacityChartLegends');
            if (legendsContainer) {
                const legendItems = [
                    { label: 'Available Space', dotClass: 'legend-dot--green', count: availableLots, pct: availPct },
                    { label: 'Occupied Lots', dotClass: 'legend-dot--dark', count: occupiedLots, pct: occPct },
                    { label: 'Reserved Lots', dotClass: 'legend-dot--slate', count: reservedLots, pct: resPct },
                ];
                if (otherLots > 0) {
                    const othPct = totalLots > 0 ? Math.round((otherLots / totalLots) * 100) : 0;
                    legendItems.push({ label: 'Expired/Other', dotClass: 'legend-dot--slate', count: otherLots, pct: othPct });
                }

                legendsContainer.innerHTML = legendItems.map(item => `
                    <div class="capacity-legend-row" title="${item.label}: ${item.count.toLocaleString()} lots (${item.pct}%)">
                        <div class="capacity-legend-left">
                            <span class="legend-dot ${item.dotClass}"></span>
                            <span class="capacity-legend-name">${item.label}</span>
                        </div>
                        <strong class="capacity-legend-value">${item.count.toLocaleString()} (${item.pct}%)</strong>
                    </div>
                `).join('');
            }

            if (capacityChartInstance) {
                capacityChartInstance.destroy();
                capacityChartInstance = null;
            }
            capacityChartInstance = new Chart(capCtx, {
                type: 'doughnut',
                data: {
                    labels: chartLabels,
                    datasets: [{
                        data: chartData,
                        backgroundColor: chartColors,
                        hoverBackgroundColor: chartColors,
                        borderColor: '#ffffff',
                        borderWidth: 2,
                        hoverOffset: 6
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    cutout: '72%',
                    animation: {
                        duration: 1000,
                        easing: 'easeOutQuart'
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: 'rgba(15, 23, 42, 0.95)',
                            titleColor: '#ffffff',
                            bodyColor: '#34d399',
                            titleFont: { size: 12, weight: '700', family: "'Inter', sans-serif" },
                            bodyFont: { size: 12, weight: '600', family: "'Inter', sans-serif" },
                            padding: 10,
                            cornerRadius: 8,
                            borderColor: 'rgba(255, 255, 255, 0.15)',
                            borderWidth: 1,
                            callbacks: {
                                label: tooltipCtx => {
                                    if (totalLots <= 0) return ' No data available';
                                    const val = Number(tooltipCtx.parsed) || 0;
                                    const pct = Math.round((val / totalLots) * 100);
                                    return ` ${tooltipCtx.label}: ${val.toLocaleString()} lots (${pct}%)`;
                                }
                            }
                        }
                    }
                }
            });
            }
        } catch (error) {
            console.error('Staff Dashboard load failed', error);
            if (error.message && error.message.toLowerCase().includes('unauthorized')) {
                api.logout();
                return;
            }
            const errorBox = document.querySelector('.dashboard-error');
            if (errorBox) {
                errorBox.remove();
            }
        }
    }

    // Initial load
    await loadMainStaffDashboardData('monthly');

    // Attach Period Filter click handlers
    document.querySelectorAll('.dashboard-period-filter .period-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const selected = btn.getAttribute('data-period');
            if (!selected || selected === currentStaffPeriod) return;

            document.querySelectorAll('.dashboard-period-filter .period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentStaffPeriod = selected;
            await loadMainStaffDashboardData(currentStaffPeriod);
        });
    });
});

/* =========================================================================
   FOOTER — Live Timestamp & Year Initializer
   ========================================================================= */
(function initFooter() {
    const yearEl = document.getElementById('footerYear');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    const timeEl = document.getElementById('footerLiveTime');
    const pulseEl = document.querySelector('.footer-pulse-ring');

    function stampFooterTime() {
        const now = new Date();
        const formatted = now.toLocaleString('en-PH', {
            weekday: 'short',
            month: 'short',
            day: 'numeric',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            hour12: true
        });
        if (timeEl) timeEl.textContent = formatted;
        if (pulseEl) pulseEl.style.display = 'block';
    }

    stampFooterTime();
})();
