document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('resetPasswordForm');
    const alertBox = document.getElementById('alert');

    if (!form) return;

    const email = sessionStorage.getItem('reset_email');
    const code = sessionStorage.getItem('reset_code');
    const verified = sessionStorage.getItem('reset_code_verified') === 'true';

    // Defense-in-depth for the UI flow only — the actual security boundary
    // is server-side: resetPassword() on the backend re-validates the code
    // and its expiry itself, regardless of what the client sends here.
    if (!email || !code || !verified) {
        window.location.href = 'forgot-password.html';
        return;
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const password = document.getElementById('password').value;
        const confirm = document.getElementById('confirm_password').value;

        document.getElementById('passwordError').textContent = '';
        document.getElementById('confirmError').textContent = '';
        alertBox.classList.remove('show');

        let isValid = true;
        if (password.length < 6) {
            document.getElementById('passwordError').textContent = 'Password must be at least 6 characters';
            isValid = false;
        }
        if (password !== confirm) {
            document.getElementById('confirmError').textContent = 'Passwords do not match';
            isValid = false;
        }
        if (!isValid) return;

        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn.disabled) return;
        setButtonLoading(submitBtn, true);

        try {
            const result = await api.resetPassword(email, code, password, confirm);
            if (result.success) {
                sessionStorage.removeItem('reset_email');
                sessionStorage.removeItem('reset_dev_code');
                sessionStorage.removeItem('reset_code');
                sessionStorage.removeItem('reset_code_verified');

                alertBox.textContent = 'Password reset successful! Redirecting to sign in...';
                alertBox.classList.add('show', 'alert-success');
                setTimeout(() => window.location.href = 'login.html', 1500);
            } else {
                alertBox.textContent = result.error || 'Password reset failed';
                alertBox.classList.add('show');
                setButtonLoading(submitBtn, false);
            }
        } catch (error) {
            alertBox.textContent = error.message || 'Password reset failed. Please try again.';
            alertBox.classList.add('show');
            setButtonLoading(submitBtn, false);

            // The code may have expired between the verify step and here —
            // send them back to request a fresh one rather than stranding
            // them on a form that can never succeed.
            if (/expired|invalid/i.test(error.message || '')) {
                sessionStorage.removeItem('reset_code_verified');
                setTimeout(() => window.location.href = 'forgot-password.html', 2000);
            }
        }
    });
});
