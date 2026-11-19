"""Focused synthetic unit, UI lifecycle, and SQL migration checks for recoverable day corrections."""
import re
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def run_js(script):
    code = "const assert=require('node:assert/strict'); const L=require('./js/inventory-logic.js');\n" + script
    subprocess.run(['node', '-e', code], cwd=ROOT, check=True, capture_output=True, text=True)


def test_day_summary_draft_guards_and_conflict_logic():
    run_js(r"""
      const items = [
        { id: 'i1', name: 'Fish', start_date: '2026-11-01', initial_opening: 20 },
        { id: 'i2', name: 'Chicken', start_date: '2026-11-10', initial_opening: 10 },
      ];
      const entries = [
        { item_id: 'i1', day: '2026-11-18', purchase: 0, damage: 0 },
        { item_id: 'i2', day: '2026-11-18', purchase: 5, damage: 1 },
        { item_id: 'i1', day: '2026-11-20', purchase: 3, damage: 0 },
      ];
      const imports = [
        { day: '2026-11-18', fingerprint: 'a'.repeat(64), sales: { i1: 4, i2: 2 } },
      ];

      // Draft guards scoped per day
      let st = L.emptyDraftState();
      assert.equal(L.hasDayDrafts(st, '2026-11-18'), false);
      st = L.setEntryDraft(st, '2026-11-17', 'i1', { purchase: '2', damage: '0', basePurchase: 0, baseDamage: 0, baseExists: false });
      assert.equal(L.hasDayDrafts(st, '2026-11-18'), false);
      assert.equal(L.hasDayDrafts(st, '2026-11-17'), true);
      assert.equal(L.dayDraftCount(st, '2026-11-17'), 1);

      // baseExists catches server row removal even when values were 0/0
      assert.equal(L.hasEntryServerConflict(0, 0, 0, 0, true, false), true);
      assert.equal(L.hasEntryServerConflict(0, 0, 0, 0, null, false), false);
      const staleRemoved = L.resolveRowState(
        items[0],
        '2026-11-18',
        [{ item_id: 'i2', day: '2026-11-18', purchase: 5, damage: 1 }], // i1 row was deleted
        imports,
        { i1: { purchase: '1', damage: '0', basePurchase: 0, baseDamage: 0, baseExists: true, revision: 1 } }
      );
      assert.equal(staleRemoved.stale, true);

      // Summary counts exact saved rows (including zeroed rows) and later dates
      const sum18 = L.summarizeDayForClear('2026-11-18', entries, imports);
      assert.equal(sum18.isSalesEmpty, false);
      assert.equal(sum18.isWholeDayEmpty, false);
      assert.equal(sum18.entryCount, 2);
      assert.equal(sum18.totalPurchase, 5);
      assert.equal(sum18.totalDamage, 1);
      assert.equal(sum18.salesItemCount, 2);
      assert.equal(sum18.totalSalesPieces, 6);
      assert.deepEqual(sum18.laterDates, ['2026-11-20']);
      assert.equal(sum18.laterDatesCount, 1);
      assert.equal(sum18.importFingerprint, 'a'.repeat(64));

      const sumEmpty = L.summarizeDayForClear('2026-11-19', entries, imports);
      assert.equal(sumEmpty.isSalesEmpty, true);
      assert.equal(sumEmpty.isWholeDayEmpty, true);
      assert.equal(sumEmpty.entryCount, 0);
      assert.deepEqual(sumEmpty.laterDates, ['2026-11-20']);

      // Conflict detection and summary formatting (exact numbers, never mutated by pieces())
      const corr = {
        id: 'c1',
        day: '2026-11-18',
        scope: 'whole_day',
        created_at: '2026-11-18T10:00:00Z',
        restored_at: null,
        import_snapshot: { fingerprint: 'a'.repeat(64), sales: { i1: 4, i2: 2 } },
        entries_snapshot: [
          { item_id: 'i1', purchase: 12, damage: 3 },
          { item_id: 'i2', purchase: 5, damage: 1 },
        ],
      };
      const fmtSum = L.formatCorrectionSummary(corr);
      assert.match(fmtSum.detailText, /2 movement rows \(17 purchase, 4 damage\)/);
      assert.match(fmtSum.detailText, /2 items, 6 pcs/);

      // Empty slots -> ok
      assert.equal(L.checkRestoreConflicts(corr, items, [], []).ok, true);

      // Single entry occupied -> all-or-nothing conflict
      const entryConflict = L.checkRestoreConflicts(
        corr,
        items,
        [{ item_id: 'i2', day: '2026-11-18', purchase: 2, damage: 0 }],
        []
      );
      assert.equal(entryConflict.ok, false);
      assert.equal(entryConflict.entryConflicts.length, 1);
      assert.match(entryConflict.reasons[0], /Chicken.*Purchase 2, Damage 0/);

      // Sales occupied -> conflict
      const importConflict = L.checkRestoreConflicts(corr, items, [], imports);
      assert.equal(importConflict.ok, false);
      assert.equal(importConflict.hasImportConflict, true);

      // Start date moved later -> conflict
      const movedItems = [
        items[0],
        { id: 'i2', name: 'Chicken', start_date: '2026-11-25', initial_opening: 10 },
      ];
      const startConflict = L.checkRestoreConflicts(corr, movedItems, [], []);
      assert.equal(startConflict.ok, false);
      assert.equal(startConflict.startDateConflicts.length, 1);

      // Already restored -> conflict
      assert.equal(
        L.checkRestoreConflicts({ ...corr, restored_at: '2026-11-18T12:00:00Z' }, items, [], []).alreadyRestored,
        true
      );
    """)


def test_ui_recoverable_day_corrections_draft_blockers_and_atomicity():
    run_js(r"""
      const fs = require('node:fs'), vm = require('node:vm'), crypto = require('node:crypto');

      function makeEl(tag, focusLog) {
        const node = {
          tagName: String(tag).toUpperCase(),
          children: [],
          className: '',
          textContent: '',
          hidden: false,
          disabled: false,
          dataset: {},
          attrs: {},
          type: '',
          colSpan: 1,
          append(...kids) {
            for (const k of kids) this.children.push(typeof k === 'string' ? { textContent: k, children: [] } : k);
          },
          replaceChildren(...kids) { this.children = []; this.append(...kids); },
          setAttribute(k, v) { this.attrs[k] = v; },
          focus() { if (focusLog) focusLog.push(this.attrs['aria-label'] || this.tagName); },
          select() {},
          reset() { this._val = ''; },
          querySelectorAll() { return []; },
        };
        Object.defineProperty(node, 'value', {
          get() { return this._val !== undefined ? this._val : ''; },
          set(v) { this._val = String(v); },
        });
        return node;
      }

      const store = new Map();
      const localStorage = {
        getItem: k => store.has(k) ? store.get(k) : null,
        setItem: (k, v) => store.set(k, String(v)),
        removeItem: k => store.delete(k),
      };

      const fp18 = '1'.repeat(64);
      const fp19 = '2'.repeat(64);
      const db = {
        inventory_items: [
          { user_id: 'user-A', id: 'i1', name: 'Fish', start_date: '2026-11-01', initial_opening: 20 },
          { user_id: 'user-A', id: 'i2', name: 'Chicken', start_date: '2026-11-01', initial_opening: 10 },
        ],
        inventory_entries: [
          { user_id: 'user-A', item_id: 'i1', day: '2026-11-18', purchase: 5, damage: 1 },
          { user_id: 'user-A', item_id: 'i2', day: '2026-11-18', purchase: 3, damage: 0 },
          { user_id: 'user-A', item_id: 'i1', day: '2026-11-19', purchase: 2, damage: 0 },
        ],
        inventory_imports: [
          { user_id: 'user-A', day: '2026-11-18', fingerprint: fp18, sales: { i1: 4, i2: 2 } },
          { user_id: 'user-A', day: '2026-11-19', fingerprint: fp19, sales: { i1: 3 } },
        ],
        inventory_mappings: [
          { user_id: 'user-A', dish_key: 'fish-1', item_id: 'i1', ignored: false },
        ],
        inventory_corrections: [],
      };

      let seq = 0;
      let onBeforeClearRpc = null;
      let onBeforeRestoreRpc = null;
      const rpcCalls = [];
      const confirmQueue = [];
      let printCalls = 0;

      function bootApp(userId = 'user-A') {
        const ids = {}, focusLog = [], windowListeners = {};
        const allIds = [
          'day', 'prev-day', 'next-day', 'restaurant-name', 'message',
          'storage-warning', 'storage-warning-text', 'draft-status', 'draft-status-text', 'discard-drafts',
          'stock', 'print-sheet-btn', 'export-png-btn', 'export-fallback',
          'item-form', 'item-name', 'item-start', 'item-opening', 'item-submit', 'item-submit-label', 'cancel-edit', 'discard-item-draft', 'item-draft-note', 'item-list',
          'file', 'import-area', 'report-info', 'mapping-list', 'preview', 'preview-area', 'totals', 'replacement', 'confirm-import',
          'day-correction-summary', 'correction-draft-blocker', 'correction-draft-blocker-text', 'discard-day-drafts',
          'clear-sales-btn', 'clear-whole-day-btn', 'clear-confirm-panel', 'clear-confirm-title', 'clear-confirm-details',
          'confirm-clear-btn', 'cancel-clear-btn', 'restore-conflict-box', 'restore-conflict-text', 'recovery-list',
          'print-sheet',
        ];
        for (const id of allIds) {
          ids[id] = makeEl(id === 'stock' ? 'tbody' : id === 'print-sheet' ? 'section' : 'div', focusLog);
        }

        const _supabase = {
          from(table) {
            const q = {
              _filters: {},
              select() { return this; },
              eq(col, val) { this._filters[col] = val; return this; },
              order() { return this; },
              range: async () => ({
                data: (db[table] || []).filter(r => !q._filters.user_id || r.user_id === q._filters.user_id).map(r => ({ ...r })),
                error: null,
              }),
              maybeSingle: async () => ({ data: { restaurant_name: 'Restro Test' }, error: null }),
            };
            return q;
          },
          rpc: async (fn, params) => {
            rpcCalls.push({ userId, fn, params });
            if (fn === 'inventory_save_entry') {
              const idx = db.inventory_entries.findIndex(e => e.user_id === userId && e.item_id === params.p_item_id && e.day === params.p_day);
              const existing = idx >= 0 ? db.inventory_entries[idx] : null;
              const curExists = Boolean(existing);
              const curP = existing ? Number(existing.purchase) : 0;
              const curD = existing ? Number(existing.damage) : 0;
              if ((params.p_expected_exists !== null && curExists !== params.p_expected_exists)
                  || curP !== Number(params.p_expected_purchase || 0)
                  || curD !== Number(params.p_expected_damage || 0)) {
                return { data: { status: 'conflict', exists: curExists, purchase: curP, damage: curD }, error: null };
              }
              const payload = { user_id: userId, item_id: params.p_item_id, day: params.p_day, purchase: params.p_purchase, damage: params.p_damage };
              if (idx >= 0) db.inventory_entries[idx] = payload; else db.inventory_entries.push(payload);
              return { data: { status: 'saved', exists: true, purchase: params.p_purchase, damage: params.p_damage }, error: null };
            }
            if (fn === 'inventory_clear_day') {
              if (onBeforeClearRpc) await onBeforeClearRpc(params);
              if (params.p_request_id) {
                const dup = db.inventory_corrections.find(c => c.user_id === userId && c.client_request_id === params.p_request_id);
                if (dup) {
                  return { data: { status: 'duplicate_request', correction_id: dup.id, day: dup.day, scope: dup.scope }, error: null };
                }
              }
              const imp = db.inventory_imports.find(im => im.user_id === userId && im.day === params.p_day) || null;
              const curFp = imp ? imp.fingerprint : null;
              if (curFp !== (params.p_expected_fingerprint || null)) {
                return { data: { status: 'conflict', reason: 'Imported sales on the server changed.' }, error: null };
              }
              if (params.p_scope === 'sales_only') {
                if (!imp) return { data: { status: 'empty', reason: 'No imported sales exist for this date.' }, error: null };
                const corr = {
                  id: `corr-${++seq}`,
                  user_id: userId,
                  day: params.p_day,
                  scope: 'sales_only',
                  created_at: `2026-11-19T00:00:0${seq}Z`,
                  restored_at: null,
                  import_snapshot: { fingerprint: imp.fingerprint, sales: { ...imp.sales } },
                  entries_snapshot: [],
                  client_request_id: params.p_request_id,
                };
                db.inventory_corrections.unshift(corr);
                db.inventory_imports = db.inventory_imports.filter(im => !(im.user_id === userId && im.day === params.p_day));
                return { data: { status: 'cleared', correction_id: corr.id }, error: null };
              }
              const dayEntries = db.inventory_entries.filter(e => e.user_id === userId && e.day === params.p_day)
                .slice().sort((a, b) => a.item_id.localeCompare(b.item_id));
              const exp = (params.p_expected_entries || []).slice().sort((a, b) => a.item_id.localeCompare(b.item_id));
              const sameEntries = dayEntries.length === exp.length && dayEntries.every((e, i) =>
                e.item_id === exp[i].item_id && Number(e.purchase) === Number(exp[i].purchase) && Number(e.damage) === Number(exp[i].damage)
              );
              if (!sameEntries) {
                return { data: { status: 'conflict', reason: 'Stock movements on the server changed.' }, error: null };
              }
              if (!imp && !dayEntries.length) {
                return { data: { status: 'empty', reason: 'Nothing to clear.' }, error: null };
              }
              const corr = {
                id: `corr-${++seq}`,
                user_id: userId,
                day: params.p_day,
                scope: 'whole_day',
                created_at: `2026-11-19T00:00:0${seq}Z`,
                restored_at: null,
                import_snapshot: imp ? { fingerprint: imp.fingerprint, sales: { ...imp.sales } } : null,
                entries_snapshot: dayEntries.map(e => ({ item_id: e.item_id, purchase: e.purchase, damage: e.damage })),
                client_request_id: params.p_request_id,
              };
              db.inventory_corrections.unshift(corr);
              db.inventory_imports = db.inventory_imports.filter(im => !(im.user_id === userId && im.day === params.p_day));
              db.inventory_entries = db.inventory_entries.filter(e => !(e.user_id === userId && e.day === params.p_day));
              return { data: { status: 'cleared', correction_id: corr.id }, error: null };
            }
            if (fn === 'inventory_restore_correction') {
              if (onBeforeRestoreRpc) await onBeforeRestoreRpc(params);
              const corr = db.inventory_corrections.find(c => c.id === params.p_correction_id && c.user_id === userId);
              if (!corr) return { data: null, error: new Error('Recovery snapshot not found') };
              if (corr.restored_at) return { data: { status: 'already_restored', correction_id: corr.id }, error: null };
              if (corr.import_snapshot && db.inventory_imports.some(im => im.user_id === userId && im.day === corr.day)) {
                return { data: { status: 'conflict', reason: 'Imported sales already exist for this date.' }, error: null };
              }
              const entryConflicts = (corr.entries_snapshot || []).filter(snap =>
                db.inventory_entries.some(e => e.user_id === userId && e.item_id === snap.item_id && e.day === corr.day)
              );
              if (entryConflicts.length) {
                return { data: { status: 'conflict', reason: `Cannot restore: ${entryConflicts.length} stock movement slot(s) already occupied.` }, error: null };
              }
              // Atomic restore: both import and entries together
              if (corr.import_snapshot) {
                db.inventory_imports.push({
                  user_id: userId,
                  day: corr.day,
                  fingerprint: corr.import_snapshot.fingerprint,
                  sales: { ...corr.import_snapshot.sales },
                });
              }
              for (const snap of (corr.entries_snapshot || [])) {
                db.inventory_entries.push({ user_id: userId, item_id: snap.item_id, day: corr.day, purchase: snap.purchase, damage: snap.damage });
              }
              corr.restored_at = `2026-11-19T01:00:0${++seq}Z`;
              return { data: { status: 'restored', correction_id: corr.id }, error: null };
            }
            return { data: 'saved', error: null };
          },
        };

        const document = {
          title: '',
          getElementById: id => ids[id],
          createElement: tag => makeEl(tag, focusLog),
          createElementNS: (_ns, tag) => makeEl(tag, focusLog),
          createTextNode: t => ({ textContent: String(t), children: [] }),
          querySelectorAll: () => [],
        };
        const windowObj = {
          localStorage,
          print: () => { printCalls++; },
          addEventListener: (ev, fn) => { windowListeners[ev] = fn; },
        };
        const sandbox = {
          InventoryLogic: L,
          _supabase,
          checkAuth: async () => ({ user: { id: userId } }),
          document,
          window: windowObj,
          localStorage,
          navigator: {},
          URL: { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} },
          confirm: () => confirmQueue.length ? confirmQueue.shift() : true,
          crypto: crypto.webcrypto,
          TextEncoder, Uint8Array, JSON, Number, String, Array, Object, Set, Map, Date, Error, Promise,
        };
        vm.runInNewContext(fs.readFileSync('./js/inventory.js', 'utf8'), sandbox);
        return { ids, windowListeners, _supabase };
      }

      async function run() {
        let app = bootApp('user-A');
        await new Promise(r => setTimeout(r, 20));

        // Select 2026-11-18
        app.ids['day'].value = '2026-11-18';
        app.ids['day'].onchange();

        // Check Captain's beforeprint safety listener still renders #print-sheet when triggered directly
        app.windowListeners.beforeprint();
        assert.equal(app.ids['print-sheet'].children.length > 0, true);
        app.windowListeners.afterprint();

        // 1) Empty-day no-op on 2026-11-17
        app.ids['day'].value = '2026-11-17';
        app.ids['day'].onchange();
        const rpcBeforeEmpty = rpcCalls.length;
        app.ids['clear-sales-btn'].onclick();
        assert.equal(app.ids['clear-confirm-panel'].hidden, true);
        assert.match(app.ids['message'].textContent, /No imported sales/i);
        app.ids['clear-whole-day-btn'].onclick();
        assert.equal(app.ids['clear-confirm-panel'].hidden, true);
        assert.match(app.ids['message'].textContent, /nothing to clear/i);
        assert.equal(rpcCalls.length, rpcBeforeEmpty);

        // Save a local draft on 2026-11-17 (another date) -> must NOT block 2026-11-18 and must stay untouched!
        const p17 = app.ids['stock'].children[0].children[2].children[0];
        p17.value = '4';
        p17.oninput();
        assert.equal(L.dayDraftCount(L.loadDraftState(localStorage, 'user-A').state, '2026-11-17'), 1);

        // 2) Switch to 2026-11-18 and draft Fish -> BOTH clear actions blocked cleanly
        app.ids['day'].value = '2026-11-18';
        app.ids['day'].onchange();
        const p18 = app.ids['stock'].children[0].children[2].children[0];
        p18.value = '9';
        p18.oninput();
        assert.equal(app.ids['correction-draft-blocker'].hidden, false);

        app.ids['clear-sales-btn'].onclick();
        assert.equal(app.ids['message'].className, 'error');
        assert.match(app.ids['message'].textContent, /unsaved local stock draft/i);
        assert.equal(app.ids['clear-confirm-panel'].hidden, true);
        // Draft on 2026-11-18 is NEVER silently deleted!
        assert.equal(L.dayDraftCount(L.loadDraftState(localStorage, 'user-A').state, '2026-11-18'), 1);

        // Discard 2026-11-18 draft explicitly (keeping 2026-11-17 draft!)
        confirmQueue.push(true);
        app.ids['discard-day-drafts'].onclick();
        assert.equal(app.ids['correction-draft-blocker'].hidden, true);
        assert.equal(L.dayDraftCount(L.loadDraftState(localStorage, 'user-A').state, '2026-11-18'), 0);
        assert.equal(L.dayDraftCount(L.loadDraftState(localStorage, 'user-A').state, '2026-11-17'), 1);

        // 3) Remove imported sales only on 2026-11-18 -> review confirmation -> confirm
        app.ids['clear-sales-btn'].onclick();
        assert.equal(app.ids['clear-confirm-panel'].hidden, false);
        const confirmText = JSON.stringify(app.ids['clear-confirm-details']);
        assert.match(confirmText, /2026-11-18/);
        assert.match(confirmText, /2 items, 6 pieces/);
        assert.match(confirmText, /2 purchase\/damage rows on 2026-11-18/);
        assert.match(confirmText, /recalculate.*2026-11-19/i);

        // Cancel leaves sales intact
        app.ids['cancel-clear-btn'].onclick();
        assert.equal(app.ids['clear-confirm-panel'].hidden, true);
        assert.equal(db.inventory_imports.some(im => im.day === '2026-11-18'), true);

        // Confirm sales_only clear (and check idempotent retry if repeated with same request id)
        app.ids['clear-sales-btn'].onclick();
        await app.ids['confirm-clear-btn'].onclick();
        assert.equal(db.inventory_imports.some(im => im.day === '2026-11-18'), false);
        assert.equal(db.inventory_entries.filter(e => e.day === '2026-11-18').length, 2); // movements untouched!
        assert.equal(db.inventory_imports.some(im => im.day === '2026-11-19'), true); // 2026-11-19 untouched!
        assert.equal(db.inventory_mappings.length, 1); // mappings untouched!
        assert.equal(db.inventory_items[0].initial_opening, 20); // openings untouched!
        assert.equal(db.inventory_corrections.length, 1);
        assert.equal(db.inventory_corrections[0].scope, 'sales_only');

        // Verify 2026-11-19 opening automatically increased by 4 (removed sale of 4 on 2026-11-18)!
        // Previously on 2026-11-18 Fish: 20 + 5 - 4 - 1 = 20; now 20 + 5 - 0 - 1 = 24 (+ draft on 17th: +4 purchase -> 24 in DB!)
        app.ids['day'].value = '2026-11-19';
        app.ids['day'].onchange();
        assert.equal(app.ids['stock'].children[0].children[1].textContent, '24');

        // Verify duplicate request_id on server RPC returns duplicate_request cleanly without adding a second snapshot
        const dupRes = rpcCalls.find(c => c.fn === 'inventory_clear_day');
        const reqId = dupRes.params.p_request_id;
        assert.ok(reqId);
        const retryClear = await app._supabase.rpc('inventory_clear_day', dupRes.params);
        assert.equal(retryClear.data.status, 'duplicate_request');
        assert.equal(db.inventory_corrections.length, 1);

        // 4) Simulate page reload -> recovery list persists & sales_only undo restores 2026-11-18 sales!
        app = bootApp('user-A');
        await new Promise(r => setTimeout(r, 20));
        assert.equal(app.ids['recovery-list'].children.length, 1);
        const undoSalesBtn = app.ids['recovery-list'].children[0].children[1];
        await undoSalesBtn.onclick();
        assert.equal(db.inventory_imports.some(im => im.day === '2026-11-18'), true);
        assert.ok(db.inventory_corrections[0].restored_at);
        // 2026-11-19 opening recalculated back to 20!
        app.ids['day'].value = '2026-11-19';
        app.ids['day'].onchange();
        assert.equal(app.ids['stock'].children[0].children[1].textContent, '20');

        // 5) Whole day clear on 2026-11-18
        app.ids['day'].value = '2026-11-18';
        app.ids['day'].onchange();
        app.ids['clear-whole-day-btn'].onclick();
        assert.equal(app.ids['clear-confirm-panel'].hidden, false);
        assert.match(JSON.stringify(app.ids['clear-confirm-details']), /2 stock movement rows/);
        await app.ids['confirm-clear-btn'].onclick();

        assert.equal(db.inventory_imports.some(im => im.day === '2026-11-18'), false);
        assert.equal(db.inventory_entries.some(e => e.day === '2026-11-18'), false);
        assert.equal(db.inventory_entries.some(e => e.day === '2026-11-19'), true);
        assert.equal(db.inventory_items[0].initial_opening, 20);
        assert.equal(db.inventory_corrections.length, 2);
        // Earlier snapshot stays preserved (no auto-expiry/purge)
        assert.equal(app.ids['recovery-list'].children.length, 2);

        // 6) Restore blocked by local draft on 2026-11-18 (even when currently viewing 2026-11-19!)
        app.ids['day'].value = '2026-11-18';
        app.ids['day'].onchange();
        app.ids['stock'].children[0].children[2].children[0].value = '8';
        app.ids['stock'].children[0].children[2].children[0].oninput();
        app.ids['day'].value = '2026-11-19';
        app.ids['day'].onchange();
        const wholeUndoBtn = app.ids['recovery-list'].children[0].children[1];
        await wholeUndoBtn.onclick();
        assert.equal(app.ids['restore-conflict-box'].hidden, false);
        assert.match(app.ids['message'].textContent, /unsaved local stock draft/i);
        assert.equal(db.inventory_corrections[0].restored_at, null);
        // Draft on 2026-11-18 NOT silently deleted!
        assert.equal(L.dayDraftCount(L.loadDraftState(localStorage, 'user-A').state, '2026-11-18'), 1);

        // Discard 2026-11-18 draft via conflict box discard button (keeping 2026-11-17 draft!)
        confirmQueue.push(true);
        const conflictDiscardBtn = app.ids['restore-conflict-text'].children[2];
        conflictDiscardBtn.onclick();
        assert.equal(L.dayDraftCount(L.loadDraftState(localStorage, 'user-A').state, '2026-11-18'), 0);
        assert.equal(L.dayDraftCount(L.loadDraftState(localStorage, 'user-A').state, '2026-11-17'), 1);

        // 7) Server conflict during restore (simulated concurrent save on i2 on 2026-11-18) -> all-or-nothing stop!
        onBeforeRestoreRpc = async () => {
          db.inventory_entries.push({ user_id: 'user-A', item_id: 'i2', day: '2026-11-18', purchase: 99, damage: 0 });
        };
        await app.ids['recovery-list'].children[0].children[1].onclick();
        onBeforeRestoreRpc = null;
        assert.equal(app.ids['restore-conflict-box'].hidden, false);
        assert.match(app.ids['message'].textContent, /slot\(s\) already occupied/i);
        // Neither import nor i1 entry was partially written; snapshot stays un-restored!
        assert.equal(db.inventory_imports.some(im => im.day === '2026-11-18'), false);
        assert.equal(db.inventory_entries.some(e => e.item_id === 'i1' && e.day === '2026-11-18'), false);
        assert.equal(db.inventory_entries.find(e => e.item_id === 'i2' && e.day === '2026-11-18').purchase, 99);
        assert.equal(db.inventory_corrections[0].restored_at, null);

        // Remove conflicting i2 entry and retry Undo / Restore -> succeeds cleanly!
        db.inventory_entries = db.inventory_entries.filter(e => !(e.item_id === 'i2' && e.day === '2026-11-18'));
        await app.ids['recovery-list'].children[0].children[1].onclick();
        assert.equal(db.inventory_imports.some(im => im.day === '2026-11-18'), true);
        assert.equal(db.inventory_entries.filter(e => e.day === '2026-11-18').length, 2);
        assert.ok(db.inventory_corrections[0].restored_at);
        // Draft on 2026-11-17 stayed untouched throughout and no stale draft on 2026-11-18 reappeared!
        assert.equal(L.dayDraftCount(L.loadDraftState(localStorage, 'user-A').state, '2026-11-17'), 1);
        assert.equal(L.dayDraftCount(L.loadDraftState(localStorage, 'user-A').state, '2026-11-18'), 0);

        // 8) Server CAS conflict if another tab changed data BEFORE confirm-clear-btn is clicked
        app.ids['day'].value = '2026-11-19';
        app.ids['day'].onchange();
        app.ids['clear-whole-day-btn'].onclick();
        onBeforeClearRpc = async () => {
          db.inventory_entries.find(e => e.day === '2026-11-19' && e.item_id === 'i1').purchase = 77;
        };
        await app.ids['confirm-clear-btn'].onclick();
        onBeforeClearRpc = null;
        assert.equal(app.ids['message'].className, 'error');
        assert.match(app.ids['message'].textContent, /changed/i);
        // Newer server value 77 was NOT overwritten or cleared!
        assert.equal(db.inventory_entries.find(e => e.day === '2026-11-19' && e.item_id === 'i1').purchase, 77);

        // 9) Movement save via inventory_save_entry catches CAS conflict when day was cleared in another tab!
        app.ids['day'].value = '2026-11-18';
        app.ids['day'].onchange();
        const fishRow = app.ids['stock'].children[0];
        fishRow.children[2].children[0].value = '14';
        fishRow.children[2].children[0].oninput();
        // Another tab deletes 2026-11-18 behind our back:
        db.inventory_entries = db.inventory_entries.filter(e => e.day !== '2026-11-18');
        confirmQueue.push(false);
        await fishRow.children[6].children[0].children[0].onclick();
        assert.equal(db.inventory_entries.some(e => e.day === '2026-11-18'), false); // declined overwrite
        assert.match(app.ids['stock'].children[0].className, /row-stale/);

        // Confirm overwrite -> saves cleanly!
        confirmQueue.push(true);
        await app.ids['stock'].children[0].children[6].children[0].children[0].onclick();
        assert.equal(db.inventory_entries.find(e => e.day === '2026-11-18' && e.item_id === 'i1').purchase, 14);

        // 10) User isolation: user-B sees zero snapshots from user-A and cannot restore user-A's snapshot!
        const appB = bootApp('user-B');
        await new Promise(r => setTimeout(r, 20));
        assert.match(appB.ids['recovery-list'].children[0].textContent, /No day corrections/i);
        const crossUserRestore = await appB._supabase.rpc('inventory_restore_correction', { p_correction_id: db.inventory_corrections[0].id });
        assert.match(crossUserRestore.error.message, /not found/i);
      }

      run().catch(e => { console.error(e); process.exit(1); });
    """)


def test_safe_clear_sql_migration_and_docs_structure():
    schema_sql = (ROOT / 'inventory-schema.sql').read_text(encoding='utf-8').lower()
    mig_sql = (ROOT / 'inventory-safe-clear.sql').read_text(encoding='utf-8').lower()
    setup_md = (ROOT / 'inventory-setup.md').read_text(encoding='utf-8').lower()

    # Migration is strictly additive (does not touch accounting/profiles/items deletion)
    assert 'create table if not exists public.inventory_corrections' in mig_sql
    assert 'drop table' not in mig_sql
    assert 'delete from public.inventory_items' not in mig_sql
    assert 'alter table public.inventory_items' not in mig_sql

    # Owner-scoped SELECT-only RLS and zero auto-expiry/purging
    assert 'enable row level security' in mig_sql
    assert 'create policy inventory_corrections_read on public.inventory_corrections' in mig_sql
    assert 'for select to authenticated using (user_id = auth.uid())' in mig_sql
    assert 'revoke all on table public.inventory_corrections from anon, public' in mig_sql
    assert 'grant select on table public.inventory_corrections to authenticated' in mig_sql
    assert re.search(r'create\s+policy\b[^;]+\bfor\s+(insert|update|delete|all)\b', mig_sql) is None
    assert 'delete from public.inventory_corrections' not in mig_sql
    for forbidden in ('ttl', 'expires_at'):
        assert forbidden not in mig_sql

    # Direct client writes on inventory_entries replaced with read-only RLS + locked RPC
    assert 'drop policy if exists inventory_entries_owner on public.inventory_entries' in mig_sql
    assert 'create policy inventory_entries_read on public.inventory_entries' in mig_sql

    # All three RPCs are SECURITY DEFINER, hardened search_path, auth.uid() checked, and tightly granted
    for fn_sig in (
        'public.inventory_save_entry(uuid, date, numeric, numeric, boolean, numeric, numeric)',
        'public.inventory_clear_day(date, text, text, jsonb, text)',
        'public.inventory_restore_correction(uuid)',
    ):
        assert f'revoke all on function {fn_sig} from anon, public;' in mig_sql
        assert f'grant execute on function {fn_sig} to authenticated;' in mig_sql

    assert mig_sql.count('security definer') == 3
    assert mig_sql.count('set search_path = public, pg_temp') == 3
    assert mig_sql.count('auth.uid()') >= 5

    # Exact same advisory lock key expression across schema import RPC and all three new RPCs
    import_lock = re.findall(r"pg_advisory_xact_lock\(hashtextextended\([^)]+\)\)", schema_sql)
    mig_locks = re.findall(r"pg_advisory_xact_lock\(hashtextextended\([^)]+\)\)", mig_sql)
    assert len(import_lock) == 1
    assert len(mig_locks) == 3
    assert "uid::text || ':' || p_day::text, 0" in import_lock[0]
    assert mig_locks[0] == import_lock[0]
    assert mig_locks[1] == import_lock[0]
    assert "uid::text || ':' || v_day::text, 0" in mig_locks[2]

    # Setup docs clearly document migration order, concurrency, and that item deletion/archiving is unimplemented
    assert 'inventory-schema.sql' in setup_md
    assert 'inventory-safe-clear.sql' in setup_md
    assert 'pg_advisory_xact_lock' in setup_md
    assert 'not' in setup_md and 'deletion' in setup_md
