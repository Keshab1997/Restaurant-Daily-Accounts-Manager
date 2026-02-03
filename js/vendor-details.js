let currentUser = null;
let vendorId = null;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    const params = new URLSearchParams(window.location.search);
    vendorId = params.get('id');
    
    document.getElementById('entryDate').value = new Date().toISOString().split('T')[0];
    loadDetails();
};

async function loadDetails() {
    const { data: vendor } = await _supabase.from('vendors').select('*').eq('id', vendorId).single();
    document.getElementById('vNameTitle').innerText = vendor.name;

    const { data: ledger } = await _supabase.from('vendor_ledger')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('t_date', { ascending: false });

    let bill = vendor.opening_due || 0;
    let paid = 0;
    const list = document.getElementById('ledgerList');
    list.innerHTML = '';

    if(ledger && ledger.length > 0) {
        ledger.forEach(l => {
            if(l.t_type === 'BILL') bill += l.amount;
            else paid += l.amount;

            const color = l.t_type === 'BILL' ? 'var(--danger)' : 'var(--success)';
            const badgeClass = l.t_type === 'BILL' ? 'badge-bill' : 'badge-payment';
            const typeLabel = l.t_type === 'BILL' ? 'Bill' : 'Payment';
            
            list.innerHTML += `
                <li class="ledger-item">
                    <div class="li-left">
                        <span>${l.description || typeLabel}</span>
                        <small><i class="ri-calendar-line"></i> ${l.t_date}</small>
                    </div>
                    <div class="li-right">
                        <b style="color: ${color}">₹${l.amount.toLocaleString('en-IN')}</b>
                        <small class="${badgeClass}">${typeLabel}</small>
                    </div>
                </li>
            `;
        });
    } else {
        list.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No transactions yet</p>';
    }

    document.getElementById('totBill').innerText = `₹${bill.toLocaleString('en-IN')}`;
    document.getElementById('totPaid').innerText = `₹${paid.toLocaleString('en-IN')}`;
    document.getElementById('currDue').innerText = `₹${(bill - paid).toLocaleString('en-IN')}`;
}

async function addEntry() {
    const type = document.getElementById('entryType').value;
    const date = document.getElementById('entryDate').value;
    const desc = document.getElementById('entryDesc').value;
    const amount = parseFloat(document.getElementById('entryAmount').value);

    if(!amount) return alert("Enter amount");

    await _supabase.from('vendor_ledger').insert({
        user_id: currentUser.id,
        vendor_id: vendorId,
        t_date: date,
        t_type: type,
        description: desc,
        amount: amount
    });

    document.getElementById('entryAmount').value = '';
    document.getElementById('entryDesc').value = '';
    loadDetails();
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}

async function generatePDF() {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    
    const vName = document.getElementById('vNameTitle').innerText;
    const totalBill = document.getElementById('totBill').innerText;
    const totalPaid = document.getElementById('totPaid').innerText;
    const currentDue = document.getElementById('currDue').innerText;

    doc.setFontSize(18);
    doc.text(`Vendor Statement: ${vName}`, 14, 20);
    
    doc.setFontSize(11);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 30);
    doc.text(`Total Bill: ${totalBill} | Total Paid: ${totalPaid} | Due: ${currentDue}`, 14, 38);

    const { data: ledger } = await _supabase.from('vendor_ledger')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('t_date', { ascending: true });

    const tableRows = ledger.map(l => [
        l.t_date,
        l.t_type === 'BILL' ? 'Bill / Purchase' : 'Payment',
        l.description || '-',
        l.t_type === 'BILL' ? l.amount : '-',
        l.t_type === 'PAYMENT' ? l.amount : '-'
    ]);

    doc.autoTable({
        head: [['Date', 'Type', 'Description', 'Bill Amount', 'Paid Amount']],
        body: tableRows,
        startY: 45,
        theme: 'grid',
        headStyles: { fillColor: [37, 99, 235] },
        columnStyles: {
            3: { textColor: [220, 38, 69], fontStyle: 'bold' },
            4: { textColor: [5, 150, 105], fontStyle: 'bold' }
        }
    });

    doc.save(`${vName}_Statement.pdf`);
    
    const msg = `Hello ${vName}, here is your statement.\nTotal Due: ${currentDue}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}
