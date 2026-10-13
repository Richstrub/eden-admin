/* Eden staff site: Team > Employees > Permissions (Owner only).
 * Which sections of the staff page each kind of employee can use (Employee, Cook, Server), and exceptions for one
 * person. The Owner and managers always have every section. Enforced by the database (supabase/permissions.sql).
 */
(function () {
  'use strict';
  var SECTIONS = [
    ['schedule', 'Schedule', 'Their shifts and who’s working'],
    ['todos', 'To-dos', 'To-dos given to them'],
    ['timeoff', 'Time off', 'Asking for time off'],
    ['board', 'Message board', 'Reading and posting notes for the team'],
    ['preshift', 'Pre-shift', 'Education, reservations, menu changes and notes'],
    ['resources', 'Resources', 'Food, beverage and hospitality PDFs'],
    ['prep', 'Prep List', 'Seeing and filling in the prep list'],
    ['recipes', 'Recipes', 'The recipe book'],
    ['calendar', 'Calendar', 'Events and private parties']
  ];
  var LEVELS = [['employee', 'Employee'], ['cook', 'Cook'], ['server', 'Server']];
  var X = { ctx: null, el: null, rules: {}, people: {}, emps: [], pick: '' };
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
  function gone(e) { return !!(e && (e.code === 'PGRST205' || e.code === '42P01' || /section_|schedule cache|schema cache|does not exist/i.test(e.message || ''))); }
  function say(t, k) { var m = X.el && X.el.querySelector('.pr-msg'); if (m) { m.textContent = t || ''; m.className = 'pr-msg' + (k ? ' ' + k : ''); } }
  function dflt(level, sec) { return sec === 'prep' ? level === 'cook' : true; }
  function rule(level, sec) { var k = level + '|' + sec; return k in X.rules ? X.rules[k] : dflt(level, sec); }
  function levelOf(e) { return e.access === 'cook' || e.access === 'server' ? e.access : 'employee'; }

  function show(ctx) {
    X.ctx = ctx; X.el = ctx.el; X.el.innerHTML = '';
    X.el.appendChild(h('div', { cls: 'pr' }, [h('p', { cls: 'ps-src', text: 'Loading…' })]));
    var sb = ctx.sb;
    Promise.all([sb.from('section_rules').select('level,section,allowed'), sb.from('section_people').select('employee_id,section,allowed'), sb.from('employees').select('id,name,access,active,position').order('name')]).then(function (r) {
      if (r[0].error || r[1].error) { X.missing = gone(r[0].error || r[1].error); X.err = !X.missing; }
      else { X.missing = false; X.err = false; }
      X.rules = {}; ((r[0] && r[0].data) || []).forEach(function (x) { X.rules[x.level + '|' + x.section] = !!x.allowed; });
      X.people = {}; ((r[1] && r[1].data) || []).forEach(function (x) { (X.people[x.employee_id] = X.people[x.employee_id] || {})[x.section] = !!x.allowed; });
      X.emps = ((r[2] && r[2].data) || []).filter(function (e) { return e.active !== false && e.access !== 'manager' && e.name; });
      render();
    });
  }
  function render() {
    var el = X.el; el.innerHTML = '';
    var wrap = h('div', { cls: 'pr' });
    wrap.appendChild(h('p', { cls: 'sc-eyebrow', text: 'Team · Employees' }));
    wrap.appendChild(h('h1', { cls: 'sc-week', text: 'Permissions' }));
    wrap.appendChild(h('p', { cls: 'pr-lead', text: 'Choose which parts of the staff page each kind of employee can use. You and your managers always have everything. Kitchen logins count as cooks, and Front-of-house logins as servers.' }));
    wrap.appendChild(h('p', { cls: 'pr-msg', role: 'status' }));
    el.appendChild(wrap);
    if (X.missing) { wrap.appendChild(h('div', { cls: 'eo-card' }, [h('p', { text: 'One step first: in Supabase, open SQL Editor > New query, paste in supabase/permissions.sql and click Run. Then reload this page.' })])); return; }
    if (X.err) { wrap.appendChild(h('p', { cls: 'eo-err', text: 'Couldn’t load permissions. Only the Owner can open this page.' })); return; }
    // the grid: sections × Employee / Cook / Server
    var head = h('tr', [h('th', { text: 'Section' })].concat(LEVELS.map(function (l) {
      var n = X.emps.filter(function (e) { return levelOf(e) === l[0]; }).length;
      return h('th', { cls: 'pr-c' }, [l[1], h('small', { text: n + (n === 1 ? ' person' : ' people') })]);
    })));
    var body = h('tbody', SECTIONS.map(function (s) {
      return h('tr', [h('th', { scope: 'row' }, [h('b', { text: s[1] }), h('small', { text: s[2] })])].concat(LEVELS.map(function (l) {
        var on = rule(l[0], s[0]);
        return h('td', { cls: 'pr-c' }, toggle(on, l[1] + ': ' + s[1], function (v, btn) {
          btn.disabled = true;
          X.ctx.sb.from('section_rules').upsert({ level: l[0], section: s[0], allowed: v }, { onConflict: 'level,section' }).then(function (r) {
            btn.disabled = false;
            if (r.error) { say('Couldn’t save. Only the Owner can change permissions.', 'err'); render(); return; }
            X.rules[l[0] + '|' + s[0]] = v; say((v ? 'On: ' : 'Off: ') + s[1] + ' for ' + l[1].toLowerCase() + 's.', 'ok');
            paintPeople();
          });
        }));
      })));
    }));
    wrap.appendChild(h('section', { cls: 'eo-card pr-grid' }, [h('div', { cls: 'pr-scroll' }, h('table', { cls: 'pr-table' }, [h('thead', head), body])),
      h('div', { cls: 'pr-foot' }, [h('button', { type: 'button', cls: 'pm-link', text: 'Back to the usual settings', on: { click: function () {
        if (!confirm('Back to the usual settings? Everyone gets every section, and only cooks get the Prep List. Exceptions for one person stay.')) return;
        X.ctx.sb.from('section_rules').delete().in('level', ['employee', 'cook', 'server']).then(function (r) { if (r.error) { say('Couldn’t reset.', 'err'); return; } X.rules = {}; render(); say('Back to the usual settings.', 'ok'); });
      } } })])]));
    // exceptions for one person
    var sel = h('select', { 'aria-label': 'Employee' }, [h('option', { value: '', text: 'Choose someone…' })].concat(X.emps.map(function (e) {
      var n = Object.keys(X.people[e.id] || {}).length;
      return h('option', { value: e.id, text: e.name + ' (' + ({ cook: 'Cook', server: 'Server' }[e.access] || 'Employee') + ')' + (n ? ' · ' + n + ' exception' + (n === 1 ? '' : 's') : '') });
    })));
    sel.value = X.pick || '';
    sel.addEventListener('change', function () { X.pick = sel.value; paintPeople(); });
    var box = h('div', { cls: 'pr-person' });
    var withEx = X.emps.filter(function (e) { return Object.keys(X.people[e.id] || {}).length; });
    wrap.appendChild(h('section', { cls: 'eo-card pr-ex' }, [
      h('h2', { cls: 'eo-h', text: 'Exceptions for one person' }),
      h('p', { cls: 'pr-lead', text: 'Give someone a section their group doesn’t have, or take one away, just for them.' }),
      withEx.length ? h('p', { cls: 'pr-have' }, ['Exceptions now: '].concat(withEx.map(function (e, i) { return h('button', { type: 'button', cls: 'pm-link', text: e.name + (i < withEx.length - 1 ? ',' : ''), on: { click: function () { X.pick = e.id; sel.value = e.id; paintPeople(); } } }); }))) : null,
      sel, box]));
    X.box = box;
    paintPeople();
  }
  function toggle(on, label, change) {
    var b = h('button', { type: 'button', cls: 'pr-sw', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': label });
    b.appendChild(h('span', { cls: 'pr-knob', 'aria-hidden': 'true' }));
    b.addEventListener('click', function () { var v = b.getAttribute('aria-checked') !== 'true'; b.setAttribute('aria-checked', v ? 'true' : 'false'); change(v, b); });
    return b;
  }
  function paintPeople() {
    var box = X.box; if (!box) return; box.innerHTML = '';
    var e = X.emps.filter(function (x) { return x.id === X.pick; })[0]; if (!e) return;
    var lvl = levelOf(e), mine = X.people[e.id] || {}, grp = { cook: 'Cook', server: 'Server' }[lvl] || 'Employee';
    box.appendChild(h('p', { cls: 'pr-who' }, [h('b', { text: e.name }), ' is a ' + grp.toLowerCase() + (e.position ? ' (' + e.position + ')' : '') + '. Sections follow what ' + grp.toLowerCase() + 's get, unless you change one here.']));
    box.appendChild(h('ul', { cls: 'pr-plist' }, SECTIONS.map(function (s) {
      var base = rule(lvl, s[0]), cur = s[0] in mine ? (mine[s[0]] ? 'on' : 'off') : 'group';
      var seg = h('div', { cls: 'pm-seg', role: 'group', 'aria-label': s[1] + ' for ' + e.name }, [['group', 'Same as ' + grp.toLowerCase() + 's (' + (base ? 'yes' : 'no') + ')'], ['on', 'Yes'], ['off', 'No']].map(function (o) {
        return h('button', { type: 'button', 'aria-pressed': o[0] === cur ? 'true' : 'false', text: o[1], on: { click: function () { setPerson(e, s, o[0]); } } });
      }));
      var eff = cur === 'group' ? base : cur === 'on';
      return h('li', { cls: cur !== 'group' ? 'is-ex' : null }, [h('span', { cls: 'pr-dot' + (eff ? ' on' : ''), 'aria-hidden': 'true' }), h('span', { cls: 'pr-pn' }, [h('b', { text: s[1] }), h('small', { text: eff ? 'Can use it' : 'Can’t use it' })]), seg]);
    })));
  }
  function setPerson(e, s, v) {
    var sb = X.ctx.sb, done = function (r) {
      if (r.error) { say('Couldn’t save. Only the Owner can change permissions.', 'err'); return; }
      var m = X.people[e.id] = X.people[e.id] || {};
      if (v === 'group') delete m[s[0]]; else m[s[0]] = v === 'on';
      if (!Object.keys(m).length) delete X.people[e.id];
      say(e.name + ': ' + s[1] + (v === 'group' ? ' follows their group again.' : v === 'on' ? ' on.' : ' off.'), 'ok');
      render();
    };
    if (v === 'group') sb.from('section_people').delete().eq('employee_id', e.id).eq('section', s[0]).then(done);
    else sb.from('section_people').upsert({ employee_id: e.id, section: s[0], allowed: v === 'on' }, { onConflict: 'employee_id,section' }).then(done);
  }
  window.EdenPerms = { show: show, SECTIONS: SECTIONS };
})();
