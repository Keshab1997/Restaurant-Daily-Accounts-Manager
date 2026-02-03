let currentUser = null;
let rawSales = [];
let rawExpenses = [];
let rawSalaries = [];
let customCategories = [];

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;

    const now = new Date();
    document.getElementById('plMonth').value = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

    await loadCategories();
    await loadPLData();
};

async function loadCategories() {
    const { data } = await _supabase.from('expense_categories').select('*').eq('user_id', currentUser.id);
    customCategories = data || [];
    renderCustomInputs();
}

function renderCustomInputs() {
    const container = document.getElementById('customExpensesList');
    container.innerHTML = '';
    customCategories.forEach(cat => {
        container.innerHTML += `
            <div class="pl-item">
                <span>${cat.name}</span>
                <input type="number" id="custom-${cat.id}" value="0" oninput="calculatePL()" class="inline-input custom-exp-val">
            </div>
        `;
    });
}

async function loadPLData() {
    const month = document.getElementById('plMonth').value; // YYYY-MM
    const startDate = `${month}-01`;
    const endDate = `${month}-31`;

    // 1. Fetch Sales
    const { data: sales } = await _supabase.from('sales').select('*').eq('user_id', currentUser.id).gte('report_date', startDate).lte('report_date', endDate);
    rawSales = sales || [];

    // 2. Fetch Cash Expenses
    const { data: exps } = await _supabase.from('expenses').select('*').eq('user_id', currentUser.id).eq('payment_source', 'CASH').gte('report_date', startDate).lte('report_date', endDate);
    rawExpenses = exps || [];

    // 3. Fetch Salaries
    const { data: sals } = await _supabase.from('salary_records').select('*').eq('user_id', currentUser.id).eq('month_year', month);
    rawSalaries = sals || [];

    updateUI();
}

function updateUI() {
    let cashSale = 0, cardSale = 0, onlineSale = 0;
    rawSales.forEach(s => {
        if(s.sale_type === 'CASH') cashSale += s.amount;
        else if(s.sale_type === 'CARD') cardSale += s.amount;
        else if(s.sale_type === 'SWIGGY' || s.sale_type === 'ZOMATO') onlineSale += s.amount;
    });

    let cashExp = rawExpenses.reduce((sum, e) => sum + e.amount, 0);
    let salaryExp = rawSalaries.reduce((sum, s) => sum + s.net_salary, 0);

    document.getElementById('valCashSale').innerText = `₹${cashSale.toLocaleString('en-IN')}`;
    document.getElementById('valCardSale').innerText = `₹${cardSale.toLocaleString('en-IN')}`;
    document.getElementById('valOnlineSale').innerText = `₹${onlineSale.toLocaleString('en-IN')}`;
    document.getElementById('valCashExp').innerText = `₹${cashExp.toLocaleString('en-IN')}`;
    document.getElementById('valSalary').innerText = `₹${salaryExp.toLocaleString('en-IN')}`;

    calculatePL();
}

function calculatePL() {
    // Revenue Calculation
    const cashSale = parseFloat(document.getElementById('valCashSale').innerText.replace('₹', '').replace(/,/g, '')) || 0;
    const cardSale = parseFloat(document.getElementById('valCardSale').innerText.replace('₹', '').replace(/,/g, '')) || 0;
    const onlineSale = parseFloat(document.getElementById('valOnlineSale').innerText.replace('₹', '').replace(/,/g, '')) || 0;
    
    const cardComm = parseFloat(document.getElementById('cardComm').value) || 0;
    const onlineComm = parseFloat(document.getElementById('onlineComm').value) || 0;
    const stock = parseFloat(document.getElementById('stockAmt').value) || 0;

    const cardNet = cardSale - (cardSale * cardComm / 100);
    const onlineNet = onlineSale - (onlineSale * onlineComm / 100);

    document.getElementById('cardNet').innerText = `Net: ₹${cardNet.toLocaleString('en-IN')}`;
    document.getElementById('onlineNet').innerText = `Net: ₹${onlineNet.toLocaleString('en-IN')}`;

    const totalRev = cashSale + cardNet + onlineNet + stock;
    document.getElementById('totalRevenue').innerText = `₹${totalRev.toLocaleString('en-IN')}`;

    // Expense Calculation
    const cashExp = parseFloat(document.getElementById('valCashExp').innerText.replace('₹', '').replace(/,/g, '')) || 0;
    const salaryExp = parseFloat(document.getElementById('valSalary').innerText.replace('₹', '').replace(/,/g, '')) || 0;
    const rent = parseFloat(document.getElementById('expRent').value) || 0;
    const gst = parseFloat(document.getElementById('expGST').value) || 0;

    let customTotal = 0;
    document.querySelectorAll('.custom-exp-val').forEach(input => {
        customTotal += parseFloat(input.value) || 0;
    });

    const totalExp = cashExp + salaryExp + rent + gst + customTotal;
    document.getElementById('totalExpenses').innerText = `₹${totalExp.toLocaleString('en-IN')}`;

    // Final Result
    const final = totalRev - totalExp;
    const finalBox = document.getElementById('finalBox');
    const finalAmt = document.getElementById('finalAmount');
    const label = document.getElementById('resultLabel');

    finalAmt.innerText = `₹${Math.abs(final).toLocaleString('en-IN')}`;
    
    if(final >= 0) {
        finalBox.className = 'final-pl-box profit';
        label.innerText = "NET PROFIT";
    } else {
        finalBox.className = 'final-pl-box loss';
        label.innerText = "NET LOSS";
    }
}

// Modal Functions
function showAddCategory() { document.getElementById('catModal').classList.remove('hidden'); }
function closeModal() { 
    document.getElementById('catModal').classList.add('hidden'); 
    document.getElementById('newCatName').value = '';
}

async function saveCategory() {
    const name = document.getElementById('newCatName').value.trim();
    if(!name) return alert("Category name required");
    await _supabase.from('expense_categories').insert({ user_id: currentUser.id, name });
    closeModal();
    await loadCategories();
}

async function logout() { await _supabase.auth.signOut(); window.location.href = 'index.html'; }
