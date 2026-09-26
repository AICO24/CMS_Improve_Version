/**
 * LANDING PAGE CONTROLLER — CEMETERY MANAGEMENT SYSTEM (CMS)
 * Handles theme persistence (cms-theme), mobile drawer navigation,
 * scroll-spy navigation highlighting, and accessible anchor scrolling.
 */

(function () {
    // =========================================================================
    // 1. THEME INITIALIZATION & PERSISTENCE (Synchronized with CMS Standard)
    // =========================================================================
    function getStoredTheme() {
        try {
            return localStorage.getItem('cms-theme');
        } catch (e) {
            return null;
        }
    }

    function setStoredTheme(theme) {
        try {
            localStorage.setItem('cms-theme', theme);
        } catch (e) {}
    }

    function applyTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);
        if (document.body) {
            document.body.setAttribute('data-theme', theme);
            document.body.classList.toggle('dark', theme === 'dark');
        }

        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.checked = (theme === 'dark');
        }
    }

    // Apply immediately if DOM is ready
    const initialTheme = getStoredTheme() || (window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
    applyTheme(initialTheme);

    // =========================================================================
    // 2. WAIT FOR ASYNCHRONOUS COMPONENT LOADING
    // =========================================================================
    document.addEventListener('components:loaded', function () {
        // Re-sync toggle checkbox after navbar fragment is inserted
        const currentTheme = getStoredTheme() || initialTheme;
        applyTheme(currentTheme);

        const themeToggle = document.getElementById('themeToggle');
        if (themeToggle) {
            themeToggle.checked = (currentTheme === 'dark');
            themeToggle.addEventListener('change', function () {
                const nextTheme = themeToggle.checked ? 'dark' : 'light';
                applyTheme(nextTheme);
                setStoredTheme(nextTheme);
            });
        }

        // =====================================================================
        // 3. MOBILE NAVIGATION DRAWER
        // =====================================================================
        const mobileNavToggle = document.getElementById('mobileNavToggle');
        const mobileNavDrawer = document.getElementById('mobileNavDrawer');
        const mobileNavClose = document.getElementById('mobileNavClose');
        const mobileNavBackdrop = document.getElementById('mobileNavBackdrop');

        function openMobileMenu() {
            if (!mobileNavDrawer) return;
            mobileNavDrawer.classList.add('open');
            mobileNavDrawer.setAttribute('aria-hidden', 'false');
            if (mobileNavToggle) {
                mobileNavToggle.setAttribute('aria-expanded', 'true');
            }
            document.body.style.overflow = 'hidden';
        }

        function closeMobileMenu() {
            if (!mobileNavDrawer) return;
            mobileNavDrawer.classList.remove('open');
            mobileNavDrawer.setAttribute('aria-hidden', 'true');
            if (mobileNavToggle) {
                mobileNavToggle.setAttribute('aria-expanded', 'false');
            }
            document.body.style.overflow = '';
        }

        if (mobileNavToggle) {
            mobileNavToggle.addEventListener('click', function () {
                const isOpen = mobileNavDrawer && mobileNavDrawer.classList.contains('open');
                if (isOpen) {
                    closeMobileMenu();
                } else {
                    openMobileMenu();
                }
            });
        }

        if (mobileNavClose) {
            mobileNavClose.addEventListener('click', closeMobileMenu);
        }

        if (mobileNavBackdrop) {
            mobileNavBackdrop.addEventListener('click', closeMobileMenu);
        }

        // Close mobile drawer when pressing Escape
        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && mobileNavDrawer && mobileNavDrawer.classList.contains('open')) {
                closeMobileMenu();
            }
        });

        // Close drawer when any mobile nav link is clicked
        const mobileLinks = document.querySelectorAll('.mobile-nav-link, .btn-mobile-auth');
        mobileLinks.forEach(function (link) {
            link.addEventListener('click', closeMobileMenu);
        });

        // =====================================================================
        // 4. ACTIVE NAV LINK ON SCROLL (SCROLL-SPY)
        // =====================================================================
        const sections = document.querySelectorAll('section[id]');
        const desktopNavLinks = document.querySelectorAll('.nav-links .nav-link');

        function updateActiveNavLink() {
            const scrollY = window.pageYOffset || document.documentElement.scrollTop;
            let currentSectionId = '';

            sections.forEach(function (section) {
                const sectionTop = section.offsetTop - 140;
                const sectionHeight = section.offsetHeight;
                if (scrollY >= sectionTop && scrollY < sectionTop + sectionHeight) {
                    currentSectionId = section.getAttribute('id');
                }
            });

            if (currentSectionId) {
                desktopNavLinks.forEach(function (link) {
                    link.classList.remove('active');
                    const href = link.getAttribute('href');
                    if (href === '#' + currentSectionId) {
                        link.classList.add('active');
                    }
                });
            }
        }

        window.addEventListener('scroll', updateActiveNavLink, { passive: true });
        updateActiveNavLink();

        // =====================================================================
        // 5. ACCESSIBLE SMOOTH SCROLLING FOR IN-PAGE ANCHORS
        // =====================================================================
        document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
            anchor.addEventListener('click', function (e) {
                const href = this.getAttribute('href');
                if (href === '#' || href === '#!') return;

                const targetElement = document.querySelector(href);
                if (targetElement) {
                    e.preventDefault();
                    const navbarHeight = 76;
                    const elementPosition = targetElement.getBoundingClientRect().top;
                    const offsetPosition = elementPosition + window.pageYOffset - navbarHeight;

                    window.scrollTo({
                        top: offsetPosition,
                        behavior: 'smooth'
                    });

                    // Set focus to the target section for screen readers
                    targetElement.setAttribute('tabindex', '-1');
                    targetElement.focus({ preventScroll: true });
                }
            });
        });
    });
})();