let currentUser = null;
let currentSystemBalance = 0;
let tallyOpeningBalance = 0;
let lastCumulativeShortage = 0;
let autoSaveTimeout = null;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    const dateInput = document.getElementById('tallyDate');
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    dateInput.value = today;

    dateInput.addEventListener('change', () => loadTallyData(dateInput.value));

    document.querySelectorAll('.note-input').forEach(input => {
        input.addEventListener('input', () => {
            calculateLiveTally();
            triggerAutoSave();
        });
    });

    await loadTallyData(today);
    await loadTallyHistory();
};

async function loadTallyData(date) {
    document.querySelectorAll('.note-input').forEach(i => i.value = '');
    document.querySelectorAll('.note-total').forEach(b => b.innerText = '0');

    const { data: lastTally } = await _supabase.from('cash_tally')
        .select('total_physical, cumulative_shortage')
        .eq('user_id', currentUser.id)
        .lt('report_date', date)
        .order('report_date', { ascending: false })
        .limit(1)
        .maybeSingle();

    tallyOpeningBalance = lastTally ? lastTally.total_physical : 0;
    lastCumulativeShortage = lastTally ? lastTally.cumulative_shortage : 0;

    document.getElementById('tallyOpening').innerText = `₹${tallyOpeningBalance.toLocaleString('en-IN')}`;

    const { data: sales } = await _supabase.from('sales').select('amount').eq('user_id', currentUser.id).eq('report_date', date).eq('sale_type', 'CASH');
    const { data: expenses } = await _supabase.from('expenses').select('amount').eq('user_id', currentUser.id).eq('report_date', date).eq('payment_source', 'CASH');

    // পুরনো বকেয়া পরিশোধ (ভেন্ডর পেমেন্ট) হিসাব করা
    const { data: vendorPayments } = await _supabase.from('vendor_ledger')
        .select('amount')
        .eq('user_id', currentUser.id)
        .eq('t_date', date)
        .eq('t_type', 'PAYMENT');

    const cashSale = sales ? sales.reduce((sum, s) => sum + s.amount, 0) : 0;
    const cashExp = expenses ? expenses.reduce((sum, e) => sum + e.amount, 0) : 0;
    const oldDuePaid = vendorPayments ? vendorPayments.reduce((sum, p) => sum + p.amount, 0) : 0;

    document.getElementById('todayCashSale').innerText = `₹${cashSale.toLocaleString('en-IN')}`;
    document.getElementById('todayCashExp').innerText = `₹${cashExp.toLocaleString('en-IN')}`;
    document.getElementById('oldDuePaid').innerText = `₹${oldDuePaid.toLocaleString('en-IN')}`;

    currentSystemBalance = (tallyOpeningBalance + cashSale) - cashExp - oldDuePaid;
    document.getElementById('sysTotal').innerText = `₹${currentSystemBalance.toLocaleString('en-IN')}`;

    const { data: currentTally } = await _supabase.from('cash_tally')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('report_date', date)
        .maybeSingle();

    if(currentTally) {
        [500, 200, 100, 50, 20, 10, 5, 2, 1].forEach(d => {
            const val = currentTally[`n${d}`];
            if(val > 0) document.getElementById(`n${d}`).value = val;
        });
    }

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

    const newCumulative = lastCumulativeShortage - diff; 
    document.getElementById('cumulativeDiff').innerText = `₹${newCumulative.toLocaleString('en-IN')}`;
}

function triggerAutoSave() {
    const indicator = document.getElementById('saveIndicator');
    indicator.style.display = 'none';

    clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(async () => {
        await saveTallyData();
        indicator.style.display = 'flex';
        setTimeout(() => indicator.style.display = 'none', 2000);
    }, 1000);
}

async function saveTallyData() {
    const date = document.getElementById('tallyDate').value;
    const notes = {};
    let totalPhy = 0;

    document.querySelectorAll('.note-input').forEach(input => {
        const val = input.getAttribute('data-val');
        const count = parseInt(input.value) || 0;
        notes[`n${val}`] = count;
        totalPhy += (parseInt(val) * count);
    });

    const diff = totalPhy - currentSystemBalance;
    const newCumulative = lastCumulativeShortage - diff;

    await _supabase.from('cash_tally').upsert({
        user_id: currentUser.id,
        report_date: date,
        ...notes,
        total_physical: totalPhy,
        system_balance: currentSystemBalance,
        difference: diff,
        cumulative_shortage: newCumulative
    }, { onConflict: 'user_id, report_date' });
    
    loadTallyHistory();
}

async function loadTallyHistory() {
    const { data } = await _supabase.from('cash_tally')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('report_date', { ascending: false })
        .limit(10);

    const tbody = document.getElementById('tallyHistoryBody');
    tbody.innerHTML = '';

    if(data && data.length > 0) {
        data.forEach(row => {
            let statusBadge = "";
            if(row.difference === 0) statusBadge = '<span class="status-badge badge-match">Perfect</span>';
            else if(row.difference < 0) statusBadge = '<span class="status-badge badge-short">Shortage</span>';
            else statusBadge = '<span class="status-badge badge-extra">Extra</span>';

            const diffColor = row.difference < 0 ? 'var(--danger)' : (row.difference > 0 ? 'var(--success)' : 'inherit');

            tbody.innerHTML += `
                <tr>
                    <td><b>${row.report_date}</b></td>
                    <td>₹${row.total_physical.toLocaleString('en-IN')}</td>
                    <td>₹${row.system_balance.toLocaleString('en-IN')}</td>
                    <td style="color:${diffColor}; font-weight:bold;">₹${row.difference.toLocaleString('en-IN')}</td>
                    <td style="color:#991b1b; font-weight:bold;">₹${(row.cumulative_shortage || 0).toLocaleString('en-IN')}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        });
    } else {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; color: var(--text-light);">No history available</td></tr>';
    }
}

function shareWhatsAppReport() {
    const date = document.getElementById('tallyDate').value;
    const phy = document.getElementById('phyTotal').innerText;
    const sys = document.getElementById('sysTotal').innerText;
    const diff = document.getElementById('diffTotal').innerText;
    const cumul = document.getElementById('cumulativeDiff').innerText;
    const oldDue = document.getElementById('oldDuePaid').innerText;

    let msg = `*CASH TALLY REPORT (${date})*\n`;
    msg += `----------------------------\n`;
    msg += `Opening Cash: ₹${tallyOpeningBalance.toLocaleString('en-IN')}\n`;
    msg += `Today's Cash Sale: ${document.getElementById('todayCashSale').innerText}\n`;
    msg += `Today's Cash Exp: ${document.getElementById('todayCashExp').innerText}\n`;
    msg += `Previous Due Paid: ${oldDue}\n`;
    msg += `----------------------------\n`;
    msg += `System Balance: ${sys}\n`;
    msg += `Physical Cash: ${phy}\n`;
    msg += `Difference: ${diff}\n`;
    msg += `*Total Shortage:* ${cumul}\n`;
    msg += `----------------------------\n`;
    msg += `_Generated by RestroManager_`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }
