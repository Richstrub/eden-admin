/* Eden: the order list. Anyone on the staff (and the Hub) adds what needs ordering; it's marked received on the Hub
 * (or by the Owner and managers), and only the Owner and managers can delete a line. Data: supabase/hub.sql
 * (order_items, read and changed through order_list / order_add / order_receive / order_delete).
 * Used on the Hub's Ordering pop-up (mode 'hub'), the staff page's Ordering tab ('staff') and the staff site ('admin').
 */
(function () {
  'use strict';
  var O = { ctx: null, el: null, data: null, busy: false, missing: false, timer: null };
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
  function when(ts) {
    if (!ts) return '';
    var d = new Date(ts), now = new Date(), mins = Math.round((now - d) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return mins + ' min ago';
    var t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    var y = new Date(now); y.setDate(y.getDate() - 1);
    if (d.toDateString() === now.toDateString()) return 'today ' + t;
    if (d.toDateString() === y.toDateString()) return 'yesterday ' + t;
    return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' ' + t;
  }
  // the Hub is one shared login, so it asks for a name and remembers it for 10 minutes
  function hubName() { try { var x = JSON.parse(localStorage.getItem(NAME_KEY) || 'null'); return x && Date.now() - x.at < NAME_MS ? x.name : ''; } catch (e) { return ''; } }
  function setHubName(n) { try { localStorage.setItem(NAME_KEY, JSON.stringify({ name: n, at: Date.now() })); } catch (e) {} }
  function isHub() { return O.ctx.mode === 'hub'; }

  function say(t, k) { var m = O.el && O.el.querySelector('.od-msg'); if (m) { m.textContent = t || ''; m.className = 'od-msg' + (k ? ' ' + k : ''); } }
  function load() {
    return O.ctx.sb.rpc('order_list').then(function (r) {
      if (r.error) { O.missing = gone(r.error); if (!O.missing) say('Couldn’t load the order list. Check your connection.', 'err'); render(); return; }
      if (r.data && r.data.error) { O.data = { denied: true }; render(); return; }
      O.missing = false;
      var before = JSON.stringify(O.data); O.data = r.data;
      if (JSON.stringify(O.data) !== before) render();
    }, function () { say('Couldn’t load the order list. Check your connection.', 'err'); });
  }
  function call(name, args, okMsg) {
    if (O.busy) return; O.busy = true;
    O.ctx.sb.rpc(name, args).then(function (r) {
      O.busy = false;
      if (r.error || !r.data || r.data.error) {
        var why = r.data && r.data.error;
        say(why === 'hub_only' ? 'Orders are marked received on the Hub.' : why === 'not_allowed' ? 'Only the Owner and managers can do that.' : why === 'empty' ? 'Type what needs ordering first.' : 'Couldn’t save that. Check your connection.', 'err');
        return;
      }
      O.data = r.data; render(); say(okMsg || '', 'ok');
    }, function () { O.busy = false; say('Couldn’t save that. Check your connection.', 'err'); });
  }

  function render() {
    var el = O.el; if (!el) return;
    var keepFocus = document.activeElement && el.contains(document.activeElement) && document.activeElement.tagName === 'INPUT' ? document.activeElement.getAttribute('data-f') : null;
    var draft = {}; el.querySelectorAll('.od-form input').forEach(function (i) { draft[i.getAttribute('data-f')] = i.value; });
    clear(el);
    var wrap = h('div', { cls: 'od' + (isHub() ? ' od-hub' : '') }); el.appendChild(wrap);
    wrap.appendChild(h('header', { cls: 'od-top' }, [
      h('p', { cls: 'sc-eyebrow', text: 'Ordering' }), h('h1', { cls: 'sc-week', text: 'Order list' }),
      h('p', { cls: 'od-help', text: isHub() ? 'Add anything that needs ordering. When it comes in, tap Received.'
        : O.ctx.mode === 'admin' ? 'Anyone on the staff can add to this list, on the staff page or on the Hub. Items are marked received on the Hub when they arrive (you can mark them here too). Only the Owner and managers can delete a line.'
        : 'Add anything that needs ordering. When it comes in, it’s marked received on the Hub.' })
    ]));
    if (O.missing) { wrap.appendChild(h('p', { cls: 'od-setup', text: 'The order list isn’t set up yet: run the latest supabase/hub.sql in Supabase.' })); return; }
    if (!O.data) { wrap.appendChild(h('p', { cls: 'od-empty', text: 'Loading…' })); return; }
    if (O.data.denied) { wrap.appendChild(h('p', { cls: 'od-empty', text: 'This login can’t use the order list.' })); return; }

    // add a line
    var f = function (key, ph, max, cls) { return h('input', { type: 'text', 'data-f': key, cls: cls || null, placeholder: ph, maxlength: String(max), autocomplete: 'off', value: draft[key] || (key === 'by' ? hubName() : '') }); };
    var item = f('item', 'What needs ordering?', 200, 'od-item'), qty = f('qty', 'How much', 60, 'od-qty'), note = f('note', 'Note (brand, vendor…)', 300, 'od-note');
    var by = isHub() ? f('by', 'Your name', 60, 'od-by') : null;
    var add = function () {
      var v = item.value.trim(); if (!v) { say('Type what needs ordering first.', 'err'); item.focus(); return; }
      if (by && by.value.trim()) setHubName(by.value.trim());
      var args = { p_item: v, p_qty: qty.value, p_note: note.value, p_by: by ? by.value : '' };   // read before the boxes are cleared
      [item, qty, note].forEach(function (i) { i.value = ''; });
      call('order_add', args, 'Added “' + v + '”.');
    };
    [item, qty, note].concat(by ? [by] : []).forEach(function (i) { i.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); add(); } }); });
    wrap.appendChild(h('div', { cls: 'od-form' }, [item, qty, note, by, h('button', { type: 'button', cls: 'ed-btn od-add', text: 'Add to the list', on: { click: add } })]));
    wrap.appendChild(h('p', { cls: 'od-msg', role: 'status' }));

    // still to order
    var open = O.data.open || [], rec = O.data.received || [];
    wrap.appendChild(h('h2', { cls: 'od-h', text: open.length ? 'To order · ' + open.length : 'To order' }));
    if (!open.length) wrap.appendChild(h('p', { cls: 'od-empty', text: 'Nothing on the list.' }));
    else wrap.appendChild(h('ul', { cls: 'od-list' }, open.map(function (o) { return line(o, false); })));
    if (rec.length) {
      wrap.appendChild(h('h2', { cls: 'od-h od-h2', text: 'Received, last 3 days' }));
      wrap.appendChild(h('ul', { cls: 'od-list od-rec' }, rec.map(function (o) { return line(o, true); })));
    }
    if (keepFocus) { var back = wrap.querySelector('.od-form [data-f=' + keepFocus + ']'); if (back) back.focus(); }
  }
  function line(o, got) {
    var name = function () { var b = O.el.querySelector('.od-form [data-f=by]'); var n = b ? b.value.trim() : ''; if (n) setHubName(n); return n; };
    return h('li', { cls: 'od-line' + (got ? ' got' : '') }, [
      h('div', { cls: 'od-what' }, [
        h('b', { text: o.item }), o.qty ? h('span', { cls: 'od-q', text: o.qty }) : null,
        o.note ? h('small', { cls: 'od-n', text: o.note }) : null,
        h('small', { cls: 'od-meta', text: got ? 'Received ' + when(o.received_at) + (o.received_by ? ' · ' + o.received_by : '') : 'Added ' + when(o.added_at) + (o.added_by ? ' · ' + o.added_by : '') })
      ]),
      h('div', { cls: 'od-acts' }, [
        O.data.can_receive ? (got
          ? h('button', { type: 'button', cls: 'ed-btn small od-undo', text: 'Undo', on: { click: function () { call('order_receive', { p_id: o.id, p_on: false, p_by: '' }); } } })
          : h('button', { type: 'button', cls: 'ed-btn od-recv', text: 'Received', on: { click: function () { call('order_receive', { p_id: o.id, p_on: true, p_by: name() }, '“' + o.item + '” received.'); } } })) : null,
        O.data.can_delete ? h('button', { type: 'button', cls: 'od-x', 'aria-label': 'Delete ' + o.item, title: 'Delete', text: '✕', on: { click: function () { if (confirm('Delete “' + o.item + '” from the order list?')) call('order_delete', { p_id: o.id }); } } }) : null
      ])
    ]);
  }

  window.EdenOrders = {
    show: function (ctx) {
      O.ctx = ctx; O.el = ctx.el; render(); load();
      clearInterval(O.timer);
      O.timer = setInterval(function () {
        if (!O.el || document.hidden || O.el.offsetParent === null || O.busy) return;
        var a = document.activeElement; if (a && O.el.contains(a) && a.tagName === 'INPUT' && a.value) return;   // not while typing
        load();
      }, 10000);
    }
  };
})();
