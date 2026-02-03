/**
 * RestroManager Keyboard Shortcuts (Windows & Mac Compatible)
 * Adds global navigation and Tally-specific "Enter to Next" functionality.
 */

document.addEventListener('keydown', function(e) {
    // ১. Tally পেজে "Enter" চাপলে পরের ঘরে যাওয়া
    if (window.location.pathname.includes('tally.html')) {
        if (e.key === 'Enter' && e.target.classList.contains('note-input')) {
            e.preventDefault();
            
            const inputs = Array.from(document.querySelectorAll('.note-input'));
            const currentIndex = inputs.indexOf(e.target);
            const nextInput = inputs[currentIndex + 1];

            if (nextInput) {
                nextInput.focus();
                nextInput.select();
            } else {
                const saveBtn = document.querySelector('.btn-save-tally');
                if (saveBtn) saveBtn.focus();
            }
            return;
        }
    }

    // ২. ইনপুট ফিল্ডে টাইপ করার সময় গ্লোবাল শর্টকাট বন্ধ রাখা (Escape বাদে)
    const isTyping = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';
    
    if (isTyping) {
        if (e.key === 'Escape') {
            e.target.blur();
            if (typeof closeModal === 'function') closeModal();
        }
        return;
    }

    // ৩. নেভিগেশন শর্টকাট (Windows: Alt + Key, Mac: Option + Key)
    if (e.altKey) {
        switch (e.key) {
            case '1': window.location.href = 'dashboard.html'; break;
            case '2': window.location.href = 'tally.html'; break;
            case '3': window.location.href = 'vendors.html'; break;
            case '4': window.location.href = 'vendor-history.html'; break;
            case '5': window.location.href = 'owner.html'; break;
            case '6': window.location.href = 'salary.html'; break;
            case '7': window.location.href = 'pl.html'; break;
        }
    }

    // ৪. অ্যাকশন শর্টকাট
    const key = e.key.toLowerCase();

    switch (key) {
        case 'm':
            if (typeof toggleSidebar === 'function') toggleSidebar();
            break;

        case 's':
            if (e.shiftKey) {
                e.preventDefault();
                triggerSaveAction();
            }
            break;

        case 'n':
            if (e.shiftKey) {
                e.preventDefault();
                triggerNewEntryAction();
            }
            break;

        case 'escape':
            if (typeof toggleSidebar === 'function' && document.getElementById('sidebarMenu')?.classList.contains('active')) {
                toggleSidebar();
            }
            if (typeof closeModal === 'function') closeModal();
            break;
    }
});

/**
 * বর্তমান পেজ অনুযায়ী সেভ ফাংশন কল করা
 */
function triggerSaveAction() {
    const path = window.location.pathname;
    
    if (path.includes('dashboard.html')) {
        if (typeof saveSales === 'function') saveSales();
    } else if (path.includes('tally.html')) {
        if (typeof saveTally === 'function') saveTally();
    } else if (path.includes('pl.html')) {
        if (typeof saveMonthlyData === 'function') saveMonthlyData();
    } else if (path.includes('settings.html')) {
        if (typeof saveSettings === 'function') saveSettings();
    } else if (path.includes('owner.html')) {
        if (typeof addOwnerTrans === 'function') addOwnerTrans();
    }
}

/**
 * বর্তমান পেজ অনুযায়ী 'Add New' মোডাল ওপেন করা
 */
function triggerNewEntryAction() {
    const path = window.location.pathname;

    if (path.includes('vendors.html')) {
        if (typeof showAddVendorModal === 'function') showAddVendorModal();
    } else if (path.includes('salary.html')) {
        if (typeof showStaffModal === 'function') showStaffModal();
    } else if (path.includes('pl.html')) {
        if (typeof showAddCategory === 'function') showAddCategory();
    }
}
