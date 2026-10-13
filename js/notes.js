/* Eden staff site: Notes (handwriting with Apple Pencil, or typed) and the shared To-do list.
 *
 * Notes open in a full-screen window from the top bar. Handwriting: draw with Apple Pencil (pressure
 * sensitive; your palm and fingers don't draw once the Pencil is used, fingers scroll instead). Text: on an
 * iPad, writing with Apple Pencil in the text box is turned into typed text by iPadOS (Scribble). "Convert
 * to text" reads the handwriting page line by line (Tesseract, loaded only when asked; neat printing reads
 * best) and shows each line beside what was read so it can be corrected. Notes save automatically and are private to the person who wrote them,
 * unless they're moved into the shared folder ("Shared · Owner & managers", supabase/shared-notes.sql), where the Owner and
 * every manager can read and edit them. A note can be emailed,
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
  var T = { el: null, items: [], loaded: false, missing: false, showDone: false, people: [], assignOk: false, filter: 'all' };

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
  function blankNote(shared) { return { id: uid(), title: '', body: '', ink: [], shared: !!shared, created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _new: true }; }
  function mine(n) { return !n.user_id || n.user_id === C.uid; }
  function canShare() { return C.canShare && !C.noShare; }
  var SHARED_NAME = 'Shared · Owner & managers';
  function hasContent(n) { return !!(n && ((n.title || '').trim() || (n.body || '').trim() || (n.ink && n.ink.length))); }
  function noteTitle(n) { return (n.title || '').trim() || (n.body || '').trim().split('\n')[0].slice(0, 60) || (n.ink && n.ink.length ? 'Handwritten note' : 'Untitled note'); }
  function toast(t, k) { var el = N.el && N.el.querySelector('.nt-state'); if (el) { el.textContent = t; el.className = 'nt-state' + (k ? ' ' + k : ''); } }

  /* ---------- notes: data ---------- */
  function loadNotes() {
    var cols = 'id,title,body,ink,created_at,updated_at';
    return C.sb.from('notes').select(cols + (C.noShare ? '' : ',user_id,shared,author,edited_by')).order('updated_at', { ascending: false }).then(function (r) {
      if (r.error && !C.noShare && (r.error.code === '42703' || /column .* does not exist|shared/i.test(r.error.message || ''))) { C.noShare = true; return loadNotes(); }   // shared-notes.sql not run yet
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
    var row = { id: n.id, title: n.title || '', body: n.body || '', ink: n.ink || [] };
    if (!C.noShare) row.shared = !!n.shared;
    return C.sb.from('notes').upsert(row, { onConflict: 'id' }).then(function (r) {
      N.saving = false;
      if (r.error) {
        N.dirty = true;
        if (isMissing(r.error)) { N.missing = true; toast('Kept on this device. Run supabase/notes.sql to save notes online.', 'err'); return; }
        toast(isPerm(r.error) ? 'Your role can’t save notes.' : 'Not saved yet. Will retry.', 'err');
        clearTimeout(N.saveT); N.saveT = setTimeout(saveNote, 5000); return;
      }
      delete n._new;
      if (!n.user_id) n.user_id = C.uid;
      if (n.shared) { n.edited_by = C.name; if (!n.author) n.author = C.name; }
      var at = -1; N.notes.forEach(function (x, i) { if (x.id === n.id) at = i; });
      if (at === -1) N.notes.unshift(n); else N.notes[at] = n;
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
    loadNotes().then(function () { paintList(); paintFolder(); if (N.dirty) saveNote(); });
  }
  function close() {
    stopDictation();
    clearInterval(N.poll); N.folderEl = null;
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
      C.canShare ? folderPicker() : null,
      h('div', { cls: 'nt-mode', role: 'group', 'aria-label': 'Mode' }, [
        h('button', { type: 'button', 'data-mode': 'text', text: 'Write', title: 'Write with Apple Pencil; Scribble turns it into text', on: { click: function () { setMode('text'); } } }),
        h('button', { type: 'button', 'data-mode': 'ink', text: 'Sketch', title: 'Draw or keep handwriting as ink', on: { click: function () { setMode('ink'); } } })
      ]),
      h('span', { cls: 'nt-state', role: 'status' }),
      h('div', { cls: 'nt-acts' }, [
        h('button', { type: 'button', cls: 'nt-b nt-mic', 'aria-pressed': 'false', title: 'Speak your note; it’s typed on the Write page', on: { click: toggleDictation } }, [h('span', { cls: 'nt-mic-dot', 'aria-hidden': 'true' }), h('span', { cls: 'nt-mic-l', text: 'Dictate' })]),
        h('button', { type: 'button', cls: 'nt-b', text: 'Email', on: { click: emailNote } }),
        share,
        h('button', { type: 'button', cls: 'nt-b', text: 'Add to to-do', on: { click: toTodo } }),
        C.canPreshift ? h('button', { type: 'button', cls: 'nt-b nt-psbtn', text: 'Send to pre-shift', title: 'Put this note in the Notes section of Pre-shift for the whole team', on: { click: toPreshift } }) : null,
        C.canCal && window.EdenCal ? h('button', { type: 'button', cls: 'nt-b nt-calbtn', text: 'Add to calendar', title: 'Save this note as an event on the calendar', on: { click: toCalendar } }) : null,
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
    tools.appendChild(h('button', { type: 'button', cls: 'nt-b nt-convert', text: 'Convert sketch to text', on: { click: convert } }));
    el.appendChild(tools);
    el.appendChild(h('div', { cls: 'nt-sharebar', role: 'status', hidden: true }));
    // body: list | page
    var list = h('aside', { cls: 'nt-list', 'aria-label': 'My notes' });
    var paper = h('div', { cls: 'nt-paper' });
    var canvas = h('canvas', { cls: 'nt-canvas', 'aria-label': 'Handwriting area' });
    paper.appendChild(canvas);
    var text = h('textarea', { cls: 'nt-text', placeholder: 'Write here with your Apple Pencil — your handwriting turns into text as you go. You can also type.', autocapitalize: 'sentences', spellcheck: 'true' });
    text.value = N.note.body || '';
    text.addEventListener('input', function () { N.note.body = text.value; changed(); paintList(); });
    var hint = h('div', { cls: 'nt-hint' }, [
      h('span', { text: 'Pencil tips: scratch out to delete · circle to select · touch and hold to make space · vertical line to join or split words.' }),
      h('span', { cls: 'nt-hint-off', text: 'Writing stays as ink? Turn on Settings → Apple Pencil → Scribble.' })
    ]);
    el.appendChild(h('div', { cls: 'nt-body' }, [list, h('div', { cls: 'nt-page' }, [paper, h('div', { cls: 'nt-textwrap' }, [text, h('div', { cls: 'nt-live', role: 'status', 'aria-live': 'polite', hidden: true }), hint])])]));
    el.addEventListener('selectstart', function (e) { if (!e.target.closest || !e.target.closest('input, textarea')) e.preventDefault(); });
    el.addEventListener('contextmenu', function (e) { if (!e.target.closest('input, textarea')) e.preventDefault(); });
    document.body.appendChild(el);
    try { var sel = window.getSelection(); if (sel) sel.removeAllRanges(); } catch (x) {}
    N.canvas = canvas; N.paper = paper; N.text = text; N.titleEl = title; N.list = list;
    setupCanvas();
    setMode(N.note.ink && N.note.ink.length && !(N.note.body || '').trim() ? 'ink' : 'text');
    paintTools(); paintList(); paintFolder();
    window.addEventListener('resize', onResize);
    clearInterval(N.poll);
    N.poll = setInterval(function () { if (N.el && !N.el.hidden && canShare()) loadNotes().then(paintList); }, 60000);   // see colleagues' new shared notes
    el.addEventListener('keydown', function (e) { if (e.key === 'Escape' && !document.querySelector('.sc-modal')) close(); if ((e.metaKey || e.ctrlKey) && e.key === 'z' && N.mode === 'ink' && document.activeElement.tagName !== 'INPUT' && document.activeElement.tagName !== 'TEXTAREA') { e.preventDefault(); e.shiftKey ? redo() : undo(); } });
  }
  // Share with the team: one obvious button next to the title
  function folderPicker() {
    var btn = h('button', { type: 'button', cls: 'nt-share', on: { click: function () {
      if (C.noShare) { alert('Sharing notes switches on once supabase/shared-notes.sql is run in Supabase (SQL Editor → New query → paste → Run).'); return; }
      if (!N.note.shared) { N.note.shared = true; changed(); paintList(); paintFolder(); toast('Shared with the Owner and managers', 'ok'); return; }
      if (!mine(N.note)) { alert('Only ' + (N.note.author || 'the person who wrote it') + ' can make this note private again.'); return; }
      if (!confirm('Make this note private again? The Owner and managers will no longer see it.')) return;
      N.note.shared = false; changed(); paintList(); paintFolder(); toast('Moved to My notes (private)', 'ok');
    } } });
    N.folderEl = btn;
    return btn;
  }
  function paintFolder() {
    var b = N.folderEl; if (!b) return;
    var on = !!N.note.shared;
    b.classList.toggle('on', on);
    b.setAttribute('aria-pressed', on ? 'true' : 'false');
    b.innerHTML = '';
    b.appendChild(h('span', { cls: 'nt-share-i', 'aria-hidden': 'true', text: on ? '\u2713' : '+' }));
    b.appendChild(document.createTextNode(on ? 'Shared with team' : 'Share with team'));
    b.title = on ? (mine(N.note) ? 'The Owner and managers can read and edit this note. Click to make it private again.' : 'Shared by ' + (N.note.author || 'a colleague') + '. The Owner and managers can read and edit it.')
      : 'Put this note in the shared folder so the Owner and managers can read and edit it';
    var bar = N.el && N.el.querySelector('.nt-sharebar');
    if (bar) {
      bar.hidden = !on;
      bar.textContent = on ? 'Shared with the team: the Owner and managers can read and edit this note' + (N.note.author && !mine(N.note) ? ' · written by ' + N.note.author : '') + (N.note.edited_by && N.note.edited_by !== N.note.author ? ' · last edited by ' + N.note.edited_by : '') + '.' : '';
    }
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
    var all = N.notes.slice();
    if (hasContent(N.note) && !all.some(function (x) { return x.id === N.note.id; })) all.unshift(N.note);
    var item = function (n) {
      var cur = n.id === N.note.id, src = cur ? N.note : n;
      var meta = when(src.updated_at) + (src.ink && src.ink.length ? ' · handwriting' : '');
      if (src.shared && (src.author || src.edited_by)) meta = (src.edited_by && src.edited_by !== src.author ? src.author + ' · edited by ' + src.edited_by : (src.author ? 'by ' + src.author : '')) + ' · ' + meta;
      var canDel = mine(src) || (src.shared && C.isOwner);
      return h('div', { cls: 'nt-item' + (cur ? ' on' : '') }, [
        h('button', { type: 'button', cls: 'nt-item-open', on: { click: function () { pick(n); } } }, [h('b', { text: noteTitle(src) }), h('span', { text: meta })]),
        canDel ? h('button', { type: 'button', cls: 'nt-item-del', 'aria-label': 'Delete note', title: 'Delete note', text: '✕', on: { click: function () { delNote(n); } } }) : null
      ]);
    };
    var section = function (title, notes, shared, empty) {
      list.appendChild(h('div', { cls: 'nt-list-h' + (shared ? ' nt-list-shared' : '') }, [h('b', { text: title }), h('button', { type: 'button', cls: 'nt-b small', text: '+ New', 'aria-label': 'New note in ' + title, on: { click: function () { newNote(shared); } } })]));
      if (shared) list.appendChild(h('p', { cls: 'nt-list-note', text: 'The Owner and managers can read and edit these.' }));
      if (!notes.length) list.appendChild(h('p', { cls: 'nt-list-note', text: N.loaded ? empty : 'Loading…' }));
      notes.forEach(function (n) { list.appendChild(item(n)); });
    };
    if (N.missing) list.appendChild(h('p', { cls: 'nt-list-note', text: 'Notes are kept on this device until supabase/notes.sql is run in Supabase.' }));
    var isShared = function (n) { return !!(n.id === N.note.id ? N.note : n).shared; };
    section('My notes', all.filter(function (n) { return !isShared(n); }), false, 'No private notes yet.');
    if (canShare()) section('Shared folder', all.filter(isShared), true, 'Nothing shared yet. Press “Share with team” at the top of a note to share it with the Owner and managers.');
    else if (C.canShare && C.noShare) list.appendChild(h('p', { cls: 'nt-list-note', text: 'The shared folder switches on once supabase/shared-notes.sql is run in Supabase.' }));
  }
  function load(n) {
    stopDictation();
    N.note = n; N.redo = []; N.dirty = false;
    N.titleEl.value = n.title || ''; N.text.value = n.body || '';
    N.paper.scrollTop = 0; N.extra = 0;
    setMode(n.ink && n.ink.length && !(n.body || '').trim() ? 'ink' : 'text');
    redraw(); paintList(); paintFolder(); toast(n.shared && !mine(n) ? 'Shared by ' + (n.author || 'a colleague') + '. Your changes save for everyone.' : '');
    N.el.classList.remove('show-list');
  }
  function pick(n) {
    if (n.id === N.note.id) { N.el.classList.remove('show-list'); return; }
    var go = function () {
      if (!n.shared || n._new) { load(JSON.parse(JSON.stringify(n))); return; }
      // a shared note may have been changed by someone else since the list loaded: open the latest
      C.sb.from('notes').select('id,title,body,ink,created_at,updated_at,user_id,shared,author,edited_by').eq('id', n.id).then(function (r) {
        var fresh = r && !r.error && r.data && r.data[0];
        if (fresh) N.notes = N.notes.map(function (x) { return x.id === fresh.id ? fresh : x; });
        load(JSON.parse(JSON.stringify(fresh || n)));
      }, function () { load(JSON.parse(JSON.stringify(n))); });
    };
    if (N.dirty) saveNote().then(go); else go();
  }
  function newNote(shared) { var go = function () { load(blankNote(shared === true && canShare())); dropDraft(); }; if (N.dirty) saveNote().then(go); else go(); }
  function delNote(n) {
    if (!confirm('Delete “' + noteTitle(n.id === N.note.id ? N.note : n) + '”? This can’t be undone.')) return;
    if ((n.id === N.note.id ? N.note : n).shared && !confirm('This note is in the shared folder. Deleting it removes it for everyone. Delete it?')) return;
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
    // iPad Safari: stop a Pencil or finger press on the page from starting a text selection / Copy menu or a magnifier.
    ['touchstart', 'touchmove', 'touchend'].forEach(function (t) { c.addEventListener(t, function (e) { if (e.cancelable) e.preventDefault(); }, { passive: false }); });
    c.addEventListener('contextmenu', function (e) { e.preventDefault(); });
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

  /* ---------- speech to text ----------
   * Uses the browser's built-in speech recognition (on iPad/iPhone it's Apple's, the same as Siri dictation;
   * also Chrome and Edge). Words are typed into the Write page at the cursor. Say "period", "comma",
   * "question mark", "new line" or "new paragraph" for punctuation. */
  var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  var D = { rec: null, on: false, interim: '' };
  var SPOKEN = [
    [/\s*\b(new paragraph)\b\s*/gi, '\n\n'], [/\s*\b(new line|next line)\b\s*/gi, '\n'],
    [/\s*\b(period|full stop)\b/gi, '.'], [/\s*\bcomma\b/gi, ','], [/\s*\bquestion mark\b/gi, '?'],
    [/\s*\bexclamation (point|mark)\b/gi, '!'], [/\s*\bcolon\b/gi, ':'], [/\s*\bdash\b\s*/gi, ' – ']
  ];
  function spoken(t) { SPOKEN.forEach(function (r) { t = t.replace(r[0], r[1]); }); t = t.replace(/[ \t]+\n/g, '\n').replace(/\n[ \t]+/g, '\n');
    return t.replace(/([.!?]\s+|\n)([a-z])/g, function (m, p, c) { return p + c.toUpperCase(); }); }
  function insertSpeech(raw) {
    if (!N.el || !N.note || N.note.id !== D.noteId) return;
    var ta = N.text, txt = spoken(String(raw || '').trim()); if (!txt) return;
    var v = ta.value, at = typeof ta.selectionStart === 'number' && document.activeElement === ta ? ta.selectionStart : (D.pos != null ? D.pos : v.length), end = typeof ta.selectionEnd === 'number' && document.activeElement === ta ? ta.selectionEnd : at;
    var before = v.slice(0, at), after = v.slice(end);
    var startSentence = !before.trim() || /[.!?]\s*$|\n\s*$/.test(before);
    if (startSentence) txt = txt.charAt(0).toUpperCase() + txt.slice(1);
    var sep = !before || /\s$/.test(before) || /^[.,!?:\n]/.test(txt) ? '' : ' ';
    var tail = after && !/^[\s.,!?:]/.test(after) ? ' ' : '';
    ta.value = before + sep + txt + tail + after;
    D.pos = (before + sep + txt).length;
    try { ta.setSelectionRange(D.pos, D.pos); } catch (e) {}
    N.note.body = ta.value; changed(); paintList();
  }
  function live(t) { var el = N.el && N.el.querySelector('.nt-live'); if (!el) return; el.hidden = !t; el.textContent = t || ''; }
  function paintMic() {
    var b = N.el && N.el.querySelector('.nt-mic'); if (!b) return;
    b.setAttribute('aria-pressed', D.on ? 'true' : 'false'); b.classList.toggle('on', D.on);
    b.querySelector('.nt-mic-l').textContent = D.on ? 'Stop' : 'Dictate';
  }
  function toggleDictation() { if (D.on) stopDictation(); else startDictation(); }
  function startDictation() {
    if (!SR) {
      setMode('text');
      toast('This browser can’t dictate here. Tap the page, then use the microphone key on the keyboard instead.', 'err');
      return;
    }
    setMode('text');
    D.noteId = N.note.id;
    var ta = N.text; D.pos = document.activeElement === ta ? ta.selectionStart : ta.value.length;
    var rec = new SR();
    rec.lang = navigator.language || 'en-US'; rec.continuous = true; rec.interimResults = true; rec.maxAlternatives = 1;
    rec.onresult = function (e) {
      var interim = '';
      for (var i = e.resultIndex; i < e.results.length; i++) {
        var r = e.results[i];
        if (r.isFinal) insertSpeech(r[0].transcript); else interim += r[0].transcript;
      }
      live(interim ? '“' + interim.trim() + '…”' : 'Listening…');
    };
    rec.onerror = function (e) {
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      D.on = false; paintMic(); live('');
      toast(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'Microphone access is off. Allow it for this site (on iPad: Settings → Safari → Microphone), then try again.' : 'Dictation stopped (' + e.error + '). Tap Dictate to try again.', 'err');
    };
    rec.onend = function () {
      if (D.on && D.rec === rec) { try { rec.start(); return; } catch (x) {} } // keep listening through pauses
      if (D.rec === rec) { D.on = false; D.rec = null; paintMic(); live(''); }
    };
    try { rec.start(); } catch (x) { toast('Couldn’t start dictation. Try again.', 'err'); return; }
    D.rec = rec; D.on = true; paintMic(); live('Listening… say “period”, “comma” or “new line” for punctuation.');
  }
  function stopDictation() {
    if (!D.rec) { D.on = false; paintMic(); return; }
    var rec = D.rec; D.on = false; paintMic(); live('');
    try { rec.stop(); } catch (x) {}
    setTimeout(function () { if (D.rec === rec) D.rec = null; }, 1500); // let the last words arrive
  }

  /* ---------- email, share ---------- */
  /* ---------- convert handwriting to text ----------
   * The reader (Tesseract) was made for print, so the page is cleaned up for it first:
   *   1. strokes are grouped into lines of writing (by where they sit on the page, not by the ruled lines,
   *      so big or slanted writing still groups correctly; dots and crossbars join their line),
   *   2. each line is drawn on its own in solid black, scaled to a steady size with an even pen width,
   *   3. each line is read as a single line of text,
   * and then every line is shown next to what was read so mistakes are quick to fix before it's used. */
  function strokeBox(s) {
    var x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    s.p.forEach(function (q) { if (q[0] < x0) x0 = q[0]; if (q[0] > x1) x1 = q[0]; if (q[1] < y0) y0 = q[1]; if (q[1] > y1) y1 = q[1]; });
    return { s: s, x0: x0, y0: y0, x1: x1, y1: y1, h: Math.max(1, y1 - y0), cy: (y0 + y1) / 2 };
  }
  function segmentLines(ink) {
    var boxes = ink.filter(function (s) { return !s.e && s.p.length; }).map(strokeBox);
    if (!boxes.length) return [];
    var hs = boxes.map(function (b) { return b.h; }).sort(function (a, b) { return a - b; });
    var med = hs[Math.floor(hs.length / 2)] || 20;
    var big = boxes.filter(function (b) { return b.h >= med * 0.35 || b.h >= 12; }).sort(function (a, b) { return a.cy - b.cy; });
    var small = boxes.filter(function (b) { return big.indexOf(b) === -1; });
    var lines = [];
    big.forEach(function (b) {
      var best = null, bestOv = 0;
      lines.forEach(function (L) {
        var ov = Math.min(L.y1, b.y1) - Math.max(L.y0, b.y0);
        var need = 0.45 * Math.min(b.h, L.core);
        if (ov > need && ov > bestOv) { best = L; bestOv = ov; }
      });
      if (best) { best.items.push(b); best.y0 = Math.min(best.y0, b.y0); best.y1 = Math.max(best.y1, b.y1); best.core = Math.max(best.core, b.h); best.cys.push(b.cy); }
      else lines.push({ items: [b], y0: b.y0, y1: b.y1, core: b.h, cys: [b.cy] });
    });
    lines.forEach(function (L) { L.mid = L.cys.reduce(function (a, c) { return a + c; }, 0) / L.cys.length; });
    // dots, accents, crossbars: to the line whose middle is closest
    small.forEach(function (b) {
      var best = null, d = 1e9;
      lines.forEach(function (L) { var dd = Math.abs(L.mid - b.cy) - (b.cy >= L.y0 - L.core * 0.6 && b.cy <= L.y1 ? 1e6 : 0); if (dd < d) { d = dd; best = L; } });
      if (best) { best.items.push(b); best.y0 = Math.min(best.y0, b.y0); best.y1 = Math.max(best.y1, b.y1); }
      else lines.push({ items: [b], y0: b.y0, y1: b.y1, core: b.h, mid: b.cy });
    });
    lines.sort(function (a, b) { return a.mid - b.mid; });
    return lines.map(function (L) {
      var x0 = 1e9, x1 = -1e9; L.items.forEach(function (b) { x0 = Math.min(x0, b.x0); x1 = Math.max(x1, b.x1); });
      return { strokes: L.items.map(function (b) { return b.s; }), x0: x0, x1: x1, y0: L.y0, y1: L.y1, core: L.core };
    });
  }
  function lineImage(line, erasers) {
    var target = 64, h = Math.max(line.core, 14);             // letters about 64px tall for the reader
    var sc = Math.max(0.4, Math.min(4, target / h)), pad = 24, penPx = 4.2;
    var w = Math.ceil((line.x1 - line.x0) * sc + pad * 2), hh = Math.ceil((line.y1 - line.y0) * sc + pad * 2);
    var cv = document.createElement('canvas'); cv.width = Math.max(40, w); cv.height = Math.max(40, hh);
    var ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    var layer = document.createElement('canvas'); layer.width = cv.width; layer.height = cv.height;
    var lc = layer.getContext('2d'); lc.setTransform(sc, 0, 0, sc, pad - line.x0 * sc, pad - line.y0 * sc);
    line.strokes.forEach(function (s) {
      var t = { c: '#000', w: penPx / sc, p: s.p.map(function (q) { return [q[0], q[1], 50]; }) }; // even width: pressure off
      drawStroke(lc, t);
    });
    (erasers || []).forEach(function (s) { drawStroke(lc, s); });
    ctx.drawImage(layer, 0, 0);
    return cv;
  }
  function cleanLine(t) {
    return String(t || '').replace(/\s+/g, ' ')
      .replace(/^[\s|_~`'".,:;\-—=]+|[\s|_~`'"=]+$/g, '')
      .replace(/(^|\s)\|(\s|$)/g, '$1I$2').replace(/(^|\s)0(?=[a-z])/g, '$1o')
      .trim();
  }
  var OCR = { worker: null };
  function getWorker(onProg) {
    if (OCR.worker) return Promise.resolve(OCR.worker);
    return (window.Tesseract ? Promise.resolve() : loadScript(TESSERACT)).then(function () {
      var T5 = window.Tesseract;
      if (!T5.createWorker) return null;
      return Promise.resolve(T5.createWorker('eng', 1, { logger: function (m) { if (onProg && m.status && /load|init/i.test(m.status)) onProg('Getting the reader ready…'); } })).then(function (w) {
        return Promise.resolve(w.setParameters({ tessedit_pageseg_mode: (T5.PSM && T5.PSM.SINGLE_LINE) || '7', preserve_interword_spaces: '1' })).then(function () { OCR.worker = w; return w; });
      });
    });
  }
  function convert() {
    var b = N.el.querySelector('.nt-convert');
    var ink = N.note.ink || [];
    var lines = segmentLines(ink), erasers = ink.filter(function (s) { return s.e; });
    if (!lines.length) { toast('Write something first.', 'err'); return; }
    var imgs = lines.map(function (L) { return lineImage(L, erasers); });
    var label = function (t) { b.textContent = t; };
    b.disabled = true; label('Reading handwriting…');
    var out = [];
    getWorker(label).then(function (w) {
      var i = 0;
      function next() {
        if (i >= imgs.length) return Promise.resolve();
        label('Reading line ' + (i + 1) + ' of ' + imgs.length + '…');
        var img = imgs[i];
        var job = w ? w.recognize(img) : window.Tesseract.recognize(img, 'eng');
        return Promise.resolve(job).then(function (r) {
          var d = (r && r.data) || {};
          out.push({ img: img, text: cleanLine(d.text), conf: typeof d.confidence === 'number' ? d.confidence : null });
          i++; return next();
        });
      }
      return next();
    }).then(function () {
      b.disabled = false; label('Convert sketch to text');
      review(out);
    }, function () {
      b.disabled = false; label('Convert sketch to text');
      toast('Couldn’t load the handwriting reader. Check the connection and try again, or write on the Write page instead.', 'err');
    });
  }
  // Each line of handwriting next to what was read, ready to fix, then "Use this text".
  function review(rows) {
    var back = h('div', { cls: 'sc-modal nt-modal nt-review', role: 'dialog', 'aria-modal': 'true' });
    var inputs = [];
    var list = h('div', { cls: 'nt-rv-list' });
    rows.forEach(function (r, i) {
      var inp = h('input', { type: 'text', value: r.text, 'aria-label': 'Line ' + (i + 1), autocomplete: 'off', autocapitalize: 'sentences', spellcheck: 'true' });
      inputs.push(inp);
      inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (inputs[i + 1]) inputs[i + 1].focus(); else use(); } });
      var unsure = r.conf != null && r.conf < 60;
      var shot = r.img; shot.className = 'nt-rv-img';
      list.appendChild(h('div', { cls: 'nt-rv-row' + (unsure ? ' unsure' : '') }, [
        h('div', { cls: 'nt-rv-shot' }, shot),
        h('div', { cls: 'nt-rv-txt' }, [inp, unsure ? h('span', { text: 'Not sure about this line, please check it' }) : null])
      ]));
    });
    function close() { back.remove(); }
    function use() {
      var txt = inputs.map(function (x) { return x.value.trim(); }).filter(Boolean).join('\n');
      close();
      if (!txt) { toast('Nothing to add.', 'err'); return; }
      N.note.body = (N.note.body ? N.note.body.replace(/\s+$/, '') + '\n\n' : '') + txt;
      N.text.value = N.note.body; changed(); setMode('text');
      toast('Added to the Write page.', 'ok');
    }
    back.appendChild(h('div', { cls: 'sc-card' }, [
      h('div', { cls: 'sc-card-h' }, [h('h2', { text: 'Check the conversion' }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: close } })]),
      h('div', { cls: 'sc-card-b' }, [
        h('p', { cls: 'sc-sub', text: rows.length + ' line' + (rows.length === 1 ? '' : 's') + ' found. Fix anything it misread (Enter goes to the next line), then use the text. Tip: printed letters with a little space between words read best; for cursive, writing on the Write page is more accurate.' }),
        list
      ]),
      h('div', { cls: 'sc-card-f' }, [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: close } }),
        h('button', { type: 'button', cls: 'ed-btn', text: 'Use this text', on: { click: use } })])
    ]));
    N.el.appendChild(back);
    setTimeout(function () { var first = inputs.filter(function (x, i) { return rows[i].conf != null && rows[i].conf < 60; })[0] || inputs[0]; if (first) first.focus(); }, 40);
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
        .map(function (r, i) { var t = { id: uid(), title: r.title.slice(0, 300), details: r.details, due: due.value || null, done: false, created_by: C.name || '', note_id: N.note.id, sort: i };
          if (T.assignOk && T.uid) { t.assigned_user = T.uid; t.assigned_to = T.myEmp || null; t.assigned_name = C.name || ''; }   // yours, like any new to-do
          return t; });
      saveNote().then(function () { return C.sb.from('todos').upsert(rows, { onConflict: 'id' }); }).then(function (r) {
        if (r.error) { msg.textContent = isMissing(r.error) ? 'The to-do list isn’t set up yet. Run supabase/notes.sql in Supabase.' : isPerm(r.error) ? 'Your role can’t use the to-do list.' : 'Couldn’t add. Try again.'; return; }
        T.items = T.items.concat(rows.map(function (x) { return Object.assign({ created_at: new Date().toISOString() }, x); }));
        back.remove(); toast('Added ' + rows.length + ' to-do' + (rows.length === 1 ? '' : 's') + '.', 'ok');
        renderTodo();
      });
    }
  }

  /* ---------- send a note to Pre-shift (Owner and managers) ----------
   * It shows up in the Notes section of that day's Pre-shift for everyone on the team (supabase/preshift.sql).
   * What's sent is a copy: changing the note afterwards doesn't change what's on Pre-shift. */
  function toPreshift() {
    var title = (N.note.title || '').trim(), body = (N.note.body || '').trim();
    var hasInk = !!(N.note.ink && N.note.ink.length);
    if (!title && !body && !hasInk) { toast('Write something first.', 'err'); return; }
    var now = new Date(), tom = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    var txt = h('textarea', { cls: 'nt-ps-text', rows: '6', 'aria-label': 'What the team will see' }); txt.value = [title, body].filter(Boolean).join('\n\n');
    var dayT = h('input', { type: 'radio', name: 'ntPsDay', value: iso(now) }), dayM = h('input', { type: 'radio', name: 'ntPsDay', value: iso(tom) }), dayO = h('input', { type: 'radio', name: 'ntPsDay', value: 'other' });
    dayT.checked = true;
    var other = h('input', { type: 'date', min: iso(now), 'aria-label': 'Pre-shift date' }); other.addEventListener('input', function () { dayO.checked = true; });
    var withInk = hasInk ? h('input', { type: 'checkbox' }) : null; if (withInk) withInk.checked = !body;
    var msg = h('p', { cls: 'sc-msg', role: 'status' });
    var back = h('div', { cls: 'sc-modal nt-modal', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Send to pre-shift' });
    var sendBtn = h('button', { type: 'button', cls: 'ed-btn', text: 'Send', on: { click: send } });
    back.appendChild(h('div', { cls: 'sc-card' }, [
      h('div', { cls: 'sc-card-h' }, [h('h2', { text: 'Send to pre-shift' }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: function () { back.remove(); } } })]),
      h('div', { cls: 'sc-card-b' }, [
        h('p', { cls: 'nt-ps-hint', text: 'Everyone on the team sees this in the Notes section of Pre-shift that day. You can change the words here first.' }),
        h('div', { cls: 'nt-ps-days', role: 'radiogroup', 'aria-label': 'Which pre-shift' }, [
          h('label', { cls: 'sc-check' }, [dayT, ' Today']), h('label', { cls: 'sc-check' }, [dayM, ' Tomorrow']), h('label', { cls: 'sc-check' }, [dayO, ' Another day ', other])
        ]),
        txt,
        withInk ? h('label', { cls: 'sc-check' }, [withInk, ' Include the handwriting']) : null,
        msg
      ]),
      h('div', { cls: 'sc-card-f' }, [h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: function () { back.remove(); } } }), sendBtn])
    ]));
    N.el.appendChild(back); setTimeout(function () { txt.focus(); }, 30);
    function send() {
      var day = dayO.checked ? other.value : (dayM.checked ? dayM.value : dayT.value);
      if (!day) { msg.textContent = 'Pick the day.'; return; }
      var ink = '';
      if (withInk && withInk.checked) { var cv = inkImage(1, false); if (cv) { ink = cv.toDataURL('image/jpeg', 0.8); if (ink.length > 1400000) ink = inkImage(0.6, false).toDataURL('image/jpeg', 0.7); } }
      var text = txt.value.trim();
      if (!text && !ink) { msg.textContent = 'Write something to send.'; return; }
      sendBtn.disabled = true; msg.textContent = 'Sending…';
      var row = { id: uid(), service_date: day, body: text.slice(0, 4000), ink: ink, note_id: N.note.id };
      saveNote().then(function () { return C.sb.from('preshift_notes').insert(row); }).then(function (r) {
        sendBtn.disabled = false;
        if (r && r.error) { msg.textContent = isMissing(r.error) ? 'Pre-shift notes switch on once supabase/preshift.sql is run in Supabase (SQL Editor → New query → paste → Run).' : isPerm(r.error) ? 'Only the Owner and managers can send notes to pre-shift.' : 'Couldn’t send. Try again.'; return; }
        try { window.dispatchEvent(new CustomEvent('eden:preshift-note', { detail: { day: day } })); } catch (e) {}
        back.remove(); toast(day === iso(now) ? 'Sent to today’s pre-shift.' : 'Sent to pre-shift for ' + dayLabel(day) + '.', 'ok');
      }, function () { sendBtn.disabled = false; msg.textContent = 'Couldn’t send. Try again.'; });
    }
  }

  /* ---------- save a note as a calendar event ----------
   * Opens the calendar's Add event form filled in from the note: the title (or first line) becomes the
   * event name, the note becomes the event notes, and a date or time written in the note (e.g. "Oct 24",
   * "10/24", "7pm", "7:30 pm") is picked up. Only the Owner and Managers can add to the calendar. */
  var MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  function findWhen(text) {
    var t = String(text || ''), out = {}, now = new Date(), y = now.getFullYear(), m, d = null;
    if ((m = /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?(?:,?\s+(\d{4}))?/i.exec(t))) d = new Date(+(m[3] || y), MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()), +m[2]);
    else if ((m = /\b(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?\b/.exec(t))) d = new Date(m[3] ? (+m[3] < 100 ? 2000 + +m[3] : +m[3]) : y, +m[1] - 1, +m[2]);
    else if (/\btomorrow\b/i.test(t)) d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    if (d && !isNaN(d)) { if (!m || !m[3]) { var td = new Date(now.getFullYear(), now.getMonth(), now.getDate()); if (d < td && (td - d) > 60 * 864e5) d.setFullYear(d.getFullYear() + 1); } out.date = iso(d); }
    var tm = /\b(\d{1,2})(?::(\d{2}))?\s*(a\.?m\.?|p\.?m\.?)\b/i.exec(t) || /\b([01]?\d|2[0-3]):([0-5]\d)\b/.exec(t);
    if (tm) { var H = +tm[1], M = +(tm[2] || 0); if (tm[3]) { var pm = /p/i.test(tm[3]); if (H === 12) H = pm ? 12 : 0; else if (pm) H += 12; } if (H < 24) out.start = String(H).padStart(2, '0') + ':' + String(M).padStart(2, '0'); }
    var g = /\b(\d{1,3})\s*(guests|people|ppl|pax|covers)\b/i.exec(t); if (g) out.guests = +g[1];
    return out;
  }
  function toCalendar() {
    var body = (N.note.body || '').trim(), title = (N.note.title || '').trim() || body.split('\n')[0].slice(0, 120);
    if (!title && !(N.note.ink && N.note.ink.length)) { toast('Write something first.', 'err'); return; }
    var w = findWhen(title + '\n' + body);
    saveNote().then(function () {
      window.EdenCal.addEvent({ sb: C.sb, name: C.name, canEdit: true, fromNotes: true, status: function (t, k) { toast(t, k); } }, {
        title: title || 'Note', type: 'other', date: w.date || iso(new Date()), all_day: !w.start, start: w.start || '', end: '', guests: w.guests || null,
        notes: body || '(Handwritten note: open it from Notes.)', source: 'note', note_id: N.note.id
      });
    });
  }

  /* ---------- To-do page ---------- */
  function loadTodos() {
    // staff to give to-dos to (the employee list), and whether assigning is set up (supabase/todo-assign.sql)
    var people = C.sb.from('employees').select('id,name,active').then(function (r) {
      T.people = ((r && r.data) || []).filter(function (e) { return e.active !== false && e.name; }).sort(function (a, b) { return String(a.name).localeCompare(String(b.name)); });
    }, function () {});
    var probe = C.sb.from('todos').select('assigned_to,assigned_user').limit(1).then(function (r) { T.assignOk = !!(r && !r.error); }, function () { T.assignOk = false; });
    // who "me" is: your sign-in, and your employee record if you have one (so your to-dos also show on your staff page)
    var meP = Promise.all([C.sb.auth.getSession(), C.sb.rpc('team_me')]).then(function (x) {
      T.uid = x[0] && x[0].data && x[0].data.session && x[0].data.session.user && x[0].data.session.user.id;
      T.myEmp = (x[1] && x[1].data && x[1].data.employee && x[1].data.employee.id) || null;
    }, function () {});
    var list = C.sb.from('todos').select('*').order('created_at').then(function (r) {
      T.loaded = true;
      if (r.error) { T.missing = isMissing(r.error); T.items = []; if (!T.missing) C.status(isPerm(r.error) ? 'Your role can’t open the to-do list.' : 'Couldn’t load the to-do list.', 'err'); return; }
      T.missing = false; T.items = r.data || [];
    }, function () { T.loaded = true; });
    return Promise.all([people, probe, list, meP]);
  }
  function shortName(n) { var p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : p[0] || ''; }
  function isMine(t) { return !!T.uid && t.assigned_user === T.uid; }
  // the value a to-do shows in the "Assign to" menu
  function whoValue(t) {
    if (isMine(t)) return 'me';
    if (t.assigned_to) return t.assigned_to;
    if (t.assigned_user) return 'keep';
    return '';
  }
  function assignSelect(t, cls) {
    var opts = [h('option', { value: 'me', text: 'Just me' + (C.name ? ' (' + C.name + ')' : '') })];
    if (t && !t.assigned_user && !t.assigned_to) opts.push(h('option', { value: '', text: 'Not assigned' }));
    if (t && t.assigned_user && !isMine(t) && !t.assigned_to) opts.push(h('option', { value: 'keep', text: t.assigned_name || 'Another manager' }));
    T.people.forEach(function (e) { if (e.id !== T.myEmp) opts.push(h('option', { value: e.id, text: e.name })); });
    var sel = h('select', { cls: cls || '', 'aria-label': 'Assign to' }, opts);
    sel.value = t ? whoValue(t) : 'me';
    return sel;
  }
  function setAssignee(t, v) {
    if (v === 'keep') return;
    var before = whoValue(t);
    if (v === 'me') { t.assigned_user = T.uid || null; t.assigned_to = T.myEmp || null; t.assigned_name = C.name || ''; t.assigned_by = ''; return; }
    var e = T.people.filter(function (x) { return x.id === v; })[0];
    if (!v || !e) { t.assigned_to = null; t.assigned_user = null; t.assigned_name = ''; t.assigned_by = ''; return; }
    if (before !== v) t.assigned_by = C.name || '';
    t.assigned_to = v; t.assigned_user = null; t.assigned_name = e.name;
  }
  function saveTodo(t) {
    var row = { id: t.id, title: t.title, details: t.details || '', due: t.due || null, done: !!t.done, done_at: t.done ? (t.done_at || new Date().toISOString()) : null, created_by: t.created_by || '', note_id: t.note_id || null, sort: t.sort || 0 };
    if (T.assignOk) { row.assigned_to = t.assigned_to || null; row.assigned_user = t.assigned_user || null; row.assigned_name = t.assigned_name || ''; row.assigned_by = t.assigned_by || ''; }
    return C.sb.from('todos').upsert(row, { onConflict: 'id' })
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
    var who = T.assignOk ? assignSelect(null, 'td-due td-who') : null;   // starts on "Me" every time
    function addNew() {
      var v = inp.value.trim(); if (!v) { inp.focus(); return; }
      var t = { id: uid(), title: v, details: '', due: due.value || null, done: false, created_by: C.name || '', created_at: new Date().toISOString(), sort: 0 };
      if (who) setAssignee(t, who.value);
      T.items.push(t); saveTodo(t); renderTodo();
      var again = T.el.querySelector('.td-new'); if (again) again.focus();
    }
    inp.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); addNew(); } });
    wrap.appendChild(h('div', { cls: 'td-add' }, [inp, due, who, h('button', { type: 'button', cls: 'ed-btn', text: 'Add', on: { click: addNew } })]));
    if (T.assignOk) {
      var F = [['all', 'Everything'], ['mine', 'Mine'], ['staff', 'Given to others']];
      wrap.appendChild(h('div', { cls: 'td-filter', role: 'group', 'aria-label': 'Show' }, F.map(function (f) {
        return h('button', { type: 'button', 'aria-pressed': T.filter === f[0] ? 'true' : 'false', text: f[1], on: { click: function () { T.filter = f[0]; renderTodo(); } } });
      })));
      if (who) wrap.appendChild(h('p', { cls: 'td-hint', text: 'To-dos are private: only you and the person you give one to can see it. “Just me” to-dos are yours alone. A to-do given to a staff member also shows on their staff page (Schedule tab), where they tick it off; you’ll see it ticked here.' }));
    } else if (C.canAssignHint) wrap.appendChild(h('p', { cls: 'td-hint', text: 'To give to-dos to staff, run supabase/todo-assign.sql in Supabase, then reload.' }));
    var today = iso(new Date());
    var keep = function (t) { return T.filter === 'mine' ? isMine(t) : T.filter === 'open' ? !t.assigned_to && !t.assigned_user : T.filter === 'staff' ? (!!t.assigned_to || !!t.assigned_user) && !isMine(t) : true; };
    var open1 = T.items.filter(function (t) { return !t.done && keep(t); }).sort(function (a, b) {
      var da = a.due || '9999', db = b.due || '9999'; return da < db ? -1 : da > db ? 1 : (a.created_at < b.created_at ? -1 : 1);
    });
    var done = T.items.filter(function (t) { return t.done && keep(t); }).sort(function (a, b) { return (a.done_at || '') < (b.done_at || '') ? 1 : -1; });
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
        h('span', { cls: 'td-meta' }, [isMine(t) ? h('span', { cls: 'td-who-chip mine', text: 'Me' }) : (t.assigned_to || t.assigned_user) ? h('span', { cls: 'td-who-chip', text: '→ ' + (shortName(t.assigned_name) || 'someone') }) : null, [t.due ? (over ? 'Overdue · ' : soon ? 'Today · ' : 'Due ') + dayLabel(t.due) : '', t.created_by ? 'by ' + t.created_by : '', t.note_id ? 'from a note' : '', t.assigned_to && t.done && !isMine(t) ? 'ticked off by ' + shortName(t.assigned_name) : ''].filter(Boolean).join(' · ')])
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
    var whoSel = T.assignOk ? assignSelect(t) : null;
    var back = h('div', { cls: 'sc-modal', role: 'dialog', 'aria-modal': 'true' });
    function close() { back.remove(); }
    var noteBtn = t.note_id ? h('button', { type: 'button', cls: 'ed-btn small', text: 'Open the note', on: { click: function () { close(); openNote(t.note_id); } } }) : null;
    back.appendChild(h('div', { cls: 'sc-card' }, [
      h('div', { cls: 'sc-card-h' }, [h('h2', { text: 'To-do' }), h('button', { type: 'button', cls: 'sc-x', 'aria-label': 'Close', text: '✕', on: { click: close } })]),
      h('div', { cls: 'sc-card-b' }, [h('label', { cls: 'sc-f' }, [h('span', { text: 'To-do' }), title]), h('label', { cls: 'sc-f td-det' }, [h('span', { text: 'Details' }), details]), h('label', { cls: 'sc-f' }, [h('span', { text: 'Due (optional)' }), due]), whoSel ? h('label', { cls: 'sc-f' }, [h('span', { text: 'Assigned to' }), whoSel]) : null]),
      h('div', { cls: 'sc-card-f' }, [noteBtn || h('span'), h('span', { cls: 'sc-sp' }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Cancel', on: { click: close } }),
        h('button', { type: 'button', cls: 'ed-btn', text: 'Save', on: { click: function () { if (!title.value.trim()) { title.focus(); return; } t.title = title.value.trim(); t.details = details.value; t.due = due.value || null; if (whoSel) setAssignee(t, whoSel.value); saveTodo(t); close(); renderTodo(); } } })])
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
    init: function (ctx) {
      C.sb = ctx.sb; C.status = ctx.status || C.status; C.name = ctx.name || ''; if ('canCal' in ctx) C.canCal = !!ctx.canCal;
      C.canShare = !!ctx.canShare; C.canPreshift = !!(ctx.canPreshift == null ? ctx.canShare : ctx.canPreshift); C.isOwner = !!ctx.isOwner; C.canAssignHint = !!ctx.isOwner;
      ctx.sb.auth.getSession().then(function (r) { C.uid = r && r.data && r.data.session && r.data.session.user && r.data.session.user.id; }, function () {});
    },
    openNote: function (id) { openNote(id); },
    open: open, close: close,
    showTodo: function (ctx) { if (ctx) window.EdenNotes.init(ctx); T.el = ctx.el; T.loaded = false; renderTodo(); loadTodos().then(renderTodo); },
    _test: { N: N, T: T, inkImage: inkImage, mailUrl: mailUrl, D: D, spoken: spoken, segmentLines: segmentLines }
  };
})();
