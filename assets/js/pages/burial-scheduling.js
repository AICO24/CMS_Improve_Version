// Admin/staff Burial Scheduling page — redirected to Unified Booking Assistant
document.addEventListener('DOMContentLoaded', async function() {
    if (typeof requireRole === 'function') {
        const user = await requireRole(['admin', 'staff']);
        if (!user) return;
    }
    const search = window.location.search;
    let target = 'booking-assistant.html?service=burial';
    if (search) {
        const params = new URLSearchParams(search);
        params.delete('service');
        const remaining = params.toString();
        if (remaining) target += '&' + remaining;
    }
    window.location.replace(target);
});
