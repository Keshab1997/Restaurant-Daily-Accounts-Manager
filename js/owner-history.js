let currentUser = null;
let allData = [];

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;

    const now = new Date();
    const firstDay = new Date(now.getFullYear(), now.getMonth(), 1).toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    
    document.getElementById('fromDate').value = firstDay;
    document.getElementById('toDate').value = today;

    loadOwnerHistory();
};

async function loadOwnerHistory() {
    const tbody = document.getElementById('historyBody');
    tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:20px;">Loading...</td></tr>';

    const { data, error } = await _supabase.from('owner_ledger')
        .select('*')
        .eq('user_id', currentUser.id)
        .order('t_date', { ascending: false })
        .order('created_at', { ascending: false });

    if (error) {
        alert("Error loading data");
        return;
    }

    allData = data || [];
    applyFilters();
}

function applyFilters() {
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    const type = document.getElementById('typeFilter').value;

    const filtered = allData.filter(item => {
        const dateMatch = (!fromDate || item.t_date >= fromDate) && (!toDate || item.t_date <= toDate);
        const typeMatch = (type === 'ALL') || (item.t_type === type);
        return dateMatch && typeMatch;
    });

    renderTable(filtered);
    calculateSummary(filtered);
}

function renderTable(data) {
    const tbody = document.getElementById('historyBody');
    const mobileList = document.getElementById('mobileList');
    tbody.innerHTML = '';
    mobileList.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="5" style="text-align:center; padding:30px; color:#94a3b8;">No records found.</td></tr>';
        mobileList.innerHTML = '<p style="text-align:center; padding:20px; color:#94a3b8;">No records found.</p>';
        return;
    }

    data.forEach(row => {
        const isLoan = row.t_type === 'LOAN_TAKEN';
        const badgeClass = isLoan ? 'badge-loan' : 'badge-handover';
        const badgeText = isLoan ? 'LOAN TAKEN' : 'CASH HANDOVER';
        const amtColor = isLoan ? '#ef4444' : '#059669';

        tbody.innerHTML += `
            <tr>
                <td><b>${row.t_date}</b></td>
                <td>${row.description || '-'}</td>
                <td><span class="badge ${badgeClass}">${badgeText}</span></td>
                <td style="color:${amtColor}; font-weight:800;">₹${row.amount.toLocaleString('en-IN')}</td>
                <td>
                    <button class="btn-del" onclick="deleteEntry('${row.id}')"><i class="ri-delete-bin-line"></i></button>
                </td>
            </tr>
        `;

        mobileList.innerHTML += `
            <div class="mob-card">
                <div class="mob-header">
                    <span class="mob-date"><i class="ri-calendar-line"></i> ${row.t_date}</span>
                    <span class="badge ${badgeClass}">${badgeText}</span>
                </div>
                <div class="mob-body">
                    <h4>${row.description || 'No Description'}</h4>
                    <span class="mob-amt" style="color:${amtColor}">₹${row.amount.toLocaleString('en-IN')}</span>
                </div>
                <div class="mob-footer">
                    <button class="btn-del" onclick="deleteEntry('${row.id}')"><i class="ri-delete-bin-line"></i> Delete</button>
                </div>
            </div>
        `;
    });
}

function calculateSummary(data) {
    let loan = 0;
    let handover = 0;

    data.forEach(item => {
        if (item.t_type === 'LOAN_TAKEN') loan += item.amount;
        else handover += item.amount;
    });

    document.getElementById('sumLoan').innerText = `₹${loan.toLocaleString('en-IN')}`;
    document.getElementById('sumHandover').innerText = `₹${handover.toLocaleString('en-IN')}`;
    
    const net = loan - handover;
    const netEl = document.getElementById('sumNet');
    netEl.innerText = `₹${net.toLocaleString('en-IN')}`;
    netEl.style.color = net >= 0 ? '#2563eb' : '#059669';
}

async function deleteEntry(id) {
    if (!confirm("Are you sure you want to delete this record?")) return;

    const { error } = await _supabase.from('owner_ledger').delete().eq('id', id);
    if (error) showToast("Error deleting: " + error.message, "error");
    else loadOwnerHistory();
}

function exportToExcel() {
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    
    let csv = `Owner Ledger Report (${fromDate} to ${toDate})\n`;
    csv += "Date,Type,Description,Amount\n";

    const type = document.getElementById('typeFilter').value;
    const filtered = allData.filter(item => {
        const dateMatch = (!fromDate || item.t_date >= fromDate) && (!toDate || item.t_date <= toDate);
        const typeMatch = (type === 'ALL') || (item.t_type === type);
        return dateMatch && typeMatch;
    });

    filtered.forEach(row => {
        const typeText = row.t_type === 'LOAN_TAKEN' ? 'Loan Taken' : 'Cash Handover';
        const desc = row.description ? row.description.replace(/,/g, ' ') : '-';
        csv += `${row.t_date},${typeText},${desc},${row.amount}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `Owner_Report_${fromDate}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }
