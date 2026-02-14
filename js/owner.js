let currentUser = null;
let currentType = 'LOAN_TAKEN';

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    loadOwnerData();
};

function setTransType(type) {
    currentType = type;
    document.getElementById('btnLoan').classList.toggle('active', type === 'LOAN_TAKEN');
    document.getElementById('btnHandover').classList.toggle('active', type === 'CASH_HANDOVER');
    
    const submitBtn = document.getElementById('submitBtn');
    if(type === 'LOAN_TAKEN') {
        submitBtn.style.background = '#ef4444';
        submitBtn.innerText = "Confirm Loan Taken";
    } else {
        submitBtn.style.background = '#059669';
        submitBtn.innerText = "Confirm Cash Handover";
    }
}

async function loadOwnerData() {
    const { data } = await _supabase.from('owner_ledger')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('t_date', { ascending: false })
        .order('created_at', { ascending: false });
    
    let taken = 0;
    let given = 0;
    const list = document.getElementById('ownerList');
    list.innerHTML = '';

    if(data && data.length > 0) {
        data.forEach(d => {
            if(d.t_type === 'LOAN_TAKEN') taken += d.amount;
            else given += d.amount;

            const color = d.t_type === 'LOAN_TAKEN' ? '#ef4444' : '#059669';
            const badgeClass = d.t_type === 'LOAN_TAKEN' ? 'badge-loan' : 'badge-handover';
            const label = d.t_type === 'LOAN_TAKEN' ? 'Loan Taken' : 'Cash Handover';

            list.innerHTML += `
                <li class="owner-item">
                    <div class="li-left">
                        <span>${d.description || label}</span>
                        <small><i class="ri-calendar-line"></i> ${d.t_date}</small>
                    </div>
                    <div class="li-right">
                        <b style="color: ${color}">₹${d.amount.toLocaleString('en-IN')}</b>
                        <small class="${badgeClass}">${label}</small>
                    </div>
                </li>
            `;
        });
    } else {
        list.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No transactions yet</p>';
    }

    document.getElementById('loanTotal').innerText = `₹${taken.toLocaleString('en-IN')}`;
    document.getElementById('handoverTotal').innerText = `₹${given.toLocaleString('en-IN')}`;
    
    const net = taken - given;
    const netEl = document.getElementById('netPayable');
    netEl.innerText = `₹${net.toLocaleString('en-IN')}`;
    netEl.style.color = net >= 0 ? '#2563eb' : '#059669';
}

async function addOwnerTrans() {
    const amount = parseFloat(document.getElementById('amount').value);
    const desc = document.getElementById('desc').value;
    const date = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });

    if(!amount || amount <= 0) return alert("Please enter a valid amount");

    const { error } = await _supabase.from('owner_ledger').insert({
        user_id: currentUser.id,
        t_date: date,
        t_type: currentType,
        amount: amount,
        description: desc
    });

    if(error) {
        showToast("Error: " + error.message, "error");
    } else {
        document.getElementById('amount').value = '';
        document.getElementById('desc').value = '';
        loadOwnerData();
    }
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}
