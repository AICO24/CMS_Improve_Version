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

    // Cremation module audit, Batch F: translates a booking's raw status +
    // latest payment_status into the citizen-facing progress tracker (Part
    // 9's "Submitted / Payment / Confirmed / Completed" concept) — shared
    // between my-reservations.html (burial) and my-cremations.html
    // (cremation) since both now return the same payment_status/
    // payment_amount/etc. fields (Schedule::LATEST_PAYMENT_SELECT /
    // Cremation::LATEST_PAYMENT_SELECT) and use the same 4-state machine
    // shape (Pending/[Confirmed|Scheduled]/Completed/Cancelled).
    // confirmedLabel lets each caller use its own real status word
    // ('Confirmed' for burial, 'Scheduled' for cremation) rather than
    // inventing a fifth, generic label neither backend actually uses.
    //
    // Deliberately does NOT try to reconstruct which stage a Cancelled
    // booking was cancelled from — that information isn't reliably
    // available client-side (a citizen can only cancel from Pending, but
    // admin/staff can cancel from Confirmed/Scheduled too, and nothing
    // tracks a "cancelled from" fact) — so Cancelled always renders as a
    // simple two-node "Submitted -> Cancelled" halt, not a partially-filled
    // version of the normal 4-step pipeline.
    function buildStatusTracker(status, paymentStatus, options = {}) {
        const confirmedLabel = options.confirmedLabel || 'Confirmed';
        const normalizedStatus = String(status || '').toLowerCase();

        if (normalizedStatus === 'cancelled') {
            return renderTrackerSteps([
                { label: 'Submitted', state: 'done' },
                { label: 'Cancelled', state: 'halted' },
            ]);
        }

        const normalizedPayment = String(paymentStatus || '').toLowerCase();
        let paymentState = 'upcoming';
        let confirmedState = 'upcoming';
        let completedState = 'upcoming';

        if (normalizedStatus === 'completed') {
            paymentState = 'done';
            confirmedState = 'done';
            completedState = 'done';
        } else if (normalizedStatus === 'confirmed' || normalizedStatus === 'scheduled') {
            paymentState = 'done';
            confirmedState = 'done';
            completedState = 'current';
        } else if (normalizedPayment === 'verified') {
            // Pending, but payment already verified — the automated
            // confirm step (PaymentController::verify()'s AutomationEngine
            // path) hasn't landed yet, or couldn't (see the Batch D
            // "Needs Review" queue for that exception case). Shown as
            // "Confirmed" actively in-progress, not stalled at Payment.
            paymentState = 'done';
            confirmedState = 'current';
        } else if (normalizedPayment === 'rejected') {
            paymentState = 'attention';
        } else {
            paymentState = 'current';
        }

        return renderTrackerSteps([
            { label: 'Submitted', state: 'done' },
            { label: 'Payment', state: paymentState },
            { label: confirmedLabel, state: confirmedState },
            { label: 'Completed', state: completedState },
        ]);
    }

    function renderTrackerSteps(steps) {
        const stepsHtml = steps.map((step, index) => {
            const nodeHtml = `
                <div class="status-tracker__step status-tracker__step--${step.state}">
                    <span class="status-tracker__dot" aria-hidden="true"></span>
                    <span class="status-tracker__label">${escapeHtml(step.label)}</span>
                </div>
            `;
            if (index === steps.length - 1) return nodeHtml;
            const connectorDone = step.state === 'done';
            return `${nodeHtml}<div class="status-tracker__connector${connectorDone ? ' status-tracker__connector--done' : ''}"></div>`;
        }).join('');
        return `<div class="status-tracker">${stepsHtml}</div>`;
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

    window.reservationUI = { escapeHtml, buildStatusBadge, buildStatusTracker, debounce, renderFilterChips };
})();
