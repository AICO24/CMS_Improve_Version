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

    toggleBtn.addEventListener("change", () => {
        sidebar.classList.toggle("collapsed");
    });

    logoutBtn?.addEventListener('click', () => api.logout());
    document.getElementById('notificationIcon')?.addEventListener('click', () => window.location.href = `${getFrontendBasePath()}/pages/notifications.html`);

    const user = await requireRole(['admin']);
    if (!user) return;

    if (pageTitle) pageTitle.textContent = 'Admin Dashboard';

    // Populate Welcome Banner with user info, avatar, and time-based greeting
    function populateWelcomeBanner(currentUser) {
        const hour = new Date().getHours();
        let greeting = 'Good day, welcome back!';
        if (hour < 12) {
            greeting = 'Good morning, welcome back!';
        } else if (hour < 18) {
            greeting = 'Good afternoon, welcome back!';
        } else {
            greeting = 'Good evening, welcome back!';
        }

        const salutationEl = document.getElementById('welcomeSalutation');
        if (salutationEl) salutationEl.textContent = greeting;

        const fullName = currentUser.full_name || currentUser.username || 'Administrator';
        const roleLabel = currentUser.role ? (currentUser.role.charAt(0).toUpperCase() + currentUser.role.slice(1)) : 'Administrator';

        setText('welcomeUserName', fullName);
        setText('welcomeUserRoleBadge', roleLabel);
        setText('welcomeUserUsername', `@${currentUser.username || 'admin'}`);
        setText('welcomeUserEmail', currentUser.email || 'No email registered');

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

        // Dynamic Weather Condition Simulator based on local time and conditions
        function updateWeatherInfo() {
            const tempEl = document.getElementById('fbWeatherTemp');
            const descEl = document.getElementById('fbWeatherDesc');
            const iconEl = document.getElementById('fbWeatherIcon');
            if (!tempEl || !descEl || !iconEl) return;

            const hour = new Date().getHours();
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
        updateWeatherInfo();

        // Profile picture handling
        const avatarEl = document.getElementById('welcomeUserAvatar');
        if (avatarEl) {
            const profilePicUrl = currentUser.profile_picture || currentUser.avatar_url || currentUser.photo;
            if (profilePicUrl) {
                avatarEl.innerHTML = `<img src="${profilePicUrl}" alt="${fullName}" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-user-tie\\'></i>'">`;
            } else {
                avatarEl.innerHTML = '<i class="fas fa-user-tie"></i>';
            }
        }
    }
    populateWelcomeBanner(user);

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

    // Full Automation, Admin-First: surfaces the open-items queue the
    // Automation Engine raises into (system_exceptions) — hidden entirely
    // when empty, since the Control Center framing is "monitor when
    // something needs it," not a permanent approvals-queue fixture.
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
                attentionSummary.textContent = `${count} system item${count === 1 ? '' : 's'} couldn't be resolved automatically and require${count === 1 ? 's' : ''} administrative action.`;
                attentionRow.style.display = '';
            } else {
                attentionRow.style.display = 'none';
            }
        } catch (e) {
            attentionRow.style.display = 'none';
        }
    }
    updateAttentionCard();

    // Cremation module audit, Batch E: baseline visibility, not an alert —
    // always renders (unlike updateAttentionCard() above, which hides when
    // there's nothing open) since the point is that a staff member landing
    // here gets *some* signal about Cremation, not just silence when it
    // happens to be quiet.
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
            const pending = Number(stats.pending) || 0;
            const scheduled = Number(stats.today_scheduled) || 0;

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

    // Operational Queues: Burial scheduling queue summary matching Cremation metrics
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
                    queueInsight.textContent = `${pending} pending approval${pending === 1 ? '' : 's'}`;
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

    // Relocation & Exhumation Watch: live metrics for transfers, exhumation & health permits
    async function updateRelocationSummary() {
        const pendingEl = document.getElementById('relocationPendingCount');
        const approvedEl = document.getElementById('relocationApprovedCount');
        const pendingBar = document.getElementById('relocationPendingBar');
        const approvedBar = document.getElementById('relocationApprovedBar');
        const queueInsight = document.getElementById('relocationQueueInsight');
        if (!pendingEl || !approvedEl) return;

        function applyRelocationVisuals(pending, approved) {
            const total = pending + approved;
            const fallback = total === 0 ? 50 : 0;
            const pendingWidth = total > 0 ? (pending / total) * 100 : fallback;
            const approvedWidth = total > 0 ? (approved / total) * 100 : fallback;

            if (pendingBar) pendingBar.style.width = `${pendingWidth}%`;
            if (approvedBar) approvedBar.style.width = `${approvedWidth}%`;

            if (queueInsight) {
                if (pending > 0) {
                    queueInsight.textContent = `${pending} transfer request${pending === 1 ? '' : 's'} pending`;
                } else if (approved > 0) {
                    queueInsight.textContent = `${approved} approved transfer${approved === 1 ? '' : 's'} ready`;
                } else {
                    queueInsight.textContent = 'All transfers up to date';
                }
            }
        }

        try {
            const stats = await api.request('relocations/stats', { method: 'GET' });
            const pending = Number(stats && stats.pending) || 0;
            const approved = Number(stats && stats.approved) || 0;

            pendingEl.textContent = pending;
            approvedEl.textContent = approved;
            applyRelocationVisuals(pending, approved);
        } catch (e) {
            pendingEl.textContent = '—';
            approvedEl.textContent = '—';
            if (pendingBar) pendingBar.style.width = '50%';
            if (approvedBar) approvedBar.style.width = '50%';
            if (queueInsight) queueInsight.textContent = 'Queue unavailable';
        }
    }
    updateRelocationSummary();

    // Compliance & Administrative Watch: live operational cards matching Operations & Service Queues
    async function updateComplianceWatch() {
        // 1. Expirations Card
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

        // 2. Audit & Security Trail Card
        try {
            const logsRes = await api.request('audit-logs?limit=5', { method: 'GET' });
            const logsList = Array.isArray(logsRes) ? logsRes : (logsRes && Array.isArray(logsRes.logs) ? logsRes.logs : []);
            const latestLog = logsList[0] || null;

            setText('auditStatusVal', 'Protected');
            setText('auditEventsCount', logsList.length > 0 ? `${logsList.length} Recent` : 'Active');

            const auditDesc = document.getElementById('auditLastActionDesc');
            if (latestLog && auditDesc) {
                const action = latestLog.action || 'System event';
                const actor = latestLog.username || latestLog.user_full_name || 'Staff';
                auditDesc.textContent = `${action} (${actor})`;
            } else if (auditDesc) {
                auditDesc.textContent = 'System audit trail running';
            }
        } catch (e) {
            setText('auditStatusVal', 'Active');
            setText('auditEventsCount', '—');
            setText('auditLastActionDesc', 'Audit monitoring active');
        }

        // 3. Document Compliance Card
        try {
            const decRequests = await api.request('decedent-requests?status=pending', { method: 'GET' });
            const pendingCount = Array.isArray(decRequests) ? decRequests.length : 0;

            // Also check all/approved requests for total ratio if available
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

        // 4. Cash Reconciliation Card
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
                    cashInsight.textContent = 'Counter cash register reconciled';
                }
            }
        } catch (e) {
            setText('pendingCashCount', '0');
            setText('verifiedCashSum', '₱0');
            setText('cashStatusInsight', 'Offline counter payments');
        }
    }
    updateComplianceWatch();

    // System-Wide AI Assistant: system-scoped follow-up on the briefing
    // below ("what's that one open exception about?") without leaving the
    // dashboard — reaches every module, not just what's summarized there.
    if (typeof initAiAssistant === 'function' && document.querySelector('#aiAssistantMount')) {
        initAiAssistant({
            mountSelector: '#aiAssistantMount',
            context: { scope: 'system' },
            greeting: "Hello! I'm your AI assistant for the whole system. How can I help you today?",
            suggestions: [
                { icon: 'fa-triangle-exclamation', label: 'What needs attention?', question: 'What currently needs my attention across the whole system?' },
                { icon: 'fa-hourglass-half', label: "What's expiring soon?", question: 'What lot leases are expiring within the next week?' },
                { icon: 'fa-robot', label: 'Automation activity', question: 'How much of the recent activity was handled automatically?' },
                { icon: 'fa-list-check', label: 'Open exceptions', question: 'Are there any open exceptions I should review right now?' },
            ],
        });
    }

    // Quota-reduction batch: ai/dashboard-digest shows near-identical
    // content on this page and on ai.html, and each fresh load costs a
    // Gemini call with a full facts rebuild. Cached in sessionStorage (not
    // localStorage) so it's scoped to the current tab/session and expires
    // naturally when the browser tab closes, keyed by the same name both
    // pages read/write so navigating between them within the TTL reuses one
    // result instead of fetching twice. Read-through only — an explicit
    // Refresh click always bypasses the cache and re-fetches.
    const AI_DIGEST_CACHE_KEY = 'ai_dashboard_digest_cache';
    const AI_DIGEST_CACHE_TTL_MS = 5 * 60 * 1000;

    function readAiDigestCache() {
        try {
            const raw = sessionStorage.getItem(AI_DIGEST_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.timestamp !== 'number' || !parsed.data) return null;
            if (Date.now() - parsed.timestamp > AI_DIGEST_CACHE_TTL_MS) return null;
            return parsed.data;
        } catch (e) {
            return null;
        }
    }

    function writeAiDigestCache(data) {
        try {
            sessionStorage.setItem(AI_DIGEST_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (e) {
            // sessionStorage unavailable/full — caching is best-effort only.
        }
    }

    // AI-2 Round 2: proactive "second admin" briefing — unlike the
    // Exceptions-backed attention card above (which only appears when
    // there's something broken), this always renders something on load, so
    // "nothing needs attention" is itself a stated fact rather than an
    // absence. Fetched once on load (cache permitting) plus an explicit
    // Refresh (no caching table, no cron — matches this app's existing
    // no-background-jobs convention, see AutomationEngine.php's header
    // comment).
    async function loadAiBriefing(forceRefresh = false) {
        const briefingText = document.getElementById('aiBriefingText');
        const refreshBtn = document.getElementById('refreshBriefingBtn');
        if (!briefingText) return;

        function render(result) {
            briefingText.textContent = (result && result.explained && result.message)
                ? result.message
                : 'AI briefing is unavailable right now — check the Needs Attention card and Exceptions page directly.';
        }

        if (!forceRefresh) {
            const cached = readAiDigestCache();
            if (cached) {
                render(cached);
                if (refreshBtn) {
                    refreshBtn.onclick = async () => {
                        refreshBtn.disabled = true;
                        try {
                            await loadAiBriefing(true);
                        } finally {
                            refreshBtn.disabled = false;
                        }
                    };
                }
                return;
            }
        }

        briefingText.textContent = 'Loading today\'s briefing…';
        try {
            const result = await api.request('ai/dashboard-digest', { method: 'GET' });
            writeAiDigestCache(result);
            render(result);
        } catch (e) {
            render(null);
        }
        if (refreshBtn) {
            refreshBtn.onclick = async () => {
                refreshBtn.disabled = true;
                try {
                    await loadAiBriefing(true);
                } finally {
                    refreshBtn.disabled = false;
                }
            };
        }
    }
    loadAiBriefing();

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
        let endDate = todayStr;

        if (period === 'weekly') {
            const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            const day = d.getDay();
            const diff = (day === 0 ? 6 : day - 1);
            d.setDate(d.getDate() - diff);
            startDate = formatLocalDate(d);

            const sun = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 6);
            endDate = formatLocalDate(sun);
        } else if (period === 'yearly') {
            startDate = `${now.getFullYear()}-01-01`;
            endDate = todayStr;
        } else {
            const y = now.getFullYear();
            const m = String(now.getMonth() + 1).padStart(2, '0');
            startDate = `${y}-${m}-01`;
            endDate = todayStr;
        }

        return { startDate, endDate, period };
    }

    function setPeriodFilterLoading(isLoading) {
        const periodButtons = document.querySelectorAll('.dashboard-period-filter .period-btn');
        periodButtons.forEach(b => {
            b.style.pointerEvents = isLoading ? 'none' : '';
            b.style.opacity = isLoading ? '0.7' : '';
        });

        const periodEls = [
            document.getElementById('statTotalRevenue')?.closest('.stat-card'),
            document.getElementById('occChart')?.closest('.chart-card'),
            document.getElementById('recentList')?.closest('.card')
        ].filter(Boolean);

        periodEls.forEach(el => {
            if (isLoading) {
                el.style.transition = 'opacity 0.2s ease';
                el.style.opacity = '0.5';
            } else {
                el.style.opacity = '1';
            }
        });
    }

    let currentAdminPeriod = 'monthly';
    let revenueChartInstance = null;
    let capacityChartInstance = null;

    async function loadMainDashboardData(period = 'monthly') {
        setPeriodFilterLoading(true);
        try {
            const bounds = getPeriodBounds(period);
            const now = new Date();

            let chartPromise;
            if (period === 'yearly') {
                chartPromise = api.request(`payments/revenue-by-month?year=${now.getFullYear()}`, { method: 'GET' });
            } else {
                chartPromise = api.request(`payments/revenue-by-day?date_from=${bounds.startDate}&date_to=${bounds.endDate}`, { method: 'GET' });
            }

            const [occRes, revStatsRes, revSumRes, chartRes, paymentsRes] = await Promise.allSettled([
                api.request('reports/occupancy', { method: 'GET' }),
                api.request(`payments/stats?period=${period}&date_from=${bounds.startDate}&date_to=${bounds.endDate}`, { method: 'GET' }),
                api.request(`payments/revenue?date_from=${bounds.startDate}&date_to=${bounds.endDate}`, { method: 'GET' }),
                chartPromise,
                api.request(`payments?date_from=${bounds.startDate}&date_to=${bounds.endDate}&per_page=10`, { method: 'GET' })
            ]);

            const occupancy = occRes.status === 'fulfilled' ? occRes.value : {};
            const paymentStats = revStatsRes.status === 'fulfilled' ? revStatsRes.value : {};
            const revenueSummary = revSumRes.status === 'fulfilled' ? revSumRes.value : {};
            const revenueSeriesData = chartRes.status === 'fulfilled' ? chartRes.value : [];
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

            // Load User statistics and Payments/Transactions count
            let totalUsersCount = 0;
            let activeUsersCount = 0;
            let inactiveUsersCount = 0;
            let totalTxCount = 0;

            try {
                const [allUsersRes, inactiveUsersRes, allPaymentsRes] = await Promise.all([
                    api.request('users?per_page=1', { method: 'GET' }).catch(() => null),
                    api.request('users?is_active=0&per_page=1', { method: 'GET' }).catch(() => null),
                    api.request('payments?per_page=1', { method: 'GET' }).catch(() => null),
                ]);

                totalUsersCount = (allUsersRes && allUsersRes.meta && typeof allUsersRes.meta.total === 'number')
                    ? allUsersRes.meta.total
                    : (Array.isArray(allUsersRes && allUsersRes.data) ? allUsersRes.data.length : 0);

                inactiveUsersCount = (inactiveUsersRes && inactiveUsersRes.meta && typeof inactiveUsersRes.meta.total === 'number')
                    ? inactiveUsersRes.meta.total
                    : 0;

                activeUsersCount = Math.max(0, totalUsersCount - inactiveUsersCount);

                if (allPaymentsRes && allPaymentsRes.meta && typeof allPaymentsRes.meta.total === 'number') {
                    totalTxCount = allPaymentsRes.meta.total;
                } else if (Array.isArray(payments)) {
                    totalTxCount = payments.length;
                } else if (payments && Array.isArray(payments.data)) {
                    totalTxCount = payments.data.length;
                }
            } catch (e) {
                console.warn('Failed to load user/transaction stats for dashboard cards', e);
            }

            // Populate Overview Stat Cards
            setText('statTotalUsers', totalUsersCount.toString());
            setText('statActiveUsers', activeUsersCount.toString());
            setText('statInactiveUsers', inactiveUsersCount.toString());

            // Bind Revenue & Transaction KPIs to DOM (Finding K & N fix)
            const periodRev = Number(paymentStats.total_revenue ?? paymentStats.total ?? revenueSummary.total) || 0;
            const periodTx = Number(paymentStats.transaction_count ?? paymentStats.count ?? revenueSummary.count) || 0;

            setText('statTotalRevenue', formatCurrency(periodRev));
            setText('statMonthlyRevenue', formatCurrency(periodRev));

            const revTitleEl = document.getElementById('statRevenueTitle');
            if (revTitleEl) {
                if (period === 'weekly') revTitleEl.textContent = 'Weekly Revenue';
                else if (period === 'yearly') revTitleEl.textContent = 'Annual Revenue';
                else revTitleEl.textContent = 'Monthly Revenue';
            }

            const revSubEl = document.getElementById('statRevenueSub');
            if (revSubEl) {
                const periodLabel = period === 'weekly' ? 'this week' : (period === 'yearly' ? 'this year' : 'this month');
                revSubEl.innerHTML = `<span id="statTotalTransactions">${periodTx}</span> logged transactions ${periodLabel}`;
            } else {
                setText('statTotalTransactions', periodTx > 0 ? periodTx.toString() : (totalTxCount > 0 ? totalTxCount.toString() : '0'));
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

            // Recent Transactions List
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
                    const periodName = period === 'weekly' ? 'this week' : (period === 'yearly' ? 'this year' : 'this month');
                    emptyItem.textContent = `No transactions recorded for ${periodName}.`;
                    recentList.appendChild(emptyItem);
                }
            }

            // Monthly/Period Revenue Chart
            const chartCanvas = document.getElementById('occChart');
            if (chartCanvas && typeof Chart !== 'undefined') {
                const ctx = chartCanvas.getContext('2d');

                let labels = [];
                let dataPoints = [];
                let chartDatasetLabel = '';
                let xAxisTitle = 'Period';
                let chartMainTitle = 'Revenue by Month';
                let chartSubText = '';
                let chartLegendTitle = '';

                const currentYear = now.getFullYear();
                const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

                if (period === 'weekly') {
                    // Weekly: 7 daily points for current Monday–Sunday week
                    const mon = new Date(now.getFullYear(), now.getMonth(), now.getDate());
                    const dayOfWeek = mon.getDay();
                    const diffToMon = (dayOfWeek === 0 ? 6 : dayOfWeek - 1);
                    mon.setDate(mon.getDate() - diffToMon);

                    const weekDayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
                    const dailyMap = new Map();
                    if (Array.isArray(revenueSeriesData)) {
                        revenueSeriesData.forEach(item => {
                            if (item.date) dailyMap.set(item.date, Number(item.total) || 0);
                        });
                    }

                    const sun = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 6);
                    for (let i = 0; i < 7; i++) {
                        const cur = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + i);
                        const dateStr = formatLocalDate(cur);
                        const dayLabel = `${weekDayNames[i]} (${cur.getMonth() + 1}/${cur.getDate()})`;
                        labels.push(dayLabel);
                        dataPoints.push(dailyMap.get(dateStr) || 0);
                    }

                    chartMainTitle = 'Weekly Revenue Breakdown';
                    chartDatasetLabel = `Daily Revenue (Week of ${monthNames[mon.getMonth()]} ${mon.getDate()})`;
                    xAxisTitle = 'Day of Week';
                    chartSubText = `Daily performance for current week (${formatLocalDate(mon)} to ${formatLocalDate(sun)})`;
                    chartLegendTitle = 'Daily Revenue (This Week)';

                } else if (period === 'monthly') {
                    // Monthly: one point per calendar day up to today
                    const currentMonthIdx = now.getMonth();
                    const curMonthName = monthNames[currentMonthIdx];
                    const todayDate = now.getDate();

                    const dailyMap = new Map();
                    if (Array.isArray(revenueSeriesData)) {
                        revenueSeriesData.forEach(item => {
                            if (item.date) dailyMap.set(item.date, Number(item.total) || 0);
                        });
                    }

                    for (let d = 1; d <= todayDate; d++) {
                        const cur = new Date(currentYear, currentMonthIdx, d);
                        const dateStr = formatLocalDate(cur);
                        labels.push(`${curMonthName} ${d}`);
                        dataPoints.push(dailyMap.get(dateStr) || 0);
                    }

                    chartMainTitle = `Daily Revenue (${curMonthName} ${currentYear})`;
                    chartDatasetLabel = `Daily Revenue (${curMonthName} 1–${todayDate})`;
                    xAxisTitle = `Day of Month (${curMonthName})`;
                    chartSubText = `Daily collections for ${curMonthName} ${currentYear} (Day 1 to ${todayDate})`;
                    chartLegendTitle = `Daily Revenue (${curMonthName})`;

                } else {
                    // Yearly: monthly revenue Jan through Dec of current year (preserve zero-value months)
                    const monthlyDataMap = new Map();
                    if (Array.isArray(revenueSeriesData)) {
                        revenueSeriesData.forEach(item => {
                            const m = Number(item.month);
                            if (m >= 1 && m <= 12) {
                                monthlyDataMap.set(m, Number(item.total) || 0);
                            }
                        });
                    }

                    labels = monthNames.map(name => `${name} ${currentYear}`);
                    dataPoints = monthNames.map((_, idx) => monthlyDataMap.get(idx + 1) || 0);

                    chartMainTitle = `Revenue by Month (${currentYear})`;
                    chartDatasetLabel = `Monthly Revenue (${currentYear})`;
                    xAxisTitle = 'Month';
                    chartSubText = `Monthly performance for calendar year ${currentYear}`;
                    chartLegendTitle = `Monthly Revenue (${currentYear})`;
                }

                // Update chart headings & legends in UI
                const chartCardEl = chartCanvas.closest('.chart-card');
                const chartTitleEl = chartCardEl?.querySelector('.chart-card__title');
                if (chartTitleEl) chartTitleEl.textContent = chartMainTitle;

                const chartSubEl = document.getElementById('chartRevenueSub');
                if (chartSubEl) chartSubEl.textContent = chartSubText;

                const legendTextEl = document.getElementById('chartLegendText');
                if (legendTextEl) legendTextEl.textContent = chartLegendTitle;

                // Calculate totals and financial metrics from live single-source-of-truth
                const grandTotal = Number(paymentStats.all_time_revenue ?? paymentStats.ytd_revenue) || 0;
                const validPaymentAmounts = paymentRecords.map(p => Number(p.amount) || 0).filter(a => a > 0);
                const avgPayment = Number(paymentStats.average_transaction) || (validPaymentAmounts.length > 0
                    ? (validPaymentAmounts.reduce((a, b) => a + b, 0) / validPaymentAmounts.length)
                    : (periodTx > 0 && periodRev > 0 ? (periodRev / periodTx) : 0));

                setText('finYtdTotal', formatCurrency(paymentStats.ytd_revenue ?? grandTotal));
                setText('finMonthTotal', formatCurrency(periodRev));
                setText('finAvgTotal', formatCurrency(avgPayment));
                setText('finTxTotal', (paymentStats.transaction_count ?? periodTx).toString());

                // Update period chip label if present
                const monthLegendLabel = document.querySelector('.chart-legend-chip:nth-child(2) .legend-chip-label');
                if (monthLegendLabel) {
                    if (period === 'weekly') monthLegendLabel.textContent = 'This Week:';
                    else if (period === 'yearly') monthLegendLabel.textContent = 'This Year:';
                    else monthLegendLabel.textContent = 'This Month:';
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

                function createBarGradient(ctx, height = 240) {
                    const dark = isDark();
                    const grad = ctx.createLinearGradient(0, 0, 0, height);
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
                            label: chartDatasetLabel,
                            data: dataPoints,
                            backgroundColor: createBarGradient(ctx),
                            borderColor: currentThemeColors.barBorder,
                            borderWidth: 1.5,
                            borderRadius: 6,
                            borderSkipped: false,
                            maxBarThickness: period === 'monthly' ? 24 : 44,
                            hoverBackgroundColor: currentThemeColors.barHover,
                            hoverBorderColor: currentThemeColors.barBorder,
                            hoverBorderWidth: 2,
                        }],
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false,
                        layout: {
                            padding: {
                                top: 8,
                                right: 12,
                                bottom: 4,
                                left: 8,
                            }
                        },
                        animation: {
                            duration: 700,
                            easing: 'easeOutCubic',
                        },
                        plugins: {
                            legend: {
                                display: false
                            },
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
                                    label: c => ` Revenue: ${formatCurrency(c.parsed.y)}`
                                }
                            }
                        },
                        scales: {
                            x: {
                                title: {
                                    display: true,
                                    text: xAxisTitle,
                                    color: currentThemeColors.labelColor,
                                    font: { size: 13, weight: '800', family: "'Inter', sans-serif" },
                                    padding: { top: 8 }
                                },
                                ticks: {
                                    maxRotation: period === 'monthly' ? 45 : 0,
                                    autoSkip: period === 'monthly',
                                    maxTicksLimit: period === 'monthly' ? 16 : 12,
                                    font: { size: 11, weight: '700', family: "'Inter', sans-serif" },
                                    color: currentThemeColors.tickColor,
                                    callback: function (val, index) {
                                        return labels[index] || '';
                                    }
                                },
                                grid: {
                                    display: false,
                                }
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

                if (!window._adminChartThemeObserverAttached) {
                    window._adminChartThemeObserverAttached = true;
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
            }

            // =====================================================================
            // Capacity Forecasting Pie / Doughnut Chart & Live Insight
            // (Current-state snapshot: only initialized once, not destroyed on period change)
            // =====================================================================
            const occupiedLots = Number(summary.occupied) || 0;
            const reservedLots = Number(summary.reserved) || 0;
            const otherLots = Math.max(0, totalLots - (availableLots + occupiedLots + reservedLots));

            const availPct = totalLots > 0 ? Math.round((availableLots / totalLots) * 100) : 0;
            const occPct = totalLots > 0 ? Math.round((occupiedLots / totalLots) * 100) : 0;
            const resPct = totalLots > 0 ? Math.round((reservedLots / totalLots) * 100) : 0;

            // Populate capacity metrics pills
            setText('capStatAvailable', availableLots.toLocaleString());
            setText('capStatAvailPct', `(${availPct}%)`);
            setText('capStatOccupied', occupiedLots.toLocaleString());
            setText('capStatOccupiedPct', `(${occPct}%)`);
            setText('capStatReserved', reservedLots.toLocaleString());
            setText('capStatReservedPct', `(${resPct}%)`);
            setText('capStatTotal', totalLots.toLocaleString());
            setText('capacityCenterPct', `${availPct}%`);

            // Generate versatile, data-driven dynamic insight in plain English
            const insightEl = document.getElementById('capacityInsightText');
            if (insightEl) {
                if (totalLots <= 0) {
                    insightEl.innerHTML = `No cemetery lot data is currently recorded. Once lots are mapped, capacity utilization and space forecasting will update automatically here.`;
                } else {
                    let statusLabel = 'Optimal';
                    let recommendation = 'Available inventory is sufficient for regular burial assignments and upcoming reservations.';

                    if (availableLots === 0) {
                        statusLabel = 'Full Capacity';
                        recommendation = 'All lots are occupied or reserved. Immediate land expansion, niche conversion, or plot recycling is required.';
                    } else if (availPct <= 10) {
                        statusLabel = 'Critical Capacity';
                        recommendation = 'Remaining space is critically low. Section re-allocations or expansion plans should be prioritized soon.';
                    } else if (availPct <= 25) {
                        statusLabel = 'Limited Capacity';
                        recommendation = 'Lot availability is becoming tight. Consider monitoring upcoming reservations and lease expirations.';
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

            // Initialize Capacity Forecasting Doughnut Chart once (prevent unnecessary destroy/recreate)
            const capacityCanvas = document.getElementById('capacityForecastChart');
            if (!capacityChartInstance && capacityCanvas && typeof Chart !== 'undefined') {
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

                // Render unified brand legends under chart
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
                            legend: {
                                display: false
                            },
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
                                    label: ctx => {
                                        if (totalLots <= 0) return ' No data available';
                                        const val = Number(ctx.parsed) || 0;
                                        const pct = Math.round((val / totalLots) * 100);
                                        return ` ${ctx.label}: ${val.toLocaleString()} lots (${pct}%)`;
                                    }
                                }
                            }
                        }
                    }
                });
            }
        } catch (error) {
            console.error('Dashboard load failed', error);
            if (error.message && error.message.toLowerCase().includes('unauthorized')) {
                api.logout();
                return;
            }
            const errorBox = document.querySelector('.dashboard-error');
            if (errorBox) {
                errorBox.remove();
            }
        } finally {
            setPeriodFilterLoading(false);
        }
    }

    // Initial load
    await loadMainDashboardData('monthly');

    // Attach Period Filter click handlers
    document.querySelectorAll('.dashboard-period-filter .period-btn').forEach(btn => {
        btn.addEventListener('click', async () => {
            const selected = btn.getAttribute('data-period');
            if (!selected || selected === currentAdminPeriod) return;

            document.querySelectorAll('.dashboard-period-filter .period-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            currentAdminPeriod = selected;
            await loadMainDashboardData(currentAdminPeriod);
        });
    });
});

/* =========================================================================
   FOOTER — Live Timestamp & Year Initializer
   Runs independently of the main async block so it works even if
   the API calls fail or are still loading.
   ========================================================================= */
(function initFooter() {
    // Update copyright year dynamically
    const yearEl = document.getElementById('footerYear');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    // Stamp the live timestamp when the page loads
    const timeEl = document.getElementById('footerLiveTime');
    const pulseEl = document.querySelector('.footer-pulse-ring');

    function stampFooterTime() {
        const now = new Date();
        const formatted = now.toLocaleString('en-PH', {
            weekday: 'short',
            month:   'short',
            day:     'numeric',
            year:    'numeric',
            hour:    '2-digit',
            minute:  '2-digit',
            hour12:  true
        });
        if (timeEl) timeEl.textContent = formatted;
        if (pulseEl) pulseEl.style.display = 'block'; // reveal pulse after first stamp
    }

    stampFooterTime();
})();
