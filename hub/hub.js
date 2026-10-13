/* Eden Hub: the touch screen in the restaurant (edencny-staff.com/hub/).
 * Signs in once with the Hub's own login (role 'hub', supabase/hub.sql) and stays signed in. The Owner and managers
 * can open it too. For now it's a sample page that proves the screen, the login and touch all work; the real
 * panels (reservations, events, a shared ordering list…) come later.
 * Made for a kiosk browser: no zooming or long-press menus, the screen kept awake, a reload at 4 am to pick up
 * updates, and settings (full screen, reload, sign out) hidden behind a 3-second press on the logo.
 */
(function () {
  'use strict';
  var CFG = window.EDEN_STAFF_CONFIG || {};
  var $ = function (id) { return document.getElementById(id); };
  var sb = window.supabase.createClient(CFG.supabase.url, CFG.supabase.key, { auth: { persistSession: true, autoRefreshToken: true } });
  var session = null, entered = false;

  function show(id) { ['loading', 'signin', 'noaccess', 'app'].forEach(function (x) { $(x).hidden = x !== id; }); }

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
      $('chkLogin').textContent = r.data.hub ? 'Signed in with the Hub login' : 'Signed in as ' + session.user.email + ' (Owner or manager preview)';
      $('chkLogin').classList.add('ok');
      $('sheetWho').textContent = 'Signed in as ' + session.user.email + '.';
      show('app'); start();
    }, function () { entered = false; setTimeout(function () { if (session) enter(); }, 20000); });
  }
  $('noaccessOut').addEventListener('click', function () { sb.auth.signOut(); });

  /* ---------- the clock and the connection ---------- */
  var started = false;
  function start() {
    if (started) return; started = true;
    tick(); setInterval(tick, 1000);
    net(); window.addEventListener('online', net); window.addEventListener('offline', net);
    wake(); renderOrder();
  }
  function tick() {
    var d = new Date();
    $('clock').textContent = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    $('date').textContent = d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
    // 4:00 am: reload, to pick up any changes to the Hub page
    if (d.getHours() === 4 && d.getMinutes() === 0 && d.getSeconds() < 2 && navigator.onLine) location.reload();
  }
  function net() {
    var on = navigator.onLine;
    $('netDot').classList.toggle('off', !on); $('netText').textContent = on ? 'Online' : 'No internet';
  }

  /* ---------- keep the screen on (where the browser allows it) ---------- */
  var lock = null;
  function wake() {
    if (!('wakeLock' in navigator)) { $('chkWake').textContent = 'Screen stays on: set this in the kiosk browser’s settings'; return; }
    navigator.wakeLock.request('screen').then(function (l) {
      lock = l; $('chkWake').textContent = 'Screen stays on'; $('chkWake').classList.add('ok');
      l.addEventListener('release', function () { lock = null; });
    }, function () { $('chkWake').textContent = 'Screen stays on: tap the screen once to allow it'; });
  }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && !lock && started) wake(); });
  document.addEventListener('pointerdown', function () { if (!lock && started && 'wakeLock' in navigator) wake(); }, { passive: true });

  /* ---------- no long-press menus, no double-tap or pinch zoom ---------- */
  document.addEventListener('contextmenu', function (e) { if (!/INPUT|TEXTAREA/.test(e.target.tagName)) e.preventDefault(); });
  document.addEventListener('gesturestart', function (e) { e.preventDefault(); });
  document.addEventListener('touchmove', function (e) { if (e.touches.length > 1 && !e.target.closest('#pad')) e.preventDefault(); }, { passive: false });

  /* ---------- sample ordering list (on this screen only, for now) ---------- */
  var KEY = 'eden-hub-order-sample';
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '[]') || []; } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(KEY, JSON.stringify(a)); } catch (e) {} }
  var items = load();
  function renderOrder() {
    var ul = $('orderList'); ul.innerHTML = '';
    items.forEach(function (it, i) {
      var li = document.createElement('li'); li.className = 'hb-item' + (it.done ? ' done' : '');
      var b = document.createElement('button'); b.type = 'button'; b.className = 'hb-tick'; b.setAttribute('aria-pressed', it.done ? 'true' : 'false');
      b.innerHTML = '<span class="hb-box" aria-hidden="true"></span>';
      var t = document.createElement('span'); t.className = 'hb-itxt'; t.textContent = it.text; b.appendChild(t);
      var w = document.createElement('span'); w.className = 'hb-when'; w.textContent = new Date(it.at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); b.appendChild(w);
      b.addEventListener('click', function () { it.done = !it.done; save(items); renderOrder(); });
      var x = document.createElement('button'); x.type = 'button'; x.className = 'hb-x'; x.setAttribute('aria-label', 'Remove ' + it.text); x.textContent = '×';
      x.addEventListener('click', function () { items.splice(i, 1); save(items); renderOrder(); });
      li.appendChild(b); li.appendChild(x); ul.appendChild(li);
    });
    $('orderEmpty').hidden = items.length > 0;
    $('orderClear').hidden = !items.some(function (x) { return x.done; });
  }
  $('orderForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var v = $('orderIn').value.replace(/\s+/g, ' ').trim(); if (!v) return;
    items.unshift({ text: v.charAt(0).toUpperCase() + v.slice(1), done: false, at: Date.now() });
    items = items.slice(0, 60); save(items); $('orderIn').value = ''; renderOrder();
    $('orderIn').blur();   // closes the on-screen keyboard
  });
  $('orderClear').addEventListener('click', function () { items = items.filter(function (x) { return !x.done; }); save(items); renderOrder(); });

  /* ---------- touch test ---------- */
  var pad = $('pad'), taps = 0, live = {}, maxFingers = 0;
  function dot(x, y, cls) {
    var r = pad.getBoundingClientRect(), d = document.createElement('span');
    d.className = 'hb-ripple' + (cls ? ' ' + cls : ''); d.style.left = (x - r.left) + 'px'; d.style.top = (y - r.top) + 'px';
    pad.appendChild(d); setTimeout(function () { d.remove(); }, cls ? 900 : 700);
  }
  pad.addEventListener('pointerdown', function (e) {
    e.preventDefault(); pad.setPointerCapture && pad.setPointerCapture(e.pointerId);
    live[e.pointerId] = true; taps++;
    var n = Object.keys(live).length; maxFingers = Math.max(maxFingers, n);
    $('padHint').hidden = true; dot(e.clientX, e.clientY);
    $('touchCount').textContent = taps + (taps === 1 ? ' tap' : ' taps');
    $('touchInfo').textContent = 'Touch is working: ' + (e.pointerType === 'touch' ? 'finger' : e.pointerType === 'pen' ? 'pen' : 'mouse') + ', ' + n + ' at once now (most so far: ' + maxFingers + ').';
    $('chkTouch').textContent = 'Touch works' + (maxFingers > 1 ? ', including ' + maxFingers + ' fingers at once' : ''); $('chkTouch').classList.add('ok');
  });
  pad.addEventListener('pointermove', function (e) { if (live[e.pointerId]) dot(e.clientX, e.clientY, 'trail'); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach(function (t) { pad.addEventListener(t, function (e) { delete live[e.pointerId]; }); });

  /* ---------- Hub settings: press and hold the logo for 3 seconds ---------- */
  var hold = null;
  $('logo').addEventListener('pointerdown', function () { $('logo').classList.add('holding'); hold = setTimeout(openSheet, 3000); });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach(function (t) { $('logo').addEventListener(t, function () { clearTimeout(hold); $('logo').classList.remove('holding'); }); });
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
