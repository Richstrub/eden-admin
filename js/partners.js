/* Eden staff site: Owner > Partner stories. The short stories that open when a guest taps Rich's, Adam's or Eve's
 * portrait on the website (About section). Saved in site_docs row "site/team" as { rich: { story }, adam: {...}, eve: {...} };
 * the website picks up a save within seconds. A blank line starts a new paragraph. A blank story still opens the window,
 * with just the portrait, name and title.
 */
(function () {
  'use strict';
  var PATH = 'site/team';
  var PEOPLE = [
    { id: 'rich', name: 'Rich Strub', role: 'Executive Chef / Partner', img: 'assets/images/rich-strub.jpg' },
    { id: 'adam', name: 'Adam Anderson', role: 'Partner', img: 'assets/images/adam-anderson.jpg' },
    { id: 'eve', name: 'Eve DeRosa', role: 'Partner', img: 'assets/images/eve-derosa-2026.jpg' }
  ];
  // what the website shows until a story is saved here (keep in step with TEAM_DEFAULT in the website's js/app.js)
  var DEFAULT = { rich: { story: "Rich Strub is Eden’s executive chef and a founding partner. He found his calling in the kitchen of a farm-to-table restaurant and teaching kitchen in Vermont, and brought that way of cooking with him to Syracuse, where the farmers he met soon became his friends.\n\nBefore Eden opened in August 2019, Rich spent two years rebuilding the dining room at 118 East Genesee Street, one of Syracuse’s first steel-framed buildings. He tore out the floors, built the eight-ton hearth and made nearly all of the furniture himself; a graphic designer by training, from Champlain College, he shaped how the room looks as much as how it eats.\n\nEverything at Eden is cooked over that wood fire, which he calls “a living thing.” His menu changes with each harvest and names the farm behind every dish, because, in his words, “I like to buy stuff from people who work as hard as we do, and I like to know where it comes from.” Under his direction Eden has earned the Wine Spectator Restaurant Award and, in 2026, hosted its first Friends of James Beard Benefit dinner." }, adam: { story: '' }, eve: { story: '' } };
  var P = { ctx: null, data: null, saved: '', loaded: false };

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else if (k === 'cls') e.className = v; else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function site() { var c = window.EDEN_STAFF_CONFIG || {}; return String(c.publicSite || 'https://edencny.com/').replace(/\/?$/, '/'); }
  function words(t) { var m = String(t || '').trim().match(/\S+/g); return m ? m.length : 0; }
  function dirty() { return JSON.stringify(P.data) !== P.saved; }

  function load() {
    return P.ctx.sb.from('site_docs').select('path,data').eq('path', PATH).then(function (r) {
      if (r.error) throw r.error;
      var row = (r.data || [])[0], d = row && row.data ? row.data : DEFAULT, out = {};
      PEOPLE.forEach(function (p) { out[p.id] = { story: d[p.id] && typeof d[p.id].story === 'string' ? d[p.id].story : '' }; });
      P.data = out; P.saved = JSON.stringify(out); P.loaded = true;   // never saved yet: the website is showing this same starting text
    });
  }
  function save(btn, msg) {
    btn.disabled = true; msg.textContent = 'Saving…';
    var data = {}; PEOPLE.forEach(function (p) { data[p.id] = { story: String(P.data[p.id].story || '').replace(/[ \t]+\n/g, '\n').trim() }; });
    P.ctx.sb.from('site_docs').upsert([{ path: PATH, data: data }], { onConflict: 'path' }).then(function (r) {
      btn.disabled = false;
      if (r.error) { msg.textContent = /row-level|permission|42501/i.test(r.error.message + r.error.code) ? 'Only the Owner and managers can change the website.' : 'Couldn’t save. ' + (r.error.message || ''); return; }
      P.data = data; P.saved = JSON.stringify(data); msg.textContent = 'Saved. It’s on the website now.';
      if (P.ctx.status) P.ctx.status('Partner stories saved to the website.', 'ok');
      paintState();
    }, function () { btn.disabled = false; msg.textContent = 'Couldn’t reach the database.'; });
  }
  var stateEl = null, saveBtn = null;
  function paintState() { if (stateEl) stateEl.textContent = dirty() ? 'Unsaved changes' : ''; if (saveBtn) saveBtn.disabled = !dirty(); }

  function render() {
    var el = P.ctx.el; el.innerHTML = '';
    var wrap = h('div', { cls: 'sc-in pt' });
    el.appendChild(wrap);
    var msg = h('p', { cls: 'pt-msg', role: 'status' });
    stateEl = h('span', { cls: 'pt-state' });
    saveBtn = h('button', { type: 'button', cls: 'ed-btn', text: 'Save to website', on: { click: function () { save(saveBtn, msg); } } });
    wrap.appendChild(h('div', { cls: 'sc-titlebar' }, [
      h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Website · About' }), h('h1', { cls: 'sc-week', text: 'Partner stories' })]),
      h('div', { cls: 'pt-actions' }, [stateEl, h('a', { cls: 'ed-btn small ghost', href: site() + '#about', target: '_blank', rel: 'noopener', text: 'View website ↗' }), saveBtn])
    ]));
    wrap.appendChild(h('p', { cls: 'pt-help', text: 'Guests tap a portrait in the About section of the website to read that person’s story. Leave a blank line between paragraphs. A story left empty still opens, with just the photo, name and title.' }));
    if (!P.loaded) { wrap.appendChild(h('p', { cls: 'pt-help', text: 'Loading…' })); return; }
    PEOPLE.forEach(function (p) {
      var ta = h('textarea', { cls: 'pt-text', rows: '9', 'aria-label': p.name + '’s story', placeholder: 'A few short paragraphs about ' + p.name.split(' ')[0] + '…' });
      ta.value = P.data[p.id].story;
      var count = h('span', { cls: 'pt-count' });
      var fit = function () { ta.style.height = 'auto'; ta.style.height = Math.max(160, ta.scrollHeight + 2) + 'px'; var n = words(ta.value); count.textContent = n ? n + ' words' : 'Empty'; };
      ta.addEventListener('input', function () { P.data[p.id].story = ta.value; fit(); paintState(); msg.textContent = ''; });
      var img = h('img', { src: site() + p.img, alt: '', loading: 'lazy' });
      img.addEventListener('error', function () { img.remove(); });
      wrap.appendChild(h('section', { cls: 'pt-card' }, [
        h('div', { cls: 'pt-face' }, [img]),
        h('div', { cls: 'pt-body' }, [
          h('div', { cls: 'pt-who' }, [h('h2', { text: p.name }), h('span', { cls: 'pt-role', text: p.role }), h('span', { cls: 'sc-sp' }), count]),
          ta
        ])
      ]));
      setTimeout(fit, 0);
    });
    wrap.appendChild(h('div', { cls: 'pt-foot' }, [msg, h('button', { type: 'button', cls: 'ed-btn', text: 'Save to website', on: { click: function (e) { save(e.currentTarget, msg); } } })]));
    paintState();
  }

  window.addEventListener('beforeunload', function (e) { if (P.ctx && P.loaded && P.ctx.el && !P.ctx.el.hidden && dirty()) { e.preventDefault(); e.returnValue = ''; } });

  window.EdenPartners = {
    show: function (ctx) {
      P.ctx = ctx;
      if (P.loaded && dirty()) { render(); return; }   // keep unsaved typing when you come back to the page
      P.loaded = false; render();
      load().then(render, function (e) {
        P.ctx.el.innerHTML = '';
        P.ctx.el.appendChild(h('div', { cls: 'sc-in' }, [h('p', { cls: 'pt-help', text: 'Couldn’t load the partner stories. ' + ((e && e.message) || '') })]));
      });
    }
  };
})();
