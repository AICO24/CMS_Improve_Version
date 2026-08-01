// ============================================
//  MOBILE NAV TOGGLE
// ============================================
const hamburger = document.getElementById('hamburger');
const navLinks = document.getElementById('navLinks');
const themeToggle = document.getElementById('themeToggle');
const storedTheme = localStorage.getItem('siteTheme');

const applyTheme = theme => {
    document.body.classList.toggle('dark', theme === 'dark');
    if (themeToggle) {
        themeToggle.checked = theme === 'dark';
    }
};

if (storedTheme) {
    applyTheme(storedTheme);
} else {
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    applyTheme(prefersDark ? 'dark' : 'light');
}

if (themeToggle) {
    themeToggle.addEventListener('change', () => {
        const nextTheme = themeToggle.checked ? 'dark' : 'light';
        applyTheme(nextTheme);
        localStorage.setItem('siteTheme', nextTheme);
    });
}

if (hamburger && navLinks) {
    hamburger.addEventListener('click', () => {
        navLinks.classList.toggle('open');
    });

    // Close nav when a link is clicked
    navLinks.querySelectorAll('a').forEach(link => {
        link.addEventListener('click', () => {
            navLinks.classList.remove('open');
        });
    });
}

// ============================================
//  ACTIVE NAV LINK ON SCROLL
// ============================================
const sections = document.querySelectorAll('.section');
const navItems = document.querySelectorAll('.nav-links a:not(.btn-login)');

window.addEventListener('scroll', () => {
    let current = '';
    sections.forEach(section => {
        const sectionTop = section.offsetTop - 120;
        if (window.scrollY >= sectionTop) {
            current = section.getAttribute('id');
        }
    });

    navItems.forEach(link => {
        link.classList.remove('active');
        if (link.getAttribute('href') === `#${current}`) {
            link.classList.add('active');
        }
    });
});

// ============================================
//  SMOOTH SCROLL FOR ANCHOR LINKS
// ============================================
document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', function (e) {
        const target = document.querySelector(this.getAttribute('href'));
        if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: 'smooth' });
        }
    });
});