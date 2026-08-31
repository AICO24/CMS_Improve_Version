document.addEventListener('DOMContentLoaded', async function() {
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

    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.innerText = result.count || 0;
                badge.style.display = result.count > 0 ? 'flex' : 'none';
            }
        } catch (e) {}
    }
    updateNotificationBadge();

    // Full Automation, Admin-First: surfaces the open-items queue the
    // Automation Engine raises into (system_exceptions) — hidden entirely
    // when empty, since the Control Center framing is "monitor when
    // something needs it," not a permanent approvals-queue fixture.
    async function updateAttentionCard() {
        const attentionRow = document.getElementById('attentionRow');
        const attentionSummary = document.getElementById('attentionSummary');
        if (!attentionRow || !attentionSummary) return;
        try {
            const exceptions = await api.request('exceptions?status=open', { method: 'GET' });
            const count = Array.isArray(exceptions) ? exceptions.length : 0;
            if (count > 0) {
                attentionSummary.textContent = `${count} item${count === 1 ? '' : 's'} couldn't be handled automatically and need${count === 1 ? 's' : ''} your review.`;
                attentionRow.style.display = '';
            } else {
                attentionRow.style.display = 'none';
            }
        } catch (e) {
            attentionRow.style.display = 'none';
        }
    }
    updateAttentionCard();

    // System-Wide AI Assistant: system-scoped follow-up on the briefing
    // below ("what's that one open exception about?") without leaving the
    // dashboard — reaches every module, not just what's summarized there.
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

    try {
        const now = new Date();
        const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
        const todayStr = now.toISOString().slice(0, 10);

        const occupancy = await api.request('reports/occupancy', { method: 'GET' });
        // Filtered to the current calendar month so the "This month" subtitle is accurate.
        const revenueSummary = await api.request(`payments/revenue?date_from=${monthStart}&date_to=${todayStr}`, { method: 'GET' });
        const revenueByMonth = await api.request(`payments/revenue-by-month?year=${now.getFullYear()}`, { method: 'GET' });
        let payments = await api.request(`payments?date_from=${new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().slice(0, 10)}&date_to=${new Date().toISOString().slice(0, 10)}`, { method: 'GET' });
        if (!Array.isArray(payments) || payments.length === 0) {
            payments = await api.request('payments', { method: 'GET' });
        }
        // Batch N4 (adviser feedback 2026-08-18): this card used to make its
        // own separate schedules/recommend call (with no preferences, so
        // effectively an arbitrary "top" pick) to show a standalone
        // "Suggested Lot" tile — redundant with the real, interactive AI
        // recommendation already in the booking chatbot. Removed in favor
        // of a plain CTA into that chatbot (see dashboard_admin.html) —
        // one recommendation surface instead of two.
        const summary = occupancy.summary || {};
        const totalLots = Number(summary.total) || 0;
        const availableLots = Number(summary.available) || 0;

        setText('statTotal', totalLots.toString());
        setText('statAvailable', availableLots.toString());
        setText('statRevenue', formatCurrency(Number(revenueSummary.total) || 0));
        setText('statForecast', totalLots > 0 ? `${Math.round((availableLots / totalLots) * 100)}% available` : 'No data');

        const mapContainer = document.getElementById('availabilityMap');
        if (mapContainer) {
            mapContainer.innerHTML = '';
            if (Array.isArray(occupancy.by_section) && occupancy.by_section.length > 0) {
                occupancy.by_section.forEach(section => {
                    const sectionTotal = Number(section.total) || 0;
                    const sectionOccupied = Number(section.occupied) || 0;
                    const fillPercent = sectionTotal > 0 ? Math.round((sectionOccupied / sectionTotal) * 100) : 0;
                    const sectionItem = document.createElement('div');
                    sectionItem.className = 'availability-item';
                    sectionItem.innerHTML = `
                        <div class="availability-item-header">
                            <strong>${section.section_name || 'Section'}</strong>
                            <span>${sectionOccupied}/${sectionTotal} occupied</span>
                        </div>
                        <div class="availability-track">
                            <div class="availability-fill" style="width:${fillPercent}%;"></div>
                        </div>
                    `;
                    mapContainer.appendChild(sectionItem);
                });
            } else {
                mapContainer.textContent = 'No occupancy map data available.';
            }
        }

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

        if (recentList) {
            recentList.innerHTML = '';
            if (Array.isArray(payments) && payments.length > 0) {
                payments.slice(0, 5).forEach(payment => {
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

        const chartCanvas = document.getElementById('occChart');
        if (chartCanvas && typeof Chart !== 'undefined') {
            const labels = Array.isArray(revenueByMonth) ? revenueByMonth.map(item => getMonthName(Number(item.month))) : [];
            const dataPoints = Array.isArray(revenueByMonth) ? revenueByMonth.map(item => Number(item.total) || 0) : [];

            new Chart(chartCanvas, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [{
                        label: 'Monthly Revenue',
                        data: dataPoints,
                        backgroundColor: 'rgba(44, 94, 71, 0.55)',
                        borderColor: 'rgba(44, 94, 71, 1)',
                        borderWidth: 1,
                    }],
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: {
                                callback: value => formatCurrency(value),
                            },
                        },
                    },
                },
            });
        }
    } catch (error) {
        console.error('Dashboard load failed', error);
        if (error.message && error.message.toLowerCase().includes('unauthorized')) {
            api.logout();
            return;
        }
        const contentArea = document.getElementById('contentArea');
        if (contentArea) {
            const errorBox = document.createElement('div');
            errorBox.className = 'dashboard-error';
            errorBox.textContent = 'Unable to load dashboard data. Please refresh the page or try again later.';
            contentArea.prepend(errorBox);
        }
    }
});
