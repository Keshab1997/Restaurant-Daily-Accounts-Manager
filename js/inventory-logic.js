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
    const DRAFT_KEY_PREFIX = 'inventory_drafts_v1:';
    const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
    function draftStorageKey(userId) {
        const id = text(userId);
        if (!id) throw new Error('Authenticated user ID is required for draft storage');
        return `${DRAFT_KEY_PREFIX}${id}`;
    }
    function emptyDraftState() {
        return { selectedDay: '', itemForm: null, entries: {} };
    }
    function sanitizeDraftState(raw) {
        const clean = emptyDraftState();
        if (!raw || typeof raw !== 'object') return clean;
        if (typeof raw.selectedDay === 'string' && DATE_RE.test(raw.selectedDay)) {
            clean.selectedDay = raw.selectedDay;
        }
        if (raw.itemForm && typeof raw.itemForm === 'object' && raw.itemForm.dirty) {
            const f = raw.itemForm;
            clean.itemForm = {
                editingId: f.editingId != null && f.editingId !== '' ? String(f.editingId) : null,
                name: f.name != null ? String(f.name) : '',
                startDate: typeof f.startDate === 'string' && DATE_RE.test(f.startDate) ? f.startDate : '',
                opening: f.opening != null ? String(f.opening) : '',
                baseName: f.baseName != null ? String(f.baseName) : null,
                baseOpening: f.baseOpening != null && Number.isFinite(Number(f.baseOpening)) ? Number(f.baseOpening) : null,
                baseStartDate: typeof f.baseStartDate === 'string' && DATE_RE.test(f.baseStartDate) ? f.baseStartDate : null,
                revision: Number.isInteger(Number(f.revision)) && Number(f.revision) > 0 ? Number(f.revision) : 1,
                dirty: true,
            };
        }
        if (raw.entries && typeof raw.entries === 'object' && !Array.isArray(raw.entries)) {
            for (const [day, byItem] of Object.entries(raw.entries)) {
                if (!DATE_RE.test(day) || !byItem || typeof byItem !== 'object' || Array.isArray(byItem)) continue;
                const cleanDay = {};
                for (const [itemId, d] of Object.entries(byItem)) {
                    if (!itemId || !d || typeof d !== 'object') continue;
                    cleanDay[String(itemId)] = {
                        purchase: d.purchase != null ? String(d.purchase) : '',
                        damage: d.damage != null ? String(d.damage) : '',
                        basePurchase: Number.isFinite(Number(d.basePurchase)) ? Number(d.basePurchase) : 0,
                        baseDamage: Number.isFinite(Number(d.baseDamage)) ? Number(d.baseDamage) : 0,
                        baseExists: typeof d.baseExists === 'boolean' ? d.baseExists : null,
                        revision: Number.isInteger(Number(d.revision)) && Number(d.revision) > 0 ? Number(d.revision) : 1,
                        updatedAt: typeof d.updatedAt === 'string' ? d.updatedAt : '',
                    };
                }
                if (Object.keys(cleanDay).length) clean.entries[day] = cleanDay;
            }
        }
        return clean;
    }
    function loadDraftState(storage, userId) {
        try {
            const key = draftStorageKey(userId);
            if (!storage || typeof storage.getItem !== 'function') {
                return { state: emptyDraftState(), restored: false, error: 'Browser draft storage is unavailable' };
            }
            const raw = storage.getItem(key);
            if (!raw) return { state: emptyDraftState(), restored: false, error: null };
            let parsed;
            try {
                parsed = JSON.parse(raw);
            } catch (_) {
                return { state: emptyDraftState(), restored: false, error: 'Saved browser draft data was corrupted and could not be restored' };
            }
            const state = sanitizeDraftState(parsed);
            const restored = Boolean(state.selectedDay || state.itemForm || Object.keys(state.entries).length);
            return { state, restored, error: null };
        } catch (err) {
            return { state: emptyDraftState(), restored: false, error: err && err.message ? err.message : 'Could not read browser draft storage' };
        }
    }
    function saveDraftState(storage, userId, state) {
        const clean = sanitizeDraftState(state);
        try {
            const key = draftStorageKey(userId);
            if (!storage || typeof storage.setItem !== 'function' || typeof storage.removeItem !== 'function') {
                return { ok: false, state: clean, error: 'Browser draft storage is unavailable' };
            }
            const hasData = Boolean(clean.selectedDay || clean.itemForm || Object.keys(clean.entries).length);
            if (!hasData) storage.removeItem(key);
            else storage.setItem(key, JSON.stringify(clean));
            return { ok: true, state: clean, error: null };
        } catch (err) {
            return { ok: false, state: clean, error: err && err.message ? err.message : 'Could not save draft to browser storage' };
        }
    }
    function setEntryDraft(state, day, itemId, draft) {
        const clean = sanitizeDraftState(state);
        if (!DATE_RE.test(String(day || '')) || !itemId) return clean;
        const id = String(itemId);
        const nextDay = { ...(clean.entries[day] || {}) };
        const prev = nextDay[id];
        const prevRev = prev ? prev.revision : 0;
        const requested = Number.isInteger(Number(draft.revision)) ? Number(draft.revision) : 0;
        const baseExists = typeof draft.baseExists === 'boolean'
            ? draft.baseExists
            : (prev && typeof prev.baseExists === 'boolean' ? prev.baseExists : null);
        nextDay[id] = {
            purchase: draft.purchase != null ? String(draft.purchase) : '',
            damage: draft.damage != null ? String(draft.damage) : '',
            basePurchase: Number.isFinite(Number(draft.basePurchase)) ? Number(draft.basePurchase) : 0,
            baseDamage: Number.isFinite(Number(draft.baseDamage)) ? Number(draft.baseDamage) : 0,
            baseExists,
            revision: Math.max(prevRev + 1, requested, 1),
            updatedAt: typeof draft.updatedAt === 'string' ? draft.updatedAt : '',
        };
        clean.entries[day] = nextDay;
        return clean;
    }
    function clearEntryDraft(state, day, itemId) {
        const clean = sanitizeDraftState(state);
        if (!clean.entries[day]) return clean;
        const nextDay = { ...clean.entries[day] };
        delete nextDay[String(itemId)];
        if (Object.keys(nextDay).length) clean.entries[day] = nextDay;
        else delete clean.entries[day];
        return clean;
    }
    function clearEntryDraftIfRevision(state, day, itemId, expectedRevision) {
        const clean = sanitizeDraftState(state);
        const existing = clean.entries[day] && clean.entries[day][String(itemId)];
        if (!existing || existing.revision !== expectedRevision) return clean;
        return clearEntryDraft(clean, day, itemId);
    }
    function rebaseEntryDraft(state, day, itemId, newBasePurchase, newBaseDamage, newBaseExists) {
        const clean = sanitizeDraftState(state);
        const id = String(itemId || '');
        const existing = clean.entries[day] && clean.entries[day][id];
        if (!existing) return clean;
        clean.entries[day] = {
            ...clean.entries[day],
            [id]: {
                ...existing,
                basePurchase: Number.isFinite(Number(newBasePurchase)) ? Number(newBasePurchase) : existing.basePurchase,
                baseDamage: Number.isFinite(Number(newBaseDamage)) ? Number(newBaseDamage) : existing.baseDamage,
                baseExists: typeof newBaseExists === 'boolean' ? newBaseExists : existing.baseExists,
            },
        };
        return clean;
    }
    function hasEntryServerConflict(basePurchase, baseDamage, serverPurchase, serverDamage, baseExists = null, serverExists = null) {
        if (baseExists !== null && serverExists !== null && Boolean(baseExists) !== Boolean(serverExists)) {
            return true;
        }
        return Number(basePurchase) !== Number(serverPurchase) || Number(baseDamage) !== Number(serverDamage);
    }
    function setItemFormDraft(state, formDraft) {
        const clean = sanitizeDraftState(state);
        if (!formDraft) { clean.itemForm = null; return clean; }
        const prevRev = clean.itemForm ? clean.itemForm.revision : 0;
        const requested = Number.isInteger(Number(formDraft.revision)) ? Number(formDraft.revision) : 0;
        clean.itemForm = sanitizeDraftState({
            itemForm: {
                ...formDraft,
                revision: Math.max(prevRev + 1, requested, 1),
                dirty: true,
            },
        }).itemForm;
        return clean;
    }
    function clearItemFormDraft(state) {
        const clean = sanitizeDraftState(state);
        clean.itemForm = null;
        return clean;
    }
    function clearItemFormDraftIfRevision(state, expectedRevision) {
        const clean = sanitizeDraftState(state);
        if (!clean.itemForm || clean.itemForm.revision !== expectedRevision) return clean;
        clean.itemForm = null;
        return clean;
    }
    function rebaseItemFormDraft(state, newBaseName, newBaseOpening) {
        const clean = sanitizeDraftState(state);
        if (!clean.itemForm) return clean;
        clean.itemForm = {
            ...clean.itemForm,
            baseName: newBaseName != null ? String(newBaseName) : clean.itemForm.baseName,
            baseOpening: Number.isFinite(Number(newBaseOpening)) ? Number(newBaseOpening) : clean.itemForm.baseOpening,
        };
        return clean;
    }
    function resolveRowState(item, day, entries, imports, dayDrafts) {
        const base = stock(item, day, entries, imports);
        if (!base) {
            return { available: false, item, startDate: item.start_date, dirty: false, stale: false, invalidDraft: false };
        }
        const serverEntry = (entries || []).find(e => e.item_id === item.id && e.day === day) || null;
        const serverExists = Boolean(serverEntry);
        const draft = dayDrafts && dayDrafts[item.id];
        if (!draft) {
            return {
                available: true,
                item,
                base,
                serverExists,
                opening: base.opening,
                purchase: base.purchase,
                sale: base.sale,
                damage: base.damage,
                closing: base.closing,
                purchaseInput: String(base.purchase),
                damageInput: String(base.damage),
                dirty: false,
                stale: false,
                invalidDraft: false,
            };
        }
        const stale = hasEntryServerConflict(draft.basePurchase, draft.baseDamage, base.purchase, base.damage, draft.baseExists, serverExists);
        let p = null, d = null, invalidDraft = false;
        try { p = number(draft.purchase, 'Purchase'); } catch (_) { invalidDraft = true; }
        try { d = number(draft.damage, 'Damage'); } catch (_) { invalidDraft = true; }
        const closing = !invalidDraft ? base.opening + p - base.sale - d : null;
        return {
            available: true,
            item,
            base,
            serverExists,
            opening: base.opening,
            purchase: invalidDraft ? null : p,
            sale: base.sale,
            damage: invalidDraft ? null : d,
            closing,
            purchaseInput: String(draft.purchase),
            damageInput: String(draft.damage),
            dirty: true,
            stale,
            invalidDraft,
        };
    }
    function isItemFormDraftStale(formDraft, items) {
        if (!formDraft || !formDraft.editingId) return { stale: false, missing: false, serverItem: null };
        const serverItem = (items || []).find(i => i.id === formDraft.editingId) || null;
        if (!serverItem) return { stale: true, missing: true, serverItem: null };
        const changed = serverItem.name !== formDraft.baseName
            || Number(serverItem.initial_opening) !== Number(formDraft.baseOpening)
            || (formDraft.baseStartDate != null && String(serverItem.start_date) !== String(formDraft.baseStartDate));
        return { stale: changed, missing: false, serverItem };
    }
    function draftSummary(state, currentDay) {
        const clean = sanitizeDraftState(state);
        let currentDayEntries = 0, otherDayEntries = 0;
        const otherDates = [];
        for (const [day, byItem] of Object.entries(clean.entries)) {
            const count = Object.keys(byItem).length;
            if (!count) continue;
            if (day === currentDay) currentDayEntries += count;
            else {
                otherDayEntries += count;
                otherDates.push(day);
            }
        }
        const hasItemForm = Boolean(clean.itemForm);
        return {
            currentDayEntries,
            otherDayEntries,
            otherDates: otherDates.sort(),
            hasItemForm,
            totalCount: currentDayEntries + otherDayEntries + (hasItemForm ? 1 : 0),
        };
    }
    function buildSheetExportRows(items, day, entries, imports, dayDrafts) {
        const rows = [];
        for (const item of items || []) {
            const state = resolveRowState(item, day, entries || [], imports || [], dayDrafts || {});
            if (!state.available) {
                rows.push({
                    itemName: item.name,
                    available: false,
                    startDate: state.startDate,
                    opening: null,
                    purchase: null,
                    sale: null,
                    closing: null,
                    damage: null,
                    isDraft: false,
                    isStale: false,
                    isShortage: false,
                    invalidDraft: false,
                    serverPurchase: null,
                    serverDamage: null,
                });
                continue;
            }
            rows.push({
                itemName: item.name,
                available: true,
                startDate: item.start_date,
                opening: state.opening,
                purchase: state.purchase,
                sale: state.sale,
                closing: state.closing,
                damage: state.damage,
                isDraft: state.dirty,
                isStale: state.stale,
                isShortage: state.closing !== null && state.closing < 0,
                invalidDraft: state.invalidDraft,
                serverPurchase: state.base.purchase,
                serverDamage: state.base.damage,
            });
        }
        return rows;
    }
    function wrapLinesByMeasure(value, maxWidth, measureFn) {
        const measure = typeof measureFn === 'function' ? measureFn : (s => String(s || '').length * 10);
        const cap = Math.max(24, Number(maxWidth) || 336);
        const words = text(value).split(' ').filter(Boolean);
        if (!words.length) return [''];
        const lines = [];
        let line = '';
        for (const w of words) {
            const test = line ? `${line} ${w}` : w;
            if (measure(test) <= cap) { line = test; continue; }
            if (line) lines.push(line);
            if (measure(w) <= cap) { line = w; continue; }
            let chunk = '';
            for (const ch of w) {
                if (measure(chunk + ch) > cap && chunk) {
                    lines.push(chunk);
                    chunk = ch;
                } else {
                    chunk += ch;
                }
            }
            line = chunk;
        }
        if (line) lines.push(line);
        return lines;
    }
    function layoutSheetPages(rows, options = {}) {
        const list = Array.isArray(rows) ? rows : [];
        const nameMaxWidth = Number(options.nameMaxWidth) || 336;
        const lineHeight = Number(options.lineHeight) || 24;
        const padY = options.padY != null ? Number(options.padY) : 22;
        const minRowHeight = Number(options.minRowHeight) || 46;
        const draftBadgeHeight = Number(options.draftBadgeHeight) || 24;
        const contHeaderHeight = Number(options.contHeaderHeight) || 22;
        const contFooterHeight = Number(options.contFooterHeight) || 20;
        const minPageHeight = minRowHeight + contHeaderHeight + contFooterHeight;
        const maxBodyHeight = Math.max(minPageHeight, Number(options.maxBodyHeight) || 1420);
        const measureName = typeof options.measureName === 'function'
            ? options.measureName
            : (s => String(s || '').length * 12);

        if (!list.length) return [{ rows: [], usedHeight: 0 }];
        const pages = [];
        let page = { rows: [], usedHeight: 0 };

        function pushPage() {
            if (page.rows.length) {
                pages.push(page);
                page = { rows: [], usedHeight: 0 };
            }
        }

        for (const row of list) {
            const allLines = wrapLinesByMeasure(row && row.itemName, nameMaxWidth, measureName);
            const draftExtra = row && row.isDraft ? draftBadgeHeight : 0;
            const fullHeight = Math.max(minRowHeight, allLines.length * lineHeight + padY + draftExtra);

            if (fullHeight <= maxBodyHeight) {
                if (page.rows.length && page.usedHeight + fullHeight > maxBodyHeight) pushPage();
                page.rows.push({
                    ...row,
                    nameLines: allLines,
                    rowHeight: fullHeight,
                    isContinuation: false,
                    hasContinuation: false,
                });
                page.usedHeight += fullHeight;
                continue;
            }

            // Exceptionally tall row (> maxBodyHeight): split wrapped lines safely across continuation slices.
            let lineIdx = 0;
            while (lineIdx < allLines.length) {
                const isFirst = lineIdx === 0;
                const overhead = padY + (isFirst ? draftExtra : contHeaderHeight);
                let rem = maxBodyHeight - page.usedHeight;
                if (rem < Math.max(minRowHeight, overhead + lineHeight + contFooterHeight) && page.rows.length) {
                    pushPage();
                    rem = maxBodyHeight;
                }
                const remainingCount = allLines.length - lineIdx;
                let take = remainingCount;
                let hasContinuation = false;
                if (remainingCount * lineHeight + overhead > rem) {
                    hasContinuation = true;
                    const availForLines = Math.max(lineHeight, rem - overhead - contFooterHeight);
                    take = Math.max(1, Math.min(remainingCount, Math.floor(availForLines / lineHeight)));
                }
                const sliceLines = allLines.slice(lineIdx, lineIdx + take);
                const sliceHeight = Math.max(
                    minRowHeight,
                    sliceLines.length * lineHeight + overhead + (hasContinuation ? contFooterHeight : 0)
                );
                page.rows.push({
                    ...row,
                    nameLines: sliceLines,
                    rowHeight: sliceHeight,
                    isContinuation: !isFirst,
                    hasContinuation,
                });
                page.usedHeight += sliceHeight;
                lineIdx += take;
                if (hasContinuation) pushPage();
            }
        }
        pushPage();
        return pages;
    }
    function estimateExportRowUnits(row, maxNameChars = 22) {
        const nameLen = text(row && row.itemName).length;
        const nameLines = Math.max(1, Math.ceil(nameLen / Math.max(8, maxNameChars)));
        return nameLines + (row && row.isDraft ? 0.5 : 0);
    }
    function paginateSheetRows(rows, maxUnitsPerPage = 22) {
        if (maxUnitsPerPage && typeof maxUnitsPerPage === 'object') {
            return layoutSheetPages(rows, maxUnitsPerPage).map(p => p.rows);
        }
        const list = Array.isArray(rows) ? rows : [];
        if (!list.length) return [[]];
        const cap = Math.max(1, Number(maxUnitsPerPage) || 24);
        const pages = [];
        let page = [], used = 0;
        for (const row of list) {
            const units = estimateExportRowUnits(row);
            if (page.length && used + units > cap) {
                pages.push(page);
                page = [row];
                used = units;
            } else {
                page.push(row);
                used += units;
            }
        }
        if (page.length) pages.push(page);
        return pages;
    }
    function dayDraftCount(state, day) {
        const clean = sanitizeDraftState(state);
        const dayStr = String(day || '');
        if (!DATE_RE.test(dayStr) || !clean.entries[dayStr]) return 0;
        return Object.keys(clean.entries[dayStr]).length;
    }
    function hasDayDrafts(state, day) {
        return dayDraftCount(state, day) > 0;
    }
    function summarizeDayForClear(day, entries, imports) {
        const dayStr = String(day || '');
        const dayImport = (imports || []).find(im => im.day === dayStr) || null;
        const salesObj = dayImport && dayImport.sales && typeof dayImport.sales === 'object' ? dayImport.sales : {};
        const salesEntries = Object.entries(salesObj).filter(([, qty]) => Number(qty) > 0);
        const salesItemCount = salesEntries.length;
        const totalSalesPieces = salesEntries.reduce((acc, [, qty]) => acc + Number(qty || 0), 0);
        const dayEntries = (entries || [])
            .filter(e => e.day === dayStr)
            .slice()
            .sort((a, b) => String(a.item_id).localeCompare(String(b.item_id)));
        const activeEntryCount = dayEntries.filter(e => Number(e.purchase || 0) > 0 || Number(e.damage || 0) > 0).length;
        const totalPurchase = dayEntries.reduce((acc, e) => acc + Number(e.purchase || 0), 0);
        const totalDamage = dayEntries.reduce((acc, e) => acc + Number(e.damage || 0), 0);
        const expectedEntries = dayEntries.map(e => ({
            item_id: e.item_id,
            purchase: Number(e.purchase || 0),
            damage: Number(e.damage || 0),
        }));
        const laterDateSet = new Set();
        for (const e of (entries || [])) {
            if (e && e.day && e.day > dayStr) laterDateSet.add(e.day);
        }
        for (const im of (imports || [])) {
            if (im && im.day && im.day > dayStr) laterDateSet.add(im.day);
        }
        const laterDates = Array.from(laterDateSet).sort();
        return {
            day: dayStr,
            hasImport: Boolean(dayImport),
            importRecord: dayImport,
            importFingerprint: dayImport ? (dayImport.fingerprint || null) : null,
            salesItemCount,
            totalSalesPieces,
            entryCount: dayEntries.length,
            activeEntryCount,
            totalPurchase,
            totalDamage,
            expectedEntries,
            laterDates,
            laterDatesCount: laterDates.length,
            isSalesEmpty: !dayImport,
            isWholeDayEmpty: !dayImport && dayEntries.length === 0,
        };
    }
    function checkRestoreConflicts(correction, items, entries, imports) {
        if (!correction || typeof correction !== 'object') {
            return {
                ok: false,
                alreadyRestored: false,
                hasImportConflict: false,
                entryConflicts: [],
                missingItems: [],
                startDateConflicts: [],
                reasons: ['Recovery snapshot was not found.'],
            };
        }
        if (correction.restored_at) {
            return {
                ok: false,
                alreadyRestored: true,
                hasImportConflict: false,
                entryConflicts: [],
                missingItems: [],
                startDateConflicts: [],
                reasons: ['This recovery snapshot was already restored.'],
            };
        }
        const day = String(correction.day || '');
        const itemMap = new Map((items || []).map(it => [it.id, it]));
        const reasons = [];
        let hasImportConflict = false;
        const entryConflicts = [];
        const missingItems = [];
        const startDateConflicts = [];
        const missingSeen = new Set();
        const startSeen = new Set();

        const checkItemAvailability = (itemId) => {
            const it = itemMap.get(itemId);
            if (!it) {
                if (!missingSeen.has(itemId)) {
                    missingSeen.add(itemId);
                    missingItems.push(itemId);
                    reasons.push('Referenced stock item no longer exists.');
                }
                return;
            }
            if (it.start_date && day && it.start_date > day && !startSeen.has(itemId)) {
                startSeen.add(itemId);
                startDateConflicts.push({ itemId, itemName: it.name, startDate: it.start_date });
                reasons.push(`${it.name} now starts on ${it.start_date} (after ${day}).`);
            }
        };

        const impSnap = correction.import_snapshot;
        if (impSnap && typeof impSnap === 'object') {
            const existingImport = (imports || []).find(im => im.day === day) || null;
            if (existingImport) {
                hasImportConflict = true;
                reasons.push(`Imported sales already exist for ${day}. Remove them first before restoring.`);
            }
            const sales = impSnap.sales && typeof impSnap.sales === 'object' ? impSnap.sales : {};
            for (const itemId of Object.keys(sales)) {
                checkItemAvailability(itemId);
            }
        }

        const entrySnaps = Array.isArray(correction.entries_snapshot) ? correction.entries_snapshot : [];
        if (entrySnaps.length) {
            const existingByItem = new Map(
                (entries || []).filter(e => e.day === day).map(e => [e.item_id, e])
            );
            for (const snap of entrySnaps) {
                if (!snap || !snap.item_id) continue;
                checkItemAvailability(snap.item_id);
                const existing = existingByItem.get(snap.item_id);
                if (existing) {
                    const it = itemMap.get(snap.item_id);
                    const name = it ? it.name : snap.item_id;
                    entryConflicts.push({
                        itemId: snap.item_id,
                        itemName: name,
                        existingPurchase: Number(existing.purchase || 0),
                        existingDamage: Number(existing.damage || 0),
                    });
                    const pStr = Number(Number(existing.purchase || 0).toFixed(4));
                    const dStr = Number(Number(existing.damage || 0).toFixed(4));
                    reasons.push(`Movement row already exists on ${day} for ${name} (Purchase ${pStr}, Damage ${dStr}).`);
                }
            }
        }

        return {
            ok: reasons.length === 0,
            alreadyRestored: false,
            hasImportConflict,
            entryConflicts,
            missingItems,
            startDateConflicts,
            reasons,
        };
    }
    function formatCorrectionSummary(correction) {
        if (!correction || typeof correction !== 'object') {
            return {
                day: '',
                scopeLabel: 'Correction',
                detailText: '',
                hasImport: false,
                salesItemCount: 0,
                salesPieces: 0,
                entryCount: 0,
                purchaseTotal: 0,
                damageTotal: 0,
                isRestored: false,
            };
        }
        const fmtCount = n => String(Number(Number(n || 0).toFixed(4)));
        const impSnap = correction.import_snapshot && typeof correction.import_snapshot === 'object'
            ? correction.import_snapshot
            : null;
        const salesObj = impSnap && impSnap.sales && typeof impSnap.sales === 'object' ? impSnap.sales : {};
        const salesEntries = Object.entries(salesObj).filter(([, qty]) => Number(qty) > 0);
        const salesItemCount = salesEntries.length;
        const salesPieces = salesEntries.reduce((acc, [, qty]) => acc + Number(qty || 0), 0);
        const entrySnaps = Array.isArray(correction.entries_snapshot) ? correction.entries_snapshot : [];
        const entryCount = entrySnaps.length;
        const purchaseTotal = entrySnaps.reduce((acc, e) => acc + Number((e && e.purchase) || 0), 0);
        const damageTotal = entrySnaps.reduce((acc, e) => acc + Number((e && e.damage) || 0), 0);
        const scopeLabel = correction.scope === 'sales_only'
            ? 'Imported sales removed'
            : 'Whole day cleared';
        const parts = [];
        if (entryCount > 0) {
            parts.push(`${entryCount} movement row${entryCount === 1 ? '' : 's'} (${fmtCount(purchaseTotal)} purchase, ${fmtCount(damageTotal)} damage)`);
        }
        if (impSnap) {
            parts.push(`Imported POS sales (${salesItemCount} item${salesItemCount === 1 ? '' : 's'}, ${fmtCount(salesPieces)} pcs)`);
        }
        return {
            day: String(correction.day || ''),
            scopeLabel,
            detailText: parts.join(' + ') || 'Empty snapshot',
            hasImport: Boolean(impSnap),
            salesItemCount,
            salesPieces,
            entryCount,
            purchaseTotal,
            damageTotal,
            isRestored: Boolean(correction.restored_at),
        };
    }
    return {
        normalizeName,
        tokenizeName,
        dishNameForMatching,
        containsWordSequence,
        savedChoiceMap,
        matchDish,
        suggestMappings,
        draftStorageKey,
        emptyDraftState,
        sanitizeDraftState,
        loadDraftState,
        saveDraftState,
        setEntryDraft,
        clearEntryDraft,
        clearEntryDraftIfRevision,
        rebaseEntryDraft,
        hasEntryServerConflict,
        setItemFormDraft,
        clearItemFormDraft,
        clearItemFormDraftIfRevision,
        rebaseItemFormDraft,
        resolveRowState,
        isItemFormDraftStale,
        draftSummary,
        dayDraftCount,
        hasDayDrafts,
        summarizeDayForClear,
        checkRestoreConflicts,
        formatCorrectionSummary,
        buildSheetExportRows,
        wrapLinesByMeasure,
        layoutSheetPages,
        estimateExportRowUnits,
        paginateSheetRows,
        number,
        pieces,
        parseReport,
        preview,
        stock,
        importDecision,
    };
});
