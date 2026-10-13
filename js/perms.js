/* Eden staff site: Team > Employees > Permissions (Owner only).
 * What each kind of employee (Employee, Cook, Server) can see and do on the staff page, section by section, with
 * finer controls inside sections (reading the board vs posting on it, seeing the Prep List vs filling it in, …),
 * and exceptions for one person. Every change is explained in plain words and can be undone.
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
    { k: 'prep', name: 'Prep List', icon: 'list', desc: 'The kitchen’s shared prep list. Out of the box, only cooks get it.', does: 'see the Prep List',
      subs: [{ k: 'prep.edit', name: 'Fill it in', desc: 'Tick lines, fill in On hand, choose Do or X, sign with their initials, and add or remove lines. When this is off, the list is read only.', does: 'fill in the Prep List', off: 'They can still read it.' }] },
    { k: 'recipes', name: 'Recipes', icon: 'pot', desc: 'The recipe book. Only you and managers can change recipes.', does: 'read the recipe book' },
    { k: 'calendar', name: 'Calendar', icon: 'flag', desc: 'Upcoming events and private parties.', does: 'see the event calendar' }
  ];
  var ITEM = {}; SECTIONS.forEach(function (s) { ITEM[s.k] = s; (s.subs || []).forEach(function (x) { x.parent = s; ITEM[x.k] = x; }); });
  var LEVELS = [['employee', 'Employee', 'Employees'], ['cook', 'Cook', 'Cooks'], ['server', 'Server', 'Servers']];
  var LV = {}; LEVELS.forEach(function (l) { LV[l[0]] = { one: l[1], many: l[2] }; });
  var ICONS = {
    cal: 'M4 6h16v14H4zM4 10h16M9 3v4M15 3v4', check: 'M5 12l4 4 10-10', sun: 'M12 4v2M12 18v2M4 12h2M18 12h2M6.3 6.3l1.4 1.4M16.3 16.3l1.4 1.4M6.3 17.7l1.4-1.4M16.3 7.7l1.4-1.4M12 8a4 4 0 100 8 4 4 0 000-8z',
    chat: 'M4 5h16v11H9l-5 4z', brief: 'M4 8h16v11H4zM9 8V5h6v3', book: 'M5 4h10l4 4v12H5zM15 4v4h4', list: 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
    pot: 'M4 10h16l-1.5 9h-13zM8 10V7M12 10V5M16 10V7', flag: 'M5 21V4M5 4h11l-2 4 2 4H5'
  };
  var X = { ctx: null, el: null, rules: {}, people: {}, emps: [], tab: 'employee', pick: '', log: [], flash: null };
  try { X.tab = localStorage.getItem('eden.perms.tab') || 'employee'; } catch (e) {}

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
  function setTab(t) { X.tab = t; try { localStorage.setItem('eden.perms.tab', t); } catch (e) {} }

  // the rules
  function dflt(level, k) { return k === 'prep' ? level === 'cook' : true; }
  function rule(level, k) { var key = level + '|' + k; return key in X.rules ? X.rules[key] : dflt(level, k); }
  function groupHas(level, k) { var it = ITEM[k]; return it.parent ? rule(level, it.parent.k) && rule(level, k) : rule(level, k); }
  function levelOf(e) { return e.access === 'cook' || e.access === 'server' ? e.access : 'employee'; }
  function own(e, k) { var m = X.people[e.id] || {}; return k in m ? m[k] : rule(levelOf(e), k); }
  function personHas(e, k) { var it = ITEM[k]; return it.parent ? own(e, it.parent.k) && own(e, k) : own(e, k); }
  function peopleIn(level) { return X.emps.filter(function (e) { return levelOf(e) === level; }); }
  function changedFromDefault(level) { return Object.keys(X.rules).filter(function (key) { var p = key.split('|'); return p[0] === level && X.rules[key] !== dflt(level, p[1]); }).length; }

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
      X.rules = {}; ((r[0] && r[0].data) || []).forEach(function (x) { if (ITEM[x.section]) X.rules[x.level + '|' + x.section] = !!x.allowed; });
      X.people = {}; ((r[1] && r[1].data) || []).forEach(function (x) { if (ITEM[x.section]) (X.people[x.employee_id] = X.people[x.employee_id] || {})[x.section] = !!x.allowed; });
      X.emps = ((r[2] && r[2].data) || []).filter(function (e) { return e.active !== false && e.access !== 'manager' && e.access !== 'owner' && e.name; });
      if (X.pick && !X.emps.some(function (e) { return e.id === X.pick; })) X.pick = '';
      render();
    });
  }

  /* ---------- the page ---------- */
  function render() {
    var el = X.el, keepY = window.scrollY; el.innerHTML = '';
    var wrap = h('div', { cls: 'pq' });
    el.appendChild(wrap);
    wrap.appendChild(h('header', { cls: 'pq-top' }, [
      h('p', { cls: 'sc-eyebrow', text: 'Team · Employees' }),
      h('h1', { cls: 'sc-week', text: 'Permissions' }),
      h('p', { cls: 'pq-lead', text: 'Choose what each kind of employee can see and do on the staff page. Changes save straight away and apply the next time they open or refresh the page.' })
    ]));
    if (X.missing) { wrap.appendChild(h('div', { cls: 'pq-card pq-pad' }, [h('p', { text: 'One step first: in Supabase, open SQL Editor > New query, paste in supabase/permissions.sql and click Run. Then reload this page.' })])); return; }
    if (X.err) { wrap.appendChild(h('p', { cls: 'pq-bad', text: 'Couldn’t load permissions. Only the Owner can open this page.' })); return; }

    wrap.appendChild(howItWorks());
    wrap.appendChild(tabBar());
    var grid = h('div', { cls: 'pq-grid' });
    wrap.appendChild(grid);
    var main = h('div', { cls: 'pq-main' }), side = h('aside', { cls: 'pq-side', 'aria-label': 'Summary' });
    grid.appendChild(main); grid.appendChild(side);
    if (X.tab === 'person') personPanel(main, side); else groupPanel(X.tab, main, side);
    window.scrollTo(0, keepY);
    if (X.focus) { var f = el.querySelector('[data-k="' + X.focus + '"] .pq-sw, [data-k="' + X.focus + '"] [aria-pressed="true"]'); if (f) f.focus({ preventScroll: true }); X.focus = null; }
  }

  function howItWorks() {
    var open = true; try { open = localStorage.getItem('eden.perms.how') !== '0'; } catch (e) {}
    var d = h('details', { cls: 'pq-how', open: open ? true : null }, [
      h('summary', { text: 'How permissions work' }),
      h('ol', { cls: 'pq-steps' }, [
        h('li', [h('b', { text: 'Pick a group.' }), ' Every employee is an Employee, a Cook or a Server. You set that on the Employees page, under Access.']),
        h('li', [h('b', { text: 'Switch sections on or off.' }), ' Some sections have finer controls inside them, like reading the message board but not posting. A finer control only works while its section is on.']),
        h('li', [h('b', { text: 'Make exceptions.' }), ' Under “One person”, give someone something their group doesn’t have, or take something away, just for them.'])
      ]),
      h('p', { cls: 'pq-muted', text: 'You and your managers always have everything. Kitchen logins count as Cooks, and Front-of-house logins as Servers. When something is off, it’s hidden from their staff page and the database stops sending it to them, so it can’t be opened another way.' })
    ]);
    d.addEventListener('toggle', function () { try { localStorage.setItem('eden.perms.how', d.open ? '1' : '0'); } catch (e) {} });
    return d;
  }

  function tabBar() {
    var nav = h('div', { cls: 'pq-tabs', role: 'tablist', 'aria-label': 'Whose permissions' });
    LEVELS.map(function (l) { return [l[0], l[2], peopleIn(l[0]).length + (peopleIn(l[0]).length === 1 ? ' person' : ' people')]; })
      .concat([['person', 'One person', Object.keys(X.people).length ? Object.keys(X.people).length + ' with exceptions' : 'Exceptions']]).forEach(function (t) {
        var on = X.tab === t[0];
        nav.appendChild(h('button', { type: 'button', role: 'tab', cls: 'pq-tab', id: 'pqTab-' + t[0], 'aria-selected': on ? 'true' : 'false', tabindex: on ? '0' : '-1',
          on: { click: function () { setTab(t[0]); render(); }, keydown: tabKeys } }, [h('span', { text: t[1] }), h('small', { text: t[2] })]));
      });
    return nav;
  }
  function tabKeys(ev) {
    if (ev.key !== 'ArrowRight' && ev.key !== 'ArrowLeft') return;
    var all = [].slice.call(ev.currentTarget.parentNode.children), i = all.indexOf(ev.currentTarget);
    var next = all[(i + (ev.key === 'ArrowRight' ? 1 : -1) + all.length) % all.length];
    setTab(next.id.replace('pqTab-', '')); render();
    var n = document.getElementById(next.id); if (n) n.focus();
  }

  /* ---------- a group: Employees, Cooks or Servers ---------- */
  function groupPanel(level, main, side) {
    var G = LV[level], n = changedFromDefault(level);
    main.appendChild(h('div', { cls: 'pq-head', role: 'tabpanel', 'aria-labelledby': 'pqTab-' + level }, [
      h('div', [h('h2', { cls: 'pq-h2', text: G.many }), h('p', { cls: 'pq-muted', text: n ? n + ' change' + (n === 1 ? '' : 's') + ' from the usual settings.' : 'Using the usual settings.' })]),
      n ? h('button', { type: 'button', cls: 'pq-link', text: 'Back to the usual settings', on: { click: function () { resetGroup(level); } } }) : null
    ]));
    SECTIONS.forEach(function (s) {
      var on = rule(level, s.k);
      var card = h('section', { cls: 'pq-card pq-sec' + (on ? '' : ' is-off'), 'data-k': s.k, 'aria-label': s.name });
      card.appendChild(h('div', { cls: 'pq-row pq-row-main' }, [
        icon(s.icon),
        h('div', { cls: 'pq-txt' }, [h('h3', { text: s.name }), h('p', { text: s.desc })]),
        sw(on, s.name + ' for ' + G.many.toLowerCase(), function (v) { saveRule(level, s.k, v); })
      ]));
      card.appendChild(h('p', { cls: 'pq-now' + (on ? ' on' : '') }, [h('span', { cls: 'pq-dot', 'aria-hidden': 'true' }), sentenceGroup(level, s)]));
      if (s.subs) {
        var ul = h('ul', { cls: 'pq-subs', 'aria-label': 'Finer controls in ' + s.name });
        s.subs.forEach(function (x) {
          var v = rule(level, x.k);
          ul.appendChild(h('li', { cls: 'pq-row pq-sub' + (on ? '' : ' is-dim'), 'data-k': x.k }, [
            h('div', { cls: 'pq-txt' }, [h('h4', { text: x.name }), h('p', { text: on ? x.desc : 'Turn on ' + s.name + ' first. ' + x.desc })]),
            sw(v, x.name + ' (' + s.name + ') for ' + G.many.toLowerCase(), function (val) { saveRule(level, x.k, val); }, !on)
          ]));
        });
        card.appendChild(ul);
      }
      if (X.flash && X.flash.k && (X.flash.k === s.k || (ITEM[X.flash.k].parent === s)) && X.flash.where === level) card.appendChild(flashNote());
      main.appendChild(card);
    });
    summary(side, G.many, function (k) { return groupHas(level, k); }, peopleIn(level), level);
  }
  // one line under each section: what this group gets, in plain words
  function sentenceGroup(level, s) {
    var G = LV[level].many;
    if (!rule(level, s.k)) return G + ' don’t see ' + s.name + '.';
    if (!s.subs) return G + ' can ' + s.does + '.';
    var yes = s.subs.filter(function (x) { return rule(level, x.k); }), no = s.subs.filter(function (x) { return !rule(level, x.k); });
    if (!no.length) return G + ' can ' + s.does + (s.subs.length === 1 ? ' and ' + s.subs[0].does : ', with every part on') + '.';
    if (!yes.length) return G + ' can ' + s.does + ', but ' + list(no.map(function (x) { return x.name.toLowerCase(); })) + (no.length === 1 ? ' is' : ' are') + ' off.';
    return G + ' can ' + s.does + '. Off for them: ' + list(no.map(function (x) { return x.name.toLowerCase(); })) + '.';
  }
  function list(a) { return a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1]; }
  function sw(on, label, change, disabled) {
    var b = h('button', { type: 'button', cls: 'pq-sw', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label, disabled: disabled ? true : null },
      [h('span', { cls: 'pq-knob', 'aria-hidden': 'true' }), h('span', { cls: 'pq-swt', 'aria-hidden': 'true', text: on ? 'On' : 'Off' })]);
    b.addEventListener('click', function () { var v = b.getAttribute('aria-checked') !== 'true'; b.disabled = true; change(v); });
    return b;
  }
  function explainGroup(level, k, v) {
    var G = LV[level].many, it = ITEM[k];
    if (it.parent && !rule(level, it.parent.k)) return G + ' will ' + (v ? '' : 'not ') + 'be able to ' + it.does + ' once ' + it.parent.name + ' is on.';
    if (v) {
      var extra = it.subs ? it.subs.filter(function (x) { return !rule(level, x.k); }) : [];
      return G + ' can now ' + it.does + '.' + (extra.length ? ' ' + list(extra.map(function (x) { return x.name; })) + (extra.length === 1 ? ' stays' : ' stay') + ' off.' : '');
    }
    return G + ' can no longer ' + it.does + '.' + (it.off ? ' ' + it.off : '') + (it.subs ? ' Its finer controls are kept for when you turn it back on.' : '');
  }
  function saveRule(level, k, v) {
    var before = X.rules[level + '|' + k], hadKey = (level + '|' + k) in X.rules;
    var text = explainGroup(level, k, v);
    write(level, k, v).then(function (ok) {
      if (!ok) { X.flash = { k: k, where: level, bad: true, text: 'Couldn’t save that. Only the Owner can change permissions; check your connection and try again.' }; render(); return; }
      X.flash = { k: k, where: level, text: text };
      logIt(text, function () { return hadKey ? write(level, k, before) : unwrite(level, k); });
      X.focus = k; render();
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
    if (!confirm(G + ': back to the usual settings?\n\nEverything is on' + (level === 'cook' ? ', including the Prep List' : ' except the Prep List') + '. Exceptions you made for one person stay.')) return;
    var saved = {}; Object.keys(X.rules).forEach(function (key) { if (key.indexOf(level + '|') === 0) saved[key] = X.rules[key]; });
    X.ctx.sb.from('section_rules').delete().eq('level', level).then(function (r) {
      if (r.error) { X.flash = { where: level, bad: true, text: 'Couldn’t reset. Try again.' }; render(); return; }
      Object.keys(saved).forEach(function (key) { delete X.rules[key]; });
      var text = G + ' are back to the usual settings.';
      X.flash = { where: level, text: text, top: true };
      logIt(text, function () {
        var rows = Object.keys(saved).map(function (key) { return { level: level, section: key.split('|')[1], allowed: saved[key] }; });
        if (!rows.length) return Promise.resolve(true);
        return X.ctx.sb.from('section_rules').upsert(rows, { onConflict: 'level,section' }).then(function (x) { if (x.error) return false; Object.keys(saved).forEach(function (key) { X.rules[key] = saved[key]; }); return true; });
      });
      render();
    });
  }

  /* ---------- one person ---------- */
  function personPanel(main, side) {
    var head = h('div', { cls: 'pq-head', role: 'tabpanel', 'aria-labelledby': 'pqTab-person' }, [h('div', [h('h2', { cls: 'pq-h2', text: 'One person' }),
      h('p', { cls: 'pq-muted', text: 'Give someone a section their group doesn’t have, or take one away, just for them. Everything else keeps following their group.' })])]);
    main.appendChild(head);
    if (!X.emps.length) { main.appendChild(h('div', { cls: 'pq-card pq-pad' }, [h('p', { text: 'No employees yet. Add them on the Employees page.' })])); summary(side, '', null, null, null); return; }
    // pick someone, grouped by kind
    var picker = h('div', { cls: 'pq-card pq-pick' });
    LEVELS.forEach(function (l) {
      var ppl = peopleIn(l[0]); if (!ppl.length) return;
      picker.appendChild(h('div', { cls: 'pq-pgrp' }, [h('p', { cls: 'pq-plabel', text: l[2] }), h('div', { cls: 'pq-chips' }, ppl.map(function (e) {
        var n = Object.keys(X.people[e.id] || {}).length;
        return h('button', { type: 'button', cls: 'pq-chip', 'aria-pressed': X.pick === e.id ? 'true' : 'false', on: { click: function () { X.pick = X.pick === e.id ? '' : e.id; render(); } } },
          [e.name, n ? h('span', { cls: 'pq-badge', text: n + ' exception' + (n === 1 ? '' : 's') }) : null]);
      }))]));
    });
    main.appendChild(picker);
    var e = X.emps.filter(function (x) { return x.id === X.pick; })[0];
    if (!e) { main.appendChild(h('p', { cls: 'pq-muted pq-pad', text: 'Choose someone above to see exactly what they can do.' })); summary(side, '', null, null, null); return; }
    var lvl = levelOf(e), G = LV[lvl], mine = X.people[e.id] || {}, n = Object.keys(mine).length;
    main.appendChild(h('div', { cls: 'pq-person' }, [
      h('div', [h('h3', { cls: 'pq-pname', text: e.name }), h('p', { cls: 'pq-muted', text: G.one + (e.position ? ' · ' + e.position : '') + ' · ' + (n ? n + ' exception' + (n === 1 ? '' : 's') + '; everything else follows ' + G.many.toLowerCase() + '.' : 'follows everything ' + G.many.toLowerCase() + ' get.') })]),
      n ? h('button', { type: 'button', cls: 'pq-link', text: 'Clear ' + firstName(e) + '’s exceptions', on: { click: function () { clearPerson(e); } } }) : null
    ]));
    SECTIONS.forEach(function (s) {
      var on = personHas(e, s.k);
      var card = h('section', { cls: 'pq-card pq-sec' + (on ? '' : ' is-off'), 'data-k': s.k, 'aria-label': s.name });
      card.appendChild(h('div', { cls: 'pq-row pq-row-main pq-prow' }, [icon(s.icon), h('div', { cls: 'pq-txt' }, [h('h3', { text: s.name }), h('p', { text: s.desc })]), seg(e, s.k, s.name)]));
      card.appendChild(h('p', { cls: 'pq-now' + (on ? ' on' : '') }, [h('span', { cls: 'pq-dot', 'aria-hidden': 'true' }), sentencePerson(e, s)]));
      if (s.subs) {
        card.appendChild(h('ul', { cls: 'pq-subs', 'aria-label': 'Finer controls in ' + s.name }, s.subs.map(function (x) {
          return h('li', { cls: 'pq-row pq-sub pq-prow' + (own(e, s.k) ? '' : ' is-dim'), 'data-k': x.k }, [
            h('div', { cls: 'pq-txt' }, [h('h4', { text: x.name }), h('p', { text: own(e, s.k) ? x.desc : 'Only matters once ' + firstName(e) + ' has ' + s.name + '. ' + x.desc })]),
            seg(e, x.k, x.name)]);
        })));
      }
      if (X.flash && X.flash.k && (X.flash.k === s.k || ITEM[X.flash.k].parent === s) && X.flash.where === e.id) card.appendChild(flashNote());
      main.appendChild(card);
    });
    summary(side, firstName(e), function (k) { return personHas(e, k); }, null, lvl, e);
  }
  function firstName(e) { return String(e.name || '').split(/\s+/)[0] || e.name; }
  function seg(e, k, name) {
    var mine = X.people[e.id] || {}, cur = k in mine ? (mine[k] ? 'on' : 'off') : 'group', grp = rule(levelOf(e), k), G = LV[levelOf(e)];
    return h('div', { cls: 'pq-seg', role: 'group', 'aria-label': name + ' for ' + e.name }, [
      ['group', 'Like ' + G.many.toLowerCase(), grp ? 'on' : 'off'], ['on', 'Yes'], ['off', 'No']].map(function (o) {
        return h('button', { type: 'button', 'aria-pressed': o[0] === cur ? 'true' : 'false', title: o[0] === 'group' ? 'Follow what ' + G.many.toLowerCase() + ' get (now ' + o[2] + ')' : null,
          on: { click: function () { if (o[0] !== cur) setPerson(e, k, o[0], cur); } } }, [o[1], o[2] ? h('small', { text: ' (' + o[2] + ')' }) : null]);
      }));
  }
  function sentencePerson(e, s) {
    var F = firstName(e), G = LV[levelOf(e)].many.toLowerCase();
    var ex = function (k) { return k in (X.people[e.id] || {}); };
    if (!own(e, s.k)) return F + ' doesn’t see ' + s.name + (ex(s.k) ? ' (an exception: ' + G + ' ' + (rule(levelOf(e), s.k) ? 'do' : 'don’t either') + ').' : '.');
    var no = (s.subs || []).filter(function (x) { return !own(e, x.k); });
    var t = F + ' can ' + s.does + (ex(s.k) ? ' (an exception: ' + G + ' ' + (rule(levelOf(e), s.k) ? 'can too' : 'can’t') + ')' : '') + '.';
    if (no.length) t += ' Off for ' + F + ': ' + list(no.map(function (x) { return x.name.toLowerCase(); })) + '.';
    return t;
  }
  function explainPerson(e, k, v) {
    var F = firstName(e), it = ITEM[k], G = LV[levelOf(e)].many.toLowerCase(), grp = rule(levelOf(e), k);
    var pre = it.parent && !own(e, it.parent.k) ? ' This takes effect once ' + F + ' has ' + it.parent.name + '.' : '';
    if (v === 'group') return F + ' follows ' + G + ' again: ' + (grp ? 'can ' : 'can’t ') + it.does + '.' + pre;
    if (v === 'on') return F + ' can now ' + it.does + (grp ? ', and will keep it even if you turn it off for ' + G : ', even though other ' + G + ' can’t') + '.' + pre;
    return F + ' can no longer ' + it.does + (grp ? ', even though other ' + G + ' can' : ', and won’t get it even if you turn it on for ' + G) + '.' + (it.off ? ' ' + it.off : '') + pre;
  }
  function setPerson(e, k, v, was) {
    var text = explainPerson(e, k, v);
    putPerson(e, k, v).then(function (ok) {
      if (!ok) { X.flash = { k: k, where: e.id, bad: true, text: 'Couldn’t save that. Only the Owner can change permissions; check your connection and try again.' }; render(); return; }
      X.flash = { k: k, where: e.id, text: text };
      logIt(text, function () { return putPerson(e, k, was); });
      X.focus = k; render();
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
    var F = firstName(e), saved = Object.assign({}, X.people[e.id] || {});
    if (!confirm('Clear ' + F + '’s exceptions?\n\n' + F + ' will get exactly what other ' + LV[levelOf(e)].many.toLowerCase() + ' get.')) return;
    X.ctx.sb.from('section_people').delete().eq('employee_id', e.id).then(function (r) {
      if (r.error) { X.flash = { where: e.id, bad: true, text: 'Couldn’t clear them. Try again.' }; render(); return; }
      delete X.people[e.id];
      var text = F + ' now gets exactly what other ' + LV[levelOf(e)].many.toLowerCase() + ' get.';
      X.flash = { where: e.id, text: text, top: true };
      logIt(text, function () {
        var rows = Object.keys(saved).map(function (k) { return { employee_id: e.id, section: k, allowed: saved[k] }; });
        return X.ctx.sb.from('section_people').upsert(rows, { onConflict: 'employee_id,section' }).then(function (x) { if (x.error) return false; X.people[e.id] = saved; return true; });
      });
      render();
    });
  }

  /* ---------- explanations: the note after a change, the summary, and recent changes ---------- */
  function flashNote() {
    var f = X.flash; X.flash = null;
    return h('p', { cls: 'pq-flash' + (f.bad ? ' bad' : ''), role: 'status' }, [h('b', { text: f.bad ? 'Not saved. ' : 'Saved. ' }), f.text]);
  }
  function logIt(text, undo) {
    X.log.unshift({ text: text, undo: undo, at: new Date() });
    X.log = X.log.slice(0, 8);
  }
  function summary(side, who, has, ppl, level, person) {
    // a change that isn't tied to one section (back to usual settings, clearing exceptions) shows at the top of the summary
    if (X.flash && X.flash.top) side.appendChild(flashNote());
    if (has) {
      var tabs = tabsFor(has);
      side.appendChild(h('section', { cls: 'pq-card pq-sum' }, [
        h('h3', { text: 'What ' + who + (person ? ' sees' : ' see') }),
        h('p', { cls: 'pq-muted', text: 'Tabs on ' + (person ? 'their' : 'their') + ' staff page:' }),
        tabs.length ? h('div', { cls: 'pq-mock', 'aria-label': 'Staff page tabs' }, tabs.map(function (t) { return h('span', { text: t }); })) : h('p', { cls: 'pq-bad', text: 'Nothing: their staff page will be empty.' }),
        h('p', { cls: 'pq-plabel', text: 'Can' }),
        h('ul', { cls: 'pq-cl yes' }, can(has, true)),
        can(has, false).length ? h('p', { cls: 'pq-plabel', text: 'Can’t' }) : null,
        can(has, false).length ? h('ul', { cls: 'pq-cl no' }, can(has, false)) : null
      ]));
    }
    if (ppl) side.appendChild(h('section', { cls: 'pq-card pq-sum' }, [
      h('h3', { text: 'Who this covers' }),
      ppl.length ? h('ul', { cls: 'pq-names' }, ppl.map(function (e) {
        var n = Object.keys(X.people[e.id] || {}).length;
        return h('li', [e.name, n ? h('button', { type: 'button', cls: 'pq-link sm', text: n + ' exception' + (n === 1 ? '' : 's'), on: { click: function () { X.pick = e.id; setTab('person'); render(); } } }) : null]);
      })) : h('p', { cls: 'pq-muted', text: 'Nobody yet. Set someone’s Access to ' + LV[level].one + ' on the Employees page.' }),
      level === 'cook' ? h('p', { cls: 'pq-muted', text: 'Plus anyone signed in with the Kitchen login.' }) : level === 'server' ? h('p', { cls: 'pq-muted', text: 'Plus anyone signed in with the Front-of-house login.' }) : null
    ]));
    if (X.log.length) side.appendChild(h('section', { cls: 'pq-card pq-sum' }, [
      h('h3', { text: 'Your changes' }),
      h('ul', { cls: 'pq-log' }, X.log.map(function (c, i) {
        return h('li', [h('span', { text: c.text }), c.undone ? h('small', { text: 'Undone' }) : h('button', { type: 'button', cls: 'pq-link sm', text: 'Undo', on: { click: function () {
          this.disabled = true;
          c.undo().then(function (ok) { c.undone = !!ok; X.flash = { top: true, bad: !ok, text: ok ? 'Undid: ' + c.text : 'Couldn’t undo that. Try again.' }; render(); });
        } } })]);
      }))
    ]));
  }
  function can(has, yes) {
    var out = [];
    SECTIONS.forEach(function (s) {
      if (has(s.k) === yes) out.push(h('li', { text: cap(s.does) }));
      if (has(s.k)) (s.subs || []).forEach(function (x) { if (has(x.k) === yes) out.push(h('li', { text: cap(x.does) })); });
    });
    return out;
  }
  function cap(t) { return t.charAt(0).toUpperCase() + t.slice(1); }

  window.EdenPerms = { show: show, SECTIONS: SECTIONS };
})();
