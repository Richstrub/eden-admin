
(function () {
'use strict';
/* =====================================================================================
   Setup. The Supabase "publishable" key is public (it's in the staff site's js/config.js).
   What a signed-in person can READ is decided by the database rules for their role.
   Changes are saved to the same database tables the site has always used (see SAVING near the end).
   ===================================================================================== */
var SUPA = { url: 'https://qmblccwyxbpvziiwrlne.supabase.co', key: 'sb_publishable_Nbp1K_Co8tDVB-jNjBRs3w_D40qm4Mg' };
var sb = window.supabase ? window.supabase.createClient(SUPA.url, SUPA.key) : null;

var S = {
  mode: null,          // 'live' | 'sample'
  user: null, role: 'owner', previewRole: null,
  data: {}, loaded: {},
  space: 'today', tab: {}, kind: 'food', sub: 'all', q: '', countDraft: {},
  showWhy: false
};

/* ---------- tiny helpers ---------- */
function h(tag, a, kids) {
  var e = document.createElement(tag);
  if (a) Object.keys(a).forEach(function (k) {
    var v = a[k]; if (v == null || v === false) return;
    if (k === 'cls') e.className = v; else if (k === 'text') e.textContent = v; else if (k === 'html') e.innerHTML = v;
    else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
    else if (k === 'style') e.setAttribute('style', v); else e.setAttribute(k, v === true ? '' : v);
  });
  (function flat(k) { return Array.isArray(k) ? k.reduce(function (a, x) { return a.concat(flat(x)); }, []) : k == null ? [] : [k]; })(kids).forEach(function (c) { if (c == null || c === false) return; e.appendChild(typeof c === 'string' || typeof c === 'number' ? document.createTextNode(String(c)) : c); });
  return e;
}
function money(v, d) { if (v == null || isNaN(v)) return '—'; var n = Math.abs(+v), s = n.toLocaleString(undefined, { minimumFractionDigits: d == null ? 2 : d, maximumFractionDigits: d == null ? 2 : d }); return (v < 0 ? '−$' : '$') + s; }
function qty(v) { if (v == null || v === '') return ''; v = +v; return (Math.round(v * 100) / 100).toString(); }
function iso(d) { d = d || new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
function pday(s) { var p = String(s).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function dshort(s) { return s ? pday(s).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—'; }
function dlong(s) { return s ? pday(s).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—'; }
function addDays(d, n) { var x = new Date(d); x.setDate(x.getDate() + n); return x; }
function norm(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
function uniq(a) { return a.filter(function (x, i) { return x && a.indexOf(x) === i; }); }
function toast(t) { var o = document.querySelector('.toast'); if (o) o.remove(); var e = h('div', { cls: 'toast', role: 'status', text: t }); document.body.appendChild(e); setTimeout(function () { e.remove(); }, 4200); }
function plural(n, w) { return n + ' ' + (n === 1 ? w : w === 'person' ? 'people' : w + 's'); }
function svg(path) { var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 24 24'); s.innerHTML = path; return s; }
var ICON2 = {
  wine: '<path d="M8 3h8l-.5 6a3.5 3.5 0 0 1-7 0z"/><path d="M12 12.5V20M8.5 20h7"/>',
  temp: '<path d="M10 14.5V5a2 2 0 0 1 4 0v9.5a4 4 0 1 1-4 0z"/><path d="M12 9v7"/>',
  cart: '<circle cx="9" cy="20" r="1.4"/><circle cx="17" cy="20" r="1.4"/><path d="M3 4h2.5l2.2 11h10.6l2-8H6.4"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  receipt: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  list: '<path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M8 3v4M16 3v4M3 10h18"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>'
};
var ICON = {
  today: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  service: '<path d="M3 18h18M5 18a7 7 0 0 1 14 0M12 8V6M10 6h4"/>',
  kitchen: '<path d="M4 21V10a8 8 0 0 1 16 0v11M4 15h16M9 21v-3M15 21v-3"/>',
  bar: '<path d="M5 4h14l-7 8z"/><path d="M12 12v8M8 20h8M15.5 4l2-2"/>',
  ordering: '<path d="M3 4h2l2.2 10.2a1 1 0 0 0 1 .8h8.6a1 1 0 0 0 1-.8L19.5 8H6.2"/><circle cx="9" cy="19" r="1.4"/><circle cx="16.5" cy="19" r="1.4"/>',
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  menu: '<path d="M5 3h11l3 3v15H5z"/><path d="M9 9h6M9 13h6M9 17h4"/>',
  team: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20a6 6 0 0 1 12 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2A5 5 0 0 1 21 19"/>',
  business: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  catering: '<path d="M3 17h18M5 17a7 7 0 0 1 14 0M12 10V8"/><path d="M4 20h16"/><circle cx="12" cy="6.5" r="1.3"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4M7.5 14h3M13.5 14h3M7.5 17h3"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>'
};

/* =====================================================================================
   The new layout: 6 places, each answering one question. Every old page has a home here.
   ===================================================================================== */
var SPACES = [
  { id: 'today', label: 'Today', hint: 'What needs me right now?', roles: ['owner', 'manager', 'kitchen', 'foh'],
    tabs: [['now', 'Today'], ['todo', 'To-do']] },
  { id: 'calendar', label: 'Calendar', hint: 'Events, meetings and who’s working — all on one grid', roles: ['owner', 'manager', 'kitchen', 'foh'],
    tabs: [['month', 'Month'], ['week', 'Week'], ['agenda', 'Coming up']] },
  { id: 'service', label: 'Service', hint: 'Running tonight', roles: ['owner', 'manager', 'foh', 'kitchen'],
    tabs: [['tonight', 'Tonight', 'Pre-shift, who’s on'], ['checklists', 'Checklists'], ['eod', 'End of day', null, ['owner', 'manager']], ['preshift', 'Pre-shift meeting'], ['resources', 'Resources']] },
  { id: 'catering', label: 'Catering & BEOs', hint: 'Inquiries, BEOs and private events', roles: ['owner', 'manager'],
    tabs: [['pipeline', 'Inquiries', 'New → questionnaire → BEO'], ['beos', 'Active BEOs'], ['past', 'Completed & declined'], ['tools', 'Questionnaires & BEO documents', 'The full inquiry page']] },
  { id: 'kitchen', label: 'Kitchen', hint: 'Food & dry goods, recipes, temperatures', roles: ['owner', 'manager', 'kitchen'],
    tabs: [['prep', 'Prep list', 'Today’s list'], ['receive', 'Receive', 'Invoices in'], ['items', 'Items', 'Prices & details'], ['reports', 'Reports'], ['sheet', 'Full sheet', 'Every column, as today'], ['recipes', 'Recipes'], ['temps', 'Temperatures'], ['count', 'Count', 'Take inventory']] },
  { id: 'bar', label: 'Bar', hint: 'Beer, wine, spirits & N/A — stock and builds', roles: ['owner', 'manager', 'foh'],
    tabs: [['prep', 'Bar prep', 'Today’s list'], ['receive', 'Receive', 'Invoices in'], ['items', 'Items', 'Prices & details'], ['reports', 'Reports'], ['sheet', 'Full sheet', 'Every column, as today'], ['builds', 'Cocktail builds'], ['count', 'Count', 'Take inventory']] },
  { id: 'ordering', label: 'Ordering', hint: 'The order list shared with the Hub, and what’s below par', roles: ['owner', 'manager', 'kitchen', 'foh'],
    tabs: [['list', 'Order list', 'Shared with the Hub'], ['kitchen', 'Kitchen · below par', null, ['owner', 'manager', 'kitchen']], ['bar', 'Bar · below par', null, ['owner', 'manager', 'foh']]] },
  { id: 'menu', label: 'Menu', hint: 'What guests see & what it costs', roles: ['owner', 'manager', 'foh', 'kitchen'],
    tabs: [['guest', 'Guest menu'], ['costs', 'Menu costs', null, ['owner', 'manager']], ['events', 'Supper Club & events']] },
  { id: 'team', label: 'Team', hint: 'People, schedule, pay', roles: ['owner', 'manager'],
    tabs: [['schedule', 'Schedule'], ['fullsched', 'Full schedule page'], ['people', 'People'], ['permissions', 'Permissions', null, ['owner']], ['timeoff', 'Time off'], ['reviews', 'Reviews']] },
  { id: 'business', label: 'Business', hint: 'Where the business stands', roles: ['owner'],
    tabs: [['overview', 'Overview'], ['sales', 'Sales'], ['costs', 'Costs'], ['labor', 'Labor'], ['products', 'Product sales'], ['payroll', 'Payroll'], ['marketing', 'Promotional emails'], ['website', 'Website & history'], ['partners', 'Partner stories'], ['email', 'Business email']] }
];
var WHY = {
  today: 'The old Today page listed things; this one is a <b>to-do list that clears itself</b>. Everything here links straight to the place you fix it, and disappears once it’s done. One place to start every shift.',
  calendar: '<b>One calendar for everything that happens on a date</b>: private events, Supper Clubs, meetings and tastings, catering inquiries still being decided, who’s working and when, time off, covers, to-dos and holidays. Each kind is a layer you can switch off. Month shows the whole month with a weekly total of hours, wages, events and guests; Week shows each day hour by hour with staff coverage beside the events; Coming up lists the next eight weeks day by day. A red or gold “!” marks a clash — someone scheduled on a day they asked off, a big party with a thin floor, an event on a closed day. Tap any day for everything about it.',
  catering: '<b>Private events and catering get their own place</b>, because they’re their own business: an inquiry comes in, the questionnaire goes out and comes back, it becomes a BEO, the event happens. The board shows those steps left to right, the same steps as the live Inquiries page. Every card shows what else is on that date and whether Eden is normally open, so you see clashes before you say yes. Once it’s an Active BEO it goes on the calendar on its own. Owners and managers only.',
  service: '<b>Everything for running a night in one place</b>, in the order a night happens: pre-shift → checklists → end of day. Catering and the calendar each got their own place.',
  kitchen: 'The old inventory sheet had 18 columns doing six jobs at once. Kitchen opens on the <b>prep list</b> — the first thing a cook needs — then food and dry goods inventory, recipes and temperatures; beverages moved to their own place, Bar. Here <b>each job gets its own tab</b>: Count shows only what you need to count; Items holds prices and details; Order and Receive are their own steps. Food / Dry goods is a switch at the top.',
  bar: '<b>The bar gets its own place</b>, so the people who run it see only beer, wine, spirits and N/A: their own count, order list, invoices, items and reports, plus the bar prep list and cocktail builds. Beer / Wine / Liquor / N/A is a switch at the top. Wine vintages, cost per fl oz and pour costs live here.',
  menu: '<b>The menu and what it costs live together</b>, so a price change and its cost % are one click apart. Recipes live in Kitchen and cocktail builds in Bar, where they’re made.',
  team: '<b>People things in one place</b>: the schedule, the roster, time-off requests and reviews. Pay moved to Business (owner only), so managers never see a tab they can’t open.',
  business: '<b>Overview answers “how are we doing?” in one screen</b>: sales, labor, purchases, prime cost and guests, each with its trend and how it changed. The tabs after it (Sales, Costs, Labor, Product sales) hold the detail behind each number. Owner-only.'
};

/* =====================================================================================
   Data: read-only. Each table is tried on its own; anything your role can't read is skipped.
   ===================================================================================== */
function grab(table, build) {
  var q = build(sb.from(table));
  return q.then(function (r) { if (r.error) { S.loaded[table] = 'no'; return null; } S.loaded[table] = 'yes'; return r.data || []; }, function () { S.loaded[table] = 'no'; return null; });
}
function loadLive() {
  MEM.tables = {}; MEM.gone = {}; S._pc = null; if (window.EdenPayroll) window.EdenPayroll._reset();
  var since400 = iso(addDays(new Date(), -400)), since120 = iso(addDays(new Date(), -120)), since60 = iso(addDays(new Date(), -60));
  var jobs = {
    staff: grab('staff', function (t) { return t.select('*'); }),
    items: grab('inventory_items', function (t) { return t.select('*').limit(3000); }),
    counts: grab('inventory_counts', function (t) { return t.select('*').order('count_date', { ascending: false }).limit(400); }),
    invoices: grab('inventory_invoices', function (t) { return t.select('id,invoice_date,vendor,invoice_no,total,lines').gte('invoice_date', since400).order('invoice_date', { ascending: false }).limit(600); }),
    prices: grab('inventory_prices', function (t) { return t.select('*').order('price_date', { ascending: false }).limit(5000); }),
    employees: grab('employees', function (t) { return t.select('*'); }),
    weeks: grab('schedule_weeks', function (t) { return t.select('*').order('week_start', { ascending: false }).limit(60); }),
    payedit: grab('payroll_weeks', function (t) { return t.select('week_start,status,rows,tip_pool').order('week_start', { ascending: false }).limit(6); }),
    payrates: grab('pay_rates', function (t) { return t.select('*'); }),
    eod: grab('eod_reports', function (t) { return t.select('*').order('report_date', { ascending: false }).limit(40); }),
    events: grab('events', function (t) { return t.select('*').gte('date', iso(addDays(new Date(), -120))).order('date').limit(1500); }),
    catering: grab('catering_inquiries', function (t) { return t.select('*').order('created_at', { ascending: false }).limit(300); }),
    todos: grab('todos', function (t) { return t.select('*').eq('done', false).order('sort').limit(100); }),
    recipes: grab('recipes', function (t) { return t.select('*').order('name').limit(500); }),
    builds: grab('cocktail_builds', function (t) { return t.select('*').limit(300); }),
    menu: grab('site_docs', function (t) { return t.select('path,data').like('path', 'site/%'); }),
    payweeks: grab('payroll_weeks', function (t) { return t.select('week_start,status,summary:rows->_summary').gte('week_start', since400).order('week_start', { ascending: false }); }),
    sales: grab('sales_items', function (t) { return t.select('day,category,item,qty,net').gte('day', iso(addDays(new Date(), -120))).limit(20000); }),
    eodAll: grab('eod_reports', function (t) { return t.select('report_date,actual_covers').gte('report_date', since400).limit(2000); }),
    timeoff: grab('time_off', function (t) { return t.select('*').gte('end_date', iso(addDays(new Date(), -30))).order('start_date').limit(200); }),
    reviews: grab('reviews', function (t) { return t.select('id,emp,review_date,due_date,status,position,reviewer').order('review_date', { ascending: false }).limit(100); }),
    preshift: grab('preshift_notes', function (t) { return t.select('service_date,body,author').gte('service_date', iso(addDays(new Date(), -1))).order('service_date').limit(40); }),
    units: grab('temp_units', function (t) { return t.select('*'); }),
    temps: grab('temp_readings', function (t) { return t.select('unit_id,at,temp_f').gte('at', new Date(Date.now() - 2 * 864e5).toISOString()).order('at', { ascending: false }).limit(2000); }),
    promos: grab('promo_campaigns', function (t) { return t.select('id,subject,status,scheduled_at,sent_at').order('updated_at', { ascending: false }).limit(30); }),
    prepLive: grab('prep_lists', function (t) { return t.select('*').eq('id', 'eden'); }),
    inbox: grab('inventory_inbox', function (t) { return t.select('*').limit(50); })
  };
  var keys = Object.keys(jobs);
  return Promise.all(keys.map(function (k) { return jobs[k]; })).then(function (res) {
    keys.forEach(function (k, i) { S.data[k] = res[i]; });
    var me = (S.data.staff || []).filter(function (s) { return S.user && s.user_id === S.user.id; })[0];
    if (me) { S.role = me.role; S.myName = me.name; }
    S.data.menuTree = buildMenu(S.data.menu); S.dataVer = Date.now();
    (S.data.menu || []).forEach(function (d) { if (d.path === 'site/supper') S.data.supper = d.data; if (d.path === 'site/menu' && d.data) S.data.menuAllergy = d.data.allergy || ''; });
    if (window.EdenInventory) window.EdenInventory._reset(); shareInventory(); shareMore();
  });
}
function buildMenu(docs) {
  if (!docs || !docs.length) return null;
  var root = docs.filter(function (d) { return d.path === 'site/menu'; })[0], groups = {};
  docs.forEach(function (d) { var m = d.path.match(/^site\/menu\/groups\/(.+)$/); if (m) groups[m[1]] = d.data; });
  if (!root || !root.data || !root.data.tabs) return null;
  return root.data.tabs.map(function (t) { return { id: t.id, label: t.label || t.id, groups: (t.gids || []).map(function (g) { return Object.assign({ id: g }, groups[g] || { title: g, items: [] }); }) }; });
}

/* ---------- sample data: so the layout can be tried without signing in ---------- */
function loadSample() {
  var t = new Date(), d = function (n) { return iso(addDays(t, n)); };
  var items = [];
  var add = function (cat, sec, name, unit, cost, par, max, vendor, pack, extra) { items.push(Object.assign({ id: 'i' + items.length, category: cat, section: sec, name: name, ingredient: '', unit: unit, cost: cost, par: par, max_qty: max, vendor: vendor, pack: pack || '', active: true, menu_refs: [] }, extra || {})); };
  add('food', 'Produce', 'Leeks', 'lb', 3.1, 6, 12, 'Main Street Farms'); add('food', 'Produce', 'Chives', '1/4 lb', 2.75, 2, 4, 'Main Street Farms'); add('food', 'Produce', 'Shallots', 'lb', 2.4, 5, 10, 'Sysco');
  add('food', 'Produce', 'Lemons', 'each', 0.42, 40, 80, 'Sysco'); add('food', 'Produce', 'Garlic', 'lb', 4.2, 3, 6, 'Sysco', '5 lb case');
  add('food', 'Dairy', 'Butter, unsalted', 'lb', 4.65, 10, 20, 'Sysco'); add('food', 'Dairy', 'Heavy cream', 'qt', 5.1, 6, 10, 'Byrne Dairy'); add('food', 'Dairy', 'Eggs', 'dozen', 3.9, 6, 12, 'Main Street Farms');
  add('food', 'Meat & fish', 'Duck breast', 'lb', 14.5, 8, 14, 'Baldor'); add('food', 'Meat & fish', 'Hanger steak', 'lb', 11.2, 10, 18, 'Baldor'); add('food', 'Meat & fish', 'Scallops U10', 'lb', 32, 4, 8, 'Baldor');
  add('food', 'Dry storage', 'Chocolate 64%', 'lb', 12.7, 6, 12, 'Chef’s Warehouse', '11 lb case'); add('food', 'Dry storage', 'Arborio rice', 'lb', 2.1, 10, 20, 'Sysco');
  add('bev', 'Draught beer', 'Prison City Mass Riot IPA', 'keg', 182, 1, 3, 'Saratoga Eagle'); add('bev', 'Bottled & canned beer', 'Ommegang Witte', 'case', 41, 2, 4, 'Saratoga Eagle');
  add('bev', 'Sparkling', 'Dr. Konstantin Frank Brut', 'bottle', 21, 6, 12, 'Empire Merchants', '750ml'); add('bev', 'White wine', 'Ravines Dry Riesling', 'bottle', 14.5, 12, 24, 'Empire Merchants', '750ml');
  add('bev', 'Red wine', '2019 Ravines Cabernet Franc', 'bottle', 18, 6, 12, 'Winebow', '750ml'); add('bev', 'Red wine', '2021 Ravines Cabernet Franc', 'bottle', 19, 6, 12, 'Winebow', '750ml', { replaces: 'i17' });
  add('bev', 'Red wine', '2021 Living Roots Adelaide Hills Cabernet – Tannat', 'bottle', 21, 6, 12, 'Winebow', '750ml');
  add('bev', 'Gin', 'Tanqueray', 'bottle', 28, 2, 4, 'Empire Merchants', '1L'); add('bev', 'Gin', 'Albany Distilling Gin', 'bottle', 26, 2, 4, 'Empire Merchants', '750ml');
  add('bev', 'Whiskey', 'Old Forester 100', 'bottle', 24, 2, 4, 'Empire Merchants', '1L'); add('bev', 'Specialty', 'St. George Coffee Liqueur', 'bottle', 31, 1, 2, 'Empire Merchants', '750ml');
  add('bev', 'Aperitif', 'Tribuno Extra Dry Vermouth', 'bottle', 9, 2, 4, 'Empire Merchants', '1L'); add('bev', 'Liqueurs & mixers', 'Roland Olive Juice', 'bottle', 6, 2, 4, 'Empire Merchants');
  add('bev', 'Soft drinks & juice', 'Saratoga Sparkling Water', 'each', 1.35, 24, 48, 'Saratoga Eagle'); add('bev', 'Coffee & tea', 'Dark Arts Espresso', 'lb', 16, 4, 8, 'Dark Arts');
  add('paper', 'To-go', 'Kraft to-go boxes', 'case', 58, 1, 3, 'Sysco'); add('paper', 'Cleaning', 'Sanitizer tablets', 'box', 34, 2, 4, 'Sysco'); add('paper', 'Paper', 'Cocktail napkins', 'case', 42, 1, 2, 'Sysco');
  var counts = [];
  [-92, -61, -31, -2].forEach(function (off, k) {
    ['food', 'bev', 'paper'].forEach(function (cat) {
      var c = {}; items.forEach(function (it, j) { if (it.category === cat) c[it.id] = Math.max(0, Math.round((it.par * (0.6 + ((j * 7 + k * 3) % 10) / 9)) * 10) / 10); });
      if (cat === 'bev' && k === 3) { c.i17 = 0; c.i20 = 5; }
      if (cat === 'food' && k === 3) { c.i0 = 15; c.i11 = 3; }
      counts.push({ id: cat + ':' + d(off), category: cat, count_date: d(off), counts: c, counted_by: 'Rich', finished_at: off < -2 ? d(off) : null });
    });
  });
  var invoices = [
    { id: 'v1', invoice_date: d(-1), vendor: 'Sysco', invoice_no: '84412', total: 612.4, lines: [{ description: 'LEEK FRESH 12CT', item_id: 'i0', extended: 42, unit_price: 42, unit: 'cs' }, { description: 'BUTTER UNSLTD 36/1LB', item_id: 'i5', extended: 167.4 }, { description: 'MYSTERY CHEESE 5LB', item_id: null, extended: 61 }] },
    { id: 'v2', invoice_date: d(-3), vendor: 'Empire Merchants', invoice_no: 'EM-2231', total: 1188, lines: [{ description: 'TANQUERAY 1L', item_id: 'i20', extended: 336 }, { description: 'TRIBUNO EX DRY VERM 1L', item_id: null, extended: 108 }] },
    { id: 'v3', invoice_date: d(-6), vendor: 'Winebow', invoice_no: '553019', total: 1424, lines: [{ description: 'RAVINES CAB FRANC 21', item_id: 'i18', extended: 228 }] },
    { id: 'v4', invoice_date: d(-9), vendor: 'Baldor', invoice_no: 'B-7781', total: 948.2, lines: [{ description: 'DUCK BREAST MAGRET', item_id: 'i8', extended: 435 }] }
  ];
  var prices = [];
  items.forEach(function (it, j) { [120, 75, 30, 4].forEach(function (back, k) { prices.push({ item_id: it.id, price_date: d(-back), unit_cost: Math.round(it.cost * (0.9 + 0.04 * k + ((j % 3) - 1) * 0.02) * 100) / 100, vendor: it.vendor, invoice_line: it.name.toUpperCase() }); }); });
  var emps = [['Rich Strub', 'Chef / Owner'], ['Tyler Ball', 'Front of house manager'], ['Kyle Alden', 'Bartender'], ['Maria', 'Server'], ['Sam', 'Server'], ['Dev', 'Line cook'], ['Jo', 'Sous chef'], ['Lee', 'Dishwasher']].map(function (e, i) { return { id: 'e' + i, name: e[0], position: e[1], active: true, phone: '' }; });
  var sun = addDays(t, -t.getDay()), shifts = [];
  [3, 4, 5, 6].forEach(function (day) { shifts.push({ emp: 'e1', day: day, start: '15:30', end: 'close', role: 'Manager' }, { emp: 'e2', day: day, start: '16:00', end: 'close', role: 'Bar' }, { emp: 'e3', day: day, start: '16:30', end: 'close', role: 'Server' }, { emp: day % 2 ? 'e4' : 'e3', day: day, start: '17:00', end: '21:30', role: 'Server' }, { emp: 'e5', day: day, start: '14:00', end: 'close', role: 'Line' }, { emp: 'e6', day: day, start: '12:00', end: 'close', role: 'Sous' }, { emp: 'e7', day: day, start: '17:00', end: 'close', role: 'Dish' }); });
  S.data = {
    items: items, counts: counts, invoices: invoices, prices: prices, employees: emps,
    weeks: [{ week_start: iso(sun), status: 'published', shifts: shifts, published: shifts }],
    eod: [-1, -2, -3, -4, -8, -9].map(function (o, i) { return { id: 'r' + i, report_date: d(o), status: i ? 'submitted' : 'draft', reservations: 48 + i * 3, actual_covers: 52 + i * 2, walk_ins: 6 + i, service_rating: 4 }; }),
    events: [{ id: 'ev1', title: 'Supper Club: Harvest Table', type: 'supper', date: d(2), start: '18:30', guests: 24 }, { id: 'ev2', title: 'Rehearsal dinner — Miller', type: 'private', date: d(5), start: '17:00', guests: 38 }, { id: 'ev3', title: 'Closed for Thanksgiving', type: 'closed', date: d(0), all_day: true }, { id: 'ev4', title: 'Wine tasting class', type: 'other', date: d(11), start: '19:00', guests: 16 }],
    catering: [{ id: 'c1', status: 'new', name: 'Ana Ruiz', event_name: 'Office holiday party', event_date: d(18), guests: 40, created_at: new Date().toISOString() }, { id: 'c2', status: 'quoted', name: 'J. Park', event_name: 'Engagement dinner', event_date: d(30), guests: 22, created_at: new Date(Date.now() - 4 * 864e5).toISOString() }],
    todos: [{ id: 't1', title: 'Call Baldor about duck price', due: d(1) }, { id: 't2', title: 'Update winter cocktail list', due: d(4) }],
    recipes: [{ id: 'r1', name: 'Leek soubise', category: 'Sauces', yield_qty: 2, yield_unit: 'qt', ingredients: [{ qty: 3, unit: 'lb', item: 'Leeks', inv_id: 'i0' }, { qty: 0.5, unit: 'lb', item: 'Butter', inv_id: 'i5' }] }, { id: 'r2', name: 'Chocolate pot de crème', category: 'Pastry', yield_qty: 12, yield_unit: 'each', ingredients: [{ qty: 1.5, unit: 'lb', item: 'Chocolate 64%' }, { qty: 1, unit: 'qt', item: 'Heavy cream' }] }],
    builds: [{ id: 'b1', name: 'Bad Apple', menu_name: 'Bad Apple', glass: 'Coupe', ingredients: [{ qty: 1.5, unit: 'oz', item: 'Calvados' }, { qty: 0.75, unit: 'oz', item: 'Lemon juice' }, { qty: 0.5, unit: 'oz', item: 'Honey syrup' }] }, { id: 'b2', name: 'Eden Martini', glass: 'Nick & Nora', ingredients: [{ qty: 2.5, unit: 'oz', item: 'Tanqueray', inv_id: 'i20' }, { qty: 0.5, unit: 'oz', item: 'Tribuno Extra Dry Vermouth', inv_id: 'i24' }] }],
    menuTree: [
      { id: 'm-food', label: 'Dinner', groups: [{ title: 'To start', items: [{ name: 'Leek soubise, grilled bread', price: '14' }, { name: 'Scallop crudo', price: '19' }] }, { title: 'Mains', items: [{ name: 'Duck breast, cherry, chicory', price: '42' }, { name: 'Hanger steak, wood-fire, bordelaise', price: '38' }] }, { title: 'Dessert', items: [{ name: 'Chocolate pot de crème', price: '12' }] }] },
      { id: 'm-wine', label: 'Wine', groups: [{ title: 'Sparkling', items: [{ name: 'Dr. Konstantin Frank Brut', glass: '15', bottle: '60' }] }, { title: 'Red', items: [{ name: '2019 Ravines Cabernet Franc', glass: '16', bottle: '62' }, { name: '2021 Living Roots Adelaide Hills Cabernet – Tannat', glass: '20', bottle: '80' }] }] },
      { id: 'm-bar', label: 'Cocktails', groups: [{ title: 'House', items: [{ name: 'Bad Apple', price: '15', desc: 'Calvados, lemon, honey' }, { name: 'Eden Martini', price: '16', desc: 'Gin, extra dry vermouth' }] }] },
      { id: 'm-spirits', label: 'Spirits', groups: [{ title: 'Gin', items: [{ name: 'Tanqueray', price: '11' }, { name: 'Albany Distilling Gin', price: '12' }] }] }
    ],
    payweeks: [0, 1, 2, 3, 4, 5, 6, 7].map(function (i) { var net = 21000 + (i % 3) * 1800 - i * 120; return { week_start: iso(addDays(sun, -7 * (i + 1))), status: 'final', summary: { net: net, food: net * 0.62, bev: net * 0.38, cost: net * 0.31, pct: 0.31, tips: 4100, invActual: net * 0.33 } }; }),
    sales: [['Duck breast', 'Mains', 64, 2688], ['Hanger steak', 'Mains', 71, 2698], ['Bad Apple', 'Cocktails', 88, 1320], ['Leek soubise', 'Starters', 52, 728], ['Ravines Cab Franc (glass)', 'Wine', 93, 1488], ['Chocolate pot de crème', 'Dessert', 47, 564]].map(function (x) { return { day: d(-3), item: x[0], category: x[1], qty: x[2], net: x[3] }; }),
    timeoff: [{ id: 'to1', emp: 'e3', start_date: d(9), end_date: d(11), status: 'pending', reason: 'Family trip' }],
    reviews: [{ id: 'rv1', emp: 'e4', review_date: d(-20), status: 'signed', position: 'Server' }, { id: 'rv2', emp: 'e5', due_date: d(12), review_date: d(12), status: 'draft', position: 'Line cook' }],
    preshift: [{ service_date: d(0), body: 'Thanksgiving: closed. Friday — 2-top proposal at 7:15 on table 12, champagne on the house.', author: 'Tyler' }],
    units: [{ id: 'u1', name: 'Walk-in cooler', kind: 'cooler', max_f: 41 }, { id: 'u2', name: 'Bar cooler', kind: 'cooler', max_f: 41 }, { id: 'u3', name: 'Freezer', kind: 'freezer', max_f: 0 }],
    temps: [{ unit_id: 'u1', at: new Date().toISOString(), temp_f: 37.2 }, { unit_id: 'u2', at: new Date().toISOString(), temp_f: 43.1 }, { unit_id: 'u3', at: new Date().toISOString(), temp_f: -4 }],
    promos: [{ id: 'p1', subject: 'Supper Club: Harvest Table', status: 'sent', sent_at: new Date(Date.now() - 9 * 864e5).toISOString() }, { id: 'p2', subject: 'Holiday gift cards', status: 'draft' }],
    inbox: []
  };
  sampleBusiness(sun);
  var lastSun = iso(addDays(sun, -7)), prevShifts = shifts.map(function (x, i) { return Object.assign({}, x, { id: 'p' + i }); });
  S.data.weeks.push({ week_start: lastSun, status: 'published', shifts: prevShifts, published: prevShifts });
  var rows = {}; prevShifts.forEach(function (x, i) { var r = rows[x.emp] = rows[x.emp] || { hours: ['', '', '', '', '', '', ''], adj: 0 }; r.hours[x.day] = Math.round(((+r.hours[x.day] || 0) + shiftHours(x) + ((i % 5) - 2) * 0.25) * 100) / 100; });
  if (rows.e1) rows.e1.hours[2] = 6; if (rows.e5) rows.e5.hours[2] = 7.5;
  var nextShifts = shifts.map(function (x, i) { return Object.assign({}, x, { id: 'q' + i }); }).filter(function (x) { return !(x.emp === 'e6' && x.day === 5); });
  nextShifts.push({ id: 'qx', emp: 'e1', day: 1, start: '15:00', end: '22:30', role: 'Manager', note: 'Holiday party' }, { id: 'qy', emp: 'e2', day: 1, start: '16:00', end: '22:30', role: 'Bar' });
  S.data.weeks.push({ week_start: iso(addDays(sun, 7)), status: 'draft', shifts: nextShifts });
  var D = function (n, hh, mm) { return iso(addDays(t, n)); }, y = t.getFullYear();
  S.data.events = S.data.events.concat([
    { id: 'ev5', title: 'Supper Club: Autumn Harvest', type: 'supper', date: D(-12), start: '18:30', end: '21:30', guests: 22, room: 'Main dining room' },
    { id: 'ev6', title: 'Staff meeting — holiday season', type: 'meeting', date: D(-5), start: '15:00', end: '16:00', notes: 'Holiday menu, gift cards, party bookings.' },
    { id: 'ev7', title: 'Empire Merchants tasting', type: 'meeting', date: D(1), start: '14:00', end: '15:00', room: 'Bar', notes: 'Rep bringing 8 Finger Lakes reds for the winter list.' },
    { id: 'ev8', title: 'Winter menu tasting', type: 'meeting', date: D(6), start: '13:00', end: '15:00', notes: 'Whole kitchen + Tyler. Final plating for the Dec 9 menu change.' },
    { id: 'ev9', title: 'Hanover Law holiday party', type: 'private', date: iso(addDays(sun, 8)), start: '18:00', end: '22:00', guests: 60, room: 'Whole restaurant', notes: 'Buyout. Family-style, 3 courses, open bar 2 hrs. $2,000 deposit received.' },
    { id: 'ev10', title: 'Everson Museum gala', type: 'catering', date: D(16), start: '17:00', end: '22:00', guests: 120, room: 'Off-site', notes: 'Passed apps only. Load out 3:30.' },
    { id: 'ev11', title: 'Supper Club: Winter Solstice', type: 'supper', date: iso(new Date(y, 11, 19)), start: '18:30', end: '21:30', guests: 28, room: 'Main dining room' },
    { id: 'ev12', title: 'Wine Spectator photo shoot', type: 'other', date: D(13), start: '11:00', end: '13:00' },
    { id: 'ev13', title: 'Closed — holiday break', type: 'closed', date: iso(new Date(y, 11, 24)), all_day: true },
    { id: 'ev14', title: 'Closed — holiday break', type: 'closed', date: iso(new Date(y, 11, 25)), all_day: true },
    { id: 'ev15', title: 'New Year’s Eve tasting menu', type: 'supper', date: iso(new Date(y, 11, 31)), start: '17:30', end: '23:00', guests: 72, notes: 'Two seatings, 5:30 and 8:30. Sparkling toast at midnight.' },
    { id: 'ev16', title: 'Proposal — table 12', type: 'private', date: D(2), start: '19:15', guests: 2, notes: 'Champagne on the house.' }
  ]);
  S.data.timeoff.push({ id: 'to2', emp: 'e6', start_date: iso(addDays(sun, 10)), end_date: iso(addDays(sun, 13)), status: 'approved', reason: 'Wedding' }, { id: 'to3', emp: 'e4', start_date: iso(addDays(sun, 8)), end_date: iso(addDays(sun, 8)), status: 'pending', reason: 'Class' });
  var ago_ = function (n) { return new Date(Date.now() - n * 864e5).toISOString(); };
  S.data.catering = [
    { id: 'c1', status: 'new', name: 'Ana Ruiz', organization: 'Ruiz & Co.', event_name: 'Office holiday party', event_type: 'Holiday party', event_date: D(18), start_time: '18:00', guests: 40, location: '3rd Floor', email: 'ana@example.com', created_at: ago_(0) },
    { id: 'c4', status: 'new', name: 'Mark Chen', event_name: '60th birthday dinner', event_type: 'Birthday', event_date: D(5), start_time: '19:00', guests: 18, location: 'Restaurant', created_at: ago_(1) },
    { id: 'c2', status: 'link_sent', name: 'J. Park', event_name: 'Engagement dinner', event_type: 'Rehearsal dinner', event_date: D(30), guests: 22, location: 'Palladian', created_at: ago_(4) },
    { id: 'c5', status: 'received', name: 'Upstate Medical', organization: 'SUNY Upstate', event_name: 'Department dinner', event_type: 'Corporate dinner', event_date: D(21), start_time: '18:30', end_time: '21:30', guests: 34, location: '3rd Floor', notes: 'Wants wine pairings. Budget ~$95 pp.', created_at: ago_(6) },
    { id: 'c6', status: 'beo', name: 'Sarah Miller', event_name: 'Rehearsal dinner — Miller', event_type: 'Rehearsal dinner', event_date: D(5), start_time: '17:00', end_time: '21:00', guests: 38, location: 'Palladian', phone: '315-555-0142', notes: 'Family style. Gluten-free bride. Cake from outside — $3 pp cake fee.', created_at: ago_(30) },
    { id: 'c7', status: 'beo', name: 'Hanover Law', event_name: 'Hanover Law holiday party', event_type: 'Holiday party', event_date: iso(addDays(sun, 8)), start_time: '18:00', end_time: '22:00', guests: 60, location: 'Restaurant', notes: 'Buyout. 3 courses, open bar 2 hrs. $2,000 deposit received.', created_at: ago_(40) },
    { id: 'c8', status: 'completed', name: 'Onondaga Historical Assoc.', event_name: 'Donor reception', event_date: D(-20), guests: 45, created_at: ago_(70) },
    { id: 'c9', status: 'declined', name: 'T. Wong', event_name: 'Baby shower', event_date: D(-8), guests: 25, notes: 'Went with a venue with a lunch option.', created_at: ago_(35) }
  ];
  S.data.events.forEach(function (e) { if (e.id === 'ev2') { e.beo_id = 'c6'; e.source = 'beo'; e.room = 'Palladian'; } if (e.id === 'ev9') { e.beo_id = 'c7'; e.source = 'beo'; } });
  S.data.menuAllergy = 'Please tell your server about any allergies. Not every ingredient is listed.';
  S.data.supper = { eyebrow: 'Eden Supper Club', title: 'Winter Solstice', date: 'Saturday, December 19 · 6:30 pm', intro: 'Five courses from the wood fire, with the farms that grew them at the table.', menuHeading: 'The menu', tier1: 'Pairing I', tier2: 'Pairing II', courses: [{ name: 'Smoked trout, rye, horseradish', desc: '', w1: 'Dr. Konstantin Frank Brut', w2: 'Champagne' }, { name: 'Duck, cherry, chicory', desc: '', w1: '2021 Ravines Cabernet Franc', w2: 'Barolo' }], resText: 'Seats are limited and sell out. $125 a person, pairings extra.', notes: ['Dietary needs: tell us when you book.'], ctaLabel: 'Reserve on OpenTable', ctaUrl: '' };
  S.data.todos.push({ id: 't3', title: 'Order holiday gift cards', due: D(8) });
  S.data.payedit = [{ week_start: lastSun, status: 'draft', rows: rows, tip_pool: { cc: 3820, cash: 410 } }];
  S.role = 'owner'; S.myName = 'Sample owner'; S.dataVer = Date.now();
  MEM.tables = {}; MEM.gone = {}; S._pc = null; if (window.EdenPayroll) window.EdenPayroll._reset(); if (window.EdenInventory) window.EdenInventory._reset(); seedPayroll(sun); shareInventory(); shareMore();
}

/* ---------- a year of believable sample numbers for Business ---------- */
function sampleBusiness(sun) {
  var weeks = [], eodAll = [], invoices = S.data.invoices.slice(), sales = [];
  var foodIds = S.data.items.filter(function (it) { return it.category === 'food'; }).map(function (it) { return it.id; });
  var bevIds = S.data.items.filter(function (it) { return it.category === 'bev'; }).map(function (it) { return it.id; });
  var papIds = S.data.items.filter(function (it) { return it.category === 'paper'; }).map(function (it) { return it.id; });
  var rnd = (function (seed) { return function () { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; }; })(42);
  for (var i = 56; i >= 1; i--) {
    var ws = addDays(sun, -7 * i), mo = ws.getMonth();
    var season = [0.78, 0.8, 0.9, 0.95, 1.02, 1.08, 1.1, 1.08, 1.04, 1.06, 1.0, 1.15][mo];
    var closed = (mo === 0 && ws.getDate() < 14) ? 0 : 1;   // two weeks closed in January
    if (!closed) continue;
    var net = Math.round((20500 + (56 - i) * 35) * season * (0.94 + rnd() * 0.12));
    var bevShare = 0.36 + rnd() * 0.05, laborPct = 0.285 + rnd() * 0.045 + (season < 0.85 ? 0.03 : 0);
    var wb = { boh: Math.round(net * laborPct * 0.46), foh: Math.round(net * laborPct * 0.33), mgmt: Math.round(net * laborPct * 0.13) };
    weeks.push({ week_start: iso(ws), status: 'final', summary: { net: net, food: Math.round(net * (1 - bevShare)), bev: Math.round(net * bevShare), cost: Math.round(net * laborPct), pct: laborPct, tips: Math.round(net * 0.19), hours: Math.round(net * laborPct / 19.5), wagesBy: wb } });
    var covers = Math.round(net / (84 + rnd() * 10));
    [3, 4, 5, 6].forEach(function (d, k) { var share = [0.18, 0.22, 0.29, 0.31][k]; eodAll.push({ report_date: iso(addDays(ws, d)), actual_covers: Math.round(covers * share * (0.9 + rnd() * 0.2)) }); });
    var buyPct = (0.29 + rnd() * 0.06) * (i <= 2 ? 0.7 : 1), food$ = net * buyPct * 0.62, bev$ = net * buyPct * 0.33, pap$ = net * buyPct * 0.05;
    [['Sysco', food$ * 0.45, foodIds], ['Baldor', food$ * 0.35, foodIds], ['Main Street Farms', food$ * 0.2, foodIds], ['Empire Merchants', bev$ * 0.5, bevIds], ['Winebow', bev$ * 0.32, bevIds], ['Saratoga Eagle', bev$ * 0.18, bevIds], ['Sysco', pap$, papIds]].forEach(function (v, k) {
      var tot = Math.round(v[1] * 100) / 100; if (tot < 20) return;
      invoices.push({ id: 's' + i + '-' + k, invoice_date: iso(addDays(ws, 1 + (k % 4))), vendor: v[0], total: tot, lines: [{ description: 'Line', item_id: v[2][(i + k) % v[2].length], extended: tot * 0.8 }, { description: 'Line 2', item_id: v[2][(i + k + 3) % v[2].length], extended: tot * 0.2 }] });
    });
  }
  var menu = [['Duck breast', 'Mains', 42, 9], ['Hanger steak', 'Mains', 38, 11], ['Scallop crudo', 'Starters', 19, 7], ['Leek soubise', 'Starters', 14, 8], ['Wood-fired carrots', 'Starters', 13, 6], ['Chocolate pot de crème', 'Dessert', 12, 7], ['Cheese plate', 'Dessert', 16, 3], ['Bad Apple', 'Cocktails', 15, 12], ['Eden Martini', 'Cocktails', 16, 9], ['Ravines Cab Franc (glass)', 'Wine', 16, 10], ['Konstantin Frank Brut (glass)', 'Wine', 15, 8], ['Living Roots Cab–Tannat (bottle)', 'Wine', 80, 1.5], ['Prison City IPA', 'Beer', 8, 6], ['Saratoga water', 'Non-alcoholic', 5, 9]];
  for (var dd = 90; dd >= 1; dd--) { var day = addDays(new Date(), -dd), dow = day.getDay(); if (dow < 3) continue; var f = [0, 0, 0, 0.8, 0.95, 1.25, 1.35][dow]; menu.forEach(function (m) { var q = Math.max(0, Math.round(m[3] * f * (0.7 + rnd() * 0.6))); if (q) sales.push({ day: iso(day), item: m[0], category: m[1], qty: q, net: q * m[2] }); }); }
  S.data.payweeks = weeks.reverse(); S.data.eodAll = eodAll; S.data.invoices = invoices; S.data.sales = sales;
}

/* =====================================================================================
   Shared inventory logic (same rules as the live site)
   ===================================================================================== */
var KINDS = [['food', 'Food'], ['bev', 'Beverages'], ['paper', 'Dry goods']];
var SUBS = [['all', 'All'], ['beer', 'Beer'], ['wine', 'Wine'], ['liquor', 'Liquor'], ['na', 'Non-alcoholic']];
function subOf(it) {
  var s = String(it.section || '').toLowerCase(), nm = String(it.name || '').toLowerCase();
  if (/soft|juice|soda|water|coffee|tea\b|n\/a|non.?alc|mocktail|kombucha|lemonade|tonic|ginger beer/.test(s)) return 'na';
  if (/beer|draught|draft|cider|keg/.test(s)) return 'beer';
  if (/wine|sparkling|ros[eé]|champagne|sake|dessert|port\b/.test(s)) return 'wine';
  if (/aperitif|bourbon|rye|malt|scotch|whisk|gin|vodka|agave|tequila|mezcal|rum|specialty|digestif|liqueur|liquor|mixer|bitters|syrup|cordial|brandy|cognac|amar[oi]|spirit|vermouth/.test(s)) return 'liquor';
  if (/ipa|lager|ale\b|stout|pils|beer/.test(nm)) return 'beer';
  if (/red|white|wine/.test(s)) return 'wine';
  return 'liquor';
}
function items(kind, sub) {
  return (S.data.items || []).filter(function (it) { return it.active !== false && it.category === kind && (kind !== 'bev' || !sub || sub === 'all' || subOf(it) === sub); })
    .sort(function (a, b) { return String(a.section).localeCompare(b.section) || nameOf(a).localeCompare(nameOf(b), undefined, { numeric: true, sensitivity: 'base' }); });
}
function nameOf(it) { return it.category === 'food' && it.ingredient ? it.ingredient : it.name; }
function latestCount(cat, done) {
  return (S.data.counts || []).filter(function (c) { return c.category === cat && c.counts && Object.keys(c.counts).length && (!done || c.finished_at !== null); }).sort(function (a, b) { return a.count_date < b.count_date ? 1 : -1; })[0] || null;
}
function onHand(it) { var c = (S.data.counts || []).filter(function (r) { return r.category === it.category && r.counts && r.counts[it.id] != null; }).sort(function (a, b) { return a.count_date < b.count_date ? 1 : -1; })[0]; return c ? { n: +c.counts[it.id], d: c.count_date } : null; }
function hasCost(it) { return it.cost != null && it.cost !== ''; }
function byId() { var m = {}; (S.data.items || []).forEach(function (it) { m[it.id] = it; }); return m; }
function value(row) { if (!row) return 0; var m = byId(), v = 0; Object.keys(row.counts || {}).forEach(function (id) { var it = m[id]; if (it && hasCost(it)) v += row.counts[id] * it.cost; }); return v; }
function nextVintage(it) { return (S.data.items || []).filter(function (x) { return x.replaces === it.id; })[0] || null; }
function needsOrder() {
  var out = [];
  (S.data.items || []).forEach(function (it) { if (it.active === false || it.par == null || nextVintage(it)) return; var oh = onHand(it); if (!oh) return; var need = it.par - oh.n; if (need > 0) out.push({ it: it, oh: oh.n, need: need }); });
  return out;
}
function overMax() { var out = []; (S.data.items || []).forEach(function (it) { if (it.max_qty == null || it.max_qty === '') return; var oh = onHand(it); if (oh && oh.n > +it.max_qty) out.push({ it: it, oh: oh.n, over: oh.n - it.max_qty }); }); return out; }
function vintageOut() { var m = byId(); return (S.data.items || []).filter(function (nw) { var o = nw.replaces && m[nw.replaces]; if (!o) return false; var oh = onHand(o); return oh && oh.n <= 0; }).map(function (nw) { return { nw: nw, old: m[nw.replaces] }; }); }
function unmatched() { var seen = {}, out = []; (S.data.invoices || []).forEach(function (v) { (v.lines || []).forEach(function (L) { if (!L || L.item_id || !L.description || /deliver|fuel|surcharge|deposit|tax|freight|fee\b/i.test(L.description)) return; var k = norm(v.vendor) + '|' + norm(L.description); if (seen[k]) return; seen[k] = 1; out.push({ v: v, L: L }); }); }); return out; }
function priceHist(id) { return (S.data.prices || []).filter(function (p) { return p.item_id === id; }).sort(function (a, b) { return a.price_date < b.price_date ? 1 : -1; }); }
function empName(id) { var e = (S.data.employees || []).filter(function (x) { return x.id === id; })[0]; return e ? e.name : 'Someone'; }

/* =====================================================================================
   Shell
   ===================================================================================== */
var root = document.getElementById('root');
function role() { return S.previewRole || S.role || 'owner'; }
function spacesFor() { return SPACES.filter(function (s) { return s.roles.indexOf(role()) !== -1 && !(S.isScheduler && !S.previewRole && s.id === 'menu'); }); }
function tabsFor(sp) { return sp.tabs.filter(function (t) { return !t[3] || t[3].indexOf(role()) !== -1; }); }
function go(space, tab) {
  if (S.legacySeen) { refreshIfNeeded(); }
  S.space = space; if (tab) S.tab[space] = tab;
  try { history.replaceState(null, '', '#' + space + (S.tab[space] ? '-' + S.tab[space] : '')); } catch (e) {}
  render(); window.scrollTo(0, 0);
}
function attnCount() { return needsOrder().length ? 1 : 0; }

function gate() {
  root.innerHTML = '';
  var email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'you@edencny.com' }), pw = h('input', { type: 'password', autocomplete: 'current-password' }), msg = h('p', { cls: 'msg' });
  var signin = h('button', { cls: 'btn primary wide', type: 'submit', text: 'Sign in and use my real data' });
  var form = h('form', { on: { submit: function (e) {
    e.preventDefault(); if (!sb) { msg.textContent = 'Couldn’t reach the sign-in service (are you offline?). Try the sample data.'; return; }
    msg.textContent = ''; signin.disabled = true; signin.textContent = 'Signing in…';
    sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value }).catch(function (e) { return { error: { message: String(e && e.message || 'network'), status: 0 } }; }).then(function (r) {
      if (r.error) { var net = /fetch|network|load failed|failed to/i.test(r.error.message || '') || r.error.status === 0; msg.textContent = net ? 'This copy can’t reach your data from here (the page it’s opened in blocks it). Use the sample data, or open the copy on the staff site.' : 'That email and password didn’t work.'; signin.disabled = false; signin.textContent = 'Sign in and use my real data'; return; }
      S.user = r.data.user; S.mode = 'live'; signin.textContent = 'Loading your data…';
      return loadLive().then(start);
    });
  } } }, [h('label', { cls: 'field' }, [h('span', { text: 'Email' }), email]), h('label', { cls: 'field' }, [h('span', { text: 'Password' }), pw]), msg, signin]);
  root.appendChild(h('div', { cls: 'gate' }, [
    h('div', { cls: 'gate-art' }, [h('div', { cls: 'brand' }, ['EDEN', h('small', { text: 'STAFF' })]), h('div', null, [h('h2', { text: 'Everything the restaurant runs on, in one place.' }), h('p', { text: 'A test of a new layout for the staff site: Today, Service, Kitchen & Bar, Menu, Team and Business — with the business at a glance on one page.' })]), h('p', { cls: 'fine', style: 'color:#8b9098', text: 'Prototype · read-only' })]),
    h('div', { cls: 'gate-side' }, h('div', { cls: 'gate-card' }, [
    h('h1', { text: 'Sign in' }),
    h('p', { text: 'Use your usual staff login to see your own numbers in the new layout.' }),
    form,
    h('div', { cls: 'or', text: 'or' }),
    h('button', { cls: 'btn wide', type: 'button', text: 'Look around with sample data', on: { click: function () { S.mode = 'sample'; loadSample(); start(); } } }),
    h('p', { cls: 'fine', style: 'margin-top:18px', html: '<b>Safe to try.</b> This page only reads from the real site. The editors work, but every change stays in this tab and is gone when you close it.' })
  ]))]));
  setTimeout(function () { email.focus(); }, 50);
}
function start() {
  var m = String(location.hash || '').replace('#', '').split(/[-\/]/);
  if (m[0] && SPACES.some(function (s) { return s.id === m[0]; })) { S.space = m[0]; if (m[1]) S.tab[m[0]] = m[1]; }
  render();
}

function render() {
  var sps = spacesFor();
  if (!sps.some(function (s) { return s.id === S.space; })) S.space = sps[0].id;
  var sp = SPACES.filter(function (s) { return s.id === S.space; })[0], tabs = tabsFor(sp);
  var tab = S.tab[sp.id] && tabs.some(function (t) { return t[0] === S.tab[sp.id]; }) ? S.tab[sp.id] : tabs[0][0];
  S.tab[sp.id] = tab;
  var attn = todayItems().length;

  root.innerHTML = '';
  var rail = h('nav', { cls: 'rail', 'aria-label': 'Main' }, [h('div', { cls: 'brand' }, ['EDEN', h('small', { text: 'STAFF' })])]);
  sps.forEach(function (s) {
    var b = h('button', { cls: 'space', 'aria-current': s.id === S.space ? 'true' : 'false', on: { click: function () { go(s.id); } } }, [svg(ICON[s.id]), s.label, s.id === 'today' && attn ? h('span', { cls: 'count', text: String(attn) }) : null]);
    rail.appendChild(b); rail.appendChild(h('div', { cls: 'space-hint', text: s.hint }));
  });
  rail.appendChild(h('div', { cls: 'grow' }));
  rail.appendChild(h('button', { cls: 'me', type: 'button', title: 'Your account', on: { click: accountMenu } }, [h('div', { cls: 'av', text: initials(S.myName || (S.user && S.user.email) || 'Eden') }), h('div', null, [h('b', { text: S.myName || (S.user && S.user.email) || 'Sample' }), h('span', { text: (S.isScheduler ? 'Manager' : roleLabel(S.role)) })])]));

  var rp = h('select', { cls: 'rolepick', 'aria-label': 'See the layout as', title: 'See what each role would see' }, [['', 'See it as: me'], ['owner', 'See it as: Owner'], ['manager', 'See it as: Manager'], ['kitchen', 'See it as: Kitchen'], ['foh', 'See it as: Front of house']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
  if (S.role !== 'owner') rp = null; else rp.value = S.previewRole || ''; if (rp) rp.addEventListener('change', function () { S.previewRole = rp.value || null; render(); });
  var top = h('header', { cls: 'top' }, [
    h('div', { cls: 'where' }, [sp.label + ' / ', h('b', { text: (tabs.filter(function (t) { return t[0] === tab; })[0] || [0, ''])[1] })]),
    h('span', { cls: 'sp' }),
    h('button', { cls: 'searchbtn', on: { click: palette } }, [svg(ICON.search), h('span', { cls: 'lbl', text: 'Find anything…' }), h('kbd', { text: navigator.platform.indexOf('Mac') !== -1 ? '⌘K' : 'Ctrl K' })]),
    h('span', { cls: 'savestate', text: SYNC.failed ? 'Couldn’t save — retrying' : 'Saved' }),
    rp
  ]);
  top.querySelector('.searchbtn svg').setAttribute('style', 'width:16px;height:16px;stroke:currentColor;fill:none;stroke-width:2');
  var banner = null;

  var page = h('main', { cls: 'page' });
  page.appendChild(h('div', { cls: 'pagehead' }, [h('div', null, [h('h1', { text: sp.id === 'today' ? greeting() : sp.label }), h('p', { text: sp.id === 'today' ? todayLine() : sp.hint })])]));
  if (tabs.length > 1) page.appendChild(h('div', { cls: 'tabs', role: 'tablist' }, tabs.map(function (t) { return h('button', { cls: 'tab', role: 'tab', 'aria-selected': t[0] === tab ? 'true' : 'false', on: { click: function () { go(sp.id, t[0]); } } }, [t[1], t[2] ? h('small', { text: t[2] }) : null]); })));
  page.appendChild(h('div', { cls: 'why', 'data-off': S.showWhy ? null : '1', html: WHY[sp.id] }));
  var body = h('div'); page.appendChild(body);
  (PAGES[sp.id + '/' + tab] || PAGES[sp.id] || notYet)(body);

  var PRI = ['today', 'calendar', 'service', 'kitchen', 'bar', 'ordering', 'menu', 'catering', 'team', 'business'];
  var bsp = sps.slice().sort(function (a, b) { return PRI.indexOf(a.id) - PRI.indexOf(b.id); }), more = bsp.length > 5;
  if (more) { var cur = bsp.filter(function (s) { return s.id === S.space; })[0]; bsp = bsp.slice(0, 4); if (cur && bsp.indexOf(cur) === -1) bsp[3] = cur; }
  var bbtn = bsp.map(function (s) {
    return h('button', { 'aria-current': s.id === S.space ? 'true' : 'false', on: { click: function () { go(s.id); } } }, [svg(ICON[s.id]), s.label.replace(/ & (Bar|BEOs)/, ''), s.id === 'today' && attn ? h('span', { cls: 'count', text: String(attn) }) : null]);
  });
  if (more) bbtn.push(h('button', { 'aria-current': 'false', on: { click: moreSheet } }, [svg(ICON.more), 'More']));
  var bottom = h('nav', { cls: 'bottomnav', style: '--n:' + bbtn.length, 'aria-label': 'Main' }, bbtn);
  root.appendChild(h('div', { cls: 'app' }, [rail, h('div', { cls: 'main' }, [top, banner, page]), bottom]));
}
function initials(n) { return String(n).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(function (p) { return p[0].toUpperCase(); }).join(''); }
function roleLabel(r) { return { owner: 'Owner', manager: 'Manager', kitchen: 'Kitchen', foh: 'Front of house' }[r] || 'Staff'; }
function greeting() { var hr = new Date().getHours(); return (hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (S.myName ? ', ' + String(S.myName).split(' ')[0] : ''); }
function todayLine() { var n = todayItems().length; return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + (n ? plural(n, 'thing') + ' need you' : 'Nothing needs you right now'); }
function notYet(el) { el.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Same as today’s page' }), h('p', { cls: 'sub', text: 'This part works the way it does on the live site; it moved here so it’s easier to find.' })])); }
function missing(el, what) { el.appendChild(h('p', { cls: 'empty', text: S.mode === 'live' ? 'Your login can’t read ' + what + ', or there isn’t any yet.' : 'No ' + what + ' in the sample.' })); }

/* =====================================================================================
   TODAY — a to-do list that clears itself
   ===================================================================================== */
function todayItems() {
  var out = [], r = role();
  var vo = vintageOut();
  if (vo.length && r !== 'kitchen') out.push({ ic: 'wine', tone: 'wine', t: vo.length === 1 ? vo[0].old.name + ' is out' : plural(vo.length, 'wine') + ' ran out', s: 'Switch the wine list to ' + vo.map(function (x) { return x.nw.name; }).join(', '), go: ['menu', 'guest'], cta: 'Update menu' });
  var temps = tempAlerts(); if (temps.length) out.push({ ic: 'temp', tone: 'red', t: temps.map(function (x) { return x.u.name; }).join(', ') + (temps.length === 1 ? ' is' : ' are') + ' too warm', s: temps.map(function (x) { return x.u.name + ' ' + x.t + '°F'; }).join(' · '), go: ['kitchen', 'temps'], cta: 'Check temps' });
  [['kitchen', 'Kitchen', function (it) { return it.category !== 'bev'; }, 'foh'], ['bar', 'Bar', function (it) { return it.category === 'bev'; }, 'kitchen']].forEach(function (P) {
    if (r === P[3]) return;
    var no = needsOrder().filter(function (x) { return P[2](x.it); }); if (no.length) out.push({ ic: 'cart', tone: 'gold', t: P[1] + ': ' + plural(no.length, 'item') + ' below par', s: uniq(no.map(function (x) { return x.it.vendor; })).slice(0, 4).join(', ') + ' — the order list is ready', go: ['ordering', P[0]], cta: 'Order list' });
    var om = overMax().filter(function (x) { return P[2](x.it); }); if (om.length) out.push({ ic: 'up', tone: 'blue', t: P[1] + ': ' + plural(om.length, 'item') + ' to use first', s: om.slice(0, 4).map(function (x) { return nameOf(x.it); }).join(', ') + ' — over the maximum', go: ['ordering', P[0]], cta: 'See list' });
  });
  var um = unmatched(); if (um.length && r !== 'foh') out.push({ ic: 'receipt', tone: 'gold', t: plural(um.length, 'invoice line') + ' not matched', s: 'Match them once and the scanner remembers', go: ['kitchen', 'receive'], cta: 'Match' });
  var bc = ['food', 'bev', 'paper'].filter(function (c) { var o = (S.data.counts || []).filter(function (x) { return x.category === c && x.finished_at === null && x.counts && Object.keys(x.counts).length; })[0]; return o; });
  if (bc.length && r !== 'foh') out.push({ ic: 'list', tone: 'blue', t: 'Inventory in progress', s: bc.map(function (c) { return KINDS.filter(function (k) { return k[0] === c; })[0][1]; }).join(', ') + ' — not saved yet', go: [bc.indexOf('bev') !== -1 && bc.length === 1 ? 'bar' : 'kitchen', 'count'], cta: 'Keep counting' });
  if (r !== 'foh' && calDay(prepState().for_date || iso()).open) { var pg = prepProgress(false); if (pg.n && pg.d < pg.n) out.push({ ic: 'list', tone: 'green', t: 'Prep list: ' + pg.d + ' of ' + pg.n + ' done', s: 'For ' + dlong(prepState().for_date), go: ['kitchen', 'prep'], cta: 'Open prep' }); }
  if (r === 'owner' || r === 'manager') {
    var nc = (S.data.catering || []).filter(function (c) { return c.status === 'new'; }); if (nc.length) out.push({ ic: 'mail', tone: 'green', t: plural(nc.length, 'new catering inquiry', 'ies').replace('inquirys', 'inquiries'), s: nc.slice(0, 2).map(function (c) { return (c.event_name || c.name) + (c.event_date ? ' · ' + dshort(c.event_date) : ''); }).join(' · '), go: ['catering', 'pipeline'], cta: 'Reply' });
    var to = (S.data.timeoff || []).filter(function (x) { return x.status === 'pending'; }); if (to.length) out.push({ ic: 'cal', tone: 'blue', t: plural(to.length, 'time-off request'), s: to.slice(0, 2).map(function (x) { return empName(x.emp) + ' · ' + dshort(x.start_date) + '–' + dshort(x.end_date); }).join(' · '), go: ['team', 'timeoff'], cta: 'Decide' });
    var dr = (S.data.eod || []).filter(function (x) { return x.status === 'draft'; }); if (dr.length) out.push({ ic: 'pen', tone: 'gold', t: 'End of day report not submitted', s: dr.map(function (x) { return dlong(x.report_date); }).join(', '), go: ['service', 'eod'], cta: 'Finish it' });
    var rv = (S.data.reviews || []).filter(function (x) { return x.status === 'draft' && x.due_date && x.due_date <= iso(addDays(new Date(), 14)); }); if (rv.length) out.push({ ic: 'star', tone: 'blue', t: plural(rv.length, 'review') + ' due soon', s: rv.map(function (x) { return empName(x.emp) + ' · ' + dshort(x.due_date); }).join(' · '), go: ['team', 'reviews'], cta: 'Open' });
  }
  return out;
}
function tempAlerts() { var out = []; (S.data.units || []).forEach(function (u) { var r = (S.data.temps || []).filter(function (x) { return x.unit_id === u.id; })[0]; if (r && u.max_f != null && +r.temp_f > +u.max_f) out.push({ u: u, t: (+r.temp_f).toFixed(1) }); }); return out; }
function tonight() {
  var t = iso(), wk = (S.data.weeks || [])[0], day = new Date().getDay(), list = [];
  if (wk) { var sh = (wk.published || wk.shifts || []).filter(function (s) { return s.day === day && iso(addDays(pday(wk.week_start), day)) === t; }); list = sh; }
  return list;
}
PAGES = {};
var PAGES;
PAGES.today = function (el) {
  var items = todayItems();
  el.appendChild(h('h2', { cls: 'section-title', style: 'margin-top:0', text: items.length ? 'Needs you' : 'All clear' }));
  if (!items.length) el.appendChild(h('div', { cls: 'card' }, h('p', { cls: 'empty', text: 'Nothing to fix. New things show up here as they happen — and go away once they’re done.' })));
  var g = h('div', { cls: 'grid g2' }); el.appendChild(g);
  items.forEach(function (x) { g.appendChild(h('div', { cls: 'attn', role: 'button', tabindex: '0', on: { click: function () { go(x.go[0], x.go[1]); } } }, [h('div', { cls: 'ic ' + x.tone }, svg(ICON2[x.ic])), h('div', null, [h('b', { text: x.t }), h('span', { text: x.s })]), h('span', { cls: 'go', text: x.cta + ' →' })])); });

  if (role() === 'owner' && bizWeeks().filter(function (x) { return x.net != null; }).length) {
    var bw = bizWeeks().filter(function (x) { return x.net != null; }), lw = bw[bw.length - 1], pw = bw[bw.length - 2];
    el.appendChild(h('div', { cls: 'card-h', style: 'margin-top:28px' }, [h('h2', { cls: 'section-title', style: 'margin:0', text: 'Last week' }), h('button', { cls: 'btn small', text: 'Business overview', on: { click: function () { go('business', 'overview'); } } })]));
    var gl = h('div', { cls: 'grid g4' }); el.appendChild(gl);
    gl.appendChild(kpiCard('Net sales', money(lw.net, 0), lw.net, pw && pw.net, { sub: 'week of ' + wkLabel(lw.w), spark: bw.slice(-13).map(function (x) { return x.net; }) }));
    gl.appendChild(kpiCard('Labor', pct(lw.laborPct), lw.laborPct, pw && pw.laborPct, { lowerIsBetter: true, sub: 'of sales', spark: bw.slice(-13).map(function (x) { return x.laborPct; }), color: COL.labor }));
    gl.appendChild(kpiCard('Purchases', lw.net ? pct(lw.bought / lw.net) : '—', lw.net ? lw.bought / lw.net : null, pw && pw.net ? pw.bought / pw.net : null, { lowerIsBetter: true, sub: money(lw.bought, 0) + ' on invoices', spark: bw.slice(-13).map(function (x) { return x.net ? x.bought / x.net : null; }), color: COL.purchases }));
    gl.appendChild(kpiCard('Guests', lw.covers ? String(lw.covers) : '—', lw.covers || null, pw && pw.covers, { sub: lw.covers ? money(lw.net / lw.covers) + ' average check' : 'needs end of day reports', spark: bw.slice(-13).map(function (x) { return x.covers || null; }), color: COL.covers }));
  }
  var two = h('div', { cls: 'grid g2', style: 'margin-top:26px' }); el.appendChild(two);
  // who's on tonight
  var sh = tonight(), c1 = h('div', { cls: 'card' }, [h('div', { cls: 'card-h' }, [h('div', null, [h('h2', { text: 'On tonight' }), h('p', { cls: 'sub', text: sh.length ? plural(sh.length, 'person') + ' scheduled' : 'From the published schedule' })]), h('button', { cls: 'btn small', text: 'Schedule', on: { click: function () { go('team', 'schedule'); } } })])]);
  if (sh.length) c1.appendChild(h('div', { cls: 'list' }, sh.map(function (s) { return h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: empName(s.emp) }), h('span', { text: s.role || '' })]), h('span', { cls: 'num', text: t12(s.start) + '–' + t12(s.end || 'close') })]); })));
  else c1.appendChild(h('p', { cls: 'empty', text: 'No one on the published schedule today.' }));
  two.appendChild(c1);
  // coming up + to-dos
  var ev = (S.data.events || []).filter(function (e) { return e.date >= iso() && e.date <= iso(addDays(new Date(), 10)); });
  var c2 = h('div', { cls: 'card' }, [h('div', { cls: 'card-h' }, [h('div', null, [h('h2', { text: 'Coming up' }), h('p', { cls: 'sub', text: 'Next 10 days' })]), h('button', { cls: 'btn small', text: 'Calendar', on: { click: function () { go('calendar', 'agenda'); } } })])]);
  if (ev.length) c2.appendChild(h('div', { cls: 'list' }, ev.map(evRow))); else c2.appendChild(h('p', { cls: 'empty', text: 'Nothing on the calendar.' }));
  two.appendChild(c2);
  var td = S.data.todos || [];
  if (td.length) {
    var c3 = h('div', { cls: 'card', style: 'margin-top:16px' }, [h('h2', { text: 'My to-dos' }), h('p', { cls: 'sub', text: 'From Notes' })]);
    c3.appendChild(h('div', { cls: 'list' }, td.slice(0, 8).map(function (t) { return h('div', { cls: 'row' }, [h('span', { text: '○' }), h('div', { cls: 'main-t' }, [h('b', { text: t.title }), t.details ? h('span', { text: t.details }) : null]), t.due ? h('span', { cls: 'chip' + (t.due < iso() ? ' red' : ''), text: dshort(t.due) }) : null]); })));
    el.appendChild(c3);
  }
};
function evRow(e) { var tone = { supper: 'ember', private: 'blue', catering: 'green', closed: 'red' }[e.type] || ''; return h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: e.title }), h('span', { text: dlong(e.date) + (e.start ? ' · ' + e.start : '') + (e.guests ? ' · ' + e.guests + ' guests' : '') })]), h('span', { cls: 'chip ' + tone, text: e.type || 'event' })]); }

/* =====================================================================================
   SERVICE
   ===================================================================================== */
PAGES['service/tonight'] = function (el) {
  var notes = (S.data.preshift || []).filter(function (n) { return n.service_date >= iso(); });
  var g = h('div', { cls: 'grid g2' }); el.appendChild(g);
  var c = h('div', { cls: 'card' }, [h('h2', { text: 'Pre-shift notes' }), h('p', { cls: 'sub', text: 'What the team needs to know before service' })]);
  if (notes.length) notes.forEach(function (n) { c.appendChild(h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: dlong(n.service_date) + (n.author ? ' · ' + n.author : '') }), h('span', { text: n.body })])])); }); else c.appendChild(h('p', { cls: 'empty', text: 'No pre-shift notes yet.' }));
  g.appendChild(c);
  var sh = tonight(), c2 = h('div', { cls: 'card' }, [h('h2', { text: 'Who’s on' }), h('p', { cls: 'sub', text: 'Tonight, from the published schedule' })]);
  if (sh.length) sh.forEach(function (s) { c2.appendChild(h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: empName(s.emp) }), h('span', { text: s.role || '' })]), h('span', { cls: 'num', text: t12(s.start) + '–' + t12(s.end || 'close') })])); }); else c2.appendChild(h('p', { cls: 'empty', text: 'No one scheduled today.' }));
  g.appendChild(c2);
};
PAGES['service/checklists'] = function (el) {
  el.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Opening & closing checklists' }), h('p', { cls: 'sub', text: 'Same as the live site — they’re just under Service now, next to Pre-shift and End of day, because that’s when they’re used. “Edit checklists” becomes an Edit button on this page for managers, instead of its own menu link.' }),
    h('div', { cls: 'chips' }, ['FOH opening', 'FOH closing', 'Bar opening', 'Bar closing', 'Kitchen closing'].map(function (x) { return h('span', { cls: 'chip', text: x }); }))]));
};
PAGES['service/eod'] = function (el) {
  var rs = S.data.eod; if (!rs) return missing(el, 'end of day reports');
  var c = h('div', { cls: 'card' }, [h('div', { cls: 'card-h' }, [h('div', null, [h('h2', { text: 'End of day reports' }), h('p', { cls: 'sub', text: '“Past reports” and “Download” are now just this list and a button — no separate pages.' })]), h('button', { cls: 'btn small', text: 'Download…', disabled: true })])]);
  var t = h('table', { cls: 't' }, [h('thead', null, h('tr', null, ['Date', 'Covers', 'Reservations', 'Walk-ins', 'Status'].map(function (x, i) { return h('th', { cls: i && i < 4 ? 'r' : '', text: x }); }))), h('tbody', null, rs.map(function (r) { return h('tr', null, [h('td', { text: dlong(r.report_date) }), h('td', { cls: 'r num', text: r.actual_covers == null ? '—' : r.actual_covers }), h('td', { cls: 'r num', text: r.reservations == null ? '—' : r.reservations }), h('td', { cls: 'r num', text: r.walk_ins == null ? '—' : r.walk_ins }), h('td', null, h('span', { cls: 'chip ' + (r.status === 'draft' ? 'gold' : 'green'), text: r.status === 'draft' ? 'Not submitted' : 'Submitted' }))]); }))]);
  c.appendChild(h('div', { cls: 'scrollx' }, t)); el.appendChild(c);
};
PAGES['service/calendar'] = function (el) {
  var ev = S.data.events; if (!ev) return missing(el, 'the calendar');
  var weeks = {}; ev.filter(function (e) { return e.date >= iso(addDays(new Date(), -1)); }).forEach(function (e) { var d = pday(e.date), w = iso(addDays(d, -d.getDay())); (weeks[w] = weeks[w] || []).push(e); });
  var keys = Object.keys(weeks).sort(); if (!keys.length) return el.appendChild(h('p', { cls: 'empty', text: 'Nothing coming up.' }));
  keys.forEach(function (w) { el.appendChild(h('div', { cls: 'card', style: 'margin-bottom:14px' }, [h('h2', { text: 'Week of ' + dshort(w) }), h('div', { cls: 'list' }, weeks[w].map(evRow))])); });
};
PAGES['service/catering'] = function (el) {
  var cs = S.data.catering; if (!cs) return missing(el, 'catering inquiries');
  var cols = [['new', 'New'], ['quoted', 'Quoted / talking'], ['confirmed', 'Confirmed'], ['other', 'Done / declined']];
  var g = h('div', { cls: 'grid g4' }); el.appendChild(h('p', { cls: 'sub', style: 'margin:0 0 12px;color:var(--stone)', text: 'Inquiries and BEOs as one board, left to right as they move along.' }));
  el.appendChild(g);
  cols.forEach(function (c) {
    var list = cs.filter(function (x) { var st = x.status || 'new'; return c[0] === 'other' ? ['new', 'quoted', 'confirmed'].indexOf(st) === -1 : st === c[0] || (c[0] === 'quoted' && /quot|talk|sent|reply/.test(st)); });
    g.appendChild(h('div', { cls: 'card' }, [h('h2', { text: c[1] + ' · ' + list.length }), list.length ? h('div', { cls: 'list' }, list.map(function (x) { return h('div', { cls: 'row' }, h('div', { cls: 'main-t' }, [h('b', { text: x.event_name || x.organization || x.name || 'Inquiry' }), h('span', { text: [x.name, x.event_date ? dshort(x.event_date) : '', x.guests ? x.guests + ' guests' : ''].filter(Boolean).join(' · ') })])); })) : h('p', { cls: 'empty', text: 'None' })]));
  });
};

/* =====================================================================================
   KITCHEN & BAR — inventory split into jobs
   ===================================================================================== */
function kindBar(el, withSub) {
  var bar = h('div', { cls: 'kindbar' });
  fixKind(); KINDS.filter(function (k) { return scopeKinds().length > 1 && scopeKinds().indexOf(k[0]) !== -1; }).forEach(function (k) { bar.appendChild(h('button', { cls: 'pill', 'aria-pressed': S.kind === k[0] ? 'true' : 'false', text: k[1], on: { click: function () { S.kind = k[0]; S.sub = 'all'; render(); } } })); });
  if (withSub && S.kind === 'bev') { if (scopeKinds().length > 1) bar.appendChild(h('span', { cls: 'sep' })); SUBS.forEach(function (k) { bar.appendChild(h('button', { cls: 'pill', 'aria-pressed': S.sub === k[0] ? 'true' : 'false', text: k[1], on: { click: function () { S.sub = k[0]; render(); } } })); }); }
  el.appendChild(bar);
}
function findBox(onq) {
  var inp = h('input', { type: 'search', placeholder: 'Find an item…', value: S.q });
  var x = h('button', { type: 'button', text: '✕', hidden: !S.q, 'aria-label': 'Clear', on: { click: function () { inp.value = ''; S.q = ''; x.hidden = true; onq(); inp.focus(); } } });
  inp.addEventListener('input', function () { S.q = inp.value; x.hidden = !inp.value; onq(); });
  var b = h('div', { cls: 'find' }, [svg(ICON.search), inp, x]); return b;
}
PAGES['kitchen/count'] = function (el) {
  if (!S.data.items) return missing(el, 'the inventory');
  kindBar(el, true);
  var list = items(S.kind, S.sub), open = (S.data.counts || []).filter(function (c) { return c.category === S.kind && c.finished_at === null && c.counts && Object.keys(c.counts).length; })[0];
  var last = latestCount(S.kind, true);
  var draft = S.countDraft[S.kind] = S.countDraft[S.kind] || Object.assign({}, open ? open.counts : {});
  var prog = h('div', { cls: 'progress' }), bar = h('i'), lbl = h('span', { cls: 'num' });
  prog.appendChild(h('div', { cls: 'bar' }, bar)); prog.appendChild(lbl);
  prog.appendChild(h('button', { cls: 'btn accent small', text: 'Save inventory', on: { click: function () {
    var n = list.filter(function (it) { return draft[it.id] != null && draft[it.id] !== ''; }).length;
    if (!n) { toast('Count something first.'); return; }
    var miss = list.length - n, counts = {}; Object.keys(draft).forEach(function (k) { if (draft[k] !== '' && draft[k] != null && isFinite(+draft[k])) counts[k] = +draft[k]; });
    var m = modal('Save the ' + KINDS.filter(function (k) { return k[0] === S.kind; })[0][1].toLowerCase() + ' inventory?', h('p', { text: miss ? miss + ' item' + (miss === 1 ? ' has' : 's have') + ' no number yet. They’ll keep last time’s count.' : 'Everything has a number.' }), [h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Keep counting', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn accent', text: 'Save inventory', on: { click: function () {
      S.data.counts = S.data.counts || [];
      if (open) S.data.counts.splice(S.data.counts.indexOf(open), 1);
      if (last) list.forEach(function (it) { if (counts[it.id] == null && last.counts[it.id] != null) counts[it.id] = last.counts[it.id]; });
      S.data.counts.unshift({ id: uid(), category: S.kind, count_date: open ? open.count_date : iso(), finished_at: new Date().toISOString(), counts: counts });
      S.countDraft[S.kind] = {}; m.close(); changed('Inventory saved — Order, Reports and the graph now use it'); render(); } } })]);
  } } }));
  function paintProg() { var n = list.filter(function (it) { return draft[it.id] != null && draft[it.id] !== ''; }).length; bar.style.width = (list.length ? n / list.length * 100 : 0) + '%'; lbl.textContent = n + ' of ' + list.length + ' counted'; }
  el.appendChild(h('div', { cls: 'toolbar' }, [findBox(filter), h('span', { cls: 'fine', text: (open ? 'Count in progress, started ' + dlong(open.count_date) : 'New count · ' + dlong(iso())) + (last ? ' · last saved count ' + dshort(last.count_date) : '') })]));
  el.appendChild(prog);
  var box = h('div', { cls: 'countlist' }); el.appendChild(box);
  var secs = {}; list.forEach(function (it) { (secs[it.section || 'Other'] = secs[it.section || 'Other'] || []).push(it); });
  Object.keys(secs).forEach(function (s) {
    var wrap = h('div', { 'data-sec': s }); wrap.appendChild(h('div', { cls: 'secthead' }, [s, h('span', { text: plural(secs[s].length, 'item') })]));
    secs[s].forEach(function (it) {
      var lv = last && last.counts[it.id] != null ? last.counts[it.id] : null;
      var inp = h('input', { type: 'text', inputmode: 'decimal', value: draft[it.id] != null ? qty(draft[it.id]) : '', 'aria-label': 'On hand: ' + nameOf(it), placeholder: '' });
      if (inp.value) inp.classList.add('done');
      inp.addEventListener('input', function () { draft[it.id] = inp.value; inp.classList.toggle('done', !!inp.value); paintProg(); });
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var all = [].slice.call(box.querySelectorAll('.crow:not([hidden]) input')), i = all.indexOf(inp); if (all[i + 1]) all[i + 1].focus(); } });
      wrap.appendChild(h('div', { cls: 'crow', 'data-k': norm(nameOf(it) + ' ' + it.name + ' ' + it.vendor) }, [
        h('div', null, [h('b', { text: nameOf(it) }), h('div', { cls: 'meta', text: [it.pack, it.vendor].filter(Boolean).join(' · ') })]),
        h('div', { cls: 'last', html: lv != null ? 'Last: <b class="num">' + qty(lv) + '</b>' : 'Not counted before' }),
        h('div', null, [inp, h('div', { cls: 'unit', text: unitText(it) })])
      ]));
    });
    box.appendChild(wrap);
  });
  function filter() { var q = norm(S.q); [].forEach.call(box.querySelectorAll('[data-sec]'), function (w) { var any = false; [].forEach.call(w.querySelectorAll('.crow'), function (r) { var on = !q || r.getAttribute('data-k').indexOf(q) !== -1; r.hidden = !on; if (on) any = true; }); w.hidden = !any; }); }
  filter(); paintProg();
  el.appendChild(h('p', { cls: 'fine', style: 'margin-top:14px', text: 'Count shows only what you need to count: the name, last time’s number, and a big box. Prices, vendors and menu matching live in Items. Save inventory finishes the count: Order, Use first and Reports update from it straight away. (In this file it’s kept in this tab only.)' }));
};
function unitText(it) { var u = it.unit || 'each', m = String((it.pack || '') + ' ' + it.name).match(/(\d+(?:\.\d+)?)\s*(ml|l)\b/i); return m && /bottle/i.test(u) ? u + ' · ' + m[1] + ' ' + m[2].toLowerCase().replace('l', 'L').replace('mL', 'ml') : u; }
PAGES['kitchen/order'] = function (el) {
  if (!S.data.items) return missing(el, 'the inventory');
  var no = needsOrder().filter(function (x) { return inScope(x.it); }), om = overMax().filter(function (x) { return inScope(x.it); }), vo = (S.data.items || []).filter(function (it) { return inScope(it) && nextVintage(it); });
  var g = h('div', { cls: 'grid g3' }); el.appendChild(g);
  g.appendChild(kpi('Below par', no.length, 'across ' + plural(uniq(no.map(function (x) { return x.it.vendor; })).length, 'vendor')));
  g.appendChild(kpi('Use first', om.length, 'over the maximum — don’t order'));
  if (scopeKinds().indexOf('bev') !== -1) g.appendChild(kpi('Waiting on a new vintage', vo.length, 'old bottle won’t be reordered'));
  var byV = {}; no.forEach(function (x) { (byV[x.it.vendor || 'No vendor'] = byV[x.it.vendor || 'No vendor'] || []).push(x); });
  el.appendChild(h('h2', { cls: 'section-title', text: 'Order by vendor' }));
  if (!no.length) el.appendChild(h('p', { cls: 'empty', text: 'Everything is at or above par at the latest counts.' }));
  var gv = h('div', { cls: 'grid g2' }); el.appendChild(gv);
  Object.keys(byV).sort().forEach(function (v) {
    var est = byV[v].reduce(function (a, x) { return a + (hasCost(x.it) ? x.need * x.it.cost : 0); }, 0);
    gv.appendChild(h('div', { cls: 'card' }, [h('div', { cls: 'card-h' }, [h('div', null, [h('h2', { text: v }), h('p', { cls: 'sub', text: plural(byV[v].length, 'item') + ' · about ' + money(est, 0) })]), h('button', { cls: 'btn small', text: 'Copy list', on: { click: function () { var txt = v + '\n' + byV[v].map(function (x) { return qty(x.need) + ' ' + (x.it.unit || '') + ' ' + nameOf(x.it); }).join('\n'); try { navigator.clipboard.writeText(txt); } catch (e) {} } } })]),
      h('div', { cls: 'list' }, byV[v].map(function (x) { return h('div', { cls: 'row click', on: { click: function () { drawer(x.it); } } }, [h('b', { cls: 'num', style: 'min-width:64px', text: qty(x.need) + ' ' + (x.it.unit || '') }), h('div', { cls: 'main-t' }, [h('b', { text: nameOf(x.it) }), h('span', { text: qty(x.oh) + ' on hand · par ' + qty(x.it.par) })])]); }))]));
  });
  if (om.length) { el.appendChild(h('h2', { cls: 'section-title', text: 'Use first' })); el.appendChild(h('div', { cls: 'card' }, h('div', { cls: 'list' }, om.map(function (x) { return h('div', { cls: 'row click', on: { click: function () { drawer(x.it); } } }, [h('div', { cls: 'main-t' }, [h('b', { text: nameOf(x.it) }), h('span', { text: qty(x.oh) + ' on hand · max ' + qty(x.it.max_qty) })]), h('span', { cls: 'chip blue', text: '+' + qty(x.over) + ' over' })]); })))); }
};
function kpi(label, big, small) { return h('div', { cls: 'kpi' }, [h('span', { text: label }), h('b', { text: String(big) }), h('small', { text: small || '' })]); }
PAGES['kitchen/receive'] = function (el) {
  var inv = S.data.invoices; if (!inv) return missing(el, 'scanned invoices');
  inv = inv.filter(invInScope); var um = unmatched().filter(function (x) { return invInScope(x.v); });
  var g = h('div', { cls: 'grid g3' }); el.appendChild(g);
  var d30 = iso(addDays(new Date(), -30));
  g.appendChild(kpi('Invoices · 30 days', inv.filter(function (v) { return v.invoice_date >= d30; }).length, money(inv.filter(function (v) { return v.invoice_date >= d30; }).reduce(function (a, v) { return a + (+v.total || 0); }, 0), 0) + ' spent'));
  g.appendChild(kpi('Lines to match', um.length, 'once, and the scanner remembers'));
  g.appendChild(h('div', { cls: 'kpi', style: 'display:flex;flex-direction:column;justify-content:center;gap:8px' }, [h('button', { cls: 'btn accent', text: 'Scan an invoice', on: { click: function () { openScanner(); } } }), h('small', { cls: 'fine', text: 'One big button instead of three places to start.' })]));
  if (um.length) { el.appendChild(h('h2', { cls: 'section-title', text: 'Match these' })); el.appendChild(h('div', { cls: 'card' }, h('div', { cls: 'list' }, um.slice(0, 30).map(function (x) { return h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: x.L.description }), h('span', { text: x.v.vendor + ' · ' + dshort(x.v.invoice_date) + (x.L.extended ? ' · ' + money(x.L.extended) : '') })]), h('button', { cls: 'btn small', text: 'Match to an item…', disabled: true })]); })))); }
  el.appendChild(h('h2', { cls: 'section-title', text: 'Recent invoices' }));
  el.appendChild(h('div', { cls: 'card' }, h('div', { cls: 'scrollx' }, h('table', { cls: 't' }, [h('thead', null, h('tr', null, [h('th', { text: 'Date' }), h('th', { text: 'Vendor' }), h('th', { cls: 'r', text: 'Lines matched' }), h('th', { cls: 'r', text: 'Total' })])), h('tbody', null, inv.slice(0, 25).map(function (v) { var ls = (v.lines || []).filter(function (L) { return L && L.description; }), m = ls.filter(function (L) { return L.item_id; }).length; return h('tr', null, [h('td', { text: dlong(v.invoice_date) }), h('td', { text: (v.vendor || '') + (v.invoice_no ? ' · #' + v.invoice_no : '') }), h('td', { cls: 'r' }, h('span', { cls: 'chip ' + (m < ls.length ? 'gold' : 'green'), text: m + ' of ' + ls.length })), h('td', { cls: 'r num', text: money(v.total) })]); }))]))));
};
PAGES['kitchen/items'] = function (el) {
  if (!S.data.items) return missing(el, 'the inventory');
  kindBar(el, true);
  var list = items(S.kind, S.sub);
  var tb = h('div', { cls: 'toolbar' }, [findBox(filter), h('span', { cls: 'sp', style: 'flex:1' }), h('button', { cls: 'btn accent', text: '+ Add item', on: { click: addItem } })]);
  el.appendChild(tb);
  var box = h('div', { cls: 'countlist' }); el.appendChild(box);
  box.appendChild(h('div', { cls: 'irow ihead' }, [h('span', { text: 'Item' }), h('span', { cls: 'hide-s', text: 'Vendor' }), h('span', { cls: 'r hide-s', text: 'Par / max' }), h('span', { cls: 'r', text: 'Cost' }), h('span', { cls: 'hide-s', text: 'Status' })]));
  var rows = [];
  list.forEach(function (it) {
    var oh = onHand(it), st = status(it, oh);
    var r = h('div', { cls: 'irow', 'data-k': norm(nameOf(it) + ' ' + it.name + ' ' + it.vendor + ' ' + it.section), on: { click: function () { drawer(it); } } }, [
      h('div', null, [h('b', { text: nameOf(it) }), h('small', { text: [it.section, it.pack, unitText(it)].filter(Boolean).join(' · ') })]),
      h('div', { cls: 'hide-s' }, [h('span', { text: it.vendor || '—' })]),
      h('div', { cls: 'r num hide-s', text: (it.par != null ? qty(it.par) : '—') + ' / ' + (it.max_qty != null ? qty(it.max_qty) : '—') }),
      h('div', { cls: 'r' }, [h('b', { cls: 'num', text: hasCost(it) ? money(it.cost) : '—' }), it.category === 'bev' && /liquor|wine/.test(subOf(it)) && hasCost(it) ? h('small', { cls: 'num', text: '$' + (it.cost / (bottleMl(it) / 29.5735)).toFixed(2) + '/fl oz' }) : null]),
      h('div', { cls: 'hide-s' }, st ? h('span', { cls: 'chip ' + st[0], text: st[1] }) : null)
    ]);
    rows.push(r); box.appendChild(r);
  });
  function filter() { var q = norm(S.q); rows.forEach(function (r) { r.hidden = q && r.getAttribute('data-k').indexOf(q) === -1; }); }
  filter();
  el.appendChild(h('p', { cls: 'fine', style: 'margin-top:14px', text: 'Five clear columns instead of eighteen. Tap any item to see everything about it, then Edit details to change any of it — name, inventory, section, vendor, units, cost, par and maximum — in one form.' }));
};
function bottleMl(it) { var t = String((it.pack || '') + ' ' + it.name).toLowerCase(), m; if ((m = t.match(/(\d+(?:\.\d+)?)\s*ml\b/))) return +m[1]; if ((m = t.match(/(\d+(?:\.\d+)?)\s*l\b/))) return +m[1] * 1000; return 750; }
function status(it, oh) {
  if (nextVintage(it)) return oh && oh.n <= 0 ? ['red', 'Out — switch menu'] : ['wine', 'New vintage waiting'];
  if (!hasCost(it)) return ['gold', 'No cost'];
  if (oh && it.max_qty != null && oh.n > it.max_qty) return ['blue', 'Use first'];
  if (oh && it.par != null && oh.n < it.par) return ['gold', 'Below par'];
  return null;
}
function drawer(it) {
  var scrim = h('div', { cls: 'scrim' }), d = h('aside', { cls: 'drawer', role: 'dialog', 'aria-label': nameOf(it) });
  var tabs = [['overview', 'Overview'], ['prices', 'Prices'], ['invoice', 'On invoices'], ['menu', 'On the menu'], ['history', 'Counts']], cur = 'overview';
  var body = h('div', { cls: 'drawer-b' });
  var tabbar = h('div', { cls: 'tabs', role: 'tablist' });
  function paint() {
    tabbar.innerHTML = ''; tabs.forEach(function (t) { tabbar.appendChild(h('button', { cls: 'tab', 'aria-selected': t[0] === cur || (cur === 'edit' && t[0] === 'overview') ? 'true' : 'false', text: t[1], on: { click: function () { cur = t[0]; paint(); } } })); });
    body.innerHTML = '';
    var oh = onHand(it), hs = priceHist(it.id);
    if (cur === 'overview') {
      var st = status(it, oh);
      if (st) body.appendChild(h('p', null, h('span', { cls: 'chip ' + st[0], text: st[1] })));
      body.appendChild(h('dl', { cls: 'facts' }, [['Inventory', KINDS.filter(function (k) { return k[0] === it.category; })[0][1] + (it.category === 'bev' ? ' · ' + SUBS.filter(function (s) { return s[0] === subOf(it); })[0][1] : '') + ' · ' + (it.section || 'Other')], ['Our name', nameOf(it)], ['Invoice name', it.name !== nameOf(it) ? it.name : (hs[0] && hs[0].invoice_line) || '—'], ['Vendor', it.vendor || '—'], ['Counted in', unitText(it)], ['Received in', it.order_unit ? it.order_unit + (it.per_case ? ' of ' + it.per_case : '') : 'Same as counted'], ['Cost', hasCost(it) ? money(it.cost) + ' / ' + (it.unit || 'each') : 'None yet'], ['Par · Max', (it.par != null ? qty(it.par) : '—') + ' · ' + (it.max_qty != null ? qty(it.max_qty) : '—')], ['On hand', oh ? qty(oh.n) + ' at the ' + dshort(oh.d) + ' count' : 'Not counted']].reduce(function (a, f) { return a.concat([h('dt', { text: f[0] }), h('dd', { text: f[1] })]); }, [])));
      body.appendChild(h('div', { cls: 'chips', style: 'margin-top:18px' }, [h('button', { cls: 'btn accent', text: 'Edit details', on: { click: function () { cur = 'edit'; paint(); } } }), h('button', { cls: 'btn danger', text: 'Remove', on: { click: function () { removeItem(it, function () { close(); render(); }); } } })]));
    } else if (cur === 'edit') {
      var fm = itemForm(it, false, function () { cur = 'overview'; d.querySelector('.drawer-h h2').textContent = nameOf(it); paint(); render(); });
      body.appendChild(fm.el);
      body.appendChild(h('div', { cls: 'chips', style: 'margin-top:8px' }, [h('button', { cls: 'btn accent', text: 'Save', on: { click: fm.save } }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { cur = 'overview'; paint(); } } })]));
    } else if (cur === 'prices') {
      pricesTab(body, it, function () { paint(); render(); }); return;
      if (!hs.length) { body.appendChild(h('p', { cls: 'empty', text: 'No price history.' })); return; }
      var ph = hs.slice().reverse(), psp = priceSpark(ph); psp.classList.add('clickable'); psp.addEventListener('click', function () { openReport({ x: ph.map(function (p) { return p.price_date; }), xFmt: dshort, xName: 'Date', tipTitle: function (x) { return dlong(x); }, yFmt: function (v) { return money(v); }, auto: true, series: [{ name: 'Cost / ' + (it.unit || 'each'), color: COL.food, values: ph.map(function (p) { return +p.unit_cost; }) }], extraCols: [{ name: 'Vendor', get: function (i) { return ph[i].vendor || ''; } }, { name: 'Invoice line', get: function (i) { return ph[i].invoice_line || ''; } }] }, { title: nameOf(it) + ' — price history', sub: it.vendor || '', noTotal: true, source: 'From scanned invoices and prices entered by hand.' }); });
      body.appendChild(psp);
      body.appendChild(h('table', { cls: 't' }, [h('thead', null, h('tr', null, [h('th', { text: 'Date' }), h('th', { text: 'Vendor' }), h('th', { cls: 'r', text: 'Cost / ' + (it.unit || 'each') })])), h('tbody', null, hs.slice(0, 20).map(function (p) { return h('tr', null, [h('td', { text: dlong(p.price_date) }), h('td', { text: p.vendor || '' }), h('td', { cls: 'r num', text: money(p.unit_cost) })]); }))]));
    } else if (cur === 'invoice') {
      var lines = []; (S.data.invoices || []).forEach(function (v) { (v.lines || []).forEach(function (L) { if (L && L.item_id === it.id) lines.push({ v: v, L: L }); }); });
      var names = uniq(lines.map(function (x) { return x.L.description; }).concat(hs.map(function (p) { return p.invoice_line; })));
      body.appendChild(h('h3', { style: 'font-size:.9rem;margin-bottom:6px', text: 'Names vendors use for it' }));
      body.appendChild(names.length ? h('div', { cls: 'chips', style: 'margin-bottom:16px' }, names.map(function (n) { return h('span', { cls: 'chip', text: n }); })) : h('p', { cls: 'empty', text: 'Not matched yet.' }));
      if (lines.length) body.appendChild(h('table', { cls: 't' }, h('tbody', null, lines.slice(0, 20).map(function (x) { return h('tr', null, [h('td', { text: dshort(x.v.invoice_date) }), h('td', { text: x.v.vendor }), h('td', { cls: 'r num', text: money(x.L.extended) })]); }))));
    } else if (cur === 'menu') {
      var hits = menuHits(it);
      body.appendChild(hits.length ? h('div', { cls: 'list' }, hits.map(function (x) { return h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: x.m.name }), h('span', { text: x.t.label + ' · ' + (x.g.title || '') })]), h('span', { cls: 'num', text: menuPrice(x.m) })]); })) : h('p', { cls: 'empty', text: 'Not on the guest menu.' }));
    } else {
      var rows = (S.data.counts || []).filter(function (c) { return c.category === it.category && c.counts && c.counts[it.id] != null; });
      body.appendChild(rows.length ? h('table', { cls: 't' }, h('tbody', null, rows.slice(0, 24).map(function (c) { return h('tr', null, [h('td', { text: dlong(c.count_date) }), h('td', { cls: 'r num', text: qty(c.counts[it.id]) + ' ' + (it.unit || '') }), h('td', { cls: 'r num', text: hasCost(it) ? money(c.counts[it.id] * it.cost) : '' })]); }))) : h('p', { cls: 'empty', text: 'Never counted.' }));
    }
  }
  function close() { d.classList.remove('on'); scrim.classList.remove('on'); setTimeout(function () { d.remove(); scrim.remove(); }, 250); document.removeEventListener('keydown', esc); }
  function esc(e) { if (e.key === 'Escape') close(); }
  d.appendChild(h('div', { cls: 'drawer-h' }, [h('button', { cls: 'x', text: '✕', 'aria-label': 'Close', on: { click: close } }), h('div', { cls: 'fine', text: it.vendor || '' }), h('h2', { text: nameOf(it) }), tabbar]));
  d.appendChild(body); scrim.addEventListener('click', close); document.addEventListener('keydown', esc);
  document.body.appendChild(scrim); document.body.appendChild(d); paint();
  requestAnimationFrame(function () { scrim.classList.add('on'); d.classList.add('on'); });
}
function menuHits(it) { var out = [], tree = S.data.menuTree || [], k = norm(it.name), k2 = norm(nameOf(it)); tree.forEach(function (t) { (t.groups || []).forEach(function (g) { (g.items || []).forEach(function (m) { if (!m || !m.name) return; var mn = norm(m.name); if (mn === k || mn === k2 || (k.length > 6 && mn.indexOf(k) !== -1) || (it.menu_refs || []).some(function (r) { return r.name === m.name; })) out.push({ t: t, g: g, m: m }); }); }); }); return out; }
function menuPrice(m) { return m.glass || m.bottle ? [m.glass ? '$' + m.glass + ' gl' : '', m.bottle ? '$' + m.bottle + ' btl' : ''].filter(Boolean).join(' · ') : m.price ? '$' + String(m.price).replace(/^\$/, '') : ''; }
function priceSpark(ps) {
  var W = 500, H = 120, P = 10, ys = ps.map(function (p) { return +p.unit_cost; }), mn = Math.min.apply(null, ys), mx = Math.max.apply(null, ys); if (mx === mn) { mx += 1; mn -= 1; }
  var X = function (i) { return P + i / Math.max(1, ps.length - 1) * (W - 2 * P); }, Y = function (v) { return P + (1 - (v - mn) / (mx - mn)) * (H - 2 * P); };
  var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('viewBox', '0 0 ' + W + ' ' + H); s.setAttribute('style', 'width:100%;height:auto;margin-bottom:12px');
  s.innerHTML = '<path d="' + ps.map(function (p, i) { return (i ? 'L' : 'M') + X(i) + ' ' + Y(+p.unit_cost); }).join('') + '" fill="none" stroke="#b0703f" stroke-width="2.5"/>' + ps.map(function (p, i) { return '<circle cx="' + X(i) + '" cy="' + Y(+p.unit_cost) + '" r="4" fill="#b0703f" stroke="#fff" stroke-width="2"/>'; }).join('');
  return s;
}
PAGES['kitchen/reports'] = function (el) {
  if (!S.data.counts) return missing(el, 'inventory counts');
  var g = h('div', { cls: 'grid g4' }); el.appendChild(g);
  var tot = 0; KINDS.filter(function (k) { return scopeKinds().indexOf(k[0]) !== -1; }).forEach(function (k) { var r = latestCount(k[0], true), v = value(r); tot += v; g.appendChild(kpi(k[1], money(v, 0), r ? 'counted ' + dshort(r.count_date) : 'not counted')); });
  g.appendChild(kpi(S.space === 'bar' ? 'Bar on hand' : S.space === 'kitchen' ? 'Kitchen on hand' : 'All on hand', money(tot, 0), 'at today’s costs'));
  el.appendChild(h('h2', { cls: 'section-title', text: 'Inventory over time' }));
  var tcard = h('div', { cls: 'card clickable' }, [trend(), h('button', { cls: 'replink', text: 'Open the full report →' })]);
  tcard.addEventListener('click', function () { if (S._trendRep && S._trendRep.x.length) openReport(S._trendRep, { title: 'Inventory value over time', sub: 'Value on hand at each saved count, at today’s costs', noTotal: true, source: 'From saved inventory counts.' }); });
  el.appendChild(tcard);
};
function trend() {
  var rows = (S.data.counts || []).filter(function (c) { return c.finished_at !== null && c.counts && Object.keys(c.counts).length; }).sort(function (a, b) { return a.count_date < b.count_date ? -1 : 1; });
  var m = byId(), series = { all: [], food: [], beer: [], wine: [], liquor: [], na: [] }, last = {};
  rows.forEach(function (r) { var v = { food: 0, beer: 0, wine: 0, liquor: 0, na: 0, tot: 0 }; Object.keys(r.counts).forEach(function (id) { var it = m[id]; if (!it || !hasCost(it)) return; var x = r.counts[id] * it.cost, k = r.category === 'bev' ? subOf(it) : r.category; if (v[k] != null) v[k] += x; v.tot += x; }); last[r.category] = v.tot; if (r.category === 'food') series.food.push([r.count_date, v.food]); if (r.category === 'bev') ['beer', 'wine', 'liquor', 'na'].forEach(function (k) { series[k].push([r.count_date, v[k]]); }); series.all.push([r.count_date, (last.food || 0) + (last.bev || 0) + (last.paper || 0)]); });
  if (!rows.length) return h('p', { cls: 'empty', text: 'Starts once an inventory is saved.' });
  var cols = { all: '#24221f', food: '#b0703f', beer: '#c9971c', wine: '#7d2a3c', liquor: '#2f6690', na: '#3f8a5a' }, labels = { all: 'All', food: 'Food', beer: 'Beer', wine: 'Wine', liquor: 'Liquor', na: 'Non-alcoholic' };
  var keep = S.space === 'bar' ? ['beer', 'wine', 'liquor', 'na'] : S.space === 'kitchen' ? ['food'] : null; if (keep) Object.keys(labels).forEach(function (k) { if (keep.indexOf(k) === -1) { delete labels[k]; delete series[k]; } });
  var W = 900, H = 240, L = 56, R = 14, T = 10, B = 26, xs = rows.map(function (r) { return pday(r.count_date).getTime(); }), x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs); if (x1 === x0) x1 = x0 + 864e5;
  var ymax = 1; Object.keys(series).forEach(function (k) { series[k].forEach(function (p) { ymax = Math.max(ymax, p[1]); }); }); ymax *= 1.1;
  var X = function (d) { return L + (pday(d).getTime() - x0) / (x1 - x0) * (W - L - R); }, Y = function (v) { return T + (1 - v / ymax) * (H - T - B); };
  var s = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;height:auto">';
  for (var i = 0; i <= 4; i++) { var v = ymax * i / 4; s += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(v) + '" y2="' + Y(v) + '" stroke="rgba(0,0,0,' + (i ? .07 : .25) + ')"/><text x="' + (L - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end" font-size="11" fill="#8b867c">$' + Math.round(v / 1000 * 10) / 10 + 'k</text>'; }
  uniq(rows.map(function (r) { return r.count_date; })).forEach(function (d) { s += '<text x="' + X(d) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#8b867c">' + dshort(d) + '</text>'; });
  Object.keys(series).forEach(function (k) { var ps = series[k]; if (!ps.length) return; s += '<path d="' + ps.map(function (p, i) { return (i ? 'L' : 'M') + X(p[0]).toFixed(1) + ' ' + Y(p[1]).toFixed(1); }).join('') + '" fill="none" stroke="' + cols[k] + '" stroke-width="' + (k === 'all' ? 3 : 2) + '"/>'; ps.forEach(function (p) { s += '<circle cx="' + X(p[0]) + '" cy="' + Y(p[1]) + '" r="3.5" fill="' + cols[k] + '" stroke="#fff" stroke-width="2"><title>' + labels[k] + ' · ' + dshort(p[0]) + ' · ' + money(p[1], 0) + '</title></circle>'; }); });
  s += '</svg>';
  var dts = uniq(rows.map(function (r) { return r.count_date; }));
  S._trendRep = { x: dts, xFmt: dshort, xName: 'Count', tipTitle: function (x) { return 'Counted ' + dlong(x); }, yFmt: k$, series: Object.keys(labels).filter(function (k) { return series[k] && series[k].length; }).map(function (k) { return { name: labels[k], color: cols[k], values: dts.map(function (d) { var p = series[k].filter(function (q) { return q[0] === d; })[0]; return p ? p[1] : null; }), fmt: function (v) { return money(v, 0); } }; }) };
  return h('div', null, [h('div', { cls: 'chips', style: 'margin-bottom:8px' }, Object.keys(labels).map(function (k) { return h('span', { cls: 'chip', html: '<i style="width:14px;height:3px;border-radius:2px;background:' + cols[k] + ';display:inline-block"></i>' + labels[k] }); })), h('div', { html: s })]);
}
PAGES['kitchen/recipes'] = function (el) {
  var rs = S.data.recipes; if (!rs) return missing(el, 'recipes');
  var cats = {}; rs.forEach(function (r) { (cats[r.category || 'Other'] = cats[r.category || 'Other'] || []).push(r); });
  var g = h('div', { cls: 'grid g2' }); el.appendChild(g);
  Object.keys(cats).sort().forEach(function (c) { g.appendChild(h('div', { cls: 'card' }, [h('h2', { text: c }), h('p', { cls: 'sub', text: plural(cats[c].length, 'recipe') }), h('div', { cls: 'list' }, cats[c].map(function (r) { return h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: r.name }), h('span', { text: [r.yield_qty ? 'Makes ' + qty(r.yield_qty) + ' ' + (r.yield_unit || '') : '', plural((r.ingredients || []).filter(function (i) { return !i.head; }).length, 'ingredient')].filter(Boolean).join(' · ') })])]); }))])); });
};
PAGES['kitchen/builds'] = function (el) {
  var bs = S.data.builds; if (!bs) return missing(el, 'cocktail builds');
  var g = h('div', { cls: 'grid g3' }); el.appendChild(g);
  bs.forEach(function (b) { g.appendChild(h('div', { cls: 'card' }, [h('h2', { text: b.name }), h('p', { cls: 'sub', text: [b.glass, b.ice, b.garnish].filter(Boolean).join(' · ') }), h('div', { cls: 'list' }, (b.ingredients || []).map(function (gx) { return h('div', { cls: 'row', style: 'min-height:0;padding:6px 0' }, [h('b', { cls: 'num', style: 'min-width:58px', text: (gx.qty != null ? qty(gx.qty) + ' ' : '') + (gx.unit || '') }), h('span', { text: gx.item })]); }))])); });
};
PAGES['kitchen/temps'] = function (el) {
  var us = S.data.units; if (!us) return missing(el, 'temperature units');
  var g = h('div', { cls: 'grid g3' }); el.appendChild(g);
  us.forEach(function (u) { var r = (S.data.temps || []).filter(function (x) { return x.unit_id === u.id; })[0], hot = r && u.max_f != null && +r.temp_f > +u.max_f; g.appendChild(h('div', { cls: 'kpi', style: hot ? 'border-color:var(--red);background:var(--red-soft)' : '' }, [h('span', { text: u.name }), h('b', { text: r ? (+r.temp_f).toFixed(1) + '°F' : '—' }), h('small', { text: r ? (hot ? 'Too warm · ' : 'OK · ') + new Date(r.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : 'No reading' })])); });
};

/* =====================================================================================
   MENU
   ===================================================================================== */
PAGES['menu/guest'] = function (el) {
  var tree = S.data.menuTree; if (!tree) return missing(el, 'the menu');
  var which = S.menuTab || tree[0].id, cur = tree.filter(function (t) { return t.id === which; })[0] || tree[0];
  el.appendChild(h('div', { cls: 'kindbar' }, tree.map(function (t) { return h('button', { cls: 'pill', 'aria-pressed': t.id === cur.id ? 'true' : 'false', text: t.label, on: { click: function () { S.menuTab = t.id; render(); } } }); })));
  var vo = vintageOut(); if (vo.length) el.appendChild(h('div', { cls: 'attn', style: 'margin-bottom:16px;border-color:#c98b8b;background:var(--red-soft)' }, [h('div', { cls: 'ic wine' }, svg(ICON2.wine)), h('div', null, [h('b', { text: vo.map(function (x) { return x.old.name; }).join(', ') + ' ran out' }), h('span', { text: 'Change it to ' + vo.map(function (x) { return x.nw.name; }).join(', ') + ' on this list.' })])]));
  el.appendChild(h('div', { cls: 'card' }, h('div', { cls: 'menucols' }, (cur.groups || []).map(function (g) { return h('div', { cls: 'mgroup' }, [h('h3', { text: g.title || '' }), (g.items || []).filter(Boolean).map(function (m) { return h('div', { cls: 'mitem' + (m.hidden ? ' off' : '') }, [h('div', null, [h('b', { text: m.name }), m.desc || m.grape ? h('span', { text: m.desc || [m.grape, m.appellation].filter(Boolean).join(' · ') }) : null]), h('span', { cls: 'p', text: menuPrice(m) })]); })]); }))));
  el.appendChild(h('p', { cls: 'fine', style: 'margin-top:12px', text: 'In the new layout this page is the menu editor too: tap a line to edit it, and its cost % shows right beside the price.' }));
};
PAGES['menu/costs'] = function (el) {
  var tree = S.data.menuTree; if (!tree || !S.data.items) return missing(el, 'the menu and inventory');
  var rows = [];
  tree.forEach(function (t) { if (!/wine|spirit/i.test(t.id + ' ' + t.label)) return; (t.groups || []).forEach(function (g) { (g.items || []).forEach(function (m) { if (!m || !m.name) return; var it = (S.data.items || []).filter(function (x) { return norm(x.name) === norm(m.name) || (x.menu_refs || []).some(function (r) { return r.name === m.name; }); })[0]; if (!it || !hasCost(it)) return; var ml = bottleMl(it), wine = /wine/i.test(t.id + t.label); if (wine && m.bottle) rows.push({ m: m, t: t, it: it, how: 'bottle', price: +m.bottle, cost: +it.cost }); if (wine && m.glass) rows.push({ m: m, t: t, it: it, how: '5 oz glass', price: +m.glass, cost: it.cost * 147.87 / ml }); if (!wine && m.price) rows.push({ m: m, t: t, it: it, how: '1.5 oz pour', price: +m.price, cost: it.cost * 44.36 / ml }); }); }); });
  if (!rows.length) return el.appendChild(h('p', { cls: 'empty', text: 'No wines or spirits matched to inventory costs yet.' }));
  rows.sort(function (a, b) { return b.cost / b.price - a.cost / a.price; });
  el.appendChild(h('div', { cls: 'card' }, h('div', { cls: 'scrollx' }, h('table', { cls: 't' }, [h('thead', null, h('tr', null, [h('th', { text: 'On the menu' }), h('th', { text: 'Serving' }), h('th', { cls: 'r', text: 'Price' }), h('th', { cls: 'r', text: 'Cost' }), h('th', { cls: 'r', text: 'Cost %' })])), h('tbody', null, rows.map(function (r) { var p = r.cost / r.price; return h('tr', null, [h('td', null, [h('b', { text: r.m.name, style: 'font-weight:500' })]), h('td', { text: r.how }), h('td', { cls: 'r num', text: money(r.price) }), h('td', { cls: 'r num', text: money(r.cost) }), h('td', { cls: 'r' }, h('span', { cls: 'chip ' + (p >= .35 ? 'red' : p >= .28 ? 'gold' : 'green'), text: Math.round(p * 1000) / 10 + '%' }))]); }))]))));
};
PAGES['menu/events'] = function (el) {
  var ev = (S.data.events || []).filter(function (e) { return /supper|other/.test(e.type || '') && e.date >= iso(); });
  el.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Supper Club & special events' }), h('p', { cls: 'sub', text: 'Ticketed dinners and classes, with their own menus' }), ev.length ? h('div', { cls: 'list' }, ev.map(evRow)) : h('p', { cls: 'empty', text: 'None coming up.' })]));
};

/* =====================================================================================
   TEAM
   ===================================================================================== */
PAGES['team/schedule'] = function (el) {
  var wk = (S.data.weeks || [])[0]; if (!wk) return missing(el, 'the schedule');
  var start = pday(wk.week_start), shifts = wk.published || wk.shifts || [], t = iso();
  el.appendChild(h('div', { cls: 'toolbar' }, [h('b', { text: 'Week of ' + dshort(wk.week_start) }), h('span', { cls: 'chip ' + (wk.status === 'published' ? 'green' : 'gold'), text: wk.status === 'published' ? 'Published' : 'Draft' })]));
  var grid = h('div', { cls: 'week' });
  for (var d = 0; d < 7; d++) { var day = addDays(start, d), ds = shifts.filter(function (s) { return s.day === d; }); grid.appendChild(h('div', { cls: 'day' + (iso(day) === t ? ' today' : '') }, [h('h3', null, [day.toLocaleDateString(undefined, { weekday: 'short' }), h('span', { text: dshort(iso(day)) })])].concat(ds.map(function (s) { var r = String(s.role || '').toLowerCase(); return h('div', { cls: 'shift ' + (/line|sous|cook|dish|prep|kitchen/.test(r) ? 'k' : /bar/.test(r) ? 'b' : 'f') }, [h('b', { text: empName(s.emp) }), s.start + '–' + s.end + (s.role ? ' · ' + s.role : '')]); })))); }
  el.appendChild(h('div', { cls: 'scrollx' }, grid));
  el.appendChild(h('p', { cls: 'fine', style: 'margin-top:10px', text: 'Kitchen, bar and floor shifts are colour-coded, so the week reads at a glance.' }));
};
PAGES['team/people'] = function (el) {
  var es = S.data.employees; if (!es) return missing(el, 'the roster');
  var act = es.filter(function (e) { return e.active !== false && !e.removed_at; });
  el.appendChild(h('div', { cls: 'card' }, [h('h2', { text: plural(act.length, 'person') + ' on the team' }), h('p', { cls: 'sub', text: 'Who can see what on the staff page is under Permissions, the next tab.' }), h('div', { cls: 'list' }, act.map(function (e) { return h('div', { cls: 'row' }, [h('div', { cls: 'me', style: 'border:0;padding:0;margin:0' }, h('div', { cls: 'av', text: initials(e.name) })), h('div', { cls: 'main-t' }, [h('b', { text: e.name }), h('span', { text: e.position || '' })])]); }))]));
};
PAGES['team/timeoff'] = function (el) {
  var to = S.data.timeoff; if (!to) return missing(el, 'time off');
  el.appendChild(h('div', { cls: 'card' }, to.length ? h('div', { cls: 'list' }, to.map(function (x) { return h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: empName(x.emp) }), h('span', { text: dshort(x.start_date) + ' – ' + dshort(x.end_date) + (x.reason ? ' · ' + x.reason : '') })]), h('span', { cls: 'chip ' + (x.status === 'pending' ? 'gold' : x.status === 'approved' ? 'green' : 'red'), text: x.status })]); })) : h('p', { cls: 'empty', text: 'No requests.' })));
};
PAGES['team/reviews'] = function (el) {
  var rv = S.data.reviews; if (!rv) return missing(el, 'reviews');
  el.appendChild(h('div', { cls: 'card' }, rv.length ? h('div', { cls: 'list' }, rv.map(function (x) { return h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: empName(x.emp) }), h('span', { text: (x.position || '') + ' · ' + dshort(x.due_date || x.review_date) })]), h('span', { cls: 'chip ' + (x.status === 'signed' ? 'green' : x.status === 'shared' ? 'blue' : 'gold'), text: x.status })]); })) : h('p', { cls: 'empty', text: 'No reviews.' })));
};

/* =====================================================================================
   BUSINESS (owner)
   ===================================================================================== */
PAGES['business/payroll'] = function (el) {
  var ws = S.data.payweeks; if (!ws) return missing(el, 'payroll');
  el.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Pay weeks' }), h('p', { cls: 'sub', text: 'Payroll, Past payroll and Pay rates become one page: this list, with rates as a button.' }), h('div', { cls: 'list' }, ws.slice(0, 12).map(function (w) { var sm = w.summary || {}; return h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: 'Week of ' + dshort(w.week_start) }), h('span', { text: [sm.net ? money(sm.net, 0) + ' sales' : '', sm.tips ? money(sm.tips, 0) + ' tips' : ''].filter(Boolean).join(' · ') })]), h('span', { cls: 'chip ' + (w.status === 'final' ? 'green' : 'gold'), text: w.status === 'final' ? 'Done' : 'Draft' })]); }))]));
};
PAGES['business/marketing'] = function (el) {
  var ps = S.data.promos; if (!ps) return missing(el, 'promotional emails');
  el.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Promotional emails' }), h('div', { cls: 'list' }, ps.map(function (p) { return h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, [h('b', { text: p.subject || '(no subject)' }), h('span', { text: p.sent_at ? 'Sent ' + new Date(p.sent_at).toLocaleDateString() : p.scheduled_at ? 'Scheduled ' + new Date(p.scheduled_at).toLocaleDateString() : '' })]), h('span', { cls: 'chip ' + (p.status === 'sent' ? 'green' : p.status === 'draft' ? '' : 'blue'), text: p.status })]); }))]));
};
PAGES['business/website'] = function (el) {
  el.appendChild(h('div', { cls: 'grid g2' }, [h('div', { cls: 'card' }, [h('h2', { text: 'Analytics & history' }), h('p', { cls: 'sub', text: 'Visits to edencny.com and staff logins — unchanged, just filed under Business.' })]), h('div', { cls: 'card' }, [h('h2', { text: 'Partner stories' }), h('p', { cls: 'sub', text: 'The farms and makers on the public site.' })])]));
};

/* =====================================================================================
   BUSINESS — where the business is at a glance (Overview), then the detail behind it
   ===================================================================================== */
var COL = { food: '#b0703f', bev: '#2f5f8a', paper: '#d9b441', other: '#a39d93', labor: '#7d2a3c', purchases: '#3f6b4f', prime: '#0f1215', covers: '#2f5f8a', check: '#b0703f', ly: '#a39d93' };
function sunday(d) { d = typeof d === 'string' ? pday(d) : new Date(d); return iso(addDays(d, -d.getDay())); }
function pct(v, d) { return v == null || !isFinite(v) ? '—' : (v * 100).toFixed(d == null ? 1 : d) + '%'; }
function k$(v) { if (v == null || !isFinite(v)) return '—'; var a = Math.abs(v); return (v < 0 ? '−' : '') + '$' + (a >= 1e6 ? (a / 1e6).toFixed(1) + 'M' : a >= 1e4 ? Math.round(a / 1e3) + 'k' : a >= 1e3 ? (a / 1e3).toFixed(1) + 'k' : Math.round(a)); }
function wkLabel(w) { return pday(w).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }

// every week, everything we know about it: sales and labor (payroll), covers (end of day), purchases (scanned invoices)
function bizWeeks() {
  if (S._biz && S._biz.v === S.dataVer) return S._biz.weeks;
  var W = {};
  function wk(w) { return W[w] = W[w] || { w: w, net: null, food: null, bev: null, labor: null, laborPct: null, tips: null, hours: null, wagesBy: null, covers: 0, nights: 0, buy: { food: 0, bev: 0, paper: 0, other: 0 }, bought: 0, vendors: {} }; }
  (S.data.payweeks || []).forEach(function (p) { var s = p.summary; if (!s || !s.net) return; var x = wk(p.week_start); x.net = +s.net; x.food = s.food != null ? +s.food : null; x.bev = s.bev != null ? +s.bev : null; x.labor = s.cost != null ? +s.cost : null; x.laborPct = s.pct != null ? +s.pct : (x.labor != null ? x.labor / x.net : null); x.tips = s.tips != null ? +s.tips : null; x.hours = s.hours != null ? +s.hours : null; x.wagesBy = s.wagesBy || null; });
  (S.data.eodAll || S.data.eod || []).forEach(function (r) { if (r.actual_covers == null) return; var x = wk(sunday(r.report_date)); x.covers += +r.actual_covers; x.nights++; });
  var m = byId();
  (S.data.invoices || []).forEach(function (v) {
    if (!v.invoice_date) return; var x = wk(sunday(v.invoice_date)), g = { food: 0, bev: 0, paper: 0 }, loose = 0;
    (v.lines || []).forEach(function (L) { var a = +L.extended || 0, it = L.item_id && m[L.item_id]; if (it && g[it.category] != null) g[it.category] += a; else loose += a; });
    var top = Object.keys(g).sort(function (a, b) { return g[b] - g[a]; })[0], lsum = g.food + g.bev + g.paper + loose, tot = +v.total > 0 ? +v.total : lsum;
    if (!(g.food + g.bev + g.paper)) { x.buy.other += tot; } else { g[top] += loose; Object.keys(g).forEach(function (k) { x.buy[k] += lsum ? g[k] * tot / lsum : 0; }); }
    x.bought += tot; x.vendors[v.vendor || 'Unknown'] = (x.vendors[v.vendor || 'Unknown'] || 0) + tot;
  });
  var weeks = Object.keys(W).sort().map(function (k) { return W[k]; }).filter(function (x) { return x.w <= iso(); });
  S._biz = { v: S.dataVer, weeks: weeks };
  return weeks;
}
function rangeWeeks() { var n = S.bizRange || 13, all = bizWeeks().filter(function (x) { return x.net != null; }); return all.slice(-n); }
function sum(list, f) { return list.reduce(function (a, x) { var v = f(x); return a + (v == null || !isFinite(v) ? 0 : v); }, 0); }
function rangeBar(el) {
  var seg = h('div', { cls: 'seg', role: 'group', 'aria-label': 'Period' }, [[4, '4 weeks'], [13, '13 weeks'], [26, '6 months'], [52, '1 year']].map(function (o) { return h('button', { 'aria-pressed': (S.bizRange || 13) === o[0] ? 'true' : 'false', text: o[1], on: { click: function () { S.bizRange = o[0]; render(); } } }); }));
  var w = rangeWeeks();
  el.appendChild(h('div', { cls: 'toolbar', style: 'justify-content:space-between' }, [h('span', { cls: 'fine', text: w.length ? 'Weeks of ' + wkLabel(w[0].w) + ' – ' + wkLabel(w[w.length - 1].w) + ' · from payroll, end of day reports and scanned invoices' : '' }), seg]));
}

/* ---------- charts drawn at their real size, redrawn when the window changes ---------- */
function chart(spec) {
  var box = h('div', { cls: 'chart' + (spec.size ? ' ' + spec.size : '') }), tip = h('div', { cls: 'tip', hidden: true });
  var NS = 'http://www.w3.org/2000/svg', svgEl = document.createElementNS(NS, 'svg');
  box.appendChild(svgEl); box.appendChild(tip);
  var fy = spec.yFmt || k$, n = spec.x.length;
  function draw() {
    var W = box.clientWidth, H = box.clientHeight; if (!W || !H) return;
    var L = spec.left || 52, R = 10, T = 10, B = 26, iw = W - L - R, ih = H - T - B;
    var vals = [];
    spec.series.forEach(function (s) { s.values.forEach(function (v, i) { if (v == null) return; if (spec.stack && s.kind !== 'line' && s.kind !== 'dash') { vals.push(spec.series.filter(function (q) { return q.kind !== 'line' && q.kind !== 'dash'; }).reduce(function (a, q) { return a + (q.values[i] || 0); }, 0)); } else vals.push(v); }); });
    if (spec.target != null) vals.push(spec.target);
    var max = Math.max.apply(null, vals.concat([0])) || 1, min = spec.min != null ? spec.min : 0;
    if (spec.auto && vals.length) { var lo = Math.min.apply(null, vals), sp = (max - lo) || max * .1, st0 = Math.pow(10, Math.floor(Math.log10(sp))); min = Math.max(0, Math.floor((lo - sp * .35) / st0) * st0); }
    var step = Math.pow(10, Math.floor(Math.log10((max - min) || 1))), nice = [1, 2, 2.5, 5, 10].map(function (k) { return k * step; }).filter(function (v) { return (max - min) / v <= 5; })[0] || step * 10;
    max = Math.ceil(max / nice) * nice;
    var X = function (i) { return L + (n <= 1 ? iw / 2 : (spec.bars ? (i + .5) * iw / n : i * iw / (n - 1))); }, Y = function (v) { return T + (1 - (v - min) / (max - min)) * ih; };
    var out = '';
    for (var g = min; g <= max + 1e-9; g += nice) out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(g).toFixed(1) + '" y2="' + Y(g).toFixed(1) + '" stroke="' + (g === min ? '#cfd1cd' : '#efefec') + '"/><text x="' + (L - 8) + '" y="' + (Y(g) + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="#6b7079">' + esc(fy(g)) + '</text>';
    var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(iw / 64))));
    spec.x.forEach(function (x, i) { if (i % every && i !== n - 1) return; out += '<text x="' + X(i).toFixed(1) + '" y="' + (H - 8) + '" text-anchor="middle" font-size="11" fill="#6b7079">' + esc(spec.xFmt ? spec.xFmt(x) : x) + '</text>'; });
    var bw = Math.max(3, Math.min(34, iw / n * .62)), barS = spec.series.filter(function (s) { return s.kind !== 'line' && s.kind !== 'dash'; });
    if (spec.bars) {
      spec.x.forEach(function (x, i) {
        if (spec.stack) { var acc = 0; barS.forEach(function (s, k) { var v = s.values[i]; if (!v) return; var y0 = Y(acc), y1 = Y(acc + v); acc += v; out += '<rect x="' + (X(i) - bw / 2).toFixed(1) + '" y="' + y1.toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + Math.max(0, y0 - y1 - (k < barS.length - 1 ? 1 : 0)).toFixed(1) + '" fill="' + s.color + '" rx="' + (k === barS.length - 1 ? 2 : 0) + '"/>'; }); }
        else { var gw = bw / barS.length; barS.forEach(function (s, k) { var v = s.values[i]; if (v == null) return; out += '<rect x="' + (X(i) - bw / 2 + k * gw).toFixed(1) + '" y="' + Y(v).toFixed(1) + '" width="' + Math.max(2, gw - 1).toFixed(1) + '" height="' + Math.max(0, Y(min) - Y(v)).toFixed(1) + '" fill="' + s.color + '" rx="2"/>'; }); }
      });
    }
    if (spec.target != null) out += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + Y(spec.target).toFixed(1) + '" y2="' + Y(spec.target).toFixed(1) + '" stroke="#b4372a" stroke-dasharray="4 4" stroke-width="1.2"/><rect x="' + (L + 4) + '" y="' + (Y(spec.target) - 17).toFixed(1) + '" width="' + (esc(spec.targetLabel || 'Target').length * 5.6 + 8) + '" height="14" rx="3" fill="#fff" opacity=".9"/><text x="' + (L + 8) + '" y="' + (Y(spec.target) - 6).toFixed(1) + '" font-size="10.5" fill="#b4372a">' + esc(spec.targetLabel || 'Target') + '</text>';
    spec.series.forEach(function (s) {
      if (s.kind !== 'line' && s.kind !== 'dash' && spec.bars) return;
      var d = '', pen = false; s.values.forEach(function (v, i) { if (v == null) { pen = false; return; } d += (pen ? 'L' : 'M') + X(i).toFixed(1) + ' ' + Y(v).toFixed(1); pen = true; });
      out += '<path d="' + d + '" fill="none" stroke="' + s.color + '" stroke-width="' + (s.width || 2) + '" stroke-linejoin="round" stroke-linecap="round"' + (s.kind === 'dash' ? ' stroke-dasharray="5 4"' : '') + '/>';
      if (n <= 26 && s.kind !== 'dash') s.values.forEach(function (v, i) { if (v != null) out += '<circle cx="' + X(i).toFixed(1) + '" cy="' + Y(v).toFixed(1) + '" r="3" fill="' + s.color + '" stroke="#fff" stroke-width="1.5"/>'; });
    });
    out += '<line class="cx" x1="0" x2="0" y1="' + T + '" y2="' + (T + ih) + '" stroke="#15171a" stroke-opacity=".25" visibility="hidden"/><rect class="hit" x="' + L + '" y="' + T + '" width="' + iw + '" height="' + ih + '" fill="transparent"/>';
    svgEl.setAttribute('viewBox', '0 0 ' + W + ' ' + H); svgEl.innerHTML = out;
    var hit = svgEl.querySelector('.hit'), cx = svgEl.querySelector('.cx');
    function show(px) {
      var i = spec.bars ? Math.floor((px - L) / (iw / n)) : Math.round((px - L) / (iw / Math.max(1, n - 1))); i = Math.max(0, Math.min(n - 1, i));
      cx.setAttribute('x1', X(i)); cx.setAttribute('x2', X(i)); cx.setAttribute('visibility', 'visible');
      tip.innerHTML = ''; tip.hidden = false; tip.appendChild(h('b', { text: spec.tipTitle ? spec.tipTitle(spec.x[i], i) : String(spec.x[i]) }));
      spec.series.forEach(function (s) { var v = s.values[i]; if (v == null) return; tip.appendChild(h('div', null, [h('i', { style: 'background:' + s.color }), h('span', { text: s.name }), h('em', { text: (s.fmt || fy)(v) })])); });
      if (spec.tipExtra) { var ex = spec.tipExtra(i); if (ex) tip.appendChild(h('div', null, [h('i', { style: 'background:transparent' }), h('span', { text: ex[0] }), h('em', { text: ex[1] })])); }
      var left = X(i) + 14; if (left + tip.offsetWidth > W) left = X(i) - tip.offsetWidth - 14; tip.style.left = Math.max(0, left) + 'px';
    }
    hit.addEventListener('pointermove', function (e) { var r = svgEl.getBoundingClientRect(); show(e.clientX - r.left); });
    hit.addEventListener('pointerdown', function (e) { var r = svgEl.getBoundingClientRect(); show(e.clientX - r.left); });
    hit.addEventListener('pointerleave', function () { tip.hidden = true; cx.setAttribute('visibility', 'hidden'); });
  }
  requestAnimationFrame(draw);
  function rep() { if (spec._noReport) return; var card = box.closest('.card'), h2 = card && card.querySelector('h2'), sb = card && card.querySelector('.sub'); openReport(spec, { title: spec.title || (h2 ? h2.textContent : 'Report'), sub: sb ? sb.textContent : '' }); }
  if (!spec._noReport) box.addEventListener('click', rep);
  if (window.ResizeObserver) { var lw = 0; var ro = new ResizeObserver(function () { if (Math.abs(box.clientWidth - lw) > 4) { lw = box.clientWidth; draw(); } }); ro.observe(box); }
  var legend = h('div', { cls: 'legend' }, spec.series.filter(function (s) { return !s.noLegend; }).map(function (s) { return h('span', null, [h('i', { cls: s.kind === 'line' ? 'line' : s.kind === 'dash' ? 'dash' : '', style: (s.kind === 'dash' ? 'color:' : 'background:') + s.color }), s.name]); }).concat(spec.target != null ? [h('span', null, [h('i', { cls: 'dash', style: 'color:#b4372a' }), spec.targetLabel || 'Target'])] : []));
  var nums = h('details', { cls: 'nums' }, [h('summary', { text: 'See the numbers' }), h('div', { cls: 'scrollx' }, h('table', { cls: 't' }, [h('thead', null, h('tr', null, [h('th', { text: spec.xName || 'Week' })].concat(spec.series.map(function (s) { return h('th', { cls: 'r', text: s.name }); })))), h('tbody', null, spec.x.map(function (x, i) { return h('tr', null, [h('td', { text: spec.tipTitle ? spec.tipTitle(x, i) : String(x) })].concat(spec.series.map(function (s) { return h('td', { cls: 'r num', text: s.values[i] == null ? '' : (s.fmt || fy)(s.values[i]) }); }))); }).reverse())]))]);
  return h('div', null, [spec.series.length > 1 || spec.target != null ? legend : null, box, spec._noReport ? null : h('button', { cls: 'replink', text: 'Open the full report →', on: { click: rep } })]);
}
function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
function spark(vals, color) {
  var s = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); s.setAttribute('class', 'spark'); s.setAttribute('viewBox', '0 0 100 30'); s.setAttribute('preserveAspectRatio', 'none');
  var v = vals.filter(function (x) { return x != null; }); if (v.length < 2) return s;
  var mn = Math.min.apply(null, v), mx = Math.max.apply(null, v); if (mx === mn) { mx += 1; mn -= 1; }
  var pts = vals.map(function (x, i) { return x == null ? null : [i / (vals.length - 1) * 100, 28 - (x - mn) / (mx - mn) * 26]; }).filter(Boolean);
  s.innerHTML = '<path d="M' + pts.map(function (p) { return p[0].toFixed(1) + ' ' + p[1].toFixed(1); }).join('L') + '" fill="none" stroke="' + (color || '#b0703f') + '" stroke-width="1.6" vector-effect="non-scaling-stroke"/>';
  return s;
}
function kpiCard(label, value, now, before, opts) {
  opts = opts || {};
  var d = now != null && before ? (now - before) / Math.abs(before) : null, good = d == null ? null : (opts.lowerIsBetter ? d < 0 : d > 0);
  var dl = d == null || !isFinite(d) ? null : h('span', { cls: 'delta ' + (Math.abs(d) < .005 ? 'flat' : good ? 'up' : 'down'), text: (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + Math.abs(d * 100).toFixed(1) + '%' });
  var card = h('div', { cls: 'kpi' + (opts.spark && opts.spark.length > 1 ? ' clickable' : ''), title: opts.spark ? 'Open the report' : null }, [h('span', { text: label }), h('b', { text: value }), h('small', null, [dl, dl ? ' ' : null, opts.sub || '']), opts.spark ? spark(opts.spark, opts.color) : null]);
  if (opts.spark && opts.spark.length > 1) card.addEventListener('click', function () { kpiReport(label, opts); });
  return card;
}
function hbars(rows, fmt, color, noReport) {
  var max = Math.max.apply(null, rows.map(function (r) { return r.v; }).concat([1]));
  var hb = h('div', { cls: 'hbars' + (noReport ? '' : ' clickable') });
  if (!noReport) hb.addEventListener('click', function () { var card = hb.closest('.card'), h2 = card && card.querySelector('h2'), sb = card && card.querySelector('.sub'), f = fmt || function (v) { return money(v, 0); }; openReport({ cats: true, bars: true, x: rows.map(function (r) { return r.label; }), xName: 'Item', yFmt: k$, series: [{ name: 'Amount', color: color || COL.food, values: rows.map(function (r) { return r.v; }), fmt: f }], extraCols: rows.some(function (r) { return r.note; }) ? [{ name: 'Note', get: function (i) { return rows[i].note || ''; } }] : null }, { title: h2 ? h2.textContent : 'Report', sub: sb ? sb.textContent : '' }); });
  return (function (kids) { kids.forEach(function (k) { hb.appendChild(k); }); return hb; })(rows.map(function (r) { return h('div', { cls: 'hbar', title: r.label + ': ' + (fmt || money)(r.v) }, [h('span', { cls: 'lbl', text: r.label }), h('div', { cls: 'track' }, h('i', { style: 'width:' + (r.v / max * 100).toFixed(1) + '%;background:' + (r.color || color || COL.food) })), h('span', { cls: 'v', text: (fmt || function (v) { return money(v, 0); })(r.v) + (r.note ? ' · ' + r.note : '') })]); }));
}
function ma(vals, k) { return vals.map(function (_, i) { var s = vals.slice(Math.max(0, i - k + 1), i + 1).filter(function (v) { return v != null; }); return s.length === Math.min(k, i + 1) ? s.reduce(function (a, b) { return a + b; }, 0) / s.length : null; }); }
function needData(el) { if (bizWeeks().filter(function (x) { return x.net != null; }).length) return false; missing(el, 'payroll weeks with sales (Financials)'); return true; }

PAGES['business/overview'] = function (el) {
  if (needData(el)) return;
  rangeBar(el);
  var w = rangeWeeks(), last = w[w.length - 1], prev = w[w.length - 2], half = Math.floor(w.length / 2);
  var cur4 = w.slice(-4), pre4 = w.slice(-8, -4);
  var buyPct = function (ws) { var s = sum(ws, function (x) { return x.net; }); return s ? sum(ws, function (x) { return x.bought; }) / s : null; };
  var labPct = function (ws) { var s = sum(ws, function (x) { return x.net; }); return s ? sum(ws, function (x) { return x.labor; }) / s : null; };
  var check = function (ws) { var c = sum(ws, function (x) { return x.covers; }); return c ? sum(ws, function (x) { return x.net; }) / c : null; };
  var g = h('div', { cls: 'grid g5' }); el.appendChild(g);
  g.appendChild(kpiCard('Net sales · last week', money(last.net, 0), last.net, prev && prev.net, { sub: 'vs. the week before', spark: w.map(function (x) { return x.net; }) }));
  g.appendChild(kpiCard('Sales · ' + w.length + ' weeks', k$(sum(w, function (x) { return x.net; })), sum(w.slice(half), function (x) { return x.net; }), sum(w.slice(0, w.length - half), function (x) { return x.net; }), { sub: 'second half vs first', spark: ma(w.map(function (x) { return x.net; }), 4) }));
  g.appendChild(kpiCard('Labor · last 4 weeks', pct(labPct(cur4)), labPct(cur4), labPct(pre4), { lowerIsBetter: true, sub: 'of sales · target 30%', spark: w.map(function (x) { return x.laborPct; }), color: COL.labor }));
  g.appendChild(kpiCard('Purchases · last 4 weeks', pct(buyPct(cur4)), buyPct(cur4), buyPct(pre4), { lowerIsBetter: true, sub: 'of sales, from invoices', spark: w.map(function (x) { return x.net ? x.bought / x.net : null; }), color: COL.purchases }));
  g.appendChild(kpiCard('Average check · 4 weeks', check(cur4) ? money(check(cur4)) : '—', check(cur4), check(pre4), { sub: sum(cur4, function (x) { return x.covers; }) ? Math.round(sum(cur4, function (x) { return x.covers; })) + ' covers' : 'needs end of day reports', spark: w.map(function (x) { return x.covers ? x.net / x.covers : null; }), color: COL.check }));

  var row = h('div', { cls: 'grid g3', style: 'margin-top:16px' }); el.appendChild(row);
  var sales = h('div', { cls: 'card span2' }, [h('div', { cls: 'card-h' }, [h('div', null, [h('h2', { text: 'Net sales by week' }), h('p', { cls: 'sub', text: 'Food and beverage, with the 4-week average' })]), h('button', { cls: 'btn small', text: 'Sales detail', on: { click: function () { go('business', 'sales'); } } })])]);
  var hasSplit = w.some(function (x) { return x.food != null; });
  sales.appendChild(chart({ bars: true, stack: hasSplit, x: w.map(function (x) { return x.w; }), xFmt: wkLabel, tipTitle: function (x) { return 'Week of ' + wkLabel(x); }, series: (hasSplit ? [{ name: 'Food', color: COL.food, values: w.map(function (x) { return x.food; }) }, { name: 'Beverage', color: COL.bev, values: w.map(function (x) { return x.bev; }) }] : [{ name: 'Net sales', color: COL.food, values: w.map(function (x) { return x.net; }) }]).concat([{ name: '4-week average', color: COL.prime, kind: 'dash', width: 1.6, values: ma(w.map(function (x) { return x.net; }), 4) }]), tipExtra: function (i) { return ['Total', money(w[i].net, 0)]; } }));
  row.appendChild(sales);
  // where each dollar went, last 4 weeks
  var s4 = sum(cur4, function (x) { return x.net; }), l4 = sum(cur4, function (x) { return x.labor; }), bf = sum(cur4, function (x) { return x.buy.food; }), bb = sum(cur4, function (x) { return x.buy.bev; }), bp = sum(cur4, function (x) { return x.buy.paper + x.buy.other; });
  var left = s4 - l4 - bf - bb - bp;
  row.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Where each dollar went' }), h('p', { cls: 'sub', text: 'Last 4 weeks · ' + money(s4, 0) + ' in sales' }),
    hbars([{ label: 'Labor', v: l4, color: COL.labor, note: pct(l4 / s4, 0) }, { label: 'Food bought', v: bf, color: COL.food, note: pct(bf / s4, 0) }, { label: 'Drinks bought', v: bb, color: COL.bev, note: pct(bb / s4, 0) }, { label: 'Dry goods', v: bp, color: COL.paper, note: pct(bp / s4, 0) }, { label: 'Left over', v: Math.max(0, left), color: COL.purchases, note: pct(left / s4, 0) }], function (v) { return k$(v); }),
    h('p', { cls: 'fine', style: 'margin-top:12px', text: '“Left over” pays rent, utilities, loans and everything else, then profit. Purchases are what was bought on scanned invoices, not what was used — the inventory reports show cost of goods used.' })]));

  var row2 = h('div', { cls: 'grid g2', style: 'margin-top:16px' }); el.appendChild(row2);
  row2.appendChild(h('div', { cls: 'card' }, [h('div', { cls: 'card-h' }, [h('div', null, [h('h2', { text: 'Prime cost' }), h('p', { cls: 'sub', text: 'Labor + purchases, as a share of sales' })]), h('button', { cls: 'btn small', text: 'Costs detail', on: { click: function () { go('business', 'costs'); } } })]),
    chart({ x: w.map(function (x) { return x.w; }), xFmt: wkLabel, yFmt: function (v) { return Math.round(v * 100) + '%'; }, tipTitle: function (x) { return 'Week of ' + wkLabel(x); }, target: .65, targetLabel: 'Prime cost target 65%', series: [{ name: 'Prime cost', color: COL.prime, width: 2.4, values: w.map(function (x) { return x.net && x.labor != null ? (x.labor + x.bought) / x.net : null; }) }, { name: 'Labor', color: COL.labor, values: w.map(function (x) { return x.laborPct; }) }, { name: 'Purchases', color: COL.purchases, values: w.map(function (x) { return x.net ? x.bought / x.net : null; }) }].map(function (s) { s.kind = 'line'; return s; }) })]));
  var covW = w.filter(function (x) { return x.covers; });
  row2.appendChild(h('div', { cls: 'card' }, [h('div', { cls: 'card-h' }, [h('div', null, [h('h2', { text: 'Guests' }), h('p', { cls: 'sub', text: 'Covers per week, from end of day reports' })])]),
    covW.length ? chart({ bars: true, x: w.map(function (x) { return x.w; }), xFmt: wkLabel, yFmt: function (v) { return Math.round(v); }, tipTitle: function (x) { return 'Week of ' + wkLabel(x); }, series: [{ name: 'Covers', color: COL.covers, values: w.map(function (x) { return x.covers || null; }) }], tipExtra: function (i) { return w[i].covers ? ['Average check', money(w[i].net / w[i].covers)] : null; } }) : h('p', { cls: 'empty', text: 'Covers show here once end of day reports are filed.' })]));
};

PAGES['business/sales'] = function (el) {
  if (needData(el)) return;
  rangeBar(el);
  var w = rangeWeeks(), all = bizWeeks().filter(function (x) { return x.net != null; });
  var lyFor = function (x) { var t = iso(addDays(pday(x.w), -364)), m = all.filter(function (y) { return y.w === t; })[0]; return m ? m.net : null; };
  var hasLY = w.some(function (x) { return lyFor(x) != null; });
  var g = h('div', { cls: 'grid g4' }); el.appendChild(g);
  var tot = sum(w, function (x) { return x.net; }), fo = sum(w, function (x) { return x.food; }), bv = sum(w, function (x) { return x.bev; });
  g.appendChild(kpiCard('Net sales', money(tot, 0), null, null, { sub: w.length + ' weeks' }));
  g.appendChild(kpiCard('Average week', money(tot / w.length, 0), null, null, { sub: 'best ' + money(Math.max.apply(null, w.map(function (x) { return x.net; })), 0) }));
  g.appendChild(kpiCard('Food', fo ? pct(fo / tot, 0) : '—', null, null, { sub: fo ? money(fo, 0) : 'split not recorded' }));
  g.appendChild(kpiCard('Beverage', bv ? pct(bv / tot, 0) : '—', null, null, { sub: bv ? money(bv, 0) : '' }));
  el.appendChild(h('div', { cls: 'card', style: 'margin-top:16px' }, [h('h2', { text: 'Net sales by week' + (hasLY ? ', against the same week last year' : '') }), h('p', { cls: 'sub', text: 'The scale starts above zero to show the week-to-week change · hover or tap a week' }),
    chart({ size: 'tall', auto: true, x: w.map(function (x) { return x.w; }), xFmt: wkLabel, tipTitle: function (x) { return 'Week of ' + wkLabel(x); }, series: [{ name: 'This year', color: COL.food, kind: 'line', width: 2.4, values: w.map(function (x) { return x.net; }) }].concat(hasLY ? [{ name: 'Last year', color: COL.ly, kind: 'dash', values: w.map(lyFor) }] : []).concat([{ name: '4-week average', color: COL.prime, kind: 'dash', width: 1.4, values: ma(w.map(function (x) { return x.net; }), 4) }]) })]));
  var row = h('div', { cls: 'grid g2', style: 'margin-top:16px' }); el.appendChild(row);
  row.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Food and beverage mix' }), h('p', { cls: 'sub', text: 'Beverage share of sales each week' }),
    chart({ x: w.map(function (x) { return x.w; }), xFmt: wkLabel, yFmt: function (v) { return Math.round(v * 100) + '%'; }, tipTitle: function (x) { return 'Week of ' + wkLabel(x); }, series: [{ name: 'Beverage share', color: COL.bev, kind: 'line', values: w.map(function (x) { return x.bev != null && x.net ? x.bev / x.net : null; }) }] })]));
  // covers by night of the week
  var nights = [0, 0, 0, 0, 0, 0, 0], cnt = [0, 0, 0, 0, 0, 0, 0], from = w.length ? w[0].w : iso();
  (S.data.eodAll || S.data.eod || []).forEach(function (r) { if (r.actual_covers == null || r.report_date < from) return; var d = pday(r.report_date).getDay(); nights[d] += +r.actual_covers; cnt[d]++; });
  var names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'], rows = [];
  names.forEach(function (n, i) { if (cnt[i]) rows.push({ label: n, v: nights[i] / cnt[i], color: COL.covers }); });
  row.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Covers by night' }), h('p', { cls: 'sub', text: 'Average guests per service, same period' }), rows.length ? hbars(rows, function (v) { return Math.round(v) + ' covers'; }) : h('p', { cls: 'empty', text: 'Needs end of day reports.' })]));
  el.appendChild(h('div', { cls: 'card', style: 'margin-top:16px' }, [h('h2', { text: 'Week by week' }), h('div', { cls: 'scrollx' }, h('table', { cls: 't' }, [h('thead', null, h('tr', null, ['Week of', 'Net sales', 'Food', 'Beverage', 'Covers', 'Avg check', 'Labor %'].map(function (x, i) { return h('th', { cls: i ? 'r' : '', text: x }); }))),
    h('tbody', null, w.slice().reverse().map(function (x) { return h('tr', null, [h('td', { text: wkLabel(x.w) }), h('td', { cls: 'r num', text: money(x.net, 0) }), h('td', { cls: 'r num', text: x.food != null ? money(x.food, 0) : '—' }), h('td', { cls: 'r num', text: x.bev != null ? money(x.bev, 0) : '—' }), h('td', { cls: 'r num', text: x.covers || '—' }), h('td', { cls: 'r num', text: x.covers ? money(x.net / x.covers) : '—' }), h('td', { cls: 'r num', text: pct(x.laborPct) })]); })),
    h('tfoot', null, h('tr', null, [h('td', { text: 'Total' }), h('td', { cls: 'r num', text: money(tot, 0) }), h('td', { cls: 'r num', text: fo ? money(fo, 0) : '' }), h('td', { cls: 'r num', text: bv ? money(bv, 0) : '' }), h('td', { cls: 'r num', text: sum(w, function (x) { return x.covers; }) || '' }), h('td'), h('td', { cls: 'r num', text: pct(sum(w, function (x) { return x.labor; }) / tot) })]))]))]));
};

PAGES['business/costs'] = function (el) {
  if (needData(el)) return;
  rangeBar(el);
  var w = rangeWeeks(), tot = sum(w, function (x) { return x.net; }), bought = sum(w, function (x) { return x.bought; });
  var g = h('div', { cls: 'grid g4' }); el.appendChild(g);
  g.appendChild(kpiCard('Bought on invoices', money(bought, 0), null, null, { sub: pct(bought / tot) + ' of sales' }));
  ['food', 'bev', 'paper'].forEach(function (k) { var v = sum(w, function (x) { return x.buy[k]; }), base = k === 'food' ? sum(w, function (x) { return x.food; }) : k === 'bev' ? sum(w, function (x) { return x.bev; }) : tot; g.appendChild(kpiCard({ food: 'Food purchases', bev: 'Beverage purchases', paper: 'Dry goods' }[k], money(v, 0), null, null, { sub: base ? pct(v / base) + ' of ' + (k === 'paper' ? 'all' : k === 'food' ? 'food' : 'beverage') + ' sales' : '' })); });
  el.appendChild(h('div', { cls: 'card', style: 'margin-top:16px' }, [h('h2', { text: 'Purchases by week' }), h('p', { cls: 'sub', text: 'What came in on scanned invoices, by inventory' }),
    chart({ bars: true, stack: true, x: w.map(function (x) { return x.w; }), xFmt: wkLabel, tipTitle: function (x) { return 'Week of ' + wkLabel(x); }, series: [{ name: 'Food', color: COL.food, values: w.map(function (x) { return x.buy.food || null; }) }, { name: 'Beverage', color: COL.bev, values: w.map(function (x) { return x.buy.bev || null; }) }, { name: 'Dry goods', color: COL.paper, values: w.map(function (x) { return x.buy.paper || null; }) }, { name: 'Not matched', color: COL.other, values: w.map(function (x) { return x.buy.other || null; }) }], tipExtra: function (i) { return ['Share of sales', w[i].net ? pct(w[i].bought / w[i].net) : '—']; } })]));
  var row = h('div', { cls: 'grid g2', style: 'margin-top:16px' }); el.appendChild(row);
  var vend = {}; w.forEach(function (x) { Object.keys(x.vendors).forEach(function (v) { vend[v] = (vend[v] || 0) + x.vendors[v]; }); });
  var vrows = Object.keys(vend).map(function (v) { return { label: v, v: vend[v], color: COL.bev }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 10);
  row.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Top vendors' }), h('p', { cls: 'sub', text: 'Spend in the period' }), vrows.length ? hbars(vrows.map(function (r) { r.note = pct(r.v / bought, 0); return r; })) : h('p', { cls: 'empty', text: 'No scanned invoices in this period.' })]));
  // inventory on hand over time
  var rows = (S.data.counts || []).filter(function (c) { return c.finished_at !== null && c.counts && Object.keys(c.counts).length; }).sort(function (a, b) { return a.count_date < b.count_date ? -1 : 1; }), lastV = {}, pts = [];
  rows.forEach(function (r) { lastV[r.category] = value(r); var t = (lastV.food || 0) + (lastV.bev || 0) + (lastV.paper || 0); if (pts.length && pts[pts.length - 1].d === r.count_date) pts[pts.length - 1].v = t; else pts.push({ d: r.count_date, v: t, f: lastV.food || null, b: lastV.bev || null }); });
  row.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Inventory on hand' }), h('p', { cls: 'sub', text: 'Value at each saved count, at today’s costs' }), pts.length ? chart({ auto: true, x: pts.map(function (p) { return p.d; }), xName: 'Count', xFmt: wkLabel, tipTitle: function (x) { return 'Count of ' + wkLabel(x); }, series: [{ name: 'All', color: COL.prime, kind: 'line', width: 2.4, values: pts.map(function (p) { return p.v; }) }, { name: 'Food', color: COL.food, kind: 'line', values: pts.map(function (p) { return p.f; }) }, { name: 'Beverage', color: COL.bev, kind: 'line', values: pts.map(function (p) { return p.b; }) }] }) : h('p', { cls: 'empty', text: 'Starts once an inventory is saved.' })]));
};

PAGES['business/labor'] = function (el) {
  if (needData(el)) return;
  rangeBar(el);
  var w = rangeWeeks(), tot = sum(w, function (x) { return x.net; }), lab = sum(w, function (x) { return x.labor; }), hrs = sum(w, function (x) { return x.hours; }), tips = sum(w, function (x) { return x.tips; });
  var g = h('div', { cls: 'grid g4' }); el.appendChild(g);
  g.appendChild(kpiCard('Labor cost', money(lab, 0), null, null, { sub: pct(lab / tot) + ' of sales' }));
  g.appendChild(kpiCard('Hours', hrs ? Math.round(hrs).toLocaleString() : '—', null, null, { sub: hrs ? Math.round(hrs / w.length) + ' a week' : '' }));
  g.appendChild(kpiCard('Sales per labor hour', hrs ? money(tot / hrs) : '—', null, null, { sub: 'higher is better' }));
  g.appendChild(kpiCard('Tips paid out', tips ? money(tips, 0) : '—', null, null, { sub: tips ? money(tips / w.length, 0) + ' a week' : '' }));
  var row = h('div', { cls: 'grid g2', style: 'margin-top:16px' }); el.appendChild(row);
  row.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Labor % of sales' }), h('p', { cls: 'sub', text: 'Wages, taxes and commissions ÷ net sales' }), chart({ x: w.map(function (x) { return x.w; }), xFmt: wkLabel, yFmt: function (v) { return Math.round(v * 100) + '%'; }, tipTitle: function (x) { return 'Week of ' + wkLabel(x); }, target: .3, targetLabel: 'Target 30%', series: [{ name: 'Labor %', color: COL.labor, kind: 'line', width: 2.4, values: w.map(function (x) { return x.laborPct; }) }] })]));
  var keys = []; w.forEach(function (x) { if (x.wagesBy) Object.keys(x.wagesBy).forEach(function (k) { if (keys.indexOf(k) === -1) keys.push(k); }); });
  var nice = { boh: 'Kitchen', kitchen: 'Kitchen', foh: 'Servers & bar', pool: 'Servers & bar', mgmt: 'Management', management: 'Management', other: 'Other', salary: 'Salaries' }, cols = [COL.food, COL.bev, COL.labor, COL.paper, COL.other];
  row.appendChild(h('div', { cls: 'card' }, [h('h2', { text: keys.length ? 'Wages by part of the house' : 'Labor cost by week' }), h('p', { cls: 'sub', text: keys.length ? 'Gross wages each week' : 'Total labor cost each week' }),
    chart({ bars: true, stack: !!keys.length, x: w.map(function (x) { return x.w; }), xFmt: wkLabel, tipTitle: function (x) { return 'Week of ' + wkLabel(x); }, series: keys.length ? keys.map(function (k, i) { return { name: nice[k] || k, color: cols[i % cols.length], values: w.map(function (x) { return x.wagesBy && x.wagesBy[k] != null ? +x.wagesBy[k] : null; }) }; }) : [{ name: 'Labor cost', color: COL.labor, values: w.map(function (x) { return x.labor; }) }] })]));
};

PAGES['business/products'] = function (el) {
  var ss = S.data.sales; if (!ss || !ss.length) return missing(el, 'product sales (Square imports)');
  var days = uniq(ss.map(function (r) { return r.day; })).sort(), from = days[0], to = days[days.length - 1];
  var by = {}, cat = {}, wk = {};
  ss.forEach(function (r) { var k = r.item; by[k] = by[k] || { item: k, cat: r.category || 'Other', qty: 0, net: 0 }; by[k].qty += +r.qty || 0; by[k].net += +r.net || 0; cat[r.category || 'Other'] = (cat[r.category || 'Other'] || 0) + (+r.net || 0); var w = sunday(r.day); wk[w] = wk[w] || {}; wk[w][k] = (wk[w][k] || 0) + (+r.qty || 0); });
  var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.net - a.net; });
  var tot = sum(list, function (x) { return x.net; });
  var g = h('div', { cls: 'grid g4' }); el.appendChild(g);
  g.appendChild(kpiCard('Product sales', money(tot, 0), null, null, { sub: dshort(from) + ' – ' + dshort(to) }));
  g.appendChild(kpiCard('Items sold', Math.round(sum(list, function (x) { return x.qty; })).toLocaleString(), null, null, { sub: list.length + ' different items' }));
  g.appendChild(kpiCard('Top seller', list[0] ? list[0].item : '—', null, null, { sub: list[0] ? money(list[0].net, 0) : '' }));
  g.appendChild(kpiCard('Top 10 share', pct(sum(list.slice(0, 10), function (x) { return x.net; }) / tot, 0), null, null, { sub: 'of product sales' }));
  var row = h('div', { cls: 'grid g2', style: 'margin-top:16px' }); el.appendChild(row);
  var pick = S.prodPick || (list[0] && list[0].item);
  row.appendChild(h('div', { cls: 'card' }, [h('h2', { text: 'Best sellers' }), h('p', { cls: 'sub', text: 'Net sales · tap one to see its weeks' }), h('div', { cls: 'hbars' }, list.slice(0, 12).map(function (x) { var b = hbars([{ label: x.item, v: x.net, color: x.item === pick ? COL.prime : COL.food, note: Math.round(x.qty) + ' sold' }]).firstChild; b.style.cursor = 'pointer'; b.addEventListener('click', function () { S.prodPick = x.item; render(); }); return b; }))]));
  var cats = Object.keys(cat).map(function (k) { return { label: k, v: cat[k], color: COL.bev, note: pct(cat[k] / tot, 0) }; }).sort(function (a, b) { return b.v - a.v; });
  var wks = Object.keys(wk).sort();
  row.appendChild(h('div', null, [h('div', { cls: 'card' }, [h('h2', { text: 'Sales by category' }), h('p', { cls: 'sub', text: 'Share of product sales' }), hbars(cats.slice(0, 10))]),
    h('div', { cls: 'card', style: 'margin-top:16px' }, [h('h2', { text: pick ? pick + ' · sold per week' : 'Sold per week' }), h('p', { cls: 'sub', text: 'Pick an item on the left' }), chart({ size: 'short', bars: true, x: wks, xFmt: wkLabel, yFmt: function (v) { return Math.round(v); }, tipTitle: function (x) { return 'Week of ' + wkLabel(x); }, series: [{ name: 'Sold', color: COL.prime, values: wks.map(function (w) { return wk[w][pick] || 0; }) }], noTable: true })])]));
};

/* =====================================================================================
   Find anything (⌘K): pages, items, recipes, people, menu lines — one box
   ===================================================================================== */
function palette() {
  var all = [];
  spacesFor().forEach(function (sp) { tabsFor(sp).forEach(function (t) { all.push({ g: 'Pages', t: t[1], s: sp.label, run: function () { go(sp.id, t[0]); } }); }); });
  (S.data.items || []).forEach(function (it) { all.push({ g: 'Inventory', t: nameOf(it), s: (it.vendor || '') + ' · ' + KINDS.filter(function (k) { return k[0] === it.category; })[0][1], run: function () { S.kind = it.category; go(it.category === 'bev' ? 'bar' : 'kitchen', 'items'); drawer(it); } }); });
  (S.data.recipes || []).forEach(function (r) { all.push({ g: 'Recipes', t: r.name, s: r.category || 'Recipe', run: function () { go('kitchen', 'recipes'); } }); });
  (S.data.builds || []).forEach(function (r) { all.push({ g: 'Cocktail builds', t: r.name, s: 'Build', run: function () { go('bar', 'builds'); } }); });
  (S.data.employees || []).forEach(function (e) { if (e.active !== false) all.push({ g: 'People', t: e.name, s: e.position || '', run: function () { go('team', 'people'); } }); });
  (S.data.menuTree || []).forEach(function (tb) { (tb.groups || []).forEach(function (g) { (g.items || []).forEach(function (m) { if (m && m.name) all.push({ g: 'Menu', t: m.name, s: tb.label + ' · ' + (g.title || ''), run: function () { S.menuTab = tb.id; go('menu', 'guest'); } }); }); }); });
  var wrap = h('div', { cls: 'palette', on: { mousedown: function (e) { if (e.target === wrap) close(); } } }), inp = h('input', { type: 'search', placeholder: 'Find a page, item, recipe, person or menu line…' }), list = h('div', { cls: 'palette-list' }), at = 0, hits = [];
  function paint() {
    var q = norm(inp.value).split(' ').filter(Boolean); hits = all.filter(function (x) { var k = norm(x.t + ' ' + x.s + ' ' + x.g); return q.every(function (w) { return k.indexOf(w) !== -1; }); }).slice(0, 40);
    if (!q.length) hits = hits.filter(function (x) { return x.g === 'Pages'; });
    list.innerHTML = ''; var lg = null; at = Math.min(at, Math.max(0, hits.length - 1));
    hits.forEach(function (x, i) { if (x.g !== lg) { lg = x.g; list.appendChild(h('div', { cls: 'palette-g', text: x.g })); } list.appendChild(h('button', { cls: 'palette-o' + (i === at ? ' on' : ''), on: { click: function () { close(); x.run(); } } }, [h('b', { text: x.t, style: 'font-weight:500' }), h('span', { text: x.s })])); });
    if (!hits.length) list.appendChild(h('p', { cls: 'empty', style: 'padding:14px', text: 'Nothing matches.' }));
  }
  function close() { wrap.remove(); document.removeEventListener('keydown', key); }
  function key(e) { if (e.key === 'Escape') close(); else if (e.key === 'ArrowDown') { e.preventDefault(); at = Math.min(hits.length - 1, at + 1); paint(); } else if (e.key === 'ArrowUp') { e.preventDefault(); at = Math.max(0, at - 1); paint(); } else if (e.key === 'Enter' && hits[at]) { e.preventDefault(); close(); hits[at].run(); } }
  inp.addEventListener('input', function () { at = 0; paint(); }); document.addEventListener('keydown', key);
  wrap.appendChild(h('div', { cls: 'palette-box' }, [inp, list])); document.body.appendChild(wrap); paint(); inp.focus();
}
document.addEventListener('keydown', function (e) { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k' && S.mode) { e.preventDefault(); palette(); } });

/* =====================================================================================
   About: the thinking behind the layout, and where every old page went
   ===================================================================================== */
function about() {
  var moves = [
    ['Today', 'Today', 'Now a to-do list that clears itself'],
    ['Pre-shift meeting, Checklists, Edit checklists', 'Service → Tonight, Checklists', 'Edit is a button on the page'],
    ['End of day report, Past reports, Download reports', 'Service → End of day', 'One page, one list'],
    ['Calendar', 'Calendar (its own place)', 'Events, meetings, schedule, time off and inquiries on one grid'],
    ['Inquiries, BEOs', 'Catering & BEOs (its own place)', 'A board: new → questionnaire sent → back → Active BEO'],
    ['Reservations (soon)', 'Service → Tonight', 'When it arrives'],
    ['Inventory · Food, Dry goods', 'Kitchen → Count, Order, Receive, Items, Reports', 'Split by job; Food/Dry is a switch'],
    ['Inventory · Beverages', 'Bar → Count, Order, Receive, Items, Reports', 'Its own place; Beer/Wine/Liquor/N/A is a switch'],
    ['Prep list (+ Bar prep)', 'Kitchen → Prep list · Bar → Bar prep', 'First tab in each; built from the menu, with tonight’s bookings on top'],
    ['Ordering, Temperatures', 'Kitchen → Order, Temperatures · Bar → Order', 'Order list comes from par automatically'],
    ['Recipes, Cocktail builds', 'Kitchen → Recipes · Bar → Cocktail builds', 'Each where it’s made'],
    ['Menu & Supper Club, Menu costs', 'Menu → Guest menu, Menu costs, Supper Club & events', 'Menu and its cost together'],
    ['Schedule, Employees, Permissions, Reviews', 'Team → Schedule, People, Time off, Reviews', 'Permissions inside each person'],
    ['Financials, Payroll, Past payroll, Pay rates, Product sales', 'Business → Overview, Sales, Costs, Labor, Product sales, Payroll', 'Owner only; graphs at a glance, then detail'],
    ['Business email, Promotional emails', 'Business → Marketing', 'Email keeps its own quick button'],
    ['Analytics & History, Staff logins, Partner stories', 'Business → Website', ''],
    ['Staff page & board', 'Stays a separate link for employees', '']
  ];
  var box = h('div', { cls: 'about', on: { mousedown: function (e) { if (e.target === box) box.remove(); } } }, h('div', { cls: 'about-box' }, [
    h('button', { cls: 'btn small', style: 'float:right', text: 'Close', on: { click: function () { box.remove(); } } }),
    h('h2', { text: 'About this layout' }),
    h('p', { text: 'The staff site grew one feature at a time, so the menu grew to 35 links in 7 groups, and the inventory sheet ended up doing six jobs in one 18-column table. Someone new has to learn where things are before they can do anything. This layout starts from the opposite end: what someone came to do.' }),
    h('h3', { text: 'The ideas behind it' }),
    h('ol', null, [
      h('li', { html: '<b>A short list of places, each answering one question.</b> Today (what needs me?), Calendar (what’s happening when), Service (running tonight), Catering &amp; BEOs (private events), Kitchen and Bar (stock, recipes, builds), Menu (what guests see and what it costs), Team (people), Business (owner only). Every old page has a home in one of them, and you only see the places your job uses.' }),
      h('li', { html: '<b>Tabs inside a place, not more menu links.</b> Sub-pages became tabs across the top of each page, so the left side stays short. On an iPad held upright or a phone, the places you use most sit in a bar along the bottom where a thumb reaches them, with the rest under More.' }),
      h('li', { html: '<b>One job per screen.</b> Counting inventory only needs a name, last time’s number and a big box to type in — so that’s all Count shows. Prices, vendors, invoice names and menu links live in Items. Ordering and receiving invoices are their own steps.' }),
      h('li', { html: '<b>Details in one panel.</b> Tapping any item opens a panel from the side with everything about it in tabs (overview, prices, invoice names, menu, counts). The list stays put behind it, so you never lose your place.' }),
      h('li', { html: '<b>Today is a to-do list that clears itself.</b> Below par, use first, a wine that ran out, unmatched invoice lines, a warm cooler, a new catering inquiry, a time-off request — each with one button to the place you fix it. When it’s fixed, it disappears.' }),
      h('li', { html: '<b>Only what your job needs.</b> A cook never sees Business or Team; a server never sees costs. Pages someone can’t use aren’t shown at all, instead of greyed out. Try the “See it as” switch at the top.' }),
      h('li', { html: '<b>Find anything.</b> The search box at the top (⌘K on the computer) finds pages, inventory items, recipes, people and menu lines from anywhere — the fastest way around for someone who doesn’t know the layout yet.' }),
      h('li', { html: '<b>The business at a glance, then the detail.</b> Business opens on an Overview: five headline numbers (sales, labor, purchases, average check), each with its trend and how it moved, then sales by week, where each dollar went, prime cost against a 65% target, and guests per week. Sales, Costs, Labor and Product sales hold the detail behind each one, with a 4-week / 13-week / 6-month / 1-year switch, and every chart has a “See the numbers” table. On Today, the owner also gets last week’s four numbers.' }),
      h('li', { html: '<b>A quieter, more professional look.</b> A graphite sidebar, white working surfaces, one accent colour used only for what matters, aligned figures, and line icons instead of emoji. Design notes are hidden unless you ask for them.' }),
      h('li', { html: '<b>Plain words and steady patterns.</b> Every page uses the same few pieces: a title, tabs, cards, lists, and coloured tags that always mean the same thing (gold = needs attention, red = a problem, green = done, blue = information).' })
    ]),
    h('h3', { text: 'Where every page went' }),
    h('div', { cls: 'scrollx' }, h('table', { cls: 't map' }, [h('thead', null, h('tr', null, [h('th', { text: 'Today on the site' }), h('th', { text: 'In the new layout' }), h('th', { text: '' })])), h('tbody', null, moves.map(function (m) { return h('tr', null, [h('td', { text: m[0] }), h('td', null, h('b', { text: m[1], style: 'font-weight:500' })), h('td', { cls: 'fine', text: m[2] })]); }))])),
    h('h3', { text: 'About this file' }),
    h('p', { cls: 'fine', text: 'It only reads from the real site. It never saves, changes or deletes anything there — the live staff site stays exactly as it is. The inventory, menu, schedule and payroll editors work for real inside this tab, so you can try them; refresh or close the tab and it all resets. Anything your login can’t read is simply left out.' })
  ]));
  document.body.appendChild(box);
}
function readReport() {
  var names = { items: 'Inventory items', counts: 'Inventory counts', invoices: 'Scanned invoices', prices: 'Price history', employees: 'Employees', weeks: 'Schedule', eod: 'End of day reports', events: 'Calendar', catering: 'Catering inquiries', todos: 'To-dos', recipes: 'Recipes', builds: 'Cocktail builds', menu: 'Menu', payweeks: 'Payroll weeks', sales: 'Product sales', timeoff: 'Time off', reviews: 'Reviews', preshift: 'Pre-shift notes', units: 'Temperature units', temps: 'Temperature readings', promos: 'Promotional emails' };
  var box = h('div', { cls: 'about', on: { mousedown: function (e) { if (e.target === box) box.remove(); } } }, h('div', { cls: 'about-box' }, [h('button', { cls: 'btn small', style: 'float:right', text: 'Close', on: { click: function () { box.remove(); } } }), h('h2', { text: 'What it could read' }),
    h('div', { cls: 'list' }, Object.keys(names).map(function (k) { var d = S.data[k]; return h('div', { cls: 'row' }, [h('div', { cls: 'main-t' }, h('b', { text: names[k] })), h('span', { cls: 'chip ' + (d ? 'green' : ''), text: d ? d.length + ' read' : 'not readable with this login' })]); }))]));
  document.body.appendChild(box);
}

/* =====================================================================================
   EDITING — everything below works in this tab and is kept until the tab closes.
   None of it is sent anywhere: the real site never sees these changes.
   ===================================================================================== */

function modal(title, body, foot, wide) {
  var back = h('div', { cls: 'modal' }), box = h('div', { cls: 'modal-box' + (wide ? ' wide' : ''), role: 'dialog', 'aria-label': title });
  function close() { back.remove(); document.removeEventListener('keydown', esc); }
  function esc(e) { if (e.key === 'Escape') close(); }
  box.appendChild(h('div', { cls: 'modal-h' }, [h('h2', { text: title }), h('button', { cls: 'x', 'aria-label': 'Close', text: '✕', on: { click: close } })]));
  box.appendChild(h('div', { cls: 'modal-b' }, body));
  if (foot) box.appendChild(h('div', { cls: 'modal-f' }, foot));
  back.appendChild(box); back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
  document.addEventListener('keydown', esc); document.body.appendChild(back);
  var f = box.querySelector('input,select,textarea'); if (f) setTimeout(function () { f.focus(); }, 30);
  return { close: close, el: box };
}
function fld(label, input, hint) { return h('label', { cls: 'field' }, [h('span', { text: label }), input, hint ? h('small', { cls: 'fine', text: hint }) : null]); }
function inp(v, a) { var e = h('input', Object.assign({ type: 'text', value: v == null ? '' : String(v) }, a || {})); return e; }
function sel(opts, v) { var e = h('select', null, opts.map(function (o) { return Array.isArray(o) ? h('option', { value: o[0], text: o[1] }) : h('option', { value: o, text: o }); })); e.value = v == null ? '' : v; return e; }
function numv(e) { var t = String(e.value).trim().replace(/[$,]/g, ''); return t === '' ? null : isFinite(+t) ? +t : NaN; }


/* ---------- inventory: edit everything about an item in its panel ---------- */
var UNITS = { food: ['lb', '1/4 lb', 'oz', 'kg', 'g', 'each', 'case', 'dozen', 'bunch', 'qt', 'gal'], bev: ['bottle', 'can', 'keg', 'case', 'each', 'lb', 'oz', 'g'], paper: ['each', 'case', 'box', 'pack', 'sleeve', 'roll', 'bag'] };
function sectionsOf(cat) { return uniq((S.data.items || []).filter(function (x) { return x.category === cat; }).map(function (x) { return x.section; })).sort(); }
function itemForm(it, isNew, done) {
  var f = {
    name: inp(nameOf(it), { placeholder: 'What you call it' }),
    cat: sel(KINDS, it.category),
    section: inp(it.section || '', { list: 'secList', placeholder: 'e.g. Produce' }),
    vendor: inp(it.vendor || '', { list: 'venList', placeholder: 'e.g. Sysco' }),
    unit: sel(UNITS[it.category] || UNITS.food, it.unit || (UNITS[it.category] || ['each'])[0]),
    pack: inp(it.pack || '', { placeholder: 'e.g. 750ml, 5 lb case' }),
    order: sel([['', 'Same as counted'], 'case', 'each', 'box', 'lb', 'bottle', 'keg', 'bag'], it.order_unit || ''),
    per: inp(it.per_case, { inputmode: 'decimal', placeholder: 'How many in one' }),
    cost: inp(hasCost(it) ? (+it.cost).toFixed(2) : '', { inputmode: 'decimal', placeholder: '0.00' }),
    par: inp(it.par, { inputmode: 'decimal' }), max: inp(it.max_qty, { inputmode: 'decimal' })
  };
  var lists = [h('datalist', { id: 'secList' }, sectionsOf(it.category).map(function (x) { return h('option', { value: x }); })), h('datalist', { id: 'venList' }, uniq((S.data.items || []).map(function (x) { return x.vendor; })).sort().map(function (x) { return h('option', { value: x }); }))];
  var msg = h('p', { cls: 'msg' });
  var form = h('div', { cls: 'form' }, [lists, fld('Name', f.name), h('div', { cls: 'g2f' }, [fld('Inventory', f.cat), fld('Section', f.section)]), h('div', { cls: 'g2f' }, [fld('Vendor', f.vendor), fld('Bottle or pack size', f.pack)]),
    h('div', { cls: 'g2f' }, [fld('Counted in', f.unit), fld('Cost per ' + (it.unit || 'unit') + ' ($)', f.cost)]), h('div', { cls: 'g2f' }, [fld('Received in', f.order), fld('How many in one', f.per)]), h('div', { cls: 'g2f' }, [fld('Par', f.par, 'Keep at least this much'), fld('Maximum', f.max, 'Over it → use first')]), msg]);
  f.cat.addEventListener('change', function () { var u = UNITS[f.cat.value]; f.unit.innerHTML = ''; u.forEach(function (x) { f.unit.appendChild(h('option', { value: x, text: x })); }); });
  f.unit.addEventListener('change', function () { form.querySelectorAll('.field span')[5].textContent = 'Cost per ' + f.unit.value + ' ($)'; });
  function save() {
    var name = f.name.value.trim(); if (!name) { msg.textContent = 'Give it a name.'; f.name.focus(); return; }
    var c = numv(f.cost), p = numv(f.par), m = numv(f.max), pc = numv(f.per);
    if ([c, p, m, pc].some(function (x) { return x !== null && isNaN(x); })) { msg.textContent = 'Cost, par, maximum and “how many” must be numbers.'; return; }
    if (m != null && p != null && m < p) { msg.textContent = 'The maximum is lower than the par.'; return; }
    if (it.category === 'food' && it.ingredient !== undefined && !isNew) it.ingredient = name; else it.name = name;
    if (isNew) { it.name = name; it.id = uid(); it.active = true; it.menu_refs = []; S.data.items.push(it); }
    it.category = f.cat.value; it.section = f.section.value.trim() || 'Other'; it.vendor = f.vendor.value.trim(); it.unit = f.unit.value; it.pack = f.pack.value.trim();
    it.order_unit = f.order.value; it.per_case = pc; it.cost = c; it.par = p; it.max_qty = m;
    changed(isNew ? 'Added ' + name : 'Saved ' + name); done();
  }
  return { el: form, save: save };
}
function addItem() {
  var it = { category: S.kind, section: '', name: '', unit: (UNITS[S.kind] || ['each'])[0] };
  var fm = itemForm(it, true, function () { m.close(); render(); });
  var m = modal('Add an item', fm.el, [h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn accent', text: 'Add item', on: { click: fm.save } })]);
}
function removeItem(it, after) {
  var m = modal('Remove ' + nameOf(it) + '?', h('p', { text: 'It comes off the ' + KINDS.filter(function (k) { return k[0] === it.category; })[0][1].toLowerCase() + ' inventory. Past counts keep their numbers.' }), [h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Keep it', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn danger', text: 'Remove', on: { click: function () { it.active = false; m.close(); changed('Removed ' + nameOf(it)); after(); } } })]);
}

/* ---------- menu editor ---------- */
function isWineTab(t) { return /wine/i.test(t.id + ' ' + t.label); }
function invFor(m) { var k = norm(m.name); return (S.data.items || []).filter(function (x) { return x.active !== false && x.category === 'bev' && (norm(x.name) === k || (x.menu_refs || []).some(function (r) { return r.name === m.name; }) || m.inv_id === x.id); })[0] || null; }
function costPct(t, m) {
  var it = invFor(m); if (!it || !hasCost(it)) return null; var ml = bottleMl(it), out = [];
  if (isWineTab(t)) { if (+m.glass) out.push(['glass', it.cost * 147.87 / ml / +m.glass]); if (+m.bottle) out.push(['bottle', it.cost / +m.bottle]); }
  else if (/spirit/i.test(t.id + t.label) && +m.price) out.push(['pour', it.cost * 44.36 / ml / +m.price]);
  else if (+m.price) out.push(['', it.cost / +m.price]);
  return out.length ? out : null;
}
function pctChip(list) { if (!list) return null; var worst = Math.max.apply(null, list.map(function (x) { return x[1]; })); return h('span', { cls: 'chip ' + (worst >= .35 ? 'red' : worst >= .28 ? 'gold' : 'green'), title: 'Cost of goods: cost ÷ menu price', text: list.map(function (x) { return Math.round(x[1] * 100) + '%' + (x[0] ? ' ' + x[0] : ''); }).join(' · ') }); }
function menuItemForm(t, g, m, isNew, done) {
  var wine = isWineTab(t);
  var f = { name: inp(m.name || '', { placeholder: 'What guests see' }), desc: h('textarea', { rows: '2', placeholder: wine ? 'Tasting note (optional)' : 'Ingredients, as guests read them' }), price: inp(m.price, { inputmode: 'decimal', placeholder: '0' }), glass: inp(m.glass, { inputmode: 'decimal', placeholder: '0' }), bottle: inp(m.bottle, { inputmode: 'decimal', placeholder: '0' }), grape: inp(m.grape || '', { placeholder: 'e.g. Cabernet Franc' }), region: inp(m.appellation || '', { placeholder: 'e.g. Finger Lakes, NY' }), section: sel(t.groups.map(function (x, i) { return [String(i), x.title || 'Section']; }), String(t.groups.indexOf(g))), hidden: h('input', { type: 'checkbox' }) };
  f.desc.value = m.desc || ''; f.hidden.checked = !!m.hidden;
  var live = h('div', { cls: 'costline' }), msg = h('p', { cls: 'msg' });
  function paintCost() { var tmp = { name: f.name.value, price: f.price.value, glass: f.glass.value, bottle: f.bottle.value, inv_id: m.inv_id }; var c = costPct(t, tmp), it = invFor(tmp); live.innerHTML = ''; if (it) { live.appendChild(h('span', { text: 'Inventory: ' + nameOf(it) + ' · ' + money(it.cost) + ' / ' + (it.unit || 'each') })); if (c) live.appendChild(pctChip(c)); } else if (t.id !== 'm-food' && !/dinner|food|kitchen/i.test(t.label)) live.appendChild(h('span', { cls: 'fine', text: 'Not matched to an inventory item yet — cost % shows once it is.' })); }
  [f.name, f.price, f.glass, f.bottle].forEach(function (x) { x.addEventListener('input', paintCost); }); paintCost();
  var el = h('div', { cls: 'form' }, [fld('Name', f.name), fld(wine ? 'Note' : 'Description', f.desc),
    wine ? h('div', { cls: 'g2f' }, [fld('Glass price ($)', f.glass), fld('Bottle price ($)', f.bottle)]) : fld('Price ($)', f.price),
    wine ? h('div', { cls: 'g2f' }, [fld('Grape', f.grape), fld('Region', f.region)]) : null, live,
    h('div', { cls: 'g2f' }, [fld('Section', f.section), h('label', { cls: 'check' }, [f.hidden, ' Hidden from guests'])]), msg]);
  function save() {
    var name = f.name.value.trim(); if (!name) { msg.textContent = 'Give it a name.'; return; }
    var pr = wine ? [numv(f.glass), numv(f.bottle)] : [numv(f.price)]; if (pr.some(function (x) { return x !== null && isNaN(x); })) { msg.textContent = 'Prices must be numbers.'; return; }
    m.name = name; m.desc = f.desc.value.trim(); m.hidden = f.hidden.checked;
    if (wine) { m.glass = pr[0] == null ? '' : String(pr[0]); m.bottle = pr[1] == null ? '' : String(pr[1]); m.price = m.bottle || m.glass; m.grape = f.grape.value.trim(); m.appellation = f.region.value.trim(); } else m.price = pr[0] == null ? '' : String(pr[0]);
    var to = t.groups[+f.section.value];
    if (isNew) to.items.push(m); else if (to !== g) { g.items.splice(g.items.indexOf(m), 1); to.items.push(m); }
    S.menuPending = (S.menuPending || 0) + 1; changed(isNew ? 'Added ' + name : 'Saved ' + name); done();
  }
  function del() { g.items.splice(g.items.indexOf(m), 1); S.menuPending = (S.menuPending || 0) + 1; changed('Removed ' + m.name); done(); }
  return { el: el, save: save, del: del };
}
PAGES['menu/guest'] = function (el) {
  var tree = S.data.menuTree; if (!tree) return missing(el, 'the menu');
  var which = S.menuTab || tree[0].id, cur = tree.filter(function (t) { return t.id === which; })[0] || tree[0];
  var preview = !!S.menuPreview;
  el.appendChild(h('div', { cls: 'toolbar', style: 'justify-content:space-between' }, [
    h('div', { cls: 'kindbar', style: 'margin:0' }, tree.map(function (t) { return h('button', { cls: 'pill', 'aria-pressed': t.id === cur.id ? 'true' : 'false', text: t.label, on: { click: function () { S.menuTab = t.id; render(); } } }); })),
    h('div', { cls: 'chips', style: 'align-items:center' }, [
      h('div', { cls: 'seg' }, [['edit', 'Edit'], ['preview', 'Guest view']].map(function (o) { return h('button', { 'aria-pressed': (o[0] === 'preview') === preview ? 'true' : 'false', text: o[1], on: { click: function () { S.menuPreview = o[0] === 'preview'; render(); } } }); })),
      h('button', { cls: 'btn ' + (S.menuPending ? 'accent' : ''), disabled: !S.menuPending, text: S.menuPending ? 'Publish ' + S.menuPending + ' change' + (S.menuPending === 1 ? '' : 's') : 'Published', on: { click: saveMenuNow } })
    ])]));
  var vo = vintageOut(); if (vo.length && !preview) el.appendChild(h('div', { cls: 'attn', style: 'margin-bottom:16px;border-color:#e3b6ae;background:var(--red-soft)' }, [h('div', { cls: 'ic wine' }, svg(ICON2.wine)), h('div', null, [h('b', { text: vo.map(function (x) { return x.old.name; }).join(', ') + ' ran out' }), h('span', { text: 'The new vintage is ' + vo.map(function (x) { return x.nw.name; }).join(', ') + '.' })]), h('button', { cls: 'btn small accent', style: 'margin-left:auto', text: 'Switch the menu to it', on: { click: function () {
    vo.forEach(function (x) { tree.forEach(function (t) { (t.groups || []).forEach(function (g) { (g.items || []).forEach(function (m) { if (m && norm(m.name) === norm(x.old.name)) { m.name = x.nw.name; S.menuPending = (S.menuPending || 0) + 1; } }); }); }); x.old.active = false; x.nw.replaces = null; });
    changed('Menu now lists the new vintage'); render(); } } })]));
  if (preview) { el.appendChild(h('div', { cls: 'card' }, h('div', { cls: 'menucols' }, (cur.groups || []).map(function (g) { return h('div', { cls: 'mgroup' }, [h('h3', { text: g.title || '' }), (g.items || []).filter(function (m) { return m && !m.hidden; }).map(function (m) { return h('div', { cls: 'mitem' }, [h('div', null, [h('b', { text: m.name }), m.desc || m.grape ? h('span', { text: m.desc || [m.grape, m.appellation].filter(Boolean).join(' · ') }) : null]), h('span', { cls: 'p', text: menuPrice(m) })]); })]); })))); return; }
  var grid = h('div', { cls: 'grid g2' }); el.appendChild(grid);
  cur.groups.forEach(function (g, gi) {
    var card = h('div', { cls: 'card' });
    card.appendChild(h('div', { cls: 'card-h' }, [h('div', null, [h('h2', { text: g.title || 'Section' }), h('p', { cls: 'sub', style: 'margin:0', text: plural((g.items || []).length, 'item') })]),
      h('div', { cls: 'chips' }, [h('button', { cls: 'btn small', text: 'Rename', on: { click: function () { var i = inp(g.title || ''); var mm = modal('Rename section', fld('Section name', i), [h('span', { cls: 'sp' }), h('button', { cls: 'btn accent', text: 'Save', on: { click: function () { if (!i.value.trim()) return; g.title = i.value.trim(); S.menuPending = (S.menuPending || 0) + 1; changed('Renamed'); mm.close(); render(); } } })]); } } }),
        h('button', { cls: 'btn small', text: '+ Add', on: { click: function () { var m = {}; var fm = menuItemForm(cur, g, m, true, function () { mm.close(); render(); }); var mm = modal('Add to ' + (g.title || 'section'), fm.el, [h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { mm.close(); } } }), h('button', { cls: 'btn accent', text: 'Add', on: { click: fm.save } })]); } } })])]));
    var list = h('div', { cls: 'list' }); card.appendChild(list);
    (g.items || []).forEach(function (m, i) {
      if (!m) return;
      var row = h('div', { cls: 'row click mrow' + (m.hidden ? ' off' : '') }, [
        h('div', { cls: 'updown' }, [h('button', { 'aria-label': 'Move up', text: '▲', disabled: i === 0, on: { click: function (e) { e.stopPropagation(); g.items.splice(i, 1); g.items.splice(i - 1, 0, m); S.menuPending = (S.menuPending || 0) + 1; changed(); render(); } } }), h('button', { 'aria-label': 'Move down', text: '▼', disabled: i === g.items.length - 1, on: { click: function (e) { e.stopPropagation(); g.items.splice(i, 1); g.items.splice(i + 1, 0, m); S.menuPending = (S.menuPending || 0) + 1; changed(); render(); } } })]),
        h('div', { cls: 'main-t' }, [h('b', { text: m.name }), h('span', { text: m.desc || [m.grape, m.appellation].filter(Boolean).join(' · ') })]),
        m.hidden ? h('span', { cls: 'chip', text: 'Hidden' }) : pctChip(costPct(cur, m)),
        h('span', { cls: 'num', style: 'min-width:92px;text-align:right', text: menuPrice(m) || '—' })]);
      row.addEventListener('click', function () { var fm = menuItemForm(cur, g, m, false, function () { mm.close(); render(); }); var mm = modal(m.name, fm.el, [h('button', { cls: 'btn danger', text: 'Remove', on: { click: fm.del } }), h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { mm.close(); } } }), h('button', { cls: 'btn accent', text: 'Save', on: { click: fm.save } })]); });
      list.appendChild(row);
    });
    if (!(g.items || []).length) list.appendChild(h('p', { cls: 'empty', text: 'Nothing here yet.' }));
    grid.appendChild(card);
  });
  el.appendChild(h('button', { cls: 'btn', style: 'margin-top:16px', text: '+ Add a section', on: { click: function () { var i = inp(''); var mm = modal('New section on ' + cur.label, fld('Section name', i), [h('span', { cls: 'sp' }), h('button', { cls: 'btn accent', text: 'Add section', on: { click: function () { if (!i.value.trim()) return; cur.groups.push({ id: uid(), title: i.value.trim(), items: [] }); S.menuPending = (S.menuPending || 0) + 1; changed('Added a section'); mm.close(); render(); } } })]); } } }));
};

/* ---------- schedule builder ---------- */
var CLOSE_AT = '22:00';
var ROLES = [['Server', '16:30'], ['Bar', '16:00'], ['Manager', '15:30'], ['Host', '16:45'], ['Line', '14:00'], ['Sous', '12:00'], ['Prep', '10:00'], ['Dish', '17:00']];
function mins(t) { var p = String(t || '').split(':'); return +p[0] * 60 + (+p[1] || 0); }
function shiftHours(s) { var e = s.end === 'close' || !s.end ? mins(CLOSE_AT) : mins(s.end), st = mins(s.start); return Math.max(0, (e - st) / 60); }
function t12(t) { if (t === 'close') return 'close'; var m = mins(t), hh = Math.floor(m / 60), mm = m % 60; return (hh % 12 || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (hh < 12 ? 'a' : 'p'); }
function weekRow(ws) { S.data.weeks = S.data.weeks || []; var w = S.data.weeks.filter(function (x) { return x.week_start === ws; })[0]; if (!w) { w = { week_start: ws, status: 'draft', shifts: [] }; S.data.weeks.push(w); } if (!w._edit) { if (!w.shifts) w.shifts = []; w._edit = true; } return w; }
function rateOf(id) { var r = payRates()[id]; return r && r.rate ? +r.rate : 0; }
function offOn(empId, date) { return (S.data.timeoff || []).filter(function (x) { return x.emp === empId && x.status !== 'denied' && x.start_date <= date && x.end_date >= date; })[0] || null; }
function roleKind(r) { r = String(r || '').toLowerCase(); return /line|sous|cook|dish|prep|kitchen|chef/.test(r) ? 'k' : /bar/.test(r) ? 'b' : 'f'; }
function shiftForm(sh, emps, done, del) {
  var f = { emp: sel(emps.map(function (e) { return [e.id, e.name]; }), sh.emp), role: sel(ROLES.map(function (r) { return r[0]; }).concat(sh.role && !ROLES.some(function (r) { return r[0] === sh.role; }) ? [sh.role] : []), sh.role || 'Server'), start: inp(sh.start || '16:30', { type: 'time' }), close: h('input', { type: 'checkbox' }), end: inp(sh.end && sh.end !== 'close' ? sh.end : '21:30', { type: 'time' }), note: inp(sh.note || '', { placeholder: 'Optional — e.g. private party' }) };
  f.close.checked = !sh.end || sh.end === 'close'; f.end.disabled = f.close.checked;
  f.close.addEventListener('change', function () { f.end.disabled = f.close.checked; });
  f.role.addEventListener('change', function () { var r = ROLES.filter(function (x) { return x[0] === f.role.value; })[0]; if (r) f.start.value = r[1]; });
  var warn = h('p', { cls: 'msg' });
  var el = h('div', { cls: 'form' }, [h('div', { cls: 'g2f' }, [fld('Who', f.emp), fld('Job', f.role)]), h('div', { cls: 'g2f' }, [fld('Starts', f.start), h('div', null, [fld('Ends', f.end), h('label', { cls: 'check' }, [f.close, ' Until close'])])]), fld('Note', f.note), warn]);
  function save() {
    if (!f.start.value) { warn.textContent = 'Pick a start time.'; return; }
    if (!f.close.checked && mins(f.end.value) <= mins(f.start.value)) { warn.textContent = 'The shift ends before it starts.'; return; }
    sh.emp = f.emp.value; sh.role = f.role.value; sh.start = f.start.value; sh.end = f.close.checked ? 'close' : f.end.value; sh.note = f.note.value.trim(); done();
  }
  return { el: el, save: save };
}
PAGES['team/schedule'] = function (el) {
  var base = S.schedWeek || sunday(new Date()), ws = base, w = weekRow(ws), start = pday(ws), t = iso();
  var emps = (S.data.employees || []).filter(function (e) { return e.active !== false && !e.removed_at; });
  var open = [3, 4, 5, 6];   // Wed–Sat
  var prevW = iso(addDays(start, -7)), nextW = iso(addDays(start, 7));
  el.appendChild(h('div', { cls: 'toolbar', style: 'justify-content:space-between' }, [
    h('div', { cls: 'chips', style: 'align-items:center' }, [h('button', { cls: 'btn small', 'aria-label': 'Previous week', text: '‹', on: { click: function () { S.schedWeek = prevW; render(); } } }), h('b', { style: 'font-size:1rem', text: 'Week of ' + pday(ws).toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) }), h('button', { cls: 'btn small', 'aria-label': 'Next week', text: '›', on: { click: function () { S.schedWeek = nextW; render(); } } }), h('span', { cls: 'chip ' + (w.status === 'published' && !w._dirty ? 'green' : 'gold'), text: w.status === 'published' && !w._dirty ? 'Published' : w.status === 'published' ? 'Changed since publishing' : 'Draft' })]),
    h('div', { cls: 'chips' }, [
      h('button', { cls: 'btn small', text: 'Copy last week', on: { click: function () { var lw = S.data.weeks.filter(function (x) { return x.week_start === prevW; })[0]; var src = lw ? (lw._edit ? lw.shifts : lw.published || lw.shifts) : null; if (!src || !src.length) { toast('Nothing scheduled the week before.'); return; } w.shifts = JSON.parse(JSON.stringify(src)).map(function (s) { s.id = uid(); return s; }); w._dirty = true; changed('Copied ' + plural(src.length, 'shift')); render(); } } }),
      h('button', { cls: 'btn small', text: 'Clear', disabled: !w.shifts.length, on: { click: function () { w.shifts = []; w._dirty = true; changed('Cleared the week'); render(); } } }),
      h('button', { cls: 'btn accent', text: 'Publish', disabled: !w.shifts.length, on: { click: function () { w.status = 'published'; w.published = JSON.parse(JSON.stringify(w.shifts)); w.published_at = new Date().toISOString(); w._dirty = false; changed('Published — everyone sees it on the staff page. To text people their shifts: Full schedule → Text schedules.'); render(); } } })])]));
  // totals
  var hrs = sum(w.shifts, shiftHours), cost = sum(w.shifts, function (s) { return shiftHours(s) * rateOf(s.emp); });
  var g = h('div', { cls: 'grid g4' }); el.appendChild(g);
  g.appendChild(kpiCard('Shifts', String(w.shifts.length), null, null, { sub: uniq(w.shifts.map(function (s) { return s.emp; })).length + ' people' }));
  g.appendChild(kpiCard('Scheduled hours', Math.round(hrs * 10) / 10 + '', null, null, { sub: '1st cut counted as 8p, 2nd cut 9p, close ' + t12(CLOSE_AT) }));
  g.appendChild(kpiCard('Estimated wages', money(cost, 0), null, null, { sub: 'hours × pay rate, before tips' }));
  var bw = bizWeeks().filter(function (x) { return x.net != null; }), avg = bw.length ? sum(bw.slice(-4), function (x) { return x.net; }) / Math.min(4, bw.length) : null;
  g.appendChild(kpiCard('Labor vs. a usual week', avg ? pct(cost * 1.12 / avg) : '—', null, null, { sub: avg ? 'with payroll taxes, against ' + k$(avg) + ' sales' : 'needs payroll history' }));
  // grid: people down the side, days across
  var tbl = h('table', { cls: 'sched' });
  var head = h('tr', null, [h('th', { cls: 'who', text: 'Team' })]);
  for (var d = 0; d < 7; d++) { var day = addDays(start, d); head.appendChild(h('th', { cls: (iso(day) === t ? 'today ' : '') + (open.indexOf(d) === -1 ? 'closedday' : '') }, [day.toLocaleDateString(undefined, { weekday: 'short' }), h('small', { text: ' ' + day.getDate() }), open.indexOf(d) === -1 ? h('small', { cls: 'cl', text: 'closed' }) : null])); }
  head.appendChild(h('th', { cls: 'r', text: 'Hours' }));
  tbl.appendChild(h('thead', null, head));
  var body = h('tbody'); tbl.appendChild(body);
  emps.forEach(function (e) {
    var tr = h('tr', null, [h('th', { cls: 'who' }, [h('b', { text: e.name }), h('small', { text: e.position || '' })])]);
    for (var d2 = 0; d2 < 7; d2++) (function (d) {
      var date = iso(addDays(start, d)), off = offOn(e.id, date), list = w.shifts.filter(function (s) { return s.emp === e.id && s.day === d; });
      var td = h('td', { cls: 'cell' + (open.indexOf(d) === -1 ? ' closedday' : '') + (off ? ' off' : ''), 'data-emp': e.id, 'data-day': String(d) });
      if (off) td.appendChild(h('span', { cls: 'offtag', text: 'Off' + (off.status === 'pending' ? ' (asked)' : '') }));
      list.forEach(function (s) {
        var chipEl = h('button', { cls: 'sh ' + roleKind(s.role), title: 'Drag to move · tap to change' }, [h('b', { text: t12(s.start) + '–' + t12(s.end) }), h('span', { text: s.role + (s.note ? ' · ' + s.note : '') })]);
        chipEl.addEventListener('click', function (ev) { ev.stopPropagation(); if (chipEl._dragged) return; var fm = shiftForm(s, emps, function () { w._dirty = true; changed('Shift saved'); mm.close(); render(); }); var mm = modal('Shift · ' + dlong(date), fm.el, [h('button', { cls: 'btn danger', text: 'Delete', on: { click: function () { w.shifts.splice(w.shifts.indexOf(s), 1); w._dirty = true; changed('Shift deleted'); mm.close(); render(); } } }), h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { mm.close(); } } }), h('button', { cls: 'btn accent', text: 'Save', on: { click: fm.save } })]); });
        dragShift(chipEl, s, tbl, w);
        td.appendChild(chipEl);
      });
      td.appendChild(h('span', { cls: 'add', text: '+' }));
      td.addEventListener('click', function () {
        var s = { id: uid(), emp: e.id, day: d, role: /bar/i.test(e.position) ? 'Bar' : /cook|line/i.test(e.position) ? 'Line' : /sous/i.test(e.position) ? 'Sous' : /dish/i.test(e.position) ? 'Dish' : /manager/i.test(e.position) ? 'Manager' : 'Server' };
        s.start = (ROLES.filter(function (r) { return r[0] === s.role; })[0] || [0, '16:30'])[1]; s.end = 'close';
        var fm = shiftForm(s, emps, function () { w.shifts.push(s); w._dirty = true; changed('Shift added'); mm.close(); render(); });
        var mm = modal('New shift · ' + dlong(date), [off ? h('p', { cls: 'msg', text: e.name + ' asked for this day off' + (off.reason ? ' (' + off.reason + ')' : '') + '.' }) : null, fm.el], [h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { mm.close(); } } }), h('button', { cls: 'btn accent', text: 'Add shift', on: { click: fm.save } })]);
      });
      tr.appendChild(td);
    })(d2);
    var eh = sum(w.shifts.filter(function (s) { return s.emp === e.id; }), shiftHours);
    tr.appendChild(h('td', { cls: 'r num tot' + (eh > 40 ? ' over' : ''), title: eh > 40 ? 'Over 40 hours — overtime' : '', text: eh ? (Math.round(eh * 10) / 10) + (eh > 40 ? ' OT' : '') : '' }));
    body.appendChild(tr);
  });
  var foot = h('tr', null, [h('th', { cls: 'who', text: 'Hours' })]);
  for (var d3 = 0; d3 < 7; d3++) { var dh = sum(w.shifts.filter(function (s) { return s.day === d3; }), shiftHours); foot.appendChild(h('td', { cls: 'r num', text: dh ? Math.round(dh * 10) / 10 : '' })); }
  foot.appendChild(h('td', { cls: 'r num', text: Math.round(hrs * 10) / 10 }));
  tbl.appendChild(h('tfoot', null, foot));
  el.appendChild(h('div', { cls: 'card', style: 'margin-top:16px;padding:0' }, h('div', { cls: 'scrollx' }, tbl)));
  el.appendChild(h('div', { cls: 'legend', style: 'margin-top:10px' }, [h('span', null, [h('i', { style: 'background:var(--c1)' }), 'Floor']), h('span', null, [h('i', { style: 'background:var(--c2)' }), 'Bar']), h('span', null, [h('i', { style: 'background:var(--c3)' }), 'Kitchen']), h('span', { text: 'Tap an empty square to add a shift · drag a shift to move it · striped = time off' })]));
};
function dragShift(chipEl, s, tbl, w) {
  chipEl.addEventListener('pointerdown', function (e) {
    if (e.button) return; var sx = e.clientX, sy = e.clientY, moved = false, ghost = null, over = null; chipEl._dragged = false;
    function mv(ev) {
      if (!moved && Math.hypot(ev.clientX - sx, ev.clientY - sy) < 6) return;
      if (!moved) { moved = true; chipEl._dragged = true; ghost = chipEl.cloneNode(true); ghost.className += ' ghost'; document.body.appendChild(ghost); chipEl.style.opacity = '.35'; }
      ghost.style.left = ev.clientX + 8 + 'px'; ghost.style.top = ev.clientY + 8 + 'px';
      var t = document.elementFromPoint(ev.clientX, ev.clientY), cell = t && t.closest && t.closest('td.cell');
      if (over && over !== cell) over.classList.remove('drop'); over = cell; if (cell) cell.classList.add('drop');
      ev.preventDefault();
    }
    function up() {
      window.removeEventListener('pointermove', mv); window.removeEventListener('pointerup', up);
      if (ghost) ghost.remove(); chipEl.style.opacity = '';
      if (moved && over) { over.classList.remove('drop'); s.emp = over.getAttribute('data-emp'); s.day = +over.getAttribute('data-day'); w._dirty = true; changed('Shift moved'); render(); }
      setTimeout(function () { chipEl._dragged = false; }, 50);
    }
    window.addEventListener('pointermove', mv, { passive: false }); window.addEventListener('pointerup', up);
  });
}

/* ---------- payroll: type the week's hours, see pay and tips worked out ---------- */
var OT_AFTER = 40, OT_RATE = 1.5, TAX = 0.0965, CARD_FEE = 0.0275;   // employer payroll taxes, roughly (FICA + unemployment)
function payRates() {
  if (S._rates) return S._rates;
  var r = {}; (S.data.payrates || []).forEach(function (x) { r[x.emp] = { rate: x.rate, type: x.pay_type || 'hourly', salary: x.weekly_salary, tip: !!x.tip_eligible }; });
  (S.data.employees || []).forEach(function (e) { if (!r[e.id]) { var p = String(e.position || '').toLowerCase(); r[e.id] = /owner/.test(p) ? { type: 'salary', salary: 1442.31, tip: false } : /manager/.test(p) ? { rate: 17.5, type: 'hourly', tip: false } : /server|host/.test(p) ? { rate: 10.65, type: 'hourly', tip: true } : /bar/.test(p) ? { rate: 10.65, type: 'hourly', tip: true } : /sous/.test(p) ? { rate: 22, type: 'hourly', tip: false } : /dish/.test(p) ? { rate: 16, type: 'hourly', tip: false } : { rate: 21, type: 'hourly', tip: false }; r[e.id].guess = !S.data.payrates; } });
  return S._rates = r;
}
function payWeek(ws) {
  S.pay = S.pay || {};
  if (S.pay[ws]) return S.pay[ws];
  var src = (S.data.payedit || []).filter(function (x) { return x.week_start === ws; })[0], rows = {};
  if (src && src.rows) Object.keys(src.rows).forEach(function (k) { if (k[0] === '_') return; var r = src.rows[k]; rows[k] = { hours: (r.hours || []).map(function (x) { return x === '' || x == null ? '' : +x; }), adj: +r.adj || 0 }; });
  var sm = (S.data.payweeks || []).filter(function (x) { return x.week_start === ws; })[0];
  var tp = src && src.tip_pool && typeof src.tip_pool === 'object' ? src.tip_pool : { cc: src ? +src.tip_pool || 0 : 0, cash: 0 };
  return S.pay[ws] = { ws: ws, rows: rows, cc: +tp.cc || 0, cash: +tp.cash || 0, status: src ? src.status : (sm ? sm.status : 'draft'), net: sm && sm.summary ? sm.summary.net : null };
}
function payCalc(P) {
  var R = payRates(), emps = (S.data.employees || []).filter(function (e) { return e.active !== false && !e.removed_at; }), lines = [];
  emps.forEach(function (e) {
    var r = P.rows[e.id] = P.rows[e.id] || { hours: ['', '', '', '', '', '', ''], adj: 0 }, info = R[e.id] || {};
    var hrs = sum(r.hours, function (x) { return +x || 0; }), ot = info.type === 'salary' ? 0 : Math.max(0, hrs - OT_AFTER), reg = hrs - ot;
    var wages = info.type === 'salary' ? +info.salary || 0 : reg * (+info.rate || 0) + ot * (+info.rate || 0) * OT_RATE;
    lines.push({ e: e, r: r, info: info, hrs: hrs, reg: reg, ot: ot, wages: wages, tips: 0, adj: +r.adj || 0 });
  });
  P.tip_pool = P.cc * (1 - CARD_FEE) + P.cash;
  var tipHrs = sum(lines.filter(function (L) { return L.info.tip; }), function (L) { return L.hrs; });
  lines.forEach(function (L) { L.tips = L.info.tip && tipHrs ? P.tip_pool * L.hrs / tipHrs : 0; L.gross = L.wages + L.tips + L.adj; });
  var T = { hrs: sum(lines, function (L) { return L.hrs; }), ot: sum(lines, function (L) { return L.ot; }), wages: sum(lines, function (L) { return L.wages; }), tips: sum(lines, function (L) { return L.tips; }), adj: sum(lines, function (L) { return L.adj; }), gross: sum(lines, function (L) { return L.gross; }) };
  T.cost = (T.wages + T.adj) * (1 + TAX); return { lines: lines, T: T, tipHrs: tipHrs };
}
function fillFromSchedule(P) {
  var w = (S.data.weeks || []).filter(function (x) { return x.week_start === P.ws; })[0]; if (!w) return 0;
  var shifts = w._edit ? w.shifts : w.published || w.shifts || [], n = 0;
  shifts.forEach(function (s) { var r = P.rows[s.emp] = P.rows[s.emp] || { hours: ['', '', '', '', '', '', ''], adj: 0 }; r.hours[s.day] = Math.round(((+r.hours[s.day] || 0) + shiftHours(s)) * 100) / 100; n++; });
  return n;
}
PAGES['business/payroll'] = function (el) {
  if (!S.data.employees) return missing(el, 'employees');
  var weeksAll = uniq((S.data.payweeks || []).map(function (x) { return x.week_start; }).concat((S.data.payedit || []).map(function (x) { return x.week_start; }))).sort();
  var thisW = sunday(addDays(new Date(), -7)), ws = S.payWeek || thisW, P = payWeek(ws), C = payCalc(P), locked = P.status === 'final';
  var start = pday(ws);
  el.appendChild(h('div', { cls: 'toolbar', style: 'justify-content:space-between' }, [
    h('div', { cls: 'chips', style: 'align-items:center' }, [h('button', { cls: 'btn small', 'aria-label': 'Previous week', text: '‹', on: { click: function () { S.payWeek = iso(addDays(start, -7)); render(); } } }), h('b', { style: 'font-size:1rem', text: 'Pay week of ' + start.toLocaleDateString(undefined, { month: 'long', day: 'numeric' }) }), h('button', { cls: 'btn small', 'aria-label': 'Next week', text: '›', on: { click: function () { S.payWeek = iso(addDays(start, 7)); render(); } } }), h('span', { cls: 'chip ' + (locked ? 'green' : 'gold'), text: locked ? 'Finalized' : 'Draft' })]),
    h('div', { cls: 'chips' }, [
      h('button', { cls: 'btn small', text: 'Pay rates', on: { click: ratesDialog } }),
      locked ? null : h('button', { cls: 'btn small', text: 'Fill from schedule', on: { click: function () { var n = fillFromSchedule(P); changed(n ? 'Added hours from ' + plural(n, 'shift') : null); if (!n) toast('No schedule for this week.'); render(); } } }),
      locked ? h('button', { cls: 'btn small', text: 'Reopen', on: { click: function () { P.status = 'draft'; changed('Reopened'); render(); } } }) : h('button', { cls: 'btn accent', text: 'Finalize & send to the accountant', on: { click: function () { var miss = C.lines.filter(function (L) { return L.hrs && L.info.type !== 'salary' && !L.info.rate; }); if (miss.length) { toast('Set a pay rate for ' + miss.map(function (L) { return L.e.name; }).join(', ') + ' first.'); return; } P.status = 'final'; changed(); toast('On the real site this locks the week and emails the hours sheet. Nothing was sent from here.'); render(); } } })])]));
  // the week at a glance
  var netIn = inp(P.net != null ? Math.round(P.net) : '', { inputmode: 'decimal', placeholder: 'From Square', disabled: locked }), cc = inp(P.cc ? String(Math.round(P.cc * 100) / 100) : '', { inputmode: 'decimal', placeholder: 'card', disabled: locked, 'aria-label': 'Card tips' }), cash = inp(P.cash ? String(Math.round(P.cash * 100) / 100) : '', { inputmode: 'decimal', placeholder: 'cash', disabled: locked, 'aria-label': 'Cash tips' });
  netIn.addEventListener('change', function () { var v = numv(netIn); P.net = v == null || isNaN(v) ? null : v; changed(); render(); });
  [[cc, 'cc'], [cash, 'cash']].forEach(function (x) { x[0].addEventListener('change', function () { var v = numv(x[0]); P[x[1]] = v == null || isNaN(v) ? 0 : v; changed(); render(); }); });
  var g = h('div', { cls: 'grid g5' }); el.appendChild(g);
  g.appendChild(h('div', { cls: 'kpi' }, [h('span', { text: 'Net sales this week' }), h('div', { cls: 'kin' }, [h('em', { text: '$' }), netIn]), h('small', { text: 'needed for labor %' })]));
  g.appendChild(h('div', { cls: 'kpi' }, [h('span', { text: 'Tips: card · cash' }), h('div', { cls: 'kin two' }, [h('em', { text: '$' }), cc, h('em', { text: '$' }), cash]), h('small', { text: money(P.tip_pool) + ' pool after 2.75% card fee' + (C.tipHrs ? ' · ' + money(P.tip_pool / C.tipHrs) + '/hr' : '') })]));
  g.appendChild(kpiCard('Hours', String(Math.round(C.T.hrs * 10) / 10), null, null, { sub: C.T.ot ? Math.round(C.T.ot * 10) / 10 + ' overtime' : 'no overtime' }));
  g.appendChild(kpiCard('Wages & adjustments', money(C.T.wages + C.T.adj, 0), null, null, { sub: money(C.T.cost, 0) + ' with payroll taxes' }));
  g.appendChild(kpiCard('Labor %', P.net ? pct(C.T.cost / P.net) : '—', null, null, { sub: P.net ? 'target 30%' : 'type the week’s sales' }));
  // the hours sheet
  var days = []; for (var d = 0; d < 7; d++) days.push(addDays(start, d));
  var tbl = h('table', { cls: 'pay' });
  tbl.appendChild(h('thead', null, h('tr', null, [h('th', { cls: 'who', text: 'Employee' })].concat(days.map(function (x) { return h('th', { cls: 'c', text: x.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + x.getDate() }); })).concat([h('th', { cls: 'r', text: 'Hours' }), h('th', { cls: 'r', text: 'Rate' }), h('th', { cls: 'r', text: 'Wages' }), h('th', { cls: 'r', text: 'Tips' }), h('th', { cls: 'r', text: 'Adjust' }), h('th', { cls: 'r', text: 'Gross pay' })]))));
  var tb = h('tbody'); tbl.appendChild(tb);
  C.lines.forEach(function (L) {
    var tr = h('tr', null, [h('th', { cls: 'who' }, [h('b', { text: L.e.name }), h('small', { text: (L.e.position || '') + (L.info.tip ? ' · tip pool' : '') })])]);
    L.r.hours.forEach(function (v, di) {
      var x = h('input', { type: 'text', inputmode: 'decimal', value: v === '' || v == null ? '' : String(v), disabled: locked, 'aria-label': L.e.name + ' hours ' + days[di].toLocaleDateString(undefined, { weekday: 'long' }) });
      x.addEventListener('change', function () { var n = numv(x); if (n != null && (isNaN(n) || n < 0 || n > 24)) { x.classList.add('bad'); return; } x.classList.remove('bad'); L.r.hours[di] = n == null ? '' : n; changed(); render(); });
      x.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var all = [].slice.call(tbl.querySelectorAll('td.h input')), i = all.indexOf(x); if (all[i + 7]) all[i + 7].focus(); else x.blur(); } });
      tr.appendChild(h('td', { cls: 'h' }, x));
    });
    var adj = h('input', { type: 'text', inputmode: 'decimal', value: L.adj ? L.adj.toFixed(2) : '', disabled: locked, placeholder: '0', 'aria-label': 'Adjustment for ' + L.e.name });
    adj.addEventListener('change', function () { var n = numv(adj); L.r.adj = n == null || isNaN(n) ? 0 : n; changed(); render(); });
    tr.appendChild(h('td', { cls: 'r num', text: L.hrs ? (Math.round(L.hrs * 100) / 100) + (L.ot ? ' (' + Math.round(L.ot * 10) / 10 + ' OT)' : '') : '' }));
    tr.appendChild(h('td', { cls: 'r num' + (!L.info.rate && L.info.type !== 'salary' ? ' warnc' : ''), text: L.info.type === 'salary' ? money(L.info.salary, 0) + '/wk' : L.info.rate ? money(L.info.rate) : 'set rate' }));
    tr.appendChild(h('td', { cls: 'r num', text: L.wages ? money(L.wages) : '' }));
    tr.appendChild(h('td', { cls: 'r num', text: L.tips ? money(L.tips) : '' }));
    tr.appendChild(h('td', { cls: 'h adj' }, adj));
    tr.appendChild(h('td', { cls: 'r num', html: L.gross ? '<b>' + esc(money(L.gross)) + '</b>' : '' }));
    tb.appendChild(tr);
  });
  tbl.appendChild(h('tfoot', null, h('tr', null, [h('th', { cls: 'who', text: 'Total' })].concat(days.map(function (x, di) { return h('td', { cls: 'r num', text: (function (v) { return v ? Math.round(v * 10) / 10 : ''; })(sum(C.lines, function (L) { return +L.r.hours[di] || 0; })) }); })).concat([h('td', { cls: 'r num', text: Math.round(C.T.hrs * 10) / 10 }), h('td'), h('td', { cls: 'r num', text: money(C.T.wages) }), h('td', { cls: 'r num', text: money(C.T.tips) }), h('td', { cls: 'r num', text: C.T.adj ? money(C.T.adj) : '' }), h('td', { cls: 'r num', text: money(C.T.gross) })]))));
  el.appendChild(h('div', { cls: 'card', style: 'margin-top:16px;padding:0' }, h('div', { cls: 'scrollx' }, tbl)));
  el.appendChild(h('p', { cls: 'fine', style: 'margin-top:10px', text: 'Type hours like 6.5 · Enter moves down to the next person · overtime is anything over 40 hours at 1.5× · the tip pool is card tips less the 2.75% processing fee plus cash, split by hours among tip-pool staff · labor % includes about ' + Math.round(TAX * 1000) / 10 + '% employer payroll taxes.' + (payRates()[(S.data.employees || [{}])[0].id] && payRates()[(S.data.employees || [{}])[0].id].guess ? ' Pay rates here are examples — your login couldn’t read the real ones, or there aren’t any.' : '') }));
  // past weeks under it
  if (weeksAll.length) el.appendChild(h('div', { cls: 'card', style: 'margin-top:16px' }, [h('h2', { text: 'Past pay weeks' }), h('div', { cls: 'list' }, weeksAll.slice(-8).reverse().map(function (w) { var sm = ((S.data.payweeks || []).filter(function (x) { return x.week_start === w; })[0] || {}).summary || {}; return h('div', { cls: 'row click', on: { click: function () { S.payWeek = w; render(); window.scrollTo(0, 0); } } }, [h('div', { cls: 'main-t' }, [h('b', { text: 'Week of ' + dshort(w) }), h('span', { text: [sm.net ? money(sm.net, 0) + ' sales' : '', sm.pct ? pct(sm.pct) + ' labor' : ''].filter(Boolean).join(' · ') })]), h('span', { cls: 'go', text: 'Open →' })]); }))]));
};
function ratesDialog() {
  var R = payRates(), emps = (S.data.employees || []).filter(function (e) { return e.active !== false && !e.removed_at; });
  var rows = emps.map(function (e) {
    var r = R[e.id] = R[e.id] || { type: 'hourly', tip: false }, type = sel([['hourly', 'Hourly'], ['salary', 'Salary']], r.type), amt = inp(r.type === 'salary' ? r.salary : r.rate, { inputmode: 'decimal', placeholder: r.type === 'salary' ? 'per week' : 'per hour' }), tip = h('input', { type: 'checkbox' }); tip.checked = !!r.tip;
    type.addEventListener('change', function () { amt.placeholder = type.value === 'salary' ? 'per week' : 'per hour'; });
    return { e: e, r: r, type: type, amt: amt, tip: tip };
  });
  var m = modal('Pay rates', h('table', { cls: 't rates' }, [h('thead', null, h('tr', null, [h('th', { text: 'Employee' }), h('th', { text: 'Paid' }), h('th', { text: '$' }), h('th', { text: 'Tip pool' })])), h('tbody', null, rows.map(function (x) { return h('tr', null, [h('td', null, [h('b', { text: x.e.name, style: 'font-weight:500' }), h('div', { cls: 'fine', text: x.e.position || '' })]), h('td', null, x.type), h('td', null, x.amt), h('td', { cls: 'c' }, x.tip)]); }))]),
    [h('span', { cls: 'fine', text: 'Changes apply to this week and on.' }), h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn accent', text: 'Save rates', on: { click: function () { rows.forEach(function (x) { var v = numv(x.amt); x.r.type = x.type.value; if (x.type.value === 'salary') x.r.salary = isNaN(v) ? null : v; else x.r.rate = isNaN(v) ? null : v; x.r.tip = x.tip.checked; x.r.guess = false; }); m.close(); changed('Pay rates saved'); render(); } } })], true);
}
/* =====================================================================================
   CALENDAR — one place that puts events, meetings, the staff schedule, time off,
   catering inquiries, covers, to-dos and holidays on the same grid.
   ===================================================================================== */
var CAL_T = { private: ['Private event', '#b0703f'], supper: ['Supper Club', '#3f6b4f'], catering: ['Catering / off-site', '#2f5f8a'], meeting: ['Meeting / tasting', '#6b6f74'], closed: ['Closed / holiday', '#a33a2c'], other: ['Other', '#2b3035'] };
var OFF_C = '#7a5c99', OPEN_DOW = [3, 4, 5, 6], TL0 = 10, TL1 = 23;
var KIND = { f: ['Floor', 'var(--c1)'], b: ['Bar', 'var(--c2)'], k: ['Kitchen', 'var(--c3)'] };
function isMgr() { return ['owner', 'manager'].indexOf(role()) !== -1; }
function calLayers() {
  var L = [['events', 'Events'], ['meetings', 'Meetings'], ['staff', 'Who’s working'], ['timeoff', 'Time off'], ['covers', 'Covers'], ['holidays', 'Holidays']];
  if (isMgr()) L.splice(4, 0, ['inquiries', 'Catering inquiries'], ['tasks', 'To-dos & reviews']);
  return L;
}
function calOn(k) { return !(S.calOff || {})[k]; }
function ctype(t) { return CAL_T[t] || CAL_T.other; }
function evTime(e) { return e.all_day || !e.start ? 'All day' : t12(e.start) + (e.end ? '–' + t12(e.end) : ''); }
function nthDow(y, m, dow, n) { var f = new Date(y, m, 1); return new Date(y, m, 1 + (dow - f.getDay() + 7) % 7 + 7 * (n - 1)); }
function lastDow(y, m, dow) { var l = new Date(y, m + 1, 0); return new Date(y, m, l.getDate() - (l.getDay() - dow + 7) % 7); }
function easter(y) { var a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), hh = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, m = Math.floor((a + 11 * hh + 22 * l) / 451), mo = Math.floor((hh + l - 7 * m + 114) / 31), da = ((hh + l - 7 * m + 114) % 31) + 1; return new Date(y, mo - 1, da); }
var HOLS = {};
function holiday(ds) {
  var y = +ds.slice(0, 4);
  if (!HOLS[y]) { var o = HOLS[y] = {}; [[new Date(y, 0, 1), 'New Year’s Day'], [new Date(y, 1, 14), 'Valentine’s Day'], [easter(y), 'Easter'], [nthDow(y, 4, 0, 2), 'Mother’s Day'], [lastDow(y, 4, 1), 'Memorial Day'], [nthDow(y, 5, 0, 3), 'Father’s Day'], [new Date(y, 6, 4), 'Fourth of July'], [nthDow(y, 8, 1, 1), 'Labor Day'], [new Date(y, 9, 31), 'Halloween'], [nthDow(y, 10, 4, 4), 'Thanksgiving'], [new Date(y, 11, 24), 'Christmas Eve'], [new Date(y, 11, 25), 'Christmas'], [new Date(y, 11, 31), 'New Year’s Eve']].forEach(function (x) { o[iso(x[0])] = x[1]; }); }
  return HOLS[y][ds] || null;
}
function weekShifts(ws) { var w = (S.data.weeks || []).filter(function (x) { return x.week_start === ws; })[0]; return w ? { w: w, shifts: w._edit ? w.shifts : (w.published || w.shifts || []) } : null; }
function coversOn(ds) { var r = (S.data.eodAll || []).filter(function (x) { return x.report_date === ds; }); return r.length ? sum(r, function (x) { return +x.actual_covers || 0; }) : null; }
function calDay(ds) {
  var d = pday(ds), dow = d.getDay(), ws = iso(addDays(d, -dow)), wk = weekShifts(ws), mgr = isMgr();
  var ev = (S.data.events || []).filter(function (e) { return e.date === ds; }).sort(function (a, b) { return (a.all_day ? '0' : a.start || '99') < (b.all_day ? '0' : b.start || '99') ? -1 : 1; });
  var c = { ds: ds, d: d, dow: dow, ws: ws, holiday: holiday(ds), open: OPEN_DOW.indexOf(dow) !== -1,
    events: ev.filter(function (e) { return e.type !== 'meeting' && e.type !== 'closed'; }), meetings: ev.filter(function (e) { return e.type === 'meeting'; }), closedEv: ev.filter(function (e) { return e.type === 'closed'; }),
    shifts: wk ? wk.shifts.filter(function (s) { return s.day === dow; }).sort(function (a, b) { return roleKind(a.role).localeCompare(roleKind(b.role)) || mins(a.start) - mins(b.start); }) : null, status: wk ? wk.w.status : null,
    off: (S.data.timeoff || []).filter(function (x) { return x.status !== 'denied' && x.start_date <= ds && x.end_date >= ds; }),
    inq: mgr ? (S.data.catering || []).filter(function (x) { return x.event_date === ds && ['beo', 'completed', 'declined', 'spam'].indexOf(x.status) === -1; }) : [],
    todos: mgr ? (S.data.todos || []).filter(function (x) { return x.due === ds; }) : [],
    reviews: mgr ? (S.data.reviews || []).filter(function (x) { return x.status !== 'signed' && (x.due_date || x.review_date) === ds; }) : [],
    covers: coversOn(ds), preshift: (S.data.preshift || []).filter(function (x) { return x.service_date === ds; }) };
  if (c.closedEv.length) c.open = false;
  c.guests = sum(c.events, function (e) { return +e.guests || 0; });
  c.hours = c.shifts ? sum(c.shifts, shiftHours) : 0;
  c.wages = c.shifts ? sum(c.shifts, function (s) { return shiftHours(s) * rateOf(s.emp); }) : 0;
  c.warn = [];
  if (c.shifts) c.off.forEach(function (x) { if (c.shifts.some(function (s) { return s.emp === x.emp; })) c.warn.push([x.status === 'pending' ? 'gold' : 'red', empName(x.emp) + ' is on the schedule but ' + (x.status === 'pending' ? 'asked for' : 'has') + ' the day off']); });
  if (c.closedEv.length && c.shifts && c.shifts.length) c.warn.push(['red', 'Marked “' + c.closedEv[0].title + '” but ' + plural(c.shifts.length, 'person') + (c.shifts.length === 1 ? ' is' : ' are') + ' on the schedule']);
  c.events.forEach(function (e) {
    if (e.type === 'catering') return;
    var floor = c.shifts ? c.shifts.filter(function (s) { return roleKind(s.role) === 'f'; }).length : 0;
    if (c.closedEv.length) c.warn.push(['red', e.title + ' is on a day marked closed']);
    else if (c.shifts && !c.shifts.length) c.warn.push(['red', e.title + ': no one is scheduled that day']);
    else if (!c.shifts && OPEN_DOW.indexOf(dow) === -1) c.warn.push(['gold', e.title + ' is on a normally closed day — remember to schedule staff']);
    else if (c.shifts && +e.guests >= 30 && floor < 3) c.warn.push(['gold', e.title + ': ' + e.guests + ' guests with ' + plural(floor, 'person') + ' on the floor']);
  });
  return c;
}
function worst(w) { return w.some(function (x) { return x[0] === 'red'; }) ? 'red' : 'gold'; }
function staffBar(shifts) {
  var n = { f: 0, b: 0, k: 0 }; shifts.forEach(function (s) { n[roleKind(s.role)]++; });
  return h('span', { cls: 'sbar', title: 'Floor ' + n.f + ' · Bar ' + n.b + ' · Kitchen ' + n.k }, ['f', 'b', 'k'].filter(function (k) { return n[k]; }).map(function (k) { return h('i', { style: 'flex:' + n[k] + ';background:' + KIND[k][1] }); }));
}
/* ---------- chips used by every view ---------- */
function calChips(c, opts) {
  var out = [], stop = function (fn) { return function (e) { e.stopPropagation(); fn(); }; };
  if (calOn('events')) c.events.forEach(function (e) { out.push(h('button', { cls: 'cc', style: '--c:' + ctype(e.type)[1], title: ctype(e.type)[0] + ' · ' + evTime(e) + ' · ' + e.title + (e.guests ? ' · ' + e.guests + ' guests' : ''), on: { click: stop(function () { openEvent(e); }) } }, [e.all_day || !e.start ? null : h('b', { text: t12(e.start) }), h('span', { text: e.title }), e.guests ? h('em', { text: e.guests }) : null])); });
  if (calOn('meetings')) c.meetings.forEach(function (e) { out.push(h('button', { cls: 'cc mt', style: '--c:' + ctype('meeting')[1], title: 'Meeting · ' + evTime(e) + ' · ' + e.title, on: { click: stop(function () { openEvent(e); }) } }, [e.start ? h('b', { text: t12(e.start) }) : null, h('span', { text: e.title })])); });
  if (calOn('timeoff')) c.off.forEach(function (x) { out.push(h('span', { cls: 'cc off' + (x.status === 'pending' ? ' pend' : ''), style: '--c:' + OFF_C, title: empName(x.emp) + ' — time off' + (x.status === 'pending' ? ' (requested)' : '') + (x.reason ? ': ' + x.reason : '') }, [h('span', { text: empName(x.emp).split(' ')[0] + ' off' + (x.status === 'pending' ? '?' : '') })])); });
  if (calOn('inquiries')) c.inq.forEach(function (x) { out.push(h('button', { cls: 'cc tent', style: '--c:' + ctype('catering')[1], title: 'Catering inquiry (' + (x.status || 'new') + ') · ' + (x.event_name || x.name) + (x.guests ? ' · ' + x.guests + ' guests' : ''), on: { click: stop(function () { go('catering', 'pipeline'); }) } }, [h('b', { text: '?' }), h('span', { text: x.event_name || x.name }), x.guests ? h('em', { text: x.guests }) : null])); });
  if (calOn('tasks')) { c.todos.forEach(function (x) { out.push(h('span', { cls: 'cc task', title: 'To-do: ' + x.title }, [h('b', { text: '☐' }), h('span', { text: x.title })])); }); c.reviews.forEach(function (x) { out.push(h('button', { cls: 'cc task', title: 'Review due: ' + empName(x.emp), on: { click: stop(function () { go('team', 'reviews'); }) } }, [h('b', { text: '★' }), h('span', { text: 'Review · ' + empName(x.emp).split(' ')[0] })])); }); }
  return out;
}
/* ---------- the toolbar shared by Month, Week and Coming up ---------- */
function calAnchor() { return S.calDate || iso(); }
function calHead(el, view) {
  var a = pday(calAnchor()), title, prev, next;
  if (view === 'month') { title = a.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }); prev = iso(new Date(a.getFullYear(), a.getMonth() - 1, 1)); next = iso(new Date(a.getFullYear(), a.getMonth() + 1, 1)); }
  else if (view === 'week') { var s0 = addDays(a, -a.getDay()), s6 = addDays(s0, 6); title = s0.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + ' – ' + s6.toLocaleDateString(undefined, { month: s6.getMonth() === s0.getMonth() ? undefined : 'short', day: 'numeric', year: 'numeric' }); prev = iso(addDays(a, -7)); next = iso(addDays(a, 7)); }
  else { title = 'Next 8 weeks'; }
  el.appendChild(h('div', { cls: 'toolbar calbar' }, [
    view !== 'agenda' ? h('div', { cls: 'chips', style: 'align-items:center;gap:6px' }, [h('button', { cls: 'btn small', 'aria-label': 'Previous', text: '‹', on: { click: function () { S.calDate = prev; render(); } } }), h('button', { cls: 'btn small', 'aria-label': 'Next', text: '›', on: { click: function () { S.calDate = next; render(); } } }), h('button', { cls: 'btn small', text: 'Today', on: { click: function () { S.calDate = null; render(); } } })]) : null,
    h('h2', { cls: 'caltitle', text: title }),
    h('span', { cls: 'sp', style: 'flex:1' }),
    h('button', { cls: 'btn accent', text: '+ Add event', on: { click: function () { openEvent(null, view === 'agenda' ? iso() : calAnchor()); } } })]));
  el.appendChild(h('div', { cls: 'layers' }, [h('span', { cls: 'fine', text: 'Show' })].concat(calLayers().map(function (L) {
    var on = calOn(L[0]), sw = { events: 'var(--c1)', meetings: '#6b6f74', staff: 'var(--c3)', timeoff: OFF_C, inquiries: 'var(--c2)', tasks: 'var(--gold)', covers: 'var(--ink2)', holidays: 'var(--red)' }[L[0]];
    return h('button', { cls: 'layer', 'aria-pressed': on ? 'true' : 'false', on: { click: function () { S.calOff = S.calOff || {}; S.calOff[L[0]] = on; render(); } } }, [h('i', { style: 'background:' + sw }), L[1]]);
  }))));
}
function calStats(el, days) {
  var cs = days.map(calDay), ev = [], mt = 0, sup = 0, hrs = 0, wages = 0, offDays = 0, inq = 0, open = 0, scheduled = 0, warns = 0, cov = 0, covDays = 0;
  cs.forEach(function (c) { ev = ev.concat(c.events); mt += c.meetings.length; sup += c.events.filter(function (e) { return e.type === 'supper'; }).length; hrs += c.hours; wages += c.wages; offDays += c.off.length; inq += c.inq.length; if (c.open) open++; if (c.shifts) scheduled++; warns += c.warn.length; if (c.covers != null) { cov += c.covers; covDays++; } });
  var guests = sum(ev, function (e) { return +e.guests || 0; });
  var tiles = [['Events', String(ev.length), guests ? guests + ' guests booked' : 'no guest counts'], ['Supper Clubs', String(sup), sup ? 'on the calendar' : '—'], ['Meetings & tastings', String(mt), ''], ['Days open', String(open), cs.length - open + ' closed']];
  if (role() === 'owner' || role() === 'manager') tiles.push(['Scheduled hours', hrs ? String(Math.round(hrs)) : '—', scheduled ? (role() === 'owner' ? '≈ ' + money(wages, 0) + ' wages · ' : '') + scheduled + ' of ' + cs.length + ' days scheduled' : 'no schedule made yet']);
  tiles.push(['Time off', String(offDays), offDays ? 'person-days' : 'nobody off']);
  if (calOn('covers')) tiles.push(['Covers so far', covDays ? String(cov) : '—', covDays ? Math.round(cov / covDays) + ' a night' : 'none reported yet']);
  if (warns) tiles.push(['Heads-up', String(warns), 'conflicts to look at', 'warn']);
  el.appendChild(h('div', { cls: 'cstats' }, tiles.map(function (t) { return h('div', { cls: 'cst' + (t[3] ? ' ' + t[3] : '') }, [h('span', { text: t[0] }), h('b', { text: t[1] }), h('small', { text: t[2] })]); })));
}
/* ---------- MONTH ---------- */
PAGES['calendar/month'] = function (el) {
  calHead(el, 'month');
  var a = pday(calAnchor()), first = new Date(a.getFullYear(), a.getMonth(), 1), last = new Date(a.getFullYear(), a.getMonth() + 1, 0), t = iso();
  var mdays = []; for (var x = new Date(first); x <= last; x = addDays(x, 1)) mdays.push(iso(x));
  calStats(el, mdays);
  var start = addDays(first, -first.getDay()), weeks = Math.ceil((first.getDay() + last.getDate()) / 7);
  var grid = h('div', { cls: 'cmonth' });
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].forEach(function (n, i) { grid.appendChild(h('div', { cls: 'cdow' + (OPEN_DOW.indexOf(i) === -1 ? ' shut' : '') }, [n, OPEN_DOW.indexOf(i) === -1 ? h('small', { text: ' closed' }) : null])); });
  grid.appendChild(h('div', { cls: 'cdow wk', text: 'Week' }));
  for (var w = 0; w < weeks; w++) {
    var wsD = addDays(start, w * 7), wc = [];
    for (var i = 0; i < 7; i++) (function (d) {
      var ds = iso(d), c = calDay(ds); wc.push(c);
      var out = d.getMonth() !== a.getMonth();
      var cell = h('div', { cls: 'cday' + (out ? ' out' : '') + (ds === t ? ' today' : '') + (!c.open ? ' shut' : '') + (ds < t ? ' past' : ''), tabindex: '0', role: 'button', 'aria-label': dlong(ds), on: { click: function () { dayDrawer(ds); }, keydown: function (e) { if (e.key === 'Enter') dayDrawer(ds); } } });
      var right = [];
      if (calOn('covers') && c.covers != null) right.push(h('span', { cls: 'cv', title: 'Covers served', text: c.covers + ' cvrs' }));
      else if (calOn('events') && c.guests && ds >= t) right.push(h('span', { cls: 'cv bk', title: 'Guests booked for events', text: c.guests + ' booked' }));
      cell.appendChild(h('div', { cls: 'chd' }, [h('span', { cls: 'dn', text: d.getDate() === 1 ? d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : String(d.getDate()) }), c.warn.length ? h('span', { cls: 'wdot ' + worst(c.warn), title: c.warn.map(function (x) { return x[1]; }).join('\n'), text: '!' }) : null, h('span', { cls: 'sp' })].concat(right)));
      if (calOn('holidays') && c.holiday) cell.appendChild(h('div', { cls: 'hol', text: c.holiday }));
      if (c.closedEv.length) cell.appendChild(h('div', { cls: 'shuttag', text: c.closedEv[0].title }));
      if (calOn('staff') && c.shifts && c.shifts.length) cell.appendChild(h('div', { cls: 'staffline' + (c.status !== 'published' ? ' draft' : '') }, [staffBar(c.shifts), h('span', { text: c.shifts.length + ' on · ' + Math.round(c.hours) + 'h' })]));
      else if (calOn('staff') && c.open && !c.shifts && ds >= t && pday(ds) <= addDays(new Date(), 21)) cell.appendChild(h('div', { cls: 'staffline none', text: 'No schedule yet' }));
      var chips = calChips(c), max = 4;
      chips.slice(0, chips.length > max ? max - 1 : max).forEach(function (ch) { cell.appendChild(ch); });
      if (chips.length > max) cell.appendChild(h('span', { cls: 'more', text: '+' + (chips.length - max + 1) + ' more' }));
      grid.appendChild(cell);
    })(addDays(wsD, i));
    var whrs = sum(wc, function (c) { return c.hours; }), wwag = sum(wc, function (c) { return c.wages; }), wev = sum(wc, function (c) { return c.events.length; }), wg = sum(wc, function (c) { return c.guests; }), wcv = sum(wc, function (c) { return c.covers || 0; }), sched = wc.some(function (c) { return c.shifts; });
    grid.appendChild(h('div', { cls: 'cwk', on: { click: (function (ws) { return function () { S.calDate = ws; go('calendar', 'week'); }; })(iso(wsD)) }, title: 'Open this week' }, [
      h('b', { text: 'Wk ' + dshort(iso(wsD)) }),
      sched && isMgr() ? h('span', { text: Math.round(whrs) + ' hrs' }) : h('span', { cls: 'fa', text: sched ? '' : 'no schedule' }),
      sched && role() === 'owner' ? h('span', { text: '≈' + k$(wwag) }) : null,
      wev ? h('span', { text: plural(wev, 'event') }) : null, wg ? h('span', { text: wg + ' guests' }) : null,
      calOn('covers') && wcv ? h('span', { text: wcv + ' cvrs' }) : null]));
  }
  el.appendChild(h('div', { cls: 'card', style: 'padding:0;overflow:hidden' }, grid));
  el.appendChild(calLegend());
  // the next two weeks as a dense list under the grid
  var next = []; for (var k = 0; k < 14; k++) next.push(iso(addDays(new Date(), k)));
  el.appendChild(h('h2', { cls: 'section-title', text: 'Next two weeks at a glance' }));
  el.appendChild(agendaTable(next, true));
};
function calLegend() {
  var L = Object.keys(CAL_T).map(function (k) { return h('span', null, [h('i', { style: 'background:' + CAL_T[k][1] }), CAL_T[k][0]]); });
  L.push(h('span', null, [h('i', { style: 'background:' + OFF_C }), 'Time off (dashed = requested)']));
  if (isMgr()) L.push(h('span', null, [h('i', { style: 'background:#fff;border:1.5px dashed var(--c2)' }), 'Catering inquiry, not booked']));
  L.push(h('span', null, [h('i', { cls: 'sb3' }), 'Staff: floor · bar · kitchen']));
  L.push(h('span', null, [h('i', { style: 'background:var(--red)' }), '! = something to check']));
  return h('div', { cls: 'legend', style: 'margin-top:10px' }, L);
}
/* ---------- WEEK: a timeline, events on the left of each day, staff coverage on the right ---------- */
PAGES['calendar/week'] = function (el) {
  calHead(el, 'week');
  var a = pday(calAnchor()), s0 = addDays(a, -a.getDay()), t = iso(), days = [];
  for (var i = 0; i < 7; i++) days.push(iso(addDays(s0, i)));
  calStats(el, days);
  var cs = days.map(calDay), PX = 40, H = (TL1 - TL0) * PX;
  var wrap = h('div', { cls: 'cweek' });
  wrap.appendChild(h('div', { cls: 'cwh gut' }));
  cs.forEach(function (c) {
    wrap.appendChild(h('div', { cls: 'cwh' + (c.ds === t ? ' today' : '') + (!c.open ? ' shut' : ''), on: { click: function () { dayDrawer(c.ds); } } }, [
      h('div', { cls: 'cwd' }, [h('b', { text: c.d.toLocaleDateString(undefined, { weekday: 'short' }) }), h('span', { text: String(c.d.getDate()) }), c.warn.length ? h('span', { cls: 'wdot ' + worst(c.warn), title: c.warn.map(function (x) { return x[1]; }).join('\n'), text: '!' }) : null]),
      h('div', { cls: 'cwm' }, [c.open ? 'Open 5–9' : (c.closedEv[0] ? c.closedEv[0].title : 'Closed'), calOn('holidays') && c.holiday ? ' · ' + c.holiday : '']),
      h('div', { cls: 'cwm' }, [calOn('covers') && c.covers != null ? c.covers + ' covers' : c.guests ? c.guests + ' guests booked' : '', calOn('staff') && c.shifts && c.shifts.length ? (c.covers != null || c.guests ? ' · ' : '') + c.shifts.length + ' on · ' + Math.round(c.hours) + 'h' : '']),
      calOn('staff') && c.shifts && c.shifts.length ? staffBar(c.shifts) : null
    ]));
  });
  // all-day row: time off, inquiries, to-dos, all-day events
  wrap.appendChild(h('div', { cls: 'cwa gut', text: 'All day' }));
  cs.forEach(function (c) { var tmp = Object.assign({}, c, { events: c.events.filter(function (e) { return e.all_day || !e.start; }), meetings: c.meetings.filter(function (e) { return !e.start; }) }); wrap.appendChild(h('div', { cls: 'cwa' + (!c.open ? ' shut' : '') }, calChips(tmp))); });
  // timeline
  var gut = h('div', { cls: 'cwt gut', style: 'height:' + H + 'px' }); for (var hh = TL0; hh < TL1; hh++) gut.appendChild(h('span', { style: 'top:' + (hh - TL0) * PX + 'px', text: t12(hh + ':00') }));
  wrap.appendChild(gut);
  cs.forEach(function (c) {
    var col = h('div', { cls: 'cwt' + (!c.open ? ' shut' : '') + (c.ds === t ? ' today' : ''), style: 'height:' + H + 'px', on: { click: function (e) { if (e.target === col) dayDrawer(c.ds); } } });
    if (c.open) col.appendChild(h('div', { cls: 'svc', style: 'top:' + (17 - TL0) * PX + 'px;height:' + 4 * PX + 'px', title: 'Service 5–9 pm' }));
    var timed = [].concat(calOn('events') ? c.events : [], calOn('meetings') ? c.meetings : []).filter(function (e) { return !e.all_day && e.start; });
    timed.forEach(function (e, j) {
      var st = mins(e.start) / 60, en = e.end ? mins(e.end) / 60 : st + (e.type === 'meeting' ? 1 : 3), overlap = timed.filter(function (o) { return o !== e && mins(o.start) / 60 < en && (o.end ? mins(o.end) / 60 : mins(o.start) / 60 + 2) > st; }).length;
      col.appendChild(h('button', { cls: 'cwe', style: '--c:' + ctype(e.type)[1] + ';top:' + Math.max(0, (st - TL0) * PX) + 'px;height:' + Math.max(22, (Math.min(en, TL1) - Math.max(st, TL0)) * PX - 2) + 'px;' + (overlap ? 'width:28%;left:' + (j % 2 ? '30%' : '1%') : ''), title: e.title, on: { click: function (ev) { ev.stopPropagation(); openEvent(e); } } }, [h('b', { text: evTime(e) }), h('span', { text: e.title }), e.guests ? h('em', { text: e.guests + ' guests' }) : null]));
    });
    if (calOn('staff') && c.shifts && c.shifts.length) {
      var lane = h('div', { cls: 'lanes' }); col.appendChild(lane);
      var nL = c.shifts.length; c.shifts.forEach(function (s, j) { var st = mins(s.start) / 60, en = endMins(s) / 60; lane.appendChild(h('i', { style: 'left:' + (j * 100 / nL) + '%;width:calc(' + (100 / nL) + '% - 2px);top:' + (st - TL0) * PX + 'px;height:' + (en - st) * PX + 'px;background:' + KIND[roleKind(s.role)][1], title: empName(s.emp) + ' · ' + s.role + ' · ' + t12(s.start) + '–' + t12(s.end) })); });
    }
    if (c.ds === t) { var now = new Date(), nh = now.getHours() + now.getMinutes() / 60; if (nh >= TL0 && nh <= TL1) col.appendChild(h('div', { cls: 'nowline', style: 'top:' + (nh - TL0) * PX + 'px' })); }
    wrap.appendChild(col);
  });
  el.appendChild(h('div', { cls: 'card', style: 'padding:0' }, h('div', { cls: 'scrollx' }, wrap)));
  el.appendChild(h('p', { cls: 'fine', style: 'margin-top:8px', text: 'Events and meetings sit on the left of each day; the thin bars on the right are each person’s shift, so you can see how many people are in the building at any hour. The shaded band is service, 5–9 pm. Tap a day for everything about it.' }));
  el.appendChild(h('h2', { cls: 'section-title', text: 'Who’s working this week' }));
  el.appendChild(weekRoster(cs));
};
function weekRoster(cs) {
  var emps = (S.data.employees || []).filter(function (e) { return e.active !== false && !e.removed_at; }), t = iso();
  var tbl = h('table', { cls: 'sched roster' }, [h('thead', null, h('tr', null, [h('th', { cls: 'who', text: 'Team' })].concat(cs.map(function (c) { return h('th', { cls: (c.ds === t ? 'today ' : '') + (!c.open ? 'closedday' : ''), text: c.d.toLocaleDateString(undefined, { weekday: 'short' }) + ' ' + c.d.getDate() }); })).concat([h('th', { cls: 'r', text: 'Hours' })])))]);
  var tb = h('tbody'); tbl.appendChild(tb);
  emps.forEach(function (e) {
    var tot = 0;
    tb.appendChild(h('tr', null, [h('th', { cls: 'who' }, [h('b', { text: e.name }), h('small', { text: e.position || '' })])].concat(cs.map(function (c) {
      var off = c.off.filter(function (x) { return x.emp === e.id; })[0], sh = (c.shifts || []).filter(function (s) { return s.emp === e.id; });
      sh.forEach(function (s) { tot += shiftHours(s); });
      return h('td', { cls: 'rc' + (off ? ' off' : '') + (!c.open ? ' closedday' : '') }, [off ? h('span', { cls: 'offtag', text: 'Off' + (off.status === 'pending' ? '?' : '') }) : null].concat(sh.map(function (s) { return h('span', { cls: 'sh ' + roleKind(s.role) + ' mini' }, [h('b', { text: t12(s.start) + '–' + t12(s.end) }), h('span', { text: s.role })]); })));
    })).concat([h('td', { cls: 'r num tot' + (tot > 40 ? ' over' : ''), text: tot ? Math.round(tot * 10) / 10 : '' })])));
  });
  return h('div', { cls: 'card', style: 'padding:0' }, [h('div', { cls: 'scrollx' }, tbl), isMgr() ? h('div', { style: 'padding:10px 14px;border-top:1px solid var(--line2)' }, h('button', { cls: 'btn small', text: 'Edit this week’s schedule →', on: { click: function () { S.schedWeek = cs[0].ws; go('team', 'schedule'); } } })) : null]);
}
/* ---------- COMING UP: every day that has something, with all of it on one line ---------- */
PAGES['calendar/agenda'] = function (el) {
  calHead(el, 'agenda');
  var days = []; for (var i = 0; i < 56; i++) days.push(iso(addDays(new Date(), i)));
  calStats(el, days);
  el.appendChild(agendaTable(days, false));
};
function agendaTable(days, dense) {
  var t = iso(), rows = [];
  days.forEach(function (ds) {
    var c = calDay(ds), chips = calChips(c);
    var busy = chips.length || c.holiday || c.closedEv.length || c.warn.length;
    if (!busy && !(dense && c.open)) return;
    var who = [];
    if (calOn('staff') && c.shifts && c.shifts.length) ['f', 'b', 'k'].forEach(function (k) { var ss = c.shifts.filter(function (s) { return roleKind(s.role) === k; }); if (ss.length) who.push(h('div', { cls: 'whoK' }, [h('i', { style: 'background:' + KIND[k][1] }), h('b', { text: KIND[k][0] + ' ' }), ss.map(function (s) { return empName(s.emp).split(' ')[0] + ' ' + t12(s.start); }).join(' · ')])); });
    else if (calOn('staff') && c.open) who.push(h('span', { cls: 'fine', text: c.shifts ? 'No one scheduled' : 'Schedule not made yet' }));
    var evs = [].concat(calOn('events') ? c.events : [], calOn('meetings') ? c.meetings : []).map(function (e) { return h('button', { cls: 'arow', style: '--c:' + ctype(e.type)[1], on: { click: function () { openEvent(e); } } }, [h('b', { text: evTime(e) }), h('span', { text: e.title }), h('em', { text: [ctype(e.type)[0], e.guests ? e.guests + ' guests' : '', e.room || ''].filter(Boolean).join(' · ') }), e.notes && !dense ? h('small', { text: e.notes }) : null]); });
    var other = chips.filter(function (ch) { return /\b(off|tent|task)\b/.test(ch.className); });
    rows.push(h('div', { cls: 'aday' + (ds === t ? ' today' : '') + (!c.open ? ' shut' : ''), on: { click: function (e) { if (e.target.closest('button')) return; dayDrawer(ds); } } }, [
      h('div', { cls: 'adate' }, [h('b', { text: c.d.toLocaleDateString(undefined, { weekday: 'short' }) }), h('span', { text: c.d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) }), c.warn.length ? h('span', { cls: 'wdot ' + worst(c.warn), title: c.warn.map(function (x) { return x[1]; }).join('\n'), text: '!' }) : null]),
      h('div', { cls: 'acol' }, [!c.open ? h('div', { cls: 'shuttag', text: c.closedEv[0] ? c.closedEv[0].title : 'Closed' }) : null, calOn('holidays') && c.holiday ? h('div', { cls: 'hol', text: c.holiday }) : null].concat(evs.length ? evs : (c.open ? [h('span', { cls: 'fine', text: 'Regular service' })] : []))),
      h('div', { cls: 'acol' }, who),
      h('div', { cls: 'acol chipsCol' }, other.concat(c.warn.map(function (w) { return h('div', { cls: 'awarn ' + w[0], text: w[1] }); })))
    ]));
  });
  if (!rows.length) return h('p', { cls: 'empty', text: 'Nothing on the calendar.' });
  return h('div', { cls: 'card agenda', style: 'padding:0' }, [h('div', { cls: 'aday ahead' }, [h('span', { text: 'Day' }), h('span', { text: 'Events & meetings' }), h('span', { text: 'Who’s working' }), h('span', { text: 'Off, inquiries, to-dos' })])].concat(rows));
}
/* ---------- one day, everything about it ---------- */
function dayDrawer(ds) {
  var scrim = h('div', { cls: 'scrim' }), d = h('aside', { cls: 'drawer', role: 'dialog', 'aria-label': dlong(ds) }), body = h('div', { cls: 'drawer-b' }), head = h('div', { cls: 'drawer-h' });
  function close() { d.classList.remove('on'); scrim.classList.remove('on'); setTimeout(function () { d.remove(); scrim.remove(); }, 250); document.removeEventListener('keydown', esc); }
  function esc(e) { if (e.key === 'Escape' && !document.querySelector('.modal')) close(); }
  function paint() {
    var c = calDay(ds), x = c.d; head.innerHTML = ''; body.innerHTML = '';
    head.appendChild(h('button', { cls: 'x', text: '✕', 'aria-label': 'Close', on: { click: close } }));
    head.appendChild(h('div', { cls: 'fine', text: [x.toLocaleDateString(undefined, { year: 'numeric' }), c.holiday].filter(Boolean).join(' · ') }));
    head.appendChild(h('h2', { text: x.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) }));
    head.appendChild(h('div', { cls: 'chips', style: 'margin-top:8px' }, [h('span', { cls: 'chip ' + (c.open ? 'green' : 'red'), text: c.open ? 'Open 5–9 pm' : c.closedEv[0] ? c.closedEv[0].title : 'Closed' }), c.status ? h('span', { cls: 'chip ' + (c.status === 'published' ? '' : 'gold'), text: c.status === 'published' ? 'Schedule published' : 'Schedule is a draft' }) : null]));
    var st = [];
    if (c.covers != null) st.push(['Covers', String(c.covers)]);
    if (c.guests) st.push(['Event guests', String(c.guests)]);
    if (c.shifts) st.push(['Working', String(c.shifts.length)], ['Hours', String(Math.round(c.hours * 10) / 10)]);
    if (c.shifts && role() === 'owner') st.push(['Est. wages', money(c.wages, 0)]);
    if (st.length) body.appendChild(h('div', { cls: 'dstats' }, st.map(function (s) { return h('div', null, [h('span', { text: s[0] }), h('b', { text: s[1] })]); })));
    c.warn.forEach(function (w) { body.appendChild(h('div', { cls: 'awarn ' + w[0], text: w[1] })); });
    var evs = c.events.concat(c.meetings, c.closedEv);
    body.appendChild(h('h3', { cls: 'dh', text: 'Events & meetings' }));
    if (!evs.length) body.appendChild(h('p', { cls: 'fine', text: c.open ? 'Regular service — nothing else booked.' : 'Nothing booked.' }));
    evs.forEach(function (e) { body.appendChild(h('button', { cls: 'devent', style: '--c:' + ctype(e.type)[1], on: { click: function () { openEvent(e, null, paint); } } }, [h('div', { cls: 'dt' }, [h('i'), ctype(e.type)[0]]), h('b', { text: e.title }), h('span', { text: [evTime(e), e.guests ? e.guests + ' guests' : '', e.room].filter(Boolean).join(' · ') }), e.notes ? h('p', { text: e.notes }) : null])); });
    body.appendChild(h('button', { cls: 'btn small', style: 'margin-top:6px', text: '+ Add an event on this day', on: { click: function () { openEvent(null, ds, paint); } } }));
    if (c.shifts && c.shifts.length || evs.some(function (e) { return e.start && !e.all_day; })) { body.appendChild(h('h3', { cls: 'dh', text: 'The day, hour by hour' })); body.appendChild(dayTimeline(c)); }
    else if (c.open) body.appendChild(h('p', { cls: 'fine', style: 'margin-top:14px', text: c.shifts ? 'No one is scheduled.' : 'The schedule for this week isn’t made yet.' }));
    if (c.off.length) { body.appendChild(h('h3', { cls: 'dh', text: 'Time off' })); c.off.forEach(function (o) { body.appendChild(h('div', { cls: 'drow' }, [h('b', { text: empName(o.emp) }), h('span', { text: dshort(o.start_date) + (o.end_date !== o.start_date ? '–' + dshort(o.end_date) : '') + (o.reason ? ' · ' + o.reason : '') }), h('span', { cls: 'chip ' + (o.status === 'pending' ? 'gold' : 'green'), text: o.status === 'pending' ? 'Requested' : 'Approved' })])); }); }
    if (c.inq.length) { body.appendChild(h('h3', { cls: 'dh', text: 'Catering inquiries for this date' })); c.inq.forEach(function (q) { body.appendChild(h('div', { cls: 'drow' }, [h('b', { text: q.event_name || q.name }), h('span', { text: [q.name, q.guests ? q.guests + ' guests' : ''].filter(Boolean).join(' · ') }), h('span', { cls: 'chip blue', text: q.status || 'new' })])); }); }
    if (c.todos.length || c.reviews.length) { body.appendChild(h('h3', { cls: 'dh', text: 'Due' })); c.todos.forEach(function (q) { body.appendChild(h('div', { cls: 'drow' }, [h('b', { text: q.title }), h('span', { text: 'To-do' })])); }); c.reviews.forEach(function (q) { body.appendChild(h('div', { cls: 'drow' }, [h('b', { text: 'Review · ' + empName(q.emp) }), h('span', { text: q.position || '' })])); }); }
    if (c.preshift.length) { body.appendChild(h('h3', { cls: 'dh', text: 'Pre-shift note' })); c.preshift.forEach(function (p) { body.appendChild(h('p', { cls: 'pnote', text: p.body + (p.author ? ' — ' + p.author : '') })); }); }
    if (isMgr()) body.appendChild(h('div', { cls: 'chips', style: 'margin-top:18px' }, [h('button', { cls: 'btn small', text: 'Edit the schedule for this week →', on: { click: function () { S.schedWeek = c.ws; close(); go('team', 'schedule'); } } })]));
  }
  d.appendChild(head); d.appendChild(body); scrim.addEventListener('click', close); document.addEventListener('keydown', esc);
  document.body.appendChild(scrim); document.body.appendChild(d); paint(); d._paint = paint;
  requestAnimationFrame(function () { scrim.classList.add('on'); d.classList.add('on'); });
}
function dayTimeline(c) {
  var span = TL1 - TL0, pos = function (hh) { return Math.max(0, Math.min(100, (hh - TL0) / span * 100)); };
  var box = h('div', { cls: 'dtl' });
  var ticks = h('div', { cls: 'dtr ticks' }, [h('span'), h('div', { cls: 'trk' }, [12, 15, 17, 19, 21].map(function (hh) { return h('span', { style: 'left:' + pos(hh) + '%', text: t12(hh + ':00') }); }))]);
  box.appendChild(ticks);
  var svc = function () { return c.open ? h('i', { cls: 'svcb', style: 'left:' + pos(17) + '%;width:' + (pos(21) - pos(17)) + '%' }) : null; };
  c.events.concat(c.meetings).filter(function (e) { return e.start && !e.all_day; }).forEach(function (e) {
    var st = mins(e.start) / 60, en = e.end ? mins(e.end) / 60 : st + (e.type === 'meeting' ? 1 : 3);
    box.appendChild(h('div', { cls: 'dtr' }, [h('span', { cls: 'lb', text: e.title }), h('div', { cls: 'trk' }, [svc(), h('i', { cls: 'bar ev', style: 'left:' + pos(st) + '%;width:' + (pos(en) - pos(st)) + '%;background:' + ctype(e.type)[1], title: evTime(e) })])]));
  });
  (c.shifts || []).forEach(function (s) {
    var st = mins(s.start) / 60, en = endMins(s) / 60;
    box.appendChild(h('div', { cls: 'dtr' }, [h('span', { cls: 'lb' }, [h('b', { text: empName(s.emp).split(' ')[0] }), ' ' + s.role]), h('div', { cls: 'trk' }, [svc(), h('i', { cls: 'bar', style: 'left:' + pos(st) + '%;width:' + (pos(en) - pos(st)) + '%;background:' + KIND[roleKind(s.role)][1], title: t12(s.start) + '–' + t12(s.end) }, h('span', { text: t12(s.start) + '–' + t12(s.end) }))])]));
  });
  // people in the building, hour by hour
  if (c.shifts && c.shifts.length) {
    var cnt = []; for (var hh = TL0; hh < TL1; hh++) cnt.push(c.shifts.filter(function (s) { var st = mins(s.start) / 60, en = endMins(s) / 60; return st <= hh + 0.5 && en > hh + 0.5; }).length);
    var mx = Math.max.apply(null, cnt.concat([1]));
    box.appendChild(h('div', { cls: 'dtr' }, [h('span', { cls: 'lb', text: 'In the building' }), h('div', { cls: 'trk hist' }, cnt.map(function (n, i) { return h('i', { style: 'left:' + pos(TL0 + i) + '%;width:' + (100 / span - .6) + '%;height:' + (n / mx * 100) + '%', title: t12((TL0 + i) + ':00') + ': ' + n + ' people' }, n ? h('span', { text: n }) : null); }))]));
  }
  return box;
}
/* ---------- add / edit an event ---------- */
function openEvent(e, onDate, after) {
  var isNew = !e; e = e || { id: uid(), title: '', type: 'private', date: onDate || iso(), all_day: false, start: '18:00', end: '', room: '', guests: null, notes: '' };
  var f = { title: inp(e.title, { placeholder: 'e.g. Miller rehearsal dinner' }), type: sel(Object.keys(CAL_T).map(function (k) { return [k, CAL_T[k][0]]; }), e.type || 'private'), date: inp(e.date, { type: 'date' }), all: h('input', { type: 'checkbox' }), start: inp(e.start || '18:00', { type: 'time' }), end: inp(e.end || '', { type: 'time' }), room: inp(e.room || '', { list: 'roomList', placeholder: 'e.g. Private dining room' }), guests: inp(e.guests != null ? e.guests : '', { inputmode: 'numeric', placeholder: 'e.g. 24' }), notes: h('textarea', { rows: '3', placeholder: 'Menu, setup, deposit, contact… (the whole team can read this)' }) };
  f.all.checked = !!e.all_day; f.notes.value = e.notes || '';
  var times = h('div', { cls: 'g2f' }, [fld('Starts', f.start), fld('Ends (optional)', f.end)]);
  function sync() { times.hidden = f.all.checked; } f.all.addEventListener('change', sync); sync();
  f.type.addEventListener('change', function () { if (f.type.value === 'closed') { f.all.checked = true; sync(); } if (f.type.value === 'meeting' && f.start.value === '18:00') f.start.value = '14:00'; });
  var msg = h('p', { cls: 'msg' }), clash = h('div');
  function showClash() { clash.innerHTML = ''; if (!f.date.value) return; var c = calDay(f.date.value), lines = []; if (!c.open && f.type.value !== 'closed') lines.push(c.closedEv[0] ? 'That day is marked “' + c.closedEv[0].title + '”.' : 'Eden is normally closed that day.'); c.events.concat(c.meetings).forEach(function (o) { if (o !== e) lines.push('Also that day: ' + o.title + ' (' + evTime(o) + ')'); }); c.off.forEach(function (o) { lines.push(empName(o.emp) + ' is off'); }); if (c.holiday) lines.push(c.holiday); if (lines.length) clash.appendChild(h('div', { cls: 'costline', style: 'display:block' }, lines.map(function (l) { return h('div', { text: l }); }))); }
  f.date.addEventListener('change', showClash); showClash();
  var form = h('div', { cls: 'form' }, [fld('Event', f.title), h('div', { cls: 'g2f' }, [fld('Type', f.type), fld('Date', f.date)]), clash, h('label', { cls: 'check' }, [f.all, ' All day']), times, h('div', { cls: 'g2f' }, [fld('Room', f.room), fld('Guests', f.guests)]), h('datalist', { id: 'roomList' }, ['Restaurant', '3rd Floor', 'Palladian', 'Bar', 'Off-site'].map(function (r) { return h('option', { value: r }); })), fld('Notes', f.notes), msg]);
  function save() {
    if (!f.title.value.trim()) { msg.textContent = 'Give it a name.'; f.title.focus(); return; }
    if (!f.date.value) { msg.textContent = 'Pick a date.'; return; }
    var g = numv(f.guests); if (g !== null && (isNaN(g) || g < 0)) { msg.textContent = 'Guests must be a number.'; return; }
    if (!f.all.checked && f.end.value && mins(f.end.value) <= mins(f.start.value)) { msg.textContent = 'It ends before it starts.'; return; }
    e.title = f.title.value.trim(); e.type = f.type.value; e.date = f.date.value; e.all_day = f.all.checked; e.start = f.all.checked ? null : f.start.value; e.end = f.all.checked ? null : f.end.value || null; e.room = f.room.value.trim(); e.guests = g; e.notes = f.notes.value.trim();
    if (isNew) { S.data.events = S.data.events || []; S.data.events.push(e); }
    m.close(); changed(isNew ? 'Added ' + e.title : 'Saved ' + e.title); render(); if (after) after();
  }
  var m = modal(isNew ? 'Add to the calendar' : 'Edit event', form, [isNew ? null : h('button', { cls: 'btn danger', text: 'Delete', on: { click: function () { S.data.events.splice(S.data.events.indexOf(e), 1); m.close(); changed('Deleted ' + e.title); render(); if (after) after(); } } }), h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn accent', text: isNew ? 'Add' : 'Save', on: { click: save } })]);
}
/* =====================================================================================
   CATERING & BEOs — its own place: inquiry → questionnaire → BEO → done
   (same steps as the live site's Inquiries page)
   ===================================================================================== */
var CSTEP = [['new', 'New inquiry', 'Reply or send the questionnaire'], ['link_sent', 'Questionnaire sent', 'Waiting on the client'], ['received', 'Questionnaire back', 'Price it and turn it into a BEO'], ['beo', 'Active BEO', 'Booked — on the calendar']];
var CDONE = { completed: 'Completed', declined: 'Declined or lost', spam: 'Spam' };
var ROOMS = ['Restaurant', '3rd Floor', 'Palladian', 'Other'];
function cname(x) { return x.event_name || x.organization || x.name || 'Inquiry'; }
function daysTo(ds) { return Math.round((pday(ds) - pday(iso())) / 864e5); }
function ago(ts) { var d = Math.floor((Date.now() - new Date(ts)) / 864e5); return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d + ' days ago'; }
function cstatus(x) { return x.status || 'new'; }
function moveInq(x, st, msg) { x.status = st; x.updated_at = new Date().toISOString(); if (st === 'beo' && x.event_date && !(S.data.events || []).some(function (e) { return e.beo_id === x.id; })) { S.data.events = S.data.events || []; S.data.events.push({ id: uid(), beo_id: x.id, source: 'beo', title: cname(x), type: /3rd|palladian|restaurant/i.test(x.location || 'Restaurant') ? 'private' : 'catering', date: x.event_date, start: x.start_time || '', end: x.end_time || '', guests: x.guests, room: x.location || '', notes: 'Active BEO for ' + [x.name, x.email, x.phone].filter(Boolean).join(' · ') }); } changed(msg || 'Moved to ' + (CSTEP.filter(function (s) { return s[0] === st; })[0] || [0, CDONE[st]])[1]); render(); }
function cardInq(x, compact) {
  var st = cstatus(x), i = CSTEP.map(function (s) { return s[0]; }).indexOf(st), next = CSTEP[i + 1];
  var when = x.event_date ? dlong(x.event_date) + (daysTo(x.event_date) > 0 ? ' · in ' + plural(daysTo(x.event_date), 'day') : daysTo(x.event_date) === 0 ? ' · today' : '') : 'No date yet';
  var c = x.event_date ? calDay(x.event_date) : null, clash = c ? c.events.filter(function (e) { return e.beo_id !== x.id; }) : [];
  return h('div', { cls: 'icard', on: { click: function () { openInq(x); } } }, [
    h('div', { cls: 'ic-top' }, [h('b', { text: cname(x) }), x.guests ? h('span', { cls: 'num', text: x.guests + ' guests' }) : null]),
    h('div', { cls: 'ic-m', text: [x.event_type, x.location].filter(Boolean).join(' · ') || ' ' }),
    h('div', { cls: 'ic-m strong', text: when + (x.start_time ? ' · ' + t12(x.start_time) : '') }),
    h('div', { cls: 'ic-m', text: (x.name || '') + (x.created_at ? ' · came in ' + ago(x.created_at) : '') }),
    clash.length ? h('div', { cls: 'awarn gold', text: 'Same day: ' + clash.map(function (e) { return e.title; }).join(', ') }) : null,
    c && !c.open && st !== 'beo' ? h('div', { cls: 'awarn gold', text: 'Eden is normally closed that day' }) : null,
    !compact && next ? h('button', { cls: 'btn small', style: 'margin-top:8px', text: '→ ' + next[1], on: { click: function (e) { e.stopPropagation(); moveInq(x, next[0]); } } }) : null
  ]);
}
PAGES['catering/pipeline'] = function (el) {
  var cs = S.data.catering; if (!cs) return missing(el, 'catering inquiries');
  var live = cs.filter(function (x) { return ['completed', 'declined', 'spam'].indexOf(cstatus(x)) === -1; });
  var month = iso().slice(0, 7), thisM = cs.filter(function (x) { return String(x.created_at || '').slice(0, 7) === month && cstatus(x) !== 'spam'; });
  var decided = cs.filter(function (x) { return ['beo', 'completed', 'declined'].indexOf(cstatus(x)) !== -1; }), won = decided.filter(function (x) { return cstatus(x) !== 'declined'; });
  var booked = cs.filter(function (x) { return cstatus(x) === 'beo' && x.event_date && daysTo(x.event_date) >= 0; });
  var g = h('div', { cls: 'cstats' }); el.appendChild(g);
  [['New this month', String(thisM.length), 'inquiries'], ['Need a reply', String(cs.filter(function (x) { return cstatus(x) === 'new'; }).length), 'new, not answered'], ['Waiting on clients', String(cs.filter(function (x) { return cstatus(x) === 'link_sent'; }).length), 'questionnaire out'], ['Active BEOs', String(booked.length), sum(booked, function (x) { return +x.guests || 0; }) + ' guests booked'], ['Booked rate', decided.length ? pct(won.length / decided.length, 0) : '—', decided.length ? won.length + ' of ' + decided.length + ' decided' : 'none decided yet']]
    .forEach(function (t) { g.appendChild(h('div', { cls: 'cst' }, [h('span', { text: t[0] }), h('b', { text: t[1] }), h('small', { text: t[2] })])); });
  var board = h('div', { cls: 'board' }); el.appendChild(board);
  CSTEP.forEach(function (s) {
    var list = live.filter(function (x) { return cstatus(x) === s[0]; }).sort(function (a, b) { return String(a.event_date || '9') < String(b.event_date || '9') ? -1 : 1; });
    board.appendChild(h('div', { cls: 'bcol' }, [h('div', { cls: 'bhead' }, [h('b', { text: s[1] }), h('span', { cls: 'chip', text: String(list.length) })]), h('p', { cls: 'fine', style: 'margin:0 0 8px', text: s[2] })].concat(list.length ? list.map(function (x) { return cardInq(x); }) : [h('p', { cls: 'empty', text: 'Nothing here.' })])));
  });
  el.appendChild(h('p', { cls: 'fine', style: 'margin-top:12px', text: 'Left to right as an inquiry moves along. When one becomes an Active BEO it goes on the calendar automatically, with its date, time, room and guest count. Inquiries that aren’t booked yet show on the calendar as dashed outlines, so you see date clashes before you say yes.' }));
};
PAGES['catering/beos'] = function (el) {
  var cs = S.data.catering; if (!cs) return missing(el, 'catering inquiries');
  var list = cs.filter(function (x) { return cstatus(x) === 'beo'; }).sort(function (a, b) { return String(a.event_date || '9') < String(b.event_date || '9') ? -1 : 1; });
  if (!list.length) return el.appendChild(h('p', { cls: 'empty', text: 'No active BEOs.' }));
  el.appendChild(h('div', { cls: 'grid g2' }, list.map(function (x) {
    var c = x.event_date ? calDay(x.event_date) : null, n = x.event_date ? daysTo(x.event_date) : null;
    var staff = c && c.shifts ? ['f', 'b', 'k'].map(function (k) { var ss = c.shifts.filter(function (s) { return roleKind(s.role) === k; }); return ss.length ? KIND[k][0] + ' ' + ss.length : null; }).filter(Boolean).join(' · ') : null;
    return h('div', { cls: 'card beo', on: { click: function () { openInq(x); } } }, [
      h('div', { cls: 'beo-h' }, [h('div', { cls: 'beo-date' }, x.event_date ? [h('b', { text: pday(x.event_date).getDate() }), h('span', { text: pday(x.event_date).toLocaleDateString(undefined, { month: 'short' }) })] : [h('span', { text: 'TBD' })]), h('div', null, [h('h2', { text: cname(x) }), h('p', { cls: 'sub', style: 'margin:2px 0 0', text: [x.event_type, x.location].filter(Boolean).join(' · ') })]), n != null ? h('span', { cls: 'chip ' + (n <= 7 ? 'gold' : ''), text: n === 0 ? 'Today' : n > 0 ? 'in ' + plural(n, 'day') : plural(-n, 'day') + ' ago' }) : null]),
      h('dl', { cls: 'facts', style: 'margin-top:12px' }, [['When', x.event_date ? dlong(x.event_date) + (x.start_time ? ' · ' + t12(x.start_time) + (x.end_time ? '–' + t12(x.end_time) : '') : '') : 'No date yet'], ['Guests', x.guests ? String(x.guests) : '—'], ['Contact', [x.name, x.phone, x.email].filter(Boolean).join(' · ') || '—'], ['Staff that day', staff || (c && c.shifts ? 'No one scheduled' : 'Schedule not made yet')], ['Notes', x.notes || '—']].reduce(function (a, r) { return a.concat([h('dt', { text: r[0] }), h('dd', { text: r[1] })]); }, [])),
      c && c.warn.length ? h('div', null, c.warn.map(function (w) { return h('div', { cls: 'awarn ' + w[0], text: w[1] }); })) : null,
      h('div', { cls: 'chips', style: 'margin-top:12px' }, [h('button', { cls: 'btn small', text: 'Open the day', on: { click: function (e) { e.stopPropagation(); if (x.event_date) dayDrawer(x.event_date); } } }), h('button', { cls: 'btn small', text: 'Mark completed', on: { click: function (e) { e.stopPropagation(); moveInq(x, 'completed'); } } })])
    ]);
  })));
};
PAGES['catering/past'] = function (el) {
  var cs = S.data.catering; if (!cs) return missing(el, 'catering inquiries');
  var list = cs.filter(function (x) { return CDONE[cstatus(x)]; }).sort(function (a, b) { return String(a.event_date || a.created_at) < String(b.event_date || b.created_at) ? 1 : -1; });
  el.appendChild(h('div', { cls: 'card' }, list.length ? h('div', { cls: 'list' }, list.map(function (x) { return h('div', { cls: 'row click', on: { click: function () { openInq(x); } } }, [h('div', { cls: 'main-t' }, [h('b', { text: cname(x) }), h('span', { text: [x.event_date ? dlong(x.event_date) : '', x.guests ? x.guests + ' guests' : '', x.name].filter(Boolean).join(' · ') })]), h('span', { cls: 'chip ' + (cstatus(x) === 'completed' ? 'green' : ''), text: CDONE[cstatus(x)] })]); })) : h('p', { cls: 'empty', text: 'Nothing completed or declined yet.' })));
};
function openInq(x) {
  var isNew = !x; x = x || { id: uid(), status: 'new', created_at: new Date().toISOString() };
  var f = { ev: inp(x.event_name || '', { placeholder: 'e.g. Office holiday party' }), type: inp(x.event_type || '', { placeholder: 'e.g. Rehearsal dinner', list: 'evTypes' }), date: inp(x.event_date || '', { type: 'date' }), start: inp(x.start_time || '', { type: 'time' }), end: inp(x.end_time || '', { type: 'time' }), room: sel([['', '—']].concat(ROOMS), x.location || ''), guests: inp(x.guests != null ? x.guests : '', { inputmode: 'numeric' }), name: inp(x.name || ''), org: inp(x.organization || ''), phone: inp(x.phone || '', { type: 'tel' }), email: inp(x.email || '', { type: 'email' }), notes: h('textarea', { rows: '3' }), status: sel(CSTEP.map(function (s) { return [s[0], s[1]]; }).concat(Object.keys(CDONE).map(function (k) { return [k, CDONE[k]]; })), cstatus(x)) };
  f.notes.value = x.notes || '';
  var msg = h('p', { cls: 'msg' }), dayInfo = h('div');
  function showDay() { dayInfo.innerHTML = ''; if (!f.date.value) return; var c = calDay(f.date.value), lines = []; if (!c.open) lines.push(c.closedEv[0] ? 'That day is marked “' + c.closedEv[0].title + '”.' : 'Eden is normally closed that day.'); c.events.concat(c.meetings).forEach(function (o) { if (o.beo_id !== x.id) lines.push('Already that day: ' + o.title + ' (' + evTime(o) + (o.guests ? ', ' + o.guests + ' guests' : '') + ')'); }); if (c.holiday) lines.push(c.holiday); if (c.shifts) lines.push(plural(c.shifts.length, 'person') + ' on the schedule'); if (lines.length) dayInfo.appendChild(h('div', { cls: 'costline', style: 'display:block' }, lines.map(function (l) { return h('div', { text: l }); }))); }
  f.date.addEventListener('change', showDay); showDay();
  var steps = h('div', { cls: 'steps' }, CSTEP.map(function (s, i) { var cur = CSTEP.map(function (z) { return z[0]; }).indexOf(cstatus(x)); return h('span', { cls: i < cur ? 'done' : i === cur ? 'on' : '' , text: s[1] }); }));
  var form = h('div', { cls: 'form' }, [isNew ? null : steps, fld('Event', f.ev), h('div', { cls: 'g2f' }, [fld('Type of event', f.type), fld('Status', f.status)]), h('div', { cls: 'g2f' }, [fld('Date', f.date), fld('Guests', f.guests)]), dayInfo, h('div', { cls: 'g2f' }, [fld('Starts', f.start), fld('Ends', f.end)]), fld('Room', f.room), h('div', { cls: 'g2f' }, [fld('Contact', f.name), fld('Company', f.org)]), h('div', { cls: 'g2f' }, [fld('Phone', f.phone), fld('Email', f.email)]), fld('Notes', f.notes), h('datalist', { id: 'evTypes' }, ['Rehearsal dinner', 'Holiday party', 'Birthday', 'Corporate dinner', 'Wedding', 'Shower', 'Off-site catering'].map(function (t) { return h('option', { value: t }); })), msg]);
  function save() {
    if (!f.ev.value.trim() && !f.name.value.trim()) { msg.textContent = 'Add the event or a contact name.'; return; }
    var g = numv(f.guests); if (g !== null && isNaN(g)) { msg.textContent = 'Guests must be a number.'; return; }
    var was = cstatus(x);
    Object.assign(x, { event_name: f.ev.value.trim(), event_type: f.type.value.trim(), event_date: f.date.value || null, start_time: f.start.value || null, end_time: f.end.value || null, location: f.room.value, guests: g, name: f.name.value.trim(), organization: f.org.value.trim(), phone: f.phone.value.trim(), email: f.email.value.trim(), notes: f.notes.value.trim() });
    if (isNew) { S.data.catering = S.data.catering || []; S.data.catering.unshift(x); }
    var ev = (S.data.events || []).filter(function (e) { return e.beo_id === x.id; })[0];
    if (ev) Object.assign(ev, { title: cname(x), date: x.event_date || ev.date, start: x.start_time || '', end: x.end_time || '', guests: x.guests, room: x.location });
    m.close();
    if (f.status.value !== was || (isNew && f.status.value === 'beo')) moveInq(x, f.status.value); else { changed(isNew ? 'Added ' + cname(x) : 'Saved ' + cname(x)); render(); }
  }
  var m = modal(isNew ? 'New inquiry' : cname(x), form, [h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn accent', text: isNew ? 'Add' : 'Save', on: { click: save } })]);
}
/* ---------- Kitchen and Bar are separate places; inventory pages follow the place you're in ---------- */
function scopeKinds() { return S.space === 'bar' ? ['bev'] : S.space === 'kitchen' ? ['food', 'paper'] : ['food', 'bev', 'paper']; }
function inScope(it) { return !!it && scopeKinds().indexOf(it.category) !== -1; }
function fixKind() { var k = scopeKinds(); if (k.indexOf(S.kind) === -1) { S.kind = k[0]; S.sub = 'all'; } }
function invInScope(v) { var m = byId(), cats = (v.lines || []).map(function (L) { return L && L.item_id && m[L.item_id] ? m[L.item_id].category : null; }).filter(Boolean); return !cats.length || cats.some(function (c) { return scopeKinds().indexOf(c) !== -1; }); }
['count', 'order', 'receive', 'items', 'reports', 'builds'].forEach(function (t) { PAGES['bar/' + t] = PAGES['kitchen/' + t]; });
function moreSheet() {
  var sps = spacesFor();
  var m = modal('All places', h('div', null, [h('div', { cls: 'moregrid' }, sps.map(function (s) { return h('button', { 'aria-current': s.id === S.space ? 'true' : 'false', on: { click: function () { m.close(); go(s.id); } } }, [svg(ICON[s.id]), h('b', { text: s.label }), h('small', { text: s.hint })]); })), h('button', { cls: 'btn wide', style: 'margin-top:14px', text: (S.myName || 'Account') + ' · password, sign out', on: { click: function () { m.close(); accountMenu(); } } })]));
}
/* =====================================================================================
   REPORTS — click any graph and get the full report behind it:
   the graph large, the key numbers, what changed, every row, and each week's breakdown.
   ===================================================================================== */
function isWeekX(spec) { return spec.xFmt === wkLabel && spec.x.every(function (x) { return /^\d{4}-\d{2}-\d{2}$/.test(String(x)); }); }
function xLabel(spec, i) { var x = spec.x[i]; return spec.tipTitle ? spec.tipTitle(x, i) : spec.xFmt ? spec.xFmt(x) : String(x); }
function seriesStats(s, spec) {
  var pts = s.values.map(function (v, i) { return [i, v]; }).filter(function (p) { return p[1] != null && isFinite(p[1]); });
  if (!pts.length) return null;
  var vals = pts.map(function (p) { return p[1]; }), avg = vals.reduce(function (a, b) { return a + b; }, 0) / vals.length;
  var hi = pts.reduce(function (a, p) { return p[1] > a[1] ? p : a; }), lo = pts.reduce(function (a, p) { return p[1] < a[1] ? p : a; });
  var last = pts[pts.length - 1], prev = pts[pts.length - 2], half = Math.floor(pts.length / 2);
  var a1 = half ? pts.slice(0, half).reduce(function (a, p) { return a + p[1]; }, 0) / half : null, a2 = half ? pts.slice(half).reduce(function (a, p) { return a + p[1]; }, 0) / (pts.length - half) : null;
  var jump = null; for (var k = 1; k < pts.length; k++) { var d = pts[k][1] - pts[k - 1][1]; if (!jump || Math.abs(d) > Math.abs(jump[1])) jump = [pts[k][0], d]; }
  return { avg: avg, total: vals.reduce(function (a, b) { return a + b; }, 0), hi: hi, lo: lo, last: last, prev: prev, a1: a1, a2: a2, jump: jump, n: pts.length };
}
function chg(a, b) { return a != null && b ? (a - b) / Math.abs(b) : null; }
function chgTxt(d) { return d == null || !isFinite(d) ? '' : (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + Math.abs(d * 100).toFixed(1) + '%'; }
function openReport(spec, meta) {
  meta = meta || {};
  var fy0 = spec.yFmt || k$, fy = fy0 === k$ ? function (v) { return money(v, Math.abs(v) < 100 ? 2 : 0); } : fy0, isPct = /%/.test(fy(0.5)), noTotal = isPct || meta.noTotal || /average|check|per |price|cost \/|\/ /i.test((meta.title || '') + ' ' + spec.series.map(function (s) { return s.name; }).join(' '));
  var weeks = isWeekX(spec), bars = spec.series.filter(function (s) { return s.kind !== 'line' && s.kind !== 'dash'; });
  var back = h('div', { cls: 'report', role: 'dialog', 'aria-label': meta.title || 'Report' }), inner = h('div', { cls: 'rep-in' }); back.appendChild(inner);
  function close() { back.remove(); document.removeEventListener('keydown', onKey); document.body.classList.remove('rep-open'); }
  function onKey(e) { if (e.key === 'Escape' && !document.querySelector('.modal')) close(); }
  document.addEventListener('keydown', onKey); document.body.classList.add('rep-open');
  // header
  var first = xLabel(spec, 0), lastL = xLabel(spec, spec.x.length - 1);
  inner.appendChild(h('div', { cls: 'rep-top' }, [h('button', { cls: 'btn small', text: '← Back', on: { click: close } }), h('span', { cls: 'sp' }), h('button', { cls: 'btn small', text: 'Download CSV', on: { click: csv } }), h('button', { cls: 'btn small', text: 'Print', on: { click: function () { window.print(); } } })]));
  inner.appendChild(h('div', { cls: 'rep-h' }, [h('p', { cls: 'fine', text: 'Report' + (spec.x.length > 1 && !spec.cats ? ' · ' + (weeks && !/^week/i.test(first) ? 'weeks of ' : '') + first + ' – ' + lastL : '') + ' · ' + plural(spec.x.length, weeks ? 'week' : spec.cats ? 'line' : 'point') }), h('h1', { text: meta.title || spec.title || 'Report' }), meta.sub ? h('p', { cls: 'sub', text: meta.sub }) : null]));
  // key numbers, one block per series
  var main = spec.series.filter(function (s) { return !s.noLegend && s.kind !== 'dash'; });
  var kblock = h('div', { cls: 'rep-keys' });
  main.forEach(function (s) {
    var st = seriesStats(s, spec); if (!st) return; var f = s.fmt || fy;
    var tiles = spec.cats ? [['Total', f(st.total)], ['Largest', f(st.hi[1]), xLabel(spec, st.hi[0])], ['Smallest', f(st.lo[1]), xLabel(spec, st.lo[0])], ['Average', f(st.avg)]]
      : [['Latest', f(st.last[1]), xLabel(spec, st.last[0]), st.prev ? chgTxt(chg(st.last[1], st.prev[1])) + ' vs. the one before' : ''], ['Average', f(st.avg), 'over ' + plural(st.n, weeks ? 'week' : 'point')], ['Highest', f(st.hi[1]), xLabel(spec, st.hi[0])], ['Lowest', f(st.lo[1]), xLabel(spec, st.lo[0])]];
    if (!spec.cats && !noTotal) tiles.push(['Total', f(st.total), 'for the period']);
    if (!spec.cats && st.a1 != null) tiles.push(['Trend', chgTxt(chg(st.a2, st.a1)) || 'flat', 'second half vs. first half']);
    kblock.appendChild(h('div', { cls: 'rep-series' }, [h('h3', null, [h('i', { style: 'background:' + s.color }), s.name]), h('div', { cls: 'cstats' }, tiles.map(function (t) { return h('div', { cls: 'cst' }, [h('span', { text: t[0] }), h('b', { text: t[1] }), h('small', { text: [t[2], t[3]].filter(Boolean).join(' · ') })]); }))]));
  });
  // what stands out, in words
  var notes = [], m0 = main[0] && seriesStats(main[0], spec);
  if (m0 && !spec.cats) {
    var f0 = main[0].fmt || fy, tr = chg(m0.a2, m0.a1);
    if (tr != null && isFinite(tr)) notes.push(main[0].name + ' is ' + (Math.abs(tr) < .01 ? 'about flat' : (tr > 0 ? 'up ' : 'down ') + Math.abs(tr * 100).toFixed(1) + '%') + ' in the second half of this period compared with the first.');
    notes.push('Best: ' + xLabel(spec, m0.hi[0]) + ' at ' + f0(m0.hi[1]) + '. Weakest: ' + xLabel(spec, m0.lo[0]) + ' at ' + f0(m0.lo[1]) + '.');
    if (m0.jump && m0.jump[1]) notes.push('Biggest single change: ' + xLabel(spec, m0.jump[0]) + ', ' + (m0.jump[1] > 0 ? 'up ' : 'down ') + (isPct ? (Math.abs(m0.jump[1]) * 100).toFixed(1) + ' points' : f0(Math.abs(m0.jump[1]))) + ' from the week before.');
    if (spec.target != null) { var over = main[0].values.filter(function (v) { return v != null && v > spec.target; }).length; notes.push(plural(over, weeks ? 'week' : 'point') + ' of ' + m0.n + ' above the ' + (spec.targetLabel || 'target') + ' (' + fy(spec.target) + ').'); }
    if (spec.stack && bars.length > 1) { var tot = sum(bars, function (s) { return sum(s.values, function (v) { return v; }); }); notes.push('Mix over the period: ' + bars.map(function (s) { return s.name + ' ' + pct(sum(s.values, function (v) { return v; }) / tot, 0); }).join(' · ') + '.'); }
  } else if (m0 && spec.cats) {
    var tt = m0.total, sorted = spec.x.map(function (x, i) { return [i, main[0].values[i]]; }).sort(function (a, b) { return b[1] - a[1]; });
    notes.push(xLabel(spec, sorted[0][0]) + ' is the largest at ' + pct(sorted[0][1] / tt, 0) + ' of the total.' + (sorted.length > 2 ? ' The top three make up ' + pct((sorted[0][1] + sorted[1][1] + sorted[2][1]) / tt, 0) + '.' : ''));
  }
  // the graph, large
  var big = h('div', { cls: 'card' }, [notes.length ? h('ul', { cls: 'rep-notes' }, notes.map(function (n) { return h('li', { text: n }); })) : null, chart(Object.assign({}, spec, { size: 'xl', noTable: true, _noReport: true }))]);
  inner.appendChild(big); inner.appendChild(kblock);
  // every row
  inner.appendChild(h('h2', { cls: 'section-title', text: weeks ? 'Week by week' + (meta.detail !== false ? ' — tap a week for its breakdown' : '') : 'Every line' }));
  var cols = spec.series.map(function (s) { return { name: s.name, f: s.fmt || fy, v: function (i) { return s.values[i]; }, st: seriesStats(s, spec) }; });
  if (spec.stack && bars.length > 1) cols.push({ name: 'Total', f: fy, v: function (i) { return sum(bars, function (s) { return s.values[i]; }); }, bold: true });
  var shareOf = spec.cats && cols[0].st ? cols[0].st.total : null;
  var thead = h('tr', null, [h('th', { text: spec.xName || (weeks ? 'Week' : 'Item') })].concat(cols.map(function (c) { return h('th', { cls: 'r', text: c.name }); })).concat(shareOf ? [h('th', { cls: 'r', text: 'Share' })] : !spec.cats ? [h('th', { cls: 'r', text: 'Change' })] : []).concat((spec.extraCols || []).map(function (c) { return h('th', { text: c.name }); })));
  var tb = h('tbody'), order = spec.x.map(function (_, i) { return i; }); if (!spec.cats) order.reverse();
  order.forEach(function (i) {
    var mv = cols[0].v(i), pv = i > 0 ? cols[0].v(i - 1) : null;
    var tr = h('tr', { cls: weeks && meta.detail !== false ? 'rowclick' : '' }, [h('td', { text: xLabel(spec, i) })].concat(cols.map(function (c) { var v = c.v(i), st = c.st; return h('td', { cls: 'r num' + (st && st.n > 2 && v === st.hi[1] ? ' hi' : st && st.n > 2 && v === st.lo[1] ? ' lo' : '') + (c.bold ? ' b' : ''), text: v == null ? '—' : c.f(v) }); }))
      .concat(shareOf ? [h('td', { cls: 'r num', text: pct(mv / shareOf, 1) })] : !spec.cats ? [h('td', { cls: 'r num ' + (mv != null && pv != null ? (mv > pv ? 'up' : mv < pv ? 'down' : '') : ''), text: mv != null && pv != null ? (isPct ? ((mv - pv) * 100 > 0 ? '+' : '') + ((mv - pv) * 100).toFixed(1) + ' pts' : chgTxt(chg(mv, pv))) : '' })] : [])
      .concat((spec.extraCols || []).map(function (c) { return h('td', { text: c.get(i) }); })));
    tb.appendChild(tr);
    if (weeks && meta.detail !== false) {
      var open = null;
      tr.addEventListener('click', function () { if (open) { open.remove(); open = null; tr.classList.remove('on'); return; } open = h('tr', { cls: 'wkdetail' }, h('td', { colspan: String(cols.length + 2 + (spec.extraCols || []).length) }, weekBreakdown(spec.x[i]))); tr.after(open); tr.classList.add('on'); });
    }
  });
  inner.appendChild(h('div', { cls: 'card', style: 'padding:0' }, h('div', { cls: 'scrollx' }, h('table', { cls: 't rep-t' }, [h('thead', null, thead), tb]))));
  inner.appendChild(h('p', { cls: 'fine', style: 'margin-top:10px', text: 'Green = highest in the column, red = lowest. ' + (meta.source || (weeks ? 'From payroll, end of day reports and scanned invoices.' : '')) }));
  function csv() {
    var rows = [[spec.xName || (weeks ? 'Week' : 'Item')].concat(cols.map(function (c) { return c.name; }))];
    spec.x.forEach(function (x, i) { rows.push([weeks ? x : xLabel(spec, i)].concat(cols.map(function (c) { var v = c.v(i); return v == null ? '' : Math.round(v * 10000) / 10000; }))); });
    var txt = rows.map(function (r) { return r.map(function (c) { c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n');
    try { var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = (meta.title || 'report').replace(/[^\w]+/g, '-').toLowerCase() + '.csv'; document.body.appendChild(a); a.click(); a.remove(); } catch (e) { toast('Downloading isn’t allowed here — open the file version to download.'); }
  }
  document.body.appendChild(back); back.scrollTop = 0;
}
/* one week, everything the system knows about it */
function weekBreakdown(ws) {
  var w = bizWeeks().filter(function (x) { return x.w === ws; })[0], box = h('div', { cls: 'wkb' });
  if (!w) { box.appendChild(h('p', { cls: 'fine', text: 'No detail for this week.' })); return box; }
  var facts = [['Net sales', w.net != null ? money(w.net, 0) : '—'], ['Food · Beverage', w.food != null ? k$(w.food) + ' · ' + k$(w.bev) : '—'], ['Labor', w.labor != null ? money(w.labor, 0) + (w.laborPct != null ? ' · ' + pct(w.laborPct) : '') : '—'], ['Tips', w.tips != null ? money(w.tips, 0) : '—'], ['Guests', w.covers ? w.covers + ' over ' + plural(w.nights, 'night') : '—'], ['Average check', w.covers && w.net ? money(w.net / w.covers) : '—'], ['Bought on invoices', money(w.bought, 0) + (w.net ? ' · ' + pct(w.bought / w.net) : '')], ['Prime cost', w.net && w.labor != null ? pct((w.labor + w.bought) / w.net) : '—']];
  box.appendChild(h('div', { cls: 'wkb-g' }, facts.map(function (f) { return h('div', null, [h('span', { text: f[0] }), h('b', { text: f[1] })]); })));
  var cats = [['Food', w.buy.food, COL.food], ['Drinks', w.buy.bev, COL.bev], ['Dry goods', w.buy.paper, COL.paper], ['Other', w.buy.other, COL.other]].filter(function (c) { return c[1] > 0; });
  var vend = Object.keys(w.vendors).map(function (k) { return { label: k, v: w.vendors[k] }; }).sort(function (a, b) { return b.v - a.v; }).slice(0, 6);
  var two = h('div', { cls: 'wkb-2' });
  if (cats.length) two.appendChild(h('div', null, [h('h4', { text: 'Purchases by type' }), hbars(cats.map(function (c) { return { label: c[0], v: c[1], color: c[2] }; }), null, null, true)]));
  if (vend.length) two.appendChild(h('div', null, [h('h4', { text: 'Purchases by vendor' }), hbars(vend, null, COL.bev, true)]));
  if (w.wagesBy) { var wb = Object.keys(w.wagesBy).map(function (k) { return { label: { boh: 'Kitchen', foh: 'Servers & bar', mgmt: 'Management' }[k] || k, v: +w.wagesBy[k] || 0 }; }).filter(function (x) { return x.v; }); if (wb.length) two.appendChild(h('div', null, [h('h4', { text: 'Wages by group' }), hbars(wb, null, COL.labor, true)])); }
  var evs = []; for (var d = 0; d < 7; d++) { var c = calDay(iso(addDays(pday(ws), d))); c.events.concat(c.meetings).forEach(function (e) { evs.push(c.d.toLocaleDateString(undefined, { weekday: 'short' }) + ' · ' + e.title + (e.guests ? ' (' + e.guests + ')' : '')); }); if (c.closedEv.length) evs.push(c.d.toLocaleDateString(undefined, { weekday: 'short' }) + ' · ' + c.closedEv[0].title); }
  two.appendChild(h('div', null, [h('h4', { text: 'On the calendar that week' }), evs.length ? h('ul', { cls: 'wkb-ev' }, evs.map(function (e) { return h('li', { text: e }); })) : h('p', { cls: 'fine', text: 'Regular service.' })]));
  box.appendChild(two);
  return box;
}
/* the little graphs on the number cards open a report too */
function kpiReport(label, opts) {
  var n = opts.spark.length, rw = rangeWeeks(), weeksL = rw.length === n ? rw : bizWeeks().filter(function (x) { return x.net != null; }).slice(-n);
  var vals = opts.spark.slice(-weeksL.length), isP = vals.every(function (v) { return v == null || Math.abs(v) <= 1.5; });
  var f = isP ? function (v) { return pct(v); } : /guest|cover/i.test(label) ? function (v) { return String(Math.round(v)); } : function (v) { return money(v, 0); };
  var spec = { x: weeksL.map(function (w) { return w.w; }), xFmt: wkLabel, tipTitle: function (x) { return 'Week of ' + wkLabel(x); }, yFmt: isP ? function (v) { return Math.round(v * 100) + '%'; } : /guest|cover/i.test(label) ? function (v) { return String(Math.round(v)); } : k$, auto: !isP, series: [{ name: label.replace(/ · .*/, ''), color: opts.color || COL.food, values: vals, fmt: f }] };
  if (/labor/i.test(label)) { spec.target = 0.30; spec.targetLabel = 'Target 30%'; }
  openReport(spec, { title: label.replace(/ · .*/, ''), sub: opts.sub });
}
/* =====================================================================================
   PREP LIST — built from the live menu, like the live site's Prep List:
   Basics first, then every dish with its parts; tick done, Do / X, initials.
   Kitchen → Prep list; Bar → Bar prep. Same line keys as the live list, so real ticks show.
   ===================================================================================== */
var PREP_BASICS = ['Garlic', 'Shallots', 'Thyme', 'Orange vinaigrette', 'Tallow'], BAR_BASICS = ['Lemon juice', 'Lime juice', 'Simple syrup', 'Garnishes'];
function pkey(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
function pcap(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function pparts(s) { return String(s || '').split(/\s*(?:,|&|\band\b|\bwith\b)\s*/i).map(function (x) { return pcap(x.replace(/\.$/, '')); }).filter(function (x) { return x && x.length < 60 && !/^(wood[- ]?fired?|grilled|roasted|seared|smoked|charred|raw)$/i.test(x); }); }
function prepState() {
  if (!S.prep) {
    var live = (S.data.prepLive || [])[0];
    S.prep = live ? { for_date: live.for_date, entries: JSON.parse(JSON.stringify(live.entries || {})), extra: JSON.parse(JSON.stringify(live.extra || {})), removed: JSON.parse(JSON.stringify(live.removed || {})) } : { for_date: nextOpen(iso()), entries: {}, extra: {}, removed: {} };
  }
  return S.prep;
}
function nextOpen(ds) { for (var i = 0; i < 14; i++) { var d = iso(addDays(pday(ds), i)), c = calDay(d); if (c.open) return d; } return ds; }
function prepSections(bar) {
  var tree = S.data.menuTree || [], out = [];
  if (bar) {
    out.push({ id: 'b-basics', title: 'Bar basics', station: 'Every day', dishes: [{ name: '', parts: BAR_BASICS.slice() }] });
    tree.filter(function (t) { return /cocktail|bar/i.test(t.label + ' ' + t.id); }).forEach(function (t) { (t.groups || []).forEach(function (g) {
      var dishes = (g.items || []).filter(function (m) { return m && !m.hidden && m.desc; }).map(function (m) { return { name: m.name, parts: pparts(m.desc) }; });
      if (dishes.length) out.push({ id: 'b-' + pkey(g.title), title: g.title, station: t.label, dishes: dishes });
    }); });
    return out;
  }
  out.push({ id: 'basics', title: 'Basics', station: 'Every day', basic: true, dishes: [{ name: '', parts: PREP_BASICS.slice() }] });
  var k = tree.filter(function (t) { return t.id === 'm-food' || /kitchen|food|dinner/i.test(t.label); })[0];
  if (k) (k.groups || []).forEach(function (g) {
    var dishes = (g.items || []).filter(function (m) { return m && !m.hidden && m.name; }).map(function (m) { var seen = {}, parts = []; pparts(m.name).concat(pparts(m.desc)).forEach(function (p) { var kk = pkey(p); if (!seen[kk]) { seen[kk] = 1; parts.push(p); } }); return { name: m.name, parts: parts }; });
    var adds = [g.noteAfter, g.note].map(function (n) { var mm = /add\s+to[^:]*:\s*(.+)$/i.exec(String(n || '')); return mm ? mm[1].split(/\s*[·•|]\s*/).map(function (x) { return pcap(x.replace(/\s*\$?\d+(\.\d+)?\s*$/, '')); }).filter(Boolean) : []; }).reduce(function (a, b) { return a.concat(b); }, []);
    if (adds.length) dishes.push({ name: 'Add-ons', parts: adds });
    if (dishes.length) out.push({ id: 'k-' + pkey(g.title), title: g.title, station: 'Kitchen', dishes: dishes });
  });
  return out;
}
function pentry(k) { var st = prepState(); return st.entries[k] = st.entries[k] || {}; }


function prepPage(el, bar) {
  if (!S.data.menuTree) return missing(el, 'the menu (the prep list is built from it)');
  var st = prepState(), secs = prepSections(bar), mode = S.prepMode || 'dish', filt = S.prepFilter || 'all', q = norm(S.prepQ || ''), canEdit = isMgr(), owner = role() === 'owner';
  // build the lines
  var lines = [];   // { sec, k, label, sub, extra }
  secs.forEach(function (sec) {
    if (mode === 'combined' && !sec.basic && sec.id !== 'b-basics') return;
    sec.dishes.forEach(function (d) { d.parts.forEach(function (p) { var k = pkey(p); if (!st.removed[k]) lines.push({ sec: sec, k: k, label: p, sub: d.name, dish: d.name }); }); });
    (st.extra[sec.id] || []).forEach(function (n) { lines.push({ sec: sec, k: 'x:' + sec.id + ':' + pkey(n), label: n, sub: 'Added', extra: n }); });
  });
  if (mode === 'combined') {
    var comb = {}, csec = { id: bar ? 'b-all' : 'k-all', title: bar ? 'Everything for the bar' : 'Everything for tonight', station: 'Combined' };
    secs.forEach(function (sec) { if (sec.basic || sec.id === 'b-basics') return; sec.dishes.forEach(function (d) { d.parts.forEach(function (p) { var k = pkey(p); if (st.removed[k]) return; (comb[k] = comb[k] || { sec: csec, k: k, label: p, uses: [] }).uses.push(d.name); }); }); (st.extra[sec.id] || []).forEach(function (n) { var k = 'x:' + sec.id + ':' + pkey(n); comb[k] = { sec: csec, k: k, label: n, uses: ['Added'], extra: n, xsec: sec.id }; }); });
    Object.keys(comb).sort(function (a, b) { return comb[a].label.localeCompare(comb[b].label); }).forEach(function (k) { var x = comb[k]; x.sub = x.uses.length > 1 ? 'Used in ' + x.uses.length + ' dishes: ' + x.uses.join(' · ') : x.uses[0]; lines.push(x); });
  }
  var uniqK = {}; lines.forEach(function (L) { uniqK[L.k] = 1; }); var allK = Object.keys(uniqK), doneN = allK.filter(function (k) { return (st.entries[k] || {}).done; }).length;
  // header: which service this list is for, and how busy it will be
  var fd = st.for_date || nextOpen(iso()), c = calDay(fd), dow = pday(fd).getDay();
  var same = (S.data.eodAll || []).filter(function (r) { return pday(r.report_date).getDay() === dow && r.actual_covers; }).slice(-8), avgCv = same.length ? Math.round(sum(same, function (r) { return +r.actual_covers; }) / same.length) : null;
  var plan = [avgCv ? 'About ' + avgCv + ' covers on a usual ' + pday(fd).toLocaleDateString(undefined, { weekday: 'long' }) : null].concat(c.events.map(function (e) { return e.title + (e.guests ? ' · ' + e.guests + ' guests' : '') + (e.start ? ' · ' + t12(e.start) : ''); })).filter(Boolean);
  el.appendChild(h('div', { cls: 'prephead' }, [
    h('div', null, [h('p', { cls: 'fine', style: 'margin:0', text: (bar ? 'Bar prep' : 'Prep list') + ' for' }), h('h2', { text: pday(fd).toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) + (c.holiday ? ' · ' + c.holiday : '') })]),
    h('div', { cls: 'prepplan' }, plan.length ? plan.map(function (p, i) { return h('span', { cls: 'chip ' + (i ? 'ember' : ''), text: p }); }) : [h('span', { cls: 'fine', text: 'Regular service' })]),
    h('div', { cls: 'prepprog' }, [h('b', { cls: 'num', text: doneN + ' of ' + allK.length + ' done' }), h('div', { cls: 'bar' }, h('i', { style: 'width:' + (allK.length ? doneN / allK.length * 100 : 0) + '%' }))])
  ]));
  // tools
  var find = h('input', { type: 'search', placeholder: 'Find a line…', value: S.prepQ || '' });
  find.addEventListener('input', function () { S.prepQ = find.value; filterRows(); });
  el.appendChild(h('div', { cls: 'toolbar' }, [
    h('div', { cls: 'find', style: 'max-width:260px' }, [svg(ICON.search), find]),
    h('div', { cls: 'seg' }, [['dish', 'By dish'], ['combined', 'Combined']].map(function (o) { return h('button', { 'aria-pressed': mode === o[0] ? 'true' : 'false', text: o[1], title: o[0] === 'combined' ? 'One line for anything used in more than one dish' : '', on: { click: function () { S.prepMode = o[0]; render(); } } }); })),
    h('div', { cls: 'seg' }, [['all', 'All'], ['todo', 'To do'], ['done', 'Done']].map(function (o) { return h('button', { 'aria-pressed': filt === o[0] ? 'true' : 'false', text: o[1], on: { click: function () { S.prepFilter = o[0]; render(); } } }); })),
    h('span', { cls: 'sp', style: 'flex:1' }),
    h('button', { cls: 'btn small', text: 'Print', on: { click: function () { window.print(); } } }),
    canEdit ? h('button', { cls: 'btn small', text: 'Reset for next service', on: { click: function () { var nx = nextOpen(iso(addDays(pday(fd), 1))); var m = modal('Start a fresh list?', h('p', { text: 'Clears every tick, Do / X and initials, and sets the list for ' + dlong(nx) + '. Items you added and lines you took off stay. (On the real site it also resets itself at 8 pm.)' }), [h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Keep it', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn accent', text: 'Reset', on: { click: function () { st.entries = {}; st.for_date = nx; m.close(); changed('Prep list reset for ' + dshort(nx)); render(); } } })]); } } }) : null
  ]));
  var box = h('div', { cls: 'preplist' }); el.appendChild(box);
  var rows = [];
  var groups = []; lines.forEach(function (L) { var g = groups.filter(function (x) { return x.sec === L.sec; })[0]; if (!g) groups.push(g = { sec: L.sec, lines: [] }); g.lines.push(L); });
  groups.forEach(function (g) {
    var ks = uniq(g.lines.map(function (L) { return L.k; })), dn = ks.filter(function (k) { return (st.entries[k] || {}).done; }).length;
    var card = h('div', { cls: 'card prepsec', 'data-sec': g.sec.id });
    card.appendChild(h('div', { cls: 'prepsec-h' }, [h('h3', { text: g.sec.title }), h('span', { cls: 'fine', text: (g.sec.station ? g.sec.station + ' · ' : '') + dn + ' of ' + ks.length + ' done' }), h('div', { cls: 'bar sm' }, h('i', { style: 'width:' + (ks.length ? dn / ks.length * 100 : 0) + '%' }))]));
    var lastDish = null;
    g.lines.forEach(function (L) {
      if (mode === 'dish' && L.dish && L.dish !== lastDish && !g.sec.basic) { lastDish = L.dish; card.appendChild(h('div', { cls: 'prepdish', text: L.dish })); }
      var e = pentry(L.k), rec = (S.data.recipes || []).filter(function (r) { return pkey(r.name) === L.k || pkey(r.name).indexOf(L.k) === 0 && L.k.length > 4; })[0];
      var chk = h('button', { cls: 'pchk', role: 'checkbox', 'aria-checked': e.done ? 'true' : 'false', 'aria-label': 'Done: ' + L.label });
      var dox = h('div', { cls: 'pdo' }, ['Do', 'X'].map(function (v) { return h('button', { 'aria-pressed': e.prep === v ? 'true' : 'false', 'data-v': v, text: v }); }));
      var ini = h('button', { cls: 'pini' + (e.ini ? ' on' : ''), text: e.ini || 'Init.', title: e.ini ? 'Signed by ' + e.ini : 'Sign it with your initials' });
      var row = h('div', { cls: 'prow' + (e.done ? ' done' : ''), 'data-k': L.k, 'data-t': norm(L.label + ' ' + (L.sub || '')) }, [chk, h('div', { cls: 'pname' }, [h('b', { text: L.label }), mode === 'combined' || L.extra ? h('span', { text: L.sub }) : null, rec ? h('button', { cls: 'prec', text: 'Recipe', on: { click: function () { go('kitchen', 'recipes'); } } }) : null]), h('div', { cls: 'pctl' }, [dox, ini]), owner ? h('button', { cls: 'px', 'aria-label': 'Take ' + L.label + ' off the list', text: '✕', on: { click: function () { if (L.extra) { var sid = L.xsec || L.sec.id; st.extra[sid] = (st.extra[sid] || []).filter(function (x) { return x !== L.extra; }); } else st.removed[L.k] = 1; changed('Took ' + L.label + ' off the list'); render(); } } }) : null]);
      function paint() { var x = pentry(L.k); [].forEach.call(box.querySelectorAll('.prow[data-k="' + CSS.escape(L.k) + '"]'), function (r) { r.classList.toggle('done', !!x.done); r.querySelector('.pchk').setAttribute('aria-checked', x.done ? 'true' : 'false'); [].forEach.call(r.querySelectorAll('.pdo button'), function (b) { b.setAttribute('aria-pressed', x.prep === b.getAttribute('data-v') ? 'true' : 'false'); }); var ib = r.querySelector('.pini'); ib.textContent = x.ini || 'Init.'; ib.classList.toggle('on', !!x.ini); }); progress(); filterRows(); }
      chk.addEventListener('click', function () { var on = !pentry(L.k).done; pset(L.k, 'done', on); if (on && !pentry(L.k).ini) pset(L.k, 'ini', myInitials()); paint(); });
      [].forEach.call(dox.children, function (b) { b.addEventListener('click', function () { var v = b.getAttribute('data-v'); pset(L.k, 'prep', pentry(L.k).prep === v ? '' : v); paint(); }); });
      ini.addEventListener('click', function () { pset(L.k, 'ini', pentry(L.k).ini ? '' : myInitials()); paint(); });
      rows.push(row); card.appendChild(row);
    });
    if (canEdit && g.sec.id !== 'k-all' && g.sec.id !== 'b-all') {
      var ai = h('input', { type: 'text', placeholder: '+ Add a line to ' + g.sec.title, cls: 'padd' });
      ai.addEventListener('keydown', function (ev) { if (ev.key === 'Enter' && ai.value.trim()) { (st.extra[g.sec.id] = st.extra[g.sec.id] || []).push(pcap(ai.value.trim())); changed('Added ' + ai.value.trim()); render(); } });
      card.appendChild(ai);
    }
    box.appendChild(card);
  });
  if (owner && Object.keys(st.removed).length) el.appendChild(h('button', { cls: 'btn small', style: 'margin-top:12px', text: 'Bring back ' + plural(Object.keys(st.removed).length, 'line') + ' taken off', on: { click: function () { st.removed = {}; changed('Lines brought back'); render(); } } }));
  el.appendChild(h('p', { cls: 'fine', style: 'margin-top:12px', text: 'Built from the guest menu: every dish on it becomes a block, with its main ingredient and each part of its description. Change the menu and the list follows. Tick a line when it’s done (it signs your initials) and pick Do or X. Everyone in the kitchen sees the same list, here, on the staff page and on the Hub.' }));
  function progress() {
    var d = allK.filter(function (k) { return (st.entries[k] || {}).done; }).length; var pp = el.querySelector('.prepprog'); pp.querySelector('b').textContent = d + ' of ' + allK.length + ' done'; pp.querySelector('i').style.width = (allK.length ? d / allK.length * 100 : 0) + '%';
    [].forEach.call(box.querySelectorAll('.prepsec'), function (cd) { var ks = uniq([].map.call(cd.querySelectorAll('.prow'), function (r) { return r.getAttribute('data-k'); })), dn = ks.filter(function (k) { return (st.entries[k] || {}).done; }).length; cd.querySelector('.prepsec-h .fine').textContent = cd.querySelector('.prepsec-h .fine').textContent.replace(/\d+ of \d+ done/, dn + ' of ' + ks.length + ' done'); cd.querySelector('.prepsec-h i').style.width = (ks.length ? dn / ks.length * 100 : 0) + '%'; });
  }
  function filterRows() { var qq = norm(S.prepQ || ''), f = S.prepFilter || 'all'; rows.forEach(function (r) { var e = pentry(r.getAttribute('data-k')), ok = (!qq || r.getAttribute('data-t').indexOf(qq) !== -1) && (f === 'all' || (f === 'done') === !!e.done); r.hidden = !ok; }); [].forEach.call(box.querySelectorAll('.prepsec'), function (cd) { var any = [].some.call(cd.querySelectorAll('.prow'), function (r) { return !r.hidden; }); cd.hidden = !any && !!(qq || f !== 'all'); [].forEach.call(cd.querySelectorAll('.prepdish'), function (dh) { var n = dh.nextElementSibling, vis = false; while (n && n.classList.contains('prow')) { if (!n.hidden) vis = true; n = n.nextElementSibling; } dh.hidden = !vis; }); }); }
  filterRows();
}
PAGES['kitchen/prep'] = function (el) { prepPage(el, false); };
PAGES['bar/prep'] = function (el) { prepPage(el, true); };
function prepProgress(bar) { var st = prepState(), secs = prepSections(bar), ks = {}; secs.forEach(function (s) { s.dishes.forEach(function (d) { d.parts.forEach(function (p) { if (!st.removed[pkey(p)]) ks[pkey(p)] = 1; }); }); (st.extra[s.id] || []).forEach(function (n) { ks['x:' + s.id + ':' + pkey(n)] = 1; }); }); var all = Object.keys(ks); return { n: all.length, d: all.filter(function (k) { return (st.entries[k] || {}).done; }).length }; }
/* =====================================================================================
   A stand-in database for the live modules embedded in this prototype.
   Sample data: everything lives in memory. Real data: reads go to the real database,
   and every write (save, delete, function call that changes something) is kept here in
   this tab instead — the live site never sees it.
   ===================================================================================== */
var MEM = { tables: {}, gone: {}, keys: { section_rules: 'level,section', section_people: 'employee_id,section', payroll_weeks: 'week_start', pay_rates: 'emp', payroll_settings: 'id', schedule_weeks: 'week_start', employees: 'id' } };
function memKey(t) { return MEM.keys[t] || 'id'; }
function rk(row, key) { return key.split(',').map(function (k) { return String(row[k.trim()]); }).join('|'); }
function likeRe(p, ci) { return new RegExp('^' + String(p).replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/%/g, '.*').replace(/_/g, '.') + '$', ci ? 'i' : ''); }
function pathGet(row, path) { var p = path.split('->').map(function (x) { return x.replace(/^>/, '').trim(); }), v = row[p[0]]; for (var i = 1; i < p.length && v != null; i++) v = v[p[i]]; return v; }
function applyQ(q, rows) {
  var out = rows.filter(function (r) { return q.f.every(function (f) {
    var v = f.col.indexOf('->') > 0 ? pathGet(r, f.col) : r[f.col];
    switch (f.op) { case 'eq': return String(v) === String(f.val); case 'neq': return String(v) !== String(f.val); case 'gt': return v > f.val; case 'gte': return v >= f.val; case 'lt': return v < f.val; case 'lte': return v <= f.val;
      case 'like': return likeRe(f.val).test(String(v == null ? '' : v)); case 'ilike': return likeRe(f.val, true).test(String(v == null ? '' : v)); case 'in': return f.val.map(String).indexOf(String(v)) !== -1; case 'is': return f.val === null ? v == null : v === f.val; default: return true; }
  }); });
  q.o.forEach(function (o) { out.sort(function (a, b) { var x = a[o.col], y = b[o.col]; if (x == y) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : 1) * (o.asc ? 1 : -1); }); });
  if (q.lim != null) out = out.slice(q.off || 0, (q.off || 0) + q.lim);
  return out;
}
function project(sel, rows) {
  if (!sel || sel.trim() === '*') return rows.map(function (r) { return JSON.parse(JSON.stringify(r)); });
  var parts = sel.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  return rows.map(function (r) { var o = {}; parts.forEach(function (p) { if (p === '*') { Object.assign(o, JSON.parse(JSON.stringify(r))); return; } var m = p.match(/^(\w+):(.+)$/), alias = m ? m[1] : null, src = m ? m[2] : p; var v = src.indexOf('->') > 0 ? pathGet(r, src) : r[src]; o[alias || (src.indexOf('->') > 0 ? src.split('->').pop().replace(/^>/, '') : src)] = v === undefined ? null : JSON.parse(JSON.stringify(v)); }); return o; });
}
function memWrite(t, op, payload, q, opts) {
  var tb = MEM.tables[t] = MEM.tables[t] || [], key = (opts && opts.onConflict) || memKey(t), list = Array.isArray(payload) ? payload : [payload], out = [];
  if (op === 'insert' || op === 'upsert') list.forEach(function (p) { var row = JSON.parse(JSON.stringify(p)); if (row[key] == null && key === 'id') row.id = 'm' + Math.random().toString(36).slice(2, 10); var ex = tb.filter(function (r) { return rk(r, key) === rk(row, key); })[0]; if (ex && op === 'upsert') Object.assign(ex, row); else tb.push(row); if (MEM.gone[t]) delete MEM.gone[t][rk(row, key)]; out.push(ex || row); });
  if (op === 'update') { applyQ(q, tb).forEach(function (r) { Object.assign(r, JSON.parse(JSON.stringify(payload))); out.push(r); }); }
  if (op === 'delete') { var del = applyQ(q, tb); for (var di = tb.length - 1; di >= 0; di--) if (del.indexOf(tb[di]) !== -1) tb.splice(di, 1); MEM.gone[t] = MEM.gone[t] || {}; (q.base || []).forEach(function (r) { MEM.gone[t][rk(r, key)] = 1; }); out = del; }
  if (window.__memChanged) window.__memChanged(t, op, out);
  return out;
}
function MQ(client, t) { this.c = client; this.t = t; this.op = 'select'; this.sel = '*'; this.f = []; this.o = []; this.lim = null; this.off = 0; this.one = false; this.calls = []; }
['eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'like', 'ilike', 'in', 'is'].forEach(function (m) { MQ.prototype[m] = function (col, val) { this.f.push({ op: m, col: col, val: val }); this.calls.push([m, [col, val]]); return this; }; });
['not', 'or', 'filter', 'match', 'contains', 'textSearch'].forEach(function (m) { MQ.prototype[m] = function () { this.calls.push([m, [].slice.call(arguments)]); return this; }; });
MQ.prototype.select = function (s, o) { if (this.op === 'select') this.sel = s || '*'; this.calls.push(['select', [s, o]]); return this; };
MQ.prototype.order = function (col, o) { this.o.push({ col: col, asc: !o || o.ascending !== false }); this.calls.push(['order', [col, o]]); return this; };
MQ.prototype.limit = function (n) { this.lim = n; this.calls.push(['limit', [n]]); return this; };
MQ.prototype.range = function (a, b) { this.off = a; this.lim = b - a + 1; this.calls.push(['range', [a, b]]); return this; };
MQ.prototype.maybeSingle = function () { this.one = 'maybe'; this.calls.push(['maybeSingle', []]); return this; };
MQ.prototype.single = function () { this.one = 'single'; this.calls.push(['single', []]); return this; };
['insert', 'upsert', 'update', 'delete'].forEach(function (m) { MQ.prototype[m] = function (p, opts) { this.op = m; this.payload = p; this.opts = opts; return this; }; });
MQ.prototype.then = function (res, rej) {
  var self = this, t = this.t;
  function fin(rows) { rows = project(self.sel, rows); return { data: self.one ? (rows[0] || null) : rows, error: null, count: rows.length }; }
  var p;
  if (this.op !== 'select') {
    if (this.op === 'delete' && this.c.real) { var self2 = this; p = this.c.realQuery(t, this.calls).then(function (r) { self2.base = r.data || []; memWrite(t, 'delete', null, self2); return { data: null, error: null }; }); }
    else p = Promise.resolve({ data: memWrite(t, this.op, this.payload, this, this.opts), error: null });
  } else if (this.c.real) {
    p = this.c.realQuery(t, this.calls.filter(function (c) { return c[0] !== 'maybeSingle' && c[0] !== 'single'; })).then(function (r) {
      if (r.error && !(MEM.tables[t] || []).length) return { data: self.one ? null : [], error: r.error };
      var key = memKey(t), base = (r.data || []).filter(function (x) { return !(MEM.gone[t] || {})[rk(x, key)]; }), mine = applyQ(self, MEM.tables[t] || []);
      // rows changed in this tab replace the real ones; the real query already filtered and projected, so overlay rows are projected too
      var mk = {}; mine.forEach(function (m) { mk[rk(m, key)] = 1; });
      var merged = base.filter(function (x) { return !mk[rk(x, key)]; }).concat(project(self.sel, mine));
      self.o.forEach(function (o) { merged.sort(function (a, b) { var x = a[o.col], y = b[o.col]; if (x == y) return 0; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : 1) * (o.asc ? 1 : -1); }); });
      return { data: self.one ? (merged[0] || null) : merged, error: null };
    });
  } else p = Promise.resolve(fin(applyQ(this, MEM.tables[t] || [])));
  return p.then(res, rej);
};
MQ.prototype.catch = function (f) { return this.then(null, f); };
function memClient(real) {
  var c = { real: real || null };
  c.realQuery = function (t, calls) { var q = real.from(t); calls.forEach(function (x) { q = q[x[0]].apply(q, x[1]); }); return q.then(function (r) { return r; }, function (e) { return { data: null, error: e }; }); };
  c.from = function (t) { return new MQ(c, t); };
  c.rpc = function (n, a) { if (typeof RPCX !== 'undefined' && RPCX[n]) return RPCX[n](a || {}, real); if (real && /_get$|^get_|^staff_role$/.test(n)) return real.rpc(n, a); return Promise.resolve({ data: null, error: null }); };
  c.auth = real ? real.auth : { getSession: function () { return Promise.resolve({ data: { session: null } }); } };
  c.storage = { from: function () { return { upload: function () { return Promise.resolve({ data: {}, error: null }); }, getPublicUrl: function () { return { data: { publicUrl: '' } }; }, createSignedUrl: function () { return Promise.resolve({ data: { signedUrl: '' } }); } }; } };
  c.functions = { invoke: function () { return Promise.resolve({ data: null, error: { message: 'Not in the prototype' } }); } };
  c.channel = function () { var ch = { on: function () { return ch; }, subscribe: function () { return ch; }, unsubscribe: function () {} }; return ch; };
  c.removeChannel = function () {};
  return c;
}
/* the live modules' pop-ups: inside the phone/iPad viewer they're blocked, so there they become a note and the action goes ahead */
var IN_FRAME = (function () { try { return window.self !== window.top; } catch (e) { return true; } })();
window.__alert = function (m) { if (IN_FRAME) toast(String(m).split('\n')[0]); else alert(m); };
window.__prompt = function (m, d) { if (IN_FRAME) { toast('Typing a new name here needs the downloaded file — the phone/iPad viewer blocks pop-ups.'); return null; } return prompt(m, d); };
window.__confirm = function (m) { if (IN_FRAME) { toast(String(m).split('\n')[0]); return true; } return confirm(m); };
/* =====================================================================================
   PAYROLL — the live site's payroll, exactly: same calculations, Square imports,
   tip pool, overtime by job, Pinnacle invoice estimate, the two sheets, Financials.
   ===================================================================================== */
function payClient() { return sb; }
window.__memChanged = function (t, op, rows) {
  S.edits = (S.edits || 0) + 1;
  if (t === 'payroll_weeks' && (op === 'upsert' || op === 'insert' || op === 'update')) (rows || []).forEach(function (r) {
    var sm = r.rows && r.rows._summary; if (!sm) return;
    S.data.payweeks = S.data.payweeks || []; var ex = S.data.payweeks.filter(function (x) { return x.week_start === r.week_start; })[0];
    if (ex) { ex.summary = sm; ex.status = r.status; } else S.data.payweeks.unshift({ week_start: r.week_start, status: r.status, summary: sm });
    S.dataVer = Date.now();
  });
};
window.__prSub = function (sub) { S.paySub = sub; [].forEach.call(document.querySelectorAll('.paysub button'), function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-sub') === sub ? 'true' : 'false'); }); };
function legacyStatus(m, k) {
  if (!m || k === 'dirty' || /^Saved\.?$/.test(m)) { var st = document.querySelector('.paystatus'); if (st) st.textContent = k === 'dirty' ? 'Saving…' : m ? 'Saved' : ''; return; }
  toast(m);
}
PAGES['business/payroll'] = function (el) {
  if (!window.EdenPayroll) return missing(el, 'payroll');
  var sub = S.paySub || 'week';
  el.appendChild(h('div', { cls: 'toolbar', style: 'justify-content:space-between' }, [
    h('div', { cls: 'seg paysub' }, [['week', 'Weekly payroll'], ['past', 'Past payroll'], ['rates', 'Pay rates & invoice rates'], ['overview', 'Financials'], ['products', 'Product sales (Item sales file)']].map(function (o) { return h('button', { 'data-sub': o[0], 'aria-pressed': sub === o[0] ? 'true' : 'false', text: o[1], on: { click: function () { S.paySub = o[0]; render(); } } }); })),
    h('span', { cls: 'fine paystatus' })]));
  var box = h('div', { cls: 'legacy' }); el.appendChild(box);
  S.legacySeen = true; window.EdenPayroll.show({ sb: payClient(), el: box, sub: sub, status: legacyStatus, name: S.myName || 'Owner', role: role() });
};
/* sample payroll data, shaped like the real tables */
function seedPayroll(sun) {
  var T = MEM.tables, e = S.data.employees, last = iso(addDays(sun, -7));
  var acc = { e0: 'owner', e1: 'manager', e2: 'bartender', e3: 'server', e4: 'server', e5: 'cook', e6: 'cook', e7: 'employee' };
  e.forEach(function (x) { if (!x.access) x.access = acc[x.id] || 'employee'; if (x.email === undefined) x.email = ''; if (x.phone === undefined) x.phone = ''; });
  var contact = { e1: ['tyler@edencny.com', '(315) 555-0141', 'active'], e2: ['kyle.alden@example.com', '(315) 555-0177', 'active'], e3: ['maria@example.com', '(315) 555-0112', 'active'], e4: ['', '(315) 555-0190', ''], e5: ['dev@example.com', '(315) 555-0133', ''], e6: ['jo@example.com', '(315) 555-0158', 'active'], e7: ['', '', ''] };
  e.forEach(function (x) { var c = contact[x.id]; if (c && !x.email && !x.phone) { x.email = c[0]; x.phone = c[1]; if (c[2]) x.login = c[2]; } });
  MEM.ordersLoaded = false; T.order_items = [{ id: 'o1', item: 'Heavy cream', qty: '2 qt', note: '', added_by: 'Jo', added_at: new Date(Date.now() - 864e5).toISOString(), received_at: null, received_by: '' }, { id: 'o2', item: 'Lemons', qty: '1 case', note: 'For the bar', added_by: 'Kyle', added_at: new Date(Date.now() - 3600e3 * 5).toISOString(), received_at: null, received_by: '' }, { id: 'o3', item: 'To-go containers, small', qty: '', note: '', added_by: 'Hub · Maria', added_at: new Date(Date.now() - 2 * 864e5).toISOString(), received_at: new Date(Date.now() - 864e5).toISOString(), received_by: 'Tyler' }];
  T.employees = e; T.section_rules = []; T.section_people = [];
  var rate = { e0: { pay_type: 'salary', weekly_salary: 1442.31 }, e1: { rate: 17.5, kitchen_rate: 30, tip_eligible: true, commission: true, k401: true }, e2: { rate: 12, tip_eligible: true, k401: true }, e3: { rate: 10.65, tip_eligible: true }, e4: { rate: 10.65, tip_eligible: true }, e5: { rate: 21, k401: true }, e6: { rate: 22 }, e7: { rate: 16 } };
  T.pay_rates = e.map(function (x) { return Object.assign({ emp: x.id, pay_type: 'hourly', rate: null, weekly_salary: null, tip_eligible: false, notes: '', kitchen_rate: null, commission: false, payroll_id: '', payroll_name: '', square_name: '', k401: false }, rate[x.id] || {}); });
  T.schedule_weeks = (S.data.weeks || []).map(function (w) { return { week_start: w.week_start, status: w.status, shifts: w.shifts, published: w.published || null }; });
  var empIds = e.map(function (x) { return x.id; });
  T.payroll_weeks = (S.data.payweeks || []).filter(function (p) { return p.week_start < last; }).map(function (p, i) {
    var sm = JSON.parse(JSON.stringify(p.summary || {})), emp = {}; empIds.forEach(function (id, j) { emp[id] = Math.round((j === 0 ? 1442.31 : [0, 1150, 980, 1020, 610, 960, 1010, 520][j]) * (0.92 + ((i + j) % 5) * 0.04) * 100) / 100; });
    sm.emp = emp; sm.wages = sm.cost; sm.comm = 0; sm.gross = (sm.cost || 0) + (sm.tips || 0); sm.invEst = Math.round(sm.gross * 1.181 * 100) / 100; sm.extra = Math.round((sm.invEst - sm.gross) * 100) / 100; sm.extraPct = sm.gross ? sm.extra / sm.gross : null; sm.trueCost = Math.round((sm.invEst - (sm.tips || 0)) * 100) / 100; sm.truePct = sm.net ? sm.trueCost / sm.net : null; sm.tax = Math.round(sm.net * 0.08 * 100) / 100; sm.cardFees = Math.round(sm.net * 0.8 * 0.029 * 100) / 100;
    return { week_start: p.week_start, status: 'final', tip_pool: 0, rows: { _summary: sm }, notes: '', finalized_at: p.week_start + 'T23:00:00Z' };
  });
  // last week: hours in from the Square timecard file, tips by day, one tip that doesn't match the End of day report
  var rows = {}, ws = (S.data.weeks || []).filter(function (w) { return w.week_start === last; })[0], sh = ws ? ws.published || ws.shifts : [];
  sh.forEach(function (x, i) { var r = rows[x.emp] = rows[x.emp] || { hours: [null, null, null, null, null, null, null], adj: null, adj_note: '' }; r.hours[x.day] = Math.round(((+r.hours[x.day] || 0) + shiftHours(x) + ((i % 5) - 2) * 0.25) * 100) / 100; });
  if (rows.e1) rows.e1.khours = [null, null, 5, null, null, null, null];
  if (rows.e4) { rows.e4.adj = 40; rows.e4.adj_note = 'Supper Club setup'; }
  if (rows.e1) rows.e1.comm = 120;
  var cash = [null, null, null, 182, 205, 298, 331], card = [null, null, null, 640.5, 712.25, 1021.4, 1134.9];
  rows._tips = { cash: cash, card: card, src: ['', '', '', 'square', 'square', 'square', 'square'], sq: card.map(function (x) { return x || 0; }), sqCash: cash.map(function (x) { return x || 0; }) };
  T.payroll_weeks.push({ week_start: last, status: 'draft', tip_pool: 0, rows: rows, notes: '', source: 'square', square_file: 'shifts-' + last + '.csv', square_at: new Date().toISOString() });
  // End of day reports for last week (Friday's card tips are off by $12.40 to show the check)
  T.eod_reports = [3, 4, 5, 6].map(function (d) { return { id: 'eod' + d, report_date: iso(addDays(pday(last), d)), status: 'submitted', tips_cash: cash[d], tips_card: d === 5 ? 1009 : card[d], net_sales: [3100, 3400, 5600, 6100][d - 3], actual_covers: [44, 49, 72, 80][d - 3] }; });
  T.payroll_settings = [];
}
/* =====================================================================================
   INVENTORY — the live site's full inventory sheet, embedded, sharing the same items and
   counts as the simpler Count / Order / Items pages (a change in one shows in the other).
   ===================================================================================== */
function shareInventory() {
  ['items', 'counts', 'prices', 'invoices', 'recipes'].forEach(function (k) { if (!Array.isArray(S.data[k])) S.data[k] = []; });
  MEM.tables.inventory_items = S.data.items; MEM.tables.inventory_counts = S.data.counts; if (Array.isArray(S.data.employees)) MEM.tables.employees = S.data.employees;
  S.data.prices.forEach(function (p) { if (!p.id) p.id = uid(); }); MEM.tables.inventory_prices = S.data.prices;
  if (S.mode !== 'live') { MEM.tables.inventory_invoices = S.data.invoices; MEM.tables.inventory_item_links = MEM.tables.inventory_item_links || []; MEM.tables.inventory_settings = MEM.tables.inventory_settings || []; MEM.tables.recipes = S.data.recipes; }
}
var _memChanged0 = window.__memChanged;
window.__memChanged = function (t, op, rows) { _memChanged0(t, op, rows); if (/^inventory_/.test(t)) { S.dataVer = Date.now(); S._invMine = S.dataVer; } };
window.__invGo = function (cid) { var slug = { food: 'food', bev: 'beverages', paper: 'dry' }[cid] || ''; S.invSub = S.invSub || {}; var sp = cid === 'bev' ? 'bar' : 'kitchen'; S.invSub[sp] = slug; go(sp, 'sheet'); };
function invAddMenu(o) {
  var t = (S.data.menuTree || []).filter(function (x) { return x.id === o.tab; })[0], g = t && (t.groups || []).filter(function (x) { return x.id === o.gid || x.title === o.gid; })[0];
  if (!g) return Promise.resolve(false);
  g.items = (g.items || []).concat([o.item]); S.menuPending = (S.menuPending || 0) + 1; changed('Added ' + (o.item && o.item.name || '') + ' to the menu (not published)');
  return Promise.resolve(true);
}
function invSheet(el, bar) {
  if (!window.EdenInventory) return missing(el, 'the inventory');
  S.invSub = S.invSub || {};
  var key = bar ? 'bar' : 'kitchen', subs = [['', 'Overview, invoices & reports']].concat(bar ? [['beverages', 'Beverage sheet']] : [['food', 'Food sheet'], ['dry', 'Dry goods sheet']]);
  var cur = S.invSub[key] != null ? S.invSub[key] : subs[1][0];
  el.appendChild(h('div', { cls: 'toolbar', style: 'justify-content:space-between' }, [h('div', { cls: 'seg' }, subs.map(function (o) { return h('button', { 'aria-pressed': cur === o[0] ? 'true' : 'false', text: o[1], on: { click: function () { S.invSub[key] = o[0]; render(); } } }); })), h('span', { cls: 'fine paystatus' })]));
  var box = h('div', { cls: 'legacy' }); el.appendChild(box);
  if (S._invVer !== S.dataVer && S._invMine !== S.dataVer) window.EdenInventory._reset();
  S._invVer = S.dataVer;
  S.legacySeen = true; window.EdenInventory.show({ sb: payClient(), el: box, status: legacyStatus, role: role(), name: S.myName || 'Owner', arg: null, sub: cur, addMenuItem: invAddMenu, canAddMenu: function () { return isMgr(); }, getMenu: function () { return { tabs: S.data.menuTree || [] }; } });
}
PAGES['kitchen/sheet'] = function (el) { invSheet(el, false); };
PAGES['bar/sheet'] = function (el) { invSheet(el, true); };
/* Receive: the full matching / price-entry tools are one tap away */
(function () {
  var base = PAGES['kitchen/receive'];
  function withTools(el) {
    el.appendChild(h('div', { cls: 'card', style: 'margin-bottom:16px;display:flex;gap:14px;align-items:center;flex-wrap:wrap' }, [h('div', { style: 'flex:1;min-width:240px' }, [h('b', { text: 'Match invoice lines, type in a price or vendor, scan an invoice' }), h('p', { cls: 'fine', style: 'margin:2px 0 0', text: 'These open in the full sheet, with the same tools as today: Match to an item, Enter a price (on the invoice or as received), new vendor, and Put an invoice’s prices into the inventory.' })]), h('button', { cls: 'btn accent', text: 'Open the full sheet →', on: { click: function () { S.invSub = S.invSub || {}; S.invSub[S.space === 'bar' ? 'bar' : 'kitchen'] = ''; go(S.space === 'bar' ? 'bar' : 'kitchen', 'sheet'); } } })]));
    base(el);
  }
  PAGES['kitchen/receive'] = withTools; PAGES['bar/receive'] = withTools;
})();
/* TEAM → PERMISSIONS: the live permissions page (Owner only), embedded */
PAGES['team/permissions'] = function (el) {
  if (!window.EdenPerms) return missing(el, 'permissions');
  if (role() !== 'owner') { el.appendChild(h('p', { cls: 'empty', text: 'Only the Owner can change permissions.' })); return; }
  var box = h('div', { cls: 'legacy' }); el.appendChild(box);
  S.legacySeen = true; window.EdenPerms.show({ sb: payClient(), el: box, status: legacyStatus });
};
/* TEAM → PEOPLE: each person's Access (which Permissions column they're in), as on the live Employees page */
PAGES['team/people'] = function (el) {
  var es = S.data.employees; if (!es) return missing(el, 'the roster');
  var act = es.filter(function (e) { return e.active !== false && !e.removed_at; }), own = role() === 'owner';
  var LV = [['owner', 'Owner'], ['manager', 'Manager'], ['employee', 'Employee'], ['cook', 'Cook'], ['server', 'Server'], ['bartender', 'Bartender']];
  el.appendChild(h('div', { cls: 'card' }, [h('div', { cls: 'card-h' }, [h('div', null, [h('h2', { text: plural(act.length, 'person') + ' on the team' }), h('p', { cls: 'sub', style: 'margin:0', text: 'Access decides which Permissions column someone is in. Owners and managers always have everything.' })]), own ? h('button', { cls: 'btn small', text: 'Permissions →', on: { click: function () { go('team', 'permissions'); } } }) : null]),
    h('div', { cls: 'list' }, act.map(function (e) {
      var acc = sel(LV, e.access || 'employee'); acc.disabled = !own || e.access === 'owner'; acc.setAttribute('aria-label', 'Access for ' + e.name); acc.className = 'accsel';
      acc.addEventListener('change', function () { e.access = acc.value; changed(e.name + ' is now ' + LV.filter(function (l) { return l[0] === acc.value; })[0][1]); });
      return h('div', { cls: 'row' }, [h('div', { cls: 'me', style: 'border:0;padding:0;margin:0' }, h('div', { cls: 'av', text: initials(e.name) })), h('div', { cls: 'main-t' }, [h('b', { text: e.name }), h('span', { text: [e.position, e.phone].filter(Boolean).join(' · ') })]), h('label', { cls: 'fine', style: 'display:flex;gap:6px;align-items:center' }, ['Access', acc])]);
    }))]));
};
/* =====================================================================================
   COUNT — same rules as the live sheet: counts save as you type into an open count for
   a date; "Start a new inventory" picks the date (keep going on one in progress, or
   start fresh); "Save inventory" finishes it. The full sheet sees the same count.
   ===================================================================================== */
function countRowFor(kind, date) { return (S.data.counts || []).filter(function (c) { return c.category === kind && c.count_date === date; })[0] || null; }
function openCount(kind) { var d = (S.countDate || {})[kind]; if (d) return countRowFor(kind, d); return (S.data.counts || []).filter(function (c) { return c.category === kind && !c.finished_at && c.counts && Object.keys(c.counts).length; }).sort(function (a, b) { return a.count_date < b.count_date ? 1 : -1; })[0] || null; }
function startInventory() {
  var kind = S.kind, lab = KINDS.filter(function (k) { return k[0] === kind; })[0][1], open = openCount(kind);
  var d = inp(open ? open.count_date : iso(), { type: 'date' }), info = h('p', { cls: 'fine' });
  var clr = h('button', { cls: 'btn danger', text: 'Clear that count and start over' });
  function paint() { var r = countRowFor(kind, d.value), n = r ? Object.keys(r.counts || {}).length : 0; info.textContent = open && r === open && !r.finished_at ? 'You have a ' + lab.toLowerCase() + ' inventory in progress, started ' + dlong(open.count_date) + ', with ' + plural(n, 'item') + ' counted. Starting keeps going on it. Pick another date to start a new one.' : n ? 'There’s already a ' + lab.toLowerCase() + ' count for that day with ' + plural(n, 'item') + ' in it. Starting opens it so you can keep going.' : 'Every On hand box starts empty. The last count shows beside each item.'; clr.hidden = !n; }
  clr.addEventListener('click', function () { var r = countRowFor(kind, d.value); if (!r) return; r.counts = {}; r.finished_at = null; S.countDate = S.countDate || {}; S.countDate[kind] = d.value; m.close(); changed('Cleared. Start counting.'); render(); });
  d.addEventListener('change', paint);
  var m = modal('Start a new inventory · ' + lab, [fld('Count date', d), info], [clr, h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn accent', text: 'Start counting', on: { click: function () { if (!d.value) return; S.countDate = S.countDate || {}; S.countDate[kind] = d.value; var r = countRowFor(kind, d.value); if (r && r.finished_at) r.finished_at = null; m.close(); render(); toast('Counting ' + lab.toLowerCase() + ' for ' + dlong(d.value)); setTimeout(function () { var f = document.querySelector('.crow input'); if (f) f.focus(); }, 50); } } })]);
  paint();
}
PAGES['kitchen/count'] = function (el) {
  if (!S.data.items) return missing(el, 'the inventory');
  kindBar(el, true);
  var kind = S.kind, list = items(kind, S.sub), open = openCount(kind), date = open ? open.count_date : ((S.countDate || {})[kind] || iso());
  var last = (S.data.counts || []).filter(function (c) { return c.category === kind && c.finished_at && c !== open; }).sort(function (a, b) { return a.count_date < b.count_date ? 1 : -1; })[0] || null;
  function row() { var r = countRowFor(kind, date); if (!r) { r = { id: kind + ':' + date, category: kind, count_date: date, counts: {}, finished_at: null, counted_by: S.myName || '' }; S.data.counts.unshift(r); } return r; }
  var cur = open ? open.counts || {} : {};
  var prog = h('div', { cls: 'progress' }), bar = h('i'), lbl = h('span', { cls: 'num' });
  prog.appendChild(h('div', { cls: 'bar' }, bar)); prog.appendChild(lbl);
  prog.appendChild(h('button', { cls: 'btn accent small', text: 'Save inventory', on: { click: function () {
    var r = countRowFor(kind, date), n = r ? Object.keys(r.counts || {}).length : 0;
    if (!n) { toast('Count something first.'); return; }
    var miss = list.filter(function (it) { return r.counts[it.id] == null; }).length;
    var m = modal('Save the ' + KINDS.filter(function (k) { return k[0] === kind; })[0][1].toLowerCase() + ' inventory?', h('p', { text: miss ? plural(miss, 'item') + ' with no number yet keep last time’s count.' : 'Everything has a number.' }), [h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Keep counting', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn accent', text: 'Save inventory', on: { click: function () {
      if (last) list.forEach(function (it) { if (r.counts[it.id] == null && last.counts && last.counts[it.id] != null) r.counts[it.id] = last.counts[it.id]; });
      r.finished_at = new Date().toISOString(); if (S.countDate) delete S.countDate[kind]; m.close(); changed('Inventory saved — Order, Reports and the graph now use it'); render(); } } })]);
  } } }));
  function paintProg() { var n = list.filter(function (it) { return cur[it.id] != null && cur[it.id] !== ''; }).length; bar.style.width = (list.length ? n / list.length * 100 : 0) + '%'; lbl.textContent = n + ' of ' + list.length + ' counted'; }
  el.appendChild(h('div', { cls: 'toolbar' }, [h('button', { cls: 'btn', text: 'Start a new inventory', on: { click: startInventory } }), findBox(filter), h('span', { cls: 'fine', text: (open && !open.finished_at ? 'Inventory in progress · started ' + dlong(open.count_date) + ' · not finished until you press Save inventory' : open ? 'Reopened the count of ' + dlong(open.count_date) : 'New count · ' + dlong(date)) + (last ? ' · last saved count ' + dshort(last.count_date) : '') })]));
  el.appendChild(prog);
  var box = h('div', { cls: 'countlist' }); el.appendChild(box);
  var secs = {}; list.forEach(function (it) { (secs[it.section || 'Other'] = secs[it.section || 'Other'] || []).push(it); });
  Object.keys(secs).forEach(function (s) {
    var wrap = h('div', { 'data-sec': s }); wrap.appendChild(h('div', { cls: 'secthead' }, [s, h('span', { text: plural(secs[s].length, 'item') })]));
    secs[s].forEach(function (it) {
      var lv = last && last.counts && last.counts[it.id] != null ? last.counts[it.id] : null;
      var x = h('input', { type: 'text', inputmode: 'decimal', value: cur[it.id] != null ? qty(cur[it.id]) : '', 'aria-label': 'On hand: ' + nameOf(it) });
      if (x.value) x.classList.add('done');
      x.addEventListener('input', function () {
        var v = x.value.trim(), n = v === '' ? null : +v.replace(',', '.'); x.classList.toggle('bad', v !== '' && !isFinite(n)); if (v !== '' && !isFinite(n)) return;
        var r = row(); if (n == null) delete r.counts[it.id]; else r.counts[it.id] = n; cur = r.counts; open = r; S.dataVer = Date.now(); scheduleSync();
        x.classList.toggle('done', n != null); paintProg();
      });
      x.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); var all = [].slice.call(box.querySelectorAll('.crow:not([hidden]) input')), i = all.indexOf(x); if (all[i + 1]) all[i + 1].focus(); } });
      wrap.appendChild(h('div', { cls: 'crow', 'data-k': norm(nameOf(it) + ' ' + it.name + ' ' + it.vendor) }, [
        h('div', null, [h('b', { text: nameOf(it) }), h('div', { cls: 'meta', text: [it.pack, it.vendor].filter(Boolean).join(' · ') })]),
        h('div', { cls: 'last', html: lv != null ? 'Last: <b class="num">' + qty(lv) + '</b>' : 'Not counted before' }),
        h('div', null, [x, h('div', { cls: 'unit', text: unitText(it) })])
      ]));
    });
    box.appendChild(wrap);
  });
  function filter() { var q = norm(S.q); [].forEach.call(box.querySelectorAll('[data-sec]'), function (w) { var any = false; [].forEach.call(w.querySelectorAll('.crow'), function (r) { var on = !q || r.getAttribute('data-k').indexOf(q) !== -1; r.hidden = !on; if (on) any = true; }); w.hidden = !any; }); }
  filter(); paintProg();
  el.appendChild(h('p', { cls: 'fine', style: 'margin-top:14px', text: 'Counts save as you type, so you can count over several days and pick up where you left off — on any device, and in the Full sheet. Save inventory finishes the count; anything not counted keeps last time’s number. Order, Use first and Reports update from it straight away.' }));
};
PAGES['bar/count'] = PAGES['kitchen/count'];
/* Receive: "Scan an invoice" opens the same scanner as the full sheet */
function openScanner() { S.invSub = S.invSub || {}; var sp = S.space === 'bar' ? 'bar' : 'kitchen'; S.invSub[sp] = ''; go(sp, 'sheet'); var tries = 0; (function t() { var b = [].filter.call(document.querySelectorAll('.legacy button'), function (x) { return /^Scan invoice/.test(x.textContent.trim()); })[0]; if (b) b.click(); else if (++tries < 20) setTimeout(t, 150); })(); }
/* =====================================================================================
   THE REST OF THE LIVE SITE, embedded the same way: each page runs the live site's own code on
   the stand-in database (changes stay in this tab), inside the new layout.
   ===================================================================================== */
S.legSub = {};
function shareMore() {
  var map = { catering_inquiries: 'catering', time_off: 'timeoff', todos: 'todos', recipes: 'recipes', cocktail_builds: 'builds', temp_units: 'units', events: 'events' };
  if (S.mode !== 'live') Object.assign(map, { reviews: 'reviews', promo_campaigns: 'promos', temp_readings: 'temps', preshift_notes: 'preshift' });
  Object.keys(map).forEach(function (t) { if (Array.isArray(S.data[map[t]])) MEM.tables[t] = S.data[map[t]]; });
  if (S.mode !== 'live') { MEM.tables.eod_reports = (MEM.tables.eod_reports || []).concat((S.data.eod || []).filter(function (r) { return !(MEM.tables.eod_reports || []).some(function (x) { return x.report_date === r.report_date; }); })); MEM.tables.staff = [{ user_id: 'proto-user', name: S.myName || 'Sample owner', role: 'owner' }]; }
}
function legacyCtx(extra) { return Object.assign({ sb: payClient(), status: legacyStatus, role: role(), name: S.myName || 'Owner', uid: S.user && S.user.id, user: S.user }, extra || {}); }
function embed(el, title, run, note) {
  var box = h('div', { cls: 'legacy' }); el.appendChild(box); S.legacySeen = true;
  try { run(box); } catch (e) { box.appendChild(h('p', { cls: 'empty', text: 'Couldn’t open ' + title + ': ' + e.message })); if (window.console) console.warn(e); }
  if (note) el.appendChild(h('p', { cls: 'fine', style: 'margin-top:14px', text: note }));
}
var LIVE = {
  'service/preshift': ['Pre-shift meeting', function (b) { window.EdenPreshift.show(legacyCtx({ el: b, sec: null })); }, 'Education PDFs, tonight’s OpenTable reservations, menu changes and notes.'],
  'service/checklists': ['checklists', function (b) { var edit = S.legSub.checklists === 'edit'; b.parentNode.insertBefore(h('div', { cls: 'toolbar' }, [h('div', { cls: 'seg' }, [['', 'Today’s checklists'], ['edit', 'Edit checklists']].map(function (o) { return h('button', { 'aria-pressed': (S.legSub.checklists || '') === o[0] ? 'true' : 'false', text: o[1], on: { click: function () { S.legSub.checklists = o[0]; render(); } } }); }))]), b); if (edit) window.EdenChecklists.edit(legacyCtx({ el: b })); else window.EdenChecklists.show(legacyCtx({ el: b, mode: 'admin' })); }],
  'service/eod': ['End of day report', function (b) { var sub = S.legSub.eod || ''; b.parentNode.insertBefore(h('div', { cls: 'toolbar' }, [h('div', { cls: 'seg' }, [['', 'Tonight’s report'], ['past', 'Past reports']].concat(role() === 'owner' ? [['download', 'Download reports']] : []).map(function (o) { return h('button', { 'aria-pressed': sub === o[0] ? 'true' : 'false', text: o[1], on: { click: function () { S.legSub.eod = o[0]; render(); } } }); }))]), b); window.EdenEOD.show(legacyCtx({ el: b, sub: sub })); }, 'Emailing the tip shares only shows a note here.'],
  'service/resources': ['Resources', function (b) { window.EdenResources.show(legacyCtx({ el: b })); }, 'Uploading new PDFs needs the real site.'],
  'today/todo': ['To-do list', function (b) { window.EdenNotes.showTodo(legacyCtx({ el: b })); }],
  'catering/tools': ['Inquiries page', function (b) { window.EdenInquiries.show(legacyCtx({ el: b, canDelete: role() === 'owner' })); }, 'Questionnaire links, the message log, BEO documents and printing. Sending email only shows a note here.'],
  'kitchen/recipes': ['Recipes', function (b) { window.EdenRecipes.show(legacyCtx({ el: b, canEdit: isMgr(), costs: isMgr(), addMenuItem: invAddMenu, getMenu: function () { return { tabs: S.data.menuTree || [] }; } })); }, 'Writing and costing recipes from inventory prices, yields, and cocktail builds.'],
  'bar/builds': ['Cocktail builds', function (b) { window.EdenCocktails.mount({ sb: payClient(), status: legacyStatus, name: S.myName || 'Owner', canEdit: isMgr(), getMenu: function () { return { tabs: S.data.menuTree || [] }; } }, b); }, 'Drag ingredients to reorder them.'],
  'kitchen/temps': ['Temperatures', function (b) { var sub = S.legSub.temps || ''; b.parentNode.insertBefore(h('div', { cls: 'toolbar' }, [h('div', { cls: 'seg' }, [['', 'Now'], ['log', 'Printable log']].concat(role() === 'owner' ? [['setup', 'Set up units']] : []).map(function (o) { return h('button', { 'aria-pressed': sub === o[0] ? 'true' : 'false', text: o[1], on: { click: function () { S.legSub.temps = o[0]; render(); } } }); }))]), b); window.EdenTemps.show(legacyCtx({ el: b, sub: sub })); }, 'Live readings come from the Elitech loggers on the real site.'],
  'kitchen/ordering': ['Ordering list', function (b) { window.EdenOrders.show({ sb: payClient(), el: b, mode: 'admin' }); }, 'The list anyone can add to from the Hub.'],
  'menu/costs': ['Menu costs', function (b) { window.EdenMenuCost.show(legacyCtx({ el: b, getMenu: function () { return { tabs: S.data.menuTree || [] }; } })); }, 'Food from recipes, and wine, spirits, beer and cocktails from inventory, with pour sizes.'],
  'team/people': ['Employees page', function (b) { window.EdenSchedule.show(legacyCtx({ el: b, mode: 'people' })); }, 'Add and remove people, phone numbers, positions, Access (which Permissions column they’re in) and staff logins. Setting a temporary password only shows a note here.'],
  'team/fullsched': ['Schedule page', function (b) { window.EdenSchedule.show(legacyCtx({ el: b })); }, 'Everything the current schedule page does, including time-off decisions and the message board. Texting the team only shows a note here.'],
  'team/reviews': ['Reviews', function (b) { window.EdenReviews.show(legacyCtx({ el: b })); }, 'Every 3 months, with scheduled time vs Square clock-in times.'],
  'business/marketing': ['Promotional emails', function (b) { window.EdenPromo.show(legacyCtx({ el: b, sub: S.legSub.promo || '' })); }, 'Sending only shows a note here.'],
  'business/website': ['Analytics & History', function (b) { var sub = S.legSub.analytics || ''; b.parentNode.insertBefore(h('div', { cls: 'toolbar' }, [h('div', { cls: 'seg' }, [['', 'Website visits'], ['history', 'History of changes'], ['logins', 'Staff logins']].map(function (o) { return h('button', { 'aria-pressed': sub === o[0] ? 'true' : 'false', text: o[1], on: { click: function () { S.legSub.analytics = o[0]; render(); } } }); }))]), b); window.EdenAnalytics.show(legacyCtx({ el: b, sub: sub })); }],
  'business/partners': ['Partner stories', function (b) { window.EdenPartners.show(legacyCtx({ el: b })); }, 'The farms and producers on edencny.com.'],
  'business/email': ['Business email', function (b) { window.EdenMail.show(legacyCtx({ el: b, sub: S.legSub.email || '' })); }, 'Reading and sending mail needs the real site’s Google connection, so it can’t load here.']
};
Object.keys(LIVE).forEach(function (k) { var L = LIVE[k]; PAGES[k] = function (el) { embed(el, L[0], L[1], L[2]); }; });
/* Menu → Guest menu: print the menus, as the live site's Print menus button does */
(function () {
  var base = PAGES['menu/guest'];
  PAGES['menu/guest'] = function (el) {
    base(el);
    var tb = el.querySelector('.toolbar .chips'); if (!tb || !window.EdenMenuPrint) return;
    tb.insertBefore(h('button', { cls: 'btn small', text: 'Print menus', on: { click: function () { var m = { tabs: (S.data.menuTree || []).map(function (t) { return { id: t.id, label: t.label, groups: (t.groups || []).map(function (g) { return Object.assign({ id: g.id || pkey(g.title) }, g); }) }; }) }; try { window.EdenMenuPrint.choose(m); } catch (e) { toast('Couldn’t open printing: ' + e.message); } } } }), tb.firstChild);
  };
})();
/* links inside the live pages point at the old site's addresses: send each to its place here */
var LEGACY_ROUTES = { home: ['today', 'now'], todo: ['today', 'todo'], calendar: ['calendar', 'month'], preshift: ['service', 'preshift'], checklists: ['service', 'checklists'], eod: ['service', 'eod'], resources: ['service', 'resources'], catering: ['catering', 'tools'], prep: ['kitchen', 'prep'], recipes: ['kitchen', 'recipes'], temps: ['kitchen', 'temps'], orders: ['kitchen', 'ordering'], menu: ['menu', 'guest'], menucosts: ['menu', 'costs'], schedule: ['team', 'fullsched'], employees: ['team', 'people'], reviews: ['team', 'reviews'], promo: ['business', 'marketing'], analytics: ['business', 'website'], history: ['business', 'website'], partners: ['business', 'partners'], email: ['business', 'email'] };
window.addEventListener('hashchange', function () {
  var hsh = String(location.hash || '').replace('#', ''), p = hsh.split('/'), v = p[0], rest = p.slice(1).join('/');
  if (v === 'inventory') { var sp = S.space === 'bar' ? 'bar' : 'kitchen'; var cid = { food: 'food', beverages: 'bev', dry: 'paper' }[p[1]]; if (cid) return window.__invGo(cid); S.invSub = S.invSub || {}; S.invSub[sp] = ''; return go(sp, 'sheet'); }
  if (v === 'payroll') { S.paySub = rest === 'rates' ? 'rates' : rest === 'past' ? 'past' : 'week'; return go('business', 'payroll'); }
  if (v === 'financials') { S.paySub = 'overview'; return go('business', 'payroll'); }
  if (v === 'employees' && rest === 'permissions') return go('team', 'permissions');
  if (v === 'history') { S.legSub.analytics = 'history'; return go('business', 'website'); }
  var r = LEGACY_ROUTES[v]; if (!r) return;
  var key = { checklists: 'checklists', eod: 'eod', temps: 'temps', promo: 'promo', analytics: 'analytics', email: 'email' }[v]; if (key) S.legSub[key] = rest;
  go(r[0], r[1]);
});
/* =====================================================================================
   MENU EDITOR — the rest of the live editor: producer / farm, country, wine pairing for a dish
   (with the by-the-glass list), tonight's cuts priced by the ounce, section notes, the allergy
   note, and the Supper Club page.
   ===================================================================================== */
function glassWines() { var out = []; (S.data.menuTree || []).forEach(function (t) { if (!isWineTab(t)) return; (t.groups || []).forEach(function (g) { (g.items || []).forEach(function (w) { if (w && w.glass && !w.hidden) out.push(w.name + ' · $' + w.glass); }); }); }); return out; }
function menuItemForm(t, g, m, isNew, done) {
  var wine = isWineTab(t), food = !wine && /dinner|food|kitchen/i.test(t.id + ' ' + t.label);
  var f = { name: inp(m.name || '', { placeholder: 'What guests see' }), src: inp(m.src || '', { placeholder: wine ? 'Producer' : 'Farm or producer, e.g. Main Street Farms' }), desc: h('textarea', { rows: '2', placeholder: wine ? 'Tasting note (optional)' : 'Ingredients, as guests read them' }), price: inp(m.price, { inputmode: 'decimal', placeholder: '0' }), glass: inp(m.glass, { inputmode: 'decimal', placeholder: '0' }), bottle: inp(m.bottle, { inputmode: 'decimal', placeholder: '0' }), grape: inp(m.grape || '', { placeholder: 'e.g. Cabernet Franc' }), region: inp(m.appellation || '', { placeholder: 'e.g. Finger Lakes' }), country: inp(m.country || '', { placeholder: 'e.g. USA', list: 'ctryList' }), pair: inp(m.pair || '', { placeholder: 'A wine by the glass', list: 'pairList' }), pairPrice: inp(m.pairPrice || '', { inputmode: 'decimal', placeholder: '0' }), cut: h('input', { type: 'checkbox' }), section: sel(t.groups.map(function (x, i) { return [String(i), x.title || 'Section']; }), String(t.groups.indexOf(g))), hidden: h('input', { type: 'checkbox' }) };
  f.desc.value = m.desc || ''; f.hidden.checked = !!m.hidden; f.cut.checked = !!m.cut;
  f.pair.addEventListener('change', function () { var mm = f.pair.value.match(/^(.*) · \$(\d+(?:\.\d+)?)$/); if (mm) { f.pair.value = mm[1]; if (!f.pairPrice.value) f.pairPrice.value = mm[2]; } });
  var live = h('div', { cls: 'costline' }), msg = h('p', { cls: 'msg' });
  function paintCost() { var tmp = { name: f.name.value, price: f.price.value, glass: f.glass.value, bottle: f.bottle.value, inv_id: m.inv_id }; var c = costPct(t, tmp), it = invFor(tmp); live.innerHTML = ''; if (it) { live.appendChild(h('span', { text: 'Inventory: ' + nameOf(it) + ' · ' + money(it.cost) + ' / ' + (it.unit || 'each') })); if (c) live.appendChild(pctChip(c)); } else if (!food) live.appendChild(h('span', { cls: 'fine', text: 'Not matched to an inventory item yet — cost % shows once it is.' })); }
  [f.name, f.price, f.glass, f.bottle].forEach(function (x) { x.addEventListener('input', paintCost); }); paintCost();
  var el = h('div', { cls: 'form' }, [h('datalist', { id: 'pairList' }, glassWines().map(function (w) { return h('option', { value: w }); })), h('datalist', { id: 'ctryList' }, ['USA', 'France', 'Italy', 'Spain', 'Germany', 'Austria', 'Portugal', 'Argentina', 'Chile', 'Australia', 'New Zealand', 'South Africa'].map(function (c) { return h('option', { value: c }); })),
    fld(food && f.cut.checked ? 'Cut (name on the menu)' : 'Name', f.name), h('div', { cls: 'g2f' }, [fld(wine ? 'Producer' : 'Farm / producer', f.src), wine ? fld('Country', f.country) : fld('Section', f.section)]), fld(wine ? 'Note' : 'Description', f.desc),
    wine ? h('div', { cls: 'g2f' }, [fld('Glass price ($)', f.glass), fld('Bottle price ($)', f.bottle)]) : h('div', { cls: 'g2f' }, [fld(f.cut.checked ? 'Price per ounce ($)' : 'Price ($)', f.price), food ? h('label', { cls: 'check', style: 'margin-top:28px' }, [f.cut, ' Tonight’s cut, priced by the ounce']) : h('span')]),
    wine ? h('div', { cls: 'g2f' }, [fld('Grape', f.grape), fld('Region', f.region)]) : null,
    food ? h('div', { cls: 'g2f' }, [fld('Wine pairing', f.pair, 'Pick from the wines by the glass'), fld('Pairing price ($)', f.pairPrice)]) : null,
    live, h('div', { cls: 'g2f' }, [wine ? fld('Section', f.section) : h('span'), h('label', { cls: 'check' }, [f.hidden, ' Hidden from guests'])]), msg]);
  function save() {
    var name = f.name.value.trim(); if (!name) { msg.textContent = 'Give it a name.'; return; }
    var pr = wine ? [numv(f.glass), numv(f.bottle)] : [numv(f.price), numv(f.pairPrice)]; if (pr.some(function (x) { return x !== null && isNaN(x); })) { msg.textContent = 'Prices must be numbers.'; return; }
    m.name = name; m.desc = f.desc.value.trim(); m.hidden = f.hidden.checked; m.src = f.src.value.trim();
    if (wine) { m.glass = pr[0] == null ? '' : String(pr[0]); m.bottle = pr[1] == null ? '' : String(pr[1]); m.price = m.bottle || m.glass; m.grape = f.grape.value.trim(); m.appellation = f.region.value.trim(); m.country = f.country.value.trim(); }
    else { m.price = pr[0] == null ? '' : String(pr[0]); if (food) { m.pair = f.pair.value.trim(); m.pairPrice = pr[1] == null ? '' : String(pr[1]); if (f.cut.checked) m.cut = true; else delete m.cut; } }
    var to = t.groups[+f.section.value];
    if (isNew) to.items.push(m); else if (to !== g) { g.items.splice(g.items.indexOf(m), 1); to.items.push(m); }
    S.menuPending = (S.menuPending || 0) + 1; changed(isNew ? 'Added ' + name : 'Saved ' + name); done();
  }
  function del() { g.items.splice(g.items.indexOf(m), 1); S.menuPending = (S.menuPending || 0) + 1; changed('Removed ' + m.name); done(); }
  return { el: el, save: save, del: del };
}
/* section notes and the allergy note, added onto the guest menu editor */
(function () {
  var base = PAGES['menu/guest'];
  PAGES['menu/guest'] = function (el) {
    base(el);
    if (S.menuPreview || !S.data.menuTree) return;
    var tree = S.data.menuTree, cur = tree.filter(function (t) { return t.id === (S.menuTab || tree[0].id); })[0] || tree[0];
    [].forEach.call(el.querySelectorAll('.grid.g2 > .card'), function (card, gi) {
      var g = cur.groups[gi]; if (!g) return; var chips = card.querySelector('.card-h .chips');
      if (g.note || g.noteAfter) card.querySelector('.card-h > div').appendChild(h('p', { cls: 'fine', style: 'margin:4px 0 0', text: [g.note, g.noteAfter].filter(Boolean).join(' · ') }));
      if (chips) chips.insertBefore(h('button', { cls: 'btn small', text: 'Notes', title: 'A note above or below this section, e.g. “Add to any large plate: …”', on: { click: function () { var a = h('textarea', { rows: '2' }), b = h('textarea', { rows: '2' }); a.value = g.note || ''; b.value = g.noteAfter || ''; var mm = modal('Notes for ' + (g.title || 'this section'), [fld('Above the items', a), fld('Below the items', b, 'Add-ons written as “Add to any large plate: Chickpea butter 6 · Mushrooms 10” also go on the prep list')], [h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { mm.close(); } } }), h('button', { cls: 'btn accent', text: 'Save', on: { click: function () { g.note = a.value.trim(); g.noteAfter = b.value.trim(); S.menuPending = (S.menuPending || 0) + 1; mm.close(); changed('Section notes saved'); render(); } } })]); } } }), chips.firstChild);
    });
    var al = h('textarea', { rows: '2', placeholder: 'e.g. Please tell your server about any allergies.' }); al.value = S.data.menuAllergy || '';
    al.addEventListener('change', function () { S.data.menuAllergy = al.value.trim(); S.menuPending = (S.menuPending || 0) + 1; changed('Allergy note saved'); });
    el.appendChild(h('div', { cls: 'card', style: 'margin-top:16px' }, [h('h2', { text: 'Allergy note' }), h('p', { cls: 'sub', text: 'Shown at the bottom of every menu on the website and the printed menus.' }), al]));
  };
})();
/* MENU → SUPPER CLUB & EVENTS: the Supper Club page on edencny.com, plus what's coming up */
PAGES['menu/events'] = function (el) {
  var sp = S.data.supper = S.data.supper || { eyebrow: 'Eden Supper Club', title: '', date: '', intro: '', menuHeading: '', tier1: 'Pairing I', tier2: 'Pairing II', courses: [], resText: '', notes: [], ctaLabel: '', ctaUrl: '' };
  sp.courses = sp.courses || []; sp.notes = sp.notes || [];
  function bind(x, key, area, ph) { var e = area ? h('textarea', { rows: '3', placeholder: ph || '' }) : inp(x[key] || '', { placeholder: ph || '' }); if (area) e.value = x[key] || ''; e.addEventListener('change', function () { x[key] = e.value; S.menuPending = (S.menuPending || 0) + 1; changed(); }); return e; }
  el.appendChild(h('div', { cls: 'toolbar', style: 'justify-content:space-between' }, [h('p', { cls: 'fine', style: 'margin:0', text: 'Everything on the Supper Club page of edencny.com. Changes publish with the menu, a moment after you make them.' }), h('button', { cls: 'btn ' + (S.menuPending ? 'accent' : ''), disabled: !S.menuPending, text: S.menuPending ? 'Publish ' + plural(S.menuPending, 'change') : 'Published', on: { click: saveMenuNow } })]));
  var grid = h('div', { cls: 'grid g2' }); el.appendChild(grid);
  grid.appendChild(h('div', { cls: 'card form' }, [h('h2', { text: 'Top of page' }), fld('Small heading', bind(sp, 'eyebrow')), fld('Event title', bind(sp, 'title', false, 'e.g. Winter Solstice')), fld('Dates and times', bind(sp, 'date', false, 'e.g. Saturday, December 19 · 6:30 pm')), fld('Introduction', bind(sp, 'intro', true))]));
  grid.appendChild(h('div', { cls: 'card form' }, [h('h2', { text: 'Reservations' }), fld('Message', bind(sp, 'resText', true)), h('div', null, sp.notes.map(function (n, i) { var e = inp(n); e.addEventListener('change', function () { sp.notes[i] = e.value; changed(); }); return h('div', { style: 'display:flex;gap:6px;align-items:end' }, [fld('Detail ' + (i + 1), e), h('button', { cls: 'btn small', text: '✕', 'aria-label': 'Remove detail', on: { click: function () { sp.notes.splice(i, 1); changed(); render(); } } })]); })), h('button', { cls: 'btn small', text: '+ Add detail', on: { click: function () { sp.notes.push(''); render(); } } }), h('div', { cls: 'g2f' }, [fld('Button text', bind(sp, 'ctaLabel', false, 'Reserve')), fld('Button link', bind(sp, 'ctaUrl', false, 'OpenTable booking page'))])]));
  var cc = h('div', { cls: 'card form', style: 'margin-top:16px' }, [h('h2', { text: 'Courses' }), h('div', { cls: 'g2f' }, [fld('Menu heading', bind(sp, 'menuHeading')), h('div', { cls: 'g2f' }, [fld('First pairing label', bind(sp, 'tier1')), fld('Second pairing label', bind(sp, 'tier2'))])])]);
  sp.courses.forEach(function (c, i) { cc.appendChild(h('div', { cls: 'course' + (c.hidden ? ' off' : '') }, [h('div', { cls: 'g2f' }, [fld('Course', bind(c, 'name')), fld('Description', bind(c, 'desc'))]), h('div', { cls: 'g2f' }, [fld(sp.tier1 || 'First pairing', bind(c, 'w1')), fld(sp.tier2 || 'Second pairing', bind(c, 'w2'))]), h('div', { cls: 'chips' }, [h('button', { cls: 'btn small', text: c.hidden ? 'Show' : 'Hide', on: { click: function () { c.hidden = !c.hidden; changed(); render(); } } }), h('button', { cls: 'btn small', text: '↑', disabled: i === 0, on: { click: function () { sp.courses.splice(i - 1, 0, sp.courses.splice(i, 1)[0]); changed(); render(); } } }), h('button', { cls: 'btn small', text: '↓', disabled: i === sp.courses.length - 1, on: { click: function () { sp.courses.splice(i + 1, 0, sp.courses.splice(i, 1)[0]); changed(); render(); } } }), h('button', { cls: 'btn small danger', text: 'Remove', on: { click: function () { sp.courses.splice(i, 1); changed(); render(); } } })])])); });
  cc.appendChild(h('button', { cls: 'btn', text: '+ Add course', on: { click: function () { sp.courses.push({ name: '', desc: '', w1: '', w2: '' }); render(); } } }));
  el.appendChild(cc);
  var ev = (S.data.events || []).filter(function (e) { return /supper|other/.test(e.type || '') && e.date >= iso(); });
  el.appendChild(h('div', { cls: 'card', style: 'margin-top:16px' }, [h('h2', { text: 'Coming up on the calendar' }), ev.length ? h('div', { cls: 'list' }, ev.map(evRow)) : h('p', { cls: 'empty', text: 'None coming up.' })]));
};
/* stand-ins for the live database's functions the embedded pages call */
var RPCX = {
  order_list: function (a, real) {
    function list() { var it = MEM.tables.order_items || [], now = Date.now(); return { open: it.filter(function (o) { return !o.received_at; }).sort(function (x, y) { return x.added_at < y.added_at ? -1 : 1; }), received: it.filter(function (o) { return o.received_at && now - new Date(o.received_at) < 3 * 864e5; }).sort(function (x, y) { return x.received_at < y.received_at ? 1 : -1; }), can_receive: isMgr(), can_delete: isMgr(), me: S.myName || 'Owner' }; }
    if (real && !MEM.ordersLoaded) return real.rpc('order_list').then(function (r) { MEM.ordersLoaded = true; if (r.data && !r.data.error) MEM.tables.order_items = (r.data.open || []).concat(r.data.received || []); return { data: list(), error: null }; });
    return Promise.resolve({ data: list(), error: null });
  },
  order_add: function (a, real) { return RPCX.order_list({}, real).then(function () { (MEM.tables.order_items = MEM.tables.order_items || []).push({ id: uid(), item: String(a.p_item || '').trim(), qty: a.p_qty || '', note: a.p_note || '', added_by: a.p_by || S.myName || 'Owner', added_at: new Date().toISOString(), received_at: null, received_by: '' }); S.edits = (S.edits || 0) + 1; return RPCX.order_list({}, real); }); },
  order_receive: function (a, real) { (MEM.tables.order_items || []).forEach(function (o) { if (o.id === a.p_id) { o.received_at = a.p_on ? new Date().toISOString() : null; o.received_by = a.p_on ? (a.p_by || S.myName || 'Owner') : ''; } }); S.edits = (S.edits || 0) + 1; return RPCX.order_list({}, real); },
  order_delete: function (a, real) { var t = MEM.tables.order_items || []; for (var i = t.length - 1; i >= 0; i--) if (t[i].id === a.p_id) t.splice(i, 1); S.edits = (S.edits || 0) + 1; return RPCX.order_list({}, real); },
  employee_accounts: function (a, real) { if (real) return real.rpc('employee_accounts'); return Promise.resolve({ data: (S.data.employees || []).filter(function (e) { return e.email && e.login; }).map(function (e) { return { email: e.email, confirmed: true, last_sign_in_at: e.login === 'active' ? new Date(Date.now() - 2 * 864e5).toISOString() : null }; }), error: null }); },
  create_employee_login: function (a) { (S.data.employees || []).forEach(function (e) { if (String(e.email).toLowerCase() === String(a.p_email).toLowerCase()) e.login = 'created'; }); S.edits = (S.edits || 0) + 1; return Promise.resolve({ data: { ok: true }, error: null }); },
  reset_employee_password: function () { S.edits = (S.edits || 0) + 1; return Promise.resolve({ data: { ok: true }, error: null }); }
};
/* ORDERING — its own place: the shared order list (the same list as the Hub), and what's below par */
PAGES['ordering/list'] = function (el) { embed(el, 'order list', function (b) { window.EdenOrders.show({ sb: payClient(), el: b, mode: 'admin' }); }, 'It’s the same list the Hub shows on the screen in the restaurant: anyone can add to it there or here, and items are marked received on the Hub when they arrive.'); };
function parOrder(el, sp) { var keep = S.space; S.space = sp; try { PAGES['kitchen/order'](el); } finally { S.space = keep; } }
PAGES['ordering/kitchen'] = function (el) { parOrder(el, 'kitchen'); };
PAGES['ordering/bar'] = function (el) { parOrder(el, 'bar'); };
LEGACY_ROUTES.orders = ['ordering', 'list'];
/* =====================================================================================
   PRICE HISTORY — edit, add and delete entries from the item's panel (same fields as the
   live sheet's price history). Shared with the full sheet.
   ===================================================================================== */
function priceForm(it, p, isNew, done) {
  var hs = priceHist(it.id), newest = !hs.length || isNew || hs[0] === p, cu = it.unit || 'unit';
  var g = { date: inp(p.price_date || iso(), { type: 'date' }), vendor: inp(p.vendor || it.vendor || '', { list: 'venList2' }), line: inp(p.invoice_line || '', { placeholder: 'Name on the invoice' }), price: inp(p.invoice_price != null ? p.invoice_price : '', { inputmode: 'decimal', placeholder: '0.00' }), unit: inp(p.invoice_unit || it.order_unit || cu, { placeholder: 'case, bottle, lb…', list: 'unitList2' }), per: inp(p.per_unit != null ? p.per_unit : (it.per_case || 1), { inputmode: 'decimal' }), cost: inp(p.unit_cost != null ? p.unit_cost : '', { inputmode: 'decimal', placeholder: '0.00' }), also: h('input', { type: 'checkbox' }) };
  g.also.checked = newest;
  function recalc() { var pr = numv(g.price), pe = numv(g.per); if (pr != null && !isNaN(pr) && pe > 0) g.cost.value = String(Math.round(pr / pe * 10000) / 10000); }
  g.price.addEventListener('input', recalc); g.per.addEventListener('input', recalc);
  var msg = h('p', { cls: 'msg' });
  var el = h('div', { cls: 'form' }, [h('datalist', { id: 'venList2' }, uniq((S.data.items || []).map(function (x) { return x.vendor; }).filter(Boolean)).sort().map(function (v) { return h('option', { value: v }); })), h('datalist', { id: 'unitList2' }, ['case', 'bottle', 'each', 'lb', 'keg', 'box', 'bag', 'dozen', cu].map(function (v) { return h('option', { value: v }); })),
    h('div', { cls: 'g2f' }, [fld('Invoice date', g.date), fld('Vendor', g.vendor)]), fld('Invoice line', g.line),
    h('div', { cls: 'g3f' }, [fld('Invoice price ($)', g.price), fld('Per (invoice unit)', g.unit), fld('How many ' + cu + ' in 1', g.per)]),
    fld('Cost per ' + cu + ' ($)', g.cost, 'Worked out from the invoice price, or type it'), h('label', { cls: 'check' }, [g.also, newest ? ' Also make this the item’s cost now (the newest price)' : ' Also make this the item’s cost now']), msg]);
  function save() {
    var c = numv(g.cost), pr = g.price.value.trim() ? numv(g.price) : null, pe = numv(g.per);
    if (c == null || isNaN(c)) { msg.textContent = 'Cost should be a number.'; g.cost.focus(); return; }
    if (pr != null && isNaN(pr)) { msg.textContent = 'Invoice price should be a number.'; return; }
    Object.assign(p, { item_id: it.id, price_date: g.date.value || p.price_date || iso(), vendor: g.vendor.value.trim(), invoice_line: g.line.value.trim(), invoice_price: pr, invoice_unit: g.unit.value.trim(), per_unit: pe > 0 ? pe : null, unit_cost: c });
    if (isNew) { p.id = p.id || uid(); p.old_cost = hasCost(it) ? +it.cost : null; S.data.prices = S.data.prices || []; S.data.prices.push(p); }
    if (g.also.checked) it.cost = c;
    changed(isNew ? 'Price added' + (g.also.checked ? ' — it’s the cost now' : '') : 'Price entry saved' + (g.also.checked ? ' — it’s the cost now' : '')); done();
  }
  return { el: el, save: save };
}
function pricesTab(body, it, repaint) {
  var hs = priceHist(it.id), ed = isMgr();
  body.appendChild(h('div', { cls: 'chips', style: 'justify-content:space-between;align-items:center;margin-bottom:10px' }, [h('span', { cls: 'fine', text: hs.length ? plural(hs.length, 'price') + ' · now ' + (hasCost(it) ? money(it.cost) + ' / ' + (it.unit || 'each') : 'no cost') : 'No price history yet.' }), ed ? h('button', { cls: 'btn small accent', text: '+ Add a price', on: { click: function () { var p = {}; var fm = priceForm(it, p, true, function () { m.close(); repaint(); }); var m = modal('Enter a price · ' + nameOf(it), [h('p', { cls: 'fine', style: 'margin-top:0', text: 'Type it in the way it’s on the invoice. It goes into the price history like a scanned line.' }), fm.el], [h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn accent', text: 'Save price', on: { click: fm.save } })]); } } }) : null]));
  if (!hs.length) return;
  var ph = hs.slice().reverse(), psp = priceSpark(ph); psp.classList.add('clickable');
  psp.addEventListener('click', function () { openReport({ x: ph.map(function (p) { return p.price_date; }), xFmt: dshort, xName: 'Date', tipTitle: function (x) { return dlong(x); }, yFmt: function (v) { return money(v); }, auto: true, series: [{ name: 'Cost / ' + (it.unit || 'each'), color: COL.food, values: ph.map(function (p) { return +p.unit_cost; }) }], extraCols: [{ name: 'Vendor', get: function (i) { return ph[i].vendor || ''; } }, { name: 'Invoice line', get: function (i) { return ph[i].invoice_line || ''; } }] }, { title: nameOf(it) + ' — price history', sub: it.vendor || '', noTotal: true, source: 'From scanned invoices and prices entered by hand.' }); });
  body.appendChild(psp);
  body.appendChild(h('table', { cls: 't phist' }, [h('thead', null, h('tr', null, [h('th', { text: 'Date' }), h('th', { text: 'Vendor · invoice line' }), h('th', { cls: 'r', text: 'Invoice' }), h('th', { cls: 'r', text: 'Cost / ' + (it.unit || 'each') }), ed ? h('th') : null])), h('tbody', null, hs.map(function (p, i) {
    var prev = hs[i + 1], d = prev && +prev.unit_cost ? (+p.unit_cost - +prev.unit_cost) / +prev.unit_cost : null;
    return h('tr', null, [h('td', { text: dshort(p.price_date) }), h('td', null, [h('div', { text: p.vendor || '—' }), p.invoice_line ? h('small', { cls: 'fine', text: p.invoice_line }) : null]), h('td', { cls: 'r num', text: p.invoice_price != null && p.invoice_price !== '' ? money(p.invoice_price) + (p.invoice_unit ? ' / ' + p.invoice_unit : '') : '' }), h('td', { cls: 'r num' }, [money(p.unit_cost), d != null && Math.abs(d) >= 0.005 ? h('small', { cls: d > 0 ? 'up' : 'down', text: ' ' + (d > 0 ? '▲' : '▼') + Math.abs(d * 100).toFixed(0) + '%' }) : null]),
      ed ? h('td', { cls: 'r' }, h('button', { cls: 'btn small', text: 'Edit', on: { click: function () { var fm = priceForm(it, p, false, function () { m.close(); repaint(); }); var m = modal('Price from ' + dlong(p.price_date), fm.el, [h('button', { cls: 'btn danger', text: 'Delete this entry', on: { click: function () { var wasNewest = priceHist(it.id)[0] === p; S.data.prices.splice(S.data.prices.indexOf(p), 1); var nx = priceHist(it.id)[0]; if (wasNewest && nx && Math.abs(+it.cost - +p.unit_cost) < 0.0001) it.cost = +nx.unit_cost; m.close(); changed('Price entry deleted' + (wasNewest && nx ? ' — cost back to ' + money(nx.unit_cost) : '')); repaint(); } } }), h('span', { cls: 'sp' }), h('button', { cls: 'btn', text: 'Cancel', on: { click: function () { m.close(); } } }), h('button', { cls: 'btn accent', text: 'Save this entry', on: { click: fm.save } })]); } } })) : null]);
  }))]));
}
/* =====================================================================================
   SCHEDULE TIMES — every half hour, and the server out times from the old site:
   1st cut (counted as about 8pm), 2nd cut (about 9pm) and close (about 10pm).
   Saved the same way the old site saves them: end = 'cut1', 'cut2' or 'close'.
   ===================================================================================== */
var ENDS = { cut1: { label: '1st cut', at: '20:00' }, cut2: { label: '2nd cut', at: '21:00' }, close: { label: 'close', at: '22:00' } };
ROLES.forEach(function (r) { if (r[0] === 'Host') r[1] = '16:30'; });
function endMins(s) { var e = s && s.end; return !e ? mins(CLOSE_AT) : ENDS[e] ? mins(ENDS[e].at) : mins(e); }
function shiftHours(s) { return Math.max(0, (endMins(s) - mins(s.start)) / 60); }
function t12(t) { if (ENDS[t]) return ENDS[t].label; var m = mins(t), hh = Math.floor(m / 60), mm = m % 60; return (hh % 12 || 12) + (mm ? ':' + String(mm).padStart(2, '0') : '') + (hh < 12 ? 'a' : 'p'); }
function halfHours(from, to, keep) {
  var out = []; for (var m = from * 60; m <= to * 60; m += 30) { var v = String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); out.push([v, t12(v)]); }
  if (keep && !ENDS[keep] && /^\d\d:\d\d$/.test(keep) && !out.some(function (o) { return o[0] === keep; })) { out.push([keep, t12(keep)]); out.sort(function (a, b) { return a[0] < b[0] ? -1 : 1; }); }
  return out;
}
function shiftForm(sh, emps, done, del) {
  var endOpts = [['cut1', '1st cut (about 8pm)'], ['cut2', '2nd cut (about 9pm)'], ['close', 'Close (about 10pm)']].concat(halfHours(6, 23.5, sh.end).map(function (o) { return [o[0], o[1]]; }));
  var f = { emp: sel(emps.map(function (e) { return [e.id, e.name]; }), sh.emp), role: sel(ROLES.map(function (r) { return r[0]; }).concat(sh.role && !ROLES.some(function (r) { return r[0] === sh.role; }) ? [sh.role] : []), sh.role || 'Server'),
    start: sel(halfHours(6, 23.5, sh.start || '16:30'), sh.start || '16:30'), end: sel(endOpts, sh.end || 'close'), note: inp(sh.note || '', { placeholder: 'Optional — e.g. private party' }) };
  f.role.addEventListener('change', function () { var r = ROLES.filter(function (x) { return x[0] === f.role.value; })[0]; if (r) f.start.value = r[1]; });
  var warn = h('p', { cls: 'msg' });
  var el = h('div', { cls: 'form' }, [h('div', { cls: 'g2f' }, [fld('Who', f.emp), fld('Job', f.role)]), h('div', { cls: 'g2f' }, [fld('Starts', f.start), fld('Ends', f.end)]), fld('Note', f.note),
    h('p', { cls: 'fine', text: 'Server out times: 1st cut is counted as about 8pm, 2nd cut about 9pm and close about 10pm when hours are totaled.' }), warn]);
  function save() {
    if (!f.start.value) { warn.textContent = 'Pick a start time.'; return; }
    if (endMins({ end: f.end.value }) <= mins(f.start.value)) { warn.textContent = 'The shift ends before it starts.'; return; }
    sh.emp = f.emp.value; sh.role = f.role.value; sh.start = f.start.value; sh.end = f.end.value; sh.note = f.note.value.trim(); done();
  }
  return { el: el, save: save };
}

function resetEdits() {
  S.pay = {}; S._rates = null; S.prep = null; S.countDraft = {}; S.menuPending = 0; S.edits = 0; S.schedWeek = null; S.payWeek = null;
  (S.mode === 'live' ? loadLive() : Promise.resolve(loadSample())).then(function () { render(); toast('Back to how it was'); });
}

/* =====================================================================================
   SAVING — every change made on the redesigned pages is written to the same database the
   site has always used (the pages built from the old site's own code save themselves).
   Each table is compared with what was last loaded or saved, and only real changes are sent:
   new rows are added, changed columns are updated, and removed rows (prices, events) deleted.
   ===================================================================================== */
function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) { var r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); }); }
var SYNC = { snap: {}, cols: {}, busy: false, again: false, timer: null, failed: false, menuSnap: null, prepSnap: null };
var TABLES = [
  { t: 'inventory_items', k: 'items', key: 'id', ins: true, del: false, base: ['id', 'category', 'section', 'name', 'unit', 'pack', 'vendor', 'par', 'cost', 'sort', 'active'] },
  { t: 'inventory_counts', k: 'counts', key: 'id', ins: true, del: false, base: ['id', 'category', 'count_date', 'counts', 'counted_by'] },
  { t: 'inventory_prices', k: 'prices', key: 'id', ins: true, del: true, base: ['id', 'item_id', 'price_date', 'vendor', 'invoice_line', 'invoice_price', 'invoice_unit', 'per_unit', 'unit_cost', 'old_cost'] },
  { t: 'events', k: 'events', key: 'id', ins: true, del: true, base: ['id', 'title', 'type', 'date', 'all_day', 'start', 'end', 'room', 'guests', 'notes', 'source', 'beo_id', 'created_by'] },
  { t: 'catering_inquiries', k: 'catering', key: 'id', ins: false, del: false, base: [] },
  { t: 'schedule_weeks', k: 'weeks', key: 'week_start', ins: true, del: false, base: ['week_start', 'shifts', 'status', 'published', 'published_at', 'sent'] }
];
function colsFor(T) { var rows = S.data[T.k] || [], c = {}; T.base.forEach(function (x) { c[x] = 1; }); rows.forEach(function (r) { if (r && r.__db) Object.keys(r.__db).forEach(function (x) { c[x] = 1; }); }); return c; }
function rowOut(T, r) {
  var c = SYNC.cols[T.t], o = {};
  if (T.t === 'catering_inquiries' && r.notes !== undefined) r.staff_note = r.notes || '';
  Object.keys(r).forEach(function (k) { if (k.charAt(0) === '_' || !c[k]) return; var v = r[k]; o[k] = v === undefined ? null : v; });
  return o;
}
function snapshotAll() {
  TABLES.forEach(function (T) {
    var rows = S.data[T.k]; if (!Array.isArray(rows)) return;
    rows.forEach(function (r) { if (r && !r.__db) Object.defineProperty(r, '__db', { value: Object.assign({}, r), enumerable: false, writable: true }); });
    SYNC.cols[T.t] = colsFor(T); var m = SYNC.snap[T.t] = {};
    rows.forEach(function (r) { if (r && r[T.key] != null) m[r[T.key]] = JSON.stringify(rowOut(T, r)); });
  });
  SYNC.menuSnap = menuDocs(); SYNC.prepSnap = S.prep ? JSON.stringify({ extra: S.prep.extra, removed: S.prep.removed, for_date: S.prep.for_date }) : null;
}
function changed(what) { S.dataVer = Date.now(); if (what) toast(what); scheduleSync(); }
function scheduleSync(ms) { SYNC.pending = true; clearTimeout(SYNC.timer); SYNC.timer = setTimeout(runSync, ms == null ? 700 : ms); saveDot('Saving…'); }
function saveDot(t, bad) { var d = document.querySelector('.savestate'); if (d) { d.textContent = t; d.classList.toggle('bad', !!bad); } }
function fixText(old, nv) { return nv == null && typeof old === 'string' ? '' : nv; }
function runSync() {
  if (SYNC.busy) { SYNC.again = true; return; }
  SYNC.busy = true; var jobs = [], errs = [];
  TABLES.forEach(function (T) {
    var rows = S.data[T.k]; if (!Array.isArray(rows) || !SYNC.snap[T.t]) return;
    var snap = SYNC.snap[T.t], seen = {};
    rows.forEach(function (r) {
      if (!r || r[T.key] == null) return; var id = r[T.key]; seen[id] = 1;
      var out = rowOut(T, r), s = JSON.stringify(out);
      if (snap[id] === s) return;
      if (snap[id] == null) {
        if (!T.ins) return;
        if (T.t === 'schedule_weeks' && !(r.shifts || []).length) return;
        jobs.push(sb.from(T.t).upsert(out, { onConflict: T.key, ignoreDuplicates: T.t === 'schedule_weeks' }).then(function (x) { if (x.error) { errs.push(T.t + ': ' + x.error.message); return; } snap[id] = s; if (!r.__db) Object.defineProperty(r, '__db', { value: out, enumerable: false, writable: true }); }));
      } else {
        var was = JSON.parse(snap[id]), diff = {}, n = 0;
        Object.keys(out).forEach(function (k) { if (JSON.stringify(was[k]) !== JSON.stringify(out[k])) { diff[k] = fixText(was[k], out[k]); n++; } });
        if (!n) { snap[id] = s; return; }
        if (T.t === 'schedule_weeks' && diff.published && out.status === 'published') diff.published_at = r.published_at = new Date().toISOString();
        jobs.push(sb.from(T.t).update(diff).eq(T.key, id).then(function (x) { if (x.error) { errs.push(T.t + ': ' + x.error.message); return; } snap[id] = JSON.stringify(rowOut(T, r)); }));
      }
    });
    if (T.del) Object.keys(snap).forEach(function (id) { if (!seen[id]) jobs.push(sb.from(T.t).delete().eq(T.key, id).then(function (x) { if (x.error) { errs.push(T.t + ': ' + x.error.message); return; } delete snap[id]; })); });
  });
  var md = menuDocs(); if (md && SYNC.menuSnap && md.sig !== SYNC.menuSnap.sig) jobs.push(saveMenu(md).catch(function (e) { errs.push('menu: ' + (e && e.message || e)); }));
  if (S.prep) jobs.push(syncPrep().catch(function (e) { errs.push('prep list: ' + (e && e.message || e)); }));
  Promise.all(jobs.map(function (j) { return Promise.resolve(j).catch(function (e) { errs.push(String(e && e.message || e)); }); })).then(function () {
    SYNC.busy = false;
    if (errs.length) { SYNC.failed = true; saveDot('Couldn’t save — retrying', true); toast('Couldn’t save: ' + errs[0] + (/permission|policy|row-level/i.test(errs[0]) ? ' (your login isn’t allowed to change that)' : '')); clearTimeout(SYNC.timer); SYNC.timer = setTimeout(runSync, 8000); }
    else { SYNC.failed = false; if (!SYNC.again) SYNC.pending = false; saveDot('Saved'); }
    if (SYNC.again) { SYNC.again = false; runSync(); }
  });
}
/* the menu: the same documents the site has always written (site/menu, one per section, site/supper) */
function menuDocs() {
  var tree = S.data.menuTree; if (!tree) return null;
  var meta = { version: 2, allergy: S.data.menuAllergy || '', tabs: [] }, groups = {};
  tree.forEach(function (t) { var gids = []; (t.groups || []).forEach(function (g) { if (!g.id) g.id = 'g' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); gids.push(g.id); groups[g.id] = { title: g.title || '', note: g.note || '', noteAfter: g.noteAfter || '', items: (g.items || []).filter(Boolean) }; }); meta.tabs.push({ id: t.id, label: t.label, gids: gids }); });
  var gsig = {}; Object.keys(groups).forEach(function (k) { gsig[k] = JSON.stringify(groups[k]); });
  var sup = S.data.supper ? JSON.stringify(S.data.supper) : null;
  return { meta: meta, groups: groups, gsig: gsig, metaSig: JSON.stringify(meta), sup: sup, sig: JSON.stringify(meta) + JSON.stringify(gsig) + (sup || '') };
}
function saveMenu(md) {
  var was = SYNC.menuSnap, rows = [], gone = [];
  Object.keys(md.groups).forEach(function (id) { if (!was || was.gsig[id] !== md.gsig[id]) rows.push({ path: 'site/menu/groups/' + id, data: md.groups[id] }); });
  if (was) Object.keys(was.gsig).forEach(function (id) { if (!md.groups[id]) gone.push('site/menu/groups/' + id); });
  if (md.sup && (!was || was.sup !== md.sup)) rows.push({ path: 'site/supper', data: S.data.supper });
  function ok(r) { if (r.error) throw r.error; return r; }
  var meta = Object.assign({}, md.meta, { updatedAt: Date.now() });
  return (rows.length ? sb.from('site_docs').upsert(rows, { onConflict: 'path' }).then(ok) : Promise.resolve())
    .then(function () { return (!was || was.metaSig !== md.metaSig) ? sb.from('site_docs').upsert([{ path: 'site/menu', data: meta }], { onConflict: 'path' }).then(ok) : null; })
    .then(function () { return gone.length ? sb.from('site_docs').delete().in('path', gone).then(ok) : null; })
    .then(function () { SYNC.menuSnap = md; S.menuPending = 0; [].forEach.call(document.querySelectorAll('.menupub'), function (b) { b.textContent = 'Published'; b.disabled = true; b.classList.remove('accent'); }); });
}
function saveMenuNow() { scheduleSync(0); toast('Publishing to edencny.com…'); }
/* the prep list: the same shared list as the staff page and the Hub, through its own database functions */
function prepState() {
  if (!S.prep) { var L = S.data.prepLive || {}; S.prep = { for_date: L.for_date || nextOpen(iso()), entries: JSON.parse(JSON.stringify(L.entries || {})), extra: JSON.parse(JSON.stringify(L.extra || {})), removed: JSON.parse(JSON.stringify(L.removed || {})), can_delete: !!L.can_delete, can_reset: !!L.can_reset }; SYNC.prepSnap = JSON.stringify({ extra: S.prep.extra, removed: S.prep.removed, for_date: S.prep.for_date }); }
  return S.prep;
}
function pset(k, f, v) { var e = pentry(k); e[f] = v; e.at = new Date().toISOString(); sb.rpc('prep_set', { p_key: k, p_field: f, p_value: String(v) }).then(function (r) { if (r.error || (r.data && r.data.error)) toast('Couldn’t save that line: ' + ((r.error && r.error.message) || r.data.error)); }); }
function myInitials() { return initials(S.myName || 'Eden'); }
function syncPrep() {
  var st = S.prep, was = SYNC.prepSnap ? JSON.parse(SYNC.prepSnap) : { extra: {}, removed: {}, for_date: st.for_date }, calls = [];
  function rpc(n, a) { return sb.rpc(n, a).then(function (r) { if (r.error || (r.data && r.data.error)) throw new Error((r.error && r.error.message) || r.data.error); return r; }); }
  if (was.for_date !== st.for_date) return rpc('prep_reset').then(function () { return sb.rpc('prep_get'); }).then(function (r) { if (r.data && !r.data.error) { S.data.prepLive = r.data; S.prep = null; prepState(); render(); } });
  Object.keys(st.extra || {}).forEach(function (sec) { (st.extra[sec] || []).forEach(function (n) { if ((was.extra[sec] || []).indexOf(n) === -1) calls.push(rpc('prep_extra', { p_section: sec, p_name: n, p_add: true })); }); });
  Object.keys(was.extra || {}).forEach(function (sec) { (was.extra[sec] || []).forEach(function (n) { if ((st.extra[sec] || []).indexOf(n) === -1) calls.push(rpc('prep_extra', { p_section: sec, p_name: n, p_add: false })); }); });
  var nowR = Object.keys(st.removed || {}), wasR = Object.keys(was.removed || {});
  if (wasR.some(function (k) { return nowR.indexOf(k) === -1; }) && !nowR.length) calls.push(rpc('prep_hide', { p_key: null, p_on: false }));
  nowR.forEach(function (k) { if (wasR.indexOf(k) === -1) calls.push(rpc('prep_hide', { p_key: k, p_on: true })); });
  return Promise.all(calls).then(function () { SYNC.prepSnap = JSON.stringify({ extra: st.extra, removed: st.removed, for_date: st.for_date }); });
}
/* catering: an Active BEO keeps its own event on the calendar, as on the old site; declined or spam takes it off */
var _moveInq = moveInq;
moveInq = function (x, st, msg) { var was = cstatus(x); _moveInq(x, st, msg); if ((st === 'declined' || st === 'spam') && was !== st) { S.data.events = (S.data.events || []).filter(function (e) { return !(e.beo_id === x.id && e.source === 'beo'); }); scheduleSync(); } };
/* a new event: the same columns the calendar always used */
var _openEvent = openEvent;
openEvent = function (e, onDate, after) { _openEvent(e, onDate, function () { (S.data.events || []).forEach(function (x) { if (x.start == null) x.start = ''; if (x.end == null) x.end = ''; if (!x.source) x.source = 'manual'; if (x.created_by == null) x.created_by = S.myName || ''; }); if (after) after(); }); };

/* =====================================================================================
   SIGNING IN — the same accounts and rules as before: owner, manager, kitchen; a manager on the
   schedule only (Access = Manager) gets the team pages; the Hub's login goes to the Hub.
   ===================================================================================== */
function authScreen(kids) { root.innerHTML = ''; root.appendChild(h('div', { cls: 'gate' }, [h('div', { cls: 'gate-art' }, [h('div', { cls: 'brand' }, ['EDEN', h('small', { text: 'STAFF' })]), h('div', null, [h('h2', { text: 'Everything the restaurant runs on, in one place.' }), h('p', { text: 'Sign in with your staff account.' })]), h('p', { cls: 'fine', style: 'color:rgba(243,238,229,.6)', text: '118 E. Genesee St., Syracuse' })]), h('div', { cls: 'gate-side' }, h('div', { cls: 'gate-card' }, kids))])); }
function showSignIn(note) {
  var email = h('input', { type: 'email', autocomplete: 'username', placeholder: 'you@edencny.com' }), pw = h('input', { type: 'password', autocomplete: 'current-password' }), msg = h('p', { cls: 'msg', text: note || '' });
  var go = h('button', { cls: 'btn primary wide', type: 'submit', text: 'Sign in' });
  var form = h('form', { on: { submit: function (e) { e.preventDefault(); if (!email.value.trim() || !pw.value) { msg.textContent = 'Enter your email and password.'; return; } msg.textContent = 'Signing in…'; go.disabled = true; if (window.EdenAccount) window.EdenAccount.markSignIn(); sb.auth.signInWithPassword({ email: email.value.trim(), password: pw.value }).then(function (r) { go.disabled = false; if (r.error) msg.textContent = /rate|too many/i.test(r.error.message || '') ? 'Too many attempts. Try again in a few minutes.' : /not confirmed/i.test(r.error.message || '') ? 'This account still needs its confirmation email. Ask a manager to switch it on.' : 'That email and password don’t match.'; }); } } }, [h('label', { cls: 'field' }, [h('span', { text: 'Email' }), email]), h('label', { cls: 'field' }, [h('span', { text: 'Password' }), pw]), msg, go,
    h('button', { type: 'button', cls: 'btn wide', style: 'margin-top:8px', text: 'Forgot your password?', on: { click: function () { if (!email.value.trim()) { msg.textContent = 'Enter your email above first.'; return; } msg.textContent = 'Sending…'; sb.auth.resetPasswordForEmail(email.value.trim(), { redirectTo: location.origin + location.pathname }).then(function (r) { msg.textContent = r.error ? 'Could not send the email. Try again in a minute.' : 'If that address has a staff account, a reset link is on its way.'; }); } } })]);
  authScreen([h('h1', { text: 'Sign in' }), form, h('p', { cls: 'fine', style: 'margin-top:18px', html: 'Employees: your schedule is on the <a href="team/">staff page</a>.' })]);
  setTimeout(function () { email.focus(); }, 50);
}
function showNewPassword(text) {
  var form = h('form', { novalidate: true }, [h('p', { text: text }), h('label', { cls: 'field' }, [h('span', { text: 'New password' }), h('input', { type: 'password', name: 'password', autocomplete: 'new-password', minlength: '10' })]), h('label', { cls: 'field' }, [h('span', { text: 'Repeat it' }), h('input', { type: 'password', name: 'password2', autocomplete: 'new-password', minlength: '10' })]), h('p', { cls: 'msg', role: 'status' }), h('button', { cls: 'btn primary wide', type: 'submit', text: 'Save password' })]);
  authScreen([h('h1', { text: 'Choose a password' }), form]);
  window.EdenAccount.choose(sb, form, function () { AUTH.recovering = false; history.replaceState(null, '', location.pathname); enterApp(); });
}
var AUTH = { session: null, recovering: /type=recovery/.test(location.hash), entered: null };
var ROLE_MAP = { owner: 'owner', manager: 'manager', scheduler: 'manager', kitchen: 'kitchen', foh: 'foh' };
function enterApp() {
  var s = AUTH.session; if (!s) return showSignIn();
  authScreen([h('p', { cls: 'fine', text: 'Checking your access…' })]);
  window.EdenAccount.mustChange(sb).then(function (must) {
    if (must) return showNewPassword('A manager set a temporary password for you. Choose your own to continue (at least 10 characters).');
    sb.rpc('staff_role').then(function (r) {
      if (r.error) { authScreen([h('p', { cls: 'msg', text: 'Couldn’t reach the database. Check your connection and reload.' })]); return; }
      var live = r.data || null;
      if (live === 'hub') { location.replace('hub/'); return; }
      var tier = live ? Promise.resolve(null) : sb.rpc('team_me').then(function (t) { return t && !t.error ? t.data : null; }, function () { return null; });
      tier.then(function (me) {
        if (!live && me && me.access === 'manager') live = 'scheduler';
        if (!live) { authScreen([h('h1', { text: 'This is the managers’ site' }), h('p', { text: 'You’re signed in as ' + (s.user && s.user.email) + '. Your schedule and the team message board are on the staff page.' }), h('a', { cls: 'btn primary wide', href: 'team/', text: 'Open the staff page' }), h('button', { cls: 'btn wide', style: 'margin-top:8px', text: 'Sign out', on: { click: function () { sb.auth.signOut(); } } })]); return; }
        S.liveRole = live; S.role = ROLE_MAP[live] || 'foh'; S.isScheduler = live === 'scheduler'; S.user = s.user; S.mode = 'live';
        document.body.classList.toggle('is-owner', S.role === 'owner');
        var nameP = live === 'scheduler' ? Promise.resolve({ data: { name: me && me.employee && me.employee.name } }) : sb.from('staff').select('name').eq('user_id', s.user.id).maybeSingle();
        nameP.then(function (n) {
          S.myName = (n && n.data && n.data.name) || (s.user && s.user.email);
          authScreen([h('p', { cls: 'fine', text: 'Loading…' })]);
          loadAll().then(function () {
            S.role = ROLE_MAP[live] || 'foh'; AUTH.entered = s.user.id;
            try { window.EdenAccount.visit(sb, 'admin'); } catch (e) {}
            try { if (window.EdenNotes) window.EdenNotes.init({ sb: sb, status: legacyStatus, name: S.myName, canCal: isMgr(), canShare: isMgr(), canMail: S.role === 'owner' || S.role === 'manager', canRecipes: isMgr(), isOwner: S.role === 'owner' }); } catch (e) {}
            start();
            var hsh = String(location.hash || '').replace('#', '').split(/[\/]/)[0];
            if (hsh && !SPACES.some(function (x) { return location.hash.replace('#', '').split('-')[0] === x.id; })) window.dispatchEvent(new HashChangeEvent('hashchange'));
          });
        });
      });
    });
  });
}
function loadAll() {
  return loadLive().then(function () {
    (S.data.catering || []).forEach(function (x) { if (x.notes === undefined) x.notes = x.staff_note || ''; });
    return sb.rpc('prep_get').then(function (r) { S.data.prepLive = r.data && !r.data.error ? r.data : null; S.prep = null; }, function () {});
  }).then(function () { if (S.data.prepLive) prepState(); snapshotAll(); S.lastLoad = Date.now(); });
}
/* after using a page built from the old site's code, the redesigned pages reload what it may have changed */
function refreshIfNeeded() {
  if (!S.legacySeen || SYNC.busy || SYNC.pending) return;
  S.legacySeen = false;
  loadAll().then(function () { render(); });
}
function accountMenu() {
  var m = modal(S.myName || 'Account', [h('p', { cls: 'fine', text: (S.user && S.user.email || '') + ' · ' + ({ owner: 'Owner', manager: 'Manager', scheduler: 'Manager (schedule)', kitchen: 'Kitchen', foh: 'Front of house' }[S.liveRole] || S.liveRole) }),
    h('div', { cls: 'chips', style: 'flex-direction:column;align-items:stretch;gap:8px' }, [h('button', { cls: 'btn', text: 'Change password', on: { click: function () { m.close(); window.EdenAccount.change(sb); } } }), h('a', { cls: 'btn', href: './', text: 'Open the usual layout' }), h('a', { cls: 'btn', href: 'team/', text: 'Open the staff page' }), h('button', { cls: 'btn danger', text: 'Sign out', on: { click: function () { m.close(); sb.auth.signOut().then(function () { location.replace(location.pathname); }); } } })])]);
}
LEGACY_ROUTES.beos = ['catering', 'beos']; LEGACY_ROUTES.inquiries = ['catering', 'pipeline'];
function boot() {
  try { if (localStorage.getItem('eden-debug')) { window.__S = S; window.__SYNC = SYNC; } } catch (e) {}
  if (!sb) { root.innerHTML = '<p style="padding:40px">Couldn’t load the sign-in service. Check your internet connection and reload.</p>'; return; }
  sb.auth.onAuthStateChange(function (event, s) {
    AUTH.session = s;
    if (event === 'PASSWORD_RECOVERY') { AUTH.recovering = true; showNewPassword('Choose a new password (at least 10 characters).'); return; }
    if (event === 'SIGNED_OUT' || !s) { AUTH.entered = null; showSignIn(); return; }
    if (event === 'SIGNED_IN' || event === 'INITIAL_SESSION') {
      if (AUTH.recovering) { showNewPassword('Choose a new password (at least 10 characters).'); return; }
      if (AUTH.entered && s.user && AUTH.entered === s.user.id) return;
      setTimeout(enterApp, 0);
    }
  });
  // a safety net: anything changed without going through changed() is still saved within a few seconds
  setInterval(function () { if (S.mode === 'live' && SYNC.snap.inventory_items && !SYNC.busy && !SYNC.pending) runSync(); }, 4000);
  document.addEventListener('visibilitychange', function () { if (document.visibilityState === 'hidden' && SYNC.snap.inventory_items) { clearTimeout(SYNC.timer); runSync(); } });
  window.addEventListener('beforeunload', function (e) { if (SYNC.pending || SYNC.busy) { clearTimeout(SYNC.timer); runSync(); e.preventDefault(); e.returnValue = ''; } });
}

boot();
})();
