/* Eden staff site: Business email (the Owner and managers).
 *
 * Your Google Workspace mailboxes, inside the staff site. Nothing is copied here: every list, conversation and
 * attachment comes straight from Gmail each time, and every action (send, reply, forward, delete, archive,
 * move to a folder, star, mark read or unread, spam) is done in Gmail itself. So whatever you do here shows in
 * Gmail, and whatever you do in Gmail (or on your phone) shows here the next time the list refreshes (every
 * minute while this page is open, or with Refresh).
 *
 * Who sees what: the Owner chooses who can open each mailbox (Manage mailboxes); a manager can also connect
 * their own. The database enforces it (supabase/business-email.sql); the worker talks to Gmail (mail-worker.js).
 */
(function () {
  'use strict';

  var M = { ctx: null, el: null, cfg: null, accounts: [], people: [], acct: '', prof: {}, label: 'INBOX', q: '', threads: [], next: '', back: [], page: '',
    sel: {}, open: '', thread: null, unreadOnly: false, sigs: {}, sigMissing: false, busy: false, loaded: false, missingSql: false, timer: null, unread: {}, listSeq: 0 };
  var SYS = [['INBOX', 'Inbox'], ['STARRED', 'Starred'], ['SENT', 'Sent'], ['ALL', 'All mail'], ['SPAM', 'Spam'], ['TRASH', 'Trash']];
  var MAX_ATTACH = 18 * 1024 * 1024;

  /* ---------- small helpers ---------- */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (Array.isArray(attrs) || typeof attrs === 'string') { kids = attrs; attrs = null; }
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else if (k === 'cls') e.className = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function btn(text, fn, cls, attrs) { return h('button', Object.assign({ type: 'button', cls: 'ed-btn small' + (cls ? ' ' + cls : ''), text: text, on: { click: fn } }, attrs || {})); }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function say(t, k) { if (M.ctx) M.ctx.status(t, k); }
  function token() { return M.ctx.sb.auth.getSession().then(function (r) { return (r && r.data && r.data.session && r.data.session.access_token) || ''; }); }
  function post(path, body) {
    return token().then(function (jwt) {
      return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify(body) });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || (j && j.error)) { var e = new Error((j && j.message) || 'Something went wrong (' + r.status + ').'); e.code = (j && j.error) || 'http'; e.http = r.status; throw e; }
        return j;
      });
    }, function (e) { if (e && e.code) throw e; var x = new Error('Couldn’t reach the staff site. Check your connection.'); x.code = 'network'; throw x; });
  }
  function api(op, body) {
    return post('mail/api', Object.assign({ account: M.acct, op: op }, body || {})).catch(function (e) {
      if (e.code === 'reconnect') { var a = acct(); if (a) a.status = 'reconnect'; paintSide(); }
      throw e;
    });
  }
  function acct(id) { id = id || M.acct; return M.accounts.filter(function (a) { return a.id === id; })[0] || null; }
  function mine() { return M.accounts.filter(function (a) { return a.mine; }); }
  // mailboxes in the order set in js/config.js (mailOrder), then A to Z
  function sortAccounts(list) {
    var order = ((window.EDEN_STAFF_CONFIG || {}).mailOrder || []).map(function (x) { return String(x).toLowerCase(); });
    var rank = function (a) { var i = order.indexOf(String(a.address || '').toLowerCase()); return i === -1 ? order.length : i; };
    return (list || []).slice().sort(function (a, b) { return rank(a) - rank(b) || String(a.address).localeCompare(String(b.address)); });
  }
  function isOwner() { return M.ctx && M.ctx.role === 'owner'; }
  function rememberAcct(id) { try { localStorage.setItem('eden-mail-acct', id); } catch (e) {} }
  function savedAcct() { try { return localStorage.getItem('eden-mail-acct') || ''; } catch (e) { return ''; } }

  // "Ann Lee" <ann@x.com>, bob@y.com  ->  [{ name, email }]
  function splitAddrs(s) {
    var out = [], cur = '', q = false, depth = 0;
    String(s || '').split('').forEach(function (c) {
      if (c === '"') q = !q;
      if (!q && c === '<') depth++; if (!q && c === '>') depth = Math.max(0, depth - 1);
      if ((c === ',' || c === ';') && !q && !depth) { out.push(cur); cur = ''; } else cur += c;
    });
    out.push(cur);
    return out.map(function (x) { return x.trim(); }).filter(Boolean).map(parseAddr);
  }
  function parseAddr(x) {
    var m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(x);
    if (m) return { name: m[1].trim(), email: m[2].trim() };
    return { name: '', email: x.trim() };
  }
  function who(x) { var a = parseAddr(x || ''); return a.name || a.email; }
  function shortDate(ms) {
    if (!ms) return '';
    var d = new Date(ms), n = new Date();
    if (d.toDateString() === n.toDateString()) return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (d.getFullYear() === n.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' });
  }
  function longDate(ms) { return ms ? new Date(ms).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  function size(n) { return n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function labelName(id) {
    var s = SYS.filter(function (x) { return x[0] === id; })[0]; if (s) return s[1];
    var l = ((M.prof[M.acct] || {}).labels || []).filter(function (x) { return x.id === id; })[0];
    return l ? l.name : id;
  }
  function userLabels() {
    return ((M.prof[M.acct] || {}).labels || []).filter(function (l) { return l.type === 'user'; }).sort(function (a, b) { return a.name.localeCompare(b.name); });
  }

  /* ---------- base64 and decoding ---------- */
  function b64uToBytes(s) { var bin = atob(String(s || '').replace(/-/g, '+').replace(/_/g, '/')); var out = new Uint8Array(bin.length); for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
  function bytesToB64(bytes) { var s = ''; for (var i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  function utf8B64(s) { return bytesToB64(new TextEncoder().encode(s)); }
  function wrap76(s) { return s.replace(/(.{76})/g, '$1\r\n'); }
  function decodeText(data, charset) {
    var bytes = b64uToBytes(data);
    try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch (e) { return new TextDecoder('utf-8').decode(bytes); }
  }
  function headerMap(part) { var o = {}; ((part && part.headers) || []).forEach(function (x) { o[x.name.toLowerCase()] = x.value; }); return o; }
  function parseMessage(m) {
    var out = { id: m.id, labels: m.labelIds || [], date: Number(m.internalDate) || 0, snippet: m.snippet || '', text: null, html: null, htmlAtt: null, textAtt: null, atts: [] };
    out.h = headerMap(m.payload);
    (function walk(p) {
      if (!p) return;
      var mt = String(p.mimeType || '').toLowerCase(), ph = headerMap(p);
      var cs = (/charset="?([^";]+)"?/i.exec(ph['content-type'] || '') || [])[1];
      var disp = String(ph['content-disposition'] || '').toLowerCase();
      if (p.parts && p.parts.length) { p.parts.forEach(walk); return; }
      var cid = String(ph['content-id'] || '').replace(/[<>]/g, '');
      var isFile = !!p.filename || (disp.indexOf('attachment') === 0);
      if (!isFile && mt === 'text/html' && out.html === null) { if (p.body && p.body.data) out.html = decodeText(p.body.data, cs); else if (p.body && p.body.attachmentId) { out.html = ''; out.htmlAtt = { id: p.body.attachmentId, cs: cs }; } return; }
      if (!isFile && mt === 'text/plain' && out.text === null) { if (p.body && p.body.data) out.text = decodeText(p.body.data, cs); else if (p.body && p.body.attachmentId) { out.text = ''; out.textAtt = { id: p.body.attachmentId, cs: cs }; } return; }
      if (p.body && (p.body.attachmentId || p.body.data)) out.atts.push({ id: p.body.attachmentId || '', data: p.body.data || '', name: p.filename || (cid ? 'image' : 'attachment'), mime: mt, size: p.body.size || 0, cid: cid, inline: !!cid && disp.indexOf('attachment') !== 0 });
    })(m.payload);
    return out;
  }
  function attData(msgId, a) {
    if (a.data) return Promise.resolve(b64uToBytes(a.data));
    return api('attachment', { msg: msgId, id: a.id }).then(function (j) { return b64uToBytes(j.data); });
  }

  /* ---------- building an email to send (done here, so the worker only passes it to Gmail) ---------- */
  function encWord(s) {
    if (!/[^\x20-\x7e]/.test(s)) return s;
    var chunks = [], cur = '', curBytes = 0;
    Array.from(s).forEach(function (ch) { var n = new TextEncoder().encode(ch).length; if (curBytes + n > 42) { chunks.push(cur); cur = ''; curBytes = 0; } cur += ch; curBytes += n; });
    if (cur) chunks.push(cur);
    return chunks.map(function (c) { return '=?UTF-8?B?' + utf8B64(c) + '?='; }).join('\r\n ');
  }
  function addrHeader(list) {
    return list.map(function (a) {
      if (!a.name) return a.email;
      return (/[^\x20-\x7e]/.test(a.name) ? encWord(a.name) : '"' + a.name.replace(/["\\]/g, '') + '"') + ' <' + a.email + '>';
    }).join(',\r\n ');
  }
  function textToHtml(t) {
    return esc(t).split(/\n{2,}/).map(function (p) { return '<p style="margin:0 0 12px">' + p.replace(/\n/g, '<br>') + '</p>'; }).join('')
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
  }
  function htmlToText(html) {
    var d = document.createElement('div'); d.innerHTML = String(html || '').replace(/<(br|\/p|\/div|\/tr|\/li|\/h\d)[^>]*>/gi, '$&\n');
    d.querySelectorAll('style,script,head,title').forEach(function (x) { x.remove(); });
    return (d.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function buildRaw(o) {
    var B = function () { return 'eden_' + Math.random().toString(36).slice(2) + Date.now().toString(36); };
    var lines = ['From: ' + addrHeader([o.from])];
    if (o.to.length) lines.push('To: ' + addrHeader(o.to));
    if (o.cc.length) lines.push('Cc: ' + addrHeader(o.cc));
    if (o.bcc.length) lines.push('Bcc: ' + addrHeader(o.bcc));
    lines.push('Subject: ' + encWord(o.subject || ''));
    if (o.inReplyTo) lines.push('In-Reply-To: ' + o.inReplyTo);
    if (o.references) lines.push('References: ' + o.references);
    lines.push('MIME-Version: 1.0');
    var alt = B();
    var htmlPart = 'Content-Type: text/html; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap76(utf8B64(o.html));
    // pictures carried inside the email (the sign-off's E), so they show even where outside pictures are blocked
    if (o.inline && o.inline.length) {
      var rel = B();
      htmlPart = 'Content-Type: multipart/related; boundary="' + rel + '"\r\n\r\n--' + rel + '\r\n' + htmlPart +
        o.inline.map(function (p) { return '\r\n--' + rel + '\r\nContent-Type: ' + p.mime + '; name="' + p.name + '"\r\nContent-Transfer-Encoding: base64\r\nContent-ID: <' + p.cid + '>\r\nContent-Disposition: inline; filename="' + p.name + '"\r\n\r\n' + wrap76(bytesToB64(p.bytes)); }).join('') +
        '\r\n--' + rel + '--';
    }
    var altBody = '--' + alt + '\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap76(utf8B64(o.text)) +
      '\r\n--' + alt + '\r\n' + htmlPart + '\r\n--' + alt + '--';
    if (!o.atts.length) { lines.push('Content-Type: multipart/alternative; boundary="' + alt + '"'); return lines.join('\r\n') + '\r\n\r\n' + altBody; }
    var mix = B();
    lines.push('Content-Type: multipart/mixed; boundary="' + mix + '"');
    var parts = ['--' + mix + '\r\nContent-Type: multipart/alternative; boundary="' + alt + '"\r\n\r\n' + altBody];
    o.atts.forEach(function (a) {
      var ascii = a.name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '');
      var star = encodeURIComponent(a.name).replace(/['()*]/g, function (c) { return '%' + c.charCodeAt(0).toString(16).toUpperCase(); });
      parts.push('--' + mix + '\r\nContent-Type: ' + (/^[\w.+-]+\/[\w.+-]+$/.test(a.mime || '') ? a.mime : 'application/octet-stream') + '; name="' + ascii + '"\r\n' +
        'Content-Disposition: attachment; filename="' + ascii + '"' + (ascii !== a.name ? '; filename*=UTF-8\'\'' + star : '') + '\r\nContent-Transfer-Encoding: base64\r\n\r\n' + wrap76(bytesToB64(a.bytes)));
    });
    return lines.join('\r\n') + '\r\n\r\n' + parts.join('\r\n') + '\r\n--' + mix + '--';
  }

  /* ---------- page ---------- */
  function show(ctx) {
    M.ctx = ctx; M.el = ctx.el;
    try { M.unreadOnly = localStorage.getItem('eden-mail-unread') === '1'; } catch (e) {}
    if (!M.el.querySelector('.em')) { M.el.innerHTML = ''; M.el.appendChild(h('p', { cls: 'em-empty', text: 'Opening Business email…' })); }
    var arg = String(ctx.sub || '');
    var first = arg.indexOf('connected?') === 0 ? finishConnect(arg.slice(10)) : Promise.resolve();
    first.then(function () { return load(); }).then(function () {
      render();
      startTimer();
      M.shown = true; flushDraft();
    });
  }
  // a new email started somewhere else on the staff site (Notes > Email): opens once the email page is ready
  function flushDraft() {
    if (!M.pending || !M.shown || !M.el || M.el.hidden || !mine().length) return;
    var o = M.pending; M.pending = null;
    // a draft can ask for a particular mailbox (Payroll emails from rich@edencny.com)
    var want = o.from ? mine().filter(function (a) { return String(a.address || '').toLowerCase() === String(o.from).toLowerCase(); })[0] : null;
    if (want && want.id !== M.acct) { M.acct = want.id; M.label = 'INBOX'; M.q = ''; M.page = ''; M.open = ''; M.thread = null; if (typeof render === 'function') try { render(); } catch (e) {} }
    else if (o.from && !want) say('You don’t have ' + o.from + ' in Business email, so this is from ' + ((acct() && acct().mine ? acct() : mine()[0]).address) + '.', 'err');
    if (!acct() || !acct().mine) M.acct = mine()[0].id;
    compose(o);
  }
  function hide() { stopTimer(); }
  function startTimer() {
    stopTimer();
    M.timer = setInterval(function () {
      if (document.hidden || !M.el || M.el.hidden || !M.acct || M.busy) return;
      if (!M.page && !Object.keys(M.sel).length) loadList(true);
      counts();
    }, 60000);
  }
  function stopTimer() { if (M.timer) clearInterval(M.timer); M.timer = null; }
  document.addEventListener('visibilitychange', function () { if (!document.hidden && M.el && !M.el.hidden && M.acct && !M.page) { loadList(true); counts(); } });

  function load() {
    var st = fetch('mail/status').then(function (r) { return r.ok ? r.json() : { ready: false, missing: [], unknown: true }; }, function () { return { ready: false, missing: [], unknown: true }; });
    var acc = M.ctx.sb.rpc('mail_my_accounts').then(function (r) {
      if (r.error) { M.missingSql = /mail_my_accounts|function|schema cache|not find/i.test(r.error.message || '') || r.error.code === 'PGRST202' || r.error.code === '42883'; return []; }
      M.missingSql = false; return r.data || [];
    });
    var ppl = isOwner() ? M.ctx.sb.from('staff').select('user_id,name,role').in('role', ['owner', 'manager']).then(function (r) { return (r && r.data) || []; }, function () { return []; }) : Promise.resolve([]);
    return Promise.all([st, acc, ppl]).then(function (x) {
      M.cfg = x[0]; M.accounts = sortAccounts(x[1]); M.people = x[2]; M.loaded = true;
      loadSigs();
      var m = mine();
      if (!acct(M.acct) || !acct(M.acct).mine) M.acct = (m.filter(function (a) { return a.id === savedAcct(); })[0] || m[0] || {}).id || '';
    });
  }

  function render() {
    var el = M.el; el.innerHTML = '';
    var root = h('div', { cls: 'em' + (M.open ? ' em-reading' : '') });
    el.appendChild(root);
    if (!M.cfg || !M.cfg.ready || M.missingSql) { root.classList.add('em-setup-only'); root.appendChild(setupCard()); return; }
    if (!mine().length) { root.classList.add('em-setup-only'); root.appendChild(connectCard(true)); return; }
    root.appendChild(h('aside', { cls: 'em-side' }));
    root.appendChild(h('section', { cls: 'em-list', 'aria-label': 'Conversations' }));
    root.appendChild(h('section', { cls: 'em-read', 'aria-label': 'Conversation' }));
    paintSide();
    if (!M.prof[M.acct]) loadProfile().then(function () { paintSide(); loadList(); }, function (e) { paintList(e); });
    else { loadList(); }
    paintReader();
  }

  /* ---------- setup (Owner) ---------- */
  function setupCard() {
    var wrap = h('div', { cls: 'em-setup' });
    wrap.appendChild(h('p', { cls: 'home-eyebrow', text: 'Office · Business email' }));
    wrap.appendChild(h('h1', { cls: 'soon-title', text: 'Business email' }));
    if (!isOwner()) {
      wrap.appendChild(h('div', { cls: 'soon-card' }, [h('p', { text: 'Business email isn’t switched on yet. Once the Owner has set it up, you’ll be able to connect your edencny.com mailbox here.' })]));
      return wrap;
    }
    var miss = (M.cfg && M.cfg.missing) || [];
    var have = function (k) { return M.cfg && !M.cfg.unknown && miss.indexOf(k) === -1; };
    var redirect = (M.cfg && M.cfg.redirect) || (location.origin + '/mail/callback');
    wrap.appendChild(h('p', { cls: 'em-lead', text: 'Your Google Workspace mailboxes, inside the staff site. Everything you do here (reply, delete, archive, move, star) happens in Gmail too, and the other way round. It takes about 15 minutes to set up, once.' }));
    var steps = h('ol', { cls: 'em-steps' });
    function step(done, title, kids) { steps.appendChild(h('li', { cls: done ? 'done' : '' }, [h('b', { text: (done ? '✓ ' : '') + title })].concat(kids))); }
    step(!M.missingSql, 'Add the email tables to the database', [h('p', { text: 'In Supabase, open SQL Editor > New query, paste in the file supabase/business-email.sql from the staff site’s code, and click Run.' })]);
    step(have('GOOGLE_CLIENT_ID') && have('GOOGLE_CLIENT_SECRET'), 'Make a Google sign-in for the staff site', [
      h('p', { text: 'Sign in at console.cloud.google.com with your edencny.com Google account (it must be a Google Workspace admin).' }),
      h('ol', { cls: 'em-sub' }, [
        h('li', { text: 'Create a project named “Eden staff site”.' }),
        h('li', { text: 'APIs & Services > Library: search “Gmail API”, open it, click Enable.' }),
        h('li', { text: 'Google Auth Platform > Branding: app name “Eden staff site”, your email for support and contact. For Audience choose Internal (only people at edencny.com can use it).' }),
        h('li', [ 'Google Auth Platform > Clients > Create client: type Web application, name “Eden staff site”, and under Authorized redirect URIs add ', h('code', { text: redirect }), ' then Create.' ]),
        h('li', { text: 'Copy the Client ID and the Client secret it shows you.' })
      ])]);
    var keyOut = h('input', { cls: 'em-keyout', readonly: true, value: '', 'aria-label': 'Your new MAIL_TOKEN_KEY', placeholder: 'Click Make a key' });
    step(have('GOOGLE_CLIENT_ID') && have('GOOGLE_CLIENT_SECRET') && have('MAIL_TOKEN_KEY'), 'Add three secrets in Cloudflare', [
      h('p', { text: 'Cloudflare > Workers & Pages > eden-admin > Settings > Variables and Secrets > Add. Choose type Secret for each:' }),
      h('ul', { cls: 'em-sub' }, [
        h('li', [h('code', { text: 'GOOGLE_CLIENT_ID' }), ' the Client ID from Google', have('GOOGLE_CLIENT_ID') ? h('span', { cls: 'em-ok', text: ' ✓ added' }) : null]),
        h('li', [h('code', { text: 'GOOGLE_CLIENT_SECRET' }), ' the Client secret from Google', have('GOOGLE_CLIENT_SECRET') ? h('span', { cls: 'em-ok', text: ' ✓ added' }) : null]),
        h('li', [h('code', { text: 'MAIL_TOKEN_KEY' }), ' a long random password that locks the saved Google permissions. Make one here (it’s made on this device and never sent anywhere), copy it into Cloudflare, and don’t keep it anywhere else.', have('MAIL_TOKEN_KEY') ? h('span', { cls: 'em-ok', text: ' ✓ added' }) : null])
      ]),
      h('div', { cls: 'em-keyrow' }, [keyOut, btn('Make a key', function () {
        var b = new Uint8Array(36); crypto.getRandomValues(b); keyOut.value = bytesToB64(b).replace(/\+/g, '-').replace(/\//g, '_');
        keyOut.select();
      }), btn('Copy', function () { if (!keyOut.value) return; (navigator.clipboard ? navigator.clipboard.writeText(keyOut.value) : Promise.reject()).then(function () { say('Key copied. Paste it into Cloudflare as MAIL_TOKEN_KEY.', 'ok'); }, function () { keyOut.select(); }); })]),
      h('p', { cls: 'em-note', text: 'Then click Deploy (or Save and deploy) in Cloudflare.' })]);
    step(false, 'Connect the mailboxes', [h('p', { text: 'Come back to this page. Connect each mailbox by signing in to it with Google, and choose who can open it.' })]);
    wrap.appendChild(steps);
    wrap.appendChild(h('div', { cls: 'em-row' }, [btn('Check again', function () { say('Checking…'); load().then(function () { say(''); render(); }); }, 'em-go')]));
    if (M.cfg && M.cfg.unknown) wrap.appendChild(h('p', { cls: 'em-note', text: 'Couldn’t reach the staff site’s worker to check the settings.' }));
    return wrap;
  }

  /* ---------- connecting a mailbox ---------- */
  function connectCard(first) {
    var wrap = h('div', { cls: first ? 'em-setup' : 'em-connect' });
    if (first) {
      wrap.appendChild(h('p', { cls: 'home-eyebrow', text: 'Office · Business email' }));
      wrap.appendChild(h('h1', { cls: 'soon-title', text: 'Connect a mailbox' }));
      wrap.appendChild(h('p', { cls: 'em-lead', text: isOwner()
        ? 'Sign in to each edencny.com mailbox with Google to bring it here. You choose who can open it: you, or one of your managers. Nothing is copied: the staff site reads and changes the mailbox in Gmail itself.'
        : 'Sign in to your edencny.com mailbox with Google to bring it here. Nothing is copied: the staff site reads and changes your mailbox in Gmail itself.' }));
      if (M.accounts.length && isOwner()) wrap.appendChild(h('p', { cls: 'em-note', text: M.accounts.length + ' mailbox' + (M.accounts.length === 1 ? ' is' : 'es are') + ' connected for other people. Use Manage mailboxes to give yourself access.' }));
    }
    var forSel = null;
    if (isOwner()) {
      forSel = h('select', { cls: 'em-in' }, M.people.slice().sort(function (a, b) { return (a.role === 'owner' ? 0 : 1) - (b.role === 'owner' ? 0 : 1) || a.name.localeCompare(b.name); })
        .map(function (p) { return h('option', { value: p.user_id, text: p.name + (p.role === 'owner' ? ' (you)' : ' (manager)'), selected: p.user_id === M.ctx.uid }); }));
    }
    var hint = h('input', { cls: 'em-in', type: 'email', placeholder: 'name@edencny.com (optional)', autocomplete: 'off' });
    var err = h('p', { cls: 'em-err', role: 'alert' });
    var go = btn('Sign in with Google', function () {
      err.textContent = ''; go.disabled = true; go.textContent = 'Opening Google…';
      post('mail/start', { for: forSel ? forSel.value : '', hint: hint.value.trim() }).then(function (j) { location.href = j.url; }, function (e) {
        err.textContent = e.message; go.disabled = false; go.textContent = 'Sign in with Google';
      });
    }, 'em-go');
    wrap.appendChild(h('div', { cls: 'em-form' }, [
      forSel ? h('label', { cls: 'em-f' }, [h('span', { text: 'Who will use this mailbox?' }), forSel]) : null,
      h('label', { cls: 'em-f' }, [h('span', { text: 'Mailbox address' }), hint]),
      h('p', { cls: 'em-note', text: 'Google will ask you to sign in to that mailbox and allow “Eden staff site” to read, send, delete and organize its email. Tick every box Google shows.' }),
      h('div', { cls: 'em-row' }, [go]), err
    ]));
    return wrap;
  }
  var CONNECT_ERR = {
    denied: 'Google wasn’t given permission, so the mailbox wasn’t connected.',
    scope: 'Google wasn’t given full access to the mailbox. Connect again and tick every box Google shows.',
    norefresh: 'Google didn’t give a lasting permission. Connect again (if it keeps happening, remove “Eden staff site” from the Google account’s Third-party access page first).',
    expired: 'That sign-in took too long. Please connect again.',
    google: 'Google couldn’t complete the sign-in. Check the Client ID, Client secret and redirect address, then try again.',
    not_ready: 'Business email isn’t fully set up yet.'
  };
  function finishConnect(q) {
    var p = new URLSearchParams(q);
    if (p.get('err')) { say(CONNECT_ERR[p.get('err')] || 'The mailbox wasn’t connected.', 'err'); return Promise.resolve(); }
    var k = p.get('k'); if (!k) return Promise.resolve();
    say('Connecting the mailbox…');
    return post('mail/finish', { k: k }).then(function (j) {
      say(j.address + ' is connected. Everything you do here happens in Gmail too.', 'ok');
      M.acct = j.id; rememberAcct(j.id); delete M.prof[j.id]; M.label = 'INBOX'; M.q = ''; M.open = '';
    }, function (e) { say(e.message, 'err'); });
  }

  /* ---------- icons (drawn in the page, so they stay sharp and take the text colour) ---------- */
  var ICONS = {
    pencil: 'M4 20h4L18.5 9.5l-4-4L4 16v4zM13 7l4 4', archive: 'M3.5 5h17v4h-17zM5 9v10h14V9M10 13h4', trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5',
    spam: 'M8.3 3h7.4L21 8.3v7.4L15.7 21H8.3L3 15.7V8.3zM12 7.5v5.5M12 16.2v.3', unread: 'M3.5 6h17v12h-17zM3.5 7l8.5 6 8.5-6', read: 'M3.5 10l8.5-6 8.5 6v9.5h-17zM3.5 10l8.5 6 8.5-6',
    folder: 'M3 6.5h6.5l2 2H21V19H3z', star: 'M12 3.8l2.5 5.1 5.6.8-4 4 .9 5.6-5-2.7-5 2.7.9-5.6-4-4 5.6-.8z', refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3M19.5 4.5v4.6h-4.6',
    back: 'M15 5l-7 7 7 7', prev: 'M15 6l-6 6 6 6', next: 'M9 6l6 6-6 6', reply: 'M10 7l-5 5 5 5M5 12h9.5a5 5 0 0 1 5 5v1.5', replyAll: 'M12 7l-5 5 5 5M7.5 7l-5 5 5 5M7 12h8a5 5 0 0 1 5 5v1.5',
    forward: 'M14 7l5 5-5 5M19 12H9.5a5 5 0 0 0-5 5v1.5', restore: 'M4.5 12a7.5 7.5 0 1 0 2.2-5.3M4.5 4.5v4.6h4.6', search: 'M10.5 4a6.5 6.5 0 1 0 0 13 6.5 6.5 0 0 0 0-13zM20 20l-4.8-4.8',
    clip: 'M15.5 7.5l-6.3 6.3a1.8 1.8 0 0 0 2.6 2.6l6.6-6.6a3.6 3.6 0 0 0-5.1-5.1l-6.9 6.9a5.4 5.4 0 0 0 7.6 7.6l5.5-5.5', check: 'M5 12.5l4.5 4.5L19 7.5', x: 'M6 6l12 12M18 6L6 18',
    send: 'M4 12l16-8-5.5 16-3-6.5z', more: 'M5 12h.01M12 12h.01M19 12h.01', inbox: 'M3.5 13.5L6 5h12l2.5 8.5V19h-17zM3.5 13.5h5l1.2 2h4.6l1.2-2h5', sent: 'M4 12l16-8-5.5 16-3-6.5z',
    all: 'M4.5 7h15M4.5 12h15M4.5 17h15', plus: 'M12 5v14M5 12h14', gmail: 'M14 4h6v6M20 4l-9 9M18 14v5H5V6h5'
  };
  function ico(n, cls) { var s = document.createElement('span'); s.className = 'em-i' + (cls ? ' ' + cls : ''); s.setAttribute('aria-hidden', 'true');
    s.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="' + (n === 'more' ? 3 : 1.6) + '" stroke-linecap="round" stroke-linejoin="round"><path d="' + ICONS[n] + '"/></svg>'; return s; }
  // an icon button; the word is shown beside the icon where there's room, and always read out by screen readers
  function ib(n, label, fn, cls, attrs) {
    return h('button', Object.assign({ type: 'button', cls: 'em-ib' + (cls ? ' ' + cls : ''), title: label, 'aria-label': label, on: { click: fn } }, attrs || {}), [ico(n), h('span', { cls: 'em-ib-t', text: label })]);
  }
  var AV = ['#b0703f', '#7b8a69', '#5d6e7b', '#8b6170', '#a08453', '#6a7d8f', '#9a6a4a'];
  function avatar(nameOrAddr) {
    var a = parseAddr(nameOrAddr || ''), label = a.name || a.email || '?';
    var words = label.replace(/@.*/, '').replace(/[^\p{L}\p{N}\s.'-]/gu, ' ').split(/[\s._-]+/).filter(Boolean);
    var ini = ((words[0] || '?')[0] + (words.length > 1 ? words[words.length - 1][0] : '')).toUpperCase();
    var hsh = 0; String(a.email || label).toLowerCase().split('').forEach(function (c) { hsh = (hsh * 31 + c.charCodeAt(0)) >>> 0; });
    return { ini: ini, color: AV[hsh % AV.length] };
  }
  function when(ms) {
    if (!ms) return '';
    var d = new Date(ms), n = new Date(), t = d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
    if (d.toDateString() === n.toDateString()) return t;
    return d.toLocaleDateString('en-US', d.getFullYear() === n.getFullYear() ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' }) + ', ' + t;
  }
  function splitAddrLabel(addr) { var i = String(addr).indexOf('@'); return i < 0 ? [addr, ''] : [addr.slice(0, i), addr.slice(i)]; }
  function folderIcon(id) { return { INBOX: 'inbox', STARRED: 'star', SENT: 'sent', ALL: 'all', SPAM: 'spam', TRASH: 'trash' }[id] || 'folder'; }

  /* ---------- left: mailboxes and folders ---------- */
  function paintSide() {
    var side = M.el.querySelector('.em-side'); if (!side) return;
    side.innerHTML = '';
    var a = acct(), off = !a || a.status === 'reconnect';
    // wide screens: a quiet column
    var col = h('div', { cls: 'em-col' });
    col.appendChild(h('button', { type: 'button', cls: 'em-compose', disabled: off, on: { click: function () { compose({}); } } }, [ico('pencil'), h('span', { text: 'Write' })]));
    col.appendChild(h('p', { cls: 'em-g', text: mine().length > 1 ? 'Mailboxes' : 'Mailbox' }));
    mine().forEach(function (x) {
      var n = M.unread[x.id] || 0, parts = splitAddrLabel(x.address);
      col.appendChild(h('button', { type: 'button', cls: 'em-box', 'aria-current': x.id === M.acct ? 'true' : 'false', title: x.address, on: { click: function () { switchAcct(x.id); } } }, [
        h('span', { cls: 'em-box-a' }, [h('b', { text: parts[0] }), h('span', { text: parts[1] })]),
        x.status === 'reconnect' ? h('span', { cls: 'em-warn', text: 'Reconnect' }) : (n ? h('span', { cls: 'em-n', text: String(n) }) : null)]));
    });
    col.appendChild(h('p', { cls: 'em-g', text: 'Folders' }));
    SYS.forEach(function (s) {
      var n = s[0] === 'INBOX' ? (M.unread[M.acct] || 0) : 0;
      col.appendChild(h('button', { type: 'button', cls: 'em-fold', 'aria-current': !M.q && M.label === s[0] ? 'true' : 'false', on: { click: function () { goLabel(s[0]); } } }, [ico(folderIcon(s[0])), h('span', { cls: 'em-fold-t', text: s[1] }), n ? h('span', { cls: 'em-n', text: String(n) }) : null]));
    });
    userLabels().forEach(function (l) {
      col.appendChild(h('button', { type: 'button', cls: 'em-fold em-ufold', 'aria-current': !M.q && M.label === l.id ? 'true' : 'false', title: l.name, on: { click: function () { goLabel(l.id); } } }, [ico('folder'), h('span', { cls: 'em-fold-t', text: l.name })]));
    });
    col.appendChild(h('button', { type: 'button', cls: 'em-fold em-newf', on: { click: function () { newFolder(); } } }, [ico('plus'), h('span', { cls: 'em-fold-t', text: 'New folder' })]));
    col.appendChild(h('div', { cls: 'em-side-foot' }, [
      h('button', { type: 'button', cls: 'em-link', text: isOwner() ? 'Manage mailboxes' : 'My mailboxes', on: { click: manage } }),
      h('button', { type: 'button', cls: 'em-link', text: 'Email sign-off', on: { click: function () { modal('Email sign-off', [signatureEditor()]); } } }),
      h('a', { cls: 'em-link', href: 'https://mail.google.com/mail/u/?authuser=' + encodeURIComponent((a && a.address) || ''), target: '_blank', rel: 'noopener' }, ['Open in Gmail ', ico('gmail', 'em-i-s')])
    ]));
    side.appendChild(col);
    // phones: the mailbox as a heading you can change, and the folders as a strip you swipe
    var pbox = h('select', { cls: 'em-pbox', 'aria-label': 'Mailbox', on: { change: function () { switchAcct(this.value); } } }, mine().map(function (x) { return h('option', { value: x.id, text: x.address + (M.unread[x.id] ? '  ·  ' + M.unread[x.id] + ' unread' : ''), selected: x.id === M.acct }); }));
    var chips = h('nav', { cls: 'em-strip', 'aria-label': 'Folders' });
    SYS.concat(userLabels().map(function (l) { return [l.id, l.name]; })).forEach(function (s) {
      var n = s[0] === 'INBOX' ? (M.unread[M.acct] || 0) : 0;
      chips.appendChild(h('button', { type: 'button', cls: 'em-chipf', 'aria-current': !M.q && M.label === s[0] ? 'true' : 'false', on: { click: function () { goLabel(s[0]); } } }, [s[1], n ? h('span', { cls: 'em-n', text: String(n) }) : null]));
    });
    side.appendChild(h('div', { cls: 'em-phone' }, [h('div', { cls: 'em-phead' }, [h('label', { cls: 'em-pboxw' }, [pbox, ico('next', 'em-pchev')]), ib('more', isOwner() ? 'Manage mailboxes' : 'My mailboxes', manage, 'em-pmore')]), chips]));
    var cur = chips.querySelector('[aria-current="true"]'); if (cur) setTimeout(function () { try { cur.scrollIntoView({ inline: 'center', block: 'nearest' }); } catch (e) {} }, 0);
    var fab = M.el.querySelector('.em-fab');
    if (!fab) { fab = h('button', { type: 'button', cls: 'em-fab', 'aria-label': 'Write an email', on: { click: function () { compose({}); } } }, [ico('pencil'), h('span', { text: 'Write' })]); M.el.querySelector('.em').appendChild(fab); }
    fab.disabled = off;
  }
  function switchAcct(id) {
    if (id === M.acct) return;
    M.acct = id; rememberAcct(id); M.label = 'INBOX'; M.q = ''; M.page = ''; M.back = []; M.sel = {}; M.open = ''; M.thread = null; M.threads = []; M.next = '';
    render();
  }
  function goLabel(id) { M.label = id; M.q = ''; M.page = ''; M.back = []; M.sel = {}; M.open = ''; M.thread = null; var r = M.el.querySelector('.em'); if (r) r.classList.remove('em-reading'); paintSide(); loadList(); paintReader(); }
  function loadProfile() {
    var id = M.acct;
    return api('profile').then(function (p) { M.prof[id] = p; M.unread[id] = p.inboxUnread || 0; paintBadge(); return p; });
  }
  function counts() {
    return Promise.all(mine().filter(function (a) { return a.status !== 'reconnect'; }).map(function (a) {
      return post('mail/api', { account: a.id, op: 'counts' }).then(function (j) { M.unread[a.id] = j.inboxUnread || 0; }, function (e) { if (e.code === 'reconnect') a.status = 'reconnect'; });
    })).then(function () { paintBadge(); if (M.el && !M.el.hidden) paintSideCounts(); });
  }
  function paintSideCounts() { if (M.el.querySelector('.em-side') && !M.el.querySelector('.em-side :focus')) paintSide(); }
  function paintBadge() {
    var n = 0; mine().forEach(function (a) { n += M.unread[a.id] || 0; });
    document.querySelectorAll('[data-badge="email"]').forEach(function (el) { el.textContent = n ? String(n) : ''; el.hidden = !n; });
  }

  /* ---------- middle: the list ---------- */
  function loadList(quiet) {
    var list = M.el.querySelector('.em-list'); if (!list || !M.acct) return Promise.resolve();
    var seq = ++M.listSeq, id = M.acct;
    if (!quiet) { M.threads = []; M.lastPick = null; paintList(null, true); }
    var q = ((M.q || '') + (M.unreadOnly ? ' is:unread' : '')).trim();   // Gmail's own search, so it matches Gmail exactly
    return api('list', { label: M.q ? 'ALL' : M.label, q: q, page: M.page || '' }).then(function (j) {
      if (seq !== M.listSeq || id !== M.acct) return;
      var fresh = j.threads || [];
      if (quiet && M.threads.length > fresh.length && M.more) {   // older email already scrolled in: refresh the top, keep the rest
        var ids = {}; fresh.forEach(function (t) { ids[t.id] = 1; });
        M.threads = fresh.concat(M.threads.slice(fresh.length).filter(function (t) { return !ids[t.id]; }));
      } else { M.threads = fresh; M.next = j.next || ''; M.more = false; }
      Object.keys(M.sel).forEach(function (k) { if (!M.threads.some(function (t) { return t.id === k; })) delete M.sel[k]; });
      if (M.label === 'INBOX' && !M.q && !M.page) { var n = 0; M.threads.forEach(function (t) { if (t.unread) n++; }); if (n > (M.unread[id] || 0)) M.unread[id] = n; }
      paintList();
    }, function (e) { if (seq === M.listSeq) paintList(e); });
  }
  // scrolling to the bottom brings in the next 25 older emails, all the way back
  function loadMore() {
    if (!M.next || M.loadingMore || !M.acct) return;
    var seq = M.listSeq, id = M.acct, page = M.next;
    M.loadingMore = true; paintFoot();
    var q = ((M.q || '') + (M.unreadOnly ? ' is:unread' : '')).trim();
    api('list', { label: M.q ? 'ALL' : M.label, q: q, page: page }).then(function (j) {
      M.loadingMore = false;
      if (seq !== M.listSeq || id !== M.acct) return;
      var have = {}; M.threads.forEach(function (t) { have[t.id] = 1; });
      M.threads = M.threads.concat((j.threads || []).filter(function (t) { return !have[t.id]; }));
      M.next = j.next || ''; M.more = true;
      paintList();
    }, function () { M.loadingMore = false; M.moreErr = true; paintFoot(); });
  }
  function paintFoot() {
    var f = M.el && M.el.querySelector('.em-more'); if (!f) return;
    f.innerHTML = '';
    if (M.next) {
      if (M.loadingMore) f.appendChild(h('span', { cls: 'em-more-t', text: 'Loading older email…' }));
      else f.appendChild(h('button', { type: 'button', cls: 'em-link', text: M.moreErr ? 'Couldn’t load more. Try again' : 'Load older email', on: { click: function () { M.moreErr = false; loadMore(); } } }));
    } else if (M.threads.length > 25) f.appendChild(h('span', { cls: 'em-more-t', text: 'That’s everything in ' + (M.q ? 'this search' : labelName(M.label)) + '.' }));
  }
  function selIds() { return Object.keys(M.sel); }
  function setUnreadOnly(on) { if (M.unreadOnly === on) return; M.unreadOnly = on; try { localStorage.setItem('eden-mail-unread', on ? '1' : ''); } catch (e) {} M.page = ''; M.back = []; M.sel = {}; loadList(); }
  function paintList(err, loading) {
    var list = M.el.querySelector('.em-list'); if (!list) return;
    var old = list.querySelector('.em-rows'), scroll = old ? old.scrollTop : 0, winY = window.scrollY;
    var hadFocus = document.activeElement && document.activeElement.classList.contains('em-search');
    list.innerHTML = '';
    var a = acct(), ids = selIds(), any = ids.length > 0;
    // heading, search and the All / Unread switch
    var head = h('div', { cls: 'em-lhead' });
    var allOn = M.threads.length && M.threads.every(function (t) { return M.sel[t.id]; });
    var all = h('input', { type: 'checkbox', cls: 'em-chk em-chk-all', title: allOn ? 'Unselect all' : 'Select all', 'aria-label': allOn ? 'Unselect all' : 'Select all on this page' });
    all.checked = !!allOn; all.indeterminate = any && !allOn; all.disabled = !M.threads.length;
    all.addEventListener('change', function () { if (allOn) M.sel = {}; else M.threads.forEach(function (t) { M.sel[t.id] = 1; }); M.lastPick = null; paintList(); });
    head.appendChild(h('div', { cls: 'em-ltop' }, [
      h('label', { cls: 'em-chkw em-chkw-all' }, [all]),
      h('h2', { cls: 'em-ltitle', text: M.q ? 'Search' : labelName(M.label) }),
      h('span', { cls: 'em-sp' }),
      ib('refresh', 'Refresh', function () { loadList(); counts(); })]));
    var q = h('input', { type: 'search', cls: 'em-search', placeholder: 'Search ' + ((a && a.address) || 'mail'), value: M.q, 'aria-label': 'Search mail', enterkeyhint: 'search' });
    q.addEventListener('keydown', function (e) { if (e.key === 'Enter') { M.q = q.value.trim(); M.page = ''; M.back = []; M.sel = {}; q.blur(); paintSide(); loadList(); } });
    q.addEventListener('search', function () { if (!q.value && M.q) { M.q = ''; M.page = ''; M.back = []; paintSide(); loadList(); } });
    head.appendChild(h('label', { cls: 'em-sbox' }, [ico('search'), q]));
    head.appendChild(h('div', { cls: 'em-seg', role: 'group', 'aria-label': 'Show' }, [
      h('button', { type: 'button', cls: 'em-seg-b', 'aria-pressed': M.unreadOnly ? 'false' : 'true', text: 'All', on: { click: function () { setUnreadOnly(false); } } }),
      h('button', { type: 'button', cls: 'em-seg-b em-unread', 'aria-pressed': M.unreadOnly ? 'true' : 'false', text: 'Unread', on: { click: function () { setUnreadOnly(true); } } })]));
    list.appendChild(head);
    // when emails are chosen: what to do with them
    if (any) {
      var bar = h('div', { cls: 'em-tools em-selbar' }, [
        ib('x', 'Clear selection', function () { M.sel = {}; paintList(); }),
        h('span', { cls: 'em-selcount', text: ids.length + ' selected' }),
        ids.length < M.threads.length ? h('button', { type: 'button', cls: 'em-link', text: 'Select all', on: { click: function () { M.threads.forEach(function (t) { M.sel[t.id] = 1; }); paintList(); } } }) : null,
        h('span', { cls: 'em-sp' })]);
      actionButtons(ids, true).forEach(function (b) { bar.appendChild(b); });
      list.appendChild(bar);
    }
    if (a && a.status === 'reconnect') { list.appendChild(h('div', { cls: 'em-empty' }, [h('p', { text: 'Google no longer lets the staff site into ' + a.address + '. This happens when the password changes or access is removed.' }), btn('Connect it again', function () { reconnect(a); }, 'em-go')])); return; }
    var rows = h('div', { cls: 'em-rows', role: 'list' });
    if (err) rows.appendChild(h('div', { cls: 'em-empty' }, [h('p', { text: err.message }), btn('Try again', function () { if (!M.prof[M.acct]) render(); else loadList(); })]));
    else if (loading) for (var i = 0; i < 6; i++) rows.appendChild(h('div', { cls: 'em-ghost', 'aria-hidden': 'true' }, [h('span'), h('span'), h('span')]));
    else if (!M.threads.length) rows.appendChild(h('div', { cls: 'em-empty em-calm' }, [h('p', { cls: 'em-calm-t', text: M.q ? 'Nothing found' : M.unreadOnly ? 'All caught up' : 'Nothing here' }),
      h('p', { text: M.q ? 'Nothing ' + (M.unreadOnly ? 'unread ' : '') + 'matches “' + M.q + '”.' : M.unreadOnly ? 'No unread email in ' + labelName(M.label) + '.' : (M.label === 'INBOX' ? 'Your inbox is empty.' : 'Nothing in ' + labelName(M.label) + '.') })]));
    if (M.label === 'TRASH' && !M.q && M.threads.length) rows.appendChild(h('p', { cls: 'em-banner', text: 'Gmail deletes email in Trash for good after 30 days.' }));
    if (M.label === 'SPAM' && !M.q && M.threads.length) rows.appendChild(h('p', { cls: 'em-banner', text: 'Gmail deletes spam for good after 30 days.' }));
    M.threads.forEach(function (t, i) { rows.appendChild(row(t, any, i)); });
    if (!err && !loading && M.threads.length) {
      var foot = h('div', { cls: 'em-more' }); rows.appendChild(foot);
      list.appendChild(rows); paintFoot();
      if (M.io) M.io.disconnect();
      if ('IntersectionObserver' in window) { M.io = new IntersectionObserver(function (es) { if (es.some(function (e) { return e.isIntersecting; })) loadMore(); }, { rootMargin: '700px 0px' }); M.io.observe(foot); }
    } else list.appendChild(rows);
    rows.scrollTop = scroll;
    if (Math.abs(window.scrollY - winY) > 2) window.scrollTo(0, winY);
    if (hadFocus) { q.focus(); }
  }
  // choose an email; shift-click chooses everything between it and the last one chosen
  function togglePick(t, i, shift) {
    var on = !M.sel[t.id];
    if (shift && M.lastPick != null && M.threads[M.lastPick]) {
      var a = Math.min(M.lastPick, i), b = Math.max(M.lastPick, i);
      for (var k = a; k <= b; k++) { if (on) M.sel[M.threads[k].id] = 1; else delete M.sel[M.threads[k].id]; }
    } else if (on) M.sel[t.id] = 1; else delete M.sel[t.id];
    M.lastPick = i; paintList();
  }
  function row(t, selecting, idx) {
    var sent = M.label === 'SENT';
    var name = sent ? 'To ' + splitAddrs(t.to).map(function (x) { return x.name || x.email; }).join(', ') : who(t.from);
    var av = avatar(sent ? (splitAddrs(t.to)[0] ? (splitAddrs(t.to)[0].name || splitAddrs(t.to)[0].email) : '') : t.from);
    var picked = !!M.sel[t.id];
    var pick = h('button', { type: 'button', cls: 'em-av' + (picked ? ' on' : ''), style: picked ? null : 'background:' + av.color, 'aria-pressed': picked ? 'true' : 'false', 'aria-label': picked ? 'Selected. Tap to unselect' : 'Select this email',
      on: { click: function (e) { e.stopPropagation(); togglePick(t, idx, e.shiftKey); } } }, picked ? [ico('check')] : [h('span', { text: av.ini })]);
    var chk = h('input', { type: 'checkbox', cls: 'em-chk', 'aria-label': 'Select email from ' + (name || 'unknown sender') });
    chk.checked = picked;
    chk.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); togglePick(t, idx, e.shiftKey); });
    var chkw = h('label', { cls: 'em-chkw', on: { click: function (e) { e.stopPropagation(); } } }, [chk]);
    var star = h('button', { type: 'button', cls: 'em-star' + (t.starred ? ' on' : ''), 'aria-label': t.starred ? 'Starred' : 'Not starred', 'aria-pressed': t.starred ? 'true' : 'false', title: t.starred ? 'Unstar' : 'Star',
      on: { click: function (e) { e.stopPropagation(); act([t.id], t.starred ? { remove: ['STARRED'] } : { add: ['STARRED'] }); } } }, [ico('star')]);
    return h('div', { cls: 'em-row-t' + (t.unread ? ' unread' : '') + (M.open === t.id ? ' open' : '') + (picked ? ' sel' : ''), role: 'listitem', tabindex: '0',
      on: { click: function (e) { if (selecting || e.shiftKey) { if (e.shiftKey) e.preventDefault(); togglePick(t, idx, e.shiftKey); } else openThread(t.id); }, keydown: function (e) { if (e.key === 'Enter') openThread(t.id); else if (e.key === ' ' || e.key === 'x') { e.preventDefault(); togglePick(t, idx, e.shiftKey); } } } }, [
      chkw, pick,
      h('div', { cls: 'em-rmain' }, [
        h('div', { cls: 'em-rtop' }, [h('span', { cls: 'em-from' }, [name || '(no sender)', t.n > 1 ? h('span', { cls: 'em-cnt', text: String(t.n) }) : null]), h('span', { cls: 'em-date', text: shortDate(t.date) })]),
        h('div', { cls: 'em-rsub' }, [h('span', { cls: 'em-subj', text: t.subject || '(no subject)' }), t.attach ? h('span', { cls: 'em-clip', title: 'Has attachments' }, [ico('clip')]) : null, star]),
        h('div', { cls: 'em-snip', text: decodeEntities(t.snippet) })
      ])
    ]);
  }
  function decodeEntities(s) { var d = document.createElement('textarea'); d.innerHTML = String(s || ''); return d.value; }

  /* ---------- actions (all done in Gmail) ---------- */
  function actionButtons(ids, wide) {
    var W = wide ? ' em-ib-wide' : '';
    var inTrash = M.label === 'TRASH', inSpam = M.label === 'SPAM';
    var t = M.threads.filter(function (x) { return ids.indexOf(x.id) !== -1; });
    if (!t.length && M.thread && ids[0] === M.thread.id) t = [{ id: M.thread.id, labels: M.thread.labels, unread: false }];
    var hasInbox = t.some(function (x) { return (x.labels || []).indexOf('INBOX') !== -1; });
    var anyUnread = t.some(function (x) { return x.unread; });
    var many = ids.length === 1 ? 'this conversation' : ids.length + ' conversations';
    var out = [];
    if (inTrash) {
      out.push(ib('restore', 'Restore', function () { act(ids, 'untrash', 'Moved out of Trash.'); }));
      out.push(ib('trash', 'Delete forever', function () { if (confirm('Delete ' + many + ' forever? This can’t be undone, here or in Gmail.')) act(ids, 'delete', 'Deleted forever.'); }, 'em-danger' + W));
      return out;
    }
    if (hasInbox) out.push(ib('archive', 'Archive', function () { act(ids, { remove: ['INBOX'] }, 'Archived. It’s still in All mail.'); }));
    else if (!inSpam) out.push(ib('inbox', 'To inbox', function () { act(ids, { add: ['INBOX'] }, 'Moved to the inbox.'); }));
    out.push(ib('trash', 'Delete', function () { act(ids, 'trash', ids.length > 1 ? ids.length + ' conversations moved to Trash.' : 'Moved to Trash.'); }, W.trim()));
    if (inSpam) {
      out.push(ib('inbox', 'Not spam', function () { act(ids, { remove: ['SPAM'], add: ['INBOX'] }, 'Moved to the inbox.'); }));
      out.push(ib('trash', 'Delete forever', function () { if (confirm('Delete ' + many + ' forever? This can’t be undone, here or in Gmail.')) act(ids, 'delete', 'Deleted forever.'); }, 'em-danger'));
    } else out.push(ib('spam', 'Spam', function () { act(ids, { add: ['SPAM'], remove: ['INBOX'] }, 'Marked as spam.'); }));
    out.push(anyUnread ? ib('read', 'Mark read', function () { act(ids, { remove: ['UNREAD'] }); }) : ib('unread', 'Mark unread', function () { act(ids, { add: ['UNREAD'] }); }));
    out.push(moveMenu(ids, wide));
    return out;
  }
  function moveMenu(ids, wide) {
    var sel = h('select', { cls: 'em-move', 'aria-label': 'Move to folder', title: 'Move to folder' }, [h('option', { value: '', text: 'Move to…' })].concat(
      [h('option', { value: 'INBOX', text: 'Inbox' })], userLabels().map(function (l) { return h('option', { value: l.id, text: l.name }); }), [h('option', { value: '+', text: '+ New folder…' })]));
    sel.addEventListener('change', function () {
      var v = sel.value; sel.value = '';
      var p = v === '+' ? newFolder() : Promise.resolve(v ? { id: v, name: labelName(v) } : null);
      p.then(function (l) {
        if (!l) return;
        // like Gmail's "Move to": add the new folder and take it out of the one you're looking at
        var rem = []; if (!M.q && M.label !== l.id && (M.label === 'INBOX' || /^Label_/.test(M.label))) rem.push(M.label);
        act(ids, { add: [l.id], remove: rem }, (ids.length > 1 ? ids.length + ' conversations moved to ' : 'Moved to ') + l.name + '.');
      });
    });
    return h('span', { cls: 'em-ib em-movew' + (wide ? ' em-ib-wide' : '') }, [ico('folder'), h('span', { cls: 'em-ib-t', text: wide ? 'Move to…' : 'Move' }), sel]);
  }
  function newFolder() {
    var name = prompt('Name for the new folder (it’s made in Gmail too):', '');
    if (!name || !name.trim()) return Promise.resolve(null);
    say('Making the folder…');
    return api('label', { name: name.trim() }).then(function (l) {
      var p = M.prof[M.acct]; if (p && !p.labels.some(function (x) { return x.id === l.id; })) p.labels.push(l);
      say('Folder “' + l.name + '” made.', 'ok'); paintSide(); return l;
    }, function (e) { say(e.message, 'err'); return null; });
  }
  function stillHere(t, add, rem) {
    var labels = (t.labels || []).filter(function (l) { return rem.indexOf(l) === -1; }).concat(add);
    if (M.q || M.label === 'ALL') return labels.indexOf('TRASH') === -1 && labels.indexOf('SPAM') === -1;
    return labels.indexOf(M.label) !== -1;
  }
  function act(ids, what, done) {
    var op = typeof what === 'string' ? what : 'modify';
    var body = op === 'modify' ? { ids: ids, add: what.add || [], remove: what.remove || [] } : { ids: ids };
    M.busy = true;
    // show it straight away; Gmail confirms a moment later
    var add = body.add || [], rem = body.remove || [];
    if (op === 'trash') { add = ['TRASH']; rem = ['INBOX']; }
    if (op === 'untrash') { add = ['INBOX']; rem = ['TRASH']; }
    if (op === 'delete') { add = []; rem = [M.label]; }
    M.threads = M.threads.filter(function (t) {
      if (ids.indexOf(t.id) === -1) return true;
      t.labels = (t.labels || []).filter(function (l) { return rem.indexOf(l) === -1; }).concat(add.filter(function (l) { return (t.labels || []).indexOf(l) === -1; }));
      if (add.indexOf('UNREAD') !== -1) t.unread = true; if (rem.indexOf('UNREAD') !== -1) t.unread = false;
      if (add.indexOf('STARRED') !== -1) t.starred = true; if (rem.indexOf('STARRED') !== -1) t.starred = false;
      return op !== 'delete' && stillHere(t, [], []);
    });
    var closing = M.open && ids.indexOf(M.open) !== -1 && (op === 'delete' || op === 'trash' || op === 'untrash' || rem.indexOf(M.label) !== -1 || add.indexOf('SPAM') !== -1);
    ids.forEach(function (i) { if (!M.threads.some(function (t) { return t.id === i; })) delete M.sel[i]; });
    if (closing) { M.open = ''; M.thread = null; var r = M.el.querySelector('.em'); if (r) r.classList.remove('em-reading'); paintReader(); }
    else if (M.thread && ids.indexOf(M.thread.id) !== -1) { M.thread.labels = M.thread.labels.filter(function (l) { return rem.indexOf(l) === -1; }).concat(add); paintReader(); }
    paintList();
    var chunks = []; for (var c = 0; c < ids.length; c += 25) chunks.push(ids.slice(c, c + 25));
    return chunks.reduce(function (p, part) { return p.then(function () { return api(op, Object.assign({}, body, { ids: part })); }); }, Promise.resolve()).then(function () {
      M.busy = false;
      if (done) say(done, 'ok');
      if (add.indexOf('UNREAD') !== -1 || rem.indexOf('UNREAD') !== -1 || rem.indexOf('INBOX') !== -1 || add.indexOf('INBOX') !== -1 || op !== 'modify') counts();
      loadList(true);
    }, function (e) { M.busy = false; say(e.message, 'err'); loadList(true); });
  }

  /* ---------- right: reading a conversation ---------- */
  function openThread(id) {
    M.open = id; M.thread = { id: id, loading: true, labels: [], msgs: [] };
    var r = M.el.querySelector('.em'); if (r) r.classList.add('em-reading');
    M.el.querySelectorAll('.em-row-t.open').forEach(function (x) { x.classList.remove('open'); });
    paintList(); paintReader();
    var acctId = M.acct;
    api('thread', { id: id }).then(function (t) {
      if (M.open !== id || M.acct !== acctId) return;
      var msgs = (t.messages || []).map(parseMessage);
      var labels = {}; msgs.forEach(function (m) { m.labels.forEach(function (l) { labels[l] = 1; }); });
      M.thread = { id: id, msgs: msgs, labels: Object.keys(labels), subject: (msgs[0] && msgs[0].h.subject) || '(no subject)', expanded: {} };
      msgs.forEach(function (m, i) { if (i === msgs.length - 1 || m.labels.indexOf('UNREAD') !== -1) M.thread.expanded[m.id] = 1; });
      paintReader();
      // opening it marks it read, as in Gmail
      if (labels.UNREAD) {
        var tr = M.threads.filter(function (x) { return x.id === id; })[0]; if (tr) tr.unread = false;
        api('modify', { ids: [id], add: [], remove: ['UNREAD'] }).then(function () { if (M.unread[acctId]) M.unread[acctId] = Math.max(0, M.unread[acctId] - 1); paintBadge(); paintSideCounts(); paintList(); }, function () {});
      }
    }, function (e) {
      if (M.open !== id) return;
      M.thread = { id: id, error: e.message, labels: [], msgs: [] }; paintReader();
      if (e.http === 404) loadList(true);
    });
  }
  function closeThread() { M.open = ''; M.thread = null; var r = M.el.querySelector('.em'); if (r) r.classList.remove('em-reading'); paintReader(); paintList(); }
  function paintReader() {
    var pane = M.el.querySelector('.em-read'); if (!pane) return;
    pane.innerHTML = '';
    var t = M.thread;
    if (!t) { pane.appendChild(h('div', { cls: 'em-none' }, [ico('inbox', 'em-none-i'), h('p', { text: 'Choose an email to read it.' }), h('p', { cls: 'em-note', text: 'Whatever you do here happens in Gmail too.' })])); return; }
    var top = h('div', { cls: 'em-rtools' }, [ib('back', 'Back', closeThread, 'em-backbtn')]);
    if (!t.loading && !t.error) {
      actionButtons([t.id]).forEach(function (b) { top.appendChild(b); });
      top.appendChild(h('span', { cls: 'em-sp' }));
      var starred = t.labels.indexOf('STARRED') !== -1;
      top.appendChild(ib('star', starred ? 'Starred' : 'Star', function () { act([t.id], starred ? { remove: ['STARRED'] } : { add: ['STARRED'] }); }, starred ? 'em-starred' : '', { 'aria-pressed': starred ? 'true' : 'false' }));
    }
    pane.appendChild(top);
    if (t.loading) { pane.appendChild(h('div', { cls: 'em-thread' }, [h('div', { cls: 'em-ghost em-ghost-l', 'aria-hidden': 'true' }, [h('span'), h('span'), h('span')]), h('p', { cls: 'em-sr', text: 'Opening…' })])); return; }
    if (t.error) { pane.appendChild(h('p', { cls: 'em-empty', text: t.error })); return; }
    var body = h('div', { cls: 'em-thread' });
    body.appendChild(h('h2', { cls: 'em-tsubj', text: t.subject }));
    var userL = t.labels.filter(function (l) { return /^Label_/.test(l); });
    if (userL.length) body.appendChild(h('p', { cls: 'em-tags' }, userL.map(function (l) { return h('span', { cls: 'em-tag', text: labelName(l) }); })));
    t.msgs.forEach(function (m) { body.appendChild(message(m)); });
    var last = t.msgs[t.msgs.length - 1];
    if (last && M.label !== 'TRASH') body.appendChild(h('div', { cls: 'em-replybar' }, [
      h('button', { type: 'button', cls: 'em-pill em-pill-go', on: { click: function () { replyTo(last, false); } } }, [ico('reply'), 'Reply']),
      splitAddrs((last.h.to || '') + ',' + (last.h.cc || '')).length > 1 ? h('button', { type: 'button', cls: 'em-pill', on: { click: function () { replyTo(last, true); } } }, [ico('replyAll'), 'Reply all']) : null,
      h('button', { type: 'button', cls: 'em-pill', on: { click: function () { forward(last); } } }, [ico('forward'), 'Forward'])]));
    pane.appendChild(body);
    pane.scrollTop = 0;
  }
  function message(m) {
    var open = !!M.thread.expanded[m.id];
    var from = parseAddr(m.h.from || ''), av = avatar(m.h.from || '');
    var toWho = splitAddrs((m.h.to || '') + (m.h.cc ? ',' + m.h.cc : '')).map(function (x) { return ownAddrs().indexOf(x.email.toLowerCase()) !== -1 ? 'me' : (x.name || x.email).split(' ')[0]; });
    toWho = toWho.filter(function (x, i) { return toWho.indexOf(x) === i; });
    var head = h('button', { type: 'button', cls: 'em-mhead', 'aria-expanded': open ? 'true' : 'false', on: { click: function () { if (open) delete M.thread.expanded[m.id]; else M.thread.expanded[m.id] = 1; paintReader(); } } }, [
      h('span', { cls: 'em-av em-av-m', style: 'background:' + av.color, 'aria-hidden': 'true' }, [h('span', { text: av.ini })]),
      h('span', { cls: 'em-mwho' }, [
        h('span', { cls: 'em-mline' }, [h('b', { text: from.name || from.email }), from.name ? h('span', { cls: 'em-addr', text: from.email }) : null]),
        h('span', { cls: 'em-mto', text: open ? (toWho.length ? 'to ' + toWho.join(', ') : '') : decodeEntities(m.snippet) })]),
      h('span', { cls: 'em-mdate', title: longDate(m.date), text: when(m.date) })]);
    var card = h('article', { cls: 'em-msg' + (open ? ' open' : '') }, [head]);
    if (!open) return card;
    var meta = [];
    if (m.h.to) meta.push(h('div', [h('span', { text: 'To ' }), m.h.to]));
    if (m.h.cc) meta.push(h('div', [h('span', { text: 'Cc ' }), m.h.cc]));
    if (meta.length) card.appendChild(h('details', { cls: 'em-meta' }, [h('summary', { text: 'Details' })].concat(meta)));
    var bodyBox = h('div', { cls: 'em-body' });
    card.appendChild(bodyBox);
    var ready = Promise.resolve();
    if (m.htmlAtt && !m.html) ready = attData(m.id, m.htmlAtt).then(function (b) { m.html = new TextDecoder(m.htmlAtt.cs || 'utf-8').decode(b); m.htmlAtt = null; });
    else if (!m.html && m.textAtt && !m.text) ready = attData(m.id, m.textAtt).then(function (b) { m.text = new TextDecoder(m.textAtt.cs || 'utf-8').decode(b); m.textAtt = null; });
    ready.then(function () { if (m.html) htmlFrame(bodyBox, m); else textBody(bodyBox, m.text || m.snippet || ''); }, function () { textBody(bodyBox, m.snippet || ''); });
    var files = m.atts.filter(function (a) { return !a.inline || !m.html; });
    if (files.length) card.appendChild(h('div', { cls: 'em-atts' }, files.map(function (a) {
      var ext = (/\.([a-z0-9]{1,5})$/i.exec(a.name) || [])[1] || 'file';
      return h('button', { type: 'button', cls: 'em-att', title: 'Download ' + a.name, on: { click: function () { download(m, a, this); } } }, [
        h('span', { cls: 'em-att-x', text: ext.toUpperCase() }), h('span', { cls: 'em-att-n' }, [h('b', { text: a.name }), h('small', { text: size(a.size) })])]);
    })));
    return card;
  }
  function textBody(box, text) {
    var lines = String(text).replace(/\r\n/g, '\n');
    var cut = /\n\s*On .{3,200}wrote:\s*\n|\n-{2,}\s*Original Message\s*-{2,}|\n\s*From: .+\n\s*Sent: /i.exec(lines);
    var main = cut ? lines.slice(0, cut.index) : lines, quoted = cut ? lines.slice(cut.index) : '';
    var pre = h('div', { cls: 'em-text' });
    pre.innerHTML = esc(main).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>');
    box.appendChild(pre);
    if (quoted.trim()) {
      var q = h('div', { cls: 'em-text em-quoted', hidden: true, text: quoted });
      box.appendChild(h('button', { type: 'button', cls: 'em-dots', title: 'Show quoted text', 'aria-label': 'Show quoted text', text: '•••', on: { click: function () { q.hidden = !q.hidden; } } }));
      box.appendChild(q);
    }
  }
  // An email's own design is shown in a sealed frame: no scripts can run, forms can't send, links open in a new tab.
  function htmlFrame(box, m) {
    var f = h('iframe', { cls: 'em-frame', title: 'Email from ' + who(m.h.from || ''), sandbox: 'allow-same-origin allow-popups allow-popups-to-escape-sandbox', referrerpolicy: 'no-referrer' });
    var csp = "default-src 'none'; img-src https: http: data: blob:; style-src 'unsafe-inline' https:; font-src https: data:; media-src https:";
    f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="' + csp + '"><base target="_blank">' +
      '<style>html,body{margin:0;padding:0;background:transparent}body{font:15px/1.55 Arial,Helvetica,sans-serif;color:#24282c;word-wrap:break-word;overflow-wrap:anywhere;padding:2px 2px 8px}img{max-width:100%;height:auto}table{max-width:100%}' +
      'a{color:#8a5226}.eden-q-hide{display:none!important}.eden-dots{display:inline-block;margin:6px 0;padding:0 8px;border:1px solid #d9d3c8;border-radius:8px;background:#f3eee5;color:#555;font:12px Arial;cursor:pointer;line-height:16px}</style></head><body>' + m.html + '</body></html>';
    box.appendChild(f);
    f.addEventListener('load', function () {
      var d; try { d = f.contentDocument; } catch (e) { return; }
      if (!d) return;
      // fold the quoted earlier email, like Gmail
      d.querySelectorAll('.gmail_quote, blockquote[type="cite"], #appendonsend, .yahoo_quoted, #divRplyFwdMsg').forEach(function (q, i) {
        if (i > 0 && q.parentElement && q.parentElement.closest('.eden-q-hide')) return;
        var parentQ = q.parentElement && q.parentElement.closest('.gmail_quote, blockquote[type="cite"]'); if (parentQ) return;
        q.classList.add('eden-q-hide');
        var b = d.createElement('button'); b.className = 'eden-dots'; b.type = 'button'; b.textContent = '•••'; b.title = 'Show quoted text';
        b.addEventListener('click', function () { q.classList.toggle('eden-q-hide'); fit(); });
        q.parentNode.insertBefore(b, q);
      });
      // pictures sent inside the email (logos in signatures etc.)
      d.querySelectorAll('img[src^="cid:"]').forEach(function (img) {
        var cid = img.getAttribute('src').slice(4), a = m.atts.filter(function (x) { return x.cid === cid; })[0];
        if (!a) return;
        attData(m.id, a).then(function (bytes) { img.src = URL.createObjectURL(new Blob([bytes], { type: a.mime || 'image/png' })); });
      });
      d.querySelectorAll('img').forEach(function (img) { img.addEventListener('load', fit); });
      fit(); setTimeout(fit, 300); setTimeout(fit, 1200);
    });
    function fit() { try { var d = f.contentDocument; f.style.height = Math.min(20000, Math.max(60, d.documentElement.scrollHeight, d.body.scrollHeight) + 4) + 'px'; } catch (e) {} }
  }
  function download(m, a, el) {
    el.disabled = true;
    attData(m.id, a).then(function (bytes) {
      var url = URL.createObjectURL(new Blob([bytes], { type: a.mime || 'application/octet-stream' }));
      var link = h('a', { href: url, download: a.name }); document.body.appendChild(link); link.click(); link.remove();
      setTimeout(function () { URL.revokeObjectURL(url); }, 60000); el.disabled = false;
    }, function (e) { say(e.message, 'err'); el.disabled = false; });
  }

  /* ---------- writing: new, reply, reply all, forward ---------- */
  function ownAddrs() { var p = M.prof[M.acct] || {}; return [String((acct() || {}).address || '').toLowerCase()].concat((p.sendAs || []).map(function (s) { return String(s.email || '').toLowerCase(); })); }
  function quoteHeader(m) { return 'On ' + longDate(m.date) + ', ' + (m.h.from || '') + ' wrote:'; }
  function originalHtml(m) { return m.html || textToHtml(m.text || m.snippet || ''); }
  function originalText(m) { return m.text || htmlToText(m.html || '') || m.snippet || ''; }
  function replyTo(m, all) {
    var mineA = ownAddrs();
    var to = splitAddrs(m.h['reply-to'] || m.h.from || '');
    var cc = [];
    if (all) {
      var fromMe = mineA.indexOf(parseAddr(m.h.from || '').email.toLowerCase()) !== -1;
      if (fromMe) to = splitAddrs(m.h.to || '');
      cc = splitAddrs((fromMe ? '' : (m.h.to || '') + ',') + (m.h.cc || ''));
    } else if (mineA.indexOf((to[0] || {}).email ? to[0].email.toLowerCase() : '') !== -1) to = splitAddrs(m.h.to || '');
    var seen = {}; var clean = function (list) { return list.filter(function (a) { var e = a.email.toLowerCase(); if (!e || seen[e] || mineA.indexOf(e) !== -1) return false; seen[e] = 1; return true; }); };
    to = clean(to); cc = clean(cc);
    var subj = m.h.subject || ''; if (!/^re:/i.test(subj)) subj = 'Re: ' + subj;
    compose({ mode: all ? 'Reply all' : 'Reply', to: to, cc: cc, subject: subj, threadId: M.thread.id, inReplyTo: m.h['message-id'] || '', references: ((m.h.references || '') + ' ' + (m.h['message-id'] || '')).trim(),
      quote: { html: '<div class="gmail_quote"><div>' + esc(quoteHeader(m)) + '</div><blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px solid #ccc;padding-left:1ex">' + originalHtml(m) + '</blockquote></div>',
        text: quoteHeader(m) + '\n' + originalText(m).split('\n').map(function (l) { return '> ' + l; }).join('\n') } });
  }
  function forward(m) {
    var subj = m.h.subject || ''; if (!/^fwd?:/i.test(subj)) subj = 'Fwd: ' + subj;
    var head = ['---------- Forwarded message ---------', 'From: ' + (m.h.from || ''), 'Date: ' + longDate(m.date), 'Subject: ' + (m.h.subject || ''), 'To: ' + (m.h.to || '')].concat(m.h.cc ? ['Cc: ' + m.h.cc] : []);
    compose({ mode: 'Forward', to: [], cc: [], subject: subj, threadId: M.thread.id,
      fwdAtts: m.atts.filter(function (a) { return !a.inline || !m.html; }).map(function (a) { return { msg: m.id, att: a, name: a.name, mime: a.mime, size: a.size }; }),
      quote: { html: '<div class="gmail_quote">' + head.map(function (l) { return esc(l); }).join('<br>') + '<br><br>' + originalHtml(m) + '</div>', text: head.join('\n') + '\n\n' + originalText(m) } });
  }
  function compose(o) {
    var a = acct(); if (!a) return;
    var p = M.prof[M.acct] || {};
    var sendAs = (p.sendAs && p.sendAs.length ? p.sendAs : [{ email: a.address, name: a.name, signature: '', isDefault: true }]);
    var old = document.querySelector('.em-compose-w'); if (old && !confirm('Discard the email you were writing?')) return; if (old) old.remove();
    var fromSel = h('select', { cls: 'em-in', 'aria-label': 'From' }, sendAs.map(function (s, i) { return h('option', { value: String(i), text: (s.name ? s.name + ' <' + s.email + '>' : s.email), selected: s.isDefault }); }));
    var fmt = function (list) { return (list || []).map(function (x) { return x.name ? x.name + ' <' + x.email + '>' : x.email; }).join(', '); };
    var to = h('input', { cls: 'em-in', type: 'text', inputmode: 'email', value: fmt(o.to), 'aria-label': 'To', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', placeholder: 'name@example.com' });
    var cc = h('input', { cls: 'em-in', type: 'text', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', value: fmt(o.cc), 'aria-label': 'Cc', autocomplete: 'off' });
    var bcc = h('input', { cls: 'em-in', type: 'text', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false', value: '', 'aria-label': 'Bcc', autocomplete: 'off' });
    var ccRow = h('label', { cls: 'em-crow', hidden: !(o.cc && o.cc.length) }, [h('span', { text: 'Cc' }), cc]);
    var bccRow = h('label', { cls: 'em-crow', hidden: true }, [h('span', { text: 'Bcc' }), bcc]);
    var subj = h('input', { cls: 'em-in', type: 'text', value: o.subject || '', 'aria-label': 'Subject', placeholder: 'Subject' });
    var text = h('textarea', { cls: 'em-in em-body-in', rows: '10', 'aria-label': 'Message', placeholder: 'Write your message' });
    if (o.body) text.value = o.body;
    var sigBox = h('input', { type: 'checkbox', checked: true });
    var so = sigFor(a), own = so.sig;
    var sigRow = h('label', { cls: 'em-check' }, [sigBox, own ? (so.mine ? ' Add my sign-off' : ' Add ' + so.name + '’s sign-off') : ' Add the Gmail signature']);
    // your staff-site sign-off (three lines and the Eden picture); without one, the mailbox's Gmail signature
    function sig() { if (own) return sigHtml(own); var s = sendAs[+fromSel.value] || {}; return s.signature || ''; }
    function paintSig() { sigRow.hidden = !sig(); }
    if (own) sigRow.appendChild(h('span', { cls: 'em-sigmini', text: '· ' + [own.line1, own.line2].filter(Boolean).join(', ') }));
    fromSel.addEventListener('change', paintSig);
    var files = (o.fwdAtts || []).slice();
    var fileIn = h('input', { type: 'file', multiple: true, hidden: true });
    var chips = h('div', { cls: 'em-chips' });
    function paintChips() {
      chips.innerHTML = '';
      files.forEach(function (f, i) { chips.appendChild(h('span', { cls: 'em-chip' }, [f.name + ' · ' + size(f.size || (f.file && f.file.size) || 0), h('button', { type: 'button', 'aria-label': 'Remove ' + f.name, text: '✕', on: { click: function () { files.splice(i, 1); paintChips(); } } })])); });
    }
    fileIn.addEventListener('change', function () { [].forEach.call(fileIn.files, function (f) { files.push({ file: f, name: f.name, mime: f.type, size: f.size }); }); fileIn.value = ''; paintChips(); });
    var quoteOn = !!o.quote;
    var quoteRow = o.quote ? h('label', { cls: 'em-check' }, [h('input', { type: 'checkbox', checked: true, on: { change: function () { quoteOn = this.checked; } } }), o.mode === 'Forward' ? ' Include the forwarded email' : ' Include the earlier email (quoted)']) : null;
    var err = h('p', { cls: 'em-err', role: 'alert' });
    var send = h('button', { type: 'button', cls: 'em-pill em-pill-go em-go', on: { click: doSend } }, [ico('send'), h('span', { text: 'Send' })]);
    var w = h('div', { cls: 'em-compose-w', role: 'dialog', 'aria-label': o.mode || 'New email' }, [
      h('div', { cls: 'em-ch' }, [h('button', { type: 'button', cls: 'em-cx', 'aria-label': 'Close', title: 'Close', on: { click: discard } }, [ico('x')]), h('b', { text: o.mode || 'New email' }), h('span', { cls: 'em-sp' }), send]),
      h('div', { cls: 'em-cb' }, [
        h('label', { cls: 'em-crow' }, [h('span', { text: 'From' }), fromSel]),
        h('label', { cls: 'em-crow' }, [h('span', { text: 'To' }), to, h('button', { type: 'button', cls: 'em-ccb', text: 'Cc Bcc', on: { click: function (e) { e.preventDefault(); ccRow.hidden = false; bccRow.hidden = false; } } })]),
        ccRow, bccRow,
        h('label', { cls: 'em-crow' }, [h('span', { text: 'Subject' }), subj]),
        text, chips, sigRow, quoteRow, err
      ]),
      h('div', { cls: 'em-cf' }, [ib('clip', 'Attach files', function () { fileIn.click(); }, 'em-ib-wide'), fileIn, h('span', { cls: 'em-sp' }), ib('trash', 'Discard', discard, 'em-ib-wide')])
    ]);
    document.body.appendChild(w);
    paintSig(); paintChips();
    (o.to && o.to.length ? text : to).focus();
    function discard() { if ((text.value.trim() || files.length > (o.fwdAtts || []).length) && !confirm('Discard this email?')) return; w.remove(); }
    function doSend() {
      err.textContent = '';
      var list = function (s) { return splitAddrs(s.value); };
      var T = list(to), C = list(cc), BC = list(bcc);
      var bad = T.concat(C, BC).filter(function (x) { return !/^[^\s@<>()",;]+@[^\s@<>()",;]+\.[a-z]{2,}$/i.test(x.email); });
      if (!T.length && !C.length && !BC.length) { err.textContent = 'Add who it’s to.'; to.focus(); return; }
      if (bad.length) { err.textContent = 'Check this address: ' + bad[0].email; return; }
      if (!subj.value.trim() && !confirm('Send without a subject?')) return;
      var total = 0; files.forEach(function (f) { total += f.size || (f.file && f.file.size) || 0; });
      if (total > MAX_ATTACH) { err.textContent = 'The attachments add up to ' + size(total) + '. The most you can send here is 18 MB; share bigger files with a Google Drive link.'; return; }
      var s = sendAs[+fromSel.value] || sendAs[0];
      var body = text.value.replace(/\s+$/, '');
      var useSig = sigBox.checked && !!sig(), ownSig = useSig && !!own;
      var plain = body + (useSig ? '\n\n-- \n' + (own ? sigText(own) : htmlToText(sig())) : '') + (quoteOn && o.quote ? '\n\n' + o.quote.text : '');
      var htmlWith = function (sigH) { return '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;color:#222">' + textToHtml(body) + (sigH ? '<br><div class="gmail_signature">' + sigH + '</div>' : '') + '</div>' + (quoteOn && o.quote ? '<br>' + o.quote.html : ''); };
      var html = htmlWith(useSig ? sig() : ''), inline = [];
      send.disabled = true; send.lastChild.textContent = 'Sending…';
      // the staff-site sign-off carries its E inside the email; if the picture can't be read, it links to it instead
      (ownSig ? markData().then(function (b) { inline = [{ cid: 'eden-mark', name: 'eden.png', mime: 'image/png', bytes: b }]; html = htmlWith(sigHtml(own, 'cid:eden-mark')); }, function () {}) : Promise.resolve()).then(function () { return Promise.all(files.map(function (f) {
        if (f.file) return f.file.arrayBuffer().then(function (b) { return { name: f.name, mime: f.mime, bytes: new Uint8Array(b) }; });
        return attData(f.msg, f.att).then(function (b) { return { name: f.name, mime: f.mime, bytes: b }; });
      })); }).then(function (atts) {
        var raw = buildRaw({ from: { name: s.name || '', email: s.email }, to: T, cc: C, bcc: BC, subject: subj.value.trim(), text: plain, html: html, inReplyTo: o.inReplyTo, references: o.references, atts: atts, inline: inline });
        return api('send', { raw: raw, threadId: o.mode === 'Forward' ? '' : (o.threadId || '') });
      }).then(function () {
        w.remove(); say('Sent from ' + s.email + '. It’s in Sent here and in Gmail.', 'ok');
        if (o.onSent) try { o.onSent({ to: T }); } catch (e) {}
        if (M.thread && o.threadId === M.thread.id && o.mode !== 'Forward') openThread(M.thread.id);
        loadList(true);
      }, function (e) { err.textContent = e.message || 'The email couldn’t be sent.'; send.disabled = false; send.lastChild.textContent = 'Send'; });
    }
  }


  /* ---------- email sign-offs (three lines with the Eden picture beside them) ---------- */
  function loadSigs() {
    var q = M.ctx.sb.from('mail_signatures').select('user_id,line1,line2,line3');
    if (!isOwner()) q = q.eq('user_id', M.ctx.uid);
    return q.then(function (r) {
      if (r.error) { M.sigMissing = true; return; }
      M.sigMissing = false; M.sigs = {}; (r.data || []).forEach(function (x) { M.sigs[x.user_id] = x; });
    }, function () { M.sigMissing = true; });
  }
  function mySig() { var x = M.sigs[M.ctx.uid]; return x && (x.line1 || x.line2 || x.line3) ? x : null; }
  // Starting sign-offs, used until someone saves their own on the Email sign-off page
  var DEFAULT_SIGS = {
    tyler: { line1: 'Tyler Ball', line2: 'Front of House Manager', line3: 'Eden Hospitality' },
    rich: { line1: 'Rich Strub', line2: 'Chef / Owner', line3: 'Eden Hospitality' }
  };
  function filled(x) { return x && (x.line1 || x.line2 || x.line3) ? x : null; }
  // The sign-off for a mailbox belongs to the person whose mailbox it is, not whoever is signed in to the
  // staff site: an email from Tyler's mailbox signs off as Tyler, even when the Owner writes it.
  // A mailbox is matched to a person by its Google name or by the first part of its address (tyler@ → Tyler).
  function sigFor(a) {
    var local = String((a && a.address) || '').split('@')[0].toLowerCase().replace(/[^a-z]/g, '');
    var gname = String((a && a.name) || '').toLowerCase().trim();
    var match = function (name) { var n = String(name || '').toLowerCase().trim(); return !!n && (n === gname || n.split(/\s+/)[0] === local); };
    var people = (M.people || []).concat(M.ctx.name ? [{ user_id: M.ctx.uid, name: M.ctx.name }] : []);
    var who = people.filter(function (p) { return match(p.name); })[0];
    if (who) return { sig: filled(M.sigs[who.user_id]) || DEFAULT_SIGS[String(who.name).toLowerCase().split(/\s+/)[0]] || null, name: who.name, mine: who.user_id === M.ctx.uid };
    if (DEFAULT_SIGS[local]) return { sig: DEFAULT_SIGS[local], name: DEFAULT_SIGS[local].line1, mine: false };
    return { sig: mySig(), name: M.ctx.name || '', mine: true };
  }
  function markUrl() { var base = String((window.EDEN_STAFF_CONFIG || {}).staffHome || location.origin + '/').replace(/\/?$/, '/'); return base + 'assets/brand/email-mark.png'; }
  // laid out with a table so it looks the same in Gmail, Apple Mail and Outlook
  function sigHtml(x, src) {
    var line = function (t, css) { return t ? '<div style="' + css + '">' + esc(t) + '</div>' : ''; };
    return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0"><tr>' +
      '<td style="padding:0 14px 0 0;vertical-align:middle"><img src="' + (src || markUrl()) + '" width="60" height="60" alt="Eden" style="display:block;width:60px;height:60px;border:0;border-radius:6px"></td>' +
      '<td style="vertical-align:middle;padding:2px 0 2px 14px;border-left:1px solid #d8cdbd">' +
      line(x.line1, "font-family:Georgia,'Times New Roman',serif;font-size:17px;line-height:22px;color:#0f1215") +
      line(x.line2, 'font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:.04em;color:#8a5226') +
      line(x.line3, 'font-family:Arial,Helvetica,sans-serif;font-size:12px;line-height:18px;letter-spacing:.04em;color:#7f7a71') +
      '</td></tr></table>';
  }
  // the E picture for sign-offs, read from this site once and carried inside each email
  var markBytes = null;
  function markData() {
    if (markBytes) return Promise.resolve(markBytes);
    return fetch('assets/brand/email-mark.png', { cache: 'force-cache' }).then(function (r) { if (!r.ok) throw 0; return r.arrayBuffer(); })
      .then(function (b) { markBytes = new Uint8Array(b); return markBytes; });
  }
  function sigText(x) { return [x.line1, x.line2, x.line3].filter(Boolean).join('\n'); }
  function sigPreview(x) { var d = h('div', { cls: 'em-sigprev' }); d.innerHTML = sigHtml(x); return d; }
  function signatureEditor() {
    var box = h('div', { cls: 'em-sigedit' });
    if (M.sigMissing) { box.appendChild(h('p', { cls: 'em-note', text: isOwner() ? 'To save sign-offs, run supabase/email-signatures.sql in Supabase (SQL Editor > New query > Run), then reload this page.' : 'Sign-offs aren’t switched on yet. Ask the Owner.' })); return box; }
    var who = M.ctx.uid, pick = null;
    if (isOwner() && M.people.length > 1) {
      pick = h('select', { cls: 'em-in', 'aria-label': 'Whose sign-off' }, M.people.map(function (p) { return h('option', { value: p.user_id, text: p.name + (p.user_id === M.ctx.uid ? ' (you)' : ''), selected: p.user_id === who }); }));
      pick.addEventListener('change', function () { who = pick.value; fill(); });
    }
    var l1 = h('input', { cls: 'em-in', type: 'text', 'aria-label': 'First line (name)', placeholder: 'Name' });
    var l2 = h('input', { cls: 'em-in', type: 'text', 'aria-label': 'Second line (title)', placeholder: 'Title' });
    var l3 = h('input', { cls: 'em-in', type: 'text', 'aria-label': 'Third line', placeholder: 'Eden Hospitality' });
    var prev = h('div', { cls: 'em-sigwrap' });
    function cur() { return { line1: l1.value.trim(), line2: l2.value.trim(), line3: l3.value.trim() }; }
    function paint() { prev.innerHTML = ''; prev.appendChild(sigPreview(cur())); }
    function fill() { var x = M.sigs[who] || {}; l1.value = x.line1 || ''; l2.value = x.line2 || ''; l3.value = x.line3 || ''; paint(); }
    [l1, l2, l3].forEach(function (i) { i.addEventListener('input', paint); });
    var save = btn('Save sign-off', function () {
      save.disabled = true;
      var row = Object.assign({ user_id: who, updated_at: new Date().toISOString() }, cur());
      M.ctx.sb.from('mail_signatures').upsert(row).then(function (r) {
        save.disabled = false;
        if (r.error) { say('Couldn’t save the sign-off.', 'err'); return; }
        M.sigs[who] = row; say('Sign-off saved. It’s added to emails sent from the staff site.', 'ok');
      });
    }, 'em-go');
    var copy = btn('Copy for Gmail', function () {
      var html = sigHtml(cur()), text = sigText(cur());
      var done = function () { say('Copied. In Gmail: Settings (gear) > See all settings > Signature > Create new, paste, then Save changes at the bottom.', 'ok'); };
      try {
        if (window.ClipboardItem && navigator.clipboard && navigator.clipboard.write) {
          navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })]).then(done, function () { selectCopy(); });
        } else selectCopy();
      } catch (e) { selectCopy(); }
      function selectCopy() { var r = document.createRange(); r.selectNodeContents(prev.firstChild); var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r); try { document.execCommand('copy'); done(); } catch (x) {} sel.removeAllRanges(); }
    }, '', { title: 'To use the same sign-off when you write from Gmail itself' });
    box.appendChild(h('div', { cls: 'em-form em-sigform' }, [
      pick ? h('label', { cls: 'em-f' }, [h('span', { text: 'Whose sign-off' }), pick]) : null,
      h('label', { cls: 'em-f' }, [h('span', { text: 'Line 1' }), l1]),
      h('label', { cls: 'em-f' }, [h('span', { text: 'Line 2' }), l2]),
      h('label', { cls: 'em-f' }, [h('span', { text: 'Line 3' }), l3]),
      h('p', { cls: 'em-note', text: 'How it looks at the bottom of an email:' }), prev,
      h('div', { cls: 'em-row' }, [save, copy])]));
    fill();
    return box;
  }

  /* ---------- managing mailboxes ---------- */
  function reconnect(a) {
    var forUser = (a.people && a.people[0] && a.people[0].user_id) || M.ctx.uid;
    if (a.mine) forUser = M.ctx.uid;
    post('mail/start', { for: forUser, hint: a.address }).then(function (j) { location.href = j.url; }, function (e) { say(e.message, 'err'); });
  }
  function modal(title, kids) {
    var back = h('div', { cls: 'sc-modal wide', role: 'dialog', 'aria-modal': 'true', 'aria-label': title });
    var card = h('div', { cls: 'sc-card' }, [h('div', { cls: 'sc-card-h' }, [h('h2', { text: title }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: close } })]), h('div', { cls: 'sc-card-b' }, kids)]);
    back.appendChild(card);
    function close() { back.remove(); document.removeEventListener('keydown', escK); }
    function escK(ev) { if (ev.key === 'Escape') close(); }
    back.addEventListener('mousedown', function (ev) { if (ev.target === back) close(); });
    document.addEventListener('keydown', escK);
    document.body.appendChild(back);
    return { el: back, body: card.querySelector('.sc-card-b'), close: close };
  }
  function manage() {
    var md = modal(isOwner() ? 'Manage mailboxes' : 'My mailboxes', []);
    function paint() {
      md.body.innerHTML = '';
      var list = isOwner() ? M.accounts : mine();
      if (!list.length) md.body.appendChild(h('p', { text: 'No mailboxes are connected yet.' }));
      list.forEach(function (a) {
        var row = h('div', { cls: 'em-mrow' }, [
          h('div', { cls: 'em-mtop' }, [h('b', { text: a.address }), h('span', { cls: a.status === 'reconnect' ? 'em-warn' : 'em-ok', text: a.status === 'reconnect' ? 'Needs reconnecting' : 'Connected' })])]);
        if (isOwner()) {
          var has = {}; (a.people || []).forEach(function (p) { has[p.user_id] = 1; });
          row.appendChild(h('p', { cls: 'em-note', text: 'Who can open it:' }));
          row.appendChild(h('div', { cls: 'em-people' }, M.people.map(function (p) {
            var c = h('input', { type: 'checkbox', checked: !!has[p.user_id] });
            c.addEventListener('change', function () {
              c.disabled = true;
              M.ctx.sb.rpc('mail_set_access', { p_account: a.id, p_user: p.user_id, p_on: c.checked }).then(function (r) {
                c.disabled = false;
                if (r.error || (r.data && r.data.error)) { c.checked = !c.checked; say('Couldn’t change access.', 'err'); return; }
                say((c.checked ? p.name + ' can now open ' : p.name + ' can no longer open ') + a.address + '.', 'ok');
                return load().then(function () { paint(); render(); });
              });
            });
            return h('label', { cls: 'em-check' }, [c, ' ' + p.name + (p.role === 'owner' ? ' (you)' : '')]);
          })));
        }
        row.appendChild(h('div', { cls: 'em-row' }, [
          btn('Reconnect', function () { reconnect(a); }),
          isOwner() ? btn('Disconnect', function () {
            if (!confirm('Disconnect ' + a.address + ' from the staff site? The mailbox and its email stay in Google; it just won’t show here.')) return;
            post('mail/remove', { account: a.id }).then(function () { say(a.address + ' disconnected.', 'ok'); delete M.prof[a.id]; if (M.acct === a.id) { M.acct = ''; M.open = ''; M.thread = null; } return load().then(function () { paint(); render(); }); }, function (e) { say(e.message, 'err'); });
          }, 'danger') : null]));
        md.body.appendChild(row);
      });
      md.body.appendChild(h('h3', { cls: 'em-h3', text: 'Email sign-off' }));
      md.body.appendChild(signatureEditor());
      md.body.appendChild(h('h3', { cls: 'em-h3', text: isOwner() ? 'Connect another mailbox' : 'Connect your mailbox' }));
      md.body.appendChild(connectCard(false));
    }
    paint();
  }

  window.EdenMail = {
    show: show, hide: hide,
    // is there a mailbox this person can write from? (known once the menu's unread counts have loaded)
    canDraft: function () { return mine().length > 0; },
    // open a new email (subject, body, files: [{ file, name, mime, size }]) on the Business email page
    draft: function (o) { M.pending = Object.assign({}, o, { files: undefined, fwdAtts: (o.files || []).slice() }); flushDraft(); },
    // the unread count beside "Business email" in the menu
    counts: function (ctx) {
      if (!M.ctx) M.ctx = ctx; else { M.ctx.sb = ctx.sb; M.ctx.role = ctx.role; M.ctx.uid = ctx.uid; }
      var p = M.loaded ? Promise.resolve() : ctx.sb.rpc('mail_my_accounts').then(function (r) { if (!r.error) M.accounts = sortAccounts(r.data || []); });
      return p.then(function () { if (mine().length) return counts(); }).catch(function () {});
    }
  };
})();
