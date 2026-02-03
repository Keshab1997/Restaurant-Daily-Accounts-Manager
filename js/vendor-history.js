let currentUser = null;
let allVendorData = [];

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    loadVendorHistory();
};

async function loadVendorHistory() {
    const tbody = document.getElementById('vendorHistoryBody');
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px;">Calculating History...</td></tr>';

    const { data: vendors } = await _supabase.from('vendors').select('*').eq('user_id', currentUser.id);
    
    if(!vendors) return;

    let historyList = [];

    for (const v of vendors) {
        const { data: ledger } = await _supabase.from('vendor_ledger').select('*').eq('vendor_id', v.id).order('t_date', { ascending: false });
        
        let totalBill = v.opening_due || 0;
        let paidCash = 0;
        let paidOwner = 0;
        let lastCategory = "N/A";
        let lastDate = v.created_at ? v.created_at.split('T')[0] : "N/A";

        if(ledger && ledger.length > 0) {
            lastDate = ledger[0].t_date;
            ledger.forEach(l => {
                if(l.t_type === 'BILL') {
                    totalBill += l.amount;
                    if(l.description && l.description.includes('for ')) {
                        lastCategory = l.description.split('for ')[1];
                    }
                } else {
                    if(l.description && l.description.includes('Owner')) paidOwner += l.amount;
                    else paidCash += l.amount;
                }
            });
        }

        historyList.push({
            id: v.id,
            name: v.name,
            category: lastCategory,
            lastDate: lastDate,
            bill: totalBill,
            paidCash: paidCash,
            paidOwner: paidOwner,
            due: totalBill - (paidCash + paidOwner)
        });
    }

    allVendorData = historyList;
    renderTable(allVendorData);
}

function renderTable(data) {
    const tbody = document.getElementById('vendorHistoryBody');
    tbody.innerHTML = '';

    if(data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px; color:#94a3b8;">No vendors found</td></tr>';
        return;
    }

    data.forEach(v => {
        tbody.innerHTML += `
            <tr>
                <td class="text-bold">${v.name}</td>
                <td><span style="background:#f1f5f9; color:#475569; padding:4px 10px; border-radius:6px; font-size:0.85rem;">${v.category}</span></td>
                <td style="font-size:0.85rem; color:#64748b;">${v.lastDate}</td>
                <td>₹${v.bill.toLocaleString('en-IN')}</td>
                <td class="paid-amount">₹${v.paidCash.toLocaleString('en-IN')}</td>
                <td style="color:var(--warning)">₹${v.paidOwner.toLocaleString('en-IN')}</td>
                <td class="due-amount">₹${v.due.toLocaleString('en-IN')}</td>
                <td>
                    <button class="btn-view" onclick="location.href='vendor-details.html?id=${v.id}'">Details</button>
                </td>
            </tr>
        `;
    });
}

function applyFilters() {
    const search = document.getElementById('searchVendor').value.toLowerCase();
    const status = document.getElementById('statusFilter').value;

    const filtered = allVendorData.filter(v => {
        const matchesSearch = v.name.toLowerCase().includes(search) || v.category.toLowerCase().includes(search);
        const matchesStatus = (status === 'ALL') || 
                             (status === 'DUE' && v.due > 0) || 
                             (status === 'PAID' && v.due <= 0);
        return matchesSearch && matchesStatus;
    });

    renderTable(filtered);
}

function exportToExcel() {
    let csv = "Vendor Name,Category,Last Date,Total Bill,Paid (Cash),Paid (Owner),Current Due\n";
    allVendorData.forEach(v => {
        csv += `${v.name},${v.category},${v.lastDate},${v.bill},${v.paidCash},${v.paidOwner},${v.due}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', 'Vendor_History.csv');
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}
