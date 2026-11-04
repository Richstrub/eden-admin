/* Eden staff site: Inventory → what each item sells for on the menu, and its cost %.
 *
 * Each inventory item is matched to the menu items it's sold as (by name, or picked by hand in the item's edit
 * window), then priced per serving from its cost:
 *   Wine        by the glass: the bottle's cost × a 5 oz pour ÷ the bottle size (750 ml unless the pack says 375 ml, 1.5 L…)
 *               by the bottle: the bottle's cost ÷ the bottle price
 *   Spirits     a 1.5 oz pour (the base spirit in a cocktail, and spirits on the list); on a cocktail it's the base
 *               spirit's share of the cocktail's price
 *   Draught     a 16 oz pour from a sixth-barrel keg (661 oz), unless the pack says half barrel
 *   Cans, soda  the cost of one (case cost ÷ how many in a case)
 * Pour sizes are in inventory_settings (supabase/inventory-costing.sql) and can be changed on the page.
 */
(function () {
  'use strict';
  var ML_OZ = 29.5735;
  var S = { glass_oz: 5, pour_oz: 1.5, draught_oz: 16, keg_oz: 661 };

  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[’'`]/g, '').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim(); }
  function price(v) { var m = String(v == null ? '' : v).match(/\d+(\.\d+)?/); return m ? +m[0] : null; }
  function bottleMl(it) {
    var t = String((it.pack || '') + ' ' + (it.name || '')).toLowerCase(), m;
    if ((m = t.match(/(\d+(?:\.\d+)?)\s*ml\b/))) return +m[1];
    if ((m = t.match(/(\d+(?:\.\d+)?)\s*(?:l|lt|liter|litre)\b/))) return +m[1] * 1000;
    if (/magnum/.test(t)) return 1500;
    return 750;
  }
  function kegOz(it) { var t = String(it.pack || '').toLowerCase(); return /1\/2|half/.test(t) ? 1984 : /1\/4|quarter|pony/.test(t) ? 992 : /50\s*l/.test(t) ? 1690 : /20\s*l/.test(t) ? 676 : S.keg_oz; }
  // the cost of one bottle / can / keg, from the item's cost per counting unit
  function oneCost(it) {
    if (it.cost == null || it.cost === '') return null;
    var u = String(it.unit || '').toLowerCase(), c = +it.cost, pc = +it.per_case || 0;
    if (/^(case|cs)s?$/.test(u)) { if (!pc) { var m = String(it.pack || '').match(/^\s*(\d+)\s*(?:\/|x)/i); pc = m ? +m[1] : 0; } return pc ? c / pc : null; }
    return c;
  }

  // the menu, indexed: every priced item with its tab and group
  function menuList(menu) {
    var out = [];
    ((menu && menu.tabs) || []).forEach(function (t) {
      (t.groups || []).forEach(function (g) {
        (g.items || []).forEach(function (m) {
          if (!m || m.hidden || !m.name) return;
          out.push({ tab: t.id, tabLabel: t.label || '', group: g.title || '', name: m.name, desc: m.desc || '', price: price(m.price), glass: price(m.glass), bottle: price(m.bottle), raw: m.price || '' });
        });
      });
    });
    return out;
  }
  function kindOf(m) {
    var tab = String(m.tab || '') + ' ' + norm(m.tabLabel), g = norm(m.group);
    if (/wine/.test(tab)) return 'wine';
    if (/beer|soft/.test(tab)) return /draught|draft|tap/.test(g) ? 'draught' : /can|bottle/.test(g) ? 'can' : 'each';
    if (/spirit/.test(tab)) return 'pour';
    if (/bar|cocktail/.test(tab)) return /mocktail/.test(g) ? 'none' : /aperitif|amaro|liqueur|digestif/.test(g) ? 'pour' : 'cocktail';
    if (/coffee|tea/.test(tab)) return 'none';
    if (/m-food|kitchen/.test(tab)) return 'none';   // plates are costed with recipes, not one inventory item
    return 'each';
  }
  // which menu items an inventory item is sold as: its saved links, or the same name (and description, for twins like Steelbound Blanco / Reposado)
  function linksFor(it, list) {
    var refs = Array.isArray(it.menu_refs) ? it.menu_refs : [];
    if (refs.length) return refs.map(function (r) { return list.filter(function (m) { return m.tab === r.tab && m.name === r.name && (!r.desc || m.desc === r.desc); })[0]; }).filter(Boolean);
    var n = norm(it.name); if (!n) return [];
    var hits = list.filter(function (m) { return norm(m.name) === n && kindOf(m) !== 'none' && kindOf(m) !== 'cocktail'; });
    if (hits.length > 1 && it.pack) { var p = norm(it.pack), d = hits.filter(function (m) { var md = norm(m.desc); return md && (md === p || p.indexOf(md) === 0); }); if (d.length) hits = d; }
    if (hits.length > 1) { var w = hits.filter(function (m) { return kindOf(m) === 'wine'; }); if (w.length) hits = w.slice(0, 1); }   // a wine listed twice: use one
    return hits.slice(0, 2);
  }
  // per serving: [{ label, price, cost, pct }]
  function servings(it, list) {
    var one = oneCost(it), out = [];
    linksFor(it, list).forEach(function (m) {
      var k = kindOf(m), ml = bottleMl(it);
      if (k === 'wine') {
        if (m.glass) out.push({ label: 'Glass ' + S.glass_oz + ' oz', price: m.glass, cost: one != null ? one * S.glass_oz * ML_OZ / ml : null, menu: m });
        var bp = m.bottle || (!m.glass ? m.price : null);
        if (bp) out.push({ label: 'Bottle', price: bp, cost: one, menu: m });
      } else if (k === 'pour') {
        if (m.price) out.push({ label: S.pour_oz + ' oz pour', price: m.price, cost: one != null ? one * S.pour_oz * ML_OZ / ml : null, menu: m });
      } else if (k === 'cocktail') {
        if (m.price) out.push({ label: S.pour_oz + ' oz in ' + m.name, price: m.price, cost: one != null ? one * S.pour_oz * ML_OZ / ml : null, menu: m, part: true });
      } else if (k === 'draught') {
        var oz = (String(m.desc).match(/(\d+)\s*oz/) || [])[1] * 1 || S.draught_oz;
        if (m.price) out.push({ label: oz + ' oz pour', price: m.price, cost: one != null ? one * oz / kegOz(it) : null, menu: m });
      } else if (k === 'can' || k === 'each') {
        if (m.price) out.push({ label: k === 'can' ? 'Can' : 'Each', price: m.price, cost: one, menu: m });
      }
    });
    out.forEach(function (s) { s.pct = s.cost != null && s.price ? s.cost / s.price : null; });
    return out;
  }
  function money(n) { return '$' + (Math.round(n * 100) / 100).toLocaleString('en-US', { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function pctText(p) { return p == null ? '—' : Math.round(p * 1000) / 10 + '%'; }
  function shortLabel(s) { return /^Glass/.test(s.label) ? 'gl' : s.label === 'Bottle' ? 'btl' : s.part ? 'cktl' : /pour/.test(s.label) ? 'pour' : s.label.toLowerCase(); }

  window.EdenCosting = {
    settings: S,
    setSettings: function (x) { if (x) Object.keys(S).forEach(function (k) { if (x[k] != null && +x[k] > 0) S[k] = +x[k]; }); },
    menuList: menuList, kindOf: kindOf, linksFor: linksFor, servings: servings, oneCost: oneCost, bottleMl: bottleMl,
    // for the count sheet: "$16 gl · $56 btl" and "21% gl · 29% btl"
    cells: function (it, list) {
      var sv = servings(it, list);
      if (!sv.length) return null;
      return { sv: sv, menu: sv.map(function (s) { return money(s.price) + ' ' + shortLabel(s); }).join(' · '), pct: sv.map(function (s) { return pctText(s.pct) + ' ' + shortLabel(s); }).join(' · '),
        worst: sv.reduce(function (w, s) { return s.pct != null && !s.part && s.pct > w ? s.pct : w; }, 0) };
    },
    money: money, pctText: pctText
  };
})();
