document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    document.getElementById('logoutBtn').addEventListener('click', () => api.logout());

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
    // Occupancy chart instances (kept so exports can reliably render images)
    let occupancyChartInstance = null;
    let occupancyByBlockChartInstance = null;
    let occupancyByTypeChartInstance = null;
    let occupancyTrendChartInstance = null;

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
            if (!cls) return 'neutral';
            if (cls.includes('risk-low')) return 'low';
            if (cls.includes('risk-moderate')) return 'moderate';
            if (cls.includes('risk-high') || cls.includes('risk-critical')) return 'high';
            return 'neutral';
        };
        container.innerHTML = items.map(item => {
            const dot = mapDot(item.className || '');
            return `
            <div class="insight-item ${item.className || ''}">
                <span><i class="analysis-dot ${dot}"></i>${item.label}</span>
                <strong>${item.value}</strong>
            </div>
        `
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

    function compactChartOptions(extra = {}) {
        return {
            ...extra,
            responsive: true,
            maintainAspectRatio: false,
            layout: { padding: 4, ...(extra.layout || {}) },
            plugins: {
                legend: {
                    display: false,
                    labels: { boxWidth: 10, boxHeight: 10, font: { size: 11 } }
                },
                tooltip: {
                    titleFont: { size: 12 },
                    bodyFont: { size: 12 },
                    ...(extra.plugins?.tooltip || {})
                },
                ...(extra.plugins || {})
            },
            scales: {
                x: {
                    ticks: { maxRotation: 0, autoSkip: true, font: { size: 11 } },
                    grid: { display: false }
                },
                y: {
                    beginAtZero: true,
                    ticks: { precision: 0, font: { size: 11 } },
                    grid: { color: 'rgba(44, 94, 71, 0.10)' }
                },
                ...(extra.scales || {})
            }
        };
    }

    const donutSliceLabelPlugin = {
        id: 'donutSliceLabelPlugin',
        afterDatasetsDraw(chart, args, pluginOptions) {
            const meta = chart.getDatasetMeta(0);
            if (!meta || !meta.data || !meta.data.length) return;

            const ctx = chart.ctx;
            const dataset = chart.data.datasets[0];
            const total = dataset.data.reduce((sum, value) => sum + (Number(value) || 0), 0);
            if (!total) return;

            const centerX = chart.getDatasetMeta(0).data[0]?.x || chart.chartArea.left + (chart.chartArea.right - chart.chartArea.left) / 2;
            const centerY = chart.getDatasetMeta(0).data[0]?.y || chart.chartArea.top + (chart.chartArea.bottom - chart.chartArea.top) / 2;
            const leftLimit = chart.chartArea.left + 26;
            const rightLimit = chart.chartArea.right - 26;
            const topLimit = chart.chartArea.top + 12;
            const bottomLimit = chart.chartArea.bottom - 12;

            ctx.save();
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.font = '600 11px Inter, system-ui, sans-serif';

            meta.data.forEach((arc, index) => {
                const value = Number(dataset.data[index]) || 0;
                if (!value || total <= 0) return;

                const start = arc.startAngle;
                const end = arc.endAngle;
                const midAngle = (start + end) / 2;
                const outerRadius = arc.outerRadius;
                const innerRadius = arc.innerRadius;
                const ratio = value / total;

                const percent = `${Math.round(ratio * 100)}%`;
                const pctX = centerX + Math.cos(midAngle) * ((outerRadius + innerRadius) / 2);
                const pctY = centerY + Math.sin(midAngle) * ((outerRadius + innerRadius) / 2);

                ctx.fillStyle = '#1f2937';
                ctx.font = '700 12px Inter, system-ui, sans-serif';
                ctx.fillText(percent, pctX, pctY);

                const labelRadius = Math.min(outerRadius + 26, Math.max(outerRadius + 12, 76));
                let labelX = centerX + Math.cos(midAngle) * labelRadius;
                let labelY = centerY + Math.sin(midAngle) * labelRadius;
                labelX = Math.min(Math.max(labelX, leftLimit), rightLimit);
                labelY = Math.min(Math.max(labelY, topLimit), bottomLimit);
                const labelText = chart.data.labels[index] || '';
                const labelTextWidth = ctx.measureText(labelText).width;

                ctx.font = '500 11px Inter, system-ui, sans-serif';
                ctx.fillStyle = '#475569';
                ctx.textAlign = labelX > centerX ? 'left' : 'right';
                ctx.fillText(labelText, labelX, labelY);

                if (labelTextWidth > 0) {
                    const connectorX = labelX > centerX ? labelX - 6 : labelX + 6;
                    ctx.beginPath();
                    ctx.moveTo(connectorX, labelY);
                    ctx.lineTo(centerX + Math.cos(midAngle) * (outerRadius + 2), centerY + Math.sin(midAngle) * (outerRadius + 2));
                    ctx.strokeStyle = 'rgba(71, 85, 105, 0.45)';
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
        const grad = ctx.createLinearGradient(0, 0, 0, canvas.height || 320);
        grad.addColorStop(0, 'rgba(15, 118, 110, 0.16)');
        grad.addColorStop(0.6, 'rgba(15, 118, 110, 0.08)');
        grad.addColorStop(1, 'rgba(15, 118, 110, 0.02)');

        const instance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [{
                    label,
                    data: values,
                    borderColor: gradientColor,
                    backgroundColor: grad,
                    borderWidth: 3,
                    pointRadius: 4,
                    pointHoverRadius: 5,
                    pointBackgroundColor: gradientColor,
                    pointBorderColor: '#ffffff',
                    pointBorderWidth: 1.5,
                    tension: 0.38,
                    fill: true
                }]
            },
            options: compactChartOptions({
                plugins: {
                    legend: { display: false },
                    tooltip: { callbacks: { label: ctx => formatPeso(ctx.parsed.y) } }
                },
                animation: {
                    duration: 900,
                    easing: 'easeOutCubic'
                },
                scales: {
                    x: {
                        ticks: { maxRotation: 0, autoSkip: false, font: { size: 11 } },
                        grid: { display: false }
                    },
                    y: {
                        beginAtZero: true,
                        ticks: { callback: formatPesoCompact, maxTicksLimit: 6 }
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

        expirationStatusChartInstance = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels,
                datasets: [{
                    data: values,
                    backgroundColor: colors,
                    borderColor: '#ffffff',
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
                            padding: 10,
                            font: { size: 10.5 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: (context) => `${context.label}: ${context.parsed} lots`
                        }
                    }
                }
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

    function updateOccupancyAnalysis(data, trend) {
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
            { label: 'Most available section', value: mostAvailableSection ? `${mostAvailableSection.section_name} (${numberValue(mostAvailableSection.available)} lots)` : 'No data' },
            { label: 'Reserved lots', value: `${reserved} lots`, className: 'risk-moderate' },
            { label: 'Current risk level', value: occupancyRisk(currentRate).label, className: occupancyRisk(currentRate).className },
        ]);

        renderInsightList('lotTypeInsights', [
            { label: 'Most used lot type', value: highestLotType ? `${highestLotType.type_name} (${numberValue(highestLotType.occupied)} used)` : 'No data' },
            { label: 'Most reserved lot type', value: mostReservedType ? `${mostReservedType.type_name} (${numberValue(mostReservedType.reserved)} reserved)` : 'No data' },
            { label: 'Best remaining inventory', value: mostAvailableType ? `${mostAvailableType.type_name} (${numberValue(mostAvailableType.available)} open)` : 'No data' },
        ]);

        renderInsightList('blockInsights', [
            { label: 'Tightest block', value: tightestBlock ? `${tightestBlock.block_name}, ${tightestBlock.section_name} (${percentValue(tightestBlock.occupied, tightestBlock.total)}%)` : 'No data' },
            { label: 'Most reserved block', value: tightestReservedBlock ? `${tightestReservedBlock.block_name}, ${tightestReservedBlock.section_name} (${numberValue(tightestReservedBlock.reserved)} reserved)` : 'No data' },
            { label: 'Best relief block', value: openBlock ? `${openBlock.block_name}, ${openBlock.section_name} (${numberValue(openBlock.available)} open)` : 'No data' },
        ]);

        const sortedTrend = [...(trend || [])].sort((a, b) => new Date(a.snapshot_date) - new Date(b.snapshot_date));
        const first = sortedTrend[0];
        const latest = sortedTrend[sortedTrend.length - 1];
        const averageGrowth = first && latest && sortedTrend.length > 1
            ? (numberValue(latest.occupied) - numberValue(first.occupied)) / Math.max(1, sortedTrend.length - 1)
            : 0;
        const periodsToFull = averageGrowth > 0 ? Math.ceil(available / averageGrowth) : null;
        const projected12 = Math.min(total, Math.round(occupied + (averageGrowth * 12)));

        renderForecast([
            {
                label: 'Next 12 snapshots',
                value: total ? `${projected12}/${total}` : 'No data',
                note: `${percentValue(projected12, total)}% occupied`
            },
            {
                label: 'Capacity horizon',
                value: periodsToFull ? `${periodsToFull} snapshots` : 'Stable',
                note: averageGrowth > 0 ? `Avg. +${averageGrowth.toFixed(1)} occupied per snapshot` : 'No positive growth trend yet',
                className: periodsToFull && periodsToFull <= 12 ? 'risk-high' : ''
            }
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
            // Enforce fixed canvas height to prevent layout expansion
            occCanvas.style.display = 'block';
            occCanvas.style.width = '100%';
            occCanvas.style.height = '205px';
            occCanvas.height = 205;
            const ctx = occCanvas.getContext('2d');
            const labels = (data.by_section || []).map(item => item.section_name);
            if (occupancyChartInstance) occupancyChartInstance.destroy();
            // create vertical gradients for bar datasets to match revenue styling
            const availGrad = ctx.createLinearGradient(0, 0, 0, occCanvas.height || 205);
            availGrad.addColorStop(0, 'rgba(15,118,110,0.95)');
            availGrad.addColorStop(1, 'rgba(15,118,110,0.65)');
            const occGrad = ctx.createLinearGradient(0, 0, 0, occCanvas.height || 205);
            occGrad.addColorStop(0, 'rgba(185,28,28,0.95)');
            occGrad.addColorStop(1, 'rgba(185,28,28,0.65)');
            const resGrad = ctx.createLinearGradient(0, 0, 0, occCanvas.height || 205);
            resGrad.addColorStop(0, 'rgba(180,83,9,0.95)');
            resGrad.addColorStop(1, 'rgba(180,83,9,0.65)');

            occupancyChartInstance = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels,
                    datasets: [
                        { label: 'Available', data: (data.by_section || []).map(item => item.available || 0), backgroundColor: availGrad, borderRadius: 8, maxBarThickness: 40 },
                        { label: 'Occupied', data: (data.by_section || []).map(item => item.occupied || 0), backgroundColor: occGrad, borderRadius: 8, maxBarThickness: 40 },
                        { label: 'Reserved Space', data: sectionReservedSeries, backgroundColor: resGrad, borderRadius: 8, maxBarThickness: 40 },
                    ]
                },
                options: compactChartOptions({
                    plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}` } } },
                    scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } },
                    animations: staggeredBarAnimation(900)
                })
            });

            const blockCanvas = document.getElementById('occupancyByBlockChart');
            blockCanvas.style.display = 'block';
            blockCanvas.style.width = '100%';
            blockCanvas.style.height = '240px';
            blockCanvas.height = 240;
            const blockCtx = blockCanvas.getContext('2d');
            if (occupancyByBlockChartInstance) occupancyByBlockChartInstance.destroy();
            // horizontal gradients for better visual on horizontal bars
            const blockAvailGrad = blockCtx.createLinearGradient(0, 0, blockCanvas.width || 600, 0);
            blockAvailGrad.addColorStop(0, 'rgba(15,118,110,0.95)');
            blockAvailGrad.addColorStop(1, 'rgba(15,118,110,0.65)');
            const blockOccGrad = blockCtx.createLinearGradient(0, 0, blockCanvas.width || 600, 0);
            blockOccGrad.addColorStop(0, 'rgba(185,28,28,0.95)');
            blockOccGrad.addColorStop(1, 'rgba(185,28,28,0.65)');
            const blockResGrad = blockCtx.createLinearGradient(0, 0, blockCanvas.width || 600, 0);
            blockResGrad.addColorStop(0, 'rgba(180,83,9,0.95)');
            blockResGrad.addColorStop(1, 'rgba(180,83,9,0.65)');

            occupancyByBlockChartInstance = new Chart(blockCtx, {
                type: 'bar',
                data: {
                    labels: (data.by_block || []).map(item => `${item.block_name} (${item.section_name})`),
                    datasets: [
                        { label: 'Available', data: (data.by_block || []).map(item => item.available || 0), backgroundColor: blockAvailGrad, borderRadius: 8, maxBarThickness: 48 },
                        { label: 'Occupied', data: (data.by_block || []).map(item => item.occupied || 0), backgroundColor: blockOccGrad, borderRadius: 8, maxBarThickness: 48 },
                        { label: 'Reserved Space', data: blockReservedSeries, backgroundColor: blockResGrad, borderRadius: 8, maxBarThickness: 48 },
                    ]
                },
                options: compactChartOptions({
                    indexAxis: 'y',
                    plugins: {
                        legend: { display: true, position: 'bottom' },
                        tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.x}` } }
                    },
                    scales: { x: { stacked: true, beginAtZero: true, ticks: { precision: 0 } }, y: { stacked: true } },
                    animations: staggeredBarAnimation(850, 'x')
                })
            });

            const typeCanvas = document.getElementById('occupancyByTypeChart');
            typeCanvas.style.display = 'block';
            typeCanvas.style.width = '100%';
            typeCanvas.style.height = '205px';
            typeCanvas.height = 205;
            const typeCtx = typeCanvas.getContext('2d');
            if (occupancyByTypeChartInstance) occupancyByTypeChartInstance.destroy();
            const typeAvailGrad = typeCtx.createLinearGradient(0, 0, 0, typeCanvas.height || 205);
            typeAvailGrad.addColorStop(0, 'rgba(15,118,110,0.95)');
            typeAvailGrad.addColorStop(1, 'rgba(15,118,110,0.65)');
            const typeOccGrad = typeCtx.createLinearGradient(0, 0, 0, typeCanvas.height || 205);
            typeOccGrad.addColorStop(0, 'rgba(185,28,28,0.95)');
            typeOccGrad.addColorStop(1, 'rgba(185,28,28,0.65)');
            const typeResGrad = typeCtx.createLinearGradient(0, 0, 0, typeCanvas.height || 205);
            typeResGrad.addColorStop(0, 'rgba(180,83,9,0.95)');
            typeResGrad.addColorStop(1, 'rgba(180,83,9,0.65)');

            occupancyByTypeChartInstance = new Chart(typeCtx, {
                type: 'bar',
                data: {
                    labels: (data.by_lot_type || []).map(item => item.type_name),
                    datasets: [
                        { label: 'Available', data: (data.by_lot_type || []).map(item => item.available || 0), backgroundColor: typeAvailGrad, borderRadius: 8, maxBarThickness: 40 },
                        { label: 'Occupied', data: (data.by_lot_type || []).map(item => item.occupied || 0), backgroundColor: typeOccGrad, borderRadius: 8, maxBarThickness: 40 },
                        { label: 'Reserved Space', data: lotTypeReservedSeries, backgroundColor: typeResGrad, borderRadius: 8, maxBarThickness: 40 },
                    ]
                },
                options: compactChartOptions({ plugins: { legend: { display: true, position: 'bottom' }, tooltip: { callbacks: { label: ctx => `${ctx.dataset.label}: ${ctx.parsed.y}` } } }, scales: { x: { stacked: true }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 } } }, animations: staggeredBarAnimation(900) })
            });

            const trend = await api.request('reports/occupancy-trend?months=12', { method: 'GET' });
            const trendItems = Array.isArray(trend) ? trend : [];
            const trendNote = document.getElementById('occupancyTrendNote');
            if (trendNote) {
                trendNote.textContent = trendItems.length < 2
                    ? 'History is captured automatically each time this page is viewed — check back over the coming weeks to see a trend build up.'
                    : '';
            }
            const trendCanvas = document.getElementById('occupancyTrendChart');
            trendCanvas.style.display = 'block';
            trendCanvas.style.width = '100%';
            trendCanvas.style.height = '320px';
            trendCanvas.height = 320;
            const trendCtx = trendCanvas.getContext('2d');
            if (occupancyTrendChartInstance) occupancyTrendChartInstance.destroy();

            const monthDataMap = new Map();
            trendItems.forEach(item => {
                const rawMonth = String(item.month_start || item.snapshot_date || '').trim();
                if (!rawMonth) return;
                const monthKey = rawMonth.length >= 7 ? rawMonth.slice(0, 7) : rawMonth;
                monthDataMap.set(monthKey, Number(item.occupied || 0));
            });

            const monthSeries = [];
            const currentMonthDate = new Date();
            currentMonthDate.setDate(1);
            currentMonthDate.setHours(0, 0, 0, 0);
            for (let offset = 11; offset >= 0; offset -= 1) {
                const monthDate = new Date(currentMonthDate.getFullYear(), currentMonthDate.getMonth() - offset, 1);
                const year = monthDate.getFullYear();
                const month = String(monthDate.getMonth() + 1).padStart(2, '0');
                const monthKey = `${year}-${month}`;
                monthSeries.push({
                    label: monthDate.toLocaleDateString('en-US', { month: 'short' }),
                    value: monthDataMap.get(monthKey) ?? 0,
                    key: monthKey
                });
            }

            const normalizedTrend = monthSeries.map(item => ({
                ...item,
                label: item.label,
                value: Number(item.value || 0)
            }));
            const trendValues = normalizedTrend.map(item => item.value);
            const trendGrad = trendCtx.createLinearGradient(0, 0, 0, trendCanvas.height || 320);
            trendGrad.addColorStop(0, 'rgba(15, 118, 110, 0.16)');
            trendGrad.addColorStop(0.6, 'rgba(15, 118, 110, 0.08)');
            trendGrad.addColorStop(1, 'rgba(15, 118, 110, 0.02)');
            occupancyTrendChartInstance = new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: normalizedTrend.map(item => item.label),
                    datasets: [{
                        label: 'Occupied Lots',
                        data: trendValues,
                        borderColor: '#0f766e',
                        backgroundColor: trendGrad,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#0f766e',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 1.5,
                        tension: 0.38,
                        fill: true
                    }]
                },
                options: compactChartOptions({
                    layout: { padding: { top: 8, right: 12, bottom: 4, left: 8 } },
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} occupied lots` } }
                    },
                    animation: {
                        duration: 900,
                        easing: 'easeOutCubic'
                    },
                    scales: {
                        x: {
                            title: { display: true, text: 'Month', color: '#2c5e47', font: { size: 12, weight: '600' }, padding: { top: 6 } },
                            ticks: {
                                maxRotation: 0,
                                minRotation: 0,
                                autoSkip: true,
                                maxTicksLimit: 12,
                                font: { size: 10.5 }
                            },
                            grid: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'Occupied Lots', color: '#2c5e47', font: { size: 12, weight: '600' }, padding: { bottom: 6 } },
                            ticks: { precision: 0, maxTicksLimit: 6, callback: value => `${value} lots` }
                        }
                    }
                })
            });
            updateOccupancyAnalysis(data, trendItems);
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
            // map labels to color palette for stable coloring across loads
            const palette = CHART_COLORS.accent;
            const breakdownColors = labels.map((l, idx) => palette[idx % palette.length]);
            const breakdownCanvas = document.getElementById('revenueBreakdownChart');
            breakdownCanvas.style.display = 'block';
            breakdownCanvas.style.width = '100%';
            breakdownCanvas.style.height = '220px';
            breakdownCanvas.height = 220;
            const breakdownCtx = breakdownCanvas.getContext('2d');
            if (revenueBreakdownChartInstance) revenueBreakdownChartInstance.destroy();
            revenueBreakdownChartInstance = new Chart(breakdownCtx, {
                type: 'doughnut',
                data: { labels, datasets: [{ data: values, backgroundColor: breakdownColors, borderColor: '#ffffff', borderWidth: 2, hoverOffset: 8 }] },
                options: compactChartOptions({
                    cutout: '58%',
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatPeso(ctx.parsed)}` } }
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
            verificationCanvas.style.height = '220px';
            verificationCanvas.height = 220;
            const verificationCtx = verificationCanvas.getContext('2d');
            if (verificationBreakdownChartInstance) verificationBreakdownChartInstance.destroy();
            const vLabels = verificationBreakdown.map(item => item.verification_status);
            const vValues = verificationBreakdown.map(item => item.total || 0);
            const vColors = vLabels.map(l => CHART_COLORS.verification[l] || CHART_COLORS.accent[0]);
            verificationBreakdownChartInstance = new Chart(verificationCtx, {
                type: 'doughnut',
                data: {
                    labels: vLabels,
                    datasets: [{ data: vValues, backgroundColor: vColors, borderColor: '#ffffff', borderWidth: 2, hoverOffset: 8 }]
                },
                options: compactChartOptions({
                    cutout: '58%',
                    plugins: {
                        legend: {
                            display: false
                        },
                        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${formatPeso(ctx.parsed)}` } }
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
            revenueByMethodChartInstance = new Chart(methodCtx, {
                type: 'bar',
                data: {
                    labels: methodLabels,
                    datasets: [{
                        label: 'Revenue',
                        data: methodValues,
                        backgroundColor: methodColors,
                        borderRadius: 8,
                        maxBarThickness: 64
                    }]
                },
                options: compactChartOptions({ animations: staggeredBarAnimation(), plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => formatPeso(ctx.parsed.y) } } }, scales: { y: { beginAtZero: true, ticks: { callback: formatPesoCompact, maxTicksLimit: 6 } } } })
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

    async function loadReservations() {
        try {
            const data = await api.request(`schedules/stats?year=${new Date().getFullYear()}`, { method: 'GET' });
            const pendingResult = await api.request('schedules?status=Pending&per_page=8', { method: 'GET' });
            const pendingRows = Array.isArray(pendingResult?.data) ? pendingResult.data : (Array.isArray(pendingResult) ? pendingResult : []);
            const setVal = (id, val) => {
                const el = document.getElementById(id);
                if (el) el.innerText = val ?? 0;
            };
            setVal('resTotal', data.total);
            setVal('resConfirmed', data.confirmed);
            setVal('resPending', data.pending);
            setVal('resCancelled', data.cancelled);

            const statusChartCanvas = document.getElementById('reservationStatusChart');
            const reservationsCanvas = document.getElementById('reservationsChart');
            const reservationInsights = document.getElementById('reservationInsights');
            if (!statusChartCanvas || !reservationsCanvas || !reservationInsights) {
                return;
            }
            statusChartCanvas.style.display = 'block';
            statusChartCanvas.style.width = '100%';
            statusChartCanvas.style.height = '280px';
            statusChartCanvas.height = 280;
            const statusChartCtx = statusChartCanvas.getContext('2d');
            const statusData = [
                { label: 'Pending', value: Number(data.pending || 0), color: '#f59e0b' },
                { label: 'Confirmed', value: Number(data.confirmed || 0), color: '#0f766e' },
                { label: 'Completed', value: Number(data.completed || 0), color: '#2563eb' },
                { label: 'Cancelled', value: Number(data.cancelled || 0), color: '#ef4444' }
            ];
            new Chart(statusChartCtx, {
                type: 'doughnut',
                data: {
                    labels: statusData.map(item => item.label),
                    datasets: [{
                        data: statusData.map(item => item.value),
                        backgroundColor: statusData.map(item => item.color),
                        borderColor: '#ffffff',
                        borderWidth: 2,
                        hoverOffset: 8
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
                                padding: 10,
                                font: { size: 10.5 }
                            }
                        },
                        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed} reservations` } }
                    },
                    animation: doughnutPopAnimation(700, 120)
                })
            });

            const byMonth = data.by_month || [];
            const counts = new Array(12).fill(0);
            byMonth.forEach(item => {
                const idx = Number(item.month) - 1;
                if (idx >= 0 && idx < 12) counts[idx] = Number(item.count) || 0;
            });

            reservationsCanvas.style.display = 'block';
            reservationsCanvas.style.width = '100%';
            reservationsCanvas.style.height = '280px';
            reservationsCanvas.height = 280;
            const reservationsCtx = reservationsCanvas.getContext('2d');
            if (reservationsChartInstance) reservationsChartInstance.destroy();
            const resGrad = reservationsCtx.createLinearGradient(0, 0, 0, reservationsCanvas.height || 280);
            resGrad.addColorStop(0, 'rgba(15, 118, 110, 0.16)');
            resGrad.addColorStop(0.6, 'rgba(15, 118, 110, 0.08)');
            resGrad.addColorStop(1, 'rgba(15, 118, 110, 0.02)');

            reservationsChartInstance = new Chart(reservationsCtx, {
                type: 'line',
                data: {
                    labels: MONTH_NAMES,
                    datasets: [{
                        label: 'Reservations',
                        data: counts,
                        borderColor: '#0f766e',
                        backgroundColor: resGrad,
                        borderWidth: 3,
                        pointRadius: 4,
                        pointHoverRadius: 5,
                        pointBackgroundColor: '#0f766e',
                        pointBorderColor: '#ffffff',
                        pointBorderWidth: 1.5,
                        tension: 0.38,
                        fill: true
                    }]
                },
                options: compactChartOptions({
                    layout: { padding: { top: 8, right: 12, bottom: 4, left: 8 } },
                    plugins: {
                        legend: { display: false },
                        tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} reservations` } }
                    },
                    animation: { duration: 900, easing: 'easeOutCubic' },
                    scales: {
                        x: {
                            title: { display: true, text: 'Month', color: '#2c5e47', font: { size: 12, weight: '600' }, padding: { top: 6 } },
                            ticks: { maxRotation: 0, autoSkip: false, font: { size: 11 } },
                            grid: { display: false }
                        },
                        y: {
                            beginAtZero: true,
                            title: { display: true, text: 'Reservations', color: '#2c5e47', font: { size: 12, weight: '600' }, padding: { bottom: 6 } },
                            ticks: { precision: 0, maxTicksLimit: 6 }
                        }
                    }
                })
            });

            const pendingTableBody = document.getElementById('reservationActionTableBody');
            if (pendingTableBody) {
                const rows = [...pendingRows].sort((a, b) => new Date(a.schedule_date) - new Date(b.schedule_date));
                pendingTableBody.innerHTML = rows.length
                    ? rows.slice(0, 8).map(item => {
                        const date = new Date(item.schedule_date);
                        const today = new Date();
                        const daysPending = Math.max(0, Math.ceil((today - date) / 86400000));
                        const badgeClass = item.status === 'Confirmed' ? 'status-success' : item.status === 'Completed' ? 'status-info' : 'status-warning';
                        return `
                            <tr>
                                <td>#${item.schedule_id}</td>
                                <td>${item.lot_number || '—'}</td>
                                <td>${(item.first_name || item.created_by_name || 'Unknown') + ' ' + (item.last_name || '')}</td>
                                <td>${item.schedule_date || '—'}</td>
                                <td>${daysPending}d</td>
                                <td><span class="status-badge ${badgeClass}">${item.status || 'Pending'}</span></td>
                            </tr>
                        `;
                    }).join('')
                    : '<tr><td colspan="6">No pending reservations found.</td></tr>';
            }

            const confirmationRate = Number(data.confirmation_rate || 0);
            const cancellationRate = Number(data.cancellation_rate || 0);
            reservationInsights.innerHTML = [
                { label: 'Confirmation rate', value: `${confirmationRate}%`, className: 'risk-low' },
                { label: 'Cancellation rate', value: `${cancellationRate}%`, className: 'risk-moderate' },
                { label: 'Pending follow-up', value: `${data.pending || 0} items`, className: 'risk-moderate' },
                { label: 'Month peak', value: counts.indexOf(Math.max(...counts)) >= 0 ? MONTH_NAMES[counts.indexOf(Math.max(...counts))] : '—', className: '' }
            ].map(item => `
                <div class="insight-item ${item.className || ''}">
                    <span>${item.label}</span>
                    <strong>${item.value}</strong>
                </div>
            `).join('');
        } catch (error) {
            console.error('Failed to load reservations:', error);
        }
    }

    async function loadDemographics() {
        try {
            const data = await api.request('decedents/stats', { method: 'GET' });
            const total = Number(data.total || 0);
            const burials = Number(data.burials || 0);
            const cremations = Number(data.cremations || 0);
            const ageGroups = Array.isArray(data.age_groups) && data.age_groups.length ? data.age_groups : [
                { label: '0-17', value: 0 },
                { label: '18-35', value: 0 },
                { label: '36-55', value: 0 },
                { label: '56-75', value: 0 },
                { label: '75+', value: 0 }
            ];

            document.getElementById('demoTotal').innerText = total;
            document.getElementById('demoBurials').innerText = burials;
            document.getElementById('demoCremations').innerText = cremations;
            document.getElementById('demoAvgAge').innerText = data.avg_age || 0;

            const demoCtx = document.getElementById('demographicsChart').getContext('2d');
            if (demographicsChartInstance) demographicsChartInstance.destroy();
            demographicsChartInstance = new Chart(demoCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Burials', 'Cremations'],
                    datasets: [{
                        data: [burials, cremations],
                        backgroundColor: ['#2c5e47', '#d4a373'],
                        borderColor: '#ffffff',
                        borderWidth: 2,
                        hoverOffset: 10,
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
                                padding: 10,
                                font: { size: 10.5 }
                            }
                        },
                        tooltip: { callbacks: { label: ctx => `${ctx.label}: ${ctx.parsed} decedents` } }
                    },
                    animation: doughnutPopAnimation(700, 120)
                })
            });

            const ageCanvas = document.getElementById('ageDistributionChart');
            ageCanvas.style.display = 'block';
            ageCanvas.style.width = '100%';
            ageCanvas.style.height = '280px';
            ageCanvas.height = 280;
            const ageCtx = ageCanvas.getContext('2d');
            if (ageDistributionChartInstance) ageDistributionChartInstance.destroy();
            ageDistributionChartInstance = new Chart(ageCtx, {
                type: 'bar',
                data: {
                    labels: ageGroups.map(group => group.label),
                    datasets: [{
                        label: 'Decedents',
                        data: ageGroups.map(group => Number(group.value || 0)),
                        backgroundColor: ['#2c5e47', '#2563eb', '#d4a373', '#7aa77a', '#b5838d'],
                        borderRadius: 8,
                        maxBarThickness: 44
                    }]
                },
                options: compactChartOptions({
                    layout: { padding: { left: 8, right: 8, top: 4, bottom: 0 } },
                    plugins: { legend: { display: false }, tooltip: { callbacks: { label: ctx => `${ctx.parsed.y} decedents` } } },
                    animation: staggeredBarAnimation(800),
                    scales: {
                        y: {
                            beginAtZero: true,
                            ticks: { precision: 0, maxTicksLimit: 6, font: { size: 10.5 } }
                        },
                        x: {
                            ticks: { font: { size: 10.5 }, maxRotation: 0 },
                            grid: { display: false }
                        }
                    }
                })
            });

            const tableBody = document.getElementById('demographicsTableBody');
            if (tableBody) {
                const totalAgeGroupCount = ageGroups.reduce((sum, group) => sum + Number(group.value || 0), 0);
                tableBody.innerHTML = ageGroups.map(group => {
                    const value = Number(group.value || 0);
                    const share = totalAgeGroupCount > 0 ? Math.round((value / totalAgeGroupCount) * 100) : 0;
                    let profile = 'Low count';
                    if (value >= 25) profile = 'High concentration';
                    else if (value >= 10) profile = 'Moderate';
                    else if (value > 0) profile = 'Low';

                    return `
                        <tr>
                            <td>${group.label}</td>
                            <td>${value}</td>
                            <td>${share}%</td>
                            <td>${profile}</td>
                        </tr>
                    `;
                }).join('');
            }

            const dominantGroup = ageGroups.reduce((best, group) => Number(group.value || 0) > Number(best.value || 0) ? group : best, { label: 'N/A', value: 0 });
            const burialMix = total > 0 ? Math.round((burials / total) * 100) : 0;
            const cremationMix = total > 0 ? Math.round((cremations / total) * 100) : 0;
            const profileLabel = burialMix > cremationMix ? 'Burial-heavy profile' : cremationMix > burialMix ? 'Cremation-heavy profile' : 'Balanced profile';
            const insights = document.getElementById('demographicsInsights');
            insights.innerHTML = [
                { label: 'Largest age range', value: dominantGroup.label === 'N/A' ? 'No data' : `${dominantGroup.label} yrs`, className: '' },
                { label: 'Service mix', value: profileLabel, className: burialMix >= cremationMix ? 'risk-low' : 'risk-moderate' },
                { label: 'Burial share', value: `${burialMix}%`, className: 'risk-low' },
                { label: 'Cremation share', value: `${cremationMix}%`, className: 'risk-moderate' }
            ].map(item => `
                <div class="insight-item ${item.className || ''}">
                    <span>${item.label}</span>
                    <strong>${item.value}</strong>
                </div>
            `).join('');
        } catch (error) {
            console.error('Failed to load demographics:', error);
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
        try {
            const params = new URLSearchParams();
            params.set('page', '1');
            params.set('per_page', '8');
            const fromValue = document.getElementById('expirationDateFrom')?.value;
            const toValue = document.getElementById('expirationDateTo')?.value;
            if (fromValue) params.set('date_from', fromValue);
            if (toValue) params.set('date_to', toValue);

            const data = await api.request(`reports/expiration?${params.toString()}`, { method: 'GET' });
            const summary = data.summary || {};
            document.getElementById('expExpiring').innerText = summary.expiring_soon ?? 0;
            document.getElementById('expExpired').innerText = summary.expired ?? 0;
            document.getElementById('expRenewalDue').innerText = summary.renewal_due ?? 0;
            document.getElementById('expPendingReview').innerText = summary.pending_review ?? 0;

            const expiringRows = Array.isArray(data.expiring_soon && data.expiring_soon.data) ? data.expiring_soon.data : (Array.isArray(data.expiring_soon) ? data.expiring_soon : []);
            const expiredRows = Array.isArray(data.expired && data.expired.data) ? data.expired.data : (Array.isArray(data.expired) ? data.expired : []);
            const expiringMeta = data.expiring_soon && data.expiring_soon.meta ? data.expiring_soon.meta : { page: 1, total_pages: 1, total: expiringRows.length };
            const expiredMeta = data.expired && data.expired.meta ? data.expired.meta : { page: 1, total_pages: 1, total: expiredRows.length };
            const pageSize = 8;

            buildExpirationStatusChart(document.getElementById('expirationStatusChart'), summary);
            buildExpirationTrendChart(document.getElementById('expirationTrendChart'), expiringRows);

            function renderExpirationTable({ rows, containerId, statusClass, label, emptyText, pagination, meta, infoId }) {
                const safeRows = Array.isArray(rows) ? rows : [];
                const totalCount = Number(meta.total ?? safeRows.length ?? 0);
                const perPage = Number(meta.per_page || pageSize || safeRows.length || 1);
                const totalPages = Math.max(1, Number(meta.total_pages || Math.ceil(totalCount / perPage) || 1));
                const page = Math.min(Math.max(Number(meta.page || pagination.page || 1), 1), totalPages);
                const pageRows = safeRows;
                const table = document.getElementById(containerId);

                table.innerHTML = pageRows.length === 0
                    ? `<tr><td colspan="5">${emptyText}</td></tr>`
                    : pageRows.map(item => `
                        <tr>
                            <td>${item.lot_number}</td>
                            <td>${item.section_name}</td>
                            <td>${item.block_name}</td>
                            <td>${item.end_date}</td>
                            <td><span class="status-badge ${statusClass}">${label}</span></td>
                        </tr>
                    `).join('');

                pagination.render({
                    page,
                    total_pages: totalPages,
                    total: totalCount,
                    shown: pageRows.length,
                });
            }

            const expiringPagination = createPagination({
                prevBtn: document.getElementById('expiringPrevPage'),
                nextBtn: document.getElementById('expiringNextPage'),
                infoEl: document.getElementById('expiringPaginationInfo'),
                jumpForm: document.getElementById('expiringPaginationJumpForm'),
                jumpInput: document.getElementById('expiringPageJumpInput'),
                jumpBtn: document.getElementById('expiringPageJumpBtn'),
                itemLabel: 'lot',
                onChange: async () => {
                    const pageParams = new URLSearchParams();
                    pageParams.set('page', String(expiringPagination.page));
                    pageParams.set('per_page', String(pageSize));
                    const currentFrom = document.getElementById('expirationDateFrom')?.value;
                    const currentTo = document.getElementById('expirationDateTo')?.value;
                    if (currentFrom) pageParams.set('date_from', currentFrom);
                    if (currentTo) pageParams.set('date_to', currentTo);
                    const response = await api.request(`reports/expiration?${pageParams.toString()}`, { method: 'GET' });
                    const nextRows = Array.isArray(response.expiring_soon && response.expiring_soon.data) ? response.expiring_soon.data : [];
                    const nextMeta = response.expiring_soon && response.expiring_soon.meta ? response.expiring_soon.meta : { page: 1, total_pages: 1, total: nextRows.length };
                    renderExpirationTable({ rows: nextRows, containerId: 'expiringTableBody', statusClass: 'status-warning', label: 'Expiring', emptyText: 'No lots expiring soon.', pagination: expiringPagination, meta: nextMeta, infoId: 'expiringPaginationInfo' });
                }
            });

            const expiredPagination = createPagination({
                prevBtn: document.getElementById('expiredPrevPage'),
                nextBtn: document.getElementById('expiredNextPage'),
                infoEl: document.getElementById('expiredPaginationInfo'),
                jumpForm: document.getElementById('expiredPaginationJumpForm'),
                jumpInput: document.getElementById('expiredPageJumpInput'),
                jumpBtn: document.getElementById('expiredPageJumpBtn'),
                itemLabel: 'lot',
                onChange: async () => {
                    const pageParams = new URLSearchParams();
                    pageParams.set('page', String(expiredPagination.page));
                    pageParams.set('per_page', String(pageSize));
                    const currentFrom = document.getElementById('expirationDateFrom')?.value;
                    const currentTo = document.getElementById('expirationDateTo')?.value;
                    if (currentFrom) pageParams.set('date_from', currentFrom);
                    if (currentTo) pageParams.set('date_to', currentTo);
                    const response = await api.request(`reports/expiration?${pageParams.toString()}`, { method: 'GET' });
                    const nextRows = Array.isArray(response.expired && response.expired.data) ? response.expired.data : [];
                    const nextMeta = response.expired && response.expired.meta ? response.expired.meta : { page: 1, total_pages: 1, total: nextRows.length };
                    renderExpirationTable({ rows: nextRows, containerId: 'expiredTableBody', statusClass: 'status-danger', label: 'Expired', emptyText: 'No expired lots.', pagination: expiredPagination, meta: nextMeta, infoId: 'expiredPaginationInfo' });
                }
            });

            renderExpirationTable({ rows: expiringRows, containerId: 'expiringTableBody', statusClass: 'status-warning', label: 'Expiring', emptyText: 'No lots expiring soon.', pagination: expiringPagination, meta: expiringMeta, infoId: 'expiringPaginationInfo' });
            renderExpirationTable({ rows: expiredRows, containerId: 'expiredTableBody', statusClass: 'status-danger', label: 'Expired', emptyText: 'No expired lots.', pagination: expiredPagination, meta: expiredMeta, infoId: 'expiredPaginationInfo' });
        } catch (error) {
            console.error('Failed to load expiration:', error);
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

    // Feature 12: PDF & Excel Export
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
                else if (id === 'occupancyTrendChart' && occupancyTrendChartInstance) dataUrl = occupancyTrendChartInstance.toBase64Image();
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
                const ws = XLSX.utils.table_to_sheet(tbl);
                XLSX.utils.book_append_sheet(wb, ws, `Report_Data_${idx + 1}`);
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
});
