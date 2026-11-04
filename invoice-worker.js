// Inventory → Scan invoice: reads a photo or PDF of a vendor invoice with Claude and sends back its lines
// (item, vendor code, pack, quantity, unit, unit price) for the staff site to match to inventory items.
// Nothing is saved here: the person checks every line on the staff site before any price changes.
//
// Needs the ANTHROPIC_API_KEY secret (Workers > eden-admin > Settings > Variables and Secrets).
// Only people who can use the inventory (Owner, Managers, Kitchen) can call it.

import { mailInternals } from './mail-worker.js';
import { PDFDocument } from './lib/pdf-lib-1.17.1.esm.min.js';   // MIT, github.com/Hopding/pdf-lib: splits a scanned stack into one PDF per invoice

const MODEL = 'claude-sonnet-5-5';
const MAX_FILES = 8, MAX_BYTES = 20 * 1024 * 1024;
// Claude takes up to 32 MB per request (base64 makes a file a third bigger), so a big PDF is read a few pages at a time
// and a long stack a few pages at a time too, so every invoice's lines fit in one answer
const CHUNK_BYTES = 9 * 1024 * 1024, CHUNK_PAGES = 8;

function json(obj, status) { return new Response(JSON.stringify(obj), { status: status || 200, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } }); }

const ONE = {
    type: 'object',
    properties: {
      pages: { type: 'array', items: { type: 'integer' }, description: 'The page numbers (1 = first page or photo) this invoice is on, in order' },
      vendor: { type: 'string', description: 'Who the invoice is from (the seller), as printed. Not Eden.' },
      invoice_no: { type: 'string' },
      date: { type: 'string', description: 'Invoice date as YYYY-MM-DD, or empty' },
      total: { type: ['number', 'null'], description: 'Invoice total' },
      fees: { type: 'array', description: 'Delivery charges, fuel surcharges, freight, deposits, bottle/keg deposits, service fees: not products', items: { type: 'object', properties: { description: { type: 'string' }, amount: { type: ['number', 'null'] } }, required: ['description', 'amount'] } },
      lines: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Vendor item number / SKU, or empty' },
            description: { type: 'string', description: 'Item description as printed, brand included' },
            pack: { type: 'string', description: 'Pack size as printed, e.g. 6/#10, 4/1 GAL, 12/750ML, 25 LB, or empty' },
            cases: { type: ['number', 'null'], description: 'Full cases shipped, when the invoice has a Cases column (else null)' },
            bottles: { type: ['number', 'null'], description: 'Loose bottles/units shipped, when the invoice has a Bottles/Btls/Units column (else null)' },
            bottles_per_case: { type: ['number', 'null'], description: 'Bottles in a case, from the size or pack (6B = 6, 12/750ML = 12), else null' },
            qty: { type: ['number', 'null'], description: 'Quantity shipped, counted in the same unit the unit_price is per (not ordered, if both are shown)' },
            unit: { type: 'string', description: 'What unit_price is per: bottle, case, each, lb, dozen, bunch, gal, keg…' },
            unit_price: { type: ['number', 'null'], description: 'Net price per one unit (after any discount), the unit named in unit' },
            extended: { type: ['number', 'null'], description: 'Line total' },
            note: { type: 'string', description: 'Anything unclear: hard to read, crossed out, credit, out of stock' }
          },
          required: ['description', 'qty', 'unit', 'unit_price', 'extended']
        }
      }
    },
    required: ['vendor', 'lines']
};
const TOOL = {
  name: 'invoices',
  description: 'Every invoice in the file, each read line by line.',
  input_schema: { type: 'object', properties: { invoices: { type: 'array', items: ONE, description: 'One entry per invoice, in the order they appear' } }, required: ['invoices'] }
};

const PROMPT = 'These are vendor invoices for Eden, a restaurant in Syracuse, NY: printed distributor invoices, farms\' handwritten slips, ' +
  'wine/spirits distributor invoices or supply invoices, as photos or scanned pages in order. ' +
  'The file may be ONE invoice over one or more pages, or a STACK of several different invoices scanned together, possibly from different vendors. ' +
  'Return one entry per invoice, in order, with the page numbers it is on (a second page of the same invoice, e.g. "Page 2 of 2" or the same invoice number, belongs to the same entry). ' +
  'Skip pages that are not invoices (blank pages, statements, delivery notes with no prices). Read every product line. ' +
  'Put delivery charges, fuel surcharges, freight, deposits and service fees in fees (not lines). Skip taxes and subtotals. Keep credits as lines with negative amounts. ' +
  'If only a line total and quantity are printed, work out unit_price = extended / qty. Use the shipped quantity. ' +
  'Wine, beer and spirits invoices often have separate Cases and Bottles (Btls) columns: put full cases in cases and loose bottles in bottles, exactly as printed. ' +
  'The price may be per bottle (a Unit Price, Net Bottle or Bottle Price column) or per case: set unit to bottle or case to match what unit_price is per, ' +
  'and qty to the quantity in that same unit (a per-bottle price with 1 case of 12 plus 3 bottles is qty 15; a per-case price with 2 cases is qty 2). ' +
  'Use the net price after discounts; if the printed price times qty is a cent or two off the line total, keep the printed price. ' +
  'Skip lines where nothing was shipped (backordered, out of stock, zero quantity and zero total). ' +
  'Copy descriptions as printed; do not invent codes or packs. Put anything you are unsure of in note. You must answer by calling the invoices tool once with every invoice and every line; do not reply with text.';

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
  if (bytes > MAX_BYTES) return json({ error: 'size', message: 'That’s too large to read at once. Send fewer pages at a time.' }, 413);
  const out = await readInvoice(env, content);
  if (!out.ok) return json({ error: out.error, message: out.message }, out.status || 502);
  return json({ ok: true, invoice: out.invoice, invoices: out.invoices, usage: out.usage });
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
      body: JSON.stringify({ model: env.INVOICE_MODEL || MODEL, max_tokens: 16000, tools: [TOOL], tool_choice: { type: 'auto' }, messages: [{ role: 'user', content }] })
    });
    j = await r.json();
  } catch (e) { return { ok: false, error: 'ai', message: 'Couldn’t reach the invoice reader. Try again.' }; }
  if (!r.ok) {
    const m = (j && j.error && j.error.message) || '';
    return { ok: false, error: 'ai', message: r.status === 401 ? 'The ANTHROPIC_API_KEY secret isn’t valid.' : r.status === 429 ? 'Too many invoices at once. Wait a minute and try again.' : 'The invoice reader had a problem' + (m ? ': ' + m : '.') };
  }
  let use = (j.content || []).filter(x => x.type === 'tool_use')[0];
  if (!use) {   // no tool call: take the JSON from the reply's text, if it wrote it out instead
    const txt = (j.content || []).filter(x => x.type === 'text').map(x => x.text).join('\n');
    const m = txt.match(/\{[\s\S]*\}/);
    if (m) { try { use = { input: JSON.parse(m[0]) }; } catch (e) {} }
  }
  const got = use && use.input ? (Array.isArray(use.input.invoices) ? use.input.invoices : Array.isArray(use.input.lines) ? [use.input] : []) : [];
  const n = v => typeof v === 'number' && isFinite(v) ? v : null;
  const invoices = got.filter(inv => inv && Array.isArray(inv.lines)).map(inv => {
    inv.lines = inv.lines.filter(l => l && String(l.description || '').trim())
      .filter(l => !(!n(l.extended) && !n(l.qty) && !n(l.cases) && !n(l.bottles)))   // nothing shipped (backordered, out of stock)
      .map(l => ({
        cases: n(l.cases), bottles: n(l.bottles), bottles_per_case: n(l.bottles_per_case),
        code: String(l.code || '').trim(), description: String(l.description || '').trim(), pack: String(l.pack || '').trim(),
        qty: n(l.qty), unit: String(l.unit || '').trim(), unit_price: n(l.unit_price), extended: n(l.extended), note: String(l.note || '').trim()
      }));
    inv.fees = (Array.isArray(inv.fees) ? inv.fees : []).filter(f => f && String(f.description || '').trim() && n(f.amount)).map(f => ({ description: String(f.description).trim(), amount: n(f.amount) }));
    inv.pages = (Array.isArray(inv.pages) ? inv.pages : []).map(x => Math.round(+x)).filter(x => x >= 1);
    inv.vendor = String(inv.vendor || '').trim();
    return inv;
  }).filter(inv => inv.lines.length || inv.fees.length);
  if (!invoices.length) return { ok: false, error: 'read', status: 422, message: 'Couldn’t read any lines on that invoice. Try a sharper, flatter photo.' };
  return { ok: true, invoice: invoices[0], invoices, usage: j.usage || null };
}

// a PDF of any size: small ones in one go; big ones split into groups of pages, each read on its own, then put back together
// (page numbers refer to the whole file; an invoice cut in two at a split is joined back up by its vendor and number)
export async function readPdf(env, buf) {
  const one = () => readInvoice(env, [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: b64(buf) } }]);
  let src;
  try { src = await PDFDocument.load(buf, { ignoreEncryption: true }); } catch (e) { return buf.byteLength <= CHUNK_BYTES ? one() : { ok: false, error: 'read', status: 422, message: 'That PDF couldn’t be opened.' }; }
  const total = src.getPageCount(), per = buf.byteLength / Math.max(1, total);
  if (buf.byteLength <= CHUNK_BYTES && total <= CHUNK_PAGES) return one();
  if (per > 22 * 1024 * 1024) return { ok: false, error: 'size', status: 413, message: 'A single page of this scan is over 22 MB. Scan at 200–300 dpi in grayscale (not 600 dpi color) and try again.' };
  const step = Math.max(1, Math.min(CHUNK_PAGES, Math.floor(CHUNK_BYTES / per)));
  const groups = []; for (let start = 0; start < total; start += step) groups.push(start);
  // read up to three groups at the same time
  const results = new Array(groups.length);
  let next = 0;
  async function worker() {
    while (next < groups.length) {
      const gi = next++, start = groups[gi], idx = [];
      for (let i = start; i < Math.min(total, start + step); i++) idx.push(i);
      const doc = await PDFDocument.create();
      (await doc.copyPages(src, idx)).forEach(p => doc.addPage(p));
      let data = b64(await doc.save());
      results[gi] = { start, idx, out: await readInvoice(env, [{ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } }]) };
      data = null;
    }
  }
  await Promise.all([worker(), worker(), worker()]);
  const all = [], usage = { input_tokens: 0, output_tokens: 0 };
  let lastErr = null;
  for (const r of results) {
    const out = r.out;
    if (!out.ok) { if (out.error === 'off' || out.error === 'ai') return out; lastErr = out; continue; }   // a group of blank pages is fine
    if (out.usage) { usage.input_tokens += out.usage.input_tokens || 0; usage.output_tokens += out.usage.output_tokens || 0; }
    out.invoices.forEach((inv, k) => { inv.pages = (inv.pages || []).map(p => p + r.start); if (!inv.pages.length) inv.pages = r.idx.map(i => i + 1); inv._first = k === 0 && inv.pages[0] === r.start + 1 && r.start > 0; all.push(inv); });
  }
  // join an invoice that ran across a split: same number, or a continuation page with no number from the same vendor
  const joined = [];
  all.forEach(inv => {
    const prev = joined[joined.length - 1];
    const sameV = prev && String(prev.vendor).toLowerCase() === String(inv.vendor).toLowerCase();
    const same = prev && sameV && ((inv.invoice_no && prev.invoice_no === inv.invoice_no) || (inv._first && !inv.invoice_no && prev.pages[prev.pages.length - 1] === inv.pages[0] - 1));
    delete inv._first;
    if (!same) { joined.push(inv); return; }
    prev.lines = prev.lines.concat(inv.lines); prev.fees = (prev.fees || []).concat(inv.fees || []); prev.pages = prev.pages.concat(inv.pages);
    if (inv.total != null) prev.total = inv.total; if (!prev.date && inv.date) prev.date = inv.date;
  });
  if (!joined.length) return lastErr || { ok: false, error: 'read', status: 422, message: 'Couldn’t read any invoices in that scan.' };
  return { ok: true, invoice: joined[0], invoices: joined, usage };
}
function unb64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }

/* ---------- the scanner's Google Drive folder ----------
 * The office Mac's scanner saves each scan into a Google Drive folder. Every 5 minutes (and on "Check now")
 * drivePoll looks for new PDFs or images there, reads each with Claude and adds it to inventory_inbox as waiting.
 * Each invoice is then filed: Eden Invoices → Filed → <vendor> → "<vendor> <date> #<number>.pdf" (the vendor's folder is made the
 * first time), and a stack of several invoices scanned together is split into one PDF per invoice, with the original stack
 * moved to Filed → Original scans. Nothing is deleted. (Connections made before filing existed are read-only: reconnect.)
 *   /drive/start   Owner or manager: Google's sign-in page (Google Drive, to read scans and file them)
 *   /drive/finish  saves the locked permission, then looks for the folder (default "Eden Invoices")
 *   /drive/folder  picks the folder by name
 *   /drive/check   anyone who can use the inventory: check the folder now
 *   /drive/remove  disconnects and cancels the permission at Google */
const DRIVE = 'https://www.googleapis.com/drive/v3/';
const DEFAULT_FOLDER = 'Eden Invoices';
const MAX_DRIVE_BYTES = 45 * 1024 * 1024;
function b64(buf) { let s = ''; const b = new Uint8Array(buf); for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); }
const jwtOf = req => (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
async function driveAccess(env, tokenEnc, address) {
  const x = await mailInternals.unseal(env, tokenEnc, 'drive-token:' + String(address || '').toLowerCase());
  if (!x || !x.t) return null;
  return mailInternals.accessFor(env, 'drive:' + String(tokenEnc).slice(-24), x.t);
}
async function canFile(env, tokenEnc, address) {
  const x = await mailInternals.unseal(env, tokenEnc, 'drive-token:' + String(address || '').toLowerCase());
  return !!(x && x.w);
}
const gq = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
function safeName(s) { return String(s || '').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-').replace(/\s+/g, ' ').trim().slice(0, 120); }
function vkey(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').replace(/\b(llc|inc|co|corp|company|ltd)\b/g, '').replace(/\s+/g, ' ').trim(); }
async function gd(at, url, opts) {
  const r = await fetch(url, Object.assign({}, opts || {}, { headers: Object.assign({ Authorization: 'Bearer ' + at }, (opts && opts.headers) || {}) }));
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error('drive ' + r.status), { status: r.status, j });
  return j;
}
async function folderIn(at, parent, name, create) {
  const q = "'" + parent + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false and name='" + gq(name) + "'";
  const j = await gd(at, DRIVE + 'files?' + new URLSearchParams({ q, fields: 'files(id,name)', pageSize: '5', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' }));
  if (j.files && j.files[0]) return j.files[0].id;
  if (!create) return null;
  const c = await gd(at, DRIVE + 'files?supportsAllDrives=true&fields=id', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', parents: [parent] }) });
  return c.id;
}
// Filed → one folder per vendor, matched loosely ("Empire Merchants North, LLC" = "Empire Merchants North"), made when new
async function filing(at, rootId) {
  const filed = await folderIn(at, rootId, 'Filed', true);
  const j = await gd(at, DRIVE + 'files?' + new URLSearchParams({ q: "'" + filed + "' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false", fields: 'files(id,name)', pageSize: '1000', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' }));
  const byKey = new Map(); (j.files || []).forEach(f => byKey.set(vkey(f.name), f));
  let originals = null;
  return {
    async vendor(name) {
      const nm = safeName(name) || 'Unknown vendor', k = vkey(nm);
      if (byKey.has(k)) return byKey.get(k);
      const id = await folderIn(at, filed, nm, true); const f = { id, name: nm, made: true }; byKey.set(k, f); return f;
    },
    async originals() { return originals || (originals = await folderIn(at, filed, 'Original scans', true)); }
  };
}
async function uploadPdf(at, parent, name, bytes) {
  const b = 'eden' + Math.random().toString(36).slice(2);
  const meta = JSON.stringify({ name, parents: [parent], mimeType: 'application/pdf' });
  const body = new Blob(['--' + b + '\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n' + meta + '\r\n--' + b + '\r\ncontent-type: application/pdf\r\n\r\n', bytes, '\r\n--' + b + '--']);
  return gd(at, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,webViewLink', { method: 'POST', headers: { 'content-type': 'multipart/related; boundary=' + b }, body });
}
async function moveFile(at, id, from, to, name) {
  const q = new URLSearchParams({ addParents: to, removeParents: from, supportsAllDrives: 'true', fields: 'id,webViewLink' });
  return gd(at, DRIVE + 'files/' + encodeURIComponent(id) + '?' + q, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(name ? { name } : {}) });
}
function label(inv, f) {
  const d = /^\d{4}-\d\d-\d\d$/.test(inv.date || '') ? inv.date : String(f.createdTime || '').slice(0, 10);
  return safeName([inv.vendor || 'Unknown vendor', d, inv.invoice_no ? '#' + inv.invoice_no : ''].filter(Boolean).join(' '));
}
// put each invoice from one scanned file into its vendor's folder; returns a note per invoice
async function fileScan(at, F, rootId, f, bytes, invoices) {
  const ext = f.mimeType === 'application/pdf' ? '.pdf' : f.mimeType === 'image/png' ? '.png' : '.jpg';
  const used = new Set();
  const nameFor = (inv, v) => { let n = label(Object.assign({}, inv, { vendor: v.name }), f), k = n, i = 2; while (used.has(k)) k = n + ' (' + i++ + ')'; used.add(k); return k + ext; };
  if (invoices.length === 1 || ext !== '.pdf') {   // one invoice: move the scan itself into the vendor's folder, renamed
    const inv = invoices[0], v = await F.vendor(inv.vendor), nm = nameFor(inv, v);
    const m = await moveFile(at, f.id, rootId, v.id, nm);
    return invoices.map((x, i) => i === 0 ? { name: nm, folder: v.name, id: m.id, link: m.webViewLink, made: v.made } : { folder: v.name, note: 'Filed with the first invoice in this scan' });
  }
  const src = await PDFDocument.load(bytes, { ignoreEncryption: true });
  const total = src.getPageCount(), out = [];
  for (let i = 0; i < invoices.length; i++) {
    const inv = invoices[i];
    let pages = (inv.pages || []).filter(p => p <= total).map(p => p - 1);
    if (!pages.length) { out.push({ note: 'Its pages couldn’t be told apart, so it stays in the original scan' }); continue; }
    const doc = await PDFDocument.create();
    (await doc.copyPages(src, pages)).forEach(p => doc.addPage(p));
    const v = await F.vendor(inv.vendor), nm = nameFor(inv, v);
    const up = await uploadPdf(at, v.id, nm, await doc.save());
    out.push({ name: nm, folder: v.name, id: up.id, link: up.webViewLink, made: v.made, pages: inv.pages });
  }
  await moveFile(at, f.id, rootId, await F.originals());   // the whole stack, kept as scanned
  return out;
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
  const SB = String(env.SUPABASE_URL).replace(/\/$/, '');
  const server = (name, args) => fetch(SB + '/rest/v1/rpc/' + name, { method: 'POST', headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + env.SUPABASE_KEY, 'content-type': 'application/json' }, body: JSON.stringify(Object.assign({ p_key: key }, args || {})) }).then(r => r.ok ? r.json() : null).catch(() => null);
  const listed = fid => fetch(SB + '/rest/v1/inventory_inbox?select=id&file_id=eq.' + encodeURIComponent(fid), { headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + jwt } }).then(r => r.ok ? r.json() : []).catch(() => []);
  const fidOk = fid => /^[A-Za-z0-9_-]{10,200}(~\d{0,20})?$/.test(fid);
  // filing a scan the staff site has read: the Drive connection, and whether it can write
  async function conn() {
    const ok = await rpc(env, 'can_inventory', {}, jwt).catch(() => false);
    if (ok !== true) return { err: json({ error: 'denied' }, 403) };
    const d = await server('inv_drive_server');
    if (!d || d.error || !d.folder_id) return { err: json({ error: 'not_connected', message: 'Google Drive isn’t connected.' }, 400) };
    const at = await driveAccess(env, d.token, d.address);
    if (!at || at === 'REVOKED') return { err: json({ error: 'reconnect', message: 'Google Drive needs to be connected again.' }, 400) };
    if (!(await canFile(env, d.token, d.address))) return { err: json({ error: 'readonly', message: 'To file scans into vendor folders, reconnect Google Drive (Change folder → Disconnect, then Connect Google Drive).' }, 400) };
    return { d, at };
  }
  if (path === '/drive/put') {   // one invoice's pages, split from a stack by the staff site: upload it into its vendor's folder
    const u = new URL(req.url), fid = u.searchParams.get('file_id') || '';
    if (!fidOk(fid) || !(await listed(fid)).length) return json({ error: 'denied' }, 403);
    const c = await conn(); if (c.err) return c.err;
    const buf = await req.arrayBuffer();
    if (!buf.byteLength || buf.byteLength > MAX_DRIVE_BYTES) return json({ error: 'bad' }, 400);
    try {
      const F = await filing(c.at, c.d.folder_id), v = await F.vendor(u.searchParams.get('vendor') || '');
      const nm = safeName(u.searchParams.get('name') || 'Invoice') + '.pdf';
      const up = await uploadPdf(c.at, v.id, nm, new Uint8Array(buf));
      return json({ ok: true, name: nm, folder: v.name, id: up.id, link: up.webViewLink, made: !!v.made });
    } catch (e) { return json({ error: 'google', message: 'Couldn’t save it in Google Drive (' + (e.status || 'error') + ').' }, 502); }
  }
  let b = {}; try { b = await req.json(); } catch (e) {}
  if (path === '/drive/move') {   // a scan the site has read: into its vendor's folder (one invoice) or Filed → Original scans (a split stack)
    const fid = String(b.file_id || '');
    if (!fidOk(fid) || !(await listed(fid)).length) return json({ error: 'denied' }, 403);
    const c = await conn(); if (c.err) return c.err;
    try {
      const F = await filing(c.at, c.d.folder_id), id = fid.split('~')[0];
      if (b.to === 'originals') { const m = await moveFile(c.at, id, c.d.folder_id, await F.originals()); return json({ ok: true, id: m.id, link: m.webViewLink }); }
      const v = await F.vendor(b.vendor || ''), nm = safeName(b.name || 'Invoice') + (b.ext || '.pdf');
      const m = await moveFile(c.at, id, c.d.folder_id, v.id, nm);
      return json({ ok: true, name: nm, folder: v.name, id: m.id, link: m.webViewLink, made: !!v.made });
    } catch (e) { return json({ error: 'google', message: 'Couldn’t file it in Google Drive (' + (e.status || 'error') + ').' }, 502); }
  }
  if (path === '/drive/save') {   // what the site read from a scan: one waiting invoice per invoice in it
    const ok = await rpc(env, 'can_inventory', {}, jwt).catch(() => false);
    if (ok !== true) return json({ error: 'denied' }, 403);
    const fid = String(b.file_id || ''), invs = Array.isArray(b.invoices) ? b.invoices.slice(0, 60) : [];
    if (!fidOk(fid) || !(await listed(fid)).length) return json({ error: 'denied' }, 403);
    if (!invs.length) { await server('inv_inbox_add_server', { p_file_id: fid, p_name: String(b.name || ''), p_created: b.created || null, p_status: 'error', p_invoice: { lines: [], failed: true }, p_error: String(b.error || 'Couldn’t read it.').slice(0, 300) }); return json({ ok: true }); }
    for (let i = 0; i < invs.length; i++) {
      const x = invs[i] || {}, nm = x.filed && x.filed.name ? x.filed.name : String(b.name || '') + (invs.length > 1 ? ' · ' + (i + 1) + ' of ' + invs.length : '');
      await server('inv_inbox_add_server', { p_file_id: i ? fid + '#' + (i + 1) : fid, p_name: nm, p_created: b.created || null, p_status: 'waiting', p_invoice: x, p_error: '' });
    }
    return json({ ok: true, saved: invs.length });
  }
  const lvl = await rpc(env, 'access_level', {}, jwt).catch(() => null);
  const boss = lvl === 'owner' || lvl === 'manager';

  if (path === '/drive/check') {
    const ok = await rpc(env, 'can_inventory', {}, jwt).catch(() => false);
    if (ok !== true) return json({ error: 'denied', message: 'Your login can’t use the inventory.' }, 403);
    const r = await drivePoll(env, key, 25);
    return json(r, r.error ? 400 : 200);
  }
  if (path === '/drive/file') {   // one scanned file from the folder (only files already in the scanned-invoices list), for the staff site to convert
    const ok = await rpc(env, 'can_inventory', {}, jwt).catch(() => false);
    if (ok !== true) return json({ error: 'denied' }, 403);
    const fid = String(b.file_id || ''), id = fid.split('~')[0];
    if (!/^[A-Za-z0-9_-]{10,200}(~\d{0,20})?$/.test(fid)) return json({ error: 'bad' }, 400);
    const chk = await fetch(String(env.SUPABASE_URL).replace(/\/$/, '') + '/rest/v1/inventory_inbox?select=id&file_id=eq.' + encodeURIComponent(fid), { headers: { apikey: env.SUPABASE_KEY, Authorization: 'Bearer ' + jwt } }).then(r => r.ok ? r.json() : []).catch(() => []);
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
    const address = String(c.a).toLowerCase(), tok = await mailInternals.seal(env, { t: c.t, w: !!c.w }, 'drive-token:' + address);
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
  const q = "'" + d.folder_id + "' in parents and trashed=false and modifiedTime > '" + since + "' and (mimeType='application/pdf' or mimeType='image/jpeg' or mimeType='image/png' or mimeType='image/heic' or mimeType='image/heif')";
  const lr = await fetch(DRIVE + 'files?' + new URLSearchParams({ q, fields: 'files(id,name,mimeType,size,createdTime,modifiedTime)', orderBy: 'modifiedTime', pageSize: '100', includeItemsFromAllDrives: 'true', supportsAllDrives: 'true' }), { headers: { Authorization: 'Bearer ' + at } });
  if (!lr.ok) { const m = lr.status === 403 ? 'Google Drive answered “not allowed”: turn on the Google Drive API in Google Cloud.' : lr.status === 404 ? 'The scanner folder was moved or deleted: pick it again.' : 'Couldn’t list the folder.'; await done(m, lr.status === 404 ? 'nofolder' : ''); return { error: 'google', message: m }; }
  const seen = new Set(d.seen || []);
  // a scan is known by its Drive id plus when it last changed: a file that's saved over (Scan.pdf scanned again) is read again
  const keyOf = f => f.id + '~' + String(f.modifiedTime || f.createdTime || '').replace(/[^0-9]/g, '');
  const fresh = ((await lr.json()).files || []).filter(f => !seen.has(keyOf(f)) && !(seen.has(f.id) && /hei[cf]/i.test(f.mimeType)));
  let added = 0, failed = 0, noFile = false, F = null;
  const writable = fresh.length ? await canFile(env, d.token, d.address) : false;
  // the staff site does the reading (it splits a big stack into a few pages at a time in the browser, so nothing here runs long):
  // each new scan is listed as waiting to be read, and the Inventory page reads it as soon as it's open
  for (const f of fresh.slice(0, max || 25)) {
    const big = +f.size > MAX_DRIVE_BYTES;
    await sb('inv_inbox_add_server', { p_key: key, p_file_id: keyOf(f), p_name: f.name, p_created: f.createdTime, p_status: big ? 'error' : 'waiting',
      p_invoice: big ? null : { pending: /hei[cf]/i.test(f.mimeType) ? 'heic' : 'scan', mime: f.mimeType, size: +f.size || 0, created: f.createdTime, lines: [] },
      p_error: big ? 'This scan is over 45 MB. In Image Capture set Resolution to 200 or 300 dpi and Kind to Grayscale, then scan again.' : '' });
    if (big) failed++; else added++;
  }
  noFile = fresh.length && !writable;
  await done(noFile ? 'To file scans into vendor folders, reconnect Google Drive (Change folder → Disconnect, then Connect Google Drive).' : '');
  return { ok: true, added, failed, more: Math.max(0, fresh.length - (max || 25)) };
}
