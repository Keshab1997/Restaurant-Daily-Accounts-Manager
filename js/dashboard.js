let currentUser = null;
let restaurantName = "RestroManager";
let currentDayExpenses = [];

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
    if(!dateInput.value) dateInput.value = today;
    
    updateDisplayDate(dateInput.value);
    
    dateInput.addEventListener('change', function() {
        updateDisplayDate(this.value);
        loadData();
    });

    await loadData();
};

function updateDisplayDate(dateStr) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const date = new Date(dateStr + 'T00:00:00');
    document.getElementById('displayDate').innerText = date.toLocaleDateString('en-US', options);
}

async function loadData() {
    const date = document.getElementById('date').value;
    
    const { data: currentDayBal } = await _supabase.from('daily_balances')
        .select('opening_balance')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .maybeSingle();
    
    if(currentDayBal) {
        document.getElementById('openingBal').value = currentDayBal.opening_balance;
    } else {
        const { data: lastEntry } = await _supabase.from('daily_balances')
            .select('closing_balance')
            .eq('user_id', currentUser.id)
            .lt('report_date', date)
            .order('report_date', { ascending: false })
            .limit(1)
            .maybeSingle();

        document.getElementById('openingBal').value = lastEntry ? lastEntry.closing_balance : 0;
    }

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
}

function updateCalculations() {
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    const cardSale = parseFloat(document.getElementById('saleCard').value) || 0;
    const swiggy = parseFloat(document.getElementById('saleSwiggy').value) || 0;
    const zomato = parseFloat(document.getElementById('saleZomato').value) || 0;

    // Update Revenue Breakdown
    document.getElementById('detCashSale').innerText = `₹${cashSale.toLocaleString('en-IN')}`;
    document.getElementById('detCardSale').innerText = `₹${cardSale.toLocaleString('en-IN')}`;
    document.getElementById('detSwiggy').innerText = `₹${swiggy.toLocaleString('en-IN')}`;
    document.getElementById('detZomato').innerText = `₹${zomato.toLocaleString('en-IN')}`;

    const totalSaleAll = cashSale + cardSale + swiggy + zomato;
    document.getElementById('totalSale').innerText = `₹${totalSaleAll.toLocaleString('en-IN')}`;

    let cashExp = 0;
    let dueExp = 0;
    let ownerExp = 0;

    currentDayExpenses.forEach(exp => { 
        if(exp.payment_source === 'CASH') cashExp += exp.amount;
        else if(exp.payment_source === 'DUE') dueExp += exp.amount;
        else if(exp.payment_source === 'OWNER') ownerExp += exp.amount;
    });

    // Update Expense Breakdown
    document.getElementById('detCashExp').innerText = `₹${cashExp.toLocaleString('en-IN')}`;
    document.getElementById('detDueExp').innerText = `₹${dueExp.toLocaleString('en-IN')}`;
    document.getElementById('detOwnerExp').innerText = `₹${ownerExp.toLocaleString('en-IN')}`;

    const totalAllExp = cashExp + dueExp + ownerExp;
    document.getElementById('totalExpAll').innerText = `₹${totalAllExp.toLocaleString('en-IN')}`;
    
    // আজকের নেট ব্যালেন্স (Today's Profit/Loss)
    const netBalanceToday = cashSale - totalAllExp;
    const netBalEl = document.getElementById('netBalanceToday');
    netBalEl.innerText = `₹${netBalanceToday.toLocaleString('en-IN')}`;
    
    // ফাইনাল ক্লোজিং ব্যালেন্স = Opening + Today's Net
    const finalClosingBalance = opening + netBalanceToday;
    document.getElementById('closingCashText').innerText = `Final Closing Balance: ₹${finalClosingBalance.toLocaleString('en-IN')}`;
    
    if(netBalanceToday < 0) netBalEl.style.color = "#ef4444"; 
    else netBalEl.style.color = "#059669";
}

async function saveSales() {
    const date = document.getElementById('date').value;
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    const cardSale = parseFloat(document.getElementById('saleCard').value) || 0;
    const swiggy = parseFloat(document.getElementById('saleSwiggy').value) || 0;
    const zomato = parseFloat(document.getElementById('saleZomato').value) || 0;
    
    // মোট খরচ ক্যালকুলেট করা
    let totalAllExp = 0;
    currentDayExpenses.forEach(exp => { totalAllExp += exp.amount; });
    
    // আজকের নেট লাভ/ক্ষতি
    const netBalanceToday = cashSale - totalAllExp;
    
    // ফাইনাল ক্লোজিং ব্যালেন্স = Opening + Today's Net
    const finalClosingBalance = opening + netBalanceToday;

    // ১. ব্যালেন্স সেভ
    const { error: balError } = await _supabase.from('daily_balances').upsert({ 
        user_id: currentUser.id, 
        report_date: date, 
        opening_balance: opening, 
        closing_balance: finalClosingBalance 
    }, { onConflict: 'user_id, report_date' });

    if(balError) {
        console.error("Balance Save Error:", balError);
        return alert("Error saving balance: " + balError.message);
    }

    // ২. সেলস সেভ
    const types = [
        {t:'CASH', val: cashSale}, 
        {t:'CARD', val: cardSale}, 
        {t:'SWIGGY', val: swiggy}, 
        {t:'ZOMATO', val: zomato}
    ];

    for(let item of types) {
        const { error: saleError } = await _supabase.from('sales').upsert({ 
            user_id: currentUser.id, 
            report_date: date, 
            sale_type: item.t, 
            amount: item.val 
        }, { onConflict: 'user_id, report_date, sale_type' });

        if(saleError) {
            console.error(`Sale Save Error (${item.t}):`, saleError);
            return alert(`Error saving ${item.t} sale: ` + saleError.message);
        }
    }
    
    alert("Data Saved! Tomorrow's Opening will be: ₹" + finalClosingBalance.toLocaleString('en-IN'));
    updateCalculations();
}

function getReportData() {
    const date = document.getElementById('date').value;
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    let totalAllExp = 0;
    currentDayExpenses.forEach(exp => { totalAllExp += exp.amount; });
    
    const netToday = cashSale - totalAllExp;

    return {
        date: date,
        opening: opening.toLocaleString('en-IN'),
        cashSale: cashSale.toLocaleString('en-IN'),
        totalExp: totalAllExp.toLocaleString('en-IN'),
        netToday: netToday.toLocaleString('en-IN'),
        finalClosing: (opening + netToday).toLocaleString('en-IN')
    };
}

function shareDailyReportText() {
    const data = getReportData();
    let msg = `*📊 DAILY BUSINESS SUMMARY*\n🏢 *${restaurantName}*\n📅 *Date:* ${data.date}\n----------------------------\n🏠 *Opening Balance:* ₹${data.opening}\n💵 *Today's Net:* ₹${data.netToday}\n----------------------------\n✅ *FINAL CLOSING:* ₹${data.finalClosing}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

async function shareDailyReportImage() {
    const data = getReportData();
    document.getElementById('repRestroName').innerText = restaurantName;
    document.getElementById('repDate').innerText = data.date;
    document.getElementById('repOpening').innerText = `₹${data.opening}`;
    document.getElementById('repTotalSale').innerText = `₹${data.cashSale}`;
    document.getElementById('repExpenses').innerText = `₹${data.totalExp}`;
    document.getElementById('repClosing').innerText = `₹${data.finalClosing}`;

    html2canvas(document.getElementById('dailyReportTemplate'), { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Report_${data.date}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }