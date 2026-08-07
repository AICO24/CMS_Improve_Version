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

    async function fetchAIParameters(module = '') {
        const params = module ? `?module=${encodeURIComponent(module)}` : '';
        return await api.request(`ai/parameters${params}`, { method: 'GET' });
    }

    async function checkServiceHealth() {
        try {
            const result = await api.request('ai/health', { method: 'GET' });
            return result;
        } catch (error) {
            return { status: 'offline', error: error.message };
        }
    }

    function renderParameters(parameters) {
        const tbody = document.getElementById('aiParametersBody');
        if (!Array.isArray(parameters) || parameters.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No AI parameters found.</td></tr>';
            return;
        }
        const modules = new Set();
        const rows = parameters.map(param => {
            modules.add(param.module || 'default');
            return `
                <tr>
                    <td>${param.module || 'default'}</td>
                    <td>${param.param_name}</td>
                    <td><input type="text" class="param-value" data-id="${param.parameter_id}" value="${param.param_value || ''}" /></td>
                    <td>${param.param_type || 'string'}</td>
                    <td><input type="text" class="param-desc" data-id="${param.parameter_id}" value="${param.description || ''}" /></td>
                    <td><button class="btn btn-small btn-primary update-param" data-id="${param.parameter_id}">Update</button></td>
                </tr>
            `;
        }).join('');
        tbody.innerHTML = rows;
        document.getElementById('parameterCount').innerText = parameters.length;

        const moduleFilter = document.getElementById('moduleFilter');
        const existing = Array.from(moduleFilter.options).map(o => o.value);
        Array.from(modules).sort().forEach(module => {
            if (!existing.includes(module)) {
                const option = document.createElement('option');
                option.value = module;
                option.textContent = module;
                moduleFilter.appendChild(option);
            }
        });
    }

    async function refreshParameters() {
        const module = document.getElementById('moduleFilter').value;
        const response = await fetchAIParameters(module);
        renderParameters(response);
    }

    async function updateParameter(id, paramValue, description) {
        try {
            const result = await api.request(`ai/parameters/${id}`, {
                method: 'PUT',
                body: { param_value: paramValue, description },
            });
            if (result.success) {
                showMessage('Parameter updated successfully.', 'success');
                await refreshParameters();
            } else {
                showMessage(result.error || 'Failed to update parameter.', 'error');
            }
        } catch (error) {
            showMessage(error.message, 'error');
        }
    }

    function showMessage(message, type = 'info') {
        const messageBox = document.getElementById('aiMessage');
        messageBox.innerText = message;
        messageBox.className = `ai-message ${type}`;
        setTimeout(() => {
            messageBox.innerText = '';
            messageBox.className = 'ai-message';
        }, 4500);
    }

    document.getElementById('moduleFilter').addEventListener('change', refreshParameters);
    document.getElementById('refreshParams').addEventListener('click', async () => {
        document.getElementById('lastRefresh').innerText = new Date().toLocaleString();
        await refreshParameters();
    });

    document.getElementById('aiParametersBody').addEventListener('click', async event => {
        const button = event.target.closest('.update-param');
        if (!button) return;
        const id = button.dataset.id;
        const value = document.querySelector(`.param-value[data-id="${id}"]`).value;
        const description = document.querySelector(`.param-desc[data-id="${id}"]`).value;
        await updateParameter(id, value, description);
    });

    const health = await checkServiceHealth();
    document.getElementById('healthStatus').innerText = health.status === 'ok' ? 'Online' : 'Offline';
    document.getElementById('serviceHealth').innerText = health.status === 'ok' ? 'AI service is available and responding.' : `Service offline: ${health.error || 'unexpected response'}`;
    document.getElementById('lastRefresh').innerText = new Date().toLocaleString();
    await refreshParameters();
    setInterval(async () => {
        const updatedHealth = await checkServiceHealth();
        document.getElementById('healthStatus').innerText = updatedHealth.status === 'ok' ? 'Online' : 'Offline';
        document.getElementById('serviceHealth').innerText = updatedHealth.status === 'ok' ? 'AI service is available and responding.' : `Service offline: ${updatedHealth.error || 'unexpected response'}`;
        document.getElementById('lastRefresh').innerText = new Date().toLocaleString();
    }, 30000);
});