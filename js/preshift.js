/* Eden staff site: Pre-shift meeting (everyone can read it).
 *
 * 1. Reservations: filled in automatically from OpenTable's email to rich@edencny.com (see preshift-worker.js).
 *    Today's pre-shift appears once that day's OpenTable email has arrived, and clears after midnight.
 * More sections (specials, 86'd, wine, notes from managers) come next.
 */
(function () {
  'use strict';
  var P = { ctx: null, el: null, day: null, busy: false, checked: '' };
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
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function t12(t) { var p = String(t || '').split(':'), H = +p[0], M = +p[1] || 0; return (H % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H >= 12 ? 'pm' : 'am'); }
  function when(ts) { return ts ? new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  function isMgr() { var r = P.ctx.role; return r === 'owner' || r === 'manager' || r === 'scheduler'; }
  function token() { return P.ctx.sb.auth.getSession().then(function (r) { return (r && r.data && r.data.session && r.data.session.access_token) || ''; }); }

  function show(ctx) {
    P.ctx = ctx; P.el = ctx.el;
    if (!P.el.querySelector('.ps')) { P.el.innerHTML = ''; P.el.appendChild(h('p', { cls: 'eo-loading', text: 'Opening pre-shift…' })); }
    load().then(function () {
      render();
      // a manager opening the page also checks OpenTable straight away (once every few minutes at most)
      if (isMgr() && Date.now() - (+P.checked || 0) > 3 * 60000) refresh(false);
    });
  }
  function load() {
    return P.ctx.sb.from('preshift_days').select('*').eq('service_date', today()).maybeSingle().then(function (r) {
      P.missing = !!(r.error && /preshift_days|schema cache|does not exist/i.test(r.error.message || ''));
      P.day = r.error ? null : r.data;
    }, function () { P.day = null; });
  }
  function refresh(force, btn) {
    if (P.busy) return; P.busy = true; P.checked = String(Date.now());
    if (btn) { btn.disabled = true; btn.textContent = 'Checking OpenTable…'; }
    token().then(function (jwt) {
      return fetch('preshift/refresh', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify({ force: !!force }) });
    }).then(function (r) { return r.json().catch(function () { return {}; }); }).then(function (j) {
      P.busy = false; P.last = j;
      if (j.saved || force) return load().then(render);
      if (btn) render();
    }, function () { P.busy = false; P.last = { error: 'network' }; if (btn) render(); });
  }
  var WHY = {
    not_connected: 'rich@edencny.com isn’t connected on the Business email page yet.',
    reconnect: 'The mailbox OpenTable writes to needs to be connected again (Business email > Manage mailboxes > Reconnect).',
    key: 'The staff site’s private inquiry key doesn’t match the database (Catering & BEOs uses the same key).',
    missing_sql: 'Run supabase/preshift.sql in Supabase first.', mail_not_ready: 'Business email isn’t set up yet.', network: 'Couldn’t reach the staff site.'
  };

  function render() {
    var el = P.el; el.innerHTML = '';
    var d = new Date();
    var wrap = h('div', { cls: 'ps eo' });
    wrap.appendChild(h('p', { cls: 'home-eyebrow', text: 'Service · Pre-shift' }));
    wrap.appendChild(h('h1', { cls: 'eo-title', text: d.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) }));
    el.appendChild(wrap);
    if (P.missing) { wrap.appendChild(h('div', { cls: 'eo-card' }, [h('p', { text: P.ctx.role === 'owner' ? 'One step first: in Supabase, open SQL Editor > New query, paste in supabase/preshift.sql and click Run. Then reload this page.' : 'Pre-shift isn’t switched on yet.' })])); return; }
    wrap.appendChild(reservations());
    wrap.appendChild(h('p', { cls: 'ps-next', text: 'More pre-shift sections (specials, 86’d items, wine, notes from managers) are coming next.' }));
  }

  /* ---------- 1. Reservations ---------- */
  function reservations() {
    var card = h('section', { cls: 'eo-card ps-res', 'aria-labelledby': 'psResH' });
    var head = h('div', { cls: 'ps-head' }, [h('h2', { cls: 'eo-h', id: 'psResH' }, [h('span', { cls: 'eo-n', text: '1' }), 'Reservations'])]);
    if (isMgr()) head.appendChild(h('button', { type: 'button', cls: 'eo-btn ps-check', text: 'Check OpenTable now', on: { click: function () { refresh(true, this); } } }));
    card.appendChild(head);
    var day = P.day, R = day && day.reservations;
    if (P.last && P.last.error && isMgr()) card.appendChild(h('p', { cls: 'ps-warn', text: 'Couldn’t read OpenTable’s email: ' + (WHY[P.last.error] || 'try again in a minute.') }));
    if (!day || !R) {
      card.appendChild(h('div', { cls: 'ps-wait' }, [h('b', { text: 'Waiting for today’s OpenTable email' }),
        h('span', { text: 'Tonight’s reservations fill in here by themselves as soon as OpenTable’s email reaches rich@edencny.com.' })]));
      return card;
    }
    card.appendChild(h('p', { cls: 'ps-src' }, [
      day.source_forwarded ? h('span', { cls: 'ps-badge', text: 'Sample · forwarded email' }) : null,
      'From OpenTable’s email' + (day.source_subject ? ' “' + day.source_subject.replace(/^\s*(fwd?|fw):\s*/i, '') + '”' : '') + ', received ' + when(day.source_received) + '.']));
    var list = R.list || [];
    // the numbers
    var tiles = [];
    (R.stats || []).forEach(function (s) { tiles.push([s.value, s.label]); });
    var have = function (w) { return tiles.some(function (t) { return new RegExp(w, 'i').test(t[1]); }); };
    if (list.length) {
      if (!have('reserv|booking|parties')) tiles.unshift([String(list.length), list.length === 1 ? 'Reservation' : 'Reservations']);
      if (!have('cover|guest')) tiles.unshift([String(R.covers || 0), 'Covers']);
      if (R.large) tiles.push([String(R.large), 'Parties of 8+']);
      var fl = function (tag) { return list.filter(function (r) { return r.tags.indexOf(tag) !== -1; }).length; };
      if (fl('Allergy')) tiles.push([String(fl('Allergy')), 'Allergies / dietary']);
      if (fl('Birthday') + fl('Anniversary') + fl('Celebration')) tiles.push([String(fl('Birthday') + fl('Anniversary') + fl('Celebration')), 'Celebrations']);
      if (fl('VIP')) tiles.push([String(fl('VIP')), 'VIPs']);
    }
    if (tiles.length) card.appendChild(h('div', { cls: 'ps-tiles' }, tiles.slice(0, 8).map(function (t) { return h('div', { cls: 'ps-tile' }, [h('b', { text: t[0] }), h('span', { text: t[1] })]); })));
    // heads-up for the team
    var watch = list.filter(function (r) { return r.tags.length || r.size >= 8; });
    if (watch.length) {
      card.appendChild(h('h3', { cls: 'ps-sub', text: 'Heads-up tonight' }));
      card.appendChild(h('ul', { cls: 'ps-watch' }, watch.map(function (r) {
        return h('li', [h('span', { cls: 'ps-t', text: t12(r.time) }), h('span', { cls: 'ps-w' }, [h('b', { text: (r.name || 'Party') + ' · ' + r.size }), r.notes ? h('small', { text: r.notes }) : null]),
          h('span', { cls: 'ps-tags' }, (r.size >= 8 && r.tags.indexOf('Large party') === -1 ? ['Large party'] : []).concat(r.tags).map(function (t) { return h('span', { cls: 'ps-tag ps-' + t.toLowerCase().replace(/\W+/g, '-'), text: t }); }))]);
      })));
    }
    // the book, by the hour
    if (list.length) {
      card.appendChild(h('h3', { cls: 'ps-sub', text: 'The book' }));
      var byHour = {};
      list.forEach(function (r) { var k = r.time.slice(0, 2); (byHour[k] = byHour[k] || []).push(r); });
      var book = h('div', { cls: 'ps-book' });
      Object.keys(byHour).sort().forEach(function (k) {
        var rows = byHour[k], cov = rows.reduce(function (n, r) { return n + r.size; }, 0);
        book.appendChild(h('div', { cls: 'ps-hour' }, [h('div', { cls: 'ps-hour-h' }, [h('b', { text: t12(k + ':00') }), h('span', { text: rows.length + ' res · ' + cov + ' covers' })]),
          h('ul', rows.map(function (r) { return h('li', [h('span', { cls: 'ps-t', text: t12(r.time) }), h('span', { cls: 'ps-size', text: String(r.size) }), h('span', { cls: 'ps-name', text: r.name || '' }), h('span', { cls: 'ps-notes', text: [r.tags.join(', '), r.notes].filter(Boolean).join(' — ') })]); }))]));
      });
      card.appendChild(book);
    }
    // everything else the email said, so nothing is lost
    var secs = R.sections || [];
    if (secs.length) {
      var det = h('details', { cls: 'ps-all', open: !list.length && !(R.stats || []).length }, [h('summary', { text: list.length ? 'Everything in OpenTable’s email' : 'What OpenTable sent' })]);
      secs.forEach(function (s) {
        det.appendChild(h('div', { cls: 'ps-sec' }, [s.title ? h('h4', { text: s.title }) : null, h('ul', s.lines.map(function (l) { return h('li', { text: l }); }))]));
      });
      card.appendChild(det);
    }
    return card;
  }

  window.EdenPreshift = { show: show };
})();
