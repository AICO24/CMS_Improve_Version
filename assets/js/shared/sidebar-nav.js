/*
  Grouped sidebar: single-open accordion + desktop manual icon-rail.
  Purely additive UI state — never touches .sidebar.collapsed or the
  hamburger checkbox, so that existing mechanism (dashboard.css 200-259,
  553-611) keeps working exactly as before, untouched by this file.

  Single-open accordion: opening one group closes any other open group,
  and the group containing the current page auto-opens on load (state is
  never hardcoded in HTML — computed here from the URL, same source of
  truth api.js's active-link highlighter already uses) so the sidebar
  never shows more than one expanded group's worth of items at once.
*/
(function () {
    document.addEventListener('DOMContentLoaded', function () {
        var sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        var groups = Array.prototype.slice.call(sidebar.querySelectorAll('.nav-group'));

        function closeOthers(exceptGroup) {
            groups.forEach(function (group) {
                if (group !== exceptGroup) group.classList.remove('open');
            });
        }

        // Group expand/collapse — single-open accordion
        groups.forEach(function (group) {
            var header = group.querySelector('.nav-group-header');
            if (!header) return;
            header.addEventListener('click', function () {
                var willOpen = !group.classList.contains('open');
                closeOthers(group);
                group.classList.toggle('open', willOpen);
            });
        });

        // Auto-open the group containing the current page
        var currentPage = window.location.pathname.split('/').pop();
        var activeGroup = groups.find(function (group) {
            return Array.prototype.some.call(group.querySelectorAll('.nav-item[href]'), function (link) {
                var href = link.getAttribute('href');
                return !!href && href.split('?')[0].split('#')[0].split('/').pop() === currentPage;
            });
        });
        if (activeGroup) {
            closeOthers(activeGroup);
            activeGroup.classList.add('open');
        }

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
