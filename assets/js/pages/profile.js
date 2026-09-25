document.addEventListener('DOMContentLoaded', async function() {
    if (!localStorage.getItem('jwt_token') && !sessionStorage.getItem('jwt_token')) {
        window.location.href = `${getFrontendBasePath()}/auth/login.html`;
        return;
    }

    try {
        const user = await api.getMe();
        if (!user) {
            window.location.href = `${getFrontendBasePath()}/auth/login.html`;
            return;
        }

        const fullName = user.full_name || user.username || 'Client';
        const roleLabel = user.role ? (user.role.charAt(0).toUpperCase() + user.role.slice(1)) : 'User';

        const roleName = String(user.role || '').toLowerCase();
        const isAdminOrStaff = roleName === 'admin' || roleName === 'staff';
        document.title = (isAdminOrStaff ? 'Profile' : 'Account Settings') + ' | Cemetery Management';

        const setText = (id, value) => {
            const el = document.getElementById(id);
            if (el) el.innerText = value;
        };

        setText('pageTitle', isAdminOrStaff ? 'Profile' : 'Account Settings');
        setText('userName', fullName);
        setText('userRole', roleLabel);
        setText('sidebarUserName', fullName);
        setText('sidebarUserRole', roleLabel);
        setText('welcomeUserName', fullName);
        setText('welcomeUserUsername', `@${user.username || 'user'}`);
        setText('profileFullName', fullName);
        setText('profileUsername', user.username || '—');
        setText('profileEmail', user.email || '—');
        setText('profileRole', roleLabel);

        const dateEl = document.getElementById('welcomeCurrentDate');
        if (dateEl) {
            const today = new Date();
            dateEl.textContent = today.toLocaleDateString('en-PH', {
                weekday: 'long',
                month: 'short',
                day: 'numeric',
                year: 'numeric'
            });
        }

        const clockEl = document.getElementById('welcomeCurrentTime');
        if (clockEl) {
            const updateClock = () => {
                const now = new Date();
                clockEl.textContent = now.toLocaleTimeString('en-PH', {
                    hour: '2-digit',
                    minute: '2-digit',
                    second: '2-digit',
                    hour12: true
                });
            };
            updateClock();
            setInterval(updateClock, 1000);
        }

        const emailCurrent = document.getElementById('emailCurrent');
        if (emailCurrent) emailCurrent.value = user.email || '';
        const emailCurrentDisplay = document.getElementById('emailCurrentDisplay');
        if (emailCurrentDisplay) emailCurrentDisplay.textContent = user.email || '—';

        const usernameCurrent = document.getElementById('usernameCurrent');
        if (usernameCurrent) usernameCurrent.value = user.username || '';
        const usernameCurrentDisplay = document.getElementById('usernameCurrentDisplay');
        if (usernameCurrentDisplay) usernameCurrentDisplay.textContent = user.username || '—';

        renderSidebarForRole(user.role);
        if (typeof window.initSidebarNav === 'function') {
            window.initSidebarNav();
        }
    } catch (error) {
        console.error('Failed to load profile', error);
        window.location.href = `${getFrontendBasePath()}/auth/login.html`;
        return;
    }

    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', () => api.logout());
    }

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => sidebar.classList.toggle('collapsed'));
    }

    const openNotifications = () => {
        window.location.href = `${getFrontendBasePath()}/pages/notifications.html`;
    };
    const notifBtn = document.getElementById('notificationIcon');
    if (notifBtn) {
        notifBtn.addEventListener('click', openNotifications);
        notifBtn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                openNotifications();
            }
        });
    }

    // ─── Password show/hide toggles ──────────────────────────────────────────
    document.querySelectorAll('.sform-eye').forEach(btn => {
        btn.addEventListener('click', function () {
            const input = document.getElementById(this.dataset.target);
            if (!input) return;
            const show = input.type === 'password';
            input.type = show ? 'text' : 'password';
            const icon = this.querySelector('i');
            if (icon) icon.className = show ? 'fas fa-eye-slash' : 'fas fa-eye';
            this.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        });
    });

    // ─── Email confirm match hint ─────────────────────────────────────────────
    const emailNew     = document.getElementById('emailNew');
    const emailConfirm = document.getElementById('emailConfirm');
    const emailMatchHint = document.getElementById('emailMatchHint');
    function checkEmailMatch() {
        if (!emailConfirm || !emailMatchHint) return;
        if (!emailConfirm.value) { emailMatchHint.textContent = ''; emailMatchHint.className = 'sform-match-hint'; return; }
        const match = emailNew && emailNew.value === emailConfirm.value;
        emailMatchHint.textContent = match ? '✓ Emails match' : '✗ Emails do not match';
        emailMatchHint.className   = 'sform-match-hint ' + (match ? 'sform-match-hint--ok' : 'sform-match-hint--err');
    }
    if (emailNew && emailConfirm) {
        emailNew.addEventListener('input', checkEmailMatch);
        emailConfirm.addEventListener('input', checkEmailMatch);
    }

    // ─── Password strength + requirements ────────────────────────────────────
    const pwCurrent     = document.getElementById('pwCurrent');
    const pwNew         = document.getElementById('pwNew');
    const pwConfirm     = document.getElementById('pwConfirm');
    const pwMatchHint   = document.getElementById('pwMatchHint');
    const pwStrengthFill  = document.getElementById('pwStrengthFill');
    const pwStrengthLabel = document.getElementById('pwStrengthLabel');
    const pwReqLen   = document.getElementById('pwReqLen');
    const pwReqUpper = document.getElementById('pwReqUpper');
    const pwReqNum   = document.getElementById('pwReqNum');
    const pwReqDiff  = document.getElementById('pwReqDiff');

    function updateReq(el, met) {
        if (!el) return;
        const icon = el.querySelector('i');
        if (icon) icon.className = met ? 'fas fa-circle-check' : 'fas fa-circle-xmark';
        el.classList.toggle('pw-req--met', met);
    }

    function checkCommonOrSequential(pw) {
        if (!pw) return false;
        const lower = pw.toLowerCase();
        const commonList = [
            '12345678', '123456789', '1234567890', '0987654321', '987654321',
            'password', 'password1', 'password123', 'admin123', 'admin1234',
            'qwerty123', 'letmein123', 'welcome123', 'iloveyou123', 'cemetery123'
        ];
        for (const c of commonList) {
            if (lower === c || (lower.includes(c) && pw.length <= c.length + 3)) return true;
        }
        if (/(.)\1{3,}/.test(pw)) return true;
        if (/(0123|1234|2345|3456|4567|5678|6789|7890|9876|8765|7654|6543|5432|4321|3210)/.test(pw)) return true;
        const letterSeqs = ['abcd', 'bcde', 'cdef', 'defg', 'efgh', 'fghi', 'ghij', 'hijk', 'ijkl', 'jklm', 'klmn', 'lmno', 'mnop', 'nopq', 'opqr', 'pqrs', 'qrst', 'rstu', 'stuv', 'tuvw', 'uvwx', 'vwxy', 'wxyz'];
        for (const s of letterSeqs) {
            if (lower.includes(s)) return true;
        }
        return false;
    }

    function checkPasswordSecurityClient(pw, current) {
        if (current && pw.trim() === current.trim()) {
            return 'New password cannot be the same as your current password.';
        }
        const lower = pw.toLowerCase();
        const commonList = [
            '12345678', '123456789', '1234567890', '0987654321', '987654321',
            'password', 'password1', 'password123', 'admin123', 'admin1234',
            'qwerty123', 'letmein123', 'welcome123', 'iloveyou123', 'cemetery123', 'test1234'
        ];
        for (const c of commonList) {
            if (lower === c || (lower.includes(c) && pw.length <= c.length + 3)) {
                return 'Password is too common or easily guessed. Please choose a more secure password.';
            }
        }
        if (/(.)\1{3,}/.test(pw)) {
            return 'Password cannot contain 4 or more repeated characters.';
        }
        if (/(0123|1234|2345|3456|4567|5678|6789|7890|9876|8765|7654|6543|5432|4321|3210)/.test(pw)) {
            return 'Password cannot contain sequential numbers (e.g. 1234, 4321).';
        }
        const letterSeqs = ['abcd', 'bcde', 'cdef', 'defg', 'efgh', 'fghi', 'ghij', 'hijk', 'ijkl', 'jklm', 'klmn', 'lmno', 'mnop', 'nopq', 'opqr', 'pqrs', 'qrst', 'rstu', 'stuv', 'tuvw', 'uvwx', 'vwxy', 'wxyz'];
        for (const s of letterSeqs) {
            if (lower.includes(s)) {
                return 'Password cannot contain sequential letters (e.g. abcd).';
            }
        }
        return null;
    }

    function evalStrength(pw) {
        const len   = pw.length >= 8;
        const upper = /[A-Z]/.test(pw);
        const num   = /[0-9]/.test(pw);
        const spec  = /[^A-Za-z0-9]/.test(pw);
        const isCommon = checkCommonOrSequential(pw);
        let score = [len, upper, num, spec].filter(Boolean).length;
        if (isCommon && score > 1) score = 1;
        return { len, upper, num, score, isCommon };
    }

    function updateLivePasswordChecks() {
        if (!pwNew) return;
        const val = pwNew.value;
        const curVal = pwCurrent ? pwCurrent.value : '';
        const { len, upper, num, score, isCommon } = evalStrength(val);

        updateReq(pwReqLen,   len);
        updateReq(pwReqUpper, upper);
        updateReq(pwReqNum,   num);
        const isDiff = Boolean(val && (!curVal || val !== curVal));
        updateReq(pwReqDiff,  isDiff);

        const labels = ['', isCommon ? 'Weak (Common Pattern)' : 'Weak', 'Fair', 'Good', 'Strong'];
        const classes = ['', 'pw-weak', 'pw-fair', 'pw-good', 'pw-strong'];
        if (pwStrengthFill) {
            pwStrengthFill.style.width = (val ? (score / 4 * 100) : 0) + '%';
            pwStrengthFill.className = 'pw-strength-fill ' + (val ? (classes[score] || '') : '');
        }
        if (pwStrengthLabel) pwStrengthLabel.textContent = val ? (labels[score] || '') : '';
        checkPwMatch();
    }

    if (pwNew)     pwNew.addEventListener('input', updateLivePasswordChecks);
    if (pwCurrent) pwCurrent.addEventListener('input', updateLivePasswordChecks);

    function checkPwMatch() {
        if (!pwConfirm || !pwMatchHint) return;
        if (!pwConfirm.value) { pwMatchHint.textContent = ''; pwMatchHint.className = 'sform-match-hint'; return; }
        const match = pwNew && pwNew.value === pwConfirm.value;
        pwMatchHint.textContent = match ? '✓ Passwords match' : '✗ Passwords do not match';
        pwMatchHint.className   = 'sform-match-hint ' + (match ? 'sform-match-hint--ok' : 'sform-match-hint--err');
    }
    if (pwConfirm) pwConfirm.addEventListener('input', checkPwMatch);

    // ─── Username live validation & match hint ──────────────────────────────
    const usernameCurrentInput = document.getElementById('usernameCurrent');
    const usernameNew          = document.getElementById('usernameNew');
    const usernameConfirm      = document.getElementById('usernameConfirm');
    const usernameMatchHint    = document.getElementById('usernameMatchHint');
    const unReqLen             = document.getElementById('unReqLen');
    const unReqFormat          = document.getElementById('unReqFormat');
    const unReqDiff            = document.getElementById('unReqDiff');

    function updateLiveUsernameChecks() {
        if (!usernameNew) return;
        const val = usernameNew.value.trim();
        const curVal = usernameCurrentInput ? usernameCurrentInput.value.trim() : '';

        const lenMet    = val.length >= 3 && val.length <= 30;
        const formatMet = val.length > 0 && /^[a-zA-Z0-9_.-]+$/.test(val);
        const diffMet   = Boolean(val && (!curVal || val.toLowerCase() !== curVal.toLowerCase()));

        updateReq(unReqLen,    lenMet);
        updateReq(unReqFormat, formatMet);
        updateReq(unReqDiff,   diffMet);

        checkUsernameMatch();
    }

    function checkUsernameMatch() {
        if (!usernameConfirm || !usernameMatchHint) return;
        if (!usernameConfirm.value) {
            usernameMatchHint.textContent = '';
            usernameMatchHint.className = 'sform-match-hint';
            return;
        }
        const match = usernameNew && usernameNew.value.trim() === usernameConfirm.value.trim();
        usernameMatchHint.textContent = match ? '✓ Usernames match' : '✗ Usernames do not match';
        usernameMatchHint.className   = 'sform-match-hint ' + (match ? 'sform-match-hint--ok' : 'sform-match-hint--err');
    }

    if (usernameNew)     usernameNew.addEventListener('input', updateLiveUsernameChecks);
    if (usernameConfirm) usernameConfirm.addEventListener('input', checkUsernameMatch);

    // ─── FORM: Email ─────────────────────────────────────────────────────────
    const emailForm = document.getElementById('emailForm');
    if (emailForm) {
        emailForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const btn = document.getElementById('emailSaveBtn');

            const newEmail   = document.getElementById('emailNew').value.trim();
            const confEmail  = document.getElementById('emailConfirm').value.trim();
            const pwForEmail = document.getElementById('emailPassword').value;

            hideAlert('emailFormAlert');

            if (!newEmail || !confEmail || !pwForEmail) {
                showAlert('emailFormAlert', 'error', 'All fields are required.'); return;
            }
            if (newEmail !== confEmail) {
                showAlert('emailFormAlert', 'error', 'New email and confirmation do not match.'); return;
            }
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
                showAlert('emailFormAlert', 'error', 'Please enter a valid email address.'); return;
            }
            const currentEmailEl = document.getElementById('emailCurrent');
            if (currentEmailEl && newEmail.toLowerCase() === currentEmailEl.value.trim().toLowerCase()) {
                showAlert('emailFormAlert', 'error', 'The new email must be different from your current email.'); return;
            }

            setFormLoading(btn, true, 'Updating…');

            try {
                const res = await api.request('auth/profile', {
                    method: 'PUT',
                    body: { email: newEmail, current_password: pwForEmail }
                });
                if (res.success) {
                    showAlert('emailFormAlert', 'success', '<i class="fas fa-circle-check"></i> Email updated successfully.');
                    if (currentEmailEl) currentEmailEl.value = newEmail;
                    const emailCurrentDisplay = document.getElementById('emailCurrentDisplay');
                    if (emailCurrentDisplay) emailCurrentDisplay.textContent = newEmail;
                    const pEmailEl = document.getElementById('profileEmail');
                    if (pEmailEl) pEmailEl.textContent = newEmail;
                    document.getElementById('emailNew').value = '';
                    document.getElementById('emailConfirm').value = '';
                    document.getElementById('emailPassword').value = '';
                    if (emailMatchHint) emailMatchHint.textContent = '';
                } else {
                    showAlert('emailFormAlert', 'error', res.error || 'Failed to update email.');
                }
            } catch (err) {
                showAlert('emailFormAlert', 'error', err.message || 'An unexpected error occurred.');
            } finally {
                setFormLoading(btn, false, '<i class="fas fa-paper-plane"></i> Update Email Address');
            }
        });
    }

    // ─── FORM: Username ──────────────────────────────────────────────────────
    const usernameForm = document.getElementById('usernameForm');
    if (usernameForm) {
        usernameForm.addEventListener('submit', async function (e) {
            e.preventDefault();
            const btn = document.getElementById('usernameSaveBtn');

            const newUsername    = (document.getElementById('usernameNew')?.value || '').trim();
            const confUsername   = (document.getElementById('usernameConfirm')?.value || '').trim();
            const pwForUsername  = document.getElementById('usernamePassword')?.value || '';
            const currentUsernameEl = document.getElementById('usernameCurrent');
            const currentUsername   = currentUsernameEl ? currentUsernameEl.value.trim() : '';

            hideAlert('usernameFormAlert');

            if (!newUsername || !confUsername || !pwForUsername) {
                showAlert('usernameFormAlert', 'error', 'All fields are required.');
                return;
            }

            // Security Validation (modeled after change password security validation):
            // 1. Old username restriction
            if (currentUsername && newUsername.toLowerCase() === currentUsername.toLowerCase()) {
                showAlert('usernameFormAlert', 'error', 'New username cannot be the same as your current username.');
                return;
            }

            // 2. Confirmation matching
            if (newUsername !== confUsername) {
                showAlert('usernameFormAlert', 'error', 'New username and confirmation do not match.');
                return;
            }

            // 3. Length check (3 - 30 characters)
            if (newUsername.length < 3 || newUsername.length > 30) {
                showAlert('usernameFormAlert', 'error', 'Username must be between 3 and 30 characters.');
                return;
            }

            // 4. Format check (no spaces, only letters, numbers, _, ., -)
            if (!/^[a-zA-Z0-9_.-]+$/.test(newUsername)) {
                showAlert('usernameFormAlert', 'error', 'Username can only contain letters, numbers, dots, hyphens, and underscores (no spaces).');
                return;
            }

            // 5. Disallow purely numeric usernames
            if (/^\d+$/.test(newUsername)) {
                showAlert('usernameFormAlert', 'error', 'Username cannot be purely numbers. Please include at least one letter.');
                return;
            }

            // 6. Disallow reserved or trivial usernames
            const reserved = ['admin', 'administrator', 'root', 'user', 'guest', 'superuser', 'system', 'null', 'undefined', 'test', 'anonymous', 'moderator', 'support', 'owner'];
            if (reserved.includes(newUsername.toLowerCase())) {
                showAlert('usernameFormAlert', 'error', 'This username is reserved or not allowed. Please choose a different username.');
                return;
            }

            setFormLoading(btn, true, 'Updating…');

            try {
                const res = await api.request('auth/profile', {
                    method: 'PUT',
                    body: {
                        username: newUsername,
                        username_confirm: confUsername,
                        current_password: pwForUsername
                    }
                });

                if (res.success) {
                    showAlert('usernameFormAlert', 'success', '<i class="fas fa-circle-check"></i> Username updated successfully.');

                    // Update JWT token in localStorage if refreshed token returned
                    if (res.token) {
                        localStorage.setItem('jwt_token', res.token);
                    }

                    // Update displayed username across page elements
                    if (currentUsernameEl) currentUsernameEl.value = newUsername;
                    const usernameCurrentDisplay = document.getElementById('usernameCurrentDisplay');
                    if (usernameCurrentDisplay) usernameCurrentDisplay.textContent = newUsername;
                    const pUsernameEl = document.getElementById('profileUsername');
                    if (pUsernameEl) pUsernameEl.textContent = newUsername;
                    const welcomeUserEl = document.getElementById('welcomeUserUsername');
                    if (welcomeUserEl) welcomeUserEl.textContent = `@${newUsername}`;

                    // Reset form inputs
                    document.getElementById('usernameNew').value = '';
                    document.getElementById('usernameConfirm').value = '';
                    document.getElementById('usernamePassword').value = '';
                    if (usernameMatchHint) {
                        usernameMatchHint.textContent = '';
                        usernameMatchHint.className = 'sform-match-hint';
                    }
                    updateLiveUsernameChecks();
                } else {
                    showAlert('usernameFormAlert', 'error', res.error || 'Failed to update username.');
                }
            } catch (err) {
                showAlert('usernameFormAlert', 'error', err.message || 'An unexpected error occurred.');
            } finally {
                setFormLoading(btn, false, '<i class="fas fa-user-check"></i> Update Username');
            }
        });
    }

    // ─── FORM: Password with Session Choice Modal ───────────────────────────
    const passwordForm     = document.getElementById('passwordForm');
    const sessionModal     = document.getElementById('changePwSessionModal');
    const pwModalCloseBtn  = document.getElementById('pwModalCloseBtn');
    const pwModalCancelBtn = document.getElementById('pwModalCancelBtn');
    const pwModalYesBtn    = document.getElementById('pwModalYesBtn');
    const pwModalNoBtn     = document.getElementById('pwModalNoBtn');

    let pendingPwPayload = null;

    function closeSessionModal() {
        if (sessionModal) sessionModal.style.display = 'none';
        pendingPwPayload = null;
        if (pwModalYesBtn) {
            pwModalYesBtn.disabled = false;
            pwModalYesBtn.innerHTML = '<i class="fas fa-sign-out-alt"></i> Yes';
        }
        if (pwModalNoBtn) {
            pwModalNoBtn.disabled = false;
            pwModalNoBtn.innerHTML = '<i class="fas fa-check"></i> No';
        }
        if (pwModalCancelBtn) pwModalCancelBtn.disabled = false;
    }

    if (pwModalCloseBtn)  pwModalCloseBtn.addEventListener('click', closeSessionModal);
    if (pwModalCancelBtn) pwModalCancelBtn.addEventListener('click', closeSessionModal);
    if (sessionModal) {
        sessionModal.addEventListener('click', function (e) {
            if (e.target === sessionModal) closeSessionModal();
        });
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && sessionModal.style.display === 'flex') {
                closeSessionModal();
            }
        });
    }

    async function executePasswordChange(logoutAll) {
        if (!pendingPwPayload) return;
        const targetBtn = logoutAll ? pwModalYesBtn : pwModalNoBtn;
        const otherBtn  = logoutAll ? pwModalNoBtn : pwModalYesBtn;

        if (targetBtn) {
            targetBtn.disabled = true;
            targetBtn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ' + (logoutAll ? 'Logging out…' : 'Saving…');
        }
        if (otherBtn) otherBtn.disabled = true;
        if (pwModalCancelBtn) pwModalCancelBtn.disabled = true;

        try {
            const res = await api.request('auth/change-password', {
                method: 'POST',
                body: {
                    ...pendingPwPayload,
                    logout_all: logoutAll
                }
            });

            if (res.success) {
                closeSessionModal();
                if (logoutAll) {
                    localStorage.removeItem('jwt_token');
                    sessionStorage.clear();
                    window.location.href = `${getFrontendBasePath()}/auth/login.html?pw_changed=1`;
                    return;
                }

                if (res.token) {
                    api.setToken(res.token);
                }
                showAlert('passwordFormAlert', 'success',
                    '<i class="fas fa-circle-check"></i> Password changed successfully. Your current session remains active.');
                document.getElementById('pwCurrent').value = '';
                document.getElementById('pwNew').value     = '';
                document.getElementById('pwConfirm').value = '';
                if (pwStrengthFill)  { pwStrengthFill.style.width = '0'; pwStrengthFill.className = 'pw-strength-fill'; }
                if (pwStrengthLabel) pwStrengthLabel.textContent = '';
                if (pwMatchHint)     { pwMatchHint.textContent = ''; pwMatchHint.className = 'sform-match-hint'; }
                [pwReqLen, pwReqUpper, pwReqNum].forEach(el => updateReq(el, false));
            } else {
                closeSessionModal();
                showAlert('passwordFormAlert', 'error', res.error || 'Failed to change password.');
            }
        } catch (err) {
            closeSessionModal();
            showAlert('passwordFormAlert', 'error', err.message || 'An unexpected error occurred.');
        }
    }

    if (pwModalYesBtn) {
        pwModalYesBtn.addEventListener('click', () => executePasswordChange(true));
    }
    if (pwModalNoBtn) {
        pwModalNoBtn.addEventListener('click', () => executePasswordChange(false));
    }

    if (passwordForm) {
        passwordForm.addEventListener('submit', function (e) {
            e.preventDefault();

            const current = document.getElementById('pwCurrent').value;
            const newPw   = document.getElementById('pwNew').value;
            const confirm = document.getElementById('pwConfirm').value;

            hideAlert('passwordFormAlert');

            if (!current || !newPw || !confirm) {
                showAlert('passwordFormAlert', 'error', 'All three fields are required.'); return;
            }
            if (newPw !== confirm) {
                showAlert('passwordFormAlert', 'error', 'New password and confirmation do not match.'); return;
            }
            if (newPw.length < 8) {
                showAlert('passwordFormAlert', 'error', 'Password must be at least 8 characters.'); return;
            }
            if (!/[A-Z]/.test(newPw)) {
                showAlert('passwordFormAlert', 'error', 'Password must contain at least one uppercase letter.'); return;
            }
            if (!/[0-9]/.test(newPw)) {
                showAlert('passwordFormAlert', 'error', 'Password must contain at least one number.'); return;
            }
            if (current.trim() === newPw.trim()) {
                showAlert('passwordFormAlert', 'error', 'New password cannot be the same as your current password.'); return;
            }
            const secErr = checkPasswordSecurityClient(newPw, current);
            if (secErr) {
                showAlert('passwordFormAlert', 'error', secErr); return;
            }

            // Stash payload and open session choice modal
            pendingPwPayload = {
                current_password: current,
                new_password: newPw,
                confirm_password: confirm
            };

            if (sessionModal) {
                sessionModal.style.display = 'flex';
            } else {
                executePasswordChange(false);
            }
        });
    }

    function showAlert(containerId, type, html) {
        const el = document.getElementById(containerId);
        if (!el) return;
        el.innerHTML = html;
        el.className = 'sform-alert sform-alert--' + type;
        el.style.display = 'flex';
        if (type === 'success') {
            setTimeout(() => { el.style.display = 'none'; }, 6000);
        }
    }

    function hideAlert(containerId) {
        const el = document.getElementById(containerId);
        if (el) { el.style.display = 'none'; el.textContent = ''; }
    }

    function setFormLoading(btn, loading, label) {
        if (!btn) return;
        btn.disabled = loading;
        btn.innerHTML = loading
            ? '<i class="fas fa-spinner fa-spin"></i> ' + label
            : label;
    }

    function initLiveClock() {
        const timeEl = document.getElementById('footerLiveTime');
        const yearEl = document.getElementById('footerYear');
        if (yearEl) yearEl.textContent = String(new Date().getFullYear());
        if (!timeEl) return;
        const tick = () => {
            const now = new Date();
            timeEl.textContent = now.toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
                hour: 'numeric',
                minute: '2-digit',
                second: '2-digit',
                hour12: true
            });
        };
        tick();
        setInterval(tick, 1000);
    }

    async function updateNotificationBadge() {
        try {
            const result = await api.request('notifications/unread-count', { method: 'GET' });
            const badge = document.getElementById('notificationBadge');
            if (badge) {
                const count = Number(result.count || 0);
                badge.textContent = String(count);
                badge.style.display = 'flex';
            }
        } catch (error) {
            console.error('Failed to load notification badge', error);
        }
    }

    initLiveClock();
    await updateNotificationBadge();
    setInterval(updateNotificationBadge, 30000);
});
