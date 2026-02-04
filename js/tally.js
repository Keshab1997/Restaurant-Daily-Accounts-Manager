let currentUser = null;
let currentSystemBalance = 0;
let openingBalFromDb = 0;
let totalCumulativeDiff = 0;
let autoSaveTimeout = null;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    document.getElementById('tallyDateDisplay').innerText = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    document.querySelectorAll('.note-input').forEach(input => {
        input.addEventListener('input', () => {
            calculateLiveTally();
            triggerAutoSave();
        });
    });

    await loadSystemBalance(today);
    await loadTallyHistory();
};

async function loadSystemBalance(date) {
    // ১. ড্যাশবোর্ড থেকে আজকের ওপেনিং ব্যালেন্স (যা আপনি সকালে গুনে বসিয়েছেন)
    const { data: balData } = await _supabase.from('daily_balances')
        .select('opening_balance')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .maybeSingle();
    
    openingBalFromDb = balData ? balData.opening_balance : 0;
    document.getElementById('openingTotal').innerText = `₹${openingBalFromDb.toLocaleString('en-IN')}`;

    // ২. আজকের মোট ক্যাশ সেল ফেচ করা
    const { data: sales } = await _supabase.from('sales')
        .select('amount')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .eq('sale_type', 'CASH');
    
    // ৩. আজকের মোট ক্যাশ খরচ (Vendor Payment + Expenses) ফেচ করা
    const { data: expenses } = await _supabase.from('expenses')
        .select('amount')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .eq('payment_source', 'CASH');

    const cashSale = sales ? sales.reduce((sum, s) => sum + s.amount, 0) : 0;
    const cashExp = expenses ? expenses.reduce((sum, e) => sum + e.amount, 0) : 0;

    document.getElementById('todayCashSale').innerText = `₹${cashSale.toLocaleString('en-IN')}`;
    document.getElementById('todayCashExp').innerText = `₹${cashExp.toLocaleString('en-IN')}`;

    // ৪. সিস্টেম অনুযায়ী ক্যাশ বক্সে কত থাকা উচিত: Opening + Sales - Expenses
    currentSystemBalance = openingBalFromDb + cashSale - cashExp;
    
    document.getElementById('sysTotal').innerText = `₹${currentSystemBalance.toLocaleString('en-IN')}`;
    // ৫. কিউমুলেটিভ ডিফারেন্স (সব শর্টেজ যোগফল) ফেচ করা
    const { data: allTally } = await _supabase.from('cash_tally')
        .select('difference')
        .eq('user_id', currentUser.id);
    
    totalCumulativeDiff = allTally ? allTally.reduce((sum, t) => sum + t.difference, 0) : 0;
    updateCumulativeDisplay();
    
    // ৬. আজকের যদি কোনো সেভ করা ট্যালি থাকে তবে তা লোড করা
    const { data: existingTally } = await _supabase.from('cash_tally')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .maybeSingle();

    if(existingTally) {
        const notes = [500, 200, 100, 50, 20, 10, 1];
        notes.forEach(n => {
            const input = document.querySelector(`.note-input[data-val="${n}"]`);
            if(input) input.value = existingTally[`n${n}`] || 0;
        });
    }
    
    calculateLiveTally();
}

function updateCumulativeDisplay() {
    const cumEl = document.getElementById('cumulativeDiff');
    if(cumEl) {
        cumEl.innerText = `₹${totalCumulativeDiff.toLocaleString('en-IN')}`;
        if(totalCumulativeDiff < 0) cumEl.style.color = "var(--danger)";
        else if(totalCumulativeDiff > 0) cumEl.style.color = "var(--success)";
        else cumEl.style.color = "var(--text-dark)";
    }
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

function triggerAutoSave() {
    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
        saveTally(true);
    }, 1000);
}

async function saveTally(isAuto = false) {
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

    // ১. ক্যাশ ট্যালি টেবিলে নোটের ব্রেকডাউন সেভ করা
    const { error: tallyError } = await _supabase.from('cash_tally').upsert({
        user_id: currentUser.id,
        report_date: date,
        ...notes,
        total_physical: totalPhy,
        system_balance: currentSystemBalance,
        difference: diff
    }, { onConflict: 'user_id, report_date' });

    if(tallyError) {
        if(!isAuto) alert("Error saving tally: " + tallyError.message);
        return;
    }

    const { error: balError } = await _supabase.from('daily_balances').upsert({
        user_id: currentUser.id,
        report_date: date,
        opening_balance: openingBalFromDb,
        closing_balance: totalPhy
    }, { onConflict: 'user_id, report_date' });

    if(balError && !isAuto) return alert("Error updating closing balance: " + balError.message);

    if(!isAuto) {
        alert("✅ Tally Saved! Physical Cash ₹" + totalPhy.toLocaleString('en-IN') + " will be tomorrow's opening.");
        location.reload();
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
    const phy = document.getElementById('phyTotal').innerText;
    const sys = document.getElementById('sysTotal').innerText;
    const diff = document.getElementById('diffTotal').innerText;
    const cumEl = document.getElementById('cumulativeDiff');
    const cum = cumEl ? cumEl.innerText : '₹0';

    let msg = `CASH TALLY REPORT (${date})\n`;
    msg += `----------------------------\n`;
    msg += `System Balance: ${sys}\n`;
    msg += `Physical Cash: ${phy}\n`;
    msg += `Today's Difference: ${diff}\n`;
    msg += `----------------------------\n`;
    msg += `TOTAL CUMULATIVE SHORTAGE: ${cum}\n`;
    msg += `----------------------------\n`;
    msg += `App developed by Keshab Sarkar`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}
