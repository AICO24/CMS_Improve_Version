// Cremation Phase B (B4): plain citizen intake form — deliberately NOT an
// AI chat wizard, see the plan's reasoning (cremation intake is 3 inputs
// with no scarce/exclusive resource to rank or reserve at booking time,
// unlike burial's lot recommendation/conflict-checking problem). Decedent
// selection reuses the same "existing record OR register a new one via
// decedent_requests" idea booking-wizard.js already established for
// burial, just as a plain <select> + sub-form instead of a chat exchange.
document.addEventListener('DOMContentLoaded', async function() {
    const user = await requireRole(['user']);
    if (!user) return;

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

    const decedentSelect = document.getElementById('decedentSelect');
    const provisionalGroup = document.getElementById('provisionalDecedentGroup');
    const provisionalFullName = document.getElementById('provisionalFullName');
    const provisionalApproxDod = document.getElementById('provisionalApproxDod');
    const provisionalRelationship = document.getElementById('provisionalRelationship');
    const columbariumSelect = document.getElementById('columbariumSelect');
    const cremationDateInput = document.getElementById('cremationDate');
    const cremationNotesInput = document.getElementById('cremationNotes');
    const cremationForm = document.getElementById('cremationForm');

    provisionalApproxDod.max = new Date().toISOString().split('T')[0];

    async function loadDecedents() {
        try {
            const decedents = await api.request('decedents', { method: 'GET' });
            const list = Array.isArray(decedents) ? decedents : [];
            const options = list.map((d) => `<option value="${d.decedent_id}">${d.first_name} ${d.last_name}</option>`).join('');
            decedentSelect.innerHTML = `<option value="">Select existing decedent...</option>${options}<option value="__new__">— Not in our records (register a new person) —</option>`;
        } catch (error) {
            console.error('Failed to load decedents', error);
            decedentSelect.innerHTML = `<option value="">Unable to load decedents</option><option value="__new__">— Not in our records (register a new person) —</option>`;
        }
    }

    async function loadColumbariums() {
        try {
            const columbariums = await api.request('cremations/columbariums', { method: 'GET' });
            const list = Array.isArray(columbariums) ? columbariums : [];
            columbariumSelect.innerHTML = `<option value="">No preference</option>${list.map((c) => `<option value="${c}">${c}</option>`).join('')}`;
        } catch (error) {
            console.error('Failed to load columbariums', error);
        }
    }

    decedentSelect.addEventListener('change', () => {
        provisionalGroup.style.display = decedentSelect.value === '__new__' ? 'block' : 'none';
    });

    cremationForm.addEventListener('submit', async function(event) {
        event.preventDefault();

        if (!decedentSelect.value) {
            showToast('Please select or register a decedent.', { type: 'error' });
            return;
        }

        const payload = {
            preferred_columbarium: columbariumSelect.value || null,
            cremation_date: cremationDateInput.value || null,
            notes: cremationNotesInput.value.trim() || null,
        };

        if (decedentSelect.value === '__new__') {
            const fullName = provisionalFullName.value.trim();
            if (!fullName) {
                showToast('Please provide the full name of the deceased.', { type: 'error' });
                return;
            }
            payload.provisional_decedent = {
                full_name: fullName,
                approximate_dod: provisionalApproxDod.value || null,
                relationship: provisionalRelationship.value.trim() || null,
            };
        } else {
            payload.deceased_id = decedentSelect.value;
        }

        const submitBtn = cremationForm.querySelector('button[type="submit"]');
        await withButtonLoading(submitBtn, async () => {
            try {
                const result = await api.request('cremations', { method: 'POST', body: payload });
                if (result.success) {
                    showToast('Cremation request submitted and pending payment/confirmation.', { type: 'success' });
                    cremationForm.reset();
                    provisionalGroup.style.display = 'none';
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

    await Promise.all([loadDecedents(), loadColumbariums()]);
});
