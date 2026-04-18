let currentUser = null;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    
    document.getElementById('fromDate').value = firstDay;
    document.getElementById('toDate').value = today;
    
    calculateReconciliation();
};

async function calculateReconciliation() {
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    
    if(!fromDate || !toDate) return showToast("Please select both dates", "error");

    document.getElementById('statusTitle').innerText = "Calculating...";
    document.getElementById('statusIcon').innerHTML = '<i class="ri-loader-4-line spin"></i>';
    
    try {
        // Get Physical Cash for "To Date" only
        const { data: tallyData } = await _supabase.from('cash_tally')
            .select('total_physical')
            .eq('user_id', currentUser.id)
            .eq('report_date', toDate)
            .maybeSingle();

        const physicalCash = tallyData ? tallyData.total_physical : 0;

        // Get Closing Balance for "To Date" only
        const { data: balanceData } = await _supabase.from('daily_balances')
            .select('closing_balance')
            .eq('user_id', currentUser.id)
            .eq('report_date', toDate)
            .maybeSingle();

        const closingBalance = balanceData ? balanceData.closing_balance : 0;

        // Get Total Vendor Due as of toDate (opening_due + all bills - all payments up to toDate)
        const [vendorsRes, ledgerRes] = await Promise.all([
            _supabase.from('vendors').select('id, opening_due').eq('user_id', currentUser.id),
            _supabase.from('vendor_ledger').select('vendor_id, amount, t_type').eq('user_id', currentUser.id).lte('t_date', toDate)
        ]);

        const vendors = vendorsRes.data || [];
        const ledger = ledgerRes.data || [];

        const totalVendorDue = vendors.reduce((sum, vendor) => {
            const txns = ledger.filter(l => l.vendor_id === vendor.id);
            const bill = txns.filter(l => l.t_type === 'BILL').reduce((s, l) => s + l.amount, 0);
            const paid = txns.filter(l => l.t_type === 'PAYMENT' || l.t_type === 'PAYMENT_OWNER').reduce((s, l) => s + l.amount, 0);
            return sum + (vendor.opening_due || 0) + bill - paid;
        }, 0);

        // Get Total Owner Loan for the period
        const { data: loans } = await _supabase.from('owner_ledger')
            .select('amount')
            .eq('user_id', currentUser.id)
            .gte('t_date', fromDate)
            .lte('t_date', toDate)
            .eq('t_type', 'LOAN_TAKEN');
            
        const totalOwnerLoan = loans ? loans.reduce((sum, item) => sum + item.amount, 0) : 0;

        // Side A: Physical Cash - Closing Balance (for "To Date")
        const sideA_Total = physicalCash - closingBalance;

        // Side B: Total Vendor Due + Total Owner Loan (for period)
        const sideB_Total = totalVendorDue + totalOwnerLoan;

        document.getElementById('phyCash').innerText = `₹${physicalCash.toLocaleString('en-IN')}`;
        document.getElementById('closeBal').innerText = `₹${closingBalance.toLocaleString('en-IN')}`;
        document.getElementById('sideA_Total').innerText = `₹${sideA_Total.toLocaleString('en-IN')}`;

        document.getElementById('vendorDue').innerText = `₹${totalVendorDue.toLocaleString('en-IN')}`;
        document.getElementById('ownerLoan').innerText = `₹${totalOwnerLoan.toLocaleString('en-IN')}`;
        document.getElementById('sideB_Total').innerText = `₹${sideB_Total.toLocaleString('en-IN')}`;

        const diff = sideA_Total - sideB_Total;
        const card = document.getElementById('statusCard');
        const icon = document.getElementById('statusIcon');
        const title = document.getElementById('statusTitle');
        const desc = document.getElementById('statusDesc');
        const amt = document.getElementById('diffAmount');

        card.className = 'glass-card status-card';
        amt.innerText = `₹${Math.abs(diff).toLocaleString('en-IN')}`;

        if (Math.abs(diff) < 1) { // Perfect Match (handles floating point)
            card.classList.add('perfect');
            icon.innerHTML = '<i class="ri-checkbox-circle-line"></i>';
            title.innerText = "ACCOUNTS MATCHED";
            desc.innerText = "Cash flow matches your liabilities perfectly.";
        } else if (diff < 0) { // Shortage
            card.classList.add('short');
            icon.innerHTML = '<i class="ri-alert-line"></i>';
            title.innerText = "CASH SHORTAGE";
            desc.innerText = "Physical cash is less than expected liabilities.";
        } else { // Excess
            card.classList.add('excess');
            icon.innerHTML = '<i class="ri-information-line"></i>';
            title.innerText = "EXCESS CASH";
            desc.innerText = "You have more cash than recorded liabilities.";
        }

    } catch (err) {
        console.error(err);
        showToast("Error calculating reconciliation: " + err.message, "error");
    }
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}
