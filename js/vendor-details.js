let currentUser = null;
let vendorId = null;
let allBills = {}; // Store bill-wise calculations

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    const params = new URLSearchParams(window.location.search);
    vendorId = params.get('id');
    
    document.getElementById('entryDate').value = new Date().toISOString().split('T')[0];
    loadDetails();
};

function toggleBillSelect() {
    const type = document.getElementById('entryType').value;
    const input = document.getElementById('entryBillNo');
    const select = document.getElementById('selectBillNo');
    const label = document.getElementById('labelBillNo');

    if(type === 'PAYMENT') {
        input.style.display = 'none';
        select.style.display = 'block';
        label.innerText = "Select Bill No";
        
        select.innerHTML = '<option value="GENERAL">General Payment (No Bill)</option>';
        Object.keys(allBills).forEach(bNo => {
            if(allBills[bNo].due > 0) {
                select.innerHTML += `<option value="${bNo}">${bNo} (Due: ₹${allBills[bNo].due})</option>`;
            }
        });
    } else {
        input.style.display = 'block';
        select.style.display = 'none';
        label.innerText = "Bill Number";
    }
}

async function loadDetails() {
    const { data: vendor } = await _supabase.from('vendors').select('*').eq('id', vendorId).single();
    document.getElementById('vNameTitle').innerText = vendor.name;
    document.getElementById('invVendorName').innerText = vendor.name;

    const { data: ledger } = await _supabase.from('vendor_ledger')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('t_date', { ascending: true });

    allBills = {};
    let totalBillAmt = vendor.opening_due || 0;
    let totalPaidAmt = 0;

    if(vendor.opening_due > 0) {
        allBills['OPENING'] = { date: 'Initial', total: vendor.opening_due, paid: 0, due: vendor.opening_due };
    }

    if(ledger) {
        ledger.forEach(l => {
            const bNo = l.bill_no || 'GENERAL';
            if(l.t_type === 'BILL') {
                if(!allBills[bNo]) allBills[bNo] = { date: l.t_date, total: 0, paid: 0, due: 0 };
                allBills[bNo].total += l.amount;
                totalBillAmt += l.amount;
            } else {
                if(!allBills[bNo]) allBills[bNo] = { date: l.t_date, total: 0, paid: 0, due: 0 };
                allBills[bNo].paid += l.amount;
                totalPaidAmt += l.amount;
            }
        });
    }

    const list = document.getElementById('ledgerList');
    const invBody = document.getElementById('invBody');
    list.innerHTML = '';
    invBody.innerHTML = '';

    Object.keys(allBills).forEach(bNo => {
        const b = allBills[bNo];
        b.due = b.total - b.paid;
        const isPaid = b.due <= 0;
        const statusLabel = isPaid ? 'Full Paid' : (b.paid > 0 ? 'Partial' : 'Unpaid');
        const badgeClass = isPaid ? 'badge-payment' : 'badge-bill';
        const stampClass = isPaid ? 'stamp-paid' : 'stamp-partial';

        list.innerHTML += `
            <li class="ledger-item">
                <div class="li-left">
                    <span>Bill: ${bNo}</span>
                    <small>Total: ₹${b.total} | Paid: ₹${b.paid}</small>
                    <small><i class="ri-calendar-line"></i> ${b.date}</small>
                </div>
                <div class="li-right">
                    <b style="color: ${isPaid ? 'var(--success)' : 'var(--danger)'}">Due: ₹${b.due}</b>
                    <small class="${badgeClass}">${statusLabel}</small>
                </div>
            </li>
        `;

        invBody.innerHTML += `
            <tr>
                <td>${b.date}</td>
                <td>${bNo}</td>
                <td>₹${b.total}</td>
                <td>₹${b.paid}</td>
                <td>₹${b.due}</td>
                <td><span class="stamp ${stampClass}">${statusLabel}</span></td>
            </tr>
        `;
    });

    document.getElementById('totBill').innerText = `₹${totalBillAmt.toLocaleString('en-IN')}`;
    document.getElementById('totPaid').innerText = `₹${totalPaidAmt.toLocaleString('en-IN')}`;
    const netDue = totalBillAmt - totalPaidAmt;
    document.getElementById('currDue').innerText = `₹${netDue.toLocaleString('en-IN')}`;
    document.getElementById('invTotalDue').innerText = `₹${netDue.toLocaleString('en-IN')}`;
    
    toggleBillSelect();
}

async function addEntry() {
    const type = document.getElementById('entryType').value;
    const date = document.getElementById('entryDate').value;
    const desc = document.getElementById('entryDesc').value;
    const amount = parseFloat(document.getElementById('entryAmount').value);
    let billNo = document.getElementById('entryBillNo').value;

    if(type === 'PAYMENT') {
        billNo = document.getElementById('selectBillNo').value;
    }

    if(!amount || !billNo) return alert("Enter amount and Bill Number");

    await _supabase.from('vendor_ledger').insert({
        user_id: currentUser.id,
        vendor_id: vendorId,
        t_date: date,
        t_type: type,
        description: desc,
        amount: amount,
        bill_no: billNo
    });

    document.getElementById('entryAmount').value = '';
    document.getElementById('entryDesc').value = '';
    document.getElementById('entryBillNo').value = '';
    loadDetails();
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}

async function generateInvoiceImage() {
    const element = document.getElementById('invoiceTemplate');
    document.getElementById('invDate').innerText = "Date: " + new Date().toLocaleDateString();
    
    html2canvas(element, { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Bill_${document.getElementById('vNameTitle').innerText}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        
        if (navigator.share) {
            canvas.toBlob(blob => {
                const file = new File([blob], "bill.png", { type: "image/png" });
                navigator.share({
                    files: [file],
                    title: 'Vendor Statement',
                    text: 'Check out the latest statement from RestroManager'
                }).catch(console.error);
            });
        }
    });
}
