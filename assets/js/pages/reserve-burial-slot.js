// Citizen "Reserve Burial Slot" wizard — thin wrapper around the shared
// assets/js/shared/booking-wizard.js (Batch M5). See that file for the full
// wizard logic; only the role gate, status-badge markup, and post-booking
// behavior differ from the admin/staff wizard (burial-scheduling.js).
document.addEventListener('DOMContentLoaded', function() {
    createBookingWizard({
        allowedRoles: ['user'],
        renderStatusBadge: (lot) => `<span class="muted">Available status: ${lot.status || 'Available'}</span>`,
        onBookingSuccess: ({ scheduleId, bookedLot }) => {
            const goToPayment = confirm('Reservation request submitted and pending approval. Proceed to payment now?');
            if (goToPayment) {
                const params = new URLSearchParams({
                    transaction_type: 'Lot Purchase',
                    lot_number: bookedLot.lot_number || '',
                    price: bookedLot.price || '',
                });
                if (scheduleId) {
                    params.set('reservation_id', scheduleId);
                }
                window.location.href = `payments.html?${params.toString()}`;
            }
        },
    }).init();
});
