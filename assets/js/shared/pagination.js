// Reusable Previous/Next pagination controller (UI-E).
// Owns the page-number state and the Prev/Next button + "Page X of Y"
// label wiring that was previously duplicated per page. The calling page
// still owns its own data fetch/render — pass an onChange callback that
// re-fetches for the new page. onChange may return a promise; it is
// awaited so the loading/disabled state below can wrap the whole fetch.
//
// render(meta) accepts { page, total_pages, total }. `total_pages` is the
// standard key (UI-F); `pages` is accepted as a fallback since the
// earlier Payments/Schedules/Audit endpoints (wired in UI-E) still emit
// that name — new call sites should send total_pages. `total` is optional:
// pass it when the endpoint returns a real count for a "Page X of Y • N
// item(s)" label; omit it (e.g. audit-logs, which has no count endpoint)
// and the label falls back to "Page X" while Prev/Next disabled-state
// still works off page/total_pages as usual.
//
// Loading state + duplicate-click guard reuse the shared button-loading
// helper (assets/js/shared/button-loading.js, UI-A) — load it before this
// file. While a page change is in flight both buttons are disabled and the
// clicked one shows the shared spinner; further clicks are ignored until
// onChange settles, so rapid Prev/Next clicks can't fire overlapping
// requests. The disabled state is always restored in a `finally`, even if
// onChange throws, so an error doesn't leave the controls stuck.
function createPagination({ prevBtn, nextBtn, infoEl, jumpForm, jumpInput, jumpBtn, itemLabel = 'item', onChange }) {
    let page = 1;
    let pages = 1;
    let busy = false;

    function applyButtonState() {
        if (prevBtn) prevBtn.disabled = busy || page <= 1;
        if (nextBtn) nextBtn.disabled = busy || page >= pages;
        if (jumpInput) jumpInput.disabled = busy || pages <= 1;
        if (jumpBtn) jumpBtn.disabled = busy || pages <= 1;
    }

    function render(meta) {
        meta = meta || {};
        page = meta.page || 1;
        pages = meta.total_pages || meta.pages || 1;

        if (infoEl) {
            if (typeof meta.total === 'number') {
                const label = meta.total === 1 ? itemLabel : `${itemLabel}s`;
                infoEl.textContent = `Page ${page} of ${pages} • ${meta.total} ${label}`;
            } else {
                infoEl.textContent = `Page ${page}`;
            }
        }
        if (jumpInput) {
            jumpInput.max = pages;
            jumpInput.placeholder = 'Enter page number';
        }
        applyButtonState();
    }

    function reset() {
        page = 1;
    }

    async function goTo(delta, triggerBtn) {
        if (busy) return;
        if (delta < 0 && page <= 1) return;
        if (delta > 0 && page >= pages) return;
        page += delta;
        busy = true;
        applyButtonState();
        setButtonLoading(triggerBtn, true);
        try {
            await onChange();
        } finally {
            busy = false;
            setButtonLoading(triggerBtn, false);
            applyButtonState();
        }
    }

    async function jumpTo(targetPage, triggerBtn) {
        if (busy) return;
        const nextPage = Number.parseInt(targetPage, 10);
        if (!Number.isInteger(nextPage)) return;
        const clampedPage = Math.max(1, Math.min(nextPage, pages));
        if (clampedPage === page) {
            if (jumpInput) jumpInput.value = '';
            return;
        }
        page = clampedPage;
        busy = true;
        applyButtonState();
        setButtonLoading(triggerBtn, true);
        try {
            await onChange();
            if (jumpInput) jumpInput.value = '';
        } finally {
            busy = false;
            setButtonLoading(triggerBtn, false);
            applyButtonState();
        }
    }

    if (prevBtn) {
        prevBtn.addEventListener('click', () => goTo(-1, prevBtn));
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => goTo(1, nextBtn));
    }
    if (jumpForm && jumpInput) {
        jumpForm.addEventListener('submit', (event) => {
            event.preventDefault();
            jumpTo(jumpInput.value, jumpBtn);
        });
    }

    return {
        render,
        reset,
        jumpTo,
        get page() { return page; },
    };
}
