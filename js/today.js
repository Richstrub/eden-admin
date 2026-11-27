/* Eden staff site: Today (the home page).
 *   "Needs you": what's waiting, each with one button that goes straight to it. Each person only sees
 *   what their role can act on: catering, time off and the next schedule for the Owner and managers,
 *   stock below par for the kitchen, payroll for the Owner, due to-dos for everyone.
 *   Beside it: tonight's events and who's working, the week ahead, and recent shared notes.
 *   EdenToday.counts(ctx) works out the same list without drawing it, for the numbers in the side menu.
 * Reads existing tables only (catering_inquiries, time_off, schedule_weeks, employees, inventory_items,
 * inventory_counts, payroll_weeks, events, notes, todos); anything not set up yet is simply skipped. */
(function () {
  'use strict';
  var ENDS = { cut1: '1st cut', cut2: '2nd cut', close: 'close' };
  var T = { seq: 0 };

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
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function addDays(d, n) { var x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); x.setDate(x.getDate() + n); return x; }
  function sunday(d) { return addDays(d, -d.getDay()); }
  function parseDay(t) { var p = String(t).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function t12(t) {
    if (ENDS[t]) return ENDS[t];
    var p = String(t || '').split(':'), H = +p[0], M = +p[1] || 0; if (!String(t || '') || isNaN(H)) return '';
    return (H % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H >= 12 ? 'pm' : 'am');
  }
  function shortName(n) { var p = String(n || '').trim().split(/\s+/); return p.length > 1 ? p[0] + ' ' + p[p.length - 1][0] + '.' : (p[0] || ''); }
  function plural(n, one, many) { return n + ' ' + (n === 1 ? one : (many || one + 's')); }
  function weekRange(d) { var e = addDays(d, 6), o = { month: 'short', day: 'numeric' }; return d.toLocaleDateString('en-US', o) + ' – ' + (d.getMonth() === e.getMonth() ? e.getDate() : e.toLocaleDateString('en-US', o)); }
  // a query that quietly gives nothing when a table isn't set up, or the role can't read it
  function q(p) { return Promise.resolve(p).then(function (r) { return r && !r.error ? (r.data || null) : null; }, function () { return null; }); }

  /* ---------- gather ---------- */
  function gather(ctx) {
    var sb = ctx.sb, now = new Date(), today = iso(now), thisWk = sunday(now), nextWk = addDays(thisWk, 7), lastWk = addDays(thisWk, -7);
    var mgr = ctx.isMgr, P = {};
    P.inq = mgr ? q(sb.from('catering_inquiries').select('id,status,name,event_name')) : null;
    P.off = mgr ? q(sb.from('time_off').select('id,status,emp,start_date')) : null;
    P.next = mgr ? q(sb.from('schedule_weeks').select('week_start,status').eq('week_start', iso(nextWk)).maybeSingle()) : null;
    P.thisWeek = q(sb.from('schedule_weeks').select('week_start,status,published').eq('week_start', iso(thisWk)).maybeSingle());
    P.emps = mgr ? q(sb.from('employees').select('id,name,position,active')) : null;
    P.rplan = mgr ? q(sb.from('review_plan').select('emp,next_due,skip')) : null;
    P.items = ctx.canPrep ? q(sb.from('inventory_items').select('id,category,par,active')) : null;
    P.vint = ctx.canPrep ? q(sb.from('inventory_items').select('id,name,category,replaces').eq('category', 'bev')) : null;
    P.maxItems = ctx.canPrep ? q(sb.from('inventory_items').select('id,category,name,ingredient,unit,max_qty,active').not('max_qty', 'is', null)) : null;
    P.counts = ctx.canPrep ? q(sb.from('inventory_counts').select('category,count_date,counts')) : null;
    P.prices = ctx.canPrep ? q(sb.from('inventory_prices').select('item_id,unit_cost,old_cost').is('seen_at', null).not('old_cost', 'is', null).gte('created_at', iso(addDays(now, -90))).limit(500)) : null;   // supabase/inventory-costing.sql
    P.pay = ctx.isOwner ? q(sb.from('payroll_weeks').select('week_start,status').eq('week_start', iso(lastWk)).maybeSingle()) : null;
    P.payReady = ctx.isOwner ? q(sb.from('pay_rates').select('emp').limit(1)) : null;
    P.events = q(sb.from('events').select('id,title,type,date,start,end,room,guests,all_day').gte('date', today).lte('date', iso(addDays(now, 10))));
    // last week's numbers (the Owner): payroll summaries, scanned invoices and the end of day reports' guest counts
    var since = iso(addDays(thisWk, -7 * 14));
    P.pweeks = ctx.isOwner ? q(sb.from('payroll_weeks').select('week_start,status,summary:rows->_summary').gte('week_start', since).lt('week_start', iso(thisWk)).order('week_start')) : null;
    P.invs = ctx.isOwner ? q(sb.from('inventory_invoices').select('invoice_date,total').gte('invoice_date', since).limit(3000)) : null;
    P.covers = ctx.isOwner ? q(sb.from('eod_reports').select('report_date,actual_covers,total_covers').gte('report_date', since).limit(1000)) : null;
    P.eod = mgr ? q(sb.from('eod_reports').select('*').eq('status', 'submitted').order('report_date', { ascending: false }).order('submitted_at', { ascending: false }).limit(4)) : null;
    P.notes = mgr ? q(sb.from('notes').select('id,title,body,author,edited_by,updated_at,shared').eq('shared', true)) : null;
    P.todos = q(sb.from('todos').select('*'));
    P.me = q(sb.rpc('team_me'));
    P.sess = sb.auth.getSession().then(function (r) { return (r && r.data && r.data.session) || null; }, function () { return null; });
    var keys = Object.keys(P);
    return Promise.all(keys.map(function (k) { return P[k]; })).then(function (vals) {
      var d = {}; keys.forEach(function (k, i) { d[k] = vals[i]; });
      return build(ctx, d, { now: now, today: today, thisWk: thisWk, nextWk: nextWk, lastWk: lastWk });
    });
  }
  function build(ctx, d, w) {
    var items = [], counts = { catering: 0, inventory: 0, schedule: 0, payroll: '', reviews: 0 };
    // catering
    if (d.inq) {
      var nw = d.inq.filter(function (r) { return r.status === 'new'; }), back = d.inq.filter(function (r) { return r.status === 'received'; });
      var names = function (l) { return l.slice(0, 3).map(function (r) { return r.name || r.event_name || 'Guest'; }).join(', ') + (l.length > 3 ? ' and ' + (l.length - 3) + ' more' : ''); };
      if (nw.length) items.push({ area: 'Catering', title: plural(nw.length, 'new inquiry', 'new inquiries'), sub: names(nw) + ' — send the questionnaire link', href: '#catering', cta: 'Open', hot: true });
      if (back.length) items.push({ area: 'Catering', title: plural(back.length, 'questionnaire') + ' came back', sub: names(back) + ' — ready to start the BEO', href: '#catering', cta: 'Start BEO', hot: true });
      counts.catering = nw.length + back.length;
    }
    // time off and next week's schedule
    if (d.off) {
      var pend = d.off.filter(function (r) { return r.status === 'pending'; });
      if (pend.length) { items.push({ area: 'Schedule', title: plural(pend.length, 'time-off request'), sub: 'Approve or decline before the schedule is built', href: '#schedule', cta: 'Review' }); counts.schedule += pend.length; }
    }
    if (ctx.isMgr && w.now.getDay() >= 3 && !(d.next && d.next.status === 'published')) {
      items.push({ area: 'Schedule', title: 'Next week isn’t published', sub: 'Week of ' + weekRange(w.nextWk) + ' — staff see it once it’s published', href: '#schedule', cta: 'Build it' });
      counts.schedule += 1;
    }
    // employee reviews (every 3 months): overdue, or due within a week
    if (d.rplan && d.emps) {
      var en = {}; d.emps.forEach(function (e) { if (e.active !== false) en[e.id] = e.name; });
      var wkOut = iso(addDays(w.now, 7));
      var rdue = d.rplan.filter(function (p) { return en[p.emp] && !p.skip && p.next_due && p.next_due <= wkOut; }).sort(function (a, b) { return a.next_due < b.next_due ? -1 : 1; });
      if (rdue.length) {
        var rlate = rdue.filter(function (p) { return p.next_due < w.today; }).length;
        items.push({ area: 'Reviews', title: plural(rdue.length, 'employee review') + (rlate ? ' (' + rlate + ' overdue)' : ' due this week'), hot: !!rlate,
          sub: rdue.slice(0, 4).map(function (p) { return en[p.emp].split(' ')[0] + ' ' + parseDay(p.next_due).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }).join(' · ') + (rdue.length > 4 ? ' and ' + (rdue.length - 4) + ' more' : ''),
          href: '#reviews', cta: 'Open' });
        counts.reviews = rdue.length;
      }
    }
    // stock below par (latest count of each kind)
    if (d.items && d.counts) {
      var latest = {};
      d.counts.forEach(function (c) { if (!latest[c.category] || c.count_date > latest[c.category].count_date) latest[c.category] = c; });
      var low = 0;
      d.items.forEach(function (it) {
        if (it.active === false || it.par == null || it.par === '') return;
        var c = latest[it.category]; if (!c || !c.counts) return;
        var v = c.counts[it.id]; if (v == null || v === '') return;
        if (+v < +it.par) low++;
      });
      if (low) { items.push({ area: 'Inventory', title: plural(low, 'item') + ' below par', sub: 'From the latest counts — see what to order', href: '#inventory', cta: 'Order list' }); counts.inventory = low; }
    }
    // a wine's old vintage ran out: switch the wine list to the new one
    if (d.vint && d.counts) {
      var byId = {}; d.vint.forEach(function (it) { byId[it.id] = it; });
      var outs = d.vint.filter(function (nw) {
        var old = nw.replaces && byId[nw.replaces]; if (!old) return false;
        var r = d.counts.filter(function (c) { return c.category === 'bev' && c.counts && c.counts[old.id] != null; }).sort(function (a, b) { return a.count_date < b.count_date ? 1 : -1; })[0];
        return r && +r.counts[old.id] <= 0;
      });
      if (outs.length) items.push({ area: 'Wine list', title: outs.length === 1 ? byId[outs[0].replaces].name + ' is out' : plural(outs.length, 'wine') + ' ran out', sub: 'Switch the menu to the new vintage: ' + outs.slice(0, 3).map(function (nw) { return nw.name; }).join(', ') + (outs.length > 3 ? ' and more' : ''), href: '#inventory/beverages', cta: 'Update the menu' });
    }
    // over the maximum at the latest count: use first
    if (d.maxItems && d.maxItems.length && d.counts) {
      var lc = {};
      d.counts.forEach(function (c) { if (c.counts && Object.keys(c.counts).length && (!lc[c.category] || c.count_date > lc[c.category].count_date)) lc[c.category] = c; });
      var uf = d.maxItems.filter(function (it) { var c = lc[it.category], v = c && c.counts[it.id]; return it.active !== false && it.max_qty != null && it.max_qty !== '' && v != null && v !== '' && +v > +it.max_qty; });
      if (uf.length) items.push({ area: 'Inventory', title: plural(uf.length, 'item') + ' to use first', sub: uf.slice(0, 4).map(function (it) { return (it.category === 'food' && it.ingredient) || it.name; }).join(', ') + (uf.length > 4 ? ' and ' + (uf.length - 4) + ' more' : '') + ' — over the maximum', href: '#inventory', cta: 'See list' });
    }
    // prices that changed on an invoice and nobody has looked at yet
    if (ctx.canPrep && d.prices && d.prices.length) {
      var ch = {}; d.prices.forEach(function (p) { if (+p.old_cost && Math.abs(+p.unit_cost - +p.old_cost) / +p.old_cost >= 0.005) ch[p.item_id] = 1; });
      var nch = Object.keys(ch).length;
      if (nch) items.push({ area: 'Inventory', title: plural(nch, 'price') + ' changed on invoices', sub: 'See what went up or down, and the new cost %', href: '#inventory', cta: 'Price changes' });
    }
    // payroll for the week that just ended
    if (ctx.isOwner && d.payReady && d.payReady.length && !(d.pay && d.pay.status === 'final')) {
      items.push({ area: 'Payroll', title: 'Payroll for ' + weekRange(w.lastWk) + (d.pay ? ' is still a draft' : ' isn’t started'), sub: 'Check the hours, then finalize and download for the accountant', href: '#payroll', cta: 'Finish' });
      counts.payroll = d.pay ? 'Draft' : 'To do';
    }
    // every open to-do: overdue first, then by due date, then the ones with no date
    if (d.todos) {
      // to-dos given to someone else are theirs (they show on that person's staff page), not yours
      var myEmp = d.me && d.me.employee && d.me.employee.id, myId = d.sess && d.sess.user && d.sess.user.id;
      var mineOrOpen = function (t) { return t.assigned_user ? t.assigned_user === myId : t.assigned_to ? t.assigned_to === myEmp : true; };
      var open = d.todos.filter(function (t) { return !t.done && String(t.title || '').trim() && mineOrOpen(t); }).sort(function (a, b) {
        var ka = a.due || '9999', kb = b.due || '9999'; return ka < kb ? -1 : ka > kb ? 1 : String(a.title).localeCompare(String(b.title));
      });
      var SHOW = 8;
      open.slice(0, SHOW).forEach(function (t) {
        var late = t.due && t.due < w.today, today = t.due === w.today;
        items.push({ area: 'To-do', title: t.title, todo: t, hot: late || today, late: late,
          sub: late ? 'Overdue · was due ' + parseDay(t.due).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : today ? 'Due today'
            : t.due ? 'Due ' + parseDay(t.due).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
            : 'No due date',
          href: '#todo', cta: 'Open' });
      });
      if (open.length > SHOW) items.push({ area: 'To-do', title: plural(open.length - SHOW, 'more to-do'), sub: 'The rest of your list', href: '#todo', cta: 'See all' });
    }
    counts.total = items.length;
    // tonight and the week ahead
    var ev = (d.events || []).slice().sort(function (a, b) { return (a.date + (a.start || '')) < (b.date + (b.start || '')) ? -1 : 1; });
    var tonight = ev.filter(function (e) { return e.date === w.today; }), week = ev.filter(function (e) { return e.date > w.today; });
    // who's working today (published schedule)
    var crew = [];
    if (d.thisWeek && d.thisWeek.status === 'published' && d.thisWeek.published && d.emps) {
      var byId = {}; d.emps.forEach(function (e) { byId[e.id] = e; });
      crew = d.thisWeek.published.filter(function (s) { return s.day === w.now.getDay() && byId[s.emp] && s.start; })
        .sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); })
        .map(function (s) { var e = byId[s.emp]; return { name: shortName(e.name), position: s.role || e.position || '', start: s.start, end: s.end || '', note: s.note || '' }; });
    }
    var notes = (d.notes || []).slice().sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; }).slice(0, 3);
    // the last night's end of day report(s): the most recent date with a submitted report
    var eod = null;
    if (d.eod) {
      var ld = d.eod.length ? d.eod[0].report_date : null;
      eod = { reports: d.eod.filter(function (x) { return x.report_date === ld; }), date: ld };
      // was there a service night since then with no report? (Eden is open Wednesday to Saturday)
      var miss = null;
      for (var k = 1; k <= 6; k++) { var dd = addDays(w.now, -k); if (ld && iso(dd) <= ld) break; if (dd.getDay() >= 3 && dd.getDay() <= 6) { miss = dd; break; } }
      eod.missing = miss;
    }
    // last week and the weeks before it: net sales, labor %, purchases and guests
    var biz = null;
    if (d.pweeks) {
      var wk = {}, key = function (ds) { return iso(sunday(parseDay(ds))); };
      for (var b = 13; b >= 1; b--) { var k0 = iso(addDays(w.thisWk, -7 * b)); wk[k0] = { week: k0, net: null, pct: null, cost: null, buy: 0, guests: 0, gDays: 0 }; }
      d.pweeks.forEach(function (x) { var o = wk[x.week_start], sm = x.summary; if (o && sm) { o.net = sm.net != null ? +sm.net : null; o.pct = sm.pct != null ? +sm.pct : null; o.cost = sm.cost != null ? +sm.cost : null; o.status = x.status; } });
      (d.invs || []).forEach(function (v) { var o = v.invoice_date && wk[key(v.invoice_date)]; if (o) o.buy += +v.total || 0; });
      (d.covers || []).forEach(function (c) { var o = wk[key(c.report_date)], n = c.total_covers != null ? +c.total_covers : +c.actual_covers; if (o && n) { o.guests += n; o.gDays++; } });
      biz = Object.keys(wk).sort().map(function (k) { return wk[k]; });
    }
    return { items: items, counts: counts, tonight: tonight, week: week, crew: crew, crewKnown: !!(d.thisWeek && d.emps), notes: notes, w: w, eod: eod, biz: biz };
  }

  /* ---------- who's working: the same timeline as the Hub's daily schedule ---------- */
  var END_AT = { cut1: '20:00', cut2: '21:00', close: '22:00' };   // 1st cut ~8pm, 2nd cut ~9pm, close ~10pm
  function tm(t) { var p = String(t || '').split(':'); return (+p[0]) * 60 + (+p[1] || 0); }
  function endM(s) { var e = END_AT[s.end] || s.end || ''; if (!e) return tm(s.start) + 60; var b = tm(e); return b <= tm(s.start) ? b + 1440 : b; }
  function hrClock(m) { m = ((m % 1440) + 1440) % 1440; var H = Math.floor(m / 60), M = m % 60; return (H % 12 || 12) + (M ? ':' + String(M).padStart(2, '0') : '') + (H >= 12 ? 'p' : 'a'); }
  function endText(s) { return s.end === 'cut1' ? '1st cut' : s.end === 'cut2' ? '2nd cut' : s.end === 'close' ? 'close' : s.end ? hrClock(tm(s.end)) : ''; }
  function crewTimeline(list, now) {
    var lo = Infinity, hi = -Infinity;
    list.forEach(function (s) { lo = Math.min(lo, tm(s.start)); hi = Math.max(hi, endM(s)); });
    lo = Math.floor(lo / 60) * 60; hi = Math.ceil(hi / 60) * 60;
    if (hi - lo < 6 * 60) hi = Math.min(lo + 6 * 60, 30 * 60);
    var span = hi - lo, pct = function (m) { return ((m - lo) / span * 100) + '%'; };
    var step = span > 6 * 60 ? 120 : 60;   // the side column is narrow: label every other hour on a long day
    var last = list.reduce(function (x, s) { return endM(s) >= endM(x) ? s : x; }, list[0]);
    var box = h('div', { cls: 'td-tlbox' }, [h('p', { cls: 'td-crew', text: list.length + ' working · first in ' + hrClock(tm(list[0].start)) + ' · last out ' + endText(last) })]);
    var tl = h('div', { cls: 'td-tl' });
    var scale = h('div', { cls: 'td-tl-scale' });
    for (var m = lo; m <= hi; m += step) scale.appendChild(h('span', { cls: 'td-tl-tick', style: 'left:' + pct(m), text: hrClock(m) }));
    tl.appendChild(h('div', { cls: 'td-tl-row td-tl-ruler' }, [h('div', { cls: 'td-tl-who' }), scale]));
    list.forEach(function (s) {
      var a = tm(s.start), b = endM(s), approx = !!END_AT[s.end], hrs = (b - a) / 60;
      tl.appendChild(h('div', { cls: 'td-tl-row' }, [
        h('div', { cls: 'td-tl-who', title: s.name + (s.position ? ' · ' + s.position : '') }, [h('b', { text: s.name }), h('small', { text: [s.position, (approx ? '~' : '') + (Math.round(hrs * 4) / 4) + 'h'].filter(Boolean).join(' · ') })]),
        h('div', { cls: 'td-tl-lane' }, [h('div', { cls: 'td-tl-bar' + (approx ? ' approx' : ''), style: 'left:' + pct(a) + ';width:calc(' + pct(b) + ' - ' + pct(a) + ')', title: hrClock(a) + '–' + endText(s) + (s.note ? ' · ' + s.note : '') },
          [h('span', { text: hrClock(a) + '–' + endText(s) })])])]));
    });
    var grid = h('div', { cls: 'td-tl-grid', 'aria-hidden': 'true' });
    for (var g = lo; g <= hi; g += 60) grid.appendChild(h('i', { style: 'left:' + pct(g) }));
    var nm = now.getHours() * 60 + now.getMinutes(); if (nm < lo && nm + 1440 <= hi) nm += 1440;
    if (nm >= lo && nm <= hi) grid.appendChild(h('b', { cls: 'td-tl-now', style: 'left:' + pct(nm) }));
    tl.appendChild(grid);
    box.appendChild(tl);
    box.appendChild(h('a', { cls: 'td-more td-tl-more', href: '#schedule', text: 'Schedule ›' }));
    return box;
  }

  /* ---------- draw ---------- */
  function go(href) { try { sessionStorage.setItem('eden-from-today', '1'); } catch (e) {} location.hash = href; }
  function eventLine(e, withDay) {
    var bits = [];
    if (withDay) bits.push(parseDay(e.date).toLocaleDateString('en-US', { weekday: 'short' }));
    if (!e.all_day && e.start) bits.push(t12(e.start));
    // tap an event: the Calendar opens on that day with the event's details
    return h('li', null, [h('a', { cls: 'td-evlink', href: '#calendar/e/' + e.date + '/' + encodeURIComponent(e.id || ''), title: 'Open in the calendar' }, [
      h('b', { text: (bits.length ? bits.join(' · ') + ' · ' : '') + e.title }),
      (e.room || e.guests) ? h('span', { text: [e.room, e.guests ? e.guests + ' guests' : ''].filter(Boolean).join(' · ') }) : null])]);
  }
  /* ---------- drawing: the layout from the redesign ---------- */
  var ICONS = {
    Catering: 'M4 6h16v12H4z M4 7l8 6 8-6', Schedule: 'M4 6h16v14H4z M4 10h16 M8 3v5 M16 3v5', Reviews: 'M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.5 6.7 19.4l1.2-6L3.4 9.3l6-.7z',
    Inventory: 'M3 4h2l2.4 11h10.2L20 7H6.2 M9 20h.01 M17 20h.01', 'Wine list': 'M8 3h8l-1 7a3 3 0 0 1-6 0z M12 13v7 M8 20h8', Payroll: 'M12 3v18 M16 7H10a3 3 0 0 0 0 6h4a3 3 0 0 1 0 6H8',
    'To-do': 'M9 6h11 M9 12h11 M9 18h11 M4 6h.01 M4 12h.01 M4 18h.01', up: 'M12 19V5 M6 11l6-6 6 6'
  };
  var TINT = { Catering: ['#e3efe6', '#3f6b4f'], Schedule: ['#e4ecf5', '#2f5f8a'], Reviews: ['#e4ecf5', '#2f5f8a'], Inventory: ['#f6ecd2', '#8a6a12'], 'Wine list': ['#f6e1e4', '#9b3d4b'], Payroll: ['#f3e3d3', '#8a5226'], 'To-do': ['#eef0f2', '#4a4e53'] };
  function icon(area, title) {
    var key = /use first/i.test(title || '') ? 'up' : area, t = TINT[area] || TINT['To-do'];
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    var p = document.createElementNS('http://www.w3.org/2000/svg', 'path'); p.setAttribute('d', ICONS[key] || ICONS['To-do']); svg.appendChild(p);
    var i = h('span', { cls: 'tdx-ic', style: 'background:' + t[0] + ';color:' + t[1] }); i.appendChild(svg); return i;
  }
  var EVT = { private: ['private', '#e4ecf5', '#2f5f8a'], supper: ['supper', '#f3e3d3', '#8a5226'], catering: ['catering', '#e3efe6', '#3f6b4f'], meeting: ['meeting', '#eef0f2', '#4a4e53'], closed: ['closed', '#f7dedb', '#8f2d22'], other: ['event', '#eef0f2', '#4a4e53'] };
  function money(v) { return '$' + Math.round(+v || 0).toLocaleString('en-US'); }
  function pctT(v) { return v == null || !isFinite(v) ? '—' : (v * 100).toFixed(1) + '%'; }
  function wkL(k) { var d = parseDay(k); return (d.getMonth() + 1) + '/' + d.getDate(); }
  function spark(vals, color) {
    var pts = vals.map(function (v, i) { return [i, v]; }).filter(function (p) { return p[1] != null && isFinite(p[1]); });
    var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 200 40'); svg.setAttribute('class', 'td-spark'); svg.setAttribute('preserveAspectRatio', 'none');
    if (pts.length < 2) return svg;
    var lo = Math.min.apply(null, pts.map(function (p) { return p[1]; })), hi = Math.max.apply(null, pts.map(function (p) { return p[1]; })), span = hi - lo || 1, n = vals.length - 1 || 1;
    var d = pts.map(function (p, j) { return (j ? 'L' : 'M') + (p[0] / n * 196 + 2).toFixed(1) + ',' + (36 - (p[1] - lo) / span * 32).toFixed(1); }).join('');
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path'); path.setAttribute('d', d); path.setAttribute('fill', 'none'); path.setAttribute('stroke', color); path.setAttribute('stroke-width', '2'); path.setAttribute('stroke-linejoin', 'round'); path.setAttribute('vector-effect', 'non-scaling-stroke');
    svg.appendChild(path); return svg;
  }
  function kpi(label, value, delta, sub, vals, color, report) {
    var chip = delta && delta.v != null && isFinite(delta.v) ? h('span', { cls: 'tdx-delta ' + (delta.good ? 'good' : 'bad'), text: (delta.v > 0 ? '▲ ' : '▼ ') + Math.abs(delta.v * 100).toFixed(1) + '%' }) : null;
    var card = h('div', { cls: 'tdx-kpi', role: 'button', tabindex: '0', title: 'Open the report', on: { click: report, keydown: function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); report(); } } } },
      [h('span', { cls: 'tdx-kl', text: label }), h('b', { text: value }), h('div', { cls: 'tdx-ks' }, [chip, h('span', { text: sub })]), spark(vals, color)]);
    return card;
  }
  function lastWeek(ctx, r) {
    var B = r.biz; if (!B || !B.length) return null;
    var withNet = B.filter(function (x) { return x.net != null; }); if (!withNet.length) return null;
    var L = withNet[withNet.length - 1], P0 = withNet[withNet.length - 2] || null;
    var ch = function (a, b) { return a != null && b ? (a - b) / Math.abs(b) : null; };
    var bp = function (x) { return x.net ? x.buy / x.net : null; }, avgChk = function (x) { return x.guests ? (x.net || 0) / x.guests : null; };
    var rep = function (title, series, fmt, axis, extra) {
      return function () {
        if (!window.EdenReport) return;
        window.EdenReport.open(Object.assign({ title: title, x: B.map(function (x) { return wkL(x.week); }), xTitle: function (i) { return 'Week of ' + wkL(B[i].week); }, kind: 'line', fmt: fmt, axis: axis, series: series,
          source: 'From the weekly payroll (net sales, payroll cost), invoices scanned into Inventory and the end of day reports’ guest counts.',
          detail: function (i) { var x = B[i]; var g = h('div', { cls: 'rp-wk' }); [['Net sales', x.net != null ? money(x.net) : '—'], ['Payroll cost', x.cost != null ? money(x.cost) : '—'], ['Labor %', pctT(x.pct)], ['Invoices', money(x.buy)], ['Purchases %', pctT(bp(x))], ['Guests', x.guests ? String(x.guests) : '—'], ['Average check', avgChk(x) ? '$' + avgChk(x).toFixed(2) : '—'], ['Payroll', x.status === 'final' ? 'final' : x.net != null ? 'draft' : 'not in']].forEach(function (f) { g.appendChild(h('div', null, [h('span', { text: f[0] }), h('b', { text: f[1] })])); }); return g; } }, extra || {}));
      };
    };
    var mfmt = function (v) { return money(v); }, pf = function (v) { return pctT(v); }, pa = function (v) { return Math.round(v * 100) + '%'; };
    var sec = h('section', { cls: 'tdx-sec' }, [h('div', { cls: 'tdx-sech' }, [h('h2', { text: 'Last week' }), h('a', { cls: 'tdx-btn', href: '#financials', text: 'Financials', on: { click: function (e) { e.preventDefault(); go('#financials'); } } })])]);
    sec.appendChild(h('div', { cls: 'tdx-kpis' }, [
      kpi('Net sales', money(L.net), { v: ch(L.net, P0 && P0.net), good: ch(L.net, P0 && P0.net) >= 0 }, 'week of ' + wkL(L.week), B.map(function (x) { return x.net; }), '#b0703f',
        rep('Net sales', [{ name: 'Net sales', color: '#b0703f', values: B.map(function (x) { return x.net; }) }], mfmt, null, { kind: 'bars' })),
      kpi('Labor', pctT(L.pct), { v: ch(L.pct, P0 && P0.pct), good: ch(L.pct, P0 && P0.pct) <= 0 }, 'of sales', B.map(function (x) { return x.pct; }), '#8f2d22',
        rep('Labor %', [{ name: 'Labor %', color: '#8f2d22', values: B.map(function (x) { return x.pct; }) }], pf, pa, { target: 0.30, targetLabel: '30%' })),
      kpi('Purchases', pctT(bp(L)), { v: ch(bp(L), P0 && bp(P0)), good: ch(bp(L), P0 && bp(P0)) <= 0 }, money(L.buy) + ' on invoices', B.map(bp), '#3f6b4f',
        rep('Purchases % of sales', [{ name: 'Purchases %', color: '#3f6b4f', values: B.map(bp) }], pf, pa)),
      kpi('Guests', L.guests ? String(L.guests) : '—', { v: ch(L.guests, P0 && P0.guests), good: ch(L.guests, P0 && P0.guests) >= 0 }, avgChk(L) ? '$' + avgChk(L).toFixed(2) + ' average check' : 'from end of day reports', B.map(function (x) { return x.guests || null; }), '#2f5f8a',
        rep('Guests', [{ name: 'Guests', color: '#2f5f8a', values: B.map(function (x) { return x.guests || null; }) }], function (v) { return String(Math.round(v)); }, function (v) { return String(Math.round(v)); }, { kind: 'bars' }))
    ]));
    return sec;
  }
  function render(ctx, r) {
    var el = ctx.el; el.innerHTML = '';
    var now = r.w.now, hr = now.getHours(), first = String(ctx.name || '').split(/[\s@]/)[0];
    var needs = r.items.filter(function (it) { return it.area !== 'To-do'; }), todos = r.items.filter(function (it) { return it.area === 'To-do'; });
    var page = h('div', { cls: 'tdx' });
    page.appendChild(h('header', { cls: 'tdx-head' }, [
      h('h1', { id: 'homeHello', text: (hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (first ? ', ' + first : '') }),
      h('p', { text: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) + ' · ' + (r.items.length ? plural(r.items.length, 'thing') + ' need' + (r.items.length === 1 ? 's' : '') + ' you' : 'Nothing needs you right now') })
    ]));
    // needs you: a card each, two across
    var sec = h('section', { cls: 'tdx-sec' }, [h('div', { cls: 'tdx-sech' }, [h('h2', { text: 'Needs you' })])]);
    if (!needs.length) sec.appendChild(h('div', { cls: 'tdx-clear' }, [h('b', { text: 'All caught up.' }), h('span', { text: 'Nothing is waiting for you right now.' })]));
    else sec.appendChild(h('div', { cls: 'tdx-grid' }, needs.map(function (it) {
      return h('a', { cls: 'tdx-card' + (it.hot ? ' hot' : ''), href: it.href, on: { click: function (e) { e.preventDefault(); go(it.href); } } }, [
        icon(it.area, it.title), h('span', { cls: 'tdx-what' }, [h('b', { text: it.title }), h('span', { text: it.sub })]), h('span', { cls: 'tdx-go', text: it.cta + ' →' })]);
    })));
    page.appendChild(sec);
    // last week's numbers, each opens its report
    var lw = ctx.isOwner ? lastWeek(ctx, r) : null; if (lw) page.appendChild(lw);
    // on tonight and coming up
    var two = h('div', { cls: 'tdx-two' });
    var tn = h('section', { cls: 'tdx-panel' }, [h('div', { cls: 'tdx-ph' }, [h('div', null, [h('h3', { text: 'On tonight' }), h('p', { text: r.crewKnown ? (r.crew.length ? plural(r.crew.length, 'person') .replace('persons', 'people') + ' scheduled' : 'Nobody scheduled') : 'Tonight’s events' })]),
      ctx.isMgr ? h('a', { cls: 'tdx-btn', href: '#schedule', text: 'Schedule', on: { click: function (e) { e.preventDefault(); go('#schedule'); } } }) : null])]);
    if (r.tonight.length) tn.appendChild(h('ul', { cls: 'tdx-list' }, r.tonight.map(function (e) {
      var c = EVT[e.type] || EVT.other;
      return h('li', null, [h('a', { href: '#calendar/e/' + e.date + '/' + encodeURIComponent(e.id || '') }, [h('div', null, [h('b', { text: e.title }), h('span', { text: [!e.all_day && e.start ? t12(e.start) : 'All day', e.room, e.guests ? e.guests + ' guests' : ''].filter(Boolean).join(' · ') })]), h('em', { cls: 'tdx-chip', style: 'background:' + c[1] + ';color:' + c[2], text: c[0] })])]);
    })));
    if (ctx.isMgr && r.crewKnown) tn.appendChild(r.crew.length ? h('ul', { cls: 'tdx-list' }, r.crew.map(function (c) {
      return h('li', null, [h('div', null, [h('b', { text: c.name }), h('span', { text: c.position })]), h('span', { cls: 'tdx-time', text: t12(c.start) + '–' + (endText(c) || '') })]);
    })) : h('p', { cls: 'tdx-none', text: 'Nobody on this week’s published schedule today.' }));
    else if (!r.tonight.length) tn.appendChild(h('p', { cls: 'tdx-none', text: 'No events on the calendar today.' }));
    two.appendChild(tn);
    var up = h('section', { cls: 'tdx-panel' }, [h('div', { cls: 'tdx-ph' }, [h('div', null, [h('h3', { text: 'Coming up' }), h('p', { text: 'Next 10 days' })]), h('a', { cls: 'tdx-btn', href: '#calendar', text: 'Calendar', on: { click: function (e) { e.preventDefault(); go('#calendar'); } } })])]);
    up.appendChild(r.week.length ? h('ul', { cls: 'tdx-list' }, r.week.slice(0, 8).map(function (e) {
      var c = EVT[e.type] || EVT.other, d = parseDay(e.date);
      return h('li', null, [h('a', { href: '#calendar/e/' + e.date + '/' + encodeURIComponent(e.id || '') }, [h('div', null, [h('b', { text: e.title }), h('span', { text: [d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }), !e.all_day && e.start ? t12(e.start) : '', e.guests ? e.guests + ' guests' : ''].filter(Boolean).join(' · ') })]), h('em', { cls: 'tdx-chip', style: 'background:' + c[1] + ';color:' + c[2], text: c[0] })])]);
    })) : h('p', { cls: 'tdx-none', text: 'Nothing on the calendar in the next 10 days.' }));
    two.appendChild(up);
    page.appendChild(two);
    if (ctx.isMgr && r.eod) { var eo = eodCard(r.eod); eo.classList.add('tdx-panel'); page.appendChild(eo); }
    // my to-dos and shared notes
    var two2 = h('div', { cls: 'tdx-two' });
    var td = h('section', { cls: 'tdx-panel' }, [h('div', { cls: 'tdx-ph' }, [h('div', null, [h('h3', { text: 'My to-dos' }), h('p', { text: 'From Notes and the To-do list' })]), h('a', { cls: 'tdx-btn', href: '#todo', text: 'To-do', on: { click: function (e) { e.preventDefault(); go('#todo'); } } })])]);
    var open = todos.filter(function (it) { return it.todo; });
    td.appendChild(open.length ? h('ul', { cls: 'tdx-list tdx-todos' }, open.map(function (it) {
      var tick = h('button', { type: 'button', cls: 'td-tick', title: 'Mark done', 'aria-label': 'Mark done: ' + it.title, on: { click: function () { tickTodo(ctx, it.todo, this); } } });
      return h('li', { cls: 'td-item' + (it.late ? ' late' : '') }, [tick, h('div', null, [h('b', { text: it.title }), it.sub ? h('span', { text: it.sub }) : null])]);
    }).concat(todos.filter(function (it) { return !it.todo; }).map(function (it) { return h('li', null, [h('a', { href: it.href, text: it.title + ' →' })]); }))) : h('p', { cls: 'tdx-none', text: 'Nothing on your list.' }));
    two2.appendChild(td);
    if (ctx.isMgr && r.notes.length) {
      var nt = h('section', { cls: 'tdx-panel' }, [h('div', { cls: 'tdx-ph' }, [h('div', null, [h('h3', { text: 'Shared notes' }), h('p', { text: 'The latest' })])])]);
      nt.appendChild(h('ul', { cls: 'tdx-list' }, r.notes.map(function (n) {
        var title = (n.title || '').trim() || (n.body || '').trim().split('\n')[0].slice(0, 60) || 'Handwritten note';
        return h('li', null, [h('button', { type: 'button', cls: 'tdx-note', on: { click: function () { if (window.EdenNotes) window.EdenNotes.open(); } } }, [h('b', { text: title }), h('span', { text: n.edited_by && n.edited_by !== n.author ? 'edited by ' + n.edited_by : (n.author ? 'by ' + n.author : '') })])]);
      })));
      two2.appendChild(nt);
    }
    page.appendChild(two2);
    var site = ctx.site;
    page.appendChild(h('p', { cls: 'home-links tdx-links' }, [
      h('a', { id: 'homeSite', href: site || '#', target: '_blank', rel: 'noopener', hidden: !site, text: 'View the website' }), ' ',
      h('a', { id: 'homePad', href: site ? site.replace(/#.*$/, '') + '#ipad' : '#', target: '_blank', rel: 'noopener', hidden: !site, text: 'Open the iPad menu' })
    ]));
    el.appendChild(page);
  }

  // Last night's end of day report: a link to it, the numbers, and anything that needs attention
  var EOD_FLAGS = [['incidents', 'Incident'], ['safety_concerns', 'Safety'], ['complaints', 'Complaint'], ['guest_followups', 'Guest follow-up'], ['payment_discrepancies', 'Payment discrepancy'],
    ['equipment_issues', 'Equipment'], ['maintenance', 'Maintenance'], ['staff_followup', 'Staff follow-up'], ['conduct_issues', 'Conduct'], ['closing_outstanding', 'Closing left undone'],
    ['stock_shortages', 'Shortage'], ['sold_out', 'Sold out / 86'], ['inventory_discrepancies', 'Inventory'], ['next_priorities', 'Next shift'], ['final_priorities', 'Priorities']];
  function clip(t, n) { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1).replace(/\s+\S*$/, '') + '…' : t; }
  function money0(v) { return '$' + Math.round(+v).toLocaleString('en-US'); }
  function eodCard(E) {
    var card = h('section', { cls: 'td-card td-eod', 'aria-labelledby': 'tdEodH' });
    card.appendChild(h('p', { cls: 'td-k', id: 'tdEodH', text: 'End of day report' }));
    if (E.missing) card.appendChild(h('a', { cls: 'td-eod-miss', href: '#eod', on: { click: function (e) { e.preventDefault(); go('#eod'); } } },
      [h('b', { text: 'No report yet for ' + E.missing.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) }), h('span', { text: 'File it now ›' })]));
    if (!E.reports.length) { if (!E.missing) card.appendChild(h('p', { cls: 'td-none', text: 'No end of day reports yet.' })); return card; }
    var day = parseDay(E.date).toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    E.reports.forEach(function (rp) {
      var shift = rp.shift === 'private' ? 'Private event' : rp.shift === 'both' ? 'Dinner & private event' : 'Dinner';
      var covers = rp.total_covers != null ? rp.total_covers : rp.actual_covers;
      var nums = [covers != null ? covers + ' covers' : '', rp.net_sales != null ? money0(rp.net_sales) + ' net' : '', rp.avg_per_cover != null ? money0(rp.avg_per_cover) + ' a cover' : '',
        rp.service_rating ? 'service ' + rp.service_rating + '/5' : ''].filter(Boolean).join(' · ');
      var a = h('a', { cls: 'td-eod-link', href: '#eod/r/' + rp.id, title: 'Open the full report', on: { click: function (e) { e.preventDefault(); go('#eod/r/' + rp.id); } } }, [
        h('b', { text: day + ' · ' + shift }), h('span', { text: [nums, rp.prepared_by ? 'by ' + rp.prepared_by : ''].filter(Boolean).join(' · ') }), h('em', { text: 'Open report ›' })]);
      card.appendChild(a);
      if (rp.overview) card.appendChild(h('p', { cls: 'td-eod-ov', text: clip(rp.overview, 220) }));
      // action items first, then anything flagged
      var acts = (rp.action_items || []).filter(function (x) { return x && x.task; });
      var pri = function (x) { return /high|urgent/i.test(x.priority || '') ? 0 : /med/i.test(x.priority || '') ? 1 : 2; };
      acts.sort(function (x, y) { return pri(x) - pri(y) || String(x.deadline || '9').localeCompare(String(y.deadline || '9')); });
      if (acts.length) {
        card.appendChild(h('p', { cls: 'td-eod-h', text: 'Action items · ' + acts.length }));
        card.appendChild(h('ul', { cls: 'td-eod-list' }, acts.slice(0, 6).map(function (x) {
          return h('li', { cls: pri(x) === 0 ? 'hot' : '' }, [h('b', { text: clip(x.task, 120) }),
            h('span', { text: [x.assigned, x.priority ? x.priority + ' priority' : '', x.deadline ? 'by ' + parseDay(x.deadline).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''].filter(Boolean).join(' · ') })]);
        }).concat(acts.length > 6 ? [h('li', null, [h('span', { text: 'and ' + (acts.length - 6) + ' more in the report' })])] : [])));
      }
      var flags = EOD_FLAGS.filter(function (f) { return String(rp[f[0]] || '').trim() && !/^(none|n\/?a|no|-|nothing)\.?$/i.test(String(rp[f[0]]).trim()); });
      if (rp.closing_done === false && !flags.some(function (f) { return f[0] === 'closing_outstanding'; })) flags.push(['_closing', 'Closing checklist not finished']);
      if (flags.length) {
        card.appendChild(h('p', { cls: 'td-eod-h', text: 'Worth a look' }));
        card.appendChild(h('ul', { cls: 'td-eod-list' }, flags.slice(0, 6).map(function (f) {
          var hot = /incident|safety|complaint|discrepanc|conduct/i.test(f[0]);
          return h('li', { cls: hot ? 'hot' : '' }, [h('b', { text: f[1] }), h('span', { text: f[0] === '_closing' ? '' : clip(rp[f[0]], 140) })]);
        })));
      }
      if (!acts.length && !flags.length) card.appendChild(h('p', { cls: 'td-none', text: 'No action items or issues flagged.' }));
    });
    card.appendChild(h('a', { cls: 'td-more', href: '#eod/past', text: 'Past reports ›' }));
    return card;
  }

  // tick a to-do off right here (the same as ticking it on the To-do page)
  function tickTodo(ctx, t, btn) {
    btn.disabled = true; btn.classList.add('on');
    var row = btn.closest('.td-item'); if (row) row.classList.add('ticked');
    ctx.sb.from('todos').update({ done: true, done_at: new Date().toISOString() }).eq('id', t.id).then(function (r) {
      if (r && r.error) { btn.disabled = false; btn.classList.remove('on'); if (row) row.classList.remove('ticked'); if (ctx.status) ctx.status('Couldn’t mark it done. Try again.', 'err'); return; }
      if (ctx.status) ctx.status('Done: ' + t.title, 'ok');
      setTimeout(function () { window.EdenToday.show(ctx); }, 450);
    });
  }

  window.EdenToday = {
    show: function (ctx) {
      var my = ++T.seq;
      if (!ctx.el.firstChild) ctx.el.appendChild(h('div', { cls: 'td-in' }, [h('p', { cls: 'td-none', text: 'Loading today…' })]));
      return gather(ctx).then(function (r) {
        if (my !== T.seq) return;
        render(ctx, r);
        if (ctx.onCounts) ctx.onCounts(r.counts);
      });
    },
    counts: function (ctx) { return gather(ctx).then(function (r) { if (ctx.onCounts) ctx.onCounts(r.counts); return r.counts; }); }
  };
})();
