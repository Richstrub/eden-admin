/* Eden staff site: Recipes → Cocktail builds, and the monthly cocktail tally.
 *
 * Each build lists its pours (1.5 oz Steelbound Reposado, ¾ oz lime…), the glass, ice, garnish and method, the menu
 * cocktail it's sold as, and which inventory item each spirit comes out of. That gives every cocktail a cost and
 * cost % from the inventory's prices.
 *
 * Monthly tally: print a sheet listing every cocktail with a box per week; the bartender tallies what sold; enter the
 * totals back here; "Liquor used" turns them into ounces, bottles and dollars per inventory item for the month.
 *
 * Data: cocktail_builds, cocktail_sales (supabase/cocktails.sql); inventory_items for the links and prices.
 */
(function () {
  'use strict';
  var C = { ctx: null, el: null, list: [], sales: {}, inv: [], loaded: false, missing: false, invOk: false, open: null };
  var OZ = { oz: 1, 'fl oz': 1, ml: 1 / 29.5735, cl: 0.33814, dash: 1 / 32, dashes: 1 / 32, barspoon: 0.125, bsp: 0.125, tsp: 1 / 6, tbsp: 0.5, rinse: 0.25, drop: 1 / 600, drops: 1 / 600, splash: 0.25, float: 0.5 };
  var UNITS = ['oz', 'ml', 'dash', 'barspoon', 'tsp', 'tbsp', 'rinse', 'splash', 'float', 'drop', 'each', 'leaf', 'slice', 'wedge', 'sprig'];

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'cls') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else if (k === 'value') e.value = v; else if (v === true) e.setAttribute(k, ''); else e.setAttribute(k, v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function sb() { return C.ctx.sb; }
  function status(t, k) { if (C.ctx && C.ctx.status) C.ctx.status(t, k); }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function isMissing(e) { return e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message || '')); }
  function num(v) { if (v === '' || v == null) return null; var s = String(v).trim().replace(/¼/g, '.25').replace(/½/g, '.5').replace(/¾/g, '.75'); var m = s.match(/^(\d+)\s+(\d+)\/(\d+)$/); if (m) return +m[1] + m[2] / m[3]; m = s.match(/^(\d+)\/(\d+)$/); if (m) return m[1] / m[2]; var n = parseFloat(s.replace(/,/g, '')); return isNaN(n) ? null : n; }
  function money(n) { return n == null || !isFinite(n) ? '—' : '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function qtyText(q) { if (q == null) return ''; var w = Math.floor(q), f = Math.round((q - w) * 4) / 4, fr = { 0.25: '¼', 0.5: '½', 0.75: '¾' }[f]; if (fr && Math.abs(q - w - f) < 0.01) return (w ? w : '') + fr; return String(Math.round(q * 100) / 100); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function canEdit() { return !!(C.ctx && C.ctx.canEdit); }
  function menu() { return (C.ctx && C.ctx.getMenu && C.ctx.getMenu()) || window.EDEN_MENU_SEED || { tabs: [] }; }
  function monthIso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-01'; }
  function monthLabel(iso) { var p = iso.split('-'); return new Date(+p[0], +p[1] - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); }

  // the cocktails on the menu (Cocktails tab: everything but aperitifs), with prices
  function menuCocktails() {
    var out = [];
    (menu().tabs || []).forEach(function (t) {
      if (!(t.id === 'm-bar' || /cocktail|bar/i.test(t.label || ''))) return;
      (t.groups || []).forEach(function (g) {
        if (/aperitif|amaro|liqueur|digestif/i.test(g.title || '')) return;
        (g.items || []).forEach(function (m) { if (m && !m.hidden && m.name) out.push({ name: m.name, desc: m.desc || '', price: parseFloat(String(m.price || '').replace(/[^0-9.]/g, '')) || null, group: g.title || '' }); });
      });
    });
    return out;
  }
  function menuFor(b) { var n = norm(b.menu_name || b.name); return menuCocktails().filter(function (m) { return norm(m.name) === n; })[0] || null; }

  /* ---------- inventory: links and cost per ounce ---------- */
  function invItem(id) { return C.inv.filter(function (x) { return x.id === id; })[0] || null; }
  function costPerOz(it) {
    if (!it || !window.EdenCosting) return null;
    var one = window.EdenCosting.oneCost(it); if (one == null) return null;
    var u = String(it.unit || '').toLowerCase();
    if (/^(keg)$/.test(u)) return one / 661;
    if (/^(can|each|ea)$/.test(u) && /oz/.test(it.pack || '')) { var oz = parseFloat((String(it.pack).match(/(\d+(\.\d+)?)\s*oz/) || [])[1]); return oz ? one / oz : null; }
    return one / (window.EdenCosting.bottleMl(it) / 29.5735);
  }
  function bottleOz(it) { return window.EdenCosting ? window.EdenCosting.bottleMl(it) / 29.5735 : 25.36; }
  function ozOf(ing) { var f = OZ[String(ing.unit || 'oz').toLowerCase()]; return ing.qty != null && f ? ing.qty * f : null; }
  function buildCost(b) {
    var total = 0, missing = 0;
    (b.ingredients || []).forEach(function (g) {
      if (!g.inv_id) return;
      var oz = ozOf(g), cpo = costPerOz(invItem(g.inv_id));
      if (oz == null || cpo == null) { missing++; return; }
      total += oz * cpo;
    });
    var m = menuFor(b);
    return { cost: total, missing: missing, price: m && m.price, pct: m && m.price && total ? total / m.price : null };
  }
  // best inventory match for an ingredient's words ("Reposado" → Steelbound · Reposado, "Cognac" → Maison Rogue · Cognac)
  function guessInv(text) {
    var w = norm(text).split(' ').filter(function (x) { return x.length > 2 && !/^(the|and|with|dry|house)$/.test(x); });
    if (!w.length) return null;
    var best = null, bs = 0;
    C.inv.forEach(function (it) {
      var hay = ' ' + norm(it.name + ' ' + (it.pack || '') + ' ' + (it.section || '')) + ' ';
      var s = w.filter(function (x) { return hay.indexOf(' ' + x) !== -1; }).length / w.length;
      if (s > bs) { bs = s; best = it; }
    });
    return bs >= 0.99 ? best : null;
  }

  /* ---------- data ---------- */
  function load() {
    return Promise.all([
      sb().from('cocktail_builds').select('*').order('sort').order('name'),
      sb().from('cocktail_sales').select('*'),
      sb().from('inventory_items').select('*').eq('category', 'bev')
    ]).then(function (r) {
      C.loaded = true;
      if (r[0].error) { C.missing = isMissing(r[0].error); C.list = []; return; }
      C.missing = false;
      C.list = (r[0].data || []).map(function (b) { b.ingredients = Array.isArray(b.ingredients) ? b.ingredients : []; return b; });
      C.sales = {}; (r[1].error ? [] : r[1].data || []).forEach(function (s) { C.sales[s.month] = s; });
      C.invOk = !r[2].error; C.inv = r[2].error ? [] : (r[2].data || []).filter(function (x) { return x.active !== false; });
    }, function () { C.loaded = true; });
  }
  function saveBuild(b) {
    var row = { id: b.id, name: b.name, menu_name: b.menu_name || '', glass: b.glass || '', garnish: b.garnish || '', ice: b.ice || '', method: b.method || '',
      ingredients: (b.ingredients || []).filter(function (g) { return String(g.item || '').trim(); }).map(function (g) { return { qty: g.qty == null ? null : +g.qty, unit: g.unit || '', item: String(g.item).trim(), inv_id: g.inv_id || null }; }),
      active: b.active !== false, sort: b.sort || 0, updated_by: (C.ctx && C.ctx.name) || '', updated_at: new Date().toISOString() };
    return sb().from('cocktail_builds').upsert(row, { onConflict: 'id' }).then(function (r) { if (r.error) throw r.error; return row; });
  }

  /* ---------- the page ---------- */
  function mount(ctx, el) {
    C.ctx = ctx; C.el = el;
    paint();
    if (!C.loaded) load().then(paint);
  }
  function paint() {
    var el = C.el; if (!el) return;
    el.innerHTML = '';
    if (!C.loaded) { el.appendChild(h('p', { cls: 'sc-empty', text: 'Loading cocktail builds…' })); return; }
    if (C.missing) { el.appendChild(h('div', { cls: 'iv-setup' }, [h('p', { text: canEdit() ? 'Cocktail builds aren’t in Supabase yet. In Supabase, open SQL Editor → New query, paste supabase/cocktails.sql from the eden-admin repository, and click Run. Then reload this page.' : 'Cocktail builds haven’t been set up yet.' })])); return; }
    var bar = h('div', { cls: 'ck-bar' }, [
      h('p', { cls: 'ck-lede', text: C.list.length ? C.list.filter(function (b) { return b.active !== false; }).length + ' cocktails · costs from the inventory’s prices' : 'No cocktail builds yet.' }),
      h('div', { cls: 'ck-tools' }, [
        C.list.length ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Print builds', title: 'A printable spec sheet of every cocktail on the menu', on: { click: function () { printBuilds(active()); } } }) : null,
        canEdit() ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Monthly tally', on: { click: tallyDialog } }) : null,
        canEdit() ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Add cocktails from the menu', on: { click: fromMenu } }) : null,
        canEdit() ? h('button', { type: 'button', cls: 'ed-btn small', text: 'New build', on: { click: function () { edit({ id: uid(), name: '', ingredients: [{ qty: 1.5, unit: 'oz', item: '' }, { qty: null, unit: 'oz', item: '' }], _new: true }); } } }) : null
      ])
    ]);
    el.appendChild(bar);
    if (!C.list.length) { el.appendChild(h('div', { cls: 'rc-pick' }, [h('p', { text: canEdit() ? 'Click “Add cocktails from the menu” to start a build for every cocktail on the menu, then fill in the pours.' : 'Nothing here yet.' })])); return; }
    var grid = h('div', { cls: 'ck-grid' });
    C.list.slice().sort(function (a, b) { return (a.active === false) - (b.active === false) || String(a.name).localeCompare(b.name); }).forEach(function (b) { grid.appendChild(card(b)); });
    el.appendChild(grid);
  }
  function card(b) {
    var c = buildCost(b), m = menuFor(b);
    return h('article', { cls: 'ck-card' + (b.active === false ? ' off' : '') }, [
      h('header', null, [h('div', null, [h('h3', { text: b.name }), h('p', { cls: 'ck-sub', text: [b.glass, b.ice, b.garnish ? 'garnish: ' + b.garnish : ''].filter(Boolean).join(' · ') || (m ? m.desc : '') })]),
        h('div', { cls: 'ck-price' }, [m && m.price ? h('b', { text: money(m.price) }) : null, c.pct != null ? h('span', { cls: c.pct >= 0.25 ? 'hi' : '', text: Math.round(c.pct * 1000) / 10 + '% cost' }) : null])]),
      h('ul', { cls: 'ck-pours' }, (b.ingredients || []).map(function (g) {
        var it = g.inv_id ? invItem(g.inv_id) : null;
        return h('li', null, [h('span', { cls: 'q', text: (qtyText(g.qty) + ' ' + (g.qty != null ? g.unit || '' : '')).trim() }), h('span', { cls: 'i', text: g.item }), it ? h('span', { cls: 'l', title: 'Inventory: ' + it.name, text: '●' }) : null]);
      })),
      b.method ? h('p', { cls: 'ck-method', text: b.method }) : null,
      h('footer', null, [h('span', { text: 'Cost ' + money(c.cost) + (c.missing ? ' (+' + c.missing + ' without a price)' : '') }),
        h('button', { type: 'button', cls: 'sc-link ck-edit', text: 'Print', on: { click: function () { printBuilds([b]); } } }),
        canEdit() ? h('button', { type: 'button', cls: 'sc-link ck-edit', text: 'Edit', on: { click: function () { edit(JSON.parse(JSON.stringify(b))); } } }) : null])
    ]);
  }

  /* ---------- dialogs ---------- */
  function modal(title, body, foot, wide) {
    var back = h('div', { cls: 'sc-modal' + (wide ? ' wide' : ''), role: 'dialog', 'aria-modal': 'true' });
    var cardEl = h('div', { cls: 'sc-card' }, [h('div', { cls: 'sc-card-h' }, [h('h2', { text: title }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: close } })]), h('div', { cls: 'sc-card-b' }, body), foot ? h('div', { cls: 'sc-card-f' }, foot) : null]);
    back.appendChild(cardEl);
    function close() { back.remove(); document.removeEventListener('keydown', esc); }
    function esc(ev) { if (ev.key === 'Escape') close(); }
    back.addEventListener('mousedown', function (ev) { if (ev.target === back) close(); });
    document.addEventListener('keydown', esc); document.body.appendChild(back);
    return { el: back, close: close };
  }
  function lbl(t, input) { return h('label', { cls: 'sc-f' }, [h('span', { text: t }), input]); }
  function invSelect(val) {
    var sel = h('select', { cls: 'ck-inv', 'aria-label': 'Inventory item' }, [h('option', { value: '', text: '— not tracked —' })]);
    var groups = {}; C.inv.forEach(function (it) { (groups[it.section || 'Other'] = groups[it.section || 'Other'] || []).push(it); });
    Object.keys(groups).sort().forEach(function (g) { var og = h('optgroup', { label: g }); groups[g].sort(function (a, b) { return String(a.name).localeCompare(b.name); }).forEach(function (it) { og.appendChild(h('option', { value: it.id, text: it.name + (it.pack ? ' (' + it.pack + ')' : '') })); }); sel.appendChild(og); });
    sel.value = val || '';
    return sel;
  }
  function edit(b) {
    var mlist = menuCocktails();
    var f = { name: h('input', { type: 'text', value: b.name || '', placeholder: 'e.g. Bad Apple' }),
      menu: h('select', null, [h('option', { value: '', text: '— not on the menu —' })].concat(mlist.map(function (m) { return h('option', { value: m.name, text: m.name + (m.price ? ' · $' + m.price : '') }); }))),
      glass: h('input', { type: 'text', value: b.glass || '', placeholder: 'Coupe, rocks…' }), ice: h('input', { type: 'text', value: b.ice || '', placeholder: 'Big cube, crushed, none…' }),
      garnish: h('input', { type: 'text', value: b.garnish || '', placeholder: 'Lemon twist' }), method: h('textarea', { rows: '3', placeholder: 'Shake hard 10 seconds, double strain…' }),
      active: h('input', { type: 'checkbox' }) };
    f.menu.value = b.menu_name || ''; f.method.value = b.method || ''; f.active.checked = b.active !== false;
    f.menu.addEventListener('change', function () { if (!f.name.value.trim()) f.name.value = f.menu.value; });
    var rows = h('div', { cls: 'ck-rows' });
    function row(g) {
      var q = h('input', { type: 'text', inputmode: 'decimal', cls: 'ck-q', value: g.qty == null ? '' : String(g.qty), placeholder: '1.5', 'aria-label': 'Amount' });
      var u = h('select', { cls: 'ck-u', 'aria-label': 'Unit' }, UNITS.map(function (x) { return h('option', { value: x, text: x }); })); u.value = UNITS.indexOf(g.unit) !== -1 ? g.unit : 'oz';
      var it = h('input', { type: 'text', cls: 'ck-i', value: g.item || '', placeholder: 'Steelbound Reposado, lime juice…', 'aria-label': 'Ingredient' });
      var inv = invSelect(g.inv_id);
      it.addEventListener('change', function () { if (!inv.value) { var gu = guessInv(it.value); if (gu) inv.value = gu.id; } });
      var del = h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Remove', text: '✕', on: { click: function () { r.remove(); } } });
      var r = h('div', { cls: 'ck-row' }, [q, u, it, inv, del]);
      r._get = function () { return { qty: num(q.value), unit: u.value, item: it.value.trim(), inv_id: inv.value || null }; };
      rows.appendChild(r);
    }
    (b.ingredients && b.ingredients.length ? b.ingredients : [{ qty: 1.5, unit: 'oz', item: '' }]).forEach(row);
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var m = modal(b._new ? 'New cocktail build' : 'Edit ' + (b.name || 'build'), [
      h('div', { cls: 'sc-row2' }, [lbl('Cocktail', f.name), lbl('Sold on the menu as', f.menu)]),
      h('div', { cls: 'sc-row3' }, [lbl('Glass', f.glass), lbl('Ice', f.ice), lbl('Garnish', f.garnish)]),
      h('div', { cls: 'ck-head' }, [h('b', { text: 'Build' }), h('span', { text: 'Link each spirit, wine or liqueur to its inventory item, so cocktail sales count toward liquor used. Base spirits are 1.5 oz.' })]),
      h('div', { cls: 'ck-row ck-labels' }, [h('span', { text: 'Amount' }), h('span', { text: 'Unit' }), h('span', { text: 'Ingredient' }), h('span', { text: 'Comes out of (inventory)' }), h('span')]),
      rows,
      h('button', { type: 'button', cls: 'ed-btn small', text: '+ Add an ingredient', on: { click: function () { row({ qty: null, unit: 'oz', item: '' }); } } }),
      lbl('Method', f.method),
      h('label', { cls: 'ck-active' }, [f.active, ' On the menu now (uncheck for a retired cocktail)']),
      !C.invOk ? h('p', { cls: 'sc-small', text: 'The inventory couldn’t be read with your login, so spirits can’t be linked.' }) : null,
      msg
    ], [!b._new ? h('button', { type: 'button', cls: 'ed-btn small danger', text: 'Delete', on: { click: del } }) : h('span'), h('span', { cls: 'sc-sp' }),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { m.close(); } } }),
      h('button', { type: 'button', cls: 'ed-btn', text: 'Save', on: { click: save } })], true);
    m.el.classList.add('ck-modal');
    function save() {
      var name = f.name.value.trim(); if (!name) { msg.textContent = 'Give the cocktail a name.'; f.name.focus(); return; }
      var next = Object.assign({}, b, { name: name, menu_name: f.menu.value, glass: f.glass.value.trim(), ice: f.ice.value.trim(), garnish: f.garnish.value.trim(), method: f.method.value.trim(), active: f.active.checked,
        ingredients: [].map.call(rows.children, function (r) { return r._get(); }).filter(function (g) { return g.item; }) });
      delete next._new;
      saveBuild(next).then(function (row) {
        var i = C.list.findIndex(function (x) { return x.id === row.id; }); if (i === -1) C.list.push(row); else C.list[i] = row;
        m.close(); status('Saved ' + name + '.', 'ok'); paint();
      }, function (e) { msg.textContent = /security|permission/i.test(e.message || '') ? 'Your role can’t change cocktail builds.' : 'Couldn’t save. Check your connection.'; });
    }
    function del() {
      if (!confirm('Delete the build for ' + b.name + '? (To keep its history, uncheck “On the menu now” instead.)')) return;
      sb().from('cocktail_builds').delete().eq('id', b.id).then(function (r) { if (r.error) { msg.textContent = 'Couldn’t delete.'; return; } C.list = C.list.filter(function (x) { return x.id !== b.id; }); m.close(); paint(); });
    }
  }
  // a build for every menu cocktail that doesn't have one: the description's first ingredient as a 1.5 oz base spirit
  function fromMenu() {
    var have = {}; C.list.forEach(function (b) { have[norm(b.menu_name || b.name)] = 1; });
    var add = menuCocktails().filter(function (m) { return !have[norm(m.name)]; }).map(function (m, i) {
      var parts = String(m.desc || '').split(/,|\band\b/).map(function (x) { return x.trim(); }).filter(function (x) { return x && !/^\d+(\.\d+)?\s*(oz|ml)\b/i.test(x) && !/^\d+(\.\d+)?%$/.test(x); });
      var mock = /mocktail/i.test(m.group);
      return { id: uid(), name: m.name, menu_name: m.name, sort: i, ingredients: parts.map(function (p, j) {
        var gu = !mock && j < 3 ? guessInv(p) : null;
        return { qty: j === 0 && !mock ? 1.5 : null, unit: 'oz', item: p, inv_id: gu ? gu.id : null };
      }) };
    });
    if (!add.length) { status('Every cocktail on the menu already has a build.', 'ok'); return; }
    status('Adding ' + add.length + ' cocktails…', 'dirty');
    Promise.all(add.map(saveBuild)).then(function (rows) { C.list = C.list.concat(rows); status('Added ' + rows.length + ' cocktails from the menu. Open each to fill in the pours and check the inventory links.', 'ok'); paint(); },
      function () { status('Couldn’t add them. Check your connection.', 'err'); });
  }

  /* ---------- monthly tally: print the sheet, enter the counts, liquor used ---------- */
  function active() { return C.list.filter(function (b) { return b.active !== false; }).sort(function (a, b) { return String(a.name).localeCompare(b.name); }); }
  function weeksOf(iso) {   // Sunday–Saturday weeks that touch the month, clipped to it
    var p = iso.split('-'), y = +p[0], mo = +p[1] - 1, d = new Date(y, mo, 1), out = [];
    while (d.getMonth() === mo) {
      var s = new Date(d), e = new Date(d); e.setDate(e.getDate() + (6 - e.getDay()));
      if (e.getMonth() !== mo) e = new Date(y, mo + 1, 0);
      out.push((s.getMonth() + 1) + '/' + s.getDate() + '–' + (e.getMonth() + 1) + '/' + e.getDate());
      d = new Date(e); d.setDate(d.getDate() + 1);
    }
    return out;
  }
  function tallyDialog() {
    var now = new Date(), opts = [];
    for (var i = -1; i < 12; i++) { var d = new Date(now.getFullYear(), now.getMonth() - i, 1); opts.push(monthIso(d)); }
    var sel = h('select', null, opts.map(function (o) { return h('option', { value: o, text: monthLabel(o) + (C.sales[o] ? ' · entered' : '') }); }));
    sel.value = monthIso(now);
    var m = modal('Monthly cocktail tally', [
      h('p', { cls: 'sc-sub', text: 'Print the sheet for the bar, have the bartender tally each cocktail sold, then enter the totals here at the end of the month. Liquor used turns them into ounces, bottles and cost for each spirit.' }),
      lbl('Month', sel),
      h('div', { cls: 'ck-steps' }, [
        h('button', { type: 'button', cls: 'ed-btn', text: '1 · Print the tally sheet', on: { click: function () { printSheet(sel.value); } } }),
        h('button', { type: 'button', cls: 'ed-btn', text: '2 · Enter the counts', on: { click: function () { m.close(); enterCounts(sel.value); } } }),
        h('button', { type: 'button', cls: 'ed-btn', text: '3 · Liquor used', on: { click: function () { m.close(); usage(sel.value); } } })
      ])
    ], [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Done', on: { click: function () { m.close(); } } })]);
  }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function printSheet(iso) {
    var list = active(), wk = weeksOf(iso);
    if (!list.length) { status('Add cocktail builds first.', 'err'); return; }
    var head = '<tr><th class="n">Cocktail</th>' + wk.map(function (w, i) { return '<th>Week ' + (i + 1) + '<small>' + w + '</small></th>'; }).join('') + '<th class="t">Total</th></tr>';
    var row = function (name, sub) { return '<tr><td class="n">' + esc(name) + (sub ? '<small>' + esc(sub) + '</small>' : '') + '</td>' + wk.map(function () { return '<td></td>'; }).join('') + '<td class="t"></td></tr>'; };
    var body = list.map(function (b) { var base = (b.ingredients || []).filter(function (g) { return g.inv_id; }).map(function (g) { return qtyText(g.qty) + ' ' + g.unit + ' ' + g.item; }).join(' · '); return row(b.name, base); }).join('') +
      [1, 2, 3, 4].map(function () { return row('', ''); }).join('');
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>Cocktail tally · ' + esc(monthLabel(iso)) + '</title><style>' +
      '@page{size:letter;margin:.5in}body{font:11pt/1.3 -apple-system,Helvetica,Arial,sans-serif;color:#111;margin:0}' +
      'h1{font:600 18pt Georgia,serif;margin:0}.top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:10px}' +
      '.who{font-size:10pt}.who span{display:inline-block;border-bottom:1px solid #111;width:2.2in;margin-left:6px}' +
      'p.how{font-size:9pt;color:#444;margin:0 0 8px}table{width:100%;border-collapse:collapse}th,td{border:1px solid #111;padding:6px 6px;vertical-align:top}' +
      'th{font-size:8.5pt;text-transform:uppercase;letter-spacing:.06em;background:#eee}th small{display:block;font-weight:400;text-transform:none;letter-spacing:0}' +
      'td{height:.42in}td.n{width:2.4in;font-weight:600}td.n small{display:block;font-weight:400;font-size:7.5pt;color:#555;margin-top:2px}td.t,th.t{width:.7in;background:#f6f6f6}' +
      '.foot{margin-top:12px;font-size:9pt;display:flex;justify-content:space-between}</style></head><body>' +
      '<div class="top"><div><h1>Eden · Cocktail tally</h1><div>' + esc(monthLabel(iso)) + '</div></div><div class="who">Bartender<span></span></div></div>' +
      '<p class="how">Make a tally mark for every cocktail sold (or write the number at the end of each night). Add each week, then the month in Total. Write in any specials on the blank lines with what went in them. Turn this sheet in on the 1st.</p>' +
      '<table><thead>' + head + '</thead><tbody>' + body + '</tbody></table>' +
      '<div class="foot"><span>Comps / spills / remakes: ____________________________________________</span><span>Checked by: ______________</span></div>' +
      '<script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>';
    var w = window.open('', '_blank');
    if (!w) { status('Allow pop-ups for the staff site to print the sheet.', 'err'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  // bar spec sheet: every build with its pours, glass, ice, garnish and method (two to a page side by side)
  function printBuilds(list) {
    if (!list.length) { status('No cocktail builds to print.', 'err'); return; }
    var cards = list.map(function (b) {
      var m = menuFor(b);
      var meta = [['Glass', b.glass], ['Ice', b.ice], ['Garnish', b.garnish]].filter(function (x) { return x[1]; }).map(function (x) { return '<span><b>' + x[0] + '</b> ' + esc(x[1]) + '</span>'; }).join('');
      var pours = (b.ingredients || []).map(function (g) { var q = (qtyText(g.qty) + ' ' + (g.qty != null ? g.unit || '' : '')).trim(); return '<tr><td class="q">' + esc(q) + '</td><td>' + esc(g.item) + '</td></tr>'; }).join('');
      return '<section class="card"><h2>' + esc(b.name) + (m && m.price ? '<em>$' + esc(m.price) + '</em>' : '') + '</h2>' + (meta ? '<div class="meta">' + meta + '</div>' : '') +
        '<table>' + pours + '</table>' + (b.method ? '<p class="method">' + esc(b.method).replace(/\n/g, '<br>') + '</p>' : '') + '</section>';
    }).join('');
    var html = '<!doctype html><html><head><meta charset="utf-8"><title>Eden cocktail builds</title><style>' +
      '@page{size:letter;margin:.5in}body{font:11pt/1.35 -apple-system,Helvetica,Arial,sans-serif;color:#111;margin:0}' +
      'header{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:6px;margin-bottom:14px}header h1{font:600 18pt Georgia,serif;margin:0}header span{font-size:9pt;color:#555}' +
      '.grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}.card{border:1px solid #111;border-radius:6px;padding:12px 14px;break-inside:avoid;page-break-inside:avoid}' +
      '.card h2{font:600 14pt Georgia,serif;margin:0 0 6px;display:flex;justify-content:space-between;gap:8px}.card h2 em{font:500 11pt -apple-system,Helvetica,Arial,sans-serif;font-style:normal}' +
      '.meta{display:flex;flex-wrap:wrap;gap:4px 14px;font-size:9.5pt;margin-bottom:6px}.meta b{font-size:7.5pt;text-transform:uppercase;letter-spacing:.08em;color:#555;margin-right:3px}' +
      'table{width:100%;border-collapse:collapse;font-size:10.5pt}td{padding:3px 0;border-top:1px solid #ddd;vertical-align:top}td.q{width:.85in;font-weight:600;white-space:nowrap}' +
      '.method{font-size:9.5pt;margin:8px 0 0;color:#222}' + (list.length === 1 ? '.grid{grid-template-columns:1fr;max-width:4.5in}' : '') +
      '</style></head><body><header><h1>Eden · Cocktail builds</h1><span>' + esc(new Date().toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })) + '</span></header>' +
      '<div class="grid">' + cards + '</div><script>window.onload=function(){setTimeout(function(){window.print()},250)}<\/script></body></html>';
    var w = window.open('', '_blank');
    if (!w) { status('Allow pop-ups for the staff site to print.', 'err'); return; }
    w.document.open(); w.document.write(html); w.document.close();
  }
  function enterCounts(iso) {
    var list = active(), saved = (C.sales[iso] && C.sales[iso].counts) || {}, inputs = {};
    // retired cocktails that were counted this month still show
    C.list.forEach(function (b) { if (b.active === false && saved[b.id] != null && list.indexOf(b) === -1) list.push(b); });
    var msg = h('p', { cls: 'sc-msg', role: 'status' }), notes = h('textarea', { rows: '2', placeholder: 'Comps, spills, remakes, specials…' });
    notes.value = (C.sales[iso] && C.sales[iso].notes) || '';
    var m = modal('Cocktails sold · ' + monthLabel(iso), [
      h('p', { cls: 'sc-sub', text: 'Type the Total column from the tally sheet. Leave blank for none.' }),
      h('div', { cls: 'ck-counts' }, list.map(function (b) {
        var i = h('input', { type: 'text', inputmode: 'numeric', value: saved[b.id] != null ? String(saved[b.id]) : '', 'aria-label': b.name + ' sold' });
        inputs[b.id] = i;
        i.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') { ev.preventDefault(); var all = m.el.querySelectorAll('.ck-counts input'), k = [].indexOf.call(all, i); if (all[k + 1]) all[k + 1].focus(); } });
        return h('label', { cls: 'ck-count' }, [h('span', { text: b.name }), i]);
      })),
      lbl('Notes', notes), msg
    ], [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { m.close(); } } }),
      h('button', { type: 'button', cls: 'ed-btn', text: 'Save & see liquor used', on: { click: function () {
        var counts = {}, bad = '';
        Object.keys(inputs).forEach(function (id) { var v = inputs[id].value.trim(); if (v === '') return; var n = num(v); if (n == null || n < 0) bad = bad || id; else counts[id] = Math.round(n); });
        if (bad) { msg.textContent = 'Counts should be whole numbers.'; inputs[bad].focus(); return; }
        var row = { month: iso, counts: counts, notes: notes.value.trim(), entered_by: (C.ctx && C.ctx.name) || '', updated_at: new Date().toISOString() };
        sb().from('cocktail_sales').upsert(row, { onConflict: 'month' }).then(function (r) {
          if (r.error) { msg.textContent = isMissing(r.error) ? 'Run supabase/cocktails.sql in Supabase first.' : 'Couldn’t save.'; return; }
          C.sales[iso] = row; m.close(); status('Saved ' + monthLabel(iso) + ' cocktail counts.', 'ok'); usage(iso);
        });
      } } })], true);
    setTimeout(function () { var first = m.el.querySelector('.ck-counts input'); if (first) first.focus(); }, 30);
  }
  function usage(iso) {
    var s = C.sales[iso], counts = (s && s.counts) || {}, per = {}, unlinked = {}, sold = 0;
    Object.keys(counts).forEach(function (id) {
      var b = C.list.filter(function (x) { return x.id === id; })[0], n = +counts[id] || 0; if (!b || !n) return;
      sold += n;
      (b.ingredients || []).forEach(function (g) {
        var oz = ozOf(g); if (oz == null) return;
        if (!g.inv_id) { if (/oz|ml|cl/.test(g.unit || '') && g.qty) (unlinked[b.name] = unlinked[b.name] || []).push(g.item); return; }
        var x = per[g.inv_id] = per[g.inv_id] || { oz: 0, from: [] };
        x.oz += oz * n; x.from.push(b.name + ' × ' + n);
      });
    });
    var rows = Object.keys(per).map(function (id) {
      var it = invItem(id), x = per[id], boz = it ? bottleOz(it) : 25.36, cpo = costPerOz(it);
      return { name: it ? it.name : 'Deleted item', section: it ? it.section : '', oz: x.oz, bottles: x.oz / boz, cost: cpo != null ? x.oz * cpo : null, from: x.from };
    }).sort(function (a, b) { return b.oz - a.oz; });
    var tot = rows.reduce(function (a, r) { return a + (r.cost || 0); }, 0);
    var body = [h('p', { cls: 'sc-sub', text: s ? sold + ' cocktails sold' + (s.entered_by ? ' · entered by ' + s.entered_by : '') + '. Ounces poured from each inventory item, as bottles (by its bottle size) and at its current cost. Compare with the change in your counts to spot over-pouring or missing bottles.' : 'No counts entered for ' + monthLabel(iso) + ' yet.' })];
    if (rows.length) body.push(h('div', { cls: 'is-wrap' }, h('table', { cls: 'is-vtable ck-use' }, [
      h('thead', null, h('tr', null, ['Inventory item', 'Ounces', 'Bottles', 'Cost', 'From'].map(function (t, i) { return h('th', { cls: i && i < 4 ? 'r' : '', text: t }); }))),
      h('tbody', null, rows.map(function (r) { return h('tr', null, [h('td', null, [h('b', { text: r.name }), r.section ? h('small', { text: ' ' + r.section }) : null]), h('td', { cls: 'r', text: (Math.round(r.oz * 10) / 10) + ' oz' }), h('td', { cls: 'r', text: (Math.round(r.bottles * 100) / 100).toString() }), h('td', { cls: 'r', text: money(r.cost) }), h('td', { cls: 'ck-from', text: r.from.join(', ') })]); })),
      h('tfoot', null, h('tr', null, [h('td', { colspan: '3', text: 'Liquor cost from cocktails' }), h('td', { cls: 'r', text: money(tot) }), h('td')]))
    ])));
    var ul = Object.keys(unlinked);
    if (ul.length) body.push(h('p', { cls: 'sc-small', text: 'Not counted (not linked to an inventory item): ' + ul.map(function (k) { return k + ': ' + unlinked[k].join(', '); }).join(' · ') + '. Edit those builds to link them.' }));
    if (s && s.notes) body.push(h('p', { cls: 'sc-small', text: 'Notes: ' + s.notes }));
    var text = ['Eden · liquor used from cocktails · ' + monthLabel(iso)].concat(rows.map(function (r) { return r.name + ': ' + (Math.round(r.oz * 10) / 10) + ' oz = ' + (Math.round(r.bottles * 100) / 100) + ' bottles, ' + money(r.cost); }), ['Total: ' + money(tot)]).join('\n');
    var m = modal('Liquor used · ' + monthLabel(iso), body, [
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Edit counts', on: { click: function () { m.close(); enterCounts(iso); } } }), h('span', { cls: 'sc-sp' }),
      rows.length ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Copy', on: { click: function (ev) { var b = ev.currentTarget; (navigator.clipboard ? navigator.clipboard.writeText(text) : Promise.reject()).then(function () { b.textContent = 'Copied'; }, function () { window.prompt('Copy:', text); }); } } }) : null,
      h('button', { type: 'button', cls: 'ed-btn', text: 'Done', on: { click: function () { m.close(); } } })], true);
  }

  window.EdenCocktails = { mount: mount, reload: function () { C.loaded = false; }, _test: { C: C, buildCost: buildCost, weeksOf: weeksOf, guessInv: guessInv, ozOf: ozOf } };
})();
