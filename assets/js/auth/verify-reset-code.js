document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('verifyCodeForm');
    const alertBox = document.getElementById('alert');
    const codeError = document.getElementById('codeError');
    const devCodePanel = document.getElementById('devCodePanel');
    const devCodeValue = document.getElementById('devCodeValue');
    const resendBtn = document.getElementById('resendBtn');
    const digits = Array.from(document.querySelectorAll('.code-digit'));

    if (!form) return;

    const email = sessionStorage.getItem('reset_email');
    if (!email) {
        window.location.href = 'forgot-password.html';
        return;
    }

    const devCode = sessionStorage.getItem('reset_dev_code');
    if (devCode) {
        devCodeValue.textContent = devCode;
        devCodePanel.classList.add('show');
    }

    // --- 6-digit input UX: auto-advance, backspace-back, paste-fill ---
    digits.forEach((input, i) => {
        input.addEventListener('input', () => {
            input.value = input.value.replace(/\D/g, '').slice(0, 1);
            if (input.value && i < digits.length - 1) {
                digits[i + 1].focus();
            }
        });
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Backspace' && !input.value && i > 0) {
                digits[i - 1].focus();
            }
        });
        input.addEventListener('paste', (e) => {
            const pasted = (e.clipboardData || window.clipboardData).getData('text').replace(/\D/g, '');
            if (!pasted) return;
            e.preventDefault();
            pasted.slice(0, digits.length).split('').forEach((ch, idx) => {
                if (digits[idx]) digits[idx].value = ch;
            });
            const next = Math.min(pasted.length, digits.length - 1);
            digits[next].focus();
        });
    });

    function getCode() {
        return digits.map(d => d.value).join('');
    }

    let resendCooldown = 0;
    let resendTimer = null;

    function startResendCooldown() {
        resendCooldown = 30;
        resendBtn.disabled = true;
        resendTimer = setInterval(() => {
            resendCooldown -= 1;
            if (resendCooldown <= 0) {
                clearInterval(resendTimer);
                resendBtn.disabled = false;
                resendBtn.textContent = 'Resend';
            } else {
                resendBtn.textContent = `Resend (${resendCooldown}s)`;
            }
        }, 1000);
    }
    startResendCooldown();

    resendBtn.addEventListener('click', async function() {
        if (resendBtn.disabled) return;
        resendBtn.disabled = true;
        try {
            const result = await api.forgotPassword(email);
            if (result.dev_code) {
                sessionStorage.setItem('reset_dev_code', result.dev_code);
                devCodeValue.textContent = result.dev_code;
                devCodePanel.classList.add('show');
            }
            alertBox.textContent = 'A new verification code has been generated.';
            alertBox.classList.add('show', 'alert-success');
        } catch (error) {
            alertBox.textContent = error.message || 'Could not resend the code. Please try again.';
            alertBox.classList.add('show');
        }
        startResendCooldown();
    });

    form.addEventListener('submit', async function(e) {
        e.preventDefault();
        codeError.textContent = '';
        alertBox.classList.remove('show');

        const code = getCode();
        if (code.length !== 6) {
            codeError.textContent = 'Enter all 6 digits';
            return;
        }

        const submitBtn = document.getElementById('submitBtn');
        if (submitBtn.disabled) return;
        setButtonLoading(submitBtn, true);

        try {
            await api.verifyResetCode(email, code);
            sessionStorage.setItem('reset_code', code);
            sessionStorage.setItem('reset_code_verified', 'true');
            window.location.href = 'reset-password.html';
        } catch (error) {
            setButtonLoading(submitBtn, false);
            codeError.textContent = error.message || 'Invalid or expired code';
            digits.forEach(d => d.value = '');
            digits[0].focus();
        }
    });
});
