/**
 * RestroManager Keyboard Shortcuts (Windows & Mac Compatible)
 * Self-contained Modal and Logic.
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
        const code = e.code;
        if (code === 'Digit1') { e.preventDefault(); window.location.href = 'dashboard.html'; }
        else if (code === 'Digit2') { e.preventDefault(); window.location.href = 'tally.html'; }
        else if (code === 'Digit3') { e.preventDefault(); window.location.href = 'vendors.html'; }
        else if (code === 'Digit4') { e.preventDefault(); window.location.href = 'vendor-history.html'; }
        else if (code === 'Digit5') { e.preventDefault(); window.location.href = 'owner.html'; }
        else if (code === 'Digit6') { e.preventDefault(); window.location.href = 'salary.html'; }
        else if (code === 'Digit7') { e.preventDefault(); window.location.href = 'pl.html'; }
        else if (e.key.toLowerCase() === 'h') { e.preventDefault(); showShortcutGuide(); }
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
    if (document.getElementById('shortcutModal')) return;

    const style = `
        <style>
            .sc-overlay {
                position: fixed; top: 0; left: 0; width: 100%; height: 100%;
                background: rgba(15, 23, 42, 0.7); backdrop-filter: blur(5px);
                display: flex; align-items: center; justify-content: center;
                z-index: 99999; opacity: 0; pointer-events: none; transition: 0.3s;
            }
            .sc-overlay.show { opacity: 1; pointer-events: auto; }
            .sc-card {
                background: white; width: 90%; max-width: 450px; border-radius: 24px;
                box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
                padding: 30px; transform: translateY(20px); transition: 0.3s;
            }
            .sc-overlay.show .sc-card { transform: translateY(0); }
            .sc-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; border-bottom: 1px solid #f1f5f9; padding-bottom: 15px; }
            .sc-header h3 { margin: 0; font-size: 1.25rem; color: #1e293b; display: flex; align-items: center; gap: 10px; }
            .sc-close { background: #f1f5f9; border: none; width: 32px; height: 32px; border-radius: 50%; cursor: pointer; color: #64748b; font-size: 1.2rem; display: flex; align-items: center; justify-content: center; }
            .sc-close:hover { background: #e2e8f0; }
            .sc-grid { display: grid; grid-template-columns: 1fr 1.5fr; gap: 12px; font-size: 0.95rem; }
            .sc-key { color: #2563eb; font-weight: 800; background: #eff6ff; padding: 4px 10px; border-radius: 6px; border: 1px solid #dbeafe; text-align: center; }
            .sc-desc { color: #475569; font-weight: 500; }
            .sc-footer { margin-top: 25px; padding-top: 15px; border-top: 1px solid #f1f5f9; font-size: 0.8rem; color: #94a3b8; text-align: center; }
        </style>
    `;

    const modalHTML = `
        <div id="shortcutModal" class="sc-overlay">
            <div class="sc-card">
                <div class="sc-header">
                    <h3><i class="ri-keyboard-line"></i> Keyboard Shortcuts</h3>
                    <button onclick="closeShortcutGuide()" class="sc-close"><i class="ri-close-line"></i></button>
                </div>
                <div class="sc-grid">
                    <span class="sc-key">Alt + 1</span> <span class="sc-desc">Home / Dashboard</span>
                    <span class="sc-key">Alt + 2</span> <span class="sc-desc">Cash Tally</span>
                    <span class="sc-key">Alt + 3</span> <span class="sc-desc">Vendors List</span>
                    <span class="sc-key">Alt + 4</span> <span class="sc-desc">Vendor History</span>
                    <span class="sc-key">Alt + 5</span> <span class="sc-desc">Owner Ledger</span>
                    <span class="sc-key">Alt + 6</span> <span class="sc-desc">Salary Sheet</span>
                    <span class="sc-key">Alt + 7</span> <span class="sc-desc">Profit & Loss</span>
                    <hr style="grid-column: span 2; margin: 5px 0; opacity: 0.1;">
                    <span class="sc-key">Shift + S</span> <span class="sc-desc">Save Data</span>
                    <span class="sc-key">Shift + N</span> <span class="sc-desc">Add New Entry</span>
                    <span class="sc-key">M</span> <span class="sc-desc">Toggle Menu</span>
                    <span class="sc-key">Enter</span> <span class="sc-desc">Next Field (Tally)</span>
                    <span class="sc-key">Esc</span> <span class="sc-desc">Close Popup</span>
                </div>
                <div class="sc-footer">
                    On Mac, use <b>Option (⌥)</b> instead of <b>Alt</b>
                </div>
            </div>
        </div>
    `;
    document.body.insertAdjacentHTML('beforeend', style + modalHTML);

    document.getElementById('shortcutModal').addEventListener('click', function(e) {
        if (e.target === this) closeShortcutGuide();
    });
}

function showShortcutGuide() {
    const modal = document.getElementById('shortcutModal');
    if (modal) modal.classList.add('show');
}

function closeShortcutGuide() {
    const modal = document.getElementById('shortcutModal');
    if (modal) modal.classList.remove('show');
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
