/* Eden staff site: Payroll (Owner only).
 *   This week:  a weekly timesheet, Sunday to Saturday. Hours come from Square (drop the "Export shifts" CSV from
 *               Square Timecards onto the page), or from the schedule, and can be corrected day by day.
 *               Kitchen hours (a second rate, e.g. Tyler at $30/hr), sick and holiday hours, and commission.
 *               Tips: each day's pool is that day's cash tips plus credit card tips less the 2.75% card processing
 *               fee (from the End of day reports), split by that day's hours among tip-pool staff.
 *               Downloads: the Eden Hospitality Hours sheet for the payroll company, and the Tip Weighted Payroll
 *               sheet for Eden's records. Finalize the week to lock it.
 *   Pay rates:  hourly rate or weekly salary, kitchen rate, commission, tip pool, and the payroll company's ID.
 * Tax withholding is left to the payroll company. Data: supabase/payroll.sql and payroll-square.sql,
 * readable by the Owner only. */
(function () {
  'use strict';
  var SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var ENDS = { cut1: '20:00', cut2: '21:00', close: '22:00' };   // same assumed out-times as the schedule
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var OT_AFTER = 40, OT_RATE = 1.5, CARD_FEE = 0.0275;
  var KITCHEN_JOB = /kitchen|cook|line|prep|dish|chef|pastry|culinary|bake/i;
  // The payroll company's sheet (Eden Hospitality Hours): their Employee IDs and spellings, in their order
  var PAYCO = [['E18629', 'Alden, Kyle'], ['K15347', 'Ball, Tyler'], ['S07721', 'Davis, Keenan B'], ['W26589', 'Colluci, Nerissa'],
    ['X25654', 'Elderbroom, Dakota'], ['C14811', 'Feltham, Ciara'], ['U13555', 'Kwiek, Michael'], ['P11703', 'Labenski, Paige'],
    ['N23918', 'Longo, Jae'], ['Z26136', 'McKay, Ovidiu'], ['U28579', 'Otts, Breauna'], ['Z32304', 'Scott, Aaron'],
    ['W32085', 'Shutter-Beaver, Joe'], ['C00507', 'Strub, Richard'], ['H32480', 'Thor, Ana'], ['J30874', 'Toledo, Joshua'], ['T31170', 'Willaims, Kyle']];
  var P = { ctx: null, el: null, sub: 'week', week: null, emps: [], rates: {}, row: null, fresh: false, sched: null, eod: null, missing: false, v2: true, err: '', seq: 0, t: null, saving: null, refs: {} };

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
  function sb() { return P.ctx.sb; }
  function status(m, k) { if (P.ctx && P.ctx.status) P.ctx.status(m, k); }
  function sunday(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function weekLabel(d) {
    var e = addDays(d, 6), o = { month: 'short', day: 'numeric' };
    return d.toLocaleDateString('en-US', o) + ' – ' + (d.getMonth() === e.getMonth() ? e.getDate() : e.toLocaleDateString('en-US', o)) + ', ' + e.getFullYear();
  }
  function isMissing(e) { return e && (e.code === 'PGRST205' || e.code === '42P01' || /could not find the table|does not exist|schema cache/i.test(e.message || '')); }
  function isMissingCol(e) { return e && (e.code === 'PGRST204' || e.code === '42703' || /column .* (does not exist|of .* in the schema cache)|could not find the '.*' column/i.test(e.message || '')); }
  function r2(n) { return Math.round((+n || 0) * 100) / 100; }
  function money(n) { n = r2(n); return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function hrs(n) { n = r2(n); return n ? String(n) : '0'; }
  function numIn(v) { var s = String(v == null ? '' : v).replace(/[$,\s]/g, ''); if (s === '') return null; var n = parseFloat(s); return isFinite(n) ? n : null; }
  function sum(a) { return r2((a || []).reduce(function (x, y) { return x + (+y || 0); }, 0)); }
  function seven(a) { a = Array.isArray(a) ? a : []; return [0, 1, 2, 3, 4, 5, 6].map(function (i) { return a[i] == null || a[i] === '' ? null : +a[i]; }); }
  function mins(t) { var p = String(t || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function shiftHours(s) {
    if (!s || !s.start || !s.end) return 0;
    var end = ENDS[s.end] || s.end, d = mins(end) - mins(s.start);
    if (d <= 0) { if (ENDS[s.end]) return 0; d += 1440; }
    return d / 60;
  }
  function final() { return P.row && P.row.status === 'final'; }
  // whole cents, the odd cents to the largest remainders, so the shares add up exactly
  function splitCents(total, weights) {
    var c = Math.round((+total || 0) * 100), w = weights.reduce(function (a, b) { return a + (b > 0 ? b : 0); }, 0);
    if (!c || !w) return weights.map(function () { return 0; });
    var parts = weights.map(function (x, i) { var e = c * (x > 0 ? x : 0) / w; return { i: i, b: Math.floor(e), r: e - Math.floor(e) }; });
    var left = c - parts.reduce(function (a, p) { return a + p.b; }, 0);
    parts.slice().sort(function (a, b) { return b.r - a.r; }).forEach(function (p) { if (left > 0) { p.b++; left--; } });
    return parts.map(function (p) { return p.b / 100; });
  }

  /* ---------------- names: staff site ↔ payroll company ↔ Square ---------------- */
  function lev(a, b) {
    var m = a.length, n = b.length, d = [], i, j;
    for (i = 0; i <= m; i++) d[i] = [i];
    for (j = 0; j <= n; j++) d[0][j] = j;
    for (i = 1; i <= m; i++) for (j = 1; j <= n; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[m][n];
  }
  function parts(s) {   // "Ball, Tyler J" or "Tyler J Ball" -> { first, last, all: [tokens] }
    s = String(s || '').toLowerCase().replace(/[^a-z,\s'-]/g, ' ').trim();
    var first, last, toks;
    if (s.indexOf(',') >= 0) { var p = s.split(','); last = p[0].trim(); first = (p[1] || '').trim().split(/\s+/)[0] || ''; }
    else { var t = s.split(/\s+/).filter(Boolean); first = t[0] || ''; last = t.length > 1 ? t[t.length - 1] : ''; }
    toks = s.replace(/,/g, ' ').split(/[\s-]+/).filter(Boolean);
    return { first: first, last: last, all: toks };
  }
  function sameName(a, b) {   // tolerant: last names close (or one inside a hyphenated name), first names close or sharing 3 letters
    var A = parts(a), B = parts(b);
    if (!A.first || !B.first) return false;
    var lastOk = (A.last && B.last && (lev(A.last, B.last) <= 2 || B.all.indexOf(A.last) >= 0 || A.all.indexOf(B.last) >= 0));
    var firstOk = lev(A.first, B.first) <= 1 || (A.first.length >= 3 && B.first.length >= 3 && A.first.slice(0, 3) === B.first.slice(0, 3));
    return !!(lastOk && firstOk);
  }
  function payco(id) {   // { id, name } on the payroll company's sheet, from Pay rates or matched by name
    var r = P.rates[id] || {}, e = empById(id);
    if (r.payroll_id || r.payroll_name) return { id: r.payroll_id || '', name: r.payroll_name || '', set: true };
    var m = PAYCO.filter(function (x) { return sameName(e.name, x[1]); })[0];
    return m ? { id: m[0], name: m[1], auto: true } : { id: '', name: '' };
  }
  function empById(id) { return P.emps.filter(function (x) { return x.id === id; })[0] || {}; }
  function onStaff(e) { return e && e.active !== false; }

  /* ---------------- data ---------------- */
  function load() {
    var my = ++P.seq, wk = iso(P.week), end = iso(addDays(P.week, 6));
    P.err = ''; paint(true);
    return Promise.all([
      sb().from('employees').select('*').order('name'),
      sb().from('pay_rates').select('*'),
      sb().from('payroll_weeks').select('*').eq('week_start', wk).maybeSingle(),
      sb().from('schedule_weeks').select('week_start,shifts,status,published').eq('week_start', wk).maybeSingle(),
      sb().from('eod_reports').select('*').gte('report_date', wk).lte('report_date', end)
    ]).then(function (res) {
      if (my !== P.seq) return;
      var bad = res[1].error || res[2].error;
      P.missing = !!(bad && isMissing(bad));
      if (bad && !P.missing) P.err = 'Couldn’t load payroll. ' + (bad.message || '');
      P.emps = (res[0].data || []).filter(function (e) { return String(e.name || '').trim(); });
      P.rates = {}; (res[1].data || []).forEach(function (r) { P.rates[r.emp] = r; });
      P.v2 = !(res[1].data || []).length || 'kitchen_rate' in res[1].data[0];
      P.sched = res[3].error ? null : res[3].data;
      P.eod = eodDays(res[4].error ? [] : res[4].data || []);
      if (res[2].data) { P.row = res[2].data; P.row.rows = P.row.rows || {}; P.fresh = false; }
      else { P.row = { week_start: wk, status: 'draft', tip_pool: 0, rows: {}, notes: '' }; P.fresh = true; fillFromSchedule(); }
      if (!P.fresh && !P.row.rows._summary) setTimeout(function () { if (P.row && !P.row.rows._summary) saveWeek(); }, 0);   // weeks from before the Financials overview
      if (P.after) { var act = P.after; P.after = null; setTimeout(function () { var f = { print: printSummary, hours: downloadHours, tips: downloadTips, email: emailHours }[act]; if (f) f(); }, 300); }
      if (!final() && P.row.rows._tips) {   // tips come only from the Square file: drop any filled from End of day reports
        var t0 = tipsRow(); (t0.src || []).forEach(function (x, i) { if (x === 'eod') { t0.card[i] = null; t0.cash[i] = null; t0.src[i] = ''; } });
      }
      paint(false);
    }, function () { if (my === P.seq) { P.err = 'Couldn’t reach the database. Check your connection.'; paint(false); } });
  }
  function eodDays(list) {   // each day's tips and net sales from the End of day reports (all shifts that day)
    var d = { cash: [0, 0, 0, 0, 0, 0, 0], card: [0, 0, 0, 0, 0, 0, 0], sales: [0, 0, 0, 0, 0, 0, 0], has: [false, false, false, false, false, false, false], tipsOn: false };
    var wk = iso(P.week);
    list.forEach(function (r) {
      var i = Math.round((Date.parse(r.report_date + 'T12:00:00') - Date.parse(wk + 'T12:00:00')) / 864e5);
      if (i < 0 || i > 6) return;
      if ('tips_cash' in r) d.tipsOn = true;
      d.has[i] = true;
      d.cash[i] = r2(d.cash[i] + (+r.tips_cash || 0)); d.card[i] = r2(d.card[i] + (+r.tips_card || 0)); d.sales[i] = r2(d.sales[i] + (+r.net_sales || 0));
    });
    return d;
  }
  function tipsRow() {
    var t = P.row.rows._tips; if (!t) t = P.row.rows._tips = { cash: seven(), card: seven(), src: [] };
    ['cash', 'card'].forEach(function (k) { var a = t[k]; if (!Array.isArray(a)) t[k] = seven(a); else { for (var i = 0; i < 7; i++) a[i] = a[i] == null || a[i] === '' ? null : +a[i]; a.length = 7; } });
    return t;
  }
  // Days where the Square file's tips and the End of day report's tips aren't the same
  // The week's sales: from the Transactions CSV (or, without one, the End of day reports)
  function weekSales() {
    var x = P.row && P.row.rows._sales;
    if (x) return { net: sum(x.net), gross: sum(x.gross), tax: sum(x.tax), days: x.net, src: 'Transactions CSV' };
    var e = P.eod; if (e && sum(e.sales)) return { net: sum(e.sales), gross: 0, tax: 0, days: e.sales, src: 'End of day reports' };
    return null;
  }
  function labor(c) {
    var S = weekSales(), wages = r2(c.T.wages + c.T.sickPay + c.T.holPay), cost = r2(wages + c.T.comm);
    return { sales: S, wages: wages, comm: c.T.comm, cost: cost, pct: S && S.net ? cost / S.net : null };
  }
  // what the Financials overview reads for each week (kept with the week whenever it saves)
  function summary() {
    try {
      var c = calc(), lb = labor(c);
      return { net: lb.sales ? lb.sales.net : null, tax: lb.sales ? lb.sales.tax : null, salesFrom: lb.sales ? lb.sales.src : '', wages: lb.wages, comm: lb.comm, cost: lb.cost,
        pct: lb.pct, tips: c.T.tips, hours: c.T.total, gross: c.T.gross, at: new Date().toISOString() };
    } catch (e) { return null; }
  }
  function diffTxt(a, b) { var d = r2(a - b); return (d > 0 ? '+' : '−') + money(Math.abs(d)); }
  function tipMismatch() {   // every way the week's tips disagree: [{ day, text }]
    var t = P.row && P.row.rows._tips, e = P.eod, out = [];
    if (!t || !(t.src || []).some(function (x) { return x === 'square' || x === 'team'; })) return out;
    var dl = function (i) { return DAYS[i] + ' ' + md(addDays(P.week, i)); };
    for (var i = 0; i < 7; i++) {
      var used = r2(+t.card[i] || 0);
      // Team sales (all tips on the day's checks) vs the timecard file (only tips taken while someone was clocked in)
      var lbl = t.teamLabel || 'Team sales';
      if (t.team && t.team[i] != null && t.sq && Math.abs(t.team[i] - (t.sq[i] || 0)) >= 0.01)
        out.push({ key: 'src-' + i + '-' + r2(t.team[i]) + '-' + r2(t.sq[i] || 0), day: i, text: dl(i) + ': ' + lbl + ' tips ' + money(t.team[i]) + ', timecard file ' + money(t.sq[i] || 0) + ' (' + diffTxt(t.team[i], t.sq[i] || 0) + ' on checks paid outside the server’s clock-in, or rung under another Square profile). Payroll uses ' + lbl + '.' });
      if (e && e.has[i]) {
        var bits = [];
        if (Math.abs(used - r2(e.card[i])) >= 0.01) bits.push('credit card ' + money(used) + ' in Square vs ' + money(e.card[i]) + ' on the End of day report (' + diffTxt(used, e.card[i]) + ')');
        if (Math.abs(r2(+t.cash[i] || 0) - r2(e.cash[i])) >= 0.01) bits.push('cash ' + money(+t.cash[i] || 0) + ' in Square vs ' + money(e.cash[i]) + ' on the End of day report');
        if (bits.length) out.push({ key: 'eod-' + i + '-' + used + '-' + r2(e.card[i]) + '-' + r2(+t.cash[i] || 0) + '-' + r2(e.cash[i]), day: i, text: dl(i) + ': ' + bits.join('; ') + '.' });
      }
    }
    // a whole-week Team sales file: does the week add up?
    var w = t.teamWeek;
    if (w) {
      var have = sum(t.card);
      if (Math.abs(w.total - have) >= 0.01) {
        var who = [];
        var key = function (n) { return String(n).toLowerCase().replace(/\s+/g, ' ').trim(); }, tc = {};
        if (t.sqBy) { Object.keys(t.sqBy).forEach(function (n) { tc[key(n)] = t.sqBy[n]; }); Object.keys(w.by).forEach(function (n) { var d = r2(w.by[n] - (tc[key(n)] || 0)); if (Math.abs(d) >= 0.01) who.push(n + ' ' + (d > 0 ? '+' : '−') + money(Math.abs(d))); }); }
        var open = [], tm = t.team || [];
        for (var k = 0; k < 7; k++) if ((t.sq && t.sq[k]) && tm[k] == null) open.push(DAYS[k]);
        var anyDay = tm.some(function (x) { return x != null; });
        out.push({ key: 'week-' + r2(w.total) + '-' + r2(have), day: -1, text: 'Week: Team sales tips ' + money(w.total) + ', but the tips by day add up to ' + money(have) + ' (' + diffTxt(w.total, have) + ').' +
          (!anyDay && who.length ? ' Not in the timecard file: ' + who.join(', ') + '.' : '') +
          (open.length ? ' Drop the one-day Team sales export for ' + open.join(', ') + ' to put the rest on the right days.' : ' Check the one-day Team sales files add up to the week.') });
      }
    }
    return out;
  }
  function fillTipsFromEod(quiet) {
    var e = P.eod, t = tipsRow();
    if (!e) return;
    for (var i = 0; i < 7; i++) { t.cash[i] = e.has[i] ? e.cash[i] : null; t.card[i] = e.has[i] ? e.card[i] : null; }
    t.src = e.has.map(function (x) { return x ? 'eod' : ''; });
    if (!quiet) saveSoon();
  }
  function scheduleHours() {   // { emp: [Sun..Sat hours] } from the published schedule (or the draft, if not published yet)
    var out = {}, approx = {}, s = P.sched;
    var list = s ? (s.status === 'published' && s.published ? s.published : s.shifts) || [] : [];
    list.forEach(function (sf) {
      if (!sf || !sf.emp || sf.day == null) return;
      var a = out[sf.emp] || (out[sf.emp] = [0, 0, 0, 0, 0, 0, 0]);
      a[sf.day] = r2(a[sf.day] + shiftHours(sf));
      if (ENDS[sf.end]) (approx[sf.emp] || (approx[sf.emp] = {}))[sf.day] = true;
    });
    return { hours: out, approx: approx, source: !s ? 'none' : s.status === 'published' ? 'published' : 'draft' };
  }
  function fillFromSchedule() {
    var sh = scheduleHours().hours;
    shownEmps().forEach(function (e) {
      var r = rowFor(e.id);
      r.hours = (sh[e.id] || [0, 0, 0, 0, 0, 0, 0]).map(function (x) { return x || null; });
    });
    P.row.source = 'schedule';
  }
  function rowFor(id) {
    var r = P.row.rows[id];
    if (!r) r = P.row.rows[id] = { hours: seven(), adj: null, adj_note: '' };
    // normalize in place (the timesheet's inputs write into these same arrays)
    var norm = function (a) { if (!Array.isArray(a)) return seven(a); for (var i = 0; i < 7; i++) a[i] = a[i] == null || a[i] === '' ? null : +a[i]; a.length = 7; return a; };
    r.hours = norm(r.hours);
    if (r.khours) r.khours = norm(r.khours);
    if (r.nhours) r.nhours = norm(r.nhours);
    return r;
  }
  function empInfo(id) {   // name, position and pay terms: frozen when the week was finalized
    var r = P.row.rows[id], e = empById(id), rate = P.rates[id] || {};
    if (final() && r && r.snap) return r.snap;
    return { name: e.name || 'Former employee', position: e.position || '', pay_type: rate.pay_type || 'hourly', rate: rate.rate == null ? null : +rate.rate,
      weekly_salary: rate.weekly_salary == null ? null : +rate.weekly_salary,
      // Keenan (commission and tips): any hours on his timesheet put him in the tip pool
      tip_eligible: autoPool(e, rate, r) ? true : r && r.pool != null ? !!r.pool : !!rate.tip_eligible,
      kitchen_rate: rate.kitchen_rate == null ? null : +rate.kitchen_rate, commission: !!rate.commission };
  }
  function autoPool(e, rate, r) {
    var commissioned = !!(rate && rate.commission) || /^keenan\b/i.test(String(e && e.name || ''));
    return commissioned && !!r && (r.hours || []).some(function (x) { return +x > 0; });
  }
  function empIds() { return Object.keys((P.row && P.row.rows) || {}).filter(function (k) { return k.charAt(0) !== '_'; }); }
  function shownEmps() {   // employees on staff, plus anyone with hours or pay this week
    var sh = scheduleHours().hours, ids = {}, out = [];
    P.emps.forEach(function (e) { if (onStaff(e) || sh[e.id]) { ids[e.id] = 1; out.push(e); } });
    empIds().forEach(function (id) {
      if (ids[id]) return;
      var r = P.row.rows[id], any = (r.hours || []).concat(r.khours || [], r.nhours || []).some(function (x) { return +x; }) || +r.adj || +r.comm;
      if (any || (final() && r.snap)) { ids[id] = 1; out.push(empById(id).id ? empById(id) : { id: id, name: (r.snap && r.snap.name) || 'Former employee', active: false }); }
    });
    if (final()) out = out.filter(function (e) { return P.row.rows[e.id]; });
    return out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }

  /* ---------------- the numbers ---------------- */
  function dayTips() {   // per day: cash, card before fee, fee, card after fee, pool
    var t = P.row.rows._tips, out = [];
    for (var i = 0; i < 7; i++) {
      var cash = t ? +t.cash[i] || 0 : 0, card = t ? +t.card[i] || 0 : 0, fee = r2(card * CARD_FEE), net = r2(card - fee);
      out.push({ cash: r2(cash), card: r2(card), fee: fee, net: net, pool: r2(cash + net) });
    }
    return out;
  }
  function calc() {
    var emps = shownEmps(), lines = [];
    emps.forEach(function (e) {
      var r = rowFor(e.id), info = empInfo(e.id);
      var days = r.hours.map(function (x) { return +x || 0; }), kdays = (info.kitchen_rate != null || r.khours) ? seven(r.khours).map(function (x) { return +x || 0; }) : [0, 0, 0, 0, 0, 0, 0];
      var ndays = seven(r.nhours).map(function (x) { return +x || 0; });
      if (!info.tip_eligible) { days = days.map(function (x, i) { return r2(x + ndays[i]); }); ndays = [0, 0, 0, 0, 0, 0, 0]; }   // only matters for tip-pool staff
      var main = sum(days), kit = sum(kdays), nt = sum(ndays), total = r2(main + kit + nt);
      var L = { id: e.id, e: e, info: info, days: days, kdays: kdays, ndays: ndays, main: main, kit: kit, nt: nt, ntPay: 0, total: total, reg: 0, ot: 0, regPay: 0, otPay: 0, salary: 0, mainPay: 0, kitPay: 0,
        sick: r2(r.sick), hol: r2(r.hol), sickPay: 0, holPay: 0, comm: r2(r.comm), tipsCash: 0, tipsCard: 0, tips: 0, tipDays: [0, 0, 0, 0, 0, 0, 0], adj: r2(r.adj), adjNote: r.adj_note || '', warn: '' };
      var rate = info.rate == null ? 0 : +info.rate, krate = info.kitchen_rate == null ? rate : +info.kitchen_rate;
      if (info.pay_type === 'salary') {
        L.reg = total; L.salary = r2(info.weekly_salary);
        if (info.weekly_salary == null) L.warn = 'No weekly salary set';
      } else {
        // overtime over 40 hours in the week; with two rates, overtime is paid on the week's blended rate
        L.ot = r2(Math.max(total - OT_AFTER, 0)); L.reg = r2(total - L.ot);
        var straight = r2((main + nt) * rate + kit * krate), blended = total ? straight / total : 0;
        L.mainPay = r2(main * rate); L.kitPay = r2(kit * krate); L.ntPay = r2(nt * rate);
        L.regPay = r2(straight - L.ot * blended); L.otPay = r2(L.ot * blended * OT_RATE);
        L.sickPay = r2(L.sick * rate); L.holPay = r2(L.hol * rate);
        if (info.rate == null && main && !info.commission) L.warn = 'No hourly rate set';
        if (kit && info.kitchen_rate == null) L.warn = 'No kitchen rate set';
      }
      lines.push(L);
    });
    // tips: each day's pool split by that day's hours among tip-pool staff (front-of-house hours, not kitchen)
    var D = dayTips(), tipHrs = [0, 0, 0, 0, 0, 0, 0], pooled = lines.filter(function (L) { return L.info.tip_eligible; }), unshared = [];
    {   // each day on its own: that day's pool ÷ that day's tip-pool hours
      for (var i = 0; i < 7; i++) {
        var w = pooled.map(function (L) { return L.days[i]; });
        tipHrs[i] = sum(w);
        if (D[i].pool && !tipHrs[i]) unshared.push(i);
        var cs = splitCents(D[i].cash, w), cd = splitCents(D[i].net, w);
        pooled.forEach(function (L, j) { L.tipsCash = r2(L.tipsCash + cs[j]); L.tipsCard = r2(L.tipsCard + cd[j]); L.tipDays[i] = r2(cs[j] + cd[j]); });
      }
    }
    var T = { total: 0, main: 0, kit: 0, reg: 0, ot: 0, regPay: 0, otPay: 0, salary: 0, sick: 0, hol: 0, sickPay: 0, holPay: 0, comm: 0, tipsCash: 0, tipsCard: 0, tips: 0, adj: 0, gross: 0, wages: 0, days: [0, 0, 0, 0, 0, 0, 0] };
    lines.forEach(function (L) {
      L.tips = r2(L.tipsCash + L.tipsCard);
      L.wages = r2(L.regPay + L.otPay + L.salary);
      L.gross = r2(L.wages + L.sickPay + L.holPay + L.comm + L.tips + L.adj);
      ['total', 'main', 'kit', 'reg', 'ot', 'regPay', 'otPay', 'salary', 'sick', 'hol', 'sickPay', 'holPay', 'comm', 'tipsCash', 'tipsCard', 'tips', 'adj', 'gross', 'wages'].forEach(function (k) { T[k] = r2(T[k] + L[k]); });
      L.days.forEach(function (x, i) { T.days[i] = r2(T.days[i] + x + L.kdays[i] + L.ndays[i]); });
    });
    var pool = sum(D.map(function (d) { return d.pool; }));
    return { lines: lines, T: T, D: D, tipHrs: tipHrs, unshared: unshared, pool: pool, daily: true };
  }

  /* ---------------- saving ---------------- */
  function saveSoon() {
    P.fresh = false;
    status('Saving…', 'dirty');
    clearTimeout(P.t); P.t = setTimeout(saveWeek, 600);
  }
  function saveWeek() {
    clearTimeout(P.t);
    var sm = summary(); if (sm) P.row.rows._summary = sm;
    var row = { week_start: P.row.week_start, status: P.row.status, tip_pool: r2(P.row.tip_pool), rows: P.row.rows, notes: P.row.notes || '', finalized_at: P.row.finalized_at || null };
    P.t = null;
    var my = P.saving = sb().from('payroll_weeks').upsert(row, { onConflict: 'week_start' }).then(function (r) {
      if (P.saving !== my) return;
      if (r.error) status(isMissing(r.error) ? 'Payroll isn’t set up yet: run supabase/payroll.sql in Supabase.' : 'Couldn’t save: ' + (r.error.message || 'try again.'), 'err');
      else status('Saved.');
    }, function () { status('Couldn’t save. Check your connection; your changes are still on this screen.', 'err'); });
    return my;
  }
  function saveRate(id) {
    var r = P.rates[id];
    var row = { emp: id, pay_type: r.pay_type || 'hourly', rate: r.rate == null ? null : r2(r.rate), weekly_salary: r.weekly_salary == null ? null : r2(r.weekly_salary), tip_eligible: !!r.tip_eligible, notes: r.notes || '' };
    if (P.v2) Object.assign(row, { kitchen_rate: r.kitchen_rate == null ? null : r2(r.kitchen_rate), commission: !!r.commission, payroll_id: r.payroll_id || '', payroll_name: r.payroll_name || '', square_name: r.square_name || '' });
    status('Saving…', 'dirty');
    return sb().from('pay_rates').upsert(row, { onConflict: 'emp' }).then(function (x) {
      if (x.error && isMissingCol(x.error)) { P.v2 = false; status('One step left: run supabase/payroll-square.sql in Supabase to save kitchen rates, commission and payroll IDs.', 'err'); return; }
      if (x.error) status(isMissing(x.error) ? 'Payroll isn’t set up yet: run supabase/payroll.sql in Supabase.' : 'Couldn’t save: ' + (x.error.message || 'try again.'), 'err');
      else status('Saved.');
    }, function () { status('Couldn’t save. Check your connection.', 'err'); });
  }

  /* ---------------- page ---------------- */
  function shell() {
    var el = P.el; el.innerHTML = '';
    var wrap = h('div', { cls: 'an-in pr-in' });
    var tabs = h('nav', { cls: 'an-tabs', 'aria-label': 'Financials pages' }, [
      h('a', { href: '#financials', 'data-sub': 'overview', text: 'Overview' }),
      h('a', { href: '#payroll', 'data-sub': 'week', text: 'Weekly payroll' }),
      h('a', { href: '#payroll/past', 'data-sub': 'past', text: 'Past payroll' }),
      h('a', { href: '#payroll/rates', 'data-sub': 'rates', text: 'Pay rates' })
    ]);
    wrap.appendChild(h('div', { cls: 'an-head' }, [h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Owner only' }), h('h1', { cls: 'sc-week', text: 'Financials' })]), tabs]));
    P.pane = h('div', { cls: 'pr-pane' });
    wrap.appendChild(P.pane);
    el.appendChild(wrap);
    // drop a Square export anywhere on the Payroll page
    el.addEventListener('dragover', function (ev) { if (P.sub === 'week' && !final() && hasFiles(ev)) { ev.preventDefault(); el.classList.add('pr-drop'); } });
    el.addEventListener('dragleave', function (ev) { if (ev.target === el || !el.contains(ev.relatedTarget)) el.classList.remove('pr-drop'); });
    el.addEventListener('drop', function (ev) {
      el.classList.remove('pr-drop');
      if (P.sub !== 'week' || final() || !hasFiles(ev)) return;
      ev.preventDefault(); if (ev.dataTransfer.files.length) readSquare(ev.dataTransfer.files);
    });
  }
  function hasFiles(ev) { return ev.dataTransfer && [].slice.call(ev.dataTransfer.types || []).indexOf('Files') >= 0; }
  function paint(loading) {
    P.el.querySelectorAll('.an-tabs a').forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('data-sub') === P.sub ? 'page' : 'false'); });
    var el = P.pane; el.innerHTML = ''; P.refs = {};
    if (P.sub === 'overview') { paintOverview(el, loading); return; }
    if (P.sub === 'past') { paintPast(el, loading); return; }
    if (loading && !P.row) { el.appendChild(h('p', { cls: 'an-sub', text: 'Loading…' })); return; }
    if (P.missing) { el.appendChild(setupNote('supabase/payroll.sql')); return; }
    if (P.err) { el.appendChild(h('p', { cls: 'pr-err', role: 'alert', text: P.err })); }
    if (!P.v2) el.appendChild(h('p', { cls: 'pr-err', text: 'One step left: run supabase/payroll-square.sql in Supabase (SQL Editor → New query → paste → Run) to save kitchen rates, commission and payroll company IDs. Until then they won’t save.' }));
    if (P.sub === 'rates') paintRates(el); else paintWeek(el, loading);
  }
  function setupNote(file) {
    return h('div', { cls: 'pr-setup' }, [
      h('h2', { cls: 'an-h2', text: 'One step to switch on Payroll' }),
      h('ol', null, [
        h('li', { text: 'Open Supabase and choose SQL Editor → New query.' }),
        h('li', { text: 'Paste in ' + file + ' from the eden-admin repository and click Run. Then do the same with supabase/payroll-square.sql.' }),
        h('li', { text: 'Come back here and reload the page.' })
      ]),
      h('p', { cls: 'an-sub', text: 'Pay rates and payroll are stored so that only you, the Owner, can see them. Managers and staff can’t.' })
    ]);
  }

  /* ----- weekly payroll ----- */
  function paintWeek(el, loading) {
    var wk = P.week, thisWk = sunday(new Date()), lastWk = addDays(thisWk, -7);
    var pill = final() ? h('span', { cls: 'sc-pill ok', text: 'Final' + (P.row.finalized_at ? ' ' + new Date(P.row.finalized_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '') })
      : h('span', { cls: 'sc-pill warn', text: P.fresh ? 'Not started' : 'Draft' });
    el.appendChild(h('div', { cls: 'pr-weekbar' }, [
      h('div', { cls: 'pr-nav' }, [
        h('button', { type: 'button', cls: 'ed-btn ghost small', 'aria-label': 'Previous week', text: '‹', on: { click: function () { go(addDays(wk, -7)); } } }),
        h('h2', { cls: 'pr-wk', text: weekLabel(wk) }),
        h('button', { type: 'button', cls: 'ed-btn ghost small', 'aria-label': 'Next week', text: '›', on: { click: function () { go(addDays(wk, 7)); } } }),
        pill
      ]),
      h('div', { cls: 'pr-jump' }, [
        h('button', { type: 'button', cls: 'ed-btn ghost small', text: 'Last week', disabled: iso(wk) === iso(lastWk), on: { click: function () { go(lastWk); } } }),
        h('button', { type: 'button', cls: 'ed-btn ghost small', text: 'This week', disabled: iso(wk) === iso(thisWk), on: { click: function () { go(thisWk); } } })
      ])
    ]));
    if (loading) { el.appendChild(h('p', { cls: 'an-sub', text: 'Loading…' })); return; }

    var sch = scheduleHours(), ro = final();
    // step 1: the drop zone for the two Square files
    if (!ro) {
      var file = h('input', { type: 'file', accept: '.csv,text/csv', multiple: true, hidden: true, on: { change: function () { if (file.files.length) readSquare(file.files); file.value = ''; } } });
      var when = function (at) { return at ? new Date(at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; };
      var slot = function (n, title, how, got, at) {
        return h('div', { cls: 'pr-slot' + (got ? ' done' : '') }, [
          h('span', { cls: 'pr-slotn', text: got ? '✓' : String(n) }),
          h('div', null, [h('b', { text: title }), h('small', { text: got ? got + (at ? ' · ' + when(at) : '') : how })])
        ]);
      };
      var zone = h('div', { cls: 'pr-zone', tabindex: '0', role: 'button', 'aria-label': 'Drop the two Square files here, or press to choose them' }, [
        h('p', { cls: 'pr-zoneh', text: 'Drag both Square files here' }),
        h('div', { cls: 'pr-slots' }, [
          slot(1, 'Timecards: hours', 'Staff → Time tracking → Timecards → this Sunday–Saturday → Export → Export shifts', P.row.source === 'square' ? P.row.square_file : '', P.row.square_at),
          slot(2, 'Transactions CSV: tips', 'Payments & invoices → Transactions → this Sunday–Saturday → Export → Transactions CSV', P.row.tx_file || '', P.row.tx_at)
        ]),
        h('p', { cls: 'pr-zonef', text: 'or click here to choose the files. Dropping a new file replaces the old one.' })
      ]);
      zone.addEventListener('click', function () { file.click(); });
      zone.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); file.click(); } });
      zone.addEventListener('dragenter', function (ev) { if (hasFiles(ev)) zone.classList.add('over'); });
      zone.addEventListener('dragover', function (ev) { if (hasFiles(ev)) { ev.preventDefault(); zone.classList.add('over'); } });
      zone.addEventListener('dragleave', function (ev) { if (!zone.contains(ev.relatedTarget)) zone.classList.remove('over'); });
      zone.addEventListener('drop', function () { zone.classList.remove('over'); });   // the page reads the files
      el.appendChild(file);
      el.appendChild(zone);
      el.appendChild(h('div', { cls: 'pr-acts pr-zoneacts' }, [
        h('button', { type: 'button', cls: 'ed-btn ghost small', text: 'No Square file? Fill hours from the schedule', on: { click: function () {
          if (!sch.source || sch.source === 'none') { alert('There’s no schedule saved for this week.'); return; }
          if (!P.fresh && !confirm('Replace the hours on this page with the hours from the schedule? Tips, kitchen hours and adjustments stay as they are.')) return;
          fillFromSchedule(); saveSoon(); paint(false);
        } } })]));
    }
    el.appendChild(h('p', { cls: 'an-sub pr-intro', text: ro ? 'This week is final and locked. Reopen it if something needs to change.'
      : 'Check each day against Square, fix anything that’s off, then download the two sheets and finalize. Everything saves automatically.' }));

    // tips that don't match the End of day reports
    var mm = tipMismatch(), rec = P.row.rows._recon || {};
    var openM = mm.filter(function (m) { return !rec[m.key]; }), doneM = mm.filter(function (m) { return rec[m.key]; });
    var tickItem = function (m, done) {
      var cb = h('input', { type: 'checkbox', disabled: ro, 'aria-label': (done ? 'Reconciled: ' : 'Mark reconciled: ') + m.text });
      cb.checked = !!done;
      cb.addEventListener('change', function () {
        var R = P.row.rows._recon || (P.row.rows._recon = {});
        if (cb.checked) R[m.key] = { at: new Date().toISOString(), by: (P.ctx && P.ctx.name) || '' }; else delete R[m.key];
        saveSoon(); paint(false);
      });
      var info = done && rec[m.key] ? h('small', { text: 'Reconciled ' + new Date(rec[m.key].at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (rec[m.key].by ? ' · ' + rec[m.key].by : '') }) : null;
      return h('li', null, [h('label', { cls: 'pr-recon' }, [cb, h('span', null, [m.text, info])])]);
    };
    if (mm.length) {
      var box = h('div', { cls: 'pr-alert' + (openM.length ? '' : ' ok'), role: openM.length ? 'alert' : null });
      if (openM.length) {
        box.appendChild(h('b', { text: openM.length === 1 ? 'One tip number doesn’t agree' : openM.length + ' tip numbers don’t agree' }));
        box.appendChild(h('ul', null, openM.map(function (m) { return tickItem(m, false); })));
        box.appendChild(h('p', { text: 'Tick each one once you’ve checked it in Square; it moves to Reconciled below. Each day’s tip pool uses the Transactions CSV (or a Team sales export) when you’ve dropped one in, otherwise the timecard file.' }));
      } else box.appendChild(h('b', { text: 'Tip numbers reconciled' }));
      if (doneM.length) box.appendChild(h('details', { cls: 'pr-recdone' }, [
        h('summary', { text: 'Reconciled (' + doneM.length + ')' }),
        h('ul', null, doneM.map(function (m) { return tickItem(m, true); }))
      ]));
      el.appendChild(box);
    }
    // step 2: tips by day
    el.appendChild(tipsTable(ro));

    // payroll detail: how each person's pay is worked out
    var openD = false; try { openD = localStorage.getItem('eden-pay-detail') === '1'; } catch (x) {}
    var dbtn = h('button', { type: 'button', cls: 'ed-btn ghost small', 'aria-expanded': openD ? 'true' : 'false', text: openD ? 'Hide payroll detail' : 'Show payroll detail' });
    P.refs.detail = h('div', { cls: 'pr-detail', hidden: !openD });
    dbtn.addEventListener('click', function () {
      var on = P.refs.detail.hidden; P.refs.detail.hidden = !on;
      dbtn.textContent = on ? 'Hide payroll detail' : 'Show payroll detail'; dbtn.setAttribute('aria-expanded', on ? 'true' : 'false');
      try { localStorage.setItem('eden-pay-detail', on ? '1' : '0'); } catch (x) {}
      if (on) { paintDetail(calc()); P.refs.detail.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
    });
    el.appendChild(h('div', { cls: 'pr-detailbar' }, [h('b', { text: 'Timesheet' }), dbtn]));
    // step 3: timesheet
    var emps = shownEmps();
    if (!emps.length) { el.appendChild(h('p', { cls: 'an-sub', text: 'No employees yet. Add them in Schedule → Employees.' })); return; }
    var head = h('tr', null, [h('th', { cls: 'pr-name', scope: 'col', text: 'Employee' })]
      .concat(DOW.map(function (d, i) { return h('th', { scope: 'col', cls: 'pr-day' }, [d, h('small', { text: md(addDays(wk, i)) })]); }))
      .concat(['Hours', 'Reg', 'OT', 'Wages', 'Tips', 'Sick · Holiday · Commission', 'Adjustment', 'Gross'].map(function (t) { return h('th', { scope: 'col', cls: 'pr-num', text: t }); })));
    var body = h('tbody');
    emps.forEach(function (e) {
      var r = rowFor(e.id), info = empInfo(e.id), sched = sch.hours[e.id] || [0, 0, 0, 0, 0, 0, 0], ap = sch.approx[e.id] || {};
      var cells = {}, tr = h('tr', { cls: onStaff(e) ? null : 'inactive' });
      var tags = [info.position, info.pay_type === 'salary' ? 'Salary' : info.rate != null ? money(info.rate) + '/hr' : null, info.commission ? 'Commission' : null, onStaff(e) ? null : 'Not on staff'];
      var who = h('th', { scope: 'row', cls: 'pr-name' }, [h('b', { text: info.name || e.name }), h('small', { text: tags.filter(Boolean).join(' · ') })]);
      cells.warn = h('small', { cls: 'pr-warn' }); who.appendChild(cells.warn);
      if (info.pay_type !== 'salary') {
        var tp = h('input', { type: 'checkbox', disabled: ro, 'aria-label': (info.name || e.name) + ' is in the tip pool this week' }); tp.checked = !!info.tip_eligible;
        tp.addEventListener('change', function () {
          r.pool = tp.checked;
          var rr = P.rates[e.id] || (P.rates[e.id] = { emp: e.id, pay_type: 'hourly', rate: null, weekly_salary: null, tip_eligible: false, notes: '' });
          if (!!rr.tip_eligible !== tp.checked) { rr.tip_eligible = tp.checked; saveRate(e.id); }   // and remember it for next week
          saveSoon(); paint(false);
        });
        who.appendChild(h('label', { cls: 'pr-pooltick' }, [tp, ' Tip pool']));
      }
      tr.appendChild(who);
      cells.tipd = [];
      DOW.forEach(function (d, i) {
        var td = dayInput(r.hours, i, (info.name || e.name) + ', ' + d + ' hours', ro, sched[i] ? 'Scheduled: ' + hrs(sched[i]) + ' h' + (ap[i] ? ' (to a server cut or close; check the real out time)' : '') : 'Not scheduled');
        if (P.row.source !== 'square') { var mark = function () { td.classList.toggle('chg', r2(+r.hours[i] || 0) !== r2(sched[i])); }; td.firstChild.addEventListener('input', mark); mark(); }
        if (ap[i] && P.row.source !== 'square') td.classList.add('approx');
        var tdl = h('small', { cls: 'pr-tipday' }); cells.tipd.push(tdl); td.appendChild(tdl);
        tr.appendChild(td);
      });
      ['total', 'reg', 'ot', 'wages', 'tips'].forEach(function (k) { cells[k] = h('td', { cls: 'pr-num' }); tr.appendChild(cells[k]); });
      // sick and holiday hours, commission
      var extra = h('td', { cls: 'pr-extra' });
      var small = function (k, label, ph, isMoney) {
        var inp = h('input', { type: 'text', inputmode: 'decimal', cls: isMoney ? 'pr-money pr-sm' : 'pr-h pr-sm', value: r[k] ? (isMoney ? r2(r[k]).toFixed(2) : String(r[k])) : '', placeholder: ph, disabled: ro, title: label, 'aria-label': (info.name || e.name) + ' ' + label });
        inp.addEventListener('input', function () { r[k] = numIn(inp.value); refresh(); saveSoon(); });
        return h('label', { cls: 'pr-mini' }, [h('span', { text: label }), inp]);
      };
      if (info.pay_type !== 'salary') { extra.appendChild(small('sick', 'Sick h', '–')); extra.appendChild(small('hol', 'Holiday h', '–')); }
      if (info.commission || r.comm) extra.appendChild(small('comm', 'Commission $', '0.00', true));
      tr.appendChild(extra);
      var adj = h('input', { type: 'text', inputmode: 'decimal', cls: 'pr-money', value: r.adj ? r2(r.adj).toFixed(2) : '', placeholder: '0.00', disabled: ro, 'aria-label': (info.name || e.name) + ' adjustment in dollars' });
      var note = h('input', { type: 'text', cls: 'pr-note', value: r.adj_note || '', placeholder: 'What for?', disabled: ro, 'aria-label': (info.name || e.name) + ' adjustment note' });
      adj.addEventListener('input', function () { r.adj = numIn(adj.value); refresh(); saveSoon(); });
      note.addEventListener('input', function () { r.adj_note = note.value; saveSoon(); });
      tr.appendChild(h('td', { cls: 'pr-adj' }, [adj, note]));
      cells.gross = h('td', { cls: 'pr-num pr-gross' }); tr.appendChild(cells.gross);
      P.refs[e.id] = cells; body.appendChild(tr);
      // hours outside the tip pool at the regular rate (Tyler's second Square profile)
      if (info.tip_eligible && ((r.nhours && sum(r.nhours)) || sqMap(e.id).some(function (x) { return x.as === 'notip'; }))) {
        if (!r.nhours) r.nhours = seven();
        var nt = h('tr', { cls: 'pr-kit' }, [h('th', { scope: 'row', cls: 'pr-name' }, [h('b', { text: '↳ Not in tip pool' }), h('small', { text: (info.rate != null ? money(info.rate) + '/hr' : 'regular rate') + ' · no tips' })])]);
        DOW.forEach(function (d, i) { nt.appendChild(dayInput(r.nhours, i, (info.name || e.name) + ', ' + d + ' hours not in the tip pool', ro, 'Hours outside the tip pool, at the regular rate')); });
        cells.ntotal = h('td', { cls: 'pr-num' }); nt.appendChild(cells.ntotal);
        nt.appendChild(h('td', { colspan: '2' }));
        cells.npay = h('td', { cls: 'pr-num' }); nt.appendChild(cells.npay);
        nt.appendChild(h('td', { colspan: '4' }));
        body.appendChild(nt);
      }
      // kitchen hours at the kitchen rate (Tyler)
      if (info.kitchen_rate != null || (r.khours && sum(r.khours))) {
        if (!r.khours) r.khours = seven();
        var kt = h('tr', { cls: 'pr-kit' }, [h('th', { scope: 'row', cls: 'pr-name' }, [h('b', { text: '↳ Kitchen' }), h('small', { text: (info.kitchen_rate != null ? money(info.kitchen_rate) + '/hr' : 'No kitchen rate set') + ' · not in the tip pool' })])]);
        DOW.forEach(function (d, i) { kt.appendChild(dayInput(r.khours, i, (info.name || e.name) + ', ' + d + ' kitchen hours', ro, 'Kitchen hours at ' + (info.kitchen_rate != null ? money(info.kitchen_rate) + '/hr' : 'the kitchen rate'))); });
        cells.ktotal = h('td', { cls: 'pr-num' }); kt.appendChild(cells.ktotal);
        kt.appendChild(h('td', { colspan: '2' }));
        cells.kpay = h('td', { cls: 'pr-num' }); kt.appendChild(cells.kpay);
        kt.appendChild(h('td', { colspan: '4' }));
        body.appendChild(kt);
      }
    });
    var foot = h('tr', { cls: 'pr-total' }, [h('th', { scope: 'row', cls: 'pr-name', text: 'Total' })]);
    P.refs.T = { days: [] };
    DOW.forEach(function () { var c = h('td', { cls: 'pr-num' }); P.refs.T.days.push(c); foot.appendChild(c); });
    ['total', 'reg', 'ot', 'wages', 'tips', 'extra', 'adj', 'gross'].forEach(function (k) { P.refs.T[k] = h('td', { cls: 'pr-num' + (k === 'gross' ? ' pr-gross' : '') }); foot.appendChild(P.refs.T[k]); });
    el.appendChild(h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table' }, [h('thead', null, [head]), body, h('tfoot', null, [foot])])]));
    el.appendChild(P.refs.detail);
    el.appendChild(P.row.source === 'square' ? h('p', { cls: 'pr-key', text: 'Hours are from the Square file. Hover a day to see what was scheduled.' })
      : h('p', { cls: 'pr-key' }, [h('span', { cls: 'pr-sw chg' }), ' Different from the schedule   ', h('span', { cls: 'pr-sw approx' }), ' Scheduled to a server cut or close (counted as 8, 9 or 10 pm): check the real out time']));

    // scheduled vs worked, day by day
    el.appendChild(schedGrid(shownEmps(), sch));
    // labor percentage for the week
    P.refs.labor = h('div', { cls: 'pr-labor' });
    el.appendChild(P.refs.labor);
    // step 4: the sheets
    var notes = h('textarea', { cls: 'pr-notes', rows: '3', placeholder: 'Anything the payroll company should know this week (new hire, bonus, unpaid leave…)', disabled: ro, 'aria-label': 'Notes for payroll' });
    notes.value = P.row.notes || '';
    notes.addEventListener('input', function () { P.row.notes = notes.value; saveSoon(); });
    el.appendChild(h('label', { cls: 'pr-notesf' }, [h('span', { text: 'Notes for payroll' }), notes]));
    el.appendChild(h('div', { cls: 'pr-out' }, [
      h('div', null, [h('b', { text: 'The two sheets' }), h('p', { text: 'Eden Hospitality Hours goes to the payroll company. Tip Weighted Payroll is for Eden’s records. Only people on staff on the staff site are included.' })]),
      h('div', { cls: 'pr-acts' }, [
        h('button', { type: 'button', cls: 'ed-btn small pr-accent', text: 'Email Hours from ' + PAYROLL_FROM, on: { click: emailHours } }),
        h('button', { type: 'button', cls: 'ed-btn small pr-accent', text: 'Print summary', on: { click: printSummary } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Eden Hospitality Hours (.xlsx)', on: { click: downloadHours } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Tip Weighted Payroll (.xlsx)', on: { click: downloadTips } }),
        ro ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Reopen week', on: { click: reopen } })
          : h('button', { type: 'button', cls: 'ed-btn small', text: 'Finalize week', on: { click: finalize } })])
    ]));
    el.appendChild(h('p', { cls: 'pr-fine', text: 'Tips: each day’s pool is that day’s cash tips plus credit card tips less the 2.75% card processing fee, divided by the hours tip-pool staff worked that day, so a day’s tips go only to the people who worked that day. Each person’s share shows under their hours for the day. Kitchen hours aren’t in the tip pool. Overtime is hours over 40 in the Sunday–Saturday week at 1.5×; with two pay rates it’s paid on the week’s blended rate. Salaried staff are shown at their weekly salary. These are gross amounts before taxes and deductions.' }));
    refresh();
  }
  function dayInput(arr, i, label, ro, title) {
    var inp = h('input', { type: 'text', inputmode: 'decimal', cls: 'pr-h', value: arr[i] == null ? '' : String(arr[i]), placeholder: '–', disabled: ro, 'aria-label': label, title: title });
    inp.addEventListener('input', function () {
      var v = numIn(inp.value); arr[i] = v == null ? null : Math.max(0, Math.min(24, v)); refresh(); saveSoon();
      var row = inp.closest('tr'), tick = row && row.querySelector('.pr-pooltick input');
      if (tick && !tick.checked) { var id = Object.keys(P.refs).filter(function (k) { return P.refs[k] && P.refs[k].tipd && P.refs[k].tipd[0] && row.contains(P.refs[k].tipd[0]); })[0]; if (id && empInfo(id).tip_eligible) tick.checked = true; }
    });
    inp.addEventListener('keydown', function (ev) { arrowKeys(ev, inp); });
    return h('td', { cls: 'pr-dayc' }, [inp]);
  }
  function tipsTable(ro) {
    var t = tipsRow(), e = P.eod || {}, box = h('div', { cls: 'pr-tips' });
    var head = h('tr', null, [h('th', { cls: 'pr-name', scope: 'col', text: 'Tips by day' })].concat(DOW.map(function (d, i) { return h('th', { scope: 'col', cls: 'pr-day' }, [d, h('small', { text: md(addDays(P.week, i)) })]); }), [h('th', { scope: 'col', cls: 'pr-num', text: 'Week' })]));
    var body = h('tbody'), refs = P.refs.tips = {};
    function inRow(k, label) {
      var tr = h('tr', null, [h('th', { scope: 'row', cls: 'pr-name' }, [h('b', { text: label })])]);
      for (var i = 0; i < 7; i++) (function (i) {
        var inp = h('input', { type: 'text', inputmode: 'decimal', cls: 'pr-money pr-tipin', value: t[k][i] == null ? '' : r2(t[k][i]).toFixed(2), placeholder: '–', disabled: ro, 'aria-label': label + ', ' + DAYS[i] });
        inp.addEventListener('input', function () { t[k][i] = numIn(inp.value); (t.src || (t.src = []))[i] = 'manual'; refresh(); saveSoon(); });
        var td = h('td', { cls: 'pr-dayc' + (t.src && t.src[i] === 'eod' ? ' eod' : t.src && t.src[i] === 'square' ? ' sq' : t.src && t.src[i] === 'team' && k === 'card' ? ' team' : '') }, [inp]);
        tr.appendChild(td);
      })(i);
      refs[k + 'T'] = h('td', { cls: 'pr-num' }); tr.appendChild(refs[k + 'T']);
      body.appendChild(tr);
    }
    function calcRow(k, label, strong) {
      var tr = h('tr', { cls: strong ? 'pr-strong' : null }, [h('th', { scope: 'row', cls: 'pr-name' }, [h('b', { text: label })])]);
      refs[k] = []; for (var i = 0; i < 7; i++) { var c = h('td', { cls: 'pr-num' }); refs[k].push(c); tr.appendChild(c); }
      refs[k + 'T'] = h('td', { cls: 'pr-num' }); tr.appendChild(refs[k + 'T']);
      body.appendChild(tr);
    }
    inRow('cash', 'Cash tips'); inRow('card', 'Credit card tips');
    var fromSq = (t.src || []).some(function (x) { return x === 'square' || x === 'team'; });
    if (e.has && e.has.some(Boolean)) {   // the End of day reports, only to check against Square
      [['card', 'Card tips, End of day', 'to check against Square'], ['cash', 'Cash tips, End of day', 'to check against Square']].forEach(function (k) {
        if (k[0] === 'cash' && !sum(e.cash) && !sum(t.cash)) return;
        var sqr = h('tr', { cls: 'pr-sqrow' }, [h('th', { scope: 'row', cls: 'pr-name' }, [h('b', { text: k[1] }), h('small', { text: k[2] })])]);
        for (var q = 0; q < 7; q++) {
          var ev = r2(e[k[0]][q]), tv = r2(+t[k[0]][q] || 0), diff = fromSq && e.has[q] && Math.abs(ev - tv) >= 0.01;
          sqr.appendChild(h('td', { cls: 'pr-num' + (diff ? ' pr-mis' : ''), title: diff ? 'Square: ' + money(tv) : '', text: e.has[q] ? money(ev) + (diff ? ' ≠' : '') : '–' }));
        }
        sqr.appendChild(h('td', { cls: 'pr-num', text: money(sum(e[k[0]])) }));
        body.appendChild(sqr);
      });
    }
    calcRow('fee', 'Less 2.75% card fee'); calcRow('pool', 'Tip pool', true); calcRow('hrs', 'Tip-pool hours'); calcRow('rate', 'Per hour', true);
    box.appendChild(h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table pr-tiptbl' }, [h('thead', null, [head]), body])]));
    var note = h('p', { cls: 'pr-poolnote' }); refs.note = note;
    var days = (e.has || []).filter(Boolean).length;
    box.appendChild(h('div', { cls: 'pr-tipbar' }, [note]));
    var tdays = (t.src || []).filter(function (x) { return x === 'team'; }).length;
    refs.src = fromSq ? (tdays ? 'Credit card tips on ' + tdays + (tdays === 1 ? ' day' : ' days') + ' are from ' + (t.teamLabel || 'Team sales') + ' (green); ' : '') + 'the rest are from the timecard file (blue). Cash is declared cash tips. ' + (days ? 'The End of day reports are shown underneath only to check; a day that doesn’t match is marked ≠. ' : '')
      : 'Tips come from the Square file. Drop this week’s file above to fill them in. ';
    return box;
  }
  /* ----- scheduled vs worked: who went over or under their scheduled time, day by day ----- */
  function schedGrid(emps, sch) {
    var box = h('div', { cls: 'pr-sched' });
    box.appendChild(h('div', { cls: 'pr-schedhead' }, [h('b', { text: 'Scheduled vs worked' }),
      h('span', { cls: 'pr-schedkey' }, [h('i', { cls: 'k-under' }), 'Under schedule', h('i', { cls: 'k-on' }), 'Within 15 min', h('i', { cls: 'k-over' }), 'Over schedule'])]));
    if (!sch.source || sch.source === 'none') { box.appendChild(h('p', { cls: 'pr-schednote', text: 'There’s no schedule for this week to compare with.' })); return box; }
    var rows = [], maxT = 0;
    emps.forEach(function (e) {
      var r = rowFor(e.id), sd = sch.hours[e.id] || [0, 0, 0, 0, 0, 0, 0], ap = sch.approx[e.id] || {};
      var wd = [0, 1, 2, 3, 4, 5, 6].map(function (i) { return r2((+r.hours[i] || 0) + (r.nhours ? +r.nhours[i] || 0 : 0) + (r.khours ? +r.khours[i] || 0 : 0)); });
      if (!sum(sd) && !sum(wd)) return;
      var tot = r2(sum(wd) - sum(sd)); maxT = Math.max(maxT, Math.abs(tot));
      rows.push({ e: e, sd: sd, wd: wd, ap: ap, tot: tot });
    });
    if (!rows.length) { box.appendChild(h('p', { cls: 'pr-schednote', text: 'Nobody was scheduled or worked this week yet.' })); return box; }
    var tb = h('tbody');
    rows.forEach(function (x) {
      var tr = h('tr', null, [h('th', { scope: 'row', text: empInfo(x.e.id).name || x.e.name })]);
      for (var i = 0; i < 7; i++) {
        var s = x.sd[i], w = x.wd[i], d = r2(w - s), cls = 'pr-sc', txt = '', tip;
        if (!s && !w) { cls += ' none'; }
        else if (!s) { cls += ' extra'; txt = '+' + hrs(w); tip = 'Not scheduled · worked ' + hrs(w) + ' h'; }
        else if (!w) { cls += ' miss'; txt = 'off'; tip = 'Scheduled ' + hrs(s) + ' h · didn’t work'; }
        else {
          var a = Math.abs(d), lvl = a < 0.25 ? 0 : a < 1 ? 1 : a < 2 ? 2 : 3;
          cls += lvl === 0 ? ' on' : (d > 0 ? ' over' : ' under') + ' l' + lvl;
          txt = lvl === 0 ? '✓' : (d > 0 ? '+' : '−') + hrs(a);
          tip = 'Scheduled ' + hrs(s) + ' h' + (x.ap[i] ? ' (to a cut or close, counted as 8, 9 or 10 pm)' : '') + ' · worked ' + hrs(w) + ' h · ' + (lvl === 0 ? 'on schedule' : (d > 0 ? '+' : '−') + hrs(a) + ' h');
        }
        tr.appendChild(h('td', { cls: cls + (x.ap[i] && s && w ? ' approx' : ''), title: tip || '', 'aria-label': tip ? DAYS[i] + ': ' + tip : DAYS[i] + ': not scheduled' }, [txt]));
      }
      // the week: a bar centred on zero
      var pct = maxT ? Math.min(50, Math.abs(x.tot) / maxT * 50) : 0;
      var bar = h('div', { cls: 'pr-dbar' }, [h('span', { cls: 'pr-dzero' }), h('span', { cls: 'pr-dfill ' + (Math.abs(x.tot) < 0.25 ? 'on' : x.tot > 0 ? 'over' : 'under'), style: (x.tot >= 0 ? 'left:50%;' : 'right:50%;') + 'width:' + pct + '%' })]);
      tr.appendChild(h('td', { cls: 'pr-dtotc', title: 'Scheduled ' + hrs(sum(x.sd)) + ' h · worked ' + hrs(sum(x.wd)) + ' h' }, [bar, h('span', { cls: 'pr-dnum', text: (Math.abs(x.tot) < 0.25 ? '±0' : (x.tot > 0 ? '+' : '−') + hrs(Math.abs(x.tot))) + ' h' })]));
      tb.appendChild(tr);
    });
    var head = h('tr', null, [h('th', { text: '' })].concat(DOW.map(function (d, i) { return h('th', null, [d, h('small', { text: md(addDays(P.week, i)) })]); }), [h('th', { cls: 'pr-dtoth', text: 'Week' })]));
    box.appendChild(h('div', { cls: 'pr-scroll pr-schedwrap' }, [h('table', { cls: 'pr-schedtbl' }, [h('thead', null, [head]), tb])]));
    box.appendChild(h('p', { cls: 'pr-schednote', text: 'Worked hours (from Square or this timesheet) minus scheduled hours. “off” means scheduled but didn’t work; a + on its own means worked without being scheduled. Shifts scheduled to a server cut or close are counted as ending at 8, 9 or 10 pm (dotted underline), so check those against the real out time.' }));
    return box;
  }

  /* ----- Financials overview: revenue, payroll cost and payroll % week by week ----- */
  var OV = { weeks: null, range: 13, err: '' };
  try { OV.range = +localStorage.getItem('eden-fin-range') || 13; } catch (e) {}
  function loadOverview() {
    var my = ++P.seq; OV.err = ''; paint(true);
    sb().from('payroll_weeks').select('week_start,status,finalized_at,summary:rows->_summary').order('week_start', { ascending: false }).limit(104).then(function (r) {
      if (my !== P.seq) return;
      if (r.error) { P.missing = isMissing(r.error); OV.err = P.missing ? '' : 'Couldn’t load the weeks. ' + (r.error.message || ''); OV.weeks = []; }
      else OV.weeks = (r.data || []).map(function (w) { return { week: w.week_start, status: w.status, s: w.summary && typeof w.summary === 'object' ? w.summary : null }; });
      paint(false);
    }, function () { if (my === P.seq) { OV.err = 'Couldn’t reach the database.'; OV.weeks = []; paint(false); } });
  }
  var REV = '#2a2e33', PAY = '#b0703f';   // Eden's charcoal and ember
  function pctTxt(v) { return v == null ? '–' : (v * 100).toFixed(1) + '%'; }
  function wkLabel(iso_) { var d = new Date(iso_ + 'T12:00:00'); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function paintOverview(el, loading) {
    if (loading || !OV.weeks) { el.appendChild(h('p', { cls: 'an-sub', text: 'Loading…' })); return; }
    if (P.missing) { el.appendChild(setupNote('supabase/payroll.sql')); return; }
    if (OV.err) el.appendChild(h('p', { cls: 'pr-err', text: OV.err }));
    var all = OV.weeks.filter(function (w) { return w.s && (w.s.net || w.s.cost); });
    var pending = OV.weeks.filter(function (w) { return !w.s; });
    // range
    var ranges = h('div', { cls: 'fn-range', role: 'group', 'aria-label': 'Weeks shown' }, [8, 13, 26, 52].map(function (n) {
      return h('button', { type: 'button', cls: 'fn-rbtn', 'aria-pressed': OV.range === n ? 'true' : 'false', text: n === 13 ? 'Quarter' : n === 52 ? 'Year' : n + ' weeks', on: { click: function () { OV.range = n; try { localStorage.setItem('eden-fin-range', n); } catch (e) {} paint(false); } } });
    }));
    el.appendChild(h('div', { cls: 'fn-top' }, [h('p', { cls: 'an-sub', text: 'Each week’s revenue (net sales), payroll cost and payroll percentage, from the weekly payroll. A week appears here once its Square files are in.' }), ranges]));
    if (!all.length) {
      el.appendChild(h('div', { cls: 'pr-setup' }, [h('h2', { cls: 'an-h2', text: 'No weeks yet' }), h('p', { text: 'Open Weekly payroll, drop in the week’s two Square files, and it will show up here.' }), h('a', { cls: 'ed-btn small', href: '#payroll', text: 'Go to Weekly payroll' })]));
      return;
    }
    var shown = all.slice(0, OV.range).reverse();   // oldest first
    var last = shown[shown.length - 1], prev = shown[shown.length - 2];
    var avg = function (k) { var v = shown.filter(function (w) { return w.s[k] != null; }); return v.length ? v.reduce(function (a, w) { return a + w.s[k]; }, 0) / v.length : null; };
    var totNet = shown.reduce(function (a, w) { return a + (w.s.net || 0); }, 0), totCost = shown.reduce(function (a, w) { return a + (w.s.cost || 0); }, 0);
    // KPI tiles: the latest week, against the week before and the range
    var delta = function (a, b, isPct, lowerGood) {
      if (a == null || b == null) return null;
      var d = a - b; if (Math.abs(d) < (isPct ? 0.0005 : 0.5)) return h('small', { cls: 'fn-delta', text: 'same as the week before' });
      var good = lowerGood ? d < 0 : d > 0;
      return h('small', { cls: 'fn-delta ' + (good ? 'good' : 'bad') }, [(d > 0 ? '▲ ' : '▼ ') + (isPct ? (Math.abs(d) * 100).toFixed(1) + ' pts' : money(Math.abs(d))) + ' vs the week before']);
    };
    var tile = function (label, val, sub, dEl, color) {
      return h('div', { cls: 'fn-tile' }, [h('span', { cls: 'fn-tl' }, [color ? h('i', { cls: 'fn-sw', style: 'background:' + color }) : null, label]), h('b', { text: val }), dEl, h('small', { cls: 'fn-sub', text: sub })]);
    };
    el.appendChild(h('p', { cls: 'fn-wk', text: 'Week of ' + weekLabel(new Date(last.week + 'T12:00:00')) + (last.status === 'final' ? ' · final' : ' · draft') }));
    el.appendChild(h('div', { cls: 'fn-tiles' }, [
      tile('Revenue', last.s.net != null ? money(last.s.net) : '–', 'Average ' + money(avg('net') || 0) + ' a week', delta(last.s.net, prev && prev.s.net, false, false), REV),
      tile('Payroll cost', money(last.s.cost), 'Average ' + money(avg('cost') || 0) + ' a week', delta(last.s.cost, prev && prev.s.cost, false, true), PAY),
      tile('Payroll %', pctTxt(last.s.pct), 'Over these ' + shown.length + ' weeks: ' + pctTxt(totNet ? totCost / totNet : null), delta(last.s.pct, prev && prev.s.pct, true, true))
    ]));
    el.appendChild(barsChart(shown));
    el.appendChild(pctChart(shown, totNet ? totCost / totNet : null));
    // table
    var tb = h('tbody', null, shown.slice().reverse().map(function (w) {
      return h('tr', null, [h('th', { scope: 'row' }, [h('a', { href: '#payroll', text: 'Week of ' + wkLabel(w.week), on: { click: function (ev) { ev.preventDefault(); P.week = new Date(w.week + 'T12:00:00'); P.row = null; location.hash = '#payroll'; } } }), w.status === 'final' ? h('small', { text: ' final' }) : h('small', { cls: 'fn-draft', text: ' draft' })]),
        h('td', { cls: 'pr-num', text: w.s.net != null ? money(w.s.net) : '–' }), h('td', { cls: 'pr-num', text: money(w.s.cost) }), h('td', { cls: 'pr-num fn-pctc', text: pctTxt(w.s.pct) }),
        h('td', { cls: 'pr-num', text: money(w.s.tips || 0) }), h('td', { cls: 'pr-num', text: hrs(w.s.hours || 0) })]);
    }));
    var foot = h('tr', { cls: 'pr-total' }, [h('th', { scope: 'row', text: shown.length + ' weeks' }), h('td', { cls: 'pr-num', text: money(totNet) }), h('td', { cls: 'pr-num', text: money(totCost) }), h('td', { cls: 'pr-num', text: pctTxt(totNet ? totCost / totNet : null) }),
      h('td', { cls: 'pr-num', text: money(shown.reduce(function (a, w) { return a + (w.s.tips || 0); }, 0)) }), h('td', { cls: 'pr-num', text: hrs(shown.reduce(function (a, w) { return a + (w.s.hours || 0); }, 0)) })]);
    el.appendChild(h('h2', { cls: 'fn-h', text: 'Week by week' }));
    el.appendChild(h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table fn-table' }, [h('thead', null, [h('tr', null, ['Week', 'Revenue', 'Payroll cost', 'Payroll %', 'Tips', 'Hours'].map(function (t, i) { return h('th', { scope: 'col', cls: i ? 'pr-num' : null, text: t }); }))]), tb, h('tfoot', null, [foot])])]));
    el.appendChild(h('p', { cls: 'pr-fine', text: 'Revenue is net sales from the week’s Transactions CSV (before sales tax and tips). Payroll cost is wages, salary, overtime, sick and holiday pay plus commission; tips aren’t included, since they pass through to the staff. Payroll % = payroll cost ÷ revenue.' + (pending.length ? ' ' + pending.length + (pending.length === 1 ? ' week has' : ' weeks have') + ' been started but not calculated yet; open ' + (pending.length === 1 ? 'it' : 'them') + ' in Weekly payroll to include ' + (pending.length === 1 ? 'it' : 'them') + '.' : '') }));
  }
  /* ----- Past payroll: every week, to open, print, download or email again ----- */
  var PAST = { q: '' };
  function openWeek(wk, act) { P.week = new Date(wk + 'T12:00:00'); P.row = null; P.after = act || null; if (location.hash === '#payroll') { P.sub = 'week'; load(); } else location.hash = '#payroll'; }
  function paintPast(el, loading) {
    if (loading || !OV.weeks) { el.appendChild(h('p', { cls: 'an-sub', text: 'Loading…' })); return; }
    if (P.missing) { el.appendChild(setupNote('supabase/payroll.sql')); return; }
    if (OV.err) el.appendChild(h('p', { cls: 'pr-err', text: OV.err }));
    var search = h('input', { type: 'search', cls: 'pr-pastq', placeholder: 'Find a week: “October”, “2026”, “10/11”…', value: PAST.q, 'aria-label': 'Find a week' });
    el.appendChild(h('div', { cls: 'fn-top' }, [h('p', { cls: 'an-sub', text: 'Every payroll week, newest first. Open one to see it, or print, download or email it again.' }), search]));
    var list = h('div', { cls: 'pr-past' }); el.appendChild(list);
    var label = function (w) { var d = new Date(w.week + 'T12:00:00'); return weekLabel(d); };
    var match = function (w) {
      var q = PAST.q.trim().toLowerCase(); if (!q) return true;
      var d = new Date(w.week + 'T12:00:00'), e = addDays(d, 6);
      var hay = [label(w), w.week, md(d), md(e), d.toLocaleDateString('en-US', { month: 'long' }), e.toLocaleDateString('en-US', { month: 'long' }), String(d.getFullYear()), w.status === 'final' ? 'final' : 'draft'].join(' ').toLowerCase();
      return q.split(/\s+/).every(function (t) { return hay.indexOf(t) >= 0; });
    };
    function draw() {
      list.innerHTML = '';
      var ws = OV.weeks.filter(match);
      if (!OV.weeks.length) { list.appendChild(h('p', { cls: 'an-sub', text: 'No payroll weeks yet. Start one in Weekly payroll.' })); return; }
      if (!ws.length) { list.appendChild(h('p', { cls: 'an-sub', text: 'No weeks match “' + PAST.q + '”.' })); return; }
      var year = null, tb = null;
      ws.forEach(function (w) {
        var y = w.week.slice(0, 4);
        if (y !== year) {
          year = y; tb = h('tbody');
          list.appendChild(h('h2', { cls: 'fn-h', text: y }));
          list.appendChild(h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table fn-table pr-pasttbl' }, [h('thead', null, [h('tr', null, ['Week', 'Revenue', 'Payroll cost', 'Payroll %', 'Tips', 'Gross pay', 'Hours', ''].map(function (t, i) { return h('th', { scope: 'col', cls: i && i < 7 ? 'pr-num' : null, text: t }); }))]), tb])]));
        }
        var s = w.s || {}, act = function (t, a, title) { return h('button', { type: 'button', cls: 'pr-plink', text: t, title: title, on: { click: function () { openWeek(w.week, a); } } }); };
        tb.appendChild(h('tr', null, [
          h('th', { scope: 'row' }, [h('a', { href: '#payroll', text: label(w), on: { click: function (ev) { ev.preventDefault(); openWeek(w.week); } } }),
            h('span', { cls: 'sc-pill ' + (w.status === 'final' ? 'ok' : 'warn'), text: w.status === 'final' ? 'Final' : 'Draft' })]),
          h('td', { cls: 'pr-num', text: s.net != null ? money(s.net) : '–' }), h('td', { cls: 'pr-num', text: s.cost != null ? money(s.cost) : '–' }), h('td', { cls: 'pr-num', text: pctTxt(s.pct) }),
          h('td', { cls: 'pr-num', text: s.tips != null ? money(s.tips) : '–' }), h('td', { cls: 'pr-num', text: s.gross != null ? money(s.gross) : '–' }), h('td', { cls: 'pr-num', text: s.hours != null ? hrs(s.hours) : '–' }),
          h('td', { cls: 'pr-pacts' }, [act('Open', null, 'Open this week'), act('Print', 'print', 'Print the summary'), act('Hours file', 'hours', 'Download the Eden Hospitality Hours sheet'), act('Tip sheet', 'tips', 'Download the Tip Weighted Payroll sheet'), act('Email', 'email', 'Email the Hours sheet from ' + PAYROLL_FROM)])
        ]));
      });
    }
    search.addEventListener('input', function () { PAST.q = search.value; draw(); });
    draw();
  }
  function niceMax(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function svgEl(tag, a) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(a || {}).forEach(function (k) { e.setAttribute(k, a[k]); }); return e; }
  function chartBox(title, legend) {
    var box = h('figure', { cls: 'fn-chart' }, [h('figcaption', null, [h('b', { text: title }), legend ? h('span', { cls: 'fn-legend' }, legend.map(function (l) { return h('span', null, [h('i', { cls: 'fn-sw' + (l[2] ? ' line' : ''), style: 'background:' + l[1] }), l[0]]); })) : null])]);
    var tip = h('div', { cls: 'fn-tip', hidden: true }); box.appendChild(tip);
    return { box: box, tip: tip };
  }
  function showTip(cb, tip, html, x, y) { tip.innerHTML = html; tip.hidden = false; var bw = cb.box.clientWidth; tip.style.left = Math.min(Math.max(x - 80, 0), bw - 170) + 'px'; tip.style.top = (y - 10) + 'px'; }
  // revenue and payroll cost per week, side by side, on one dollar axis
  function barsChart(ws) {
    var cb = chartBox('Revenue and payroll cost', [['Revenue', REV], ['Payroll cost', PAY]]);
    var W = 760, H = 240, L = 64, R = 12, T = 12, B = 30, n = ws.length;
    var max = niceMax(Math.max.apply(null, ws.map(function (w) { return Math.max(w.s.net || 0, w.s.cost || 0); })));
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'fn-svg', role: 'img', 'aria-label': 'Revenue and payroll cost by week' });
    var y = function (v) { return T + (H - T - B) * (1 - v / max); };
    for (var g = 0; g <= 4; g++) { var v = max * g / 4; svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'fn-grid' })); var t = svgEl('text', { x: L - 8, y: y(v) + 4, class: 'fn-ax', 'text-anchor': 'end' }); t.textContent = '$' + (v >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : v); svg.appendChild(t); }
    var band = (W - L - R) / n, bw = Math.max(4, Math.min(18, band * 0.32));
    ws.forEach(function (w, i) {
      var cx = L + band * i + band / 2;
      [[w.s.net || 0, REV, -1], [w.s.cost || 0, PAY, 1]].forEach(function (b) {
        var x = b[2] < 0 ? cx - bw - 1 : cx + 1, top = y(b[0]), hgt = Math.max(0, y(0) - top), r = Math.min(4, bw / 2, hgt);
        svg.appendChild(svgEl('path', { d: 'M' + x + ',' + y(0) + 'V' + (top + r) + 'Q' + x + ',' + top + ' ' + (x + r) + ',' + top + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + top + ' ' + (x + bw) + ',' + (top + r) + 'V' + y(0) + 'Z', fill: b[1] }));
      });
      if (n <= 13 || i % Math.ceil(n / 13) === 0) { var t = svgEl('text', { x: cx, y: H - 10, class: 'fn-ax', 'text-anchor': 'middle' }); t.textContent = wkLabel(w.week); svg.appendChild(t); }
      var hit = svgEl('rect', { x: L + band * i, y: T, width: band, height: H - T - B, fill: 'transparent', class: 'fn-hit' });
      hit.addEventListener('mouseenter', function (ev) { hit.setAttribute('fill', 'rgba(15,18,21,.04)'); var rc = svg.getBoundingClientRect(), sc = rc.width / W; showTip(cb, cb.tip, '<b>Week of ' + wkLabel(w.week) + '</b><span><i style="background:' + REV + '"></i>Revenue ' + money(w.s.net || 0) + '</span><span><i style="background:' + PAY + '"></i>Payroll cost ' + money(w.s.cost) + '</span><span>Payroll % ' + pctTxt(w.s.pct) + '</span>', cx * sc, y(Math.max(w.s.net || 0, w.s.cost)) * sc + 40); });
      hit.addEventListener('mouseleave', function () { hit.setAttribute('fill', 'transparent'); cb.tip.hidden = true; });
      svg.appendChild(hit);
    });
    svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y(0), y2: y(0), class: 'fn-base' }));
    cb.box.appendChild(svg);
    return cb.box;
  }
  // payroll % per week, with the range's overall % as a reference line
  function pctChart(ws, overall) {
    var cb = chartBox('Payroll %', [['Payroll %', PAY, true], ['Average for these weeks', '#7f7a71', true]]);
    var W = 760, H = 200, L = 64, R = 12, T = 14, B = 30, n = ws.length;
    var vals = ws.map(function (w) { return w.s.pct; }).filter(function (v) { return v != null; });
    var hi = Math.max.apply(null, vals.concat([overall || 0])), lo = Math.min.apply(null, vals.concat([overall || 1]));
    var top = Math.ceil((hi + 0.02) * 20) / 20, bot = Math.max(0, Math.floor((lo - 0.02) * 20) / 20);
    var svg = svgEl('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'fn-svg', role: 'img', 'aria-label': 'Payroll percentage by week' });
    var y = function (v) { return T + (H - T - B) * (1 - (v - bot) / ((top - bot) || 1)); };
    var band = (W - L - R) / n, x = function (i) { return L + band * i + band / 2; };
    for (var g = 0; g <= 4; g++) { var v = bot + (top - bot) * g / 4; svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'fn-grid' })); var t = svgEl('text', { x: L - 8, y: y(v) + 4, class: 'fn-ax', 'text-anchor': 'end' }); t.textContent = Math.round(v * 100) + '%'; svg.appendChild(t); }
    if (overall != null) svg.appendChild(svgEl('line', { x1: L, x2: W - R, y1: y(overall), y2: y(overall), class: 'fn-avg' }));
    var pts = ws.map(function (w, i) { return w.s.pct == null ? null : [x(i), y(w.s.pct)]; });
    var d = ''; pts.forEach(function (p) { if (p) d += (d && d.slice(-1) !== 'M' ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); });
    svg.appendChild(svgEl('path', { d: d, fill: 'none', stroke: PAY, 'stroke-width': 2, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
    ws.forEach(function (w, i) {
      var p = pts[i];
      if (p) svg.appendChild(svgEl('circle', { cx: p[0], cy: p[1], r: 4.5, fill: PAY, stroke: '#fff', 'stroke-width': 2 }));
      if (n <= 13 || i % Math.ceil(n / 13) === 0) { var t = svgEl('text', { x: x(i), y: H - 10, class: 'fn-ax', 'text-anchor': 'middle' }); t.textContent = wkLabel(w.week); svg.appendChild(t); }
      var hit = svgEl('rect', { x: L + band * i, y: T, width: band, height: H - T - B, fill: 'transparent' });
      hit.addEventListener('mouseenter', function () { hit.setAttribute('fill', 'rgba(15,18,21,.04)'); var rc = svg.getBoundingClientRect(), sc = rc.width / W; showTip(cb, cb.tip, '<b>Week of ' + wkLabel(w.week) + '</b><span>Payroll % ' + pctTxt(w.s.pct) + '</span><span>' + money(w.s.cost) + ' ÷ ' + money(w.s.net || 0) + '</span>', x(i) * sc, (p ? p[1] : y(bot)) * sc + 40); });
      hit.addEventListener('mouseleave', function () { hit.setAttribute('fill', 'transparent'); cb.tip.hidden = true; });
      svg.appendChild(hit);
    });
    // direct label on the last point
    var lp = pts[pts.length - 1];
    if (lp) { var lt = svgEl('text', { x: Math.min(lp[0] + 8, W - R - 40), y: lp[1] - 8, class: 'fn-lab' }); lt.textContent = pctTxt(ws[ws.length - 1].s.pct); svg.appendChild(lt); }
    cb.box.appendChild(svg);
    return cb.box;
  }

  function paintDetail(c) {
    var box = P.refs.detail; if (!box || box.hidden) return;
    box.innerHTML = '';
    var x2 = function (a, b) { return hrs(a) + ' h × ' + money(b); };
    box.appendChild(h('h3', { text: 'Payroll detail · week of ' + weekLabel(P.week) }));
    var grid = h('div', { cls: 'pr-dgrid' });
    c.lines.filter(function (L) { return L.total || L.gross || L.sick || L.hol; }).forEach(function (L) {
      var i = L.info, rate = i.rate == null ? 0 : +i.rate, rows = [];
      var add = function (label, how, amt, cls) { rows.push(h('tr', { cls: cls || null }, [h('td', { text: label }), h('td', { cls: 'pr-how', text: how || '' }), h('td', { cls: 'pr-num', text: amt == null ? '' : money(amt) })])); };
      if (i.pay_type === 'salary') add('Salary', 'weekly', L.salary);
      else {
        var blended = L.total ? (L.regPay + L.otPay / OT_RATE) / L.total : 0;
        if (L.main) add(i.tip_eligible ? 'Hours in the tip pool' : 'Hours', x2(L.main, rate), r2(L.main * rate));
        if (L.nt) add('Hours outside the tip pool', x2(L.nt, rate), L.ntPay);
        if (L.kit) add('Kitchen hours', x2(L.kit, i.kitchen_rate == null ? rate : i.kitchen_rate), L.kitPay);
        if (L.ot) add('Overtime premium', hrs(L.ot) + ' h over 40 × ½ × ' + money(blended) + (L.kit || L.nt ? ' blended' : ''), r2(L.wages - (L.mainPay + L.ntPay + L.kitPay)));
        if (L.sick) add('Sick', x2(L.sick, rate), L.sickPay);
        if (L.hol) add('Holiday', x2(L.hol, rate), L.holPay);
      }
      add('Wages', '', r2(L.wages + L.sickPay + L.holPay), 'pr-sub');
      if (L.comm) add('Commission', '', L.comm);
      if (L.tips) {
        L.tipDays.forEach(function (t, d) { if (t) add('Tips · ' + DAYS[d], x2(L.days[d], c.tipHrs[d] ? c.D[d].pool / c.tipHrs[d] : 0) + '/h of ' + money(c.D[d].pool), t, 'pr-tipln'); });
        add('Tips', money(L.tipsCard) + ' credit card · ' + money(L.tipsCash) + ' cash', L.tips, 'pr-sub');
      } else if (i.tip_eligible) add('Tips', 'no hours on days with tips', 0);
      if (L.adj) add('Adjustment', L.adjNote || '', L.adj);
      add('Gross pay', '', L.gross, 'pr-grossln');
      var pc = payco(L.id);
      grid.appendChild(h('div', { cls: 'pr-dcard' }, [
        h('div', { cls: 'pr-dhead' }, [h('b', { text: i.name }), h('small', { text: [pc.id, rateText(i), i.tip_eligible ? 'Tip pool' : '', i.commission ? 'Commission' : ''].filter(Boolean).join(' · ') })]),
        h('table', null, [h('tbody', null, rows)]),
        L.warn ? h('p', { cls: 'pr-warn', text: L.warn + ' — see Pay rates' }) : null
      ]));
    });
    box.appendChild(grid);
    var T = c.T;
    box.appendChild(h('p', { cls: 'pr-dtot', text: 'Week: ' + money(T.wages + T.sickPay + T.holPay) + ' wages + ' + money(T.comm) + ' commission + ' + money(T.tips) + ' tips (' + money(T.tipsCard) + ' card, ' + money(T.tipsCash) + ' cash) + ' + money(T.adj) + ' adjustments = ' + money(T.gross) + ' gross. Tip pool after the 2.75% card fee: ' + money(c.pool) + '.' }));
  }
  function arrowKeys(ev, inp) {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Enter') return;
    var all = [].slice.call(P.pane.querySelectorAll('.pr-table:not(.pr-tiptbl) input.pr-h')), i = all.indexOf(inp), step = 7;
    if (i < 0) return;
    var j = ev.key === 'ArrowUp' ? i - step : i + step;
    if (all[j]) { ev.preventDefault(); all[j].focus(); all[j].select(); }
  }
  function refresh() {
    var c = calc();
    c.lines.forEach(function (L) {
      var x = P.refs[L.id]; if (!x) return;
      x.total.textContent = hrs(L.total); x.reg.textContent = hrs(L.reg);
      x.ot.textContent = L.ot ? hrs(L.ot) : '–'; x.ot.classList.toggle('pr-ot', !!L.ot);
      x.wages.textContent = money(L.wages);
      x.wages.title = L.info.pay_type === 'salary' ? 'Weekly salary' : money(L.regPay) + ' regular' + (L.ot ? ' + ' + money(L.otPay) + ' overtime' : '') + (L.kit ? ' (includes ' + money(L.kitPay) + ' kitchen)' : '') + (L.nt ? ' (includes ' + money(L.ntPay) + ' outside the tip pool)' : '');
      x.tips.textContent = L.tips ? money(L.tips) : '–';
      if (x.tipd) x.tipd.forEach(function (el, i) { el.textContent = L.tipDays[i] ? money(L.tipDays[i]) : ''; el.title = L.tipDays[i] ? 'Tips for ' + DAYS[i] + ': ' + hrs(L.days[i]) + ' h × ' + money(c.D[i].pool / (c.tipHrs[i] || 1)) + '/h' : ''; });
      x.tips.title = L.tips ? money(L.tipsCard) + ' credit card + ' + money(L.tipsCash) + ' cash' : '';
      x.gross.textContent = money(L.gross);
      x.warn.textContent = L.warn ? L.warn + ' — see Pay rates' : '';
      if (x.ktotal) { x.ktotal.textContent = hrs(L.kit); x.kpay.textContent = L.kit ? money(L.kitPay) : '–'; }
      if (x.ntotal) { x.ntotal.textContent = hrs(L.nt); x.npay.textContent = L.nt ? money(L.ntPay) : '–'; }
    });
    var T = P.refs.T; if (T) {
      c.T.days.forEach(function (v, i) { T.days[i].textContent = hrs(v); });
      T.total.textContent = hrs(c.T.total); T.reg.textContent = hrs(c.T.reg); T.ot.textContent = hrs(c.T.ot);
      T.wages.textContent = money(c.T.wages); T.tips.textContent = money(c.T.tips);
      T.extra.textContent = [c.T.sick ? hrs(c.T.sick) + ' sick h' : '', c.T.hol ? hrs(c.T.hol) + ' holiday h' : '', c.T.comm ? money(c.T.comm) + ' commission' : ''].filter(Boolean).join(' · ');
      T.adj.textContent = money(c.T.adj); T.gross.textContent = money(c.T.gross);
    }
    paintDetail(c);
    if (P.refs.labor) {
      var Lb = labor(c), box = P.refs.labor; box.innerHTML = '';
      var pct = function (v) { return v == null ? '–' : (v * 100).toFixed(1) + '%'; };
      box.appendChild(h('div', { cls: 'pr-lbig' }, [h('span', { text: 'Labor this week' }), h('b', { text: pct(Lb.pct) })]));
      box.appendChild(h('div', { cls: 'pr-lmath' }, Lb.sales ? [
        h('p', { text: money(Lb.cost) + ' payroll ÷ ' + money(Lb.sales.net) + ' net sales' }),
        h('small', { text: 'Payroll is wages (salary, overtime, kitchen, sick and holiday pay)' + (Lb.comm ? ' plus ' + money(Lb.comm) + ' commission' : '') + '; tips aren’t included. Net sales from the ' + Lb.sales.src + (Lb.sales.tax ? ', before ' + money(Lb.sales.tax) + ' sales tax' : '') + '.' })
      ] : [h('p', { text: 'Drop the Transactions CSV to see the week’s labor percentage.' })]));
    }
    var R = P.refs.tips; if (R) {
      var tc = 0, tk = 0;
      c.D.forEach(function (d, i) {
        R.fee[i].textContent = d.fee ? '−' + money(d.fee) : '–'; R.pool[i].textContent = d.pool ? money(d.pool) : '–';
        R.hrs[i].textContent = c.tipHrs[i] ? hrs(c.tipHrs[i]) : '–'; R.rate[i].textContent = c.tipHrs[i] && d.pool ? money(d.pool / c.tipHrs[i]) : '–';
        R.pool[i].classList.toggle('pr-warn', c.unshared.indexOf(i) >= 0);
        tc += d.cash; tk += d.card;
      });
      var th = sum(c.tipHrs), fee = sum(c.D.map(function (d) { return d.fee; }));
      R.cashT.textContent = money(tc); R.cardT.textContent = money(tk); R.feeT.textContent = fee ? '−' + money(fee) : '–'; R.poolT.textContent = money(c.pool);
      R.hrsT.textContent = hrs(th); R.rateT.textContent = 'by day';
      R.note.textContent = R.src + (c.unshared.length ? 'Tips on ' + c.unshared.map(function (i) { return DAYS[i]; }).join(', ') + ' but nobody in the tip pool has hours that day, so they aren’t split. Check the hours, or “Tip pool” in Pay rates.' : '');
      R.note.classList.toggle('pr-warn', !!c.unshared.length);
    }
  }
  function go(d) { flush().then(function () { P.week = sunday(d); P.row = null; load(); }); }
  function flush() { if (P.t) { return saveWeek() || Promise.resolve(); } return P.saving || Promise.resolve(); }
  function finalize() {
    var c = calc(), missing = c.lines.filter(function (L) { return L.warn; });
    if (missing.length && !confirm(missing.map(function (L) { return L.info.name + ': ' + L.warn; }).join('\n') + '\n\nFinalize anyway?')) return;
    var rcn = P.row.rows._recon || {}, mm = tipMismatch().filter(function (m) { return !rcn[m.key]; });
    if (mm.length && !confirm('These tip numbers haven’t been reconciled:\n\n' + mm.map(function (m) { return '• ' + m.text; }).join('\n') + '\n\nFinalize anyway?')) return;
    if (!confirm('Finalize the week of ' + weekLabel(P.week) + '? Gross pay ' + money(c.T.gross) + '. The hours and pay rates are locked as they are now; you can reopen it later.')) return;
    c.lines.forEach(function (L) {
      var r = rowFor(L.id), i = L.info;
      r.snap = { name: i.name, position: i.position || '', pay_type: i.pay_type, rate: i.rate, weekly_salary: i.weekly_salary, tip_eligible: !!i.tip_eligible, kitchen_rate: i.kitchen_rate, commission: !!i.commission };
    });
    P.row.status = 'final'; P.row.finalized_at = new Date().toISOString(); P.fresh = false;
    saveWeek(); paint(false);
  }
  function reopen() {
    if (!confirm('Reopen this week so it can be changed? Current pay rates will be used again until you finalize it.')) return;
    P.row.status = 'draft'; P.row.finalized_at = null;
    empIds().forEach(function (id) { delete P.row.rows[id].snap; });
    saveWeek(); paint(false);
  }

  /* ---------------- Square: "Export shifts" from Staff → Time tracking → Timecards ---------------- */
  function parseCSV(text) {
    var rows = [], row = [], f = '', q = false, i, c;
    text = String(text).replace(/^﻿/, '');
    for (i = 0; i < text.length; i++) {
      c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(f); f = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(f); rows.push(row); row = []; f = ''; }
      else f += c;
    }
    if (f !== '' || row.length) { row.push(f); rows.push(row); }
    return rows.filter(function (r) { return r.some(function (x) { return String(x).trim(); }); });
  }
  function parseDate(s) {
    s = String(s || '').trim(); var m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(s))) return new Date(+m[1], +m[2] - 1, +m[3]);
    if ((m = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})/.exec(s))) return new Date(+m[3] < 100 ? 2000 + +m[3] : +m[3], +m[1] - 1, +m[2]);
    var t = Date.parse(s); if (!isNaN(t)) { var d = new Date(t); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
    return null;
  }
  function parseTime(s) {   // minutes after midnight
    var m = /(\d{1,2}):(\d{2})(?::\d{2})?\s*([ap])?\.?m?\.?/i.exec(String(s || '')); if (!m) return null;
    var hh = +m[1] % 12; if (!m[3]) hh = +m[1]; else if (/p/i.test(m[3])) hh += 12;
    return hh * 60 + +m[2];
  }
  function hoursVal(s) {   // "7.5", "7:30", "7h 30m"
    s = String(s || '').trim(); var m;
    if (!s) return null;
    if ((m = /^(\d+):(\d{2})$/.exec(s))) return +m[1] + +m[2] / 60;
    if ((m = /(\d+(?:\.\d+)?)\s*h(?:\D+(\d+)\s*m)?/i.exec(s))) return +m[1] + (m[2] ? +m[2] / 60 : 0);
    var n = parseFloat(s.replace(/[^\d.\-]/g, '')); return isFinite(n) ? n : null;
  }
  function squareShifts(text) {
    var rows = parseCSV(text); if (rows.length < 2) throw new Error('That file is empty.');
    var hi = 0; for (var k = 0; k < Math.min(rows.length, 8); k++) { if (rows[k].some(function (x) { return /clock|team member|employee|hours/i.test(x); })) { hi = k; break; } }
    var H = rows[hi].map(function (x) { return String(x).trim().toLowerCase(); });
    var col = function (re, not) { for (var i = 0; i < H.length; i++) if (re.test(H[i]) && !(not && not.test(H[i]))) return i; return -1; };
    var C = {
      first: col(/first name/), last: col(/last name/),
      name: col(/team member|employee|^name$|staff|^member$/, /\bid\b|number|first|last|email|phone/),
      date: col(/(clock[\s-]*in|start|shift).*date|^date$|^in date$/), inT: col(/(clock[\s-]*in|start).*time|^in$|^time in$/),
      outD: col(/(clock[\s-]*out|end).*date/), outT: col(/(clock[\s-]*out|end).*time|^out$|^time out$/),
      paid: col(/paid hours|total hours|hours worked|^hours$|total paid|^duration$/, /unpaid|regular|overtime|double|break/),
      reg: col(/regular hours|^regular$/), ot: col(/overtime hours|^overtime$/), dt: col(/double/),
      brk: col(/unpaid break/), job: col(/job|role|position/),
      wage: col(/hourly wage|^wage$|pay rate|hourly rate/), tips: col(/transaction tips|card tips|^tips$/, /declared|cash/), ctips: col(/declared cash tips|cash tips/)
    };
    if (C.date < 0) C.date = col(/date/);
    if (C.name < 0 && C.first < 0) throw new Error('Couldn’t find the team member column. Make sure it’s Square’s “Export shifts” file.');
    if (C.date < 0) throw new Error('Couldn’t find the date column. Make sure it’s Square’s “Export shifts” file.');
    var out = [];
    rows.slice(hi + 1).forEach(function (r) {
      var name = C.first >= 0 ? (String(r[C.first] || '') + ' ' + String(C.last >= 0 ? r[C.last] || '' : '')).trim() : String(r[C.name] || '').trim();
      if (!name || /^total/i.test(name)) return;
      var d = parseDate(r[C.date]); if (!d) return;
      var hrsv = C.paid >= 0 ? hoursVal(r[C.paid]) : null;
      if (hrsv == null && C.reg >= 0) hrsv = (hoursVal(r[C.reg]) || 0) + (C.ot >= 0 ? hoursVal(r[C.ot]) || 0 : 0) + (C.dt >= 0 ? hoursVal(r[C.dt]) || 0 : 0);
      if (hrsv == null && C.inT >= 0 && C.outT >= 0) {
        var a = parseTime(r[C.inT]), b = parseTime(r[C.outT]);
        if (a != null && b != null) {
          var od = C.outD >= 0 ? parseDate(r[C.outD]) : null, span = b - a + (od ? Math.round((od - d) / 864e5) * 1440 : (b < a ? 1440 : 0));
          var br = C.brk >= 0 ? hoursVal(r[C.brk]) || 0 : 0; if (br > 12) br = br / 60;   // minutes or hours
          hrsv = span / 60 - br;
        }
      }
      if (hrsv == null || hrsv <= 0) return;
      out.push({ name: name, date: d, hours: r2(hrsv), job: C.job >= 0 ? String(r[C.job] || '').trim() : '',
        wage: C.wage >= 0 ? numIn(r[C.wage]) : null, tips: C.tips >= 0 ? numIn(r[C.tips]) || 0 : 0, cash: C.ctips >= 0 ? numIn(r[C.ctips]) || 0 : 0 });
    });
    if (!out.length) throw new Error('Couldn’t find any shifts with hours in that file.');
    return out;
  }
  // Pay rates "square_name": one or more Square names for this person, e.g. "Tyler Ball; Tyler J Ball=notip"
  // (=notip: hours not in the tip pool, at the regular rate; =kitchen: kitchen hours at the kitchen rate)
  function sqMap(id) {
    return String((P.rates[id] || {}).square_name || '').split(';').map(function (x) { var p = x.split('='); return { name: p[0].trim(), as: (p[1] || 'main').trim() }; }).filter(function (x) { return x.name; });
  }
  function matchEmp(name) {
    var n = String(name).toLowerCase().replace(/\s+/g, ' ').trim(), list = P.emps.filter(onStaff), as = 'main';
    var hit = list.filter(function (e) { var m = sqMap(e.id).filter(function (x) { return x.name.toLowerCase() === n; })[0]; if (m) as = m.as; return !!m; })[0]
      || list.filter(function (e) { return String(e.name).toLowerCase().replace(/\s+/g, ' ').trim() === n; })[0]
      || list.filter(function (e) { return sameName(e.name, name); })[0];
    return { emp: hit ? hit.id : '', as: hit ? as : 'main' };
  }
  function saveSqName(id, name, as) {   // remember which staff member (and line) a Square name is
    P.emps.forEach(function (e) {
      var r = P.rates[e.id]; if (!r || !r.square_name) return;
      var keep = sqMap(e.id).filter(function (x) { return x.name.toLowerCase() !== name.toLowerCase(); });
      if (keep.length !== sqMap(e.id).length && e.id !== id) { r.square_name = keep.map(function (x) { return x.name + (x.as !== 'main' ? '=' + x.as : ''); }).join('; '); saveRate(e.id); }
    });
    if (!id) return;
    var r = P.rates[id] || (P.rates[id] = { emp: id, pay_type: 'hourly', rate: null, weekly_salary: null, tip_eligible: false, notes: '' });
    var list = sqMap(id).filter(function (x) { return x.name.toLowerCase() !== name.toLowerCase(); }).concat([{ name: name, as: as }]);
    r.square_name = list.map(function (x) { return x.name + (x.as !== 'main' ? '=' + x.as : ''); }).join('; ');
    saveRate(id);
  }
  function readSquare(files) {
    files = [].slice.call(files.length != null ? files : [files]);
    Promise.all(files.map(function (f) {
      return new Promise(function (res) { var rd = new FileReader(); rd.onload = function () { res({ f: f, text: String(rd.result) }); }; rd.onerror = function () { res({ f: f, text: null }); }; rd.readAsText(f); });
    })).then(function (list) {
      var shifts = null, sname = '', msgs = [];
      list.forEach(function (x) {
        if (x.text == null) { msgs.push(x.f.name + ': couldn’t be read.'); return; }
        var head = (parseCSV(x.text.slice(0, 2000))[0] || []).join(',').toLowerCase();
        if (/(^|,)"?date"?(,|$)/.test(head) && /(^|,)"?tips?"?(,|$)/.test(head) && /transaction id|payment id|total collected|net total/.test(head)) { msgs.push(txFile(x.text, x.f.name)); return; }
        if (/gross sales|net sales/.test(head) && /tips/.test(head) && !/clock/.test(head)) { msgs.push(teamFile(x.text, x.f.name)); return; }
        try { shifts = squareShifts(x.text); sname = x.f.name; } catch (e) { msgs.push(x.f.name + ': ' + e.message); }
      });
      if (msgs.length) { saveSoon(); paint(false); status(msgs.join(' '), /couldn|not|outside|isn’t/i.test(msgs.join(' ')) ? 'err' : 'ok'); }
      if (shifts) importDialog(shifts, sname);
    });
  }
  // Square → Transactions → Export → Transactions CSV for the week: every payment's tip, added up by date
  function txFile(text, fname) {
    var rows = parseCSV(text), H = (rows[0] || []).map(function (x) { return String(x).trim().toLowerCase(); });
    var di = H.indexOf('date'), ti = H.indexOf('tip'); if (ti < 0) ti = H.indexOf('tips');
    var ei = H.indexOf('event type'), st = H.indexOf('transaction status');
    var ni = H.indexOf('net sales'), gi = H.indexOf('gross sales'), xi = H.indexOf('tax');
    var money0 = function (v) { v = String(v || '').trim(); var neg = /^\(.*\)$/.test(v) || /^-/.test(v); var n = numIn(v.replace(/[()\-]/g, '')); return n == null ? 0 : (neg ? -n : n); };
    var sales = { net: [0, 0, 0, 0, 0, 0, 0], gross: [0, 0, 0, 0, 0, 0, 0], tax: [0, 0, 0, 0, 0, 0, 0] };
    if (di < 0 || ti < 0) return fname + ': couldn’t find the Date and Tip columns.';
    var days = [0, 0, 0, 0, 0, 0, 0], seen = [false, false, false, false, false, false, false], outside = 0;
    rows.slice(1).forEach(function (r) {
      var d = parseDate(r[di]); if (!d) return;
      if (st >= 0 && /fail|cancel|void/i.test(r[st] || '')) return;
      var si = Math.round((d - P.week) / 864e5);
      if (si >= 0 && si <= 6) {   // sales for the labor percentage (refunds count against them)
        if (ni >= 0) sales.net[si] = r2(sales.net[si] + money0(r[ni]));
        if (gi >= 0) sales.gross[si] = r2(sales.gross[si] + money0(r[gi]));
        if (xi >= 0) sales.tax[si] = r2(sales.tax[si] + money0(r[xi]));
      }
      if (ei >= 0 && /refund/i.test(r[ei] || '')) return;            // refunds don't change the tip pool here
      var v = numIn(String(r[ti] || '').replace(/[()]/g, '')); if (!v) return;
      var i = Math.round((d - P.week) / 864e5);
      if (i < 0 || i > 6) { outside++; return; }
      days[i] = r2(days[i] + v); seen[i] = true;
    });
    if (ni >= 0 && sum(sales.net)) { sales.file = fname; P.row.rows._sales = sales; }
    if (!seen.some(Boolean)) return fname + ': no tips in this week' + (outside ? ' (the file is for other dates)' : '') + (P.row.rows._sales ? '; net sales ' + money(sum(sales.net)) + ' read.' : '.');
    var t = tipsRow(); t.team = t.team || [null, null, null, null, null, null, null]; t.src = t.src || []; t.teamLabel = 'Transactions';
    P.row.tx_file = fname; P.row.tx_at = new Date().toISOString();
    for (var i = 0; i < 7; i++) { t.team[i] = seen[i] ? days[i] : null; if (seen[i]) { t.card[i] = days[i]; t.src[i] = 'team'; } }
    return 'Transactions: ' + money(sum(days)) + ' in tips' + (ni >= 0 ? ' and ' + money(sum(sales.net)) + ' in net sales' : '') + ' this week.' + (outside ? ' ' + outside + (outside === 1 ? ' payment' : ' payments') + ' outside this week left out.' : '');
  }
  // Square → Reports → Team sales, exported (download button). One day: that day's tips. The whole week: a check.
  function teamFile(text, fname) {
    var rows = parseCSV(text), H = (rows[0] || []).map(function (x) { return String(x).trim().toLowerCase(); });
    var ni = H.indexOf('name'), ti = H.indexOf('tips');
    if (ni < 0 || ti < 0) return fname + ': couldn’t find the Name and Tips columns.';
    var by = {}, total = 0;
    rows.slice(1).forEach(function (r) {
      var n = String(r[ni] || '').trim(), v = numIn(r[ti]);
      if (!n || /^total$/i.test(n) || v == null) return;
      by[n] = r2((by[n] || 0) + v); total = r2(total + v);
    });
    var m = /(\d{4}-\d{2}-\d{2})[^\d]+(\d{4}-\d{2}-\d{2})/.exec(fname) || /(\d{4}-\d{2}-\d{2})/.exec(fname);
    if (!m) return fname + ': keep Square’s file name (it has the dates) so payroll knows which day it’s for.';
    var a = parseDate(m[1]), b = parseDate(m[2] || m[1]), i = Math.round((a - P.week) / 864e5), j = Math.round((b - P.week) / 864e5);
    var t = tipsRow(); t.team = t.team || [null, null, null, null, null, null, null]; t.src = t.src || [];
    if (i === j && i >= 0 && i <= 6) {
      t.teamLabel = 'Team sales';
      t.team[i] = total; t.card[i] = total; t.src[i] = 'team';
      return 'Team sales for ' + DAYS[i] + ': ' + money(total) + ' in tips.';
    }
    if (i === 0 && j === 6) { t.teamWeek = { total: total, by: by, file: fname }; return 'Team sales for the week: ' + money(total) + ' in tips (used to check the days).'; }
    if (j < 0 || i > 6) return fname + ' is for ' + md(a) + '–' + md(b) + ', outside this week.';
    return fname + ': export one day at a time, or the whole Sunday–Saturday week.';
  }
  function importDialog(shifts, fname) {
    var wk = P.week, people = {}, outside = 0, dates = [], sqTips = [0, 0, 0, 0, 0, 0, 0], sqCash = [0, 0, 0, 0, 0, 0, 0];
    shifts.forEach(function (s) {
      var i = Math.round((s.date - wk) / 864e5);
      dates.push(s.date);
      if (i < 0 || i > 6) { outside++; return; }
      var m = matchEmp(s.name);
      var p = people[s.name] || (people[s.name] = { name: s.name, days: [0, 0, 0, 0, 0, 0, 0], kdays: [0, 0, 0, 0, 0, 0, 0], jobs: {}, wages: {}, emp: m.emp, as: m.as });
      var kitchen = KITCHEN_JOB.test(s.job);
      (kitchen ? p.kdays : p.days)[i] = r2((kitchen ? p.kdays : p.days)[i] + s.hours);
      if (s.job) p.jobs[s.job.trim()] = 1;
      if (s.wage != null) p.wages[s.wage.toFixed(2)] = 1;
      sqTips[i] = r2(sqTips[i] + s.tips); sqCash[i] = r2(sqCash[i] + s.cash);
      p.tips = r2((p.tips || 0) + s.tips + s.cash);
    });
    var names = Object.keys(people).sort();
    var dlg = h('dialog', { cls: 'pr-dlg', 'aria-label': 'Import from Square' }), staff = P.emps.filter(onStaff).sort(function (a, b) { return String(a.name).localeCompare(b.name); });
    var first = new Date(Math.min.apply(null, dates)), last = new Date(Math.max.apply(null, dates));
    var intro = names.length ? 'Found ' + shifts.length + ' shifts for ' + names.length + ' people in ' + fname + '.' : 'None of the shifts in ' + fname + ' fall in the week of ' + weekLabel(wk) + '.';
    var kids = [h('h2', { text: 'Hours from Square' }), h('p', { text: intro })];
    if (outside) kids.push(h('p', { cls: 'pr-warn', text: outside + ' shift' + (outside === 1 ? ' is' : 's are') + ' outside this week (the file runs ' + md(first) + ' to ' + md(last) + ') and will be left out.' + (!names.length ? ' Go to the right week first, or export Sunday to Saturday.' : '') }));
    var tb = h('tbody');
    names.forEach(function (n) {
      var p = people[n], sel = h('select', { 'aria-label': 'Staff member for ' + n }, [h('option', { value: '', text: '— Leave out —' })].concat(staff.map(function (e) { return h('option', { value: e.id, text: e.name }); })));
      var as = h('select', { 'aria-label': 'Which hours ' + n + ' are' }, [h('option', { value: 'main', text: 'Regular hours' }), h('option', { value: 'notip', text: 'Not in the tip pool' }), h('option', { value: 'kitchen', text: 'Kitchen (kitchen rate)' })]);
      sel.value = p.emp; as.value = p.as || 'main';
      var wnote = h('small');
      var showWage = function () {
        var w = Object.keys(p.wages), r = P.rates[p.emp] || {}, mine = r.rate == null ? null : r2(r.rate).toFixed(2);
        wnote.textContent = [Object.keys(p.jobs).join(', '), w.length ? 'Square wage $' + w.join(', $') + (p.emp && mine && w.indexOf(mine) < 0 ? ' (Pay rates: $' + mine + ')' : '') : ''].filter(Boolean).join(' · ');
      };
      sel.addEventListener('change', function () { p.emp = sel.value; p.picked = true; tr.classList.toggle('pr-unm', !p.emp); showWage(); });
      var pool = h('input', { type: 'checkbox', 'aria-label': n + ' is in the tip pool' });
      var setPool = function () { var r = P.rates[p.emp] || {}; pool.checked = p.as === 'main' && (p.tips > 0 || !!r.tip_eligible); pool.disabled = !p.emp || p.as !== 'main'; p.pool = pool.checked; };
      pool.addEventListener('change', function () { p.pool = pool.checked; });
      sel.addEventListener('change', setPool);
      as.addEventListener('change', function () { p.as = as.value; p.picked = true; setPool(); });
      var kit = sum(p.kdays), main = sum(p.days);
      showWage(); setPool();
      var tr = h('tr', { cls: p.emp ? null : 'pr-unm' }, [h('td', null, [h('b', { text: n }), wnote, p.tips ? h('small', { text: 'Tips in Square: ' + money(p.tips) }) : null]), h('td', null, [sel, as]),
        h('td', { cls: 'pr-c' }, [pool]),
        h('td', { cls: 'pr-num', text: hrs(main + kit) + (kit && p.emp && empInfo(p.emp).kitchen_rate != null ? ' (' + hrs(kit) + ' kitchen)' : '') })]);
      tb.appendChild(tr);
    });
    if (names.length) {
      kids.push(h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table' }, [h('thead', null, [h('tr', null, [h('th', { text: 'In Square' }), h('th', { text: 'Staff member' }), h('th', { cls: 'pr-c', text: 'Tip pool' }), h('th', { cls: 'pr-num', text: 'Hours' })])]), tb])]));
      if (names.some(function (n) { return !people[n].emp; })) kids.push(h('p', { cls: 'pr-warn', text: 'Pick the staff member for anyone highlighted, or leave them out.' }));
      kids.push(h('p', { cls: 'pr-fine', text: 'Your picks are remembered for next time. “Not in the tip pool” is for a second Square profile used for hours outside the tip pool (paid at the regular rate). Pay comes from Pay rates, not the Square wage.' }));
      kids.push(h('p', { text: 'Tips from the file: ' + money(sum(sqTips)) + ' credit card and ' + money(sum(sqCash)) + ' declared cash. These become each day’s tips, pooled and split by hours among everyone ticked “Tip pool”.' }));
    }
    var clear = h('input', { type: 'checkbox', checked: true });
    if (names.length) kids.push(h('label', { cls: 'pr-chk' }, [clear, ' Clear hours for anyone who isn’t in the file (Square is the record of who worked)']));
    var useBtn = h('button', { type: 'button', cls: 'ed-btn small', text: 'Use these hours', disabled: !names.length });
    kids.push(h('div', { cls: 'pr-acts' }, [useBtn, h('button', { type: 'button', cls: 'ed-btn ghost small', text: 'Cancel', on: { click: function () { dlg.close(); dlg.remove(); } } })]));
    kids.forEach(function (k) { dlg.appendChild(k); });
    useBtn.addEventListener('click', function () {
      var got = {};
      names.forEach(function (n) {
        var p = people[n]; if (!p.emp) return;
        var g = got[p.emp] || (got[p.emp] = { days: [0, 0, 0, 0, 0, 0, 0], ndays: [0, 0, 0, 0, 0, 0, 0], kdays: [0, 0, 0, 0, 0, 0, 0] });
        var info = empInfo(p.emp), toKitchen = info.kitchen_rate != null, line = p.as === 'kitchen' ? g.kdays : p.as === 'notip' ? g.ndays : g.days;
        for (var i = 0; i < 7; i++) {
          line[i] = r2(line[i] + p.days[i]);
          if (toKitchen) g.kdays[i] = r2(g.kdays[i] + p.kdays[i]); else line[i] = r2(line[i] + p.kdays[i]);
        }
        if (p.picked && P.v2) saveSqName(p.emp, n, p.as || 'main');
        var rr = P.rates[p.emp] || (P.rates[p.emp] = { emp: p.emp, pay_type: 'hourly', rate: null, weekly_salary: null, tip_eligible: false, notes: '' }), ch = false;
        if (p.as === 'main') { rowFor(p.emp).pool = !!p.pool; if (!!rr.tip_eligible !== !!p.pool) { rr.tip_eligible = !!p.pool; ch = true; } }
        var w = Object.keys(p.wages).map(Number).filter(function (x) { return x > 0; });
        if (rr.pay_type !== 'salary' && rr.rate == null && !rr.commission && w.length === 1) { rr.rate = w[0]; ch = true; }   // no rate yet: use Square's
        if (ch) saveRate(p.emp);
      });
      shownEmps().forEach(function (e) {
        var r = rowFor(e.id), g = got[e.id];
        if (g) {
          r.hours = g.days.map(function (x) { return x || null; });
          if (sum(g.kdays) || r.khours) r.khours = g.kdays.map(function (x) { return x || null; });
          if (sum(g.ndays) || r.nhours) r.nhours = g.ndays.map(function (x) { return x || null; });
        } else if (clear.checked) { r.hours = seven(); if (r.khours) r.khours = seven(); if (r.nhours) r.nhours = seven(); }
      });
      Object.keys(got).forEach(function (id) { if (!P.row.rows[id]) { var r = rowFor(id); r.hours = got[id].days.map(function (x) { return x || null; }); } });
      P.row.source = 'square'; P.row.square_file = fname; P.row.square_at = new Date().toISOString();
      // Square's card tips by day, to check against the End of day reports (and to fill days without one)
      // the day's tips come from the Square file: card tips ("by transaction tips") and declared cash tips
      var t = tipsRow(); t.sq = sqTips; t.sqCash = sqCash; t.src = t.src || [];
      t.sqBy = {}; names.forEach(function (n) { t.sqBy[n] = r2(people[n].tips || 0); });
      for (var d = 0; d < 7; d++) {
        t.cash[d] = sqCash[d] || null;
        if (t.team && t.team[d] != null) { t.card[d] = t.team[d]; t.src[d] = 'team'; }
        else { t.card[d] = sqTips[d] || null; t.src[d] = sqTips[d] || sqCash[d] ? 'square' : ''; }
      }
      dlg.close(); dlg.remove(); saveSoon(); paint(false);
      status('Hours filled in from Square for ' + Object.keys(got).length + ' people.', 'ok');
    });
    document.body.appendChild(dlg);
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
  }

  /* ---------------- the two sheets ---------------- */
  function fileWeek() { return iso(P.week) + ' to ' + iso(addDays(P.week, 6)); }
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = SHEETJS; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function staffLines(c) { return c.lines.filter(function (L) { return onStaff(L.e); }); }
  function fmtCells(ws, X, cells, z) { cells.forEach(function (a) { if (ws[a] && typeof ws[a].v === 'number') ws[a].z = z; }); }
  // For the payroll company: their sheet, their IDs and spellings, people on staff only
  function downloadHours() { hoursBook(function (wb, name) { window.XLSX.writeFile(wb, name); }); }
  // Email the Hours sheet from rich@edencny.com: a new email opens on Business email with the file attached
  var PAYROLL_FROM = 'rich@edencny.com';
  function emailHours() {
    hoursBook(function (wb, name) {
      var X = window.XLSX, bytes = X.write(wb, { type: 'array', bookType: 'xlsx' });
      var mime = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', file = new File([bytes], name, { type: mime });
      var range = weekLabel(P.week), subject = 'Eden Hospitality Payroll (' + range + ')';
      var to = ''; try { to = localStorage.getItem('eden-payroll-to') || ''; } catch (e) {}
      var body = 'Hello,\n\nAttached are Eden Hospitality’s hours for the week of ' + range + ' (Sunday–Saturday).' + (P.row.notes ? '\n\n' + P.row.notes : '') + '\n\nThank you,';
      var M = window.EdenMail;
      if (M && M.draft && M.canDraft && M.canDraft()) {
        M.draft({ from: PAYROLL_FROM, to: to ? [{ email: to }] : [], subject: subject, body: body, files: [{ file: file, name: name, mime: mime, size: file.size }], onSent: function (o) { try { if (o && o.to && o.to[0]) localStorage.setItem('eden-payroll-to', o.to[0].email); } catch (e) {} } });
        location.hash = '#email';
      } else {   // no Business email mailbox here: save the file and open the mail app
        X.writeFile(wb, name);
        location.href = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(body.replace('Attached are', 'Attached (saved to your downloads as “' + name + '”) are'));
        status('Business email isn’t connected here, so the file was saved and your mail app opened. Attach “' + name + '” and send it.', 'err');
      }
    });
  }
  function hoursBook(done) {
    var c = calc(), lines = staffLines(c), used = {}, rows = [], warn = [];
    PAYCO.forEach(function (p) {
      var L = lines.filter(function (x) { var pc = payco(x.id); return !used[x.id] && (pc.id === p[0] || (!pc.id && pc.name === p[1])); })[0];
      if (!L) return;   // not on staff on the staff site
      used[L.id] = 1; rows.push([p[0], p[1], L]);
    });
    lines.forEach(function (L) {   // on staff but not on the payroll company's sheet yet
      if (used[L.id]) return;
      if (!(L.total || L.tips || L.comm || L.salary || L.sick || L.hol)) return;
      var pc = payco(L.id); rows.push([pc.id || '', pc.name || L.info.name, L]); if (!pc.id) warn.push(L.info.name);
    });
    var aoa = [['Employee ID', 'Employee Name', 'REGULAR', 'OVERTIME', 'SICK', 'HOLIDAY', 'TIPS CC', 'TIPS PAID', 'Comission'], []];
    rows.forEach(function (x) {
      var L = x[2], reg = L.info.pay_type === 'salary' ? (L.reg || OT_AFTER) : L.reg;
      aoa.push([x[0], x[1], reg || '', L.ot || '', L.sick || '', L.hol || '', L.tipsCard || '', L.tipsCash || '', L.comm || '']);
    });
    var first = 3, last = 2 + rows.length;
    aoa.push([], [], []);
    var kn = rows.filter(function (x) { return x[2].kit || x[2].nt; }).map(function (x) {
      var L = x[2], bits = [];
      if (L.main) bits.push(hrs(L.main) + ' h ' + (L.info.tip_eligible ? 'in the tip pool ' : '') + 'at ' + money(L.info.rate) + '/hr');
      if (L.nt) bits.push(hrs(L.nt) + ' h not in the tip pool at ' + money(L.info.rate) + '/hr');
      if (L.kit) bits.push(hrs(L.kit) + ' h kitchen at ' + money(L.info.kitchen_rate) + '/hr');
      return x[1] + ': ' + hrs(L.total) + ' hours = ' + bits.join(' + ') + '.';
    });
    var tot = ['', ''].concat(['C', 'D', 'E', 'F', 'G', 'H', 'I'].map(function (col) { return { t: 'n', v: 0, f: 'SUM(' + col + first + ':' + col + Math.max(last, first) + ')' }; }));
    aoa.push(tot);
    if (kn.length || P.row.notes) { aoa.push([]); kn.forEach(function (t) { aoa.push(['', t]); }); if (P.row.notes) aoa.push(['', 'Notes: ' + P.row.notes]); }
    loadXLSX().then(function () {
      var X = window.XLSX, wb = X.utils.book_new(), ws = X.utils.aoa_to_sheet(aoa), cells = [];
      for (var r = first; r <= last + 4; r++) ['G', 'H', 'I'].forEach(function (col) { cells.push(col + r); });
      fmtCells(ws, X, cells, '$#,##0.00');
      ws['!cols'] = [{ wch: 12 }, { wch: 22 }, { wch: 10 }, { wch: 11 }, { wch: 8 }, { wch: 9 }, { wch: 11 }, { wch: 11 }, { wch: 11 }];
      var range = weekLabel(P.week);   // e.g. Oct 11 – 17, 2026: the sheet's tab and the file's name
      X.utils.book_append_sheet(wb, ws, range.replace(/[\\\/?*\[\]:]/g, '-').slice(0, 31));
      done(wb, 'Eden Hospitality Hours ' + range.replace(/\s*–\s*/g, '-') + '.xlsx');   // plain hyphen: some browsers drop names with a dash
      if (warn.length) status('Add a payroll company ID in Pay rates for: ' + warn.join(', ') + '.', 'err');
    }, function () { status('Couldn’t load the spreadsheet tool. Check your connection and try again.', 'err'); });
  }
  // For Eden's records: the Tip Weighted Payroll layout
  function downloadTips() {
    var c = calc(), lines = staffLines(c), wk = P.week, D = c.D, e = P.eod || { sales: [0, 0, 0, 0, 0, 0, 0] };
    var dayHead = DAYS.map(function (d, i) { return d + ' ' + md(addDays(wk, i)); });
    var cols = ['Total Regular', 'Total OT', 'Tips', 'Commission', 'Wages', 'Total Hours'];
    var aoa = [['Eden · Tip Weighted Payroll · week of ' + weekLabel(wk)], ['Payroll'], ['', 'Rate', 'Hours']], money$ = [], rowsOf = {};
    var put = function (row, moneyIdx) { aoa.push(row); var r = aoa.length; (moneyIdx || []).forEach(function (i) { money$.push(X_(i) + r); }); return r; };
    var kitchen = lines.filter(function (L) { return !L.info.tip_eligible && !L.info.commission && (L.total || L.salary || L.wages); });
    var wait = lines.filter(function (L) { return (L.info.tip_eligible || L.info.commission) && (L.total || L.tips || L.comm); });
    put(['Kitchen', ''].concat(dayHead, cols));
    kitchen.forEach(function (L) {
      var i = L.info, rate = i.pay_type === 'salary' ? i.weekly_salary : i.rate;
      put([sheetName(L), rate == null ? '' : rate].concat(L.days.map(function (x) { return x || ''; }), [r2(L.reg - L.kit) || (i.pay_type === 'salary' ? '' : 0), L.ot, '', '', r2(L.wages - L.kitPay), r2(L.total - L.kit)]), [1, 11, 12, 13]);
      if (L.kit) put([sheetName(L) + ' (kitchen)', i.kitchen_rate == null ? '' : i.kitchen_rate].concat(L.kdays.map(function (x) { return x || ''; }), [L.kit, '', '', '', L.kitPay, L.kit]), [1, 11, 12, 13]);
    });
    wait.forEach(function (L) {   // tip-pool staff's hours outside the tip pool, and their kitchen hours
      var i = L.info;
      if (L.nt) put([sheetName(L) + ' (not in tip pool)', i.rate == null ? '' : i.rate].concat(L.ndays.map(function (x) { return x || ''; }), [L.nt, '', '', '', L.ntPay, L.nt]), [1, 11, 12, 13]);
      if (L.kit) put([sheetName(L) + ' (kitchen)', i.kitchen_rate == null ? '' : i.kitchen_rate].concat(L.kdays.map(function (x) { return x || ''; }), [L.kit, '', '', '', L.kitPay, L.kit]), [1, 11, 12, 13]);
    });
    put(['Waitstaff', ''].concat(dayHead, cols));
    wait.forEach(function (L) {
      var i = L.info;
      put([sheetName(L), i.rate == null ? '' : i.rate].concat(L.days.map(function (x) { return x || ''; }), [r2(L.main - L.ot), L.ot, L.tips, L.comm || '', r2(L.wages - L.kitPay - L.ntPay), L.main]), [1, 11, 12, 13]);
    });
    aoa.push([]);
    put(['Tips Collected', ''].concat(dayHead, ['Total']));
    put(['Cash tips', ''].concat(D.map(function (d) { return d.cash; }), [sum(D.map(function (d) { return d.cash; }))]), [2, 3, 4, 5, 6, 7, 8, 9]);
    put(['Credit card tips', ''].concat(D.map(function (d) { return d.card; }), [sum(D.map(function (d) { return d.card; }))]), [2, 3, 4, 5, 6, 7, 8, 9]);
    put(['CC Fees 2.75%', ''].concat(D.map(function (d) { return d.fee ? -d.fee : 0; }), [-sum(D.map(function (d) { return d.fee; }))]), [2, 3, 4, 5, 6, 7, 8, 9]);
    put(['Tip Pool Daily Total', ''].concat(D.map(function (d) { return d.pool; }), [c.pool]), [2, 3, 4, 5, 6, 7, 8, 9]);
    put(['Tipped Hours', ''].concat(c.tipHrs, [sum(c.tipHrs)]));
    put(['Tips / Hour', ''].concat(D.map(function (d, i) { return c.tipHrs[i] ? r2(d.pool / c.tipHrs[i]) : 0; }), [sum(c.tipHrs) ? r2(c.pool / sum(c.tipHrs)) : 0]), [2, 3, 4, 5, 6, 7, 8, 9]);
    aoa.push([]);
    put(['Tip shares', ''].concat(dayHead, ['Total', 'Credit card', 'Cash']));
    wait.filter(function (L) { return L.info.tip_eligible; }).forEach(function (L) { put([sheetName(L), ''].concat(L.tipDays, [L.tips, L.tipsCard, L.tipsCash]), [2, 3, 4, 5, 6, 7, 8, 9, 10, 11]); });
    aoa.push([]);
    var Lw = labor(c), sales = Lw.sales ? Lw.sales.net : 0, wages = Lw.cost;
    put(['Total Wages', '', Lw.wages], [2]);
    put(['Total Tips', '', staffLines(c).reduce(function (a, L) { return r2(a + L.tips); }, 0)], [2]);
    put(['Total Commission', '', c.T.comm], [2]);
    put(['Payroll Cost', '', wages, 'wages + commission'], [2]);
    put(['Net Sales', '', sales || '', Lw.sales ? 'from the ' + Lw.sales.src : ''], [2]);
    if (Lw.sales && Lw.sales.tax) put(['Sales Tax', '', Lw.sales.tax], [2]);
    var pct = put(['Labor Percentage', '', sales ? wages / sales : '']);
    if (P.row.notes) { aoa.push([]); aoa.push(['Notes', P.row.notes]); }
    loadXLSX().then(function () {
      var X = window.XLSX, wb = X.utils.book_new(), ws = X.utils.aoa_to_sheet(aoa);
      fmtCells(ws, X, money$, '$#,##0.00'); fmtCells(ws, X, ['C' + pct], '0.00%');
      ws['!cols'] = [{ wch: 24 }, { wch: 10 }].concat(DAYS.map(function () { return { wch: 12 }; }), [{ wch: 13 }, { wch: 10 }, { wch: 11 }, { wch: 12 }, { wch: 11 }, { wch: 12 }]);
      X.utils.book_append_sheet(wb, ws, 'Tip Weighted Payroll');
      X.writeFile(wb, 'Tip Weighted Payroll ' + fileWeek() + '.xlsx');
    }, function () { status('Couldn’t load the spreadsheet tool. Check your connection and try again.', 'err'); });
  }
  function sheetName(L) {   // the payroll company's spelling, as First Last
    var pc = payco(L.id), n = pc.name; if (!n) return L.info.name;
    var p = n.split(','); return p.length > 1 ? (p.slice(1).join(',').trim() + ' ' + p[0].trim()).trim() : n.trim();
  }
  function X_(i) { return String.fromCharCode(65 + i); }   // column letter (A–Z is plenty here)

  function rateText(i) { return i.pay_type === 'salary' ? (i.weekly_salary == null ? '' : money(i.weekly_salary) + '/wk') : (i.rate == null ? '' : money(i.rate) + '/hr') + (i.kitchen_rate != null ? ', kitchen ' + money(i.kitchen_rate) + '/hr' : ''); }
  function printSummary() {
    var c = calc(), wk = P.week, old = document.getElementById('prPrint'); if (old) old.remove();
    var cols = ['Employee', 'Pay', 'Hours', 'Reg', 'OT', 'Wages', 'Sick/Hol', 'Commission', 'Tips (card)', 'Tips (cash)', 'Adjustment', 'Gross'];
    var tbl = h('table', null, [h('thead', null, [h('tr', null, cols.map(function (t) { return h('th', { text: t }); }))]),
      h('tbody', null, c.lines.map(function (L) {
        return h('tr', null, [h('td', null, [h('b', { text: L.info.name }), L.info.position ? h('small', { text: ' ' + L.info.position }) : null]), h('td', { text: rateText(L.info) }),
          h('td', { text: hrs(L.total) + (L.kit ? ' (' + hrs(L.kit) + ' kitchen)' : '') }), h('td', { text: hrs(L.reg) }), h('td', { text: L.ot ? hrs(L.ot) : '' }), h('td', { text: L.wages ? money(L.wages) : '' }),
          h('td', { text: L.sickPay + L.holPay ? money(L.sickPay + L.holPay) : '' }), h('td', { text: L.comm ? money(L.comm) : '' }),
          h('td', { text: L.tipsCard ? money(L.tipsCard) : '' }), h('td', { text: L.tipsCash ? money(L.tipsCash) : '' }), h('td', { text: L.adj ? money(L.adj) + (L.adjNote ? ' (' + L.adjNote + ')' : '') : '' }), h('td', null, [h('b', { text: money(L.gross) })])]);
      })),
      h('tfoot', null, [h('tr', null, [h('td', { text: 'Total' }), h('td'), h('td', { text: hrs(c.T.total) }), h('td', { text: hrs(c.T.reg) }), h('td', { text: hrs(c.T.ot) }), h('td', { text: money(c.T.wages) }), h('td', { text: money(c.T.sickPay + c.T.holPay) }), h('td', { text: money(c.T.comm) }), h('td', { text: money(c.T.tipsCard) }), h('td', { text: money(c.T.tipsCash) }), h('td', { text: money(c.T.adj) }), h('td', { text: money(c.T.gross) })])])]);
    var days = h('table', { cls: 'pp-days' }, [h('thead', null, [h('tr', null, [h('th', { text: 'Hours by day' })].concat(DOW.map(function (d, i) { return h('th', { text: d + ' ' + md(addDays(wk, i)) }); }), [h('th', { text: 'Total' })]))]),
      h('tbody', null, c.lines.map(function (L) { return h('tr', null, [h('td', { text: L.info.name })].concat(L.days.map(function (x, i) { var t = x + L.kdays[i]; return h('td', { text: t ? hrs(t) : '' }); }), [h('td', { text: hrs(L.total) })])); }))]);
    var box = h('div', { id: 'prPrint' }, [
      h('h1', { text: 'Eden · Payroll summary' }),
      h('p', { text: 'Week of ' + weekLabel(wk) + ' (Sunday–Saturday) · ' + (final() ? 'Final' + (P.row.finalized_at ? ', ' + new Date(P.row.finalized_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '') : 'Draft, not finalized') }),
      tbl,
      h('p', { text: c.pool ? 'Tip pool ' + money(c.pool) + ' after the 2.75% card fee, split each day by hours among tip-pool staff.' : 'No tips this week.' }),
      days,
      P.row.notes ? h('div', null, [h('h2', { text: 'Notes' }), h('p', { cls: 'pp-pre', text: P.row.notes })]) : null,
      h('p', { cls: 'pp-fine', text: 'Gross pay before taxes and deductions. Overtime: hours over 40 in the week at 1.5×. Printed ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '.' })
    ]);
    document.body.appendChild(box); document.body.classList.add('pr-printing');
    // one landscape page: lay it out at the page's printable size (10 × 7.5 in, after margins) and shrink to fit
    box.style.cssText = 'display:block;position:absolute;left:-10000px;top:0;width:10in';
    var pageH = 7.5 * 96, hgt = box.scrollHeight;
    box.style.cssText = '';
    box.style.zoom = hgt > pageH ? Math.max(0.55, (pageH - 8) / hgt).toFixed(3) : '';
    var done = function () { document.body.classList.remove('pr-printing'); box.remove(); window.removeEventListener('afterprint', done); };
    window.addEventListener('afterprint', done);
    setTimeout(function () { window.print(); if (!('onafterprint' in window)) done(); }, 50);
  }

  /* ----- pay rates ----- */
  function paintRates(el) {
    var emps = P.emps.filter(function (e) { return e.active !== false || P.rates[e.id]; }).sort(function (a, b) { return (a.active === false) - (b.active === false) || String(a.name).localeCompare(String(b.name)); });
    el.appendChild(h('p', { cls: 'an-sub pr-intro', text: 'Set how each person is paid. Changes save automatically and apply to weeks that aren’t finalized yet. Only you (the Owner) can see this page.' }));
    if (!emps.length) { el.appendChild(h('p', { cls: 'an-sub', text: 'No employees yet. Add them in Schedule → Employees.' })); return; }
    var body = h('tbody');
    emps.forEach(function (e) {
      var r = P.rates[e.id] || (P.rates[e.id] = { emp: e.id, pay_type: 'hourly', rate: null, weekly_salary: null, tip_eligible: false, notes: '' });
      var type = h('select', { 'aria-label': e.name + ' pay type' }, [h('option', { value: 'hourly', text: 'Hourly' }), h('option', { value: 'salary', text: 'Salary' })]);
      type.value = r.pay_type || 'hourly';
      var amt = h('input', { type: 'text', inputmode: 'decimal', cls: 'pr-money', 'aria-label': e.name + ' pay amount' });
      var unit = h('span', { cls: 'pr-unit' });
      var sync = function () { var sal = type.value === 'salary'; var v = sal ? r.weekly_salary : r.rate; amt.value = v == null ? '' : r2(v).toFixed(2); unit.textContent = sal ? 'per week' : 'per hour'; };
      sync();
      type.addEventListener('change', function () { r.pay_type = type.value; sync(); saveRate(e.id); });
      amt.addEventListener('change', function () { var v = numIn(amt.value); if (v != null && v < 0) v = null; if (type.value === 'salary') r.weekly_salary = v; else r.rate = v; amt.value = v == null ? '' : r2(v).toFixed(2); saveRate(e.id); });
      var krate = h('input', { type: 'text', inputmode: 'decimal', cls: 'pr-money', value: r.kitchen_rate == null ? '' : r2(r.kitchen_rate).toFixed(2), placeholder: '–', 'aria-label': e.name + ' kitchen rate per hour' });
      krate.addEventListener('change', function () { var v = numIn(krate.value); r.kitchen_rate = v == null || v < 0 ? null : v; krate.value = r.kitchen_rate == null ? '' : r2(r.kitchen_rate).toFixed(2); saveRate(e.id); });
      var tip = h('input', { type: 'checkbox', 'aria-label': e.name + ' shares the tip pool' }); tip.checked = !!r.tip_eligible;
      tip.addEventListener('change', function () { r.tip_eligible = tip.checked; saveRate(e.id); });
      var comm = h('input', { type: 'checkbox', 'aria-label': e.name + ' is paid commission' }); comm.checked = !!r.commission;
      comm.addEventListener('change', function () { r.commission = comm.checked; saveRate(e.id); });
      var pc = payco(e.id);
      var pid = h('input', { type: 'text', cls: 'pr-pid', value: r.payroll_id || '', placeholder: pc.auto ? pc.id : 'ID', 'aria-label': e.name + ' payroll company ID' });
      var pname = h('input', { type: 'text', cls: 'pr-note', value: r.payroll_name || '', placeholder: pc.auto ? pc.name : 'Last, First', 'aria-label': e.name + ' name on the payroll company sheet' });
      pid.addEventListener('change', function () { r.payroll_id = pid.value.trim(); if (!r.payroll_name && pc.auto && r.payroll_id === pc.id) r.payroll_name = pc.name; saveRate(e.id); });
      pname.addEventListener('change', function () { r.payroll_name = pname.value.trim(); if (!r.payroll_id && pc.auto) r.payroll_id = pc.id; saveRate(e.id); });
      var notes = h('input', { type: 'text', cls: 'pr-note', value: r.notes || '', placeholder: 'e.g. tip credit, start date', 'aria-label': e.name + ' notes' });
      notes.addEventListener('change', function () { r.notes = notes.value; saveRate(e.id); });
      body.appendChild(h('tr', { cls: e.active === false ? 'inactive' : null }, [
        h('th', { scope: 'row', cls: 'pr-name' }, [h('b', { text: e.name }), h('small', { text: (e.position || '') + (e.active === false ? (e.position ? ' · ' : '') + 'Not on staff' : '') + (r.square_name ? ' · Square: ' + r.square_name : '') })]),
        h('td', null, [type]), h('td', null, [h('div', { cls: 'pr-amt' }, [h('span', { cls: 'pr-dollar' }, ['$', amt]), unit])]),
        h('td', null, [h('span', { cls: 'pr-dollar' }, ['$', krate])]),
        h('td', { cls: 'pr-c' }, [tip]), h('td', { cls: 'pr-c' }, [comm]),
        h('td', null, [h('div', { cls: 'pr-amt' }, [pid, pname]), pc.auto && !r.payroll_id ? h('small', { cls: 'pr-auto', text: 'Matched from the payroll company sheet' }) : (!pc.id && e.active !== false ? h('small', { cls: 'pr-warn', text: 'Not on the payroll company sheet' }) : null)]),
        h('td', null, [notes])
      ]));
    });
    el.appendChild(h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table pr-rates' }, [
      h('thead', null, [h('tr', null, [h('th', { scope: 'col', cls: 'pr-name', text: 'Employee' }), h('th', { scope: 'col', text: 'Paid' }), h('th', { scope: 'col', text: 'Rate' }), h('th', { scope: 'col', text: 'Kitchen rate' }),
        h('th', { scope: 'col', cls: 'pr-c', text: 'Tip pool' }), h('th', { scope: 'col', cls: 'pr-c', text: 'Commission' }), h('th', { scope: 'col', text: 'Payroll company ID and name' }), h('th', { scope: 'col', text: 'Notes' })])]),
      body])]));
    el.appendChild(h('p', { cls: 'pr-fine', text: 'Tip pool: shares each day’s tips by hours worked. Kitchen rate: adds a Kitchen line to that person’s timesheet, paid at this rate and not in the tip pool (and Square shifts with a kitchen job go there). Commission: adds a weekly commission amount. Payroll company ID and name: as they appear on the Eden Hospitality Hours sheet; grey means it was matched automatically. Employees are added and removed in Schedule → Employees; anyone not on staff is left off both sheets.' }));
  }

  window.addEventListener('beforeunload', function (e) { if (P.t) { saveWeek(); e.preventDefault(); e.returnValue = ''; } });

  window.EdenPayroll = {
    show: function (ctx) {
      P.ctx = ctx;
      if (P.el !== ctx.el || !ctx.el.firstChild) { P.el = ctx.el; shell(); }
      var sub = { rates: 'rates', overview: 'overview', past: 'past' }[ctx.sub] || 'week';
      var first = !P.week;
      if (first) P.week = addDays(sunday(new Date()), -7);   // payroll is usually done for the week that just ended
      if (sub === 'overview' || sub === 'past') { P.sub = sub; flush().then(loadOverview); return; }
      if (sub !== P.sub || first || !P.row) { P.sub = sub; flush().then(load); }
      else paint(false);
    },
    hide: function () { flush(); },
    _test: { squareShifts: squareShifts, sameName: sameName, splitCents: splitCents, P: P, calc: calc, payco: payco }
  };
})();
