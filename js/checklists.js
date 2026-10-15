/* Eden: shift checklists (Front of house opening, first cut and closing; Back of house closing).
 * Ticked off on the Hub, a fresh copy each service day (a day runs until 4 am). The Owner and managers change the
 * items on the staff site (Service > Checklists), where they also see today's progress and who ticked what.
 * Data: supabase/hub.sql (checklists, checklist_days; checklist_get / checklist_tick / checklist_save).
 * Modes: 'hub' (one list, big rows to tap) and 'admin' (all lists: today's progress).
 * EdenChecklists.edit(ctx): the Owner and managers' editor (Service > Edit checklists, #checklists/edit).
 */
(function () {
  'use strict';
  var C = { ctx: null, el: null, data: null, all: null, pick: null, editing: false, missing: false, timer: null, busy: false };
  var NAME_KEY = 'eden-hub-name', NAME_MS = 10 * 60 * 1000;

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function gone(e) { return !!(e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|does not exist|schema cache/i.test(e.message || ''))); }
  function t(ts) { return ts ? new Date(ts).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : ''; }
  function longDay(d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) : ''; }
  function hubName() { try { var x = JSON.parse(localStorage.getItem(NAME_KEY) || 'null'); return x && Date.now() - x.at < NAME_MS ? x.name : ''; } catch (e) { return ''; } }
  function setHubName(n) { try { localStorage.setItem(NAME_KEY, JSON.stringify({ name: n, at: Date.now() })); } catch (e) {} }
  function initials(n) { return String(n || '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); }
  function say(t2, k) { var m = C.el && C.el.querySelector('.ck-msg'); if (m) { m.textContent = t2 || ''; m.className = 'ck-msg' + (k ? ' ' + k : ''); } }
  function isHub() { return C.ctx.mode === 'hub'; }

  function load() {
    var sb = C.ctx.sb, jobs = [];
    if (!isHub()) jobs.push(sb.rpc('checklist_get', { p_list: null }).then(function (r) {
      if (r.error) { C.missing = gone(r.error); return; }
      if (r.data && !r.data.error) { C.all = r.data; if (!C.pick && C.all.lists && C.all.lists.length) C.pick = C.all.lists[0].id; }
    }));
    return Promise.all(jobs).then(function () {
      if (C.missing || !C.pick) { render(); return; }
      return sb.rpc('checklist_get', { p_list: C.pick }).then(function (r) {
        if (r.error) { C.missing = gone(r.error); render(); return; }
        var before = JSON.stringify(C.data); C.data = r.data;
        if (JSON.stringify(C.data) !== before) render();
      });
    }, function () { say('Couldn’t load the checklist. Check your connection.', 'err'); });
  }
  function tick(item, on) {
    var by = '';
    if (isHub()) { var b = C.el.querySelector('.ck-by'); by = b ? b.value.trim() : ''; if (by) setHubName(by); }
    // show it straight away, then save
    var done = C.data.done || (C.data.done = {});
    if (on) done[item] = { by: by || C.data.me || '', at: new Date().toISOString() }; else delete done[item];
    render();
    C.ctx.sb.rpc('checklist_tick', { p_list: C.data.id, p_item: item, p_on: on, p_by: by }).then(function (r) {
      if (r.error || !r.data || r.data.error) { say('Couldn’t save that. Check your connection.', 'err'); load(); return; }
      C.data = r.data; render(); refreshAll();
    }, function () { say('Couldn’t save that. Check your connection.', 'err'); });
  }
  function refreshAll() {
    if (isHub()) return;
    C.ctx.sb.rpc('checklist_get', { p_list: null }).then(function (r) { if (!r.error && r.data && !r.data.error) { C.all = r.data; paintTabs(); } });
  }

  function render() {
    var el = C.el; if (!el) return;
    var draftBy = (el.querySelector('.ck-by') || {}).value;
    clear(el);
    var wrap = h('div', { cls: 'ck' + (isHub() ? ' ck-hub' : '') }); el.appendChild(wrap);
    if (C.missing) { wrap.appendChild(h('p', { cls: 'od-setup', text: 'Checklists aren’t set up yet: run the latest supabase/hub.sql in Supabase.' })); return; }
    if (!isHub()) {
      wrap.appendChild(h('header', { cls: 'od-top' }, [h('p', { cls: 'sc-eyebrow', text: 'Service' }), h('h1', { cls: 'sc-week', text: 'Checklists' }),
        h('p', { cls: 'od-help', text: 'Staff tick these off on the Hub (the screen in the restaurant). Each one starts fresh every day; a day runs until 4 am, so closing after midnight counts for that night. The Owner and managers change the items in Edit checklists.' })]));
      wrap.appendChild(h('div', { cls: 'ck-tabs', role: 'tablist' }));
      paintTabs(wrap);
    }
    var d = C.data;
    if (!d) { wrap.appendChild(h('p', { cls: 'od-empty', text: 'Loading…' })); return; }
    if (d.error) { wrap.appendChild(h('p', { cls: 'od-empty', text: d.error === 'not_allowed' ? 'This login can’t use the checklists.' : 'That checklist doesn’t exist.' })); return; }
    var items = d.items || [], real = items.filter(function (i) { return !i.head; }), done = d.done || {};
    var n = real.filter(function (i) { return done[i.id]; }).length, pct = real.length ? Math.round(n / real.length * 100) : 0;
    wrap.appendChild(h('div', { cls: 'ck-head' }, [
      h('div', null, [isHub() ? h('p', { cls: 'sc-eyebrow', text: 'Checklist' }) : null, h('h2', { cls: 'ck-title', text: d.title }), h('p', { cls: 'ck-day', text: 'For ' + longDay(d.day) })]),
      !isHub() && d.can_edit ? h('a', { cls: 'ed-btn small', href: '#checklists/edit', text: 'Edit checklists', on: { click: function () { E.pick = C.pick; } } }) : null
    ]));
    wrap.appendChild(h('div', { cls: 'ck-prog' + (n === real.length && real.length ? ' full' : '') }, [h('i', { style: 'width:' + pct + '%' }), h('span', { text: n + ' of ' + real.length + ' done' })]));
    if (isHub()) wrap.appendChild(h('label', { cls: 'ck-who' }, [h('span', { text: 'Your initials' }), h('input', { type: 'text', cls: 'ck-by', maxlength: '20', autocomplete: 'off', placeholder: 'e.g. MS', value: draftBy != null ? draftBy : hubName() })]));
    wrap.appendChild(h('p', { cls: 'ck-msg', role: 'status' }));
    if (C.editing) { wrap.appendChild(editor(d)); return; }
    var ul = h('ul', { cls: 'ck-list' });
    items.forEach(function (it) {
      if (it.head) { ul.appendChild(h('li', { cls: 'ck-hd', text: it.text })); return; }
      var x = done[it.id];
      ul.appendChild(h('li', null, h('button', { type: 'button', cls: 'ck-item' + (x ? ' done' : ''), role: 'checkbox', 'aria-checked': x ? 'true' : 'false',
        on: { click: function () { tick(it.id, !(C.data.done || {})[it.id]); } } }, [
        h('span', { cls: 'ck-box', 'aria-hidden': 'true' }),
        h('span', { cls: 'ck-text', text: it.text }),
        x ? h('small', { cls: 'ck-by-at', text: [x.by ? (isHub() && x.by.length > 3 ? initials(x.by) : x.by) : '', t(x.at)].filter(Boolean).join(' · ') }) : null
      ])));
    });
    wrap.appendChild(ul);
    if (real.length && n === real.length) wrap.appendChild(h('p', { cls: 'ck-alldone', text: 'All done. Nice work.' }));
  }
  function paintTabs(wrap) {
    var box = (wrap || C.el).querySelector('.ck-tabs'); if (!box || !C.all) return;
    clear(box);
    (C.all.lists || []).forEach(function (l) {
      box.appendChild(h('button', { type: 'button', role: 'tab', 'aria-selected': l.id === C.pick ? 'true' : 'false', cls: 'ck-tab' + (l.total && l.done === l.total ? ' full' : ''),
        on: { click: function () { if (C.pick === l.id) return; C.pick = l.id; C.data = null; C.editing = false; render(); load(); } } },
        [h('b', { text: l.title }), h('span', { text: l.done + ' / ' + l.total + ' today' })]));
    });
  }
  function editor(d) {
    var title = h('input', { type: 'text', cls: 'ck-etitle', value: d.title, maxlength: '80', 'aria-label': 'Checklist name' });
    var ta = h('textarea', { cls: 'ck-etext', rows: '18', 'aria-label': 'Items, one per line' });
    ta.value = (d.items || []).map(function (i) { return (i.head ? '# ' : '') + i.text; }).join('\n');
    var save = function () {
      var old = {}; (d.items || []).forEach(function (i) { old[(i.head ? '#' : '') + i.text.trim().toLowerCase()] = i.id; });
      var used = {}, next = 1; (d.items || []).forEach(function (i) { var m = /^i(\d+)$/.exec(i.id); if (m) next = Math.max(next, +m[1] + 1); });
      var items = ta.value.split('\n').map(function (l) { return l.trim(); }).filter(Boolean).map(function (l) {
        var head = /^#/.test(l), text = l.replace(/^#\s*/, '').trim(), k = (head ? '#' : '') + text.toLowerCase();
        var id = old[k] && !used[old[k]] ? old[k] : 'i' + (next++); used[id] = 1;   // same wording keeps its id (and today's tick)
        return { id: id, text: text, head: head };
      }).filter(function (i) { return i.text; });
      C.ctx.sb.rpc('checklist_save', { p_list: d.id, p_title: title.value, p_items: items }).then(function (r) {
        if (r.error || !r.data || r.data.error) { say(r.data && r.data.error === 'not_allowed' ? 'Only the Owner and managers can change checklists.' : 'Couldn’t save. Check your connection.', 'err'); return; }
        C.data = r.data; C.editing = false; render(); refreshAll(); say('Saved. The Hub shows the new list right away.', 'ok');
      }, function () { say('Couldn’t save. Check your connection.', 'err'); });
    };
    return h('div', { cls: 'ck-edit' }, [
      h('label', { cls: 'ck-elbl' }, [h('span', { text: 'Name' }), title]),
      h('label', { cls: 'ck-elbl' }, [h('span', { text: 'Items: one per line. Start a line with # to make it a heading.' }), ta]),
      h('div', { cls: 'ck-ebtns' }, [h('button', { type: 'button', cls: 'ed-btn', text: 'Save', on: { click: save } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { C.editing = false; render(); } } })])
    ]);
  }

  /* ---------- the editor: Service > Edit checklists ---------- */
  var E = { ctx: null, el: null, all: null, pick: null, list: null, rows: null, dirty: false, seq: 0 };
  function eSay(t2, k) { var m = E.el && E.el.querySelector('.ck-msg'); if (m) { m.textContent = t2 || ''; m.className = 'ck-msg' + (k ? ' ' + k : ''); } }
  function eLoad() {
    var sb = E.ctx.sb;
    return sb.rpc('checklist_get', { p_list: null }).then(function (r) {
      if (r.error) { E.missing = gone(r.error); ePaint(); return; }
      E.all = (r.data && r.data.lists) || [];
      if (!E.pick || !E.all.some(function (l) { return l.id === E.pick; })) E.pick = E.all.length ? E.all[0].id : null;
      return eOpen(E.pick);
    }, function () { E.err = true; ePaint(); });
  }
  function eOpen(id) {
    E.pick = id; E.list = null; E.rows = null; E.dirty = false; ePaint();
    if (!id) return;
    return E.ctx.sb.rpc('checklist_get', { p_list: id }).then(function (r) {
      if (r.error || !r.data || r.data.error) { E.err = true; ePaint(); return; }
      E.list = r.data; E.title = r.data.title;
      E.rows = (r.data.items || []).map(function (i) { return { id: i.id, text: i.text, head: !!i.head, key: ++E.seq }; });
      ePaint();
    });
  }
  function eDirty() { E.dirty = true; var b = E.el.querySelector('.cke-save'); if (b) b.disabled = false; var d = E.el.querySelector('.cke-discard'); if (d) d.disabled = false; eSay('Unsaved changes'); }
  function ePaint(focusKey) {
    var el = E.el; if (!el) return; clear(el);
    var wrap = h('div', { cls: 'ck cke' }); el.appendChild(wrap);
    wrap.appendChild(h('header', { cls: 'od-top' }, [h('p', { cls: 'sc-eyebrow', text: 'Service' }), h('h1', { cls: 'sc-week', text: 'Edit checklists' }),
      h('p', { cls: 'od-help', text: 'Change the opening and closing checklists the staff tick off on the Hub. Saved changes show on the Hub right away. Items you don’t change keep today’s ticks.' }),
      h('a', { cls: 'cke-back', href: '#checklists', text: 'See today’s progress →' })]));
    if (E.missing) { wrap.appendChild(h('p', { cls: 'od-setup', text: 'Checklists aren’t set up yet: run the latest supabase/hub.sql in Supabase.' })); return; }
    if (!E.all) { wrap.appendChild(h('p', { cls: 'od-empty', text: E.err ? 'Couldn’t load the checklists. Check your connection.' : 'Loading…' })); return; }
    var tabs = h('div', { cls: 'ck-tabs', role: 'tablist', 'aria-label': 'Checklists' });
    E.all.forEach(function (l) {
      tabs.appendChild(h('button', { type: 'button', role: 'tab', cls: 'ck-tab', 'aria-selected': l.id === E.pick ? 'true' : 'false',
        on: { click: function () { if (l.id === E.pick) return; if (E.dirty && !confirm('Discard your unsaved changes to ' + (E.title || 'this list') + '?')) return; eOpen(l.id); } } },
        [h('b', { text: l.title }), h('span', { text: l.total + (l.total === 1 ? ' item' : ' items') })]));
    });
    wrap.appendChild(tabs);
    if (!E.rows) { wrap.appendChild(h('p', { cls: 'od-empty', text: 'Loading…' })); return; }
    if (E.list && E.list.can_edit === false) { wrap.appendChild(h('p', { cls: 'od-empty', text: 'Only the Owner and managers can change checklists.' })); return; }
    var card = h('section', { cls: 'cke-card' }); wrap.appendChild(card);
    var title = h('input', { type: 'text', cls: 'ck-etitle', maxlength: '80', value: E.title || '', 'aria-label': 'Checklist name', on: { input: function () { E.title = this.value; eDirty(); } } });
    card.appendChild(h('label', { cls: 'ck-elbl' }, [h('span', { text: 'Checklist name' }), title]));
    var list = h('ol', { cls: 'cke-rows' }); card.appendChild(list);
    var nItems = 0;
    E.rows.forEach(function (row, i) {
      if (!row.head) nItems++;
      var inp = h('input', { type: 'text', cls: 'cke-text', maxlength: '200', value: row.text, placeholder: row.head ? 'Heading, e.g. Dining room' : 'What needs doing', 'aria-label': (row.head ? 'Heading ' : 'Item ') + (i + 1), 'data-key': row.key,
        on: { input: function () { row.text = this.value; eDirty(); }, keydown: function (e) { if (e.key === 'Enter') { e.preventDefault(); var nr = { id: null, text: '', head: false, key: ++E.seq }; E.rows.splice(i + 1, 0, nr); eDirty(); ePaint(nr.key); } } } });
      function move(d) { var j = i + d; if (j < 0 || j >= E.rows.length) return; E.rows.splice(i, 1); E.rows.splice(j, 0, row); eDirty(); ePaint(); var b = E.el.querySelector('[data-key="' + row.key + '"]'); if (b) b.closest('li').querySelector(d < 0 ? '.cke-up' : '.cke-down').focus(); }
      list.appendChild(h('li', { cls: 'cke-row' + (row.head ? ' head' : '') }, [
        h('span', { cls: 'cke-n', text: row.head ? '' : String(nItems) }),
        inp,
        h('label', { cls: 'cke-hd', title: 'Show this line as a heading (not something to tick off)' }, [h('input', { type: 'checkbox', checked: row.head, on: { change: function () { row.head = this.checked; eDirty(); ePaint(); } } }), h('span', { text: 'Heading' })]),
        h('button', { type: 'button', cls: 'cke-ic cke-up', 'aria-label': 'Move up', title: 'Move up', disabled: i === 0, text: '↑', on: { click: function () { move(-1); } } }),
        h('button', { type: 'button', cls: 'cke-ic cke-down', 'aria-label': 'Move down', title: 'Move down', disabled: i === E.rows.length - 1, text: '↓', on: { click: function () { move(1); } } }),
        h('button', { type: 'button', cls: 'cke-ic cke-del', 'aria-label': 'Delete', title: 'Delete', text: '✕', on: { click: function () { E.rows.splice(i, 1); eDirty(); ePaint(); } } })]));
    });
    if (!E.rows.length) list.appendChild(h('li', { cls: 'od-empty', text: 'No items yet.' }));
    function add(head) { var nr = { id: null, text: '', head: head, key: ++E.seq }; E.rows.push(nr); eDirty(); ePaint(nr.key); }
    card.appendChild(h('div', { cls: 'cke-adds' }, [
      h('button', { type: 'button', cls: 'eo-add', text: '+ Add item', on: { click: function () { add(false); } } }),
      h('button', { type: 'button', cls: 'eo-add', text: '+ Add heading', on: { click: function () { add(true); } } })]));
    card.appendChild(h('div', { cls: 'ck-ebtns' }, [
      h('button', { type: 'button', cls: 'ed-btn cke-save', text: 'Save changes', disabled: !E.dirty, on: { click: eSave } }),
      h('button', { type: 'button', cls: 'ed-btn small cke-discard', text: 'Discard changes', disabled: !E.dirty, on: { click: function () { if (confirm('Discard your changes?')) eOpen(E.pick); } } }),
      h('p', { cls: 'ck-msg', role: 'status', text: E.dirty ? 'Unsaved changes' : '' })]));
    if (focusKey) { var f = E.el.querySelector('[data-key="' + focusKey + '"]'); if (f) f.focus(); }
  }
  function eSave() {
    var used = {}, next = 1;
    E.rows.forEach(function (r) { var m = /^i(\d+)$/.exec(r.id || ''); if (m) next = Math.max(next, +m[1] + 1); });
    var items = E.rows.map(function (r) { return { id: r.id, text: String(r.text || '').trim(), head: !!r.head }; }).filter(function (r) { return r.text; })
      .map(function (r) { var id = r.id && !used[r.id] ? r.id : 'i' + (next++); used[id] = 1; return { id: id, text: r.text, head: r.head }; });
    if (!String(E.title || '').trim()) { eSay('Give the checklist a name.', 'err'); return; }
    if (!items.some(function (i) { return !i.head; })) { eSay('Add at least one item to tick off.', 'err'); return; }
    var btn = E.el.querySelector('.cke-save'); if (btn) btn.disabled = true; eSay('Saving…');
    E.ctx.sb.rpc('checklist_save', { p_list: E.pick, p_title: String(E.title).trim(), p_items: items }).then(function (r) {
      if (r.error || !r.data || r.data.error) { if (btn) btn.disabled = false; eSay(r.data && r.data.error === 'not_allowed' ? 'Only the Owner and managers can change checklists.' : 'Couldn’t save. Check your connection.', 'err'); return; }
      E.dirty = false; E.list = r.data; E.title = r.data.title;
      E.rows = (r.data.items || []).map(function (i) { return { id: i.id, text: i.text, head: !!i.head, key: ++E.seq }; });
      E.all.forEach(function (l) { if (l.id === E.pick) { l.title = r.data.title; l.total = (r.data.items || []).filter(function (i) { return !i.head; }).length; } });
      ePaint(); eSay('Saved. The Hub shows the new list right away.', 'ok');
      if (E.ctx.status) E.ctx.status('Checklist saved.', 'ok');
    }, function () { if (btn) btn.disabled = false; eSay('Couldn’t save. Check your connection.', 'err'); });
  }
  window.addEventListener('beforeunload', function (e) { if (E.dirty && E.el && E.el.offsetParent !== null) { e.preventDefault(); e.returnValue = ''; } });

  window.EdenChecklists = {
    edit: function (ctx) { clearInterval(C.timer); E.ctx = ctx; E.el = ctx.el; E.all = null; E.err = false; E.missing = false; ePaint(); eLoad(); },
    dirty: function () { return !!(E.dirty && E.el && E.el.offsetParent !== null); },
    show: function (ctx) {
      C.ctx = ctx; C.el = ctx.el; C.editing = false;
      if (ctx.list) { C.pick = ctx.list; C.data = null; }
      render(); load();
      clearInterval(C.timer);
      C.timer = setInterval(function () {
        if (!C.el || document.hidden || C.el.offsetParent === null || C.editing) return;
        var a = document.activeElement; if (a && C.el.contains(a) && /INPUT|TEXTAREA/.test(a.tagName)) return;
        load(); refreshAll();
      }, 10000);
    }
  };
})();
