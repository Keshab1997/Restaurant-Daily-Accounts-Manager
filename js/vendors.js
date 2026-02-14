let currentUser = null;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    loadVendors();
};

async function loadVendors() {
    const vendorGrid = document.getElementById('vendorList');
    vendorGrid.innerHTML = `
        <div style="grid-column: 1/-1; text-align: center; padding: 50px;">
            <i class="ri-loader-4-line spin" style="font-size: 2rem; color: #2563eb;"></i>
            <p>Loading Vendors...</p>
        </div>
    `;

    try {
        const [vendorsRes, ledgerRes] = await Promise.all([
            _supabase.from('vendors').select('*').eq('user_id', currentUser.id).order('name'),
            _supabase.from('vendor_ledger').select('vendor_id, amount, t_type').eq('user_id', currentUser.id)
        ]);

        if (vendorsRes.error) throw vendorsRes.error;

        const vendors = vendorsRes.data;
        const allLedger = ledgerRes.data || [];

        vendorGrid.innerHTML = '';

        if (vendors.length === 0) {
            vendorGrid.innerHTML = `
                <div style="grid-column: 1/-1; text-align: center; padding: 50px; color: #64748b;">
                    <i class="ri-store-2-line" style="font-size: 3rem; opacity: 0.3;"></i>
                    <p>No vendors found. Click "Add New Vendor" to start.</p>
                </div>
            `;
            return;
        }

        vendors.forEach(vendor => {
            const vendorTransactions = allLedger.filter(l => l.vendor_id === vendor.id);
            
            let totalBill = 0;
            let totalPaid = 0;

            vendorTransactions.forEach(t => {
                if (t.t_type === 'BILL') totalBill += t.amount;
                else if (t.t_type === 'PAYMENT' || t.t_type === 'PAYMENT_OWNER') totalPaid += t.amount;
            });

            const currentDue = (vendor.opening_due || 0) + totalBill - totalPaid;

            const card = document.createElement('div');
            card.className = 'vendor-card';
            card.onclick = () => window.location.href = `vendor-details.html?id=${vendor.id}`;
            
            card.innerHTML = `
                <i class="ri-store-2-line" style="font-size: 2.5rem; color: #2563eb; margin-bottom: 15px;"></i>
                <h3>${vendor.name}</h3>
                <p style="color: ${currentDue > 0 ? '#ef4444' : '#10b981'}; background: ${currentDue > 0 ? '#fee2e2' : '#d1fae5'}">
                    ${currentDue > 0 ? 'Due: ₹' + currentDue.toLocaleString('en-IN') : 'No Due'}
                </p>
                <small style="color: #64748b; margin-top: 10px; display: block;">
                    <i class="ri-phone-line"></i> ${vendor.phone || 'No Phone'}
                </small>
            `;
            vendorGrid.appendChild(card);
        });

    } catch (err) {
        console.error(err);
        showToast("Failed to load vendors", "error");
    }
}

async function addVendor() {
    const name = document.getElementById('vName').value.trim();
    const phone = document.getElementById('vPhone').value.trim();
    const openingDue = parseFloat(document.getElementById('vOpen').value) || 0;

    if (!name) {
        showToast("Please enter vendor name", "error");
        return;
    }

    const saveBtn = document.querySelector('.btn-save');
    saveBtn.disabled = true;
    saveBtn.innerText = "Saving...";

    try {
        const { error } = await _supabase.from('vendors').insert({
            user_id: currentUser.id,
            name: name,
            phone: phone,
            opening_due: openingDue
        });

        if (error) throw error;

        showToast("Vendor added successfully!", "success");
        closeModal();
        loadVendors();
    } catch (err) {
        showToast(err.message, "error");
    } finally {
        saveBtn.disabled = false;
        saveBtn.innerText = "Save Vendor";
    }
}

function showAddVendorModal() {
    document.getElementById('vendorModal').classList.remove('hidden');
    document.getElementById('vName').focus();
}

function closeModal() {
    document.getElementById('vendorModal').classList.add('hidden');
    document.getElementById('vName').value = '';
    document.getElementById('vPhone').value = '';
    document.getElementById('vOpen').value = '';
}
