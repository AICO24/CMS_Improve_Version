document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('registerForm');
    const alertBox = document.getElementById('alert');
    const roleMap = { user: 3, staff: 2, admin: 1 };

    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const fullName = document.getElementById('full_name').value.trim();
        const email = document.getElementById('email').value.trim();
        const username = document.getElementById('username').value.trim();
        const role = document.getElementById('role').value;
        const contact = document.getElementById('contact_number').value.trim();
        const address = document.getElementById('address').value.trim();
        const password = document.getElementById('password').value;
        const confirm = document.getElementById('confirm_password').value;

        document.querySelectorAll('.error-message').forEach(el => el.textContent = '');
        alertBox.classList.remove('show');

        let isValid = true;
        if (!fullName) {
            document.getElementById('fullNameError').textContent = 'Full name required';
            isValid = false;
        }
        if (!email || !email.includes('@')) {
            document.getElementById('emailError').textContent = 'Valid email required';
            isValid = false;
        }
        // Username is required only for staff/admin registrations
        if ((role === 'staff' || role === 'admin') && !username) {
            document.getElementById('usernameError').textContent = 'Username required for staff/admin accounts';
            isValid = false;
        }
        if (password !== confirm) {
            document.getElementById('confirmError').textContent = 'Passwords do not match';
            isValid = false;
        }
        if (password.length < 6) {
            document.getElementById('confirmError').textContent = 'Password must be at least 6 characters';
            isValid = false;
        }

        if (!isValid) return;

        try {
            let payload = null;
            if (role === 'user') {
                // public user registration - backend will assign User role
                payload = {
                    full_name: fullName,
                    email: email,
                    contact_number: contact || null,
                    address: address || null,
                    password: password,
                    confirm_password: confirm,
                };
            } else {
                // staff/admin registration via admin UI - send role name and username
                payload = {
                    full_name: fullName,
                    email: email,
                    username: username,
                    role: role,
                    password: password,
                };
            }

            const result = await api.register(payload);

            if (result.success) {
                alertBox.textContent = 'Registration successful! Redirecting to login...';
                alertBox.classList.add('show', 'alert-success');
                const loginPath = typeof window.getFrontendBasePath === 'function'
                    ? `${window.getFrontendBasePath()}/auth/login.html`
                    : `${window.location.origin}/CMS/frontend/auth/login.html`;
                setTimeout(() => window.location.href = loginPath, 1500);
            } else {
                alertBox.textContent = result.error || 'Registration failed';
                alertBox.classList.add('show');
            }
        } catch (error) {
            alertBox.textContent = error.message || 'Registration failed. Please try again.';
            alertBox.classList.add('show');
        }
    });
});
