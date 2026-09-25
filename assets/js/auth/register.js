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
    const passwordChecklist = document.getElementById('passwordChecklist');
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
            const val = this.value;
            if (passwordChecklist) {
                if (val.length > 0) {
                    passwordChecklist.style.display = 'block';
                } else {
                    passwordChecklist.style.display = 'none';
                }
            }
            checkPasswordComplexity(val);
        });

        passwordInput.addEventListener('focus', function() {
            if (passwordChecklist && this.value.length > 0) {
                passwordChecklist.style.display = 'block';
            }
        });
    }

    const contactInput = document.getElementById('contact_number');
    if (contactInput) {
        // Enforce numeric only and hard truncate to 11 digits on paste or typing
        contactInput.addEventListener('input', function() {
            this.value = this.value.replace(/[^0-9]/g, '').slice(0, 11);
        });

        // Block typing non-numbers and prevent typing once 11 numbers are entered
        contactInput.addEventListener('keydown', function(e) {
            // Allow control keys (backspace, delete, tab, arrows)
            const allowedKeys = ['Backspace', 'Delete', 'ArrowLeft', 'ArrowRight', 'Tab', 'Home', 'End'];
            if (allowedKeys.includes(e.key) || e.ctrlKey || e.metaKey) {
                return;
            }
            // Block non-digits
            if (!/^[0-9]$/.test(e.key)) {
                e.preventDefault();
                return;
            }
            // Block typing when 11 digits are already present (unless text is selected for replacement)
            const clean = this.value.replace(/[^0-9]/g, '');
            if (clean.length >= 11 && this.selectionStart === this.selectionEnd) {
                e.preventDefault();
            }
        });
    }

    // Initialize Philippine Locations Cascading Controller
    let locationController = null;
    const regionSelect = document.getElementById('reg_region');
    const provinceSelect = document.getElementById('reg_province');
    const citySelect = document.getElementById('reg_city');
    const districtSelect = document.getElementById('reg_district');
    const barangaySelect = document.getElementById('reg_barangay');
    const streetInput = document.getElementById('reg_street');
    const addressInput = document.getElementById('address');

    if (window.PhilippineLocations && typeof window.PhilippineLocations.initHierarchy === 'function' && regionSelect) {
        locationController = window.PhilippineLocations.initHierarchy({
            regionSelect: regionSelect,
            provinceSelect: provinceSelect,
            citySelect: citySelect,
            districtSelect: districtSelect,
            barangaySelect: barangaySelect,
            streetInput: streetInput,
            combinedAddressInput: addressInput
        });
    }

    // ── Multi-Step Wizard Controller ───────────────────────────
    const step1Pane = document.getElementById('step1Pane');
    const step2Pane = document.getElementById('step2Pane');
    const stepperStep1 = document.getElementById('stepperStep1');
    const stepperStep2 = document.getElementById('stepperStep2');
    const stepperDivider = document.getElementById('stepperDivider');
    const btnNextStep = document.getElementById('btnNextStep');
    const btnPrevStep = document.getElementById('btnPrevStep');
    const registerStepper = document.getElementById('registerStepper');

    function goToStep(stepNum) {
        if (stepNum === 1) {
            if (step1Pane) step1Pane.style.display = 'flex';
            if (step2Pane) step2Pane.style.display = 'none';
            if (stepperStep1) {
                stepperStep1.classList.add('active');
                stepperStep1.classList.remove('completed');
            }
            if (stepperStep2) {
                stepperStep2.classList.remove('active', 'completed');
            }
            if (stepperDivider) {
                stepperDivider.classList.remove('active');
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        } else if (stepNum === 2) {
            if (step1Pane) step1Pane.style.display = 'none';
            if (step2Pane) step2Pane.style.display = 'flex';
            if (stepperStep1) {
                stepperStep1.classList.remove('active');
                stepperStep1.classList.add('completed');
            }
            if (stepperStep2) {
                stepperStep2.classList.add('active');
                stepperStep2.classList.remove('completed');
            }
            if (stepperDivider) {
                stepperDivider.classList.add('active');
            }
            window.scrollTo({ top: 0, behavior: 'smooth' });
        }
    }

    function validateStep1() {
        const firstName = (document.getElementById('first_name')?.value || '').trim();
        const middleName = (document.getElementById('middle_name')?.value || '').trim();
        const lastName = (document.getElementById('last_name')?.value || '').trim();
        const suffix = (document.getElementById('suffix')?.value || '').trim();
        const email = (document.getElementById('email')?.value || '').trim().toLowerCase();
        const username = (document.getElementById('username')?.value || '').trim();
        const contact = (document.getElementById('contact_number')?.value || '').trim();

        ['firstNameError', 'middleNameError', 'lastNameError', 'suffixError', 'emailError', 'contactError', 'usernameError'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '';
        });
        alertBox.className = 'alert';
        alertBox.classList.remove('show');

        let isValid = true;
        let firstInvalidField = null;

        // Name validation
        if (!firstName || firstName.length < 2 || firstName.length > 60) {
            const errEl = document.getElementById('firstNameError');
            if (errEl) errEl.textContent = 'First name is required (2 to 60 characters)';
            isValid = false;
            if (!firstInvalidField) firstInvalidField = document.getElementById('first_name');
        }
        if (middleName && middleName.length > 60) {
            const errEl = document.getElementById('middleNameError');
            if (errEl) errEl.textContent = 'Middle name must not exceed 60 characters';
            isValid = false;
            if (!firstInvalidField) firstInvalidField = document.getElementById('middle_name');
        }
        if (!lastName || lastName.length < 2 || lastName.length > 60) {
            const errEl = document.getElementById('lastNameError');
            if (errEl) errEl.textContent = 'Last name is required (2 to 60 characters)';
            isValid = false;
            if (!firstInvalidField) firstInvalidField = document.getElementById('last_name');
        }
        if (suffix && suffix.length > 15) {
            const errEl = document.getElementById('suffixError');
            if (errEl) errEl.textContent = 'Suffix must not exceed 15 characters';
            isValid = false;
            if (!firstInvalidField) firstInvalidField = document.getElementById('suffix');
        }

        // Email validation
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            const errEl = document.getElementById('emailError');
            if (errEl) errEl.textContent = 'A valid email address is required';
            isValid = false;
            if (!firstInvalidField) firstInvalidField = document.getElementById('email');
        }

        // Username validation (optional, but restricted format if provided)
        if (username && !/^[a-zA-Z0-9._-]{3,40}$/.test(username)) {
            const errEl = document.getElementById('usernameError');
            if (errEl) errEl.textContent = 'Use 3-40 letters, numbers, dots, underscores, or hyphens';
            isValid = false;
            if (!firstInvalidField) firstInvalidField = document.getElementById('username');
        }

        // Philippine mobile number validation (must be 11 digits starting with 09)
        if (contact) {
            const cleanDigits = contact.replace(/[^0-9]/g, '');
            if (!/^09\d{9}$/.test(cleanDigits)) {
                const errEl = document.getElementById('contactError');
                if (errEl) errEl.textContent = 'Contact number must be exactly 11 digits starting with 09 (e.g. 09171234567)';
                isValid = false;
                if (!firstInvalidField) firstInvalidField = document.getElementById('contact_number');
            }
        }

        if (!isValid) {
            alertBox.textContent = 'Please complete the required personal and contact details before proceeding.';
            alertBox.className = 'alert alert-danger show';
            if (firstInvalidField) firstInvalidField.focus();
        }

        return isValid;
    }

    if (btnNextStep) {
        btnNextStep.addEventListener('click', function(e) {
            e.preventDefault();
            if (validateStep1()) {
                goToStep(2);
            }
        });
    }

    if (btnPrevStep) {
        btnPrevStep.addEventListener('click', function(e) {
            e.preventDefault();
            goToStep(1);
        });
    }

    if (stepperStep1) {
        stepperStep1.addEventListener('click', function() {
            if (stepperStep1.classList.contains('completed')) {
                goToStep(1);
            }
        });
    }

    form.addEventListener('submit', async function(e) {
        e.preventDefault();

        // Defensive: Ensure Step 1 is valid before proceeding with submit
        if (!validateStep1()) {
            goToStep(1);
            return;
        }

        const firstName = (document.getElementById('first_name')?.value || '').trim();
        const middleName = (document.getElementById('middle_name')?.value || '').trim();
        const lastName = (document.getElementById('last_name')?.value || '').trim();
        const suffix = (document.getElementById('suffix')?.value || '').trim();
        const email = document.getElementById('email').value.trim().toLowerCase();
        const username = document.getElementById('username').value.trim();
        const contact = document.getElementById('contact_number').value.trim();
        let address = document.getElementById('address')?.value.trim() || '';
        const password = document.getElementById('password').value;
        const confirm = document.getElementById('confirm_password').value;

        // Clear Step 2 errors
        ['addressError', 'passwordError', 'confirmError'].forEach(id => {
            const el = document.getElementById(id);
            if (el) el.textContent = '';
        });
        alertBox.className = 'alert';
        alertBox.classList.remove('show');

        let isValid = true;
        const fullName = `${firstName} ${middleName ? middleName + ' ' : ''}${lastName}${suffix ? ' ' + suffix : ''}`.trim();

        const streetVal = (document.getElementById('reg_street')?.value || '').trim();
        address = (document.getElementById('address')?.value || '').trim();
        if (!address && streetVal) {
            address = streetVal;
        }
        if (!address && locationController) {
            const lv = locationController.getValues();
            if (lv && lv.combinedAddress) {
                address = lv.combinedAddress.trim();
            }
        }

        // Address validation: minimum 5 characters and meaningful content if provided
        if (address) {
            const alphaNumCount = (address.match(/[a-zA-Z0-9]/g) || []).length;
            if (address.length < 5) {
                document.getElementById('addressError').textContent = 'Address must be at least 5 characters long';
                isValid = false;
            } else if (address.length > 255) {
                document.getElementById('addressError').textContent = 'Address must not exceed 255 characters';
                isValid = false;
            } else if (alphaNumCount < 3) {
                document.getElementById('addressError').textContent = 'Please provide a valid address with street or location details';
                isValid = false;
            }
        }

        if (password !== confirm) {
            document.getElementById('confirmError').textContent = 'Passwords do not match';
            isValid = false;
        }
        if (!checkPasswordComplexity(password)) {
            if (passwordChecklist) passwordChecklist.style.display = 'block';
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
            const locVals = locationController ? locationController.getValues() : {};

            const payload = {
                first_name: firstName,
                middle_name: middleName || null,
                last_name: lastName,
                suffix: suffix || null,
                full_name: fullName,
                email: email,
                username: username || null,
                contact_number: contact || null,
                region: locVals.region || null,
                province: locVals.province || null,
                city: locVals.city || null,
                district: locVals.district || null,
                barangay: locVals.barangay || null,
                address: address || locVals.combinedAddress || null,
                password: password,
                confirm_password: confirm,
            };

            const result = await api.register(payload);

            if (result && result.success) {
                registeredEmail = email;

                if (result.verification_required && verificationPanel) {
                    form.style.display = 'none';
                    if (registerStepper) {
                        registerStepper.style.display = 'none';
                    }
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
