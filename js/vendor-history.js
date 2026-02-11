let currentUser = null;
let allVendorData = [];

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;

    // Set default dates (1st of current month to today)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Kolkata' });
    const firstDay = today.substring(0, 8) + "01";
    document.getElementById('fromDate').value = firstDay;
    document.getElementById('toDate').value = today;

    await loadVendorHistory();
    
    // Auto-refresh every 30 seconds to catch vendor name updates
    setInterval(async () => {
        await loadVendorHistory();
    }, 30000);
};

async function loadVendorHistory() {
    const tbody = document.getElementById('vendorHistoryBody');
    const mobileList = document.getElementById('mobileCardList');
    
    tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px;">Calculating History...</td></tr>';
    if(mobileList) mobileList.innerHTML = '<p style="text-align:center; padding:20px; color:#64748b;">Loading...</p>';

    const { data: vendors } = await _supabase.from('vendors').select('*').eq('user_id', currentUser.id);
    if(!vendors) return;

    // Fetch all ledger entries at once for performance
    const { data: allLedger } = await _supabase.from('vendor_ledger').select('*').eq('user_id', currentUser.id).order('t_date', { ascending: false });

    allVendorData = vendors.map(v => {
        const vendorLedger = allLedger ? allLedger.filter(l => l.vendor_id === v.id) : [];
        
        let lastCategory = "N/A";
        let lastDate = v.created_at ? v.created_at.split('T')[0] : "N/A";
        
        if(vendorLedger.length > 0) {
            lastDate = vendorLedger[0].t_date;
            const lastBill = vendorLedger.find(l => l.t_type === 'BILL');
            if(lastBill && lastBill.description && lastBill.description.includes('for ')) {
                lastCategory = lastBill.description.split('for ')[1];
            }
        }

        return {
            id: v.id,
            name: v.name,
            opening_due: v.opening_due || 0,
            category: lastCategory,
            lastDate: lastDate,
            ledger: vendorLedger
        };
    });

    applyFilters();
}

function renderTable(data) {
    const tbody = document.getElementById('vendorHistoryBody');
    const mobileList = document.getElementById('mobileCardList');
    
    tbody.innerHTML = '';
    if(mobileList) mobileList.innerHTML = '';

    if(data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; padding:40px; color:#94a3b8;">No records found for this period</td></tr>';
        if(mobileList) mobileList.innerHTML = '<p style="text-align:center; padding:40px; color:#94a3b8;">No records found</p>';
        return;
    }

    data.forEach(v => {
        // Render Desktop Table Row
        tbody.innerHTML += `
            <tr>
                <td class="text-bold">${v.name}</td>
                <td><span style="background:#f1f5f9; color:#475569; padding:4px 10px; border-radius:6px; font-size:0.85rem;">${v.category}</span></td>
                <td style="font-size:0.85rem; color:#64748b;">${v.lastDate}</td>
                <td>₹${v.displayBill.toLocaleString('en-IN')}</td>
                <td class="paid-amount">₹${v.displayPaidCash.toLocaleString('en-IN')}</td>
                <td style="color:var(--warning)">₹${v.displayPaidOwner.toLocaleString('en-IN')}</td>
                <td class="due-amount">₹${v.currentDue.toLocaleString('en-IN')}</td>
                <td>
                    <button class="btn-view" onclick="location.href='vendor-details.html?id=${v.id}'">Details</button>
                </td>
            </tr>
        `;
        
        // Render Mobile Card
        if(mobileList) {
            mobileList.innerHTML += `
                <div class="history-card" onclick="location.href='vendor-details.html?id=${v.id}'">
                    <div class="hc-header">
                        <div class="hc-title">
                            <h3>${v.name}</h3>
                            <span class="hc-cat">${v.category}</span>
                        </div>
                        <div class="hc-date">
                            <i class="ri-calendar-line"></i> ${v.lastDate}
                        </div>
                    </div>
                    <div class="hc-stats">
                        <div class="stat-item">
                            <span>Total Bill</span>
                            <strong>₹${v.displayBill.toLocaleString('en-IN')}</strong>
                        </div>
                        <div class="stat-item">
                            <span>Paid (Cash)</span>
                            <strong style="color:var(--success)">₹${v.displayPaidCash.toLocaleString('en-IN')}</strong>
                        </div>
                    </div>
                    <div class="hc-footer">
                        <span class="due-label">CURRENT DUE</span>
                        <span class="due-val">₹${v.currentDue.toLocaleString('en-IN')}</span>
                    </div>
                </div>
            `;
        }
    });
}

function applyFilters() {
    const search = document.getElementById('searchVendor').value.toLowerCase();
    const status = document.getElementById('statusFilter').value;
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;

    const filteredData = allVendorData.map(v => {
        // Filter ledger by date range
        const filteredLedger = v.ledger.filter(l => {
            if (!fromDate || !toDate) return true;
            return l.t_date >= fromDate && l.t_date <= toDate;
        });

        // Calculate for selected period
        let periodBill = 0;
        let periodPaidCash = 0;
        let periodPaidOwner = 0;

        filteredLedger.forEach(l => {
            if (l.t_type === 'BILL') {
                periodBill += l.amount;
            } else if (l.t_type === 'PAYMENT') {
                periodPaidCash += l.amount;
            } else if (l.t_type === 'PAYMENT_OWNER') {
                periodPaidOwner += l.amount;
            }
        });

        // Calculate total current due (all time)
        let totalBill = v.opening_due;
        let totalPaid = 0;
        v.ledger.forEach(l => {
            if (l.t_type === 'BILL') totalBill += l.amount;
            else if (l.t_type === 'PAYMENT' || l.t_type === 'PAYMENT_OWNER') totalPaid += l.amount;
        });

        return {
            ...v,
            displayBill: periodBill,
            displayPaidCash: periodPaidCash,
            displayPaidOwner: periodPaidOwner,
            currentDue: totalBill - totalPaid
        };
    }).filter(v => {
        const matchesSearch = v.name.toLowerCase().includes(search) || v.category.toLowerCase().includes(search);
        const matchesStatus = (status === 'ALL') || 
                             (status === 'DUE' && v.currentDue > 0) || 
                             (status === 'PAID' && v.currentDue <= 0);
        
        const hasActivity = v.displayBill > 0 || v.displayPaidCash > 0 || v.displayPaidOwner > 0;
        
        return matchesSearch && matchesStatus && (search !== "" || hasActivity || status !== 'ALL');
    });

    renderTable(filteredData);
}

function exportToExcel() {
    const fromDate = document.getElementById('fromDate').value;
    const toDate = document.getElementById('toDate').value;
    let csv = `Vendor History Report (${fromDate} to ${toDate})\n`;
    csv += "Vendor Name,Category,Last Date,Period Bill,Paid (Cash),Paid (Owner),Current Due\n";
    
    allVendorData.forEach(v => {
        const filteredLedger = v.ledger.filter(l => {
            if (!fromDate || !toDate) return true;
            return l.t_date >= fromDate && l.t_date <= toDate;
        });

        let periodBill = 0, periodPaidCash = 0, periodPaidOwner = 0;
        filteredLedger.forEach(l => {
            if (l.t_type === 'BILL') periodBill += l.amount;
            else if (l.t_type === 'PAYMENT') periodPaidCash += l.amount;
            else if (l.t_type === 'PAYMENT_OWNER') periodPaidOwner += l.amount;
        });

        let totalBill = v.opening_due, totalPaid = 0;
        v.ledger.forEach(l => {
            if (l.t_type === 'BILL') totalBill += l.amount;
            else if (l.t_type === 'PAYMENT' || l.t_type === 'PAYMENT_OWNER') totalPaid += l.amount;
        });

        csv += `${v.name},${v.category},${v.lastDate},${periodBill},${periodPaidCash},${periodPaidOwner},${totalBill - totalPaid}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `Vendor_Report_${fromDate}_to_${toDate}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}
