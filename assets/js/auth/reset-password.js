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

    const passwordInput = document.getElementById('password');
    const ruleLength = document.getElementById('ruleLength');
    const ruleUpper = document.getElementById('ruleUpper');
    const ruleLower = document.getElementById('ruleLower');
    const ruleNumber = document.getElementById('ruleNumber');
    const ruleSpecial = document.getElementById('ruleSpecial');

    function updateRule(el, isPassed) {
        if (!el) return;
        const icon = el.querySelector('i');
        if (isPassed) {
            el.style.color = '#15803d';
            if (icon) {
                icon.className = 'fas fa-circle-check';
                icon.style.color = '#16a34a';
            }
        } else {
            el.style.color = '#64748b';
            if (icon) {
                icon.className = 'fas fa-circle-xmark';
                icon.style.color = '#94a3b8';
            }
        }
    }

    function checkPasswordComplexity(pwd) {
        const hasLength = (pwd || '').length >= 8;
        const hasUpper = /[A-Z]/.test(pwd || '');
        const hasLower = /[a-z]/.test(pwd || '');
        const hasNumber = /[0-9]/.test(pwd || '');
        const hasSpecial = /[^a-zA-Z0-9]/.test(pwd || '');

        updateRule(ruleLength, hasLength);
        updateRule(ruleUpper, hasUpper);
        updateRule(ruleLower, hasLower);
        updateRule(ruleNumber, hasNumber);
        updateRule(ruleSpecial, hasSpecial);

        return hasLength && hasUpper && hasLower && hasNumber && hasSpecial;
    }

    if (passwordInput) {
        passwordInput.addEventListener('input', function() {
            checkPasswordComplexity(this.value);
        });
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const password = document.getElementById('password').value;
        const confirm = document.getElementById('confirm_password').value;

        document.getElementById('passwordError').textContent = '';
        document.getElementById('confirmError').textContent = '';
        alertBox.classList.remove('show');

        let isValid = true;
        if (!checkPasswordComplexity(password)) {
            document.getElementById('passwordError').textContent = 'Password must meet all complexity requirements listed above';
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
