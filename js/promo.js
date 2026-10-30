/* Eden staff site: Promotional emails (Office > Promotional emails). Owner and managers.
 *
 *   #promo            Emails: drafts, scheduled and sent, with results.
 *   #promo/e/<id>     Write and design one email (heading, photo, message, button, sign-off) with a live preview;
 *                     send a test to yourself, schedule it or send it now. Once sent: who it went to, opens, clicks.
 *   #promo/list       The guest list: upload a spreadsheet (CSV or Excel), add someone, people who joined on
 *                     edencny.com, unsubscribes and bounces.
 *
 * Data: supabase/promo-emails.sql. Sending: the staff site's worker (promo-worker.js) through Resend.
 * {{unsubscribe_url}} in the email is filled in for each guest when it's sent.
 */
(function () {
  'use strict';
  var BUCKET = 'promo-images';
  var LINKS = [
    ['Reserve a table', 'https://www.opentable.com/r/eden-syracuse'],
    ['See the menu', 'https://edencny.com/#menu'],
    ['Plan your event', 'https://edencny.com/#catering'],
    ['Buy a gift card', 'https://squareup.com/gift/MLP07Q85G4E60/order'],
    ['Eden × James Beard', 'https://edencny.com/#supper']
  ];
  var P = { ctx: null, el: null, list: null, over: null, cfg: null, me: '' };

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
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function gone(e) { return !!(e && (e.code === 'PGRST205' || e.code === 'PGRST202' || e.code === '42P01' || e.code === '42883' || /promo_|schema cache|does not exist|could not find/i.test(e.message || ''))); }
  function when(ts) { return ts ? new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  function day(ts) { return ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
  function pct(a, b) { return b ? Math.round(a / b * 100) + '%' : '–'; }
  function say(t, k) { var m = P.el && P.el.querySelector('.pm-msg'); if (m) { m.textContent = t || ''; m.className = 'pm-msg' + (k ? ' ' + k : ''); } }
  function token() { return P.ctx.sb.auth.getSession().then(function (r) { var s = r && r.data && r.data.session; if (s && s.user) P.me = s.user.email || P.me; return (s && s.access_token) || ''; }); }
  function api(path, body) {
    return token().then(function (jwt) {
      return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify(body || {}) });
    }).then(function (r) { return r.json().catch(function () { return { error: 'server' }; }).then(function (j) { j._status = r.status; return j; }); }, function () { return { error: 'network' }; });
  }

  /* ---------- the email itself (works in Gmail, Apple Mail and Outlook: tables and inline styles) ---------- */
  function linkify(t) { return esc(t).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g, '<a href="$1" style="color:#8a5226;text-decoration:underline">$1</a>'); }
  function paras(t) {
    return String(t || '').replace(/\r/g, '').split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean).map(function (p) {
      return '<p style="margin:0 0 18px;font-family:Helvetica,Arial,sans-serif;font-size:16px;line-height:1.65;color:#3a3d40">' + linkify(p).replace(/\n/g, '<br>') + '</p>';
    }).join('');
  }
  function buildEmail(c) {
    var d = c.design || {};
    var btn = d.button_text && d.button_url ? '<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="center" style="margin:10px auto 26px"><tr><td bgcolor="#0f1215" style="background:#0f1215;border-radius:2px">' +
      '<a href="' + esc(d.button_url) + '" style="display:inline-block;padding:15px 32px;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#ffffff;text-decoration:none">' + esc(d.button_text) + '</a></td></tr></table>' : '';
    var html = '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>' + esc(c.subject) + '</title></head>' +
      '<body style="margin:0;padding:0;background:#f4f1ea">' +
      '<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:#f4f1ea">' + esc(c.preheader || '') + '&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;&#8199;&#847;</div>' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f4f1ea"><tr><td align="center" style="padding:28px 12px">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#ffffff">' +
      '<tr><td align="center" style="padding:30px 24px 22px;background:#0f1215"><div style="font-family:Georgia,\'Times New Roman\',serif;font-size:28px;letter-spacing:14px;color:#f3eee5;padding-left:14px">EDEN</div>' +
      '<div style="font-family:Helvetica,Arial,sans-serif;font-size:10px;letter-spacing:4px;text-transform:uppercase;color:#d58b4f;margin-top:8px">Syracuse, New York</div></td></tr>' +
      (d.image ? '<tr><td style="padding:0"><img src="' + esc(d.image) + '" alt="' + esc(d.image_alt || d.heading || '') + '" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0"></td></tr>' : '') +
      '<tr><td style="padding:40px 44px 14px">' +
      (d.heading ? '<h1 style="margin:0 0 22px;font-family:Georgia,\'Times New Roman\',serif;font-weight:normal;font-size:31px;line-height:1.2;color:#0f1215;text-align:center">' + esc(d.heading) + '</h1>' : '') +
      paras(d.body) + btn +
      (d.signoff ? '<p style="margin:6px 0 26px;font-family:Georgia,\'Times New Roman\',serif;font-style:italic;font-size:18px;line-height:1.5;color:#0f1215">' + esc(d.signoff).replace(/\n/g, '<br>') + '</p>' : '') +
      '</td></tr>' +
      '<tr><td align="center" style="padding:26px 30px 34px;border-top:1px solid #ece6db;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:1.7;color:#857f75">' +
      'Eden · 118 E. Genesee St., Syracuse, NY 13202 · 315.991.8408<br><a href="https://edencny.com/" style="color:#857f75">edencny.com</a> · <a href="https://www.opentable.com/r/eden-syracuse" style="color:#857f75">Reservations</a><br><br>' +
      'You’re receiving this because you joined Eden’s email list or dined with us.<br><a href="{{unsubscribe_url}}" style="color:#857f75;text-decoration:underline">Unsubscribe</a></td></tr>' +
      '</table></td></tr></table></body></html>';
    var text = [d.heading || '', '', String(d.body || '').trim(), '', d.button_text && d.button_url ? d.button_text + ': ' + d.button_url : '', '', d.signoff || '', '',
      '—', 'Eden · 118 E. Genesee St., Syracuse, NY 13202 · 315.991.8408 · edencny.com', 'Unsubscribe: {{unsubscribe_url}}'].join('\n').replace(/\n{3,}/g, '\n\n').trim();
    return { html: html, text: text };
  }
  P.buildEmail = buildEmail;

  /* ---------- page ---------- */
  function show(ctx) {
    P.ctx = ctx; P.el = ctx.el; P.sub = ctx.sub || '';
    token();
    if (!P.cfg) fetch('promo/status').then(function (r) { return r.json(); }).then(function (j) { P.cfg = j; paintCfg(); }, function () { P.cfg = { resend: false }; paintCfg(); });
    if (/^e\//.test(P.sub)) return openEmail(P.sub.slice(2));
    if (P.sub === 'list') return showList();
    return showEmails();
  }
  function frame(tab) {
    var el = P.el; el.innerHTML = '';
    var wrap = h('div', { cls: 'pm' });
    wrap.appendChild(h('div', { cls: 'pm-top' }, [
      h('div', [h('p', { cls: 'home-eyebrow', text: 'Office' }), h('h1', { cls: 'eo-title', text: 'Promotional emails' })]),
      h('nav', { cls: 'pm-tabs', 'aria-label': 'Promotional emails' }, [
        h('a', { href: '#promo', 'aria-current': tab === 'emails' ? 'page' : null, text: 'Emails' }),
        h('a', { href: '#promo/list', 'aria-current': tab === 'list' ? 'page' : null, text: 'Guest list' })
      ])
    ]));
    wrap.appendChild(h('div', { cls: 'pm-cfg', hidden: true }));
    wrap.appendChild(h('p', { cls: 'pm-msg', role: 'status' }));
    el.appendChild(wrap);
    paintCfg();
    return wrap;
  }
  function paintCfg() {
    var box = P.el && P.el.querySelector('.pm-cfg'); if (!box || !P.cfg) return;
    box.innerHTML = '';
    if (P.cfg.resend === false || P.cfg.key === false) {
      box.hidden = false;
      box.appendChild(h('p', { text: 'Sending isn’t switched on yet: the staff site needs its Resend key (RESEND_API_KEY) in Cloudflare. You can still write emails and build the guest list.' }));
    } else box.hidden = true;
  }
  function missing(wrap) {
    wrap.appendChild(h('div', { cls: 'eo-card pm-setup' }, [h('p', { text: P.ctx.role === 'owner' ? 'One step first: in Supabase, open SQL Editor > New query, paste in supabase/promo-emails.sql and click Run. Then reload this page.' : 'Promotional emails aren’t switched on yet.' })]));
  }
  function overview() {
    return P.ctx.sb.rpc('promo_overview').then(function (r) { P.over = r.error || !r.data || r.data.error ? null : r.data; if (r.error && gone(r.error)) P.missing = true; });
  }

  /* ---------- Emails ---------- */
  function statusLine(c) {
    if (c.status === 'scheduled') return ['Scheduled', 'for ' + when(c.scheduled_at)];
    if (c.status === 'sending') return ['Sending', 'started ' + when(c.started_at)];
    if (c.status === 'sent') return ['Sent', when(c.sent_at)];
    if (c.status === 'failed') return ['Didn’t finish', c.error || ''];
    return ['Draft', 'edited ' + when(c.updated_at) + (c.updated_by ? ' by ' + c.updated_by : '')];
  }
  function showEmails() {
    var wrap = frame('emails');
    var body = h('div', { cls: 'pm-body' }, [h('p', { cls: 'ps-src', text: 'Loading…' })]); wrap.appendChild(body);
    Promise.all([overview(), P.ctx.sb.from('promo_campaigns').select('id,subject,status,scheduled_at,started_at,sent_at,recipients,error,updated_at,updated_by,created_at').order('created_at', { ascending: false })]).then(function (x) {
      var r = x[1]; body.innerHTML = '';
      if (r.error) { if (gone(r.error)) missing(body); else body.appendChild(h('p', { cls: 'eo-err', text: 'Couldn’t load the emails.' })); return; }
      var list = r.data || [], o = P.over || { subscribed: 0, stats: {} };
      body.appendChild(h('div', { cls: 'pm-head' }, [
        h('p', { cls: 'pm-count' }, [h('b', { text: String(o.subscribed || 0) }), ' guest' + (o.subscribed === 1 ? '' : 's') + ' on the list · ', h('a', { href: '#promo/list', text: 'Guest list' })]),
        h('button', { type: 'button', cls: 'eo-btn pm-new', text: 'New email', on: { click: newEmail } })
      ]));
      if (!list.length) { body.appendChild(h('div', { cls: 'eo-card pm-empty' }, [h('h2', { cls: 'eo-h', text: 'No emails yet' }), h('p', { text: 'Write your first email: a new menu, an event, a holiday. Send yourself a test, then send it now or schedule it.' }), h('button', { type: 'button', cls: 'eo-btn pm-new', text: 'New email', on: { click: newEmail } })])); return; }
      body.appendChild(h('ul', { cls: 'pm-list' }, list.map(function (c) {
        var s = (o.stats || {})[c.id], sl = statusLine(c);
        return h('li', [h('a', { cls: 'pm-item', href: '#promo/e/' + c.id }, [
          h('span', { cls: 'pm-pill pm-' + c.status, text: sl[0] }),
          h('span', { cls: 'pm-item-t' }, [h('b', { text: c.subject || '(No subject yet)' }), h('small', { text: sl[1] })]),
          s && (c.status === 'sent' || c.status === 'sending') ? h('span', { cls: 'pm-item-s' }, [
            h('span', [h('b', { text: String(s.sent) }), ' sent']), h('span', [h('b', { text: pct(s.opened, s.sent) }), ' opened']), h('span', [h('b', { text: pct(s.clicked, s.sent) }), ' clicked'])]) : null
        ])]);
      })));
    });
  }
  function newEmail() {
    var row = { subject: '', preheader: '', status: 'draft', design: { heading: '', body: '', button_text: LINKS[0][0], button_url: LINKS[0][1], signoff: 'See you at the table,\nEden' } };
    var b = buildEmail(row); row.html = b.html; row.text_body = b.text;
    P.ctx.sb.from('promo_campaigns').insert(row).select('id').single().then(function (r) {
      if (r.error) { say(gone(r.error) ? 'Run supabase/promo-emails.sql in Supabase first.' : 'Couldn’t start a new email.', 'err'); return; }
      location.hash = '#promo/e/' + r.data.id;
    });
  }

  /* ---------- one email ---------- */
  function openEmail(id) {
    var wrap = frame('emails');
    var body = h('div', { cls: 'pm-body' }, [h('p', { cls: 'ps-src', text: 'Loading…' })]); wrap.appendChild(body);
    Promise.all([overview(), P.ctx.sb.from('promo_campaigns').select('*').eq('id', id).maybeSingle()]).then(function (x) {
      var r = x[1]; body.innerHTML = '';
      if (r.error || !r.data) { body.appendChild(h('p', { cls: 'eo-err', text: r.error && gone(r.error) ? 'Run supabase/promo-emails.sql in Supabase first.' : 'That email isn’t here anymore.' })); body.appendChild(h('a', { href: '#promo', text: '‹ All emails' })); return; }
      var c = r.data; c.design = c.design || {};
      if (c.status === 'sent' || c.status === 'sending') results(body, c); else editor(body, c);
    });
  }
  function field(label, input, hint) { return h('label', { cls: 'pm-f' }, [h('span', { text: label }), input, hint ? h('small', { text: hint }) : null]); }
  function editor(body, c) {
    var d = c.design, dirty = false, saving = null, timer = null;
    var back = h('a', { cls: 'pm-back', href: '#promo', text: '‹ All emails' });
    var subj = h('input', { type: 'text', maxlength: '150', value: c.subject || '', placeholder: 'e.g. The fall menu is here' });
    var pre = h('input', { type: 'text', maxlength: '150', value: c.preheader || '', placeholder: 'A line shown after the subject in the inbox' });
    var head = h('input', { type: 'text', maxlength: '120', value: d.heading || '', placeholder: 'e.g. Wood fire, fall harvest' });
    var msg = h('textarea', { rows: '9', placeholder: 'Write your message. Leave a blank line between paragraphs. Links (https://…) work.' }); msg.value = d.body || '';
    var sign = h('textarea', { rows: '2', placeholder: 'e.g. See you at the table,\nRich & the Eden team' }); sign.value = d.signoff || '';
    var bt = h('input', { type: 'text', maxlength: '40', value: d.button_text || '', placeholder: 'Button words (leave empty for no button)' });
    var bu = h('input', { type: 'url', value: d.button_url || '', placeholder: 'https://…' });
    var presets = h('div', { cls: 'pm-presets' }, LINKS.map(function (l) { return h('button', { type: 'button', text: l[0], on: { click: function () { bt.value = l[0]; bu.value = l[1]; changed(); } } }); }));
    var photo = h('div', { cls: 'pm-photo' });
    var file = h('input', { type: 'file', accept: 'image/*', hidden: true });
    file.addEventListener('change', function () { var f = file.files && file.files[0]; file.value = ''; if (f) upload(f); });
    function paintPhoto() {
      photo.innerHTML = '';
      if (d.image) photo.appendChild(h('div', { cls: 'pm-photo-on' }, [h('img', { src: d.image, alt: '' }), h('div', [h('button', { type: 'button', cls: 'eo-btn small', text: 'Change photo', on: { click: function () { file.click(); } } }), h('button', { type: 'button', cls: 'pm-link', text: 'Remove', on: { click: function () { d.image = ''; paintPhoto(); changed(); } } })])]));
      else photo.appendChild(h('button', { type: 'button', cls: 'pm-addphoto', on: { click: function () { file.click(); } } }, [h('b', { text: '+ Add a photo' }), h('span', { text: 'A wide photo works best. It’s resized for email.' })]));
    }
    function upload(f) {
      say('Uploading the photo…');
      shrink(f).then(function (blob) {
        var path = new Date().toISOString().slice(0, 10) + '/' + (crypto.randomUUID ? crypto.randomUUID() : Date.now()) + '.jpg';
        return P.ctx.sb.storage.from(BUCKET).upload(path, blob, { contentType: 'image/jpeg', upsert: false }).then(function (u) {
          if (u.error) throw u.error;
          d.image = P.ctx.sb.storage.from(BUCKET).getPublicUrl(path).data.publicUrl; paintPhoto(); changed(); say('Photo added.', 'ok');
        });
      }).catch(function (e) { say(e && /bucket/i.test(e.message || '') ? 'Run supabase/promo-emails.sql in Supabase first (it sets up the photo folder).' : 'Couldn’t add the photo. Try a JPEG or PNG.', 'err'); });
    }
    paintPhoto();
    // preview
    var frameEl = h('iframe', { cls: 'pm-preview', title: 'Email preview', sandbox: 'allow-same-origin' });
    var pv = h('div', { cls: 'pm-pv' }, [
      h('div', { cls: 'pm-pv-bar' }, [h('div', { cls: 'pm-inbox' }, [h('b', { cls: 'pm-inbox-s' }), h('span', { cls: 'pm-inbox-p' })]),
        h('div', { cls: 'pm-seg', role: 'group', 'aria-label': 'Preview size' }, [
          h('button', { type: 'button', 'aria-pressed': 'true', text: 'Computer', on: { click: function () { size(this, false); } } }),
          h('button', { type: 'button', 'aria-pressed': 'false', text: 'Phone', on: { click: function () { size(this, true); } } })])]),
      h('div', { cls: 'pm-pv-in' }, frameEl)
    ]);
    function size(btn, phone) { pv.classList.toggle('is-phone', phone); btn.parentNode.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b === btn ? 'true' : 'false'); }); }
    function current() {
      d.heading = head.value.trim(); d.body = msg.value; d.signoff = sign.value.trim(); d.button_text = bt.value.trim(); d.button_url = bu.value.trim();
      var out = { subject: subj.value.trim(), preheader: pre.value.trim(), design: d };
      var b = buildEmail(out); out.html = b.html; out.text_body = b.text; return out;
    }
    function paintPreview() {
      var cur = current();
      frameEl.srcdoc = cur.html.split('{{unsubscribe_url}}').join('#');
      pv.querySelector('.pm-inbox-s').textContent = cur.subject || 'Subject';
      pv.querySelector('.pm-inbox-p').textContent = cur.preheader || (d.body || '').replace(/\s+/g, ' ').slice(0, 90);
    }
    function changed() { dirty = true; paintPreview(); state.textContent = 'Saving…'; clearTimeout(timer); timer = setTimeout(save, 900); }
    function save() {
      if (!dirty) return saving || Promise.resolve(true);
      dirty = false; var cur = current();
      saving = P.ctx.sb.from('promo_campaigns').update(cur).eq('id', c.id).then(function (r) {
        saving = null;
        if (r.error) { state.textContent = 'Not saved'; say('Couldn’t save. Check your connection.', 'err'); return false; }
        Object.assign(c, cur); state.textContent = 'Saved'; return true;
      });
      return saving;
    }
    [subj, pre, head, msg, sign, bt, bu].forEach(function (i) { i.addEventListener('input', changed); });
    var state = h('span', { cls: 'pm-state', text: 'Saved' });
    // test, schedule, send
    var testTo = h('input', { type: 'email', value: P.me || '', placeholder: 'you@edencny.com', 'aria-label': 'Send a test to' });
    token().then(function () { if (!testTo.value) testTo.value = P.me || ''; });
    var when0 = c.scheduled_at ? new Date(c.scheduled_at) : new Date(Date.now() + 864e5);
    if (!c.scheduled_at) when0.setHours(10, 0, 0, 0);
    var at = h('input', { type: 'datetime-local', value: local(when0), min: local(new Date()) });
    var n = (P.over && P.over.subscribed) || 0;
    function ready() {
      var cur = current();
      if (!cur.subject) return 'Add a subject.';
      if (!cur.design.heading && !String(cur.design.body || '').trim()) return 'Write a heading or a message.';
      if (cur.design.button_text && !/^https?:\/\//i.test(cur.design.button_url)) return 'The button needs a link starting with https://';
      return '';
    }
    var acts = h('div', { cls: 'pm-acts' }, [
      h('div', { cls: 'pm-act' }, [h('h3', { text: 'Send a test' }), h('div', { cls: 'pm-row' }, [testTo, h('button', { type: 'button', cls: 'eo-btn', text: 'Send test', on: { click: function () {
        var why = ready(); if (why) { say(why, 'err'); return; }
        var b = this; b.disabled = true; say('Sending a test…');
        save().then(function () { var cur = current(); return api('promo/test', { to: testTo.value, subject: cur.subject, html: cur.html, text: cur.text_body }); }).then(function (j) {
          b.disabled = false;
          say(j.ok ? 'Test sent to ' + testTo.value + '. Check your inbox (and spam, the first time).' : j.error === 'email' ? 'Check the address.' : j.error === 'no_resend' ? 'Sending isn’t switched on yet (RESEND_API_KEY).' : 'Couldn’t send the test' + (j.message ? ': ' + j.message : '.'), j.ok ? 'ok' : 'err');
        });
      } } })])]),
      h('div', { cls: 'pm-act' }, [h('h3', { text: 'Schedule' }), h('div', { cls: 'pm-row' }, [at, h('button', { type: 'button', cls: 'eo-btn', text: c.status === 'scheduled' ? 'Change time' : 'Schedule', on: { click: function () {
        var why = ready(); if (why) { say(why, 'err'); return; }
        var t = new Date(at.value); if (isNaN(t) || t < new Date(Date.now() - 60000)) { say('Pick a time in the future.', 'err'); return; }
        if (!confirm('Send this email to ' + n + ' guest' + (n === 1 ? '' : 's') + ' on ' + when(t) + '?')) return;
        save().then(function () { return P.ctx.sb.from('promo_campaigns').update({ status: 'scheduled', scheduled_at: t.toISOString(), error: '' }).eq('id', c.id); }).then(function (r) {
          if (r.error) { say('Couldn’t schedule it.', 'err'); return; }
          say('Scheduled for ' + when(t) + '. It goes out within 5 minutes of that time.', 'ok'); openEmail(c.id);
        });
      } } })]), h('small', { text: 'New York time. It goes out within 5 minutes of the time you pick.' })]),
      h('div', { cls: 'pm-act pm-now' }, [h('h3', { text: 'Send now' }), h('p', { cls: 'pm-n', text: 'To ' + n + ' guest' + (n === 1 ? '' : 's') + ' on the list.' }), h('button', { type: 'button', cls: 'eo-btn pm-sendnow', text: 'Send now', disabled: !n, on: { click: function () {
        var why = ready(); if (why) { say(why, 'err'); return; }
        if (!confirm('Send “' + current().subject + '” to ' + n + ' guest' + (n === 1 ? '' : 's') + ' now? This can’t be undone.')) return;
        var b = this; b.disabled = true; say('Sending…');
        save().then(function () { return P.ctx.sb.from('promo_campaigns').update({ status: 'scheduled', scheduled_at: new Date().toISOString(), error: '' }).eq('id', c.id); }).then(function (r) {
          if (r.error) { b.disabled = false; say('Couldn’t send it.', 'err'); return; }
          return api('promo/run', {}).then(function (j) {
            say(j.error === 'no_resend' ? 'Saved to go out, but sending isn’t switched on yet (RESEND_API_KEY).' : j.error ? 'It’s queued and will go out within 5 minutes.' : 'Sending. You’ll see the results here as they come in.', j.error ? 'err' : 'ok');
            openEmail(c.id);
          });
        });
      } } })])
    ]);
    var top = h('div', { cls: 'pm-edtop' }, [back, state]);
    if (c.status === 'scheduled') top.appendChild(h('div', { cls: 'pm-sched' }, [h('b', { text: 'Scheduled for ' + when(c.scheduled_at) }), h('button', { type: 'button', cls: 'pm-link', text: 'Don’t send (back to draft)', on: { click: function () {
      P.ctx.sb.from('promo_campaigns').update({ status: 'draft', scheduled_at: null }).eq('id', c.id).then(function () { say('Back to a draft.', 'ok'); openEmail(c.id); });
    } } })]));
    if (c.status === 'failed') top.appendChild(h('div', { cls: 'pm-sched is-err' }, [h('b', { text: 'This email didn’t finish sending' }), h('span', { text: c.error || '' })]));
    body.appendChild(top);
    body.appendChild(h('div', { cls: 'pm-ed' }, [
      h('div', { cls: 'pm-form eo-card' }, [
        field('Subject', subj), field('Preview text', pre, 'Shown after the subject in most inboxes.'),
        h('div', { cls: 'pm-f' }, [h('span', { text: 'Photo' }), photo, file]),
        field('Heading', head), field('Message', msg),
        h('div', { cls: 'pm-f' }, [h('span', { text: 'Button' }), presets, h('div', { cls: 'pm-two' }, [bt, bu])]),
        field('Sign-off', sign),
        h('div', { cls: 'pm-foot' }, [h('button', { type: 'button', cls: 'pm-link pm-del', text: 'Delete this email', on: { click: function () {
          if (!confirm('Delete this email?')) return;
          P.ctx.sb.from('promo_campaigns').delete().eq('id', c.id).then(function (r) { if (r.error) say('Couldn’t delete it.', 'err'); else location.hash = '#promo'; });
        } } })])
      ]),
      h('div', { cls: 'pm-side' }, [pv, acts])
    ]));
    paintPreview();
    window.addEventListener('beforeunload', function () { if (dirty) save(); }, { once: true });
    P.leave = function () { if (dirty) save(); };
  }
  function local(d) { var z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 16); }
  // photos are made at most 1200 px wide, as JPEG, so the email loads quickly
  function shrink(f) {
    return new Promise(function (ok, no) {
      var img = new Image(), url = URL.createObjectURL(f);
      img.onload = function () {
        var w = Math.min(1200, img.naturalWidth), hh = Math.round(img.naturalHeight * w / img.naturalWidth);
        var cv = document.createElement('canvas'); cv.width = w; cv.height = hh;
        var x = cv.getContext('2d'); x.fillStyle = '#fff'; x.fillRect(0, 0, w, hh); x.drawImage(img, 0, 0, w, hh);
        URL.revokeObjectURL(url);
        cv.toBlob(function (b) { b ? ok(b) : no(new Error('image')); }, 'image/jpeg', 0.85);
      };
      img.onerror = function () { URL.revokeObjectURL(url); no(new Error('image')); };
      img.src = url;
    });
  }

  /* ---------- results of a sent email ---------- */
  function results(body, c) {
    var s = ((P.over || {}).stats || {})[c.id] || { sent: 0, delivered: 0, opened: 0, clicked: 0, bounced: 0, complained: 0, unsubscribed: 0, failed: 0 };
    body.appendChild(h('div', { cls: 'pm-edtop' }, [h('a', { cls: 'pm-back', href: '#promo', text: '‹ All emails' }),
      h('button', { type: 'button', cls: 'eo-btn small', text: 'Use as a new email', on: { click: function () {
        var row = { subject: c.subject, preheader: c.preheader, design: c.design, html: c.html, text_body: c.text_body, status: 'draft' };
        P.ctx.sb.from('promo_campaigns').insert(row).select('id').single().then(function (r) { if (!r.error) location.hash = '#promo/e/' + r.data.id; });
      } } })]));
    body.appendChild(h('div', { cls: 'pm-res-h' }, [h('span', { cls: 'pm-pill pm-' + c.status, text: c.status === 'sending' ? 'Sending' : 'Sent' }), h('h2', { text: c.subject }), h('p', { text: c.status === 'sending' ? 'Started ' + when(c.started_at) + '. Refresh in a minute to see it finish.' : 'Sent ' + when(c.sent_at) })]));
    var tiles = [['Sent', s.sent, ''], ['Delivered', s.delivered, pct(s.delivered, s.sent)], ['Opened', s.opened, pct(s.opened, s.sent)], ['Clicked', s.clicked, pct(s.clicked, s.sent)], ['Unsubscribed', s.unsubscribed, ''], ['Bounced', s.bounced + s.complained, '']];
    body.appendChild(h('div', { cls: 'pm-tiles' }, tiles.map(function (t) { return h('div', { cls: 'pm-tile' }, [h('b', { text: t[2] || String(t[1] || 0) }), h('span', { text: t[0] + (t[2] ? ' · ' + (t[1] || 0) : '') })]); })));
    body.appendChild(h('p', { cls: 'pm-fine', text: 'Opens are approximate: some email apps open every email by themselves (Apple Mail), and some block it. Clicks are the better sign of interest. Bounced and complaining addresses are taken off the list automatically.' }));
    var q = h('input', { type: 'search', cls: 'pm-q', placeholder: 'Find a guest', 'aria-label': 'Find a guest' });
    var tbl = h('div', { cls: 'pm-sends' }, [h('p', { cls: 'ps-src', text: 'Loading…' })]);
    body.appendChild(h('section', { cls: 'eo-card pm-who' }, [h('div', { cls: 'pm-who-h' }, [h('h3', { cls: 'eo-h', text: 'Who it went to' }), q]), tbl]));
    var frameEl = h('iframe', { cls: 'pm-preview', title: 'The email that was sent', sandbox: 'allow-same-origin' }); frameEl.srcdoc = String(c.html || '').split('{{unsubscribe_url}}').join('#');
    body.appendChild(h('details', { cls: 'eo-card pm-sentcopy' }, [h('summary', { text: 'See the email' }), h('div', { cls: 'pm-pv-in' }, frameEl)]));
    P.ctx.sb.from('promo_sends').select('email,status,delivered_at,opened_at,clicked_at,open_count,click_count,error').eq('campaign_id', c.id).order('email').limit(5000).then(function (r) {
      var rows = r.data || [];
      function paint() {
        var w = q.value.trim().toLowerCase(), list = rows.filter(function (x) { return !w || x.email.indexOf(w) !== -1; });
        tbl.innerHTML = '';
        if (!list.length) { tbl.appendChild(h('p', { cls: 'ps-src', text: rows.length ? 'No one matches.' : 'Nobody yet.' })); return; }
        tbl.appendChild(h('table', { cls: 'pm-table' }, [h('thead', h('tr', [h('th', { text: 'Guest' }), h('th', { text: 'Delivered' }), h('th', { text: 'Opened' }), h('th', { text: 'Clicked' })])),
          h('tbody', list.slice(0, 1000).map(function (x) {
            var bad = x.status === 'bounced' ? 'Bounced' : x.status === 'complained' ? 'Marked as spam' : x.status === 'failed' ? 'Not sent' : '';
            return h('tr', { cls: bad ? 'is-bad' : null }, [h('td', { text: x.email }), h('td', { text: bad || (x.delivered_at ? '✓' : '…') }), h('td', { text: x.opened_at ? '✓' + (x.open_count > 1 ? ' ×' + x.open_count : '') : '' }), h('td', { text: x.clicked_at ? '✓' : '' })]);
          }))]));
        if (list.length > 1000) tbl.appendChild(h('p', { cls: 'ps-src', text: 'Showing the first 1,000. Search to find someone.' }));
      }
      q.addEventListener('input', paint); paint();
    });
  }

  /* ---------- Guest list ---------- */
  var STAT = { subscribed: 'Subscribed', unsubscribed: 'Unsubscribed', bounced: 'Bounced', complained: 'Marked as spam' };
  var SRC = { upload: 'Uploaded', website: 'Website', manual: 'Added by hand' };
  function showList() {
    var wrap = frame('list');
    var body = h('div', { cls: 'pm-body' }, [h('p', { cls: 'ps-src', text: 'Loading…' })]); wrap.appendChild(body);
    Promise.all([overview(), P.ctx.sb.from('promo_contacts').select('id,email,name,source,status,created_at,unsubscribed_at').order('created_at', { ascending: false }).limit(20000)]).then(function (x) {
      var r = x[1]; body.innerHTML = '';
      if (r.error) { if (gone(r.error)) missing(body); else body.appendChild(h('p', { cls: 'eo-err', text: 'Couldn’t load the guest list.' })); return; }
      var all = r.data || [], filt = 'subscribed';
      var cnt = function (st) { return all.filter(function (c) { return !st || c.status === st || (st === 'bounced' && c.status === 'complained'); }).length; };
      var web = all.filter(function (c) { return c.source === 'website' && c.status === 'subscribed'; }).length;
      body.appendChild(h('div', { cls: 'pm-tiles pm-tiles-sm' }, [
        h('div', { cls: 'pm-tile' }, [h('b', { text: String(cnt('subscribed')) }), h('span', { text: 'Subscribed' })]),
        h('div', { cls: 'pm-tile' }, [h('b', { text: String(web) }), h('span', { text: 'Joined on edencny.com' })]),
        h('div', { cls: 'pm-tile' }, [h('b', { text: String(cnt('unsubscribed')) }), h('span', { text: 'Unsubscribed' })]),
        h('div', { cls: 'pm-tile' }, [h('b', { text: String(cnt('bounced')) }), h('span', { text: 'Bounced or spam' })])
      ]));
      // upload + add one
      var up = h('input', { type: 'file', accept: '.csv,.xlsx,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel', hidden: true });
      up.addEventListener('change', function () { var f = up.files && up.files[0]; up.value = ''; if (f) readSheet(f); });
      var em = h('input', { type: 'email', placeholder: 'guest@example.com', 'aria-label': 'Email' }), nm = h('input', { type: 'text', placeholder: 'Name (optional)', 'aria-label': 'Name' });
      body.appendChild(h('div', { cls: 'pm-addrow' }, [
        h('section', { cls: 'eo-card' }, [h('h3', { cls: 'eo-h', text: 'Upload a guest list' }), h('p', { cls: 'pm-fine', text: 'A spreadsheet (Excel or CSV) with an email column, and names if you have them: for example an export from OpenTable or Square. Only include guests who agreed to hear from Eden. Anyone who unsubscribed stays unsubscribed.' }),
          h('button', { type: 'button', cls: 'eo-btn', text: 'Choose a file', on: { click: function () { up.click(); } } }), up]),
        h('section', { cls: 'eo-card' }, [h('h3', { cls: 'eo-h', text: 'Add a guest' }), h('div', { cls: 'pm-row' }, [em, nm]), h('button', { type: 'button', cls: 'eo-btn', text: 'Add', on: { click: function () {
          addRows([{ email: em.value, name: nm.value }], 'manual').then(function (res) { if (res && res.added) { em.value = ''; nm.value = ''; } });
        } } })])
      ]));
      // the list
      var q = h('input', { type: 'search', cls: 'pm-q', placeholder: 'Find a guest', 'aria-label': 'Find a guest' });
      var chips = h('div', { cls: 'pm-seg', role: 'group', 'aria-label': 'Show' });
      [['subscribed', 'Subscribed'], ['unsubscribed', 'Unsubscribed'], ['bounced', 'Bounced'], ['', 'Everyone']].forEach(function (f) {
        chips.appendChild(h('button', { type: 'button', 'aria-pressed': f[0] === filt ? 'true' : 'false', text: f[1], on: { click: function () { filt = f[0]; chips.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.textContent === f[1] ? 'true' : 'false'); }); paint(); } } }));
      });
      var tbl = h('div');
      body.appendChild(h('section', { cls: 'eo-card pm-who' }, [h('div', { cls: 'pm-who-h' }, [h('h3', { cls: 'eo-h', text: 'Guests' }), chips, q,
        h('button', { type: 'button', cls: 'pm-link', text: 'Download the list', on: { click: function () { exportCsv(all); } } })]), tbl]));
      function paint() {
        var w = q.value.trim().toLowerCase();
        var list = all.filter(function (c) { return (!filt || c.status === filt || (filt === 'bounced' && c.status === 'complained')) && (!w || (c.email + ' ' + c.name).toLowerCase().indexOf(w) !== -1); });
        tbl.innerHTML = '';
        if (!list.length) { tbl.appendChild(h('p', { cls: 'ps-src', text: all.length ? 'No one here.' : 'No guests yet. Upload a list or add someone.' })); return; }
        tbl.appendChild(h('table', { cls: 'pm-table' }, [h('thead', h('tr', [h('th', { text: 'Email' }), h('th', { text: 'Name' }), h('th', { text: 'From' }), h('th', { text: 'Added' }), h('th')])),
          h('tbody', list.slice(0, 500).map(function (c) {
            return h('tr', [h('td', { text: c.email }), h('td', { text: c.name || '' }), h('td', { text: SRC[c.source] || c.source }), h('td', { text: day(c.created_at) }),
              h('td', { cls: 'pm-tdact' }, c.status === 'subscribed' ? h('button', { type: 'button', cls: 'pm-link', text: 'Unsubscribe', on: { click: function () {
                if (!confirm('Unsubscribe ' + c.email + '? They won’t get Eden’s emails anymore.')) return;
                P.ctx.sb.from('promo_contacts').update({ status: 'unsubscribed' }).eq('id', c.id).then(function (r2) { if (r2.error) { say('Couldn\u2019t unsubscribe them.', 'err'); return; } showList(); setTimeout(function () { say(c.email + ' unsubscribed.', 'ok'); }, 300); });
              } } }) : h('span', { cls: 'pm-st', text: STAT[c.status] || c.status }))]);
          }))]));
        if (list.length > 500) tbl.appendChild(h('p', { cls: 'ps-src', text: 'Showing 500 of ' + list.length + '. Search to find someone.' }));
      }
      q.addEventListener('input', paint); paint();
    });
  }
  function addRows(rows, source) {
    say('Adding…');
    var chunks = []; for (var i = 0; i < rows.length; i += 2000) chunks.push(rows.slice(i, i + 2000));
    var tot = { added: 0, already: 0, invalid: 0, unsubscribed: 0 };
    return chunks.reduce(function (p, ch) {
      return p.then(function () { return P.ctx.sb.rpc('promo_import', { p_rows: ch, p_source: source }).then(function (r) {
        if (r.error || !r.data || r.data.error) throw r.error || new Error('import');
        Object.keys(tot).forEach(function (k) { tot[k] += r.data[k] || 0; });
      }); });
    }, Promise.resolve()).then(function () {
      var bits = [tot.added + ' added'];
      if (tot.already) bits.push(tot.already + ' already on the list' + (tot.unsubscribed ? ' (' + tot.unsubscribed + ' unsubscribed, kept that way)' : ''));
      if (tot.invalid) bits.push(tot.invalid + ' not a valid email address');
      say(bits.join(' · ') + '.', tot.added ? 'ok' : '');
      var keep = P.el.querySelector('.pm-msg').textContent;
      showList(); setTimeout(function () { say(keep, 'ok'); }, 300);
      return tot;
    }, function (e) { say(gone(e) ? 'Run supabase/promo-emails.sql in Supabase first.' : 'Couldn’t add them. Try again.', 'err'); return null; });
  }
  // a spreadsheet: find the email column (and names), then confirm before adding
  function readSheet(f) {
    say('Reading ' + f.name + '…');
    var reader = /\.csv$/i.test(f.name) || f.type === 'text/csv' ? f.text().then(function (t) { return parseCsv(t); }) :
      loadXlsx().then(function (X) { return f.arrayBuffer().then(function (buf) { var wb = X.read(buf, { type: 'array' }); return X.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' }); }); });
    reader.then(function (rows) {
      var res = pickColumns(rows);
      if (!res.rows.length) { say('No email addresses found in ' + f.name + '.', 'err'); return; }
      var ok = res.rows.filter(function (r) { return /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i.test(r.email); });
      var back = h('div', { cls: 'sc-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Upload a guest list' });
      var agree = h('input', { type: 'checkbox' });
      back.appendChild(h('div', { cls: 'sc-card' }, [
        h('div', { cls: 'sc-card-h' }, [h('h2', { text: 'Add ' + ok.length + ' guest' + (ok.length === 1 ? '' : 's') + '?' }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: function () { back.remove(); } } })]),
        h('div', { cls: 'sc-card-b' }, [
          h('p', { text: 'From ' + f.name + ': emails from the “' + res.emailCol + '” column' + (res.nameCol ? ', names from “' + res.nameCol + '”' : '') + '.' + (res.statusCol ? ' Only guests marked subscribed in “' + res.statusCol + '” are included' + (res.notSubscribed ? '; ' + res.notSubscribed + ' who unsubscribed or never subscribed are left out' : '') + '.' : '') + (res.rows.length - ok.length ? ' ' + (res.rows.length - ok.length) + ' row' + (res.rows.length - ok.length === 1 ? '' : 's') + ' without a valid email will be skipped.' : '') }),
          h('ul', { cls: 'pm-sample' }, ok.slice(0, 5).map(function (r) { return h('li', { text: r.email + (r.name ? ' · ' + r.name : '') }); }).concat(ok.length > 5 ? [h('li', { text: '…and ' + (ok.length - 5) + ' more' })] : [])),
          h('label', { cls: 'sc-check' }, [agree, ' These guests agreed to receive emails from Eden.'])
        ]),
        h('div', { cls: 'sc-card-f' }, [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { back.remove(); } } }),
          h('button', { type: 'button', cls: 'ed-btn', text: 'Add them', on: { click: function () { if (!agree.checked) { alert('Please confirm these guests agreed to receive Eden’s emails.'); return; } back.remove(); addRows(ok, 'upload'); } } })])
      ]));
      document.body.appendChild(back); say('');
    }, function () { say('Couldn’t read that file. Save it as Excel (.xlsx) or CSV and try again.', 'err'); });
  }
  function parseCsv(t) {
    var rows = [], row = [], cell = '', q = false;
    t = String(t || '').replace(/^﻿/, '');
    for (var i = 0; i < t.length; i++) {
      var ch = t[i];
      if (q) { if (ch === '"') { if (t[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; continue; }
      if (ch === '"') q = true; else if (ch === ',' || ch === ';' || ch === '\t') { row.push(cell); cell = ''; }
      else if (ch === '\n' || ch === '\r') { if (ch === '\r' && t[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += ch;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function pickColumns(rows) {
    rows = (rows || []).filter(function (r) { return r && r.some(function (x) { return String(x).trim(); }); });
    if (!rows.length) return { rows: [] };
    var isEmail = function (v) { return /@[^\s@]+\.[a-z]{2,}/i.test(String(v)); };
    var head = rows[0].map(function (x) { return String(x).trim(); }), hasHead = !head.some(isEmail);
    var data = hasHead ? rows.slice(1) : rows, width = Math.max.apply(null, rows.map(function (r) { return r.length; }));
    var ei = -1;
    var mostly = function (c) { var n = data.filter(function (r) { return String(r[c] || '').trim(); }); return n.length && n.filter(function (r) { return isEmail(r[c]); }).length >= n.length / 2; };
    if (hasHead) head.forEach(function (x, i) { if (ei < 0 && /e-?mail/i.test(x) && mostly(i)) ei = i; });   // e.g. Wix's "Email 1", not "Email subscriber status"
    if (ei < 0) { var best = 0; for (var c = 0; c < width; c++) { var n = data.filter(function (r) { return isEmail(r[c]); }).length; if (n > best) { best = n; ei = c; } } }
    if (ei < 0) return { rows: [] };
    var find = function (re) { var k = -1; head.forEach(function (x, i) { if (k < 0 && i !== ei && re.test(x)) k = i; }); return k; };
    var full = hasHead ? find(/^(guest |full |customer )?name$|^guest$/i) : -1, first = hasHead ? find(/first/i) : -1, last = hasHead ? find(/last|surname/i) : -1;
    // a subscription column (Wix, Square, Mailchimp exports): only bring in people still subscribed
    var si = hasHead ? find(/subscri|marketing|consent|opt.?in/i) : -1, skipped = 0;
    if (si >= 0) data = data.filter(function (r) { var v = String(r[si] || '').trim().toLowerCase(); var yes = /^(subscribed|yes|true|opted.?in|subscribed.*)$/.test(v) && !/un|never|not|no\b/.test(v); if (!yes) skipped++; return yes; });
    var out = data.map(function (r) {
      var nm = full >= 0 ? r[full] : [first >= 0 ? r[first] : '', last >= 0 ? r[last] : ''].join(' ');
      return { email: String(r[ei] || '').trim().replace(/^mailto:/i, ''), name: String(nm || '').replace(/\s+/g, ' ').trim() };
    }).filter(function (r) { return r.email; });
    return { rows: out, emailCol: hasHead ? head[ei] || 'email' : 'column ' + (ei + 1), nameCol: full >= 0 ? head[full] : first >= 0 || last >= 0 ? [head[first], head[last]].filter(Boolean).join(' + ') : '', statusCol: si >= 0 ? head[si] : '', notSubscribed: skipped };
  }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = function () { window.XLSX ? ok(window.XLSX) : no(new Error('xlsx')); }; s.onerror = function () { no(new Error('xlsx')); };
      document.head.appendChild(s);
    });
  }
  function exportCsv(all) {
    var rows = [['email', 'name', 'status', 'from', 'added']].concat(all.map(function (c) { return [c.email, c.name || '', c.status, SRC[c.source] || c.source, (c.created_at || '').slice(0, 10)]; }));
    var csv = rows.map(function (r) { return r.map(function (v) { v = String(v == null ? '' : v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }).join(','); }).join('\n');
    var a = h('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'Eden guest list ' + new Date().toISOString().slice(0, 10) + '.csv' });
    document.body.appendChild(a); a.click(); a.remove();
  }

  window.EdenPromo = { show: show, hide: function () { if (P.leave) { P.leave(); P.leave = null; } }, _test: { buildEmail: buildEmail, pickColumns: pickColumns, parseCsv: parseCsv } };
})();
