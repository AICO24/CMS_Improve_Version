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

    function showTab(tab) {
        document.querySelectorAll('.tab-btn').forEach(btn => btn.classList.remove('active'));
        document.querySelectorAll('.report-content').forEach(content => content.classList.remove('active'));
        document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
        document.getElementById(`${tab}Tab`).classList.add('active');
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

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
            document.getElementById('occTotal').innerText = data.summary?.total || 0;
            document.getElementById('occOccupied').innerText = data.summary?.occupied || 0;
            document.getElementById('occAvailable').innerText = data.summary?.available || 0;
            const total = data.summary?.total || 1;
            const occupied = data.summary?.occupied || 0;
            document.getElementById('occRate').innerText = `${Math.round((occupied / total) * 100)}%`;

            const ctx = document.getElementById('occupancyChart').getContext('2d');
            const labels = (data.by_section || []).map(item => item.section_name);
            const values = (data.by_section || []).map(item => item.occupied || 0);
            new Chart(ctx, {
                type: 'bar',
                data: { labels, datasets: [{ label: 'Occupied Lots', data: values, backgroundColor: '#2c5e47' }] },
                options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });
        } catch (error) {
            console.error('Failed to load occupancy:', error);
        }
    }

    async function loadRevenue() {
        try {
            const from = document.getElementById('revDateFrom').value;
            const to = document.getElementById('revDateTo').value;
            const params = [];
            if (from) params.push(`date_from=${encodeURIComponent(from)}`);
            if (to) params.push(`date_to=${encodeURIComponent(to)}`);
            const url = `reports/revenue${params.length ? '?' + params.join('&') : ''}`;
            const data = await api.request(url, { method: 'GET' });
            document.getElementById('revTotal').innerText = `₱${parseFloat(data.total?.total || 0).toLocaleString()}`;
            document.getElementById('revCount').innerText = data.total?.count || 0;

            const monthData = await api.request(`payments/revenue-by-month?year=${new Date().getFullYear()}`, { method: 'GET' });
            const revenueCtx = document.getElementById('revenueChart').getContext('2d');
            new Chart(revenueCtx, {
                type: 'line',
                data: { labels: monthData.map(item => `Month ${item.month}`), datasets: [{ label: 'Monthly Revenue', data: monthData.map(item => item.total || 0), borderColor: '#2c5e47', fill: false }] },
                options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });

            const breakdown = data.breakdown || [];
            const labels = breakdown.map(item => item.transaction_type || 'Unknown');
            const values = breakdown.map(item => item.total || 0);
            const breakdownCtx = document.getElementById('revenueBreakdownChart').getContext('2d');
            new Chart(breakdownCtx, {
                type: 'doughnut',
                data: { labels, datasets: [{ data: values, backgroundColor: ['#2c5e47', '#7aa77a', '#d4a373', '#b5838d', '#6d6875'] }] }
            });
        } catch (error) {
            console.error('Failed to load revenue:', error);
        }
    }

    async function loadExpiration() {
        try {
            const data = await api.request('reports/expiration', { method: 'GET' });
            document.getElementById('expExpiring').innerText = data.expiring_soon?.length || 0;
            document.getElementById('expExpired').innerText = data.expired?.length || 0;

            const expiringTable = document.getElementById('expiringTableBody');
            expiringTable.innerHTML = (data.expiring_soon || []).length === 0
                ? '<tr><td colspan="5">No lots expiring soon.</td></tr>'
                : data.expiring_soon.map(lot => `
                    <tr>
                        <td>${lot.lot_number}</td>
                        <td>${lot.section_name}</td>
                        <td>${lot.block_name}</td>
                        <td>${lot.end_date}</td>
                        <td><span class="status-badge status-warning">Expiring</span></td>
                    </tr>
                `).join('');

            const expiredTable = document.getElementById('expiredTableBody');
            expiredTable.innerHTML = (data.expired || []).length === 0
                ? '<tr><td colspan="5">No expired lots.</td></tr>'
                : data.expired.map(lot => `
                    <tr>
                        <td>${lot.lot_number}</td>
                        <td>${lot.section_name}</td>
                        <td>${lot.block_name}</td>
                        <td>${lot.end_date}</td>
                        <td><span class="status-badge status-danger">Expired</span></td>
                    </tr>
                `).join('');
        } catch (error) {
            console.error('Failed to load expiration:', error);
        }
    }

    document.getElementById('applyRevenueFilter').addEventListener('click', loadRevenue);

    // Feature 12: PDF & Excel Export
    document.getElementById('exportPdfBtn').addEventListener('click', () => {
        const element = document.getElementById('reportExportContainer');
        const opt = {
            margin:       0.5,
            filename:     `Cemetery_Management_Report_${new Date().toISOString().split('T')[0]}.pdf`,
            image:        { type: 'jpeg', quality: 0.98 },
            html2canvas:  { scale: 2 },
            jsPDF:        { unit: 'in', format: 'letter', orientation: 'portrait' }
        };
        if (typeof html2pdf !== 'undefined') {
            html2pdf().set(opt).from(element).save();
        } else {
            window.print();
        }
    });

    document.getElementById('exportExcelBtn').addEventListener('click', () => {
        const wb = XLSX.utils.book_new();
        const container = document.getElementById('reportExportContainer');
        const tables = container.querySelectorAll('table');
        if (tables.length > 0) {
            tables.forEach((tbl, idx) => {
                const ws = XLSX.utils.table_to_sheet(tbl);
                XLSX.utils.book_append_sheet(wb, ws, `Report_Data_${idx + 1}`);
            });
        } else {
            const ws = XLSX.utils.html_to_sheet(container);
            XLSX.utils.book_append_sheet(wb, ws, "Report Summary");
        }
        XLSX.writeFile(wb, `Cemetery_Management_Report_${new Date().toISOString().split('T')[0]}.xlsx`);
    });

    document.getElementById('revDateFrom').value = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
    document.getElementById('revDateTo').value = new Date().toISOString().split('T')[0];

    showTab('occupancy');
    await loadOccupancy();
    await loadRevenue();
    await loadExpiration();
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
