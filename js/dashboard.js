let currentUser = null;
let vendorsList = [];

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    const dateInput = document.getElementById('date');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    dateInput.value = today;
    updateDisplayDate(today);
    
    dateInput.addEventListener('change', function() {
        updateDisplayDate(this.value);
        loadData();
    });
    
    document.getElementById('expStatus').addEventListener('change', function() {
        const partialInput = document.getElementById('partialPaid');
        if(this.value === 'PARTIAL') partialInput.classList.add('show');
        else partialInput.classList.remove('show');
    });

    await fetchVendors();
    await loadData();
    
    document.getElementById('expDesc').addEventListener('input', async function() {
        const name = this.value.trim();
        if (name.length < 2) return;

        const { data } = await _supabase.from('expenses')
            .select('description')
            .eq('user_id', currentUser.id)
            .ilike('description', `${name}%`)
            .order('created_at', { ascending: false })
            .limit(1);

        if (data && data.length > 0) {
            const match = data[0].description.match(/\(([^)]+)\)/);
            if (match) {
                document.getElementById('expItem').value = match[1];
            }
        }
    });
};

function updateDisplayDate(dateStr) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const date = new Date(dateStr + 'T00:00:00');
    document.getElementById('displayDate').innerText = date.toLocaleDateString('en-US', options);
}

async function fetchVendors() {
    const { data } = await _supabase.from('vendors').select('id, name').eq('user_id', currentUser.id);
    if(data) {
        vendorsList = data;
        const datalist = document.getElementById('vendorSuggestions');
        datalist.innerHTML = data.map(v => `<option value="${v.name}">`).join('');
    }
}

async function loadData() {
    const date = document.getElementById('date').value;
    const { data: sales } = await _supabase.from('sales').select('*').eq('user_id', currentUser.id).eq('report_date', date);
    
    ['saleCash', 'saleCard', 'saleSwiggy', 'saleZomato'].forEach(id => document.getElementById(id).value = '');

    if(sales) {
        sales.forEach(s => {
            if(s.sale_type === 'CASH') document.getElementById('saleCash').value = s.amount;
            if(s.sale_type === 'CARD') document.getElementById('saleCard').value = s.amount;
            if(s.sale_type === 'SWIGGY') document.getElementById('saleSwiggy').value = s.amount;
            if(s.sale_type === 'ZOMATO') document.getElementById('saleZomato').value = s.amount;
        });
    }

    const { data: expenses } = await _supabase.from('expenses').select('*').eq('user_id', currentUser.id).eq('report_date', date);
    const list = document.getElementById('expenseList');
    list.innerHTML = '';
    
    if(expenses && expenses.length > 0) {
        expenses.forEach(e => {
            let sourceText = "";
            let color = "#64748b";
            if(e.payment_source === 'CASH') { sourceText = "Paid from Cash"; color = "#ef4444"; }
            else if(e.payment_source === 'OWNER') { sourceText = "Paid by Owner (Dhar)"; color = "#f59e0b"; }
            else { sourceText = "Added to Baki"; }

            list.innerHTML += `
                <li class="expense-li">
                    <div class="li-info">
                        <strong>${e.description}</strong>
                        <small>${sourceText}</small>
                    </div>
                    <b style="color: ${color}">₹${e.amount.toLocaleString('en-IN')}</b>
                </li>`;
        });
    } else {
        list.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No expenses yet</p>';
    }
    updateCalculations();
}

function updateCalculations() {
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    const cardSale = parseFloat(document.getElementById('saleCard').value) || 0;
    const swiggy = parseFloat(document.getElementById('saleSwiggy').value) || 0;
    const zomato = parseFloat(document.getElementById('saleZomato').value) || 0;

    document.getElementById('totalSale').innerText = `₹${(cashSale + cardSale + swiggy + zomato).toLocaleString('en-IN')}`;

    const listItems = document.querySelectorAll('.expense-li');
    let cashExpenseTotal = 0;
    listItems.forEach(li => {
        if(li.querySelector('small').innerText.includes('from Cash')) {
            const amt = parseFloat(li.querySelector('b').innerText.replace('₹', '').replace(/,/g, ''));
            cashExpenseTotal += amt;
        }
    });

    document.getElementById('totalExp').innerText = `₹${cashExpenseTotal.toLocaleString('en-IN')}`;
    const systemCash = cashSale - cashExpenseTotal;
    document.getElementById('sysCash').innerText = `₹${systemCash.toLocaleString('en-IN')}`;
}

async function handleAddExpense() {
    const vendorName = document.getElementById('expDesc').value;
    const itemName = document.getElementById('expItem').value;
    const totalAmount = parseFloat(document.getElementById('expAmount').value);
    const status = document.getElementById('expStatus').value;
    const partialPaid = parseFloat(document.getElementById('partialPaid').value) || 0;
    const date = document.getElementById('date').value;

    if(!vendorName || !totalAmount) return alert("Please enter vendor name and amount");

    const fullDesc = itemName ? `${vendorName} (${itemName})` : vendorName;
    const vendor = vendorsList.find(v => v.name.toLowerCase() === vendorName.toLowerCase());

    if(status === 'PAID') {
        await saveExpenseRecord(fullDesc, totalAmount, 'CASH', date);
        if(vendor) {
            await updateVendorLedger(vendor.id, date, 'BILL', totalAmount, `Bill for ${itemName || vendorName}`);
            await updateVendorLedger(vendor.id, date, 'PAYMENT', totalAmount, `Cash Paid for ${itemName || vendorName}`);
        }
    } 
    else if(status === 'OWNER') {
        await saveExpenseRecord(`${fullDesc} (Owner Paid)`, totalAmount, 'OWNER', date);
        await updateOwnerLedger(date, 'LOAN_TAKEN', totalAmount, `Paid for ${fullDesc}`);
        if(vendor) {
            await updateVendorLedger(vendor.id, date, 'BILL', totalAmount, `Bill for ${itemName || vendorName}`);
            await updateVendorLedger(vendor.id, date, 'PAYMENT', totalAmount, `Paid by Owner for ${itemName || vendorName}`);
        }
    }
    else if(status === 'DUE') {
        await saveExpenseRecord(fullDesc, totalAmount, 'DUE', date);
        if(vendor) await updateVendorLedger(vendor.id, date, 'BILL', totalAmount, `Baki for ${itemName || vendorName}`);
    } 
    else if(status === 'PARTIAL') {
        if(partialPaid >= totalAmount) return alert("Partial paid must be less than total");
        await saveExpenseRecord(`${fullDesc} (Partial Paid)`, partialPaid, 'CASH', date);
        await saveExpenseRecord(`${fullDesc} (Baki)`, totalAmount - partialPaid, 'DUE', date);
        if(vendor) {
            await updateVendorLedger(vendor.id, date, 'BILL', totalAmount, `Bill for ${itemName || vendorName}`);
            await updateVendorLedger(vendor.id, date, 'PAYMENT', partialPaid, `Partial Cash Paid for ${itemName || vendorName}`);
        }
    }

    document.getElementById('expDesc').value = '';
    document.getElementById('expItem').value = '';
    document.getElementById('expAmount').value = '';
    document.getElementById('partialPaid').value = '';
    loadData();
}

async function saveExpenseRecord(desc, amount, source, date) {
    await _supabase.from('expenses').insert({
        user_id: currentUser.id, report_date: date, description: desc, amount: amount, payment_source: source
    });
}

async function updateVendorLedger(vId, date, type, amount, note) {
    await _supabase.from('vendor_ledger').insert({
        user_id: currentUser.id, vendor_id: vId, t_date: date, t_type: type, amount: amount, description: note
    });
}

async function updateOwnerLedger(date, type, amount, note) {
    await _supabase.from('owner_ledger').insert({
        user_id: currentUser.id, t_date: date, t_type: type, amount: amount, description: note
    });
}

async function saveSales() {
    const date = document.getElementById('date').value;
    const data = [
        { type: 'CASH', id: 'saleCash' }, { type: 'CARD', id: 'saleCard' },
        { type: 'SWIGGY', id: 'saleSwiggy' }, { type: 'ZOMATO', id: 'saleZomato' }
    ];
    for(let item of data) {
        const amount = parseFloat(document.getElementById(item.id).value) || 0;
        const { data: exist } = await _supabase.from('sales').select('id').eq('user_id', currentUser.id).eq('report_date', date).eq('sale_type', item.type);
        if(exist.length > 0) await _supabase.from('sales').update({ amount }).eq('id', exist[0].id);
        else await _supabase.from('sales').insert({ user_id: currentUser.id, report_date: date, sale_type: item.type, amount });
    }
    alert("Sales Updated!");
    loadData();
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}
