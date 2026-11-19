/* Eden staff site: Financials → Product sales.
 * Square's "Item sales detail" CSV (Reports → Item sales → Export → Item sales detail), saved one row per day, item and
 * variation (supabase/product-sales.sql). Shows where sales come from (a flow chart like the cash flow on Overview and a
 * table of every product), and turns the sales into a weekly order guide: what each sale takes out of the inventory
 * (recipes for food, builds for cocktails, glasses / pours / bottles for wine, spirits and beer), what's on hand from the
 * last count (less what's been used and plus what's come in on invoices since), and what to order.
 */
(function () {
  'use strict';

  var X = { el: null, ctx: null, rows: null, links: {}, range: '4w', q: '', sort: 'net', loading: false, missing: false, err: '', open: { items: true, order: true } };
  var BEV = /beer|wine|liquor|cocktail|beverage|n\/a|drink|spirit|coffee|tea|soda|bar/i;
  try { var saved = JSON.parse(localStorage.getItem('eden-products') || '{}'); if (saved.range) X.range = saved.range; } catch (e) { /* no storage */ }
  function remember() { try { localStorage.setItem('eden-products', JSON.stringify({ range: X.range })); } catch (e) { /* no storage */ } }

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else if (k === 'value') e.value = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function sb() { return X.ctx.sb; }
  function status(m, k) { if (X.ctx && X.ctx.status) X.ctx.status(m, k); }
  function r2(n) { return Math.round((+n || 0) * 100) / 100; }
  function money(n) { n = r2(n); return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function money0(n) { return '$' + Math.round(+n || 0).toLocaleString('en-US'); }
  function num(s) { var v = parseFloat(String(s == null ? '' : s).replace(/[$,\s]/g, '').replace(/^\((.*)\)$/, '-$1')); return isFinite(v) ? v : 0; }
  function qty(n) { n = Math.round(n * 100) / 100; return String(n); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(s, n) { var d = new Date(s + 'T12:00:00'); d.setDate(d.getDate() + n); return iso(d); }
  function dayLabel(s) { return s ? new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''; }
  function norm(t) { return String(t || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim(); }
  function keyOf(r) { return (r.category + '|' + r.item + '|' + (r.variation || '')).toLowerCase(); }
  function label(r) { return !r.variation ? r.item : norm(r.item) === norm(r.category) ? r.variation : r.item + ' · ' + r.variation; }   // "Craft Cocktails · Bad Apple" → "Bad Apple"
  function isBev(r) { return BEV.test(r.category); }

  /* ---------- CSV ---------- */
  function parseCSV(t) {
    var out = [], row = [], f = '', q = false;
    for (var i = 0; i < t.length; i++) {
      var c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && t[i + 1] === '\n') i++; row.push(f); out.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); out.push(row); }
    return out;
  }
  function readFile(file) {
    return file.text().then(function (t) {
      var rows = parseCSV(t.replace(/^﻿/, '')), H = (rows.shift() || []).map(function (x) { return x.trim().toLowerCase(); });
      var di = H.indexOf('date'), ci = H.indexOf('category'), ii = H.indexOf('item'), qi = H.indexOf('qty'), pi = H.indexOf('price point name'),
        gi = H.indexOf('gross sales'), xi = H.indexOf('discounts'), ni = H.indexOf('net sales'), ei = H.indexOf('event type');
      if (ii < 0 || ni < 0) throw new Error(file.name + ' isn’t an Item sales CSV. In Square: Reports → Item sales → Export → Item sales detail.');
      if (di < 0) throw new Error(file.name + ' is the Item sales summary (no dates). Export Item sales detail instead, so sales can be put on their days.');
      var agg = {};
      rows.forEach(function (r) {
        if (!r[ii] || !r[di]) return;
        if (/\(voided\)/i.test(r[ii] + ' ' + (pi >= 0 ? r[pi] : ''))) return;   // voided items: $0, never served
        var d = String(r[di]).trim(), m = d.match(/^(\d{4})-(\d\d)-(\d\d)/) || d.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        if (!m) return;
        var day = m[0].indexOf('-') > 0 ? m[0] : (m[3].length === 2 ? '20' + m[3] : m[3]) + '-' + String(m[1]).padStart(2, '0') + '-' + String(m[2]).padStart(2, '0');
        var pp = pi >= 0 ? String(r[pi] || '').trim() : '', v = /^regular$/i.test(pp) ? '' : pp;
        var k = day + '|' + (ci >= 0 ? r[ci] : '') + '|' + r[ii] + '|' + v;
        var a = agg[k] = agg[k] || { day: day, category: ci >= 0 ? String(r[ci]).trim() : '', item: String(r[ii]).trim(), variation: v, qty: 0, gross: 0, discounts: 0, net: 0, file: file.name };
        var refund = ei >= 0 && /refund/i.test(r[ei] || ''), q = num(r[qi]) || 0;
        if (refund && q > 0) q = -q;
        a.qty += q; a.gross += num(r[gi]); a.discounts += num(r[xi]); a.net += num(r[ni]);
      });
      return Object.keys(agg).map(function (k) { var a = agg[k]; a.qty = Math.round(a.qty * 1000) / 1000; a.gross = r2(a.gross); a.discounts = r2(a.discounts); a.net = r2(a.net); return a; });
    });
  }
  function importFiles(files) {
    var fs = [].slice.call(files || []).filter(function (f) { return /\.csv$/i.test(f.name); });
    if (!fs.length) { status('Drop a Square Item sales detail CSV.', 'err'); return; }
    status('Reading ' + fs.map(function (f) { return f.name; }).join(', ') + '…', 'dirty');
    Promise.all(fs.map(readFile)).then(function (sets) {
      var rows = [].concat.apply([], sets); if (!rows.length) throw new Error('No sales in that file.');
      var days = Array.from(new Set(rows.map(function (r) { return r.day; }))).sort();
      // a day's sales are replaced whole, so dropping the same export twice doesn't count it twice
      return sb().from('sales_items').delete().in('day', days).then(function (r) {
        if (r.error) throw r.error;
        var jobs = [];
        for (var i = 0; i < rows.length; i += 500) jobs.push(sb().from('sales_items').insert(rows.slice(i, i + 500)));
        return Promise.all(jobs);
      }).then(function (res) {
        res.forEach(function (r) { if (r.error) throw r.error; });
        var net = rows.reduce(function (a, r) { return a + r.net; }, 0);
        status('Imported ' + days.length + ' day' + (days.length === 1 ? '' : 's') + ' (' + dayLabel(days[0]) + ' – ' + dayLabel(days[days.length - 1]) + '), ' + money(net) + ' in product sales.', 'ok');
        X.rows = null; load();
      });
    }).catch(function (e) {
      var m = e.message || String(e);
      status(/sales_items|relation|does not exist|schema cache/i.test(m) ? 'One-time setup: run supabase/product-sales.sql in Supabase (SQL Editor → New query → paste → Run), then drop the file again.' : m, 'err');
    });
  }

  /* ---------- data ---------- */
  function load() {
    X.loading = true; paint();
    var since = iso(new Date(Date.now() - 400 * 864e5));
    var MC = window.EdenMenuCost;
    return Promise.all([
      sb().from('sales_items').select('day,category,item,variation,qty,gross,discounts,net').gte('day', since).limit(20000),
      sb().from('sales_item_links').select('*'),
      sb().from('inventory_items').select('*'),
      sb().from('inventory_counts').select('category,count_date,counts').order('count_date', { ascending: false }).limit(60),
      sb().from('inventory_invoices').select('invoice_date,lines').gte('invoice_date', iso(new Date(Date.now() - 120 * 864e5))).limit(2000),
      MC ? MC.load(sb(), true).catch(function () { return null; }) : null
    ]).then(function (r) {
      X.loading = false;
      if (r[0].error) { X.missing = /sales_items|relation|does not exist|schema cache/i.test(r[0].error.message || ''); X.err = X.missing ? '' : r[0].error.message; X.rows = []; paint(); return; }
      X.missing = false; X.err = '';
      X.rows = (r[0].data || []).map(function (x) { return { day: x.day, category: x.category || '', item: x.item, variation: x.variation || '', qty: +x.qty, net: +x.net, gross: +x.gross, discounts: +x.discounts }; });
      X.links = {}; (r[1].error ? [] : r[1].data || []).forEach(function (l) { X.links[l.key] = l; });
      X.linksOn = !r[1].error;
      X.inv = (r[2].data || []).filter(function (it) { return it.active !== false; });
      X.invById = {}; X.inv.forEach(function (it) { X.invById[it.id] = it; });
      X.counts = r[3].error ? [] : r[3].data || [];
      X.invoices = r[4].error ? [] : r[4].data || [];
      paint();
    }, function (e) { X.loading = false; X.err = e.message || String(e); paint(); });
  }

  /* ---------- the period ---------- */
  var RANGES = [['last', 'Last week of sales'], ['4w', 'Last 4 weeks'], ['13w', 'Last 13 weeks'], ['all', 'All imported']];
  function period() {
    var rows = X.rows || []; if (!rows.length) return null;
    var last = rows.reduce(function (a, r) { return r.day > a ? r.day : a; }, ''), first = rows.reduce(function (a, r) { return r.day < a ? r.day : a; }, last);
    var days = { last: 7, '4w': 28, '13w': 91 }[X.range], from = days ? addDays(last, 1 - days) : first;
    if (from < first) from = first;
    var n = Math.round((new Date(last + 'T12:00:00') - new Date(from + 'T12:00:00')) / 864e5) + 1;
    return { from: from, to: last, days: n, weeks: Math.max(1, n / 7), first: first };
  }
  function products(p) {
    var by = {};
    (X.rows || []).forEach(function (r) {
      if (r.day < p.from || r.day > p.to) return;
      var k = keyOf(r), a = by[k] = by[k] || { key: k, category: r.category, item: r.item, variation: r.variation, qty: 0, net: 0, gross: 0, discounts: 0 };
      a.qty += r.qty; a.net += r.net; a.gross += r.gross; a.discounts += r.discounts;
    });
    return Object.keys(by).map(function (k) { return by[k]; });
  }

  /* ---------- what one sale uses ---------- */
  function bestInv(name, cats) {
    var n = norm(name), w = n.split(' ').filter(function (t) { return t.length > 2; }), best = null, bs = 0;
    if (!w.length) return null;
    X.inv.forEach(function (it) {
      if (cats && cats.indexOf(it.category) < 0) return;
      var hay = norm((it.ingredient || '') + ' ' + it.name);
      if (hay === n || norm(it.ingredient) === n) { best = it; bs = 99; return; }
      var hit = w.filter(function (t) { return (' ' + hay + ' ').indexOf(' ' + t) >= 0; }).length, sc = hit / w.length;
      if (sc > bs) { bs = sc; best = it; }
    });
    return bs >= 0.67 ? best : null;
  }
  // { parts: {inventory id: units per sale}, how } or null when it isn't linked to anything yet
  function usage(p) {
    var MC = window.EdenMenuCost, l = X.links[p.key], name = p.variation || p.item, c = p.category.toLowerCase();
    if (l && l.kind === 'skip') return { parts: {}, how: 'not stocked', skip: true };
    if (l && l.kind === 'recipe' && MC && MC.data.recById[l.ref]) return { parts: MC.portionUsage(MC.data.recById[l.ref]), how: 'recipe: ' + MC.data.recById[l.ref].name, linked: true };
    if (l && l.kind === 'inv' && X.invById[l.ref]) { var o = {}; o[l.ref] = drink(X.invById[l.ref], c); return { parts: o, how: X.invById[l.ref].name, linked: true }; }
    if (!MC || !MC.data.loaded) return null;
    if (/cocktail/.test(c)) { var cu = MC.cocktailUsage(p.item) || (p.variation ? MC.cocktailUsage(p.variation) : null); if (cu) return { parts: cu, how: 'cocktail build' }; }
    if (!isBev(p)) { var du = MC.dishUsage(p.item) || (p.variation ? MC.dishUsage(p.item + ' ' + p.variation) : null); if (du) return { parts: du, how: 'recipes' }; }
    if (isBev(p)) {
      var it = bestInv(name, ['bev']) || (p.variation ? bestInv(p.item + ' ' + p.variation, ['bev']) : null);
      if (it) { var x = {}; x[it.id] = drink(it, c); return { parts: x, how: it.name }; }
    }
    return null;
  }
  function drink(it, c) {
    var MC = window.EdenMenuCost;
    var how = /by the glass|glass/.test(c) ? 'glass' : /liquor|spirit/.test(c) ? 'pour' : 'each';
    return MC ? MC.drinkUnits(it, how) : 1;
  }

  /* ---------- on hand: the last count, less what's been sold since, plus what came in on invoices ---------- */
  function lastCount(it) {
    for (var i = 0; i < X.counts.length; i++) { var c = X.counts[i]; if (c.category === it.category && c.counts && c.counts[it.id] != null) return { date: c.count_date, qty: +c.counts[it.id] }; }
    return null;
  }
  function orderGuide(p, list) {
    var need = {}, since = {}, unlinked = [];
    list.forEach(function (pr) {
      var u = usage(pr); if (!u) { unlinked.push(pr); return; }
      Object.keys(u.parts).forEach(function (id) { need[id] = (need[id] || 0) + u.parts[id] * pr.qty / p.weeks; });
    });
    // used since each item's last count (all imported sales after that date)
    var allUse = {};
    (X.rows || []).forEach(function (r) {
      var u = usage({ key: keyOf(r), category: r.category, item: r.item, variation: r.variation }); if (!u) return;
      Object.keys(u.parts).forEach(function (id) { (allUse[id] = allUse[id] || []).push([r.day, u.parts[id] * r.qty]); });
    });
    var recv = {};
    X.invoices.forEach(function (v) { (v.lines || []).forEach(function (L) { if (!L.item_id || L.item_id === '__new') return; (recv[L.item_id] = recv[L.item_id] || []).push([v.invoice_date, (+L.qty || 0) * (+L.per_unit || +L.per || 1)]); }); });
    var out = [];
    Object.keys(need).forEach(function (id) {
      var it = X.invById[id]; if (!it) return;
      var lc = lastCount(it), used = 0, got = 0;
      if (lc) {
        (allUse[id] || []).forEach(function (u) { if (u[0] > lc.date) used += u[1]; });
        (recv[id] || []).forEach(function (u) { if (u[0] > lc.date) got += u[1]; });
      }
      var onHand = lc ? Math.max(0, lc.qty - used + got) : null, wk = need[id], par = it.par != null && it.par !== '' ? +it.par : null;
      var target = Math.max(wk, par || 0), order = onHand == null ? wk : Math.max(0, target - onHand);
      out.push({ it: it, week: wk, count: lc, used: used, got: got, onHand: onHand, par: par, order: order });
    });
    // anything below par that didn't sell in this period
    X.inv.forEach(function (it) {
      if (need[it.id] != null || it.par == null || it.par === '' || it.category === 'paper') return;
      var lc = lastCount(it); if (!lc || lc.qty >= +it.par) return;
      out.push({ it: it, week: 0, count: lc, used: 0, got: 0, onHand: lc.qty, par: +it.par, order: +it.par - lc.qty });
    });
    return { rows: out, unlinked: unlinked };
  }

  /* ---------- page ---------- */
  function paint() {
    var el = X.el; if (!el) return;
    el.innerHTML = '';
    el.appendChild(importBox());
    if (X.missing) { el.appendChild(h('p', { cls: 'pr-err', text: 'One-time setup: run supabase/product-sales.sql in Supabase (SQL Editor → New query → paste → Run). Then drop a Square Item sales detail CSV above.' })); return; }
    if (X.err) el.appendChild(h('p', { cls: 'pr-err', role: 'alert', text: X.err }));
    if (X.loading && !X.rows) { el.appendChild(h('p', { cls: 'an-sub', text: 'Loading…' })); return; }
    var p = period();
    if (!p) { el.appendChild(h('p', { cls: 'an-sub', text: 'No product sales yet. Drop a Square Item sales detail CSV above.' })); return; }
    var list = products(p), total = list.reduce(function (a, x) { return a + x.net; }, 0);
    el.appendChild(rangeBar(p, total, list));
    el.appendChild(mixCharts(list, total, p));
    el.appendChild(flow(list, total));
    el.appendChild(itemsTable(list, total, p));
    el.appendChild(orderBox(p, list));
  }
  function importBox() {
    var input = h('input', { type: 'file', accept: '.csv,text/csv', multiple: true, hidden: true });
    input.addEventListener('change', function () { importFiles(input.files); input.value = ''; });
    var box = h('div', { cls: 'ps-drop' }, [
      h('div', null, [h('b', { text: 'Import product sales' }), h('span', { text: 'Square → Reports → Item sales → Export → Item sales detail (CSV). Drop it here or pick it. A day already imported is replaced, not added twice.' })]),
      h('button', { type: 'button', cls: 'ed-btn small pr-accent', text: 'Choose CSV', on: { click: function () { input.click(); } } }), input
    ]);
    box.addEventListener('dragover', function (e) { e.preventDefault(); box.classList.add('on'); });
    box.addEventListener('dragleave', function () { box.classList.remove('on'); });
    box.addEventListener('drop', function (e) { e.preventDefault(); box.classList.remove('on'); importFiles(e.dataTransfer.files); });
    return box;
  }
  function rangeBar(p, total, list) {
    var qtyAll = list.reduce(function (a, x) { return a + x.qty; }, 0);
    var food = list.filter(function (x) { return !isBev(x); }).reduce(function (a, x) { return a + x.net; }, 0);
    return h('div', { cls: 'ps-head' }, [
      h('div', { cls: 'fn-range ps-range' }, RANGES.map(function (o) { return h('button', { type: 'button', cls: 'fn-mbtn' + (X.range === o[0] ? ' on' : ''), text: o[1], 'aria-pressed': X.range === o[0] ? 'true' : 'false', on: { click: function () { X.range = o[0]; remember(); paint(); } } }); })),
      h('div', { cls: 'ps-kpis' }, [
        kpi('Product sales', money0(total), dayLabel(p.from) + ' – ' + dayLabel(p.to)),
        kpi('Per week', money0(total / p.weeks), p.days <= 7 ? 'one week of sales' : qty(Math.round(p.weeks * 10) / 10) + ' weeks'),
        kpi('Items sold', Math.round(qtyAll).toLocaleString(), list.length + ' products'),
        kpi('Food / beverage', total ? Math.round(food / total * 100) + ' / ' + (100 - Math.round(food / total * 100)) : '–', '% of product sales')
      ])
    ]);
  }
  function kpi(t, v, s) { return h('div', { cls: 'ps-kpi' }, [h('small', { text: t }), h('b', { text: v }), h('span', { text: s })]); }

  /* ---------- the four mix charts: sales mix, item mix, sales by day, beverage mix ----------
     Plain bar charts (HTML, so they reflow on a phone): one hue per Square category, in the same order everywhere,
     a value label on every bar, and the details on hover. */
  var PAL = ['#4f8f86', '#b0703f', '#5b8fc9', '#8a6fa8', '#c9a24b', '#5d7a64', '#c9645a', '#3f7d74', '#d39a6a', '#7a5f98', '#9d9a94', '#6aa39a'];
  function catColors(list) {
    var sums = {}; list.forEach(function (x) { sums[x.category || 'Other'] = (sums[x.category || 'Other'] || 0) + x.net; });
    var order = Object.keys(sums).sort(function (a, b) { return (BEV.test(a) ? 1 : 0) - (BEV.test(b) ? 1 : 0) || sums[b] - sums[a]; }), col = {};
    order.forEach(function (c, i) { col[c] = PAL[i % PAL.length]; });
    return col;
  }
  function bars(title, sub, items, opt) {   // items: [{label, value, color, note}] → horizontal bars, % of opt.base
    opt = opt || {};
    var max = items.reduce(function (a, x) { return Math.max(a, x.value); }, 0) || 1, base = opt.base || items.reduce(function (a, x) { return a + x.value; }, 0) || 1;
    return h('figure', { cls: 'ps-mix' }, [h('figcaption', null, [h('b', { text: title }), sub ? h('span', { text: sub }) : null]),
      h('div', { cls: 'ps-bars' }, items.map(function (x) {
        var pc = x.value / base * 100;
        return h('div', { cls: 'ps-bar', title: x.label + ': ' + money(x.value) + ' · ' + pc.toFixed(1) + '%' + (x.note ? ' · ' + x.note : '') }, [
          h('span', { cls: 'ps-bl', text: x.label }),
          h('span', { cls: 'ps-bt' }, h('i', { style: 'width:' + Math.max(0.5, x.value / max * 100).toFixed(1) + '%;background:' + x.color })),
          h('span', { cls: 'ps-bv', text: pc.toFixed(1) + '% · ' + money0(x.value) })
        ]);
      }))]);
  }
  function mixCharts(list, total, p) {
    var col = catColors(list), grid = h('div', { cls: 'ps-grid' });
    // 1. sales mix: each Square category's share of product sales
    var cats = {}; list.forEach(function (x) { var c = x.category || 'Other'; (cats[c] = cats[c] || { v: 0, q: 0 }); cats[c].v += x.net; cats[c].q += x.qty; });
    var catList = Object.keys(cats).filter(function (c) { return cats[c].v > 0; }).sort(function (a, b) { return cats[b].v - cats[a].v; });
    grid.appendChild(bars('Sales mix', 'Each category’s share of product sales', catList.map(function (c) { return { label: c, value: cats[c].v, color: col[c], note: Math.round(cats[c].q) + ' sold' }; }), { base: total }));
    // 2. item mix: the 12 best sellers, coloured by category
    var top = list.filter(function (x) { return x.net > 0; }).sort(function (a, b) { return b.net - a.net; }).slice(0, 12);
    grid.appendChild(bars('Item mix', 'The 12 best sellers, % of product sales', top.map(function (x) { return { label: label(x), value: x.net, color: col[x.category || 'Other'], note: qty(x.qty) + ' sold · ' + (x.category || '') }; }), { base: total }));
    // 3. sales by day: food and beverage for each day open (by week when the period is long)
    grid.appendChild(byDay(p, col));
    // 4. beverage mix: each beverage category's share of beverage sales
    var bev = catList.filter(function (c) { return BEV.test(c); }), bevTot = bev.reduce(function (a, c) { return a + cats[c].v; }, 0);
    grid.appendChild(bev.length ? bars('Beverage mix', 'Share of beverage sales (' + money0(bevTot) + ')', bev.map(function (c) { return { label: c, value: cats[c].v, color: col[c], note: Math.round(cats[c].q) + ' sold' }; }), { base: bevTot })
      : h('figure', { cls: 'ps-mix' }, [h('figcaption', null, h('b', { text: 'Beverage mix' })), h('p', { cls: 'an-sub', text: 'No beverage sales in this period.' })]));
    return grid;
  }
  function byDay(p, col) {
    var long = p.days > 42, by = {};
    (X.rows || []).forEach(function (r) {
      if (r.day < p.from || r.day > p.to) return;
      var k = r.day;
      if (long) { var d = new Date(r.day + 'T12:00:00'); d.setDate(d.getDate() - d.getDay()); k = iso(d); }
      var a = by[k] = by[k] || { food: 0, bev: 0 };
      if (isBev(r)) a.bev += r.net; else a.food += r.net;
    });
    var keys = Object.keys(by).sort(), max = keys.reduce(function (m, k) { return Math.max(m, by[k].food + by[k].bev); }, 0) || 1;
    var FOOD = '#4f8f86', BEVC = '#8a6fa8';
    var cols = keys.map(function (k) {
      var a = by[k], t = a.food + a.bev, d = new Date(k + 'T12:00:00');
      var lab = long ? 'wk ' + d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }) : d.toLocaleDateString('en-US', { weekday: 'short' }) + ' ' + d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' });
      return h('div', { cls: 'ps-col', title: (long ? 'Week of ' : '') + dayLabel(k) + ': ' + money(t) + ' (food ' + money(a.food) + ', beverage ' + money(a.bev) + ')' }, [
        h('span', { cls: 'ps-cv', text: money0(t) }),
        h('span', { cls: 'ps-ct' }, [h('i', { style: 'height:' + (a.bev / max * 100).toFixed(1) + '%;background:' + BEVC }), h('i', { style: 'height:' + (a.food / max * 100).toFixed(1) + '%;background:' + FOOD })]),
        h('span', { cls: 'ps-cl', text: lab })
      ]);
    });
    var avg = keys.length ? keys.reduce(function (s, k) { return s + by[k].food + by[k].bev; }, 0) / keys.length : 0;
    return h('figure', { cls: 'ps-mix' }, [h('figcaption', null, [h('b', { text: long ? 'Sales by week' : 'Sales by day' }), h('span', { text: 'Average ' + money0(avg) + (long ? ' a week' : ' a day open') })]),
      h('div', { cls: 'ps-legend' }, [h('span', null, [h('i', { style: 'background:' + FOOD }), 'Food']), h('span', null, [h('i', { style: 'background:' + BEVC }), 'Beverage'])]),
      h('div', { cls: 'ps-cols' }, cols)]);
  }

  // where product sales come from: food / beverage → Square categories → the best sellers in each
  function flow(list, total) {
    var Pay = window.EdenPayroll; if (!Pay || !Pay.sankey || !total) return h('div');
    var CF = Pay.CF, pal = [CF.teal, '#3f7d74', '#6aa39a', CF.ember, '#d39a6a', CF.plum, '#7a5f98', CF.sand, CF.blue, '#8f8a82', CF.green, CF.red];
    var cats = {}; list.forEach(function (x) { if (x.net <= 0) return; (cats[x.category || 'Other'] = cats[x.category || 'Other'] || []).push(x); });
    var order = Object.keys(cats).sort(function (a, b) {
      var ba = BEV.test(a) ? 1 : 0, bb = BEV.test(b) ? 1 : 0;
      var sa = cats[a].reduce(function (s, x) { return s + x.net; }, 0), sbb = cats[b].reduce(function (s, x) { return s + x.net; }, 0);
      return ba - bb || sbb - sa;
    });
    var nodes = [{ id: 'gfood', label: 'Food', col: 0, color: CF.teal }, { id: 'gbev', label: 'Beverage', col: 0, color: CF.plum }], links = [];
    order.forEach(function (c, ci) {
      var col = pal[ci % pal.length], id = 'c' + ci, xs = cats[c].sort(function (a, b) { return b.net - a.net; }), sum = xs.reduce(function (s, x) { return s + x.net; }, 0);
      nodes.push({ id: id, label: c, col: 1, color: col });
      links.push({ s: BEV.test(c) ? 'gbev' : 'gfood', t: id, v: r2(sum) });
      var top = xs.slice(0, 3), rest = xs.slice(3);
      top.forEach(function (x, i) { nodes.push({ id: id + 'i' + i, label: label(x), col: 2, color: col, gap: i ? 0 : 10 }); links.push({ s: id, t: id + 'i' + i, v: r2(x.net) }); });
      if (rest.length) { var rs = rest.reduce(function (s, x) { return s + x.net; }, 0); if (rs > 0) { nodes.push({ id: id + 'r', label: rest.length + ' more ' + c.toLowerCase(), col: 2, color: '#b9b4ab' }); links.push({ s: id, t: id + 'r', v: r2(rs) }); } }
    });
    nodes[0].gap = 0; var first = nodes.filter(function (n) { return n.col === 2; })[0]; if (first) first.gap = 0;
    var cb = Pay.chartBox('Where product sales come from', null);
    var hgt = Math.max(420, nodes.filter(function (n) { return n.col === 2; }).length * 22 + 60);
    var wrap = h('div', { cls: 'fn-sk-wrap' }); wrap.appendChild(Pay.sankey(cb, nodes, links.filter(function (l) { return l.v > 0; }), 960, hgt, { base: total, pctFrom: 0 })); cb.box.appendChild(wrap);
    cb.box.appendChild(h('p', { cls: 'an-sub', text: 'Net sales by product, after discounts, before tax and tips. Percentages are of all product sales in the period.' }));
    return cb.box;
  }

  function itemsTable(list, total, p) {
    var det = h('details', { cls: 'ps-sec' }); det.open = X.open.items; det.addEventListener('toggle', function () { X.open.items = det.open; });
    det.appendChild(h('summary', null, [h('b', { text: 'Every product' }), h('span', { text: list.length + ' products · sortable · CSV' })]));
    var q = h('input', { type: 'search', placeholder: 'Find a product or category', value: X.q, 'aria-label': 'Find a product' });
    var body = h('div');
    var cols = [['item', 'Product'], ['category', 'Category'], ['qty', 'Sold'], ['week', 'Per week'], ['net', 'Net sales'], ['pct', '% of sales'], ['avg', 'Avg price'], ['disc', 'Discounts']];
    function draw() {
      body.innerHTML = '';
      var w = norm(X.q).split(' ').filter(Boolean);
      var rows = list.filter(function (x) { var hay = norm(label(x) + ' ' + x.category); return w.every(function (t) { return hay.indexOf(t) >= 0; }); });
      var val = function (x, k) { return k === 'item' ? label(x).toLowerCase() : k === 'category' ? x.category.toLowerCase() : k === 'qty' ? x.qty : k === 'week' ? x.qty / p.weeks : k === 'net' || k === 'pct' ? x.net : k === 'avg' ? (x.qty ? x.net / x.qty : 0) : x.discounts; };
      rows.sort(function (a, b) { var A = val(a, X.sort), B = val(b, X.sort); return typeof A === 'string' ? A.localeCompare(B) : B - A; });
      var thead = h('tr', null, cols.map(function (c) { return h('th', { cls: c[0] === 'item' || c[0] === 'category' ? '' : 'r', 'aria-sort': X.sort === c[0] ? 'descending' : null }, h('button', { type: 'button', cls: 'ps-sort' + (X.sort === c[0] ? ' on' : ''), text: c[1], on: { click: function () { X.sort = c[0]; draw(); } } })); }));
      var tb = h('tbody', null, rows.map(function (x) {
        return h('tr', null, [h('td', { text: label(x) }), h('td', { text: x.category }), h('td', { cls: 'r', text: qty(x.qty) }), h('td', { cls: 'r', text: qty(x.qty / p.weeks) }),
          h('td', { cls: 'r', text: money(x.net) }), h('td', { cls: 'r', text: total ? (x.net / total * 100).toFixed(1) + '%' : '' }), h('td', { cls: 'r', text: x.qty ? money(x.net / x.qty) : '' }), h('td', { cls: 'r', text: x.discounts ? money(x.discounts) : '' })]);
      }));
      body.appendChild(h('div', { cls: 'is-wrap' }, h('table', { cls: 'fn-tbl ps-tbl' }, [h('thead', null, thead), tb])));
    }
    q.addEventListener('input', function () { X.q = q.value; draw(); });
    var csv = h('button', { type: 'button', cls: 'ed-btn small', text: 'Download CSV', on: { click: function () {
      var lines = [['Product', 'Category', 'Sold', 'Per week', 'Net sales', '% of sales', 'Avg price', 'Discounts']].concat(list.map(function (x) { return [label(x), x.category, qty(x.qty), qty(x.qty / p.weeks), r2(x.net), total ? (x.net / total * 100).toFixed(1) : '', x.qty ? r2(x.net / x.qty) : '', r2(x.discounts)]; }));
      var t = lines.map(function (r) { return r.map(function (c) { c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([t], { type: 'text/csv' })); a.download = 'product-sales-' + p.from + '-' + p.to + '.csv'; a.click();
    } } });
    det.appendChild(h('div', { cls: 'ps-tools' }, [q, csv]));
    det.appendChild(body); draw();
    return det;
  }

  function orderBox(p, list) {
    var det = h('details', { cls: 'ps-sec' }); det.open = X.open.order; det.addEventListener('toggle', function () { X.open.order = det.open; });
    var g = orderGuide(p, list), Inv = window.EdenInventory;
    var countBtn = h('button', { type: 'button', cls: 'ed-btn small pr-accent', text: 'Enter this month’s count', on: { click: function () { if (Inv && Inv.enterCount) Inv.enterCount(); else location.hash = '#inventory'; } } });
    var newest = X.counts.length ? X.counts[0].count_date : null, thisMonth = newest && newest.slice(0, 7) === iso(new Date()).slice(0, 7);
    det.appendChild(h('summary', null, [h('b', { text: 'What to order this week' }), h('span', { text: g.rows.filter(function (r) { return r.order > 0; }).length + ' items · from ' + (p.days <= 7 ? 'a week' : qty(Math.round(p.weeks * 10) / 10) + ' weeks') + ' of sales and the last count' })]));
    det.appendChild(h('div', { cls: 'ps-count' + (thisMonth ? '' : ' warn') }, [
      h('span', { text: newest ? (thisMonth ? 'Last count: ' + dayLabel(newest) + '.' : 'No count for this month yet (last: ' + dayLabel(newest) + '). On hand below is the last count, less what’s been sold since, plus what came in on invoices.') : 'No inventory count yet: until there is one, the order is a week of expected use.' }),
      countBtn
    ]));
    det.appendChild(h('p', { cls: 'an-sub', text: 'Per week = what the products sold use, on average, over the period above (food through its recipes, cocktails through their builds, wine by the glass, spirits by the pour). Order = enough for a week (or up to par, if that’s more) less what’s on hand.' }));
    var rows = g.rows.filter(function (r) { return r.order > 0.01 || r.week > 0.01; }).sort(function (a, b) { return String(a.it.vendor || '~').localeCompare(String(b.it.vendor || '~')) || String(a.it.name).localeCompare(b.it.name); });
    var by = {}; rows.forEach(function (r) { var v = r.it.vendor || 'No vendor set'; (by[v] = by[v] || []).push(r); });
    var showAll = X.showAll;
    Object.keys(by).forEach(function (v) {
      var rs = by[v].filter(function (r) { return showAll || r.order > 0.01; }); if (!rs.length) return;
      det.appendChild(h('h4', { cls: 'ps-vendor', text: v + ' · ' + rs.filter(function (r) { return r.order > 0.01; }).length + ' to order' }));
      det.appendChild(h('div', { cls: 'is-wrap' }, h('table', { cls: 'fn-tbl ps-tbl ps-otbl' }, [
        h('thead', null, h('tr', null, ['Item', 'Per week', 'Last count', 'On hand now', 'Par', 'Order'].map(function (t, i) { return h('th', { cls: i ? 'r' : '', text: t }); }))),
        h('tbody', null, rs.map(function (r) {
          var u = r.it.unit || 'unit', oq = Inv && Inv.orderQty && r.order > 0.01 ? Inv.orderQty(r.it, Math.ceil(r.order * 10) / 10) : null;
          return h('tr', { cls: r.order > 0.01 ? '' : 'ps-ok' }, [
            h('td', null, [h('b', { text: r.it.ingredient || r.it.name }), r.it.ingredient ? h('small', { text: r.it.name }) : null]),
            h('td', { cls: 'r', text: qty(r.week) + ' ' + u }),
            h('td', { cls: 'r', text: r.count ? qty(r.count.qty) + ' · ' + dayLabel(r.count.date) : 'not counted' }),
            h('td', { cls: 'r', title: r.count ? 'Counted ' + qty(r.count.qty) + ', used about ' + qty(r.used) + ', received ' + qty(r.got) + ' since' : '', text: r.onHand == null ? '–' : qty(r.onHand) + ' ' + u }),
            h('td', { cls: 'r', text: r.par != null ? qty(r.par) : '' }),
            h('td', { cls: 'r ps-order', text: r.order > 0.01 ? (oq ? oq.text : qty(Math.ceil(r.order * 10) / 10) + ' ' + u) : 'enough' })
          ]);
        }))
      ])));
    });
    if (!rows.length) det.appendChild(h('p', { cls: 'an-sub', text: 'Nothing to work from yet: link the products below to recipes or inventory items.' }));
    det.appendChild(h('label', { cls: 'sc-check ps-all' }, [h('input', { type: 'checkbox', checked: !!showAll, on: { change: function (e) { X.showAll = e.target.checked; paint(); } } }), ' Show items with enough on hand too']));
    det.appendChild(unlinkedBox(g.unlinked));
    return det;
  }
  // products that don't use anything yet: link each to a recipe or an inventory item (or mark it not stocked)
  function unlinkedBox(un) {
    var MC = window.EdenMenuCost, list = un.filter(function (x) { return x.net > 0 || x.qty > 0; }).sort(function (a, b) { return b.net - a.net; });
    if (!list.length) return h('p', { cls: 'an-sub', text: 'Every product sold is linked to what it uses.' });
    var box = h('details', { cls: 'ps-unl' }, [h('summary', { text: list.length + ' products aren’t linked to the inventory yet (not in the order guide)' })]);
    if (!X.linksOn) box.appendChild(h('p', { cls: 'pr-err', text: 'To save links, run supabase/product-sales.sql in Supabase once.' }));
    var recs = MC && MC.data.recipes ? MC.data.recipes.slice().sort(function (a, b) { return String(a.name).localeCompare(b.name); }) : [];
    var bevs = X.inv.filter(function (it) { return it.category === 'bev'; }).sort(function (a, b) { return String(a.name).localeCompare(b.name); });
    var foods = X.inv.filter(function (it) { return it.category !== 'bev'; }).sort(function (a, b) { return String(a.name).localeCompare(b.name); });
    box.appendChild(h('ul', { cls: 'ps-ulist' }, list.slice(0, 80).map(function (x) {
      var sel = h('select', { 'aria-label': 'Link ' + label(x) }, [h('option', { value: '', text: 'Link to…' }), h('option', { value: 'skip:', text: 'Not stocked (leave out)' })]
        .concat(recs.length ? [h('optgroup', { label: 'Recipes (one portion)' }, recs.map(function (r) { return h('option', { value: 'recipe:' + r.id, text: r.name }); }))] : [])
        .concat([h('optgroup', { label: isBev(x) ? 'Bar inventory' : 'Inventory' }, (isBev(x) ? bevs : foods).map(function (it) { return h('option', { value: 'inv:' + it.id, text: it.ingredient || it.name }); }))]));
      sel.addEventListener('change', function () {
        if (!sel.value) return;
        var kind = sel.value.split(':')[0], ref = sel.value.slice(kind.length + 1);
        sb().from('sales_item_links').upsert({ key: x.key, kind: kind, ref: ref, updated_at: new Date().toISOString() }, { onConflict: 'key' }).then(function (r) {
          if (r.error) { status('Couldn’t save the link: ' + r.error.message, 'err'); return; }
          X.links[x.key] = { key: x.key, kind: kind, ref: ref }; status('Linked ' + label(x) + '.', 'ok'); paint();
        });
      });
      return h('li', null, [h('div', null, [h('b', { text: label(x) }), h('span', { text: x.category + ' · ' + qty(x.qty) + ' sold · ' + money(x.net) })]), sel]);
    })));
    if (!MC || !MC.data.recipes || !MC.data.recipes.some(function (r) { return (r.menu_links || []).length; })) box.appendChild(h('p', { cls: 'an-sub', text: 'Dishes link on their own once a recipe is connected to its menu item (Recipes → On the menu) under the same name as in Square.' }));
    return box;
  }

  window.EdenProducts = {
    show: function (el, ctx) {
      X.el = el; X.ctx = ctx;
      if (!X.rows && !X.loading) load(); else paint();
    },
    _test: { readFile: readFile, X: X, usage: usage, orderGuide: orderGuide }
  };
})();
