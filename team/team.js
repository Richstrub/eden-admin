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
  function monday(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - (x.getDay() + 6) % 7); return x; }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function weekLabel(d) {
    var e = addDays(d, 6);
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + (d.getMonth() === e.getMonth() ? e.getDate() : e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  }
  function fmtT(t) {
    if (t === 'close') return 'close';
    var p = String(t || '').split(':'), H = +p[0], M = +p[1] || 0; if (isNaN(H)) return '';
    return (H % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H >= 12 ? 'p' : 'a');
  }
  function mins(t) { var p = String(t || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function hours(s) { if (s.end === 'close' || !s.start || !s.end) return null; var d = mins(s.end) - mins(s.start); if (d <= 0) d += 1440; return d / 60; }
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
          msg.textContent = /staff list|database error/i.test(m) ? 'That email isn’t on Eden’s staff list yet. Ask a manager to add it, then try again.'
            : /already|registered|exists/i.test(m) ? 'There’s already an account for that email. Choose Sign in instead.'
            : /password/i.test(m) ? m : 'Couldn’t create the account: ' + m;
          return;
        }
        if (!r.data || !r.data.session) { msg.textContent = 'Account created. Check your email to confirm it, then sign in.'; setMode('in'); }
      });
    } else {
      msg.textContent = 'Signing in…';
      sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
        if (r.error) msg.textContent = /rate|too many/i.test(r.error.message || '') ? 'Too many attempts. Try again in a few minutes.' : 'That email and password didn’t work. New here? Choose Create account.';
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
      $('mgrLink').hidden = !(me.role === 'owner' || me.role === 'manager');
      var first = String(name).split(/[\s@]/)[0], hr = new Date().getHours();
      $('hello').textContent = (hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (first ? ', ' + first : '');
      show('app');
      if (!started) { started = true; startBoard(); }
      loadWeek();
    });
  }

  /* ---------- schedule ---------- */
  $('prevWeek').onclick = function () { week = addDays(week, -7); loadWeek(); };
  $('nextWeek').onclick = function () { week = addDays(week, 7); loadWeek(); };
  $('thisWeek').onclick = function () { week = monday(new Date()); loadWeek(); };
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
      renderMine(w.shifts || []); renderTeam(w.shifts || []);
    });
  }
  function renderMine(list) {
    var mine = list.filter(function (s) { return s.mine; }).sort(function (a, b) { return a.day - b.day || mins(a.start) - mins(b.start); }), box = $('myShifts');
    if (!mine.length) { box.appendChild(h('p', { cls: 'tm-empty', text: me && me.employee ? 'You’re not on the schedule this week.' : 'Managers without an employee profile don’t have shifts here.' })); return; }
    var total = 0, close = 0, today = iso(new Date());
    var grid = h('div', { cls: 'tm-mine' });
    mine.forEach(function (s) {
      var d = addDays(week, s.day), hrs = hours(s); if (hrs == null) close++; else total += hrs;
      grid.appendChild(h('div', { cls: 'tm-shift' + (iso(d) === today ? ' today' : '') }, [
        h('div', { cls: 'tm-day' }, [h('span', { text: DAYS[s.day] }), h('b', { text: md(d) })]),
        h('div', { cls: 'tm-time' }, [h('b', { text: fmtT(s.start) + ' – ' + fmtT(s.end) }), s.role ? h('span', { text: s.role }) : null, s.note ? h('em', { text: s.note }) : null]),
        iso(d) === today ? h('span', { cls: 'tm-today', text: 'Today' }) : null
      ]));
    });
    box.appendChild(grid);
    box.appendChild(h('p', { cls: 'tm-total', text: mine.length + ' shift' + (mine.length === 1 ? '' : 's') + ' · ' + (Math.round(total * 4) / 4) + ' hours' + (close ? ' + ' + close + ' until close' : '') }));
  }
  function renderTeam(list) {
    var box = $('teamDays'), today = iso(new Date());
    var wrap = h('div', { cls: 'tm-days' });
    for (var d = 0; d < 7; d++) {
      var day = list.filter(function (s) { return s.day === d; }).sort(function (a, b) { return mins(a.start) - mins(b.start) || a.name.localeCompare(b.name); });
      var date = addDays(week, d);
      var col = h('div', { cls: 'tm-dcol' + (iso(date) === today ? ' today' : '') }, [h('div', { cls: 'tm-dhead' }, [h('span', { text: DAYS_LONG[d] }), h('b', { text: md(date) })])]);
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
    document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'visible' && !$('app').hidden) { loadPosts(); loadWeek(); } });
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
