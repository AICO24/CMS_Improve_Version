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

  Exposed as window.initSidebarNav (Batch 5) so pages whose sidebar is
  rebuilt at runtime (renderSidebarForRole() in api.js, for
  payments/notifications/profile/settings.html) can re-run
  initialization after replacing .sidebar-nav's innerHTML — the old
  .nav-group-header elements (and any listeners on them) are destroyed
  along with the old markup, so re-attaching to the fresh elements each
  call is safe by construction. #railToggleBtn lives in .sidebar-header,
  outside .sidebar-nav, so it's never replaced by a rebuild — its
  listener is guarded by a data-attribute flag so repeated init calls
  never attach a second one to the same persistent button.
*/
(function () {
    function initSidebarNav() {
        var sidebar = document.querySelector('.sidebar');
        if (!sidebar) return;

        var groups = Array.prototype.slice.call(sidebar.querySelectorAll('.nav-group'));

        function closeOthers(exceptGroup) {
            groups.forEach(function (group) {
                if (group !== exceptGroup && !group.classList.contains('is-static')) group.classList.remove('open');
            });
        }

        // Group expand/collapse — single-open accordion. Guarded per-header
        // so calling initSidebarNav() again on unchanged markup (rather than
        // markup replaced via innerHTML, which already yields fresh nodes)
        // never attaches a second listener to the same header.
        groups.forEach(function (group) {
            if (group.classList.contains('is-static')) return;
            var header = group.querySelector('.nav-group-header');
            if (!header || header.dataset.sidebarNavBound === '1') return;
            header.dataset.sidebarNavBound = '1';
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

        // Manual icon-rail (desktop only — CSS hides the button below
        // 1025px). Persists across sidebar rebuilds, so guard it the same
        // way as the group headers above.
        var railBtn = document.getElementById('railToggleBtn');
        if (!railBtn || railBtn.dataset.sidebarNavBound === '1') return;
        railBtn.dataset.sidebarNavBound = '1';

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
    }

    window.initSidebarNav = initSidebarNav;
    document.addEventListener('DOMContentLoaded', initSidebarNav);
})();
