// Shared button loading-state helper (UI-A).
// Pairs with the .btn--loading CSS in assets/css/components/buttons.css.
// Load this after shared/api.js and before a page's own script.

// Toggles the loading visual + native disabled state on a single button.
function setButtonLoading(button, isLoading) {
    if (!button) return;
    button.disabled = isLoading;
    button.classList.toggle('btn--loading', isLoading);
}

// Wraps an async action with a button's loading state. Guards against
// double submission: if the button is already disabled (a previous call
// is still in flight), the action is skipped instead of firing again.
async function withButtonLoading(button, action) {
    if (button && button.disabled) return undefined;
    setButtonLoading(button, true);
    try {
        return await action();
    } finally {
        setButtonLoading(button, false);
    }
}
