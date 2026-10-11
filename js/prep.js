/* Eden staff site: printable prep list built from the live menu.
 *
 * Every visible dish on the Kitchen menu becomes a block: the dish (with its farm or producer), the main
 * ingredient(s) named in its title, and each component from its description ("Israeli couscous, charred tomatillo, …"). Add-ons written in a section
 * note ("Add to any large plate: Chickpea & Red Miso Butter 6 · …") become their own items. The bar menu
 * can be included too. "Combined" view merges components shared by several dishes into one line.
 *
 * Pars, extra items and removed lines are remembered on this computer (browser storage), so the list
 * follows the menu automatically while keeping each kitchen's own pars.
 */
(function () {
  'use strict';
  var KEY = 'eden-prep-v1';
  var P = { ctx: null, el: null, mode: 'dish', bar: false, date: null, saved: load() };

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(P.saved)); } catch (e) {} }
  P.saved.pars = P.saved.pars || {}; P.saved.removed = P.saved.removed || {}; P.saved.extra = P.saved.extra || {};

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v; else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); }); else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function cap(s) { s = String(s || '').trim(); return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
  function keyOf(s) { return String(s || '').trim().toLowerCase().replace(/\s+/g, ' '); }
  function shown(it) { return !it.hidden && (it.name || it.price); }
  function isWine(it) { return it.appellation !== undefined || it.grape !== undefined || it.country !== undefined; }

  /* ---------- build the list from the menu ---------- */
  function splitParts(desc) {
    return String(desc || '').split(/\s*[,;]\s*|\s+and\s+(?=[a-z])/i).map(function (x) { return cap(x.replace(/\.$/, '')); }).filter(Boolean);
  }
  // The dish title names the main ingredient(s): "Braised Short Rib" -> Short rib (braised),
  // "Beet and Carrot Salad" -> Beets, Carrots, "Mushroom Toast" -> Mushrooms.
  var METHOD = /^(?:(?:pan[\s-]+seared|seared|ember[\s-]+roasted|wood[\s-]+fired|roasted|braised|grilled|fried|crispy|smoked|charred|poached|confit|cured|house[\s-]+made)\s+)+/i;
  var DISHWORD = /\s+(?:salad|bowl|plate|board)$/i;
  var BREAD = /\s+(toast|flatbread|crostini|naan)$/i;  // the bread is its own prep item
  function plural(w) {
    if (/(s|ch|sh|x|z)$/i.test(w)) return w;
    if (/[^aeiou]y$/i.test(w)) return w.slice(0, -1) + 'ies';
    if (/o$/i.test(w)) return w + 'es';
    return w + 's';
  }
  function titleParts(name) {
    var n = String(name || '').trim(); if (!n) return [];
    var m = METHOD.exec(n), method = m ? m[0].trim().toLowerCase().replace(/\s+/g, ' ') : '';
    n = n.slice(m ? m[0].length : 0);
    var b = BREAD.exec(n), bread = b ? cap(b[1].toLowerCase()) : '';
    if (b) n = n.slice(0, b.index);
    var dishWord = !!b || DISHWORD.test(n); n = n.replace(DISHWORD, '');
    return n.split(/\s*(?:,|&|\band\b)\s*/i).filter(Boolean).map(function (x) {
      x = x.trim();
      if (dishWord && /^[a-z]+(?:\s[a-z]+)?$/i.test(x)) x = x.replace(/(\w+)$/, function (w) { return plural(w); });
      x = x.replace(/\b(NY|BBQ|[A-Z]{2,})\b|\b(\w)(\w*)/g, function (all, ab, f, r) { return ab || f.toLowerCase() + r.toLowerCase(); });
      return { label: cap(x), note: method };
    }).concat(bread ? [{ label: bread, note: '' }] : []);
  }
  function addOns(note) { // "Add to any large plate: Chickpea & Red Miso Butter 6 · Roasted Mushrooms 10"
    var m = /add\s+to[^:]*:\s*(.+)$/i.exec(String(note || ''));
    if (!m) return [];
    return m[1].split(/\s*[·•|]\s*/).map(function (x) { return cap(x.replace(/\s*\$?\d+(\.\d+)?\s*$/, '')); }).filter(Boolean);
  }
  function sections(menu) {
    var out = [];
    var tabs = (menu && menu.tabs) || [];
    var kitchen = tabs.filter(function (t) { return t.id === 'm-food' || /kitchen|food/i.test(t.label || ''); })[0];
    if (kitchen) (kitchen.groups || []).forEach(function (g) {
      var dishes = (g.items || []).filter(shown).filter(function (it) { return !isWine(it); }).map(function (it) {
        var main = titleParts(it.name), notes = {}, seen = {};
        var parts = [];
        main.forEach(function (t) { var k = keyOf(t.label); if (seen[k]) return; seen[k] = 1; parts.push(t.label); if (t.note) notes[k] = t.note; });
        var mainN = parts.length;
        splitParts(it.desc).forEach(function (p) { var k = keyOf(p); if (!seen[k]) { seen[k] = 1; parts.push(p); } });
        if (!parts.length) parts = [cap(it.src || 'See board')];
        return { name: it.name, src: it.desc || mainN ? it.src : '', parts: parts, mainN: mainN, notes: notes };
      });
      var adds = addOns(g.noteAfter).concat(addOns(g.note));
      if (adds.length) dishes.push({ name: 'Add-ons', src: '', parts: adds, addon: true });
      if (dishes.length) out.push({ id: 'k-' + keyOf(g.title), title: g.title, station: 'Kitchen', dishes: dishes });
    });
    if (P.bar) tabs.filter(function (t) { return /cocktail|bar/i.test(t.label || ''); }).forEach(function (t) {
      (t.groups || []).forEach(function (g) {
        var dishes = (g.items || []).filter(shown).filter(function (it) { return !isWine(it) && it.desc; }).map(function (it) { return { name: it.name, src: '', parts: splitParts(it.desc) }; });
        if (dishes.length) out.push({ id: 'b-' + keyOf(g.title), title: g.title, station: 'Bar', dishes: dishes });
      });
    });
    return out;
  }

  /* ---------- rendering ---------- */
  function parInput(k) {
    var i = h('input', { type: 'text', cls: 'pp-par', value: P.saved.pars[k] || '', 'aria-label': 'Par', placeholder: '' });
    i.addEventListener('input', function () { if (i.value.trim()) P.saved.pars[k] = i.value.trim(); else delete P.saved.pars[k]; persist(); });
    return i;
  }
  function removeBtn(k) {
    return h('button', { type: 'button', cls: 'pp-x', title: 'Remove this line from the prep list', 'aria-label': 'Remove line', text: '✕', on: { click: function () { P.saved.removed[k] = 1; persist(); render(); } } });
  }
  function row(label, used, k, cls) {
    return h('tr', { cls: cls || null }, [
      h('td', { cls: 'pp-chk' }, h('span', { cls: 'pp-box' })),
      h('td', { cls: 'pp-item' }, [h('span', { text: label }), used ? h('small', { text: used }) : null]),
      h('td', { cls: 'pp-num' }, parInput(k)),
      h('td', { cls: 'pp-num' }), h('td', { cls: 'pp-num' }), h('td', { cls: 'pp-ini' }),
      h('td', { cls: 'pp-tool' }, removeBtn(k))
    ]);
  }
  function table(rows) {
    return h('table', { cls: 'pp-table' }, [
      h('thead', null, h('tr', null, [h('th', { cls: 'pp-chk', text: '✓' }), h('th', { text: 'Item' }), h('th', { cls: 'pp-num', text: 'Par' }), h('th', { cls: 'pp-num', text: 'On hand' }), h('th', { cls: 'pp-num', text: 'Prep' }), h('th', { cls: 'pp-ini', text: 'Init.' }), h('th', { cls: 'pp-tool' })])),
      h('tbody', null, rows)
    ]);
  }
  function extraRows(secId) {
    return (P.saved.extra[secId] || []).map(function (name, i) {
      var k = 'x:' + secId + ':' + keyOf(name);
      var tr = row(name, 'Added by you', k, 'pp-extra');
      tr.querySelector('.pp-x').onclick = function () { P.saved.extra[secId].splice(i, 1); persist(); render(); };
      return tr;
    });
  }
  function addLine(secId, wrap) {
    var inp = h('input', { type: 'text', cls: 'pp-addin', placeholder: 'Add an item to this section, e.g. Pickled shallots' });
    var go = function () { var v = cap(inp.value); if (!v) return; (P.saved.extra[secId] = P.saved.extra[secId] || []).push(v); persist(); render(); };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    wrap.appendChild(h('div', { cls: 'pp-add' }, [inp, h('button', { type: 'button', cls: 'ed-btn small', text: 'Add', on: { click: go } })]));
  }

  function render() {
    var el = P.el; if (!el) return;
    var menu = P.ctx.getMenu();
    el.innerHTML = '';
    var wrap = h('div', { cls: 'pp-in' });
    el.appendChild(wrap);
    if (!menu) { wrap.appendChild(h('p', { cls: 'sc-empty', text: 'Loading the menu…' })); return; }
    var secs = sections(menu);

    // controls (screen only)
    var date = h('input', { type: 'date', value: P.date || iso(new Date()) });
    date.addEventListener('change', function () { P.date = date.value; render(); });
    var bar = h('input', { type: 'checkbox' }); bar.checked = P.bar;
    bar.addEventListener('change', function () { P.bar = bar.checked; render(); });
    var removedN = Object.keys(P.saved.removed).length;
    wrap.appendChild(h('div', { cls: 'pp-controls' }, [
      h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Kitchen' }), h('h1', { cls: 'sc-week', text: 'Prep List' })]),
      h('div', { cls: 'pp-ctl' }, [
        h('label', { cls: 'sc-f' }, [h('span', { text: 'Date' }), date]),
        h('div', { cls: 'sc-viewtog', role: 'group', 'aria-label': 'Layout' }, [
          h('button', { type: 'button', 'aria-pressed': P.mode === 'dish' ? 'true' : 'false', text: 'By dish', on: { click: function () { P.mode = 'dish'; render(); } } }),
          h('button', { type: 'button', 'aria-pressed': P.mode === 'combined' ? 'true' : 'false', text: 'Combined', on: { click: function () { P.mode = 'combined'; render(); } } })
        ]),
        h('label', { cls: 'sc-check' }, [bar, ' Include bar']),
        removedN ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Restore ' + removedN + ' removed line' + (removedN === 1 ? '' : 's'), on: { click: function () { P.saved.removed = {}; persist(); render(); } } }) : null,
        h('button', { type: 'button', cls: 'ed-btn', text: 'Print', on: { click: function () { window.print(); } } })
      ])
    ]));
    wrap.appendChild(h('p', { cls: 'pp-help', text: 'Built from the live menu: change a dish in the Menu editor and this list follows. Type pars in the Par column; they, any items you add, and lines you remove are remembered on this computer. “Combined” merges components used in more than one dish.' }));

    // the printable sheet
    var d = P.date ? new Date(P.date + 'T12:00:00') : new Date();
    var sheet = h('div', { cls: 'pp-sheet' });
    sheet.appendChild(h('div', { cls: 'pp-head' }, [
      h('div', null, [h('div', { cls: 'pp-brand', text: 'EDEN' }), h('div', { cls: 'pp-title', text: 'Prep List' + (P.mode === 'combined' ? ' · Combined' : '') })]),
      h('div', { cls: 'pp-meta' }, [
        h('div', null, [h('span', { text: 'Date' }), h('b', { text: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) })]),
        h('div', null, [h('span', { text: 'Covers' }), h('i')]),
        h('div', null, [h('span', { text: 'Prepped by' }), h('i')])
      ])
    ]));
    if (!secs.length) sheet.appendChild(h('p', { cls: 'sc-empty', text: 'No dishes on the Kitchen menu yet.' }));

    secs.forEach(function (sec) {
      var box = h('section', { cls: 'pp-sec' }, [h('h2', { cls: 'pp-sec-h' }, [sec.title, sec.station === 'Bar' ? h('span', { text: 'Bar' }) : null])]);
      var rows = [];
      if (P.mode === 'combined') {
        var map = {}, order = [];
        sec.dishes.forEach(function (dish) {
          dish.parts.forEach(function (p) {
            var k = keyOf(p);
            if (!map[k]) { map[k] = { label: p, used: [], main: false }; order.push(k); }
            if (dish.parts.indexOf(p) < (dish.mainN || 0)) map[k].main = true;
            if (!dish.addon && map[k].used.indexOf(dish.name) === -1) map[k].used.push(dish.name);
          });
        });
        order.forEach(function (k) {
          var key = 'c:' + sec.id + ':' + k; if (P.saved.removed[key]) return;
          var it = map[k];
          rows.push(row(it.label, it.used.length ? it.used.join(', ') : (sec.dishes.some(function (x) { return x.addon && x.parts.some(function (p) { return keyOf(p) === k; }); }) ? 'Add-on' : ''), key, [it.used.length > 1 ? 'pp-shared' : '', it.main ? 'pp-main' : ''].join(' ').trim() || null));
        });
      } else {
        sec.dishes.forEach(function (dish) {
          var dishRows = [];
          dish.parts.forEach(function (p, i) {
            var key = 'd:' + sec.id + ':' + keyOf(dish.name) + ':' + keyOf(p); if (P.saved.removed[key]) return;
            var main = i < (dish.mainN || 0);
            dishRows.push(row(p, main && dish.notes[keyOf(p)] ? cap(dish.notes[keyOf(p)]) : '', key, main ? 'pp-main' : null));
          });
          if (!dishRows.length) return;
          rows.push(h('tr', { cls: 'pp-dish' }, [h('td', { colspan: '7' }, [h('b', { text: dish.name }), dish.src ? h('span', { text: dish.src }) : null])]));
          rows = rows.concat(dishRows);
        });
      }
      var extras = extraRows(sec.id);
      if (extras.length) { if (P.mode === 'dish') rows.push(h('tr', { cls: 'pp-dish' }, [h('td', { colspan: '7' }, h('b', { text: 'Also' }))])); rows = rows.concat(extras); }
      box.appendChild(table(rows));
      addLine(sec.id, box);
      sheet.appendChild(box);
    });
    sheet.appendChild(h('div', { cls: 'pp-notes' }, [h('span', { text: 'Notes / 86’d' }), h('i'), h('i'), h('i')]));
    wrap.appendChild(sheet);
  }

  window.EdenPrep = {
    show: function (ctx) { P.ctx = ctx; P.el = ctx.el; render(); },
    refresh: function () {
      if (!P.el || P.el.hidden) return;
      var a = document.activeElement; if (a && P.el.contains(a) && a.tagName === 'INPUT') return; // don't wipe a par mid-typing
      render();
    },
    _test: { sections: sections, titleParts: titleParts, splitParts: splitParts, addOns: addOns, P: P }
  };
})();
