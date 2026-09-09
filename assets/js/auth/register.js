document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('registerForm');
    const alertBox = document.getElementById('alert');

    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const fullName = document.getElementById('full_name').value.trim();
        const email = document.getElementById('email').value.trim().toLowerCase();
        const username = document.getElementById('username').value.trim();
        const contact = document.getElementById('contact_number').value.trim();
        const address = document.getElementById('address').value.trim();
        const password = document.getElementById('password').value;
        const confirm = document.getElementById('confirm_password').value;

        clearErrors();
        alertBox.className = 'alert';
        alertBox.classList.remove('show');

        let isValid = true;
        if (fullName.length < 2 || fullName.length > 120) {
            document.getElementById('fullNameError').textContent = 'Full name must be 2 to 120 characters';
            isValid = false;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            document.getElementById('emailError').textContent = 'Enter a valid email address';
            isValid = false;
        }
        if (username && !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
            document.getElementById('usernameError').textContent = 'Use 3-40 letters, numbers, dots, underscores, or hyphens';
            isValid = false;
        }
        if (contact && !/^[0-9+() -]{7,20}$/.test(contact)) {
            document.getElementById('contactError').textContent = 'Enter a valid contact number';
            isValid = false;
        }
        if (password !== confirm) {
            document.getElementById('confirmError').textContent = 'Passwords do not match';
            isValid = false;
        }
        if (password.length < 8) {
            document.getElementById('passwordError').textContent = 'Password must be at least 8 characters';
            isValid = false;
        }

        if (!isValid) return;

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn && submitBtn.disabled) return;
        setButtonLoading(submitBtn, true);

        try {
            // Public self-registration is User-only; staff/admin accounts are
            // created by an administrator via User Management. Backend
            // assigns the User role automatically.
            const payload = {
                full_name: fullName,
                email: email,
                username: username || null,
                contact_number: contact || null,
                address: address || null,
                password: password,
                confirm_password: confirm,
            };

            const result = await api.register(payload);

            if (result.success) {
                alertBox.textContent = 'Registration successful! Redirecting to login...';
                alertBox.classList.add('show', 'alert-success');
                // Left disabled/loading intentionally: the button stays inert
                // through the redirect delay below instead of resetting and
                // inviting a second submit while the user waits.
                setTimeout(() => window.location.href = `${getFrontendBasePath()}/auth/login.html`, 1500);
            } else {
                alertBox.textContent = result.error || 'Registration failed';
                alertBox.classList.add('show');
                setButtonLoading(submitBtn, false);
            }
        } catch (error) {
            alertBox.textContent = error.message || 'Registration failed. Please try again.';
            alertBox.classList.add('show');
            setButtonLoading(submitBtn, false);
        }
    });
});
