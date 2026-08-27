/*
  Grouped sidebar: group expand/collapse + desktop manual icon-rail.
  Purely additive UI state — never touches .sidebar.collapsed or the
  hamburger checkbox, so that existing mechanism (dashboard.css 200-259,
  553-611) keeps working exactly as before, untouched by this file.
*/
(function () {
    document.addEventListener('DOMContentLoaded', function () {
        var sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        // Group expand/collapse
        var groups = sidebar.querySelectorAll('.nav-group');
        groups.forEach(function (group) {
            var header = group.querySelector('.nav-group-header');
            if (!header) return;
            header.addEventListener('click', function () {
                group.classList.toggle('open');
            });
        });

        // Manual icon-rail (desktop only — CSS hides the button below 1025px)
        var railBtn = document.getElementById('railToggleBtn');
        if (!railBtn) return;

        var stored = null;
        try {
            stored = localStorage.getItem('cms-sidebar-rail');
        } catch (e) {
            /* storage unavailable — falls through to default expanded state */
        }
        if (stored === '1') {
            sidebar.classList.add('rail-manual');
        }

        railBtn.addEventListener('click', function () {
            var isRail = sidebar.classList.toggle('rail-manual');
            try {
                localStorage.setItem('cms-sidebar-rail', isRail ? '1' : '0');
            } catch (e) {
                /* storage unavailable — toggle still applies for this page view */
            }
        });
    });
})();
