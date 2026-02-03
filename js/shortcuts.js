/**
 * RestroManager Keyboard Shortcuts (Windows & Mac Compatible)
 * Includes a built-in Shortcut Guide Modal.
 */

document.addEventListener('DOMContentLoaded', () => {
    injectShortcutModal();
});

document.addEventListener('keydown', function(e) {
    if (window.location.pathname.includes('tally.html')) {
        if (e.key === 'Enter' && e.target.classList.contains('note-input')) {
            e.preventDefault();
            const inputs = Array.from(document.querySelectorAll('.note-input'));
            const currentIndex = inputs.indexOf(e.target);
            const nextInput = inputs[currentIndex + 1];
            if (nextInput) { nextInput.focus(); nextInput.select(); }
            else { const saveBtn = document.querySelector('.btn-save-tally'); if (saveBtn) saveBtn.focus(); }
            return;
        }
    }

    const isTyping = e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT';
    if (isTyping) {
        if (e.key === 'Escape') {
            e.target.blur();
            closeShortcutGuide();
            if (typeof closeModal === 'function') closeModal();
        }
        return;
    }

    if (e.altKey) {
        switch (e.key) {
            case '1': window.location.href = 'dashboard.html'; break;
            case '2': window.location.href = 'tally.html'; break;
            case '3': window.location.href = 'vendors.html'; break;
            case '4': window.location.href = 'vendor-history.html'; break;
            case '5': window.location.href = 'owner.html'; break;
            case '6': window.location.href = 'salary.html'; break;
            case '7': window.location.href = 'pl.html'; break;
            case 'h': case 'H': showShortcutGuide(); break;
        }
    }

    const key = e.key.toLowerCase();
    switch (key) {
        case 'm': if (typeof toggleSidebar === 'function') toggleSidebar(); break;
        case 's': if (e.shiftKey) { e.preventDefault(); triggerSaveAction(); } break;
        case 'n': if (e.shiftKey) { e.preventDefault(); triggerNewEntryAction(); } break;
        case 'escape': 
            closeShortcutGuide();
            if (typeof toggleSidebar === 'function' && document.getElementById('sidebarMenu')?.classList.contains('active')) toggleSidebar();
            if (typeof closeModal === 'function') closeModal();
            break;
    }
});

function injectShortcutModal() {
    const modalHTML = `
        <div id="shortcutModal" class="modal-overlay hidden" style="z-index: 9999;">
            <div class="modal-card" style="max-width: 500px;">
                <div class="modal-header">
                    <h3><i class="ri-keyboard-line"></i> Keyboard Shortcuts</h3>
                    <button onclick="closeShortcutGuide()" style="background:none; border:none; font-size:1.5rem; cursor:pointer; color:#94a3b8;"><i class="ri-close-line"></i></button>
                </div>
                <div class="modal-body" style="padding: 20px;">
                    <div style="display:grid; grid-template-columns: 1fr 1.5fr; gap: 10px; font-size: 0.9rem;">
                        <b style="color:#2563eb">Alt + 1</b> <span>Home / Dashboard</span>
                        <b style="color:#2563eb">Alt + 2</b> <span>Cash Tally</span>
                        <b style="color:#2563eb">Alt + 3</b> <span>Vendors List</span>
                        <b style="color:#2563eb">Alt + 4</b> <span>Vendor History</span>
                        <b style="color:#2563eb">Alt + 5</b> <span>Owner Ledger</span>
                        <b style="color:#2563eb">Alt + 6</b> <span>Salary Sheet</span>
                        <b style="color:#2563eb">Alt + 7</b> <span>Profit & Loss</span>
                        <hr style="grid-column: span 2; margin: 10px 0; opacity: 0.2;">
                        <b style="color:#10b981">Shift + S</b> <span>Save Current Page Data</span>
                        <b style="color:#10b981">Shift + N</b> <span>Add New Entry / Staff</span>
                        <b style="color:#ef4444">M</b> <span>Toggle Sidebar Menu</span>
                        <b style="color:#ef4444">Enter</b> <span>Next Field (Tally Page)</span>
                        <b style="color:#ef4444">Esc</b> <span>Close Any Popup / Menu</span>
                    </div>
                </div>
                <div style="padding: 15px 20px; border-top: 1px solid #f1f5f9;">
                    <p style="font-size: 0.75rem; color: #64748b; margin: 0;">* On Mac, use <b>Option</b> instead of <b>Alt</b></p>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHTML);
}

function showShortcutGuide() {
    const modal = document.getElementById('shortcutModal');
    if (modal) modal.classList.remove('hidden');
}

function closeShortcutGuide() {
    const modal = document.getElementById('shortcutModal');
    if (modal) modal.classList.add('hidden');
}

function triggerSaveAction() {
    const path = window.location.pathname;
    if (path.includes('dashboard.html')) { if (typeof saveSales === 'function') saveSales(); }
    else if (path.includes('tally.html')) { if (typeof saveTally === 'function') saveTally(); }
    else if (path.includes('pl.html')) { if (typeof saveMonthlyData === 'function') saveMonthlyData(); }
    else if (path.includes('settings.html')) { if (typeof saveSettings === 'function') saveSettings(); }
    else if (path.includes('owner.html')) { if (typeof addOwnerTrans === 'function') addOwnerTrans(); }
}

function triggerNewEntryAction() {
    const path = window.location.pathname;
    if (path.includes('vendors.html')) { if (typeof showAddVendorModal === 'function') showAddVendorModal(); }
    else if (path.includes('salary.html')) { if (typeof showStaffModal === 'function') showStaffModal(); }
    else if (path.includes('pl.html')) { if (typeof showAddCategory === 'function') showAddCategory(); }
}
