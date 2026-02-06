let currentUser = null;
let vendorsList = [];
let rowCount = 0;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    document.getElementById('accDate').value = today;
    await fetchVendors();
    loadDataForDate();
};

async function fetchVendors() {
    const { data } = await _supabase.from('vendors').select('id, name').eq('user_id', currentUser.id);
    if(data) {
        vendorsList = data;
        document.getElementById('vendorSuggestions').innerHTML = data.map(v => `<option value="${v.name}">`).join('');
    }
}

async function loadDataForDate() {
    const selectedDate = document.getElementById('accDate').value;
    const tbody = document.getElementById('expenseBody');
    const loader = document.getElementById('loading');
    loader.style.display = 'flex';
    tbody.innerHTML = '';
    rowCount = 0;

    try {
        const { data: expenses } = await _supabase.from('expenses').select('*').eq('user_id', currentUser.id).eq('report_date', selectedDate).order('created_at', { ascending: true });

        if (expenses && expenses.length > 0) {
            const grouped = {};
            expenses.forEach(exp => {
                const rawDesc = exp.description || "";
                const vendorPart = rawDesc.split(' (')[0];
                const itemPart = rawDesc.includes('(') ? rawDesc.match(/\(([^)]+)\)/)[1] : "";
                const cleanItem = itemPart.replace("Partial Paid by CASH", "").replace("Partial Paid by OWNER", "").replace("Partial Due", "").replace("Owner Paid", "").trim();
                const groupKey = `${vendorPart}-${cleanItem}-${exp.bill_no || 'no-bill'}`;

                if (!grouped[groupKey]) {
                    grouped[groupKey] = { ...exp, vendorName: vendorPart, itemName: cleanItem, partial: 0, partialSrc: 'CASH', dueExpenseId: null };
                } else {
                    if (exp.payment_source === 'CASH' || exp.payment_source === 'OWNER') {
                        grouped[groupKey].partial = exp.amount;
                        grouped[groupKey].partialSrc = exp.payment_source;
                        grouped[groupKey].dueExpenseId = grouped[groupKey].id;
                        grouped[groupKey].id = exp.id;
                        grouped[groupKey].amount += exp.amount;
                    } else {
                        grouped[groupKey].partial = grouped[groupKey].amount;
                        grouped[groupKey].amount += exp.amount;
                        grouped[groupKey].dueExpenseId = exp.id;
                    }
                    grouped[groupKey].payment_source = 'PARTIAL';
                }
            });

            for (const key in grouped) {
                const item = grouped[key];
                const vendor = vendorsList.find(v => v.name.toLowerCase() === item.vendorName.toLowerCase());
                let billDate = item.report_date, ledgerId = null, payLedgerId = null, ownerId = null;

                if (vendor && item.bill_no) {
                    const { data: ledger } = await _supabase.from('vendor_ledger').select('*').eq('vendor_id', vendor.id).eq('bill_no', item.bill_no).limit(5);
                    if (ledger) {
                        const billRec = ledger.find(l => l.t_type === 'BILL');
                        const payRec = ledger.find(l => l.t_type.startsWith('PAYMENT'));
                        if (billRec) { billDate = billRec.t_date; ledgerId = billRec.id; }
                        if (payRec) payLedgerId = payRec.id;
                    }
                }

                if (item.partialSrc === 'OWNER' || item.payment_source === 'OWNER') {
                    const { data: ownerRec } = await _supabase.from('owner_ledger').select('id').eq('user_id', currentUser.id).eq('t_date', item.report_date).eq('amount', item.partial || item.amount).limit(1).maybeSingle();
                    if (ownerRec) ownerId = ownerRec.id;
                }

                createRowHTML({
                    id: item.id, vendor: item.vendorName, item: item.itemName,
                    billDate, accDate: item.report_date, billNo: item.bill_no, amount: item.amount, status: item.payment_source,
                    partial: item.partial, partialSrc: item.partialSrc, dueExpenseId: item.dueExpenseId, ledgerId, payLedgerId, ownerId
                });
            }
        }

        if (rowCount === 0) for (let i = 0; i < 5; i++) addNewRow();
        else addNewRow();
    } catch (err) {
        console.error("Error:", err);
        for (let i = 0; i < 5; i++) addNewRow();
    } finally {
        loader.style.display = 'none';
        calculateGrandTotal();
    }
}

function addNewRow() {
    const today = document.getElementById('accDate').value;
    createRowHTML({ id: null, vendor: '', item: '', billDate: today, accDate: today, billNo: '', amount: '', status: 'PAID', partial: '', partialSrc: 'CASH', ledgerId: null, ownerId: null, dueExpenseId: null, payLedgerId: null });
}

function createRowHTML(data) {
    rowCount++;
    const tbody = document.getElementById('expenseBody');
    const tr = document.createElement('tr');
    tr.id = `row-${rowCount}`;
    tr.setAttribute('data-expense-id', data.id || '');
    tr.setAttribute('data-due-expense-id', data.dueExpenseId || '');
    tr.setAttribute('data-ledger-id', data.ledgerId || '');
    tr.setAttribute('data-pay-ledger-id', data.payLedgerId || '');
    tr.setAttribute('data-owner-id', data.ownerId || '');
    tr.setAttribute('data-acc-date', data.accDate || document.getElementById('accDate').value);

    let iconHtml = data.id ? '<i class="ri-checkbox-circle-line status-saved"></i>' : '<i class="ri-cloud-off-line status-pending"></i>';

    tr.innerHTML = `
        <td>${rowCount}</td>
        <td><input type="text" class="v-name" list="vendorSuggestions" value="${data.vendor || ''}" placeholder="Vendor" onchange="handleVendorChange(this)"></td>
        <td><input type="text" class="v-item" value="${data.item || ''}" placeholder="Item"></td>
        <td><input type="date" class="v-bill-date" value="${data.billDate || ''}"></td>
        <td><input type="number" class="v-bill-no" value="${data.billNo || ''}" placeholder="No"></td>
        <td><input type="number" class="v-amount" value="${data.amount || ''}" placeholder="0" oninput="calculateGrandTotal()"></td>
        <td>
            <select class="v-status" onchange="handleStatusChange(this)">
                <option value="PAID" ${data.status === 'PAID' ? 'selected' : ''}>CASH</option>
                <option value="OWNER" ${data.status === 'OWNER' ? 'selected' : ''}>OWNER</option>
                <option value="DUE" ${data.status === 'DUE' ? 'selected' : ''}>DUE</option>
                <option value="PARTIAL" ${data.status === 'PARTIAL' ? 'selected' : ''}>PARTIAL</option>
            </select>
        </td>
        <td>
            <input type="number" class="v-partial ${data.status === 'PARTIAL' ? '' : 'hidden'}" value="${data.partial || ''}" placeholder="Paid" ${data.status === 'PARTIAL' ? '' : 'disabled'}>
            <select class="v-partial-src ${data.status === 'PARTIAL' ? '' : 'hidden'}">
                <option value="CASH" ${data.partialSrc === 'CASH' ? 'selected' : ''}>CASH</option>
                <option value="OWNER" ${data.partialSrc === 'OWNER' ? 'selected' : ''}>OWNER</option>
            </select>
        </td>
        <td><div id="status-icon-${rowCount}" class="save-status">${iconHtml}</div></td>
        <td><button class="btn-remove" onclick="removeRow(${rowCount})"><i class="ri-delete-bin-line"></i></button></td>
    `;
    handleStatusChange(tr.querySelector('.v-status'));
    tbody.appendChild(tr);
}

async function saveAllRows() {
    const saveBtn = document.getElementById('saveAllBtn');
    saveBtn.disabled = true;
    saveBtn.innerHTML = '<i class="ri-loader-4-line spin"></i> Saving...';

    const rows = document.querySelectorAll('#expenseBody tr');
    let successCount = 0;

    for (let row of rows) {
        const id = row.id.split('-')[1];
        const isSuccess = await syncRowToSupabase(id);
        if (isSuccess) successCount++;
    }

    saveBtn.disabled = false;
    saveBtn.innerHTML = '<i class="ri-save-3-line"></i> Save All';
    
    if (successCount > 0) alert(`Successfully saved ${successCount} entries!`);
}

async function syncRowToSupabase(id) {
    const row = document.getElementById(`row-${id}`);
    if (!row) return false;

    const statusIcon = document.getElementById(`status-icon-${id}`);
    const vendorName = row.querySelector('.v-name').value.trim();
    const itemName = row.querySelector('.v-item').value.trim();
    const billDate = row.querySelector('.v-bill-date').value;
    const accDate = row.getAttribute('data-acc-date');
    const billNo = row.querySelector('.v-bill-no').value;
    const amount = parseFloat(row.querySelector('.v-amount').value) || 0;
    const status = row.querySelector('.v-status').value;
    const partialPaid = parseFloat(row.querySelector('.v-partial').value) || 0;
    const partialSrc = row.querySelector('.v-partial-src')?.value || 'CASH';

    if (!vendorName || amount <= 0) return false;

    statusIcon.innerHTML = '<i class="ri-loader-4-line status-saving"></i>';

    const fullDesc = itemName ? `${vendorName} (${itemName})` : vendorName;
    const vendor = vendorsList.find(v => v.name.toLowerCase() === vendorName.toLowerCase());
    let expenseId = row.getAttribute('data-expense-id') || null;
    let dueExpenseId = row.getAttribute('data-due-expense-id') || null;
    let ledgerId = row.getAttribute('data-ledger-id') || null;
    let payLedgerId = row.getAttribute('data-pay-ledger-id') || null;
    let ownerId = row.getAttribute('data-owner-id') || null;

    try {
        let expData = { user_id: currentUser.id, report_date: accDate, description: fullDesc, amount, bill_no: billNo };
        if (status === 'PAID') expData.payment_source = 'CASH';
        else if (status === 'OWNER') { expData.payment_source = 'OWNER'; expData.description += " (Owner Paid)"; }
        else if (status === 'DUE') expData.payment_source = 'DUE';
        else if (status === 'PARTIAL') { expData.payment_source = 'DUE'; expData.amount = amount - partialPaid; expData.description += " (Partial Due)"; }
        if (expenseId) expData.id = expenseId;
        let { data: expResult } = await _supabase.from('expenses').upsert(expData).select().single();
        row.setAttribute('data-expense-id', expResult.id);

        if (status === 'PARTIAL') {
            let paidData = { user_id: currentUser.id, report_date: accDate, description: `${fullDesc} (Partial ${partialSrc})`, amount: partialPaid, payment_source: partialSrc, bill_no: billNo };
            if (dueExpenseId) paidData.id = dueExpenseId;
            let { data: paidResult } = await _supabase.from('expenses').upsert(paidData).select().single();
            row.setAttribute('data-due-expense-id', paidResult.id);
        } else if (dueExpenseId) {
            await _supabase.from('expenses').delete().eq('id', dueExpenseId);
            row.setAttribute('data-due-expense-id', '');
        }

        if (vendor) {
            let billData = { user_id: currentUser.id, vendor_id: vendor.id, t_date: billDate, bill_no: billNo, amount, description: `Bill for ${itemName || vendorName}`, t_type: 'BILL' };
            if (ledgerId) billData.id = ledgerId;
            let { data: billResult } = await _supabase.from('vendor_ledger').upsert(billData).select().single();
            row.setAttribute('data-ledger-id', billResult.id);

            if (status === 'PAID' || status === 'OWNER' || status === 'PARTIAL') {
                let payAmt = (status === 'PARTIAL') ? partialPaid : amount;
                let paySrc = (status === 'PARTIAL') ? partialSrc : status;
                let payData = { user_id: currentUser.id, vendor_id: vendor.id, t_date: accDate, bill_no: billNo, amount: payAmt, description: paySrc === 'OWNER' ? 'Paid by Owner' : 'Cash Paid', t_type: paySrc === 'OWNER' ? 'PAYMENT_OWNER' : 'PAYMENT' };
                if (payLedgerId) payData.id = payLedgerId;
                let { data: payResult } = await _supabase.from('vendor_ledger').upsert(payData).select().single();
                row.setAttribute('data-pay-ledger-id', payResult.id);
            } else if (payLedgerId) {
                await _supabase.from('vendor_ledger').delete().eq('id', payLedgerId);
                row.setAttribute('data-pay-ledger-id', '');
            }
        }

        const isOwnerPay = (status === 'OWNER') || (status === 'PARTIAL' && partialSrc === 'OWNER');
        if (isOwnerPay) {
            let ownAmt = (status === 'PARTIAL') ? partialPaid : amount;
            let ownData = { user_id: currentUser.id, t_date: accDate, t_type: 'LOAN_TAKEN', amount: ownAmt, description: `Paid for ${fullDesc}` };
            if (ownerId) ownData.id = ownerId;
            let { data: ownResult } = await _supabase.from('owner_ledger').upsert(ownData).select().single();
            row.setAttribute('data-owner-id', ownResult.id);
        } else if (ownerId) {
            await _supabase.from('owner_ledger').delete().eq('id', ownerId);
            row.setAttribute('data-owner-id', '');
        }

        statusIcon.innerHTML = '<i class="ri-checkbox-circle-line status-saved"></i>';
        return true;
    } catch (err) { 
        console.error(err); 
        statusIcon.innerHTML = '<i class="ri-error-warning-line status-error"></i>';
        return false;
    }
}

async function handleVendorChange(input) {
    const row = input.closest('tr');
    const vendor = vendorsList.find(v => v.name.toLowerCase() === input.value.trim().toLowerCase());
    if (vendor) {
        const { data: lastBill } = await _supabase.from('vendor_ledger').select('bill_no').eq('vendor_id', vendor.id).eq('t_type', 'BILL').order('bill_no', { ascending: false }).limit(1);
        row.querySelector('.v-bill-no').value = lastBill?.[0] ? (parseInt(lastBill[0].bill_no) || 0) + 1 : 1;
    }
}

function handleStatusChange(select) {
    const row = select.closest('tr');
    const partialInput = row.querySelector('.v-partial');
    const partialSrc = row.querySelector('.v-partial-src');
    select.className = 'v-status ' + (select.value === 'PAID' ? 'status-cash' : (select.value === 'OWNER' ? 'status-owner' : (select.value === 'DUE' ? 'status-due' : 'status-partial')));
    if(select.value === 'PARTIAL') {
        partialInput.classList.remove('hidden'); partialInput.disabled = false;
        partialSrc.classList.remove('hidden'); partialSrc.disabled = false;
    } else {
        partialInput.classList.add('hidden'); partialInput.disabled = true; partialInput.value = '';
        partialSrc.classList.add('hidden'); partialSrc.disabled = true;
    }
}

async function removeRow(id) {
    const row = document.getElementById(`row-${id}`);
    if (!row || !confirm("Delete?")) return;
    for (let attr of ['data-expense-id', 'data-due-expense-id', 'data-ledger-id', 'data-pay-ledger-id', 'data-owner-id']) {
        let val = row.getAttribute(attr);
        if (val) {
            const table = attr.includes('expense') ? 'expenses' : (attr.includes('ledger') ? 'vendor_ledger' : 'owner_ledger');
            await _supabase.from(table).delete().eq('id', val);
        }
    }
    row.remove(); calculateGrandTotal();
}

function clearLocalStorage() { if(confirm("Clear?")) location.reload(); }
function calculateGrandTotal() {
    let total = 0;
    document.querySelectorAll('.v-amount').forEach(input => total += parseFloat(input.value) || 0);
    document.getElementById('grandTotal').innerText = `₹${total.toLocaleString('en-IN')}`;
}
async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }
