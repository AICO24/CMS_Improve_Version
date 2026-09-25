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

        // Philippine mobile number validation (+63, 09, or 9 followed by 9 digits)
        if (contact) {
            const cleanDigits = contact.replace(/[^0-9]/g, '');
            const isFormatAllowed = /^\+?[0-9\s\-()]+$/.test(contact);
            const isValidPh = isFormatAllowed && (
                (cleanDigits.startsWith('639') && cleanDigits.length === 12) ||
                (cleanDigits.startsWith('09') && cleanDigits.length === 11) ||
                (cleanDigits.startsWith('9') && cleanDigits.length === 10)
            );
            if (!isValidPh) {
                document.getElementById('contactError').textContent = 'Enter a valid Philippine mobile number (e.g. 0917 123 4567 or +63 917 123 4567)';
                isValid = false;
            }
        }

        // Address validation: minimum 5 characters if provided
        if (address) {
            if (address.length < 5) {
                document.getElementById('addressError').textContent = 'Address must be at least 5 characters long';
                isValid = false;
            } else if (address.length > 255) {
                document.getElementById('addressError').textContent = 'Address must not exceed 255 characters';
                isValid = false;
            }
        }

        if (password !== confirm) {
            document.getElementById('confirmError').textContent = 'Passwords do not match';
            isValid = false;
        }
        if (!checkPasswordComplexity(password)) {
            document.getElementById('passwordError').textContent = 'Password must meet all complexity requirements listed above';
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
