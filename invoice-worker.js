// Inventory → Scan invoice: reads a photo or PDF of a vendor invoice with Claude and sends back its lines
// (item, vendor code, pack, quantity, unit, unit price) for the staff site to match to inventory items.
// Nothing is saved here: the person checks every line on the staff site before any price changes.
//
// Needs the ANTHROPIC_API_KEY secret (Workers > eden-admin > Settings > Variables and Secrets).
// Only people who can use the inventory (Owner, Managers, Kitchen) can call it.

import { mailInternals } from './mail-worker.js';

const MODEL = 'claude-sonnet-5-5';
const MAX_FILES = 8, MAX_BYTES = 20 * 1024 * 1024;

function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); }

const TOOL = {
  name: 'invoice',
  description: 'The invoice, read line by line.',
  input_schema: {
    type: 'object',
    properties: {
      vendor: { type: 'string', description: 'Who the invoice is from (the seller), as printed. Not Eden.' },
      invoice_no: { type: 'string' },
      date: { type: 'string', description: 'Invoice date as YYYY-MM-DD, or empty' },
      total: { type: ['number', 'null'], description: 'Invoice total' },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Vendor item number / SKU, or empty' },
            description: { type: 'string', description: 'Item description as printed, brand included' },
            pack: { type: 'string', description: 'Pack size as printed, e.g. 6/#10, 4/1 GAL, 12/750ML, 25 LB, or empty' },
            qty: { type: ['number', 'null'], description: 'Quantity shipped/delivered (not ordered, if both are shown)' },
            unit: { type: 'string', description: 'What the price is per: case, each, lb, bottle, dozen, bunch, gal, keg…' },
            unit_price: { type: ['number', 'null'], description: 'Price per one unit (before quantity)' },
            extended: { type: ['number', 'null'], description: 'Line total' },
            note: { type: 'string', description: 'Anything unclear: hard to read, crossed out, credit, out of stock' }
          },
          required: ['description', 'qty', 'unit', 'unit_price', 'extended']
        }
      }
    },
    required: ['vendor', 'lines']
  }
};

const PROMPT = 'This is a vendor invoice for Eden, a restaurant in Syracuse, NY. It may be a printed distributor invoice, a farm\'s handwritten slip, ' +
  'a wine/spirits distributor invoice or a supply invoice, possibly over several photos (pages, in order). Read every product line. ' +
  'Skip deposits, fuel/delivery charges, taxes and subtotals as lines, but keep credits as lines with negative amounts. ' +
  'If only a line total and quantity are printed, work out unit_price = extended / qty. Use the shipped quantity. ' +
  'Copy descriptions as printed; do not invent codes or packs. Put anything you are unsure of in note. Then call the invoice tool.';

export async function invoiceRoute(req, env, rpc) {
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return json({ error: 'origin' }, 403);
  const jwt = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!jwt) return json({ error: 'auth', message: 'Sign in again.' }, 401);
  let ok = false; try { ok = await rpc(env, 'can_inventory', {}, jwt); } catch (e) { ok = false; }
  if (ok !== true) return json({ error: 'denied', message: 'Your login can’t change the inventory.' }, 403);
  if (!env.ANTHROPIC_API_KEY) return json({ error: 'off', message: 'Invoice reading isn’t switched on yet: add the ANTHROPIC_API_KEY secret in Cloudflare (Workers > eden-admin > Settings > Variables and Secrets).' }, 503);

  let b; try { b = await req.json(); } catch (e) { return json({ error: 'bad', message: 'That file couldn’t be sent.' }, 400); }
  const files = Array.isArray(b.files) ? b.files.slice(0, MAX_FILES) : [];
  if (!files.length) return json({ error: 'bad', message: 'No invoice attached.' }, 400);
  let bytes = 0;
  const content = [];
  for (const f of files) {
    const type = String(f.type || ''), data = String(f.data || '');
    bytes += data.length * 0.75;
    if (type === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: type, data } });
    else if (/^image\/(jpeg|png|webp|gif)$/.test(type)) content.push({ type: 'image', source: { type: 'base64', media_type: type, data } });
    else return json({ error: 'type', message: 'Send a photo (JPG or PNG) or a PDF.' }, 400);
  }
  if (bytes > MAX_BYTES) return json({ error: 'size', message: 'That invoice is too large. Try fewer pages or a smaller PDF.' }, 413);
  const out = await readInvoice(env, content);
  if (!out.ok) return json({ error: out.error, message: out.message }, out.status || 502);
  return json({ ok: true, invoice: out.invoice, usage: out.usage });
}

// content: Claude content blocks (images / a PDF). Returns { ok, invoice } or { ok: false, error, message, status }
export async function readInvoice(env, content) {
  if (!env.ANTHROPIC_API_KEY) return { ok: false, error: 'off', status: 503, message: 'Invoice reading isn’t switched on yet: add the ANTHROPIC_API_KEY secret in Cloudflare.' };
  content = content.concat([{ type: 'text', text: PROMPT }]);
  let r, j;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.INVOICE_MODEL || MODEL, max_tokens: 8000, tools: [TOOL], tool_choice: { type: 'tool', name: 'invoice' }, messages: [{ role: 'user', content }] })
    });
    j = await r.json();
  } catch (e) { return { ok: false, error: 'ai', message: 'Couldn’t reach the invoice reader. Try again.' }; }
  if (!r.ok) {
    const m = (j && j.error && j.error.message) || '';
    return { ok: false, error: 'ai', message: r.status === 401 ? 'The ANTHROPIC_API_KEY secret isn’t valid.' : r.status === 429 ? 'Too many invoices at once. Wait a minute and try again.' : 'The invoice reader had a problem' + (m ? ': ' + m : '.') };
  }
  const use = (j.content || []).filter(x => x.type === 'tool_use')[0];
  if (!use || !use.input || !Array.isArray(use.input.lines)) return { ok: false, error: 'read', status: 422, message: 'Couldn’t read any lines on that invoice. Try a sharper, flatter photo.' };
  const inv = use.input;
  inv.lines = inv.lines.filter(l => l && String(l.description || '').trim()).map(l => ({
    code: String(l.code || '').trim(), description: String(l.description || '').trim(), pack: String(l.pack || '').trim(),
    qty: typeof l.qty === 'number' ? l.qty : null, unit: String(l.unit || '').trim(), unit_price: typeof l.unit_price === 'number' ? l.unit_price : null,
    extended: typeof l.extended === 'number' ? l.extended : null, note: String(l.note || '').trim()
  }));
  return { ok: true, invoice: inv, usage: j.usage || null };
}

/* ---------- the scanner's Google Drive folder ----------
 * The office Mac's scanner saves each scan into a Google Drive folder. Every 5 minutes (and on "Check now")
 * drivePoll looks for new PDFs or images there, reads each with Claude and adds it to inventory_inbox as waiting.
 * The folder is only read: nothing in Drive is changed, moved or deleted.
 *   /drive/start   Owner or manager: Google's sign-in page (read-only Drive)
 *   /drive/finish  saves the locked permission, then looks for the folder (default "Eden Invoices")
 *   /drive/folder  picks the folder by name
 *   /drive/check   anyone who can use the inventory: check the folder now
 *   /drive/remove  disconnects and cancels the permission at Google */
const DRIVE = 'https://www.googleapis.com/drive/v3/';
const DEFAULT_FOLDER = 'Eden Invoices';
const MAX_DRIVE_BYTES = 18 * 1024 * 1024;
function b64(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
const jwtOf = req => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
async function driveAccess(env, tokenEnc, address) {
  const x = await mailInternals.unseal(env, tokenEnc, 'drive-token:' + String(address || '').toLowerCase());
  if (!x || !x.t) return null;
  return mailInternals.accessFor(env, 'drive:' + String(tokenEnc).slice(-24), x.t);
}
async function findFolder(at, name) {
  const q = "mimeType='application/vnd.google-apps.folder' and trashed=false and name='" + String(name).replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const r = await fetch(DRIVE + 'files?' + new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '5', spaces: 'drive', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' }), { headers: { Authorization: 'Bearer ' + at } });
  if (!r.ok) return { error: r.status === 403 ? 'api' : 'google' };
  const j = await r.json();
  return { folder: (j.files || [])[0] || null };
}

export async function driveRoute(req, env, path, rpc, key) {
  if (req.method !== 'POST') return json({ error: 'bad' }, 405);
  const origin = req.headers.get('origin');
  if (origin && origin !== new URL(req.url).origin) return json({ error: 'origin' }, 403);
  const jwt = jwtOf(req);
  if (!jwt) return json({ error: 'auth', message: 'Sign in again.' }, 401);
  if (mailInternals.missing(env).length) return json({ error: 'not_ready', message: 'Google isn’t set up for the staff site yet (the same settings as Business email).' }, 503);
  let b = {}; try { b = await req.json(); } catch (e) {}
  const lvl = await rpc(env, 'access_level', {}, jwt).catch(() => null);
  const boss = lvl === 'owner' || lvl === 'manager';

  if (path === '/drive/check') {
    const ok = await rpc(env, 'can_inventory', {}, jwt).catch(() => false);
    if (ok !== true) return json({ error: 'denied', message: 'Your login can’t use the inventory.' }, 403);
    const r = await drivePoll(env, key, 6);
    return json(r, r.error ? 400 : 200);
  }
  if (path === '/drive/file') {   // one scanned file from the folder (only files already in the scanned-invoices list), for the staff site to convert
    const ok = await rpc(env, 'can_inventory', {}, jwt).catch(() => false);
    if (ok !== true) return json({ error: 'denied' }, 403);
    const id = String(b.file_id || '');
    if (!/^[A-Za-z0-9_-]{10,200}$/.test(id)) return json({ error: 'bad' }, 400);
    const chk = await fetch(String(env.SUPABASE_URL).replace(/\/$/, '') + '/rest/v1/inventory_inbox?select=id&file_id=eq.' + encodeURIComponent(id), { headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + jwt } }).then(r => r.ok ? r.json() : []).catch(() => []);
    if (!chk.length) return json({ error: 'denied' }, 403);
    const d = await fetch(String(env.SUPABASE_URL).replace(/\/$/, '') + '/rest/v1/rpc/inv_drive_server', { method: 'POST', headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + env.SUPABASE_KEY, 'content-type': 'application/json' }, body: JSON.stringify({ p_key: key }) }).then(r => r.ok ? r.json() : null).catch(() => null);
    if (!d || d.error) return json({ error: 'not_connected', message: 'Google Drive isn’t connected.' }, 400);
    const at = await driveAccess(env, d.token, d.address);
    if (!at || at === 'REVOKED') return json({ error: 'reconnect', message: 'Google Drive needs to be connected again.' }, 400);
    const fr = await fetch(DRIVE + 'files/' + encodeURIComponent(id) + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + at } });
    if (!fr.ok) return json({ error: 'google', message: 'Couldn’t download it from Google Drive.' }, 502);
    return new Response(fr.body, { headers: { 'content-type': fr.headers.get('content-type') || 'application/octet-stream', 'cache-control': 'no-store' } });
  }
  if (!boss) return json({ error: 'denied', message: 'Only the Owner or a manager can connect the scanner folder.' }, 403);
  if (path === '/drive/start') {
    const u = await mailInternals.userOf(env, jwt);
    if (!u) return json({ error: 'auth' }, 401);
    return json({ url: await mailInternals.driveStartUrl(env, req, u.id) });
  }
  if (path === '/drive/finish') {
    const u = await mailInternals.userOf(env, jwt);
    const c = await mailInternals.unseal(env, b.k, 'drive-connect');
    if (!u || !c || !(c.exp > Date.now()) || c.u !== u.id) return json({ error: 'expired', message: 'That Google sign-in has expired. Connect the folder again.' }, 400);
    const address = String(c.a).toLowerCase(), tok = await mailInternals.seal(env, { t: c.t }, 'drive-token:' + address);
    const s = await rpc(env, 'inv_drive_save', { p_address: address, p_token: tok }, jwt).catch(() => null);
    if (!s || !s.ok) return json({ error: 'db', message: s && s.error === 'denied' ? 'Only the Owner or a manager can connect the scanner folder.' : 'Couldn’t save it. Has supabase/invoice-scanner.sql been run?' }, 502);
    return pickFolder(env, rpc, jwt, DEFAULT_FOLDER, address);
  }
  if (path === '/drive/folder') return pickFolder(env, rpc, jwt, String(b.name || '').trim() || DEFAULT_FOLDER);
  if (path === '/drive/remove') {
    const r = await rpc(env, 'inv_drive_remove', {}, jwt).catch(() => null);
    if (!r || !r.ok) return json({ error: 'db' }, 502);
    const [tokenEnc, address] = String(r.token || '').split('|');
    if (tokenEnc) { const x = await mailInternals.unseal(env, tokenEnc, 'drive-token:' + address); if (x && x.t) { try { await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: x.t }) }); } catch (e) {} } }
    return json({ ok: true });
  }
  return json({ error: 'bad' }, 404);
}
async function pickFolder(env, rpc, jwt, name, address) {
  const d = await rpc(env, 'inv_drive_token', {}, jwt).catch(() => null);
  if (!d || d.error) return json({ error: 'not_connected', message: 'Connect Google Drive first.' }, 400);
  const at = await driveAccess(env, d.token, d.address);
  if (!at || at === 'REVOKED') return json({ error: 'reconnect', message: 'Google Drive needs to be connected again.' }, 400);
  const f = await findFolder(at, name);
  if (f.error) return json({ error: 'api', message: f.error === 'api' ? 'Google Drive answered “not allowed”. Turn on the Google Drive API in Google Cloud (APIs & Services → Library → Google Drive API → Enable), then try again.' : 'Couldn’t reach Google Drive. Try again.' }, 502);
  if (!f.folder) return json({ ok: true, connected: true, address: d.address, folder: null, looked: name, message: 'Connected ' + d.address + '. There’s no folder called “' + name + '” in that Google Drive yet: create it, then press Find folder.' });
  await rpc(env, 'inv_drive_set_folder', { p_folder_id: f.folder.id, p_folder_name: f.folder.name }, jwt);
  return json({ ok: true, connected: true, address: d.address, folder: f.folder.name });
}

// every 5 minutes from worker.js, and from "Check now"
export async function drivePoll(env, key, max) {
  if (!key || !env.SUPABASE_URL || mailInternals.missing(env).length) return { error: 'off' };
  const sb = (name, args) => fetch(String(env.SUPABASE_URL).replace(/\/$/, '') + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + env.SUPABASE_KEY, 'content-type': 'application/json' }, body: JSON.stringify(args) }).then(r => r.ok ? r.json() : null).catch(() => null);
  const d = await sb('inv_drive_server', { p_key: key });
  if (!d || d.error) return { error: (d && d.error) || 'db' };
  if (!d.folder_id) return { error: 'nofolder', message: 'No folder picked yet.' };
  const done = (err, st) => sb('inv_drive_checked_server', { p_key: key, p_error: err || '', p_status: st || '' });
  const at = await driveAccess(env, d.token, d.address);
  if (at === 'REVOKED') { await done('Google Drive needs to be connected again.', 'reconnect'); return { error: 'reconnect', message: 'Google Drive needs to be connected again.' }; }
  if (!at) { await done('Couldn’t reach Google.'); return { error: 'google', message: 'Couldn’t reach Google. Try again.' }; }
  const since = new Date(Date.now() - 30 * 864e5).toISOString();
  const q = "'" + d.folder_id + "' in parents and trashed=false and createdTime > '" + since + "' and (mimeType='application/pdf' or mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/heic' or mimeType='image/heif')";
  const lr = await fetch(DRIVE + 'files?' + new URLSearchParams({ q, fields: 'files(id,name,mimeType,size,createdTime)', orderBy: 'createdTime', pageSize: '100', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' }), { headers: { Authorization: 'Bearer ' + at } });
  if (!lr.ok) { const m = lr.status === 403 ? 'Google Drive answered “not allowed”: turn on the Google Drive API in Google Cloud.' : lr.status === 404 ? 'The scanner folder was moved or deleted: pick it again.' : 'Couldn’t list the folder.'; await done(m, lr.status === 404 ? 'nofolder' : ''); return { error: 'google', message: m }; }
  const seen = new Set(d.seen || []);
  const fresh = ((await lr.json()).files || []).filter(f => !seen.has(f.id));
  let added = 0, failed = 0;
  for (const f of fresh.slice(0, max || 3)) {
    let inv = null, err = '';
    if (/hei[cf]/i.test(f.mimeType)) {   // iPhone photo: the staff site converts it to JPEG and reads it when it's opened
      await sb('inv_inbox_add_server', { p_key: key, p_file_id: f.id, p_name: f.name, p_created: f.createdTime, p_status: 'waiting', p_invoice: { pending: 'heic', mime: f.mimeType, lines: [] }, p_error: '' });
      added++; continue;
    }
    if (+f.size > MAX_DRIVE_BYTES) err = 'This scan is over 18 MB. Scan at 300 dpi or less, in color or grayscale, and save as PDF.';
    else {
      const fr = await fetch(DRIVE + 'files/' + encodeURIComponent(f.id) + '?alt=media&supportsAllDrives=true', { headers: { Authorization: 'Bearer ' + at } });
      if (!fr.ok) err = 'Couldn’t download it from Google Drive.';
      else {
        const data = b64(await fr.arrayBuffer());
        if (f.mimeType !== 'application/pdf' && data.length * 0.75 > 5 * 1024 * 1024) err = 'This image is over 5 MB. Save scans as PDF instead.';
        else {
          const block = f.mimeType === 'application/pdf' ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } } : { type: 'image', source: { type: 'base64', media_type: f.mimeType, data } };
          const out = await readInvoice(env, [block]);
          if (out.ok) { inv = out.invoice; inv.source = 'scan: ' + f.name; } else { err = out.message; if (out.error === 'off' || out.error === 'ai') { await done(out.message); return { error: out.error, message: out.message, added }; } }
        }
      }
    }
    await sb('inv_inbox_add_server', { p_key: key, p_file_id: f.id, p_name: f.name, p_created: f.createdTime, p_status: inv ? 'waiting' : 'error', p_invoice: inv, p_error: err });
    if (inv) added++; else failed++;
  }
  await done('');
  return { ok: true, added, failed, more: Math.max(0, fresh.length - (max || 3)) };
}
