document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    document.getElementById('logoutBtn')?.addEventListener('click', () => api.logout());
    document.getElementById('notificationIcon')?.addEventListener('click', () => window.location.href = 'notifications.html');

    if (user) {
        const fullName = user.full_name || user.username || 'Admin User';
        const roleLabel = user.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1)) : 'Administrator';
        const nameEl = document.getElementById('userName');
        const roleEl = document.getElementById('userRole');
        const sidebarNameEl = document.getElementById('sidebarUserName');
        const sidebarRoleEl = document.getElementById('sidebarUserRole');
        if (nameEl) nameEl.textContent = fullName;
        if (roleEl) roleEl.textContent = roleLabel;
        if (sidebarNameEl) sidebarNameEl.textContent = fullName;
        if (sidebarRoleEl) sidebarRoleEl.textContent = roleLabel;
    }

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    function showTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.report-content').forEach(content => content.classList.remove('active'));
        document.querySelectorAll('.report-stats').forEach(stats => stats.classList.remove('active'));
        document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
        document.getElementById(`${tab}Tab`).classList.add('active');
        const statsEl = document.getElementById(`${tab}Stats`);
        if (statsEl) statsEl.classList.add('active');
    }

    const tabsTrack = document.getElementById('reportTabsTrack');
    const prevTabScrollBtn = document.querySelector('.tab-scroll--prev');
    const nextTabScrollBtn = document.querySelector('.tab-scroll--next');

    function updateTabScrollButtons() {
        if (!tabsTrack || !prevTabScrollBtn || !nextTabScrollBtn) return;

        // The user expects these arrow controls to remain usable whenever there are
        // multiple report tabs. The buttons should not be force-disabled by the
        // layout width alone; scroll is handled by the actual scroll target.
        prevTabScrollBtn.disabled = false;
        nextTabScrollBtn.disabled = false;
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            showTab(btn.dataset.tab);
            const activeButton = document.querySelector('.tab-btn.active');
            activeButton?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
        });
    });

    // Interactive Quick Navigation & Accessible Stat Cards (mirrors admin dashboard functionality)
    document.querySelectorAll('.report-stats > .stat-card').forEach((card) => {
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

    if (tabsTrack) {
        const scrollAmount = 220;
        prevTabScrollBtn?.addEventListener('click', () => {
            const target = Math.max(0, tabsTrack.scrollLeft - scrollAmount);
            tabsTrack.scrollTo({ left: target, behavior: 'smooth' });
            requestAnimationFrame(updateTabScrollButtons);
        });
        nextTabScrollBtn?.addEventListener('click', () => {
            const maxScroll = Math.max(0, tabsTrack.scrollWidth - tabsTrack.clientWidth);
            const target = Math.min(maxScroll, tabsTrack.scrollLeft + scrollAmount);
            tabsTrack.scrollTo({ left: target, behavior: 'smooth' });
            requestAnimationFrame(updateTabScrollButtons);
        });
        tabsTrack.addEventListener('scroll', updateTabScrollButtons, { passive: true });
        window.addEventListener('resize', updateTabScrollButtons);
        updateTabScrollButtons();
    }

    let revenueMonthChart = null;
    let revenueYearChart = null;
    let revenueBreakdownChartInstance = null;
    let verificationBreakdownChartInstance = null;
    let revenueByMethodChartInstance = null;
    let reservationsChartInstance = null;
    let reservationStatusChartInstance = null;
    // Occupancy chart instances (kept so exports can reliably render images)
    let occupancyChartInstance = null;
    let occupancyByBlockChartInstance = null;
    let occupancyByTypeChartInstance = null;

    function formatPeso(value) {
        return `₱${Number(value || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    }

    function formatPesoCompact(value) {
        const amount = Number(value || 0);
        if (Math.abs(amount) >= 1000000) return `₱${(amount / 1000000).toFixed(amount % 1000000 ? 1 : 0)}M`;
        if (Math.abs(amount) >= 1000) return `₱${(amount / 1000).toFixed(amount % 1000 ? 1 : 0)}k`;
        return `₱${amount}`;
    }
    let demographicsChartInstance = null;
    let ageDistributionChartInstance = null;
    let expirationStatusChartInstance = null;
    let expirationTrendChartInstance = null;
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    function numberValue(value) {
        return Number(value || 0);
    }

    function percentValue(part, total) {
        const safeTotal = numberValue(total);
        if (safeTotal <= 0) return 0;
        return Math.round((numberValue(part) / safeTotal) * 100);
    }

    // Shared color palette and mappings for chart consistency
    const CHART_COLORS = {
        primary: '#0f766e',
        accent: ['#0f766e', '#2563eb', '#7aa77a', '#d4a373', '#b5838d', '#6d6875', '#f59e0b', '#ef4444', '#8b5cf6'],
        verification: { Pending: '#f59e0b', Verified: '#0f766e', Rejected: '#ef4444' },
        methodDefaults: { Cash: '#0f766e', Card: '#2563eb', GCash: '#7aa77a', 'Over-the-counter': '#d4a373' }
    };

    function occupancyRisk(rate) {
        if (rate >= 95) return { label: 'Critical', className: 'risk-critical' };
        if (rate >= 80) return { label: 'High', className: 'risk-high' };
        if (rate >= 50) return { label: 'Moderate', className: 'risk-moderate' };
        return { label: 'Low', className: 'risk-low' };
    }

    function topBy(items, getter) {
        return [...(items || [])].sort((a, b) => numberValue(getter(b)) - numberValue(getter(a)))[0] || null;
    }

    function renderInsightList(id, items) {
        const container = document.getElementById(id);
        if (!container) return;
        const mapDot = (cls) => {
            if (!cls || cls.includes('brand')) return 'brand';
            if (cls.includes('risk-low')) return 'low';
            if (cls.includes('risk-moderate')) return 'moderate';
            if (cls.includes('risk-high') || cls.includes('risk-critical')) return 'high';
            return 'brand';
        };
        container.innerHTML = items.map(item => {
            const dot = mapDot(item.className || '');
            const subHtml = item.sub ? `<span class="insight-sub">${item.sub}</span>` : '';
            return `
            <div class="insight-item ${item.className || ''}">
                <span class="insight-label"><i class="analysis-dot ${dot}"></i>${item.label}</span>
                <strong class="insight-value">${item.value}</strong>
                ${subHtml}
            </div>
        `;
        }).join('');
    }

    function renderForecast(items) {
        const container = document.getElementById('occupancyForecast');
        if (!container) return;
        const mapDot = (cls) => {
            if (!cls) return 'neutral';
            if (cls.includes('risk-low')) return 'low';
            if (cls.includes('risk-moderate')) return 'moderate';
            if (cls.includes('risk-high') || cls.includes('risk-critical')) return 'high';
            return 'neutral';
        };
        container.innerHTML = items.map(item => {
            const dot = mapDot(item.className || '');
            return `
            <div class="forecast-item ${item.className || ''}">
                <span><i class="analysis-dot ${dot}"></i>${item.label}</span>
                <strong>${item.value}</strong>
                <small>${item.note || ''}</small>
            </div>
        `
        }).join('');
    }

    function buildReservedFallbackSeries(items, fallbackTotal) {
        if (!Array.isArray(items) || !items.length) return [];
        const actualTotal = items.reduce((sum, item) => sum + Number(item.reserved || 0), 0);
        if (actualTotal > 0) {
            return items.map(item => Number(item.reserved || 0));
        }
        if (!Number.isFinite(fallbackTotal) || fallbackTotal <= 0) {
            return items.map(() => 0);
        }
        const base = Math.floor(fallbackTotal / items.length);
        const remainder = fallbackTotal % items.length;
        return items.map((_, index) => index === items.length - 1 ? base + remainder : base);
    }

    function isDarkMode() {
        return document.body.getAttribute('data-theme') === 'dark';
    }

    function compactChartOptions(extra = {}) {
        const dark = isDarkMode();
        const tickColor = dark ? '#e2e8f0' : '#1e293b';
        const gridColor = dark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(44, 94, 71, 0.16)';
        const axisBorderColor = dark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(44, 94, 71, 0.28)';

        return {
            ...extra,
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: 4, ...(extra.layout || {}) },
            plugins: {
                legend: {
                    display: false,
                    labels: { boxWidth: 10, boxHeight: 10, font: { size: 11, weight: '700' }, color: tickColor }
                },
                tooltip: {
                    titleFont: { size: 12, weight: '700' },
                    bodyFont: { size: 12 },
                    ...(extra.plugins?.tooltip || {})
                },
                ...(extra.plugins || {})
            },
            scales: {
                x: {
                    border: { display: true, color: axisBorderColor, width: 1.5 },
                    ticks: { maxRotation: 0, autoSkip: true, font: { size: 11.5, weight: '700' }, color: tickColor },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    border: { display: true, color: axisBorderColor, width: 1.5 },
                    ticks: { precision: 0, font: { size: 11.5, weight: '700' }, color: tickColor },
                    grid: { color: gridColor, borderDash: [4, 4], lineWidth: 1.2 }
                },
                ...(extra.scales || {})
            }
        };
    }

    const donutSliceLabelPlugin = {
        id: 'donutSliceLabelPlugin',
        afterDatasetsDraw(chart, args, pluginOptions) {
            if (pluginOptions === false || chart.options?.plugins?.donutSliceLabelPlugin === false) return;
            const meta = chart.getDatasetMeta(0);
            if (!meta || !meta.data || !meta.data.length) return;

            const dataset = chart.data.datasets[0];
            if (!dataset || !dataset.data) return;

            // Check whether a slice is currently visible
            const isSliceVisible = (idx) => {
                if (typeof chart.getDataVisibility === 'function') {
                    if (!chart.getDataVisibility(idx)) return false;
                }
                const arc = meta.data && meta.data[idx];
                if (!arc) return false;
                if (arc.hidden === true) return false;
                if (typeof arc.circumference === 'number' && arc.circumference <= 0.001) return false;
                return true;
            };

            // Calculate total of visible slices only
            const total = dataset.data.reduce((sum, value, idx) => {
                if (!isSliceVisible(idx)) return sum;
                return sum + (Number(value) || 0);
            }, 0);
            if (!total || total <= 0) return;

            const ctx = chart.ctx;
            const dark = isDarkMode();
            const centerX = meta.data[0]?.x || chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2;
            const centerY = meta.data[0]?.y || chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;
            const leftLimit = chart.chartArea.left + 26;
            const rightLimit = chart.chartArea.right - 26;
            const topLimit = chart.chartArea.top + 12;
            const bottomLimit = chart.chartArea.bottom - 12;

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '600 11px Inter, system-ui, sans-serif';

            // 1. Gather all visible qualifying slices (skip < 4% slivers to prevent cramped overlap)
            const items = [];
            meta.data.forEach((arc, index) => {
                if (!isSliceVisible(index)) return;

                const value = Number(dataset.data[index]) || 0;
                if (!value || value <= 0) return;

                const ratio = value / total;
                const roundedPct = Math.round(ratio * 100);
                if (roundedPct < 4) return;

                const start = arc.startAngle;
                const end = arc.endAngle;
                const midAngle = (start + end) / 2;
                const outerRadius = arc.outerRadius;
                const innerRadius = arc.innerRadius;
                const labelRadius = outerRadius + 24;

                const idealX = centerX + Math.cos(midAngle) * labelRadius;
                const idealY = centerY + Math.sin(midAngle) * labelRadius;
                const isRight = Math.cos(midAngle) >= 0;

                items.push({
                    index,
                    arc,
                    midAngle,
                    outerRadius,
                    innerRadius,
                    roundedPct,
                    isRight,
                    idealX,
                    idealY,
                    y: idealY,
                    labelText: chart.data.labels[index] || '',
                    canFitInnerPct: arc.circumference >= 0.35 && (outerRadius - innerRadius) >= 18
                });
            });

            if (!items.length) {
                ctx.restore();
                return;
            }

            // 2. Anti-collision: separate left and right, enforce min vertical gap
            const minGap = 20;
            const resolveSide = (sideItems) => {
                if (sideItems.length <= 1) return;
                sideItems.sort((a, b) => a.idealY - b.idealY);
                for (let i = 1; i < sideItems.length; i++) {
                    if (sideItems[i].y - sideItems[i - 1].y < minGap) {
                        sideItems[i].y = sideItems[i - 1].y + minGap;
                    }
                }
                const last = sideItems[sideItems.length - 1];
                if (last.y > bottomLimit) {
                    last.y = bottomLimit;
                    for (let i = sideItems.length - 2; i >= 0; i--) {
                        if (sideItems[i + 1].y - sideItems[i].y < minGap) {
                            sideItems[i].y = sideItems[i + 1].y - minGap;
                        }
                    }
                }
                if (sideItems[0].y < topLimit) {
                    sideItems[0].y = topLimit;
                    for (let i = 1; i < sideItems.length; i++) {
                        if (sideItems[i].y - sideItems[i - 1].y < minGap) {
                            sideItems[i].y = sideItems[i - 1].y + minGap;
                        }
                    }
                }
            };

            resolveSide(items.filter(it => it.isRight));
            resolveSide(items.filter(it => !it.isRight));

            // 3. Draw cleanly without overlap
            items.forEach((it) => {
                const percent = `${it.roundedPct}%`;

                // Inner slice percentage
                if (it.canFitInnerPct) {
                    const midR = (it.outerRadius + it.innerRadius) / 2;
                    const pctX = centerX + Math.cos(it.midAngle) * midR;
                    const pctY = centerY + Math.sin(it.midAngle) * midR;
                    ctx.fillStyle = dark ? '#f8fafc' : '#1f2937';
                    ctx.font = '700 11.5px Inter, system-ui, sans-serif';
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(percent, pctX, pctY);
                }

                // Outer callout label
                const labelY = Math.min(Math.max(it.y, topLimit), bottomLimit);
                const labelX = it.isRight
                    ? Math.min(Math.max(it.idealX, centerX + 18), rightLimit)
                    : Math.max(Math.min(it.idealX, centerX - 18), leftLimit);

                const calloutText = it.canFitInnerPct ? it.labelText : `${it.labelText} (${percent})`;
                const textWidth = ctx.measureText(calloutText).width;

                ctx.font = '600 11px Inter, system-ui, sans-serif';
                ctx.fillStyle = dark ? '#cbd5e1' : '#334155';
                ctx.textAlign = it.isRight ? 'left' : 'right';
                ctx.textBaseline = 'middle';
                ctx.fillText(calloutText, labelX, labelY);

                // Connector line
                if (textWidth > 0) {
                    const connectorX = it.isRight ? labelX - 6 : labelX + 6;
                    const edgeX = centerX + Math.cos(it.midAngle) * (it.outerRadius + 3);
                    const edgeY = centerY + Math.sin(it.midAngle) * (it.outerRadius + 3);

                    ctx.beginPath();
                    ctx.moveTo(connectorX, labelY);
                    ctx.lineTo(edgeX, edgeY);
                    ctx.strokeStyle = dark ? 'rgba(203, 213, 225, 0.40)' : 'rgba(71, 85, 105, 0.40)';
                    ctx.lineWidth = 1;
                    ctx.stroke();
                }
            });

            ctx.restore();
        }
    };

    Chart.register(donutSliceLabelPlugin);

    function buildRevenueLineChart(canvas, labels, values, { chartRef, label, gradientColor = '#0f766e' } = {}) {
        const ctx = canvas.getContext('2d');
        if (chartRef) chartRef.destroy();
        const dark = isDarkMode();
        const tickColor = dark ? '#cbd5e1' : '#1e293b';
        const axisBorderColor = dark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(44, 94, 71, 0.35)';
        const gridColor = dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(44, 94, 71, 0.18)';

        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height || 320);
        grad.addColorStop(0, dark ? 'rgba(45, 212, 191, 0.25)' : 'rgba(15, 118, 110, 0.20)');
        grad.addColorStop(0.6, dark ? 'rgba(45, 212, 191, 0.08)' : 'rgba(15, 118, 110, 0.07)');
        grad.addColorStop(1, 'rgba(15, 118, 110, 0.01)');

        const strokeColor = dark ? '#2dd4bf' : gradientColor;

        const instance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label,
                    data: values,
                    borderColor: strokeColor,
                    backgroundColor: grad,
                    borderWidth: 3.5,
                    pointRadius: 4.5,
                    pointHoverRadius: 6.5,
                    pointBackgroundColor: strokeColor,
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 2,
                    tension: 0.38,
                    fill: true
                }]
            },
            options: compactChartOptions({
                layout: { padding: { top: 8, right: 14, bottom: 6, left: 10 } },
                plugins: {
                    legend: {
                        display: true,
                        position: 'top',
                        align: 'end',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 8,
                            boxHeight: 8,
                            padding: 12,
                            font: { size: 11.5, weight: '700', family: "'Inter', sans-serif" },
                            color: tickColor
                        }
                    },
                    tooltip: {
                        backgroundColor: dark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                        titleColor: dark ? '#f8fafc' : '#0f172a',
                        bodyColor: dark ? '#cbd5e1' : '#334155',
                        borderColor: dark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(44, 94, 71, 0.30)',
                        borderWidth: 1.5,
                        padding: 11,
                        boxPadding: 5,
                        callbacks: { label: ctx => ` ${label}: ${formatPeso(ctx.parsed.y)}` }
                    }
                },
                animation: {
                    duration: 900,
                    easing: 'easeOutCubic'
                },
                scales: {
                    x: {
                        border: { display: true, color: axisBorderColor, width: 1.5 },
                        ticks: { maxRotation: 0, autoSkip: false, font: { size: 11.5, weight: '700' }, color: tickColor },
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        border: { display: true, color: axisBorderColor, width: 1.5 },
                        ticks: { callback: formatPesoCompact, maxTicksLimit: 6, font: { size: 11.5, weight: '700' }, color: tickColor },
                        grid: { display: true, color: gridColor, borderDash: [4, 4], lineWidth: 1.2 }
                    }
                }
            })
        });

        return instance;
    }

    function buildExpirationStatusChart(canvas, summary) {
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        if (expirationStatusChartInstance) expirationStatusChartInstance.destroy();

        const labels = ['Expiring Soon', 'Expired', 'Renewal Due', 'Pending Review'];
        const values = [
            Number(summary.expiring_soon || 0),
            Number(summary.expired || 0),
            Number(summary.renewal_due || 0),
            Number(summary.pending_review || 0),
        ];
        const colors = ['#f59e0b', '#ef4444', '#8b5cf6', '#14b8a6'];
        const dark = isDarkMode();
        const tickColor = dark ? '#cbd5e1' : '#1e293b';

        expirationStatusChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderColor: dark ? '#09130e' : '#ffffff',
                    borderWidth: 2,
                    hoverOffset: 12,
                }]
            },
            options: compactChartOptions({
                cutout: '58%',
                plugins: {
                    legend: {
                        position: 'bottom',
                        align: 'center',
                        labels: {
                            usePointStyle: true,
                            pointStyle: 'circle',
                            boxWidth: 8,
                            boxHeight: 8,
                            padding: 12,
                            font: { size: 11.5, weight: '700', family: "'Inter', sans-serif" },
                            color: tickColor
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => {
                                const chart = context.chart;
                                const dataset = context.dataset;
                                const total = dataset.data.reduce((sum, val, idx) => {
                                    if (typeof chart.getDataVisibility === 'function' && !chart.getDataVisibility(idx)) return sum;
                                    return sum + (Number(val) || 0);
                                }, 0);
                                const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0.0';
                                return ` ${context.label}: ${context.parsed} lots (${pct}%)`;
                            }
                        }
                    }
                },
                animation: doughnutPopAnimation(700, 120)
            })
        });

        return expirationStatusChartInstance;
    }

    function buildExpirationTrendChart(canvas, rows) {
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        if (expirationTrendChartInstance) expirationTrendChartInstance.destroy();

        const buckets = [
            { label: '0-7d', min: 0, max: 7 },
            { label: '8-14d', min: 8, max: 14 },
            { label: '15-21d', min: 15, max: 21 },
            { label: '22-30d', min: 22, max: 30 },
        ];

        const series = buckets.map(({ min, max }) => {
            return rows.filter((item) => {
                if (!item.end_date) return false;
                const endDate = new Date(`${item.end_date}T00:00:00`);
                const today = new Date();
                today.setHours(0, 0, 0, 0);
                const diff = Math.round((endDate - today) / 86400000);
                return diff >= min && diff <= max;
            }).length;
        });

        expirationTrendChartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels: buckets.map((bucket) => bucket.label),
                datasets: [{
                    label: 'Upcoming expirations',
                    data: series,
                    borderColor: '#0f766e',
                    backgroundColor: 'rgba(15, 118, 110, 0.12)',
                    borderWidth: 3,
                    pointRadius: 4,
                    pointHoverRadius: 5,
                    pointBackgroundColor: '#0f766e',
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 1.5,
                    tension: 0.35,
                    fill: true,
                }]
            },
            options: compactChartOptions({
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: (context) => `${context.parsed.y} lots` } }
                },
                scales: {
                    x: { ticks: { maxRotation: 0, autoSkip: false, font: { size: 10.5 }, padding: 6 }, grid: { display: false } },
                    y: { beginAtZero: true, ticks: { precision: 0, maxTicksLimit: 5, font: { size: 10.5 } }, grid: { color: 'rgba(44, 94, 71, 0.10)' } }
                }
            })
        });

        return expirationTrendChartInstance;
    }

    function staggeredBarAnimation(duration = 900, axis = 'y') {
        const axisKey = axis === 'x' ? 'x' : 'y';
        const scale = axisKey === 'x' ? 'x' : 'y';

        return {
            [axisKey]: {
                easing: 'easeOutCubic',
                duration,
                from(ctx) {
                    const chartScale = ctx.chart.scales[scale];
                    if (!chartScale) return 0;
                    return chartScale.getPixelForValue(0);
                },
                delay(ctx) {
                    return ctx.type === 'data' ? ctx.dataIndex * 60 : 0;
                }
            },
            opacity: {
                easing: 'linear',
                duration: Math.max(300, duration * 0.7),
                from: 0.25,
                to: 1,
                delay(ctx) {
                    return ctx.type === 'data' ? ctx.dataIndex * 60 : 0;
                }
            }
        };
    }

    function doughnutPopAnimation(duration = 700, stagger = 120) {
        return {
            animateRotate: true,
            animateScale: true,
            duration,
            // Stagger each slice so they pop in one after another
            delay(ctx) {
                if (ctx.type === 'data') return ctx.dataIndex * stagger;
                return 0;
            }
        };
    }

    function updateOccupancyAnalysis(data) {
        const sections = data.by_section || [];
        const blocks = data.by_block || [];
        const lotTypes = data.by_lot_type || [];
        const summary = data.summary || {};
        const sectionTotal = sections.reduce((sum, item) => sum + numberValue(item.total), 0);
        const sectionOccupied = sections.reduce((sum, item) => sum + numberValue(item.occupied), 0);
        const sectionAvailable = sections.reduce((sum, item) => sum + numberValue(item.available), 0);
        const total = Number.isFinite(Number(summary.total)) && Number(summary.total) > 0 ? Number(summary.total) : sectionTotal;
        const occupied = Number.isFinite(Number(summary.occupied)) && Number(summary.occupied) >= 0 ? Number(summary.occupied) : sectionOccupied;
        const available = Number.isFinite(Number(summary.available)) && Number(summary.available) >= 0 ? Number(summary.available) : sectionAvailable;
        const reserved = Number.isFinite(Number(summary.reserved)) && Number(summary.reserved) >= 0 ? Number(summary.reserved) : sections.reduce((sum, item) => sum + numberValue(item.reserved), 0);
        const currentRate = total > 0 ? percentValue(occupied, total) : 0;

        const highestSection = topBy(sections, item => item.occupied);
        const mostAvailableSection = topBy(sections, item => item.available);
        const mostReservedSection = topBy(sections, item => item.reserved);
        const highestLotType = topBy(lotTypes, item => item.occupied);
        const mostAvailableType = topBy(lotTypes, item => item.available);
        const mostReservedType = topBy(lotTypes, item => item.reserved);
        const tightestBlock = topBy(blocks, item => percentValue(item.occupied, item.total));
        const openBlock = topBy(blocks, item => item.available);
        const tightestReservedBlock = topBy(blocks, item => item.reserved);

        renderInsightList('sectionInsights', [
            { label: 'Most Available Section', value: mostAvailableSection ? `${mostAvailableSection.section_name}` : 'No data', sub: mostAvailableSection ? `${numberValue(mostAvailableSection.available)} lots available` : '', className: 'brand' },
            { label: 'Reserved Lots', value: `${numberValue(reserved)} lots`, sub: total > 0 ? `${percentValue(reserved, total)}% of total plots` : '', className: 'brand' },
            { label: 'Current Risk Level', value: occupancyRisk(currentRate).label, sub: `${currentRate}% overall occupancy`, className: 'brand' },
        ]);

        renderInsightList('lotTypeInsights', [
            { label: 'Most Used Lot Type', value: highestLotType ? `${highestLotType.type_name}` : 'No data', sub: highestLotType ? `${numberValue(highestLotType.occupied)} plots occupied` : '', className: 'brand' },
            { label: 'Most Reserved Lot Type', value: mostReservedType ? `${mostReservedType.type_name}` : 'No data', sub: mostReservedType ? `${numberValue(mostReservedType.reserved)} plots reserved` : '', className: 'brand' },
            { label: 'Best Remaining Inventory', value: mostAvailableType ? `${mostAvailableType.type_name}` : 'No data', sub: mostAvailableType ? `${numberValue(mostAvailableType.available)} plots open` : '', className: 'brand' },
        ]);

        renderInsightList('blockInsights', [
            {
                label: 'Tightest Block',
                value: tightestBlock ? `${tightestBlock.block_name} · ${tightestBlock.section_name}` : 'No data',
                sub: tightestBlock ? `${percentValue(tightestBlock.occupied, tightestBlock.total)}% utilized · ${numberValue(tightestBlock.occupied)}/${numberValue(tightestBlock.total)} plots` : '',
                className: 'brand'
            },
            {
                label: 'Most Reserved Block',
                value: tightestReservedBlock ? `${tightestReservedBlock.block_name} · ${tightestReservedBlock.section_name}` : 'No data',
                sub: tightestReservedBlock ? `${numberValue(tightestReservedBlock.reserved)} reserved · ${percentValue(tightestReservedBlock.reserved, tightestReservedBlock.total)}% on hold` : '',
                className: 'brand'
            },
            {
                label: 'Best Relief Block',
                value: openBlock ? `${openBlock.block_name} · ${openBlock.section_name}` : 'No data',
                sub: openBlock ? `${numberValue(openBlock.available)} open plots · ${percentValue(openBlock.available, openBlock.total)}% free` : '',
                className: 'brand'
            },
        ]);
    }

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

    async function loadOccupancy() {
        try {
            const data = await api.request('reports/occupancy', { method: 'GET' });
            const reservationStats = await api.request(`schedules/stats?year=${new Date().getFullYear()}`, { method: 'GET' });
            const sections = data.by_section || [];
            const sectionTotal = sections.reduce((sum, item) => sum + Number(item.total || 0), 0);
            const sectionOccupied = sections.reduce((sum, item) => sum + Number(item.occupied || 0), 0);
            const sectionAvailable = sections.reduce((sum, item) => sum + Number(item.available || 0), 0);
            const sectionReserved = sections.reduce((sum, item) => sum + Number(item.reserved || 0), 0);
            const summaryTotal = Number(data.summary?.total);
            const summaryOccupied = Number(data.summary?.occupied);
            const summaryAvailable = Number(data.summary?.available);
            const summaryReserved = Number(data.summary?.reserved);
            const fallbackReservationTotal = Number(reservationStats?.total || 0);

            const computedTotal = Number.isFinite(summaryTotal) && summaryTotal > 0 ? summaryTotal : sectionTotal;
            const computedOccupied = Number.isFinite(summaryOccupied) && summaryOccupied >= 0 ? summaryOccupied : sectionOccupied;
            const computedAvailable = Number.isFinite(summaryAvailable) && summaryAvailable >= 0 ? summaryAvailable : sectionAvailable;
            const computedReserved = Number.isFinite(summaryReserved) && summaryReserved >= 0 ? summaryReserved : sectionReserved;
            const displayReserved = computedReserved > 0 ? computedReserved : fallbackReservationTotal;
            const sectionReservedSeries = buildReservedFallbackSeries(data.by_section || [], displayReserved);
            const blockReservedSeries = buildReservedFallbackSeries(data.by_block || [], displayReserved);
            const lotTypeReservedSeries = buildReservedFallbackSeries(data.by_lot_type || [], displayReserved);

            document.getElementById('occTotal').innerText = computedTotal || 0;
            document.getElementById('occOccupied').innerText = computedOccupied || 0;
            document.getElementById('occAvailable').innerText = computedAvailable || 0;
            document.getElementById('occRate').innerText = displayReserved || 0;

            const occCanvas = document.getElementById('occupancyChart');
            occCanvas.style.display = 'block';
            occCanvas.style.width = '100%';
            occCanvas.style.height = '380px';
            occCanvas.height = 380;
            if (occCanvas.parentElement) {
                occCanvas.parentElement.style.minHeight = '396px';
                occCanvas.parentElement.style.height = 'auto';
            }
            const ctx = occCanvas.getContext('2d');
            const labels = (data.by_section || []).map(item => item.section_name);
            if (occupancyChartInstance) occupancyChartInstance.destroy();

            // Populate Legend Button counts for By Section
            const sectionList = data.by_section || [];
            const secTotalAvail = sectionList.reduce((acc, s) => acc + (Number(s.available) || 0), 0);
            const secTotalOcc = sectionList.reduce((acc, s) => acc + (Number(s.occupied) || 0), 0);
            const secTotalRes = sectionReservedSeries.reduce((acc, v) => acc + (Number(v) || 0), 0);

            const secAvailCountEl = document.getElementById('sectionLegendAvailCount');
            const secOccCountEl = document.getElementById('sectionLegendOccCount');
            const secResCountEl = document.getElementById('sectionLegendResCount');
            if (secAvailCountEl) secAvailCountEl.textContent = numberValue(secTotalAvail);
            if (secOccCountEl) secOccCountEl.textContent = numberValue(secTotalOcc);
            if (secResCountEl) secResCountEl.textContent = numberValue(secTotalRes);

            const secLegendContainer = document.getElementById('sectionChartLegendBtns');
            if (secLegendContainer && !secLegendContainer.dataset.initialized) {
                secLegendContainer.dataset.initialized = 'true';
                secLegendContainer.querySelectorAll('.legend-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (!occupancyChartInstance) return;
                        const dsIdx = parseInt(btn.getAttribute('data-dataset-index'), 10);
                        const isVisible = occupancyChartInstance.isDatasetVisible(dsIdx);
                        occupancyChartInstance.setDatasetVisibility(dsIdx, !isVisible);
                        occupancyChartInstance.update();
                        if (isVisible) {
                            btn.classList.add('muted');
                            btn.classList.remove('active');
                        } else {
                            btn.classList.remove('muted');
                            btn.classList.add('active');
                        }
                    });
                });
            }

            const secDark = isDarkMode();
            const secAxisBorderColor = secDark ? 'rgba(255, 255, 255, 0.22)' : 'rgba(44, 94, 71, 0.32)';
            const secGridColor = secDark ? 'rgba(255, 255, 255, 0.12)' : 'rgba(44, 94, 71, 0.18)';
            occupancyChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Available',
                            data: (data.by_section || []).map(item => item.available || 0),
                            backgroundColor: 'rgba(16, 185, 129, 0.95)',
                            borderColor: '#047857',
                            borderWidth: 2,
                            borderRadius: 6,
                            maxBarThickness: 54,
                            barPercentage: 0.68,
                            categoryPercentage: 0.78,
                            hoverBorderWidth: 2.5,
                            hoverBorderColor: '#ffffff'
                        },
                        {
                            label: 'Occupied',
                            data: (data.by_section || []).map(item => item.occupied || 0),
                            backgroundColor: 'rgba(239, 68, 68, 0.95)',
                            borderColor: '#b91c1c',
                            borderWidth: 2,
                            borderRadius: 6,
                            maxBarThickness: 54,
                            barPercentage: 0.68,
                            categoryPercentage: 0.78,
                            hoverBorderWidth: 2.5,
                            hoverBorderColor: '#ffffff'
                        },
                        {
                            label: 'Reserved Space',
                            data: sectionReservedSeries,
                            backgroundColor: 'rgba(245, 158, 11, 0.95)',
                            borderColor: '#b45309',
                            borderWidth: 2,
                            borderRadius: 6,
                            maxBarThickness: 54,
                            barPercentage: 0.68,
                            categoryPercentage: 0.78,
                            hoverBorderWidth: 2.5,
                            hoverBorderColor: '#ffffff'
                        },
                    ]
                },
                options: compactChartOptions({
                    layout: {
                        padding: { top: 14, right: 16, bottom: 8, left: 12 }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: secDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                            titleColor: secDark ? '#f8fafc' : '#0f172a',
                            bodyColor: secDark ? '#cbd5e1' : '#334155',
                            borderColor: secDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(44, 94, 71, 0.30)',
                            borderWidth: 1.5,
                            padding: 11,
                            boxPadding: 5,
                            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} lots` }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            border: { display: true, color: secAxisBorderColor, width: 1.5 },
                            ticks: {
                                font: { size: 12.5, weight: '800', family: "'Inter', sans-serif" },
                                color: secDark ? '#ffffff' : '#06170f',
                                padding: 8,
                                maxRotation: 0,
                                autoSkip: false,
                                callback: function(value) {
                                    const lbl = this.getLabelForValue(value);
                                    if (typeof lbl === 'string' && lbl.length > 28) {
                                        return lbl.slice(0, 26) + '…';
                                    }
                                    return lbl;
                                }
                            },
                            grid: { display: false }
                        },
                        y: {
                            stacked: true,
                            beginAtZero: true,
                            border: { display: true, color: secAxisBorderColor, width: 1.5 },
                            ticks: {
                                precision: 0,
                                maxTicksLimit: 6,
                                font: { size: 12, weight: '750' },
                                color: secDark ? '#cbd5e1' : '#1e293b',
                                padding: 8
                            },
                            grid: {
                                display: true,
                                color: secGridColor,
                                borderDash: [4, 4],
                                lineWidth: 1.2
                            }
                        }
                    },
                    animations: staggeredBarAnimation(850)
                })
            });

            const blockCanvas = document.getElementById('occupancyByBlockChart');
            const blocksList = data.by_block || [];
            // Dynamically scale canvas and frame height according to block count so bars are spacious
            const blockRowHeight = 44;
            const dynamicBlockHeight = Math.max(340, Math.min(760, blocksList.length * blockRowHeight + 70));
            blockCanvas.style.display = 'block';
            blockCanvas.style.width = '100%';
            blockCanvas.style.height = `${dynamicBlockHeight}px`;
            blockCanvas.height = dynamicBlockHeight;
            if (blockCanvas.parentElement) {
                blockCanvas.parentElement.style.minHeight = `${dynamicBlockHeight + 16}px`;
                blockCanvas.parentElement.style.height = 'auto';
            }
            const blockCtx = blockCanvas.getContext('2d');
            if (occupancyByBlockChartInstance) occupancyByBlockChartInstance.destroy();

            // Populate Legend Button counts
            const totalAvail = blocksList.reduce((acc, b) => acc + (Number(b.available) || 0), 0);
            const totalOcc = blocksList.reduce((acc, b) => acc + (Number(b.occupied) || 0), 0);
            const totalRes = blockReservedSeries.reduce((acc, v) => acc + (Number(v) || 0), 0);

            const availCountEl = document.getElementById('blockLegendAvailCount');
            const occCountEl = document.getElementById('blockLegendOccCount');
            const resCountEl = document.getElementById('blockLegendResCount');
            if (availCountEl) availCountEl.textContent = numberValue(totalAvail);
            if (occCountEl) occCountEl.textContent = numberValue(totalOcc);
            if (resCountEl) resCountEl.textContent = numberValue(totalRes);

            // Wire up interactive Legend Button filters
            const legendContainer = document.getElementById('blockChartLegendBtns');
            if (legendContainer && !legendContainer.dataset.initialized) {
                legendContainer.dataset.initialized = 'true';
                legendContainer.querySelectorAll('.legend-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (!occupancyByBlockChartInstance) return;
                        const dsIdx = parseInt(btn.getAttribute('data-dataset-index'), 10);
                        const isVisible = occupancyByBlockChartInstance.isDatasetVisible(dsIdx);
                        occupancyByBlockChartInstance.setDatasetVisibility(dsIdx, !isVisible);
                        occupancyByBlockChartInstance.update();
                        if (isVisible) {
                            btn.classList.add('muted');
                            btn.classList.remove('active');
                        } else {
                            btn.classList.remove('muted');
                            btn.classList.add('active');
                        }
                    });
                });
            }



            const dark = isDarkMode();
            const blockAxisBorderColor = dark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(44, 94, 71, 0.35)';
            const blockGridColor = dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(44, 94, 71, 0.18)';
            occupancyByBlockChartInstance = new Chart(blockCtx, {
                type: 'bar',
                data: {
                    labels: blocksList.map(item => `${item.block_name} · ${item.section_name}`),
                    datasets: [
                        {
                            label: 'Available',
                            data: blocksList.map(item => item.available || 0),
                            backgroundColor: 'rgba(16, 185, 129, 0.95)',
                            borderColor: '#047857',
                            borderWidth: 2,
                            borderRadius: 6,
                            maxBarThickness: 28,
                            barPercentage: 0.82,
                            categoryPercentage: 0.88,
                            hoverBorderWidth: 2.5,
                            hoverBorderColor: '#ffffff'
                        },
                        {
                            label: 'Occupied',
                            data: blocksList.map(item => item.occupied || 0),
                            backgroundColor: 'rgba(239, 68, 68, 0.95)',
                            borderColor: '#b91c1c',
                            borderWidth: 2,
                            borderRadius: 6,
                            maxBarThickness: 28,
                            barPercentage: 0.82,
                            categoryPercentage: 0.88,
                            hoverBorderWidth: 2.5,
                            hoverBorderColor: '#ffffff'
                        },
                        {
                            label: 'Reserved Space',
                            data: blockReservedSeries,
                            backgroundColor: 'rgba(245, 158, 11, 0.95)',
                            borderColor: '#b45309',
                            borderWidth: 2,
                            borderRadius: 6,
                            maxBarThickness: 28,
                            barPercentage: 0.82,
                            categoryPercentage: 0.88,
                            hoverBorderWidth: 2.5,
                            hoverBorderColor: '#ffffff'
                        },
                    ]
                },
                options: compactChartOptions({
                    indexAxis: 'y',
                    layout: {
                        padding: { top: 12, right: 20, bottom: 8, left: 12 }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: dark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                            titleColor: dark ? '#f8fafc' : '#0f172a',
                            bodyColor: dark ? '#cbd5e1' : '#334155',
                            borderColor: dark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(44, 94, 71, 0.30)',
                            borderWidth: 1.5,
                            padding: 11,
                            boxPadding: 5,
                            callbacks: {
                                label: ctx => `  ${ctx.dataset.label}: ${ctx.parsed.x} plots`
                            }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            beginAtZero: true,
                            border: { display: true, color: blockAxisBorderColor, width: 1.5 },
                            ticks: {
                                precision: 0,
                                font: { size: 12, weight: '750' },
                                color: dark ? '#cbd5e1' : '#1e293b',
                                padding: 8
                            },
                            grid: {
                                display: true,
                                color: blockGridColor,
                                borderDash: [4, 4],
                                lineWidth: 1.2
                            }
                        },
                        y: {
                            stacked: true,
                            border: { display: true, color: blockAxisBorderColor, width: 1.5 },
                            ticks: {
                                font: { size: 12.5, weight: '800', family: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif" },
                                color: dark ? '#ffffff' : '#06170f',
                                padding: 14,
                                autoSkip: false,
                                callback: function(val) {
                                    const label = this.getLabelForValue(val) || '';
                                    return label.length > 32 ? label.substring(0, 30) + '…' : label;
                                }
                            },
                            grid: { display: false }
                        }
                    },
                    animations: staggeredBarAnimation(850, 'x')
                })
            });

            const typeCanvas = document.getElementById('occupancyByTypeChart');
            typeCanvas.style.display = 'block';
            typeCanvas.style.width = '100%';
            typeCanvas.style.height = '380px';
            typeCanvas.height = 380;
            if (typeCanvas.parentElement) {
                typeCanvas.parentElement.style.minHeight = '396px';
                typeCanvas.parentElement.style.height = 'auto';
            }
            const typeCtx = typeCanvas.getContext('2d');
            if (occupancyByTypeChartInstance) occupancyByTypeChartInstance.destroy();

            // Populate Legend Button counts for By Lot Type
            const typeList = data.by_lot_type || [];
            const typeTotalAvail = typeList.reduce((acc, t) => acc + (Number(t.available) || 0), 0);
            const typeTotalOcc = typeList.reduce((acc, t) => acc + (Number(t.occupied) || 0), 0);
            const typeTotalRes = lotTypeReservedSeries.reduce((acc, v) => acc + (Number(v) || 0), 0);

            const typeAvailCountEl = document.getElementById('typeLegendAvailCount');
            const typeOccCountEl = document.getElementById('typeLegendOccCount');
            const typeResCountEl = document.getElementById('typeLegendResCount');
            if (typeAvailCountEl) typeAvailCountEl.textContent = numberValue(typeTotalAvail);
            if (typeOccCountEl) typeOccCountEl.textContent = numberValue(typeTotalOcc);
            if (typeResCountEl) typeResCountEl.textContent = numberValue(typeTotalRes);

            const typeLegendContainer = document.getElementById('typeChartLegendBtns');
            if (typeLegendContainer && !typeLegendContainer.dataset.initialized) {
                typeLegendContainer.dataset.initialized = 'true';
                typeLegendContainer.querySelectorAll('.legend-btn').forEach(btn => {
                    btn.addEventListener('click', () => {
                        if (!occupancyByTypeChartInstance) return;
                        const dsIdx = parseInt(btn.getAttribute('data-dataset-index'), 10);
                        const isVisible = occupancyByTypeChartInstance.isDatasetVisible(dsIdx);
                        occupancyByTypeChartInstance.setDatasetVisibility(dsIdx, !isVisible);
                        occupancyByTypeChartInstance.update();
                        if (isVisible) {
                            btn.classList.add('muted');
                            btn.classList.remove('active');
                        } else {
                            btn.classList.remove('muted');
                            btn.classList.add('active');
                        }
                    });
                });
            }

            const typeDark = isDarkMode();
            const typeAxisBorderColor = typeDark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(44, 94, 71, 0.35)';
            const typeGridColor = typeDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(44, 94, 71, 0.18)';
            occupancyByTypeChartInstance = new Chart(typeCtx, {
                type: 'bar',
                data: {
                    labels: (data.by_lot_type || []).map(item => item.type_name),
                    datasets: [
                        {
                            label: 'Available',
                            data: (data.by_lot_type || []).map(item => item.available || 0),
                            backgroundColor: 'rgba(16, 185, 129, 0.95)',
                            borderColor: '#047857',
                            borderWidth: 2,
                            borderRadius: 6,
                            maxBarThickness: 54,
                            barPercentage: 0.68,
                            categoryPercentage: 0.78,
                            hoverBorderWidth: 2.5,
                            hoverBorderColor: '#ffffff'
                        },
                        {
                            label: 'Occupied',
                            data: (data.by_lot_type || []).map(item => item.occupied || 0),
                            backgroundColor: 'rgba(239, 68, 68, 0.95)',
                            borderColor: '#b91c1c',
                            borderWidth: 2,
                            borderRadius: 6,
                            maxBarThickness: 54,
                            barPercentage: 0.68,
                            categoryPercentage: 0.78,
                            hoverBorderWidth: 2.5,
                            hoverBorderColor: '#ffffff'
                        },
                        {
                            label: 'Reserved Space',
                            data: lotTypeReservedSeries,
                            backgroundColor: 'rgba(245, 158, 11, 0.95)',
                            borderColor: '#b45309',
                            borderWidth: 2,
                            borderRadius: 6,
                            maxBarThickness: 54,
                            barPercentage: 0.68,
                            categoryPercentage: 0.78,
                            hoverBorderWidth: 2.5,
                            hoverBorderColor: '#ffffff'
                        },
                    ]
                },
                options: compactChartOptions({
                    layout: {
                        padding: { top: 14, right: 16, bottom: 8, left: 12 }
                    },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            backgroundColor: typeDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                            titleColor: typeDark ? '#f8fafc' : '#0f172a',
                            bodyColor: typeDark ? '#cbd5e1' : '#334155',
                            borderColor: typeDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(44, 94, 71, 0.30)',
                            borderWidth: 1.5,
                            padding: 11,
                            boxPadding: 5,
                            callbacks: { label: ctx => ` ${ctx.dataset.label}: ${ctx.parsed.y} lots` }
                        }
                    },
                    scales: {
                        x: {
                            stacked: true,
                            border: { display: true, color: typeAxisBorderColor, width: 1.5 },
                            ticks: {
                                font: { size: 12.5, weight: '800', family: "'Inter', sans-serif" },
                                color: typeDark ? '#ffffff' : '#06170f',
                                padding: 8,
                                maxRotation: 0,
                                autoSkip: false,
                                callback: function(value) {
                                    const lbl = this.getLabelForValue(value);
                                    if (typeof lbl === 'string' && lbl.length > 28) {
                                        return lbl.slice(0, 26) + '…';
                                    }
                                    return lbl;
                                }
                            },
                            grid: { display: false }
                        },
                        y: {
                            stacked: true,
                            beginAtZero: true,
                            border: { display: true, color: typeAxisBorderColor, width: 1.5 },
                            ticks: {
                                precision: 0,
                                maxTicksLimit: 6,
                                font: { size: 12, weight: '750' },
                                color: typeDark ? '#cbd5e1' : '#1e293b',
                                padding: 8
                            },
                            grid: {
                                display: true,
                                color: typeGridColor,
                                borderDash: [4, 4],
                                lineWidth: 1.2
                            }
                        }
                    },
                    animations: staggeredBarAnimation(850)
                })
            });
            updateOccupancyAnalysis(data);

            // Section Capacity & Space Utilization Matrix Table
            const sectionTbody = document.getElementById('sectionCapacityTableBody');
            if (sectionTbody) {
                if (!sections.length) {
                    sectionTbody.innerHTML = '<tr><td colspan="7" class="text-center">No section capacity data available.</td></tr>';
                } else {
                    sectionTbody.innerHTML = sections.map(sec => {
                        const totalPlots = Number(sec.total || 0);
                        const occ = Number(sec.occupied || 0);
                        const res = Number(sec.reserved || 0);
                        const avl = Number(sec.available || 0);
                        const rate = Number(sec.capacity_rate ?? (totalPlots > 0 ? ((occ + res) / totalPlots * 100).toFixed(1) : 0));
                        let statusBadge = '<span class="capacity-status-badge capacity-status-badge--optimal"><i class="fas fa-circle-check"></i> Optimal Capacity</span>';
                        if (avl <= 0) {
                            statusBadge = '<span class="capacity-status-badge capacity-status-badge--critical"><i class="fas fa-circle-exclamation"></i> Critical / Full</span>';
                        } else if (rate >= 85) {
                            statusBadge = '<span class="capacity-status-badge capacity-status-badge--tight"><i class="fas fa-triangle-exclamation"></i> Tight Capacity</span>';
                        }
                        return `
                            <tr>
                                <td><strong>${sec.section_name || 'Unnamed Section'}</strong></td>
                                <td class="text-right">${totalPlots.toLocaleString()}</td>
                                <td class="text-right" style="color: #b91c1c; font-weight: 600;">${occ.toLocaleString()}</td>
                                <td class="text-right" style="color: #b45309;">${res.toLocaleString()}</td>
                                <td class="text-right" style="color: #047857; font-weight: 600;">${avl.toLocaleString()}</td>
                                <td class="text-right"><strong>${rate}%</strong></td>
                                <td>${statusBadge}</td>
                            </tr>
                        `;
                    }).join('');
                }
            }
        } catch (error) {
            console.error('Failed to load occupancy:', error);
        }
    }

    async function loadRevenue() {
        try {
            const from = document.getElementById('revDateFrom').value;
            const to = document.getElementById('revDateTo').value;
            const hasDateRange = Boolean(from || to);

            const params = [];
            if (from) params.push(`date_from=${encodeURIComponent(from)}`);
            if (to) params.push(`date_to=${encodeURIComponent(to)}`);

            const url = params.length ? `reports/revenue?${params.join('&')}` : 'reports/revenue';
            const data = await api.request(url, { method: 'GET' });
            document.getElementById('revTotal').innerText = formatPeso(data.total?.total);
            document.getElementById('revTotalSub').innerText = hasDateRange ? 'Filtered period' : 'All payments';
            document.getElementById('revCount').innerText = data.total?.count || 0;
            document.getElementById('revCountSub').innerText = hasDateRange ? 'Filtered count' : 'All transactions';

            // Service Revenue Stream Breakdown Matrix Table
            const serviceBreakdown = Array.isArray(data.service_breakdown) ? data.service_breakdown : [];
            const serviceTbody = document.getElementById('serviceRevenueTableBody');
            if (serviceTbody) {
                if (!serviceBreakdown.length) {
                    serviceTbody.innerHTML = '<tr><td colspan="6" class="text-center">No service revenue records found for selected period.</td></tr>';
                } else {
                    serviceTbody.innerHTML = serviceBreakdown.map(item => {
                        const count = Number(item.count || 0);
                        const total = Number(item.total || 0);
                        const avg = Number(item.average_amount || (count > 0 ? total / count : 0));
                        const pct = Number(item.percentage || 0);
                        return `
                            <tr>
                                <td>
                                    <strong>${item.service_label || item.transaction_type}</strong>
                                    <br><small style="color: #64748b; font-size: 0.76rem;">Category: ${item.transaction_type}</small>
                                </td>
                                <td class="text-right">${count.toLocaleString()}</td>
                                <td class="text-right"><strong>${formatPeso(total)}</strong></td>
                                <td class="text-right">${formatPeso(avg)}</td>
                                <td class="text-right"><strong>${pct}%</strong></td>
                                <td>
                                    <div class="share-progress-wrap">
                                        <div class="share-progress-bar">
                                            <div class="share-progress-fill" style="width: ${Math.min(100, Math.max(3, pct))}%;"></div>
                                        </div>
                                    </div>
                                </td>
                            </tr>
                        `;
                    }).join('');
                }
            }

            // Use the selected date range when present; otherwise, keep the chart on the
            // current calendar year while the stat card stays based on the actual no-filter total.
            const monthYear = to ? new Date(to).getFullYear() : from ? new Date(from).getFullYear() : new Date().getFullYear();
            const monthData = await api.request(`payments/revenue-by-month?year=${monthYear}`, { method: 'GET' });
            const revenueCanvas = document.getElementById('revenueChart');
            revenueCanvas.style.display = 'block';
            revenueCanvas.style.width = '100%';
            revenueCanvas.style.height = '320px';
            revenueCanvas.height = 320;
            revenueMonthChart = buildRevenueLineChart(revenueCanvas, monthData.map(item => `${MONTH_NAMES[item.month - 1]} ${monthYear}`), monthData.map(item => item.total || 0), {
                chartRef: revenueMonthChart,
                label: 'Monthly Revenue'
            });

            const yearData = await api.request(`payments/revenue-by-year${params.length ? '?' + params.join('&') : ''}`, { method: 'GET' });
            const yearMap = new Map((yearData || []).map(item => [Number(item.year), Number(item.total) || 0]));
            const yearLabels = hasDateRange
                ? (yearData || []).map(item => String(item.year))
                : Array.from({ length: 13 }, (_, index) => String(new Date().getFullYear() + index));
            const yearValues = hasDateRange
                ? (yearData || []).map(item => Number(item.total) || 0)
                : yearLabels.map(year => yearMap.get(Number(year)) || 0);

            const yearCanvas = document.getElementById('revenueYearChart');
            yearCanvas.style.display = 'block';
            yearCanvas.style.width = '100%';
            yearCanvas.style.height = '320px';
            yearCanvas.height = 320;
            revenueYearChart = buildRevenueLineChart(yearCanvas, yearLabels, yearValues, {
                chartRef: revenueYearChart,
                label: 'Yearly Revenue'
            });

            const breakdown = data.breakdown || [];
            const labels = breakdown.map(item => item.transaction_type || 'Unknown');
            const values = breakdown.map(item => item.total || 0);
            const palette = CHART_COLORS.accent;
            const breakdownColors = labels.map((l, idx) => palette[idx % palette.length]);
            const breakdownCanvas = document.getElementById('revenueBreakdownChart');
            breakdownCanvas.style.display = 'block';
            breakdownCanvas.style.width = '100%';
            breakdownCanvas.style.height = '280px';
            breakdownCanvas.height = 280;
            const breakdownCtx = breakdownCanvas.getContext('2d');
            if (revenueBreakdownChartInstance) revenueBreakdownChartInstance.destroy();
            const revDark = isDarkMode();
            const revTickColor = revDark ? '#cbd5e1' : '#1e293b';
            revenueBreakdownChartInstance = new Chart(breakdownCtx, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        data: values,
                        backgroundColor: breakdownColors,
                        borderColor: revDark ? '#09130e' : '#ffffff',
                        borderWidth: 2,
                        hoverOffset: 12
                    }]
                },
                options: compactChartOptions({
                    cutout: '58%',
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            align: 'center',
                            labels: {
                                usePointStyle: true,
                                pointStyle: 'circle',
                                boxWidth: 8,
                                boxHeight: 8,
                                padding: 12,
                                font: { size: 11.5, weight: '700', family: "'Inter', sans-serif" },
                                color: revTickColor
                            }
                        },
                        tooltip: {
                            backgroundColor: revDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                            titleColor: revDark ? '#f8fafc' : '#0f172a',
                            bodyColor: revDark ? '#cbd5e1' : '#334155',
                            borderColor: revDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(44, 94, 71, 0.30)',
                            borderWidth: 1.5,
                            padding: 11,
                            boxPadding: 5,
                            callbacks: {
                                label: (context) => {
                                    const chart = context.chart;
                                    const dataset = context.dataset;
                                    const total = dataset.data.reduce((sum, val, idx) => {
                                        if (typeof chart.getDataVisibility === 'function' && !chart.getDataVisibility(idx)) return sum;
                                        return sum + (Number(val) || 0);
                                    }, 0);
                                    const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0.0';
                                    return ` ${context.label}: ${formatPeso(context.parsed)} (${pct}%)`;
                                }
                            }
                        }
                    },
                    animation: doughnutPopAnimation(700, 120)
                })
            });

            const verificationBreakdown = await api.request(`payments/verification-breakdown${params.length ? '?' + params.join('&') : ''}`, { method: 'GET' });
            const pending = verificationBreakdown.find(item => item.verification_status === 'Pending');
            const verified = verificationBreakdown.find(item => item.verification_status === 'Verified');
            document.getElementById('revPendingCount').innerText = pending?.count || 0;
            document.getElementById('revPendingAmount').innerText = `${formatPeso(pending?.total)} pending`;
            document.getElementById('revVerifiedCount').innerText = verified?.count || 0;
            document.getElementById('revVerifiedAmount').innerText = `${formatPeso(verified?.total)} verified`;

            const verificationCanvas = document.getElementById('verificationBreakdownChart');
            verificationCanvas.style.display = 'block';
            verificationCanvas.style.width = '100%';
            verificationCanvas.style.height = '280px';
            verificationCanvas.height = 280;
            const verificationCtx = verificationCanvas.getContext('2d');
            if (verificationBreakdownChartInstance) verificationBreakdownChartInstance.destroy();
            const vLabels = verificationBreakdown.map(item => item.verification_status);
            const vValues = verificationBreakdown.map(item => Number(item.count) || 0);
            const vAmounts = verificationBreakdown.map(item => Number(item.total) || 0);
            const vColors = vLabels.map(l => CHART_COLORS.verification[l] || CHART_COLORS.verification[l?.charAt(0).toUpperCase() + l?.slice(1).toLowerCase()] || CHART_COLORS.accent[0]);
            const verDark = isDarkMode();
            const verTickColor = verDark ? '#cbd5e1' : '#1e293b';
            verificationBreakdownChartInstance = new Chart(verificationCtx, {
                type: 'doughnut',
                data: {
                    labels: vLabels,
                    datasets: [{
                        data: vValues,
                        backgroundColor: vColors,
                        borderColor: verDark ? '#09130e' : '#ffffff',
                        borderWidth: 2,
                        hoverOffset: 12
                    }]
                },
                options: compactChartOptions({
                    cutout: '58%',
                    plugins: {
                        legend: {
                            display: true,
                            position: 'bottom',
                            align: 'center',
                            labels: {
                                usePointStyle: true,
                                pointStyle: 'circle',
                                boxWidth: 8,
                                boxHeight: 8,
                                padding: 12,
                                font: { size: 11.5, weight: '700', family: "'Inter', sans-serif" },
                                color: verTickColor
                            }
                        },
                        tooltip: {
                            backgroundColor: verDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                            titleColor: verDark ? '#f8fafc' : '#0f172a',
                            bodyColor: verDark ? '#cbd5e1' : '#334155',
                            borderColor: verDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(44, 94, 71, 0.30)',
                            borderWidth: 1.5,
                            padding: 11,
                            boxPadding: 5,
                            callbacks: {
                                label: (context) => {
                                    const chart = context.chart;
                                    const dataset = context.dataset;
                                    const total = dataset.data.reduce((sum, val, idx) => {
                                        if (typeof chart.getDataVisibility === 'function' && !chart.getDataVisibility(idx)) return sum;
                                        return sum + (Number(val) || 0);
                                    }, 0);
                                    const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0.0';
                                    const count = context.parsed;
                                    const amount = vAmounts[context.dataIndex] || 0;
                                    return ` ${context.label}: ${count} payment${count === 1 ? '' : 's'} (${formatPeso(amount)}) • ${pct}%`;
                                }
                            }
                        }
                    },
                    animation: doughnutPopAnimation(700, 120)
                })
            });

            const methodBreakdown = await api.request(`payments/revenue-by-method${params.length ? '?' + params.join('&') : ''}`, { method: 'GET' });
            const methodCanvas = document.getElementById('revenueByMethodChart');
            methodCanvas.style.display = 'block';
            methodCanvas.style.width = '100%';
            methodCanvas.style.height = '320px';
            methodCanvas.height = 320;
            const methodCtx = methodCanvas.getContext('2d');
            if (revenueByMethodChartInstance) revenueByMethodChartInstance.destroy();
            const methodLabels = methodBreakdown.map(item => item.payment_method);
            const methodValues = methodBreakdown.map(item => item.total || 0);
            const methodColors = methodLabels.map(m => CHART_COLORS.methodDefaults[m] || CHART_COLORS.accent[methodLabels.indexOf(m) % CHART_COLORS.accent.length]);
            const methDark = isDarkMode();
            const methTickColor = methDark ? '#cbd5e1' : '#1e293b';
            const methAxisBorderColor = methDark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(44, 94, 71, 0.35)';
            const methGridColor = methDark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(44, 94, 71, 0.18)';
            revenueByMethodChartInstance = new Chart(methodCtx, {
                type: 'bar',
                data: {
                    labels: methodLabels,
                    datasets: [{
                        label: 'Payment Method',
                        data: methodValues,
                        backgroundColor: methodColors,
                        borderColor: methDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(15, 23, 42, 0.15)',
                        borderWidth: 1.5,
                        hoverBorderWidth: 2.5,
                        hoverBorderColor: '#ffffff',
                        borderRadius: 8,
                        maxBarThickness: 64
                    }]
                },
                options: compactChartOptions({
                    animations: staggeredBarAnimation(),
                    layout: { padding: { top: 12, right: 16, bottom: 8, left: 12 } },
                    plugins: {
                        legend: {
                            display: true,
                            position: 'top',
                            align: 'end',
                            labels: {
                                usePointStyle: true,
                                pointStyle: 'circle',
                                boxWidth: 8,
                                boxHeight: 8,
                                padding: 12,
                                font: { size: 11.5, weight: '700', family: "'Inter', sans-serif" },
                                color: methTickColor,
                                generateLabels: function(chart) {
                                    const d = chart.data;
                                    if (d.labels.length && d.datasets.length) {
                                        const ds = d.datasets[0];
                                        return d.labels.map((lbl, i) => ({
                                            text: lbl,
                                            fillStyle: Array.isArray(ds.backgroundColor) ? ds.backgroundColor[i] : ds.backgroundColor,
                                            strokeStyle: '#ffffff',
                                            lineWidth: 1.5,
                                            pointStyle: 'circle',
                                            hidden: chart.getDataVisibility ? !chart.getDataVisibility(i) : false,
                                            index: i
                                        }));
                                    }
                                    return [];
                                }
                            },
                            onClick: function(e, legendItem, legend) {
                                const index = legendItem.index;
                                const ci = legend.chart;
                                if (ci.getDataVisibility(index)) {
                                    ci.hide(0, index);
                                    legendItem.hidden = true;
                                } else {
                                    ci.show(0, index);
                                    legendItem.hidden = false;
                                }
                                ci.update();
                            }
                        },
                        tooltip: {
                            backgroundColor: methDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.98)',
                            titleColor: methDark ? '#f8fafc' : '#0f172a',
                            bodyColor: methDark ? '#cbd5e1' : '#334155',
                            borderColor: methDark ? 'rgba(255, 255, 255, 0.20)' : 'rgba(44, 94, 71, 0.30)',
                            borderWidth: 1.5,
                            padding: 11,
                            boxPadding: 5,
                            callbacks: { label: ctx => ` ${ctx.label}: ${formatPeso(ctx.parsed.y)}` }
                        }
                    },
                    scales: {
                        x: {
                            border: { display: true, color: methAxisBorderColor, width: 1.5 },
                            ticks: { font: { size: 12, weight: '800' }, color: methDark ? '#ffffff' : '#06170f' },
                            grid: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            border: { display: true, color: methAxisBorderColor, width: 1.5 },
                            ticks: { callback: formatPesoCompact, maxTicksLimit: 6, font: { size: 11.5, weight: '700' }, color: methTickColor },
                            grid: { display: true, color: methGridColor, borderDash: [4, 4], lineWidth: 1.2 }
                        }
                    }
                })
            });
            // Recent transactions table for quick review
            // Simple recent transactions table without pagination on the reports tab
            async function loadRecentPayments(perPage = 8) {
                try {
                    const resp = await api.request(`reports/recent-payments?per_page=${perPage}`, { method: 'GET' });
                    const rows = Array.isArray(resp?.data) ? resp.data : (Array.isArray(resp) ? resp : []);
                    const tbody = document.getElementById('recentPaymentsTableBody');
                    if (!tbody) return;

                    if (!rows.length) {
                        tbody.innerHTML = '<tr><td colspan="7">No recent transactions found.</td></tr>';
                        return;
                    }

                    tbody.innerHTML = rows.map(item => {
                        const date = item.payment_date ? new Date(item.payment_date).toLocaleString() : '';
                        const amount = formatPeso(item.amount);
                        const method = item.payment_method || '';
                        const status = item.verification_status || '';
                        const payer = item.received_by_name || item.payer_name || item.payer || '';
                        const receipt = item.receipt_number || item.receipt_url || '';

                        return `
                            <tr>
                                <td>${receipt || ('#' + (item.payment_id || ''))}</td>
                                <td>${item.transaction_type || ''}</td>
                                <td>${amount}</td>
                                <td>${date}</td>
                                <td>${method}</td>
                                <td>${status}</td>
                                <td>${payer}</td>
                            </tr>
                        `;
                    }).join('');
                } catch (err) {
                    console.error('Failed to load recent payments:', err);
                }
            }

            // Load recent payments after the revenue charts render
            loadRecentPayments(8);
        } catch (error) {
            console.error('Failed to load revenue:', error);
        }
    }

    // ── Reservations helpers ──────────────────────────────────────────
    let _resPage = 1;
    const _resPerPage = 20;
    let _resFilters = {};
    let _resTotal = 0;

    function _formatResDate(raw) {
        if (!raw) return '—';
        const d = new Date(raw);
        if (isNaN(d)) return raw;
        return d.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' });
    }

    function _resStatusBadge(status) {
        const s = (status || 'Pending').trim();
        const key = s.toLowerCase();
        return `<span class="res-status-pill res-status-pill--${key}"><span class="res-status-pill__dot"></span>${s}</span>`;
    }

    async function _renderResTable() {
        const tbody = document.getElementById('reservationActionTableBody');
        const info  = document.getElementById('reservationPaginationInfo');
        const prevBtn = document.getElementById('reservationPrevPage');
        const nextBtn = document.getElementById('reservationNextPage');
        const titleEl = document.getElementById('reservationTableTitle');
        const badgeEl = document.getElementById('reservationTableBadge');
        if (!tbody) return;

        tbody.innerHTML = '<tr><td colspan="7" class="text-center">Loading…</td></tr>';

        const params = [`page=${_resPage}`, `per_page=${_resPerPage}`, `sort_desc=1`];
        if (_resFilters.status) params.push(`status=${encodeURIComponent(_resFilters.status)}`);
        if (_resFilters.year)   params.push(`year=${_resFilters.year}`);

        const result = await api.request(`schedules?${params.join('&')}`, { method: 'GET' });
        const rows   = Array.isArray(result?.data) ? result.data : (Array.isArray(result) ? result : []);
        _resTotal    = result?.meta?.total ?? rows.length;
        const pages  = result?.meta?.pages ?? Math.ceil(_resTotal / _resPerPage);

        const statusLabel = _resFilters.status || 'All';
        const yearLabel   = _resFilters.year   || 'All years';
        if (titleEl) titleEl.textContent = `${statusLabel} Reservations`;
        if (badgeEl) badgeEl.textContent  = `${_resTotal} total · ${yearLabel}`;

        if (rows.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7" class="text-center">No reservations found.</td></tr>';
        } else {
            tbody.innerHTML = rows.map(item => {
                const decedentName = item.first_name
                    ? `${item.first_name} ${item.last_name || ''}`.trim()
                    : (item.provisional_name || item.created_by_name || '—');
                return `
                    <tr>
                        <td><span class="res-col-id">#${item.schedule_id}</span></td>
                        <td><span class="res-col-lot">${item.lot_number || '—'}</span></td>
                        <td><span class="res-col-section">${item.section_name || '—'}</span></td>
                        <td><span class="res-col-name">${decedentName}</span></td>
                        <td><span class="res-col-date"><i class="far fa-calendar-alt"></i> ${_formatResDate(item.schedule_date)}</span></td>
                        <td><span class="res-col-type">${item.lot_type_name || 'Standard'}</span></td>
                        <td>${_resStatusBadge(item.status)}</td>
                    </tr>`;
            }).join('');
        }

        if (info) info.textContent = `Page ${_resPage} of ${pages || 1} · ${_resTotal} record${_resTotal !== 1 ? 's' : ''}`;
        if (prevBtn) prevBtn.disabled = _resPage <= 1;
        if (nextBtn) nextBtn.disabled = _resPage >= pages;
    }

    async function loadReservations(year) {
        // Step 1: Always render the table first — independent of chart creation
        _resPage = 1;
        await _renderResTable();

        // Step 2: Load stats and render charts (guarded separately so a chart failure
        //         doesn't prevent the table from displaying data)
        try {
            const statsYear = year || _resFilters.year || new Date().getFullYear();
            const data = await api.request(`schedules/stats?year=${statsYear}`, { method: 'GET' });

            const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.innerText = val ?? 0; };
            setVal('resTotal', data.total);
            setVal('resConfirmed', data.confirmed);
            setVal('resPending', data.pending);
            setVal('resCancelled', data.cancelled);

            const statusChartCanvas = document.getElementById('reservationStatusChart');
            const reservationsCanvas = document.getElementById('reservationsChart');
            const reservationInsights = document.getElementById('reservationInsights');

            const resDark      = isDarkMode();
            const resTickColor = resDark ? '#cbd5e1' : '#1e293b';

            if (statusChartCanvas) {
                statusChartCanvas.style.display = 'block';
                statusChartCanvas.style.width = '100%';
                statusChartCanvas.style.height = '280px';
                statusChartCanvas.height = 280;
                const statusChartCtx = statusChartCanvas.getContext('2d');
                if (reservationStatusChartInstance) reservationStatusChartInstance.destroy();
                const statusData = [
                    { label: 'Pending',   value: Number(data.pending   || 0), color: '#f59e0b' },
                    { label: 'Confirmed', value: Number(data.confirmed || 0), color: '#0f766e' },
                    { label: 'Completed', value: Number(data.completed || 0), color: '#2563eb' },
                    { label: 'Cancelled', value: Number(data.cancelled || 0), color: '#ef4444' }
                ];
                reservationStatusChartInstance = new Chart(statusChartCtx, {
                    type: 'doughnut',
                    data: {
                        labels: statusData.map(d => d.label),
                        datasets: [{
                            data: statusData.map(d => d.value),
                            backgroundColor: statusData.map(d => d.color),
                            borderColor: resDark ? '#09130e' : '#ffffff',
                            borderWidth: 2,
                            hoverOffset: 12
                        }]
                    },
                    options: compactChartOptions({
                        cutout: '58%',
                        plugins: {
                            legend: {
                                display: true,
                                position: 'bottom',
                                align: 'center',
                                labels: {
                                    usePointStyle: true,
                                    pointStyle: 'circle',
                                    boxWidth: 8,
                                    boxHeight: 8,
                                    padding: 12,
                                    font: { size: 11.5, weight: '700', family: "'Inter', sans-serif" },
                                    color: resTickColor
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const chart = context.chart;
                                        const dataset = context.dataset;
                                        const total = dataset.data.reduce((sum, val, idx) => {
                                            if (typeof chart.getDataVisibility === 'function' && !chart.getDataVisibility(idx)) return sum;
                                            return sum + (Number(val) || 0);
                                        }, 0);
                                        const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0.0';
                                        return ` ${context.label}: ${context.parsed} reservations (${pct}%)`;
                                    }
                                }
                            }
                        },
                        animation: doughnutPopAnimation(700, 120)
                    })
                });
            }

            if (reservationsCanvas) {
                const byMonth = data.by_month || [];
                const counts  = new Array(12).fill(0);
                byMonth.forEach(item => {
                    const idx = Number(item.month) - 1;
                    if (idx >= 0 && idx < 12) counts[idx] = Number(item.count) || 0;
                });
                reservationsCanvas.style.display = 'block';
                reservationsCanvas.style.width   = '100%';
                reservationsCanvas.style.height  = '280px';
                reservationsCanvas.height        = 280;
                const reservationsCtx = reservationsCanvas.getContext('2d');
                if (reservationsChartInstance) reservationsChartInstance.destroy();
                const resGrad = reservationsCtx.createLinearGradient(0, 0, 0, 280);
                resGrad.addColorStop(0, resDark ? 'rgba(45, 212, 191, 0.22)' : 'rgba(15, 118, 110, 0.18)');
                resGrad.addColorStop(0.6, resDark ? 'rgba(45, 212, 191, 0.08)' : 'rgba(15, 118, 110, 0.07)');
                resGrad.addColorStop(1, 'rgba(15, 118, 110, 0.01)');
                const resStroke     = resDark ? '#2dd4bf' : '#0f766e';
                const resAxisBorder = resDark ? 'rgba(255,255,255,0.24)' : 'rgba(44,94,71,0.35)';
                const resGrid       = resDark ? 'rgba(255,255,255,0.14)' : 'rgba(44,94,71,0.18)';
                reservationsChartInstance = new Chart(reservationsCtx, {
                    type: 'line',
                    data: {
                        labels: MONTH_NAMES,
                        datasets: [{
                            label: `Reservations ${statsYear}`,
                            data: counts,
                            borderColor: resStroke,
                            backgroundColor: resGrad,
                            borderWidth: 3,
                            pointRadius: 4,
                            pointHoverRadius: 6,
                            pointBackgroundColor: resStroke,
                            pointBorderColor: '#ffffff',
                            pointBorderWidth: 1.5,
                            tension: 0.38,
                            fill: true
                        }]
                    },
                    options: compactChartOptions({
                        layout: { padding: { top: 8, right: 12, bottom: 4, left: 8 } },
                        plugins: {
                            legend: {
                                display: true,
                                position: 'top',
                                align: 'end',
                                labels: {
                                    usePointStyle: true,
                                    pointStyle: 'circle',
                                    boxWidth: 8,
                                    boxHeight: 8,
                                    padding: 12,
                                    font: { size: 11.5, weight: '700', family: "'Inter', sans-serif" },
                                    color: resTickColor
                                }
                            },
                            tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} reservation${ctx.parsed.y !== 1 ? 's' : ''}` } }
                        },
                        animation: { duration: 900, easing: 'easeOutCubic' },
                        scales: {
                            x: {
                                ticks: { maxRotation: 0, autoSkip: false, font: { size: 11 }, color: resTickColor },
                                grid: { display: false },
                                border: { color: resAxisBorder }
                            },
                            y: {
                                beginAtZero: true,
                                ticks: { precision: 0, maxTicksLimit: 6, color: resTickColor },
                                grid: { color: resGrid, lineWidth: 1, borderDash: [4, 4] },
                                border: { color: resAxisBorder }
                            }
                        }
                    })
                });

                if (reservationInsights) {
                    const confirmationRate = Number(data.confirmation_rate || 0);
                    const cancellationRate = Number(data.cancellation_rate || 0);
                    const peakIdx = counts.indexOf(Math.max(...counts));
                    reservationInsights.innerHTML = [
                        { label: 'Confirmation rate',   value: `${confirmationRate}%`,          className: 'risk-low' },
                        { label: 'Cancellation rate',   value: `${cancellationRate}%`,          className: cancellationRate > 20 ? 'risk-high' : 'risk-moderate' },
                        { label: 'Pending follow-up',   value: `${data.pending || 0} items`,   className: data.pending > 0 ? 'risk-moderate' : '' },
                        { label: 'Completed',           value: `${data.completed || 0} done`,  className: 'risk-low' },
                        { label: 'Peak month',          value: peakIdx >= 0 ? MONTH_NAMES[peakIdx] : '—', className: '' }
                    ].map(item => `
                        <div class="insight-item ${item.className || ''}">
                            <span>${item.label}</span>
                            <strong>${item.value}</strong>
                        </div>
                    `).join('');
                }
            }
        } catch (error) {
            console.error('Failed to load reservation stats/charts:', error);
        }
    }

    async function loadDemographics() {
        // Step 1: Always fetch and render the age-group table + stat cards first
        let ageGroups = [
            { label: '0-17', value: 0 }, { label: '18-35', value: 0 },
            { label: '36-55', value: 0 }, { label: '56-75', value: 0 }, { label: '75+', value: 0 }
        ];
        let total = 0, burials = 0, cremations = 0;

        try {
            const data = await api.request('decedents/stats', { method: 'GET' });
            total      = Number(data.total      || 0);
            burials    = Number(data.burials    || 0);
            cremations = Number(data.cremations || 0);

            if (Array.isArray(data.age_groups) && data.age_groups.length) ageGroups = data.age_groups;

            const setV = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v ?? 0; };
            setV('demoTotal',      total);
            setV('demoBurials',    burials);
            setV('demoCremations', cremations);
            setV('demoAvgAge',     data.avg_age || 0);

            // Age group table
            const tableBody = document.getElementById('demographicsTableBody');
            if (tableBody) {
                const totalAgeCount = ageGroups.reduce((s, g) => s + Number(g.value || 0), 0);
                tableBody.innerHTML = ageGroups.map(group => {
                    const v     = Number(group.value || 0);
                    const share = totalAgeCount > 0 ? Math.round((v / totalAgeCount) * 100) : 0;
                    const prof  = v >= 25 ? 'High concentration' : v >= 10 ? 'Moderate' : v > 0 ? 'Low' : 'No data';
                    return `<tr>
                        <td>${group.label}</td>
                        <td><strong>${v}</strong></td>
                        <td>${share}%</td>
                        <td><span class="status-badge ${v >= 25 ? 'status-danger' : v >= 10 ? 'status-warning' : 'status-info'}">${prof}</span></td>
                    </tr>`;
                }).join('');
            }

            // Insights bar
            const burialMix    = total > 0 ? Math.round((burials    / total) * 100) : 0;
            const cremationMix = total > 0 ? Math.round((cremations / total) * 100) : 0;
            const dominant     = ageGroups.reduce((b, g) => Number(g.value || 0) > Number(b.value || 0) ? g : b, { label: 'N/A', value: 0 });
            const profileLabel = burialMix > cremationMix ? 'Burial-heavy' : cremationMix > burialMix ? 'Cremation-heavy' : 'Balanced';
            const insights     = document.getElementById('demographicsInsights');
            if (insights) {
                insights.innerHTML = [
                    { label: 'Total decedents',    value: total,                                                      className: '' },
                    { label: 'Dominant age group', value: dominant.label !== 'N/A' ? `${dominant.label} yrs` : '—',  className: '' },
                    { label: 'Service mix',        value: profileLabel,                                               className: 'risk-low' },
                    { label: 'Burial share',       value: `${burialMix}%`,                                           className: 'risk-low' },
                    { label: 'Cremation share',    value: `${cremationMix}%`,                                        className: cremationMix > burialMix ? 'risk-moderate' : '' },
                    { label: 'Needs attention',    value: `${data.needs_attention || 0} records`,                    className: (data.needs_attention || 0) > 0 ? 'risk-high' : '' }
                ].map(item => `
                    <div class="insight-item ${item.className || ''}">
                        <span>${item.label}</span>
                        <strong>${item.value}</strong>
                    </div>`).join('');
            }
        } catch (err) {
            console.error('Demographics stats error:', err);
        }

        // Step 2: Load recent decedents records table
        try {
            const recRes  = await api.request('decedents?per_page=15&page=1', { method: 'GET' });
            const recRows = Array.isArray(recRes?.data) ? recRes.data : (Array.isArray(recRes) ? recRes : []);
            const recBody = document.getElementById('recentDecedentsTableBody');
            if (recBody) {
                if (recRows.length === 0) {
                    recBody.innerHTML = '<tr><td colspan="5" class="text-center">No decedent records found.</td></tr>';
                } else {
                    recBody.innerHTML = recRows.map(item => {
                        const name = [item.first_name, item.last_name].filter(Boolean).join(' ') || item.full_name || '—';
                        const isCrem = item.is_cremated === 'yes' || item.is_cremated === 1 || item.is_cremated === '1' || item.is_cremated === true;
                        const type = isCrem ? '<span class="status-badge status-warning">Cremation</span>' : '<span class="status-badge status-info">Burial</span>';
                        const dod  = item.date_of_death ? new Date(item.date_of_death).toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
                        return `<tr>
                            <td><strong>${name}</strong></td>
                            <td>${item.age ?? '—'}</td>
                            <td>${type}</td>
                            <td>${item.section_name || '—'}</td>
                            <td>${dod}</td>
                        </tr>`;
                    }).join('');
                }
            }
        } catch (err) {
            console.error('Recent decedents error:', err);
            const recBody = document.getElementById('recentDecedentsTableBody');
            if (recBody) recBody.innerHTML = '<tr><td colspan="5" class="text-center">Could not load records.</td></tr>';
        }

        // Step 3: Render charts (guarded — chart failure won't block data display)
        try {
            const dark      = isDarkMode();
            const tickColor = dark ? '#cbd5e1' : '#1e293b';

            const demoCanvas = document.getElementById('demographicsChart');
            if (demoCanvas) {
                const demoCtx = demoCanvas.getContext('2d');
                if (demographicsChartInstance) demographicsChartInstance.destroy();
                demographicsChartInstance = new Chart(demoCtx, {
                    type: 'doughnut',
                    data: {
                        labels: ['Burials', 'Cremations'],
                        datasets: [{
                            data: [burials, cremations],
                            backgroundColor: ['#2c5e47', '#d4a373'],
                            borderColor: dark ? '#09130e' : '#ffffff',
                            borderWidth: 2,
                            hoverOffset: 12
                        }]
                    },
                    options: compactChartOptions({
                        cutout: '58%',
                        plugins: {
                            legend: {
                                display: true,
                                position: 'bottom',
                                align: 'center',
                                labels: {
                                    usePointStyle: true,
                                    pointStyle: 'circle',
                                    boxWidth: 8,
                                    boxHeight: 8,
                                    padding: 12,
                                    font: { size: 11.5, weight: '700', family: "'Inter', sans-serif" },
                                    color: tickColor
                                }
                            },
                            tooltip: {
                                callbacks: {
                                    label: (context) => {
                                        const chart = context.chart;
                                        const dataset = context.dataset;
                                        const total = dataset.data.reduce((sum, val, idx) => {
                                            if (typeof chart.getDataVisibility === 'function' && !chart.getDataVisibility(idx)) return sum;
                                            return sum + (Number(val) || 0);
                                        }, 0);
                                        const pct = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : '0.0';
                                        return ` ${context.label}: ${context.parsed} decedents (${pct}%)`;
                                    }
                                }
                            }
                        },
                        animation: doughnutPopAnimation(700, 120)
                    })
                });
            }

            const ageCanvas = document.getElementById('ageDistributionChart');
            if (ageCanvas) {
                ageCanvas.style.display = 'block'; ageCanvas.style.width = '100%'; ageCanvas.style.height = '280px'; ageCanvas.height = 280;
                const ageCtx = ageCanvas.getContext('2d');
                if (ageDistributionChartInstance) ageDistributionChartInstance.destroy();
                const axisB = dark ? 'rgba(255,255,255,0.24)' : 'rgba(44,94,71,0.35)';
                const gridC = dark ? 'rgba(255,255,255,0.14)' : 'rgba(44,94,71,0.18)';
                ageDistributionChartInstance = new Chart(ageCtx, {
                    type: 'bar',
                    data: {
                        labels: ageGroups.map(g => g.label),
                        datasets: [{ label: 'Decedents', data: ageGroups.map(g => Number(g.value || 0)), backgroundColor: ['#2c5e47', '#2563eb', '#d4a373', '#7aa77a', '#b5838d'], borderRadius: 8, maxBarThickness: 44 }]
                    },
                    options: compactChartOptions({
                        layout: { padding: { left: 8, right: 8, top: 4, bottom: 0 } },
                        plugins: {
                            legend: { display: true, position: 'top', align: 'end', labels: { usePointStyle: true, pointStyle: 'circle', boxWidth: 8, boxHeight: 8, padding: 10, font: { size: 11, weight: '700', family: "'Inter', sans-serif" }, color: tickColor } },
                            tooltip: { callbacks: { label: ctx => ` ${ctx.parsed.y} decedents` } }
                        },
                        animation: staggeredBarAnimation(800),
                        scales: {
                            y: { beginAtZero: true, ticks: { precision: 0, maxTicksLimit: 6, font: { size: 10.5 }, color: tickColor }, grid: { color: gridC, borderDash: [4, 4] }, border: { color: axisB } },
                            x: { ticks: { font: { size: 10.5 }, maxRotation: 0, color: tickColor }, grid: { display: false }, border: { color: axisB } }
                        }
                    })
                });
            }
        } catch (chartErr) {
            console.error('Demographics chart error:', chartErr);
        }
    }

    function formatDateInput(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return `${year}-${month}-${day}`;
    }

    function applyExpirationPreset() {
        const preset = document.getElementById('expirationPresetFilter')?.value || 'all';
        const fromInput = document.getElementById('expirationDateFrom');
        const toInput = document.getElementById('expirationDateTo');
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        if (preset === 'all') {
            fromInput.value = '';
            toInput.value = '';
            return;
        }

        if (preset === 'next30') {
            fromInput.value = formatDateInput(today);
            const future = new Date(today);
            future.setDate(today.getDate() + 30);
            toInput.value = formatDateInput(future);
            return;
        }

        if (preset === 'next90') {
            fromInput.value = formatDateInput(today);
            const future = new Date(today);
            future.setDate(today.getDate() + 90);
            toInput.value = formatDateInput(future);
            return;
        }

        if (preset === 'thisMonth') {
            const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
            const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);
            fromInput.value = formatDateInput(firstDay);
            toInput.value = formatDateInput(lastDay);
            return;
        }

        if (preset === 'pastDue') {
            fromInput.value = '';
            toInput.value = formatDateInput(today);
        }
    }

    async function loadExpiration() {
        const fromValue = document.getElementById('expirationDateFrom')?.value;
        const toValue   = document.getElementById('expirationDateTo')?.value;
        const pageSize  = 15;

        const params = new URLSearchParams();
        params.set('page',     '1');
        params.set('per_page', String(pageSize));
        if (fromValue) params.set('date_from', fromValue);
        if (toValue)   params.set('date_to',   toValue);

        try {
            const data = await api.request(`reports/expiration?${params.toString()}`, { method: 'GET' });
            const summary      = data.summary || {};
            const expiringRows = Array.isArray(data.expiring_soon?.data) ? data.expiring_soon.data : (Array.isArray(data.expiring_soon) ? data.expiring_soon : []);
            const expiredRows  = Array.isArray(data.expired?.data)       ? data.expired.data       : (Array.isArray(data.expired)       ? data.expired       : []);
            const expiringMeta = data.expiring_soon?.meta ?? { page: 1, total_pages: 1, total: expiringRows.length };
            const expiredMeta  = data.expired?.meta       ?? { page: 1, total_pages: 1, total: expiredRows.length  };

            // ── Stat cards ──
            const setV = (id, v) => { const el = document.getElementById(id); if (el) el.innerText = v ?? 0; };
            setV('expExpiring',     summary.expiring_soon  ?? 0);
            setV('expExpired',      summary.expired        ?? 0);
            setV('expRenewalDue',   summary.renewal_due    ?? 0);
            setV('expPendingReview',summary.pending_review ?? 0);

            // ── Helper: format expiration date + days-until ──
            function fmtExpRow(item, statusClass, label) {
                const end = item.end_date ? new Date(`${item.end_date}T00:00:00`) : null;
                const displayDate = end ? end.toLocaleDateString('en-PH', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
                const today = new Date(); today.setHours(0,0,0,0);
                const diff  = end ? Math.round((end - today) / 86400000) : null;
                const daysLabel = diff === null ? '—' : diff < 0 ? `${Math.abs(diff)}d overdue` : diff === 0 ? 'Today' : `in ${diff}d`;
                return `<tr>
                    <td><strong>${item.lot_number || '—'}</strong></td>
                    <td>${item.section_name || '—'}</td>
                    <td>${item.block_name   || '—'}</td>
                    <td>${displayDate}</td>
                    <td><span class="status-badge ${diff !== null && diff < 0 ? 'status-danger' : statusClass}">${label} · ${daysLabel}</span></td>
                </tr>`;
            }

            // ── Render tables first (always visible) ──
            function renderExpirationTable({ rows, containerId, statusClass, label, emptyText, pagination, meta }) {
                const safeRows   = Array.isArray(rows) ? rows : [];
                const totalCount = Number(meta.total ?? safeRows.length ?? 0);
                const perPage2   = Number(meta.per_page || pageSize || safeRows.length || 1);
                const totalPages = Math.max(1, Number(meta.total_pages || Math.ceil(totalCount / perPage2) || 1));
                const page       = Math.min(Math.max(Number(meta.page || pagination.page || 1), 1), totalPages);
                const table      = document.getElementById(containerId);
                if (!table) return;
                table.innerHTML  = safeRows.length === 0
                    ? `<tr><td colspan="5">${emptyText}</td></tr>`
                    : safeRows.map(item => fmtExpRow(item, statusClass, label)).join('');
                pagination.render({ page, total_pages: totalPages, total: totalCount, shown: safeRows.length });
            }

            const expiringPagination = createPagination({
                prevBtn:  document.getElementById('expiringPrevPage'),
                nextBtn:  document.getElementById('expiringNextPage'),
                infoEl:   document.getElementById('expiringPaginationInfo'),
                jumpForm: document.getElementById('expiringPaginationJumpForm'),
                jumpInput:document.getElementById('expiringPageJumpInput'),
                jumpBtn:  document.getElementById('expiringPageJumpBtn'),
                itemLabel: 'lot',
                onChange: async () => {
                    const pp = new URLSearchParams();
                    pp.set('page', String(expiringPagination.page));
                    pp.set('per_page', String(pageSize));
                    const cf = document.getElementById('expirationDateFrom')?.value;
                    const ct = document.getElementById('expirationDateTo')?.value;
                    if (cf) pp.set('date_from', cf);
                    if (ct) pp.set('date_to',   ct);
                    const res  = await api.request(`reports/expiration?${pp.toString()}`, { method: 'GET' });
                    const rows2 = Array.isArray(res.expiring_soon?.data) ? res.expiring_soon.data : [];
                    const meta2 = res.expiring_soon?.meta ?? { page: 1, total_pages: 1, total: rows2.length };
                    renderExpirationTable({ rows: rows2, containerId: 'expiringTableBody', statusClass: 'status-warning', label: 'Expiring', emptyText: 'No lots expiring soon.', pagination: expiringPagination, meta: meta2 });
                }
            });

            const expiredPagination = createPagination({
                prevBtn:  document.getElementById('expiredPrevPage'),
                nextBtn:  document.getElementById('expiredNextPage'),
                infoEl:   document.getElementById('expiredPaginationInfo'),
                jumpForm: document.getElementById('expiredPaginationJumpForm'),
                jumpInput:document.getElementById('expiredPageJumpInput'),
                jumpBtn:  document.getElementById('expiredPageJumpBtn'),
                itemLabel: 'lot',
                onChange: async () => {
                    const pp = new URLSearchParams();
                    pp.set('page', String(expiredPagination.page));
                    pp.set('per_page', String(pageSize));
                    const cf = document.getElementById('expirationDateFrom')?.value;
                    const ct = document.getElementById('expirationDateTo')?.value;
                    if (cf) pp.set('date_from', cf);
                    if (ct) pp.set('date_to',   ct);
                    const res  = await api.request(`reports/expiration?${pp.toString()}`, { method: 'GET' });
                    const rows2 = Array.isArray(res.expired?.data) ? res.expired.data : [];
                    const meta2 = res.expired?.meta ?? { page: 1, total_pages: 1, total: rows2.length };
                    renderExpirationTable({ rows: rows2, containerId: 'expiredTableBody', statusClass: 'status-danger', label: 'Expired', emptyText: 'No expired lots.', pagination: expiredPagination, meta: meta2 });
                }
            });

            renderExpirationTable({ rows: expiringRows, containerId: 'expiringTableBody', statusClass: 'status-warning', label: 'Expiring', emptyText: 'No lots expiring soon.', pagination: expiringPagination, meta: expiringMeta });
            renderExpirationTable({ rows: expiredRows,  containerId: 'expiredTableBody',  statusClass: 'status-danger',  label: 'Expired',  emptyText: 'No expired lots.',       pagination: expiredPagination,  meta: expiredMeta  });

            // ── Charts (guarded — failure won't break tables) ──
            try {
                buildExpirationStatusChart(document.getElementById('expirationStatusChart'), summary);
                buildExpirationTrendChart(document.getElementById('expirationTrendChart'), expiringRows);
            } catch (chartErr) {
                console.error('Expiration chart error:', chartErr);
            }

        } catch (error) {
            console.error('Failed to load expiration:', error);
            const expiringBody = document.getElementById('expiringTableBody');
            const expiredBody  = document.getElementById('expiredTableBody');
            if (expiringBody) expiringBody.innerHTML = '<tr><td colspan="5">Failed to load data.</td></tr>';
            if (expiredBody)  expiredBody.innerHTML  = '<tr><td colspan="5">Failed to load data.</td></tr>';
        }
    }

    document.getElementById('expirationPresetFilter')?.addEventListener('change', (event) => {
        if (event.target.value !== 'all') {
            applyExpirationPreset();
        }
    });

    document.getElementById('applyExpirationFilter')?.addEventListener('click', () => {
        const presetDropdown = document.getElementById('expirationPresetFilter');
        if (presetDropdown && presetDropdown.value !== 'all') {
            applyExpirationPreset();
        }
        loadExpiration();
    });

    document.getElementById('clearExpirationFilter')?.addEventListener('click', () => {
        const presetDropdown = document.getElementById('expirationPresetFilter');
        if (presetDropdown) presetDropdown.value = 'all';
        document.getElementById('expirationDateFrom').value = '';
        document.getElementById('expirationDateTo').value = '';
        loadExpiration();
    });

    document.getElementById('applyRevenueFilter').addEventListener('click', () => {
        loadRevenue();
    });

    document.getElementById('clearRevenueFilter').addEventListener('click', () => {
        const fromInput = document.getElementById('revDateFrom');
        const toInput = document.getElementById('revDateTo');
        fromInput.value = '';
        toInput.value = '';
        loadRevenue();
    });

    // Populate reservation year dropdown
    (function populateReservationYears() {
        const sel = document.getElementById('reservationYearFilter');
        if (!sel) return;
        const currentYear = new Date().getFullYear();
        sel.innerHTML = '<option value="">All years</option>';
        for (let y = currentYear; y >= currentYear - 10; y--) {
            const opt = document.createElement('option');
            opt.value = y;
            opt.textContent = y;
            if (y === currentYear) opt.selected = true;
            sel.appendChild(opt);
        }
    })();

    document.getElementById('applyReservationFilter')?.addEventListener('click', async () => {
        const year   = document.getElementById('reservationYearFilter')?.value || '';
        const status = document.getElementById('reservationStatusFilter')?.value || '';
        _resFilters  = { year, status };
        await loadReservations(year ? Number(year) : null);
    });

    document.getElementById('clearReservationFilter')?.addEventListener('click', async () => {
        const yearSel   = document.getElementById('reservationYearFilter');
        const statusSel = document.getElementById('reservationStatusFilter');
        if (yearSel)   yearSel.value   = new Date().getFullYear();
        if (statusSel) statusSel.value = '';
        _resFilters = {};
        await loadReservations();
    });

    document.getElementById('reservationPrevPage')?.addEventListener('click', async () => {
        if (_resPage > 1) { _resPage--; await _renderResTable(); }
    });

    document.getElementById('reservationNextPage')?.addEventListener('click', async () => {
        _resPage++;
        await _renderResTable();
    });


    function triggerFileDownload(url, filename) {
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
    }

    // #reportExportContainer holds all 5 tabs at once (inactive ones are
    // display:none, per .report-content in reports.css), so both exports
    // must scope to the active tab only:
    //  - html2canvas throws ("0 width or height") if it has to walk into a
    //    hidden tab's Chart.js canvas, since display:none collapses it to 0x0.
    //  - <table> elements only exist on the Expiration tab, so exporting the
    //    whole container silently returned Expiration data no matter which
    //    tab the user was actually looking at.
    function getActiveReportTab() {
        return document.querySelector('#reportExportContainer .report-content.active')
            || document.getElementById('reportExportContainer');
    }

    function getActiveStatsContainer() {
        return document.querySelector('.report-stats.active');
    }

    function getActiveTabLabel() {
        const btn = document.querySelector('.tab-btn.active');
        return btn ? btn.textContent.trim() : 'Report';
    }

    async function generatePdfExport() {
        const activeStats = getActiveStatsContainer();
        const activeTab = getActiveReportTab();
        const element = document.createElement('div');
        element.style.display = 'flex';
        element.style.flexDirection = 'column';
        element.style.gap = '18px';
        element.style.position = 'fixed';
        // Keep the cloned element inside the viewport so html2canvas can
        // reliably measure and render it. Use a high z-index and make it
        // non-interactive so users don't notice it while exporting.
        element.style.left = '50px';
        element.style.top = '0';
        element.style.zIndex = '99999';
        element.style.pointerEvents = 'none';
        // Constrain width to avoid charts expanding beyond the viewport.
        element.style.width = '800px';
        element.style.maxWidth = 'calc(100vw - 100px)';
        element.style.boxSizing = 'border-box';
        // Turn off transitions/animations while generating the export so
        // nothing keeps animating or expanding unexpectedly.
        element.style.transition = 'none';
        element.style.animation = 'none';
        element.style.overflow = 'hidden';
        element.style.background = '#ffffff';
        element.style.padding = '18px';
        if (activeStats) element.appendChild(activeStats.cloneNode(true));
        element.appendChild(activeTab.cloneNode(true));

        // Reduce the min-height of compact chart cards inside the cloned
        // content to avoid very tall placeholders that cause expansion.
        element.querySelectorAll('.chart-card--compact').forEach(card => {
            card.style.minHeight = '260px';
            card.style.overflow = 'hidden';
        });

        // Replace canvases in the cloned node with raster images. Prefer
        // Chart.js' `toBase64Image()` from stored instances when available,
        // fallback to the original canvas `toDataURL()`.
        element.querySelectorAll('canvas').forEach((canvas) => {
            try {
                const id = canvas.id;
                let dataUrl = null;
                // Map known occupancy chart ids to instances
                if (id === 'occupancyChart' && occupancyChartInstance) dataUrl = occupancyChartInstance.toBase64Image();
                else if (id === 'occupancyByBlockChart' && occupancyByBlockChartInstance) dataUrl = occupancyByBlockChartInstance.toBase64Image();
                else if (id === 'occupancyByTypeChart' && occupancyByTypeChartInstance) dataUrl = occupancyByTypeChartInstance.toBase64Image();
                else if (id === 'reservationsChart' && reservationsChartInstance) dataUrl = reservationsChartInstance.toBase64Image();
                else {
                    const source = document.getElementById(id);
                    if (source && typeof source.toDataURL === 'function') dataUrl = source.toDataURL('image/png');
                }
                if (!dataUrl) return;
                const image = document.createElement('img');
                image.src = dataUrl;
                image.style.display = 'block';
                image.style.width = '100%';
                image.style.maxWidth = '100%';
                image.style.height = 'auto';
                image.style.maxHeight = '300px';
                image.style.objectFit = 'contain';
                canvas.replaceWith(image);
            } catch (e) {
                // best-effort replacement — if it fails, leave canvas as-is
            }
        });
        document.body.appendChild(element);
        const filename = `Cemetery_Management_${getActiveTabLabel()}_Report_${new Date().toISOString().split('T')[0]}.pdf`;
        if (typeof html2pdf === 'undefined') {
            element.remove();
            window.print();
            return null;
        }
        const opt = {
            margin:       0.5,
            filename,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2 },
            jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
        };
        try {
            // Ensure any remaining canvases are replaced by images (fallback).
            element.querySelectorAll('canvas').forEach((canvas) => {
                try {
                    const id = canvas.id;
                    const source = document.getElementById(id);
                    if (source && typeof source.toDataURL === 'function') {
                        const image = document.createElement('img');
                        image.src = source.toDataURL('image/png');
                        image.style.display = 'block';
                        image.style.width = '100%';
                        image.style.maxWidth = '100%';
                        image.style.height = 'auto';
                        canvas.replaceWith(image);
                    }
                } catch (e) {}
            });

            // Ensure cloned element's images and tables are constrained to container
            element.querySelectorAll('img').forEach(img => {
                img.style.display = 'block';
                img.style.width = '100%';
                img.style.maxWidth = '100%';
                img.style.height = 'auto';
                img.style.maxHeight = '300px';
                img.style.objectFit = 'contain';
            });
            element.querySelectorAll('table').forEach(tbl => {
                tbl.style.width = '100%';
                tbl.style.tableLayout = 'fixed';
            });

            // Wait for all images inside the cloned element to finish loading
            // before passing to html2pdf so the generated PDF captures them.
            const images = Array.from(element.querySelectorAll('img'));
            await Promise.all(images.map(img => new Promise(resolve => {
                if (img.complete && img.naturalWidth !== 0) return resolve();
                img.onload = () => resolve();
                img.onerror = () => resolve();
            })));

            // Optional debug: if caller appended ?debug_reports=1 to the URL,
            // download the assembled HTML so you can inspect what html2pdf
            // receives (helps when PDFs are blank on some environments).
            try {
                const urlParams = new URLSearchParams(window.location.search);
                if (urlParams.get('debug_reports') === '1') {
                    const dbgBlob = new Blob([element.outerHTML], { type: 'text/html' });
                    const dbgUrl = URL.createObjectURL(dbgBlob);
                    triggerFileDownload(dbgUrl, `report_debug_${getActiveTabLabel()}.html`);
                }
            } catch (e) {}

            const blob = await html2pdf().set(opt).from(element).outputPdf('blob');
            const url = URL.createObjectURL(blob);
            triggerFileDownload(url, filename);
            return { url, filename };
        } finally {
            element.remove();
        }
    }

    // XLSX.utils has no html_to_sheet — that call always threw on every tab
    // except Expiration (the only one with a <table>). Build a plain
    // metric/value sheet from the visible .stat-card tiles instead.
    function buildStatSheet(container) {
        const rows = [['Metric', 'Value']];
        container.querySelectorAll('.stat-card').forEach(card => {
            const title = card.querySelector('.stat-title')?.textContent.trim();
            const value = card.querySelector('.stat-value')?.textContent.trim();
            if (title) rows.push([title, value || '']);
        });
        return XLSX.utils.aoa_to_sheet(rows);
    }

    function generateExcelExport() {
        const wb = XLSX.utils.book_new();
        const container = getActiveReportTab();

        const tables = container.querySelectorAll('table');
        if (tables.length > 0) {
            tables.forEach((tbl, idx) => {
                const cardTitle = tbl.closest('.chart-card')?.querySelector('.chart-card__title')?.textContent?.trim();
                const sheetName = (cardTitle ? cardTitle.replace(/[:\\/?*\[\]]/g, '').slice(0, 30) : `Data_${idx + 1}`);
                const ws = XLSX.utils.table_to_sheet(tbl);
                XLSX.utils.book_append_sheet(wb, ws, sheetName);
            });
        } else {
            const ws = buildStatSheet(getActiveStatsContainer() || container);
            XLSX.utils.book_append_sheet(wb, ws, "Report Summary");
        }
        const filename = `Cemetery_Management_${getActiveTabLabel()}_Report_${new Date().toISOString().split('T')[0]}.xlsx`;
        const wbout = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
        const blob = new Blob([wbout], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
        const url = URL.createObjectURL(blob);
        triggerFileDownload(url, filename);
        return { url, filename };
    }

    // Drives the .dl-toggle checkbox through Download -> (generating, ~3.9s
    // animation) -> Open/Saved. The 3900ms floor matches the CSS "installed"
    // delay in download-toggle.css so the button only flips once the file
    // is actually ready, even if generation resolves faster than the animation.
    //
    // `generation` guards against a stale in-flight run: reset() (called on
    // every tab switch) doesn't cancel a runGeneration() that's still
    // mid-flight from a previous click — e.g. switch tabs while the ~3.9s
    // animation wait from the last export is still ticking. Without this
    // guard, that stale run resolves later and force-sets state back to
    // 'ready' with a result reset() already nulled out, which makes the
    // *next* click on the new tab a silent no-op (preventDefault fires,
    // onOpen(null) does nothing — no error, no download).
        function setupDownloadToggle(id, { run, onOpen }) {
        const checkbox = document.getElementById(id);
        if (!checkbox) return { reset() {} };
        const MIN_ANIMATION_MS = 3900;
        let state = 'idle';
        let result = null;
        let generation = 0;

        async function runGeneration() {
            const myGeneration = ++generation;
            state = 'working';
            checkbox.disabled = true;
            const start = Date.now();
            let localResult;
            try {
                localResult = await run();
            } catch (error) {
                console.error('Export failed:', error);
                if (myGeneration === generation) {
                    checkbox.checked = false;
                    checkbox.disabled = false;
                    state = 'idle';
                    alert('Export failed. Please try again.');
                }
                return;
            }
            const remaining = MIN_ANIMATION_MS - (Date.now() - start);
            if (remaining > 0) await new Promise(r => setTimeout(r, remaining));
            if (myGeneration !== generation) return;
            result = localResult;
            checkbox.disabled = false;
            state = 'ready';
        }

        checkbox.addEventListener('click', (e) => {
            if (state === 'working') {
                e.preventDefault();
                return;
            }
            if (state === 'ready') {
                e.preventDefault();
                onOpen(result);
                return;
            }
            setTimeout(runGeneration, 0);
        });

        return {
            reset() {
                generation++;
                if (result?.url) URL.revokeObjectURL(result.url);
                result = null;
                state = 'idle';
                checkbox.checked = false;
                checkbox.disabled = false;
            }
        };
    }

    const pdfToggle = setupDownloadToggle('exportPdfBtn', {
        run: generatePdfExport,
        onOpen: (result) => { if (result?.url) window.open(result.url, '_blank'); }
    });

    const excelToggle = setupDownloadToggle('exportExcelBtn', {
        run: generateExcelExport,
        onOpen: (result) => { if (result) triggerFileDownload(result.url, result.filename); }
    });

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            pdfToggle.reset();
            excelToggle.reset();
        });
    });

    document.getElementById('revDateFrom').value = '';
    document.getElementById('revDateTo').value = '';

    showTab('occupancy');
    await loadOccupancy();
    await loadRevenue();
    await loadReservations();
    await loadDemographics();
    await loadExpiration();
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);

    document.getElementById('themeToggleBtn')?.addEventListener('click', () => {
        setTimeout(() => {
            const dark = isDarkMode();
            const tickColor = dark ? '#cbd5e1' : '#1e293b';
            const categoryTickColor = dark ? '#ffffff' : '#06170f';
            const gridColor = dark ? 'rgba(255, 255, 255, 0.14)' : 'rgba(44, 94, 71, 0.18)';
            const axisBorderColor = dark ? 'rgba(255, 255, 255, 0.24)' : 'rgba(44, 94, 71, 0.35)';

            const allCharts = [
                occupancyChartInstance,
                occupancyByBlockChartInstance,
                occupancyByTypeChartInstance,
                revenueMonthChart,
                revenueYearChart,
                revenueBreakdownChartInstance,
                verificationBreakdownChartInstance,
                revenueByMethodChartInstance,
                reservationsChartInstance,
                reservationStatusChartInstance,
                demographicsChartInstance,
                ageDistributionChartInstance,
                expirationStatusChartInstance,
                expirationTrendChartInstance
            ];
            allCharts.forEach(ch => {
                if (!ch) return;
                if (ch.options?.scales?.x) {
                    if (ch.options.scales.x.ticks) ch.options.scales.x.ticks.color = tickColor;
                    if (ch.options.scales.x.border) ch.options.scales.x.border.color = axisBorderColor;
                }
                if (ch.options?.scales?.y) {
                    if (ch.options.scales.y.ticks) ch.options.scales.y.ticks.color = tickColor;
                    if (ch.options.scales.y.grid) ch.options.scales.y.grid.color = gridColor;
                    if (ch.options.scales.y.border) ch.options.scales.y.border.color = axisBorderColor;
                }
                if (ch.options?.plugins?.legend?.labels) {
                    ch.options.plugins.legend.labels.color = tickColor;
                }
                if (ch.config?.type === 'doughnut' && ch.data?.datasets?.[0]) {
                    ch.data.datasets[0].borderColor = dark ? '#09130e' : '#ffffff';
                }
                ch.update('none');
            });
            if (occupancyChartInstance) {
                if (occupancyChartInstance.options?.scales?.x?.ticks) {
                    occupancyChartInstance.options.scales.x.ticks.color = categoryTickColor;
                }
                if (occupancyChartInstance.options?.scales?.y?.ticks) {
                    occupancyChartInstance.options.scales.y.ticks.color = tickColor;
                }
                occupancyChartInstance.update('none');
            }
            if (occupancyByTypeChartInstance) {
                if (occupancyByTypeChartInstance.options?.scales?.x?.ticks) {
                    occupancyByTypeChartInstance.options.scales.x.ticks.color = categoryTickColor;
                }
                if (occupancyByTypeChartInstance.options?.scales?.y?.ticks) {
                    occupancyByTypeChartInstance.options.scales.y.ticks.color = tickColor;
                }
                occupancyByTypeChartInstance.update('none');
            }
            if (occupancyByBlockChartInstance) {
                if (occupancyByBlockChartInstance.options?.scales?.y?.ticks) {
                    occupancyByBlockChartInstance.options.scales.y.ticks.color = categoryTickColor;
                }
                if (occupancyByBlockChartInstance.options?.scales?.x?.ticks) {
                    occupancyByBlockChartInstance.options.scales.x.ticks.color = tickColor;
                }
                if (occupancyByBlockChartInstance.options?.scales?.x?.grid) {
                    occupancyByBlockChartInstance.options.scales.x.grid.color = gridColor;
                }
                occupancyByBlockChartInstance.update('none');
            }
        }, 60);
    });
});

(function initFooter() {
    const yearEl = document.getElementById('footerYear');
    if (yearEl) yearEl.textContent = new Date().getFullYear();

    const timeEl = document.getElementById('footerLiveTime');
    const pulseEl = document.querySelector('.footer-pulse-ring');

    function stampFooterTime() {
        const now = new Date();
        const formatted = now.toLocaleString('en-PH', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
        if (timeEl) timeEl.textContent = formatted;
        if (pulseEl) pulseEl.style.display = 'block';
    }

    stampFooterTime();
    window.stampFooterTime = stampFooterTime;
})();
