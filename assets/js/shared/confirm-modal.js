/**
 * Batch F (reservation module audit): shared, promise-based replacement for
 * native confirm() — styled via the existing .modal/.modal-content markup
 * (assets/css/components/modals.css), which was already loaded on most
 * dashboard pages but, per the UI/UX audit, never actually used by any of
 * them. Self-contained: builds its own modal DOM on first use, so a page
 * only needs to load this script — no HTML markup required.
 *
 * Usage: const ok = await confirmDialog({
 *   title: 'Cancel reservation?', message: 'This cannot be undone.',
 *   confirmLabel: 'Cancel reservation', danger: true,
 * });
 * Also accepts a plain string as shorthand for { message: '...' }.
 */
(function () {
    let modalEl = null;

    function ensureModal() {
        if (modalEl) return modalEl;
        modalEl = document.createElement('div');
        modalEl.className = 'modal';
        modalEl.innerHTML = `
            <div class="modal-content modal--sm">
                <div class="modal-header" id="confirmModalTitle">Please confirm</div>
                <div class="modal-body" id="confirmModalMessage"></div>
                <div class="modal-footer">
                    <button type="button" class="btn-secondary" id="confirmModalCancel">Cancel</button>
                    <button type="button" class="btn-primary" id="confirmModalConfirm">Confirm</button>
                </div>
            </div>
        `;
        document.body.appendChild(modalEl);
        return modalEl;
    }

    function confirmDialog(options) {
        options = typeof options === 'string' ? { message: options } : (options || {});
        const {
            title = 'Please confirm',
            message = '',
            confirmLabel = 'Confirm',
            cancelLabel = 'Cancel',
            danger = false,
        } = options;

        const modal = ensureModal();
        modal.querySelector('#confirmModalTitle').textContent = title;
        modal.querySelector('#confirmModalMessage').textContent = message;
        const confirmBtn = modal.querySelector('#confirmModalConfirm');
        const cancelBtn = modal.querySelector('#confirmModalCancel');
        confirmBtn.textContent = confirmLabel;
        cancelBtn.textContent = cancelLabel;
        // No dedicated .btn-danger exists in the shared button system (see
        // assets/css/components/buttons.css) — a direct style override for
        // this one occasional case is simpler than adding a new button
        // variant nothing else needs yet.
        confirmBtn.style.background = danger ? 'var(--color-danger)' : '';
        confirmBtn.style.borderColor = danger ? 'var(--color-danger)' : '';

        return new Promise((resolve) => {
            function cleanup(result) {
                modal.style.display = 'none';
                confirmBtn.removeEventListener('click', onConfirm);
                cancelBtn.removeEventListener('click', onCancel);
                modal.removeEventListener('click', onBackdrop);
                document.removeEventListener('keydown', onKeydown);
                resolve(result);
            }
            function onConfirm() { cleanup(true); }
            function onCancel() { cleanup(false); }
            function onBackdrop(event) { if (event.target === modal) cleanup(false); }
            function onKeydown(event) { if (event.key === 'Escape') cleanup(false); }

            confirmBtn.addEventListener('click', onConfirm);
            cancelBtn.addEventListener('click', onCancel);
            modal.addEventListener('click', onBackdrop);
            document.addEventListener('keydown', onKeydown);

            modal.style.display = 'flex';
            confirmBtn.focus();
        });
    }

    window.confirmDialog = confirmDialog;
})();
