/* Eden Hub: request time off. Pick your name, choose the days, send. It goes into the schedule's time-off requests
 * as pending (the same as asking on the staff page) for the Owner or a manager to approve.
 * Data: supabase/hub.sql (hub_timeoff_people, hub_timeoff_list, hub_timeoff_request).
 */
(function () {
  'use strict';
  var T = { sb: null, el: null, people: null, who: null, mine: null, busy: false, missing: false };
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
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function day(s) { return new Date(s + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); }
  function t12(t) { var p = String(t || '').split(':'), H = +p[0], M = +p[1] || 0; if (isNaN(H)) return t || ''; return (H % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H >= 12 ? 'pm' : 'am'); }
  function gone(e) { return !!(e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|does not exist|schema cache/i.test(e.message || ''))); }
  function say(t, k) { var m = T.el.querySelector('.od-msg'); if (m) { m.textContent = t || ''; m.className = 'od-msg' + (k ? ' ' + k : ''); } }
  var STATUS = { pending: 'Waiting for a manager', approved: 'Approved', denied: 'Not approved' };

  function render() {
    var el = T.el; clear(el);
    var wrap = h('div', { cls: 'od to' }); el.appendChild(wrap);
    wrap.appendChild(h('header', { cls: 'od-top' }, [h('p', { cls: 'sc-eyebrow', text: 'Team' }), h('h1', { cls: 'sc-week', text: 'Request time off' }),
      h('p', { cls: 'od-help', text: T.who ? 'Pick the days. Your request goes to the Owner and managers to approve, and shows on the schedule.' : 'Tap your name to start.' })]));
    if (T.missing) { wrap.appendChild(h('p', { cls: 'od-setup', text: 'Time off from the Hub isn’t set up yet: run the latest supabase/hub.sql in Supabase.' })); return; }
    if (!T.people) { wrap.appendChild(h('p', { cls: 'od-empty', text: 'Loading…' })); return; }
    if (!T.who) { wrap.appendChild(names()); return; }
    wrap.appendChild(h('div', { cls: 'to-who' }, [h('span', { text: 'Requesting for' }), h('b', { text: T.who.name }),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Not you? Start over', on: { click: function () { T.who = null; T.mine = null; render(); } } })]));
    wrap.appendChild(form());
    wrap.appendChild(h('p', { cls: 'od-msg', role: 'status' }));
    wrap.appendChild(h('h2', { cls: 'od-h', text: 'Your requests' }));
    var box = h('div', { cls: 'to-mine' }); wrap.appendChild(box); paintMine(box);
  }
  function names() {
    var groups = [], by = {};
    T.people.forEach(function (p) { var g = p.position || 'Team'; if (!by[g]) { by[g] = []; groups.push(g); } by[g].push(p); });
    if (!T.people.length) return h('p', { cls: 'od-empty', text: 'Nobody is set up for time-off requests yet.' });
    return h('div', { cls: 'to-names' }, groups.map(function (g) {
      return h('section', null, [h('h3', { cls: 'ck-hd', text: g }), h('div', { cls: 'to-grid' }, by[g].map(function (p) {
        return h('button', { type: 'button', cls: 'to-name', text: p.name, on: { click: function () { T.who = p; T.mine = null; render(); loadMine(); } } });
      }))]);
    }));
  }
  function form() {
    var today = iso(new Date());
    var from = h('input', { type: 'date', min: today, value: today, 'aria-label': 'First day off' });
    var to = h('input', { type: 'date', min: today, value: today, 'aria-label': 'Last day off' });
    from.addEventListener('change', function () { to.min = from.value; if (to.value < from.value) to.value = from.value; });
    var all = h('input', { type: 'checkbox', checked: true });
    var st = h('input', { type: 'time', step: '900', value: '16:00', 'aria-label': 'From' }), et = h('input', { type: 'time', step: '900', value: '', 'aria-label': 'Until' });
    var times = h('div', { cls: 'to-times', hidden: true }, [h('label', null, [h('span', { text: 'From' }), st]), h('label', null, [h('span', { text: 'Until (blank = close)' }), et])]);
    all.addEventListener('change', function () { times.hidden = all.checked; });
    var reason = h('input', { type: 'text', maxlength: '400', placeholder: 'Reason (optional)', autocomplete: 'off' });
    var send = h('button', { type: 'button', cls: 'ed-btn to-send', text: 'Send request', on: { click: function () {
      if (T.busy) return;
      if (!from.value || !to.value) { say('Pick the first and last day.', 'err'); return; }
      if (to.value < from.value) { say('The last day can’t be before the first day.', 'err'); return; }
      T.busy = true; send.disabled = true; say('Sending…');
      T.sb.rpc('hub_timeoff_request', { p_emp: T.who.id, p_from: from.value, p_to: to.value, p_all_day: all.checked, p_start: all.checked ? '' : st.value, p_end: all.checked ? '' : et.value, p_reason: reason.value }).then(function (r) {
        T.busy = false; send.disabled = false;
        var why = r.data && r.data.error;
        if (r.error || !r.data || why) { say(why === 'past' ? 'Pick today or a day after.' : why === 'too_long' ? 'Ask for up to two months at a time.' : why === 'bad_time' ? 'Pick a start time, or tick All day.' : why === 'not_allowed' ? 'Time-off requests aren’t switched on for you. Ask a manager.' : 'Couldn’t send. Check the connection and try again.', 'err'); return; }
        T.mine = r.data.requests || []; reason.value = '';
        var box = T.el.querySelector('.to-mine'); if (box) paintMine(box);
        say('Sent. A manager will approve it on the schedule.', 'ok');
      }, function () { T.busy = false; send.disabled = false; say('Couldn’t send. Check the connection and try again.', 'err'); });
    } } });
    return h('div', { cls: 'to-form' }, [
      h('div', { cls: 'to-dates' }, [h('label', null, [h('span', { text: 'First day off' }), from]), h('label', null, [h('span', { text: 'Last day off' }), to])]),
      h('label', { cls: 'to-all' }, [all, h('span', { text: 'All day' })]), times,
      reason, send]);
  }
  function loadMine() {
    var who = T.who;
    T.sb.rpc('hub_timeoff_list', { p_emp: who.id }).then(function (r) {
      if (T.who !== who) return;
      T.mine = (r.data && r.data.requests) || [];
      var box = T.el.querySelector('.to-mine'); if (box) paintMine(box);
    }, function () {});
  }
  function paintMine(box) {
    clear(box);
    if (!T.mine) { box.appendChild(h('p', { cls: 'od-empty', text: 'Loading…' })); return; }
    if (!T.mine.length) { box.appendChild(h('p', { cls: 'od-empty', text: 'No requests in the last month or coming up.' })); return; }
    box.appendChild(h('ul', { cls: 'od-list' }, T.mine.map(function (t) {
      var when = t.start_date === t.end_date ? day(t.start_date) : day(t.start_date) + ' – ' + day(t.end_date);
      if (!t.all_day && t.start_time) when += ', ' + t12(t.start_time) + '–' + (t.end_time ? t12(t.end_time) : 'close');
      return h('li', { cls: 'od-line' }, [h('div', { cls: 'od-what' }, [h('b', { text: when })]), h('span', { cls: 'to-st to-' + t.status, text: STATUS[t.status] || t.status })]);
    })));
  }

  window.EdenHubTimeOff = {
    show: function (ctx) {
      T.sb = ctx.sb; T.el = ctx.el; T.who = null; T.mine = null; render();
      T.sb.rpc('hub_timeoff_people').then(function (r) {
        if (r.error) { T.missing = gone(r.error); if (!T.missing) say('Couldn’t load. Check the connection.', 'err'); render(); return; }
        if (r.data && r.data.error) { T.missing = r.data.error === 'no_timeoff'; T.people = []; render(); return; }
        T.people = (r.data && r.data.people) || []; render();
      }, function () { say('Couldn’t load. Check the connection.', 'err'); });
    }
  };
})();
