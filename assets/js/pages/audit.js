document.addEventListener('DOMContentLoaded', async function() {
    try {
        const user = await api.getMe();
        if (!user || user.role !== 'admin') {
            window.location.href = `${getFrontendBasePath()}/admin/dashboard.html`;
            return;
        }
        document.getElementById('userName').innerText = user.full_name || user.username;
        document.getElementById('userRole').innerText = 'Administrator';
        document.getElementById('sidebarUserName').innerText = user.full_name || user.username;
        document.getElementById('sidebarUserRole').innerText = 'Administrator';
        document.querySelectorAll('.admin-only').forEach(el => { el.style.display = 'flex'; el.classList.remove('admin-only'); });
    } catch (error) {
        window.location.href = `${getFrontendBasePath()}/auth/login.html`;
        return;
    }

    const tbody = document.getElementById('auditTableBody');
    const searchInput = document.getElementById('searchLogs');
    const refreshBtn = document.getElementById('refreshAuditBtn');
    let allLogs = [];

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    async function loadAuditLogs() {
        tbody.innerHTML = '<tr><td colspan="6">Loading audit logs...</td></tr>';
        try {
            allLogs = await api.request('audit-logs', { method: 'GET' });
            renderLogs(allLogs);
        } catch (err) {
            tbody.innerHTML = `<tr><td colspan="6" class="audit-error">Failed to load logs: ${err.message}</td></tr>`;
        }
    }

    function renderLogs(logs) {
        if (!logs || logs.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No audit records found.</td></tr>';
            return;
        }

        const query = searchInput.value.toLowerCase().trim();
        const filtered = logs.filter(l => {
            if (!query) return true;
            return (l.action && l.action.toLowerCase().includes(query)) ||
                   (l.username && l.username.toLowerCase().includes(query)) ||
                   (l.user_full_name && l.user_full_name.toLowerCase().includes(query)) ||
                   (l.entity_type && l.entity_type.toLowerCase().includes(query));
        });

        if (filtered.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No logs matching search query.</td></tr>';
            return;
        }

        tbody.innerHTML = filtered.map(l => `
            <tr>
                <td><small>${l.created_at || '—'}</small></td>
                <td><strong>${l.user_full_name || l.username || 'System'}</strong></td>
                <td><span class="action-badge">${l.action}</span></td>
                <td>${l.entity_type ? `${l.entity_type} #${l.entity_id || ''}` : '—'}</td>
                <td><code>${l.ip_address || '127.0.0.1'}</code></td>
                <td><small class="muted">${l.details || '—'}</small></td>
            </tr>
        `).join('');
    }

    searchInput.addEventListener('input', () => renderLogs(allLogs));
    refreshBtn.addEventListener('click', loadAuditLogs);

    await loadAuditLogs();
});
