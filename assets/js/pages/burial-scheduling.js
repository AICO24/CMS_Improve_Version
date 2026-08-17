// Admin/staff burial-scheduling wizard — thin wrapper around the shared
// assets/js/shared/booking-wizard.js (Batch M5). See that file for the full
// wizard logic; only the role gate, status-badge markup, and post-booking
// behavior differ from the citizen wizard (reserve-burial-slot.js).
document.addEventListener('DOMContentLoaded', function() {
    createBookingWizard({
        allowedRoles: ['admin', 'staff'],
        renderStatusBadge: (lot) => `<span class="status-badge status-success">${lot.status || 'Available'}</span>`,
        onBookingSuccess: () => {
            alert('Reservation request submitted and pending approval.');
        },
    }).init();
});
