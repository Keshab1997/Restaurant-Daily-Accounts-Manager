let currentUser = null;
let restaurantName = "RestroManager";
let signatureName = "Authorized Person";
let currentDayExpenses = [];
let autoSaveTimeout = null;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    const { data: profile } = await _supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    if(profile) {
        restaurantName = profile.restaurant_name || "RestroManager";
        signatureName = profile.authorized_signature || restaurantName;
        document.getElementById('sideNavName').innerText = restaurantName;
        document.getElementById('mainRestroName').innerText = restaurantName;
    }

    const dateInput = document.getElementById('date');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if(!dateInput.value) dateInput.value = today;
    
    updateDisplayDate(dateInput.value);
    
    dateInput.addEventListener('change', function() {
        updateDisplayDate(this.value);
        loadData();
    });

    const inputs = ['openingBal', 'saleCash', 'saleCard', 'saleSwiggy', 'saleZomato'];
    inputs.forEach((id, index) => {
        const el = document.getElementById(id);
        el.addEventListener('input', function() {
            formatInput(this);
            updateCalculations();
            triggerAutoSave();
        });
        el.addEventListener('keydown', function(e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const nextId = inputs[index + 1];
                if (nextId) {
                    const nextEl = document.getElementById(nextId);
                    nextEl.focus();
                    nextEl.select();
                } else {
                    this.blur();
                }
            }
        });
    });

    await loadData();
};

function formatInput(input) {
    let val = input.value;
    if (val.length > 1 && val.startsWith('0')) {
        input.value = val.replace(/^0+/, '');
    }
    if (input.value === '') input.value = '0';
}

function updateDisplayDate(dateStr) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const date = new Date(dateStr + 'T00:00:00');
    document.getElementById('displayDate').innerText = date.toLocaleDateString('en-US', options);
}

async function loadData() {
    const date = document.getElementById('date').value;
    
    // Always fetch previous day's closing balance
    const { data: lastEntry } = await _supabase.from('daily_balances')
        .select('closing_balance')
        .eq('user_id', currentUser.id)
        .lt('report_date', date)
        .order('report_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    document.getElementById('openingBal').value = lastEntry ? lastEntry.closing_balance : 0;

    const { data: sales } = await _supabase.from('sales').select('*').eq('user_id', currentUser.id).eq('report_date', date);
    ['saleCash', 'saleCard', 'saleSwiggy', 'saleZomato'].forEach(id => document.getElementById(id).value = 0);
    
    if(sales) {
        sales.forEach(s => {
            if(s.sale_type === 'CASH') document.getElementById('saleCash').value = s.amount;
            if(s.sale_type === 'CARD') document.getElementById('saleCard').value = s.amount;
            if(s.sale_type === 'SWIGGY') document.getElementById('saleSwiggy').value = s.amount;
            if(s.sale_type === 'ZOMATO') document.getElementById('saleZomato').value = s.amount;
        });
    }

    const { data: expenses } = await _supabase.from('expenses').select('*').eq('user_id', currentUser.id).eq('report_date', date);
    currentDayExpenses = expenses || [];
    
    updateCalculations();
    await saveSales(true);
}

function updateCalculations() {
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    const cardSale = parseFloat(document.getElementById('saleCard').value) || 0;
    const swiggy = parseFloat(document.getElementById('saleSwiggy').value) || 0;
    const zomato = parseFloat(document.getElementById('saleZomato').value) || 0;

    document.getElementById('detCashSale').innerText = `₹${cashSale.toLocaleString('en-IN')}`;
    document.getElementById('detCardSale').innerText = `₹${cardSale.toLocaleString('en-IN')}`;
    document.getElementById('detSwiggy').innerText = `₹${swiggy.toLocaleString('en-IN')}`;
    document.getElementById('detZomato').innerText = `₹${zomato.toLocaleString('en-IN')}`;

    const totalSaleAll = cashSale + cardSale + swiggy + zomato;
    document.getElementById('totalSale').innerText = `₹${totalSaleAll.toLocaleString('en-IN')}`;

    let cashExp = 0, dueExp = 0, ownerExp = 0, otherExp = 0;
    currentDayExpenses.forEach(exp => { 
        if(exp.payment_source === 'CASH') cashExp += exp.amount;
        else if(exp.payment_source === 'DUE') dueExp += exp.amount;
        else if(exp.payment_source === 'OWNER') ownerExp += exp.amount;
        else otherExp += exp.amount;
    });

    document.getElementById('detCashExp').innerText = `₹${cashExp.toLocaleString('en-IN')}`;
    document.getElementById('detDueExp').innerText = `₹${dueExp.toLocaleString('en-IN')}`;
    document.getElementById('detOwnerExp').innerText = `₹${ownerExp.toLocaleString('en-IN')}`;
    document.getElementById('detOtherExp').innerText = `₹${otherExp.toLocaleString('en-IN')}`;

    const totalAllExp = cashExp + dueExp + ownerExp + otherExp;
    document.getElementById('totalExpAll').innerText = `₹${totalAllExp.toLocaleString('en-IN')}`;
    
    // Net Balance = Cash Sale - TOTAL EXPENSES
    const netCashFlow = cashSale - totalAllExp;
    const netBalEl = document.getElementById('netBalanceToday');
    netBalEl.innerText = `₹${netCashFlow.toLocaleString('en-IN')}`;
    
    // Final Closing Balance = Opening Balance + Net Cash Flow
    const finalClosingBalance = opening + netCashFlow;
    document.getElementById('closingCashText').innerText = `Final Closing Balance: ₹${finalClosingBalance.toLocaleString('en-IN')}`;
    
    if(netCashFlow < 0) netBalEl.style.color = "#ef4444"; 
    else netBalEl.style.color = "#059669";
}

function triggerAutoSave() {
    const indicator = document.getElementById('autoSaveIndicator');
    indicator.style.display = 'none';

    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(async () => {
        await saveSales();
        indicator.style.display = 'flex';
        setTimeout(() => indicator.style.display = 'none', 2000);
    }, 1000);
}

async function manualSync() {
    const btn = document.getElementById('syncBtn');
    const icon = document.getElementById('syncIcon');
    const text = btn.querySelector('span');

    btn.disabled = true;
    btn.classList.add('syncing');
    icon.classList.add('spin');
    text.innerText = 'Syncing...';

    try {
        await saveSales();
        btn.classList.remove('syncing');
        btn.classList.add('success');
        icon.classList.remove('spin');
        icon.className = 'ri-checkbox-circle-line';
        text.innerText = 'Synced!';

        setTimeout(() => {
            btn.disabled = false;
            btn.classList.remove('success');
            icon.className = 'ri-refresh-line';
            text.innerText = 'Sync';
        }, 3000);
    } catch (err) {
        showToast('Sync failed: ' + err.message, "error");
        btn.disabled = false;
        btn.classList.remove('syncing');
        icon.classList.remove('spin');
        text.innerText = 'Sync';
    }
}

async function saveSales(silent = false) {
    const date = document.getElementById('date').value;
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    const cardSale = parseFloat(document.getElementById('saleCard').value) || 0;
    const swiggy = parseFloat(document.getElementById('saleSwiggy').value) || 0;
    const zomato = parseFloat(document.getElementById('saleZomato').value) || 0;
    
    let totalExpenses = 0;
    currentDayExpenses.forEach(exp => totalExpenses += exp.amount);

    const netCashFlow = cashSale - totalExpenses;
    const finalClosingBalance = opening + netCashFlow;

    await _supabase.from('daily_balances').upsert({ 
        user_id: currentUser.id, 
        report_date: date, 
        opening_balance: opening, 
        closing_balance: finalClosingBalance 
    }, { onConflict: 'user_id, report_date' });

    const types = [
        {t:'CASH', val: cashSale}, 
        {t:'CARD', val: cardSale}, 
        {t:'SWIGGY', val: swiggy}, 
        {t:'ZOMATO', val: zomato}
    ];

    for(let item of types) {
        if(item.val > 0) {
            await _supabase.from('sales').upsert({ 
                user_id: currentUser.id, 
                report_date: date, 
                sale_type: item.t, 
                amount: item.val 
            }, { onConflict: 'user_id, report_date, sale_type' });
        } else {
            await _supabase.from('sales')
                .delete()
                .eq('user_id', currentUser.id)
                .eq('report_date', date)
                .eq('sale_type', item.t);
        }
    }
}

function shareDailyReportText() {
    const date = document.getElementById('date').value;
    const opening = document.getElementById('openingBal').value;
    const cashSale = document.getElementById('detCashSale').innerText;
    const cardSale = document.getElementById('detCardSale').innerText;
    const swiggy = document.getElementById('detSwiggy').innerText;
    const zomato = document.getElementById('detZomato').innerText;
    const totalSale = document.getElementById('totalSale').innerText;
    const cashExp = document.getElementById('detCashExp').innerText;
    const dueExp = document.getElementById('detDueExp').innerText;
    const ownerExp = document.getElementById('detOwnerExp').innerText;
    const totalExp = document.getElementById('totalExpAll').innerText;
    const netToday = document.getElementById('netBalanceToday').innerText;
    const finalClosing = document.getElementById('closingCashText').innerText.split(': ')[1];

    let msg = `DAILY BUSINESS REPORT\n`;
    msg += `Restaurant: ${restaurantName}\n`;
    msg += `Date: ${date}\n`;
    msg += `----------------------------\n`;
    msg += `Opening Balance: ₹${opening}\n`;
    msg += `----------------------------\n`;
    msg += `REVENUE BREAKDOWN\n`;
    msg += `Cash Sale: ${cashSale}\n`;
    msg += `Card/UPI Sale: ${cardSale}\n`;
    msg += `Swiggy Orders: ${swiggy}\n`;
    msg += `Zomato Orders: ${zomato}\n`;
    msg += `TOTAL SALE (ALL): ${totalSale}\n`;
    msg += `----------------------------\n`;
    msg += `EXPENSE BREAKDOWN\n`;
    msg += `Cash Expenses: ${cashExp}\n`;
    msg += `Due Expenses (Baki): ${dueExp}\n`;
    msg += `Paid by Owner: ${ownerExp}\n`;
    msg += `TOTAL EXPENSE (ALL): ${totalExp}\n`;
    msg += `----------------------------\n`;
    msg += `Today's Net: ${netToday}\n`;
    msg += `FINAL CLOSING BALANCE: ${finalClosing}\n`;
    msg += `----------------------------\n`;
    msg += `Authorized Signature: ${signatureName}\n`;
    msg += `App developed by Keshab Sarkar`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

async function shareDailyReportImage() {
    const template = document.getElementById('dailyReportTemplate');
    
    document.getElementById('repRestroName').innerText = restaurantName;
    document.getElementById('repDate').innerText = document.getElementById('date').value;
    document.getElementById('repOpening').innerText = `₹${document.getElementById('openingBal').value}`;
    
    document.getElementById('repCashSale').innerText = document.getElementById('detCashSale').innerText;
    document.getElementById('repCardSale').innerText = document.getElementById('detCardSale').innerText;
    document.getElementById('repSwiggy').innerText = document.getElementById('detSwiggy').innerText;
    document.getElementById('repZomato').innerText = document.getElementById('detZomato').innerText;
    document.getElementById('repTotalSale').innerText = document.getElementById('totalSale').innerText;

    document.getElementById('repCashExp').innerText = document.getElementById('detCashExp').innerText;
    document.getElementById('repDueExp').innerText = document.getElementById('detDueExp').innerText;
    document.getElementById('repOwnerExp').innerText = document.getElementById('detOwnerExp').innerText;
    document.getElementById('repTotalExp').innerText = document.getElementById('totalExpAll').innerText;

    document.getElementById('repClosing').innerText = document.getElementById('closingCashText').innerText.split(': ')[1];
    document.getElementById('repSignature').innerText = signatureName;

    html2canvas(template, { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Report_${document.getElementById('date').value}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }
