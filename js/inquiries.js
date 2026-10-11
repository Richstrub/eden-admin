/* Eden staff site: Catering & BEOs > Inquiries (Owner and managers).
 * Catering questionnaires sent from edencny.com arrive here (worker.js screens out bots first and,
 * when email is set up, waits for the guest to confirm their address). From an inquiry you can email
 * the guest, open it as a banquet event order, put it on the calendar, and track where it stands. */
(function () {
  'use strict';
  var STATUS = {
    unconfirmed: { label: 'Waiting for email confirmation', short: 'Unconfirmed' },
    'new': { label: 'New: needs a reply', short: 'New' },
    contacted: { label: 'Contacted: in progress', short: 'Contacted' },
    booked: { label: 'Booked', short: 'Booked' },
    declined: { label: 'Declined or lost', short: 'Declined' },
    spam: { label: 'Spam', short: 'Spam' }
  };
  var VIEWS = [
    ['open', 'Needs a reply', function (r) { return r.status === 'new'; }],
    ['progress', 'In progress', function (r) { return r.status === 'contacted'; }],
    ['booked', 'Booked', function (r) { return r.status === 'booked'; }],
    ['all', 'All', function (r) { return r.status !== 'spam' && r.status !== 'unconfirmed'; }],
    ['unconfirmed', 'Unconfirmed', function (r) { return r.status === 'unconfirmed'; }],
    ['spam', 'Spam & declined', function (r) { return r.status === 'spam' || r.status === 'declined'; }]
  ];
  var FLAGS = {
    'trap-field': 'Filled in a hidden field that only bots see',
    'too-fast': 'Sent within seconds of opening the questionnaire',
    'links': 'Several web links in the message',
    'script': 'Name or message in an unexpected alphabet',
    'email-not-sent': 'Our confirmation email couldn’t be sent, so the email address isn’t verified'
  };
  var I = { ctx: null, el: null, rows: [], loaded: false, missing: false, view: 'open', sel: null, q: '' };

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
  function parseDay(x) { var p = String(x || '').slice(0, 10).split('-'); return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]) : null; }
  function longDate(x) { var d = parseDay(x); return d ? d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
  function ago(x) {
    var d = new Date(x), s = (Date.now() - d) / 1000;
    if (s < 3600) return Math.max(1, Math.round(s / 60)) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' hr ago';
    if (s < 86400 * 7) return Math.round(s / 86400) + ' day' + (Math.round(s / 86400) === 1 ? '' : 's') + ' ago';
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  function money(n) { return n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
  function time12(t) { var m = /^(\d{1,2}):(\d{2})/.exec(t || ''); if (!m) return ''; var hh = +m[1], ap = hh >= 12 ? 'pm' : 'am'; hh = hh % 12 || 12; return hh + (m[2] === '00' ? '' : ':' + m[2]) + ap; }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }

  function load() {
    return I.ctx.sb.from('catering_inquiries').select('*').order('created_at', { ascending: false }).then(function (r) {
      I.loaded = true;
      if (r.error) { I.missing = isMissing(r.error); if (!I.missing) I.ctx.status('Couldn’t load inquiries.', 'err'); I.rows = []; return; }
      I.missing = false; I.rows = r.data || [];
    }, function () { I.loaded = true; I.ctx.status('Couldn’t reach the database.', 'err'); });
  }
  function save(row, patch, msg) {
    Object.assign(row, patch);
    return I.ctx.sb.from('catering_inquiries').update(patch).eq('id', row.id).then(function (r) {
      if (r.error) { I.ctx.status('Couldn’t save that change. ' + (r.error.message || ''), 'err'); return false; }
      I.ctx.status(msg || 'Saved.', 'ok'); return true;
    });
  }

  function render() {
    var el = I.el; el.innerHTML = '';
    var wrap = h('div', { cls: 'cq-in' }); el.appendChild(wrap);
    wrap.appendChild(h('div', { cls: 'cq-title' }, [
      h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Catering & BEOs' }), h('h1', { cls: 'sc-week', text: 'Inquiries' })]),
      h('p', { cls: 'cq-sub', text: 'Catering questionnaires sent from edencny.com. Bots are screened out before they get here; anything that still looks automated goes to Spam.' })
    ]));
    if (!I.loaded) { wrap.appendChild(h('p', { cls: 'cq-empty', text: 'Loading…' })); return; }
    if (I.missing) {
      wrap.appendChild(h('div', { cls: 'iv-setup' }, [h('p', { text: 'Online inquiries aren’t switched on yet. In Supabase, open SQL Editor → New query, paste the contents of supabase/inquiries.sql from the eden-admin repository, and click Run. The README lists the remaining steps (the inquiry key, Turnstile and email). Until then, guests email their questionnaire file to you as before.' })]));
      return;
    }
    // filters
    var counts = {}; VIEWS.forEach(function (v) { counts[v[0]] = I.rows.filter(v[2]).length; });
    var seg = h('div', { cls: 'cq-seg', role: 'group', 'aria-label': 'Show' }, VIEWS.map(function (v) {
      return h('button', { type: 'button', 'aria-pressed': I.view === v[0] ? 'true' : 'false', on: { click: function () { I.view = v[0]; I.sel = null; render(); } } },
        [v[1], counts[v[0]] ? h('span', { cls: 'cq-n', text: String(counts[v[0]]) }) : null]);
    }));
    var search = h('input', { type: 'search', placeholder: 'Search name, email, event', value: I.q, 'aria-label': 'Search inquiries' });
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
    return I.rows.filter(f).filter(function (r) { return !q || fold([r.name, r.email, r.event_name, r.organization, r.phone].join(' ')).indexOf(q) !== -1; });
  }
  function paintList() {
    var list = I.listEl; list.innerHTML = '';
    var rows = visible();
    if (!rows.length) {
      list.appendChild(h('p', { cls: 'cq-empty', text: I.q ? 'No inquiries match that search.' : I.view === 'open' ? 'Nothing waiting for a reply.' : 'None here.' }));
      return;
    }
    rows.forEach(function (r) {
      var b = h('button', { type: 'button', role: 'listitem', cls: 'cq-row' + (I.sel === r.id ? ' on' : ''), on: { click: function () { I.sel = r.id; render(); } } }, [
        h('div', { cls: 'cq-r1' }, [h('b', { text: r.name || '(no name)' }), h('span', { cls: 'cq-chip cq-' + r.status, text: (STATUS[r.status] || {}).short || r.status })]),
        h('div', { cls: 'cq-r2', text: [r.event_name || r.event_type, longDate(r.event_date), r.guests ? r.guests + ' guests' : ''].filter(Boolean).join(' · ') }),
        h('div', { cls: 'cq-r3' }, [h('span', { text: money(r.estimate) ? 'Est. ' + money(r.estimate) : '' }), h('span', { text: 'Received ' + ago(r.created_at) })])
      ]);
      list.appendChild(b);
    });
  }
  function section(title, kids) { return h('section', { cls: 'cq-sec' }, [h('h3', { text: title })].concat(kids)); }
  function kv(rows) {
    return h('dl', { cls: 'cq-kv' }, rows.filter(function (r) { return r[1]; }).reduce(function (a, r) { a.push(h('dt', { text: r[0] })); a.push(h('dd', null, [r[1]])); return a; }, []));
  }
  function paintDetail() {
    var d = I.detailEl; d.innerHTML = '';
    var r = I.rows.filter(function (x) { return x.id === I.sel; })[0];
    if (!r) { d.appendChild(h('p', { cls: 'cq-pick', text: I.rows.length ? 'Choose an inquiry to see the details.' : 'Inquiries from the website will appear here.' })); return; }
    var st = h('select', { 'aria-label': 'Status' }, Object.keys(STATUS).filter(function (k) { return k !== 'unconfirmed' || r.status === 'unconfirmed'; }).map(function (k) { return h('option', { value: k, text: STATUS[k].label }); }));
    st.value = r.status;
    st.addEventListener('change', function () { save(r, { status: st.value }, 'Marked ' + STATUS[st.value].short.toLowerCase() + '.').then(function () { render(); }); });
    var subj = 'Your event at Eden' + (r.event_date ? ' on ' + longDate(r.event_date) : '');
    d.appendChild(h('div', { cls: 'cq-dh' }, [
      h('button', { type: 'button', cls: 'cq-back', text: '← All inquiries', on: { click: function () { I.sel = null; render(); } } }),
      h('h2', { text: r.name || '(no name)' }),
      h('p', { cls: 'cq-when', text: 'Received ' + new Date(r.created_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + (r.confirmed_at ? ' · email confirmed' : r.status === 'unconfirmed' ? ' · email not confirmed yet' : '') }),
      h('label', { cls: 'cq-st' }, ['Status', st])
    ]));
    if (r.flags && r.flags.length) d.appendChild(h('div', { cls: 'cq-flags' }, [h('b', { text: r.status === 'spam' ? 'Filed as spam because:' : 'Note:' }), h('ul', null, r.flags.map(function (f) { return h('li', { text: FLAGS[f] || f }); }))]));
    if (r.status === 'unconfirmed') d.appendChild(h('div', { cls: 'cq-flags soft' }, [h('span', { text: 'The guest hasn’t clicked the confirmation link we emailed yet. Many unconfirmed inquiries are fake addresses or people who weren’t serious; a real one may also be sitting in their spam folder.' })]));
    // actions
    var acts = h('div', { cls: 'cq-acts' });
    if (r.email) acts.appendChild(h('a', { cls: 'ed-btn small', href: 'mailto:' + encodeURIComponent(r.email) + '?subject=' + encodeURIComponent(subj) + '&body=' + encodeURIComponent('Hi ' + String(r.name || '').split(' ')[0] + ',\n\nThank you for your interest in hosting your event at Eden. '), text: 'Email guest' }));
    if (r.beo && Object.keys(r.beo).length) acts.appendChild(h('button', { type: 'button', cls: 'ed-btn small', text: 'Open as BEO', on: { click: function () { openBEO(r); } } }));
    if (window.EdenCal) acts.appendChild(h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Add to calendar', on: { click: function () { toCalendar(r); } } }));
    acts.appendChild(h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Download answers', on: { click: function () { download(r); } } }));
    if (r.status === 'spam') acts.appendChild(h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Not spam', on: { click: function () { save(r, { status: 'new' }, 'Moved to Needs a reply.').then(function () { I.view = 'open'; render(); }); } } }));
    if (I.ctx.canDelete) acts.appendChild(h('button', { type: 'button', cls: 'cq-del', text: 'Delete', on: { click: function () { del(r); } } }));
    d.appendChild(acts);
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
    (r.summary || []).forEach(function (s) { if (s && s[0] && s[1] && s[1].length) d.appendChild(section(s[0], [h('ul', { cls: 'cq-ul' }, s[1].map(function (l) { return h('li', { text: l }); }))])); });
    if (r.guest_notes) d.appendChild(section('Their message', [h('p', { cls: 'cq-msg', text: r.guest_notes })]));
    var note = h('textarea', { rows: 3, placeholder: 'Notes for the team: calls, follow-ups, decisions…' }); note.value = r.staff_note || '';
    note.addEventListener('change', function () { save(r, { staff_note: note.value }, 'Note saved.'); });
    d.appendChild(section('Team notes', [note]));
  }

  function openBEO(r) {
    var w = window.open('', '_blank');
    fetch('templates/beo-form.html', { cache: 'no-cache' }).then(function (x) { if (!x.ok) throw new Error('beo'); return x.text(); }).then(function (html) {
      var inject = '<script id="beo-data">window.__BEO_IMPORT=' + JSON.stringify(r.beo).replace(/</g, '\\u003c') + ';<\/script>';
      var doc = html.replace(/<head>/i, '<head>' + inject);
      if (w) { w.document.open(); w.document.write(doc); w.document.close(); }
      else location.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
      if (r.status === 'new') save(r, { status: 'contacted' }, 'Opened the BEO and marked this inquiry Contacted.').then(function () { render(); });
    }).catch(function () { if (w) w.close(); I.ctx.status('Couldn’t open the BEO form.', 'err'); });
  }
  function toCalendar(r) {
    var bits = [r.guests ? r.guests + ' guests' : '', r.email, r.phone, money(r.estimate) ? 'Est. ' + money(r.estimate) : ''].filter(Boolean).join(' · ');
    var pre = {
      title: r.event_name || ((r.name || 'Guest') + ' event'), type: r.location && !/3rd Floor|Palladian|Restaurant/i.test(r.location) ? 'catering' : 'private',
      start: (r.start_time || '').slice(0, 5), end: (r.end_time || '').slice(0, 5), all_day: !r.start_time,
      room: r.location || '', guests: r.guests || null, notes: 'From catering inquiry: ' + (r.name || '') + (bits ? '\n' + bits : ''), source: 'inquiry'
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
    if (!window.confirm('Delete the inquiry from ' + (r.name || 'this guest') + '? This can’t be undone.')) return;
    I.ctx.sb.from('catering_inquiries').delete().eq('id', r.id).then(function (x) {
      if (x.error) { I.ctx.status('Couldn’t delete it.', 'err'); return; }
      I.rows = I.rows.filter(function (y) { return y.id !== r.id; }); I.sel = null; I.ctx.status('Deleted.', 'ok'); render();
    });
  }

  window.EdenInquiries = {
    show: function (ctx) {
      I.ctx = ctx; I.el = ctx.el;
      render();
      load().then(render);
    }
  };
})();
