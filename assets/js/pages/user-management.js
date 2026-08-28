document.addEventListener('DOMContentLoaded', async function() {
    const currentUser = await requireRole(['admin']);
    if (!currentUser) return;

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    const toggleSidebarBtn = document.getElementById('toggleSidebar');
    const sidebarEl = document.querySelector('.sidebar');
    if (toggleSidebarBtn && sidebarEl) {
        toggleSidebarBtn.addEventListener('change', () => sidebarEl.classList.toggle('collapsed'));
    }

    const usersTableBody = document.getElementById('usersTableBody');
    const totalUsers = document.getElementById('totalUsers');
    const adminCount = document.getElementById('adminCount');
    const staffCount = document.getElementById('staffCount');
    const inactiveCount = document.getElementById('inactiveCount');
    const searchQuery = document.getElementById('searchQuery');
    const filterRole = document.getElementById('filterRole');
    const filterActive = document.getElementById('filterActive');
    const clearFilters = document.getElementById('clearFilters');
    const activeFilterChips = document.getElementById('activeFilterChips');
    const openAddUser = document.getElementById('openAddUser');
    const userModal = document.getElementById('userModal');
    const modalTitle = document.getElementById('modalTitle');
    const userForm = document.getElementById('userForm');
    const closeModal = document.querySelector('#userModal .close');

    const userFields = {
        userId: document.getElementById('userId'),
        username: document.getElementById('username'),
        fullName: document.getElementById('fullName'),
        email: document.getElementById('email'),
        role: document.getElementById('role'),
        password: document.getElementById('password'),
        isActive: document.getElementById('isActive'),
    };

    const perPage = 10;
    const paginationInfo = document.getElementById('paginationInfo');
    const prevPageBtn = document.getElementById('prevPage');
    const nextPageBtn = document.getElementById('nextPage');
    const pageJumpForm = document.getElementById('paginationJumpForm');
    const pageJumpInput = document.getElementById('pageJumpInput');
    const pageJumpBtn = document.getElementById('pageJumpBtn');
    const pagination = createPagination({
        prevBtn: prevPageBtn,
        nextBtn: nextPageBtn,
        jumpForm: pageJumpForm,
        jumpInput: pageJumpInput,
        jumpBtn: pageJumpBtn,
        infoEl: paginationInfo,
        itemLabel: 'user',
        onChange: loadUsers,
    });

    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    function renderActiveFilterChips() {
        const chips = [
            { key: 'q', label: 'Search', value: searchQuery.value.trim(), clear: () => { searchQuery.value = ''; } },
            { key: 'role', label: 'Role', value: filterRole.value, clear: () => { filterRole.value = ''; } },
            { key: 'is_active', label: 'Status', value: filterActive.value, clear: () => { filterActive.value = ''; } },
        ].filter((chip) => chip.value !== '');

        if (!activeFilterChips) return;
        activeFilterChips.innerHTML = chips.map((chip) => `
            <span class="filter-chip" data-filter-key="${chip.key}">
                ${escapeHtml(chip.label)}: ${escapeHtml(chip.value)}
                <button type="button" aria-label="Remove ${escapeHtml(chip.label)} filter">&times;</button>
            </span>
        `).join('');

        activeFilterChips.querySelectorAll('.filter-chip').forEach((chipEl) => {
            const chip = chips.find((item) => item.key === chipEl.dataset.filterKey);
            const button = chipEl.querySelector('button');
            if (!chip || !button) return;
            button.addEventListener('click', () => {
                chip.clear();
                pagination.reset();
                loadUsers();
            });
        });
    }

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
            renderActiveFilterChips();
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
        totalUsers.innerText = meta && typeof meta.total === 'number' ? meta.total : 0;
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
            adminCount.innerText = adminResult.meta && typeof adminResult.meta.total === 'number' ? adminResult.meta.total : 0;
            staffCount.innerText = staffResult.meta && typeof staffResult.meta.total === 'number' ? staffResult.meta.total : 0;
            inactiveCount.innerText = inactiveResult.meta && typeof inactiveResult.meta.total === 'number' ? inactiveResult.meta.total : 0;
        } catch (error) {
            console.error('Failed to load user breakdown stats:', error);
        }
    }

    function renderUsers(users) {
        if (!Array.isArray(users) || users.length === 0) {
            usersTableBody.innerHTML = `
                <tr>
                    <td colspan="7">
                        <div class="usermgmt-empty-state">
                            <i class="fas fa-users"></i>
                            <strong>No users found</strong>
                            <span>Adjust the filters or add a new user.</span>
                        </div>
                    </td>
                </tr>
            `;
            return;
        }

        usersTableBody.innerHTML = users.map(user => `
            <tr data-id="${user.user_id}">
                <td>${user.username}</td>
                <td>${user.full_name}</td>
                <td>${user.email}</td>
                <td><span class="status-badge ${(user.role_title || user.role || '').toLowerCase() === 'admin' ? 'status-info' : 'status-neutral'}">${user.role_title || user.role || 'Staff'}</span></td>
                <td><span class="status-badge ${user.is_active ? 'status-success' : 'status-danger'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>${user.last_login ? new Date(user.last_login).toLocaleString() : 'Never'}</td>
                <td class="action-buttons">
                    <button class="btn-view" title="Edit"><i class="fas fa-edit"></i></button>
                    <button class="btn-delete-row" title="Delete"><i class="fas fa-trash"></i></button>
                </td>
            </tr>
        `).join('');

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
        userFields.userId.value = '';
        userFields.username.value = '';
        userFields.fullName.value = '';
        userFields.email.value = '';
        userFields.role.value = 'staff';
        userFields.password.value = '';
        userFields.isActive.value = '1';
    }

    function showModal() {
        userModal.style.display = 'flex';
    }

    function hideModal() {
        userModal.style.display = 'none';
    }

    async function openEditUser(userId) {
        try {
            const user = await api.request(`users/${userId}`, { method: 'GET' });
            modalTitle.innerText = 'Edit User';
            userFields.userId.value = user.user_id;
            userFields.username.value = user.username;
            userFields.fullName.value = user.full_name;
            userFields.email.value = user.email;
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

    const refreshFiltered = debounce(() => {
        pagination.reset();
        loadUsers();
    }, 300);

    searchQuery.addEventListener('input', refreshFiltered);
    filterRole.addEventListener('change', () => {
        pagination.reset();
        loadUsers();
    });
    filterActive.addEventListener('change', () => {
        pagination.reset();
        loadUsers();
    });
    clearFilters.addEventListener('click', () => {
        searchQuery.value = '';
        filterRole.value = '';
        filterActive.value = '';
        pagination.reset();
        loadUsers();
    });

    openAddUser.addEventListener('click', () => {
        resetModal();
        showModal();
    });

    closeModal.addEventListener('click', hideModal);
    window.addEventListener('click', (e) => {
        if (e.target === userModal) hideModal();
    });

    await loadUsers();
});
