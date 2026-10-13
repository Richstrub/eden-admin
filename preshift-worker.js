/* Eden staff site: Pre-shift reservations from OpenTable (the worker's half).
 *
 * OpenTable emails the Owner's mailbox (OPENTABLE_MAILBOX, normally rich@edencny.com). Every 20 minutes, and
 * straight away when a manager opens Pre-shift, this looks in that mailbox's inbox for an OpenTable email that
 * arrived today, reads it (opentable-parse.js) and saves tonight's reservations for the Pre-shift page.
 * Each day starts empty: a pre-shift only fills in once that day's OpenTable email has arrived, and past days are
 * cleared after midnight. The database calls are checked with the private INQUIRY_KEY; no secret key is used.
 */
import { parseOpenTable } from './opentable-parse.js';
import { mailInternals } from './mail-worker.js';

const { gmailFor, gj, unsealToken, missing } = mailInternals;
const SEARCH = 'opentable in:inbox newer_than:3d';
const READER = 'v2';   // bump when opentable-parse.js changes, so today's email is read again with the new reader
const sbBase = env => String(env.SUPABASE_URL || '').replace(/\/$/, '');
function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); }
function etDate(d) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d); }
async function rpc(env, name, args, jwt) {
  const r = await fetch(sbBase(env) + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + (jwt || env.SUPABASE_KEY), 'content-type': 'application/json' }, body: JSON.stringify(args) });
  if (r.status === 404) throw Object.assign(new Error('missing_sql'), { code: 'missing_sql' });
  if (!r.ok) throw Object.assign(new Error('rpc ' + name + ' ' + r.status), { code: 'db' });
  return r.json();
}
function b64uText(data, charset) {
  const bin = atob(String(data || '').replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try { return new TextDecoder(charset || 'utf-8').decode(bytes); } catch (e) { return new TextDecoder('utf-8').decode(bytes); }
}
function bodies(payload) {
  const out = { html: '', text: '' };
  (function walk(p) {
    if (!p) return;
    if (p.parts && p.parts.length) { p.parts.forEach(walk); return; }
    const mt = String(p.mimeType || '').toLowerCase();
    const ct = ((p.headers || []).find(h => h.name.toLowerCase() === 'content-type') || {}).value || '';
    const cs = (/charset="?([^";]+)"?/i.exec(ct) || [])[1];
    if (p.filename || !(p.body && p.body.data)) return;
    if (mt === 'text/html' && !out.html) out.html = b64uText(p.body.data, cs);
    if (mt === 'text/plain' && !out.text) out.text = b64uText(p.body.data, cs);
  })(payload);
  return out;
}
function header(m, n) { return (((m.payload && m.payload.headers) || []).find(h => h.name.toLowerCase() === n) || {}).value || ''; }

// Looks for today's OpenTable email and saves it. force: read it again even if it was already read.
export async function preshiftRefresh(env, key, force) {
  if (!key || !env.SUPABASE_URL) return { error: 'not_ready' };
  if (missing(env).length) return { error: 'mail_not_ready' };
  const st = await rpc(env, 'preshift_status_server', { p_key: key });
  if (!st || st.error) return { error: st && st.error === 'key' ? 'key' : 'db' };
  const address = String(env.OPENTABLE_MAILBOX || 'rich@edencny.com').toLowerCase();
  const tk = await rpc(env, 'mail_token_server', { p_key: key, p_address: address });
  if (!tk || tk.error) return { error: (tk && tk.error) || 'db', address };
  const refresh = await unsealToken(env, tk.token, address);
  if (!refresh) return { error: 'reconnect', address };
  const g = gmailFor(env, 'preshift:' + tk.id + ':' + String(tk.token).slice(-24), refresh);
  let list;
  try { list = await gj(g, 'messages?maxResults=6&q=' + encodeURIComponent(SEARCH)); }
  catch (e) { return { error: e.code === 'revoked' ? 'reconnect' : 'gmail', address }; }
  const today = st.today || etDate(new Date());
  for (const m of (list.messages || []).slice(0, 4)) {
    const msg = await gj(g, 'messages/' + m.id + '?format=full');
    const when = new Date(Number(msg.internalDate) || 0);
    if (etDate(when) !== today) continue;                       // only an email that arrived today fills today's pre-shift
    if (msg.id + '@' + READER === st.email_id && !force) return { ok: true, unchanged: true, today };
    const b = bodies(msg.payload), subject = header(msg, 'subject');
    const parsed = parseOpenTable({ html: b.html, text: b.text, subject });
    await rpc(env, 'preshift_save_server', { p_key: key, p_date: today, p_row: {
      email_id: msg.id + '@' + READER, subject: parsed.subject, received: when.toISOString(), forwarded: /^\s*(fwd?|fw):/i.test(subject), reservations: parsed } });
    return { ok: true, saved: true, today, reservations: parsed.list.length };
  }
  return { ok: true, none: true, today };
}

// A manager opens Pre-shift (or presses "Check OpenTable now")
export async function preshiftRoute(req, env, key) {
  if (req.method !== 'POST') return json({ error: 'bad' }, 400);
  const o = req.headers.get('origin'); if (o && o !== new URL(req.url).origin) return json({ error: 'origin' }, 403);
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'auth' }, 401);
  let lvl; try { lvl = await rpc(env, 'access_level', {}, jwt); } catch (e) { return json({ error: 'auth' }, 401); }
  if (lvl !== 'owner' && lvl !== 'manager') return json({ error: 'auth' }, 403);
  let b = {}; try { b = await req.json(); } catch (e) {}
  try { return json(await preshiftRefresh(env, key, !!b.force)); }
  catch (e) { return json({ error: e.code || 'server' }, 502); }
}
