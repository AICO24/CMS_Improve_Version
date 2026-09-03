/**
 * Batch F (reservation module audit): shared rendering helpers that were
 * previously byte-for-byte (or near-byte-for-byte) duplicated between
 * assets/js/pages/manage-reservations.js and assets/js/pages/my-reservations.js
 * — escapeHtml(), buildStatusBadge(), debounce(), and the active-filter-chip
 * render/wire-up logic. The two pages' row/action markup stays page-specific
 * (admin and citizen show genuinely different columns and actions), so this
 * module only covers the parts that were actually identical, not a forced
 * unification of the whole table.
 */
(function () {
    function escapeHtml(value) {
        return String(value ?? '').replace(/[&<>"']/g, (char) => ({
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#39;',
        }[char]));
    }

    // Cremation Phase B: 'Scheduled' is cremation's payment-verified state
    // (mirrors burial's 'Confirmed' — see PaymentController::
    // autoConfirmCremationForVerifiedPayment()'s comment for why that word
    // was reused instead of introducing a second one). No .status-badge.scheduled
    // CSS class exists, so it maps onto .confirmed's existing styling while
    // the visible label stays the real status text — not folded into
    // 'known' as its own class, which would render unstyled.
    const STATUS_CLASS_BY_VALUE = {
        pending: 'pending',
        confirmed: 'confirmed',
        scheduled: 'confirmed',
        completed: 'completed',
        cancelled: 'cancelled',
    };

    function buildStatusBadge(status) {
        const normalized = String(status || '').toLowerCase();
        const badgeClass = STATUS_CLASS_BY_VALUE[normalized] || 'pending';
        return `<span class="status-badge ${badgeClass}">${status || 'Pending'}</span>`;
    }

    function debounce(fn, delay = 300) {
        let timeout;
        return (...args) => {
            clearTimeout(timeout);
            timeout = setTimeout(() => fn(...args), delay);
        };
    }

    // chips: array of { key, label, value, clear() }. Renders only chips
    // with a truthy value; clicking a chip's × calls its own clear()
    // (each page defines this — it closes over that page's local filter
    // state) then onChanged() to re-fetch/re-render.
    function renderFilterChips(container, chips, onChanged) {
        if (!container) return;
        const active = chips.filter((chip) => chip.value);

        container.innerHTML = active.map((chip) => `
            <span class="filter-chip" data-filter-key="${escapeHtml(chip.key)}">
                ${escapeHtml(chip.label)}: ${escapeHtml(chip.value)}
                <button type="button" aria-label="Remove ${escapeHtml(chip.label)} filter">&times;</button>
            </span>
        `).join('');

        container.querySelectorAll('.filter-chip').forEach((chipEl) => {
            const chip = active.find((item) => item.key === chipEl.dataset.filterKey);
            const button = chipEl.querySelector('button');
            if (!chip || !button) return;
            button.addEventListener('click', async () => {
                chip.clear();
                await onChanged();
            });
        });
    }

    window.reservationUI = { escapeHtml, buildStatusBadge, debounce, renderFilterChips };
})();
