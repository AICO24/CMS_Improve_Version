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
        document.querySelector(`.tab-btn[data-tab="${tab}"]`).classList.add('active');
        document.getElementById(`${tab}Tab`).classList.add('active');
    }

    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => showTab(btn.dataset.tab));
    });

    let revenueMonthChart = null;
    let revenueBreakdownChartInstance = null;
    let verificationBreakdownChartInstance = null;
    let revenueByMethodChartInstance = null;
    let reservationsChartInstance = null;
    let demographicsChartInstance = null;
    const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

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

            const blockCtx = document.getElementById('occupancyByBlockChart').getContext('2d');
            new Chart(blockCtx, {
                type: 'bar',
                data: {
                    labels: (data.by_block || []).map(item => `${item.block_name} (${item.section_name})`),
                    datasets: [{ label: 'Occupied Lots', data: (data.by_block || []).map(item => item.occupied || 0), backgroundColor: '#7aa77a' }]
                },
                options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
            });

            const typeCtx = document.getElementById('occupancyByTypeChart').getContext('2d');
            new Chart(typeCtx, {
                type: 'bar',
                data: {
                    labels: (data.by_lot_type || []).map(item => item.type_name),
                    datasets: [{ label: 'Occupied Lots', data: (data.by_lot_type || []).map(item => item.occupied || 0), backgroundColor: '#d4a373' }]
                },
                options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
            });

            const trend = await api.request('reports/occupancy-trend?months=12', { method: 'GET' });
            const trendNote = document.getElementById('occupancyTrendNote');
            trendNote.textContent = trend.length < 2
                ? 'History is captured automatically each time this page is viewed — check back over the coming weeks to see a trend build up.'
                : '';
            const trendCtx = document.getElementById('occupancyTrendChart').getContext('2d');
            new Chart(trendCtx, {
                type: 'line',
                data: {
                    labels: trend.map(item => item.snapshot_date),
                    datasets: [{ label: 'Occupied Lots', data: trend.map(item => item.occupied || 0), borderColor: '#4f46e5', fill: false }]
                },
                options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
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

            // Follow the selected date range instead of always showing the current
            // calendar year, so the monthly trend actually reflects the filter above.
            const monthYear = (to || from) ? new Date(to || from).getFullYear() : new Date().getFullYear();
            const monthData = await api.request(`payments/revenue-by-month?year=${monthYear}`, { method: 'GET' });
            const revenueCtx = document.getElementById('revenueChart').getContext('2d');
            if (revenueMonthChart) revenueMonthChart.destroy();
            revenueMonthChart = new Chart(revenueCtx, {
                type: 'line',
                data: { labels: monthData.map(item => `${MONTH_NAMES[item.month - 1]} ${monthYear}`), datasets: [{ label: 'Monthly Revenue', data: monthData.map(item => item.total || 0), borderColor: '#2c5e47', fill: false }] },
                options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });

            const breakdown = data.breakdown || [];
            const labels = breakdown.map(item => item.transaction_type || 'Unknown');
            const values = breakdown.map(item => item.total || 0);
            const breakdownCtx = document.getElementById('revenueBreakdownChart').getContext('2d');
            if (revenueBreakdownChartInstance) revenueBreakdownChartInstance.destroy();
            revenueBreakdownChartInstance = new Chart(breakdownCtx, {
                type: 'doughnut',
                data: { labels, datasets: [{ data: values, backgroundColor: ['#2c5e47', '#7aa77a', '#d4a373', '#b5838d', '#6d6875'] }] }
            });

            const verificationBreakdown = await api.request(`payments/verification-breakdown${params.length ? '?' + params.join('&') : ''}`, { method: 'GET' });
            const pending = verificationBreakdown.find(item => item.verification_status === 'Pending');
            document.getElementById('revPendingCount').innerText = pending?.count || 0;
            document.getElementById('revPendingAmount').innerText = `₱${parseFloat(pending?.total || 0).toLocaleString()} pending`;

            const verificationCtx = document.getElementById('verificationBreakdownChart').getContext('2d');
            if (verificationBreakdownChartInstance) verificationBreakdownChartInstance.destroy();
            const verificationColors = { Pending: '#d4a373', Verified: '#2c5e47', Rejected: '#b5838d' };
            verificationBreakdownChartInstance = new Chart(verificationCtx, {
                type: 'doughnut',
                data: {
                    labels: verificationBreakdown.map(item => item.verification_status),
                    datasets: [{ data: verificationBreakdown.map(item => item.total || 0), backgroundColor: verificationBreakdown.map(item => verificationColors[item.verification_status] || '#6d6875') }]
                }
            });

            const methodBreakdown = await api.request(`payments/revenue-by-method${params.length ? '?' + params.join('&') : ''}`, { method: 'GET' });
            const methodCtx = document.getElementById('revenueByMethodChart').getContext('2d');
            if (revenueByMethodChartInstance) revenueByMethodChartInstance.destroy();
            revenueByMethodChartInstance = new Chart(methodCtx, {
                type: 'bar',
                data: {
                    labels: methodBreakdown.map(item => item.payment_method),
                    datasets: [{ label: 'Revenue', data: methodBreakdown.map(item => item.total || 0), backgroundColor: '#6d6875' }]
                },
                options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
            });
        } catch (error) {
            console.error('Failed to load revenue:', error);
        }
    }

    async function loadReservations() {
        try {
            const data = await api.request(`schedules/stats?year=${new Date().getFullYear()}`, { method: 'GET' });
            document.getElementById('resTotal').innerText = data.total || 0;
            document.getElementById('resPending').innerText = data.pending || 0;
            document.getElementById('resConfirmed').innerText = data.confirmed || 0;
            document.getElementById('resCompleted').innerText = data.completed || 0;
            document.getElementById('resCancelled').innerText = data.cancelled || 0;
            document.getElementById('resConfirmationRate').innerText = `${data.confirmation_rate || 0}%`;
            document.getElementById('resCancellationRate').innerText = `${data.cancellation_rate || 0}%`;

            const byMonth = data.by_month || [];
            const counts = new Array(12).fill(0);
            byMonth.forEach(item => {
                const idx = Number(item.month) - 1;
                if (idx >= 0 && idx < 12) counts[idx] = Number(item.count) || 0;
            });

            const reservationsCtx = document.getElementById('reservationsChart').getContext('2d');
            if (reservationsChartInstance) reservationsChartInstance.destroy();
            reservationsChartInstance = new Chart(reservationsCtx, {
                type: 'bar',
                data: { labels: MONTH_NAMES, datasets: [{ label: 'Reservations', data: counts, backgroundColor: '#4f46e5' }] },
                options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { precision: 0 } } } }
            });
        } catch (error) {
            console.error('Failed to load reservations:', error);
        }
    }

    async function loadDemographics() {
        try {
            const data = await api.request('decedents/stats', { method: 'GET' });
            document.getElementById('demoTotal').innerText = data.total || 0;
            document.getElementById('demoBurials').innerText = data.burials || 0;
            document.getElementById('demoCremations').innerText = data.cremations || 0;
            document.getElementById('demoAvgAge').innerText = data.avg_age || 0;

            const demoCtx = document.getElementById('demographicsChart').getContext('2d');
            if (demographicsChartInstance) demographicsChartInstance.destroy();
            demographicsChartInstance = new Chart(demoCtx, {
                type: 'doughnut',
                data: {
                    labels: ['Burials', 'Cremations'],
                    datasets: [{ data: [data.burials || 0, data.cremations || 0], backgroundColor: ['#2c5e47', '#d4a373'] }]
                }
            });
        } catch (error) {
            console.error('Failed to load demographics:', error);
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

    document.getElementById('applyRevenueFilter').addEventListener('click', () => {
        loadRevenue();
        pdfToggle.reset();
        excelToggle.reset();
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

    function getActiveTabLabel() {
        const btn = document.querySelector('.tab-btn.active');
        return btn ? btn.textContent.trim() : 'Report';
    }

    async function generatePdfExport() {
        const element = getActiveReportTab();
        const filename = `Cemetery_Management_${getActiveTabLabel()}_Report_${new Date().toISOString().split('T')[0]}.pdf`;
        if (typeof html2pdf === 'undefined') {
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
        const blob = await html2pdf().set(opt).from(element).outputPdf('blob');
        const url = URL.createObjectURL(blob);
        triggerFileDownload(url, filename);
        return { url, filename };
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
            const ws = buildStatSheet(container);
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
            if (myGeneration !== generation) return; // superseded by a reset() meanwhile
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
            // state === 'idle': let the native check happen, then generate on
            // the next tick so we don't touch `disabled` mid-click (doing so
            // before the browser applies this same click's default action can
            // suppress that action in some engines).
            setTimeout(runGeneration, 0);
        });

        return {
            reset() {
                generation++; // invalidate any in-flight runGeneration
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

    document.getElementById('revDateFrom').value = new Date(new Date().setMonth(new Date().getMonth() - 1)).toISOString().split('T')[0];
    document.getElementById('revDateTo').value = new Date().toISOString().split('T')[0];

    showTab('occupancy');
    await loadOccupancy();
    await loadRevenue();
    await loadReservations();
    await loadDemographics();
    await loadExpiration();
    updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
