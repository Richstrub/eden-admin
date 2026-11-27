/* Eden staff site: the report behind a graph. Click a graph (Today's numbers, Financials, Payroll, Product
 * sales) and its report opens over the page: the graph large, what stands out in words, the key numbers for
 * each line, and every row in a table (tap a week for its breakdown, when the graph knows one), with
 * Download CSV and Print. Esc or Back closes it.
 *
 *   EdenReport.open({
 *     title, sub, source,                       // headings and the note under the table
 *     x: ['11/1', '11/8', …], xTitle(i),        // the labels (and, optionally, a longer one for the table)
 *     xName: 'Week',                            // the table's first column
 *     series: [{ name, color, values: [], fmt }],
 *     kind: 'bars' | 'stack' | 'line' | 'hbars',
 *     cats: true,                               // categories (items, people) rather than weeks
 *     fmt, axis,                                // value and axis formats (money by default)
 *     target, targetLabel,                      // a reference line (e.g. 30% labor)
 *     detail(i) → element                       // a row's breakdown
 *   })
 */
(function () {
  'use strict';
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
  function s(tag, a) { var e = document.createElementNS('http://www.w3.org/2000/svg', tag); Object.keys(a || {}).forEach(function (k) { e.setAttribute(k, a[k]); }); return e; }
  function money(v) { v = +v || 0; var r = Math.abs(v) < 100 ? Math.round(v * 100) / 100 : Math.round(v); return (v < 0 ? '−$' : '$') + Math.abs(r).toLocaleString('en-US', { minimumFractionDigits: Math.abs(v) < 100 && r % 1 ? 2 : 0, maximumFractionDigits: 2 }); }
  function axMoney(v) { return '$' + (Math.abs(v) >= 1000 ? (v / 1000).toFixed(v % 1000 ? 1 : 0) + 'k' : Math.round(v)); }
  function pct(v, d) { return v == null || !isFinite(v) ? '–' : (v * 100).toFixed(d == null ? 1 : d) + '%'; }
  function plural(n, one) { return n + ' ' + (n === 1 ? one : one === 'person' ? 'people' : one + 's'); }
  function niceStep(v) { if (v <= 0) return 1; var p = Math.pow(10, Math.floor(Math.log10(v))), n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p; }
  function axis(lo, hi) { if (!(hi > lo)) hi = lo + 1; var st = niceStep((hi - lo) / 4), a = Math.floor(lo / st) * st, b = Math.ceil(hi / st) * st; return { lo: a, hi: b, step: st }; }
  function chg(a, b) { return a != null && b ? (a - b) / Math.abs(b) : null; }
  function chgTxt(d) { return d == null || !isFinite(d) ? '' : (d > 0 ? '▲ ' : d < 0 ? '▼ ' : '') + Math.abs(d * 100).toFixed(1) + '%'; }
  function stats(vals) {
    var pts = vals.map(function (v, i) { return [i, v]; }).filter(function (p) { return p[1] != null && isFinite(p[1]); });
    if (!pts.length) return null;
    var tot = pts.reduce(function (a, p) { return a + p[1]; }, 0), half = Math.floor(pts.length / 2);
    var hi = pts.reduce(function (a, p) { return p[1] > a[1] ? p : a; }), lo = pts.reduce(function (a, p) { return p[1] < a[1] ? p : a; });
    var a1 = half ? pts.slice(0, half).reduce(function (a, p) { return a + p[1]; }, 0) / half : null, a2 = half ? pts.slice(half).reduce(function (a, p) { return a + p[1]; }, 0) / (pts.length - half) : null;
    var jump = null; for (var k = 1; k < pts.length; k++) { var d = pts[k][1] - pts[k - 1][1]; if (!jump || Math.abs(d) > Math.abs(jump[1])) jump = [pts[k][0], d]; }
    return { n: pts.length, total: tot, avg: tot / pts.length, hi: hi, lo: lo, last: pts[pts.length - 1], prev: pts[pts.length - 2], a1: a1, a2: a2, jump: jump };
  }

  /* ---------- the graph, large ---------- */
  function bigChart(sp, fmt, axf) {
    var kind = sp.kind || 'bars', n = sp.x.length;
    if (kind === 'hbars') return hChart(sp, fmt, axf);
    var W = 1100, H = 380, L = 70, R = 16, T = 16, B = 40;
    var tot = function (i) { return sp.series.reduce(function (a, x) { return a + Math.max(0, +x.values[i] || 0); }, 0); };
    var all = []; sp.series.forEach(function (x) { x.values.forEach(function (v) { if (v != null && isFinite(v)) all.push(+v); }); });
    if (kind === 'stack') all = sp.x.map(function (_, i) { return tot(i); });
    if (sp.target != null) all.push(sp.target);
    var lo = kind === 'line' ? Math.min.apply(null, all.concat([Infinity])) : 0, hi = Math.max.apply(null, all.concat([0]));
    if (kind === 'line') { var pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.1 || 1; lo = Math.max(0, lo - pad); hi = hi + pad; }
    var ax = axis(lo, hi), y = function (v) { return T + (H - T - B) * (1 - (v - ax.lo) / (ax.hi - ax.lo)); };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rp-svg', role: 'img', 'aria-label': sp.title || 'Graph' });
    for (var v = ax.lo; v <= ax.hi + 1e-9; v += ax.step) { svg.appendChild(s('line', { x1: L, x2: W - R, y1: y(v), y2: y(v), class: 'fn-grid' })); var t = s('text', { x: L - 8, y: y(v) + 4, class: 'fn-ax', 'text-anchor': 'end' }); t.textContent = axf(v); svg.appendChild(t); }
    var band = (W - L - R) / Math.max(1, n), cx = function (i) { return L + band * i + band / 2; };
    sp.x.forEach(function (lab, i) { if (n <= 16 || i % Math.ceil(n / 16) === 0) { var t = s('text', { x: cx(i), y: H - 14, class: 'fn-ax', 'text-anchor': 'middle' }); t.textContent = lab; svg.appendChild(t); } });
    if (kind === 'line') {
      sp.series.forEach(function (x) {
        var d = ''; x.values.forEach(function (v, i) { if (v == null || !isFinite(v)) return; d += (d ? 'L' : 'M') + cx(i).toFixed(1) + ',' + y(v).toFixed(1); });
        svg.appendChild(s('path', { d: d, fill: 'none', stroke: x.color, 'stroke-width': 2.5, 'stroke-linejoin': 'round', 'stroke-linecap': 'round' }));
        x.values.forEach(function (v, i) { if (v == null || !isFinite(v)) return; var c = s('circle', { cx: cx(i), cy: y(v), r: 4.5, fill: x.color, stroke: '#fff', 'stroke-width': 2 }); var tt = s('title'); tt.textContent = (sp.xTitle ? sp.xTitle(i) : sp.x[i]) + ' · ' + x.name + ' ' + (x.fmt || fmt)(v); c.appendChild(tt); svg.appendChild(c); });
      });
    } else {
      var k = sp.series.length, bw = kind === 'stack' ? Math.max(6, Math.min(44, band * 0.55)) : Math.max(4, Math.min(24, band * 0.75 / k));
      sp.x.forEach(function (_, i) {
        var acc = 0;
        sp.series.forEach(function (x, j) {
          var v = Math.max(0, +x.values[i] || 0); if (!v && kind === 'stack') return;
          var x0 = kind === 'stack' ? cx(i) - bw / 2 : cx(i) - (k * bw + (k - 1) * 2) / 2 + j * (bw + 2);
          var top = kind === 'stack' ? y(acc + v) : y(v), base = kind === 'stack' ? y(acc) : y(0); acc += kind === 'stack' ? v : 0;
          var r = s('rect', { x: x0, y: top, width: bw, height: Math.max(0, base - top), fill: x.color, rx: kind === 'stack' ? 0 : 3 });
          var tt = s('title'); tt.textContent = (sp.xTitle ? sp.xTitle(i) : sp.x[i]) + ' · ' + x.name + ' ' + (x.fmt || fmt)(v); r.appendChild(tt); svg.appendChild(r);
        });
      });
    }
    if (sp.target != null) { svg.appendChild(s('line', { x1: L, x2: W - R, y1: y(sp.target), y2: y(sp.target), class: 'fn-avg' })); var tl = s('text', { x: W - R - 4, y: y(sp.target) - 6, class: 'fn-ax', 'text-anchor': 'end' }); tl.textContent = sp.targetLabel || 'Target'; svg.appendChild(tl); }
    svg.appendChild(s('line', { x1: L, x2: W - R, y1: y(Math.max(0, ax.lo)), y2: y(Math.max(0, ax.lo)), class: 'fn-base' }));
    return svg;
  }
  function hChart(sp, fmt, axf) {
    var n = sp.x.length, rowH = 28, L = 220, R = 110, T = 8, W = 1100, H = T * 2 + n * rowH + 22;
    var tot = function (i) { return sp.series.reduce(function (a, x) { return a + Math.max(0, +x.values[i] || 0); }, 0); };
    var ax = axis(0, Math.max.apply(null, sp.x.map(function (_, i) { return tot(i); }).concat([0]))), x = function (v) { return L + (W - L - R) * v / ax.hi; };
    var svg = s('svg', { viewBox: '0 0 ' + W + ' ' + H, class: 'rp-svg', role: 'img', 'aria-label': sp.title || 'Graph' });
    for (var v = 0; v <= ax.hi + 1e-9; v += ax.step) { svg.appendChild(s('line', { x1: x(v), x2: x(v), y1: T, y2: H - 20, class: 'fn-grid' })); var t = s('text', { x: x(v), y: H - 4, class: 'fn-ax', 'text-anchor': 'middle' }); t.textContent = axf(v); svg.appendChild(t); }
    sp.x.forEach(function (lab, i) {
      var cy = T + i * rowH + rowH / 2, acc = 0;
      var lt = s('text', { x: L - 10, y: cy + 4, class: 'fn-ax', 'text-anchor': 'end' }); lt.textContent = String(lab).length > 30 ? String(lab).slice(0, 29) + '…' : lab; svg.appendChild(lt);
      sp.series.forEach(function (sx) { var v = Math.max(0, +sx.values[i] || 0); if (!v) return; var r = s('rect', { x: x(acc), y: cy - 8, width: Math.max(1, x(acc + v) - x(acc)), height: 16, fill: sx.color }); var tt = s('title'); tt.textContent = lab + ' · ' + sx.name + ' ' + (sx.fmt || fmt)(v); r.appendChild(tt); svg.appendChild(r); acc += v; });
      var vl = s('text', { x: x(acc) + 6, y: cy + 4, class: 'fn-lab' }); vl.textContent = fmt(acc); svg.appendChild(vl);
    });
    return svg;
  }

  /* ---------- the report ---------- */
  function open(sp) {
    var fmt = sp.fmt || money, axf = sp.axis || (sp.fmt ? sp.fmt : axMoney);
    var isPct = /%/.test(fmt(0.5)), cats = !!sp.cats || sp.kind === 'hbars', unit = sp.unit || (cats ? 'line' : 'week');
    var noTotal = isPct || sp.noTotal;
    var back = h('div', { cls: 'rp', role: 'dialog', 'aria-modal': 'true', 'aria-label': sp.title || 'Report' }), inner = h('div', { cls: 'rp-in' }); back.appendChild(inner);
    function close() { back.remove(); document.removeEventListener('keydown', onKey); document.body.classList.remove('rp-open'); }
    function onKey(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', onKey); document.body.classList.add('rp-open');
    var lab = function (i) { return sp.xTitle ? sp.xTitle(i) : String(sp.x[i]); };
    inner.appendChild(h('div', { cls: 'rp-top' }, [h('button', { type: 'button', cls: 'ed-btn small', text: '← Back', on: { click: close } }), h('span', { cls: 'rp-sp' }),
      h('button', { type: 'button', cls: 'ed-btn small', text: 'Download CSV', on: { click: csv } }), h('button', { type: 'button', cls: 'ed-btn small', text: 'Print', on: { click: function () { window.print(); } } })]));
    inner.appendChild(h('div', { cls: 'rp-h' }, [h('p', { cls: 'rp-eyebrow', text: 'Report' + (!cats && sp.x.length > 1 ? ' · ' + lab(0) + ' – ' + lab(sp.x.length - 1) : '') + ' · ' + plural(sp.x.length, unit) }),
      h('h1', { text: sp.title || 'Report' }), sp.sub ? h('p', { cls: 'rp-sub', text: sp.sub }) : null]));
    var main = sp.series.filter(function (x) { return !x.noStats; }), m0 = main[0] && stats(main[0].values), notes = [];
    if (m0 && !cats) {
      var f0 = main[0].fmt || fmt, tr = chg(m0.a2, m0.a1);
      if (tr != null && isFinite(tr)) notes.push(main[0].name + ' is ' + (Math.abs(tr) < 0.01 ? 'about flat' : (tr > 0 ? 'up ' : 'down ') + Math.abs(tr * 100).toFixed(1) + '%') + ' in the second half of this period compared with the first.');
      if (m0.n > 1) notes.push('Highest: ' + lab(m0.hi[0]) + ' at ' + f0(m0.hi[1]) + '. Lowest: ' + lab(m0.lo[0]) + ' at ' + f0(m0.lo[1]) + '.');
      if (m0.jump && m0.jump[1]) notes.push('Biggest single change: ' + lab(m0.jump[0]) + ', ' + (m0.jump[1] > 0 ? 'up ' : 'down ') + (isPct ? (Math.abs(m0.jump[1]) * 100).toFixed(1) + ' points' : f0(Math.abs(m0.jump[1]))) + ' from the ' + unit + ' before.');
      if (sp.target != null) { var over = main[0].values.filter(function (v) { return v != null && v > sp.target; }).length; notes.push(plural(over, unit) + ' of ' + m0.n + ' above ' + (sp.targetLabel || 'the target') + '.'); }
      if (sp.kind === 'stack' && sp.series.length > 1) { var all = sp.series.map(function (x) { return x.values.reduce(function (a, v) { return a + (+v || 0); }, 0); }), T = all.reduce(function (a, v) { return a + v; }, 0); if (T) notes.push('Over the period: ' + sp.series.map(function (x, i) { return x.name + ' ' + pct(all[i] / T, 0); }).join(' · ') + '.'); }
    } else if (m0 && cats) {
      var tot = sp.x.map(function (_, i) { return sp.series.reduce(function (a, x) { return a + (+x.values[i] || 0); }, 0); }), TT = tot.reduce(function (a, v) { return a + v; }, 0);
      var order = tot.map(function (v, i) { return [i, v]; }).sort(function (a, b) { return b[1] - a[1]; });
      if (TT && !isPct && !noTotal) notes.push(lab(order[0][0]) + ' is the largest at ' + pct(order[0][1] / TT, 0) + ' of the total' + (order.length > 2 ? '; the top three make up ' + pct((order[0][1] + order[1][1] + order[2][1]) / TT, 0) : '') + '.');
      if (order.length > 1) notes.push('Smallest: ' + lab(order[order.length - 1][0]) + ' at ' + fmt(order[order.length - 1][1]) + '.');
    }
    var legend = h('div', { cls: 'rp-legend' }, sp.series.map(function (x) { return h('span', null, [h('i', { style: 'background:' + x.color }), x.name]); }));
    inner.appendChild(h('div', { cls: 'rp-card' }, [notes.length ? h('ul', { cls: 'rp-notes' }, notes.map(function (n) { return h('li', { text: n }); })) : null, sp.series.length > 1 ? legend : null, bigChart(sp, fmt, axf)]));
    // key numbers, one row per line on the graph
    main.forEach(function (x) {
      var st = stats(x.values); if (!st) return; var f = x.fmt || fmt;
      var tiles = cats ? [['Total', f(st.total)], ['Largest', f(st.hi[1]), lab(st.hi[0])], ['Smallest', f(st.lo[1]), lab(st.lo[0])], ['Average', f(st.avg), 'per ' + unit]]
        : [['Latest', f(st.last[1]), lab(st.last[0]) + (st.prev ? ' · ' + chgTxt(chg(st.last[1], st.prev[1])) + ' vs. the one before' : '')], ['Average', f(st.avg), 'over ' + plural(st.n, unit)], ['Highest', f(st.hi[1]), lab(st.hi[0])], ['Lowest', f(st.lo[1]), lab(st.lo[0])]];
      if (cats && (isPct || noTotal)) tiles.shift();
      if (!cats && !noTotal && !x.noTotal) tiles.push(['Total', f(st.total), 'for the period']);
      if (!cats && st.a1 != null) tiles.push(['Trend', chgTxt(chg(st.a2, st.a1)) || 'flat', 'second half vs. first half']);
      inner.appendChild(h('div', { cls: 'rp-series' }, [h('h3', null, [h('i', { style: 'background:' + x.color }), x.name]),
        h('div', { cls: 'rp-tiles' }, tiles.map(function (t) { return h('div', null, [h('span', { text: t[0] }), h('b', { text: t[1] }), t[2] ? h('small', { text: t[2] }) : null]); }))]));
    });
    // every row
    inner.appendChild(h('h2', { cls: 'rp-h2', text: (cats ? 'Every line' : (unit === 'week' ? 'Week by week' : 'Every ' + unit)) + (sp.detail ? ' — tap a row for its breakdown' : '') }));
    var cols = sp.series.map(function (x) { return { name: x.name, f: x.fmt || fmt, v: function (i) { return x.values[i]; }, st: stats(x.values) }; });
    if (sp.kind === 'stack' && sp.series.length > 1) cols.push({ name: 'Total', f: fmt, v: function (i) { return sp.series.reduce(function (a, x) { return a + (+x.values[i] || 0); }, 0); }, bold: true });
    var share = cats && !isPct && !noTotal && cols[0].st ? cols[0].st.total : null;
    var head = h('tr', null, [h('th', { text: sp.xName || (cats ? 'Item' : 'Week') })].concat(cols.map(function (c) { return h('th', { cls: 'r', text: c.name }); }))
      .concat(share ? [h('th', { cls: 'r', text: 'Share' })] : !cats ? [h('th', { cls: 'r', text: 'Change' })] : []));
    var tb = h('tbody'), ord = sp.x.map(function (_, i) { return i; }); if (!cats) ord.reverse();
    if (cats) ord.sort(function (a, b) { return (+cols[0].v(b) || 0) - (+cols[0].v(a) || 0); });
    ord.forEach(function (i) {
      var mv = cols[0].v(i), pv = i > 0 ? cols[0].v(i - 1) : null;
      var tr = h('tr', { cls: sp.detail ? 'rp-click' : null }, [h('td', { text: lab(i) })].concat(cols.map(function (c) { var v = c.v(i), st = c.st; return h('td', { cls: 'r' + (c.bold ? ' b' : '') + (st && st.n > 2 && v === st.hi[1] ? ' hi' : st && st.n > 2 && v === st.lo[1] ? ' lo' : ''), text: v == null || !isFinite(v) ? '–' : c.f(v) }); }))
        .concat(share ? [h('td', { cls: 'r', text: pct(mv / share, 1) })] : !cats ? [h('td', { cls: 'r ' + (mv != null && pv != null ? (mv > pv ? 'up' : mv < pv ? 'down' : '') : ''), text: mv != null && pv != null ? (isPct ? ((mv - pv) * 100 > 0 ? '+' : '') + ((mv - pv) * 100).toFixed(1) + ' pts' : chgTxt(chg(mv, pv))) : '' })] : []));
      tb.appendChild(tr);
      if (sp.detail) { var openRow = null; tr.addEventListener('click', function () { if (openRow) { openRow.remove(); openRow = null; tr.classList.remove('on'); return; } openRow = h('tr', { cls: 'rp-detail' }, h('td', { colspan: String(cols.length + 2) }, sp.detail(i))); tr.after(openRow); tr.classList.add('on'); }); }
    });
    inner.appendChild(h('div', { cls: 'rp-tablew' }, h('table', { cls: 'rp-t' }, [h('thead', null, head), tb])));
    inner.appendChild(h('p', { cls: 'rp-fine', text: 'Green = highest in the column, red = lowest.' + (sp.source ? ' ' + sp.source : '') }));
    function csv() {
      var rows = [[sp.xName || (cats ? 'Item' : 'Week')].concat(cols.map(function (c) { return c.name; }))];
      sp.x.forEach(function (_, i) { rows.push([lab(i)].concat(cols.map(function (c) { var v = c.v(i); return v == null ? '' : Math.round(v * 10000) / 10000; }))); });
      var txt = rows.map(function (r) { return r.map(function (c) { c = String(c); return /[",\n]/.test(c) ? '"' + c.replace(/"/g, '""') + '"' : c; }).join(','); }).join('\n');
      var a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([txt], { type: 'text/csv' })); a.download = 'Eden ' + (sp.title || 'report').replace(/[^\w]+/g, ' ').trim() + '.csv'; document.body.appendChild(a); a.click(); a.remove();
    }
    document.body.appendChild(back); back.scrollTop = 0;
    return { close: close };
  }
  // make a graph open its report: the whole graph is clickable, with a small "Open report" link in its corner
  function wire(box, spec) {
    if (!box || box.dataset.rp) return box; box.dataset.rp = '1';
    box.classList.add('rp-able');
    var go = function () { var sp = typeof spec === 'function' ? spec() : spec; if (sp) open(sp); };
    var link = h('button', { type: 'button', cls: 'rp-link', text: 'Open report ›', on: { click: function (e) { e.stopPropagation(); go(); } } });
    var cap = box.querySelector('figcaption'); if (cap) cap.appendChild(link); else box.appendChild(link);
    box.addEventListener('click', function (e) { if (e.target.closest('button,a,input,select,textarea,details,summary') || !e.target.closest('svg,.ps-bars,.ps-cols,.td-spark,figcaption b,.rp-hit')) return; go(); });
    return box;
  }
  window.EdenReport = { open: open, wire: wire, _stats: stats };
})();
