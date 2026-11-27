/* Eden staff site on a phone, in the style of Shopify's mobile admin: a clean white top bar (Eden, the page,
 * search and your account), tabs along the bottom (Home, Calendar, Prep, Inventory, More), and More opens a
 * full page listing every section in grouped rows with chevrons, with search, Notes, To-do and the account.
 * Every page of the site is the same page as on a computer; only the way around it changes on a phone.
 * Built from the side menu, so each person sees only what their role can open, with the same badges.
 * Desktop and iPad keep the side menu: css/phone.css only shows this at 700px wide and narrower. */
(function () {
  'use strict';
  var PHONE = window.matchMedia ? window.matchMedia('(max-width: 700px)') : { matches: false };
  var I = {   // line icons, 24×24
    home: 'M3 11l9-7 9 7 M5 10v10h5v-6h4v6h5V10',
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
    team: 'M9 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8z M2 21a7 7 0 0 1 14 0 M16 3a4 4 0 0 1 0 8 M22 21a7 7 0 0 0-5-6.7',
    todo: 'M4 12l5 5L20 6', notes: 'M4 20h4L19 9l-4-4L4 16z', search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
    more: 'M4 6h16 M4 12h16 M4 18h16', chev: 'M9 6l6 6-6 6', web: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18z M3 12h18 M12 3c3 3 3 15 0 18 M12 3c-3 3-3 15 0 18',
    key: 'M15 7a4 4 0 1 1-3.5 6L5 19.5 3.5 18l1.5-1.5L3.5 15l1.5-1.5L6.5 15l5-5A4 4 0 0 1 15 7z', out: 'M10 4H5v16h5 M15 8l4 4-4 4 M19 12H9', x: 'M6 6l12 12 M18 6L6 18'
  };
  var HINT = {
    home: 'What needs you, tonight and the week', preshift: 'Tonight’s meeting and education', resources: 'Guides, PDFs and links',
    checklists: 'Opening, closing and side work', 'checklists/edit': 'Change the checklists', eod: 'File tonight’s report', 'eod/past': 'Every report so far', 'eod/download': 'Spreadsheets of the reports',
    menu: 'The website menu and Supper Club', calendar: 'Events, shifts and time off', catering: 'Inquiries, questionnaires and BEOs',
    prep: 'Today’s list for the kitchen', inventory: 'Counts, invoices and ordering', 'inventory/food': 'Food items and counts', 'inventory/beverages': 'Wine, beer, spirits and more', 'inventory/dry': 'Paper, to-go and cleaning',
    temps: 'Coolers and freezers', orders: 'What to order, and the Hub’s list', recipes: 'Recipes and their costs', menucosts: 'Food cost % for every dish',
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
  function svg(key, cls) {
    var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); if (cls) s.setAttribute('class', cls);
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', I[key] || I.more); s.appendChild(p); return s;
  }
  function iconKey(view, ext) { if (ext) return 'team'; var v = String(view || ''); if (v === 'employees/permissions') return 'permissions'; if (/^payroll/.test(v)) return v === 'payroll/overview' ? 'payroll' : 'menucosts'; return v.split('/')[0]; }
  function shown(a) { return a && !a.hidden && !a.closest('[hidden]'); }
  function label(a) { var t = ''; a.childNodes.forEach(function (n) { if (n.nodeType === 3) t += n.textContent; }); return t.replace(/\s+/g, ' ').trim(); }
  function badge(a) { var b = a.querySelector('.sb-badge'); return b && !b.hidden && b.textContent.trim() ? b.textContent.trim() : ''; }
  function places() {
    var nav = document.querySelector('#sideNav .sb-nav'); if (!nav) return [];
    var out = [], today = nav.querySelector('a.sb-today');
    if (shown(today)) out.push({ title: '', links: [today] });
    nav.querySelectorAll('.sb-group').forEach(function (g) {
      if (!shown(g)) return;
      var t = g.querySelector('.sb-g'), links = [].filter.call(g.querySelectorAll('a[href]'), function (a) { return shown(a) && !/^soon$/i.test(badge(a)); });
      if (links.length) out.push({ title: t ? t.textContent.trim() : '', links: links });
    });
    return out;
  }
  function current() { return String(location.hash || '#home').replace(/^#/, '') || 'home'; }
  function isOn(a) {
    var href = (a.getAttribute('href') || '').replace(/^#/, ''), cur = current();
    if (!href || a.target) return false;
    return cur === href || (cur.indexOf(href + '/') === 0 && !a.classList.contains('sb-sub'));
  }

  /* ---------- the tabs along the bottom ---------- */
  var PRI = ['home', 'calendar', 'prep', 'inventory', 'schedule', 'catering', 'orders', 'recipes', 'checklists', 'preshift'];
  var bar = null, page = null;
  function paintBar() {
    if (!bar) return;
    var all = []; places().forEach(function (g) { g.links.forEach(function (a) { if (!a.classList.contains('sb-sub') && !a.target) all.push(a); }); });
    var pick = []; PRI.forEach(function (v) { var a = all.filter(function (x) { return x.getAttribute('data-view') === v; })[0]; if (a && pick.length < 4) pick.push(a); });
    all.forEach(function (a) { if (pick.length < 4 && pick.indexOf(a) === -1) pick.push(a); });
    bar.innerHTML = '';
    var onAny = false;
    pick.forEach(function (a) {
      var on = !page && isOn(a); if (on) onAny = true;
      var v = a.getAttribute('data-view'), bt = badge(a), b = (bt.match(/^\d+/) || [''])[0], name = v === 'home' ? 'Home' : label(a).replace(/ & (Supper Club|BEOs)$/, '').replace(/^Prep List$/, 'Prep');
      bar.appendChild(h('a', { href: a.getAttribute('href'), 'aria-current': on ? 'page' : null, on: { click: closeAll } }, [svg(iconKey(v)), h('span', { text: name }), b ? h('i', { cls: 'ph-badge', text: b }) : bt ? h('i', { cls: 'ph-dot' }) : null]));
    });
    bar.appendChild(h('button', { type: 'button', 'aria-current': (page || !onAny) ? 'page' : null, 'aria-haspopup': 'dialog', on: { click: function () { if (page) closeAll(); else openPage(); } } }, [svg('more'), h('span', { text: 'More' })]));
  }

  /* ---------- the top bar: Eden, the page, search and the account ---------- */
  function top() {
    var b = document.querySelector('.sb-bar'); if (!b || b.querySelector('.ph-top')) return;
    b.insertBefore(h('a', { cls: 'ph-logo', href: '#home', 'aria-label': 'Eden — Today', text: 'E' }), b.firstChild);
    var who = document.getElementById('whoAv');
    b.appendChild(h('div', { cls: 'ph-top' }, [
      h('button', { type: 'button', cls: 'ph-ib', 'aria-label': 'Search the staff site', on: { click: function () { openPage(true); } } }, svg('search')),
      h('button', { type: 'button', cls: 'ph-me', 'aria-label': 'Your account', on: { click: function () { openPage(false, true); } } }, [h('span', { cls: 'ph-meav', text: who ? who.textContent : '' })])
    ]));
    if (who && window.MutationObserver) new MutationObserver(function () { var x = b.querySelector('.ph-meav'); if (x) x.textContent = who.textContent; }).observe(who, { childList: true, characterData: true, subtree: true });
  }

  /* ---------- More: every section, in grouped rows ---------- */
  function closeAll() { if (page) { page.remove(); page = null; document.body.classList.remove('ph-page-open'); paintBar(); } }
  function row(a, q) {
    var v = a.getAttribute('data-view') || '', ext = a.target === '_blank', bt = badge(a), b = /^\d+$/.test(bt) ? bt : '', note = bt && !b ? bt : '', sub = a.classList.contains('sb-sub');
    var name = label(a), hint = HINT[v] || (ext ? 'Opens in a new tab' : '');
    if (q && (name + ' ' + hint + ' ' + v).toLowerCase().indexOf(q) === -1) return null;
    return h('a', { cls: 'ph-row' + (sub && !q ? ' sub' : ''), href: a.getAttribute('href') || '#', target: ext ? '_blank' : null, rel: ext ? 'noopener' : null, 'aria-current': isOn(a) ? 'page' : null, on: { click: closeAll } }, [
      h('span', { cls: 'ph-ri' }, svg(iconKey(v, ext))),
      h('span', { cls: 'ph-rt' }, [h('b', { text: name }), (!sub || q) && hint ? h('small', { text: hint }) : null]),
      note ? h('em', { cls: 'ph-tag', text: note }) : b ? h('i', { cls: 'ph-badge inline', text: b }) : null,
      svg(ext ? 'web' : 'chev', 'ph-chev')]);
  }
  function openPage(focusSearch, account) {
    closeAll();
    var list = h('div', { cls: 'ph-lists' }), q = h('input', { type: 'search', placeholder: 'Search', 'aria-label': 'Search the staff site', autocomplete: 'off', enterkeyhint: 'go' });
    function paint() {
      var term = q.value.trim().toLowerCase(); list.innerHTML = ''; var any = false;
      places().forEach(function (g) {
        var rows = g.links.map(function (a) { return row(a, term); }).filter(Boolean); if (!rows.length) return; any = true;
        list.appendChild(h('section', { cls: 'ph-card' }, [g.title ? h('h3', { text: g.title }) : null].concat(rows)));
      });
      if (!any) list.appendChild(h('p', { cls: 'ph-empty', text: 'Nothing matches “' + q.value.trim() + '”.' }));
    }
    q.addEventListener('input', paint);
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { var f = list.querySelector('.ph-row'); if (f) f.click(); } });
    var notes = document.getElementById('notesBtn'), acct = document.querySelector('#sideNav .sb-acct'), who = document.getElementById('who'), av = document.getElementById('whoAv');
    var tools = h('section', { cls: 'ph-card' }, [h('h3', { text: 'Your tools' }),
      notes ? h('button', { type: 'button', cls: 'ph-row', on: { click: function () { closeAll(); notes.click(); } } }, [h('span', { cls: 'ph-ri' }, svg('notes')), h('span', { cls: 'ph-rt' }, [h('b', { text: 'Notes' }), h('small', { text: 'Write or draw a note' })]), svg('chev', 'ph-chev')]) : null,
      h('a', { cls: 'ph-row', href: '#todo', on: { click: closeAll } }, [h('span', { cls: 'ph-ri' }, svg('todo')), h('span', { cls: 'ph-rt' }, [h('b', { text: 'To-do' }), h('small', { text: 'Your list' })]), svg('chev', 'ph-chev')])]);
    var me = null;
    if (acct) {
      var menu = acct.querySelector('.sb-menu'), lines = who ? [].map.call(who.childNodes, function (n) { return n.textContent.trim(); }).filter(Boolean) : [];
      me = h('section', { cls: 'ph-card ph-acct' }, [h('div', { cls: 'ph-acctrow' }, [h('span', { cls: 'ph-av', text: av ? av.textContent : '' }), h('div', null, [h('b', { text: lines[0] || '' }), h('small', { text: lines.slice(1).join(' · ') })])])]);
      if (menu) [].forEach.call(menu.querySelectorAll('a,button'), function (x) {
        if (!shown(x)) return;
        var t = x.textContent.replace(/\s*↗\s*$/, '').trim(), out = /sign out/i.test(t), ic = out ? 'out' : /password/i.test(t) ? 'key' : 'web';
        me.appendChild(x.tagName === 'A' ? h('a', { cls: 'ph-row', href: x.getAttribute('href'), target: x.target || null, rel: 'noopener', on: { click: closeAll } }, [h('span', { cls: 'ph-ri' }, svg(ic)), h('span', { cls: 'ph-rt' }, h('b', { text: t })), svg('web', 'ph-chev')])
          : h('button', { type: 'button', cls: 'ph-row' + (out ? ' danger' : ''), on: { click: function () { closeAll(); x.click(); } } }, [h('span', { cls: 'ph-ri' }, svg(ic)), h('span', { cls: 'ph-rt' }, h('b', { text: t })), out ? null : svg('chev', 'ph-chev')]));
      });
    }
    var el = h('div', { cls: 'ph-page', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Everything on the staff site' }, [
      h('header', { cls: 'ph-ph' }, [h('div', { cls: 'ph-phrow' }, [h('h2', { text: 'Eden' }), h('button', { type: 'button', cls: 'ph-ib', 'aria-label': 'Close', on: { click: closeAll } }, svg('x'))]),
        h('label', { cls: 'ph-search' }, [svg('search'), q])]),
      h('div', { cls: 'ph-body' }, [list, tools, me])
    ]);
    paint();
    document.body.appendChild(el); document.body.classList.add('ph-page-open'); page = el; paintBar();
    if (focusSearch) setTimeout(function () { q.focus(); }, 60);
    else if (account && me) setTimeout(function () { el.querySelector('.ph-body').scrollTop = me.offsetTop - 12; }, 30);
  }
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape' && page) closeAll(); });

  function start() {
    var app = document.getElementById('app'); if (!app || bar) return;
    bar = h('nav', { cls: 'ph-nav', 'aria-label': 'Main' }); document.body.appendChild(bar);
    top(); paintBar();
    window.addEventListener('hashchange', function () { closeAll(); paintBar(); });
    var nav = document.getElementById('sideNav');
    if (nav && window.MutationObserver) { var t = null; new MutationObserver(function () { clearTimeout(t); t = setTimeout(paintBar, 120); }).observe(nav, { subtree: true, attributes: true, attributeFilter: ['hidden'], characterData: true, childList: true }); }
    var app2 = document.getElementById('app'); if (app2 && window.MutationObserver) new MutationObserver(function () { bar.hidden = app2.hidden; if (app2.hidden) closeAll(); }).observe(app2, { attributes: true, attributeFilter: ['hidden'] });
    bar.hidden = app.hidden;
    var onChange = function () { if (!PHONE.matches) closeAll(); };
    if (PHONE.addEventListener) PHONE.addEventListener('change', onChange); else if (PHONE.addListener) PHONE.addListener(onChange);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
  window.EdenPhone = { open: openPage, close: closeAll, refresh: paintBar };
})();
