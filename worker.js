/* Eden staff site: web worker.
 *
 * Serves the staff site's files exactly as before, plus a few small addresses the public website uses:
 *
 *   /t                Counts one page view for Analytics > Website traffic: the page, roughly where the visitor
 *                     is (Cloudflare works out country, state and city; no IP address is stored), how they found
 *                     the site, and the kind of device. A visitor is an anonymous code that changes every day.
 *   /inquiry/config   Tells the catering questionnaire whether online sending is switched on.
 *   /inquiry          Receives a catering questionnaire. Bots are screened out first: Cloudflare Turnstile,
 *                     a hidden trap field, a too-fast check, a per-connection limit and sanity checks. When
 *                     email sending is set up, the guest gets a "confirm your email" link and the inquiry only
 *                     reaches Catering & BEOs once they click it.
 *   /confirm          The guest clicked that link (it opens edencny.com, which calls this).
 *
 * Settings (Cloudflare > Workers > eden-admin > Settings > Variables and Secrets). Nothing secret is in this file:
 *   INQUIRY_KEY         secret: from  select public.new_inquiry_key();  in Supabase. Without it the questionnaire
 *                       keeps using the old "save a file and email it" method.
 *   TURNSTILE_SITE_KEY  and TURNSTILE_SECRET: from Cloudflare > Turnstile. Both needed to switch Turnstile on.
 *   RESEND_API_KEY      secret: from resend.com, to send the confirm emails and the "new inquiry" notices.
 *   SUPABASE_URL, SUPABASE_KEY (public key), MAIL_FROM, NOTIFY_TO, SITE_URL: plain settings in wrangler.jsonc.
 */
const SITE_HOSTS = /(^|\.)edencny\.com$|^eden-website\.richard-a-strub\.workers\.dev$|^richstrub\.github\.io$/i;
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
const MIN_MS = 30 * 1000;   // nobody fills in the questionnaire in under 30 seconds
const EMAIL_RE = /^[^\s@<>()]+@[^\s@<>()]+\.[a-z]{2,}$/i;
function siteCors(req) {
  const origin = req.headers.get('origin') || '';
  const ok = SITE_HOSTS.test(hostOf(origin));
  return { ok, headers: { 'Access-Control-Allow-Origin': ok ? origin : 'null', 'Access-Control-Allow-Methods': 'GET, POST, OPTIONS', 'Access-Control-Allow-Headers': 'content-type', 'Access-Control-Max-Age': '86400', 'Vary': 'Origin', 'Cache-Control': 'no-store' } };
}
function json(obj, status, headers) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ 'content-type': 'application/json' }, headers || {}) }); }
function esc(x) { return String(x == null ? '' : x).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function turnstileOn(env) { return !!(env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET); }
function mailOn(env) { return !!(env.RESEND_API_KEY && env.MAIL_FROM); }
function siteUrl(env) { return String(env.SITE_URL || 'https://edencny.com/').replace(/\/?$/, '/'); }
async function ipKey(req) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('eden-inquiry|' + (req.headers.get('cf-connecting-ip') || '')));
  return [...new Uint8Array(buf)].slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}
async function rpc(env, name, args) {
  const r = await fetch(env.SUPABASE_URL.replace(/\/$/, '') + '/rest/v1/rpc/' + name, {
    method: 'POST', headers: { 'apikey': env.SUPABASE_KEY, 'content-type': 'application/json' }, body: JSON.stringify(args)
  });
  if (!r.ok) throw new Error('rpc ' + name + ' ' + r.status);
  return r.json();
}
async function sendMail(env, msg) {
  try {
    const r = await fetch('https://api.resend.com/emails', {
      method: 'POST', headers: { 'Authorization': 'Bearer ' + env.RESEND_API_KEY, 'content-type': 'application/json' },
      body: JSON.stringify(Object.assign({ from: env.MAIL_FROM }, msg))
    });
    return r.ok;
  } catch (e) { return false; }
}
function longDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d || ''); if (!m) return '';
  return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}
function money(n) { return n == null || n === '' ? '' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
function mailShell(title, inner) {
  return '<!doctype html><html><body style="margin:0;background:#f7f4ee;font-family:Georgia,serif;color:#0f1215">' +
    '<div style="max-width:560px;margin:0 auto;padding:32px 24px"><div style="font-size:26px;letter-spacing:.3em;text-align:center;margin-bottom:24px">EDEN</div>' +
    '<div style="background:#fff;border:1px solid #e3ddd2;padding:28px 26px;font-family:Arial,sans-serif;font-size:15px;line-height:1.6;color:#24282c">' +
    '<h1 style="font-family:Georgia,serif;font-weight:normal;font-size:22px;margin:0 0 14px;color:#0f1215">' + esc(title) + '</h1>' + inner + '</div>' +
    '<p style="font-family:Arial,sans-serif;font-size:12px;color:#7f7a71;text-align:center;margin-top:18px">Eden · 118 E. Genesee St., Syracuse, NY · edencny.com</p></div></body></html>';
}
function detailRows(q) {
  const rows = [['Event', q.event_name], ['Date', longDate(q.event_date)], ['Guests', q.guests], ['Where', q.location], ['Estimate', money(q.estimate)]].filter(r => r[1]);
  return '<table style="border-collapse:collapse;margin:14px 0;font-size:14px">' + rows.map(r => '<tr><td style="padding:3px 16px 3px 0;color:#7f7a71">' + esc(r[0]) + '</td><td style="padding:3px 0">' + esc(r[1]) + '</td></tr>').join('') + '</table>';
}
async function notifyStaff(env, req, q) {
  const to = String(env.NOTIFY_TO || '').split(',').map(x => x.trim()).filter(Boolean);
  if (!mailOn(env) || !to.length) return false;
  const admin = new URL(req.url).origin + '/#catering';
  const who = q.name || 'A guest';
  return sendMail(env, {
    to, reply_to: q.email || undefined,
    subject: 'New catering inquiry: ' + who + (q.event_date ? ' · ' + longDate(q.event_date) : ''),
    html: mailShell('New catering inquiry', '<p>' + esc(who) + (q.email ? ' (' + esc(q.email) + (q.phone ? ', ' + esc(q.phone) : '') + ')' : '') + ' sent the catering questionnaire.</p>' + detailRows(q) +
      '<p><a href="' + esc(admin) + '" style="display:inline-block;background:#b0703f;color:#fff;text-decoration:none;padding:11px 20px;letter-spacing:.12em;text-transform:uppercase;font-size:12px">Open in Catering &amp; BEOs</a></p>' +
      '<p style="font-size:13px;color:#7f7a71">Reply to this email to write to the guest.</p>'),
    text: 'New catering inquiry from ' + who + '\n' + [q.event_name, longDate(q.event_date), q.guests ? q.guests + ' guests' : '', money(q.estimate)].filter(Boolean).join(' · ') + '\n\nOpen it: ' + admin
  });
}

async function inquiryConfig(req, env) {
  const c = siteCors(req);
  return json({ ready: !!(env.INQUIRY_KEY && env.SUPABASE_URL), turnstile: turnstileOn(env) ? env.TURNSTILE_SITE_KEY : '', confirm: mailOn(env) }, 200, c.headers);
}

async function inquiry(req, env) {
  const c = siteCors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  if (!c.ok) return json({ error: 'origin' }, 403, c.headers);
  if (!env.INQUIRY_KEY || !env.SUPABASE_URL) return json({ error: 'not_ready' }, 503, c.headers);
  let b;
  try { const t = await req.text(); if (t.length > 200000) return json({ error: 'too_big' }, 413, c.headers); b = JSON.parse(t); } catch (e) { return json({ error: 'bad' }, 400, c.headers); }
  const a = (b && typeof b.answers === 'object' && b.answers) || {};
  const ip = req.headers.get('cf-connecting-ip') || '';

  // 1. Cloudflare Turnstile (when switched on)
  if (turnstileOn(env)) {
    let pass = false;
    try {
      const f = new FormData(); f.append('secret', env.TURNSTILE_SECRET); f.append('response', String(b.token || '')); if (ip) f.append('remoteip', ip);
      const v = await (await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: f })).json();
      pass = !!(v && v.success);
    } catch (e) { pass = false; }
    if (!pass) return json({ error: 'verify', message: 'We couldn’t confirm you’re a person. Please try again.' }, 400, c.headers);
  }

  // 2. sanity checks (a real guest is told what to fix)
  const name = String(a['ev.contact'] || '').trim(), email = String(a['ev.email'] || '').trim(), date = String(a['ev.date'] || '');
  const guests = parseInt(a['ev.expected'], 10);
  const today = new Date(Date.now() - 5 * 3600 * 1000).toISOString().slice(0, 10);
  const later = new Date(Date.now() + 3 * 366 * 86400 * 1000).toISOString().slice(0, 10);
  const fix = [];
  if (name.length < 2 || name.length > 120) fix.push('your name');
  if (!EMAIL_RE.test(email) || email.length > 200) fix.push('a valid email address');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < today || date > later) fix.push('an event date between today and three years from now');
  if (!(guests >= 1 && guests <= 3000)) fix.push('the expected number of guests');
  if (b.ack !== true) fix.push('the checkbox above the Send button');
  if (fix.length) return json({ error: 'fix', message: 'Please add ' + fix.join(', ') + '.' }, 400, c.headers);

  // 3. likely-bot signs: kept, but filed under Spam so a person can still rescue one
  const flags = [];
  if (String(b.hp || '').trim()) flags.push('trap-field');
  if (!(Number(b.elapsed) >= MIN_MS)) flags.push('too-fast');
  const words = [name, a.notes, a['ev.name'], a['ev.client']].join(' ');
  if ((words.match(/https?:\/\/|www\./gi) || []).length > 2) flags.push('links');
  if (/[Ѐ-ӿ一-鿿]{6,}/.test(words) && !/[a-z]{3}/i.test(name)) flags.push('script');
  const spam = flags.length > 0;

  const loc = a['ev.room'] === 'Other' ? String(a['ev.roomAddr'] || 'Off-site') : String(a['ev.room'] || '');
  const row = {
    name, email, phone: String(a['ev.phone'] || ''), organization: String(a['ev.client'] || ''), event_name: String(a['ev.name'] || ''),
    event_type: String(a['ev.type'] || ''), event_date: date, start_time: String(a['ev.start'] || ''), end_time: String(a['ev.end'] || ''),
    guests: String(guests), location: loc, estimate: b.estimate != null ? String(Math.max(0, Math.round(Number(b.estimate) * 100) / 100) || 0) : '',
    summary: Array.isArray(b.summary) ? b.summary.slice(0, 20) : [], beo: (b.beo && typeof b.beo === 'object') ? b.beo : {}, answers: a,
    guest_notes: String(a.notes || ''), flags
  };
  const confirmByEmail = mailOn(env) && !spam;
  let res;
  try { res = await rpc(env, 'submit_inquiry', { p_key: env.INQUIRY_KEY, p_ip: await ipKey(req), p_row: row, p_unconfirmed: confirmByEmail, p_spam: spam }); }
  catch (e) { return json({ error: 'server', message: 'Something went wrong on our side.' }, 502, c.headers); }
  if (res && res.error === 'rate') return json({ error: 'rate', message: 'We’ve already received a few questionnaires from you recently. Please email events@edencny.com if you need to add something.' }, 429, c.headers);
  if (!res || res.error || !res.token) return json({ error: 'server', message: 'Something went wrong on our side.' }, 502, c.headers);
  if (spam) return json({ ok: true, confirm: false }, 200, c.headers);   // looks like a bot: filed under Spam, nothing sent

  if (confirmByEmail) {
    const link = siteUrl(env) + '#confirm-' + res.token;
    const sent = await sendMail(env, {
      to: [email], reply_to: String(env.NOTIFY_TO || '').split(',')[0].trim() || undefined,
      subject: 'Please confirm your event inquiry with Eden',
      html: mailShell('Confirm your event inquiry', '<p>Hi ' + esc(name.split(' ')[0]) + ',</p><p>Thank you for planning your event with Eden. Please confirm your email address so we can send it to our event team.</p>' +
        detailRows({ event_name: row.event_name, event_date: date, guests, location: loc, estimate: row.estimate }) +
        '<p><a href="' + esc(link) + '" style="display:inline-block;background:#b0703f;color:#fff;text-decoration:none;padding:12px 22px;letter-spacing:.12em;text-transform:uppercase;font-size:12px">Confirm my inquiry</a></p>' +
        '<p style="font-size:13px;color:#7f7a71">If you didn’t fill in our catering questionnaire, ignore this email and nothing will be sent.</p>'),
      text: 'Hi ' + name.split(' ')[0] + ',\n\nThank you for planning your event with Eden. Please confirm your email address so we can send your selections to our event team:\n\n' + link + '\n\nIf you didn’t fill in our catering questionnaire, ignore this email.'
    });
    if (sent) return json({ ok: true, confirm: true }, 200, c.headers);
    // the email couldn't go out: let it through, flagged, rather than lose it
    try { await rpc(env, 'confirm_inquiry', { p_key: env.INQUIRY_KEY, p_token: res.token, p_unverified: true }); } catch (e) {}
  }
  await notifyStaff(env, req, Object.assign({}, row, { guests }));
  return json({ ok: true, confirm: false }, 200, c.headers);
}

async function confirm(req, env) {
  const c = siteCors(req);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: c.headers });
  if (req.method !== 'POST') return new Response('Not found', { status: 404 });
  if (!c.ok) return json({ error: 'origin' }, 403, c.headers);
  if (!env.INQUIRY_KEY) return json({ error: 'not_ready' }, 503, c.headers);
  let t = '';
  try { t = String((await req.json()).t || ''); } catch (e) {}
  if (!/^[a-f0-9]{40,80}$/.test(t)) return json({ error: 'not_found' }, 400, c.headers);
  let r;
  try { r = await rpc(env, 'confirm_inquiry', { p_key: env.INQUIRY_KEY, p_token: t }); } catch (e) { return json({ error: 'server' }, 502, c.headers); }
  if (r && r.already) return json({ ok: true, already: true }, 200, c.headers);
  if (!r || r.error) return json({ error: (r && r.error) || 'server' }, r && r.error === 'not_found' ? 404 : 400, c.headers);
  await notifyStaff(env, req, r);
  return json({ ok: true, name: String(r.name || '').split(' ')[0] }, 200, c.headers);
}

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/t') return track(req, env);
    if (url.pathname === '/inquiry/config') return inquiryConfig(req, env);
    if (url.pathname === '/inquiry') return inquiry(req, env);
    if (url.pathname === '/confirm') return confirm(req, env);
    return env.ASSETS.fetch(req);
  }
};
