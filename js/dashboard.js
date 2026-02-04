let currentUser = null;
let vendorsList = [];
let currentDayExpenses = [];
let restaurantName = "RestroManager";
let saveTimeout;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    const { data: profile } = await _supabase.from('profiles').select('restaurant_name, authorized_signature').eq('id', currentUser.id).maybeSingle();
    if(profile) {
        restaurantName = profile.restaurant_name;
        document.getElementById('sideNavName').innerText = restaurantName;
        document.getElementById('mainRestroName').innerText = restaurantName;
        if(document.getElementById('repSignature')) {
            document.getElementById('repSignature').innerText = profile.authorized_signature || restaurantName;
        }
    }

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

    // Updated: Use 'input' event for better mobile datalist support
    const expDescInput = document.getElementById('expDesc');
    
    // Show datalist on focus/click
    expDescInput.addEventListener('focus', function() {
        if (this.value === '') {
            // Trigger dropdown by setting and clearing a space
            this.value = ' ';
            this.value = '';
        }
    });
    
    expDescInput.addEventListener('input', async function() {
        const name = this.value.trim();
        if (!name) return;

        // Check if the typed name matches a vendor in our list
        const vendor = vendorsList.find(v => v.name.toLowerCase() === name.toLowerCase());
        
        if (vendor) {
            // Auto-fill bill number
            const { data: lastBillData } = await _supabase.from('vendor_ledger')
                .select('bill_no')
                .eq('vendor_id', vendor.id)
                .eq('t_type', 'BILL')
                .order('bill_no', { ascending: false })
                .limit(1);
            
            document.getElementById('expBillNo').value = (lastBillData && lastBillData.length > 0) ? (parseInt(lastBillData[0].bill_no) || 0) + 1 : 1;
            
            // Auto-fill category/item
            const { data: lastExp } = await _supabase.from('expenses')
                .select('description')
                .ilike('description', `${name}%`)
                .order('created_at', { ascending: false })
                .limit(1);

            if (lastExp && lastExp.length > 0) {
                const match = lastExp[0].description.match(/\(([^)]+)\)/);
                if (match) document.getElementById('expItem').value = match[1];
            }
        }
    });

    ['expDesc', 'expItem', 'expBillNo', 'expAmount', 'partialPaid'].forEach(id => {
        document.getElementById(id).addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleAddExpense();
            }
        });
    });

    ['openingBal', 'saleCash', 'saleCard', 'saleSwiggy', 'saleZomato'].forEach(id => {
        document.getElementById(id).addEventListener('input', () => {
            updateCalculations();
            triggerAutoSave();
        });
    });

    await fetchVendors();
    await loadData();
};

function triggerAutoSave() {
    clearTimeout(saveTimeout);
    saveTimeout = setTimeout(() => {
        saveSales(true);
    }, 1500);
}

function updateDisplayDate(dateStr) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const date = new Date(dateStr + 'T00:00:00');
    document.getElementById('displayDate').innerText = date.toLocaleDateString('en-US', options);
}

async function fetchVendors() {
    const { data } = await _supabase.from('vendors').select('id, name').eq('user_id', currentUser.id);
    if(data) {
        vendorsList = data;
        document.getElementById('vendorSuggestions').innerHTML = data.map(v => `<option value="${v.name}">`).join('');
    }
}

async function loadData() {
    const date = document.getElementById('date').value;
    
    const { data: balData } = await _supabase.from('daily_balances').select('opening_balance').eq('user_id', currentUser.id).eq('report_date', date).maybeSingle();
    
    if(balData) {
        document.getElementById('openingBal').value = balData.opening_balance;
    } else {
        const prevDate = new Date(new Date(date) - 86400000).toISOString().split('T')[0];
        const { data: prevBal } = await _supabase.from('daily_balances').select('closing_balance').eq('user_id', currentUser.id).eq('report_date', prevDate).maybeSingle();
        document.getElementById('openingBal').value = prevBal ? prevBal.closing_balance : 0;
    }

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

    const { data: expenses } = await _supabase.from('expenses').select('*').eq('user_id', currentUser.id).eq('report_date', date).order('created_at', { ascending: false });
    currentDayExpenses = expenses || [];
    const list = document.getElementById('expenseList');
    list.innerHTML = '';
    if(currentDayExpenses.length > 0) {
        currentDayExpenses.forEach(e => {
            let sourceText = e.payment_source === 'CASH' ? "Paid from Cash" : (e.payment_source === 'OWNER' ? "Paid by Owner" : "Added to Baki");
            let color = e.payment_source === 'CASH' ? "#ef4444" : "#64748b";
            const billDisplay = e.bill_no ? `<span style="color:var(--primary); font-weight:700;">#${e.bill_no}</span>` : '';
            list.innerHTML += `<li class="expense-li"><div class="li-info"><strong>${billDisplay} ${e.description}</strong><small>${sourceText}</small></div><b style="color: ${color}">₹${e.amount.toLocaleString('en-IN')}</b></li>`;
        });
    } else {
        list.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No expenses yet</p>';
    }
    updateCalculations();
}

function updateCalculations() {
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    const cardSale = parseFloat(document.getElementById('saleCard').value) || 0;
    const swiggy = parseFloat(document.getElementById('saleSwiggy').value) || 0;
    const zomato = parseFloat(document.getElementById('saleZomato').value) || 0;

    document.getElementById('totalSale').innerText = `₹${(cashSale + cardSale + swiggy + zomato).toLocaleString('en-IN')}`;

    let cashExpenseTotal = 0;
    currentDayExpenses.forEach(exp => { if(exp.payment_source === 'CASH') cashExpenseTotal += exp.amount; });

    document.getElementById('totalExp').innerText = `₹${cashExpenseTotal.toLocaleString('en-IN')}`;
    const closingBalance = opening + cashSale - cashExpenseTotal;
    document.getElementById('sysCash').innerText = `₹${closingBalance.toLocaleString('en-IN')}`;
}

async function saveSales(silent = false) {
    const date = document.getElementById('date').value;
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    
    let cashExpenseTotal = 0;
    currentDayExpenses.forEach(exp => { if(exp.payment_source === 'CASH') cashExpenseTotal += exp.amount; });
    const closing = opening + cashSale - cashExpenseTotal;

    await _supabase.from('daily_balances').upsert({ user_id: currentUser.id, report_date: date, opening_balance: opening, closing_balance: closing }, { onConflict: 'user_id, report_date' });

    const types = [{t:'CASH', id:'saleCash'}, {t:'CARD', id:'saleCard'}, {t:'SWIGGY', id:'saleSwiggy'}, {t:'ZOMATO', id:'saleZomato'}];
    for(let item of types) {
        const amount = parseFloat(document.getElementById(item.id).value) || 0;
        const { data: exist } = await _supabase.from('sales').select('id').eq('user_id', currentUser.id).eq('report_date', date).eq('sale_type', item.t);
        if(exist.length > 0) await _supabase.from('sales').update({ amount }).eq('id', exist[0].id);
        else await _supabase.from('sales').insert({ user_id: currentUser.id, report_date: date, sale_type: item.t, amount });
    }
    if(!silent) alert("Data Saved Successfully!");
}

async function handleAddExpense() {
    const vendorName = document.getElementById('expDesc').value;
    const itemName = document.getElementById('expItem').value;
    const billNo = document.getElementById('expBillNo').value;
    const totalAmount = parseFloat(document.getElementById('expAmount').value);
    const status = document.getElementById('expStatus').value;
    const partialPaid = parseFloat(document.getElementById('partialPaid').value) || 0;
    const date = document.getElementById('date').value;

    if(!vendorName || !totalAmount) return;

    const fullDesc = itemName ? `${vendorName} (${itemName})` : vendorName;
    const vendor = vendorsList.find(v => v.name.toLowerCase() === vendorName.toLowerCase());

    if(status === 'PAID') {
        await saveExpenseRecord(fullDesc, totalAmount, 'CASH', date, billNo);
        if(vendor) {
            await updateVendorLedger(vendor.id, date, 'BILL', totalAmount, `Bill for ${itemName || vendorName}`, billNo);
            await updateVendorLedger(vendor.id, date, 'PAYMENT', totalAmount, `Cash Paid`, billNo);
        }
    } else if(status === 'OWNER') {
        await saveExpenseRecord(`${fullDesc} (Owner Paid)`, totalAmount, 'OWNER', date, billNo);
        await _supabase.from('owner_ledger').insert({ user_id: currentUser.id, t_date: date, t_type: 'LOAN_TAKEN', amount: totalAmount, description: `Paid for ${fullDesc}` });
        if(vendor) {
            await updateVendorLedger(vendor.id, date, 'BILL', totalAmount, `Bill for ${itemName || vendorName}`, billNo);
            await updateVendorLedger(vendor.id, date, 'PAYMENT', totalAmount, `Paid by Owner`, billNo);
        }
    } else if(status === 'DUE') {
        await saveExpenseRecord(fullDesc, totalAmount, 'DUE', date, billNo);
        if(vendor) await updateVendorLedger(vendor.id, date, 'BILL', totalAmount, `Baki for ${itemName || vendorName}`, billNo);
    } else if(status === 'PARTIAL') {
        await saveExpenseRecord(`${fullDesc} (Partial Paid)`, partialPaid, 'CASH', date, billNo);
        await saveExpenseRecord(`${fullDesc} (Baki)`, totalAmount - partialPaid, 'DUE', date, billNo);
        if(vendor) {
            await updateVendorLedger(vendor.id, date, 'BILL', totalAmount, `Bill for ${itemName || vendorName}`, billNo);
            await updateVendorLedger(vendor.id, date, 'PAYMENT', partialPaid, `Partial Cash Paid`, billNo);
        }
    }
    
    document.getElementById('expDesc').value = ''; 
    document.getElementById('expItem').value = ''; 
    document.getElementById('expBillNo').value = ''; 
    document.getElementById('expAmount').value = '';
    document.getElementById('partialPaid').value = '';
    
    loadData();
    document.getElementById('expDesc').focus();
}

async function saveExpenseRecord(desc, amount, source, date, billNo) {
    await _supabase.from('expenses').insert({ user_id: currentUser.id, report_date: date, description: desc, amount: amount, payment_source: source, bill_no: billNo });
}

async function updateVendorLedger(vId, date, type, amount, note, billNo) {
    await _supabase.from('vendor_ledger').insert({ user_id: currentUser.id, vendor_id: vId, t_date: date, t_type: type, amount: amount, description: note, bill_no: billNo });
}

function getReportData() {
    const date = document.getElementById('date').value;
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    const cardSale = parseFloat(document.getElementById('saleCard').value) || 0;
    const swiggy = parseFloat(document.getElementById('saleSwiggy').value) || 0;
    const zomato = parseFloat(document.getElementById('saleZomato').value) || 0;
    let cashExpenses = 0;
    currentDayExpenses.forEach(exp => { if(exp.payment_source === 'CASH') cashExpenses += exp.amount; });
    return {
        date: date,
        opening: opening.toLocaleString('en-IN'),
        cashSale: cashSale.toLocaleString('en-IN'),
        expenses: cashExpenses.toLocaleString('en-IN'),
        closing: (opening + cashSale - cashExpenses).toLocaleString('en-IN'),
        cardSale: cardSale.toLocaleString('en-IN'),
        onlineOrder: (swiggy + zomato).toLocaleString('en-IN'),
        totalSale: (cashSale + cardSale + swiggy + zomato).toLocaleString('en-IN')
    };
}

function shareDailyReportText() {
    const data = getReportData();
    let msg = `*📊 DAILY SALES REPORT*\n🏢 *${restaurantName}*\n📅 *Date:* ${data.date}\n----------------------------\n💰 *Total Sale:* ₹${data.totalSale}\n----------------------------\n🏠 *Opening Balance:* ₹${data.opening}\n💵 *Cash Sale (+):* ₹${data.cashSale}\n📉 *Cash Expenses (-):* ₹${data.expenses}\n----------------------------\n👛 *CLOSING CASH:* ₹${data.closing}\n----------------------------\n💳 *Card/UPI:* ₹${data.cardSale}\n🛵 *Online:* ₹${data.onlineOrder}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

async function shareDailyReportImage() {
    const data = getReportData();
    document.getElementById('repRestroName').innerText = restaurantName;
    document.getElementById('repDate').innerText = data.date;
    document.getElementById('repOpening').innerText = `₹${data.opening}`;
    document.getElementById('repCashSale').innerText = `₹${data.cashSale}`;
    document.getElementById('repExpenses').innerText = `₹${data.expenses}`;
    document.getElementById('repClosing').innerText = `₹${data.closing}`;
    document.getElementById('repCardSale').innerText = `₹${data.cardSale}`;
    document.getElementById('repOnlineSale').innerText = `₹${data.onlineOrder}`;
    document.getElementById('repTotalSale').innerText = `₹${data.totalSale}`;

    html2canvas(document.getElementById('dailyReportTemplate'), { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Report_${data.date}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }
