/* Eden staff site: Inventory → Scan invoice.
 *
 * Take a photo of a vendor invoice (or drop a PDF, or a CSV/Excel invoice download), and each line comes back
 * next to the inventory item it belongs to, with the old cost, the new cost per counting unit and the change.
 * Nothing changes until you tick the lines that are right and press Update prices.
 *
 * Photos and PDFs are read by Claude on the staff site's worker (invoice-worker.js, about 1–3¢ an invoice);
 * CSV and Excel files are read right here, no AI. Every line you confirm is remembered (vendor + item code, or
 * the description), with how many counting units are in one invoice unit, so the next invoice from that vendor
 * matches by itself. Each price that goes in is kept as price history.
 *
 * Data: inventory_invoices, inventory_item_links, inventory_prices (supabase/invoices.sql).
 */
(function () {
  'use strict';
  var SHEETJS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  var CAT_LABEL = { food: 'Food', paper: 'Paper goods', bev: 'Beverages' };
  var A = null;   // what the inventory page hands over: { items, saveItems, sb, status, done, modal, h, cat, uid }

  function h() { return A.h.apply(null, arguments); }
  function r2(n) { return Math.round((+n || 0) * 100) / 100; }
  function r4(n) { return Math.round((+n || 0) * 10000) / 10000; }
  function money(n) { return n == null || !isFinite(n) ? '—' : (n < 0 ? '−$' : '$') + Math.abs(r2(n)).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function cost(n) { if (n == null || !isFinite(n)) return '—'; var d = Math.abs(n) < 1 ? 3 : 2; return '$' + (+n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: d }); }
  function num(v) { if (v === '' || v == null) return null; var n = parseFloat(String(v).replace(/[$,\s]/g, '')); return isNaN(n) ? null : n; }
  function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function isMissing(e) { return e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message || '')); }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }

  /* ---------- units ---------- */
  var UNIT = { cs: 'case', case: 'case', cases: 'case', ea: 'each', each: 'each', pc: 'each', pcs: 'each', piece: 'each', ct: 'each', lb: 'lb', lbs: 'lb', pound: 'lb', pounds: 'lb',
    oz: 'oz', btl: 'bottle', bottle: 'bottle', bottles: 'bottle', bt: 'bottle', bu: 'bunch', bunch: 'bunch', bn: 'bunch', dz: 'dozen', doz: 'dozen', dozen: 'dozen',
    gal: 'gal', gallon: 'gal', qt: 'qt', quart: 'qt', keg: 'keg', bx: 'box', box: 'box', bag: 'bag', bg: 'bag', pk: 'pack', pack: 'pack', can: 'can', roll: 'roll', rl: 'roll', sleeve: 'sleeve', slv: 'sleeve' };
  function canon(u) { var k = norm(u).replace(/\s/g, ''); return UNIT[k] || UNIT[k.replace(/s$/, '')] || k; }
  function packCount(p) { var m = String(p || '').match(/^\s*(\d+(?:\.\d+)?)\s*(?:\/|x\b|×|-?ct\b|count\b|pk\b|pack\b|dz\b|doz|lbs?\b|#|ea\b|each\b)/i); return m ? +m[1] : null; }
  // counting units in one invoice unit: a case of 6/#10 cans counted by the can is 6; counted by the case, 1
  var BIG = /^(case|box|keg|bag|sleeve|pack)$/;
  var FEE = /deliver|fuel|freight|surcharge|deposit|shipping|service charge|handling|small order/i;
  function feesOf(inv) { return (inv.fees || []).filter(function (f) { return f && +f.amount; }); }
  function perCase(line) { return line.bottles_per_case || packCount(line.pack) || (/(\d+)\s*b\b/i.exec(line.description + ' ' + line.pack) || [])[1] * 1 || null; }
  // an item counted in cases but priced per bottle: the Units box shows bottles per case, and the cost is price × that
  function flipped(line, it) { return !!it && BIG.test(canon(it.unit)) && !BIG.test(canon(line.unit)) && !!canon(line.unit); }
  function guessPer(line, it) {
    var iu = canon(it.unit), lu = canon(line.unit);
    if (!iu || iu === lu) return 1;
    if (flipped(line, it)) return 1 / (packCount(it.pack) || perCase(line) || 12);
    if (BIG.test(iu)) return 1;
    if (lu === 'case' || lu === 'box' || lu === 'pack') return perCase(line) || packCount(it.pack) || 1;
    return 1;
  }
  // how the item is ordered, from the confirmed line: by the bottle or by the case (and how many in a case)
  function orderInfo(L, it) {
    if (!A.orderCols) return {};
    var u = canon(L.unit), o = {};
    if (L.cases && !L.bottles) o.order_unit = 'case'; else if (L.bottles && !L.cases) o.order_unit = 'bottle';
    else if (u === 'case' || u === 'bottle') o.order_unit = u;
    var pc = L.bottles_per_case || packCount(L.pack) || (it && (it.per_case || packCount(it.pack)));
    if (pc && pc > 1) o.per_case = pc;
    return o;
  }
  function qtyText(L) {   // "2 cs + 4 btl" when the invoice has Cases and Bottles columns
    var p = [];
    if (L.cases) p.push(L.cases + ' cs'); if (L.bottles) p.push(L.bottles + ' btl');
    var same = L.qty != null && ((canon(L.unit) === 'bottle' && !L.cases && L.qty === L.bottles) || (canon(L.unit) === 'case' && !L.bottles && L.qty === L.cases));
    return p.length ? p.join(' + ') + (L.qty != null && L.unit && !same ? ' (' + L.qty + ' ' + L.unit + ')' : '') : L.qty != null ? L.qty + (L.unit ? ' ' + L.unit : '') : '';
  }

  /* ---------- matching ---------- */
  var STOP = { the: 1, and: 1, of: 1, with: 1, case: 1, cs: 1, ea: 1, each: 1, lb: 1, lbs: 1, oz: 1, ct: 1, fresh: 1, pk: 1, pack: 1, ml: 1, gal: 1, qt: 1, bu: 1, dz: 1, btl: 1, bottle: 1, organic: 1, local: 1, nys: 1, ny: 1 };
  function toks(s) { return norm(s).split(' ').map(function (t) { return t.length > 3 ? t.replace(/(es|s)$/, '') : t; }).filter(function (t) { return t.length > 1 && !STOP[t] && !/^\d+[a-z]*$/.test(t); }); }
  function score(line, it, vendor) {
    var a = toks(line.description + ' ' + (line.pack || '')), b = toks(it.name);
    if (!a.length || !b.length) return 0;
    var hit = 0;
    b.forEach(function (t) { if (a.some(function (x) { return x === t || (Math.min(x.length, t.length) >= 4 && (x.indexOf(t) === 0 || t.indexOf(x) === 0)); })) hit++; });
    var s = (hit / b.length) * 0.75 + (hit / a.length) * 0.25;
    if (vendor && it.vendor && norm(it.vendor) && norm(vendor).indexOf(norm(it.vendor).split(' ')[0]) !== -1) s += 0.1;
    return s;
  }
  function lineKey(line) { return line.code ? 'code:' + norm(line.code) : 'desc:' + norm(line.description); }
  function vendorKey(v) { return norm(v); }
  function match(inv, links) {
    var vk = vendorKey(inv.vendor), byKey = {};
    links.forEach(function (l) { byKey[l.vendor_key + '|' + l.line_key] = l; });
    var items = A.items.filter(function (it) { return it.active !== false; });
    inv.lines.forEach(function (L) {
      var link = byKey[vk + '|' + lineKey(L)] || (L.code ? byKey[vk + '|desc:' + norm(L.description)] : null);
      var it = link && items.filter(function (x) { return x.id === link.item_id; })[0];
      if (it) { L.item = it.id; L.per = +link.per_unit || 1; L.how = 'remembered'; L.use = true; return; }
      var best = null, bs = 0;
      items.forEach(function (x) { var s = score(L, x, inv.vendor); if (s > bs) { bs = s; best = x; } });
      if (best && bs >= 0.5) { L.item = best.id; L.per = guessPer(L, best); L.how = 'suggested'; L.use = false; }
      else { L.item = ''; L.per = 1; L.how = ''; L.use = false; }
    });
  }

  /* ---------- reading the file ---------- */
  function b64(file) { return new Promise(function (res, rej) { var r = new FileReader(); r.onload = function () { res(String(r.result).split(',')[1]); }; r.onerror = rej; r.readAsDataURL(file); }); }
  var HEIC = 'js/vendor/heic2any-0.0.4.min.js';   // MIT, github.com/alexcorvi/heic2any: only loaded for an iPhone HEIC photo the browser can't open itself
  function isHeic(f) { return /hei[cf]/i.test(f.type || '') || /\.hei[cf]$/i.test(f.name || ''); }
  function toJpeg(blob) {   // HEIC → JPEG for browsers without HEIC support (Chrome, Firefox, Windows)
    return (window.heic2any ? Promise.resolve() : loadScript(HEIC)).then(function () {
      return window.heic2any({ blob: blob, toType: 'image/jpeg', quality: 0.9 });
    }).then(function (out) { return Array.isArray(out) ? out[0] : out; });
  }
  function shrink(file, converted) {   // photos: at most 2000 px on the long side, as JPEG (Safari opens iPhone HEIC itself; other browsers convert it first)
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var M = 2000, w = img.naturalWidth, hh = img.naturalHeight, k = Math.min(1, M / Math.max(w, hh));
        var c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(hh * k);
        var g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); res({ type: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.85).split(',')[1] });
      };
      img.onerror = function () {
        URL.revokeObjectURL(url);
        if (!converted && isHeic(file)) toJpeg(file).then(function (j) { return shrink(j, true); }).then(res, function () { rej(new Error('That HEIC photo couldn’t be converted. On the iPhone, take the photo from Scan invoice instead, or export it as JPG.')); });
        else rej(new Error('That photo couldn’t be opened. Try a JPG, PNG, HEIC or PDF.'));
      };
      img.src = url;
    });
  }
  function readAI(files, partsIn) {
    var parts = partsIn ? partsIn.map(function (p) { return Promise.resolve(p); }) : files.map(function (f) {
      if (/pdf$/i.test(f.type) || /\.pdf$/i.test(f.name)) {
        if (f.size > 18 * 1024 * 1024) return Promise.reject(new Error('That PDF is over 18 MB. Save a smaller copy or photograph the pages.'));
        return b64(f).then(function (d) { return { type: 'application/pdf', data: d }; });
      }
      return shrink(f);
    });
    return Promise.all(parts).then(function (list) {
      return A.sb.auth.getSession().then(function (x) {
        var jwt = x && x.data && x.data.session && x.data.session.access_token || '';
        return fetch('inventory/read', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify({ files: list }) });
      });
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok || !j.ok) throw new Error(j.message || 'The invoice couldn’t be read. Try again.');
        var list = j.invoices && j.invoices.length ? j.invoices : [j.invoice];   // a stack of several invoices comes back as several
        var src = (files.some(function (f) { return /pdf/i.test(f.type); }) ? 'pdf: ' : 'photo: ') + files.map(function (f) { return f.name; }).join(', ');
        list.forEach(function (inv, i) { inv.source = src + (list.length > 1 ? ' (invoice ' + (i + 1) + ' of ' + list.length + ')' : ''); });
        return list;
      });
    }, function (e) { throw e instanceof TypeError ? new Error('Couldn’t reach the staff site. Check your connection.') : e; });
  }
  function parseCsv(text) {
    var rows = [], row = [], cell = '', q = false;
    for (var i = 0; i < text.length; i++) {
      var c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; }
      else if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; } else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; } else cell += c;
    }
    if (cell || row.length) { row.push(cell); rows.push(row); }
    return rows;
  }
  function readSheet(file) {   // a vendor's CSV/Excel invoice download: find the header row, then read the lines (no AI)
    var csv = /\.csv$/i.test(file.name) || /csv/.test(file.type);
    var rowsP = csv ? file.text().then(parseCsv) : (window.XLSX ? Promise.resolve() : loadScript(SHEETJS)).then(function () {
      return file.arrayBuffer().then(function (buf) { var wb = window.XLSX.read(buf, { type: 'array' }); return window.XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' }); });
    });
    return rowsP.then(function (rows) {
      var hi = -1, col = {};
      var find = function (r, re, not) { return r.findIndex(function (c, i) { return re.test(c) && !(not && not.test(c)) && Object.keys(col).every(function (k) { return col[k] !== i; }); }); };
      for (var i = 0; i < Math.min(rows.length, 25) && hi < 0; i++) {
        var r = rows[i].map(function (c) { return String(c).toLowerCase().trim(); });
        col = {};
        col.code = find(r, /(item|product|vendor|mfr|supc)\s*(#|no\.?|num|number|code)|^sku$|^code$|^item #$|^upc$/);
        col.desc = find(r, /desc/); if (col.desc < 0) col.desc = find(r, /product name|item name|^product$|^item$|^name$|^wine$|^brand$/);
        if (col.code < 0) col.code = find(r, /^(item|product|sku|code)$/);
        col.ext = find(r, /ext|amount|line total|^total$|extension/);
        col.price = find(r, /net bottle|bottle price|net price|unit price|case price|^price|^each$|unit cost|^cost$|^rate$|price/, /ext|total/);
        col.qty = find(r, /qty|quantity|shipped|^ship|^cases$|^count$/, /order/);
        if (col.qty < 0) col.qty = find(r, /qty|quantity/);
        col.cases = find(r, /^(cases?|cs|case qty|qty cs)$/);
        col.btls = find(r, /^(btls?|bottles?|bottle qty|qty btl|loose)$/);
        if (col.qty < 0 && col.cases >= 0) { col.qty = col.cases; col.cases = -1; }
        col.pack = find(r, /pack|size|^uom desc/);
        col.unit = find(r, /^(uom|unit|u\/m|um|unit of measure)$/);
        col.vendor = find(r, /vendor|supplier|distributor/);
        if (col.desc >= 0 && (col.price >= 0 || col.ext >= 0)) hi = i;
      }
      var hdr = hi >= 0 ? rows[hi].map(function (c) { return String(c).toLowerCase().trim(); }) : [];
      if (hi < 0) throw new Error('Couldn’t find the item and price columns in ' + file.name + '. Take a photo or use the PDF instead.');
      var g = function (r, k) { return col[k] >= 0 ? String(r[col[k]] == null ? '' : r[col[k]]).trim() : ''; };
      var lines = [], fees = [], vendor = '';
      rows.slice(hi + 1).forEach(function (r) {
        var d = g(r, 'desc'); if (!d || /^(sub)?total|^tax/i.test(d)) return;
        if (FEE.test(d)) { var fa = num(g(r, 'ext')) != null ? num(g(r, 'ext')) : num(g(r, 'price')); if (fa) fees.push({ description: d, amount: fa }); return; }
        var qty = num(g(r, 'qty')), price = num(g(r, 'price')), ext = num(g(r, 'ext'));
        var cs = col.cases >= 0 ? num(g(r, 'cases')) : (col.btls >= 0 ? qty : null), bt = col.btls >= 0 ? num(g(r, 'btls')) : null, perB = /bottle|btl|each|unit/.test(hdr[col.price] || '');
        var bpc = packCount(g(r, 'pack'));
        if (bt != null) { qty = perB ? (cs || 0) * (bpc || 12) + (bt || 0) : (cs || 0) + (bt || 0) / (bpc || 12); }
        if (!qty && !ext) return;
        if (price == null && ext != null && qty) price = r4(ext / qty);
        if (price == null) return;
        if (!vendor) vendor = g(r, 'vendor');
        lines.push({ cases: bt != null ? cs : null, bottles: bt, bottles_per_case: bpc, code: g(r, 'code'), description: d, pack: g(r, 'pack'), qty: qty, unit: g(r, 'unit') || (bt != null && perB ? 'bottle' : 'case'), unit_price: price, extended: ext != null ? ext : qty != null ? r2(qty * price) : null, note: '' });
      });
      if (!lines.length) throw new Error('No item lines found in ' + file.name + '.');
      return { vendor: vendor, invoice_no: '', date: '', total: null, lines: lines, fees: fees, source: 'csv: ' + file.name };
    });
  }

  /* ---------- 1. pick the invoice ---------- */
  function open(api) {
    A = api;
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var input = h('input', { type: 'file', accept: 'image/*,.heic,.heif,.pdf,application/pdf,.csv,.xlsx,.xls', multiple: true });
    var m = A.modal('Scan an invoice', [
      h('p', { cls: 'sc-sub', text: 'Take a photo of the invoice (several photos for a long one, in page order), or choose a PDF, or a CSV/Excel invoice from the vendor’s website. You’ll check every line before any price changes.' }),
      h('label', { cls: 'ed-btn sc-file is-scan-pick' }, ['Take a photo or choose a file', input]),
      msg
    ], [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { m.close(); } } })]);
    input.addEventListener('change', function () {
      var files = [].slice.call(input.files || []); input.value = ''; if (!files.length) return;
      var sheet = files.filter(function (f) { return /\.(csv|xlsx|xls)$/i.test(f.name); })[0];
      msg.className = 'sc-msg is-info'; msg.textContent = sheet ? 'Reading ' + sheet.name + '…' : 'Reading the invoice… this takes about 20–40 seconds.';
      m.el.querySelector('.is-scan-pick').classList.add('is-busy');
      Promise.all([sheet ? readSheet(sheet).then(function (x) { return [x]; }) : readAI(files), loadLinks()]).then(function (res) {
        m.close(); reviewAll(res[0], res[1]);
      }, function (e) {
        m.el.querySelector('.is-scan-pick').classList.remove('is-busy');
        msg.className = 'sc-msg err'; msg.textContent = e.message || 'Something went wrong. Try again.';
      });
    });
  }
  function loadLinks() {
    return A.sb.from('inventory_item_links').select('*').then(function (r) {
      if (r.error) throw new Error(isMissing(r.error) ? 'One-time setup: in Supabase, open SQL Editor → New query, paste supabase/invoices.sql from the eden-admin repository and click Run. Then try again.' : 'Couldn’t load the inventory. Check your connection.');
      return r.data || [];
    });
  }

  /* ---------- 2. check each line ---------- */
  function itemSelect(L, onChange) {
    var sel = h('select', { cls: 'is-item', 'aria-label': 'Inventory item for ' + L.description });
    sel.appendChild(h('option', { value: '', text: '— Not in inventory (skip) —' }));
    sel.appendChild(h('option', { value: '__new', text: '+ Add as a new item' }));
    ['food', 'paper', 'bev'].forEach(function (c) {
      var list = A.items.filter(function (it) { return it.category === c && it.active !== false; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
      if (!list.length) return;
      var og = h('optgroup', { label: CAT_LABEL[c] });
      list.forEach(function (it) { og.appendChild(h('option', { value: it.id, text: it.name + (it.unit ? ' (' + it.unit + ')' : '') + (it.vendor ? ' · ' + it.vendor : '') })); });
      sel.appendChild(og);
    });
    sel.value = L.item || '';
    sel.addEventListener('change', function () { onChange(sel.value); });
    return sel;
  }
  // several invoices from one upload: check them one after another
  function reviewAll(list, links) {
    var i = 0;
    (function next() {
      if (i >= list.length) return;
      var inv = list[i++];
      review(inv, links, { step: list.length > 1 ? i + ' of ' + list.length : '', after: function () { setTimeout(next, 300); }, onCancel: list.length > 1 && i < list.length ? function () { setTimeout(next, 300); } : null });
    })();
  }
  function review(inv, links, opts) {
    opts = opts || {}; var savedId = null;
    inv.fees = feesOf(inv);
    inv.lines = (inv.lines || []).filter(function (l) {
      if (FEE.test(l.description) && !l.code) { var a = l.extended != null ? l.extended : l.unit_price; if (+a) inv.fees.push({ description: l.description, amount: +a }); return false; }
      return l.unit_price != null && !(!+l.unit_price && !+l.extended);   // no price, or nothing shipped
    });
    match(inv, links);
    var f = {
      vendor: h('input', { type: 'text', value: inv.vendor || '', placeholder: 'Who is this invoice from?' }),
      no: h('input', { type: 'text', value: inv.invoice_no || '', placeholder: 'Optional' }),
      date: h('input', { type: 'date', value: /^\d{4}-\d\d-\d\d$/.test(inv.date || '') ? inv.date : (function (d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); })(new Date()) })
    };
    var tbody = h('tbody'), msg = h('p', { cls: 'sc-msg', role: 'status' }), sumNote = h('p', { cls: 'sc-small is-sum' });
    var applyBtn = h('button', { type: 'button', cls: 'ed-btn', text: 'Update prices', on: { click: apply } });
    var item = function (id) { return A.items.filter(function (x) { return x.id === id; })[0]; };

    function newCost(L) { return L.per ? r4(L.unit_price / L.per) : null; }
    function paintRow(L) {
      var tr = L.tr; tr.innerHTML = '';
      var it = L.item && L.item !== '__new' ? item(L.item) : null, isNew = L.item === '__new';
      var nc = L.costOver != null ? L.costOver : newCost(L);
      var old = it && it.cost != null ? +it.cost : null, ch = old && nc != null ? (nc - old) / old : null;
      var use = h('input', { type: 'checkbox', checked: !!L.use && !!L.item, disabled: !L.item, 'aria-label': 'Use this line' });
      use.addEventListener('change', function () { L.use = use.checked; tr.classList.toggle('is-on', L.use); count(); });
      var flip = flipped(L, it) || (L.per > 0 && L.per < 1);
      var per = h('input', { type: 'text', inputmode: 'decimal', cls: 'is-per', value: String(flip ? Math.round(1 / L.per * 100) / 100 : L.per), disabled: !L.item, 'aria-label': flip ? 'Invoice units in one counting unit' : 'Counting units per invoice unit' });
      per.addEventListener('change', function () { var v = num(per.value); if (v > 0) { L.per = flip ? 1 / v : v; L.costOver = null; } paintRow(L); });
      var nci = h('input', { type: 'text', inputmode: 'decimal', cls: 'is-cost', value: nc == null ? '' : String(nc), disabled: !L.item, 'aria-label': 'New cost per counting unit' });
      nci.addEventListener('change', function () { var v = num(nci.value); L.costOver = v; paintRow(L); });
      var unitName = isNew ? (canon(L.unit) || 'unit') : it ? (it.unit || 'unit') : '';
      var big = ch != null && Math.abs(ch) >= 0.5;
      tr.className = 'is-row' + (L.use && L.item ? ' is-on' : '') + (big ? ' is-big' : '');
      tr.appendChild(h('td', { cls: 'is-use' }, use));
      tr.appendChild(h('td', { cls: 'is-line' }, [
        h('b', { text: L.description }),
        h('span', { cls: 'is-meta', text: [L.code ? '#' + L.code : '', L.pack, qtyText(L), money(L.unit_price) + (L.unit ? ' / ' + L.unit : ''), L.extended != null ? '= ' + money(L.extended) : ''].filter(Boolean).join(' · ') }),
        L.note ? h('span', { cls: 'is-note', text: L.note }) : null
      ]));
      tr.appendChild(h('td', { cls: 'is-it' }, [itemSelect(L, function (v) {
        L.item = v; L.costOver = null; L.how = v ? 'picked' : '';
        var x = v && v !== '__new' ? item(v) : null; L.per = x ? guessPer(L, x) : 1; L.use = !!v; paintRow(L); count();
      }), L.how === 'remembered' ? h('span', { cls: 'is-tag ok', text: 'Remembered from a past invoice' }) : L.how === 'suggested' ? h('span', { cls: 'is-tag', text: 'Suggested: tick if it’s right' }) : null]));
      tr.appendChild(h('td', { cls: 'is-conv' }, L.item ? [per, h('span', { cls: 'is-u', text: flip ? (L.unit || 'invoice unit') + ' per ' + unitName : unitName + ' per ' + (L.unit || 'invoice unit') })] : null));
      tr.appendChild(h('td', { cls: 'is-new' }, L.item ? [nci, h('span', { cls: 'is-u', text: 'per ' + unitName })] : null));
      tr.appendChild(h('td', { cls: 'is-old' }, it ? [h('span', { text: old == null ? 'No cost yet' : cost(old) }),
        ch != null ? h('span', { cls: 'is-ch ' + (ch > 0.005 ? 'up' : ch < -0.005 ? 'down' : ''), text: (ch > 0 ? '+' : '') + Math.round(ch * 100) + '%' }) : null,
        big ? h('span', { cls: 'is-note', text: 'Big change: check the units' }) : null] : isNew ? h('span', { cls: 'is-u', text: 'New item' }) : null));
    }
    function count() {
      var n = inv.lines.filter(function (L) { return L.use && L.item; }).length;
      applyBtn.textContent = n ? 'Update ' + n + ' price' + (n === 1 ? '' : 's') : 'Update prices'; applyBtn.disabled = !n;
    }
    inv.lines.forEach(function (L) { L.tr = h('tr'); tbody.appendChild(L.tr); paintRow(L); });
    var ext = r2(inv.lines.reduce(function (a, L) { return a + (+L.extended || 0); }, 0));
    var feeSum = r2(inv.fees.reduce(function (a, f) { return a + (+f.amount || 0); }, 0)), all = r2(ext + feeSum);
    sumNote.textContent = inv.lines.length + ' line' + (inv.lines.length === 1 ? '' : 's') + ' adding up to ' + money(ext) +
      (inv.fees.length ? ', plus ' + inv.fees.map(function (f) { return f.description + ' ' + money(f.amount); }).join(', ') + ' = ' + money(all) : '') +
      (inv.total != null ? (Math.abs(all - inv.total) > 0.05 ? '. The invoice total is ' + money(inv.total) + ' (taxes or a missed line?).' : ', the same as the invoice total.') : '.');
    var sugg = inv.lines.filter(function (L) { return L.how === 'suggested'; }).length;
    var tickAll = sugg ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Tick all suggested (' + sugg + ')', on: { click: function () { inv.lines.forEach(function (L) { if (L.how === 'suggested') { L.use = true; paintRow(L); } }); count(); } } }) : null;

    var m = A.modal('Check the invoice lines' + (opts.step ? ' · invoice ' + opts.step : ''), [
      inv.filed && inv.filed.link ? h('p', { cls: 'sc-small is-filed' }, ['Filed in Google Drive: Eden Invoices → Filed → ' + inv.filed.folder + (inv.filed.made ? ' (new folder)' : '') + ' → ', h('a', { href: inv.filed.link, target: '_blank', rel: 'noopener', text: inv.filed.name })]) : inv.filed && inv.filed.note ? h('p', { cls: 'sc-small', text: inv.filed.note + '.' }) : null,
      h('div', { cls: 'sc-row3 is-head' }, [lbl('Vendor', f.vendor), lbl('Invoice #', f.no), lbl('Date', f.date)]),
      h('p', { cls: 'sc-small', text: 'Tick each line that’s matched to the right inventory item. Check the units: the new cost is the invoice price ÷ how many of the item’s counting units come in one invoice unit. Lines you tick are remembered for next time.' }),
      sumNote,
      h('div', { cls: 'is-wrap' }, h('table', { cls: 'is-table' }, [h('thead', null, h('tr', null, ['Use', 'Invoice line', 'Inventory item', 'Units', 'New cost', 'Was'].map(function (t) { return h('th', { text: t }); }))), tbody])),
      msg
    ], [tickAll, h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: opts.onCancel ? 'Skip to the next invoice' : 'Cancel', on: { click: function () { m.close(); if (opts.onCancel) opts.onCancel(); } } }), applyBtn], true);
    m.el.classList.add('is-scan');
    count();

    function apply() {
      var vendor = f.vendor.value.trim();
      if (!vendor) { msg.className = 'sc-msg err'; msg.textContent = 'Type who the invoice is from, so the lines can be remembered.'; f.vendor.focus(); return; }
      var use = inv.lines.filter(function (L) { return L.use && L.item; });
      var bad = use.filter(function (L) { var c = L.costOver != null ? L.costOver : newCost(L); return c == null || !isFinite(c); });
      if (bad.length) { msg.className = 'sc-msg err'; msg.textContent = 'Fix the cost on: ' + bad.map(function (L) { return L.description; }).join(', '); return; }
      applyBtn.disabled = true; msg.className = 'sc-msg is-info'; msg.textContent = 'Saving…';
      var date = f.date.value || null, changed = {}, adds = [], hist = [], linkRows = {};
      var cats = {}; use.forEach(function (L) { var x = item(L.item); if (x) cats[x.category] = (cats[x.category] || 0) + 1; });
      var newCat = Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; })[0] || A.cat;   // new items join the inventory the rest of the invoice is in
      use.forEach(function (L) {
        var c = r4(L.costOver != null ? L.costOver : newCost(L)), it;
        if (L.item === '__new') {
          it = Object.assign({ id: A.uid(), category: newCat, section: '', name: L.description, unit: canon(L.unit), pack: L.pack || '', vendor: vendor, par: null, cost: c, sort: 0 }, orderInfo(L, null));
          adds.push(it); L.item = it.id; L.old = null;
        } else {
          it = item(L.item); L.old = it.cost == null ? null : +it.cost;
          changed[it.id] = Object.assign({}, changed[it.id] || it, { cost: c, vendor: it.vendor || vendor }, orderInfo(L, it));
        }
        L.newCost = c;
        linkRows[vendorKey(vendor) + '|' + lineKey(L)] = { vendor_key: vendorKey(vendor), line_key: lineKey(L), item_id: it.id, per_unit: L.per, updated_at: new Date().toISOString() };
      });
      var upd = Object.keys(changed).map(function (k) { return changed[k]; });
      var clean = function (L) { return { code: L.code, description: L.description, pack: L.pack, cases: L.cases, bottles: L.bottles, qty: L.qty, unit: L.unit, unit_price: L.unit_price, extended: L.extended, note: L.note || '', item_id: L.use ? L.item : null, per_unit: L.use ? L.per : null, new_cost: L.use ? L.newCost : null }; };
      A.sb.auth.getSession().then(function (x) {
        var who = (x && x.data && x.data.session && x.data.session.user && x.data.session.user.email) || '';
        var row = { vendor: vendor, invoice_no: f.no.value.trim(), invoice_date: date, total: inv.total == null ? null : inv.total, lines: inv.lines.map(clean), source: inv.source || '', created_by: who };
        var withFees = Object.assign({ fees: inv.fees, fees_total: feeSum, lines_total: ext }, row);
        return A.sb.from('inventory_invoices').insert(withFees).select('id').single().then(function (r) {
          if (r.error && /fees|lines_total|column/i.test(r.error.message || '') && r.error.code !== '42501') return A.sb.from('inventory_invoices').insert(row).select('id').single();   // invoice-vendors.sql not run yet
          return r;
        });
      }).then(function (r) {
        if (r.error) throw r.error;
        var invId = savedId = r.data.id;
        return A.saveItems(adds.concat(upd)).then(function () {
          use.forEach(function (L) { hist.push({ item_id: L.item, invoice_id: invId, price_date: date || undefined, vendor: vendor, invoice_line: L.description, invoice_price: L.unit_price, invoice_unit: L.unit || '', per_unit: L.per, unit_cost: L.newCost, old_cost: L.old }); });
          return Promise.all([
            A.sb.from('inventory_prices').insert(hist),
            A.sb.from('inventory_item_links').upsert(Object.keys(linkRows).map(function (k) { return linkRows[k]; }), { onConflict: 'vendor_key,line_key' })
          ]);
        });
      }).then(function (res) {
        adds.forEach(function (it) { A.items.push(it); });
        upd.forEach(function (n) { var it = item(n.id); if (it) Object.assign(it, n); });
        var warn = res.some(function (x) { return x && x.error; });
        m.close();
        A.status('Updated ' + use.length + ' price' + (use.length === 1 ? '' : 's') + ' from ' + vendor + (f.no.value.trim() ? ' invoice ' + f.no.value.trim() : '') + '.' + (warn ? ' (Price history or matching memory didn’t save.)' : ''), warn ? 'err' : 'ok');
        if (opts.after) opts.after(savedId);
        A.done();
      }).catch(function (e) {
        applyBtn.disabled = false; msg.className = 'sc-msg err';
        msg.textContent = isMissing(e) ? 'One-time setup: run supabase/invoices.sql in Supabase first.' : (e && /security|permission/i.test(e.message || '')) ? 'Your role can’t change the inventory.' : 'Couldn’t save. Check your connection and try again.';
      });
    }
  }
  function lbl(text, input) { return h('label', { cls: 'sc-f' }, [h('span', { text: text }), input]); }


  /* ---------- the scanner's Google Drive folder: scans waiting to be checked ---------- */
  var D = { st: null, inbox: [], at: 0, missing: false, busy: false };
  function post(path, body) {
    return A.sb.auth.getSession().then(function (x) {
      var jwt = x && x.data && x.data.session && x.data.session.access_token || '';
      return fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify(body || {}) });
    }).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { j._ok = r.ok; return j; }); }, function () { return { _ok: false, message: 'Couldn’t reach the staff site. Check your connection.' }; });
  }
  function ago(t) {
    if (!t) return 'not yet';
    var m = Math.round((Date.now() - new Date(t).getTime()) / 60000);
    return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : m < 1440 ? Math.round(m / 60) + ' h ago' : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }
  function loadBar() {
    return Promise.all([
      A.sb.rpc('inv_drive_status'),
      A.sb.from('inventory_inbox').select('id,file_id,file_name,file_created,status,invoice,error,created_at').in('status', ['waiting', 'error']).order('created_at', { ascending: false }).limit(40)
    ]).then(function (res) {
      D.at = Date.now();
      if (res[0].error) { D.missing = true; D.st = null; return; }
      D.missing = false; D.st = res[0].data || null; D.inbox = res[1].error ? [] : res[1].data || [];
    }, function () { D.at = Date.now(); });
  }
  function bar(api) {
    A = api;
    var el = h('div', { cls: 'is-bar', hidden: true });
    var paint = function () { paintBar(el, paint); };
    if (D.at) paint();
    if (Date.now() - D.at > 60000) loadBar().then(paint);
    return el;
  }
  function paintBar(el, again) {
    var st = D.st; el.innerHTML = '';
    if (D.missing || !st || st.error) { el.hidden = true; return; }
    if (!st.address) {
      if (!st.can_change) { el.hidden = true; return; }
      el.hidden = false;
      el.appendChild(h('div', { cls: 'is-bar-h' }, [h('div', null, [h('b', { text: 'Scanner' }), h('span', { text: 'Scans saved into a Google Drive folder show up here, read and ready to check.' })]),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Connect Google Drive', on: { click: connect } })]));
      return;
    }
    el.hidden = false;
    var waiting = D.inbox.filter(function (x) { return x.status === 'waiting'; }), bad = D.inbox.filter(function (x) { return x.status === 'error'; });
    var line = st.status === 'reconnect' ? 'Google Drive needs to be connected again.' : !st.folder ? 'No folder picked yet.' :
      'Folder “' + st.folder + '” · checked ' + ago(st.last_check) + (st.last_error ? ' · ' + st.last_error : '');
    var check = h('button', { type: 'button', cls: 'ed-btn small', text: D.busy ? 'Checking…' : 'Check now', disabled: D.busy || !st.folder, on: { click: function () {
      D.busy = true; again();
      post('drive/check').then(function (j) {
        D.busy = false;
        if (!j._ok) A.status(j.message || 'Couldn’t check the folder.', 'err');
        else A.status(j.added || j.failed ? (j.added ? j.added + ' new invoice' + (j.added === 1 ? '' : 's') + ' ready to check.' : '') + (j.failed ? ' ' + j.failed + ' couldn’t be read.' : '') + (j.more ? ' ' + j.more + ' more on the next check.' : '') : 'No new scans.', 'ok');
        return loadBar();
      }).then(again);
    } } });
    var tools = [check];
    if (st.can_change) {
      if (st.status === 'reconnect') tools.unshift(h('button', { type: 'button', cls: 'ed-btn small', text: 'Reconnect', on: { click: connect } }));
      tools.push(h('button', { type: 'button', cls: 'ed-btn small', text: st.folder ? 'Change folder' : 'Find folder', on: { click: folderDialog } }));
    }
    el.appendChild(h('div', { cls: 'is-bar-h' }, [h('div', null, [h('b', { text: waiting.length ? waiting.length + ' scanned invoice' + (waiting.length === 1 ? '' : 's') + ' waiting' : 'Scanner' }), h('span', { text: line })]), h('div', { cls: 'is-bar-t' }, tools)]));
    if (!waiting.length && !bad.length) return;
    el.appendChild(h('ul', { cls: 'is-inbox' }, waiting.concat(bad).map(function (x) {
      var inv = x.invoice || {}, n = (inv.lines || []).length;
      var dismiss = h('button', { type: 'button', cls: 'ed-btn small', text: 'Dismiss', title: 'Remove from this list (the file stays in Google Drive)', on: { click: function () {
        A.sb.from('inventory_inbox').update({ status: 'dismissed', done_at: new Date().toISOString() }).eq('id', x.id).then(function () { D.inbox = D.inbox.filter(function (y) { return y.id !== x.id; }); again(); });
      } } });
      if (inv.pending) return h('li', null, [h('div', null, [h('b', { text: x.file_name }), h('span', { text: 'iPhone photo: read when you open it' })]),
        h('div', { cls: 'is-bar-t' }, [h('button', { type: 'button', cls: 'ed-btn small pr-accent', text: 'Read & check', on: { click: function () { openWaiting(x, again); } } }), dismiss])]);
      return h('li', { cls: x.status === 'error' ? 'is-bad' : '' }, [
        h('div', null, [h('b', { text: x.status === 'error' ? x.file_name : (inv.vendor || 'Unknown vendor') + (inv.invoice_no ? ' · #' + inv.invoice_no : '') }),
          h('span', { text: x.status === 'error' ? 'Couldn’t read it: ' + (x.error || 'unknown problem') : [inv.date, n + ' line' + (n === 1 ? '' : 's'), inv.total != null ? money(inv.total) : '', inv.filed && inv.filed.folder ? 'filed in ' + inv.filed.folder + (inv.filed.made ? ' (new folder)' : '') : x.file_name].filter(Boolean).join(' · ') })]),
        h('div', { cls: 'is-bar-t' }, [!(inv.filed && inv.filed.link) && !/#\d+$/.test(x.file_id || '') && !inv.pending ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Read again', title: 'Read this scan again (and file it in its vendor folder, if Google Drive allows it). A few cents.', on: { click: function () { readAgain(x, again); } } }) : null,
          inv.filed && inv.filed.link ? h('a', { cls: 'ed-btn small', href: inv.filed.link, target: '_blank', rel: 'noopener', text: 'PDF', title: 'Open the filed PDF in Google Drive' }) : null,
          x.status === 'waiting' ? h('button', { type: 'button', cls: 'ed-btn small pr-accent', text: 'Check lines', on: { click: function () { openWaiting(x, again); } } }) : null, dismiss])
      ]);
    })));
  }
  function readPending(x) {   // an iPhone HEIC photo saved in the scanner folder: download, convert to JPEG, read
    A.status('Converting and reading the photo… about 30 seconds.', 'dirty');
    return A.sb.auth.getSession().then(function (y) {
      var jwt = y && y.data && y.data.session && y.data.session.access_token || '';
      return fetch('drive/file', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + jwt }, body: JSON.stringify({ file_id: x.file_id }) });
    }).then(function (r) {
      if (!r.ok) return r.json().catch(function () { return {}; }).then(function (j) { throw new Error(j.message || 'Couldn’t download it from Google Drive.'); });
      return r.blob();
    }).then(function (blob) {
      var f = new File([blob], x.file_name || 'photo.heic', { type: (x.invoice && x.invoice.mime) || 'image/heic' });
      return shrink(f);
    }).then(function (part) { return readAI([{ name: x.file_name, type: 'image/jpeg' }], [part]); }).then(function (list) {
      var inv = list[0];
      x.invoice = inv; A.status('', '');
      A.sb.from('inventory_inbox').update({ invoice: inv }).eq('id', x.id).then(function () {});
      return inv;
    });
  }
  // forget this scan (and the other invoices split from it) so the next check reads and files it again
  function readAgain(x, again) {
    var base = String(x.file_id || '').replace(/#\d+$/, '');
    if (!base) return;
    A.status('Reading the scan again… a large stack can take a minute or two.', 'dirty');
    A.sb.from('inventory_inbox').delete().or('file_id.eq.' + base + ',file_id.like.' + base + '#*').then(function (r) {
      if (r.error) { A.status('Couldn’t reset it. Try again.', 'err'); return; }
      D.inbox = D.inbox.filter(function (y) { return String(y.file_id || '').replace(/#\d+$/, '') !== base; }); again();
      return post('drive/check').then(function (j) {
        A.status(!j._ok ? (j.message || 'Couldn’t check the folder.') : j.added ? j.added + ' invoice' + (j.added === 1 ? '' : 's') + ' ready to check.' : 'Nothing new found. If the scan was already filed, it’s in Filed now.', j._ok ? 'ok' : 'err');
        return loadBar();
      }).then(again);
    });
  }
  function openWaiting(x, again) {
    var ready = x.invoice && x.invoice.pending ? readPending(x) : Promise.resolve(x.invoice);
    ready.then(function () { return loadLinks(); }).then(function (links) {
      var inv = JSON.parse(JSON.stringify(x.invoice || {}));
      review(inv, links, { after: function (invId) {
        A.sb.from('inventory_inbox').update({ status: 'done', invoice_id: invId, done_at: new Date().toISOString() }).eq('id', x.id).then(function () {});
        D.inbox = D.inbox.filter(function (y) { return y.id !== x.id; }); again();
      } });
    }, function (e) { A.status(e.message, 'err'); });
  }
  function connect() {
    A.status('Opening Google…', 'dirty');
    post('drive/start').then(function (j) { if (j._ok && j.url) location.href = j.url; else A.status(j.message || 'Couldn’t start the Google sign-in.', 'err'); });
  }
  function folderDialog() {
    var name = h('input', { type: 'text', value: (D.st && D.st.folder) || 'Eden Invoices' }), msg = h('p', { cls: 'sc-msg', role: 'status' });
    var m = A.modal('Scanner folder', [
      h('p', { cls: 'sc-sub', text: 'The Google Drive folder your scanner saves into (connected as ' + D.st.address + '). New scans from the last 30 days are read, then each invoice is filed into Filed → its vendor’s folder (a stack is split into one PDF per invoice). Nothing is deleted.' }),
      lbl('Folder name in Google Drive', name), msg
    ], [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Disconnect', on: { click: function () {
      if (!confirm('Disconnect Google Drive? Scans waiting here stay; new scans won’t come in until you connect again.')) return;
      post('drive/remove').then(function () { m.close(); return loadBar(); }).then(function () { A.done(); });
    } } }), h('button', { type: 'button', cls: 'ed-btn', text: 'Find folder', on: { click: function () {
      msg.className = 'sc-msg is-info'; msg.textContent = 'Looking…';
      post('drive/folder', { name: name.value.trim() }).then(function (j) {
        if (!j._ok) { msg.className = 'sc-msg'; msg.textContent = j.message || 'Couldn’t look in Google Drive.'; return; }
        if (!j.folder) { msg.className = 'sc-msg'; msg.textContent = j.message; return; }
        m.close(); A.status('Scanner folder: ' + j.folder + '. New scans are checked every 5 minutes.', 'ok'); loadBar().then(function () { A.done(); });
      });
    } } })]);
  }
  // back from Google's sign-in: #inventory/drive?k=… or ?err=…
  function handleArg(api, arg) {
    A = api;
    var q = new URLSearchParams(String(arg || '').replace(/^drive\??/, ''));
    var err = q.get('err');
    if (err) { A.status({ denied: 'Google Drive wasn’t connected (permission not given).', scope: 'Allow access to your Google Drive files when Google asks, then connect again.', norefresh: 'Google didn’t give a lasting permission. Connect again.', driveapi: 'Turn on the Google Drive API in Google Cloud (APIs & Services → Library → Google Drive API → Enable), then connect again.', expired: 'That sign-in took too long. Connect again.' }[err] || 'Google sign-in didn’t work. Try again.', 'err'); return; }
    var k = q.get('k'); if (!k) return;
    A.status('Connecting Google Drive…', 'dirty');
    post('drive/finish', { k: k }).then(function (j) {
      if (!j._ok) { A.status(j.message || 'Couldn’t connect Google Drive.', 'err'); return; }
      A.status(j.folder ? 'Connected ' + j.address + '. Scanner folder: ' + j.folder + '. New scans are checked every 5 minutes.' : j.message, j.folder ? 'ok' : 'err');
      return loadBar().then(function () { A.done(); if (!j.folder) folderDialog(); });
    });
  }


  /* ---------- Vendors: spend and delivery charges, from the invoices put into the inventory ---------- */
  function vendors(api) {
    A = api;
    A.sb.from('inventory_invoices').select('*').order('invoice_date', { ascending: false }).limit(1000).then(function (r) {
      if (r.error) { A.status(isMissing(r.error) ? 'Run supabase/invoices.sql in Supabase first.' : 'Couldn’t load the invoices.', 'err'); return; }
      var by = {};
      (r.data || []).forEach(function (x) {
        var k = norm(x.vendor) || '(no vendor)', v = by[k] || (by[k] = { name: x.vendor || '(no vendor)', list: [], spend: 0, fees: 0, feeN: 0 });
        var fees = Array.isArray(x.fees) ? x.fees : [], fs = x.fees_total != null ? +x.fees_total : fees.reduce(function (a, f) { return a + (+f.amount || 0); }, 0);
        var lt = x.lines_total != null ? +x.lines_total : (x.lines || []).reduce(function (a, l) { return a + (+l.extended || 0); }, 0);
        v.list.push({ x: x, fees: fees, fs: r2(fs), lt: r2(lt) });
        v.spend += x.total != null ? +x.total : lt + fs; v.fees += fs; if (fs) v.feeN++;
      });
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.spend - a.spend; });
      var since = list.length ? list.reduce(function (m, v) { var d = v.list[v.list.length - 1].x.invoice_date; return !m || (d && d < m) ? d : m; }, '') : '';
      var body = [h('p', { cls: 'sc-sub', text: list.length ? 'From the invoices put into the inventory' + (since ? ' since ' + since : '') + '. Tap a vendor to see its invoices.' : 'No invoices yet. Scan an invoice and update its prices; it shows up here.' })];
      if (list.length) {
        var tb = h('tbody');
        list.forEach(function (v) {
          var avg = v.list.length ? v.fees / v.list.length : 0;
          var row = h('tr', { cls: 'is-vrow' }, [h('td', null, h('b', { text: v.name })), h('td', { cls: 'r', text: String(v.list.length) }), h('td', { cls: 'r', text: money(v.spend) }),
            h('td', { cls: 'r', text: money(v.fees) }), h('td', { cls: 'r', text: v.fees ? money(avg) : '—' }), h('td', { cls: 'r', text: v.spend ? Math.round(v.fees / v.spend * 1000) / 10 + '%' : '—' }), h('td', { text: v.list[0].x.invoice_date || '' })]);
          var det = h('tr', { cls: 'is-vdet', hidden: true }, h('td', { colspan: '7' }, h('table', { cls: 'is-vinv' }, [h('thead', null, h('tr', null, ['Date', 'Invoice #', 'Items', 'Delivery & fees', 'Total'].map(function (t) { return h('th', { text: t }); }))),
            h('tbody', null, v.list.map(function (o) { return h('tr', null, [h('td', { text: o.x.invoice_date || '' }), h('td', { text: o.x.invoice_no || '' }), h('td', { cls: 'r', text: money(o.lt) }),
              h('td', { cls: 'r', title: o.fees.map(function (f) { return f.description + ' ' + money(f.amount); }).join(', '), text: o.fs ? money(o.fs) + (o.fees.length ? ' (' + o.fees.map(function (f) { return f.description; }).join(', ') + ')' : '') : '—' }),
              h('td', { cls: 'r', text: o.x.total != null ? money(o.x.total) : money(o.lt + o.fs) })]); }))])));
          row.addEventListener('click', function () { det.hidden = !det.hidden; row.classList.toggle('open', !det.hidden); });
          tb.appendChild(row); tb.appendChild(det);
        });
        body.push(h('div', { cls: 'is-wrap' }, h('table', { cls: 'is-vtable' }, [h('thead', null, h('tr', null, ['Vendor', 'Invoices', 'Spent', 'Delivery & fees', 'Avg per invoice', 'Of spend', 'Last invoice'].map(function (t, i) { return h('th', { cls: i && i < 6 ? 'r' : '', text: t }); }))), tb])));
      }
      var m = A.modal('Vendors', body, [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn', text: 'Done', on: { click: function () { m.close(); } } })], true);
      m.el.classList.add('is-scan');
    });
  }
  window.EdenInvoiceScan = { open: open, vendors: vendors, bar: bar, handleArg: handleArg, _test: { match: match, guessPer: guessPer, canon: canon, score: score, readSheet: readSheet, review: function (api, inv, links) { A = api; review(inv, links); } } };
})();
