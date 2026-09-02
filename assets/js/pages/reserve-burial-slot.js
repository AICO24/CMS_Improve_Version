// Citizen "Reserve Burial Slot" page — thin wrapper around the shared
// assets/js/shared/booking-wizard.js (Batch N: full-page chat interface).
// See that file for the full logic; only the role gate, status-badge
// markup, and post-booking behavior differ from the admin/staff page
// (burial-scheduling.js).
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
                    // States explicitly that reservation_id is a schedule_id, not a
                    // lot_id — see the matching note on lot-management.js's Pay Now
                    // redirect and PaymentController::validatePaymentReference().
                    params.set('reference_kind', 'schedule');
                }
                window.location.href = `payments.html?${params.toString()}`;
            }
        },
    }).init();
});
