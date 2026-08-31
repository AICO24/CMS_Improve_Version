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

    // System-Wide AI Assistant (Phase 9): this was the one page in the
    // app that never mounted it, despite being the page named for AI —
    // an admin looking for "talk to the AI" here found nothing.
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'system' },
        greeting: "Hello! I'm your AI assistant for the whole system. How can I help you today?",
        suggestions: [
            { icon: 'fa-robot', label: 'Automation activity', question: 'How much of the recent activity was handled automatically?' },
            { icon: 'fa-triangle-exclamation', label: 'What needs attention?', question: 'What currently needs my attention across the whole system?' },
            { icon: 'fa-book', label: 'Explain the knowledge base', question: 'What is the assistant knowledge base used for?' },
            { icon: 'fa-list-check', label: 'Open exceptions', question: 'Are there any open exceptions I should review right now?' },
        ],
    });

    // Quota-reduction batch: same cache dashboard_admin.js writes/reads
    // (same key, same 5-minute TTL) — visiting this page shortly after the
    // Dashboard reuses that result instead of costing a second Gemini call
    // for near-identical content. Read-through only — an explicit Refresh
    // click always bypasses the cache and re-fetches.
    const AI_DIGEST_CACHE_KEY = 'ai_dashboard_digest_cache';
    const AI_DIGEST_CACHE_TTL_MS = 5 * 60 * 1000;

    function readAiDigestCache() {
        try {
            const raw = sessionStorage.getItem(AI_DIGEST_CACHE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed.timestamp !== 'number' || !parsed.data) return null;
            if (Date.now() - parsed.timestamp > AI_DIGEST_CACHE_TTL_MS) return null;
            return parsed.data;
        } catch (e) {
            return null;
        }
    }

    function writeAiDigestCache(data) {
        try {
            sessionStorage.setItem(AI_DIGEST_CACHE_KEY, JSON.stringify({ timestamp: Date.now(), data }));
        } catch (e) {
            // sessionStorage unavailable/full — caching is best-effort only.
        }
    }

    // Today's Briefing (Phase 9): same ai/dashboard-digest endpoint the
    // Dashboard's AI Briefing card already uses — reused here, not
    // duplicated server-side, so this page finally shows *something*
    // the AI/automation engine has actually been doing today instead of
    // leading with a settings table that (per the notice below it)
    // doesn't affect runtime behavior at all.
    async function loadDigest(forceRefresh = false) {
        const digestText = document.getElementById('aiDigestText');
        const refreshBtn = document.getElementById('refreshDigestBtn');
        if (!digestText) return;

        function render(result) {
            digestText.textContent = (result && result.explained && result.message)
                ? result.message
                : 'AI briefing is unavailable right now — check the Needs Attention card and Exceptions page directly.';
        }

        if (!forceRefresh) {
            const cached = readAiDigestCache();
            if (cached) {
                render(cached);
                if (refreshBtn) {
                    refreshBtn.onclick = async () => {
                        refreshBtn.disabled = true;
                        try {
                            await loadDigest(true);
                        } finally {
                            refreshBtn.disabled = false;
                        }
                    };
                }
                return;
            }
        }

        digestText.textContent = 'Loading today\'s briefing…';
        try {
            const result = await api.request('ai/dashboard-digest', { method: 'GET' });
            writeAiDigestCache(result);
            render(result);
        } catch (error) {
            render(null);
        }
        if (refreshBtn) {
            refreshBtn.onclick = async () => {
                refreshBtn.disabled = true;
                try {
                    await loadDigest(true);
                } finally {
                    refreshBtn.disabled = false;
                }
            };
        }
    }

    // Needs Attention (Phase 9): same exceptions?status=open endpoint
    // the Dashboard's attention card uses, but unlike that card (which
    // hides itself entirely when there's nothing open), this one always
    // shows a state — "all clear" is itself useful information on the
    // one page meant to answer "what is AI/automation doing right now".
    async function loadAttention() {
        const card = document.getElementById('aiAttentionCard');
        const text = document.getElementById('aiAttentionText');
        const link = document.getElementById('aiAttentionLink');
        if (!card || !text || !link) return;
        try {
            const exceptions = await api.request('exceptions?status=open', { method: 'GET' });
            const count = Array.isArray(exceptions) ? exceptions.length : 0;
            if (count > 0) {
                text.textContent = `${count} item${count === 1 ? '' : 's'} couldn't be handled automatically and need${count === 1 ? 's' : ''} your review.`;
                link.style.display = '';
                card.classList.add('has-open');
            } else {
                text.textContent = 'Nothing needs attention — normal transactions are confirming automatically.';
                link.style.display = 'none';
                card.classList.remove('has-open');
            }
        } catch (error) {
            text.textContent = 'Unable to check open exceptions right now.';
            link.style.display = 'none';
        }
    }

    loadDigest();
    loadAttention();

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

    function applyHealthState(health) {
        const isOnline = health.status === 'ok';
        document.getElementById('healthStatus').innerHTML = `<span class="status-badge ${isOnline ? 'status-success' : 'status-danger'}">${isOnline ? 'Online' : 'Offline'}</span>`;
        const serviceHealthEl = document.getElementById('serviceHealth');
        serviceHealthEl.innerText = isOnline ? 'AI service is available and responding.' : `Service offline: ${health.error || 'unexpected response'}`;
        serviceHealthEl.classList.toggle('is-online', isOnline);
        serviceHealthEl.classList.toggle('is-offline', !isOnline);
        document.getElementById('lastRefresh').innerText = new Date().toLocaleString();
    }

    applyHealthState(await checkServiceHealth());
    await refreshParameters();
    setInterval(async () => {
        applyHealthState(await checkServiceHealth());
    }, 30000);

    // Assistant knowledge base: the content ai/chat answers general
    // burial-scheduling questions from. Same list+inline-edit pattern as the
    // parameters table above, plus create/delete since staff should be able
    // to add a new FAQ topic without a code change.
    function showKnowledgeMessage(message, type = 'info') {
        const messageBox = document.getElementById('aiKnowledgeMessage');
        messageBox.innerText = message;
        messageBox.className = `ai-message ${type}`;
        setTimeout(() => {
            messageBox.innerText = '';
            messageBox.className = 'ai-message';
        }, 4500);
    }

    // Unlike the single-line param values on the table above, knowledge
    // content is free-text/multi-line and far more likely to contain
    // quotes/angle brackets — escape before interpolating into the
    // attribute value / textarea body, or a stray `"` or `</textarea>` in
    // someone's draft policy text would break the row markup.
    function escapeHtml(value) {
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    }

    function knowledgeRowHtml(entry) {
        const id = entry.knowledge_id;
        return `
            <tr data-id="${id}">
                <td><input type="text" class="knowledge-topic" data-id="${id}" value="${escapeHtml(entry.topic)}" /></td>
                <td><textarea class="knowledge-content" data-id="${id}">${escapeHtml(entry.content)}</textarea></td>
                <td>
                    <div class="knowledge-actions">
                        <button class="btn btn-small btn-primary update-knowledge" data-id="${id}">Update</button>
                        <button class="btn-delete-row delete-knowledge" data-id="${id}" title="Delete"><i class="fas fa-trash"></i></button>
                    </div>
                </td>
            </tr>
        `;
    }

    function newKnowledgeRowHtml() {
        return `
            <tr data-id="new">
                <td><input type="text" class="knowledge-topic" data-id="new" placeholder="topic_slug" /></td>
                <td><textarea class="knowledge-content" data-id="new" placeholder="Content the assistant may answer with..."></textarea></td>
                <td>
                    <div class="knowledge-actions">
                        <button class="btn btn-small btn-primary create-knowledge">Create</button>
                        <button class="btn btn-small btn-secondary cancel-knowledge">Cancel</button>
                    </div>
                </td>
            </tr>
        `;
    }

    async function fetchKnowledge() {
        return await api.request('ai/knowledge', { method: 'GET' });
    }

    function renderKnowledge(entries) {
        const tbody = document.getElementById('aiKnowledgeBody');
        if (!Array.isArray(entries) || entries.length === 0) {
            tbody.innerHTML = '<tr><td colspan="3">No knowledge base topics yet.</td></tr>';
            return;
        }
        tbody.innerHTML = entries.map(knowledgeRowHtml).join('');
    }

    async function refreshKnowledge() {
        const entries = await fetchKnowledge();
        renderKnowledge(entries);
    }

    document.getElementById('addKnowledgeBtn').addEventListener('click', () => {
        const tbody = document.getElementById('aiKnowledgeBody');
        if (tbody.querySelector('[data-id="new"]')) return;
        if (tbody.querySelector('td[colspan]')) tbody.innerHTML = '';
        tbody.insertAdjacentHTML('afterbegin', newKnowledgeRowHtml());
    });

    document.getElementById('aiKnowledgeBody').addEventListener('click', async event => {
        const updateBtn = event.target.closest('.update-knowledge');
        const deleteBtn = event.target.closest('.delete-knowledge');
        const createBtn = event.target.closest('.create-knowledge');
        const cancelBtn = event.target.closest('.cancel-knowledge');

        if (updateBtn) {
            const id = updateBtn.dataset.id;
            const topic = document.querySelector(`.knowledge-topic[data-id="${id}"]`).value.trim();
            const content = document.querySelector(`.knowledge-content[data-id="${id}"]`).value.trim();
            if (!topic || !content) {
                showKnowledgeMessage('Topic and content are both required.', 'error');
                return;
            }
            try {
                const result = await api.request(`ai/knowledge/${id}`, { method: 'PUT', body: { topic, content } });
                if (result.success) {
                    showKnowledgeMessage('Knowledge entry updated.', 'success');
                    await refreshKnowledge();
                } else {
                    showKnowledgeMessage(result.error || 'Failed to update knowledge entry.', 'error');
                }
            } catch (error) {
                showKnowledgeMessage(error.message, 'error');
            }
        } else if (deleteBtn) {
            const id = deleteBtn.dataset.id;
            if (!confirm('Delete this knowledge base topic? The assistant will no longer be able to answer questions about it.')) return;
            try {
                const result = await api.request(`ai/knowledge/${id}`, { method: 'DELETE' });
                if (result.success) {
                    showKnowledgeMessage('Knowledge entry deleted.', 'success');
                    await refreshKnowledge();
                } else {
                    showKnowledgeMessage(result.error || 'Failed to delete knowledge entry.', 'error');
                }
            } catch (error) {
                showKnowledgeMessage(error.message, 'error');
            }
        } else if (createBtn) {
            const topic = document.querySelector('.knowledge-topic[data-id="new"]').value.trim();
            const content = document.querySelector('.knowledge-content[data-id="new"]').value.trim();
            if (!topic || !content) {
                showKnowledgeMessage('Topic and content are both required.', 'error');
                return;
            }
            try {
                const result = await api.request('ai/knowledge', { method: 'POST', body: { topic, content } });
                if (result.success) {
                    showKnowledgeMessage('Knowledge entry created.', 'success');
                    await refreshKnowledge();
                } else {
                    showKnowledgeMessage(result.error || 'Failed to create knowledge entry.', 'error');
                }
            } catch (error) {
                showKnowledgeMessage(error.message, 'error');
            }
        } else if (cancelBtn) {
            await refreshKnowledge();
        }
    });

    await refreshKnowledge();
});