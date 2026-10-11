/* Eden team page: each employee's published shifts, who's working, and the message board.
 *
 * Privacy: this page never reads the employees table. The schedule comes from the database
 * function team_schedule(), which returns only first name + last initial, position and shift
 * times for published weeks. Phone numbers and emails are never sent to this page.
 * Only people on the staff list (an active employee email, or a staff role) get any data.
 */
(function () {
  'use strict';
  var CFG = window.EDEN_STAFF_CONFIG || {};
  var DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  var DAYS_LONG = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
  var ROLE_NAMES = { owner: 'Owner', manager: 'Manager', kitchen: 'Kitchen', foh: 'Front of House' };
  var $ = function (id) { return document.getElementById(id); };
  var screens = ['loading', 'signin', 'notlisted', 'app'];
  function show(id) { screens.forEach(function (s) { $(s).hidden = s !== id; }); }

  if (!window.supabase || !CFG.supabase || !CFG.supabase.url) { $('loadingMsg').textContent = 'Could not load. Check your internet connection and reload.'; return; }
  var sb = window.supabase.createClient(CFG.supabase.url, CFG.supabase.key);
  var me = null, session = null, started = false, week = monday(new Date());
  var view = 'week', dayDate = new Date(), month = firstOfMonth(new Date()), myOff = [], monthData = null, pickedDay = null;

  /* ---------- helpers ---------- */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v; else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); }); else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function parseDay(t) { var p = String(t || '').split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function dayLabel(t) { return parseDay(t).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function monday(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function weekLabel(d) {
    var e = addDays(d, 6);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + (d.getMonth() === e.getMonth() ? e.getDate() : e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }
  // Shifts can end at a set time or at a server "out" time. Those have an assumed clock time for hour totals.
  var ENDS = { cut1: { label: '1st cut', at: '20:00' }, cut2: { label: '2nd cut', at: '21:00' }, close: { label: 'close', at: '22:00' } };
  function isApprox(s) { return !!ENDS[s.end]; }
  function fmtT(t) {
    if (ENDS[t]) return ENDS[t].label;
    var p = String(t || '').split(':'), H = +p[0], M = +p[1] || 0; if (isNaN(H)) return '';
    return (H % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H >= 12 ? 'p' : 'a');
  }
  function mins(t) { var p = String(t || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function hours(s) {
    if (!s.start || !s.end) return null;
    var end = ENDS[s.end] ? ENDS[s.end].at : s.end, d = mins(end) - mins(s.start);
    if (d <= 0) { if (ENDS[s.end]) return null; d += 1440; }
    return d / 60;
  }
  function ago(t) {
    var s = (Date.now() - new Date(t).getTime()) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago'; if (s < 86400) return Math.floor(s / 3600) + ' hr ago';
    var d = new Date(t); return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }

  /* ---------- sign in / create account ---------- */
  var form = $('signin').querySelector('form'), msg = form.querySelector('.msg'), mode = 'in';
  function setMode(m) {
    mode = m;
    form.querySelectorAll('.tm-switch button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.mode === m ? 'true' : 'false'); });
    form.querySelectorAll('[data-for]').forEach(function (el) { el.hidden = el.getAttribute('data-for') !== m; });
    form.querySelector('.primary').textContent = m === 'up' ? 'Create account' : 'Sign in';
    form.password.setAttribute('autocomplete', m === 'up' ? 'new-password' : 'current-password');
    msg.textContent = '';
  }
  form.querySelectorAll('.tm-switch button').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.email.value.trim(), pw = form.password.value;
    if (!email || !pw) { msg.textContent = 'Enter your email and password.'; return; }
    if (mode === 'up') {
      if (pw.length < 8) { msg.textContent = 'Use at least 8 characters for your password.'; return; }
      if (pw !== form.password2.value) { msg.textContent = 'The two passwords don’t match.'; return; }
      msg.textContent = 'Creating your account…';
      sb.auth.signUp({ email: email, password: pw }).then(function (r) {
        if (r.error) {
          var m = r.error.message || '';
          msg.textContent = /rate limit|confirmation|sending/i.test(m) ? 'Sign-up is waiting on a setting: a manager needs to turn off \u201cConfirm email\u201d in Supabase, then you can try again.'
            : /staff list|database error/i.test(m) ? 'That email isn\u2019t on Eden\u2019s staff list yet. Ask a manager to add it, then try again.'
            : /already|registered|exists/i.test(m) ? 'There’s already an account for that email. Choose Sign in instead.'
            : /password/i.test(m) ? m : 'Couldn’t create the account: ' + m;
          return;
        }
        if (!r.data || !r.data.session) { msg.textContent = 'Account created. Check your email to confirm it, then sign in.'; setMode('in'); }
      });
    } else {
      msg.textContent = 'Signing in…';
      sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
        if (r.error) msg.textContent = /not confirmed/i.test(r.error.message || '') ? 'This account was never confirmed. Ask a manager to delete it in Supabase (Authentication \u2192 Users), then choose Create account again.'
          : /rate|too many/i.test(r.error.message || '') ? 'Too many attempts. Try again in a few minutes.' : 'That email and password didn\u2019t work. New here? Choose Create account.';
      });
    }
  });
  document.querySelectorAll('[data-act="signout"]').forEach(function (b) { b.addEventListener('click', function () { sb.auth.signOut().then(function () { location.replace(location.pathname); }); }); });

  sb.auth.onAuthStateChange(function (event, s) {
    session = s;
    if (!s) { show('signin'); return; }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') enter();
  });

  function enter() {
    show('loading'); $('loadingMsg').textContent = 'Loading your schedule…';
    sb.rpc('team_me').then(function (r) {
      if (r.error) { $('loadingMsg').textContent = /team_me|function/i.test(r.error.message || '') ? 'The staff page isn’t set up yet. Ask a manager.' : 'Couldn’t reach the schedule. Check your connection and reload.'; return; }
      me = r.data || {};
      if (!me.employee && !me.role) {
        $('notlistedMsg').textContent = 'You’re signed in as ' + (session.user && session.user.email) + ', but that email isn’t on Eden’s current staff list. Ask a manager if you think this is a mistake.';
        show('notlisted'); return;
      }
      var name = (me.employee && me.employee.name) || (session.user && session.user.email) || '';
      $('whoName').textContent = name;
      $('whoRole').textContent = (me.employee && me.employee.position) || ROLE_NAMES[me.role] || '';
      $('mgrLink').hidden = !(me.role === 'owner' || me.role === 'manager' || me.access === 'owner' || me.access === 'manager');
      if (me.access === 'manager' && !me.role) $('whoRole').textContent = ((me.employee && me.employee.position) || 'Manager');
      $('timeoffSec').hidden = !me.employee;
      var first = String(name).split(/[\s@]/)[0], hr = new Date().getHours();
      $('hello').textContent = (hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (first ? ', ' + first : '');
      show('app');
      if (!started) { started = true; startBoard(); }
      loadMyOff().then(loadView);
    });
  }

  /* ---------- schedule ---------- */
  $('prevWeek').onclick = function () { if (view === 'month') month = new Date(month.getFullYear(), month.getMonth() - 1, 1); else if (view === 'day') dayDate = addDays(dayDate, -1); else week = addDays(week, -7); loadView(); };
  $('nextWeek').onclick = function () { if (view === 'month') month = new Date(month.getFullYear(), month.getMonth() + 1, 1); else if (view === 'day') dayDate = addDays(dayDate, 1); else week = addDays(week, 7); loadView(); };
  $('thisWeek').onclick = function () { if (view === 'month') month = firstOfMonth(new Date()); else if (view === 'day') dayDate = new Date(); else week = monday(new Date()); loadView(); };
  $('viewDay').onclick = function () { openDay(new Date()); };
  $('viewWeek').onclick = function () {
    if (view === 'week') return;
    week = monday(view === 'day' ? dayDate : pickedDay ? parseDay(pickedDay) : (iso(month) === iso(firstOfMonth(new Date())) ? new Date() : month));
    view = 'week'; loadView();
  };
  $('viewMonth').onclick = function () { if (view === 'month') return; month = firstOfMonth(view === 'day' ? dayDate : addDays(week, 3)); view = 'month'; pickedDay = null; loadView(); };
  function openDay(date) {
    view = 'day'; dayDate = new Date(date.getFullYear(), date.getMonth(), date.getDate()); loadView();
    var hero = document.querySelector('.tm-hero'); if (hero && hero.getBoundingClientRect().top < 0) hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function loadView() {
    $('viewDay').setAttribute('aria-pressed', view === 'day' ? 'true' : 'false');
    $('viewWeek').setAttribute('aria-pressed', view === 'week' ? 'true' : 'false');
    $('viewMonth').setAttribute('aria-pressed', view === 'month' ? 'true' : 'false');
    var unit = view === 'month' ? 'month' : view === 'day' ? 'day' : 'week';
    $('thisWeek').textContent = view === 'month' ? 'This month' : view === 'day' ? 'Today' : 'This week';
    $('prevWeek').setAttribute('aria-label', 'Previous ' + unit);
    $('nextWeek').setAttribute('aria-label', 'Next ' + unit);
    $('teamH').textContent = view === 'month' ? 'Month at a glance' : view === 'day' ? 'The day at a glance' : 'Who\u2019s working';
    document.querySelector('.tm-main').setAttribute('data-view', view);
    if (view === 'month') loadMonth(); else if (view === 'day') loadDay(); else loadWeek();
  }
  function myOffOn(date) {
    var d = iso(date), hit = null;
    myOff.forEach(function (t) { if (t.start_date <= d && t.end_date >= d && t.status !== 'denied') { if (!hit || t.status === 'approved') hit = t; } });
    return hit;
  }
  function offText(t) { return t.all_day === false && t.start_time ? fmtT(t.start_time) + '\u2013' + fmtT(t.end_time || 'close') : 'All day'; }
  function loadWeek() {
    $('weekTitle').textContent = 'Week of ' + weekLabel(week);
    $('thisWeek').disabled = iso(week) === iso(monday(new Date()));
    $('myShifts').innerHTML = ''; $('teamDays').innerHTML = '';
    $('myShifts').appendChild(h('p', { cls: 'tm-empty', text: 'Loading…' }));
    var asked = iso(week);
    sb.rpc('team_schedule', { p_week: asked }).then(function (r) {
      if (asked !== iso(week)) return;
      $('myShifts').innerHTML = '';
      if (r.error) { $('myShifts').appendChild(h('p', { cls: 'tm-empty', text: 'Couldn’t load the schedule. Check your connection and reload.' })); return; }
      var w = r.data || {};
      if (!w.published) {
        $('myShifts').appendChild(h('p', { cls: 'tm-empty', text: 'This week’s schedule hasn’t been posted yet.' }));
        return;
      }
      renderMine(w.shifts || []); renderTeam(w.shifts || []); renderMyWeekOff();
    });
  }
  function renderMyWeekOff() {
    var lines = [];
    for (var d = 0; d < 7; d++) { var t = myOffOn(addDays(week, d)); if (t && t.status === 'approved') lines.push(DAYS[d] + ' ' + md(addDays(week, d)) + ' (' + offText(t) + ')'); }
    if (lines.length) $('myShifts').appendChild(h('p', { cls: 'tm-offnote', text: 'Approved time off: ' + lines.join(', ') }));
  }

  /* ---------- month ---------- */
  function loadMonth() {
    var first = month, last = new Date(month.getFullYear(), month.getMonth() + 1, 0), asked = iso(month);
    $('weekTitle').textContent = month.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
    $('thisWeek').disabled = iso(month) === iso(firstOfMonth(new Date()));
    $('myShifts').innerHTML = ''; $('teamDays').innerHTML = '';
    $('myShifts').appendChild(h('p', { cls: 'tm-empty', text: 'Loading\u2026' }));
    var mondays = []; for (var m = monday(first); m <= last; m = addDays(m, 7)) mondays.push(new Date(m));
    Promise.all(mondays.map(function (wk) { return sb.rpc('team_schedule', { p_week: iso(wk) }).then(function (r) { return { wk: wk, data: r.error ? null : r.data }; }); })).then(function (res) {
      if (asked !== iso(month)) return;
      monthData = { weeks: res, first: first, last: last }; renderMonth();
    });
  }
  function dayShifts(date) {
    if (!monthData) return null;
    var mon = iso(monday(date)), di = (date.getDay() + 6) % 7, wk = null;
    monthData.weeks.forEach(function (w) { if (iso(w.wk) === mon) wk = w.data; });
    if (!wk || !wk.published) return null;
    return (wk.shifts || []).filter(function (s) { return s.day === di; }).sort(function (a, b) { return mins(a.start) - mins(b.start) || a.name.localeCompare(b.name); });
  }
  function renderMonth() {
    var box = $('myShifts'); box.innerHTML = '';
    var mine = [], total = 0, close = 0, today = iso(new Date());
    for (var d = new Date(monthData.first); d <= monthData.last; d = addDays(d, 1)) {
      (dayShifts(d) || []).forEach(function (s) { if (s.mine) { var hrs = hours(s); if (hrs != null) total += hrs; if (isApprox(s)) close++; mine.push({ date: new Date(d), s: s }); } });
    }
    if (!mine.length) box.appendChild(h('p', { cls: 'tm-empty', text: 'No posted shifts for you this month yet.' }));
    else {
      var ul = h('div', { cls: 'tm-mlist' });
      mine.forEach(function (x) {
        ul.appendChild(h('div', { cls: 'tm-mrow' + (iso(x.date) === today ? ' today' : '') }, [
          h('span', { cls: 'tm-md', text: x.date.toLocaleDateString(undefined, { weekday: 'short', month: 'numeric', day: 'numeric' }) }),
          h('b', { text: fmtT(x.s.start) + ' \u2013 ' + fmtT(x.s.end) }), h('span', { text: x.s.role || '' })
        ]));
      });
      box.appendChild(ul);
      box.appendChild(h('p', { cls: 'tm-total', text: mine.length + ' shift' + (mine.length === 1 ? '' : 's') + ' \u00b7 ' + (close ? 'about ' : '') + (Math.round(total * 4) / 4) + ' hours' }));
    }
    var cal = h('div', { cls: 'tm-cal' }), team = $('teamDays'); team.innerHTML = '';
    DAYS.forEach(function (dn) { cal.appendChild(h('div', { cls: 'tm-cal-h', text: dn.slice(0, 2) })); });
    var start = monday(monthData.first), end = addDays(monday(monthData.last), 6);
    for (var c = new Date(start); c <= end; c = addDays(c, 1)) {
      (function (date) {
        var list = dayShifts(date), my = (list || []).filter(function (s) { return s.mine; }), off = myOffOn(date);
        var cell = h('button', { type: 'button', cls: 'tm-cal-d' + (date.getMonth() !== monthData.first.getMonth() ? ' out' : '') + (iso(date) === today ? ' today' : '') + (pickedDay === iso(date) ? ' picked' : '') + (list ? '' : ' unposted'),
          'aria-label': date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + (list ? ', ' + list.length + ' working' : '') + '. Open the day view',
          on: { click: function () { pickedDay = iso(date); openDay(date); } } }, [
          h('span', { cls: 'tm-cal-n', text: String(date.getDate()) }),
          my.length ? h('span', { cls: 'tm-cal-me', text: fmtT(my[0].start) }) : null,
          off ? h('span', { cls: 'tm-cal-off' + (off.status === 'pending' ? ' pending' : ''), text: off.status === 'pending' ? 'Req. off' : 'Off' }) : null,
          list && list.length ? h('span', { cls: 'tm-cal-names' }, uniqNames(list).slice(0, 5).map(function (n) { return h('span', { cls: 'tm-cal-nm' + (n.mine ? ' mine' : ''), text: n.name }); })
            .concat(uniqNames(list).length > 5 ? [h('span', { cls: 'tm-cal-more', text: '+' + (uniqNames(list).length - 5) + ' more' })] : [])) : null,
          list && list.length ? h('span', { cls: 'tm-cal-c', text: list.length + ' on' }) : null
        ]);
        cal.appendChild(cell);
      })(new Date(c));
    }
    team.appendChild(cal);
    team.appendChild(h('p', { cls: 'tm-total', text: 'Tap a day to open its timeline. Your shifts are highlighted; grey days haven\u2019t been posted yet.' }));
  }

  /* ---------- day: everyone's hours on a horizontal timeline ---------- */
  function uniqNames(list) { var seen = {}, out = []; list.forEach(function (s) { if (!seen[s.name]) { seen[s.name] = 1; out.push({ name: s.name, mine: s.mine }); } else if (s.mine) out.forEach(function (o) { if (o.name === s.name) o.mine = true; }); }); return out; }
  function endMin(s) { if (ENDS[s.end]) return mins(ENDS[s.end].at); var e = mins(s.end); if (s.end && e <= mins(s.start)) e += 1440; return e; }
  function clock(m) { m = ((m % 1440) + 1440) % 1440; var H = Math.floor(m / 60), M = m % 60; return (H % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H >= 12 ? 'p' : 'a'); }
  function loadDay() {
    var d = dayDate, asked = iso(d);
    $('weekTitle').textContent = d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    $('thisWeek').disabled = asked === iso(new Date());
    $('myShifts').innerHTML = ''; $('teamDays').innerHTML = '';
    $('myShifts').appendChild(h('p', { cls: 'tm-empty', text: 'Loading…' }));
    sb.rpc('team_schedule', { p_week: iso(monday(d)) }).then(function (r) {
      if (asked !== iso(dayDate) || view !== 'day') return;
      $('myShifts').innerHTML = '';
      if (r.error) { $('myShifts').appendChild(h('p', { cls: 'tm-empty', text: 'Couldn’t load the schedule. Check your connection and reload.' })); return; }
      var w = r.data || {};
      if (!w.published) { $('myShifts').appendChild(h('p', { cls: 'tm-empty', text: 'The schedule for this week hasn’t been posted yet.' })); return; }
      var di = (d.getDay() + 6) % 7;
      var list = (w.shifts || []).filter(function (s) { return s.day === di; }).sort(function (a, b) { return mins(a.start) - mins(b.start) || endMin(a) - endMin(b) || a.name.localeCompare(b.name); });
      renderDayMine(list); renderTimeline(list);
    });
  }
  function renderDayMine(list) {
    var box = $('myShifts'), mine = list.filter(function (s) { return s.mine; }), off = myOffOn(dayDate);
    if (!mine.length) box.appendChild(h('p', { cls: 'tm-empty', text: me && me.employee ? 'You’re not working this day.' : 'Managers without an employee profile don’t have shifts here.' }));
    else {
      var grid = h('div', { cls: 'tm-mine' });
      mine.forEach(function (s) {
        var hrs = hours(s);
        grid.appendChild(h('div', { cls: 'tm-shift' + (iso(dayDate) === iso(new Date()) ? ' today' : '') }, [
          h('div', { cls: 'tm-day' }, [h('span', { text: DAYS[(dayDate.getDay() + 6) % 7] }), h('b', { text: md(dayDate) })]),
          h('div', { cls: 'tm-time' }, [h('b', { text: fmtT(s.start) + ' – ' + fmtT(s.end) }), s.role ? h('span', { text: s.role }) : null, s.note ? h('em', { text: s.note }) : null]),
          hrs != null ? h('span', { cls: 'tm-today', text: (isApprox(s) ? 'about ' : '') + (Math.round(hrs * 4) / 4) + ' hrs' }) : null
        ]));
      });
      box.appendChild(grid);
    }
    if (off && off.status === 'approved') box.appendChild(h('p', { cls: 'tm-offnote', text: 'Approved time off: ' + offText(off) }));
  }
  function renderTimeline(list) {
    var box = $('teamDays');
    if (!list.length) { box.appendChild(h('p', { cls: 'tm-empty', text: 'Nobody is scheduled this day.' })); return; }
    var lo = Infinity, hi = -Infinity;
    list.forEach(function (s) { var a = mins(s.start), b = endMin(s); if (b <= a) b = a + 60; lo = Math.min(lo, a); hi = Math.max(hi, b); });
    lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
    if (hi - lo < 6 * 60) { hi = Math.min(lo + 6 * 60, 30 * 60); }
    var span = hi - lo, hoursN = span / 60;
    var pct = function (m) { return ((m - lo) / span * 100) + '%'; };
    var tl = h('div', { cls: 'tm-tl', style: '--hours:' + hoursN });
    // hour ruler
    var ruler = h('div', { cls: 'tm-tl-ruler' }, [h('div', { cls: 'tm-tl-who' }, h('span', { text: list.length + ' shift' + (list.length === 1 ? '' : 's') }))]);
    var scale = h('div', { cls: 'tm-tl-scale' });
    for (var m = lo; m <= hi; m += 60) scale.appendChild(h('span', { cls: 'tm-tl-tick', style: 'left:' + pct(m), text: clock(m) }));
    ruler.appendChild(scale); tl.appendChild(ruler);
    var nowM = null, now = new Date();
    if (iso(now) === iso(dayDate)) { nowM = now.getHours() * 60 + now.getMinutes(); if (nowM < lo || nowM > hi) nowM = null; }
    var lastPos = null;
    list.forEach(function (s) {
      var a = mins(s.start), b = endMin(s), approx = isApprox(s), hrs = hours(s);
      if (b <= a) b = a + 60;
      var pos = s.role || s.position || '';
      var row = h('div', { cls: 'tm-tl-row' + (s.mine ? ' mine' : '') }, [
        h('div', { cls: 'tm-tl-who' }, [h('b', { text: s.name }), h('span', { text: [pos, hrs != null ? (approx ? '~' : '') + (Math.round(hrs * 4) / 4) + 'h' : ''].filter(Boolean).join(' · ') })]),
        h('div', { cls: 'tm-tl-lane' }, [
          h('div', { cls: 'tm-tl-bar' + (approx ? ' approx' : ''), style: 'left:' + pct(a) + ';width:calc(' + pct(b) + ' - ' + pct(a) + ')', title: s.name + ': ' + fmtT(s.start) + '–' + fmtT(s.end) + (approx ? ' (about ' + clock(b) + ')' : '') + (s.note ? ' · ' + s.note : '') },
            [h('span', { text: fmtT(s.start) + '–' + fmtT(s.end) + (s.note ? ' · ' + s.note : '') })])
        ])
      ]);
      tl.appendChild(row); lastPos = pos;
    });
    var lanes = h('div', { cls: 'tm-tl-grid', 'aria-hidden': 'true' });
    for (var g = lo; g <= hi; g += 60) lanes.appendChild(h('i', { style: 'left:' + pct(g) }));
    if (nowM != null) lanes.appendChild(h('b', { cls: 'tm-tl-now', style: 'left:' + pct(nowM), title: 'Now' }));
    tl.appendChild(lanes);
    var first = list[0], lastOut = list.reduce(function (x, s) { return endMin(s) > endMin(x) ? s : x; }, list[0]);
    box.appendChild(h('p', { cls: 'tm-tl-sum', text: uniqNames(list).length + ' working · first in ' + fmtT(first.start) + ' · last out ' + fmtT(lastOut.end) + (isApprox(lastOut) ? ' (about ' + clock(endMin(lastOut)) + ')' : '') }));
    box.appendChild(h('div', { cls: 'tm-tl-scroll' }, tl));
    box.appendChild(h('p', { cls: 'tm-total', text: 'Shifts ending at 1st cut, 2nd cut or close are drawn to about 8pm, 9pm and 10pm, with a faded end.' }));
  }

  /* ---------- time off ---------- */
  var toForm = $('toForm');
  toForm.from.value = iso(addDays(new Date(), 14)); toForm.to.value = toForm.from.value;
  toForm.from.addEventListener('change', function () { if (!toForm.to.value || toForm.to.value < toForm.from.value) toForm.to.value = toForm.from.value; });
  toForm.allday.addEventListener('change', function () { $('toTimes').hidden = toForm.allday.checked; });
  function loadMyOff() {
    if (!me || !me.employee) { myOff = []; return Promise.resolve(); }
    return sb.from('time_off').select('*').eq('emp', me.employee.id).order('start_date', { ascending: false }).limit(60).then(function (r) {
      if (r.error) { myOff = []; if (/time_off|does not exist|could not find/i.test(r.error.message || '')) $('timeoffSec').hidden = true; return; }
      myOff = r.data || []; renderMyOff();
    }, function () { myOff = []; });
  }
  function renderMyOff() {
    var ul = $('toList'); ul.innerHTML = '';
    if (!myOff.length) { ul.appendChild(h('li', { cls: 'tm-empty', text: 'No time-off requests yet.' })); return; }
    myOff.forEach(function (t) {
      var cancel = t.status === 'pending' ? h('button', { type: 'button', cls: 'tm-del', text: 'Cancel request' }) : null;
      if (cancel) cancel.addEventListener('click', function () {
        if (!cancel.dataset.armed) { cancel.dataset.armed = '1'; cancel.textContent = 'Tap again to cancel'; setTimeout(function () { if (cancel.isConnected) { delete cancel.dataset.armed; cancel.textContent = 'Cancel request'; } }, 3000); return; }
        sb.from('time_off').delete().eq('id', t.id).then(function (r) { if (r.error) { $('toMsg').textContent = 'Couldn\u2019t cancel. Try again.'; return; } loadMyOff().then(loadView); });
      });
      ul.appendChild(h('li', { cls: 'tm-req ' + t.status }, [
        h('div', { cls: 'tm-req-h' }, [h('b', { text: t.start_date === t.end_date ? dayLabel(t.start_date) : dayLabel(t.start_date) + ' \u2013 ' + dayLabel(t.end_date) }),
          h('span', { cls: 'tm-pill ' + t.status, text: t.status === 'pending' ? 'Waiting for approval' : t.status === 'approved' ? 'Approved' : 'Not approved' }), cancel]),
        h('p', { text: offText(t) + (t.reason ? ' \u00b7 ' + t.reason : '') }),
        t.decision_note ? h('p', { cls: 'tm-req-note', text: 'Manager note: ' + t.decision_note }) : null
      ]));
    });
  }
  toForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var f = toForm, msgEl = $('toMsg');
    if (!f.from.value || !f.to.value) { msgEl.textContent = 'Choose the dates.'; return; }
    if (f.to.value < f.from.value) { msgEl.textContent = 'The \u201cThrough\u201d date is before the \u201cFrom\u201d date.'; return; }
    if (f.to.value < iso(new Date())) { msgEl.textContent = 'Those dates have already passed.'; return; }
    if (!f.allday.checked && !f.st.value) { msgEl.textContent = 'Choose a start time, or tick All day.'; return; }
    var btn = f.querySelector('button[type=submit]'); btn.disabled = true; msgEl.textContent = 'Sending\u2026';
    sb.from('time_off').insert({ emp: me.employee.id, start_date: f.from.value, end_date: f.to.value, all_day: f.allday.checked, start_time: f.allday.checked ? '' : f.st.value, end_time: f.allday.checked ? '' : (f.et.value || ''), reason: f.reason.value.trim() }).then(function (r) {
      btn.disabled = false;
      if (r.error) { msgEl.textContent = 'Couldn\u2019t send the request. Check your connection and try again.'; return; }
      msgEl.textContent = 'Request sent. You\u2019ll see here when a manager approves it.'; f.reason.value = '';
      loadMyOff().then(loadView);
    });
  });
  function renderMine(list) {
    var mine = list.filter(function (s) { return s.mine; }).sort(function (a, b) { return a.day - b.day || mins(a.start) - mins(b.start); }), box = $('myShifts');
    if (!mine.length) { box.appendChild(h('p', { cls: 'tm-empty', text: me && me.employee ? 'You’re not on the schedule this week.' : 'Managers without an employee profile don’t have shifts here.' })); return; }
    var total = 0, close = 0, today = iso(new Date());
    var grid = h('div', { cls: 'tm-mine' });
    mine.forEach(function (s) {
      var d = addDays(week, s.day), hrs = hours(s); if (hrs != null) total += hrs; if (isApprox(s)) close++;
      grid.appendChild(h('div', { cls: 'tm-shift' + (iso(d) === today ? ' today' : '') }, [
        h('div', { cls: 'tm-day' }, [h('span', { text: DAYS[s.day] }), h('b', { text: md(d) })]),
        h('div', { cls: 'tm-time' }, [h('b', { text: fmtT(s.start) + ' – ' + fmtT(s.end) }), s.role ? h('span', { text: s.role }) : null, s.note ? h('em', { text: s.note }) : null]),
        iso(d) === today ? h('span', { cls: 'tm-today', text: 'Today' }) : null
      ]));
    });
    box.appendChild(grid);
    box.appendChild(h('p', { cls: 'tm-total', text: mine.length + ' shift' + (mine.length === 1 ? '' : 's') + ' · ' + (close ? 'about ' : '') + (Math.round(total * 4) / 4) + ' hours' }));
  }
  function renderTeam(list) {
    var box = $('teamDays'), today = iso(new Date());
    var wrap = h('div', { cls: 'tm-days' });
    for (var d = 0; d < 7; d++) {
      var day = list.filter(function (s) { return s.day === d; }).sort(function (a, b) { return mins(a.start) - mins(b.start) || a.name.localeCompare(b.name); });
      var date = addDays(week, d);
      var col = h('div', { cls: 'tm-dcol tm-dlink' + (iso(date) === today ? ' today' : ''), role: 'button', tabindex: '0', 'aria-label': DAYS_LONG[d] + ' ' + md(date) + ', ' + day.length + ' working. Open the day view' }, [h('div', { cls: 'tm-dhead' }, [h('span', { text: DAYS_LONG[d] }), h('b', { text: md(date) }), h('em', { cls: 'tm-dgo', text: day.length ? day.length + ' working · Day view →' : 'Day view →' })])]);
      (function (dt) { col.addEventListener('click', function () { openDay(dt); }); col.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openDay(dt); } }); })(date);
      if (!day.length) col.appendChild(h('p', { cls: 'tm-none', text: 'Nobody scheduled' }));
      day.forEach(function (s) {
        col.appendChild(h('div', { cls: 'tm-row' + (s.mine ? ' mine' : '') }, [
          h('span', { cls: 'tm-rt', text: fmtT(s.start) + '–' + fmtT(s.end) }),
          h('span', { cls: 'tm-rn' }, [h('b', { text: s.name }), h('span', { text: s.role || s.position || '' })])
        ]));
      });
      wrap.appendChild(col);
    }
    box.appendChild(wrap);
  }

  /* ---------- message board ---------- */
  var posts = [], body = $('postBody');
  function canDelete(p) { return (session && p.author === session.user.id) || (me && (me.role === 'owner' || me.role === 'manager')); }
  function boardMsg(t) { $('boardMsg').textContent = t || ''; }
  function loadPosts() {
    return sb.from('board_posts').select('id,author,author_name,body,created_at').order('created_at', { ascending: false }).limit(100).then(function (r) {
      if (r.error) { boardMsg(/board_posts|does not exist|could not find/i.test(r.error.message || '') ? 'The message board isn’t set up yet.' : 'Couldn’t load the message board.'); return; }
      posts = r.data || []; renderPosts();
    });
  }
  function renderPosts() {
    var ul = $('posts'); ul.innerHTML = '';
    if (!posts.length) { ul.appendChild(h('li', { cls: 'tm-empty', text: 'No notes yet. Be the first to post.' })); return; }
    posts.forEach(function (p) {
      var del = canDelete(p) ? h('button', { type: 'button', cls: 'tm-del', text: 'Delete' }) : null;
      if (del) del.addEventListener('click', function () {
        if (!del.dataset.armed) { del.dataset.armed = '1'; del.textContent = 'Confirm delete'; setTimeout(function () { if (del.isConnected) { delete del.dataset.armed; del.textContent = 'Delete'; } }, 3000); return; }
        sb.from('board_posts').delete().eq('id', p.id).then(function (r) {
          if (r.error) { boardMsg('Couldn’t delete that note.'); return; }
          posts = posts.filter(function (x) { return x.id !== p.id; }); renderPosts();
        });
      });
      ul.appendChild(h('li', { cls: 'tm-note' + (session && p.author === session.user.id ? ' mine' : '') }, [
        h('div', { cls: 'tm-note-h' }, [h('b', { text: p.author_name || 'Team member' }), h('span', { text: ago(p.created_at) }), del]),
        h('p', { text: p.body })
      ]));
    });
  }
  function startBoard() {
    loadPosts();
    sb.channel('eden-board').on('postgres_changes', { event: '*', schema: 'public', table: 'board_posts' }, function (ch) {
      if (ch.eventType === 'INSERT' && ch.new && ch.new.id) { if (!posts.some(function (p) { return p.id === ch.new.id; })) { posts.unshift(ch.new); renderPosts(); } }
      else if (ch.eventType === 'DELETE' && ch.old && ch.old.id) { posts = posts.filter(function (p) { return p.id !== ch.old.id; }); renderPosts(); }
    }).subscribe();
    setInterval(function () { renderPosts(); }, 60000); // keep "5 min ago" fresh
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && !$('app').hidden) { loadPosts(); loadMyOff().then(loadView); } });
  }
  body.addEventListener('input', function () { var n = body.value.length; $('postCount').textContent = n > 1800 ? (2000 - n) + ' characters left' : ''; });
  $('postForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var text = body.value.trim(); if (!text) { body.focus(); return; }
    var btn = this.querySelector('button'); btn.disabled = true; boardMsg('Posting…');
    sb.from('board_posts').insert({ body: text }).select('id,author,author_name,body,created_at').single().then(function (r) {
      btn.disabled = false;
      if (r.error) { boardMsg('Couldn’t post. Check your connection and try again.'); return; }
      boardMsg(''); body.value = ''; $('postCount').textContent = '';
      if (r.data && !posts.some(function (p) { return p.id === r.data.id; })) { posts.unshift(r.data); renderPosts(); }
    });
  });
  body.addEventListener('keydown', function (e) { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) $('postForm').requestSubmit(); });
})();
