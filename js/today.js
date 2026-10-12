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
    P.emps = mgr ? q(sb.from('employees').select('id,name')) : null;
    P.items = ctx.canPrep ? q(sb.from('inventory_items').select('id,category,par,active')) : null;
    P.counts = ctx.canPrep ? q(sb.from('inventory_counts').select('category,count_date,counts')) : null;
    P.pay = ctx.isOwner ? q(sb.from('payroll_weeks').select('week_start,status').eq('week_start', iso(lastWk)).maybeSingle()) : null;
    P.payReady = ctx.isOwner ? q(sb.from('pay_rates').select('emp').limit(1)) : null;
    P.events = q(sb.from('events').select('id,title,type,date,start,end,room,guests,all_day').gte('date', today).lte('date', iso(addDays(now, 7))));
    P.notes = mgr ? q(sb.from('notes').select('id,title,body,author,edited_by,updated_at,shared').eq('shared', true)) : null;
    P.todos = q(sb.from('todos').select('id,title,due,done'));
    var keys = Object.keys(P);
    return Promise.all(keys.map(function (k) { return P[k]; })).then(function (vals) {
      var d = {}; keys.forEach(function (k, i) { d[k] = vals[i]; });
      return build(ctx, d, { now: now, today: today, thisWk: thisWk, nextWk: nextWk, lastWk: lastWk });
    });
  }
  function build(ctx, d, w) {
    var items = [], counts = { catering: 0, inventory: 0, schedule: 0, payroll: '' };
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
    // payroll for the week that just ended
    if (ctx.isOwner && d.payReady && d.payReady.length && !(d.pay && d.pay.status === 'final')) {
      items.push({ area: 'Payroll', title: 'Payroll for ' + weekRange(w.lastWk) + (d.pay ? ' is still a draft' : ' isn’t started'), sub: 'Check the hours, then finalize and download for the accountant', href: '#payroll', cta: 'Finish' });
      counts.payroll = d.pay ? 'Draft' : 'To do';
    }
    // to-dos due today or overdue
    if (d.todos) {
      var due = d.todos.filter(function (t) { return !t.done && t.due && t.due <= w.today; });
      if (due.length) items.push({ area: 'To-do', title: plural(due.length, 'to-do') + ' due', sub: due.slice(0, 3).map(function (t) { return t.title; }).join(' · '), href: '#todo', cta: 'Open' });
    }
    counts.total = items.length;
    // tonight and the week ahead
    var ev = (d.events || []).slice().sort(function (a, b) { return (a.date + (a.start || '')) < (b.date + (b.start || '')) ? -1 : 1; });
    var tonight = ev.filter(function (e) { return e.date === w.today; }), week = ev.filter(function (e) { return e.date > w.today; });
    // who's working today (published schedule)
    var crew = [];
    if (d.thisWeek && d.thisWeek.status === 'published' && d.thisWeek.published && d.emps) {
      var byId = {}; d.emps.forEach(function (e) { byId[e.id] = e.name; });
      crew = d.thisWeek.published.filter(function (s) { return s.day === w.now.getDay() && byId[s.emp]; })
        .sort(function (a, b) { return String(a.start).localeCompare(String(b.start)); })
        .map(function (s) { return shortName(byId[s.emp]) + ' ' + t12(s.start) + (s.end ? '–' + t12(s.end) : ''); });
    }
    var notes = (d.notes || []).slice().sort(function (a, b) { return a.updated_at < b.updated_at ? 1 : -1; }).slice(0, 3);
    return { items: items, counts: counts, tonight: tonight, week: week, crew: crew, crewKnown: !!(d.thisWeek && d.emps), notes: notes, w: w };
  }

  /* ---------- draw ---------- */
  function go(href) { try { sessionStorage.setItem('eden-from-today', '1'); } catch (e) {} location.hash = href; }
  function eventLine(e, withDay) {
    var bits = [];
    if (withDay) bits.push(parseDay(e.date).toLocaleDateString('en-US', { weekday: 'short' }));
    if (!e.all_day && e.start) bits.push(t12(e.start));
    return h('li', null, [h('b', { text: (bits.length ? bits.join(' · ') + ' · ' : '') + e.title }),
      (e.room || e.guests) ? h('span', { text: [e.room, e.guests ? e.guests + ' guests' : ''].filter(Boolean).join(' · ') }) : null]);
  }
  function render(ctx, r) {
    var el = ctx.el; el.innerHTML = '';
    var now = r.w.now, hr = now.getHours(), first = String(ctx.name || '').split(/[\s@]/)[0];
    var grid = h('div', { cls: 'td-in' });
    grid.appendChild(h('header', { cls: 'td-head' }, [
      h('p', { cls: 'home-eyebrow', text: now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }) }),
      h('h1', { cls: 'td-title', id: 'homeHello', text: (hr < 12 ? 'Good morning' : hr < 17 ? 'Good afternoon' : 'Good evening') + (first ? ', ' + first : '') })
    ]));
    // needs you
    var needs = h('section', { cls: 'td-needs', 'aria-labelledby': 'tdNeedsH' });
    needs.appendChild(h('h2', { cls: 'td-h', id: 'tdNeedsH', text: r.items.length ? 'Needs you · ' + r.items.length : 'Needs you' }));
    if (!r.items.length) {
      needs.appendChild(h('div', { cls: 'td-clear' }, [h('b', { text: 'All caught up.' }), h('span', { text: 'Nothing is waiting for you right now. Everything else is in the menu.' })]));
    } else {
      var list = h('ul', { cls: 'td-list' });
      r.items.forEach(function (it) {
        list.appendChild(h('li', { cls: 'td-item' + (it.hot ? ' hot' : '') }, [
          h('span', { cls: 'td-area', text: it.area }),
          h('span', { cls: 'td-what' }, [h('b', { text: it.title }), h('span', { text: it.sub })]),
          h('a', { cls: 'td-go', href: it.href, text: it.cta, 'aria-label': it.cta + ': ' + it.title, on: { click: function (e) { e.preventDefault(); go(it.href); } } })
        ]));
      });
      needs.appendChild(list);
    }
    needs.appendChild(h('p', { cls: 'td-fine', text: ctx.isOwner ? 'Payroll shows only for you; managers see the rest of this list.' : 'This list only shows what your role can take care of.' }));
    grid.appendChild(needs);
    // side: tonight, week, shared notes, shortcuts
    var side = h('aside', { cls: 'td-side', 'aria-label': 'Today at Eden' });
    var tn = h('section', { cls: 'td-tonight' }, [h('p', { cls: 'td-k', text: 'Tonight' })]);
    if (r.tonight.length) tn.appendChild(h('ul', { cls: 'td-ev' }, r.tonight.map(function (e) { return eventLine(e, false); })));
    else tn.appendChild(h('p', { cls: 'td-none', text: 'No events on the calendar today.' }));
    if (ctx.isMgr && r.crewKnown) {
      tn.appendChild(h('p', { cls: 'td-k', text: 'Working today' }));
      tn.appendChild(h('p', { cls: 'td-crew', text: r.crew.length ? r.crew.join(' · ') : 'Nobody on this week’s published schedule today.' }));
    }
    side.appendChild(tn);
    var wk = h('section', { cls: 'td-card' }, [h('p', { cls: 'td-k', text: 'This week' })]);
    wk.appendChild(r.week.length ? h('ul', { cls: 'td-ev' }, r.week.slice(0, 6).map(function (e) { return eventLine(e, true); })) : h('p', { cls: 'td-none', text: 'Nothing else on the calendar this week.' }));
    wk.appendChild(h('a', { cls: 'td-more', href: '#calendar', text: 'Calendar ›' }));
    side.appendChild(wk);
    if (ctx.isMgr && r.notes.length) {
      var nt = h('section', { cls: 'td-card' }, [h('p', { cls: 'td-k', text: 'Shared notes' })]);
      nt.appendChild(h('ul', { cls: 'td-ev' }, r.notes.map(function (n) {
        var title = (n.title || '').trim() || (n.body || '').trim().split('\n')[0].slice(0, 60) || 'Handwritten note';
        return h('li', null, [h('button', { type: 'button', cls: 'td-note', text: title, on: { click: function () { if (window.EdenNotes) window.EdenNotes.open(); } } }),
          h('span', { text: n.edited_by && n.edited_by !== n.author ? 'edited by ' + n.edited_by : (n.author ? 'by ' + n.author : '') })]);
      })));
      side.appendChild(nt);
    }
    var site = ctx.site;
    side.appendChild(h('p', { cls: 'home-links' }, [
      h('a', { id: 'homeSite', href: site || '#', target: '_blank', rel: 'noopener', hidden: !site, text: 'View the website' }), ' ',
      h('a', { id: 'homePad', href: site ? site.replace(/#.*$/, '') + '#ipad' : '#', target: '_blank', rel: 'noopener', hidden: !site, text: 'Open the iPad menu' })
    ]));
    grid.appendChild(side);
    el.appendChild(grid);
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
