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
