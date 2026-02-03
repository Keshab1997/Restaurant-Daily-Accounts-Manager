let currentUser = null;
let customCategories = [];
let restaurantName = "RestroManager";
let signatureName = "Authorized Person";

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;

    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('plMonth').value = currentMonth;

    // Load Profile Settings
    const { data: profile } = await _supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    if(profile) {
        restaurantName = profile.restaurant_name || "RestroManager";
        signatureName = profile.authorized_signature || profile.restaurant_name || "Authorized Person";
        document.getElementById('sideNavName').innerText = restaurantName;
    }

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
                <input type="number" id="custom-${cat.id}" value="0" oninput="calculatePL()" class="inline-input custom-exp-val" data-id="${cat.id}">
            </div>
        `;
    });
}

async function loadPLData() {
    const month = document.getElementById('plMonth').value; // YYYY-MM
    const year = month.split('-')[0];
    const monthNum = month.split('-')[1];
    
    // তারিখের রেঞ্জ ঠিক করা (১ তারিখ থেকে মাসের শেষ তারিখ)
    const startDate = `${month}-01`;
    const lastDay = new Date(year, monthNum, 0).getDate();
    const endDate = `${month}-${lastDay}`;

    // ১. ডাটাবেস থেকে পুরো মাসের সেলস নিয়ে আসা
    const { data: sales } = await _supabase.from('sales')
        .select('amount, sale_type')
        .eq('user_id', currentUser.id)
        .gte('report_date', startDate)
        .lte('report_date', endDate);

    // ২. ডাটাবেস থেকে পুরো মাসের ক্যাশ খরচ নিয়ে আসা
    const { data: expenses } = await _supabase.from('expenses')
        .select('amount')
        .eq('user_id', currentUser.id)
        .eq('payment_source', 'CASH')
        .gte('report_date', startDate)
        .lte('report_date', endDate);

    // ৩. ডাটাবেস থেকে ওই মাসের স্টাফ স্যালারি নিয়ে আসা
    const { data: salaries } = await _supabase.from('salary_records')
        .select('net_salary')
        .eq('user_id', currentUser.id)
        .eq('month_year', month);

    // ৪. আগে সেভ করা ম্যানুয়াল ডেটা লোড করা
    const { data: savedData } = await _supabase.from('pl_monthly_data')
        .select('*')
        .eq('user_id', currentUser.id)
        .eq('month_year', month)
        .maybeSingle();

    // অটো-ফেচ করা ভ্যালুগুলো ক্যালকুলেট করা
    let autoCashSale = 0, autoCardSale = 0, autoOnlineSale = 0;
    if(sales) {
        sales.forEach(s => {
            if(s.sale_type === 'CASH') autoCashSale += s.amount;
            else if(s.sale_type === 'CARD') autoCardSale += s.amount;
            else if(s.sale_type === 'SWIGGY' || s.sale_type === 'ZOMATO') autoOnlineSale += s.amount;
        });
    }
    let autoCashExp = expenses ? expenses.reduce((sum, e) => sum + e.amount, 0) : 0;
    let autoSalaryExp = salaries ? salaries.reduce((sum, s) => sum + s.net_salary, 0) : 0;

    // UI-তে ভ্যালু বসানো (Priority: Saved Data > Auto Fetched Data)
    if(savedData) {
        document.getElementById('valCashSale').value = savedData.cash_sale_manual || autoCashSale;
        document.getElementById('valCardSale').value = savedData.card_sale_manual || autoCardSale;
        document.getElementById('valOnlineSale').value = savedData.online_sale_manual || autoOnlineSale;
        document.getElementById('valCashExp').value = savedData.cash_exp_manual || autoCashExp;
        document.getElementById('valSalary').value = savedData.salary_manual || autoSalaryExp;
        
        document.getElementById('stockAmt').value = savedData.stock_amount || 0;
        document.getElementById('cardComm').value = savedData.card_commission || 2;
        document.getElementById('onlineComm').value = savedData.online_commission || 25;
        document.getElementById('expRent').value = savedData.rent_amount || 0;
        document.getElementById('expGST').value = savedData.gst_amount || 0;
        
        if(savedData.custom_values) {
            Object.keys(savedData.custom_values).forEach(catId => {
                const input = document.getElementById(`custom-${catId}`);
                if(input) input.value = savedData.custom_values[catId];
            });
        }
    } else {
        // যদি আগে সেভ করা না থাকে, তবে অটো-ফেচ করা ডেটা দেখাবে
        document.getElementById('valCashSale').value = autoCashSale;
        document.getElementById('valCardSale').value = autoCardSale;
        document.getElementById('valOnlineSale').value = autoOnlineSale;
        document.getElementById('valCashExp').value = autoCashExp;
        document.getElementById('valSalary').value = autoSalaryExp;
        
        document.getElementById('stockAmt').value = 0;
        document.getElementById('expRent').value = 0;
        document.getElementById('expGST').value = 0;
        document.querySelectorAll('.custom-exp-val').forEach(i => i.value = 0);
    }

    calculatePL();
}

function calculatePL() {
    const cashSale = parseFloat(document.getElementById('valCashSale').value) || 0;
    const cardSale = parseFloat(document.getElementById('valCardSale').value) || 0;
    const onlineSale = parseFloat(document.getElementById('valOnlineSale').value) || 0;
    
    const cardComm = parseFloat(document.getElementById('cardComm').value) || 0;
    const onlineComm = parseFloat(document.getElementById('onlineComm').value) || 0;
    const stock = parseFloat(document.getElementById('stockAmt').value) || 0;

    const cardNet = cardSale - (cardSale * cardComm / 100);
    const onlineNet = onlineSale - (onlineSale * onlineComm / 100);

    document.getElementById('cardNet').innerText = `Net: ₹${Math.round(cardNet).toLocaleString('en-IN')}`;
    document.getElementById('onlineNet').innerText = `Net: ₹${Math.round(onlineNet).toLocaleString('en-IN')}`;

    const totalRev = cashSale + cardNet + onlineNet + stock;
    document.getElementById('totalRevenue').innerText = `₹${Math.round(totalRev).toLocaleString('en-IN')}`;

    const cashExp = parseFloat(document.getElementById('valCashExp').value) || 0;
    const salaryExp = parseFloat(document.getElementById('valSalary').value) || 0;
    const rent = parseFloat(document.getElementById('expRent').value) || 0;
    const gst = parseFloat(document.getElementById('expGST').value) || 0;

    let customTotal = 0;
    document.querySelectorAll('.custom-exp-val').forEach(input => {
        customTotal += parseFloat(input.value) || 0;
    });

    const totalExp = cashExp + salaryExp + rent + gst + customTotal;
    document.getElementById('totalExpenses').innerText = `₹${Math.round(totalExp).toLocaleString('en-IN')}`;

    const final = totalRev - totalExp;
    const finalBox = document.getElementById('finalBox');
    const finalAmt = document.getElementById('finalAmount');
    const label = document.getElementById('resultLabel');

    finalAmt.innerText = `₹${Math.abs(Math.round(final)).toLocaleString('en-IN')}`;
    
    if(final >= 0) {
        finalBox.className = 'final-pl-box profit';
        label.innerText = "NET PROFIT";
    } else {
        finalBox.className = 'final-pl-box loss';
        label.innerText = "NET LOSS";
    }
}

async function saveMonthlyData() {
    const month = document.getElementById('plMonth').value;
    
    const dataToSave = {
        user_id: currentUser.id,
        month_year: month,
        cash_sale_manual: parseFloat(document.getElementById('valCashSale').value) || 0,
        card_sale_manual: parseFloat(document.getElementById('valCardSale').value) || 0,
        online_sale_manual: parseFloat(document.getElementById('valOnlineSale').value) || 0,
        cash_exp_manual: parseFloat(document.getElementById('valCashExp').value) || 0,
        salary_manual: parseFloat(document.getElementById('valSalary').value) || 0,
        stock_amount: parseFloat(document.getElementById('stockAmt').value) || 0,
        card_commission: parseFloat(document.getElementById('cardComm').value) || 0,
        online_commission: parseFloat(document.getElementById('onlineComm').value) || 0,
        rent_amount: parseFloat(document.getElementById('expRent').value) || 0,
        gst_amount: parseFloat(document.getElementById('expGST').value) || 0,
        custom_values: {}
    };

    document.querySelectorAll('.custom-exp-val').forEach(input => {
        const catId = input.getAttribute('data-id');
        dataToSave.custom_values[catId] = parseFloat(input.value) || 0;
    });

    const { error } = await _supabase.from('pl_monthly_data').upsert(dataToSave, { onConflict: 'user_id, month_year' });

    if(error) alert("Error saving: " + error.message);
    else alert("✅ Monthly P&L Data Saved!");
}

async function generatePLImage() {
    const monthInput = document.getElementById('plMonth').value;
    const dateObj = new Date(monthInput + "-01");
    const monthName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' });

    document.getElementById('tempRestroName').innerText = restaurantName;
    document.getElementById('tempMonthTitle').innerText = monthName;
    document.getElementById('tempSignature').innerText = signatureName;

    const tempContent = document.getElementById('tempContent');
    tempContent.innerHTML = document.getElementById('plCaptureArea').innerHTML;

    // Convert inputs to text for image
    tempContent.querySelectorAll('input').forEach(input => {
        const originalInput = document.getElementById(input.id);
        const val = originalInput ? originalInput.value : input.value;
        const span = document.createElement('b');
        if(input.id === 'cardComm' || input.id === 'onlineComm') span.innerText = val + '%';
        else span.innerText = `₹${(parseFloat(val) || 0).toLocaleString('en-IN')}`;
        span.style.fontSize = '1.1rem';
        span.style.fontWeight = '800';
        input.parentNode.replaceChild(span, input);
    });

    const isProfit = document.getElementById('finalBox').classList.contains('profit');
    const tempFinalBox = document.getElementById('tempFinalResult');
    tempFinalBox.style.background = isProfit ? '#d1fae5' : '#fee2e2';
    tempFinalBox.style.color = isProfit ? '#059669' : '#ef4444';
    tempFinalBox.style.border = isProfit ? '2px solid #059669' : '2px solid #ef4444';
    document.getElementById('tempResultLabel').innerText = document.getElementById('resultLabel').innerText;
    document.getElementById('tempFinalAmount').innerText = document.getElementById('finalAmount').innerText;

    html2canvas(document.getElementById('plImageTemplate'), { scale: 2 }).then(canvas => {
        const link = document.createElement('a');
        link.download = `PL_Report_${monthInput}.png`;
        link.href = canvas.toDataURL();
        link.click();
        
        if (navigator.share) {
            canvas.toBlob(blob => {
                const file = new File([blob], "pl_report.png", { type: "image/png" });
                navigator.share({ files: [file], title: 'Monthly P&L Report' }).catch(console.error);
            });
        }
    });
}

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
