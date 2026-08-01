document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('loginForm');
    const alertBox = document.getElementById('alert');

    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;
        const role = document.getElementById('role').value;

        document.querySelectorAll('.error-message').forEach(el => el.textContent = '');
        alertBox.classList.remove('show');
        alertBox.textContent = '';

        let isValid = true;
        if (!username) {
            document.getElementById('usernameError').textContent = 'Username required';
            isValid = false;
        }
        if (!password) {
            document.getElementById('passwordError').textContent = 'Password required';
            isValid = false;
        }
        if (!isValid) return;

        try {
            const result = await api.login(username, password, role);
            if (result.success) {
                localStorage.setItem('user_session', JSON.stringify(result.user));
                localStorage.setItem('cemetery_session', JSON.stringify(result.user));
                alertBox.textContent = 'Login successful! Redirecting...';
                alertBox.classList.add('show', 'alert-success');
                // Redirect according to role: admin, staff, user
                if (result.user.role === 'admin') {
                    window.location.href = 'dashboard_admin.html';
                } else if (result.user.role === 'staff') {
                    window.location.href = 'dashboard_staff.html';
                } else {
                    window.location.href = 'dashboard_user.html';
                }
            } else {
                alertBox.textContent = result.error || 'Login failed';
                alertBox.classList.add('show');
            }
        } catch (error) {
            alertBox.textContent = error.message || 'Login failed. Please try again.';
            alertBox.classList.add('show');
        }
    });
});
