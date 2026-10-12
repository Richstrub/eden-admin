/* Eden staff site: Payroll (Owner only).
 *   This week:  a weekly timesheet, Sunday to Saturday. Hours start from the published schedule and can be
 *               corrected day by day. Works out regular hours, overtime (over 40 in the week, at 1.5x),
 *               the week's tip pool split by hours among tip-pool staff, adjustments, and gross pay.
 *               Print a summary or download a spreadsheet for the accountant. Finalize the week to lock it.
 *   Pay rates:  hourly rate or weekly salary for each employee, and who shares the tip pool.
 * Tax withholding is left to the accountant. Data: supabase/payroll.sql (pay_rates, payroll_weeks),
 * readable by the Owner only. */
(function () {
  'use strict';
  var SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var ENDS = { cut1: '20:00', cut2: '21:00', close: '22:00' };   // same assumed out-times as the schedule
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var OT_AFTER = 40, OT_RATE = 1.5;
  var P = { ctx: null, el: null, sub: 'week', week: null, emps: [], rates: {}, row: null, fresh: false, sched: null, missing: false, err: '', seq: 0, t: null, saving: null, refs: {} };

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
  function r2(n) { return Math.round((+n || 0) * 100) / 100; }
  function money(n) { n = r2(n); return (n < 0 ? '−$' : '$') + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function hrs(n) { n = r2(n); return n ? String(n) : '0'; }
  function numIn(v) { var s = String(v == null ? '' : v).replace(/[$,\s]/g, ''); if (s === '') return null; var n = parseFloat(s); return isFinite(n) ? n : null; }
  function mins(t) { var p = String(t || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function shiftHours(s) {
    if (!s || !s.start || !s.end) return 0;
    var end = ENDS[s.end] || s.end, d = mins(end) - mins(s.start);
    if (d <= 0) { if (ENDS[s.end]) return 0; d += 1440; }
    return d / 60;
  }
  function final() { return P.row && P.row.status === 'final'; }

  /* ---------------- data ---------------- */
  function load() {
    var my = ++P.seq, wk = iso(P.week);
    P.err = ''; paint(true);
    return Promise.all([
      sb().from('employees').select('*').order('name'),
      sb().from('pay_rates').select('*'),
      sb().from('payroll_weeks').select('*').eq('week_start', wk).maybeSingle(),
      sb().from('schedule_weeks').select('week_start,shifts,status,published').eq('week_start', wk).maybeSingle()
    ]).then(function (res) {
      if (my !== P.seq) return;
      var bad = res[1].error || res[2].error;
      P.missing = !!(bad && isMissing(bad));
      if (bad && !P.missing) P.err = 'Couldn’t load payroll. ' + (bad.message || '');
      P.emps = (res[0].data || []).filter(function (e) { return String(e.name || '').trim(); });
      P.rates = {}; (res[1].data || []).forEach(function (r) { P.rates[r.emp] = r; });
      P.sched = res[3].error ? null : res[3].data;
      if (res[2].data) { P.row = res[2].data; P.row.rows = P.row.rows || {}; P.fresh = false; }
      else { P.row = { week_start: wk, status: 'draft', tip_pool: 0, rows: {}, notes: '' }; P.fresh = true; fillFromSchedule(); }
      paint(false);
    }, function () { if (my === P.seq) { P.err = 'Couldn’t reach the database. Check your connection.'; paint(false); } });
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
  }
  function rowFor(id) {
    var r = P.row.rows[id];
    if (!r) r = P.row.rows[id] = { hours: [null, null, null, null, null, null, null], adj: null, adj_note: '' };
    if (!Array.isArray(r.hours)) r.hours = [null, null, null, null, null, null, null];
    return r;
  }
  function empInfo(id) {   // name, position and pay terms: frozen when the week was finalized
    var r = P.row.rows[id], e = P.emps.filter(function (x) { return x.id === id; })[0] || {}, rate = P.rates[id] || {};
    if (final() && r && r.snap) return r.snap;
    return { name: e.name || 'Former employee', position: e.position || '', pay_type: rate.pay_type || 'hourly', rate: rate.rate == null ? null : +rate.rate,
      weekly_salary: rate.weekly_salary == null ? null : +rate.weekly_salary, tip_eligible: !!rate.tip_eligible };
  }
  function shownEmps() {   // active employees, plus anyone with hours or pay this week
    var sh = scheduleHours().hours, ids = {}, out = [];
    P.emps.forEach(function (e) { if (e.active !== false || sh[e.id]) { ids[e.id] = 1; out.push(e); } });
    Object.keys((P.row && P.row.rows) || {}).forEach(function (id) {
      if (ids[id]) return;
      var r = P.row.rows[id], any = (r.hours || []).some(function (x) { return +x; }) || +r.adj;
      if (any || (final() && r.snap)) { ids[id] = 1; out.push(P.emps.filter(function (x) { return x.id === id; })[0] || { id: id, name: (r.snap && r.snap.name) || 'Former employee' }); }
    });
    if (final()) out = out.filter(function (e) { return P.row.rows[e.id]; });
    return out.sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
  }

  /* ---------------- the numbers ---------------- */
  function calc() {
    var emps = shownEmps(), lines = [], pool = r2(P.row.tip_pool), tipHours = 0;
    emps.forEach(function (e) {
      var r = rowFor(e.id), info = empInfo(e.id);
      var days = r.hours.map(function (x) { return +x || 0; }), total = r2(days.reduce(function (a, b) { return a + b; }, 0));
      var L = { id: e.id, info: info, days: days, total: total, reg: 0, ot: 0, regPay: 0, otPay: 0, salary: 0, tips: 0, adj: r2(r.adj), adjNote: r.adj_note || '', warn: '' };
      if (info.pay_type === 'salary') {
        L.reg = total; L.salary = r2(info.weekly_salary);
        if (info.weekly_salary == null) L.warn = 'No weekly salary set';
      } else {
        L.reg = Math.min(total, OT_AFTER); L.ot = r2(Math.max(total - OT_AFTER, 0));
        var rate = info.rate == null ? 0 : +info.rate;
        L.regPay = r2(L.reg * rate); L.otPay = r2(L.ot * rate * OT_RATE);
        if (info.rate == null && total) L.warn = 'No hourly rate set';
      }
      if (info.tip_eligible && total > 0) tipHours += total;
      lines.push(L);
    });
    // tip pool by hours, in whole cents, so the shares add up to exactly the pool
    var cents = Math.round(pool * 100), given = 0, parts = [];
    if (tipHours > 0 && cents) {
      lines.forEach(function (L) {
        if (!L.info.tip_eligible || L.total <= 0) return;
        var exact = cents * L.total / tipHours, base = Math.floor(exact);
        parts.push({ L: L, base: base, rem: exact - base }); given += base;
      });
      parts.sort(function (a, b) { return b.rem - a.rem; });
      for (var i = 0; i < cents - given; i++) parts[i % parts.length].base++;
      parts.forEach(function (p) { p.L.tips = p.base / 100; });
    }
    var T = { total: 0, reg: 0, ot: 0, regPay: 0, otPay: 0, salary: 0, tips: 0, adj: 0, gross: 0, days: [0, 0, 0, 0, 0, 0, 0] };
    lines.forEach(function (L) {
      L.gross = r2(L.regPay + L.otPay + L.salary + L.tips + L.adj);
      ['total', 'reg', 'ot', 'regPay', 'otPay', 'salary', 'tips', 'adj', 'gross'].forEach(function (k) { T[k] = r2(T[k] + L[k]); });
      L.days.forEach(function (x, i) { T.days[i] = r2(T.days[i] + x); });
    });
    return { lines: lines, T: T, pool: pool, tipHours: r2(tipHours), unshared: cents && !tipHours };
  }

  /* ---------------- saving ---------------- */
  function saveSoon() {
    P.fresh = false;
    status('Saving…', 'dirty');
    clearTimeout(P.t); P.t = setTimeout(saveWeek, 600);
  }
  function saveWeek() {
    clearTimeout(P.t);
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
    status('Saving…', 'dirty');
    return sb().from('pay_rates').upsert(row, { onConflict: 'emp' }).then(function (x) {
      if (x.error) status(isMissing(x.error) ? 'Payroll isn’t set up yet: run supabase/payroll.sql in Supabase.' : 'Couldn’t save: ' + (x.error.message || 'try again.'), 'err');
      else status('Saved.');
    }, function () { status('Couldn’t save. Check your connection.', 'err'); });
  }

  /* ---------------- page ---------------- */
  function shell() {
    var el = P.el; el.innerHTML = '';
    var wrap = h('div', { cls: 'an-in pr-in' });
    var tabs = h('nav', { cls: 'an-tabs', 'aria-label': 'Payroll pages' }, [
      h('a', { href: '#payroll', 'data-sub': 'week', text: 'Weekly payroll' }),
      h('a', { href: '#payroll/rates', 'data-sub': 'rates', text: 'Pay rates' })
    ]);
    wrap.appendChild(h('div', { cls: 'an-head' }, [h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Owner only' }), h('h1', { cls: 'sc-week', text: 'Payroll' })]), tabs]));
    P.pane = h('div', { cls: 'pr-pane' });
    wrap.appendChild(P.pane);
    el.appendChild(wrap);
  }
  function paint(loading) {
    P.el.querySelectorAll('.an-tabs a').forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('data-sub') === P.sub ? 'page' : 'false'); });
    var el = P.pane; el.innerHTML = ''; P.refs = {};
    if (loading && !P.row) { el.appendChild(h('p', { cls: 'an-sub', text: 'Loading…' })); return; }
    if (P.missing) { el.appendChild(setupNote()); return; }
    if (P.err) { el.appendChild(h('p', { cls: 'pr-err', role: 'alert', text: P.err })); }
    if (P.sub === 'rates') paintRates(el); else paintWeek(el, loading);
  }
  function setupNote() {
    return h('div', { cls: 'pr-setup' }, [
      h('h2', { cls: 'an-h2', text: 'One step to switch on Payroll' }),
      h('ol', null, [
        h('li', { text: 'Open Supabase and choose SQL Editor → New query.' }),
        h('li', { text: 'Paste in supabase/payroll.sql from the eden-admin repository and click Run.' }),
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
    var src = sch.source === 'published' ? 'the published schedule' : sch.source === 'draft' ? 'the draft schedule (this week isn’t published yet)' : null;
    el.appendChild(h('p', { cls: 'an-sub pr-intro', text: ro
      ? 'This week is final and locked. Reopen it if something needs to change.'
      : (P.fresh ? (src ? 'Hours below come from ' + src + '. ' : 'There’s no schedule for this week, so enter hours by hand. ') : '') +
        'Correct any day that was different from the schedule (late out, sent home early, extra shift). Everything saves automatically.' }));

    // tip pool + actions
    var pool = h('input', { type: 'text', inputmode: 'decimal', cls: 'pr-money', value: P.row.tip_pool ? r2(P.row.tip_pool).toFixed(2) : '', placeholder: '0.00', disabled: ro, 'aria-label': 'Tip pool for the week' });
    pool.addEventListener('input', function () { P.row.tip_pool = numIn(pool.value) || 0; refresh(); saveSoon(); });
    pool.addEventListener('blur', function () { if (numIn(pool.value) != null) pool.value = r2(numIn(pool.value)).toFixed(2); });
    var acts = h('div', { cls: 'pr-acts' }, [
      ro ? null : h('button', { type: 'button', cls: 'ed-btn ghost small', text: 'Fill from schedule', on: { click: function () {
        if (!sch.source || sch.source === 'none') { alert('There’s no schedule saved for this week.'); return; }
        if (!P.fresh && !confirm('Replace the hours on this page with the hours from the schedule? Tip pool and adjustments stay as they are.')) return;
        fillFromSchedule(); saveSoon(); paint(false);
      } } }),
      h('button', { type: 'button', cls: 'ed-btn ghost small', text: 'Print summary', on: { click: printSummary } }),
      h('button', { type: 'button', cls: 'ed-btn ghost small', text: 'Download for accountant (.xlsx)', on: { click: download } }),
      ro ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Reopen week', on: { click: reopen } })
        : h('button', { type: 'button', cls: 'ed-btn small', text: 'Finalize week', on: { click: finalize } })
    ]);
    el.appendChild(h('div', { cls: 'pr-toolbar' }, [h('label', { cls: 'pr-pool' }, [h('span', { text: 'Tip pool for the week' }), h('span', { cls: 'pr-dollar' }, ['$', pool])]), acts]));
    P.refs.poolNote = h('p', { cls: 'pr-poolnote' }); el.appendChild(P.refs.poolNote);

    // timesheet
    var emps = shownEmps();
    if (!emps.length) { el.appendChild(h('p', { cls: 'an-sub', text: 'No employees yet. Add them in Schedule → Employees.' })); return; }
    var head = h('tr', null, [h('th', { cls: 'pr-name', scope: 'col', text: 'Employee' })]
      .concat(DOW.map(function (d, i) { return h('th', { scope: 'col', cls: 'pr-day' }, [d, h('small', { text: md(addDays(wk, i)) })]); }))
      .concat(['Hours', 'Reg', 'OT', 'Wages', 'Tips', 'Adjustment', 'Gross'].map(function (t) { return h('th', { scope: 'col', cls: 'pr-num', text: t }); })));
    var body = h('tbody');
    emps.forEach(function (e) {
      var r = rowFor(e.id), info = empInfo(e.id), sched = sch.hours[e.id] || [0, 0, 0, 0, 0, 0, 0], ap = sch.approx[e.id] || {};
      var cells = {}, tr = h('tr');
      var who = h('th', { scope: 'row', cls: 'pr-name' }, [h('b', { text: info.name || e.name }), h('small', { text: [info.position, info.pay_type === 'salary' ? 'Salary' : info.rate != null ? money(info.rate) + '/hr' : null, info.tip_eligible ? 'Tip pool' : null].filter(Boolean).join(' · ') })]);
      cells.warn = h('small', { cls: 'pr-warn' }); who.appendChild(cells.warn);
      tr.appendChild(who);
      cells.days = [];
      DOW.forEach(function (d, i) {
        var inp = h('input', { type: 'text', inputmode: 'decimal', cls: 'pr-h', value: r.hours[i] == null ? '' : String(r.hours[i]), placeholder: '–', disabled: ro,
          'aria-label': (info.name || e.name) + ', ' + d + ' hours', title: sched[i] ? 'Scheduled: ' + hrs(sched[i]) + ' h' + (ap[i] ? ' (to a server cut or close; check the real out time)' : '') : 'Not scheduled' });
        var td = h('td', { cls: 'pr-dayc' + (ap[i] ? ' approx' : '') }, [inp]);
        var mark = function () { var v = numIn(inp.value) || 0; td.classList.toggle('chg', r2(v) !== r2(sched[i])); };
        inp.addEventListener('input', function () { var v = numIn(inp.value); r.hours[i] = v == null ? null : Math.max(0, Math.min(24, v)); mark(); refresh(); saveSoon(); });
        inp.addEventListener('keydown', function (ev) { arrowKeys(ev, inp); });
        mark(); cells.days.push(inp); tr.appendChild(td);
      });
      ['total', 'reg', 'ot', 'wages', 'tips'].forEach(function (k) { cells[k] = h('td', { cls: 'pr-num' }); tr.appendChild(cells[k]); });
      var adj = h('input', { type: 'text', inputmode: 'decimal', cls: 'pr-money', value: r.adj ? r2(r.adj).toFixed(2) : '', placeholder: '0.00', disabled: ro, 'aria-label': (info.name || e.name) + ' adjustment in dollars' });
      var note = h('input', { type: 'text', cls: 'pr-note', value: r.adj_note || '', placeholder: 'What for?', disabled: ro, 'aria-label': (info.name || e.name) + ' adjustment note' });
      adj.addEventListener('input', function () { r.adj = numIn(adj.value); refresh(); saveSoon(); });
      note.addEventListener('input', function () { r.adj_note = note.value; saveSoon(); });
      tr.appendChild(h('td', { cls: 'pr-adj' }, [adj, note]));
      cells.gross = h('td', { cls: 'pr-num pr-gross' }); tr.appendChild(cells.gross);
      P.refs[e.id] = cells; body.appendChild(tr);
    });
    var foot = h('tr', { cls: 'pr-total' }, [h('th', { scope: 'row', cls: 'pr-name', text: 'Total' })]);
    P.refs.T = { days: [] };
    DOW.forEach(function () { var c = h('td', { cls: 'pr-num' }); P.refs.T.days.push(c); foot.appendChild(c); });
    ['total', 'reg', 'ot', 'wages', 'tips', 'adj', 'gross'].forEach(function (k) { P.refs.T[k] = h('td', { cls: 'pr-num' + (k === 'gross' ? ' pr-gross' : '') }); foot.appendChild(P.refs.T[k]); });
    el.appendChild(h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table' }, [h('thead', null, [head]), body, h('tfoot', null, [foot])])]));
    el.appendChild(h('p', { cls: 'pr-key' }, [h('span', { cls: 'pr-sw chg' }), ' Different from the schedule   ', h('span', { cls: 'pr-sw approx' }), ' Scheduled to a server cut or close (counted as 8, 9 or 10 pm): check the real out time']));

    var notes = h('textarea', { cls: 'pr-notes', rows: '3', placeholder: 'Anything the accountant should know this week (new hire, bonus, unpaid leave…)', disabled: ro, 'aria-label': 'Notes for the accountant' });
    notes.value = P.row.notes || '';
    notes.addEventListener('input', function () { P.row.notes = notes.value; saveSoon(); });
    el.appendChild(h('label', { cls: 'pr-notesf' }, [h('span', { text: 'Notes for the accountant' }), notes]));
    el.appendChild(h('p', { cls: 'pr-fine', text: 'Overtime is worked out as hours over 40 in the Sunday–Saturday week at 1.5 × the hourly rate. Salaried employees are shown at their weekly salary with no overtime. Tips are the week’s pool divided by hours worked among tip-pool staff. These are gross amounts before taxes and deductions; your accountant handles withholding and should confirm overtime for anyone paid with a tip credit and for salaried staff.' }));
    refresh();
  }
  function arrowKeys(ev, inp) {
    if (ev.key !== 'ArrowDown' && ev.key !== 'ArrowUp' && ev.key !== 'Enter') return;
    var all = [].slice.call(P.pane.querySelectorAll('input.pr-h')), i = all.indexOf(inp), step = 7;
    var j = ev.key === 'ArrowUp' ? i - step : i + step;
    if (all[j]) { ev.preventDefault(); all[j].focus(); all[j].select(); }
  }
  function refresh() {
    var c = calc();
    c.lines.forEach(function (L) {
      var x = P.refs[L.id]; if (!x) return;
      x.total.textContent = hrs(L.total); x.reg.textContent = hrs(L.reg);
      x.ot.textContent = L.ot ? hrs(L.ot) : '–'; x.ot.classList.toggle('pr-ot', !!L.ot);
      x.wages.textContent = money(L.regPay + L.otPay + L.salary);
      x.wages.title = L.info.pay_type === 'salary' ? 'Weekly salary' : money(L.regPay) + ' regular' + (L.ot ? ' + ' + money(L.otPay) + ' overtime' : '');
      x.tips.textContent = L.tips ? money(L.tips) : '–';
      x.gross.textContent = money(L.gross);
      x.warn.textContent = L.warn ? L.warn + ' — see Pay rates' : '';
    });
    var T = P.refs.T; if (T) {
      c.T.days.forEach(function (v, i) { T.days[i].textContent = hrs(v); });
      T.total.textContent = hrs(c.T.total); T.reg.textContent = hrs(c.T.reg); T.ot.textContent = hrs(c.T.ot);
      T.wages.textContent = money(c.T.regPay + c.T.otPay + c.T.salary); T.tips.textContent = money(c.T.tips); T.adj.textContent = money(c.T.adj); T.gross.textContent = money(c.T.gross);
    }
    if (P.refs.poolNote) {
      var n = c.lines.filter(function (L) { return L.tips; }).length;
      P.refs.poolNote.textContent = c.unshared ? 'Nobody in the tip pool worked this week, so the pool isn’t split yet. Check “Tip pool” for the right people in Pay rates.'
        : c.pool ? money(c.pool) + ' split by ' + hrs(c.tipHours) + ' hours among ' + n + ' tip-pool ' + (n === 1 ? 'employee' : 'employees') + ' (' + money(c.pool / (c.tipHours || 1)) + ' an hour).'
        : '';
      P.refs.poolNote.classList.toggle('pr-warn', !!c.unshared);
    }
  }
  function go(d) { flush().then(function () { P.week = sunday(d); P.row = null; load(); }); }
  function flush() { if (P.t) { return saveWeek() || Promise.resolve(); } return P.saving || Promise.resolve(); }
  function finalize() {
    var c = calc(), missing = c.lines.filter(function (L) { return L.warn; });
    if (missing.length && !confirm(missing.map(function (L) { return L.info.name + ': ' + L.warn; }).join('\n') + '\n\nFinalize anyway?')) return;
    if (!confirm('Finalize the week of ' + weekLabel(P.week) + '? Gross pay ' + money(c.T.gross) + '. The hours and pay rates are locked as they are now; you can reopen it later.')) return;
    c.lines.forEach(function (L) {
      var r = rowFor(L.id), i = L.info;
      r.snap = { name: i.name, position: i.position || '', pay_type: i.pay_type, rate: i.rate, weekly_salary: i.weekly_salary, tip_eligible: !!i.tip_eligible };
    });
    P.row.status = 'final'; P.row.finalized_at = new Date().toISOString(); P.fresh = false;
    saveWeek(); paint(false);
  }
  function reopen() {
    if (!confirm('Reopen this week so it can be changed? Current pay rates will be used again until you finalize it.')) return;
    P.row.status = 'draft'; P.row.finalized_at = null;
    Object.keys(P.row.rows).forEach(function (id) { delete P.row.rows[id].snap; });
    saveWeek(); paint(false);
  }

  /* ----- for the accountant ----- */
  function payTypeText(i) { return i.pay_type === 'salary' ? 'Salary' : 'Hourly'; }
  function rateText(i) { return i.pay_type === 'salary' ? (i.weekly_salary == null ? '' : money(i.weekly_salary) + '/wk') : (i.rate == null ? '' : money(i.rate) + '/hr'); }
  function fileBase() { return 'Eden payroll ' + iso(P.week) + ' to ' + iso(addDays(P.week, 6)); }
  function loadXLSX() {
    if (window.XLSX) return Promise.resolve();
    return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = SHEETJS; s.onload = res; s.onerror = rej; document.head.appendChild(s); });
  }
  function download() {
    var c = calc(), wk = P.week;
    var dayHead = DOW.map(function (d, i) { return d + ' ' + md(addDays(wk, i)); });
    var head = ['Employee', 'Position', 'Pay type', 'Hourly rate', 'Weekly salary'].concat(dayHead, ['Total hours', 'Regular hours', 'Overtime hours', 'Regular pay', 'Overtime pay', 'Salary', 'Tips (pool)', 'Adjustment', 'Adjustment note', 'Gross pay']);
    var rows = c.lines.map(function (L) {
      var i = L.info;
      return [i.name, i.position || '', payTypeText(i), i.pay_type === 'salary' ? '' : (i.rate == null ? '' : i.rate), i.pay_type === 'salary' ? (i.weekly_salary == null ? '' : i.weekly_salary) : '']
        .concat(L.days.map(function (x) { return r2(x); }), [L.total, r2(L.reg), L.ot, L.regPay, L.otPay, L.salary, L.tips, L.adj, L.adjNote, L.gross]);
    });
    var tot = ['Total', '', '', '', ''].concat(c.T.days, [c.T.total, r2(c.T.reg), c.T.ot, c.T.regPay, c.T.otPay, c.T.salary, c.T.tips, c.T.adj, '', c.T.gross]);
    var top = [['Eden payroll, week of ' + weekLabel(wk) + ' (Sunday–Saturday)'], ['Status: ' + (final() ? 'Final' : 'Draft, not finalized')], []];
    var tipRows = [['Tip pool, week of ' + weekLabel(wk)], [], ['Pool total', c.pool], ['Hours worked by tip-pool staff', c.tipHours], ['Per hour', c.tipHours ? r2(c.pool / c.tipHours) : 0], [], ['Employee', 'Hours', 'Share']]
      .concat(c.lines.filter(function (L) { return L.info.tip_eligible && L.total > 0; }).map(function (L) { return [L.info.name, L.total, L.tips]; }));
    var note = [[], ['Notes'], [P.row.notes || '']];
    var fine = [[], ['Gross pay before taxes and deductions. Overtime: hours over 40 in the week at 1.5x the hourly rate. Salaried staff: weekly salary, no overtime computed.']];
    loadXLSX().then(function () {
      var X = window.XLSX, wb = X.utils.book_new();
      var aoa = top.concat([head], rows, [tot], note, fine), ws = X.utils.aoa_to_sheet(aoa);
      var moneyCols = [3, 4, 15, 16, 17, 18, 19, 21], first = top.length + 1, last = first + rows.length;
      for (var r = first; r <= last; r++) moneyCols.forEach(function (col) { var a = X.utils.encode_cell({ r: r, c: col }); if (ws[a] && typeof ws[a].v === 'number') ws[a].z = '$#,##0.00'; });
      ws['!cols'] = head.map(function (t, i) { return { wch: i === 0 ? 22 : i === 1 ? 16 : i === 20 ? 24 : Math.max(9, String(t).length + 1) }; });
      X.utils.book_append_sheet(wb, ws, 'Payroll');
      var ws2 = X.utils.aoa_to_sheet(tipRows); ws2['!cols'] = [{ wch: 30 }, { wch: 10 }, { wch: 12 }];
      X.utils.book_append_sheet(wb, ws2, 'Tip pool');
      X.writeFile(wb, fileBase() + '.xlsx');
    }, function () {   // spreadsheet library couldn't load: a CSV opens in Excel too
      var csv = top.concat([head], rows, [tot], note).map(function (r) { return r.map(function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\r\n');
      var a = h('a', { href: URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv' })), download: fileBase() + '.csv' });
      document.body.appendChild(a); a.click(); a.remove();
      status('Downloaded as a CSV file (opens in Excel).');
    });
  }
  function printSummary() {
    var c = calc(), wk = P.week, old = document.getElementById('prPrint'); if (old) old.remove();
    var cols = ['Employee', 'Pay', 'Hours', 'Reg', 'OT', 'Regular pay', 'OT pay', 'Salary', 'Tips', 'Adjustment', 'Gross'];
    var tbl = h('table', null, [h('thead', null, [h('tr', null, cols.map(function (t) { return h('th', { text: t }); }))]),
      h('tbody', null, c.lines.map(function (L) {
        return h('tr', null, [h('td', null, [h('b', { text: L.info.name }), L.info.position ? h('small', { text: ' ' + L.info.position }) : null]), h('td', { text: rateText(L.info) }),
          h('td', { text: hrs(L.total) }), h('td', { text: hrs(L.reg) }), h('td', { text: L.ot ? hrs(L.ot) : '' }), h('td', { text: L.regPay ? money(L.regPay) : '' }), h('td', { text: L.otPay ? money(L.otPay) : '' }),
          h('td', { text: L.salary ? money(L.salary) : '' }), h('td', { text: L.tips ? money(L.tips) : '' }), h('td', { text: L.adj ? money(L.adj) + (L.adjNote ? ' (' + L.adjNote + ')' : '') : '' }), h('td', null, [h('b', { text: money(L.gross) })])]);
      })),
      h('tfoot', null, [h('tr', null, [h('td', { text: 'Total' }), h('td'), h('td', { text: hrs(c.T.total) }), h('td', { text: hrs(c.T.reg) }), h('td', { text: hrs(c.T.ot) }), h('td', { text: money(c.T.regPay) }), h('td', { text: money(c.T.otPay) }), h('td', { text: money(c.T.salary) }), h('td', { text: money(c.T.tips) }), h('td', { text: money(c.T.adj) }), h('td', { text: money(c.T.gross) })])])]);
    var days = h('table', { cls: 'pp-days' }, [h('thead', null, [h('tr', null, [h('th', { text: 'Hours by day' })].concat(DOW.map(function (d, i) { return h('th', { text: d + ' ' + md(addDays(wk, i)) }); }), [h('th', { text: 'Total' })]))]),
      h('tbody', null, c.lines.map(function (L) { return h('tr', null, [h('td', { text: L.info.name })].concat(L.days.map(function (x) { return h('td', { text: x ? hrs(x) : '' }); }), [h('td', { text: hrs(L.total) })])); }))]);
    var box = h('div', { id: 'prPrint' }, [
      h('h1', { text: 'Eden · Payroll summary' }),
      h('p', { text: 'Week of ' + weekLabel(wk) + ' (Sunday–Saturday) · ' + (final() ? 'Final' + (P.row.finalized_at ? ', ' + new Date(P.row.finalized_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '') : 'Draft, not finalized') }),
      tbl,
      h('p', { text: c.pool ? 'Tip pool ' + money(c.pool) + ', split by ' + hrs(c.tipHours) + ' hours among tip-pool staff (' + money(c.pool / (c.tipHours || 1)) + ' an hour).' : 'No tip pool this week.' }),
      days,
      P.row.notes ? h('div', null, [h('h2', { text: 'Notes' }), h('p', { cls: 'pp-pre', text: P.row.notes })]) : null,
      h('p', { cls: 'pp-fine', text: 'Gross pay before taxes and deductions. Overtime: hours over 40 in the week at 1.5 × the hourly rate. Salaried staff: weekly salary, no overtime computed. Printed ' + new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) + '.' })
    ]);
    document.body.appendChild(box); document.body.classList.add('pr-printing');
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
      var tip = h('input', { type: 'checkbox', 'aria-label': e.name + ' shares the tip pool' }); tip.checked = !!r.tip_eligible;
      tip.addEventListener('change', function () { r.tip_eligible = tip.checked; saveRate(e.id); });
      var notes = h('input', { type: 'text', cls: 'pr-note', value: r.notes || '', placeholder: 'e.g. tip credit, start date', 'aria-label': e.name + ' notes' });
      notes.addEventListener('change', function () { r.notes = notes.value; saveRate(e.id); });
      body.appendChild(h('tr', { cls: e.active === false ? 'inactive' : null }, [
        h('th', { scope: 'row', cls: 'pr-name' }, [h('b', { text: e.name }), h('small', { text: (e.position || '') + (e.active === false ? (e.position ? ' · ' : '') + 'Inactive' : '') })]),
        h('td', null, [type]), h('td', { cls: 'pr-amt' }, [h('span', { cls: 'pr-dollar' }, ['$', amt]), unit]), h('td', { cls: 'pr-c' }, [tip]), h('td', null, [notes])
      ]));
    });
    el.appendChild(h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table pr-rates' }, [
      h('thead', null, [h('tr', null, [h('th', { scope: 'col', cls: 'pr-name', text: 'Employee' }), h('th', { scope: 'col', text: 'Paid' }), h('th', { scope: 'col', text: 'Rate' }), h('th', { scope: 'col', cls: 'pr-c', text: 'Tip pool' }), h('th', { scope: 'col', text: 'Notes' })])]),
      body])]));
    el.appendChild(h('p', { cls: 'pr-fine', text: 'Tip pool: people checked here share the weekly tip pool by hours worked. Employees are added and removed in Schedule → Employees.' }));
  }

  window.addEventListener('beforeunload', function (e) { if (P.t) { saveWeek(); e.preventDefault(); e.returnValue = ''; } });

  window.EdenPayroll = {
    show: function (ctx) {
      P.ctx = ctx;
      if (P.el !== ctx.el || !ctx.el.firstChild) { P.el = ctx.el; shell(); }
      var sub = ctx.sub === 'rates' ? 'rates' : 'week';
      var first = !P.week;
      if (first) P.week = addDays(sunday(new Date()), -7);   // payroll is usually done for the week that just ended
      if (sub !== P.sub || first || !P.row) { P.sub = sub; flush().then(load); }
      else paint(false);
    },
    hide: function () { flush(); }
  };
})();
