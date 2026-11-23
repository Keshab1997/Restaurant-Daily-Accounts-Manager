/* Daily inventory UI; all calculations are derived, never stored as closing balances. */
(() => {
    'use strict';
    const L = InventoryLogic, $ = id => document.getElementById(id);
    let user, restaurantName = 'RestroManager', items = [], entries = [], imports = [], mappings = [], corrections = [], report = null, previewData = null, editing = null, editingBase = null, revision = 0, fileRevision = 0;
    let draftState = L.emptyDraftState(), restoredNotice = false, exportUrls = [];
    const inFlightEntrySaves = new Set();
    let rowSavers = [];
    let inFlightFormSave = false, inFlightCorrection = false, pendingClearScope = null, pendingClearRequestId = null;
    const SVG_NS = 'http://www.w3.org/2000/svg';
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
    function makeRequestId() {
        if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
            return crypto.randomUUID();
        }
        return `req-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    }
    function message(msg, error = false) { $('message').textContent = msg; $('message').className = error ? 'error' : ''; }
    function fail(err) { message(err.message || String(err), true); }
    function el(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
    function svgIcon(name, cls = 'icon') {
        const create = typeof document.createElementNS === 'function'
            ? tag => document.createElementNS(SVG_NS, tag)
            : tag => document.createElement(tag);
        const svg = create('svg');
        svg.setAttribute('class', cls);
        svg.setAttribute('aria-hidden', 'true');
        svg.setAttribute('focusable', 'false');
        const use = create('use');
        use.setAttribute('href', `assets/inventory-icons.svg#${name}`);
        svg.append(use);
        return svg;
    }
    function setItemSubmitText(label) {
        const span = $('item-submit-label');
        if (span) span.textContent = label;
        else if ($('item-submit')) $('item-submit').textContent = label;
    }
    function fmt(n) { return Number(n.toFixed(4)).toLocaleString('en-IN', {maximumFractionDigits:4}); }
    function assertDay() { if (!$('day').value) throw new Error('Choose a stock date'); return $('day').value; }
    // Tab navigation keeps each section on its own screen instead of one long scroll.
    const TAB_NAMES = ['sheet', 'items', 'import', 'fixes'];
    const TAB_KEY = 'inventory_active_tab_v1';
    let activeTab = 'sheet';
    function setTab(name, opts = {}) {
        const target = TAB_NAMES.includes(name) ? name : 'sheet';
        for (const t of TAB_NAMES) {
            const btn = $(`tab-${t}`), panel = $(`panel-${t}`);
            if (!btn || !panel) continue;
            const on = t === target;
            btn.setAttribute('aria-selected', on ? 'true' : 'false');
            btn.className = on ? 'tab-btn active' : 'tab-btn';
            btn.tabIndex = on ? 0 : -1;
            panel.hidden = !on;
        }
        activeTab = target;
        try { const storage = getStorage(); if (storage) storage.setItem(TAB_KEY, target); } catch (_) { /* storage is optional */ }
        if (opts.focus) { const btn = $(`tab-${target}`); if (btn) btn.focus(); }
        if (opts.updateHash !== false && typeof window !== 'undefined' && window.history && window.history.replaceState) {
            try { window.history.replaceState(null, '', `#${target}`); } catch (_) { /* file:// or sandboxed history is fine to skip */ }
        }
        return target;
    }
    function rememberedTab() {
        try { const storage = getStorage(); const saved = storage && storage.getItem(TAB_KEY); if (TAB_NAMES.includes(saved)) return saved; } catch (_) { /* ignore */ }
        const hash = typeof window !== 'undefined' && window.location ? String(window.location.hash || '').replace(/^#/, '') : '';
        return TAB_NAMES.includes(hash) ? hash : 'sheet';
    }
    function initTabs() {
        const bar = $('inventory-tabs');
        if (!bar) return;
        for (const t of TAB_NAMES) {
            const btn = $(`tab-${t}`);
            if (!btn) continue;
            btn.onclick = () => setTab(t);
            btn.onkeydown = (e) => {
                const i = TAB_NAMES.indexOf(t);
                const next = e.key === 'ArrowRight' ? (i + 1) % TAB_NAMES.length
                    : e.key === 'ArrowLeft' ? (i - 1 + TAB_NAMES.length) % TAB_NAMES.length
                    : e.key === 'Home' ? 0 : e.key === 'End' ? TAB_NAMES.length - 1 : null;
                if (next === null) return;
                e.preventDefault();
                setTab(TAB_NAMES[next], { focus: true });
            };
        }
        for (const link of document.querySelectorAll('[data-goto-tab]')) {
            link.onclick = () => setTab(link.dataset.gotoTab);
        }
        setTab(rememberedTab(), { updateHash: false });
    }
    function updateItemCountBadge() {
        const badge = $('tab-count-items');
        if (!badge) return;
        badge.textContent = String(items.length);
        badge.hidden = items.length === 0;
    }
    function getStorage() {
        try { return typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null); }
        catch (e) { reportStorageError(e && e.message ? e.message : 'Browser storage access denied'); return null; }
    }
    function reportStorageError(msg) {
        const box = $('storage-warning'), textEl = $('storage-warning-text') || box;
        if (!box) return;
        if (msg) { textEl.textContent = `Draft storage warning: ${msg}. Unsaved edits may not survive page reload.`; box.hidden = false; }
        else { textEl.textContent = ''; box.hidden = true; }
    }
    function persistDrafts() {
        if (!user) return false;
        const storage = getStorage();
        if (!storage) return false;
        const res = L.saveDraftState(storage, user.id, draftState);
        draftState = res.state;
        if (!res.ok) { reportStorageError(res.error); return false; }
        reportStorageError('');
        return true;
    }
    function updateItemDraftNote() {
        const note = $('item-draft-note'), discardBtn = $('discard-item-draft');
        const f = draftState.itemForm;
        if (!f) {
            if (note) { note.textContent = ''; note.hidden = true; }
            if (discardBtn) discardBtn.hidden = true;
            return;
        }
        const staleInfo = L.isItemFormDraftStale(f, items);
        if (note) {
            if (staleInfo.missing) {
                note.textContent = 'Restored item edit draft refers to an item that is no longer available on the server. Discard this draft or enter a new item.';
            } else if (staleInfo.stale) {
                note.textContent = `Stale item edit draft: server values changed (${staleInfo.serverItem.name}, opening ${fmt(Number(staleInfo.serverItem.initial_opening))}). Saving requires confirmation.`;
            } else {
                note.textContent = f.editingId
                    ? 'Unsaved item edit draft saved locally in this browser.'
                    : 'Pending new-item form draft saved locally in this browser.';
            }
            note.hidden = false;
        }
        if (discardBtn) discardBtn.hidden = false;
    }
    function updateDraftStatus() {
        const banner = $('draft-status'), textBox = $('draft-status-text');
        if (!banner || !textBox) return;
        const day = $('day').value || '';
        const summary = L.draftSummary(draftState, day);
        if (!summary.totalCount) {
            banner.hidden = true; textBox.textContent = ''; return;
        }
        const parts = [];
        if (summary.currentDayEntries) parts.push(`${summary.currentDayEntries} unsaved stock row${summary.currentDayEntries === 1 ? '' : 's'} on ${day}`);
        if (summary.otherDayEntries) parts.push(`${summary.otherDayEntries} unsaved row${summary.otherDayEntries === 1 ? '' : 's'} on other date(s): ${summary.otherDates.join(', ')}`);
        if (summary.hasItemForm) parts.push('pending item form');
        const dayDrafts = draftState.entries[day] || {};
        const hasStaleRow = items.some(it => L.resolveRowState(it, day, entries, imports, dayDrafts).stale);
        const itemStale = L.isItemFormDraftStale(draftState.itemForm, items).stale;
        const prefix = restoredNotice ? 'Restored unsaved local drafts: ' : 'Unsaved local drafts (not yet saved to Supabase): ';
        const conflict = (hasStaleRow || itemStale) ? ' · Warning: server data changed since some drafts were created; review before saving.' : '';
        textBox.textContent = prefix + parts.join(' · ') + conflict;
        banner.hidden = false;
    }
    async function all(table) {
        const result = []; let start = 0;
        for (;;) {
            let query = _supabase.from(table).select('*').eq('user_id', user.id);
            if (table === 'inventory_corrections') {
                query = query.order('created_at', { ascending: false });
            } else {
                query = query.order(table === 'inventory_items' ? 'id' : table === 'inventory_mappings' ? 'dish_key' : 'day');
                if (table === 'inventory_entries') query = query.order('item_id');
            }
            const {data, error} = await query.range(start, start + 499);
            if (error) throw error;
            result.push(...data); if (data.length < 500) return result; start += data.length;
        }
    }
    async function refresh() {
        [items, entries, imports, mappings, corrections] = await Promise.all(['inventory_items','inventory_entries','inventory_imports','inventory_mappings','inventory_corrections'].map(all));
        corrections.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
        renderStock(); renderItems(); renderImportStatus(); updateItemCountBadge(); updateItemDraftNote(); updateDraftStatus(); renderCorrections();
    }
    function invalidate() { revision++; previewData = null; $('preview-area').hidden = true; }
    function clearExportUrls() {
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            for (const url of exportUrls) URL.revokeObjectURL(url);
        }
        exportUrls = [];
    }
    function updateSaveAllButton(dirtyCount) {
        const btn = $('save-all-rows');
        if (!btn) return;
        btn.hidden = !dirtyCount;
        btn.disabled = dirtyCount === 0;
        const label = $('save-all-rows-label');
        if (label) label.textContent = dirtyCount === 1 ? 'Save 1 change' : `Save ${dirtyCount} changes`;
    }
    async function saveAllRows() {
        const pending = rowSavers.filter(r => r.isDirty());
        if (!pending.length) { message('No unsaved stock rows on this day.'); return; }
        const btn = $('save-all-rows');
        if (btn) btn.disabled = true;
        let saved = 0; const failures = [];
        for (const row of pending) {
            try {
                await row.saveRow({ silent: true });
                saved++;
            } catch (e) {
                failures.push(`${row.name}: ${e && e.message ? e.message : e}`);
            }
            message(`Saving ${saved + failures.length} of ${pending.length} rows…`);
        }
        if (btn) btn.disabled = false;
        if (failures.length) {
            fail(new Error(`${saved} row${saved === 1 ? '' : 's'} saved, ${failures.length} failed — ${failures.slice(0, 3).join(' · ')}${failures.length > 3 ? ' …' : ''}`));
            renderStock();
            updateDraftStatus();
        } else {
            message(`${saved} stock row${saved === 1 ? '' : 's'} saved for ${$('day').value}. Later balances are recalculated.`);
        }
    }
    function renderDaySummary(sum) {
        const strip = $('day-summary');
        if (!strip) return;
        if (!sum.items) { strip.hidden = true; strip.replaceChildren(); return; }
        const chip = (label, value, extra) => {
            const box = el('div', undefined, extra ? `summary-chip ${extra}` : 'summary-chip');
            box.append(el('span', label, 'chip-label'), el('span', value, 'chip-value'));
            return box;
        };
        strip.replaceChildren(
            chip('Items', String(sum.items)),
            chip('Purchase', fmt(sum.purchase)),
            chip('Sale', fmt(sum.sale), 'is-sale'),
            chip('Damage', fmt(sum.damage)),
            chip('Closing', fmt(sum.closing), sum.closing < 0 ? 'is-alert' : ''),
            chip('Shortages', String(sum.shortage), sum.shortage ? 'is-alert' : ''),
        );
        strip.hidden = false;
    }
    function renderStock() {
        const body = $('stock'); body.replaceChildren(); const day = $('day').value;
        rowSavers = [];
        const sum = { items: 0, purchase: 0, sale: 0, damage: 0, closing: 0, shortage: 0 };
        if (!day) return;
        const dayDrafts = draftState.entries[day] || {};
        const activeControls = [];
        for (const item of items) {
            const rowState = L.resolveRowState(item, day, entries, imports, dayDrafts), tr = el('tr');
            if (rowState.available) {
                sum.items += 1;
                sum.purchase += Number(rowState.purchase || 0);
                sum.sale += Number(rowState.sale || 0);
                sum.damage += Number(rowState.damage || 0);
                if (rowState.closing !== null && Number.isFinite(Number(rowState.closing))) {
                    sum.closing += Number(rowState.closing);
                    if (Number(rowState.closing) < 0) sum.shortage += 1;
                }
            }
            const nameTd = el('td');
            nameTd.append(el('span', item.name, 'item-cell-name'));
            if (!rowState.available) {
                tr.append(nameTd);
                const td = el('td'); td.colSpan = 6;
                td.append(el('span', `Starts ${rowState.startDate} — `));
                const fixStart = el('button', 'change the start date', 'link-inline');
                fixStart.type = 'button';
                fixStart.setAttribute('aria-label', `Change start date for ${item.name}`);
                fixStart.onclick = () => { setTab('items'); startEditingItem(item); };
                td.append(fixStart);
                tr.append(td); body.append(tr); continue;
            }
            const draftPill = el('span', 'Draft', 'row-badge draft-pill');
            const stalePill = el('span', 'Server changed', 'row-badge stale-pill');
            const conflictNote = el('span', '', 'row-conflict-note');
            draftPill.hidden = !rowState.dirty;
            stalePill.hidden = !rowState.stale;
            conflictNote.hidden = !rowState.stale;
            if (rowState.stale) conflictNote.textContent = `Saved in cloud: Purchase ${fmt(rowState.base.purchase)}, Damage ${fmt(rowState.base.damage)}`;
            nameTd.append(draftPill, stalePill, conflictNote);
            tr.append(nameTd, el('td', fmt(rowState.opening)));

            const p = el('input'), d = el('input');
            for (const input of [p, d]) { input.type='number'; input.min='0'; input.max='1000000000'; input.step='any'; }
            p.value = rowState.purchaseInput; d.value = rowState.damageInput;
            p.setAttribute('aria-label', `Purchase for ${item.name}`);
            d.setAttribute('aria-label', `Damage for ${item.name}`);

            const closingTd = el('td', rowState.invalidDraft ? 'Invalid' : fmt(rowState.closing), rowState.closing !== null && rowState.closing < 0 ? 'shortage' : '');
            const save = el('button', undefined, 'btn-save-row'); save.type = 'button';
            save.append(svgIcon('save', 'icon icon-sm'), el('span', 'Save'));
            save.setAttribute('aria-label', `Save stock row for ${item.name}`);
            const discardRow = el('button', 'Discard', 'btn-discard-row'); discardRow.type = 'button';
            discardRow.setAttribute('aria-label', `Discard draft for ${item.name}`);
            discardRow.hidden = !rowState.dirty;

            const rowIndex = activeControls.length;
            activeControls.push({ p, d, save });

            function applyRowClasses(isDirty, isStale) {
                tr.className = isStale ? 'row-stale' : isDirty ? 'row-dirty' : '';
            }
            applyRowClasses(rowState.dirty, rowState.stale);

            function syncRowDraft() {
                const pv = p.value, dv = d.value;
                let parsedP = null, parsedD = null, valid = true;
                try { parsedP = L.number(pv, 'Purchase'); } catch (_) { valid = false; }
                try { parsedD = L.number(dv, 'Damage'); } catch (_) { valid = false; }
                const saveKey = `${day}:${item.id}`;
                const matchesServer = valid && pv.trim() !== '' && dv.trim() !== ''
                    && parsedP === rowState.base.purchase && parsedD === rowState.base.damage;
                if (matchesServer && !inFlightEntrySaves.has(saveKey)) {
                    draftState = L.clearEntryDraft(draftState, day, item.id);
                } else {
                    const existingDraft = (draftState.entries[day] || {})[item.id];
                    draftState = L.setEntryDraft(draftState, day, item.id, {
                        purchase: pv,
                        damage: dv,
                        basePurchase: existingDraft ? existingDraft.basePurchase : rowState.base.purchase,
                        baseDamage: existingDraft ? existingDraft.baseDamage : rowState.base.damage,
                        baseExists: existingDraft && typeof existingDraft.baseExists === 'boolean'
                            ? existingDraft.baseExists
                            : rowState.serverExists,
                        updatedAt: new Date().toISOString(),
                    });
                }
                persistDrafts();
                const updated = L.resolveRowState(item, day, entries, imports, draftState.entries[day] || {});
                closingTd.textContent = updated.invalidDraft ? 'Invalid' : fmt(updated.closing);
                closingTd.className = updated.closing !== null && updated.closing < 0 ? 'shortage' : '';
                draftPill.hidden = !updated.dirty;
                stalePill.hidden = !updated.stale;
                conflictNote.hidden = !updated.stale;
                discardRow.hidden = !updated.dirty;
                applyRowClasses(updated.dirty, updated.stale);
                updateSaveAllButton(rowSavers.filter(r => r.isDirty()).length);
                updateDraftStatus();
                renderCorrections();
            }

            p.oninput = syncRowDraft;
            p.onchange = syncRowDraft;
            d.oninput = syncRowDraft;
            d.onchange = syncRowDraft;
            p.onkeydown = e => {
                if (e.key === 'Enter') { e.preventDefault(); d.focus(); if (typeof d.select === 'function') d.select(); }
                else if (e.key === 'ArrowDown' && activeControls[rowIndex + 1]) { e.preventDefault(); activeControls[rowIndex + 1].p.focus(); if (typeof activeControls[rowIndex + 1].p.select === 'function') activeControls[rowIndex + 1].p.select(); }
                else if (e.key === 'ArrowUp' && activeControls[rowIndex - 1]) { e.preventDefault(); activeControls[rowIndex - 1].p.focus(); if (typeof activeControls[rowIndex - 1].p.select === 'function') activeControls[rowIndex - 1].p.select(); }
            };
            d.onkeydown = e => {
                if (e.key === 'Enter') { e.preventDefault(); save.focus(); }
                else if (e.key === 'ArrowDown' && activeControls[rowIndex + 1]) { e.preventDefault(); activeControls[rowIndex + 1].d.focus(); if (typeof activeControls[rowIndex + 1].d.select === 'function') activeControls[rowIndex + 1].d.select(); }
                else if (e.key === 'ArrowUp' && activeControls[rowIndex - 1]) { e.preventDefault(); activeControls[rowIndex - 1].d.focus(); if (typeof activeControls[rowIndex - 1].d.select === 'function') activeControls[rowIndex - 1].d.select(); }
            };

            const saveRow = async (opts = {}) => {
                const saveKey = `${day}:${item.id}`;
                save.disabled = true;
                inFlightEntrySaves.add(saveKey);
                try {
                    const purchase = L.number(p.value, 'Purchase'), damage = L.number(d.value, 'Damage');
                    const currentRow = L.resolveRowState(item, day, entries, imports, draftState.entries[day] || {});
                    let pendingDraft = (draftState.entries[day] || {})[item.id] || null;
                    let savedRevision = pendingDraft ? pendingDraft.revision : 0;
                    const basePurchase = pendingDraft ? pendingDraft.basePurchase : currentRow.base.purchase;
                    const baseDamage = pendingDraft ? pendingDraft.baseDamage : currentRow.base.damage;
                    const baseExists = pendingDraft && typeof pendingDraft.baseExists === 'boolean'
                        ? pendingDraft.baseExists
                        : currentRow.serverExists;

                    // Atomic advisory-locked CAS save via RPC so movement saves serialize with clears/restores/imports.
                    let { data: saveRes, error: saveErr } = await _supabase.rpc('inventory_save_entry', {
                        p_item_id: item.id,
                        p_day: day,
                        p_purchase: purchase,
                        p_damage: damage,
                        p_expected_exists: baseExists,
                        p_expected_purchase: basePurchase,
                        p_expected_damage: baseDamage,
                    });
                    if (saveErr) throw saveErr;

                    if (saveRes && saveRes.status === 'conflict') {
                        const serverExists = Boolean(saveRes.exists);
                        const serverPurchase = Number(saveRes.purchase || 0);
                        const serverDamage = Number(saveRes.damage || 0);
                        const idx = entries.findIndex(e => e.item_id === item.id && e.day === day);
                        if (serverExists) {
                            const updatedEntry = { user_id: user.id, item_id: item.id, day, purchase: serverPurchase, damage: serverDamage };
                            if (idx >= 0) entries[idx] = updatedEntry; else entries.push(updatedEntry);
                        } else if (idx >= 0) {
                            entries.splice(idx, 1);
                        }
                        if (!pendingDraft) {
                            draftState = L.setEntryDraft(draftState, day, item.id, {
                                purchase: p.value,
                                damage: d.value,
                                basePurchase,
                                baseDamage,
                                baseExists,
                                updatedAt: new Date().toISOString(),
                            });
                            persistDrafts();
                            pendingDraft = draftState.entries[day][item.id];
                            savedRevision = pendingDraft.revision;
                        }
                        if (typeof confirm === 'function') {
                            const serverSummary = serverExists
                                ? `Purchase ${fmt(serverPurchase)}, Damage ${fmt(serverDamage)}`
                                : 'No saved entry (day may have been cleared)';
                            const ok = confirm(`Saved server values for ${item.name} on ${day} changed on the server since you started editing (Server now: ${serverSummary}; Your edit: Purchase ${fmt(purchase)}, Damage ${fmt(damage)}). Replace server data with your values?`);
                            if (!ok) {
                                inFlightEntrySaves.delete(saveKey);
                                renderStock();
                                updateDraftStatus();
                                renderCorrections();
                                return;
                            }
                        }
                        const retry = await _supabase.rpc('inventory_save_entry', {
                            p_item_id: item.id,
                            p_day: day,
                            p_purchase: purchase,
                            p_damage: damage,
                            p_expected_exists: serverExists,
                            p_expected_purchase: serverPurchase,
                            p_expected_damage: serverDamage,
                        });
                        if (retry.error) throw retry.error;
                        if (retry.data && retry.data.status === 'conflict') {
                            await refresh();
                            throw new Error('Server data changed again while confirming. Review the refreshed values and try saving again.');
                        }
                    }

                    const latestDraft = (draftState.entries[day] || {})[item.id];
                    if (latestDraft) {
                        if (savedRevision > 0 && latestDraft.revision === savedRevision) {
                            draftState = L.clearEntryDraftIfRevision(draftState, day, item.id, savedRevision);
                        } else {
                            draftState = L.rebaseEntryDraft(draftState, day, item.id, purchase, damage, true);
                        }
                        persistDrafts();
                    }
                    inFlightEntrySaves.delete(saveKey);
                    await refresh();
                    if (!opts.silent) message('Stock movements saved. Later balances are recalculated.');
                } catch (e) {
                    if (opts.silent) throw e;
                    fail(e);
                } finally {
                    inFlightEntrySaves.delete(saveKey);
                    save.disabled = false;
                }
            };
            save.onclick = () => saveRow();
            rowSavers.push({ name: item.name, saveRow, isDirty: () => !discardRow.hidden });

            discardRow.onclick = () => {
                draftState = L.clearEntryDraft(draftState, day, item.id);
                persistDrafts();
                renderStock();
                updateDraftStatus();
                renderCorrections();
                message(`Discarded unsaved draft for ${item.name} on ${day}.`);
            };

            let td = el('td'); td.append(p); tr.append(td, el('td', fmt(rowState.sale)));
            td = el('td'); td.append(d); tr.append(td, closingTd);
            td = el('td'); const actions = el('div', undefined, 'row-actions'); actions.append(save, discardRow); td.append(actions); tr.append(td);
            body.append(tr);
        }
        if (!items.length) { const tr = el('tr'), td = el('td','Add a stock item to get started.'); td.colSpan=7; tr.append(td); body.append(tr); }
        updateSaveAllButton(rowSavers.filter(r => r.isDirty()).length);
        renderDaySummary(sum);
    }
    function startEditingItem(item) {
        editing = item.id;
        editingBase = { id: item.id, name: item.name, opening: Number(item.initial_opening), startDate: item.start_date };
        $('item-name').value = item.name;
        // The start date stays editable: an item first entered mid-month must be movable to the month start.
        $('item-start').disabled = false;
        $('item-start').value = item.start_date;
        $('item-opening').value = item.initial_opening;
        setItemSubmitText('Save item');
        $('cancel-edit').hidden = false;
        syncItemFormDraft(item);
        $('item-name').focus();
    }
    function renderItems() {
        const list = $('item-list'); list.replaceChildren();
        for (const item of items) {
            const row = el('div', undefined, 'item-row'), button = el('button');
            button.type = 'button';
            button.append(svgIcon('edit', 'icon icon-sm'), el('span', 'Edit'));
            button.setAttribute('aria-label', `Edit item ${item.name}`);
            row.append(el('span', `${item.name} · starts ${item.start_date} · opening ${fmt(Number(item.initial_opening))}`), button); list.append(row);
            button.onclick = () => startEditingItem(item);
        }
    }
    function syncItemFormDraft(editSource = null) {
        const name = $('item-name').value, startDate = $('item-start').value, opening = $('item-opening').value;
        const currentItem = editSource || (editing ? items.find(i => i.id === editing) : null);
        if (!editing && !name && !opening && startDate === $('day').value && !inFlightFormSave) {
            draftState = L.clearItemFormDraft(draftState);
        } else {
            const prior = draftState.itemForm;
            draftState = L.setItemFormDraft(draftState, {
                editingId: editing,
                name,
                startDate,
                opening,
                baseName: currentItem ? currentItem.name : (prior && prior.editingId === editing ? prior.baseName : (editingBase && editingBase.id === editing ? editingBase.name : null)),
                baseOpening: currentItem ? Number(currentItem.initial_opening) : (prior && prior.editingId === editing ? prior.baseOpening : (editingBase && editingBase.id === editing ? editingBase.opening : null)),
                baseStartDate: currentItem ? currentItem.start_date : (prior && prior.editingId === editing ? prior.baseStartDate : (editingBase && editingBase.id === editing ? editingBase.startDate : null)),
            });
        }
        persistDrafts();
        updateItemDraftNote();
        updateDraftStatus();
    }
    function resetForm(clearDraft = true) {
        editing = null; editingBase = null; $('item-form').reset(); $('item-start').disabled = false; $('item-start').value = $('day').value;
        setItemSubmitText('Add item'); $('cancel-edit').hidden = true;
        if (clearDraft) {
            draftState = L.clearItemFormDraft(draftState);
            persistDrafts();
            updateItemDraftNote();
            updateDraftStatus();
        }
    }
    $('cancel-edit').onclick = () => resetForm(true);
    if ($('discard-item-draft')) $('discard-item-draft').onclick = () => { resetForm(true); message('Pending item form draft discarded.'); };
    for (const fieldId of ['item-name', 'item-start', 'item-opening']) {
        $(fieldId).oninput = () => syncItemFormDraft();
        $(fieldId).onchange = () => syncItemFormDraft();
    }
    $('item-form').onkeydown = e => { if (e.key === 'Escape' && editing) { e.preventDefault(); resetForm(true); } };
    $('item-form').onsubmit = async event => {
        event.preventDefault();
        const button = $('item-submit');
        button.disabled = true;
        inFlightFormSave = true;
        try {
            const name = $('item-name').value.trim(), start = $('item-start').value, rawOpening = $('item-opening').value, opening = L.number(rawOpening, 'Initial opening');
            if (!name || !start) throw new Error('Enter an item name and start date');
            const submitEditingId = editing, submitBase = editingBase;
            let submitDraft = draftState.itemForm;
            let savedFormRev = submitDraft ? submitDraft.revision : 0;

            if (submitEditingId) {
                // Fresh pre-write read of the item record (brief TOCTOU window remains before update).
                const { data: serverItem, error: readErr } = await _supabase
                    .from('inventory_items')
                    .select('id, name, start_date, initial_opening')
                    .eq('user_id', user.id)
                    .eq('id', submitEditingId)
                    .maybeSingle();
                if (readErr) throw readErr;

                const baseName = submitDraft && submitDraft.baseName !== null
                    ? submitDraft.baseName
                    : (submitBase && submitBase.id === submitEditingId ? submitBase.name : null);
                const baseOpening = submitDraft && submitDraft.baseOpening !== null
                    ? submitDraft.baseOpening
                    : (submitBase && submitBase.id === submitEditingId ? submitBase.opening : null);
                const staleInfo = L.isItemFormDraftStale(
                    { editingId: submitEditingId, baseName, baseOpening },
                    serverItem ? [serverItem] : []
                );
                if (staleInfo.missing) {
                    throw new Error('The item you were editing is no longer available on the server. Discard draft or add as a new item.');
                }
                if (staleInfo.stale) {
                    const idx = items.findIndex(i => i.id === submitEditingId);
                    if (idx >= 0) items[idx] = serverItem;
                    if (!submitDraft) {
                        draftState = L.setItemFormDraft(draftState, {
                            editingId: submitEditingId,
                            name,
                            startDate: start,
                            opening: rawOpening,
                            baseName,
                            baseOpening,
                        });
                        persistDrafts();
                        submitDraft = draftState.itemForm;
                        savedFormRev = submitDraft.revision;
                    }
                    if (typeof confirm === 'function') {
                        const ok = confirm(`Server values for "${staleInfo.serverItem.name}" changed on the server since this edit started (Server now: ${staleInfo.serverItem.name}, opening ${fmt(Number(staleInfo.serverItem.initial_opening))}). Save your draft changes anyway?`);
                        if (!ok) {
                            updateItemDraftNote();
                            updateDraftStatus();
                            return;
                        }
                    }
                }
            }

            if (submitEditingId) {
                // Moving the start date later would hide saved work, so block it and say which days are in the way.
                const previousStart = items.find(i => i.id === submitEditingId)?.start_date || (submitBase && submitBase.startDate) || null;
                if (previousStart && start > previousStart) {
                    const blocked = new Set();
                    for (const row of entries) if (row.item_id === submitEditingId && row.day < start) blocked.add(row.day);
                    for (const im of imports) if (im.day < start && Number((im.sales || {})[submitEditingId] || 0) > 0) blocked.add(im.day);
                    if (blocked.size) {
                        const days = [...blocked].sort();
                        throw new Error(`Cannot move the start date to ${start}: ${name} already has saved data on ${days.slice(0, 5).join(', ')}${days.length > 5 ? ' and more' : ''}. Pick an earlier start date, or clear those days in the Corrections tab first.`);
                    }
                }
            }
            const query = submitEditingId
                ? _supabase.from('inventory_items').update({ name, start_date: start, initial_opening: opening }).eq('user_id', user.id).eq('id', submitEditingId)
                : _supabase.from('inventory_items').insert({ user_id: user.id, name, start_date: start, initial_opening: opening });
            const currentChoices = report ? Object.fromEntries([...document.querySelectorAll('#mapping-list select')].map(s => [s.dataset.key, s.value]).filter(([, v]) => v)) : null;
            const { error } = await query;
            if (error) throw error;

            const latestForm = draftState.itemForm;
            const hasNewerFormEdit = Boolean(latestForm && (savedFormRev === 0 || latestForm.revision !== savedFormRev));
            inFlightFormSave = false;
            if (!hasNewerFormEdit) {
                draftState = L.clearItemFormDraftIfRevision(draftState, savedFormRev);
                persistDrafts();
                await refresh();
                resetForm(false);
            } else {
                if (submitEditingId && latestForm.editingId === submitEditingId) {
                    draftState = L.rebaseItemFormDraft(draftState, name, opening);
                } else if (!submitEditingId) {
                    editing = null;
                    editingBase = null;
                }
                persistDrafts();
                await refresh();
            }
            updateItemDraftNote();
            updateDraftStatus();
            invalidate();
            if (report) renderMappings(currentChoices);
            message(submitEditingId
                ? `Item saved. Opening now applies from ${start}; later balances are recalculated.`
                : `Item added with opening from ${start}.`);
        } catch (e) {
            fail(e);
        } finally {
            inFlightFormSave = false;
            button.disabled = false;
        }
    };
    function applyDateChange(newDay) {
        if (!newDay) return;
        $('day').value = newDay;
        draftState.selectedDay = newDay;
        persistDrafts();
        hideClearConfirm();
        hideRestoreConflict();
        renderStock();
        renderImportStatus();
        invalidate();
        if (!editing && !draftState.itemForm) $('item-start').value = newDay;
        updateDraftStatus();
        renderCorrections();
        if (report) reportInfo();
    }
    function shiftDay(delta) {
        const current = $('day').value || today();
        const d = new Date(`${current}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) return;
        d.setUTCDate(d.getUTCDate() + delta);
        applyDateChange(d.toISOString().slice(0, 10));
    }
    if ($('save-all-rows')) $('save-all-rows').onclick = () => saveAllRows();
    if ($('item-start-month')) $('item-start-month').onclick = () => {
        const base = $('day').value || today();
        $('item-start').value = `${base.slice(0, 7)}-01`;
        syncItemFormDraft();
        message(`Start date set to the month start (${$('item-start').value}).`);
    };
    $('day').onchange=() => applyDateChange($('day').value);
    if ($('prev-day')) $('prev-day').onclick = () => shiftDay(-1);
    if ($('next-day')) $('next-day').onclick = () => shiftDay(1);
    function discardDraftsForDay(targetDay) {
        const count = L.dayDraftCount(draftState, targetDay);
        if (!count) return false;
        if (typeof confirm === 'function' && !confirm(`Discard ${count} unsaved stock draft(s) on ${targetDay}? Drafts on other dates will be kept.`)) return false;
        const nextEntries = { ...draftState.entries };
        delete nextEntries[targetDay];
        draftState = L.sanitizeDraftState({ ...draftState, entries: nextEntries });
        persistDrafts();
        hideRestoreConflict();
        renderStock();
        updateDraftStatus();
        renderCorrections();
        message(`Discarded ${count} unsaved draft(s) for ${targetDay}.`);
        return true;
    }
    if ($('discard-day-drafts')) $('discard-day-drafts').onclick = () => {
        const day = $('day').value || '';
        discardDraftsForDay(day);
    };
    if ($('discard-drafts')) $('discard-drafts').onclick = () => {
        const summary = L.draftSummary(draftState, $('day').value || '');
        if (summary.totalCount && typeof confirm === 'function' && !confirm('Discard all unsaved stock row drafts across all dates and any pending item form draft?')) return;
        const keepDay = $('day').value || today();
        draftState = { selectedDay: '', itemForm: null, entries: {} };
        restoredNotice = false;
        persistDrafts();
        draftState.selectedDay = keepDay;
        hideRestoreConflict();
        resetForm(true);
        renderStock();
        updateDraftStatus();
        renderCorrections();
        message('All unsaved local drafts discarded.');
    };

    function prepareSheetSnapshot() {
        const day = assertDay();
        const dayDrafts = draftState.entries[day] || {};
        const rows = L.buildSheetExportRows(items, day, entries, imports, dayDrafts);
        if (rows.some(r => r.invalidDraft)) {
            throw new Error('Fix or discard invalid draft numbers before printing or exporting.');
        }
        const draftCount = rows.filter(r => r.isDraft).length;
        if (draftCount > 0 && typeof confirm === 'function') {
            const ok = confirm(`The stock sheet for ${day} includes unsaved draft values for ${draftCount} item(s) that have not been saved to Supabase yet. Continue and label them as DRAFTS?`);
            if (!ok) return null;
        }
        return { day, rows, hasDrafts: draftCount > 0, draftCount };
    }

    function renderPrintSheet(snap) {
        const container = $('print-sheet');
        if (!container) return;
        container.replaceChildren();
        const header = el('div', undefined, 'print-header');
        const left = el('div');
        left.append(el('h1', restaurantName), el('div', 'Daily Stock Sheet (pieces)'));
        const meta = el('div', undefined, 'print-meta');
        meta.append(
            el('div', `Stock date: ${snap.day}`),
            el('div', snap.hasDrafts ? 'Status: CONTAINS UNSAVED DRAFTS' : 'Status: Saved sheet')
        );
        header.append(left, meta);
        container.append(header);

        if (snap.hasDrafts) {
            container.append(el('div', `WARNING: This printout includes ${snap.draftCount} row(s) with unsaved draft values (marked [Draft]) not yet saved to Supabase.`, 'print-draft-banner'));
        }

        const table = el('table'), thead = el('thead'), headRow = el('tr');
        for (const [label, cls] of [['Item',''], ['Opening','num'], ['Purchase','num'], ['Sale','num'], ['Closing','num'], ['Damage','num']]) {
            headRow.append(el('th', label, cls));
        }
        thead.append(headRow);
        const tbody = el('tbody');
        for (const row of snap.rows) {
            const tr = el('tr', undefined, row.isDraft ? 'print-draft-row' : '');
            const itemTd = el('td');
            itemTd.append(document.createTextNode(row.itemName));
            if (row.isDraft) {
                itemTd.append(document.createTextNode(' '), el('span', '[Draft]', 'print-draft-tag'));
            }
            tr.append(itemTd);
            if (!row.available) {
                const td = el('td', `Starts ${row.startDate}`); td.colSpan = 5; tr.append(td);
                tbody.append(tr); continue;
            }
            const pText = row.isDraft ? `${fmt(row.purchase)} (Draft)` : fmt(row.purchase);
            const dText = row.isDraft ? `${fmt(row.damage)} (Draft)` : fmt(row.damage);
            const cText = row.isDraft ? `${fmt(row.closing)} (Draft)` : fmt(row.closing);
            tr.append(
                el('td', fmt(row.opening), 'num'),
                el('td', pText, 'num'),
                el('td', fmt(row.sale), 'num'),
                el('td', cText, row.isShortage ? 'num print-shortage' : 'num'),
                el('td', dText, 'num')
            );
            tbody.append(tr);
        }
        if (!snap.rows.length) {
            const tr = el('tr'), td = el('td', 'No stock items recorded.'); td.colSpan = 6; tr.append(td); tbody.append(tr);
        }
        table.append(thead, tbody);
        container.append(table);
        container.append(el('div', `Generated locally in browser on ${new Date().toLocaleString()} · Read-only A4 print view (no saved data modified).`, 'print-footer'));
    }

    function measureRestaurantHeader(ctx, innerW) {
        ctx.font = 'bold 34px sans-serif';
        const restLines = L.wrapLinesByMeasure(restaurantName, innerW - 340, s => ctx.measureText(s).width);
        const headerLineY = 136 + Math.max(0, restLines.length - 1) * 38;
        return { restLines, headerLineY };
    }

    function drawA4StockPage(snap, pageSliceRows, pageNum, totalPages, headerLayout) {
        const W = 1240, H = 1754;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context is unavailable in this browser');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        const M = 60, innerW = W - M * 2;
        const hdr = headerLayout || measureRestaurantHeader(ctx, innerW);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'left';
        hdr.restLines.forEach((line, idx) => {
            ctx.fillText(line, M, 84 + idx * 38);
        });

        ctx.fillStyle = '#475569';
        ctx.font = '600 20px sans-serif';
        ctx.fillText('Daily Stock Sheet (pieces)', M, hdr.headerLineY - 18);

        ctx.textAlign = 'right';
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 22px sans-serif';
        ctx.fillText(`Date: ${snap.day}`, W - M, 82);
        ctx.fillStyle = '#475569';
        ctx.font = '600 18px sans-serif';
        ctx.fillText(`Page ${pageNum} of ${totalPages}`, W - M, 114);

        ctx.strokeStyle = '#1e293b';
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(M, hdr.headerLineY);
        ctx.lineTo(W - M, hdr.headerLineY);
        ctx.stroke();

        let y = hdr.headerLineY + 18;
        if (snap.hasDrafts) {
            ctx.fillStyle = '#fffbeb';
            ctx.fillRect(M, y, innerW, 44);
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = 2;
            ctx.strokeRect(M, y, innerW, 44);
            ctx.fillStyle = '#92400e';
            ctx.font = 'bold 18px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`CONTAINS UNSAVED DRAFTS (${snap.draftCount} row${snap.draftCount === 1 ? '' : 's'} labeled DRAFT — not yet saved)`, M + 14, y + 28);
            y += 60;
        }

        const cols = [
            { label: 'Item', x: M, w: 360, align: 'left' },
            { label: 'Opening', x: M + 360, w: 152, align: 'right' },
            { label: 'Purchase', x: M + 512, w: 152, align: 'right' },
            { label: 'Sale', x: M + 664, w: 152, align: 'right' },
            { label: 'Closing', x: M + 816, w: 152, align: 'right' },
            { label: 'Damage', x: M + 968, w: 152, align: 'right' },
        ];
        const headH = 46;
        ctx.fillStyle = '#f1f5f9';
        ctx.fillRect(M, y, innerW, headH);
        ctx.strokeStyle = '#cbd5e1';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(M, y, innerW, headH);
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 18px sans-serif';
        for (const c of cols) {
            ctx.textAlign = c.align;
            const tx = c.align === 'right' ? c.x + c.w - 12 : c.x + 12;
            ctx.fillText(c.label, tx, y + 30);
        }
        y += headH;

        for (const row of pageSliceRows) {
            ctx.font = '600 18px sans-serif';
            const itemLines = Array.isArray(row.nameLines) && row.nameLines.length
                ? row.nameLines
                : L.wrapLinesByMeasure(row.itemName, cols[0].w - 24, s => ctx.measureText(s).width);
            const fallbackH = Math.max(46, itemLines.length * 24 + 22 + (row.isDraft && !row.isContinuation ? 24 : 0) + (row.isContinuation ? 22 : 0) + (row.hasContinuation ? 20 : 0));
            const rowH = row.rowHeight || fallbackH;
            if (row.isDraft) {
                ctx.fillStyle = '#fffbeb';
                ctx.fillRect(M, y, innerW, rowH);
            }
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            ctx.strokeRect(M, y, innerW, rowH);

            let textY = y + 26;
            ctx.textAlign = 'left';
            if (row.isContinuation) {
                ctx.fillStyle = '#475569';
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText('(continued)', cols[0].x + 12, textY);
                textY += 22;
            }
            ctx.fillStyle = '#0f172a';
            ctx.font = '600 18px sans-serif';
            for (const line of itemLines) {
                ctx.fillText(line, cols[0].x + 12, textY);
                textY += 24;
            }
            if (row.isDraft && !row.isContinuation) {
                ctx.fillStyle = '#92400e';
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText('DRAFT (unsaved)', cols[0].x + 12, textY);
                textY += 24;
            }
            if (row.hasContinuation) {
                ctx.fillStyle = '#475569';
                ctx.font = 'bold 13px sans-serif';
                ctx.fillText('(continued on next page...)', cols[0].x + 12, textY);
            }

            if (row.isContinuation) {
                ctx.textAlign = 'right';
                ctx.fillStyle = '#64748b';
                ctx.font = '15px sans-serif';
                for (let ci = 1; ci < cols.length; ci++) {
                    ctx.fillText('cont.', cols[ci].x + cols[ci].w - 12, y + 28);
                }
            } else if (!row.available) {
                ctx.textAlign = 'left';
                ctx.fillStyle = '#64748b';
                ctx.font = '17px sans-serif';
                ctx.fillText(`Starts ${row.startDate}`, cols[1].x + 12, y + 28);
            } else {
                const nums = [
                    [cols[1], fmt(row.opening), '#0f172a'],
                    [cols[2], row.isDraft ? `${fmt(row.purchase)}*` : fmt(row.purchase), row.isDraft ? '#92400e' : '#0f172a'],
                    [cols[3], fmt(row.sale), '#0f172a'],
                    [cols[4], row.isDraft ? `${fmt(row.closing)}*` : fmt(row.closing), row.isShortage ? '#b91c1c' : (row.isDraft ? '#92400e' : '#0f172a')],
                    [cols[5], row.isDraft ? `${fmt(row.damage)}*` : fmt(row.damage), row.isDraft ? '#92400e' : '#0f172a'],
                ];
                for (const [col, val, color] of nums) {
                    ctx.textAlign = 'right';
                    ctx.fillStyle = color;
                    ctx.font = '600 18px sans-serif';
                    if (ctx.measureText(val).width > col.w - 20) ctx.font = '600 15px sans-serif';
                    if (ctx.measureText(val).width > col.w - 20) ctx.font = '600 13px sans-serif';
                    ctx.fillText(val, col.x + col.w - 12, y + 28);
                }
            }
            y += rowH;
        }

        if (!pageSliceRows.length) {
            ctx.strokeStyle = '#e2e8f0';
            ctx.strokeRect(M, y, innerW, 54);
            ctx.fillStyle = '#64748b';
            ctx.font = '18px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText('No stock items recorded.', M + 12, y + 34);
        }

        ctx.fillStyle = '#64748b';
        ctx.font = '15px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(snap.hasDrafts ? '* Draft values included (not yet saved to Supabase). Local browser export.' : 'Saved stock sheet values · Generated locally in browser (no third-party upload).', M, H - 42);
        ctx.textAlign = 'right';
        ctx.fillText(`Page ${pageNum} of ${totalPages}`, W - M, H - 42);
        return canvas;
    }

    function canvasToPngBlob(canvas) {
        return new Promise((resolve, reject) => {
            if (typeof canvas.toBlob !== 'function') { reject(new Error('PNG export is not supported in this browser')); return; }
            canvas.toBlob(blob => {
                if (blob) resolve(blob);
                else reject(new Error('Could not encode PNG image'));
            }, 'image/png');
        });
    }

    function renderExportFallback(entriesList, noteText) {
        const box = $('export-fallback');
        if (!box) return;
        box.replaceChildren();
        box.append(el('p', noteText));
        const links = el('div', undefined, 'export-links');
        for (const item of entriesList) {
            const a = el('a', undefined, 'export-link');
            a.append(svgIcon('download', 'icon icon-sm'), el('span', `Download ${item.label}`));
            a.href = item.url;
            a.download = item.fileName;
            links.append(a);
        }
        const clearBtn = el('button', 'Clear downloads', 'btn-secondary');
        clearBtn.type = 'button';
        clearBtn.onclick = () => { clearExportUrls(); box.replaceChildren(); box.hidden = true; };
        links.append(clearBtn);
        box.append(links);
        box.hidden = false;
    }

    let justPreparedPrint = false;
    if ($('print-sheet-btn')) $('print-sheet-btn').onclick = () => {
        try {
            const snap = prepareSheetSnapshot();
            if (!snap) return;
            renderPrintSheet(snap);
            if (typeof window === 'undefined' || typeof window.print !== 'function') {
                throw new Error('Browser print is unavailable on this device; use Share / Export A4 PNG instead.');
            }
            justPreparedPrint = true;
            try { window.print(); } finally { justPreparedPrint = false; }
        } catch (e) { justPreparedPrint = false; fail(e); }
    };
    if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
        window.addEventListener('beforeprint', () => {
            if (justPreparedPrint) return;
            const day = $('day').value;
            if (!day) return;
            const rows = L.buildSheetExportRows(items, day, entries, imports, draftState.entries[day] || {});
            if (rows.some(r => r.invalidDraft)) {
                const container = $('print-sheet');
                container.replaceChildren(el('p', 'Cannot print: one or more unsaved draft values are invalid. Fix or discard them, then use Print A4.'));
                return;
            }
            renderPrintSheet({
                day,
                rows,
                hasDrafts: rows.some(r => r.isDraft),
                draftCount: rows.filter(r => r.isDraft).length,
            });
        });
        window.addEventListener('afterprint', () => { justPreparedPrint = false; });
    }

    if ($('export-png-btn')) $('export-png-btn').onclick = async () => {
        const btn = $('export-png-btn');
        btn.disabled = true;
        try {
            const snap = prepareSheetSnapshot();
            if (!snap) { btn.disabled = false; return; }
            const measureCanvas = document.createElement('canvas');
            measureCanvas.width = 1240; measureCanvas.height = 1754;
            const mCtx = measureCanvas.getContext('2d');
            if (!mCtx) throw new Error('Canvas 2D context is unavailable in this browser');
            const headerLayout = measureRestaurantHeader(mCtx, 1240 - 120);
            const tableBodyStartY = headerLayout.headerLineY + 18 + (snap.hasDrafts ? 60 : 0) + 46;
            const maxBodyHeight = (1754 - 74) - tableBodyStartY;
            mCtx.font = '600 18px sans-serif';
            const pages = L.layoutSheetPages(snap.rows, {
                nameMaxWidth: 360 - 24,
                maxBodyHeight,
                measureName: s => mCtx.measureText(s).width,
                lineHeight: 24,
                padY: 22,
                minRowHeight: 46,
                draftBadgeHeight: 24,
                contHeaderHeight: 22,
                contFooterHeight: 20,
            });
            const files = [], downloadEntries = [];
            clearExportUrls();
            for (let i = 0; i < pages.length; i++) {
                const canvas = drawA4StockPage(snap, pages[i].rows, i + 1, pages.length, headerLayout);
                const blob = await canvasToPngBlob(canvas);
                const suffix = pages.length > 1 ? `-page-${i + 1}-of-${pages.length}` : '';
                const draftTag = snap.hasDrafts ? '-DRAFT' : '';
                const fileName = `stock-sheet-${snap.day}${draftTag}${suffix}.png`;
                const url = URL.createObjectURL(blob);
                exportUrls.push(url);
                downloadEntries.push({ url, fileName, label: pages.length > 1 ? `Page ${i + 1}/${pages.length}` : 'A4 PNG' });
                if (typeof File === 'function') files.push(new File([blob], fileName, { type: 'image/png' }));
            }

            let shared = false, shareReason = '';
            if (files.length && typeof navigator !== 'undefined' && typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files })) {
                try {
                    await navigator.share({
                        title: `${restaurantName} Stock Sheet (${snap.day})`,
                        text: snap.hasDrafts ? `Stock sheet for ${snap.day} (includes UNSAVED DRAFTS).` : `Daily stock sheet for ${snap.day}.`,
                        files,
                    });
                    shared = true;
                } catch (err) {
                    shareReason = err && err.name === 'AbortError'
                        ? 'Share sheet dismissed; download the generated A4 PNG file(s) below.'
                        : 'Native image sharing was unavailable or denied; download the generated A4 PNG file(s) below.';
                }
            } else {
                shareReason = 'Native PNG file sharing is not supported in this browser; download the A4 PNG file(s) below.';
            }

            if (shared) {
                renderExportFallback(downloadEntries, `Shared ${files.length} A4 PNG page(s) locally. You can also download copies below:`);
                message(`Shared A4 stock sheet PNG (${files.length} page${files.length === 1 ? '' : 's'}).`);
            } else {
                renderExportFallback(downloadEntries, shareReason);
                if (downloadEntries[0]) {
                    const a = document.createElement('a');
                    a.href = downloadEntries[0].url;
                    a.download = downloadEntries[0].fileName;
                    a.click();
                }
                message(pages.length > 1 ? `Generated ${pages.length} A4 PNG pages for download below.` : 'Generated A4 PNG download.');
            }
        } catch (e) { fail(e); } finally { btn.disabled = false; }
    };
    function reportInfo() { const mismatch=report.date !== $('day').value; $('report-info').textContent=`Report date: ${report.date} · ${report.dishes.length} distinct dishes. ${mismatch ? 'Date mismatch: select the report date before saving.' : ''}`; $('report-info').className=mismatch ? 'warning' : ''; }
    function renderMappings(preservedChoices = null) {
        reportInfo(); const list=$('mapping-list'); list.replaceChildren();
        const saved=L.savedChoiceMap(mappings), validIds=new Set(items.map(i=>i.id));
        const suggestions=L.suggestMappings(report,items,saved);
        for (const dish of report.dishes) {
            const match=suggestions[dish.key];
            const row=el('div',undefined,'mapping-row'), info=el('div',undefined,'mapping-info'), controls=el('div',undefined,'mapping-controls');
            const label=el('span',`${dish.category || 'No category'} · ${dish.item} · code ${dish.code || '—'} · ${fmt(dish.qty)} plates → ${fmt(dish.pieces)} pieces`,'dish-label');
            const note=el('span',undefined,'match-note');
            const select=el('select');
            select.setAttribute('aria-label',`Mapping for ${dish.category} ${dish.item} ${dish.code}`); select.dataset.key=dish.key;
            const option=(value, name) => { const o=el('option',name); o.value=value; select.append(o); };
            option('', 'Choose item or ignore'); option('ignore','Ignore this dish'); for(const item of items) option(item.id,item.name);
            let initial=match.selected;
            if (preservedChoices && Object.prototype.hasOwnProperty.call(preservedChoices,dish.key)) {
                const preserved=preservedChoices[dish.key];
                if (preserved==='ignore' || validIds.has(preserved)) initial=preserved;
            }
            select.value=initial;
            const acceptBtn=match.status==='suggested' ? el('button',`Use suggestion: ${match.suggestion.name}`,'btn-suggest') : null;
            if (acceptBtn) {
                acceptBtn.type='button';
                acceptBtn.onclick=() => { select.value=match.suggestion.id; invalidate(); syncRow(); };
                controls.append(acceptBtn);
            }
            function syncRow() {
                const chosen=select.value;
                const chosenName=chosen==='ignore' ? 'Ignore this dish' : (items.find(i=>i.id===chosen)?.name || '');
                if (match.status==='suggested') {
                    if (chosen===match.suggestion.id) {
                        note.textContent=`Accepted suggestion: ${match.suggestion.name} (${match.reason})`;
                        note.className='match-note match-accepted';
                        if (acceptBtn) acceptBtn.hidden=true;
                    } else if (!chosen) {
                        note.textContent=`Suggested: ${match.suggestion.name} — ${match.reason} (review required)`;
                        note.className='match-note match-suggested';
                        if (acceptBtn) acceptBtn.hidden=false;
                    } else {
                        note.textContent=`Selected manually: ${chosenName} (suggestion was ${match.suggestion.name})`;
                        note.className='match-note match-saved';
                        if (acceptBtn) acceptBtn.hidden=false;
                    }
                    return;
                }
                if ((match.status==='saved' || match.status==='ignored') && chosen===match.selected) {
                    note.textContent=match.reason;
                    note.className=match.status==='ignored' ? 'match-note match-ignored' : 'match-note match-saved';
                } else if (chosen) {
                    note.textContent=`Selected: ${chosenName}`;
                    note.className=chosen==='ignore' ? 'match-note match-ignored' : 'match-note match-saved';
                } else if (match.status==='ambiguous') {
                    note.textContent=match.reason;
                    note.className='match-note match-ambiguous';
                } else {
                    note.textContent=match.reason;
                    note.className='match-note match-none';
                }
            }
            select.onchange=() => { invalidate(); syncRow(); };
            syncRow();
            info.append(label,note); controls.append(select); row.append(info,controls); list.append(row);
        }
    }
    $('file').onchange=async () => { const fileVersion=++fileRevision; report=null; invalidate(); clearImportError(); $('import-area').hidden=true; try {
        const file=$('file').files[0]; if(!file) return; if(!/\.(xls|xlsx)$/i.test(file.name)) throw new Error('Choose an .xls or .xlsx file');
        if(file.size > 10*1024*1024) throw new Error('Report exceeds 10 MB'); if(typeof XLSX === 'undefined') throw new Error('Spreadsheet reader could not load; reload the page');
        const buffer=await file.arrayBuffer(); if(fileVersion!==fileRevision) return;
        const book=XLSX.read(buffer, {type:'array', cellDates:false});
        report=L.parseReport(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {header:1, raw:false, defval:''}));
        renderMappings(); $('import-area').hidden=false; message('Review saved mappings and suggested matches before previewing.');
    } catch(e) { fail(e); } };
    $('preview').onclick=async () => { invalidate(); clearImportError(); const version=revision; try {
        const day=assertDay(); if (!report || report.date !== day) throw new Error('Report date does not match selected stock date');
        const choices={}; document.querySelectorAll('#mapping-list select').forEach(s => choices[s.dataset.key]=s.value);
        const result=L.preview(report,choices); if(result.unresolved.length) throw new Error(`Review or choose a stock item or ignore for all ${result.unresolved.length} unmapped dishes`);
        for(const id of Object.keys(result.totals)) { const item=items.find(i=>i.id===id); if(!item || item.start_date > day) throw new Error('A mapped item is missing or starts after the report date'); L.number(result.totals[id], 'Total sales'); }
        // Hash canonical report content and choices; filenames and spreadsheet formatting are irrelevant.
        const canonical=JSON.stringify({date:report.date, dishes:report.dishes.map(d=>[d.key,d.qty,choices[d.key]]).sort((a,b)=>a[0].localeCompare(b[0]))});
        const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(canonical)); const hash=Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
        // Re-read server state so replacement is based on the actual current version.
        const currentImports=await all('inventory_imports'); if(version!==revision) return; imports=currentImports; const old=imports.find(x=>x.day===day); const decision=L.importDecision(old?.fingerprint,hash,false);
        const totals=$('totals'); totals.replaceChildren(); for(const [id,amount] of Object.entries(result.totals)) totals.append(el('p',`${items.find(i=>i.id===id).name}: ${fmt(amount)} pieces`));
        if(!Object.keys(result.totals).length) totals.append(el('p','All dishes are ignored; sales will be zero.'));
        $('replacement').textContent=decision==='duplicate' ? 'This report and mapping are already imported; no sales will be added.' : old ? 'A different import exists for this day. Confirming will replace all its sales.' : 'No existing import for this date.';
        $('replacement').className=old ? 'warning' : ''; $('confirm-import').disabled=decision==='duplicate';
        previewData={day, hash, sales:result.totals, expected:old?.fingerprint || null, choices}; $('preview-area').hidden=false;
    } catch(e) { fail(e); } };
    function showImportError(err) {
        const box = $('import-error'), txt = $('import-error-text');
        const raw = (err && (err.message || err.details || err.hint)) || String(err);
        let detail = raw;
        if (/could not find the function|pgrst202|schema cache/i.test(raw)) {
            detail = `${raw} — the database is missing the sales-save function. Run inventory-schema.sql (inventory_save_import) in the Supabase SQL editor, then preview and confirm again.`;
        } else if (/import changed since preview/i.test(raw)) {
            detail = `${raw} — click "Preview totals" again, then confirm.`;
        } else if (/unknown item or import before item start date/i.test(raw)) {
            detail = `${raw} — check that every mapped item starts on or before the stock date.`;
        } else if (/row-level security|permission denied/i.test(raw)) {
            detail = `${raw} — this account is not allowed to save inventory imports; check the inventory RLS policies.`;
        }
        if (txt) txt.textContent = detail;
        if (box) box.hidden = false;
        fail(err);
    }
    function clearImportError() { const box = $('import-error'), txt = $('import-error-text'); if (box) box.hidden = true; if (txt) txt.textContent = ''; }
    function renderImportStatus() {
        const box = $('import-status');
        if (!box) return;
        const day = $('day').value || '';
        if (!day) { box.textContent = ''; box.hidden = true; return; }
        const row = imports.find(im => im.day === day);
        box.hidden = false;
        if (!row) {
            box.className = 'correction-summary';
            box.textContent = `No saved sales for ${day} yet. Import a POS report to fill the Sale column.`;
            return;
        }
        const count = Object.keys(row.sales || {}).length;
        const total = daySalesTotal(day);
        box.className = total > 0 ? 'correction-summary' : 'correction-summary warning';
        box.textContent = total > 0
            ? `Saved sales for ${day}: ${count} item${count === 1 ? '' : 's'}, ${fmt(total)} pieces. To change them, import the report again.`
            : `A saved import for ${day} holds no readable sales (0 pieces). Re-import the report, or check that this account can read inventory_imports.`;
    }
    function daySalesTotal(day) {
        const row = imports.find(im => im.day === day);
        if (!row) return 0;
        return Object.values(row.sales || {}).reduce((sum, v) => sum + Number(v || 0), 0);
    }
    $('confirm-import').onclick=async () => { const button=$('confirm-import'); button.disabled=true; clearImportError(); try {
        const p=previewData; if(!p || p.day!==assertDay() || p.day!==report.date) throw new Error('Preview again before saving');
        if(p.expected && !confirm('Replace the existing imported sales for this day?')) { button.disabled=false; return; }
        // Saving mapping preferences does not alter any previously imported sales snapshots.
        const rows=Object.entries(p.choices).map(([key,value])=>({user_id:user.id,dish_key:key,item_id:value==='ignore'?null:value,ignored:value==='ignore'}));
        const {error:mapError}=await _supabase.from('inventory_mappings').upsert(rows,{onConflict:'user_id,dish_key'}); if(mapError) throw mapError;
        const {data,error}=await _supabase.rpc('inventory_save_import',{p_day:p.day,p_fingerprint:p.hash,p_sales:p.sales,p_expected:p.expected}); if(error) throw error;
        await refresh(); invalidate();
        // Read the row back: a save that cannot be read again shows as an empty Sale column, which used to fail silently.
        const { data: readBack, error: readErr } = await _supabase.from('inventory_imports')
            .select('day,fingerprint,sales').eq('user_id', user.id).eq('day', p.day).maybeSingle();
        const readable = !readErr && Boolean(readBack) && readBack.fingerprint === p.hash;
        const saved = daySalesTotal(p.day);
        if (data === 'duplicate' && readable) message('Already imported; no sales added.');
        else if (!readable) {
            const why = readErr ? (readErr.message || String(readErr)) : 'the saved row was not returned';
            showImportError(new Error(`Sales for ${p.day} were written, but this page cannot read them back (${why}). The Sale column stays 0 until inventory_imports is readable — run inventory-read-fix.sql in the Supabase SQL editor, then reload.`));
        } else if (saved > 0) { message(`Sales saved for ${p.day} (${fmt(saved)} pieces). Later balances are recalculated.`); setTab('sheet'); }
        else message(`Sales saved for ${p.day}, but every mapped dish came out as 0 pieces. Check the Qty column and piece counts in the report.`, true);
    } catch(e) { showImportError(e); button.disabled=false; } };
    function hideClearConfirm() {
        pendingClearScope = null;
        pendingClearRequestId = null;
        if ($('clear-confirm-panel')) $('clear-confirm-panel').hidden = true;
    }
    function hideRestoreConflict() {
        const box = $('restore-conflict-box'), txt = $('restore-conflict-text');
        if (box) box.hidden = true;
        if (txt) txt.replaceChildren();
    }
    function showRestoreConflict(reasons, draftDay = null) {
        const box = $('restore-conflict-box'), txt = $('restore-conflict-text');
        const list = Array.isArray(reasons) && reasons.length ? reasons : ['Restore stopped because one or more target slots are already occupied.'];
        if (box && txt) {
            txt.replaceChildren();
            txt.append(el('strong', 'Restore stopped (no existing data was overwritten and snapshot was kept):'));
            const ul = el('ul');
            for (const r of list) ul.append(el('li', r));
            txt.append(ul);
            if (draftDay) {
                const btn = el('button', `Discard ${draftDay} drafts`, 'btn-danger-outline');
                btn.type = 'button';
                btn.onclick = () => discardDraftsForDay(draftDay);
                txt.append(btn);
            }
            box.hidden = false;
        }
        fail(new Error(list.join(' ')));
    }
    function formatTimestamp(ts) {
        if (!ts) return '';
        const d = new Date(ts);
        return Number.isNaN(d.getTime()) ? String(ts) : d.toLocaleString();
    }
    function renderCorrections() {
        const summaryEl = $('day-correction-summary');
        const blocker = $('correction-draft-blocker');
        const blockerText = $('correction-draft-blocker-text');
        const discardDayBtn = $('discard-day-drafts');
        const clearSalesBtn = $('clear-sales-btn');
        const clearWholeBtn = $('clear-whole-day-btn');
        const confirmBtn = $('confirm-clear-btn');
        const cancelBtn = $('cancel-clear-btn');
        const list = $('recovery-list');
        if (!summaryEl && !list && !clearSalesBtn && !clearWholeBtn) return;

        const day = $('day').value || '';
        const summary = day ? L.summarizeDayForClear(day, entries, imports) : null;
        const dayDraftsCount = day ? L.dayDraftCount(draftState, day) : 0;
        const hasDrafts = dayDraftsCount > 0;

        if (hasDrafts && pendingClearScope) {
            hideClearConfirm();
        }

        if (summaryEl && summary) {
            const salesPart = summary.hasImport
                ? `1 POS sales import (${summary.salesItemCount} item${summary.salesItemCount === 1 ? '' : 's'}, ${fmt(summary.totalSalesPieces)} pcs)`
                : 'No imported sales';
            summaryEl.textContent = `Selected date ${day}: ${summary.entryCount} saved movement row${summary.entryCount === 1 ? '' : 's'} (${fmt(summary.totalPurchase)} purchase, ${fmt(summary.totalDamage)} damage) · ${salesPart}.`;
        } else if (summaryEl) {
            summaryEl.textContent = 'Choose a stock date above to view or fix its entries.';
        }

        if (blocker && blockerText) {
            if (hasDrafts) {
                blockerText.textContent = `You have ${dayDraftsCount} unsaved local stock draft${dayDraftsCount === 1 ? '' : 's'} on ${day}. Save or discard drafts for ${day} before clearing or restoring this date.`;
                if (discardDayBtn) discardDayBtn.textContent = `Discard ${day} drafts`;
                blocker.hidden = false;
            } else {
                blockerText.textContent = '';
                blocker.hidden = true;
            }
        }

        if (clearSalesBtn) {
            const noSales = !summary || summary.isSalesEmpty;
            clearSalesBtn.className = (hasDrafts || noSales) ? 'btn-danger-outline is-noop' : 'btn-danger-outline';
            clearSalesBtn.disabled = inFlightCorrection;
        }
        if (clearWholeBtn) {
            const noData = !summary || summary.isWholeDayEmpty;
            clearWholeBtn.className = (hasDrafts || noData) ? 'btn-danger-outline is-noop' : 'btn-danger-outline';
            clearWholeBtn.disabled = inFlightCorrection;
        }
        if (confirmBtn) confirmBtn.disabled = inFlightCorrection;
        if (cancelBtn) cancelBtn.disabled = inFlightCorrection;

        if (list) {
            list.replaceChildren();
            if (!corrections.length) {
                list.append(el('p', 'No day corrections have been recorded yet.', 'recovery-empty'));
            } else {
                for (const corr of corrections) {
                    const info = L.formatCorrectionSummary(corr);
                    const row = el('div', undefined, 'recovery-row');
                    const left = el('div', undefined, 'recovery-info');
                    const titleRow = el('div', undefined, 'recovery-title');
                    titleRow.append(
                        el('span', `${info.day} · ${info.scopeLabel}`),
                        el('span', info.isRestored ? 'Restored' : 'Undo available', info.isRestored ? 'recovery-badge restored' : 'recovery-badge')
                    );
                    const createdStr = formatTimestamp(corr.created_at);
                    const restoredStr = corr.restored_at ? formatTimestamp(corr.restored_at) : '';
                    const metaText = `${info.detailText}${createdStr ? ` · Cleared ${createdStr}` : ''}${restoredStr ? ` · Restored ${restoredStr}` : ''}`;
                    left.append(titleRow, el('span', metaText, 'recovery-meta'));
                    row.append(left);
                    if (!info.isRestored) {
                        const btn = el('button', 'Undo / Restore', 'btn-restore');
                        btn.type = 'button';
                        btn.disabled = inFlightCorrection;
                        btn.setAttribute('aria-label', `Restore ${info.scopeLabel} snapshot for ${info.day}`);
                        btn.onclick = () => handleRestoreCorrection(corr);
                        row.append(btn);
                    }
                    list.append(row);
                }
            }
        }
    }
    function openClearConfirmation(scope) {
        try {
            hideRestoreConflict();
            const day = assertDay();
            const dayDraftsCount = L.dayDraftCount(draftState, day);
            if (dayDraftsCount > 0) {
                hideClearConfirm();
                renderCorrections();
                throw new Error(`${day} has ${dayDraftsCount} unsaved local stock draft${dayDraftsCount === 1 ? '' : 's'}. Save each row or discard ${day} drafts before clearing.`);
            }
            const summary = L.summarizeDayForClear(day, entries, imports);
            if (scope === 'sales_only' && summary.isSalesEmpty) {
                hideClearConfirm();
                message(`No imported sales found for ${day} — nothing to remove.`);
                return;
            }
            if (scope === 'whole_day' && summary.isWholeDayEmpty) {
                hideClearConfirm();
                message(`${day} has no saved movements or imported sales — nothing to clear.`);
                return;
            }
            pendingClearScope = scope;
            pendingClearRequestId = makeRequestId();

            const panel = $('clear-confirm-panel');
            const titleEl = $('clear-confirm-title');
            const detailsEl = $('clear-confirm-details');
            const confirmBtn = $('confirm-clear-btn');
            if (!panel || !titleEl || !detailsEl || !confirmBtn) return;

            titleEl.textContent = scope === 'sales_only'
                ? `Confirm removing imported sales for ${day}`
                : `Confirm clearing whole day (${day})`;
            confirmBtn.textContent = scope === 'sales_only'
                ? `Confirm remove imported sales (${day})`
                : `Confirm clear whole day (${day})`;

            detailsEl.replaceChildren();
            const ul = el('ul');
            if (scope === 'sales_only') {
                ul.append(
                    el('li', `Will remove: imported POS sales on ${day} (${summary.salesItemCount} item${summary.salesItemCount === 1 ? '' : 's'}, ${fmt(summary.totalSalesPieces)} pieces total).`),
                    el('li', `Will keep untouched: ${summary.entryCount} purchase/damage row${summary.entryCount === 1 ? '' : 's'} on ${day}, all initial openings, stock items, saved dish mappings, and all other dates.`)
                );
            } else {
                const salesDesc = summary.hasImport
                    ? `1 POS sales import (${summary.salesItemCount} item${summary.salesItemCount === 1 ? '' : 's'}, ${fmt(summary.totalSalesPieces)} pieces total)`
                    : 'no imported sales';
                ul.append(
                    el('li', `Will clear: ${summary.entryCount} stock movement row${summary.entryCount === 1 ? '' : 's'} on ${day} (Purchase ${fmt(summary.totalPurchase)}, Damage ${fmt(summary.totalDamage)}) and ${salesDesc}.`),
                    el('li', 'Will keep untouched: initial opening balances, stock items, saved dish mappings, and all other dates.')
                );
            }
            const laterDesc = summary.laterDatesCount > 0
                ? `Opening and closing balances will automatically recalculate for ${day} and ${summary.laterDatesCount} later recorded date${summary.laterDatesCount === 1 ? '' : 's'} (${summary.laterDates[0]} to ${summary.laterDates[summary.laterDatesCount - 1]}), plus any future dates you view.`
                : `Closing balances for ${day} and opening balances for any later dates you view will automatically recalculate.`;
            ul.append(
                el('li', laterDesc),
                el('li', 'Recovery: a permanent snapshot will be saved before deleting so you can undo anytime (even after refreshing).')
            );
            detailsEl.append(ul);
            panel.hidden = false;
            if (typeof confirmBtn.focus === 'function') confirmBtn.focus();
        } catch (e) { fail(e); }
    }
    async function executeClearConfirm() {
        if (inFlightCorrection || !pendingClearScope) return;
        const scope = pendingClearScope;
        const requestId = pendingClearRequestId || makeRequestId();
        pendingClearRequestId = requestId;
        try {
            const day = assertDay();
            const dayDraftsCount = L.dayDraftCount(draftState, day);
            if (dayDraftsCount > 0) {
                hideClearConfirm();
                renderCorrections();
                throw new Error(`${day} has ${dayDraftsCount} unsaved local stock draft${dayDraftsCount === 1 ? '' : 's'}. Save each row or discard ${day} drafts before clearing.`);
            }
            const summary = L.summarizeDayForClear(day, entries, imports);
            if ((scope === 'sales_only' && summary.isSalesEmpty) || (scope === 'whole_day' && summary.isWholeDayEmpty)) {
                hideClearConfirm();
                renderCorrections();
                message(`Nothing to clear on ${day}.`);
                return;
            }
            inFlightCorrection = true;
            renderCorrections();
            const { data, error } = await _supabase.rpc('inventory_clear_day', {
                p_day: day,
                p_scope: scope,
                p_expected_fingerprint: summary.importFingerprint,
                p_expected_entries: scope === 'whole_day' ? summary.expectedEntries : [],
                p_request_id: requestId,
            });
            if (error) throw error;
            if (data && data.status === 'conflict') {
                hideClearConfirm();
                await refresh();
                fail(new Error(data.reason || 'Server data changed before clearing. Review the refreshed sheet and try again.'));
                return;
            }
            if (data && data.status === 'empty') {
                hideClearConfirm();
                await refresh();
                message(data.reason || `Nothing to clear on ${day}.`);
                return;
            }
            hideClearConfirm();
            invalidate();
            await refresh();
            if (report) renderMappings();
            message(scope === 'sales_only'
                ? `Removed imported sales for ${day}. Snapshot saved — use Undo / Restore below if needed.`
                : `Cleared saved movements and imported sales for ${day}. Snapshot saved — use Undo / Restore below if needed.`);
        } catch (e) {
            fail(e);
        } finally {
            inFlightCorrection = false;
            renderCorrections();
        }
    }
    async function handleRestoreCorrection(corr) {
        if (inFlightCorrection || !corr) return;
        hideRestoreConflict();
        try {
            const affectedDrafts = L.dayDraftCount(draftState, corr.day);
            if (affectedDrafts > 0) {
                showRestoreConflict([
                    `${corr.day} has ${affectedDrafts} unsaved local stock draft${affectedDrafts === 1 ? '' : 's'}. Save or discard drafts for ${corr.day} before restoring this snapshot.`,
                ], corr.day);
                return;
            }
            inFlightCorrection = true;
            renderCorrections();
            [items, entries, imports] = await Promise.all(['inventory_items', 'inventory_entries', 'inventory_imports'].map(all));
            const preCheck = L.checkRestoreConflicts(corr, items, entries, imports);
            if (!preCheck.ok) {
                renderStock();
                renderItems();
                showRestoreConflict(preCheck.reasons);
                return;
            }
            const { data, error } = await _supabase.rpc('inventory_restore_correction', {
                p_correction_id: corr.id,
            });
            if (error) throw error;
            if (data && data.status === 'conflict') {
                await refresh();
                showRestoreConflict([data.reason || `Cannot restore ${corr.day}: one or more target slots are already occupied.`]);
                return;
            }
            if (data && data.status === 'already_restored') {
                await refresh();
                message(`Snapshot for ${corr.day} was already restored.`);
                return;
            }
            hideClearConfirm();
            hideRestoreConflict();
            invalidate();
            await refresh();
            if (report) renderMappings();
            const info = L.formatCorrectionSummary(corr);
            message(`Restored ${info.scopeLabel.toLowerCase()} for ${corr.day}. Later balances are recalculated.`);
        } catch (e) {
            fail(e);
        } finally {
            inFlightCorrection = false;
            renderCorrections();
        }
    }
    if ($('clear-sales-btn')) $('clear-sales-btn').onclick = () => openClearConfirmation('sales_only');
    if ($('clear-whole-day-btn')) $('clear-whole-day-btn').onclick = () => openClearConfirmation('whole_day');
    if ($('confirm-clear-btn')) $('confirm-clear-btn').onclick = () => executeClearConfirm();
    if ($('cancel-clear-btn')) $('cancel-clear-btn').onclick = () => { hideClearConfirm(); message('Day correction cancelled.'); };

    async function loadRestaurantProfile() {
        try {
            const { data: profile } = await _supabase.from('profiles').select('restaurant_name').eq('id', user.id).maybeSingle();
            if (profile && profile.restaurant_name && String(profile.restaurant_name).trim()) {
                restaurantName = String(profile.restaurant_name).trim();
            }
        } catch (_) {
            // Optional restaurant profile metadata; fall back to default branding.
        }
        if ($('restaurant-name')) $('restaurant-name').textContent = restaurantName;
        if (typeof document !== 'undefined') document.title = `Daily inventory - ${restaurantName}`;
    }
    function restoreItemFormFromDraft() {
        const f = draftState.itemForm;
        if (!f) return;
        if (f.editingId) {
            const serverItem = items.find(i => i.id === f.editingId);
            if (serverItem) {
                editing = serverItem.id;
                editingBase = { id: serverItem.id, name: serverItem.name, opening: Number(serverItem.initial_opening) };
                $('item-start').value = serverItem.start_date;
                $('item-start').disabled = false;
                setItemSubmitText('Save item');
                $('cancel-edit').hidden = false;
            } else {
                editing = null;
                editingBase = null;
                $('item-start').disabled = false;
                $('item-start').value = f.startDate || $('day').value;
            }
        } else {
            editing = null;
            editingBase = null;
            $('item-start').disabled = false;
            $('item-start').value = f.startDate || $('day').value;
        }
        $('item-name').value = f.name;
        $('item-opening').value = f.opening;
        updateItemDraftNote();
    }
    async function init() {
        try {
            initTabs();
            const session = await checkAuth();
            if (!session) return;
            user = session.user;
            const loaded = L.loadDraftState(getStorage(), user.id);
            if (loaded.error) reportStorageError(loaded.error);
            draftState = loaded.state;
            $('day').value = draftState.selectedDay || today();
            $('item-start').value = $('day').value;
            await Promise.all([loadRestaurantProfile(), refresh()]);
            restoreItemFormFromDraft();
            const summary = L.draftSummary(draftState, $('day').value);
            restoredNotice = Boolean(loaded.restored && summary.totalCount > 0);
            updateDraftStatus();
        } catch (e) { fail(e); }
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
})();
