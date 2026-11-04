/* Eden staff site: inventory.
 *
 * Three inventories, each its own tab: Food, Paper goods, and Beer, wine & liquor. Each has a list of
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
    { id: 'bev', label: 'Beer, wine & liquor', short: 'Beverage' }
  ];
  var SECTIONS = {
    food: ['Produce', 'Protein', 'Seafood', 'Dairy & eggs', 'Dry goods', 'Spices', 'Oils & vinegars', 'Bread & bakery', 'Frozen', 'Coffee & tea', 'Soft drinks & juice', 'Menu ingredients'],
    paper: ['To-go', 'Front of house', 'Kitchen', 'Restroom', 'Cleaning'],
    bev: ['Draught beer', 'Canned beer', 'Sparkling wine', 'White wine', 'Rosé', 'Red wine', 'Dessert wine', 'Aperitif', 'Bourbon', 'Rye', 'Malt', 'Gin', 'Vodka', 'Agave', 'Rum', 'Specialty', 'Digestif', 'Liqueurs & mixers']
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
    saveT: null, saving: false, pending: false, filter: '' };

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
    return I.items.filter(function (it) { return it.category === I.cat; }).sort(function (a, b) {
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
      sb().from('inventory_settings').select('*').eq('id', 1).maybeSingle().then(function (r) { return r.error ? null : r.data; }, function () { return null; })
    ]).then(function (res) {
      I.items = res[0]; I.counts = res[1]; I.orderCols = res[2]; I.costCols = res[3]; I.loaded = true; I.missing = false; I.loading = false;
      if (res[4] && window.EdenCosting) window.EdenCosting.setSettings(res[4]);
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
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Print', on: { click: function () { window.print(); } } }),
        h('button', { type: 'button', cls: 'ed-btn', text: 'Add item', on: { click: function () { editItem(null); } } })
      ])
    ]));
    if (window.EdenInvoiceScan && window.EdenInvoiceScan.bar) wrap.appendChild(window.EdenInvoiceScan.bar(scanApi()));
    var alerts = alertsCard(); if (alerts) wrap.appendChild(alerts);
    wrap.appendChild(h('div', { cls: 'sc-tabs iv-tabs', role: 'tablist' }, CATS.map(function (c) {
      return h('button', { type: 'button', role: 'tab', 'aria-selected': c.id === I.cat ? 'true' : 'false', 'data-cat': c.id, on: { click: function () { if (c.id !== I.cat) { flush(); I.cat = c.id; I.filter = ''; render(); } } } },
        [c.label, counts[c.id] ? h('span', { cls: 'sc-count', text: String(counts[c.id]) }) : null]);
    })));

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
    var ncol = I.showCost ? 12 : 10;
    var table = h('table', { cls: 'iv-table' + (I.showCost ? ' iv-wide' : '') });
    table.appendChild(h('thead', null, h('tr', null, [
      h('th', { cls: 'iv-name', text: 'Item' }), h('th', { cls: 'iv-vend', text: 'Vendor' }), h('th', { text: 'Unit' }), h('th', { cls: 'r', text: 'Par' }), h('th', { cls: 'r', text: 'Last' }),
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
        it.pack || it.order_unit ? h('small', { text: [it.pack, orderedBy(it) ? 'ordered ' + orderedBy(it) : ''].filter(Boolean).join(' · ') }) : null]),
      h('td', { cls: 'iv-vend', text: it.vendor || '' }),
      h('td', { cls: 'iv-unit', text: it.unit || '' }),
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
      I.cat === 'food' ? h('button', { type: 'button', cls: cls, text: 'Add ingredients, coffee & soft drinks from the menu', on: { click: fromMenuFood } }) : null,
      I.cat === 'paper' ? h('button', { type: 'button', cls: cls, text: 'Add common paper goods', on: { click: paperStarter } }) : null,
      h('label', { cls: 'ed-btn small sc-file' }, ['Import spreadsheet', h('input', { type: 'file', accept: '.xlsx,.xls,.csv', on: { change: function (ev) { var f = ev.target.files[0]; ev.target.value = ''; if (f) importFile(f); } } })]),
      window.EdenCosting && I.settingsOn ? h('button', { type: 'button', cls: cls, text: 'Pour sizes (' + window.EdenCosting.settings.glass_oz + ' oz wine · ' + window.EdenCosting.settings.pour_oz + ' oz spirits)', on: { click: pourSizes } }) : null,
      h('a', { cls: 'sc-link', href: TEMPLATE, download: 'eden-inventory.xlsx', text: 'Download the inventory spreadsheet' })
    ];
  }

  /* ---------- adding items in bulk ---------- */
  function addMany(list, what) {
    var have = {}; I.items.forEach(function (it) { if (it.category === I.cat) have[keyOf(it.name)] = 1; });
    var fresh = list.filter(function (it) { var k = keyOf(it.name); if (!k || have[k]) return false; have[k] = 1; return true; });
    if (!fresh.length) { status('Nothing new to add: those items are already on the list.', 'ok'); return Promise.resolve(); }
    fresh.forEach(function (it, i) { it.id = uid(); it.category = I.cat; it.sort = i; it.par = it.par == null ? null : it.par; it.cost = it.cost == null ? null : it.cost; });
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
        if (sec) (g.items || []).filter(shown).forEach(function (it) { out.push({ section: sec, name: it.name, unit: sec === 'Coffee & tea' ? 'bag' : 'case', pack: it.desc || '', vendor: '' }); });
      });
    });
    addMany(out, 'items from the menu (kitchen ingredients go in “Menu ingredients”; edit each to move it to its section)');
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

  function scanApi() { return { items: I.items, saveItems: saveItems, sb: sb(), status: status, done: function () { render(); loadAlerts().then(render); }, modal: modal, h: h, cat: I.cat, uid: uid, orderCols: I.orderCols }; }
  function orderedBy(it) {   // "by the case of 6", "by the bottle"
    if (!it.order_unit) return '';
    return 'by the ' + it.order_unit + (it.order_unit === 'case' && it.per_case ? ' of ' + qty(+it.per_case) : '');
  }
  function scanInvoice() { flush(); window.EdenInvoiceScan.open(scanApi()); }

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
  function priceChart(pts, unit) {
    if (pts.length < 2) return null;
    var W = 420, H = 90, P = 8, vals = pts.map(function (p) { return +p.unit_cost; }), lo = Math.min.apply(null, vals), hi = Math.max.apply(null, vals), span = hi - lo || hi * 0.1 || 1;
    var x = function (i) { return P + (W - 2 * P) * i / (pts.length - 1); }, y = function (v) { return H - P - (H - 2 * P) * (v - lo) / span; };
    var d = vals.map(function (v, i) { return (i ? 'L' : 'M') + x(i).toFixed(1) + ' ' + y(v).toFixed(1); }).join(' ');
    var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svg.setAttribute('class', 'iv-chart'); svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Cost per ' + (unit || 'unit') + ' from ' + money(vals[0]) + ' to ' + money(vals[vals.length - 1]));
    var path = document.createElementNS(ns, 'path'); path.setAttribute('d', d); path.setAttribute('class', 'iv-chart-l'); svg.appendChild(path);
    vals.forEach(function (v, i) {
      var c = document.createElementNS(ns, 'circle'); c.setAttribute('cx', x(i)); c.setAttribute('cy', y(v)); c.setAttribute('r', 4); c.setAttribute('class', 'iv-chart-d');
      var t = document.createElementNS(ns, 'title'); t.textContent = dayLabel(pts[i].price_date) + ': ' + money(v) + (unit ? ' / ' + unit : '') + (pts[i].vendor ? ' · ' + pts[i].vendor : ''); c.appendChild(t);
      svg.appendChild(c);
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
  function lbl(text, input) { return h('label', { cls: 'sc-f' }, [h('span', { text: text }), input]); }
  function datalist(id, vals) { return h('datalist', { id: id }, vals.map(function (v) { return h('option', { value: v }); })); }
  function uniq(list) { var s = {}; return list.filter(function (x) { x = String(x || '').trim(); if (!x || s[x.toLowerCase()]) return false; s[x.toLowerCase()] = 1; return true; }); }

  function editItem(it) {
    var isNew = !it;
    it = it || { id: uid(), category: I.cat, section: '', name: '', unit: '', pack: '', vendor: '', par: null, cost: null, sort: 0 };
    var catItemsAll = I.items.filter(function (x) { return x.category === I.cat; });
    var f = {
      name: h('input', { type: 'text', value: it.name || '', placeholder: I.cat === 'bev' ? 'e.g. Tito’s Vodka' : I.cat === 'paper' ? 'e.g. To-go containers, large' : 'e.g. Heavy cream' }),
      section: h('input', { type: 'text', value: it.section || '', list: 'ivSections', placeholder: (SECTIONS[I.cat] || [])[0] || '' }),
      unit: h('input', { type: 'text', value: it.unit || '', list: 'ivUnits', placeholder: 'e.g. case, lb, bottle' }),
      pack: h('input', { type: 'text', value: it.pack || '', placeholder: 'e.g. 6/#10 cans, 750ml' }),
      vendor: h('input', { type: 'text', value: it.vendor || '', list: 'ivVendors', placeholder: 'Optional' }),
      par: h('input', { type: 'text', inputmode: 'decimal', value: qty(it.par), placeholder: 'How many to keep on hand' }),
      cost: h('input', { type: 'text', inputmode: 'decimal', value: it.cost != null ? String(it.cost) : '', placeholder: 'Cost per unit, e.g. 24.50' }),
      ord: h('select', null, [['', 'Not set'], ['bottle', 'By the bottle'], ['case', 'By the case'], ['each', 'By the each'], ['lb', 'By the pound']].map(function (o) { return h('option', { value: o[0], text: o[1] }); })),
      pc: h('input', { type: 'text', inputmode: 'decimal', value: it.per_case != null ? qty(+it.per_case) : '', placeholder: 'e.g. 6 or 12' })
    };
    f.ord.value = it.order_unit || '';
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
      h('div', { cls: 'sc-row2' }, [lbl('Section', f.section), lbl('Counted in (unit)', f.unit)]),
      h('div', { cls: 'sc-row2' }, [lbl('Pack size / notes', f.pack), lbl('Vendor', f.vendor)]),
      h('div', { cls: 'sc-row2' }, [lbl('Par', f.par), lbl('Cost per unit ($)', f.cost)]),
      I.orderCols ? h('div', { cls: 'sc-row2' }, [lbl('Ordered from the vendor', f.ord), lbl('How many in a case', f.pc)]) : null,
      datalist('ivSections', uniq((SECTIONS[I.cat] || []).concat(catItemsAll.map(function (x) { return x.section; })))),
      datalist('ivUnits', UNITS), datalist('ivVendors', uniq(I.items.map(function (x) { return x.vendor; }))),
      msg
    ], foot);
    m.el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); save(); } });
    var draft = { name: it.name, pack: it.pack, unit: it.unit, cost: it.cost, per_case: it.per_case, menu_refs: (Array.isArray(it.menu_refs) ? it.menu_refs : []).slice() };
    if (!isNew && I.costCols && window.EdenCosting) msg.parentNode.insertBefore(menuLinks(draft), msg);
    if (!isNew) sb().from('inventory_prices').select('price_date,vendor,invoice_line,invoice_price,invoice_unit,per_unit,unit_cost').eq('item_id', it.id).order('price_date', { ascending: false }).order('created_at', { ascending: false }).limit(24).then(function (r) {
      if (r.error || !r.data || !r.data.length) return;
      msg.parentNode.insertBefore(h('div', { cls: 'iv-hist' }, [h('b', { text: 'Price history from invoices' }), priceChart(r.data.slice().reverse(), it.unit), h('ul', null, r.data.slice(0, 8).map(function (p) {
        return h('li', null, [h('span', { text: dayLabel(p.price_date) + ' · ' + (p.vendor || '') }), h('span', { text: money(p.unit_cost) + (it.unit ? ' / ' + it.unit : '') + (p.per_unit && +p.per_unit !== 1 ? ' (' + money(p.invoice_price) + ' / ' + (p.invoice_unit || 'unit') + ' ÷ ' + (+p.per_unit) + ')' : '') })]);
      }))]), msg);
    });
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
      if (I.orderCols) { next.order_unit = f.ord.value; next.per_case = num(f.pc.value); }
      if (I.costCols) next.menu_refs = draft.menu_refs;
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
    return { text: qty(need) + ' ' + (it.unit || ''), note: it.order_unit ? 'by the ' + it.order_unit : '' };
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
