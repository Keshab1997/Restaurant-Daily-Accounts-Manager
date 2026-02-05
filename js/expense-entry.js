let currentUser = null;
let vendorsList = [];
let rowCount = 0;
let saveTimers = {}; 
const LOCAL_STORAGE_KEY = 'restro_expense_draft';

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    document.getElementById('accDate').value = today;

    await fetchVendors();
    loadFromLocalStorage(); 
};

async function fetchVendors() {
    const { data } = await _supabase.from('vendors').select('id, name').eq('user_id', currentUser.id);
    if(data) {
        vendorsList = data;
        document.getElementById('vendorSuggestions').innerHTML = data.map(v => `<option value="${v.name}">`).join('');
    }
}

function loadFromLocalStorage() {
    const savedData = localStorage.getItem(LOCAL_STORAGE_KEY);
    const tbody = document.getElementById('expenseBody');
    tbody.innerHTML = '';
    rowCount = 0;

    if (savedData) {
        try {
            const rows = JSON.parse(savedData);
            if (Array.isArray(rows) && rows.length > 0) {
                rows.forEach(data => createRowHTML(data));
            } else {
                for(let i=0; i<5; i++) addNewRow();
            }
        } catch (e) {
            console.error("Local storage corrupted", e);
            for(let i=0; i<5; i++) addNewRow();
        }
    } else {
        for(let i=0; i<5; i++) addNewRow();
    }
    calculateGrandTotal();
}

function addNewRow() {
    const today = document.getElementById('accDate').value;
    createRowHTML({
        id: null, 
        vendor: '',
        item: '',
        billDate: today,
        billNo: '',
        amount: '',
        status: 'PAID',
        partial: '',
        ledgerId: null,
        ownerId: null,
        dueExpenseId: null, // New: For Partial Due part
        payLedgerId: null   // New: For Payment part in Ledger
    });
    saveToLocalStorage();
}

function createRowHTML(data) {
    rowCount++;
    const tbody = document.getElementById('expenseBody');
    const tr = document.createElement('tr');
    tr.id = `row-${rowCount}`;
    
    // Store DB IDs
    tr.setAttribute('data-expense-id', (data.id && data.id !== "null") ? data.id : '');
    tr.setAttribute('data-due-expense-id', (data.dueExpenseId && data.dueExpenseId !== "null") ? data.dueExpenseId : '');
    
    tr.setAttribute('data-ledger-id', (data.ledgerId && data.ledgerId !== "null") ? data.ledgerId : '');
    tr.setAttribute('data-pay-ledger-id', (data.payLedgerId && data.payLedgerId !== "null") ? data.payLedgerId : '');
    
    tr.setAttribute('data-owner-id', (data.ownerId && data.ownerId !== "null") ? data.ownerId : '');

    let iconHtml = '';
    if (data.id && data.id !== "null") iconHtml = '<i class="ri-checkbox-circle-line status-saved" title="Synced"></i>';
    else if (data.vendor && data.amount) iconHtml = '<i class="ri-cloud-off-line status-local" title="Saved Locally"></i>';

    tr.innerHTML = `
        <td>${rowCount}</td>
        <td><input type="text" class="v-name" list="vendorSuggestions" value="${data.vendor || ''}" placeholder="Vendor" oninput="handleInput(${rowCount})" onchange="handleVendorChange(this)"></td>
        <td><input type="text" class="v-item" value="${data.item || ''}" placeholder="Item" oninput="handleInput(${rowCount})"></td>
        <td><input type="date" class="v-bill-date" value="${data.billDate || ''}" onchange="handleInput(${rowCount})"></td>
        <td><input type="number" class="v-bill-no" value="${data.billNo || ''}" placeholder="No" oninput="handleInput(${rowCount})"></td>
        <td><input type="number" class="v-amount" value="${data.amount || ''}" placeholder="0" oninput="handleInput(${rowCount})"></td>
        <td>
            <select class="v-status" onchange="handleStatusChange(this); handleInput(${rowCount})">
                <option value="PAID" ${data.status === 'PAID' ? 'selected' : ''} class="opt-cash">CASH</option>
                <option value="OWNER" ${data.status === 'OWNER' ? 'selected' : ''} class="opt-owner">OWNER</option>
                <option value="DUE" ${data.status === 'DUE' ? 'selected' : ''} class="opt-due">DUE</option>
                <option value="PARTIAL" ${data.status === 'PARTIAL' ? 'selected' : ''} class="opt-partial">PARTIAL</option>
            </select>
        </td>
        <td><input type="number" class="v-partial ${data.status === 'PARTIAL' ? '' : 'hidden'}" value="${data.partial || ''}" placeholder="Paid" ${data.status === 'PARTIAL' ? '' : 'disabled'} oninput="handleInput(${rowCount})"></td>
        <td>
            <div id="status-icon-${rowCount}" class="save-status">${iconHtml}</div>
        </td>
        <td><button class="btn-remove" onclick="removeRow(${rowCount})"><i class="ri-delete-bin-line"></i></button></td>
    `;
    
    const select = tr.querySelector('.v-status');
    handleStatusChange(select); 
    
    tbody.appendChild(tr);
}

function handleInput(id) {
    saveToLocalStorage(); 
    calculateGrandTotal();
    triggerAutoSync(id);  
}

function saveToLocalStorage() {
    const rows = [];
    document.querySelectorAll('#expenseBody tr').forEach(tr => {
        rows.push({
            id: tr.getAttribute('data-expense-id') || null,
            dueExpenseId: tr.getAttribute('data-due-expense-id') || null,
            ledgerId: tr.getAttribute('data-ledger-id') || null,
            payLedgerId: tr.getAttribute('data-pay-ledger-id') || null,
            ownerId: tr.getAttribute('data-owner-id') || null,
            vendor: tr.querySelector('.v-name').value,
            item: tr.querySelector('.v-item').value,
            billDate: tr.querySelector('.v-bill-date').value,
            billNo: tr.querySelector('.v-bill-no').value,
            amount: tr.querySelector('.v-amount').value,
            status: tr.querySelector('.v-status').value,
            partial: tr.querySelector('.v-partial').value
        });
    });
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(rows));
}

function triggerAutoSync(id) {
    const statusIcon = document.getElementById(`status-icon-${id}`);
    statusIcon.innerHTML = '<i class="ri-loader-4-line status-saving"></i>';

    if (saveTimers[id]) clearTimeout(saveTimers[id]);

    saveTimers[id] = setTimeout(() => {
        syncRowToSupabase(id);
    }, 1000);
}

async function syncRowToSupabase(id) {
    const row = document.getElementById(`row-${id}`);
    if (!row) return;

    const statusIcon = document.getElementById(`status-icon-${id}`);
    
    const vendorName = row.querySelector('.v-name').value.trim();
    const itemName = row.querySelector('.v-item').value.trim();
    const billDate = row.querySelector('.v-bill-date').value;
    const accDate = document.getElementById('accDate').value;
    const billNo = row.querySelector('.v-bill-no').value;
    const amount = parseFloat(row.querySelector('.v-amount').value) || 0;
    const status = row.querySelector('.v-status').value;
    const partialPaid = parseFloat(row.querySelector('.v-partial').value) || 0;

    if (!vendorName || amount <= 0) {
        statusIcon.innerHTML = '<i class="ri-cloud-off-line status-local" title="Draft"></i>';
        return;
    }

    const fullDesc = itemName ? `${vendorName} (${itemName})` : vendorName;
    const vendor = vendorsList.find(v => v.name.toLowerCase() === vendorName.toLowerCase());
    
    // Get IDs
    let expenseId = row.getAttribute('data-expense-id');
    let dueExpenseId = row.getAttribute('data-due-expense-id');
    let ledgerId = row.getAttribute('data-ledger-id');
    let payLedgerId = row.getAttribute('data-pay-ledger-id');
    let ownerId = row.getAttribute('data-owner-id');

    // Clean IDs
    if (expenseId === "" || expenseId === "null") expenseId = null;
    if (dueExpenseId === "" || dueExpenseId === "null") dueExpenseId = null;
    if (ledgerId === "" || ledgerId === "null") ledgerId = null;
    if (payLedgerId === "" || payLedgerId === "null") payLedgerId = null;
    if (ownerId === "" || ownerId === "null") ownerId = null;

    try {
        // ============================================================
        // 1. EXPENSES TABLE LOGIC
        // ============================================================
        
        // 1.1 Main Expense Entry (Usually Cash/Owner/Due)
        let expData = {
            user_id: currentUser.id,
            report_date: accDate,
            description: fullDesc,
            amount: amount,
            bill_no: billNo
        };

        if (status === 'PAID') expData.payment_source = 'CASH';
        else if (status === 'OWNER') {
            expData.payment_source = 'OWNER';
            expData.description += " (Owner Paid)";
        }
        else if (status === 'DUE') expData.payment_source = 'DUE';
        else if (status === 'PARTIAL') {
            // For Partial: Main entry is the CASH PAID part
            expData.payment_source = 'CASH'; 
            expData.amount = partialPaid;
            expData.description += " (Partial Paid)";
        }

        if (expenseId) expData.id = expenseId;

        let { data: expResult, error: expError } = await _supabase.from('expenses').upsert(expData).select().single();
        if (expError) throw expError;
        if (expResult) row.setAttribute('data-expense-id', expResult.id);

        // 1.2 Secondary Expense Entry (Only for PARTIAL DUE)
        if (status === 'PARTIAL') {
            let dueAmount = amount - partialPaid;
            let dueData = {
                user_id: currentUser.id,
                report_date: accDate,
                description: `${fullDesc} (Partial Due)`,
                amount: dueAmount,
                payment_source: 'DUE',
                bill_no: billNo
            };
            if (dueExpenseId) dueData.id = dueExpenseId;

            let { data: dueResult, error: dueError } = await _supabase.from('expenses').upsert(dueData).select().single();
            if (dueError) throw dueError;
            if (dueResult) row.setAttribute('data-due-expense-id', dueResult.id);
        } else {
            // If status changed from PARTIAL to something else, delete the DUE entry
            if (dueExpenseId) {
                await _supabase.from('expenses').delete().eq('id', dueExpenseId);
                row.setAttribute('data-due-expense-id', '');
            }
        }

        // ============================================================
        // 2. VENDOR LEDGER LOGIC
        // ============================================================
        if (vendor) {
            // 2.1 BILL Entry (Always record the full bill)
            let billData = {
                user_id: currentUser.id,
                vendor_id: vendor.id,
                t_date: billDate,
                bill_no: billNo,
                amount: amount, // Full Bill Amount
                description: `Bill for ${itemName || vendorName}`,
                t_type: 'BILL'
            };
            if (ledgerId) billData.id = ledgerId;

            let { data: billResult, error: billError } = await _supabase.from('vendor_ledger').upsert(billData).select().single();
            if (billError) throw billError;
            if (billResult) row.setAttribute('data-ledger-id', billResult.id);

            // 2.2 PAYMENT Entry (If Cash, Owner, or Partial)
            if (status === 'PAID' || status === 'OWNER' || status === 'PARTIAL') {
                let payAmount = (status === 'PARTIAL') ? partialPaid : amount;
                let payDesc = (status === 'OWNER') ? `Paid by Owner` : `Cash Paid`;
                if (status === 'PARTIAL') payDesc = `Partial Cash Paid`;

                let payData = {
                    user_id: currentUser.id,
                    vendor_id: vendor.id,
                    t_date: accDate,
                    bill_no: billNo,
                    amount: payAmount,
                    description: payDesc,
                    t_type: (status === 'OWNER') ? 'PAYMENT_OWNER' : 'PAYMENT'
                };
                if (payLedgerId) payData.id = payLedgerId;

                let { data: payResult, error: payError } = await _supabase.from('vendor_ledger').upsert(payData).select().single();
                if (payError) throw payError;
                if (payResult) row.setAttribute('data-pay-ledger-id', payResult.id);
            } else {
                // If status is DUE, there is no payment, so delete payment entry if exists
                if (payLedgerId) {
                    await _supabase.from('vendor_ledger').delete().eq('id', payLedgerId);
                    row.setAttribute('data-pay-ledger-id', '');
                }
            }
        }

        // ============================================================
        // 3. OWNER LEDGER LOGIC
        // ============================================================
        if (status === 'OWNER') {
            let ownerData = {
                user_id: currentUser.id,
                t_date: accDate,
                t_type: 'LOAN_TAKEN',
                amount: amount,
                description: `Paid for ${fullDesc}`
            };
            if (ownerId) ownerData.id = ownerId;

            let { data: ownResult, error: ownError } = await _supabase.from('owner_ledger').upsert(ownerData).select().single();
            if (ownError) throw ownError;
            if (ownResult) row.setAttribute('data-owner-id', ownResult.id);
        } else if (ownerId) {
            await _supabase.from('owner_ledger').delete().eq('id', ownerId);
            row.setAttribute('data-owner-id', '');
        }

        saveToLocalStorage();
        statusIcon.innerHTML = '<i class="ri-checkbox-circle-line status-saved"></i>';

    } catch (err) {
        console.error("Sync Error:", err);
        statusIcon.innerHTML = '<i class="ri-error-warning-line status-error" title="Sync Failed"></i>';
    }
}

async function handleVendorChange(input) {
    const row = input.closest('tr');
    const name = input.value.trim();
    const vendor = vendorsList.find(v => v.name.toLowerCase() === name.toLowerCase());

    if (vendor) {
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
        
        handleInput(row.id.split('-')[1]);
    }
}

function handleStatusChange(select) {
    const row = select.closest('tr');
    const partialInput = row.querySelector('.v-partial');
    
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

async function removeRow(id) {
    const row = document.getElementById(`row-${id}`);
    if (!row) return;

    let expenseId = row.getAttribute('data-expense-id');
    let dueExpenseId = row.getAttribute('data-due-expense-id');
    let ledgerId = row.getAttribute('data-ledger-id');
    let payLedgerId = row.getAttribute('data-pay-ledger-id');
    let ownerId = row.getAttribute('data-owner-id');

    if (confirm("Delete this row?")) {
        if (expenseId && expenseId !== "null") await _supabase.from('expenses').delete().eq('id', expenseId);
        if (dueExpenseId && dueExpenseId !== "null") await _supabase.from('expenses').delete().eq('id', dueExpenseId);
        if (ledgerId && ledgerId !== "null") await _supabase.from('vendor_ledger').delete().eq('id', ledgerId);
        if (payLedgerId && payLedgerId !== "null") await _supabase.from('vendor_ledger').delete().eq('id', payLedgerId);
        if (ownerId && ownerId !== "null") await _supabase.from('owner_ledger').delete().eq('id', ownerId);
        
        row.remove();
        saveToLocalStorage(); 
        calculateGrandTotal();
    }
}

function clearLocalStorage() {
    if(confirm("Clear all local data? This will reset the form.")) {
        localStorage.removeItem(LOCAL_STORAGE_KEY);
        location.reload();
    }
}

function calculateGrandTotal() {
    let total = 0;
    document.querySelectorAll('.v-amount').forEach(input => {
        total += parseFloat(input.value) || 0;
    });
    document.getElementById('grandTotal').innerText = `₹${total.toLocaleString('en-IN')}`;
}

function updateAllRowsDate() {
    const rows = document.querySelectorAll('#expenseBody tr');
    rows.forEach(row => {
        const id = row.id.split('-')[1];
        triggerAutoSync(id);
    });
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }