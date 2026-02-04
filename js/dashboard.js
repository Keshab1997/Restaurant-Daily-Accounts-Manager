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

    const totalAllExp = cashExp + dueExp + ownerExp;

    document.getElementById('totalExpAll').innerText = `₹${totalAllExp.toLocaleString('en-IN')}`;
    document.getElementById('totalExp').innerText = `₹${cashExp.toLocaleString('en-IN')}`;
    document.getElementById('totalDue').innerText = `₹${dueExp.toLocaleString('en-IN')}`;
    document.getElementById('totalOwner').innerText = `₹${ownerExp.toLocaleString('en-IN')}`;
    
    const netBalance = (opening + totalSaleAll) - totalAllExp;
    const sysCashEl = document.getElementById('sysCash');
    sysCashEl.innerText = `₹${netBalance.toLocaleString('en-IN')}`;
    
    if(netBalance < 0) sysCashEl.style.color = "#fee2e2"; 
    else sysCashEl.style.color = "white";
}

async function saveSales() {
    const date = document.getElementById('date').value;
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    const cardSale = parseFloat(document.getElementById('saleCard').value) || 0;
    const swiggy = parseFloat(document.getElementById('saleSwiggy').value) || 0;
    const zomato = parseFloat(document.getElementById('saleZomato').value) || 0;
    
    const totalSaleAll = cashSale + cardSale + swiggy + zomato;

    let totalAllExp = 0;
    currentDayExpenses.forEach(exp => { totalAllExp += exp.amount; });
    
    const netClosingBalance = (opening + totalSaleAll) - totalAllExp;

    await _supabase.from('daily_balances').upsert({ 
        user_id: currentUser.id, 
        report_date: date, 
        opening_balance: opening, 
        closing_balance: netClosingBalance 
    }, { onConflict: 'user_id, report_date' });

    const types = [{t:'CASH', id:'saleCash'}, {t:'CARD', id:'saleCard'}, {t:'SWIGGY', id:'saleSwiggy'}, {t:'ZOMATO', id:'saleZomato'}];
    for(let item of types) {
        const amount = parseFloat(document.getElementById(item.id).value) || 0;
        const { data: exist } = await _supabase.from('sales').select('id').eq('user_id', currentUser.id).eq('report_date', date).eq('sale_type', item.t);
        if(exist.length > 0) await _supabase.from('sales').update({ amount }).eq('id', exist[0].id);
        else await _supabase.from('sales').insert({ user_id: currentUser.id, report_date: date, sale_type: item.t, amount });
    }
    
    alert("Data Saved! Tomorrow's Opening: ₹" + netClosingBalance.toLocaleString('en-IN'));
    loadData();
}

function getReportData() {
    const date = document.getElementById('date').value;
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    const cardSale = parseFloat(document.getElementById('saleCard').value) || 0;
    const swiggy = parseFloat(document.getElementById('saleSwiggy').value) || 0;
    const zomato = parseFloat(document.getElementById('saleZomato').value) || 0;
    const totalSaleAll = cashSale + cardSale + swiggy + zomato;
    let totalAllExp = 0;
    currentDayExpenses.forEach(exp => { totalAllExp += exp.amount; });
    return {
        date: date,
        opening: opening.toLocaleString('en-IN'),
        totalSale: totalSaleAll.toLocaleString('en-IN'),
        totalExp: totalAllExp.toLocaleString('en-IN'),
        closing: ((opening + totalSaleAll) - totalAllExp).toLocaleString('en-IN')
    };
}

function shareDailyReportText() {
    const data = getReportData();
    let msg = `*📊 DAILY BUSINESS SUMMARY*\n🏢 *${restaurantName}*\n📅 *Date:* ${data.date}\n----------------------------\n🏠 *Opening Balance:* ₹${data.opening}\n💰 *Total Sale (All):* ₹${data.totalSale}\n📉 *Total Expense (All):* ₹${data.totalExp}\n----------------------------\n✅ *NET BALANCE:* ₹${data.closing}`;
    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

async function shareDailyReportImage() {
    const data = getReportData();
    document.getElementById('repRestroName').innerText = restaurantName;
    document.getElementById('repDate').innerText = data.date;
    document.getElementById('repOpening').innerText = `₹${data.opening}`;
    document.getElementById('repCashSale').innerText = `₹${data.totalSale}`;
    document.getElementById('repExpenses').innerText = `₹${data.totalExp}`;
    document.getElementById('repClosing').innerText = `₹${data.closing}`;
    document.getElementById('repCardSale').innerText = `₹0`;
    document.getElementById('repOnlineSale').innerText = `₹0`;
    document.getElementById('repTotalSale').innerText = `₹${data.totalSale}`;

    html2canvas(document.getElementById('dailyReportTemplate'), { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Report_${data.date}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
    });
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }
