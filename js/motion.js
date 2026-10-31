/* Eden staff app and manager site: Apple-style motion (styles in css/motion.css).
   - Switching pages: the page fades up into place.
   - Opening something inside a page (a recipe, a BEO, an end of day report, a list item): the new screen
     pushes in from the right; a Back button (‹ …) brings the previous one in from the left.
   - Pop-ups rise over a dimming backdrop (a sheet from the bottom on phones) and sink away when closed;
     full-screen panels (Notes, print preview) slide up and back down.
   Works on top of the existing pages without changing them. Off when the device asks for reduced motion. */
(function () {
  'use strict';
  if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  var D = document;

  function play(el, cls) {
    if (!el) return;
    el.classList.remove('mo-in', 'mo-push', 'mo-back');
    void el.offsetWidth;   // restart the animation
    el.classList.add(cls);
    var done = function () { el.classList.remove(cls); el.removeEventListener('animationend', end); };
    var end = function (e) { if (e.target === el) done(); };
    el.addEventListener('animationend', end);
    setTimeout(done, 700);
  }

  /* ---- 1. pages: a section that was hidden is shown ---- */
  var pageObs = new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      var t = m.target;
      if (m.oldValue !== null && !t.hidden && t.tagName === 'SECTION') play(t, 'mo-in');
    });
  });
  function watchPages() { D.querySelectorAll('section').forEach(function (s) { if (!s._mo) { s._mo = 1; pageObs.observe(s, { attributes: true, attributeFilter: ['hidden'], attributeOldValue: true }); } }); }

  /* ---- 2. drilling in and out: a tap inside a page that changes the page's heading ---- */
  var tap = null;
  function heading(v) {
    var hs = v.querySelectorAll('h1,h2,.bs-bar b,.rc-title');
    for (var i = 0; i < hs.length; i++) if (hs[i].offsetParent !== null || hs[i].getClientRects().length) return hs[i].textContent.trim();
    return '';
  }
  D.addEventListener('click', function (e) {
    var v = e.target.closest && e.target.closest('section');
    var el = e.target.closest && e.target.closest('a,button,[role="button"],li,tr,[tabindex]');
    if (!v || !el || v.hidden) { tap = null; return; }
    var txt = String(el.getAttribute('aria-label') || el.textContent || '').trim();
    tap = { v: v, at: Date.now(), back: /^(‹|←|<|«)|^back\b|\bback to\b/i.test(txt) || el.classList.contains('bs-back') || /back/.test(el.className || ''), h: heading(v) };
  }, true);
  var pending = false;
  var drillObs = new MutationObserver(function () {
    if (!tap || pending) return;
    pending = true;
    requestAnimationFrame(function () {
      pending = false;
      if (!tap) return;
      if (Date.now() - tap.at > 2500) { tap = null; return; }
      var now = heading(tap.v);
      if (now && now !== tap.h) { var t = tap; tap = null; play(t.v, t.back ? 'mo-back' : 'mo-push'); }
    });
  });

  /* ---- 3. pop-ups and panels: animate in when added, out when removed or closed ---- */
  var OV = /(^|\s)(sc-modal|acct-back|pp-preview|em-compose-w|nt|pr-dlg)(\s|$)/;
  function isOv(n) { return n && n.nodeType === 1 && (n.tagName === 'DIALOG' || OV.test(typeof n.className === 'string' ? n.className : '')); }
  var ovObs = new MutationObserver(function (ms) {
    ms.forEach(function (m) {
      [].forEach.call(m.addedNodes, function (n) {
        if (!isOv(n) || n.tagName === 'DIALOG') return;   // dialogs animate from CSS when opened
        n.classList.add('mo-ov-in');
        setTimeout(function () { n.classList.remove('mo-ov-in'); }, 600);
      });
      [].forEach.call(m.addedNodes, function (n) { if (n.nodeType === 1 && n.tagName === 'SECTION') watchPages(); });
    });
  });
  function leave(n, go) {   // play the closing animation, then do what was asked (close, remove…), in order
    if (n._moOut) { n._moOut.push(go); return true; }
    if (!n.isConnected || n.hidden || getComputedStyle(n).display === 'none') return false;
    n._moOut = [go]; n.classList.remove('mo-ov-in'); n.classList.add('mo-ov-out');
    setTimeout(function () { var q = n._moOut; n._moOut = null; n.classList.remove('mo-ov-out'); q.forEach(function (f) { try { f(); } catch (e) {} }); }, n.matches('.nt,.pp-preview,.em-compose-w') ? 250 : 190);
    return true;
  }
  var rm = Element.prototype.remove;
  Element.prototype.remove = function () { var self = this; if (isOv(self) && leave(self, function () { rm.call(self); })) return; return rm.call(self); };
  var rc = Node.prototype.removeChild;
  Node.prototype.removeChild = function (c) { var self = this; if (self === D.body && isOv(c) && leave(c, function () { if (c.parentNode === self) rc.call(self, c); })) return c; return rc.call(self, c); };
  if (window.HTMLDialogElement) {
    var dc = HTMLDialogElement.prototype.close;
    HTMLDialogElement.prototype.close = function (rv) { var self = this; if (self.open && leave(self, function () { if (self.open) dc.call(self, rv); })) return; return dc.call(self, rv); };
  }

  function start() {
    watchPages();
    drillObs.observe(D.body, { childList: true, subtree: true, characterData: true });
    ovObs.observe(D.body, { childList: true });
  }
  if (D.body) start(); else D.addEventListener('DOMContentLoaded', start);
})();
