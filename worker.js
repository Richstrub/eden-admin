/* Eden staff site: web worker.
 *
 * Serves the staff site's files exactly as before, plus one small address, /t, that the public
 * website (edencny.com) calls once per page view. It records the visit for Analytics > Website
 * traffic: the page, roughly where the visitor is (Cloudflare works out the country, state and city
 * from the connection; no IP address is stored), how they found the site, and the kind of device.
 * A visitor is an anonymous code that changes every day, so nobody can be followed from day to day.
 *
 * The visit is saved with the public (publishable) Supabase key, set in wrangler.jsonc. The database
 * lets that key add visits but never read them; only the Owner can read them, from the staff site.
 * No secret keys are used or needed here.
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

export default {
  async fetch(req, env, ctx) {
    const url = new URL(req.url);
    if (url.pathname === '/t') return track(req, env);
    return env.ASSETS.fetch(req);
  }
};
