document.addEventListener('DOMContentLoaded', function() {
    const form = document.getElementById('registerForm');
    const alertBox = document.getElementById('alert');

    if (!form) return;

    function clearErrors() {
        form.querySelectorAll('.error-message').forEach(el => {
            el.textContent = '';
        });
    }

    let registeredEmail = '';

    const verificationPanel = document.getElementById('verificationPanel');
    const verifyEmailDisplay = document.getElementById('verifyEmailDisplay');
    const devCodeAlert = document.getElementById('devCodeAlert');
    const verificationCodeInput = document.getElementById('verificationCodeInput');
    const btnVerifyCode = document.getElementById('btnVerifyCode');
    const btnResendCode = document.getElementById('btnResendCode');

    if (btnVerifyCode) {
        btnVerifyCode.addEventListener('click', async function() {
            const code = verificationCodeInput.value.trim();
            if (!code || code.length !== 6) {
                alertBox.textContent = 'Please enter the 6-digit verification code sent to your email.';
                alertBox.className = 'alert alert-danger show';
                return;
            }

            if (typeof setButtonLoading === 'function') setButtonLoading(btnVerifyCode, true);
            alertBox.className = 'alert';
            alertBox.classList.remove('show');

            try {
                const res = await api.verifyContact(registeredEmail, code);
                if (res && res.success) {
                    alertBox.textContent = 'Email verified successfully! Redirecting to login...';
                    alertBox.className = 'alert alert-success show';
                    setTimeout(() => window.location.href = `${getFrontendBasePath()}/auth/login.html`, 1500);
                } else {
                    alertBox.textContent = (res && res.error) ? res.error : 'Invalid or expired verification code.';
                    alertBox.className = 'alert alert-danger show';
                    if (typeof setButtonLoading === 'function') setButtonLoading(btnVerifyCode, false);
                }
            } catch (err) {
                alertBox.textContent = err.message || 'Verification failed. Please try again.';
                alertBox.className = 'alert alert-danger show';
                if (typeof setButtonLoading === 'function') setButtonLoading(btnVerifyCode, false);
            }
        });
    }

    if (btnResendCode) {
        btnResendCode.addEventListener('click', async function() {
            if (!registeredEmail) return;
            btnResendCode.disabled = true;
            btnResendCode.textContent = 'Sending...';

            try {
                const res = await api.resendVerification(registeredEmail);
                if (res && res.success) {
                    alertBox.textContent = 'A new 6-digit verification code has been dispatched.';
                    alertBox.className = 'alert alert-info show';
                    if (res.dev_verification_code && devCodeAlert) {
                        devCodeAlert.textContent = 'Development Mode Code: ' + res.dev_verification_code;
                        devCodeAlert.style.display = 'block';
                    }
                } else {
                    alertBox.textContent = (res && res.error) ? res.error : 'Failed to resend code.';
                    alertBox.className = 'alert alert-danger show';
                }
            } catch (err) {
                alertBox.textContent = err.message || 'Failed to resend code.';
                alertBox.className = 'alert alert-danger show';
            } finally {
                setTimeout(() => {
                    btnResendCode.disabled = false;
                    btnResendCode.textContent = 'Resend Code';
                }, 3000);
            }
        });
    }

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

        if (!isValid) {
            alertBox.textContent = 'Please correct the highlighted form errors before submitting.';
            alertBox.className = 'alert alert-danger show';
            return;
        }

        const submitBtn = form.querySelector('button[type="submit"]');
        if (submitBtn && submitBtn.disabled) return;
        if (typeof setButtonLoading === 'function') setButtonLoading(submitBtn, true);

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

            if (result && result.success) {
                registeredEmail = email;

                if (result.verification_required && verificationPanel) {
                    form.style.display = 'none';
                    const formHeader = document.querySelector('.register-form-header');
                    if (formHeader) {
                        formHeader.style.display = 'none';
                    }
                    const authDivider = document.querySelector('.auth-divider');
                    if (authDivider) authDivider.style.display = 'none';

                    verificationPanel.style.display = 'block';
                    if (verifyEmailDisplay) verifyEmailDisplay.textContent = email;

                    if (result.dev_verification_code && devCodeAlert) {
                        devCodeAlert.textContent = 'Development Mode Code: ' + result.dev_verification_code;
                        devCodeAlert.style.display = 'block';
                    }

                    if (verificationCodeInput) verificationCodeInput.focus();
                } else {
                    alertBox.textContent = 'Registration successful! Redirecting to login...';
                    alertBox.classList.add('show', 'alert-success');
                    setTimeout(() => window.location.href = `${getFrontendBasePath()}/auth/login.html`, 1500);
                }
            } else {
                alertBox.textContent = (result && result.error) ? result.error : 'Registration failed';
                alertBox.classList.add('show', 'alert-danger');
                if (typeof setButtonLoading === 'function') setButtonLoading(submitBtn, false);
            }
        } catch (error) {
            alertBox.textContent = error.message || 'Registration failed. Please try again.';
            alertBox.classList.add('show', 'alert-danger');
            if (typeof setButtonLoading === 'function') setButtonLoading(submitBtn, false);
        }
    });
});
