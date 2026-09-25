document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    let chartInstance = null;
    let capacityChartInstance = null;
    let activeForecastRequestId = 0;
    let isForecastLoading = false;
    let currentTimelineData = {
        historical: [],
        future: []
    };
    let activeTimelineTab = 'forecast';
    let activeActivityFilter = 'all';
    let latestForecastPayload = null;
    let latestOccupancyPayload = null;

    function setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    function isDarkTheme() {
        return document.body.getAttribute('data-theme') === 'dark';
    }

    function stampFooterTime() {
        const yearEl = document.getElementById('footerYear');
        if (yearEl) yearEl.textContent = new Date().getFullYear();

        const timeEl = document.getElementById('footerLiveTime');
        const pulseEl = document.querySelector('.footer-pulse-ring');
        const now = new Date();
        const formatted = now.toLocaleString('en-PH', {
            weekday: 'short', month: 'short', day: 'numeric', year: 'numeric',
            hour: '2-digit', minute: '2-digit', hour12: true
        });
        if (timeEl) timeEl.textContent = formatted;
        if (pulseEl) pulseEl.style.display = 'block';
    }

    function updateChartsTheme() {
        const dark = isDarkTheme();
        if (capacityChartInstance) {
            capacityChartInstance.data.datasets.forEach(ds => {
                ds.borderColor = dark ? '#1c2621' : '#ffffff';
            });
            capacityChartInstance.update('none');
        }
        if (chartInstance) {
            if (chartInstance.options.plugins?.legend?.labels) {
                chartInstance.options.plugins.legend.labels.color = dark ? '#cbd5e1' : '#2b3658';
            }
            if (chartInstance.options.scales?.x?.ticks) {
                chartInstance.options.scales.x.ticks.color = dark ? '#94a3b8' : '#475569';
            }
            if (chartInstance.options.scales?.y?.ticks) {
                chartInstance.options.scales.y.ticks.color = dark ? '#94a3b8' : '#475569';
            }
            if (chartInstance.options.scales?.y?.grid) {
                chartInstance.options.scales.y.grid.color = dark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(44, 94, 71, 0.10)';
            }
            chartInstance.update('none');
        }
    }

    const CACHE_KEY_PREFIX = 'cms_forecast_cache_';
    const CACHE_TTL_MS = 5 * 60 * 1000;

    const generateBtn = document.getElementById('generateForecast');
    const sourceStatusEl = document.getElementById('forecastSourceStatus');

    document.getElementById('logoutBtn')?.addEventListener('click', () => api.logout());

    // Top Bar Notification Bell Action & Accessibility
    const notificationBtn = document.getElementById('notificationIcon');
    if (notificationBtn) {
        notificationBtn.setAttribute('role', 'button');
        notificationBtn.setAttribute('tabindex', '0');
        notificationBtn.setAttribute('title', 'View notifications');
        notificationBtn.setAttribute('aria-label', 'View system notifications');
        notificationBtn.style.cursor = 'pointer';

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

    // Top Bar User Profile Action & Accessibility
    const profileEl = document.querySelector('.top-bar .profile');
    if (profileEl) {
        profileEl.setAttribute('role', 'button');
        profileEl.setAttribute('tabindex', '0');
        profileEl.setAttribute('title', 'View user profile');
        profileEl.setAttribute('aria-label', 'View user profile');
        profileEl.style.cursor = 'pointer';

        const openProfile = () => {
            const basePath = typeof getFrontendBasePath === 'function' ? getFrontendBasePath() : '../..';
            window.location.href = `${basePath}/pages/profile.html`;
        };

        profileEl.addEventListener('click', openProfile);
        profileEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openProfile();
            }
        });
    }

    // Populate user profile info in top bar and sidebar
    if (user) {
        const fullName = user.full_name || user.username || user.name || 'Admin User';
        const roleLabel = user.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1)) : 'Administrator';
        const nameEl = document.getElementById('userName');
        const roleEl = document.getElementById('userRole');
        const sidebarNameEl = document.getElementById('sidebarUserName');
        const sidebarRoleEl = document.getElementById('sidebarUserRole');
        if (nameEl) nameEl.textContent = fullName;
        if (roleEl) roleEl.textContent = roleLabel;
        if (sidebarNameEl) sidebarNameEl.textContent = fullName;
        if (sidebarRoleEl) sidebarRoleEl.textContent = roleLabel;

        const avatarEl = document.getElementById('userAvatar');
        const profilePicUrl = user.profile_picture || user.avatar_url || user.photo;
        if (avatarEl && profilePicUrl) {
            avatarEl.innerHTML = `<img src="${profilePicUrl}" alt="${fullName}" style="width:100%;height:100%;object-fit:cover;border-radius:50%;" onerror="this.parentElement.innerHTML='<i class=\\'fas fa-user-tie\\'></i>'">`;
        }
    }

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    function setForecastSourceStatus(text, type = 'neutral') {
        if (!sourceStatusEl) return;
        sourceStatusEl.textContent = text;
        sourceStatusEl.className = `status-pill status-${type}`;
    }

    function setGenerateButtonLoading(loading) {
        if (!generateBtn) return;
        generateBtn.disabled = loading;
        generateBtn.innerHTML = loading
            ? '<i class="fas fa-spinner fa-spin"></i><span>Generating...</span>'
            : '<i class="fas fa-chart-line"></i><span>Generate Forecast</span>';
    }

    function readCachedForecast(months) {
        try {
            const raw = localStorage.getItem(`${CACHE_KEY_PREFIX}${months}`);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || !parsed.timestamp || !parsed.data) return null;
            if (Date.now() - parsed.timestamp > CACHE_TTL_MS) {
                localStorage.removeItem(`${CACHE_KEY_PREFIX}${months}`);
                return null;
            }
            return parsed.data;
        } catch (_) {
            return null;
        }
    }

    function writeCachedForecast(months, data) {
        try {
            localStorage.setItem(`${CACHE_KEY_PREFIX}${months}`, JSON.stringify({
                timestamp: Date.now(),
                data
            }));
        } catch (_) {
            // Storage quota or disabled
        }
    }

    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                const count = Number(result?.count) || 0;
                badge.innerText = count > 99 ? '99+' : count;
                badge.style.display = 'flex';
                badge.setAttribute('aria-label', `${count} unread notifications`);
            }
        } catch (e) {
            console.error('Failed to load notification count:', e);
        }
    }

    async function fetchForecast(months = 6) {
        return await api.request(`ai/forecast?months=${months}`, { method: 'GET' });
    }

    async function fetchOccupancy() {
        try {
            const data = await api.request('reports/occupancy', { method: 'GET' });
            return data || {};
        } catch (err) {
            console.error('Failed to load occupancy data:', err);
            return {};
        }
    }

    function renderCapacityForecastSection(occupancyData) {
        const summary = occupancyData.summary || {};
        const exec = occupancyData.executive_summary || {};

        const totalLots = Number(summary.total) || Number(exec.total_lots) || 0;
        const availableLots = Number(summary.available) || Number(exec.available_lots) || 0;
        const occupiedLots = Number(summary.occupied) || Number(exec.occupied_lots) || 0;
        const reservedLots = Number(summary.reserved) || Number(exec.reserved_lots) || 0;
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

        // Generate versatile, data-driven dynamic insight & recommendation
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

                let recListHtml = '';
                if (exec.key_recommendations && Array.isArray(exec.key_recommendations) && exec.key_recommendations.length) {
                    recListHtml = `
                        <div class="capacity-rec-list">
                            <div class="capacity-rec-list-title">System Strategic Recommendations:</div>
                            <ul class="capacity-rec-list-items">
                                ${exec.key_recommendations.map(r => `<li>${r}</li>`).join('')}
                            </ul>
                        </div>
                    `;
                }

                insightEl.innerHTML = `
                    The cemetery currently has <strong>${availableLots.toLocaleString()} available lots (${availPct}%)</strong> remaining out of a total capacity of <strong>${totalLots.toLocaleString()} lots</strong>. 
                    <strong>${occupiedLots.toLocaleString()} lots (${occPct}%)</strong> are occupied and <strong>${reservedLots.toLocaleString()} lots (${resPct}%)</strong> are on hold. 
                    Overall capacity status is <strong class="insight-highlight">${statusLabel}</strong> — ${recommendation}
                    ${recListHtml}
                `;
            }
        }

        // Initialize Capacity Forecasting Doughnut Chart (Matching Admin Dashboard)
        const capacityCanvas = document.getElementById('capacityForecastChart');
        if (capacityCanvas && typeof Chart !== 'undefined') {
            const capCtx = capacityCanvas.getContext('2d');
            if (capacityChartInstance) {
                capacityChartInstance.destroy();
                capacityChartInstance = null;
            }

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
                        borderColor: isDarkTheme() ? '#1c2621' : '#ffffff',
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
    }

    function trendBadge(trend) {
        if (trend === 'increasing') return '<span class="status-badge status-warning">Increasing</span>';
        if (trend === 'decreasing') return '<span class="status-badge status-success">Decreasing</span>';
        return '<span class="status-badge status-neutral">Stable</span>';
    }

    function capacityBadge(status) {
        if (status === 'critical') return '<span class="status-badge status-danger">Critical</span>';
        if (status === 'warning') return '<span class="status-badge status-warning">Approaching</span>';
        return '<span class="status-badge status-success">Safe</span>';
    }

    function showBanner(id, level, message) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = message;
        el.className = `service-banner visible ${level}`;
    }

    function hideBanner(id) {
        const el = document.getElementById(id);
        if (!el) return;
        el.textContent = '';
        el.className = 'service-banner';
    }

    function resetStats() {
        const curEl = document.getElementById('currentOccupancy');
        if (curEl) curEl.innerHTML = '0 / 0';
        const curSub = document.getElementById('currentOccupancySub');
        if (curSub) curSub.innerText = 'Loading lot status...';

        const predEl = document.getElementById('predictedOccupancy');
        if (predEl) predEl.innerHTML = '0';
        const predSub = document.getElementById('predictedOccupancySub');
        if (predSub) predSub.innerText = 'Calculating demand...';

        const availEl = document.getElementById('availableFuture');
        if (availEl) availEl.innerHTML = '0';
        const availSub = document.getElementById('availableFutureSub');
        if (availSub) availSub.innerText = 'Projecting availability...';

        const trendEl = document.getElementById('trendStatus');
        if (trendEl) trendEl.innerHTML = '—';
        const trendSub = document.getElementById('trendStatusSub');
        if (trendSub) trendSub.innerText = 'Analyzing runway...';

        const chipBurn = document.getElementById('chipBurnRate');
        if (chipBurn) chipBurn.innerHTML = '<i class="fas fa-fire-flame-curved"></i> Pace: <strong>—</strong>';
        const chipRunway = document.getElementById('chipRunway');
        if (chipRunway) chipRunway.innerHTML = '<i class="fas fa-hourglass-half"></i> Runway: <strong>—</strong>';

        const takeawayEl = document.getElementById('forecastTakeawayText');
        if (takeawayEl) takeawayEl.innerText = 'Calculating data-driven operational recommendation...';

        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
        document.getElementById('forecastDetails').innerHTML = '';
    }

    function renderOperationalGuidance(forecast, occupancy) {
        const guidance = forecast?.operational_guidance;
        const summary = occupancy?.summary || {};
        const exec = occupancy?.executive_summary || {};
        const totalLots = Number(summary.total) || Number(exec.total_lots) || Number(forecast?.capacity?.total) || 0;
        const availableLots = Number(summary.available) || Number(exec.available_lots) || Number(forecast?.capacity?.available) || 0;

        const future = Array.isArray(forecast?.forecast) ? forecast.forecast : [];
        const horizonMonths = future.length || Number(document.getElementById('forecastMonths')?.value) || 6;
        const lastEntry = future.length ? future[future.length - 1] : null;
        const predictedBurials = lastEntry ? Number(lastEntry.cumulative || 0) : future.reduce((sum, item) => sum + (Number(item.predicted_burials) || 0), 0);
        const avgMonthlyDemand = horizonMonths > 0 ? (predictedBurials / horizonMonths) : 0;
        const runwayMonths = avgMonthlyDemand > 0 ? (availableLots / avgMonthlyDemand) : 999;

        // Metric chips
        const burnRateVal = guidance?.burn_rate_monthly != null ? Number(guidance.burn_rate_monthly) : avgMonthlyDemand;
        const runwayVal = guidance?.runway_months != null ? Number(guidance.runway_months) : runwayMonths;

        const chipBurn = document.getElementById('chipBurnRate');
        if (chipBurn) {
            chipBurn.innerHTML = `<i class="fas fa-fire-flame-curved"></i> Pace: <strong>~${burnRateVal.toFixed(1)} burials/mo</strong>`;
        }

        const chipRunway = document.getElementById('chipRunway');
        if (chipRunway) {
            let runwayLabel = `~${runwayVal.toFixed(1)} mos`;
            if (availableLots <= 0) runwayLabel = 'Exhausted (0 mos)';
            else if (runwayVal > 60) runwayLabel = '> 5 Years';
            else if (runwayVal > 24) runwayLabel = `~${(runwayVal / 12).toFixed(1)} yrs`;
            else if (runwayVal < 1) runwayLabel = '< 1 mo';

            chipRunway.innerHTML = `<i class="fas fa-hourglass-half"></i> Runway: <strong>${runwayLabel}</strong>`;
        }

        // Dynamic Live Takeaway Banner
        const takeawayEl = document.getElementById('forecastTakeawayText');
        const takeawayBox = document.getElementById('forecastLiveTakeaway');

        if (takeawayEl) {
            if (guidance?.headline) {
                takeawayEl.innerHTML = guidance.headline;
            } else if (totalLots <= 0) {
                takeawayEl.innerText = 'Record lot inventory in the system to generate data-driven operational recommendations.';
            } else if (availableLots <= 0) {
                takeawayEl.innerHTML = `<span style="color:#ef4444; font-weight:700;">Zero open plots remaining!</span> Immediate land acquisition, crypt expansion, or expired plot reclamation is critical to accommodate <strong>+${predictedBurials} burials</strong> over the next <strong>${horizonMonths} months</strong>.`;
            } else if (runwayMonths <= 6) {
                const alertM = forecast?.capacity_alert?.month || 'the near term';
                takeawayEl.innerHTML = `At an intake velocity of <strong>~${avgMonthlyDemand.toFixed(1)} burials/month</strong>, the remaining <strong>${availableLots} available plots</strong> provide only <strong>~${runwayMonths.toFixed(1)} months</strong> of operational runway (reaching alert threshold by <strong>${alertM}</strong>). Immediate land expansion and proactive reclamation notices are recommended.`;
            } else {
                takeawayEl.innerHTML = `At an intake velocity of <strong>~${avgMonthlyDemand.toFixed(1)} burials/month</strong>, current cemetery inventory of <strong>${availableLots} open plots</strong> remains safe for <strong>~${runwayMonths.toFixed(1)} months</strong> (~${(runwayMonths / 12).toFixed(1)} yrs). Maintain routine monitoring of lease expirations and space allocation.`;
            }
        }

        if (takeawayBox) {
            const status = guidance?.alert_status || (runwayMonths <= 6 || availableLots <= 0 ? 'warning' : 'safe');
            takeawayBox.classList.remove('status-safe', 'status-warning', 'status-danger');
            takeawayBox.classList.add(`status-${status}`);
        }

        // 4 Decision Pillars (Backend-driven)
        const pillars = guidance?.pillars || {};

        // Pillar 1: Land & Capacity Expansion
        const p1 = pillars.expansion;
        if (p1) {
            if (p1.goal) setText('pillarExpansionGoal', `Goal: ${p1.goal}`);
            if (p1.recommendation) setText('pillarExpansionDesc', p1.recommendation);
        } else {
            setText('pillarExpansionGoal', 'Goal: Prevent abrupt plot shortages');
            if (availableLots <= 0) {
                setText('pillarExpansionDesc', `Zero open plots remaining. Immediate land acquisition or columbarium construction is critical to handle +${predictedBurials} burials across ${horizonMonths} months.`);
            } else if (runwayMonths <= 6) {
                setText('pillarExpansionDesc', `Remaining inventory will deplete in ~${runwayMonths.toFixed(1)} months. Initiate lot development and site clearing within 30 days.`);
            } else {
                setText('pillarExpansionDesc', `Inventory runway is stable at ~${runwayMonths.toFixed(1)} months. Maintain routine monitoring and reserve allocations.`);
            }
        }

        // Pillar 2: Staffing & Operations Allocation
        const p2 = pillars.staffing;
        if (p2) {
            if (p2.goal) setText('pillarStaffingGoal', `Goal: ${p2.goal}`);
            if (p2.recommendation) setText('pillarStaffingDesc', p2.recommendation);
        } else {
            const weeklyPace = (avgMonthlyDemand / 4.33).toFixed(1);
            setText('pillarStaffingGoal', 'Goal: Ensure workforce and gear readiness');
            setText('pillarStaffingDesc', `Anticipate ~${weeklyPace} interments weekly. Schedule excavation crews, backhoes, and ceremonial canopy setups accordingly.`);
        }

        // Pillar 3: Lease Expiration & Plot Reclamation
        const p3 = pillars.reclamation;
        if (p3) {
            if (p3.goal) setText('pillarReclamationGoal', `Goal: ${p3.goal}`);
            if (p3.recommendation) setText('pillarReclamationDesc', p3.recommendation);
        } else {
            setText('pillarReclamationGoal', 'Goal: Replenish inventory via 5-year leases');
            setText('pillarReclamationDesc', `Audit leases reaching the 5-year term during this ${horizonMonths}-month window to issue renewal notices or schedule exhumation/reclamation.`);
        }

        // Pillar 4: Budget & Materials Procurement
        const p4 = pillars.budgeting;
        if (p4) {
            if (p4.goal) setText('pillarBudgetingGoal', `Goal: ${p4.goal}`);
            if (p4.recommendation) setText('pillarBudgetingDesc', p4.recommendation);
        } else {
            setText('pillarBudgetingGoal', 'Goal: Forecast revenue and advance supply orders');
            setText('pillarBudgetingDesc', `Forecast cash flow for +${predictedBurials} expected burials. Order concrete liners, gravel, and identification markers 60-90 days in advance.`);
        }
    }

    function renderForecastPayload(forecast, occupancy) {
        latestForecastPayload = forecast;
        latestOccupancyPayload = occupancy;

        // Render Cemetery Capacity Forecasting & Space Utilization (Matching Admin Dashboard)
        renderCapacityForecastSection(occupancy);

        const summary = occupancy.summary || {};
        const exec = occupancy.executive_summary || {};
        const totalLots = Number(summary.total) || Number(exec.total_lots) || Number(forecast.capacity?.total) || 0;
        const occupiedLots = Number(summary.occupied) || Number(exec.occupied_lots) || Number(forecast.capacity?.occupied) || 0;
        const reservedLots = Number(summary.reserved) || Number(exec.reserved_lots) || Number(forecast.capacity?.reserved) || 0;
        const availableLots = Number(summary.available) || Number(exec.available_lots) || Number(forecast.capacity?.available) || (totalLots > 0 ? Math.max(0, totalLots - occupiedLots - reservedLots) : 0);
        const occPct = totalLots > 0 ? Math.round((occupiedLots / totalLots) * 100) : 0;

        // Card 1: Current Utilization (Baseline lot inventory)
        const curEl = document.getElementById('currentOccupancy');
        const curSubEl = document.getElementById('currentOccupancySub');
        if (curEl) {
            if (totalLots > 0) {
                curEl.innerHTML = `${occupiedLots.toLocaleString()} / ${totalLots.toLocaleString()} <span class="stat-unit">(${occPct}% Occupied)</span>`;
            } else {
                curEl.innerHTML = `0 / 0`;
            }
        }
        if (curSubEl) {
            if (totalLots > 0) {
                curSubEl.innerHTML = `${availableLots.toLocaleString()} open for burials &bull; ${reservedLots.toLocaleString()} on hold/reserved`;
            } else {
                curSubEl.innerText = 'No lot inventory data recorded';
            }
        }

        if (forecast.fallback) {
            setForecastSourceStatus('Fallback Active', 'warning');
            showBanner('serviceBanner', 'warning', `AI engine is operating in fallback mode. Displaying live cemetery capacity utilization and heuristic projection.`);
        } else {
            setForecastSourceStatus(forecast.is_cached ? 'Cached' : 'Live Engine', 'success');
        }

        const future = Array.isArray(forecast.forecast) ? forecast.forecast : [];
        const horizonMonths = future.length || Number(document.getElementById('forecastMonths')?.value) || 6;
        const lastEntry = future.length ? future[future.length - 1] : null;
        const predictedBurials = lastEntry ? Number(lastEntry.cumulative || 0) : future.reduce((sum, item) => sum + (Number(item.predicted_burials) || 0), 0);
        const avgMonthlyDemand = horizonMonths > 0 ? (predictedBurials / horizonMonths) : 0;

        // Card 2: Projected Demand (Burial intake over selected horizon)
        const predEl = document.getElementById('predictedOccupancy');
        const predSubEl = document.getElementById('predictedOccupancySub');
        if (predEl) {
            predEl.innerHTML = `+${predictedBurials.toLocaleString()} <span class="stat-unit">Burials</span>`;
        }
        if (predSubEl) {
            if (predictedBurials > 0) {
                predSubEl.innerHTML = `~${avgMonthlyDemand.toFixed(1)} burials/mo across next ${horizonMonths} mos`;
            } else {
                predSubEl.innerHTML = `0 burials projected across next ${horizonMonths} mos`;
            }
        }

        // Card 3: Net Available Space (Remaining open plots after projected demand)
        const projectedAvailable = lastEntry && typeof lastEntry.projected_available === 'number' 
            ? lastEntry.projected_available 
            : Math.max(0, availableLots - predictedBurials);
        const projectedAvailPct = totalLots > 0 ? Math.round((projectedAvailable / totalLots) * 100) : 0;

        const availEl = document.getElementById('availableFuture');
        const availSubEl = document.getElementById('availableFutureSub');
        if (availEl) {
            availEl.innerHTML = `${projectedAvailable.toLocaleString()} <span class="stat-unit">Plots (${projectedAvailPct}%)</span>`;
        }
        if (availSubEl) {
            if (projectedAvailable <= 0) {
                availSubEl.innerHTML = `<span style="color:#fca5a5;"><i class="fas fa-triangle-exclamation"></i> Space exhausted within projection period</span>`;
            } else if (availableLots > projectedAvailable) {
                availSubEl.innerHTML = `Drops from ${availableLots.toLocaleString()} open to ${projectedAvailable.toLocaleString()} plots`;
            } else {
                availSubEl.innerHTML = `${projectedAvailable.toLocaleString()} open plots projected remaining`;
            }
        }

        // Card 4: Est. Capacity Runway (Operational time before depletion / alert threshold)
        const runwayMonths = avgMonthlyDemand > 0 ? (availableLots / avgMonthlyDemand) : 999;
        const runwayEl = document.getElementById('trendStatus');
        const runwaySubEl = document.getElementById('trendStatusSub');

        if (runwayEl) {
            if (availableLots <= 0) {
                runwayEl.innerHTML = `<span style="color:#fca5a5;">0 Mos</span> <span class="stat-unit">(Full)</span>`;
            } else if (avgMonthlyDemand <= 0) {
                runwayEl.innerHTML = `> 5 <span class="stat-unit">Years</span>`;
            } else if (runwayMonths < 1) {
                runwayEl.innerHTML = `< 1 <span class="stat-unit">Month</span>`;
            } else if (runwayMonths <= 24) {
                runwayEl.innerHTML = `~${runwayMonths.toFixed(1)} <span class="stat-unit">Months</span>`;
            } else {
                runwayEl.innerHTML = `> 2 <span class="stat-unit">Years</span>`;
            }
        }

        if (runwaySubEl) {
            if (forecast.capacity_alert && forecast.capacity_alert.status) {
                const alertLevel = forecast.capacity_alert.status === 'critical' ? 'Critical (95%)' : 'Warning (80%)';
                const alertMonth = forecast.capacity_alert.month || 'projected period';
                runwaySubEl.innerHTML = `<i class="fas fa-triangle-exclamation" style="color:#fde047; margin-right:4px;"></i> ${alertLevel} alert by ${alertMonth}`;
            } else if (runwayMonths <= 6) {
                runwaySubEl.innerHTML = `<i class="fas fa-triangle-exclamation" style="color:#fde047; margin-right:4px;"></i> Low capacity runway (&lt; 6 mos)`;
            } else {
                const trendText = forecast.trend === 'increasing' ? 'Upward demand' : forecast.trend === 'decreasing' ? 'Downward demand' : 'Stable burn pace';
                runwaySubEl.innerHTML = `<i class="fas fa-shield-halved" style="color:#86efac; margin-right:4px;"></i> ${trendText} &bull; Safe runway`;
            }
        }

        // Render dynamic backend-driven Operational Guidance (Decision Framework & 4 Pillars)
        renderOperationalGuidance(forecast, occupancy);

        const canvas = document.getElementById('forecastChart');
        if (!canvas) return true;
        const ctx = canvas.getContext('2d');
        const historical = forecast.historical || [];
        const labels = historical.map(item => item.month);

        currentTimelineData.historical = historical;
        currentTimelineData.future = future;
        currentTimelineData.totalLots = totalLots;
        currentTimelineData.availableLots = availableLots;

        const burialsData = historical.map(item => Number(item.burials) || 0);
        const cremationsData = historical.map(item => Number(item.cremations) || 0);
        const relocationsData = historical.map(item => Number(item.relocations) || 0);

        if (chartInstance) {
            chartInstance.destroy();
        }

        chartInstance = new Chart(ctx, {
            type: 'line',
            data: {
                labels,
                datasets: [
                    {
                        id: 'burials',
                        label: 'Past Burials',
                        data: burialsData,
                        borderColor: '#0f766e',
                        backgroundColor: 'rgba(15, 118, 110, 0.12)',
                        borderWidth: 2.5,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#0f766e',
                        pointBorderColor: '#ffffff',
                        tension: 0.35,
                        fill: false
                    },
                    {
                        id: 'cremations',
                        label: 'Past Cremations',
                        data: cremationsData,
                        borderColor: '#d97706',
                        backgroundColor: 'rgba(217, 119, 6, 0.12)',
                        borderWidth: 2.5,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#d97706',
                        pointBorderColor: '#ffffff',
                        tension: 0.35,
                        fill: false
                    },
                    {
                        id: 'relocations',
                        label: 'Past Relocations',
                        data: relocationsData,
                        borderColor: '#6366f1',
                        backgroundColor: 'rgba(99, 102, 241, 0.12)',
                        borderWidth: 2.5,
                        pointRadius: 4,
                        pointHoverRadius: 6,
                        pointBackgroundColor: '#6366f1',
                        pointBorderColor: '#ffffff',
                        tension: 0.35,
                        fill: false
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: {
                        position: 'top',
                        labels: {
                            usePointStyle: true,
                            boxWidth: 10,
                            boxHeight: 10,
                            color: isDarkTheme() ? '#cbd5e1' : '#2b3658',
                            font: { size: 11, weight: '600' }
                        }
                    },
                    tooltip: {
                        backgroundColor: 'rgba(15, 23, 42, 0.94)',
                        titleColor: '#ffffff',
                        bodyColor: '#ffffff',
                        padding: 12,
                        cornerRadius: 8,
                        displayColors: true,
                        callbacks: {
                            title: (items) => {
                                if (!items || !items.length) return '';
                                return items[0].label;
                            },
                            label: (context) => {
                                const val = context.parsed.y;
                                if (val === null || val === undefined) return null;
                                return ` ${context.dataset.label}: ${val.toLocaleString()}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { display: false },
                        ticks: {
                            maxRotation: 45,
                            autoSkip: true,
                            maxTicksLimit: 14,
                            color: isDarkTheme() ? '#94a3b8' : '#475569',
                            font: { size: 11 }
                        }
                    },
                    y: {
                        beginAtZero: true,
                        grid: { color: isDarkTheme() ? 'rgba(255, 255, 255, 0.08)' : 'rgba(44, 94, 71, 0.10)' },
                        ticks: {
                            precision: 0,
                            color: isDarkTheme() ? '#94a3b8' : '#475569',
                            font: { size: 11 }
                        }
                    }
                }
            }
        });

        applyActivityChartFilter(activeActivityFilter);
        renderTimelineTable(activeTimelineTab);
        stampFooterTime();

        return true;
    }

    function applyActivityChartFilter(filter) {
        activeActivityFilter = filter;
        if (!chartInstance) return;

        // Dataset indexes: 0 = Past Burials, 1 = Past Cremations, 2 = Past Relocations
        if (filter === 'all') {
            chartInstance.setDatasetVisibility(0, true);
            chartInstance.setDatasetVisibility(1, true);
            chartInstance.setDatasetVisibility(2, true);
            setText('chartViewBadge', 'All Operations');
        } else if (filter === 'burials') {
            chartInstance.setDatasetVisibility(0, true);
            chartInstance.setDatasetVisibility(1, false);
            chartInstance.setDatasetVisibility(2, false);
            setText('chartViewBadge', 'Burials Only');
        } else if (filter === 'cremations') {
            chartInstance.setDatasetVisibility(0, false);
            chartInstance.setDatasetVisibility(1, true);
            chartInstance.setDatasetVisibility(2, false);
            setText('chartViewBadge', 'Cremations Only');
        } else if (filter === 'relocations') {
            chartInstance.setDatasetVisibility(0, false);
            chartInstance.setDatasetVisibility(1, false);
            chartInstance.setDatasetVisibility(2, true);
            setText('chartViewBadge', 'Relocations Only');
        }
        chartInstance.update();
    }

    function renderTimelineTable(tabName) {
        activeTimelineTab = tabName;
        const container = document.getElementById('forecastDetails');
        if (!container) return;

        const { historical, future } = currentTimelineData;
        const availableLots = currentTimelineData.availableLots || 0;

        if (tabName === 'historical') {
            setText('detailsTableTitle', 'Historical Operations Log');
            setText('detailsTableSub', 'Chronological log of past burials, cremations, and relocations');

            const recentHistorical = [...historical].reverse();

            container.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Month</th>
                            <th>Burials</th>
                            <th>Cremations</th>
                            <th>Relocations</th>
                            <th>Total Operations</th>
                            <th>Activity Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${recentHistorical.length === 0 ? '<tr><td colspan="6" class="text-center text-muted" style="padding: 24px; text-align: center;">No historical operations logged.</td></tr>' : 
                        recentHistorical.map(item => {
                            const b = Number(item.burials) || 0;
                            const c = Number(item.cremations) || 0;
                            const r = Number(item.relocations) || 0;
                            const tot = Number(item.total_activities) || (b + c + r);

                            let mixBadge = '<span class="status-badge status-neutral">No Activity</span>';
                            if (tot > 0) {
                                if (b >= c && b >= r) mixBadge = '<span class="status-badge status-success">Burial-Led</span>';
                                else if (c >= b && c >= r) mixBadge = '<span class="status-badge status-warning">Cremation-Led</span>';
                                else mixBadge = '<span class="status-badge status-neutral">Relocation-Led</span>';
                            }

                            return `
                                <tr>
                                    <td><strong>${item.month}</strong></td>
                                    <td>${b.toLocaleString()}</td>
                                    <td>${c.toLocaleString()}</td>
                                    <td>${r.toLocaleString()}</td>
                                    <td><strong>${tot.toLocaleString()}</strong></td>
                                    <td>${mixBadge}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        } else if (tabName === 'combined') {
            setText('detailsTableTitle', 'Combined Operations & Forecast Timeline');
            setText('detailsTableSub', 'Unified operational history and projected burial demand');

            const pastRows = historical.map(item => {
                const tot = Number(item.total_activities) || ((Number(item.burials) || 0) + (Number(item.cremations) || 0) + (Number(item.relocations) || 0));
                return `
                    <tr class="row-past-operation">
                        <td><strong>${item.month}</strong></td>
                        <td><span class="status-badge status-neutral">Past Operation</span></td>
                        <td>${tot.toLocaleString()} recorded</td>
                        <td>${item.burials || 0} burials, ${item.cremations || 0} cremations, ${item.relocations || 0} relocations</td>
                        <td>—</td>
                        <td><span class="status-badge status-neutral">Logged</span></td>
                    </tr>
                `;
            });

            const futureRows = future.map(item => {
                const avail = item.projected_available != null ? Number(item.projected_available) : Math.max(0, availableLots - Number(item.cumulative));
                return `
                    <tr class="row-projected-demand">
                        <td><strong>${item.month}</strong></td>
                        <td><span class="status-badge status-success">Projected Demand</span></td>
                        <td>+${item.predicted_burials} burials</td>
                        <td>Cumulative: ${item.cumulative}</td>
                        <td>${avail.toLocaleString()} plots</td>
                        <td>${capacityBadge(item.capacity_status)}</td>
                    </tr>
                `;
            });

            container.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Month</th>
                            <th>Record Type</th>
                            <th>Interment / Operations</th>
                            <th>Breakdown / Cumulative</th>
                            <th>Available Plots</th>
                            <th>Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${pastRows.length === 0 && futureRows.length === 0 ? '<tr><td colspan="6" class="text-center text-muted" style="padding: 24px; text-align: center;">No timeline data available.</td></tr>' : pastRows.join('') + futureRows.join('')}
                    </tbody>
                </table>
            `;
        } else {
            // Default: 'forecast'
            setText('detailsTableTitle', 'Forecast Demand & Capacity Projections');
            setText('detailsTableSub', 'Monthly projected interment demand, cumulative velocity, and plot availability');

            container.innerHTML = `
                <table class="data-table">
                    <thead>
                        <tr>
                            <th>Month</th>
                            <th>Predicted Burials</th>
                            <th>Cumulative Demand</th>
                            <th>Reclaimable Plots</th>
                            <th>Projected Available</th>
                            <th>Capacity Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${future.length === 0 ? '<tr><td colspan="6" class="text-center text-muted" style="padding: 24px; text-align: center;">No forecast projection generated.</td></tr>' :
                        future.map(item => {
                            const avail = item.projected_available != null ? Number(item.projected_available) : Math.max(0, availableLots - Number(item.cumulative));
                            return `
                                <tr>
                                    <td><strong>${item.month}</strong></td>
                                    <td>+${item.predicted_burials}</td>
                                    <td>${item.cumulative}</td>
                                    <td>${item.reclaimable > 0 ? `+${item.reclaimable}` : '—'}</td>
                                    <td>${avail.toLocaleString()} plots</td>
                                    <td>${capacityBadge(item.capacity_status)}</td>
                                </tr>
                            `;
                        }).join('')}
                    </tbody>
                </table>
            `;
        }
    }

    async function renderForecast(months) {
        if (isForecastLoading) return;

        const requestId = ++activeForecastRequestId;
        isForecastLoading = true;
        hideBanner('serviceBanner');
        setGenerateButtonLoading(true);

        const cachedForecast = readCachedForecast(months);
        if (cachedForecast) {
            setForecastSourceStatus('Using cached data', 'neutral');
            try {
                const occupancy = await fetchOccupancy();
                if (requestId !== activeForecastRequestId) return;
                renderForecastPayload(cachedForecast, occupancy);
            } catch (error) {
                if (requestId !== activeForecastRequestId) return;
                console.warn('Cached forecast render failed, continuing with live fetch:', error);
            }
        }

        try {
            const [forecastRes, occRes] = await Promise.allSettled([fetchForecast(months), fetchOccupancy()]);
            if (requestId !== activeForecastRequestId) return;
            const occupancy = (occRes.status === 'fulfilled' && occRes.value) ? occRes.value : {};
            const forecast = (forecastRes.status === 'fulfilled' && forecastRes.value) ? forecastRes.value : { fallback: true, message: 'AI service offline' };

            if (!forecast.fallback) {
                writeCachedForecast(months, forecast);
            }
            renderForecastPayload(forecast, occupancy);
        } catch (error) {
            if (requestId !== activeForecastRequestId) return;
            setForecastSourceStatus('Unavailable', 'danger');
            showBanner('serviceBanner', 'danger', 'Failed to generate forecast: ' + error.message);
        } finally {
            if (requestId === activeForecastRequestId) {
                isForecastLoading = false;
                setGenerateButtonLoading(false);
            }
        }
    }

    const themeObserver = new MutationObserver(() => {
        updateChartsTheme();
    });
    themeObserver.observe(document.body, { attributes: true, attributeFilter: ['data-theme'] });

    document.getElementById('generateForecast').addEventListener('click', async () => {
        const months = parseInt(document.getElementById('forecastMonths').value, 10);
        await renderForecast(months);
    });

    document.querySelectorAll('#activityFilterGroup .activity-pill').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#activityFilterGroup .activity-pill').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            applyActivityChartFilter(btn.dataset.filter);
        });
    });

    document.querySelectorAll('#timelineTableTabs .subtab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            document.querySelectorAll('#timelineTableTabs .subtab-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            renderTimelineTable(btn.dataset.tab);
        });
    });

    function setupInteractiveStatCards() {
        const modal = document.getElementById('metricDetailModal');
        const modalTitle = document.getElementById('metricModalTitle');
        const modalSubtitle = document.getElementById('metricModalSubtitle');
        const modalIcon = document.getElementById('metricModalIcon');
        const modalBody = document.getElementById('metricModalBody');
        const jumpBtn = document.getElementById('modalJumpSectionBtn');
        const closeBtn = document.getElementById('closeMetricModalBtn');
        const dismissBtn = document.getElementById('modalDismissBtn');

        let currentTargetSectionId = null;

        function closeModal() {
            if (!modal) return;
            modal.classList.remove('open');
            setTimeout(() => {
                modal.style.display = 'none';
                modal.setAttribute('aria-hidden', 'true');
            }, 200);
        }

        function openModal() {
            if (!modal) return;
            modal.style.display = 'flex';
            modal.setAttribute('aria-hidden', 'false');
            requestAnimationFrame(() => modal.classList.add('open'));
        }

        closeBtn?.addEventListener('click', closeModal);
        dismissBtn?.addEventListener('click', closeModal);
        modal?.addEventListener('click', (e) => {
            if (e.target === modal) closeModal();
        });
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && modal?.classList.contains('open')) {
                closeModal();
            }
        });

        jumpBtn?.addEventListener('click', () => {
            closeModal();
            if (currentTargetSectionId) {
                const el = document.getElementById(currentTargetSectionId);
                if (el) {
                    el.scrollIntoView({ behavior: 'smooth', block: 'start' });
                    el.classList.remove('card-focus-pulse');
                    void el.offsetWidth;
                    el.classList.add('card-focus-pulse');
                }
            }
        });

        document.querySelectorAll('.forecast-stats > .stat-card').forEach(card => {
            const metric = card.dataset.metric;
            if (!metric) return;

            function triggerCard(openDetailModal = true) {
                document.querySelectorAll('.forecast-stats > .stat-card').forEach(c => c.classList.remove('is-active-filter'));
                card.classList.add('is-active-filter');

                const forecast = latestForecastPayload || {};
                const occupancy = latestOccupancyPayload || {};
                const summary = occupancy.summary || {};
                const exec = occupancy.executive_summary || {};
                const totalLots = Number(summary.total) || Number(exec.total_lots) || Number(forecast.capacity?.total) || 0;
                const occupiedLots = Number(summary.occupied) || Number(exec.occupied_lots) || Number(forecast.capacity?.occupied) || 0;
                const reservedLots = Number(summary.reserved) || Number(exec.reserved_lots) || Number(forecast.capacity?.reserved) || 0;
                const availableLots = Number(summary.available) || Number(exec.available_lots) || Number(forecast.capacity?.available) || (totalLots > 0 ? Math.max(0, totalLots - occupiedLots - reservedLots) : 0);
                const occPct = totalLots > 0 ? Math.round((occupiedLots / totalLots) * 100) : 0;
                const availPct = totalLots > 0 ? Math.round((availableLots / totalLots) * 100) : 0;
                const resPct = totalLots > 0 ? Math.round((reservedLots / totalLots) * 100) : 0;

                const future = Array.isArray(forecast.forecast) ? forecast.forecast : [];
                const horizonMonths = future.length || Number(document.getElementById('forecastMonths')?.value) || 6;
                const lastEntry = future.length ? future[future.length - 1] : null;
                const predictedBurials = lastEntry ? Number(lastEntry.cumulative || 0) : future.reduce((sum, item) => sum + (Number(item.predicted_burials) || 0), 0);
                const avgMonthlyDemand = horizonMonths > 0 ? (predictedBurials / horizonMonths) : 0;
                const projectedAvailable = lastEntry && typeof lastEntry.projected_available === 'number'
                    ? lastEntry.projected_available
                    : Math.max(0, availableLots - predictedBurials);
                const projectedAvailPct = totalLots > 0 ? Math.round((projectedAvailable / totalLots) * 100) : 0;
                const runwayMonths = avgMonthlyDemand > 0 ? (availableLots / avgMonthlyDemand) : 999;
                const weeklyPace = Math.max(1, Math.round(avgMonthlyDemand / 4.3));

                if (metric === 'capacity') {
                    currentTargetSectionId = 'capacityForecastSection';
                    if (modalTitle) modalTitle.textContent = 'Current Cemetery Utilization & Lot Inventory';
                    if (modalSubtitle) modalSubtitle.textContent = 'Active lot mapping, occupancy rates, and cemetery space distribution';
                    if (modalIcon) {
                        modalIcon.style.background = '#2c5e47';
                        modalIcon.innerHTML = '<i class="fas fa-house-user"></i>';
                    }
                    if (modalBody) {
                        modalBody.innerHTML = `
                            <div class="metric-modal-grid">
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Available Space</span>
                                    <strong class="metric-modal-tile__val" style="color: #16382b;">${availableLots.toLocaleString()} <small style="font-size:0.75rem;">(${availPct}%)</small></strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Occupied Lots</span>
                                    <strong class="metric-modal-tile__val" style="color: #1e293b;">${occupiedLots.toLocaleString()} <small style="font-size:0.75rem;">(${occPct}%)</small></strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Reserved / On-Hold</span>
                                    <strong class="metric-modal-tile__val" style="color: #64748b;">${reservedLots.toLocaleString()} <small style="font-size:0.75rem;">(${resPct}%)</small></strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Total Mapped Lots</span>
                                    <strong class="metric-modal-tile__val">${totalLots.toLocaleString()}</strong>
                                </div>
                            </div>
                            <div class="metric-modal-callout">
                                <strong><i class="fas fa-chart-pie" style="color:#2c5e47; margin-right:6px;"></i> Capacity Status:</strong>
                                ${totalLots > 0 ? `Current space utilization is at <strong>${occPct}%</strong> with <strong>${availableLots}</strong> open lots remaining for assignments and reservations.` : 'No lot data currently mapped.'}
                            </div>
                        `;
                    }
                } else if (metric === 'demand') {
                    currentTargetSectionId = 'detailsTableContainer';
                    // Switch table tab to forecast
                    document.querySelectorAll('#timelineTableTabs .subtab-btn').forEach(b => b.classList.remove('active'));
                    const tabBtn = document.querySelector('#timelineTableTabs .subtab-btn[data-tab="forecast"]');
                    tabBtn?.classList.add('active');
                    renderTimelineTable('forecast');

                    if (modalTitle) modalTitle.textContent = 'Projected Burial Demand Analysis';
                    if (modalSubtitle) modalSubtitle.textContent = 'Forward-looking interment volume and monthly intake velocity';
                    if (modalIcon) {
                        modalIcon.style.background = '#2c5e47';
                        modalIcon.innerHTML = '<i class="fas fa-chart-line"></i>';
                    }
                    if (modalBody) {
                        modalBody.innerHTML = `
                            <div class="metric-modal-grid">
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Projected Demand</span>
                                    <strong class="metric-modal-tile__val" style="color: #16382b;">+${predictedBurials.toLocaleString()} <small style="font-size:0.75rem;">Burials</small></strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Monthly Intake Pace</span>
                                    <strong class="metric-modal-tile__val">~${avgMonthlyDemand.toFixed(1)} <small style="font-size:0.75rem;">/mo</small></strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Forecast Horizon</span>
                                    <strong class="metric-modal-tile__val">${horizonMonths} Months</strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Weekly Crew Demand</span>
                                    <strong class="metric-modal-tile__val">~${weeklyPace} <small style="font-size:0.75rem;">services/wk</small></strong>
                                </div>
                            </div>
                            <div class="metric-modal-callout">
                                <strong><i class="fas fa-users-gear" style="color:#2c5e47; margin-right:6px;"></i> Operational Impact:</strong>
                                Anticipating ~${avgMonthlyDemand.toFixed(1)} burials/month across the next ${horizonMonths} months requires scheduling grave-digging crews and ceremonial equipment ahead of peak booking windows.
                            </div>
                        `;
                    }
                } else if (metric === 'space') {
                    currentTargetSectionId = 'detailsTableContainer';
                    // Switch table tab to combined
                    document.querySelectorAll('#timelineTableTabs .subtab-btn').forEach(b => b.classList.remove('active'));
                    const tabBtn = document.querySelector('#timelineTableTabs .subtab-btn[data-tab="combined"]');
                    tabBtn?.classList.add('active');
                    renderTimelineTable('combined');

                    if (modalTitle) modalTitle.textContent = 'Net Available Space & Depletion Timeline';
                    if (modalSubtitle) modalSubtitle.textContent = 'Remaining cemetery plot inventory adjusted for forecasted intake';
                    if (modalIcon) {
                        modalIcon.style.background = '#2c5e47';
                        modalIcon.innerHTML = '<i class="fas fa-expand"></i>';
                    }
                    if (modalBody) {
                        modalBody.innerHTML = `
                            <div class="metric-modal-grid">
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Baseline Open Plots</span>
                                    <strong class="metric-modal-tile__val">${availableLots.toLocaleString()}</strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Forecasted Demand</span>
                                    <strong class="metric-modal-tile__val" style="color: #991b1b;">-${predictedBurials.toLocaleString()}</strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Projected Remaining</span>
                                    <strong class="metric-modal-tile__val" style="color: #16382b;">${projectedAvailable.toLocaleString()} <small style="font-size:0.75rem;">(${projectedAvailPct}%)</small></strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Runway Duration</span>
                                    <strong class="metric-modal-tile__val">~${runwayMonths.toFixed(1)} <small style="font-size:0.75rem;">mos</small></strong>
                                </div>
                            </div>
                            <div class="metric-modal-callout">
                                <strong><i class="fas fa-shield-halved" style="color:#2c5e47; margin-right:6px;"></i> Depletion Projection:</strong>
                                Open plots are estimated to decrease from <strong>${availableLots}</strong> to <strong>${projectedAvailable}</strong> plots. The table below has been switched to the Combined Timeline for direct inspection.
                            </div>
                        `;
                    }
                } else if (metric === 'runway') {
                    currentTargetSectionId = 'forecastUsageCard';

                    const alertMonth = forecast.capacity_alert?.month || 'No near-term alert';
                    const alertStatus = forecast.capacity_alert?.status || 'Safe';
                    const guidanceHeadline = forecast.operational_guidance?.headline || 'Capacity runway is stable under current burn rate.';

                    if (modalTitle) modalTitle.textContent = 'Estimated Capacity Runway & Milestones';
                    if (modalSubtitle) modalSubtitle.textContent = 'Time until cemetery space threshold and proactive replenishment windows';
                    if (modalIcon) {
                        modalIcon.style.background = '#2c5e47';
                        modalIcon.innerHTML = '<i class="fas fa-hourglass-half"></i>';
                    }
                    if (modalBody) {
                        modalBody.innerHTML = `
                            <div class="metric-modal-grid">
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Estimated Runway</span>
                                    <strong class="metric-modal-tile__val" style="color: #16382b;">~${runwayMonths.toFixed(1)} <small style="font-size:0.75rem;">Months</small></strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Alert Status</span>
                                    <strong class="metric-modal-tile__val">${alertStatus.toUpperCase()}</strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Threshold Month</span>
                                    <strong class="metric-modal-tile__val">${alertMonth}</strong>
                                </div>
                                <div class="metric-modal-tile">
                                    <span class="metric-modal-tile__label">Recommended Action</span>
                                    <strong class="metric-modal-tile__val" style="font-size:0.95rem;">${runwayMonths <= 6 ? 'Phase 2 Expansion' : 'Standard Monitoring'}</strong>
                                </div>
                            </div>
                            <div class="metric-modal-callout">
                                <strong><i class="fas fa-bolt-lightning" style="color:#2c5e47; margin-right:6px;"></i> Executive Recommendation:</strong>
                                ${guidanceHeadline}
                            </div>
                        `;
                    }
                }

                if (openDetailModal) {
                    openModal();
                }
            }

            card.addEventListener('click', () => triggerCard(true));
            card.addEventListener('keydown', (e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    triggerCard(true);
                }
            });
        });
    }

    setupInteractiveStatCards();
    document.getElementById('forecastMonths').value = '6';
    setForecastSourceStatus('Checking...', 'neutral');
    stampFooterTime();

    await renderForecast(6);
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
