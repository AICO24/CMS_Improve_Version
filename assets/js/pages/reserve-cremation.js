// Citizen "Reserve Cremation" page — redirected to Unified Booking Assistant (Batch B)
document.addEventListener('DOMContentLoaded', async function() {
    if (typeof requireRole === 'function') {
        const user = await requireRole(['admin', 'staff', 'user']);
        if (!user) return;
    }
    const search = window.location.search;
    let target = 'booking-assistant.html?service=cremation';
    if (search) {
        const params = new URLSearchParams(search);
        params.delete('service');
        const remaining = params.toString();
        if (remaining) target += '&' + remaining;
    }
    window.location.replace(target);
});
