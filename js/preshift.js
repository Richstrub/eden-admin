/* Eden staff site: Pre-shift meeting (everyone can read it).
 *
 * 1. Education: PDFs the Owner and managers upload (stored privately in Supabase Storage); everyone can open them.
 * 2. Reservations: filled in automatically from OpenTable's email to rich@edencny.com (see preshift-worker.js).
 *    Today's pre-shift appears once that day's OpenTable email has arrived, and clears after midnight.
 * 3. Menu changes in the last 24 hours.
 * 4. Notes: sent by the Owner and managers from the Notes tab ("Send to pre-shift"), for one service day.
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
  // today's pre-shift; preshift_today() leaves out what guests spend for anyone who isn't the Owner or a manager
  function load() {
    var gone = function (e) { return !!(e && (e.code === 'PGRST202' || e.code === 'PGRST205' || e.code === '42P01' || e.code === '42883' || /schema cache|does not exist|could not find/i.test(e.message || ''))); };
    return P.ctx.sb.rpc('preshift_today').then(function (r) {
      if (!r.error) { P.missing = false; P.day = r.data || null; return; }
      if (!gone(r.error)) { P.day = null; return; }
      return P.ctx.sb.from('preshift_days').select('*').eq('service_date', today()).maybeSingle().then(function (t) {
        P.missing = gone(t.error); P.day = t.error ? null : t.data;
      });
    }).catch(function () { P.day = null; });
  }
  function refresh(force, btn) {
    if (P.busy) return; P.busy = true; P.checked = String(Date.now());
    if (btn) { btn.disabled = true; btn.textContent = 'Checking OpenTable…'; }
    token().then(function (jwt) {
      return fetch((P.ctx.api || '') + 'preshift/refresh', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify({ force: !!force }) });
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
    wrap.appendChild(educationCard());
    wrap.appendChild(reservations());
    var mc = h('section', { cls: 'eo-card ps-menu', 'aria-labelledby': 'psMenuH' }, [h('div', { cls: 'ps-head' }, [h('h2', { cls: 'eo-h', id: 'psMenuH' }, [h('span', { cls: 'eo-n', text: '3' }), 'Menu changes']), h('span', { cls: 'ps-when', text: 'Last 24 hours' })]), h('p', { cls: 'ps-src', text: 'Loading…' })]);
    wrap.appendChild(mc);
    menuChanges(mc);
    wrap.appendChild(notesCard());
  }

  /* ---------- 2. Reservations ---------- */
  function reservations() {
    var card = h('section', { cls: 'eo-card ps-res', 'aria-labelledby': 'psResH' });
    var head = h('div', { cls: 'ps-head' }, [h('h2', { cls: 'eo-h', id: 'psResH' }, [h('span', { cls: 'eo-n', text: '2' }), 'Reservations'])]);
    if (isMgr()) head.appendChild(h('button', { type: 'button', cls: 'eo-btn ps-check', text: 'Check OpenTable now', on: { click: function () { refresh(true, this); } } }));
    card.appendChild(head);
    var day = P.day, R = day && day.reservations;
    if (P.last && P.last.error && isMgr()) card.appendChild(h('p', { cls: 'ps-warn', text: 'Couldn’t read OpenTable’s email: ' + (WHY[P.last.error] || 'try again in a minute.') }));
    if (!day || !R) {
      card.appendChild(h('div', { cls: 'ps-wait' }, [h('b', { text: 'Waiting for today’s OpenTable email' }),
        h('span', { text: 'Tonight’s reservations fill in here by themselves as soon as OpenTable’s email reaches rich@edencny.com.' })]));
      return card;
    }
    var digest = R.kind === 'digest';
    card.appendChild(h('p', { cls: 'ps-src' }, [
      day.source_forwarded ? h('span', { cls: 'ps-badge', text: 'Sample · forwarded email' }) : null,
      digest ? 'OpenTable ' + (R.title || 'Pre-shift Digest') + (R.date ? ' for ' + R.date : '') + (day.source_received ? ', received ' + when(day.source_received) : '') + '.'
        : 'From OpenTable’s email' + (day.source_subject ? ' “' + day.source_subject.replace(/^\s*(fwd?|fw):\s*/i, '') + '”' : '') + (day.source_received ? ', received ' + when(day.source_received) : '') + '.']));
    var list = R.list || [];
    var has = function (r, re) { return r.tags.some(function (t) { return re.test(t); }); };
    var CELEB = /birthday|anniversary|special occasion|date night|celebrat|engagement|proposal|graduation/i;
    // the numbers
    var tiles = [];
    (R.stats || []).forEach(function (s) { tiles.push([s.value, s.label]); });
    var haveT = function (w) { return tiles.some(function (t) { return new RegExp(w, 'i').test(t[1]); }); };
    if (list.length) {
      if (!haveT('reserv|booking|parties')) tiles.unshift([String(list.length), list.length === 1 ? 'Reservation' : 'Reservations']);
      if (!haveT('cover|guest')) tiles.unshift([String(R.covers || 0), 'Covers']);
      var n = function (f) { return list.filter(f).length; };
      var c = n(function (r) { return has(r, CELEB); }); if (c) tiles.push([String(c), 'Celebrations']);
      c = n(function (r) { return has(r, /allerg|dietary/i); }); if (c) tiles.push([String(c), 'Allergies / dietary']);
      c = n(function (r) { return has(r, /vip/i); }); if (c) tiles.push([String(c), 'VIPs']);
      c = n(function (r) { return has(r, /returning|regular/i); }); if (c) tiles.push([String(c), 'Returning guests']);
      c = n(function (r) { return r.size >= 6; }); if (c) tiles.push([String(c), 'Parties of 6+']);
      c = n(function (r) { return !!r.notes; }); if (c) tiles.push([String(c), 'With notes']);
    }
    if (tiles.length) card.appendChild(h('div', { cls: 'ps-tiles' }, tiles.slice(0, 8).map(function (t) { return h('div', { cls: 'ps-tile' }, [h('b', { text: t[0] }), h('span', { text: t[1] })]); })));
    var tagEls = function (r) {
      var t = r.tags.slice(); if (r.size >= 6 && !t.some(function (x) { return /large/i.test(x); })) t.unshift(r.size >= 8 ? 'Large party' : 'Party of ' + r.size);
      return t.map(function (x) { return h('span', { cls: 'ps-tag ps-' + x.toLowerCase().replace(/\W+/g, '-') + (CELEB.test(x) ? ' ps-celebrate' : ''), text: x }); });
    };
    var guestLine = function (r) {
      var g = r.guest || {}; var bits = [];
      if (g.visits) bits.push(g.visits + (g.visits === 1 ? ' visit' : ' visits') + ' last year');
      if (g.last) bits.push('last visit ' + g.last);
      if (g.spend && isMgr()) bits.push('$' + Math.round(+g.spend) + ' a cover');
      return bits.length ? bits.join(' · ') : '';
    };
    // heads-up for the team: anything tagged, noted, or a bigger table
    var watch = list.slice().sort(function (a, b) { return a.time.localeCompare(b.time); }).filter(function (r) { return r.tags.some(function (t) { return !/returning/i.test(t); }) || r.notes || r.size >= 6; });
    if (watch.length) {
      card.appendChild(h('h3', { cls: 'ps-sub', text: 'Heads-up tonight · ' + watch.length }));
      card.appendChild(h('ul', { cls: 'ps-watch' }, watch.map(function (r) {
        return h('li', [h('span', { cls: 'ps-t', text: t12(r.time) }),
          h('span', { cls: 'ps-w' }, [h('b', { text: (r.name || 'Party') + ' · ' + r.size + (r.table ? ' · table ' + r.table : '') }),
            r.notes ? h('small', { text: r.notes }) : null, guestLine(r) ? h('small', { cls: 'ps-guest', text: guestLine(r) }) : null]),
          h('span', { cls: 'ps-tags' }, tagEls(r))]);
      })));
    }
    // the book, hour by hour (OpenTable's own hour blocks when it has them)
    if (list.length) {
      card.appendChild(h('h3', { cls: 'ps-sub', text: 'The book' }));
      var groups = [], byKey = {};
      list.slice().sort(function (a, b) { return a.time.localeCompare(b.time); }).forEach(function (r) {
        var k = r.time.slice(0, 2);
        if (!byKey[k]) { byKey[k] = { key: k, rows: [] }; groups.push(byKey[k]); }
        byKey[k].rows.push(r);
      });
      var book = h('div', { cls: 'ps-book' });
      groups.forEach(function (g) {
        var cov = g.rows.reduce(function (n, r) { return n + r.size; }, 0);
        var H = +g.key, lbl = t12(g.key + ':00') + ' – ' + t12(String((H + 1) % 24).padStart(2, '0') + ':00');
        book.appendChild(h('div', { cls: 'ps-hour' }, [h('div', { cls: 'ps-hour-h' }, [h('b', { text: lbl }), h('span', { text: g.rows.length + (g.rows.length === 1 ? ' reservation · ' : ' reservations · ') + cov + ' covers' })]),
          h('ul', g.rows.map(function (r) {
            return h('li', [h('span', { cls: 'ps-t', text: t12(r.time) }), h('span', { cls: 'ps-size', title: 'Party size', text: String(r.size) }),
              h('span', { cls: 'ps-name' }, [r.name || '', r.table ? h('small', { cls: 'ps-table', text: 'Table ' + r.table }) : null]),
              h('span', { cls: 'ps-notes' }, [r.tags.length ? h('span', { cls: 'ps-tags ps-inline' }, tagEls({ tags: r.tags, size: 0 })) : null, r.notes ? h('span', { text: r.notes }) : null])]);
          }))]));
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

  /* ---------- 1. Education: PDFs for the team ---------- */
  var BUCKET = 'preshift-education', MAXB = 50 * 1024 * 1024;
  function kb(n) { n = +n || 0; return n >= 1048576 ? (Math.round(n / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function eduGone(e) { return !!(e && (e.code === 'PGRST205' || e.code === '42P01' || /preshift_education|schema cache|does not exist|bucket not found/i.test(e.message || ''))); }
  function rid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function educationCard() {
    var card = h('section', { cls: 'eo-card ps-edu', 'aria-labelledby': 'psEduH' });
    var head = h('div', { cls: 'ps-head' }, [h('h2', { cls: 'eo-h', id: 'psEduH' }, [h('span', { cls: 'eo-n', text: '1' }), 'Education'])]);
    var msg = h('p', { cls: 'ps-edu-msg', role: 'status' });
    var body = h('div', { cls: 'ps-edu-b' }, [h('p', { cls: 'ps-src', text: 'Loading…' })]);
    if (isMgr()) {
      var pick = h('input', { type: 'file', accept: 'application/pdf,.pdf', multiple: true, hidden: true, 'aria-label': 'Choose PDF files' });
      var add = h('button', { type: 'button', cls: 'eo-btn ps-check', text: 'Add PDF', on: { click: function () { pick.click(); } } });
      pick.addEventListener('change', function () { var f = [].slice.call(pick.files || []); pick.value = ''; if (f.length) upload(f, add, msg, body); });
      head.appendChild(add); card.appendChild(pick);
    }
    card.appendChild(head); card.appendChild(msg); card.appendChild(body);
    loadEdu(body, msg);
    return card;
  }
  function loadEdu(body, msg) {
    var sb = P.ctx.sb;
    return sb.from('preshift_education').select('id,title,file_path,file_size,author,created_at').order('created_at', { ascending: false }).then(function (r) {
      if (r.error) { body.innerHTML = ''; body.appendChild(h('p', { cls: 'ps-src', text: eduGone(r.error) ? (P.ctx.role === 'owner' ? 'Education switches on once supabase/preshift.sql is run again in Supabase (SQL Editor > New query > paste > Run).' : 'Education isn’t switched on yet.') : 'Couldn’t load education.' })); return; }
      var rows = r.data || [];
      if (!rows.length) { body.innerHTML = ''; body.appendChild(h('p', { cls: 'ps-src', text: isMgr() ? 'Nothing here yet. Press “Add PDF” to share wine notes, menu descriptions or service standards with the team.' : 'Nothing to read yet.' })); return; }
      // links that open each PDF (private files: each link works for a few hours)
      return sb.storage.from(BUCKET).createSignedUrls(rows.map(function (x) { return x.file_path; }), 6 * 3600).then(function (u) {
        var urls = {}; ((u && u.data) || []).forEach(function (x) { if (x && x.signedUrl) urls[x.path] = x.signedUrl; });
        body.innerHTML = '';
        body.appendChild(h('ul', { cls: 'ps-edu-list' }, rows.map(function (d) {
          var url = urls[d.file_path];
          var open = url ? h('a', { cls: 'ps-edu-open', href: url, target: '_blank', rel: 'noopener' }, [h('span', { cls: 'ps-edu-ic', 'aria-hidden': 'true', text: 'PDF' }), h('span', { cls: 'ps-edu-tx' }, [h('b', { text: d.title || 'Untitled' }), h('small', { text: [kb(d.file_size), d.author ? 'added by ' + d.author : '', when(d.created_at)].filter(Boolean).join(' · ') })])])
            : h('div', { cls: 'ps-edu-open is-off' }, [h('span', { cls: 'ps-edu-ic', 'aria-hidden': 'true', text: 'PDF' }), h('span', { cls: 'ps-edu-tx' }, [h('b', { text: d.title || 'Untitled' }), h('small', { text: 'Couldn’t open this file right now.' })])]);
          return h('li', { cls: 'ps-edu-i' }, [open, isMgr() ? h('button', { type: 'button', cls: 'ps-note-x ps-edu-x', text: 'Delete', 'aria-label': 'Delete ' + (d.title || 'this PDF'), on: { click: function () { delEdu(d, this, body, msg); } } }) : null]);
        })));
      });
    }).catch(function () { body.innerHTML = ''; body.appendChild(h('p', { cls: 'ps-src', text: 'Couldn’t load education.' })); });
  }
  function upload(files, btn, msg, body) {
    var sb = P.ctx.sb, bad = [], done = 0, failed = [], setup = false, denied = false;
    files = files.filter(function (f) { var ok = (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) && f.size > 0 && f.size <= MAXB; if (!ok) bad.push(f.name); return ok; });
    if (!files.length) { msg.className = 'ps-edu-msg err'; msg.textContent = 'Only PDF files up to 50 MB can be added.'; return; }
    btn.disabled = true; msg.className = 'ps-edu-msg';
    var next = function (i) {
      if (i >= files.length) {
        btn.disabled = false;
        var t = done ? 'Added ' + done + ' PDF' + (done === 1 ? '' : 's') + '.' : '';
        if (failed.length) t += (t ? ' ' : '') + 'Couldn’t add: ' + failed.join(', ') + '.' + (setup ? ' Run supabase/preshift.sql in Supabase first.' : denied ? ' Only the Owner and managers can add PDFs.' : '');
        if (bad.length) t += (t ? ' ' : '') + 'Skipped (not a PDF, or over 50 MB): ' + bad.join(', ') + '.';
        msg.className = 'ps-edu-msg' + (failed.length || bad.length ? ' err' : ' ok'); msg.textContent = t;
        return loadEdu(body, msg);
      }
      var f = files[i], id = rid(), path = id + '.pdf';
      msg.textContent = 'Uploading ' + f.name + (files.length > 1 ? ' (' + (i + 1) + ' of ' + files.length + ')' : '') + '…';
      sb.storage.from(BUCKET).upload(path, f, { contentType: 'application/pdf', upsert: false }).then(function (u) {
        if (u.error) throw u.error;
        return sb.from('preshift_education').insert({ id: id, title: f.name.replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').trim().slice(0, 200) || 'Untitled', file_path: path, file_size: f.size }).then(function (r) {
          if (r.error) { sb.storage.from(BUCKET).remove([path]); throw r.error; }
          done++;
        });
      }).catch(function (e) {
        failed.push(f.name);
        if (eduGone(e)) setup = true; else if (/row-level security|permission|unauthori[sz]ed|403/i.test((e && (e.message || e.error || e.statusCode)) + '')) denied = true;
      }).then(function () { next(i + 1); });
    };
    next(0);
  }
  function delEdu(d, btn, body, msg) {
    if (!confirm('Delete “' + (d.title || 'this PDF') + '” for everyone?')) return;
    btn.disabled = true;
    P.ctx.sb.from('preshift_education').delete().eq('id', d.id).then(function (r) {
      if (r.error) { btn.disabled = false; msg.className = 'ps-edu-msg err'; msg.textContent = 'Couldn’t delete it. Try again.'; return; }
      P.ctx.sb.storage.from(BUCKET).remove([d.file_path]).then(function () {}, function () {});
      msg.className = 'ps-edu-msg ok'; msg.textContent = 'Deleted “' + (d.title || 'PDF') + '”.';
      loadEdu(body, msg);
    }, function () { btn.disabled = false; });
  }

  /* ---------- 4. Notes from the Owner and managers ---------- */
  function notesCard() {
    var card = h('section', { cls: 'eo-card ps-notes', 'aria-labelledby': 'psNotesH' });
    var head = h('div', { cls: 'ps-head' }, [h('h2', { cls: 'eo-h', id: 'psNotesH' }, [h('span', { cls: 'eo-n', text: '4' }), 'Notes'])]);
    var mgr = isMgr();
    if (mgr && window.EdenNotes && window.EdenNotes.open && !P.ctx.noNotes) head.appendChild(h('button', { type: 'button', cls: 'eo-btn ps-check', text: 'Write a note', on: { click: function () { window.EdenNotes.open(); } } }));
    card.appendChild(head);
    var body = h('div', { cls: 'ps-notes-b' }, [h('p', { cls: 'ps-src', text: 'Loading…' })]);
    card.appendChild(body);
    loadNotes(body, mgr);
    P.notesBody = body; P.notesMgr = mgr;
    return card;
  }
  // a note just sent from the Notes tab shows up straight away
  window.addEventListener('eden:preshift-note', function (e) { if (P.notesBody && document.body.contains(P.notesBody) && e.detail && e.detail.day === today()) loadNotes(P.notesBody, P.notesMgr); });
  function loadNotes(body, mgr) {
    P.ctx.sb.from('preshift_notes').select('id,body,ink,author,created_at').eq('service_date', today()).order('created_at', { ascending: true }).then(function (r) {
      body.innerHTML = '';
      if (r.error) { body.appendChild(h('p', { cls: 'ps-src', text: /preshift_notes|schema cache|does not exist/i.test(r.error.message || '') ? (P.ctx.role === 'owner' ? 'Notes switch on once supabase/preshift.sql is run again in Supabase (SQL Editor > New query > paste > Run).' : 'Notes aren’t switched on yet.') : 'Couldn’t load notes.' })); return; }
      var rows = r.data || [];
      if (!rows.length) { body.appendChild(h('p', { cls: 'ps-src', text: mgr ? 'No notes for today yet. In the Notes tab, open a note and press “Send to pre-shift”.' : 'No notes for today.' })); return; }
      body.appendChild(h('ul', { cls: 'ps-nlist' }, rows.map(function (n) {
        var li = h('li', { cls: 'ps-note' }, [
          n.body ? h('p', { cls: 'ps-note-t', text: n.body }) : null,
          n.ink && /^data:image\/(png|jpeg);base64,/.test(n.ink) ? h('img', { cls: 'ps-note-ink', src: n.ink, alt: 'Handwritten note' + (n.author ? ' from ' + n.author : '') }) : null,
          h('div', { cls: 'ps-note-m' }, [h('span', { text: (n.author || 'A manager') + ' · ' + when(n.created_at) }),
            mgr ? h('button', { type: 'button', cls: 'ps-note-x', text: 'Remove', 'aria-label': 'Remove this note from pre-shift', on: { click: function () {
              if (!confirm('Take this note off pre-shift for everyone?')) return;
              var b = this; b.disabled = true;
              P.ctx.sb.from('preshift_notes').delete().eq('id', n.id).then(function (x) { if (x.error) { b.disabled = false; alert('Couldn’t remove it. Try again.'); return; } loadNotes(body, mgr); });
            } } }) : null])
        ]);
        return li;
      })));
    }, function () { body.innerHTML = ''; body.appendChild(h('p', { cls: 'ps-src', text: 'Couldn’t load notes.' })); });
  }

  /* ---------- 3. Menu changes in the last 24 hours (from the menu editor's history) ---------- */
  function key(n) { return String(n || '').trim().toLowerCase(); }
  function money(p) { p = String(p == null ? '' : p).trim(); return p ? (/^\d/.test(p) ? '$' + p : p) : ''; }
  // what changed in one menu section, as short lines
  function diffSection(c) {
    var b = c.before || null, a = c.after || null, out = [];
    var bi = (b && b.items) || [], ai = (a && a.items) || [];
    if (!b && a) { ai.forEach(function (it) { if (it && it.name) out.push({ kind: 'new', name: it.name, text: [it.desc, money(it.price)].filter(Boolean).join(' · ') }); }); return { title: a.title || 'New section', isNew: true, lines: out }; }
    if (b && !a) return { title: b.title || 'A section', removed: true, lines: [{ kind: 'removed', name: 'Whole section taken off the menu', text: bi.map(function (x) { return x.name; }).filter(Boolean).join(', ') }] };
    var bm = {}; bi.forEach(function (it) { if (it && it.name) bm[key(it.name)] = it; });
    var am = {}; ai.forEach(function (it) { if (it && it.name) am[key(it.name)] = it; });
    ai.forEach(function (it) {
      if (!it || !it.name) return;
      var was = bm[key(it.name)];
      if (!was) { out.push({ kind: it.hidden ? 'hidden' : 'new', name: it.name, text: [it.desc, money(it.price)].filter(Boolean).join(' · ') }); return; }
      if (!was.hidden && it.hidden) out.push({ kind: 'hidden', name: it.name, text: 'Off the menu for now' });
      if (was.hidden && !it.hidden) out.push({ kind: 'back', name: it.name, text: 'Back on the menu' });
      if (String(was.price || '') !== String(it.price || '')) out.push({ kind: 'price', name: it.name, text: (money(was.price) || 'no price') + ' → ' + (money(it.price) || 'no price') });
      if (String(was.desc || '') !== String(it.desc || '')) out.push({ kind: 'desc', name: it.name, text: it.desc || '(no description)' });
      if (String(was.src || '') !== String(it.src || '') && it.src) out.push({ kind: 'desc', name: it.name, text: 'Now from ' + it.src });
      if (String(was.pair || '') !== String(it.pair || '')) out.push({ kind: 'pair', name: it.name, text: it.pair ? 'Pair with ' + it.pair + (it.pairPrice ? ' (' + money(it.pairPrice) + ')' : '') : 'No pairing now' });
    });
    bi.forEach(function (it) { if (it && it.name && !am[key(it.name)]) out.push({ kind: 'removed', name: it.name, text: 'Taken off the menu' }); });
    var title = (a && a.title) || (b && b.title) || 'Menu';
    if (b && a && b.title && a.title && b.title !== a.title) out.unshift({ kind: 'desc', name: 'Section renamed', text: b.title + ' → ' + a.title });
    if (a && b && String(a.note || '') !== String(b.note || '') && a.note) out.push({ kind: 'desc', name: 'Section note', text: a.note });
    return { title: title, lines: out };
  }
  var KIND = { new: 'New', removed: 'Removed', hidden: '86’d', back: 'Back on', price: 'Price', desc: 'Changed', pair: 'Pairing' };
  function menuChanges(card) {
    var body = card.querySelector('.ps-src');
    P.ctx.sb.rpc('menu_changes', { p_hours: 24 }).then(function (r) {
      if (r.error) { body.textContent = /menu_changes|function|schema cache/i.test(r.error.message || '') ? (P.ctx.role === 'owner' ? 'Run supabase/preshift.sql in Supabase again to switch this on (it needs History, supabase/history.sql).' : 'Not switched on yet.') : 'Couldn’t load menu changes.'; return; }
      var secs = (r.data || []).map(function (c) { var d = diffSection(c); d.who = c.who; d.at = c.at; return d; }).filter(function (d) { return d.lines.length; });
      if (!secs.length) { body.textContent = 'No menu changes in the last 24 hours.'; return; }
      body.remove();
      var n = 0; secs.forEach(function (d) { n += d.lines.length; });
      card.querySelector('.ps-when').textContent = n + (n === 1 ? ' change' : ' changes') + ' · last 24 hours';
      secs.forEach(function (d) {
        card.appendChild(h('div', { cls: 'ps-mc' }, [
          h('div', { cls: 'ps-mc-h' }, [h('b', { text: d.title }), h('span', { text: (d.isNew ? 'New section · ' : d.removed ? 'Removed · ' : '') + (d.who ? d.who + ', ' : '') + when(d.at) })]),
          h('ul', d.lines.map(function (l) {
            return h('li', [h('span', { cls: 'ps-k ps-k-' + l.kind, text: KIND[l.kind] || 'Changed' }), h('span', { cls: 'ps-mc-t' }, [h('b', { text: l.name }), l.text ? h('span', { text: l.text }) : null])]);
          }))]));
      });
    }, function () { body.textContent = 'Couldn’t load menu changes.'; });
  }

  window.EdenPreshift = { show: show };
})();
