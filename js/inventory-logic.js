/* Pure inventory and POS report logic, also usable from Node tests. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.InventoryLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const text = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
    function number(value, label) {
        const s = text(value).replace(/,/g, '');
        if (!s || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(s)) throw new Error(`${label} must be a non-negative number`);
        const n = Number(s);
        if (!Number.isFinite(n) || n > 1000000000) throw new Error(`${label} is out of range`);
        return n;
    }
    function pieces(name) {
        const matches = [...text(name).matchAll(/[\[(]\s*(\d+)\s*pieces?\s*[\])]/gi)];
        if (matches.length > 1 || (matches.length && Number(matches[0][1]) < 1)) throw new Error(`Ambiguous piece count: ${name}`);
        return matches.length ? Number(matches[0][1]) : 1;
    }
    function validDate(y, m, d) {
        const date = new Date(Date.UTC(y, m - 1, d));
        if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) throw new Error('Invalid report date');
        return `${y.toString().padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    }
    function parseReport(rows) {
        if (!Array.isArray(rows)) throw new Error('Invalid spreadsheet');
        let header = -1, cols;
        for (let i = 0; i < rows.length; i++) {
            const cells = (rows[i] || []).map(c => text(c).toLowerCase().replace(/[^a-z]/g, ''));
            const c = ['category', 'item', 'code', 'qty', 'total'].map(x => cells.indexOf(x));
            if (c.every(x => x >= 0)) { header = i; cols = c; break; }
        }
        if (header < 0) throw new Error('Could not find Category / Item / Code / Qty / Total header');
        const dates = new Set();
        for (const row of rows.slice(0, header)) for (const cell of row || []) {
            const s = text(cell);
            for (const m of s.matchAll(/\b(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})\b|\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})\b/g)) {
                dates.add(m[1] ? validDate(+m[1], +m[2], +m[3]) : validDate(+m[6], +m[5], +m[4]));
            }
        }
        if (dates.size !== 1) throw new Error('Report must contain one unambiguous date before the header (DD/MM/YYYY or YYYY-MM-DD)');
        let category = '', dishes = new Map();
        const isTotal = s => /^(?:grand\s+total|sub\s*total|total)(?:\b|\s*[:\-])/i.test(s) || /\b(?:sub\s*total|grand\s+total)$/i.test(s);
        for (const row of rows.slice(header + 1)) {
            const [cat, item, code, qty] = cols.map(i => text((row || [])[i]));
            if (cat && !isTotal(cat)) category = cat;
            if (!item || isTotal(item) || isTotal(cat)) continue;
            const quantity = number(qty, `Qty for ${item}`), count = pieces(item);
            const key = JSON.stringify([category, item, code]);
            const prior = dishes.get(key);
            if (prior) { prior.qty += quantity; prior.pieces += quantity * count; }
            else dishes.set(key, { key, category, item, code, qty: quantity, pieces: quantity * count });
        }
        if (!dishes.size) throw new Error('No item rows found in report');
        return { date: [...dates][0], dishes: [...dishes.values()] };
    }
    function preview(report, mappings) {
        const totals = {}, unresolved = [];
        for (const dish of report.dishes) {
            const choice = mappings[dish.key];
            if (!choice) unresolved.push(dish);
            else if (choice !== 'ignore') totals[choice] = (totals[choice] || 0) + dish.pieces;
        }
        return { totals, unresolved };
    }
    function stock(item, day, entries, imports) {
        if (day < item.start_date) return null;
        let opening = Number(item.initial_opening), purchase = 0, damage = 0, sale = 0;
        for (const row of entries) {
            if (row.item_id !== item.id || row.day < item.start_date || row.day > day) continue;
            const p = Number(row.purchase), d = Number(row.damage);
            if (row.day === day) { purchase += p; damage += d; }
            else opening += p - d;
        }
        for (const row of imports) {
            if (row.day < item.start_date || row.day > day) continue;
            const s = Number((row.sales || {})[item.id] || 0);
            if (row.day === day) sale += s; else opening -= s;
        }
        return { opening, purchase, sale, damage, closing: opening + purchase - sale - damage };
    }
    function importDecision(existingHash, newHash, replace) {
        if (existingHash === newHash) return 'duplicate';
        if (existingHash && !replace) return 'replace-required';
        return 'save';
    }
    return { number, pieces, parseReport, preview, stock, importDecision };
});
