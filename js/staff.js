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
        signinMsg.textContent = /rate|too many/i.test(r.error.message || '') ? 'Too many attempts. Try again in a few minutes.' : 'That email and password did not work.';
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

  var pwForm = $('newpw').querySelector('form'), pwMsg = pwForm.querySelector('.msg');
  pwForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var a = pwForm.password.value, b = pwForm.password2.value;
    if (a.length < 10) { pwMsg.textContent = 'Use at least 10 characters.'; return; }
    if (a !== b) { pwMsg.textContent = 'The two passwords don’t match.'; return; }
    pwMsg.textContent = 'Saving…';
    sb.auth.updateUser({ password: a }).then(function (r) {
      if (r.error) { pwMsg.textContent = 'Could not save: ' + (r.error.message || 'try again.'); return; }
      recovering = false; history.replaceState(null, '', location.pathname); pwForm.reset(); pwMsg.textContent = '';
      enter();
    });
  });

  document.querySelectorAll('[data-act="signout"]').forEach(function (b) {
    b.addEventListener('click', function () {
      if (ed.dirty) { save(); }
      sb.auth.signOut().then(function () { location.replace(location.pathname); });
    });
  });

  sb.auth.onAuthStateChange(function (event, s) {
    session = s;
    if (event === 'PASSWORD_RECOVERY') { recovering = true; show('newpw'); return; }
    if (event === 'SIGNED_OUT' || !s) { role = null; show('signin'); return; }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') { if (!recovering) enter(); else show('newpw'); }
  });

  function enter() {
    if (!session) { show('signin'); return; }
    show('loading'); $('loadingMsg').textContent = 'Checking your access…';
    sb.rpc('staff_role').then(function (r) {
      if (r.error) { $('loadingMsg').textContent = 'Could not reach the database. Check your connection and reload.'; return; }
      role = r.data || null;
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
        ed.canWrite = EDIT_ROLES.indexOf(role) !== -1;
        staffName = name;
        document.querySelectorAll('[data-mgr]').forEach(function (el) { el.hidden = !isMgr(); });
        document.querySelectorAll('[data-menu]').forEach(function (el) { el.hidden = role === 'scheduler'; });
        document.querySelectorAll('[data-prep]').forEach(function (el) { el.hidden = !canPrep(); });
        show('app');
        if (!started) { started = true; if (role !== 'scheduler') startData(); }
        route();
      });
      });
    });
  }

  /* ---------------- pages: Home, Menu, Schedule ---------------- */
  var VIEWS = { home: 'viewHome', menu: 'viewMenu', schedule: 'viewSchedule', prep: 'viewPrep', inventory: 'viewInventory' };
  var view = null, menuOpened = false, staffName = '';
  function isMgr() { return role === 'owner' || role === 'manager' || role === 'scheduler'; }
  function canPrep() { return isMgr() || role === 'kitchen'; }
  function route() {
    if ($('app').hidden) return;
    var v = (location.hash || '').replace(/^#/, '');
    if (!VIEWS[v] || (v === 'schedule' && !isMgr()) || (v === 'menu' && role === 'scheduler') || ((v === 'prep' || v === 'inventory') && !canPrep())) v = 'home';
    if (('#' + v) !== location.hash) history.replaceState(null, '', '#' + v);
    if (view === 'menu' && v !== 'menu' && ed.dirty) save();
    view = v;
    Object.keys(VIEWS).forEach(function (k) { $(VIEWS[k]).hidden = k !== v; });
    document.querySelectorAll('.ed-nav [data-view]').forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('data-view') === v ? 'true' : 'false'); });
    $('edSave').hidden = v !== 'menu';
    document.title = v === 'menu' ? 'Menu · Eden Staff' : v === 'schedule' ? 'Schedule · Eden Staff' : v === 'prep' ? 'Prep List · Eden Staff' : v === 'inventory' ? 'Inventory · Eden Staff' : 'Eden Staff';
    if (v === 'menu') {
      INV.items = null; // pick up inventory changes made since
      if (!menuOpened && store.loaded) { menuOpened = true; openEditor(); }
      else if (!store.loaded) status('Loading the menu…');
      else status(ed.dirty ? 'Unsaved changes. Publishing automatically…' : (ed.canWrite ? 'Ready. Changes publish to the website automatically.' : 'View only. Your role can see the menu but not change it.'), ed.dirty ? 'dirty' : (ed.canWrite ? '' : 'err'));
    } else if (v === 'schedule') {
      status('');
      if (window.EdenSchedule) window.EdenSchedule.show({ sb: sb, el: $('viewSchedule'), status: status, role: role, user: session && session.user });
    } else if (v === 'inventory') {
      status('');
      if (!store.loaded) loadAll().catch(function () {}); // menu, for "add from the menu" 
      if (window.EdenInventory) window.EdenInventory.show({ sb: sb, el: $('viewInventory'), status: status, role: role, name: staffName,
        getMenu: function () { return menuData || assembleMenu() || null; } });
    } else if (v === 'prep') {
      status('');
      showPrep();
      if (!store.loaded) loadAll().then(showPrep, function () { status('Couldn’t load the menu. Check your connection and reload.', 'err'); });
    } else {
      status(''); renderHome();
    }
  }
  function showPrep() {
    if (!window.EdenPrep) return;
    window.EdenPrep.show({ el: $('viewPrep'), status: status, getMenu: function () {
      if (!store.loaded) return null;
      return menuData || assembleMenu() || window.EDEN_MENU_SEED || { tabs: [] };
    } });
  }
  window.addEventListener('hashchange', route);
  function renderHome() {
    var first = String(staffName || '').split(/[\s@]/)[0];
    var h = new Date().getHours();
    $('homeHello').textContent = (h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening') + (first ? ', ' + first : '');
    var site = CFG.publicSite || '';
    $('homeSite').href = site || '#'; $('homeSite').hidden = !site;
    $('homePad').href = site ? site.replace(/#.*$/, '') + '#ipad' : '#'; $('homePad').hidden = !site;
    homeMeta();
  }
  function fmtWhen(t) {
    var d = new Date(t); if (isNaN(d)) return '';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  }
  function homeMeta() {
    var m = store.rows['site/menu'];
    $('homeMenuMeta').textContent = !store.loaded ? '' : m && m.updatedAt ? 'Last published ' + fmtWhen(m.updatedAt) : 'Not set up yet';
    if (isMgr() && window.EdenSchedule) window.EdenSchedule.summary(sb).then(function (t) { $('homeSchedMeta').textContent = t || ''; }, function () {});
  }

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
      homeMeta();
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

  function edRender() {
    var side = $('edTabs'), main = $('edMain');
    side.innerHTML = ''; main.innerHTML = '';
    var d = ed.draft;
    if (!d) { importBanner(main); return; }
    if (ed.tab !== 'supper' && ed.tab >= d.tabs.length) ed.tab = 0;
    d.tabs.forEach(function (t, i) { var b = document.createElement('button'); b.type = 'button'; b.textContent = t.label || 'Untitled'; b.setAttribute('aria-current', i === ed.tab); b.onclick = function () { ed.tab = i; edRender(); }; side.appendChild(b); });
    var sb2 = document.createElement('button'); sb2.type = 'button'; sb2.className = 'ed-side-sup'; sb2.textContent = 'Supper Club'; sb2.setAttribute('aria-current', ed.tab === 'supper'); sb2.onclick = function () { ed.tab = 'supper'; edRender(); }; side.appendChild(sb2);
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
        var row = document.createElement('div'); row.className = 'ed-item' + (it.hidden ? ' is-hidden' : '');
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
          row.appendChild(field('Farm or producer', it.src, function (v) { it.src = v; }));
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
  function invCombo(wrap, it, t, g, row, kind) {
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
      close(); markDirty();
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
  window.addEventListener('beforeunload', function (e) { if (ed.dirty || ed.saving) { save(); e.preventDefault(); e.returnValue = ''; } });
})();
