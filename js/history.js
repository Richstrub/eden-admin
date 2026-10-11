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
    noteAfter: 'note below items', pairPrice: 'pairing price', pair: 'pairing', active: 'active', access: 'permissions' };
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
  function reload() { H.loaded = false; render(); load(false).then(render); }

  function render() {
    var el = H.el; if (!el) return;
    el.innerHTML = '';
    var wrap = h('div', { cls: 'hi-in' }); el.appendChild(wrap);
    wrap.appendChild(h('div', { cls: 'hi-title' }, [h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Owner only' }), h('h1', { cls: 'sc-week', text: 'History' })]),
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
        var hay = fold([r.who, r.email, r.label, SECTIONS[r.tbl] || r.tbl, ACTS[r.action], JSON.stringify(r.changes || {})].join(' '));
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
          keys.length ? h('button', { type: 'button', cls: 'hi-more', 'aria-expanded': opened ? 'true' : 'false', text: opened ? 'Hide' : 'Details', on: { click: function () { H.open[r.id] = !opened; paint(); } } }) : h('span')
        ]);
        list.appendChild(row);
        if (opened) {
          var tb = h('div', { cls: 'hi-changes' });
          keys.forEach(function (k) {
            var c = ch[k];
            if (Array.isArray(c)) tb.appendChild(h('div', { cls: 'hi-ch' }, [h('span', { text: k }), h('em', { text: c.join(', ') || '(none)' })]));
            else tb.appendChild(h('div', { cls: 'hi-ch' }, [h('span', { text: FIELD[k] || k.replace(/_/g, ' ') }), h('s', { text: val(c && c.old) }), h('i', { text: '→' }), h('em', { text: val(c && c.new) })]));
          });
          list.appendChild(tb);
        }
      });
      if (H.more) foot.appendChild(h('button', { type: 'button', cls: 'ed-btn small', text: 'Load older', on: { click: function () { load(true).then(function () { render(); }); } } }));
      foot.appendChild(h('span', { cls: 'hi-count', text: rows.length + ' shown' }));
    }
    paint();
  }

  window.EdenHistory = {
    show: function (ctx) {
      H.ctx = ctx; H.el = ctx.el;
      if (!H.from) { var d = new Date(); d.setDate(d.getDate() - 30); H.from = iso(d); }
      reload();
    }
  };
})();
