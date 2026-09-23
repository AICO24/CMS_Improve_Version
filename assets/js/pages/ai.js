document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['admin']);
    if (!user) return;

    // Header buttons
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) logoutBtn.addEventListener('click', () => api.logout());

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    // Safe initialization of AI assistant if available
    if (typeof initAiAssistant === 'function') {
        try {
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
        } catch (e) {
            // Safe fallback if assistant widget is disabled
        }
    }

    // Notification Badge Poller (30s)
    function initNotificationBadgePoller() {
        const badge = document.getElementById('notificationBadge');
        if (!badge) return;
        async function poll() {
            try {
                const res = await api.request('notifications/unread-count', { method: 'GET' });
                const count = (res && typeof res.count === 'number') ? res.count : 0;
                badge.textContent = count;
                badge.style.display = count > 0 ? 'inline-block' : 'none';
            } catch (e) {
                // silent
            }
        }
        poll();
        setInterval(poll, 30000);
    }
    initNotificationBadgePoller();

    // Helper: Toast Notifications
    function showToast(message, type = 'success') {
        const container = document.getElementById('toastContainer');
        if (!container) return;
        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;
        const icon = type === 'success' ? 'fa-circle-check' : 'fa-triangle-exclamation';
        toast.innerHTML = `<i class="fas ${icon}"></i> <span>${escapeHtml(message)}</span>`;
        container.appendChild(toast);
        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
    }

    function escapeHtml(value) {
        if (value === null || value === undefined) return '';
        return String(value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    // Helper: Format Topic Identifier to Human-Readable Title
    function formatTopicTitle(slug) {
        if (!slug) return 'Untitled Topic';
        const titleMap = {
            'required_documents': 'Required Documents',
            'fees_and_pricing': 'Fees & Pricing',
            'cancellation_policy': 'Cancellation Policy',
            'booking_lead_time': 'Booking Lead Time & Schedules',
            'lot_type_differences': 'Lot Types & Options',
            'payment_process': 'Payment Process & Verification',
            'after_booking': 'After Booking Guidelines',
            'payment_instructions': 'Payment Instructions & Channels',
            'visiting_hours': 'Visiting Hours & Office Hours',
            'cemetery_location': 'Cemetery Location & Office',
            'services_overview': 'Services Overview'
        };
        const key = String(slug).toLowerCase().trim();
        if (titleMap[key]) return titleMap[key];
        return slug
            .replace(/[_-]+/g, ' ')
            .replace(/\b\w/g, c => c.toUpperCase());
    }

    // ====================================================
    // Tab Switching Logic
    // ====================================================
    const tabBtns = document.querySelectorAll('.records-tab-btn, .ai-tab-btn');
    const panelKnowledge = document.getElementById('panelKnowledge');
    const panelDiagnostics = document.getElementById('panelDiagnostics');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            const target = btn.dataset.tab;
            tabBtns.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            if (target === 'knowledge') {
                if (panelKnowledge) {
                    panelKnowledge.classList.add('active');
                    panelKnowledge.style.display = '';
                }
                if (panelDiagnostics) {
                    panelDiagnostics.classList.remove('active');
                    panelDiagnostics.style.display = 'none';
                }
                setActiveStatCard('statTopicsCard');
            } else {
                if (panelKnowledge) {
                    panelKnowledge.classList.remove('active');
                    panelKnowledge.style.display = 'none';
                }
                if (panelDiagnostics) {
                    panelDiagnostics.classList.add('active');
                    panelDiagnostics.style.display = '';
                }
                setActiveStatCard('statHealthCard');
            }
        });
    });

    // ====================================================
    // Interactive KPI Stat Cards
    // ====================================================
    const statCards = document.querySelectorAll('.ai-stats .stat-card');

    function setActiveStatCard(cardId) {
        statCards.forEach(card => {
            const isMatch = (card.id === cardId);
            card.classList.toggle('is-active-filter', isMatch);
            card.classList.toggle('active', isMatch);
            card.setAttribute('aria-pressed', isMatch ? 'true' : 'false');
        });
    }

    function switchAiTab(tabName) {
        const tabBtn = document.querySelector(`.records-tab-btn[data-tab="${tabName}"], .ai-tab-btn[data-tab="${tabName}"]`);
        if (tabBtn) tabBtn.click();
    }

    const statHealthCard = document.getElementById('statHealthCard');
    const statTopicsCard = document.getElementById('statTopicsCard');
    const statAttentionCard = document.getElementById('statAttentionCard');
    const statBriefingCard = document.getElementById('statBriefingCard');

    if (statHealthCard) {
        statHealthCard.addEventListener('click', () => {
            setActiveStatCard('statHealthCard');
            switchAiTab('diagnostics');
            const target = document.querySelector('.diag-health-card');
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('highlight-pulse');
                setTimeout(() => target.classList.remove('highlight-pulse'), 1500);
            }
            const pingBtn = document.getElementById('testHealthBtn');
            if (pingBtn) pingBtn.click();
        });
        statHealthCard.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                statHealthCard.click();
            }
        });
    }

    if (statTopicsCard) {
        statTopicsCard.addEventListener('click', () => {
            setActiveStatCard('statTopicsCard');
            switchAiTab('knowledge');
            if (knowledgeSearchInput) {
                knowledgeSearchInput.value = '';
                applyKnowledgeFilter();
            }
            if (panelKnowledge) {
                panelKnowledge.scrollIntoView({ behavior: 'smooth', block: 'start' });
            }
        });
        statTopicsCard.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                statTopicsCard.click();
            }
        });
    }

    if (statAttentionCard) {
        statAttentionCard.addEventListener('click', () => {
            setActiveStatCard('statAttentionCard');
            const isCurrentlyOnDiagnostics = panelDiagnostics && panelDiagnostics.classList.contains('active');
            if (isCurrentlyOnDiagnostics) {
                // If already on Diagnostics, navigate directly to Exceptions page
                window.location.href = 'exceptions.html';
            } else {
                switchAiTab('diagnostics');
                const target = document.getElementById('diagAttentionCard');
                if (target) {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    target.classList.add('highlight-pulse');
                    setTimeout(() => target.classList.remove('highlight-pulse'), 1500);
                }
            }
        });
        statAttentionCard.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                statAttentionCard.click();
            }
        });
    }

    if (statBriefingCard) {
        statBriefingCard.addEventListener('click', () => {
            setActiveStatCard('statBriefingCard');
            switchAiTab('diagnostics');
            const target = document.querySelector('.diag-briefing-card');
            if (target) {
                target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                target.classList.add('highlight-pulse');
                setTimeout(() => target.classList.remove('highlight-pulse'), 1500);
            }
            const refreshBtn = document.getElementById('refreshDigestBtn');
            if (refreshBtn) refreshBtn.click();
        });
        statBriefingCard.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                statBriefingCard.click();
            }
        });
    }

    // ====================================================
    // Tab 1: Knowledge Base Management & Pagination
    // ====================================================
    let allKnowledge = [];
    let filteredKnowledge = [];
    let currentPage = 1;
    const itemsPerPage = 8;
    let pendingDeleteId = null;

    const knowledgeSearchInput = document.getElementById('knowledgeSearchInput');
    const clearKnowledgeSearchBtn = document.getElementById('clearKnowledgeSearchBtn');
    const addKnowledgeBtn = document.getElementById('addKnowledgeBtn');
    const refreshKnowledgeBtn = document.getElementById('refreshKnowledgeBtn');
    const aiKnowledgeBody = document.getElementById('aiKnowledgeBody');

    const knowledgePageInfo = document.getElementById('knowledgePageInfo');
    const knowledgeJumpInput = document.getElementById('knowledgeJumpInput');
    const knowledgeJumpBtn = document.getElementById('knowledgeJumpBtn');
    const knowledgePrevBtn = document.getElementById('knowledgePrevBtn');
    const knowledgeNextBtn = document.getElementById('knowledgeNextBtn');

    // Fetch Knowledge from API
    async function fetchKnowledge() {
        try {
            aiKnowledgeBody.innerHTML = '<tr><td colspan="4" class="text-center py-4 text-muted"><i class="fas fa-spinner fa-spin me-2"></i> Loading knowledge base...</td></tr>';
            const entries = await api.request('ai/knowledge', { method: 'GET' });
            allKnowledge = Array.isArray(entries) ? entries : [];
            
            // Update KPI and Tab Badges
            const count = allKnowledge.length;
            const topicsCountEl = document.getElementById('topicsCount');
            if (topicsCountEl) topicsCountEl.textContent = count;
            const knowledgeTabBadge = document.getElementById('knowledgeTabBadge');
            if (knowledgeTabBadge) knowledgeTabBadge.textContent = count;

            applyKnowledgeFilter();
        } catch (error) {
            aiKnowledgeBody.innerHTML = `<tr><td colspan="4" class="text-center py-4 text-danger"><i class="fas fa-circle-exclamation me-2"></i> Failed to load knowledge base: ${escapeHtml(error.message)}</td></tr>`;
        }
    }

    function applyKnowledgeFilter() {
        const query = (knowledgeSearchInput ? knowledgeSearchInput.value : '').trim().toLowerCase();
        if (!query) {
            filteredKnowledge = [...allKnowledge];
        } else {
            filteredKnowledge = allKnowledge.filter(item => {
                const topic = (item.topic || '').toLowerCase();
                const friendlyTitle = formatTopicTitle(item.topic || '').toLowerCase();
                const content = (item.content || '').toLowerCase();
                return topic.includes(query) || friendlyTitle.includes(query) || content.includes(query);
            });
        }
        currentPage = 1;
        renderKnowledgePage();
    }

    function renderKnowledgePage() {
        const total = filteredKnowledge.length;
        const totalPages = Math.max(1, Math.ceil(total / itemsPerPage));

        if (currentPage > totalPages) currentPage = totalPages;
        if (currentPage < 1) currentPage = 1;

        const startIdx = (currentPage - 1) * itemsPerPage;
        const pageItems = filteredKnowledge.slice(startIdx, startIdx + itemsPerPage);

        if (pageItems.length === 0) {
            aiKnowledgeBody.innerHTML = '<tr><td colspan="4" class="text-center py-5 text-muted"><i class="fas fa-folder-open me-2"></i> No knowledge topics found. Click "Add Topic" to create one.</td></tr>';
        } else {
            aiKnowledgeBody.innerHTML = pageItems.map(item => {
                const id = item.knowledge_id;
                const rawTopic = item.topic || 'untitled';
                const displayTitle = formatTopicTitle(rawTopic);
                const content = item.content || '';
                const length = content.length;
                return `
                    <tr data-id="${id}">
                        <td class="col-topic">
                            <div class="topic-title-cell">
                                <span class="topic-display-title" title="${escapeHtml(displayTitle)}">${escapeHtml(displayTitle)}</span>
                                <span class="topic-slug-pill" title="Identifier: #${escapeHtml(rawTopic)}">#${escapeHtml(rawTopic)}</span>
                            </div>
                        </td>
                        <td class="col-content">
                            <div class="content-preview-cell" title="${escapeHtml(content)}">${escapeHtml(content)}</div>
                        </td>
                        <td class="col-length" style="text-align: center;">
                            <span class="char-badge">${length} chars</span>
                        </td>
                        <td class="col-actions">
                            <div class="action-buttons">
                                <button type="button" class="btn-row-action btn-row-action--edit btn-edit-topic" data-id="${id}" title="Edit Topic Details" aria-label="Edit topic">
                                    <i class="fas fa-pen-to-square"></i>
                                </button>
                                <button type="button" class="btn-row-action btn-row-action--delete btn-delete-topic" data-id="${id}" data-topic="${escapeHtml(displayTitle)}" title="Delete Knowledge Topic" aria-label="Delete topic">
                                    <i class="fas fa-trash-can"></i>
                                </button>
                            </div>
                        </td>
                    </tr>
                `;
            }).join('');
        }

        // Update Pagination controls
        if (knowledgePageInfo) {
            knowledgePageInfo.textContent = `Page ${currentPage} of ${totalPages} • ${total} topic${total === 1 ? '' : 's'}`;
        }
        if (knowledgePrevBtn) knowledgePrevBtn.disabled = (currentPage <= 1);
        if (knowledgeNextBtn) knowledgeNextBtn.disabled = (currentPage >= totalPages);
        if (knowledgeJumpInput) {
            knowledgeJumpInput.max = totalPages;
            knowledgeJumpInput.value = currentPage;
        }
    }

    // Pagination events
    if (knowledgePrevBtn) {
        knowledgePrevBtn.addEventListener('click', () => {
            if (currentPage > 1) {
                currentPage--;
                renderKnowledgePage();
            }
        });
    }

    if (knowledgeNextBtn) {
        knowledgeNextBtn.addEventListener('click', () => {
            const totalPages = Math.ceil(filteredKnowledge.length / itemsPerPage);
            if (currentPage < totalPages) {
                currentPage++;
                renderKnowledgePage();
            }
        });
    }

    if (knowledgeJumpBtn && knowledgeJumpInput) {
        knowledgeJumpBtn.addEventListener('click', () => {
            const val = parseInt(knowledgeJumpInput.value, 10);
            const totalPages = Math.max(1, Math.ceil(filteredKnowledge.length / itemsPerPage));
            if (!isNaN(val) && val >= 1 && val <= totalPages) {
                currentPage = val;
                renderKnowledgePage();
            }
        });
        knowledgeJumpInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                knowledgeJumpBtn.click();
            }
        });
    }

    // Search events
    if (knowledgeSearchInput) {
        knowledgeSearchInput.addEventListener('input', applyKnowledgeFilter);
    }
    if (clearKnowledgeSearchBtn) {
        clearKnowledgeSearchBtn.addEventListener('click', () => {
            if (knowledgeSearchInput) knowledgeSearchInput.value = '';
            applyKnowledgeFilter();
        });
    }
    if (refreshKnowledgeBtn) {
        refreshKnowledgeBtn.addEventListener('click', async () => {
            refreshKnowledgeBtn.disabled = true;
            try {
                await fetchKnowledge();
                showToast('Knowledge base refreshed.', 'success');
            } finally {
                refreshKnowledgeBtn.disabled = false;
            }
        });
    }

    // ====================================================
    // Modal: Add / Edit Topic
    // ====================================================
    const knowledgeModal = document.getElementById('knowledgeModal');
    const modalKnowledgeTitle = document.getElementById('modalKnowledgeTitle');
    const closeKnowledgeModalBtn = document.getElementById('closeKnowledgeModalBtn');
    const cancelKnowledgeModalBtn = document.getElementById('cancelKnowledgeModalBtn');
    const saveKnowledgeModalBtn = document.getElementById('saveKnowledgeModalBtn');
    const editKnowledgeId = document.getElementById('editKnowledgeId');
    const topicInput = document.getElementById('topicInput');
    const contentInput = document.getElementById('contentInput');
    const charCounter = document.getElementById('charCounter');
    const modalErrorMsg = document.getElementById('modalErrorMsg');

    function updateCharCounter() {
        if (charCounter && contentInput) {
            charCounter.textContent = `${contentInput.value.length} characters`;
        }
    }

    if (contentInput) {
        contentInput.addEventListener('input', updateCharCounter);
    }

    function openKnowledgeModal(isEdit = false, entry = null) {
        if (!knowledgeModal) return;
        modalErrorMsg.style.display = 'none';
        modalErrorMsg.textContent = '';

        if (isEdit && entry) {
            modalKnowledgeTitle.textContent = 'Edit Knowledge Topic';
            editKnowledgeId.value = entry.knowledge_id;
            topicInput.value = entry.topic || '';
            contentInput.value = entry.content || '';
        } else {
            modalKnowledgeTitle.textContent = 'Add Knowledge Topic';
            editKnowledgeId.value = '';
            topicInput.value = '';
            contentInput.value = '';
        }
        updateCharCounter();
        knowledgeModal.style.display = 'flex';
        knowledgeModal.setAttribute('aria-hidden', 'false');
        topicInput.focus();
    }

    function closeKnowledgeModal() {
        if (!knowledgeModal) return;
        knowledgeModal.style.display = 'none';
        knowledgeModal.setAttribute('aria-hidden', 'true');
    }

    if (addKnowledgeBtn) {
        addKnowledgeBtn.addEventListener('click', () => openKnowledgeModal(false));
    }
    if (closeKnowledgeModalBtn) closeKnowledgeModalBtn.addEventListener('click', closeKnowledgeModal);
    if (cancelKnowledgeModalBtn) cancelKnowledgeModalBtn.addEventListener('click', closeKnowledgeModal);

    // Save topic (Create or Update)
    if (saveKnowledgeModalBtn) {
        saveKnowledgeModalBtn.addEventListener('click', async () => {
            const topic = topicInput.value.trim();
            const content = contentInput.value.trim();
            const id = editKnowledgeId.value;

            if (!topic) {
                modalErrorMsg.textContent = 'Topic identifier is required.';
                modalErrorMsg.style.display = 'block';
                topicInput.focus();
                return;
            }
            if (!content) {
                modalErrorMsg.textContent = 'Knowledge content cannot be empty.';
                modalErrorMsg.style.display = 'block';
                contentInput.focus();
                return;
            }

            saveKnowledgeModalBtn.disabled = true;
            modalErrorMsg.style.display = 'none';

            try {
                if (id) {
                    // Update
                    const result = await api.request(`ai/knowledge/${id}`, {
                        method: 'PUT',
                        body: { topic, content }
                    });
                    if (result && result.success) {
                        showToast(`Topic "${topic}" updated successfully.`);
                        closeKnowledgeModal();
                        await fetchKnowledge();
                    } else {
                        throw new Error(result.error || 'Failed to update topic.');
                    }
                } else {
                    // Create
                    const result = await api.request('ai/knowledge', {
                        method: 'POST',
                        body: { topic, content }
                    });
                    if (result && result.success) {
                        showToast(`Topic "${topic}" created successfully.`);
                        closeKnowledgeModal();
                        await fetchKnowledge();
                    } else {
                        throw new Error(result.error || 'Failed to create topic.');
                    }
                }
            } catch (err) {
                modalErrorMsg.textContent = err.message || 'Operation failed. Please try again.';
                modalErrorMsg.style.display = 'block';
            } finally {
                saveKnowledgeModalBtn.disabled = false;
            }
        });
    }

    // Edit and Delete table button delegate
    aiKnowledgeBody.addEventListener('click', (e) => {
        const editBtn = e.target.closest('.btn-edit-topic');
        const deleteBtn = e.target.closest('.btn-delete-topic');

        if (editBtn) {
            const id = parseInt(editBtn.dataset.id, 10);
            const entry = allKnowledge.find(k => k.knowledge_id === id);
            if (entry) openKnowledgeModal(true, entry);
        } else if (deleteBtn) {
            const id = parseInt(deleteBtn.dataset.id, 10);
            const topic = deleteBtn.dataset.topic || 'this topic';
            openDeleteModal(id, topic);
        }
    });

    // ====================================================
    // Modal: Delete Topic Confirmation
    // ====================================================
    const deleteConfirmModal = document.getElementById('deleteConfirmModal');
    const deleteTopicName = document.getElementById('deleteTopicName');
    const closeDeleteModalBtn = document.getElementById('closeDeleteModalBtn');
    const cancelDeleteModalBtn = document.getElementById('cancelDeleteModalBtn');
    const confirmDeleteTopicBtn = document.getElementById('confirmDeleteTopicBtn');

    function openDeleteModal(id, topic) {
        pendingDeleteId = id;
        if (deleteTopicName) deleteTopicName.textContent = `"${topic}"`;
        if (deleteConfirmModal) {
            deleteConfirmModal.style.display = 'flex';
            deleteConfirmModal.setAttribute('aria-hidden', 'false');
        }
    }

    function closeDeleteModal() {
        pendingDeleteId = null;
        if (deleteConfirmModal) {
            deleteConfirmModal.style.display = 'none';
            deleteConfirmModal.setAttribute('aria-hidden', 'true');
        }
    }

    if (closeDeleteModalBtn) closeDeleteModalBtn.addEventListener('click', closeDeleteModal);
    if (cancelDeleteModalBtn) cancelDeleteModalBtn.addEventListener('click', closeDeleteModal);

    if (confirmDeleteTopicBtn) {
        confirmDeleteTopicBtn.addEventListener('click', async () => {
            if (!pendingDeleteId) return;
            confirmDeleteTopicBtn.disabled = true;
            try {
                const result = await api.request(`ai/knowledge/${pendingDeleteId}`, { method: 'DELETE' });
                if (result && result.success) {
                    showToast('Topic deleted successfully.');
                    closeDeleteModal();
                    await fetchKnowledge();
                } else {
                    throw new Error(result.error || 'Failed to delete knowledge entry.');
                }
            } catch (err) {
                showToast(err.message || 'Delete failed', 'error');
            } finally {
                confirmDeleteTopicBtn.disabled = false;
            }
        });
    }

    // ====================================================
    // Tab 2: Operations Briefing & Diagnostics Logic
    // ====================================================
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
        } catch (e) {}
    }

    // Today's Briefing
    async function loadDigest(forceRefresh = false) {
        const digestText = document.getElementById('aiDigestText');
        const refreshBtn = document.getElementById('refreshDigestBtn');
        const briefingMeta = document.getElementById('briefingMeta');
        if (!digestText) return;

        function render(result) {
            digestText.textContent = (result && result.explained && result.message)
                ? result.message
                : 'AI briefing is unavailable right now — all core transactions are processing under standard policy rules.';
            if (briefingMeta) {
                briefingMeta.textContent = result && result.timestamp
                    ? `Generated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
                    : 'Daily automation summary';
            }
        }

        if (!forceRefresh) {
            const cached = readAiDigestCache();
            if (cached) {
                render(cached);
                return;
            }
        }

        digestText.textContent = 'Analyzing today\'s transactions and generating operational briefing…';
        try {
            const result = await api.request('ai/dashboard-digest', { method: 'GET' });
            writeAiDigestCache(result);
            render(result);
        } catch (error) {
            render(null);
        }
    }

    const refreshDigestBtn = document.getElementById('refreshDigestBtn');
    if (refreshDigestBtn) {
        refreshDigestBtn.addEventListener('click', async () => {
            refreshDigestBtn.disabled = true;
            try {
                await loadDigest(true);
                showToast('Operational briefing updated.', 'success');
            } finally {
                refreshDigestBtn.disabled = false;
            }
        });
    }

    // Needs Attention (Exceptions count)
    async function loadAttention() {
        const text = document.getElementById('aiAttentionText');
        const link = document.getElementById('aiAttentionLink');
        const countEl = document.getElementById('attentionCount');
        const subEl = document.getElementById('attentionSub');
        const diagAttentionCard = document.getElementById('diagAttentionCard');

        try {
            const exceptions = await api.request('exceptions?status=open', { method: 'GET' });
            const count = Array.isArray(exceptions) ? exceptions.length : 0;
            if (countEl) countEl.textContent = count;

            if (count > 0) {
                if (text) text.textContent = `${count} transaction${count === 1 ? '' : 's'} couldn't be resolved automatically and require administrator review.`;
                if (link) link.style.display = 'inline-flex';
                if (subEl) subEl.textContent = `${count} pending exception${count === 1 ? '' : 's'}`;
                if (diagAttentionCard) diagAttentionCard.classList.add('has-open');
            } else {
                if (text) text.textContent = 'All automations are running normally. No open exceptions require manual intervention.';
                if (link) link.style.display = 'none';
                if (subEl) subEl.textContent = 'Automations all clear';
                if (diagAttentionCard) diagAttentionCard.classList.remove('has-open');
            }
        } catch (error) {
            if (text) text.textContent = 'Unable to check open exceptions at this time.';
            if (subEl) subEl.textContent = 'Status unavailable';
            if (link) link.style.display = 'none';
        }
    }

    // AI Service Health Check
    async function checkServiceHealth() {
        const healthStatus = document.getElementById('healthStatus');
        const serviceHealthSub = document.getElementById('serviceHealthSub');
        const healthDetailStatus = document.getElementById('healthDetailStatus');
        const healthTabBadge = document.getElementById('healthTabBadge');
        const serviceHealthBanner = document.getElementById('serviceHealthBanner');
        const healthLastChecked = document.getElementById('healthLastChecked');

        try {
            const result = await api.request('ai/health', { method: 'GET' });
            const isOnline = (result && result.status === 'ok');

            if (healthStatus) healthStatus.textContent = isOnline ? 'Online' : 'Offline';
            if (serviceHealthSub) serviceHealthSub.textContent = isOnline ? 'FastAPI & Gemini Connected' : 'Service Unreachable';
            if (healthDetailStatus) {
                healthDetailStatus.innerHTML = isOnline
                    ? '<span class="badge-status status-ok">Online</span>'
                    : '<span class="badge-status status-danger">Offline</span>';
            }
            if (healthTabBadge) {
                healthTabBadge.textContent = isOnline ? 'Online' : 'Offline';
                healthTabBadge.className = `tab-badge badge-pulse ${isOnline ? '' : 'text-danger'}`;
            }
            if (serviceHealthBanner) {
                serviceHealthBanner.textContent = isOnline
                    ? 'AI microservice & Google Gemini API are available and responding normally.'
                    : `AI microservice is offline: ${result?.error || 'No response from Python service'}`;
                serviceHealthBanner.classList.toggle('is-offline', !isOnline);
            }
            if (healthLastChecked) {
                healthLastChecked.textContent = new Date().toLocaleTimeString();
            }
        } catch (error) {
            if (healthStatus) healthStatus.textContent = 'Offline';
            if (serviceHealthSub) serviceHealthSub.textContent = 'Service Unreachable';
            if (healthDetailStatus) {
                healthDetailStatus.innerHTML = '<span class="badge-status status-danger">Offline</span>';
            }
            if (healthTabBadge) {
                healthTabBadge.textContent = 'Offline';
            }
            if (serviceHealthBanner) {
                serviceHealthBanner.textContent = `AI microservice error: ${error.message}`;
                serviceHealthBanner.classList.add('is-offline');
            }
            if (healthLastChecked) {
                healthLastChecked.textContent = new Date().toLocaleTimeString();
            }
        }
    }

    const testHealthBtn = document.getElementById('testHealthBtn');
    if (testHealthBtn) {
        testHealthBtn.addEventListener('click', async () => {
            testHealthBtn.disabled = true;
            try {
                await checkServiceHealth();
                showToast('AI health check completed.');
            } finally {
                testHealthBtn.disabled = false;
            }
        });
    }

    // Technical AI Parameters (Reference Collapsible)
    const toggleParamsBtn = document.getElementById('toggleParamsBtn');
    const toggleParamsText = document.getElementById('toggleParamsText');
    const paramsCollapseBody = document.getElementById('paramsCollapseBody');
    let paramsLoaded = false;

    if (toggleParamsBtn && paramsCollapseBody) {
        toggleParamsBtn.addEventListener('click', async () => {
            const isHidden = paramsCollapseBody.style.display === 'none';
            if (isHidden) {
                paramsCollapseBody.style.display = 'block';
                toggleParamsText.textContent = 'Hide Parameters';
                toggleParamsBtn.innerHTML = '<i class="fas fa-chevron-up"></i> <span>Hide Parameters</span>';
                if (!paramsLoaded) {
                    await loadParameters();
                    paramsLoaded = true;
                }
            } else {
                paramsCollapseBody.style.display = 'none';
                toggleParamsText.textContent = 'Show Parameters';
                toggleParamsBtn.innerHTML = '<i class="fas fa-chevron-down"></i> <span>Show Parameters</span>';
            }
        });
    }

    async function loadParameters() {
        const tbody = document.getElementById('aiParametersBody');
        if (!tbody) return;
        try {
            tbody.innerHTML = '<tr><td colspan="4" class="text-center py-2 text-muted"><i class="fas fa-spinner fa-spin me-2"></i> Loading parameters...</td></tr>';
            const params = await api.request('ai/parameters', { method: 'GET' });
            if (!Array.isArray(params) || params.length === 0) {
                tbody.innerHTML = '<tr><td colspan="4" class="text-center py-2 text-muted">No parameters found.</td></tr>';
                return;
            }
            tbody.innerHTML = params.map(p => `
                <tr>
                    <td><code>${escapeHtml(p.module || 'default')}</code></td>
                    <td><strong>${escapeHtml(p.param_name)}</strong></td>
                    <td><span class="char-badge">${escapeHtml(p.param_value || '')}</span></td>
                    <td><small class="text-muted">${escapeHtml(p.param_type || 'string')}</small></td>
                </tr>
            `).join('');
        } catch (e) {
            tbody.innerHTML = `<tr><td colspan="4" class="text-center text-danger py-2">Error loading parameters: ${escapeHtml(e.message)}</td></tr>`;
        }
    }

    // Initial Loads
    await fetchKnowledge();
    loadDigest();
    loadAttention();
    checkServiceHealth();

    // Health ping interval every 60s
    setInterval(checkServiceHealth, 60000);
});