/* Eden staff site: what every menu item costs to make.
 *
 *   Food       from recipes. A recipe's ingredients are linked to inventory items (or to other recipes, like a sauce),
 *              so the recipe has a cost; a recipe is connected to the menu items it goes into, with how much of it
 *              goes on one plate (1 portion, 3 oz…). A plate's cost is all of its recipes added up.
 *   Cocktails  from Recipes → Cocktail builds (each spirit linked to an inventory item).
 *   Wine, beer, spirits, soft drinks
 *              from the inventory item each is sold as (js/inventory-costing.js: 5 oz glass, 1.5 oz pour, pints…).
 *
 * Used by the Recipes tab (costs and menu links on each recipe) and the Menu costs page (#menucosts).
 * Data: inventory_items, recipes (menu_links: supabase/recipe-costing.sql), cocktail_builds, inventory_settings.
 */
(function () {
  'use strict';
  var ML_OZ = 29.5735;
  // amounts in a common base: ml for volume, g for weight
  var VOL = { tsp: 4.92892, tbsp: 14.7868, 'fl oz': 29.5735, floz: 29.5735, cup: 236.588, cups: 236.588, pt: 473.176, pint: 473.176, qt: 946.353, quart: 946.353, gal: 3785.41, gallon: 3785.41, ml: 1, l: 1000, lt: 1000, liter: 1000, litre: 1000 };
  var WT = { oz: 28.3495, lb: 453.592, lbs: 453.592, '#': 453.592, g: 1, kg: 1000, gram: 1, grams: 1 };
  // Yields: part of a whole item a recipe calls for, costed from the whole. 1 white, 1 yolk or the juice of 1 lemon = 1 of the whole;
  // by weight or volume, the amount ÷ what one whole gives. Volumes and weights count about the same (1 ml ≈ 1 g).
  // Defaults from USDA FoodData Central (large egg: white 33 g, yolk 17 g; juice of 1 lemon 48 g, 1 lime 44 g).
  // Owners and managers change them on Menu costs → Costing calculations (saved in inventory_settings.yields).
  var YIELDS_DEFAULT = [
    { part: 'Egg white', words: 'egg white, white', from: 'egg', qty: 33, unit: 'g' },
    { part: 'Egg yolk', words: 'egg yolk, yolk', from: 'egg', qty: 17, unit: 'g' },
    { part: 'Lemon juice', words: 'lemon juice', from: 'lemon', qty: 48, unit: 'g' },
    { part: 'Lime juice', words: 'lime juice', from: 'lime', qty: 44, unit: 'g' }
  ];
  var YIELDS = YIELDS_DEFAULT.slice();
  function sing(t) { return norm(t).split(' ').map(function (w) { return w.length > 3 ? w.replace(/(es|s)$/, function (m) { return /(ch|sh|x)es$/.test(w) ? '' : m === 'es' ? 'e' : ''; }) : w; }).join(' '); }
  function has(text, phrase) { var t = ' ' + sing(text) + ' ', p = sing(phrase); return !!p && t.indexOf(' ' + p + ' ') >= 0; }
  // the whole item (Eggs, Lemons), not a part of it someone sells (liquid egg whites, bottled lemon juice)
  function isWhole(it, from) {
    var n = (it.ingredient || '') + ' ' + it.name;
    if (!has(n, from) || /\b(liquid|powder|dried|bottled|frozen)\b/.test(norm(n))) return false;
    return !YIELDS.some(function (y) { return norm(y.from) === norm(from) && String(y.words || y.part).split(',').some(function (w) { return w.trim() && has(n, w.trim()); }); });
  }
  function yieldFor(ing, it) {
    var n = (it.ingredient || '') + ' ' + it.name;
    for (var i = 0; i < YIELDS.length; i++) {
      var y = YIELDS[i], words = String(y.words || y.part).split(',').map(function (w) { return w.trim(); }).filter(Boolean);
      if (!isWhole(it, y.from)) continue;   // costed from the whole (not bottled juice or liquid whites)
      if (words.some(function (w) { return has(ing.item, w); })) return y;
    }
    return null;
  }
  // the costing calculations a recipe search matches ("yolk" → Egg yolk), each with the whole items it can come from
  function yieldOptions(q) {
    var w = sing(q).split(' ').filter(Boolean); if (!w.length) return [];
    var out = [];
    YIELDS.forEach(function (y) {
      var words = String(y.words || y.part).split(',').map(function (x) { return x.trim(); }).filter(Boolean);
      var hay = ' ' + sing(y.part + ' ' + words.join(' ')) + ' ';
      if (!w.every(function (t) { return hay.indexOf(' ' + t) >= 0; })) return;
      D.inv.forEach(function (it) {
        if (it.active === false || it.category === 'paper') return;
        if (isWhole(it, y.from)) out.push({ y: y, it: it });
      });
    });
    return out;
  }
  // how many wholes an amount takes: "3" = 3, "100 g" of whites ÷ 33 g = 3.03, "2 tbsp" of lemon juice ÷ 48 g
  function wholesFor(q, u, y) {
    var d = dim(u), yd = dim(y.unit), per = +y.qty;
    if (d === 'each') return q;
    if (d === 'dozen') return q * 12;
    if ((d === 'wt' || d === 'vol') && (yd === 'wt' || yd === 'vol') && per > 0) return base(q, ozAs(u, d === 'vol' ? 'vol' : 'wt')) / base(per, ozAs(y.unit, yd === 'vol' ? 'vol' : 'wt'));
    return null;
  }
  var EACH = /^(each|ea|ct|count|pc|pcs|piece|pieces|egg|eggs|clove|cloves|head|heads|bunch|bunches|sprig|sprigs|portion|portions|serving|servings|plate|plates|slice|slices|leaf|leaves|unit|units)$/;
  var TARGET = { food: 0.30, bar: 0.22, wine: 0.33, beer: 0.28, spirits: 0.22, coffee: 0.20 };

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function u0(u) { return String(u || '').trim().toLowerCase().replace(/\.$/, ''); }
  // a measurement typed in for a case size (flat, tray, sleeve…) matches only itself
  function nu(u) { u = u0(u).replace(/\s+/g, ' '); return /(ch|sh|x)es$/.test(u) ? u.slice(0, -2) : /[^s]s$/.test(u) && u.length > 3 ? u.slice(0, -1) : u; }
  // "1/4 lb", "0.5 kg": a fraction of a unit
  function frac(u) { var m = u0(u).match(/^(?:(\d+)\s*\/\s*(\d+)|(\d*\.\d+))\s*([a-z#][a-z ]*)$/); return m ? { k: m[1] ? +m[1] / +m[2] : +m[3], u: m[4] } : null; }
  function dim(u) { var f = frac(u); if (f) return dim(f.u); u = u0(u); return VOL[u] ? 'vol' : WT[u] ? 'wt' : /^(dz|doz|dozen)$/.test(u) ? 'dozen' : EACH.test(u) || !u ? 'each' : 'u:' + nu(u); }
  function base(q, u) { var f = frac(u); if (f) return base(q * f.k, f.u); u = u0(u); return VOL[u] ? q * VOL[u] : WT[u] ? q * WT[u] : /^(dz|doz|dozen)$/.test(u) ? q * 12 : q; }
  // "oz" in a recipe means fluid ounces when the other side is a volume (a quart of stock), weight otherwise
  function ozAs(u, other) { return u0(u) === 'oz' && other === 'vol' ? 'fl oz' : u; }
  function key(m) { return (m.tab || '') + '|' + norm(m.name) + '|' + norm(m.desc); }

  // what one counting unit of an inventory item holds, from its unit and pack ("25 lb", "4 x 5 lb", "12/1 qt", "15 dz", "40 ct")
  function contents(it) {
    var u = u0(it.unit), d = dim(u);
    if (d === 'vol' || d === 'wt') return { dim: d, amt: base(1, u) };
    if (d === 'dozen') return { dim: 'each', amt: 12 };
    var p = String(it.pack || '').toLowerCase(), m;
    if ((m = p.match(/(\d+(?:\.\d+)?)\s*(?:x|\/|×)\s*(\d+(?:\.\d+)?)\s*(fl oz|oz|lb|lbs|kg|g|qt|gal|l|ml|pt|ct|ea|dz|doz)\b/))) {
      var n = +m[1], sz = +m[2], su = m[3], sd = dim(su);
      if (sd === 'vol' || sd === 'wt') return { dim: sd, amt: n * base(sz, su), per: n };
      return { dim: 'each', amt: n * (/dz|doz/.test(su) ? sz * 12 : sz) };
    }
    if ((m = p.match(/(\d+(?:\.\d+)?)\s*(fl oz|oz|lb|lbs|kg|g|qt|gal|l|ml|pt)\b/))) { var sd2 = dim(m[2]); return { dim: sd2, amt: base(+m[1], m[2]) }; }
    if ((m = p.match(/(\d+(?:\.\d+)?)\s*(dz|doz|dozen)\b/))) return { dim: 'each', amt: +m[1] * 12 };
    if ((m = p.match(/(\d+)\s*(ct|count|ea|each|pc|pcs)\b/))) return { dim: 'each', amt: +m[1] };
    if ((m = p.match(/^(\d+(?:\.\d+)?)\s*(?:x|\/|×)?\s*([a-z][a-z ]*)$/)) && dim(m[2]).indexOf('u:') === 0) return { dim: dim(m[2]), amt: +m[1] };   // "12 flats"
    if (/^(case|cs)s?$/.test(u) && +it.per_case) return { dim: 'each', amt: +it.per_case };
    if (/^(bottle|btl|can|jar|bag|box|tub)s?$/.test(u) && window.EdenCosting && /ml|\bl\b|liter/.test(p)) return { dim: 'vol', amt: window.EdenCosting.bottleMl(it) };
    return { dim: d.indexOf('u:') === 0 && !/^u:(case|cs|box|bag|pack)$/.test(d) ? d : 'each', amt: 1 };
  }

  var D = { inv: [], invById: {}, recipes: [], recById: {}, builds: [], loaded: false, p: null, sb: null };
  function load(sb, force) {
    if (D.p && !force && D.sb === sb) return D.p;
    D.sb = sb;
    D.p = Promise.all([
      sb.from('inventory_items').select('*'),
      sb.from('recipes').select('*'),
      sb.from('cocktail_builds').select('*'),
      sb.from('inventory_settings').select('*').eq('id', 1).maybeSingle()
    ]).then(function (r) {
      D.inv = r[0].error ? [] : (r[0].data || []); D.invErr = r[0].error || null;
      D.recipes = r[1].error ? [] : (r[1].data || []); D.recErr = r[1].error || null;
      D.builds = r[2].error ? [] : (r[2].data || []);
      if (!r[3].error && r[3].data && window.EdenCosting) window.EdenCosting.setSettings(r[3].data);
      D.yieldsCol = !r[3].error && r[3].data ? 'yields' in r[3].data : null;
      YIELDS = !r[3].error && r[3].data && Array.isArray(r[3].data.yields) && r[3].data.yields.length ? r[3].data.yields : YIELDS_DEFAULT.slice();
      index(); D.loaded = true; return D;
    }, function (e) { D.p = null; throw e; });
    return D.p;
  }
  function index() {
    D.invById = {}; D.inv.forEach(function (x) { D.invById[x.id] = x; });
    D.recById = {}; D.recipes.forEach(function (x) { x.ingredients = Array.isArray(x.ingredients) ? x.ingredients : []; x.menu_links = Array.isArray(x.menu_links) ? x.menu_links : []; D.recById[x.id] = x; });
  }
  // the recipe tab tells us about recipes it saved, so costs stay current without a reload
  function putRecipe(x) { if (!x) return; var i = D.recipes.findIndex(function (y) { return y.id === x.id; }); if (i < 0) D.recipes.push(x); else D.recipes[i] = x; index(); }
  function dropRecipe(id) { D.recipes = D.recipes.filter(function (y) { return y.id !== id; }); index(); }

  // one ingredient line: { cost, why } (why = the reason there's no cost)
  function ingCost(ing, depth) {
    if (ing.head || !(ing.inv_id || ing.rec_id)) return { cost: null, why: 'not linked' };
    if (ing.qty == null) return { cost: null, why: 'no amount' };
    if (ing.rec_id) {
      var r = D.recById[ing.rec_id]; if (!r) return { cost: null, why: 'recipe deleted' };
      if ((depth || 0) > 4) return { cost: null, why: 'recipe loop' };
      var rc = recipeCost(r, (depth || 0) + 1);
      if (rc.total == null || !r.yield_qty) return { cost: null, why: r.yield_qty ? 'that recipe has no cost' : 'that recipe has no yield' };
      var c = amountOf(ing.qty, ing.unit, r.yield_qty, r.yield_unit);
      return c == null ? { cost: null, why: 'can’t turn ' + (ing.unit || 'each') + ' into ' + (r.yield_unit || 'its yield') } : { cost: rc.total * c };
    }
    var it = D.invById[ing.inv_id]; if (!it) return { cost: null, why: 'inventory item deleted' };
    if (it.cost == null || it.cost === '') return { cost: null, why: 'no price in inventory' };
    var ct = contents(it), y = yieldFor(ing, it);
    if (y) {
      var n = wholesFor(ing.qty, ing.unit, y), wn = y.from;
      if (n == null) return { cost: null, why: 'can’t turn ' + (ing.unit || 'each') + ' of ' + y.part.toLowerCase() + ' into ' + wn + 's' };
      if (ct.dim === 'each') return { cost: +it.cost * n / ct.amt, wholes: n, whole: wn };
      return { cost: null, why: 'count ' + (it.ingredient || it.name) + ' by the each (or dozen) to cost ' + y.part.toLowerCase() };
    }
    var iu = ozAs(ing.unit, ct.dim), d = dim(iu);
    if (d === 'dozen') d = 'each';
    if (d !== ct.dim) return { cost: null, why: 'can’t turn ' + (ing.unit || 'each') + ' into ' + (it.unit || 'each') + (it.pack ? ' (' + it.pack + ')' : '') };
    return { cost: +it.cost * base(ing.qty, iu) / ct.amt };
  }
  // how much of a recipe's yield an amount is (2 oz of a 4 qt batch = 0.0156)
  function amountOf(q, u, yq, yu) {
    if (!yq) return null;
    if (!u0(u) || u0(u) === u0(yu)) return q / yq;
    u = ozAs(u, dim(yu)); yu = ozAs(yu, dim(u));
    var a = dim(u), b = dim(yu);
    if (a === b) return base(q, u) / base(yq, yu);
    return null;
  }
  function recipeCost(r, depth) {
    var total = 0, priced = 0, missing = [], lines = [];
    (r.ingredients || []).forEach(function (g) {
      if (g.head) return;
      var c = ingCost(g, depth);
      lines.push(c);
      if (c.cost != null) { total += c.cost; priced++; } else missing.push((g.item || 'An ingredient') + ': ' + c.why);
    });
    return { total: priced ? total : null, priced: priced, missing: missing, lines: lines, per: priced && r.yield_qty ? total / r.yield_qty : null };
  }
  function linkCost(r, l) {
    var rc = recipeCost(r); if (rc.total == null) return { cost: null, why: rc.missing.length ? 'ingredients aren’t priced yet' : 'no ingredients linked' };
    if (!r.yield_qty) return { cost: null, why: 'the recipe needs a base yield' };
    var share = amountOf(l.qty == null ? 1 : +l.qty, l.unit || r.yield_unit, r.yield_qty, r.yield_unit);
    if (share == null) return { cost: null, why: 'can’t turn ' + l.unit + ' into ' + r.yield_unit };
    return { cost: rc.total * share, partial: rc.missing.length };
  }

  /* ---------- every menu item, with its cost ---------- */
  function price(v) { var m = String(v == null ? '' : v).match(/\d+(\.\d+)?/); return m ? +m[0] : null; }
  var OZ = { oz: 1, 'fl oz': 1, ml: 1 / 29.5735, cl: 0.33814, dash: 1 / 32, dashes: 1 / 32, barspoon: 0.125, bsp: 0.125, tsp: 1 / 6, tbsp: 0.5, rinse: 0.25, drop: 1 / 600, drops: 1 / 600, splash: 0.25, float: 0.5 };
  function cpo(it) {
    if (!it || !window.EdenCosting) return null;
    var one = window.EdenCosting.oneCost(it); if (one == null) return null;
    var u = String(it.unit || '').toLowerCase();
    if (u === 'keg') return one / 661;
    if (/^(can|each|ea)$/.test(u) && /oz/.test(it.pack || '')) { var oz = parseFloat((String(it.pack).match(/(\d+(\.\d+)?)\s*oz/) || [])[1]); return oz ? one / oz : null; }
    return one / (window.EdenCosting.bottleMl(it) / ML_OZ);
  }
  // one line of a cocktail build: spirits and wine by the ounce from their bottle; anything else (lime juice from limes,
  // simple syrup by the qt, sugar by the lb, a sprig of mint) the same way recipes cost it
  function pourCost(g) {
    var it = D.invById[g.inv_id]; if (!it || g.qty == null) return null;
    var f = OZ[String(g.unit || 'oz').toLowerCase()];
    if (it.category === 'bev' && f) { var c = cpo(it); if (c != null) return g.qty * f * c; }
    var r = ingCost(f ? { qty: g.qty * f, unit: 'fl oz', item: g.item, inv_id: g.inv_id } : { qty: g.qty, unit: g.unit, item: g.item, inv_id: g.inv_id });
    if (r.cost == null && f) r = ingCost({ qty: g.qty * f, unit: 'oz', item: g.item, inv_id: g.inv_id });   // an ounce of something counted by weight
    return r.cost;
  }
  function buildCost(b) {
    var total = 0, n = 0, miss = 0;
    (b.ingredients || []).forEach(function (g) { if (!g.inv_id) return; var c = pourCost(g); if (c == null) { miss++; return; } total += c; n++; });
    return { cost: n ? total : null, missing: miss };
  }
  function tabKind(t) { var s = String(t.id || '') + ' ' + norm(t.label); return /food|kitchen/.test(s) ? 'food' : /bar|cocktail/.test(s) ? 'bar' : /wine/.test(s) ? 'wine' : /beer|soft/.test(s) ? 'beer' : /spirit/.test(s) ? 'spirits' : /coffee|tea/.test(s) ? 'coffee' : 'other'; }
  // rows: one per menu item and serving (a wine has a glass row and a bottle row)
  function rows(menu) {
    var list = window.EdenCosting ? window.EdenCosting.menuList(menu) : [];
    var byKey = {}; list.forEach(function (m) { byKey[key(m)] = m; });
    // drinks from inventory: each inventory item's servings, by the menu item they're sold as
    var inv = {};
    if (window.EdenCosting) D.inv.forEach(function (it) { window.EdenCosting.servings(it, list).forEach(function (s) { if (s.part) return; var k = key(s.menu) + '|' + s.label; (inv[k] = inv[k] || []).push({ it: it, s: s }); }); });
    // food from recipes
    var food = {};
    D.recipes.forEach(function (r) { (r.menu_links || []).forEach(function (l) { var k = (l.tab || '') + '|' + norm(l.name) + '|' + norm(l.desc); (food[k] = food[k] || []).push({ r: r, l: l, c: linkCost(r, l) }); }); });
    var builds = {}; D.builds.forEach(function (b) { if (b.active !== false) builds[norm(b.menu_name || b.name)] = b; });
    var out = [];
    ((menu && menu.tabs) || []).forEach(function (t) {
      var kind = tabKind(t);
      (t.groups || []).forEach(function (g) {
        (g.items || []).forEach(function (mi) {
          if (!mi || mi.hidden || !mi.name) return;
          var m = { tab: t.id, tabLabel: t.label, group: g.title || '', name: mi.name, desc: mi.desc || '' }, k = key(m);
          var base0 = { tab: t.id, tabLabel: t.label, kind: kind, group: m.group, name: m.name, desc: m.desc, key: k, menu: m };
          var fr = food[k];
          if (fr) {
            var tot = 0, ok = 0, why = [];
            fr.forEach(function (x) { if (x.c.cost != null) { tot += x.c.cost; ok++; if (x.c.partial) why.push(x.r.name + ': ' + x.c.partial + ' ingredient' + (x.c.partial === 1 ? '' : 's') + ' not priced'); } else why.push(x.r.name + ': ' + x.c.why); });
            out.push(Object.assign({}, base0, { serving: '', price: price(mi.price), cost: ok ? tot : null, from: 'recipe', parts: fr.map(function (x) { return { label: x.r.name, amt: (x.l.qty == null ? 1 : x.l.qty) + ' ' + (x.l.unit || x.r.yield_unit || ''), cost: x.c.cost, rid: x.r.id }; }), issues: why }));
            return;
          }
          if (kind === 'bar') {
            var b = builds[norm(mi.name)];
            if (b) { var bc = buildCost(b); out.push(Object.assign({}, base0, { serving: '', price: price(mi.price), cost: bc.cost, from: 'build', parts: [{ label: 'Cocktail build: ' + (b.name || mi.name), cost: bc.cost }], issues: bc.missing ? [bc.missing + ' ingredient' + (bc.missing === 1 ? '' : 's') + ' without a price'] : [] })); return; }
          }
          var sv = Object.keys(inv).filter(function (x) { return x.indexOf(k + '|') === 0; });
          if (sv.length) {
            sv.forEach(function (x) { var hit = inv[x][0]; out.push(Object.assign({}, base0, { serving: hit.s.label, price: hit.s.price, cost: hit.s.cost, from: 'inventory', parts: [{ label: hit.it.name + (hit.it.pack ? ' · ' + hit.it.pack : ''), cost: hit.s.cost, iid: hit.it.id }], issues: hit.s.cost == null ? ['no price in inventory'] : [] })); });
            return;
          }
          var pr = price(mi.price) || price(mi.glass) || price(mi.bottle);
          out.push(Object.assign({}, base0, { serving: mi.glass && mi.bottle ? 'Glass / bottle' : '', price: pr, cost: null, from: '', parts: [], issues: [] }));
        });
      });
    });
    out.forEach(function (r) { r.pct = r.cost != null && r.price ? r.cost / r.price : null; r.target = TARGET[r.kind] || 0.3; });
    return out;
  }

  /* ---------- the Menu costs page ---------- */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function money(n) { return n == null ? '—' : '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }
  function pct(p) { return p == null ? '—' : (p * 100).toFixed(1) + '%'; }
  var P = { ctx: null, tab: 'all', q: '', show: 'all', sort: 'menu', open: {} };
  try { var sv0 = JSON.parse(localStorage.getItem('eden-menucost') || '{}'); if (sv0.tab) P.tab = sv0.tab; if (sv0.show) P.show = sv0.show; if (sv0.sort) P.sort = sv0.sort; } catch (e) {}
  function remember() { try { localStorage.setItem('eden-menucost', JSON.stringify({ tab: P.tab, show: P.show, sort: P.sort })); } catch (e) {} }
  var KIND_LABEL = { food: 'Food', bar: 'Cocktails', wine: 'Wine', beer: 'Beer & soft drinks', spirits: 'Spirits', coffee: 'Coffee & tea', other: 'Other' };
  function show(ctx) {
    P.ctx = ctx; var el = ctx.el;
    el.innerHTML = ''; el.appendChild(h('div', { cls: 'mc-in' }, [h('p', { cls: 'sc-empty', text: 'Loading menu costs…' })]));
    Promise.all([load(ctx.sb, true), Promise.resolve(ctx.getMenu ? ctx.getMenu() : null)]).then(function (r) { P.menu = r[1]; paint(); }, function () { el.innerHTML = ''; el.appendChild(h('p', { cls: 'an-err', text: 'Couldn’t load the menu costs. Check your connection and reload.' })); });
  }
  // Ingredient yields: look at and change how a part of an item is costed from the whole
  function yieldsPanel() {
    var rows0 = YIELDS.map(function (y) { return Object.assign({}, y); });
    var det = h('details', { cls: 'mc-yields' }); det.open = !!P.yOpen; det.addEventListener('toggle', function () { P.yOpen = det.open; });
    var body = h('div'), msg = h('p', { cls: 'sc-msg', role: 'status' });
    var units = ['g', 'oz', 'ml', 'tsp', 'tbsp', 'fl oz', 'cup'];
    function paintRows() {
      body.innerHTML = '';
      var tb = h('tbody');
      rows0.forEach(function (y, i) {
        var f = function (k, ph, w) { var e = h('input', { type: 'text', value: y[k] == null ? '' : String(y[k]), placeholder: ph, 'aria-label': ph }); if (w) e.style.width = w; e.addEventListener('input', function () { y[k] = k === 'qty' ? (parseFloat(e.value) || null) : e.value; }); return e; };
        var us = h('select', { 'aria-label': 'Unit' }, units.map(function (u) { return h('option', { value: u, text: u }); })); us.value = y.unit || 'g'; us.addEventListener('change', function () { y.unit = us.value; });
        tb.appendChild(h('tr', null, [h('td', null, f('part', 'e.g. Egg yolk')), h('td', null, f('words', 'egg yolk, yolk')), h('td', null, f('from', 'egg')),
          h('td', { cls: 'mc-ygive' }, [h('span', { text: '1 ' + (y.from || 'whole') + ' gives' }), f('qty', '17', '64px'), us]),
          h('td', null, h('button', { type: 'button', cls: 'rc-mini rc-del', 'aria-label': 'Remove', text: '✕', on: { click: function () { rows0.splice(i, 1); paintRows(); } } }))]));
      });
      body.appendChild(h('div', { cls: 'is-wrap' }, h('table', { cls: 'fn-tbl mc-ytbl' }, [h('thead', null, h('tr', null, ['Part', 'Recipe ingredient says', 'Costed from (whole)', 'One whole gives', ''].map(function (t) { return h('th', { text: t }); }))), tb])));
      body.appendChild(h('div', { cls: 'mc-yact' }, [
        h('button', { type: 'button', cls: 'ed-btn small', text: '+ Add a yield', on: { click: function () { rows0.push({ part: '', words: '', from: '', qty: null, unit: 'g' }); paintRows(); } } }),
        h('button', { type: 'button', cls: 'ed-btn small', text: 'Back to the defaults', on: { click: function () { rows0 = YIELDS_DEFAULT.map(function (y) { return Object.assign({}, y); }); paintRows(); } } }),
        h('span', { cls: 'sc-sp' }),
        h('button', { type: 'button', cls: 'ed-btn', text: 'Save yields', on: { click: save } })
      ]));
      body.appendChild(msg);
    }
    function save() {
      var list = rows0.filter(function (y) { return (y.part || '').trim() || (y.words || '').trim(); });
      var bad = list.filter(function (y) { return !(y.from || '').trim() || !(+y.qty > 0); });
      if (bad.length) { msg.textContent = 'Each yield needs what it’s costed from and how much one whole gives.'; return; }
      list = list.map(function (y) { return { part: (y.part || y.words).trim(), words: (y.words || y.part).trim(), from: y.from.trim(), qty: +y.qty, unit: y.unit || 'g' }; });
      msg.textContent = 'Saving…';
      D.sb.from('inventory_settings').update({ yields: list, updated_at: new Date().toISOString() }).eq('id', 1).then(function (r) {
        if (r.error) { msg.textContent = /yields|column/i.test(r.error.message || '') ? 'One-time setup: run supabase/ingredient-yields.sql in Supabase, then save again.' : /permission|security/i.test(r.error.message || '') ? 'Only the Owner or a manager can change yields.' : 'Couldn’t save. Check your connection and try again.'; return; }
        YIELDS = list; P.yOpen = true; paint();
      });
    }
    paintRows();
    det.appendChild(h('summary', null, [h('span', { text: 'Costing calculations' }), h('small', { text: 'Egg whites & yolks, lemon & lime juice: costed from the whole item' })]));
    det.appendChild(h('p', { cls: 'an-sub', text: 'When a recipe calls for part of an item, it’s costed from the whole one. A count (3 egg yolks, juice of 2 lemons) uses that many wholes; a weight or volume (100 g whites, 2 tbsp lemon juice) is divided by what one whole gives. This only applies when the ingredient is linked to the whole item (Eggs, Lemons), not bottled juice or liquid whites.' }));
    if (D.yieldsCol === false) det.appendChild(h('p', { cls: 'an-err', text: 'These are the defaults. To change them, run supabase/ingredient-yields.sql in Supabase once.' }));
    det.appendChild(body);
    return det;
  }
  function paint() {
    var el = P.ctx.el; el.innerHTML = '';
    var all = rows(P.menu), wrap = h('div', { cls: 'mc-in' }); el.appendChild(wrap);
    wrap.appendChild(h('div', { cls: 'mc-head' }, [h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Kitchen & bar' }), h('h1', { cls: 'sc-week', text: 'Menu costs' })]),
      h('p', { cls: 'an-sub', text: 'What each item on the menu costs to make, against its price. Food comes from recipes connected to the menu item; cocktails from their builds; wine, beer and spirits from the inventory item they’re poured from.' })]));
    if (D.invErr || D.recErr) wrap.appendChild(h('p', { cls: 'an-err', text: 'Some data couldn’t be loaded (' + [D.invErr ? 'inventory' : '', D.recErr ? 'recipes' : ''].filter(Boolean).join(', ') + ').' }));
    wrap.appendChild(yieldsPanel());   // Costing calculations, near the top
    // summary by kind
    var kinds = ['food', 'bar', 'wine', 'beer', 'spirits', 'coffee'].filter(function (k) { return all.some(function (r) { return r.kind === k; }); });
    var tiles = h('div', { cls: 'mc-tiles' }, kinds.map(function (k) {
      var rs = all.filter(function (r) { return r.kind === k; }), c = rs.filter(function (r) { return r.pct != null; });
      var avg = c.length ? c.reduce(function (a, r) { return a + r.cost; }, 0) / c.reduce(function (a, r) { return a + r.price; }, 0) : null, over = c.filter(function (r) { return r.pct > r.target; }).length;
      return h('button', { type: 'button', cls: 'mc-tile', 'aria-pressed': P.tab === k ? 'true' : 'false', on: { click: function () { P.tab = P.tab === k ? 'all' : k; remember(); paint(); } } }, [
        h('span', { cls: 'mc-tk', text: KIND_LABEL[k] }), h('b', { cls: avg != null && avg > TARGET[k] ? 'hi' : '', text: pct(avg) }),
        h('span', { cls: 'mc-ts', text: c.length + ' of ' + rs.length + ' costed' + (over ? ' · ' + over + ' over ' + Math.round(TARGET[k] * 100) + '%' : '') })]);
    }));
    wrap.appendChild(tiles);
    // controls
    var q = h('input', { type: 'search', cls: 'mc-q', placeholder: 'Search the menu', value: P.q, 'aria-label': 'Search the menu' });
    q.addEventListener('input', function () { P.q = q.value; paintList(); });
    var seg = function (opts, cur, set, label) { return h('div', { cls: 'fn-range', role: 'group', 'aria-label': label }, opts.map(function (o) { return h('button', { type: 'button', cls: 'fn-rbtn', 'aria-pressed': cur === o[0] ? 'true' : 'false', text: o[1], on: { click: function () { set(o[0]); remember(); paint(); } } }); })); };
    wrap.appendChild(h('div', { cls: 'mc-bar' }, [
      h('div', { cls: 'mc-chips', role: 'group', 'aria-label': 'Menu section' }, [['all', 'Whole menu']].concat(kinds.map(function (k) { return [k, KIND_LABEL[k]]; })).map(function (o) { return h('button', { type: 'button', cls: 'rc-chip', 'aria-pressed': P.tab === o[0] ? 'true' : 'false', text: o[1], on: { click: function () { P.tab = o[0]; remember(); paint(); } } }); })),
      q,
      seg([['all', 'All'], ['missing', 'Needs a cost'], ['over', 'Over target']], P.show, function (v) { P.show = v; }, 'Show'),
      seg([['menu', 'Menu order'], ['pct', 'Highest cost %'], ['profit', 'Lowest profit']], P.sort, function (v) { P.sort = v; }, 'Sort'),
      h('button', { type: 'button', cls: 'ed-btn small ghost', text: 'Download CSV', on: { click: function () { csv(filtered()); } } })
    ]));
    var listEl = h('div', { cls: 'mc-list' }); wrap.appendChild(listEl);
    wrap.appendChild(h('p', { cls: 'fn-note', text: 'Targets: food ' + pct(TARGET.food) + ', cocktails ' + pct(TARGET.bar) + ', wine ' + pct(TARGET.wine) + ', beer & soft drinks ' + pct(TARGET.beer) + ', spirits ' + pct(TARGET.spirits) + '. To cost a plate: open its recipe in Recipes, link each ingredient to an inventory item, then connect the recipe to the menu item (with how much goes on one plate). A plate made of several recipes (protein, sauce, garnish) adds them up.' }));
    function filtered() {
      var w = norm(P.q).split(' ').filter(Boolean);
      var rs = all.filter(function (r) {
        if (P.tab !== 'all' && r.kind !== P.tab) return false;
        if (P.show === 'missing' && r.cost != null) return false;
        if (P.show === 'over' && !(r.pct != null && r.pct > r.target)) return false;
        var hay = norm(r.name + ' ' + r.desc + ' ' + r.group + ' ' + r.parts.map(function (p) { return p.label; }).join(' '));
        return w.every(function (x) { return hay.indexOf(x) >= 0; });
      });
      if (P.sort === 'pct') rs = rs.slice().sort(function (a, b) { return (b.pct == null ? -1 : b.pct) - (a.pct == null ? -1 : a.pct); });
      if (P.sort === 'profit') rs = rs.slice().sort(function (a, b) { var pa = a.cost != null && a.price ? a.price - a.cost : 1e9, pb = b.cost != null && b.price ? b.price - b.cost : 1e9; return pa - pb; });
      return rs;
    }
    function paintList() {
      listEl.innerHTML = '';
      var rs = filtered();
      if (!rs.length) { listEl.appendChild(h('p', { cls: 'an-li-empty', text: P.show === 'missing' ? 'Everything here has a cost.' : P.show === 'over' ? 'Nothing is over its target.' : 'Nothing matches.' })); return; }
      // grouped by section and menu heading (menu order), or one list when sorted
      var groups = [];
      if (P.sort === 'menu') rs.forEach(function (r) { var gk = r.tabLabel + ' · ' + r.group, last = groups[groups.length - 1]; if (!last || last.k !== gk) groups.push(last = { k: gk, tab: r.tabLabel, group: r.group, rows: [] }); last.rows.push(r); });
      else groups.push({ k: 'sorted', tab: '', group: P.sort === 'pct' ? 'Highest cost % first' : 'Lowest profit first', rows: rs });
      groups.forEach(function (g) {
        var costed = g.rows.filter(function (r) { return r.pct != null; }), gp = costed.length ? costed.reduce(function (a, r) { return a + r.cost; }, 0) / costed.reduce(function (a, r) { return a + r.price; }, 0) : null;
        var det = h('details', { cls: 'mc-grp', open: P.open[g.k] !== false ? true : null }, [
          h('summary', null, [h('span', { cls: 'mc-gt' }, [g.tab ? h('small', { text: g.tab }) : null, h('b', { text: g.group || 'Items' })]), h('span', { cls: 'mc-gs', text: g.rows.length + (g.rows.length === 1 ? ' item' : ' items') + (gp != null ? ' · ' + pct(gp) + ' cost' : '') })]),
          h('div', { cls: 'fn-tblw' }, [h('table', { cls: 'fn-tbl mc-tbl' }, [
            h('thead', null, [h('tr', null, [h('th', { text: 'Item' }), h('th', { cls: 'num', text: 'Price' }), h('th', { cls: 'num', text: 'Cost' }), h('th', { cls: 'num', text: 'Cost %' }), h('th', { cls: 'num', text: 'Profit' }), h('th', { text: 'Made from' })])]),
            h('tbody', null, g.rows.map(function (r) {
              var over = r.pct != null && r.pct > r.target;
              return h('tr', { cls: r.cost == null ? 'mc-none' : '' }, [
                h('th', { scope: 'row' }, [h('b', { text: r.name }), r.serving ? h('small', { text: r.serving }) : null, r.desc ? h('small', { cls: 'mc-desc', text: r.desc }) : null]),
                h('td', { cls: 'num', text: r.price ? money(r.price) : '—' }),
                h('td', { cls: 'num', text: money(r.cost) }),
                h('td', { cls: 'num' }, [r.pct != null ? h('span', { cls: 'mc-pct' + (over ? ' hi' : r.pct <= r.target * 0.8 ? ' lo' : ''), text: pct(r.pct) }) : h('span', { cls: 'dim', text: '—' })]),
                h('td', { cls: 'num', text: r.cost != null && r.price ? money(r.price - r.cost) : '—' }),
                h('td', { cls: 'mc-from' }, made(r))
              ]);
            }))
          ])])
        ]);
        det.addEventListener('toggle', function () { P.open[g.k] = det.open; });
        listEl.appendChild(det);
      });
    }
    function made(r) {
      var out = [];
      r.parts.forEach(function (p) {
        var lab = (p.amt ? p.amt + ' ' : '') + p.label + (p.cost != null ? ' · ' + money(p.cost) : '');
        out.push(p.rid ? h('a', { href: '#recipes', cls: 'mc-link', text: lab, on: { click: function () { if (window.EdenRecipes) window.EdenRecipes.focus(p.rid); } } }) : h('span', { text: lab }));
      });
      r.issues.forEach(function (x) { out.push(h('small', { cls: 'mc-issue', text: x })); });
      if (!r.parts.length) out.push(r.kind === 'food' ? h('a', { href: '#recipes', cls: 'mc-add', text: 'Connect a recipe in Recipes →' }) : r.kind === 'bar' ? h('a', { href: '#recipes', cls: 'mc-add', text: 'Add a cocktail build →', on: { click: function () { try { sessionStorage.setItem('eden-recipes-tab', 'cocktails'); } catch (e) {} } } }) : h('a', { href: '#inventory', cls: 'mc-add', text: 'Link it to an inventory item →' }));
      return out;
    }
    function csv(rs) {
      var c = function (v) { v = v == null ? '' : String(v); return /[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
      var lines = [['Section', 'Heading', 'Item', 'Serving', 'Price', 'Cost', 'Cost %', 'Profit', 'Made from'].join(',')].concat(rs.map(function (r) {
        return [r.tabLabel, r.group, r.name, r.serving, r.price != null ? r.price.toFixed(2) : '', r.cost != null ? r.cost.toFixed(2) : '', r.pct != null ? (r.pct * 100).toFixed(1) + '%' : '', r.cost != null && r.price ? (r.price - r.cost).toFixed(2) : '', r.parts.map(function (p) { return (p.amt ? p.amt + ' ' : '') + p.label; }).join('; ')].map(c).join(',');
      }));
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })); a.download = 'Eden menu costs.csv'; document.body.appendChild(a); a.click(); a.remove();
    }
    paintList();
  }

  window.EdenMenuCost = {
    contents: contents, pourCost: pourCost, yieldOptions: yieldOptions, yieldFor: yieldFor, load: load, show: show, yields: function () { return YIELDS; }, putRecipe: putRecipe, dropRecipe: dropRecipe, recipeCost: recipeCost, ingCost: ingCost, linkCost: linkCost,
    units: function () {   // measurements from the inventory's case sizes that aren't standard ones, for recipe unit lists
      var seen = {};
      D.inv.forEach(function (it) { var m = String(it.pack || '').toLowerCase().match(/^\s*\d+(?:\.\d+)?\s*(?:x|\/|×)?\s*([a-z][a-z ]*)$/); if (m && dim(m[1]).indexOf('u:') === 0) { var x = dim(m[1]).slice(2); if (!/^(case|cs|box|bag|pack|bottle|can|keg)$/.test(x) && x.length <= 20) seen[x] = 1; } });
      return Object.keys(seen).sort();
    },
    rows: rows, key: key, norm: norm, money: money, pct: pct, data: D, tabKind: tabKind, TARGET: TARGET,
    _test: { contents: contents, amountOf: amountOf, dim: dim }
  };
})();
