/* Eden: BEOs for the team (staff page on phones, and the Hub).
 * A list of upcoming events with a BEO; tap one to read its front-of-house service sheet and kitchen production
 * sheet (the same staff sheets the BEO form prints). Prices and billing are removed in the database
 * (supabase/staff-beos.sql), except for the Owner and managers, who also get a pricing page. The Hub never gets prices.
 * EdenBEOStaff.show({ sb, el, base })   base: path to the staff site's root ('' on the staff site, '../' from team/ or hub/)
 */
(function () {
  'use strict';
  var B = { ctx: null, el: null, list: null, open: null, tpl: null };
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function gone(e) { return !!(e && (e.code === 'PGRST202' || e.code === '42883' || /could not find the function|does not exist|schema cache/i.test(e.message || ''))); }
  function day(d) { if (!d) return ''; var p = String(d).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }); }
  function t12(t) { var p = String(t || '').split(':'), H = +p[0], M = +p[1] || 0; if (!t || isNaN(H)) return ''; return (H % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H >= 12 ? 'pm' : 'am'); }
  function rel(d) {
    if (!d) return '';
    var p = String(d).split('-'), x = new Date(+p[0], +p[1] - 1, +p[2]), n = new Date(); n = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    var diff = Math.round((x - n) / 864e5);
    return diff === 0 ? 'Today' : diff === 1 ? 'Tomorrow' : diff === -1 ? 'Yesterday' : diff > 1 && diff < 7 ? 'In ' + diff + ' days' : '';
  }
  function frame() { clear(B.el); var w = h('div', { cls: 'bs' }); B.el.appendChild(w); return w; }

  function showList() {
    B.open = null;
    var w = frame();
    w.appendChild(h('header', { cls: 'bs-top' }, [h('p', { cls: 'sc-eyebrow', text: 'Events' }), h('h1', { cls: 'sc-week', text: 'BEOs' }),
      h('p', { cls: 'bs-help', text: 'Upcoming events’ banquet event orders: timeline, room setup, menu, counts, dietary needs and notes. Tap an event to open it.' })]));
    var body = h('div', { cls: 'bs-list' }, [h('p', { cls: 'bs-empty', text: 'Loading…' })]); w.appendChild(body);
    B.ctx.sb.rpc('staff_beo_list').then(function (r) {
      clear(body);
      if (r.error) { body.appendChild(h('p', { cls: 'bs-empty', text: gone(r.error) ? 'BEOs aren’t switched on here yet (supabase/staff-beos.sql needs to be run).' : 'Couldn’t load the BEOs. Check the connection.' })); return; }
      var d = r.data || {};
      if (d.error) { body.appendChild(h('p', { cls: 'bs-empty', text: 'This login can’t open BEOs.' })); return; }
      var list = d.beos || [];
      if (!list.length) { body.appendChild(h('p', { cls: 'bs-empty', text: 'No upcoming events with a BEO yet.' })); return; }
      list.forEach(function (b) {
        var when = [t12(b.start), b.end ? t12(b.end) : ''].filter(Boolean).join('–');
        body.appendChild(h('button', { type: 'button', cls: 'bs-row', on: { click: function () { openBeo(b); } } }, [
          h('span', { cls: 'bs-date' }, [h('b', { text: day(b.date) || 'Date to be set' }), rel(b.date) ? h('em', { text: rel(b.date) }) : null]),
          h('span', { cls: 'bs-name' }, [h('b', { text: b.name }), h('small', { text: [when, b.room, b.guests ? b.guests + (b.final ? ' guests (final)' : ' guests expected') : ''].filter(Boolean).join(' · ') })]),
          h('span', { cls: 'bs-go', 'aria-hidden': 'true', text: '›' })]));
      });
    }, function () { clear(body); body.appendChild(h('p', { cls: 'bs-empty', text: 'Couldn’t load the BEOs. Check the connection.' })); });
  }

  function template() {
    if (B.tpl) return Promise.resolve(B.tpl);
    return fetch((B.ctx.base || '') + 'templates/beo-form.html', { cache: 'no-cache' }).then(function (x) { if (!x.ok) throw new Error('tpl'); return x.text(); }).then(function (t) { B.tpl = t; return t; });
  }
  function openBeo(b) {
    B.open = b.id;
    var w = frame();
    w.appendChild(h('div', { cls: 'bs-bar' }, [h('button', { type: 'button', cls: 'ed-btn small bs-back', text: '‹ All BEOs', on: { click: showList } }), h('b', { text: b.name }), h('span', { text: day(b.date) })]));
    var box = h('div', { cls: 'bs-view' }, [h('p', { cls: 'bs-empty', text: 'Opening the BEO…' })]); w.appendChild(box);
    Promise.all([B.ctx.sb.rpc('staff_beo_get', { p_id: b.id }), template()]).then(function (x) {
      var r = x[0], tpl = x[1];
      if (B.open !== b.id) return;
      if (r.error || !r.data || r.data.error) { clear(box); box.appendChild(h('p', { cls: 'bs-empty', text: r.data && r.data.error === 'not_allowed' ? 'This login can’t open BEOs.' : 'Couldn’t open this BEO.' })); return; }
      var inject = '<script>window.__BEO_STAFF=true;window.__BEO_PRICES=' + (r.data.prices ? 'true' : 'false') + ';window.__BEO_DOC=' +
        JSON.stringify({ id: r.data.id, data: r.data.doc || {} }).replace(/</g, '\\u003c') + ';<\/script>';
      var html = tpl.replace(/<head>/i, '<head>' + inject);
      var f = h('iframe', { cls: 'bs-frame', title: b.name + ' BEO' });
      clear(box); box.appendChild(f);
      f.srcdoc = html;
      // grow the frame to its content so the page scrolls as one
      var fit = function () { try { var d = f.contentDocument; if (d && d.body) f.style.height = Math.max(400, d.documentElement.scrollHeight) + 'px'; } catch (e) {} };
      f.addEventListener('load', function () { fit(); setTimeout(fit, 300); setTimeout(fit, 1200); try { f.contentWindow.addEventListener('resize', fit); } catch (e) {} });
    }, function () { if (B.open !== b.id) return; clear(box); box.appendChild(h('p', { cls: 'bs-empty', text: 'Couldn’t open this BEO. Check the connection.' })); });
  }

  window.EdenBEOStaff = { show: function (ctx) { B.ctx = ctx; B.el = ctx.el; showList(); } };
})();
