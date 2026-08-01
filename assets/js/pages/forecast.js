document.addEventListener('DOMContentLoaded', async function() {
    try {
        const user = await api.getMe();
        document.getElementById('userName').innerText = user.full_name || user.username;
        document.getElementById('userRole').innerText = user.role === 'admin' ? 'Administrator' : 'Staff';
        document.getElementById('sidebarUserName').innerText = user.full_name || user.username;
        document.getElementById('sidebarUserRole').innerText = user.role === 'admin' ? 'Administrator' : 'Staff';
        if (user.role !== 'admin') {
            document.querySelectorAll('.admin-only').forEach(el => el.style.display = 'none');
        } else {
            document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'flex'; el.classList.remove('admin-only'); });
        }
    } catch (error) {
        window.location.href = 'login.html';
        return;
    }

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

    async function renderForecast(months) {
        try {
            const [forecast, occupancy] = await Promise.all([fetchForecast(months), fetchOccupancy()]);
            document.getElementById('currentOccupancy').innerText = occupancy.occupied || 0;
            const predicted = forecast.forecast?.[forecast.forecast.length - 1]?.cumulative || 0;
            document.getElementById('predictedOccupancy').innerText = predicted;
            document.getElementById('availableFuture').innerText = Math.max(0, (occupancy.total || 0) - predicted);
            document.getElementById('trendStatus').innerText = forecast.trend === 'increasing' ? '📈 Increasing' : forecast.trend === 'decreasing' ? '📉 Decreasing' : '➡️ Stable';

            const ctx = document.getElementById('forecastChart').getContext('2d');
            const historical = forecast.historical || [];
            const future = forecast.forecast || [];
            const labels = [...historical.map(item => item.month), ...future.map(item => item.month)];
            const historicalData = historical.map(item => item.burials);
            const futureData = future.map(item => item.predicted_burials);
            const combined = [...historicalData, ...futureData];
            const futureStart = historicalData.length;

            if (window.forecastChart) {
                window.forecastChart.destroy();
            }

            window.forecastChart = new Chart(ctx, {
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
                    <thead><tr><th>Month</th><th>Predicted Burials</th><th>Cumulative</th></tr></thead>
                    <tbody>${future.map(item => `<tr><td>${item.month}</td><td>${item.predicted_burials}</td><td>${item.cumulative}</td></tr>`).join('')}</tbody>
                </table>
            `;
        } catch (error) {
            alert('Failed to generate forecast: ' + error.message);
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
