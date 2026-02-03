let currentUser = null;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    document.querySelectorAll('.note-input').forEach(input => {
        input.addEventListener('input', calculatePhysical);
    });

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    document.getElementById('tallyDate').innerText = `Date: ${today}`;

    await loadSystemBalance(today);
};

async function calculatePhysical() {
    let total = 0;
    document.querySelectorAll('.note-input').forEach(input => {
        const val = parseInt(input.getAttribute('data-val'));
        const count = parseInt(input.value) || 0;
        const sub = val * count;
        
        input.nextElementSibling.innerText = sub;
        total += sub;
    });

    document.getElementById('phyTotal').innerText = `₹${total}`;
    
    const sysStr = document.getElementById('sysTotal').innerText.replace('₹', '');
    const sys = parseFloat(sysStr) || 0;
    const diff = total - sys;

    const diffEl = document.getElementById('diffTotal');
    diffEl.innerText = `₹${diff}`;
    diffEl.style.color = diff >= 0 ? 'green' : 'red';
}

async function loadSystemBalance(date) {
    const { data: sales } = await _supabase.from('sales')
        .select('amount')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .eq('sale_type', 'CASH');
    
    const cashSale = sales.length > 0 ? sales[0].amount : 0;

    const { data: expenses } = await _supabase.from('expenses')
        .select('amount')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .eq('payment_source', 'CASH');

    const cashExp = expenses.reduce((sum, e) => sum + e.amount, 0);
    const sysBalance = cashSale - cashExp;
    
    document.getElementById('sysTotal').innerText = `₹${sysBalance}`;
}

async function saveAndShareDayEnd() {
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    
    const notes = {};
    let totalPhy = 0;
    document.querySelectorAll('.note-input').forEach(input => {
        const val = input.getAttribute('data-val');
        const count = parseInt(input.value) || 0;
        notes[`n${val}`] = count;
        totalPhy += (parseInt(val) * count);
    });

    const sysTotal = parseFloat(document.getElementById('sysTotal').innerText.replace('₹', ''));
    const diff = totalPhy - sysTotal;

    const { error } = await _supabase.from('cash_tally').upsert({
        user_id: currentUser.id,
        report_date: date,
        ...notes,
        total_physical: totalPhy,
        system_balance: sysTotal,
        difference: diff
    }, { onConflict: 'user_id, report_date' });

    if(error) {
        alert("Error saving tally: " + error.message);
        return;
    }

    await shareDayEndReport(date, totalPhy, sysTotal, diff);
}

async function shareDayEndReport(date, phy, sys, diff) {
    const { data: sales } = await _supabase.from('sales').select('*').eq('user_id', currentUser.id).eq('report_date', date);
    let cashSale = 0, cardSale = 0, swiggy = 0, zomato = 0;
    
    if(sales) {
        sales.forEach(s => {
            if(s.sale_type === 'CASH') cashSale = s.amount;
            if(s.sale_type === 'CARD') cardSale = s.amount;
            if(s.sale_type === 'SWIGGY') swiggy = s.amount;
            if(s.sale_type === 'ZOMATO') zomato = s.amount;
        });
    }

    const totalSale = cashSale + cardSale + swiggy + zomato;

    const { data: expenses } = await _supabase.from('expenses').select('amount').eq('user_id', currentUser.id).eq('report_date', date);
    const totalExp = expenses ? expenses.reduce((sum, e) => sum + e.amount, 0) : 0;

    let msg = `*📅 DAY END REPORT (${date})*\n`;
    msg += `----------------------------\n`;
    msg += `*💰 Total Sale:* ₹${totalSale}\n`;
    msg += `   - Cash: ₹${cashSale}\n`;
    msg += `   - Online: ₹${cardSale}\n`;
    msg += `   - Swiggy: ₹${swiggy}\n`;
    msg += `   - Zomato: ₹${zomato}\n`;
    msg += `----------------------------\n`;
    msg += `*💸 Total Expense:* ₹${totalExp}\n`;
    msg += `----------------------------\n`;
    msg += `*🧮 CASH TALLY*\n`;
    msg += `   - System Cash: ₹${sys}\n`;
    msg += `   - Physical Cash: ₹${phy}\n`;
    
    if(diff !== 0) {
        const icon = diff > 0 ? '🟢 Extra' : '🔴 Short';
        msg += `   - ${icon}: ₹${Math.abs(diff)}\n`;
    } else {
        msg += `   - ✅ Cash Matched!\n`;
    }

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}
