/* Daily inventory UI; all calculations are derived, never stored as closing balances. */
(() => {
    'use strict';
    const L = InventoryLogic, $ = id => document.getElementById(id);
    let user, restaurantName = 'RestroManager', items = [], entries = [], imports = [], mappings = [], report = null, previewData = null, editing = null, revision = 0, fileRevision = 0;
    let draftState = L.emptyDraftState(), restoredNotice = false, exportUrls = [];
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
    function message(msg, error = false) { $('message').textContent = msg; $('message').className = error ? 'error' : ''; }
    function fail(err) { message(err.message || String(err), true); }
    function el(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
    function fmt(n) { return Number(n.toFixed(4)).toLocaleString('en-IN', {maximumFractionDigits:4}); }
    function assertDay() { if (!$('day').value) throw new Error('Choose a stock date'); return $('day').value; }
    function getStorage() {
        try { return typeof window !== 'undefined' ? window.localStorage : (typeof localStorage !== 'undefined' ? localStorage : null); }
        catch (e) { reportStorageError(e && e.message ? e.message : 'Browser storage access denied'); return null; }
    }
    function reportStorageError(msg) {
        const box = $('storage-warning');
        if (!box) return;
        if (msg) { box.textContent = `Draft storage warning: ${msg}. Unsaved edits may not survive page reload.`; box.hidden = false; }
        else { box.textContent = ''; box.hidden = true; }
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
            let query = _supabase.from(table).select('*').eq('user_id', user.id).order(table === 'inventory_items' ? 'id' : table === 'inventory_mappings' ? 'dish_key' : 'day');
            if (table === 'inventory_entries') query = query.order('item_id');
            const {data, error} = await query.range(start, start + 499);
            if (error) throw error;
            result.push(...data); if (data.length < 500) return result; start += data.length;
        }
    }
    async function refresh() {
        [items, entries, imports, mappings] = await Promise.all(['inventory_items','inventory_entries','inventory_imports','inventory_mappings'].map(all));
        renderStock(); renderItems(); updateItemDraftNote(); updateDraftStatus();
    }
    function invalidate() { revision++; previewData = null; $('preview-area').hidden = true; }
    function clearExportUrls() {
        if (typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
            for (const url of exportUrls) URL.revokeObjectURL(url);
        }
        exportUrls = [];
    }
    function renderStock() {
        const body = $('stock'); body.replaceChildren(); const day = $('day').value;
        if (!day) return;
        const dayDrafts = draftState.entries[day] || {};
        const activeControls = [];
        for (const item of items) {
            const rowState = L.resolveRowState(item, day, entries, imports, dayDrafts), tr = el('tr');
            const nameTd = el('td');
            nameTd.append(el('span', item.name, 'item-cell-name'));
            if (!rowState.available) {
                tr.append(nameTd);
                const td = el('td', `Starts ${rowState.startDate}`); td.colSpan = 6; tr.append(td); body.append(tr); continue;
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
            const save = el('button', 'Save', 'btn-save-row'); save.type = 'button';
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
                const matchesServer = valid && pv.trim() !== '' && dv.trim() !== ''
                    && parsedP === rowState.base.purchase && parsedD === rowState.base.damage;
                if (matchesServer) {
                    draftState = L.clearEntryDraft(draftState, day, item.id);
                } else {
                    draftState = L.setEntryDraft(draftState, day, item.id, {
                        purchase: pv,
                        damage: dv,
                        basePurchase: rowState.base.purchase,
                        baseDamage: rowState.base.damage,
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
                updateDraftStatus();
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

            save.onclick = async () => {
                save.disabled = true;
                try {
                    const purchase = L.number(p.value, 'Purchase'), damage = L.number(d.value, 'Damage');
                    const latest = L.resolveRowState(item, day, entries, imports, draftState.entries[day] || {});
                    if (latest.stale && typeof confirm === 'function') {
                        const ok = confirm(`Saved server values for ${item.name} on ${day} changed since this draft was created (Saved: Purchase ${fmt(latest.base.purchase)}, Damage ${fmt(latest.base.damage)}; Draft: Purchase ${p.value}, Damage ${d.value}). Replace server data with your draft?`);
                        if (!ok) { save.disabled = false; return; }
                    }
                    const payload = { user_id: user.id, item_id: item.id, day, purchase, damage };
                    const { error } = await _supabase.from('inventory_entries').upsert(payload, { onConflict: 'user_id,item_id,day' });
                    if (error) throw error;
                    draftState = L.clearEntryDraft(draftState, day, item.id);
                    persistDrafts();
                    await refresh();
                    message('Stock movements saved. Later balances are recalculated.');
                } catch (e) { fail(e); } finally { save.disabled = false; }
            };

            discardRow.onclick = () => {
                draftState = L.clearEntryDraft(draftState, day, item.id);
                persistDrafts();
                renderStock();
                updateDraftStatus();
                message(`Discarded unsaved draft for ${item.name} on ${day}.`);
            };

            let td = el('td'); td.append(p); tr.append(td, el('td', fmt(rowState.sale)));
            td = el('td'); td.append(d); tr.append(td, closingTd);
            td = el('td'); const actions = el('div', undefined, 'row-actions'); actions.append(save, discardRow); td.append(actions); tr.append(td);
            body.append(tr);
        }
        if (!items.length) { const tr = el('tr'), td = el('td','Add a stock item to get started.'); td.colSpan=7; tr.append(td); body.append(tr); }
    }
    function renderItems() {
        const list = $('item-list'); list.replaceChildren();
        for (const item of items) { const row = el('div', undefined, 'item-row'), button = el('button','Edit'); button.type='button';
            row.append(el('span', `${item.name} · starts ${item.start_date} · opening ${fmt(Number(item.initial_opening))}`), button); list.append(row);
            button.onclick = () => {
                editing = item.id; $('item-name').value=item.name; $('item-start').value=item.start_date; $('item-start').disabled=true;
                $('item-opening').value=item.initial_opening; $('item-submit').textContent='Save item'; $('cancel-edit').hidden=false;
                syncItemFormDraft(item);
                $('item-name').focus();
            };
        }
    }
    function syncItemFormDraft(editSource = null) {
        const name = $('item-name').value, startDate = $('item-start').value, opening = $('item-opening').value;
        const currentItem = editSource || (editing ? items.find(i => i.id === editing) : null);
        if (!editing && !name && !opening && startDate === $('day').value) {
            draftState = L.clearItemFormDraft(draftState);
        } else {
            const prior = draftState.itemForm;
            draftState = L.setItemFormDraft(draftState, {
                editingId: editing,
                name,
                startDate,
                opening,
                baseName: currentItem ? currentItem.name : (prior && prior.editingId === editing ? prior.baseName : null),
                baseOpening: currentItem ? Number(currentItem.initial_opening) : (prior && prior.editingId === editing ? prior.baseOpening : null),
            });
        }
        persistDrafts();
        updateItemDraftNote();
        updateDraftStatus();
    }
    function resetForm(clearDraft = true) {
        editing=null; $('item-form').reset(); $('item-start').disabled=false; $('item-start').value=$('day').value;
        $('item-submit').textContent='Add item'; $('cancel-edit').hidden=true;
        if (clearDraft) {
            draftState = L.clearItemFormDraft(draftState);
            persistDrafts();
            updateItemDraftNote();
            updateDraftStatus();
        }
    }
    $('cancel-edit').onclick=() => resetForm(true);
    if ($('discard-item-draft')) $('discard-item-draft').onclick=() => { resetForm(true); message('Pending item form draft discarded.'); };
    for (const fieldId of ['item-name', 'item-start', 'item-opening']) {
        $(fieldId).oninput = () => syncItemFormDraft();
        $(fieldId).onchange = () => syncItemFormDraft();
    }
    $('item-form').onkeydown = e => { if (e.key === 'Escape' && editing) { e.preventDefault(); resetForm(true); } };
    $('item-form').onsubmit=async event => { event.preventDefault(); const button=$('item-submit'); button.disabled=true; try {
        const name=$('item-name').value.trim(), start=$('item-start').value, opening=L.number($('item-opening').value,'Initial opening');
        if (!name || !start) throw new Error('Enter an item name and start date');
        if (editing) {
            const staleInfo = L.isItemFormDraftStale(draftState.itemForm, items);
            if (staleInfo.missing) throw new Error('The item you were editing is no longer available on the server. Discard draft or add as a new item.');
            if (staleInfo.stale && typeof confirm === 'function') {
                const ok = confirm(`Server values for "${staleInfo.serverItem.name}" changed since this edit draft started (Saved: ${staleInfo.serverItem.name}, opening ${fmt(Number(staleInfo.serverItem.initial_opening))}). Save your draft changes anyway?`);
                if (!ok) { button.disabled = false; return; }
            }
        }
        const query=editing ? _supabase.from('inventory_items').update({name,initial_opening:opening}).eq('user_id',user.id).eq('id',editing) : _supabase.from('inventory_items').insert({user_id:user.id,name,start_date:start,initial_opening:opening});
        const currentChoices=report ? Object.fromEntries([...document.querySelectorAll('#mapping-list select')].map(s=>[s.dataset.key,s.value]).filter(([,v])=>v)) : null;
        const {error}=await query; if(error) throw error;
        draftState = L.clearItemFormDraft(draftState);
        persistDrafts();
        await refresh(); resetForm(false); updateItemDraftNote(); updateDraftStatus(); invalidate(); if(report) renderMappings(currentChoices); message('Item saved. Later balances are recalculated.');
    } catch(e) { fail(e); } finally { button.disabled=false; } };
    function applyDateChange(newDay) {
        if (!newDay) return;
        $('day').value = newDay;
        draftState.selectedDay = newDay;
        persistDrafts();
        renderStock();
        invalidate();
        if (!editing && !draftState.itemForm) $('item-start').value = newDay;
        updateDraftStatus();
        if (report) reportInfo();
    }
    function shiftDay(delta) {
        const current = $('day').value || today();
        const d = new Date(`${current}T00:00:00Z`);
        if (Number.isNaN(d.getTime())) return;
        d.setUTCDate(d.getUTCDate() + delta);
        applyDateChange(d.toISOString().slice(0, 10));
    }
    $('day').onchange=() => applyDateChange($('day').value);
    if ($('prev-day')) $('prev-day').onclick = () => shiftDay(-1);
    if ($('next-day')) $('next-day').onclick = () => shiftDay(1);
    if ($('discard-drafts')) $('discard-drafts').onclick = () => {
        const summary = L.draftSummary(draftState, $('day').value || '');
        if (summary.totalCount && typeof confirm === 'function' && !confirm('Discard all unsaved stock row drafts across all dates and any pending item form draft?')) return;
        const keepDay = $('day').value || today();
        draftState = { selectedDay: '', itemForm: null, entries: {} };
        restoredNotice = false;
        persistDrafts();
        draftState.selectedDay = keepDay;
        resetForm(true);
        renderStock();
        updateDraftStatus();
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

    function wrapCanvasText(ctx, value, maxWidth) {
        const words = String(value || '').split(/\s+/).filter(Boolean);
        if (!words.length) return [''];
        const lines = [];
        let line = '';
        for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            if (ctx.measureText(test).width <= maxWidth) { line = test; continue; }
            if (line) lines.push(line);
            if (ctx.measureText(w).width <= maxWidth) { line = w; continue; }
            let chunk = '';
            for (const ch of w) {
                if (ctx.measureText(chunk + ch).width > maxWidth && chunk) { lines.push(chunk); chunk = ch; }
                else chunk += ch;
            }
            line = chunk;
        }
        if (line) lines.push(line);
        return lines;
    }

    function drawA4StockPage(snap, pageRows, pageNum, totalPages) {
        const W = 1240, H = 1754;
        const canvas = document.createElement('canvas');
        canvas.width = W; canvas.height = H;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('Canvas 2D context is unavailable in this browser');

        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, W, H);

        const M = 60, innerW = W - M * 2;
        ctx.fillStyle = '#0f172a';
        ctx.font = 'bold 34px sans-serif';
        ctx.textAlign = 'left';
        ctx.fillText(restaurantName, M, 84, innerW - 340);

        ctx.fillStyle = '#475569';
        ctx.font = '600 20px sans-serif';
        ctx.fillText('Daily Stock Sheet (pieces)', M, 118);

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
        ctx.moveTo(M, 136);
        ctx.lineTo(W - M, 136);
        ctx.stroke();

        let y = 154;
        if (snap.hasDrafts) {
            ctx.fillStyle = '#fffbeb';
            ctx.fillRect(M, y, innerW, 44);
            ctx.strokeStyle = '#d97706';
            ctx.lineWidth = 2;
            ctx.strokeRect(M, y, innerW, 44);
            ctx.fillStyle = '#92400e';
            ctx.font = 'bold 18px sans-serif';
            ctx.textAlign = 'left';
            ctx.fillText(`CONTAINS UNSAVED DRAFTS (${snap.draftCount} row${snap.draftCount === 1 ? '' : 's'} labeled DRAFT — not yet saved)`, M + 14, y + 28, innerW - 28);
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

        for (const row of pageRows) {
            ctx.font = '600 18px sans-serif';
            const itemLines = wrapCanvasText(ctx, row.itemName, cols[0].w - 24);
            const rowH = Math.max(46, itemLines.length * 24 + (row.isDraft ? 24 : 18));
            if (row.isDraft) {
                ctx.fillStyle = '#fffbeb';
                ctx.fillRect(M, y, innerW, rowH);
            }
            ctx.strokeStyle = '#e2e8f0';
            ctx.lineWidth = 1;
            ctx.strokeRect(M, y, innerW, rowH);

            ctx.textAlign = 'left';
            ctx.fillStyle = '#0f172a';
            ctx.font = '600 18px sans-serif';
            itemLines.forEach((line, idx) => {
                ctx.fillText(line, cols[0].x + 12, y + 26 + idx * 22);
            });
            if (row.isDraft) {
                ctx.fillStyle = '#92400e';
                ctx.font = 'bold 14px sans-serif';
                ctx.fillText('DRAFT (unsaved)', cols[0].x + 12, y + 26 + itemLines.length * 22);
            }

            if (!row.available) {
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
                ctx.font = '600 18px sans-serif';
                for (const [col, val, color] of nums) {
                    ctx.textAlign = 'right';
                    ctx.fillStyle = color;
                    ctx.fillText(val, col.x + col.w - 12, y + 28, col.w - 20);
                }
            }
            y += rowH;
        }

        if (!pageRows.length) {
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
            const a = el('a', `Download ${item.label}`, 'export-link');
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
            const validRows = rows.filter(r => !r.invalidDraft);
            renderPrintSheet({
                day,
                rows: validRows,
                hasDrafts: validRows.some(r => r.isDraft),
                draftCount: validRows.filter(r => r.isDraft).length,
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
            const pages = L.paginateSheetRows(snap.rows, 22);
            const files = [], downloadEntries = [];
            clearExportUrls();
            for (let i = 0; i < pages.length; i++) {
                const canvas = drawA4StockPage(snap, pages[i], i + 1, pages.length);
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
    $('file').onchange=async () => { const fileVersion=++fileRevision; report=null; invalidate(); $('import-area').hidden=true; try {
        const file=$('file').files[0]; if(!file) return; if(!/\.(xls|xlsx)$/i.test(file.name)) throw new Error('Choose an .xls or .xlsx file');
        if(file.size > 10*1024*1024) throw new Error('Report exceeds 10 MB'); if(typeof XLSX === 'undefined') throw new Error('Spreadsheet reader could not load; reload the page');
        const buffer=await file.arrayBuffer(); if(fileVersion!==fileRevision) return;
        const book=XLSX.read(buffer, {type:'array', cellDates:false});
        report=L.parseReport(XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], {header:1, raw:false, defval:''}));
        renderMappings(); $('import-area').hidden=false; message('Review saved mappings and suggested matches before previewing.');
    } catch(e) { fail(e); } };
    $('preview').onclick=async () => { invalidate(); const version=revision; try {
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
    $('confirm-import').onclick=async () => { const button=$('confirm-import'); button.disabled=true; try {
        const p=previewData; if(!p || p.day!==assertDay() || p.day!==report.date) throw new Error('Preview again before saving');
        if(p.expected && !confirm('Replace the existing imported sales for this day?')) { button.disabled=false; return; }
        // Saving mapping preferences does not alter any previously imported sales snapshots.
        const rows=Object.entries(p.choices).map(([key,value])=>({user_id:user.id,dish_key:key,item_id:value==='ignore'?null:value,ignored:value==='ignore'}));
        const {error:mapError}=await _supabase.from('inventory_mappings').upsert(rows,{onConflict:'user_id,dish_key'}); if(mapError) throw mapError;
        const {data,error}=await _supabase.rpc('inventory_save_import',{p_day:p.day,p_fingerprint:p.hash,p_sales:p.sales,p_expected:p.expected}); if(error) throw error;
        await refresh(); invalidate(); message(data==='duplicate' ? 'Already imported; no sales added.' : 'Sales saved. Later balances are recalculated.');
    } catch(e) { fail(e); button.disabled=false; } };
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
                $('item-start').value = serverItem.start_date;
                $('item-start').disabled = true;
                $('item-submit').textContent = 'Save item';
                $('cancel-edit').hidden = false;
            } else {
                editing = null;
                $('item-start').disabled = false;
                $('item-start').value = f.startDate || $('day').value;
            }
        } else {
            editing = null;
            $('item-start').disabled = false;
            $('item-start').value = f.startDate || $('day').value;
        }
        $('item-name').value = f.name;
        $('item-opening').value = f.opening;
        updateItemDraftNote();
    }
    async function init() {
        try {
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
    init();
})();
