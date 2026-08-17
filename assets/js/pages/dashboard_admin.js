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
        let availableLotList = [];
        try {
            availableLotList = await api.request('lots?status=Available', { method: 'GET' });
        } catch (e) {
            availableLotList = [];
        }

        const summary = occupancy.summary || {};
        const totalLots = Number(summary.total) || 0;
        const availableLots = Number(summary.available) || 0;
        const occupiedLots = Number(summary.occupied) || 0;

        setText('statTotal', totalLots.toString());
        setText('statAvailable', availableLots.toString());
        setText('statRevenue', formatCurrency(Number(revenueSummary.total) || 0));
        setText('statForecast', totalLots > 0 ? `${Math.round((availableLots / totalLots) * 100)}% available` : 'No data');

        const suggestedLot = Array.isArray(availableLotList) ? availableLotList[0] : null;
        setText('aiLot', suggestedLot ? `Lot ${suggestedLot.lot_number}${suggestedLot.section_name ? ' — ' + suggestedLot.section_name : ''}` : 'No available lots');
        setText('aiNote', totalLots > 0 ? `${Math.round((occupiedLots / totalLots) * 100)}% of lots are currently occupied.` : 'No occupancy data available.');

        const mapContainer = document.getElementById('availabilityMap');
        if (mapContainer) {
            mapContainer.innerHTML = '';
            if (Array.isArray(occupancy.by_section) && occupancy.by_section.length > 0) {
                occupancy.by_section.forEach(section => {
                    const sectionTotal = Number(section.total) || 0;
                    const sectionOccupied = Number(section.occupied) || 0;
                    const fillPercent = sectionTotal > 0 ? Math.round((sectionOccupied / sectionTotal) * 100) : 0;
                    const sectionItem = document.createElement('div');
                    sectionItem.style.marginBottom = '14px';
                    sectionItem.innerHTML = `
                        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                            <strong>${section.section_name || 'Section'}</strong>
                            <span>${sectionOccupied}/${sectionTotal} occupied</span>
                        </div>
                        <div style="height:12px;background:#e5e7eb;border-radius:999px;overflow:hidden;">
                            <div style="width:${fillPercent}%;height:100%;background:linear-gradient(90deg, #4f46e5, #38bdf8);"></div>
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
                    item.style.padding = '12px 16px';
                    item.style.borderRadius = '12px';
                    item.style.background = '#ffffff';
                    item.style.marginBottom = '10px';
                    item.style.boxShadow = '0 1px 4px rgba(0, 0, 0, 0.05)';
                    item.innerHTML = `
                        <div style="font-weight:600;">${formatTransactionLabel(payment)}</div>
                        <div style="font-size:0.95rem;color:#6b7280;margin:6px 0;">${payment.receipt_number || 'No receipt'} · ${payment.payment_date || 'Unknown date'}</div>
                        <div style="font-weight:700;color:#111827;">${formatCurrency(payment.amount)}</div>
                    `;
                    recentList.appendChild(item);
                });
            } else {
                const emptyItem = document.createElement('li');
                emptyItem.className = 'recent-item empty';
                emptyItem.textContent = 'No recent transactions available.';
                emptyItem.style.padding = '12px 16px';
                emptyItem.style.borderRadius = '12px';
                emptyItem.style.background = '#ffffff';
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
                        backgroundColor: 'rgba(54, 162, 235, 0.5)',
                        borderColor: 'rgba(54, 162, 235, 1)',
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
