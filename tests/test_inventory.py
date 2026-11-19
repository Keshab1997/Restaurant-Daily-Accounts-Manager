"""Focused, synthetic tests of browser-independent inventory logic."""
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
