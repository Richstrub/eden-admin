/* Eden staff site: Temperatures — coolers and freezers, from the Elitech RCW-800W WiFi data loggers.
 *
 * Each cooler or freezer is a "unit" with a safe range in °F. Readings arrive three ways:
 *   - Elitech's cloud (iCold), pulled by the staff site's worker every 5 minutes once API access is set up
 *   - an export file from iCold or ElitechLog (Excel or CSV) dropped on this page
 *   - a reading typed in by hand, stamped with who took it
 * The page shows each unit's current temperature and last 24 hours, a chart for one unit over 24 hours, 7 or 30 days,
 * the times it went out of range (with corrective actions written against them), and a month's log to print for the
 * Health Department. Managers set up the units under Set up.
 *
 * Data: temp_units, temp_readings, temp_notes, temp_feed and temp_series() (supabase/temperatures.sql).
 */
(function () {
  'use strict';
  var SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var STALE_MIN = 30;   // no reading for this long = "No recent reading"
  var RANGES = { day: { label: '24 hours', ms: 864e5, bucket: 15 }, week: { label: '7 days', ms: 7 * 864e5, bucket: 60 }, month: { label: '30 days', ms: 30 * 864e5, bucket: 240 } };
  var DEFAULTS = { cooler: { min: 33, max: 41 }, freezer: { min: null, max: 0 }, other: { min: null, max: null } };
  var T = { ctx: null, el: null, sub: '', units: [], notes: [], feed: null, day: null, long: null, sel: null, range: 'day', missing: false, err: '', seq: 0, month: null };

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
  function svgEl(tag, a) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(a || {}).forEach(function (k) { e.setAttribute(k, a[k]); }); return e; }
  function sb() { return T.ctx.sb; }
  function status(m, k) {
    if (T.ctx && T.ctx.status) { T.ctx.status(m, k); return; }
    var bar = T.el && T.el.querySelector('.tp-status'); if (!bar) return;   // the Hub: messages show in a line at the top
    bar.textContent = m || ''; bar.className = 'tp-status' + (k ? ' ' + k : ''); bar.hidden = !m;
    clearTimeout(T.stT); if (m && k !== 'err') T.stT = setTimeout(function () { bar.hidden = true; }, 6000);
  }
  function hub() { return !!(T.ctx && T.ctx.hub); }
  // who is making the entry: the staff site's signed-in name, or on the Hub the initials typed at the top
  function who() { var n = T.ctx && T.ctx.name; return String(typeof n === 'function' ? n() || '' : n || '').trim(); }
  function needWho() { if (who()) return false; status('Type your initials at the top first.', 'err'); return true; }
  function isMgr() { var r = T.ctx && T.ctx.role; return r === 'owner' || r === 'manager' || r === 'scheduler'; }
  function isMissing(e) { return e && (e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42P01' || e.code === '42883' || /could not find the (table|function)|does not exist|schema cache/i.test(e.message || '')); }
  function num(v) { var s = String(v == null ? '' : v).replace(/[°fFcC\s]/g, '').replace(',', '.'); if (s === '' || s === '-') return null; var n = parseFloat(s); return isFinite(n) ? n : null; }
  function deg(v) { return v == null ? '–' : (Math.round(v * 10) / 10).toFixed(1) + '°'; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function timeTxt(d) { return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); }
  function dayTxt(d) { return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
  function whenTxt(d) { var t = new Date(); return (ymd(d) === ymd(t) ? 'Today' : dayTxt(d)) + ' ' + timeTxt(d); }
  function ago(d) {
    var m = Math.round((Date.now() - d.getTime()) / 60000);
    if (m < 1) return 'just now'; if (m < 60) return m + ' min ago';
    var hr = Math.round(m / 60); if (hr < 48) return hr + (hr === 1 ? ' hour ago' : ' hours ago');
    return dayTxt(d);
  }
  function durTxt(min) { min = Math.round(min); if (min < 60) return min + ' min'; var hr = Math.floor(min / 60), m = min % 60; return hr + ' h' + (m ? ' ' + m + ' min' : ''); }
  function lim(v) { v = Math.round(+v * 10) / 10; return (v % 1 ? v.toFixed(1) : String(v)) + '°'; }
  function limitTxt(u) {
    if (u.min_f != null && u.max_f != null) return lim(u.min_f) + '–' + lim(u.max_f) + 'F';
    if (u.max_f != null) return lim(u.max_f) + 'F or colder';
    if (u.min_f != null) return lim(u.min_f) + 'F or warmer';
    return 'No limits set';
  }
  function outOf(u, lo, hi) { return (u.max_f != null && hi > +u.max_f) || (u.min_f != null && lo < +u.min_f); }
  // ROP plan units (the freezer and protein cooler) first, then the rest in their set-up order
  function activeUnits() { return T.units.filter(function (u) { return u.active !== false; }).sort(function (a, b) { return (b.rop ? 1 : 0) - (a.rop ? 1 : 0); }); }
  function unitById(id) { return T.units.filter(function (u) { return u.id === id; })[0] || null; }

  /* ---------- data ---------- */
  function series(from, to, bucket) {
    return sb().rpc('temp_series', { p_from: from.toISOString(), p_to: to.toISOString(), p_bucket_min: bucket }).then(function (r) {
      if (r.error) throw r.error; if (r.data && r.data.error) throw new Error(r.data.error); return r.data || { units: {}, latest: {} };
    });
  }
  function load() {
    var my = ++T.seq, now = new Date(), R = RANGES[T.range];
    T.err = ''; paint(true);
    var wk = new Date(now.getTime() - 7 * 864e5);
    return Promise.all([
      sb().from('temp_units').select('*').order('sort').order('name'),
      sb().from('temp_notes').select('*').gte('at', new Date(now.getTime() - 35 * 864e5).toISOString()).order('at', { ascending: false }).limit(300),
      sb().from('temp_feed').select('*').eq('id', 1).maybeSingle(),
      series(wk, new Date(now.getTime() + 6e4), 15),
      T.range === 'day' || T.range === 'week' ? Promise.resolve(null) : series(new Date(now.getTime() - R.ms), new Date(now.getTime() + 6e4), R.bucket)
    ]).then(function (res) {
      if (my !== T.seq) return;
      if (res[0].error) { T.missing = isMissing(res[0].error); if (!T.missing) T.err = 'Couldn’t load the temperatures. ' + (res[0].error.message || ''); T.units = []; paint(false); return; }
      T.missing = false;
      T.units = res[0].data || [];
      T.notes = res[1].error ? [] : res[1].data || [];
      T.feed = res[2].error ? null : res[2].data;
      T.week = res[3]; T.long = res[4];
      if (!T.sel || !unitById(T.sel)) T.sel = (activeUnits()[0] || {}).id || null;
      paint(false);
    }, function (e) { if (my !== T.seq) return; T.missing = isMissing(e); T.err = T.missing ? '' : 'Couldn’t load the temperatures. ' + (e && e.message || ''); paint(false); });
  }
  // the points for one unit over the chosen range: [{ t (ms), lo, hi, av }]
  function pts(id, range) {
    var now = Date.now(), R = RANGES[range], src;
    if (range === 'month') src = T.long; else src = T.week;
    var raw = (src && src.units && src.units[id]) || [];
    var out = raw.map(function (p) { return { t: p[0] * 1000, lo: +p[1], hi: +p[2], av: +p[3] }; }).filter(function (p) { return p.t >= now - R.ms; });
    if (range === 'week') {   // 15-minute buckets rolled up to hours
      var byH = {}; out.forEach(function (p) { var k = Math.floor(p.t / 36e5) * 36e5, b = byH[k]; if (!b) byH[k] = { t: k, lo: p.lo, hi: p.hi, s: p.av, n: 1 }; else { b.lo = Math.min(b.lo, p.lo); b.hi = Math.max(b.hi, p.hi); b.s += p.av; b.n++; } });
      out = Object.keys(byH).map(function (k) { var b = byH[k]; return { t: b.t, lo: b.lo, hi: b.hi, av: b.s / b.n }; }).sort(function (a, b) { return a.t - b.t; });
    }
    return out;
  }
  // stretches of time out of range in the last 7 days (15-minute buckets), longest-lasting first within each day
  function excursions(u) { return runsFor(u, (T.week && T.week.units && T.week.units[u.id]) || []); }
  function runsFor(u, list) {
    var raw = list.map(function (x) { return { t: x[0] * 1000, lo: +x[1], hi: +x[2], av: +x[3] }; });
    var runs = [], cur = null;
    raw.forEach(function (x) {
      var bad = outOf(u, x.lo, x.hi);
      if (bad && cur && x.t - cur.end <= 15 * 6e4 + 1) { cur.end = x.t + 15 * 6e4; cur.peak = (u.max_f != null && x.hi > +u.max_f) ? Math.max(cur.peak, x.hi) : cur.peak; cur.low = Math.min(cur.low, x.lo); }
      else if (bad) { cur = { start: x.t, end: x.t + 15 * 6e4, peak: x.hi, low: x.lo }; runs.push(cur); }
      else cur = null;
    });
    var grace = u.grace_min == null ? 30 : +u.grace_min;
    return runs.filter(function (r) { return (r.end - r.start) / 6e4 > grace; }).map(function (r) {
      r.min = (r.end - r.start) / 6e4; r.high = u.max_f != null && r.peak > +u.max_f;
      r.ongoing = Date.now() - r.end < 20 * 6e4;
      r.notes = T.notes.filter(function (n) { var t = Date.parse(n.at); return n.unit_id === u.id && t >= r.start - 30 * 6e4 && t <= r.end + 6 * 36e5; });
      return r;
    }).reverse();
  }
  function unitState(u) {
    var L = T.week && T.week.latest && T.week.latest[u.id];
    if (!L) return { cls: 'none', label: 'No readings yet', L: null };
    var at = new Date(L.at), t = +L.temp_f, stale = (Date.now() - at.getTime()) / 6e4 > STALE_MIN;
    var ex = excursions(u).filter(function (r) { return r.ongoing; })[0];
    if (outOf(u, t, t)) return { cls: ex ? 'bad' : 'warn', label: ex ? 'Out of range for ' + durTxt(ex.min) : (u.max_f != null && t > +u.max_f ? 'Above ' + lim(u.max_f) : 'Below ' + lim(u.min_f)) + 'F just now', L: L, at: at, stale: stale };
    if (stale) { var a = ago(at); return { cls: 'warn', label: /ago$/.test(a) ? 'No reading for ' + a.replace(' ago', '') : 'No reading since ' + a, L: L, at: at, stale: true }; }
    return { cls: 'ok', label: 'In range', L: L, at: at };
  }

  /* ---------- page ---------- */
  function shell() {
    T.el.innerHTML = '';
    T.el.appendChild(h('div', { cls: 'ed-head tp-head' }, [h('h1', { cls: 'an-h1', text: 'Temperatures' }), h('div', { cls: 'tp-tabs', role: 'tablist' }, [])]));
    T.el.appendChild(h('p', { cls: 'tp-status', hidden: true, role: 'status' }));
    T.body = h('div', { cls: 'tp-body' }); T.el.appendChild(T.body);
  }
  function tabs() {
    var bar = T.el.querySelector('.tp-tabs'); bar.innerHTML = '';
    var t = [['', 'Coolers & freezers'], ['log', 'Monthly log']].concat(isMgr() ? [['setup', 'Set up']] : []);
    t.forEach(function (x) {
      if (hub()) bar.appendChild(h('button', { type: 'button', cls: 'tp-tab', 'aria-current': T.sub === x[0] ? 'page' : null, text: x[1], on: { click: function () { T.sub = x[0]; paint(false); } } }));
      else bar.appendChild(h('a', { href: '#temps' + (x[0] ? '/' + x[0] : ''), cls: 'tp-tab', 'aria-current': T.sub === x[0] ? 'page' : null, text: x[1] }));
    });
  }
  function paint(loading) {
    if (!T.el) return;
    tabs();
    var el = T.body; el.innerHTML = '';
    if (loading && !T.units.length) { el.appendChild(h('p', { cls: 'an-sub', text: 'Loading…' })); return; }
    if (T.missing) { el.appendChild(setupNote()); return; }
    if (T.err) el.appendChild(h('p', { cls: 'pr-err', text: T.err }));
    if (T.sub === 'setup') return paintSetup(el);
    if (T.sub === 'log') return paintLog(el);
    paintMain(el);
  }
  function setupNote() {
    return h('div', { cls: 'pr-setup' }, [h('h2', { cls: 'an-h2', text: 'One step to switch on Temperatures' }),
      h('ol', null, [h('li', { text: 'Open Supabase and choose SQL Editor → New query.' }), h('li', { text: 'Paste in supabase/temperatures.sql from the eden-admin repository and click Run.' }), h('li', { text: 'Come back here and reload the page.' })])]);
  }

  function paintMain(el) {
    var us = activeUnits();
    if (!us.length) {
      el.appendChild(h('div', { cls: 'pr-setup' }, [h('h2', { cls: 'an-h2', text: 'No coolers or freezers yet' }),
        h('p', { text: isMgr() ? 'Add each cooler and freezer with its safe range and the serial number on its Elitech logger.' : 'A manager needs to add the coolers and freezers first.' }),
        isMgr() ? h('a', { cls: 'ed-btn small', href: '#temps/setup', text: 'Set up coolers and freezers' }) : null]));
      if (!hub()) el.appendChild(dropZone());
      return;
    }
    // alerts first
    var bad = us.map(function (u) { return { u: u, s: unitState(u) }; }).filter(function (x) { return x.s.cls === 'bad'; });
    if (bad.length) el.appendChild(h('div', { cls: 'tp-alert', role: 'alert' }, [h('b', { text: 'Out of range now: ' }), bad.map(function (x) { return x.u.name + ' ' + deg(+x.s.L.temp_f) + 'F (' + x.s.label.toLowerCase() + ')'; }).join(' · '), '. Check the unit, move product if needed, and write what you did below.']));
    // the units the ROP HACCP plan tracks get their own row, so the inspector (and the cooks) see them first
    var rop = us.filter(function (u) { return u.rop; }), rest = us.filter(function (u) { return !u.rop; });
    var grid = function (list) { var g = h('div', { cls: 'tp-grid' + (list.length <= 3 ? ' n' + list.length : '') }); list.forEach(function (u) { g.appendChild(card(u)); }); return g; };
    if (rop.length && rest.length) {
      el.appendChild(h('h2', { cls: 'tp-gh' }, ['ROP plan', h('small', { text: ' · the units the ROP HACCP plan tracks' })])); el.appendChild(grid(rop));
      el.appendChild(h('h2', { cls: 'tp-gh', text: 'Other coolers and freezers' })); el.appendChild(grid(rest));
    } else el.appendChild(grid(us));
    el.appendChild(feedLine());
    var u = unitById(T.sel); if (u) el.appendChild(detail(u));
    el.appendChild(hub() ? manualForm() : h('div', { cls: 'tp-two' }, [manualForm(), dropZone()]));
  }
  function card(u) {
    var s = unitState(u), sel = u.id === T.sel;
    var b = h('button', { type: 'button', cls: 'tp-card ' + s.cls + (sel ? ' sel' : ''), 'aria-pressed': sel ? 'true' : 'false', on: { click: function () { T.sel = u.id; paint(false); var d = T.body.querySelector('.tp-detail'); if (d && d.scrollIntoView) d.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); } } }, [
      h('span', { cls: 'tp-cname' }, [u.name, h('small', { text: u.kind === 'freezer' ? 'Freezer' : u.kind === 'cooler' ? 'Cooler' : '' })]),
      h('b', { cls: 'tp-now' + (s.stale ? ' stale' : ''), text: s.L ? deg(+s.L.temp_f) + 'F' : '–' }),
      h('span', { cls: 'tp-pill ' + s.cls }, [s.cls === 'ok' ? '✓ ' : s.cls === 'none' ? '' : '! ', s.label]),
      spark(u),
      h('small', { cls: 'tp-meta', text: (s.at ? 'Read ' + ago(s.at) + (s.L.source === 'manual' ? ' (by hand)' : '') + ' · ' : '') + 'Safe: ' + limitTxt(u) + (s.L && s.L.humidity != null ? ' · ' + Math.round(s.L.humidity) + '% RH' : '') })
    ]);
    return b;
  }
  // the last 24 hours, with the limit as a dashed line
  function spark(u) {
    var p = pts(u.id, 'day'), W = 220, H = 44;
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'tp-spark', 'aria-hidden': 'true', preserveAspectRatio: 'none' });
    if (p.length < 2) return svg;
    var vals = [].concat.apply([], p.map(function (x) { return [x.lo, x.hi]; })); if (u.max_f != null) vals.push(+u.max_f); if (u.min_f != null) vals.push(+u.min_f);
    var lo = Math.min.apply(null, vals) - 1, hi = Math.max.apply(null, vals) + 1, t0 = Date.now() - 864e5;
    var x = function (t) { return (t - t0) / 864e5 * W; }, y = function (v) { return H - 3 - (v - lo) / (hi - lo) * (H - 6); };
    [u.max_f, u.min_f].forEach(function (l) { if (l != null) svg.appendChild(svgEl('line', { x1: 0, x2: W, y1: y(+l), y2: y(+l), class: 'tp-lim' })); });
    svg.appendChild(svgEl('path', { d: p.map(function (q, i) { return (i ? 'L' : 'M') + x(q.t).toFixed(1) + ' ' + y(q.av).toFixed(1); }).join(''), class: 'tp-sline' }));
    return svg;
  }
  function feedLine() {
    var f = T.feed, txt;
    if (!f || !f.at) txt = 'Live feed from Elitech: not connected yet. Until it is, ' + (hub() ? 'a manager adds Elitech’s export each week on the staff site, and you can log readings by hand below.' : 'drop an export file from Elitech iCold below, or log readings by hand.');
    else if (f.error) txt = 'Live feed from Elitech: last check ' + ago(new Date(f.at)) + ' had a problem (' + f.error + ').';
    else txt = 'Live feed from Elitech: checked ' + ago(new Date(f.at)) + '. Readings come in every 5 minutes.';
    var extra = f && f.devices && f.devices.length && isMgr() ? h('a', { href: '#temps/setup', text: ' ' + f.devices.length + (f.devices.length === 1 ? ' logger isn’t' : ' loggers aren’t') + ' set up as a unit yet →' }) : null;
    return h('p', { cls: 'tp-feed' + (f && f.error ? ' err' : '') }, [txt, extra]);
  }

  /* ---------- one unit: chart, out-of-range times, notes ---------- */
  function detail(u) {
    var box = h('section', { cls: 'tp-detail', 'aria-label': u.name });
    var ranges = h('div', { cls: 'fn-range', role: 'group', 'aria-label': 'Time shown' }, Object.keys(RANGES).map(function (k) {
      return h('button', { type: 'button', cls: 'fn-rbtn', 'aria-pressed': T.range === k ? 'true' : 'false', text: RANGES[k].label, on: { click: function () { if (T.range === k) return; var need = k === 'month' && !T.long; T.range = k; if (need) load(); else paint(false); } } });
    }));
    box.appendChild(h('div', { cls: 'tp-dhead' }, [h('h2', { cls: 'fn-h', text: u.name }), ranges]));
    var p = pts(u.id, T.range);
    if (T.range === 'month' && !T.long) box.appendChild(h('p', { cls: 'an-sub', text: 'Loading…' }));
    else if (!p.length) box.appendChild(h('p', { cls: 'an-sub', text: 'No readings in the last ' + RANGES[T.range].label + '.' }));
    else {
      var lo = Math.min.apply(null, p.map(function (x) { return x.lo; })), hi = Math.max.apply(null, p.map(function (x) { return x.hi; }));
      var avg = p.reduce(function (a, x) { return a + x.av; }, 0) / p.length, outMin = 0;
      p.forEach(function (x) { if (outOf(u, x.lo, x.hi)) outMin += RANGES[T.range].bucket === 15 ? 15 : T.range === 'week' ? 60 : 240; });
      box.appendChild(h('div', { cls: 'tp-stats' }, [
        h('span', null, ['Lowest ', h('b', { text: deg(lo) + 'F' })]), h('span', null, ['Average ', h('b', { text: deg(avg) + 'F' })]), h('span', null, ['Highest ', h('b', { text: deg(hi) + 'F' })]),
        h('span', null, ['Safe range ', h('b', { text: limitTxt(u) })]), h('span', null, ['Time out of range ', h('b', { text: outMin ? 'about ' + durTxt(outMin) : 'none' })])
      ]));
      box.appendChild(chart(u, p));
    }
    // out-of-range times (last 7 days) and corrective actions
    var ex = excursions(u);
    box.appendChild(h('h3', { cls: 'tp-h3', text: 'Out of range, last 7 days' }));
    if (!ex.length) box.appendChild(h('p', { cls: 'an-sub', text: 'Nothing out of range for longer than ' + durTxt(u.grace_min == null ? 30 : +u.grace_min) + '.' }));
    else box.appendChild(h('ul', { cls: 'tp-ex' }, ex.map(function (r) {
      var s = new Date(r.start), e = new Date(r.end);
      return h('li', { cls: r.notes.length ? 'done' : '' }, [
        h('div', null, [h('b', { text: dayTxt(s) + ', ' + timeTxt(s) + (r.ongoing ? ' – now' : ' – ' + (ymd(s) === ymd(e) ? '' : dayTxt(e) + ' ') + timeTxt(e)) }),
          ' · ' + durTxt(r.min) + ' · ' + (r.high ? 'reached ' + deg(r.peak) + 'F' : 'down to ' + deg(r.low) + 'F')]),
        r.notes.length ? h('div', { cls: 'tp-acts' }, r.notes.map(function (n) { return h('p', null, [h('span', { text: n.note }), h('small', { text: ' — ' + (n.by_name || 'staff') + ', ' + whenTxt(new Date(n.created_at || n.at)) })]); })) : null,
        noteForm(u, r.start, r.notes.length ? 'Add to this' : 'Write the corrective action')
      ]);
    })));
    var loose = T.notes.filter(function (n) { return n.unit_id === u.id && !ex.some(function (r) { return r.notes.indexOf(n) >= 0; }); }).slice(0, 8);
    box.appendChild(h('h3', { cls: 'tp-h3', text: 'Notes' }));
    if (loose.length) box.appendChild(h('ul', { cls: 'tp-notes' }, loose.map(function (n) { return h('li', null, [h('small', { text: whenTxt(new Date(n.at)) + ' · ' + (n.by_name || 'staff') + ' ' }), n.note]); })));
    box.appendChild(noteForm(u, null, 'Add a note (repair, defrost, cleaning…)'));
    return box;
  }
  function chart(u, p) {
    var fig = h('figure', { cls: 'fn-chart tp-chart' });
    var W = 760, H = 230, L = 46, R = 12, Tp = 12, B = 26, R0 = RANGES[T.range], t1 = Date.now(), t0 = t1 - R0.ms;
    var vals = [].concat.apply([], p.map(function (x) { return [x.lo, x.hi]; })); if (u.max_f != null) vals.push(+u.max_f); if (u.min_f != null) vals.push(+u.min_f);
    var lo = Math.floor(Math.min.apply(null, vals) - 2), hi = Math.ceil(Math.max.apply(null, vals) + 2);
    var x = function (t) { return L + (t - t0) / (t1 - t0) * (W - L - R); }, y = function (v) { return Tp + (H - Tp - B) * (1 - (v - lo) / (hi - lo)); };
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'fn-svg', role: 'img', 'aria-label': u.name + ' temperature, last ' + R0.label });
    // safe band
    var bandTop = u.max_f != null ? y(+u.max_f) : Tp, bandBot = u.min_f != null ? y(+u.min_f) : H - B;
    svg.appendChild(svgEl('rect', { x: L, y: bandTop, width: W - L - R, height: Math.max(0, bandBot - bandTop), class: 'tp-band' }));
    var step = (hi - lo) > 30 ? 10 : (hi - lo) > 12 ? 5 : 2;
    for (var g = Math.ceil(lo / step) * step; g <= hi; g += step) { svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y(g), y2: y(g), class: 'fn-grid' })); var tx = svgEl('text', { x: L - 6, y: y(g) + 4, class: 'fn-ax', 'text-anchor': 'end' }); tx.textContent = g + '°'; svg.appendChild(tx); }
    [u.max_f, u.min_f].forEach(function (l) { if (l == null) return; svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y(+l), y2: y(+l), class: 'tp-limline' })); });
    // x labels
    var ticks = T.range === 'day' ? 6 : T.range === 'week' ? 7 : 6;
    for (var i = 0; i <= ticks; i++) {
      var tt = t0 + (t1 - t0) * i / ticks, d = new Date(tt), lab = svgEl('text', { x: x(tt), y: H - 6, class: 'fn-ax', 'text-anchor': i === 0 ? 'start' : i === ticks ? 'end' : 'middle' });
      lab.textContent = T.range === 'day' ? timeTxt(d).replace(':00', '') : d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' }); svg.appendChild(lab);
    }
    // min–max band and the average line, broken where readings are missing
    var gap = (T.range === 'day' ? 15 : T.range === 'week' ? 60 : 240) * 6e4 * 2.5, segs = [], seg = [];
    p.forEach(function (q, i) { if (i && q.t - p[i - 1].t > gap) { segs.push(seg); seg = []; } seg.push(q); }); segs.push(seg);
    segs.forEach(function (s) {
      if (!s.length) return;
      var up = s.map(function (q) { return x(q.t).toFixed(1) + ' ' + y(q.hi).toFixed(1); }), dn = s.slice().reverse().map(function (q) { return x(q.t).toFixed(1) + ' ' + y(q.lo).toFixed(1); });
      svg.appendChild(svgEl('path', { d: 'M' + up.join('L') + 'L' + dn.join('L') + 'Z', class: 'tp-range' }));
      svg.appendChild(svgEl('path', { d: s.map(function (q, j) { return (j ? 'L' : 'M') + x(q.t).toFixed(1) + ' ' + y(q.av).toFixed(1); }).join(''), class: 'tp-line' }));
    });
    // points out of range
    p.forEach(function (q) { if (outOf(u, q.lo, q.hi)) { var v = u.max_f != null && q.hi > +u.max_f ? q.hi : q.lo; svg.appendChild(svgEl('circle', { cx: x(q.t), cy: y(v), r: 4, class: 'tp-hot' })); } });
    // hover
    var cross = svgEl('line', { y1: Tp, y2: H - B, class: 'fn-cross', visibility: 'hidden' }); svg.appendChild(cross);
    var tip = h('div', { cls: 'fn-tip', hidden: true });
    svg.addEventListener('mousemove', function (ev) {
      var r = svg.getBoundingClientRect(), mx = (ev.clientX - r.left) / r.width * W, t = t0 + (mx - L) / (W - L - R) * (t1 - t0), best = null;
      p.forEach(function (q) { if (!best || Math.abs(q.t - t) < Math.abs(best.t - t)) best = q; });
      if (!best) return;
      cross.setAttribute('x1', x(best.t)); cross.setAttribute('x2', x(best.t)); cross.setAttribute('visibility', 'visible');
      var d = new Date(best.t); tip.hidden = false;
      tip.innerHTML = '';
      tip.appendChild(h('b', { text: (T.range === 'day' ? timeTxt(d) : dayTxt(d) + ' ' + timeTxt(d)) }));
      tip.appendChild(h('div', { text: 'Average ' + deg(best.av) + 'F' })); tip.appendChild(h('div', { text: 'Range ' + deg(best.lo) + ' – ' + deg(best.hi) + 'F' }));
      if (outOf(u, best.lo, best.hi)) tip.appendChild(h('div', { cls: 'tp-tipbad', text: 'Out of range' }));
      var px = (x(best.t) / W) * fig.clientWidth; tip.style.left = Math.min(Math.max(px - 80, 0), fig.clientWidth - 170) + 'px'; tip.style.top = '8px';
    });
    svg.addEventListener('mouseleave', function () { tip.hidden = true; cross.setAttribute('visibility', 'hidden'); });
    fig.appendChild(h('figcaption', null, [h('b', { text: 'Temperature, last ' + R0.label }), h('span', { cls: 'fn-legend' }, [h('span', null, [h('i', { cls: 'fn-sw line tp-swl' }), 'Average']), h('span', null, [h('i', { cls: 'fn-sw tp-swr' }), 'Low–high']), h('span', null, [h('i', { cls: 'fn-sw tp-swb' }), 'Safe range'])])]));
    fig.appendChild(svg); fig.appendChild(tip);
    return fig;
  }
  function noteForm(u, at, label) {
    var wrap = h('details', { cls: 'tp-nform' }), ta = h('textarea', { rows: 2, placeholder: 'What happened and what you did: checked the door seal, moved product to the walk-in, called for repair…', 'aria-label': 'Note' });
    var save = h('button', { type: 'button', cls: 'ed-btn small', text: 'Save note' });
    save.addEventListener('click', function () {
      var v = ta.value.trim(); if (!v) { ta.focus(); return; } if (needWho()) return;
      save.disabled = true;
      sb().from('temp_notes').insert({ unit_id: u.id, at: new Date(at || Date.now()).toISOString(), note: v, by_name: who() }).then(function (r) {
        save.disabled = false;
        if (r.error) { status('Couldn’t save the note. ' + (r.error.message || ''), 'err'); return; }
        status('Note saved.', 'ok'); load();
      });
    });
    wrap.appendChild(h('summary', { text: label })); wrap.appendChild(ta); wrap.appendChild(save);
    return wrap;
  }

  /* ---------- a reading by hand ---------- */
  function manualForm() {
    var us = activeUnits();
    var sel = h('select', { 'aria-label': 'Cooler or freezer' }, us.map(function (u) { return h('option', { value: u.id, text: u.name }); }));
    if (T.sel) sel.value = T.sel;
    var t = h('input', { type: 'text', inputmode: 'decimal', placeholder: '°F', cls: 'tp-tin', 'aria-label': 'Temperature in °F' });
    var note = h('input', { type: 'text', placeholder: 'Note (optional)', 'aria-label': 'Note' });
    var save = h('button', { type: 'button', cls: 'ed-btn small', text: 'Log it' });
    function go() {
      var v = num(t.value); if (v == null || v < -60 || v > 120) { status('Type the temperature in °F, e.g. 38.', 'err'); t.focus(); return; }
      if (needWho()) return;
      var u = unitById(sel.value), at = new Date(); at.setSeconds(0, 0);
      save.disabled = true;
      sb().from('temp_readings').upsert({ unit_id: u.id, at: at.toISOString(), temp_f: v, source: 'manual', by_name: who() }, { onConflict: 'unit_id,at,source' }).then(function (r) {
        if (r.error) { save.disabled = false; status('Couldn’t save the reading. ' + (r.error.message || ''), 'err'); return; }
        var nv = note.value.trim(), bad = outOf(u, v, v);
        (nv ? sb().from('temp_notes').insert({ unit_id: u.id, at: at.toISOString(), note: nv + ' (' + deg(v) + 'F by hand)', by_name: who() }) : Promise.resolve({})).then(function () {
          save.disabled = false; t.value = ''; note.value = '';
          status(bad ? u.name + ' at ' + deg(v) + 'F is out of its safe range (' + limitTxt(u) + '). Write what you did under Out of range.' : 'Logged ' + u.name + ' at ' + deg(v) + 'F.', bad ? 'err' : 'ok');
          T.sel = u.id; load();
        });
      });
    }
    save.addEventListener('click', go); t.addEventListener('keydown', function (e) { if (e.key === 'Enter') go(); });
    return h('section', { cls: 'tp-box' }, [h('h2', { cls: 'fn-h', text: 'Log a reading by hand' }),
      h('p', { cls: 'an-sub', text: 'From a probe thermometer or the unit’s display. It’s saved with your name and the time.' }),
      h('div', { cls: 'tp-mrow' }, [sel, t, note, save])]);
  }

  /* ---------- export files from Elitech iCold / ElitechLog ---------- */
  function dropZone() {
    var inp = h('input', { type: 'file', accept: '.xlsx,.xls,.csv,.txt', multiple: true, hidden: true });
    var zone = h('div', { cls: 'pr-zone tp-zone', tabindex: '0', role: 'button', 'aria-label': 'Add an Elitech export file' }, [
      h('p', { cls: 'pr-zoneh', text: 'Drop an Elitech export here' }),
      h('p', { cls: 'an-sub', text: 'In Elitech iCold: Devices → pick the logger → History data → choose the dates → Export (Excel). Or from ElitechLog on a computer: Export → Excel. Several files at once is fine; readings already saved are skipped.' })
    ]);
    zone.addEventListener('click', function () { inp.click(); });
    zone.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); inp.click(); } });
    zone.addEventListener('dragover', function (e) { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', function () { zone.classList.remove('over'); });
    zone.addEventListener('drop', function (e) { e.preventDefault(); zone.classList.remove('over'); readFiles(e.dataTransfer.files); });
    inp.addEventListener('change', function () { readFiles(inp.files); inp.value = ''; });
    return h('section', { cls: 'tp-box' }, [h('h2', { cls: 'fn-h', text: 'Add readings from a file' }), zone, inp]);
  }
  function sheetjs() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = SHEETJS; s.onload = res; s.onerror = function () { rej(new Error('Couldn’t load the spreadsheet reader. Check your connection.')); }; document.head.appendChild(s); });
  }
  function readFiles(list) {
    var files = [].slice.call(list || []); if (!files.length) return;
    status('Reading ' + files.length + (files.length === 1 ? ' file…' : ' files…'), 'dirty');
    sheetjs().then(function () {
      return Promise.all(files.map(function (f) {
        return f.arrayBuffer().then(function (buf) {
          var csv = /\.(csv|txt)$/i.test(f.name), wb = csv ? XLSX.read(new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, ''), { type: 'string', raw: true }) : XLSX.read(buf, { type: 'array', cellDates: true }), out = [];
          wb.SheetNames.forEach(function (n) { var rows = XLSX.utils.sheet_to_json(wb.Sheets[n], { header: 1, raw: true, defval: '' }); var p = parseExport(rows, f.name); if (p && p.rows.length) out.push(p); });
          return out.length ? out : [{ file: f.name, rows: [], error: 'No temperature readings found in this file.' }];
        });
      }));
    }).then(function (all) { status(''); importDialog([].concat.apply([], all)); }, function (e) { status(e.message || 'Couldn’t read the file.', 'err'); });
  }
  // finds the header row (a time column and a temperature column) and the logger's name and serial above it
  function parseExport(rows, fname) {
    var meta = { name: '', serial: '' }, hi = -1, tc = -1, vc = -1, hc = -1, unit = '';
    for (var i = 0; i < Math.min(rows.length, 60); i++) {
      var r = rows[i].map(function (c) { return String(c == null ? '' : c).trim(); });
      r.forEach(function (c, j) {
        var k = c.toLowerCase(), v = (r[j + 1] || '').trim(), kv = /[:：]\s*(.+)$/.exec(c);
        if (/^(device name|logger name|name|device|description|trip id)\b/.test(k)) meta.name = meta.name || (kv ? kv[1] : v);
        if (/(serial|s\/n|\bsn\b|guid|device id|device no)/.test(k)) meta.serial = meta.serial || (kv ? kv[1] : v).replace(/\s/g, '');
      });
      var t = -1, v2 = -1, hm = -1;
      r.forEach(function (c, j) { var k = c.toLowerCase(); if (t < 0 && /(time|date)/.test(k) && !/(start|stop|interval|delay)/.test(k)) t = j; if (v2 < 0 && /(temp|tmp|t1|probe|℃|°c|°f)/.test(k)) v2 = j; if (hm < 0 && /(humid|rh)/.test(k)) hm = j; });
      if (t >= 0 && v2 >= 0 && t !== v2) { hi = i; tc = t; vc = v2; hc = hm; unit = /°?f\b|℉|fahrenheit/i.test(r[v2]) ? 'F' : /°?c\b|℃|celsius/i.test(r[v2]) ? 'C' : ''; break; }
    }
    if (hi < 0) return { file: fname, rows: [], error: 'Couldn’t find the time and temperature columns.' };
    var out = [];
    for (var n = hi + 1; n < rows.length; n++) {
      var at = toDate(rows[n][tc]), v = num(rows[n][vc]);
      if (!at || v == null) continue;
      out.push({ at: at, v: v, hum: hc >= 0 ? num(rows[n][hc]) : null });
    }
    if (!unit && out.length) { var avg = out.reduce(function (a, x) { return a + x.v; }, 0) / out.length; unit = avg < 12 && avg > -25 ? 'C' : 'F'; meta.guessed = true; }   // a cooler at 3 is °C; at 38 it's °F
    out.sort(function (a, b) { return a.at - b.at; });
    return { file: fname, name: meta.name, serial: meta.serial, unit: unit || 'F', guessed: !!meta.guessed, rows: out };
  }
  function toDate(v) {
    if (v instanceof Date) return isNaN(v) ? null : v;
    if (typeof v === 'number' && v > 30000 && v < 80000) return new Date(Math.round((v - 25569) * 864e5 + new Date().getTimezoneOffset() * 6e4));
    var s = String(v || '').trim(); if (!s) return null;
    var m = /^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i.exec(s) || null, Y, Mo, D, Hh, Mi, Ss, ap;
    if (m) { Y = +m[1]; Mo = +m[2]; D = +m[3]; Hh = +m[4]; Mi = +m[5]; Ss = +(m[6] || 0); ap = m[7]; }
    else {
      m = /^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*(am|pm)?/i.exec(s);
      if (!m) { var d = new Date(s); return isNaN(d) ? null : d; }
      Mo = +m[1]; D = +m[2]; Y = +m[3]; if (Y < 100) Y += 2000; Hh = +m[4]; Mi = +m[5]; Ss = +(m[6] || 0); ap = m[7];
      if (Mo > 12) { var x = Mo; Mo = D; D = x; }   // day/month order
    }
    if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && Hh < 12) Hh += 12; if (ap === 'am' && Hh === 12) Hh = 0; }
    var dt = new Date(Y, Mo - 1, D, Hh, Mi, Ss); return isNaN(dt) ? null : dt;
  }
  function matchUnit(p) {
    var us = T.units, s = (p.serial || '').toLowerCase(), n = (p.name || '').toLowerCase(), f = (p.file || '').toLowerCase();
    return us.filter(function (u) { return u.serial && s && u.serial.toLowerCase() === s; })[0]
      || us.filter(function (u) { return u.serial && (f.indexOf(u.serial.toLowerCase()) >= 0 || (n && n.indexOf(u.serial.toLowerCase()) >= 0)); })[0]
      || us.filter(function (u) { var k = u.name.toLowerCase(); return (n && (n === k || n.indexOf(k) >= 0 || k.indexOf(n) >= 0)) || f.indexOf(k) >= 0; })[0] || null;
  }
  function importDialog(parts) {
    var dlg = h('dialog', { cls: 'pr-dlg tp-dialog' }), items = [];
    dlg.appendChild(h('h2', { cls: 'an-h2', text: 'Add readings from ' + (parts.length === 1 ? 'this file' : 'these files') }));
    parts.forEach(function (p) {
      if (!p.rows.length) { dlg.appendChild(h('p', { cls: 'pr-err', text: p.file + ': ' + (p.error || 'no readings') })); return; }
      var m = matchUnit(p);
      var sel = h('select', { 'aria-label': 'Which cooler or freezer' }, [h('option', { value: '', text: 'Choose a cooler or freezer…' })].concat(activeUnits().map(function (u) { return h('option', { value: u.id, text: u.name }); })));
      if (m) sel.value = m.id;
      var unitSel = h('select', { 'aria-label': 'Units' }, [h('option', { value: 'F', text: '°F' }), h('option', { value: 'C', text: '°C' })]); unitSel.value = p.unit;
      var first = p.rows[0].at, last = p.rows[p.rows.length - 1].at;
      items.push({ p: p, sel: sel, unitSel: unitSel });
      dlg.appendChild(h('div', { cls: 'tp-irow' }, [
        h('p', null, [h('b', { text: p.name || p.file }), h('small', { text: (p.serial ? ' · ' + p.serial : '') + ' · ' + p.rows.length + ' readings, ' + whenTxt(first) + ' to ' + whenTxt(last) })]),
        h('div', { cls: 'tp-mrow' }, [sel, unitSel, p.guessed ? h('small', { text: 'Units guessed from the readings; check them' }) : null])
      ]));
    });
    var go = h('button', { type: 'button', cls: 'ed-btn small pr-accent', text: 'Add readings' }), cancel = h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { dlg.close(); dlg.remove(); } } });
    var msg = h('p', { cls: 'an-sub' });
    go.addEventListener('click', function () {
      var jobs = items.filter(function (x) { return x.sel.value; });
      if (!jobs.length) { msg.textContent = 'Choose which cooler or freezer each file is for.'; return; }
      go.disabled = true; msg.textContent = 'Saving…';
      var rows = [];
      jobs.forEach(function (x) {
        var c = x.unitSel.value === 'C', seen = {};
        x.p.rows.forEach(function (r) {
          var at = new Date(r.at); at.setSeconds(0, 0); var k = at.getTime(); if (seen[k]) return; seen[k] = 1;
          rows.push({ unit_id: x.sel.value, at: at.toISOString(), temp_f: Math.round((c ? r.v * 9 / 5 + 32 : r.v) * 100) / 100, humidity: r.hum, source: 'file', by_name: who() });
        });
      });
      var i = 0, done = 0;
      (function next() {
        if (i >= rows.length) { dlg.close(); dlg.remove(); status('Added ' + done + ' readings.', 'ok'); load(); return; }
        var chunk = rows.slice(i, i + 500); i += 500;
        sb().from('temp_readings').upsert(chunk, { onConflict: 'unit_id,at,source', ignoreDuplicates: true }).then(function (r) {
          if (r.error) { go.disabled = false; msg.textContent = 'Couldn’t save: ' + (r.error.message || ''); return; }
          done += chunk.length; msg.textContent = 'Saving… ' + done + ' of ' + rows.length; next();
        });
      })();
    });
    dlg.appendChild(msg);
    dlg.appendChild(h('div', { cls: 'pr-acts' }, [go, cancel]));
    document.body.appendChild(dlg); dlg.showModal();
  }

  /* ---------- monthly log (to print for the Health Department) ---------- */
  function paintLog(el) {
    if (!T.month) { var d = new Date(); T.month = new Date(d.getFullYear(), d.getMonth(), 1); }
    var m0 = T.month, m1 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1), label = m0.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    var nav = h('div', { cls: 'tp-mnav' }, [
      h('button', { type: 'button', cls: 'ed-btn small', text: '←', 'aria-label': 'Previous month', on: { click: function () { T.month = new Date(m0.getFullYear(), m0.getMonth() - 1, 1); T.logData = null; paint(false); } } }),
      h('b', { text: label }),
      h('button', { type: 'button', cls: 'ed-btn small', text: '→', 'aria-label': 'Next month', disabled: m1 > new Date(), on: { click: function () { T.month = m1; T.logData = null; paint(false); } } }),
      hub() ? null : h('button', { type: 'button', cls: 'ed-btn small pr-accent', text: 'Print', on: { click: printLog } })
    ]);
    var anyRop = T.units.some(function (u) { return u.rop; });
    var which = anyRop ? h('div', { cls: 'fn-range tp-which', role: 'group', 'aria-label': 'Units shown' }, [['all', 'All units'], ['rop', 'ROP plan units']].map(function (x) {
      return h('button', { type: 'button', cls: 'fn-rbtn', 'aria-pressed': (T.logRop ? 'rop' : 'all') === x[0] ? 'true' : 'false', text: x[1], on: { click: function () { T.logRop = x[0] === 'rop'; paint(false); } } });
    })) : null;
    el.appendChild(h('div', { cls: 'fn-top' }, [h('p', { cls: 'an-sub', text: 'Each day’s lowest and highest temperature for every cooler and freezer, readings taken by hand, and corrective actions. Out-of-range days are marked. For the health inspector, choose ROP plan units.' }), h('div', { cls: 'tp-mnav' }, [which, nav])]));
    var box = h('div', { cls: 'tp-log' }); el.appendChild(box);
    var key = ymd(m0);
    if (!T.logData || T.logData.key !== key) {
      box.appendChild(h('p', { cls: 'an-sub', text: 'Loading…' }));
      Promise.all([
        series(m0, m1, 15),
        sb().from('temp_readings').select('unit_id,at,temp_f,by_name').eq('source', 'manual').gte('at', m0.toISOString()).lt('at', m1.toISOString()).order('at').limit(2000),
        sb().from('temp_notes').select('*').gte('at', m0.toISOString()).lt('at', m1.toISOString()).order('at').limit(1000)
      ]).then(function (res) { T.logData = { key: key, s: res[0], man: res[1].data || [], notes: res[2].data || [] }; if (T.sub === 'log') paint(false); },
        function (e) { box.innerHTML = ''; box.appendChild(h('p', { cls: 'pr-err', text: 'Couldn’t load the log. ' + (e && e.message || '') })); });
      return;
    }
    box.appendChild(logTable(m0, m1, T.logData));
  }
  function logTable(m0, m1, D) {
    var us = T.units.filter(function (u) { return (u.active !== false || (D.s.units && D.s.units[u.id])) && (!T.logRop || u.rop); });
    var ids = {}; us.forEach(function (u) { ids[u.id] = 1; });
    // hourly readings rolled up to each local day: [ , lowest, highest]
    var byDay = {}, badDay = {};
    us.forEach(function (u) {
      var list = (D.s.units || {})[u.id] || [];
      list.forEach(function (p) { var d = ymd(new Date(p[0] * 1000)), b = (byDay[d] = byDay[d] || {}), c = b[u.id]; if (!c) b[u.id] = [p[0], +p[1], +p[2]]; else { c[1] = Math.min(c[1], +p[1]); c[2] = Math.max(c[2], +p[2]); } });
      // a day is marked only when the unit stayed out of range longer than its "flag after" time (not a door opening or defrost)
      runsFor(u, list).forEach(function (r) { for (var t = r.start; t < r.end; t += 15 * 6e4) badDay[ymd(new Date(t)) + u.id] = Math.max(badDay[ymd(new Date(t)) + u.id] || 0, r.min); });
    });
    var head = h('tr', null, [h('th', { scope: 'col', text: 'Day' })].concat(us.map(function (u) { return h('th', { scope: 'col', text: u.name, title: limitTxt(u) }); })).concat([h('th', { scope: 'col', text: 'By hand / notes' })]));
    var rows = [], today = new Date();
    for (var d = new Date(m0); d < m1 && d <= today; d.setDate(d.getDate() + 1)) {
      var k = ymd(d), cells = [h('th', { scope: 'row', text: d.toLocaleDateString('en-US', { weekday: 'short', day: 'numeric' }) })];
      us.forEach(function (u) {
        var p = byDay[k] && byDay[k][u.id];
        if (!p) { cells.push(h('td', { cls: 'tp-lnone', text: '–' })); return; }
        var bad = badDay[k + u.id];
        cells.push(h('td', { cls: bad ? 'tp-lbad' : null, title: bad ? 'Out of range for ' + durTxt(bad) : null, text: deg(+p[1]) + ' / ' + deg(+p[2]) + (bad ? ' !' : '') }));
      });
      var bits = D.man.filter(function (r) { return ymd(new Date(r.at)) === k && ids[r.unit_id]; }).map(function (r) { var u = unitById(r.unit_id); return (u ? u.name : '') + ' ' + deg(+r.temp_f) + 'F ' + timeTxt(new Date(r.at)) + (r.by_name ? ' (' + r.by_name.split(' ')[0] + ')' : ''); })
        .concat(D.notes.filter(function (n) { return ymd(new Date(n.at)) === k && (!n.unit_id || ids[n.unit_id]); }).map(function (n) { var u = unitById(n.unit_id); return (u ? u.name + ': ' : '') + n.note + (n.by_name ? ' — ' + n.by_name : ''); }));
      cells.push(h('td', { cls: 'tp-lnote', text: bits.join(' · ') }));
      rows.push(h('tr', null, cells));
    }
    return h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table tp-ltbl' }, [h('thead', null, [head]), h('tbody', null, rows)]),
      h('p', { cls: 'pr-fine', text: 'Lowest / highest °F that day; highs include door openings and freezer defrost cycles. ! = out of the safe range for longer than that unit’s allowance (shown in brackets) that day. Safe ranges: ' + us.map(function (u) { return u.name + ' ' + limitTxt(u) + ' (' + durTxt(u.grace_min == null ? 30 : +u.grace_min) + ')'; }).join('; ') + '.' })]);
  }
  function printLog() {
    if (!T.logData) return;
    var old = document.getElementById('prPrint'); if (old) old.remove();
    var m0 = T.month, m1 = new Date(m0.getFullYear(), m0.getMonth() + 1, 1);
    var box = h('div', { id: 'prPrint', cls: 'tp-print' }, [h('h1', { text: T.logRop ? 'Eden · ROP plan temperature log' : 'Eden · Cooler & freezer temperature log' }),
      h('p', { text: m0.toLocaleDateString('en-US', { month: 'long', year: 'numeric' }) + ' · 118 E. Genesee St., Syracuse · Elitech data loggers (readings every 5 minutes) plus readings taken by hand' }),
      logTable(m0, m1, T.logData),
      h('p', { cls: 'pp-fine', text: 'Printed ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + (who() ? ' by ' + who() : '') + '.   Reviewed by: ____________________   Date: ________' })]);
    document.body.appendChild(box); document.body.classList.add('pr-printing');
    box.style.cssText = 'display:block;position:absolute;left:-10000px;top:0;width:10in';
    var pageH = 7.5 * 96, hgt = box.scrollHeight; box.style.cssText = '';
    box.style.zoom = hgt > pageH ? Math.max(0.55, (pageH - 8) / hgt).toFixed(3) : '';
    var done = function () { document.body.classList.remove('pr-printing'); box.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); if (!('onafterprint' in window)) done(); }, 50);
  }

  /* ---------- set up (managers) ---------- */
  function paintSetup(el) {
    if (!isMgr()) { el.appendChild(h('p', { cls: 'an-sub', text: 'Only managers can change the set-up.' })); return; }
    el.appendChild(h('p', { cls: 'an-sub', text: 'Tick ROP plan for the units the ROP HACCP plan tracks (the freezer and the protein cooler); they come first on the page and get their own monthly log for the inspector. Each cooler and freezer with its safe range. The serial number is on the logger’s label and in Elitech iCold (Devices); with it, the live feed and export files go to the right unit. “Flag after” ignores short spikes from door openings and defrost cycles.' }));
    var tb = h('tbody');
    T.units.forEach(function (u) { tb.appendChild(unitRow(u)); });
    el.appendChild(h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table tp-setup' }, [h('thead', null, [h('tr', null, ['Name', 'Type', 'Lowest °F', 'Highest °F', 'Flag after', 'Logger serial', 'ROP plan', 'In use', ''].map(function (t) { return h('th', { scope: 'col', text: t }); }))]), tb])]));
    var add = function (name, kind, serial) {
      var d = DEFAULTS[kind || 'cooler'];
      return sb().from('temp_units').insert({ name: name, kind: kind || 'cooler', min_f: d.min, max_f: d.max, serial: serial || '', sort: T.units.length }).then(function (r) {
        if (r.error) { status('Couldn’t add it. ' + (/duplicate|unique/i.test(r.error.message || '') ? 'That serial is already on another unit.' : r.error.message || ''), 'err'); return; }
        status('Added ' + name + '.', 'ok'); load();
      });
    };
    var nm = h('input', { type: 'text', placeholder: 'e.g. Walk-in cooler, Line reach-in, Bar cooler, Chest freezer', 'aria-label': 'New unit name' });
    var kd = h('select', { 'aria-label': 'Type' }, [h('option', { value: 'cooler', text: 'Cooler (33–41°F)' }), h('option', { value: 'freezer', text: 'Freezer (0°F or colder)' }), h('option', { value: 'other', text: 'Other (no limits)' })]);
    var sn = h('input', { type: 'text', placeholder: 'Logger serial (optional)', 'aria-label': 'Logger serial' });
    el.appendChild(h('div', { cls: 'tp-box' }, [h('h2', { cls: 'fn-h', text: 'Add a cooler or freezer' }), h('div', { cls: 'tp-mrow' }, [nm, kd, sn, h('button', { type: 'button', cls: 'ed-btn small', text: 'Add', on: { click: function () { var n = nm.value.trim(); if (!n) { nm.focus(); return; } if (/freez/i.test(n) && kd.value === 'cooler') kd.value = 'freezer'; add(n, kd.value, sn.value.trim()); } } })])]));
    var devs = (T.feed && T.feed.devices) || [];
    if (devs.length) el.appendChild(h('div', { cls: 'tp-box' }, [h('h2', { cls: 'fn-h', text: 'Loggers the live feed found' }),
      h('ul', { cls: 'tp-devs' }, devs.map(function (d) { return h('li', null, [h('b', { text: d.name || 'Unnamed logger' }), ' · ' + d.serial + (d.temp_f != null ? ' · ' + deg(+d.temp_f) + 'F now' : ''), ' ', h('button', { type: 'button', cls: 'ed-btn small', text: 'Add as a unit', on: { click: function () { add(d.name || d.serial, /freez/i.test(d.name || '') ? 'freezer' : 'cooler', d.serial); } } })]); }))]));
    el.appendChild(h('div', { cls: 'tp-box' }, [h('h2', { cls: 'fn-h', text: 'Live feed from Elitech' }),
      h('p', { cls: 'an-sub', text: T.feed && T.feed.at ? 'Connected; last check ' + ago(new Date(T.feed.at)) + (T.feed.error ? ', with a problem: ' + T.feed.error : '') + '.' : 'Not connected yet. It needs Elitech’s API access for iCold; once Elitech sends the access details, they’re saved in Cloudflare (not here), and readings start coming in every 5 minutes on their own.' })]));
  }
  function unitRow(u) {
    var save = function (patch) {
      Object.assign(u, patch);
      sb().from('temp_units').update(patch).eq('id', u.id).then(function (r) { status(r.error ? 'Couldn’t save. ' + (/duplicate|unique/i.test(r.error.message || '') ? 'That serial is already on another unit.' : r.error.message || '') : 'Saved.', r.error ? 'err' : 'ok'); });
    };
    var txt = function (k, ph, w) { var i = h('input', { type: 'text', value: u[k] == null ? '' : String(u[k]), placeholder: ph || '', cls: w || '', 'aria-label': k }); i.addEventListener('change', function () { var o = {}; o[k] = i.value.trim(); if (k === 'name' && !o.name) { i.value = u.name; return; } save(o); }); return i; };
    var numIn = function (k, ph) { var i = h('input', { type: 'text', inputmode: 'decimal', cls: 'tp-tin', value: u[k] == null ? '' : String(+u[k]), placeholder: ph || 'none', 'aria-label': k }); i.addEventListener('change', function () { var v = num(i.value), o = {}; o[k] = v; save(o); }); return i; };
    var kd = h('select', { 'aria-label': 'Type' }, ['cooler', 'freezer', 'other'].map(function (k) { return h('option', { value: k, text: k[0].toUpperCase() + k.slice(1) }); })); kd.value = u.kind || 'cooler';
    kd.addEventListener('change', function () { save({ kind: kd.value }); });
    var rop = h('input', { type: 'checkbox', 'aria-label': u.name + ' is tracked for the ROP plan' }); rop.checked = !!u.rop; rop.addEventListener('change', function () { save({ rop: rop.checked }); });
    var on = h('input', { type: 'checkbox' }); on.checked = u.active !== false; on.addEventListener('change', function () { save({ active: on.checked }); });
    var del = h('button', { type: 'button', cls: 'ed-btn small', text: 'Delete', on: { click: function () {
      if (!confirm('Delete ' + u.name + ' and all of its readings? To keep its history, untick In use instead.')) return;
      sb().from('temp_units').delete().eq('id', u.id).then(function (r) { if (r.error) status('Couldn’t delete. ' + (r.error.message || ''), 'err'); else load(); });
    } } });
    var gr = numIn('grace_min', '30');
    return h('tr', { cls: u.active === false ? 'inactive' : null }, [h('td', null, [txt('name')]), h('td', null, [kd]), h('td', null, [numIn('min_f')]), h('td', null, [numIn('max_f')]),
      h('td', null, [gr, h('small', { text: ' min' })]), h('td', null, [txt('serial', 'from the label', 'tp-sn')]), h('td', { cls: 'pr-c' }, [rop]), h('td', { cls: 'pr-c' }, [on]), h('td', null, [del])]);
  }

  window.EdenTemps = {
    show: function (ctx) {
      T.ctx = ctx;
      if (T.el !== ctx.el || !ctx.el.firstChild) { T.el = ctx.el; shell(); }
      T.sub = ctx.sub || '';
      if (!T.units.length || ctx.reload !== false) load(); else paint(false);
    },
    // for Today and the menu badge: how many units are out of range now
    counts: function (ctx) {
      return ctx.sb.rpc('temp_series', { p_from: new Date(Date.now() - 864e5).toISOString(), p_to: new Date(Date.now() + 6e4).toISOString(), p_bucket_min: 15 }).then(function (r) {
        if (r.error || !r.data || r.data.error) return 0;
        return ctx.sb.from('temp_units').select('*').eq('active', true).then(function (q) {
          if (q.error) return 0;
          var save = T.week; T.week = r.data;
          var n = (q.data || []).filter(function (u) { return unitState(u).cls === 'bad'; }).length;
          T.week = save; return n;
        });
      }, function () { return 0; });
    },
    _test: { parseExport: parseExport, toDate: toDate, T: T }
  };
})();
