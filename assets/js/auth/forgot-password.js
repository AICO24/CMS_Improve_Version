document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('forgotPasswordForm');
    const alertBox = document.getElementById('alert');
    const devCodePanel = document.getElementById('devCodePanel');
    const devCodeValue = document.getElementById('devCodeValue');
    const continueWrap = document.getElementById('continueWrap');
    const continueBtn = document.getElementById('continueBtn');

    if (!form) return;

    let pendingIdentifier = null;

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        const inputVal = document.getElementById('email').value.trim();

        document.getElementById('emailError').textContent = '';
        alertBox.classList.remove('show');
        devCodePanel.classList.remove('show');
        continueWrap.style.display = 'none';

        const isEmail = inputVal.includes('@') && inputVal.includes('.');
        const digits = inputVal.replace(/\D/g, '');
        const isPhone = (digits.length === 11 && digits.startsWith('09')) ||
                        (digits.length === 12 && digits.startsWith('639')) ||
                        (digits.length === 10 && digits.startsWith('9'));

        if (!isEmail && !isPhone) {
            document.getElementById('emailError').textContent = 'Please enter a valid email address or 11-digit mobile number (e.g. 09171234567)';
            return;
        }

        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn.disabled) return;
        setButtonLoading(submitBtn, true);

        try {
            const result = await api.forgotPassword(inputVal);
            setButtonLoading(submitBtn, false);

            alertBox.textContent = result.message || 'If an account matches our records, a verification code has been generated.';
            alertBox.classList.add('show', 'alert-success');

            pendingIdentifier = inputVal;
            sessionStorage.setItem('reset_identifier', inputVal);
            sessionStorage.setItem('reset_email', inputVal);
            sessionStorage.removeItem('reset_code_verified');

            if (result.dev_code) {
                devCodeValue.textContent = result.dev_code;
                devCodePanel.classList.add('show');
                sessionStorage.setItem('reset_dev_code', result.dev_code);
            }

            continueWrap.style.display = 'block';
        } catch (error) {
            setButtonLoading(submitBtn, false);
            alertBox.textContent = error.message || 'Something went wrong. Please try again.';
            alertBox.classList.add('show');
        }
    });

    continueBtn.addEventListener('click', function() {
        if (!pendingIdentifier) return;
        window.location.href = 'verify-reset-code.html';
    });
});
