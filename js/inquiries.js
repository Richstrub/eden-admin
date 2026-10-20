/* Eden staff site: Catering & BEOs (Owner and managers).
 *
 *   1. A guest sends the short inquiry on the website (about them + their event). It arrives here as New.
 *   2. You send them a private link to the full questionnaire, already filled in with what they sent.
 *   3. They finish it; their menu choices land on the same inquiry (Questionnaire back).
 *   4. Start the BEO: the BEO form opens filled in, and every change is saved with the event (Active BEOs).
 *   5. Mark it Completed after the event.
 * Every email to and from the guest, and each step, is kept in the inquiry's conversation.
 * Email sending/receiving goes through the staff site's worker (worker.js) once email is set up;
 * until then you can copy the link or open it in your own email, and log calls and emails by hand. */
(function () {
  'use strict';
  var STATUS = {
    'new': { label: 'New inquiry', short: 'New' },
    link_sent: { label: 'Questionnaire sent', short: 'Link sent' },
    received: { label: 'Questionnaire back', short: 'Questionnaire back' },
    beo: { label: 'Active BEO', short: 'BEO' },
    completed: { label: 'Completed', short: 'Completed' },
    declined: { label: 'Declined or lost', short: 'Declined' },
    spam: { label: 'Spam', short: 'Spam' }
  };
  var STEPS = ['new', 'link_sent', 'received', 'beo', 'completed'];
  var VIEWS = [
    ['inquiries', 'Inquiries', function (r) { return r.status === 'new' || r.status === 'link_sent' || r.status === 'received'; }],
    ['beos', 'Active BEOs', function (r) { return r.status === 'beo'; }],
    ['past', 'Completed & declined', function (r) { return r.status === 'completed' || r.status === 'declined'; }],
    ['spam', 'Spam', function (r) { return r.status === 'spam'; }]
  ];
  var FLAGS = {
    'trap-field': 'Filled in a hidden field that only bots see',
    'too-fast': 'Sent within seconds of opening the form',
    'links': 'Several web links in the message',
    'script': 'Name or message in an unexpected alphabet',
    'email-not-sent': 'An earlier confirmation email couldn’t be sent',
    'unverified': 'Didn’t finish Cloudflare’s quick “are you a person” check (or it couldn’t run on their device). If it looks real, choose Not spam.'
  };
  function flagText(f) { var m = /^check-error-(.+)$/.exec(f); return m ? (m[1] === 'load' ? 'The check was blocked from loading on their device (often a browser extension or work network)' : 'The check reported error ' + m[1] + ' on their device') + (/^1102/.test(m[1]) ? ' (edencny.com isn’t on the Turnstile widget’s list of hostnames)' : '') : FLAGS[f] || f; }
  var CFG = window.EDEN_STAFF_CONFIG || {};
  var GUEST = String(CFG.guestSite || CFG.publicSite || 'https://edencny.com/').replace(/\/?$/, '/');
  var I = { ctx: null, el: null, rows: [], loaded: false, missing: false, view: 'inquiries', sel: null, q: '', msgs: {}, compose: null };

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
  function isMissing(e) { return e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message || '')); }
  function parseDay(x) { var p = String(x || '').slice(0, 10).split('-'); return p.length === 3 && p[0] ? new Date(+p[0], +p[1] - 1, +p[2]) : null; }
  function longDate(x) { var d = parseDay(x); return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
  function stamp(x) { return x ? new Date(x).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  function ago(x) {
    var d = new Date(x), s = (Date.now() - d) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' hr ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + ' day' + (Math.round(s / 86400) === 1 ? '' : 's') + ' ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function daysTo(x) { var d = parseDay(x); if (!d) return ''; var t = new Date(); t.setHours(0, 0, 0, 0); var n = Math.round((d - t) / 86400000); return n === 0 ? 'Today' : n === 1 ? 'Tomorrow' : n > 1 ? 'In ' + n + ' days' : Math.abs(n) + ' day' + (n === -1 ? '' : 's') + ' ago'; }
  function money(n) { return n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
  function time12(t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return ''; var hh = +m[1], ap = hh >= 12 ? 'pm' : 'am'; hh = hh % 12 || 12; return hh + (m[2] === '00' ? '' : ':' + m[2]) + ap; }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function first(r) { return String(r.name || '').trim().split(' ')[0] || 'there'; }
  function cur() { return I.rows.filter(function (x) { return x.id === I.sel; })[0]; }

  /* ---------- data ---------- */
  function load() {
    return I.ctx.sb.from('catering_inquiries').select('*').order('created_at', { ascending: false }).then(function (r) {
      I.loaded = true;
      if (r.error) { I.missing = isMissing(r.error); if (!I.missing) I.ctx.status('Couldn’t load Catering & BEOs.', 'err'); I.rows = []; return; }
      I.missing = false; I.rows = r.data || [];
      syncAllBeos();
      I.rows.forEach(function (x) { if (x.status === 'beo') calSync(x, true); });   // active BEOs made before this, or on another computer
    }, function () { I.loaded = true; I.ctx.status('Couldn’t reach the database.', 'err'); });
  }
  function loadMsgs(id) {
    return I.ctx.sb.from('inquiry_messages').select('*').eq('inquiry_id', id).order('at', { ascending: true }).then(function (r) {
      I.msgs[id] = r.error ? [] : (r.data || []);
      I.msgs[id].sort(function (a, b) { return a.at < b.at ? -1 : 1; });
    });
  }
  function save(row, patch, msg) {
    var was = row.status;
    Object.assign(row, patch);
    return I.ctx.sb.from('catering_inquiries').update(patch).eq('id', row.id).then(function (r) {
      if (r.error) { I.ctx.status('Couldn’t save that change. ' + (r.error.message || ''), 'err'); return false; }
      if (msg) I.ctx.status(msg, 'ok');
      if (patch.status === 'beo' && was !== 'beo') calSync(row, false, msg);
      else if (patch.status && (patch.status === 'declined' || patch.status === 'spam') && was !== patch.status) calRemove(row);
      return true;
    });
  }

  /* ---------- an active BEO keeps its own event on the calendar ---------- */
  // what the calendar event should say, from the BEO (or the inquiry, until the BEO has it)
  function calFields(r) {
    var d = r.beo_doc || r.beo || {}, g = function (k) { return String(d[k] == null ? '' : d[k]).trim(); };
    var date = (g('ev.date') || String(r.event_date || '')).slice(0, 10);
    var start = (g('ev.start') || String(r.start_time || '')).slice(0, 5), end = (g('ev.end') || String(r.end_time || '')).slice(0, 5);
    var room = g('ev.room') || r.location || ''; if (room === 'Other') room = g('ev.address') || r.location || 'Off site';
    var guests = parseInt(g('ev.guar') || g('ev.expected') || r.guests, 10);
    var title = g('ev.name') || r.event_name || ((r.name || 'Guest') + ' event');
    return { title: title, date: /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : '', all_day: !start, start: start, end: start ? end : '', room: room,
      guests: isFinite(guests) && guests > 0 ? guests : null, type: room && !/3rd Floor|Palladian|Restaurant/i.test(room) ? 'catering' : 'private' };
  }
  function calNotes(r) {
    var bits = [r.name, r.email, r.phone].filter(Boolean).join(' · ');
    return 'Active BEO' + (bits ? ' for ' + bits : '') + '. Date, time, room and guest count follow the BEO.';
  }
  var calBusy = {}, calLast = {};
  function calSync(r, quiet, said) {
    if (!I.ctx.sb || calBusy[r.id]) return Promise.resolve();
    var f = calFields(r), key = JSON.stringify(f);
    if (calLast[r.id] === key) return Promise.resolve();
    if (!f.date) { if (!quiet) I.ctx.status((said ? said + ' ' : '') + 'It goes on the calendar once the BEO has an event date.', 'ok'); return Promise.resolve(); }
    calBusy[r.id] = 1;
    var sb = I.ctx.sb, done = function () { delete calBusy[r.id]; };
    return sb.from('events').select('*').eq('beo_id', r.id).then(function (x) {
      if (x.error) throw x.error;
      var ev = (x.data || [])[0];
      if (ev) {   // keep it in step with the BEO; notes someone wrote on the calendar are left alone
        var patch = {}; Object.keys(f).forEach(function (k) { if (String(ev[k] == null ? '' : ev[k]) !== String(f[k] == null ? '' : f[k])) patch[k] = f[k]; });
        if (ev.source !== 'beo') patch.source = 'beo';   // one added by hand from the inquiry becomes the BEO's event
        if (!Object.keys(patch).length) return 'same';
        var up = Object.assign({}, ev, patch); delete up.created_at; delete up.updated_at;
        return sb.from('events').upsert(up, { onConflict: 'id' }).then(function (u) { if (u.error) throw u.error; return 'moved'; });
      }
      var row = Object.assign({ id: (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'beo-' + r.id, notes: calNotes(r), source: 'beo', beo_id: r.id, created_by: I.ctx.name || '' }, f);
      return sb.from('events').upsert(row, { onConflict: 'id' }).then(function (u) { if (u.error) throw u.error; return 'added'; });
    }).then(function (what) {
      done(); calLast[r.id] = key;
      if (what === 'added' && !quiet) I.ctx.status((said ? said + ' ' : '') + 'Added to the calendar on ' + longDate(f.date) + '.', 'ok');
      else if (what === 'added' || what === 'moved') I.ctx.status('Calendar updated: ' + f.title + ', ' + longDate(f.date) + '.', 'ok');
    }, function (e) {
      done();
      if (!quiet) I.ctx.status(/permission|policy|denied/i.test((e && e.message) || '') ? 'Only the Owner and Managers can add it to the calendar.' : /relation|does not exist/i.test((e && e.message) || '') ? 'Couldn’t add it to the calendar: the calendar isn’t set up yet.' : 'Couldn’t add it to the calendar. ' + ((e && e.message) || ''), 'err');
    });
  }
  function calRemove(r) {
    delete calLast[r.id];
    return I.ctx.sb.from('events').delete().eq('beo_id', r.id).eq('source', 'beo').then(function () {}, function () {});
  }
  function addMsg(row, m) {
    var rec = Object.assign({ inquiry_id: row.id, by_name: I.ctx.name || '', at: new Date().toISOString() }, m);
    return I.ctx.sb.from('inquiry_messages').insert([rec]).then(function (r) {
      if (r.error) { I.ctx.status('Couldn’t save to the conversation. ' + (r.error.message || ''), 'err'); return false; }
      (I.msgs[row.id] = I.msgs[row.id] || []).push(Object.assign({ id: 'local' + Date.now() }, rec));
      if (m.kind === 'out' || m.kind === 'in') row.last_message_at = rec.at;
      return true;
    });
  }
  function token() { return I.ctx.sb.auth.getSession().then(function (r) { return r && r.data && r.data.session && r.data.session.access_token || ''; }); }

  /* ---------- page ---------- */
  function render() {
    var el = I.el; el.innerHTML = '';
    var wrap = h('div', { cls: 'cq-in' }); el.appendChild(wrap);
    wrap.appendChild(h('div', { cls: 'cq-title' }, [
      h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Catering & BEOs' }), h('h1', { cls: 'sc-week', text: I.view === 'beos' ? 'Active BEOs' : 'Catering & BEOs' })]),
      h('p', { cls: 'cq-sub', text: 'Inquiries from the website, the guest’s questionnaire, the BEO and every email with the guest, in one place.' })
    ]));
    I.healthEl = h('div', { cls: 'cq-health', role: 'status' }); wrap.appendChild(I.healthEl); paintHealth();
    if (!I.loaded) { wrap.appendChild(h('p', { cls: 'cq-empty', text: 'Loading…' })); return; }
    if (I.missing) {
      wrap.appendChild(h('div', { cls: 'iv-setup' }, [h('p', { text: 'Catering & BEOs isn’t switched on yet. In Supabase, open SQL Editor → New query, paste the contents of supabase/inquiries.sql from the eden-admin repository, and click Run. The README lists the remaining steps.' })]));
      return;
    }
    var counts = {}; VIEWS.forEach(function (v) { counts[v[0]] = I.rows.filter(v[2]).length; });
    var seg = h('div', { cls: 'cq-seg', role: 'group', 'aria-label': 'Show' }, VIEWS.map(function (v) {
      return h('button', { type: 'button', 'aria-pressed': I.view === v[0] ? 'true' : 'false', on: { click: function () { I.view = v[0]; I.sel = null; I.compose = null; render(); } } },
        [v[1], counts[v[0]] && v[0] !== 'past' ? h('span', { cls: 'cq-n' + (v[0] === 'spam' ? ' muted' : ''), text: String(counts[v[0]]) }) : null]);
    }));
    var search = h('input', { type: 'search', placeholder: 'Search name, email, event', value: I.q, 'aria-label': 'Search' });
    search.addEventListener('input', function () { I.q = search.value; paintList(); });
    wrap.appendChild(h('div', { cls: 'cq-bar' }, [seg, search]));
    var body = h('div', { cls: 'cq-body' + (I.sel ? ' has-sel' : '') });
    I.listEl = h('div', { cls: 'cq-list', role: 'list' });
    I.detailEl = h('div', { cls: 'cq-detail' });
    body.appendChild(I.listEl); body.appendChild(I.detailEl);
    wrap.appendChild(body);
    paintList(); paintDetail();
  }
  function visible() {
    var f = VIEWS.filter(function (v) { return v[0] === I.view; })[0][2], q = fold(I.q);
    var rows = I.rows.filter(f).filter(function (r) { return !q || fold([r.name, r.email, r.event_name, r.organization, r.phone].join(' ')).indexOf(q) !== -1; });
    if (I.view === 'beos') rows.sort(function (a, b) { return String(a.event_date || '9999') < String(b.event_date || '9999') ? -1 : 1; });
    return rows;
  }
  function paintList() {
    var list = I.listEl; list.innerHTML = '';
    var rows = visible();
    if (!rows.length) {
      list.appendChild(h('p', { cls: 'cq-empty', text: I.q ? 'Nothing matches that search.' : { inquiries: 'No open inquiries.', beos: 'No active BEOs.', past: 'Nothing here yet.', spam: 'No spam.' }[I.view] }));
      return;
    }
    rows.forEach(function (r) {
      var b = I.view === 'beos'
        ? h('button', { type: 'button', role: 'listitem', cls: 'cq-row cq-beo' + (I.sel === r.id ? ' on' : ''), on: { click: function () { pick(r.id); } } }, [
            h('div', { cls: 'cq-date' }, [h('b', { text: parseDay(r.event_date) ? parseDay(r.event_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—' }), h('span', { text: daysTo(r.event_date) })]),
            h('div', { cls: 'cq-bmain' }, [h('b', { text: r.event_name || r.name || '(no name)' }),
              h('div', { cls: 'cq-r2', text: [r.event_name ? r.name : '', r.guests ? r.guests + ' guests' : '', r.location].filter(Boolean).join(' · ') }),
              h('div', { cls: 'cq-r3' }, [h('span', { text: r.beo_saved_at ? 'BEO saved ' + ago(r.beo_saved_at) : 'BEO not opened yet' }), h('span', { text: money(r.estimate) })])])
          ])
        : h('button', { type: 'button', role: 'listitem', cls: 'cq-row' + (I.sel === r.id ? ' on' : ''), on: { click: function () { pick(r.id); } } }, [
            h('div', { cls: 'cq-r1' }, [h('b', { text: r.name || '(no name)' }), h('span', { cls: 'cq-chip cq-' + r.status, text: (STATUS[r.status] || {}).short || r.status })]),
            h('div', { cls: 'cq-r2', text: [r.event_name || r.event_type, longDate(r.event_date), r.guests ? r.guests + ' guests' : ''].filter(Boolean).join(' · ') }),
            h('div', { cls: 'cq-r3' }, [h('span', { text: r.last_message_at ? 'Last email ' + ago(r.last_message_at) : '' }), h('span', { text: 'Received ' + ago(r.created_at) })])
          ]);
      list.appendChild(b);
    });
  }
  function pick(id) {
    I.sel = id; I.compose = null; render();
    if (!I.msgs[id]) loadMsgs(id).then(function () { if (I.sel === id) paintDetail(); });
  }

  function section(title, kids, cls) { return h('section', { cls: 'cq-sec' + (cls ? ' ' + cls : '') }, [h('h3', { text: title })].concat(kids)); }
  function kv(rows) {
    return h('dl', { cls: 'cq-kv' }, rows.filter(function (r) { return r[1]; }).reduce(function (a, r) { a.push(h('dt', { text: r[0] })); a.push(h('dd', null, [r[1]])); return a; }, []));
  }
  function stepper(r) {
    var at = STEPS.indexOf(r.status);
    return h('ol', { cls: 'cq-steps' + (at === -1 ? ' off' : '') }, STEPS.map(function (s, i) {
      return h('li', { cls: i < at ? 'done' : i === at ? 'now' : '' }, [h('i', { text: String(i + 1) }), STATUS[s].label]);
    }));
  }
  function nextStep(r) {
    var box = h('div', { cls: 'cq-next' });
    var add = function (text, btns) { box.appendChild(h('p', null, [text])); box.appendChild(h('div', { cls: 'cq-acts' }, btns)); };
    var btn = function (label, fn, ghost) { return h('button', { type: 'button', cls: 'ed-btn small' + (ghost ? ' ghost' : ''), text: label, on: { click: fn } }); };
    if (r.status === 'new') add('Next: send ' + first(r) + ' the questionnaire link. It opens the full questionnaire with what they sent already filled in.', [btn('Send questionnaire link…', function () { openCompose(r, 'plan'); })]);
    else if (r.status === 'link_sent') add('Waiting for ' + first(r) + ' to finish the questionnaire' + (r.plan_sent_at ? ' (link sent ' + ago(r.plan_sent_at) + ')' : '') + '.', [btn('Send the link again…', function () { openCompose(r, 'plan'); }, true), btn('Copy link', function () { copyLink(r); }, true)]);
    else if (r.status === 'received') add(first(r) + ' finished the questionnaire' + (r.plan_done_at ? ' ' + ago(r.plan_done_at) : '') + '. Review their choices below, then start the BEO.', [btn('Start the BEO', function () { var w = window.open('', '_blank'); save(r, { status: 'beo' }, 'Moved to Active BEOs.').then(function () { addMsg(r, { kind: 'event', subject: 'BEO started' }); openBEO(r, w); I.view = 'beos'; render(); }); }), btn('Copy questionnaire link', function () { copyLink(r); }, true)]);
    else if (r.status === 'beo') add('Active BEO' + (r.event_date ? ' for ' + longDate(r.event_date) + ' (' + daysTo(r.event_date).toLowerCase() + ')' : '') + '. Changes you make in the BEO are saved here automatically.', [btn('Open BEO', function () { openBEO(r); }), btn('Mark completed', function () { save(r, { status: 'completed' }, 'Marked completed.').then(function () { addMsg(r, { kind: 'event', subject: 'Event completed' }); render(); }); }, true)]);
    else if (r.status === 'completed' || r.status === 'declined') add(r.status === 'completed' ? 'This event is completed.' : 'This inquiry was declined or lost.', [r.beo_doc || (r.beo && Object.keys(r.beo).length) ? btn('Open BEO', function () { openBEO(r); }, true) : null, btn('Reopen', function () { save(r, { status: r.beo_doc ? 'beo' : (r.plan_done_at ? 'received' : 'new') }, 'Reopened.').then(render); }, true)]);
    else if (r.status === 'spam') add('Filed as spam.', [btn('Not spam', function () { save(r, { status: 'new' }, 'Moved to Inquiries.').then(function () { I.view = 'inquiries'; render(); }); })]);
    return box;
  }
  function paintDetail() {
    var d = I.detailEl; if (!d) return; d.innerHTML = '';
    var r = cur();
    if (!r) { d.appendChild(h('p', { cls: 'cq-pick', text: I.rows.length ? 'Choose an inquiry or BEO to see the details and the conversation.' : 'Inquiries from the website will appear here.' })); return; }
    var st = h('select', { 'aria-label': 'Stage' }, Object.keys(STATUS).map(function (k) { return h('option', { value: k, text: STATUS[k].label }); }));
    st.value = r.status;
    st.addEventListener('change', function () { save(r, { status: st.value }, 'Moved to ' + STATUS[st.value].label + '.').then(function () { addMsg(r, { kind: 'event', subject: 'Moved to ' + STATUS[st.value].label }); render(); }); });
    d.appendChild(h('div', { cls: 'cq-dh' }, [
      h('button', { type: 'button', cls: 'cq-back', text: '← Back to the list', on: { click: function () { I.sel = null; render(); } } }),
      h('h2', { text: r.name || '(no name)' }),
      h('p', { cls: 'cq-when', text: [r.event_name, longDate(r.event_date), r.guests ? r.guests + ' guests' : ''].filter(Boolean).join(' · ') + ' · received ' + stamp(r.created_at) }),
      stepper(r),
      h('label', { cls: 'cq-st' }, ['Stage', st])
    ]));
    if (r.flags && r.flags.length && r.status === 'spam') d.appendChild(h('div', { cls: 'cq-flags' }, [h('b', { text: 'Filed as spam because:' }), h('ul', null, r.flags.map(function (f) { return h('li', { text: flagText(f) }); }))]));
    d.appendChild(nextStep(r));
    // details
    d.appendChild(section('Contact', [kv([
      ['Email', r.email ? h('a', { href: 'mailto:' + r.email, text: r.email }) : null],
      ['Phone', r.phone ? h('a', { href: 'tel:' + r.phone.replace(/[^\d+]/g, ''), text: r.phone }) : null],
      ['Organization', r.organization]
    ])]));
    var t = [time12(r.start_time), time12(r.end_time)].filter(Boolean).join('–');
    d.appendChild(section('Event', [kv([
      ['Event', r.event_name], ['Type', r.event_type], ['Date', longDate(r.event_date)], ['Time', t], ['Guests', r.guests ? String(r.guests) : ''], ['Where', r.location],
      ['Estimate', money(r.estimate) ? money(r.estimate) + ' (from the questionnaire; beverages not included)' : '']
    ])]));
    var sum = (r.summary || []).filter(function (s) { return s && s[0] && s[1] && s[1].length; });
    if (sum.length) d.appendChild(section('Their choices', sum.map(function (s) { return h('div', { cls: 'cq-choice' }, [h('b', { text: s[0] }), h('ul', { cls: 'cq-ul' }, s[1].map(function (l) { return h('li', { text: l }); }))]); })));
    else if (r.status === 'new' || r.status === 'link_sent') d.appendChild(section('Their choices', [h('p', { cls: 'cq-muted', text: 'Menu choices arrive when ' + first(r) + ' finishes the questionnaire.' })]));
    if (r.guest_notes) d.appendChild(section('Their notes', [h('p', { cls: 'cq-msg', text: r.guest_notes })]));
    d.appendChild(conversation(r));
    var note = h('textarea', { rows: 3, placeholder: 'Notes for the team (not sent to the guest)' }); note.value = r.staff_note || '';
    note.addEventListener('change', function () { save(r, { staff_note: note.value }, 'Note saved.'); });
    d.appendChild(section('Team notes', [note]));
    // more
    var more = h('div', { cls: 'cq-acts cq-more' });
    if (window.EdenCal && r.status !== 'beo') more.appendChild(h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Add to calendar', on: { click: function () { toCalendar(r); } } }));
    if (r.beo_doc || (r.beo && Object.keys(r.beo).length)) more.appendChild(h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Open BEO', on: { click: function () { openBEO(r); } } }));
    more.appendChild(h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Download answers', on: { click: function () { download(r); } } }));
    if (I.ctx.canDelete) more.appendChild(h('button', { type: 'button', cls: 'cq-del', text: 'Delete', on: { click: function () { del(r); } } }));
    d.appendChild(more);
  }

  /* ---------- the conversation ---------- */
  function conversation(r) {
    var msgs = I.msgs[r.id];
    var box = section('Conversation with ' + first(r), [], 'cq-conv');
    if (!msgs) { box.appendChild(h('p', { cls: 'cq-muted', text: 'Loading…' })); return box; }
    var list = h('ol', { cls: 'cq-thread' });
    if (!msgs.length) list.appendChild(h('li', { cls: 'cq-ev', text: 'Nothing yet.' }));
    msgs.forEach(function (m) {
      if (m.kind === 'event') { list.appendChild(h('li', { cls: 'cq-ev' }, [h('span', { text: m.subject + (m.by_name ? ' · ' + m.by_name : '') }), h('time', { text: stamp(m.at) })])); return; }
      var who = m.kind === 'out' ? (m.by_name || 'Eden') + ' → ' + first(r) : m.kind === 'in' ? (r.name || 'Guest') + ' → Eden' : 'Note' + (m.by_name ? ' · ' + m.by_name : '');
      var state = m.kind === 'out' ? (m.mail_status === 'sent' ? 'Emailed' : m.mail_status === 'failed' ? 'Couldn’t send' : m.mail_status === 'sending' ? 'Sending…' : 'Sent from your own email') : m.kind === 'in' ? (m.mail_status === 'received' ? 'Email reply' : 'Logged by hand') : '';
      list.appendChild(h('li', { cls: 'cq-m cq-' + m.kind + (m.mail_status === 'failed' ? ' failed' : '') }, [
        h('div', { cls: 'cq-mh' }, [h('b', { text: who }), h('span', { text: [state, stamp(m.at)].filter(Boolean).join(' · ') })]),
        m.subject ? h('div', { cls: 'cq-ms', text: m.subject }) : null,
        m.body ? h('div', { cls: 'cq-mb', text: m.body }) : null
      ]));
    });
    box.appendChild(list);
    if (I.compose && I.compose.id === r.id) box.appendChild(composer(r));
    else box.appendChild(h('div', { cls: 'cq-acts' }, [
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Email ' + first(r) + '…', on: { click: function () { openCompose(r, 'message'); } } }),
      h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Log a call or email…', on: { click: function () { openCompose(r, 'log'); } } })
    ]));
    setTimeout(function () { list.scrollTop = list.scrollHeight; }, 0);
    return box;
  }
  function openCompose(r, mode) {
    var msgs = I.msgs[r.id] || [], lastSub = '';
    msgs.forEach(function (m) { if ((m.kind === 'in' || m.kind === 'out') && m.subject) lastSub = m.subject; });
    // the writer's sign-off from Business email (Email sign-off); without one, their name and Eden Hospitality
    var so = I.sig && (I.sig.line1 || I.sig.line2 || I.sig.line3) ? [I.sig.line1, I.sig.line2, I.sig.line3].filter(Boolean) : [I.ctx.name || '', 'Eden Hospitality'].filter(Boolean);
    var sign = '\n\n' + so.join('\n');
    if (mode === 'plan') I.compose = { id: r.id, mode: mode, subject: 'Planning your event at Eden',
      body: 'Hi ' + first(r) + ',\n\nThank you for your interest in hosting ' + (r.event_name || 'your event') + ' at Eden' + (r.event_date ? ' on ' + longDate(r.event_date) : '') + '. Please use the link below to plan your menu and the details of your event. We’ve already filled in what you sent us, and you’ll see an estimate as you choose.\n\n{link}\n\nWe look forward to working with you.' + sign };
    else if (mode === 'message') I.compose = { id: r.id, mode: mode, subject: lastSub ? (/^re:/i.test(lastSub) ? lastSub : 'Re: ' + lastSub) : 'Your event at Eden', body: 'Hi ' + first(r) + ',\n\n' + sign };
    else I.compose = { id: r.id, mode: 'log', dir: 'in', subject: '', body: '' };
    paintDetail();
    var ta = I.detailEl.querySelector('.cq-compose textarea'); if (ta) { ta.focus(); try { ta.setSelectionRange(ta.value.indexOf(',\n\n') + 3, ta.value.indexOf(',\n\n') + 3); } catch (e) {} }
    var c = I.detailEl.querySelector('.cq-compose'); if (c && c.scrollIntoView) c.scrollIntoView({ block: 'nearest' });
  }
  function composer(r) {
    var c = I.compose, mail = I.health && I.health.mail;
    var subj = h('input', { type: 'text', value: c.subject, 'aria-label': 'Subject', placeholder: 'Subject' });
    var body = h('textarea', { rows: c.mode === 'log' ? 5 : 10, 'aria-label': 'Message' }); body.value = c.body;
    subj.addEventListener('input', function () { c.subject = subj.value; });
    body.addEventListener('input', function () { c.body = body.value; });
    var box = h('div', { cls: 'cq-compose' });
    var title = c.mode === 'plan' ? 'Send the questionnaire link to ' + r.email : c.mode === 'message' ? 'Email ' + r.email : 'Log a call or email';
    box.appendChild(h('b', { cls: 'cq-ct', text: title }));
    if (c.mode === 'log') {
      var dir = h('select', { 'aria-label': 'Which way' }, [h('option', { value: 'in', text: 'From ' + first(r) + ' to us' }), h('option', { value: 'out', text: 'From us to ' + first(r) }), h('option', { value: 'note', text: 'A phone call or other note' })]);
      dir.value = c.dir; dir.addEventListener('change', function () { c.dir = dir.value; });
      box.appendChild(h('div', { cls: 'cq-crow' }, [dir, subj]));
      body.placeholder = 'Paste the email, or write what was said';
    } else box.appendChild(subj);
    box.appendChild(body);
    if (c.mode === 'plan') box.appendChild(h('p', { cls: 'cq-hint', text: 'The link goes where it says {link}' + (mail ? ', as a “Plan your event” button.' : '.') }));
    var err = h('p', { cls: 'cq-err', role: 'alert' });
    var acts = h('div', { cls: 'cq-acts' });
    var cancel = h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Cancel', on: { click: function () { I.compose = null; paintDetail(); } } });
    if (c.mode === 'log') {
      acts.appendChild(h('button', { type: 'button', cls: 'ed-btn small', text: 'Save to the conversation', on: { click: function () {
        if (!c.body.trim() && !c.subject.trim()) { err.textContent = 'Write something first.'; return; }
        addMsg(r, { kind: c.dir, subject: c.subject.trim(), body: c.body.trim(), from_addr: c.dir === 'in' ? r.email : '', to_addr: c.dir === 'out' ? r.email : '' }).then(function (ok) { if (ok) { I.compose = null; I.ctx.status('Saved to the conversation.', 'ok'); paintDetail(); } });
      } } }));
    } else if (mail) {
      var send = h('button', { type: 'button', cls: 'ed-btn small', text: 'Send email', on: { click: function () { sendEmail(r, c, send, err); } } });
      acts.appendChild(send);
    } else {
      // email isn't set up on the staff site yet: use their own email program, and log it here
      acts.appendChild(h('button', { type: 'button', cls: 'ed-btn small', text: 'Open in my email app', on: { click: function () { viaOwnEmail(r, c, err); } } }));
      if (c.mode === 'plan') acts.appendChild(h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Copy link', on: { click: function () { copyLink(r); } } }));
      box.appendChild(h('p', { cls: 'cq-hint', text: 'Email sending from the staff site isn’t set up yet, so this opens your own email program with the message ready, and saves it to the conversation.' }));
    }
    acts.appendChild(cancel);
    box.appendChild(err); box.appendChild(acts);
    return box;
  }
  function planLink(r) {
    if (r.plan_token) return Promise.resolve(GUEST + '#plan-' + r.plan_token);
    return I.ctx.sb.rpc('create_plan_link', { p_id: r.id }).then(function (x) {
      if (x.error || !x.data) throw new Error((x.error && x.error.message) || 'no link');
      r.plan_token = x.data;
      if (I.msgs[r.id]) I.msgs[r.id].push({ id: 'l' + Date.now(), kind: 'event', subject: 'Questionnaire link created', by_name: I.ctx.name || '', at: new Date().toISOString() });
      return GUEST + '#plan-' + x.data;
    });
  }
  function copyLink(r) {
    planLink(r).then(function (link) {
      var done = function () { I.ctx.status('Questionnaire link copied. It opens ' + first(r) + '’s questionnaire, already filled in.', 'ok'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(link).then(done, function () { window.prompt('Copy this link:', link); });
      else window.prompt('Copy this link:', link);
    }, function () { I.ctx.status('Couldn’t make the link.', 'err'); });
  }
  function sendEmail(r, c, btn, err) {
    err.textContent = '';
    if (!c.subject.trim() || !c.body.trim()) { err.textContent = 'Add a subject and a message.'; return; }
    btn.disabled = true; btn.textContent = 'Sending…';
    token().then(function (jwt) {
      return fetch('admin/send', { method: 'POST', headers: { 'content-type': 'application/json', 'authorization': 'Bearer ' + jwt },
        body: JSON.stringify({ id: r.id, plan: c.mode === 'plan', subject: c.subject.trim(), body: c.body, by_name: I.ctx.name || '' }) });
    }).then(function (x) { return x.json().catch(function () { return {}; }).then(function (j) { return { ok: x.ok, j: j }; }); }).then(function (res) {
      if (!res.ok || !res.j.ok) { err.textContent = (res.j && res.j.message) || 'The email couldn’t be sent.'; btn.disabled = false; btn.textContent = 'Send email'; loadMsgs(r.id).then(function () { if (I.sel === r.id) paintDetail(); }); return; }
      if (c.mode === 'plan') { if (r.status === 'new') r.status = 'link_sent'; r.plan_sent_at = new Date().toISOString(); }
      r.last_message_at = new Date().toISOString();
      I.compose = null; I.ctx.status('Email sent to ' + r.email + '.', 'ok');
      return load().then(function () { return loadMsgs(r.id); }).then(render);
    }, function () { err.textContent = 'Couldn’t reach the staff site.'; btn.disabled = false; btn.textContent = 'Send email'; });
  }
  function viaOwnEmail(r, c, err) {
    var p = c.mode === 'plan' ? planLink(r) : Promise.resolve('');
    p.then(function (link) {
      var text = c.body.indexOf('{link}') !== -1 ? c.body.split('{link}').join(link) : (link ? c.body + '\n\n' + link : c.body);
      window.location.href = 'mailto:' + encodeURIComponent(r.email) + '?subject=' + encodeURIComponent(c.subject) + '&body=' + encodeURIComponent(text);
      return addMsg(r, { kind: 'out', to_addr: r.email, subject: c.subject, body: text, mail_status: 'manual' }).then(function () {
        if (c.mode === 'plan') return save(r, r.status === 'new' ? { status: 'link_sent', plan_sent_at: new Date().toISOString() } : { plan_sent_at: new Date().toISOString() });
      }).then(function () { I.compose = null; I.ctx.status('Opened in your email program and saved to the conversation.', 'ok'); render(); });
    }, function () { err.textContent = 'Couldn’t make the questionnaire link.'; });
  }

  /* ---------- the BEO, saved with the event ----------
     The BEO form keeps its work in this browser under 'eden-beo-doc-<id>'. Every change is copied to the
     database here, so the BEO is the same on every computer. */
  var DOCK = 'eden-beo-doc-', SYNC = 'eden-beo-sync-'; var OPEN = 'eden-beo-open-', BEO_V = '20261019a';
  function ls(k, v) { try { if (v === undefined) return localStorage.getItem(k); if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { return null; } }
  function pushBeo(r, text) {
    var data; try { data = JSON.parse(text); } catch (e) { return Promise.resolve(); }
    return save(r, { beo_doc: data, beo_saved_at: new Date().toISOString() }).then(function (ok) { if (ok) { ls(SYNC + r.id, text); if (r.status === 'beo') calSync(r, true); if (I.view === 'beos') paintList(); } });
  }
  function syncBeo(r) {   // before opening: settle which copy is newer
    var local = ls(DOCK + r.id), synced = ls(SYNC + r.id), db = r.beo_doc ? JSON.stringify(r.beo_doc) : null;
    if (local && local !== synced) return pushBeo(r, local);            // edits here that haven't reached the database yet
    if (local && db && db !== local) { ls(DOCK + r.id, null); ls(SYNC + r.id, db); }   // the database has newer edits (another computer)
    return Promise.resolve();
  }
  function syncAllBeos() { I.rows.forEach(function (r) { var l = ls(DOCK + r.id); if (l && l !== ls(SYNC + r.id)) pushBeo(r, l); }); }
  var beoTimers = {};
  window.addEventListener('storage', function (e) {
    if (!e.key || e.key.indexOf(DOCK) !== 0 || !e.newValue) return;
    var id = e.key.slice(DOCK.length), r = I.rows.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    clearTimeout(beoTimers[id]);
    beoTimers[id] = setTimeout(function () { pushBeo(r, e.newValue).then(function () { I.ctx.status('BEO saved.', 'ok'); }); }, 1200);
  });
  function openBEO(r, pre) {
    // Open the BEO form at its own address (writing the page into a blank window left it half-loaded in some
    // browsers). The form reads this BEO from the browser's storage, and its edits come back here through the
    // storage listener above.
    var w = pre || window.open('', '_blank');
    syncBeo(r).then(function () {
      var data = r.beo_doc || r.beo || {};
      ls(OPEN + r.id, JSON.stringify({ id: r.id, data: data, title: String(data['ev.name'] || r.event_name || r.name || 'Event').trim() + ' BEO' }));
      var url = 'templates/beo-form.html?v=' + BEO_V + '#beo=' + encodeURIComponent(r.id);
      if (w && !w.closed) w.location.href = url; else location.href = url;
      if (!r.beo_doc) pushBeo(r, JSON.stringify(data));   // the starting point is saved too
    }).catch(function () { if (w) w.close(); I.ctx.status('Couldn’t open the BEO form.', 'err'); });
  }

  /* ---------- other actions ---------- */
  function toCalendar(r) {
    var bits = [r.guests ? r.guests + ' guests' : '', r.email, r.phone, money(r.estimate) ? 'Est. ' + money(r.estimate) : ''].filter(Boolean).join(' · ');
    var pre = {
      title: r.event_name || ((r.name || 'Guest') + ' event'), type: r.location && !/3rd Floor|Palladian|Restaurant/i.test(r.location) ? 'catering' : 'private',
      start: (r.start_time || '').slice(0, 5), end: (r.end_time || '').slice(0, 5), all_day: !r.start_time,
      room: r.location || '', guests: r.guests || null, notes: 'From catering inquiry: ' + (r.name || '') + (bits ? '\n' + bits : ''), source: 'inquiry', beo_id: r.id
    };
    if (r.event_date) pre.date = String(r.event_date).slice(0, 10);
    window.EdenCal.addEvent({ sb: I.ctx.sb, status: I.ctx.status, name: I.ctx.name, canEdit: true }, pre);
  }
  function download(r) {
    var label = (r.event_name || r.name || 'Event').trim();
    var name = ('Eden selections - ' + label).replace(/[\\/:*?"<>|]+/g, '').replace(/\s+/g, ' ').trim() + '.json';
    var blob = new Blob([JSON.stringify({ eden: 'beo-questionnaire', v: 2, saved: r.created_at, beo: r.beo, answers: r.answers }, null, 1)], { type: 'application/json' });
    var a = h('a', { href: URL.createObjectURL(blob), download: name }); document.body.appendChild(a); a.click(); a.remove();
  }
  function del(r) {
    if (!window.confirm('Delete ' + (r.name || 'this inquiry') + ', its BEO and its conversation? This can’t be undone.')) return;
    I.ctx.sb.from('catering_inquiries').delete().eq('id', r.id).then(function (x) {
      if (x.error) { I.ctx.status('Couldn’t delete it.', 'err'); return; }
      I.rows = I.rows.filter(function (y) { return y.id !== r.id; }); I.sel = null; ls(DOCK + r.id, null); ls(SYNC + r.id, null); calRemove(r);
      I.ctx.status('Deleted.', 'ok'); render();
    });
  }

  /* ---------- is everything connected? (asks this site's worker, which also tests the database) ---------- */
  function checkHealth() {
    if (I.healthP) return I.healthP;
    I.healthP = fetch('inquiry/config?check=1', { cache: 'no-store' }).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
      .then(function (c) { I.health = c; return c; });
    return I.healthP;
  }
  function paintHealth() {
    var el = I.healthEl; if (!el) return;
    var c = I.health;
    if (c === undefined) { checkHealth().then(function () { paintHealth(); if (I.compose) paintDetail(); }); return; }
    el.innerHTML = '';
    if (!c || typeof c.ready !== 'boolean') { el.hidden = true; return; }
    el.hidden = false;
    var bad = '';
    if (!c.keySet) bad = 'Cloudflare doesn’t have the INQUIRY_KEY secret on eden-admin yet (Workers & Pages → eden-admin → Settings → Variables and Secrets → Add → Secret, then Deploy).' + (c.settings ? ' Settings eden-admin can see right now: ' + c.settings.join(', ') + '.' : '');
    else if (!c.keyLooksRight) bad = 'The INQUIRY_KEY secret in Cloudflare doesn’t look like the 64-character code from Supabase. Paste the code again.';
    else if (c.db === 'missing_sql') bad = 'The database setup hasn’t been run yet, or needs running again: run supabase/inquiries.sql in Supabase.';
    else if (c.db === 'key_mismatch') bad = 'The INQUIRY_KEY in Cloudflare doesn’t match the database. In Supabase run  select public.new_inquiry_key();  again and paste the new code into the INQUIRY_KEY secret.';
    else if (c.db && c.db !== 'ok') bad = 'The database couldn’t be reached just now (' + c.db + '). Try again in a minute.';
    if (bad) {
      el.className = 'cq-health off';
      el.appendChild(h('b', { text: 'Website inquiries: not arriving here yet. ' }));
      el.appendChild(document.createTextNode(bad + ' Until then, the website offers guests email instead.'));
    } else {
      el.className = 'cq-health on';
      el.appendChild(h('b', { text: 'Website inquiries arrive here ✓ ' }));
      el.appendChild(document.createTextNode([c.mail ? 'emails send from the staff site' : 'email sending not set up yet (use your own email; it’s still logged here)',
        c.inbound ? 'guests’ replies come back here' : 'replies go to your inbox (log them here by hand)',
        c.turnstile ? 'Turnstile on' : 'Turnstile not set up yet'].join(' · ') + '.'));
    }
  }

  window.EdenInquiries = {
    // open one BEO from elsewhere (the Calendar's event box). w: a tab opened in the click itself, so it isn't blocked
    openBeoById: function (id, ctx, w) {
      if (!I.ctx) I.ctx = ctx;
      var have = I.rows.filter(function (x) { return x.id === id; })[0];
      (have ? Promise.resolve(have) : I.ctx.sb.from('catering_inquiries').select('*').eq('id', id).then(function (r) {
        var row = !r.error && r.data && r.data[0];
        if (row && !I.rows.some(function (x) { return x.id === id; })) I.rows.push(row);   // so edits in the BEO tab save back
        return row;
      })).then(function (row) {
        if (!row) { if (w) w.close(); (ctx.status || function () {})('Couldn’t find that BEO. It may have been deleted.', 'err'); return; }
        openBEO(row, w);
      }, function () { if (w) w.close(); (ctx.status || function () {})('Couldn’t reach the database.', 'err'); });
    },
    show: function (ctx) {
      I.ctx = ctx; I.el = ctx.el;
      if (I.sig === undefined && ctx.uid) { I.sig = null; ctx.sb.from('mail_signatures').select('line1,line2,line3').eq('user_id', ctx.uid).maybeSingle().then(function (r) { if (r && r.data) I.sig = r.data; }, function () {}); }
      render();
      load().then(function () { render(); if (I.sel && !I.msgs[I.sel]) loadMsgs(I.sel).then(paintDetail); });
    }
  };
})();
