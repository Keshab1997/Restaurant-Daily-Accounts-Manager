let currentUser = null;
let vendorId = null;
let allBills = {}; // Store bill-wise calculations
let restaurantName = "RestroManager";

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    // ১. রেস্টুরেন্টের নাম লোড করা
    const { data: profile } = await _supabase.from('profiles').select('restaurant_name, authorized_signature').eq('id', currentUser.id).maybeSingle();
    if(profile && profile.restaurant_name) {
        restaurantName = profile.restaurant_name;
        document.getElementById('sideNavName').innerText = restaurantName;
        document.getElementById('invRestroName').innerText = restaurantName;
        // সিগনেচার সেট করা
        document.getElementById('invSignature').innerText = profile.authorized_signature || restaurantName;
    }

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
        
        select.innerHTML = '<option value="0">General Payment (No Bill)</option>';
        
        // Sort bill numbers numerically
        const sortedKeys = Object.keys(allBills).sort((a, b) => parseInt(a) - parseInt(b));
        
        sortedKeys.forEach(bNo => {
            if(bNo !== "0" && allBills[bNo].due > 0) {
                select.innerHTML += `<option value="${bNo}">Bill #${bNo} (Due: ₹${allBills[bNo].due})</option>`;
            }
        });
    } else {
        input.style.display = 'block';
        select.style.display = 'none';
        label.innerText = "Bill Number (Numeric)";
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

    // Handle Opening Due as Bill #0
    if(vendor.opening_due > 0) {
        allBills["0"] = { date: 'Initial', total: vendor.opening_due, paid: 0, due: vendor.opening_due };
    }

    if(ledger) {
        ledger.forEach(l => {
            const bNo = l.bill_no || "0";
            if(!allBills[bNo]) allBills[bNo] = { date: l.t_date, total: 0, paid: 0, due: 0 };
            
            if(l.t_type === 'BILL') {
                allBills[bNo].total += l.amount;
                totalBillAmt += l.amount;
            } else {
                allBills[bNo].paid += l.amount;
                totalPaidAmt += l.amount;
            }
        });
    }

    const list = document.getElementById('ledgerList');
    const invBody = document.getElementById('invBody');
    list.innerHTML = '';
    invBody.innerHTML = '';

    // Sort Bill Numbers Numerically
    const sortedBillNos = Object.keys(allBills).sort((a, b) => parseInt(a) - parseInt(b));

    sortedBillNos.forEach((bNo, index) => {
        const b = allBills[bNo];
        b.due = b.total - b.paid;
        const isPaid = b.due <= 0;
        const statusLabel = isPaid ? 'FULL PAID' : (b.paid > 0 ? 'PARTIAL' : 'UNPAID');
        const badgeClass = isPaid ? 'badge-payment' : 'badge-bill';
        const stampClass = isPaid ? 'stamp-paid' : 'stamp-partial';
        const displayBillNo = bNo === "0" ? "OPENING" : bNo;

        list.innerHTML += `
            <li class="ledger-item">
                <div class="li-left">
                    <span><span class="bill-row-serial">#${index + 1}</span> Bill: ${displayBillNo}</span>
                    <small>Total: ₹${b.total.toLocaleString('en-IN')} | Paid: ₹${b.paid.toLocaleString('en-IN')}</small>
                    <small><i class="ri-calendar-line"></i> ${b.date}</small>
                </div>
                <div class="li-right">
                    <b style="color: ${isPaid ? 'var(--success)' : 'var(--danger)'}">Due: ₹${b.due.toLocaleString('en-IN')}</b>
                    <small class="${badgeClass}">${statusLabel}</small>
                </div>
            </li>
        `;

        invBody.innerHTML += `
            <tr>
                <td>${index + 1}</td>
                <td>${b.date}</td>
                <td>${displayBillNo}</td>
                <td>₹${b.total.toLocaleString('en-IN')}</td>
                <td>₹${b.paid.toLocaleString('en-IN')}</td>
                <td><strong style="color:${isPaid ? '#059669' : '#ef4444'}">₹${b.due.toLocaleString('en-IN')}</strong></td>
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

    if(!amount || billNo === "") return alert("Please enter amount and numeric Bill Number");

    await _supabase.from('vendor_ledger').insert({
        user_id: currentUser.id,
        vendor_id: vendorId,
        t_date: date,
        t_type: type,
        description: desc,
        amount: amount,
        bill_no: billNo.toString()
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
    document.getElementById('invDate').innerText = "Date: " + new Date().toLocaleDateString('en-GB');
    
    html2canvas(element, { 
        scale: 2,
        useCORS: true,
        logging: false
    }).then(canvas => {
        const link = document.createElement('a');
        const vendorName = document.getElementById('vNameTitle').innerText.replace(/\s+/g, '_');
        link.download = `Statement_${vendorName}_${new Date().getTime()}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        
        if (navigator.share) {
            canvas.toBlob(blob => {
                const file = new File([blob], "statement.png", { type: "image/png" });
                navigator.share({
                    files: [file],
                    title: 'Vendor Statement',
                    text: `Statement for ${document.getElementById('vNameTitle').innerText}`
                }).catch(console.error);
            });
        }
    });
}
