/* Eden staff site: Promotional emails (Office > Promotional emails). Used by worker.js.
 *
 *   POST /promo/subscribe    edencny.com's "Join our list" box. Screened for bots (a hidden trap field, a too-fast
 *                            check, at most 5 sign-ups an hour from one connection).
 *   GET/POST /promo/unsubscribe?t=…   The link at the bottom of every email: shows the address and a button;
 *                            email programs' one-click "Unsubscribe" (POST) works straight away.
 *   POST /promo/test         The Owner or a manager sends the email they're writing to an address of theirs.
 *   POST /promo/run          Sends any email that's due now (after "Send now"). Also runs every 5 minutes on its own,
 *                            so scheduled emails go out within 5 minutes of their time.
 *   Resend events            email.delivered / opened / clicked / bounced / complained: the results on each email.
 *                            They arrive at /inbound (the same Resend webhook as guests' replies) or /promo/webhook.
 *
 * Emails go out through Resend (RESEND_API_KEY) from PROMO_FROM (wrangler.jsonc), 100 at a time, each with its own
 * unsubscribe link and one-click unsubscribe headers. Nothing secret is in this file.
 */
const sbBase = env => String(env.SUPABASE_URL || '').replace(/\/$/, '');
const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[a-z]{2,}$/i;
const MIN_MS = 3000;   // a person takes more than 3 seconds to type an email address

function json(obj, status, headers) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, headers || {}) }); }
function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function staffUrl(env, req) { return String(env.STAFF_URL || (req ? new URL(req.url).origin : '')).replace(/\/?$/, '/'); }
function fromAddr(env) { return env.PROMO_FROM || 'Eden <info@edencny.com>'; }
function replyTo(env) { return env.PROMO_REPLY_TO || 'info@edencny.com'; }
const wait = ms => new Promise(r => setTimeout(r, ms));

async function rpc(env, name, args, jwt) {
  const r = await fetch(sbBase(env) + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + (jwt || env.SUPABASE_KEY), 'content-type': 'application/json' }, body: JSON.stringify(args || {}) });
  if (r.status === 404) throw Object.assign(new Error('missing_sql'), { code: 'missing_sql' });
  if (!r.ok) throw Object.assign(new Error('rpc ' + name + ' ' + r.status), { code: 'db' });
  return r.json();
}
async function ipKey(req) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('eden-promo|' + (req.headers.get('cf-connecting-ip') || '')));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function manager(req, env) {
  const o = req.headers.get('origin'); if (o && o !== new URL(req.url).origin) return { error: json({ error: 'origin' }, 403) };
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return { error: json({ error: 'auth' }, 401) };
  let lvl; try { lvl = await rpc(env, 'access_level', {}, jwt); } catch (e) { return { error: json({ error: 'auth' }, 401) }; }
  if (lvl !== 'owner' && lvl !== 'manager') return { error: json({ error: 'auth' }, 403) };
  return { jwt };
}
function unsubUrl(env, token) { return staffUrl(env) + 'promo/unsubscribe?t=' + encodeURIComponent(token); }
function personalize(s, env, c) { return String(s || '').split('{{unsubscribe_url}}').join(esc(unsubUrl(env, c.token))); }
function message(env, camp, c) {
  const u = unsubUrl(env, c.token);
  return {
    from: fromAddr(env), to: [c.email], reply_to: replyTo(env), subject: camp.subject,
    html: personalize(camp.html, env, c),
    text: String(camp.text || '').split('{{unsubscribe_url}}').join(u),
    headers: { 'List-Unsubscribe': '<' + u + '>', 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
  };
}

/* ---------- website sign-up ---------- */
const SITE_HOSTS = /(^|\.)edencny\.com$|(^|[.-])eden-website\.richard-a-strub\.workers\.dev$|^richstrub\.github\.io$|^localhost$/i;
function hostOf(u) { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; } }
function cors(req) {
  const origin = req.headers.get('origin') || '', ok = SITE_HOSTS.test(hostOf(origin));
  return { ok, headers: { 'Access-Control-Allow-Origin': ok ? origin : 'null', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin', 'Cache-Control': 'no-store' } };
}
async function subscribe(req, env, key) {
  const c = cors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
  if (req.method !== 'POST' || !c.ok) return json({ error: 'bad' }, 400, c.headers);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const email = String(b.email || '').trim().slice(0, 200), name = String(b.name || '').trim().slice(0, 120);
  if (b.website || b.hp) return json({ ok: true }, 200, c.headers);                     // the hidden trap field: a bot
  if (b.t && Date.now() - Number(b.t) < MIN_MS) return json({ ok: true }, 200, c.headers);   // far too fast for a person
  if (!EMAIL_RE.test(email)) return json({ error: 'email' }, 400, c.headers);
  if (!key || !env.SUPABASE_URL) return json({ error: 'not_ready' }, 503, c.headers);
  let r; try { r = await rpc(env, 'promo_subscribe_server', { p_key: key, p_email: email, p_name: name, p_ip: await ipKey(req) }); }
  catch (e) { return json({ error: 'server' }, 502, c.headers); }
  if (r && r.error) return json({ error: r.error }, r.error === 'busy' ? 429 : 400, c.headers);
  return json({ ok: true, already: !!(r && r.already) }, 200, c.headers);
}

/* ---------- unsubscribe ---------- */
function page(title, inner) {
  return new Response('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>' + esc(title) + ' · Eden</title>' +
    '<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#f7f4ee;color:#0f1215;font-family:Georgia,serif;padding:24px;box-sizing:border-box}' +
    '.c{max-width:440px;background:#fff;border:1px solid rgba(15,18,21,.1);border-radius:16px;padding:36px 30px;text-align:center}' +
    '.m{font-size:1.6rem;letter-spacing:.4em;margin:0 0 18px}h1{font-weight:400;font-size:1.7rem;margin:0 0 12px}p{font-family:Helvetica,Arial,sans-serif;color:#4a4e53;line-height:1.55;font-size:.98rem;margin:0 0 18px}' +
    'button,a.b{font-family:Helvetica,Arial,sans-serif;font-size:.8rem;letter-spacing:.18em;text-transform:uppercase;padding:13px 24px;border:0;border-radius:2px;background:#0f1215;color:#fff;cursor:pointer;text-decoration:none;display:inline-block}' +
    'a{color:#8a5226}</style></head><body><div class="c"><div class="m">EDEN</div>' + inner + '</div></body></html>',
    { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-robots-tag': 'noindex' } });
}
async function unsubscribe(req, env, key) {
  const url = new URL(req.url), t = url.searchParams.get('t') || '';
  if (t === 'test') return page('Unsubscribe', '<h1>This is a test email</h1><p>In the real email, this link unsubscribes the guest it was sent to.</p>');
  if (!key) return page('Unsubscribe', '<h1>Something went wrong</h1><p>Please reply to our email and we’ll take you off the list.</p>');
  const post = req.method === 'POST', body = post ? await req.text().catch(() => '') : '';
  let r; try { r = await rpc(env, 'promo_unsub_server', { p_key: key, p_token: t, p_do: post }); } catch (e) { r = { error: 'server' }; }
  if (post && body.indexOf('List-Unsubscribe=One-Click') !== -1) return new Response('', { status: r && !r.error ? 200 : 400 });   // an email program's one-click unsubscribe
  if (!r || r.error) return page('Unsubscribe', '<h1>That link didn’t work</h1><p>It may be incomplete. Reply to any of our emails and we’ll take you off the list.</p>');
  if (r.status === 'unsubscribed' || r.status === 'complained') return page('Unsubscribed', '<h1>You’re unsubscribed</h1><p><b>' + esc(r.email) + '</b> won’t receive Eden’s emails anymore. We hope to see you at the table soon.</p><p><a href="https://edencny.com/">edencny.com</a></p>');
  if (r.status === 'bounced') return page('Unsubscribe', '<h1>You’re not on our list</h1><p>We aren’t sending emails to ' + esc(r.email) + '.</p>');
  return page('Unsubscribe', '<h1>Unsubscribe from Eden’s emails?</h1><p>We’ll stop sending news, menus and events to <b>' + esc(r.email) + '</b>.</p>' +
    '<form method="post" action="?t=' + esc(encodeURIComponent(t)) + '"><button type="submit">Unsubscribe</button></form>');
}

/* ---------- sending ---------- */
async function resendBatch(env, msgs, idem) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch('https://api.resend.com/emails/batch', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json', 'Idempotency-Key': idem }, body: JSON.stringify(msgs) });
    const j = await r.json().catch(() => ({}));
    if (r.ok) return { ids: ((j && j.data) || []).map(x => (x && x.id) || '') };
    // the plan's daily or monthly limit (free plan: 100 a day, 3,000 a month): waiting a second won't help
    if (j && /quota_exceeded/.test(j.name || '')) return { quota: /monthly/.test(j.name) ? 'monthly' : 'daily', error: j.message || 'Resend sending limit reached' };
    if (r.status === 429 || r.status >= 500) { await wait(1200 * (attempt + 1)); continue; }
    return { error: (j && (j.message || j.name)) || ('Resend said ' + r.status) };
  }
  return { error: 'Resend is busy; it will try again in a few minutes.' };
}
// Send every email that's due. Stops after ~20 seconds; the next run (every 5 minutes) carries on where it left off.
export async function promoRun(env, key) {
  if (!key || !env.SUPABASE_URL || !env.RESEND_API_KEY) return { error: 'not_ready' };
  const start = Date.now(), out = { sent: 0, campaigns: [] };
  for (let n = 0; n < 3 && Date.now() - start < 20000; n++) {
    const camp = await rpc(env, 'promo_claim_server', { p_key: key });
    if (!camp || camp.none || camp.error) break;
    out.campaigns.push(camp.id);
    let error = '', done = false, size = 100;
    while (Date.now() - start < 20000) {
      const batch = await rpc(env, 'promo_batch_server', { p_key: key, p_campaign: camp.id, p_limit: size });
      if (!Array.isArray(batch)) { error = 'Couldn’t read the guest list.'; break; }
      if (!batch.length) { done = true; break; }
      const res = await resendBatch(env, batch.map(c => message(env, camp, c)), camp.id + ':' + batch[0].id + ':' + batch.length);
      // a full batch is refused whole when only part of the day's limit is left: use up what's left in smaller batches
      if (res.quota === 'daily' && size > 1) { size = size > 10 ? Math.floor(size / 2) : 1; await wait(550); continue; }
      if (res.quota) { error = 'LIMIT:' + res.quota + ': Resend’s ' + res.quota + ' sending limit was reached (the free plan allows 100 emails a day and 3,000 a month).'; break; }
      if (res.error) { error = res.error; break; }
      await rpc(env, 'promo_record_server', { p_key: key, p_campaign: camp.id, p_rows: batch.map((c, i) => ({ contact_id: c.id, email: c.email, resend_id: res.ids[i] || '', error: res.ids[i] ? '' : 'not accepted' })) });
      out.sent += batch.length;
      await wait(550);   // Resend allows 2 requests a second
    }
    if (done || error) await rpc(env, 'promo_finish_server', { p_key: key, p_campaign: camp.id, p_error: error });
    if (!done) break;
  }
  return out;
}
async function run(req, env, key) {
  if (req.method !== 'POST') return json({ error: 'bad' }, 400);
  const m = await manager(req, env); if (m.error) return m.error;
  if (!env.RESEND_API_KEY) return json({ error: 'no_resend' }, 503);
  try { return json(await promoRun(env, key)); } catch (e) { return json({ error: e.code || 'server' }, 502); }
}
async function test(req, env) {
  if (req.method !== 'POST') return json({ error: 'bad' }, 400);
  const m = await manager(req, env); if (m.error) return m.error;
  if (!env.RESEND_API_KEY) return json({ error: 'no_resend' }, 503);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const to = String(b.to || '').split(/[,;\s]+/).map(s => s.trim()).filter(Boolean).slice(0, 5);
  if (!to.length || !to.every(x => EMAIL_RE.test(x))) return json({ error: 'email' }, 400);
  if (!b.html || !b.subject) return json({ error: 'empty' }, 400);
  const msg = message(env, { subject: '[Test] ' + String(b.subject).slice(0, 200), html: String(b.html).slice(0, 400000), text: String(b.text || '').slice(0, 100000) }, { email: to[0], token: 'test' });
  msg.to = to; delete msg.headers;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' }, body: JSON.stringify(msg) });
  const j = await r.json().catch(() => ({}));
  return r.ok ? json({ ok: true, id: j.id || '' }) : json({ error: 'resend', message: (j && (j.message || j.name)) || ('Resend said ' + r.status) }, 502);
}

/* ---------- results from Resend ---------- */
function b64ToBytes(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function signed(env, req, raw) {
  const id = req.headers.get('svix-id'), ts = req.headers.get('svix-timestamp'), sig = req.headers.get('svix-signature') || '';
  if (!id || !ts || !sig || Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  for (const s of [env.PROMO_WEBHOOK_SECRET, env.RESEND_WEBHOOK_SECRET]) {
    if (!s) continue;
    const key = await crypto.subtle.importKey('raw', b64ToBytes(String(s).trim().replace(/^whsec_/, '')), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id + '.' + ts + '.' + raw)));
    let e = ''; mac.forEach(b => { e += String.fromCharCode(b); }); e = btoa(e);
    if (sig.split(' ').some(p => p.split(',')[1] === e)) return true;
  }
  return false;
}
const EVENTS = /^email\.(delivered|opened|clicked|bounced|complained)$/;
// an already-verified Resend event (worker.js's /inbound passes these on)
export async function promoEvent(env, key, evt) {
  if (!evt || !EVENTS.test(evt.type || '') || !evt.data) return { ok: true, ignored: true };
  const id = String(evt.data.email_id || evt.data.id || '');
  if (!id || !key) return { ok: true, ignored: true };
  return rpc(env, 'promo_event_server', { p_key: key, p_resend_id: id, p_type: evt.type, p_at: evt.created_at || new Date().toISOString() });
}
async function webhook(req, env, key) {
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  const raw = await req.text();
  if (!(await signed(env, req, raw))) return json({ error: 'signature' }, 401);
  let evt; try { evt = JSON.parse(raw); } catch (e) { return json({ error: 'bad' }, 400); }
  try { return json(await promoEvent(env, key, evt)); } catch (e) { return json({ error: 'server' }, 500); }
}

export async function promoRoute(req, env, path, key) {
  if (path === '/promo/subscribe') return subscribe(req, env, key);
  if (path === '/promo/unsubscribe') return unsubscribe(req, env, key);
  if (path === '/promo/run') return run(req, env, key);
  if (path === '/promo/test') return test(req, env);
  if (path === '/promo/webhook') return webhook(req, env, key);
  if (path === '/promo/status') return json({ resend: !!env.RESEND_API_KEY, from: fromAddr(env), key: !!key });
  return null;
}
export const promoInternals = { message, personalize, signed };
