let currentUser = null;
let currentSystemBalance = 0;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    document.getElementById('tallyDateDisplay').innerText = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    document.querySelectorAll('.note-input').forEach(input => {
        input.addEventListener('input', calculateLiveTally);
    });

    await loadSystemBalance(today);
    await loadTallyHistory();
};

async function loadSystemBalance(date) {
    // ১. ড্যাশবোর্ড থেকে আজকের ওপেনিং ব্যালেন্স (Hater Cash) নিয়ে আসা
    const { data: balData } = await _supabase.from('daily_balances')
        .select('opening_balance')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .maybeSingle();
    
    const openingBal = balData ? balData.opening_balance : 0;
    document.getElementById('openingTotal').innerText = `₹${openingBal.toLocaleString('en-IN')}`;

    // ২. আজকের ক্যাশ সেল নিয়ে আসা
    const { data: sales } = await _supabase.from('sales')
        .select('amount')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .eq('sale_type', 'CASH');
    
    // ৩. আজকের ক্যাশ খরচ নিয়ে আসা
    const { data: expenses } = await _supabase.from('expenses')
        .select('amount')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .eq('payment_source', 'CASH');

    const cashSale = sales ? sales.reduce((sum, s) => sum + s.amount, 0) : 0;
    const cashExp = expenses ? expenses.reduce((sum, e) => sum + e.amount, 0) : 0;

    document.getElementById('todayCashSale').innerText = `₹${cashSale.toLocaleString('en-IN')}`;
    document.getElementById('todayCashExp').innerText = `₹${cashExp.toLocaleString('en-IN')}`;

    // ৪. সিস্টেম ক্যাশ হিসাব: Opening + Sales - Expenses
    currentSystemBalance = openingBal + cashSale - cashExp;
    
    document.getElementById('sysTotal').innerText = `₹${currentSystemBalance.toLocaleString('en-IN')}`;
    calculateLiveTally();
}

function calculateLiveTally() {
    let totalPhy = 0;
    document.querySelectorAll('.note-input').forEach(input => {
        const val = parseInt(input.getAttribute('data-val'));
        const count = parseInt(input.value) || 0;
        const sub = val * count;
        input.nextElementSibling.innerText = sub.toLocaleString('en-IN');
        totalPhy += sub;
    });

    document.getElementById('phyTotal').innerText = `₹${totalPhy.toLocaleString('en-IN')}`;
    
    const diff = totalPhy - currentSystemBalance;
    const diffEl = document.getElementById('diffTotal');
    diffEl.innerText = `₹${diff.toLocaleString('en-IN')}`;
    
    if(diff === 0) diffEl.style.color = "var(--text-dark)";
    else if(diff > 0) diffEl.style.color = "var(--success)";
    else diffEl.style.color = "var(--danger)";
}

async function saveTally() {
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const notes = {};
    let totalPhy = 0;

    document.querySelectorAll('.note-input').forEach(input => {
        const val = input.getAttribute('data-val');
        const count = parseInt(input.value) || 0;
        notes[`n${val}`] = count;
        totalPhy += (parseInt(val) * count);
    });

    const diff = totalPhy - currentSystemBalance;

    const { error } = await _supabase.from('cash_tally').upsert({
        user_id: currentUser.id,
        report_date: date,
        ...notes,
        total_physical: totalPhy,
        system_balance: currentSystemBalance,
        difference: diff
    }, { onConflict: 'user_id, report_date' });

    if(error) alert("Error: " + error.message);
    else {
        alert("✅ Tally Saved Successfully!");
        loadTallyHistory();
    }
}

async function loadTallyHistory() {
    const { data, error } = await _supabase.from('cash_tally')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('report_date', { ascending: false })
        .limit(10);

    const tbody = document.getElementById('tallyHistoryBody');
    tbody.innerHTML = '';

    if(data && data.length > 0) {
        data.forEach(row => {
            let statusBadge = "";
            if(row.difference === 0) statusBadge = '<span class="status-badge badge-match">Matched</span>';
            else if(row.difference < 0) statusBadge = '<span class="status-badge badge-short">Shortage</span>';
            else statusBadge = '<span class="status-badge badge-extra">Extra</span>';

            const diffColor = row.difference < 0 ? 'var(--danger)' : (row.difference > 0 ? 'var(--success)' : 'inherit');

            tbody.innerHTML += `
                <tr>
                    <td><b>${row.report_date}</b></td>
                    <td>₹${row.total_physical.toLocaleString('en-IN')}</td>
                    <td>₹${row.system_balance.toLocaleString('en-IN')}</td>
                    <td style="color:${diffColor}; font-weight:bold;">₹${row.difference.toLocaleString('en-IN')}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; color: var(--text-light);">No history available</td></tr>';
    }
}

function shareWhatsAppReport() {
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const opening = document.getElementById('openingTotal').innerText;
    const sales = document.getElementById('todayCashSale').innerText;
    const exp = document.getElementById('todayCashExp').innerText;
    const phy = document.getElementById('phyTotal').innerText;
    const sys = document.getElementById('sysTotal').innerText;
    const diff = document.getElementById('diffTotal').innerText;

    let msg = `*📊 CASH TALLY REPORT (${date})*\n`;
    msg += `----------------------------\n`;
    msg += `🏠 *Opening Cash:* ${opening}\n`;
    msg += `💰 *Cash Sales (+):* ${sales}\n`;
    msg += `📉 *Cash Expenses (-):* ${exp}\n`;
    msg += `----------------------------\n`;
    msg += `💻 *System Balance:* ${sys}\n`;
    msg += `💵 *Physical Cash:* ${phy}\n`;
    msg += `⚖️ *Difference:* ${diff}\n`;
    msg += `----------------------------\n`;
    
    const diffVal = parseFloat(diff.replace('₹', '').replace(/,/g, ''));
    if(diffVal === 0) msg += `✅ *Status:* Cash Matched!`;
    else if(diffVal < 0) msg += `🔴 *Status:* Cash Shortage!`;
    else msg += `🟢 *Status:* Extra Cash Found!`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}
