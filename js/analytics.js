/* Eden staff site: Analytics (Owner only).
 *   Website traffic: how many people visit the public website, when, and where they are in the world.
 *   History: every change made on the staff site (js/history.js).
 * Visits are recorded by worker.js and summarised by the database (supabase/analytics.sql). */
(function () {
  'use strict';
  var LIBS = {
    d3: 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
    topo: 'https://cdn.jsdelivr.net/npm/topojson-client@3.1.0/dist/topojson-client.min.js',
    world: 'https://cdn.jsdelivr.net/npm/world-atlas@2.0.2/countries-110m.json',
    us: 'https://cdn.jsdelivr.net/npm/us-atlas@3.0.1/states-10m.json'
  };
  var TZ = 'America/New_York';
  var RANGES = [['7', '7 days'], ['30', '30 days'], ['90', '90 days'], ['365', '12 months']];
  var RAMP = ['#f1e2d2', '#dfb995', '#c98f5f', '#a5663a', '#6c3f1f'];   // one hue, light → dark: more visitors = darker
  var EMPTY = '#e7e4de', BAR = '#b0703f';
  var A = { ctx: null, el: null, sub: 'traffic', range: '30', measure: 'views', mapView: 'world', data: null, missing: false, err: '', seq: 0, atlas: {}, shell: false };

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
  var SVGNS = 'http://www.w3.org/2000/svg';
  function s(tag, attrs, kids) {
    var e = document.createElementNS(SVGNS, tag);
    Object.keys(attrs || {}).forEach(function (k) { if (attrs[k] != null) e.setAttribute(k, attrs[k]); });
    [].concat(kids || []).forEach(function (c) { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
    return e;
  }
  function iso(d) { return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function parseDay(x) { var p = String(x).slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function num(n) { return Number(n || 0).toLocaleString('en-US'); }
  function isMissing(e) { return e && (e.code === 'PGRST202' || e.code === '42883' || e.code === 'PGRST205' || /could not find the function|does not exist|schema cache/i.test(e.message || '')); }
  var MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  var DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  function dayLabel(d, withDow) { return (withDow ? DOW[d.getDay()] + ', ' : '') + MON[d.getMonth()] + ' ' + d.getDate(); }
  function countryName(c) { var x = (window.EDEN_COUNTRIES || {})[c]; return x ? x[1] : c; }
  function countryNum(c) { var x = (window.EDEN_COUNTRIES || {})[c]; return x ? x[0] : null; }
  function pageName(p) {
    var m = { '/': 'Home', '/supper': 'Supper Club', '/catering': 'Catering & private events', '/catering/questionnaire': 'Catering questionnaire (guest links)' };
    return m[p] || p;
  }
  var SITES = [[/(^|\.)google\./, 'Google'], [/(^|\.)bing\.com$/, 'Bing'], [/duckduckgo/, 'DuckDuckGo'], [/(^|\.)yahoo\./, 'Yahoo'],
    [/instagram\.com$/, 'Instagram'], [/(^|\.)facebook\.com$|^fb\.me$/, 'Facebook'], [/^t\.co$|(^|\.)twitter\.com$|(^|\.)x\.com$/, 'X (Twitter)'],
    [/yelp\./, 'Yelp'], [/tripadvisor\./, 'Tripadvisor'], [/opentable\./, 'OpenTable'], [/resy\.com$/, 'Resy'], [/tock/, 'Tock'],
    [/linkedin\.com$|^lnkd\.in$/, 'LinkedIn'], [/tiktok\.com$/, 'TikTok'], [/pinterest\./, 'Pinterest'], [/reddit\.com$/, 'Reddit'],
    [/chatgpt\.com$|openai\.com$/, 'ChatGPT'], [/perplexity\.ai$/, 'Perplexity'], [/claude\.ai$/, 'Claude'], [/(^|\.)apple\.com$/, 'Apple Maps']];
  function sourceName(r) {
    if (r.kind === 'direct') return 'Direct (typed in, bookmarks, apps)';
    if (r.kind === 'campaign') { var t = String(r.src); var hit = SITES.filter(function (x) { return x[0].test(t + '.com'); })[0]; return (hit ? hit[1] : t.charAt(0).toUpperCase() + t.slice(1)) + ' (tagged link)'; }
    var m = SITES.filter(function (x) { return x[0].test(r.src); })[0];
    return m ? m[1] : r.src;
  }

  /* ---------- loading the map libraries (only when the traffic page opens) ---------- */
  var libP = null;
  function script(src) {
    return new Promise(function (res, rej) { var e = document.createElement('script'); e.src = src; e.onload = res; e.onerror = rej; document.head.appendChild(e); });
  }
  function libs() {
    if (!libP) libP = Promise.all([window.d3 ? 0 : script(LIBS.d3), window.topojson ? 0 : script(LIBS.topo)]).catch(function (e) { libP = null; throw e; });
    return libP;
  }
  function atlas(which) {
    if (!A.atlas[which]) A.atlas[which] = fetch(LIBS[which]).then(function (r) { if (!r.ok) throw new Error('map'); return r.json(); }).catch(function (e) { A.atlas[which] = null; throw e; });
    return A.atlas[which];
  }

  /* ---------- page shell: title + sub-pages ---------- */
  function shell() {
    var el = A.el; el.innerHTML = '';
    var wrap = h('div', { cls: 'an-in' });
    var tabs = h('nav', { cls: 'an-tabs', 'aria-label': 'Analytics pages' }, [
      h('a', { href: '#analytics', 'data-sub': 'traffic', text: 'Website traffic' }),
      h('a', { href: '#analytics/history', 'data-sub': 'history', text: 'History' })
    ]);
    wrap.appendChild(h('div', { cls: 'an-head' }, [h('div', null, [h('p', { cls: 'sc-eyebrow', text: 'Owner only' }), h('h1', { cls: 'sc-week', text: 'Analytics' })]), tabs]));
    A.paneTraffic = h('div', { cls: 'an-pane', id: 'anTraffic' });
    A.paneHistory = h('div', { cls: 'an-pane', id: 'anHistory' });
    wrap.appendChild(A.paneTraffic); wrap.appendChild(A.paneHistory);
    el.appendChild(wrap);
    A.tip = h('div', { cls: 'an-tip', role: 'tooltip', hidden: true }); document.body.appendChild(A.tip);
    A.shell = true;
  }
  function showSub() {
    A.el.querySelectorAll('.an-tabs a').forEach(function (a) { a.setAttribute('aria-current', a.getAttribute('data-sub') === A.sub ? 'page' : 'false'); });
    A.paneTraffic.hidden = A.sub !== 'traffic';
    A.paneHistory.hidden = A.sub !== 'history';
    hideTip();
    if (A.sub === 'history') {
      if (window.EdenHistory) window.EdenHistory.show({ sb: A.ctx.sb, el: A.paneHistory, status: A.ctx.status, embedded: true });
    } else load();
  }

  /* ---------- website traffic ---------- */
  function period() {
    var n = +A.range, to = new Date(), from = new Date(); from.setDate(from.getDate() - (n - 1));
    return { from: iso(from), to: iso(to), n: n };
  }
  function load() {
    var my = ++A.seq, p = period();
    paintTraffic(true);
    libs().catch(function () {});   // start fetching the map while the numbers load
    A.ctx.sb.rpc('traffic_summary', { p_from: p.from, p_to: p.to, p_tz: TZ }).then(function (r) {
      if (my !== A.seq) return;
      A.err = ''; A.missing = false;
      if (r.error) { A.missing = isMissing(r.error); if (!A.missing) A.err = 'Couldn’t load website traffic. ' + (r.error.message || ''); A.data = null; }
      else A.data = r.data || null;
      paintTraffic(false);
    }, function () { if (my === A.seq) { A.err = 'Couldn’t reach the database.'; paintTraffic(false); } });
  }
  function seg(opts, cur, onPick, label) {
    var box = h('div', { cls: 'an-seg', role: 'group', 'aria-label': label }, opts.map(function (o) {
      return h('button', { type: 'button', 'aria-pressed': o[0] === cur ? 'true' : 'false', text: o[1], on: { click: function (e) {
        box.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-pressed', b === e.currentTarget ? 'true' : 'false'); });
        onPick(o[0]);
      } } });
    }));
    return box;
  }
  function paintTraffic(loading) {
    var el = A.paneTraffic; el.innerHTML = '';
    var top = h('div', { cls: 'an-bar' }, [
      h('p', { cls: 'an-sub', text: 'Visits to edencny.com. A visitor is one person on one day; page views count every page they open. Locations are approximate (city level). No names, IP addresses or cookies are kept.' }),
      seg(RANGES, A.range, function (v) { A.range = v; load(); }, 'Time period')
    ]);
    el.appendChild(top);
    if (A.missing) {
      el.appendChild(h('div', { cls: 'iv-setup' }, [
        h('p', { text: 'Website traffic isn’t switched on yet. In Supabase, open SQL Editor → New query, paste the contents of supabase/analytics.sql from the eden-admin repository, and click Run.' }),
        h('p', { text: 'Visits are counted from then on (earlier visits weren’t recorded, so the charts start empty).' })
      ]));
      return;
    }
    if (A.err) { el.appendChild(h('p', { cls: 'an-err', text: A.err })); return; }
    var d = A.data;
    if (loading && !d) { el.appendChild(h('p', { cls: 'an-loading', text: 'Loading website traffic…' })); return; }
    if (!d) return;
    if (loading) el.classList.add('an-busy'); else el.classList.remove('an-busy');
    var p = period(), t = d.totals || {}, pr = d.previous || {};
    var label = A.range === '365' ? 'previous 12 months' : 'previous ' + A.range + ' days';

    // headline numbers
    function delta(cur, prev) {
      if (!prev) return h('span', { cls: 'an-delta', text: cur ? 'New: no visits in the ' + label : '—' });
      var pc = Math.round((cur - prev) / prev * 100);
      return h('span', { cls: 'an-delta', text: (pc > 0 ? '▲ ' : pc < 0 ? '▼ ' : '') + Math.abs(pc) + '% vs ' + label + ' (' + num(prev) + ')' });
    }
    var ppv = t.visitors ? (t.views / t.visitors) : 0;
    el.appendChild(h('div', { cls: 'an-kpis' }, [
      h('div', { cls: 'an-kpi' }, [h('span', { cls: 'an-k', text: 'Visitors' }), h('b', { text: num(t.visitors) }), delta(t.visitors || 0, pr.visitors || 0)]),
      h('div', { cls: 'an-kpi' }, [h('span', { cls: 'an-k', text: 'Page views' }), h('b', { text: num(t.views) }), delta(t.views || 0, pr.views || 0)]),
      h('div', { cls: 'an-kpi' }, [h('span', { cls: 'an-k', text: 'Pages per visitor' }), h('b', { text: ppv ? ppv.toFixed(1) : '—' }), h('span', { cls: 'an-delta', text: 'How far people look around' })]),
      h('div', { cls: 'an-kpi' }, [h('span', { cls: 'an-k', text: 'On the site now' }), h('b', { text: num(d.now) }), h('span', { cls: 'an-delta', text: 'Visitors in the last 30 minutes' })])
    ]));
    if (!t.views) el.appendChild(h('p', { cls: 'an-note', text: 'No visits recorded in this period yet. Visits are counted from the moment the website update is live, so it can take a little while for the first ones to appear.' }));

    // traffic over time
    var weekly = A.range === '365';
    var chartCard = h('section', { cls: 'an-card' }, [
      h('div', { cls: 'an-card-h' }, [h('h2', { text: (A.measure === 'views' ? 'Page views' : 'Visitors') + (weekly ? ' per week' : ' per day') }),
        seg([['views', 'Page views'], ['visitors', 'Visitors']], A.measure, function (v) { A.measure = v; paintTraffic(false); }, 'What to chart')])
    ]);
    var box = h('div', { cls: 'an-chart' }); chartCard.appendChild(box);
    el.appendChild(chartCard);
    requestAnimationFrame(function () { drawVolume(box, d.daily || [], weekly); });

    // map
    var mapCard = h('section', { cls: 'an-card an-mapcard' }, [
      h('div', { cls: 'an-card-h' }, [h('h2', { text: 'Where visitors are' }),
        seg([['world', 'World'], ['us', 'United States']], A.mapView, function (v) { A.mapView = v; paintMap(mapBox, d); }, 'Map')])
    ]);
    var mapBox = h('div', { cls: 'an-map' }); mapCard.appendChild(mapBox);
    el.appendChild(mapCard);
    requestAnimationFrame(function () { paintMap(mapBox, d); });

    // the lists
    var regionsUS = (d.regions || []).filter(function (r) { return r.c === 'US'; });
    var srcs = {}; (d.sources || []).forEach(function (r) { var n = sourceName(r); srcs[n] = srcs[n] || { label: n, visitors: 0, views: 0 }; srcs[n].visitors += r.visitors; srcs[n].views += r.views; });
    el.appendChild(h('div', { cls: 'an-lists' }, [
      list('Countries', (d.countries || []).map(function (r) { return { label: countryName(r.c), visitors: r.visitors, views: r.views }; }), 'No locations yet'),
      list('Cities', (d.cities || []).map(function (r) { return { label: r.city, sub: [r.region, r.c === 'US' ? '' : countryName(r.c)].filter(Boolean).join(', '), visitors: r.visitors, views: r.views }; }), 'No locations yet'),
      list('US states', regionsUS.map(function (r) { return { label: r.region, visitors: r.visitors, views: r.views }; }), 'No US visitors yet'),
      list('How they found the site', Object.keys(srcs).map(function (k) { return srcs[k]; }).sort(function (a, b) { return b.visitors - a.visitors || b.views - a.views; }), 'No visits yet'),
      list('Pages', (d.pages || []).map(function (r) { return { label: pageName(r.path), visitors: r.visitors, views: r.views }; }), 'No visits yet', 'views'),
      list('Devices', (d.devices || []).map(function (r) { return { label: r.device.charAt(0).toUpperCase() + r.device.slice(1), visitors: r.visitors, views: r.views }; }), 'No visits yet')
    ]));
  }

  function list(title, rows, empty, by) {
    by = by || 'visitors';
    var max = rows.reduce(function (m, r) { return Math.max(m, r[by] || 0); }, 0);
    var shown = rows.slice(0, 10), more = rows.length - shown.length;
    var body = shown.length ? h('ol', { cls: 'an-list' }, shown.map(function (r) {
      return h('li', null, [
        h('div', { cls: 'an-li-t' }, [h('span', { cls: 'an-li-n', text: r.label }), r.sub ? h('span', { cls: 'an-li-s', text: r.sub }) : null]),
        h('b', { text: num(r[by]) }),
        h('span', { cls: 'an-li-bar', 'aria-hidden': 'true' }, [h('i', { style: 'width:' + (max ? Math.max(2, r[by] / max * 100) : 0) + '%' })])
      ]);
    })) : h('p', { cls: 'an-li-empty', text: empty });
    return h('section', { cls: 'an-card an-lcard' }, [
      h('div', { cls: 'an-card-h' }, [h('h2', { text: title }), h('span', { cls: 'an-unit', text: by === 'views' ? 'page views' : 'visitors' })]),
      body, more > 0 ? h('p', { cls: 'an-li-more', text: '+ ' + more + ' more' }) : null
    ]);
  }

  /* ---------- tooltip ---------- */
  function showTip(evt, html) {
    var t = A.tip; if (!t) return;
    t.innerHTML = html; t.hidden = false;
    var r = t.getBoundingClientRect(), x = evt.clientX + 14, y = evt.clientY + 14;
    if (x + r.width > window.innerWidth - 8) x = evt.clientX - r.width - 14;
    if (y + r.height > window.innerHeight - 8) y = evt.clientY - r.height - 14;
    t.style.left = Math.max(8, x) + 'px'; t.style.top = Math.max(8, y) + 'px';
  }
  function hideTip() { if (A.tip) A.tip.hidden = true; }
  function esc(x) { return String(x == null ? '' : x).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function tipRows(title, v) { return '<b>' + esc(title) + '</b><span>' + num(v.visitors) + ' visitor' + (v.visitors === 1 ? '' : 's') + '</span><span>' + num(v.views) + ' page view' + (v.views === 1 ? '' : 's') + '</span>'; }

  /* ---------- volume chart (plain SVG, no libraries needed) ---------- */
  function niceMax(v) { if (v <= 4) return 4; var p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; }
  function drawVolume(box, daily, weekly) {
    box.innerHTML = '';
    var pts = daily.map(function (r) { return { d: parseDay(r.d), views: r.views, visitors: r.visitors }; });
    if (weekly) { // Sunday-start weeks
      var wk = []; pts.forEach(function (p) {
        var k = new Date(p.d); k.setDate(k.getDate() - k.getDay());
        var last = wk[wk.length - 1];
        if (!last || +last.d !== +k) wk.push(last = { d: k, end: p.d, views: 0, visitors: 0 });
        last.views += p.views; last.visitors += p.visitors; last.end = p.d;
      });
      pts = wk;
    }
    var key = A.measure, W = Math.max(300, box.clientWidth || 800), H = 240, L = 44, R = 8, T = 12, B = 30;
    var max = niceMax(pts.reduce(function (m, p) { return Math.max(m, p[key]); }, 0));
    var n = pts.length, step = (W - L - R) / Math.max(1, n), gap = n > 120 ? 1 : 2, bw = Math.max(1, step - gap);
    var y = function (v) { return T + (H - T - B) * (1 - v / max); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, width: W, height: H, role: 'img', 'aria-label': (key === 'views' ? 'Page views' : 'Visitors') + ' per ' + (weekly ? 'week' : 'day') });
    // grid + y labels (recessive)
    for (var i = 0; i <= 4; i++) {
      var v = max / 4 * i, yy = Math.round(y(v)) + .5;
      svg.appendChild(s('line', { x1: L, x2: W - R, y1: yy, y2: yy, class: i === 0 ? 'an-axis' : 'an-grid' }));
      svg.appendChild(s('text', { x: L - 8, y: yy + 4, 'text-anchor': 'end', class: 'an-tick' }, num(v)));
    }
    // x labels: a handful, evenly spaced
    var every = Math.max(1, Math.ceil(n / Math.max(2, Math.floor((W - L) / 70))));
    pts.forEach(function (p, i) {
      if (i % every) return;
      var x = L + step * i + step / 2;
      svg.appendChild(s('text', { x: x, y: H - 10, 'text-anchor': 'middle', class: 'an-tick' }, weekly ? MON[p.d.getMonth()] + ' ' + p.d.getDate() : (n <= 7 ? DOW[p.d.getDay()] + ' ' : '') + MON[p.d.getMonth()] + ' ' + p.d.getDate()));
    });
    // bars: thin, rounded at the data end, anchored to the baseline
    var base = y(0);
    pts.forEach(function (p, i) {
      var x = L + step * i + gap / 2, top = y(p[key]), hgt = base - top;
      if (hgt > 0) {
        var r = Math.min(4, bw / 2, hgt);
        svg.appendChild(s('path', { class: 'an-barm', fill: BAR, d: 'M' + x + ',' + base + 'V' + (top + r) + 'Q' + x + ',' + top + ' ' + (x + r) + ',' + top + 'H' + (x + bw - r) + 'Q' + (x + bw) + ',' + top + ' ' + (x + bw) + ',' + (top + r) + 'V' + base + 'Z' }));
      }
    });
    // hover: a full-height target per bar
    var hl = s('rect', { class: 'an-hl', x: 0, y: T, width: step, height: base - T, visibility: 'hidden' });
    svg.insertBefore(hl, svg.firstChild);
    pts.forEach(function (p, i) {
      var hit = s('rect', { class: 'an-hit', x: L + step * i, y: T, width: step, height: base - T + B, fill: 'transparent' });
      hit.addEventListener('mousemove', function (e) {
        hl.setAttribute('x', L + step * i); hl.setAttribute('visibility', 'visible');
        var title = weekly ? 'Week of ' + dayLabel(p.d) + (p.end && +p.end !== +p.d ? ' – ' + dayLabel(p.end) : '') : dayLabel(p.d, true);
        showTip(e, tipRows(title, p));
      });
      hit.addEventListener('mouseleave', function () { hl.setAttribute('visibility', 'hidden'); hideTip(); });
      svg.appendChild(hit);
    });
    box.appendChild(svg);
  }

  /* ---------- the map ---------- */
  function shade(v, max) {
    if (!v) return EMPTY;
    var t = max <= 1 ? 1 : Math.log(1 + v) / Math.log(1 + max);   // log scale so one busy country doesn't wash out the rest
    return window.d3.interpolateRgbBasis(RAMP)(0.12 + 0.88 * t);
  }
  function paintMap(box, d) {
    box.innerHTML = '';
    box.appendChild(h('p', { cls: 'an-loading', text: 'Loading the map…' }));
    var view = A.mapView, my = ++A.mapSeq;
    libs().then(function () { return atlas(view === 'us' ? 'us' : 'world'); }).then(function (topo) {
      if (my !== A.mapSeq || !box.isConnected) return;
      drawMap(box, d, topo, view);
    }).catch(function () {
      if (my !== A.mapSeq) return;
      box.innerHTML = '';
      box.appendChild(h('p', { cls: 'an-err', text: 'The map couldn’t load (no connection to the map service). The lists below show the same places.' }));
    });
  }
  A.mapSeq = 0;
  function drawMap(box, d, topo, view) {
    var d3 = window.d3, topojson = window.topojson;
    box.innerHTML = '';
    var W = Math.max(300, box.clientWidth || 900), H = Math.round(W * (view === 'us' ? 0.6 : 0.5));
    var shapes, proj, values = {}, max = 0;
    if (view === 'us') {
      shapes = topojson.feature(topo, topo.objects.states).features;
      (d.regions || []).forEach(function (r) { if (r.c === 'US') values[String(r.region).toLowerCase()] = r; });
      proj = d3.geoAlbersUsa().fitExtent([[10, 10], [W - 10, H - 10]], { type: 'FeatureCollection', features: shapes });
    } else {
      shapes = topojson.feature(topo, topo.objects.countries).features.filter(function (f) { return f.id !== '010'; }); // leave out Antarctica
      (d.countries || []).forEach(function (r) { var k = countryNum(r.c); if (k) values[k] = r; });
      proj = d3.geoNaturalEarth1().fitExtent([[6, 6], [W - 6, H - 6]], { type: 'FeatureCollection', features: shapes });
    }
    Object.keys(values).forEach(function (k) { max = Math.max(max, values[k].visitors || 0); });
    var keyOf = function (f) { return view === 'us' ? String(f.properties.name).toLowerCase() : String(f.id); };
    var path = d3.geoPath(proj);
    var svg = d3.select(box).append('svg').attr('viewBox', '0 0 ' + W + ' ' + H).attr('width', W).attr('height', H)
      .attr('role', 'img').attr('aria-label', view === 'us' ? 'Map of the United States shaded by visitors per state, with a dot for each city' : 'World map shaded by visitors per country, with a dot for each city');
    var g = svg.append('g');
    g.append('g').attr('class', 'an-land').selectAll('path').data(shapes).join('path')
      .attr('d', path).attr('fill', function (f) { var v = values[keyOf(f)]; return shade(v && v.visitors, max); })
      .on('mousemove', function (e, f) { var v = values[keyOf(f)] || { visitors: 0, views: 0 }; showTip(e, tipRows(f.properties.name, v)); })
      .on('mouseleave', hideTip);
    if (view === 'us') g.append('path').attr('class', 'an-borders').attr('d', path(topojson.mesh(topo, topo.objects.states, function (a, b) { return a !== b; })));
    // cities: a dot sized by visitors (area, not radius, matches the number)
    var cities = (d.cities || []).filter(function (c) { return c.lat != null && c.lon != null && (view !== 'us' || c.c === 'US'); })
      .map(function (c) { var xy = proj([+c.lon, +c.lat]); return xy ? { c: c, x: xy[0], y: xy[1] } : null; }).filter(Boolean);
    var cmax = cities.reduce(function (m, p) { return Math.max(m, p.c.visitors); }, 1);
    var rs = d3.scaleSqrt().domain([0, cmax]).range([0, Math.min(16, W / 60)]);
    var rad = function (p) { return Math.max(3, rs(p.c.visitors)); };
    cities.sort(function (a, b) { return b.c.visitors - a.c.visitors; }); // small dots on top of big ones
    var dots = g.append('g').attr('class', 'an-dots').selectAll('circle').data(cities).join('circle')
      .attr('cx', function (p) { return p.x; }).attr('cy', function (p) { return p.y; }).attr('r', rad)
      .on('mousemove', function (e, p) { showTip(e, tipRows([p.c.city, p.c.region, p.c.c === 'US' ? '' : countryName(p.c.c)].filter(Boolean).join(', '), p.c)); })
      .on('mouseleave', hideTip);
    // zoom & pan (scroll, pinch, drag, or the buttons)
    var zoom = d3.zoom().scaleExtent([1, 40]).translateExtent([[0, 0], [W, H]]).on('zoom', function (e) {
      g.attr('transform', e.transform);
      var k = e.transform.k;
      dots.attr('r', function (p) { return rad(p) / Math.sqrt(k); }).attr('stroke-width', 1.5 / k);
      g.selectAll('.an-land path').attr('stroke-width', 0.6 / k);
      g.selectAll('.an-borders').attr('stroke-width', 0.8 / k);
    });
    svg.call(zoom).on('wheel.zoom', null);   // page scroll stays page scroll; use the buttons, pinch, or double-click
    svg.on('wheel', function (e) { if (e.ctrlKey || e.metaKey) { e.preventDefault(); zoom.scaleBy(svg, e.deltaY < 0 ? 1.25 : 0.8, d3.pointer(e)); } }, { passive: false });
    var ctr = h('div', { cls: 'an-zoom' }, [
      h('button', { type: 'button', 'aria-label': 'Zoom in', text: '+', on: { click: function () { svg.transition().duration(250).call(zoom.scaleBy, 2); } } }),
      h('button', { type: 'button', 'aria-label': 'Zoom out', text: '−', on: { click: function () { svg.transition().duration(250).call(zoom.scaleBy, 0.5); } } }),
      h('button', { type: 'button', cls: 'an-zoom-r', text: 'Reset', on: { click: function () { svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity); } } })
    ]);
    if (view === 'world') {
      var home = h('button', { type: 'button', cls: 'an-zoom-r', text: 'Upstate NY', title: 'Zoom to central New York', on: { click: function () {
        var xy = proj([-76.18, 42.6]), k = 14; svg.transition().duration(500).call(zoom.transform, d3.zoomIdentity.translate(W / 2 - xy[0] * k, H / 2 - xy[1] * k).scale(k));
      } } });
      ctr.appendChild(home);
    }
    box.appendChild(ctr);
    // legend: what the shading and the dots mean
    var lg = h('div', { cls: 'an-legend' });
    var grad = 'linear-gradient(90deg,' + [0, .25, .5, .75, 1].map(function (t) { return d3.interpolateRgbBasis(RAMP)(0.12 + 0.88 * t); }).join(',') + ')';
    lg.appendChild(h('div', { cls: 'an-lg-item' }, [h('span', { cls: 'an-lg-k', text: view === 'us' ? 'Visitors per state' : 'Visitors per country' }),
      h('span', { cls: 'an-lg-n', text: max ? '1' : '0' }), h('span', { cls: 'an-lg-ramp', style: 'background:' + grad }), h('span', { cls: 'an-lg-n', text: num(max) })]));
    lg.appendChild(h('div', { cls: 'an-lg-item' }, [h('span', { cls: 'an-lg-sw0' }), h('span', { cls: 'an-lg-k2', text: 'No visitors' })]));
    lg.appendChild(h('div', { cls: 'an-lg-item' }, [h('span', { cls: 'an-lg-dot' }), h('span', { cls: 'an-lg-k2', text: 'City (bigger = more visitors)' })]));
    lg.appendChild(h('div', { cls: 'an-lg-hint', text: 'Hover for numbers. Pinch, double-click, or use + and − to zoom; drag to move around.' }));
    box.appendChild(lg);
  }

  window.addEventListener('resize', function () {
    clearTimeout(A.rt);
    A.rt = setTimeout(function () { if (A.el && !A.el.hidden && A.sub === 'traffic' && A.data) paintTraffic(false); }, 250);
  });

  window.EdenAnalytics = {
    show: function (ctx) {
      A.ctx = ctx;
      if (A.el !== ctx.el || !A.shell || !ctx.el.firstChild) { A.el = ctx.el; shell(); }
      A.sub = ctx.sub === 'history' ? 'history' : 'traffic';
      showSub();
    },
    hide: hideTip
  };
})();
