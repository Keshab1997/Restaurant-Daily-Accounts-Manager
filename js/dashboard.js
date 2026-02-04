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
    dateInput.value = today;
    updateDisplayDate(today);
    
    dateInput.addEventListener('change', function() {
        updateDisplayDate(this.value);
        loadData();
    });

    await loadData();
}

function updateDisplayDate(dateStr) {
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    const date = new Date(dateStr + 'T00:00:00');
    document.getElementById('displayDate').innerText = date.toLocaleDateString('en-US', options);
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

    document.getElementById('totalSale').innerText = `₹${(cashSale + cardSale + swiggy + zomato).toLocaleString('en-IN')}`;

    let cashExpenseTotal = 0;
    let allExpenseTotal = 0;

    currentDayExpenses.forEach(exp => { 
        allExpenseTotal += exp.amount;
        if(exp.payment_source === 'CASH') cashExpenseTotal += exp.amount;
    });

    document.getElementById('totalExpAll').innerText = `₹${allExpenseTotal.toLocaleString('en-IN')}`;
    document.getElementById('totalExp').innerText = `₹${cashExpenseTotal.toLocaleString('en-IN')}`;
    
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

    await _supabase.from('daily_balances').upsert({ user_id: currentUser.id, report_date: date, opening_balance: opening, closing_balance: closing }, { onConflict: 'user_id, report_date' });

    const types = [{t:'CASH', id:'saleCash'}, {t:'CARD', id:'saleCard'}, {t:'SWIGGY', id:'saleSwiggy'}, {t:'ZOMATO', id:'saleZomato'}];
    for(let item of types) {
        const amount = parseFloat(document.getElementById(item.id).value) || 0;
        const { data: exist } = await _supabase.from('sales').select('id').eq('user_id', currentUser.id).eq('report_date', date).eq('sale_type', item.t);
        if(exist.length > 0) await _supabase.from('sales').update({ amount }).eq('id', exist[0].id);
        else await _supabase.from('sales').insert({ user_id: currentUser.id, report_date: date, sale_type: item.t, amount });
    }
    alert("Sales Data Saved!");
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
