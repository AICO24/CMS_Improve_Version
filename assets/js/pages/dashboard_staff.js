document.addEventListener('DOMContentLoaded', async function() {
    const logoutBtn = document.getElementById('logoutBtn');
    const pageTitle = document.getElementById('pageTitle');
    const sidebarUserName = document.getElementById('sidebarUserName');
    const sidebarUserRole = document.getElementById('sidebarUserRole');
    const userName = document.getElementById('userName');
    const userRole = document.getElementById('userRole');

    function setText(id, text) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    function formatCurrency(value) {
        const amount = Number(value) || 0;
        return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(amount);
    }

    function getMonthName(monthNumber) {
        const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        return monthNames[monthNumber - 1] || 'Unknown';
    }

    function redirectToLogin() {
        const currentPath = window.location.pathname || '';
        const prefix = currentPath.includes('/frontend/')
            ? currentPath.split('/frontend/')[0] + '/frontend'
            : '/CMS/frontend';
        window.location.href = `${window.location.origin}${prefix}/auth/login.html`;
    }

    const toggleBtn = document.getElementById("toggleSidebar");
    const sidebar = document.querySelector(".sidebar");

    toggleBtn.addEventListener("change", () => {
        sidebar.classList.toggle("collapsed");
    });

    logoutBtn?.addEventListener('click', () => api.logout());

    try {
        const user = await api.getMe();
        if (!user || !user.user_id) {
            redirectToLogin();
            return;
        }

        setText('sidebarUserName', user.full_name || user.username || 'User');
        setText('sidebarUserRole', user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Staff');
        setText('userName', user.full_name || user.username || 'User');
        setText('userRole', user.role ? user.role.charAt(0).toUpperCase() + user.role.slice(1) : 'Staff');
        if (pageTitle) pageTitle.textContent = 'Staff Dashboard';

        const occupancy = await api.request('reports/occupancy', { method: 'GET' });
        const revenueSummary = await api.request('payments/revenue', { method: 'GET' });
        const revenueByMonth = await api.request(`payments/revenue-by-month?year=${new Date().getFullYear()}`, { method: 'GET' });
        let payments = await api.request(`payments?date_from=${new Date(new Date().setMonth(new Date().getMonth() - 3)).toISOString().slice(0, 10)}&date_to=${new Date().toISOString().slice(0, 10)}`, { method: 'GET' });
        if (!Array.isArray(payments) || payments.length === 0) {
            payments = await api.request('payments', { method: 'GET' });
        }

        const summary = occupancy.summary || {};
        const totalLots = Number(summary.total) || 0;
        const availableLots = Number(summary.available) || 0;
        const occupiedLots = Number(summary.occupied) || 0;

        setText('statTotal', totalLots.toString());
        setText('statAvailable', availableLots.toString());
        setText('statRevenue', formatCurrency(Number(revenueSummary.total) || 0));
        setText('statForecast', totalLots > 0 ? `${Math.round((availableLots / totalLots) * 100)}% available` : 'No data');

        setText('aiLot', availableLots > 0 ? `Lot B-156` : 'No available lots');
        setText('aiNote', totalLots > 0 ? `Current occupancy is ${Math.round((occupiedLots / totalLots) * 100)}% and demand is rising.` : 'No occupancy data available.');

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
                        backgroundColor: 'rgba(75, 192, 192, 0.5)',
                        borderColor: 'rgba(75, 192, 192, 1)',
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
