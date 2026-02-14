let currentUser = null;
let categories = { REVENUE: [], EXPENSE: [] };
let restaurantName = "RestroManager";
let signatureName = "Authorized Person";

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('plMonth').value = currentMonth;

    const { data: profile } = await _supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    if(profile) {
        restaurantName = profile.restaurant_name || "RestroManager";
        signatureName = profile.authorized_signature || restaurantName;
        document.getElementById('sideNavName').innerText = restaurantName;
    }

    await loadCategories();
    await loadPLData();
};

async function loadCategories() {
    const { data } = await _supabase.from('pl_categories').select('*').eq('user_id', currentUser.id);
    
    if (!data || data.length === 0) {
        const defaults = [
            { name: 'Cash Sale (Monthly)', type: 'REVENUE', is_special: false },
            { name: 'Card / UPI Sale', type: 'REVENUE', is_special: true, special_key: 'CARD', default_comm: 2 },
            { name: 'Online (Swiggy/Zomato)', type: 'REVENUE', is_special: true, special_key: 'ONLINE', default_comm: 25 },
            { name: 'Stock Amount (Closing)', type: 'REVENUE', is_special: false },
            { name: 'Total Expenses (All)', type: 'EXPENSE', is_special: false },
            { name: 'Staff Salaries (Total Net)', type: 'EXPENSE', is_special: false },
            { name: 'Shop Rent', type: 'EXPENSE', is_special: false },
            { name: 'GST / Taxes', type: 'EXPENSE', is_special: false }
        ];
        for (let d of defaults) {
            await _supabase.from('pl_categories').insert({ ...d, user_id: currentUser.id });
        }
        return loadCategories();
    }

    categories.REVENUE = data.filter(c => c.type === 'REVENUE');
    categories.EXPENSE = data.filter(c => c.type === 'EXPENSE');
    renderAllItems();
}

function renderAllItems() {
    const revList = document.getElementById('revenueList');
    const expList = document.getElementById('expenseList');
    revList.innerHTML = '';
    expList.innerHTML = '';

    categories.REVENUE.forEach(cat => {
        revList.innerHTML += cat.is_special ? renderSpecialItem(cat) : renderNormalItem(cat);
    });

    categories.EXPENSE.forEach(cat => {
        expList.innerHTML += renderNormalItem(cat);
    });
}

function renderNormalItem(cat) {
    return `
        <div class="pl-item">
            <span>${cat.name}</span>
            <div class="item-controls">
                <input type="number" id="val-${cat.id}" value="0" oninput="calculatePL()" class="inline-input ${cat.type.toLowerCase()}-input" data-id="${cat.id}">
                <button class="btn-del-item" onclick="deleteCategory('${cat.id}')"><i class="ri-delete-bin-line"></i></button>
            </div>
        </div>
    `;
}

function renderSpecialItem(cat) {
    const commDefault = cat.default_comm || 0;
    return `
        <div class="pl-item-complex">
            <div class="main-row">
                <span>${cat.name}</span>
                <div class="item-controls">
                    <input type="number" id="val-${cat.id}" value="0" oninput="calculatePL()" class="inline-input ${cat.type.toLowerCase()}-input special-base" data-id="${cat.id}">
                    <button class="btn-del-item" onclick="deleteCategory('${cat.id}')"><i class="ri-delete-bin-line"></i></button>
                </div>
            </div>
            <div class="sub-row">
                <label>Comm. %</label>
                <input type="number" id="comm-${cat.id}" value="${commDefault}" oninput="calculatePL()" class="special-comm">
                <small id="net-${cat.id}">Net: ₹0</small>
            </div>
        </div>
    `;
}

async function loadPLData() {
    const month = document.getElementById('plMonth').value;
    showToast(`Fetching data for ${month}...`, "info");
    
    const [year, monthNum] = month.split('-');
    const startDate = `${month}-01`;
    const lastDay = new Date(year, monthNum, 0).getDate();
    const endDate = `${month}-${lastDay}`;

    const { data: sales } = await _supabase.from('sales').select('amount, sale_type').eq('user_id', currentUser.id).gte('report_date', startDate).lte('report_date', endDate);
    const { data: expenses } = await _supabase.from('expenses').select('amount').eq('user_id', currentUser.id).gte('report_date', startDate).lte('report_date', endDate);
    const { data: allStaff } = await _supabase.from('staff').select('id, basic_salary').eq('user_id', currentUser.id);
    const { data: salaryRecs } = await _supabase.from('salary_records').select('staff_id, net_salary').eq('user_id', currentUser.id).eq('month_year', month);
    const { data: savedData } = await _supabase.from('pl_monthly_data').select('*').eq('user_id', currentUser.id).eq('month_year', month).maybeSingle();

    let autoCash = 0, autoCard = 0, autoOnline = 0;
    if(sales) {
        sales.forEach(s => {
            if(s.sale_type === 'CASH') autoCash += s.amount;
            else if(s.sale_type === 'CARD') autoCard += s.amount;
            else autoOnline += s.amount;
        });
    }
    let autoTotalExp = expenses ? expenses.reduce((sum, e) => sum + e.amount, 0) : 0;
    let autoSalary = 0;
    if(allStaff) {
        allStaff.forEach(s => {
            const rec = salaryRecs ? salaryRecs.find(r => r.staff_id === s.id) : null;
            autoSalary += rec ? rec.net_salary : s.basic_salary;
        });
    }

    categories.REVENUE.concat(categories.EXPENSE).forEach(cat => {
        const input = document.getElementById(`val-${cat.id}`);
        if(!input) return;

        if(savedData && savedData.values && savedData.values[cat.id] !== undefined) {
            input.value = savedData.values[cat.id];
            if(cat.is_special) document.getElementById(`comm-${cat.id}`).value = savedData.commissions[cat.id] || 0;
        } else {
            if(cat.name.includes('Cash Sale')) input.value = autoCash;
            else if(cat.special_key === 'CARD') input.value = autoCard;
            else if(cat.special_key === 'ONLINE') input.value = autoOnline;
            else if(cat.name.includes('Total Expenses')) input.value = autoTotalExp;
            else if(cat.name.includes('Staff Salaries')) input.value = autoSalary;
            else input.value = 0;
        }
    });

    calculatePL();
}

function calculatePL() {
    let totalRev = 0;
    categories.REVENUE.forEach(cat => {
        const base = parseFloat(document.getElementById(`val-${cat.id}`).value) || 0;
        if(cat.is_special) {
            const comm = parseFloat(document.getElementById(`comm-${cat.id}`).value) || 0;
            const net = base - (base * comm / 100);
            document.getElementById(`net-${cat.id}`).innerText = `Net: ₹${Math.round(net).toLocaleString('en-IN')}`;
            totalRev += net;
        } else {
            totalRev += base;
        }
    });
    document.getElementById('totalRevenue').innerText = `₹${Math.round(totalRev).toLocaleString('en-IN')}`;

    let totalExp = 0;
    categories.EXPENSE.forEach(cat => {
        totalExp += parseFloat(document.getElementById(`val-${cat.id}`).value) || 0;
    });
    document.getElementById('totalExpenses').innerText = `₹${Math.round(totalExp).toLocaleString('en-IN')}`;

    const final = totalRev - totalExp;
    const finalBox = document.getElementById('finalBox');
    const finalAmt = document.getElementById('finalAmount');
    const label = document.getElementById('resultLabel');

    finalAmt.innerText = `₹${Math.abs(Math.round(final)).toLocaleString('en-IN')}`;
    if(final >= 0) { finalBox.className = 'final-pl-box profit'; label.innerText = "NET PROFIT"; }
    else { finalBox.className = 'final-pl-box loss'; label.innerText = "NET LOSS"; }
}

async function saveMonthlyData() {
    const btn = document.querySelector('.btn-save-pl');
    const originalHTML = btn.innerHTML;
    const month = document.getElementById('plMonth').value;

    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Saving...';

    const values = {};
    const commissions = {};

    categories.REVENUE.concat(categories.EXPENSE).forEach(cat => {
        values[cat.id] = parseFloat(document.getElementById(`val-${cat.id}`).value) || 0;
        if(cat.is_special) commissions[cat.id] = parseFloat(document.getElementById(`comm-${cat.id}`).value) || 0;
    });

    try {
        const { error } = await _supabase.from('pl_monthly_data').upsert({
            user_id: currentUser.id,
            month_year: month,
            values,
            commissions
        }, { onConflict: 'user_id, month_year' });

        if(error) throw error;
        showToast(`P&L data for ${month} saved successfully!`, "success");
    } catch (error) {
        showToast("Error: " + error.message, "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

function showAddModal(type) {
    document.getElementById('newCatType').value = type;
    document.getElementById('modalTitle').innerText = `Add New ${type}`;
    document.getElementById('commSection').style.display = (type === 'REVENUE') ? 'block' : 'none';
    document.getElementById('hasComm').checked = false;
    document.getElementById('commInputGroup').style.display = 'none';
    document.getElementById('catModal').classList.remove('hidden');
}

function toggleCommInput() {
    const isChecked = document.getElementById('hasComm').checked;
    document.getElementById('commInputGroup').style.display = isChecked ? 'block' : 'none';
}

function closeModal() { document.getElementById('catModal').classList.add('hidden'); document.getElementById('newCatName').value = ''; }

async function saveCategory() {
    const name = document.getElementById('newCatName').value.trim();
    const type = document.getElementById('newCatType').value;
    const isSpecial = document.getElementById('hasComm').checked;
    const defaultComm = parseFloat(document.getElementById('defaultComm').value) || 0;

    if(!name) return showToast("Category name is required", "error");

    try {
        await _supabase.from('pl_categories').insert({ 
            user_id: currentUser.id, 
            name, 
            type, 
            is_special: isSpecial,
            default_comm: defaultComm,
            special_key: isSpecial ? 'CUSTOM' : null
        });
        
        showToast(`${type} category added!`, "success");
        closeModal();
        await loadCategories();
        await loadPLData();
    } catch (err) {
        showToast("Failed to add category", "error");
    }
}

async function deleteCategory(id) {
    if(!confirm("Are you sure you want to remove this item?")) return;
    
    try {
        await _supabase.from('pl_categories').delete().eq('id', id);
        showToast("Category removed", "success");
        await loadCategories();
        await loadPLData();
    } catch (err) {
        showToast("Error deleting category", "error");
    }
}

async function generatePLImage() {
    const btn = document.querySelector('.btn-share-pl');
    const originalHTML = btn.innerHTML;

    btn.disabled = true;
    btn.innerHTML = '<i class="ri-loader-4-line spin"></i> Generating...';
    showToast("Generating monthly P&L report...", "info");

    try {
        document.getElementById('tempRestroName').innerText = restaurantName;
        document.getElementById('tempMonthTitle').innerText = document.getElementById('plMonth').value;
        document.getElementById('tempSignature').innerText = signatureName;

        const tempContent = document.getElementById('tempContent');
        tempContent.innerHTML = document.getElementById('plCaptureArea').innerHTML;

        tempContent.querySelectorAll('.btn-del-item, .btn-add-cat').forEach(b => b.remove());
        
        tempContent.querySelectorAll('input').forEach(input => {
            const originalInput = document.getElementById(input.id);
            const val = originalInput ? originalInput.value : 0;
            const span = document.createElement('b');
            span.innerText = input.classList.contains('special-comm') ? val + '%' : `₹${parseFloat(val).toLocaleString('en-IN')}`;
            input.parentNode.replaceChild(span, input);
        });

        const isProfit = document.getElementById('finalBox').classList.contains('profit');
        const tempFinalBox = document.getElementById('tempFinalResult');
        tempFinalBox.style.background = isProfit ? '#d1fae5' : '#fee2e2';
        tempFinalBox.style.color = isProfit ? '#059669' : '#ef4444';
        document.getElementById('tempResultLabel').innerText = document.getElementById('resultLabel').innerText;
        document.getElementById('tempFinalAmount').innerText = document.getElementById('finalAmount').innerText;

        const canvas = await html2canvas(document.getElementById('plImageTemplate'), { scale: 2 });
        const link = document.createElement('a');
        link.download = `PL_Report.png`;
        link.href = canvas.toDataURL();
        link.click();

        showToast("P&L Report generated successfully!", "success");
    } catch (err) {
        console.error(err);
        showToast("Failed to generate report image", "error");
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalHTML;
    }
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }