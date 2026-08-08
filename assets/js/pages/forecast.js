document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    let chartInstance = null;

    document.getElementById('logoutBtn').addEventListener('click', () => api.logout());

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                badge.innerText = result.count || 0;
                badge.style.display = result.count > 0 ? 'flex' : 'none';
            }
        } catch (e) {
            console.error('Failed to load notification count:', e);
        }
    }

    async function fetchForecast(months = 6) {
        return await api.request(`ai/forecast?months=${months}`, { method: 'GET' });
    }

    async function fetchOccupancy() {
        const data = await api.request('reports/occupancy', { method: 'GET' });
        return data.summary || { total: 0, occupied: 0, available: 0 };
    }

    function trendBadge(trend) {
        if (trend === 'increasing') return '<span class="status-badge status-warning">📈 Increasing</span>';
        if (trend === 'decreasing') return '<span class="status-badge status-success">📉 Decreasing</span>';
        return '<span class="status-badge status-neutral">➡️ Stable</span>';
    }

    function capacityBadge(status) {
        if (status === 'critical') return '<span class="status-badge status-danger">Critical</span>';
        if (status === 'warning') return '<span class="status-badge status-warning">Warning</span>';
        return '<span class="status-badge status-success">OK</span>';
    }

    function showBanner(id, level, message) {
        const el = document.getElementById(id);
        el.textContent = message;
        el.className = `service-banner visible ${level}`;
    }

    function hideBanner(id) {
        const el = document.getElementById(id);
        el.textContent = '';
        el.className = 'service-banner';
    }

    function resetStats() {
        document.getElementById('currentOccupancy').innerText = '-';
        document.getElementById('predictedOccupancy').innerText = '-';
        document.getElementById('availableFuture').innerText = '-';
        document.getElementById('trendStatus').innerHTML = '—';
        if (chartInstance) {
            chartInstance.destroy();
            chartInstance = null;
        }
        document.getElementById('forecastDetails').innerHTML = '';
    }

    async function renderForecast(months) {
        hideBanner('serviceBanner');
        hideBanner('capacityBanner');
        try {
            const [forecast, occupancy] = await Promise.all([fetchForecast(months), fetchOccupancy()]);

            if (forecast.fallback) {
                resetStats();
                showBanner('serviceBanner', 'danger', `AI forecasting service is unavailable${forecast.message ? ': ' + forecast.message : ''}. Start the python-ai service and try again.`);
                return;
            }

            document.getElementById('currentOccupancy').innerText = occupancy.occupied || 0;
            const lastEntry = forecast.forecast?.[forecast.forecast.length - 1] || null;
            const predicted = lastEntry?.cumulative || 0;
            document.getElementById('predictedOccupancy').innerText = predicted;
            const availableFuture = lastEntry ? lastEntry.projected_available : Math.max(0, (occupancy.total || 0) - predicted);
            document.getElementById('availableFuture').innerText = availableFuture;
            document.getElementById('trendStatus').innerHTML = trendBadge(forecast.trend);

            if (forecast.capacity_alert) {
                const level = forecast.capacity_alert.status === 'critical' ? 'danger' : 'warning';
                const percent = Math.round((forecast.capacity_alert.occupancy_rate || 0) * 100);
                showBanner('capacityBanner', level, `Projected occupancy is expected to reach ${forecast.capacity_alert.status.toUpperCase()} level (${percent}%) by ${forecast.capacity_alert.month}.`);
            }

            const ctx = document.getElementById('forecastChart').getContext('2d');
            const historical = forecast.historical || [];
            const future = forecast.forecast || [];
            const labels = [...historical.map(item => item.month), ...future.map(item => item.month)];
            const historicalData = historical.map(item => item.burials);
            const futureData = future.map(item => item.predicted_burials);
            const combined = [...historicalData, ...futureData];
            const futureStart = historicalData.length;

            if (chartInstance) {
                chartInstance.destroy();
            }

            chartInstance = new Chart(ctx, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        { label: 'Historical', data: combined.map((value, index) => index < futureStart ? value : null), borderColor: '#2c5e47', fill: false },
                        { label: 'Forecast', data: combined.map((value, index) => index >= futureStart ? value : null), borderColor: '#d4a373', borderDash: [5, 5], fill: false }
                    ]
                },
                options: { plugins: { legend: { position: 'top' } }, scales: { y: { beginAtZero: true } } }
            });

            document.getElementById('forecastDetails').innerHTML = `
                <table class="data-table">
                    <thead><tr><th>Month</th><th>Predicted Burials</th><th>Cumulative</th><th>Reclaimable</th><th>Projected Available</th><th>Capacity Status</th></tr></thead>
                    <tbody>${future.map(item => `<tr><td>${item.month}</td><td>${item.predicted_burials}</td><td>${item.cumulative}</td><td>${item.reclaimable ?? 0}</td><td>${item.projected_available ?? '-'}</td><td>${capacityBadge(item.capacity_status)}</td></tr>`).join('')}</tbody>
                </table>
            `;
        } catch (error) {
            resetStats();
            showBanner('serviceBanner', 'danger', 'Failed to generate forecast: ' + error.message);
        }
    }

    document.getElementById('generateForecast').addEventListener('click', async () => {
        const months = parseInt(document.getElementById('forecastMonths').value, 10);
        await renderForecast(months);
    });

    document.getElementById('forecastMonths').value = '6';
    await renderForecast(6);
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
