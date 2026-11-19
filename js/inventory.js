/* Daily inventory UI; all calculations are derived, never stored as closing balances. */
(() => {
    'use strict';
    const L = InventoryLogic, $ = id => document.getElementById(id);
    let user, items = [], entries = [], imports = [], mappings = [], report = null, previewData = null, editing = null, revision = 0, fileRevision = 0;
    const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; };
    function message(msg, error = false) { $('message').textContent = msg; $('message').className = error ? 'error' : ''; }
    function fail(err) { message(err.message || String(err), true); }
    function el(tag, text, cls) { const node = document.createElement(tag); if (text !== undefined) node.textContent = text; if (cls) node.className = cls; return node; }
    function fmt(n) { return Number(n.toFixed(4)).toLocaleString('en-IN', {maximumFractionDigits:4}); }
    function assertDay() { if (!$('day').value) throw new Error('Choose a stock date'); return $('day').value; }
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
    async function refresh() { [items, entries, imports, mappings] = await Promise.all(['inventory_items','inventory_entries','inventory_imports','inventory_mappings'].map(all)); renderStock(); renderItems(); }
    function invalidate() { revision++; previewData = null; $('preview-area').hidden = true; }
    function renderStock() {
        const body = $('stock'); body.replaceChildren(); const day = $('day').value;
        if (!day) return;
        for (const item of items) {
            const values = L.stock(item, day, entries, imports), tr = el('tr');
            tr.append(el('td', item.name));
            if (!values) { const td = el('td', `Starts ${item.start_date}`); td.colSpan = 6; tr.append(td); body.append(tr); continue; }
            tr.append(el('td', fmt(values.opening)));
            const p = el('input'), d = el('input');
            for (const input of [p,d]) { input.type='number'; input.min='0'; input.max='1000000000'; input.step='any'; }
            p.value = values.purchase; d.value = values.damage; p.setAttribute('aria-label', `Purchase for ${item.name}`); d.setAttribute('aria-label', `Damage for ${item.name}`);
            let td = el('td'); td.append(p); tr.append(td, el('td', fmt(values.sale))); td = el('td'); td.append(d); tr.append(td, el('td', fmt(values.closing), values.closing < 0 ? 'shortage' : ''));
            const save = el('button', 'Save'); save.type = 'button'; save.onclick = async () => { save.disabled = true; try {
                const payload = {user_id:user.id, item_id:item.id, day, purchase:L.number(p.value,'Purchase'), damage:L.number(d.value,'Damage')};
                const {error} = await _supabase.from('inventory_entries').upsert(payload, {onConflict:'user_id,item_id,day'}); if (error) throw error;
                await refresh(); message('Stock movements saved. Later balances are recalculated.');
            } catch (e) { fail(e); } finally { save.disabled = false; } }; td = el('td'); td.append(save); tr.append(td); body.append(tr);
        }
        if (!items.length) { const tr = el('tr'), td = el('td','Add a stock item to get started.'); td.colSpan=7; tr.append(td); body.append(tr); }
    }
    function renderItems() {
        const list = $('item-list'); list.replaceChildren();
        for (const item of items) { const row = el('div', undefined, 'item-row'), button = el('button','Edit'); button.type='button';
            row.append(el('span', `${item.name} · starts ${item.start_date} · opening ${fmt(Number(item.initial_opening))}`), button); list.append(row);
            button.onclick = () => { editing = item.id; $('item-name').value=item.name; $('item-start').value=item.start_date; $('item-start').disabled=true; $('item-opening').value=item.initial_opening; $('item-submit').textContent='Save item'; $('cancel-edit').hidden=false; $('item-name').focus(); };
        }
    }
    function resetForm() { editing=null; $('item-form').reset(); $('item-start').disabled=false; $('item-start').value=$('day').value; $('item-submit').textContent='Add item'; $('cancel-edit').hidden=true; }
    $('cancel-edit').onclick=resetForm;
    $('item-form').onsubmit=async event => { event.preventDefault(); const button=$('item-submit'); button.disabled=true; try {
        const name=$('item-name').value.trim(), start=$('item-start').value, opening=L.number($('item-opening').value,'Initial opening');
        if (!name || !start) throw new Error('Enter an item name and start date');
        const query=editing ? _supabase.from('inventory_items').update({name,initial_opening:opening}).eq('user_id',user.id).eq('id',editing) : _supabase.from('inventory_items').insert({user_id:user.id,name,start_date:start,initial_opening:opening});
        const currentChoices=report ? Object.fromEntries([...document.querySelectorAll('#mapping-list select')].map(s=>[s.dataset.key,s.value]).filter(([,v])=>v)) : null;
        const {error}=await query; if(error) throw error; await refresh(); resetForm(); invalidate(); if(report) renderMappings(currentChoices); message('Item saved. Later balances are recalculated.');
    } catch(e) { fail(e); } finally { button.disabled=false; } };
    $('day').onchange=() => { renderStock(); invalidate(); if (!editing) $('item-start').value=$('day').value; if(report) reportInfo(); };
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
    async function init() { try { const session=await checkAuth(); if(!session) return; user=session.user; $('day').value=today(); $('item-start').value=$('day').value; await refresh(); } catch(e) { fail(e); } }
    init();
})();
