// Cremation module audit, Batch H: pure navigation page — a citizen picks
// Burial or Cremation and follows the link straight into that existing,
// separately-implemented booking flow (see reserve-cremation.js's header
// comment for why those two flows stay separate rather than merging into
// one form). This file only needs the auth guard + shell wiring every
// citizen page has; there is no data to fetch or render here.
document.addEventListener('DOMContentLoaded', async function() {
    try {
        const user = await requireRole(['user']);
        if (!user) return;
    } catch (error) {
        console.error('Auth error', error);
        return;
    }

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }
});
