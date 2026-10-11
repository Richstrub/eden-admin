/* Eden staff site: History. Everything added, changed or deleted on the staff site and staff page,
 * who did it and when, newest first. Owner only. The log is written by the database itself
 * (supabase/history.sql), so it can't be skipped or edited from the site. */
(function () {
  'use strict';
  var SECTIONS = {
    site_docs: 'Menu & website', employees: 'Employees', staff: 'Staff logins', schedule_weeks: 'Schedule', time_off: 'Time off',
    board_posts: 'Message board', inventory_items: 'Inventory items', inventory_counts: 'Inventory counts', recipes: 'Recipes',
    events: 'Calendar', todos: 'To-do'
  };
  var ACTS = { insert: 'Added', update: 'Changed', delete: 'Deleted' };
  var FIELD = { yield_qty: 'yield', yield_unit: 'yield unit', all_day: 'all day', count_date: 'date', start_date: 'from', end_date: 'to',
    start_time: 'from time', end_time: 'until time', decision_note: 'manager note', published_at: 'published', week_start: 'week',
    noteAfter: 'note below items', desc: 'description', qty: 'amount', src: 'producer', emp: 'employee', pairPrice: 'pairing price', pair: 'pairing', active: 'active', access: 'permissions' };
  var PAGE = 200;
  var H = { ctx: null, el: null, rows: [], loaded: false, missing: false, more: false, sec: '', who: '', q: '', from: '', to: '', open: {} };

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
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function isMissing(e) { return e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message || '')); }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function val(v) {
    if (v == null) return '—';
    if (typeof v === 'boolean') return v ? 'yes' : 'no';
    if (Array.isArray(v)) return v.length ? (typeof v[0] === 'object' ? v.length + ' item' + (v.length === 1 ? '' : 's') : v.join(', ')) : '(none)';
    if (typeof v === 'object') return '(details)';
    var s = String(v); return s === '' ? '(blank)' : s;
  }

  function load(append) {
    var q = H.ctx.sb.from('activity_log').select('*').order('at', { ascending: false });
    if (H.from) q = q.gte('at', H.from + 'T00:00:00');
    if (H.to) q = q.lte('at', H.to + 'T23:59:59.999');
    if (H.sec) q = q.eq('tbl', H.sec);
    var offset = append ? H.rows.length : 0;
    q = q.range ? q.range(offset, offset + PAGE - 1) : q.limit(PAGE);
    return q.then(function (r) {
      H.loaded = true;
      if (r.error) { H.missing = isMissing(r.error); if (!H.missing) H.ctx.status('Couldn’t load the history.', 'err'); return; }
      H.missing = false;
      var got = r.data || [];
      H.rows = append ? H.rows.concat(got) : got;
      H.more = got.length === PAGE;
    }, function () { H.loaded = true; });
  }
  function lookups() { // names for ids that appear inside records (employees, inventory items)
    if (H.names) return Promise.resolve();
    H.names = { emp: {}, inv: {} };
    var sb = H.ctx.sb;
    return Promise.all([
      sb.from('employees').select('id,name').then(function (r) { (r.data || []).forEach(function (e) { H.names.emp[e.id] = e.name; }); }, function () {}),
      sb.from('inventory_items').select('id,name,unit').then(function (r) { (r.data || []).forEach(function (e) { H.names.inv[e.id] = e; }); }, function () {})
    ]);
  }
  function reload() { H.loaded = false; render(); Promise.all([load(false), lookups()]).then(render); }

  function render() {
    var el = H.el; if (!el) return;
    el.innerHTML = '';
    var wrap = h('div', { cls: 'hi-in' }); el.appendChild(wrap);
    wrap.appendChild(h('div', { cls: 'hi-title' }, [H.ctx.embedded ? h('h2', { cls: 'an-h2', text: 'History' }) : h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Owner only' }), h('h1', { cls: 'sc-week', text: 'History' })]),
      h('p', { cls: 'hi-sub', text: 'Everything added, changed or deleted on the staff site and the staff page, who did it, and when. Quick saves of the same thing within 10 minutes are grouped into one line. Private notes are not recorded.' })]));
    if (H.missing) { wrap.appendChild(h('div', { cls: 'iv-setup' }, [h('p', { text: 'History isn’t switched on yet. In Supabase, open SQL Editor → New query, paste the contents of supabase/history.sql from the eden-admin repository, and click Run. From then on, every change is recorded here.' })])); return; }
    // filters
    var sec = h('select', { 'aria-label': 'Section' }, [h('option', { value: '', text: 'All sections' })].concat(Object.keys(SECTIONS).map(function (k) { return h('option', { value: k, text: SECTIONS[k] }); })));
    sec.value = H.sec; sec.addEventListener('change', function () { H.sec = sec.value; reload(); });
    var people = {}; H.rows.forEach(function (r) { if (r.who) people[r.who] = 1; });
    var who = h('select', { 'aria-label': 'Person' }, [h('option', { value: '', text: 'Everyone' })].concat(Object.keys(people).sort().map(function (p) { return h('option', { value: p, text: p }); })));
    who.value = H.who; who.addEventListener('change', function () { H.who = who.value; paint(); });
    var from = h('input', { type: 'date', value: H.from, 'aria-label': 'From date' }), to = h('input', { type: 'date', value: H.to, 'aria-label': 'To date' });
    from.addEventListener('change', function () { H.from = from.value; reload(); }); to.addEventListener('change', function () { H.to = to.value; reload(); });
    var q = h('input', { type: 'search', placeholder: 'Search, e.g. salmon, Ava, schedule', value: H.q, 'aria-label': 'Search' });
    q.addEventListener('input', function () { H.q = q.value; paint(); });
    wrap.appendChild(h('div', { cls: 'hi-filters' }, [
      h('label', { cls: 'sc-f' }, [h('span', { text: 'Section' }), sec]), h('label', { cls: 'sc-f' }, [h('span', { text: 'Person' }), who]),
      h('label', { cls: 'sc-f' }, [h('span', { text: 'From' }), from]), h('label', { cls: 'sc-f' }, [h('span', { text: 'To' }), to]),
      h('label', { cls: 'sc-f hi-q' }, [h('span', { text: 'Search' }), q]),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Refresh', on: { click: reload } })
    ]));
    var list = h('div', { cls: 'hi-list' }); wrap.appendChild(list);
    var foot = h('div', { cls: 'hi-foot' }); wrap.appendChild(foot);
    function paint() {
      list.innerHTML = ''; foot.innerHTML = '';
      if (!H.loaded) { list.appendChild(h('p', { cls: 'sc-empty', text: 'Loading…' })); return; }
      var words = fold(H.q).split(/\s+/).filter(Boolean);
      var rows = H.rows.filter(function (r) {
        if (H.who && r.who !== H.who) return false;
        if (!words.length) return true;
        var hay = fold([r.who, r.email, r.label, SECTIONS[r.tbl] || r.tbl, ACTS[r.action], JSON.stringify(r.changes || {}), JSON.stringify(r.new_row || r.old_row || {})].join(' '));
        return words.every(function (w) { return hay.indexOf(w) !== -1; });
      });
      if (!rows.length) list.appendChild(h('p', { cls: 'sc-empty', text: H.rows.length ? 'Nothing matches those filters.' : 'Nothing recorded yet. Changes appear here as soon as they’re made.' }));
      var lastDay = null;
      rows.forEach(function (r) {
        var d = new Date(r.at), day = iso(d);
        if (day !== lastDay) { lastDay = day; list.appendChild(h('div', { cls: 'hi-day', text: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) })); }
        var ch = r.changes || {}, keys = Object.keys(ch), opened = !!H.open[r.id];
        var row = h('div', { cls: 'hi-row' + (opened ? ' open' : '') }, [
          h('span', { cls: 'hi-time', text: d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }),
          h('span', { cls: 'hi-act hi-' + r.action, text: ACTS[r.action] || r.action }),
          h('div', { cls: 'hi-what' }, [
            h('b', { text: r.label || '(untitled)' }),
            h('span', { text: (SECTIONS[r.tbl] || r.tbl) + (keys.length ? ' · ' + keys.slice(0, 4).map(function (k) { return FIELD[k] || k.replace(/_/g, ' '); }).join(', ') + (keys.length > 4 ? '…' : '') : '') + (r.edits > 1 ? ' · ' + r.edits + ' saves' : '') })
          ]),
          h('div', { cls: 'hi-who' }, [h('b', { text: r.who || 'Unknown' }), r.email && r.email !== r.who ? h('span', { text: r.email }) : null]),
          (keys.length || r.old_row || r.new_row) ? h('button', { type: 'button', cls: 'hi-more', 'aria-expanded': opened ? 'true' : 'false', text: opened ? 'Hide' : 'Details', on: { click: function () { H.open[r.id] = !opened; paint(); } } }) : h('span')
        ]);
        list.appendChild(row);
        if (opened) list.appendChild(details(r));
      });
      if (H.more) foot.appendChild(h('button', { type: 'button', cls: 'ed-btn small', text: 'Load older', on: { click: function () { load(true).then(function () { render(); }); } } }));
      foot.appendChild(h('span', { cls: 'hi-count', text: rows.length + ' shown' }));
    }
    paint();
  }

  /* ---------- details: exactly what changed ---------- */
  var DAYN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var SKIP = { updated_at: 1, created_at: 1, updated_by: 1, id: 1, sort: 1, user_id: 1, sent: 1 };
  var ENDS = { cut1: '1st cut', cut2: '2nd cut', close: 'close' };
  function t12(t) { if (ENDS[t]) return ENDS[t]; var p = String(t || '').split(':'), H2 = +p[0], M = +p[1] || 0; if (!t || isNaN(H2)) return ''; return (H2 % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H2 >= 12 ? 'p' : 'a'); }
  function empName(id) { return (H.names && H.names.emp[id]) || 'Employee'; }
  function label(k) { return FIELD[k] || k.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); }
  function str(v) { return v == null || v === '' ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); }
  // word-level diff for longer text: removed words struck through, added words highlighted
  function textDiff(a, b) {
    var A = String(a || '').split(/(\s+)/), B = String(b || '').split(/(\s+)/);
    if (A.length * B.length > 250000) return [h('s', { text: a }), ' → ', h('ins', { text: b })];
    var m = A.length, n = B.length, L = [];
    for (var i = 0; i <= m; i++) { L[i] = new Array(n + 1).fill(0); }
    for (i = m - 1; i >= 0; i--) for (var j = n - 1; j >= 0; j--) L[i][j] = A[i] === B[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    var out = []; i = 0; j = 0;
    while (i < m && j < n) {
      if (A[i] === B[j]) { out.push(A[i]); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) { out.push(h('del', { text: A[i] })); i++; }
      else { out.push(h('ins', { text: B[j] })); j++; }
    }
    while (i < m) out.push(h('del', { text: A[i++] }));
    while (j < n) out.push(h('ins', { text: B[j++] }));
    return out;
  }
  function line(lbl, kids, cls) { return h('div', { cls: 'hi-ch' + (cls ? ' ' + cls : '') }, [h('span', { text: lbl }), h('div', { cls: 'hi-v' }, kids)]); }
  function change(lbl, a, b) {
    var sa = str(a), sb2 = str(b);
    if (typeof a === 'boolean' || typeof b === 'boolean') return line(lbl, [h('div', { cls: 'hi-inline' }, [h('s', { text: val(a) }), h('i', { text: '→' }), h('em', { text: val(b) })])]);
    if ((sa.length > 40 || sb2.length > 40) && sa && sb2) return line(lbl, [h('p', { cls: 'hi-diff' }, textDiff(sa, sb2))]);
    return line(lbl, [h('div', { cls: 'hi-inline' }, [h('s', { text: sa || '(blank)' }), h('i', { text: '→' }), h('em', { text: sb2 || '(blank)' })])]);
  }
  function fieldDiff(o, n, keys, fmt) {
    var out = [];
    (keys || Object.keys(Object.assign({}, o || {}, n || {}))).forEach(function (k) {
      if (SKIP[k]) return;
      var a = o ? o[k] : undefined, b = n ? n[k] : undefined;
      if (JSON.stringify(a) === JSON.stringify(b)) return;
      if ((a && typeof a === 'object') || (b && typeof b === 'object')) return; // handled by section-specific code
      out.push(change(label(k), fmt ? fmt(k, a) : a, fmt ? fmt(k, b) : b));
    });
    return out;
  }
  function record(x, keys, fmt) { // the whole record, for adds and deletes
    return (keys || Object.keys(x || {})).filter(function (k) { return !SKIP[k] && x[k] != null && x[k] !== '' && typeof x[k] !== 'object'; })
      .map(function (k) { return line(label(k), [h('em', { text: str(fmt ? fmt(k, x[k]) : x[k]) })]); });
  }
  // lists matched by a key (dishes by name, shifts by id, ingredients by item)
  function listDiff(oldL, newL, key, title, describe, fields, fmt) {
    var out = [], O = {}, N = {};
    (oldL || []).forEach(function (x, i) { O[key(x, i)] = x; }); (newL || []).forEach(function (x, i) { N[key(x, i)] = x; });
    Object.keys(N).forEach(function (k) {
      if (!(k in O)) out.push(line('Added ' + title, [h('em', { text: describe(N[k]) })], 'add'));
      else if (JSON.stringify(O[k]) !== JSON.stringify(N[k])) {
        var sub = fieldDiff(O[k], N[k], fields, fmt);
        out.push(h('div', { cls: 'hi-ch hi-grp' }, [h('span', { text: 'Changed ' + title }), h('div', { cls: 'hi-v' }, [h('b', { text: describe(N[k], true) })].concat(sub.length ? sub : [h('em', { text: '(order or formatting)' })]))]));
      }
    });
    Object.keys(O).forEach(function (k) { if (!(k in N)) out.push(line('Removed ' + title, [h('s', { text: describe(O[k]) })], 'del')); });
    var oi = (oldL || []).map(function (x, i) { return key(x, i); }).filter(function (k) { return k in N; }), ni = (newL || []).map(function (x, i) { return key(x, i); }).filter(function (k) { return k in O; });
    if (!out.length && JSON.stringify(oi) !== JSON.stringify(ni)) out.push(line('Order', [h('em', { text: 'Rearranged' })]));
    return out;
  }
  function dish(x, short) { return (x.name || '(unnamed)') + (short ? '' : (x.price ? ' · ' + x.price : '') + (x.desc ? ' · ' + x.desc : '')); }
  function shift(x, short) { return empName(x.emp) + ' · ' + DAYN[x.day] + ' ' + t12(x.start) + '–' + t12(x.end) + (short ? '' : (x.role ? ' · ' + x.role : '') + (x.note ? ' (' + x.note + ')' : '')); }
  function ingr(x) { return x.head ? '— ' + x.item + ' —' : [x.qty, x.unit, x.item].filter(function (v) { return v != null && v !== ''; }).join(' ') + (x.note ? ', ' + x.note : ''); }
  function shiftFmt(k, v) { return k === 'start' || k === 'end' ? t12(v) : k === 'day' ? DAYN[v] : k === 'emp' ? empName(v) : v; }
  function details(r) {
    var o = r.old_row, n = r.new_row, box = h('div', { cls: 'hi-changes' }), out = [];
    if (!o && !n) { // logged before full copies were kept
      Object.keys(r.changes || {}).forEach(function (k) {
        var c = r.changes[k];
        out.push(Array.isArray(c) ? line(k, [h('em', { text: c.join(', ') || '(none)' })]) : change(label(k), c && c.old, c && c.new));
      });
      if (!out.length) out.push(h('p', { cls: 'hi-none', text: 'No further detail was recorded for this entry.' }));
      out.forEach(function (x) { box.appendChild(x); }); return box;
    }
    var t = r.tbl, x = n || o;
    if (r.action !== 'update') {
      box.appendChild(h('p', { cls: 'hi-cap', text: r.action === 'insert' ? 'What was added:' : 'What was deleted (kept here in case you need it):' }));
      if (t === 'site_docs' && x.data && x.data.items) { out = out.concat(record({ title: x.data.title, note: x.data.note })); x.data.items.forEach(function (it) { out.push(line('Dish', [h('em', { text: dish(it) })])); }); }
      else if (t === 'schedule_weeks') (x.shifts || []).forEach(function (sft) { out.push(line('Shift', [h('em', { text: shift(sft) })])); });
      else if (t === 'recipes') { out = out.concat(record(x, ['name', 'category', 'yield_qty', 'yield_unit', 'time', 'allergens'])); (x.ingredients || []).forEach(function (i) { out.push(line('Ingredient', [h('em', { text: ingr(i) })])); }); if (x.method) out.push(line('Method', [h('p', { cls: 'hi-pre', text: x.method })])); }
      else if (t === 'time_off') out = out.concat(record(Object.assign({}, x, { emp: empName(x.emp) })));
      else if (t === 'inventory_counts') Object.keys(x.counts || {}).forEach(function (id) { var it = H.names && H.names.inv[id]; out.push(line(it ? it.name : 'Item', [h('em', { text: x.counts[id] + (it && it.unit ? ' ' + it.unit : '') })])); });
      else out = out.concat(record(x));
    } else if (t === 'site_docs') {
      var od = o.data || {}, nd = n.data || {};
      out = out.concat(fieldDiff(od, nd, ['title', 'note', 'noteAfter', 'allergy', 'eyebrow', 'date', 'intro', 'menuHeading', 'price', 'tier1', 'tier2', 'ctaLabel', 'ctaUrl']));
      if (od.items || nd.items) out = out.concat(listDiff(od.items, nd.items, function (d, i) { return d.name || '#' + i; }, 'dish', dish, ['name', 'price', 'desc', 'src', 'pair', 'pairPrice', 'bottle', 'glass', 'country', 'appellation', 'grape', 'hidden']));
      if (od.tabs || nd.tabs) out = out.concat(listDiff(od.tabs, nd.tabs, function (tb) { return tb.id; }, 'tab', function (tb) { return tb.label || 'Untitled tab'; }, ['label']));
      if (od.courses || nd.courses) out = out.concat(listDiff(od.courses, nd.courses, function (c, i) { return 'Course ' + (i + 1); }, 'course', function (c) { return c.name || 'Course'; }, ['name', 'desc', 'w1', 'w2']));
    } else if (t === 'schedule_weeks') {
      if (JSON.stringify(o.shifts) !== JSON.stringify(n.shifts)) out = out.concat(listDiff(o.shifts, n.shifts, function (sft) { return sft.id; }, 'shift', shift, ['emp', 'day', 'start', 'end', 'role', 'note'], shiftFmt));
      if (n.status === 'published' && JSON.stringify(o.published) !== JSON.stringify(n.published)) out.push(line('Published', [h('em', { text: 'Sent to the staff page (' + (n.published || []).length + ' shifts)' })], 'add'));
      else if (o.status !== n.status) out.push(change('status', o.status, n.status));
    } else if (t === 'inventory_counts') {
      var oc = o.counts || {}, nc = n.counts || {};
      Object.keys(Object.assign({}, oc, nc)).forEach(function (id) {
        if (oc[id] === nc[id]) return;
        var it = H.names && H.names.inv[id], nm = it ? it.name : 'Item', u = it && it.unit ? ' ' + it.unit : '';
        out.push(change(nm, oc[id] == null ? '(not counted)' : oc[id] + u, nc[id] == null ? '(cleared)' : nc[id] + u));
      });
    } else if (t === 'recipes') {
      out = out.concat(fieldDiff(o, n, ['name', 'category', 'yield_qty', 'yield_unit', 'time', 'allergens', 'notes']));
      if (JSON.stringify(o.ingredients) !== JSON.stringify(n.ingredients)) out = out.concat(listDiff(o.ingredients, n.ingredients, function (i, k) { return i.head ? 'h:' + i.item : (i.item || '#' + k).toLowerCase(); }, 'ingredient', ingr, ['qty', 'unit', 'item', 'note']));
      if ((o.method || '') !== (n.method || '')) {
        var os = String(o.method || '').split('\n').filter(Boolean), ns = String(n.method || '').split('\n').filter(Boolean);
        ns.forEach(function (st2, i) { if (os.indexOf(st2) === -1) out.push(line('Step ' + (i + 1), [h('ins', { text: st2 })], 'add')); });
        os.forEach(function (st2) { if (ns.indexOf(st2) === -1) out.push(line('Removed step', [h('s', { text: st2 })], 'del')); });
        if (os.length === ns.length && os.every(function (v) { return ns.indexOf(v) !== -1; })) out.push(line('Method', [h('em', { text: 'Steps reordered' })]));
      }
    } else if (t === 'time_off') {
      out = out.concat(fieldDiff(o, n, null, function (k, v) { return k === 'emp' ? empName(v) : k === 'start_time' || k === 'end_time' ? t12(v) : v; }));
    } else if (t === 'events') {
      out = out.concat(fieldDiff(o, n, null, function (k, v) { return k === 'start' || k === 'end' ? t12(v) : v; }));
    } else {
      out = out.concat(fieldDiff(o, n));
    }
    if (!out.length) out.push(h('p', { cls: 'hi-none', text: 'Saved without visible changes (formatting or order only).' }));
    if (r.edits > 1) box.appendChild(h('p', { cls: 'hi-cap', text: 'Combined result of ' + r.edits + ' saves, from before the first to after the last:' }));
    out.forEach(function (el) { box.appendChild(el); });
    return box;
  }

  window.EdenHistory = {
    show: function (ctx) {
      H.ctx = ctx; H.el = ctx.el;
      if (!H.from) { var d = new Date(); d.setDate(d.getDate() - 30); H.from = iso(d); }
      reload();
    }
  };
})();
