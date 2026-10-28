/* Eden staff site: employee reviews (Team > Reviews), for the Owner and Managers.
 *
 * Every employee is reviewed every 3 months. The schedule list shows when each review is due (overdue and due-soon
 * first); the review itself is an outline the manager fills in: ratings with comments, strengths, areas to grow,
 * how last review's goals went, new goals, training, a summary and an overall rating, plus private notes the
 * employee never sees. "Share with employee" puts it on their team page, where they add their feedback and sign that
 * they've read it, and sets their next review 3 months out.
 * Data: review_plan, reviews, review_plan_fill() (supabase/reviews.sql).
 */
(function () {
  'use strict';
  var EVERY_MONTHS = 3, SOON_DAYS = 14;
  var SCALE = [[1, 'Needs improvement'], [2, 'Developing'], [3, 'Meets expectations'], [4, 'Exceeds expectations']];
  var CATS = [
    ['knowledge', 'Job knowledge & skills', 'Menu, wine and recipes; station skills; using the equipment and systems.'],
    ['quality', 'Quality & standards', 'Plating or service standards, consistency, attention to detail.'],
    ['guest', 'Hospitality & the guest experience', 'Warmth, anticipating needs, handling problems well (in the kitchen: what reaches the guest).'],
    ['team', 'Teamwork & communication', 'Helps others, communicates clearly during service, respectful with the whole team.'],
    ['reliability', 'Reliability', 'On time, attendance, covers shifts, follows the schedule and time-off process.'],
    ['initiative', 'Initiative & ownership', 'Side work, prep, cleanliness; solves problems without being asked.'],
    ['safety', 'Food safety & sanitation', 'Temperatures, labels and dates, ROP rules, handwashing, a clean station.'],
    ['professional', 'Professionalism & attitude', 'Takes feedback well, uniform and appearance, follows Eden’s policies.']
  ];
  var TEXTS = [
    ['strengths', 'Strengths', 'What they do best. Be specific: a moment, a dish, a table.'],
    ['growth', 'Areas to grow', 'The one or two things that would make the biggest difference over the next 3 months.'],
    ['training', 'Training & support we’ll give', 'Shadow shifts, tastings, wine or menu study, certifications (e.g. food handler).'],
    ['summary', 'Summary for the employee', 'A few sentences they’ll read first on their team page.']
  ];
  var R = { ctx: null, el: null, emps: [], plan: {}, reviews: [], loaded: false, missing: false, err: '', cur: null, t: null, dirty: false };

  function h(tag, attrs, kids) {
    var e = document.createElement(tag);
    if (attrs) Object.keys(attrs).forEach(function (k) {
      var v = attrs[k]; if (v == null || v === false) return;
      if (k === 'text') e.textContent = v; else if (k === 'cls') e.className = v;
      else if (k === 'on') Object.keys(v).forEach(function (ev) { e.addEventListener(ev, v[ev]); });
      else if (k === 'value') e.value = v;
      else e.setAttribute(k, v === true ? '' : v);
    });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function sb() { return R.ctx.sb; }
  function status(m, k) { if (R.ctx && R.ctx.status) R.ctx.status(m, k); }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseDay(t) { var p = String(t || '').split('-'); return new Date(+p[0], (+p[1] || 1) - 1, +p[2] || 1); }
  function today() { return iso(new Date()); }
  function addMonths(t, n) { var d = parseDay(t), day = d.getDate(); d.setDate(1); d.setMonth(d.getMonth() + n); var last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate(); d.setDate(Math.min(day, last)); return iso(d); }
  function daysBetween(a, b) { return Math.round((parseDay(b) - parseDay(a)) / 864e5); }
  function nice(t) { return t ? parseDay(t).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: parseDay(t).getFullYear() === new Date().getFullYear() ? undefined : 'numeric' }) : ''; }
  function longDay(t) { return t ? parseDay(t).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''; }
  function dueText(t) {
    if (!t) return 'Not scheduled';
    var n = daysBetween(today(), t);
    return n < 0 ? (-n === 1 ? 'Overdue by 1 day' : 'Overdue by ' + -n + ' days') : n === 0 ? 'Due today' : n === 1 ? 'Due tomorrow' : 'Due in ' + n + ' days';
  }
  function dueCls(t) { if (!t) return ''; var n = daysBetween(today(), t); return n < 0 ? 'late' : n <= SOON_DAYS ? 'soon' : ''; }
  function empById(id) { return R.emps.filter(function (e) { return e.id === id; })[0] || null; }
  function reviewsOf(id) { return R.reviews.filter(function (r) { return r.emp === id; }).sort(function (a, b) { return a.review_date < b.review_date ? 1 : -1; }); }
  function openDraft(id) { return reviewsOf(id).filter(function (r) { return r.status === 'draft'; })[0] || null; }
  function lastDone(id) { return reviewsOf(id).filter(function (r) { return r.status !== 'draft'; })[0] || null; }
  function isMissing(e) { return /review_plan|reviews|does not exist|could not find/i.test(String(e && (e.message || e.details) || '')); }

  /* ---------- data ---------- */
  function load() {
    R.err = '';
    return sb().rpc('review_plan_fill').then(function () {
      return Promise.all([
        sb().from('employees').select('id,name,position,active,created_at').order('name'),
        sb().from('review_plan').select('*'),
        sb().from('reviews').select('*').order('review_date', { ascending: false }),
        sb().from('schedule_weeks').select('week_start,status,published').gte('week_start', iso(new Date(Date.now() - 200 * 864e5))),
        sb().from('shift_punches').select('emp,work_date,clock_in,clock_out,hours').gte('work_date', iso(new Date(Date.now() - 200 * 864e5))).limit(5000)
      ]);
    }).then(function (res) {
      if (res[1].error || res[2].error) { R.missing = isMissing(res[1].error || res[2].error); if (!R.missing) R.err = 'Couldn’t load reviews. ' + ((res[1].error || res[2].error).message || ''); }
      else R.missing = false;
      R.emps = (res[0].data || []);
      R.plan = {}; (res[1].data || []).forEach(function (p) { R.plan[p.emp] = p; });
      R.reviews = res[2].data || [];
      R.weeks = res[3] && !res[3].error ? res[3].data || [] : [];
      R.punches = res[4] && !res[4].error ? res[4].data || [] : null;   // null: not set up yet
      R.loaded = true;
    }, function (e) { R.missing = isMissing(e); R.err = R.missing ? '' : 'Couldn’t load reviews. ' + (e && e.message || ''); R.loaded = true; });
  }
  function savePlan(emp, patch) {
    var row = Object.assign({ emp: emp }, R.plan[emp] || {}, patch, { updated_at: new Date().toISOString() });
    R.plan[emp] = row;
    return sb().from('review_plan').upsert(row, { onConflict: 'emp' }).then(function (r) { if (r.error) status('Couldn’t save the schedule. ' + (r.error.message || ''), 'err'); return r; });
  }

  /* ---------- scheduled vs clocked in (Square) ---------- */
  var ENDS = { cut1: '20:00', cut2: '21:00', close: '22:00' }, GRACE = 5;
  function mins(t) { var p = String(t || '').split(':'); return p.length < 2 || isNaN(+p[0]) ? null : (+p[0]) * 60 + (+p[1] || 0); }
  // { shifts, worked, onTime, late, lateMins, worst, early, missed, extra, schedHrs, clockHrs, days: [...] } for one employee
  function attendance(emp, from, to) {
    if (!R.punches) return null;
    var sched = {};   // date -> [{ start, end }]
    R.weeks.forEach(function (w) {
      if (w.status !== 'published' || !Array.isArray(w.published)) return;
      w.published.forEach(function (sh) {
        if (sh.emp !== emp || !sh.start || sh.day == null) return;
        var d = parseDay(w.week_start); d.setDate(d.getDate() + (+sh.day)); var k = iso(d);
        if (k < from || k > to || k > today()) return;
        (sched[k] = sched[k] || []).push({ start: mins(sh.start), end: mins(ENDS[sh.end] || sh.end) });
      });
    });
    var punch = {};
    R.punches.forEach(function (p) { if (p.emp === emp && p.work_date >= from && p.work_date <= to) (punch[p.work_date] = punch[p.work_date] || []).push(p); });
    var A = { shifts: 0, worked: 0, onTime: 0, late: 0, lateMins: 0, worst: 0, worstDay: '', early: 0, missed: 0, extra: 0, schedHrs: 0, clockHrs: 0, list: [] };
    var dates = Object.keys(sched).concat(Object.keys(punch)).filter(function (k, i, a) { return a.indexOf(k) === i; }).sort();
    dates.forEach(function (k) {
      var ss = (sched[k] || []).sort(function (a, b) { return a.start - b.start; }), ps = (punch[k] || []).slice().sort(function (a, b) { return (mins(a.clock_in) || 0) - (mins(b.clock_in) || 0); });
      ps.forEach(function (p) { A.clockHrs += +p.hours || 0; });
      ss.forEach(function (sh, i) {
        A.shifts++;
        if (sh.end != null && sh.start != null) A.schedHrs += Math.max(0, (sh.end > sh.start ? sh.end : sh.end + 1440) - sh.start) / 60;
        var p = ps[i];
        if (!p) { A.missed++; A.list.push({ d: k, what: 'missed' }); return; }
        A.worked++;
        var tin = mins(p.clock_in); if (tin == null || sh.start == null) { A.onTime++; return; }
        var diff = tin - sh.start;
        if (diff > GRACE) { A.late++; A.lateMins += diff; if (diff > A.worst) { A.worst = diff; A.worstDay = k; } A.list.push({ d: k, what: 'late', m: diff }); }
        else { A.onTime++; if (diff < -15) A.early++; }
      });
      if (ps.length > ss.length) { A.extra += ps.length - ss.length; }
    });
    A.schedHrs = Math.round(A.schedHrs * 10) / 10; A.clockHrs = Math.round(A.clockHrs * 10) / 10;
    A.pct = A.worked ? Math.round(A.onTime / A.worked * 100) : null;
    A.avgLate = A.late ? Math.round(A.lateMins / A.late) : 0;
    A.from = from; A.to = to;
    return A;
  }
  function attendLine(A) {
    if (!A) return '';
    if (!A.shifts && !A.extra) return 'No scheduled shifts or Square clock-ins in this period yet.';
    return [A.pct != null ? A.pct + '% on time (' + A.onTime + ' of ' + A.worked + ' shifts)' : '', A.late ? A.late + ' late, ' + A.avgLate + ' min on average' : '', A.missed ? A.missed + ' scheduled but no clock-in' : '', A.extra ? A.extra + ' unscheduled' : ''].filter(Boolean).join(' · ');
  }

  /* ---------- the schedule ---------- */
  function paint() {
    var el = R.el; el.innerHTML = '';
    el.appendChild(h('div', { cls: 'ed-head' }, [h('h1', { cls: 'an-h1', text: 'Reviews' })]));
    if (!R.loaded) { el.appendChild(h('p', { cls: 'an-sub', text: 'Loading…' })); return; }
    if (R.missing) {
      el.appendChild(h('div', { cls: 'pr-setup' }, [h('h2', { cls: 'an-h2', text: 'One step to switch on Reviews' }), h('ol', null, [
        h('li', { text: 'Open Supabase and choose SQL Editor → New query.' }),
        h('li', { text: 'Paste in supabase/reviews.sql from the eden-admin repository and click Run. It also staggers everyone’s first review across the next 3 months.' }),
        h('li', { text: 'Come back here and reload the page.' })])]));
      return;
    }
    if (R.err) el.appendChild(h('p', { cls: 'pr-err', text: R.err }));
    if (R.cur) return paintReview(el);
    var active = R.emps.filter(function (e) { return e.active !== false; });
    var rows = active.map(function (e) { var p = R.plan[e.id] || {}; return { e: e, p: p, draft: openDraft(e.id), last: lastDone(e.id) }; });
    var due = rows.filter(function (x) { return !x.p.skip && x.p.next_due; }).sort(function (a, b) { return a.p.next_due < b.p.next_due ? -1 : a.p.next_due > b.p.next_due ? 1 : a.e.name.localeCompare(b.e.name); });
    var skipped = rows.filter(function (x) { return x.p.skip || !x.p.next_due; });
    var late = due.filter(function (x) { return dueCls(x.p.next_due) === 'late'; }).length, soon = due.filter(function (x) { return dueCls(x.p.next_due) === 'soon'; }).length;
    el.appendChild(h('p', { cls: 'an-sub', text: 'Everyone is reviewed every ' + EVERY_MONTHS + ' months. Start a review when it’s due, fill in the outline, then share it with the employee: they read it on their team page, add their feedback and sign that they’ve read it. Sharing sets their next review ' + EVERY_MONTHS + ' months out. You get an email a week before a review is due and on the day.' }));
    el.appendChild(h('div', { cls: 'rv-sum' }, [
      h('span', { cls: 'rv-pill late', hidden: !late, text: late + ' overdue' }),
      h('span', { cls: 'rv-pill soon', hidden: !soon, text: soon + ' due in the next ' + SOON_DAYS + ' days' }),
      h('span', { cls: 'rv-pill', text: due.length + ' on the schedule' })]));
    // grouped by month, so the 3-month cycle reads at a glance
    var tb = h('tbody'), month = '';
    due.forEach(function (x) {
      var m = parseDay(x.p.next_due).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
      if (dueCls(x.p.next_due) === 'late') m = 'Overdue';
      if (m !== month) { month = m; tb.appendChild(h('tr', { cls: 'rv-month' }, [h('th', { colspan: '6', scope: 'rowgroup', text: m })])); }
      tb.appendChild(planRow(x));
    });
    el.appendChild(h('div', { cls: 'pr-scroll rv-list' }, [h('table', { cls: 'pr-table' }, [
      h('thead', null, [h('tr', null, ['Employee', 'Next review', 'Last review', 'On time · 90 days', 'Status', ''].map(function (t) { return h('th', { scope: 'col', text: t }); }))]), tb])]));
    if (skipped.length) {
      el.appendChild(h('h2', { cls: 'fn-h rv-h', text: 'Not on the review schedule' }));
      el.appendChild(h('div', { cls: 'rv-skip' }, skipped.map(function (x) {
        return h('div', { cls: 'rv-skiprow' }, [h('span', null, [h('b', { text: x.e.name }), h('small', { text: x.e.position ? ' · ' + x.e.position : '' })]),
          h('button', { type: 'button', cls: 'ed-btn small', text: 'Add to schedule', on: { click: function () { savePlan(x.e.id, { skip: false, next_due: x.p.next_due || iso(new Date(Date.now() + 14 * 864e5)) }).then(paint); } } })]);
      })));
    }
    // past reviews
    var done = R.reviews.filter(function (r) { return r.status !== 'draft' && empById(r.emp); });
    if (done.length) {
      el.appendChild(h('h2', { cls: 'fn-h rv-h', text: 'Past reviews' }));
      el.appendChild(h('div', { cls: 'pr-scroll' }, [h('table', { cls: 'pr-table' }, [
        h('thead', null, [h('tr', null, ['Employee', 'Review date', 'Reviewer', 'Overall', 'Employee', ''].map(function (t) { return h('th', { scope: 'col', text: t }); }))]),
        h('tbody', null, done.slice(0, 60).map(function (r) {
          return h('tr', null, [h('td', { text: (empById(r.emp) || {}).name || '' }), h('td', { text: nice(r.review_date) }), h('td', { text: r.reviewer || '' }),
            h('td', { text: r.overall ? SCALE[r.overall - 1][1] : '–' }), h('td', { text: r.status === 'signed' ? 'Signed ' + nice(String(r.emp_signed_at || '').slice(0, 10)) : 'Not signed yet' }),
            h('td', null, [h('button', { type: 'button', cls: 'ed-btn small', text: 'Open', on: { click: function () { openReview(r); } } })])]);
        }))])]));
    }
  }
  function planRow(x) {
    var e = x.e, p = x.p, last = x.last, draft = x.draft;
    var date = h('input', { type: 'date', value: p.next_due || '', 'aria-label': 'Next review for ' + e.name, cls: 'rv-date' });
    date.addEventListener('change', function () { if (date.value) savePlan(e.id, { next_due: date.value }).then(paint); });
    var st = draft ? 'Draft started ' + nice(draft.review_date) : last && last.status === 'shared' ? 'Last review not signed yet' : '';
    var acts = h('td', { cls: 'rv-acts' }, [
      h('button', { type: 'button', cls: 'ed-btn small' + (dueCls(p.next_due) ? ' pr-accent' : ''), text: draft ? 'Continue review' : 'Start review', on: { click: function () { draft ? openReview(draft) : newReview(e); } } }),
      h('button', { type: 'button', cls: 'ed-btn small rv-ghost', text: 'Not reviewed', title: 'Take ' + e.name + ' off the review schedule (e.g. the Owner)', on: { click: function () { if (confirm('Take ' + e.name + ' off the review schedule?')) savePlan(e.id, { skip: true }).then(paint); } } })]);
    return h('tr', { cls: 'rv-row ' + dueCls(p.next_due) }, [
      h('th', { scope: 'row', cls: 'pr-name' }, [h('b', { text: e.name }), h('small', { text: e.position || '' })]),
      h('td', null, [date, h('small', { cls: 'rv-due ' + dueCls(p.next_due), text: dueText(p.next_due) })]),
      h('td', { text: last ? nice(last.review_date) + (last.overall ? ' · ' + SCALE[last.overall - 1][1] : '') : 'None yet' }),
      onTimeCell(e.id), h('td', { text: st || '–' }), acts]);
  }

  function onTimeCell(id) {
    var A = attendance(id, iso(new Date(Date.now() - 90 * 864e5)), today());
    if (!A) return h('td', { cls: 'rv-ot', text: '–', title: 'Run the newest supabase/reviews.sql, then import a Square shifts file on Payroll' });
    if (!A.worked && !A.missed) return h('td', { cls: 'rv-ot', text: 'No data yet', title: 'Comes from the published schedule and the Square shifts files imported on Payroll' });
    return h('td', { cls: 'rv-ot' + (A.pct != null && A.pct < 85 ? ' low' : ''), title: attendLine(A) }, [h('b', { text: A.pct != null ? A.pct + '%' : '–' }), h('small', { text: [A.late ? A.late + ' late' : '', A.missed ? A.missed + ' missed' : ''].filter(Boolean).join(' · ') || 'none late' })]);
  }

  /* ---------- one review ---------- */
  function newReview(e) {
    var last = lastDone(e.id), p = R.plan[e.id] || {};
    var row = { emp: e.id, due_date: p.next_due || null, review_date: today(), period_from: last ? last.review_date : String(e.created_at || '').slice(0, 10) || null, period_to: today(),
      position: e.position || '', reviewer: R.ctx.name || '', status: 'draft', ratings: {}, answers: {}, goals: [] };
    sb().from('reviews').insert(row).select().single().then(function (r) {
      if (r.error) { status('Couldn’t start the review. ' + (r.error.message || ''), 'err'); return; }
      R.reviews.unshift(r.data); openReview(r.data);
    });
  }
  function openReview(r) { R.cur = JSON.parse(JSON.stringify(r)); R.dirty = false; paint(); window.scrollTo(0, 0); }
  function closeReview() { flush().then(function () { R.cur = null; paint(); }); }
  function touch() { R.dirty = true; clearTimeout(R.t); R.t = setTimeout(flush, 1200); var s = R.el.querySelector('.rv-saved'); if (s) s.textContent = 'Saving…'; }
  function flush() {
    clearTimeout(R.t);
    if (!R.cur || !R.dirty) return Promise.resolve();
    var c = R.cur; R.dirty = false;
    var row = { review_date: c.review_date, period_from: c.period_from || null, period_to: c.period_to || null, position: c.position, reviewer: c.reviewer, ratings: c.ratings, answers: c.answers, goals: c.goals, overall: c.overall || null, private_notes: c.private_notes || '', updated_at: new Date().toISOString() };
    return sb().from('reviews').update(row).eq('id', c.id).then(function (r) {
      var s = R.el.querySelector('.rv-saved');
      if (r.error) { R.dirty = true; if (s) s.textContent = 'Not saved'; status('Couldn’t save the review. ' + (r.error.message || ''), 'err'); return; }
      R.reviews = R.reviews.map(function (x) { return x.id === c.id ? Object.assign({}, x, row) : x; });
      if (s) s.textContent = 'Saved';
    });
  }
  function paintReview(el) {
    var c = R.cur, e = empById(c.emp) || { name: 'Former employee' }, locked = c.status !== 'draft';
    var prev = reviewsOf(c.emp).filter(function (r) { return r.id !== c.id && r.status !== 'draft' && r.review_date <= c.review_date; })[0] || null;
    var set = function (obj, k) { return function (ev) { c[obj][k] = ev.target.value; touch(); }; };
    var top = h('div', { cls: 'rv-top' }, [
      h('button', { type: 'button', cls: 'ed-btn small', text: '← All reviews', on: { click: closeReview } }),
      h('span', { cls: 'rv-saved', text: locked ? '' : 'Saved' }),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Print', on: { click: function () { flush().then(function () { var b = document.body, done = function () { b.classList.remove('rv-printing'); window.removeEventListener('afterprint', done); }; b.classList.add('rv-printing'); window.addEventListener('afterprint', done); setTimeout(function () { window.print(); }, 30); }); } } })]);
    el.appendChild(top);
    var wrap = h('article', { cls: 'rv-form' + (locked ? ' locked' : '') });
    el.appendChild(wrap);
    // header
    var dInput = function (k, label) { var i = h('input', { type: 'date', value: c[k] || '', disabled: locked }); i.addEventListener('change', function () { c[k] = i.value; touch(); }); return h('label', { cls: 'rv-f' }, [h('span', { text: label }), i]); };
    var tInput = function (k, label) { var i = h('input', { type: 'text', value: c[k] || '', disabled: locked }); i.addEventListener('input', function () { c[k] = i.value; touch(); }); return h('label', { cls: 'rv-f' }, [h('span', { text: label }), i]); };
    wrap.appendChild(h('header', { cls: 'rv-head' }, [
      h('p', { cls: 'rv-kicker', text: 'Eden · Employee review' }),
      h('h2', { cls: 'an-h2', text: e.name }),
      h('p', { cls: 'an-sub', text: locked ? (c.status === 'signed' ? 'Shared ' + nice(String(c.shared_at || '').slice(0, 10)) + ' · signed by the employee ' + nice(String(c.emp_signed_at || '').slice(0, 10)) : 'Shared with ' + e.name.split(' ')[0] + ' ' + nice(String(c.shared_at || '').slice(0, 10)) + ' · waiting for their feedback') : 'Draft · only managers can see it until you share it. It saves as you type.' }),
      h('div', { cls: 'rv-grid' }, [tInput('position', 'Position'), tInput('reviewer', 'Reviewed by'), dInput('review_date', 'Review date'), dInput('period_from', 'Period from'), dInput('period_to', 'Period to')])]));
    // 1. ratings
    var sec1 = h('section', { cls: 'rv-sec' }, [h('h3', { text: '1. Ratings' }), h('p', { cls: 'an-sub', text: SCALE.map(function (s) { return s[0] + ' = ' + s[1]; }).join(' · ') + '. Add a line on why, especially for 1s and 4s.' })]);
    CATS.forEach(function (k) {
      var grp = h('div', { cls: 'rv-scale', role: 'radiogroup', 'aria-label': k[1] });
      SCALE.forEach(function (s) {
        var id = 'rv-' + k[0] + '-' + s[0];
        var inp = h('input', { type: 'radio', name: 'rv-' + k[0], id: id, value: String(s[0]), checked: +c.ratings[k[0]] === s[0] ? 'checked' : null, disabled: locked });
        inp.addEventListener('change', function () { c.ratings[k[0]] = s[0]; touch(); paintAvg(); });
        grp.appendChild(h('label', { 'for': id, cls: 'rv-opt', title: s[1] }, [inp, h('span', { text: String(s[0]) })]));
      });
      var cm = h('textarea', { rows: 1, placeholder: 'Comment', disabled: locked, 'aria-label': k[1] + ' comment' }); cm.value = c.answers['c_' + k[0]] || '';
      cm.addEventListener('input', set('answers', 'c_' + k[0]));
      sec1.appendChild(h('div', { cls: 'rv-cat' }, [h('div', { cls: 'rv-catl' }, [h('b', { text: k[1] }), h('small', { text: k[2] })]), grp, cm]));
    });
    var avg = h('p', { cls: 'rv-avg' });
    function paintAvg() { var v = CATS.map(function (k) { return +c.ratings[k[0]] || 0; }).filter(Boolean); avg.textContent = v.length ? 'Average of ' + v.length + ' rating' + (v.length === 1 ? '' : 's') + ': ' + (v.reduce(function (a, b) { return a + b; }, 0) / v.length).toFixed(1) : ''; }
    paintAvg(); sec1.appendChild(avg); wrap.appendChild(sec1);
    wrap.appendChild(attendBox(c, locked));
    // 2. strengths / growth
    var text = function (k, n) { var t = h('textarea', { rows: 3, placeholder: k[2], disabled: locked, 'aria-label': k[1] }); t.value = c.answers[k[0]] || ''; t.addEventListener('input', set('answers', k[0])); return h('section', { cls: 'rv-sec' }, [h('h3', { text: n + '. ' + k[1] }), t]); };
    wrap.appendChild(text(TEXTS[0], 2)); wrap.appendChild(text(TEXTS[1], 3));
    // 4. last review's goals
    var sec4 = h('section', { cls: 'rv-sec' }, [h('h3', { text: '4. Goals from the last review' })]);
    var pg = prev && (prev.goals || []).filter(function (g) { return g && g.goal; });
    if (!pg || !pg.length) sec4.appendChild(h('p', { cls: 'an-sub', text: prev ? 'No goals were set last time.' : 'This is their first review here, so there are no earlier goals.' }));
    else {
      c.answers.prev = c.answers.prev || {};
      pg.forEach(function (g, i) {
        var sel = h('select', { disabled: locked, 'aria-label': 'Result for: ' + g.goal }, [['', 'How did it go?'], ['met', 'Met'], ['partly', 'Partly met'], ['not', 'Not yet']].map(function (o) { return h('option', { value: o[0], text: o[1] }); }));
        sel.value = (c.answers.prev[i] || {}).result || '';
        var note = h('input', { type: 'text', placeholder: 'Note', disabled: locked, value: (c.answers.prev[i] || {}).note || '' });
        var save = function () { c.answers.prev[i] = { goal: g.goal, result: sel.value, note: note.value }; touch(); };
        sel.addEventListener('change', save); note.addEventListener('input', save);
        sec4.appendChild(h('div', { cls: 'rv-pg' }, [h('b', { text: g.goal }), h('small', { text: [g.measure ? 'Measured by: ' + g.measure : '', g.support ? 'Support: ' + g.support : ''].filter(Boolean).join(' · ') }), h('div', { cls: 'rv-pgrow' }, [sel, note])]));
      });
    }
    wrap.appendChild(sec4);
    // 5. new goals
    var sec5 = h('section', { cls: 'rv-sec' }, [h('h3', { text: '5. Goals for the next 3 months' }), h('p', { cls: 'an-sub', text: 'Up to three. Each with how you’ll both know it’s done, and what Eden will do to help.' })]);
    c.goals = c.goals && c.goals.length ? c.goals : [{}, {}, {}];
    while (c.goals.length < 3) c.goals.push({});
    c.goals.slice(0, 3).forEach(function (g, i) {
      var f = function (k, ph) { var t = h('input', { type: 'text', placeholder: ph, disabled: locked, value: g[k] || '', 'aria-label': 'Goal ' + (i + 1) + ' ' + ph }); t.addEventListener('input', function () { g[k] = t.value; touch(); }); return t; };
      sec5.appendChild(h('div', { cls: 'rv-goal' }, [h('span', { cls: 'rv-n', text: String(i + 1) }), f('goal', 'Goal'), f('measure', 'How we’ll measure it'), f('support', 'Support from Eden')]));
    });
    wrap.appendChild(sec5);
    wrap.appendChild(text(TEXTS[2], 6)); wrap.appendChild(text(TEXTS[3], 7));
    // 8. overall
    var ov = h('select', { disabled: locked, 'aria-label': 'Overall rating' }, [h('option', { value: '', text: 'Choose…' })].concat(SCALE.map(function (s) { return h('option', { value: String(s[0]), text: s[0] + ' · ' + s[1] }); })));
    ov.value = c.overall ? String(c.overall) : '';
    ov.addEventListener('change', function () { c.overall = ov.value ? +ov.value : null; touch(); });
    wrap.appendChild(h('section', { cls: 'rv-sec' }, [h('h3', { text: '8. Overall rating' }), ov]));
    // private notes (always editable)
    var pn = h('textarea', { rows: 3, placeholder: 'Only managers and the Owner see this. Not shown to the employee and not printed.', 'aria-label': 'Private notes' }); pn.value = c.private_notes || '';
    pn.addEventListener('input', function () { c.private_notes = pn.value; touch(); });
    wrap.appendChild(h('section', { cls: 'rv-sec rv-private' }, [h('h3', { text: 'Private manager notes' }), pn]));
    // the employee's side
    if (locked) {
      wrap.appendChild(h('section', { cls: 'rv-sec rv-emp' }, [h('h3', { text: 'Employee feedback' }),
        c.emp_comment || c.emp_support || c.emp_goals ? null : h('p', { cls: 'an-sub', text: 'Nothing yet. They see this review on their team page under “Your reviews”.' }),
        c.emp_comment ? h('div', null, [h('b', { text: 'Their thoughts on the review' }), h('p', { text: c.emp_comment })]) : null,
        c.emp_support ? h('div', null, [h('b', { text: 'Support they’d like' }), h('p', { text: c.emp_support })]) : null,
        c.emp_goals ? h('div', null, [h('b', { text: 'Their own goals' }), h('p', { text: c.emp_goals })]) : null,
        h('p', { cls: 'rv-sign', text: c.status === 'signed' ? 'Signed as read by ' + e.name + ' on ' + longDay(String(c.emp_signed_at || '').slice(0, 10)) + '. Signing means they’ve read it, not that they agree with every point.' : 'Not signed yet.' })]));
    }
    // signatures for the printed copy
    wrap.appendChild(h('div', { cls: 'rv-printsig' }, [h('p', { text: 'Manager: ______________________   Date: ________' }), h('p', { text: 'Employee: ______________________   Date: ________' })]));
    // actions
    var acts = h('div', { cls: 'rv-actions' });
    if (!locked) {
      acts.appendChild(h('button', { type: 'button', cls: 'ed-btn small pr-accent', text: 'Share with ' + e.name.split(' ')[0], on: { click: share } }));
      acts.appendChild(h('button', { type: 'button', cls: 'ed-btn small', text: 'Delete draft', on: { click: function () {
        if (!confirm('Delete this draft review?')) return;
        sb().from('reviews').delete().eq('id', c.id).then(function (r) { if (r.error) { status('Couldn’t delete. ' + (r.error.message || ''), 'err'); return; } R.reviews = R.reviews.filter(function (x) { return x.id !== c.id; }); R.cur = null; R.dirty = false; paint(); });
      } } }));
      acts.appendChild(h('p', { cls: 'an-sub', text: 'Go over it with ' + e.name.split(' ')[0] + ' in person, then share it. Once shared it can’t be changed (private notes still can), and their next review is set for ' + nice(addMonths(c.review_date || today(), EVERY_MONTHS)) + '.' }));
    } else if (c.status === 'shared') {
      acts.appendChild(h('button', { type: 'button', cls: 'ed-btn small', text: 'Take back to draft', title: 'Hide it from the employee so you can change it', on: { click: function () {
        if (!confirm('Take this review back to a draft? ' + e.name + ' won’t see it until you share it again.')) return;
        sb().from('reviews').update({ status: 'draft', shared_at: null }).eq('id', c.id).then(function (r) { if (r.error) { status('Couldn’t change it. ' + (r.error.message || ''), 'err'); return; } c.status = 'draft'; c.shared_at = null; R.reviews = R.reviews.map(function (x) { return x.id === c.id ? Object.assign({}, x, { status: 'draft', shared_at: null }) : x; }); paint(); });
      } } }));
    }
    el.appendChild(acts);
  }
  // Scheduled vs clocked in, for the review period: live while a draft, frozen into the review when it's shared
  function attendBox(c, locked) {
    var A = locked && c.answers.attend ? c.answers.attend : attendance(c.emp, c.period_from || iso(new Date(Date.now() - 91 * 864e5)), c.period_to || c.review_date || today());
    var box = h('section', { cls: 'rv-sec rv-att' }, [h('h3', { text: 'Attendance & punctuality' }),
      h('p', { cls: 'an-sub', text: 'The published schedule compared with Square clock-ins' + (A && A.from ? ', ' + nice(A.from) + ' – ' + nice(A.to) : '') + '. On time = clocked in no more than ' + GRACE + ' minutes after the scheduled start. Use it for the Reliability rating.' })]);
    if (!A) { box.appendChild(h('p', { cls: 'an-sub', text: 'Not set up yet: run the newest supabase/reviews.sql, then import the Square shifts file on Payroll each week.' })); return box; }
    if (!A.shifts && !A.extra) { box.appendChild(h('p', { cls: 'an-sub', text: 'No scheduled shifts or Square clock-ins in this period yet. Clock-ins are saved each time the Square shifts file is imported on Payroll, from now on.' })); return box; }
    var stat = function (v, l, cls) { return h('div', { cls: 'rv-stat' + (cls ? ' ' + cls : '') }, [h('b', { text: v }), h('small', { text: l })]); };
    box.appendChild(h('div', { cls: 'rv-stats' }, [
      stat(A.pct != null ? A.pct + '%' : '–', 'on time', A.pct != null && A.pct < 85 ? 'low' : ''),
      stat(A.worked + ' / ' + A.shifts, 'scheduled shifts worked'),
      stat(String(A.late), A.late ? 'late · ' + A.avgLate + ' min avg' : 'late', A.late ? 'low' : ''),
      stat(String(A.missed), 'scheduled, no clock-in', A.missed ? 'low' : ''),
      stat(String(A.extra), 'unscheduled shifts'),
      stat(A.clockHrs + ' h', 'clocked (' + A.schedHrs + ' h scheduled)')]));
    if (A.worst) box.appendChild(h('p', { cls: 'an-sub', text: 'Latest: ' + A.worst + ' minutes on ' + nice(A.worstDay) + '.' + (A.early ? ' Clocked in more than 15 minutes early ' + A.early + (A.early === 1 ? ' time.' : ' times.') : '') }));
    else if (A.early) box.appendChild(h('p', { cls: 'an-sub', text: 'Clocked in more than 15 minutes early ' + A.early + (A.early === 1 ? ' time.' : ' times.') }));
    return box;
  }
  function share() {
    var c = R.cur, e = empById(c.emp) || { name: 'the employee' };
    var missing = CATS.filter(function (k) { return !c.ratings[k[0]]; }).length;
    if (!c.overall) { status('Choose an overall rating before sharing.', 'err'); return; }
    if (missing && !confirm(missing + ' rating' + (missing === 1 ? ' is' : 's are') + ' blank. Share anyway?')) return;
    var next = addMonths(c.review_date || today(), EVERY_MONTHS);
    var A = attendance(c.emp, c.period_from || iso(new Date(Date.now() - 91 * 864e5)), c.period_to || c.review_date || today());
    if (A) { delete A.list; c.answers.attend = A; }   // frozen with the review, so the employee sees the same numbers
    if (!confirm('Share this review with ' + e.name + '? They’ll see it on their team page, and their next review will be due ' + nice(next) + '.')) return;
    R.dirty = true;
    flush().then(function () {
      var now = new Date().toISOString();
      return sb().from('reviews').update({ status: 'shared', shared_at: now }).eq('id', c.id).then(function (r) {
        if (r.error) { status('Couldn’t share it. ' + (r.error.message || ''), 'err'); return; }
        c.status = 'shared'; c.shared_at = now;
        R.reviews = R.reviews.map(function (x) { return x.id === c.id ? Object.assign({}, x, { status: 'shared', shared_at: now }) : x; });
        return savePlan(c.emp, { next_due: next, skip: false }).then(function () { status('Shared with ' + e.name + '. Next review: ' + nice(next) + '.', 'ok'); paint(); });
      });
    });
  }

  window.EdenReviews = {
    show: function (ctx) {
      R.ctx = ctx; R.el = ctx.el;
      if (!R.loaded) paint();
      load().then(function () {
        if (R.cur) { var fresh = R.reviews.filter(function (x) { return x.id === R.cur.id; })[0]; if (!fresh) R.cur = null; }
        paint();
      });
    },
    // for Today and the menu badge: reviews overdue or due within a week
    due: function (ctx) {
      return Promise.all([ctx.sb.from('review_plan').select('emp,next_due,skip'), ctx.sb.from('employees').select('id,name,active')]).then(function (res) {
        if (res[0].error || res[1].error) return [];
        var act = {}; (res[1].data || []).forEach(function (e) { if (e.active !== false) act[e.id] = e.name; });
        var lim = iso(new Date(Date.now() + 7 * 864e5));
        return (res[0].data || []).filter(function (p) { return act[p.emp] && !p.skip && p.next_due && p.next_due <= lim; })
          .map(function (p) { return { name: act[p.emp], due: p.next_due, late: p.next_due < today() }; })
          .sort(function (a, b) { return a.due < b.due ? -1 : 1; });
      }, function () { return []; });
    }
  };
})();
