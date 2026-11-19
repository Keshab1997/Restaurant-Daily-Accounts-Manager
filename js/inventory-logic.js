/* Pure inventory and POS report logic, also usable from Node tests. */
(function (root, factory) {
    const api = factory();
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.InventoryLogic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
    'use strict';
    const PIECE_SUFFIX_RE = /[\[(]\s*\d+\s*pieces?\s*[\])]/gi;
    const text = value => String(value == null ? '' : value).trim().replace(/\s+/g, ' ');
    function normalizeName(value) {
        return text(value)
            .normalize('NFKD')
            .replace(/[\u0300-\u036f]/g, '')
            .toLowerCase()
            .replace(/[^\p{L}\p{N}]+/gu, ' ')
            .trim();
    }
    function tokenizeName(value) {
        const normalized = normalizeName(value);
        return normalized ? normalized.split(' ') : [];
    }
    function dishNameForMatching(value) {
        const raw = text(value);
        const stripped = text(raw.replace(PIECE_SUFFIX_RE, ' '));
        return stripped || raw;
    }
    function containsWordSequence(haystack, needle) {
        if (!needle.length || needle.length > haystack.length) return false;
        for (let i = 0; i <= haystack.length - needle.length; i++) {
            let match = true;
            for (let j = 0; j < needle.length; j++) {
                if (haystack[i + j] !== needle[j]) { match = false; break; }
            }
            if (match) return true;
        }
        return false;
    }
    function savedChoiceMap(savedMappings) {
        if (!savedMappings) return {};
        if (Array.isArray(savedMappings)) {
            return Object.fromEntries(savedMappings.map(m => [m.dish_key, m.ignored ? 'ignore' : m.item_id]));
        }
        return savedMappings;
    }
    function matchDish(dish, items, savedMappings) {
        const list = Array.isArray(items) ? items : [];
        const savedMap = savedChoiceMap(savedMappings);
        const key = dish && dish.key;
        const saved = key ? savedMap[key] : undefined;
        const byId = new Map(list.map(item => [item.id, item]));
        if (saved === 'ignore') {
            return {
                status: 'ignored',
                selected: 'ignore',
                suggestion: null,
                candidates: [],
                reason: 'Saved mapping: Ignore this dish',
            };
        }
        if (saved && byId.has(saved)) {
            const item = byId.get(saved);
            return {
                status: 'saved',
                selected: saved,
                suggestion: null,
                candidates: [],
                reason: `Saved mapping: ${item.name}`,
            };
        }
        const rawName = dish && typeof dish === 'object' ? dish.item : dish;
        const rawDishNorm = normalizeName(rawName);
        const cleanDishText = dishNameForMatching(rawName);
        const cleanDishNorm = normalizeName(cleanDishText);
        const dishTokens = tokenizeName(cleanDishText);

        const rawExact = [], cleanExact = [], wholeWord = [];
        for (const item of list) {
            const itemNorm = normalizeName(item.name);
            const itemTokens = tokenizeName(item.name);
            if (!itemNorm || !itemTokens.length) continue;
            if (itemNorm === rawDishNorm) rawExact.push(item);
            else if (itemNorm === cleanDishNorm) cleanExact.push(item);
            else if (containsWordSequence(dishTokens, itemTokens)) wholeWord.push(item);
        }
        if (rawExact.length === 1) {
            const item = rawExact[0];
            return {
                status: 'suggested',
                selected: '',
                suggestion: item,
                candidates: [item],
                reason: `Exact name match for "${item.name}"`,
            };
        }
        if (rawExact.length > 1) {
            return {
                status: 'ambiguous',
                selected: '',
                suggestion: null,
                candidates: rawExact,
                reason: `Ambiguous exact match (${rawExact.map(i => i.name).join(', ')}); choose manually`,
            };
        }
        if (cleanExact.length === 1) {
            const item = cleanExact[0];
            return {
                status: 'suggested',
                selected: '',
                suggestion: item,
                candidates: [item],
                reason: `Exact name match for "${item.name}" (ignoring piece count)`,
            };
        }
        if (cleanExact.length > 1) {
            return {
                status: 'ambiguous',
                selected: '',
                suggestion: null,
                candidates: cleanExact,
                reason: `Ambiguous exact match (${cleanExact.map(i => i.name).join(', ')}); choose manually`,
            };
        }
        if (wholeWord.length === 1) {
            const item = wholeWord[0];
            return {
                status: 'suggested',
                selected: '',
                suggestion: item,
                candidates: [item],
                reason: `Whole-word match for "${item.name}"`,
            };
        }
        if (wholeWord.length > 1) {
            return {
                status: 'ambiguous',
                selected: '',
                suggestion: null,
                candidates: wholeWord,
                reason: `Ambiguous match (${wholeWord.map(i => i.name).join(', ')}); choose manually`,
            };
        }
        return {
            status: 'none',
            selected: '',
            suggestion: null,
            candidates: [],
            reason: 'No automatic name match; choose an item or Ignore',
        };
    }
    function suggestMappings(report, items, savedMappings) {
        const savedMap = savedChoiceMap(savedMappings);
        const result = {};
        for (const dish of (report && report.dishes) || []) {
            result[dish.key] = matchDish(dish, items, savedMap);
        }
        return result;
    }
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
    return {
        normalizeName,
        tokenizeName,
        dishNameForMatching,
        containsWordSequence,
        savedChoiceMap,
        matchDish,
        suggestMappings,
        number,
        pieces,
        parseReport,
        preview,
        stock,
        importDecision,
    };
});
