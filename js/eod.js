/* Eden staff site: End of day report (the Owner and managers).
 *
 *   #eod           Tonight's report. It saves as a draft while you type (so nothing is lost if the phone locks),
 *                  and Submit stamps who prepared it and when. The database works out average spend per cover.
 *   #eod/past      Past reports: open any report, and reopen a submitted one to change it.
 *   #eod/download  Owner only: an Excel file of the last 1, 3, 6 or 12 months, with a ready-made prompt at the top
 *                  to give Claude for an analysis of how the restaurant is doing.
 * The table and its rules are in supabase/eod-reports.sql.
 */
(function () {
  'use strict';
  var SECTIONS = [["Service summary", [["reservations", "Reservations", "int"], ["actual_covers", "Actual covers", "int"], ["walk_ins", "Walk-ins", "int"], ["cancellations", "Cancellations / no-shows", "int"], ["private_events", "Private events", "text"], ["service_rating", "Overall service rating", "rating"], ["overview", "General overview", "long"]]], ["Sales & financials", [["net_sales", "Net sales", "money"], ["food_sales", "Food sales", "money"], ["beverage_sales", "Beverage sales", "money"], ["total_covers", "Total covers", "int"], ["avg_per_cover", "Average spend per cover", "calc"], ["comps", "Discounts / comps and reasons", "text"], ["voids", "Voids / refunds", "text"], ["payment_discrepancies", "Cash or payment discrepancies", "text"], ["cash_deposit", "Cash deposit owed", "money"]]], ["Guest experience", [["compliments", "Compliments and positive feedback", "text"], ["complaints", "Complaints and service recovery", "text"], ["vips", "VIPs / repeat guests / special occasions", "text"], ["dietary", "Dietary accommodations", "text"], ["guest_followups", "Guest follow-ups required", "text"]]], ["Food & beverage", [["dishes_returned", "Dishes returned or remade", "text"], ["quality_concerns", "Quality or presentation concerns", "text"], ["sold_out", "Sold-out items / menu changes", "text"], ["beverage_notes", "Beverage or wine service notes", "text"], ["coordination_issues", "Kitchen and service coordination issues", "text"]]], ["Staff & team performance", [["attendance", "Attendance / staffing changes", "text"], ["exceptional", "Exceptional performance", "text"], ["training_needs", "Training or coaching needs", "text"], ["conduct_issues", "Communication or conduct issues", "text"], ["staff_followup", "Follow-up required", "text"]]], ["Operations & maintenance", [["equipment_issues", "Equipment / POS issues", "text"], ["maintenance", "Maintenance requests", "text"], ["supplies", "Linen / glassware / service supplies", "text"], ["safety_concerns", "Cleanliness or safety concerns", "text"], ["lost_found", "Lost and found", "text"], ["incidents", "Incidents", "text"]]], ["Inventory & closing", [["stock_shortages", "Stock shortages", "text"], ["waste", "Waste / breakage", "text"], ["inventory_discrepancies", "High-value inventory discrepancies", "text"], ["closing_done", "Closing checklist completed", "bool"], ["closing_outstanding", "Outstanding closing tasks", "text"]]], ["Next-shift handover", [["next_reservations", "Upcoming reservations / VIPs", "text"], ["next_dietary", "Dietary or special requests", "text"], ["next_menu", "Menu / stock updates", "text"], ["next_staffing", "Staffing considerations", "text"], ["next_followups", "Guest follow-ups", "text"], ["next_priorities", "Prep or operational priorities", "text"]]], ["Action items", [["action_items", "Action items", "actions"]]], ["Manager’s final comments", [["went_well", "What went well", "long"], ["needs_improvement", "What needs improvement", "long"], ["final_priorities", "Priorities for next shift", "long"]]]];
  var SHIFTS = [['dinner', 'Dinner'], ['private', 'Private event'], ['both', 'Both']];
  var PRIORITY = ['High', 'Medium', 'Low'];
  var R = { ctx: null, el: null, rep: null, dirty: false, saving: null, timer: null, missing: false, people: [], editing: false, list: null, filter: { month: '', q: '' } };

  /* ---------- helpers ---------- */
  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (Array.isArray(attrs) || typeof attrs === 'string') { kids = attrs; attrs = null; }
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else if (k === 'cls') e.className = v;
      else if (k === 'value') e.value = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null && c !== false) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function say(t, k) { if (R.ctx) R.ctx.status(t, k); }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function ymd(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseDay(s) { var p = String(s || '').split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function dayLabel(s, long) { if (!s) return ''; var d = parseDay(s), o = long ? { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' } : { weekday: 'short', month: 'short', day: 'numeric' }; if (!long && d.getFullYear() !== new Date().getFullYear()) o.year = 'numeric'; return d.toLocaleDateString('en-US', o); }
  function stamp(t) { return t ? new Date(t).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : ''; }
  function money(n) { return n == null || n === '' || isNaN(n) ? '' : Number(n).toLocaleString('en-US', { style: 'currency', currency: 'USD' }); }
  function shiftName(s) { var x = SHIFTS.filter(function (y) { return y[0] === s; })[0]; return x ? x[1] : ''; }
  function fields() { var out = []; SECTIONS.forEach(function (s) { s[1].forEach(function (f) { out.push(f); }); }); return out; }
  function isMissing(err) { return !!err && (/eod_reports|does not exist|schema cache|not find/i.test(err.message || '') || err.code === '42P01' || err.code === 'PGRST205'); }
  function avg(r) { var n = Number(r.net_sales), c = Number(r.total_covers); return r.net_sales != null && r.net_sales !== '' && c > 0 ? Math.round(n / c * 100) / 100 : null; }
  function blank() {
    var r = { id: null, report_date: today(), shift: 'dinner', status: 'draft', action_items: [{}, {}], prepared_by: '' };
    fields().forEach(function (f) { if (!(f[0] in r)) r[f[0]] = f[2] === 'int' || f[2] === 'money' || f[2] === 'rating' || f[2] === 'bool' || f[2] === 'calc' ? null : f[2] === 'actions' ? [{}, {}] : ''; });
    return r;
  }
  var COLS = null;   // the columns written to the database (everything except what it works out itself)
  function cols() { if (!COLS) { COLS = ['report_date', 'shift', 'status', 'prepared_by', 'prepared_by_id', 'edited_after_submit_by']; fields().forEach(function (f) { if (f[2] !== 'calc') COLS.push(f[0]); }); } return COLS; }
  function rowFor(r) { var o = {}; cols().forEach(function (k) { if (k in r) o[k] = r[k]; }); o.action_items = (r.action_items || []).filter(function (a) { return a && (a.task || a.assigned || a.deadline); }); return o; }

  /* ---------- page ---------- */
  function show(ctx) {
    R.ctx = ctx; R.el = ctx.el;
    var sub = String(ctx.sub || '');
    stop();
    if (sub === 'past') return showPast();
    if (sub === 'download') return ctx.role === 'owner' ? showDownload() : showPast();
    if (sub.indexOf('r/') === 0) return openReport(sub.slice(2));
    return openToday();
  }
  function hide() { if (R.dirty) save(); stop(); }
  function stop() { if (R.timer) clearTimeout(R.timer); R.timer = null; }
  function frame(eyebrow, title, lead) {
    R.el.innerHTML = '';
    var wrap = h('div', { cls: 'eo' });
    wrap.appendChild(h('p', { cls: 'home-eyebrow', text: eyebrow }));
    wrap.appendChild(h('h1', { cls: 'eo-title', text: title }));
    if (lead) wrap.appendChild(h('p', { cls: 'eo-lead', text: lead }));
    R.el.appendChild(wrap);
    return wrap;
  }
  function missingNote(wrap) {
    wrap.appendChild(h('div', { cls: 'eo-card eo-setup' }, [h('p', { text: R.ctx.role === 'owner'
      ? 'One step first: in Supabase, open SQL Editor > New query, paste in supabase/eod-reports.sql and click Run. Then reload this page.'
      : 'End of day reports aren’t switched on yet. Ask the Owner.' })]));
  }
  function loadPeople() {
    if (R.people.length) return Promise.resolve();
    return R.ctx.sb.from('employees').select('name,active').then(function (r) {
      R.people = ((r && r.data) || []).filter(function (e) { return e.active !== false && e.name; }).map(function (e) { return String(e.name).trim(); }).sort();
    }, function () {});
  }

  /* ---------- tonight's report ---------- */
  function openToday() {
    say('');
    R.el.innerHTML = ''; R.el.appendChild(h('p', { cls: 'eo-loading', text: 'Opening the report…' }));
    // carry on with today's draft if there is one; otherwise start fresh (it's saved once you type)
    return R.ctx.sb.from('eod_reports').select('*').eq('report_date', today()).order('updated_at', { ascending: false }).then(function (res) {
      if (res.error) { R.missing = isMissing(res.error); var w = frame('Office · End of day report', 'End of day report'); if (R.missing) missingNote(w); else w.appendChild(h('p', { cls: 'eo-err', text: 'Couldn’t load reports. Check your connection and reload.' })); return; }
      var rows = res.data || [];
      var draft = rows.filter(function (r) { return r.status === 'draft'; })[0];
      R.rep = draft ? norm(draft) : blank(); R.editing = true; R.dirty = false;
      R.doneToday = rows.filter(function (r) { return r.status === 'submitted'; });
      return loadPeople().then(paintForm);
    });
  }
  function openReport(id) {
    say('');
    R.el.innerHTML = ''; R.el.appendChild(h('p', { cls: 'eo-loading', text: 'Opening the report…' }));
    return R.ctx.sb.from('eod_reports').select('*').eq('id', id).maybeSingle().then(function (res) {
      if (res.error || !res.data) { var w = frame('Office · Past reports', 'Report not found'); w.appendChild(h('p', { cls: 'eo-lead', text: 'It may have been deleted.' })); w.appendChild(h('a', { cls: 'ed-btn small', href: '#eod/past', text: 'Back to past reports' })); return; }
      R.rep = norm(res.data); R.editing = R.rep.status === 'draft'; R.dirty = false; R.doneToday = [];
      return loadPeople().then(paintForm);
    });
  }
  function norm(r) { var b = blank(); Object.keys(r).forEach(function (k) { if (r[k] !== null && r[k] !== undefined) b[k] = r[k]; else if (k in b) b[k] = null; }); if (!Array.isArray(b.action_items) || !b.action_items.length) b.action_items = [{}, {}]; fields().forEach(function (f) { if ((f[2] === 'text' || f[2] === 'long') && b[f[0]] == null) b[f[0]] = ''; }); return b; }

  function paintForm() {
    var r = R.rep, ro = !R.editing, isNew = !r.id;
    var submitted = r.status === 'submitted';
    var wrap = frame(submitted ? 'Office · Past reports' : 'Office · End of day report', submitted ? dayLabel(r.report_date, true) : 'End of day report');
    // where things stand
    var state = h('p', { cls: 'eo-state', role: 'status' });
    wrap.appendChild(state);
    R.stateEl = state; paintState();
    if (!submitted && R.doneToday && R.doneToday.length) {
      wrap.appendChild(h('p', { cls: 'eo-note' }, ['Already submitted today: ', ...[].concat.apply([], R.doneToday.map(function (d, i) { return [i ? ', ' : '', h('a', { href: '#eod/r/' + d.id, text: shiftName(d.shift) + ' by ' + (d.prepared_by || 'a manager') })]; }))]));
    }
    if (submitted && ro) {
      wrap.appendChild(h('div', { cls: 'eo-actions eo-top' }, [
        h('button', { type: 'button', cls: 'eo-btn eo-go', text: 'Reopen to edit', on: { click: function () { R.editing = true; paintForm(); say('Reopened. Changes save as you type and are noted on the report.', 'ok'); } } }),
        h('a', { cls: 'eo-btn', href: '#eod/past', text: 'All past reports' }),
        h('button', { type: 'button', cls: 'eo-btn', text: 'Print', on: { click: function () { window.print(); } } })]));
    }
    var form = h('form', { cls: 'eo-form' + (ro ? ' eo-ro' : ''), novalidate: true, on: { submit: function (e) { e.preventDefault(); } } });
    // date and shift
    var date = h('input', { type: 'date', cls: 'eo-in', value: r.report_date, disabled: ro, required: true, 'aria-label': 'Date', on: { change: function () { r.report_date = this.value || today(); changed(); } } });
    form.appendChild(h('section', { cls: 'eo-card eo-head' }, [
      h('label', { cls: 'eo-f eo-date' }, [h('span', { cls: 'eo-l', text: 'Date' }), date]),
      h('div', { cls: 'eo-f' }, [h('span', { cls: 'eo-l', text: 'Shift' }), seg(SHIFTS, r.shift, ro, function (v) { r.shift = v; changed(); }, 'Shift')])]));
    // jump between sections (handy on a phone)
    var jump = h('nav', { cls: 'eo-jump', 'aria-label': 'Sections' });
    SECTIONS.forEach(function (s, i) { jump.appendChild(h('a', { href: '#', text: (i + 1) + ' ' + s[0], on: { click: function (e) { e.preventDefault(); var t = form.querySelector('#eo-s' + i); if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' }); } } })); });
    form.appendChild(jump);
    SECTIONS.forEach(function (s, i) {
      var card = h('section', { cls: 'eo-card', id: 'eo-s' + i }, [h('h2', { cls: 'eo-h' }, [h('span', { cls: 'eo-n', text: String(i + 1) }), s[0]])]);
      var grid = h('div', { cls: 'eo-grid' });
      s[1].forEach(function (f) { grid.appendChild(field(f, ro)); });
      card.appendChild(grid);
      form.appendChild(card);
    });
    // prepared by / time submitted
    form.appendChild(h('section', { cls: 'eo-card eo-sign' }, [
      h('div', { cls: 'eo-f' }, [h('span', { cls: 'eo-l', text: 'Prepared by' }), h('p', { cls: 'eo-val', text: r.prepared_by || R.ctx.name || '' })]),
      h('div', { cls: 'eo-f' }, [h('span', { cls: 'eo-l', text: 'Time submitted' }), h('p', { cls: 'eo-val', text: r.submitted_at ? stamp(r.submitted_at) : 'Filled in when you submit' })]),
      r.edited_after_submit_at ? h('p', { cls: 'eo-note eo-wide', text: 'Changed after submitting' + (r.edited_after_submit_by ? ' by ' + r.edited_after_submit_by : '') + ', ' + stamp(r.edited_after_submit_at) + '.' }) : null]));
    if (!ro) {
      var acts = h('div', { cls: 'eo-actions' });
      if (!submitted) acts.appendChild(h('button', { type: 'button', cls: 'eo-btn eo-go', text: 'Submit report', on: { click: submit } }));
      else acts.appendChild(h('button', { type: 'button', cls: 'eo-btn eo-go', text: 'Done editing', on: { click: function () { save().then(function () { R.editing = false; paintForm(); say('Changes saved.', 'ok'); }); } } }));
      if (!submitted && r.id) acts.appendChild(h('button', { type: 'button', cls: 'eo-btn eo-danger', text: 'Delete draft', on: { click: discard } }));
      form.appendChild(acts);
    }
    wrap.appendChild(form);
    if (R.people.length) wrap.appendChild(h('datalist', { id: 'eoPeople' }, R.people.map(function (n) { return h('option', { value: n }); })));
    autoGrow(form);
  }
  function paintState() {
    var r = R.rep, el = R.stateEl; if (!el) return;
    var t = r.status === 'submitted' ? 'Submitted by ' + (r.prepared_by || 'a manager') + ', ' + stamp(r.submitted_at) + ' · ' + shiftName(r.shift)
      : r.id ? 'Draft · saves as you type' + (R.savedAt ? ' · saved ' + new Date(R.savedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }) : '')
      : 'New report · it saves as a draft once you start typing';
    if (R.saving) t = 'Saving…';
    if (R.saveErr) t = R.saveErr;
    el.textContent = t; el.classList.toggle('err', !!R.saveErr);
  }
  function seg(opts, val, ro, fn, label) {
    var g = h('div', { cls: 'eo-seg', role: 'radiogroup', 'aria-label': label });
    opts.forEach(function (o) {
      var b = h('button', { type: 'button', role: 'radio', cls: 'eo-seg-b', 'aria-checked': o[0] === val ? 'true' : 'false', disabled: ro, text: o[1],
        on: { click: function () { g.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-checked', 'false'); }); b.setAttribute('aria-checked', 'true'); fn(o[0]); } } });
      g.appendChild(b);
    });
    return g;
  }
  function field(f, ro) {
    var r = R.rep, k = f[0], label = f[1], type = f[2];
    var id = 'eo-' + k;
    if (type === 'int' || type === 'money') {
      var inp = h('input', { id: id, cls: 'eo-in', type: 'text', inputmode: type === 'int' ? 'numeric' : 'decimal', autocomplete: 'off', disabled: ro, value: r[k] == null ? '' : (type === 'money' ? Number(r[k]).toFixed(2) : String(r[k])) });
      inp.addEventListener('input', function () {
        var s = inp.value.replace(/[$,\s]/g, '');
        var n = s === '' ? null : (type === 'int' ? parseInt(s, 10) : Math.round(parseFloat(s) * 100) / 100);
        inp.classList.toggle('bad', s !== '' && (isNaN(n) || n < 0 || (type === 'int' && !/^\d+$/.test(s))));
        if (inp.classList.contains('bad')) return;
        r[k] = n;
        // total covers follows actual covers until someone types their own
        if (k === 'actual_covers' && !R.coversTouched) { r.total_covers = n; var tc = R.el.querySelector('#eo-total_covers'); if (tc) tc.value = n == null ? '' : String(n); }
        if (k === 'total_covers') R.coversTouched = true;
        paintAvg(); changed();
      });
      if (type === 'money') inp.addEventListener('blur', function () { if (r[k] != null && !inp.classList.contains('bad')) inp.value = Number(r[k]).toFixed(2); });
      return h('label', { cls: 'eo-f eo-num', 'for': id }, [h('span', { cls: 'eo-l', text: label }), type === 'money' ? h('span', { cls: 'eo-money' }, [h('span', { cls: 'eo-cur', text: '$' }), inp]) : inp]);
    }
    if (type === 'calc') {
      return h('div', { cls: 'eo-f eo-num' }, [h('span', { cls: 'eo-l', text: label }), h('p', { cls: 'eo-calc', id: 'eo-avg', text: avg(r) == null ? '—' : money(avg(r)) }), h('span', { cls: 'eo-hint', text: 'Net sales ÷ total covers' })]);
    }
    if (type === 'rating') {
      var box = h('div', { cls: 'eo-stars', role: 'radiogroup', 'aria-label': label + ', out of 5' });
      for (var i = 1; i <= 5; i++) (function (n) {
        box.appendChild(h('button', { type: 'button', role: 'radio', cls: 'eo-star' + (r[k] >= n ? ' on' : ''), 'aria-checked': r[k] === n ? 'true' : 'false', 'aria-label': n + ' out of 5', disabled: ro, text: '★',
          on: { click: function () { r[k] = r[k] === n ? null : n; box.querySelectorAll('.eo-star').forEach(function (b, j) { b.classList.toggle('on', r[k] >= j + 1); b.setAttribute('aria-checked', r[k] === j + 1 ? 'true' : 'false'); }); out.textContent = r[k] ? r[k] + ' / 5' : 'Not rated'; changed(); } } }));
      })(i);
      var out = h('span', { cls: 'eo-hint', text: r[k] ? r[k] + ' / 5' : 'Not rated' });
      return h('div', { cls: 'eo-f eo-num' }, [h('span', { cls: 'eo-l', text: label }), h('div', { cls: 'eo-rate' }, [box, out])]);
    }
    if (type === 'bool') {
      return h('div', { cls: 'eo-f eo-num' }, [h('span', { cls: 'eo-l', text: label }), seg([['yes', 'Yes'], ['no', 'No']], r[k] === true ? 'yes' : r[k] === false ? 'no' : '', ro, function (v) { r[k] = v === 'yes'; changed(); }, label)]);
    }
    if (type === 'actions') return actions(ro);
    var ta = h('textarea', { id: id, cls: 'eo-in eo-ta', rows: type === 'long' ? '3' : '1', disabled: ro, placeholder: ro ? '' : 'Nothing to note', on: { input: function () { r[k] = this.value; grow(this); changed(); } } });
    ta.value = r[k] || '';
    return h('label', { cls: 'eo-f eo-wide', 'for': id }, [h('span', { cls: 'eo-l', text: label }), ta]);
  }
  function paintAvg() { var a = R.el.querySelector('#eo-avg'); if (a) a.textContent = avg(R.rep) == null ? '—' : money(avg(R.rep)); }
  function actions(ro) {
    var r = R.rep, box = h('div', { cls: 'eo-wide eo-tasks' });
    function paint() {
      box.innerHTML = '';
      r.action_items.forEach(function (a, i) {
        var task = h('textarea', { cls: 'eo-in eo-ta', rows: '1', disabled: ro, placeholder: 'What needs doing', 'aria-label': 'Task ' + (i + 1), on: { input: function () { a.task = this.value; grow(this); changed(); } } }); task.value = a.task || '';
        var who = h('input', { cls: 'eo-in', type: 'text', list: 'eoPeople', disabled: ro, value: a.assigned || '', placeholder: 'Name', 'aria-label': 'Assigned to', on: { input: function () { a.assigned = this.value; changed(); } } });
        var due = h('input', { cls: 'eo-in', type: 'date', disabled: ro, value: a.deadline || '', 'aria-label': 'Deadline', on: { change: function () { a.deadline = this.value; changed(); } } });
        box.appendChild(h('div', { cls: 'eo-task' }, [
          h('div', { cls: 'eo-task-top' }, [h('span', { cls: 'eo-task-n', text: String(i + 1) }), h('label', { cls: 'eo-f eo-grow' }, [h('span', { cls: 'eo-l', text: 'Task' }), task]),
            ro || r.action_items.length < 2 ? null : h('button', { type: 'button', cls: 'eo-x', 'aria-label': 'Remove task ' + (i + 1), title: 'Remove', text: '✕', on: { click: function () { r.action_items.splice(i, 1); paint(); changed(); } } })]),
          h('div', { cls: 'eo-task-meta' }, [
            h('label', { cls: 'eo-f' }, [h('span', { cls: 'eo-l', text: 'Assigned to' }), who]),
            h('div', { cls: 'eo-f' }, [h('span', { cls: 'eo-l', text: 'Priority' }), seg(PRIORITY.map(function (p) { return [p, p]; }), a.priority || '', ro, function (v) { a.priority = v; changed(); }, 'Priority')]),
            h('label', { cls: 'eo-f' }, [h('span', { cls: 'eo-l', text: 'Deadline' }), due])])]));
      });
      if (!ro) box.appendChild(h('button', { type: 'button', cls: 'eo-add', text: '+ Add another task', on: { click: function () { r.action_items.push({}); paint(); } } }));
      autoGrow(box);
    }
    paint();
    return box;
  }
  function grow(t) { t.style.height = 'auto'; t.style.height = Math.max(t.scrollHeight + 2, 40) + 'px'; }
  function autoGrow(root) { setTimeout(function () { root.querySelectorAll('textarea.eo-ta').forEach(grow); }, 0); }

  /* ---------- saving ---------- */
  function changed() {
    R.dirty = true; R.saveErr = '';
    if (R.timer) clearTimeout(R.timer);
    R.timer = setTimeout(save, 1200);
    paintState();
  }
  function save() {
    if (R.timer) { clearTimeout(R.timer); R.timer = null; }
    if (!R.dirty) return R.saving || Promise.resolve();
    if (R.saving) return R.saving.then(save);
    var r = R.rep; R.dirty = false;
    if (r.status === 'submitted') r.edited_after_submit_by = R.ctx.name || '';
    var row = rowFor(r);
    var q = r.id ? R.ctx.sb.from('eod_reports').update(row).eq('id', r.id).select('id,avg_per_cover,updated_at,edited_after_submit_at').maybeSingle()
      : R.ctx.sb.from('eod_reports').insert(Object.assign({ prepared_by_id: R.ctx.uid }, row)).select('id,avg_per_cover,updated_at').maybeSingle();
    R.saving = q.then(function (res) {
      R.saving = null;
      if (res.error || !res.data) { R.dirty = true; R.saveErr = isMissing(res.error) ? 'Not saved: run supabase/eod-reports.sql in Supabase first.' : 'Not saved yet. Check your connection; it will try again.'; paintState(); if (!isMissing(res.error)) R.timer = setTimeout(save, 8000); return; }
      r.id = res.data.id; R.savedAt = Date.now();
      if (res.data.edited_after_submit_at) r.edited_after_submit_at = res.data.edited_after_submit_at;
      paintState();
    }, function () { R.saving = null; R.dirty = true; R.saveErr = 'Not saved yet. Check your connection; it will try again.'; paintState(); R.timer = setTimeout(save, 8000); });
    paintState();
    return R.saving;
  }
  function submit() {
    var r = R.rep;
    if (!r.report_date || !r.shift) { say('Choose the date and the shift.', 'err'); return; }
    var gaps = [];
    if (r.net_sales == null) gaps.push('net sales'); if (r.total_covers == null && r.actual_covers == null) gaps.push('covers');
    if (gaps.length && !confirm('Submit without ' + gaps.join(' or ') + '?')) return;
    r.status = 'submitted'; r.prepared_by = R.ctx.name || r.prepared_by || ''; r.prepared_by_id = R.ctx.uid; R.dirty = true;
    save().then(function () {
      if (R.dirty || !r.id) { r.status = 'draft'; say('The report couldn’t be submitted. Check your connection and try again.', 'err'); paintState(); return; }
      return R.ctx.sb.from('eod_reports').select('submitted_at').eq('id', r.id).maybeSingle().then(function (x) {
        r.submitted_at = (x && x.data && x.data.submitted_at) || new Date().toISOString();
        R.editing = false;
        var w = frame('Office · End of day report', 'Report submitted');
        w.appendChild(h('div', { cls: 'eo-card eo-done' }, [
          h('p', { cls: 'eo-done-t', text: dayLabel(r.report_date, true) + ' · ' + shiftName(r.shift) }),
          h('p', { text: 'Prepared by ' + r.prepared_by + ', submitted ' + stamp(r.submitted_at) + '.' }),
          avg(r) != null ? h('p', { cls: 'eo-note', text: money(r.net_sales) + ' net sales · ' + r.total_covers + ' covers · ' + money(avg(r)) + ' per cover' }) : null,
          h('div', { cls: 'eo-actions' }, [h('a', { cls: 'eo-btn eo-go', href: '#eod/r/' + r.id, text: 'View report' }), h('a', { cls: 'eo-btn', href: '#eod/past', text: 'Past reports' }),
            h('button', { type: 'button', cls: 'eo-btn', text: 'Start another report', on: { click: function () { R.rep = blank(); R.editing = true; R.coversTouched = false; R.doneToday = [r]; paintForm(); } } })])]));
        say('Report submitted.', 'ok');
        R.list = null;
      });
    });
  }
  function discard() {
    var r = R.rep; if (!r.id) return;
    if (!confirm('Delete this draft? This can’t be undone.')) return;
    stop(); R.dirty = false;
    R.ctx.sb.from('eod_reports').delete().eq('id', r.id).then(function (res) {
      if (res.error) { say('Couldn’t delete the draft.', 'err'); return; }
      say('Draft deleted.', 'ok'); R.rep = blank(); R.coversTouched = false; R.list = null; paintForm();
    });
  }

  /* ---------- past reports ---------- */
  var LIST_COLS = 'id,report_date,shift,status,prepared_by,net_sales,total_covers,avg_per_cover,service_rating,submitted_at,edited_after_submit_at,updated_at,overview,went_well,needs_improvement,complaints,compliments,incidents';
  function showPast() {
    say('');
    var wrap = frame('Office · Past reports', 'Past reports', 'Open any report to read it. Reopen a submitted report to correct it; the change is noted on the report.');
    var body = h('div', { cls: 'eo-past' }); wrap.appendChild(body);
    body.appendChild(h('p', { cls: 'eo-loading', text: 'Loading…' }));
    R.ctx.sb.from('eod_reports').select(LIST_COLS).order('report_date', { ascending: false }).order('updated_at', { ascending: false }).limit(1000).then(function (res) {
      body.innerHTML = '';
      if (res.error) { if (isMissing(res.error)) missingNote(body); else body.appendChild(h('p', { cls: 'eo-err', text: 'Couldn’t load reports. Check your connection and reload.' })); return; }
      R.list = res.data || [];
      paintPast(body);
    });
  }
  function paintPast(body) {
    body.innerHTML = '';
    var all = R.list || [];
    var months = []; all.forEach(function (r) { var m = String(r.report_date).slice(0, 7); if (months.indexOf(m) === -1) months.push(m); });
    var mSel = h('select', { cls: 'eo-in', 'aria-label': 'Month' }, [h('option', { value: '', text: 'All months' })].concat(months.map(function (m) { return h('option', { value: m, text: parseDay(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), selected: R.filter.month === m }); })));
    var q = h('input', { cls: 'eo-in', type: 'search', placeholder: 'Search the notes', value: R.filter.q, 'aria-label': 'Search the notes' });
    mSel.addEventListener('change', function () { R.filter.month = mSel.value; paintRows(); });
    q.addEventListener('input', function () { R.filter.q = q.value; paintRows(); });
    body.appendChild(h('div', { cls: 'eo-filters' }, [mSel, q, h('a', { cls: 'eo-btn eo-go', href: '#eod', text: 'New report' })]));
    var list = h('div', { cls: 'eo-list', role: 'list' }); body.appendChild(list);
    function paintRows() {
      list.innerHTML = '';
      var needle = R.filter.q.trim().toLowerCase();
      var rows = all.filter(function (r) { return (!R.filter.month || String(r.report_date).indexOf(R.filter.month) === 0) && (!needle || JSON.stringify(r).toLowerCase().indexOf(needle) !== -1); });
      if (!rows.length) { list.appendChild(h('p', { cls: 'eo-empty', text: all.length ? 'No reports match.' : 'No reports yet. The first one you submit will be here.' })); return; }
      rows.forEach(function (r) {
        var a = r.avg_per_cover != null ? r.avg_per_cover : avg(r);
        list.appendChild(h('a', { cls: 'eo-row', role: 'listitem', href: '#eod/r/' + r.id }, [
          h('span', { cls: 'eo-row-d' }, [h('b', { text: dayLabel(r.report_date) }), h('small', { text: shiftName(r.shift) })]),
          h('span', { cls: 'eo-row-m' }, [h('span', { text: r.net_sales != null ? money(r.net_sales) : '—' }), h('small', { text: (r.total_covers != null ? r.total_covers + ' covers' : '') + (a != null ? ' · ' + money(a) + ' each' : '') })]),
          h('span', { cls: 'eo-row-r', 'aria-label': r.service_rating ? 'Rated ' + r.service_rating + ' out of 5' : 'Not rated', text: r.service_rating ? '★★★★★'.slice(0, r.service_rating) + '☆☆☆☆☆'.slice(0, 5 - r.service_rating) : '' }),
          h('span', { cls: 'eo-row-w' }, [h('span', { text: r.prepared_by || '' }), h('small', { cls: 'eo-chip ' + (r.status === 'draft' ? 'draft' : r.edited_after_submit_at ? 'edited' : 'ok'), text: r.status === 'draft' ? 'Draft' : r.edited_after_submit_at ? 'Edited' : 'Submitted' })])]));
      });
    }
    paintRows();
  }

  /* ---------- download (Owner) ---------- */
  var RANGES = [[1, 'Last month'], [3, 'Last 3 months'], [6, 'Last 6 months'], [12, 'Last year']];
  function rangeFrom(months) { var d = new Date(); var f = new Date(d.getFullYear(), d.getMonth() - months, d.getDate()); return ymd(f); }
  function showDownload() {
    say('');
    var wrap = frame('Office · Download reports', 'Download reports', 'An Excel file of the end of day reports, counting back from today. The first tab has a prompt you can give Claude, with the file, for an analysis of how Eden is doing.');
    var grid = h('div', { cls: 'eo-dl' }); wrap.appendChild(grid);
    var promptBox = h('div', { cls: 'eo-card eo-prompt' }); wrap.appendChild(promptBox);
    R.ctx.sb.from('eod_reports').select('report_date,status').gte('report_date', rangeFrom(12)).then(function (res) {
      if (res.error) { if (isMissing(res.error)) missingNote(grid); else grid.appendChild(h('p', { cls: 'eo-err', text: 'Couldn’t load reports.' })); return; }
      var rows = res.data || [];
      RANGES.forEach(function (rg) {
        var from = rangeFrom(rg[0]), n = rows.filter(function (r) { return r.report_date >= from && r.report_date <= today(); }).length;
        var b = h('button', { type: 'button', cls: 'eo-dlb', disabled: !n, on: { click: function () { download(rg[0], b); } } }, [
          h('b', { text: rg[1] }), h('span', { text: dayLabel(from) + ' – ' + dayLabel(today()) }), h('small', { text: n ? n + ' report' + (n === 1 ? '' : 's') + ' · Excel' : 'No reports yet' })]);
        grid.appendChild(b);
      });
      var txt = promptText(rangeFrom(3), today(), null);
      promptBox.appendChild(h('div', { cls: 'eo-prompt-h' }, [h('h2', { cls: 'eo-h', text: 'The prompt for Claude' }), h('button', { type: 'button', cls: 'eo-btn', text: 'Copy prompt', on: { click: function () {
        var t = promptText(rangeFrom(R.lastRange || 3), today(), null);
        (navigator.clipboard ? navigator.clipboard.writeText(t) : Promise.reject()).then(function () { say('Prompt copied.', 'ok'); }, function () { window.prompt('Copy this prompt:', t); });
      } } })]));
      promptBox.appendChild(h('p', { cls: 'eo-note', text: 'It’s also at the top of every download (with the dates and number of reports filled in). Open claude.ai, attach the Excel file, paste the prompt and send.' }));
      promptBox.appendChild(h('pre', { cls: 'eo-pre', text: txt }));
    });
  }
  function promptText(from, to, n) {
    return [
      'Please analyze how my restaurant is doing, using the attached Excel file of our end of day reports.',
      '',
      'About us: I’m the chef and owner of Eden, a wood-fire, farm-to-table restaurant at 118 E. Genesee St. in Syracuse, New York. Our managers fill in an end of day report after each dinner service and private event. This file covers ' + dayLabel(from, true) + ' to ' + dayLabel(to, true) + (n != null ? ' (' + n + ' reports)' : '') + '.',
      '',
      'The file: "Reports" has one row per report (date, day of week, shift, covers, sales, service rating and the managers’ notes). "Action items" lists the tasks managers assigned. "Monthly summary" totals each month. Money is in US dollars; average spend per cover is net sales divided by total covers. Some notes are blank and some days may have no report; drafts are marked in the Status column.',
      '',
      'Please give me:',
      '1. A short headline: how the business is trending, and the three things that matter most right now.',
      '2. Sales and covers: trends over time, by day of the week and by shift (dinner vs private event); net sales, the food and beverage mix, and average spend per cover; our best and worst nights and what explains them.',
      '3. Guest experience: recurring themes in compliments and complaints, how well we recover, VIPs and special occasions, dietary requests; what moves the service rating.',
      '4. Kitchen and bar: dishes returned or remade, quality concerns, sold-out items and kitchen–service coordination problems. Name anything that keeps coming back.',
      '5. Team: staffing gaps, standout performers, training needs and conduct issues. Look for patterns, not one-offs.',
      '6. Operations and money control: equipment and POS problems, maintenance, waste and breakage, comps, voids, payment discrepancies and cash deposits. Flag anything unusual or growing.',
      '7. Follow-through: action items that repeat or never seem to get done.',
      '8. Recommendations: 5 to 8 specific, practical actions for the next month, ranked by likely impact, each tied to evidence in the reports.',
      '',
      'Use charts where they help (weekly net sales and covers, average spend per cover, service rating). Tell me where the data is too thin to draw a conclusion, and what we should start tracking to answer better next time.'
    ].join('\n');
  }
  function loadXlsx() {
    if (window.XLSX) return Promise.resolve(window.XLSX);
    return new Promise(function (ok, no) {
      var s = document.createElement('script'); s.src = 'https://cdn.jsdelivr.net/npm/xlsx@0.18.5/dist/xlsx.full.min.js';
      s.onload = function () { window.XLSX ? ok(window.XLSX) : no(new Error('xlsx')); }; s.onerror = function () { no(new Error('xlsx')); };
      document.head.appendChild(s);
    });
  }
  function download(months, btn) {
    R.lastRange = months;
    var from = rangeFrom(months), to = today();
    btn.disabled = true; say('Making the Excel file…');
    Promise.all([loadXlsx(), R.ctx.sb.from('eod_reports').select('*').gte('report_date', from).lte('report_date', to).order('report_date', { ascending: true })]).then(function (x) {
      var XLSX = x[0], res = x[1];
      if (res.error) throw res.error;
      var rows = (res.data || []).slice().sort(function (a, b) { return a.report_date < b.report_date ? -1 : a.report_date > b.report_date ? 1 : String(a.shift).localeCompare(String(b.shift)); });
      var wb = XLSX.utils.book_new();
      // 1. Start here: the prompt for Claude
      var p = promptText(from, to, rows.length).split('\n');
      var start = [['EDEN · END OF DAY REPORTS'], [dayLabel(from, true) + ' to ' + dayLabel(to, true) + ' · ' + rows.length + ' reports · downloaded ' + stamp(new Date().toISOString())], [''],
        ['PROMPT FOR CLAUDE: copy everything below (rows 5 to ' + (4 + p.length) + '), then attach this file in claude.ai and paste it.']].concat(p.map(function (l) { return [l]; }));
      var ws0 = XLSX.utils.aoa_to_sheet(start); ws0['!cols'] = [{ wch: 130 }];
      XLSX.utils.book_append_sheet(wb, ws0, 'Start here');
      // 2. Reports: one row per report
      var head = ['Date', 'Day', 'Shift', 'Status'], keys = [];
      fields().forEach(function (f) { if (f[2] !== 'actions') { head.push(f[1] + (f[2] === 'money' || f[2] === 'calc' ? ' ($)' : f[2] === 'rating' ? ' (1-5)' : '')); keys.push(f); } });
      head.push('Action items', 'Prepared by', 'Time submitted', 'Changed after submitting');
      var data = [head];
      rows.forEach(function (r) {
        var line = [parseDay(r.report_date), parseDay(r.report_date).toLocaleDateString('en-US', { weekday: 'long' }), shiftName(r.shift), r.status === 'draft' ? 'Draft' : 'Submitted'];
        keys.forEach(function (f) { var v = r[f[0]]; if (f[2] === 'bool') v = v === true ? 'Yes' : v === false ? 'No' : ''; else if (f[2] === 'calc') v = r.avg_per_cover != null ? Number(r.avg_per_cover) : avg(r); else if (f[2] === 'money') v = v == null ? null : Number(v); line.push(v == null ? '' : v); });
        line.push((r.action_items || []).map(function (a, i) { return (i + 1) + '. ' + (a.task || '') + (a.assigned ? ' (' + a.assigned + ')' : '') + (a.priority ? ' [' + a.priority + ']' : '') + (a.deadline ? ' by ' + a.deadline : ''); }).join('\n'));
        line.push(r.prepared_by || '', r.submitted_at ? new Date(r.submitted_at) : '', r.edited_after_submit_at ? new Date(r.edited_after_submit_at) : '');
        data.push(line);
      });
      var ws1 = XLSX.utils.aoa_to_sheet(data, { cellDates: true });
      formatCols(XLSX, ws1, head, rows.length);
      ws1['!autofilter'] = { ref: XLSX.utils.encode_range({ s: { r: 0, c: 0 }, e: { r: rows.length, c: head.length - 1 } }) };
      XLSX.utils.book_append_sheet(wb, ws1, 'Reports');
      // 3. Action items
      var ai = [['Report date', 'Shift', 'Task', 'Assigned to', 'Priority', 'Deadline', 'Prepared by']];
      rows.forEach(function (r) { (r.action_items || []).forEach(function (a) { if (a && a.task) ai.push([parseDay(r.report_date), shiftName(r.shift), a.task, a.assigned || '', a.priority || '', a.deadline ? parseDay(a.deadline) : '', r.prepared_by || '']); }); });
      var ws2 = XLSX.utils.aoa_to_sheet(ai, { cellDates: true }); ws2['!cols'] = [{ wch: 13 }, { wch: 14 }, { wch: 60 }, { wch: 20 }, { wch: 10 }, { wch: 13 }, { wch: 18 }];
      dateFmt(XLSX, ws2, [0, 5], ai.length - 1);
      XLSX.utils.book_append_sheet(wb, ws2, 'Action items');
      // 4. Monthly summary (submitted reports)
      var by = {};
      rows.filter(function (r) { return r.status === 'submitted'; }).forEach(function (r) {
        var m = String(r.report_date).slice(0, 7), s = by[m] || (by[m] = { n: 0, cov: 0, net: 0, food: 0, bev: 0, rate: 0, rn: 0, cash: 0, netCov: 0, covN: 0 });
        s.n++; s.cov += Number(r.total_covers) || 0; s.net += Number(r.net_sales) || 0; s.food += Number(r.food_sales) || 0; s.bev += Number(r.beverage_sales) || 0; s.cash += Number(r.cash_deposit) || 0;
        if (r.service_rating) { s.rate += r.service_rating; s.rn++; }
        if (r.net_sales != null && Number(r.total_covers) > 0) { s.netCov += Number(r.net_sales); s.covN += Number(r.total_covers); }
      });
      var sm = [['Month', 'Reports submitted', 'Total covers', 'Net sales ($)', 'Food sales ($)', 'Beverage sales ($)', 'Average spend per cover ($)', 'Average service rating (1-5)', 'Cash deposits owed ($)']];
      Object.keys(by).sort().forEach(function (m) { var s = by[m]; sm.push([parseDay(m + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), s.n, s.cov, s.net, s.food, s.bev, s.covN ? Math.round(s.netCov / s.covN * 100) / 100 : '', s.rn ? Math.round(s.rate / s.rn * 10) / 10 : '', s.cash]); });
      var ws3 = XLSX.utils.aoa_to_sheet(sm); ws3['!cols'] = sm[0].map(function (t, i) { return { wch: i ? 18 : 16 }; });
      for (var rr = 1; rr < sm.length; rr++) [3, 4, 5, 6, 8].forEach(function (c) { var cell = ws3[XLSX.utils.encode_cell({ r: rr, c: c })]; if (cell && cell.t === 'n') cell.z = '$#,##0.00'; });
      XLSX.utils.book_append_sheet(wb, ws3, 'Monthly summary');
      XLSX.writeFile(wb, 'Eden end of day reports ' + from + ' to ' + to + '.xlsx');
      say('Downloaded ' + rows.length + ' report' + (rows.length === 1 ? '' : 's') + '.', 'ok');
      btn.disabled = false;
    }).catch(function () { say('Couldn’t make the Excel file. Check your connection and try again.', 'err'); btn.disabled = false; });
  }
  function dateFmt(XLSX, ws, colsIdx, n) { for (var r = 1; r <= n; r++) colsIdx.forEach(function (c) { var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })]; if (cell && cell.t === 'd') cell.z = 'mmm d, yyyy'; }); }
  function formatCols(XLSX, ws, head, n) {
    ws['!cols'] = head.map(function (t) { return { wch: /^(Date|Day|Shift|Status)$/.test(t) ? 12 : /\(\$\)|\(1-5\)|^(Reservations|Actual covers|Walk-ins|Total covers|Cancellations)/.test(t) ? 14 : /Time submitted|Changed after/.test(t) ? 20 : 34 }; });
    for (var r = 1; r <= n; r++) head.forEach(function (t, c) {
      var cell = ws[XLSX.utils.encode_cell({ r: r, c: c })]; if (!cell) return;
      if (cell.t === 'n' && /\(\$\)/.test(t)) cell.z = '$#,##0.00';
      if (cell.t === 'd') cell.z = c === 0 ? 'mmm d, yyyy' : 'mmm d, yyyy h:mm AM/PM';
    });
  }

  window.EdenEOD = { show: show, hide: hide };
})();
