/* Eden team page: each employee's published shifts, who's working, and the message board.
 *
 * Privacy: this page never reads the employees table. The schedule comes from the database
 * function team_schedule(), which returns only coworkers' names, positions and shift
 * times for published weeks. Phone numbers and emails are never sent to this page.
 * Only people on the staff list (an active employee email, or a staff role) get any data.
 */
(function () {
  'use strict';
  var CFG = window.EDEN_STAFF_CONFIG || {};
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']; // weeks run Sunday to Saturday
  var DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var ROLE_NAMES = { owner: 'Owner', manager: 'Manager', kitchen: 'Kitchen', foh: 'Front of House' };
  var $ = function (id) { return document.getElementById(id); };
  var screens = ['loading', 'signin', 'notlisted', 'newpw', 'app'];
  function show(id) { screens.forEach(function (s) { $(s).hidden = s !== id; }); }

  if (!window.supabase || !CFG.supabase || !CFG.supabase.url) { $('loadingMsg').textContent = 'Could not load. Check your internet connection and reload.'; return; }
  var sb = window.supabase.createClient(CFG.supabase.url, CFG.supabase.key);
  var me = null, session = null, started = false, week = monday(new Date()), recovering = /type=recovery/.test(location.hash), entered = null;
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
  function monday(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; } // the Sunday that starts the week
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
    var cb = form.querySelector('.tm-confirm'); if (cb && m === 'up') cb.remove();
  }
  form.querySelectorAll('.tm-switch button').forEach(function (b) { b.addEventListener('click', function () { setMode(b.dataset.mode); }); });
  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = form.email.value.trim(), pw = form.password.value;
    if (!email || !pw) { msg.textContent = 'Enter your email and password.'; return; }
    if (mode === 'up') {
      if (pw.length < 8) { msg.textContent = 'Use at least 8 characters for your password.'; return; }
      if (pw !== form.password2.value) { msg.textContent = 'The two passwords don’t match.'; return; }
      msg.textContent = 'Checking the staff list…';
      // ask first, so we can say exactly what's wrong (an older database without the check just carries on)
      sb.rpc('staff_signup_check', { p_email: email }).then(function (c) {
        var k = (c && !c.error && c.data) || null;
        if (k && !k.listed) { msg.textContent = ''; say('“' + email + '” isn’t on Eden’s staff list yet. Ask a manager to add it to your name (Schedule › Employees), check the spelling matches, then try again.'); return; }
        if (k && k.account && k.confirmed) { setMode('in'); form.email.value = email; say('You already have an account. Sign in with your password, or tap “Forgot password?” to choose a new one.'); return; }
        if (k && k.account && !k.confirmed) { checkEmail(email, true); return; }
        msg.textContent = 'Creating your account…';
        sb.auth.signUp({ email: email, password: pw, options: { emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
          if (r.error) {
            var m = r.error.message || '';
            if (/staff list|database error/i.test(m)) say('“' + email + '” isn’t on Eden’s staff list yet. Ask a manager to add it to your name, then try again.');
            else if (/already|registered|exists/i.test(m)) { setMode('in'); form.email.value = email; say('You already have an account. Sign in, or tap “Forgot password?”.'); }
            else if (/rate limit|sending|smtp|email/i.test(m)) say('The account couldn’t be created because the confirmation email couldn’t be sent right now. Try again in an hour, or ask a manager to help.');
            else if (/password/i.test(m)) say(m);
            else say('Couldn’t create the account: ' + m);
            return;
          }
          if (!r.data || !r.data.session) checkEmail(email, false);   // signed in straight away when no confirmation is needed
        });
      });
    } else {
      msg.textContent = 'Signing in…';
      sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
        if (!r.error) return;
        var m = r.error.message || '';
        if (/not confirmed/i.test(m)) checkEmail(email, true);
        else if (/rate|too many/i.test(m)) say('Too many attempts. Wait a few minutes, then try again.');
        else say('That email and password didn’t work. First time here? Choose “Create account”. Forgot it? Tap “Forgot password?”.');
      });
    }
  });
  function say(t) { msg.textContent = t; }
  // "check your email" with a button to send the confirmation again
  function checkEmail(email, again) {
    msg.textContent = '';
    var box = form.querySelector('.tm-confirm'); if (box) box.remove();
    box = h('div', { cls: 'tm-confirm', role: 'status' }, [
      h('b', { text: again ? 'Confirm your email first' : 'Almost done: check your email' }),
      h('p', { text: 'We sent a link to ' + email + '. Open it on this phone or computer to finish, then sign in. It can take a few minutes; check Spam or Promotions too.' }),
      h('button', { type: 'button', cls: 'link', text: 'Send the link again', on: { click: function () {
        var b = this; b.disabled = true; b.textContent = 'Sending…';
        sb.auth.resend({ type: 'signup', email: email, options: { emailRedirectTo: location.origin + location.pathname } }).then(function (r) {
          b.disabled = false; b.textContent = r.error ? (/rate|seconds|too many/i.test(r.error.message || '') ? 'Please wait a minute, then try again' : 'Couldn’t send it. Ask a manager to help') : 'Sent. Check your email';
        });
      } } })]);
    form.querySelector('.msg').after(box);
    setMode('in'); form.email.value = email;
  }
  document.querySelectorAll('[data-act="signout"]').forEach(function (b) { b.addEventListener('click', function () { sb.auth.signOut().then(function () { location.replace(location.pathname); }); }); });

  /* ---------- passwords: forgot (email link), change, and temporary passwords set by a manager ---------- */
  form.querySelector('[data-act="forgot"]').addEventListener('click', function () {
    var email = form.email.value.trim();
    if (!email) { msg.textContent = 'Enter your email above first, then tap Forgot password? again.'; return; }
    msg.textContent = 'Sending…';
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(function (r) {
      msg.textContent = r.error ? (/rate|too many|authorized/i.test(r.error.message || '') ? 'We couldn’t send a reset email right now. Ask a manager to set a temporary password for you.' : 'Couldn’t send the email. Try again in a minute, or ask a manager to set a temporary password.')
        : 'If that email has an account, a reset link is on its way. No email after a few minutes? Check your spam folder, or ask a manager to set a temporary password for you.';
    });
  });
  if (/^#create\b/.test(location.hash)) setMode('up');   // the staff site's "Create your account" link
  window.EdenAccount.choose(sb, $('newpw').querySelector('form'), function () { recovering = false; history.replaceState(null, '', location.pathname); enter(); });
  // the account menu (your initials, top right): name, Manager site, Change password, Sign out
  function meMenu(open) {
    var m = $('meMenu'), b = $('meBtn'); if (open == null) open = m.hidden;
    m.hidden = !open; b.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) { var f = m.querySelector('a:not([hidden]), button'); if (f) f.focus(); }
  }
  $('meBtn').addEventListener('click', function (e) { e.stopPropagation(); meMenu(); });
  document.addEventListener('click', function (e) { if (!$('meMenu').hidden && !e.target.closest('.tm-me')) meMenu(false); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !$('meMenu').hidden) { meMenu(false); $('meBtn').focus(); } });
  $('meMenu').addEventListener('click', function (e) { if (e.target.closest('.tm-mi')) meMenu(false); });
  document.querySelectorAll('[data-act="chpw"]').forEach(function (b) { b.addEventListener('click', function () { window.EdenAccount.change(sb); }); });

  sb.auth.onAuthStateChange(function (event, s) {
    session = s;
    if (event === 'PASSWORD_RECOVERY') { recovering = true; $('newpwMsg').textContent = 'Choose a new password (at least 10 characters).'; show('newpw'); return; }
    if (!s) { entered = null; show('signin'); return; }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (recovering) { show('newpw'); return; }
      if (entered && s.user && entered === s.user.id && !$('app').hidden) return;   // same person (e.g. checking their password): stay put
      enter();
    }
  });

  function enter() {
    show('loading'); $('loadingMsg').textContent = 'Loading your schedule…';
    window.EdenAccount.mustChange(sb).then(function (must) {
      if (must) { $('newpwMsg').textContent = 'A manager set a temporary password for you. Choose your own password to continue (at least 10 characters).'; show('newpw'); return; }
      enterApp();
    });
  }
  function enterApp() {
    sb.rpc('team_me').then(function (r) {
      if (r.error) { $('loadingMsg').textContent = /team_me|function/i.test(r.error.message || '') ? 'The staff page isn’t set up yet. Ask a manager.' : 'Couldn’t reach the schedule. Check your connection and reload.'; return; }
      me = r.data || {};
      if (me.role === 'hub') { location.replace('../hub/'); return; }   // the Hub's own login only opens the Hub
      if (!me.employee && !me.role) {
        $('notlistedMsg').textContent = 'You’re signed in as ' + (session.user && session.user.email) + ', but that email isn’t on Eden’s current staff list. Ask a manager if you think this is a mistake.';
        show('notlisted'); return;
      }
      var name = (me.employee && me.employee.name) || (session.user && session.user.email) || '';
      $('whoName').textContent = name;
      $('meBtn').textContent = String(name).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join('') || '•';
      $('meBtn').setAttribute('aria-label', 'Your account: ' + name);
      $('whoRole').textContent = (me.employee && me.employee.position) || ROLE_NAMES[me.role] || '';
      $('mgrLink').hidden = !(me.role === 'owner' || me.role === 'manager' || me.access === 'owner' || me.access === 'manager');
      if (me.access === 'manager' && !me.role) $('whoRole').textContent = ((me.employee && me.employee.position) || 'Manager');
      $('timeoffSec').hidden = !me.employee;
      var first = String(name).split(/[\s@]/)[0], hr = new Date().getHours();
      $('hello').textContent = (hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (first ? ', ' + first : '');
      show('app'); entered = session.user && session.user.id;
      if (!started) { started = true; startBoard(); }
      loadMyOff().then(loadView);
      loadTodos();
      loadReviews();
      // the Prep List tab: cooks, managers and the kitchen (supabase/prep-list.sql)
      sb.rpc('can_prep').then(function (x) {
        canPrep = !!(x && !x.error && x.data); $('tabPrep').hidden = !canPrep;
        // cooks (and Kitchen logins): Prep List and Recipes come first, and the page opens on the Prep List
        var mgr = me.role === 'owner' || me.role === 'manager' || me.access === 'owner' || me.access === 'manager';
        if (canPrep && !mgr) {
          var nav = $('tabPrep').parentNode; nav.insertBefore($('tabRecipes'), nav.firstChild); nav.insertBefore($('tabPrep'), nav.firstChild);
          document.body.classList.add('is-cook');
          // a cook's to-dos sit at the top of the Prep List tab (instead of on the Schedule page)
          $('prepTodos').appendChild($('todoSec'));
          if (!location.hash && !opened) { history.replaceState(null, '', location.pathname + '#prep'); }
        }
        // Team > Employees > Permissions: hide what this person's sections don't include (the database enforces it too)
        return sb.rpc('my_sections').then(function (y) { SEC = y && !y.error && y.data && !y.data.error ? y.data : null; applySections(); }, function () {});
      }, function () {}).then(function () {
        opened = true;
        page();
      });
      page();
    });
  }

  /* ---------- your to-dos (given to you by the Owner or a manager) ---------- */
  var todos = [], canPrep = false, opened = false, SEC = null;
  var TAB_PG = { tabSched: 'sched', tabPreshift: 'preshift', tabResources: 'resources', tabPrep: 'prep', tabOrders: 'orders', tabRecipes: 'recipes', tabCalendar: 'calendar', tabBeos: 'beos', tabEod: 'eod' };
  function applySections() {
    if (!SEC) return;
    var off = function (k) { return SEC[k] === false; };
    $('tabPreshift').hidden = off('preshift'); $('tabResources').hidden = off('resources');
    $('tabRecipes').hidden = off('recipes'); $('tabCalendar').hidden = off('calendar'); $('tabBeos').hidden = off('calendar');   // BEOs go with the Calendar permission
    $('tabEod').hidden = SEC.eod !== true;   // End of day report: off unless the Owner turns it on
    if (off('prep')) $('tabPrep').hidden = true;
    // bartenders (only the bar list): the tab says Bar Prep
    var pl = $('tabPrep').querySelector('span'); if (pl) pl.textContent = off('prep.kitchen') && !off('prep.bar') ? 'Bar Prep' : 'Prep List';
    document.querySelector('.tm-hero').hidden = off('schedule');
    document.querySelector('.tm-colmain').hidden = off('schedule');
    $('timeoffSec').hidden = !me.employee || off('timeoff');
    $('board').hidden = off('board');
    $('postForm').hidden = off('board.post');
    if (todos.length) renderTodos();   // tick boxes follow “Tick them off”
    if (off('board.post') && !$('boardRo')) $('postForm').insertAdjacentHTML('afterend', '<p class="tm-ro" id="boardRo">You can read the board, but posting is switched off for you.</p>');
    var cookTodos = $('prepTodos').contains($('todoSec'));
    $('tabSched').hidden = off('schedule') && off('timeoff') && off('board') && (cookTodos || off('todos'));
  }
  // the first page this person may open
  function firstPage() { var a = [].filter.call(document.querySelectorAll('.tm-tabs a'), function (x) { return !x.hidden; })[0]; return a ? TAB_PG[a.id] : 'sched'; }
  function loadTodos() {
    if (!me || !me.employee) { $('todoSec').hidden = true; return; }
    sb.rpc('my_todos').then(function (r) {
      if (r.error) { $('todoSec').hidden = true; return; }   // not set up yet
      todos = r.data || []; renderTodos();
    }, function () {});
  }
  setInterval(function () { if (!$('app').hidden && !document.hidden) loadTodos(); }, 120000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden && me) loadTodos(); });
  function renderTodos() {
    var ul = $('myTodos'); ul.innerHTML = '';
    var open = todos.filter(function (t) { return !t.done; }), done = todos.filter(function (t) { return t.done; });
    $('todoSec').hidden = !todos.length;
    var today = iso(new Date());
    open.concat(done).forEach(function (t) {
      var late = !t.done && t.due && t.due < today, now = !t.done && t.due === today;
      var ro = SEC && SEC['todos.done'] === false;
      var cb = h('button', { type: 'button', cls: 'tm-tick' + (t.done ? ' on' : ''), 'aria-pressed': t.done ? 'true' : 'false', 'aria-label': (t.done ? 'Done: ' : 'Mark done: ') + t.title,
        disabled: ro, title: ro ? 'Ticking off to-dos is switched off for you' : null,
        on: { click: function () { tick(t, !t.done, cb); } } });
      ul.appendChild(h('li', { cls: 'tm-todo' + (t.done ? ' done' : '') + (late ? ' late' : '') }, [cb, h('div', { cls: 'tm-todo-m' }, [
        h('b', { text: t.title }),
        t.details ? h('p', { text: t.details }) : null,
        h('span', { text: [t.due ? (late ? 'Overdue · was due ' : now ? 'Due today · ' : 'Due ') + dayLabel(t.due) : '', t.assigned_by ? 'from ' + t.assigned_by : '', t.done ? 'done' : ''].filter(Boolean).join(' · ') })])]));
    });
  }
  function tick(t, done, btn) {
    btn.disabled = true;
    sb.rpc('finish_my_todo', { p_id: t.id, p_done: done }).then(function (r) {
      btn.disabled = false;
      if (r.error || !(r.data && r.data.ok)) { $('todoMsg').textContent = 'Couldn’t save that. Try again.'; return; }
      $('todoMsg').textContent = '';
      t.done = done; t.done_at = done ? new Date().toISOString() : null; renderTodos();
    });
  }

  // the End of day report's messages (saved, not submitted yet…) show in a small bar at the bottom
  function eodSay(t, k) {
    var m = $('eodToast');
    if (!m) { m = document.createElement('p'); m.id = 'eodToast'; m.className = 'tm-toast'; m.setAttribute('role', 'status'); document.body.appendChild(m); }
    clearTimeout(m._t); m.textContent = t || ''; m.className = 'tm-toast' + (k ? ' ' + k : '') + (t ? ' on' : '');
    if (t && k !== 'err') m._t = setTimeout(function () { m.className = 'tm-toast'; }, 4000);
  }
  /* ---------- pages: Schedule (with the board) and Recipes ---------- */
  function page() {
    if ($('app').hidden || !me) return;
    var pg = location.hash === '#recipes' ? 'recipes' : location.hash === '#calendar' ? 'calendar' : location.hash === '#beos' ? 'beos' : /^#eod(\/|$)/.test(location.hash) ? 'eod' : location.hash === '#preshift' ? 'preshift' : location.hash === '#resources' ? 'resources' : location.hash === '#prep' && canPrep ? 'prep' : location.hash === '#orders' ? 'orders' : 'sched';
    // a page this person's permissions don't include: open the first one they do have
    var tabFor = { sched: 'tabSched', preshift: 'tabPreshift', resources: 'tabResources', prep: 'tabPrep', orders: 'tabOrders', recipes: 'tabRecipes', calendar: 'tabCalendar', beos: 'tabBeos', eod: 'tabEod' };
    if (pg === 'eod' && $('tabEod').hidden) pg = SEC ? firstPage() : 'sched';
    if (pg !== 'eod' && window.EdenEOD && !$('eodView').hidden) window.EdenEOD.hide();
    if (SEC && $(tabFor[pg]).hidden) { pg = firstPage(); var want = pg === 'sched' ? '' : '#' + pg; if (location.hash !== want) history.replaceState(null, '', location.pathname + want); }
    $('recipesView').hidden = pg !== 'recipes'; $('calendarView').hidden = pg !== 'calendar'; $('beosView').hidden = pg !== 'beos'; $('eodView').hidden = pg !== 'eod'; $('preshiftView').hidden = pg !== 'preshift'; $('resourcesView').hidden = pg !== 'resources'; $('prepView').hidden = pg !== 'prep'; $('ordersView').hidden = pg !== 'orders'; document.querySelector('.tm-main').hidden = pg !== 'sched';
    $('tabPreshift').setAttribute('aria-current', pg === 'preshift' ? 'page' : 'false');
    $('tabResources').setAttribute('aria-current', pg === 'resources' ? 'page' : 'false');
    $('tabPrep').setAttribute('aria-current', pg === 'prep' ? 'page' : 'false');
    $('tabOrders').setAttribute('aria-current', pg === 'orders' ? 'page' : 'false');
    $('tabSched').setAttribute('aria-current', pg === 'sched' ? 'page' : 'false');
    $('tabRecipes').setAttribute('aria-current', pg === 'recipes' ? 'page' : 'false');
    $('tabCalendar').setAttribute('aria-current', pg === 'calendar' ? 'page' : 'false');
    $('tabBeos').setAttribute('aria-current', pg === 'beos' ? 'page' : 'false');
    $('tabEod').setAttribute('aria-current', pg === 'eod' ? 'page' : 'false');
    document.title = pg === 'recipes' ? 'Recipes · Eden Team' : pg === 'calendar' ? 'Calendar · Eden Team' : pg === 'beos' ? 'BEOs · Eden Team' : pg === 'eod' ? 'End of day report · Eden Team' : pg === 'preshift' ? 'Pre-shift · Eden Team' : pg === 'resources' ? 'Resources · Eden Team' : pg === 'prep' ? 'Prep List · Eden Team' : pg === 'orders' ? 'Ordering · Eden Team' : 'Eden Team';
    var admin = me.role === 'owner' || me.role === 'manager' || me.access === 'owner' || me.access === 'manager';
    var st = function (box) { return function (t, k) { var m = box.querySelector('.rc-status'); if (m) { m.textContent = t || ''; m.className = 'rc-status' + (k ? ' ' + k : ''); } }; };
    if (pg === 'recipes' && window.EdenRecipes) window.EdenRecipes.show({ sb: sb, el: $('recipesView'), name: (me.employee && me.employee.name) || '', canEdit: admin, status: st($('recipesView')) });
    // Pre-shift: everyone on the team reads it; the Owner and managers can add and delete education PDFs here too
    if (pg === 'preshift' && window.EdenPreshift) window.EdenPreshift.show({ sb: sb, el: $('preshiftView'), status: function () {}, name: (me.employee && me.employee.name) || '', api: '../', noNotes: true, sec: SEC,
      role: me.role || (me.access === 'owner' ? 'owner' : me.access === 'manager' ? 'scheduler' : 'employee') });
    var tmRole = me.role || (me.access === 'owner' ? 'owner' : me.access === 'manager' ? 'scheduler' : 'employee');
    // cooks: no Print button or how-to text at the top of the Prep List
    if (pg === 'prep' && window.EdenPrep) window.EdenPrep.show({ sb: sb, el: $('prepBody'), status: function () {}, name: (me.employee && me.employee.name) || '', role: tmRole, cook: !admin, viewOnly: !admin && !!SEC && SEC['prep.edit'] === false });
    if (pg === 'orders' && window.EdenOrders) window.EdenOrders.show({ sb: sb, el: $('ordersView'), mode: admin ? 'admin' : 'staff' });
    if (pg === 'resources' && window.EdenResources) window.EdenResources.show({ sb: sb, el: $('resourcesView'), status: function () {}, name: (me.employee && me.employee.name) || '', role: tmRole });
    if (pg === 'eod' && window.EdenEOD) { var esub = location.hash.replace(/^#eod\/?/, ''); if (!/^(past|r\/[0-9a-f-]{36})$/.test(esub)) esub = ''; window.EdenEOD.show({ sb: sb, el: $('eodView'), status: eodSay, role: admin ? (me.role || 'manager') : 'employee', name: (me.employee && me.employee.name) || (session && session.user && session.user.email) || '', uid: session && session.user && session.user.id, sub: esub }); }
    if (pg === 'beos' && window.EdenBEOStaff) window.EdenBEOStaff.show({ sb: sb, el: $('beosView'), base: '../' });
    if (pg === 'calendar' && window.EdenCal) window.EdenCal.show({ sb: sb, el: $('calendarView'), name: (me.employee && me.employee.name) || '', canEdit: admin, status: st($('calendarView')) });
  }
  window.addEventListener('hashchange', page);
  $('tabSched').addEventListener('click', function (e) { e.preventDefault(); history.pushState(null, '', location.pathname); page(); });

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
    var mon = iso(monday(date)), di = date.getDay(), wk = null;
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
      var di = d.getDay();
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
          h('div', { cls: 'tm-day' }, [h('span', { text: DAYS[dayDate.getDay()] }), h('b', { text: md(dayDate) })]),
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
  /* ---------- your reviews (every 3 months, shared by a manager) ---------- */
  var RV_SCALE = ['', 'Needs improvement', 'Developing', 'Meets expectations', 'Exceeds expectations'];
  var RV_CATS = [['knowledge', 'Job knowledge & skills'], ['quality', 'Quality & standards'], ['guest', 'Hospitality & the guest experience'], ['team', 'Teamwork & communication'],
    ['reliability', 'Reliability'], ['initiative', 'Initiative & ownership'], ['safety', 'Food safety & sanitation'], ['professional', 'Professionalism & attitude']];
  var myRevs = [];
  function loadReviews() {
    if (!me || !me.employee) { $('reviewSec').hidden = true; return Promise.resolve(); }
    return sb.rpc('my_reviews').then(function (r) {
      if (r.error || !Array.isArray(r.data)) { $('reviewSec').hidden = true; return; }   // not set up yet
      myRevs = r.data; paintReviews();
    }, function () { $('reviewSec').hidden = true; });
  }
  function paintReviews() {
    var ul = $('myReviews'); ul.innerHTML = '';
    $('reviewSec').hidden = !myRevs.length;
    myRevs.forEach(function (rv) {
      var isNew = rv.status !== 'signed';
      ul.appendChild(h('li', { cls: 'tm-req' + (isNew ? ' tm-rev-new' : '') }, [
        h('div', null, [h('b', { text: 'Review · ' + dayLabel(rv.review_date) }), h('small', { text: (rv.reviewer ? 'With ' + rv.reviewer + ' · ' : '') + (isNew ? 'New: please read it and add your feedback' : 'Signed ' + dayLabel(String(rv.emp_signed_at || '').slice(0, 10))) })]),
        h('button', { type: 'button', cls: 'tm-btn' + (isNew ? ' primary' : ''), text: isNew ? 'Read' : 'Open', on: { click: function () { openMyReview(rv); } } })]));
    });
  }
  function openMyReview(rv) {
    var dlg = h('dialog', { cls: 'tm-revdlg', 'aria-label': 'Your review' }), signed = rv.status === 'signed', A = rv.answers || {}, R = rv.ratings || {};
    var close = function () { dlg.close(); dlg.remove(); };
    var para = function (label, text) { return text ? h('section', { cls: 'tm-rvs' }, [h('h3', { text: label }), h('p', { text: text })]) : null; };
    var rows = RV_CATS.filter(function (k) { return R[k[0]] || A['c_' + k[0]]; }).map(function (k) {
      return h('li', null, [h('div', { cls: 'tm-rvr' }, [h('b', { text: k[1] }), R[k[0]] ? h('span', { cls: 'tm-rvscore s' + R[k[0]], text: R[k[0]] + ' · ' + RV_SCALE[R[k[0]]] }) : null]), A['c_' + k[0]] ? h('p', { text: A['c_' + k[0]] }) : null]);
    });
    var prev = A.prev ? Object.keys(A.prev).map(function (i) { var g = A.prev[i]; return g && g.goal ? h('li', null, [h('b', { text: g.goal }), h('span', { text: ' · ' + ({ met: 'Met', partly: 'Partly met', not: 'Not yet' }[g.result] || '') + (g.note ? ' · ' + g.note : '') })]) : null; }).filter(Boolean) : [];
    var goals = (rv.goals || []).filter(function (g) { return g && g.goal; }).map(function (g) { return h('li', null, [h('b', { text: g.goal }), g.measure ? h('small', { text: 'How we’ll know: ' + g.measure }) : null, g.support ? h('small', { text: 'Eden’s support: ' + g.support }) : null]); });
    var ta = function (name, label, hint, val) { var t = h('textarea', { name: name, rows: 3, maxlength: 4000, disabled: signed }); t.value = val || ''; return h('label', null, [h('span', null, [label, h('span', { cls: 'tm-hint', text: hint ? ' (' + hint + ')' : '' })]), t]); };
    var form = h('form', { cls: 'tm-revform', novalidate: true }, [
      h('h3', { text: 'Your feedback' }),
      h('p', { cls: 'tm-small2', text: signed ? 'You signed this review on ' + dayLabel(String(rv.emp_signed_at || '').slice(0, 10)) + '.' : 'Your manager will read this. Be honest: it’s your side of the review.' }),
      ta('c', 'Your thoughts on this review', 'what you agree with, anything you see differently', rv.emp_comment),
      ta('s', 'What support would help you?', 'training, schedule, tools', rv.emp_support),
      ta('g', 'Your own goals for the next 3 months', 'optional', rv.emp_goals),
      signed ? null : h('label', { cls: 'tm-check' }, [h('input', { type: 'checkbox', name: 'sign' }), ' I’ve read this review. (Signing means you’ve read it, not that you agree with every point.)']),
      h('p', { cls: 'tm-msg', role: 'status' }),
      signed ? null : h('div', { cls: 'tm-revacts' }, [h('button', { type: 'submit', cls: 'tm-btn primary', text: 'Save feedback' })])
    ]);
    form.addEventListener('submit', function (ev) {
      ev.preventDefault();
      var f = form.elements, sign = f.sign && f.sign.checked, msg = form.querySelector('.tm-msg');
      if (sign && !confirm('Sign this review as read? You won’t be able to change your feedback after that.')) return;
      msg.textContent = 'Saving…';
      sb.rpc('review_respond', { p_id: rv.id, p_comment: f.c.value.trim(), p_support: f.s.value.trim(), p_goals: f.g.value.trim(), p_sign: !!sign }).then(function (r) {
        if (r.error || (r.data && r.data.error)) { msg.textContent = 'Couldn’t save. Try again.'; return; }
        msg.textContent = sign ? 'Signed. Thank you.' : 'Saved. You can come back and sign it later.';
        loadReviews().then(function () { if (sign) setTimeout(close, 900); });
      }, function () { msg.textContent = 'Couldn’t save. Check your connection.'; });
    });
    dlg.appendChild(h('div', { cls: 'tm-revin' }, [
      h('div', { cls: 'tm-revtop' }, [h('p', { cls: 'tm-eyebrow', text: 'Your review' }), h('button', { type: 'button', cls: 'tm-btn', text: 'Close', on: { click: close } })]),
      h('h2', { text: dayLabel(rv.review_date) }),
      h('p', { cls: 'tm-small2', text: [rv.position, rv.reviewer ? 'Reviewed by ' + rv.reviewer : '', rv.period_from ? 'Period ' + dayLabel(rv.period_from) + ' – ' + dayLabel(rv.period_to || rv.review_date) : ''].filter(Boolean).join(' · ') }),
      rv.overall ? h('p', { cls: 'tm-rvoverall' }, ['Overall: ', h('b', { text: RV_SCALE[rv.overall] })]) : null,
      para('Summary', A.summary),
      rows.length ? h('section', { cls: 'tm-rvs' }, [h('h3', { text: 'Ratings' }), h('p', { cls: 'tm-small2', text: '1 Needs improvement · 2 Developing · 3 Meets expectations · 4 Exceeds expectations' }), h('ul', { cls: 'tm-rvlist' }, rows)]) : null,
      A.attend && (A.attend.shifts || A.attend.extra) ? h('section', { cls: 'tm-rvs' }, [h('h3', { text: 'Attendance & punctuality' }),
        h('p', { text: [A.attend.pct != null ? A.attend.pct + '% of shifts on time (clocked in within 5 minutes of the scheduled start)' : '', A.attend.worked + ' of ' + A.attend.shifts + ' scheduled shifts worked',
          A.attend.late ? A.attend.late + ' late, ' + A.attend.avgLate + ' minutes on average' : 'never late', A.attend.missed ? A.attend.missed + ' scheduled with no clock-in' : ''].filter(Boolean).join('\n') }),
        h('p', { cls: 'tm-small2', text: 'From the schedule and your Square clock-ins, ' + dayLabel(A.attend.from) + ' – ' + dayLabel(A.attend.to) + '.' })]) : null,
      para('Strengths', A.strengths), para('Areas to grow', A.growth),
      prev.length ? h('section', { cls: 'tm-rvs' }, [h('h3', { text: 'Goals from your last review' }), h('ul', { cls: 'tm-rvlist' }, prev)]) : null,
      goals.length ? h('section', { cls: 'tm-rvs' }, [h('h3', { text: 'Goals for the next 3 months' }), h('ul', { cls: 'tm-rvlist' }, goals)]) : null,
      para('Training & support', A.training),
      form]));
    document.body.appendChild(dlg);
    dlg.addEventListener('cancel', function () { dlg.remove(); });
    try { dlg.showModal(); } catch (e) { dlg.setAttribute('open', ''); }
  }

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
      setTimeout(function () { var fold = $('toFold'); if (fold) fold.open = false; msgEl.textContent = ''; }, 2500);
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
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && !$('app').hidden) { loadPosts(); loadMyOff().then(loadView); loadReviews(); } });
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
