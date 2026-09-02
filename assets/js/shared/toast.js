/**
 * Batch F (reservation module audit): the app's first shared toast
 * component. Every page's success/error feedback was previously a native
 * alert() — blocking, and visually identical whether an action succeeded
 * or failed. Self-contained: builds its own container on first use, so a
 * page only needs to load this script (and toast.css) — no HTML markup
 * required.
 *
 * Usage: showToast('Reservation cancelled.', { type: 'success' });
 * type: 'success' | 'error' | 'info' (default 'info'). duration: ms before
 * auto-dismiss (default 4000; pass 0 to require manual dismissal).
 */
(function () {
    let container = null;

    function ensureContainer() {
        if (container && document.body.contains(container)) return container;
        container = document.createElement('div');
        container.className = 'toast-container';
        container.setAttribute('role', 'status');
        container.setAttribute('aria-live', 'polite');
        document.body.appendChild(container);
        return container;
    }

    const ICONS = {
        success: 'fa-circle-check',
        error: 'fa-circle-exclamation',
        info: 'fa-circle-info',
    };

    function showToast(message, options) {
        options = options || {};
        const type = ['success', 'error', 'info'].includes(options.type) ? options.type : 'info';
        const duration = typeof options.duration === 'number' ? options.duration : 4000;

        const el = document.createElement('div');
        el.className = `toast toast--${type}`;
        el.innerHTML = `
            <i class="fas ${ICONS[type]}" aria-hidden="true"></i>
            <span class="toast-message"></span>
            <button type="button" class="toast-close" aria-label="Dismiss">&times;</button>
        `;
        el.querySelector('.toast-message').textContent = message;

        function remove() {
            el.classList.add('toast--leaving');
            setTimeout(() => el.remove(), 180);
        }

        el.querySelector('.toast-close').addEventListener('click', remove);
        ensureContainer().appendChild(el);

        if (duration > 0) {
            setTimeout(remove, duration);
        }
        return { remove };
    }

    window.showToast = showToast;
})();
