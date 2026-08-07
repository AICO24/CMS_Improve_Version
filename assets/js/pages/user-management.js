document.addEventListener('DOMContentLoaded', async function() {
    const currentUser = await requireRole(['admin']);
    if (!currentUser) return;

    const usersTableBody = document.getElementById('usersTableBody');
    const totalUsers = document.getElementById('totalUsers');
    const adminCount = document.getElementById('adminCount');
    const staffCount = document.getElementById('staffCount');
    const inactiveCount = document.getElementById('inactiveCount');
    const searchQuery = document.getElementById('searchQuery');
    const filterRole = document.getElementById('filterRole');
    const filterActive = document.getElementById('filterActive');
    const clearFilters = document.getElementById('clearFilters');
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
            const users = await api.request('users' + (Object.keys(filters).length ? `?${new URLSearchParams(filters)}` : ''), { method: 'GET' });
            renderUsers(users);
            updateStats(users);
        } catch (error) {
            usersTableBody.innerHTML = '<tr><td colspan="7">Failed to load users. Please refresh.</td></tr>';
            console.error('Failed to load users:', error);
        }
    }

    function updateStats(users) {
        if (!Array.isArray(users)) {
            totalUsers.innerText = 0;
            adminCount.innerText = 0;
            staffCount.innerText = 0;
            inactiveCount.innerText = 0;
            return;
        }

        totalUsers.innerText = users.length;
        adminCount.innerText = users.filter(u => u.role_title && u.role_title.toLowerCase() === 'admin').length;
        staffCount.innerText = users.filter(u => u.role_title && u.role_title.toLowerCase() === 'staff').length;
        inactiveCount.innerText = users.filter(u => !u.is_active).length;
    }

    function renderUsers(users) {
        if (!Array.isArray(users) || users.length === 0) {
            usersTableBody.innerHTML = '<tr><td colspan="7">No users found.</td></tr>';
            return;
        }

        usersTableBody.innerHTML = users.map(user => `
            <tr data-id="${user.user_id}">
                <td>${user.username}</td>
                <td>${user.full_name}</td>
                <td>${user.email}</td>
                <td>${user.role_title || user.role || 'Staff'}</td>
                <td>${user.is_active ? 'Active' : 'Inactive'}</td>
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

        try {
            const result = userId
                ? await api.request(`users/${userId}`, { method: 'PUT', body: payload })
                : await api.request('users', { method: 'POST', body: payload });

            if (result.success) {
                hideModal();
                await loadUsers();
            } else {
                alert(result.error || 'Unable to save user');
            }
        } catch (error) {
            alert(error.message || 'Failed to save user');
        }
    });

    searchQuery.addEventListener('input', debounce(loadUsers, 300));
    filterRole.addEventListener('change', loadUsers);
    filterActive.addEventListener('change', loadUsers);
    clearFilters.addEventListener('click', () => {
        searchQuery.value = '';
        filterRole.value = '';
        filterActive.value = '';
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
