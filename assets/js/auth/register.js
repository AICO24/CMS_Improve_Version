document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('registerForm');
    const alertBox = document.getElementById('alert');

    if (!form) return;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const fullName = document.getElementById('full_name').value.trim();
        const email = document.getElementById('email').value.trim();
        const username = document.getElementById('username').value.trim();
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
        if (password !== confirm) {
            document.getElementById('confirmError').textContent = 'Passwords do not match';
            isValid = false;
        }
        if (password.length < 6) {
            document.getElementById('confirmError').textContent = 'Password must be at least 6 characters';
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
