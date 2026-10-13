/* Eden staff site: the Prep List, built from the live menu, filled in by the kitchen and printable.
 *
 * A fixed Basics section comes first. Every visible dish on the Kitchen menu becomes a block: the dish (with its farm or producer), the main
 * ingredient(s) named in its title, and each component from its description ("Israeli couscous, charred tomatillo, …"). Add-ons written in a section
 * note ("Add to any large plate: Chickpea & Red Miso Butter 6 · …") become their own items.
 * "Combined" view merges components shared by several dishes into one line.
 *
 * Fillable: tick a line when it's done, and fill in On hand, Prep and initials. What's filled in, items added and
 * lines taken off are shared by everyone who can see the list (Owner, managers, Kitchen logins, cooks), saved in
 * Supabase (supabase/prep-list.sql). The Owner and managers can reset it for the next day; it resets itself at
 * 8:00 pm if nobody does. Used on the staff site (#prep) and on the staff page's Prep List tab (cooks).
 * Before prep-list.sql is run, it works on this device only (browser storage), as it used to.
 */
(function () {
  'use strict';
  var KEY = 'eden-prep-v1', EKEY = 'eden-prep-entries';
  var P = { ctx: null, el: null, mode: 'dish', bar: false, saved: load(), db: null, st: null, menu: null, pend: {}, timers: {} };

  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { return {}; } }
  function persist() { try { localStorage.setItem(KEY, JSON.stringify(P.saved)); if (P.db === false) localStorage.setItem(EKEY, JSON.stringify(P.st.entries)); } catch (e) {} }
  P.saved.removed = P.saved.removed || {}; P.saved.extra = P.saved.extra || {};
  function localState() {
    var ent = {}; try { ent = JSON.parse(localStorage.getItem(EKEY) || '{}') || {}; } catch (e) {}
    return { for_date: iso(new Date()), entries: ent, extra: P.saved.extra, removed: P.saved.removed, can_reset: true, me: (P.ctx && P.ctx.name) || '' };
  }
  function initials(n) { return String(n || '').split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(function (w) { return w[0].toUpperCase(); }).join(''); }
  function gone(e) { return !!(e && (e.code === 'PGRST202' || e.code === '42883' || e.code === 'PGRST205' || /could not find the function|does not exist|schema cache/i.test(e.message || ''))); }

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

  /* ---------- the shared list: load, fill in, reset ---------- */
  function loadState() {
    var sb = P.ctx.sb;
    if (!sb || P.db === false) { P.db = false; P.st = localState(); return Promise.resolve(); }
    return sb.rpc('prep_get').then(function (r) {
      if (r.error) { if (gone(r.error)) { P.db = false; P.st = localState(); } else { P.err = true; if (!P.st) P.st = localState(); } return; }
      if (r.data && r.data.error) { P.denied = true; P.st = localState(); return; }
      P.db = true; P.err = false; P.st = norm(r.data);
      // once: bring over items added / lines removed that were saved on this computer before the list was shared
      var hasLocal = Object.keys(P.saved.extra).length || Object.keys(P.saved.removed).length;
      if (hasLocal && !Object.keys(P.st.extra).length && !Object.keys(P.st.removed).length && !P.saved.imported) {
        return sb.rpc('prep_import', { p_extra: P.saved.extra, p_removed: P.saved.removed }).then(function (x) {
          if (x && !x.error && x.data && !x.data.error) { P.st = norm(x.data); P.saved.imported = 1; persist(); }
        }, function () {});
      }
    }, function () { P.err = true; if (!P.st) P.st = localState(); });
  }
  function norm(d) { d = d || {}; d.entries = d.entries || {}; d.extra = d.extra || {}; d.removed = d.removed || {}; return d; }
  function entry(k) { return (P.st && P.st.entries[k]) || {}; }
  // one box changed: saved straight away (typing waits half a second)
  function setField(k, f, v, wait) {
    var e = P.st.entries[k] = Object.assign({}, P.st.entries[k] || {}); e[f] = v;
    if (P.db !== true) { persist(); return; }
    var id = k + '|' + f; P.pend[id] = v; clearTimeout(P.timers[id]);
    P.timers[id] = setTimeout(function () {
      P.ctx.sb.rpc('prep_set', { p_key: k, p_field: f, p_value: String(v) }).then(function (r) {
        if (P.pend[id] === v) delete P.pend[id];
        if (r.error || (r.data && r.data.error)) { say('Couldn’t save that. Check your connection.', 'err'); return; }
        say('');
      }, function () { say('Couldn’t save that. Check your connection.', 'err'); });
    }, wait ? 500 : 0);
  }
  function rowCall(name, args, local) {
    if (P.db !== true) { local(); persist(); render(); return; }
    local(); render();
    P.ctx.sb.rpc(name, args).then(function (r) {
      if (r.error || !r.data || r.data.error) { say('Couldn’t save that. Check your connection.', 'err'); return; }
      var keepEntries = P.st.entries; P.st = norm(r.data); P.st.entries = Object.assign({}, P.st.entries, keepEntries); render();
    }, function () { say('Couldn’t save that. Check your connection.', 'err'); });
  }
  function hideLine(k) { rowCall('prep_hide', { p_key: k, p_on: true }, function () { P.st.removed[k] = 1; }); }
  function restoreAll() { rowCall('prep_hide', { p_key: null, p_on: false }, function () { P.st.removed = {}; if (P.db !== true) P.saved.removed = P.st.removed; }); }
  function addExtra(sec, name) { rowCall('prep_extra', { p_section: sec, p_name: name, p_add: true }, function () { (P.st.extra[sec] = P.st.extra[sec] || []).push(name); }); }
  function delExtra(sec, name) { rowCall('prep_extra', { p_section: sec, p_name: name, p_add: false }, function () { P.st.extra[sec] = (P.st.extra[sec] || []).filter(function (x) { return x !== name; }); if (!P.st.extra[sec].length) delete P.st.extra[sec]; }); }
  function resetList() {
    if (!confirm('Reset the prep list for the next day? Everything ticked and filled in is cleared for everyone. Items added and lines taken off stay.')) return;
    if (P.db !== true) { P.st.entries = {}; persist(); render(); return; }
    P.ctx.sb.rpc('prep_reset').then(function (r) {
      if (r.error || !r.data || r.data.error) { say(r.data && r.data.error === 'not_allowed' ? 'Only the Owner and managers can reset the list.' : 'Couldn’t reset. Try again.', 'err'); return; }
      P.st = norm(r.data); render(); say('Reset for ' + longDay(P.st.for_date) + '.', 'ok');
    }, function () { say('Couldn’t reset. Try again.', 'err'); });
  }
  function say(t, k) { var m = P.el && P.el.querySelector('.pp-msg'); if (m) { m.textContent = t || ''; m.className = 'pp-msg' + (k ? ' ' + k : ''); } }
  function longDay(d) { return d ? new Date(d + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }) : ''; }
  // others' changes show up every 15 seconds (without disturbing a box being typed in)
  function poll() {
    if (P.db !== true || !P.el || P.el.hidden || document.hidden || P.el.offsetParent === null) return;
    var before = P.st && (P.st.for_date + '|' + P.st.reset_at + '|' + JSON.stringify(P.st.extra) + '|' + JSON.stringify(P.st.removed));
    P.ctx.sb.rpc('prep_get').then(function (r) {
      if (r.error || !r.data || r.data.error) return;
      var d = norm(r.data), after = d.for_date + '|' + d.reset_at + '|' + JSON.stringify(d.extra) + '|' + JSON.stringify(d.removed);
      Object.keys(P.pend).forEach(function (id) { var i = id.lastIndexOf('|'), k = id.slice(0, i), f = id.slice(i + 1); d.entries[k] = Object.assign({}, d.entries[k] || {}); d.entries[k][f] = P.pend[id]; });
      P.st = d;
      var a = document.activeElement, typing = a && P.el.contains(a) && a.tagName === 'INPUT';
      if (after !== before && !typing) { render(); return; }
      paintEntries();
    }, function () {});
  }
  setInterval(poll, 15000);
  document.addEventListener('visibilitychange', function () { if (!document.hidden) poll(); });
  function paintEntries() {
    if (!P.el) return;
    var a = document.activeElement;
    P.el.querySelectorAll('[data-k]').forEach(function (tr) {
      var pp = tr.querySelector('.pa-prep'); if (pp) paintPrep(pp, entry(tr.getAttribute('data-k')).prep || '');
      var e = entry(tr.getAttribute('data-k'));
      tr.classList.toggle('is-done', !!e.done);
      var b = tr.querySelector('.pp-box'); if (b) b.setAttribute('aria-checked', e.done ? 'true' : 'false');
      tr.querySelectorAll('input[data-f]').forEach(function (i) { if (i !== a) i.value = e[i.getAttribute('data-f')] || ''; });
      var sel = tr.querySelector('select[data-f=prep]');
      if (sel && sel !== a) { var pv = e.prep || ''; if (pv && !sel.querySelector('option[value="' + pv.replace(/"/g, '') + '"]')) sel.appendChild(h('option', { value: pv, text: pv })); sel.value = pv; paintSel(sel); }
      var ib = tr.querySelector('.pp-inibtn'); if (ib) ib.textContent = e.ini || '';
    });
    if (P.ctx && P.ctx.app) appCount(); else paintCount();
  }
  function paintCount() {
    var c = P.el && P.el.querySelector('.pp-count'); if (!c) return;
    var all = P.el.querySelectorAll('.pp-sheet tr[data-k]'), done = P.el.querySelectorAll('.pp-sheet tr[data-k].is-done');
    c.textContent = done.length + ' of ' + all.length + ' done';
  }
  // the menu, for the staff page (the staff site passes in its own live copy)
  function loadMenu() {
    if (P.ctx.getMenu || P.menu) return Promise.resolve();
    return P.ctx.sb.from('site_docs').select('path,data').like('path', 'site/menu%').then(function (r) {
      var rows = {}; ((r && r.data) || []).forEach(function (x) { rows[x.path] = x.data; });
      var m = rows['site/menu']; if (!m || !m.tabs) { P.menu = { tabs: [] }; return; }
      P.menu = { tabs: m.tabs.map(function (t) {
        return { id: t.id, label: t.label, groups: (t.gids || []).filter(function (id) { return rows['site/menu/groups/' + id]; }).map(function (id) { var x = rows['site/menu/groups/' + id]; return { id: id, title: x.title, note: x.note, noteAfter: x.noteAfter, items: x.items || [] }; }) };
      }) };
    }, function () { P.menu = { tabs: [] }; });
  }
  function getMenu() { return P.ctx.getMenu ? P.ctx.getMenu() : P.menu; }

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
  var BASICS = ['Garlic', 'Shallots', 'Thyme', 'Orange vinaigrette', 'Tallow'];
  function sections(menu) {
    var tabs = (menu && menu.tabs) || [], out = [];
    if (P.bar) { // bar prep: cocktail and bar sections only
      tabs.filter(function (t) { return /cocktail|bar/i.test(t.label || ''); }).forEach(function (t) {
        (t.groups || []).forEach(function (g) {
          var dishes = (g.items || []).filter(shown).filter(function (it) { return !isWine(it) && it.desc; }).map(function (it) { return { name: it.name, src: '', parts: splitParts(it.desc), mainN: 0, notes: {} }; });
          if (dishes.length) out.push({ id: 'b-' + keyOf(g.title), title: g.title, station: t.label || 'Bar', dishes: dishes });
        });
      });
      return out;
    }
    out.push({ id: 'basics', title: 'Basics', station: 'Every day', basic: true, dishes: [{ name: '', src: '', parts: BASICS.slice(), mainN: 0, notes: {}, basic: true }] });
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
      if (adds.length) dishes.push({ name: 'Add-ons', src: '', parts: adds, addon: true, mainN: 0, notes: {} });
      if (dishes.length) out.push({ id: 'k-' + keyOf(g.title), title: g.title, station: 'Kitchen', dishes: dishes });
    });
    return out;
  }

  /* ---------- rendering ---------- */
  function removeBtn(k) {
    return h('button', { type: 'button', cls: 'pp-x', title: 'Take this line off the prep list', 'aria-label': 'Take line off the list', text: '✕', on: { click: function () { hideLine(k); } } });
  }
  function box(k, f, label, max) {
    var i = h('input', { type: 'text', cls: f === 'ini' ? 'pp-fill-ini' : 'pp-fill', 'data-f': f, value: entry(k)[f] || '', 'aria-label': label, maxlength: String(max), autocomplete: 'off', autocapitalize: f === 'ini' ? 'characters' : 'off', spellcheck: 'false' });
    i.addEventListener('input', function () { setField(k, f, f === 'ini' ? i.value.toUpperCase() : i.value, true); });
    i.addEventListener('blur', function () { if (f === 'ini' && i.value !== i.value.toUpperCase()) i.value = i.value.toUpperCase(); });
    return i;
  }
  // Prep: Do or X
  function prepSel(k, label) {
    var v = entry(k).prep || '';
    var sel = h('select', { cls: 'pp-sel', 'data-f': 'prep', 'aria-label': 'Prep: ' + label }, [h('option', { value: '', text: '–' }), h('option', { value: 'Do', text: 'Do' }), h('option', { value: 'X', text: 'X' })]);
    if (v && v !== 'Do' && v !== 'X') sel.appendChild(h('option', { value: v, text: v }));   // an older typed value
    sel.value = v; paintSel(sel);
    sel.addEventListener('change', function () { setField(k, 'prep', sel.value); paintSel(sel); });
    return sel;
  }
  function paintSel(sel) { sel.classList.toggle('is-do', sel.value === 'Do'); sel.classList.toggle('is-x', sel.value === 'X'); }
  // Init.: tap to sign with your initials (tap again to take them off)
  function iniBtn(k, label) {
    var v = entry(k).ini || '';
    var b = h('button', { type: 'button', cls: 'pp-inibtn', 'data-f': 'ini', 'aria-label': 'Initials: ' + label + (v ? ' (' + v + ')' : ''), title: 'Tap to put your initials here', text: v });
    b.addEventListener('click', function () {
      var mine = initials(P.st.me), cur = entry(k).ini || '';
      if (!mine) { say('Couldn’t tell who you are to add your initials.', 'err'); return; }
      var nv = cur === mine ? '' : mine;
      setField(k, 'ini', nv); b.textContent = nv; b.setAttribute('aria-label', 'Initials: ' + label + (nv ? ' (' + nv + ')' : ''));
    });
    return b;
  }
  function row(label, used, k, cls) {
    var e = entry(k);
    var chk = h('button', { type: 'button', cls: 'pp-box', role: 'checkbox', 'aria-checked': e.done ? 'true' : 'false', 'aria-label': 'Done: ' + label });
    var tr = h('tr', { cls: [cls || '', e.done ? 'is-done' : ''].join(' ').trim() || null, 'data-k': k }, [
      h('td', { cls: 'pp-chk' }, chk),
      h('td', { cls: 'pp-item' }, [h('span', { text: label }), used ? h('small', { text: used }) : null]),
      h('td', { cls: 'pp-num' }, box(k, 'onhand', 'On hand: ' + label, 40)),
      h('td', { cls: 'pp-num' }, prepSel(k, label)),
      h('td', { cls: 'pp-ini' }, iniBtn(k, label)),
      h('td', { cls: 'pp-tool' }, removeBtn(k))
    ]);
    chk.addEventListener('click', function () {
      var on = !entry(k).done;
      setField(k, 'done', on);
      // ticking a line signs it with your initials, if nobody has
      var ini = tr.querySelector('.pp-inibtn');
      if (on && ini && !ini.textContent.trim() && P.st.me) { ini.textContent = initials(P.st.me); setField(k, 'ini', ini.textContent); }
      chk.setAttribute('aria-checked', on ? 'true' : 'false'); tr.classList.toggle('is-done', on); paintCount();
    });
    return tr;
  }
  function table(rows) {
    return h('table', { cls: 'pp-table' }, [
      h('thead', null, h('tr', null, [h('th', { cls: 'pp-chk', text: '✓' }), h('th', { text: 'Item' }), h('th', { cls: 'pp-num', text: 'On hand' }), h('th', { cls: 'pp-num', text: 'Prep' }), h('th', { cls: 'pp-ini', text: 'Init.' }), h('th', { cls: 'pp-tool' })])),
    ].concat(rows.length && rows.every(function (r) { return r.tagName === 'TBODY'; }) ? rows : [h('tbody', null, rows)]));
  }
  function extraRows(secId) {
    return (P.st.extra[secId] || []).map(function (name) {
      var k = 'x:' + secId + ':' + keyOf(name);
      var tr = row(name, 'Added', k, 'pp-extra');
      tr.querySelector('.pp-x').onclick = function () { delExtra(secId, name); };
      return tr;
    });
  }
  function addLine(secId, wrap) {
    var inp = h('input', { type: 'text', cls: 'pp-addin', placeholder: 'Add an item to this section, e.g. Pickled shallots' });
    var go = function () { var v = cap(inp.value); if (!v) return; addExtra(secId, v); };
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    wrap.appendChild(h('div', { cls: 'pp-add' }, [inp, h('button', { type: 'button', cls: 'ed-btn small', text: 'Add', on: { click: go } })]));
  }

  // Split sections, in order, into n columns so the tallest column is as short as possible.
  function partition(weights, n) {
    var best = null;
    (function go(start, k, cols) {
      if (k === 1) { var c = cols.concat([[start, weights.length]]); var mx = Math.max.apply(null, c.map(function (r) { return sum(r); })); if (!best || mx < best.mx) best = { mx: mx, cols: c }; return; }
      for (var e = start + 1; e <= weights.length - (k - 1); e++) go(e, k - 1, cols.concat([[start, e]])); // no empty columns
    })(0, n, []);
    function sum(r) { var t = 0; for (var i = r[0]; i < r[1]; i++) t += weights[i]; return t; }
    return best.cols;
  }

  function buildSection(sec) {
    var rows = [], n = 0;
    if (P.mode === 'combined') {
      var map = {}, order = [];
      sec.dishes.forEach(function (dish) {
        dish.parts.forEach(function (p, i) {
          var k = keyOf(p);
          if (!map[k]) { map[k] = { label: p, used: [], main: false, addon: false }; order.push(k); }
          if (i < (dish.mainN || 0)) map[k].main = true;
          if (dish.addon) map[k].addon = true;
          else if (!dish.basic && map[k].used.indexOf(dish.name) === -1) map[k].used.push(dish.name);
        });
      });
      order.forEach(function (k) {
        var key = 'c:' + sec.id + ':' + k; if (P.st.removed[key]) return;
        var it = map[k];
        rows.push(row(it.label, it.used.length ? it.used.join(', ') : it.addon ? 'Add-on' : '', key, [it.used.length > 1 ? 'pp-shared' : '', it.main ? 'pp-main' : ''].join(' ').trim() || null)); n++;
      });
    } else {
      sec.dishes.forEach(function (dish) {
        var dishRows = [];
        dish.parts.forEach(function (p, i) {
          var key = 'd:' + sec.id + ':' + keyOf(dish.name) + ':' + keyOf(p); if (P.st.removed[key]) return;
          var main = i < (dish.mainN || 0);
          dishRows.push(row(p, main && dish.notes[keyOf(p)] ? cap(dish.notes[keyOf(p)]) : '', key, main ? 'pp-main' : null));
        });
        if (!dishRows.length) return;
        n += dishRows.length;
        if (!dish.basic) { dishRows.unshift(h('tr', { cls: 'pp-dish' }, [h('td', { colspan: '6' }, [h('b', { text: dish.name }), dish.src ? h('span', { text: dish.src }) : null])])); n += 1.3; }
        rows.push(h('tbody', { cls: 'pp-group' }, dishRows)); // a dish and its lines stay together
      });
    }
    var extras = extraRows(sec.id);
    if (extras.length) {
      n += extras.length;
      if (P.mode === 'dish') { if (!sec.basic) { extras.unshift(h('tr', { cls: 'pp-dish' }, [h('td', { colspan: '6' }, h('b', { text: 'Also' }))])); n += 1.3; } rows.push(h('tbody', { cls: 'pp-group' }, extras)); }
      else rows = rows.concat(extras);
    }
    var count = 0; rows.forEach(function (r) { count += r.tagName === 'TBODY' ? r.querySelectorAll('tr:not(.pp-dish)').length : 1; });
    var box = h('section', { cls: 'pp-sec' + (sec.basic ? ' pp-basics' : ''), 'data-sec': sec.id }, [
      h('header', { cls: 'pp-sec-h' }, [h('h2', { text: sec.title }), h('span', { text: (sec.station ? sec.station + ' · ' : '') + count + ' item' + (count === 1 ? '' : 's') })]),
      rows.length ? table(rows) : h('p', { cls: 'pp-none', text: 'Nothing left in this section.' })
    ]);
    addLine(sec.id, box);
    return { el: box, weight: n + 3.5 };
  }

  /* ---------- the cooks' screen (staff page): a clean checklist, made for phones and iPads ---------- */
  P.filter = 'all'; P.q = ''; P.editing = false;
  function appItems(secs) {
    // every line, in order, grouped by section and dish (same lines and keys as the printable list)
    return secs.map(function (sec) {
      var groups = [];
      sec.dishes.forEach(function (dish) {
        var items = [];
        dish.parts.forEach(function (p, i) {
          var key = 'd:' + sec.id + ':' + keyOf(dish.name) + ':' + keyOf(p); if (P.st.removed[key]) return;
          var main = i < (dish.mainN || 0);
          items.push({ k: key, label: p, sub: main && dish.notes[keyOf(p)] ? cap(dish.notes[keyOf(p)]) : '' });
        });
        if (items.length) groups.push({ name: dish.basic ? '' : dish.name, src: dish.src || '', items: items });
      });
      var ex = (P.st.extra[sec.id] || []).map(function (name) { return { k: 'x:' + sec.id + ':' + keyOf(name), label: name, sub: '', extra: name }; });
      if (ex.length) groups.push({ name: sec.basic ? '' : 'Also', src: '', items: ex });
      return { sec: sec, groups: groups };
    });
  }
  function appCount() {
    var all = P.appKeys || [], d = 0; all.forEach(function (k) { if (entry(k).done) d++; });
    var t = P.el && P.el.querySelector('.pa-progt'), b = P.el && P.el.querySelector('.pa-prog i');
    if (t) t.textContent = d + ' of ' + all.length + ' done';
    if (b) b.style.width = (all.length ? Math.round(d / all.length * 100) : 0) + '%';
    if (P.el) P.el.querySelectorAll('.pa-sec').forEach(function (sec) {
      var ks = (sec.getAttribute('data-keys') || '').split('\n').filter(Boolean), n = 0; ks.forEach(function (k) { if (entry(k).done) n++; });
      var c = sec.querySelector('.pa-sec-n'); if (c) c.textContent = n + '/' + ks.length;
      sec.classList.toggle('is-all', ks.length > 0 && n === ks.length);
    });
  }
  function seg(cls, label, opts, cur, pick) {
    return h('div', { cls: 'pa-seg ' + cls, role: 'group', 'aria-label': label }, opts.map(function (o) {
      return h('button', { type: 'button', 'aria-pressed': o[0] === cur ? 'true' : 'false', text: o[1], on: { click: function () { pick(o[0]); } } });
    }));
  }
  function appItem(it, secId) {
    var k = it.k, e = entry(k);
    var chk = h('button', { type: 'button', cls: 'pp-box pa-check', role: 'checkbox', 'aria-checked': e.done ? 'true' : 'false', 'aria-label': 'Done: ' + it.label });
    var oh = h('input', { type: 'text', cls: 'pa-oh', 'data-f': 'onhand', value: e.onhand || '', placeholder: 'On hand', 'aria-label': 'On hand: ' + it.label, maxlength: '40', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    oh.addEventListener('input', function () { setField(k, 'onhand', oh.value, true); });
    oh.addEventListener('keydown', function (ev) { if (ev.key === 'Enter') oh.blur(); });
    var prep = h('div', { cls: 'pa-prep', role: 'group', 'aria-label': 'Prep: ' + it.label }, [['Do', 'Do'], ['X', 'X']].map(function (o) {
      return h('button', { type: 'button', 'data-v': o[0], 'aria-pressed': e.prep === o[0] ? 'true' : 'false', text: o[1], on: { click: function () {
        var nv = entry(k).prep === o[0] ? '' : o[0]; setField(k, 'prep', nv); paintPrep(prep, nv);
      } } });
    }));
    var ini = iniBtn(k, it.label); ini.classList.add('pa-ini');
    var row = h('div', { cls: 'pa-item' + (e.done ? ' is-done' : ''), 'data-k': k }, [
      chk,
      h('div', { cls: 'pa-name' }, [h('b', { text: it.label }), it.sub ? h('span', { text: it.sub }) : null, it.extra ? h('span', { text: 'Added' }) : null]),
      h('div', { cls: 'pa-ctl' }, [oh, prep, ini]),
      P.editing ? h('button', { type: 'button', cls: 'pa-x', 'aria-label': 'Take ' + it.label + ' off the list', text: '✕', on: { click: function () { if (it.extra) delExtra(secId, it.extra); else hideLine(k); } } }) : null
    ]);
    chk.addEventListener('click', function () {
      var on = !entry(k).done;
      setField(k, 'done', on);
      if (on && !(entry(k).ini || '').trim() && P.st.me) { ini.textContent = initials(P.st.me); setField(k, 'ini', ini.textContent); }
      chk.setAttribute('aria-checked', on ? 'true' : 'false'); row.classList.toggle('is-done', on); appCount();
    });
    return row;
  }
  function paintPrep(box, v) { box.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-v') === v ? 'true' : 'false'); }); }
  function renderApp() {
    var el = P.el; el.innerHTML = '';
    var wrap = h('div', { cls: 'pa' }); el.appendChild(wrap);
    var menu = getMenu();
    if (!menu || !P.st) { wrap.appendChild(h('p', { cls: 'pa-empty', text: 'Loading the prep list…' })); return; }
    if (P.denied) { wrap.appendChild(h('p', { cls: 'pa-empty', text: 'The Prep List is for the kitchen: the Owner, managers and cooks.' })); return; }
    var data = appItems(sections(menu));
    P.appKeys = []; data.forEach(function (d) { d.groups.forEach(function (g) { g.items.forEach(function (it) { P.appKeys.push(it.k); }); }); });
    var resetInfo = P.st.reset_at ? (P.st.reset_auto ? 'Reset automatically ' : 'Reset by ' + (P.st.reset_by || 'a manager') + ' ') + new Date(P.st.reset_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    // top: the day, and how far along
    wrap.appendChild(h('header', { cls: 'pa-top' }, [
      h('div', { cls: 'pa-title' }, [h('p', { cls: 'pa-eyebrow', text: P.bar ? 'Bar' : 'Kitchen' }), h('h1', { text: P.bar ? 'Bar Prep' : 'Prep List' }),
        h('p', { cls: 'pa-for', text: 'For ' + longDay(P.st.for_date) })]),
      P.st.can_reset ? h('button', { type: 'button', cls: 'pa-reset', text: 'Reset for next day', on: { click: resetList } }) : null
    ]));
    wrap.appendChild(h('div', { cls: 'pa-progress' }, [h('div', { cls: 'pa-prog', 'aria-hidden': 'true' }, h('i')), h('span', { cls: 'pa-progt' })]));
    wrap.appendChild(h('p', { cls: 'pp-msg', role: 'status' }));
    if (P.db === false && P.ctx.role === 'owner') wrap.appendChild(h('p', { cls: 'pp-setup', text: 'To share the Prep List, run supabase/prep-list.sql in Supabase, then reload.' }));
    // controls
    var q = h('input', { type: 'search', cls: 'pa-q', placeholder: 'Find an item', value: P.q, 'aria-label': 'Find an item', autocomplete: 'off' });
    q.addEventListener('input', function () { P.q = q.value; paintBody(); });
    wrap.appendChild(h('div', { cls: 'pa-ctls' }, [
      h('div', { cls: 'pa-qwrap' }, q),
      seg('pa-show', 'Show', [['all', 'All'], ['todo', 'To do'], ['done', 'Done']], P.filter, function (v) { P.filter = v; renderApp(); }),
      seg('pa-list', 'List', [['k', 'Kitchen'], ['b', 'Bar']], P.bar ? 'b' : 'k', function (v) { P.bar = v === 'b'; renderApp(); }),
      h('button', { type: 'button', cls: 'pa-edit', 'aria-pressed': P.editing ? 'true' : 'false', text: P.editing ? 'Done editing' : 'Edit list', on: { click: function () { P.editing = !P.editing; renderApp(); } } })
    ]));
    // jump to a section
    if (data.length > 1) wrap.appendChild(h('nav', { cls: 'pa-jump', 'aria-label': 'Sections' }, data.filter(function (d) { return d.groups.length || P.editing; }).map(function (d) {
      return h('button', { type: 'button', text: d.sec.title, on: { click: function () { var t = wrap.querySelector('[data-sec="' + d.sec.id + '"]'); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } });
    })));
    var body = h('div', { cls: 'pa-body' }); wrap.appendChild(body);
    function paintBody() {
      body.innerHTML = '';
      var words = fold(P.q).split(/\s+/).filter(Boolean), shownN = 0;
      data.forEach(function (d) {
        var keys = [], groups = [];
        d.groups.forEach(function (g) {
          g.items.forEach(function (it) { keys.push(it.k); });
          var its = g.items.filter(function (it) {
            var e = entry(it.k);
            if (P.filter === 'todo' && e.done) return false;
            if (P.filter === 'done' && !e.done) return false;
            var hay = fold(it.label + ' ' + g.name + ' ' + (it.sub || ''));
            return words.every(function (w) { return hay.indexOf(w) !== -1; });
          });
          if (its.length) groups.push({ g: g, items: its });
        });
        if (!groups.length && !P.editing) return;
        var sec = h('section', { cls: 'pa-sec', 'data-sec': d.sec.id, 'data-keys': keys.join('\n') }, [
          h('header', { cls: 'pa-sec-h' }, [h('h2', { text: d.sec.title }), h('span', { cls: 'pa-sec-n' })])
        ]);
        groups.forEach(function (gr) {
          if (gr.g.name) sec.appendChild(h('div', { cls: 'pa-dish' }, [h('b', { text: gr.g.name }), gr.g.src ? h('span', { text: gr.g.src }) : null]));
          gr.items.forEach(function (it) { sec.appendChild(appItem(it, d.sec.id)); shownN++; });
        });
        if (P.editing) {
          var inp = h('input', { type: 'text', placeholder: 'Add an item to ' + d.sec.title, 'aria-label': 'Add an item to ' + d.sec.title });
          var go = function () { var v = cap(inp.value); if (v) addExtra(d.sec.id, v); };
          inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); go(); } });
          sec.appendChild(h('div', { cls: 'pa-add' }, [inp, h('button', { type: 'button', text: 'Add', on: { click: go } })]));
        }
        body.appendChild(sec);
      });
      if (!shownN && !P.editing) body.appendChild(h('p', { cls: 'pa-empty', text: P.q ? 'Nothing matches “' + P.q.trim() + '”.' : P.filter === 'todo' ? 'Everything’s done. Nice work.' : P.filter === 'done' ? 'Nothing ticked off yet.' : (P.bar ? 'No cocktails with ingredients on the menu yet.' : 'No dishes on the Kitchen menu yet.') }));
      if (resetInfo) body.appendChild(h('p', { cls: 'pa-foot', text: resetInfo + ' · resets for the next day at 8:00 pm' }));
      appCount();
    }
    paintBody();
  }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); }

  function render() {
    var el = P.el; if (!el) return;
    if (P.ctx && P.ctx.app) { renderApp(); return; }
    var menu = getMenu();
    el.innerHTML = '';
    var wrap = h('div', { cls: 'pp-in' });
    el.appendChild(wrap);
    if (!menu || !P.st) { wrap.appendChild(h('p', { cls: 'sc-empty', text: 'Loading the prep list…' })); return; }
    if (P.denied) { wrap.appendChild(h('p', { cls: 'sc-empty', text: 'The Prep List is for the kitchen: the Owner, managers and cooks.' })); return; }
    var secs = sections(menu);

    // controls (screen only)
    var removedN = Object.keys(P.st.removed).length;
    var resetInfo = P.st.reset_at ? (P.st.reset_auto ? 'Reset automatically ' : 'Reset by ' + (P.st.reset_by || 'a manager') + ' ') + new Date(P.st.reset_at).toLocaleString(undefined, { weekday: 'short', hour: 'numeric', minute: '2-digit' }) : '';
    wrap.appendChild(h('div', { cls: 'pp-controls' }, [
      h('div', null, [h('p', { cls: 'sc-eyebrow', text: P.bar ? 'Bar' : 'Kitchen' }), h('h1', { cls: 'sc-week', text: P.bar ? 'Bar Prep List' : 'Prep List' }),
        h('p', { cls: 'pp-for' }, [h('b', { text: 'For ' + longDay(P.st.for_date) }), h('span', { cls: 'pp-count' }), resetInfo ? h('span', { cls: 'pp-reset-i', text: resetInfo }) : null])]),
      h('div', { cls: 'pp-ctl' }, [
        P.st.can_reset ? h('button', { type: 'button', cls: 'ed-btn pp-resetbtn', text: 'Reset for next day', title: 'Clear everything ticked and filled in, for everyone', on: { click: resetList } }) : null,
        h('div', { cls: 'sc-viewtog', role: 'group', 'aria-label': 'Layout' }, [
          h('button', { type: 'button', 'aria-pressed': P.mode === 'dish' ? 'true' : 'false', text: 'By dish', on: { click: function () { P.mode = 'dish'; render(); } } }),
          h('button', { type: 'button', 'aria-pressed': P.mode === 'combined' ? 'true' : 'false', text: 'Combined', on: { click: function () { P.mode = 'combined'; render(); } } })
        ]),
        h('div', { cls: 'sc-viewtog pp-bartog', role: 'group', 'aria-label': 'List' }, [
          h('button', { type: 'button', cls: 'pp-barbtn', 'aria-pressed': P.bar ? 'true' : 'false', title: P.bar ? 'Back to the kitchen prep list' : 'Show the bar prep list', text: 'Bar prep', on: { click: function () { P.bar = !P.bar; render(); } } })
        ]),
        removedN ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Restore ' + removedN + ' removed line' + (removedN === 1 ? '' : 's'), on: { click: restoreAll } }) : null,
        h('button', { type: 'button', cls: 'ed-btn pp-printbtn', text: 'Print', on: { click: preview } })
      ])
    ]));
    wrap.appendChild(h('p', { cls: 'pp-help', text: (P.bar ? 'Bar prep, built from the cocktail menu. Print prints just this bar list. ' : 'Built from the live menu: change a dish in the Menu editor and this list follows. ') +
      (P.db === true ? 'Tick a line when it’s done, fill in On hand, pick Do or X for Prep, and tap Init. to sign it; it saves as you go and everyone on the kitchen team sees the same list. It resets for the next day at 8:00 pm unless the Owner or a manager resets it first. ' : 'Tick lines and fill in the boxes; on this device only until supabase/prep-list.sql is run in Supabase. ') +
      '“Combined” merges components used in more than one dish (it keeps its own ticks). Prints on one landscape 11 × 8½ page.' }));
    wrap.appendChild(h('p', { cls: 'pp-msg', role: 'status' }));
    if (P.db === false && P.ctx.role === 'owner') wrap.appendChild(h('p', { cls: 'pp-setup', text: 'To share the Prep List with managers and cooks, run supabase/prep-list.sql in Supabase (SQL Editor → New query → paste → Run), then reload.' }));

    // the printable sheet: a landscape page with each section as its own panel, in three columns
    var d = new Date((P.st.for_date || iso(new Date())) + 'T12:00:00');
    var sheet = h('div', { cls: 'pp-sheet' + (P.bar ? ' is-bar' : '') });
    sheet.appendChild(h('div', { cls: 'pp-head' }, [
      h('div', { cls: 'pp-head-l' }, [h('div', { cls: 'pp-brand', text: 'EDEN' }), h('div', { cls: 'pp-title', text: (P.bar ? 'Bar Prep List' : 'Prep List') + (P.mode === 'combined' ? ' · Combined' : '') })]),
      h('div', { cls: 'pp-meta' }, [
        h('div', null, [h('span', { text: 'Date' }), h('b', { text: d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' }) })]),
        h('div', null, [h('span', { text: P.bar ? 'Expected guests' : 'Covers' }), h('i')]),
        h('div', null, [h('span', { text: 'Prepped by' }), h('i')])
      ])
    ]));
    if (!secs.length || (!P.bar && secs.length < 2)) sheet.appendChild(h('p', { cls: 'sc-empty', text: P.bar ? 'No cocktails with ingredients on the menu yet.' : 'No dishes on the Kitchen menu yet.' }));
    var built = secs.map(buildSection);
    var cols = built.length ? partition(built.map(function (b) { return b.weight; }), Math.min(3, built.length)) : [];
    var body = h('div', { cls: 'pp-body' }); sheet.appendChild(body);
    var light = -1, lightW = Infinity;
    var colEls = cols.map(function (r, ci) {
      var c = h('div', { cls: 'pp-col' }), w = 0;
      for (var i = r[0]; i < r[1]; i++) { c.appendChild(built[i].el); w += built[i].weight; }
      if (w < lightW) { lightW = w; light = ci; }
      body.appendChild(c); return c;
    });
    var notes = h('section', { cls: 'pp-notes' }, [h('header', { cls: 'pp-sec-h' }, [h('h2', { text: 'Notes & 86’d' })]), h('div', { cls: 'pp-lines' })]);
    (colEls[light] || body).appendChild(notes);
    wrap.appendChild(sheet);
    paintCount();
  }

  /* ---------- printing: one landscape 11 x 8.5 page ----------
   * .pp-paper is the compact paper layout. Before printing it goes on the sheet, the sheet is measured
   * at the printable size, and scaled down only if it is too tall. Print opens a preview first. */
  var IN = 96, PAGE_W = (11 - 0.7) * IN, PAGE_H = (8.5 - 0.7) * IN; // landscape letter minus 0.35in margins
  function fitSheet(sheet) {
    sheet.classList.add('pp-paper'); sheet.style.setProperty('--pp-zoom', '1'); sheet.style.width = PAGE_W + 'px';
    var hgt = sheet.scrollHeight, z = Math.min(1, (PAGE_H - 4) / hgt);
    sheet.style.width = '';
    z = Math.floor(z * 1000) / 1000;
    sheet.style.setProperty('--pp-zoom', String(z));
    return z;
  }
  function fit() { var sheet = P.el && !P.el.hidden && P.el.querySelector('.pp-sheet'); if (sheet) P.zoom = fitSheet(sheet); }
  function unfit() { var s = P.el && P.el.querySelector('.pp-sheet'); if (s) s.classList.remove('pp-paper'); }
  window.addEventListener('beforeprint', fit);
  window.addEventListener('afterprint', unfit);

  function preview() {
    var sheet = P.el && P.el.querySelector('.pp-sheet'); if (!sheet) return;
    var z = fitSheet(sheet); P.zoom = z;
    var copy = sheet.cloneNode(true);
    unfit();
    // inputs: show what's typed, as plain text
    var src = sheet.querySelectorAll('input'), dst = copy.querySelectorAll('input');
    for (var i = 0; i < dst.length; i++) { var t = document.createElement('span'); t.className = 'pp-parv'; t.textContent = src[i] ? src[i].value : ''; dst[i].replaceWith(t); }
    copy.querySelectorAll('.pp-add, .pp-x').forEach(function (x) { x.remove(); });
    var ssrc = sheet.querySelectorAll('select'), sdst = copy.querySelectorAll('select');
    for (var j = 0; j < sdst.length; j++) { var sv = document.createElement('span'); sv.className = 'pp-parv'; sv.textContent = ssrc[j] ? ssrc[j].value : ''; sdst[j].replaceWith(sv); }
    copy.querySelectorAll('.pp-inibtn').forEach(function (b) { var t = document.createElement('span'); t.className = 'pp-parv'; t.textContent = b.textContent; b.replaceWith(t); });
    copy.querySelectorAll('.pp-box').forEach(function (b) { var t = document.createElement('span'); t.className = 'pp-boxp'; t.textContent = b.getAttribute('aria-checked') === 'true' ? '✓' : ''; b.replaceWith(t); });
    copy.removeAttribute('id');
    var page = h('div', { cls: 'pp-page' }, h('div', { cls: 'pp-page-in' }, copy));
    var stage = h('div', { cls: 'pp-stage' }, page);
    var back = h('div', { cls: 'pp-preview', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Print preview' });
    function close() { back.remove(); document.removeEventListener('keydown', key); window.removeEventListener('resize', size); }
    function key(e) { if (e.key === 'Escape') close(); }
    var confirmBtn = h('button', { type: 'button', cls: 'ed-btn pp-confirm', text: 'Confirm print', on: { click: function () { close(); setTimeout(function () { window.print(); }, 60); } } });
    back.appendChild(h('div', { cls: 'pp-pbar' }, [
      h('div', { cls: 'pp-pbar-t' }, [h('b', { text: (P.bar ? 'Bar prep list' : 'Prep list') + ' · print preview' }), h('span', { text: 'Letter, landscape (11 × 8½ in)' + (z < 0.995 ? ' · scaled to ' + Math.round(z * 100) + '% to fit one page' : ' · one page') })]),
      h('button', { type: 'button', cls: 'ed-btn ghost', text: 'Back', on: { click: close } }),
      confirmBtn
    ]));
    back.appendChild(stage);
    function size() {
      var availW = stage.clientWidth - 48, availH = stage.clientHeight - 48;
      var s = Math.min(availW / (11 * IN), availH / (8.5 * IN), 1.2);
      page.style.transform = 'scale(' + s + ')';
      page.parentNode.style.width = (11 * IN * s) + 'px'; page.parentNode.style.height = (8.5 * IN * s) + 'px';
    }
    var holder = h('div', { cls: 'pp-holder' }); stage.appendChild(holder); holder.appendChild(page);
    document.body.appendChild(back);
    document.addEventListener('keydown', key); window.addEventListener('resize', size);
    size(); confirmBtn.focus();
  }

  window.EdenPrep = {
    show: function (ctx) {
      P.ctx = ctx; P.el = ctx.el; render();
      Promise.all([loadMenu(), loadState()]).then(render);
    },
    refresh: function () {
      if (!P.el || P.el.hidden) return;
      var a = document.activeElement; if (a && P.el.contains(a) && a.tagName === 'INPUT') return; // don't wipe a box mid-typing
      render();
    },
    _test: { fit: fit, unfit: unfit, preview: preview, partition: partition, sections: sections, titleParts: titleParts, splitParts: splitParts, addOns: addOns, P: P }
  };
})();
