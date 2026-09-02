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

    function buildStatusBadge(status) {
        const normalized = String(status || '').toLowerCase();
        const known = ['pending', 'confirmed', 'completed', 'cancelled'];
        const badgeClass = known.includes(normalized) ? normalized : 'pending';
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
