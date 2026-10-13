/* Eden staff site: Resources — PDFs for the whole team, sorted into Food, Beverage and Hospitality.
 * Used on the staff site (#resources) and on the staff page (Resources tab). Everyone on the team can search and
 * open them; the Owner and managers add PDFs (here, or "Send to resources" from Pre-shift > Education), retitle,
 * re-sort and delete them. Files are private (Supabase Storage bucket "preshift-education", folder resources/);
 * links to open them last a few hours. Data: table resources (supabase/resources.sql).
 */
(function () {
  'use strict';
  var BUCKET = 'preshift-education', MAXB = 50 * 1024 * 1024;
  var CATS = [['food', 'Food'], ['beverage', 'Beverage'], ['hospitality', 'Hospitality']];
  var CATNAME = { food: 'Food', beverage: 'Beverage', hospitality: 'Hospitality' };
  var R = { ctx: null, el: null, list: [], urls: {}, loaded: false, missing: false, q: '', cat: '' };
  try { R.cat = localStorage.getItem('eden-res-cat') || ''; } catch (e) {}
  if (!CATNAME[R.cat]) R.cat = '';

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (Array.isArray(attrs) || typeof attrs === 'string') { kids = attrs; attrs = null; }
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else if (k === 'cls') e.className = v; else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function rid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function kb(n) { n = +n || 0; return n >= 1048576 ? (Math.round(n / 104857.6) / 10) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB'; }
  function day(ts) { return ts ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : ''; }
  function fold(x) { return String(x || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function gone(e) { return !!(e && (e.code === 'PGRST205' || e.code === '42P01' || /resources|schema cache|does not exist|bucket not found/i.test(e.message || ''))); }
  function denied(e) { return !!(e && (e.code === '42501' || /row-level security|permission|unauthori[sz]ed/i.test((e.message || '') + (e.statusCode || '')))); }
  function isMgr(ctx) { var r = (ctx || R.ctx || {}).role; return r === 'owner' || r === 'manager' || r === 'scheduler'; }
  function niceTitle(name) { return String(name || '').replace(/\.pdf$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200); }

  /* ---------- the title + category form (used for adding, sending from Pre-shift, and editing) ---------- */
  function dialog(o) {
    // o: { heading, title, category, file (for a new PDF), okText, extra (element), onOk(values, msg, btn) }
    var back = h('div', { cls: 'sc-modal rs-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': o.heading });
    var title = h('input', { type: 'text', value: o.title || '', maxlength: '200', placeholder: 'e.g. Fall wine list tasting notes', 'aria-label': 'Title' });
    var cat = o.category || '';
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var catBtns = CATS.map(function (c) {
      return h('button', { type: 'button', cls: 'rs-catpick', 'data-cat': c[0], 'aria-pressed': c[0] === cat ? 'true' : 'false', text: c[1], on: { click: function () { cat = c[0]; msg.textContent = ''; catBtns.forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-cat') === cat ? 'true' : 'false'); }); } } });
    });
    var ok = h('button', { type: 'button', cls: 'ed-btn', text: o.okText || 'Save' });
    var closeIt = function () { back.remove(); document.removeEventListener('keydown', esc); };
    var esc = function (e) { if (e.key === 'Escape') closeIt(); };
    document.addEventListener('keydown', esc);
    ok.addEventListener('click', function () {
      var t = title.value.trim();
      if (!t) { msg.textContent = 'Give it a title so the team can find it.'; title.focus(); return; }
      if (!cat) { msg.textContent = 'Pick Food, Beverage or Hospitality.'; return; }
      o.onOk({ title: t, category: cat }, msg, ok, closeIt);
    });
    title.addEventListener('keydown', function (e) { if (e.key === 'Enter') ok.click(); });
    back.appendChild(h('div', { cls: 'sc-card' }, [
      h('div', { cls: 'sc-card-h' }, [h('h2', { text: o.heading }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: closeIt } })]),
      h('div', { cls: 'sc-card-b' }, [
        o.file ? h('p', { cls: 'rs-file', text: o.file }) : null,
        h('label', { cls: 'sc-f' }, [h('span', { text: 'Title' }), title]),
        h('div', { cls: 'sc-f' }, [h('span', { text: 'Category' }), h('div', { cls: 'rs-cats', role: 'group', 'aria-label': 'Category' }, catBtns)]),
        o.extra || null,
        msg
      ]),
      h('div', { cls: 'sc-card-f' }, [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: closeIt } }), ok])
    ]));
    document.body.appendChild(back);
    setTimeout(function () { title.focus(); title.select(); }, 30);
    return back;
  }

  /* ---------- send a Pre-shift Education PDF to Resources (keeps its own copy of the file) ---------- */
  function sendFromPreshift(ctx, src, after) {
    // src: { title, file_path, file_size }; after(removeFromPreshift) is called once it's in Resources
    var off = h('input', { type: 'checkbox' });
    dialog({
      heading: 'Send to resources', title: src.title, okText: 'Send',
      extra: h('label', { cls: 'sc-check rs-off' }, [off, ' Also take it off Pre-shift']),
      onOk: function (v, msg, btn, closeIt) {
        var id = rid(), path = 'resources/' + id + '.pdf', sb = ctx.sb;
        btn.disabled = true; msg.textContent = 'Sending…';
        sb.storage.from(BUCKET).copy(src.file_path, path).then(function (c) {
          if (c.error) throw c.error;
          return sb.from('resources').insert({ id: id, title: v.title, category: v.category, file_path: path, file_size: src.file_size || 0 }).then(function (r) {
            if (r.error) { sb.storage.from(BUCKET).remove([path]); throw r.error; }
          });
        }).then(function () {
          closeIt(); R.loaded = false;
          if (after) after(off.checked, v);
        }).catch(function (e) {
          btn.disabled = false;
          msg.textContent = gone(e) ? 'Resources switch on once supabase/resources.sql is run in Supabase (SQL Editor → New query → paste → Run).' : denied(e) ? 'Only the Owner and managers can add resources.' : 'Couldn’t send. Try again.';
        });
      }
    });
  }

  /* ---------- the Resources page ---------- */
  function show(ctx) {
    R.ctx = ctx; R.el = ctx.el;
    if (!R.loaded) { paintShell(); load().then(paint); } else { paintShell(); paint(); }
  }
  function load() {
    var sb = R.ctx.sb;
    return sb.from('resources').select('id,title,category,file_path,file_size,author,created_at').order('title').then(function (r) {
      R.loaded = true;
      if (r.error) { R.missing = gone(r.error); R.err = !R.missing; R.list = []; return; }
      R.missing = false; R.err = false; R.list = r.data || [];
      if (!R.list.length) { R.urls = {}; return; }
      return sb.storage.from(BUCKET).createSignedUrls(R.list.map(function (x) { return x.file_path; }), 6 * 3600).then(function (u) {
        R.urls = {}; ((u && u.data) || []).forEach(function (x) { if (x && x.signedUrl) R.urls[x.path] = x.signedUrl; });
        R.urlsAt = Date.now();
      });
    }).catch(function () { R.loaded = true; R.err = true; R.list = []; });
  }
  function paintShell() {
    var el = R.el; el.innerHTML = '';
    var wrap = h('div', { cls: 'rs' });
    var head = h('div', { cls: 'rs-top' }, [
      h('div', [h('p', { cls: 'home-eyebrow', text: 'Service' }), h('h1', { cls: 'eo-title', text: 'Resources' }),
        h('p', { cls: 'rs-lede', text: 'Guides and reference PDFs for the team: food, beverage and hospitality.' })]),
      isMgr() ? h('button', { type: 'button', cls: 'ed-btn rs-add', text: 'Add PDF', on: { click: pickFile } }) : null
    ]);
    wrap.appendChild(head);
    var q = h('input', { type: 'search', cls: 'rs-q', placeholder: 'Search by title', 'aria-label': 'Search resources', value: R.q, autocomplete: 'off' });
    q.addEventListener('input', function () { R.q = q.value; paintList(); });
    var chips = h('div', { cls: 'rs-chips', role: 'group', 'aria-label': 'Category' });
    wrap.appendChild(h('div', { cls: 'rs-bar' }, [h('div', { cls: 'rs-qwrap' }, [q]), chips]));
    wrap.appendChild(h('p', { cls: 'rs-msg', role: 'status' }));
    wrap.appendChild(h('div', { cls: 'rs-body' }, [h('p', { cls: 'ps-src', text: 'Loading…' })]));
    el.appendChild(wrap);
    R.qEl = q; R.chips = chips; R.body = wrap.querySelector('.rs-body'); R.msg = wrap.querySelector('.rs-msg');
  }
  function paint() { paintChips(); paintList(); }
  function paintChips() {
    if (!R.chips) return;
    R.chips.innerHTML = '';
    var count = function (c) { return R.list.filter(function (x) { return !c || x.category === c; }).length; };
    [['', 'All']].concat(CATS).forEach(function (c) {
      R.chips.appendChild(h('button', { type: 'button', cls: 'rs-chip', 'aria-pressed': R.cat === c[0] ? 'true' : 'false', on: { click: function () { R.cat = c[0]; try { localStorage.setItem('eden-res-cat', R.cat); } catch (e) {} paintChips(); paintList(); } } },
        [c[1], h('span', { cls: 'rs-n', text: String(count(c[0])) })]));
    });
  }
  function matches(x) {
    if (R.cat && x.category !== R.cat) return false;
    var words = fold(R.q).split(/\s+/).filter(Boolean); if (!words.length) return true;
    var hay = fold(x.title + ' ' + CATNAME[x.category]);
    return words.every(function (w) { return hay.indexOf(w) !== -1; });
  }
  function paintList() {
    var body = R.body; if (!body) return;
    body.innerHTML = '';
    if (R.missing) { body.appendChild(h('div', { cls: 'eo-card' }, [h('p', { text: R.ctx.role === 'owner' ? 'One step first: in Supabase, open SQL Editor > New query, paste in supabase/resources.sql and click Run (after preshift.sql). Then reload this page.' : 'Resources aren’t switched on yet.' })])); return; }
    if (R.err) { body.appendChild(h('p', { cls: 'ps-src', text: 'Couldn’t load resources. Check your connection and reload.' })); return; }
    if (!R.list.length) { body.appendChild(h('div', { cls: 'eo-card rs-empty' }, [h('p', { text: isMgr() ? 'Nothing here yet. Press “Add PDF”, or on Pre-shift press “Send to resources” under a PDF in Education.' : 'Nothing here yet.' })])); return; }
    var items = R.list.filter(matches).sort(function (a, b) { return String(a.title).localeCompare(b.title, undefined, { sensitivity: 'base' }); });
    if (!items.length) { body.appendChild(h('p', { cls: 'ps-src rs-none', text: 'Nothing matches “' + R.q.trim() + '”' + (R.cat ? ' in ' + CATNAME[R.cat] : '') + '.' })); return; }
    // links expire after a few hours: fetch fresh ones if this page has been open a long time
    if (R.urlsAt && Date.now() - R.urlsAt > 5 * 3600e3) { R.urlsAt = 0; load().then(paintList); }
    var groups = R.cat ? [[R.cat, CATNAME[R.cat]]] : CATS;
    groups.forEach(function (g) {
      var mine = items.filter(function (x) { return x.category === g[0]; });
      if (!mine.length) return;
      var sec = h('section', { cls: 'rs-group rs-' + g[0], 'aria-label': g[1] }, [h('h2', { cls: 'rs-gh' }, [g[1], h('span', { text: String(mine.length) })])]);
      sec.appendChild(h('ul', { cls: 'ps-edu-list rs-list' }, mine.map(item)));
      body.appendChild(sec);
    });
  }
  function item(d) {
    var url = R.urls[d.file_path];
    var tx = h('span', { cls: 'ps-edu-tx' }, [h('b', { text: d.title }), h('small', { text: [CATNAME[d.category], kb(d.file_size), d.author ? 'added by ' + d.author : '', day(d.created_at)].filter(Boolean).join(' · ') })]);
    var ic = h('span', { cls: 'ps-edu-ic', 'aria-hidden': 'true', text: 'PDF' });
    var open = url ? h('a', { cls: 'ps-edu-open', href: url, target: '_blank', rel: 'noopener' }, [ic, tx]) : h('div', { cls: 'ps-edu-open is-off', title: 'Couldn’t open this file right now' }, [ic, tx]);
    return h('li', { cls: 'ps-edu-i' }, [open, isMgr() ? h('span', { cls: 'rs-acts' }, [
      h('button', { type: 'button', cls: 'ps-note-x rs-edit', text: 'Edit', 'aria-label': 'Edit ' + d.title, on: { click: function () { edit(d); } } }),
      h('button', { type: 'button', cls: 'ps-note-x rs-del', text: 'Delete', 'aria-label': 'Delete ' + d.title, on: { click: function () { del(d, this); } } })
    ]) : null]);
  }
  function say(t, k) { if (R.msg) { R.msg.textContent = t || ''; R.msg.className = 'rs-msg' + (k ? ' ' + k : ''); } }
  function pickFile() {
    var f = h('input', { type: 'file', accept: 'application/pdf,.pdf', hidden: true });
    f.addEventListener('change', function () {
      var file = f.files && f.files[0]; f.remove(); if (!file) return;
      if (!(file.type === 'application/pdf' || /\.pdf$/i.test(file.name))) { say('Only PDF files can be added.', 'err'); return; }
      if (file.size > MAXB) { say('That PDF is over 50 MB.', 'err'); return; }
      dialog({ heading: 'Add to resources', title: niceTitle(file.name), category: R.cat, file: file.name + ' · ' + kb(file.size), okText: 'Add', onOk: function (v, msg, btn, closeIt) {
        var id = rid(), path = 'resources/' + id + '.pdf', sb = R.ctx.sb;
        btn.disabled = true; msg.textContent = 'Uploading…';
        sb.storage.from(BUCKET).upload(path, file, { contentType: 'application/pdf', upsert: false }).then(function (u) {
          if (u.error) throw u.error;
          return sb.from('resources').insert({ id: id, title: v.title, category: v.category, file_path: path, file_size: file.size }).then(function (r) { if (r.error) { sb.storage.from(BUCKET).remove([path]); throw r.error; } });
        }).then(function () {
          closeIt(); say('Added “' + v.title + '” to ' + CATNAME[v.category] + '.', 'ok');
          load().then(paint);
        }).catch(function (e) {
          btn.disabled = false;
          msg.textContent = gone(e) ? 'Run supabase/resources.sql in Supabase first.' : denied(e) ? 'Only the Owner and managers can add resources.' : 'Couldn’t add it. Try again.';
        });
      } });
    });
    document.body.appendChild(f); f.click();
  }
  function edit(d) {
    dialog({ heading: 'Edit resource', title: d.title, category: d.category, okText: 'Save', onOk: function (v, msg, btn, closeIt) {
      btn.disabled = true; msg.textContent = 'Saving…';
      R.ctx.sb.from('resources').update({ title: v.title, category: v.category }).eq('id', d.id).then(function (r) {
        btn.disabled = false;
        if (r.error) { msg.textContent = denied(r.error) ? 'Only the Owner and managers can change resources.' : 'Couldn’t save. Try again.'; return; }
        d.title = v.title; d.category = v.category; closeIt(); say('Saved.', 'ok'); paint();
      }, function () { btn.disabled = false; msg.textContent = 'Couldn’t save. Try again.'; });
    } });
  }
  function del(d, btn) {
    if (!confirm('Delete “' + d.title + '” from Resources for everyone?')) return;
    btn.disabled = true;
    R.ctx.sb.from('resources').delete().eq('id', d.id).then(function (r) {
      if (r.error) { btn.disabled = false; say('Couldn’t delete it. Try again.', 'err'); return; }
      R.ctx.sb.storage.from(BUCKET).remove([d.file_path]).then(function () {}, function () {});
      R.list = R.list.filter(function (x) { return x.id !== d.id; });
      say('Deleted “' + d.title + '”.', 'ok'); paint();
    }, function () { btn.disabled = false; });
  }

  window.EdenResources = { show: show, sendFromPreshift: sendFromPreshift, CATNAME: CATNAME };
})();
