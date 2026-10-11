/* Eden staff site: Notes (handwriting with Apple Pencil, or typed) and the shared To-do list.
 *
 * Notes open in a full-screen window from the top bar. Handwriting: draw with Apple Pencil (pressure
 * sensitive; your palm and fingers don't draw once the Pencil is used, fingers scroll instead). Text: on an
 * iPad, writing with Apple Pencil in the text box is turned into typed text by iPadOS (Scribble). "Convert
 * to text" also tries to read the handwriting page (Tesseract, loaded only when asked; neat printing reads
 * best). Notes save automatically and are private to the person who wrote them. A note can be emailed,
 * shared (with the handwriting attached, where the device supports it) or filed into the To-do list.
 *
 * Data: Supabase tables notes and todos (supabase/notes.sql).
 */
(function () {
  'use strict';
  var TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
  var DRAFT = 'eden-note-draft';
  var COLORS = [['#15181b', 'Black'], ['#1f4fa3', 'Blue'], ['#b3261e', 'Red'], ['#b0703f', 'Copper']];
  var SIZES = [['S', 1.6], ['M', 2.6], ['L', 4.2]];

  var C = { sb: null, status: function () {}, name: '' };
  var N = { el: null, note: null, notes: [], loaded: false, missing: false, mode: 'ink', color: COLORS[0][0], size: 2.6, eraser: false,
    penSeen: false, saveT: null, saving: false, dirty: false, redo: [] };
  var T = { el: null, items: [], loaded: false, missing: false, showDone: false };

  /* ---------- helpers ---------- */
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
  function uid() { return (window.crypto && crypto.randomUUID) ? crypto.randomUUID() : 'n' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }
  function isMissing(e) { return e && (e.code === 'PGRST205' || e.code === '42P01' || /schema cache|does not exist/i.test(e.message || '')); }
  function isPerm(e) { return e && (e.code === '42501' || /row-level security|permission/i.test(e.message || '')); }
  function loadScript(src) { return new Promise(function (res, rej) { var s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = function () { rej(new Error('load')); }; document.head.appendChild(s); }); }
  function when(t) { var d = new Date(t); if (isNaN(d)) return ''; var today = new Date(); var same = d.toDateString() === today.toDateString();
    return same ? d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dayLabel(t) { var p = String(t).split('-'); var d = new Date(+p[0], +p[1] - 1, +p[2]); return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }); }
  function blankNote() { return { id: uid(), title: '', body: '', ink: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _new: true }; }
  function hasContent(n) { return !!(n && ((n.title || '').trim() || (n.body || '').trim() || (n.ink && n.ink.length))); }
  function noteTitle(n) { return (n.title || '').trim() || (n.body || '').trim().split('\n')[0].slice(0, 60) || (n.ink && n.ink.length ? 'Handwritten note' : 'Untitled note'); }
  function toast(t, k) { var el = N.el && N.el.querySelector('.nt-state'); if (el) { el.textContent = t; el.className = 'nt-state' + (k ? ' ' + k : ''); } }

  /* ---------- notes: data ---------- */
  function loadNotes() {
    return C.sb.from('notes').select('id,title,body,ink,created_at,updated_at').order('updated_at', { ascending: false }).then(function (r) {
      N.loaded = true;
      if (r.error) { if (isMissing(r.error)) N.missing = true; N.notes = []; return; }
      N.missing = false;
      N.notes = (r.data || []).sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; });
    }, function () { N.loaded = true; });
  }
  function keepDraft() { try { localStorage.setItem(DRAFT, JSON.stringify(N.note)); } catch (e) {} }
  function dropDraft() { try { localStorage.removeItem(DRAFT); } catch (e) {} }
  function changed() {
    N.dirty = true; N.note.updated_at = new Date().toISOString(); keepDraft();
    toast('Saving…', 'dirty'); clearTimeout(N.saveT); N.saveT = setTimeout(saveNote, 1200);
  }
  function saveNote() {
    if (!N.note || !N.dirty) return Promise.resolve();
    if (!hasContent(N.note)) { N.dirty = false; toast(''); return Promise.resolve(); }
    if (N.missing) { toast('Kept on this device. Run supabase/notes.sql to save notes online.', 'err'); return Promise.resolve(); }
    if (N.saving) { clearTimeout(N.saveT); N.saveT = setTimeout(saveNote, 400); return Promise.resolve(); }
    N.saving = true; N.dirty = false;
    var n = N.note;
    return C.sb.from('notes').upsert({ id: n.id, title: n.title || '', body: n.body || '', ink: n.ink || [] }, { onConflict: 'id' }).then(function (r) {
      N.saving = false;
      if (r.error) {
        N.dirty = true;
        if (isMissing(r.error)) { N.missing = true; toast('Kept on this device. Run supabase/notes.sql to save notes online.', 'err'); return; }
        toast(isPerm(r.error) ? 'Your role can’t save notes.' : 'Not saved yet. Will retry.', 'err');
        clearTimeout(N.saveT); N.saveT = setTimeout(saveNote, 5000); return;
      }
      delete n._new;
      if (!N.notes.some(function (x) { return x.id === n.id; })) N.notes.unshift(n);
      if (!N.dirty) { toast('Saved', 'ok'); dropDraft(); }
      paintList();
    });
  }

  /* ---------- the Notes window ---------- */
  function open() {
    if (N.el) { N.el.hidden = false; return; }
    var draft = null; try { draft = JSON.parse(localStorage.getItem(DRAFT) || 'null'); } catch (e) {}
    N.note = draft && hasContent(draft) ? draft : blankNote();
    if (draft && hasContent(draft)) N.dirty = true;
    N.redo = [];
    build();
    document.body.classList.add('nt-open');
    loadNotes().then(function () { paintList(); if (N.dirty) saveNote(); });
  }
  function close() {
    var done = function () { if (N.el) { N.el.remove(); N.el = null; } document.body.classList.remove('nt-open'); window.removeEventListener('resize', onResize); };
    clearTimeout(N.saveT);
    if (N.dirty && hasContent(N.note)) saveNote().then(done); else done();
  }
  function build() {
    var el = N.el = h('div', { cls: 'nt', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Notes' });
    var title = h('input', { type: 'text', cls: 'nt-title', placeholder: 'Untitled note', value: N.note.title || '', 'aria-label': 'Note title' });
    title.addEventListener('input', function () { N.note.title = title.value; changed(); paintList(); });
    var share = navigator.share ? h('button', { type: 'button', cls: 'nt-b', text: 'Share', title: 'Share or email with the handwriting attached', on: { click: shareNote } }) : null;
    el.appendChild(h('header', { cls: 'nt-bar' }, [
      h('button', { type: 'button', cls: 'nt-b nt-listbtn', 'aria-label': 'My notes', title: 'My notes', text: '☰ Notes', on: { click: function () { el.classList.toggle('show-list'); } } }),
      title,
      h('div', { cls: 'nt-mode', role: 'group', 'aria-label': 'Mode' }, [
        h('button', { type: 'button', 'data-mode': 'ink', text: 'Handwriting', on: { click: function () { setMode('ink'); } } }),
        h('button', { type: 'button', 'data-mode': 'text', text: 'Text', on: { click: function () { setMode('text'); } } })
      ]),
      h('span', { cls: 'nt-state', role: 'status' }),
      h('div', { cls: 'nt-acts' }, [
        h('button', { type: 'button', cls: 'nt-b', text: 'Email', on: { click: emailNote } }),
        share,
        h('button', { type: 'button', cls: 'nt-b', text: 'Add to to-do', on: { click: toTodo } }),
        h('button', { type: 'button', cls: 'nt-b', text: 'New', title: 'Start a new note', on: { click: newNote } }),
        h('button', { type: 'button', cls: 'nt-b nt-close', 'aria-label': 'Close notes', text: 'Done', on: { click: close } })
      ])
    ]));
    // tools for handwriting
    var tools = h('div', { cls: 'nt-tools' });
    COLORS.forEach(function (c) {
      tools.appendChild(h('button', { type: 'button', cls: 'nt-sw', 'data-color': c[0], 'aria-label': c[1] + ' ink', title: c[1], style: '--c:' + c[0], on: { click: function () { N.color = c[0]; N.eraser = false; paintTools(); } } }));
    });
    tools.appendChild(h('span', { cls: 'nt-sep' }));
    SIZES.forEach(function (s) { tools.appendChild(h('button', { type: 'button', cls: 'nt-sz', 'data-size': String(s[1]), text: s[0], 'aria-label': 'Pen size ' + s[0], on: { click: function () { N.size = s[1]; N.eraser = false; paintTools(); } } })); });
    tools.appendChild(h('span', { cls: 'nt-sep' }));
    tools.appendChild(h('button', { type: 'button', cls: 'nt-t nt-eraser', text: 'Eraser', on: { click: function () { N.eraser = !N.eraser; paintTools(); } } }));
    tools.appendChild(h('button', { type: 'button', cls: 'nt-t', text: 'Undo', on: { click: undo } }));
    tools.appendChild(h('button', { type: 'button', cls: 'nt-t', text: 'Redo', on: { click: redo } }));
    tools.appendChild(h('button', { type: 'button', cls: 'nt-t', text: 'Clear', on: { click: function () { if (N.note.ink.length && confirm('Clear the handwriting on this note?')) { N.redo = []; N.note.ink = []; redraw(); changed(); } } } }));
    tools.appendChild(h('button', { type: 'button', cls: 'nt-t', text: '+ Page', title: 'More room to write', on: { click: addPage } }));
    tools.appendChild(h('span', { cls: 'nt-grow' }));
    tools.appendChild(h('button', { type: 'button', cls: 'nt-b nt-convert', text: 'Convert to text', on: { click: convert } }));
    el.appendChild(tools);
    // body: list | page
    var list = h('aside', { cls: 'nt-list', 'aria-label': 'My notes' });
    var paper = h('div', { cls: 'nt-paper' });
    var canvas = h('canvas', { cls: 'nt-canvas', 'aria-label': 'Handwriting area' });
    paper.appendChild(canvas);
    var text = h('textarea', { cls: 'nt-text', placeholder: 'Type here, or write with Apple Pencil: on an iPad your handwriting turns into text as you write (Scribble).' });
    text.value = N.note.body || '';
    text.addEventListener('input', function () { N.note.body = text.value; changed(); paintList(); });
    var hint = h('p', { cls: 'nt-hint', text: 'Tip: on iPad, Scribble must be on (Settings → Apple Pencil → Scribble).' });
    el.appendChild(h('div', { cls: 'nt-body' }, [list, h('div', { cls: 'nt-page' }, [paper, h('div', { cls: 'nt-textwrap' }, [text, hint])])]));
    document.body.appendChild(el);
    N.canvas = canvas; N.paper = paper; N.text = text; N.titleEl = title; N.list = list;
    setupCanvas();
    setMode(N.note.ink && N.note.ink.length || !(N.note.body || '').trim() ? 'ink' : 'text');
    paintTools(); paintList();
    window.addEventListener('resize', onResize);
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !document.querySelector('.sc-modal')) close(); if ((e.metaKey || e.ctrlKey) && e.key === 'z' && N.mode === 'ink' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); e.shiftKey ? redo() : undo(); } });
  }
  function setMode(m) {
    N.mode = m;
    N.el.classList.toggle('is-text', m === 'text'); N.el.classList.toggle('is-ink', m === 'ink');
    N.el.querySelectorAll('.nt-mode button').forEach(function (b) { b.setAttribute('aria-pressed', b.getAttribute('data-mode') === m ? 'true' : 'false'); });
    if (m === 'ink') { sizeCanvas(); } else setTimeout(function () { N.text.focus(); }, 30);
  }
  function paintTools() {
    if (!N.el) return;
    N.el.querySelectorAll('.nt-sw').forEach(function (b) { b.setAttribute('aria-pressed', !N.eraser && b.getAttribute('data-color') === N.color ? 'true' : 'false'); });
    N.el.querySelectorAll('.nt-sz').forEach(function (b) { b.setAttribute('aria-pressed', !N.eraser && +b.getAttribute('data-size') === N.size ? 'true' : 'false'); });
    N.el.querySelector('.nt-eraser').setAttribute('aria-pressed', N.eraser ? 'true' : 'false');
    N.canvas.classList.toggle('erasing', N.eraser);
  }
  function paintList() {
    var list = N.list; if (!list) return;
    list.innerHTML = '';
    list.appendChild(h('div', { cls: 'nt-list-h' }, [h('b', { text: 'My notes' }), h('button', { type: 'button', cls: 'nt-b small', text: '+ New', on: { click: newNote } })]));
    if (N.missing) list.appendChild(h('p', { cls: 'nt-list-note', text: 'Notes are kept on this device until supabase/notes.sql is run in Supabase.' }));
    var all = N.notes.slice();
    if (hasContent(N.note) && !all.some(function (x) { return x.id === N.note.id; })) all.unshift(N.note);
    if (!all.length) list.appendChild(h('p', { cls: 'nt-list-note', text: N.loaded ? 'No saved notes yet.' : 'Loading…' }));
    all.forEach(function (n) {
      var cur = n.id === N.note.id, src = cur ? N.note : n;
      list.appendChild(h('div', { cls: 'nt-item' + (cur ? ' on' : '') }, [
        h('button', { type: 'button', cls: 'nt-item-open', on: { click: function () { pick(n); } } }, [h('b', { text: noteTitle(src) }), h('span', { text: when(src.updated_at) + (src.ink && src.ink.length ? ' · handwriting' : '') })]),
        h('button', { type: 'button', cls: 'nt-item-del', 'aria-label': 'Delete note', title: 'Delete note', text: '✕', on: { click: function () { delNote(n); } } })
      ]));
    });
  }
  function load(n) {
    N.note = n; N.redo = []; N.dirty = false;
    N.titleEl.value = n.title || ''; N.text.value = n.body || '';
    N.paper.scrollTop = 0; N.extra = 0;
    setMode(n.ink && n.ink.length || !(n.body || '').trim() ? 'ink' : 'text');
    redraw(); paintList(); toast('');
    N.el.classList.remove('show-list');
  }
  function pick(n) { if (n.id === N.note.id) { N.el.classList.remove('show-list'); return; } var go = function () { load(JSON.parse(JSON.stringify(n))); }; if (N.dirty) saveNote().then(go); else go(); }
  function newNote() { var go = function () { load(blankNote()); dropDraft(); }; if (N.dirty) saveNote().then(go); else go(); }
  function delNote(n) {
    if (!confirm('Delete “' + noteTitle(n.id === N.note.id ? N.note : n) + '”? This can’t be undone.')) return;
    var after = function () { N.notes = N.notes.filter(function (x) { return x.id !== n.id; }); if (n.id === N.note.id) { load(blankNote()); dropDraft(); } else paintList(); };
    if (N.missing || n._new) { after(); return; }
    C.sb.from('notes').delete().eq('id', n.id).then(function (r) { if (r.error) { toast('Couldn’t delete. Try again.', 'err'); return; } after(); });
  }

  /* ---------- handwriting canvas ---------- */
  var PAGE = 1100; // logical height of one page of paper, in CSS px
  function onResize() { if (N.mode === 'ink') sizeCanvas(); }
  function inkHeight() { var m = 0; (N.note.ink || []).forEach(function (s) { s.p.forEach(function (q) { if (q[1] > m) m = q[1]; }); }); return m; }
  function sizeCanvas() {
    var c = N.canvas, w = N.paper.clientWidth || 800;
    var hgt = Math.max(N.paper.clientHeight || PAGE, Math.ceil((inkHeight() + 300) / PAGE) * PAGE, (N.extra || 0) + (N.paper.clientHeight || PAGE));
    var dpr = window.devicePixelRatio || 1;
    c.style.width = w + 'px'; c.style.height = hgt + 'px';
    c.width = Math.round(w * dpr); c.height = Math.round(hgt * dpr);
    N.ctx = c.getContext('2d'); N.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    redraw();
  }
  function addPage() { N.extra = (N.extra || 0) + PAGE; sizeCanvas(); N.paper.scrollTo({ top: N.paper.scrollTop + N.paper.clientHeight * 0.8, behavior: 'smooth' }); }
  function strokeWidth(s, pr) { return s.e ? s.w : s.w * (0.45 + 1.1 * (pr == null ? 0.5 : pr)); }
  function drawStroke(ctx, s, from) {
    var p = s.p; if (!p.length) return;
    ctx.save();
    ctx.globalCompositeOperation = s.e ? 'destination-out' : 'source-over';
    ctx.strokeStyle = s.c; ctx.fillStyle = s.c; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (p.length === 1) { ctx.beginPath(); ctx.arc(p[0][0], p[0][1], strokeWidth(s, p[0][2] / 100) / 2, 0, Math.PI * 2); ctx.fill(); ctx.restore(); return; }
    for (var i = Math.max(1, from || 1); i < p.length; i++) {
      var a = p[i - 1], b = p[i];
      ctx.lineWidth = strokeWidth(s, (a[2] + b[2]) / 200);
      ctx.beginPath(); ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]); ctx.stroke();
    }
    ctx.restore();
  }
  function redraw() {
    if (!N.ctx) return;
    var c = N.canvas; N.ctx.clearRect(0, 0, c.width, c.height);
    (N.note.ink || []).forEach(function (s) { drawStroke(N.ctx, s); });
  }
  function setupCanvas() {
    var c = N.canvas, cur = null, touchY = null;
    function pt(e) { var r = c.getBoundingClientRect(); return [Math.round((e.clientX - r.left) * 10) / 10, Math.round((e.clientY - r.top) * 10) / 10, Math.round((e.pressure || (e.pointerType === 'pen' ? 0.5 : 0.5)) * 100)]; }
    c.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'pen') N.penSeen = true;
      if (e.pointerType === 'touch' && N.penSeen) { touchY = e.clientY; try { c.setPointerCapture(e.pointerId); } catch (x) {} return; } // fingers scroll once a Pencil is in use
      if (e.button > 0) return;
      e.preventDefault();
      try { c.setPointerCapture(e.pointerId); } catch (x) {}
      cur = { id: e.pointerId, s: { c: N.eraser ? '#000' : N.color, w: N.eraser ? 22 : N.size, e: N.eraser || undefined, p: [pt(e)] } };
      if (!cur.s.e) delete cur.s.e;
      N.redo = [];
      N.note.ink.push(cur.s);
      drawStroke(N.ctx, cur.s);
    });
    c.addEventListener('pointermove', function (e) {
      if (touchY != null && e.pointerType === 'touch') { N.paper.scrollTop -= e.clientY - touchY; touchY = e.clientY; return; }
      if (!cur || e.pointerId !== cur.id) return;
      e.preventDefault();
      var evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [e]; if (!evs.length) evs = [e];
      var start = cur.s.p.length;
      evs.forEach(function (ev) { var q = pt(ev), l = cur.s.p[cur.s.p.length - 1]; if (Math.abs(q[0] - l[0]) + Math.abs(q[1] - l[1]) >= 0.8) cur.s.p.push(q); });
      drawStroke(N.ctx, cur.s, start);
    });
    function end(e) {
      if (touchY != null && e.pointerType === 'touch') { touchY = null; return; }
      if (!cur || e.pointerId !== cur.id) return;
      cur = null; changed();
      if (inkHeight() > c.clientHeight - 200) sizeCanvas();
    }
    c.addEventListener('pointerup', end); c.addEventListener('pointercancel', end);
    c.addEventListener('touchstart', function (e) { if (!N.penSeen || e.touches.length > 1) return; }, { passive: true });
  }
  function undo() { var s = N.note.ink.pop(); if (s) { N.redo.push(s); redraw(); changed(); } }
  function redo() { var s = N.redo.pop(); if (s) { N.note.ink.push(s); redraw(); changed(); } }

  // Render the handwriting in black on white, trimmed to what's written (for reading and sharing).
  function inkImage(scale, forOcr) {
    var ink = N.note.ink || []; if (!ink.length) return null;
    var minX = 1e9, minY = 1e9, maxX = 0, maxY = 0;
    ink.forEach(function (s) { if (s.e) return; s.p.forEach(function (q) { minX = Math.min(minX, q[0]); minY = Math.min(minY, q[1]); maxX = Math.max(maxX, q[0]); maxY = Math.max(maxY, q[1]); }); });
    if (minX > maxX) return null;
    var pad = 30; minX -= pad; minY -= pad; maxX += pad; maxY += pad;
    var cv = document.createElement('canvas'); cv.width = Math.ceil((maxX - minX) * scale); cv.height = Math.ceil((maxY - minY) * scale);
    var ctx = cv.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    var layer = document.createElement('canvas'); layer.width = cv.width; layer.height = cv.height;
    var lc = layer.getContext('2d'); lc.setTransform(scale, 0, 0, scale, -minX * scale, -minY * scale);
    ink.forEach(function (s) { var t = forOcr && !s.e ? Object.assign({}, s, { c: '#000', w: Math.max(s.w, 2.6) * 1.15 }) : s; drawStroke(lc, t); });
    ctx.drawImage(layer, 0, 0);
    return cv;
  }

  /* ---------- convert, email, share ---------- */
  function convert() {
    var b = N.el.querySelector('.nt-convert');
    var img = inkImage(2, true);
    if (!img) { toast('Write something first.', 'err'); return; }
    b.disabled = true; b.textContent = 'Reading handwriting…';
    (window.Tesseract ? Promise.resolve() : loadScript(TESSERACT)).then(function () {
      return window.Tesseract.recognize(img, 'eng', { logger: function (m) { if (m.status === 'recognizing text') b.textContent = 'Reading… ' + Math.round((m.progress || 0) * 100) + '%'; } });
    }).then(function (res) {
      var txt = String(res && res.data && res.data.text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      b.disabled = false; b.textContent = 'Convert to text';
      if (!txt) { toast('Couldn’t read that handwriting. Try printing more clearly, or use the Text tab with Scribble.', 'err'); return; }
      N.note.body = (N.note.body ? N.note.body.replace(/\s+$/, '') + '\n\n' : '') + txt;
      N.text.value = N.note.body; changed(); setMode('text');
      toast('Converted. Check the text and fix anything it misread.', 'ok');
    }, function () {
      b.disabled = false; b.textContent = 'Convert to text';
      toast('Couldn’t load the handwriting reader. Check the connection and try again, or use the Text tab with Scribble.', 'err');
    });
  }
  function noteText() {
    var body = (N.note.body || '').trim();
    if (!body && N.note.ink && N.note.ink.length) body = '(Handwritten note. Use Share to send it with the handwriting attached, or Convert to text first.)';
    return body;
  }
  function mailUrl() {
    var subject = (N.note.title || '').trim() || noteTitle(N.note);
    return 'mailto:?subject=' + encodeURIComponent(subject) + '&body=' + encodeURIComponent(noteText() + '\n\n— ' + (C.name || 'Eden'));
  }
  function emailNote() { saveNote(); location.href = mailUrl(); }
  function shareNote() {
    var subject = (N.note.title || '').trim() || noteTitle(N.note);
    var img = inkImage(2, false), data = { title: subject, text: (N.note.body || '').trim() || subject };
    var go = function (files) { if (files && navigator.canShare && navigator.canShare({ files: files })) data.files = files; return navigator.share(data).catch(function () {}); };
    if (img && img.toBlob) img.toBlob(function (bl) { go(bl ? [new File([bl], (subject.replace(/[^\w\- ]+/g, '').trim() || 'note') + '.png', { type: 'image/png' })] : null); }, 'image/png');
    else go(null);
  }

  /* ---------- file a note into the To-do list ---------- */
  function toTodo() {
    var body = (N.note.body || '').trim(), title = (N.note.title || '').trim();
    var lines = body.split('\n').map(function (l) { return l.replace(/^\s*([-*•☐□]|\d+[.)]|\[ ?\])\s*/, '').trim(); }).filter(Boolean);
    if (!title && !lines.length) { toast(N.note.ink.length ? 'Convert the handwriting to text first, or give the note a title.' : 'Write something first.', 'err'); return; }
    var each = h('input', { type: 'radio', name: 'ntSplit', value: 'each' }), one = h('input', { type: 'radio', name: 'ntSplit', value: 'one' });
    (lines.length > 1 ? each : one).checked = true;
    var due = h('input', { type: 'date' });
    var prev = h('ul', { cls: 'nt-prev' });
    function paint() {
      prev.innerHTML = '';
      var items = each.checked && lines.length ? lines : [title || lines[0]];
      items.slice(0, 30).forEach(function (t) { prev.appendChild(h('li', { text: t })); });
      if (items.length > 30) prev.appendChild(h('li', { text: '…and ' + (items.length - 30) + ' more' }));
    }
    each.addEventListener('change', paint); one.addEventListener('change', paint);
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var back = h('div', { cls: 'sc-modal nt-modal', role: 'dialog', 'aria-modal': 'true' });
    var card = h('div', { cls: 'sc-card' }, [
      h('div', { cls: 'sc-card-h' }, [h('h2', { text: 'Add to to-do list' }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: function () { back.remove(); } } })]),
      h('div', { cls: 'sc-card-b' }, [
        lines.length > 1 ? h('label', { cls: 'sc-check' }, [each, ' One to-do for each line (' + lines.length + ')']) : null,
        h('label', { cls: 'sc-check' }, [one, lines.length > 1 ? ' One to-do, with the note as its details' : ' Add as one to-do']),
        h('label', { cls: 'sc-f' }, [h('span', { text: 'Due (optional)' }), due]),
        prev, msg
      ]),
      h('div', { cls: 'sc-card-f' }, [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { back.remove(); } } }),
        h('button', { type: 'button', cls: 'ed-btn', text: 'Add', on: { click: add } })])
    ]);
    back.appendChild(card); N.el.appendChild(back); paint();
    function add() {
      var rows = (each.checked && lines.length ? lines.map(function (l) { return { title: l, details: '' }; }) : [{ title: title || lines[0], details: title ? body : lines.slice(1).join('\n') }])
        .map(function (r, i) { return { id: uid(), title: r.title.slice(0, 300), details: r.details, due: due.value || null, done: false, created_by: C.name || '', note_id: N.note.id, sort: i }; });
      saveNote().then(function () { return C.sb.from('todos').upsert(rows, { onConflict: 'id' }); }).then(function (r) {
        if (r.error) { msg.textContent = isMissing(r.error) ? 'The to-do list isn’t set up yet. Run supabase/notes.sql in Supabase.' : isPerm(r.error) ? 'Your role can’t use the to-do list.' : 'Couldn’t add. Try again.'; return; }
        T.items = T.items.concat(rows.map(function (x) { return Object.assign({ created_at: new Date().toISOString() }, x); }));
        back.remove(); toast('Added ' + rows.length + ' to-do' + (rows.length === 1 ? '' : 's') + '.', 'ok');
        renderTodo();
      });
    }
  }

  /* ---------- To-do page ---------- */
  function loadTodos() {
    return C.sb.from('todos').select('*').order('created_at').then(function (r) {
      T.loaded = true;
      if (r.error) { T.missing = isMissing(r.error); T.items = []; if (!T.missing) C.status(isPerm(r.error) ? 'Your role can’t open the to-do list.' : 'Couldn’t load the to-do list.', 'err'); return; }
      T.missing = false; T.items = r.data || [];
    }, function () { T.loaded = true; });
  }
  function saveTodo(t) {
    return C.sb.from('todos').upsert({ id: t.id, title: t.title, details: t.details || '', due: t.due || null, done: !!t.done, done_at: t.done ? (t.done_at || new Date().toISOString()) : null, created_by: t.created_by || '', note_id: t.note_id || null, sort: t.sort || 0 }, { onConflict: 'id' })
      .then(function (r) { if (r.error) C.status(isPerm(r.error) ? 'Your role can’t change the to-do list.' : 'Couldn’t save. Try again.', 'err'); else C.status('Saved.', 'ok'); return r; });
  }
  function renderTodo() {
    var el = T.el; if (!el || el.hidden) return;
    el.innerHTML = '';
    var wrap = h('div', { cls: 'td-in' }); el.appendChild(wrap);
    wrap.appendChild(h('div', { cls: 'td-title' }, [h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Team' }), h('h1', { cls: 'sc-week', text: 'To-do' })]),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Open notes', on: { click: open } })]));
    if (!T.loaded) { wrap.appendChild(h('p', { cls: 'sc-empty', text: 'Loading…' })); return; }
    if (T.missing) { wrap.appendChild(h('div', { cls: 'iv-setup' }, [h('p', { text: 'The to-do list isn’t in Supabase yet. In Supabase, open SQL Editor → New query, paste the contents of supabase/notes.sql from the eden-admin repository, and click Run. Then reload this page.' })])); return; }
    var inp = h('input', { type: 'text', cls: 'td-new', placeholder: 'Add a to-do and press Enter', 'aria-label': 'New to-do' });
    var due = h('input', { type: 'date', cls: 'td-due', 'aria-label': 'Due date (optional)' });
    function addNew() {
      var v = inp.value.trim(); if (!v) { inp.focus(); return; }
      var t = { id: uid(), title: v, details: '', due: due.value || null, done: false, created_by: C.name || '', created_at: new Date().toISOString(), sort: 0 };
      T.items.push(t); saveTodo(t); renderTodo();
      var again = T.el.querySelector('.td-new'); if (again) again.focus();
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addNew(); } });
    wrap.appendChild(h('div', { cls: 'td-add' }, [inp, due, h('button', { type: 'button', cls: 'ed-btn', text: 'Add', on: { click: addNew } })]));
    var today = iso(new Date());
    var open1 = T.items.filter(function (t) { return !t.done; }).sort(function (a, b) {
      var da = a.due || '9999', db = b.due || '9999'; return da < db ? -1 : da > db ? 1 : (a.created_at < b.created_at ? -1 : 1);
    });
    var done = T.items.filter(function (t) { return t.done; }).sort(function (a, b) { return (a.done_at || '') < (b.done_at || '') ? 1 : -1; });
    wrap.appendChild(h('p', { cls: 'td-count', text: open1.length ? open1.length + ' to do' + (open1.filter(function (t) { return t.due && t.due < today; }).length ? ' · ' + open1.filter(function (t) { return t.due && t.due < today; }).length + ' overdue' : '') : 'Nothing to do. Nice.' }));
    var ul = h('ul', { cls: 'td-list' }); open1.forEach(function (t) { ul.appendChild(todoRow(t, today)); }); wrap.appendChild(ul);
    if (done.length) {
      wrap.appendChild(h('button', { type: 'button', cls: 'td-donebtn', text: (T.showDone ? 'Hide' : 'Show') + ' done (' + done.length + ')', on: { click: function () { T.showDone = !T.showDone; renderTodo(); } } }));
      if (T.showDone) { var ul2 = h('ul', { cls: 'td-list is-done' }); done.forEach(function (t) { ul2.appendChild(todoRow(t, today)); }); wrap.appendChild(ul2);
        wrap.appendChild(h('button', { type: 'button', cls: 'ed-btn small danger td-clear', text: 'Delete all done', on: { click: function () {
          if (!confirm('Delete all ' + done.length + ' done to-dos?')) return;
          C.sb.from('todos').delete().in('id', done.map(function (t) { return t.id; })).then(function (r) { if (r.error) { C.status('Couldn’t delete. Try again.', 'err'); return; } T.items = T.items.filter(function (t) { return !t.done; }); renderTodo(); });
        } } })); }
    }
  }
  function todoRow(t, today) {
    var cb = h('input', { type: 'checkbox', 'aria-label': 'Done: ' + t.title }); cb.checked = !!t.done;
    cb.addEventListener('change', function () { t.done = cb.checked; t.done_at = t.done ? new Date().toISOString() : null; saveTodo(t); setTimeout(renderTodo, 250); });
    var over = !t.done && t.due && t.due < today, soon = !t.done && t.due === today;
    var li = h('li', { cls: 'td-item' + (t.done ? ' done' : '') + (over ? ' over' : '') }, [
      h('label', { cls: 'td-cb' }, cb),
      h('div', { cls: 'td-main' }, [
        h('button', { type: 'button', cls: 'td-t', text: t.title, on: { click: function () { editTodo(t); } } }),
        t.details ? h('p', { cls: 'td-d', text: t.details }) : null,
        h('span', { cls: 'td-meta', text: [t.due ? (over ? 'Overdue · ' : soon ? 'Today · ' : 'Due ') + dayLabel(t.due) : '', t.created_by ? 'by ' + t.created_by : '', t.note_id ? 'from a note' : ''].filter(Boolean).join(' · ') })
      ]),
      h('button', { type: 'button', cls: 'td-x', 'aria-label': 'Delete ' + t.title, title: 'Delete', text: '✕', on: { click: function () {
        if (!confirm('Delete “' + t.title + '”?')) return;
        C.sb.from('todos').delete().eq('id', t.id).then(function (r) { if (r.error) { C.status('Couldn’t delete. Try again.', 'err'); return; } T.items = T.items.filter(function (x) { return x.id !== t.id; }); renderTodo(); });
      } } })
    ]);
    return li;
  }
  function editTodo(t) {
    var title = h('input', { type: 'text', value: t.title }), details = h('textarea', { rows: '5' }); details.value = t.details || '';
    var due = h('input', { type: 'date', value: t.due || '' });
    var back = h('div', { cls: 'sc-modal', role: 'dialog', 'aria-modal': 'true' });
    function close() { back.remove(); }
    var noteBtn = t.note_id ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Open the note', on: { click: function () { close(); openNote(t.note_id); } } }) : null;
    back.appendChild(h('div', { cls: 'sc-card' }, [
      h('div', { cls: 'sc-card-h' }, [h('h2', { text: 'To-do' }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: close } })]),
      h('div', { cls: 'sc-card-b' }, [h('label', { cls: 'sc-f' }, [h('span', { text: 'To-do' }), title]), h('label', { cls: 'sc-f td-det' }, [h('span', { text: 'Details' }), details]), h('label', { cls: 'sc-f' }, [h('span', { text: 'Due (optional)' }), due])]),
      h('div', { cls: 'sc-card-f' }, [noteBtn || h('span'), h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: close } }),
        h('button', { type: 'button', cls: 'ed-btn', text: 'Save', on: { click: function () { if (!title.value.trim()) { title.focus(); return; } t.title = title.value.trim(); t.details = details.value; t.due = due.value || null; saveTodo(t); close(); renderTodo(); } } })])
    ]));
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    document.body.appendChild(back); setTimeout(function () { title.focus(); }, 30);
  }
  function openNote(id) {
    open();
    var n = N.notes.filter(function (x) { return x.id === id; })[0];
    if (n) pick(n);
    else C.sb.from('notes').select('id,title,body,ink,created_at,updated_at').eq('id', id).then(function (r) { var x = r.data && r.data[0]; if (x) pick(x); else toast('That note was written by someone else, or deleted.', 'err'); });
  }

  window.EdenNotes = {
    init: function (ctx) { C.sb = ctx.sb; C.status = ctx.status || C.status; C.name = ctx.name || ''; },
    open: open, close: close,
    showTodo: function (ctx) { if (ctx) window.EdenNotes.init(ctx); T.el = ctx.el; T.loaded = false; renderTodo(); loadTodos().then(renderTodo); },
    _test: { N: N, T: T, inkImage: inkImage, mailUrl: mailUrl }
  };
})();
