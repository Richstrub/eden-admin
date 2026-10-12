/* Eden staff site: Business email (the worker's half).
 *
 * The staff site shows your Google Workspace mailboxes by asking Gmail directly, every time. Nothing is copied
 * or kept here, and every action (send, reply, delete, archive, move, star, mark read) is done in Gmail itself,
 * so the staff site and Gmail always match: change something in one and the other shows it.
 *
 *   /mail/status    Which settings are in place (names only, never values).
 *   /mail/start     A signed-in Owner or manager asks to connect a mailbox: returns Google's sign-in page.
 *   /mail/callback  Google sends the person back here after they allow access. The permission is locked
 *                   (encrypted) and handed to the staff site, which saves it with /mail/finish.
 *   /mail/finish    Saves the mailbox (the database checks who may connect it, and for whom).
 *   /mail/api       Reads and changes a mailbox in Gmail. The database decides who may open which mailbox.
 *   /mail/remove    Owner: disconnects a mailbox and cancels the permission at Google. The mailbox is untouched.
 *
 * Settings (Cloudflare > Workers > eden-admin > Settings > Variables and Secrets). All three are secrets:
 *   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET  from Google Cloud > Google Auth Platform > Clients (a "Web application"
 *                   client whose redirect address is https://edencny-staff.com/mail/callback).
 *   MAIL_TOKEN_KEY  any long random text (the Business email page makes one for you). It locks the saved Google
 *                   permissions; changing it later means reconnecting every mailbox.
 */

const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me/';
const SCOPE = 'https://mail.google.com/';   // full mailbox access: needed so "Delete forever" works like it does in Gmail
const ID = /^[A-Za-z0-9_-]{1,80}$/;
const ATT = /^[A-Za-z0-9_-]{1,2048}$/;
const enc = new TextEncoder(), dec = new TextDecoder();

function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); }
function b64u(bytes) { let s = ''; const b = new Uint8Array(bytes); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64u(s) { const bin = atob(String(s).replace(/-/g, '+').replace(/_/g, '/')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
const sbBase = env => String(env.SUPABASE_URL || '').replace(/\/$/, '');
function staffUrl(env, req) { return String(env.STAFF_URL || new URL(req.url).origin).replace(/\/?$/, '/'); }
function redirectUri(env, req) { return staffUrl(env, req) + 'mail/callback'; }
function missing(env) { return ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'MAIL_TOKEN_KEY'].filter(k => !String(env[k] || '').trim()); }

/* ---- locking (AES-GCM, key made from MAIL_TOKEN_KEY) ---- */
const keyCache = new Map();
async function aesKey(env) {
  const raw = String(env.MAIL_TOKEN_KEY || '').trim();
  if (!keyCache.has(raw)) keyCache.set(raw, crypto.subtle.importKey('raw', await crypto.subtle.digest('SHA-256', enc.encode('eden-mail|' + raw)), 'AES-GCM', false, ['encrypt', 'decrypt']));
  return keyCache.get(raw);
}
async function seal(env, obj, purpose) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(purpose) }, await aesKey(env), enc.encode(JSON.stringify(obj)));
  return 'v1.' + b64u(iv) + '.' + b64u(ct);
}
async function unseal(env, s, purpose) {
  const p = String(s || '').split('.');
  if (p.length !== 3 || p[0] !== 'v1') return null;
  try {
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64u(p[1]), additionalData: enc.encode(purpose) }, await aesKey(env), unb64u(p[2]));
    return JSON.parse(dec.decode(pt));
  } catch (e) { return null; }
}

/* ---- who is asking (their staff site sign-in) ---- */
function jwtOf(req) { return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''); }
async function userOf(env, jwt) {
  if (!jwt) return null;
  try {
    const r = await fetch(sbBase(env) + '/auth/v1/user', { headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + jwt } });
    if (!r.ok) return null;
    const u = await r.json();
    return u && u.id ? u : null;
  } catch (e) { return null; }
}
async function rpcAs(env, jwt, name, args) {
  const r = await fetch(sbBase(env) + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + jwt, 'content-type': 'application/json' }, body: JSON.stringify(args) });
  if (r.status === 404) throw Object.assign(new Error('missing_sql'), { code: 'missing_sql' });
  if (!r.ok) throw Object.assign(new Error('rpc ' + name + ' ' + r.status), { code: r.status === 401 ? 'auth' : 'db' });
  return r.json();
}

/* ---- Google ---- */
async function googleToken(env, form) {
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(Object.assign({ client_id: String(env.GOOGLE_CLIENT_ID).trim(), client_secret: String(env.GOOGLE_CLIENT_SECRET).trim() }, form)) });
  const j = await r.json().catch(() => ({}));
  return { ok: r.ok && !!j.access_token, j };
}
const access = new Map();   // short-lived Gmail access passes, kept for the life of this worker copy (up to an hour)
async function accessFor(env, cacheKey, refresh, fresh) {
  const c = access.get(cacheKey);
  if (!fresh && c && c.exp > Date.now() + 60000) return c.at;
  const t = await googleToken(env, { grant_type: 'refresh_token', refresh_token: refresh });
  if (!t.ok) { access.delete(cacheKey); return t.j && t.j.error === 'invalid_grant' ? 'REVOKED' : null; }
  access.set(cacheKey, { at: t.j.access_token, exp: Date.now() + (Number(t.j.expires_in) || 3000) * 1000 });
  return t.j.access_token;
}
function gmailFor(env, cacheKey, refresh) {
  let at = null;
  return async function g(path, opts, base) {
    opts = opts || {};
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!at || attempt) { at = await accessFor(env, cacheKey, refresh, attempt > 0); if (!at || at === 'REVOKED') return { status: at === 'REVOKED' ? 'revoked' : 'google', r: null }; }
      const headers = Object.assign({ Authorization: 'Bearer ' + at }, opts.headers || {});
      const r = await fetch((base || GMAIL) + path, Object.assign({}, opts, { headers }));
      if (r.status === 401 && !attempt) continue;
      return { status: r.ok ? 'ok' : 'gmail', r };
    }
  };
}
async function gj(g, path, opts, base) {
  const x = await g(path, opts, base);
  if (x.status !== 'ok') {
    const msg = x.r ? await x.r.text().catch(() => '') : '';
    throw Object.assign(new Error(x.status), { code: x.status, http: x.r && x.r.status, detail: msg.slice(0, 400) });
  }
  return x.r.status === 204 ? {} : x.r.json();
}

/* ---- the routes ---- */
function sameOrigin(req) { const o = req.headers.get('origin'); return !o || o === new URL(req.url).origin; }

async function status(req, env) {
  const m = missing(env);
  return json({ ready: !m.length && !!env.SUPABASE_URL, missing: m, redirect: redirectUri(env, req) });
}

async function start(req, env) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json({ error: 'bad' }, 400);
  if (missing(env).length) return json({ error: 'not_ready', missing: missing(env) }, 503);
  const u = await userOf(env, jwtOf(req));
  if (!u) return json({ error: 'auth' }, 401);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const forUser = /^[0-9a-f-]{36}$/.test(String(b.for || '')) ? String(b.for) : u.id;
  const hint = /^[^\s@<>]+@[^\s@<>]+$/.test(String(b.hint || '')) ? String(b.hint) : '';
  const state = await seal(env, { u: u.id, f: forUser, exp: Date.now() + 20 * 60000 }, 'state');
  const p = new URLSearchParams({ client_id: String(env.GOOGLE_CLIENT_ID).trim(), redirect_uri: redirectUri(env, req), response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'select_account consent', include_granted_scopes: 'false', state });
  if (hint) p.set('login_hint', hint);
  return json({ url: 'https://accounts.google.com/o/oauth2/v2/auth?' + p.toString() });
}

async function callback(req, env) {
  const url = new URL(req.url), back = staffUrl(env, req) + '#email/connected?';
  const go = q => Response.redirect(back + q, 302);
  if (missing(env).length) return go('err=not_ready');
  const st = await unseal(env, url.searchParams.get('state'), 'state');
  if (!st || !(st.exp > Date.now())) return go('err=expired');
  if (url.searchParams.get('error')) return go('err=' + (url.searchParams.get('error') === 'access_denied' ? 'denied' : 'google'));
  const code = url.searchParams.get('code') || '';
  if (!code) return go('err=google');
  const t = await googleToken(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(env, req) });
  if (!t.ok) return go('err=google');
  if (!t.j.refresh_token) return go('err=norefresh');
  if (String(t.j.scope || '').split(' ').indexOf(SCOPE) === -1) return go('err=scope');
  let address = '', name = '';
  try {
    const H = { Authorization: 'Bearer ' + t.j.access_token };
    const prof = await (await fetch(GMAIL + 'profile', { headers: H })).json();
    address = String(prof.emailAddress || '');
    const sa = await (await fetch(GMAIL + 'settings/sendAs', { headers: H })).json().catch(() => ({}));
    const prim = ((sa && sa.sendAs) || []).filter(s => s.isPrimary)[0];
    name = String((prim && prim.displayName) || '');
  } catch (e) {}
  if (!address) return go('err=google');
  const k = await seal(env, { u: st.u, f: st.f, t: t.j.refresh_token, a: address, n: name, exp: Date.now() + 20 * 60000 }, 'connect');
  return go('k=' + encodeURIComponent(k));
}

async function finish(req, env) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json({ error: 'bad' }, 400);
  if (missing(env).length) return json({ error: 'not_ready' }, 503);
  const jwt = jwtOf(req), u = await userOf(env, jwt);
  if (!u) return json({ error: 'auth' }, 401);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const c = await unseal(env, b.k, 'connect');
  if (!c || !(c.exp > Date.now())) return json({ error: 'expired', message: 'That sign-in has expired. Please connect the mailbox again.' }, 400);
  if (c.u !== u.id) return json({ error: 'auth', message: 'Someone else started this connection. Please connect the mailbox again while signed in as yourself.' }, 403);
  const address = String(c.a).toLowerCase();
  let r;
  try { r = await rpcAs(env, jwt, 'mail_save_account', { p_address: address, p_name: c.n || '', p_token: await seal(env, { t: c.t }, 'token:' + address), p_for: c.f }); }
  catch (e) { return json({ error: e.code || 'db', message: e.code === 'missing_sql' ? 'The database isn’t set up for Business email yet: run supabase/business-email.sql in Supabase.' : 'Couldn’t save the mailbox.' }, 502); }
  if (r && r.error) {
    const m = { taken: address + ' is already connected to the staff site by someone else. Ask the Owner to give you access to it.', person: 'Mailboxes can only be connected for the Owner or a manager.', access: 'Only the Owner and managers can connect a mailbox, and managers only for themselves.' }[r.error] || 'Couldn’t save the mailbox.';
    return json({ error: r.error, message: m }, 403);
  }
  return json({ ok: true, id: r.id, address });
}

async function remove(req, env) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json({ error: 'bad' }, 400);
  const jwt = jwtOf(req);
  if (!jwt) return json({ error: 'auth' }, 401);
  let b = {}; try { b = await req.json(); } catch (e) {}
  if (!/^[0-9a-f-]{36}$/.test(String(b.account || ''))) return json({ error: 'bad' }, 400);
  let r; try { r = await rpcAs(env, jwt, 'mail_remove', { p_account: b.account }); } catch (e) { return json({ error: e.code || 'db' }, 502); }
  if (!r || r.error) return json({ error: (r && r.error) || 'db' }, 403);
  if (r.token && !missing(env).length) {
    // cancel the permission at Google too
    const t = await unsealToken(env, r.token, r.address);
    if (t) { try { await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: t }) }); } catch (e) {} }
  }
  return json({ ok: true });
}
async function unsealToken(env, tokenEnc, address) {
  const x = await unseal(env, tokenEnc, 'token:' + String(address || '').toLowerCase());
  return x && x.t ? x.t : '';
}

const SUMMARY_HEADERS = ['From', 'To', 'Cc', 'Subject', 'Date'];
function hdr(m, name) { const h = ((m.payload && m.payload.headers) || []).filter(x => x.name.toLowerCase() === name.toLowerCase())[0]; return h ? h.value : ''; }
function summarize(t, address) {
  const ms = t.messages || [];
  const last = ms[ms.length - 1] || {}, first = ms[0] || {};
  const labels = {}; ms.forEach(m => (m.labelIds || []).forEach(l => { labels[l] = 1; }));
  const people = []; ms.forEach(m => { const f = hdr(m, 'From'); if (f && people.indexOf(f) === -1) people.push(f); });
  const notMe = ms.filter(m => (hdr(m, 'From').toLowerCase().indexOf(address) === -1));
  return {
    id: t.id, n: ms.length, snippet: last.snippet || '', subject: hdr(first, 'Subject'),
    from: hdr((notMe[notMe.length - 1] || last), 'From'), to: hdr(last, 'To'), people,
    date: Number(last.internalDate) || 0,
    unread: ms.some(m => (m.labelIds || []).indexOf('UNREAD') !== -1),
    starred: ms.some(m => (m.labelIds || []).indexOf('STARRED') !== -1),
    attach: ms.some(m => /multipart\/mixed/i.test((m.payload && m.payload.mimeType) || '')),
    labels: Object.keys(labels)
  };
}
function idList(x, max) { const a = Array.isArray(x) ? x.map(String) : []; return a.length && a.length <= (max || 40) && a.every(i => ID.test(i)) ? a : null; }

async function api(req, env) {
  if (req.method !== 'POST' || !sameOrigin(req)) return json({ error: 'bad' }, 400);
  if (missing(env).length) return json({ error: 'not_ready', missing: missing(env) }, 503);
  const jwt = jwtOf(req);
  if (!jwt) return json({ error: 'auth' }, 401);
  let b; try { const t = await req.text(); if (t.length > 32 * 1024 * 1024) return json({ error: 'too_big', message: 'That email is too large to send (the limit is 25 MB including attachments).' }, 413); b = JSON.parse(t); } catch (e) { return json({ error: 'bad' }, 400); }
  if (!/^[0-9a-f-]{36}$/.test(String(b.account || ''))) return json({ error: 'bad' }, 400);
  let tk;
  try { tk = await rpcAs(env, jwt, 'mail_token', { p_account: b.account }); } catch (e) { return json({ error: e.code || 'db' }, e.code === 'auth' ? 401 : 502); }
  if (!tk || tk.error) return json({ error: 'access', message: 'You don’t have access to this mailbox.' }, 403);
  const address = String(tk.address).toLowerCase();
  const refresh = await unsealToken(env, tk.token, address);
  if (!refresh) return json({ error: 'reconnect', message: 'This mailbox needs to be connected again (the staff site’s MAIL_TOKEN_KEY may have changed).' }, 409);
  const g = gmailFor(env, b.account + ':' + String(tk.token).slice(-24), refresh);
  try {
    return await runOp(g, b, address, tk);
  } catch (e) {
    if (e.code === 'revoked') {
      try { await rpcAs(env, jwt, 'mail_needs_reconnect', { p_account: b.account }); } catch (x) {}
      return json({ error: 'reconnect', message: 'Google no longer allows the staff site into ' + address + ' (the password may have changed, or access was removed). Connect it again.' }, 409);
    }
    if (e.code === 'gmail') return json({ error: 'gmail', http: e.http, message: gmailMessage(e) }, e.http === 404 ? 404 : 502);
    return json({ error: e.code || 'server', message: 'Couldn’t reach Gmail. Try again in a moment.' }, 502);
  }
}
function gmailMessage(e) {
  if (e.http === 404) return 'That email is no longer in this mailbox (it may have been deleted in Gmail).';
  if (e.http === 403 && /accessNotConfigured|has not been used|disabled/i.test(e.detail || '')) return 'The Gmail API is switched off in Google Cloud. Turn it on (APIs & Services > Library > Gmail API > Enable).';
  if (e.http === 429) return 'Gmail asked us to slow down. Try again in a minute.';
  if (e.http === 400 && /Invalid To header|Recipient address required|invalid.*address/i.test(e.detail || '')) return 'Gmail didn’t accept one of the email addresses. Check the To, Cc and Bcc fields.';
  return 'Gmail couldn’t do that (' + e.http + '). Try again.';
}

async function runOp(g, b, address, tk) {
  const op = String(b.op || '');
  if (op === 'profile') {
    const [labels, inbox, sendAs] = await Promise.all([gj(g, 'labels'), gj(g, 'labels/INBOX'), gj(g, 'settings/sendAs').catch(() => ({ sendAs: [] }))]);
    return json({ address, name: tk.name || '',
      labels: (labels.labels || []).map(l => ({ id: l.id, name: l.name, type: l.type })),
      inboxUnread: inbox.threadsUnread || 0,
      sendAs: (sendAs.sendAs || []).map(s => ({ email: s.sendAsEmail, name: s.displayName || '', signature: s.signature || '', primary: !!s.isPrimary, isDefault: !!s.isDefault })) });
  }
  if (op === 'counts') {
    const inbox = await gj(g, 'labels/INBOX');
    return json({ inboxUnread: inbox.threadsUnread || 0 });
  }
  if (op === 'list') {
    const p = new URLSearchParams({ maxResults: '25' });
    const label = String(b.label || 'INBOX');
    if (label !== 'ALL') { if (!ID.test(label)) return json({ error: 'bad' }, 400); p.append('labelIds', label); }
    if (b.q) p.set('q', String(b.q).slice(0, 300));
    if (b.page) { if (!/^[A-Za-z0-9_-]{1,200}$/.test(String(b.page))) return json({ error: 'bad' }, 400); p.set('pageToken', String(b.page)); }
    if (label === 'TRASH' || label === 'SPAM') p.set('includeSpamTrash', 'true');
    const list = await gj(g, 'threads?' + p.toString());
    const mh = SUMMARY_HEADERS.map(h => 'metadataHeaders=' + h).join('&');
    const threads = await Promise.all((list.threads || []).map(t => gj(g, 'threads/' + t.id + '?format=metadata&' + mh).catch(e => (e.http === 404 ? null : Promise.reject(e)))));
    return json({ threads: threads.filter(Boolean).map(t => summarize(t, address)), next: list.nextPageToken || '', estimate: list.resultSizeEstimate || 0 });
  }
  if (op === 'thread') {
    if (!ID.test(String(b.id || ''))) return json({ error: 'bad' }, 400);
    const x = await g('threads/' + b.id + '?format=full');
    if (x.status !== 'ok') { const d = x.r ? await x.r.text().catch(() => '') : ''; throw Object.assign(new Error(x.status), { code: x.status, http: x.r && x.r.status, detail: d }); }
    return new Response(x.r.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });   // passed straight through
  }
  if (op === 'attachment') {
    if (!ID.test(String(b.msg || '')) || !ATT.test(String(b.id || ''))) return json({ error: 'bad' }, 400);
    const x = await g('messages/' + b.msg + '/attachments/' + b.id);
    if (x.status !== 'ok') { throw Object.assign(new Error(x.status), { code: x.status, http: x.r && x.r.status }); }
    return new Response(x.r.body, { headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });
  }
  if (op === 'modify') {
    const ids = idList(b.ids), add = Array.isArray(b.add) ? b.add.map(String) : [], rem = Array.isArray(b.remove) ? b.remove.map(String) : [];
    if (!ids || !add.concat(rem).every(l => ID.test(l)) || !(add.length + rem.length)) return json({ error: 'bad' }, 400);
    await Promise.all(ids.map(id => gj(g, 'threads/' + id + '/modify', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ addLabelIds: add, removeLabelIds: rem }) })));
    return json({ ok: true });
  }
  if (op === 'trash' || op === 'untrash' || op === 'delete') {
    const ids = idList(b.ids);
    if (!ids) return json({ error: 'bad' }, 400);
    await Promise.all(ids.map(id => op === 'delete' ? gj(g, 'threads/' + id, { method: 'DELETE' }) : gj(g, 'threads/' + id + '/' + op, { method: 'POST' })));
    return json({ ok: true });
  }
  if (op === 'label') {
    const name = String(b.name || '').trim().slice(0, 225);
    if (!name || /^(inbox|sent|trash|spam|draft|starred|important|unread|chat)$/i.test(name)) return json({ error: 'bad', message: 'Choose a different folder name.' }, 400);
    const x = await g('labels', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });
    if (x.status === 'ok') { const l = await x.r.json(); return json({ id: l.id, name: l.name, type: l.type }); }
    if (x.r && x.r.status === 409) { const all = await gj(g, 'labels'); const l = (all.labels || []).filter(l => l.name.toLowerCase() === name.toLowerCase())[0]; if (l) return json({ id: l.id, name: l.name, type: l.type }); }
    throw Object.assign(new Error(x.status), { code: x.status, http: x.r && x.r.status });
  }
  if (op === 'send') {
    // the staff site builds the whole email (so attachments are packed in the browser, not here)
    const raw = String(b.raw || '');
    if (!raw || /[^\x09\x0a\x0d\x20-\x7e]/.test(raw)) return json({ error: 'bad' }, 400);
    // (Gmail itself only sends From this mailbox or its verified "send mail as" addresses)
    const meta = {}; if (b.threadId) { if (!ID.test(String(b.threadId))) return json({ error: 'bad' }, 400); meta.threadId = String(b.threadId); }
    const bd = 'eden' + crypto.getRandomValues(new Uint32Array(2)).join('x');
    const body = '--' + bd + '\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(meta) + '\r\n--' + bd + '\r\ncontent-type: message/rfc822\r\n\r\n' + raw + '\r\n--' + bd + '--';
    const sent = await gj(g, 'messages/send?uploadType=multipart', { method: 'POST', headers: { 'content-type': 'multipart/related; boundary=' + bd }, body }, 'https://gmail.googleapis.com/upload/gmail/v1/users/me/');
    return json({ ok: true, id: sent.id, threadId: sent.threadId });
  }
  return json({ error: 'bad' }, 400);
}

export async function mailRoute(req, env, path) {
  if (path === '/mail/status') return status(req, env);
  if (path === '/mail/start') return start(req, env);
  if (path === '/mail/callback') return callback(req, env);
  if (path === '/mail/finish') return finish(req, env);
  if (path === '/mail/remove') return remove(req, env);
  if (path === '/mail/api') return api(req, env);
  return null;
}
