let currentUser = null;
let vendorsList = [];
let rowCount = 0;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    document.getElementById('accDate').value = today;

    await fetchVendors();
    for(let i=0; i<5; i++) addRow();
};

async function fetchVendors() {
    const { data } = await _supabase.from('vendors').select('id, name').eq('user_id', currentUser.id);
    if(data) {
        vendorsList = data;
        document.getElementById('vendorSuggestions').innerHTML = data.map(v => `<option value="${v.name}">`).join('');
    }
}

function addRow() {
    rowCount++;
    const tbody = document.getElementById('expenseBody');
    const today = document.getElementById('accDate').value;
    
    const tr = document.createElement('tr');
    tr.id = `row-${rowCount}`;
    tr.innerHTML = `
        <td>${rowCount}</td>
        <td><input type="text" class="v-name" list="vendorSuggestions" placeholder="Vendor" onchange="handleVendorChange(this)"></td>
        <td><input type="text" class="v-item" placeholder="Item"></td>
        <td><input type="date" class="v-bill-date" value="${today}"></td>
        <td><input type="number" class="v-bill-no" placeholder="No"></td>
        <td><input type="number" class="v-amount" placeholder="0" oninput="calculateGrandTotal()"></td>
        <td>
            <select class="v-status status-cash" onchange="handleStatusChange(this)">
                <option value="PAID" class="opt-cash">CASH</option>
                <option value="OWNER" class="opt-owner">OWNER</option>
                <option value="DUE" class="opt-due">DUE</option>
                <option value="PARTIAL" class="opt-partial">PARTIAL</option>
            </select>
        </td>
        <td><input type="number" class="v-partial hidden" placeholder="Paid" disabled></td>
        <td><button class="btn-remove" onclick="removeRow(${rowCount})"><i class="ri-delete-bin-line"></i></button></td>
    `;
    tbody.appendChild(tr);
}

async function handleVendorChange(input) {
    const row = input.closest('tr');
    const name = input.value.trim();
    const vendor = vendorsList.find(v => v.name.toLowerCase() === name.toLowerCase());

    if (vendor) {
        // 1. Auto-fill Bill No (Last Bill + 1)
        const { data: lastBill } = await _supabase.from('vendor_ledger')
            .select('bill_no')
            .eq('vendor_id', vendor.id)
            .eq('t_type', 'BILL')
            .order('bill_no', { ascending: false })
            .limit(1);
        
        if (lastBill && lastBill.length > 0) {
            row.querySelector('.v-bill-no').value = (parseInt(lastBill[0].bill_no) || 0) + 1;
        } else {
            row.querySelector('.v-bill-no').value = 1;
        }

        // 2. Auto-fill Item/Category (Smart Logic - Skip Payment entries)
        const { data: recentExps } = await _supabase.from('expenses')
            .select('description')
            .ilike('description', `${name}%`)
            .order('created_at', { ascending: false })
            .limit(10);

        if (recentExps && recentExps.length > 0) {
            const validExp = recentExps.find(e => !e.description.toLowerCase().includes('payment'));
            if (validExp) {
                const match = validExp.description.match(/\(([^)]+)\)/);
                if (match) row.querySelector('.v-item').value = match[1];
            }
        }
    }
}

function handleStatusChange(select) {
    const row = select.closest('tr');
    const partialInput = row.querySelector('.v-partial');
    
    // Reset classes
    select.className = 'v-status';
    if(select.value === 'PAID') select.classList.add('status-cash');
    if(select.value === 'OWNER') select.classList.add('status-owner');
    if(select.value === 'DUE') select.classList.add('status-due');
    if(select.value === 'PARTIAL') select.classList.add('status-partial');

    if(select.value === 'PARTIAL') {
        partialInput.classList.remove('hidden');
        partialInput.disabled = false;
    } else {
        partialInput.classList.add('hidden');
        partialInput.disabled = true;
        partialInput.value = '';
    }
}

function removeRow(id) {
    document.getElementById(`row-${id}`).remove();
    calculateGrandTotal();
}

function calculateGrandTotal() {
    let total = 0;
    document.querySelectorAll('.v-amount').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    document.getElementById('grandTotal').innerText = `₹${total.toLocaleString('en-IN')}`;
}

async function saveAllExpenses() {
    const accDate = document.getElementById('accDate').value;
    const rows = document.querySelectorAll('#expenseBody tr');
    let savedCount = 0;

    for(let row of rows) {
        const vendorName = row.querySelector('.v-name').value.trim();
        const itemName = row.querySelector('.v-item').value.trim();
        const billDate = row.querySelector('.v-bill-date').value;
        const billNo = row.querySelector('.v-bill-no').value;
        const amount = parseFloat(row.querySelector('.v-amount').value) || 0;
        const status = row.querySelector('.v-status').value;
        const partialPaid = parseFloat(row.querySelector('.v-partial').value) || 0;

        if(!vendorName || amount <= 0) continue;

        const fullDesc = itemName ? `${vendorName} (${itemName})` : vendorName;
        const vendor = vendorsList.find(v => v.name.toLowerCase() === vendorName.toLowerCase());

        // Logic based on status
        if(status === 'PAID') {
            await saveExpenseRecord(fullDesc, amount, 'CASH', accDate, billNo);
            if(vendor) {
                await updateVendorLedger(vendor.id, billDate, 'BILL', amount, `Bill for ${itemName || vendorName}`, billNo);
                await updateVendorLedger(vendor.id, accDate, 'PAYMENT', amount, `Cash Paid`, billNo);
            }
        } else if(status === 'OWNER') {
            await saveExpenseRecord(`${fullDesc} (Owner Paid)`, amount, 'OWNER', accDate, billNo);
            await _supabase.from('owner_ledger').insert({ user_id: currentUser.id, t_date: accDate, t_type: 'LOAN_TAKEN', amount: amount, description: `Paid for ${fullDesc}` });
            if(vendor) {
                await updateVendorLedger(vendor.id, billDate, 'BILL', amount, `Bill for ${itemName || vendorName}`, billNo);
                await updateVendorLedger(vendor.id, accDate, 'PAYMENT', amount, `Paid by Owner`, billNo);
            }
        } else if(status === 'DUE') {
            await saveExpenseRecord(fullDesc, amount, 'DUE', accDate, billNo);
            if(vendor) await updateVendorLedger(vendor.id, billDate, 'BILL', amount, `Baki for ${itemName || vendorName}`, billNo);
        } else if(status === 'PARTIAL') {
            await saveExpenseRecord(`${fullDesc} (Partial Paid)`, partialPaid, 'CASH', accDate, billNo);
            await saveExpenseRecord(`${fullDesc} (Baki)`, amount - partialPaid, 'DUE', accDate, billNo);
            if(vendor) {
                await updateVendorLedger(vendor.id, billDate, 'BILL', amount, `Bill for ${itemName || vendorName}`, billNo);
                await updateVendorLedger(vendor.id, accDate, 'PAYMENT', partialPaid, `Partial Cash Paid`, billNo);
            }
        }
        savedCount++;
    }

    if(savedCount > 0) {
        alert(`Saved ${savedCount} entries!`);
        window.location.href = 'dashboard.html';
    }
}

async function saveExpenseRecord(desc, amount, source, date, billNo) {
    await _supabase.from('expenses').insert({ user_id: currentUser.id, report_date: date, description: desc, amount: amount, payment_source: source, bill_no: billNo });
}

async function updateVendorLedger(vId, date, type, amount, note, billNo) {
    await _supabase.from('vendor_ledger').insert({ user_id: currentUser.id, vendor_id: vId, t_date: date, t_type: type, amount: amount, description: note, bill_no: billNo });
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }
