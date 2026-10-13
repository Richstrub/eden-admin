/* Eden: recipe book with scaling. Used on the staff site (#recipes) and on the staff schedule page.
 *
 * Owner and Managers create and edit recipes; everyone else on the team can read them. Each recipe has a
 * yield (e.g. 4 qt, 12 portions), ingredients (amount, unit, item, note; optional sub-headings), method
 * steps and notes. Scale by a multiplier (½×, 2×, 3×…) or by the yield you want ("make 10 qt"), and the
 * amounts are recalculated, with "Smart units" switching to sensible units (48 tsp → 1 cup, 2000 g → 2 kg)
 * and kitchen-friendly fractions.
 *
 * Data: Supabase table recipes (supabase/recipes.sql).
 */
(function () {
  'use strict';

  /* ---------- units ---------- */
  // base: volume in ml, weight in grams
  var UNITS = {
    tsp: { k: 'vol', sys: 'us', ml: 4.92892, names: ['tsp', 'teaspoon', 'teaspoons', 't'] },
    tbsp: { k: 'vol', sys: 'us', ml: 14.7868, names: ['tbsp', 'tablespoon', 'tablespoons', 'tbs', 'tbl', 'T'] },
    'fl oz': { k: 'vol', sys: 'us', ml: 29.5735, names: ['fl oz', 'floz', 'fluid ounce', 'fluid ounces'] },
    cup: { k: 'vol', sys: 'us', ml: 236.588, names: ['cup', 'cups', 'c'] },
    pt: { k: 'vol', sys: 'us', ml: 473.176, names: ['pt', 'pint', 'pints'] },
    qt: { k: 'vol', sys: 'us', ml: 946.353, names: ['qt', 'quart', 'quarts'] },
    gal: { k: 'vol', sys: 'us', ml: 3785.41, names: ['gal', 'gallon', 'gallons'] },
    ml: { k: 'vol', sys: 'metric', ml: 1, names: ['ml', 'milliliter', 'milliliters', 'millilitre', 'millilitres'] },
    l: { k: 'vol', sys: 'metric', ml: 1000, names: ['l', 'liter', 'liters', 'litre', 'litres', 'lt'] },
    oz: { k: 'wt', sys: 'us', g: 28.3495, names: ['oz', 'ounce', 'ounces'] },
    lb: { k: 'wt', sys: 'us', g: 453.592, names: ['lb', 'lbs', 'pound', 'pounds', '#'] },
    g: { k: 'wt', sys: 'metric', g: 1, names: ['g', 'gram', 'grams', 'gr'] },
    kg: { k: 'wt', sys: 'metric', g: 1000, names: ['kg', 'kilogram', 'kilograms', 'kilo', 'kilos'] }
  };
  var COUNT_UNITS = ['each', 'ea', 'clove', 'cloves', 'bunch', 'bunches', 'sprig', 'sprigs', 'head', 'heads', 'can', 'cans', 'pinch', 'pinches', 'dash', 'dashes', 'sheet', 'sheets', 'portion', 'portions', 'piece', 'pieces', 'case', 'cases', 'leaf', 'leaves', 'egg', 'eggs', 'slice', 'slices', 'stick', 'sticks', 'pkg', 'bag', 'bags'];
  var UNIT_LIST = ['tsp', 'tbsp', 'fl oz', 'cup', 'pt', 'qt', 'gal', 'ml', 'l', 'oz', 'lb', 'g', 'kg', 'each', 'clove', 'bunch', 'sprig', 'pinch', 'can', 'sheet', 'portion'];
  var ALIAS = {}; Object.keys(UNITS).forEach(function (u) { UNITS[u].names.forEach(function (n) { ALIAS[n.toLowerCase()] = u; }); });
  ALIAS['t'] = 'tsp'; // lowercase t
  function normUnit(u) {
    var s = String(u || '').trim().replace(/\.$/, '');
    if (s === 'T' || s === 'Tbsp' || s === 'TBSP') return 'tbsp';
    return ALIAS[s.toLowerCase()] || s;
  }
  // the ladders Smart units picks from (smallest first), with the amount at which to move up
  var LADDER = {
    'vol-us': [['tsp', 0], ['tbsp', 3 * 4.92892], ['cup', 4 * 14.7868], ['qt', 4 * 236.588], ['gal', 4 * 946.353]],
    'vol-metric': [['ml', 0], ['l', 1000]],
    'wt-us': [['oz', 0], ['lb', 453.592]],
    'wt-metric': [['g', 0], ['kg', 1000]]
  };

  /* ---------- numbers ---------- */
  var VULGAR = { '¼': 0.25, '½': 0.5, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875, '⅙': 1 / 6, '⅚': 5 / 6 };
  function parseQty(s) {
    s = String(s == null ? '' : s).trim(); if (!s) return null;
    s = s.replace(/[¼½¾⅓⅔⅛⅜⅝⅞⅙⅚]/g, function (c) { return ' ' + VULGAR[c] + ' '; }).replace(/,/g, '.').trim();
    var total = 0, ok = false;
    s.split(/\s+/).forEach(function (part) {
      if (/^\d+\/\d+$/.test(part)) { var p = part.split('/'); if (+p[1]) { total += +p[0] / +p[1]; ok = true; } }
      else if (/^\d*\.?\d+$/.test(part)) { total += parseFloat(part); ok = true; }
    });
    return ok ? total : null;
  }
  var FRACS = [[0, ''], [0.125, '⅛'], [0.25, '¼'], [1 / 3, '⅓'], [0.375, '⅜'], [0.5, '½'], [0.625, '⅝'], [2 / 3, '⅔'], [0.75, '¾'], [0.875, '⅞'], [1, '']];
  function fracStr(n) { // nearest kitchen fraction
    if (n == null) return '';
    var whole = Math.floor(n + 1e-9), rest = n - whole, best = FRACS[0], d = 9;
    FRACS.forEach(function (f) { var dd = Math.abs(rest - f[0]); if (dd < d) { d = dd; best = f; } });
    if (best[0] === 1) { whole += 1; best = FRACS[0]; }
    if (!whole && !best[1]) return n > 0 ? '⅛' : '0';
    return (whole ? String(whole) : '') + best[1];
  }
  function decStr(n, places) { var p = Math.pow(10, places); var v = Math.round(n * p) / p; return String(v); }
  function fmtAmount(n, unit) {
    if (n == null) return '';
    var u = UNITS[unit];
    if (u && u.sys === 'metric') return u.k === 'wt' ? (unit === 'g' ? (n < 10 ? decStr(n, 1) : String(Math.round(n))) : decStr(n, 2)) : (unit === 'ml' ? String(Math.round(n)) : decStr(n, 2));
    if (u) return n >= 20 ? decStr(n, 1).replace(/\.0$/, '') : fracStr(n);
    return n >= 20 ? decStr(n, 1).replace(/\.0$/, '') : fracStr(n); // counts and anything else
  }
  function smart(n, unit) { // pick the most readable unit in the same system
    var u = UNITS[unit]; if (!u || n == null) return { n: n, unit: unit };
    var key = u.k + '-' + u.sys, base = n * (u.k === 'vol' ? u.ml : u.g), lad = LADDER[key];
    if (!lad) return { n: n, unit: unit };
    if (key === 'vol-us' && (unit === 'fl oz' || unit === 'pt')) { /* convert these too */ }
    var pick = lad[0][0];
    lad.forEach(function (step) { if (base >= step[1] * 0.995) pick = step[0]; }); // small tolerance for rounding
    var to = UNITS[pick], val = base / (to.k === 'vol' ? to.ml : to.g);
    // prefer whole tbsp/cup-friendly values: e.g. 1.5 tsp stays tsp; 6 tbsp → ⅜ cup is awkward, keep tbsp under ½ cup
    if (pick === 'cup' && val < 0.495) { pick = 'tbsp'; val = base / UNITS.tbsp.ml; }
    if (pick === 'qt' && val < 0.995) { pick = 'cup'; val = base / UNITS.cup.ml; }
    if (pick === 'gal' && val < 0.995) { pick = 'qt'; val = base / UNITS.qt.ml; }
    return { n: val, unit: pick };
  }
  function unitLabel(unit, n) {
    if (!unit) return '';
    if (UNITS[unit]) return unit;
    if (n != null && n > 1 && /^(clove|bunch|sprig|head|can|pinch|dash|sheet|portion|piece|case|slice|stick|bag|egg)$/i.test(unit)) return unit + (/(ch|sh)$/i.test(unit) ? 'es' : 's');
    return unit;
  }

  // "2 1/2 cups heavy cream, cold" → { qty: 2.5, unit: 'cup', item: 'heavy cream', note: 'cold' }
  function parseLine(line) {
    var s = String(line || '').trim().replace(/^[-*•]\s*/, '');
    if (!s) return null;
    if (/:$/.test(s) && !/\d/.test(s)) return { head: true, item: s.replace(/:$/, '') };
    var m = /^((?:\d+\s+)?\d+\/\d+|\d*\.?\d+(?:\s*[¼½¾⅓⅔⅛⅜⅝⅞])?|[¼½¾⅓⅔⅛⅜⅝⅞])\s*(.*)$/.exec(s);
    var qty = null, rest = s;
    if (m) { qty = parseQty(m[1]); rest = m[2]; }
    var unit = '', words = rest.split(/\s+/);
    var two = (words[0] + ' ' + (words[1] || '')).toLowerCase();
    if (ALIAS[two]) { unit = ALIAS[two]; words.splice(0, 2); }
    else if (words[0] && (ALIAS[words[0].toLowerCase().replace(/\.$/, '')] || words[0] === 'T')) { unit = normUnit(words[0]); words.splice(0, 1); }
    else if (words[0] && COUNT_UNITS.indexOf(words[0].toLowerCase()) !== -1 && qty != null && words.length > 1) { unit = words[0].toLowerCase().replace(/s$/, '').replace(/^ea$/, 'each').replace(/^bunche$/, 'bunch').replace(/^pinche$/, 'pinch').replace(/^leave$/, 'leaf'); words.splice(0, 1); }
    var item = words.join(' ').replace(/^of\s+/i, '').trim(), note = '';
    var c = item.indexOf(','); if (c > 0) { note = item.slice(c + 1).trim(); item = item.slice(0, c).trim(); }
    var tt = /,?\s*\b(to taste|as needed)\b/i.exec(item);
    if (tt) { note = note || tt[1].toLowerCase(); item = item.replace(tt[0], '').trim() || item; }
    return { qty: qty, unit: unit, item: item, note: note };
  }

  /* ---------- a recipe from plain text (Notes > Send to recipes) ----------
   * Understands headings ("Ingredients", "Method"/"Directions"/"Steps", "Notes") and lines like "Yield: 4 qt",
   * "Serves 6", "Time: 2 hours", "Allergens: dairy", "Category: Sauces". Without headings, lines that start with
   * an amount are ingredients and the rest is the method. */
  var H_ING = /^(ingredients?|for the [a-z ]+|you('ll| will) need)\s*:?$/i, H_METH = /^(method|directions?|steps?|procedure|instructions?|preparation|how to( make( it)?)?)\s*:?$/i, H_NOTE = /^(notes?|tips?|chef'?s notes?)\s*:?$/i;
  function fromText(title, body) {
    var lines = String(body || '').split('\n').map(function (l) { return l.replace(/\s+$/, ''); });
    var name = String(title || '').trim();
    if (!name) { while (lines.length && !lines[0].trim()) lines.shift(); name = (lines.shift() || '').trim().replace(/:$/, ''); }
    var x = { id: uid(), name: name.slice(0, 200), category: '', yield_qty: null, yield_unit: '', time: '', allergens: '', ingredients: [], method: [], notes: [] };
    var mode = 'auto', sawMethod = false, m;
    lines.forEach(function (raw) {
      var l = raw.trim(); if (!l) return;
      var bare = l.replace(/^[-*•]\s*/, '');
      if ((m = /^(yield|makes|serves|portions)\s*[:\-]?\s*(.+)$/i.exec(bare))) {
        var q = /^((?:\d+\s+)?\d+\/\d+|\d*\.?\d+)\s*(.*)$/.exec(m[2].trim());
        if (q) { x.yield_qty = parseQty(q[1]); x.yield_unit = (q[2] || (/serves/i.test(m[1]) ? 'servings' : '')).trim().slice(0, 40); return; }
      }
      if ((m = /^((?:total |prep |cook |active )?time)\s*[:\-]\s*(.+)$/i.exec(bare))) { x.time = (x.time ? x.time + ', ' : '') + (/^time$/i.test(m[1]) ? '' : m[1].replace(/\s*time$/i, '') + ' ') + m[2].trim(); return; }
      if ((m = /^allergens?\s*[:\-]\s*(.+)$/i.exec(bare))) { x.allergens = m[1].trim(); return; }
      if ((m = /^category\s*[:\-]\s*(.+)$/i.exec(bare))) { x.category = m[1].trim(); return; }
      if (H_ING.test(bare)) { mode = 'ing'; if (!/^ingredients?/i.test(bare)) x.ingredients.push({ head: true, item: bare.replace(/:$/, '') }); return; }
      if (H_METH.test(bare)) { mode = 'meth'; sawMethod = true; return; }
      if (H_NOTE.test(bare)) { mode = 'note'; return; }
      if (mode === 'note') { x.notes.push(l); return; }
      if (mode === 'meth') { x.method.push(l.replace(/^(step\s*)?\d+\s*[.):-]\s*/i, '')); return; }
      var step = /^(step\s*\d+|\d+\s*[.)])\s+/i.test(l);
      var p = step ? null : parseLine(l);
      if (mode === 'ing') { if (p) x.ingredients.push(p); return; }
      // no headings: amounts are ingredients; short lines before the method are too (e.g. "salt, to taste")
      if (!step && p && (p.head || p.qty != null || (!sawMethod && bare.split(/\s+/).length <= 6 && !/[.!?]$/.test(bare)))) { x.ingredients.push(p); return; }
      sawMethod = true; x.method.push(l.replace(/^(step\s*)?\d+\s*[.):-]\s*/i, ''));
    });
    x.method = x.method.map(function (t, i) { return (i + 1) + '. ' + t; }).join('\n');
    x.notes = x.notes.join('\n');
    return x;
  }

  /* ---------- state ---------- */
  var R = { ctx: null, el: null, list: [], loaded: false, missing: false, cur: null, edit: null, q: '', cat: '', factor: 1, target: null, smart: true, dirty: false };

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function status(t, k) { if (R.ctx && R.ctx.status) R.ctx.status(t, k); }
  function isMissing(e) { return e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message || '')); }
  function isPerm(e) { return e && (e.code === '42501' || /row-level security|permission/i.test(e.message || '')); }
  function canEdit() { return !!(R.ctx && R.ctx.canEdit); }
  function blank() { return { id: uid(), name: '', category: '', yield_qty: null, yield_unit: '', time: '', allergens: '', ingredients: [{ qty: null, unit: '', item: '', note: '' }], method: '', notes: '', _new: true }; }

  function load() {
    return R.ctx.sb.from('recipes').select('*').order('name').then(function (r) {
      R.loaded = true;
      if (r.error) { R.missing = isMissing(r.error); R.list = []; if (!R.missing) status(isPerm(r.error) ? 'Your login can’t open the recipes.' : 'Couldn’t load the recipes.', 'err'); return; }
      R.missing = false;
      R.list = (r.data || []).map(function (x) { x.ingredients = Array.isArray(x.ingredients) ? x.ingredients : []; return x; }).sort(function (a, b) { return String(a.name).localeCompare(b.name); });
      if (R.pendingOpen) { var f = R.list.filter(function (x) { return x.id === R.pendingOpen; })[0]; if (f) { R.cur = f; R.edit = null; R.factor = 1; R.target = null; } R.pendingOpen = null; }
    }, function () { R.loaded = true; });
  }

  /* ---------- rendering ---------- */
  function render() {
    var el = R.el; if (!el) return;
    el.innerHTML = '';
    var wrap = h('div', { cls: 'rc-in' }); el.appendChild(wrap);
    wrap.appendChild(h('div', { cls: 'rc-title' }, [
      h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Kitchen & Bar' }), h('h1', { cls: 'sc-week', text: 'Recipes' })]),
      canEdit() && !R.missing ? h('button', { type: 'button', cls: 'ed-btn', text: 'New recipe', on: { click: function () { startEdit(blank()); } } }) : null
    ]));
    wrap.appendChild(h('p', { cls: 'rc-status', role: 'status' }));
    if (!R.loaded) { wrap.appendChild(h('p', { cls: 'sc-empty', text: 'Loading recipes…' })); return; }
    if (R.missing) {
      wrap.appendChild(h('div', { cls: 'iv-setup' }, [h('p', { text: canEdit() ? 'The recipe book isn’t in Supabase yet. In Supabase, open SQL Editor → New query, paste the contents of supabase/recipes.sql from the eden-admin repository, and click Run. Then reload this page.' : 'The recipe book hasn’t been set up yet.' })]));
      return;
    }
    var body = h('div', { cls: 'rc-body' + (R.cur || R.edit ? ' has-cur' : '') });
    body.appendChild(sidebar());
    var main = h('div', { cls: 'rc-main' });
    if (R.edit) main.appendChild(editor());
    else if (R.cur) main.appendChild(viewer(R.cur));
    else main.appendChild(h('div', { cls: 'rc-pick' }, [h('p', { text: R.list.length ? 'Choose a recipe.' : (canEdit() ? 'No recipes yet. Click “New recipe” to write the first one.' : 'No recipes have been added yet.') })]));
    body.appendChild(main);
    wrap.appendChild(body);
  }
  function categories() { var s = {}; R.list.forEach(function (x) { if (x.category) s[x.category] = 1; }); return Object.keys(s).sort(); }
  function sidebar() {
    var side = h('aside', { cls: 'rc-side' });
    var q = h('input', { type: 'search', placeholder: 'Find a recipe or ingredient', value: R.q, 'aria-label': 'Find a recipe' });
    q.addEventListener('input', function () { R.q = q.value; paintList(); });
    var cats = categories();
    var sel = h('select', { 'aria-label': 'Category' }, [h('option', { value: '', text: 'All categories' })].concat(cats.map(function (c) { return h('option', { value: c, text: c }); })));
    sel.value = R.cat; sel.addEventListener('change', function () { R.cat = sel.value; paintList(); });
    side.appendChild(h('div', { cls: 'rc-find' }, [q, cats.length ? sel : null]));
    var ul = h('div', { cls: 'rc-list' }); side.appendChild(ul);
    function paintList() {
      ul.innerHTML = '';
      var words = fold(R.q).split(/\s+/).filter(Boolean), lastCat = null;
      var items = R.list.filter(function (x) {
        if (R.cat && x.category !== R.cat) return false;
        var hay = fold(x.name + ' ' + x.category + ' ' + (x.ingredients || []).map(function (i) { return i.item; }).join(' '));
        return words.every(function (w) { return hay.indexOf(w) !== -1; });
      }).sort(function (a, b) { return String(a.category || '~').localeCompare(b.category || '~') || String(a.name).localeCompare(b.name); });
      if (!items.length) ul.appendChild(h('p', { cls: 'rc-none', text: R.list.length ? 'No recipes match.' : 'No recipes yet.' }));
      items.forEach(function (x) {
        if ((x.category || '') !== lastCat) { lastCat = x.category || ''; ul.appendChild(h('div', { cls: 'rc-cat', text: lastCat || 'Other' })); }
        ul.appendChild(h('button', { type: 'button', cls: 'rc-item' + (R.cur && R.cur.id === x.id ? ' on' : ''), on: { click: function () { openRecipe(x); } } }, [
          h('b', { text: x.name || 'Untitled' }), h('span', { text: x.yield_qty ? 'Makes ' + fmtAmount(x.yield_qty, normUnit(x.yield_unit)) + ' ' + (x.yield_unit || '') : '' })
        ]));
      });
    }
    paintList();
    return side;
  }
  function openRecipe(x) {
    if (R.edit && R.dirty && !confirm('Leave without saving your changes?')) return;
    R.edit = null; R.dirty = false; R.cur = x; R.factor = 1; R.target = null; render();
    var m = R.el.querySelector('.rc-main'); if (m && m.getBoundingClientRect().top < 0) m.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------- viewer with scaling ---------- */
  function scaled(ing, f) {
    if (ing.qty == null || ing.qty === '') return { n: null, unit: ing.unit };
    var n = ing.qty * f, unit = normUnit(ing.unit);
    return R.smart ? smart(n, unit) : { n: n, unit: unit };
  }
  function viewer(x) {
    var box = h('article', { cls: 'rc-card' });
    var f = R.factor;
    var yUnit = x.yield_unit || '';
    box.appendChild(h('header', { cls: 'rc-head' }, [
      h('div', null, [
        x.category ? h('p', { cls: 'rc-catline', text: x.category }) : null,
        h('h2', { text: x.name || 'Untitled' }),
        h('p', { cls: 'rc-meta', text: [x.yield_qty ? 'Base recipe makes ' + fmtAmount(x.yield_qty, normUnit(yUnit)) + ' ' + yUnit : '', x.time ? x.time : '', x.allergens ? 'Allergens: ' + x.allergens : ''].filter(Boolean).join(' · ') })
      ]),
      h('div', { cls: 'rc-acts' }, [
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Print', on: { click: function () { window.print(); } } }),
        canEdit() ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Duplicate', on: { click: function () { var c = JSON.parse(JSON.stringify(x)); c.id = uid(); c.name = (x.name || '') + ' (copy)'; c._new = true; startEdit(c); } } }) : null,
        canEdit() ? h('button', { type: 'button', cls: 'ed-btn', text: 'Edit', on: { click: function () { startEdit(JSON.parse(JSON.stringify(x))); } } }) : null
      ])
    ]));
    // scaling
    var sc = h('div', { cls: 'rc-scale' });
    var mult = h('div', { cls: 'sc-viewtog rc-mult', role: 'group', 'aria-label': 'Scale' });
    [0.5, 1, 2, 3, 4].forEach(function (m) { mult.appendChild(h('button', { type: 'button', 'aria-pressed': Math.abs(f - m) < 1e-9 && R.target == null ? 'true' : 'false', text: (m === 0.5 ? '½' : m) + '×', on: { click: function () { R.factor = m; R.target = null; render(); } } })); });
    var custom = h('input', { type: 'text', inputmode: 'decimal', cls: 'rc-x', value: [0.5, 1, 2, 3, 4].indexOf(f) === -1 || R.target != null ? decStr(f, 3) : '', placeholder: 'e.g. 1.5', 'aria-label': 'Custom multiplier' });
    custom.addEventListener('change', function () { var v = parseQty(custom.value); if (v && v > 0) { R.factor = v; R.target = null; render(); } });
    sc.appendChild(h('label', { cls: 'rc-scl' }, [h('span', { text: 'Scale' }), mult]));
    sc.appendChild(h('label', { cls: 'rc-scl' }, [h('span', { text: 'Or ×' }), custom]));
    if (x.yield_qty) {
      var tgt = h('input', { type: 'text', inputmode: 'decimal', cls: 'rc-x', value: R.target != null ? fmtAmount(R.target, normUnit(yUnit)) : '', placeholder: fmtAmount(x.yield_qty * f, normUnit(yUnit)), 'aria-label': 'Amount to make' });
      tgt.addEventListener('change', function () { var v = parseQty(tgt.value); if (v && v > 0) { R.target = v; R.factor = v / x.yield_qty; render(); } });
      sc.appendChild(h('label', { cls: 'rc-scl' }, [h('span', { text: 'Make' }), h('div', { cls: 'rc-make' }, [tgt, h('em', { text: yUnit })])]));
    }
    var sm = h('input', { type: 'checkbox' }); sm.checked = R.smart; sm.addEventListener('change', function () { R.smart = sm.checked; render(); });
    sc.appendChild(h('label', { cls: 'sc-check rc-smart', title: 'Show amounts in the easiest unit to measure, e.g. 48 tsp as 1 cup' }, [sm, ' Smart units']));
    box.appendChild(sc);
    box.appendChild(h('p', { cls: 'rc-yield', text: (Math.abs(f - 1) < 1e-9 ? 'Base recipe' : 'Scaled ' + decStr(f, 3) + '×') + (x.yield_qty ? ' · makes ' + fmtAmount(x.yield_qty * f, normUnit(yUnit)) + ' ' + yUnit : '') }));
    // ingredients
    var tb = h('tbody');
    (x.ingredients || []).forEach(function (ing) {
      if (ing.head) { tb.appendChild(h('tr', { cls: 'rc-ihead' }, h('td', { colspan: '3', text: ing.item }))); return; }
      var s = scaled(ing, f);
      tb.appendChild(h('tr', null, [
        h('td', { cls: 'rc-amt', text: fmtAmount(s.n, s.unit) }),
        h('td', { cls: 'rc-unit', text: unitLabel(s.unit, s.n) }),
        h('td', { cls: 'rc-ing' }, [h('span', { text: ing.item || '' }), ing.note ? h('small', { text: ing.note }) : null])
      ]));
    });
    box.appendChild(h('section', { cls: 'rc-sec' }, [h('h3', { text: 'Ingredients' }), h('table', { cls: 'rc-ings' }, tb)]));
    var steps = String(x.method || '').split('\n').map(function (s) { return s.replace(/^\s*\d+[.)]\s*/, '').trim(); }).filter(Boolean);
    if (steps.length) box.appendChild(h('section', { cls: 'rc-sec' }, [h('h3', { text: 'Method' }), h('ol', { cls: 'rc-steps' }, steps.map(function (s) { return h('li', { text: s }); }))]));
    if ((x.notes || '').trim()) box.appendChild(h('section', { cls: 'rc-sec' }, [h('h3', { text: 'Notes' }), h('p', { cls: 'rc-notes', text: x.notes })]));
    if (Math.abs(f - 1) > 1e-9) box.appendChild(h('p', { cls: 'rc-fine', text: 'Times, pan sizes and seasoning don’t always scale evenly. Taste and adjust.' }));
    if (x.updated_at) box.appendChild(h('p', { cls: 'rc-fine', text: 'Last updated ' + new Date(x.updated_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) + (x.updated_by ? ' by ' + x.updated_by : '') }));
    return box;
  }

  /* ---------- editor (Owner and Managers) ---------- */
  function startEdit(x) {
    if (!x.ingredients || !x.ingredients.length) x.ingredients = [{ qty: null, unit: '', item: '', note: '' }];
    R.edit = x; R.dirty = false; render();
    var n = R.el.querySelector('.rc-ed [name=name]'); if (n) n.focus();
  }
  function editor() {
    var x = R.edit;
    var box = h('form', { cls: 'rc-card rc-ed', novalidate: true });
    box.addEventListener('submit', function (e) { e.preventDefault(); save(); });
    function inp(name, val, ph, extra) { var i = h('input', Object.assign({ type: 'text', name: name, value: val == null ? '' : val, placeholder: ph || '' }, extra || {})); i.addEventListener('input', function () { R.dirty = true; }); return i; }
    var name = inp('name', x.name, 'e.g. Chimichurri');
    var cat = inp('category', x.category, 'e.g. Sauces', { list: 'rcCats' });
    var yq = inp('yield_qty', x.yield_qty != null ? fmtAmount(x.yield_qty, normUnit(x.yield_unit)) : '', 'e.g. 4', { inputmode: 'decimal' });
    var yu = inp('yield_unit', x.yield_unit, 'e.g. qt, portions', { list: 'rcUnits' });
    var time = inp('time', x.time, 'e.g. 20 min prep, 2 hr braise');
    var alg = inp('allergens', x.allergens, 'e.g. dairy, nuts');
    box.appendChild(h('header', { cls: 'rc-head' }, [h('h2', { text: x._new ? 'New recipe' : 'Edit recipe' })]));
    box.appendChild(h('div', { cls: 'rc-grid' }, [
      h('label', { cls: 'sc-f rc-wide' }, [h('span', { text: 'Recipe name' }), name]),
      h('label', { cls: 'sc-f' }, [h('span', { text: 'Category' }), cat]),
      h('label', { cls: 'sc-f' }, [h('span', { text: 'Base yield' }), h('div', { cls: 'rc-yrow' }, [yq, yu])]),
      h('label', { cls: 'sc-f' }, [h('span', { text: 'Time (optional)' }), time]),
      h('label', { cls: 'sc-f' }, [h('span', { text: 'Allergens (optional)' }), alg]),
      h('datalist', { id: 'rcCats' }, categories().concat(['Sauces', 'Dressings', 'Stocks', 'Proteins', 'Vegetables', 'Starches', 'Pastry', 'Bread', 'Pickles', 'Bar', 'Syrups']).filter(function (v, i, a) { return a.indexOf(v) === i; }).map(function (c) { return h('option', { value: c }); })),
      h('datalist', { id: 'rcUnits' }, UNIT_LIST.concat(['portions', 'servings', 'batch']).map(function (u) { return h('option', { value: u }); }))
    ]));
    // ingredients
    var rows = h('div', { cls: 'rc-erows' });
    function paintRows() {
      rows.innerHTML = '';
      rows.appendChild(h('div', { cls: 'rc-erow rc-ehdr' }, [h('span', { text: 'Amount' }), h('span', { text: 'Unit' }), h('span', { text: 'Ingredient' }), h('span', { text: 'Note (optional)' }), h('span')]));
      x.ingredients.forEach(function (ing, i) {
        var tools = h('div', { cls: 'rc-etools' }, [
          h('button', { type: 'button', cls: 'rc-mini', 'aria-label': 'Move up', text: '↑', on: { click: function () { if (i > 0) { x.ingredients.splice(i - 1, 0, x.ingredients.splice(i, 1)[0]); R.dirty = true; paintRows(); } } } }),
          h('button', { type: 'button', cls: 'rc-mini', 'aria-label': 'Move down', text: '↓', on: { click: function () { if (i < x.ingredients.length - 1) { x.ingredients.splice(i + 1, 0, x.ingredients.splice(i, 1)[0]); R.dirty = true; paintRows(); } } } }),
          h('button', { type: 'button', cls: 'rc-mini rc-del', 'aria-label': 'Remove', text: '✕', on: { click: function () { x.ingredients.splice(i, 1); if (!x.ingredients.length) x.ingredients.push({ qty: null, unit: '', item: '', note: '' }); R.dirty = true; paintRows(); } } })
        ]);
        if (ing.head) {
          var hd = h('input', { type: 'text', value: ing.item || '', placeholder: 'Sub-heading, e.g. For the sauce', 'aria-label': 'Sub-heading' });
          hd.addEventListener('input', function () { ing.item = hd.value; R.dirty = true; });
          rows.appendChild(h('div', { cls: 'rc-erow rc-ehead' }, [hd, tools]));
          return;
        }
        var q = h('input', { type: 'text', inputmode: 'decimal', value: ing.qty != null ? fmtAmount(ing.qty, normUnit(ing.unit)) : '', placeholder: '1 ½', 'aria-label': 'Amount' });
        var u = h('input', { type: 'text', value: ing.unit || '', list: 'rcUnits', placeholder: 'cup', 'aria-label': 'Unit' });
        var it = h('input', { type: 'text', value: ing.item || '', placeholder: 'Heavy cream', 'aria-label': 'Ingredient' });
        var nt = h('input', { type: 'text', value: ing.note || '', placeholder: 'cold', 'aria-label': 'Note' });
        q.addEventListener('input', function () { ing.qty = parseQty(q.value); q.classList.toggle('bad', !!q.value.trim() && ing.qty == null); R.dirty = true; });
        u.addEventListener('change', function () { ing.unit = normUnit(u.value); u.value = ing.unit; R.dirty = true; });
        u.addEventListener('input', function () { ing.unit = u.value.trim(); R.dirty = true; });
        it.addEventListener('input', function () { ing.item = it.value; R.dirty = true; });
        nt.addEventListener('input', function () { ing.note = nt.value; R.dirty = true; });
        it.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (i === x.ingredients.length - 1) { x.ingredients.push({ qty: null, unit: '', item: '', note: '' }); paintRows(); } var all = rows.querySelectorAll('[aria-label=Amount]'); var nx = all[Math.min(i + 1, all.length - 1)]; if (nx) nx.focus(); } });
        rows.appendChild(h('div', { cls: 'rc-erow' }, [q, u, it, nt, tools]));
      });
    }
    paintRows();
    var paste = h('textarea', { rows: '5', placeholder: 'Paste or type a list, one ingredient per line:\n2 cups heavy cream\n1 1/2 tbsp kosher salt\n3 cloves garlic, minced\nFor the garnish:' });
    var pasteBox = h('div', { cls: 'rc-paste', hidden: true }, [paste, h('div', { cls: 'rc-paste-a' }, [
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { pasteBox.hidden = true; } } }),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Add these ingredients', on: { click: function () {
        var got = paste.value.split('\n').map(parseLine).filter(Boolean);
        if (!got.length) return;
        x.ingredients = x.ingredients.filter(function (i) { return i.head || i.item || i.qty != null; }).concat(got);
        paste.value = ''; pasteBox.hidden = true; R.dirty = true; paintRows();
      } } })
    ])]);
    box.appendChild(h('section', { cls: 'rc-sec' }, [
      h('h3', { text: 'Ingredients' }), rows,
      h('div', { cls: 'rc-eadd' }, [
        h('button', { type: 'button', cls: 'ed-btn small', text: '+ Ingredient', on: { click: function () { x.ingredients.push({ qty: null, unit: '', item: '', note: '' }); paintRows(); var all = rows.querySelectorAll('[aria-label=Amount]'); all[all.length - 1].focus(); } } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: '+ Sub-heading', on: { click: function () { x.ingredients.push({ head: true, item: '' }); paintRows(); } } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Paste a list', on: { click: function () { pasteBox.hidden = false; paste.focus(); } } })
      ]),
      pasteBox
    ]));
    var method = h('textarea', { name: 'method', rows: '8', placeholder: 'One step per line. They’re numbered for you.' }); method.value = x.method || '';
    method.addEventListener('input', function () { R.dirty = true; });
    var notes = h('textarea', { name: 'notes', rows: '3', placeholder: 'Storage, shelf life, plating, substitutions…' }); notes.value = x.notes || '';
    notes.addEventListener('input', function () { R.dirty = true; });
    box.appendChild(h('section', { cls: 'rc-sec' }, [h('h3', { text: 'Method' }), method]));
    box.appendChild(h('section', { cls: 'rc-sec' }, [h('h3', { text: 'Notes' }), notes]));
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    box.appendChild(msg);
    box.appendChild(h('div', { cls: 'rc-efoot' }, [
      !x._new ? h('button', { type: 'button', cls: 'ed-btn small danger', text: 'Delete recipe', on: { click: del } }) : h('span'),
      h('span', { cls: 'sc-sp' }),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { if (R.dirty && !confirm('Discard your changes?')) return; R.edit = null; R.dirty = false; if (x._new) R.cur = null; render(); } } }),
      h('button', { type: 'submit', cls: 'ed-btn', text: 'Save recipe' })
    ]));
    function save() {
      var nm = name.value.trim();
      if (!nm) { msg.textContent = 'Give the recipe a name.'; name.focus(); return; }
      var yqv = yq.value.trim() ? parseQty(yq.value) : null;
      if (yq.value.trim() && yqv == null) { msg.textContent = 'Base yield should be a number, e.g. 4 or 1 1/2.'; yq.focus(); return; }
      var bad = x.ingredients.filter(function (i) { return !i.head && i.qty == null && i._raw; });
      var row = {
        id: x.id, name: nm, category: cat.value.trim(), yield_qty: yqv, yield_unit: yu.value.trim(), time: time.value.trim(), allergens: alg.value.trim(),
        ingredients: x.ingredients.filter(function (i) { return i.head ? (i.item || '').trim() : ((i.item || '').trim() || i.qty != null); }).map(function (i) {
          return i.head ? { head: true, item: i.item.trim() } : { qty: i.qty == null ? null : Math.round(i.qty * 10000) / 10000, unit: normUnit(i.unit), item: (i.item || '').trim(), note: (i.note || '').trim() };
        }),
        method: method.value.replace(/\s+$/, ''), notes: notes.value.replace(/\s+$/, ''), updated_by: (R.ctx && R.ctx.name) || ''
      };
      msg.textContent = 'Saving…';
      R.ctx.sb.from('recipes').upsert(row, { onConflict: 'id' }).then(function (r) {
        if (r.error) { msg.textContent = isPerm(r.error) ? 'Only the Owner and Managers can change recipes.' : 'Couldn’t save. Check your connection and try again.'; return; }
        row.updated_at = new Date().toISOString();
        var i = R.list.findIndex(function (y) { return y.id === row.id; });
        if (i === -1) R.list.push(row); else R.list[i] = row;
        R.list.sort(function (a, b) { return String(a.name).localeCompare(b.name); });
        R.edit = null; R.dirty = false; R.cur = row; R.factor = 1; R.target = null;
        status('Saved “' + nm + '”.', 'ok'); render();
      });
    }
    function del() {
      if (!confirm('Delete “' + (x.name || 'this recipe') + '”? This can’t be undone.')) return;
      R.ctx.sb.from('recipes').delete().eq('id', x.id).then(function (r) {
        if (r.error) { msg.textContent = isPerm(r.error) ? 'Only the Owner and Managers can delete recipes.' : 'Couldn’t delete. Try again.'; return; }
        R.list = R.list.filter(function (y) { return y.id !== x.id; }); R.edit = null; R.cur = null; R.dirty = false; status('Recipe deleted.', 'ok'); render();
      });
    }
    return box;
  }

  window.EdenRecipes = {
    show: function (ctx) {
      R.ctx = ctx; R.el = ctx.el;
      if (!R.loaded) { render(); load().then(render); } else render();
    },
    reload: function () { R.loaded = false; if (R.el) { render(); load().then(render); } },
    fromText: fromText,
    // show this recipe the next time the recipe book opens (or now, if it's open)
    focus: function (id) { R.pendingOpen = id; R.loaded = false; R.edit = null; if (R.el && !R.el.hidden && R.ctx && R.el.offsetParent !== null) { render(); load().then(render); } },
    _test: { parseQty: parseQty, parseLine: parseLine, smart: smart, fmtAmount: fmtAmount, R: R }
  };
})();
