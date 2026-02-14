let currentUser = null;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    loadVendors();
};

async function loadVendors() {
    const { data: vendors } = await _supabase.from('vendors').select('*').eq('user_id', currentUser.id);
    const list = document.getElementById('vendorList');
    list.innerHTML = '';

    if(vendors && vendors.length > 0) {
        for (const v of vendors) {
            const { data: ledger } = await _supabase.from('vendor_ledger').select('*').eq('vendor_id', v.id);
            
            let totalBill = v.opening_due || 0;
            let totalPaid = 0;
            
            if(ledger) {
                ledger.forEach(l => {
                    if(l.t_type === 'BILL') totalBill += l.amount;
                    else totalPaid += l.amount;
                });
            }
            
            const due = totalBill - totalPaid;

            list.innerHTML += `
                <div class="vendor-card" onclick="location.href='vendor-details.html?id=${v.id}'" role="button" tabindex="0" onkeypress="if(event.key==='Enter')location.href='vendor-details.html?id=${v.id}'" aria-label="View ${v.name} details">
                    <h3>${v.name}</h3>
                    <p>Due: ₹${due.toLocaleString('en-IN')}</p>
                </div>
            `;
        }
    } else {
        list.innerHTML = '<p style="text-align:center; color:#888; margin-top:50px;">No vendors yet. Add one!</p>';
    }
}

function showAddVendorModal() { document.getElementById('vendorModal').classList.remove('hidden'); }
function closeModal() { document.getElementById('vendorModal').classList.add('hidden'); }

async function addVendor() {
    const name = document.getElementById('vName').value;
    const phone = document.getElementById('vPhone').value;
    const open = parseFloat(document.getElementById('vOpen').value) || 0;

    if(!name) return showToast("Name required", "error");

    await _supabase.from('vendors').insert({
        user_id: currentUser.id,
        name: name,
        phone: phone,
        opening_due: open
    });

    document.getElementById('vName').value = '';
    document.getElementById('vPhone').value = '';
    document.getElementById('vOpen').value = '';
    closeModal();
    loadVendors();
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}
