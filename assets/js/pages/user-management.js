document.addEventListener('DOMContentLoaded', async function() {
    const currentUser = await requireRole(['admin']);
    if (!currentUser) return;

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

    const usersTableBody = document.getElementById('usersTableBody');
    const totalUsers = document.getElementById('totalUsers');
    const totalUsersMeta = document.getElementById('totalUsersMeta');
    const adminCount = document.getElementById('adminCount');
    const adminCountMeta = document.getElementById('adminCountMeta');
    const staffCount = document.getElementById('staffCount');
    const staffCountMeta = document.getElementById('staffCountMeta');
    const inactiveCount = document.getElementById('inactiveCount');
    const inactiveCountMeta = document.getElementById('inactiveCountMeta');
    const searchQuery = document.getElementById('searchQuery');
    const searchUsersBtn = document.getElementById('searchUsersBtn');
    const filterRole = document.getElementById('filterRole');
    const filterActive = document.getElementById('filterActive');
    const clearFilters = document.getElementById('clearFilters');
    const openAddUser = document.getElementById('openAddUser');
    const bulkActivateBtn = document.getElementById('bulkActivateBtn');
    const bulkDeactivateBtn = document.getElementById('bulkDeactivateBtn');
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    const bulkSelectedCount = document.getElementById('bulkSelectedCount');
    const selectAllUsers = document.getElementById('selectAllUsers');
    const refreshActivityBtn = document.getElementById('refreshActivityBtn');
    const userActivityList = document.getElementById('userActivityList');
    const miniAdminCount = document.getElementById('miniAdminCount');
    const miniStaffCount = document.getElementById('miniStaffCount');
    const miniInactiveCount = document.getElementById('miniInactiveCount');
    const userModal = document.getElementById('userModal');
    const modalTitle = document.getElementById('modalTitle');
    const modalSubtitle = document.getElementById('modalSubtitle');
    const userForm = document.getElementById('userForm');
    const closeModal = document.querySelector('#userModal .close');
    const cancelUserForm = document.getElementById('cancelUserForm');

    const perPage = 10;
    const paginationInfo = document.getElementById('paginationInfo');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');

    const requiredNodes = {
        usersTableBody,
        totalUsers,
        adminCount,
        staffCount,
        inactiveCount,
        searchQuery,
        filterRole,
        filterActive,
        openAddUser,
        bulkActivateBtn,
        bulkDeactivateBtn,
        bulkDeleteBtn,
        selectAllUsers,
        refreshActivityBtn,
        userActivityList,
        userModal,
        modalTitle,
        modalSubtitle,
        userForm,
        paginationInfo,
        pageJumpForm,
        pageJumpInput,
        pageJumpBtn,
        prevPageBtn,
        nextPageBtn,
    };

    if (Object.values(requiredNodes).some((node) => !node)) {
        console.error('User management page is missing required DOM nodes.');
        return;
    }

    const userFields = {
        userId: document.getElementById('userId'),
        username: document.getElementById('username'),
        fullName: document.getElementById('fullName'),
        email: document.getElementById('email'),
        contactNumber: document.getElementById('contactNumber'),
        address: document.getElementById('address'),
        role: document.getElementById('role'),
        password: document.getElementById('password'),
        isActive: document.getElementById('isActive'),
    };

    let selectedUserIds = new Set();
    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        infoEl: paginationInfo,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        itemLabel: 'user',
        onChange: loadUsers,
    });

    function buildFilters() {
        const filters = {};
        if (filterRole.value) filters.role = filterRole.value;
        if (filterActive.value !== '') filters.is_active = filterActive.value;
        if (searchQuery.value.trim()) filters.q = searchQuery.value.trim();
        return filters;
    }

    async function loadUsers() {
        try {
            const filters = buildFilters();
            const params = new URLSearchParams(filters);
            params.set('page', pagination.page);
            params.set('per_page', perPage);
            const result = await api.request(`users?${params.toString()}`, { method: 'GET' });
            const users = Array.isArray(result.data) ? result.data : [];
            renderUsers(users);
            pagination.render(result.meta || { page: 1, total_pages: 1, total: users.length });
            await updateStats(filters, result.meta);
        } catch (error) {
            usersTableBody.innerHTML = '<tr><td colspan="7">Failed to load users. Please refresh.</td></tr>';
            pagination.render({ page: 1, total_pages: 1, total: 0 });
            console.error('Failed to load users:', error);
        }
    }

    // Breakdown cards reflect the current search+filter context (matching the
    // pre-pagination behavior of counting within the filtered result set), but
    // can no longer be derived from the current page's rows alone — each count
    // is a lightweight per_page=1 request whose meta.total is the real count.
    async function updateStats(filters, meta) {
        const total = meta && typeof meta.total === 'number' ? meta.total : 0;
        totalUsers.innerText = total;
        if (totalUsersMeta) {
            totalUsersMeta.textContent = 'Total accounts';
        }

        try {
            const countFor = (overrides) => {
                const params = new URLSearchParams({ ...filters, ...overrides, per_page: 1 });
                return api.request(`users?${params.toString()}`, { method: 'GET' });
            };
            const [adminResult, staffResult, inactiveResult] = await Promise.all([
                countFor({ role: 'admin' }),
                countFor({ role: 'staff' }),
                countFor({ is_active: 0 }),
            ]);
            const adminTotal = adminResult.meta && typeof adminResult.meta.total === 'number' ? adminResult.meta.total : 0;
            const staffTotal = staffResult.meta && typeof adminResult.meta.total === 'number' ? staffResult.meta.total : 0;
            const inactiveTotal = inactiveResult.meta && typeof inactiveResult.meta.total === 'number' ? inactiveResult.meta.total : 0;

            adminCount.innerText = adminTotal;
            staffCount.innerText = staffTotal;
            inactiveCount.innerText = inactiveTotal;

            if (adminCountMeta) {
                adminCountMeta.textContent = 'Admin accounts';
            }
            if (staffCountMeta) {
                staffCountMeta.textContent = 'Staff accounts';
            }
            if (inactiveCountMeta) {
                inactiveCountMeta.textContent = 'Inactive accounts';
            }
            if (miniAdminCount) miniAdminCount.innerText = adminTotal;
            if (miniStaffCount) miniStaffCount.innerText = staffTotal;
            if (miniInactiveCount) miniInactiveCount.innerText = inactiveTotal;
        } catch (error) {
            console.error('Failed to load user breakdown stats:', error);
        }
    }

    async function loadRecentActivity() {
        if (!userActivityList) return;
        userActivityList.innerHTML = '<li class="activity-item is-loading">Loading recent activity...</li>';

        try {
            const logs = await api.request('audit-logs?limit=5&offset=0', { method: 'GET' });
            if (!Array.isArray(logs) || logs.length === 0) {
                userActivityList.innerHTML = '<li class="activity-item is-loading">No activity recorded yet.</li>';
                return;
            }

            const actionMap = {
                'User created': { label: 'Created', tone: 'is-success', verb: 'created a new account for' },
                'User updated': { label: 'Updated', tone: 'is-info', verb: 'updated account details for' },
                'User deleted': { label: 'Deleted', tone: 'is-danger', verb: 'deleted account' },
                'Users deleted': { label: 'Deleted', tone: 'is-danger', verb: 'deleted multiple accounts' },
                'Users activated': { label: 'Activated', tone: 'is-success', verb: 'activated account(s)' },
                'Users deactivated': { label: 'Deactivated', tone: 'is-warning', verb: 'deactivated account(s)' },
                'Login successful': { label: 'Signed in', tone: 'is-info', verb: 'signed in successfully' },
                'Password reset': { label: 'Reset', tone: 'is-warning', verb: 'reset password for' },
                'Profile updated': { label: 'Updated', tone: 'is-info', verb: 'updated profile for' },
            };

            userActivityList.innerHTML = logs.map((log) => {
                const rawAction = log.action || 'Activity';
                const actorName = log.user_full_name || log.username || 'System';
                const mapped = actionMap[rawAction] || { label: rawAction, tone: /delete|remove|deactivate|reject|failed/i.test(rawAction) ? 'is-danger' : 'is-success', verb: 'performed an action on' };

                let targetText = 'system record';
                let description = mapped.verb;

                if (log.details) {
                    const raw = String(log.details).trim();
                    try {
                        const parsed = raw.startsWith('{') || raw.startsWith('[') ? JSON.parse(raw) : null;
                        const detailsObj = parsed && typeof parsed === 'object' ? parsed : null;

                        if (detailsObj) {
                            const candidate = detailsObj.target_user
                                || detailsObj.deleted_username
                                || detailsObj.created_username
                                || detailsObj.username
                                || detailsObj.user
                                || detailsObj.full_name
                                || detailsObj.name
                                || detailsObj.email;

                            if (candidate) {
                                targetText = String(candidate);
                            }

                            const values = Object.values(detailsObj)
                                .filter((value) => typeof value === 'string' || typeof value === 'number')
                                .map(String)
                                .filter((value) => value.trim());

                            if (values.length) {
                                description = `${mapped.verb} ${values.slice(0, 2).join(' • ')}`;
                            }
                        } else if (raw) {
                            const clean = raw.replace(/\s+/g, ' ').slice(0, 80);
                            targetText = clean;
                            description = `${mapped.verb} ${clean}`;
                        }
                    } catch (error) {
                        const clean = raw.replace(/\s+/g, ' ').slice(0, 80);
                        targetText = clean;
                        description = `${mapped.verb} ${clean}`;
                    }
                }

                const time = log.created_at ? new Date(log.created_at).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                }) : 'Recently';

                return `
                    <li class="activity-item">
                        <div class="activity-marker ${mapped.tone}"></div>
                        <div class="activity-meta">
                            <div class="activity-headline">
                                <strong>${actorName}</strong>
                                <span class="activity-dot">•</span>
                                <span class="activity-action-text">${mapped.label}</span>
                            </div>
                            <span>${description}</span>
                            <small>${targetText}</small>
                        </div>
                        <div class="activity-side">
                            <span class="activity-time">${time}</span>
                            <span class="activity-tag ${mapped.tone}">${mapped.label}</span>
                        </div>
                    </li>
                `;
            }).join('');
        } catch (error) {
            userActivityList.innerHTML = '<li class="activity-item is-loading">Unable to load recent activity.</li>';
            console.error('Failed to load recent activity:', error);
        }
    }

    function syncBulkControls() {
        const count = selectedUserIds.size;
        bulkSelectedCount.textContent = count ? `${count} user${count > 1 ? 's' : ''} selected` : 'No users selected';
        bulkActivateBtn.disabled = count === 0;
        bulkDeactivateBtn.disabled = count === 0;
        bulkDeleteBtn.disabled = count === 0;

        const rowCheckboxes = usersTableBody.querySelectorAll('.user-select');
        if (rowCheckboxes.length) {
            const allChecked = [...rowCheckboxes].every((checkbox) => checkbox.checked);
            selectAllUsers.checked = allChecked;
        } else {
            selectAllUsers.checked = false;
        }
    }

    function renderUsers(users) {
        if (!Array.isArray(users) || users.length === 0) {
            usersTableBody.innerHTML = '<tr><td colspan="9">No users found.</td></tr>';
            syncBulkControls();
            return;
        }

        usersTableBody.innerHTML = users.map(user => `
            <tr data-id="${user.user_id}">
                <td class="table-select-col"><input type="checkbox" class="user-select" data-id="${user.user_id}" ${selectedUserIds.has(Number(user.user_id)) ? 'checked' : ''}></td>
                <td>${user.username}</td>
                <td>${user.full_name}</td>
                <td>${user.email}</td>
                <td><span class="status-badge ${(user.role_title || user.role || '').toLowerCase() === 'admin' ? 'status-info' : 'status-neutral'}">${user.role_title || user.role || 'Staff'}</span></td>
                <td><span class="status-badge ${user.is_active ? 'status-success' : 'status-danger'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>${user.created_at ? new Date(user.created_at).toLocaleDateString() : '—'}</td>
                <td>${user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}</td>
                <td class="action-buttons">
                    <button class="btn-view" title="Edit"><i class="fas fa-edit"></i></button>
                    <button class="btn-delete-row" title="Delete"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');

        usersTableBody.querySelectorAll('.user-select').forEach((checkbox) => {
            checkbox.addEventListener('change', () => {
                const id = Number(checkbox.dataset.id);
                if (checkbox.checked) {
                    selectedUserIds.add(id);
                } else {
                    selectedUserIds.delete(id);
                }
                syncBulkControls();
            });
        });

        usersTableBody.querySelectorAll('.btn-view').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.closest('tr').dataset.id;
                openEditUser(id);
            });
        });

        usersTableBody.querySelectorAll('.btn-delete-row').forEach(btn => {
            btn.addEventListener('click', async () => {
                const id = btn.closest('tr').dataset.id;
                if (!confirm('Delete this user? This cannot be undone.')) return;
                try {
                    await api.request(`users/${id}`, { method: 'DELETE' });
                    await loadUsers();
                } catch (error) {
                    alert(error.message || 'Failed to delete user');
                }
            });
        });
    }

    function resetModal() {
        modalTitle.innerText = 'Add User';
        if (modalSubtitle) modalSubtitle.textContent = 'Create a new account and assign access.';
        userFields.userId.value = '';
        userFields.username.value = '';
        userFields.fullName.value = '';
        userFields.email.value = '';
        userFields.contactNumber.value = '';
        userFields.address.value = '';
        userFields.role.value = 'staff';
        userFields.password.value = '';
        userFields.isActive.value = '1';
    }

    const userModalContent = document.querySelector('#userModal .user-modal-content');
    const modalScrollButtons = document.querySelectorAll('#userModal .modal-scroll-btn');

    function updateModalScrollButtons() {
        if (!userModalContent) return;
        const maxScroll = userModalContent.scrollHeight - userModalContent.clientHeight;
        const atTop = userModalContent.scrollTop <= 6;
        const atBottom = userModalContent.scrollTop >= maxScroll - 6;

        modalScrollButtons.forEach((button) => {
            const direction = button.dataset.scrollDir;
            const shouldDisable = direction === 'up' ? atTop : atBottom;
            button.disabled = shouldDisable;
        });
    }

    modalScrollButtons.forEach((button) => {
        button.addEventListener('click', () => {
            if (!userModalContent) return;
            const direction = button.dataset.scrollDir === 'up' ? -1 : 1;
            userModalContent.scrollBy({ top: direction * 180, behavior: 'smooth' });
        });
    });

    if (userModalContent) {
        userModalContent.addEventListener('scroll', updateModalScrollButtons);
    }

    function showModal() {
        userModal.style.display = 'flex';
        requestAnimationFrame(updateModalScrollButtons);
    }

    function hideModal() {
        userModal.style.display = 'none';
    }

    async function openEditUser(userId) {
        try {
            const user = await api.request(`users/${userId}`, { method: 'GET' });
            modalTitle.innerText = 'Edit User';
            if (modalSubtitle) modalSubtitle.textContent = 'Update account details and permissions.';
            userFields.userId.value = user.user_id;
            userFields.username.value = user.username;
            userFields.fullName.value = user.full_name;
            userFields.email.value = user.email;
            userFields.contactNumber.value = user.contact_number || '';
            userFields.address.value = user.address || '';
            userFields.role.value = user.role_title ? user.role_title.toLowerCase() : (user.role || 'staff');
            userFields.password.value = '';
            userFields.isActive.value = user.is_active ? '1' : '0';
            showModal();
        } catch (error) {
            alert(error.message || 'Failed to load user details');
        }
    }

    function debounce(fn, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn.apply(this, args), wait);
        };
    }

    userForm.addEventListener('submit', async function(e) {
        e.preventDefault();
        const payload = {
            username: userFields.username.value.trim(),
            full_name: userFields.fullName.value.trim(),
            email: userFields.email.value.trim(),
            contact_number: userFields.contactNumber.value.trim(),
            address: userFields.address.value.trim(),
            role_id: userFields.role.value === 'admin' ? 1 : 2,
            is_active: parseInt(userFields.isActive.value, 10),
        };

        if (userFields.password.value.trim()) {
            payload.password = userFields.password.value;
        }

        const userId = userFields.userId.value;
        if (!userId && !payload.password) {
            alert('Password is required when creating a new user.');
            return;
        }

        const saveBtn = userForm.querySelector('button[type="submit"]');
        await withButtonLoading(saveBtn, async () => {
            try {
                const result = userId
                    ? await api.request(`users/${userId}`, { method: 'PUT', body: payload })
                    : await api.request('users', { method: 'POST', body: payload });

                if (result.success) {
                    hideModal();
                    pagination.reset();
                    await loadUsers();
                } else {
                    alert(result.error || 'Unable to save user');
                }
            } catch (error) {
                alert(error.message || 'Failed to save user');
            }
        });
    });

    async function runBulkAction(action) {
        if (!selectedUserIds.size) return;

        const labels = {
            activate: 'activate',
            deactivate: 'deactivate',
            delete: 'delete',
        };

        const confirmed = action === 'delete'
            ? confirm(`Delete ${selectedUserIds.size} selected user${selectedUserIds.size > 1 ? 's' : ''}?`) 
            : true;

        if (!confirmed) return;

        try {
            const result = await api.request('users/bulk', {
                method: 'POST',
                body: {
                    action: labels[action],
                    user_ids: [...selectedUserIds],
                },
            });

            if (result.success) {
                selectedUserIds.clear();
                syncBulkControls();
                await loadUsers();
            } else {
                alert(result.error || 'Bulk action failed');
            }
        } catch (error) {
            alert(error.message || 'Bulk action failed');
        }
    }

    bulkActivateBtn.addEventListener('click', () => runBulkAction('activate'));
    bulkDeactivateBtn.addEventListener('click', () => runBulkAction('deactivate'));
    bulkDeleteBtn.addEventListener('click', () => runBulkAction('delete'));
    selectAllUsers.addEventListener('change', () => {
        const checkboxes = usersTableBody.querySelectorAll('.user-select');
        checkboxes.forEach((checkbox) => {
            const id = Number(checkbox.dataset.id);
            const shouldCheck = selectAllUsers.checked;
            checkbox.checked = shouldCheck;
            if (shouldCheck) selectedUserIds.add(id);
            else selectedUserIds.delete(id);
        });
        syncBulkControls();
    });

    const refreshFiltered = debounce(() => {
        pagination.reset();
        selectedUserIds.clear();
        loadUsers();
    }, 300);

    searchQuery.addEventListener('input', refreshFiltered);
    searchQuery.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            pagination.reset();
            loadUsers();
        }
    });
    refreshActivityBtn.addEventListener('click', loadRecentActivity);
    searchUsersBtn.addEventListener('click', () => {
        pagination.reset();
        loadUsers();
    });
    filterRole.addEventListener('change', () => {
        pagination.reset();
        selectedUserIds.clear();
        loadUsers();
    });
    filterActive.addEventListener('change', () => {
        pagination.reset();
        selectedUserIds.clear();
        loadUsers();
    });
    clearFilters.addEventListener('click', () => {
        searchQuery.value = '';
        filterRole.value = '';
        filterActive.value = '';
        pagination.reset();
        selectedUserIds.clear();
        loadUsers();
    });

    openAddUser.addEventListener('click', () => {
        resetModal();
        showModal();
    });

    if (closeModal) {
        closeModal.addEventListener('click', hideModal);
    }
    if (cancelUserForm) {
        cancelUserForm.addEventListener('click', hideModal);
    }
    window.addEventListener('click', (e) => {
        if (e.target === userModal) hideModal();
    });

    await Promise.all([
        loadUsers(),
        loadRecentActivity(),
    ]);
});
