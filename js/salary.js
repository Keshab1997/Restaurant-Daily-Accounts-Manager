let currentUser = null;
let staffList = [];
let salaryRecords = [];
let restaurantName = "RestroManager";
let signatureName = "Authorized Person";

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;

    // Load Profile Settings
    const { data: profile } = await _supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    if(profile) {
        restaurantName = profile.restaurant_name || "RestroManager";
        signatureName = profile.authorized_signature || profile.restaurant_name || "Authorized Person";
        document.getElementById('sideNavName').innerText = restaurantName;
    }

    // Set default month to current
    const now = new Date();
    const monthStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('salaryMonth').value = monthStr;

    await loadStaff();
};

async function loadStaff() {
    const { data } = await _supabase.from('staff').select('*').eq('user_id', currentUser.id).order('name');
    staffList = data || [];
    await loadSalarySheet();
}

async function loadSalarySheet() {
    const month = document.getElementById('salaryMonth').value;
    const { data } = await _supabase.from('salary_records').select('*').eq('user_id', currentUser.id).eq('month_year', month);
    salaryRecords = data || [];
    renderTable();
}

function renderTable() {
    const tbody = document.getElementById('salaryTableBody');
    const mobileList = document.getElementById('mobileSalaryList');
    
    tbody.innerHTML = '';
    if(mobileList) mobileList.innerHTML = '';
    
    let tBasic = 0, tCut = 0, tNet = 0;

    if(staffList.length === 0 && mobileList) {
        mobileList.innerHTML = '<p style="text-align:center; padding:20px; color:#64748b;">No staff added yet.</p>';
    }

    staffList.forEach((staff, index) => {
        const record = salaryRecords.find(r => r.staff_id === staff.id) || { absent_days: 0, salary_cut: 0, net_salary: staff.basic_salary, status: 'UNPAID' };
        
        tBasic += staff.basic_salary;
        tCut += record.salary_cut;
        tNet += record.net_salary;

        // Render Desktop Table Row
        tbody.innerHTML += `
            <tr>
                <td>${index + 1}</td>
                <td><b>${staff.name}</b></td>
                <td>${staff.designation || '-'}</td>
                <td>₹${staff.basic_salary.toLocaleString('en-IN')}</td>
                <td><input type="number" id="absent-${staff.id}" value="${record.absent_days}" onchange="updateRow('${staff.id}', this.value, ${staff.basic_salary})"></td>
                <td id="cut-${staff.id}">₹${record.salary_cut.toLocaleString('en-IN')}</td>
                <td id="net-${staff.id}" style="font-weight:800;">₹${record.net_salary.toLocaleString('en-IN')}</td>
                <td>
                    <select id="status-${staff.id}" class="status-select ${record.status.toLowerCase()}">
                        <option value="UNPAID" ${record.status === 'UNPAID' ? 'selected' : ''}>UNPAID</option>
                        <option value="PAID" ${record.status === 'PAID' ? 'selected' : ''}>PAID</option>
                    </select>
                </td>
                <td>
                    <div style="display:flex; gap:5px;">
                        <button class="btn-save-row" onclick="saveRow('${staff.id}')" title="Save"><i class="ri-save-line"></i></button>
                        <button class="btn-delete-row" onclick="deleteStaff('${staff.id}')" title="Delete Staff" style="background:#fee2e2; color:#ef4444; border:1px solid #fecaca; padding:5px 8px; border-radius:5px; cursor:pointer;"><i class="ri-delete-bin-line"></i></button>
                    </div>
                </td>
            </tr>
        `;
        
        // Render Mobile Card
        if(mobileList) {
            mobileList.innerHTML += `
                <div class="salary-card">
                    <div class="sc-header">
                        <div class="sc-name">
                            <h3>${staff.name}</h3>
                            <span class="sc-desig">${staff.designation || 'Staff'}</span>
                        </div>
                        <div class="sc-basic">
                            <small>Basic Salary</small>
                            <strong>₹${staff.basic_salary.toLocaleString('en-IN')}</strong>
                        </div>
                    </div>
                    <div class="sc-body">
                        <div class="sc-input-grp">
                            <label>Absent Days</label>
                            <input type="number" id="absent-mob-${staff.id}" value="${record.absent_days}" onchange="updateRow('${staff.id}', this.value, ${staff.basic_salary}, true)">
                        </div>
                        <div class="sc-input-grp">
                            <label>Salary Cut</label>
                            <span id="cut-mob-${staff.id}" class="sc-cut-val">₹${record.salary_cut.toLocaleString('en-IN')}</span>
                        </div>
                    </div>
                    <div class="sc-net">
                        <span>NET PAYABLE SALARY</span>
                        <h2 id="net-mob-${staff.id}">₹${record.net_salary.toLocaleString('en-IN')}</h2>
                    </div>
                    <div class="sc-footer">
                        <select id="status-mob-${staff.id}" class="status-select ${record.status.toLowerCase()}">
                            <option value="UNPAID" ${record.status === 'UNPAID' ? 'selected' : ''}>UNPAID</option>
                            <option value="PAID" ${record.status === 'PAID' ? 'selected' : ''}>PAID</option>
                        </select>
                        <button class="btn-save-row" onclick="saveRow('${staff.id}', true)"><i class="ri-save-line"></i> Save</button>
                        <button class="btn-delete-row" onclick="deleteStaff('${staff.id}')" style="background:#fee2e2; color:#ef4444; border:1px solid #fecaca; padding:10px 15px; border-radius:8px; cursor:pointer;"><i class="ri-delete-bin-line"></i></button>
                    </div>
                </div>
            `;
        }
    });

    document.getElementById('totalBasic').innerText = `₹${tBasic.toLocaleString('en-IN')}`;
    document.getElementById('totalCut').innerText = `₹${tCut.toLocaleString('en-IN')}`;
    document.getElementById('totalNet').innerText = `₹${tNet.toLocaleString('en-IN')}`;
}

function updateRow(staffId, absent, basic, isMobile = false) {
    const cut = Math.round((basic / 30) * absent);
    const net = basic - cut;
    
    // Update Desktop
    const cutEl = document.getElementById(`cut-${staffId}`);
    const netEl = document.getElementById(`net-${staffId}`);
    const absInput = document.getElementById(`absent-${staffId}`);
    
    if(cutEl) cutEl.innerText = `₹${cut.toLocaleString('en-IN')}`;
    if(netEl) netEl.innerText = `₹${net.toLocaleString('en-IN')}`;
    if(absInput && isMobile) absInput.value = absent;
    
    // Update Mobile
    const cutMob = document.getElementById(`cut-mob-${staffId}`);
    const netMob = document.getElementById(`net-mob-${staffId}`);
    const absMob = document.getElementById(`absent-mob-${staffId}`);
    
    if(cutMob) cutMob.innerText = `₹${cut.toLocaleString('en-IN')}`;
    if(netMob) netMob.innerText = `₹${net.toLocaleString('en-IN')}`;
    if(absMob && !isMobile) absMob.value = absent;
}

async function saveRow(staffId, isMobile = false) {
    const month = document.getElementById('salaryMonth').value;
    const staff = staffList.find(s => s.id === staffId);
    
    const absentId = isMobile ? `absent-mob-${staffId}` : `absent-${staffId}`;
    const statusId = isMobile ? `status-mob-${staffId}` : `status-${staffId}`;
    
    const absent = parseFloat(document.getElementById(absentId).value) || 0;
    const status = document.getElementById(statusId).value;
    
    const cut = Math.round((staff.basic_salary / 30) * absent);
    const net = staff.basic_salary - cut;

    const { error } = await _supabase.from('salary_records').upsert({
        user_id: currentUser.id,
        staff_id: staffId,
        month_year: month,
        absent_days: absent,
        salary_cut: cut,
        net_salary: net,
        status: status
    }, { onConflict: 'staff_id, month_year' });

    if(error) alert(error.message);
    else {
        alert("Saved!");
        loadSalarySheet();
    }
}

async function deleteStaff(id) {
    if(!confirm("Are you sure you want to delete this staff? All their salary records will be removed.")) return;
    const { error } = await _supabase.from('staff').delete().eq('id', id);
    if(error) alert(error.message);
    else loadStaff();
}

async function showHistoryModal() {
    const { data } = await _supabase.from('salary_records').select('month_year').eq('user_id', currentUser.id);
    const listContainer = document.getElementById('historyList');
    listContainer.innerHTML = '';

    if(data && data.length > 0) {
        const uniqueMonths = [...new Set(data.map(r => r.month_year))].sort().reverse();
        
        uniqueMonths.forEach(month => {
            const dateObj = new Date(month + "-01");
            const monthName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });
            
            const item = document.createElement('div');
            item.className = 'history-item';
            item.innerHTML = `
                <div class="history-info">
                    <i class="ri-calendar-check-line"></i>
                    <span>${monthName}</span>
                </div>
                <i class="ri-arrow-right-s-line"></i>
            `;
            item.onclick = () => loadMonthFromHistory(month);
            listContainer.appendChild(item);
        });
    } else {
        listContainer.innerHTML = '<p style="text-align:center; color:#94a3b8; padding:20px;">No past records found.</p>';
    }
    document.getElementById('historyModal').classList.remove('hidden');
}

function loadMonthFromHistory(month) {
    document.getElementById('salaryMonth').value = month;
    loadSalarySheet();
    closeHistoryModal();
}

function closeHistoryModal() { document.getElementById('historyModal').classList.add('hidden'); }

function showStaffModal() { document.getElementById('staffModal').classList.remove('hidden'); }
function closeModal() { 
    document.getElementById('staffModal').classList.add('hidden'); 
    document.getElementById('staffName').value = '';
    document.getElementById('staffDesignation').value = '';
    document.getElementById('staffBasic').value = '';
}

async function saveStaff() {
    const name = document.getElementById('staffName').value.trim();
    const desig = document.getElementById('staffDesignation').value.trim();
    const basic = parseFloat(document.getElementById('staffBasic').value);

    if(!name || !basic) return alert("Name and Basic Salary required");

    await _supabase.from('staff').insert({ user_id: currentUser.id, name, designation: desig, basic_salary: basic });
    closeModal();
    loadStaff();
}

async function generateSalaryImage() {
    const monthInput = document.getElementById('salaryMonth').value;
    const dateObj = new Date(monthInput + "-01");
    const monthName = dateObj.toLocaleString('default', { month: 'long' }).toUpperCase();
    const year = dateObj.getFullYear();

    document.getElementById('tempRestroName').innerText = restaurantName;
    document.getElementById('tempMonthTitle').innerText = `Salary Sheet For The Month Of ${monthName} ${year}`;
    document.getElementById('tempSignature').innerText = signatureName;

    const tempBody = document.getElementById('tempTableBody');
    tempBody.innerHTML = '';
    let tBasic = 0, tCut = 0, tNet = 0;

    staffList.forEach((staff, index) => {
        const record = salaryRecords.find(r => r.staff_id === staff.id) || { absent_days: 0, salary_cut: 0, net_salary: staff.basic_salary, status: 'UNPAID' };
        tBasic += staff.basic_salary; tCut += record.salary_cut; tNet += record.net_salary;

        const statusColor = record.status === 'PAID' ? '#059669' : '#ef4444';

        tempBody.innerHTML += `
            <tr>
                <td style="border: 1px solid #cbd5e1; padding: 10px; text-align:center;">${index + 1}</td>
                <td style="border: 1px solid #cbd5e1; padding: 10px;">${staff.name}</td>
                <td style="border: 1px solid #cbd5e1; padding: 10px;">${staff.designation || '-'}</td>
                <td style="border: 1px solid #cbd5e1; padding: 10px;">₹${staff.basic_salary.toLocaleString('en-IN')}</td>
                <td style="border: 1px solid #cbd5e1; padding: 10px; text-align:center;">${record.absent_days}</td>
                <td style="border: 1px solid #cbd5e1; padding: 10px;">₹${record.salary_cut.toLocaleString('en-IN')}</td>
                <td style="border: 1px solid #cbd5e1; padding: 10px; font-weight:bold;">₹${record.net_salary.toLocaleString('en-IN')}</td>
                <td style="border: 1px solid #cbd5e1; padding: 10px; text-align:center; font-weight:bold; color:${statusColor};">${record.status}</td>
            </tr>
        `;
    });

    document.getElementById('tempTotalBasic').innerText = `₹${tBasic.toLocaleString('en-IN')}`;
    document.getElementById('tempTotalCut').innerText = `₹${tCut.toLocaleString('en-IN')}`;
    document.getElementById('tempTotalNet').innerText = `₹${tNet.toLocaleString('en-IN')}`;

    const element = document.getElementById('salaryImageTemplate');
    html2canvas(element, { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `Salary_Sheet_${monthInput}.png`;
        link.href = canvas.toDataURL();
        link.click();
    });
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }
