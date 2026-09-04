// Cremation Phase B (B4): plain citizen intake form — deliberately NOT an
// AI chat wizard, see the plan's reasoning (cremation intake is 3 inputs
// with no scarce/exclusive resource to rank or reserve at booking time,
// unlike burial's lot recommendation/conflict-checking problem).
//
// Privacy audit (2026-09-04): this used to also let a citizen pick an
// EXISTING decedent from a dropdown populated by GET /decedents — an
// unscoped, cemetery-wide list, meaning any citizen booking a cremation
// could see every deceased person's full name in the system, not just
// their own family's. Removed entirely — a citizen now always types the
// decedent's info fresh (provisional_decedent), the same mechanism this
// page already used for "not in our records yet". Staff match/link it to
// an existing formal decedent_records row on their own side (already-
// existing tooling: DecedentRequestController::approve()/flagPossible
// Duplicates()), where full access is appropriate. See
// booking-wizard.js's identical fix for the burial flow.
document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['user']);
    if (!user) return;

    document.getElementById('logoutBtn').addEventListener('click', () => {
        api.logout();
    });

    // Cremation module audit, Batch F: citizen-scoped AI mount, mirroring
    // my-reservations.js's — see AuditIntelligenceService::
    // buildCitizenModuleContext('Cremation', ...). Unlike burial's
    // reserve-burial-slot.html, this page is a plain form, not an AI-chat
    // booking wizard (see this file's own header comment on why) — this
    // mount is guidance alongside the form, not the booking flow itself.
    initAiAssistant({
        mountSelector: '#aiAssistantMount',
        context: { scope: 'module', module: 'Cremation' },
        greeting: "Hello! I'm your AI assistant for cremation booking. How can I help you today?",
        suggestions: [
            { icon: 'fa-circle-question', label: 'What do I need?', question: 'What information do I need to provide to book a cremation?' },
            { icon: 'fa-credit-card', label: 'How does payment work?', question: 'How does payment work for a cremation booking, and when is it confirmed?' },
            { icon: 'fa-list-check', label: 'My existing requests', question: 'What is the status of my cremation requests right now?' },
        ],
    });

    const toggleBtn = document.getElementById('toggleSidebar');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
        toggleBtn.addEventListener('change', () => {
            sidebar.classList.toggle('collapsed');
        });
    }

    const provisionalFullName = document.getElementById('provisionalFullName');
    const provisionalApproxDod = document.getElementById('provisionalApproxDod');
    const provisionalRelationship = document.getElementById('provisionalRelationship');
    const columbariumSelect = document.getElementById('columbariumSelect');
    const cremationDateInput = document.getElementById('cremationDate');
    const cremationNotesInput = document.getElementById('cremationNotes');
    const cremationForm = document.getElementById('cremationForm');

    provisionalApproxDod.max = new Date().toISOString().split('T')[0];

    async function loadColumbariums() {
        try {
            const columbariums = await api.request('cremations/columbariums', { method: 'GET' });
            const list = Array.isArray(columbariums) ? columbariums : [];
            columbariumSelect.innerHTML = `<option value="">No preference</option>${list.map((c) => `<option value="${c}">${c}</option>`).join('')}`;
        } catch (error) {
            console.error('Failed to load columbariums', error);
        }
    }

    cremationForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        const fullName = provisionalFullName.value.trim();
        if (!fullName) {
            showToast('Please provide the full name of the deceased.', { type: 'error' });
            return;
        }

        const payload = {
            preferred_columbarium: columbariumSelect.value || null,
            cremation_date: cremationDateInput.value || null,
            notes: cremationNotesInput.value.trim() || null,
            provisional_decedent: {
                full_name: fullName,
                approximate_dod: provisionalApproxDod.value || null,
                relationship: provisionalRelationship.value.trim() || null,
            },
        };

        const submitBtn = cremationForm.querySelector('button[type="submit"]');
        await withButtonLoading(submitBtn, async () => {
            try {
                const result = await api.request('cremations', { method: 'POST', body: payload });
                if (result.success) {
                    showToast('Cremation request submitted and pending payment/confirmation.', { type: 'success' });
                    cremationForm.reset();
                    const goToPayment = confirm('Cremation request submitted. Proceed to payment now?');
                    if (goToPayment && result.cremation_id) {
                        window.location.href = `payments.html?transaction_type=Cremation&cremation_id=${result.cremation_id}`;
                    }
                } else {
                    showToast(result.error || 'Failed to submit cremation request.', { type: 'error' });
                }
            } catch (error) {
                showToast(error.message || 'Failed to submit cremation request.', { type: 'error' });
            }
        });
    });

    await loadColumbariums();
});
