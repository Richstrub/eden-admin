/* Eden staff site: weekly schedule.
 *
 * Tables (see supabase/schedule.sql):
 *   employees        id, name, phone, position, active
 *   schedule_weeks   week_start (Monday, YYYY-MM-DD), shifts (json), status, published (json snapshot),
 *                    published_at, sent (json: employee id -> { at, msg })
 * A shift is { id, emp, day (0 = Monday … 6 = Sunday), start 'HH:MM', end 'HH:MM' | 'close', role, note }.
 * Only Owner and Manager can see or change any of this (enforced by the database).
 *
 * Texting: "Text schedules" lists everyone with their own week written out. Each "Text" button opens the
 * phone's Messages app with the number and message filled in (sms: link), so nothing is sent without you.
 */
(function () {
  'use strict';
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var TEMPLATE = 'templates/eden-employees.xlsx';
  var SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';

  var S = { ctx: null, el: null, built: false, tab: 'grid', week: monday(new Date()), employees: [], row: null,
    loading: false, dirty: false, saving: false, timer: null, missing: false, includeOff: false };

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
  function monday(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); var dow = (x.getDay() + 6) % 7; x.setDate(x.getDate() - dow); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function longDate(d) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function weekLabel(d) {
    var e = addDays(d, 6), sameM = d.getMonth() === e.getMonth();
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + (sameM ? e.getDate() : e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + ', ' + e.getFullYear();
  }
  function fmtT(t) {
    if (t === 'close') return 'close';
    var p = String(t || '').split(':'), H = +p[0], M = +p[1] || 0; if (isNaN(H)) return '';
    var ap = H >= 12 ? 'p' : 'a', hh = H % 12 || 12;
    return hh + (M ? ':' + String(M).padStart(2, '0') : '') + ap;
  }
  function mins(t) { var p = String(t || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function shiftHours(s) { if (s.end === 'close' || !s.start || !s.end) return null; var d = mins(s.end) - mins(s.start); if (d <= 0) d += 1440; return d / 60; }
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
    });
  }
  function loadWeek(d) {
    return sb().from('schedule_weeks').select('*').eq('week_start', iso(d)).maybeSingle().then(function (r) {
      if (r.error) throw r.error; return r.data || null;
    });
  }
  function blankRow(d) { return { week_start: iso(d), shifts: [], status: 'draft', published: null, published_at: null, sent: {} }; }
  function load() {
    S.loading = true; render();
    return Promise.all([loadEmployees(), loadWeek(S.week)]).then(function (r) {
      S.row = r[1] || blankRow(S.week); S.row.sent = S.row.sent || {}; S.missing = false; S.loading = false; render();
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
  function saveEmployee(e) {
    return sb().from('employees').upsert({ id: e.id, name: e.name || '', phone: e.phone || '', position: e.position || '', active: e.active !== false }, { onConflict: 'id' })
      .then(function (r) { if (r.error) throw r.error; status('Saved.', 'ok'); })
      .catch(function (err) { status(isPerm(err) ? 'Your account can’t change employees.' : 'Couldn’t save the employee. Check your connection.', 'err'); });
  }
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
      var hrs = shiftHours(s); if (hrs == null) close++; else total += hrs;
      return DAYS[s.day] + ' ' + md(addDays(S.week, s.day)) + ': ' + fmtT(s.start) + '–' + fmtT(s.end) + (s.role ? ' ' + s.role : '') + (s.note ? ' (' + s.note + ')' : '');
    });
    var tot = 'Total: ' + fmtH(total) + ' hrs' + (close ? ' + ' + close + ' close' : '');
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
    if (S.tab === 'people') renderPeople(); else renderGrid();
  }
  function renderHead() {
    var st = pubState(), pubAt = S.row && S.row.published_at ? new Date(S.row.published_at) : null;
    var pill = st === 'published' ? h('span', { cls: 'sc-pill ok', text: 'Published' + (pubAt ? ' ' + pubAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '') })
      : st === 'changed' ? h('span', { cls: 'sc-pill warn', text: 'Changed since publishing' })
      : h('span', { cls: 'sc-pill', text: 'Draft' });
    var thisWeek = iso(S.week) === iso(monday(new Date()));
    S.head.innerHTML = '';
    S.head.appendChild(h('div', { cls: 'sc-titlebar' }, [
      h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Staff Schedule' }), h('h1', { cls: 'sc-week', text: 'Week of ' + weekLabel(S.week) })]),
      h('div', { cls: 'sc-weeknav' }, [
        h('button', { type: 'button', cls: 'ed-btn small', 'aria-label': 'Previous week', text: '←', on: { click: function () { go(-7); } } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'This week', disabled: thisWeek, on: { click: function () { go(0); } } }),
        h('button', { type: 'button', cls: 'ed-btn small', 'aria-label': 'Next week', text: '→', on: { click: function () { go(7); } } })
      ])
    ]));
    if (S.missing) return;
    var nShifts = shifts().length;
    S.head.appendChild(h('div', { cls: 'sc-bar' }, [
      h('div', { cls: 'sc-tabs', role: 'tablist' }, [
        h('button', { type: 'button', role: 'tab', 'aria-selected': S.tab === 'grid' ? 'true' : 'false', text: 'Schedule', on: { click: function () { S.tab = 'grid'; render(); } } }),
        h('button', { type: 'button', role: 'tab', 'aria-selected': S.tab === 'people' ? 'true' : 'false', text: 'Employees (' + S.employees.filter(function (e) { return e.active !== false; }).length + ')', on: { click: function () { S.tab = 'people'; render(); } } })
      ]),
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
    (S.dirty ? saveWeek() : Promise.resolve()).then(function () { S.week = next; load(); });
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
      tr.appendChild(h('td', { cls: 'sc-name' }, [h('span', { cls: 'sc-ename', text: e.name || 'Unnamed' }), e.phone ? null : h('span', { cls: 'sc-warn', text: 'No mobile number' })]));
      var total = 0, close = 0;
      for (var d = 0; d < 7; d++) {
        (function (day) {
          var list = shiftsFor(e.id, day); if (list.length) perDay[day]++;
          var td = h('td', { cls: 'sc-cell' + (list.length ? '' : ' empty') });
          list.forEach(function (s) {
            var hrs = shiftHours(s); if (hrs == null) close++; else total += hrs;
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
      tr.appendChild(h('td', { cls: 'sc-hrs', text: total || close ? fmtH(total) + (close ? ' + ' + close + ' cl' : '') : '–' }));
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
    var end = h('input', { type: 'time', value: s.end && s.end !== 'close' ? s.end : '', step: '900' });
    var cl = h('input', { type: 'checkbox' }); cl.checked = s.end === 'close';
    var role = h('input', { type: 'text', value: s.role || '', list: 'scPositions', placeholder: 'e.g. Server, Line, Bar' });
    var note = h('input', { type: 'text', value: s.note || '', placeholder: 'Optional, e.g. Private event, training' });
    var dl = h('datalist', { id: 'scPositions' }, positions().map(function (p) { return h('option', { value: p }); }));
    function syncClose() { end.disabled = cl.checked; }
    cl.addEventListener('change', syncClose); syncClose();
    var quick = recentShifts();
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var kids = [
      h('p', { cls: 'sc-sub', text: (emp.name || '') + ' · ' + DAYS_LONG[day] + ', ' + addDays(S.week, day).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) }),
      quick.length ? h('div', { cls: 'sc-quick' }, [h('span', { text: 'Quick pick' })].concat(quick.map(function (q) {
        return h('button', { type: 'button', cls: 'ed-btn small', text: fmtT(q.start) + '–' + fmtT(q.end), on: { click: function () { start.value = q.start; if (q.end === 'close') { cl.checked = true; end.value = ''; } else { cl.checked = false; end.value = q.end; } syncClose(); } } });
      }))) : null,
      h('div', { cls: 'sc-row2' }, [lbl('Start', start), lbl('End', end)]),
      h('label', { cls: 'sc-check' }, [cl, ' Until close']),
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
      if (!cl.checked && !end.value) { msg.textContent = 'Choose an end time, or tick Until close.'; end.focus(); return; }
      s.start = start.value; s.end = cl.checked ? 'close' : end.value; s.role = role.value.trim(); s.note = note.value.trim();
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

  /* ---------- employees ---------- */
  function renderPeople() {
    var wrap = h('div', { cls: 'sc-people' });
    var tools = h('div', { cls: 'sc-ptools' }, [
      h('button', { type: 'button', cls: 'ed-btn', text: '+ Add employee', on: { click: function () {
        var e = { id: uid(), name: '', phone: '', position: '', active: true }; S.employees.push(e); render();
        var rows = S.body.querySelectorAll('.sc-prow'); var last = rows[rows.length - 1]; if (last) last.querySelector('input').focus();
      } } }),
      h('label', { cls: 'ed-btn small sc-file' }, ['Import spreadsheet', h('input', { type: 'file', accept: '.xlsx,.xls,.csv', on: { change: function (ev) { var f = ev.target.files[0]; ev.target.value = ''; if (f) importFile(f); } } })]),
      h('a', { cls: 'sc-link', href: TEMPLATE, download: 'eden-employees.xlsx', text: 'Download the blank employee spreadsheet' })
    ]);
    wrap.appendChild(tools);
    var list = S.employees.slice().sort(function (a, b) { return (!a.name) - (!b.name) || (a.active === false) - (b.active === false) || (a.name || '').localeCompare(b.name || ''); });
    var table = h('table', { cls: 'sc-ptable' }, [h('thead', null, h('tr', null, [h('th', { text: 'Name' }), h('th', { text: 'Mobile number' }), h('th', { text: 'Position' }), h('th', { text: 'On schedule' }), h('th')]))]);
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
      tb.appendChild(h('tr', { cls: 'sc-prow' + (e.active === false ? ' inactive' : '') }, [
        h('td', null, inp('name', { placeholder: 'Full name' })),
        h('td', null, [ph, bad]),
        h('td', null, inp('position', { list: 'scPosList', placeholder: 'e.g. Server' })),
        h('td', { cls: 'c' }, act),
        h('td', { cls: 'r' }, del)
      ]));
    });
    table.appendChild(tb);
    wrap.appendChild(dl);
    if (list.length) wrap.appendChild(h('div', { cls: 'sc-scroll' }, table));
    else wrap.appendChild(h('p', { cls: 'sc-empty', text: 'No employees yet. Add them here, or fill in the spreadsheet and import it.' }));
    wrap.appendChild(h('p', { cls: 'sc-help', text: 'Mobile numbers are used only to text schedules, and only the Owner and Managers can see them. Turn off “On schedule” for people who are on leave or seasonal; their past schedules are kept.' }));
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
        if (n >= 0) { hi = i; col.name = n; col.phone = r.findIndex(function (c) { return /phone|mobile|cell/.test(c); }); col.position = r.findIndex(function (c) { return /position|role|job|title/.test(c); }); }
      }
      if (hi < 0) { status('Couldn’t find a “Name” column in that file. Use the Eden employee spreadsheet.', 'err'); return; }
      var added = 0, updated = 0, skipped = 0, jobs = [];
      rows.slice(hi + 1).forEach(function (r) {
        var name = String(r[col.name] || '').trim(), phone = col.phone >= 0 ? String(r[col.phone] || '').trim() : '', pos = col.position >= 0 ? String(r[col.position] || '').trim() : '';
        if (/^example/i.test(name)) return;
        if (!name) { if (phone || pos) skipped++; return; }
        var e164 = phoneE164(phone);
        var hit = S.employees.filter(function (x) { return (e164 && phoneE164(x.phone) === e164) || (x.name || '').trim().toLowerCase() === name.toLowerCase(); })[0];
        if (hit) { hit.name = name; if (phone) hit.phone = e164 ? phoneShow(e164) : phone; if (pos) hit.position = pos; hit.active = true; updated++; jobs.push(hit); }
        else { var e = { id: uid(), name: name, phone: e164 ? phoneShow(e164) : phone, position: pos, active: true }; S.employees.push(e); added++; jobs.push(e); }
      });
      if (!jobs.length) { status('No employees found in that file.', 'err'); return; }
      return sb().from('employees').upsert(jobs.map(function (e) { return { id: e.id, name: e.name, phone: e.phone, position: e.position, active: true }; }), { onConflict: 'id' }).then(function (r) {
        if (r.error) throw r.error;
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
      });
    },
    _test: { phoneE164: phoneE164, messageFor: messageFor, S: S }
  };
  window.addEventListener('beforeunload', function (e) { if (S.dirty || S.saving) { saveWeek(); e.preventDefault(); e.returnValue = ''; } });
})();
