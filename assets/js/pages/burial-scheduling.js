// Admin/staff Burial Scheduling page — thin wrapper around the shared
// assets/js/shared/booking-wizard.js (Batch N: full-page chat interface).
// See that file for the full logic; only the role gate, status-badge
// markup, and post-booking behavior differ from the citizen page
// (reserve-burial-slot.js).
document.addEventListener('DOMContentLoaded', function() {
    createBookingWizard({
        allowedRoles: ['admin', 'staff'],
        renderStatusBadge: (lot) => `<span class="status-badge status-success">${lot.status || 'Available'}</span>`,
        onBookingSuccess: () => {
            alert('Reservation request submitted and pending approval.');
        },
    }).init();
});
