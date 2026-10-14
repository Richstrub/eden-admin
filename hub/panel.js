/* Eden Hub: one page of the Hub's menu, shown in the Hub's pop-up (an iframe). Shares the Hub's sign-in. */
(function () {
  'use strict';
  var CFG = window.EDEN_STAFF_CONFIG || {};
  var el = document.getElementById('panel');
  var p = (/[?&]p=([\w-]+)/.exec(location.search) || [])[1] || 'orders';
  var NAME_KEY = 'eden-hub-name', NAME_MS = 10 * 60 * 1000;
  function hubName() { try { var x = JSON.parse(localStorage.getItem(NAME_KEY) || 'null'); return x && Date.now() - x.at < NAME_MS ? x.name : ''; } catch (e) { return ''; } }
  function setHubName(n) { try { localStorage.setItem(NAME_KEY, JSON.stringify({ name: n, at: Date.now() })); } catch (e) {} }
  function msg(t) { el.innerHTML = ''; var x = document.createElement('p'); x.className = 'od-empty'; x.textContent = t; el.appendChild(x); }
  if (!window.supabase || !CFG.supabase) { msg('Couldn’t load. Check the internet connection.'); return; }
  var sb = window.supabase.createClient(CFG.supabase.url, CFG.supabase.key, { auth: { persistSession: true, autoRefreshToken: true } });
  sb.auth.getSession().then(function (r) {
    var session = r && r.data && r.data.session;
    if (!session) { msg('The Hub is signed out. Close this and sign in on the Hub.'); return; }
    if (p === 'orders') { window.EdenOrders.show({ sb: sb, el: el, mode: 'hub' }); return; }
    if (p === 'calendar') { el.classList.add('hp-cal'); window.EdenCal.show({ sb: sb, el: el, name: 'Hub', canEdit: false, status: function () {} }); return; }
    if (p === 'preshift') { el.classList.add('hp-pre'); window.EdenPreshift.show({ sb: sb, el: el, role: 'hub', name: 'Hub', hub: true, noNotes: true, api: '../' }); return; }
    if (p === 'prep') {
      // initials: on this shared screen, whoever is working types theirs in once (remembered for 10 minutes)
      var who = document.createElement('label'); who.className = 'ck-who hp-who';
      var s = document.createElement('span'); s.textContent = 'Your initials';
      var i = document.createElement('input'); i.type = 'text'; i.maxLength = 20; i.autocomplete = 'off'; i.placeholder = 'e.g. MS'; i.value = hubName();
      i.addEventListener('input', function () { setHubName(i.value.trim()); });
      who.appendChild(s); who.appendChild(i);
      var body = document.createElement('div');
      el.innerHTML = ''; el.appendChild(who); el.appendChild(body); el.classList.add('hp-prep');
      window.EdenPrep.show({ sb: sb, el: body, role: 'hub', name: 'Hub', cook: true, lists: { kitchen: true, bar: false }, who: function () { return i.value.trim() || hubName(); } });
      return;
    }
    window.EdenChecklists.show({ sb: sb, el: el, mode: 'hub', list: p });
  }, function () { msg('Couldn’t load. Check the internet connection.'); });
})();
