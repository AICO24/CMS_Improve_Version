/*
  Dark/light theme toggle. The actual `data-theme` attribute is set as
  early as possible by a tiny inline snippet at the top of <body> (to
  avoid a flash of the wrong theme before this file loads) — this file
  only wires the button click and keeps the icon/aria state in sync.
*/
(function () {
    function currentTheme() {
        return document.body.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function updateButton(btn, theme) {
        var icon = btn.querySelector('i');
        if (icon) {
            icon.className = theme === 'dark' ? 'fas fa-sun' : 'fas fa-moon';
        }
        btn.setAttribute('aria-pressed', theme === 'dark' ? 'true' : 'false');
        btn.setAttribute('title', theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode');
    }

    document.addEventListener('DOMContentLoaded', function () {
        var btn = document.getElementById('themeToggleBtn');
        if (!btn) return;

        updateButton(btn, currentTheme());

        btn.addEventListener('click', function () {
            var next = currentTheme() === 'dark' ? 'light' : 'dark';
            document.body.setAttribute('data-theme', next);
            try {
                localStorage.setItem('cms-theme', next);
            } catch (e) {
                /* storage unavailable (e.g. private mode) — theme still applies for this page view */
            }
            updateButton(btn, next);
        });
    });
})();
