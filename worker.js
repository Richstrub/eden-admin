/* Eden staff site: web worker.
 *
 * Serves the staff site's files exactly as before, plus a few small addresses the public website uses:
 *
 *   /t                Counts one page view for Analytics > Website traffic: the page, roughly where the visitor
 *                     is (Cloudflare works out country, state and city; no IP address is stored), how they found
 *                     the site, and the kind of device. A visitor is an anonymous code that changes every day.
 *   /inquiry/config   Tells the website whether online inquiries are switched on.
 *   /inquiry          Receives the short catering inquiry (about the guest + their event). Bots are screened out:
 *                     Cloudflare Turnstile, a hidden trap field, a too-fast check, a per-connection limit and
 *                     sanity checks. It lands in Catering & BEOs and the event team gets an email.
 *   /plan             The guest's private link to the full questionnaire: GET fills in what they sent, POST saves it.
 *   /admin/send       Staff email a guest from Catering & BEOs (checked against the database as that staff member).
 *   /admin/tips       End of day report: email each tip-pool server their share of the night's tips (cash and card kept
 *                     separate, split by hours worked), with a copy of everyone's shares to the Owner (TIPS_COPY_TO).
 *   /inbound          Guests' email replies, delivered by Resend, saved into the inquiry's conversation.
 *   /mail/...         Business email: your Google Workspace mailboxes, read and changed in Gmail (mail-worker.js).
 *   /preshift/refresh Pre-shift: reads today's OpenTable email (preshift-worker.js). Also runs every 20 minutes on its own.
 *   /promo/...        Promotional emails: website sign-ups, unsubscribe links, test sends and sending (promo-worker.js).
 *
 * Settings (Cloudflare > Workers > eden-admin > Settings > Variables and Secrets). Nothing secret is in this file:
 *   INQUIRY_KEY         secret: from  select public.new_inquiry_key();  in Supabase. Without it the questionnaire
 *                       keeps using the old "save a file and email it" method.
 *   TURNSTILE_SITE_KEY  and TURNSTILE_SECRET: from Cloudflare > Turnstile. Both needed to switch Turnstile on.
 *   RESEND_API_KEY      secret: from resend.com, to send emails to guests and the heads-up emails to the team.
 *   RESEND_WEBHOOK_SECRET  secret, and INBOUND_DOMAIN (e.g. abc123.resend.app): to receive guests' replies.
 *   SUPABASE_URL, SUPABASE_KEY (public key), MAIL_FROM, NOTIFY_TO, SITE_URL: plain settings in wrangler.jsonc.
 */
// Eden's website, its Cloudflare address (including preview copies) and its GitHub Pages copy
import BUILD_KEY from './inquiry-key.generated.js';   // INQUIRY_KEY from the Build settings, if saved there
import { mailRoute } from './mail-worker.js';          // Business email (Gmail), see that file
import { preshiftRoute, preshiftRefresh } from './preshift-worker.js';   // Pre-shift reservations from OpenTable
import { promoRoute, promoRun, promoEvent } from './promo-worker.js';     // Promotional emails (Resend)

const SITE_HOSTS = /(^|\.)edencny\.com$|(^|[.-])eden-website\.richard-a-strub\.workers\.dev$|^richstrub\.github\.io$/i;
const BOTS = /bot|crawl|spider|slurp|preview|headless|lighthouse|pagespeed|facebookexternalhit|embedly|quora link|whatsapp|telegram|discord|curl|wget|python|axios|node-fetch|go-http|java\/|monitor|uptime|pingdom|scan/i;

function cut(v, n) { return String(v == null ? '' : v).trim().slice(0, n); }
function hostOf(u) { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch (e) { return ''; } }
function device(ua) {
  if (/iPad|Tablet|PlayBook|Silk|(Android(?!.*Mobile))/i.test(ua)) return 'tablet';
  if (/Mobi|iPhone|iPod|Android|IEMobile|Opera Mini/i.test(ua)) return 'mobile';
  return 'desktop';
}
function browser(ua) {
  if (/Edg\//.test(ua)) return 'Edge';
  if (/OPR\/|Opera/.test(ua)) return 'Opera';
  if (/SamsungBrowser/.test(ua)) return 'Samsung Internet';
  if (/Instagram/.test(ua)) return 'Instagram app';
  if (/FBAN|FBAV/.test(ua)) return 'Facebook app';
  if (/Firefox|FxiOS/.test(ua)) return 'Firefox';
  if (/Chrome|CriOS/.test(ua)) return 'Chrome';
  if (/Safari/.test(ua)) return 'Safari';
  return 'Other';
}
async function visitorCode(req, env) {
  const ip = req.headers.get('cf-connecting-ip') || '';
  const ua = req.headers.get('user-agent') || '';
  const day = new Date().toISOString().slice(0, 10);
  const salt = env.VISITOR_SALT || 'eden-daily';
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(salt + '|' + day + '|' + ip + '|' + ua));
  return [...new Uint8Array(buf)].slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function track(req, env) {
  const origin = req.headers.get('origin') || '';
  const cors = { 'Access-Control-Allow-Origin': origin || '*', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Vary': 'Origin', 'Cache-Control': 'no-store' };
  const done = () => new Response(null, { status: 204, headers: cors });
  if (req.method === 'OPTIONS') return done();
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });

  const siteHost = hostOf(origin) || hostOf(req.headers.get('referer') || '');
  if (!SITE_HOSTS.test(siteHost)) return done();                 // only visits to Eden's own website
  const ua = req.headers.get('user-agent') || '';
  if (!ua || BOTS.test(ua)) return done();                         // search engines, link previews, scripts
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return done();

  let body = {};
  try { const t = await req.text(); if (t.length > 4000) return done(); body = JSON.parse(t || '{}'); } catch (e) { return done(); }
  const cf = req.cf || {};
  let ref = hostOf(body.r || '');
  if (ref && (SITE_HOSTS.test(ref) || SITE_HOSTS.test('www.' + ref))) ref = '';   // moving around our own site isn't a source
  const lat = parseFloat(cf.latitude), lon = parseFloat(cf.longitude);
  const row = {
    path: cut(body.p || '/', 300) || '/',
    host: cut(siteHost, 120),
    referrer: cut(ref, 200),
    source: cut(body.s, 100).toLowerCase(),
    medium: cut(body.m, 100).toLowerCase(),
    campaign: cut(body.c, 150),
    country: /^[A-Z]{2}$/.test(cf.country || '') && cf.country !== 'XX' && cf.country !== 'T1' ? cf.country : '',
    region: cut(cf.region, 100),
    city: cut(cf.city, 100),
    lat: isFinite(lat) ? Math.round(lat * 100) / 100 : null,
    lon: isFinite(lon) ? Math.round(lon * 100) / 100 : null,
    device: device(ua),
    browser: browser(ua),
    visitor: await visitorCode(req, env)
  };
  try {
    await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/page_views', {
      method: 'POST',
      headers: { 'apikey': env.SUPABASE_KEY, 'content-type': 'application/json', 'prefer': 'return=minimal' },
      body: JSON.stringify(row)
    });
  } catch (e) { /* a missed visit is not worth an error page */ }
  return done();
}


/* ---------------- catering inquiries ---------------- */
const MIN_MS = 15 * 1000;   // nobody fills in the inquiry form in under 15 seconds
const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i;
function siteCors(req) {
  const origin = req.headers.get('origin') || '';
  const ok = SITE_HOSTS.test(hostOf(origin));
  return { ok, headers: { 'Access-Control-Allow-Origin': ok ? origin : 'null', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin', 'Cache-Control': 'no-store' } };
}
function json(obj, status, headers) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json', 'cache-control': 'no-store' }, headers || {}) }); }
function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
// The private inquiry key. Forgiving about how it was entered in Cloudflare: the name in any case or with
// spaces (e.g. "inquiry key"), and stray spaces, quotes or line breaks around the value.
function keyName(env) { return Object.keys(env || {}).filter(k => k.replace(/[^a-z]/gi, '').toUpperCase() === 'INQUIRYKEY')[0] || ''; }
function inqKey(env) { const n = keyName(env), v = n ? String(env[n] || '').replace(/[^a-f0-9]/gi, '').toLowerCase() : ''; return v || String(BUILD_KEY || ''); }
function turnstileOn(env) { return !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET); }
function mailOn(env) { return !!(env.RESEND_API_KEY && env.MAIL_FROM); }
function inboundOn(env) { return !!(mailOn(env) && env.INBOUND_DOMAIN && env.RESEND_WEBHOOK_SECRET); }
function staffUrl(env, req) { return String(env.STAFF_URL || new URL(req.url).origin).replace(/\/?$/, '/'); }
function siteUrl(env) { return String(env.SITE_URL || 'https://edencny.com/').replace(/\/?$/, '/'); }
function replyAddr(env, id) { return inboundOn(env) ? 'i-' + String(id).replace(/-/g, '') + '@' + String(env.INBOUND_DOMAIN).replace(/^@/, '') : ''; }
function staffTo(env) { return String(env.NOTIFY_TO || '').split(',').map(x => x.trim()).filter(Boolean); }
const sbBase = env => env.SUPABASE_URL.replace(/\/$/, '');
async function ipKey(req) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('eden-inquiry|' + (req.headers.get('cf-connecting-ip') || '')));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function rpc(env, name, args, jwt) {
  const headers = { 'apikey': env.SUPABASE_KEY, 'content-type': 'application/json' };
  if (jwt) headers.Authorization = 'Bearer ' + jwt;
  const r = await fetch(sbBase(env) + '/rest/v1/rpc/' + name, { method: 'POST', headers, body: JSON.stringify(args) });
  if (!r.ok) throw new Error('rpc ' + name + ' ' + r.status);
  return r.json();
}
// table calls made as the signed-in staff member, so the database's own rules decide what they may do
async function asUser(env, jwt, method, path, body) {
  const r = await fetch(sbBase(env) + '/rest/v1/' + path, {
    method, headers: { 'apikey': env.SUPABASE_KEY, 'Authorization': 'Bearer ' + jwt, 'content-type': 'application/json', 'prefer': 'return=representation' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!r.ok) throw new Error(method + ' ' + path.split('?')[0] + ' ' + r.status);
  return r.status === 204 ? null : r.json();
}
async function sendMail(env, msg) {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ from: env.MAIL_FROM }, msg))
    });
    const j = await r.json().catch(() => ({}));
    return { ok: r.ok, id: (j && j.id) || '', error: r.ok ? '' : ((j && (j.message || j.name)) || ('HTTP ' + r.status)) };
  } catch (e) { return { ok: false, id: '', error: String(e && e.message || e) }; }
}
function longDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(d || ''); if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function money(n) { return n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
function mailShell(title, inner) {
  return '<!doctype html><html><body style="margin:0;background:#f7f4ee;font-family:Georgia,serif;color:#0f1215">' +
    '<div style="max-width:560px;margin:0 auto;padding:32px 24px"><div style="font-size:26px;letter-spacing:.3em;text-align:center;margin-bottom:24px">EDEN</div>' +
    '<div style="background:#fff;border:1px solid #e3ddd2;padding:28px 26px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#24282c">' +
    (title ? '<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:22px;margin:0 0 14px;color:#0f1215">' + esc(title) + '</h1>' : '') + inner + '</div>' +
    '<p style="font-family:Arial,sans-serif;font-size:12px;color:#7f7a71;text-align:center;margin-top:18px">Eden · 118 E. Genesee St., Syracuse, NY · edencny.com</p></div></body></html>';
}
function button(href, label) { return '<p style="margin:18px 0"><a href="' + esc(href) + '" style="display:inline-block;background:#b0703f;color:#fff;text-decoration:none;padding:12px 22px;letter-spacing:.12em;text-transform:uppercase;font-size:12px">' + esc(label) + '</a></p>'; }
function textToHtml(t) { return String(t || '').split(/\n{2,}/).map(p => '<p style="margin:0 0 12px">' + esc(p).replace(/\n/g, '<br>') + '</p>').join(''); }
function detailRows(q) {
  const rows = [['Event', q.event_name], ['Date', longDate(q.event_date)], ['Guests', q.guests], ['Where', q.location], ['Estimate', money(q.estimate)]].filter(r => r[1]);
  return '<table style="border-collapse:collapse;margin:14px 0;font-size:14px">' + rows.map(r => '<tr><td style="padding:3px 16px 3px 0;color:#7f7a71">' + esc(r[0]) + '</td><td style="padding:3px 0">' + esc(r[1]) + '</td></tr>').join('') + '</table>';
}
// A heads-up to the event team (Tyler and Rich): a new inquiry, a finished questionnaire, or a guest's reply.
async function notifyStaff(env, req, q, kind, extra) {
  const to = staffTo(env);
  if (!mailOn(env) || !to.length) return false;
  const admin = staffUrl(env, req) + '#catering';
  const who = q.name || 'A guest';
  const T = {
    inquiry: q.held
      ? ['Check this inquiry: ' + who, 'Inquiry filed under Spam', esc(who) + ' sent an inquiry from the website, but Cloudflare’s quick “are you a person” check couldn’t confirm it, so it’s under the <b>Spam</b> tab. If it looks real, open it and choose Not spam.']
      : ['New catering inquiry: ' + who, 'New catering inquiry', esc(who) + ' sent an inquiry from the website.'],
    plan: [(q.again ? 'Updated questionnaire: ' : 'Questionnaire completed: ') + who, q.again ? 'Questionnaire updated' : 'Questionnaire completed', esc(who) + (q.again ? ' updated' : ' finished') + ' the full catering questionnaire.'],
    reply: ['Reply from ' + who + (extra && extra.subject ? ': ' + extra.subject : ''), 'Reply from ' + who, (extra && extra.body ? textToHtml(extra.body.slice(0, 3000)) : '')]
  }[kind];
  const r = await sendMail(env, {
    to, reply_to: q.email || undefined,
    subject: T[0] + (q.event_date && kind !== 'reply' ? ' · ' + longDate(q.event_date) : ''),
    html: mailShell(T[1], '<p>' + T[2] + '</p>' + (kind === 'reply' ? '' : detailRows(q)) + button(admin, 'Open in Catering & BEOs') +
      '<p style="font-size:13px;color:#7f7a71">' + (kind === 'reply' ? 'The reply is saved in the guest’s conversation on the staff site.' : 'Reply from the staff site to keep the conversation in one place.') + '</p>'),
    text: T[0] + '\n\n' + (extra && extra.body ? extra.body.slice(0, 3000) + '\n\n' : '') + 'Open it: ' + admin
  });
  return r.ok;
}

// ?check=1 (used by the Catering & BEOs page) also tests the connection to the database
async function inquiryConfig(req, env) {
  const c = siteCors(req), out = { ready: !!(inqKey(env) && env.SUPABASE_URL), turnstile: turnstileOn(env) ? env.TURNSTILE_SITE_KEY : '' };
  if (new URL(req.url).searchParams.get('check')) {
    out.keySet = !!inqKey(env); out.keyLooksRight = inqKey(env).length === 64;
    out.keyName = keyName(env); out.keySource = keyName(env) && env[keyName(env)] ? 'secret' : (BUILD_KEY ? 'build settings' : '');
    // names only (never values) of the settings this worker can see, to spot one added in the wrong place
    out.settings = Object.keys(env).filter(k => k !== 'ASSETS').sort(); out.turnstileHalf = !!env.TURNSTILE_SITE_KEY !== !!env.TURNSTILE_SECRET;
    out.mail = mailOn(env); out.inbound = inboundOn(env); out.site = siteUrl(env);
    if (out.ready) {
      try {
        const r = await fetch(sbBase(env) + '/rest/v1/rpc/get_plan', { method: 'POST', headers: { 'apikey': env.SUPABASE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ p_key: inqKey(env), p_token: 'check' }) });
        if (r.status === 404) out.db = 'missing_sql';
        else if (!r.ok) out.db = 'error ' + r.status;
        else { const j = await r.json(); out.db = j && j.error === 'key' ? 'key_mismatch' : 'ok'; }
      } catch (e) { out.db = 'unreachable'; }
      if (out.db !== 'ok') out.ready = false;
    }
  }
  return json(out, 200, c.headers);
}

async function verifyTurnstile(env, req, token) {
  if (!turnstileOn(env)) return true;
  try {
    const f = new FormData(); f.append('secret', env.TURNSTILE_SECRET); f.append('response', String(token || ''));
    const ip = req.headers.get('cf-connecting-ip'); if (ip) f.append('remoteip', ip);
    const v = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f })).json();
    return !!(v && v.success);
  } catch (e) { return false; }
}
function eventRow(a) {
  const loc = a['ev.room'] === 'Other' ? String(a['ev.roomAddr'] || 'Off-site') : String(a['ev.room'] || '');
  return {
    name: String(a['ev.contact'] || '').trim(), email: String(a['ev.email'] || '').trim(), phone: String(a['ev.phone'] || ''),
    organization: String(a['ev.client'] || ''), event_name: String(a['ev.name'] || ''), event_type: String(a['ev.type'] || ''),
    event_date: String(a['ev.date'] || ''), start_time: String(a['ev.start'] || ''), end_time: String(a['ev.end'] || ''),
    guests: String(parseInt(a['ev.expected'], 10) || ''), location: loc, guest_notes: String(a.notes || '')
  };
}
function checkBasics(row) {
  const today = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 3 * 366 * 86400 * 1000).toISOString().slice(0, 10);
  const g = parseInt(row.guests, 10), fix = [];
  if (row.name.length < 2 || row.name.length > 120) fix.push('your name');
  if (!EMAIL_RE.test(row.email) || row.email.length > 200) fix.push('a valid email address');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.event_date) || row.event_date < today || row.event_date > later) fix.push('an event date between today and three years from now');
  if (!(g >= 1 && g <= 3000)) fix.push('the expected number of guests');
  return fix;
}

/* Step 1: the short inquiry form (about you + your event) */
async function inquiry(req, env) {
  const c = siteCors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  if (!c.ok) return json({ error: 'origin' }, 403, c.headers);
  if (!inqKey(env) || !env.SUPABASE_URL) return json({ error: 'not_ready' }, 503, c.headers);
  let b;
  try { const t = await req.text(); if (t.length > 100000) return json({ error: 'too_big' }, 413, c.headers); b = JSON.parse(t); } catch (e) { return json({ error: 'bad' }, 400, c.headers); }
  const a = (b && typeof b.answers === 'object' && b.answers) || {};
  const row = eventRow(a), fix = checkBasics(row);
  if (fix.length) return json({ error: 'fix', message: 'Please add ' + fix.join(', ') + '.' }, 400, c.headers);
  // likely-bot signs: kept, but filed under Spam so a person can still rescue one
  const flags = [];
  // A guest is never turned away because the "are you a person" check couldn't run on their device
  // (blocked by a browser extension, a work network, or the site's address missing from the Turnstile widget):
  // the inquiry is kept under Spam and the team is still emailed about it.
  const verified = await verifyTurnstile(env, req, b.token);
  if (!verified) {
    flags.push('unverified');
    const code = String(b.tsErr || '').replace(/[^\w-]/g, '').slice(0, 20);
    if (code && code !== 'none') flags.push('check-error-' + code);
  }
  if (String(b.hp || '').trim()) flags.push('trap-field');
  if (!(Number(b.elapsed) >= MIN_MS)) flags.push('too-fast');
  const words = [row.name, a.notes, a['ev.name'], a['ev.client']].join(' ');
  if ((words.match(/https?:\/\/|www\./gi) || []).length > 2) flags.push('links');
  if (/[Ѐ-ӿ一-鿿]{6,}/.test(words) && !/[a-z]{3}/i.test(row.name)) flags.push('script');
  const spam = flags.length > 0;
  Object.assign(row, { answers: a, flags, summary: [], beo: {} });
  let res;
  try { res = await rpc(env, 'submit_inquiry', { p_key: inqKey(env), p_ip: await ipKey(req), p_row: row, p_unconfirmed: false, p_spam: spam }); }
  catch (e) { return json({ error: 'server', message: 'Something went wrong on our side.' }, 502, c.headers); }
  if (res && res.error === 'rate') return json({ error: 'rate', message: 'We’ve already received a few inquiries from you recently. Please email events@edencny.com if you need to add something.' }, 429, c.headers);
  if (!res || res.error || !res.id) return json({ error: 'server', message: 'Something went wrong on our side.' }, 502, c.headers);
  const onlyCheck = flags.every(f => f === 'unverified' || f.indexOf('check-error-') === 0);
  if (!spam || onlyCheck) await notifyStaff(env, req, Object.assign({}, row, { guests: parseInt(row.guests, 10), held: spam }), 'inquiry');
  return json({ ok: true }, 200, c.headers);
}

/* Step 2: the guest's private link to the full questionnaire (#plan-<code> on the website) */
async function plan(req, env) {
  const c = siteCors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
  if (!c.ok) return json({ error: 'origin' }, 403, c.headers);
  if (!inqKey(env) || !env.SUPABASE_URL) return json({ error: 'not_ready' }, 503, c.headers);
  if (req.method === 'GET') {
    const t = new URL(req.url).searchParams.get('t') || '';
    if (!/^[a-f0-9]{64}$/.test(t)) return json({ error: 'not_found' }, 404, c.headers);
    let r; try { r = await rpc(env, 'get_plan', { p_key: inqKey(env), p_token: t }); } catch (e) { return json({ error: 'server' }, 502, c.headers); }
    if (!r || r.error) return json({ error: (r && r.error) || 'server' }, r && r.error === 'not_found' ? 404 : 502, c.headers);
    return json({ ok: true, answers: r.answers || {}, done: !!r.done, locked: !!r.locked }, 200, c.headers);
  }
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  let b;
  try { const t = await req.text(); if (t.length > 200000) return json({ error: 'too_big' }, 413, c.headers); b = JSON.parse(t); } catch (e) { return json({ error: 'bad' }, 400, c.headers); }
  const t = String(b.t || '');
  if (!/^[a-f0-9]{64}$/.test(t)) return json({ error: 'not_found' }, 404, c.headers);
  const a = (b && typeof b.answers === 'object' && b.answers) || {};
  const row = eventRow(a), fix = checkBasics(row);
  if (fix.length) return json({ error: 'fix', message: 'Please add ' + fix.join(', ') + '.' }, 400, c.headers);
  Object.assign(row, {
    answers: a, beo: (b.beo && typeof b.beo === 'object') ? b.beo : {}, summary: Array.isArray(b.summary) ? b.summary.slice(0, 20) : [],
    estimate: b.estimate != null && isFinite(+b.estimate) ? String(Math.max(0, Math.round(Number(b.estimate) * 100) / 100)) : ''
  });
  let r; try { r = await rpc(env, 'submit_plan', { p_key: inqKey(env), p_token: t, p_row: row }); } catch (e) { return json({ error: 'server', message: 'Something went wrong on our side.' }, 502, c.headers); }
  if (r && r.error === 'locked') return json({ error: 'locked', message: 'Your event details are already with our team. Please reply to our email or write to events@edencny.com to make changes.' }, 409, c.headers);
  if (!r || r.error) return json({ error: (r && r.error) || 'server', message: 'We couldn’t find your questionnaire. Please use the link in our email, or write to events@edencny.com.' }, r && r.error === 'not_found' ? 404 : 502, c.headers);
  await notifyStaff(env, req, r, 'plan');
  return json({ ok: true, again: !!r.again }, 200, c.headers);
}

/* Staff send an email to a guest from Catering & BEOs (signed-in Owner or manager only) */
async function adminSend(req, env) {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  if (origin && origin !== new URL(req.url).origin) return json({ error: 'origin' }, 403);
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt || !env.SUPABASE_URL) return json({ error: 'auth' }, 401);
  if (!mailOn(env)) return json({ error: 'mail_off', message: 'Email sending isn’t set up yet.' }, 503);
  let b; try { b = await req.json(); } catch (e) { return json({ error: 'bad' }, 400); }
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad' }, 400);
  let q;
  try { q = (await asUser(env, jwt, 'GET', 'catering_inquiries?id=eq.' + id + '&select=id,name,email,status,plan_token'))[0]; } catch (e) { return json({ error: 'auth' }, 403); }
  if (!q) return json({ error: 'auth', message: 'You don’t have access to this inquiry.' }, 403);   // the database only shows inquiries to the Owner and managers
  if (!EMAIL_RE.test(q.email || '')) return json({ error: 'no_email', message: 'This inquiry has no valid email address.' }, 400);
  const subject = String(b.subject || '').trim().slice(0, 200) || 'Your event at Eden';
  let text = String(b.body || '').slice(0, 20000);
  let link = '';
  if (b.plan) {
    let tok = q.plan_token;
    if (!tok) { try { tok = await rpc(env, 'create_plan_link', { p_id: id }, jwt); } catch (e) { return json({ error: 'server', message: 'Couldn’t make the questionnaire link.' }, 502); } }
    link = siteUrl(env) + '#plan-' + tok;
    text = text.indexOf('{link}') !== -1 ? text.split('{link}').join(link) : text + '\n\n' + link;
  }
  let msg;
  try {
    msg = (await asUser(env, jwt, 'POST', 'inquiry_messages', { inquiry_id: id, kind: 'out', to_addr: q.email, from_addr: env.MAIL_FROM, subject, body: text, by_name: String(b.by_name || '').slice(0, 80), mail_status: 'sending' }))[0];
  } catch (e) { return json({ error: 'auth' }, 403); }
  const parts = text.split(link || '\u0000');
  const html = mailShell('', link ? parts.map(textToHtml).join(button(link, 'Plan your event')) : textToHtml(text));
  const sent = await sendMail(env, { to: [q.email], subject, html, text, reply_to: replyAddr(env, id) || staffTo(env)[0] || undefined });
  try { await asUser(env, jwt, 'PATCH', 'inquiry_messages?id=eq.' + msg.id, { mail_status: sent.ok ? 'sent' : 'failed', email_id: sent.id || '' }); } catch (e) {}
  if (!sent.ok) return json({ error: 'send_failed', message: 'The email couldn’t be sent: ' + sent.error }, 502);
  if (b.plan && q.status === 'new') { try { await asUser(env, jwt, 'PATCH', 'catering_inquiries?id=eq.' + id, { status: 'link_sent', plan_sent_at: new Date().toISOString() }); } catch (e) {} }
  else if (b.plan) { try { await asUser(env, jwt, 'PATCH', 'catering_inquiries?id=eq.' + id, { plan_sent_at: new Date().toISOString() }); } catch (e) {} }
  return json({ ok: true, link });
}

/* End of day report: email the night's tips. Each tip-pool server gets their share; the Owner gets everyone's.
   The pool is split by hours, in whole cents (largest remainders get the odd cents) so shares add up exactly. */
function splitCents(total, staff) {
  const cents = Math.round(Number(total || 0) * 100), hrs = staff.reduce((a, p) => a + p.hours, 0);
  if (!cents || !hrs) return staff.map(() => 0);
  const parts = staff.map((p, i) => { const exact = cents * p.hours / hrs; return { i, base: Math.floor(exact), rem: exact - Math.floor(exact) }; });
  let left = cents - parts.reduce((a, p) => a + p.base, 0);
  parts.slice().sort((a, b) => b.rem - a.rem).forEach(p => { if (left > 0) { p.base++; left--; } });
  return parts.map(p => p.base / 100);
}
function hrsText(h) { const n = Math.round(Number(h) * 100) / 100; return n + (n === 1 ? ' hour' : ' hours'); }
function tipShares(d) {
  const staff = (d.staff || []).map(p => ({ name: String(p.name || 'Team member'), email: String(p.email || '').trim(), hours: Math.max(0, Number(p.hours) || 0) })).filter(p => p.hours > 0);
  const cash = splitCents(d.tips_cash, staff), card = splitCents(d.tips_card, staff);
  staff.forEach((p, i) => { p.cash = cash[i]; p.card = card[i]; p.total = Math.round((cash[i] + card[i]) * 100) / 100; });
  const hours = Math.round(staff.reduce((a, p) => a + p.hours, 0) * 100) / 100;
  return { staff, hours, cash: Number(d.tips_cash) || 0, card: Number(d.tips_card) || 0,
    cashRate: hours ? Number(d.tips_cash || 0) / hours : 0, cardRate: hours ? Number(d.tips_card || 0) / hours : 0 };
}
function tipRow(label, value, strong) { return '<tr><td style="padding:7px 0;border-bottom:1px solid #eee8dd' + (strong ? ';font-weight:bold' : '') + '">' + esc(label) + '</td><td style="padding:7px 0;border-bottom:1px solid #eee8dd;text-align:right' + (strong ? ';font-weight:bold' : '') + '">' + esc(value) + '</td></tr>'; }
function poolLines(T) {
  return '<p style="margin:16px 0 6px;font-size:13px;color:#7f7a71">The night’s tip pool</p><table style="width:100%;border-collapse:collapse;font-size:14px">' +
    tipRow('Cash tips', money(T.cash)) + tipRow('Credit card tips', money(T.card)) + tipRow('Hours worked by the tip pool', hrsText(T.hours)) +
    tipRow('Cash per hour', money(T.cashRate)) + tipRow('Credit card per hour', money(T.cardRate)) + '</table>';
}
async function adminTips(req, env) {
  const origin = req.headers.get('origin');
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  if (origin && origin !== new URL(req.url).origin) return json({ error: 'origin' }, 403);
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt || !env.SUPABASE_URL) return json({ error: 'auth' }, 401);
  if (!mailOn(env)) return json({ error: 'mail_off', message: 'Email sending isn’t set up yet, so the tip emails weren’t sent.' }, 503);
  let b; try { b = await req.json(); } catch (e) { return json({ error: 'bad' }, 400); }
  const id = String(b.id || '');
  if (!/^[0-9a-f-]{36}$/.test(id)) return json({ error: 'bad' }, 400);
  let d;
  try { d = await rpc(env, 'eod_tip_mail', { p_id: id }, jwt); } catch (e) { return json({ error: 'server', message: 'Couldn’t read the report. Has supabase/eod-tips.sql been run?' }, 502); }
  if (!d || d.error) return json({ error: (d && d.error) || 'server', message: d && d.error === 'denied' ? 'Only the Owner and managers can send tips.' : 'Report not found.' }, d && d.error === 'denied' ? 403 : 404);
  const T = tipShares(d);
  if (!T.staff.length || !(T.cash || T.card)) return json({ error: 'empty', message: 'Enter the tips and the hours worked first.' }, 400);
  const day = longDate(d.report_date), from = env.TIPS_FROM || env.MAIL_FROM, copyTo = String(env.TIPS_COPY_TO || '').split(',').map(x => x.trim()).filter(x => EMAIL_RE.test(x));
  const replyTo = copyTo[0] || staffTo(env)[0] || undefined;
  const log = [];
  for (const p of T.staff) {
    if (!EMAIL_RE.test(p.email)) { log.push({ name: p.name, email: '', ok: false, error: 'No email on file' }); continue; }
    const first = p.name.split(/\s+/)[0];
    const html = mailShell('Your tips for ' + day,
      '<p style="margin:0 0 12px">Hi ' + esc(first) + ',</p><p style="margin:0 0 12px">Here are your tips from the tip pool for ' + esc(day) + '.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:15px">' + tipRow('Hours worked', hrsText(p.hours)) + tipRow('Cash tips', money(p.cash)) + tipRow('Credit card tips', money(p.card)) + tipRow('Total', money(p.total), true) + '</table>' +
      poolLines(T) + '<p style="margin:16px 0 0;font-size:13px;color:#7f7a71">Tips are pooled and split by hours worked. Questions? Just reply to this email.</p>');
    const text = 'Hi ' + first + ',\n\nYour tips from the tip pool for ' + day + ':\n\nHours worked: ' + hrsText(p.hours) + '\nCash tips: ' + money(p.cash) + '\nCredit card tips: ' + money(p.card) + '\nTotal: ' + money(p.total) +
      '\n\nThe night’s pool: ' + money(T.cash) + ' cash and ' + money(T.card) + ' credit card over ' + hrsText(T.hours) + ' (' + money(T.cashRate) + ' cash and ' + money(T.cardRate) + ' card per hour).\n\nTips are pooled and split by hours worked. Questions? Just reply to this email.\n\nEden';
    const sent = await sendMail(env, { from, to: [p.email], subject: 'Your tips for ' + day, html, text, reply_to: replyTo });
    log.push({ name: p.name, email: p.email, ok: sent.ok, error: sent.ok ? '' : sent.error });
  }
  // the Owner's copy: everyone's shares on one page
  let copyOk = !copyTo.length;
  if (copyTo.length) {
    const rows = T.staff.map((p, i) => '<tr><td style="padding:7px 6px 7px 0;border-bottom:1px solid #eee8dd">' + esc(p.name) + (log[i] && !log[i].ok ? '<br><span style="font-size:12px;color:#a3392b">Not emailed: ' + esc(log[i].error) + '</span>' : '') + '</td>' +
      [hrsText(p.hours).replace(/ hours?$/, ''), money(p.cash), money(p.card), money(p.total)].map(v => '<td style="padding:7px 0 7px 8px;border-bottom:1px solid #eee8dd;text-align:right">' + esc(v) + '</td>').join('') + '</tr>').join('');
    const tot = '<tr>' + ['Total', String(T.hours), money(T.cash), money(T.card), money(Math.round((T.cash + T.card) * 100) / 100)].map((v, i) => '<td style="padding:8px 0 8px ' + (i ? '8px' : '0') + ';font-weight:bold;' + (i ? 'text-align:right' : '') + '">' + esc(v) + '</td>').join('') + '</tr>';
    const html = mailShell('Tips for ' + day,
      '<p style="margin:0 0 12px">Copy of the tip emails sent from the end of day report' + (d.prepared_by ? ' prepared by ' + esc(d.prepared_by) : '') + '.</p>' +
      '<table style="width:100%;border-collapse:collapse;font-size:14px"><tr>' + ['Name', 'Hours', 'Cash', 'Card', 'Total'].map((t, i) => '<th style="text-align:' + (i ? 'right' : 'left') + ';font-size:12px;color:#7f7a71;padding:0 0 6px ' + (i ? '8px' : '0') + ';border-bottom:1px solid #d9d3c8">' + t + '</th>').join('') + '</tr>' + rows + tot + '</table>' +
      poolLines(T));
    const text = 'Tips for ' + day + '\n\n' + T.staff.map((p, i) => p.name + ': ' + hrsText(p.hours) + ', cash ' + money(p.cash) + ', card ' + money(p.card) + ', total ' + money(p.total) + (log[i] && !log[i].ok ? ' (not emailed: ' + log[i].error + ')' : '')).join('\n') +
      '\n\nPool: ' + money(T.cash) + ' cash, ' + money(T.card) + ' credit card, ' + hrsText(T.hours) + '.';
    const c = await sendMail(env, { from, to: copyTo, subject: 'Tips for ' + day + ' (copy)', html, text });
    copyOk = c.ok;
  }
  const at = new Date().toISOString();
  try { await asUser(env, jwt, 'PATCH', 'eod_reports?id=eq.' + id, { tips_sent_at: at, tips_sent: log.concat([{ name: 'Owner’s copy', email: copyTo.join(', '), ok: copyOk, error: copyOk ? '' : 'Not sent' }]) }); } catch (e) {}
  return json({ ok: true, at, sent: log, copy: copyOk });
}

/* A guest's reply arrives (Resend "email.received" webhook). Signed by Resend; anything unsigned is refused. */
function b64ToBytes(s) { const bin = atob(s); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
async function verifySvix(env, req, raw) {
  const id = req.headers.get('svix-id'), ts = req.headers.get('svix-timestamp'), sig = req.headers.get('svix-signature') || '';
  if (!id || !ts || !sig || !env.RESEND_WEBHOOK_SECRET) return false;
  if (Math.abs(Date.now() / 1000 - Number(ts)) > 300) return false;
  const secret = String(env.RESEND_WEBHOOK_SECRET).trim().replace(/^whsec_/, '');
  const key = await crypto.subtle.importKey('raw', b64ToBytes(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(id + '.' + ts + '.' + raw)));
  let expected = ''; mac.forEach(b => { expected += String.fromCharCode(b); }); expected = btoa(expected);
  return sig.split(' ').some(p => p.split(',')[1] === expected);
}
function stripQuoted(t) {   // keep what the guest wrote, not the quoted email underneath
  let s = String(t || '').replace(/\r\n/g, '\n');
  const cut = [/\n\s*On .{3,200}wrote:\s*\n/i, /\n-{2,}\s*Original Message\s*-{2,}/i, /\n\s*From: .+\n\s*Sent: /i, /\n_{8,}\n/];
  cut.forEach(re => { const m = re.exec(s); if (m) s = s.slice(0, m.index); });
  return s.split('\n').filter(l => !/^\s*>/.test(l)).join('\n').trim();
}
async function inbound(req, env) {
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  const raw = await req.text();
  if (!(await verifySvix(env, req, raw))) return json({ error: 'signature' }, 401);
  let evt; try { evt = JSON.parse(raw); } catch (e) { return json({ error: 'bad' }, 400); }
  // results of promotional emails (delivered, opened, clicked, bounced, complained) come in on the same webhook
  if (evt && /^email\.(delivered|opened|clicked|bounced|complained)$/.test(evt.type || '')) { try { return json(await promoEvent(env, inqKey(env), evt)); } catch (e) { return json({ error: 'server' }, 500); } }
  if (!evt || evt.type !== 'email.received' || !evt.data) return json({ ok: true, ignored: true });
  const d = evt.data, emailId = String(d.email_id || d.id || '');
  const toList = [].concat(d.to || []).map(String);
  const ref = (toList.join(' ').match(/i-([a-f0-9]{32})@/i) || [])[1] || '';
  let text = '';
  try {
    const r = await fetch('https://api.resend.com/emails/receiving/' + encodeURIComponent(emailId), { headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY } });
    const full = await r.json();
    text = full.text || String(full.html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/p>/gi, '\n\n').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>');
  } catch (e) { text = ''; }
  const body = stripQuoted(text) || text || '(The email had no text.)';
  let r;
  try { r = await rpc(env, 'inbound_message', { p_key: inqKey(env), p_ref: ref, p_from: String(d.from || ''), p_to: toList.join(', '), p_subject: String(d.subject || ''), p_body: body, p_email_id: emailId }); }
  catch (e) { return json({ error: 'server' }, 500); }   // the email service tries again later
  if (r && r.id && !r.duplicate) await notifyStaff(env, req, r, 'reply', { subject: String(d.subject || ''), body });
  return json({ ok: true, matched: !!(r && r.id) });
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/here') return json({ app: 'eden-staff' }, 200, { 'Access-Control-Allow-Origin': '*' });   // js/move.js checks the new address
    if (url.pathname === '/t') return track(req, env);
    if (url.pathname === '/inquiry/config') return inquiryConfig(req, env);
    if (url.pathname === '/inquiry') return inquiry(req, env);
    if (url.pathname === '/plan') return plan(req, env);
    if (url.pathname === '/admin/send') return adminSend(req, env);
    if (url.pathname === '/admin/tips') return adminTips(req, env);
    if (url.pathname === '/inbound') return inbound(req, env);
    if (url.pathname === '/preshift/refresh') return preshiftRoute(req, env, inqKey(env));
    if (url.pathname.indexOf('/mail/') === 0) { const r = await mailRoute(req, env, url.pathname); if (r) return r; }
    if (url.pathname.indexOf('/promo/') === 0) { const r = await promoRoute(req, env, url.pathname, inqKey(env)); if (r) return r; }
    return env.ASSETS.fetch(req);
  },
  // wrangler.jsonc "triggers" (every 5 minutes)
  async scheduled(evt, env, ctx) {
    // every 5 minutes: promotional emails that are due
    ctx.waitUntil(promoRun(env, inqKey(env)).catch(() => null));
    // every 20 minutes (on the hour, :20 and :40): Pre-shift and the Prep List
    const min = new Date(evt && evt.scheduledTime ? evt.scheduledTime : Date.now()).getUTCMinutes();
    if (min % 20 >= 5) return;
    ctx.waitUntil(preshiftRefresh(env, inqKey(env), false).catch(() => null));
    // Prep List: the 8:00 pm reset for the next day (New York time), if nobody did it
    if (inqKey(env) && env.SUPABASE_URL) ctx.waitUntil(rpc(env, 'prep_auto_server', { p_key: inqKey(env) }).catch(() => null));
  }
};
