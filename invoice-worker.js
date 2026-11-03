// Inventory → Scan invoice: reads a photo or PDF of a vendor invoice with Claude and sends back its lines
// (item, vendor code, pack, quantity, unit, unit price) for the staff site to match to inventory items.
// Nothing is saved here: the person checks every line on the staff site before any price changes.
//
// Needs the ANTHROPIC_API_KEY secret (Workers > eden-admin > Settings > Variables and Secrets).
// Only people who can use the inventory (Owner, Managers, Kitchen) can call it.

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
  content.push({ type: 'text', text: PROMPT });

  let r, j;
  try {
    r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: env.INVOICE_MODEL || MODEL, max_tokens: 8000, tools: [TOOL], tool_choice: { type: 'tool', name: 'invoice' }, messages: [{ role: 'user', content }] })
    });
    j = await r.json();
  } catch (e) { return json({ error: 'ai', message: 'Couldn’t reach the invoice reader. Try again.' }, 502); }
  if (!r.ok) {
    const m = (j && j.error && j.error.message) || '';
    return json({ error: 'ai', message: r.status === 401 ? 'The ANTHROPIC_API_KEY secret isn’t valid.' : r.status === 429 ? 'Too many invoices at once. Wait a minute and try again.' : 'The invoice reader had a problem' + (m ? ': ' + m : '.') }, 502);
  }
  const use = (j.content || []).filter(x => x.type === 'tool_use')[0];
  if (!use || !use.input || !Array.isArray(use.input.lines)) return json({ error: 'read', message: 'Couldn’t read any lines on that invoice. Try a sharper, flatter photo.' }, 422);
  const inv = use.input;
  inv.lines = inv.lines.filter(l => l && String(l.description || '').trim()).map(l => ({
    code: String(l.code || '').trim(), description: String(l.description || '').trim(), pack: String(l.pack || '').trim(),
    qty: typeof l.qty === 'number' ? l.qty : null, unit: String(l.unit || '').trim(), unit_price: typeof l.unit_price === 'number' ? l.unit_price : null,
    extended: typeof l.extended === 'number' ? l.extended : null, note: String(l.note || '').trim()
  }));
  return json({ ok: true, invoice: inv, usage: j.usage || null });
}
