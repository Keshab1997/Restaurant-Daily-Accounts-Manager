let currentUser = null;
let allTallyData = [];

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('filterMonth').value = currentMonth;

    loadFullHistory();
};

async function loadFullHistory() {
    const monthInput = document.getElementById('filterMonth').value;
    if (!monthInput) return;

    const [year, month] = monthInput.split('-');
    
    const startDate = `${year}-${month}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${month}-${lastDay}`;

    const tbody = document.getElementById('tallyHistoryBody');
    const mobileList = document.getElementById('mobileTallyList');
    
    tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px;">Loading History...</td></tr>';
    mobileList.innerHTML = '';

    const { data, error } = await _supabase.from('cash_tally')
        .select('*')
        .eq('user_id', currentUser.id)
        .gte('report_date', startDate)
        .lte('report_date', endDate)
        .order('report_date', { ascending: false });

    if (error) {
        console.error("Supabase Error:", error);
        tbody.innerHTML = `<tr><td colspan="7" style="text-align:center; color:red;">Error: ${error.message}</td></tr>`;
        return;
    }

    allTallyData = data || [];
    renderTallyTable(allTallyData);
}

function renderTallyTable(data) {
    const tbody = document.getElementById('tallyHistoryBody');
    const mobileList = document.getElementById('mobileTallyList');
    tbody.innerHTML = '';
    mobileList.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" style="text-align:center; padding:30px; color:#94a3b8;">No records found for this month.</td></tr>';
        mobileList.innerHTML = '<p style="text-align:center; padding:20px; color:#94a3b8;">No records found.</p>';
        return;
    }

    data.forEach(row => {
        let statusText = "PERFECT";
        let badgeClass = "badge-perfect";
        
        if (row.difference < 0) {
            statusText = "SHORTAGE";
            badgeClass = "badge-shortage";
        } else if (row.difference > 0) {
            statusText = "EXTRA";
            badgeClass = "badge-extra";
        }

        const diffColor = row.difference < 0 ? '#ef4444' : (row.difference > 0 ? '#2563eb' : '#1e293b');

        tbody.innerHTML += `
            <tr>
                <td><b>${row.report_date}</b></td>
                <td>₹${row.total_physical.toLocaleString('en-IN')}</td>
                <td>₹${row.system_balance.toLocaleString('en-IN')}</td>
                <td style="color:${diffColor}; font-weight:bold;">₹${row.difference.toLocaleString('en-IN')}</td>
                <td style="color:#991b1b; font-weight:bold;">₹${(row.cumulative_shortage || 0).toLocaleString('en-IN')}</td>
                <td><span class="status-badge ${badgeClass}">${statusText}</span></td>
                <td>
                    <button class="btn-delete" onclick="deleteTally('${row.id}')"><i class="ri-delete-bin-line"></i></button>
                </td>
            </tr>
        `;

        mobileList.innerHTML += `
            <div class="tally-card-mob">
                <div class="mob-row-top">
                    <span class="mob-date">${row.report_date}</span>
                    <span class="status-badge ${badgeClass}">${statusText}</span>
                </div>
                <div class="mob-stats">
                    <div class="stat-box"><span>Physical</span><strong>₹${row.total_physical.toLocaleString('en-IN')}</strong></div>
                    <div class="stat-box"><span>System</span><strong>₹${row.system_balance.toLocaleString('en-IN')}</strong></div>
                    <div class="stat-box"><span>Difference</span><strong style="color:${diffColor}">₹${row.difference.toLocaleString('en-IN')}</strong></div>
                    <div class="stat-box"><span>Cumul. Short</span><strong style="color:#991b1b">₹${(row.cumulative_shortage || 0).toLocaleString('en-IN')}</strong></div>
                </div>
                <div style="text-align:right; margin-top:10px;">
                    <button class="btn-delete" onclick="deleteTally('${row.id}')" style="background:none; border:none; color:#ef4444; cursor:pointer;"><i class="ri-delete-bin-line"></i> Delete</button>
                </div>
            </div>
        `;
    });
}

function filterTally() {
    const searchTerm = document.getElementById('searchTally').value.trim();
    if (!searchTerm) {
        renderTallyTable(allTallyData);
        return;
    }

    const filtered = allTallyData.filter(row => row.report_date.includes(searchTerm));
    renderTallyTable(filtered);
}

async function deleteTally(id) {
    if (!confirm("Are you sure you want to delete this tally record?")) return;

    const { error } = await _supabase.from('cash_tally').delete().eq('id', id);
    if (error) {
        alert("Error deleting record: " + error.message);
    } else {
        loadFullHistory();
    }
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}
