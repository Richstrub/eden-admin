/* Eden staff site: inventory.
 *
 * Three inventories, each its own tab: Food, Paper goods, and Beverages (Beer, Wine, Liquor, N/A). Each has a list of
 * items (grouped by section, with unit, pack size, vendor, par and cost) and dated counts. Pick a count
 * date, type what's on hand, and it saves as you go; the last count, what to order (par minus on hand)
 * and the value on hand are worked out for you.
 *
 * Data: Supabase tables inventory_items and inventory_counts (supabase/inventory.sql).
 */
(function () {
  'use strict';
  var CATS = [
    { id: 'food', label: 'Food', short: 'Food' },
    { id: 'paper', label: 'Paper goods', short: 'Paper' },
    { id: 'bev', label: 'Beverages', short: 'Beverage' }
  ];
  // Beverages is split into Beer, Wine, Liquor and N/A (non-alcoholic) by each item's section
  var SUBS = [['all', 'All'], ['beer', 'Beer'], ['wine', 'Wine'], ['liquor', 'Liquor'], ['na', 'N/A']];
  var NA_RE = /soft|juice|soda|water|coffee|tea\b|n\/a|non.?alc|mocktail|kombucha|lemonade|tonic|ginger beer/i;
  // non-alcoholic by name too (coffee, tea, soda, juice, tonic, NA beer…), wherever it's filed
  var NA_NAME = /\b(coffee|espresso|decaf|tea|chai|matcha|oolong|soda|cola|coke|pepsi|sprite|ginger ale|ginger beer|tonic|club soda|seltzer|sparkling water|mineral water|water|juice|lemonade|limeade|kombucha|root beer|mocktail|non.?alcoholic|alcohol.?free|n\/a|na beer|zero proof|0\.0%?)\b/i;
  var BOOZE = /\b(gin|vodka|rum|whiske?y|bourbon|rye|tequila|mezcal|brandy|cognac|liqueur|amaro|vermouth|wine|ale|ipa|lager|stout|pils)\b/i;
  function subOf(it) {
    var s = String(it.section || '').toLowerCase(), nm = String(it.name || '') + ' ' + String(it.pack || '');
    if (NA_RE.test(s)) return 'na';
    if (NA_NAME.test(nm) && (!BOOZE.test(nm) || /non.?alcoholic|alcohol.?free|zero proof|\bna\b|0\.0/i.test(nm)) && !/coffee liqueur|tea.?infused/i.test(nm)) return 'na';
    if (/beer|draught|draft|cider|can(ned|s)?\b|keg/.test(s)) return 'beer';
    if (/wine|sparkling|ros[eé]|red|white|dessert|port|champagne|sake/.test(s)) return 'wine';
    return 'liquor';
  }
  var SECTIONS = {
    food: ['Produce', 'Protein', 'Seafood', 'Dairy & eggs', 'Dry goods', 'Spices', 'Oils & vinegars', 'Bread & bakery', 'Frozen', 'Menu ingredients'],
    paper: ['To-go', 'Front of house', 'Kitchen', 'Restroom', 'Cleaning'],
    bev: ['Draught beer', 'Canned beer', 'Sparkling wine', 'White wine', 'Rosé', 'Red wine', 'Dessert wine', 'Aperitif', 'Bourbon', 'Rye', 'Malt', 'Gin', 'Vodka', 'Agave', 'Rum', 'Specialty', 'Digestif', 'Liqueurs & mixers', 'Soft drinks & juice', 'Coffee & tea', 'Water']
  };
  var UNITS = ['each', 'case', 'lb', 'oz', 'gal', 'qt', 'bottle', 'keg', 'can', 'box', 'bag', 'roll', 'sleeve', 'pack', 'bunch', 'dozen'];
  var PAPER_STARTER = [
    ['To-go', 'To-go containers, small', 'case'], ['To-go', 'To-go containers, large', 'case'], ['To-go', 'Soup containers 16 oz with lids', 'case'],
    ['To-go', 'Portion cups 2 oz', 'sleeve'], ['To-go', 'Portion cup lids 2 oz', 'sleeve'], ['To-go', 'To-go bags', 'bundle'], ['To-go', 'Cutlery kits', 'case'],
    ['To-go', 'Hot cups 12 oz', 'sleeve'], ['To-go', 'Hot cup lids', 'sleeve'],
    ['Front of house', 'Dinner napkins', 'case'], ['Front of house', 'Cocktail napkins', 'case'], ['Front of house', 'Straws', 'box'],
    ['Front of house', 'Guest check pads', 'pack'], ['Front of house', 'Receipt paper rolls', 'case'], ['Front of house', 'Coasters', 'pack'],
    ['Kitchen', 'Plastic wrap', 'roll'], ['Kitchen', 'Aluminum foil', 'roll'], ['Kitchen', 'Parchment sheets', 'case'], ['Kitchen', 'Deli paper', 'box'],
    ['Kitchen', 'Gloves, medium', 'box'], ['Kitchen', 'Gloves, large', 'box'], ['Kitchen', 'Date labels', 'roll'],
    ['Restroom', 'Toilet paper', 'case'], ['Restroom', 'Paper towels', 'case'],
    ['Cleaning', 'Trash bags', 'case'], ['Cleaning', 'Sanitizer test strips', 'pack']
  ];
  var TEMPLATE = 'templates/eden-inventory.xlsx';
  var SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  var I = { ctx: null, el: null, cat: 'food', date: iso(new Date()), items: [], counts: [], loaded: false, loading: false, missing: false,
    saveT: null, saving: false, pending: false, filter: '', sub: 'all' };

  /* ---------- helpers ---------- */
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
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseDay(t) { var p = String(t || '').split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function dayLabel(t) { return parseDay(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); }
  function keyOf(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function num(v) { if (v === '' || v == null) return null; var n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isNaN(n) ? null : n; }
  function qty(n) { return n == null ? '' : String(Math.round(n * 100) / 100); }
  function money(n) { return '$' + (Math.round((n || 0) * 100) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function sb() { return I.ctx.sb; }
  function status(t, k) { if (I.ctx && I.ctx.status) I.ctx.status(t, k); }
  function catOf(id) { return CATS.filter(function (c) { return c.id === id; })[0]; }
  function isMissing(e) { return e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message || '')); }
  function isPerm(e) { return e && (e.code === '42501' || /row-level security|permission/i.test(e.message || '')); }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }

  function catItems() {
    var order = SECTIONS[I.cat] || [];
    return I.items.filter(function (it) { return it.category === I.cat && (I.cat !== 'bev' || !I.sub || I.sub === 'all' || subOf(it) === I.sub); }).sort(function (a, b) {
      var ia = order.indexOf(a.section), ib = order.indexOf(b.section);
      if (ia === -1) ia = 999; if (ib === -1) ib = 999;
      return ia - ib || String(a.section).localeCompare(b.section) || (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(b.name);
    });
  }
  function countRow() { return I.counts.filter(function (c) { return c.category === I.cat && c.count_date === I.date; })[0] || null; }
  function prevRow() {
    return I.counts.filter(function (c) { return c.category === I.cat && c.count_date < I.date && c.counts && Object.keys(c.counts).length; })
      .sort(function (a, b) { return a.count_date < b.count_date ? 1 : -1; })[0] || null;
  }
  function onHand(it) { var r = countRow(); return r && r.counts && r.counts[it.id] != null ? r.counts[it.id] : null; }

  /* ---------- data ---------- */
  function load() {
    I.loading = true;
    return Promise.all([
      sb().from('inventory_items').select('*').order('section').then(function (r) { if (r.error) throw r.error; return r.data || []; }),
      sb().from('inventory_counts').select('*').order('count_date', { ascending: false }).then(function (r) { if (r.error) throw r.error; return r.data || []; }),
      sb().from('inventory_items').select('order_unit,per_case').limit(1).then(function (r) { return !r.error; }, function () { return false; }),
      sb().from('inventory_items').select('menu_refs').limit(1).then(function (r) { return !r.error; }, function () { return false; }),
      sb().from('inventory_settings').select('*').eq('id', 1).maybeSingle().then(function (r) { return r.error ? null : r.data; }, function () { return null; }),
      sb().from('recipes').select('id,name,ingredients').order('name').then(function (r) { return r.error ? [] : r.data || []; }, function () { return []; }),
      sb().from('inventory_items').select('ingredient').limit(1).then(function (r) { return !r.error; }, function () { return false; })
    ]).then(function (res) {
      I.ingCol = res[6];
      I.recipes = res[5].map(function (x) { x.ingredients = Array.isArray(x.ingredients) ? x.ingredients : []; return x; });
      I.items = res[0]; I.counts = res[1]; I.orderCols = res[2]; I.costCols = res[3]; I.loaded = true; I.missing = false; I.loading = false;
      if (res[4] && window.EdenCosting) window.EdenCosting.setSettings(res[4]);
      // soft drinks, juice, coffee and tea moved from Food to Beverages → N/A
      var move = I.items.filter(function (it) { return it.category === 'food' && NA_RE.test(String(it.section || '')); });
      if (move.length) { move.forEach(function (it) { it.category = 'bev'; }); saveItems(move).then(function () { status('Moved ' + move.length + ' soft drink, juice, coffee and tea item' + (move.length === 1 ? '' : 's') + ' to Beverages → N/A.', 'ok'); }, function () {}); }
      I.settingsOn = !!res[4];
      loadAlerts();
    }, function (e) {
      I.loading = false; I.loaded = true;
      if (isMissing(e)) I.missing = true;
      else status(isPerm(e) ? 'Your role can’t open the inventory.' : 'Couldn’t load the inventory. Check your connection and reload.', 'err');
    });
  }
  function saveItems(list) {
    return sb().from('inventory_items').upsert(list.map(function (it) {
      var row = { id: it.id, category: it.category, section: it.section || '', name: it.name, unit: it.unit || '', pack: it.pack || '', vendor: it.vendor || '', par: it.par, cost: it.cost, sort: it.sort || 0, active: it.active !== false };
      if (I.orderCols) { row.order_unit = it.order_unit || ''; row.per_case = it.per_case == null || it.per_case === '' ? null : +it.per_case; }   // supabase/invoice-vendors.sql
      if (I.costCols) row.menu_refs = Array.isArray(it.menu_refs) ? it.menu_refs : [];   // supabase/inventory-costing.sql
      if (I.ingCol) row.ingredient = it.ingredient || '';   // supabase/ingredient-name.sql
      return row;
    }), { onConflict: 'id' }).then(function (r) { if (r.error) throw r.error; });
  }
  function saveErr(e) { status(isPerm(e) ? 'Your role can’t change the inventory.' : 'Couldn’t save. Check your connection; your changes are kept here and will retry.', 'err'); }

  function scheduleCountSave() {
    I.pending = true; status('Saving count…', 'dirty');
    clearTimeout(I.saveT); I.saveT = setTimeout(saveCount, 600);
  }
  function saveCount() {
    if (I.saving) { I.saveT = setTimeout(saveCount, 300); return; }
    var r = countRow(); if (!r) return;
    I.saving = true; I.pending = false;
    sb().from('inventory_counts').upsert({ id: r.id, category: r.category, count_date: r.count_date, counts: r.counts, counted_by: r.counted_by || '' }, { onConflict: 'id' }).then(function (res) {
      I.saving = false;
      if (res.error) { I.pending = true; saveErr(res.error); clearTimeout(I.saveT); I.saveT = setTimeout(saveCount, 4000); return; }
      if (!I.pending) status('Count saved.', 'ok');
    });
  }
  function setCount(it, v) {
    var r = countRow();
    if (!r) { r = { id: I.cat + ':' + I.date, category: I.cat, count_date: I.date, counts: {}, counted_by: I.ctx.name || '' }; I.counts.push(r); }
    if (v == null) delete r.counts[it.id]; else r.counts[it.id] = v;
    r.counted_by = I.ctx.name || r.counted_by || '';
    scheduleCountSave();
  }

  /* ---------- rendering ---------- */
  function render() {
    var el = I.el; if (!el) return;
    var keep = document.activeElement && el.contains(document.activeElement) && document.activeElement.getAttribute('data-oh');
    el.innerHTML = '';
    var wrap = h('div', { cls: 'iv-in' }); el.appendChild(wrap);
    if (!I.loaded) { wrap.appendChild(h('p', { cls: 'sc-empty', text: 'Loading the inventory…' })); return; }
    if (I.missing) {
      wrap.appendChild(h('div', { cls: 'iv-setup' }, [
        h('p', { cls: 'sc-eyebrow', text: 'One-time setup' }), h('h1', { cls: 'sc-week', text: 'Inventory' }),
        h('p', { text: 'The inventory tables aren’t in Supabase yet. In Supabase, open SQL Editor → New query, paste the contents of supabase/inventory.sql from the eden-admin repository, and click Run. Then reload this page.' })
      ]));
      return;
    }
    var cat = catOf(I.cat), items = catItems();
    var counts = {}; CATS.forEach(function (c) { counts[c.id] = I.items.filter(function (it) { return it.category === c.id; }).length; });

    // title, tabs, tools
    var date = h('input', { type: 'date', value: I.date, 'aria-label': 'Count date' });
    date.addEventListener('change', function () { if (date.value) { flush(); I.date = date.value; render(); } });
    wrap.appendChild(h('div', { cls: 'iv-titlebar' }, [
      h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Inventory' }), h('h1', { cls: 'sc-week', text: cat.label })]),
      h('div', { cls: 'iv-tools' }, [
        h('label', { cls: 'sc-f iv-date' }, [h('span', { text: 'Count date' }), date]),
        window.EdenInvoiceScan ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Scan invoice', title: 'Put an invoice’s prices into the inventory', on: { click: scanInvoice } }) : null,
        window.EdenInvoiceScan && window.EdenInvoiceScan.vendors ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Vendors', title: 'Spending and delivery charges by vendor, from scanned invoices', on: { click: function () { window.EdenInvoiceScan.vendors(scanApi()); } } }) : null,
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Order list', on: { click: orderList } }),
        h('button', { type: 'button', cls: 'ed-btn small pr-accent', text: 'Enter monthly count', title: 'Type in the month’s count for Food, Paper goods and Beverages, then see the report', on: { click: monthlyStart } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Reports', title: 'A report for every inventory count', on: { click: reportsList } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Print count sheet', title: 'A blank sheet to count on, for Food, Paper goods and Beverages', on: { click: countSheet } }),
        h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Print this page', on: { click: function () { window.print(); } } }),
        h('button', { type: 'button', cls: 'ed-btn', text: 'Add item', on: { click: function () { editItem(null); } } })
      ])
    ]));
    if (window.EdenInvoiceScan && window.EdenInvoiceScan.bar) wrap.appendChild(window.EdenInvoiceScan.bar(scanApi()));
    var alerts = alertsCard(); if (alerts) wrap.appendChild(alerts);
    wrap.appendChild(pricingPanel());
    wrap.appendChild(h('div', { cls: 'sc-tabs iv-tabs', role: 'tablist' }, CATS.map(function (c) {
      return h('button', { type: 'button', role: 'tab', 'aria-selected': c.id === I.cat ? 'true' : 'false', 'data-cat': c.id, on: { click: function () { if (c.id !== I.cat) { flush(); I.cat = c.id; I.filter = ''; render(); } } } },
        [c.label, counts[c.id] ? h('span', { cls: 'sc-count', text: String(counts[c.id]) }) : null]);
    })));
    if (I.cat === 'bev') {
      var bevAll = I.items.filter(function (it) { return it.category === 'bev'; });
      wrap.appendChild(h('div', { cls: 'iv-subtabs', role: 'tablist', 'aria-label': 'Beverages' }, SUBS.map(function (x) {
        var n = x[0] === 'all' ? bevAll.length : bevAll.filter(function (it) { return subOf(it) === x[0]; }).length;
        return h('button', { type: 'button', role: 'tab', 'aria-selected': (I.sub || 'all') === x[0] ? 'true' : 'false', on: { click: function () { if (I.sub !== x[0]) { flush(); I.sub = x[0]; I.filter = ''; render(); } } } },
          [x[1], h('span', { text: String(n) })]);
      })));
    }

    // summary
    var cur = countRow(), prev = prevRow(), value = 0, counted = 0, prevValue = 0, below = 0;
    items.forEach(function (it) {
      var oh = onHand(it); if (oh != null) { counted++; value += oh * (it.cost || 0); if (it.par != null && oh < it.par) below++; }
      if (prev && prev.counts[it.id] != null) prevValue += prev.counts[it.id] * (it.cost || 0);
    });
    wrap.appendChild(h('div', { cls: 'iv-summary' }, [
      stat('Counted', items.length ? counted + ' of ' + items.length : '–'),
      stat('Value on hand', money(value)),
      stat('Below par', String(below)),
      stat('Last count', prev ? dayLabel(prev.count_date).replace(/, \d{4}$/, '') + ' · ' + money(prevValue) : 'None yet'),
      cur && cur.counted_by ? stat('Counted by', cur.counted_by) : null
    ]));

    if (!items.length) { wrap.appendChild(emptyState()); return; }

    // search
    var find = h('input', { type: 'search', cls: 'iv-find', placeholder: 'Find an item or vendor…', value: I.filter, 'aria-label': 'Find an item' });
    find.addEventListener('input', function () { I.filter = find.value; applyFilter(); });
    var vlist = uniq(items.map(function (x) { return x.vendor; })).sort(function (a, b) { return a.localeCompare(b); });
    if (I.vendor && vlist.indexOf(I.vendor) === -1 && I.vendor !== '__none') I.vendor = '';
    var vsel = h('select', { cls: 'iv-vsel', 'aria-label': 'Vendor' }, [h('option', { value: '', text: 'All vendors' })].concat(vlist.map(function (v) { return h('option', { value: v, text: v }); }), [h('option', { value: '__none', text: 'No vendor set' })]));
    vsel.value = I.vendor || '';
    vsel.addEventListener('change', function () { I.vendor = vsel.value; applyFilter(); });
    wrap.appendChild(h('div', { cls: 'iv-bar' }, [find, vsel, h('span', { cls: 'iv-hint', text: 'Type the amount on hand; Enter jumps to the next item. Counts save automatically.' })]));

    // the count sheet
    I.menuList = window.EdenCosting ? window.EdenCosting.menuList(menu()) : [];
    I.showCost = !!window.EdenCosting && items.some(function (it) { return window.EdenCosting.linksFor(it, I.menuList).length; });
    var ncol = (I.showCost ? 13 : 11) + (I.cat === 'food' ? 1 : 0);
    var table = h('table', { cls: 'iv-table' + (I.showCost ? ' iv-wide' : '') });
    table.appendChild(h('thead', null, h('tr', null, [
      h('th', { cls: 'iv-name', text: 'Item' }), h('th', { cls: 'iv-vend', text: 'Vendor' }), h('th', { cls: 'iv-rcv', text: 'Received in' }), h('th', { text: 'Counted in' }), I.cat === 'food' ? h('th', { cls: 'iv-rec', text: 'Ingredient name' }) : null, h('th', { cls: 'r', text: 'Par' }), h('th', { cls: 'r', text: 'Last' }),
      h('th', { cls: 'r iv-ohh', text: 'On hand' }), h('th', { cls: 'r', text: 'Order' }), h('th', { cls: 'r', text: 'Cost' }),
      I.showCost ? h('th', { cls: 'iv-menu', text: 'Menu price' }) : null, I.showCost ? h('th', { cls: 'iv-pct', text: 'Cost %', title: 'Cost per serving ÷ menu price. Wine by the glass: ' + window.EdenCosting.settings.glass_oz + ' oz pour; spirits: ' + window.EdenCosting.settings.pour_oz + ' oz pour' }) : null,
      h('th', { cls: 'r', text: 'Value' }), h('th', { cls: 'iv-tool' })
    ])));
    var lastSec = null, tb = null;
    items.forEach(function (it) {
      if (it.section !== lastSec) {
        lastSec = it.section;
        tb = h('tbody', { cls: 'iv-group' });
        var secItems = items.filter(function (x) { return x.section === it.section; });
        tb.appendChild(h('tr', { cls: 'iv-sec' }, h('td', { colspan: String(ncol) }, [h('b', { text: it.section || 'Other' }), h('span', { text: secItems.length + ' item' + (secItems.length === 1 ? '' : 's') })])));
        table.appendChild(tb);
      }
      tb.appendChild(itemRow(it, prev));
    });
    var foot = h('tfoot', null, h('tr', null, [h('td', { colspan: String(ncol - 2), text: 'Total value on hand' }), h('td', { cls: 'r', id: 'ivTotal', text: money(value) }), h('td')]));
    table.appendChild(foot);
    wrap.appendChild(h('div', { cls: 'sc-scroll iv-scroll' }, table));
    wrap.appendChild(h('div', { cls: 'iv-more' }, moreTools()));
    // print header (only shows when printing)
    wrap.insertBefore(h('div', { cls: 'iv-printhead' }, [h('b', { text: 'EDEN · ' + cat.label + ' inventory' }), h('span', { text: dayLabel(I.date) + (cur && cur.counted_by ? ' · counted by ' + cur.counted_by : '') })]), wrap.firstChild);
    applyFilter();
    if (keep) { var again = el.querySelector('[data-oh="' + keep + '"]'); if (again) again.focus(); }
  }
  function stat(k, v) { return h('div', { cls: 'iv-stat' }, [h('span', { text: k }), h('b', { text: v })]); }

  function itemRow(it, prev) {
    var oh = onHand(it), last = prev && prev.counts[it.id] != null ? prev.counts[it.id] : null;
    var inp = h('input', { type: 'text', inputmode: 'decimal', cls: 'iv-oh', value: qty(oh), 'data-oh': it.id, 'aria-label': 'On hand: ' + it.name, autocomplete: 'off' });
    var order = h('td', { cls: 'r iv-order' }), val = h('td', { cls: 'r iv-val' });
    function refresh() {
      var v = onHand(it);
      var need = it.par != null && v != null ? Math.max(0, it.par - v) : null;
      order.textContent = need ? qty(need) : (v != null && it.par != null ? '–' : '');
      order.classList.toggle('need', !!need);
      val.textContent = v != null && it.cost != null ? money(v * it.cost) : '';
    }
    inp.addEventListener('input', function () {
      var v = inp.value.trim() === '' ? null : num(inp.value);
      inp.classList.toggle('bad', inp.value.trim() !== '' && v == null);
      if (inp.value.trim() !== '' && v == null) return;
      setCount(it, v); refresh(); totals();
    });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || (e.key === 'ArrowDown') || (e.key === 'ArrowUp')) {
        e.preventDefault();
        var all = [].slice.call(I.el.querySelectorAll('.iv-oh')).filter(function (x) { return x.closest('tr').style.display !== 'none'; });
        var i = all.indexOf(inp) + (e.key === 'ArrowUp' ? -1 : 1);
        if (all[i]) { all[i].focus(); all[i].select(); }
      }
    });
    inp.addEventListener('focus', function () { inp.select(); });
    var cc = I.showCost ? window.EdenCosting.cells(it, I.menuList) : null;
    var tip = cc ? cc.sv.map(function (x) { return x.label + ': ' + window.EdenCosting.money(x.price) + ' on the menu, costs ' + (x.cost != null ? money(x.cost) : '? (no cost yet)') + ' = ' + window.EdenCosting.pctText(x.pct); }).join('\n') : '';
    var tr = h('tr', { cls: 'iv-row', 'data-name': keyOf(it.name + ' ' + it.vendor + ' ' + it.pack), 'data-vendor': it.vendor || '' }, [
      h('td', { cls: 'iv-name' }, [h('button', { type: 'button', cls: 'iv-namebtn', title: 'Edit item', text: it.name, on: { click: function () { editItem(it); } } }),
        it.pack ? h('small', { text: it.pack }) : null]),
      h('td', { cls: 'iv-vend', text: it.vendor || '' }),
      h('td', { cls: 'iv-unit iv-rcv', text: rcvText(it) }),
      h('td', { cls: 'iv-unit', text: it.unit || '' }),
      I.cat === 'food' ? h('td', { cls: 'iv-rec', title: recipesFor(it.id).map(function (x) { return x.name; }).join(', ') ? 'Used in: ' + recipesFor(it.id).map(function (x) { return x.name; }).join(', ') : 'Not in a recipe yet' }, it.ingredient ? h('span', { text: it.ingredient }) : h('span', { cls: 'iv-none', text: '—' })) : null,
      h('td', { cls: 'r', text: qty(it.par) }),
      h('td', { cls: 'r iv-last', text: qty(last) }),
      h('td', { cls: 'r iv-ohc' }, inp),
      order,
      h('td', { cls: 'r iv-cost', text: it.cost != null ? money(it.cost) : '' }),
      I.showCost ? h('td', { cls: 'iv-menu', title: tip, text: cc ? cc.menu : '' }) : null,
      I.showCost ? h('td', { cls: 'iv-pct' + (cc && cc.worst >= 0.35 ? ' hi' : ''), title: tip, text: cc ? cc.pct : '' }) : null,
      val,
      h('td', { cls: 'iv-tool' }, h('button', { type: 'button', cls: 'iv-edit', 'aria-label': 'Edit ' + it.name, title: 'Edit item', text: '✎', on: { click: function () { editItem(it); } } }))
    ]);
    refresh();
    return tr;
  }
  function totals() {
    var value = 0, counted = 0, below = 0, items = catItems();
    items.forEach(function (it) { var oh = onHand(it); if (oh != null) { counted++; value += oh * (it.cost || 0); if (it.par != null && oh < it.par) below++; } });
    var t = I.el.querySelector('#ivTotal'); if (t) t.textContent = money(value);
    var st = I.el.querySelectorAll('.iv-stat b');
    if (st[0]) st[0].textContent = counted + ' of ' + items.length;
    if (st[1]) st[1].textContent = money(value);
    if (st[2]) st[2].textContent = String(below);
  }
  function applyFilter() {
    var f = keyOf(I.filter);
    I.el.querySelectorAll('.iv-group').forEach(function (g) {
      var any = false;
      g.querySelectorAll('.iv-row').forEach(function (r) {
        var v = r.getAttribute('data-vendor') || '';
        var show = (!f || r.getAttribute('data-name').indexOf(f) !== -1) && (!I.vendor || (I.vendor === '__none' ? !v : v === I.vendor));
        r.style.display = show ? '' : 'none'; if (show) any = true;
      });
      g.style.display = any ? '' : 'none';
    });
  }
  function flush() { if (I.pending) { clearTimeout(I.saveT); saveCount(); } }

  function emptyState() {
    var box = h('div', { cls: 'iv-empty' }, [
      h('h2', { text: 'No ' + catOf(I.cat).label.toLowerCase() + ' items yet' }),
      h('p', { text: I.cat === 'bev' ? 'Start from the menu: every wine, beer and spirit on it becomes an item, grouped by type. Then add pars and costs.'
        : I.cat === 'food' ? 'Add items one at a time, import a spreadsheet, or start from the menu: the ingredients named on the Kitchen menu, plus the coffee, tea, juice and soda on the drinks menu.'
        : 'Start with a list of common paper goods (to-go, front of house, kitchen, restroom, cleaning) and edit it to match what you buy.' })
    ]);
    box.appendChild(h('div', { cls: 'iv-empty-a' }, moreTools(true)));
    return box;
  }
  function moreTools(big) {
    var cls = big ? 'ed-btn' : 'ed-btn small';
    return [
      I.cat === 'bev' ? h('button', { type: 'button', cls: cls, text: 'Add wines, beers & spirits from the menu', on: { click: fromMenuBev } }) : null,
      I.cat === 'food' ? h('button', { type: 'button', cls: cls, text: 'Add ingredients from the menu (coffee & soft drinks go to Beverages)', on: { click: fromMenuFood } }) : null,
      I.cat === 'paper' ? h('button', { type: 'button', cls: cls, text: 'Add common paper goods', on: { click: paperStarter } }) : null,
      h('label', { cls: 'ed-btn small sc-file' }, ['Import spreadsheet', h('input', { type: 'file', accept: '.xlsx,.xls,.csv', on: { change: function (ev) { var f = ev.target.files[0]; ev.target.value = ''; if (f) importFile(f); } } })]),
      window.EdenCosting && I.settingsOn ? h('button', { type: 'button', cls: cls, text: 'Pour sizes (' + window.EdenCosting.settings.glass_oz + ' oz wine · ' + window.EdenCosting.settings.pour_oz + ' oz spirits)', on: { click: pourSizes } }) : null,
      h('a', { cls: 'sc-link', href: TEMPLATE, download: 'eden-inventory.xlsx', text: 'Download the inventory spreadsheet' })
    ];
  }

  /* ---------- adding items in bulk ---------- */
  function addMany(list, what) {
    var have = {}; I.items.forEach(function (it) { have[it.category + '|' + keyOf(it.name)] = 1; });
    var fresh = list.filter(function (it) { var k = (it.category || I.cat) + '|' + keyOf(it.name); if (!keyOf(it.name) || have[k]) return false; have[k] = 1; return true; });
    if (!fresh.length) { status('Nothing new to add: those items are already on the list.', 'ok'); return Promise.resolve(); }
    fresh.forEach(function (it, i) { it.id = uid(); it.category = it.category || I.cat; it.sort = i; it.par = it.par == null ? null : it.par; it.cost = it.cost == null ? null : it.cost; });
    status('Adding ' + fresh.length + ' items…', 'dirty');
    return saveItems(fresh).then(function () {
      I.items = I.items.concat(fresh); status('Added ' + fresh.length + ' ' + what + '.', 'ok'); render();
    }, saveErr);
  }
  function menu() { return (I.ctx.getMenu && I.ctx.getMenu()) || window.EDEN_MENU_SEED || { tabs: [] }; }
  function shown(it) { return !it.hidden && it.name; }
  function fromMenuBev() {
    var out = [], tabs = menu().tabs || [];
    var WINE = { sparkling: 'Sparkling wine', white: 'White wine', 'rosé': 'Rosé', rose: 'Rosé', red: 'Red wine', dessert: 'Dessert wine' };
    tabs.forEach(function (t) {
      var lab = String(t.label || '').toLowerCase();
      (t.groups || []).forEach(function (g) {
        var gt = String(g.title || '').trim(), gl = gt.toLowerCase();
        (g.items || []).filter(shown).forEach(function (it) {
          if (/wine/.test(lab) || t.id === 'm-wine') {
            var small = /375/.test(it.bottle || '') ? '375ml' : /1\.5|magnum/i.test(it.bottle || '') ? '1.5L' : '750ml';
            out.push({ section: WINE[gl] || (gt + ' wine'), name: it.name, unit: 'bottle', pack: small, vendor: '' });
          } else if (/beer/.test(lab) || t.id === 'm-beer') {
            if (/draught|draft|tap/.test(gl)) out.push({ section: 'Draught beer', name: it.name, unit: 'keg', pack: it.desc || '', vendor: '' });
            else if (/can|bottle/.test(gl)) out.push({ section: 'Canned beer', name: it.name, unit: 'case', pack: it.desc || '', vendor: '' });
          } else if (/spirit|liquor/.test(lab) || t.id === 'm-spirits') {
            out.push({ section: gt, name: it.name, unit: 'bottle', pack: it.desc || '', vendor: '' });
          } else if ((/cocktail|bar/.test(lab) || t.id === 'm-bar') && /aperitif|amaro|liqueur/.test(gl)) {
            out.push({ section: 'Aperitif', name: it.name, unit: 'bottle', pack: it.desc || '', vendor: '' });
          }
        });
      });
    });
    addMany(out, 'wines, beers and spirits from the menu');
  }
  function fromMenuFood() {
    var P = window.EdenPrep && window.EdenPrep._test, out = [], tabs = menu().tabs || [];
    var kitchen = tabs.filter(function (t) { return t.id === 'm-food' || /kitchen|food/i.test(t.label || ''); })[0];
    if (!kitchen || !P) { status('Couldn’t read the Kitchen menu.', 'err'); return; }
    (kitchen.groups || []).forEach(function (g) {
      (g.items || []).filter(shown).forEach(function (it) {
        P.titleParts(it.name).forEach(function (t) { out.push({ section: 'Menu ingredients', name: t.label, unit: '', pack: '', vendor: '' }); });
        P.splitParts(it.desc).forEach(function (p) { out.push({ section: 'Menu ingredients', name: p, unit: '', pack: '', vendor: '' }); });
      });
    });
    // coffee & tea and soft drinks / juice from the drinks menu
    tabs.forEach(function (t) {
      var lab = String(t.label || '').toLowerCase();
      (t.groups || []).forEach(function (g) {
        var gl = String(g.title || '').toLowerCase();
        var sec = (t.id === 'm-coffee' || /coffee|tea/.test(lab)) ? 'Coffee & tea' : ((t.id === 'm-beer' || /beer|soft/.test(lab)) && /juice|soda|soft|water/.test(gl)) ? 'Soft drinks & juice' : null;
        if (sec) (g.items || []).filter(shown).forEach(function (it) { out.push({ category: 'bev', section: sec, name: it.name, unit: sec === 'Coffee & tea' ? 'bag' : 'case', pack: it.desc || '', vendor: '' }); });
      });
    });
    addMany(out, 'items from the menu (kitchen ingredients go in “Menu ingredients”; coffee, tea and soft drinks go in Beverages → N/A)');
  }
  function paperStarter() { addMany(PAPER_STARTER.map(function (r) { return { section: r[0], name: r[1], unit: r[2], pack: '', vendor: '' }; }), 'common paper goods'); }

  /* ---------- spreadsheet import: Section, Item, Unit, Pack size, Vendor, Par, Cost ---------- */
  function importFile(file) {
    status('Reading ' + file.name + '…');
    var isCsv = /\.csv$/i.test(file.name);
    var rowsP = isCsv ? file.text().then(parseCsv) : (window.XLSX ? Promise.resolve() : loadScript(SHEETJS)).then(function () {
      return file.arrayBuffer().then(function (buf) {
        var wb = window.XLSX.read(buf, { type: 'array' });
        var want = I.cat === 'food' ? /food/i : I.cat === 'paper' ? /paper/i : /beer|wine|liquor|bev|bar/i;
        var name = wb.SheetNames.filter(function (n) { return want.test(n); })[0] || wb.SheetNames[0];
        return window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
      });
    });
    rowsP.then(function (rows) {
      var hi = -1, col = {};
      for (var i = 0; i < Math.min(rows.length, 15) && hi < 0; i++) {
        var r = rows[i].map(function (c) { return String(c).toLowerCase().trim(); });
        var n = r.findIndex(function (c) { return /^(item|item name|name|product|description)\*?$/.test(c); });
        if (n >= 0) {
          hi = i; col.name = n;
          col.section = r.findIndex(function (c) { return /^(section|category|type|area)$/.test(c); });
          col.unit = r.findIndex(function (c) { return /^(unit|count unit|uom|counted in)/.test(c); });
          col.pack = r.findIndex(function (c) { return /pack|size/.test(c); });
          col.vendor = r.findIndex(function (c) { return /vendor|supplier|distributor/.test(c); });
          col.par = r.findIndex(function (c) { return /^par/.test(c); });
          col.cost = r.findIndex(function (c) { return /cost|price/.test(c); });
        }
      }
      if (hi < 0) { status('Couldn’t find an “Item” column in that file. Use the Eden inventory spreadsheet.', 'err'); return; }
      var get = function (r, k) { return col[k] >= 0 ? String(r[col[k]] || '').trim() : ''; };
      var add = [], upd = [];
      rows.slice(hi + 1).forEach(function (r) {
        var name = get(r, 'name'); if (!name || /^example/i.test(name)) return;
        var data = { section: get(r, 'section'), name: name, unit: get(r, 'unit'), pack: get(r, 'pack'), vendor: get(r, 'vendor'), par: num(get(r, 'par')), cost: num(get(r, 'cost')) };
        var hit = I.items.filter(function (x) { return x.category === I.cat && keyOf(x.name) === keyOf(name); })[0];
        if (hit) { Object.keys(data).forEach(function (k) { if (data[k] !== '' && data[k] != null) hit[k] = data[k]; }); upd.push(hit); }
        else add.push(data);
      });
      if (!add.length && !upd.length) { status('No items found in that file.', 'err'); return; }
      var p = upd.length ? saveItems(upd) : Promise.resolve();
      return p.then(function () { return add.length ? addMany(add, 'items from ' + file.name) : (render(), status('Updated ' + upd.length + ' items from ' + file.name + '.', 'ok')); }, saveErr);
    }).catch(function () { status('Couldn’t read that file. Save it as .xlsx or .csv and try again.', 'err'); });
  }
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }

  /* ---------- food → recipes: an item is linked when a recipe ingredient is costed from it (Recipes → Costed from) ---------- */
  function recipesFor(id) { return (I.recipes || []).filter(function (x) { return x.ingredients.some(function (g) { return g.inv_id === id; }); }); }
  function scanApi() { return { recipes: I.recipes || [], recipesFor: recipesFor, ingCol: I.ingCol, ingNames: ingNames, sections: function (cat) { return uniq((SECTIONS[cat] || []).concat(I.items.filter(function (x) { return x.category === cat; }).map(function (x) { return x.section; }))); }, items: I.items, saveItems: saveItems, sb: sb(), status: status, done: function () { render(); loadAlerts().then(render); }, modal: modal, h: h, cat: I.cat, uid: uid, orderCols: I.orderCols }; }
  function rcvText(it) {   // "case (5 lb)", "bottle", or blank when it comes in the way it's counted
    var r = it.order_unit || '';
    if (!r || r === it.unit) return r ? r : '';
    return r + (+it.per_case && it.unit && !(r === 'bottle' && /^(case|cs)s?$/i.test(it.unit)) ? ' (' + qty(+it.per_case) + ' ' + it.unit + ')' : '');
  }
  function orderedBy(it) {   // "by the case of 6", "by the bottle"
    if (!it.order_unit) return '';
    return 'by the ' + it.order_unit + (it.order_unit === 'case' && it.per_case ? ' of ' + qty(+it.per_case) : '');
  }
  function scanInvoice() { flush(); window.EdenInvoiceScan.open(scanApi()); }

  /* ---------- pricing coverage: how many items have a cost and a menu price, by category; items not on the menu ---------- */
  var GROUPS = [['food', 'Food'], ['paper', 'Paper goods'], ['beer', 'Beer'], ['wine', 'Wine'], ['liquor', 'Liquor'], ['na', 'N/A']];
  function groupOf(it) { return it.category === 'bev' ? subOf(it) : it.category; }
  function sellable(g) { return g === 'beer' || g === 'wine' || g === 'liquor' || g === 'na'; }
  function menuText() {   // every word on the menu, for checking kitchen ingredients against it
    if (I._mt && I._mtAt === I.menuStamp) return I._mt;
    var t = [];
    ((menu() || {}).tabs || []).forEach(function (tab) { (tab.groups || []).forEach(function (g) { t.push(g.title || '', g.note || '', g.noteAfter || ''); (g.items || []).forEach(function (m) { if (!m.hidden) t.push(m.name || '', m.desc || ''); }); }); });
    I._mt = ' ' + t.join(' ').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ') + ' '; I._mtAt = I.menuStamp;
    return I._mt;
  }
  function onMenu(it, list) {
    if (it.category === 'paper') return null;   // not sold
    if (it.category === 'bev' && window.EdenCosting && window.EdenCosting.linksFor(it, list).length) return true;   // sold as a glass, bottle, pour…
    var n = ' ' + String(it.name || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim() + ' ';
    if (n.trim().length < 3) return false;
    var mt = menuText(); if (mt.indexOf(n) !== -1) return true;
    var sing = n.replace(/(es|s) $/, ' '); return mt.indexOf(sing) !== -1;
  }
  function hasMenuPrice(it, list) { if (!window.EdenCosting) return false; var sv = window.EdenCosting.servings(it, list); return sv.some(function (x) { return x.price; }); }
  function pricingPanel() {
    var list = window.EdenCosting ? window.EdenCosting.menuList(menu()) : [];
    var items = I.items.filter(function (it) { return it.active !== false; });
    var rows = GROUPS.map(function (g) {
      var xs = items.filter(function (it) { return groupOf(it) === g[0]; });
      var cost = xs.filter(function (it) { return it.cost != null && it.cost !== ''; }).length;
      var menuP = sellable(g[0]) ? xs.filter(function (it) { return hasMenuPrice(it, list); }).length : null;
      return { id: g[0], label: g[1], n: xs.length, cost: cost, menu: menuP };
    }).filter(function (r) { return r.n; });
    var tot = rows.reduce(function (a, r) { return a + r.n; }, 0), withCost = rows.reduce(function (a, r) { return a + r.cost; }, 0);
    var bevN = rows.filter(function (r) { return r.menu != null; }).reduce(function (a, r) { return a + r.n; }, 0), withMenu = rows.reduce(function (a, r) { return a + (r.menu || 0); }, 0);
    var pct = function (a, b) { return b ? Math.round(a / b * 100) : 0; };
    var off = items.filter(function (it) { return it.category === 'bev' && onMenu(it, list) === false; });   // drinks only: food goes into dishes, not onto the menu by name
    var box = function (label, a, b, sub) { return h('div', { cls: 'iv-pbox' }, [h('span', { text: label }), h('b', { text: a + ' of ' + b }), h('small', { text: pct(a, b) + '%' + (sub ? ' · ' + sub : '') })]); };
    var bar = function (v, n, kind) {
      if (v == null) return h('div', { cls: 'iv-pbar none' }, [h('i'), h('em', { text: '—' })]);
      var p = pct(v, n);
      return h('div', { cls: 'iv-pbar ' + kind, title: v + ' of ' + n + ' (' + p + '%)' }, [h('i', null, h('b', { style: 'width:' + p + '%' })), h('em', { text: p + '%' })]);
    };
    var open = I.pricingOpen !== false;
    var body = h('div', { cls: 'iv-pbody', hidden: !open }, [
      h('div', { cls: 'iv-pboxes' }, [box('Items with a cost', withCost, tot, 'from invoices or typed in'), box('Beverages with a menu price', withMenu, bevN, 'matched to the menu')]),
      h('div', { cls: 'iv-pchart', role: 'table', 'aria-label': 'Percent of items priced, by category' }, [
        h('div', { cls: 'iv-plegend' }, [h('span', { cls: 'k cost', text: 'Has a cost' }), h('span', { cls: 'k menu', text: 'Has a menu price' })]),
      ].concat(rows.map(function (r) {
        return h('div', { cls: 'iv-prow', role: 'row' }, [h('span', { cls: 'iv-plabel', role: 'rowheader', text: r.label }), h('span', { cls: 'iv-pn', text: r.n + (r.n === 1 ? ' item' : ' items') }),
          h('div', { cls: 'iv-pbars' }, [bar(r.cost, r.n, 'cost'), bar(r.menu, r.n, 'menu')])]);
      }))),
      off.length ? h('p', { cls: 'iv-poff' }, h('button', { type: 'button', cls: 'sc-link', text: off.length + (off.length === 1 ? ' beverage in the inventory isn’t' : ' beverages in the inventory aren’t') + ' on the menu →', on: { click: function () { notOnMenu(off); } } })) : h('p', { cls: 'iv-poff', text: 'Every beverage in the inventory is on the menu.' })
    ]);
    var tog = h('button', { type: 'button', cls: 'ed-btn small', text: open ? 'Hide' : 'Show', on: { click: function () { I.pricingOpen = body.hidden; body.hidden = !body.hidden; tog.textContent = body.hidden ? 'Show' : 'Hide'; } } });
    return h('div', { cls: 'is-bar iv-pricing' }, [h('div', { cls: 'is-bar-h' }, [h('div', null, [h('b', { text: 'Pricing' }), h('span', { text: pct(withCost, tot) + '% of items have a cost · ' + pct(withMenu, bevN) + '% of beverages have a menu price' })]), tog]), body]);
  }
  function notOnMenu(off) {
    var byG = {}; off.forEach(function (it) { (byG[groupOf(it)] = byG[groupOf(it)] || []).push(it); });
    var text = ['Eden inventory items not on the menu'];
    var body = [h('p', { cls: 'sc-sub', text: 'Beverages in the inventory that aren’t matched to anything on the menu. Click one to edit it (link it to a menu item, or mark it inactive). Food and paper goods aren’t listed: food goes into dishes, and paper goods aren’t sold.' })];
    GROUPS.forEach(function (g) {
      var xs = (byG[g[0]] || []).sort(function (a, b) { return String(a.name).localeCompare(b.name); }); if (!xs.length) return;
      text.push('', g[1].toUpperCase()); xs.forEach(function (it) { text.push('• ' + it.name + (it.vendor ? ' (' + it.vendor + ')' : '')); });
      body.push(h('div', { cls: 'iv-ovendor' }, [h('h3', { text: g[1] + ' · ' + xs.length }), h('ul', { cls: 'iv-olist' }, xs.map(function (it) {
        return h('li', null, [h('button', { type: 'button', cls: 'sc-link', text: it.name, on: { click: function () { m.close(); I.cat = it.category; if (it.category === 'bev') I.sub = subOf(it); render(); editItem(it); } } }), it.section ? h('small', { text: ' ' + it.section + (it.vendor ? ' · ' + it.vendor : '') }) : null]);
      }))]));
    });
    var m = modal('Not on the menu · ' + off.length, body, [h('span', { cls: 'sc-sp' }),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Copy list', on: { click: function (ev) { var b = ev.currentTarget; (navigator.clipboard ? navigator.clipboard.writeText(text.join('\n')) : Promise.reject()).then(function () { b.textContent = 'Copied'; }, function () { window.prompt('Copy the list:', text.join('\n')); }); } } }),
      h('button', { type: 'button', cls: 'ed-btn', text: 'Done', on: { click: function () { m.close(); } } })], true);
  }

  /* ---------- price changes from invoices (supabase/inventory-costing.sql): an alert until someone marks them seen ---------- */
  function loadAlerts() {
    var since = new Date(Date.now() - 90 * 864e5).toISOString();
    return sb().from('inventory_prices').select('id,item_id,price_date,vendor,unit_cost,old_cost,created_at').is('seen_at', null).not('old_cost', 'is', null).gte('created_at', since).order('created_at', { ascending: false }).limit(200).then(function (r) {
      I.alerts = r.error ? null : (r.data || []).filter(function (p) { return +p.old_cost && Math.abs(+p.unit_cost - +p.old_cost) / +p.old_cost >= 0.005; });
    }, function () { I.alerts = null; });
  }
  function alertsCard() {
    var list = I.alerts; if (!list || !list.length) return null;
    var byItem = {}; list.forEach(function (p) { if (!byItem[p.item_id]) byItem[p.item_id] = p; });   // newest change per item
    var rows = Object.keys(byItem).map(function (k) { return byItem[k]; });
    var nameOf = function (id) { var x = I.items.filter(function (y) { return y.id === id; })[0]; return x || null; };
    var open = I.alertsOpen;
    var ul = h('ul', { cls: 'is-inbox', hidden: !open }, rows.map(function (p) {
      var it = nameOf(p.item_id), ch = (+p.unit_cost - +p.old_cost) / +p.old_cost;
      var cc = it && window.EdenCosting && I.costCols !== undefined ? window.EdenCosting.cells(it, I.menuList || window.EdenCosting.menuList(menu())) : null;
      return h('li', null, [h('div', null, [h('b', { text: it ? it.name : 'Deleted item' }),
        h('span', { text: [p.vendor, dayLabel(p.price_date), money(+p.old_cost) + ' → ' + money(+p.unit_cost) + (it && it.unit ? ' / ' + it.unit : ''), cc ? 'cost % now ' + cc.pct : ''].filter(Boolean).join(' · ') })]),
        h('div', { cls: 'is-bar-t' }, [h('span', { cls: 'iv-chg ' + (ch > 0 ? 'up' : 'down'), text: (ch > 0 ? '▲ +' : '▼ ') + Math.round(ch * 1000) / 10 + '%' }), it ? h('button', { type: 'button', cls: 'ed-btn small', text: 'History', on: { click: function () { editItem(it); } } }) : null])]);
    }));
    var up = rows.filter(function (p) { return +p.unit_cost > +p.old_cost; }).length;
    var toggle = h('button', { type: 'button', cls: 'ed-btn small', text: open ? 'Hide' : 'Show', on: { click: function () { I.alertsOpen = !I.alertsOpen; ul.hidden = !I.alertsOpen; toggle.textContent = I.alertsOpen ? 'Hide' : 'Show'; } } });
    var seen = h('button', { type: 'button', cls: 'ed-btn small', text: 'Mark all as seen', on: { click: function () {
      var ids = list.map(function (p) { return p.id; });
      sb().from('inventory_prices').update({ seen_at: new Date().toISOString() }).in('id', ids).then(function (r) {
        if (r.error) { status('Couldn’t mark them as seen.', 'err'); return; }
        I.alerts = []; render(); status('Price changes marked as seen.', 'ok');
      });
    } } });
    return h('div', { cls: 'is-bar iv-alerts' }, [h('div', { cls: 'is-bar-h' }, [h('div', null, [h('b', { text: rows.length + ' price change' + (rows.length === 1 ? '' : 's') + ' from invoices' }), h('span', { text: up + ' went up, ' + (rows.length - up) + ' went down. They stay here until marked as seen.' })]), h('div', { cls: 'is-bar-t' }, [toggle, seen])]), ul]);
  }
  // cost per unit over time, from invoices: a small line chart (oldest → newest)
  function priceChart(pts, unit, onPick) {
    if (pts.length < 2 && !onPick) return null;
    var W = 420, H = 90, P = 8, vals = pts.map(function (p) { return +p.unit_cost; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || hi * 0.1 || 1;
    var x = function (i) { return pts.length < 2 ? W / 2 : P + (W - 2 * P) * i / (pts.length - 1); }, y = function (v) { return H - P - (H - 2 * P) * (v - lo) / span; };
    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'iv-chart'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Cost per ' + (unit || 'unit') + ' from ' + money(vals[0]) + ' to ' + money(vals[vals.length - 1]));
    var path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('class', 'iv-chart-l'); svg.appendChild(path);
    vals.forEach(function (v, i) {
      var c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', x(i)); c.setAttribute('cy', y(v)); c.setAttribute('r', 4); c.setAttribute('class', 'iv-chart-d');
      var t = document.createElementNS(ns, 'title'); t.textContent = dayLabel(pts[i].price_date) + ': ' + money(v) + (unit ? ' / ' + unit : '') + (pts[i].vendor ? ' · ' + pts[i].vendor : ''); c.appendChild(t);
      if (onPick) {   // a bigger, invisible target over each dot
        var hit = document.createElementNS(ns, 'circle'); hit.setAttribute('cx', x(i)); hit.setAttribute('cy', y(v)); hit.setAttribute('r', 12); hit.setAttribute('class', 'iv-chart-hit'); hit.setAttribute('tabindex', '0'); hit.setAttribute('role', 'button');
        hit.setAttribute('aria-label', t.textContent + '. Show and edit');
        var go = function () { svg.querySelectorAll('.iv-chart-d').forEach(function (d) { d.classList.remove('on'); }); c.classList.add('on'); onPick(pts[i]); };
        hit.addEventListener('click', go); hit.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } });
        svg.appendChild(c); svg.appendChild(hit);
      } else svg.appendChild(c);
    });
    var first = vals[0], last = vals[vals.length - 1], ch = first ? (last - first) / first : 0;
    return h('div', { cls: 'iv-chartw' }, [svg, h('span', { cls: 'is-u', text: money(lo) + ' – ' + money(hi) + ' · ' + (ch >= 0 ? '+' : '') + Math.round(ch * 1000) / 10 + '% since ' + dayLabel(pts[0].price_date) })]);
  }
  // the menu items this item is sold as, with the cost % of each; add or remove links
  function menuLinks(it) {
    var C = window.EdenCosting, list = C.menuList(menu());
    var box = h('div', { cls: 'iv-mlinks' });
    function paint() {
      box.innerHTML = '';
      var sv = C.servings(it, list), auto = !(Array.isArray(it.menu_refs) && it.menu_refs.length);
      box.appendChild(h('b', { text: 'On the menu' + (auto && sv.length ? ' (matched by name)' : '') }));
      if (!sv.length) box.appendChild(h('p', { cls: 'sc-small', text: 'Not linked to a menu item. Pick one below to see the cost %.' }));
      else box.appendChild(h('ul', null, sv.map(function (x) {
        return h('li', null, [h('span', { text: x.label + (x.part ? '' : ' · ' + x.menu.name) }), h('span', { text: C.money(x.price) + ' · costs ' + (x.cost != null ? money(x.cost) : '—') + ' · ' + C.pctText(x.pct) })]);
      })));
      var pick = h('select', { 'aria-label': 'Link a menu item' }, [h('option', { value: '', text: '+ Link a menu item (glass, bottle, pour, or a cocktail it’s the base spirit in)…' })]);
      var groups = {};
      list.forEach(function (m, i) { var k = C.kindOf(m); if (k === 'none') return; var g = (m.tabLabel || m.tab) + ' · ' + m.group; (groups[g] = groups[g] || []).push([i, m]); });
      Object.keys(groups).forEach(function (g) { var og = h('optgroup', { label: g }); groups[g].forEach(function (x) { og.appendChild(h('option', { value: String(x[0]), text: x[1].name + (x[1].desc && x[1].tab !== 'm-wine' ? ' — ' + x[1].desc.slice(0, 40) : '') + (x[1].raw ? ' · ' + x[1].raw : '') })); }); pick.appendChild(og); });
      pick.addEventListener('change', function () {
        var m = list[+pick.value]; if (!m) return;
        var refs = (Array.isArray(it.menu_refs) && it.menu_refs.length ? it.menu_refs : C.linksFor(it, list).map(function (x) { return { tab: x.tab, name: x.name, desc: x.desc }; })).slice();
        if (!refs.some(function (r) { return r.tab === m.tab && r.name === m.name && (r.desc || '') === (m.desc || ''); })) refs.push({ tab: m.tab, name: m.name, desc: m.desc || '' });
        it.menu_refs = refs; paint(); box.dataset.dirty = '1';
      });
      box.appendChild(pick);
      if (!auto) box.appendChild(h('button', { type: 'button', cls: 'sc-link', text: 'Clear links (match by name again)', on: { click: function () { it.menu_refs = []; paint(); box.dataset.dirty = '1'; } } }));
    }
    paint();
    return box;
  }
  function pourSizes() {
    var C = window.EdenCosting, S = C.settings, msg = h('p', { cls: 'sc-msg', role: 'status' });
    var f = { glass_oz: h('input', { type: 'text', inputmode: 'decimal', value: String(S.glass_oz) }), pour_oz: h('input', { type: 'text', inputmode: 'decimal', value: String(S.pour_oz) }),
      draught_oz: h('input', { type: 'text', inputmode: 'decimal', value: String(S.draught_oz) }), keg_oz: h('input', { type: 'text', inputmode: 'decimal', value: String(S.keg_oz) }) };
    var m = modal('Pour sizes for cost %', [
      h('p', { cls: 'sc-sub', text: 'Cost % = the cost of one serving ÷ its menu price. These sizes are used for every item.' }),
      h('div', { cls: 'sc-row2' }, [lbl('Wine by the glass (oz)', f.glass_oz), lbl('Spirits: pour, and base spirit in a cocktail (oz)', f.pour_oz)]),
      h('div', { cls: 'sc-row2' }, [lbl('Draught beer pour (oz)', f.draught_oz), lbl('Keg size (oz): 661 = sixth barrel, 1984 = half', f.keg_oz)]),
      msg
    ], [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { m.close(); } } }), h('button', { type: 'button', cls: 'ed-btn', text: 'Save', on: { click: function () {
      var row = {}; for (var k in f) { var v = num(f[k].value); if (!(v > 0)) { msg.textContent = 'Each size should be a number above 0.'; return; } row[k] = v; }
      row.updated_at = new Date().toISOString();
      sb().from('inventory_settings').update(row).eq('id', 1).then(function (r) {
        if (r.error) { msg.textContent = isMissing(r.error) ? 'Run supabase/inventory-costing.sql in Supabase first.' : isPerm(r.error) ? 'Only the Owner or a manager can change pour sizes.' : 'Couldn’t save.'; return; }
        C.setSettings(row); m.close(); render(); status('Pour sizes saved.', 'ok');
      });
    } } })]);
  }

  /* ---------- dialogs ---------- */
  function modal(title, bodyKids, footKids, wide) {
    var back = h('div', { cls: 'sc-modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
    var card = h('div', { cls: 'sc-card' }, [h('div', { cls: 'sc-card-h' }, [h('h2', { text: title }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: close } })]), h('div', { cls: 'sc-card-b' }, bodyKids), footKids ? h('div', { cls: 'sc-card-f' }, footKids) : null]);
    back.appendChild(card);
    function close() { back.remove(); document.removeEventListener('keydown', esc); }
    function esc(ev) { if (ev.key === 'Escape') close(); }
    back.addEventListener('mousedown', function (ev) { if (ev.target === back) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(back);
    return { el: back, close: close };
  }
  // what an item is counted in: a list (with 1/4 lb and any unit already in use), or Other… to type one
  var COUNT_UNITS = ['each', 'lb', '1/4 lb', '1/2 lb', 'oz', 'kg', 'g', 'case', 'bottle', 'keg', 'can', 'gal', 'qt', 'pt', 'box', 'bag', 'roll', 'sleeve', 'pack', 'bunch', 'dozen', 'flat', 'tray', 'quart container'];
  var GRAMS = { lb: 453.592, '1/4 lb': 113.398, '1/2 lb': 226.796, oz: 28.3495, kg: 1000, g: 1 };
  function unitPicker(cur, onSwap, none, label) {
    var list = COUNT_UNITS.slice();
    uniq(I.items.map(function (x) { return x.unit; })).forEach(function (u) { if (list.indexOf(u) < 0) list.push(u); });
    var sel = h('select', { 'aria-label': label || 'Counted in (unit)' }, [h('option', { value: '', text: none || '— Pick a unit —' })].concat(list.map(function (u) { return h('option', { value: u, text: u === '1/4 lb' ? '1/4 lb (quarter pound)' : u === '1/2 lb' ? '1/2 lb (half pound)' : u }); })).concat([h('option', { value: '__other', text: 'Other…' })]));
    var other = h('input', { type: 'text', placeholder: 'Type the unit', 'aria-label': 'Other unit', hidden: true });
    if (cur && list.indexOf(cur) < 0) { other.value = cur; other.hidden = false; sel.value = '__other'; } else sel.value = cur;
    var prev = sel.value;
    other.addEventListener('input', function () { if (onSwap) onSwap(null); });
    sel.addEventListener('change', function () { other.hidden = sel.value !== '__other'; if (!other.hidden) other.focus(); if (onSwap && GRAMS[prev] && GRAMS[sel.value]) onSwap(GRAMS[sel.value] / GRAMS[prev], sel.value); prev = sel.value; });
    var el = h('div', { cls: 'iv-unitpick' }, [sel, other]);
    return { el: el, get value() { return sel.value === '__other' ? other.value : sel.value; }, focus: function () { sel.focus(); } };
  }
  // the section: a list of this tab's sections (and any already in use), or Other… to type a new one
  function sectionPicker(cur, list) {
    list = uniq(list.concat(cur ? [cur] : []));
    var sel = h('select', { 'aria-label': 'Section' }, [h('option', { value: '', text: '— Pick a section —' })].concat(list.map(function (u) { return h('option', { value: u, text: u }); })).concat([h('option', { value: '__other', text: 'New section…' })]));
    var other = h('input', { type: 'text', placeholder: 'Type the new section', 'aria-label': 'New section', hidden: true });
    sel.value = cur || '';
    sel.addEventListener('change', function () { other.hidden = sel.value !== '__other'; if (!other.hidden) other.focus(); });
    return { el: h('div', { cls: 'iv-unitpick' }, [sel, other]), get value() { return sel.value === '__other' ? other.value : sel.value; } };
  }
  function lbl(text, input) { return h('label', { cls: 'sc-f' }, [h('span', { text: text }), input]); }
  function datalist(id, vals) { return h('datalist', { id: id }, vals.map(function (v) { return h('option', { value: v }); })); }
  function uniq(list) { var s = {}; return list.filter(function (x) { x = String(x || '').trim(); if (!x || s[x.toLowerCase()]) return false; s[x.toLowerCase()] = 1; return true; }); }

  // food is costed through recipes, never straight to the menu: receiving → recipe → the plate's food cost.
  // Each food item has an ingredient name ("Edible flowers" for "100pc ed. flowers"); recipes pick the item by it.
  function ingNames() {
    var out = I.items.filter(function (x) { return x.category === 'food'; }).map(function (x) { return x.ingredient; });
    (I.recipes || []).forEach(function (r) { r.ingredients.forEach(function (g) { if (!g.head) out.push(g.item); }); });
    return uniq(out).sort(function (a, b) { return a.localeCompare(b); });
  }
  function usedIn(it) {
    var rs = recipesFor(it.id);
    return h('p', { cls: 'sc-sub', text: rs.length ? 'Used in: ' + rs.map(function (x) { return x.name; }).join(', ') + '. The recipe carries the cost to the menu item.' : 'Not in a recipe yet. When you write a recipe, search for this ingredient name to cost it from this item.' });
  }
  function editItem(it) {
    var isNew = !it;
    it = it || { id: uid(), category: I.cat, section: '', name: '', unit: '', pack: '', vendor: '', par: null, cost: null, sort: 0 };
    var isFoodIt = it.category === 'food';
    var catItemsAll = I.items.filter(function (x) { return x.category === I.cat; });
    var f = {
      name: h('input', { type: 'text', value: it.name || '', placeholder: I.cat === 'bev' ? 'e.g. Tito’s Vodka' : I.cat === 'paper' ? 'e.g. To-go containers, large' : 'e.g. Heavy cream' }),
      section: sectionPicker(it.section || '', (SECTIONS[it.category || I.cat] || []).concat(I.items.filter(function (x) { return x.category === (it.category || I.cat); }).map(function (x) { return x.section; }))),
      ingr: h('input', { type: 'text', value: it.ingredient || '', list: 'ivIngs', placeholder: 'e.g. Edible flowers', 'aria-label': 'Ingredient name' }),
      unit: unitPicker(it.unit || '', function (k, u) {   // lb → 1/4 lb: $10 a lb becomes $2.50 a 1/4 lb, par 5 becomes 20
        convLbl();
        if (k == null) return;
        var c = num(f.cost.value), p = num(f.par.value), said = [];
        if (c != null) { f.cost.value = String(Math.round(c * k * 10000) / 10000); said.push('cost to ' + money(+f.cost.value) + ' per ' + u); }
        if (p != null) { f.par.value = qty(Math.round(p / k * 100) / 100); said.push('par to ' + f.par.value); }
        msg.textContent = said.length ? 'Changed ' + said.join(' and ') + ' to match.' : '';
      }),
      pack: h('input', { type: 'text', value: it.pack || '', placeholder: 'e.g. 6/#10 cans, 750ml' }),
      vendor: h('input', { type: 'text', value: it.vendor || '', list: 'ivVendors', placeholder: 'Optional' }),
      par: h('input', { type: 'text', inputmode: 'decimal', value: qty(it.par), placeholder: 'How many to keep on hand' }),
      cost: h('input', { type: 'text', inputmode: 'decimal', value: it.cost != null ? String(it.cost) : '', placeholder: 'Cost per unit, e.g. 24.50' }),
      ord: unitPicker(it.order_unit || '', function () { convLbl(); }, 'Same as counted in', 'Received in (unit)'),
      pc: h('input', { type: 'text', inputmode: 'decimal', value: it.per_case != null ? qty(+it.per_case) : '', placeholder: 'e.g. 6 or 12' })
    };
    // 1 received unit = how many counted units: a case of mushrooms = 5 lb, a case of wine = 12 bottles
    var convSpan = h('span'), convRow = lbl('', f.pc); convRow.replaceChild(convSpan, convRow.firstChild);
    function convLbl() {
      var r = f.ord.value.trim(), c = f.unit.value.trim();
      convRow.hidden = !r || !c || r === c;
      convSpan.textContent = 'How many ' + (c || 'units') + ' in 1 ' + (r || 'received unit');
    }
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var m;
    var foot = [
      !isNew ? h('button', { type: 'button', cls: 'ed-btn small danger', text: 'Delete item', on: { click: del } }) : h('span'),
      h('span', { cls: 'sc-sp' }),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { m.close(); } } }),
      h('button', { type: 'button', cls: 'ed-btn', text: isNew ? 'Add item' : 'Save', on: { click: save } })
    ];
    m = modal(isNew ? 'Add item' : 'Edit item', [
      h('p', { cls: 'sc-sub', text: catOf(I.cat).label }),
      lbl('Item', f.name),
      lbl('Section', f.section.el),
      h('div', { cls: 'sc-row2' }, [lbl('Received in (on the invoice)', f.ord.el), lbl('Counted in (for inventory)', f.unit.el)]),
      I.orderCols ? convRow : h('p', { cls: 'sc-sub', text: 'To save Received in, run supabase/invoice-vendors.sql in Supabase once.' }),
      h('div', { cls: 'sc-row2' }, [lbl('Pack size / notes', f.pack), lbl('Vendor', f.vendor)]),
      h('div', { cls: 'sc-row2' }, [lbl('Par', f.par), lbl('Cost per unit ($)', f.cost)]),
      datalist('ivSections', uniq((SECTIONS[I.cat] || []).concat(catItemsAll.map(function (x) { return x.section; })))),
      datalist('ivUnits', UNITS), datalist('ivVendors', uniq(I.items.map(function (x) { return x.vendor; }))),
      msg
    ], foot);
    m.el.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' || ev.target.tagName !== 'INPUT') return;
      ev.preventDefault();
      var he = ev.target.closest('.iv-hedit');   // Enter in a price-history entry saves that entry, not the item
      if (he) { var b = he.querySelector('.iv-hsave'); if (b) b.click(); return; }
      save();
    });
    var draft = { name: it.name, pack: it.pack, unit: it.unit, cost: it.cost, per_case: it.per_case, menu_refs: (Array.isArray(it.menu_refs) ? it.menu_refs : []).slice() };
    if (isFoodIt) msg.parentNode.insertBefore(h('div', { cls: 'iv-links' }, [I.ingCol ? lbl('Ingredient name (what recipes call it)', f.ingr) : h('p', { cls: 'sc-sub', text: 'To give items an ingredient name, run supabase/ingredient-name.sql in Supabase once.' }), datalist('ivIngs', ingNames()), isNew ? null : usedIn(it)]), msg);
    else if (!isNew && I.costCols && window.EdenCosting) msg.parentNode.insertBefore(menuLinks(draft), msg);
    if (!isNew) {
      var hist = h('div', { cls: 'iv-hist' }); msg.parentNode.insertBefore(hist, msg);
      var loadHist = function (openId) {
        sb().from('inventory_prices').select('id,price_date,vendor,invoice_line,invoice_price,invoice_unit,per_unit,unit_cost,old_cost,invoice_id').eq('item_id', it.id).order('price_date', { ascending: false }).order('created_at', { ascending: false }).limit(24).then(function (r) {
          hist.innerHTML = '';
          if (r.error || !r.data || !r.data.length) return;
          var rows = r.data, edit = h('div', { cls: 'iv-hedit', hidden: true });
          var pick = function (p) { openEntry(p, rows[0] === p); };
          var line = function (p) { return [dayLabel(p.price_date) + ' · ' + (p.vendor || ''), money(p.unit_cost) + (it.unit ? ' / ' + it.unit : '') + (p.per_unit && +p.per_unit !== 1 ? ' (' + money(p.invoice_price) + ' / ' + (p.invoice_unit || 'unit') + ' ÷ ' + (+p.per_unit) + ')' : '')]; };
          hist.appendChild(h('b', { text: 'Price history from invoices' }));
          hist.appendChild(h('p', { cls: 'sc-small', text: 'Click a dot or a line to see what was entered, and fix it.' }));
          var ch = priceChart(rows.slice().reverse(), it.unit, pick); if (ch) hist.appendChild(ch);
          hist.appendChild(edit);
          hist.appendChild(h('ul', null, rows.slice(0, 12).map(function (p) { var t = line(p); return h('li', null, h('button', { type: 'button', cls: 'iv-hrow', on: { click: function () { pick(p); } } }, [h('span', { text: t[0] }), h('span', { text: t[1] })])); })));
          function openEntry(p, newest) {
            edit.hidden = false; edit.innerHTML = '';
            var g = {
              date: h('input', { type: 'date', value: p.price_date || '' }),
              vendor: h('input', { type: 'text', value: p.vendor || '' }),
              line: h('input', { type: 'text', value: p.invoice_line || '' }),
              price: h('input', { type: 'text', inputmode: 'decimal', value: p.invoice_price != null ? String(+p.invoice_price) : '' }),
              unit: h('input', { type: 'text', value: p.invoice_unit || '' }),
              per: h('input', { type: 'text', inputmode: 'decimal', value: p.per_unit != null ? String(+p.per_unit) : '1' }),
              cost: h('input', { type: 'text', inputmode: 'decimal', value: p.unit_cost != null ? String(+p.unit_cost) : '' })
            };
            var also = h('input', { type: 'checkbox', checked: newest }), em = h('p', { cls: 'sc-msg', role: 'status' });
            var recalc = function () { var pr = num(g.price.value), pe = num(g.per.value); if (pr != null && pe > 0) g.cost.value = String(Math.round(pr / pe * 10000) / 10000); };
            g.price.addEventListener('input', recalc); g.per.addEventListener('input', recalc);
            edit.appendChild(h('div', { cls: 'iv-hhead' }, [h('b', { text: 'Entered ' + dayLabel(p.price_date) + (p.vendor ? ' · ' + p.vendor : '') }), h('button', { type: 'button', cls: 'rc-mini', 'aria-label': 'Close', text: '✕', on: { click: function () { edit.hidden = true; } } })]));
            edit.appendChild(h('div', { cls: 'sc-row2' }, [lbl('Invoice date', g.date), lbl('Vendor', g.vendor)]));
            edit.appendChild(lbl('Invoice line', g.line));
            edit.appendChild(h('div', { cls: 'sc-row3' }, [lbl('Invoice price ($)', g.price), lbl('Per (invoice unit)', g.unit), lbl('How many ' + (it.unit || 'units') + ' in 1', g.per)]));
            edit.appendChild(lbl('Cost per ' + (it.unit || 'unit') + ' ($)', g.cost));
            edit.appendChild(h('label', { cls: 'iv-halso' }, [also, h('span', { text: newest ? 'Also make this the item’s cost now (the newest price)' : 'Also make this the item’s cost now' })]));
            edit.appendChild(em);
            edit.appendChild(h('div', { cls: 'iv-hact' }, [
              h('button', { type: 'button', cls: 'ed-btn small danger', text: 'Delete this entry', on: { click: function () {
                if (!confirm('Delete the ' + dayLabel(p.price_date) + ' price from the history? The invoice itself stays.')) return;
                sb().from('inventory_prices').delete().eq('id', p.id).then(function (r) { if (r.error) { em.textContent = 'Couldn’t delete: ' + r.error.message; return; } status('Price entry deleted.', 'ok'); loadHist(); });
              } } }),
              h('span', { cls: 'sc-sp' }),
              h('button', { type: 'button', cls: 'ed-btn small iv-hsave', text: 'Save this entry', on: { click: function () {
                var c = num(g.cost.value), pr = g.price.value.trim() ? num(g.price.value) : null, pe = num(g.per.value);
                if (c == null) { em.textContent = 'Cost should be a number.'; g.cost.focus(); return; }
                if (g.price.value.trim() && pr == null) { em.textContent = 'Invoice price should be a number.'; return; }
                var row = { price_date: g.date.value || p.price_date, vendor: g.vendor.value.trim(), invoice_line: g.line.value.trim(), invoice_price: pr, invoice_unit: g.unit.value.trim(), per_unit: pe > 0 ? pe : null, unit_cost: c };
                em.textContent = 'Saving…';
                sb().from('inventory_prices').update(row).eq('id', p.id).then(function (r) {
                  if (r.error) { em.textContent = isPerm(r.error) ? 'Your role can’t change price history.' : 'Couldn’t save: ' + r.error.message; return; }
                  if (!also.checked) { status('Price entry saved.', 'ok'); loadHist(); return; }
                  // and the item's cost, saved now too
                  f.cost.value = String(c);
                  sb().from('inventory_items').update({ cost: c }).eq('id', it.id).then(function (r2) {
                    if (r2.error) { em.textContent = 'The entry saved, but the item’s cost didn’t: ' + r2.error.message; return; }
                    it.cost = c; render();
                    status('Price entry saved. ' + it.name + ' now costs ' + money(c) + (it.unit ? ' / ' + it.unit : '') + '.', 'ok'); loadHist();
                  });
                });
              } } })
            ]));
            edit.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
          }
          if (openId) { var o = rows.filter(function (x) { return x.id === openId; })[0]; if (o) pick(o); }
        });
      };
      loadHist();
    }
    convLbl();
    setTimeout(function () { f.name.focus(); }, 30);
    function save() {
      var name = f.name.value.trim();
      if (!name) { msg.textContent = 'Give the item a name.'; f.name.focus(); return; }
      var par = f.par.value.trim() ? num(f.par.value) : null, cost = f.cost.value.trim() ? num(f.cost.value) : null;
      if (f.par.value.trim() && par == null) { msg.textContent = 'Par should be a number.'; f.par.focus(); return; }
      if (f.cost.value.trim() && cost == null) { msg.textContent = 'Cost should be a number, e.g. 24.50.'; f.cost.focus(); return; }
      var dup = I.items.filter(function (x) { return x.category === I.cat && x.id !== it.id && keyOf(x.name) === keyOf(name); })[0];
      if (dup && !confirm('“' + dup.name + '” is already on this list. Add another with the same name?')) return;
      var next = Object.assign({}, it, { name: name, section: f.section.value.trim(), unit: f.unit.value.trim(), pack: f.pack.value.trim(), vendor: f.vendor.value.trim(), par: par, cost: cost });
      if (I.orderCols) { next.order_unit = f.ord.value.trim(); next.per_case = num(f.pc.value); }
      if (I.costCols) next.menu_refs = draft.menu_refs;
      if (I.ingCol && isFoodIt) next.ingredient = f.ingr.value.trim();
      status('Saving…', 'dirty');
      saveItems([next]).then(function () {
        if (isNew) I.items.push(next); else Object.assign(it, next);
        m.close(); status(isNew ? 'Added ' + name + '.' : 'Saved.', 'ok'); render();
      }, function (e) { msg.textContent = isPerm(e) ? 'Your role can’t change the inventory.' : 'Couldn’t save. Check your connection and try again.'; status('', ''); });
    }
    function del() {
      if (!confirm('Delete “' + it.name + '” from the ' + catOf(I.cat).label.toLowerCase() + ' inventory? Past counts for it are kept but won’t show.')) return;
      sb().from('inventory_items').delete().eq('id', it.id).then(function (r) {
        if (r.error) { msg.textContent = isPerm(r.error) ? 'Your role can’t change the inventory.' : 'Couldn’t delete. Try again.'; return; }
        I.items = I.items.filter(function (x) { return x.id !== it.id; }); m.close(); status('Deleted ' + it.name + '.', 'ok'); render();
      });
    }
  }

  // what to order in the vendor's unit: counted in bottles but ordered by the case of 6 → whole cases, and the other way round
  function orderQty(it, need) {
    var u = String(it.unit || '').toLowerCase(), pc = +it.per_case || 0, plural = function (n, w) { return qty(n) + ' ' + w + (n === 1 ? '' : (/s$/.test(w) ? '' : 's')); };
    if (it.order_unit === 'case' && pc > 1 && !/^(case|cs)s?$/.test(u)) { var c = Math.ceil(need / pc - 1e-9); return { text: plural(c, 'case'), note: 'short ' + plural(need, u || 'unit') + ', ' + qty(pc) + ' per case' }; }
    if (it.order_unit === 'bottle' && pc > 1 && /^(case|cs)s?$/.test(u)) { var b = Math.ceil(need * pc - 1e-9); return { text: plural(b, 'bottle'), note: 'by the bottle' }; }
    if (it.order_unit && it.order_unit !== it.unit && pc > 0 && it.order_unit !== 'bottle') { var n = Math.ceil(need / pc - 1e-9); return { text: plural(n, it.order_unit), note: 'short ' + plural(need, u || 'unit') + ', ' + qty(pc) + ' ' + (it.unit || '') + ' each' }; }
    return { text: qty(need) + ' ' + (it.unit || ''), note: it.order_unit ? 'by the ' + it.order_unit : '' };
  }
  /* ---------- printable count sheet: every item by section, with boxes to write the count in ---------- */
  /* ---------- the monthly count: every item on one page, in the order of the printed sheet, then a report ---------- */
  function sheetOrder(cid) {
    var order = SECTIONS[cid] || [], SO = ['beer', 'wine', 'liquor', 'na'];
    return I.items.filter(function (it) { return it.category === cid && it.active !== false; }).sort(function (a, b) {
      var sa = cid === 'bev' ? SO.indexOf(subOf(a)) : 0, sb2 = cid === 'bev' ? SO.indexOf(subOf(b)) : 0;
      var ia = order.indexOf(a.section), ib = order.indexOf(b.section); if (ia < 0) ia = 999; if (ib < 0) ib = 999;
      return sa - sb2 || ia - ib || String(a.section).localeCompare(b.section) || (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(b.name);
    });
  }
  var SUBN = { beer: 'Beer', wine: 'Wine', liquor: 'Liquor', na: 'N/A (non-alcoholic)' };
  function monthlyStart() {
    flush();
    var d = new Date(), last = new Date(d.getFullYear(), d.getMonth(), 0);   // the last day of last month, early in a month
    var date = h('input', { type: 'date', value: d.getDate() <= 7 ? iso(last) : iso(d) });
    var boxes = CATS.map(function (c) { var cb = h('input', { type: 'checkbox', value: c.id, checked: true }); return [cb, h('label', { cls: 'sc-check' }, [cb, ' ' + c.label])]; });
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var m = modal('Enter the monthly count', [
      h('p', { cls: 'sc-sub', text: 'Type in what’s on hand from the count sheets, in the same order as the printed sheet. Counts already entered for that date are filled in. When you save, you get the inventory report.' }),
      lbl('Count date', date),
      h('div', { cls: 'iv-cs-opts' }, [h('b', { text: 'Sheets' })].concat(boxes.map(function (b) { return b[1]; }))), msg
    ], [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { m.close(); } } }),
      h('button', { type: 'button', cls: 'ed-btn', text: 'Start', on: { click: function () {
        var cats = boxes.filter(function (b) { return b[0].checked; }).map(function (b) { return b[0].value; });
        if (!date.value) { msg.textContent = 'Pick the count date.'; return; }
        if (!cats.length) { msg.textContent = 'Pick at least one sheet.'; return; }
        m.close(); monthlyEntry(date.value, cats);
      } } })]);
  }
  function monthlyEntry(day, cats) {
    var draft = {}, rowOf = function (cid) { return I.counts.filter(function (c) { return c.category === cid && c.count_date === day; })[0] || null; };
    cats.forEach(function (cid) { var r = rowOf(cid); draft[cid] = Object.assign({}, (r && r.counts) || {}); });
    var prevOf = function (cid) { return I.counts.filter(function (c) { return c.category === cid && c.count_date < day && c.counts && Object.keys(c.counts).length; }).sort(function (a, b) { return a.count_date < b.count_date ? 1 : -1; })[0] || null; };
    var total = 0, prog = h('b'), inputs = [];
    var body = h('div', { cls: 'iv-me' });
    cats.forEach(function (cid) {
      var c = catOf(cid), prev = prevOf(cid), items = sheetOrder(cid), curSub = null, curSec = null;
      total += items.length;
      body.appendChild(h('h3', { cls: 'iv-me-cat', text: c.label + ' · ' + items.length + (items.length === 1 ? ' item' : ' items') + (prev ? ' · last count ' + dayLabel(prev.count_date) : '') }));
      var tb = h('tbody');
      items.forEach(function (it) {
        if (cid === 'bev' && subOf(it) !== curSub) { curSub = subOf(it); curSec = null; tb.appendChild(h('tr', { cls: 'iv-me-sub' }, h('td', { colspan: '4', text: SUBN[curSub] || curSub }))); }
        if ((it.section || 'Other') !== curSec) { curSec = it.section || 'Other'; tb.appendChild(h('tr', { cls: 'iv-me-sec' }, h('td', { colspan: '4', text: curSec }))); }
        var v = draft[cid][it.id], inp = h('input', { type: 'text', inputmode: 'decimal', value: v == null ? '' : String(v), 'aria-label': 'Count for ' + it.name });
        inp.addEventListener('input', function () { var n = num(inp.value); if (inp.value.trim() === '') delete draft[cid][it.id]; else if (n != null && n >= 0) draft[cid][it.id] = n; inp.classList.toggle('bad', inp.value.trim() !== '' && (n == null || n < 0)); paintProg(); });
        inp.addEventListener('keydown', function (e) { if (e.key === 'Enter' || (e.key === 'ArrowDown')) { e.preventDefault(); var i = inputs.indexOf(inp); if (inputs[i + 1]) { inputs[i + 1].focus(); inputs[i + 1].select(); } } else if (e.key === 'ArrowUp') { e.preventDefault(); var j = inputs.indexOf(inp); if (inputs[j - 1]) { inputs[j - 1].focus(); inputs[j - 1].select(); } } });
        inputs.push(inp);
        var last = prev && prev.counts[it.id] != null ? prev.counts[it.id] : null;
        tb.appendChild(h('tr', null, [h('td', { cls: 'iv-me-n' }, [h('b', { text: it.name }), it.pack ? h('small', { text: it.pack }) : null]), h('td', { cls: 'iv-me-u', text: it.unit || '' }),
          h('td', { cls: 'iv-me-l', text: last == null ? '' : 'last ' + (Math.round(last * 100) / 100) + (it.par != null ? ' · par ' + it.par : '') }), h('td', { cls: 'iv-me-c' }, inp)]));
      });
      body.appendChild(h('table', { cls: 'iv-me-t' }, tb));
    });
    function counted() { return cats.reduce(function (a, cid) { return a + sheetOrder(cid).filter(function (it) { return draft[cid][it.id] != null; }).length; }, 0); }
    function paintProg() { prog.textContent = counted() + ' of ' + total + ' counted'; }
    paintProg();
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var saveBtn = h('button', { type: 'button', cls: 'ed-btn', text: 'Save & see the report' });
    var m = modal('Monthly count · ' + dayLabel(day), [h('p', { cls: 'sc-sub' }, [prog, ' · Enter or ↓ moves to the next item. Leave an item blank if it wasn’t counted; type 0 for none on hand.']), body, msg],
      [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { if (counted() && !confirm('Close without saving these counts?')) return; m.close(); } } }), saveBtn], true);
    m.el.classList.add('iv-me-modal');
    setTimeout(function () { if (inputs[0]) inputs[0].focus(); }, 50);
    saveBtn.addEventListener('click', function () {
      if (body.querySelector('input.bad')) { msg.textContent = 'Fix the counts in red (numbers only).'; return; }
      saveBtn.disabled = true; msg.textContent = 'Saving…';
      var rows = cats.map(function (cid) { var r = rowOf(cid); return { id: (r && r.id) || cid + ':' + day, category: cid, count_date: day, counts: draft[cid], counted_by: I.ctx.name || (r && r.counted_by) || '' }; });
      sb().from('inventory_counts').upsert(rows, { onConflict: 'id' }).then(function (res) {
        if (res.error) { saveBtn.disabled = false; msg.textContent = isPerm(res.error) ? 'Your role can’t change the inventory.' : 'Couldn’t save. Check your connection and try again.'; return; }
        rows.forEach(function (row) { var i = I.counts.findIndex(function (c) { return c.id === row.id || (c.category === row.category && c.count_date === row.count_date); }); if (i < 0) I.counts.push(row); else I.counts[i] = row; });
        I.counts.sort(function (a, b) { return a.count_date < b.count_date ? 1 : -1; });
        m.close(); status('Count saved for ' + dayLabel(day) + '.', 'ok'); I.date = day; render(); report(day);
      });
    });
  }
  // every date that has a count, newest first
  function reportsList() {
    flush();
    var dates = {}; I.counts.forEach(function (c) { if (c.counts && Object.keys(c.counts).length) (dates[c.count_date] = dates[c.count_date] || []).push(c.category); });
    var keys = Object.keys(dates).sort().reverse();
    var m = modal('Inventory reports', [
      h('p', { cls: 'sc-sub', text: 'A report for each count: what’s on hand and its value, what changed since the count before, what was bought in between (from scanned invoices) and what was used.' }),
      keys.length ? h('ul', { cls: 'iv-rlist' }, keys.map(function (k) { return h('li', null, [h('button', { type: 'button', cls: 'iv-rbtn', on: { click: function () { m.close(); report(k); } } }, [h('b', { text: dayLabel(k) }), h('span', { text: dates[k].map(function (c) { return catOf(c).label; }).join(', ') })])]); })) : h('p', { cls: 'sc-sub', text: 'No counts yet. Use Enter monthly count, or type counts on the Inventory page.' })
    ], [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Close', on: { click: function () { m.close(); } } })]);
  }
  function report(day) {
    var w = window.open('', '_blank');
    if (!w) { status('Allow pop-ups for the staff site to open the report.', 'err'); return; }
    w.document.write('<!doctype html><title>Inventory report</title><p style="font:14px sans-serif;padding:24px">Making the report…</p>');
    var prevDay = I.counts.filter(function (c) { return c.count_date < day && c.counts && Object.keys(c.counts).length; }).map(function (c) { return c.count_date; }).sort().reverse()[0] || null;
    var invP = prevDay ? sb().from('inventory_invoices').select('invoice_date,vendor,total,lines,fees_total').gt('invoice_date', prevDay).lte('invoice_date', day).then(function (r) { return r.error ? null : r.data || []; }, function () { return null; }) : Promise.resolve(null);
    var salesP = prevDay ? sb().from('payroll_weeks').select('week_start,summary:rows->_summary').gte('week_start', iso(new Date(parseDay(prevDay).getTime() + 864e5 * -6))).lte('week_start', day).then(function (r) { return r.error ? null : r.data || []; }, function () { return null; }) : Promise.resolve(null);
    Promise.all([invP, salesP]).then(function (res) { writeReport(w, day, prevDay, res[0], res[1]); });
  }
  function writeReport(w, day, prevDay, invs, weeks) {
    var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var q = function (v) { return v == null ? '' : String(Math.round(v * 100) / 100); };
    var M = function (v) { return v == null ? '—' : (v < 0 ? '−' : '') + money(Math.abs(v)); };
    var P = function (v) { return v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%'; };
    var byId = {}; I.items.forEach(function (it) { byId[it.id] = it; });
    var rowFor = function (cid, d) { return d ? I.counts.filter(function (c) { return c.category === cid && c.count_date === d; })[0] || null : null; };
    // purchases between the two counts, by category (lines by the item they were matched to; the rest with the invoice's main category)
    var buy = { food: 0, paper: 0, bev: 0 }, buyN = 0;
    (invs || []).forEach(function (v) {
      var g = { food: 0, paper: 0, bev: 0 }, loose = 0;
      (v.lines || []).forEach(function (L) { var a = +L.extended || 0, it = L.item_id && byId[L.item_id]; if (it && g[it.category] != null) g[it.category] += a; else loose += a; });
      var top = Object.keys(g).sort(function (a, b) { return g[b] - g[a]; })[0]; g[top] += loose;
      var lsum = g.food + g.paper + g.bev, tot = +v.total > 0 ? +v.total : lsum + (+v.fees_total || 0);
      Object.keys(g).forEach(function (k) { buy[k] += lsum ? g[k] * tot / lsum : 0; }); buyN++;
    });
    // food and beverage sales in the weeks between the counts
    var sales = null;
    if (weeks && weeks.length && prevDay) {
      sales = { food: 0, bev: 0, net: 0, weeks: 0 };
      weeks.forEach(function (x) { var sm = x.summary; if (!sm) return; var end = iso(new Date(parseDay(x.week_start).getTime() + 6 * 864e5)); if (end <= prevDay || x.week_start > day) return; sales.food += +sm.food || 0; sales.bev += +sm.bev || 0; sales.net += +sm.net || 0; sales.weeks++; });
      if (!sales.weeks) sales = null;
    }
    var cats = CATS.filter(function (c) { return rowFor(c.id, day); });
    var sum = [], detail = '', below = [], nocost = [], notCounted = [], moves = [];
    cats.forEach(function (c) {
      var cur = rowFor(c.id, day), prev = rowFor(c.id, prevDay), items = sheetOrder(c.id);
      var val = 0, pval = 0, counted = 0, subs = {};
      var rows = '', curSub = null, curSec = null;
      items.forEach(function (it) {
        var n = cur.counts[it.id], pn = prev && prev.counts[it.id] != null ? prev.counts[it.id] : null, cost = it.cost == null || it.cost === '' ? null : +it.cost;
        if (n != null) counted++; else notCounted.push(it);
        var v = n != null && cost != null ? n * cost : null, pv = pn != null && cost != null ? pn * cost : null;
        if (v != null) { val += v; if (c.id === 'bev') subs[subOf(it)] = (subs[subOf(it)] || 0) + v; }
        if (pv != null) pval += pv;
        if (n != null && cost == null) nocost.push(it);
        if (n != null && it.par != null && n < +it.par) below.push({ it: it, n: n });
        if (v != null || pv != null) moves.push({ it: it, d: (v || 0) - (pv || 0) });
        if (c.id === 'bev' && subOf(it) !== curSub) { curSub = subOf(it); curSec = null; rows += '<tr class="sub"><td colspan="7">' + esc(SUBN[curSub] || curSub) + '</td></tr>'; }
        if ((it.section || 'Other') !== curSec) { curSec = it.section || 'Other'; rows += '<tr class="sec"><td colspan="7">' + esc(curSec) + '</td></tr>'; }
        rows += '<tr' + (n == null ? ' class="nc"' : '') + '><td>' + esc(it.name) + (it.pack ? ' <small>' + esc(it.pack) + '</small>' : '') + '</td><td>' + esc(it.unit) + '</td><td class="r">' + (n == null ? 'not counted' : q(n)) + '</td><td class="r">' + q(pn) + '</td><td class="r">' + (cost == null ? '—' : M(cost)) + '</td><td class="r">' + (v == null ? '—' : M(v)) + '</td><td class="r">' + (it.par != null && n != null && n < +it.par ? 'below par ' + q(+it.par) : '') + '</td></tr>';
      });
      var used = prev ? pval + buy[c.id] - val : null;
      var sl = sales ? (c.id === 'food' ? sales.food : c.id === 'bev' ? sales.bev : sales.net) : null;
      sum.push({ c: c, val: val, pval: prev ? pval : null, buy: prevDay ? buy[c.id] : null, used: used, sales: sl, counted: counted, total: items.length, subs: subs });
      detail += '<section class="cat"><h2>' + esc(c.label) + '</h2><table><thead><tr><th>Item</th><th>Unit</th><th class="r">Count</th><th class="r">Last' + (prevDay ? '<small>' + esc(prevDay.slice(5).replace('-', '/')) + '</small>' : '') + '</th><th class="r">Cost</th><th class="r">Value</th><th class="r"></th></tr></thead><tbody>' + rows + '</tbody><tfoot><tr><td colspan="5">' + esc(c.label) + ' on hand</td><td class="r">' + M(val) + '</td><td></td></tr></tfoot></table></section>';
    });
    var T = sum.reduce(function (a, x) { a.val += x.val; a.pval += x.pval || 0; a.buy += x.buy || 0; a.used += x.used || 0; return a; }, { val: 0, pval: 0, buy: 0, used: 0 });
    var sumRows = sum.map(function (x) { return '<tr><td><b>' + esc(x.c.label) + '</b><small>' + x.counted + ' of ' + x.total + ' counted</small></td><td class="r">' + M(x.val) + '</td><td class="r">' + M(x.pval) + '</td><td class="r">' + (x.pval == null ? '—' : M(x.val - x.pval)) + '</td><td class="r">' + M(x.buy) + '</td><td class="r"><b>' + M(x.used) + '</b></td><td class="r">' + (x.used != null && x.sales ? P(x.used / x.sales) : '—') + '</td></tr>'; }).join('');
    var bevSub = sum.filter(function (x) { return x.c.id === 'bev'; })[0];
    moves.sort(function (a, b) { return Math.abs(b.d) - Math.abs(a.d); });
    var list = function (title, arr, fn) { return arr.length ? '<div class="box"><h3>' + title + ' · ' + arr.length + '</h3><ul>' + arr.slice(0, 30).map(fn).join('') + (arr.length > 30 ? '<li>…and ' + (arr.length - 30) + ' more</li>' : '') + '</ul></div>' : ''; };
    var who = cats.map(function (c) { return rowFor(c.id, day).counted_by; }).filter(Boolean).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(', ');
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>Eden inventory report ' + esc(day) + '</title><style>' +
      '@page{size:letter;margin:.5in}body{font:10.5pt/1.35 -apple-system,Helvetica,Arial,sans-serif;color:#111;margin:0 auto;max-width:7.5in;padding:20px}' +
      'header{border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:flex-end;gap:12px}h1{font:600 20pt Georgia,serif;margin:0}header span{font-size:9.5pt;color:#555}' +
      '.tools{margin:0 0 14px}.tools button{font:inherit;padding:6px 12px;border:1px solid #111;background:#fff;border-radius:4px;cursor:pointer;margin-right:6px}@media print{.tools{display:none}}' +
      'table{width:100%;border-collapse:collapse;margin-bottom:10px}th{font-size:8pt;text-transform:uppercase;letter-spacing:.05em;text-align:left;border-bottom:1.5px solid #111;padding:4px 6px}th small{display:block;text-transform:none;letter-spacing:0;font-weight:400}' +
      'td{padding:4px 6px;border-bottom:1px solid #ddd;vertical-align:top}td small{display:block;color:#666;font-size:8pt}.r{text-align:right;white-space:nowrap}' +
      'tfoot td{font-weight:700;border-top:1.5px solid #111;border-bottom:0}tr.sec td{background:#eee;font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:.05em}tr.sub td{font:600 12pt Georgia,serif;padding-top:10px;border-bottom:1.5px solid #111}tr.nc td{color:#999}' +
      'h2{font:600 15pt Georgia,serif;margin:22px 0 6px}h3{font-size:10pt;margin:0 0 6px}.cat{break-before:page;page-break-before:always}' +
      '.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}.box{border:1px solid #ccc;border-radius:6px;padding:10px 12px;break-inside:avoid}.box ul{margin:0;padding-left:16px;font-size:9.5pt}' +
      '.note{font-size:9pt;color:#555}*{-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '</style></head><body><header><div><h1>Eden · Inventory report</h1><span>Count of ' + esc(dayLabel(day)) + (who ? ' · counted by ' + esc(who) : '') + (prevDay ? ' · compared with ' + esc(dayLabel(prevDay)) : ' · the first count, nothing to compare with yet') + '</span></div><span>' + esc(new Date().toLocaleDateString()) + '</span></header>' +
      '<div class="tools"><button onclick="print()">Print</button><button onclick="dl()">Download CSV</button></div>' +
      '<table><thead><tr><th></th><th class="r">On hand</th><th class="r">Last count</th><th class="r">Change</th><th class="r">Bought<small>invoices between</small></th><th class="r">Used<small>last + bought − now</small></th><th class="r">Cost %<small>used ÷ sales</small></th></tr></thead><tbody>' + sumRows + '</tbody>' +
      '<tfoot><tr><td>Total</td><td class="r">' + M(T.val) + '</td><td class="r">' + (prevDay ? M(T.pval) : '—') + '</td><td class="r">' + (prevDay ? M(T.val - T.pval) : '—') + '</td><td class="r">' + (prevDay ? M(T.buy) : '—') + '</td><td class="r">' + (prevDay ? M(T.used) : '—') + '</td><td class="r">' + (sales && prevDay ? P(T.used / sales.net) : '—') + '</td></tr></tfoot></table>' +
      '<p class="note">On hand = count × the item’s cost in the inventory. Bought comes from invoices scanned in Inventory dated after the last count and up to this one' + (invs ? ' (' + buyN + ' invoice' + (buyN === 1 ? '' : 's') + ')' : '') + '. Used is the cost of what went out: food and beverage cost for the period' + (sales ? '; cost % uses food and beverage sales from ' + sales.weeks + ' payroll week' + (sales.weeks === 1 ? '' : 's') + ' in between (paper goods against all net sales)' : '') + '. Items not counted, or with no cost, aren’t in the totals.</p>' +
      (bevSub && Object.keys(bevSub.subs).length ? '<div class="box"><h3>Beverages on hand</h3><ul>' + ['beer', 'wine', 'liquor', 'na'].filter(function (k) { return bevSub.subs[k]; }).map(function (k) { return '<li>' + SUBN[k] + ': ' + M(bevSub.subs[k]) + '</li>'; }).join('') + '</ul></div>' : '') +
      '<div class="grid">' + list('Below par', below, function (x) { return '<li>' + esc(x.it.name) + ': ' + q(x.n) + ' ' + esc(x.it.unit || '') + ' (par ' + q(+x.it.par) + ')</li>'; }) +
      list('Biggest changes in value', moves.filter(function (x) { return Math.abs(x.d) >= 0.5; }).slice(0, 12), function (x) { return '<li>' + esc(x.it.name) + ': ' + (x.d > 0 ? '+' : '−') + money(Math.abs(x.d)) + '</li>'; }) +
      list('Counted but no cost yet', nocost, function (it) { return '<li>' + esc(it.name) + '</li>'; }) +
      list('Not counted', notCounted, function (it) { return '<li>' + esc(it.name) + ' <span style="color:#777">(' + esc(catOf(it.category).label) + ')</span></li>'; }) + '</div>' +
      detail + '</body></html>';
    var csv = [['Category', 'Section', 'Item', 'Pack', 'Unit', 'Count', 'Last count', 'Cost', 'Value']];
    cats.forEach(function (c) { var cur = rowFor(c.id, day), prev = rowFor(c.id, prevDay); sheetOrder(c.id).forEach(function (it) { var n = cur.counts[it.id], pn = prev && prev.counts[it.id] != null ? prev.counts[it.id] : ''; csv.push([c.label, it.section || '', it.name, it.pack || '', it.unit || '', n == null ? '' : n, pn, it.cost == null ? '' : it.cost, n != null && it.cost != null && it.cost !== '' ? (n * it.cost).toFixed(2) : '']); }); });
    var csvText = csv.map(function (r) { return r.map(function (v) { v = String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
    w.document.open(); w.document.write(html); w.document.close();
    w.dl = function () { var a = w.document.createElement('a'); a.href = URL.createObjectURL(new Blob([csvText], { type: 'text/csv' })); a.download = 'Eden inventory ' + day + '.csv'; w.document.body.appendChild(a); a.click(); a.remove(); };
  }
  function countSheet() {
    flush();
    var boxes = CATS.map(function (c) { var n = I.items.filter(function (it) { return it.category === c.id && it.active !== false; }).length; var cb = h('input', { type: 'checkbox', value: c.id }); cb.checked = c.id === I.cat; return [cb, h('label', { cls: 'sc-check' }, [cb, ' ' + c.label + ' (' + n + ')'])]; });
    var optLast = h('input', { type: 'checkbox' }), optPar = h('input', { type: 'checkbox' }), optVendor = h('input', { type: 'checkbox' });
    optLast.checked = true; optPar.checked = true;
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var m = modal('Print a count sheet', [
      h('p', { cls: 'sc-sub', text: 'Each one prints on its own pages, grouped like the inventory, with a box to write the count in. Enter the counts here afterwards.' }),
      h('div', { cls: 'iv-cs-opts' }, [h('b', { text: 'Sheets' })].concat(boxes.map(function (b) { return b[1]; }))),
      h('div', { cls: 'iv-cs-opts' }, [h('b', { text: 'Columns' }), h('label', { cls: 'sc-check' }, [optLast, ' Last count']), h('label', { cls: 'sc-check' }, [optPar, ' Par']), h('label', { cls: 'sc-check' }, [optVendor, ' Vendor'])]),
      msg
    ], [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { m.close(); } } }),
      h('button', { type: 'button', cls: 'ed-btn', text: 'Print', on: { click: function () {
        var cats = boxes.filter(function (b) { return b[0].checked; }).map(function (b) { return b[0].value; });
        if (!cats.length) { msg.textContent = 'Pick at least one sheet.'; return; }
        if (printSheets(cats, { last: optLast.checked, par: optPar.checked, vendor: optVendor.checked }) === false) { msg.textContent = 'Allow pop-ups for the staff site to print.'; return; }
        m.close();
      } } })]);
  }
  function printSheets(cats, o) {
    var esc = function (t) { return String(t == null ? '' : t).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
    var num = function (v) { return v == null ? '' : String(Math.round(v * 100) / 100); };
    var SUBN = { beer: 'Beer', wine: 'Wine', liquor: 'Liquor', na: 'N/A (non-alcoholic)' };
    var pages = cats.map(function (cid) {
      var c = catOf(cid), order = SECTIONS[cid] || [];
      var last = I.counts.filter(function (r) { return r.category === cid && r.counts && Object.keys(r.counts).length; }).sort(function (a, b) { return a.count_date < b.count_date ? 1 : -1; })[0] || null;
      var items = I.items.filter(function (it) { return it.category === cid && it.active !== false; }).sort(function (a, b) {
        var sa = cid === 'bev' ? ['beer', 'wine', 'liquor', 'na'].indexOf(subOf(a)) : 0, sb = cid === 'bev' ? ['beer', 'wine', 'liquor', 'na'].indexOf(subOf(b)) : 0;
        var ia = order.indexOf(a.section), ib = order.indexOf(b.section); if (ia < 0) ia = 999; if (ib < 0) ib = 999;
        return sa - sb || ia - ib || String(a.section).localeCompare(b.section) || (a.sort || 0) - (b.sort || 0) || String(a.name).localeCompare(b.name);
      });
      var cols = '<th class="it">Item</th><th class="u">Unit</th>' + (o.vendor ? '<th class="v">Vendor</th>' : '') + (o.par ? '<th class="p">Par</th>' : '') + (o.last ? '<th class="l">Last' + (last ? '<small>' + esc(last.count_date.slice(5).replace('-', '/')) + '</small>' : '') + '</th>' : '') + '<th class="c">Count</th><th class="nt">Notes</th>';
      var ncol = 4 + (o.vendor ? 1 : 0) + (o.par ? 1 : 0) + (o.last ? 1 : 0);
      var body = '', curSub = null, curSec = null;
      items.forEach(function (it) {
        if (cid === 'bev' && subOf(it) !== curSub) { curSub = subOf(it); curSec = null; body += '<tr class="sub"><td colspan="' + ncol + '">' + esc(SUBN[curSub] || curSub) + '</td></tr>'; }
        if ((it.section || 'Other') !== curSec) { curSec = it.section || 'Other'; body += '<tr class="sec"><td colspan="' + ncol + '">' + esc(curSec) + '</td></tr>'; }
        var lv = last && last.counts[it.id] != null ? last.counts[it.id] : null;
        body += '<tr><td class="it">' + esc(it.name) + (it.pack ? '<small>' + esc(it.pack) + '</small>' : '') + '</td><td class="u">' + esc(it.unit) + '</td>' + (o.vendor ? '<td class="v">' + esc(it.vendor) + '</td>' : '') + (o.par ? '<td class="p">' + num(it.par) + '</td>' : '') + (o.last ? '<td class="l">' + num(lv) + '</td>' : '') + '<td class="c"></td><td class="nt"></td></tr>';
      });
      for (var i = 0; i < 4; i++) body += '<tr class="blank"><td class="it"></td><td class="u"></td>' + (o.vendor ? '<td></td>' : '') + (o.par ? '<td></td>' : '') + (o.last ? '<td></td>' : '') + '<td class="c"></td><td class="nt"></td></tr>';
      return '<section class="page"><header><div><h1>Eden · ' + esc(c.label) + ' inventory</h1><span>' + items.length + ' items · write in anything missing at the end</span></div><div class="who"><span>Date <i></i></span><span>Counted by <i></i></span></div></header>' +
        '<table><thead><tr>' + cols + '</tr></thead><tbody>' + body + '</tbody></table></section>';
    }).join('');
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>Eden inventory count sheet</title><style>' +
      '@page{size:letter;margin:.45in}body{font:10pt/1.25 -apple-system,Helvetica,Arial,sans-serif;color:#111;margin:0;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
      '.page{break-after:page;page-break-after:always}.page:last-child{break-after:auto;page-break-after:auto}' +
      'header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:8px;gap:16px}header h1{font:600 17pt Georgia,serif;margin:0}header span{font-size:8.5pt;color:#555}' +
      '.who{display:flex;gap:16px}.who span{font-size:9pt;color:#111;display:flex;align-items:flex-end;gap:6px}.who i{display:inline-block;width:1.3in;border-bottom:1px solid #111;height:14px}' +
      'table{width:100%;border-collapse:collapse}thead{display:table-header-group}th{font-size:7.5pt;text-transform:uppercase;letter-spacing:.06em;text-align:left;border-bottom:1.5px solid #111;padding:4px 6px}th small{display:block;font-weight:400;letter-spacing:0;text-transform:none}' +
      'td{border-bottom:1px solid #bbb;padding:4px 6px;vertical-align:middle;height:.27in}tr{break-inside:avoid;page-break-inside:avoid}' +
      'td.it small{color:#666;font-size:7.5pt;margin-left:6px}td.u,td.p,td.l,td.v{color:#444;font-size:8.5pt;white-space:nowrap}td.p,td.l,th.p,th.l{text-align:right;width:.55in}' +
      'td.c,th.c{width:.85in;text-align:center}td.c{border:1.5px solid #111;background:#fff}td.nt,th.nt{width:1.6in}' +
      'tr.sec td{background:#eee;font-weight:700;font-size:8.5pt;text-transform:uppercase;letter-spacing:.06em;height:auto;padding:5px 6px;border-bottom:1px solid #111}' +
      'tr.sub td{font:600 13pt Georgia,serif;height:auto;padding:12px 6px 4px;border-bottom:2px solid #111}' +
      '.backside{break-before:page;page-break-before:always;break-after:page;page-break-after:always;height:9.5in;display:flex;align-items:center;justify-content:center;color:#999;font-size:9pt}' +
      '@media screen{body{width:7.6in;margin:0 auto}}' +
      '</style></head><body>' + pages +
      // printed two-sided, each sheet starts on the front of a new piece of paper: after a sheet with an odd number of pages, add a blank back
      '<script>window.onload=function(){var H=10.1*96,ps=[].slice.call(document.querySelectorAll(".page"));ps.forEach(function(p,i){if(i===ps.length-1)return;var th=p.querySelector("thead"),hh=th?th.offsetHeight:0,h=p.offsetHeight,n=Math.ceil(h/H);n=Math.ceil((h+(n-1)*hh)/H);if(n%2===1){var b=document.createElement("div");b.className="backside";b.textContent="This side intentionally left blank";p.parentNode.insertBefore(b,p.nextSibling);}});setTimeout(function(){window.print()},250)}<\/script></body></html>';
    var w = window.open('', '_blank');
    if (!w) return false;
    w.document.open(); w.document.write(html); w.document.close();
  }
  function orderList() {
    var items = catItems(), byVendor = {}, notCounted = 0, noPar = 0;
    items.forEach(function (it) {
      var oh = onHand(it);
      if (it.par == null) { noPar++; return; }
      if (oh == null) { notCounted++; return; }
      var need = it.par - oh; if (need <= 0) return;
      var v = it.vendor || 'No vendor';
      (byVendor[v] = byVendor[v] || []).push({ it: it, need: need });
    });
    var vendors = Object.keys(byVendor).sort(function (a, b) { return a === 'No vendor' ? 1 : b === 'No vendor' ? -1 : a.localeCompare(b); });
    var lines = ['Eden ' + catOf(I.cat).label + ' order · count of ' + dayLabel(I.date)];
    var body = [h('p', { cls: 'sc-sub', text: 'Items below par in the ' + dayLabel(I.date) + ' count. Order = par − on hand.' })];
    if (!vendors.length) body.push(h('p', { cls: 'sc-empty', text: notCounted ? 'Nothing below par among the items counted so far.' : 'Nothing below par.' }));
    vendors.forEach(function (v) {
      lines.push('', v.toUpperCase());
      var ul = h('ul', { cls: 'iv-olist' });
      byVendor[v].forEach(function (x) {
        var o = orderQty(x.it, x.need);
        var t = o.text + ' ' + x.it.name + (x.it.pack ? ' (' + x.it.pack + ')' : '') + (o.note ? ' [' + o.note + ']' : '');
        lines.push('• ' + t.replace(/\s+/g, ' ').trim());
        ul.appendChild(h('li', null, [h('b', { text: o.text }), ' ' + x.it.name, x.it.pack ? h('small', { text: ' ' + x.it.pack }) : null, o.note ? h('small', { text: ' · ' + o.note }) : null]));
      });
      body.push(h('div', { cls: 'iv-ovendor' }, [h('h3', { text: v }), ul]));
    });
    var notes = [];
    if (notCounted) notes.push(notCounted + ' item' + (notCounted === 1 ? ' hasn’t' : 's haven’t') + ' been counted on this date');
    if (noPar) notes.push(noPar + ' item' + (noPar === 1 ? ' has' : 's have') + ' no par set');
    if (notes.length) body.push(h('p', { cls: 'sc-small', text: notes.join(' · ') + '.' }));
    var text = lines.join('\n');
    var m = modal('Order list · ' + catOf(I.cat).label, body, [
      h('span', { cls: 'sc-sp' }),
      vendors.length ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Copy list', on: { click: function (ev) {
        var b = ev.currentTarget;
        (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { b.textContent = 'Copied'; }, function () { window.prompt('Copy the order list:', text); });
      } } }) : null,
      h('button', { type: 'button', cls: 'ed-btn', text: 'Done', on: { click: function () { m.close(); } } })
    ], true);
    m.el.__text = text;
  }

  window.EdenInventory = {
    show: function (ctx) {
      I.ctx = ctx; I.el = ctx.el;
      if (ctx.arg && /^drive/.test(ctx.arg) && window.EdenInvoiceScan) { var arg = ctx.arg; setTimeout(function () { window.EdenInvoiceScan.handleArg(scanApi(), arg); }, 0); }
      if (!I.loaded && !I.loading) { render(); load().then(render); } else render();
    },
    refresh: function () { if (I.el && !I.el.hidden) render(); },
    _test: { I: I, catItems: catItems, scanInvoice: function () { scanInvoice(); } }
  };
})();
