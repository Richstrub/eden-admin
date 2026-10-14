/* Eden staff site: print the menus from the live menu (the same one the website shows).
 *   Food   - the Kitchen menu on one landscape 8½ × 11 page; the type shrinks a little if it has to, to fit.
 *   Drinks - cocktails, mocktails, aperitifs, beer and soft drinks, spirits, coffee and tea: portrait, two columns.
 *   Wine   - the wine list: portrait, two columns, by bottle (and glass, where poured by the glass).
 * Items hidden in the menu editor are left out. Opens a print preview in a new tab and brings up the print dialog.
 * EdenMenuPrint.choose(getMenu) shows the three choices; EdenMenuPrint.print(kind, menu) prints one.
 */
(function () {
  'use strict';
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function shown(it) { return it && !it.hidden && (it.name || it.price); }
  function price(p) { p = String(p == null ? '' : p).trim(); return p.replace(/^\$\s*/, ''); }
  function isWine(t) { return /wine/i.test(t.label || '') || t.id === 'm-wine'; }
  function isFood(t) { return /kitchen|food/i.test(t.label || '') || t.id === 'm-food'; }
  function tabsOf(menu, kind) {
    return (menu.tabs || []).filter(function (t) { return kind === 'food' ? isFood(t) : kind === 'wine' ? isWine(t) : !isFood(t) && !isWine(t); });
  }
  function groupsOf(tabs) {
    var out = [];
    tabs.forEach(function (t) { (t.groups || []).forEach(function (g) { var items = (g.items || []).filter(shown); if (items.length || g.note) out.push({ tab: t.label, title: g.title, note: g.note, noteAfter: g.noteAfter, items: items }); }); });
    return out;
  }

  var FONTS = '<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>' +
    '<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300;0,400;0,500;1,400&family=Jost:wght@300;400;500&display=swap" rel="stylesheet">';
  var BASE = '*{box-sizing:border-box;margin:0;padding:0}html,body{background:#fff;color:#1a1e22;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    'body{font-family:Jost,Arial,sans-serif;font-weight:300}' +
    '.bar{position:sticky;top:0;z-index:5;display:flex;gap:10px;align-items:center;justify-content:center;padding:12px;background:#0f1215;color:#f3eee5;font:400 13px Jost,Arial,sans-serif}' +
    '.bar button{font:inherit;letter-spacing:.18em;text-transform:uppercase;font-size:11px;padding:10px 16px;border:1px solid #e09a5e;background:#b0703f;color:#fff;cursor:pointer}' +
    '.bar button.alt{background:none;border-color:rgba(243,238,229,.4)}' +
    '.bar span{opacity:.75}' +
    '@media screen{body{background:#e9e4da}.sheet{margin:24px auto;box-shadow:0 6px 30px rgba(0,0,0,.18)}}' +
    '@media print{.bar{display:none}}' +
    '.brand{font-family:"Cormorant Garamond",Georgia,serif;font-weight:400;letter-spacing:.42em;padding-left:.42em;text-align:center;color:#1a1e22}' +
    '.rule{width:46px;height:1px;background:#b0703f;margin:0 auto}' +
    '.sec h2{font-family:"Cormorant Garamond",Georgia,serif;font-weight:400;text-transform:uppercase;letter-spacing:.3em;color:#b0703f;text-align:center}' +
    '.it{break-inside:avoid;page-break-inside:avoid}' +
    '.row{display:flex;align-items:baseline;justify-content:space-between;gap:10px}' +
    '.nm{font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;color:#1a1e22}' +
    '.pr{font-family:"Cormorant Garamond",Georgia,serif;font-weight:500;white-space:nowrap}' +
    '.ds{color:#3d4145}.src{font-style:italic;color:#7f7a71;font-family:"Cormorant Garamond",Georgia,serif}' +
    '.pair{color:#8a5a2f}.note{font-family:"Cormorant Garamond",Georgia,serif;font-style:italic;color:#5d5952;text-align:center}' +
    '.foot{text-align:center;color:#7f7a71;letter-spacing:.06em}';

  // ---------- food: one landscape page, a column per section ----------
  function foodHTML(menu) {
    var groups = groupsOf(tabsOf(menu, 'food'));
    var cols = groups.map(function (g) {
      return '<section class="sec col"><h2>' + esc(g.title) + '</h2><div class="rule"></div>' +
        (g.note ? '<p class="note">' + esc(g.note) + '</p>' : '') +
        g.items.map(function (it) {
          return '<div class="it"><div class="row"><span class="nm">' + esc(it.name) + '</span><span class="pr">' + esc(price(it.price)) + '</span></div>' +
            (it.desc ? '<p class="ds">' + esc(it.desc) + '</p>' : '') +
            (it.src ? '<p class="src">' + esc(it.src) + '</p>' : '') +
            (it.pair ? '<p class="pair">Pairing · ' + esc(it.pair) + (it.pairPrice ? ' · ' + esc(price(it.pairPrice)) : '') + '</p>' : '') + '</div>';
        }).join('') +
        (g.noteAfter ? '<p class="note">' + esc(g.noteAfter) + '</p>' : '') + '</section>';
    }).join('');
    var n = Math.max(1, Math.min(groups.length, 4));
    var css = '@page{size:11in 8.5in;margin:0}' +
      '.sheet{width:11in;height:8.5in;padding:.5in .6in .42in;display:flex;flex-direction:column;overflow:hidden;background:#fff;--s:1}' +
      '.brand{font-size:calc(34px * var(--s));line-height:1}' +
      '.head .rule{margin:calc(9px * var(--s)) auto calc(16px * var(--s))}' +
      '.cols{flex:1;min-height:0;display:grid;grid-template-columns:repeat(' + n + ',minmax(0,1fr));column-gap:.42in;align-content:start}' +
      '.sec h2{font-size:calc(13px * var(--s));margin-bottom:calc(6px * var(--s))}.sec .rule{margin-bottom:calc(14px * var(--s))}' +
      '.it{margin-bottom:calc(12px * var(--s))}' +
      '.nm{font-size:calc(17px * var(--s));line-height:1.15}.pr{font-size:calc(16px * var(--s))}' +
      '.ds{font-size:calc(10.5px * var(--s));line-height:1.4;margin-top:calc(2px * var(--s))}' +
      '.src{font-size:calc(12px * var(--s));line-height:1.3;margin-top:calc(1px * var(--s))}' +
      '.pair{font-size:calc(9.2px * var(--s));line-height:1.35;margin-top:calc(3px * var(--s))}' +
      '.note{font-size:calc(12px * var(--s));margin:0 0 calc(10px * var(--s))}' +
      '.foot{font-size:calc(9px * var(--s));padding-top:calc(8px * var(--s))}' +
      '@media print{html,body{width:11in;height:8.5in;overflow:hidden}.sheet{margin:0;box-shadow:none;page-break-after:avoid;break-after:avoid}}';
    var body = '<div class="sheet" id="sheet"><header class="head"><div class="brand">EDEN</div><div class="rule"></div></header>' +
      '<div class="cols" id="cols">' + (cols || '<p class="note">No dishes on the Kitchen menu yet.</p>') + '</div>' +
      '<p class="foot">' + esc(menu.allergy || 'If you have a food allergy or intolerance, please notify us.') + '</p></div>';
    return page('Eden food menu', css, body, 'Food menu · landscape, one page', true);
  }

  // ---------- drinks and wine: portrait, two columns, as many pages as it needs ----------
  function listHTML(menu, kind) {
    var tabs = tabsOf(menu, kind), wine = kind === 'wine', lastTab = '';
    var html = groupsOf(tabs).map(function (g) {
      var head = '';
      if (!wine && g.tab !== lastTab && tabs.length > 1) { head = '<h1 class="tab">' + esc(g.tab) + '</h1>'; lastTab = g.tab; }
      return head + '<section class="sec">' +
        (g.items.length ? '' : '<div class="it"><h2>' + esc(g.title) + '</h2><div class="rule"></div>' + (g.note ? '<p class="note">' + esc(g.note) + '</p>' : '') + '</div>') +
        g.items.map(function (it, i) {
          var pr = wine ? (it.glass ? '<span class="gl">' + esc(price(it.glass)) + ' / </span>' : '') + esc(price(it.bottle || it.price)) : esc(price(it.price));
          var sub = wine ? [it.grape, it.appellation && it.appellation !== it.grape ? it.appellation : ''].filter(Boolean).join(' · ') : it.desc;
          // the section heading travels with its first item, so a heading never sits alone at the bottom of a column
          return '<div class="it">' + (i ? '' : '<h2>' + esc(g.title) + '</h2><div class="rule"></div>' + (g.note ? '<p class="note">' + esc(g.note) + '</p>' : '')) +
            '<div class="row"><span class="nm">' + esc(it.name) + '</span><span class="pr">' + pr + '</span></div>' +
            (sub ? '<p class="ds">' + esc(sub) + '</p>' : '') + (!wine && it.src ? '<p class="src">' + esc(it.src) + '</p>' : '') + '</div>';
        }).join('') + (g.noteAfter ? '<p class="note">' + esc(g.noteAfter) + '</p>' : '') + '</section>';
    }).join('');
    var css = '@page{size:8.5in 11in;margin:.55in .6in .6in}' +
      '@media screen{.sheet{width:8.5in;min-height:11in;padding:.55in .6in .6in;background:#fff}}' +
      '.brand{font-size:30px;line-height:1}.head .rule{margin:9px auto 6px}.sub{text-align:center;font-size:10px;letter-spacing:.3em;text-transform:uppercase;color:#7f7a71;margin-bottom:22px}' +
      '.body{column-count:2;column-gap:.45in}' +
      '.tab{column-span:all;font-family:"Cormorant Garamond",Georgia,serif;font-weight:300;font-size:22px;text-align:center;margin:10px 0 12px;color:#1a1e22}' +
      '.sec{margin-bottom:16px}.sec h2{font-size:12px;margin-bottom:5px;break-after:avoid}.sec .rule{margin-bottom:10px}' +
      '.it{margin-bottom:' + (wine ? '6px' : '9px') + '}.nm{font-size:' + (wine ? '13px' : '15px') + ';line-height:1.2}.pr{font-size:' + (wine ? '13px' : '14.5px') + '}.gl{color:#7f7a71}' +
      '.ds{font-size:' + (wine ? '9px' : '9.8px') + ';line-height:1.35;margin-top:1px}.src{font-size:11px;line-height:1.25}' +
      '.note{font-size:11.5px;margin:0 0 8px}.foot{font-size:9px;margin-top:14px;column-span:all}';
    var title = wine ? 'Wine List' : 'Drinks';
    var body = '<div class="sheet"><header class="head"><div class="brand">EDEN</div><div class="rule"></div><p class="sub">' + title + '</p></header>' +
      '<div class="body">' + (html || '<p class="note">Nothing on this menu yet.</p>') + '</div>' +
      (wine ? '<p class="foot">Prices are per bottle; wines poured by the glass show the glass price first.</p>' : '') + '</div>';
    return page('Eden ' + title.toLowerCase(), css, body, title + ' · portrait', false);
  }

  function page(title, css, body, label, fit) {
    // fit: shrink the type a step at a time until the food menu's columns fit on its one page
    var script = '<script>(function(){' +
      'function fit(){var s=document.getElementById("sheet"),c=document.getElementById("cols");if(!s||!c)return;var v=1.3;s.style.setProperty("--s",v);' +
      'function over(){var b=c.getBoundingClientRect().bottom;var m=0;[].forEach.call(c.children,function(x){m=Math.max(m,x.getBoundingClientRect().bottom)});return m>b+1}' +
      'while(over()&&v>0.62){v=Math.round((v-0.02)*100)/100;s.style.setProperty("--s",v)}' +
      'document.getElementById("fitmsg").textContent=over()?"Too long for one page \u2014 hide a few dishes or shorten descriptions":"Sized to fit one page";}' +
      'var done=false;function go(){if(done)return;done=true;' + (fit ? 'fit();' : '') + 'setTimeout(function(){window.print()},250)}' +
      'document.getElementById("pr").onclick=function(){window.print()};document.getElementById("cl").onclick=function(){window.close()};' +
      'if(document.fonts&&document.fonts.ready)document.fonts.ready.then(go);setTimeout(go,2500);' +
      '})();<\/script>';
    return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + esc(title) + '</title>' + FONTS +
      '<style>' + BASE + css + '</style></head><body><div class="bar"><span>' + esc(label) + '</span><span id="fitmsg"></span><button id="pr" type="button">Print</button><button id="cl" class="alt" type="button">Close</button></div>' +
      body + script + '</body></html>';
  }

  // open the window right away (inside the click, so pop-up blockers allow it), then fill it once the menu is in hand
  function print(kind, menu, w) {
    w = w || window.open('', '_blank');
    if (!w) { alert('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return null; }
    if (!menu || !menu.tabs) { w.close(); alert('The menu is still loading. Try again in a moment.'); return null; }
    w.document.open(); w.document.write(kind === 'food' ? foodHTML(menu) : listHTML(menu, kind)); w.document.close();
    return w;
  }

  // the three choices, in a small dialog
  function choose(getMenu) {
    var old = document.getElementById('mpDlg'); if (old) old.remove();
    var back = document.createElement('div'); back.id = 'mpDlg'; back.className = 'mp-back'; back.setAttribute('role', 'dialog'); back.setAttribute('aria-modal', 'true'); back.setAttribute('aria-label', 'Print menus');
    back.innerHTML = '<div class="mp-card"><div class="mp-h"><h2>Print menus</h2><button type="button" class="mp-x" aria-label="Close">✕</button></div>' +
      '<p class="mp-lead">Straight from the live menu, so it always matches the website. Hidden items are left out.</p>' +
      '<div class="mp-opts">' +
      '<button type="button" class="mp-opt" data-k="food"><b>Food menu</b><span>The Kitchen menu on one landscape 8½ × 11 page</span></button>' +
      '<button type="button" class="mp-opt" data-k="drinks"><b>Drinks menu</b><span>Cocktails, beer and soft drinks, spirits, coffee and tea · portrait</span></button>' +
      '<button type="button" class="mp-opt" data-k="wine"><b>Wine list</b><span>By the bottle and the glass · portrait</span></button>' +
      '</div><p class="mp-msg" role="status"></p></div>';
    document.body.appendChild(back);
    function close() { back.remove(); document.removeEventListener('keydown', esc2); }
    function esc2(e) { if (e.key === 'Escape') close(); }
    document.addEventListener('keydown', esc2);
    back.addEventListener('mousedown', function (e) { if (e.target === back) close(); });
    back.querySelector('.mp-x').addEventListener('click', close);
    [].forEach.call(back.querySelectorAll('.mp-opt'), function (b) {
      b.addEventListener('click', function () {
        var k = b.getAttribute('data-k'), m = getMenu();
        if (m && typeof m.then === 'function') {
          var w = window.open('', '_blank');
          if (!w) { alert('Your browser blocked the print window. Allow pop-ups for this site and try again.'); return; }
          try { w.document.write('<p style="font:16px sans-serif;padding:40px">Loading the menu…</p>'); } catch (e) {}
          m.then(function (x) { if (print(k, x, w)) close(); }, function () { w.close(); back.querySelector('.mp-msg').textContent = 'Couldn’t load the menu. Check your connection and try again.'; });
          return;
        }
        if (print(k, m)) close();
      });
    });
    var first = back.querySelector('.mp-opt'); if (first) first.focus();
  }

  window.EdenMenuPrint = { choose: choose, print: print, _html: { food: foodHTML, list: listHTML } };
})();
