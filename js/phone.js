/* Eden staff site on a phone: a bar along the bottom with four places and More, and More opens every
 * section as tiles (icon, name, a line about it), grouped like the side menu, with Notes, To-do and the
 * account at the bottom. Built from the side menu itself, so each person sees only what their role can
 * open, with the same badges. Desktop and iPad keep the side menu (the CSS only shows this on phones). */
(function () {
  'use strict';
  var PHONE = window.matchMedia ? window.matchMedia('(max-width: 700px)') : { matches: false, addListener: function () {} };
  var I = {   // simple line icons, 24×24
    home: 'M12 3v2 M12 19v2 M3 12h2 M19 12h2 M5.6 5.6l1.4 1.4 M17 17l1.4 1.4 M5.6 18.4L7 17 M17 7l1.4-1.4 M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8z',
    preshift: 'M4 18h16 M6 18a6 6 0 0 1 12 0 M12 9V7 M10 7h4',
    resources: 'M5 4h10a3 3 0 0 1 3 3v13H8a3 3 0 0 1-3-3z M5 17a3 3 0 0 1 3-3h10',
    checklists: 'M9 6h11 M9 12h11 M9 18h11 M4 6l1 1 2-2 M4 12l1 1 2-2 M4 18l1 1 2-2',
    eod: 'M4 20h4L19 9l-4-4L4 16z M14 6l4 4',
    menu: 'M6 3h9l4 4v14H6z M14 3v5h5 M9 12h7 M9 16h7',
    calendar: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5',
    catering: 'M4 6h16v12H4z M4 7l8 6 8-6',
    prep: 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01',
    inventory: 'M3 7l9-4 9 4-9 4z M3 7v10l9 4 9-4V7 M12 11v10',
    temps: 'M14 14V5a2 2 0 0 0-4 0v9a4 4 0 1 0 4 0z',
    orders: 'M3 4h2l2.4 11h10.2L20 7H6.2 M9 20h.01 M17 20h.01',
    recipes: 'M6 3h12v18H6z M9 7h6 M9 11h6 M9 15h3',
    menucosts: 'M12 3v18 M16 7h-6a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8',
    schedule: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5 M12 13v3l2 1',
    employees: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21a7 7 0 0 1 14 0 M16 3a4 4 0 0 1 0 8 M22 21a7 7 0 0 0-5-6.7',
    reviews: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
    permissions: 'M6 11h12v10H6z M8 11V7a4 4 0 0 1 8 0v4',
    email: 'M4 6h16v12H4z M4 7l8 6 8-6',
    promo: 'M4 10v4h3l7 4V6L7 10z M18 9a4 4 0 0 1 0 6',
    payroll: 'M4 20V10 M10 20V4 M16 20v-7 M21 20H3',
    analytics: 'M3 17l6-6 4 4 8-8 M15 7h6v6',
    partners: 'M12 21s-7-4.4-9-9.3C1.6 8 4 4 8 5.2c1.6.5 3 1.8 4 3.3 1-1.5 2.4-2.8 4-3.3 4-1.2 6.4 2.8 5 6.5-2 4.9-9 9.3-9 9.3z',
    todo: 'M4 12l5 5L20 6',
    notes: 'M4 20h4L19 9l-4-4L4 16z',
    more: 'M5 12h.01 M12 12h.01 M19 12h.01'
  };
  var HINT = {
    home: 'What needs you, tonight and the week', preshift: 'Tonight’s meeting and education', resources: 'Guides, PDFs and links',
    checklists: 'Opening, closing and side work', 'checklists/edit': 'Change the checklists', eod: 'File tonight’s report', 'eod/past': 'Every report so far', 'eod/download': 'Spreadsheets of the reports',
    menu: 'The website menu and Supper Club', calendar: 'Events, shifts and time off', catering: 'Inquiries, questionnaires and BEOs',
    prep: 'Today’s list for the kitchen', inventory: 'Counts, invoices and ordering', 'inventory/food': 'Food items and counts', 'inventory/beverages': 'Wine, beer, spirits and more', 'inventory/dry': 'Paper, to-go and cleaning',
    temps: 'Coolers and freezers', orders: 'What to order (and the Hub’s list)', recipes: 'Recipes and their costs', menucosts: 'Food cost % for every dish',
    schedule: 'Build and publish the week', employees: 'People, logins and access', reviews: 'Employee reviews', 'employees/permissions': 'What each class can see',
    email: 'The business inboxes', promo: 'Emails to guests',
    'payroll/overview': 'Revenue, payroll and cash flow', 'payroll/week': 'This week’s hours and tips', 'payroll/past': 'Every payroll week', 'payroll/rates': 'How each person is paid', 'payroll/products': 'What sells, from Square',
    analytics: 'Website visitors and history', 'analytics/logins': 'Who signed in, and when', partners: 'Stories about the farms', todo: 'Your list'
  };
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function svg(key) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', I[key] || I.more); s.appendChild(p); return s;
  }
  function iconKey(view) { var v = String(view || ''); if (v === 'employees/permissions') return 'permissions'; if (/^payroll/.test(v)) return v === 'payroll/overview' ? 'payroll' : 'menucosts'; return v.split('/')[0]; }
  function shown(a) { return a && !a.hidden && !a.closest('[hidden]'); }
  function label(a) { var t = ''; a.childNodes.forEach(function (n) { if (n.nodeType === 3) t += n.textContent; }); return t.replace(/\s+/g, ' ').trim(); }
  function badge(a) { var b = a.querySelector('.sb-badge'); return b && !b.hidden && b.textContent.trim() ? b.textContent.trim() : ''; }
  // the side menu's groups and links, as this person sees them now
  function places() {
    var nav = document.querySelector('#sideNav .sb-nav'); if (!nav) return [];
    var out = [], today = nav.querySelector('a.sb-today');
    if (shown(today)) out.push({ title: '', links: [today] });
    nav.querySelectorAll('.sb-group').forEach(function (g) {
      if (!shown(g)) return;
      var t = g.querySelector('.sb-g'), links = [].filter.call(g.querySelectorAll('a[href]'), function (a) { return shown(a) && !a.classList.contains('sb-soon') && !/soon/i.test((a.querySelector('.sb-badge') || {}).textContent || ''); });
      if (links.length) out.push({ title: t ? t.textContent.trim() : '', links: links });
    });
    return out;
  }
  function current() { var hsh = String(location.hash || '#home').replace(/^#/, '') || 'home'; return hsh; }
  function isOn(a) {
    var href = (a.getAttribute('href') || '').replace(/^#/, ''), cur = current();
    if (!href || a.target) return false;
    return cur === href || (cur.indexOf(href + '/') === 0 && !a.classList.contains('sb-sub'));
  }
  var PRI = ['home', 'calendar', 'prep', 'inventory', 'schedule', 'catering', 'orders', 'recipes', 'checklists', 'preshift'];
  var bar = null;
  function paintBar() {
    if (!bar) return;
    var all = []; places().forEach(function (g) { g.links.forEach(function (a) { if (!a.classList.contains('sb-sub')) all.push(a); }); });
    var pick = []; PRI.forEach(function (v) { var a = all.filter(function (x) { return x.getAttribute('data-view') === v; })[0]; if (a && pick.length < 4) pick.push(a); });
    all.forEach(function (a) { if (pick.length < 4 && pick.indexOf(a) === -1 && !/^https?:|^team\//.test(a.getAttribute('href') || '')) pick.push(a); });
    bar.innerHTML = '';
    var onAny = false;
    pick.forEach(function (a) {
      var on = isOn(a); if (on) onAny = true;
      var v = a.getAttribute('data-view'), b = (badge(a).match(/^\d+/) || [''])[0] || (badge(a) ? '•' : ''), name = label(a).replace(/ & (Supper Club|BEOs)$/, '').replace(/^Prep List$/, 'Prep');
      bar.appendChild(h('a', { href: a.getAttribute('href'), 'aria-current': on ? 'page' : null, on: { click: function () { closeSheet(); } } }, [svg(iconKey(v)), h('span', { text: name }), b ? h('i', { cls: 'ph-badge', text: b }) : null]));
    });
    bar.appendChild(h('button', { type: 'button', 'aria-current': !onAny && current() !== 'home' ? 'page' : null, 'aria-haspopup': 'dialog', on: { click: openSheet } }, [svg('more'), h('span', { text: 'More' })]));
  }
  /* ---------- More: every place, as tiles ---------- */
  var sheet = null;
  function closeSheet() { if (sheet) { sheet.remove(); sheet = null; document.body.classList.remove('ph-sheet-open'); } }
  function openSheet() {
    closeSheet();
    var panel = h('div', { cls: 'ph-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'All places' });
    var back = h('div', { cls: 'ph-back', on: { click: function (e) { if (e.target === back) closeSheet(); } } }, panel);
    panel.appendChild(h('div', { cls: 'ph-grab' }));
    panel.appendChild(h('div', { cls: 'ph-sh' }, [h('h2', { text: 'All places' }), h('button', { type: 'button', cls: 'ph-x', 'aria-label': 'Close', text: '✕', on: { click: closeSheet } })]));
    places().forEach(function (g) {
      if (g.title) panel.appendChild(h('p', { cls: 'ph-gt', text: g.title }));
      var grid = h('div', { cls: 'ph-grid' });
      g.links.forEach(function (a) {
        var v = a.getAttribute('data-view') || '', href = a.getAttribute('href') || '#', ext = a.target === '_blank', bt = badge(a), b = /^\d+$/.test(bt) ? bt : '', note = bt && !b ? bt : '', sub = a.classList.contains('sb-sub');
        grid.appendChild(h('a', { cls: 'ph-tile' + (sub ? ' sub' : ''), href: href, target: ext ? '_blank' : null, rel: ext ? 'noopener' : null, 'aria-current': isOn(a) ? 'page' : null, on: { click: function () { closeSheet(); } } }, [
          svg(ext ? 'employees' : iconKey(v)), h('b', { text: label(a) }), sub && !note ? null : h('small', { cls: note ? 'ph-note' : null, text: note || HINT[v] || (ext ? 'Opens in a new tab' : '') }), b ? h('i', { cls: 'ph-badge', text: b }) : null]));
      });
      panel.appendChild(grid);
    });
    // notes, to-do and the account
    var notes = document.getElementById('notesBtn'), acct = document.querySelector('#sideNav .sb-acct'), who = document.getElementById('who'), av = document.getElementById('whoAv');
    var tools = h('div', { cls: 'ph-tools' });
    if (notes) tools.appendChild(h('button', { type: 'button', cls: 'ph-tool', on: { click: function () { closeSheet(); notes.click(); } } }, [svg('notes'), 'Notes']));
    tools.appendChild(h('a', { cls: 'ph-tool', href: '#todo', on: { click: closeSheet } }, [svg('todo'), 'To-do']));
    panel.appendChild(tools);
    if (acct) {
      var menu = acct.querySelector('.sb-menu'), row = h('div', { cls: 'ph-acct' }, [h('span', { cls: 'ph-av', text: av ? av.textContent : '' }), h('div', { cls: 'ph-who', text: who ? [].map.call(who.childNodes, function (n) { return n.textContent.trim(); }).filter(Boolean).join('\n') : '' })]);
      var acts = h('div', { cls: 'ph-acts' });
      if (menu) [].forEach.call(menu.querySelectorAll('a,button'), function (x) {
        if (!shown(x)) return;
        acts.appendChild(x.tagName === 'A' ? h('a', { cls: 'ed-btn small', href: x.getAttribute('href'), target: x.target || null, rel: 'noopener', text: x.textContent.replace(/\s*↗\s*$/, ''), on: { click: closeSheet } })
          : h('button', { type: 'button', cls: 'ed-btn small' + (/sign out/i.test(x.textContent) ? ' ph-out' : ''), text: x.textContent, on: { click: function () { closeSheet(); x.click(); } } }));
      });
      panel.appendChild(h('div', { cls: 'ph-me' }, [row, acts]));
    }
    document.body.appendChild(back); document.body.classList.add('ph-sheet-open'); sheet = back;
    var cur = panel.querySelector('.ph-tile[aria-current]'); if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'center' });
    var x = panel.querySelector('.ph-x'); if (x) x.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && sheet) closeSheet(); });
  // drag the sheet down to close it
  document.addEventListener('touchstart', function (e) { var g = sheet && e.target.closest('.ph-grab,.ph-sh'); if (!g) return; var y0 = e.touches[0].clientY, panel = sheet.querySelector('.ph-sheet');
    function mv(ev) { var dy = Math.max(0, ev.touches[0].clientY - y0); panel.style.transform = 'translateY(' + dy + 'px)'; }
    function up(ev) { document.removeEventListener('touchmove', mv); document.removeEventListener('touchend', up); var dy = (ev.changedTouches[0].clientY - y0); if (dy > 90) closeSheet(); else panel.style.transform = ''; }
    document.addEventListener('touchmove', mv, { passive: true }); document.addEventListener('touchend', up); }, { passive: true });

  function start() {
    var app = document.getElementById('app'); if (!app || bar) return;
    bar = h('nav', { cls: 'ph-nav', 'aria-label': 'Main' }); app.appendChild(bar);
    paintBar();
    window.addEventListener('hashchange', function () { paintBar(); closeSheet(); });
    // the side menu changes as sign-in finishes and badges fill in: keep the bar in step
    var nav = document.getElementById('sideNav');
    if (nav && window.MutationObserver) { var t = null; new MutationObserver(function () { clearTimeout(t); t = setTimeout(paintBar, 120); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['hidden'], characterData: true, childList: true }); }
    if (PHONE.addEventListener) PHONE.addEventListener('change', function () { if (!PHONE.matches) closeSheet(); }); else if (PHONE.addListener) PHONE.addListener(function () { if (!PHONE.matches) closeSheet(); });
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.EdenPhone = { open: openSheet, close: closeSheet, refresh: paintBar };
})();
