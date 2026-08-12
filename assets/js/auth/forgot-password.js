document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('forgotPasswordForm');
    const alertBox = document.getElementById('alert');
    const devCodePanel = document.getElementById('devCodePanel');
    const devCodeValue = document.getElementById('devCodeValue');
    const continueWrap = document.getElementById('continueWrap');
    const continueBtn = document.getElementById('continueBtn');

    if (!form) return;

    let pendingEmail = null;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const email = document.getElementById('email').value.trim();

        document.getElementById('emailError').textContent = '';
        alertBox.classList.remove('show');
        devCodePanel.classList.remove('show');
        continueWrap.style.display = 'none';

        if (!email || !email.includes('@')) {
            document.getElementById('emailError').textContent = 'Valid email required';
            return;
        }

        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn.disabled) return;
        setButtonLoading(submitBtn, true);

        try {
            const result = await api.forgotPassword(email);
            setButtonLoading(submitBtn, false);

            alertBox.textContent = result.message || 'If an account exists for that email, a verification code has been generated.';
            alertBox.classList.add('show', 'alert-success');

            if (result.dev_code) {
                pendingEmail = email;
                devCodeValue.textContent = result.dev_code;
                devCodePanel.classList.add('show');
                continueWrap.style.display = 'block';

                // Carried forward to the verify/reset steps. sessionStorage
                // (not localStorage) so it doesn't linger past this tab/flow.
                sessionStorage.setItem('reset_email', email);
                sessionStorage.setItem('reset_dev_code', result.dev_code);
                sessionStorage.removeItem('reset_code_verified');
            }
        } catch (error) {
            setButtonLoading(submitBtn, false);
            alertBox.textContent = error.message || 'Something went wrong. Please try again.';
            alertBox.classList.add('show');
        }
    });

    continueBtn.addEventListener('click', function() {
        if (!pendingEmail) return;
        window.location.href = 'verify-reset-code.html';
    });
});
