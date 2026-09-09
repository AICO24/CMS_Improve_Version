// Shared button loading-state helper (UI-A).
// Pairs with the .btn--loading CSS in assets/css/components/buttons.css.
// Load this after shared/api.js and before a page's own script.

// Toggles the loading visual + native disabled state on a single button.
function setButtonLoading(button, isLoading) {
    if (!button) return;
    button.disabled = isLoading;
    button.classList.toggle('btn--loading', isLoading);
}

// Helper to toggle transition/motion safely on a button while loading.
function _toggleButtonTransitions(button, disable) {
    if (!button) return;
    try {
        if (disable) {
            // backup current inline transition values
            button.dataset._backupTransition = button.style.transition || '';
            button.style.transition = 'none';
            // also disable on known child containers used by designs
            const icon = button.querySelector('.IconContainer');
            const text = button.querySelector('.text');
            if (icon) { icon.dataset._backupTransition = icon.style.transition || ''; icon.style.transition = 'none'; }
            if (text) { text.dataset._backupTransition = text.style.transition || ''; text.style.transition = 'none'; }
        } else {
            if (button.dataset._backupTransition !== undefined) {
                button.style.transition = button.dataset._backupTransition;
                delete button.dataset._backupTransition;
            }
            const icon = button.querySelector('.IconContainer');
            const text = button.querySelector('.text');
            if (icon && icon.dataset._backupTransition !== undefined) { icon.style.transition = icon.dataset._backupTransition; delete icon.dataset._backupTransition; }
            if (text && text.dataset._backupTransition !== undefined) { text.style.transition = text.dataset._backupTransition; delete text.dataset._backupTransition; }
        }
    } catch (e) {
        // non-fatal; don't break save flow for styling issues
        console.warn('Transition toggle failed', e);
    }
}

// Wraps an async action with a button's loading state. Guards against
// double submission: if the button is already disabled (a previous call
// is still in flight), the action is skipped instead of firing again.
async function withButtonLoading(button, action) {
    if (button && button.disabled) return undefined;
    setButtonLoading(button, true);
    _toggleButtonTransitions(button, true);
    try {
        return await action();
    } finally {
        setButtonLoading(button, false);
        _toggleButtonTransitions(button, false);
    }
}
