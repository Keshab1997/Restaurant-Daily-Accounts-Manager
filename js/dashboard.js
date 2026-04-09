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
    
    // Check if date parameter is passed from expense-history
    const urlParams = new URLSearchParams(window.location.search);
    const dateParam = urlParams.get('date');
    
    const today = dateParam || new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    if(!dateInput.value) dateInput.value = today;
    
    updateDisplayDate(dateInput.value);
    
    dateInput.addEventListener('change', function() {
        updateDisplayDate(this.value);
        loadData();
    });

    const inputs = ['openingBal', 'saleCash', 'saleCard', 'saleSwiggy', 'saleZomato', 'saleBank'];
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
    try {
        const date = document.getElementById('date').value;
        
        if (!date) {
            showToast('Please select a date', 'error');
            return;
        }
        
        const [lastEntryData, salesData, expensesData] = await Promise.all([
            _supabase.from('daily_balances')
                .select('closing_balance')
                .eq('user_id', currentUser.id)
                .lt('report_date', date)
                .order('report_date', { ascending: false })
                .limit(1)
                .maybeSingle(),
            _supabase.from('sales').select('*').eq('user_id', currentUser.id).eq('report_date', date),
            _supabase.from('expenses').select('*').eq('user_id', currentUser.id).eq('report_date', date)
        ]);

        if (lastEntryData.error) throw lastEntryData.error;
        if (salesData.error) throw salesData.error;
        if (expensesData.error) throw expensesData.error;

        document.getElementById('openingBal').value = lastEntryData.data ? lastEntryData.data.closing_balance : 0;

        ['saleCash', 'saleBank', 'saleCard', 'saleSwiggy', 'saleZomato'].forEach(id => document.getElementById(id).value = 0);
        
        if(salesData.data) {
            const saleMap = {};
            salesData.data.forEach(s => saleMap[s.sale_type] = s.amount);
            document.getElementById('saleCash').value = saleMap['CASH'] || 0;
            document.getElementById('saleBank').value = saleMap['BANK_WITHDRAWAL'] || 0;
            document.getElementById('saleCard').value = saleMap['CARD'] || 0;
            document.getElementById('saleSwiggy').value = saleMap['SWIGGY'] || 0;
            document.getElementById('saleZomato').value = saleMap['ZOMATO'] || 0;
        }

        currentDayExpenses = expensesData.data || [];
        
        updateCalculations();
        await saveSales(true);
    } catch (error) {
        console.error('Error loading data:', error);
        showToast('Failed to load data: ' + (error.message || 'Unknown error'), 'error');
    }
}

function updateCalculations() {
    const opening = parseFloat(document.getElementById('openingBal').value) || 0;
    const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
    const bankWithdrawal = parseFloat(document.getElementById('saleBank').value) || 0;
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
    
    const netCashFlow = (cashSale + bankWithdrawal) - totalAllExp;
    const netBalEl = document.getElementById('netBalanceToday');
    netBalEl.innerText = `₹${netCashFlow.toLocaleString('en-IN')}`;
    
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
    
    showToast("Syncing data with cloud...", "info");

    try {
        await saveSales();
        btn.classList.remove('syncing');
        btn.classList.add('success');
        icon.classList.remove('spin');
        icon.className = 'ri-checkbox-circle-line';
        text.innerText = 'Synced!';
        
        showToast("Data synced successfully!", "success");

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
    try {
        const date = document.getElementById('date').value;
        const opening = parseFloat(document.getElementById('openingBal').value) || 0;
        const cashSale = parseFloat(document.getElementById('saleCash').value) || 0;
        const bankWithdrawal = parseFloat(document.getElementById('saleBank').value) || 0;
        const cardSale = parseFloat(document.getElementById('saleCard').value) || 0;
        const swiggy = parseFloat(document.getElementById('saleSwiggy').value) || 0;
        const zomato = parseFloat(document.getElementById('saleZomato').value) || 0;
        
        if (!date) {
            if (!silent) showToast('Please select a date', 'error');
            return;
        }
        
        let totalExpenses = 0;
        currentDayExpenses.forEach(exp => totalExpenses += exp.amount);

        const netCashFlow = (cashSale + bankWithdrawal) - totalExpenses;
        const finalClosingBalance = opening + netCashFlow;

        const { error: upsertErr } = await _supabase.from('daily_balances').upsert({ 
            user_id: currentUser.id, 
            report_date: date, 
            opening_balance: opening, 
            closing_balance: finalClosingBalance 
        }, { onConflict: 'user_id, report_date' });

        if (upsertErr) throw upsertErr;

        const types = [
            {t:'CASH', val: cashSale}, 
            {t:'BANK_WITHDRAWAL', val: bankWithdrawal},
            {t:'CARD', val: cardSale}, 
            {t:'SWIGGY', val: swiggy}, 
            {t:'ZOMATO', val: zomato}
        ];

        for(let item of types) {
            if(item.val > 0) {
                const { error: saleError } = await _supabase.from('sales').upsert({ 
                    user_id: currentUser.id, 
                    report_date: date, 
                    sale_type: item.t, 
                    amount: item.val 
                }, { onConflict: 'user_id, report_date, sale_type' });
                
                if (saleError) throw saleError;
            } else {
                const { error: deleteError } = await _supabase.from('sales')
                    .delete()
                    .eq('user_id', currentUser.id)
                    .eq('report_date', date)
                    .eq('sale_type', item.t);
                    
                if (deleteError) throw deleteError;
            }
        }

        if (!silent) {
            await recalculateFutureBalances(date);
        }
    } catch (error) {
        console.error('Error saving sales:', error);
        if (!silent) showToast('Failed to save: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function recalculateFutureBalances(startDate) {
    showToast("Recalculating subsequent dates... Please wait.", "info");

    try {
        const { data: startDayBalance } = await _supabase
            .from('daily_balances')
            .select('closing_balance')
            .eq('user_id', currentUser.id)
            .eq('report_date', startDate)
            .maybeSingle();

        if (!startDayBalance) {
            showToast("No starting balance found", "error");
            return;
        }

        const { data: allBalances } = await _supabase
            .from('daily_balances')
            .select('report_date')
            .eq('user_id', currentUser.id)
            .gt('report_date', startDate)
            .order('report_date', { ascending: true });

        if (!allBalances || allBalances.length === 0) {
            showToast("No future dates to recalculate", "info");
            return;
        }

        const futureDates = allBalances.map(b => b.report_date);
        const [salesData, expensesData] = await Promise.all([
            _supabase.from('sales').select('report_date, amount, sale_type')
                .eq('user_id', currentUser.id)
                .in('report_date', futureDates)
                .in('sale_type', ['CASH', 'BANK_WITHDRAWAL']),
            _supabase.from('expenses').select('report_date, amount')
                .eq('user_id', currentUser.id)
                .in('report_date', futureDates)
        ]);

        const salesMap = {};
        const expensesMap = {};

        if (salesData.data) {
            salesData.data.forEach(s => {
                salesMap[s.report_date] = (salesMap[s.report_date] || 0) + s.amount;
            });
        }

        if (expensesData.data) {
            expensesData.data.forEach(e => {
                expensesMap[e.report_date] = (expensesMap[e.report_date] || 0) + e.amount;
            });
        }

        let previousClosing = startDayBalance.closing_balance;
        const updates = allBalances.map(dateRecord => {
            const totalIn = salesMap[dateRecord.report_date] || 0;
            const totalOut = expensesMap[dateRecord.report_date] || 0;
            previousClosing = previousClosing + (totalIn - totalOut);
            return {
                user_id: currentUser.id,
                report_date: dateRecord.report_date,
                opening_balance: previousClosing - (totalIn - totalOut),
                closing_balance: previousClosing
            };
        });

        if (updates.length > 0) {
            const { error: upsertError } = await _supabase
                .from('daily_balances')
                .upsert(updates, { onConflict: 'user_id, report_date' });

            if (upsertError) throw upsertError;
        }

        showToast(`Successfully updated ${updates.length} future dates!`, "success");
    } catch (err) {
        console.error("Propagation Error:", err);
        showToast("Error updating future dates: " + err.message, "error");
    }
}

function shareDailyReportText() {
    showToast("Opening WhatsApp...", "info");
    
    const date = document.getElementById('date').value;
    const opening = document.getElementById('openingBal').value;
    const cashSale = document.getElementById('detCashSale').innerText;
    const cardSale = document.getElementById('detCardSale').innerText;
    const swiggy = document.getElementById('detSwiggy').innerText;
    const zomato = document.getElementById('detZomato').innerText;
    const totalSale = document.getElementById('totalSale').innerText;
    const totalExp = document.getElementById('totalExpAll').innerText;
    const finalClosing = document.getElementById('closingCashText').innerText.split(': ')[1];

    let msg = `*DAILY BUSINESS REPORT*\n`;
    msg += `Restaurant: ${restaurantName}\n`;
    msg += `Date: ${date}\n`;
    msg += `----------------------------\n`;
    msg += `Opening Balance: ₹${opening}\n`;
    msg += `----------------------------\n`;
    msg += `*REVENUE BREAKDOWN*\n`;
    msg += `Cash Sale: ${cashSale}\n`;
    msg += `Card/UPI Sale: ${cardSale}\n`;
    msg += `Swiggy Orders: ${swiggy}\n`;
    msg += `Zomato Orders: ${zomato}\n`;
    msg += `*TOTAL SALE: ${totalSale}*\n`;
    msg += `----------------------------\n`;
    msg += `*TOTAL EXPENSE: ${totalExp}*\n`;
    msg += `----------------------------\n`;
    msg += `*Calculation:*\n`;
    msg += `${opening} (Opening) + ${cashSale} (Cash Sale) - ${totalExp} (Expense) = ${finalClosing} (Closing)\n`;
    msg += `----------------------------\n`;
    msg += `*FINAL CLOSING BALANCE: ${finalClosing}*\n`;
    msg += `----------------------------\n`;
    msg += `Authorized Signature: ${signatureName}\n`;
    msg += `App developed by Keshab Sarkar`;

    window.open(`https://wa.me/?text=${encodeURIComponent(msg)}`, '_blank');
}

async function shareDailyReportImage() {
    const btn = document.querySelector('.btn-image-report');
    const originalHTML = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Generating...';
    showToast("Generating report for owner...", "info");

    try {
        const opening = document.getElementById('openingBal').value;
        const cashSale = document.getElementById('detCashSale').innerText;
        const totalSale = document.getElementById('totalSale').innerText;
        const totalExp = document.getElementById('totalExpAll').innerText;
        const closing = document.getElementById('closingCashText').innerText.split(': ')[1];

        document.getElementById('repRestroName').innerText = restaurantName;
        document.getElementById('repDate').innerText = document.getElementById('date').value;
        document.getElementById('repOpening').innerText = `₹${opening}`;
        
        // Sales breakdown
        document.getElementById('repCashSale').innerText = document.getElementById('detCashSale').innerText;
        document.getElementById('repCardSale').innerText = document.getElementById('detCardSale').innerText;
        document.getElementById('repSwiggy').innerText = document.getElementById('detSwiggy').innerText;
        document.getElementById('repZomato').innerText = document.getElementById('detZomato').innerText;
        document.getElementById('repTotalSale').innerText = totalSale;
        
        // Only total expense
        document.getElementById('repTotalExp').innerText = totalExp;
        document.getElementById('repClosing').innerText = closing;
        document.getElementById('repSignature').innerText = signatureName;

        // Calculation formula with Cash Sale only
        document.getElementById('repFormula').innerText = 
            `${opening} (Opening) + ${cashSale} (Cash Sale) - ${totalExp} (Expense) = ${closing} (Closing)`;

        const template = document.getElementById('dailyReportTemplate');
        const canvas = await html2canvas(template, { scale: 2 });
        const link = document.createElement('a');
        link.download = `Report_${document.getElementById('date').value}.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();

        showToast("Report image ready!", "success");
    } catch (err) {
        console.error(err);
        showToast("Failed to generate image", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }
