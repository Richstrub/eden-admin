/* Eden: events calendar. Used on the staff site (#calendar) and on the staff page (Calendar tab).
 *
 * Day, Week and Month views. Day shows each event as a bar on an hour timeline (the same look as staff
 * shifts); Week lists each day's events; Month lists event names in each date. Tap a day to open it.
 * Owner and Managers add and edit events; everyone else on the team can read the calendar. Events in the
 * same room at overlapping times get a double-booking warning. Later, BEOs will add events here
 * automatically (each event has a source and an optional beo_id for that).
 *
 * Data: Supabase table events (supabase/calendar.sql).
 */
(function () {
  'use strict';
  var TYPES = [
    { id: 'private', label: 'Private event', color: '#b0703f' },
    { id: 'supper', label: 'Supper Club', color: '#3f6b4f' },
    { id: 'catering', label: 'Catering / off-site', color: '#2f5f8a' },
    { id: 'meeting', label: 'Meeting / tasting', color: '#6b6f74' },
    { id: 'closed', label: 'Closed / holiday', color: '#a33a2c' },
    { id: 'other', label: 'Other', color: '#2b3035' }
  ];
  var ROOMS = ['Main dining room', 'Bar', 'Private dining room', 'Patio', 'Whole restaurant', 'Off-site'];
  var DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  var DAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  var C = { ctx: null, el: null, view: 'month', day: today(), events: [], range: null, loading: false, missing: false };

  /* ---------- helpers ---------- */
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
  function today() { var d = new Date(); return new Date(d.getFullYear(), d.getMonth(), d.getDate()); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseDay(t) { var p = String(t || '').split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
  function monday(d) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() - x.getDay()); return x; } // weeks start on Sunday
  function firstOfMonth(d) { return new Date(d.getFullYear(), d.getMonth(), 1); }
  function md(d) { return (d.getMonth() + 1) + '/' + d.getDate(); }
  function mins(t) { var p = String(t || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function clock(m) { m = ((m % 1440) + 1440) % 1440; var H = Math.floor(m / 60), M = m % 60; return (H % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H >= 12 ? 'p' : 'a'); }
  function fmtT(t) { return t ? clock(mins(t)) : ''; }
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function typeOf(id) { return TYPES.filter(function (t) { return t.id === id; })[0] || TYPES[TYPES.length - 1]; }
  function status(t, k) { if (C.ctx && C.ctx.status) C.ctx.status(t, k); }
  function canEdit() { return !!(C.ctx && C.ctx.canEdit); }
  function isMissing(e) { return e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message || '')); }
  function isPerm(e) { return e && (e.code === '42501' || /row-level security|permission/i.test(e.message || '')); }
  function startM(e) { return e.all_day ? 0 : mins(e.start); }
  function endM(e) { // events without an end time are drawn as 2 hours, faded
    if (e.all_day) return 1440;
    if (!e.end) return mins(e.start) + 120;
    var x = mins(e.end); if (x <= mins(e.start)) x += 1440; return x;
  }
  function timeText(e) { return e.all_day ? 'All day' : fmtT(e.start) + (e.end ? '–' + fmtT(e.end) : ''); }
  function onDay(d) { var k = iso(d); return C.events.filter(function (e) { return e.date === k; }).sort(function (a, b) { return (b.all_day ? 1 : 0) - (a.all_day ? 1 : 0) || startM(a) - startM(b) || String(a.title).localeCompare(b.title); }); }
  function clashes(e, list) { // same room, overlapping time, same day
    if (!e.room) return [];
    return (list || C.events).filter(function (o) {
      if (o.id === e.id || o.date !== e.date || !o.room || o.room !== e.room) return false;
      if (e.room === 'Off-site') return false;
      return startM(o) < endM(e) && startM(e) < endM(o);
    });
  }

  /* ---------- data ---------- */
  function rangeFor() {
    if (C.view === 'day') return [C.day, C.day];
    if (C.view === 'week') { var m = monday(C.day); return [m, addDays(m, 6)]; }
    var f = firstOfMonth(C.day), l = new Date(f.getFullYear(), f.getMonth() + 1, 0);
    return [monday(f), addDays(monday(l), 6)];
  }
  function load() {
    var r = rangeFor(), key = iso(r[0]) + '|' + iso(r[1]);
    C.loading = true;
    return C.ctx.sb.from('events').select('*').gte('date', iso(r[0])).lte('date', iso(r[1])).order('date').then(function (res) {
      C.loading = false;
      if (res.error) { C.missing = isMissing(res.error); C.events = []; if (!C.missing) status(isPerm(res.error) ? 'Your login can’t open the calendar.' : 'Couldn’t load the calendar.', 'err'); return; }
      C.missing = false; C.events = res.data || []; C.range = key;
    }, function () { C.loading = false; });
  }
  function go() { render(); load().then(render); }

  /* ---------- rendering ---------- */
  function title() {
    if (C.view === 'day') return C.day.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    if (C.view === 'week') { var m = monday(C.day), e = addDays(m, 6); return 'Week of ' + m.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + (m.getMonth() === e.getMonth() ? e.getDate() : e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })) + ', ' + e.getFullYear(); }
    return C.day.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
  }
  function step(n) {
    if (C.view === 'day') C.day = addDays(C.day, n);
    else if (C.view === 'week') C.day = addDays(C.day, 7 * n);
    else C.day = new Date(C.day.getFullYear(), C.day.getMonth() + n, 1);
    go();
  }
  function isCurrent() {
    var t = today();
    if (C.view === 'day') return iso(C.day) === iso(t);
    if (C.view === 'week') return iso(monday(C.day)) === iso(monday(t));
    return C.day.getFullYear() === t.getFullYear() && C.day.getMonth() === t.getMonth();
  }
  function openDay(d) { C.view = 'day'; C.day = new Date(d.getFullYear(), d.getMonth(), d.getDate()); go(); var top = C.el.querySelector('.cl-in'); if (top && top.getBoundingClientRect().top < 0) top.scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  function render() {
    var el = C.el; if (!el) return;
    el.innerHTML = '';
    var wrap = h('div', { cls: 'cl-in' }); el.appendChild(wrap);
    var tog = h('div', { cls: 'sc-viewtog cl-tog', role: 'group', 'aria-label': 'View' }, ['day', 'week', 'month'].map(function (v) {
      return h('button', { type: 'button', 'data-v': v, 'aria-pressed': C.view === v ? 'true' : 'false', text: v.charAt(0).toUpperCase() + v.slice(1), on: { click: function () { if (v === 'day') C.day = today(); C.view = v; go(); } } });
    }));
    var unit = C.view;
    wrap.appendChild(h('div', { cls: 'cl-title' }, [
      h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Events' }), h('h1', { cls: 'sc-week', text: title() })]),
      h('div', { cls: 'cl-tools' }, [
        tog,
        h('button', { type: 'button', cls: 'ed-btn small', 'aria-label': 'Previous ' + unit, text: '←', on: { click: function () { step(-1); } } }),
        h('button', { type: 'button', cls: 'ed-btn small', disabled: isCurrent(), text: C.view === 'day' ? 'Today' : C.view === 'week' ? 'This week' : 'This month', on: { click: function () { C.day = today(); go(); } } }),
        h('button', { type: 'button', cls: 'ed-btn small', 'aria-label': 'Next ' + unit, text: '→', on: { click: function () { step(1); } } }),
        canEdit() && !C.missing ? h('button', { type: 'button', cls: 'ed-btn cl-add', text: '+ Add event', on: { click: function () { editEvent(null, C.view === 'day' ? C.day : null); } } }) : null
      ])
    ]));
    wrap.appendChild(h('p', { cls: 'rc-status cl-status', role: 'status' }));
    if (C.missing) { wrap.appendChild(h('div', { cls: 'iv-setup' }, [h('p', { text: canEdit() ? 'The calendar isn’t in Supabase yet. In Supabase, open SQL Editor → New query, paste the contents of supabase/calendar.sql from the eden-admin repository, and click Run. Then reload this page.' : 'The calendar hasn’t been set up yet.' })])); return; }
    if (C.loading && !C.events.length) wrap.appendChild(h('p', { cls: 'sc-empty', text: 'Loading…' }));
    if (C.view === 'day') wrap.appendChild(dayView());
    else if (C.view === 'week') wrap.appendChild(weekView());
    else wrap.appendChild(monthView());
    wrap.appendChild(h('div', { cls: 'cl-legend' }, TYPES.map(function (t) { return h('span', null, [h('i', { style: 'background:' + t.color }), t.label]); })));
  }

  function chip(e) {
    var t = typeOf(e.type), warn = clashes(e).length;
    return h('button', { type: 'button', cls: 'cl-ev' + (warn ? ' clash' : ''), style: '--c:' + t.color, title: e.title + ' · ' + timeText(e) + (e.room ? ' · ' + e.room : ''), on: { click: function (ev) { ev.stopPropagation(); showEvent(e); } } }, [
      h('span', { cls: 'cl-ev-t', text: timeText(e) }),
      h('b', { text: e.title || 'Untitled' }),
      h('span', { cls: 'cl-ev-m', text: [e.room, e.guests ? e.guests + ' guests' : ''].filter(Boolean).join(' · ') }),
      warn ? h('span', { cls: 'cl-ev-w', text: 'Double-booked' }) : null
    ]);
  }
  function weekView() {
    var m = monday(C.day), t = iso(today());
    var grid = h('div', { cls: 'cl-week' });
    for (var i = 0; i < 7; i++) {
      (function (d) {
        var list = onDay(d);
        var col = h('div', { cls: 'cl-wcol' + (iso(d) === t ? ' today' : ''), role: 'button', tabindex: '0', 'aria-label': DAYS_LONG[i] + ' ' + md(d) + ', ' + list.length + ' events. Open the day view' }, [
          h('div', { cls: 'cl-whead' }, [h('span', { text: DAYS_LONG[d.getDay()] }), h('b', { text: md(d) }), h('em', { text: (list.length ? list.length + ' event' + (list.length === 1 ? '' : 's') + ' · ' : '') + 'Day view →' })])
        ]);
        if (!list.length) col.appendChild(h('p', { cls: 'cl-none', text: 'Nothing scheduled' }));
        list.forEach(function (e) { col.appendChild(chip(e)); });
        col.addEventListener('click', function () { openDay(d); });
        col.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); openDay(d); } });
        grid.appendChild(col);
      })(addDays(m, i));
    }
    return grid;
  }
  function monthView() {
    var f = firstOfMonth(C.day), l = new Date(f.getFullYear(), f.getMonth() + 1, 0), t = iso(today());
    var cal = h('div', { cls: 'cl-month' });
    DAYS.forEach(function (d) { cal.appendChild(h('div', { cls: 'cl-mh', text: d })); });
    for (var d = monday(f); d <= addDays(monday(l), 6); d = addDays(d, 1)) {
      (function (date) {
        var list = onDay(date);
        var cell = h('button', { type: 'button', cls: 'cl-md' + (date.getMonth() !== f.getMonth() ? ' out' : '') + (iso(date) === t ? ' today' : ''), 'aria-label': date.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ', ' + list.length + ' events. Open the day view', on: { click: function () { openDay(date); } } }, [
          h('span', { cls: 'cl-mn', text: String(date.getDate()) })
        ]);
        list.slice(0, 4).forEach(function (e) {
          cell.appendChild(h('span', { cls: 'cl-mev' + (clashes(e).length ? ' clash' : ''), style: '--c:' + typeOf(e.type).color }, [h('i'), h('span', { text: (e.all_day ? '' : fmtT(e.start) + ' ') + (e.title || 'Untitled') })]));
        });
        if (list.length > 4) cell.appendChild(h('span', { cls: 'cl-more', text: '+' + (list.length - 4) + ' more' }));
        if (list.length) cell.appendChild(h('span', { cls: 'cl-mc', text: list.length + ' event' + (list.length === 1 ? '' : 's') }));
        cal.appendChild(cell);
      })(new Date(d));
    }
    return h('div', null, [cal, h('p', { cls: 'cl-hint', text: 'Tap a day to see its timeline.' })]);
  }
  function dayView() {
    var box = h('div', { cls: 'cl-day' }), list = onDay(C.day);
    var allDay = list.filter(function (e) { return e.all_day; }), timed = list.filter(function (e) { return !e.all_day; });
    if (!list.length) {
      box.appendChild(h('div', { cls: 'cl-emptyday' }, [h('p', { text: 'Nothing on the calendar this day.' }),
        canEdit() ? h('button', { type: 'button', cls: 'ed-btn small', text: '+ Add an event on this day', on: { click: function () { editEvent(null, C.day); } } }) : null]));
      return box;
    }
    if (allDay.length) box.appendChild(h('div', { cls: 'cl-allday' }, [h('span', { cls: 'cl-ad-l', text: 'All day' })].concat(allDay.map(chip))));
    if (!timed.length) return box;
    var lo = Infinity, hi = -Infinity;
    timed.forEach(function (e) { lo = Math.min(lo, startM(e)); hi = Math.max(hi, endM(e)); });
    lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
    if (hi - lo < 6 * 60) hi = Math.min(lo + 6 * 60, 30 * 60);
    var span = hi - lo, pct = function (m) { return ((m - lo) / span * 100) + '%'; };
    var tl = h('div', { cls: 'cl-tl', style: '--hours:' + (span / 60) });
    var scale = h('div', { cls: 'cl-tl-scale' });
    for (var m = lo; m <= hi; m += 60) scale.appendChild(h('span', { cls: 'cl-tl-tick', style: 'left:' + pct(m), text: clock(m) }));
    tl.appendChild(h('div', { cls: 'cl-tl-ruler' }, [h('div', { cls: 'cl-tl-who' }, h('span', { text: timed.length + ' event' + (timed.length === 1 ? '' : 's') })), scale]));
    timed.forEach(function (e) {
      var a = startM(e), b = endM(e), t = typeOf(e.type), warn = clashes(e).length;
      tl.appendChild(h('div', { cls: 'cl-tl-row' }, [
        h('div', { cls: 'cl-tl-who' }, [h('b', { text: e.title || 'Untitled' }), h('span', { text: [e.room, e.guests ? e.guests + ' guests' : ''].filter(Boolean).join(' · ') || t.label })]),
        h('div', { cls: 'cl-tl-lane' }, [
          h('button', { type: 'button', cls: 'cl-tl-bar' + (e.end ? '' : ' open') + (warn ? ' clash' : ''), style: '--c:' + t.color + ';left:' + pct(a) + ';width:calc(' + pct(b) + ' - ' + pct(a) + ')', title: e.title + ' · ' + timeText(e) + (e.room ? ' · ' + e.room : ''), on: { click: function () { showEvent(e); } } },
            [h('span', { text: timeText(e) + (warn ? ' · double-booked' : '') + (e.notes ? ' · ' + e.notes.split('\n')[0] : '') })])
        ])
      ]));
    });
    var grid = h('div', { cls: 'cl-tl-grid', 'aria-hidden': 'true' });
    for (var g = lo; g <= hi; g += 60) grid.appendChild(h('i', { style: 'left:' + pct(g) }));
    var now = new Date(), nm = now.getHours() * 60 + now.getMinutes();
    if (iso(now) === iso(C.day) && nm >= lo && nm <= hi) grid.appendChild(h('b', { cls: 'cl-tl-now', style: 'left:' + pct(nm) }));
    tl.appendChild(grid);
    box.appendChild(h('div', { cls: 'cl-tl-scroll' }, tl));
    if (timed.some(function (e) { return !e.end; })) box.appendChild(h('p', { cls: 'cl-hint', text: 'Events without an end time are drawn as two hours, with a faded end.' }));
    return box;
  }

  /* ---------- event details / editor ---------- */
  function modal(titleText, body, foot) {
    var back = h('div', { cls: 'sc-modal' + (document.body.classList.contains('nt-open') ? ' nt-modal' : ''), role: 'dialog', 'aria-modal': 'true' });
    function close() { back.remove(); document.removeEventListener('keydown', esc); }
    function esc(ev) { if (ev.key === 'Escape') close(); }
    back.appendChild(h('div', { cls: 'sc-card' }, [h('div', { cls: 'sc-card-h' }, [h('h2', { text: titleText }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: close } })]), h('div', { cls: 'sc-card-b' }, body), foot ? h('div', { cls: 'sc-card-f' }, foot(close)) : null]));
    back.addEventListener('mousedown', function (ev) { if (ev.target === back) close(); });
    document.addEventListener('keydown', esc);
    document.body.appendChild(back);
    return close;
  }
  function showEvent(e) {
    var t = typeOf(e.type), cl = clashes(e), d = parseDay(e.date);
    modal(e.title || 'Event', [
      h('p', { cls: 'cl-dtype', style: '--c:' + t.color }, [h('i'), t.label + (e.source === 'beo' ? ' · from a BEO' : e.source === 'note' ? ' · from a note' : '')]),
      h('dl', { cls: 'cl-dl' }, [
        h('dt', { text: 'When' }), h('dd', { text: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) + ' · ' + timeText(e) }),
        e.room ? h('dt', { text: 'Where' }) : null, e.room ? h('dd', { text: e.room }) : null,
        e.guests ? h('dt', { text: 'Guests' }) : null, e.guests ? h('dd', { text: String(e.guests) }) : null,
        e.notes ? h('dt', { text: 'Notes' }) : null, e.notes ? h('dd', { cls: 'cl-notes', text: e.notes }) : null
      ]),
      cl.length ? h('p', { cls: 'cl-warn', text: 'Double-booked: ' + cl.map(function (o) { return o.title + ' (' + timeText(o) + ')'; }).join(', ') + ' in the ' + e.room + '.' }) : null
    ], function (close) {
      return [h('button', { type: 'button', cls: 'ed-btn small', text: 'Day view', on: { click: function () { close(); openDay(d); } } }),
        e.note_id && window.EdenNotes && window.EdenNotes.openNote ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Open the note', on: { click: function () { close(); window.EdenNotes.openNote(e.note_id); } } }) : null,
        h('span', { cls: 'sc-sp' }),
        canEdit() ? h('button', { type: 'button', cls: 'ed-btn', text: 'Edit', on: { click: function () { close(); editEvent(e); } } }) : h('button', { type: 'button', cls: 'ed-btn', text: 'Close', on: { click: close } })];
    });
  }
  function editEvent(e, onDate) {
    var isNew = !e || !!e._new;
    e = e || { id: uid(), title: '', type: 'private', date: iso(onDate || (C.view === 'month' && !isCurrent() ? firstOfMonth(C.day) : today())), all_day: false, start: '18:00', end: '21:00', room: '', guests: null, notes: '', source: 'manual' };
    var f = {
      title: h('input', { type: 'text', value: e.title || '', placeholder: 'e.g. Smith rehearsal dinner' }),
      type: h('select', null, TYPES.map(function (t) { return h('option', { value: t.id, text: t.label }); })),
      date: h('input', { type: 'date', value: e.date }),
      allDay: h('input', { type: 'checkbox' }),
      start: h('input', { type: 'time', value: e.start || '', step: '900' }),
      end: h('input', { type: 'time', value: e.end || '', step: '900' }),
      room: h('input', { type: 'text', value: e.room || '', list: 'clRooms', placeholder: 'e.g. Private dining room' }),
      guests: h('input', { type: 'number', min: '0', inputmode: 'numeric', value: e.guests != null ? String(e.guests) : '', placeholder: 'e.g. 24' }),
      notes: h('textarea', { rows: '4', placeholder: 'Menu, setup, deposit, contact notes… (the whole team can read this)' })
    };
    f.type.value = e.type || 'private'; f.allDay.checked = !!e.all_day; f.notes.value = e.notes || '';
    var times = h('div', { cls: 'sc-row2' }, [h('label', { cls: 'sc-f' }, [h('span', { text: 'Starts' }), f.start]), h('label', { cls: 'sc-f' }, [h('span', { text: 'Ends (optional)' }), f.end])]);
    function syncAll() { times.hidden = f.allDay.checked; }
    f.allDay.addEventListener('change', syncAll); syncAll();
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var close = modal(isNew ? 'Add event' : 'Edit event', [
      h('label', { cls: 'sc-f' }, [h('span', { text: 'Event' }), f.title]),
      h('div', { cls: 'sc-row2' }, [h('label', { cls: 'sc-f' }, [h('span', { text: 'Type' }), f.type]), h('label', { cls: 'sc-f' }, [h('span', { text: 'Date' }), f.date])]),
      h('label', { cls: 'sc-check' }, [f.allDay, ' All day']),
      times,
      h('div', { cls: 'sc-row2' }, [h('label', { cls: 'sc-f' }, [h('span', { text: 'Room' }), f.room]), h('label', { cls: 'sc-f' }, [h('span', { text: 'Guests' }), f.guests])]),
      h('datalist', { id: 'clRooms' }, ROOMS.map(function (r) { return h('option', { value: r }); })),
      h('label', { cls: 'sc-f' }, [h('span', { text: 'Notes' }), f.notes]),
      msg
    ], function (closeFn) {
      return [
        !isNew ? h('button', { type: 'button', cls: 'ed-btn small danger', text: 'Delete event', on: { click: function () {
          if (!confirm('Delete “' + (e.title || 'this event') + '”?')) return;
          C.ctx.sb.from('events').delete().eq('id', e.id).then(function (r) {
            if (r.error) { msg.textContent = isPerm(r.error) ? 'Only the Owner and Managers can change the calendar.' : 'Couldn’t delete. Try again.'; return; }
            C.events = C.events.filter(function (x) { return x.id !== e.id; }); closeFn(); status('Event deleted.', 'ok'); render();
          });
        } } }) : h('span'),
        h('span', { cls: 'sc-sp' }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: closeFn } }),
        h('button', { type: 'button', cls: 'ed-btn', text: isNew ? 'Add event' : 'Save', on: { click: save } })
      ];
    });
    setTimeout(function () { f.title.focus(); }, 30);
    function save() {
      var row = { id: e.id, title: f.title.value.trim(), type: f.type.value, date: f.date.value, all_day: f.allDay.checked,
        start: f.allDay.checked ? '' : f.start.value, end: f.allDay.checked ? '' : f.end.value, room: f.room.value.trim(),
        guests: f.guests.value === '' ? null : Math.max(0, parseInt(f.guests.value, 10) || 0), notes: f.notes.value.replace(/\s+$/, ''),
        source: e.source || 'manual', beo_id: e.beo_id || null, created_by: e.created_by || (C.ctx && C.ctx.name) || '' };
      if (e.note_id) row.note_id = e.note_id;
      if (!row.title) { msg.textContent = 'Name the event.'; f.title.focus(); return; }
      if (!row.date) { msg.textContent = 'Pick a date.'; f.date.focus(); return; }
      if (!row.all_day && !row.start) { msg.textContent = 'Add a start time, or tick All day.'; f.start.focus(); return; }
      msg.textContent = 'Checking the calendar…';
      // check that day's bookings straight from the database (the calendar may be showing another month)
      C.ctx.sb.from('events').select('*').eq('date', row.date).then(function (dr) {
        var others = ((dr && dr.data) || C.events).filter(function (x) { return x.id !== row.id; });
        var cl = clashes(row, others);
        if (cl.length && !confirm('The ' + row.room + ' is already booked then: ' + cl.map(function (o) { return o.title + ' (' + timeText(o) + ')'; }).join(', ') + '. Save anyway?')) { msg.textContent = ''; return; }
        msg.textContent = 'Saving…';
        write(row);
      });
    }
    function write(row) {
      C.ctx.sb.from('events').upsert(row, { onConflict: 'id' }).then(function (r) {
        if (r.error && row.note_id && /note_id/.test(r.error.message || '')) { delete row.note_id; return write(row); } // older table without note_id
        if (r.error) { msg.textContent = isPerm(r.error) ? 'Only the Owner and Managers can change the calendar.' : 'Couldn’t save. Check your connection and try again.'; return; }
        var i = C.events.findIndex(function (x) { return x.id === row.id; });
        if (i === -1) C.events.push(row); else C.events[i] = row;
        close(); status((isNew ? 'Added ' : 'Saved ') + row.title + (C.ctx.fromNotes ? ' to the calendar on ' + parseDay(row.date).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '') + '.', 'ok');
        if (C.ctx.onSaved) C.ctx.onSaved(row);
        var d = parseDay(row.date), r2 = rangeFor();
        if (d < r2[0] || d > r2[1]) { C.day = d; if (C.view === 'month') C.day = firstOfMonth(d); go(); } else render();
      });
    }
  }

  window.EdenCal = {
    show: function (ctx) {
      var first = !C.ctx; C.ctx = ctx; C.el = ctx.el;
      if (first || ctx.fresh) { C.view = ctx.view || C.view; }
      go();
    },
    // open the Add event form pre-filled (used by Notes)
    addEvent: function (ctx, prefill) {
      C.ctx = Object.assign({}, C.ctx || {}, ctx);
      editEvent(Object.assign({ id: uid(), title: '', type: 'other', date: iso(today()), all_day: false, start: '', end: '', room: '', guests: null, notes: '', source: 'manual' }, prefill, { _new: true }));
    },
    _test: { C: C, clashes: clashes }
  };
})();
