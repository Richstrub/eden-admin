/* Eden staff site: weekly schedule.
 *
 * Tables (see supabase/schedule.sql):
 *   employees        id, name, phone, position, active
 *   schedule_weeks   week_start (Sunday, YYYY-MM-DD), shifts (json), status, published (json snapshot),
 *                    published_at, sent (json: employee id -> { at, msg })
 * A shift is { id, emp, day (0 = Sunday … 6 = Saturday), start 'HH:MM', end 'HH:MM' | 'cut1' | 'cut2' | 'close', role, note }.
 * Only Owner and Manager can see or change any of this (enforced by the database).
 *
 * Texting: "Text schedules" lists everyone with their own week written out. Each "Text" button opens the
 * phone's Messages app with the number and message filled in (sms: link), so nothing is sent without you.
 */
(function () {
  'use strict';
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // weeks run Sunday to Saturday
  var DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var TEMPLATE = 'templates/eden-employees.xlsx';
  var SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  var S = { ctx: null, el: null, built: false, tab: 'grid', week: monday(new Date()), employees: [], row: null,
    loading: false, dirty: false, saving: false, timer: null, missing: false, includeOff: false,
    view: 'week', month: firstOfMonth(new Date()), timeoff: [], hasTimeOff: true, requests: [], monthData: null };

  /* ---------- helpers ---------- */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else if (k === 'cls') e.className = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function parseDay(t) { var p = String(t || '').split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function dayLabel(t) { return parseDay(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function shortName(n) { var p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || ''); }
  function isOwner() { return S.ctx && S.ctx.role === 'owner'; }
  function monday(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; } // the Sunday that starts the week (name kept for history)
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function longDate(d) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function weekLabel(d) {
    var e = addDays(d, 6), sameM = d.getMonth() === e.getMonth();
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + (sameM ? e.getDate() : e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + ', ' + e.getFullYear();
  }
  // Shifts can end at a set time or at a server "out" time. Those have an assumed clock time for hour totals.
  var ENDS = { cut1: { label: '1st cut', at: '20:00' }, cut2: { label: '2nd cut', at: '21:00' }, close: { label: 'close', at: '22:00' } };
  function isApprox(s) { return !!ENDS[s.end]; }
  function fmtT(t) {
    if (ENDS[t]) return ENDS[t].label;
    var p = String(t || '').split(':'), H = +p[0], M = +p[1] || 0; if (isNaN(H)) return '';
    var ap = H >= 12 ? 'p' : 'a', hh = H % 12 || 12;
    return hh + (M ? ':' + String(M).padStart(2, '0') : '') + ap;
  }
  function mins(t) { var p = String(t || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function shiftHours(s) {
    if (!s.start || !s.end) return null;
    var end = ENDS[s.end] ? ENDS[s.end].at : s.end, d = mins(end) - mins(s.start);
    if (d <= 0) { if (ENDS[s.end]) return null; d += 1440; } // started after the assumed out time: unknown
    return d / 60;
  }
  function fmtH(n) { return (Math.round(n * 4) / 4).toString().replace(/\.0+$/, ''); }
  function phoneE164(p) {
    var d = String(p || '').replace(/[^\d+]/g, '');
    if (/^\+\d{8,15}$/.test(d)) return d;
    d = d.replace(/\D/g, '');
    if (d.length === 10) return '+1' + d;
    if (d.length === 11 && d[0] === '1') return '+' + d;
    return '';
  }
  function phoneShow(p) { var e = phoneE164(p); var m = /^\+1(\d{3})(\d{3})(\d{4})$/.exec(e); return m ? '(' + m[1] + ') ' + m[2] + '-' + m[3] : (p || ''); }
  function empById(id) { for (var i = 0; i < S.employees.length; i++) if (S.employees[i].id === id) return S.employees[i]; return null; }
  function activeEmps() {
    return S.employees.filter(function (e) { return String(e.name || '').trim() && (e.active !== false || shiftsFor(e.id).length); })
      .sort(function (a, b) { return (a.position || '~').localeCompare(b.position || '~') || (a.name || '').localeCompare(b.name || ''); });
  }
  function shifts() { return (S.row && S.row.shifts) || []; }
  function shiftsFor(emp, day) { return shifts().filter(function (s) { return s.emp === emp && (day == null || s.day === day); }).sort(function (a, b) { return a.day - b.day || mins(a.start) - mins(b.start); }); }
  function isMissing(e) { return e && (e.code === '42P01' || e.code === 'PGRST205' || e.code === 'PGRST202' || /does not exist|could not find the table/i.test(e.message || '')); }
  function isPerm(e) { return e && (e.code === '42501' || /row-level security|permission/i.test(e.message || '')); }
  function status(t, c) { if (S.ctx) S.ctx.status(t, c); }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('Could not load ' + src)); }; document.head.appendChild(s); }); }

  /* ---------- data ---------- */
  function sb() { return S.ctx.sb; }
  function loadEmployees() {
    return sb().from('employees').select('*').order('name').then(function (r) {
      if (r.error) throw r.error; S.employees = r.data || [];
      S.hasEmail = !S.employees.length || S.employees.some(function (e) { return 'email' in e; });
      S.hasAccess = S.employees.some(function (e) { return 'access' in e; });
      return loadAccounts();
    });
  }
  function loadWeek(d) {
    return sb().from('schedule_weeks').select('*').eq('week_start', iso(d)).maybeSingle().then(function (r) {
      if (r.error) throw r.error; return r.data || null;
    });
  }
  function loadTimeOff(from, to) {
    if (!S.hasTimeOff) return Promise.resolve([]);
    return sb().from('time_off').select('*').lte('start_date', iso(to)).gte('end_date', iso(from)).order('start_date').then(function (r) {
      if (r.error) { if (isMissing(r.error)) S.hasTimeOff = false; return []; }
      return r.data || [];
    }, function () { return []; });
  }
  function loadRequests() {
    return loadTimeOff(addDays(new Date(), -60), addDays(new Date(), 730)).then(function (list) { S.requests = list; return list; });
  }
  function offOn(list, emp, date) { // approved or pending time off covering a date, approved first
    var d = iso(date), hit = null;
    (list || []).forEach(function (t) { if (t.emp === emp && t.start_date <= d && t.end_date >= d && t.status !== 'denied') { if (!hit || t.status === 'approved') hit = t; } });
    return hit;
  }
  function offText(t) { return t.all_day === false && t.start_time ? fmtT(t.start_time) + '\u2013' + fmtT(t.end_time || 'close') : 'All day'; }
  function pendingCount() { return (S.requests || []).filter(function (t) { return t.status === 'pending'; }).length; }
  function blankRow(d) { return { week_start: iso(d), shifts: [], status: 'draft', published: null, published_at: null, sent: {} }; }
  function load() {
    S.loading = true; render();
    return Promise.all([loadEmployees(), loadWeek(S.week), loadTimeOff(S.week, addDays(S.week, 6)), loadRequests()]).then(function (r) {
      S.row = r[1] || blankRow(S.week); S.row.sent = S.row.sent || {}; S.timeoff = r[2] || []; S.missing = false; S.loading = false;
      if (S.view === 'month') return loadMonth(); render();
    }, function (e) {
      S.loading = false; S.missing = isMissing(e); S.row = blankRow(S.week); render();
      if (!S.missing) status(isPerm(e) ? 'Only the Owner and Managers can open the schedule.' : 'Couldn’t load the schedule. Check your connection.', 'err');
    });
  }
  function changed() {
    S.dirty = true; status('Saving…', 'dirty');
    clearTimeout(S.timer); S.timer = setTimeout(saveWeek, 700);
  }
  function saveWeek() {
    clearTimeout(S.timer);
    if (!S.dirty || !S.row) return Promise.resolve();
    if (S.saving) { S.timer = setTimeout(saveWeek, 400); return Promise.resolve(); }
    S.saving = true; S.dirty = false;
    var row = { week_start: S.row.week_start, shifts: S.row.shifts, status: S.row.status, published: S.row.published, published_at: S.row.published_at, sent: S.row.sent || {} };
    return sb().from('schedule_weeks').upsert(row, { onConflict: 'week_start' }).then(function (r) {
      S.saving = false;
      if (r.error) throw r.error;
      if (!S.dirty) status('Saved.', 'ok');
    }).catch(function (e) {
      S.saving = false; S.dirty = true;
      status(isPerm(e) ? 'Your account can’t change the schedule.' : 'Couldn’t save. Check your connection; trying again shortly.', 'err');
      if (!isPerm(e)) S.timer = setTimeout(saveWeek, 5000);
    });
  }
  function empRow(e) {
    var r = { id: e.id, name: e.name || '', phone: e.phone || '', position: e.position || '', active: e.active !== false };
    if (S.hasEmail) r.email = String(e.email || '').trim().toLowerCase();
    if (S.hasAccess && isOwner()) r.access = e.access === 'manager' ? 'manager' : 'employee';
    return r;
  }
  function noEmailCol(err) { return err && (err.code === 'PGRST204' || err.code === '42703') && /email/i.test(err.message || ''); }
  function saveEmployee(e) {
    return sb().from('employees').upsert(empRow(e), { onConflict: 'id' })
      .then(function (r) {
        if (r.error && noEmailCol(r.error)) { S.hasEmail = false; return saveEmployee(e).then(function () { status('Saved, but emails need the one-time team setup (supabase/team.sql).', 'err'); }); }
        if (r.error) throw r.error; status('Saved.', 'ok');
      })
      .catch(function (err) {
        if (err && err.code === '23505') { status('That email is already used by another employee.', 'err'); return; }
        if (err && /only the owner/i.test(err.message || '')) { status('Only the Owner can change permissions.', 'err'); return; }
        status(isPerm(err) ? 'Your account can\u2019t change employees.' : 'Couldn\u2019t save the employee. Check your connection.', 'err');
      });
  }
  function loadAuthCfg() {
    if (S.authCfg !== undefined) return Promise.resolve();
    var C = (window.EDEN_STAFF_CONFIG || {}).supabase || {};
    S.authCfg = null;
    return fetch(String(C.url || '').replace(/\/$/, '') + '/auth/v1/settings', { headers: { apikey: C.key } }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) { S.authCfg = j; }, function () { S.authCfg = null; });
  }
  function loadAccounts() {
    loadAuthCfg().then(function () { if (S.authCfg) render(); });
    return sb().rpc('employee_accounts').then(function (r) {
      S.accounts = {};
      if (r.error) { S.accountsOk = false; return; }
      S.accountsOk = true;
      (r.data || []).forEach(function (a) { S.accounts[String(a.email || '').toLowerCase()] = a; });
    }, function () { S.accountsOk = false; });
  }
  function teamUrl() { return location.origin + location.pathname.replace(/[^/]*$/, '') + 'team/'; }
  var empTimers = {};
  function empChanged(e) { status('Saving…', 'dirty'); clearTimeout(empTimers[e.id]); empTimers[e.id] = setTimeout(function () { saveEmployee(e); }, 600); }

  /* ---------- publishing and messages ---------- */
  function shiftsKey(list) { return JSON.stringify((list || []).map(function (s) { return [s.emp, s.day, s.start, s.end, s.role || '', s.note || '']; }).sort()); }
  function pubState() {
    if (!S.row || S.row.status !== 'published') return 'draft';
    return shiftsKey(S.row.shifts) === shiftsKey(S.row.published) ? 'published' : 'changed';
  }
  function messageFor(emp) {
    var list = shiftsFor(emp.id), first = String(emp.name || '').trim().split(/\s+/)[0] || '';
    var head = 'Eden schedule – week of ' + longDate(S.week) + (first ? '\nHi ' + first + ', here are your shifts:' : '');
    if (!list.length) return head.split('\n')[0] + '\n' + (first ? 'Hi ' + first + ', you are not on the schedule this week.' : 'You are not on the schedule this week.') + '\nReply with any questions. – Eden';
    var total = 0, close = 0;
    var lines = list.map(function (s) {
      var hrs = shiftHours(s); if (hrs != null) total += hrs; if (isApprox(s)) close++;
      return DAYS[s.day] + ' ' + md(addDays(S.week, s.day)) + ': ' + fmtT(s.start) + '–' + fmtT(s.end) + (s.role ? ' ' + s.role : '') + (s.note ? ' (' + s.note + ')' : '');
    });
    var tot = 'Total: ' + (close ? 'about ' : '') + fmtH(total) + ' hrs';
    return head + '\n' + lines.join('\n') + '\n' + tot + '\nReply with any questions. – Eden';
  }
  function smsHref(phone, body) { return 'sms:' + phone + '?&body=' + encodeURIComponent(body); }
  function publish() {
    if (!S.row) return;
    var n = shifts().length;
    if (!n && !confirm('This week has no shifts yet. Publish an empty schedule?')) return;
    S.row.status = 'published'; S.row.published = JSON.parse(JSON.stringify(S.row.shifts)); S.row.published_at = new Date().toISOString();
    changed(); render(); openTexts();
  }

  /* ---------- rendering ---------- */
  function build() {
    S.el.innerHTML = '';
    S.head = h('div', { cls: 'sc-head' });
    S.body = h('div', { cls: 'sc-body' });
    S.el.appendChild(h('div', { cls: 'sc-in' }, [S.head, S.body]));
    S.built = true;
  }
  function render() {
    if (!S.el) return;
    if (!S.built) build();
    renderHead();
    S.body.innerHTML = '';
    if (S.missing) { renderSetup(); return; }
    if (S.loading) { S.body.appendChild(h('p', { cls: 'sc-empty', text: 'Loading the schedule…' })); return; }
    if (S.tab === 'people') renderPeople();
    else if (S.tab === 'timeoff') renderTimeOff();
    else if (S.view === 'month') renderMonth();
    else renderGrid();
  }
  function renderHead() {
    var st = pubState(), pubAt = S.row && S.row.published_at ? new Date(S.row.published_at) : null;
    var pill = st === 'published' ? h('span', { cls: 'sc-pill ok', text: 'Published' + (pubAt ? ' ' + pubAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '') })
      : st === 'changed' ? h('span', { cls: 'sc-pill warn', text: 'Changed since publishing' })
      : h('span', { cls: 'sc-pill', text: 'Draft' });
    var thisWeek = iso(S.week) === iso(monday(new Date()));
    var monthMode = S.view === 'month' && S.tab === 'grid';
    var thisMonth = iso(S.month) === iso(firstOfMonth(new Date()));
    S.head.innerHTML = '';
    S.head.appendChild(h('div', { cls: 'sc-titlebar' }, [
      h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Staff Schedule' }), h('h1', { cls: 'sc-week', text: monthMode ? S.month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) : 'Week of ' + weekLabel(S.week) })]),
      h('div', { cls: 'sc-weeknav' }, [
        S.tab === 'grid' ? h('div', { cls: 'sc-viewtog', role: 'group', 'aria-label': 'View' }, [
          h('button', { type: 'button', 'aria-pressed': S.view === 'week' ? 'true' : 'false', text: 'Week', on: { click: function () { setView('week'); } } }),
          h('button', { type: 'button', 'aria-pressed': S.view === 'month' ? 'true' : 'false', text: 'Month', on: { click: function () { setView('month'); } } })
        ]) : null,
        h('button', { type: 'button', cls: 'ed-btn small', 'aria-label': monthMode ? 'Previous month' : 'Previous week', text: '←', on: { click: function () { monthMode ? goMonth(-1) : go(-7); } } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: monthMode ? 'This month' : 'This week', disabled: monthMode ? thisMonth : thisWeek, on: { click: function () { monthMode ? goMonth(0) : go(0); } } }),
        h('button', { type: 'button', cls: 'ed-btn small', 'aria-label': monthMode ? 'Next month' : 'Next week', text: '→', on: { click: function () { monthMode ? goMonth(1) : go(7); } } })
      ])
    ]));
    if (S.missing) return;
    var nShifts = shifts().length, pend = pendingCount();
    var tabs = h('div', { cls: 'sc-tabs', role: 'tablist' }, [
      h('button', { type: 'button', role: 'tab', 'aria-selected': S.tab === 'grid' ? 'true' : 'false', text: 'Schedule', on: { click: function () { S.tab = 'grid'; S.view === 'month' ? loadMonth() : render(); } } }),
      S.hasTimeOff ? h('button', { type: 'button', role: 'tab', 'aria-selected': S.tab === 'timeoff' ? 'true' : 'false', on: { click: function () { S.tab = 'timeoff'; loadRequests().then(render); } } }, ['Time off', pend ? h('span', { cls: 'sc-count', text: String(pend) }) : null]) : null,
      h('button', { type: 'button', role: 'tab', 'aria-selected': S.tab === 'people' ? 'true' : 'false', text: 'Employees (' + S.employees.filter(function (e) { return e.active !== false; }).length + ')', on: { click: function () { S.tab = 'people'; render(); } } })
    ]);
    if (S.tab !== 'grid' || monthMode) {
      S.head.appendChild(h('div', { cls: 'sc-bar' }, [tabs, monthMode ? h('p', { cls: 'sc-barnote', text: 'Tap a day to open that week for editing and publishing.' }) : null,
        monthMode ? h('div', { cls: 'sc-actions' }, [h('button', { type: 'button', cls: 'ed-btn small', text: 'Print', on: { click: function () { window.print(); } } })]) : null]));
      return;
    }
    S.head.appendChild(h('div', { cls: 'sc-bar' }, [
      tabs,
      pill,
      h('div', { cls: 'sc-actions' }, [
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Copy last week', on: { click: copyLastWeek } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Print', on: { click: function () { S.tab = 'grid'; render(); setTimeout(function () { window.print(); }, 50); } } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Text schedules', disabled: st === 'draft', title: st === 'draft' ? 'Publish the schedule first' : null, on: { click: openTexts } }),
        h('button', { type: 'button', cls: 'ed-btn', text: st === 'changed' ? 'Publish changes' : st === 'published' ? 'Published' : 'Publish schedule', disabled: st === 'published' || (!nShifts && st !== 'draft'), on: { click: publish } })
      ])
    ]));
  }
  function go(n) {
    var next = n === 0 ? monday(new Date()) : addDays(S.week, n);
    (S.dirty ? saveWeek() : Promise.resolve()).then(function () { S.week = next; S.month = firstOfMonth(addDays(next, 3)); load(); });
  }
  function setView(v) {
    if (S.view === v) return;
    (S.dirty ? saveWeek() : Promise.resolve()).then(function () {
      S.view = v;
      if (v === 'month') { S.month = firstOfMonth(addDays(S.week, 3)); loadMonth(); } else load();
    });
  }
  function goMonth(n) {
    S.month = n === 0 ? firstOfMonth(new Date()) : new Date(S.month.getFullYear(), S.month.getMonth() + n, 1);
    loadMonth();
  }
  function monthRange() {
    var start = monday(S.month), last = new Date(S.month.getFullYear(), S.month.getMonth() + 1, 0);
    return { start: start, end: addDays(monday(last), 6) };
  }
  function loadMonth() {
    var rg = monthRange(), asked = iso(S.month);
    S.monthData = null; render();
    return Promise.all([
      sb().from('schedule_weeks').select('week_start,shifts,status,published').gte('week_start', iso(rg.start)).lte('week_start', iso(rg.end)).then(function (r) { if (r.error) throw r.error; return r.data || []; }),
      loadTimeOff(rg.start, rg.end)
    ]).then(function (r) {
      if (asked !== iso(S.month)) return;
      var weeks = {}; r[0].forEach(function (w) { weeks[w.week_start] = w; });
      S.monthData = { weeks: weeks, off: r[1] }; render();
    }, function () { status('Couldn\u2019t load the month. Check your connection.', 'err'); S.monthData = { weeks: {}, off: [] }; render(); });
  }
  function renderMonth() {
    if (!S.monthData) { S.body.appendChild(h('p', { cls: 'sc-empty', text: 'Loading the month\u2026' })); return; }
    var rg = monthRange(), today = iso(new Date()), mo = S.month.getMonth();
    var cal = h('div', { cls: 'sc-cal' });
    DAYS.forEach(function (d) { cal.appendChild(h('div', { cls: 'sc-cal-h', text: d })); });
    for (var d = new Date(rg.start); d <= rg.end; d = addDays(d, 1)) {
      (function (date) {
        var wk = S.monthData.weeks[iso(monday(date))], di = date.getDay();
        var list = ((wk && wk.shifts) || []).filter(function (s) { return s.day === di; }).sort(function (a, b) { return mins(a.start) - mins(b.start); });
        var offs = (S.monthData.off || []).filter(function (t) { return t.status !== 'denied' && t.start_date <= iso(date) && t.end_date >= iso(date); });
        var cell = h('button', { type: 'button', cls: 'sc-cal-d' + (date.getMonth() !== mo ? ' out' : '') + (iso(date) === today ? ' today' : '') + (wk && wk.status !== 'published' && list.length ? ' draft' : ''),
          'aria-label': 'Open the week of ' + weekLabel(monday(date)), on: { click: function () { S.week = monday(date); S.view = 'week'; load(); } } }, [
          h('span', { cls: 'sc-cal-n', text: String(date.getDate()) }),
          di === 0 && wk ? h('span', { cls: 'sc-cal-st ' + (wk.status === 'published' ? 'ok' : ''), text: wk.status === 'published' ? 'Published' : 'Draft' }) : null
        ]);
        list.slice(0, 5).forEach(function (s) { var e = empById(s.emp); cell.appendChild(h('span', { cls: 'sc-cal-s' }, [h('b', { text: fmtT(s.start) }), ' ' + shortName(e ? e.name : '')])); });
        if (list.length > 5) cell.appendChild(h('span', { cls: 'sc-cal-more', text: '+' + (list.length - 5) + ' more' }));
        offs.forEach(function (t) { var e = empById(t.emp); cell.appendChild(h('span', { cls: 'sc-cal-off' + (t.status === 'pending' ? ' pending' : ''), text: (t.status === 'pending' ? 'Requested off: ' : 'Off: ') + shortName(e ? e.name : '') })); });
        cal.appendChild(cell);
      })(new Date(d));
    }
    S.body.appendChild(h('div', { cls: 'sc-calwrap' }, cal));
  }
  function renderSetup() {
    S.body.appendChild(h('div', { cls: 'ed-banner' }, [
      h('p', { text: 'The schedule isn’t set up in the database yet. In Supabase, open SQL Editor, paste the contents of supabase/schedule.sql from the eden-admin repository (or the block Claude gave you), and click Run. Then reload this page.' })
    ]));
  }

  function renderGrid() {
    var emps = activeEmps();
    if (!emps.length) {
      S.body.appendChild(h('div', { cls: 'ed-banner' }, [
        h('p', { text: 'Add your team first. Enter names and mobile numbers on the Employees tab, or import the employee spreadsheet.' }),
        h('button', { type: 'button', cls: 'ed-btn', text: 'Add employees', on: { click: function () { S.tab = 'people'; render(); } } })
      ]));
      return;
    }
    var table = h('table', { cls: 'sc-grid' });
    var trh = h('tr', null, [h('th', { cls: 'sc-name-h', text: 'Employee' })]);
    var today = iso(new Date());
    DAYS.forEach(function (d, i) { var date = addDays(S.week, i); trh.appendChild(h('th', { cls: iso(date) === today ? 'today' : null }, [h('span', { cls: 'sc-dn', text: d }), h('span', { cls: 'sc-dd', text: md(date) })])); });
    trh.appendChild(h('th', { cls: 'sc-hrs-h', text: 'Hours' }));
    table.appendChild(h('thead', null, trh));
    var tb = h('tbody'), lastPos = null, perDay = [0, 0, 0, 0, 0, 0, 0];
    emps.forEach(function (e) {
      var pos = e.position || '';
      if (pos !== lastPos) { tb.appendChild(h('tr', { cls: 'sc-group' }, [h('td', { colspan: '9', text: pos || 'No position' })])); lastPos = pos; }
      var tr = h('tr', { cls: e.active === false ? 'inactive' : null });
      tr.appendChild(h('td', { cls: 'sc-name' }, [h('span', { cls: 'sc-ename', text: e.name || 'Unnamed' }), e.phone ? null : h('span', { cls: 'sc-warn', text: 'No mobile number' }),
        h('button', { type: 'button', cls: 'sc-copyone', title: 'Copy ' + (e.name || 'this person') + '’s shifts from last week into this week', 'aria-label': 'Copy last week for ' + (e.name || 'this person'), text: '↻ Copy last week', on: { click: function () { copyLastWeekFor(e); } } })]));
      var total = 0, close = 0;
      for (var d = 0; d < 7; d++) {
        (function (day) {
          var list = shiftsFor(e.id, day); if (list.length) perDay[day]++;
          var off = offOn(S.timeoff, e.id, addDays(S.week, day));
          var td = h('td', { cls: 'sc-cell' + (list.length ? '' : ' empty') + (off && off.status === 'approved' ? ' is-off' : '') });
          if (off) td.appendChild(h('div', { cls: 'sc-off' + (off.status === 'pending' ? ' pending' : ''), title: off.reason || '' }, [h('b', { text: off.status === 'pending' ? 'Requested off' : 'Time off' }), h('span', { text: offText(off) })]));
          list.forEach(function (s) {
            var hrs = shiftHours(s); if (hrs != null) total += hrs; if (isApprox(s)) close++;
            td.appendChild(h('button', { type: 'button', cls: 'sc-shift', title: 'Edit shift', on: { click: function () { editShift(e, day, s); } } }, [
              h('span', { cls: 'sc-st', text: fmtT(s.start) + '–' + fmtT(s.end) }),
              s.role && s.role !== e.position ? h('span', { cls: 'sc-sr', text: s.role }) : null,
              s.note ? h('span', { cls: 'sc-sn', text: s.note }) : null
            ]));
          });
          td.appendChild(h('button', { type: 'button', cls: 'sc-add', 'aria-label': 'Add shift for ' + (e.name || '') + ' on ' + DAYS_LONG[day], text: '+', on: { click: function () { editShift(e, day, null); } } }));
          tr.appendChild(td);
        })(d);
      }
      tr.appendChild(h('td', { cls: 'sc-hrs', title: close ? 'Estimated: 1st cut counted as 8pm, 2nd cut as 9pm, close as 10pm' : null }, total || close ? [close ? h('small', { text: 'about ' }) : null, fmtH(total)] : '–'));
      tb.appendChild(tr);
    });
    var tf = h('tr', { cls: 'sc-foot' }, [h('td', { text: 'On the schedule' })]);
    perDay.forEach(function (n) { tf.appendChild(h('td', { text: String(n) })); });
    tf.appendChild(h('td'));
    tb.appendChild(tf);
    table.appendChild(tb);
    S.body.appendChild(h('div', { cls: 'sc-scroll' }, table));
    S.body.appendChild(h('p', { cls: 'sc-help', text: 'Tap + to add a shift, or tap a shift to change it. Changes save automatically. When the week is ready, Publish, then text everyone their shifts.' }));
  }

  /* ---------- shift editor ---------- */
  function recentShifts() {
    var seen = {}, out = [];
    shifts().concat(S.lastWeek || []).forEach(function (s) { var k = s.start + '|' + s.end; if (!seen[k] && s.start) { seen[k] = 1; out.push({ start: s.start, end: s.end }); } });
    return out.slice(0, 6);
  }
  function positions() { var seen = {}; S.employees.forEach(function (e) { if (e.position) seen[e.position] = 1; }); shifts().forEach(function (s) { if (s.role) seen[s.role] = 1; }); return Object.keys(seen).sort(); }
  function modal(title, bodyKids, footKids) {
    var back = h('div', { cls: 'sc-modal', role: 'dialog', 'aria-modal': 'true' });
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
  function editShift(emp, day, s) {
    var isNew = !s; s = s || { id: uid(), emp: emp.id, day: day, start: '', end: '', role: emp.position || '', note: '' };
    var start = h('input', { type: 'time', value: s.start || '', step: '900' });
    var end = h('input', { type: 'time', value: s.end && !ENDS[s.end] ? s.end : '', step: '900' });
    var endMode = ENDS[s.end] ? s.end : 'time';
    var modeBtns = {};
    var endTog = h('div', { cls: 'sc-viewtog sc-endtog', role: 'group', 'aria-label': 'Shift ends' }, [['time', 'Set time'], ['cut1', '1st cut ~8p'], ['cut2', '2nd cut ~9p'], ['close', 'Close ~10p']].map(function (o) {
      return (modeBtns[o[0]] = h('button', { type: 'button', 'data-end': o[0], text: o[1], on: { click: function () { endMode = o[0]; syncClose(); if (o[0] === 'time') end.focus(); } } }));
    }));
    var role = h('input', { type: 'text', value: s.role || '', list: 'scPositions', placeholder: 'e.g. Server, Line, Bar' });
    var note = h('input', { type: 'text', value: s.note || '', placeholder: 'Optional, e.g. Private event, training' });
    var dl = h('datalist', { id: 'scPositions' }, positions().map(function (p) { return h('option', { value: p }); }));
    function syncClose() { end.disabled = endMode !== 'time'; Object.keys(modeBtns).forEach(function (k) { modeBtns[k].setAttribute('aria-pressed', k === endMode ? 'true' : 'false'); }); }
    syncClose();
    var quick = recentShifts();
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var kids = [
      h('p', { cls: 'sc-sub', text: (emp.name || '') + ' · ' + DAYS_LONG[day] + ', ' + addDays(S.week, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) }),
      quick.length ? h('div', { cls: 'sc-quick' }, [h('span', { text: 'Quick pick' })].concat(quick.map(function (q) {
        return h('button', { type: 'button', cls: 'ed-btn small', text: fmtT(q.start) + '–' + fmtT(q.end), on: { click: function () { start.value = q.start; if (ENDS[q.end]) { endMode = q.end; end.value = ''; } else { endMode = 'time'; end.value = q.end; } syncClose(); } } });
      }))) : null,
      h('div', { cls: 'sc-row2' }, [lbl('Start', start), lbl('End', end)]),
      h('div', { cls: 'sc-f' }, [h('span', { text: 'Ends' }), endTog]),
      h('p', { cls: 'sc-small', text: 'Server out times: 1st cut is counted as about 8pm, 2nd cut about 9pm, close about 10pm when hours are totaled.' }),
      lbl('Position', role), dl,
      lbl('Note', note), msg
    ];
    var m;
    var foot = [
      !isNew ? h('button', { type: 'button', cls: 'ed-btn small danger', text: 'Delete shift', on: { click: function () { S.row.shifts = shifts().filter(function (x) { return x.id !== s.id; }); m.close(); changed(); render(); } } }) : h('span'),
      h('span', { cls: 'sc-sp' }),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { m.close(); } } }),
      h('button', { type: 'button', cls: 'ed-btn', text: isNew ? 'Add shift' : 'Save', on: { click: save } })
    ];
    function save() {
      if (!start.value) { msg.textContent = 'Choose a start time.'; start.focus(); return; }
      if (endMode === 'time' && !end.value) { msg.textContent = 'Choose an end time, or pick 1st cut, 2nd cut or Close.'; end.focus(); return; }
      if (ENDS[endMode] && mins(start.value) >= mins(ENDS[endMode].at) && !confirm('This shift starts after ' + ENDS[endMode].label + ' is usually called (about ' + fmtT(ENDS[endMode].at) + '). Keep it?')) return;
      var off = offOn(S.timeoff, emp.id, addDays(S.week, day));
      if (isNew && off && off.status === 'approved' && !confirm((emp.name || 'This person') + ' has approved time off on ' + DAYS_LONG[day] + ' (' + offText(off) + '). Schedule them anyway?')) return;
      s.start = start.value; s.end = endMode === 'time' ? end.value : endMode; s.role = role.value.trim(); s.note = note.value.trim();
      if (isNew) { S.row.shifts = shifts().concat([s]); }
      m.close(); changed(); render();
    }
    m = modal(isNew ? 'Add shift' : 'Edit shift', kids, foot);
    m.el.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT' && ev.target.type !== 'checkbox') { ev.preventDefault(); save(); } });
    setTimeout(function () { start.focus(); }, 30);
  }

  function copyLastWeek() {
    var prev = addDays(S.week, -7);
    status('Copying last week…');
    loadWeek(prev).then(function (r) {
      var list = (r && r.shifts) || [];
      if (!list.length) { status('Last week has no shifts to copy.', 'err'); return; }
      var ok = S.employees.reduce(function (o, e) { if (e.active !== false) o[e.id] = 1; return o; }, {});
      var keep = list.filter(function (s) { return ok[s.emp]; });
      if (shifts().length && !confirm('Replace this week’s ' + shifts().length + ' shifts with last week’s ' + keep.length + '?')) { status(''); return; }
      S.row.shifts = keep.map(function (s) { var c = JSON.parse(JSON.stringify(s)); c.id = uid(); return c; });
      S.lastWeek = list;
      changed(); render(); status('Copied ' + keep.length + ' shifts from last week. Review them, then publish.', 'ok');
    }, function () { status('Couldn’t load last week.', 'err'); });
  }

  // One person: replace their shifts this week with their shifts from last week (same days and times).
  function copyLastWeekFor(emp) {
    var prev = addDays(S.week, -7), who = emp.name || 'This person';
    status('Copying ' + who + '’s last week…');
    loadWeek(prev).then(function (r) {
      var mine = ((r && r.shifts) || []).filter(function (s) { return s.emp === emp.id; });
      if (!mine.length) { status(who + ' had no shifts last week (' + weekLabel(prev) + ').', 'err'); return; }
      var now = shiftsFor(emp.id);
      if (now.length && !confirm('Replace ' + who + '’s ' + now.length + ' shift' + (now.length === 1 ? '' : 's') + ' this week with last week’s ' + mine.length + '?')) { status(''); return; }
      var skipped = [];
      var copies = mine.filter(function (s) {
        var off = offOn(S.timeoff, emp.id, addDays(S.week, s.day));
        if (off && off.status === 'approved') { skipped.push(DAYS[s.day]); return false; }
        return true;
      }).map(function (s) { var c = JSON.parse(JSON.stringify(s)); c.id = uid(); return c; });
      S.row.shifts = shifts().filter(function (s) { return s.emp !== emp.id; }).concat(copies);
      S.lastWeek = (r && r.shifts) || S.lastWeek;
      changed(); render();
      status('Copied ' + copies.length + ' shift' + (copies.length === 1 ? '' : 's') + ' for ' + who + (skipped.length ? '. Skipped ' + skipped.join(', ') + ' (approved time off)' : '') + '.', 'ok');
    }, function () { status('Couldn’t load last week.', 'err'); });
  }

  /* ---------- text messages ---------- */
  function openTexts() {
    if (!S.row) return;
    var emps = activeEmps(), m;
    var listEl = h('div', { cls: 'sc-texts' });
    var offBox = h('input', { type: 'checkbox' }); offBox.checked = S.includeOff;
    offBox.addEventListener('change', function () { S.includeOff = offBox.checked; paint(); });
    function paint() {
      listEl.innerHTML = '';
      var shown = emps.filter(function (e) { return e.active !== false && (S.includeOff || shiftsFor(e.id).length); });
      if (!shown.length) listEl.appendChild(h('p', { cls: 'sc-empty', text: 'Nobody is on the schedule this week.' }));
      shown.forEach(function (e) {
        var body = messageFor(e), ph = phoneE164(e.phone), sent = (S.row.sent || {})[e.id];
        var again = sent && sent.msg !== body;
        var state = !sent ? null : again ? h('span', { cls: 'sc-pill warn', text: 'Changed – text again' }) : h('span', { cls: 'sc-pill ok', text: 'Texted ' + new Date(sent.at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) });
        var copyBtn = h('button', { type: 'button', cls: 'ed-btn small', text: 'Copy', on: { click: function () {
          (navigator.clipboard ? navigator.clipboard.writeText(body) : Promise.reject()).then(function () { copyBtn.textContent = 'Copied'; }, function () { copyBtn.textContent = 'Select the text to copy'; });
        } } });
        var textBtn = ph ? h('a', { cls: 'ed-btn', href: smsHref(ph, body), text: 'Text', on: { click: function () {
          S.row.sent = S.row.sent || {}; S.row.sent[e.id] = { at: new Date().toISOString(), msg: body }; changed(); setTimeout(paint, 300);
        } } }) : h('span', { cls: 'sc-warn', text: 'Add a mobile number on the Employees tab' });
        listEl.appendChild(h('div', { cls: 'sc-text' }, [
          h('div', { cls: 'sc-text-h' }, [h('div', null, [h('b', { text: e.name || 'Unnamed' }), h('span', { cls: 'sc-ph', text: ph ? phoneShow(ph) : '' })]), state]),
          h('pre', { cls: 'sc-pre', text: body }),
          h('div', { cls: 'sc-text-f' }, [copyBtn, textBtn])
        ]));
      });
    }
    paint();
    m = modal('Text this week’s schedule', [
      h('p', { cls: 'sc-sub', text: 'Each Text button opens Messages on this phone or computer with the number and that person’s shifts filled in. Review it and tap Send. Nothing is sent automatically.' }),
      h('label', { cls: 'sc-check' }, [offBox, ' Also text people who are off this week']),
      listEl
    ], [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn', text: 'Done', on: { click: function () { m.close(); render(); } } })]);
    m.el.classList.add('wide');
  }

  /* ---------- time off ---------- */
  function rangeText(t) { return t.start_date === t.end_date ? dayLabel(t.start_date) : dayLabel(t.start_date) + ' \u2013 ' + dayLabel(t.end_date); }
  function decide(t, st, note) {
    var go2 = Promise.resolve(true);
    if (st === 'approved') {
      go2 = sb().from('schedule_weeks').select('week_start,shifts').gte('week_start', iso(monday(parseDay(t.start_date)))).lte('week_start', t.end_date).then(function (r) {
        var hits = [];
        (r.data || []).forEach(function (w) { (w.shifts || []).forEach(function (s) {
          if (s.emp !== t.emp) return; var d = iso(addDays(parseDay(w.week_start), s.day));
          if (d >= t.start_date && d <= t.end_date) hits.push(dayLabel(d) + ' ' + fmtT(s.start) + '\u2013' + fmtT(s.end));
        }); });
        if (!hits.length) return true;
        var e = empById(t.emp);
        return confirm((e ? e.name : 'This person') + ' is already scheduled during this time off:\n' + hits.join('\n') + '\n\nApprove anyway? You\u2019ll need to adjust those shifts.');
      }, function () { return true; });
    }
    return go2.then(function (ok) {
      if (!ok) return;
      status('Saving\u2026', 'dirty');
      return sb().from('time_off').update({ status: st, decision_note: note || '' }).eq('id', t.id).then(function (r) {
        if (r.error) { status(isPerm(r.error) ? 'Your account can\u2019t approve time off.' : 'Couldn\u2019t save. Check your connection.', 'err'); return; }
        status(st === 'approved' ? 'Approved. It now shows on the schedule.' : st === 'denied' ? 'Request denied.' : 'Saved.', 'ok');
        return Promise.all([loadRequests(), loadTimeOff(S.week, addDays(S.week, 6)).then(function (l) { S.timeoff = l; })]).then(render);
      });
    });
  }
  function renderTimeOff() {
    var reqs = S.requests || [], today = iso(new Date());
    var tools = h('div', { cls: 'sc-ptools' }, [h('button', { type: 'button', cls: 'ed-btn', text: '+ Add time off', on: { click: addTimeOff } }),
      h('p', { cls: 'sc-help', style: 'margin:0', text: 'Employees request time off on the staff page. Approved time off shows on the schedule; you\u2019ll be warned before scheduling someone who is off.' })]);
    S.body.appendChild(tools);
    function section(title, list, actions) {
      var box = h('section', { cls: 'sc-tsec' }, [h('h3', { cls: 'sc-th', text: title + ' (' + list.length + ')' })]);
      if (!list.length) box.appendChild(h('p', { cls: 'sc-empty', text: 'None.' }));
      list.forEach(function (t) {
        var e = empById(t.emp), note = h('input', { type: 'text', cls: 'sc-tnote', placeholder: 'Note to employee (optional)', maxlength: '500' });
        var btns = [];
        if (actions === 'pending') {
          btns.push(note);
          btns.push(h('button', { type: 'button', cls: 'ed-btn small danger', text: 'Deny', on: { click: function () { decide(t, 'denied', note.value.trim()); } } }));
          btns.push(h('button', { type: 'button', cls: 'ed-btn', text: 'Approve', on: { click: function () { decide(t, 'approved', note.value.trim()); } } }));
        } else {
          var rm = h('button', { type: 'button', cls: 'ed-btn small', text: 'Remove' });
          rm.addEventListener('click', function () {
            if (!rm.dataset.armed) { rm.dataset.armed = '1'; rm.textContent = 'Confirm'; setTimeout(function () { if (rm.isConnected) { delete rm.dataset.armed; rm.textContent = 'Remove'; } }, 3000); return; }
            sb().from('time_off').delete().eq('id', t.id).then(function (r) { if (r.error) { status('Couldn\u2019t remove it.', 'err'); return; } Promise.all([loadRequests(), loadTimeOff(S.week, addDays(S.week, 6)).then(function (l) { S.timeoff = l; })]).then(render); status('Removed.', 'ok'); });
          });
          if (t.status === 'approved') btns.push(h('button', { type: 'button', cls: 'ed-btn small', text: 'Change to denied', on: { click: function () { decide(t, 'denied', t.decision_note); } } }));
          btns.push(rm);
        }
        box.appendChild(h('div', { cls: 'sc-treq ' + t.status }, [
          h('div', { cls: 'sc-treq-m' }, [
            h('b', { text: e ? e.name : 'Former employee' }), h('span', { cls: 'sc-pill ' + (t.status === 'approved' ? 'ok' : t.status === 'pending' ? 'warn' : ''), text: t.status === 'pending' ? 'Pending' : t.status === 'approved' ? 'Approved' : 'Denied' }),
            h('p', { cls: 'sc-treq-d', text: rangeText(t) + ' \u00b7 ' + offText(t) }),
            t.reason ? h('p', { cls: 'sc-treq-r', text: '\u201c' + t.reason + '\u201d' }) : null,
            t.decision_note && actions !== 'pending' ? h('p', { cls: 'sc-treq-r', text: 'Note: ' + t.decision_note }) : null
          ]),
          h('div', { cls: 'sc-treq-a' }, btns)
        ]));
      });
      S.body.appendChild(box);
    }
    section('Waiting for approval', reqs.filter(function (t) { return t.status === 'pending'; }), 'pending');
    section('Approved, upcoming', reqs.filter(function (t) { return t.status === 'approved' && t.end_date >= today; }), 'done');
    section('Denied and past', reqs.filter(function (t) { return t.status === 'denied' || (t.status === 'approved' && t.end_date < today); }).reverse(), 'done');
  }
  function addTimeOff() {
    var emps = S.employees.filter(function (e) { return e.active !== false && String(e.name || '').trim(); }).sort(function (a, b) { return a.name.localeCompare(b.name); });
    var who = h('select', null, emps.map(function (e) { return h('option', { value: e.id, text: e.name }); }));
    var from = h('input', { type: 'date', value: iso(new Date()) }), to = h('input', { type: 'date', value: iso(new Date()) });
    var allDay = h('input', { type: 'checkbox' }); allDay.checked = true;
    var st = h('input', { type: 'time', step: '900', disabled: true }), et = h('input', { type: 'time', step: '900', disabled: true });
    allDay.addEventListener('change', function () { st.disabled = et.disabled = allDay.checked; });
    var reason = h('input', { type: 'text', maxlength: '500', placeholder: 'Optional' });
    var msg = h('p', { cls: 'sc-msg', role: 'status' }), m;
    from.addEventListener('change', function () { if (to.value < from.value) to.value = from.value; });
    m = modal('Add time off', [
      h('p', { cls: 'sc-sub', text: 'Time off you add here is approved right away.' }),
      lbl('Employee', who), h('div', { cls: 'sc-row2' }, [lbl('From', from), lbl('Through', to)]),
      h('label', { cls: 'sc-check' }, [allDay, ' All day']), h('div', { cls: 'sc-row2' }, [lbl('Off from', st), lbl('Until', et)]),
      lbl('Reason', reason), msg
    ], [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { m.close(); } } }),
      h('button', { type: 'button', cls: 'ed-btn', text: 'Add', on: { click: function () {
        if (!who.value) { msg.textContent = 'Choose an employee.'; return; }
        if (!from.value || !to.value || to.value < from.value) { msg.textContent = 'Check the dates.'; return; }
        if (!allDay.checked && !st.value) { msg.textContent = 'Choose a start time, or tick All day.'; return; }
        sb().from('time_off').insert({ emp: who.value, start_date: from.value, end_date: to.value, all_day: allDay.checked, start_time: allDay.checked ? '' : st.value, end_time: allDay.checked ? '' : (et.value || ''), reason: reason.value.trim(), status: 'approved' }).then(function (r) {
          if (r.error) { msg.textContent = isPerm(r.error) ? 'Your account can\u2019t add time off.' : 'Couldn\u2019t save. Check your connection.'; return; }
          m.close(); status('Time off added.', 'ok');
          Promise.all([loadRequests(), loadTimeOff(S.week, addDays(S.week, 6)).then(function (l) { S.timeoff = l; })]).then(render);
        });
      } } })]);
  }

  /* ---------- employees ---------- */
  function renderPeople() {
    var wrap = h('div', { cls: 'sc-people' });
    var tools = h('div', { cls: 'sc-ptools' }, [
      h('button', { type: 'button', cls: 'ed-btn', text: '+ Add employee', on: { click: function () {
        var e = { id: uid(), name: '', phone: '', position: '', email: '', active: true }; S.employees.push(e); render();
        var rows = S.body.querySelectorAll('.sc-prow'); var last = rows[rows.length - 1]; if (last) last.querySelector('input').focus();
      } } }),
      h('label', { cls: 'ed-btn small sc-file' }, ['Import spreadsheet', h('input', { type: 'file', accept: '.xlsx,.xls,.csv', on: { change: function (ev) { var f = ev.target.files[0]; ev.target.value = ''; if (f) importFile(f); } } })]),
      h('a', { cls: 'sc-link', href: TEMPLATE, download: 'eden-employees.xlsx', text: 'Download the blank employee spreadsheet' })
    ]);
    wrap.appendChild(tools);
    var url = teamUrl(), cp = h('button', { type: 'button', cls: 'ed-btn small', text: 'Copy link' });
    cp.addEventListener('click', function () { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { cp.textContent = 'Copied'; }, function () { cp.textContent = url; }); });
    wrap.appendChild(h('div', { cls: 'sc-teamlink' }, [
      h('div', null, [h('span', { cls: 'sc-eyebrow', text: 'Staff schedule page' }), h('a', { href: url, target: '_blank', rel: 'noopener', text: url })]),
      h('p', { text: 'Employees with an email below can open this page, choose \u201cCreate account\u201d and set their own password. They see published schedules (names and positions only) and the message board.' }),
      cp
    ]));
    if (!S.hasEmail) wrap.appendChild(h('div', { cls: 'ed-banner' }, [h('p', { text: 'To add login emails, run the one-time team setup in Supabase (supabase/team.sql), then reload this page.' })]));
    // what Supabase is set to do when staff sign up (read from its public settings)
    if (S.hasEmail && S.authCfg) {
      var ac = S.authCfg, notes = [];
      if (ac.disable_signup) notes.push('New staff can’t create accounts themselves right now (sign-ups are switched off in Supabase: Authentication › Sign In / Providers › Allow new users to sign up). Use “Create login” below for each person.');
      else if (ac.mailer_autoconfirm === false) notes.push('When staff create their own account, Supabase emails them a confirmation link. Unless Supabase sends email through Resend (Authentication › Emails › SMTP Settings), those emails don’t reach them. The quickest way in: “Create login” below, then give them the temporary password.');
      if (notes.length) wrap.appendChild(h('div', { cls: 'ed-banner sc-onboard' }, notes.map(function (t) { return h('p', { text: t }); })));
    }
    var list = S.employees.slice().sort(function (a, b) { return (!a.name) - (!b.name) || (a.active === false) - (b.active === false) || (a.name || '').localeCompare(b.name || ''); });
    var heads = ['Name', 'Mobile number'].concat(S.hasEmail ? ['Email (login)'] : []).concat(['Position']).concat(S.hasAccess ? ['Permissions'] : []).concat(S.hasEmail ? ['Login'] : []).concat(['On schedule', '']);
    var table = h('table', { cls: 'sc-ptable' }, [h('thead', null, h('tr', null, heads.map(function (t) { return h('th', { text: t }); })))]);
    var tb = h('tbody');
    var dl = h('datalist', { id: 'scPosList' }, positions().map(function (p) { return h('option', { value: p }); }));
    list.forEach(function (e) {
      function inp(key, attrs) {
        var i = h('input', Object.assign({ type: 'text', value: e[key] || '' }, attrs || {}));
        i.addEventListener('input', function () { e[key] = i.value; empChanged(e); });
        return i;
      }
      var ph = inp('phone', { type: 'tel', placeholder: '(315) 555-0123', inputmode: 'tel' });
      var bad = h('span', { cls: 'sc-warn' });
      function chk() { bad.textContent = e.phone && !phoneE164(e.phone) ? 'Check this number' : ''; }
      ph.addEventListener('blur', function () { if (phoneE164(e.phone)) { ph.value = phoneShow(e.phone); } chk(); }); chk();
      var act = h('input', { type: 'checkbox', 'aria-label': 'On schedule' }); act.checked = e.active !== false;
      act.addEventListener('change', function () { e.active = act.checked; empChanged(e); });
      var del = h('button', { type: 'button', cls: 'ed-btn small danger', text: 'Remove' });
      del.addEventListener('click', function () {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Confirm'; setTimeout(function () { if (del.isConnected) { delete del.dataset.armed; del.textContent = 'Remove'; } }, 3000); return; }
        sb().from('employees').delete().eq('id', e.id).then(function (r) {
          if (r.error) { status('Couldn’t remove. Turn off “On schedule” instead.', 'err'); return; }
          S.employees = S.employees.filter(function (x) { return x.id !== e.id; });
          if (S.row) { var before = shifts().length; S.row.shifts = shifts().filter(function (s) { return s.emp !== e.id; }); if (shifts().length !== before) changed(); }
          render(); status('Removed.', 'ok');
        });
      });
      var em = null, login = null;
      if (S.hasEmail) {
        var emIn = inp('email', { type: 'email', placeholder: 'name@example.com', autocomplete: 'off', spellcheck: 'false' });
        var emBad = h('span', { cls: 'sc-warn' });
        var emChk = function () { emBad.textContent = e.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(String(e.email).trim()) ? 'Check this email' : ''; };
        emIn.addEventListener('blur', emChk); emChk();
        em = [emIn, emBad];
        var acct = e.email ? S.accounts && S.accounts[String(e.email).trim().toLowerCase()] : null;
        // forgot or compromised password: a manager sets a temporary one (only the Owner can for managers)
        var canReset = acct && window.EdenAccount && (isOwner() || e.access !== 'manager');
        var person = { name: e.name, email: String(e.email || '').trim().toLowerCase() };
        var canMake = window.EdenAccount && window.EdenAccount.createFor && e.active !== false && (isOwner() || e.access !== 'manager');
        var refresh = function () { loadAccounts().then(render); };
        var waiting = acct && acct.confirmed === false;   // signed up, but the confirmation email never got clicked
        login = !e.email ? h('span', { cls: 'sc-login none', text: '\u2013' })
          : acct && !waiting ? h('span', { cls: 'sc-acct' }, [h('span', { cls: 'sc-login ok', text: (acct.last_sign_in_at ? 'Active \u00b7 ' + new Date(acct.last_sign_in_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : 'Created, not signed in yet') }),
              canReset ? h('button', { type: 'button', cls: 'sc-resetpw', text: 'Reset password', on: { click: function () { window.EdenAccount.resetFor(sb(), person); } } }) : null])
          : waiting ? h('span', { cls: 'sc-acct' }, [h('span', { cls: 'sc-login warn', text: 'Waiting on email confirmation' }),
              canMake ? h('button', { type: 'button', cls: 'sc-resetpw', text: 'Switch on with a password', on: { click: function () { window.EdenAccount.createFor(sb(), Object.assign({ fixing: true }, person), refresh); } } }) : null])
          : S.accountsOk ? h('span', { cls: 'sc-acct' }, [h('span', { cls: 'sc-login', text: 'No login yet' }),
              canMake ? h('button', { type: 'button', cls: 'sc-resetpw', text: 'Create login', on: { click: function () { window.EdenAccount.createFor(sb(), person, refresh); } } }) : null])
          : h('span', { cls: 'sc-login none', text: '\u2013' });
      }
      var cells = [h('td', null, inp('name', { placeholder: 'Full name' })), h('td', null, [ph, bad])];
      if (S.hasEmail) cells.push(h('td', null, em));
      cells.push(h('td', null, inp('position', { list: 'scPosList', placeholder: 'e.g. Server' })));
      if (S.hasAccess) {
        if (isOwner()) {
          var sel = h('select', { cls: 'sc-access', 'aria-label': 'Permissions for ' + (e.name || 'employee') }, [h('option', { value: 'employee', text: 'Employee' }), h('option', { value: 'manager', text: 'Manager' })]);
          sel.value = e.access === 'manager' ? 'manager' : 'employee';
          sel.addEventListener('change', function () { e.access = sel.value; empChanged(e); });
          cells.push(h('td', null, sel));
        } else cells.push(h('td', null, h('span', { cls: 'sc-login' + (e.access === 'manager' ? ' ok' : ''), text: e.access === 'manager' ? 'Manager' : 'Employee' })));
      }
      if (S.hasEmail) cells.push(h('td', null, login));
      cells.push(h('td', { cls: 'c' }, act), h('td', { cls: 'r' }, del));
      tb.appendChild(h('tr', { cls: 'sc-prow' + (e.active === false ? ' inactive' : '') }, cells));
    });
    table.appendChild(tb);
    wrap.appendChild(dl);
    if (list.length) wrap.appendChild(h('div', { cls: 'sc-scroll' }, table));
    else wrap.appendChild(h('p', { cls: 'sc-empty', text: 'No employees yet. Add them here, or fill in the spreadsheet and import it.' }));
    if (S.hasAccess) wrap.appendChild(h('div', { cls: 'sc-perm-help' }, [
      h('p', null, [h('b', { text: 'Employee: ' }), 'sees the posted schedule, requests time off, uses the message board.']),
      h('p', null, [h('b', { text: 'Manager: ' }), 'also edits and publishes the schedule, approves time off, texts the team and sees this list. Managers sign in on this site and see only the Schedule.']),
      isOwner() ? null : h('p', { text: 'Only the Owner can change permissions.' })
    ]));
    wrap.appendChild(h('p', { cls: 'sc-help', text: 'Mobile numbers and emails are visible only to the Owner and Managers; the staff page never shows them. Turn off \u201cOn schedule\u201d for people on leave or seasonal: they drop off the schedule and can no longer sign in to the staff page. Remove deletes them.' }));
    S.body.appendChild(wrap);
  }

  function importFile(file) {
    status('Reading ' + file.name + '…');
    var isCsv = /\.csv$/i.test(file.name);
    var rowsP = isCsv ? file.text().then(parseCsv) : (window.XLSX ? Promise.resolve() : loadScript(SHEETJS)).then(function () {
      return file.arrayBuffer().then(function (buf) {
        var wb = window.XLSX.read(buf, { type: 'array' });
        var name = wb.SheetNames.filter(function (n) { return /employee|staff|team/i.test(n); })[0] || wb.SheetNames[0];
        return window.XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, raw: false, defval: '' });
      });
    });
    rowsP.then(function (rows) {
      var hi = -1, col = {};
      for (var i = 0; i < Math.min(rows.length, 15) && hi < 0; i++) {
        var r = rows[i].map(function (c) { return String(c).toLowerCase().trim(); });
        var n = r.findIndex(function (c) { return /^(full name|name|employee|employee name)\*?$/.test(c); });
        if (n >= 0) { hi = i; col.name = n; col.phone = r.findIndex(function (c) { return /phone|mobile|cell/.test(c); }); col.position = r.findIndex(function (c) { return /position|role|job|title/.test(c); }); col.email = r.findIndex(function (c) { return /e-?mail/.test(c); }); }
      }
      if (hi < 0) { status('Couldn’t find a “Name” column in that file. Use the Eden employee spreadsheet.', 'err'); return; }
      var added = 0, updated = 0, skipped = 0, jobs = [];
      rows.slice(hi + 1).forEach(function (r) {
        var name = String(r[col.name] || '').trim(), phone = col.phone >= 0 ? String(r[col.phone] || '').trim() : '', pos = col.position >= 0 ? String(r[col.position] || '').trim() : '';
        var mail = col.email >= 0 ? String(r[col.email] || '').trim().toLowerCase() : '';
        if (/^example/i.test(name)) return;
        if (!name) { if (phone || pos) skipped++; return; }
        var e164 = phoneE164(phone);
        var hit = S.employees.filter(function (x) { return (e164 && phoneE164(x.phone) === e164) || (x.name || '').trim().toLowerCase() === name.toLowerCase(); })[0];
        if (hit) { hit.name = name; if (phone) hit.phone = e164 ? phoneShow(e164) : phone; if (pos) hit.position = pos; if (mail) hit.email = mail; hit.active = true; updated++; jobs.push(hit); }
        else { var e = { id: uid(), name: name, phone: e164 ? phoneShow(e164) : phone, position: pos, email: mail, active: true }; S.employees.push(e); added++; jobs.push(e); }
      });
      if (!jobs.length) { status('No employees found in that file.', 'err'); return; }
      jobs.forEach(function (e) { e.active = true; });
      return sb().from('employees').upsert(jobs.map(empRow), { onConflict: 'id' }).then(function (r) {
        if (r.error && noEmailCol(r.error)) { S.hasEmail = false; return sb().from('employees').upsert(jobs.map(empRow), { onConflict: 'id' }); }
        return r;
      }).then(function (r) {
        if (r.error && r.error.code === '23505') throw new Error('two employees have the same email address');
        if (r.error) throw r.error;
        loadEmployees().then(render, render); // re-read: picks up columns such as access added by the database
        render(); status('Imported: ' + added + ' added, ' + updated + ' updated' + (skipped ? ', ' + skipped + ' rows without a name skipped' : '') + '.', 'ok');
      });
    }).catch(function (e) { status(isPerm(e) ? 'Your account can’t change employees.' : 'Couldn’t import that file: ' + (e && e.message || e), 'err'); });
  }
  function parseCsv(text) {
    var rows = [], row = [], cur = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(cur); cur = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cur); rows.push(row); row = []; cur = ''; }
      else cur += c;
    }
    if (cur || row.length) { row.push(cur); rows.push(row); }
    return rows;
  }

  /* ---------- public ---------- */
  window.EdenSchedule = {
    show: function (ctx) {
      var first = !S.ctx; S.ctx = ctx; S.el = ctx.el;
      if (first || S.missing) load(); else render();
    },
    summary: function (client) {
      return client.from('schedule_weeks').select('status,published,shifts,published_at').eq('week_start', iso(monday(new Date()))).maybeSingle().then(function (r) {
        if (r.error) return isMissing(r.error) ? 'Not set up yet' : '';
        var w = r.data; if (!w || !(w.shifts || []).length) return 'This week: not started';
        var n = w.shifts.length, st = w.status !== 'published' ? 'draft' : shiftsKey(w.shifts) === shiftsKey(w.published) ? 'published' : 'changed';
        return 'This week: ' + n + ' shift' + (n === 1 ? '' : 's') + ' · ' + (st === 'published' ? 'published' : st === 'changed' ? 'changed since publishing' : 'draft');
      }).then(function (txt) {
        return client.from('time_off').select('id').eq('status', 'pending').then(function (r) {
          var n = (!r.error && r.data) ? r.data.length : 0;
          return txt + (n ? ' \u00b7 ' + n + ' time-off request' + (n === 1 ? '' : 's') + ' waiting' : '');
        }, function () { return txt; });
      });
    },
    _test: { phoneE164: phoneE164, messageFor: messageFor, S: S }
  };
  window.addEventListener('beforeunload', function (e) { if (S.dirty || S.saving) { saveWeek(); e.preventDefault(); e.returnValue = ''; } });
})();
