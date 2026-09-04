document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('loginForm');
    const alertBox = document.getElementById('alert');
    const authTransition = document.getElementById('authTransition');

    if (!form) return;

    // Shown only after a successful login (see the success branch below),
    // never on a failed attempt. Keeps the submit button disabled/loading
    // for the same duration so there's no gap where a second submit slips
    // through before the redirect fires.
    function showAuthTransitionAndRedirect(role) {
        if (!authTransition) {
            window.location.href = getRoleDashboardPath(role);
            return;
        }
        authTransition.classList.add('show');
        setTimeout(() => {
            window.location.href = getRoleDashboardPath(role);
        }, 700);
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const username = document.getElementById('username').value.trim();
        const password = document.getElementById('password').value;

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

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn && submitBtn.disabled) return;
        setButtonLoading(submitBtn, true);

        try {
            const result = await api.login(username, password);
            if (result.success) {
                localStorage.setItem('user_session', JSON.stringify(result.user));
                localStorage.setItem('cemetery_session', JSON.stringify(result.user));
                alertBox.textContent = 'Login successful! Redirecting...';
                alertBox.classList.add('show', 'alert-success');
                const adminDashboardPath = '/pages/dashboard_admin.html';
                if (result.user.role === 'admin') {
                    console.debug('Redirecting admin to', adminDashboardPath);
                }
                // Button intentionally stays disabled/loading here: the
                // transition overlay covers the screen until the delayed
                // redirect below fires, so there's no re-enabled window.
                showAuthTransitionAndRedirect(result.user.role);
            } else {
                alertBox.textContent = result.error || 'Login failed';
                alertBox.classList.add('show');
                setButtonLoading(submitBtn, false);
            }
        } catch (error) {
            alertBox.textContent = error.message || 'Login failed. Please try again.';
            alertBox.classList.add('show');
            setButtonLoading(submitBtn, false);
        }
    });
});
