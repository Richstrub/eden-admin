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
 *   /inbound          Guests' email replies, delivered by Resend, saved into the inquiry's conversation.
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
  const admin = new URL(req.url).origin + '/#catering';
  const who = q.name || 'A guest';
  const T = {
    inquiry: ['New catering inquiry: ' + who, 'New catering inquiry', esc(who) + ' sent an inquiry from the website.'],
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
  if (!(await verifyTurnstile(env, req, b.token))) return json({ error: 'verify', message: 'We couldn’t confirm you’re a person. Please try again.' }, 400, c.headers);
  const row = eventRow(a), fix = checkBasics(row);
  if (fix.length) return json({ error: 'fix', message: 'Please add ' + fix.join(', ') + '.' }, 400, c.headers);
  // likely-bot signs: kept, but filed under Spam so a person can still rescue one
  const flags = [];
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
  if (!spam) await notifyStaff(env, req, Object.assign({}, row, { guests: parseInt(row.guests, 10) }), 'inquiry');
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
    if (url.pathname === '/t') return track(req, env);
    if (url.pathname === '/inquiry/config') return inquiryConfig(req, env);
    if (url.pathname === '/inquiry') return inquiry(req, env);
    if (url.pathname === '/plan') return plan(req, env);
    if (url.pathname === '/admin/send') return adminSend(req, env);
    if (url.pathname === '/inbound') return inbound(req, env);
    return env.ASSETS.fetch(req);
  }
};
