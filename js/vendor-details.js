let currentUser = null;
let vendorId = null;
let vendorData = null;
let ledgerData = [];
let allBills = {};
let restaurantName = "RestroManager";
let signatureName = "Authorized Person";
let editingId = null;
let editingOldType = null;

window.onload = async () => {
    const session = await checkAuth(true);
    currentUser = session.user;
    
    // Load Profile Settings for Invoice
    const { data: profile } = await _supabase.from('profiles').select('*').eq('id', currentUser.id).maybeSingle();
    if(profile) {
        restaurantName = profile.restaurant_name || "RestroManager";
        signatureName = profile.authorized_signature || profile.restaurant_name || "Authorized Person";
        document.getElementById('sideNavName').innerText = restaurantName;
        document.getElementById('invRestroName').innerText = restaurantName;
        document.getElementById('invSignature').innerText = signatureName;
    }

    const params = new URLSearchParams(window.location.search);
    vendorId = params.get('id');
    
    // ডিফল্টভাবে চলতি মাস সেট করা
    const now = new Date();
    const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    document.getElementById('filterMonth').value = currentMonth;
    
    document.getElementById('entryDate').value = new Date().toISOString().split('T')[0];
    loadDetails();
};

function toggleBillSelect() {
    const type = document.getElementById('entryType').value;
    const input = document.getElementById('entryBillNo');
    const select = document.getElementById('selectBillNo');
    const label = document.getElementById('labelBillNo');

    if(type === 'PAYMENT' || type === 'PAYMENT_OWNER') {
        input.style.display = 'none';
        select.style.display = 'block';
        label.innerText = "Select Bill No";
        
        select.innerHTML = '<option value="0">General Payment (No Bill)</option>';
        
        const sortedKeys = Object.keys(allBills).sort((a, b) => parseInt(a) - parseInt(b));
        
        sortedKeys.forEach(bNo => {
            if(bNo !== "0" && allBills[bNo].due > 0) {
                select.innerHTML += `<option value="${bNo}">Bill #${bNo} (Due: ₹${allBills[bNo].due})</option>`;
            }
        });
    } else {
        input.style.display = 'block';
        select.style.display = 'none';
        label.innerText = "Bill Number (Auto)";
        input.setAttribute('readonly', 'true');
        input.style.background = '#f1f5f9';
        input.style.cursor = 'not-allowed';
        generateNextBillNumber();
    }
}

async function loadDetails() {
    try {
        const { data: vendor, error: vendorError } = await _supabase.from('vendors').select('*').eq('id', vendorId).single();
        
        if (vendorError) throw vendorError;
        if (!vendor) {
            showToast("Vendor not found", "error");
            window.location.href = 'vendors.html';
            return;
        }

        vendorData = vendor;
        document.getElementById('vNameTitle').innerText = vendor.name;
        document.getElementById('invVendorName').innerText = vendor.name;

        const { data: calcLedger, error: calcError } = await _supabase.from('vendor_ledger')
            .select('*')
            .eq('vendor_id', vendorId)
            .order('t_date', { ascending: true })
            .order('created_at', { ascending: true });

        if (calcError) throw calcError;

        const { data: displayLedger, error: displayError } = await _supabase.from('vendor_ledger')
            .select('*')
            .eq('vendor_id', vendorId)
            .order('t_date', { ascending: false })
            .order('created_at', { ascending: false });

        if (displayError) throw displayError;

        ledgerData = calcLedger || [];

        const selectedMonth = document.getElementById('filterMonth').value;
        const endOfMonth = selectedMonth + "-31";

        let periodBill = 0;
        let periodPaid = 0;
        let cumulativeBill = vendor.opening_due || 0;
        let cumulativePaid = 0;

        ledgerData.forEach(item => {
            if (item.t_date.startsWith(selectedMonth)) {
                if (item.t_type === 'BILL') periodBill += item.amount;
                else if (item.t_type === 'PAYMENT' || item.t_type === 'PAYMENT_OWNER') periodPaid += item.amount;
            }

            if (item.t_date <= endOfMonth) {
                if (item.t_type === 'BILL') cumulativeBill += item.amount;
                else if (item.t_type === 'PAYMENT' || item.t_type === 'PAYMENT_OWNER') cumulativePaid += item.amount;
            }
        });

        const currentDue = cumulativeBill - cumulativePaid;

        document.getElementById('totBill').innerText = `₹${periodBill.toLocaleString('en-IN')}`;
        document.getElementById('totPaid').innerText = `₹${periodPaid.toLocaleString('en-IN')}`;
        document.getElementById('currDue').innerText = `₹${currentDue.toLocaleString('en-IN')}`;

        allBills = {};
        let billsList = [];

        if(vendor.opening_due > 0) {
            allBills["0"] = { date: 'Initial', total: vendor.opening_due, paid: 0, due: vendor.opening_due };
            billsList.push({ billNo: "0", date: 'Initial', amount: vendor.opening_due });
        }

        if(calcLedger) {
            calcLedger.forEach(l => {
                if(l.t_type === 'BILL') {
                    const bNo = l.bill_no || "0";
                    if(!allBills[bNo]) {
                        allBills[bNo] = { date: l.t_date, total: 0, paid: 0, due: 0 };
                        billsList.push({ billNo: bNo, date: l.t_date, amount: l.amount });
                    } else {
                        billsList.find(b => b.billNo === bNo).amount += l.amount;
                    }
                    allBills[bNo].total += l.amount;
                }
            });

            let generalPayment = 0;
            
            calcLedger.forEach(l => {
                if(l.t_type === 'PAYMENT' || l.t_type === 'PAYMENT_OWNER') {
                    const bNo = l.bill_no || "0";
                    
                    if(bNo === "0") {
                        generalPayment += l.amount;
                    } else {
                        if(allBills[bNo]) {
                            allBills[bNo].paid += l.amount;
                        }
                    }
                }
            });

            billsList.forEach(bill => {
                if(generalPayment > 0) {
                    const bNo = bill.billNo;
                    const remainingDue = allBills[bNo].total - allBills[bNo].paid;
                    
                    if(remainingDue > 0) {
                        if(generalPayment >= remainingDue) {
                            allBills[bNo].paid += remainingDue;
                            generalPayment -= remainingDue;
                        } else {
                            allBills[bNo].paid += generalPayment;
                            generalPayment = 0;
                        }
                    }
                }
            });
        }

        const list = document.getElementById('ledgerList');
        list.innerHTML = '';

        const filteredLedger = displayLedger.filter(item => item.t_date.startsWith(selectedMonth));

        if (filteredLedger.length === 0) {
            list.innerHTML = '<p style="text-align:center; color:#64748b; padding:20px;">No transactions in this month.</p>';
        } else {
            filteredLedger.forEach((l) => {
                let badgeClass = 'badge-bill';
                let statusLabel = 'BILL';
                let amountColor = 'var(--danger)';
                let billStatusHTML = '';

                if(l.t_type === 'PAYMENT') {
                    badgeClass = 'badge-payment';
                    statusLabel = 'PAID (CASH)';
                    amountColor = 'var(--success)';
                } else if (l.t_type === 'PAYMENT_OWNER') {
                    badgeClass = 'badge-owner';
                    statusLabel = 'PAID (OWNER)';
                    amountColor = '#4338ca';
                } else if(l.t_type === 'BILL') {
                    const bNo = l.bill_no || "0";
                    const b = allBills[bNo];
                    if(b) {
                        b.due = b.total - b.paid;
                        const isPaid = b.due <= 0;
                        let billStatus = '';
                        let stampClass = '';
                        
                        if(isPaid) {
                            billStatus = 'FULL PAID';
                            stampClass = 'stamp-paid';
                        } else if(b.paid > 0) {
                            billStatus = `PARTIAL (₹${b.paid.toLocaleString('en-IN')} paid, ₹${b.due.toLocaleString('en-IN')} due)`;
                            stampClass = 'stamp-partial';
                        } else {
                            billStatus = 'UNPAID';
                            stampClass = 'stamp-unpaid';
                        }
                        
                        billStatusHTML = `<span class="stamp ${stampClass}" style="margin-left:8px; font-size:0.7rem;">${billStatus}</span>`;
                    }
                }

                const safeDesc = l.description ? l.description.replace(/'/g, "\\'") : "";

                list.innerHTML += `
                    <li class="ledger-item">
                        <div class="li-left">
                            <span>${l.t_type === 'BILL' ? 'Bill #' + l.bill_no : 'Payment for Bill #' + l.bill_no}${billStatusHTML}</span>
                            <small>${l.description || '-'}</small>
                            <small><i class="ri-calendar-line"></i> ${l.t_date}</small>
                        </div>
                        <div class="li-right">
                            <b style="color: ${amountColor}">₹${l.amount.toLocaleString('en-IN')}</b>
                            <small class="${badgeClass}">${statusLabel}</small>
                            <div class="li-actions">
                                <button class="btn-icon edit" onclick="editEntry('${l.id}', '${l.t_type}', '${l.amount}', '${l.bill_no}', '${l.t_date}', '${safeDesc}')"><i class="ri-pencil-line"></i></button>
                                <button class="btn-icon delete" onclick="deleteEntry('${l.id}', '${l.t_type}')"><i class="ri-delete-bin-line"></i></button>
                            </div>
                        </div>
                    </li>
                `;
            });
        }
        
        toggleBillSelect();
    } catch (error) {
        console.error('Error loading vendor details:', error);
        showToast('Failed to load vendor details: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function generateNextBillNumber() {
    try {
        if(!vendorId) return;
        
        const { data: allBills, error } = await _supabase.from('vendor_ledger')
            .select('bill_no')
            .eq('vendor_id', vendorId)
            .eq('t_type', 'BILL');

        if (error) throw error;

        let maxBillNo = 0;

        if (allBills && allBills.length > 0) {
            maxBillNo = Math.max(...allBills.map(b => parseInt(b.bill_no) || 0));
        }

        document.getElementById('entryBillNo').value = maxBillNo + 1;
    } catch (error) {
        console.error('Error generating bill number:', error);
        showToast('Failed to generate bill number', 'error');
        document.getElementById('entryBillNo').value = 1;
    }
}

async function addEntry() {
    try {
        const type = document.getElementById('entryType').value;
        const date = document.getElementById('entryDate').value;
        const desc = document.getElementById('entryDesc').value;
        const amount = parseFloat(document.getElementById('entryAmount').value);
        let billNo = document.getElementById('entryBillNo').value;

        if(type === 'PAYMENT' || type === 'PAYMENT_OWNER') {
            billNo = document.getElementById('selectBillNo').value;
        }

        if(!amount || billNo === "") return showToast("Please enter amount and bill number", "error");
        if(amount <= 0) return showToast("Amount must be greater than zero", "error");
        if(!date) return showToast("Please select a date", "error");

        const { data: vendor, error: vendorError } = await _supabase.from('vendors').select('name').eq('id', vendorId).single();
        if (vendorError) throw vendorError;
        if (!vendor) {
            showToast("Vendor not found", "error");
            return;
        }

        if(type === 'BILL' && !editingId) {
            const { data: existingBill, error: checkError } = await _supabase.from('vendor_ledger')
                .select('id')
                .eq('vendor_id', vendorId)
                .eq('bill_no', billNo.toString())
                .eq('t_type', 'BILL')
                .maybeSingle();
            
            if (checkError) throw checkError;
            
            if(existingBill) {
                showToast(`Bill #${billNo} already exists for this vendor!`, "error");
                return;
            }
        }

        if(typeof editingId !== 'undefined' && editingId) {
            await deleteEntry(editingId, editingOldType, true);
            editingId = null;
            editingOldType = null;
            const addBtn = document.querySelector('.btn-primary');
            addBtn.innerText = "Add to Ledger";
            addBtn.style.background = "var(--primary)";
        }

        const { error } = await _supabase.from('vendor_ledger').insert({
            user_id: currentUser.id,
            vendor_id: vendorId,
            t_date: date,
            t_type: type,
            description: desc,
            amount: amount,
            bill_no: billNo.toString()
        });

        if(error) throw error;

        if(type === 'BILL') {
            const billDesc = desc ? `${vendor.name} (${desc})` : vendor.name;
            const { error: expenseError } = await _supabase.from('expenses').insert({
                user_id: currentUser.id,
                report_date: date,
                description: billDesc,
                amount: amount,
                payment_source: 'DUE',
                bill_no: billNo.toString()
            });
            if (expenseError) throw expenseError;
        }
        else if(type === 'PAYMENT_OWNER') {
            const { error: ownerError } = await _supabase.from('owner_ledger').insert({
                user_id: currentUser.id,
                t_date: date,
                t_type: 'LOAN_TAKEN',
                amount: amount,
                description: `Paid to ${vendor.name} (Bill #${billNo})`
            });
            if (ownerError) throw ownerError;
        }

        document.getElementById('entryAmount').value = '';
        document.getElementById('entryDesc').value = '';
        document.getElementById('entryBillNo').value = '';
        
        showToast('Entry added successfully!', 'success');
        loadDetails();
    } catch (error) {
        console.error('Error adding entry:', error);
        showToast('Failed to add entry: ' + (error.message || 'Unknown error'), 'error');
    }
}

async function logout() {
    await _supabase.auth.signOut();
    window.location.href = 'index.html';
}

async function deleteEntry(id, type, isSilent = false) {
    if(!isSilent && !confirm("Are you sure you want to delete this entry?")) return;

    const { data: record } = await _supabase.from('vendor_ledger')
        .select('*, vendors(name)')
        .eq('id', id)
        .single();

    const { error } = await _supabase.from('vendor_ledger').delete().eq('id', id);

    if(error) {
        showToast("Error deleting: " + error.message, "error");
    } else {
        const vendorName = record.vendors.name;

        if(type === 'BILL') {
            await _supabase.from('expenses').delete()
                .eq('user_id', currentUser.id)
                .eq('bill_no', record.bill_no)
                .eq('payment_source', 'DUE')
                .or(`description.eq.${vendorName},description.ilike.${vendorName} (%)`);
        } 
        else if(type === 'PAYMENT') {
            await _supabase.from('expenses').delete()
                .eq('user_id', currentUser.id)
                .eq('bill_no', record.bill_no)
                .eq('payment_source', 'CASH')
                .eq('report_date', record.t_date)
                .ilike('description', `Vendor Payment: ${vendorName}`);
        }
        else if(type === 'PAYMENT_OWNER') {
            await _supabase.from('owner_ledger').delete()
                .eq('user_id', currentUser.id)
                .eq('t_date', record.t_date)
                .eq('amount', record.amount)
                .eq('t_type', 'LOAN_TAKEN');
        }
        
        if(!isSilent) loadDetails();
    }
}

function editEntry(id, type, amount, billNo, date, desc) {
    editingId = id;
    editingOldType = type;

    document.getElementById('entryType').value = type;
    toggleBillSelect();

    document.getElementById('entryDate').value = date;
    document.getElementById('entryAmount').value = amount;
    document.getElementById('entryDesc').value = desc;

    if(type === 'BILL') {
        const billInput = document.getElementById('entryBillNo');
        billInput.value = billNo;
        billInput.removeAttribute('readonly');
        billInput.style.background = 'white';
        billInput.style.cursor = 'text';
    } else {
        const select = document.getElementById('selectBillNo');
        select.value = billNo;
    }

    document.getElementById('entryFormCard').scrollIntoView({ behavior: 'smooth' });
    const addBtn = document.querySelector('.btn-primary');
    addBtn.innerText = "Update Entry";
    addBtn.style.background = "#f59e0b";
}

async function generateInvoiceImage() {
    showToast("Downloading Image...", "info");
    prepareInvoiceTemplate();
    
    try {
        const template = document.getElementById('invoiceTemplate');
        const canvas = await html2canvas(template, { scale: 2 });
        const link = document.createElement('a');
        link.download = `${vendorData.name}_Ledger.png`;
        link.href = canvas.toDataURL("image/png");
        link.click();
        showToast("Image Downloaded!", "success");
    } catch (err) {
        console.error(err);
        showToast("Failed to download image", "error");
    }
}

function prepareInvoiceTemplate() {
    document.getElementById('invRestroName').innerText = restaurantName;
    document.getElementById('invVendorName').innerText = vendorData.name;
    document.getElementById('invDate').innerText = `Date: ${new Date().toLocaleDateString('en-IN')}`;
    document.getElementById('invSignature').innerText = signatureName;
    
    const filterMonth = document.getElementById('filterMonth').value;
    const dateObj = new Date(filterMonth + "-01");
    const monthName = dateObj.toLocaleString('default', { month: 'long', year: 'numeric' }).toUpperCase();
    document.getElementById('invDueLabel').innerText = `TOTAL OUTSTANDING DUE (UP TO ${monthName})`;
    
    const tbody = document.getElementById('invBody');
    tbody.innerHTML = '';
    
    const filteredLedger = ledgerData.filter(item => item.t_date.startsWith(filterMonth));
    const bills = filteredLedger.filter(l => l.t_type === 'BILL');
    
    let sl = 1;
    
    bills.forEach(bill => {
        const payments = ledgerData.filter(l => (l.t_type === 'PAYMENT' || l.t_type === 'PAYMENT_OWNER') && l.bill_no === bill.bill_no);
        const paidAmt = payments.reduce((sum, p) => sum + p.amount, 0);
        const dueAmt = bill.amount - paidAmt;
        
        let statusHtml = '';
        if (dueAmt <= 0) statusHtml = '<span class="stamp stamp-paid">PAID</span>';
        else if (paidAmt > 0) statusHtml = '<span class="stamp stamp-partial">PARTIAL</span>';
        else statusHtml = '<span class="stamp stamp-unpaid">DUE</span>';

        tbody.innerHTML += `
            <tr>
                <td>${sl++}</td>
                <td>${bill.t_date}</td>
                <td><b>#${bill.bill_no}</b></td>
                <td>₹${bill.amount.toLocaleString('en-IN')}</td>
                <td style="color:#059669;">₹${paidAmt.toLocaleString('en-IN')}</td>
                <td style="color:#ef4444; font-weight:bold;">₹${dueAmt.toLocaleString('en-IN')}</td>
                <td>${statusHtml}</td>
            </tr>
        `;
    });

    document.getElementById('invTotalDue').innerText = document.getElementById('currDue').innerText;
}

async function previewInvoice() {
    showToast("Generating preview...", "info");
    prepareInvoiceTemplate();
    
    const template = document.getElementById('invoiceTemplate');
    const previewContainer = document.getElementById('previewContainer');
    
    try {
        const canvas = await html2canvas(template, { scale: 2 });
        const imgData = canvas.toDataURL("image/png");
        previewContainer.innerHTML = `<img src="${imgData}" alt="Bill Preview">`;
        document.getElementById('previewModal').classList.remove('hidden');
    } catch (err) {
        console.error(err);
        showToast("Failed to generate preview", "error");
    }
}

function closePreviewModal() {
    document.getElementById('previewModal').classList.add('hidden');
    document.getElementById('previewContainer').innerHTML = '<div style="text-align: center; padding: 50px;"><i class="ri-loader-4-line spin" style="font-size: 2rem; color: #2563eb;"></i></div>';
}

async function generateInvoicePDF() {
    showToast("Generating PDF...", "info");
    prepareInvoiceTemplate();
    
    try {
        const template = document.getElementById('invoiceTemplate');
        const canvas = await html2canvas(template, { scale: 2 });
        const imgData = canvas.toDataURL("image/png");

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF('p', 'mm', 'a4');
        
        const pdfWidth = 210;
        const pageHeight = 297;
        const imgWidth = pdfWidth;
        const imgHeight = (canvas.height * pdfWidth) / canvas.width;
        
        let heightLeft = imgHeight;
        let position = 0;

        doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
        heightLeft -= pageHeight;

        while (heightLeft > 0) {
            position = heightLeft - imgHeight;
            doc.addPage();
            doc.addImage(imgData, 'PNG', 0, position, imgWidth, imgHeight);
            heightLeft -= pageHeight;
        }

        doc.save(`${vendorData.name}_Ledger.pdf`);
        showToast("PDF Downloaded!", "success");
    } catch (err) {
        console.error(err);
        showToast("Failed to generate PDF", "error");
    }
}
