/* Eden Hub: the touch screen in the restaurant (edencny-staff.com/hub/), made for the Hearth's 27-inch portrait screen.
 * Shows the time and day, the weather in Syracuse, today's pre-shift (reservations without guest spend, pre-shift
 * notes, menu changes), the kitchen prep list with a bar for how much is done, and the calendar for two weeks.
 * Signs in once with the Hub's own login (role 'hub', supabase/hub.sql) and stays signed in; everything it shows
 * comes from one read-only call, hub_board(). The Owner and managers can open it too.
 * Made for a kiosk browser: no zooming or long-press menus, the screen kept awake, a reload at 4 am to pick up
 * updates, and settings (full screen, reload, sign out) behind a 3-second press on the EDEN logo.
 */
// The Hearth's built-in browser is Chrome 83, which doesn't have replaceChildren (Chrome 86+).
if (!Element.prototype.replaceChildren) {
  Element.prototype.replaceChildren = function () {
    while (this.firstChild) this.removeChild(this.firstChild);
    this.append.apply(this, arguments);
  };
}
(function () {
  'use strict';
  var CFG = window.EDEN_STAFF_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var sb = window.supabase.createClient(CFG.supabase.url, CFG.supabase.key, { auth: { persistSession: true, autoRefreshToken: true } });
  var session = null, entered = false, started = false;
  var WX = { lat: 43.0481, lon: -76.1474 };   // 118 E. Genesee St., Syracuse
  // Near real time: every 5 s the Hub asks for a tiny fingerprint of the board (hub_stamp) and only downloads the
  // board when it changed. Without hub_stamp (hub.sql not rerun yet) it falls back to the full board every minute.
  var POLL_MS = 5 * 1000, BOARD_MS = 60 * 1000, MENU_MS = 30 * 60 * 1000, WX_MS = 10 * 60 * 1000, PAGE_MS = 60 * 1000;

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (Array.isArray(attrs) || typeof attrs === 'string') { kids = attrs; attrs = null; }
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v; else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function show(id) { ['loading', 'signin', 'noaccess', 'app'].forEach(function (x) { $(x).hidden = x !== id; }); }
  function t12(hhmm) {
    var m = /^(\d{1,2}):(\d{2})/.exec(hhmm || ''); if (!m) return hhmm || '';
    var H = +m[1], ap = H >= 12 ? 'pm' : 'am'; H = H % 12 || 12;
    return H + (m[2] === '00' ? '' : ':' + m[2]) + ' ' + ap;
  }
  function isoDay(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayLabel(iso, today) {
    if (iso === today) return 'Today';
    var t = new Date(today + 'T12:00:00'); t.setDate(t.getDate() + 1);
    if (iso === isoDay(t)) return 'Tomorrow';
    return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  }
  function ago(ts) {
    if (!ts) return ''; var m = Math.round((Date.now() - new Date(ts)) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }

  /* ---------- signing in ---------- */
  sb.auth.onAuthStateChange(function (event, s) {
    session = s;
    if (!s) { entered = false; show('signin'); return; }
    if (!entered) enter();
  });
  sb.auth.getSession().then(function (r) { if (!r.data.session) show('signin'); });

  $('signinForm').addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target, email = f.email.value.trim(), pw = f.password.value, btn = f.querySelector('button');
    if (!email || !pw) { $('signinMsg').textContent = 'Type the Hub login email and password.'; return; }
    btn.disabled = true; $('signinMsg').textContent = 'Signing in…';
    sb.auth.signInWithPassword({ email: email, password: pw }).then(function (r) {
      btn.disabled = false;
      if (r.error) { $('signinMsg').textContent = /invalid/i.test(r.error.message || '') ? 'That email and password don’t match.' : 'Couldn’t sign in. Check the Wi-Fi and try again.'; return; }
      $('signinMsg').textContent = ''; f.password.value = '';
    });
  });

  function enter() {
    entered = true;
    sb.rpc('hub_ok').then(function (r) {
      if (r.error) {
        $('loadingMsg').textContent = /hub_ok|function/i.test(r.error.message || '') ? 'The Hub isn’t set up yet: run supabase/hub.sql in Supabase.' : 'Couldn’t reach Eden’s database. Retrying…';
        show('loading'); entered = false; setTimeout(function () { if (session) enter(); }, 20000); return;
      }
      if (!r.data || !r.data.ok) {
        $('noaccessMsg').textContent = 'You’re signed in as ' + ((session.user && session.user.email) || 'someone') + ', which can’t open the Hub. Sign out and use the Hub login.';
        show('noaccess'); return;
      }
      $('sheetWho').textContent = 'Signed in as ' + session.user.email + (r.data.hub ? ' (the Hub login).' : ' (Owner or manager preview).');
      show('app'); start();
    }, function () { entered = false; setTimeout(function () { if (session) enter(); }, 20000); });
  }
  $('noaccessOut').addEventListener('click', function () { sb.auth.signOut(); });

  function start() {
    if (started) return; started = true;
    tick(); setInterval(tick, 1000);
    net(); window.addEventListener('online', function () { net(); board(); weather(); }); window.addEventListener('offline', net);
    wake();
    loadMenu().then(poll);   // the first check downloads the board
    setInterval(poll, POLL_MS); setInterval(loadMenu, MENU_MS);
    setInterval(repaint, 60 * 1000);   // keep the 'now' line and 'minutes ago' current between changes
    weather(); setInterval(weather, WX_MS);
    watchForUpdates();
  }

  /* ---------- update itself: when a new version of the Hub is published, reload within a minute ---------- */
  var PAGE_SIG = null;
  function pageSig() {
    // the page's own HTML names every script and stylesheet with a version, so it changes whenever the Hub does
    return fetch(location.pathname + '?check=' + Date.now(), { cache: 'no-store' }).then(function (r) { return r.ok ? r.text() : null; })
      .then(function (t) { return t ? (t.match(/\?v=[\w.-]+/g) || []).join('|') + '|' + t.length : null; }, function () { return null; });
  }
  function watchForUpdates() {
    pageSig().then(function (s) { PAGE_SIG = s; });
    setInterval(function () {
      if (!navigator.onLine) return;
      pageSig().then(function (s) {
        if (!s) return;
        if (!PAGE_SIG) { PAGE_SIG = s; return; }
        if (s !== PAGE_SIG && !popPage && !(document.activeElement && /INPUT|TEXTAREA/.test(document.activeElement.tagName))) location.reload();   // not while a pop-up is open
      });
    }, PAGE_MS);
  }

  /* ---------- clock ---------- */
  function tick() {
    var d = new Date();
    $('clock').textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    $('date').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    // 4:00 am: reload, to pick up any changes to the Hub page
    if (d.getHours() === 4 && d.getMinutes() === 0 && d.getSeconds() < 2 && navigator.onLine) location.reload();
  }
  function net() {
    var on = navigator.onLine;
    $('netDot').classList.toggle('off', !on); $('netText').textContent = on ? 'Online' : 'No internet: showing the last update';
  }

  /* ---------- everything from Eden: pre-shift, prep, calendar ---------- */
  var MENU = null, LAST = null, STAMP = null, lastBoard = 0, polling = false;
  function poll() {
    if (document.hidden || polling || !navigator.onLine) return;
    polling = true;
    sb.rpc('hub_stamp').then(function (r) {
      polling = false;
      if (r.error || typeof r.data !== 'string') { if (Date.now() - lastBoard >= BOARD_MS) board(); return; }
      if (r.data !== STAMP) { STAMP = r.data; board(); }
      else if (Date.now() - lastBoard >= 10 * 60 * 1000) board();   // a full refresh every 10 minutes anyway
    }, function () { polling = false; });
  }
  function repaint() { if (LAST) { paintPreshift(LAST); paintShifts(LAST); paintWeek(LAST); } }

  /* ---------- the menu on the left: each page opens in a pop-up over the board ---------- */
  var POP_IDLE_MS = 3 * 60 * 1000, popTimer = null, popPage = '';
  function popTouched() { clearTimeout(popTimer); if (popPage) popTimer = setTimeout(closePop, POP_IDLE_MS); }   // nobody's touched it for 3 minutes: back to the board
  function openPop(page, title) {
    popPage = page;
    $('popH').textContent = title || '';
    $('pop').hidden = false;
    var f = $('popFrame');
    f.src = 'panel.html?p=' + encodeURIComponent(page) + '&t=' + Date.now();
    f.onload = function () { try { f.contentWindow.document.addEventListener('pointerdown', popTouched, { passive: true }); f.contentWindow.document.addEventListener('keydown', popTouched); } catch (e) {} };
    markNav(page); popTouched();
  }
  function closePop() {
    clearTimeout(popTimer); popPage = '';
    $('pop').hidden = true; $('popFrame').src = 'about:blank';
    markNav(''); STAMP = null; poll();   // show anything just changed right away
  }
  function markNav(page) { [].forEach.call(document.querySelectorAll('.hb-nb'), function (b) { b.setAttribute('aria-current', b.getAttribute('data-p') === page ? 'true' : 'false'); }); }
  [].forEach.call(document.querySelectorAll('.hb-nb'), function (b) {
    b.addEventListener('click', function () { var pg = b.getAttribute('data-p'); if (!pg) closePop(); else if (pg !== popPage) openPop(pg, b.getAttribute('data-title')); });
  });
  $('popClose').addEventListener('click', closePop);
  // the Kitchen prep card on the board opens the prep list (the same page the menu used to)
  $('prepCard').addEventListener('click', function () { if (popPage !== 'prep') openPop('prep', 'Kitchen prep list'); });
  $('prepCard').addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openPop('prep', 'Kitchen prep list'); } });
  $('pop').addEventListener('pointerdown', popTouched, { passive: true });
  function paintNav(d) {
    $('navOrders').textContent = d.orders_open == null ? '' : d.orders_open ? d.orders_open + ' to order' : 'All in';
    (d.checklists || []).forEach(function (l) {
      var el = document.querySelector('[data-ck="' + l.id + '"]'); if (!el) return;
      el.textContent = l.done + ' / ' + l.total; el.classList.toggle('full', l.total > 0 && l.done === l.total);
    });
  }
  function loadMenu() {
    if (!window.EdenPrep || !window.EdenPrep.fetchMenu) return Promise.resolve();
    return window.EdenPrep.fetchMenu(sb).then(function (m) { MENU = m; if (LAST) paintPrep(LAST); });
  }
  function board() {
    if (document.hidden) return;
    sb.rpc('hub_board').then(function (r) {
      if (r.error || !r.data || r.data.error) {
        if (r.error && /hub_board|function/i.test(r.error.message || '')) $('preBody').replaceChildren(h('p', { cls: 'hb-muted', text: 'One step left: run the updated supabase/hub.sql in Supabase.' }));
        return;
      }
      var menuChanged = LAST && JSON.stringify(LAST.menu || []) !== JSON.stringify(r.data.menu || []);
      LAST = r.data; lastBoard = Date.now();
      if (menuChanged) loadMenu();   // a menu section was edited: pick up new prep lines now
      paintPreshift(r.data); paintPrep(r.data); paintShifts(r.data); paintWeek(r.data); paintCal(r.data); paintNav(r.data);
      $('updated').textContent = ' · updated ' + new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    }, function () {});
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && started) board(); });

  var CELEB = /birthday|anniversary|special occasion|date night|celebrat|engagement|proposal|graduation/i;
  function paintPreshift(d) {
    var box = $('preBody'), P = d.preshift, R = P && P.reservations, list = (R && R.list) || [];
    box.replaceChildren();
    $('preWhen').textContent = P && P.received ? 'OpenTable, ' + ago(P.received) : '';
    // the numbers
    if (R) {
      var tiles = [];
      var covers = R.covers || list.reduce(function (n, r) { return n + (r.size || 0); }, 0);
      tiles.push([String(covers), 'Covers']);
      tiles.push([String(list.length || (R.stats || []).length ? list.length : 0), list.length === 1 ? 'Reservation' : 'Reservations']);
      var n = function (f) { return list.filter(f).length; }, tags = function (r) { return r.tags || []; };
      var c;
      c = n(function (r) { return tags(r).some(function (t) { return CELEB.test(t); }); }); if (c) tiles.push([String(c), 'Celebrations']);
      c = n(function (r) { return tags(r).some(function (t) { return /allerg|dietary/i.test(t); }); }); if (c) tiles.push([String(c), 'Allergies']);
      c = n(function (r) { return tags(r).some(function (t) { return /vip/i.test(t); }); }); if (c) tiles.push([String(c), 'VIPs']);
      c = n(function (r) { return (r.size || 0) >= 6; }); if (c) tiles.push([String(c), 'Parties of 6+']);
      if (!list.length) (R.stats || []).slice(0, 4).forEach(function (s) { tiles.push([s.value, s.label]); });
      box.appendChild(h('div', { cls: 'hb-tiles' }, tiles.slice(0, 6).map(function (t) { return h('div', { cls: 'hb-tile' }, [h('b', { text: t[0] }), h('span', { text: t[1] })]); })));
      // heads-up: tagged, noted or big tables, in time order
      var watch = list.slice().sort(function (a, b) { return String(a.time).localeCompare(String(b.time)); })
        .filter(function (r) { return tags(r).some(function (t) { return !/returning/i.test(t); }) || r.notes || (r.size || 0) >= 6; });
      if (watch.length) {
        box.appendChild(h('h3', { cls: 'hb-sub', text: 'Heads-up tonight' }));
        box.appendChild(h('ul', { cls: 'hb-watch' }, watch.slice(0, 8).map(function (r) {
          return h('li', [h('span', { cls: 'hb-t', text: t12(r.time) }),
            h('span', { cls: 'hb-w' }, [h('b', { text: (r.name || 'Party') + ' · ' + r.size }), r.notes ? h('small', { text: r.notes }) : null]),
            h('span', { cls: 'hb-tags' }, tags(r).filter(function (t) { return !/returning/i.test(t); }).slice(0, 3).map(function (t) { return h('span', { cls: 'hb-chip' + (CELEB.test(t) ? ' gold' : /allerg|dietary/i.test(t) ? ' red' : ''), text: t }); }))]);
        })));
        if (watch.length > 8) box.appendChild(h('p', { cls: 'hb-muted', text: '+ ' + (watch.length - 8) + ' more on the staff page’s Pre-shift.' }));
      }
    } else {
      box.appendChild(h('p', { cls: 'hb-wait', text: 'Tonight’s reservations appear here once OpenTable’s email arrives.' }));
    }
    // notes from the Owner and managers
    var notes = (d.notes || []).filter(function (x) { return x.body && x.body.trim(); });
    if (notes.length) {
      box.appendChild(h('h3', { cls: 'hb-sub', text: 'Notes' }));
      box.appendChild(h('ul', { cls: 'hb-notes' }, notes.map(function (x) { return h('li', [h('p', { text: x.body }), x.author ? h('small', { text: '— ' + x.author }) : null]); })));
    }
    // menu changes
    var menu = d.menu || [];
    if (menu.length) {
      box.appendChild(h('h3', { cls: 'hb-sub', text: 'Menu changes, last 24 hours' }));
      box.appendChild(h('div', { cls: 'hb-chips' }, menu.slice(0, 8).map(function (m) { return h('span', { cls: 'hb-chip', text: m.title }); })));
    }
  }

  function paintPrep(d) {
    var box = $('prepBody'), st = d.prep;
    if (!st) { box.replaceChildren(h('p', { cls: 'hb-muted', text: 'The prep list isn’t set up yet.' })); setBar(0, 0); return; }
    $('prepFor').textContent = st.for_date ? 'For ' + new Date(st.for_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) : '';
    if (!MENU || !window.EdenPrep || !window.EdenPrep.kitchenLines) { box.replaceChildren(h('p', { cls: 'hb-muted', text: 'Loading the menu…' })); return; }
    var lines = window.EdenPrep.kitchenLines(MENU, st);
    var done = lines.filter(function (l) { return l.done; }).length;
    setBar(done, lines.length);
    // what's left, by section (done lines drop off)
    var left = lines.filter(function (l) { return !l.done; });
    box.replaceChildren();
    if (!lines.length) { box.appendChild(h('p', { cls: 'hb-muted', text: 'No dishes on the Kitchen menu yet.' })); return; }
    if (!left.length) { box.appendChild(h('p', { cls: 'hb-alldone', text: 'Everything’s prepped. Nice work.' })); return; }
    var groups = [], by = {}, cols = h('div', { cls: 'hb-pcols' }), keep = box.scrollTop;
    left.forEach(function (l) { if (!by[l.section]) { by[l.section] = []; groups.push(l.section); } by[l.section].push(l); });
    box.appendChild(cols);
    groups.forEach(function (g) {
      cols.appendChild(h('div', { cls: 'hb-pgroup' }, [h('h4', { text: g + ' · ' + by[g].length }),
        h('ul', by[g].map(function (l) { return h('li', [h('span', { cls: 'hb-box', 'aria-hidden': 'true' }), h('span', { text: l.label }), l.dish ? h('small', { text: l.dish }) : null]); }))]));
    });
    box.scrollTop = keep;   // a refresh doesn't jump the list back to the top
  }
  function setBar(done, total) {
    var pct = total ? Math.round(done / total * 100) : 0;
    $('prepFill').style.width = pct + '%';
    $('prepFill').classList.toggle('full', total > 0 && done === total);
    $('prepBar').setAttribute('aria-valuenow', String(pct));
    $('prepPct').textContent = total ? pct + '%' : '–';
    $('prepSub').textContent = total ? done + ' of ' + total + ' done · ' + (total - done) + ' to go' : '';
  }

  /* ---------- today's schedule: one row per shift on an hour scale, like the staff page's day view ---------- */
  // Shifts can end at a server "out" time; those are drawn to an assumed clock time with a faded end.
  var ENDS = { cut1: { label: '1st cut', at: '20:00' }, cut2: { label: '2nd cut', at: '21:00' }, close: { label: 'close', at: '22:00' } };
  function mins(t) { var p = String(t || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function endMin(s) { if (ENDS[s.end]) return mins(ENDS[s.end].at); var e = mins(s.end); if (s.end && e <= mins(s.start)) e += 1440; return e; }
  function clock(m) { m = ((m % 1440) + 1440) % 1440; var H = Math.floor(m / 60), M = m % 60; return (H % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H >= 12 ? 'p' : 'a'); }
  function fmtT(t) { return ENDS[t] ? ENDS[t].label : t ? clock(mins(t)) : ''; }
  function shiftHrs(s) { if (!s.start || !s.end) return null; var d = endMin(s) - mins(s.start); return d > 0 ? d / 60 : null; }
  function paintShifts(d) {
    var box = $('shiftsBody'), sum = $('shiftsSum');
    box.replaceChildren(); sum.textContent = '';
    if (d.shifts == null) { box.appendChild(h('p', { cls: 'hb-muted', text: 'One step left: run the updated supabase/hub.sql in Supabase.' })); return; }
    if (!d.shifts_posted) { box.appendChild(h('p', { cls: 'hb-muted', text: 'This week’s schedule hasn’t been published yet.' })); return; }
    var list = (d.shifts || []).filter(function (s) { return s.start; }).sort(function (a, b) { return mins(a.start) - mins(b.start) || endMin(a) - endMin(b) || String(a.name).localeCompare(String(b.name)); });
    if (!list.length) { box.appendChild(h('p', { cls: 'hb-muted', text: 'Nobody is scheduled today.' })); return; }
    var lo = Infinity, hi = -Infinity;
    list.forEach(function (s) { var a = mins(s.start), b = endMin(s); if (b <= a) b = a + 60; lo = Math.min(lo, a); hi = Math.max(hi, b); });
    lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
    if (hi - lo < 6 * 60) hi = Math.min(lo + 6 * 60, 30 * 60);
    var span = hi - lo, pct = function (m) { return ((m - lo) / span * 100) + '%'; };
    var names = {}; list.forEach(function (s) { names[s.name] = 1; });
    var last = list.reduce(function (x, s) { return endMin(s) > endMin(x) || (endMin(s) === endMin(x) && ENDS[s.end]) ? s : x; }, list[0]);
    sum.textContent = Object.keys(names).length + ' working · first in ' + fmtT(list[0].start) + ' · last out ' + fmtT(last.end);
    var tl = h('div', { cls: 'hb-tl' });
    var scale = h('div', { cls: 'hb-tl-scale' });
    for (var m = lo; m <= hi; m += 60) scale.appendChild(h('span', { cls: 'hb-tl-tick', style: 'left:' + pct(m), text: clock(m) }));
    tl.appendChild(h('div', { cls: 'hb-tl-row hb-tl-ruler' }, [h('div', { cls: 'hb-tl-who' }), scale]));
    var lanes = h('div', { cls: 'hb-tl-lanes' });
    list.forEach(function (s) {
      var a = mins(s.start), b = endMin(s), approx = !!ENDS[s.end], hrs = shiftHrs(s);
      if (b <= a) b = a + 60;
      var pos = s.role || s.position || '';
      lanes.appendChild(h('div', { cls: 'hb-tl-row' }, [
        h('div', { cls: 'hb-tl-who' }, [h('b', { text: s.name }), h('small', { text: [pos, hrs != null ? (approx ? '~' : '') + (Math.round(hrs * 4) / 4) + 'h' : ''].filter(Boolean).join(' · ') })]),
        h('div', { cls: 'hb-tl-lane' }, [h('div', { cls: 'hb-tl-bar' + (approx ? ' approx' : ''), style: 'left:' + pct(a) + ';width:calc(' + pct(b) + ' - ' + pct(a) + ')' },
          [h('span', { text: fmtT(s.start) + '–' + fmtT(s.end) + (s.note ? ' · ' + s.note : '') })])])
      ]));
    });
    tl.appendChild(lanes);
    // hour lines and a "now" line, over the lanes only
    var grid = h('div', { cls: 'hb-tl-grid', 'aria-hidden': 'true' });
    for (var g = lo; g <= hi; g += 60) grid.appendChild(h('i', { style: 'left:' + pct(g) }));
    var now = new Date(), nowM = now.getHours() * 60 + now.getMinutes();
    if (nowM < lo && nowM + 1440 <= hi) nowM += 1440;
    if (nowM >= lo && nowM <= hi) grid.appendChild(h('b', { cls: 'hb-tl-now', style: 'left:' + pct(nowM) }));
    tl.appendChild(grid);
    box.appendChild(tl);
  }

  /* ---------- this week: seven day columns, like the staff page's week view ---------- */
  var WDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function shortName(n) { var p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || ''); }
  function paintWeek(d) {
    var box = $('weekBody'), when = $('weekWhen');
    box.replaceChildren(); when.textContent = '';
    if (d.week_shifts == null) { box.appendChild(h('p', { cls: 'hb-muted', text: 'One step left: run the updated supabase/hub.sql in Supabase.' })); return; }
    var ws = d.week_start ? new Date(d.week_start + 'T12:00:00') : null;
    var dateOf = function (i) { var x = new Date(ws); x.setDate(x.getDate() + i); return x; };
    if (ws) { var we = dateOf(6), sameM = ws.getMonth() === we.getMonth();
      when.textContent = ws.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' – ' + (sameM ? we.getDate() : we.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })); }
    if (!d.shifts_posted) { box.appendChild(h('p', { cls: 'hb-muted', text: 'This week’s schedule hasn’t been published yet.' })); return; }
    var todayI = ws ? Math.round((new Date(d.today + 'T12:00:00') - ws) / 864e5) : -1;
    var grid = h('div', { cls: 'hb-wk' });
    for (var i = 0; i < 7; i++) {
      var list = d.week_shifts.filter(function (s) { return s.day === i && s.start; }).sort(function (a, b) { return mins(a.start) - mins(b.start) || endMin(a) - endMin(b) || String(a.name).localeCompare(String(b.name)); });
      var col = h('div', { cls: 'hb-wk-col' + (i === todayI ? ' today' : i < todayI ? ' past' : '') }, [
        h('div', { cls: 'hb-wk-h' }, [h('span', { text: i === todayI ? 'Today' : WDAYS[i] }), h('b', { text: ws ? (dateOf(i).getMonth() + 1) + '/' + dateOf(i).getDate() : '' }), h('small', { text: list.length ? list.length + ' working' : 'Nobody' })])]);
      list.forEach(function (s) {
        col.appendChild(h('div', { cls: 'hb-wk-s' }, [h('b', { text: shortName(s.name) }), h('span', { text: fmtT(s.start) + '–' + fmtT(s.end) })]));
      });
      grid.appendChild(col);
    }
    box.appendChild(grid);
  }

  var TYPE = { private: 'Private event', supper: 'Supper Club', catering: 'Catering', meeting: 'Meeting', closed: 'Closed', other: '' };
  function paintCal(d) {
    var ul = $('calBody'), ev = d.events;
    ul.replaceChildren();
    if (!ev) { ul.appendChild(h('li', { cls: 'hb-muted', text: 'The calendar isn’t set up yet.' })); return; }
    if (!ev.length) { ul.appendChild(h('li', { cls: 'hb-muted', text: 'Nothing on the calendar for the next two weeks.' })); return; }
    ev.slice(0, 10).forEach(function (e) {
      var time = e.all_day ? 'All day' : e.start ? t12(e.start) + (e.end ? ' – ' + t12(e.end) : '') : '';
      var meta = [TYPE[e.type] != null ? TYPE[e.type] : e.type, e.guests ? e.guests + ' guests' : '', e.room].filter(Boolean).join(' · ');
      ul.appendChild(h('li', { cls: 'hb-ev' + (e.date === d.today ? ' today' : '') + (e.type === 'closed' ? ' closed' : '') }, [
        h('span', { cls: 'hb-ev-d' }, [h('b', { text: dayLabel(e.date, d.today) }), h('small', { text: time })]),
        h('span', { cls: 'hb-ev-t' }, [h('b', { text: e.title }), meta ? h('small', { text: meta }) : null])]));
    });
    if (ev.length > 10) ul.appendChild(h('li', { cls: 'hb-muted', text: '+ ' + (ev.length - 10) + ' more in the Calendar.' }));
  }

  /* ---------- weather (Open-Meteo, no key needed) ---------- */
  var WMO = [[[0], 'Clear', 'sun'], [[1], 'Mostly clear', 'sun'], [[2], 'Partly cloudy', 'part'], [[3], 'Cloudy', 'cloud'], [[45, 48], 'Fog', 'fog'],
    [[51, 53, 55, 56, 57], 'Drizzle', 'rain'], [[61, 63, 80, 81], 'Rain', 'rain'], [[65, 82], 'Heavy rain', 'rain'], [[66, 67], 'Freezing rain', 'rain'],
    [[71, 73, 77, 85], 'Snow', 'snow'], [[75, 86], 'Heavy snow', 'snow'], [[95, 96, 99], 'Thunderstorms', 'storm']];
  function wmo(code) { for (var i = 0; i < WMO.length; i++) if (WMO[i][0].indexOf(code) !== -1) return WMO[i]; return [[], '', 'cloud']; }
  var ICON = {
    sun: '<circle cx="24" cy="24" r="9"/><path d="M24 5v6M24 37v6M5 24h6M37 24h6M10.6 10.6l4.2 4.2M33.2 33.2l4.2 4.2M10.6 37.4l4.2-4.2M33.2 14.8l4.2-4.2"/>',
    part: '<circle cx="18" cy="18" r="7"/><path d="M18 5v3M5 18h3M8.8 8.8l2.1 2.1M27.2 8.8l-2.1 2.1"/><path d="M16 38h20a7 7 0 0 0 0-14 10 10 0 0 0-19 3 6 6 0 0 0-1 11z"/>',
    cloud: '<path d="M13 37h23a8 8 0 0 0 0-16 11 11 0 0 0-21 3 7 7 0 0 0-2 13z"/>',
    rain: '<path d="M13 30h23a8 8 0 0 0 0-16 11 11 0 0 0-21 3 7 7 0 0 0-2 13z"/><path d="M17 35l-2 6M25 35l-2 6M33 35l-2 6"/>',
    snow: '<path d="M13 30h23a8 8 0 0 0 0-16 11 11 0 0 0-21 3 7 7 0 0 0-2 13z"/><path d="M17 37v4M15 39h4M25 37v4M23 39h4M33 37v4M31 39h4"/>',
    storm: '<path d="M13 30h23a8 8 0 0 0 0-16 11 11 0 0 0-21 3 7 7 0 0 0-2 13z"/><path d="M25 32l-4 7h6l-4 7"/>',
    fog: '<path d="M8 20h32M12 27h28M8 34h28"/>'
  };
  function icon(name, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    s.setAttribute('viewBox', '0 0 48 48'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', cls || 'hb-wxi');
    s.innerHTML = ICON[name] || ICON.cloud; return s;
  }
  function weather() {
    var url = 'https://api.open-meteo.com/v1/forecast?latitude=' + WX.lat + '&longitude=' + WX.lon +
      '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
      '&hourly=temperature_2m,weather_code,precipitation_probability' +
      '&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,sunset' +
      '&temperature_unit=fahrenheit&wind_speed_unit=mph&timezone=America%2FNew_York&forecast_days=2';
    fetch(url).then(function (r) { return r.json(); }).then(paintWx, function () {
      if (!$('wx').querySelector('.hb-wx-now')) $('wx').replaceChildren(h('p', { cls: 'hb-muted', text: 'Weather unavailable right now.' }));
    });
  }
  function paintWx(w) {
    if (!w || !w.current) return;
    var c = w.current, k = wmo(c.weather_code), dly = w.daily || {}, hr = w.hourly || {};
    var sunset = dly.sunset && dly.sunset[0] ? new Date(dly.sunset[0]).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '';
    // tonight's service: 5, 7 and 9 pm
    var today = isoDay(new Date()), svc = [];
    (hr.time || []).forEach(function (t, i) {
      if (t.slice(0, 10) === today && [17, 19, 21].indexOf(+t.slice(11, 13)) !== -1) svc.push({ t: +t.slice(11, 13), temp: hr.temperature_2m[i], code: hr.weather_code[i], rain: hr.precipitation_probability[i] });
    });
    var box = $('wx'); box.replaceChildren();
    box.appendChild(h('div', { cls: 'hb-wx-now' }, [icon(k[2]), h('div', [h('b', { cls: 'hb-wx-temp', text: Math.round(c.temperature_2m) + '°' }),
      h('span', { text: k[1] + (Math.abs(c.apparent_temperature - c.temperature_2m) >= 3 ? ' · feels ' + Math.round(c.apparent_temperature) + '°' : '') })])]));
    box.appendChild(h('p', { cls: 'hb-wx-day', text: [
      dly.temperature_2m_max ? 'High ' + Math.round(dly.temperature_2m_max[0]) + '° · Low ' + Math.round(dly.temperature_2m_min[0]) + '°' : '',
      dly.precipitation_probability_max && dly.precipitation_probability_max[0] != null ? dly.precipitation_probability_max[0] + '% rain' : '',
      c.wind_speed_10m >= 12 ? 'Wind ' + Math.round(c.wind_speed_10m) + ' mph' : '',
      sunset ? 'Sunset ' + sunset : ''].filter(Boolean).join(' · ') }));
    if (svc.length) box.appendChild(h('div', { cls: 'hb-wx-svc', 'aria-label': 'Tonight' }, svc.map(function (s) {
      return h('div', [h('small', { text: (s.t - 12) + ' pm' }), icon(wmo(s.code)[2], 'hb-wxs'), h('b', { text: Math.round(s.temp) + '°' }), s.rain >= 30 ? h('small', { cls: 'hb-rain', text: s.rain + '%' }) : null]);
    })));
  }

  /* ---------- keep the screen on (where the browser allows it) ---------- */
  var lock = null;
  function wake() {
    if (!('wakeLock' in navigator)) return;
    navigator.wakeLock.request('screen').then(function (l) { lock = l; l.addEventListener('release', function () { lock = null; }); }, function () {});
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !lock && started) wake(); });
  document.addEventListener('pointerdown', function () { if (!lock && started && 'wakeLock' in navigator) wake(); }, { passive: true });

  /* ---------- no long-press menus, no double-tap or pinch zoom ---------- */
  document.addEventListener('contextmenu', function (e) { if (!/INPUT|TEXTAREA/.test(e.target.tagName)) e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) { if (e.touches.length > 1) e.preventDefault(); }, { passive: false });

  /* ---------- Hub settings: press and hold the logo for 3 seconds ---------- */
  var hold = null, taps = [];
  function endHold() { clearTimeout(hold); hold = null; $('logo').classList.remove('holding'); }
  $('logo').addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    endHold(); $('logo').classList.add('holding'); hold = setTimeout(function () { endHold(); openSheet(); }, 3000);
    // or 5 quick taps
    var now = Date.now(); taps = taps.filter(function (t) { return now - t < 2500; }); taps.push(now);
    if (taps.length >= 5) { taps = []; endHold(); openSheet(); }
  });
  // a finger that slides off counts as letting go only well away from the logo; a mouse leaving lets go at once
  $('logo').addEventListener('pointerup', endHold);
  $('logo').addEventListener('pointerleave', function (e) { if (e.pointerType === 'mouse') endHold(); });
  document.addEventListener('pointerup', function () { if (hold) endHold(); });
  $('logo').addEventListener('keydown', function (e) { if (e.key === 'Enter' && e.shiftKey) openSheet(); });
  function openSheet() {
    $('logo').classList.remove('holding');
    $('sheetInfo').textContent = 'Screen ' + screen.width + ' × ' + screen.height + ' · page ' + window.innerWidth + ' × ' + window.innerHeight + ' · ' + (navigator.maxTouchPoints || 0) + '-point touch';
    $('sheet').hidden = false; $('btnClose').focus();
  }
  $('btnClose').addEventListener('click', function () { $('sheet').hidden = true; });
  $('btnReload').addEventListener('click', function () { location.reload(); });
  $('btnFull').addEventListener('click', function () {
    var el = document.documentElement;
    if (document.fullscreenElement) document.exitFullscreen(); else if (el.requestFullscreen) el.requestFullscreen().catch(function () {});
    $('sheet').hidden = true;
  });
  $('btnOut').addEventListener('click', function () {
    if (!confirm('Sign the Hub out? You’ll need the Hub login to sign it back in.')) return;
    $('sheet').hidden = true; sb.auth.signOut();
  });
})();
