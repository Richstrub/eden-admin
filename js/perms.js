/* Eden staff site: Team > Employees > Permissions (Owner only).
 * A grid: sections (and the finer controls inside them) down the side, Employee / Cook / Server / Bartender across
 * the top. Plus exceptions for one person. Every change is explained in plain words and can be undone.
 * The Owner and managers always have everything. Enforced by the database (supabase/permissions.sql).
 */
(function () {
  'use strict';
  // k, name, what it is, what it lets them do ("can …"), what still happens when it's off, finer controls
  var SECTIONS = [
    { k: 'schedule', name: 'Schedule', icon: 'cal', desc: 'Their shifts for the week, on the Schedule tab of the staff page.', does: 'see the schedule',
      off: 'Their shifts no longer show on the staff page. Time off and the message board have their own switches.',
      subs: [{ k: 'schedule.team', name: 'Everyone’s shifts', desc: 'See who else is working each day, not just their own shifts.', does: 'see everyone’s shifts', off: 'They still see their own shifts.' }] },
    { k: 'todos', name: 'To-dos', icon: 'check', desc: 'To-dos you or a manager give them, with due dates.', does: 'see the to-dos you give them',
      off: 'To-dos you give them are still saved; they just won’t see them.',
      subs: [{ k: 'todos.done', name: 'Tick them off', desc: 'Mark a to-do done when it’s finished. When this is off, only you and managers can tick them off.', does: 'tick off their own to-dos', off: 'They can still see them.' }] },
    { k: 'timeoff', name: 'Time off', icon: 'sun', desc: 'Ask for days off and see what they’ve asked for.', does: 'ask for time off',
      off: 'They can’t send requests or see their past ones. You can still add time off for them on the Schedule page.' },
    { k: 'board', name: 'Message board', icon: 'chat', desc: 'Notes for the whole team, on the Schedule tab.', does: 'read the message board',
      subs: [{ k: 'board.post', name: 'Post notes', desc: 'Write their own notes on the board for everyone to read.', does: 'post on the message board', off: 'They can still read it.' }] },
    { k: 'preshift', name: 'Pre-shift', icon: 'brief', desc: 'Today’s briefing: education, reservations, menu changes and notes.', does: 'open Pre-shift',
      subs: [
        { k: 'preshift.education', name: 'Education', desc: 'The PDFs at the top of Pre-shift: wine notes, menu descriptions, service standards.', does: 'read the education PDFs in Pre-shift' },
        { k: 'preshift.reservations', name: 'Tonight’s reservations', desc: 'Guest names, party sizes and notes from OpenTable. Guest spend is never shown to staff either way.', does: 'see tonight’s reservations' },
        { k: 'preshift.menu', name: 'Menu changes', desc: 'What changed on the menu in the last 24 hours.', does: 'see menu changes in Pre-shift' },
        { k: 'preshift.notes', name: 'Pre-shift notes', desc: 'Notes you and managers send from the Notes tab.', does: 'read pre-shift notes' }] },
    { k: 'resources', name: 'Resources', icon: 'book', desc: 'Food, beverage and hospitality PDFs they can search and read.', does: 'open Resources' },
    { k: 'prep', name: 'Prep List', icon: 'list', desc: 'The shared prep lists. Out of the box, cooks get the kitchen list and bartenders the bar list.', does: 'see the Prep List',
      subs: [
        { k: 'prep.kitchen', name: 'Kitchen prep list', desc: 'The food prep list, built from the Kitchen menu.', does: 'see the kitchen prep list' },
        { k: 'prep.bar', name: 'Bar prep list', desc: 'The bar prep list, built from the cocktail menu.', does: 'see the bar prep list' },{ k: 'prep.edit', name: 'Fill it in', desc: 'Tick lines, fill in On hand, choose Do or X, sign with their initials, and add or remove lines. When this is off, the list is read only.', does: 'fill in the Prep List', off: 'They can still read it.' }] },
    { k: 'recipes', name: 'Recipes', icon: 'pot', desc: 'The recipe book. Only you and managers can change recipes.', does: 'read the recipe book' },
    { k: 'calendar', name: 'Calendar', icon: 'flag', desc: 'Upcoming events and private parties.', does: 'see the event calendar' },
    { k: 'eod', name: 'End of day report', icon: 'moon', desc: 'Fill in and submit the end of day report from the staff page, and read past reports, including sales. Off for everyone until you turn it on.', does: 'fill in the end of day report',
      off: 'Only you and managers can fill in the end of day report.',
      subs: [{ k: 'eod.tips', name: 'Tips', desc: 'Enter the night’s cash and credit card tips and email everyone in the tip pool their share (you still get a copy).', does: 'enter and email the night’s tips', off: 'The report saves without tips; you or a manager enter them.' }] }
  ];
  var ITEM = {}; SECTIONS.forEach(function (s) { ITEM[s.k] = s; (s.subs || []).forEach(function (x) { x.parent = s; ITEM[x.k] = x; }); });
  var ICONS = {
    cal: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4', check: 'M5 12l4 4 10-10', sun: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
    chat: 'M4 5h16v11H9l-5 4z', brief: 'M4 8h16v11H4zM9 8V5h6v3', book: 'M5 4h10l4 4v12H5zM15 4v4h4', list: 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
    pot: 'M4 10h16l-1.5 9h-13zM8 10V7M12 10V5M16 10V7', flag: 'M5 21V4M5 4h11l-2 4 2 4H5', moon: 'M19 14.5A7.5 7.5 0 0 1 9.5 5a7.5 7.5 0 1 0 9.5 9.5z'
  };
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (Array.isArray(attrs) || typeof attrs === 'string') { kids = attrs; attrs = null; }
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else if (k === 'cls') e.className = v; else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function icon(name) {
    var ns = 'http://www.w3.org/2000/svg', s = document.createElementNS(ns, 'svg'), p = document.createElementNS(ns, 'path');
    s.setAttribute('viewBox', '0 0 24 24'); s.setAttribute('aria-hidden', 'true'); s.setAttribute('class', 'pq-ic');
    p.setAttribute('d', ICONS[name] || ''); s.appendChild(p); return s;
  }
  function gone(e) { return !!(e && (e.code === 'PGRST205' || e.code === '42P01' || /section_|schema cache|does not exist/i.test(e.message || ''))); }
  var LEVELS = [['employee', 'Employee', 'Employees'], ['cook', 'Cook', 'Cooks'], ['server', 'Server', 'Servers'], ['bartender', 'Bartender', 'Bartenders']];
  var LV = {}; LEVELS.forEach(function (l) { LV[l[0]] = { one: l[1], many: l[2] }; });
  var ROWS = []; SECTIONS.forEach(function (s) { ROWS.push(s); (s.subs || []).forEach(function (x) { ROWS.push(x); }); });
  var X = { ctx: null, el: null, rules: {}, people: {}, emps: [], view: 'groups', pick: '', log: [], note: null, busy: false };
  try { X.view = localStorage.getItem('eden.perms.view') === 'person' ? 'person' : 'groups'; } catch (e) {}

  // the rules
  // out of the box: everything on, except the Prep List (cooks get the kitchen list, bartenders the bar list)
  function dflt(level, k) { return k === 'eod' || k === 'eod.tips' ? false : k === 'prep' ? level === 'cook' || level === 'bartender' : k === 'prep.kitchen' ? level !== 'bartender' : k === 'prep.bar' ? level !== 'cook' : true; }
  function rule(level, k) { var key = level + '|' + k; return key in X.rules ? X.rules[key] : dflt(level, k); }
  function groupHas(level, k) { var it = ITEM[k]; return it.parent ? rule(level, it.parent.k) && rule(level, k) : rule(level, k); }
  function levelOf(e) { return LV[e.access] ? e.access : 'employee'; }
  function own(e, k) { var m = X.people[e.id] || {}; return k in m ? m[k] : rule(levelOf(e), k); }
  function personHas(e, k) { var it = ITEM[k]; return it.parent ? own(e, it.parent.k) && own(e, k) : own(e, k); }
  function peopleIn(level) { return X.emps.filter(function (e) { return levelOf(e) === level; }); }
  function changes(level) { return Object.keys(X.rules).filter(function (key) { var p = key.split('|'); return p[0] === level && X.rules[key] !== dflt(level, p[1]); }).length; }
  function firstName(e) { return String(e.name || '').split(/\s+/)[0] || e.name; }
  function list(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function setView(v) { X.view = v; try { localStorage.setItem('eden.perms.view', v); } catch (e) {} }
  // the tabs on someone's staff page, given what they have
  function tabsFor(has) {
    var t = [];
    if (has('schedule') || has('timeoff') || has('board') || has('todos')) t.push('Schedule');
    if (has('preshift')) t.push('Pre-shift');
    if (has('resources')) t.push('Resources');
    if (has('prep')) t.push('Prep List');
    if (has('recipes')) t.push('Recipes');
    if (has('calendar')) t.push('Calendar');
    return t;
  }

  /* ---------- loading ---------- */
  function show(ctx) {
    X.ctx = ctx; X.el = ctx.el; X.el.innerHTML = '';
    X.el.appendChild(h('div', { cls: 'pq' }, [h('p', { cls: 'pq-muted', text: 'Loading…' })]));
    var sb = ctx.sb;
    Promise.all([sb.from('section_rules').select('level,section,allowed'), sb.from('section_people').select('employee_id,section,allowed'), sb.from('employees').select('id,name,access,active,position').order('name')]).then(function (r) {
      if (r[0].error || r[1].error) { X.missing = gone(r[0].error || r[1].error); X.err = !X.missing; }
      else { X.missing = false; X.err = false; }
      X.rules = {}; ((r[0] && r[0].data) || []).forEach(function (x) { if (ITEM[x.section] && LV[x.level]) X.rules[x.level + '|' + x.section] = !!x.allowed; });
      X.people = {}; ((r[1] && r[1].data) || []).forEach(function (x) { if (ITEM[x.section]) (X.people[x.employee_id] = X.people[x.employee_id] || {})[x.section] = !!x.allowed; });
      X.emps = ((r[2] && r[2].data) || []).filter(function (e) { return e.active !== false && e.access !== 'manager' && e.access !== 'owner' && e.name; });
      if (X.pick && !X.emps.some(function (e) { return e.id === X.pick; })) X.pick = '';
      render();
    });
  }

  /* ---------- the page ---------- */
  function render() {
    var el = X.el, keepY = window.scrollY, keepX = (el.querySelector('.pq-scroll') || {}).scrollLeft || 0;
    el.innerHTML = '';
    var wrap = h('div', { cls: 'pq' });
    el.appendChild(wrap);
    wrap.appendChild(h('header', { cls: 'pq-top' }, [
      h('div', [h('p', { cls: 'sc-eyebrow', text: 'Team · Employees' }), h('h1', { cls: 'sc-week', text: 'Permissions' }),
        h('p', { cls: 'pq-lead', text: 'What each kind of employee can see and do on the staff page. Changes save straight away and apply the next time they open or refresh the page.' })]),
      X.missing || X.err ? null : viewToggle()
    ]));
    if (X.missing) { wrap.appendChild(h('div', { cls: 'pq-card pq-pad' }, [h('p', { text: 'One step first: in Supabase, open SQL Editor > New query, paste in supabase/permissions.sql and click Run. Then reload this page.' })])); return; }
    if (X.err) { wrap.appendChild(h('p', { cls: 'pq-bad', text: 'Couldn’t load permissions. Only the Owner can open this page.' })); return; }
    wrap.appendChild(howItWorks());
    wrap.appendChild(noteBar());
    if (X.view === 'person') personView(wrap); else groupGrid(wrap);
    if (X.log.length) wrap.appendChild(logCard());
    var sc = el.querySelector('.pq-scroll'); if (sc) sc.scrollLeft = keepX;
    window.scrollTo(0, keepY);
    if (X.focus) { var f = el.querySelector('[data-cell="' + X.focus + '"]'); if (f) f.focus({ preventScroll: true }); X.focus = null; }
  }
  function viewToggle() {
    return h('div', { cls: 'pq-view', role: 'group', 'aria-label': 'Show' }, [['groups', 'By group'], ['person', 'One person']].map(function (v) {
      return h('button', { type: 'button', 'aria-pressed': X.view === v[0] ? 'true' : 'false', text: v[1], on: { click: function () { if (X.view !== v[0]) { setView(v[0]); X.note = null; render(); } } } });
    }));
  }
  function howItWorks() {
    var open = true; try { open = localStorage.getItem('eden.perms.how') !== '0'; } catch (e) {}
    var d = h('details', { cls: 'pq-how', open: open ? true : null }, [
      h('summary', { text: 'How permissions work' }),
      h('ul', { cls: 'pq-steps' }, [
        h('li', [h('b', { text: 'Columns are groups.' }), ' Everyone is an Employee, Cook, Server or Bartender. You set that on the Employees page, under Access.']),
        h('li', [h('b', { text: 'Rows are sections of the staff page.' }), ' The indented rows are finer controls inside a section, like posting on the message board. They only count while the section above them is on.']),
        h('li', [h('b', { text: 'One person' }), ' (the switch at the top) gives someone something their group doesn’t have, or takes something away, just for them.']),
        h('li', [h('b', { text: 'You and your managers always have everything.' }), ' Kitchen logins count as Cooks, and Front-of-house logins as Servers. Anything switched off is hidden from their staff page, and the database won’t send it to them either.'])
      ])
    ]);
    d.addEventListener('toggle', function () { try { localStorage.setItem('eden.perms.how', d.open ? '1' : '0'); } catch (e) {} });
    return d;
  }
  // the bar that explains the last change (with Undo)
  function noteBar() {
    var n = X.note;
    var bar = h('div', { cls: 'pq-note' + (n ? (n.bad ? ' bad' : ' ok') : ''), role: 'status', 'aria-live': 'polite' });
    if (!n) { bar.appendChild(h('span', { cls: 'pq-muted', text: X.view === 'person' ? 'Choose someone, then pick Like their group, Yes or No for any row.' : 'Tap any switch to change it. Each change is explained here, with an Undo.' })); return bar; }
    bar.appendChild(h('span', [h('b', { text: n.bad ? 'Not saved. ' : 'Saved. ' }), n.text]));
    if (!n.bad && X.log[0] && !X.log[0].undone) bar.appendChild(h('button', { type: 'button', cls: 'pq-link', text: 'Undo', on: { click: function () { undo(X.log[0], this); } } }));
    return bar;
  }

  /* ---------- the grid: sections × groups ---------- */
  function groupGrid(wrap) {
    var thead = h('thead', null, h('tr', [h('th', { cls: 'pq-corner', scope: 'col' }, [h('span', { text: 'Section' })])].concat(LEVELS.map(function (l) {
      var n = peopleIn(l[0]).length, c = changes(l[0]);
      return h('th', { scope: 'col', cls: 'pq-colh' }, [
        h('b', { text: l[2] }),
        h('small', { text: n + (n === 1 ? ' person' : ' people') + (l[0] === 'cook' ? ' + Kitchen' : l[0] === 'server' ? ' + FOH' : '') }),
        c ? h('button', { type: 'button', cls: 'pq-link sm', text: 'Reset (' + c + ')', title: 'Back to the usual settings for ' + l[2].toLowerCase(), on: { click: function () { resetGroup(l[0]); } } }) : h('small', { cls: 'pq-usual', text: 'Usual settings' })
      ]);
    }))));
    var tbody = h('tbody', ROWS.map(function (it) {
      var sub = !!it.parent;
      return h('tr', { cls: sub ? 'pq-r-sub' : 'pq-r-sec' }, [
        h('th', { scope: 'row', cls: 'pq-rowh' }, h('div', { cls: 'pq-rh' }, [
          sub ? h('span', { cls: 'pq-branch', 'aria-hidden': 'true' }) : icon(it.icon),
          h('span', { cls: 'pq-rt' }, [h('b', { text: it.name }), h('small', { text: it.desc })])
        ]))
      ].concat(LEVELS.map(function (l) {
        var lv = l[0], v = rule(lv, it.k), blocked = sub && !rule(lv, it.parent.k), changed = (lv + '|' + it.k) in X.rules && X.rules[lv + '|' + it.k] !== dflt(lv, it.k);
        return h('td', { cls: 'pq-cell' + (changed ? ' is-changed' : '') + (blocked ? ' is-blocked' : '') },
          cellSwitch(v, blocked, it.name + (sub ? ' (' + it.parent.name + ')' : '') + ' for ' + l[2].toLowerCase(), lv + '|' + it.k, function () { saveRule(lv, it.k, !v); },
            blocked ? 'Turn on ' + it.parent.name + ' for ' + l[2].toLowerCase() + ' first' : null));
      })));
    }));
    var tfoot = h('tfoot', null, h('tr', [h('th', { scope: 'row', cls: 'pq-rowh' }, h('div', { cls: 'pq-rh' }, [h('span', { cls: 'pq-rt' }, [h('b', { text: 'Their staff page' }), h('small', { text: 'The tabs they’ll see' })])]))].concat(LEVELS.map(function (l) {
      var t = tabsFor(function (k) { return groupHas(l[0], k); });
      return h('td', { cls: 'pq-tabsum' }, t.length ? h('ul', t.map(function (x) { return h('li', { text: x }); })) : h('span', { cls: 'pq-bad', text: 'Nothing' }));
    }))));
    wrap.appendChild(h('div', { cls: 'pq-card pq-gridcard' }, [
      h('div', { cls: 'pq-scroll' }, h('table', { cls: 'pq-grid' }, [thead, tbody, tfoot])),
      h('p', { cls: 'pq-key' }, [h('span', { cls: 'pq-keysw on', 'aria-hidden': 'true' }), 'On', h('span', { cls: 'pq-keysw', 'aria-hidden': 'true' }), 'Off',
        h('span', { cls: 'pq-keych', 'aria-hidden': 'true' }), 'Changed from the usual setting', h('span', { cls: 'pq-keybl', 'aria-hidden': 'true', text: '–' }), 'Needs the section above it on'])
    ]));
  }
  function cellSwitch(on, blocked, label, id, click, why) {
    if (blocked) return h('span', { cls: 'pq-blk', title: why, 'aria-label': label + ': ' + why, role: 'img', text: '–' });
    var b = h('button', { type: 'button', cls: 'pq-sw', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, 'data-cell': id, title: (on ? 'On' : 'Off') + ' · tap to turn ' + (on ? 'off' : 'on') },
      h('span', { cls: 'pq-knob', 'aria-hidden': 'true' }));
    b.addEventListener('click', function () { if (X.busy) return; b.setAttribute('aria-checked', on ? 'false' : 'true'); click(); });
    return b;
  }
  function explainGroup(level, k, v) {
    var G = LV[level].many, it = ITEM[k];
    if (it.parent && !rule(level, it.parent.k)) return G + ' will ' + (v ? '' : 'not ') + 'be able to ' + it.does + ' once ' + it.parent.name + ' is on.';
    if (v) {
      var extra = it.subs ? it.subs.filter(function (x) { return !rule(level, x.k); }) : [];
      return G + ' can now ' + it.does + '.' + (extra.length ? ' ' + list(extra.map(function (x) { return x.name; })) + (extra.length === 1 ? ' stays' : ' stay') + ' off.' : '');
    }
    return G + ' can no longer ' + it.does + '.' + (it.off ? ' ' + it.off : '') + (it.subs ? ' The rows under it are kept for when you turn it back on.' : '');
  }
  function saveRule(level, k, v) {
    var key = level + '|' + k, had = key in X.rules, before = X.rules[key], text = explainGroup(level, k, v);
    X.busy = true;
    write(level, k, v).then(function (ok) {
      X.busy = false;
      if (!ok) { X.note = { bad: true, text: 'Only the Owner can change permissions. Check your connection and try again.' }; render(); return; }
      logIt(text, function () { return had ? write(level, k, before) : unwrite(level, k); });
      X.note = { text: text }; X.focus = key; render();
    });
  }
  function write(level, k, v) {
    return X.ctx.sb.from('section_rules').upsert({ level: level, section: k, allowed: v }, { onConflict: 'level,section' }).then(function (r) { if (r.error) return false; X.rules[level + '|' + k] = v; return true; }, function () { return false; });
  }
  function unwrite(level, k) {
    return X.ctx.sb.from('section_rules').delete().eq('level', level).eq('section', k).then(function (r) { if (r.error) return false; delete X.rules[level + '|' + k]; return true; }, function () { return false; });
  }
  function resetGroup(level) {
    var G = LV[level].many;
    if (!confirm(G + ': back to the usual settings?\n\n' + (level === 'cook' ? 'Everything is on, with the kitchen prep list only' : level === 'bartender' ? 'Everything is on, with the bar prep list only' : 'Everything is on except the Prep List') + '. Exceptions you made for one person stay.')) return;
    var saved = {}; Object.keys(X.rules).forEach(function (key) { if (key.indexOf(level + '|') === 0) saved[key] = X.rules[key]; });
    X.ctx.sb.from('section_rules').delete().eq('level', level).then(function (r) {
      if (r.error) { X.note = { bad: true, text: 'Couldn’t reset. Try again.' }; render(); return; }
      Object.keys(saved).forEach(function (key) { delete X.rules[key]; });
      var text = G + ' are back to the usual settings: everything on' + (level === 'cook' ? ', with the kitchen prep list only' : level === 'bartender' ? ', with the bar prep list only' : ' except the Prep List') + '.';
      logIt(text, function () {
        var rows = Object.keys(saved).map(function (key) { return { level: level, section: key.split('|')[1], allowed: saved[key] }; });
        if (!rows.length) return Promise.resolve(true);
        return X.ctx.sb.from('section_rules').upsert(rows, { onConflict: 'level,section' }).then(function (x) { if (x.error) return false; Object.keys(saved).forEach(function (key) { X.rules[key] = saved[key]; }); return true; });
      });
      X.note = { text: text }; render();
    });
  }

  /* ---------- one person: the same rows, with their group's setting beside theirs ---------- */
  function personView(wrap) {
    if (!X.emps.length) { wrap.appendChild(h('div', { cls: 'pq-card pq-pad' }, [h('p', { text: 'No employees yet. Add them on the Employees page.' })])); return; }
    var picker = h('div', { cls: 'pq-card pq-pick' });
    LEVELS.forEach(function (l) {
      var ppl = peopleIn(l[0]); if (!ppl.length) return;
      picker.appendChild(h('div', { cls: 'pq-pgrp' }, [h('p', { cls: 'pq-plabel', text: l[2] }), h('div', { cls: 'pq-chips' }, ppl.map(function (e) {
        var n = Object.keys(X.people[e.id] || {}).length;
        return h('button', { type: 'button', cls: 'pq-chip', 'aria-pressed': X.pick === e.id ? 'true' : 'false', on: { click: function () { X.pick = X.pick === e.id ? '' : e.id; X.note = null; render(); } } },
          [e.name, n ? h('span', { cls: 'pq-badge', text: n + ' exception' + (n === 1 ? '' : 's') }) : null]);
      }))]));
    });
    wrap.appendChild(picker);
    var e = X.emps.filter(function (x) { return x.id === X.pick; })[0];
    if (!e) { wrap.appendChild(h('p', { cls: 'pq-muted pq-pad', text: 'Choose someone above to see exactly what they can do.' })); return; }
    var lvl = levelOf(e), G = LV[lvl], F = firstName(e), n = Object.keys(X.people[e.id] || {}).length;
    var thead = h('thead', null, h('tr', [
      h('th', { cls: 'pq-corner', scope: 'col' }, [h('b', { cls: 'pq-pname', text: e.name }), h('small', { text: G.one + (e.position ? ' · ' + e.position : '') })]),
      h('th', { scope: 'col', cls: 'pq-colh' }, [h('b', { text: G.many }), h('small', { text: 'Their group' })]),
      h('th', { scope: 'col', cls: 'pq-colh pq-colw' }, [h('b', { text: 'For ' + F }), n ? h('button', { type: 'button', cls: 'pq-link sm', text: 'Clear ' + n + ' exception' + (n === 1 ? '' : 's'), on: { click: function () { clearPerson(e); } } }) : h('small', { cls: 'pq-usual', text: 'No exceptions' })]),
      h('th', { scope: 'col', cls: 'pq-colh' }, [h('b', { text: 'Result' }), h('small', { text: 'What ' + F + ' gets' })])
    ]));
    var tbody = h('tbody', ROWS.map(function (it) {
      var sub = !!it.parent, mine = X.people[e.id] || {}, cur = it.k in mine ? (mine[it.k] ? 'on' : 'off') : 'group', grp = rule(lvl, it.k), has = personHas(e, it.k);
      var blocked = sub && !own(e, it.parent.k);
      return h('tr', { cls: (sub ? 'pq-r-sub' : 'pq-r-sec') + (cur !== 'group' ? ' is-ex' : '') }, [
        h('th', { scope: 'row', cls: 'pq-rowh' }, h('div', { cls: 'pq-rh' }, [sub ? h('span', { cls: 'pq-branch', 'aria-hidden': 'true' }) : icon(it.icon), h('span', { cls: 'pq-rt' }, [h('b', { text: it.name }), h('small', { text: it.desc })])])),
        h('td', { cls: 'pq-cell' }, h('span', { cls: 'pq-pill' + (grp ? ' on' : ''), text: grp ? 'On' : 'Off' })),
        h('td', { cls: 'pq-cell pq-colw' }, h('div', { cls: 'pq-seg', role: 'group', 'aria-label': it.name + ' for ' + e.name }, [['group', 'Like group'], ['on', 'Yes'], ['off', 'No']].map(function (o) {
          return h('button', { type: 'button', 'aria-pressed': o[0] === cur ? 'true' : 'false', 'data-cell': o[0] === cur ? e.id + '|' + it.k : null, text: o[1],
            title: o[0] === 'group' ? 'Follow what ' + G.many.toLowerCase() + ' get (now ' + (grp ? 'on' : 'off') + ')' : null,
            on: { click: function () { if (o[0] !== cur && !X.busy) setPerson(e, it.k, o[0], cur); } } });
        }))),
        h('td', { cls: 'pq-cell' }, blocked ? h('span', { cls: 'pq-res', title: 'Needs ' + it.parent.name, text: '– needs ' + it.parent.name }) : h('span', { cls: 'pq-res' + (has ? ' on' : ''), text: has ? 'Can' : 'Can’t' }))
      ]);
    }));
    var t = tabsFor(function (k) { return personHas(e, k); });
    var tfoot = h('tfoot', null, h('tr', [h('th', { scope: 'row', cls: 'pq-rowh' }, h('div', { cls: 'pq-rh' }, [h('span', { cls: 'pq-rt' }, [h('b', { text: F + '’s staff page' }), h('small', { text: 'The tabs they’ll see' })])])),
      h('td', { cls: 'pq-tabsum', colspan: '3' }, t.length ? h('ul', t.map(function (x) { return h('li', { text: x }); })) : h('span', { cls: 'pq-bad', text: 'Nothing: their staff page will be empty.' }))]));
    wrap.appendChild(h('div', { cls: 'pq-card pq-gridcard' }, [h('div', { cls: 'pq-scroll' }, h('table', { cls: 'pq-grid pq-pgrid' }, [thead, tbody, tfoot]))]));
  }
  function explainPerson(e, k, v) {
    var F = firstName(e), it = ITEM[k], G = LV[levelOf(e)].many.toLowerCase(), grp = rule(levelOf(e), k);
    var pre = it.parent && !own(e, it.parent.k) ? ' This takes effect once ' + F + ' has ' + it.parent.name + '.' : '';
    if (v === 'group') return F + ' follows ' + G + ' again: ' + (grp ? 'can ' : 'can’t ') + it.does + '.' + pre;
    if (v === 'on') return F + ' can now ' + it.does + (grp ? ', and keeps it even if you turn it off for ' + G : ', even though other ' + G + ' can’t') + '.' + pre;
    return F + ' can no longer ' + it.does + (grp ? ', even though other ' + G + ' can' : ', and won’t get it even if you turn it on for ' + G) + '.' + (it.off ? ' ' + it.off : '') + pre;
  }
  function setPerson(e, k, v, was) {
    var text = explainPerson(e, k, v);
    X.busy = true;
    putPerson(e, k, v).then(function (ok) {
      X.busy = false;
      if (!ok) { X.note = { bad: true, text: 'Only the Owner can change permissions. Check your connection and try again.' }; render(); return; }
      logIt(text, function () { return putPerson(e, k, was); });
      X.note = { text: text }; X.focus = e.id + '|' + k; render();
    });
  }
  function putPerson(e, k, v) {
    var sb = X.ctx.sb, done = function (r) {
      if (r.error) return false;
      var m = X.people[e.id] = X.people[e.id] || {};
      if (v === 'group') delete m[k]; else m[k] = v === 'on';
      if (!Object.keys(m).length) delete X.people[e.id];
      return true;
    };
    var q = v === 'group' ? sb.from('section_people').delete().eq('employee_id', e.id).eq('section', k)
      : sb.from('section_people').upsert({ employee_id: e.id, section: k, allowed: v === 'on' }, { onConflict: 'employee_id,section' });
    return q.then(done, function () { return false; });
  }
  function clearPerson(e) {
    var F = firstName(e), G = LV[levelOf(e)].many.toLowerCase(), saved = Object.assign({}, X.people[e.id] || {});
    if (!confirm('Clear ' + F + '’s exceptions?\n\n' + F + ' will get exactly what other ' + G + ' get.')) return;
    X.ctx.sb.from('section_people').delete().eq('employee_id', e.id).then(function (r) {
      if (r.error) { X.note = { bad: true, text: 'Couldn’t clear them. Try again.' }; render(); return; }
      delete X.people[e.id];
      var text = F + ' now gets exactly what other ' + G + ' get.';
      logIt(text, function () {
        var rows = Object.keys(saved).map(function (k) { return { employee_id: e.id, section: k, allowed: saved[k] }; });
        return X.ctx.sb.from('section_people').upsert(rows, { onConflict: 'employee_id,section' }).then(function (x) { if (x.error) return false; X.people[e.id] = saved; return true; });
      });
      X.note = { text: text }; render();
    });
  }

  /* ---------- recent changes, with Undo ---------- */
  function logIt(text, undoFn) { X.log.unshift({ text: text, undo: undoFn }); X.log = X.log.slice(0, 8); }
  function undo(c, btn) {
    if (btn) btn.disabled = true;
    c.undo().then(function (ok) { c.undone = !!ok; X.note = ok ? { text: 'Undone: ' + c.text } : { bad: true, text: 'Couldn’t undo that. Try again.' }; X.note.noUndo = true; render(); });
  }
  function logCard() {
    return h('section', { cls: 'pq-card pq-log' }, [h('h2', { text: 'Your changes' }), h('ul', X.log.map(function (c) {
      return h('li', [h('span', { text: c.text }), c.undone ? h('small', { text: 'Undone' }) : h('button', { type: 'button', cls: 'pq-link sm', text: 'Undo', on: { click: function () { undo(c, this); } } })]);
    }))]);
  }

  window.EdenPerms = { show: show, SECTIONS: SECTIONS };
})();
