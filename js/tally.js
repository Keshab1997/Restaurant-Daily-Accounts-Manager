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
    try {
        if (!date) {
            showToast('Please select a date', 'error');
            return;
        }
        
        document.querySelectorAll('.note-input').forEach(i => i.value = '');
        document.querySelectorAll('.note-total').forEach(b => b.innerText = '0');

        const { data: lastTally, error: lastTallyError } = await _supabase.from('cash_tally')
            .select('total_physical, cumulative_shortage')
            .eq('user_id', currentUser.id)
            .lt('report_date', date)
            .order('report_date', { ascending: false })
            .limit(1)
            .maybeSingle();

        if (lastTallyError) throw lastTallyError;

        tallyOpeningBalance = lastTally ? lastTally.total_physical : 0;
        lastCumulativeShortage = lastTally ? lastTally.cumulative_shortage : 0;

        document.getElementById('tallyOpening').innerText = `₹${tallyOpeningBalance.toLocaleString('en-IN')}`;

        const { data: sales, error: salesError } = await _supabase.from('sales').select('amount').eq('user_id', currentUser.id).eq('report_date', date).eq('sale_type', 'CASH');
        
        if (salesError) throw salesError;
        
        const { data: allPayments, error: paymentsError } = await _supabase.from('vendor_ledger')
            .select('amount, bill_no, vendor_id, vendors(name)')
            .eq('user_id', currentUser.id)
            .eq('t_date', date)
            .eq('t_type', 'PAYMENT');

        if (paymentsError) throw paymentsError;

        let realPreviousPaid = 0;
        let previousPaidBillNos = [];
        let previousPaidDetails = [];

        if (allPayments) {
            for (const pay of allPayments) {
                const { data: originalBill, error: billError } = await _supabase.from('vendor_ledger')
                    .select('t_date')
                    .eq('vendor_id', pay.vendor_id)
                    .eq('bill_no', pay.bill_no)
                    .eq('t_type', 'BILL')
                    .maybeSingle();

                if (billError) throw billError;

                if (originalBill && originalBill.t_date <= date) {
                    realPreviousPaid += pay.amount;
                    previousPaidBillNos.push(pay.bill_no);
                    previousPaidDetails.push(pay);
                }
            }
        }

        const { data: expenses, error: expensesError } = await _supabase.from('expenses')
            .select('amount, bill_no')
            .eq('user_id', currentUser.id)
            .eq('report_date', date)
            .eq('payment_source', 'CASH');

        if (expensesError) throw expensesError;

        let cashExp = 0;
        if (expenses) {
            for (const exp of expenses) {
                if (!previousPaidBillNos.includes(exp.bill_no)) {
                    cashExp += exp.amount;
                }
            }
        }

        const cashSale = sales ? sales.reduce((sum, s) => sum + s.amount, 0) : 0;
        const oldDuePaid = realPreviousPaid;

        document.getElementById('todayCashSale').innerText = `₹${cashSale.toLocaleString('en-IN')}`;
        document.getElementById('todayCashExp').innerText = `₹${cashExp.toLocaleString('en-IN')}`;
        document.getElementById('oldDuePaid').innerText = `₹${oldDuePaid.toLocaleString('en-IN')}`;

        const breakdownCont = document.getElementById('duePaidBreakdown');
        const list = document.getElementById('duePaidList');
        list.innerHTML = '';

        if (previousPaidDetails.length > 0) {
            breakdownCont.style.display = 'block';
            previousPaidDetails.forEach(p => {
                list.innerHTML += `
                    <li style="display: flex; justify-content: space-between; padding: 3px 0; border-bottom: 1px solid #fee2e2;">
                        <span>${p.vendors.name}</span>
                        <span style="font-weight: 700;">₹${p.amount.toLocaleString('en-IN')}</span>
                    </li>
                `;
            });
        } else {
            breakdownCont.style.display = 'none';
        }
        
        currentSystemBalance = (tallyOpeningBalance + cashSale) - cashExp - oldDuePaid;
        document.getElementById('sysTotal').innerText = `₹${currentSystemBalance.toLocaleString('en-IN')}`;

        const { data: currentTally, error: currentTallyError } = await _supabase.from('cash_tally')
            .select('*')
            .eq('user_id', currentUser.id)
            .eq('report_date', date)
            .maybeSingle();

        if (currentTallyError) throw currentTallyError;

        if(currentTally) {
            [500, 200, 100, 50, 20, 10, 5, 2, 1].forEach(d => {
                const val = currentTally[`n${d}`];
                if(val > 0) document.getElementById(`n${d}`).value = val;
            });
            if(currentTally.nstock) document.getElementById('nStock').value = currentTally.nstock;
        }

        calculateLiveTally();
    } catch (error) {
        console.error('Error loading tally data:', error);
        showToast('Failed to load tally data: ' + (error.message || 'Unknown error'), 'error');
    }
}

function calculateLiveTally() {
    let notesTotal = 0;
    
    // সব নোটের হিসাব (500 থেকে 1 পর্যন্ত)
    const notes = ['n500', 'n200', 'n100', 'n50', 'n20', 'n10', 'n5', 'n2', 'n1'];
    notes.forEach(id => {
        const input = document.getElementById(id);
        const count = parseInt(input.value) || 0;
        const multiplier = parseInt(input.getAttribute('data-val'));
        const rowTotal = count * multiplier;
        input.nextElementSibling.innerText = rowTotal.toLocaleString('en-IN');
        notesTotal += rowTotal;
    });

    // স্টক অ্যামাউন্ট যোগ করা
    const stockInput = document.getElementById('nStock');
    const stockAmount = parseInt(stockInput.value) || 0;
    stockInput.nextElementSibling.innerText = stockAmount.toLocaleString('en-IN');

    // গ্র্যান্ড টোটাল (নোট + স্টক)
    const grandTotal = notesTotal + stockAmount;
    document.getElementById('grandPhysicalTotal').innerText = grandTotal.toLocaleString('en-IN');
    document.getElementById('phyTotal').innerText = `₹${grandTotal.toLocaleString('en-IN')}`;
    
    const diff = grandTotal - currentSystemBalance;
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
    try {
        const date = document.getElementById('tallyDate').value;
        
        if (!date) {
            showToast('Please select a date', 'error');
            return;
        }
        
        const notes = {};
        let totalPhy = 0;

        [500, 200, 100, 50, 20, 10, 5, 2, 1].forEach(d => {
            const input = document.getElementById(`n${d}`);
            const count = parseInt(input.value) || 0;
            notes[`n${d}`] = count;
            totalPhy += (d * count);
        });

        const stockAmount = parseInt(document.getElementById('nStock').value) || 0;
        notes.nstock = stockAmount;
        totalPhy += stockAmount;

        const diff = totalPhy - currentSystemBalance;
        const newCumulative = lastCumulativeShortage - diff;

        const { error: deleteError } = await _supabase.from('cash_tally')
            .delete()
            .eq('user_id', currentUser.id)
            .eq('report_date', date);

        if (deleteError) throw deleteError;

        const { error } = await _supabase.from('cash_tally').insert({
            user_id: currentUser.id,
            report_date: date,
            ...notes,
            total_physical: totalPhy,
            system_balance: currentSystemBalance,
            difference: diff,
            cumulative_shortage: newCumulative
        });
        
        if(error) throw error;
        
        console.log('Data saved successfully');
        loadTallyHistory();
    } catch (error) {
        console.error('Save error:', error);
        showToast('Failed to save: ' + (error.message || 'Unknown error'), 'error');
    }
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
