/* Eden staff site.
 *
 * Sign-in is Supabase email + password. What each person may do is enforced by the
 * database (see supabase/schema.sql), using their role in the staff table:
 *   owner, manager, kitchen  can edit the menu and Supper Club page
 *   foh                      can view
 * The page only mirrors those rules so people see "view only" instead of errors.
 *
 * Website content lives in the site_docs table, one row per document:
 *   site/menu               { version, allergy, updatedAt, tabs:[{ id, label, gids }] }
 *   site/menu/groups/{gid}  { title, note, noteAfter, items:[...] }   one per menu section
 *   site/supper             the Supper Club page
 * The public website reads the same rows and updates live.
 */
(function () {
  'use strict';
  var CFG = window.EDEN_STAFF_CONFIG || {};
  var EDIT_ROLES = ['owner', 'manager', 'kitchen'];
  var ROLE_NAMES = { owner: 'Owner', manager: 'Manager', kitchen: 'Kitchen', foh: 'Front of House', scheduler: 'Manager' };
  var $ = function (id) { return document.getElementById(id); };
  var screens = ['loading', 'signin', 'newpw', 'noaccess', 'app'];
  function show(id) { screens.forEach(function (s) { $(s).hidden = s !== id; }); }
  function clone(o) { return o == null ? o : JSON.parse(JSON.stringify(o)); }

  if (!window.supabase || !CFG.supabase || !CFG.supabase.url) {
    $('loadingMsg').textContent = 'Could not load the sign-in service. Check your internet connection and reload.';
    return;
  }
  var sb = window.supabase.createClient(CFG.supabase.url, CFG.supabase.key);
  if (CFG.publicSite) $('viewSite').href = CFG.publicSite; else $('viewSite').hidden = true;

  /* ---------------- sign-in ---------------- */
  var session = null, role = null, started = false, recovering = /type=recovery/.test(location.hash);

  var signinForm = $('signin').querySelector('form'), signinMsg = signinForm.querySelector('.msg');
  signinForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var email = signinForm.email.value.trim(), pw = signinForm.password.value;
    if (!email || !pw) { signinMsg.textContent = 'Enter your email and password.'; return; }
    signinMsg.textContent = 'Signing in…';
    sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
      if (r.error) {
        signinMsg.textContent = /rate|too many/i.test(r.error.message || '') ? 'Too many attempts. Try again in a few minutes.' : /not confirmed/i.test(r.error.message || '') ? 'This account still needs its confirmation email. Ask a manager to switch it on (Schedule › Employees).' : 'That email and password did not work. New to the team? Use the link below to create your account.';
        return;
      }
      signinForm.password.value = ''; signinMsg.textContent = '';
    });
  });
  signinForm.querySelector('[data-act="reset"]').addEventListener('click', function () {
    var email = signinForm.email.value.trim();
    if (!email) { signinMsg.textContent = 'Enter your email above first.'; return; }
    signinMsg.textContent = 'Sending…';
    sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname }).then(function (r) {
      signinMsg.textContent = r.error ? 'Could not send the email. Try again in a minute.' : 'If that address has a staff account, a reset link is on its way.';
    });
  });

  // choosing a new password: after a "Forgot password?" email link, or a temporary password a manager set
  var pwForm = $('newpw').querySelector('form'), mustChange = false;
  window.EdenAccount.choose(sb, pwForm, function () {
    recovering = false; mustChange = false; history.replaceState(null, '', location.pathname); enter();
  });
  document.querySelectorAll('[data-act="chpw"]').forEach(function (b) { b.addEventListener('click', function () { window.EdenAccount.change(sb); }); });

  document.querySelectorAll('[data-act="signout"]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (ed.dirty) { save(); }
      sb.auth.signOut().then(function () { location.replace(location.pathname); });
    });
  });

  sb.auth.onAuthStateChange(function (event, s) {
    session = s;
    if (event === 'PASSWORD_RECOVERY') { recovering = true; $('newpwMsg').textContent = 'Choose a new password (at least 10 characters).'; show('newpw'); return; }
    if (event === 'SIGNED_OUT' || !s) { role = null; entered = null; show('signin'); return; }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (recovering) { show('newpw'); return; }
      if (entered && s.user && entered === s.user.id && !$('app').hidden) return;   // same person (e.g. checking their password): stay put
      enter();
    }
  });

  var entered = null;
  function enter() {
    if (!session) { show('signin'); return; }
    show('loading'); $('loadingMsg').textContent = 'Checking your access…';
    window.EdenAccount.mustChange(sb).then(function (must) {
      if (must) { mustChange = true; $('newpwMsg').textContent = 'A manager set a temporary password for you. Choose your own password to continue (at least 10 characters).'; show('newpw'); return; }
      enterApp();
    });
  }
  function enterApp() {
    sb.rpc('staff_role').then(function (r) {
      if (r.error) { $('loadingMsg').textContent = 'Could not reach the database. Check your connection and reload.'; return; }
      role = r.data || null;
      if (role === 'hub') { location.replace('hub/'); return; }   // the Hub's own login only opens the Hub
      var email = session.user && session.user.email;
      // no staff role: an employee whose access level is Manager can still use the Schedule
      var tier = role ? Promise.resolve(null) : sb.rpc('team_me').then(function (t) { return t && !t.error ? t.data : null; }, function () { return null; });
      return tier.then(function (me) {
      if (!role && me && me.access === 'manager') role = 'scheduler';
      if (!role) {
        $('noaccessMsg').textContent = 'You are signed in as ' + email + '. This is the managers\u2019 site. Your schedule and the team message board are on the staff schedule page.';
        show('noaccess'); return;
      }
      var nameP = role === 'scheduler' ? Promise.resolve({ data: { name: me.employee && me.employee.name } })
        : sb.from('staff').select('name').eq('user_id', session.user.id).maybeSingle();
      return nameP.then(function (n) {
        var name = (n && n.data && n.data.name) || email;
        $('who').innerHTML = '';
        var b = document.createElement('b'); b.textContent = name; $('who').appendChild(b);
        $('who').appendChild(document.createTextNode(ROLE_NAMES[role] || role));
        $('whoAv').textContent = String(name).split(/[\s@]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0]; }).join('').toUpperCase();
        ed.canWrite = EDIT_ROLES.indexOf(role) !== -1;
        staffName = name;
        document.querySelectorAll('[data-mgr]').forEach(function (el) { el.hidden = !isMgr(); });
        document.querySelectorAll('[data-menu]').forEach(function (el) { el.hidden = role === 'scheduler'; });
        document.querySelectorAll('[data-prep]').forEach(function (el) { el.hidden = !canPrep(); });
        document.querySelectorAll('[data-owner]').forEach(function (el) { el.hidden = role !== 'owner'; });
        document.querySelectorAll('[data-mailer]').forEach(function (el) { el.hidden = !canMail(); });
        // a menu group with nothing this person can open is left out
        document.querySelectorAll('.sb-group').forEach(function (g) { if (!g.hasAttribute('data-owner')) g.hidden = ![].some.call(g.querySelectorAll('a'), function (a) { return !a.hidden; }); });
        show('app'); entered = session.user.id;
        if (window.EdenNotes) window.EdenNotes.init({ sb: sb, status: status, name: name, canCal: isMgr(), canShare: isMgr(), canMail: canMail(), canRecipes: isMgr(), isOwner: role === 'owner' });
        if (!started) { started = true; if (role !== 'scheduler') startData(); }
        loadSections().then(route);
        refreshToday();
        mailCounts();
      });
      });
    });
  }

  /* ---------------- pages: Home, Menu, Schedule ---------------- */
  var VIEWS = { home: 'viewHome', menu: 'viewMenu', schedule: 'viewSchedule', prep: 'viewPrep', inventory: 'viewInventory', todo: 'viewTodo', recipes: 'viewRecipes', calendar: 'viewCalendar', analytics: 'viewAnalytics', catering: 'viewCatering', payroll: 'viewPayroll', preshift: 'viewPreshift', resources: 'viewResources', orders: 'viewOrders', checklists: 'viewChecklists', eod: 'viewEod', email: 'viewEmail', promo: 'viewPromo', employees: 'viewEmployees', partners: 'viewPartners' };
  // where each page sits in the menu (shown at the top of the page) and its browser-tab title
  var PAGES = { home: ['', 'Today'], preshift: ['Service', 'Pre-shift meeting'], resources: ['Service', 'Resources'], checklists: ['Service', 'Checklists'], orders: ['Kitchen & bar', 'Ordering'], eod: ['Office', 'End of day report'], menu: ['Front of house', 'Menu & Supper Club'],
    calendar: ['Front of house', 'Calendar'], catering: ['Front of house', 'Catering & BEOs'], prep: ['Kitchen & bar', 'Prep List'], inventory: ['Kitchen & bar', 'Inventory'],
    recipes: ['Kitchen & bar', 'Recipes'], schedule: ['Team', 'Schedule'], payroll: ['Team', 'Payroll'], email: ['Office', 'Business email'], promo: ['Office', 'Promotional emails'], employees: ['Team', 'Employees'], analytics: ['Owner', 'Analytics'], partners: ['Owner', 'Partner stories'], todo: ['', 'To-do'] };
  var view = null, menuOpened = false, staffName = '';
  function isMgr() { return role === 'owner' || role === 'manager' || role === 'scheduler'; }
  // Team > Employees > Permissions: sections switched off for this login (Kitchen and Front-of-house logins)
  var SECT = null, SECT_OF = { preshift: 'preshift', resources: 'resources', recipes: 'recipes', calendar: 'calendar', prep: 'prep' };
  function loadSections() {
    if (isMgr()) { SECT = null; return Promise.resolve(); }
    return sb.rpc('my_sections').then(function (r) {
      SECT = r && !r.error && r.data ? r.data : null;
      document.querySelectorAll('#app [data-view]').forEach(function (a) { var k = SECT_OF[a.getAttribute('data-view')]; if (k && SECT && SECT[k] === false) a.hidden = true; });
      document.querySelectorAll('.sb-group').forEach(function (g) { if (!g.hasAttribute('data-owner')) g.hidden = ![].some.call(g.querySelectorAll('a'), function (a) { return !a.hidden; }); });
    }, function () { SECT = null; });
  }
  function canPrep() { return isMgr() || role === 'kitchen'; }
  function canMail() { return role === 'owner' || role === 'manager'; }
  function mailCtx() { return { sb: sb, el: $('viewEmail'), status: status, role: role, uid: session && session.user && session.user.id, name: staffName }; }
  function mailCounts() { if (canMail() && window.EdenMail) window.EdenMail.counts(mailCtx()); }
  setInterval(function () { if (!$('app').hidden && view !== 'email') mailCounts(); }, 180000);
  function route() {
    if (window.EdenChecklists && window.EdenChecklists.dirty() && location.hash !== '#checklists/edit' && !confirm('Leave without saving your checklist changes?')) { history.replaceState(null, '', '#checklists/edit'); return; }
    if ($('app').hidden) return;
    var v = (location.hash || '').replace(/^#/, ''), sub = '';
    if (v === 'history') v = 'analytics/history';   // History now lives under Analytics
    if (v.indexOf('analytics/') === 0) { sub = v.slice(10) === 'history' ? 'history' : ''; v = 'analytics'; }
    if (v.indexOf('payroll/') === 0) { sub = v.slice(8) === 'rates' ? 'rates' : ''; v = 'payroll'; }
    if (v.indexOf('eod/') === 0) { sub = v.slice(4); v = 'eod'; if (!/^(past|download|r\/[0-9a-f-]{36})$/.test(sub) || (sub === 'download' && role !== 'owner')) sub = sub === 'download' ? 'past' : ''; }
    if (v.indexOf('employees/') === 0) { sub = v.slice(10) === 'permissions' && role === 'owner' ? 'permissions' : ''; v = 'employees'; }
    if (v.indexOf('checklists/') === 0) { sub = v.slice(11) === 'edit' && isMgr() ? 'edit' : ''; v = 'checklists'; }
    if (v.indexOf('promo/') === 0) { sub = v.slice(6); v = 'promo'; if (!/^(list|e\/[0-9a-f-]{36})$/.test(sub)) sub = ''; }
    var calFocus = null;   // #calendar/e/<date>/<event id>: open the calendar on that day with the event showing (from Today)
    if (v.indexOf('calendar/e/') === 0) { var cm = /^calendar\/e\/(\d{4}-\d{2}-\d{2})\/(.*)$/.exec(v); if (cm) calFocus = { date: cm[1], id: decodeURIComponent(cm[2]) }; v = 'calendar'; }
    var mailArg = '';
    if (v.indexOf('email/') === 0) { mailArg = v.slice(6); v = 'email'; }   // back from connecting a mailbox with Google
    if (!VIEWS[v] || ((v === 'schedule' || v === 'catering') && !isMgr()) || (v === 'menu' && role === 'scheduler') || ((v === 'prep' || v === 'inventory') && !canPrep()) || ((v === 'analytics' || v === 'payroll' || v === 'partners') && role !== 'owner') || (v === 'email' && !canMail()) || (v === 'eod' && !isMgr()) || (v === 'promo' && !isMgr()) || (v === 'employees' && !isMgr()) || (SECT && SECT_OF[v] && SECT[SECT_OF[v]] === false)) { v = 'home'; sub = ''; }
    var want = '#' + v + (sub ? '/' + sub : '');
    if (want !== location.hash) history.replaceState(null, '', want);
    if (view === 'analytics' && v !== 'analytics' && window.EdenAnalytics) window.EdenAnalytics.hide();
    if (view === 'payroll' && v !== 'payroll' && window.EdenPayroll) window.EdenPayroll.hide();
    if (view === 'email' && v !== 'email' && window.EdenMail) window.EdenMail.hide();
    if (view === 'eod' && window.EdenEOD) window.EdenEOD.hide();
    if (view === 'promo' && window.EdenPromo) window.EdenPromo.hide();
    if (view === 'menu' && v !== 'menu' && ed.dirty) save();
    view = v;
    Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).hidden = k !== v; });
    var full = v + (sub ? '/' + sub : ''), exact = !!document.querySelector('#app [data-view="' + full + '"]');
    document.querySelectorAll('#app [data-view]').forEach(function (a) { var dv = a.getAttribute('data-view'); a.setAttribute('aria-current', (exact ? dv === full : dv === v) ? 'true' : 'false'); });
    $('edSave').hidden = v !== 'menu';
    $('printMenusBtn').hidden = v !== 'menu' || !window.EdenMenuPrint;
    var pg = PAGES[v] || ['', ''], subName = v === 'payroll' && sub === 'rates' ? 'Pay rates' : v === 'analytics' && sub === 'history' ? 'History' : v === 'eod' ? ({ past: 'Past reports', download: 'Download reports' }[sub] || (sub ? 'Report' : '')) : v === 'promo' ? (sub === 'list' ? 'Guest list' : sub ? 'Email' : '') : v === 'employees' && sub === 'permissions' ? 'Permissions' : '';
    document.title = v === 'home' ? 'Today · Eden Staff' : (subName ? subName + ' · ' : '') + pg[1] + ' · Eden Staff';
    var crumb = $('sbCrumb'); crumb.innerHTML = '';
    if (pg[0]) { var g = document.createElement('span'); g.className = 'sb-crumb-g'; g.textContent = pg[0] + ' /'; crumb.appendChild(g); crumb.appendChild(document.createTextNode(' ')); }
    crumb.appendChild(document.createTextNode(pg[1] + (subName ? ' · ' + subName : '')));
    closeDrawer();
    paintBack();
    if (v === 'menu') {
      INV.items = null; // pick up inventory changes made since
      if (!menuOpened && store.loaded) { menuOpened = true; openEditor(); }
      else if (!store.loaded) status('Loading the menu…');
      else status(ed.dirty ? 'Unsaved changes. Publishing automatically…' : (ed.canWrite ? 'Ready. Changes publish to the website automatically.' : 'View only. Your role can see the menu but not change it.'), ed.dirty ? 'dirty' : (ed.canWrite ? '' : 'err'));
    } else if (v === 'schedule') {
      status('');
      if (window.EdenSchedule) window.EdenSchedule.show({ sb: sb, el: $('viewSchedule'), status: status, role: role, user: session && session.user });
    } else if (v === 'catering') {
      status('');
      if (window.EdenInquiries) window.EdenInquiries.show({ sb: sb, el: $('viewCatering'), status: status, name: staffName, canDelete: role === 'owner' });
    } else if (v === 'analytics') {
      status('');
      if (window.EdenAnalytics) window.EdenAnalytics.show({ sb: sb, el: $('viewAnalytics'), status: status, sub: sub });
    } else if (v === 'payroll') {
      status('');
      if (window.EdenPayroll) window.EdenPayroll.show({ sb: sb, el: $('viewPayroll'), status: status, sub: sub });
    } else if (v === 'calendar') {
      status('');
      if (window.EdenCal) window.EdenCal.show({ sb: sb, el: $('viewCalendar'), status: status, name: staffName, canEdit: isMgr(), focus: calFocus });
    } else if (v === 'recipes') {
      status('');
      if (window.EdenRecipes) window.EdenRecipes.show({ sb: sb, el: $('viewRecipes'), status: status, name: staffName, canEdit: isMgr() });
    } else if (v === 'todo') {
      status('');
      if (window.EdenNotes) window.EdenNotes.showTodo({ sb: sb, el: $('viewTodo'), status: status, name: staffName });
    } else if (v === 'inventory') {
      status('');
      if (!store.loaded) loadAll().catch(function () {}); // menu, for "add from the menu" 
      if (window.EdenInventory) window.EdenInventory.show({ sb: sb, el: $('viewInventory'), status: status, role: role, name: staffName,
        getMenu: function () { return menuData || assembleMenu() || null; } });
    } else if (v === 'prep') {
      status('');
      showPrep();
      if (!store.loaded) loadAll().then(showPrep, function () { status('Couldn’t load the menu. Check your connection and reload.', 'err'); });
    } else if (v === 'email') {
      status('');
      if (window.EdenMail) window.EdenMail.show(Object.assign(mailCtx(), { sub: mailArg }));
    } else if (v === 'eod') {
      status('');
      if (window.EdenEOD) window.EdenEOD.show({ sb: sb, el: $('viewEod'), status: status, role: role, name: staffName, uid: session && session.user && session.user.id, sub: sub });
    } else if (v === 'preshift') {
      status('');
      if (window.EdenPreshift) window.EdenPreshift.show({ sb: sb, el: $('viewPreshift'), status: status, role: role, name: staffName, sec: SECT });
    } else if (v === 'employees') {
      status('');
      $('empPeople').hidden = sub === 'permissions'; $('empPerms').hidden = sub !== 'permissions';
      if (sub === 'permissions') { if (window.EdenPerms) window.EdenPerms.show({ sb: sb, el: $('empPerms') }); }
      else if (window.EdenSchedule) window.EdenSchedule.show({ sb: sb, el: $('empPeople'), status: status, role: role, user: session && session.user, mode: 'people' });
    } else if (v === 'promo') {
      status('');
      if (window.EdenPromo) window.EdenPromo.show({ sb: sb, el: $('viewPromo'), status: status, role: role, name: staffName, sub: sub });
    } else if (v === 'orders') {
      status('');
      if (window.EdenOrders) window.EdenOrders.show({ sb: sb, el: $('viewOrders'), mode: 'admin' });
    } else if (v === 'checklists') {
      status('');
      if (window.EdenChecklists) { if (sub === 'edit') window.EdenChecklists.edit({ sb: sb, el: $('viewChecklists'), status: status }); else window.EdenChecklists.show({ sb: sb, el: $('viewChecklists'), mode: 'admin' }); }
    } else if (v === 'partners') {
      status('');
      if (window.EdenPartners) window.EdenPartners.show({ sb: sb, el: $('viewPartners'), status: status });
    } else if (v === 'resources') {
      status('');
      if (window.EdenResources) window.EdenResources.show({ sb: sb, el: $('viewResources'), status: status, role: role, name: staffName });
    } else {
      status(''); renderHome();
    }
  }
  /* ---------------- side menu (a drawer on phones and small tablets) ---------------- */
  function openDrawer() { $('app').classList.add('sb-open'); $('sbScrim').hidden = false; $('sbOpen').setAttribute('aria-expanded', 'true'); var f = $('sideNav').querySelector('[aria-current="true"]') || $('sbClose'); setTimeout(function () { f.focus(); }, 50); }
  function closeDrawer() { if (!$('app').classList.contains('sb-open')) return; $('app').classList.remove('sb-open'); $('sbScrim').hidden = true; $('sbOpen').setAttribute('aria-expanded', 'false'); }
  $('sbOpen').addEventListener('click', openDrawer);
  $('sbClose').addEventListener('click', function () { closeDrawer(); $('sbOpen').focus(); });
  $('sbScrim').addEventListener('click', closeDrawer);
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && $('app').classList.contains('sb-open')) { closeDrawer(); $('sbOpen').focus(); } });
  $('sideNav').addEventListener('click', function (e) {
    var a = e.target.closest && e.target.closest('a[href]'); if (!a) return;
    try { sessionStorage.removeItem('eden-from-today'); } catch (x) {}   // chose a page from the menu, not from Today
    var acct = $('sideNav').querySelector('.sb-acct'); if (acct) acct.open = false;
    if (a.getAttribute('href') === location.hash) closeDrawer();
  });
  // "← Today · 3 left" when a page was opened from the Today list
  var todayLeft = 0;
  function paintBack() {
    var from = false; try { from = sessionStorage.getItem('eden-from-today') === '1'; } catch (x) {}
    var b = $('sbBack');
    b.hidden = !(from && view !== 'home');
    b.textContent = '\u2190 Today' + (todayLeft ? ' \u00b7 ' + todayLeft + ' left' : '');
  }
  function todayCtx() { return { sb: sb, el: $('viewHome'), status: status, role: role, name: staffName, isMgr: isMgr(), isOwner: role === 'owner', canPrep: canPrep(), site: CFG.publicSite || '', onCounts: paintCounts }; }
  function paintCounts(c) {
    todayLeft = c.total || 0;
    var set = function (k, v, on) { document.querySelectorAll('[data-badge="' + k + '"]').forEach(function (el) { el.textContent = v || ''; el.hidden = !v; el.classList.toggle('on', !!on); }); };
    set('today', c.total ? String(c.total) : '', true);
    set('catering', c.catering ? String(c.catering) : '');
    set('inventory', c.inventory ? c.inventory + ' low' : '');
    set('schedule', c.schedule ? String(c.schedule) : '');
    set('payroll', c.payroll || '');
    paintBack();
  }
  function refreshToday() { if (window.EdenToday && role) window.EdenToday.counts(todayCtx()); }
  setInterval(function () { if (!$('app').hidden && view !== 'home') refreshToday(); }, 120000);
  /* ---------------- pages that are coming next ---------------- */
  var SOON = {
    preshift: ['Service', 'Pre-shift meeting', 'Tonight’s line-up for the whole team: specials, 86’d items, VIPs and allergies, the private events, wine pours and who’s working. The Owner and managers write it; every employee can read it here and on the staff page.', 'Everyone can see this page. The Owner and managers will be able to edit it.'],
    eod: ['Service', 'End of day report', 'A short report at close: covers and sales, comps and voids, staffing notes, incidents, maintenance, guest feedback and anything the next shift should know. Filled in by the Owner or the closing manager, with past reports kept and searchable.', 'Only the Owner and managers can see this page.']
  };
  function comingSoon(v) {
    var el = $(VIEWS[v]), t = SOON[v];
    if (el.firstChild) return;
    var wrap = document.createElement('div'); wrap.className = 'soon-in';
    var k = document.createElement('p'); k.className = 'home-eyebrow'; k.textContent = t[0] + ' \u00b7 Coming next';
    var h1 = document.createElement('h1'); h1.className = 'soon-title'; h1.textContent = t[1];
    var card = document.createElement('div'); card.className = 'soon-card';
    var d = document.createElement('p'); d.textContent = t[2];
    var who = document.createElement('p'); who.className = 'soon-who'; who.textContent = t[3];
    card.appendChild(d); card.appendChild(who);
    wrap.appendChild(k); wrap.appendChild(h1); wrap.appendChild(card); el.appendChild(wrap);
  }
  function showPrep() {
    if (!window.EdenPrep) return;
    // managers set up as employees don't load the website data here, so the prep list reads the menu itself
    if (role === 'scheduler') { window.EdenPrep.show({ el: $('viewPrep'), status: status, sb: sb, role: role, name: staffName }); return; }
    window.EdenPrep.show({ el: $('viewPrep'), status: status, sb: sb, role: role, name: staffName, viewOnly: !!SECT && SECT['prep.edit'] === false, getMenu: function () {
      if (!store.loaded) return null;
      return menuData || assembleMenu() || window.EDEN_MENU_SEED || { tabs: [] };
    } });
  }
  window.addEventListener('hashchange', route);
  $('notesBtn').addEventListener('click', function () { if (window.EdenNotes) window.EdenNotes.open(); });
  // the published menu, for Print menus on the Menu & Supper Club page (loads it first if the menu hasn't been read yet)
  function currentMenu() {
    if (store.loaded) return assembleMenu() || menuData || window.EDEN_MENU_SEED || { tabs: [] };
    return loadAll().then(function () { return assembleMenu() || menuData || window.EDEN_MENU_SEED || { tabs: [] }; });
  }
  function renderHome() { if (window.EdenToday) window.EdenToday.show(todayCtx()); }

  /* ---------------- data: read all website rows, keep them live ---------------- */
  var store = { rows: {}, loaded: false, saved: {} };
  var menuData = null;

  function loadAll() {
    return sb.from('site_docs').select('path,data').like('path', 'site/%').then(function (r) {
      if (r.error) throw r.error;
      var rows = {};
      (r.data || []).forEach(function (row) { rows[row.path] = row.data; });
      store.rows = rows; store.loaded = true;
      if (!ed.dirty && !ed.saving) menuData = assembleMenu();
      applyStore();
    });
  }
  function startData() {
    loadAll().then(function () {
      if (view === 'menu') { menuOpened = true; openEditor(); }
    }, function () { if (view === 'menu') status('Couldn’t load the menu. Check your connection and reload.', 'err'); });
    var first = true;
    sb.channel('staff-site-docs')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'site_docs' }, function (ch) {
        if (ch.eventType === 'DELETE') { if (ch.old && ch.old.path) delete store.rows[ch.old.path]; }
        else if (ch.new && ch.new.path) store.rows[ch.new.path] = ch.new.data;
        applyStore();
      })
      .subscribe(function (s) { if (s === 'SUBSCRIBED') { if (!first) loadAll().catch(function () {}); first = false; } });
  }
  function assembleMenu() {
    var m = store.rows['site/menu']; if (!m || !m.tabs) return null;
    var g = {};
    Object.keys(store.rows).forEach(function (k) { if (k.indexOf('site/menu/groups/') === 0) g[k.slice(17)] = store.rows[k]; });
    return {
      allergy: m.allergy || '', updatedAt: m.updatedAt, supper: store.rows['site/supper'] || m.supper || null,
      tabs: m.tabs.map(function (t) {
        return { id: t.id, label: t.label, groups: (t.gids || []).filter(function (id) { return g[id]; }).map(function (id) { var x = g[id]; return { id: id, title: x.title, note: x.note, noteAfter: x.noteAfter, items: x.items || [] }; }) };
      })
    };
  }
  var applyT = null;
  function applyStore() {
    clearTimeout(applyT);
    applyT = setTimeout(function () {
      var d = assembleMenu();
      if (d) menuData = ed.dirty || ed.saving ? menuData : d;
      if (window.EdenPrep) window.EdenPrep.refresh();
      if (!d) { if (!ed.el.hidden && !$('app').hidden) edRender(); return; }
      menuData = d;
      if (!ed.dirty && !ed.saving) {
        baseline(menuData);
        var a = document.activeElement;
        if (!(a && ed.el.contains(a) && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA'))) { ed.draft = clone(menuData); edRender(); }
      }
    }, 40);
  }

  /* ---------------- saving: only send the sections that changed ---------------- */
  function newGid() { return 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
  function splitMenu(d) {
    var out = { meta: { version: 2, allergy: d.allergy || '', tabs: [] }, groups: {}, supper: d.supper || null };
    (d.tabs || []).forEach(function (t) {
      var gids = [];
      (t.groups || []).forEach(function (g) {
        if (!g.id) g.id = newGid(); gids.push(g.id);
        out.groups[g.id] = { title: g.title || '', note: g.note || '', noteAfter: g.noteAfter || '', items: g.items || [] };
      });
      out.meta.tabs.push({ id: t.id, label: t.label, gids: gids });
    });
    return out;
  }
  function baseline(d) {
    var p = splitMenu(clone(d)); store.saved = { meta: JSON.stringify(p.meta), supper: JSON.stringify(p.supper) };
    Object.keys(p.groups).forEach(function (id) { store.saved['g:' + id] = JSON.stringify(p.groups[id]); });
  }
  function check(r) { if (r.error) throw r.error; return r; }
  function upsert(rows) { return sb.from('site_docs').upsert(rows, { onConflict: 'path' }).then(check); }
  function isPermission(e) { return e && (e.code === '42501' || /row-level security|permission/i.test(e.message || '')); }

  /* ---------------- editor (same layout as the original website editor) ---------------- */
  var ed = { el: $('app'), tab: 0, draft: null, dirty: false, saving: false, canWrite: false, timer: null };
  function status(text, cls) { var s = $('edStatus'); s.textContent = text; s.className = 'ed-status' + (cls ? ' ' + cls : ''); }
  function markDirty() { ed.dirty = true; status('Unsaved changes. Publishing automatically…', 'dirty'); clearTimeout(ed.timer); ed.timer = setTimeout(save, 600); }
  function isWine(it) { return it.appellation !== undefined || it.grape !== undefined || it.country !== undefined; }
  // Starting suggestions, all poured by the glass (from Eden's wine list). Used once by the Kitchen tab's
  // "Add suggested wine pairings" button; after that, pairings are edited like any other field.
  var SUGGESTED_PAIRINGS = {
      "Mushroom Toast": [
          "2023 Wölffer Estate Cabernet Franc, Long Island",
          "16"
      ],
      "Beef Tartare": [
          "Hermann J. Wiemer Extra Brut Méthode Champenoise, Seneca Lake",
          "18"
      ],
      "Green Lentil Salad": [
          "2023 Lieb Cellars Sauvignon Blanc, North Fork",
          "17"
      ],
      "Braised Short Rib": [
          "2023 Red Tail Ridge Blaufränkisch, Finger Lakes",
          "16"
      ],
      "Beet and Carrot Salad": [
          "2024 Apollo's Praise Lahoma Vineyard Scheurebe, Seneca Lake",
          "17"
      ],
      "Pan Seared Salmon": [
          "2024 Living Roots Ramato Pinot Gris, Finger Lakes",
          "16"
      ],
      "Goat Cheese Cappelletti": [
          "2024 Giovanni Battista Mesina 'Vermentuzzo' Vermentino, Umbria",
          "20"
      ],
      "Tandoori Chicken": [
          "2024 Hermann J. Wiemer Flower Day Riesling, Seneca Lake",
          "18"
      ],
      "Ember Roasted NY Strip": [
          "2018 Luke Reserve Syrah, Wahluke Slope",
          "30"
      ],
      "Specialty Cuts": [
          "2021 Living Roots Cabernet – Tannat, Adelaide Hills",
          "20"
      ]
  };
  function isKitchen(t) { return t && (t.id === 'm-food' || /kitchen/i.test(t.label || '')); }
  function hasWine(t) { return (t.groups || []).some(function (g) { return (g.items || []).some(isWine); }); }

  function openEditor() {
    if (!store.loaded) return;
    ed.draft = clone(menuData); ed.tab = 0; edRender();
    if (!menuData) status(ed.canWrite ? 'The database is empty. Copy the menu in to start.' : 'The menu hasn’t been set up yet.', 'err');
    else status(ed.canWrite ? 'Ready. Changes publish to the website automatically.' : 'View only. Your role can see the menu but not change it.', ed.canWrite ? '' : 'err');
    $('edSave').disabled = !ed.canWrite || !menuData;
  }

  function importBanner(main) {
    var b = document.createElement('div'); b.className = 'ed-banner';
    var p = document.createElement('p');
    p.textContent = ed.canWrite
      ? 'The database doesn’t have the menu yet. Copy the menu that is on the website today into the database. You only need to do this once; after that, the website and iPads read the menu from here.'
      : 'The menu hasn’t been copied into the database yet. Ask the owner or a manager to sign in and do it.';
    b.appendChild(p);
    if (ed.canWrite) {
      var go = document.createElement('button'); go.type = 'button'; go.className = 'ed-btn'; go.textContent = 'Copy the current menu into the database';
      go.onclick = function () {
        if (!window.EDEN_MENU_SEED) { status('The starting menu file is missing.', 'err'); return; }
        go.disabled = true; status('Copying the menu…');
        var p2 = splitMenu(clone(window.EDEN_MENU_SEED)), rows = [];
        Object.keys(p2.groups).forEach(function (id) { rows.push({ path: 'site/menu/groups/' + id, data: p2.groups[id] }); });
        if (p2.supper) rows.push({ path: 'site/supper', data: p2.supper });
        p2.meta.updatedAt = Date.now();
        upsert(rows).then(function () { return upsert([{ path: 'site/menu', data: p2.meta }]); }).then(function () {
          return loadAll();
        }).then(function () { openEditor(); status('Menu copied. The website now reads it from the database.', 'ok'); }, function (e) {
          go.disabled = false;
          status(isPermission(e) ? 'Your account isn’t allowed to change the menu.' : 'Couldn’t copy the menu. Check your connection and try again.', 'err');
        });
      };
      b.appendChild(go);
    }
    main.appendChild(b);
  }

  /* ---------- search: find a dish, drink or wine across every tab and jump to it ---------- */
  function edNorm(x) { return String(x == null ? '' : x).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, ''); }
  function edSearchFind(q) {
    var words = edNorm(q).split(/\s+/).filter(Boolean), out = [];
    if (!words.length || !ed.draft) return out;
    ed.draft.tabs.forEach(function (t, ti) {
      (t.groups || []).forEach(function (g, gi) {
        (g.items || []).forEach(function (it, ii) {
          var hay = edNorm([it.name, it.src, it.desc, it.grape, it.appellation, it.country, it.pair, it.price, it.bottle, it.glass, g.title, t.label].join(' '));
          if (words.every(function (w) { return hay.indexOf(w) !== -1; })) out.push({ ti: ti, gi: gi, ii: ii, it: it, t: t, g: g, nameHit: words.every(function (w) { return edNorm(it.name).indexOf(w) !== -1; }) });
        });
      });
    });
    return out.sort(function (a, b) { return (b.nameHit ? 1 : 0) - (a.nameHit ? 1 : 0); });   // name matches first, otherwise menu order
  }
  function edJump(r) {
    ed.tab = r.ti; edRender();
    var row = $('edMain').querySelector('.ed-item[data-gi="' + r.gi + '"][data-ii="' + r.ii + '"]');
    if (!row) return;
    // jump straight there (a long smooth scroll overshoots while the page is still laying out), then settle it once more
    row.scrollIntoView({ block: 'center' });
    row.classList.remove('ed-flash'); void row.offsetWidth; row.classList.add('ed-flash');
    setTimeout(function () { if (document.body.contains(row)) { row.scrollIntoView({ block: 'center' }); var f = row.querySelector('input,textarea'); if (f) f.focus({ preventScroll: true }); } }, 300);
  }
  function edSearch() {
    var wrap = document.createElement('div'); wrap.className = 'ed-search'; wrap.setAttribute('role', 'search');
    var inp = document.createElement('input'); inp.type = 'search'; inp.className = 'ed-sin'; inp.value = ed.q || ''; inp.autocomplete = 'off';
    inp.placeholder = 'Search the menu: dish, drink, wine, grape, farm…'; inp.setAttribute('aria-label', 'Search the menu');
    var res = document.createElement('div'); res.className = 'ed-sres'; res.setAttribute('role', 'listbox');
    wrap.appendChild(inp); wrap.appendChild(res);
    var hits = [];
    function paint() {
      res.innerHTML = ''; var q = (ed.q || '').trim();
      wrap.classList.toggle('open', q.length >= 2);
      if (q.length < 2) return;
      hits = edSearchFind(q);
      var head = document.createElement('p'); head.className = 'ed-scount'; head.textContent = hits.length ? hits.length + (hits.length === 1 ? ' match' : ' matches') + (hits.length > 40 ? ' · showing the first 40' : '') : 'Nothing on the menu matches “' + q + '”.'; res.appendChild(head);
      hits.slice(0, 40).forEach(function (r, n) {
        var it = r.it, b = document.createElement('button'); b.type = 'button'; b.className = 'ed-shit'; b.setAttribute('role', 'option');
        var nm = document.createElement('b'); nm.textContent = it.name || 'Untitled item';
        var where = document.createElement('span'); where.textContent = [r.t.label, r.g.title].filter(Boolean).join(' › ');
        var extra = document.createElement('small');
        extra.textContent = [isWine(it) ? [it.grape, it.appellation].filter(Boolean).join(', ') : it.src, it.price || it.bottle, it.hidden ? 'Hidden from the website' : ''].filter(Boolean).join(' · ');
        b.appendChild(nm); b.appendChild(where); if (extra.textContent) b.appendChild(extra);
        if (it.hidden) b.classList.add('is-hidden');
        b.onclick = function () { edJump(r); };
        res.appendChild(b);
      });
    }
    inp.addEventListener('input', function () { ed.q = inp.value; paint(); });
    inp.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && hits.length) { e.preventDefault(); edJump(hits[0]); }
      else if (e.key === 'Escape') { ed.q = ''; inp.value = ''; paint(); }
      else if (e.key === 'ArrowDown') { var f = res.querySelector('.ed-shit'); if (f) { e.preventDefault(); f.focus(); } }
    });
    res.addEventListener('keydown', function (e) {
      var a = document.activeElement; if (!a || !a.classList.contains('ed-shit')) return;
      if (e.key === 'ArrowDown' && a.nextElementSibling) { e.preventDefault(); a.nextElementSibling.focus(); }
      if (e.key === 'ArrowUp') { e.preventDefault(); var pv = a.previousElementSibling; if (pv && pv.classList.contains('ed-shit')) pv.focus(); else inp.focus(); }
      if (e.key === 'Escape') { ed.q = ''; inp.value = ''; paint(); inp.focus(); }
    });
    // close the list when you click elsewhere (the words stay, so you can reopen it)
    document.addEventListener('mousedown', function off(e) { if (!document.body.contains(wrap)) { document.removeEventListener('mousedown', off); return; } if (!wrap.contains(e.target)) wrap.classList.remove('open'); });
    inp.addEventListener('focus', function () { if ((ed.q || '').trim().length >= 2) wrap.classList.add('open'); });
    paint(); wrap.classList.remove('open');
    return wrap;
  }

  function edRender() {
    var side = $('edTabs'), main = $('edMain');
    side.innerHTML = ''; main.innerHTML = '';
    var d = ed.draft;
    if (!d) { importBanner(main); return; }
    if (ed.tab !== 'supper' && ed.tab >= d.tabs.length) ed.tab = 0;
    d.tabs.forEach(function (t, i) { var b = document.createElement('button'); b.type = 'button'; b.textContent = t.label || 'Untitled'; b.setAttribute('aria-current', i === ed.tab); b.onclick = function () { ed.tab = i; edRender(); }; side.appendChild(b); });
    var sb2 = document.createElement('button'); sb2.type = 'button'; sb2.className = 'ed-side-sup'; sb2.textContent = 'Supper Club'; sb2.setAttribute('aria-current', ed.tab === 'supper'); sb2.onclick = function () { ed.tab = 'supper'; edRender(); }; side.appendChild(sb2);
    main.appendChild(edSearch());
    if (!ed.canWrite) { var ro = document.createElement('p'); ro.className = 'ed-readonly'; ro.textContent = 'View only. Your role (' + (ROLE_NAMES[role] || role) + ') can see the menu but not change it.'; main.appendChild(ro); }
    if (ed.tab === 'supper') { edSupper(main); return; }
    var t = d.tabs[ed.tab];
    var h = document.createElement('h2'); h.textContent = t.label || 'Untitled'; main.appendChild(h);
    if (isKitchen(t) && ed.canWrite && !t.groups.some(function (g) { return (g.items || []).some(function (it) { return it.pair; }); })) {
      var matches = 0; t.groups.forEach(function (g) { (g.items || []).forEach(function (it) { if (SUGGESTED_PAIRINGS[it.name]) matches++; }); });
      if (matches) {
        var pb = document.createElement('div'); pb.className = 'ed-banner';
        var pp = document.createElement('p'); pp.textContent = 'Suggested by-the-glass wine pairings are ready for ' + matches + ' Small and Large Plates. Add them, then change any you like. Each pairing shows under its dish on the website and iPad menu.';
        pb.appendChild(pp);
        var pgo = document.createElement('button'); pgo.type = 'button'; pgo.className = 'ed-btn'; pgo.textContent = 'Add suggested wine pairings';
        pgo.onclick = function () {
          t.groups.forEach(function (g) { (g.items || []).forEach(function (it) { var sp = SUGGESTED_PAIRINGS[it.name]; if (sp && !it.pair) { it.pair = sp[0]; it.pairPrice = sp[1]; } }); });
          markDirty(); edRender();
        };
        pb.appendChild(pgo); main.appendChild(pb);
      }
    }
    var tn = document.createElement('div'); tn.className = 'ed-tabname'; tn.appendChild(field('Tab name', t.label, function (v) { t.label = v; h.textContent = v || 'Untitled'; side.children[ed.tab].textContent = v || 'Untitled'; })); main.appendChild(tn);
    var kind = ed.canWrite ? invKind(t) : null;
    if (kind) loadInv();
    if (ed.canWrite && t.groups.length) main.appendChild(quickAdd(t, kind));
    t.groups.forEach(function (g, gi) {
      var box = document.createElement('section'); box.className = 'ed-group';
      var head = document.createElement('div'); head.className = 'ed-ghead';
      head.appendChild(field('Section', g.title, function (v) { g.title = v; }));
      var nh = g.items.filter(function (x) { return x.hidden; }).length;
      var gb = document.createElement('div'); gb.className = 'ed-gbtns';
      gb.appendChild(btn('↑', 'Move section up', function () { if (gi > 0) { t.groups.splice(gi - 1, 0, t.groups.splice(gi, 1)[0]); markDirty(); edRender(); } }));
      gb.appendChild(btn('↓', 'Move section down', function () { if (gi < t.groups.length - 1) { t.groups.splice(gi + 1, 0, t.groups.splice(gi, 1)[0]); markDirty(); edRender(); } }));
      gb.appendChild(confirmBtn('Delete section', function () { t.groups.splice(gi, 1); markDirty(); edRender(); }));
      head.appendChild(gb); box.appendChild(head);
      if (nh) { var hn = document.createElement('p'); hn.className = 'ed-hnote'; hn.textContent = nh + (nh === 1 ? ' item is' : ' items are') + ' hidden from the website in this section.'; box.appendChild(hn); }
      var notes = document.createElement('div'); notes.className = 'ed-notes';
      notes.appendChild(field('Note above items (optional)', g.note, function (v) { g.note = v; }));
      notes.appendChild(field('Note below items (optional)', g.noteAfter, function (v) { g.noteAfter = v; }));
      box.appendChild(notes);
      var list = document.createElement('div');
      g.items.forEach(function (it, ii) {
        var row = document.createElement('div'); row.className = 'ed-item' + (it.hidden ? ' is-hidden' : ''); row.setAttribute('data-gi', gi); row.setAttribute('data-ii', ii);
        if (isWine(it)) {
          row.classList.add('ed-wine');
          var nm = field('Wine', it.name, function (v) { it.name = v; }); nm.classList.add('wide'); row.appendChild(nm);
          if (kind) invCombo(nm, it, t, g, row, kind);
          row.appendChild(field('Country', it.country, function (v) { it.country = v; }));
          row.appendChild(field('Appellation', it.appellation, function (v) { it.appellation = v; }));
          row.appendChild(field('Grape', it.grape, function (v) { it.grape = v; }));
          row.appendChild(field('Bottle price', it.bottle, function (v) { it.bottle = v; it.price = v || (it.glass ? it.glass + ' glass' : ''); }));
          row.appendChild(field('Glass price', it.glass, function (v) { if (v) it.glass = v; else delete it.glass; if (!it.bottle) it.price = v ? v + ' glass' : ''; }));
          var wd = field('Tasting note', it.desc, function (v) { it.desc = v; }); wd.classList.add('desc'); row.appendChild(wd);
        } else {
          var dn = field(kind ? 'Drink' : 'Dish / drink', it.name, function (v) { it.name = v; }); row.appendChild(dn);
          if (kind) invCombo(dn, it, t, g, row, kind);
          var sf = field('Farm or producer', it.src, function (v) { it.src = v; }); row.appendChild(sf); srcCombo(sf, isKitchen(t));
          var dsc = field('Description', it.desc, function (v) { it.desc = v; }); dsc.classList.add('desc'); row.appendChild(dsc);
          row.appendChild(field('Price', it.price, function (v) { it.price = v; }));
        }
        var ib = document.createElement('div'); ib.className = 'ed-ibtns';
        var hb = btn(it.hidden ? 'Show' : 'Hide', it.hidden ? 'Show on website' : 'Hide from website', function () { it.hidden = !it.hidden; if (!it.hidden) delete it.hidden; markDirty(); edRender(); }); hb.classList.add('ed-hide'); if (it.hidden) hb.classList.add('on'); ib.appendChild(hb);
        ib.appendChild(btn('↑', 'Move up', function () { if (ii > 0) { g.items.splice(ii - 1, 0, g.items.splice(ii, 1)[0]); markDirty(); edRender(); } }));
        ib.appendChild(btn('↓', 'Move down', function () { if (ii < g.items.length - 1) { g.items.splice(ii + 1, 0, g.items.splice(ii, 1)[0]); markDirty(); edRender(); } }));
        ib.appendChild(confirmBtn('✕', function () { g.items.splice(ii, 1); markDirty(); edRender(); }, 'Remove item'));
        row.appendChild(ib);
        if (!isWine(it) && isKitchen(t)) {
          row.appendChild(pairRow(it));
        }
        list.appendChild(row);
      });
      box.appendChild(list);
      var foot = document.createElement('div'); foot.className = 'ed-gfoot';
      foot.appendChild(btn('+ Add item', 'Add item', function () {
        g.items.push(hasWine(t) ? { name: '', country: '', appellation: '', grape: '', bottle: '', desc: '', price: '' } : { name: '', src: '', desc: '', price: '' });
        markDirty(); edRender();
        var rows = main.querySelectorAll('.ed-group')[gi].querySelectorAll('.ed-item'); var last = rows[rows.length - 1]; if (last) last.querySelector('input').focus();
      }));
      if (kind) {
        var ib2 = btn(ed.invOpen === g.id ? 'Close inventory' : '+ From inventory', 'Add items from the inventory', function () { ed.invOpen = ed.invOpen === g.id ? null : g.id; ed.invQ = ''; edRender(); });
        ib2.classList.add('ed-invbtn'); foot.appendChild(ib2);
      }
      box.appendChild(foot);
      if (kind && ed.invOpen === g.id) box.appendChild(invPicker(t, g, kind));
      main.appendChild(box);
    });
    var ag = btn('+ Add section', 'Add section', function () { t.groups.push({ id: newGid(), title: 'New section', note: '', noteAfter: '', items: [{ name: '', src: '', desc: '', price: '' }] }); markDirty(); edRender(); main.scrollTop = main.scrollHeight; });
    ag.classList.add('ed-addgroup'); main.appendChild(ag);
    var al = document.createElement('div'); al.className = 'ed-allergy'; al.appendChild(field('Allergy notice (shown under every tab)', d.allergy, function (v) { d.allergy = v; })); main.appendChild(al);
  }

  function edSupper(main) {
    var d = ed.draft;
    if (!d.supper) d.supper = { eyebrow: 'Eden Supper Club', title: '', date: '', intro: '', menuHeading: '', tier1: 'Pairing I', tier2: 'Pairing II', courses: [], resText: '', notes: [], ctaLabel: '', ctaUrl: '' };
    var sp = d.supper; sp.courses = sp.courses || [];
    var h = document.createElement('h2'); h.textContent = 'Supper Club page'; main.appendChild(h);
    var intro = document.createElement('p'); intro.className = 'ed-help'; intro.textContent = 'Everything on the Supper Club page. Changes publish to the website automatically.'; main.appendChild(intro);
    function box(title) { var b = document.createElement('section'); b.className = 'ed-group'; var hd = document.createElement('div'); hd.className = 'ed-ghead'; var t = document.createElement('h3'); t.className = 'ed-boxtitle'; t.textContent = title; hd.appendChild(t); b.appendChild(hd); var body = document.createElement('div'); body.className = 'ed-boxbody'; b.appendChild(body); main.appendChild(b); return body; }
    var top = box('Top of page');
    top.appendChild(field('Small heading', sp.eyebrow, function (v) { sp.eyebrow = v; }));
    top.appendChild(field('Event title', sp.title, function (v) { sp.title = v; }));
    top.appendChild(field('Dates and times', sp.date, function (v) { sp.date = v; }));
    top.appendChild(area('Introduction', sp.intro, function (v) { sp.intro = v; }));
    var mb = box('Courses');
    var row1 = document.createElement('div'); row1.className = 'ed-notes';
    row1.appendChild(field('Menu heading', sp.menuHeading, function (v) { sp.menuHeading = v; }));
    var tiers = document.createElement('div'); tiers.className = 'ed-notes'; tiers.style.padding = '0'; tiers.style.border = '0';
    tiers.appendChild(field('First pairing label', sp.tier1, function (v) { sp.tier1 = v; }));
    tiers.appendChild(field('Second pairing label', sp.tier2, function (v) { sp.tier2 = v; }));
    row1.appendChild(tiers); mb.parentNode.insertBefore(row1, mb);
    sp.courses.forEach(function (c, ci) {
      var row = document.createElement('div'); row.className = 'ed-item ed-course' + (c.hidden ? ' is-hidden' : '');
      row.appendChild(field('Course', c.name, function (v) { c.name = v; }));
      row.appendChild(field('Description', c.desc, function (v) { c.desc = v; }));
      row.appendChild(field(sp.tier1 || 'First pairing', c.w1, function (v) { c.w1 = v; }));
      row.appendChild(field(sp.tier2 || 'Second pairing', c.w2, function (v) { c.w2 = v; }));
      var ib = document.createElement('div'); ib.className = 'ed-ibtns';
      var hb = btn(c.hidden ? 'Show' : 'Hide', c.hidden ? 'Show on website' : 'Hide from website', function () { c.hidden = !c.hidden; if (!c.hidden) delete c.hidden; markDirty(); edRender(); }); hb.classList.add('ed-hide'); if (c.hidden) hb.classList.add('on'); ib.appendChild(hb);
      ib.appendChild(btn('↑', 'Move up', function () { if (ci > 0) { sp.courses.splice(ci - 1, 0, sp.courses.splice(ci, 1)[0]); markDirty(); edRender(); } }));
      ib.appendChild(btn('↓', 'Move down', function () { if (ci < sp.courses.length - 1) { sp.courses.splice(ci + 1, 0, sp.courses.splice(ci, 1)[0]); markDirty(); edRender(); } }));
      ib.appendChild(confirmBtn('✕', function () { sp.courses.splice(ci, 1); markDirty(); edRender(); }, 'Remove course'));
      row.appendChild(ib); mb.appendChild(row);
    });
    var addc = document.createElement('div'); addc.className = 'ed-gfoot';
    addc.appendChild(btn('+ Add course', 'Add course', function () { sp.courses.push({ name: '', desc: '', w1: '', w2: '' }); markDirty(); edRender(); }));
    mb.appendChild(addc);
    var rb = box('Reservations');
    rb.appendChild(area('Message', sp.resText, function (v) { sp.resText = v; }));
    (sp.notes = sp.notes || []).forEach(function (n, ni) {
      var r = document.createElement('div'); r.className = 'ed-noterow';
      r.appendChild(field('Detail ' + (ni + 1), n, function (v) { sp.notes[ni] = v; }));
      r.appendChild(confirmBtn('✕', function () { sp.notes.splice(ni, 1); markDirty(); edRender(); }, 'Remove detail'));
      rb.appendChild(r);
    });
    rb.appendChild(btn('+ Add detail', 'Add detail', function () { sp.notes.push(''); markDirty(); edRender(); }));
    var cta = document.createElement('div'); cta.className = 'ed-notes'; cta.style.padding = '12px 0 0'; cta.style.border = '0';
    cta.appendChild(field('Button text', sp.ctaLabel, function (v) { sp.ctaLabel = v; }));
    cta.appendChild(field('Button link (e.g. an OpenTable booking page)', sp.ctaUrl, function (v) { sp.ctaUrl = v; }));
    rb.appendChild(cta);
  }

  /* ---------- wine pairing field with by-the-glass suggestions ---------- */
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function glassWines() { // every wine on the current wine list that has a glass price
    var out = [];
    ((ed.draft && ed.draft.tabs) || []).forEach(function (t) {
      (t.groups || []).forEach(function (g) {
        (g.items || []).forEach(function (w) {
          if (isWine(w) && w.glass && w.name && !w.hidden) out.push({ name: w.name, glass: String(w.glass).trim(), style: g.title || '', where: w.appellation || w.country || '' });
        });
      });
    });
    return out;
  }
  function pairRow(it) {
    var pr = document.createElement('div'); pr.className = 'ed-pairrow';
    var wf = field('Wine pairing (optional)', it.pair, function (v) { if (v) it.pair = v; else delete it.pair; }, true);
    var pf = field('Glass price', it.pairPrice, function (v) { if (v) it.pairPrice = v; else delete it.pairPrice; });
    pr.appendChild(wf); pr.appendChild(pf);
    if (!ed.canWrite) return pr;
    var input = wf.querySelector('input'), priceInput = pf.querySelector('input');
    input.setAttribute('autocomplete', 'off'); input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
    input.placeholder = 'Start typing a wine, grape or region';
    wf.classList.add('ed-ac');
    var box = document.createElement('div'); box.className = 'ed-ac-list'; box.setAttribute('role', 'listbox'); box.hidden = true;
    wf.appendChild(box);
    var matches = [], active = -1;
    function close() { box.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); }
    function choose(w) {
      input.value = w.name; priceInput.value = w.glass;
      it.pair = w.name; it.pairPrice = w.glass;
      close(); markDirty();
    }
    function paint() {
      box.querySelectorAll('.ed-ac-opt').forEach(function (o, i) { o.classList.toggle('on', i === active); o.setAttribute('aria-selected', i === active); });
      var on = box.querySelector('.ed-ac-opt.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function open() {
      var words = fold(input.value).split(/\s+/).filter(Boolean), all = glassWines();
      matches = all.filter(function (w) { var hay = fold(w.name + ' ' + w.style + ' ' + w.where); return words.every(function (q) { return hay.indexOf(q) !== -1; }); });
      if (matches.length === 1 && matches[0].name === input.value) matches = [];
      box.innerHTML = '';
      if (!all.length) { close(); return; }
      var head = document.createElement('div'); head.className = 'ed-ac-head';
      head.textContent = matches.length ? 'By the glass' + (words.length ? ' · ' + matches.length + ' match' + (matches.length === 1 ? '' : 'es') : '') : 'No glass pours match “' + input.value + '”. You can still type any wine.';
      box.appendChild(head);
      matches.forEach(function (w, i) {
        var o = document.createElement('div'); o.className = 'ed-ac-opt'; o.setAttribute('role', 'option');
        var n = document.createElement('span'); n.className = 'ed-ac-name'; n.textContent = w.name;
        var m = document.createElement('span'); m.className = 'ed-ac-meta'; m.textContent = w.style + (w.where ? ' · ' + w.where : '');
        var pz = document.createElement('span'); pz.className = 'ed-ac-price'; pz.textContent = w.glass;
        o.appendChild(n); o.appendChild(pz); o.appendChild(m);
        o.addEventListener('mousedown', function (e) { e.preventDefault(); choose(w); }); // before the input loses focus
        o.addEventListener('mousemove', function () { if (active !== i) { active = i; paint(); } });
        box.appendChild(o);
      });
      active = matches.length && words.length ? 0 : -1;
      box.hidden = false; input.setAttribute('aria-expanded', 'true'); paint();
    }
    input.addEventListener('focus', open);
    input.addEventListener('input', open);
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('keydown', function (e) {
      if (box.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { open(); e.preventDefault(); return; }
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(matches.length - 1, active + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (active >= 0 && matches[active]) { choose(matches[active]); e.preventDefault(); } }
      else if (e.key === 'Escape') { close(); e.preventDefault(); }
    });
    return pr;
  }

  /* ---------- Farm or producer: a drop-down of our partners (the website's Partners section), every producer already on
   * the menu, and any new one typed in (remembered in site_docs "site/producers", so it's offered from then on). ---------- */
  // every partner in the website's Partners section (keep in step with eden-website index.html #partners);
  // on the website's menu, a dish whose producer is one of these links to that partner's story and map
  // written the way the menu shows a producer: "Farm · Town, ST"
  var PARTNERS = ['Grindstone Farm · Pulaski, NY', 'Fresh Herbs of Fabius · Fabius, NY', 'Fruit of the Fungi · Lebanon, NY', 'Dutch Hill Maple · Tully, NY',
    'Hillside Farm · Truxton, NY', 'Sorrell Hill Milk Co. · Baldwinsville, NY', 'Certified Angus Beef · Wooster, OH', 'Browne Trading Co. · Portland, ME', 'Wester Ross · Scotland',
    'James Beard Foundation · New York, NY', 'Kitchen Literacy Project · Syracuse, NY', 'Grills by Demant · Atlanta, GA', 'Eat Local New York · Syracuse, NY'];
  // wine and spirit makers on the website's partner wall (Vine and Still): offered on the drink tabs
  var DRINK_PARTNERS = ['Dr. Konstantin Frank Winery · Hammondsport, NY', 'Hermann J. Wiemer Vineyard · Dundee, NY', 'Heart & Hands Wine Company · Union Springs, NY',
    'Living Roots Wine & Co. · Hammondsport, NY', 'Grace Tyler Estate Winery · Constantia, NY', 'Lock 1 Distilling Company · Phoenix, NY', 'Old Home Distillers · Lebanon, NY',
    'Hollerhorn Distilling · Naples, NY', 'Fort Hamilton Distillery · Brooklyn, NY', 'Albany Distilling Company · Albany, NY'];
  function prodKey(n) { return fold(String(n || '').split('·')[0]).replace(/\bfarms\b/g, 'farm').replace(/[^a-z0-9]+/g, ' ').trim(); }
  // kitchen tabs: farms and food producers; drink tabs (cocktails, beer, spirits…): their own list of makers
  function savedProducers(kit) { var d = store.rows['site/producers'], a = d && (kit ? d.names : d.drinks); return Array.isArray(a) ? a.filter(function (x) { return typeof x === 'string' && x.trim(); }) : []; }
  function producerList(kit) {
    var seen = {}, out = [], uses = {}, tabs = (ed.draft && ed.draft.tabs || []).filter(function (t) { return !!isKitchen(t) === !!kit; });
    tabs.forEach(function (t) { (t.groups || []).forEach(function (g) { (g.items || []).forEach(function (it) {
      var v = String(it.src || '').trim(); if (v) uses[prodKey(v)] = (uses[prodKey(v)] || 0) + 1; }); }); });
    function add(n, kind) { var k = prodKey(n); if (!k || seen[k]) return; seen[k] = 1; out.push({ name: n.trim(), kind: kind, uses: uses[k] || 0 }); }
    (kit ? PARTNERS : DRINK_PARTNERS).forEach(function (n) { add(n, 'partner'); });
    savedProducers(kit).forEach(function (n) { add(n, 'saved'); });
    tabs.forEach(function (t) { (t.groups || []).forEach(function (g) { (g.items || []).forEach(function (it) { if (it.src) add(String(it.src), 'menu'); }); }); });
    var rank = { partner: 0, saved: 1, menu: 1 };
    return out.sort(function (a, b) { return rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name); });
  }
  // a producer typed in that we don't know yet: remember it for next time
  var prodTimer = null;
  function putProducers(kit, names) {
    var d = Object.assign({ names: [], drinks: [] }, store.rows['site/producers'] || {});
    d[kit ? 'names' : 'drinks'] = names; store.rows['site/producers'] = d;
    clearTimeout(prodTimer);
    prodTimer = setTimeout(function () { sb.from('site_docs').upsert([{ path: 'site/producers', data: store.rows['site/producers'] }], { onConflict: 'path' }).then(function () {}, function () {}); }, 300);
  }
  function rememberProducer(v, kit) {
    v = String(v || '').trim(); if (!v || v.length > 120 || !ed.canWrite) return;
    if (producerList(kit).some(function (p) { return prodKey(p.name) === prodKey(v) && p.kind !== 'menu'; })) return;
    putProducers(kit, savedProducers(kit).concat([v]).filter(function (x, i, a) { return a.map(fold).indexOf(fold(x)) === i; }).sort(function (a, b) { return a.localeCompare(b); }));
  }
  function forgetProducer(v, kit) { putProducers(kit, savedProducers(kit).filter(function (x) { return fold(x) !== fold(v); })); }
  function srcCombo(wf, kit) {
    var input = wf.querySelector('input'); if (!input || !ed.canWrite) return;
    input.setAttribute('autocomplete', 'off'); input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
    if (!input.placeholder) input.placeholder = 'Choose…';
    wf.classList.add('ed-ac', 'ed-src');
    var caret = document.createElement('button'); caret.type = 'button'; caret.className = 'ed-src-caret'; caret.tabIndex = -1;
    caret.setAttribute('aria-label', 'Show all farms and producers'); caret.textContent = '▾';
    caret.addEventListener('mousedown', function (e) { e.preventDefault(); if (box.hidden) { input.focus(); open(true); } else close(); });
    wf.appendChild(caret);
    var box = document.createElement('div'); box.className = 'ed-ac-list ed-src-list'; box.setAttribute('role', 'listbox'); box.hidden = true;
    wf.appendChild(box);
    var matches = [], active = -1;
    function close() { box.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); }
    function set(v) { input.value = v; input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true })); }
    function choose(p) { set(p.name); if (p.kind === 'new') rememberProducer(p.name, kit); close(); }
    function paint() {
      box.querySelectorAll('.ed-ac-opt').forEach(function (o, i) { o.classList.toggle('on', i === active); o.setAttribute('aria-selected', i === active); });
      var on = box.querySelector('.ed-ac-opt.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function open(all) {
      var words = all ? [] : fold(input.value).split(/[\s,&+\/]+/).filter(Boolean), cur = prodKey(input.value);
      // the name in this very cell counts as "on the menu" while it's typed: leave it out unless something else uses it
      var list = producerList(kit).filter(function (p) { return !(p.kind === 'menu' && p.uses <= 1 && prodKey(p.name) === cur); });
      matches = list.filter(function (p) { var hay = fold(p.name); return words.every(function (q) { return hay.indexOf(q) !== -1; }); });
      if (!all && matches.length === 1 && fold(matches[0].name) === fold(input.value)) matches = [];
      box.innerHTML = '';
      var head = document.createElement('div'); head.className = 'ed-ac-head';
      head.textContent = matches.length ? (words.length ? matches.length + ' match' + (matches.length === 1 ? '' : 'es') : 'Farms & producers') : (input.value.trim() ? 'New producer “' + input.value.trim() + '”: it will be added to this list' : 'No producers yet. Type one in.');
      box.appendChild(head);
      var lastKind = '';
      matches.forEach(function (p, i) {
        var grp = p.kind === 'partner' ? 'Our partners on the website' : kit ? 'Other farms & producers' : 'Producers';
        if (!words.length && grp !== lastKind) { var gh = document.createElement('div'); gh.className = 'ed-src-grp'; gh.textContent = grp; box.appendChild(gh); lastKind = grp; }
        var o = document.createElement('div'); o.className = 'ed-ac-opt'; o.setAttribute('role', 'option');
        var n = document.createElement('span'); n.className = 'ed-ac-name'; n.textContent = p.name;
        var tg = document.createElement('span'); tg.className = 'ed-ac-tag'; tg.textContent = p.kind === 'partner' ? 'Partner' : '';
        o.appendChild(n); o.appendChild(tg);
        var m = document.createElement('span'); m.className = 'ed-ac-meta'; m.textContent = p.uses ? 'On ' + p.uses + ' menu item' + (p.uses === 1 ? '' : 's') : 'Not on the menu right now';
        o.appendChild(m);
        if (p.kind === 'saved' && !p.uses) {   // a remembered name nobody uses: can be taken off the list
          var x = document.createElement('button'); x.type = 'button'; x.className = 'ed-src-x'; x.textContent = 'Remove'; x.setAttribute('aria-label', 'Remove ' + p.name + ' from the list');
          x.addEventListener('mousedown', function (e) { e.preventDefault(); e.stopPropagation(); forgetProducer(p.name, kit); open(all); });
          m.appendChild(x);
        }
        o.addEventListener('mousedown', function (e) { if (e.target.closest('.ed-src-x')) return; e.preventDefault(); choose(p); });
        o.addEventListener('mousemove', function () { if (active !== i) { active = i; paint(); } });
        box.appendChild(o);
      });
      // a farm or producer that isn't one of our listed partners: add it to the list
      var typed = input.value.trim();
      if (!all && typed && !list.some(function (p) { return prodKey(p.name) === prodKey(typed); })) {
        var addP = { name: typed, kind: 'new' };
        var ao = document.createElement('div'); ao.className = 'ed-ac-opt ed-ac-add'; ao.setAttribute('role', 'option');
        var an = document.createElement('span'); an.className = 'ed-ac-name'; an.textContent = '+ Add “' + typed + '”';
        var am = document.createElement('span'); am.className = 'ed-ac-meta'; am.textContent = 'A new farm or producer (not one of the website’s partners). It will be offered in this list from now on.';
        ao.appendChild(an); ao.appendChild(am);
        ao.addEventListener('mousedown', function (e) { e.preventDefault(); rememberProducer(typed, kit); choose(addP); });
        var idx = matches.length; ao.addEventListener('mousemove', function () { if (active !== idx) { active = idx; paint(); } });
        box.appendChild(ao); matches.push(addP);
        head.textContent = matches.length > 1 ? (matches.length - 1) + ' match' + (matches.length === 2 ? '' : 'es') + ', or add a new one' : 'Not on the list yet';
      }
      active = matches.length && words.length ? 0 : -1;
      box.hidden = false; input.setAttribute('aria-expanded', 'true'); paint();
    }
    input.addEventListener('focus', function () { open(!input.value.trim()); });
    input.addEventListener('input', function () { open(false); });
    function growing() { var a = document.activeElement; return a && a.classList && a.classList.contains('ed-grow') && wf.contains(a); }
    input.addEventListener('blur', function () { setTimeout(function () { if (!growing()) { close(); rememberProducer(input.value, kit); } }, 120); });
    document.addEventListener('focusout', function (e) { if (e.target.classList && e.target.classList.contains('ed-grow') && wf.contains(e.target)) setTimeout(function () { if (!growing() && document.activeElement !== input) { close(); rememberProducer(input.value, kit); } }, 120); });
    input.addEventListener('keydown', function (e) {
      if (box.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { open(!input.value.trim()); e.preventDefault(); return; }
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(matches.length - 1, active + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (active >= 0 && matches[active]) { choose(matches[active]); e.preventDefault(); } else close(); }
      else if (e.key === 'Escape') { close(); e.preventDefault(); }
    });
  }

  /* ---------- Quick add: one row at the top of each tab; pick which section the item goes in ---------- */
  function quickAdd(t, kind) {
    var wine = hasWine(t), q = ed.qa && ed.qa.tab === t.id ? ed.qa : (ed.qa = { tab: t.id, gid: null });
    if (!t.groups.some(function (g) { return g.id === q.gid; })) q.gid = t.groups[0].id;
    var draft = wine ? { name: '', country: '', appellation: '', grape: '', bottle: '', desc: '', price: '' } : { name: '', src: '', desc: '', price: '' };
    var box = document.createElement('section'); box.className = 'ed-qa';
    var hd = document.createElement('div'); hd.className = 'ed-qa-h';
    var ht = document.createElement('h3'); ht.textContent = 'Quick add'; hd.appendChild(ht);
    var hs = document.createElement('span'); hs.textContent = kind ? 'Start typing to pick from the inventory; the section fills in for you.' : 'Add an item straight into any section of ' + (t.label || 'this tab') + '.'; hd.appendChild(hs);
    box.appendChild(hd);
    var row = document.createElement('div'); row.className = 'ed-qa-row' + (wine ? ' is-wine' : '');
    // section (sub-category) picker
    var sw = document.createElement('label'); sw.className = 'ed-field ed-qa-sec';
    var sl = document.createElement('span'); sl.textContent = 'Section'; sw.appendChild(sl);
    var sel = document.createElement('select');
    t.groups.forEach(function (g) { var o = document.createElement('option'); o.value = g.id; o.textContent = g.title || 'Untitled section'; sel.appendChild(o); });
    sel.value = q.gid; sel.addEventListener('change', function () { q.gid = sel.value; });
    sw.appendChild(sel);
    function selGroup() { return t.groups.filter(function (g) { return g.id === sel.value; })[0] || t.groups[0]; }
    function input(label, key, cls) {
      var f = field(label, '', function (v) { draft[key] = v; });
      f.classList.add('ed-qa-f'); if (cls) f.classList.add(cls);
      f.querySelector('input').addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.defaultPrevented) { e.preventDefault(); add(); } });
      // quick add fields aren't on the menu yet: don't publish while typing
      var i = f.querySelector('input'), clone = i.cloneNode(true); i.replaceWith(clone);
      clone.addEventListener('input', function () { draft[key] = clone.value; });
      clone.addEventListener('keydown', function (e) { if (e.key === 'Enter' && !e.defaultPrevented && (!clone.closest('.ed-ac') || clone.getAttribute('aria-expanded') !== 'true')) { e.preventDefault(); add(); } });
      return f;
    }
    var nameF = input(wine ? 'Wine' : (kind ? 'Drink' : 'Dish / drink'), 'name', 'ed-qa-name');
    row.appendChild(nameF); row.appendChild(sw);
    if (wine) {
      row.appendChild(input('Country', 'country'));
      row.appendChild(input('Grape', 'grape'));
      row.appendChild(input('Bottle price', 'bottle', 'ed-qa-num'));
      row.appendChild(input('Glass price', 'glass', 'ed-qa-num'));
    } else {
      var qsf = input(isKitchen(t) ? 'Farm or producer' : 'Producer', 'src'); row.appendChild(qsf); srcCombo(qsf, isKitchen(t));
      row.appendChild(input('Description', 'desc', 'desc'));
      row.appendChild(input('Price', 'price', 'ed-qa-num'));
    }
    var go = document.createElement('button'); go.type = 'button'; go.className = 'ed-btn ed-qa-go'; go.textContent = 'Add'; go.onclick = add;
    row.appendChild(go);
    box.appendChild(row);
    var msg = document.createElement('p'); msg.className = 'ed-qa-msg'; msg.setAttribute('role', 'status'); msg.textContent = q.last || ''; box.appendChild(msg);
    if (kind) {
      var gp = { get title() { return selGroup().title; } };
      invCombo(nameF, draft, t, gp, row, kind, function (x) {
        // pick the menu section that matches the inventory section, e.g. "Red wine" -> Red
        var hit = t.groups.filter(function (g) { return groupFit(x, g); })[0];
        if (hit) { sel.value = hit.id; q.gid = hit.id; }
        if (!wine && !draft.desc && x.pack) { draft.desc = x.pack; var di = row.querySelector('.ed-field.desc input'); if (di) di.value = x.pack; }
        var next = row.querySelectorAll('.ed-qa-f input')[1]; if (next) next.focus();
      });
    }
    function add() {
      var nm = (draft.name || '').trim();
      if (!nm) { msg.textContent = 'Type a name first.'; msg.className = 'ed-qa-msg err'; nameF.querySelector('input').focus(); return; }
      var g = selGroup(), it = {};
      Object.keys(draft).forEach(function (k) { var v = String(draft[k] || '').trim(); if (v || k === 'name' || k === 'desc' || k === 'price' || (wine && k !== 'glass') || (!wine && k === 'src')) it[k] = v; });
      if (wine) { if (!it.glass) delete it.glass; it.price = it.bottle || (it.glass ? it.glass + ' glass' : ''); }
      g.items.push(it);
      q.gid = g.id; q.last = 'Added “' + nm + '” to ' + (g.title || 'the section') + '.';
      markDirty();
      var mainEl = $('edMain'), st = mainEl ? mainEl.scrollTop : 0;
      edRender();
      if (mainEl) mainEl.scrollTop = st;
      var fresh = document.querySelector('.ed-qa .ed-qa-name input'); if (fresh) fresh.focus();
      // flash the new row where it landed
      var gi = t.groups.indexOf(g), grp = document.querySelectorAll('.ed-group')[gi];
      if (grp) { var rows = grp.querySelectorAll('.ed-item'), last = rows[rows.length - 1]; if (last) { last.classList.add('ed-flash'); setTimeout(function () { last.classList.remove('ed-flash'); }, 2200); } }
    }
    return box;
  }

  /* ---------- menu <-> inventory: wine, beer & soft drinks, spirits, coffee & tea (not kitchen or cocktails) ---------- */
  var INV = { items: null, loading: null, missing: false };
  function loadInv(force) {
    if (INV.items && !force) return Promise.resolve(INV.items);
    if (INV.loading) return INV.loading;
    INV.loading = sb.from('inventory_items').select('*').then(function (r) {
      INV.loading = null;
      if (r.error) { INV.missing = true; INV.items = []; return INV.items; }
      INV.missing = false; INV.items = r.data || []; return INV.items;
    }, function () { INV.loading = null; INV.items = []; return INV.items; });
    return INV.loading;
  }
  function invKind(t) {
    if (!t || isKitchen(t)) return null;
    var s = ((t.id || '') + ' ' + (t.label || '')).toLowerCase();
    if (t.id === 'm-bar' || /cocktail/.test(s)) return null;
    if (t.id === 'm-wine' || /wine/.test(s) || hasWine(t)) return 'wine';
    if (t.id === 'm-spirits' || /spirit|liquor|whisk/.test(s)) return 'spirits';
    if (t.id === 'm-beer' || /beer|soft|soda/.test(s)) return 'beer';
    if (t.id === 'm-coffee' || /coffee|tea/.test(s)) return 'coffee';
    return null;
  }
  var KIND_RE = {
    wine: /wine|sparkling|ros[eé]|champagne|port\b|sherry|madeira/,
    beer: /beer|draught|draft|cider|seltzer|soft|soda|juice|mixer|water|non-?alc/,
    spirits: /bourbon|rye|whisk|malt|scotch|gin|vodka|agave|tequila|mezcal|rum|brandy|cognac|specialty|digestif|amaro|liqueur|aperitif|spirit|liquor|sake/,
    coffee: /coffee|tea|espresso/
  };
  var KIND_NAME = { wine: 'wine', beer: 'beer & soft drink', spirits: 'spirit', coffee: 'coffee & tea' };
  function invFor(kind) { return (INV.items || []).filter(function (x) { return KIND_RE[kind].test(fold(x.section)); }); }
  function groupFit(x, g) { // does this inventory item's section match the menu section? ("Red" ~ "Red wine", "Cans" ~ "Canned beer")
    var sec = fold(x.section), words = fold(g.title).split(/[^a-z]+/).filter(function (w) { return w.length >= 3; });
    return words.some(function (w) { return sec.indexOf(w.slice(0, Math.max(3, w.length - 1))) !== -1; });
  }
  function onMenuSet(t) { var s = {}; (t.groups || []).forEach(function (g) { (g.items || []).forEach(function (it) { if (it.name) s[fold(it.name).trim()] = 1; }); }); return s; }
  function invTarget(kind, g) { // where a new menu item goes in the inventory
    var gt = String(g.title || '').trim(), gl = fold(gt);
    if (kind === 'wine') {
      var W = { sparkling: 'Sparkling wine', white: 'White wine', rose: 'Rosé', red: 'Red wine', dessert: 'Dessert wine', orange: 'Orange wine' };
      return { category: 'bev', section: W[gl] || (gt ? gt + (/wine/.test(gl) ? '' : ' wine') : 'Wine'), unit: 'bottle' };
    }
    if (kind === 'beer') {
      if (/draught|draft|tap/.test(gl)) return { category: 'bev', section: 'Draught beer', unit: 'keg' };
      if (/juice|soda|soft|water|mixer|non/.test(gl)) return { category: 'food', section: 'Soft drinks & juice', unit: 'case' };
      return { category: 'bev', section: 'Canned beer', unit: 'case' };
    }
    if (kind === 'spirits') return { category: 'bev', section: gt || 'Liquor', unit: 'bottle' };
    return { category: 'food', section: 'Coffee & tea', unit: 'bag' };
  }
  function newMenuItem(t, x) {
    return hasWine(t) ? { name: x.name, country: '', appellation: '', grape: '', bottle: '', desc: '', price: '' }
      : { name: x.name, src: '', desc: x.pack || '', price: '' };
  }
  function addToInventory(kind, g, name) {
    var tg = invTarget(kind, g);
    var row = { id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'i' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8),
      category: tg.category, section: tg.section, name: name, unit: tg.unit, pack: '', vendor: '', par: null, cost: null, sort: 0, active: true };
    return sb.from('inventory_items').upsert(row, { onConflict: 'id' }).then(function (r) {
      if (r.error) { status(isPermission(r.error) ? 'Your role can’t add to the inventory.' : INV.missing ? 'The inventory isn’t set up yet (run supabase/inventory.sql).' : 'Couldn’t add to the inventory. Try again.', 'err'); return false; }
      (INV.items = INV.items || []).push(row);
      status('Added “' + name + '” to the inventory (' + tg.section + ').', 'ok');
      return true;
    });
  }

  // The item-name field: suggestions from the inventory for this part of the menu, plus "add to inventory".
  function invCombo(wrap, it, t, g, row, kind, onPick) {
    var input = wrap.querySelector('input');
    input.setAttribute('autocomplete', 'off'); input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list'); input.setAttribute('aria-expanded', 'false');
    if (!input.placeholder) input.placeholder = 'Type to search the ' + KIND_NAME[kind] + ' inventory';
    wrap.classList.add('ed-ac');
    var box = document.createElement('div'); box.className = 'ed-ac-list ed-inv-list'; box.setAttribute('role', 'listbox'); box.hidden = true;
    wrap.appendChild(box);
    var opts = [], active = -1;
    function close() { box.hidden = true; active = -1; input.setAttribute('aria-expanded', 'false'); }
    function setField(cls, v) { var el = row.querySelector(cls); if (el) el.value = v; }
    function choose(o) {
      if (o.add) {
        var name = input.value.trim(); close();
        addToInventory(kind, g, name);
        return;
      }
      var x = o.x;
      it.name = x.name; input.value = x.name;
      if (!hasWine(t) && !it.desc && x.pack) { it.desc = x.pack; setField('.ed-field.desc input', x.pack); }
      close();
      if (onPick) { onPick(x); return; } // quick add: nothing is on the menu yet
      markDirty();
      var next = row.querySelectorAll('input')[1]; if (next) next.focus();
    }
    function paint() {
      box.querySelectorAll('.ed-ac-opt').forEach(function (o, i) { o.classList.toggle('on', i === active); o.setAttribute('aria-selected', i === active); });
      var on = box.querySelector('.ed-ac-opt.on'); if (on) on.scrollIntoView({ block: 'nearest' });
    }
    function open() {
      if (!INV.items) { loadInv().then(function () { if (document.activeElement === input) open(); }); return; }
      var q = fold(input.value).trim(), words = q.split(/\s+/).filter(Boolean), menuHas = onMenuSet(t), mine = fold(it.name).trim();
      var all = invFor(kind);
      var list = all.filter(function (x) { var hay = fold(x.name + ' ' + x.section + ' ' + x.pack); return words.every(function (w) { return hay.indexOf(w) !== -1; }); })
        .map(function (x) { var k = fold(x.name).trim(); return { x: x, fit: groupFit(x, g), on: !!menuHas[k] && k !== mine, exact: k === q }; })
        .sort(function (a, b) { return (a.on - b.on) || (b.fit - a.fit) || String(a.x.name).localeCompare(b.x.name); })
        .slice(0, 60);
      opts = list.filter(function (o) { return !o.on; });
      var exact = all.some(function (x) { return fold(x.name).trim() === q; });
      if (q && !exact) opts.push({ add: true });
      box.innerHTML = '';
      var head = document.createElement('div'); head.className = 'ed-ac-head';
      head.textContent = INV.missing ? 'Inventory isn’t set up yet' : !all.length ? 'No ' + KIND_NAME[kind] + ' items in the inventory yet'
        : 'From the inventory' + (words.length ? ' · ' + list.length + ' match' + (list.length === 1 ? '' : 'es') : ' · ' + g.title);
      box.appendChild(head);
      list.forEach(function (o) {
        var el = document.createElement('div'); el.className = 'ed-ac-opt' + (o.on ? ' is-on' : ''); el.setAttribute('role', 'option');
        var n = document.createElement('span'); n.className = 'ed-ac-name'; n.textContent = o.x.name;
        var tag = document.createElement('span'); tag.className = 'ed-ac-tag'; tag.textContent = o.on ? 'On the menu' : o.fit ? g.title : '';
        var m = document.createElement('span'); m.className = 'ed-ac-meta'; m.textContent = [o.x.section, o.x.pack].filter(Boolean).join(' · ');
        el.appendChild(n); el.appendChild(tag); el.appendChild(m);
        if (!o.on) {
          var idx = opts.indexOf(o);
          el.addEventListener('mousedown', function (e) { e.preventDefault(); choose(o); });
          el.addEventListener('mousemove', function () { if (active !== idx) { active = idx; paint(); } });
        } else el.setAttribute('aria-disabled', 'true');
        box.appendChild(el);
      });
      if (q && !exact && !INV.missing) {
        var tg = invTarget(kind, g);
        var add = document.createElement('div'); add.className = 'ed-ac-opt ed-ac-add'; add.setAttribute('role', 'option');
        var an = document.createElement('span'); an.className = 'ed-ac-name'; an.textContent = '+ Add “' + input.value.trim() + '” to the inventory';
        var am = document.createElement('span'); am.className = 'ed-ac-meta'; am.textContent = (tg.category === 'bev' ? 'Beer, wine & liquor' : 'Food') + ' · ' + tg.section;
        add.appendChild(an); add.appendChild(am);
        var ai = opts.length - 1;
        add.addEventListener('mousedown', function (e) { e.preventDefault(); choose({ add: true }); });
        add.addEventListener('mousemove', function () { if (active !== ai) { active = ai; paint(); } });
        box.appendChild(add);
      }
      if (!list.length && !(q && !exact && !INV.missing)) {
        var none = document.createElement('div'); none.className = 'ed-ac-empty';
        none.textContent = INV.missing ? 'Run supabase/inventory.sql in Supabase to link the menu to the inventory.' : 'Add ' + KIND_NAME[kind] + ' items on the Inventory page and they’ll show up here.';
        box.appendChild(none);
      }
      active = words.length && opts.length ? 0 : -1;
      box.hidden = false; input.setAttribute('aria-expanded', 'true'); paint();
    }
    input.addEventListener('focus', open);
    input.addEventListener('input', open);
    input.addEventListener('blur', function () { setTimeout(close, 120); });
    input.addEventListener('keydown', function (e) {
      if (box.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { open(); e.preventDefault(); return; }
      if (box.hidden) return;
      if (e.key === 'ArrowDown') { active = Math.min(opts.length - 1, active + 1); paint(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = Math.max(0, active - 1); paint(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (active >= 0 && opts[active]) { choose(opts[active]); e.preventDefault(); } }
      else if (e.key === 'Escape') { close(); e.preventDefault(); }
    });
  }

  // "+ From inventory": pick items from the inventory to add to this menu section, several in a row.
  function invPicker(t, g, kind) {
    var panel = document.createElement('div'); panel.className = 'ed-inv';
    var top = document.createElement('div'); top.className = 'ed-inv-top';
    var q = document.createElement('input'); q.type = 'search'; q.placeholder = 'Search the ' + KIND_NAME[kind] + ' inventory'; q.value = ed.invQ || '';
    var showAll = document.createElement('label'); showAll.className = 'ed-inv-all';
    var cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !!ed.invAll;
    showAll.appendChild(cb); showAll.appendChild(document.createTextNode(' All ' + KIND_NAME[kind] + ' sections'));
    top.appendChild(q); top.appendChild(showAll); panel.appendChild(top);
    var listEl = document.createElement('div'); listEl.className = 'ed-inv-list2'; panel.appendChild(listEl);
    function paint() {
      listEl.innerHTML = '';
      if (!INV.items) { listEl.textContent = 'Loading the inventory…'; loadInv().then(paint); return; }
      if (INV.missing) { listEl.innerHTML = '<p class="ed-inv-note">The inventory isn’t set up yet. Run <b>supabase/inventory.sql</b> in Supabase, then add items on the <a href="#inventory">Inventory</a> page.</p>'; return; }
      var words = fold(q.value).split(/\s+/).filter(Boolean), menuHas = onMenuSet(t);
      var all = invFor(kind), fits = all.filter(function (x) { return groupFit(x, g); });
      var pool = (ed.invAll || !fits.length) ? all : fits;
      var list = pool.filter(function (x) { var hay = fold(x.name + ' ' + x.section + ' ' + x.pack); return words.every(function (w) { return hay.indexOf(w) !== -1; }); })
        .sort(function (a, b) { var A = !!menuHas[fold(a.name).trim()], B = !!menuHas[fold(b.name).trim()]; return (A - B) || String(a.section).localeCompare(b.section) || String(a.name).localeCompare(b.name); });
      var avail = list.filter(function (x) { return !menuHas[fold(x.name).trim()]; }).length;
      var note = document.createElement('p'); note.className = 'ed-inv-note';
      note.textContent = !all.length ? 'No ' + KIND_NAME[kind] + ' items in the inventory yet. Add them on the Inventory page.'
        : avail + ' not on the menu yet' + (pool === fits && !ed.invAll ? ' in sections like “' + g.title + '”' : '') + '. Click Add to put one at the end of “' + g.title + '”.';
      listEl.appendChild(note);
      list.slice(0, 200).forEach(function (x) {
        var on = !!menuHas[fold(x.name).trim()];
        var r = document.createElement('div'); r.className = 'ed-inv-row' + (on ? ' is-on' : '');
        var n = document.createElement('div'); n.className = 'ed-inv-name';
        var b = document.createElement('b'); b.textContent = x.name; n.appendChild(b);
        var sm = document.createElement('small'); sm.textContent = [x.section, x.pack].filter(Boolean).join(' · '); n.appendChild(sm);
        r.appendChild(n);
        if (on) { var tg = document.createElement('span'); tg.className = 'ed-inv-tag'; tg.textContent = 'On the menu'; r.appendChild(tg); }
        else r.appendChild(btn('Add', 'Add ' + x.name + ' to ' + g.title, function () {
          var mainEl = $('edMain'), st = mainEl ? mainEl.scrollTop : 0;
          g.items.push(newMenuItem(t, x)); markDirty(); ed.invQ = q.value; edRender();
          if (mainEl) mainEl.scrollTop = st;
          var again = document.querySelector('.ed-inv input[type=search]'); if (again && q.value) { again.focus(); again.setSelectionRange(again.value.length, again.value.length); }
          status('Added ' + x.name + ' to ' + g.title + '. Publishing…', 'dirty');
        }));
        listEl.appendChild(r);
      });
    }
    q.addEventListener('input', function () { ed.invQ = q.value; paint(); });
    cb.addEventListener('change', function () { ed.invAll = cb.checked; paint(); });
    paint();
    return panel;
  }

  function field(label, val, onchange, deferSave) {
    var w = document.createElement('label'); w.className = 'ed-field';
    var s = document.createElement('span'); s.textContent = label; w.appendChild(s);
    var i = document.createElement('input'); i.value = val || ''; i.disabled = !ed.canWrite;
    // deferSave: keep the change in the draft while typing, publish when the field is left
    i.addEventListener('input', function () { onchange(i.value); if (!deferSave) markDirty(); });
    if (deferSave) i.addEventListener('change', function () { onchange(i.value); markDirty(); });
    w.appendChild(i); return w;
  }
  function area(label, val, onchange) {
    var w = document.createElement('label'); w.className = 'ed-field';
    var s = document.createElement('span'); s.textContent = label; w.appendChild(s);
    var i = document.createElement('textarea'); i.rows = 3; i.value = val || ''; i.disabled = !ed.canWrite;
    i.addEventListener('input', function () { onchange(i.value); markDirty(); });
    w.appendChild(i); return w;
  }
  function btn(text, label, fn) { var b = document.createElement('button'); b.type = 'button'; b.className = 'ed-btn small'; b.textContent = text; b.setAttribute('aria-label', label); b.disabled = !ed.canWrite; b.onclick = fn; return b; }
  function confirmBtn(text, fn, label) {
    var b = btn(text, label || text, function () {
      if (b.dataset.armed) { fn(); return; }
      b.dataset.armed = '1'; b.textContent = 'Confirm';
      setTimeout(function () { if (b.isConnected) { delete b.dataset.armed; b.textContent = text; } }, 3000);
    });
    b.classList.add('danger'); return b;
  }

  function save() {
    clearTimeout(ed.timer);
    if (!ed.dirty || !ed.canWrite || !ed.draft) return Promise.resolve();
    if (ed.saving) { ed.timer = setTimeout(save, 300); return Promise.resolve(); }
    ed.saving = true; ed.dirty = false; status('Publishing…');
    var p = splitMenu(ed.draft), rows = [], gone = [], done = {};
    Object.keys(p.groups).forEach(function (id) {
      var str = JSON.stringify(p.groups[id]);
      if (str !== store.saved['g:' + id]) { rows.push({ path: 'site/menu/groups/' + id, data: p.groups[id] }); done['g:' + id] = str; }
    });
    Object.keys(store.saved).forEach(function (k) { if (k.indexOf('g:') === 0 && !p.groups[k.slice(2)]) { gone.push('site/menu/groups/' + k.slice(2)); done[k] = null; } });
    var sup = JSON.stringify(p.supper);
    if (p.supper && sup !== store.saved.supper) { rows.push({ path: 'site/supper', data: p.supper }); done.supper = sup; }
    var metaStr = JSON.stringify(p.meta); p.meta.updatedAt = Date.now(); done.meta = metaStr;
    // sections first, then the table of contents that points at them, then remove dropped sections
    (rows.length ? upsert(rows) : Promise.resolve())
      .then(function () { return upsert([{ path: 'site/menu', data: p.meta }]); })
      .then(function () { return gone.length ? sb.from('site_docs').delete().in('path', gone).then(check) : null; })
      .then(function () {
        Object.keys(done).forEach(function (k) { if (done[k] === null) delete store.saved[k]; else store.saved[k] = done[k]; });
        ed.saving = false;
        if (!ed.dirty) status('Published. Live on the website.', 'ok');
      }, function (e) {
        ed.saving = false; ed.dirty = true;
        if (isPermission(e)) { status('Your account isn’t allowed to change the menu.', 'err'); return; }
        if (e && (e.code === 'PGRST301' || /jwt/i.test(e.message || ''))) { status('Your sign-in expired. Sign in again to publish.', 'err'); return; }
        status('Couldn’t publish. Check your connection; trying again shortly.', 'err');
        ed.timer = setTimeout(save, 5000);
      });
    return Promise.resolve();
  }
  $('edSave').onclick = function () { ed.dirty = true; save(); };
  // print the published menu (what the website shows), not unsaved edits
  $('printMenusBtn').onclick = function () { window.EdenMenuPrint.choose(currentMenu); };
  window.addEventListener('beforeunload', function (e) { if (ed.dirty || ed.saving) { save(); e.preventDefault(); e.returnValue = ''; } });
})();
