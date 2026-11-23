"""Focused, synthetic tests of browser-independent inventory logic."""
import hashlib
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_js(script):
    code = "const assert=require('node:assert/strict'); const L=require('./js/inventory-logic.js');\n" + script
    subprocess.run(['node', '-e', code], cwd=ROOT, check=True, capture_output=True, text=True)


def test_report_rows_pieces_and_reused_codes():
    run_js(r"""
      const report=L.parseReport([
        ['Item Report'], ['Date: 04/05/2025'],
        ['Category','Item','Code','Qty.','Total'],
        ['Starters','','','',''],
        ['', 'Fish [3 Pieces]', '42', '2', '100'],
        ['', 'Fish [3 Pieces]', '42', '1', '50'],
        ['', 'Chicken (1 Piece)', '42', '2.5', '75'],
        ['', 'Subtotal', '', '5.5', '225'],
        ['Meals','','','',''],
        ['', 'Thali', '42', '1', '30'],
        ['Grand Total','','','6.5','255']
      ]);
      assert.equal(report.date,'2025-05-04');
      assert.equal(report.dishes.length,3);
      assert.deepEqual(report.dishes.map(d=>d.pieces), [9,2.5,1]);
      assert.equal(new Set(report.dishes.map(d=>d.key)).size,3);
      assert.equal(report.dishes[2].category,'Meals');
      assert.equal(L.pieces('Thali'),1);
      assert.throws(()=>L.pieces('Fish [0 Pieces]'));
      assert.throws(()=>L.pieces('Fish [2 Pieces] (3 Pieces)'));
    """)


def test_report_rejects_bad_date_header_and_quantity():
    run_js(r"""
      const header=['Category','Item','Code','Qty.','Total'];
      assert.throws(()=>L.parseReport([['Date: 31/02/2025'],header,['A','Dish','1','2','4']]));
      assert.throws(()=>L.parseReport([['Date: 01/02/2025 to 02/02/2025'],header,['A','Dish','1','2','4']]));
      assert.throws(()=>L.parseReport([['Date: 01/02/2025'],['wrong']]));
      assert.throws(()=>L.parseReport([['Date: 01/02/2025'],header,['A','Dish','1','bad','4']]));
      assert.throws(()=>L.number('-1','Damage'));
      assert.throws(()=>L.number('Infinity','Purchase'));
      assert.throws(()=>L.number('','Purchase'));
    """)


def test_mappings_ignore_many_to_one_and_no_guessing():
    run_js(r"""
      const r=L.parseReport([['2025-04-01'],['Category','Item','Code','Qty','Total'],
        ['Food','One [2 Pieces]','1','2','10'],['Food','Two','1','3','10'],['Food','Drink','3','4','10']]);
      let map={[r.dishes[0].key]:'stock-a',[r.dishes[1].key]:'stock-a'};
      let p=L.preview(r,map); assert.equal(p.unresolved.length,1); assert.equal(p.totals['stock-a'],7);
      map[r.dishes[2].key]='ignore'; p=L.preview(r,map);
      assert.equal(p.unresolved.length,0); assert.deepEqual(p.totals,{'stock-a':7});
    """)


def test_exact_and_whole_word_matching_requires_review():
    run_js(r"""
      const items=[
        {id:'i-fish', name:'Fish'},
        {id:'i-paneer', name:'Paneer Tikka'},
        {id:'i-curry', name:'Fish Curry'},
        {id:'i-cafe', name:'Café'},
      ];
      const r=L.parseReport([
        ['2025-05-04'],
        ['Category','Item','Code','Qty','Total'],
        ['Starters','  paneer-tikka! ','1','2','200'],
        ['Starters','Fish [3 Pieces]','2','2','100'],
        ['Mains','Grilled Fish Masala (2 Pieces)','3','1','120'],
        ['Mains','Fish Curry','4','1','140'],
        ['Drinks','Cafe Latte','5','2','80'],
      ]);
      const suggestions=L.suggestMappings(r,items,{});
      const m0=suggestions[r.dishes[0].key];
      assert.equal(m0.status,'suggested');
      assert.equal(m0.selected,'');
      assert.equal(m0.suggestion.id,'i-paneer');
      assert.match(m0.reason,/Exact name match/i);

      const m1=suggestions[r.dishes[1].key];
      assert.equal(m1.status,'suggested');
      assert.equal(m1.selected,'');
      assert.equal(m1.suggestion.id,'i-fish');
      assert.match(m1.reason,/Exact name match/i);

      const m2=suggestions[r.dishes[2].key];
      assert.equal(m2.status,'suggested');
      assert.equal(m2.selected,'');
      assert.equal(m2.suggestion.id,'i-fish');
      assert.match(m2.reason,/Whole-word match/i);

      const m3=suggestions[r.dishes[3].key];
      assert.equal(m3.status,'suggested');
      assert.equal(m3.suggestion.id,'i-curry');

      const m4=suggestions[r.dishes[4].key];
      assert.equal(m4.status,'suggested');
      assert.equal(m4.suggestion.id,'i-cafe');

      // Suggestions require explicit acceptance before preview/import can succeed.
      const unreviewed=Object.fromEntries(Object.entries(suggestions).map(([k,v])=>[k,v.selected]));
      assert.equal(L.preview(r,unreviewed).unresolved.length,5);

      const accepted=Object.fromEntries(Object.entries(suggestions).map(([k,v])=>[k,v.suggestion.id]));
      const prev=L.preview(r,accepted);
      assert.equal(prev.unresolved.length,0);
      assert.equal(prev.totals['i-fish'],8);
      assert.equal(prev.totals['i-paneer'],2);
      assert.equal(prev.totals['i-curry'],1);
      assert.equal(prev.totals['i-cafe'],2);
    """)


def test_ambiguous_candidates_are_never_auto_mapped():
    run_js(r"""
      const items=[
        {id:'i-fish', name:'Fish'},
        {id:'i-chicken', name:'Chicken'},
        {id:'i-fish-curry', name:'Fish Curry'},
        {id:'i-fish-dup', name:'Fish!'},
      ];
      const r=L.parseReport([
        ['2025-05-04'],
        ['Category','Item','Code','Qty','Total'],
        ['Combos','Fish & Chicken Platter','1','1','300'],
        ['Mains','Spicy Fish Curry','2','1','200'],
        ['Mains','Fish','3','1','100'],
      ]);
      const s=L.suggestMappings(r,items,{});
      for (const dish of r.dishes) {
        const res=s[dish.key];
        assert.equal(res.status,'ambiguous');
        assert.equal(res.selected,'');
        assert.equal(res.suggestion,null);
        assert.ok(res.candidates.length >= 2);
        assert.match(res.reason,/Ambiguous/i);
      }
      assert.deepEqual(s[r.dishes[0].key].candidates.map(c=>c.id),['i-fish','i-chicken','i-fish-dup']);
      assert.deepEqual(s[r.dishes[1].key].candidates.map(c=>c.id),['i-fish','i-fish-curry','i-fish-dup']);
      assert.deepEqual(s[r.dishes[2].key].candidates.map(c=>c.id),['i-fish','i-fish-dup']);
    """)


def test_saved_mappings_and_ignore_always_win():
    run_js(r"""
      const items=[
        {id:'i-fish', name:'Fish'},
        {id:'i-whole-fish', name:'Whole Fish Portion'},
      ];
      const r=L.parseReport([
        ['2025-05-04'],
        ['Category','Item','Code','Qty','Total'],
        ['Starters','Fish [2 Pieces]','10','3','150'],
        ['Drinks','Fish Soup','11','2','80'],
        ['Mains','Fish Fry','12','1','120'],
      ]);
      const dbRows=[
        {dish_key:r.dishes[0].key, item_id:'i-whole-fish', ignored:false},
        {dish_key:r.dishes[1].key, item_id:null, ignored:true},
        {dish_key:r.dishes[2].key, item_id:'deleted-item-id', ignored:false},
      ];
      const s=L.suggestMappings(r,items,dbRows);
      assert.equal(s[r.dishes[0].key].status,'saved');
      assert.equal(s[r.dishes[0].key].selected,'i-whole-fish');
      assert.equal(s[r.dishes[0].key].suggestion,null);

      assert.equal(s[r.dishes[1].key].status,'ignored');
      assert.equal(s[r.dishes[1].key].selected,'ignore');
      assert.equal(s[r.dishes[1].key].suggestion,null);

      // Deleted saved item id falls back cleanly to unmapped suggestion.
      assert.equal(s[r.dishes[2].key].status,'suggested');
      assert.equal(s[r.dishes[2].key].selected,'');
      assert.equal(s[r.dishes[2].key].suggestion.id,'i-fish');

      const map={
        [r.dishes[0].key]:s[r.dishes[0].key].selected,
        [r.dishes[1].key]:s[r.dishes[1].key].selected,
        [r.dishes[2].key]:s[r.dishes[2].key].suggestion.id,
      };
      const prev=L.preview(r,map);
      assert.equal(prev.unresolved.length,0);
      assert.deepEqual(prev.totals,{'i-whole-fish':6,'i-fish':1});
    """)


def test_substring_false_positives_are_rejected():
    run_js(r"""
      const items=[
        {id:'i-tea', name:'Tea'},
        {id:'i-egg', name:'Egg'},
        {id:'i-fish', name:'Fish'},
        {id:'i-dal', name:'Dal'},
        {id:'i-rice', name:'Rice'},
        {id:'i-piece', name:'Piece'},
        {id:'i-paneer-tikka', name:'Paneer Tikka'},
        {id:'i-chicken-curry', name:'Chicken Curry'},
      ];
      const r=L.parseReport([
        ['2025-05-04'],
        ['Category','Item','Code','Qty','Total'],
        ['Sides','Steamed Bun','1','1','20'],
        ['Starters','Eggplant Fry','2','1','50'],
        ['Soups','Shellfish Broth','3','1','90'],
        ['Mains','Dalia Khichdi','4','1','80'],
        ['Combos','Priced Thali','5','1','120'],
        ['Specials','Paneer Butter Tikka','6','1','180'],
        ['Mains','Chicken','7','1','160'],
        ['Desserts','Pie [2 Pieces]','8','1','70'],
      ]);
      const s=L.suggestMappings(r,items,{});
      for (const dish of r.dishes) {
        assert.equal(s[dish.key].status,'none',`unexpected match for ${dish.item}: ${s[dish.key].reason}`);
        assert.equal(s[dish.key].suggestion,null);
        assert.equal(s[dish.key].selected,'');
      }
    """)


def test_duplicate_replacement_and_derived_openings():
    run_js(r"""
      assert.equal(L.importDecision(null,'a',false),'save');
      assert.equal(L.importDecision('a','a',false),'duplicate');
      assert.equal(L.importDecision('a','b',false),'replace-required');
      assert.equal(L.importDecision('a','b',true),'save');
      const item={id:'a', start_date:'2025-01-01', initial_opening:10};
      const entries=[{item_id:'a',day:'2025-01-01',purchase:5,damage:1},
                     {item_id:'a',day:'2025-01-03',purchase:2,damage:0}];
      let imports=[{day:'2025-01-01',sales:{a:4}},{day:'2025-01-03',sales:{a:3}}];
      assert.deepEqual(L.stock(item,'2025-01-03',entries,imports),{opening:10,purchase:2,sale:3,damage:0,closing:9});
      entries[0].purchase=8; // Editing a prior day automatically flows through a missing day.
      assert.equal(L.stock(item,'2025-01-03',entries,imports).closing,12);
      imports[0]={day:'2025-01-01',sales:{a:1}}; // Replace, do not add.
      assert.equal(L.stock(item,'2025-01-03',entries,imports).opening,16);
      assert.equal(L.stock(item,'2025-01-03',entries,imports).closing,15);
      assert.equal(L.stock(item,'2024-12-31',entries,imports),null);
    """)


def test_vendored_sheetjs_reader_pinned_and_compatible():
    vendor = ROOT / 'js' / 'vendor' / 'xlsx.full.min.js'
    data = vendor.read_bytes()
    assert hashlib.sha256(data).hexdigest() == 'cc015130aa8521e7f088f88898eba949ccdcbfb38df0bd129b44b7273c3a6f41'
    assert hashlib.md5(data).hexdigest() == '6b3130af1ceadf07caa0ec08af7addff'
    html = (ROOT / 'inventory.html').read_text(encoding='utf-8')
    assert 'js/vendor/xlsx.full.min.js' in html
    assert 'xlsx@0.18.5' not in html
    run_js(r"""
      const X=require('./js/vendor/xlsx.full.min.js');
      assert.equal(X.version,'0.20.3');
      const rows=[
        ['Item Report'],
        ['Date: 04/05/2025'],
        ['Category','Item','Code','Qty.','Total'],
        ['Starters','','','',''],
        ['','Fish [3 Pieces]','42','2','100'],
        ['','Subtotal','','2','100'],
      ];
      for (const bookType of ['xls','xlsx']) {
        const wb=X.utils.book_new();
        X.utils.book_append_sheet(wb,X.utils.aoa_to_sheet(rows),'Sheet1');
        const buf=X.write(wb,{type:'buffer',bookType});
        const readWb=X.read(buf,{type:'buffer',cellDates:false});
        const sheetRows=X.utils.sheet_to_json(readWb.Sheets[readWb.SheetNames[0]],{header:1,raw:false,defval:''});
        const report=L.parseReport(sheetRows);
        assert.equal(report.date,'2025-05-04');
        assert.equal(report.dishes.length,1);
        assert.equal(report.dishes[0].pieces,6);
      }
    """)


def test_draft_separation_by_user_date_and_sanitization():
    run_js(r"""
      function memStorage() {
        const map=new Map();
        return {
          getItem: k => map.has(k) ? map.get(k) : null,
          setItem: (k,v) => map.set(k, String(v)),
          removeItem: k => map.delete(k),
          dump: () => Object.fromEntries(map.entries()),
        };
      }
      const storage=memStorage();
      assert.notEqual(L.draftStorageKey('user-1'), L.draftStorageKey('user-2'));
      assert.throws(() => L.draftStorageKey(''));

      let s1=L.emptyDraftState();
      s1.selectedDay='2026-11-18';
      s1=L.setEntryDraft(s1,'2026-11-18','item-a',{purchase:'5',damage:'1',basePurchase:0,baseDamage:0});
      s1=L.setEntryDraft(s1,'2026-11-19','item-a',{purchase:'8',damage:'2',basePurchase:3,baseDamage:0});
      s1=L.setItemFormDraft(s1,{editingId:null,name:'Paneer',startDate:'2026-11-18',opening:'15'});
      // Attempt to sneak credentials or private workbook keys in; sanitizer strips them.
      const dirtyObj={...s1, token:'secret-jwt', workbook:[['Dish']], credentials:{key:'abc'}};
      const saved=L.saveDraftState(storage,'user-1',dirtyObj);
      assert.equal(saved.ok,true);
      const rawJson=storage.dump()[L.draftStorageKey('user-1')];
      assert.ok(!rawJson.includes('secret-jwt') && !rawJson.includes('workbook') && !rawJson.includes('credentials'));

      // User 2 sees completely isolated empty state.
      const u2=L.loadDraftState(storage,'user-2');
      assert.equal(u2.restored,false);
      assert.deepEqual(u2.state,L.emptyDraftState());

      // User 1 restores selectedDay, both dates, and itemForm accurately.
      const u1=L.loadDraftState(storage,'user-1');
      assert.equal(u1.restored,true);
      assert.equal(u1.error,null);
      assert.equal(u1.state.selectedDay,'2026-11-18');
      assert.equal(u1.state.entries['2026-11-18']['item-a'].purchase,'5');
      assert.equal(u1.state.entries['2026-11-19']['item-a'].purchase,'8');
      assert.equal(u1.state.itemForm.name,'Paneer');

      const summary=L.draftSummary(u1.state,'2026-11-18');
      assert.equal(summary.currentDayEntries,1);
      assert.equal(summary.otherDayEntries,1);
      assert.deepEqual(summary.otherDates,['2026-11-19']);
      assert.equal(summary.hasItemForm,true);
      assert.equal(summary.totalCount,3);
    """)


def test_draft_refresh_stale_conflict_clear_and_storage_errors():
    run_js(r"""
      const item={id:'a',name:'Fish',start_date:'2026-11-01',initial_opening:10};
      const entries=[{item_id:'a',day:'2026-11-19',purchase:4,damage:1}];
      const imports=[{day:'2026-11-19',sales:{a:3}}];
      // Clean draft matching base -> non-stale
      let st=L.emptyDraftState();
      st=L.setEntryDraft(st,'2026-11-19','a',{purchase:'7',damage:'1',basePurchase:4,baseDamage:1});
      st=L.setEntryDraft(st,'2026-11-19','b',{purchase:'2',damage:'0',basePurchase:0,baseDamage:0});
      let resolved=L.resolveRowState(item,'2026-11-19',entries,imports,st.entries['2026-11-19']);
      assert.equal(resolved.dirty,true);
      assert.equal(resolved.stale,false);
      assert.equal(resolved.closing,13);

      // Server changes under the draft -> flagged stale without mutating server data
      entries[0].purchase=6;
      resolved=L.resolveRowState(item,'2026-11-19',entries,imports,st.entries['2026-11-19']);
      assert.equal(resolved.stale,true);
      assert.equal(resolved.base.purchase,6);
      assert.equal(resolved.purchaseInput,'7');

      // Item form stale check
      const fDraft=L.setItemFormDraft(st,{editingId:'a',name:'Sea Fish',startDate:'2026-11-01',opening:'10',baseName:'Fish',baseOpening:10}).itemForm;
      assert.equal(L.isItemFormDraftStale(fDraft,[item]).stale,false);
      assert.equal(L.isItemFormDraftStale(fDraft,[{...item,initial_opening:12}]).stale,true);
      assert.equal(L.isItemFormDraftStale(fDraft,[]).missing,true);

      // Clearing one saved row leaves other rows & dates untouched
      const afterClear=L.clearEntryDraft(st,'2026-11-19','a');
      assert.equal(afterClear.entries['2026-11-19'].a, undefined);
      assert.equal(afterClear.entries['2026-11-19'].b.purchase,'2');

      // Storage failures & corrupted payloads report errors instead of crashing
      const badStorage={
        getItem: () => '{broken json',
        setItem: () => { throw new Error('QuotaExceededError'); },
        removeItem: () => {},
      };
      const badLoad=L.loadDraftState(badStorage,'u1');
      assert.match(badLoad.error,/corrupted/i);
      const badSave=L.saveDraftState(badStorage,'u1',st);
      assert.equal(badSave.ok,false);
      assert.match(badSave.error,/QuotaExceededError/);
    """)


def test_sheet_export_rows_and_a4_pagination_no_clipping():
    run_js(r"""
      const items=[];
      for (let i=1;i<=55;i++) {
        items.push({
          id:`item-${i}`,
          name: i===2 ? 'Extra Long Specialty Restaurant Dish Name With Wrapping Test Case' : `Stock Item ${i}`,
          start_date: i===55 ? '2026-12-01' : '2026-11-01',
          initial_opening: 20 + i,
        });
      }
      const entries=[{item_id:'item-1',day:'2026-11-19',purchase:5,damage:2}];
      const imports=[{day:'2026-11-19',sales:{'item-1':10}}];
      const drafts={'item-1':{purchase:'8',damage:'1',basePurchase:5,baseDamage:2}};
      const rows=L.buildSheetExportRows(items,'2026-11-19',entries,imports,drafts);
      // Saved data is never mutated by building export rows.
      assert.equal(entries[0].purchase,5);
      assert.equal(rows.length,55);
      assert.equal(rows[0].isDraft,true);
      assert.equal(rows[0].opening,21);
      assert.equal(rows[0].purchase,8);
      assert.equal(rows[0].sale,10);
      assert.equal(rows[0].damage,1);
      assert.equal(rows[0].closing,18);
      assert.equal(rows[54].available,false);

      const pages=L.paginateSheetRows(rows,22);
      assert.ok(pages.length >= 3);
      const flattened=pages.flat();
      assert.equal(flattened.length,55);
      assert.deepEqual(flattened.map(r=>r.itemName), rows.map(r=>r.itemName));

      // Variable wrapped 200-char names measured in real pixels never overflow maxBodyHeight
      const longItems=[];
      for (let i=1;i<=12;i++) {
        longItems.push({
          id:`long-${i}`,
          name:(`WIDE_DISH_${i}_` + 'W'.repeat(188)).slice(0,200),
          start_date:'2026-11-01',
          initial_opening:10,
        });
      }
      const longDrafts={ 'long-1':{purchase:'3',damage:'0',basePurchase:0,baseDamage:0} };
      const longRows=L.buildSheetExportRows(longItems,'2026-11-19',[], [], longDrafts);
      const wideMeasure=s=>String(s).length*16;
      const maxBodyHeight=1420;
      const measuredPages=L.layoutSheetPages(longRows,{nameMaxWidth:336, maxBodyHeight, measureName:wideMeasure});
      assert.ok(measuredPages.length >= 3);
      for (const page of measuredPages) {
        assert.ok(page.usedHeight <= maxBodyHeight, `Page height ${page.usedHeight} exceeded ${maxBodyHeight}`);
        const sum=page.rows.reduce((acc,r)=>acc+r.rowHeight,0);
        assert.equal(sum,page.usedHeight);
      }
      const flatNames=measuredPages.flatMap(p=>p.rows.map(r=>r.itemName));
      assert.deepEqual(flatNames,longRows.map(r=>r.itemName));

      // Exceptionally tall row (> maxBodyHeight) splits cleanly across continuation slices without losing characters
      const giantName='X'.repeat(200) + ' ' + 'Y'.repeat(199);
      const giantRows=L.buildSheetExportRows([{id:'g1',name:giantName,start_date:'2026-11-01',initial_opening:5}],'2026-11-19',[], [], {'g1':{purchase:'1',damage:'0',basePurchase:0,baseDamage:0}});
      const compactPages=L.layoutSheetPages(giantRows,{nameMaxWidth:180, maxBodyHeight:220, measureName:wideMeasure});
      assert.ok(compactPages.length >= 2);
      for (const page of compactPages) assert.ok(page.usedHeight <= 220);
      assert.equal(compactPages[0].rows[0].isContinuation,false);
      assert.equal(compactPages[0].rows[0].hasContinuation,true);
      assert.equal(compactPages[compactPages.length-1].rows[0].isContinuation,true);
      assert.equal(compactPages[compactPages.length-1].rows[0].hasContinuation,false);
      const rejoined=compactPages.flatMap(p=>p.rows.flatMap(r=>r.nameLines)).join(' ');
      assert.equal(rejoined.replace(/\s+/g,''), giantName.replace(/\s+/g,''));
    """)


def test_ui_draft_restore_save_failure_date_switch_and_print_export():
    run_js(r"""
      const fs=require('node:fs'), vm=require('node:vm'), crypto=require('node:crypto');
      function makeEl(tag, focusLog) {
        const node={
          tagName:String(tag).toUpperCase(),
          children:[], className:'', textContent:'', hidden:false, disabled:false,
          dataset:{}, attrs:{}, type:'', colSpan:1, href:'', download:'',
          append(...kids){ for (const k of kids) this.children.push(typeof k==='string'?{textContent:k,children:[]}:k); },
          replaceChildren(...kids){ this.children=[]; this.append(...kids); },
          setAttribute(k,v){ this.attrs[k]=v; },
          focus(){ if (focusLog) focusLog.push(this.attrs['aria-label'] || this.textContent || this.tagName); },
          select(){}, reset(){ this._val=''; }, click(){ if (this.onclick) this.onclick(); },
          querySelectorAll(sel){
            const out=[];
            (function walk(n){
              if (!n) return;
              if (sel==='tr' && n.tagName==='TR') out.push(n);
              if (sel==='th,td' && (n.tagName==='TH' || n.tagName==='TD')) out.push(n);
              if (sel==='input,select,button' && ['INPUT','SELECT','BUTTON'].includes(n.tagName)) out.push(n);
              if (sel==='#mapping-list select' && n.tagName==='SELECT') out.push(n);
              for (const c of n.children||[]) walk(c);
            })(this);
            return out;
          },
        };
        Object.defineProperty(node,'value',{
          get(){ return this._val!==undefined ? this._val : ''; },
          set(v){ this._val=String(v); },
        });
        return node;
      }

      const store=new Map();
      const localStorage={
        getItem:k=>store.has(k)?store.get(k):null,
        setItem:(k,v)=>store.set(k,String(v)),
        removeItem:k=>store.delete(k),
      };

      const db={
        profiles:[{id:'user-A',restaurant_name:'Ichamotee Kitchen'}],
        inventory_items:[
          {user_id:'user-A',id:'i1',name:'Fish',start_date:'2026-11-01',initial_opening:20},
          {user_id:'user-A',id:'i2',name:'Chicken',start_date:'2026-11-01',initial_opening:15},
        ],
        inventory_entries:[
          {user_id:'user-A',item_id:'i1',day:'2026-11-19',purchase:2,damage:0},
        ],
        inventory_imports:[
          {user_id:'user-A',day:'2026-11-19',sales:{i1:5}},
        ],
        inventory_mappings:[],
        inventory_corrections:[],
      };

      let failUpsert=false, failPreRead=false, printCalls=0, sharedPayload=null, blobCount=0, allowShare=true;
      let onBeforeEntryWrite=null, onBeforeItemWrite=null;
      const confirmQueue=[];

      function bootApp(userId='user-A') {
        const ids={}, focusLog=[];
        for (const id of ['day','prev-day','next-day','restaurant-name','message','storage-warning','storage-warning-text','draft-status','draft-status-text','discard-drafts','stock','print-sheet-btn','export-png-btn','export-fallback','item-form','item-name','item-start','item-opening','item-submit','item-submit-label','cancel-edit','discard-item-draft','item-draft-note','item-list','file','import-area','report-info','mapping-list','preview','preview-area','totals','replacement','confirm-import','print-sheet']) {
          ids[id]=makeEl(id==='stock'?'tbody':id==='print-sheet'?'section':'div', focusLog);
        }
        const _supabase={
          from(table){
            const q={
              _filters:{},
              _op:null,
              _payload:null,
              select(){ return this; },
              eq(col,val){ this._filters[col]=val; return this; },
              order(){ return this; },
              range: async()=>({data:(db[table]||[]).slice(), error:null}),
              maybeSingle: async()=>{
                if (failPreRead) return {data:null, error:new Error('Server check timed out')};
                const list=db[table]||[];
                const found=list.find(r=>Object.entries(q._filters).every(([k,v])=>r[k]===v))||null;
                return {data:found ? {...found} : null, error:null};
              },
              upsert: async(payload)=>{
                if (table==='inventory_entries' && onBeforeEntryWrite) await onBeforeEntryWrite(payload);
                if (failUpsert) return {error:new Error('Network offline')};
                const idx=db.inventory_entries.findIndex(e=>e.user_id===payload.user_id&&e.item_id===payload.item_id&&e.day===payload.day);
                if (idx>=0) db.inventory_entries[idx]={...payload}; else db.inventory_entries.push({...payload});
                return {error:null};
              },
              update(patch){ this._op='update'; this._payload=patch; return this; },
              insert(payload){ this._op='insert'; this._payload=payload; return this; },
              then(resolve, reject){
                (async()=>{
                  if (table==='inventory_items' && q._op==='update') {
                    if (onBeforeItemWrite) await onBeforeItemWrite(q._payload);
                    const target=db.inventory_items.find(i=>i.id===q._filters.id);
                    if (target) Object.assign(target, q._payload);
                    return {error:null};
                  }
                  if (table==='inventory_items' && q._op==='insert') {
                    db.inventory_items.push({id:`i${db.inventory_items.length+1}`, ...q._payload});
                    return {error:null};
                  }
                  return {error:null};
                })().then(resolve, reject);
              },
            };
            return q;
          },
          rpc: async(fn, params)=>{
            if (fn==='inventory_save_entry') {
              if (failPreRead) return {data:null, error:new Error('Server check timed out')};
              const idx=db.inventory_entries.findIndex(e=>e.user_id===userId&&e.item_id===params.p_item_id&&e.day===params.p_day);
              const existing=idx>=0 ? db.inventory_entries[idx] : null;
              const curExists=Boolean(existing);
              const curP=existing ? Number(existing.purchase) : 0;
              const curD=existing ? Number(existing.damage) : 0;
              if ((params.p_expected_exists!==null && curExists!==params.p_expected_exists)
                  || curP!==Number(params.p_expected_purchase||0)
                  || curD!==Number(params.p_expected_damage||0)) {
                return {data:{status:'conflict', exists:curExists, purchase:curP, damage:curD}, error:null};
              }
              if (onBeforeEntryWrite) await onBeforeEntryWrite(params);
              if (failUpsert) return {data:null, error:new Error('Network offline')};
              const payload={user_id:userId, item_id:params.p_item_id, day:params.p_day, purchase:params.p_purchase, damage:params.p_damage};
              if (idx>=0) db.inventory_entries[idx]=payload; else db.inventory_entries.push(payload);
              return {data:{status:'saved', exists:true, purchase:params.p_purchase, damage:params.p_damage}, error:null};
            }
            return {data:'saved',error:null};
          },
        };
        const document={
          title:'',
          getElementById:id=>ids[id],
          createElement:tag=>{
            if (tag==='canvas') {
              const ctx={
                fillStyle:'',strokeStyle:'',lineWidth:1,font:'',textAlign:'left',
                fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},
                fillText(){},measureText:t=>({width:String(t).length*10}),
              };
              return { width:0, height:0, getContext:()=>ctx, toBlob:cb=>cb({size:100,type:'image/png'}) };
            }
            return makeEl(tag, focusLog);
          },
          createElementNS:(_ns, tag)=>makeEl(tag, focusLog),
          createTextNode:t=>({textContent:String(t),children:[]}),
          querySelectorAll:()=>[],
        };
        const windowObj={
          localStorage,
          print:()=>{ printCalls++; },
        };
        const navigatorObj={
          canShare:({files})=>Boolean(allowShare && files && files.length),
          share:async(payload)=>{ sharedPayload=payload; },
        };
        function FakeFile(parts,name,opts){ this.parts=parts; this.name=name; this.type=opts?.type||''; }
        const sandbox={
          InventoryLogic:L,
          _supabase,
          checkAuth:async()=>({user:{id:userId}}),
          document,
          window:windowObj,
          localStorage,
          navigator:navigatorObj,
          File:FakeFile,
          URL:{ createObjectURL:()=>`blob:page-${++blobCount}`, revokeObjectURL:()=>{} },
          confirm:()=> confirmQueue.length ? confirmQueue.shift() : true,
          crypto:crypto.webcrypto,
          TextEncoder, Uint8Array, JSON, Number, String, Array, Object, Set, Map, Date, Error, Promise,
        };
        vm.runInNewContext(fs.readFileSync('./js/inventory.js','utf8'), sandbox);
        return { ids, focusLog };
      }

      async function run() {
        // 1) Start session, select 2026-11-19, edit row 1 (purchase=6) and item form
        let app=bootApp('user-A');
        await new Promise(r=>setTimeout(r,20));
        assert.equal(app.ids['restaurant-name'].textContent,'Ichamotee Kitchen');
        app.ids['day'].value='2026-11-19';
        app.ids['day'].onchange();

        const row0=app.ids['stock'].children[0];
        const pInput=row0.children[2].children[0];
        const dInput=row0.children[4].children[0];
        pInput.value='6'; pInput.oninput();
        assert.equal(row0.children[5].textContent,'21');
        pInput.onkeydown({key:'Enter',preventDefault(){}});
        dInput.onkeydown({key:'Enter',preventDefault(){}});
        pInput.onkeydown({key:'ArrowDown',preventDefault(){}});
        assert.deepEqual(app.focusLog,['Damage for Fish','Save stock row for Fish','Purchase for Chicken']);
        app.ids['item-name'].value='Mutton'; app.ids['item-name'].oninput();

        // Switch date -> dirty draft on 2026-11-19 stays persisted
        app.ids['prev-day'].onclick();
        assert.equal(app.ids['day'].value,'2026-11-18');
        assert.match(app.ids['draft-status-text'].textContent,/2026-11-19/);
        app.ids['next-day'].onclick();
        assert.equal(app.ids['day'].value,'2026-11-19');

        // 2) Simulate page refresh -> restores date, draft purchase=6, pending item form
        app=bootApp('user-A');
        await new Promise(r=>setTimeout(r,20));
        assert.equal(app.ids['day'].value,'2026-11-19');
        assert.equal(app.ids['item-name'].value,'Mutton');
        assert.equal(app.ids['stock'].children[0].children[2].children[0].value,'6');
        assert.match(app.ids['draft-status-text'].textContent,/Restored unsaved local drafts/);

        // 3) User-B sees zero drafts from User-A
        const appB=bootApp('user-B');
        await new Promise(r=>setTimeout(r,20));
        assert.equal(appB.ids['draft-status'].hidden,true);
        assert.equal(appB.ids['item-name'].value,'');

        // 4) Print and Export PNG with draft confirmation + multi-page long item name export
        confirmQueue.push(false);
        app.ids['print-sheet-btn'].onclick();
        assert.equal(printCalls,0);
        confirmQueue.push(true);
        app.ids['print-sheet-btn'].onclick();
        assert.equal(printCalls,1);
        const printRoot=app.ids['print-sheet'];
        const headerTexts=printRoot.children[2].children[0].children[0].children.map(th=>th.textContent);
        assert.deepEqual(headerTexts,['Item','Opening','Purchase','Sale','Closing','Damage']);
        assert.equal(printRoot.querySelectorAll('input,select,button').length,0);
        assert.match(printRoot.children[1].textContent,/unsaved draft/i);

        confirmQueue.push(true);
        await app.ids['export-png-btn'].onclick();
        assert.equal(sharedPayload.files.length,1);
        assert.match(sharedPayload.files[0].name,/-DRAFT\.png$/);

        allowShare=false;
        confirmQueue.push(true);
        await app.ids['export-png-btn'].onclick();
        assert.equal(app.ids['export-fallback'].hidden,false);
        assert.match(app.ids['export-fallback'].children[0].textContent,/not supported/i);

        // 5) Fresh server conflict after load: server updated behind cached entries!
        db.inventory_entries[0].purchase=4; // updated on server by another device after page load
        failPreRead=true;
        let saveBtn0=app.ids['stock'].children[0].children[6].children[0].children[0];
        await saveBtn0.onclick();
        assert.equal(app.ids['message'].className,'error');
        assert.equal(db.inventory_entries[0].purchase,4); // failed pre-read never saves
        assert.equal(L.loadDraftState(localStorage,'user-A').state.entries['2026-11-19'].i1.purchase,'6');

        failPreRead=false;
        confirmQueue.push(false); // user declines overwriting server=4 with draft=6
        await saveBtn0.onclick();
        assert.equal(db.inventory_entries[0].purchase,4);
        assert.equal(L.loadDraftState(localStorage,'user-A').state.entries['2026-11-19'].i1.purchase,'6');
        assert.match(app.ids['stock'].children[0].className,/row-stale/);

        // 6) Edit made WHILE earlier save is in flight is NOT lost when earlier save completes!
        confirmQueue.push(true); // confirm overwrite (write 6)
        onBeforeEntryWrite=async()=>{
          const liveP=app.ids['stock'].children[0].children[2].children[0];
          liveP.value='9';
          liveP.oninput();
        };
        saveBtn0=app.ids['stock'].children[0].children[6].children[0].children[0];
        await saveBtn0.onclick();
        onBeforeEntryWrite=null;
        assert.equal(db.inventory_entries[0].purchase,6);
        const postInFlight=L.loadDraftState(localStorage,'user-A').state;
        assert.equal(postInFlight.entries['2026-11-19'].i1.purchase,'9');
        assert.equal(postInFlight.entries['2026-11-19'].i1.basePurchase,6);
        assert.equal(app.ids['stock'].children[0].children[2].children[0].value,'9');

        // 7) Failed write preserves draft; clean save clears ONLY that row draft
        failUpsert=true;
        saveBtn0=app.ids['stock'].children[0].children[6].children[0].children[0];
        await saveBtn0.onclick();
        assert.equal(app.ids['message'].className,'error');
        assert.equal(L.loadDraftState(localStorage,'user-A').state.entries['2026-11-19'].i1.purchase,'9');

        failUpsert=false;
        await saveBtn0.onclick();
        await new Promise(r=>setTimeout(r,10));
        const afterSave=L.loadDraftState(localStorage,'user-A').state;
        assert.equal(afterSave.entries['2026-11-19'], undefined);
        assert.equal(afterSave.itemForm.name,'Mutton');

        // 8) Fresh server conflict on item edit + in-flight item form edit protection
        app.ids['discard-item-draft'].onclick();
        const editBtn0=app.ids['item-list'].children[0].children[1];
        editBtn0.onclick();
        app.ids['item-opening'].value='22';
        app.ids['item-opening'].oninput();
        db.inventory_items[0].initial_opening=25; // another device edited item after page load
        confirmQueue.push(false);
        await app.ids['item-form'].onsubmit({preventDefault(){}});
        assert.equal(db.inventory_items[0].initial_opening,25);
        assert.equal(L.loadDraftState(localStorage,'user-A').state.itemForm.opening,'22');

        confirmQueue.push(true);
        onBeforeItemWrite=async()=>{
          app.ids['item-name'].value='King Fish';
          app.ids['item-name'].oninput();
        };
        await app.ids['item-form'].onsubmit({preventDefault(){}});
        onBeforeItemWrite=null;
        assert.equal(db.inventory_items[0].initial_opening,22);
        assert.equal(app.ids['item-name'].value,'King Fish');
        assert.equal(L.loadDraftState(localStorage,'user-A').state.itemForm.name,'King Fish');

        // Deleted item on server fails pre-read without clearing in-flight draft
        db.inventory_items=db.inventory_items.filter(i=>i.id!=='i1');
        await app.ids['item-form'].onsubmit({preventDefault(){}});
        assert.equal(app.ids['message'].className,'error');
        assert.match(app.ids['message'].textContent,/no longer available/i);
        assert.equal(L.loadDraftState(localStorage,'user-A').state.itemForm.name,'King Fish');
      }
      run().catch(e=>{ console.error(e); process.exit(1); });
    """)


def test_ui_png_export_wraps_long_names_without_overflow():
    run_js(r"""
      const fs=require('node:fs'), vm=require('node:vm'), crypto=require('node:crypto');
      function makeEl(tag) {
        const node={
          tagName:String(tag).toUpperCase(), children:[], className:'', textContent:'', hidden:false, disabled:false,
          dataset:{}, attrs:{}, type:'', colSpan:1, href:'', download:'',
          append(...kids){ for (const k of kids) this.children.push(typeof k==='string'?{textContent:k,children:[]}:k); },
          replaceChildren(...kids){ this.children=[]; this.append(...kids); },
          setAttribute(k,v){ this.attrs[k]=v; }, focus(){}, select(){}, reset(){ this._val=''; }, click(){},
          querySelectorAll:()=>[],
        };
        Object.defineProperty(node,'value',{
          get(){ return this._val!==undefined ? this._val : ''; },
          set(v){ this._val=String(v); },
        });
        return node;
      }

      const longItems=[];
      for (let i=1;i<=16;i++) {
        longItems.push({
          id:`item-${i}`,
          name:(`ITEM_${i}_` + 'W'.repeat(190)).slice(0,200),
          start_date:'2026-11-01',
          initial_opening:50,
        });
      }
      const store=new Map();
      const ids={};
      for (const id of ['day','prev-day','next-day','restaurant-name','message','storage-warning','storage-warning-text','draft-status','draft-status-text','discard-drafts','stock','print-sheet-btn','export-png-btn','export-fallback','item-form','item-name','item-start','item-opening','item-submit','item-submit-label','cancel-edit','discard-item-draft','item-draft-note','item-list','file','import-area','report-info','mapping-list','preview','preview-area','totals','replacement','confirm-import','print-sheet']) {
        ids[id]=makeEl('div');
      }
      const renderedPages=[];
      const localStorage={
        getItem:k=>store.has(k)?store.get(k):null,
        setItem:(k,v)=>store.set(k,String(v)),
        removeItem:k=>store.delete(k),
      };
      let sharedFiles=null;
      const sandbox={
        InventoryLogic:L,
        _supabase:{
          from(table){
            return {
              select(){ return this; }, eq(){ return this; }, order(){ return this; },
              range:async()=>({data: table==='inventory_items' ? longItems : [], error:null}),
              maybeSingle:async()=>({data:{restaurant_name:'Very Long Signature Restaurant Name For Wrapping Verification'}, error:null}),
            };
          },
        },
        checkAuth:async()=>({user:{id:'u-png'}}),
        document:{
          title:'',
          getElementById:id=>ids[id],
          createElement:tag=>{
            if (tag==='canvas') {
              const drawn=[];
              const ctx={
                fillStyle:'',strokeStyle:'',lineWidth:1,font:'',textAlign:'left',
                fillRect(){},strokeRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},
                fillText(str,x,y){ drawn.push({str:String(str),x,y}); },
                measureText:t=>({width:String(t).length*(ctx.font.includes('34px')?22:16)}),
              };
              const canvas={width:0,height:0,getContext:()=>ctx,toBlob:cb=>{ renderedPages.push({w:canvas.width,h:canvas.height,drawn}); cb({size:123,type:'image/png'}); }};
              return canvas;
            }
            return makeEl(tag);
          },
          createElementNS:(_ns,tag)=>makeEl(tag),
          createTextNode:t=>({textContent:String(t),children:[]}),
          querySelectorAll:()=>[],
        },
        window:{ localStorage },
        localStorage,
        navigator:{
          canShare:({files})=>Boolean(files && files.length),
          share:async({files})=>{ sharedFiles=files; },
        },
        File:function(parts,name,opts){ this.parts=parts; this.name=name; this.type=opts?.type||''; },
        URL:{ createObjectURL:()=>'blob:test', revokeObjectURL:()=>{} },
        confirm:()=>true,
        crypto:crypto.webcrypto,
        TextEncoder, Uint8Array, JSON, Number, String, Array, Object, Set, Map, Date, Error, Promise,
      };
      vm.runInNewContext(fs.readFileSync('./js/inventory.js','utf8'), sandbox);

      async function run() {
        await new Promise(r=>setTimeout(r,20));
        // Edit row 0 to include a draft badge on page 1 too
        const p0=ids['stock'].children[0].children[2].children[0];
        p0.value='7'; p0.oninput();
        await ids['export-png-btn'].onclick();

        assert.ok(renderedPages.length >= 4, `Expected >=4 A4 pages for wide 200-char names, got ${renderedPages.length}`);
        assert.equal(sharedFiles.length, renderedPages.length);
        const allText=renderedPages.flatMap(p=>p.drawn.map(d=>d.str)).join('\n');
        for (const p of renderedPages) {
          assert.equal(p.w,1240);
          assert.equal(p.h,1754);
          // Every body line (excluding the footer at y=1712) stays cleanly above footer at y<=1680!
          for (const d of p.drawn) {
            if (!d.str.startsWith('* Draft') && !d.str.startsWith('Page ')) {
              assert.ok(d.y <= 1680, `Text "${d.str}" overflowed y=${d.y}`);
            }
          }
        }
        // Every 200-char item name line chunks join cleanly to match all 12 items without truncation!
        const collapsed=allText.replace(/\n/g,'');
        for (const it of longItems) {
          assert.ok(collapsed.includes(it.name), `Missing or truncated item name ${it.name.slice(0,20)}`);
        }
        assert.ok(allText.includes('DRAFT (unsaved)'));
      }
      run().catch(e=>{ console.error(e); process.exit(1); });
    """)


def test_start_date_can_be_moved_to_the_month_start():
    run_js(r"""
      // An item first entered mid-month can be re-anchored to the 1st: the opening is the count on
      // the start date, later movements still pile onto it, and earlier days stay unavailable.
      const item={id:'i1',name:'Paneer',start_date:'2025-08-01',initial_opening:10};
      const entries=[{item_id:'i1',day:'2025-08-05',purchase:4,damage:1}];
      const imports=[{day:'2025-08-06',sales:{i1:2}}];
      const moved=L.stock(item,'2025-08-06',entries,imports);
      assert.equal(moved.opening,13);
      assert.equal(moved.sale,2);
      assert.equal(moved.closing,11);
      assert.equal(L.stock({...item,start_date:'2025-08-18'},'2025-08-10',entries,imports),null);
      // A start date change is detected as a stale item edit draft.
      const draft={editingId:'i1',baseName:'Paneer',baseOpening:10,baseStartDate:'2025-08-18'};
      assert.equal(L.isItemFormDraftStale(draft,[item]).stale,true);
      assert.equal(L.isItemFormDraftStale(draft,[{...item,start_date:'2025-08-18'}]).stale,false);
      assert.equal(L.isItemFormDraftStale({editingId:'i1',baseName:'Paneer',baseOpening:10},[item]).stale,false);
    """)


def test_saved_dish_choices_fill_in_the_next_days_report():
    run_js(r"""
      // The point of saving mappings: a dish chosen once must fill itself in on later reports.
      const items=[
        {id:'i-roti',name:'Tawa Roti',start_date:'2025-01-01'},
        {id:'i-rice',name:'Steamed Rice',start_date:'2025-01-01'},
      ];
      const report=(date,rotis,rices)=>L.parseReport([
        ['Item Report'],[`Date: ${date}`],
        ['Category','Item','Code','Qty.','Total'],
        ['Breakfast','Tawa Roti [1 Piece]','4',String(rotis),'40'],
        ['Rice','Steamed Rice','31',String(rices),'150'],
        ['','Grand Total','','','190'],
      ]);
      const day1=report('04/05/2025',2,5);
      const choices=Object.fromEntries(day1.dishes.map((d,i)=>[d.key, i===0 ? 'i-roti' : 'i-rice']));
      const day2=report('05/05/2025',6,3);
      assert.deepEqual(day2.dishes.map(d=>d.key), day1.dishes.map(d=>d.key)); // same dish keys across days
      const savedRows=Object.entries(choices).map(([k,v])=>({dish_key:k,item_id:v,ignored:false}));
      const filled=Object.fromEntries(Object.entries(L.suggestMappings(day2,items,savedRows)).map(([k,m])=>[k,m.selected]));
      const preview=L.preview(day2,filled);
      assert.deepEqual(preview.unresolved,[]);
      assert.deepEqual(preview.totals,{'i-roti':6,'i-rice':3});
    """)
