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

    if(type === 'PAYMENT' || type === 'PAYMENT_OWNER') {
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

    // Fetch for calculation (oldest to newest)
    const { data: calcLedger } = await _supabase.from('vendor_ledger')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('t_date', { ascending: true });

    // Fetch for display (newest to oldest)
    const { data: displayLedger } = await _supabase.from('vendor_ledger')
        .select('*')
        .eq('vendor_id', vendorId)
        .order('t_date', { ascending: false })
        .order('created_at', { ascending: false });

    allBills = {};
    let totalBillAmt = vendor.opening_due || 0;
    let totalPaidAmt = 0;

    // Handle Opening Due as Bill #0
    if(vendor.opening_due > 0) {
        allBills["0"] = { date: 'Initial', total: vendor.opening_due, paid: 0, due: vendor.opening_due };
    }

    if(calcLedger) {
        calcLedger.forEach(l => {
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

    // Render Summary Cards
    document.getElementById('totBill').innerText = `₹${totalBillAmt.toLocaleString('en-IN')}`;
    document.getElementById('totPaid').innerText = `₹${totalPaidAmt.toLocaleString('en-IN')}`;
    const netDue = totalBillAmt - totalPaidAmt;
    document.getElementById('currDue').innerText = `₹${netDue.toLocaleString('en-IN')}`;
    document.getElementById('invTotalDue').innerText = `₹${netDue.toLocaleString('en-IN')}`;

    // Render List Items (Newest Date First)
    if(displayLedger) {
        displayLedger.forEach((l) => {
            let badgeClass = 'badge-bill';
            let statusLabel = 'BILL';
            let amountColor = 'var(--danger)';

            if(l.t_type === 'PAYMENT') {
                badgeClass = 'badge-payment';
                statusLabel = 'PAID (CASH)';
                amountColor = 'var(--success)';
            } else if (l.t_type === 'PAYMENT_OWNER') {
                badgeClass = 'badge-owner';
                statusLabel = 'PAID (OWNER)';
                amountColor = '#4338ca';
            }

            const safeDesc = l.description ? l.description.replace(/'/g, "\\'") : "";

            list.innerHTML += `
                <li class="ledger-item">
                    <div class="li-left">
                        <span>${l.t_type === 'BILL' ? 'Bill #' + l.bill_no : 'Payment for Bill #' + l.bill_no}</span>
                        <small>${l.description || '-'}</small>
                        <small><i class="ri-calendar-line"></i> ${l.t_date}</small>
                    </div>
                    <div class="li-right">
                        <b style="color: ${amountColor}">₹${l.amount.toLocaleString('en-IN')}</b>
                        <small class="${badgeClass}">${statusLabel}</small>
                        <div class="li-actions">
                            <button class="btn-icon edit" onclick="editEntry('${l.id}', '${l.t_type}', '${l.amount}', '${l.bill_no}', '${l.t_date}', '${safeDesc}')"><i class="ri-pencil-line"></i></button>
                            <button class="btn-icon delete" onclick="deleteEntry('${l.id}', '${l.t_type}')"><i class="ri-delete-bin-line"></i></button>
                        </div>
                    </div>
                </li>
            `;
        });
    }

    // Render Invoice Table (Bill-wise summary)
    sortedBillNos.forEach((bNo, index) => {
        const b = allBills[bNo];
        b.due = b.total - b.paid;
        const isPaid = b.due <= 0;
        const statusLabel = isPaid ? 'FULL PAID' : (b.paid > 0 ? 'PARTIAL' : 'UNPAID');
        const stampClass = isPaid ? 'stamp-paid' : 'stamp-partial';
        const displayBillNo = bNo === "0" ? "OPENING" : bNo;

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
    
    toggleBillSelect();
}

async function addEntry() {
    const type = document.getElementById('entryType').value;
    const date = document.getElementById('entryDate').value;
    const desc = document.getElementById('entryDesc').value;
    const amount = parseFloat(document.getElementById('entryAmount').value);
    let billNo = document.getElementById('entryBillNo').value;

    if(type === 'PAYMENT' || type === 'PAYMENT_OWNER') {
        billNo = document.getElementById('selectBillNo').value;
    }

    if(!amount || billNo === "") return alert("Please enter amount and numeric Bill Number");

    // 1. Add to Vendor Ledger
    const { error } = await _supabase.from('vendor_ledger').insert({
        user_id: currentUser.id,
        vendor_id: vendorId,
        t_date: date,
        t_type: type,
        description: desc,
        amount: amount,
        bill_no: billNo.toString()
    });

    if(error) {
        alert("Error: " + error.message);
        return;
    }

    // 2. If Owner Payment, Add to Owner Ledger (Loan Taken)
    if(type === 'PAYMENT_OWNER') {
        const { data: vendor } = await _supabase.from('vendors').select('name').eq('id', vendorId).single();
        await _supabase.from('owner_ledger').insert({
            user_id: currentUser.id,
            t_date: date,
            t_type: 'LOAN_TAKEN',
            amount: amount,
            description: `Paid to ${vendor.name} (Bill #${billNo})`
        });
    }

    document.getElementById('entryAmount').value = '';
    document.getElementById('entryDesc').value = '';
    document.getElementById('entryBillNo').value = '';
    loadDetails();
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}

async function deleteEntry(id, type) {
    if(!confirm("Are you sure you want to delete this entry?")) return;

    const { error } = await _supabase.from('vendor_ledger').delete().eq('id', id);

    if(error) {
        alert("Error deleting: " + error.message);
    } else {
        if(type === 'PAYMENT_OWNER') {
            alert("⚠️ Note: This was an Owner Payment. Please manually delete the corresponding entry from the Owner Ledger page to keep balances correct.");
        }
        loadDetails();
    }
}

function editEntry(id, type, amount, billNo, date, desc) {
    // Populate form
    document.getElementById('entryType').value = type;
    toggleBillSelect(); // Refresh UI based on type

    document.getElementById('entryDate').value = date;
    document.getElementById('entryAmount').value = amount;
    document.getElementById('entryDesc').value = desc;

    if(type === 'BILL') {
        document.getElementById('entryBillNo').value = billNo;
    } else {
        // For payments, we need to select the bill. 
        // Since the select might not have the bill if it's fully paid, we might need to handle this.
        // For now, try to set it.
        const select = document.getElementById('selectBillNo');
        select.value = billNo;
    }

    // Scroll to form
    document.getElementById('entryFormCard').scrollIntoView({ behavior: 'smooth' });

    // Delete the old entry so "Add" becomes "Update"
    if(confirm("To edit, the current entry will be removed and you can save the corrected one. Proceed?")) {
        deleteEntry(id, type);
    }
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
