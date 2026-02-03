let currentUser = null;
let vendorsList = [];
let currentDayExpenses = [];
let restaurantName = "RestroManager";

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    // ১. রেস্টুরেন্টের নাম লোড করা
    const { data: profile } = await _supabase.from('profiles').select('restaurant_name').eq('id', currentUser.id).maybeSingle();
    if(profile) {
        restaurantName = profile.restaurant_name;
        document.getElementById('sideNavName').innerText = restaurantName;
        document.getElementById('mainRestroName').innerText = restaurantName;
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

    await fetchVendors();
    await loadData();
    
    // অটোমেটিক বিল নম্বর এবং ক্যাটাগরি খোঁজা
    document.getElementById('expDesc').addEventListener('input', async function() {
        const name = this.value.trim();
        if (name.length < 2) return;
        const vendor = vendorsList.find(v => v.name.toLowerCase() === name.toLowerCase());
        if (vendor) {
            const { data: lastBillData } = await _supabase.from('vendor_ledger')
                .select('bill_no')
                .eq('vendor_id', vendor.id)
                .eq('t_type', 'BILL')
                .order('bill_no', { ascending: false })
                .limit(1);
            document.getElementById('expBillNo').value = lastBillData && lastBillData.length > 0 ? (parseInt(lastBillData[0].bill_no) || 0) + 1 : 1;
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
        document.getElementById('vendorSuggestions').innerHTML = data.map(v => `<option value="${v.name}">`).join('');
    }
}

async function loadData() {
    const date = document.getElementById('date').value;
    
    // ১. ওপেনিং ব্যালেন্স লোড করা
    const { data: balData } = await _supabase.from('daily_balances').select('opening_balance').eq('user_id', currentUser.id).eq('report_date', date).maybeSingle();
    
    if(balData) {
        document.getElementById('openingBal').value = balData.opening_balance;
    } else {
        // যদি আজকের ওপেনিং না থাকে, তবে গতকালের ক্লোজিং খোঁজা
        const prevDate = new Date(new Date(date) - 86400000).toISOString().split('T')[0];
        const { data: prevBal } = await _supabase.from('daily_balances').select('closing_balance').eq('user_id', currentUser.id).eq('report_date', prevDate).maybeSingle();
        document.getElementById('openingBal').value = prevBal ? prevBal.closing_balance : 0;
    }

    // ২. সেলস লোড করা
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

    // ৩. খরচ লোড করা
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
    
    // Closing = Opening + Cash Sale - Cash Expense
    const closingBalance = opening + cashSale - cashExpenseTotal;
    document.getElementById('sysCash').innerText = `₹${closingBalance.toLocaleString('en-IN')}`;
}

async function saveSales() {
    const date = document.getElementById('date').value;
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    
    let cashExpenseTotal = 0;
    currentDayExpenses.forEach(exp => { if(exp.payment_source === 'CASH') cashExpenseTotal += exp.amount; });
    const closing = opening + cashSale - cashExpenseTotal;

    // ১. ব্যালেন্স সেভ করা
    await _supabase.from('daily_balances').upsert({ user_id: currentUser.id, report_date: date, opening_balance: opening, closing_balance: closing }, { onConflict: 'user_id, report_date' });

    // ২. সেলস সেভ করা
    const types = [{t:'CASH', id:'saleCash'}, {t:'CARD', id:'saleCard'}, {t:'SWIGGY', id:'saleSwiggy'}, {t:'ZOMATO', id:'saleZomato'}];
    for(let item of types) {
        const amount = parseFloat(document.getElementById(item.id).value) || 0;
        const { data: exist } = await _supabase.from('sales').select('id').eq('user_id', currentUser.id).eq('report_date', date).eq('sale_type', item.t);
        if(exist.length > 0) await _supabase.from('sales').update({ amount }).eq('id', exist[0].id);
        else await _supabase.from('sales').insert({ user_id: currentUser.id, report_date: date, sale_type: item.t, amount });
    }
    alert("Data Saved Successfully!");
    loadData();
}

async function handleAddExpense() {
    const vendorName = document.getElementById('expDesc').value;
    const itemName = document.getElementById('expItem').value;
    const billNo = document.getElementById('expBillNo').value;
    const totalAmount = parseFloat(document.getElementById('expAmount').value);
    const status = document.getElementById('expStatus').value;
    const partialPaid = parseFloat(document.getElementById('partialPaid').value) || 0;
    const date = document.getElementById('date').value;

    if(!vendorName || !totalAmount) return alert("Enter vendor and amount");
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
    document.getElementById('expDesc').value = ''; document.getElementById('expItem').value = ''; document.getElementById('expBillNo').value = ''; document.getElementById('expAmount').value = '';
    loadData();
}

async function saveExpenseRecord(desc, amount, source, date, billNo) {
    await _supabase.from('expenses').insert({ user_id: currentUser.id, report_date: date, description: desc, amount: amount, payment_source: source, bill_no: billNo });
}

async function updateVendorLedger(vId, date, type, amount, note, billNo) {
    await _supabase.from('vendor_ledger').insert({ user_id: currentUser.id, vendor_id: vId, t_date: date, t_type: type, amount: amount, description: note, bill_no: billNo });
}

function shareDailyReportText() {
    const data = getReportData();
    let msg = `*📊 DAILY SALES REPORT*\n🏢 *${restaurantName}*\n📅 *Date:* ${data.date}\n----------------------------\n💰 *Total Sale:* ₹${data.totalSale}\n----------------------------\n🏠 *Opening Balance:* ₹${data.opening}\n💵 *Cash Sale (+):* ₹${data.cashSale}\n📉 *Cash Expenses (-):* ₹${data.expenses}\n----------------------------\n👛 *CLOSING CASH:* ₹${data.closing}\n----------------------------\n💳 *Card/UPI:* ₹${data.cardSale}\n🛵 *Online:* ₹${data.onlineOrder}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

async function shareDailyReportImage() {
    const data = getReportData();
    
    // এরর হ্যান্ডলিং: আইডিগুলো আছে কিনা চেক করা
    const ids = ['repRestroName', 'repDate', 'repOpening', 'repCashSale', 'repExpenses', 'repClosing', 'repCardSale', 'repOnlineSale', 'repTotalSale'];
    for(let id of ids) {
        if(!document.getElementById(id)) {
            console.error(`Missing ID in HTML: ${id}`);
            return alert(`Error: Element with ID "${id}" not found in HTML template.`);
        }
    }

    document.getElementById('repRestroName').innerText = restaurantName;
    document.getElementById('repDate').innerText = data.date;
    document.getElementById('repOpening').innerText = `₹${data.opening}`;
    document.getElementById('repCashSale').innerText = `₹${data.cashSale}`;
    document.getElementById('repExpenses').innerText = `₹${data.expenses}`;
    document.getElementById('repClosing').innerText = `₹${data.closing}`;
    document.getElementById('repCardSale').innerText = `₹${data.cardSale}`;
    document.getElementById('repOnlineSale').innerText = `₹${data.onlineOrder}`;
    document.getElementById('repTotalSale').innerText = `₹${data.totalSale}`;

    const element = document.getElementById('dailyReportTemplate');
    html2canvas(element, { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Report_${data.date}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        if (navigator.share) {
            canvas.toBlob(blob => {
                const file = new File([blob], "report.png", { type: "image/png" });
                navigator.share({ files: [file], title: 'Daily Report' }).catch(console.error);
            });
        }
    });
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

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }